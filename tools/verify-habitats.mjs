// Invariants of the low-orbit stations (src/space/leoStations.js) after the refinement wave:
// buffer sanity and finite values for every generator, triangle budgets, the Halcyon terraces,
// vault and collector petals clear of each other and of the wheel's sweep, the Aurelia galleries
// and spoke trusses clear of the suites, the Demeter caps clear of the bearings, the Dawnline
// back frame clear of the hub's radiators, and build timings. Run: node tools/verify-habitats.mjs
import * as THREE from 'three';
import {
  buildHotel, HOTEL, buildHabitat, HAB, HAB_COLLECTOR, buildFarmDrum, buildFarmFrame, FARM, buildPolar, POLAR, buildPower, POWER,
  buildSkyhookHub, buildGrapple, buildTram, EMITTER_HEX,
} from '../src/space/leoStations.js';
import { LowOrbit, leoTargets } from '../src/space/lowOrbit.js';
import { moduleDressing, torusKinds, ringModuleKinds } from '../src/space/stationKit.js';
import { CB } from '../src/craft/craftGeometry.js';
import { SpaceSim, R_EARTH } from '../src/space/sim.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

function sane(name, g) {
  const pos = g.attributes.position, idx = g.index;
  let max = 0, finite = true;
  for (let i = 0; i < idx.count; i++) if (idx.array[i] > max) max = idx.array[i];
  for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) { finite = false; break; }
  const fac = g.attributes.aFacade;
  let fin2 = true;
  if (fac) for (let i = 0; i < fac.array.length; i++) if (!Number.isFinite(fac.array[i])) { fin2 = false; break; }
  ok(max < pos.count && idx.count % 3 === 0, `${name}: index max ${max} < ${pos.count} vertices, ${idx.count / 3} triangles`);
  ok(finite && fin2, `${name}: positions and facade coordinates finite`);
  ok(!fac || fac.count === pos.count, `${name}: facade attribute covers every vertex`);
  return idx.count / 3;
}
/** Radial and axial extent (about z) of every vertex whose kind matches, in a z window. */
function extent(g, kinds, pred = () => true) {
  const p = g.attributes.position.array, f = g.attributes.aFacade.array;
  let rMin = Infinity, rMax = 0, zMin = Infinity, zMax = -Infinity, n = 0;
  for (let i = 0; i < p.length / 3; i++) {
    const k = Math.round(f[i * 3 + 2]);
    if (kinds && !kinds.includes(k)) continue;
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    if (!pred(x, y, z)) continue;
    const r = Math.hypot(x, y);
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); zMin = Math.min(zMin, z); zMax = Math.max(zMax, z); n++;
  }
  return { rMin, rMax, zMin, zMax, n };
}

const T = {};
const time = (name, fn) => { const t0 = performance.now(); const r = fn(); T[name] = performance.now() - t0; return r; };

// ---- Halcyon
const hab = time('halcyon', buildHabitat);
let tri = sane('halcyon wheel', hab.wheel) + sane('halcyon fixed', hab.fixed);
ok(tri < 1.4e6, `halcyon ${Math.round(tri)} triangles (< 1.4M)`);
{
  const w = extent(hab.wheel);
  const f = extent(hab.fixed, null, (x, y, z) => z > HAB_COLLECTOR.z - 30);
  ok(w.zMax < HAB_COLLECTOR.z - 150, `halcyon wheel z <= ${w.zMax.toFixed(0)} m, collector from ${HAB_COLLECTOR.z} m: petals clear of the turning wheel`);
  ok(f.rMax < HAB_COLLECTOR.rOut + 40 && f.rMax > HAB_COLLECTOR.rOut - 20, `halcyon collector reaches ${f.rMax.toFixed(0)} m (lip near ${HAB_COLLECTOR.rOut} m)`);
  // the collector is parted into petals: along a ring at mid-span most directions pass between them
  const g = hab.fixed, p = g.attributes.position.array, ix = g.index.array, fac = g.attributes.aFacade.array;
  const bins = new Uint8Array(720);
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t], k = Math.round(fac[a * 3 + 2]);
    if (k !== 7) continue;                                      // film gores
    for (const v of [ix[t], ix[t + 1], ix[t + 2]]) {
      const r = Math.hypot(p[v * 3], p[v * 3 + 1]);
      if (r < 600 || r > 760) continue;
      const ang = (Math.atan2(p[v * 3 + 1], p[v * 3]) + 2 * Math.PI) % (2 * Math.PI);
      bins[Math.floor((ang / (2 * Math.PI)) * 720) % 720] = 1;
    }
  }
  let edges = 0; for (let i = 0; i < 720; i++) if (bins[i] !== bins[(i + 1) % 720]) edges++;
  ok(edges >= HAB_COLLECTOR.petals * 2, `halcyon collector parted into petals (${edges / 2} film runs round mid-span, >= ${HAB_COLLECTOR.petals})`);
  // terraces: the rim tier stands further out than the crown tier, all within the frame edge
  const glass = extent(hab.wheel, [0], (x, y, z) => Math.abs(z) > HAB.halfW - 20);
  ok(glass.n > 0 && Math.abs(glass.zMax) <= HAB.halfW + 3, `halcyon terraces reach |z| ${glass.zMax.toFixed(1)} m (on the floor, whose edge is ${HAB.halfW + 3} m)`);
  const vault = extent(hab.wheel, [12, 13], (x, y, z) => Math.abs(z) < 30);
  const r0 = HAB.R - HAB.depth;
  ok(vault.rMin > r0 - 20 && vault.rMin < r0 - 10, `halcyon park vault crown at ${vault.rMin.toFixed(1)} m (roof line ${r0} m, the vault rises 12 m)`);
  const hub = extent(hab.fixed, null, (x, y, z) => Math.abs(z) < 75);
  ok(hub.n > 0 && hub.rMax < HAB.hubR - 5, `halcyon despun axle and bearings within the hub bore (${hub.rMax.toFixed(1)} m < ${HAB.hubR - 5})`);
  ok(hab.lamps.every((l) => Number.isFinite(l.p.x + l.p.y + l.p.z)) && hab.wheelLamps.every((l) => Number.isFinite(l.p.x + l.p.y + l.p.z)), 'halcyon lamps finite');
}

// ---- Aurelia
const hot = time('aurelia', buildHotel);
tri = sane('aurelia wheel', hot.wheel) + sane('aurelia fixed', hot.fixed);
ok(tri < 700000, `aurelia ${Math.round(tri)} triangles (< 700k)`);
{
  const gal = extent(hot.wheel, [0], (x, y, z) => Math.abs(z) > HOTEL.halfW + 3);
  ok(gal.n > 0 && gal.zMax < HOTEL.halfW + 7.6, `aurelia promenade galleries at |z| <= ${gal.zMax.toFixed(1)} m`);
  const r0 = HOTEL.R - HOTEL.depth;
  const spokes = extent(hot.wheel, [10], (x, y, z) => { const r = Math.hypot(x, y); return r > HOTEL.hubR + 2 && r < r0 - 4; });
  ok(spokes.n > 0 && spokes.zMax < 13 && spokes.zMin > -13, `aurelia spoke trusses within |z| ${Math.max(spokes.zMax, -spokes.zMin).toFixed(1)} m (tension stays run outside)`);
  const fixed = extent(hot.fixed, null, (x, y, z) => Math.abs(z) < 32);
  ok(fixed.rMax < HOTEL.hubIn + 14, `aurelia bearings inside the hub (${fixed.rMax.toFixed(1)} m)`);
}

// ---- Demeter
const drum = time('demeter drum', buildFarmDrum), frame = time('demeter frame', buildFarmFrame);
tri = 2 * sane('demeter drum', drum.geo) + sane('demeter frame', frame.geo);
ok(tri < 900000, `demeter ${Math.round(tri)} triangles (< 900k)`);
{
  const cap = extent(drum.geo, null, (x, y, z) => Math.abs(z) > FARM.halfL + 2 && Math.hypot(x, y) > 30);
  // the frame's bearings sit L+56-10 +- 6 from the drum centre, radius 11..28
  ok(cap.zMax < FARM.halfL + 40, `demeter cap domes end at ${(cap.zMax - FARM.halfL).toFixed(1)} m past the hull, bearings from 40 m`);
  {
    const mp = drum.mirrors.attributes.position.array, mi = drum.mirrors.index.array;
    let mMax = 0, rMin = Infinity; for (const i of mi) mMax = Math.max(mMax, i);
    for (let i = 0; i < mp.length / 3; i++) rMin = Math.min(rMin, Math.hypot(mp[i * 3], mp[i * 3 + 1]));
    ok(mMax < drum.mirrors.attributes.position.count && drum.mirrors.attributes.aMir.count === drum.mirrors.attributes.position.count && mp.every(Number.isFinite), `demeter mirror film: ${mi.length / 3} triangles, buffers sane`);
    ok(rMin > FARM.R + 4, `demeter mirror film ${(rMin - FARM.R).toFixed(1)} m off the drum (clear of the ring girders' hinge bay)`);
  }
  ok(drum.sweep < FARM.sep - 4, `demeter drums' sweep ${drum.sweep.toFixed(0)} m < half separation ${FARM.sep}`);
  const ring = extent(drum.geo, [8], (x, y, z) => Math.abs(z) < FARM.halfL - 30 && Math.hypot(x, y) > FARM.R + 1 && Math.hypot(x, y) < FARM.R + 30 && Math.abs(((z + FARM.halfL) % (FARM.halfL / 4)) - FARM.halfL / 8) > FARM.halfL / 8 - 5);
  ok(ring.rMax < FARM.R + 9, `demeter ring girders stand ${(ring.rMax - FARM.R).toFixed(1)} m proud (< mirror hinge line ${FARM.R + 4 + 1.8} + lacing)`);
}

// ---- Boreal, Dawnline, Anansi
const pol = time('boreal', buildPolar);
tri = sane('boreal body', pol.body) + sane('boreal ring', pol.ring) + sane('boreal wings', pol.wings);
{
  // the spine's tunnel, conduit and bus pass inside the centrifuge's bearing collar (inner 7.5 m)
  const p = pol.body.attributes.position.array, f = pol.body.attributes.aFacade.array;
  let rMax = 0;
  for (let i = 0; i < p.length / 3; i++) {
    const y = p[i * 3 + 1], k = Math.round(f[i * 3 + 2]);
    if ((k === 1 || k === 4) && Math.abs(y - POLAR.ringY) < 12 && Math.hypot(p[i * 3], p[i * 3 + 2]) < 12) rMax = Math.max(rMax, Math.hypot(p[i * 3], p[i * 3 + 2]));
  }
  ok(rMax < 7.5, `boreal tunnel and conduit through the bearing collar at r <= ${rMax.toFixed(2)} m (< 7.5)`);
  const rp = pol.ring.attributes.position.array; let bore = Infinity;
  for (let i = 0; i < rp.length / 3; i++) bore = Math.min(bore, Math.hypot(rp[i * 3], rp[i * 3 + 2]));
  const ring = { rMin: bore };
  ok(ring.rMin > 12.5, `boreal centrifuge hub bore ${ring.rMin.toFixed(1)} m clear of the collar (12 m)`);
  const shade = extent(pol.body, null, (x, y, z) => y > -226 && y < -212 && Math.hypot(x, z) > 50);
  ok(shade.n > 0, 'boreal baffle ring above the nadir deck (deck top -228 m)');
}
const pw = time('dawnline', buildPower);
tri = sane('dawnline body', pw.body) + sane('dawnline emitter', pw.emitter);
ok(tri < 500000, `dawnline ${Math.round(tri)} triangles (< 500k)`);
{
  // the back frame stays behind the blanket (sunward face at z ~ +0.5) and clear of the emitter's sweep
  const back = extent(pw.body, [10, 11], (x, y, z) => Math.abs(x) > 250);
  ok(back.zMax < 2.5 && back.zMin > -70, `dawnline back frame in z ${back.zMin.toFixed(1)}..${back.zMax.toFixed(1)} m (behind the blanket)`);
  const sweep = POWER.disc + 4;
  const near = extent(pw.body, null, (x, y, z) => z < POWER.pivotZ + POWER.discOff + 8 && z > POWER.pivotZ - 10 && Math.hypot(x, y) > 14);
  ok(near.n === 0 || near.rMin > sweep, `dawnline nothing but the mast inside the emitter's sweep (${near.n} vertices)`);
  // hub radiators (x 26..~200, y 0, z -82..-38) clear of the frame's king posts and fins
  const p = pw.body.attributes.position.array, f = pw.body.attributes.aFacade.array;
  let clash = 0;
  for (let i = 0; i < p.length / 3; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2], k = Math.round(f[i * 3 + 2]);
    if (k === 11 && Math.abs(y) > 20 && Math.abs(x) < 230 && z < -30) clash++;
  }
  ok(clash === 0, `dawnline back-frame fins keep off the hub radiators (${clash})`);
  const flats = 2 * EMITTER_HEX.r * Math.cos(Math.PI / 6);
  ok(EMITTER_HEX.tiles > 400 && EMITTER_HEX.pitch - flats > 0.5, `dawnline emitter ${EMITTER_HEX.tiles} hex tiles, ${(EMITTER_HEX.pitch - flats).toFixed(2)} m gaps`);
}
sane("anansi hub", buildSkyhookHub().geo); sane("anansi grapple", buildGrapple().geo);
sane('tram', buildTram());

// ---- the station kit: dressing stays on its module (radially and along it), finite, sane
{
  for (const [r, z0, z1, seed, pitch] of [[12, 44, 94, 11, 8], [30, 74, 282, 21, 14], [90, 27, 48, 24, 10.5], [5.5, 3, 27, 5, undefined]]) {
    const B = new CB();
    const lamps = [];
    moduleDressing(B, r, z0, z1, { seed, kit: 6, windows: 0.2, lamps, pitch });
    const g = B.geometry();
    sane(`dressing r=${r}`, g);
    const p = g.attributes.position.array;
    let rIn = Infinity, rOut = 0, zLo = Infinity, zHi = -Infinity;
    for (let i = 0; i < p.length; i += 3) { const rr = Math.hypot(p[i], p[i + 1]); rIn = Math.min(rIn, rr); rOut = Math.max(rOut, rr); zLo = Math.min(zLo, p[i + 2]); zHi = Math.max(zHi, p[i + 2]); }
    const reach = Math.max(8, r * 0.4);
    ok(rIn > r * 0.6 && rOut < r + reach && zLo > z0 - 12 && zHi < z1 + 12, `dressing r=${r}: hugs its module (radius ${rIn.toFixed(1)}..${rOut.toFixed(1)} m, z ${zLo.toFixed(0)}..${zHi.toFixed(0)})`);
    ok(lamps.every((l) => Number.isFinite(l.p.x + l.p.y + l.p.z)), `dressing r=${r}: ${lamps.length} floodlights, finite`);
  }
  const B = new CB();
  torusKinds(B, 64, 7, 96, 14, ringModuleKinds(12, { glassAt: Math.PI / 2 }));
  const g = B.geometry(), f = g.attributes.aFacade.array, kinds = new Set();
  for (let i = 2; i < f.length; i += 3) kinds.add(Math.round(f[i]));
  sane('segmented ring', g);
  ok(kinds.has(0) && kinds.has(8) && kinds.has(21), `segmented habitat ring: glazing, frames and plated decks (${[...kinds].join(', ')})`);
}

// ---- the shell at run time: trails, approach strobes, the Demeter film, framing, buffers, cost
{
  const sim = new SpaceSim();
  sim.syncFromHours(21);
  const space = {
    scene: new THREE.Scene(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e7), size: new THREE.Vector2(960, 540), sim,
    addBody(name, objects, center, radius, opts) { const b = { name, objects, center, radius, ...opts }; this.bodies.push(b); return b; },
  };
  const t0 = performance.now();
  const lo = new LowOrbit(space);
  ok(performance.now() - t0 < 1500, `low orbit built in ${(performance.now() - t0).toFixed(0)} ms`);
  space.lowOrbit = lo;
  space.scene.add(lo.group);
  const targets = leoTargets(space), cam = space.camera, p = new THREE.Vector3(), q = new THREE.Quaternion();
  sim.step(0);
  lo.update(sim, 0, 0.016, space);
  for (const [name, T] of Object.entries(targets)) {
    const st = lo.byName[name];
    const bound = st.radius * 1.15 + 0.05;
    ok(T.defaultDist > bound * 1.3 && T.defaultDist < bound * 4.5, `${name} framed at ${T.defaultDist} km (bound ${bound.toFixed(2)} km): fills the view without clipping`);
  }
  // no orbit traces at all (they read as a plotter's overlay across every low-orbit view)
  let ribbons = 0;
  lo.group.traverse((o) => { if (o.material && o.material.uniforms && o.material.uniforms.uHead) ribbons++; });
  ok(ribbons === 0 && !lo.trails, 'no orbit-trace ribbons in the shell');
  // Halcyon framed in its own attitude: the camera on the sunward side, 55-75 deg off the spin
  // axis (an open ellipse of the wheel), outside the collector's lip
  targets.halcyon.position(p); targets.halcyon.frame(q);
  const hv = targets.halcyon.view, ce = Math.cos(hv.el);
  const dir = new THREE.Vector3(ce * Math.sin(hv.az), Math.sin(hv.el), ce * Math.cos(hv.az));
  const offAxis = Math.acos(dir.z) * 180 / Math.PI;
  ok(dir.z > 0 && offAxis > 55 && offAxis < 75, `halcyon viewed ${offAxis.toFixed(0)} deg off its spin axis, sunward side`);
  const hq = new THREE.Quaternion(); lo.byName.halcyon.frameAt(sim.t, new THREE.Vector3(), hq);
  ok(Math.abs(q.dot(hq)) > 0.9999, 'halcyon target frame is the station attitude (spin axis on the Sun)');
  // the satellites: sparse, sunlit, gone in the shadow, never a ring (CPU mirror of the shader)
  {
    const C = lo.constellations, cp = new THREE.Vector3(), sun = sim.sunDir.clone().normalize();
    const cams = { halcyon: 2.6, aurelia: 0.82, demeter: 2.05, boreal: 0.72, dawnline: 2.4, anansi: 0.55 };
    let worst = 0, worstName = '', shadowLit = 0, far = 0, bad = 0;
    for (const T of [0, 1800, 3600, 20000, 86400 * 2.5]) {
      sim.t = T; sim.update && sim.update();
      C.update(sim.t, 0, sun, null, 540);
      for (const [name, d] of Object.entries(cams)) {
        lo.pose(name, sim, cp, null);
        cp.add(new THREE.Vector3(d * 0.6, d * 0.5, d * 0.62));
        let vis = 0;
        for (let i = 0; i < C.count; i++) {
          const b = C.apparent(i, cp, sun);
          if (!Number.isFinite(b)) bad++;
          if (b > 0.02) vis++;
          if (b > 0) { const sp = C.position(i, new THREE.Vector3()); const al = sp.dot(sun); if (al < 0 && Math.sqrt(sp.lengthSq() - al * al) < R_EARTH - 9) shadowLit++; }
        }
        if (vis > worst) { worst = vis; worstName = `${name} t=${T}`; }
      }
      cp.set(R_EARTH + 30000, 2000, 1000);
      for (let i = 0; i < C.count; i++) if (C.apparent(i, cp, sun) > 0.02) far++;
    }
    ok(bad === 0, 'satellite brightness finite everywhere');
    ok(worst <= 24, `at most ${worst} of ${C.count} satellites visible from a station view (${worstName}): glints, not rings`);
    ok(shadowLit === 0, 'no satellite shines inside the Earth\'s umbra');
    ok(far <= 6, `from 30,000 km out only ${far} flaring satellites show over five epochs (no shells traced)`);
    // a flare: somewhere near its specular geometry a satellite outshines its diffuse self many times
    let peak = 0;
    for (let i = 0; i < 400; i++) { const sp = C.position(i, new THREE.Vector3()); const b = C.apparent(i, sp.clone().multiplyScalar(1 - 150 / sp.length()), sun); peak = Math.max(peak, b); }
    ok(peak > 0.05, `a satellite 150 km overhead reads as a faint star or a flare (peak ${peak.toFixed(2)})`);
    sim.t = 0; sim.update && sim.update();
  }
  targets.halcyon.position(p); targets.halcyon.frame(q);
  cam.position.copy(p).add(new THREE.Vector3(0, 0, targets.halcyon.defaultDist).applyQuaternion(q));
  cam.updateMatrixWorld();
  lo.update(sim, 10, 0.016, space);
  {
    const mats = new Set();
    for (const s of [...lo.stations, lo.skyhook]) mats.add(s.mat);
    let dressed = 0, env = 0;
    for (const m of mats) { if (m.userData.dressed && m.userData.refined) dressed++; if (m.uniforms.uAoH && m.uniforms.uAoH.value.x > 0) env++; }
    ok(dressed === mats.size && env === mats.size, `station materials dressed and refined (${dressed}/${mats.size}), with occlusion envelopes (${env}/${mats.size})`);
    const dk = (g) => { const f = g.attributes.aFacade.array; let n = 0; for (let i = 2; i < f.length; i += 3) if (f[i] > 19.5 && f[i] < 26.5) n++; return n / (f.length / 3); };
    for (const s of lo.stations.filter((x) => !x.name.startsWith('gleaner'))) ok(dk(s.fixed.geometry) > 0.03 || (s.wheel && dk(s.wheel.geometry) > 0.03) || (s.drums && dk(s.drums[0].geometry) > 0.03), `${s.name}: hull carries the dressed finishes (ports, livery, foil, worn plate)`);
  }
  // approach strobes: dark between runs (no permanent bead string)
  const hal = lo.byName.halcyon;
  if (hal.approach) {
    let lit = 0;
    const g = hal.approach.lamps;
    lo._animateApproach(hal, 1.0);
    for (let i = 0; i < hal.approach.n; i++) if (g.C.array[i * 4] > 0.05 * Math.max(g.base[i * 4], 1e-6)) lit++;
    ok(lit < hal.approach.n / 3, `approach strobes mostly dark between runs (${lit} of ${hal.approach.n} lit)`);
  }
  // Demeter's film meshes: one per drum, the mirror material, sheets clear of the drum
  const dem = lo.byName.demeter;
  const films = dem.drums.map((d) => d.children.find((c) => c.material && c.material.uniforms && c.material.uniforms.uCylR));
  ok(films.every(Boolean), 'demeter drums carry their mirror film meshes');
  // buffer sanity for everything the shell draws
  let badIdx = 0, badInst = 0, badAttr = 0;
  lo.group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, pos = g.attributes.position;
    if (g.index && !g.isInstancedBufferGeometry) { let m = 0; const a = g.index.array; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; if (m >= pos.count) badIdx++; }
    if (o.isInstancedMesh && o.count > o.instanceMatrix.count) badInst++;
    if (g.isInstancedBufferGeometry) for (const k in g.attributes) { const at = g.attributes[k]; if (at.isInstancedBufferAttribute && at.count < (g.instanceCount === Infinity ? 0 : g.instanceCount)) badAttr++; }
  });
  ok(!badIdx && !badInst && !badAttr, `shell buffers sane (index ${badIdx}, instance counts ${badInst}, instanced attributes ${badAttr})`);
  // per-frame cost near a station
  cam.position.copy(p).add(new THREE.Vector3(0, 0, 2).applyQuaternion(q)); cam.updateMatrixWorld();
  const n = 200, t1 = performance.now();
  for (let i = 0; i < n; i++) { sim.step(0.016); lo.update(sim, 20 + i * 0.016, 0.016, space); }
  const ms = (performance.now() - t1) / n;
  ok(ms < 0.6, `low orbit update ${ms.toFixed(3)} ms per frame (headless; the app's budget is 0.3 ms for this domain's additions)`);
}

for (const [k, v] of Object.entries(T)) ok(v < 900, `${k} built in ${v.toFixed(0)} ms (< 900)`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
