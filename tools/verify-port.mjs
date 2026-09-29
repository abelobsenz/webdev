// Invariants of the geostationary belt and the dressed hulls (src/space/geoBelt.js,
// beltStations.js, craftMesh.js dressed kinds, shipDesigns.js). Headless; run from the repo root:
//   node tools/verify-port.mjs
import * as THREE from 'three';
import { SpaceSim, R_EARTH, GEO_ALT, MERIDIAN_LON, bodyDir } from '../src/space/sim.js';
import { GeoBelt, beltLayout, beltPlace, courierLeg, BUILD_RANGE } from '../src/space/geoBelt.js';
import { buildBeltStation, BUILDERS } from '../src/space/beltStations.js';
import { buildFittings } from '../src/space/beltLife.js';
import { createDressedMaterial, DRESS_GLSL, KM } from '../src/space/craftMesh.js';
import { shipPose } from '../src/space/fleetTraffic.js';
import { DESIGNS, design } from '../src/space/shipDesigns.js';

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const out = {};

// ------------------------------------------------------------ shader text ----
{
  const m = createDressedMaterial({});
  const fs = m.fragmentShader;
  const body = DRESS_GLSL;
  let depth = 0, pd = 0;
  for (const ch of body) { if (ch === '{') depth++; if (ch === '}') depth--; if (ch === '(') pd++; if (ch === ')') pd--; check(depth >= 0 && pd >= 0, 'dress GLSL: unbalanced'); }
  check(depth === 0 && pd === 0, 'dress GLSL: braces/parens unbalanced');
  check(!/\bpow\s*\(/.test(body), 'dress GLSL: pow() used');
  check(!/\b(fwidth|dFdx|dFdy|texture)\s*\(/.test(body), 'dress GLSL: derivatives or texture reads in the kinds');
  // every numeric literal a float (GLSL ES 3.0 has no implicit int -> float)
  const code = body.replace(/\/\/.*$/gm, '');
  const ints = code.match(/(?<![\w.])\d+(?![\w.])/g) || [];
  check(ints.length === 0, `dress GLSL: integer literals ${ints.slice(0, 5)}`);
  for (const fn of ['hash12', 'vnoise', 'gridLine', 'cLine']) check(new RegExp(`float ${fn}\\(`).test(fs), `dress GLSL: ${fn} not defined in the craft shader`);
  check(fs.indexOf('float beltGlyph(') < fs.indexOf('void beltKinds('), 'dress GLSL: glyph after use');
  const iMain = fs.lastIndexOf('void main() {'), iCall = fs.indexOf('beltKinds(k, f, fw, px, alb, rough, metal, em, bump);'), iBump = fs.indexOf('N = normalize(N + T * bump.x');
  check(iMain > fs.indexOf('void beltKinds(') && iCall > iMain && iCall < iBump && fs.indexOf('vec2 bump') < iCall, 'dress GLSL: splice order in main');
  for (const u of ['uLivery', 'uLivery2', 'uLit', 'uTime']) {
    check((fs.match(new RegExp(`uniform vec3 ${u};|uniform float ${u};`, 'g')) || []).length === 1, `uniform ${u} declared once`);
    check(m.uniforms[u] && m.uniforms[u].value !== undefined, `uniform ${u} supplied`);
  }
  out.dressedFragChars = fs.length;
}

// ---------------------------------------------------------------- scene ----
const sim = new SpaceSim();
sim.syncFromHours(12);
sim.step(0);
const space = {
  scene: new THREE.Scene(), earthFixed: new THREE.Group(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e7), size: new THREE.Vector2(1280, 720), sim,
  addBody(name, objects, center, radius, opts) { const b = { name, objects, center, radius, ...opts }; this.bodies.push(b); return b; },
};
space.scene.add(space.earthFixed);
space.earthFixed.quaternion.copy(sim.earthQuat);
let t0 = performance.now();
const belt = new GeoBelt(space);
out.constructMs = +(performance.now() - t0).toFixed(1);
check(out.constructMs < 150, `construct ${out.constructMs} ms`);

// ---------------------------------------------------------------- layout ----
const lay = beltLayout();
out.stations = lay.length;
check(lay.length >= 30, 'fewer than 30 stations');
const kinds = new Set(lay.map((s) => s.kind));
check(kinds.size === Object.keys(BUILDERS).length, 'not every kind on the belt');
out.kinds = Object.fromEntries([...kinds].map((k) => [k, lay.filter((s) => s.kind === k).length]));
const P = lay.map((s) => beltPlace(s).pos.clone());
const harbour = bodyDir(0, MERIDIAN_LON).multiplyScalar(R_EARTH + GEO_ALT);
let minSep = Infinity, minHarbour = Infinity, maxAltErr = 0;
for (let i = 0; i < P.length; i++) {
  minHarbour = Math.min(minHarbour, P[i].distanceTo(harbour));
  maxAltErr = Math.max(maxAltErr, Math.abs(P[i].length() - (R_EARTH + GEO_ALT)));
  for (let j = i + 1; j < P.length; j++) minSep = Math.min(minSep, P[i].distanceTo(P[j]));
}
out.minStationSepKm = +minSep.toFixed(1);
out.minHarbourKm = Math.round(minHarbour);
out.maxAltOffsetKm = +maxAltErr.toFixed(1);
check(minSep > 15, 'stations too close');
check(minHarbour > 1500, 'a station inside the Harbour neighbourhood');
check(maxAltErr < 60, 'a station off the belt');

// ------------------------------------------------------------ build all ----
t0 = performance.now();
belt.buildAll();
out.buildAllMs = +(performance.now() - t0).toFixed(1);
out.uniqueTriangles = belt.triangles();
check(out.uniqueTriangles < 4e6, 'unique triangles over 4M');
let worstBuild = 0;
for (const st of belt.stations) worstBuild = Math.max(worstBuild, st.built.data.buildMs);
out.worstStationBuildMs = +worstBuild.toFixed(1);
check(worstBuild < 120, 'a station build over 120 ms (built on approach, one per frame)');

// ------------------------------------------------------ geometry sanity ----
const _ray = new THREE.Raycaster();
const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
let docks = 0, blocked = [], spinViolations = 0, minRayMargin = Infinity;
let mooredHits = 0, mooredCount = 0; const mooredWhere = [];
for (const st of belt.stations) {
  const d = st.built.data;
  const test = [new THREE.Mesh(d.geo, mat)];
  for (const p of d.parts) {
    const m = new THREE.Mesh(p.geo, mat);
    m.position.copy(p.pivot); m.quaternion.copy(p.q); m.updateMatrixWorld(true);
    test.push(m);
  }
  test[0].updateMatrixWorld(true);
  // held ships: their hulls clear of the station's structure (bar the collar they lie against)
  const mooredMeshes = [];
  for (const mo of d.moored) {
    const des = design(mo.cls, mo.seed), bb = des.geo.boundingBox;
    const x = new THREE.Vector3().crossVectors(mo.up, mo.fwd).normalize(), y = new THREE.Vector3().crossVectors(mo.fwd, x);
    const M = new THREE.Matrix4().makeBasis(x, y, mo.fwd).setPosition(mo.pos), inv = M.clone().invert();
    const mm = new THREE.Mesh(des.geo, mat); mm.matrixAutoUpdate = false; mm.matrix.copy(M); mm.matrixWorld.copy(M);
    mooredMeshes.push({ mm, inv, bb, mo });
  }
  {
    const pos = d.geo.attributes.position.array, v = new THREE.Vector3();
    for (const { inv, bb, mo } of mooredMeshes) {
      let inside = 0;
      for (let i = 0; i < pos.length; i += 3) {
        v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(inv);
        // inside the hull's box, shrunk 1 m, away from the bow (where the collar holds her)
        if (v.x > bb.min.x + 1 && v.x < bb.max.x - 1 && v.y > bb.min.y + 1 && v.y < bb.max.y - 1 && v.z > bb.min.z + 1 && v.z < bb.max.z - 6) inside++;
      }
      mooredHits += inside ? 1 : 0;
      if (inside) mooredWhere.push(`${st.desc.name}(${st.desc.kind}) ${mo.cls}:${mo.seed} ${inside} vertices`);
      mooredCount++;
    }
    for (let i = 0; i < mooredMeshes.length; i++) for (let j = i + 1; j < mooredMeshes.length; j++) {
      const A = mooredMeshes[i], Bm = mooredMeshes[j];
      const ba = A.bb.clone().applyMatrix4(A.mm.matrix), bbx = Bm.bb.clone().applyMatrix4(Bm.mm.matrix);
      if (ba.intersectsBox(bbx)) {
        // world boxes overlap: check the actual vertices of one inside the other's hull box
        const pa = A.mm.geometry.attributes.position.array, w = new THREE.Vector3();
        let n = 0;
        for (let k = 0; k < pa.length; k += 9) { w.set(pa[k], pa[k + 1], pa[k + 2]).applyMatrix4(A.mm.matrix).applyMatrix4(Bm.inv); if (Bm.bb.containsPoint(w)) n++; }
        if (n) mooredWhere.push(`${st.desc.name} moored ${i}/${j} overlap ${n}`), mooredHits++;
      }
    }
  }
  for (const m of mooredMeshes) test.push(m.mm);
  // berths: a clear approach down the axis from far out to the collar
  for (const k of d.docks) {
    docks++;
    const L = d.radius * 2 + 60;
    const from = k.p.clone().addScaledVector(k.d, L);
    _ray.set(from, k.d.clone().negate());
    _ray.far = L + 5;
    const hit = _ray.intersectObjects(test, false)[0];
    const margin = hit ? hit.distance - (L - 12) : 99;
    minRayMargin = Math.min(minRayMargin, margin);
    if (margin < 0) blocked.push(`${st.desc.name}(${st.desc.kind}) dock ${d.docks.indexOf(k)} hit at ${(L - hit.distance).toFixed(1)} m out`);
  }
  // spinning parts sweep clear of the static structure (outside the bearing)
  const pos = d.geo.attributes.position.array;
  for (const p of d.parts) {
    if (p.mode !== 'spin') continue;
    const inv = p.q.clone().invert();
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 3) {
      v.set(pos[i], pos[i + 1], pos[i + 2]).sub(p.pivot).applyQuaternion(inv);
      const rr = Math.hypot(v.x, v.y);
      if (rr > p.hub + 1 && rr < p.radius && Math.abs(v.z) < p.halfW) spinViolations++;
    }
  }
  // buffers: finite positions, indices in range
  for (const g of [d.geo, ...d.parts.map((p) => p.geo)]) {
    const a = g.attributes.position.array;
    check(a.every(Number.isFinite), `${st.desc.name}: non-finite position`);
    let mx = 0; for (const x of g.index.array) if (x > mx) mx = x;
    check(mx < g.attributes.position.count, `${st.desc.name}: index out of range`);
    check(g.attributes.aFacade && g.attributes.aFacade.count === g.attributes.position.count, `${st.desc.name}: facade attribute size`);
  }
}
// the stations' life: pilots' corridors beside the berths, crews on their decks, patrols outside
{
  let pilotBlocked = [], walkBad = [], walkClearBad = [], patrolBad = 0, walks = 0, pilots = 0, suits = 0, drones = 0;
  for (const st of belt.stations) {
    const d = st.built.data, life = st.built.life;
    const test = [new THREE.Mesh(d.geo, mat)];
    test[0].updateMatrixWorld(true);
    for (const p of d.parts) { const m = new THREE.Mesh(p.geo, mat); m.position.copy(p.pivot); m.quaternion.copy(p.q); m.updateMatrixWorld(true); test.push(m); }
    for (const pd of life.pilots) {
      pilots++;
      const a = pd.dock.p.clone().add(pd.dock.side).addScaledVector(pd.dock.d, 8), b = pd.dock.p.clone().add(pd.dock.side).addScaledVector(pd.dock.d, pd.dock.reach);
      _ray.set(a, b.clone().sub(a).normalize()); _ray.far = a.distanceTo(b);
      if (_ray.intersectObjects(test, false).length) pilotBlocked.push(`${st.desc.name}(${st.desc.kind})`);
    }
    for (const pa of life.patrols) if (pa.rad - pa.bob < d.radius + 5) patrolBad++;
    for (const w of d.walks || []) {
      walks++;
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        const p = w.a.clone().lerp(w.b, u);
        _ray.set(p.clone().addScaledVector(w.up, 0.5), w.up.clone().negate()); _ray.far = 1.5;
        const h = _ray.intersectObjects(test, false)[0];
        if (!h || Math.abs(h.distance - 0.5) > 0.25) walkBad.push(`${st.desc.name} u=${u} ${h ? (h.distance - 0.5).toFixed(2) : 'none'}`);
      }
      for (const hgt of [0.4, 1.0, 1.7]) {
        const a = w.a.clone().addScaledVector(w.up, hgt), b = w.b.clone().addScaledVector(w.up, hgt);
        _ray.set(a, b.clone().sub(a).normalize()); _ray.far = a.distanceTo(b);
        const hit = _ray.intersectObjects(test, false)[0];
        if (hit) walkClearBad.push(`${st.desc.name}(${st.desc.kind}) h=${hgt} at ${hit.distance.toFixed(1)}/${_ray.far.toFixed(0)}`);
      }
    }
    const c = life.counts();
    suits += c.suits; drones += c.drones;
    check(c.suits === life.walkers.length && c.drones === life.pilots.length + life.patrols.length, 'life instance counts');
  }
  out.life = { pilots, walks, suits, drones };
  check(pilotBlocked.length === 0, `pilot corridors blocked: ${pilotBlocked.slice(0, 5).join(', ')}`);
  check(patrolBad === 0, 'patrol circuit inside a station');
  check(walkBad.length === 0, `crews not on their decks: ${walkBad.slice(0, 4).join('; ')}`);
  check(walkClearBad.length === 0, `crew walks obstructed: ${walkClearBad.slice(0, 4).join('; ')}`);
}
out.docks = docks;
// near-detail fittings: capacity, clear of sweeps, berths and walks, inside the station
{
  const t1 = performance.now();
  let worst = 0, total = 0, tris = 0, bad = [], maxTris = 0;
  for (const st of belt.stations) {
    const a0 = performance.now();
    const f = buildFittings(st.built.mesh, st.built.data, st.desc.id + 3);
    st.built.fit = f;
    worst = Math.max(worst, performance.now() - a0);
    total += f.count; tris += f.triangles; maxTris = Math.max(maxTris, f.triangles);
    const d = st.built.data, p = new THREE.Vector3(), q = new THREE.Vector3(), e = new THREE.Vector3();
    for (const im of f.meshes) check(im.count <= im.instanceMatrix.count, 'fitting capacity');
    for (const list of f.mats) for (const M of list) {
      p.setFromMatrixPosition(M);
      if (!Number.isFinite(p.x)) bad.push('nan');
      if (p.length() > d.radius + 1) bad.push(`${st.desc.name} outside`);
      for (const s of d.parts) if (s.mode === 'spin') {
        q.copy(p).sub(s.pivot).applyQuaternion(s.q.clone().invert());
        const rr = Math.hypot(q.x, q.y);
        if (rr > s.hub - 5 && rr < s.radius + 5 && Math.abs(q.z) < s.halfW + 5) bad.push(`${st.desc.name} in sweep`);
      }
      for (const k of d.docks) if (p.distanceTo(k.p) < 20) bad.push(`${st.desc.name} on a berth`);
      for (const w of d.walks || []) {
        const L2 = w.a.distanceToSquared(w.b);
        const u = THREE.MathUtils.clamp(q.subVectors(p, w.a).dot(e.subVectors(w.b, w.a)) / L2, 0, 1);
        if (q.copy(w.a).lerp(w.b, u).distanceTo(p) < 3.5) bad.push(`${st.desc.name} on a walk`);
      }
    }
  }
  out.fittings = { count: total, triangles: tris, maxStationTriangles: maxTris, worstBuildMs: +worst.toFixed(1), allMs: +(performance.now() - t1).toFixed(0) };
  check(bad.length === 0, `fittings misplaced: ${bad.slice(0, 5).join('; ')}`);
  check(worst < 60, 'fitting scatter over 60 ms for one station');
  check(total > 15000, 'too few fittings');
}

out.mooredShips = mooredCount;
check(mooredHits === 0, `held ships intersect: ${mooredWhere.slice(0, 5).join("; ")}`);
out.minDockApproachMarginM = +minRayMargin.toFixed(1);
check(blocked.length === 0, `blocked berths: ${blocked.slice(0, 6).join('; ')}`);
out.spinSweepViolations = spinViolations;
check(spinViolations === 0, 'static structure inside a spinning part\'s sweep');

// ------------------------------------------------------- traffic poses ----
// ships as capsules (hull axis and half-breadth from the design's box), km
function segDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  const c = d1.dot(r), b = d1.dot(d2), den = a * e - b * b;
  s = den > 1e-12 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
  t = (b * s + f) / e;
  if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}
let minShipSep = Infinity, worstPair = '', dockErr = 0, maxShipDist = 0, samples = 0;
for (const st of belt.stations) {
  const tr = st.traffic;
  if (!tr) continue;
  const T = Math.max(...tr.ships.map((s) => s.route.T));
  const cap = tr.ships.map((sh) => {
    const bb = sh.design.geo.boundingBox, k = sh.scale * KM;
    return { p: new THREE.Vector3(), f: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), z0: bb.min.z * k, z1: bb.max.z * k, r: Math.max(bb.max.x, -bb.min.x, bb.max.y, -bb.min.y) * k };
  });
  for (let t = 0; t < T; t += 4) {
    tr.ships.forEach((sh, i) => {
      const c = cap[i];
      shipPose(sh, t, c.p, c.f); samples++;
      maxShipDist = Math.max(maxShipDist, c.p.length());
      check(Number.isFinite(c.p.x), 'ship pose non-finite');
      c.a.copy(c.p).addScaledVector(c.f, c.z0); c.b.copy(c.p).addScaledVector(c.f, c.z1); c.vis = sh.vis;
    });
    for (let i = 0; i < cap.length; i++) for (let j = i + 1; j < cap.length; j++) {
      if (cap[i].vis <= 0.01 || cap[j].vis <= 0.01) continue;
      const gap = segDist(cap[i].a, cap[i].b, cap[j].a, cap[j].b) - cap[i].r - cap[j].r;
      if (gap < minShipSep) { minShipSep = gap; worstPair = `${st.desc.name} ${i}/${j} t=${t}`; }
    }
  }
  // lying alongside: the bow at the collar face
  for (const sh of tr.ships) {
    const stop = sh.route.stop, face = sh.route.dock.p.clone().multiplyScalar(KM);
    const bow = (sh.design.bow * sh.scale + 3) * KM;
    dockErr = Math.max(dockErr, Math.abs(stop.distanceTo(face) - bow));
    // the whole berthed hull lies outside the station's structure along the axis (bow clearance >= 2 m)
    check(bow > 0.002, 'berth stop inside the collar');
  }
}
out.trafficSamples = samples;
out.minHullGapM = +(minShipSep * 1000).toFixed(1);
out.dockStopErrM = +(dockErr * 1000).toFixed(2);
check(minShipSep > 0.01, `belt traffic hulls within 10 m: ${worstPair}`);
check(dockErr < 1e-6, 'berth stop not at the collar');
check(maxShipDist < 40, 'belt traffic strays too far from its station');

// ------------------------------------------------------------ couriers ----
{
  let prev = courierLeg(0)[0], mono = true;
  for (let u = 0.001; u <= 1; u += 0.001) { const s = courierLeg(u)[0]; if (s < prev - 1e-9) mono = false; prev = s; }
  check(mono && Math.abs(courierLeg(1)[0] - 1) < 1e-6 && Math.abs(courierLeg(0)[0]) < 1e-9, 'courier leg profile');
}

{
  // lane buoys and courier lamps: finite, on their lanes
  const L = belt.lights.L.array;
  let off = 0;
  for (let i = 0; i < belt.nBuoys; i++) { const k = (belt.buoy0 + i) * 4; off = Math.max(off, Math.abs(Math.abs(Math.hypot(L[k], L[k + 1], L[k + 2]) - (R_EARTH + GEO_ALT)) - 32)); }
  out.buoys = belt.nBuoys;
  check(belt.nBuoys > 600 && off < 0.01, 'lane buoys');
  let worst = 0;
  for (let t = 0; t < 3000; t += 7) {
    belt._couriers(t);
    for (let i = 0; i < belt.couriers.length; i++) { const k = (belt.courier0 + i * 2) * 4; const rr = Math.hypot(L[k], L[k + 1], L[k + 2]); check(Number.isFinite(rr), 'courier non-finite'); worst = Math.max(worst, Math.abs(rr - (R_EARTH + GEO_ALT))); }
  }
  out.courierMaxRadialKm = +worst.toFixed(1);
  check(worst < 40, 'couriers off their lanes');
}
// ------------------------------------------------- updates and buffers ----
const st0 = belt.stations.find((s) => s.desc.kind === 'habitat');
const camAt = (st, dKm) => { belt._place(st, sim.earthQuat); space.camera.position.copy(st.world).add(new THREE.Vector3(dKm, dKm * 0.3, dKm * 0.5)); space.camera.updateMatrixWorld(true); };
const timeUpdates = (n) => { const a = performance.now(); for (let i = 0; i < n; i++) belt.update(sim, 1000 + i * 0.016, 0.016, space); return (performance.now() - a) / n; };
camAt(st0, 2);
timeUpdates(50);
out.updateNearMs = +timeUpdates(400).toFixed(4);
camAt(st0, 80000);
timeUpdates(20);
out.updateFarMs = +timeUpdates(400).toFixed(4);
check(out.updateNearMs < 0.3, `update near ${out.updateNearMs} ms`);
check(out.updateFarMs < 0.3, `update far ${out.updateFarMs} ms`);
// far: every station let go beyond the drop range is dropped again, the body hidden
out.builtWhenFar = belt.stations.filter((s) => s.built).length;
camAt(st0, 2);
for (let i = 0; i < 40; i++) belt.update(sim, 2000 + i, 0.016, space);
check(st0.built && st0.body.visible, 'near station not rebuilt/visible');
check(belt.stations.every((s) => s.dist < BUILD_RANGE || !s.built || s.dist < 40000), 'station kept beyond drop range');
belt.buildAll();
for (const t of [0, 300, 900, 1700]) belt.update(sim, t, 0.016, space);
space.scene.updateMatrixWorld(true);
let inst = 0, badInst = 0, badIdx = 0, nonFinite = 0;
space.scene.traverse((o) => {
  if (!o.matrixWorld.elements.every(Number.isFinite)) nonFinite++;
  if (!o.isMesh) return;
  const g = o.geometry;
  if (o.isInstancedMesh) { inst++; if (!(o.count <= o.instanceMatrix.count)) badInst++; }
  if (g.isInstancedBufferGeometry) {
    for (const a of Object.values(g.attributes)) if (a.isInstancedBufferAttribute && g.instanceCount > a.count) badInst++;
  }
  if (g.index && g.attributes.position) {
    let mx = 0; const ia = g.index.array; for (let i = 0; i < ia.length; i++) if (ia[i] > mx) mx = ia[i];
    if (mx >= g.attributes.position.count) badIdx++;
  }
});
out.instancedMeshes = inst;
check(badInst === 0, `${badInst} instanced buffers undersized`);
check(badIdx === 0, `${badIdx} index buffers out of range`);
check(nonFinite === 0, `${nonFinite} non-finite transforms`);
// the dressed traffic designs still build and carry dressed kinds
{
  let dressed = 0;
  for (const k of Object.keys(DESIGNS)) { const d = design(k, 1); const f = d.geo.attributes.aFacade.array; for (let i = 2; i < f.length; i += 3) if (f[i] > 19.5) { dressed++; break; } }
  out.dressedDesigns = dressed;
  check(dressed >= 6, 'ship designs not dressed');
}
// rendered triangles at the closest approach: the station, its traffic's hulls
{
  const st = st0;
  let tri = st.built.data.tris;
  for (const s of st.traffic.sets) tri += (s.design.geo.index.count / 3) * s.n;
  out.nearViewTriangles = tri;
}
console.log(JSON.stringify(out));
if (fail.length) { console.error('FAIL:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('PORT_VERIFIED');
