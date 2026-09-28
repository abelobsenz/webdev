// Checks for the orbital system added in the space-b refinement: the Geostationary Roads
// (Concord Yard, the tether Water Store, docking movements, lane buoys) and the craft docked
// at the liner. Run: node tools/verify-orbital-system.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { auditGeometry } from './geometry-audit.mjs';
import { buildConcordYard, buildWaterStore, movementPlan, movementPose, movementPhase, routeAround, MOVEMENTS, YARD, STORE, YARD_POS, STORE_POS, PHASES, armDock } from '../src/space/geoRoads.js';
import { buildBuoy } from '../src/space/lanes.js';
import { linerAttendants, approachVoyage, voyage, shuttleRun, Fleet } from '../src/space/fleet.js';
import { Elevator } from '../src/space/elevator.js';
import { buildHarbour, HS } from '../src/space/harbour.js';
import { buildLiner } from '../src/craft/craftGeometry.js';
import { buildFreighter, buildShuttle } from '../src/craft/craftClasses.js';
import { CORRIDORS } from '../src/space/stations.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z), results = {};
const closed = (name, g, tolerance = 1e-3) => {
  const a = auditGeometry(g, { tolerance });
  for (const k of ['boundaryEdges', 'nonManifoldEdges', 'inconsistentEdges', 'degenerates', 'nonFinite', 'invalidNormals']) assert.equal(a[k], 0, `${name}: ${k}=${a[k]}`);
  assert.ok(a.signedVolume > 0, `${name}: outward oriented positive volume`);
  results[name] = a.triangles; return g;
};
const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const probe = (g, m) => { const o = new THREE.Mesh(g, mat); if (m) { o.matrix.copy(m); o.matrixAutoUpdate = false; } o.updateMatrixWorld(true); return o; };
const ray = new THREE.Raycaster();

// ---- every new solid is closed, manifold and outward
const yard = buildConcordYard(), store = buildWaterStore(), buoy = buildBuoy();
closed('yard-hull', yard.hullGeo); closed('yard-dock', yard.dockGeo); closed('yard-wheel', yard.wheelGeo);
closed('store', store.geo); closed('store-tankers', store.ships); closed('lane-buoy', buoy.geo, 1e-4);
const attendants = linerAttendants(buildLiner(2400).geo);
closed('liner-attendants', attendants.geo);
// positive control: an open cylinder is caught
assert.ok(auditGeometry(new THREE.CylinderGeometry(1, 1, 2, 12, 1, true)).boundaryEdges > 0);

// ---- Concord Yard: every plated-hull clamp meets the real hull; skeleton clamps meet a rib
const hullProbe = probe(yard.hullGeo);
let clampErr = 0, clampEmbed = Infinity;
for (const c of yard.clamps) {
  const dir = c.end.clone().sub(c.root).normalize();
  ray.set(c.root, dir); ray.far = 1000;
  const hit = ray.intersectObject(hullProbe, false)[0];
  assert.ok(hit, 'clamp line reaches the hull');
  // plated hull: the surveyed contact is the surface hit; skeleton: the clamp runs to the rib's
  // centreline, so the ray meets the rib tube's skin 2.8-3.2 m before it
  const skeleton = c.z >= YARD.plated;
  clampErr = Math.max(clampErr, skeleton ? Math.abs(c.root.distanceTo(c.contact) - hit.distance - 3.0) : hit.point.distanceTo(c.contact));
  const embed = c.root.distanceTo(c.end) - hit.distance;
  clampEmbed = Math.min(clampEmbed, embed);
  assert.ok(embed > -0.01 && embed < 4.5, `clamp at z ${c.z} ends ${embed.toFixed(2)} m into the hull surface`);
  // positive control: the hull moved 10 m away along the clamp leaves it short
  const moved = probe(yard.hullGeo, new THREE.Matrix4().makeTranslation(...dir.clone().multiplyScalar(10).toArray()));
  const h2 = ray.intersectObject(moved, false)[0];
  assert.ok(!h2 || c.root.distanceTo(c.end) - h2.distance < -5, 'positive control: a displaced hull detaches the clamp');
}
assert.ok(clampErr < 0.5 && yard.clamps.length >= 40, `${yard.clamps.length} yard clamps, contact error ${clampErr} m`);
// the hoisted plate hangs clear above the bow and its cable reaches both trolley and plate
const plate = yard.stock.find((s) => s.name === 'hoisted plate');
ray.set(new THREE.Box3(plate.min, plate.max).getCenter(V()).setY(plate.min.y - 0.5), V(0, -1, 0)); ray.far = 400;
const below = ray.intersectObject(hullProbe, false)[0];
assert.ok(below && below.distance > 40, `hoisted plate clears the bow skeleton by ${below?.distance} m`);
// no hull vertex comes near a portal frame or a rail (only the clamps meet the ship; the crown
// bridge rises through the open top of the dock between the rails)
{
  const hp = yard.hullGeo.attributes.position, rv = YARD.frameR / Math.cos(Math.PI / 8);
  const oct = (k) => { const a = Math.PI / 8 + k * Math.PI / 4; return new THREE.Vector2(Math.cos(a) * rv, Math.sin(a) * rv); };
  const segDist = (p, a, b) => { const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return a.clone().addScaledVector(ab, t).distanceTo(p); };
  let frameGap = Infinity, railGap = Infinity;
  const p2 = new THREE.Vector2();
  for (let i = 0; i < hp.count; i++) {
    p2.set(hp.getX(i), hp.getY(i));
    const z = hp.getZ(i);
    for (const k of [1, 2, 5, 6]) railGap = Math.min(railGap, p2.distanceTo(oct(k)) - 6);
    for (const zf of YARD.frames) if (Math.abs(z - zf) < 14) for (let k = 0; k < 8; k++) frameGap = Math.min(frameGap, segDist(p2, oct(k), oct((k + 1) % 8)) - 8);
  }
  assert.ok(frameGap > 20 && railGap > 20, `the ship clears the frames by ${frameGap.toFixed(0)} m and the rails by ${railGap.toFixed(0)} m`);
  results.yardFrameClearanceMetres = +frameGap.toFixed(1); results.yardRailClearanceMetres = +railGap.toFixed(1);
}

// ---- Water Store: climbers pass through; grips reach the ribbon; saddles and tankers seat
{
  // the climber sweep: two guide lines at x = +/-120 m, a car radius of 73 m (plus 5 m)
  const p = store.geo.attributes.position, ix = store.geo.index;
  const a = V(), b = V(), c = V(), tri = new THREE.Triangle(a, b, c), q = V();
  let bore = Infinity;
  for (let i = 0; i < ix.count; i += 3) {
    a.fromBufferAttribute(p, ix.getX(i)); b.fromBufferAttribute(p, ix.getX(i + 1)); c.fromBufferAttribute(p, ix.getX(i + 2));
    for (const gx of [-120, 120]) {
      // distance from the vertical guide line to the triangle (sample the triangle's plane at its heights)
      for (const y of [Math.min(a.y, b.y, c.y), (a.y + b.y + c.y) / 3, Math.max(a.y, b.y, c.y)]) {
        tri.closestPointToPoint(V(gx, y, 0), q);
        bore = Math.min(bore, Math.hypot(q.x - gx, q.z));
      }
    }
  }
  assert.ok(bore > 78, `Water Store keeps the climbers' guide sweep clear by ${bore.toFixed(1)} m (car radius 73 m)`);
  const blocker = new THREE.BoxGeometry(20, 20, 20).translate(120, 0, 0);
  const bp = blocker.attributes.position; let bb = Infinity;
  for (let i = 0; i < bp.count; i++) bb = Math.min(bb, Math.hypot(bp.getX(i) - 120, bp.getZ(i)));
  assert.ok(bb < 78, 'positive control: a block on the guide line violates the sweep');
  for (const g of store.grips) assert.ok(Math.abs(Math.abs(g.inner.z) - 26) < 1e-6 && Math.abs(g.inner.x) < 40, 'grips run along z to the sheave block, clear of the guides');
  const sp = probe(store.geo);
  for (const t of store.tanks) {
    const d = t.center.clone().sub(t.root).normalize();
    ray.set(t.root, d); ray.far = 1000;
    const hits = ray.intersectObject(sp, false).map((h) => h.distance);
    const shell = t.root.distanceTo(t.center) - t.radius;
    assert.ok(hits.some((x) => Math.abs(x - shell) < 1.5), 'every tank shell is on its saddle line');
  }
  const tanker = buildFreighter(560);
  for (const b of store.berths) {
    const ship = probe(tanker.geo, b.matrix);
    ray.set(b.face.clone().addScaledVector(b.forward, 30), b.forward.clone().negate()); ray.far = 60;
    const bow = ray.intersectObject(ship, false)[0];
    assert.ok(bow, 'tanker bow found');
    const gap = bow.point.distanceTo(b.face) * Math.sign(bow.point.clone().sub(b.face).dot(b.forward.clone().negate()));
    assert.ok(Math.abs(gap) < 1.0, `tanker bow meets its collar face (${gap.toFixed(2)} m)`);
    // the berthed tanker (radiators included) clears every tank shell
    const tp = tanker.geo.attributes.position, v = V();
    let clear = Infinity;
    for (let i = 0; i < tp.count; i += 7) { v.fromBufferAttribute(tp, i).applyMatrix4(b.matrix); for (const t of store.tanks) clear = Math.min(clear, v.distanceTo(t.center) - t.radius); }
    assert.ok(clear > 40, `berthed tanker clears the tank rings by ${clear.toFixed(0)} m`);
  }
}

// ---- liner attendants: dorsal hatch seated 0.3 m into the keel collar face
for (const d of attendants.docks) assert.ok(Math.abs(d.hatch.y - d.face.y - 0.3) < 1e-6 && Math.hypot(d.hatch.x - d.face.x, d.hatch.z - d.face.z) < 1e-6, 'shuttle hatch meets the collar face');

// ---- Harbour movements: the whole route clears every static Harbour triangle
const harbour = buildHarbour();
function tris(g, m = new THREE.Matrix4(), s = 1e-3) {
  const out = [], p = g.attributes.position, ix = g.index;
  const M = new THREE.Matrix4().makeScale(s, s, s).premultiply(m);
  for (let i = 0; i < (ix?.count ?? p.count); i += 3) out.push(new THREE.Triangle(...[0, 1, 2].map((j) => V().fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j).applyMatrix4(M))));
  return out;
}
function tree(t) {
  const box = new THREE.Box3();
  for (const x of t) { box.expandByPoint(x.a); box.expandByPoint(x.b); box.expandByPoint(x.c); }
  if (t.length < 16) return { box, t };
  const s = box.getSize(V()), ax = s.x > s.y ? (s.x > s.z ? 'x' : 'z') : (s.y > s.z ? 'y' : 'z');
  t.sort((a, b) => a.a[ax] + a.b[ax] + a.c[ax] - b.a[ax] - b.b[ax] - b.c[ax]);
  const h = t.length >> 1; return { box, l: tree(t.slice(0, h)), r: tree(t.slice(h)) };
}
const np = V();
function dist(T, p, best = Infinity) {
  if (T.box.distanceToPoint(p) > best) return best;
  if (T.t) { for (const x of T.t) { x.closestPointToPoint(p, np); best = Math.min(best, np.distanceTo(p)); } return best; }
  const [n, f] = T.l.box.distanceToPoint(p) < T.r.box.distanceToPoint(p) ? [T.l, T.r] : [T.r, T.l];
  return dist(f, p, dist(n, p, best));
}
const staticTris = [...tris(harbour.body), ...tris(harbour.shipsBigGeo), ...tris(harbour.shipsSmallGeo)];
// the rotating rings and the sun-tracking wings, swept: sample their full turn
for (const r of harbour.rings) for (let k = 0; k < 6; k++) staticTris.push(...tris(r.geo, new THREE.Matrix4().makeRotationY(k * Math.PI / 3)).filter((_, i) => i % 3 === 0));
for (const root of harbour.wingRoots) for (let k = 0; k < 8; k++) {
  const m = new THREE.Matrix4().makeTranslation(root.x, root.y, root.z).multiply(new THREE.Matrix4().makeRotationZ(k * Math.PI / 8)).multiply(new THREE.Matrix4().makeRotationY(root.z < 0 ? Math.PI : 0));
  staticTris.push(...tris(harbour.wingGeo, m, 1).map((t) => new THREE.Triangle(t.a.multiplyScalar(1e-3), t.b.multiplyScalar(1e-3), t.c.multiplyScalar(1e-3))));
}
// the docked liner at its pier
{
  const p = harbour.pier, x = V().crossVectors(V(0, 1, 0), p.fwd).normalize();
  staticTris.push(...tris(buildLiner(2400).geo, new THREE.Matrix4().makeBasis(x, V(0, 1, 0), p.fwd).setPosition(p.pos)));
}
const H = tree(staticTris);
const fr = buildFreighter(1100);
fr.geo.computeBoundingBox();
const frBox = fr.geo.boundingBox;
const clearances = [];
const plans = MOVEMENTS.map((m) => {
  const c = movementPlan(harbour.arms, m.arm, m);
  c.departure = [c.stage.clone(), c.stage.clone().addScaledVector(c.dock.d, 1.6), ...routeAround(c.stage, c.gateD, 16.5, 2.5), c.gateD.clone().addScaledVector(c.dD, -3), c.gateD.clone()];
  c.approach = [c.gateA.clone(), c.gateA.clone().addScaledVector(c.dA, -3), ...routeAround(c.gateA, c.stage, 17, 1.5), c.stage.clone().addScaledVector(c.dock.d, 2.2), c.stage.clone()];
  return c;
});
for (const c of plans) {
  const s = c.scale * 1e-3;
  let worst = Infinity;
  // sample the ship's spine (stern to 60 m behind the bow) and its radiator tips
  const spine = [];
  // the freighter's real envelope by station: drive bell, cross radiators, tank rings, crew bow
  const envelope = (z) => (z < -377 ? 70 : z < -123 ? 270 : z < 392 ? 62 : 41);
  for (let z = frBox.min.z; z < frBox.max.z - 60; z += 20) spine.push([V(0, 0, z), envelope(z)]);
  const pos = V(), fwd = V(), q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), x = V(), y = V();
  for (let i = 0; i <= 2000; i++) {
    const u = i / 2000;
    const [ph] = movementPhase(u);
    movementPose(u, c, pos, fwd);
    if (pos.length() > 60) continue;                        // far out on the road
    x.crossVectors(V(0, 1, 0), fwd).normalize(); y.crossVectors(fwd, x);
    m4.makeBasis(x, y, fwd.clone().normalize()).setPosition(pos);
    const berthing = ph === 'dock' || ph === 'stay' || ph === 'back';
    for (const [p0, r] of spine) {
      // alongside the docking face only the bow meets the Harbour (checked below)
      if (berthing && p0.z > frBox.max.z - 160) continue;
      const w = p0.clone().multiplyScalar(s).applyMatrix4(m4);
      const d = dist(H, w) - r * s;
      if (d < worst) worst = d;
    }
    assert.ok(worst > 0.05, `movement to arm ${c.arm} (${ph}) passes within ${(worst * 1000).toFixed(0)} m of the Harbour`);
  }
  // berthed: the bow is seated at the docking face and the hull behind it is clear
  movementPose(0.6, c, pos, fwd);
  const bowTip = pos.clone().addScaledVector(fwd.clone().normalize(), frBox.max.z * s);
  const face = dist(H, bowTip);
  assert.ok(face < 0.002, `bow of the berthed ship at arm ${c.arm} touches the docking face (${(face * 1000).toFixed(1)} m)`);
  clearances.push(+(worst * 1000).toFixed(0));
}
// positive control: a route straight across the Harbour from arm 3's stage to the departure gate
{
  const c = plans[0], a = c.stage, b = c.gateD;
  let hit = false;
  for (let k = 0; k <= 200; k++) if (dist(H, a.clone().lerp(b, k / 200)) < 0.1) hit = true;
  assert.ok(hit, 'positive control: the direct departure line crosses the Harbour');
}
// movements keep apart from each other, from the yard and the store at all times
{
  const yardC = YARD_POS, storeC = STORE_POS, rShip = (c) => 0.3 * c.scale + 0.6;
  let minPair = Infinity, minYard = Infinity;
  const p = plans.map(() => V()), f = V(), lv = approachVoyage(), lp = V();
  let minLiner = Infinity;
  for (let t = 0; t < 40000; t += 2) {
    plans.forEach((c, i) => movementPose((((t / c.T) + c.offset) % 1 + 1) % 1, c, p[i], f));
    voyage((((t / lv.T) + lv.offset) % 1 + 1) % 1, lv, lp, f);
    for (let i = 0; i < plans.length; i++) {
      minYard = Math.min(minYard, p[i].distanceTo(yardC) - rShip(plans[i]) - yard.radius, p[i].distanceTo(storeC) - rShip(plans[i]) - store.radius);
      minLiner = Math.min(minLiner, p[i].distanceTo(lp) - rShip(plans[i]) - 1.45);
      for (let j = i + 1; j < plans.length; j++) minPair = Math.min(minPair, p[i].distanceTo(p[j]) - rShip(plans[i]) - rShip(plans[j]));
    }
  }
  assert.ok(minPair > 0.5, `movements keep ${minPair.toFixed(2)} km apart`);
  assert.ok(minLiner > 1, `movements keep ${minLiner.toFixed(2)} km from the visiting liner`);
  // and from the tugs, courier and shuttle working the Harbour's own short runs
  const runtime = { scene: new THREE.Scene(), earthFixed: new THREE.Group(), bodies: [], addBody() {} };
  runtime.elevator = new Elevator({}, { climbers: 60 });
  const fleet = new Fleet(runtime);
  let minRun = Infinity;
  const rp = V(), rf = V();
  for (let t = 0; t < 40000; t += 1.5) {
    plans.forEach((c, i) => movementPose((((t / c.T) + c.offset) % 1 + 1) % 1, c, p[i], f));
    for (const r of fleet.runs) { shuttleRun(t, r, rp, rf); for (let i = 0; i < plans.length; i++) minRun = Math.min(minRun, p[i].distanceTo(rp) - rShip(plans[i]) - 0.12); }
  }
  assert.ok(minRun > 1, `movements keep ${minRun.toFixed(2)} km from the Harbour's tug and courier runs`);
  results.runSeparationKm = +minRun.toFixed(2);
  results.linerVoyageSeparationKm = +minLiner.toFixed(2);
  assert.ok(minYard > 2, `movements pass the yard and store at ${minYard.toFixed(2)} km`);
  results.movementSeparationKm = +minPair.toFixed(2); results.yardStoreClearanceKm = +minYard.toFixed(2);
}
// the yard and the store stand clear of the Harbour and of both corridors' approach cones
{
  const yb = YARD_POS, sb = STORE_POS;
  assert.ok(dist(H, yb) > yard.radius + 3 && dist(H, sb) > store.radius + 3, 'yard and store stand clear of the Harbour');
  for (const d of [CORRIDORS.dA, CORRIDORS.dD]) for (const c of [yb, sb]) {
    const t = Math.max(c.dot(d), 0), off = c.clone().sub(d.clone().multiplyScalar(t)).length();
    assert.ok(off > 8, `yard/store stand ${off.toFixed(1)} km off a corridor axis`);
  }
}
results.movementClearanceMetres = clearances;
results.yardClampContactErrorMetres = +clampErr.toFixed(3);
results.yardClampMinEmbedMetres = +clampEmbed.toFixed(3);
console.log(JSON.stringify(results));
console.log('ORBITAL_SYSTEM_VERIFIED');
