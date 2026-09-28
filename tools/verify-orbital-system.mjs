// Checks for the orbital system added in the space-b refinement and round 2 (the Refuge's docks,
// the release yard, the Helianth's tugs, the foundry's unloading, Selene's wheel): the Geostationary Roads
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
import { buildHaloArch, haloArchAngles, ringBasis } from '../src/space/rings.js';
import { RINGS } from '../src/sky/celestial.js';
import { HALO_PORTS } from '../src/space/earthData.js';
import { bodyDir } from '../src/space/sim.js';
import { buildHearthRefuge, buildRefugeApproach, RS } from '../src/space/hearth.js';
import { buildRefugeSleeves, galleryLoop, buildGalleryStubs, buildFeeder, SLEEVE } from '../src/space/hearthWorks.js';
import { buildReleaseYard, releasePose, YARD as RYARD } from '../src/space/releaseYard.js';
import { buildCounterworks } from '../src/space/stations.js';
import { buildCounterweightRock } from '../src/space/counterweightRock.js';
import { helianthCircuits, circuitPose, helianthRelays } from '../src/space/helianthTraffic.js';
import { buildSolarCollector, buildFoundry } from '../src/space/workingStations.js';
import { buildFoundryUnload } from '../src/space/foundryUnload.js';
import { buildRefinery } from '../src/craft/craftGeometry.js';
import { captureOpen, seleneLanes } from '../src/space/fleet.js';

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
  const c = plans.find((p) => p.arm === 3), a = c.stage, b = c.gateD;
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
// ---- the Halo's hub arches: closed, clear of the glass vault everywhere, seated on the wall
// crests outboard of the glass, below the 6 km transfer altitude, and never near a port
{
  const def = RINGS[0], arch = buildHaloArch(def), P = arch.profile;
  closed('halo-arch', arch.geo, 1e-6);
  const p = arch.geo.attributes.position;
  let vault = Infinity, top = -Infinity, feetInner = Infinity, footBottom = Infinity;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    if (Math.abs(x) <= P.hw) vault = Math.min(vault, y - P.rf(x));
    top = Math.max(top, y);
    if (y < P.wall + 0.6) feetInner = Math.min(feetInner, Math.abs(x) - P.hw);   // near the crest
    footBottom = Math.min(footBottom, y);
  }
  assert.ok(vault > 0.2, `arch clears the vault's analytic profile by ${(vault * 1000).toFixed(0)} m`);
  assert.ok(feetInner > 0.01, 'no arch vertex reaches inside the glass edge at the wall crest');
  assert.ok(Math.abs(footBottom - P.wall) < 1e-6, 'corbels sit exactly on the wall crest');
  assert.ok(top < 6.0 - 0.3, `arch crest ${top.toFixed(2)} km stays under the 6 km transfer paths`);
  // positive control: the original tube hugging the vault 360 m up at 0.24 radius sagged to 47 m
  assert.ok(P.clear - 0.36 > 0.05);
  const basis = ringBasis(def);
  const ports = HALO_PORTS.map((q) => bodyDir(0, THREE.MathUtils.degToRad(q.lon)));
  const foundry = bodyDir(0, THREE.MathUtils.degToRad(166.9) + 0.009);
  const angles = haloArchAngles(def, basis, [...ports.map((d) => [d, 32]), [foundry, 12]]);
  for (const th of angles) {
    const d = basis.a.clone().multiplyScalar(Math.cos(th)).addScaledVector(basis.b, Math.sin(th));
    for (const q of ports) assert.ok(Math.acos(Math.min(1, d.dot(q))) * basis.R > 32, 'no arch within 32 km of a port station');
  }
  assert.ok(angles.length > 280 && angles.length < 314, `${angles.length} hub arches`);
  results.haloArches = angles.length; results.archVaultClearanceMetres = +(vault * 1000).toFixed(0); results.archCrestKm = +top.toFixed(2);
}

// ==== round 2: the working places (the Refuge's docks and gallery, the release yard, the
// Helianth's circuits, the foundry's unloading, Selene's wheel) ====
const verts = (g, m = new THREE.Matrix4(), step = 1) => { const p = g.attributes.position, out = []; for (let i = 0; i < p.count; i += step) out.push(V().fromBufferAttribute(p, i).applyMatrix4(m)); return out; };
// ---- the Hearth Refuge (km, refuge frame)
{
  const refuge = buildHearthRefuge(), root = V(Math.cos(0.82) * 30 * RS, 0, Math.sin(0.82) * 30 * RS).sub(V(Math.cos(0.82) * 944, 32, Math.sin(0.82) * 944));
  const approach = buildRefugeApproach(root);
  const fixedT = tree([...tris(refuge.geo, new THREE.Matrix4(), 1), ...tris(approach.geo, new THREE.Matrix4(), 1)]);
  // rotor envelopes: everything that turns stays within r <= 13.4 km and |y -/+ 8| <= 1.35 km
  const inRotor = (p) => Math.hypot(p.x, p.z) < 13.45 && (Math.abs(p.y - 8) < 1.4 || Math.abs(p.y + 8) < 1.4);
  const sl = buildRefugeSleeves(refuge.docks);
  closed('refuge-sleeves', sl.sleeves, 1e-6);
  for (const [i, g] of sl.ships.entries()) closed(`refuge-carrier-${i}`, g, 1e-6);
  const shipT = sl.ships.map((g) => probe(g));
  for (const [i, b] of sl.berths.entries()) {
    ray.set(b.face.clone().add(V(0, 0, -0.05)), V(0, 0, 1)); ray.far = 1;
    const hit = ray.intersectObject(shipT[i], false)[0];
    assert.ok(hit && Math.abs(hit.point.z - SLEEVE.face) < 0.001, `carrier ${i} bow meets its sleeve face (${hit ? ((hit.point.z - SLEEVE.face) * 1000).toFixed(2) : 'miss'} m)`);
    const vs = verts(sl.ships[i], new THREE.Matrix4(), 3);
    assert.ok(!vs.some(inRotor), `carrier ${i} stays outside both wheels' sweeps`);
    let clear = Infinity;
    for (const p of vs) if (p.z > SLEEVE.face + 0.25) clear = Math.min(clear, dist(fixedT, p, clear + 1));
    assert.ok(clear > 0.2, `carrier ${i} hull clears the Refuge by ${(clear * 1000).toFixed(0)} m beyond its bow`);
    results[`refugeCarrier${i}ClearanceMetres`] = +(clear * 1000).toFixed(0);
  }
  // the gallery loop: two shuttles, half a loop apart, clear of everything but their stubs
  const loop = galleryLoop(approach.path[0], approach.path[1]);
  const stubs = buildGalleryStubs(loop);
  closed('refuge-gallery-stubs', stubs, 1e-6);
  const stubT = tree(tris(stubs, new THREE.Matrix4(), 1));
  const allT = tree([...tris(refuge.geo, new THREE.Matrix4(), 1), ...tris(approach.geo, new THREE.Matrix4(), 1), ...sl.ships.flatMap((g) => tris(g, new THREE.Matrix4(), 1))]);
  const shR = 0.42, P = V(), F = V(), U = V(), P2 = V();
  let loopClear = Infinity, stubClear = Infinity, pair = Infinity, hatchErr = 0;
  for (let t = 0; t < loop.T; t += 0.5) {
    loop.pose(t + loop.T / 2, P2, F, U);
    loop.pose(t, P, F, U);
    loopClear = Math.min(loopClear, dist(allT, P) - shR);
    assert.ok(!inRotor(P), 'gallery shuttle keeps out of the wheels');
    pair = Math.min(pair, P.distanceTo(P2));
    // the hatch: over the ship's back, ahead of its centre
    const hatch = P.clone().addScaledVector(U, loop.hatch.y).addScaledVector(F, loop.hatch.z);
    const dStub = dist(stubT, hatch);
    // docked (the hatch on the collar face), on the final radial approach, or under way
    const toEnd = Math.min(...loop.stubs.map((s) => s.end.distanceTo(hatch)));
    if (toEnd < 0.0005) hatchErr = Math.max(hatchErr, dStub); else if (toEnd > 0.35) stubClear = Math.min(stubClear, dStub);
  }
  assert.ok(loopClear > 0.5, `gallery shuttles clear the Refuge, its gallery and its carriers by ${loopClear.toFixed(2)} km`);
  assert.ok(pair > 5, `the two gallery shuttles keep ${pair.toFixed(1)} km apart`);
  assert.ok(hatchErr < 0.002, `docked shuttle hatches meet their stub collars (${(hatchErr * 1000).toFixed(2)} m)`);
  assert.ok(stubClear > 0.03, `moving shuttles' hatches clear the stubs by ${(stubClear * 1000).toFixed(0)} m`);
  const a0 = approach.path[0], b0 = approach.path[1], ab = b0.clone().sub(a0);
  for (const st of loop.stubs) {
    const t = THREE.MathUtils.clamp(st.start.clone().sub(a0).dot(ab) / ab.lengthSq(), 0, 1);
    assert.ok(a0.clone().addScaledVector(ab, t).distanceTo(st.start) < 0.7 - 0.07, 'every transfer stub is rooted inside the gallery tube');
  }
  // the feeder: outside the disc, inside the collector line; its stream falls into the disc
  const fd = buildFeeder();
  closed('feeder-injector', fd.injector, 1e-6);
  const fr = Math.hypot(fd.pos.x, fd.pos.z);
  assert.ok(fr > 15 * RS + 50 && fr < 30 * RS - 100, `feeder at ${fr.toFixed(0)} km: clear of the disc and the collector ring`);
  const end = fd.stream.pts[fd.stream.pts.length - 1], rEnd = Math.hypot(end.x, end.z);
  assert.ok(rEnd < 15 * RS * 0.6 && Math.abs(end.y) < 1e-6 && rEnd > 2 * RS, `the stream ends in the disc plane at ${rEnd.toFixed(0)} km`);
  assert.ok(fd.stream.pts.every((p, i, a) => !i || Math.hypot(p.x, p.z) <= Math.hypot(a[i - 1].x, a[i - 1].z) + 1e-6), 'the stream only ever falls inward');
  results.refugeLoopClearanceKm = +loopClear.toFixed(2); results.feederRadiusKm = +fr.toFixed(0); results.streamEndKm = +rEnd.toFixed(0);
}
// ---- the counterweight's release yard (metres, counterweight frame)
{
  const rock = buildCounterweightRock(), cw = buildCounterworks({ surfaceRadius: rock.surfaceRadius });
  const liner = buildLiner(2400);
  const yd = buildReleaseYard(liner.geo);
  closed('release-yard', yd.geo, 1e-3);
  yd.rods.forEach((g, i) => closed(`release-rod-${i}`, g, 1e-3));
  const cwT = tree(tris(cw.geo, new THREE.Matrix4(), 1));
  const rockT = tree(tris(rock.geo, new THREE.Matrix4().makeScale(1000, 1000, 1000), 1));
  const E = yd.axes.E, N = yd.axes.N;
  const rootPts = [E.clone().multiplyScalar(RYARD.ringR), ...[-1, 1].map((sd) => E.clone().multiplyScalar(Math.cos(RYARD.stayRoot)).addScaledVector(N, sd * Math.sin(RYARD.stayRoot)).multiplyScalar(RYARD.ringR))];
  const yv = verts(yd.geo, new THREE.Matrix4(), 2).filter((p) => rootPts.every((r) => p.distanceTo(r) > 1600));
  let cwClear = Infinity;
  for (const p of yv) cwClear = Math.min(cwClear, dist(cwT, p, cwClear + 1), dist(rockT, p, cwClear + 1));
  assert.ok(cwClear > 200, `the release yard clears the counterworks and the rock by ${cwClear.toFixed(0)} m away from its ring saddles`);
  for (const r of rootPts) assert.ok(dist(cwT, r.clone().multiplyScalar((RYARD.ringR + RYARD.ringTube - 30) / RYARD.ringR)) < 60, 'yard saddles sit on the habitat ring tube');
  for (const c of [...yd.clampsFixed, ...yd.clampsMoving]) assert.ok(c.rodTo.distanceTo(c.contact) < 1e-6, 'every clamp rod ends on its surveyed contact');
  const lg = liner.geo, lp = V(), lf = V();
  const linerAt = (u) => { releasePose(u, yd, lp, lf); return new THREE.Matrix4().makeBasis(yd.axes.N, yd.axes.U, lf).setPosition(lp); };
  const heldT = tree(tris(lg, linerAt(0.4), 1));
  for (const c of yd.clampsMoving) assert.ok(dist(heldT, c.contact) < 0.5, 'released-liner clamps meet the hull while held');
  const heldFixedT = tree(tris(lg, yd.cradles.find((c) => c.side > 0).frame, 1));
  for (const c of yd.clampsFixed) assert.ok(dist(heldFixedT, c.contact) < 0.5, 'held-liner clamps meet the hull');
  // leaving: sample her run out of the cradle; drawn-back rods and the whole yard stay clear
  const movingRodPts = yd.clampsMoving.flatMap((c, i) => verts(yd.rods[i]).map((p) => p.addScaledVector(c.dirW, -c.retract)));
  const yardT = tree(tris(yd.geo, new THREE.Matrix4(), 1));
  const linerPts = verts(lg, new THREE.Matrix4(), 9);
  let runClear = Infinity;
  for (let u = 0.6; u < 0.75; u += 0.002) {
    const m = linerAt(u);
    if (lp.distanceTo(yd.cradles.find((c) => c.side < 0).center) > 3500) break;
    const T2 = tree(tris(lg, m, 1));
    for (const q of movingRodPts) runClear = Math.min(runClear, dist(T2, q, runClear + 1));
    for (const q of linerPts) runClear = Math.min(runClear, dist(yardT, q.clone().applyMatrix4(m), runClear + 1));
  }
  assert.ok(runClear > 15, `the released liner leaves the cradle clear of the yard and its drawn-back clamps by ${runClear.toFixed(0)} m`);
  results.releaseYardWorksClearanceMetres = +cwClear.toFixed(0); results.releaseRunClearanceMetres = +runClear.toFixed(0);
}
// ---- the Helianth's tug circuits (metres, station frame)
{
  const sc = buildSolarCollector();
  const stT = tree(tris(sc.geo, new THREE.Matrix4(), 1));
  const circuits = helianthCircuits(), tugR = 230, P = V(), F = V();
  const col = sc.service.approach;
  let clear = Infinity, apart = Infinity;
  for (let t = 0; t < 460; t += 0.5) {
    const ps = circuits.map((c) => { circuitPose(c, t, P, F); return P.clone(); });
    for (const p of ps) {
      clear = Math.min(clear, dist(stT, p, clear + tugR) - tugR);
      assert.ok(!(p.x > col.min.x - tugR && p.x < col.max.x + tugR && p.y > col.min.y && p.y < col.max.y + 400 && p.z > col.min.z - tugR && p.z < col.max.z + tugR), 'no circuit enters the crown\'s reserved departure column');
    }
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) apart = Math.min(apart, ps[i].distanceTo(ps[j]));
  }
  assert.ok(clear > 150, `Helianth tugs clear the station by ${clear.toFixed(0)} m`);
  assert.ok(apart > 1500, `Helianth tugs keep ${apart.toFixed(0)} m apart`);
  for (const r of helianthRelays()) assert.ok(Math.hypot(r.base.x, r.base.z) > 15500 + 1500, 'relays stand beyond the petal tips');
  results.helianthTugClearanceMetres = +clear.toFixed(0); results.helianthTugSeparationMetres = +apart.toFixed(0);
}
// ---- the tender unloading in the foundry's middle hall (metres, foundry frame)
{
  const fo = buildFoundry(), un = buildFoundryUnload();
  closed('foundry-unload', un.geo, 1e-3);
  const foT = tree(tris(fo.geo, new THREE.Matrix4(), 1));
  const bay = fo.bays[1];
  const tenderPts = verts(un.geo, new THREE.Matrix4(), 2).filter((p) => p.y < un.bridge.y - 30);
  assert.ok(tenderPts.every((p) => p.x > bay.min.x && p.x < bay.max.x && p.y > bay.min.y && p.z > bay.min.z && p.z < bay.max.z), 'the unloading tender and its relic stay inside the reserved receiving volume');
  let clear = Infinity;
  for (const p of tenderPts) clear = Math.min(clear, dist(foT, p, clear + 1));
  assert.ok(clear > 40, `the unloading tender clears the hall by ${clear.toFixed(0)} m`);
  assert.ok(Math.abs(un.bridge.y + 12 - 712) < 1e-6, 'the hoist bridge meets the gondola floors');
  assert.ok(un.spreader - 1.5 - un.relicTop < 6 + 1e-6 && un.spreader > un.relicTop, 'the spreader hangs just over the relic, its slings on its top');
  results.foundryUnloadClearanceMetres = +clear.toFixed(0);
}
// ---- Selene's wheel: closed, within its checked envelope; the capture cycle; the lanes
{
  const ref = buildRefinery(1);
  closed('selene-wheel', ref.wheel, 1e-3);
  const wp = ref.wheel.attributes.position;
  let rMax = 0, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < wp.count; i++) { rMax = Math.max(rMax, Math.hypot(wp.getX(i), wp.getZ(i))); yMin = Math.min(yMin, wp.getY(i)); yMax = Math.max(yMax, wp.getY(i)); }
  const env = ref.wheelEnvelope;
  assert.ok(rMax <= env.rMax + 1e-6 && yMin >= env.yMin - 1e-6 && yMax <= env.yMax + 1e-6, `Selene's wheel stays inside its checked envelope (r ${rMax.toFixed(0)}, y ${yMin.toFixed(0)}..${yMax.toFixed(0)})`);
  for (let t = 0; t < 400; t += 1) { const o = captureOpen(t); assert.ok(o >= 0.12 - 1e-9 && o <= 1 + 1e-9, 'capture cycle stays within the cradle range'); }
  assert.ok(Math.abs(captureOpen(0) - captureOpen(200)) < 1e-9, 'the capture cycle loops seamlessly');
  const lanes = seleneLanes({ hold: V(3.2, 5.5, 1.5), start: V(-2.5, 5.2, -2.2), dA: V(0.35, 1, 0.25).normalize(), dD: V(-0.3, 1, -0.3).normalize() });
  assert.ok(lanes.length === 64 && lanes.every((l) => l.p.length() > 5), 'Selene\'s tanker lanes: 32 beacon pairs clear of the works');
}
results.movementClearanceMetres = clearances;
results.yardClampContactErrorMetres = +clampErr.toFixed(3);
results.yardClampMinEmbedMetres = +clampEmbed.toFixed(3);
console.log(JSON.stringify(results));
console.log('ORBITAL_SYSTEM_VERIFIED');
