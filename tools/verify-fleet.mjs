// Ships and traffic: the working fleet's designs, routes, clearances, separations, lamps and
// costs, all headless. Run from the repo root: node tools/verify-fleet.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SpaceSim, R_EARTH, R_MOON } from '../src/space/sim.js';
import { Elevator } from '../src/space/elevator.js';
import { Hearth } from '../src/space/hearth.js';
import { Moon } from '../src/space/moon.js';
import { Fleet, voyage } from '../src/space/fleet.js';
import { WorkingStations } from '../src/space/workingStations.js';
import { GeoRoads } from '../src/space/geoRoads.js';
import { Lanes } from '../src/space/lanes.js';
import { ReleaseYard } from '../src/space/releaseYard.js';
import { DESIGNS } from '../src/space/shipDesigns.js';
import { shipPose, routePos, HULL_RANGE } from '../src/space/fleetTraffic.js';
import { KM } from '../src/space/craftMesh.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const out = {};

// ---- 1. designs: every class and seed builds finite, closed-enough geometry within its budget
{
  const t0 = performance.now();
  for (const [name, build] of Object.entries(DESIGNS)) for (const seed of [1, 2, 3, 5, 8]) {
    const d = build(seed);
    const p = d.geo.attributes.position.array;
    for (let i = 0; i < p.length; i++) assert.ok(Number.isFinite(p[i]), `${name}#${seed} vertex finite`);
    const tris = d.geo.index.count / 3;
    assert.ok(tris > 2500 && tris < 60000, `${name}#${seed} triangles ${tris} within 2.5k..60k`);
    assert.ok(d.geo.attributes.aFacade && d.geo.attributes.normal, `${name}#${seed} carries facade kinds and normals`);
    assert.ok(d.glows.length >= 2, `${name}#${seed} has drive glows`);
    assert.ok(d.rcs.length >= 16, `${name}#${seed} has RCS nozzles (${d.rcs.length})`);
    assert.ok(d.lamps.length >= 6, `${name}#${seed} shows lamps`);
    // navigation set: one red and one green, facing outboard to port and starboard
    const red = d.lamps.filter((l) => l.color[0] > 0.9 && l.color[1] < 0.3 && l.dir), green = d.lamps.filter((l) => l.color[1] > 0.9 && l.color[0] < 0.3 && l.dir);
    assert.ok(red.some((l) => l.p.x > 0 && l.dir.x > 0) && green.some((l) => l.p.x < 0 && l.dir.x < 0), `${name}#${seed} red to port (+x), green to starboard`);
    // every lamp, nozzle and glow sits on the hull's own bounds (no stray fittings)
    const box = d.geo.boundingBox.clone().expandByScalar(3);
    for (const l of d.lamps) assert.ok(box.containsPoint(l.p) && l.r > 0, `${name}#${seed} lamp on the hull`);
    for (const n of d.rcs) { assert.ok(box.containsPoint(n.p), `${name}#${seed} nozzle on the hull`); assert.ok(Math.abs(n.dir.length() - 1) < 1e-6); }
    for (const g of d.glows) assert.ok(box.containsPoint(g.p) && g.dir.z < -0.99, `${name}#${seed} bells open aft`);
    // the drive is aft: every glow behind the ship's centre of volume
    const c = d.geo.boundingBox.getCenter(V());
    for (const g of d.glows) assert.ok(g.p.z < c.z, `${name}#${seed} drive aft of centre`);
  }
  out.designBuildMs = +(performance.now() - t0).toFixed(1);
}

// ---- 2. the real scene (as the space mode assembles it)
const sim = new SpaceSim();
sim.syncFromHours(12);
const space = {
  scene: new THREE.Scene(), earthFixed: new THREE.Group(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e7), size: new THREE.Vector2(1280, 720), sim,
  addBody(name, objects, center, radius, opts) { const b = { name, objects, center, radius, ...opts }; this.bodies.push(b); return b; },
};
space.scene.add(space.earthFixed);
space.elevator = new Elevator(space, { climbers: 60 });
space.earthFixed.add(space.elevator.group);
space.hearth = new Hearth(space, { bhSteps: 110, bhScale: 0.6 });
space.moon = new Moon(space);
space.scene.add(space.moon.group);
let t0 = performance.now();
space.fleet = new Fleet(space);
const fleetMs = performance.now() - t0;
space.works = new WorkingStations(space);
space.geoRoads = new GeoRoads(space);
space.lanes = new Lanes(space);
space.releaseYard = new ReleaseYard(space);
const fleet = space.fleet, traffic = fleet.traffic;
t0 = performance.now();
{ const { FleetTraffic } = await import('../src/space/fleetTraffic.js'); new FleetTraffic({ ...space, scene: new THREE.Scene(), addBody() { return {}; } }, fleet); }
out.trafficBuildMs = +(performance.now() - t0).toFixed(1);
assert.ok(out.trafficBuildMs < 600, `working lanes build in ${out.trafficBuildMs} ms`);
out.fleetBuildMs = +fleetMs.toFixed(1);
const frame = (t) => {
  sim.step(0);
  space.earthFixed.quaternion.copy(sim.earthQuat); space.earthFixed.updateMatrixWorld(true);
  space.elevator.update(sim, t, 0.016, space);
  space.moon.update(sim, t);
  for (const m of [space.fleet, space.works, space.geoRoads, space.lanes, space.releaseYard]) m.update(sim, t, 0.016, space);
  space.scene.updateMatrixWorld(true);
};
frame(0);
assert.ok(!fleet.linerDetail, 'liner detail is not built while every camera is far off');

// ---- 3. routes: continuous, finite, speeds a torch-drive era allows; no gaps at leg joins
const stations = traffic.stations;
let ships = 0;
for (const st of stations) for (const sh of st.ships) {
  ships++;
  const R = sh.route, p = V(), q = V(), f = V(), u = V();
  let prev = null, vmax = 0;
  for (let t = 0; t <= R.T; t += 0.5) {
    shipPose(sh, t, p, f, u);
    assert.ok(Number.isFinite(p.x + p.y + p.z) && Math.abs(f.length() - 1) < 1e-6, `${st.name} ship pose finite, heading unit`);
    assert.ok(sh.thr >= 0 && sh.thr <= 1.2 && sh.rcs >= 0 && sh.rcs <= 1 && sh.vis >= 0 && sh.vis <= 1);
    if (prev && sh.vis > 0.01) {
      const v = p.distanceTo(prev) / 0.5;
      vmax = Math.max(vmax, v);
    }
    prev = (prev || V()).copy(p);
  }
  assert.ok(vmax < 12, `${st.name} ships stay under 12 km/s where visible (max ${vmax.toFixed(2)})`);
  // the loop closes: a lap later the ship is where it started
  shipPose(sh, 0, p, f); shipPose(sh, R.T, q, f);
  assert.ok(p.distanceTo(q) < 1e-6, `${st.name} route closes`);
  // legs meet end to end
  for (const leg of R.legs) {
    const a = V(), b = V();
    routePos(R, leg.t0 - 1e-6, a); routePos(R, leg.t0 + 1e-6, b);
    if (leg.t0 > 0) assert.ok(a.distanceTo(b) < 1e-3, `${st.name} legs join`);
  }
}
out.ships = ships;
assert.ok(ships >= 45, `a busy sky: ${ships} ships`);

// ---- 4. clearance from every real structure in the scene (triangles), the tether, Earth and Moon
const ownGroups = new Set(stations.map((s) => s.group));
const isOwn = (o) => { for (let x = o; x; x = x.parent) if (ownGroups.has(x)) return true; return false; };
const pathSamples = [];   // [world pos, radius, station, ship]
const step = 3;
for (const st of stations) {
  st.group.updateMatrixWorld(true);
  for (const sh of st.ships) {
    const r = sh.design.radius * KM * sh.scale;
    for (let t = 0; t < sh.route.T; t += step) {
      const p = V(); shipPose(sh, t, p, V());
      if (sh.vis < 0.01) continue;
      pathSamples.push({ p: p.applyMatrix4(st.group.matrixWorld), r, st, sh, t });
    }
  }
}
const meshes = [];
space.scene.traverse((o) => {
  if (!o.isMesh || isOwn(o) || o.material?.transparent || !o.geometry?.attributes?.position) return;
  if (o.geometry.isInstancedBufferGeometry) return;
  if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
  if (o.isInstancedMesh) o.computeBoundingSphere();
  const s = (o.isInstancedMesh ? o.boundingSphere : o.geometry.boundingSphere).clone().applyMatrix4(o.matrixWorld);
  if (!Number.isFinite(s.radius)) return;
  meshes.push({ o, s });
});
// candidates: meshes whose bounds come within 3 km of a path (the Earth and Moon are tested as spheres)
const cand = [];
for (const m of meshes) {
  if (m.s.radius > 5000) continue;
  let near = false;
  for (const ps of pathSamples) if (ps.p.distanceTo(m.s.center) < m.s.radius + ps.r + 3) { near = true; break; }
  if (near) cand.push(m);
}
function tris(o) {
  const list = [], p = o.geometry.attributes.position, ix = o.geometry.index, n = ix ? ix.count : p.count;
  const mats = o.isInstancedMesh ? Array.from({ length: o.count }, (_, i) => { const m = new THREE.Matrix4(); o.getMatrixAt(i, m); return m.premultiply(o.matrixWorld); }) : [o.matrixWorld];
  for (const M of mats) for (let i = 0; i < n; i += 3) list.push(new THREE.Triangle(...[0, 1, 2].map((j) => V().fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j).applyMatrix4(M))));
  return list;
}
function tree(t) {
  const box = new THREE.Box3();
  for (const x of t) { box.expandByPoint(x.a); box.expandByPoint(x.b); box.expandByPoint(x.c); }
  if (t.length < 16) return { box, t };
  const s = box.getSize(V()), ax = s.x > s.y ? (s.x > s.z ? 'x' : 'z') : (s.y > s.z ? 'y' : 'z');
  t.sort((a, b) => a.a[ax] + a.b[ax] + a.c[ax] - b.a[ax] - b.b[ax] - b.c[ax]);
  const h = t.length >> 1;
  return { box, l: tree(t.slice(0, h)), r: tree(t.slice(h)) };
}
const _cp = V();
function dist(T, p, best = Infinity) {
  if (T.box.distanceToPoint(p) > best) return best;
  if (T.t) { for (const x of T.t) { x.closestPointToPoint(p, _cp); best = Math.min(best, _cp.distanceTo(p)); } return best; }
  const [a, b] = T.l.box.distanceToPoint(p) < T.r.box.distanceToPoint(p) ? [T.l, T.r] : [T.r, T.l];
  return dist(b, p, dist(a, p, best));
}
let structTris = [];
for (const c of cand) structTris = structTris.concat(tris(c.o));
out.clearanceCandidateMeshes = cand.length;
out.clearanceTriangles = structTris.length;
let minClear = Infinity, worst = null;
if (structTris.length) {
  const T = tree(structTris);
  for (const ps of pathSamples) {
    const d = dist(T, ps.p, 50) - ps.r;
    if (d < minClear) { minClear = d; worst = ps; }
  }
}
out.structureClearanceKm = +minClear.toFixed(3);
assert.ok(minClear > 0.4, `working lanes clear every structure by ${minClear} km (${worst?.st.name} ${worst?.sh.design.kind} t=${worst?.t})`);
// the tether: a line up the Harbour's axis from the ground to the counterweight
{
  const el = space.elevator, h = el.harbour;
  const a = h.localToWorld(V(0, -50000, 0)), b = h.localToWorld(V(0, 150000, 0));
  const line = new THREE.Line3(a, b), c = V();
  let m = Infinity;
  for (const ps of pathSamples) { line.closestPointToPoint(ps.p, true, c); m = Math.min(m, c.distanceTo(ps.p) - ps.r); }
  out.tetherClearanceKm = +m.toFixed(2);
  assert.ok(m > 8, `ships keep 8 km from the tether (${m})`);
}
{
  let mE = Infinity, mM = Infinity;
  for (const ps of pathSamples) { mE = Math.min(mE, ps.p.length() - R_EARTH - ps.r); mM = Math.min(mM, ps.p.distanceTo(sim.moonPos) - R_MOON - ps.r); }
  out.earthClearanceKm = Math.round(mE); out.moonClearanceKm = Math.round(mM);
  assert.ok(mE > 20000 && mM > 100, 'no ship grazes a world');
}

// ---- 5. separation: every pair of working ships, and from the fleet's and the roads' movers
{
  let minPair = Infinity, pairAt = null;
  const P = V(), Q = V(), f = V();
  for (const st of stations) {
    const S = st.ships;
    for (let t = 0; t < 3000; t += 2) {
      const pos = S.map((sh) => { const p = V(); shipPose(sh, t, p, f); return sh.vis > 0.01 ? p : null; });
      for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
        if (!pos[i] || !pos[j]) continue;
        const d = pos[i].distanceTo(pos[j]) - (S[i].design.radius * S[i].scale + S[j].design.radius * S[j].scale) * KM;
        if (d < minPair) { minPair = d; pairAt = [st.name, i, j, t]; }
      }
    }
  }
  out.shipSeparationKm = +minPair.toFixed(3);
  assert.ok(minPair > 0.1, `working ships keep their distance (${minPair} km at ${pairAt})`);
  // the Harbour's own movers (voyagers in world space; the roads' freighters in the Harbour frame)
  const H = traffic.harbour, hInv = V();
  let minMover = Infinity;
  const vp = V(), vf = V();
  for (let t = 0; t < 4000; t += 4) {
    const mine = H.ships.map((sh) => { const p = V(); shipPose(sh, t, p, f); return sh.vis > 0.01 ? { p, r: sh.design.radius * sh.scale * KM } : null; }).filter(Boolean);
    for (let i = 0; i < space.geoRoads.movers.length; i++) {
      space.geoRoads.localPose(i, t, vp, vf);
      for (const m of mine) minMover = Math.min(minMover, m.p.distanceTo(vp) - m.r - 0.6);
    }
    for (const vy of fleet.movers.filter((m) => m.frameObj === space.elevator.harbour)) {
      const c = vy.c, u = (((t / c.T) + c.offset) % 1 + 1) % 1;
      voyage(u, c, vp, vf);
      for (const m of mine) minMover = Math.min(minMover, m.p.distanceTo(vp) - m.r - 1.3);
    }
    for (const r of fleet.runs) for (const m of mine) minMover = Math.min(minMover, m.p.distanceTo(r.pos) - m.r - 0.1);
  }
  out.moverSeparationKm = +minMover.toFixed(2);
  assert.ok(minMover > 1, `the working lanes keep clear of the Harbour's freighters, liner and tugs (${minMover} km)`);
  // Selene's tankers
  const S = traffic.selene;
  let minT = Infinity;
  for (let t = 0; t < 4000; t += 4) {
    const mine = S.ships.map((sh) => { const p = V(); shipPose(sh, t, p, f); return sh.vis > 0.01 ? { p, r: sh.design.radius * sh.scale * KM } : null; }).filter(Boolean);
    for (const vy of fleet.movers.filter((m) => m.frameObj === fleet.refinery)) {
      const c = vy.c, u = (((t / c.T) + c.offset) % 1 + 1) % 1;
      voyage(u, c, vp, vf);
      for (const m of mine) minT = Math.min(minT, m.p.distanceTo(vp) - m.r - 0.4);
    }
  }
  out.seleneTankerSeparationKm = +minT.toFixed(2);
  assert.ok(minT > 1, `Selene's lanes keep clear of her tankers (${minT} km)`);
}

// ---- 6. the runtime: lamps follow the hulls, puffs fire, LOD, budget, per-frame cost
{
  const H = traffic.harbour;
  const cam = space.camera;
  cam.position.copy(H.group.position).add(V(0, 30, 0));
  frame(500);
  const sh = H.ships[0], L = H.aL.array;
  // the first lamp of a ship is its design's first lamp carried by the ship's matrix
  const l0 = sh.design.lamps[0].p.clone().applyMatrix4(sh.mat);
  assert.ok(Math.hypot(L[sh.lamp0 * 4] - l0.x, L[sh.lamp0 * 4 + 1] - l0.y, L[sh.lamp0 * 4 + 2] - l0.z) < 1e-4, 'ship lamps ride their hulls');
  for (let i = 0; i < L.length; i++) assert.ok(Number.isFinite(L[i]), 'lamp buffer finite');
  // RCS demand makes puffs: count lit puff slots over a minute
  let puffs = 0;
  for (let t = 500; t < 560; t += 0.25) {
    H.update(t, 0.25, cam);
    for (const s of H.ships) for (let j = 0; j < 4; j++) if (H.aC.array[(s.puff0 + j) * 4] > 0) puffs++;
  }
  out.puffSamples = puffs;
  assert.ok(puffs > 50, 'thrusters puff');
  // drive glows lit on the burns: some ship is under power at any moment
  let lit = 0;
  for (const s of H.ships) if (s.thr > 0.2) lit++;
  assert.ok(lit >= 1, 'engines burn on the roads');
  // LOD: hulls hidden far off, lamps still drawn; everything hidden beyond the lamp range
  cam.position.copy(H.group.position).add(V(0, HULL_RANGE + 5000, 0));
  H.update(600, 0.016, cam);
  assert.ok(H.sets.every((s) => !s.im.visible) && H.group.visible, 'hulls give way to lamps at range');
  cam.position.copy(H.group.position).add(V(0, 30, 0));
  H.update(600, 0.016, cam);
  assert.ok(H.sets.every((s) => s.im.visible), 'hulls near');
  const iv = H.interval(cam.position);
  assert.ok(iv[0] > 0 && iv[1] > iv[0], 'depth interval spans the ships');
  out.instancedTriangles = traffic.triangles();
  assert.ok(out.instancedTriangles < 4e6, 'working lanes within their triangle budget');
  // per-frame cost (both stations)
  for (let i = 0; i < 50; i++) traffic.update(sim, 600 + i * 0.016, 0.016, space);
  const n = 400, t1 = performance.now();
  for (let i = 0; i < n; i++) traffic.update(sim, 700 + i * 0.016, 0.016, space);
  out.updateMs = +((performance.now() - t1) / n).toFixed(4);
  assert.ok(out.updateMs < 0.3, `traffic update ${out.updateMs} ms per frame`);
}
// ---- 7. the Concord liner's near fittings: lazy, seated off the keel collars, clear of the pier
{
  const docked = fleet.docked;
  assert.ok(fleet.linerDetail && docked.userData.detail.visible, 'liner detail built once the camera came within range (section 6)');
  fleet.linerDetail = null; docked.remove(docked.userData.detail);
  const t2 = performance.now();
  fleet._linerDetail(null, true);
  out.linerDetailMs = +(performance.now() - t2).toFixed(1);
  assert.ok(out.linerDetailMs < 400, `liner detail builds in ${out.linerDetailMs} ms`);
  const D = fleet.linerDetail, g = D.geo, p = g.attributes.position;
  out.linerDetailTriangles = g.index.count / 3;
  assert.ok(out.linerDetailTriangles > 60000 && out.linerDetailTriangles < 1.2e6, 'liner detail within budget');
  for (let i = 0; i < p.array.length; i++) assert.ok(Number.isFinite(p.array[i]), 'liner detail finite');
  assert.ok(docked.userData.detail && docked.userData.detail.parent === docked, 'the fittings ride the berthed liner');
  // nothing on the keel line where the collars and the port shuttles are
  const { KEEL_CLEAR } = await import('../src/space/linerDetail.js');
  const w = V();
  let keel = 0;
  for (let i = 0; i < p.count; i++) { w.fromBufferAttribute(p, i); if (w.y < -20 && Math.abs(w.x) < KEEL_CLEAR && w.z > -470 && w.z < 640) keel++; }
  assert.equal(keel, 0, 'keel collars left clear');
  // the port shuttles berthed at the collars: no fitting within 3 m of their hulls
  const att = tree(tris(new THREE.Mesh(fleet.linerAttendants.geo)));
  let mAtt = Infinity;
  for (let i = 0; i < p.count; i += 3) mAtt = Math.min(mAtt, dist(att, w.fromBufferAttribute(p, i), 50));
  out.linerDetailShuttleClearanceM = +mAtt.toFixed(2);
  assert.ok(mAtt > 3, `fittings clear the berthed shuttles (${mAtt} m)`);
  // the Harbour's structure (pier, gangways, arms, berthed ships): every fitting vertex > 4 m off
  const el = space.elevator, st = el.station;
  el.harbour.updateMatrixWorld(true);
  const toH = el.harbour.matrixWorld.clone().invert();
  const dm = new THREE.Matrix4().multiplyMatrices(toH, docked.matrixWorld);
  const box = new THREE.Box3().setFromBufferAttribute(p).applyMatrix4(dm).expandByScalar(0.08);
  const near = [];
  for (const o of [st.body, st.terrace, ...(st.rings || []), ...(st.wings || []).map((x) => x.pivot), st.shipsBig, st.shipsSmall].filter(Boolean)) {
    o.updateMatrixWorld(true);
    o.traverse((m) => {
      if (!m.isMesh || m.material?.transparent || m.geometry.isInstancedBufferGeometry) return;
      const M = new THREE.Matrix4().multiplyMatrices(toH, m.matrixWorld), P = m.geometry.attributes.position, ix = m.geometry.index;
      for (let i = 0; i < ix.count; i += 3) {
        const tr = new THREE.Triangle(...[0, 1, 2].map((j) => V().fromBufferAttribute(P, ix.getX(i + j)).applyMatrix4(M)));
        if (box.intersectsTriangle(tr)) near.push(tr);
      }
    });
  }
  let mH = Infinity;
  if (near.length) {
    const T = tree(near);
    const bad = new THREE.Box3();
    for (let i = 0; i < p.count; i += 2) {
      const d = dist(T, w.fromBufferAttribute(p, i).applyMatrix4(dm), 1) * 1000;
      if (d < 4) { bad.expandByPoint(V().fromBufferAttribute(p, i)); (out.badZ ||= new Set()).add(Math.round(p.getZ(i) / 20) * 20 + ':' + Math.round(p.getY(i) / 10) * 10); }
      mH = Math.min(mH, d);
    }
    if (!bad.isEmpty()) console.log('fittings too near the Harbour (liner metres):', bad.min.toArray().map(Math.round), bad.max.toArray().map(Math.round));
  }
  out.linerDetailHarbourClearanceM = Number.isFinite(mH) ? +mH.toFixed(1) : 'none-near';
  assert.ok(mH > 4, `fittings clear the Harbour's pier and structure (${mH} m, ${near.length} triangles near)`);
}
// ---- 8. Selene close to: the wheel's fittings inside its swept envelope, lifts on their spokes,
// the ring cranes clear of the works and the berthed tankers through their whole swing
{
  const { WHEEL, RING, RAIL_Y, liftPose, craneAngle } = await import('../src/space/seleneDetail.js');
  assert.ok(!fleet.seleneDetail, 'Selene detail is not built while the camera is far');
  const t3 = performance.now();
  fleet._seleneDetail(null, 0, true);
  out.seleneDetailMs = +(performance.now() - t3).toFixed(1);
  assert.ok(out.seleneDetailMs < 300, 'Selene detail builds quickly');
  const D = fleet.seleneDetail, wg = D.data.wd.geo, wp = wg.attributes.position, w = V();
  out.seleneDetailTriangles = wg.index.count / 3 + (D.data.car.geo.index.count / 3) * D.cars.length + (D.data.crane.geo.index.count / 3) * D.cranes.length;
  let outside = 0;
  for (let i = 0; i < wp.count; i++) {
    w.fromBufferAttribute(wp, i);
    const r = Math.hypot(w.x, w.z);
    if (r > 2020) { if (r > 2410 || w.y < -770 || w.y > -370) outside++; }
    else if (r < WHEEL.spokeIn - 1 || w.y < WHEEL.y - WHEEL.spokeR - 1 || w.y > RAIL_Y + 5) outside++;
  }
  assert.equal(outside, 0, 'wheel fittings stay inside the wheel\'s swept envelope');
  // lift cars: on their rails, inside the spoke run, never past the rim's inner wall
  const cb = new THREE.Box3().setFromBufferAttribute(D.data.car.geo.attributes.position);
  for (let t = 0; t < 480; t += 3) for (let k = 0; k < 6; k++) {
    const p = V(), a = liftPose(k, 0, t, p);
    const r = Math.hypot(p.x, p.z);
    assert.ok(r - 16 > WHEEL.spokeIn && r + 16 < WHEEL.rim - WHEEL.rimHalfW, 'lift inside its spoke run');
    assert.ok(Math.abs(p.y + cb.min.y - (RAIL_Y + 2.2) + 2.2) < 0.01 || p.y + cb.min.y >= RAIL_Y - 0.01, 'bogies on the rail');
    assert.ok(Math.abs(Math.atan2(p.z, p.x) - Math.atan2(Math.sin(a), Math.cos(a))) < 1e-9, 'car on its spoke');
  }
  // cranes: every vertex, at every sampled angle, clear of the refinery's own hull and berthed tankers
  const rm = fleet.refineryMesh;
  const cg = D.data.crane.geo, cp = cg.attributes.position;
  const cbox = new THREE.Box3().setFromBufferAttribute(cp);
  const reach = Math.max(cbox.max.x, -cbox.min.x) + RING.R + 10;
  const near = [];
  for (const child of [rm, ...rm.children.filter((c) => c.isMesh && c !== fleet.wheel && c.geometry.index && !c.material.transparent)]) {
    const P = child.geometry.attributes.position, ix = child.geometry.index;
    const M = child === rm ? new THREE.Matrix4() : child.matrix.clone();
    for (let i = 0; i < ix.count; i += 3) {
      const tr = new THREE.Triangle(...[0, 1, 2].map((j) => V().fromBufferAttribute(P, ix.getX(i + j)).applyMatrix4(M)));
      const c = tr.getMidpoint(V());
      if (Math.hypot(c.x, c.z) < reach + 300 && c.y > RING.y - 200 && c.y < RING.y + 400) near.push(tr);
    }
  }
  const T = tree(near);
  let minCrane = Infinity;
  const m = new THREE.Matrix4(), q = new THREE.Matrix4();
  for (let k = 0; k < 3; k++) for (let t = 0; t < 1200; t += 20) {
    m.makeRotationY(-craneAngle(k, t)).multiply(q.makeTranslation(RING.R, RING.y + RING.tube, 0));
    for (let i = 0; i < cp.count; i += 3) minCrane = Math.min(minCrane, dist(T, w.fromBufferAttribute(cp, i).applyMatrix4(m), 30));
  }
  out.craneClearanceM = +minCrane.toFixed(2);
  assert.ok(minCrane > 0.8, `ring cranes clear the works and the berthed tankers (${minCrane} m)`);
  // the cranes keep to their sectors, apart from each other
  for (let t = 0; t < 3000; t += 7) {
    const a = [0, 1, 2].map((k) => craneAngle(k, t));
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { let d = Math.abs(a[i] - a[j]) % (Math.PI * 2); d = Math.min(d, Math.PI * 2 - d); assert.ok(d > 0.8, 'cranes apart'); }
  }
  // animated while near, hidden beyond range
  fleet._seleneDetail({ position: V(1e9, 0, 0) }, 10);
  assert.ok(D.parts.every((p) => !p.visible), 'Selene detail hidden far off');
}
console.log(JSON.stringify(out));
console.log('FLEET_VERIFIED');
