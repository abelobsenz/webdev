// The geostationary arc at work (harbourLife.js, yardWorks.js, storeWorks.js, terraceLife.js,
// releaseWorks.js): build timings, per-frame cost, triangle budgets, finite transforms, and the
// clearances of every moving part against the real triangles it works among.
// Run: node tools/verify-geo.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HarbourStation, HS } from '../src/space/harbour.js';
import { LIFE, cranePose, podR, PODS_PER_LINE, dronePose, armFrame, ROAD, roadPose } from '../src/space/harbourLife.js';
import { buildConcordYard, buildWaterStore, YARD, STORE, sectionPoint } from '../src/space/geoRoads.js';
import { YardWorks, WORKS, craneBay, cranePlate, droneSites, dronePos, crewPodPos, podStops } from '../src/space/yardWorks.js';
import { StoreWorks, PLUMB, storeDronePos } from '../src/space/storeWorks.js';
import { TL, cartZ, rimWalker, apronWalker } from '../src/space/terraceLife.js';
import { craftMesh, placeMerge } from '../src/space/craftMesh.js';
import { buildReleaseYard, YARD as RY } from '../src/space/releaseYard.js';
import { ReleaseWorks, RW, crawlerS, gantryZ } from '../src/space/releaseWorks.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const now = () => performance.now();
const results = {};

// ---- a uniform-grid triangle collider (positions in the geometry's own units)
class Collider {
  constructor(geos, cell) {
    this.cell = cell; this.map = new Map(); this.tris = [];
    for (const { geo, m } of geos) {
      const p = geo.attributes.position, ix = geo.index;
      const n = ix ? ix.count : p.count;
      for (let i = 0; i < n; i += 3) {
        const t = new THREE.Triangle(...[0, 1, 2].map((j) => V().fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j).applyMatrix4(m || new THREE.Matrix4())));
        const k = this.tris.length; this.tris.push(t);
        const bb = new THREE.Box3().setFromPoints([t.a, t.b, t.c]);
        const c0 = bb.min.clone().divideScalar(cell).floor(), c1 = bb.max.clone().divideScalar(cell).floor();
        for (let x = c0.x; x <= c1.x; x++) for (let y = c0.y; y <= c1.y; y++) for (let z = c0.z; z <= c1.z; z++) {
          const key = `${x},${y},${z}`;
          let l = this.map.get(key); if (!l) this.map.set(key, (l = [])); l.push(k);
        }
      }
    }
  }
  /** Distance from p to the nearest triangle within reach (Infinity if none within reach). */
  dist(p, reach) {
    const c = this.cell, q = V(), seen = new Set();
    let best = Infinity;
    const r = Math.ceil(reach / c);
    const cx = Math.floor(p.x / c), cy = Math.floor(p.y / c), cz = Math.floor(p.z / c);
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
      const l = this.map.get(`${x},${y},${z}`); if (!l) continue;
      for (const k of l) { if (seen.has(k)) continue; seen.add(k); this.tris[k].closestPointToPoint(p, q); best = Math.min(best, q.distanceTo(p)); }
    }
    return best;
  }
}
const instances = (im) => { const out = [], m = new THREE.Matrix4(); for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); out.push({ geo: im.geometry, m: m.clone() }); } return out; };
const finiteIM = (im) => { for (let i = 0; i < im.count * 16; i++) if (!Number.isFinite(im.instanceMatrix.array[i])) return false; return true; };
const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e7);
const space = { camera: cam, size: new THREE.Vector2(1280, 720) };

// ===================================================================== Harbour
let t0 = now();
const st = new HarbourStation();
results.harbourStationBuildMs = +(now() - t0).toFixed(0);
const life = st.life, h = st.data;
results.harbourLifeBuildMs = +life.buildMs.toFixed(1);
assert.ok(life.buildMs < 300, `harbour life builds in ${life.buildMs} ms`);
cam.position.set(2, 1.5, 4); cam.updateMatrixWorld();
st.group.updateMatrixWorld(true);
// LOD: detail on near, off far
life.update(10, space); assert.ok(life.root.visible, 'harbour life shows near');
cam.position.set(900, 0, 0); life.update(10, space); assert.ok(!life.root.visible, 'harbour life hides far');
cam.position.set(2, 1.5, 4);
t0 = now(); for (let i = 0; i < 600; i++) life.update(50 + i * 0.4, space);
results.harbourLifeUpdateMs = +((now() - t0) / 600).toFixed(4);
results.harbourLifeTriangles = life.triangles();
// finite
for (const t of [0, 13.7, 999, 1e5]) { life.update(t, space); life.root.traverse((o) => { if (o.isInstancedMesh) assert.ok(finiteIM(o), `${t}: finite instances`); }); }

// layout invariants (design units)
const CV = LIFE.conveyor, CR = LIFE.crane, DR = LIFE.drone;
assert.ok(CV.r1 + 190 < LIFE.finger0 - 110, 'conveyor houses end before the first berth finger');
assert.ok(CR.travel - 150 > 596 + 150, 'a carried capsule clears the racked capsules');
assert.ok(CR.travel + 150 + 40 + 35 < CR.bridge - 84, 'the hook block stays under the trolley');
assert.ok(Math.abs(DR.y) - 18 - 30 > 230, 'drones stay off the gallery (under the arm)');
for (const arm of h.arms) assert.ok(Math.abs(arm.y / HS) - Math.abs(DR.y) - 30 > 1050, 'drones stay above the middle ring');
for (let u = 0; u < 1; u += 0.002) {
  const c = cranePose(u);
  assert.ok(c.r >= CR.padA - 1e-9 && c.r <= CR.padB + 1e-9 && Math.abs(c.z) <= CR.padZ + 1e-9);
  assert.ok(c.r - CR.legX - 60 > CR.r0 && c.r + CR.legX + 60 < CR.r1, 'crane bogies stay on their rails');
}
// the fleet's tugs load the outer racks of some arms from a station over them: those arms' cranes stay parked
{
  const src = (await import('node:fs')).readFileSync(new URL('../src/space/fleet.js', import.meta.url), 'utf8');
  const tugArms = [...new Set([...src.matchAll(/rack\((\d)\)/g)].map((m) => +m[1]))];
  assert.ok(tugArms.length, 'fleet tug stations found');
  for (const i of tugArms) assert.ok(CR.parked.includes(i), `arm ${i}'s crane is parked (a fleet tug loads its outer rack)`);
  results.parkedCraneArms = tugArms;
  // a parked crane stands at the inboard pad, far from the tug's station over the 9,700 m rack
  const parked = cranePose(0.97);
  assert.ok(parked.r + CR.legX + 60 < 9700 - 800 && !parked.carrying, 'parked cranes stand clear of the tug station');
}
// the gallery town stays between the girdles, off the drones' racetrack and inside the conveyors
{
  const TW = LIFE.town;
  for (let k = 0; k < TW.segs; k++) {
    const g = TW.r0 + k * TW.pitch;
    const a = g + 80, b = g + 80 + 3 * TW.len + 2 * TW.gap;
    assert.ok(a > g + 40 + 10 && b < g + TW.pitch - 40 - 10, 'town blocks clear both girdles');
  }
  assert.ok(TW.top - 40 - 205 > DR.y + 18 + 20 + 10, 'town masts and roofs clear the drones (their 18 m bob and 20 m size)');
  assert.ok(110 < CV.pod - CV.podR, 'town blocks stay inside the conveyor lines');
}
// pods in order on each line and inside the line's span
for (const ls of [1, -1]) for (let j = 0; j < PODS_PER_LINE; j++) { const r = podR(123.4, j, ls); assert.ok(r >= CV.r0 - 1e-6 && r <= CV.r1 + 1e-6); }

// collider of the Harbour's static triangles (drawn metres) and the berthed ships
t0 = now();
const hc = new Collider([{ geo: h.body }, { geo: h.shipsBigGeo }, { geo: h.shipsSmallGeo }], 120);
results.harbourColliderMs = +(now() - t0).toFixed(0);
const armF = h.arms.map((a) => armFrame(a));
const P = V();
let podGap = Infinity, loadGap = Infinity, droneGap = Infinity, boxGap = Infinity;
for (const t of [0, 37, 111, 260, 517]) {
  for (const [ai, F] of armF.entries()) {
    for (const ls of [1, -1]) for (let j = 0; j < PODS_PER_LINE; j += 3) {
      const r = podR(t, j, ls);
      if (r < CV.r0 + 200 || r > CV.r1 - 200) continue;          // inside the transfer houses
      for (const dx of [-80, 0, 80]) { P.set(r + dx, 0, ls * CV.pod).applyMatrix4(F); podGap = Math.min(podGap, hc.dist(P, 80) - CV.podR * HS); }
    }
    const c = cranePose(t / CR.T + 0.31 * ai);
    if (c.carrying && c.hook > CR.pad + 60) for (const dx of [-290, -145, 0, 145, 290]) {
      P.set(c.r + dx, c.hook, c.z).applyMatrix4(F);
      const g = hc.dist(P, 120) - 150 * HS;
      if (g < loadGap) { loadGap = g; results.craneWorst = { arm: ai, t, r: c.r + dx, hook: c.hook, z: c.z }; }
    }
    for (let j = 0; j < DR.perArm; j++) { dronePose(t, j, ai, P, V()); P.applyMatrix4(F); droneGap = Math.min(droneGap, hc.dist(P, 80) - 5); }
  }
}
// berth boxes over the hatches and on the way (from the live instances)
for (const t of [5, 40, 77, 140, 200]) {
  life.update(t, space);
  const m = new THREE.Matrix4(), p = V(), q = new THREE.Quaternion(), s = V();
  for (let i = 0; i < life.bBoxes.count; i++) {
    life.bBoxes.getMatrixAt(i, m); m.decompose(p, q, s);
    if (s.x < 0.5) continue;
    const onBlock = life.berthWork[i] && p.clone().sub(life.berthWork[i].g.tip).length() < 120;
    if (onBlock) continue;                                          // resting on the block (by design)
    boxGap = Math.min(boxGap, hc.dist(p, 60) - 9);
  }
}
// the drones also clear the station's new kit (town blocks, collars, conveyor houses)
{
  const kc = new Collider(instances(life.kit), 120);
  let g = Infinity;
  for (const t of [0, 51, 133, 377]) for (const [ai, F] of armF.entries()) for (let j = 0; j < DR.perArm; j++) { dronePose(t, j, ai, P, V()); P.applyMatrix4(F); g = Math.min(g, kc.dist(P, 120) - 5); }
  results.armDroneKitClearM = +g.toFixed(1);
  assert.ok(g > 5, `arm drones clear the gallery town by ${g} m`);
}
Object.assign(results, { podClearM: +podGap.toFixed(1), craneLoadClearM: +loadGap.toFixed(1), armDroneClearM: +droneGap.toFixed(1), berthBoxClearM: +boxGap.toFixed(1) });
assert.ok(podGap > 2, `conveyor pods clear the Harbour by ${podGap} m`);
assert.ok(loadGap > 2, `carried capsules clear the racks by ${loadGap} m`);
assert.ok(droneGap > 5, `arm drones clear the Harbour by ${droneGap} m`);
assert.ok(boxGap > 1, `berth boxes clear the ships and fingers by ${boxGap} m`);
// positive control: a pod line through the gallery's axis must collide
{ P.set(6000, 0, 0).applyMatrix4(armF[0]); assert.ok(hc.dist(P, 200) < 230 * HS, 'positive control: the gallery axis lies inside the gallery'); }

// ---- the Ring Road: clear of the station, its ships and the turning rings; lanes never meet
{
  let g = Infinity, sep = Infinity, ringGap = Infinity;
  const Q = V(), F = V();
  const rimR = Math.max(...h.rings.map((r) => r.R + (r.R > 4000 ? 560 : 430) * HS + 30 * HS));
  const rimY = Math.max(...h.rings.map((r) => Math.abs(r.y) + (r.R > 4000 ? 1010 : 750) * HS));
  for (const t of [0, 17, 60, 145, 233]) {
    const pts = [];
    for (let l = 0; l < ROAD.lanes.length; l++) for (let k = 0; k < ROAD.lanes[l].n; k++) {
      roadPose(l, k, t, Q, F); pts.push(Q.clone());
      g = Math.min(g, hc.dist(Q, 500) - 25);
      const rr = Math.hypot(Q.x, Q.z);
      if (Math.abs(Q.y) < rimY + 30) ringGap = Math.min(ringGap, rr - rimR - 25);
      assert.ok(Math.abs(F.length() - 1) < 1e-9);
    }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) sep = Math.min(sep, pts[i].distanceTo(pts[j]));
  }
  Object.assign(results, { roadClearM: Number.isFinite(g) ? Math.round(g) : '>500', roadRingClearM: Math.round(ringGap), roadSeparationM: Math.round(sep) });
  assert.ok(g > 200, `ring road clears the Harbour and its ships (${g} m; Infinity: nothing within 500 m)`);
  assert.ok(ringGap > 400, `ring road clears the turning rims by ${ringGap} m`);
  assert.ok(sep > 150, `ring road craft keep ${sep} m apart`);
  const armLow = Math.min(...h.arms.map((a) => Math.abs(a.y))) - (230 + 440) * HS;      // gallery town's lowest mast
  assert.ok(armLow - Math.max(...ROAD.lanes.map((l) => Math.abs(l.y))) - 18 > 400, 'ring road passes well below the arms and their towns');
}

// ===================================================================== the terrace's people
{
  const td = st.terraceData, fl = td.floor, tc = new Collider([{ geo: td.geo }], 20);
  const w = {};
  let walkGap = Infinity, cartGap = Infinity;
  for (let t = 0; t < 900; t += 1.9) {
    for (let k = 0; k < TL.rim.crews; k++) {
      rimWalker(k, t, w);
      for (const h of [0.95, 1.55]) { P.set(w.x, fl + h, w.z); walkGap = Math.min(walkGap, tc.dist(P, 6) - 0.3); }
    }
    for (let k = 0; k < TL.apron.crew; k++) {
      apronWalker(k, t, w);
      for (const h of [1.35, 1.95]) { P.set(w.x, fl + h, w.z); walkGap = Math.min(walkGap, tc.dist(P, 6) - 0.3); }
    }
    for (const [ri, x] of TL.rails.entries()) for (let k = 0; k < TL.carts; k++) {
      const c = cartZ(ri, k, t);
      for (const dz of [-1.8, 0, 1.8]) { P.set(x, fl + 2.0, c.z + dz); cartGap = Math.min(cartGap, tc.dist(P, 6) - 1.1); }   // (the wheels ride the rail below)
    }
  }
  // standing on the deck: the deck is right under every figure's boots
  rimWalker(3, 10, w); P.set(w.x, fl + 0.05, w.z);
  assert.ok(tc.dist(P, 4) < 0.1, 'rim crews stand on the deck');
  Object.assign(results, { terraceWalkerClearM: +walkGap.toFixed(2), terraceCartClearM: +cartGap.toFixed(2), terraceLifeTriangles: 0 });
  assert.ok(walkGap > 0.05, `terrace crews clear the terrace's railings, halls and courier by ${walkGap} m`);
  assert.ok(cartGap > 0.05, `baggage carts clear the court by ${cartGap} m`);
  st.terraceLife.root.traverse((o) => { if (o.isInstancedMesh) results.terraceLifeTriangles += o.geometry.index.count / 3 * o.count; });
}

// ===================================================================== Concord Yard
const yd = buildConcordYard();
const ym = craftMesh(yd.dockGeo);
t0 = now();
const yw = new YardWorks(ym);
results.yardWorksBuildMs = +(now() - t0).toFixed(1);
assert.ok(yw.buildMs < 300);
t0 = now(); for (let i = 0; i < 600; i++) yw.update(10 + i * 0.37, 1e4);
results.yardWorksUpdateMs = +((now() - t0) / 600).toFixed(4);
results.yardWorksTriangles = yw.triangles();
yw.update(5, 50); assert.ok(!yw.root.visible, 'yard works hide when small');
yw.update(5, 1e4); assert.ok(yw.root.visible);
for (const t of [0, 77, 1e5]) { yw.update(t, 1e4); yw.root.traverse((o) => { if (o.isInstancedMesh) assert.ok(finiteIM(o)); }); }
const plating = yw.plating.geo;
const yStatic = [{ geo: yd.dockGeo }, { geo: yd.hullGeo }, { geo: plating }, ...instances(yw.walkways), ...instances(yw.hatches)];
const yc = new Collider(yStatic, 40);
// positive control: a point on the hull crown
assert.ok(yc.dist(V(0, sectionPoint(0, Math.PI / 2).y, 0), 20) < 1, 'positive control: the hull crown is in the yard collider');
// cranes: z range keeps off the frames, clamps and the next frame's walkway
for (const c of WORKS.cranes) {
  const b = craneBay(c);
  for (let u = 0; u < 1; u += 0.002) {
    const s = cranePlate(c, u);
    assert.ok(s.z - 15 >= b.z0 + 13 && s.z + 15 <= b.z1 + WORKS.walk.z0 - 1, `crane in bay ${c.bay} keeps between its frames and off the walkway (${s.z})`);
    assert.ok(Math.abs(s.hook) <= 208 + 1e-9 && Math.abs(s.hook) >= Math.abs(s.yT) - 1e-9, 'hook stays between the trolley and the plate gap');
  }
  assert.ok(c.target > b.lo && c.target < b.hi, 'target inside the crane bay');
}
// plates on the hook and in their gaps clear the hull, ribs, stringers, plating and dock
let plateGap = Infinity;
const [px, , pz] = WORKS.plate;
for (const [i, c] of WORKS.cranes.entries()) for (let u = 0.01; u < 1; u += 0.01) {
  const s = cranePlate(c, u);
  if (s.onPad) continue;
  const sg = c.top ? 1 : -1, z = s.carried ? s.z : c.target, y = s.carried ? s.hook : s.yT;
  if (!s.carried && !s.fitted) continue;
  for (const dx of [-px / 2, -px / 4, 0, px / 4, px / 2]) for (const dz of [-pz / 2, 0, pz / 2]) {
    P.set(dx, y - sg * 2, z + dz);
    const g = yc.dist(P, 40);
    if (g < plateGap) { plateGap = g; results.plateWorst = { crane: i, u: +u.toFixed(2), x: dx, y: +P.y.toFixed(1), z: +P.z.toFixed(1), carried: s.carried }; }
  }
  void i;
}
results.yardPlateClearM = +plateGap.toFixed(2);
assert.ok(plateGap > 0.4, `crane plates clear the hull and dock by ${plateGap} m`);
// drones: clear of everything static, of the crane plates (|x| >= 45 while plates are |x| <= 32), inside the frames
let yDroneGap = Infinity, minAbsX = Infinity;
const sites = droneSites();
for (let t = 0; t < 400; t += 1.3) for (const dr of sites) {
  dronePos(dr, t, P);
  yDroneGap = Math.min(yDroneGap, yc.dist(P, 40) - 4.5);
  minAbsX = Math.min(minAbsX, Math.abs(P.x));
  assert.ok(Math.hypot(P.x, P.y) < YARD.frameR - 10, 'drones stay inside the frames');
}
results.yardDroneClearM = +yDroneGap.toFixed(1); results.yardDroneMinAbsX = +minAbsX.toFixed(1);
assert.ok(yDroneGap > 1, `yard drones clear the hull, plating, dock and platforms by ${yDroneGap} m`);
assert.ok(minAbsX > WORKS.plate[0] / 2 + 8, 'yard drones keep to the flanks, clear of the crane plates');
// crew pods on their lane
let yPodGap = Infinity;
for (let t = 0; t < 2000; t += 2.1) for (let k = 0; k < 4; k++) { crewPodPos(k, t, P, V()); yPodGap = Math.min(yPodGap, yc.dist(P, 60) - 5); }
results.yardCrewPodClearM = +yPodGap.toFixed(1);
assert.ok(yPodGap > 10, `crew pods clear the dock by ${yPodGap} m`);
// hatches meet their frames; walkway brackets end inside the frame tubes
const dock = new Collider([{ geo: yd.dockGeo }], 40);
for (const z of podStops()) for (const sx of [-1, 1]) {
  const g = dock.dist(V(sx * (YARD.frameR + 0.5), 0, z + 9), 20);
  assert.ok(g < 1.5, `crew hatch at ${z} is seated on its frame (${g})`);
}
for (const z of YARD.frames.slice(1)) {
  const d = dock.dist(V(0, 246, z - 6), 20);
  assert.ok(d < 9, `walkway brackets reach the frame tube at ${z} (${d})`);
}
// no walkway on the aft frame (the house struts), none crossing a clamp
assert.ok(YARD.frames.slice(1).every((z) => z + WORKS.walk.z1 < z - 8), 'walkways stand off the frames and their clamps');

// ===================================================================== Water Store
const sd = buildWaterStore();
const sm = craftMesh(sd.geo);
t0 = now();
const sw = new StoreWorks(sm, sd);
results.storeWorksBuildMs = +(now() - t0).toFixed(1);
t0 = now(); for (let i = 0; i < 600; i++) sw.update(10 + i * 0.37, 1e4);
results.storeWorksUpdateMs = +((now() - t0) / 600).toFixed(4);
results.storeWorksTriangles = sw.triangles();
const sc = new Collider([{ geo: sd.geo }, { geo: sd.ships }, { geo: sw.data.geo }], 40);
let sDroneGap = Infinity;
for (let t = 0; t < 600; t += 2.7) sw.tanks.forEach((tk, i) => { storeDronePos(tk, i, t, P); sDroneGap = Math.min(sDroneGap, sc.dist(P, 40) - 5); });
results.storeDroneClearM = +sDroneGap.toFixed(1);
assert.ok(sDroneGap > 5, `store drones clear tanks, cage and mains by ${sDroneGap} m`);
// the mains clear the longerons (vertices) and the tanks
const rv = STORE.apothem / Math.cos(Math.PI / 8);
assert.ok(PLUMB.mainR - PLUMB.mainTube > rv + 7 + 2, 'ring mains clear the longerons');
assert.ok(Math.hypot(STORE.tankOrbit - PLUMB.mainR, PLUMB.mainLift) > STORE.tankR + PLUMB.mainTube + 2, 'ring mains clear the tanks');
assert.ok(PLUMB.mainR - PLUMB.mainTube > 193 + 20, 'nothing of the plumbing enters the climbers\' sweep');
// the risers meet the berth collars
const collar = new Collider([{ geo: sd.geo }], 40);
for (const s of [-1, 1]) assert.ok(collar.dist(V(s * PLUMB.riserX, PLUMB.riserTop, 0), 20) < 6, 'riser top meets its berth collar');

// ===================================================================== release yard
const rd = buildReleaseYard();
const rm = craftMesh(rd.geo);
t0 = now();
const rw = new ReleaseWorks(rm, rd);
results.releaseWorksBuildMs = +(now() - t0).toFixed(1);
t0 = now(); for (let i = 0; i < 600; i++) rw.update(10 + i * 0.37, 1e4);
results.releaseWorksUpdateMs = +((now() - t0) / 600).toFixed(4);
results.releaseWorksTriangles = rw.triangles();
rw.update(3, 10); assert.ok(!rw.root.visible);
const rc = new Collider([{ geo: rd.geo }, ...rd.rods.map((g) => ({ geo: g }))], 150);
const { E, U } = rd.axes;
let crawlGap = Infinity, gantryGap = Infinity;
for (let t = 0; t < 1800; t += 3.7) {
  for (let k = 0; k < RW.crawler.n; k++) {
    const s = crawlerS(k, t);
    assert.ok(s >= RW.crawler.s0 - 1e-6 && s <= RW.crawler.s1 + 1e-6 && s > RY.sparFrom + 300 + 40 && s < RY.sparTo - 400 - 40, 'crawlers stay on the lantern walk');
    for (const dz of [-30, 0, 30]) { P.copy(E).multiplyScalar(s + dz).addScaledVector(U, RW.crawler.lift + 8); crawlGap = Math.min(crawlGap, rc.dist(P, 150) - 12); }
  }
  for (const [ci, c] of rd.cradles.entries()) for (let b = 0; b < RW.gantry.bays.length; b++) {
    const z = gantryZ(ci, b, t);
    for (const hz of RY.hoops) assert.ok(Math.abs(z + 12 - hz) > 15 + 30 + 20, 'gantries keep off the hoops, their arms and winch houses');
    const r = RW.gantry.apothem / Math.cos(Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + k * Math.PI / 4;
      P.set(Math.cos(a) * r, Math.sin(a) * r, z + 12).applyMatrix4(c.frame);
      gantryGap = Math.min(gantryGap, rc.dist(P, 150) - 12);
    }
  }
}
Object.assign(results, { releaseCrawlerClearM: +crawlGap.toFixed(1), releaseGantryClearM: +gantryGap.toFixed(1) });
assert.ok(crawlGap > 1, `spar crawlers clear the yard by ${crawlGap} m`);
assert.ok(gantryGap > 5, `inspection gantries clear the cradles by ${gantryGap} m`);
assert.ok(RW.gantry.apothem - 10 > RY.apothem + 22 + 30, 'the gantry rings stay outside the hoops (the liners pass inside)');

// ===================================================================== totals
results.totalLifeTriangles = results.terraceLifeTriangles + results.harbourLifeTriangles + results.yardWorksTriangles + results.storeWorksTriangles + results.releaseWorksTriangles;
results.totalUpdateMs = +(results.harbourLifeUpdateMs + results.yardWorksUpdateMs + results.storeWorksUpdateMs + results.releaseWorksUpdateMs).toFixed(4);
assert.ok(results.totalLifeTriangles < 10e6, 'the domain stays inside its rendered-triangle budget');
assert.ok(results.totalLifeTriangles > 300e3, 'the domain draws substantive detail');
assert.ok(results.totalUpdateMs < 0.3, `per-frame cost ${results.totalUpdateMs} ms`);
void placeMerge;
console.log(JSON.stringify(results));
console.log('VERIFY_GEO_OK');
