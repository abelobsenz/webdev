// Invariants of the low and middle shell (src/space/lowOrbit.js and friends), headless.
// Run: node tools/verify-lift.mjs
import * as THREE from 'three';
import { SpaceSim, R_EARTH, bodyDir, MERIDIAN_LON } from '../src/space/sim.js';
import { Orbit, MU, sunSyncInclination, sunlitFraction, periodOf } from '../src/space/kepler.js';
import { LowOrbit } from '../src/space/lowOrbit.js';
import { buildHotel, HOTEL, buildPolar, POLAR, buildFarmDrum, buildFarmFrame, FARM, buildPower, POWER, SKYHOOK, buildTram, buildHabitat } from '../src/space/leoStations.js';
import { SHELLS } from '../src/space/constellations.js';
import { buildRelayCollar, buildCrawler, crawlerAt, CRAWLERS, CRAWL_RANGE } from '../src/space/tetherStations.js';
import { RIBBON } from '../src/space/climbers.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };
const log = (k, v) => console.log(k.padEnd(34), typeof v === 'string' ? v : JSON.stringify(v));

// ---- Kepler: energy and angular momentum conserved, J2 sun-synchronous rate, closed laps
{
  const o = new Orbit({ a: 7200, e: 0.05, inc: 0.9, node: 1.2, argp: 0.4, M0: 0.3, j2: false });
  const p = new THREE.Vector3(), v = new THREE.Vector3();
  let eMin = Infinity, eMax = -Infinity, hMin = Infinity, hMax = -Infinity;
  for (let t = 0; t < o.period; t += o.period / 97) {
    o.pos(t, p); o.vel(t, v);
    const E = v.lengthSq() / 2 - MU / p.length(), h = p.clone().cross(v).length();
    eMin = Math.min(eMin, E); eMax = Math.max(eMax, E); hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
  }
  ok((eMax - eMin) / Math.abs(eMin) < 1e-9 && (hMax - hMin) / hMin < 1e-9, 'Kepler energy / momentum');
  const a = o.pos(0, new THREE.Vector3()), b = o.pos(o.period, new THREE.Vector3());
  ok(a.distanceTo(b) < 1e-6, 'orbit closes after one period');
  // numerical velocity matches analytic
  o.pos(1000, a); o.pos(1000.01, b); o.vel(1000, v);
  ok(b.sub(a).divideScalar(0.01).distanceTo(v) < 1e-3, 'velocity is the derivative of position');
  // prograde: the angular momentum of a low-inclination orbit points north
  ok(new Orbit({ alt: 800, inc: 0.2 }).normal(0, new THREE.Vector3()).y > 0.9, 'prograde orbit normal north');
  const iSS = sunSyncInclination(R_EARTH + 1200);
  const oss = new Orbit({ alt: 1200, inc: iSS });
  log('sun-synchronous inclination', (iSS * 180 / Math.PI).toFixed(2) + ' deg');
  ok(Math.abs(oss.nodeRate * 365.2422 * 86400 - Math.PI * 2) < 1e-6, 'SSO node turns once a year');
  ok(Math.abs(periodOf(R_EARTH + 820) - new Orbit({ alt: 820 }).period) < 1e-6, 'period');
}

// ---- the module
const sim = new SpaceSim();
sim.syncFromHours(21.5);
const space = { scene: new THREE.Scene(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.001, 1e7), size: new THREE.Vector2(1920, 1080), sim,
  addBody(name, objects, center, radius, opts) { const b = { name, objects, center, radius, ...opts }; this.bodies.push(b); return b; } };
const t0 = performance.now();
const lo = new LowOrbit(space);
const buildMs = performance.now() - t0;
space.scene.add(lo.group);
space.lowOrbit = lo;
log('build (ms)', +buildMs.toFixed(1));
ok(buildMs < 1000, 'build under 1 s');
const uniqueTris = lo.triangles();
log('unique triangles', uniqueTris);
ok(uniqueTris < 4e6, 'unique triangles under 4M');

// ---- triangles per level of detail: far (a glint and the orbit trace), mid (lamps: two per lamp),
// near (the full model: every mesh under the station, instanced parts at full count)
{
  const per = {};
  for (const s of [...lo.stations, lo.skyhook]) {
    let near = 0, lamps = 0;
    s.root.traverse((o) => {
      const g = o.geometry;
      if (!g || !g.index) return;
      if (g.isInstancedBufferGeometry) lamps += (g.index.count / 3) * g.instanceCount;
      else near += (g.index.count / 3) * (o.isInstancedMesh ? o.instanceMatrix.count : 1);
    });
    per[s.name] = { far: 2, mid: lamps, near: near + lamps };
    ok(near + lamps < 12e6, `${s.name} near LOD within the domain budget`);
  }
  log('triangles per LOD', per);
}

// ---- buffer sanity: instanced capacities, index ranges, lamp instance counts
function buffers(root) {
  let n = 0;
  root.traverse((o) => {
    const g = o.geometry;
    if (!g) return;
    n++;
    const pos = g.attributes.position;
    if (g.index) {
      let mx = 0; const a = g.index.array;
      for (let i = 0; i < a.length; i++) if (a[i] > mx) mx = a[i];
      ok(mx < pos.count, `${o.name || o.type}: index ${mx} >= vertices ${pos.count}`);
    }
    for (const [k, at] of Object.entries(g.attributes)) ok(at.array.every(Number.isFinite), `${o.type} attribute ${k} finite`);
    if (o.isInstancedMesh) {
      ok(o.count <= o.instanceMatrix.count, `InstancedMesh count ${o.count} > capacity ${o.instanceMatrix.count}`);
      ok(o.instanceMatrix.count >= 1, 'InstancedMesh capacity >= 1');
    }
    if (g.isInstancedBufferGeometry) {
      for (const [k, at] of Object.entries(g.attributes)) if (at.isInstancedBufferAttribute) ok(at.count >= g.instanceCount, `instanced attribute ${k} (${at.count}) < instanceCount ${g.instanceCount}`);
    }
  });
  return n;
}

// ---- run the clock: several epochs, a camera parked by each station and one out in the shell
const cam = space.camera;
const _p = new THREE.Vector3();
const bad = () => { let n = 0; space.scene.traverse((o) => { if (!o.matrixWorld.elements.every(Number.isFinite)) n++; }); return n; };
const ts = [0, 37, 950, 5400, 86400 * 3.3, 86400 * 40];
let minShuttleAlt = Infinity, minHopperAlt = Infinity, maxNear = 0, maxGlint = 0;
for (const T of ts) {
  sim.t = T; sim.update();
  for (const name of ['aurelia', 'demeter', 'boreal', 'dawnline', 'anansi', null]) {
    if (name) { lo.pose(name, sim, _p, null); cam.position.copy(_p).add(new THREE.Vector3(0.6, 0.4, 0.9)); }
    else cam.position.set(R_EARTH + 900, 300, 200);
    cam.lookAt(_p); cam.updateMatrixWorld();
    lo.update(sim, T * 0.01, 0.016, space);
    space.scene.updateMatrixWorld(true);
    for (const s of lo.shuttles) minShuttleAlt = Math.min(minShuttleAlt, s.root.position.length() - R_EARTH);
    for (const h of lo.hoppers) if (h.active) minHopperAlt = Math.min(minHopperAlt, h.root.position.length() - R_EARTH);
    maxNear = Math.max(maxNear, lo.constellations.nearCount);
  }
  ok(bad() === 0, `finite transforms at t=${T}`);
}
buffers(lo.group);
log('min shuttle altitude (km)', +minShuttleAlt.toFixed(1));
log('min hopper altitude (km)', +minHopperAlt.toFixed(1));
ok(minShuttleAlt > 626, 'shuttles stay above the Halo and its vault');
ok(minHopperAlt > 626, 'hoppers stay above the Halo and its vault');

// ---- nothing orbits through the Halo's altitude band (600-640 km), nothing below it
for (const s of [...lo.stations, lo.skyhook]) {
  const o = s.orbit, rp = o.a * (1 - o.e) - R_EARTH, ra = o.a * (1 + o.e) - R_EARTH;
  ok(rp > 660, `${s.name} perigee ${rp.toFixed(0)} km clear of the Halo`);
  void ra;
}
ok(SKYHOOK.halfKm + 0.2 < lo.skyhook.orbit.a - R_EARTH - 660, 'skyhook tip clears the Halo');
for (const sh of SHELLS) ok(sh.alt > 660, `shell ${sh.alt} km above the Halo`);

// ---- the skyhook catches and throws continuously (no jumps at catch and release)
{
  const sk = lo.skyhook, rel = sk.relRate;
  const psi = lo._psi(1000);
  const c = Math.floor((psi - Math.PI) / Math.PI) + 1;
  const tc = 1000 + (Math.PI + c * Math.PI - psi) / rel, tr = tc + Math.PI / rel;
  const hp = () => lo.hoppers.find((h) => h.active);
  const at = (t) => { sim.t = t; sim.update(); lo.update(sim, 0, 0.016, space); return lo.hoppers.map((h) => (h.active ? h.root.position.clone() : null)); };
  // the tip is at the bottom (pointing at the Earth) at the catch
  const k = ((c % 2) + 2) % 2;
  const tip = lo._tipAt(k, tc, new THREE.Vector3(), new THREE.Vector3());
  sim.t = tc; sim.update(); sk.place(tc);
  const hub = sk.root.position.clone();
  ok(tip.clone().sub(hub).normalize().dot(hub.clone().normalize()) < -0.999, 'catch happens at the bottom of the swing');
  const vt = new THREE.Vector3(); lo._tipAt(k, tc, new THREE.Vector3(), vt);
  const vh = sk.orbit.vel(tc, new THREE.Vector3());
  log('tip / hub speed at catch (km/s)', [+vt.length().toFixed(2), +vh.length().toFixed(2)]);
  ok(vh.length() - vt.length() > 3.0, 'tip slower than the hub at the bottom');
  // continuity across catch and release: nearest hopper position before and after moves < 60 m/s * dt
  for (const T of [tc, tr]) {
    const a = at(T - 0.05), b = at(T + 0.05);
    let best = Infinity;
    for (const pa of a) for (const pb of b) if (pa && pb) best = Math.min(best, pa.distanceTo(pb));
    ok(best < 1.5, `hopper continuous across ${T === tc ? 'catch' : 'release'} (${best.toFixed(3)} km in 0.1 s)`);
  }
  void hp;
  log('tip gravity (g)', +((sk.omega * sk.omega * sk.L * 1000) / 9.81).toFixed(2));
}

// ---- moving parts clear the fixed structure
function samples(geo, m = null) {
  const p = geo.attributes.position, idx = geo.index.array, out = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(p, idx[i]); b.fromBufferAttribute(p, idx[i + 1]); c.fromBufferAttribute(p, idx[i + 2]);
    for (const [u, v] of [[1, 0], [0, 1], [0, 0], [0.33, 0.33], [0.5, 0.5], [0.5, 0], [0, 0.5]]) {
      const q = new THREE.Vector3().addScaledVector(a, u).addScaledVector(b, v).addScaledVector(c, 1 - u - v);
      if (m) q.applyMatrix4(m);
      out.push(q);
    }
  }
  return out;
}
/** Swept (r, axial) occupancy of a part spinning about an axis through `c` along `ax`. */
function sweptHits(moving, fixed, ax, c = new THREE.Vector3(), cell = 1) {
  const occ = new Set(), key = (r, z) => `${Math.floor(r / cell)},${Math.floor(z / cell)}`;
  const rz = (q) => { const d = q.clone().sub(c); const z = d.dot(ax); return [Math.sqrt(Math.max(d.lengthSq() - z * z, 0)), z]; };
  for (const q of moving) { const [r, z] = rz(q); occ.add(key(r, z)); }
  let hits = 0;
  for (const q of fixed) { const [r, z] = rz(q); if (occ.has(key(r, z))) hits++; }
  return hits;
}
{
  const h = buildHotel();
  const hits = sweptHits(samples(h.wheel), samples(h.fixed), new THREE.Vector3(0, 0, 1));
  ok(hits === 0, `hotel wheel sweeps clear of the spindle (${hits} fixed samples in its path)`);
  const hb = buildHabitat();
  const habHits = sweptHits(samples(hb.wheel), samples(hb.fixed), new THREE.Vector3(0, 0, 1));
  ok(habHits === 0, `Halcyon torus sweeps clear of its axle and collector (${habHits})`);
  const b = buildPolar();
  const ringHits = sweptHits(samples(b.ring), samples(b.body), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, POLAR.ringY, 0));
  ok(ringHits === 0, `polar centrifuge clear (${ringHits})`);
  const wingHits = sweptHits(samples(b.wings, new THREE.Matrix4().makeTranslation(0, POLAR.wingY, 0)), samples(b.body), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, POLAR.wingY, 0));
  ok(wingHits === 0, `polar wings clear (${wingHits})`);
  const d = buildFarmDrum(), f = buildFarmFrame();
  const fr = samples(f.geo);
  for (const sx of [-1, 1]) {
    const dh = sweptHits(samples(d.geo, new THREE.Matrix4().makeTranslation(sx * FARM.sep, 0, 0)), fr, new THREE.Vector3(0, 0, 1), new THREE.Vector3(sx * FARM.sep, 0, 0));
    ok(dh === 0, `farm drum ${sx} clear of the frame (${dh})`);
  }
  ok(2 * d.sweep < 2 * FARM.sep, `farm drums (mirror sweep ${d.sweep.toFixed(0)} m) clear of each other`);
  // Dawnline's emitter at a spread of gimbal angles (the clamp keeps it on the far side)
  const pw = buildPower();
  const body = samples(pw.body), grid = new Map(), C = 4;
  const gk = (q) => `${Math.floor(q.x / C)},${Math.floor(q.y / C)},${Math.floor(q.z / C)}`;
  for (const q of body) { const k = gk(q); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(q); }
  const em = samples(pw.emitter);
  let worst = Infinity;
  for (let i = 0; i < 40; i++) {
    const dir = new THREE.Vector3(Math.cos(i * 2.4), Math.sin(i * 2.4), -0.05 - 0.95 * (i / 39)).normalize();
    const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)).setPosition(0, 0, POWER.pivotZ);
    for (const q0 of em) {
      if (q0.length() < 12) continue;            // the gimbal joint itself
      const q = q0.clone().applyMatrix4(m);
      const cx = Math.floor(q.x / C), cy = Math.floor(q.y / C), cz = Math.floor(q.z / C);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const l = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
        if (l) for (const r of l) worst = Math.min(worst, r.distanceTo(q));
      }
    }
  }
  log('emitter clearance (m)', worst === Infinity ? '>8' : +worst.toFixed(2));
  ok(worst > 2, 'Dawnline emitter clears the station at every gimbal angle');
}

// ---- per-frame cost (a camera in the shell exercises the constellation scan)
{
  sim.t = 12345; sim.update();
  lo.pose('aurelia', sim, _p, null);
  cam.position.copy(_p).add(new THREE.Vector3(1, 0.5, 0.5)); cam.updateMatrixWorld();
  for (let i = 0; i < 60; i++) { sim.t += 1; sim.update(); lo.update(sim, i / 60, 0.016, space); }
  const N = 400, t1 = performance.now();
  for (let i = 0; i < N; i++) { sim.t += 0.96; sim.update(); lo.update(sim, i / 60, 0.016, space); }
  const ms = (performance.now() - t1) / N;
  log('update (ms/frame)', +ms.toFixed(3));
  ok(ms < 0.3, 'update under 0.3 ms');
  // steady state: no growth in heap-ish arrays (candidate list bounded)
  ok(lo.constellations.nCand <= lo.constellations.cand.length, 'candidate list bounded');
  log('constellation satellites', lo.constellations.count);
  log('max near satellite models', maxNear);
}

// ---- near satellites: a camera beside one of them brings up real models (after a scan)
{
  const C = lo.constellations;
  sim.t = 777; sim.update();
  C.update(sim.t, 0, sim.sunDir, cam, 1080);
  const sp = C.position(1234, new THREE.Vector3());
  let shown = 0;
  for (let i = 0; i < 12; i++) {
    cam.position.copy(sp).add(new THREE.Vector3(3, 2, 1)); cam.updateMatrixWorld();
    lo.update(sim, i / 60, 0.016, space);
    C.position(1234, sp);
    shown = Math.max(shown, C.nearCount);
  }
  log('near models beside a satellite', shown);
  ok(shown >= 1, 'a satellite within range becomes a model');
  // the model sits where the shader puts the point (same maths, local origin at the camera)
  let found = false;
  for (const im of C.sets) for (let k = 0; k < im.count; k++) {
    const m = new THREE.Matrix4(); im.getMatrixAt(k, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m).add(C.near.position);
    if (p.distanceTo(sp) < 1e-3) found = true;
  }
  ok(found, 'near model placed at the satellite');
}

// ---- drones keep to lanes clear of their stations' structure
{
  for (const s of lo.stations) {
    if (!s.drones) continue;
    const pts = [];
    const g = s.fixed.geometry.attributes.position;
    for (let i = 0; i < g.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(g, i));
    let worst = Infinity;
    for (let f = 0; f < 40; f++) {
      lo._animateDrones(s, f * 7.3);
      const m = new THREE.Matrix4(), p = new THREE.Vector3();
      for (let i = 0; i < s.drones.n; i++) {
        s.drones.im.getMatrixAt(i, m); p.setFromMatrixPosition(m);
        for (const q of pts) { const d = q.distanceToSquared(p); if (d < worst) worst = d; }
      }
    }
    worst = Math.sqrt(worst);
    log(`${s.name} drone clearance (m)`, +worst.toFixed(1));
    ok(worst > 12, `${s.name} drones clear of the structure`);
  }
}

// ---- shuttles and hoppers keep clear of Meridian's tether (a line up from the equator, turning with the Earth)
{
  const up0 = bodyDir(0, MERIDIAN_LON);
  const q = new THREE.Quaternion(), u = new THREE.Vector3(), p = new THREE.Vector3();
  let worst = Infinity;
  for (let T = 0; T < 86400 * 2; T += 20) {
    sim.t = T; sim.update();
    lo.update(sim, T * 0.01, 0.016, space);
    u.copy(up0).applyQuaternion(sim.earthQuat);
    for (const c of [...lo.shuttles.map((s) => s.root.position), ...lo.hoppers.filter((h) => h.active).map((h) => h.root.position)]) {
      const along = c.dot(u);
      if (along <= 0) continue;
      p.copy(c).addScaledVector(u, -along);
      worst = Math.min(worst, p.length());
    }
  }
  log('closest pass to the tether (km)', +worst.toFixed(1));
  ok(worst > 8, 'traffic keeps clear of the elevator tether');
}

// ---- Dawnline's tram runs its rail without meeting the station (swept box along the whole rail)
{
  const pw = buildPower(), tg = buildTram();
  tg.computeBoundingBox();
  const bb = tg.boundingBox, y0 = POWER.tramY + 2.3 + bb.min.y, y1 = POWER.tramY + 2.3 + bb.max.y, z0 = POWER.tramZ + 2.3 + bb.min.z, z1 = POWER.tramZ + 2.3 + bb.max.z;
  const p = pw.body.attributes.position;
  let hits = 0, seatGap = Infinity;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (Math.abs(x) < POWER.half + 8 && y > y0 + 0.05 && y < y1 && z > z0 && z < z1) hits++;
    if (Math.abs(x) <= POWER.half + 1 && z > z0 && z < z1 && y <= y0 + 0.05) seatGap = Math.min(seatGap, y0 - y);
  }
  log('tram swept-box intrusions', hits);
  ok(hits === 0, 'tram path clear');
  ok(seatGap < 0.1, `tram rides on its rail (gap ${seatGap.toFixed(2)} m)`);
}

// ---- relay crawlers run the ribbon's faces through the collar bore without meeting it
{
  const col = buildRelayCollar(), cg = buildCrawler();
  const cp = cg.attributes.position;
  let cx = 0, cz = 0;
  for (let i = 0; i < cp.count; i++) { cx = Math.max(cx, Math.abs(cp.getX(i))); cz = Math.max(cz, Math.abs(cp.getZ(i))); }
  const corridorX = RIBBON.thick / 2 + cx + 0.5, corridorZ = 7 + cz + 0.5;
  let inside = 0;
  const p = col.geo.attributes.position;
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i)) < corridorX && Math.abs(p.getZ(i)) < corridorZ && Math.abs(p.getY(i)) < CRAWL_RANGE + 10) inside++;
  log('crawler corridor (m, x / z)', [+corridorX.toFixed(1), +corridorZ.toFixed(1)]);
  ok(inside === 0, `relay collar keeps the crawler corridor open (${inside} vertices in it)`);
  ok(corridorZ < RIBBON.width / 2, 'crawlers ride within the ribbon width');
  for (let k = 0; k < CRAWLERS; k++) for (let t = 0; t < 2000; t += 13) { const c = crawlerAt(k, t, 0.7); ok(Math.abs(c.y) <= CRAWL_RANGE + 1e-6, 'crawler range'); }
}

// ---- sunlit logic: the far side of the Earth is dark, the day side lit
ok(sunlitFraction(new THREE.Vector3().copy(sim.sunDir).multiplyScalar(-7000), sim.sunDir) === 0, 'umbra dark');
ok(sunlitFraction(new THREE.Vector3().copy(sim.sunDir).multiplyScalar(7000), sim.sunDir) === 1, 'day side lit');

// ---- bodies registered, all objects covered
const covered = new Set();
for (const b of space.bodies) for (const o of b.objects) covered.add(o);
for (const o of lo.group.children) ok(covered.has(o), `${o.name || o.type} is in a depth-slice body`);
log('bodies', space.bodies.map((b) => b.name));

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('VERIFY_LIFT_OK');
