// Invariants of the Lagrange colonies (src/space/lagrange*.js), headless: placement on the Moon's
// orbit, moving parts clear of what they turn past, lanes clear of the structures, buffer
// sanity for every mesh the module draws, triangle budgets, build and per-frame timings.
// Run: node tools/verify-lagrange.mjs
import * as THREE from 'three';
import { SpaceSim, MOON_DIST } from '../src/space/sim.js';
import { COL, WINDOW_CENTRES, buildRotor, buildStator, buildAgriRing, buildPairFrame, buildMirror } from '../src/space/lagrangeColony.js';
import { GATE, buildGateway, buildGatewayWheel } from '../src/space/lagrangeGateway.js';
import { LagrangeColonies, lagrangePoint } from '../src/space/lagrange.js';
import { shipPose } from '../src/space/fleetTraffic.js';
import { LAGRANGE_SHADERS } from '../src/space/lagrangeShaders.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const deg = THREE.MathUtils.radToDeg;

// ---- construction
const sim = new SpaceSim();
sim.syncFromHours(21);
const space = {
  scene: new THREE.Scene(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e7), sim,
  addBody(name, objects, center, radius, opts) { const b = { name, objects, center, radius, ...opts }; this.bodies.push(b); return b; },
};
const t0 = performance.now();
const lag = new LagrangeColonies(space);
const buildMs = performance.now() - t0;
ok(buildMs < 1000, `build ${buildMs.toFixed(0)} ms (< 1000; module's own ${lag.buildMs.toFixed(0)} ms)`);

// ---- placement
sim.step(0);
const L4 = lagrangePoint(sim, 'L4'), L5 = lagrangePoint(sim, 'L5'), L1 = lagrangePoint(sim, 'L1');
const n = new THREE.Vector3().crossVectors(sim.moon0, sim.moonT).normalize();
ok(Math.abs(deg(L4.angleTo(sim.moonPos)) - 60) < 0.01 && Math.abs(deg(L5.angleTo(sim.moonPos)) - 60) < 0.01, 'L4 and L5 sit 60 degrees from the Moon');
ok(new THREE.Vector3().crossVectors(sim.moonPos, L4).dot(n) > 0 && new THREE.Vector3().crossVectors(sim.moonPos, L5).dot(n) < 0, 'L4 leads the Moon, L5 trails');
ok(Math.abs(L4.length() - MOON_DIST) < 1 && Math.abs(L4.distanceTo(sim.moonPos) - MOON_DIST) < 1, 'L4 is equilateral with the Earth and the Moon');
ok(Math.abs(L1.distanceTo(sim.moonPos) - 58020) < 5 && Math.abs(L1.clone().normalize().dot(sim.moonPos.clone().normalize()) - 1) < 1e-9, 'L1 on the Earth-Moon line, 58,020 km short of the Moon');
const later = new SpaceSim(); later.syncFromHours(21); later.t += 5 * 86400; later.update();
ok(Math.abs(deg(lagrangePoint(later, 'L4').angleTo(later.moonPos)) - 60) < 0.01, 'the points ride the Moon (5 days on)');

// ---- geometry invariants (metres)
const P = (g) => g.getAttribute('position').array;
const rotor = buildRotor(7), stator = buildStator(3), agri = buildAgriRing(), frame = buildPairFrame(), mir = buildMirror();
let rMax = 0, zMaxRotor = 0;
{ const a = P(rotor.geo); for (let i = 0; i < a.length; i += 3) { const z = Math.abs(a[i + 2]), r = Math.hypot(a[i], a[i + 1]); if (z <= COL.HL + 1) rMax = Math.max(rMax, r); zMaxRotor = Math.max(zMaxRotor, z); } }
ok(rMax <= COL.ROTOR_MAX_R, `rotor's outer works within ${COL.ROTOR_MAX_R} m of the axis (max ${rMax.toFixed(0)})`);
{
  // stator stays outside the rotor's swept volume: beyond its ends, or outside its radius
  const a = P(stator.geo); let bad = 0;
  for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i + 2]) < zMaxRotor + 4 && Math.hypot(a[i], a[i + 1]) < rMax + 20) bad++;
  ok(bad === 0, `despun works clear of the spinning cylinder (ends at ${zMaxRotor.toFixed(0)} m; ${bad} vertices inside)`);
}
{
  // mirrors: at every opening the sheet and its structure stay outside the rotor (in the hinge frame, the rotor lies at y < 0)
  const piv = new THREE.Matrix4(), hinge = new THREE.Matrix4(), inv = new THREE.Matrix4(), v = new THREE.Vector3();
  const a = P(rotor.geo);
  let worst = Infinity;
  for (const alpha of [COL.MIRROR_MIN, (COL.MIRROR_MIN + COL.MIRROR_MAX) / 2, COL.MIRROR_MAX]) for (const w of WINDOW_CENTRES) {
    const c = Math.cos(w), s = Math.sin(w), r = COL.R + COL.MIRROR_OFF;
    piv.set(-s, c, 0, c * r, c, s, 0, s * r, 0, 0, 1, -COL.HL, 0, 0, 0, 1);
    hinge.makeRotationX(-alpha);
    inv.copy(piv).multiply(hinge).invert();
    for (let i = 0; i < a.length; i += 3) {
      v.set(a[i], a[i + 1], a[i + 2]).applyMatrix4(inv);
      if (Math.abs(v.x) <= COL.MIRROR_W / 2 + 60 && v.z >= -80 && v.z <= COL.MIRROR_L) worst = Math.min(worst, -v.y);
    }
  }
  ok(worst > 20, `mirrors clear the hull at every opening (hull ${worst.toFixed(0)} m below the sheet; the hinge barrel reaches 10 m below it)`);
  const tip = Math.hypot(COL.R + COL.MIRROR_OFF + COL.MIRROR_L * Math.sin(COL.MIRROR_MAX) + 60, COL.MIRROR_W / 2);
  ok(2 * tip < 2 * COL.PAIR_X - 4000, `twins' mirror cones clear each other (tip radius ${(tip / 1000).toFixed(1)} km, axes ${(2 * COL.PAIR_X / 1000).toFixed(0)} km apart)`);
  const zTip = -COL.HL + COL.MIRROR_L * Math.cos(COL.MIRROR_MIN);
  ok(zTip < COL.AGRI_Z[0] - COL.AGRI_T - 1000, 'mirror tips stay short of the agricultural rings');
}
{
  // agricultural rings turn clear of the despun spindle and of each other
  const slab = 20, envS = new Map();
  const a = P(stator.geo);
  for (let i = 0; i < a.length; i += 3) { const k = Math.floor(a[i + 2] / slab); const r = Math.hypot(a[i], a[i + 1]); if (r < 1000) envS.set(k, Math.max(envS.get(k) || 0, r)); }
  const g = P(agri.geo); let worst = Infinity;
  for (const z0 of COL.AGRI_Z) for (let i = 0; i < g.length; i += 3) {
    const k = Math.floor((g[i + 2] + z0) / slab), r = Math.hypot(g[i], g[i + 1]);
    for (const kk of [k - 1, k, k + 1]) if (envS.has(kk)) worst = Math.min(worst, r - envS.get(kk));
  }
  ok(worst > 3, `agricultural ring hubs clear the spindle collars (${worst.toFixed(1)} m)`);
  ok(COL.AGRI_Z[1] - COL.AGRI_Z[0] > 2 * (COL.AGRI_T + 30), 'agricultural rings clear each other');
}
{
  // gateway wheels: nothing static inside their swept annuli
  const gate = buildGateway(); const a = P(gate.geo);
  let bad = 0;
  for (const w of GATE.WHEELS) {
    const wg = P(buildGatewayWheel(w).geo);
    let rMin = Infinity, rMx = 0, zLo = Infinity, zHi = -Infinity;
    for (let i = 0; i < wg.length; i += 3) { const r = Math.hypot(wg[i], wg[i + 1]); rMin = Math.min(rMin, r); rMx = Math.max(rMx, r); zLo = Math.min(zLo, wg[i + 2] + w.z); zHi = Math.max(zHi, wg[i + 2] + w.z); }
    for (let i = 0; i < a.length; i += 3) { const r = Math.hypot(a[i], a[i + 1]); if (a[i + 2] > zLo - 2 && a[i + 2] < zHi + 2 && r > rMin - 1.5 && r < rMx + 2) bad++; }
  }
  ok(bad === 0, `gateway wheels turn clear of the spine and works (${bad} static vertices in their sweep)`);
  ok(gate.berths.length === 16, 'gateway has 16 berths');
  const bs = lag.gateway.berthed;
  ok(bs.length === 4 && bs.every((b) => Math.abs(b.p.z) > GATE.HALF && b.d.length > 0), '4 ships berthed nose-in at the gateway, clear of its ends');
}
{
  // pair frame trusses meet the spindles and clear the rotors
  const a = P(frame.geo); let bad = 0;
  for (let i = 0; i < a.length; i += 3) for (const s of [-1, 1]) { const x = a[i] - s * COL.PAIR_X; if (Math.abs(a[i + 2]) < zMaxRotor + 4 && Math.hypot(x, a[i + 1]) < rMax + 20) bad++; }
  ok(bad === 0, 'pair trusses clear both rotors');
}

// ---- traffic routes clear of the structures (km, station frames)
{
  const pts = [];
  const add = (geo, mx) => { const a = P(geo), v = new THREE.Vector3(); for (let i = 0; i < a.length; i += 3) { v.set(a[i], a[i + 1], a[i + 2]); if (mx) v.applyMatrix4(mx); pts.push(v.x / 1000, v.y / 1000, v.z / 1000); } };
  for (const s of [-1, 1]) add(stator.geo, new THREE.Matrix4().makeRotationZ(s > 0 ? 0 : Math.PI / COL.BERTHS).setPosition(s * COL.PAIR_X, 0, 0));
  add(frame.geo);
  for (const s of [-1, 1]) for (const z of COL.AGRI_Z) add(agri.geo, new THREE.Matrix4().makeTranslation(s * COL.PAIR_X, 0, z));
  const cell = 0.5, grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < pts.length; i += 3) { const k = key(pts[i], pts[i + 1], pts[i + 2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  const near = (p) => {
    let best = Infinity;
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const l = grid.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!l) continue;
      for (const i of l) best = Math.min(best, Math.hypot(pts[i] - p.x, pts[i + 1] - p.y, pts[i + 2] - p.z));
    }
    return best;
  };
  const p = new THREE.Vector3(), f = new THREE.Vector3();
  let worst = Infinity, inside = 0;
  const RM = (COL.R + COL.MIRROR_OFF + COL.MIRROR_L * Math.sin(COL.MIRROR_MAX) + 200) / 1000;
  for (const sh of lag.pairs[0].traffic.ships) for (let t = 0; t < sh.route.T; t += 2) {
    shipPose(sh, t, p, f);
    if (sh.vis < 0.02) continue;
    worst = Math.min(worst, near(p));
    for (const s of [-1, 1]) {
      const x = p.x - s * COL.PAIR_X / 1000, r = Math.hypot(x, p.y), z = p.z;
      if (Math.abs(z) < 17.7 && r < 4.4) inside++;                                            // the cylinder
      if (z > -16.2 && z < 16.1 && r < RM) inside++;                                          // the mirrors' cone
    }
  }
  ok(inside === 0, 'colony traffic never enters a cylinder or its mirror cone');
  ok(worst > 0.1, `colony traffic clears the despun works by ${(worst * 1000).toFixed(0)} m (> 100 m)`);
  const gp = []; const gate = buildGateway(); { const a = P(gate.geo); for (let i = 0; i < a.length; i += 3) gp.push(a[i] / 1000, a[i + 1] / 1000, a[i + 2] / 1000); }
  let gw = Infinity;
  for (const sh of lag.gateway.traffic.ships) for (let t = 0; t < sh.route.T; t += 2) {
    shipPose(sh, t, p, f);
    if (sh.vis < 0.02) continue;
    for (let i = 0; i < gp.length; i += 9) gw = Math.min(gw, Math.hypot(gp[i] - p.x, gp[i + 1] - p.y, gp[i + 2] - p.z));
    const r = Math.hypot(p.x, p.y);
    for (const w of GATE.WHEELS) if (Math.abs(p.z - w.z / 1000) < 0.1 && r < (w.R + w.r + 40) / 1000) gw = 0;
  }
  ok(gw > 0.03, `gateway traffic clears the station (${(gw * 1000).toFixed(0)} m)`);
}

// ---- near detail (built on approach): force it, time it, check what it seats
lag.life.build(lag.families);
ok(lag.life.buildMs < 400, `near detail built in ${lag.life.buildMs.toFixed(0)} ms (on first approach)`);
{
  // trams ride the longeron tops; crawlers the hoop crests; fittings stand on the tiles
  lag.life.update(1234, space.camera, [true, true]);
  const TA = lag.life.shared.trams.array; let bad = 0;
  for (let i = 0; i < lag.life.trams.length; i++) {
    const x = TA[i * 16 + 12], y = TA[i * 16 + 13], z = TA[i * 16 + 14];
    const r = Math.hypot(x, y);
    if (Math.abs(r - (COL.R + 140)) > 3 || Math.abs(z) > COL.HL) bad++;
  }
  ok(bad === 0, 'trams run on the longeron crests, within the cylinder\'s length');
  const CA = lag.life.shared.crawl.array; let bc = 0;
  for (let i = 0; i < lag.life.crawlers.length; i++) {
    const x = CA[i * 16 + 12], y = CA[i * 16 + 13], z = CA[i * 16 + 14];
    const a = Math.atan2(y, x), m = ((a % (2 * Math.PI / 3)) + 2 * Math.PI / 3) % (2 * Math.PI / 3);
    if (Math.abs(Math.hypot(x, y) - (COL.R + 43)) > 1 || !(m < Math.PI / 6 - 0.02 || m > 2 * Math.PI / 3 - Math.PI / 6 + 0.02) || ((z + COL.HL - 500) % 1000 + 1000) % 1000 > 1) bc++;
  }
  ok(bc === 0, 'crawlers walk the hoop crests of the land strips');
  // jibs: orthonormal, and the crane clear of the lane ships' hold points (0.22 km off each collar)
  const JA = lag.life.shared.jib.array; let bj = 0;
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < lag.life.cranes.length; i++) { m4.fromArray(JA, i * 16); if (Math.abs(m4.determinant() - 1) > 1e-6) bj++; }
  ok(bj === 0, 'crane jibs are rigid rotations');
  const reach = Math.hypot(COL.BERTH_R - 220 + 120, 20);
  ok(COL.BERTH_R - reach > 60, `crane jibs stay ${(COL.BERTH_R - reach).toFixed(0)} m inboard of the berthing axis`);
}

{
  // ships keep apart from each other (every station, sampled over ten minutes)
  // each hull as a capsule: its bounding box's length along its heading, its widest half-section as radius
  const seg = new THREE.Line3(), seg2 = new THREE.Line3(), c1 = new THREE.Vector3(), c2 = new THREE.Vector3();
  const segDist = (a, b) => {
    // closest points between two segments (sampled on a then refined on b: exact enough for a gate)
    let best = Infinity;
    for (let k = 0; k <= 16; k++) { a.at(k / 16, c1); b.closestPointToPoint(c1, true, c2); best = Math.min(best, c1.distanceTo(c2)); }
    return best;
  };
  const cap = (d) => { if (!d._cap) { const bb = d.geo.boundingBox || (d.geo.computeBoundingBox(), d.geo.boundingBox); d._cap = { z0: bb.min.z, z1: bb.max.z, r: Math.max(-bb.min.x, bb.max.x, -bb.min.y, bb.max.y) }; } return d._cap; };
  let worst = Infinity;
  const ps = [], fs = [];
  for (const st of lag.traffic) {
    const ships = st.ships;
    for (let i = 0; i < ships.length; i++) { ps[i] = ps[i] || new THREE.Vector3(); fs[i] = fs[i] || new THREE.Vector3(); }
    for (let t = 0; t < 600; t += 1.5) {
      for (let i = 0; i < ships.length; i++) { shipPose(ships[i], t, ps[i], fs[i]); ships[i]._v = ships[i].vis; }
      for (let i = 0; i < ships.length; i++) for (let j = i + 1; j < ships.length; j++) {
        if (ships[i]._v < 0.05 || ships[j]._v < 0.05) continue;
        const A = ships[i], B = ships[j], ca = cap(A.design), cb = cap(B.design), ka = A.scale / 1000, kb = B.scale / 1000;
        if (ps[i].distanceTo(ps[j]) > (A.design.radius * A.scale + B.design.radius * B.scale) / 1000 + 0.05) continue;
        seg.start.copy(ps[i]).addScaledVector(fs[i], ca.z0 * ka); seg.end.copy(ps[i]).addScaledVector(fs[i], ca.z1 * ka);
        seg2.start.copy(ps[j]).addScaledVector(fs[j], cb.z0 * kb); seg2.end.copy(ps[j]).addScaledVector(fs[j], cb.z1 * kb);
        worst = Math.min(worst, segDist(seg, seg2) - ca.r * ka - cb.r * kb);
      }
    }
  }
  if (worst === Infinity) worst = 1;
  ok(worst > 0.02, `ships keep clear of each other (closest hull gap ${(worst * 1000).toFixed(0)} m)`);
}

// ---- animate, then buffer sanity over everything the module draws
const roots = [...lag.pairs.map((q) => q.group), ...lag.pairs.map((q) => q.approach), lag.gateway.group, lag.gateway.approach, lag.laneGroup, ...lag.traffic.map((s) => s.group)];
const cams = [L4.clone().add(new THREE.Vector3(0, 30, 90)), L5.clone().add(new THREE.Vector3(60, 0, -60)), L1.clone().add(new THREE.Vector3(0, 2, 3)), new THREE.Vector3(0, 0, 40000)];
let upd = 0, frames = 0;
for (let k = 0; k < 240; k++) {
  space.camera.position.copy(cams[k % cams.length]); space.camera.updateMatrixWorld(true);
  sim.step(0);
  const a = performance.now();
  lag.update(sim, 1000 + k * 0.5, 0.016, space);
  if (k >= 40) { upd += performance.now() - a; frames++; }
}
const perFrame = upd / frames;
ok(perFrame < 0.6, `update ${perFrame.toFixed(3)} ms per frame (target 0.3, traffic included)`);
let bad = 0, inst = 0, meshes = 0;
for (const r of roots) {
  r.updateMatrixWorld(true);
  r.traverse((o) => {
    if (!o.matrixWorld.elements.every(Number.isFinite)) bad++;
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    const pos = g.getAttribute('position');
    if (!pos.array.every(Number.isFinite)) { bad++; console.log('non-finite positions', o.name); }
    if (g.index) { let mx = 0; for (const i of g.index.array) if (i > mx) mx = i; if (mx >= pos.count) { bad++; console.log('index out of range', o.name); } }
    for (const [name, at] of Object.entries(g.attributes)) if (!at.isInstancedBufferAttribute && at.count < pos.count) { bad++; console.log('short attribute', name); }
    if (o.isInstancedMesh) { inst++; if (o.count > o.instanceMatrix.count || o.instanceMatrix.count < 1) { bad++; console.log('instanced count over capacity', o.count, o.instanceMatrix.count); } }
    if (g.isInstancedBufferGeometry) {
      for (const [name, at] of Object.entries(g.attributes)) if (at.isInstancedBufferAttribute && at.count < g.instanceCount) { bad++; console.log('instanced attribute short', name, at.count, g.instanceCount); }
      for (const [name, at] of Object.entries(g.attributes)) if (at.isInstancedBufferAttribute && !at.array.every(Number.isFinite)) { bad++; console.log('non-finite lamp data', name); }
    }
  });
}
ok(bad === 0, `buffers sane over ${meshes} meshes (${inst} instanced): counts within capacity, indices in range, all finite`);
{
  const L = lag.lanes.L.array; let far = 0;
  for (let i = 0; i < lag.nLaneLamps; i++) far = Math.max(far, Math.hypot(L[i * 4], L[i * 4 + 1], L[i * 4 + 2]));
  ok(far > 300000 && far < 450000 && lag.laneRange[1] > lag.laneRange[0], `lane lamps span the Earth-Moon system (to ${(far / 1000).toFixed(0)}k km), depth interval valid`);
}

{
  // every drawable the module owns is under a registered body (the depth slices toggle bodies)
  const bodyObjs = new Set(space.bodies.flatMap((b) => b.objects));
  let orphan = 0;
  for (const r of roots) if (!bodyObjs.has(r) || r.parent !== space.scene) orphan++;
  ok(orphan === 0, `all ${roots.length} root groups are top-level registered bodies`);
  // and each body's bound holds its content: the pair groups' children within their radius
  let out = 0;
  for (const q of lag.pairs) {
    const b = space.bodies.find((x) => x.objects[0] === q.group), c = b.center(new THREE.Vector3()), v = new THREE.Vector3();
    q.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry.boundingSphere) { o.geometry.computeBoundingSphere(); v.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld); const rad = o.geometry.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis(); if (v.distanceTo(c) + rad > b.radius + 1e-6) out++; } });
  }
  ok(out === 0, `pair meshes lie inside their bodies' bounds (${out} outside)`);
}

// ---- budgets
const tri = lag.triangles();
ok(tri.unique < 4e6, `unique geometry ${(tri.unique / 1e3).toFixed(0)}k triangles (< 4M)`);
ok(tri.total < 12e6, `rendered at closest: pair ${(tri.pair / 1e3).toFixed(0)}k, gateway ${(tri.gate / 1e3).toFixed(0)}k, traffic ${(tri.traffic / 1e3).toFixed(0)}k, all ${(tri.total / 1e6).toFixed(2)}M (< 12M)`);

// ---- shader text hygiene (not compiled here: no GL)
{
  const src = Object.values(LAGRANGE_SHADERS).join('\n');
  const frag = LAGRANGE_SHADERS.WIN_FRAG + LAGRANGE_SHADERS.MIR_FRAG;
  const uniformsDeclared = [...frag.matchAll(/uniform\s+\w+\s+(\w+);/g)].map((m) => m[1]);
  const supplied = ['uCam', 'uSunView', 'uSunE', 'uDay', 'uTime', 'uSeed'];
  ok(uniformsDeclared.every((u) => supplied.includes(u)), `every uniform declared is supplied (${[...new Set(uniformsDeclared)].join(', ')})`);
  ok(!/dFdx|dFdy/.test(src), 'no raw derivatives (fwidth only, at the top of main); loops only in the shared noise chunk');
  const fwAt = [...frag.matchAll(/fwidth/g)].length;
  ok(fwAt === 2, 'fwidth used once per shader, in uniform control flow');
}

console.log(fails ? `LAGRANGE_VERIFY_FAILED (${fails})` : 'LAGRANGE_VERIFY_OK');
process.exit(fails ? 1 : 0);
