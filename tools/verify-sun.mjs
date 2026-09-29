// The sun domain's working places, headless: the Helianth district and its flotilla, the foundry
// yard and the Hearth district. Seating, clearances of every moving part, triangle counts per LOD,
// finite transforms, build and per-frame timings. Run: node tools/verify-sun.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { auditGeometry } from './geometry-audit.mjs';
import { buildSolarCollector, buildFoundry } from '../src/space/workingStations.js';
import { helianthCircuits, circuitPose } from '../src/space/helianthTraffic.js';
import {
  HelianthDistrict, buildPetalFittings, buildCrawler, buildBerths, petalMatrix, petalTop, spineY, DECK_TOP, CATWALK, CREW_LANE, crawlerZ, crewOnCatwalk,
  flotillaLayout, courierRoute, courierPose, COURIER, FLOTILLA, PETAL, buildConcentrator, buildRelayPlatform, BERTH,
  petalBottom, SPOKE, spokeTop, spokeCarR, buildSpokeCar, buildHubWorks, GALLERY, FIN, buildSwarmTender, tenderLocal, tenderStatites, crownCrew,
} from '../src/space/helianthDistrict.js';
import { FoundryYard, tenderVisit, VISIT, buildWheelCar, wheelCar, WHEEL, buildCraneWorks, cranePose, cartPose, droneOrbits, dronePos, crewPos, COURT, CRANE, CART, QUEUE } from '../src/space/foundryYard.js';
import { buildTender } from '../src/craft/craftGeometry.js';
import { Hearth, buildCollector } from '../src/space/hearth.js';
import { PATROL, patrolPose, buildRackGantry, rackGantry, RACK, buildDishTruss, backX, BACK, HAMLET, hamletMatrix, hamletAngle, buildHamletFixed, buildHamletWheel, buildStationFittings, dishDrone, dishSag, DISH, buildDishDrone, tramArc, tramAngle, RING, TRAM, tankerSlots, tankerPose, TANKER, MODULE, HearthDistrict } from '../src/space/hearthDistrict.js';
import { buildFeeder } from '../src/space/hearthWorks.js';
import { SunSwarm } from '../src/space/sun.js';
import { SpaceSim } from '../src/space/sim.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), results = {}, I = new THREE.Matrix4();
const placeMergeT = (te) => { const g = [te.geo, ...te.arms.map((a) => a.geo)].map((x) => x.index ? x.toNonIndexed() : x); const pos = g.flatMap((x) => Array.from(x.attributes.position.array)); const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return out; };
function tris(g, m = I, s = 1, step = 1) {
  const out = [], p = g.attributes.position, ix = g.index;
  const M = new THREE.Matrix4().makeScale(s, s, s).premultiply(m);
  for (let i = 0; i < (ix?.count ?? p.count); i += 3 * step) out.push(new THREE.Triangle(...[0, 1, 2].map((j) => V().fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j).applyMatrix4(M))));
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
const verts = (g, m = I, step = 1) => { const p = g.attributes.position, out = []; for (let i = 0; i < p.count; i += step) out.push(V().fromBufferAttribute(p, i).applyMatrix4(m)); return out; };
const finite = (g) => g.attributes.position.array.every(Number.isFinite);
const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const segDist = (p, a, b) => { const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1); return a.clone().addScaledVector(ab, t).distanceTo(p); };
const time = (f) => { const t0 = performance.now(); const r = f(); return [r, performance.now() - t0]; };
const closed = (name, g, tol = 1e-3) => {
  const a = auditGeometry(g, { tolerance: tol });
  for (const k of ['nonManifoldEdges', 'inconsistentEdges', 'nonFinite']) assert.equal(a[k], 0, `${name}: ${k}=${a[k]}`);
  results[`${name}Tris`] = a.triangles;
};

// ============================================================ the Helianth district (metres)
const sc = buildSolarCollector();
const stT = tree(tris(sc.geo));
{
  const f = buildPetalFittings();
  assert.ok(finite(f.geo), 'petal fittings finite');
  closed('petalFittings', f.geo);
  // the catwalk deck bears on the spine: straight below the deck's centre line the spine's skin
  // lies within the metre the deck is seated into it
  for (let z = CATWALK.z0 + 100; z < CATWALK.z1; z += 911) {
    const under = DECK_TOP(z) - CATWALK.deck, d = dist(stT, V(0, under, z));
    assert.ok(d < 1.6 + PETAL.spineR * (1 - Math.cos(Math.PI / 8)), `catwalk at z ${z} seated on the spine (${d.toFixed(2)} m)`);
    assert.ok(Math.abs(spineY(z) + PETAL.spineR * Math.cos(Math.PI / 8) - (under + 1)) < 1e-9, 'deck seated a metre into the spine flats');
  }
  // coolant lines: the lowest point of each pipe is within a few metres of the petal skin
  let pipeGap = 0;
  for (let z = 1900; z < 14200; z += 997) for (const sd of [-1, 1]) {
    const wv = 100 + 1450 * Math.pow(Math.sin(Math.PI * (z - 1550) / 12950), 0.8), x = sd * (70 + 0.25 * (wv - 100));
    const bottom = V(x, petalTop(x, z) - 2 + 0.01, z);
    pipeGap = Math.max(pipeGap, dist(stT, bottom));
  }
  assert.ok(pipeGap < 4, `coolant lines lie on the petal skin (worst ${pipeGap.toFixed(2)} m)`);
  // receivers stand on the skin: their base is at or below the skin under all four sides
  for (const r of f.receivers) {
    const skin = Math.min(...[[-40, 0], [40, 0], [0, -55], [0, 55]].map(([dx, dz]) => petalTop(r.x + dx, r.z + dz)));
    assert.ok(r.base <= skin + 1e-6 && skin - r.base < 60, `receiver at z ${r.z.toFixed(0)} seated (${(skin - r.base).toFixed(1)} m embed)`);
    assert.ok(dist(stT, V(r.x, r.base + 3, r.z)) < 40, 'receiver base meets the petal');
  }
  // the back truss: every diagonal's upper end two metres into the underside, the chords hanging clear
  for (let z = 1900; z < 14200; z += 733) for (const sd of [-1, 1]) {
    const x = sd * 0.32 * (100 + 1450 * Math.pow(Math.sin(Math.PI * (z - 1550) / 12950), 0.8));
    const d = dist(stT, V(x, petalBottom(x, z), z));
    assert.ok(d < 2.5, `petal underside survey matches the loft at z ${z} (${d.toFixed(2)} m)`);
  }
  // facet seams lie on the skin
  let seamGap = 0;
  for (let z = 2200; z < 14000; z += 400) for (const x of [-420, 180, 660]) if (Math.abs(x) < 100 + 1450 * Math.pow(Math.sin(Math.PI * (z - 1550) / 12950), 0.8) - 60) seamGap = Math.max(seamGap, dist(stT, V(x, petalTop(x, z), z)));
  assert.ok(seamGap < 1.5, `facet seams meet the skin (${seamGap.toFixed(2)} m)`);
  // hub works: galleries seated in the wheel's hull and clear of the fin struts; risers on the fins
  {
    const h = buildHubWorks();
    closed('hubWorks', h.geo);
    const hv = verts(h.geo, I, 2);
    const onWheel = hv.filter((p) => Math.abs(Math.hypot(p.x, p.z) - GALLERY.R) < GALLERY.tube + GALLERY.proud + 5 && Math.abs(p.y - GALLERY.y) < 200);
    let deepest = 0, strutClear = Infinity;
    for (const p of onWheel) {
      const rr = Math.hypot(p.x, p.z), tubeD = Math.hypot(rr - GALLERY.R, p.y - GALLERY.y);
      deepest = Math.max(deepest, GALLERY.tube - tubeD);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2, d = V(Math.cos(a), 0, Math.sin(a)); strutClear = Math.min(strutClear, segDist(p, d.clone().multiplyScalar(4100).setY(2200), d.clone().multiplyScalar(7600).setY(3800)) - 80); }
    }
    assert.ok(deepest > 5 && deepest < GALLERY.seat + 5, `galleries seated ${deepest.toFixed(1)} m into the wheel's hull`);
    assert.ok(strutClear > 40, `galleries clear the fin struts by ${strutClear.toFixed(0)} m`);
    results.galleryStrutClearanceMetres = +strutClear.toFixed(0);
    // riser boxes (10 m thick at t/2 + 4) bite one metre into each face
    assert.ok(Math.abs(FIN.t / 2 + 4 - 5 - (FIN.t / 2 - 1)) < 1e-9, 'fin risers seated a metre into the fin faces');
    let riserGap = 0;
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2, c = V(Math.cos(a) * FIN.r, FIN.y, Math.sin(a) * FIN.r), n = V(-Math.sin(a), 0, Math.cos(a)); riserGap = Math.max(riserGap, dist(stT, c.clone().addScaledVector(n, FIN.t / 2 - 1).addScaledVector(V(Math.cos(a), 0, Math.sin(a)), -1500 + 100 + 140 * 3))); }
    assert.ok(riserGap < 2, `fin faces under the risers (${riserGap.toFixed(2)} m)`);
  }
  // lift cars on the wheel spokes: wheels on the spoke crown, the car clear of hub, wheel and hoops
  {
    const cg = buildSpokeCar(), cb = new THREE.Box3().setFromBufferAttribute(cg.attributes.position);
    assert.ok(Math.abs(cb.min.y) < 1e-6, 'lift car running gear at its origin');
    let carClear = Infinity;
    for (let t = 0; t < SPOKE.T; t += 3) for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2, r = spokeCarR(k, t), d = V(Math.cos(a), 0, Math.sin(a)), tg = V(-d.z, 0, d.x);
      assert.ok(dist(stT, d.clone().multiplyScalar(r).setY(spokeTop() - 0.5)) < 5, 'lift car bears on its spoke');
      for (const dr of [cb.min.z, cb.max.z]) for (const dt of [cb.min.x, cb.max.x]) carClear = Math.min(carClear, dist(stT, d.clone().multiplyScalar(r + dr).addScaledVector(tg, dt).setY(spokeTop() + cb.max.y), carClear + 1));
      for (const dr of [cb.min.z, cb.max.z]) carClear = Math.min(carClear, dist(stT, d.clone().multiplyScalar(r + dr).setY(spokeTop() + 20), carClear + 1));
    }
    assert.ok(carClear > 10, `lift cars clear the hub, the wheel and its hoops by ${carClear.toFixed(0)} m`);
    results.spokeCarClearanceMetres = +carClear.toFixed(0);
  }
  // tugs keep clear of all twelve petals' fittings and the berths
  const fitT = tree([...Array.from({ length: PETAL.count }, (_, k) => tris(f.geo, petalMatrix(k), 1, 2)).flat(), ...tris(buildBerths().geo), ...tris(buildHubWorks().geo)]);
  const circuits = helianthCircuits(), P = V(), F = V();
  let clear = Infinity;
  for (let t = 0; t < 460; t += 1) for (const c of circuits) { circuitPose(c, t, P, F); clear = Math.min(clear, dist(fitT, P, clear + 230) - 230); }
  assert.ok(clear > 150, `Helianth tugs clear the petal fittings and berths by ${clear.toFixed(0)} m`);
  results.tugFittingClearanceMetres = +clear.toFixed(0);
  results.petalFittingsTotalTris = triCount(f.geo) * PETAL.count;
}
// crawlers stay between the railings and on the deck; the crews walk beside them
{
  const cg = buildCrawler(), bb = new THREE.Box3().setFromBufferAttribute(cg.attributes.position);
  assert.ok(Math.max(-bb.min.x, bb.max.x) < CATWALK.half - 0.3 - 0.12 - 0.5, `crawler (${bb.max.x.toFixed(1)} m half-width) fits between the railings`);
  assert.ok(Math.abs(bb.min.y) < 1e-6, 'crawler wheels touch the deck');
  assert.ok(CREW_LANE - 0.4 > bb.max.x + 0.5 && CREW_LANE + 0.4 < CATWALK.half - 0.42, 'crew lanes pass between crawler and railing');
  for (let t = 0; t < 1800; t += 7) for (let k = 0; k < PETAL.count; k++) {
    const z = crawlerZ(t, k);
    assert.ok(z > CATWALK.z0 + 20 && z < CATWALK.z1 - 20 && Number.isFinite(z), 'crawler stays on its catwalk');
  }
  const P = V();
  for (let t = 0; t < 3000; t += 13) for (let j = 0; j < PETAL.count * 4; j++) { crewOnCatwalk(j, t, P); assert.ok(P.z > CATWALK.z0 && P.z < CATWALK.z1 && Math.abs(P.y - DECK_TOP(P.z) - 1.7) < 1e-9); }
}
// berths: shuttles seated on their cradles, clear of the station; arms rooted in the hub
{
  const b = buildBerths();
  closed('berths', b.geo);
  const hubR = 1400 - 250 * (BERTH.y - 1550) / 700;
  assert.ok(BERTH.root < hubR - 40, `berth arms rooted ${(hubR - BERTH.root).toFixed(0)} m inside the hub skin`);
  for (const c of b.cradles) {
    const vs = verts(b.shipGeo, c.ship);
    const lo = Math.min(...vs.map((p) => p.y));
    assert.ok(Math.abs(lo - c.deck) < 1e-3, `berthed shuttle seated on its cradle (${(lo - c.deck).toFixed(4)} m)`);
    let cl = Infinity;
    for (const p of vs.filter((_, i) => i % 5 === 0)) cl = Math.min(cl, dist(stT, p, cl + 1));
    assert.ok(cl > 20, `berthed shuttle clears the station by ${cl.toFixed(0)} m`);
    results.berthShipClearanceMetres = Math.min(results.berthShipClearanceMetres ?? Infinity, +cl.toFixed(0));
  }
}
// flotilla and couriers
{
  const L = flotillaLayout(), con = buildConcentrator(), rel = buildRelayPlatform();
  closed('concentrator', con.geo); closed('relayPlatform', rel.geo);
  const ext = Math.max(new THREE.Box3().setFromBufferAttribute(con.geo.attributes.position).getSize(V()).length(), new THREE.Box3().setFromBufferAttribute(rel.geo.attributes.position).getSize(V()).length()) / 2;
  let sep = Infinity;
  for (let i = 0; i < L.length; i++) {
    assert.ok(L[i].p.length() - ext * L[i].size > 50000, 'statites stand well off the station');
    for (let j = i + 1; j < L.length; j++) sep = Math.min(sep, L[i].p.distanceTo(L[j].p) - ext * (L[i].size + L[j].size));
  }
  assert.ok(sep > 5000, `statites keep ${(sep / 1000).toFixed(1)} km between their extents`);
  results.statiteSeparationKm = +(sep / 1000).toFixed(1);
  const routes = Array.from({ length: COURIER.count }, (_, c) => courierRoute(c, L)), P = V(), F = V(), Q = [];
  let pathClear = Infinity, apart = Infinity, holdClear = Infinity;
  for (const r of routes) {
    holdClear = Math.min(holdClear, dist(stT, r.hold) - COURIER.len);
    // its own statite: the berth sits outside its extent
    assert.ok(r.berth.distanceTo(r.target.p) > ext * r.target.size + COURIER.len, 'courier berth clear of its statite');
  }
  for (let t = 0; t < COURIER.T; t += 1) {
    Q.length = 0;
    for (const r of routes) {
      courierPose(r, t, P, F);
      assert.ok(Number.isFinite(P.x + P.y + P.z + F.x + F.y + F.z) && Math.abs(F.length() - 1) < 1e-6, 'finite courier pose');
      // clear of the station's working field (the relays stand at 18.5 km) once past the hold
      const rr = Math.hypot(P.x, P.z);
      if (P.distanceTo(r.hold) > 1) assert.ok(rr > 20000 || P.y > 5800, `courier over the station at r ${rr.toFixed(0)} y ${P.y.toFixed(0)}`);
      for (const s of L) if (s !== r.target) pathClear = Math.min(pathClear, P.distanceTo(s.p) - ext * s.size);
      Q.push(P.clone());
    }
    for (let i = 0; i < Q.length; i++) for (let j = i + 1; j < Q.length; j++) apart = Math.min(apart, Q[i].distanceTo(Q[j]));
  }
  assert.ok(holdClear > 2000, `courier holds clear the crown by ${holdClear.toFixed(0)} m`);
  assert.ok(pathClear > 1000, `couriers pass other statites by ${pathClear.toFixed(0)} m`);
  assert.ok(apart > 150, `couriers keep ${apart.toFixed(0)} m apart`);
  results.courierStatiteClearanceKm = +(pathClear / 1000).toFixed(1); results.courierSeparationMetres = +apart.toFixed(0);
}
// swarm tenders hold off their statites' rims, clear of every facet; crown crews keep to their lanes
{
  const con = buildConcentrator(), st = buildSwarmTender(), L = flotillaLayout();
  closed('swarmTender', st.geo);
  const conT = tree(tris(con.geo, I, 1));
  let tc = Infinity;
  for (const p of verts(st.geo, tenderLocal(), 3)) tc = Math.min(tc, dist(conT, p, tc + 1));
  assert.ok(tc > 40, `swarm tenders hold ${tc.toFixed(0)} m off their statites`);
  assert.ok(Math.abs(tenderLocal().determinant() - 8) < 1e-6, 'tender placement is a proper, uniform scale');
  const ids = tenderStatites(L);
  assert.ok(ids.length >= 5 && ids.every((i) => L[i].kind === 0), `${ids.length} tenders, all at concentrators`);
  results.swarmTenderClearanceMetres = +tc.toFixed(0);
  const lanes = sc.service.crewRoutes, P = V();
  for (let t = 0; t < 600; t += 3) for (let j = 0; j < lanes.length * 4; j++) {
    crownCrew(j, t, lanes, P);
    const Lb = lanes[j % lanes.length];
    assert.ok(P.x > Lb.min.x && P.x < Lb.max.x && P.z > Lb.min.z && P.z < Lb.max.z && Math.abs(P.y - Lb.min.y - 1.7) < 1e-9, 'crown crews walk inside their EVA lanes');
  }
}
// the district as the space mode builds it: lazily, a step a frame; then its per-frame cost
{
  const station = new THREE.Group(), scene = new THREE.Scene(), bodies = [];
  const space = { scene, addBody: (n, o, c, r, opt) => { const b = { n, o, c, r, ...opt }; bodies.push(b); return b; } };
  const [d, tc] = time(() => new HelianthDistrict(station, V(0, -1, 0), space, sc.service.crewRoutes));
  const cam = V(0, 0, 50);
  const stepMs = [];
  for (let f = 0; f < 10 && !d.built; f++) stepMs.push(time(() => d.update(f * 0.016, cam))[1]);
  assert.ok(d.built && bodies.length === 1, 'district builds on approach');
  assert.ok(Math.max(...stepMs) < 120 && tc < 20, `build steps ${stepMs.map((x) => x.toFixed(0)).join('/')} ms, constructor ${tc.toFixed(1)} ms`);
  d.update(1, cam);
  assert.ok(d.near.visible && bodies[0].visible, 'near district and flotilla shown close in');
  d.update(2, V(0, 0, 9000)); assert.ok(!d.near.visible && !bodies[0].visible, 'hidden far out');
  d.update(3, cam);
  let tri = 0, inst = 0;
  const count = (o) => o.traverse((m) => { if (m.isMesh && m.geometry.index && !m.geometry.isInstancedBufferGeometry) { tri += triCount(m.geometry) * (m.isInstancedMesh ? m.count : 1); if (m.isInstancedMesh) inst++; } });
  count(station); count(d.flotilla);
  results.helianthDistrictRenderedTris = tri; results.helianthInstancedMeshes = inst;
  results.helianthBuildMs = +(stepMs.reduce((a, b) => a + b, 0) + tc).toFixed(1);
  const [, ta] = time(() => { for (let i = 0; i < 200; i++) d.update(10 + i * 0.016, cam); });
  results.helianthFrameMs = +(ta / 200).toFixed(3);
  assert.ok(ta / 200 < 0.3, `district frame ${(ta / 200).toFixed(3)} ms`);
  const bad = [];
  station.updateMatrixWorld(true); d.flotilla.updateMatrixWorld(true);
  for (const o of [station, d.flotilla]) o.traverse((m) => { if (m.isInstancedMesh && !m.instanceMatrix.array.every(Number.isFinite)) bad.push(m); if (!m.matrixWorld.elements.every(Number.isFinite)) bad.push(m); });
  assert.equal(bad.length, 0, 'finite instance and world matrices');
}

// ================================================================ the foundry yard (metres)
{
  const fo = buildFoundry(), foT = tree(tris(fo.geo));
  const works = [-1, 1].map((s) => buildCraneWorks(s));
  for (const [i, w] of works.entries()) closed(`craneWorks${i}`, w.geo);
  const allT = tree([...tris(fo.geo), ...works.flatMap((w) => tris(w.geo))]);
  // nothing enters the receiving halls
  for (const w of works) for (const p of verts(w.geo)) for (const b of fo.bays) assert.ok(!new THREE.Box3(b.min, b.max).containsPoint(p), 'crane works stay out of the receiving halls');
  // columns founded on the slab
  for (const s of [-1, 1]) for (const dx of [-CRANE.railX, CRANE.railX]) for (const z of CRANE.cols) {
    assert.ok(Math.abs(s * COURT.x + dx - s * COURT.x) < 850 - 35, 'column base plate on the slab');
    assert.ok(dist(foT, V(s * COURT.x + dx, COURT.slabTop - 0.5, z)) < 1, 'crane column meets the slab top');
  }
  // the crane's load: seated on a roof or hanging clear of the court, its spine pipe and the rails
  const c = {}, [w, h, l] = CRANE.box;
  let hangClear = Infinity, seatErr = 0;
  for (let t = 0; t < CRANE.T * 8; t += 1.5) for (const s of [-1, 1]) {
    cranePose(t, s, c);
    const cx = s * COURT.x + c.x, pts = [];
    for (const dx of [-w / 2, 0, w / 2]) for (const dz of [-l / 2, 0, l / 2]) for (const dy of [0, h]) pts.push(V(cx + dx, c.y + dy, c.z + dz));
    if (Math.abs(c.y - COURT.roofTop) < 1e-6) {
      // seated: the cassette stands on a stack roof
      const st = COURT.stacks.find((z) => Math.abs(z - c.z) < 1e-6);
      assert.ok(st !== undefined && Math.abs(c.x) + w / 2 < COURT.stackHalfX && l / 2 < COURT.stackHalfZ, `seated cassette on a stack roof (z ${c.z})`);
      seatErr = Math.max(seatErr, dist(foT, V(cx, c.y - 0.5, c.z)));
    } else if (c.y < CRANE.carry - 1e-6) {
      // lifting or lowering: straight over a stack, the load inside its roof's footprint
      assert.ok(COURT.stacks.some((z) => Math.abs(z - c.z) < 1e-6) && Math.abs(c.x) + w / 2 < COURT.stackHalfX, 'hoisting only over a stack roof');
      for (const p of pts.filter((q) => q.y > c.y + 1)) hangClear = Math.min(hangClear, dist(allT, p, hangClear + 1));
    } else {
      for (const p of pts) hangClear = Math.min(hangClear, dist(allT, p, hangClear + 1));
    }
  }
  assert.ok(seatErr < 1, `seated cassettes bear on the roof (${seatErr.toFixed(2)} m)`);
  assert.ok(hangClear > 25, `hanging cassettes clear the court, pipe and crane works by ${hangClear.toFixed(0)} m`);
  results.craneLoadClearanceMetres = +hangClear.toFixed(0);
  // carts: side lanes, clear of stacks and columns; their tracks on the slab
  const P = V();
  let cartClear = Infinity;
  const Q = V();
  for (let t = 0; t < CART.T; t += 2) for (let k = 0; k < 4; k++) {
    cartPose(t, k, P); P.x = (k < 2 ? -1 : 1) * (COURT.x + P.x);
    if (k % 2) { cartPose(t, k - 1, Q); assert.ok(Math.abs(P.z - Q.z) > CART.size[2] + 20, 'carts sharing a lane never meet'); }
    for (const dx of [-CART.size[0] / 2, CART.size[0] / 2]) for (const dz of [-CART.size[2] / 2, CART.size[2] / 2]) for (const dy of [3, CART.size[1] + 8]) cartClear = Math.min(cartClear, dist(allT, V(P.x + dx, P.y + dy, P.z + dz), cartClear + 1));
    assert.ok(dist(foT, V(P.x, P.y - 0.5, P.z)) < 1, 'cart tracks on the slab');
  }
  assert.ok(cartClear > 2.5, `carts clear stacks and crane columns by ${cartClear.toFixed(1)} m`);
  results.cartClearanceMetres = +cartClear.toFixed(1);
  // drones on clear orbits
  let droneClear = Infinity;
  for (const o of droneOrbits()) for (let k = 0; k < 96; k++) droneClear = Math.min(droneClear, dist(allT, dronePos(o, (k / 96) * o.T, P), droneClear + 11) - 10);
  assert.ok(droneClear > 60, `drones clear the works by ${droneClear.toFixed(0)} m`);
  results.droneClearanceMetres = +droneClear.toFixed(0);
  // crews on the roofs, under the pipe, clear of any seated cassette's footprint
  for (let t = 0; t < 600; t += 5) for (let j = 0; j < 24; j++) {
    crewPos(j, t, P);
    const lx = Math.abs(P.x) - COURT.x;
    assert.ok(Math.abs(lx) < CRANE.pickX - w / 2 - 20 && Math.abs(lx) > COURT.spineR + 10, 'crews walk the roof strip between the pipe and the set-down places');
    assert.ok(Math.abs(P.y - COURT.roofTop - 1.7) < 1e-9, 'crews on the roof');
  }
  // garden-wheel lift cars on their spokes
  {
    const cb = new THREE.Box3().setFromBufferAttribute(buildWheelCar().attributes.position);
    let wc = Infinity;
    for (let t = 0; t < WHEEL.T; t += 2) for (let k = 0; k < 6; k++) {
      wheelCar(k, t, P);
      const a = (k / 6) * Math.PI * 2, d = V(Math.cos(a), 0, Math.sin(a));
      assert.ok(dist(foT, P.clone().setY(P.y - 0.5)) < 5, 'wheel car bears on its spoke');
      for (const dr of [cb.min.z, cb.max.z]) wc = Math.min(wc, dist(foT, P.clone().addScaledVector(d, dr).setY(P.y + cb.max.y), wc + 1), dist(foT, P.clone().addScaledVector(d, dr).setY(P.y + 15), wc + 1));
    }
    assert.ok(wc > 8, `wheel lift cars clear the hub and rim by ${wc.toFixed(0)} m`);
    results.wheelCarClearanceMetres = +wc.toFixed(0);
  }
  // the tender queue stands off the halls
  const te = buildTender(300);
  let qClear = Infinity;
  for (const q of QUEUE) for (const p of verts(te.geo, new THREE.Matrix4().makeTranslation(q.x, q.y, q.z), 7)) qClear = Math.min(qClear, dist(foT, p, qClear + 1));
  assert.ok(qClear > 3000, `queued tenders hold ${qClear.toFixed(0)} m off the works`);
  // visiting tenders: along their halls' axes, inside the reserved volume once in, clear of the works
  const tv = verts(placeMergeT(te), I, 5);
  let vClear = Infinity;
  for (let t = 0; t < VISIT.T; t += 3) for (let i = 0; i < 3; i++) {
    tenderVisit(i, t, P);
    const bay = fo.bays.find((b) => Math.abs((b.min.x + b.max.x) / 2 - P.x) < 1);
    if (i < VISIT.bays) assert.ok(bay && bay !== fo.bays[1], 'visits use the outer halls only');
    for (const p of tv) {
      const w = p.clone().add(P);
      if (bay && w.z > bay.min.z) assert.ok(w.x > bay.min.x && w.x < bay.max.x && w.y > bay.min.y && w.y < bay.max.y, 'a visiting tender stays inside its hall volume');
      vClear = Math.min(vClear, dist(foT, w, vClear + 1));
    }
  }
  assert.ok(vClear > 40, `visiting tenders clear the halls by ${vClear.toFixed(0)} m`);
  results.tenderVisitClearanceMetres = +vClear.toFixed(0);
  results.tenderQueueClearanceMetres = +qClear.toFixed(0);
  // build and frame
  const g = new THREE.Group(), y = new FoundryYard(g, fo);
  const [, tb] = time(() => y.update(0, 100));
  assert.ok(y.built && y.root.visible && tb < 100, `yard builds on approach in ${tb.toFixed(1)} ms`);
  y.update(0, 1000); assert.ok(!y.root.visible, 'yard hidden far out');
  const [, ta] = time(() => { for (let i = 0; i < 200; i++) y.update(i * 0.016, 20); });
  results.yardFrameMs = +(ta / 200).toFixed(3); results.yardBuildMs = +tb.toFixed(1);
  assert.ok(ta / 200 < 0.3, 'yard frame under 0.3 ms');
  let tri = 0;
  g.traverse((m) => { if (m.isMesh && m.geometry.index) tri += triCount(m.geometry) * (m.isInstancedMesh ? m.count : 1); });
  results.yardRenderedTris = tri;
}

// ================================================================ the Hearth district (km)
{
  const [hearth, th] = time(() => new Hearth({}, { bhSteps: 110, bhScale: 0.6 }));
  const d = hearth.district;
  results.hearthConstructMs = +th.toFixed(0);
  const [, td] = time(() => new HearthDistrict(hearth));       // (a second copy, only to time it)
  results.hearthDistrictBuildMs = +td.toFixed(1);
  assert.ok(td < 300, `Hearth district builds in ${td.toFixed(0)} ms`);
  // fittings: behind the hab's far end, clear of every support and brace
  const f = buildStationFittings();
  closed('stationFittings', f.geo);
  const fv = verts(f.geo, I, 3);
  assert.ok(fv.every((p) => p.x < MODULE.x0 + 1e-6), 'all fittings lie behind the hab end');
  assert.ok(MODULE.x0 > -5.12 && 0.5 < 0.96, 'the drum is seated in the hab end cap');
  let supClear = Infinity;
  for (const [i, m] of hearth.collectorMounts.entries()) {
    const M = m.collector.matrix, ws = fv.filter((_, k) => k % 4 === i % 4).map((p) => p.clone().applyMatrix4(M));
    const segs = [[m.root, m.mount, 0.55]];
    const a = (i / 14) * Math.PI * 2;
    for (const sd of [-1, 1]) segs.push([V(Math.cos(a + sd * 0.006) * RING.R, 0, Math.sin(a + sd * 0.006) * RING.R), m.mount, 0.2]);
    for (const p of ws) for (const [A, B, r] of segs) supClear = Math.min(supClear, segDist(p, A, B) - r);
  }
  assert.ok(supClear > 0.3, `station fittings clear the supports by ${supClear.toFixed(2)} km`);
  results.fittingSupportClearanceKm = +supClear.toFixed(2);
  // ferry: its dorsal face meets the port, nothing of it inside the node
  const fv2 = verts(f.ferry.geo, f.ferry.m).map((p) => p.multiplyScalar(0.001));
  const zmin = Math.min(...fv2.map((p) => p.z));
  assert.ok(Math.abs(zmin - 1.07) < 1e-6, `ferry seated on its port (${((zmin - 1.07) * 1000).toFixed(2)} m)`);
  const portD = Math.min(...fv2.map((p) => p.distanceTo(V(MODULE.node, 0, 1.07))));
  assert.ok(portD < 0.12, `ferry hull over the port (${(portD * 1000).toFixed(0)} m)`);
  // patrol tugs: high over every collector (dish, fittings, supports) and the Refuge, never meeting
  {
    const P = V(), Q = V();
    let pc = Infinity, ps = Infinity;
    const cols = hearth.collectorMounts.map((m) => m.collector.position.clone());
    const ref = hearth.refugePosition;
    for (let t = 0; t < PATROL.T; t += 4) for (let k = 0; k < PATROL.count; k++) {
      patrolPose(k, t, P);
      // a collector with its fittings and radiators fits in 14 km of its centre; the Refuge in 26 km
      for (const c of cols) pc = Math.min(pc, P.distanceTo(c) - 14);
      pc = Math.min(pc, P.distanceTo(ref) - 26);
      assert.ok(Math.hypot(P.x, P.z) > 15 * 30 + 100, 'patrol clear of the disc');
      for (let j = k + 1; j < PATROL.count; j++) ps = Math.min(ps, P.distanceTo(patrolPose(j, t, Q)));
    }
    assert.ok(pc > 10, `patrol tugs pass the collectors and the Refuge ${pc.toFixed(1)} km clear`);
    assert.ok(ps > 3, `patrol tugs keep ${ps.toFixed(1)} km apart`);
    results.patrolClearanceKm = +pc.toFixed(1); results.patrolSeparationKm = +ps.toFixed(1);
  }
  // rack gantries: feet on the frame tubes, everything else clear of the racks, posts and mirrors
  {
    const gg = buildRackGantry();
    closed('rackGantry', gg);
    const refT = tree(tris(hearth.refugeData.geo));
    const gv = verts(gg, I);
    const feet = gv.filter((p) => p.y < 0.05), body = gv.filter((p) => p.y > 0.12);
    let footErr = 0, bodyClear = Infinity;
    for (let t = 0; t < RACK.T; t += 6) for (let k = 0; k < 16; k++) {
      const P = rackGantry(k, t);
      for (const p of feet.filter((_, i) => i % 3 === 0)) footErr = Math.max(footErr, dist(refT, p.clone().add(P)));
      for (const p of body) bodyClear = Math.min(bodyClear, dist(refT, p.clone().add(P), bodyClear + 1));
    }
    assert.ok(footErr < 0.09, `gantry shoes on the frame tubes (${(footErr * 1000).toFixed(0)} m)`);
    assert.ok(bodyClear > 0.02, `gantries clear the racks and posts by ${(bodyClear * 1000).toFixed(0)} m`);
    results.rackGantryClearanceMetres = +(bodyClear * 1000).toFixed(0);
  }
  // dish trusses: seated on the back shell, outside the bearing drum, clear of the supports
  {
    const tg = buildDishTruss();
    closed('dishTruss', tg);
    const colT = tree(tris(buildCollector()));
    let seat = 0, sup = Infinity;
    const tv = verts(tg, I, 7);
    for (const p of tv) {
      const r = Math.hypot(p.y, p.z);
      assert.ok(r > 2.3 + BACK.tube, 'truss clear of the gold bearing drum');
      seat = Math.max(seat, dist(colT, p) - 0.16);
    }
    assert.ok(seat < 0.02, `dish truss rides on the back shell (worst ${(seat * 1000).toFixed(0)} m beyond its reach)`);
    for (const [i, m] of hearth.collectorMounts.entries()) for (const p of tv.filter((_, k) => k % 6 === i % 6)) sup = Math.min(sup, segDist(p.clone().applyMatrix4(m.collector.matrix), m.root, m.mount) - 0.55);
    assert.ok(sup > 0.3, `dish trusses clear the supports by ${sup.toFixed(2)} km`);
    results.dishTrussSupportClearanceKm = +sup.toFixed(2);
  }
  // dish drones: standing off every mirror and the spokes and struts that cross in front of it
  {
    const colT = tree(tris(buildCollector()));
    const dv = verts(buildDishDrone(), I);
    const ext = Math.max(...dv.map((p) => p.length()));
    let dc = Infinity;
    for (let t = 0; t < 400; t += 2.5) for (let j = 0; j < DISH.radii.length; j++) dc = Math.min(dc, dist(colT, dishDrone(3, j, t)) - ext);
    assert.ok(dc > 0.25, `dish drones clear their collector by ${(dc * 1000).toFixed(0)} m`);
    assert.ok(DISH.radii.every((r) => r < DISH.rim - ext - 0.3 && dishSag(r) < DISH.stand + 3.2), 'drone circles lie within the dish rim');
    results.dishDroneClearanceMetres = +(dc * 1000).toFixed(0);
  }
  // hamlets: hung from the ring tube, the wheel turning clear of its spindle, stator and radiators,
  // spun for a full gravity on its floor, midway between the platforms, below the trams
  {
    const hf = buildHamletFixed(), wheel = buildHamletWheel();
    closed('hamletFixed', hf.geo); closed('hamletWheel', wheel);
    assert.ok(Math.hypot(0.16, HAMLET.hangTop) < 0.45 - 0.05, 'the head of the hanger lies inside the ring tube');
    const fixT = tree([...tris(hf.geo), ...tris(hf.courier.geo, hf.courier.m, 0.001)]);
    const wv = verts(wheel, I, 2);
    let spin = Infinity;
    for (let k = 0; k < 12; k++) {
      const R = new THREE.Matrix4().makeRotationY((k / 12) * Math.PI / 3).setPosition(0, HAMLET.wheelY, 0);
      for (const p of wv) spin = Math.min(spin, dist(fixT, p.clone().applyMatrix4(R), spin + 1));
    }
    assert.ok(spin > 0.02, `hamlet wheels turn ${(spin * 1000).toFixed(0)} m clear of their fixed parts`);
    results.hamletBearingGapMetres = +(spin * 1000).toFixed(0);
    const g = HAMLET.omega * HAMLET.omega * (HAMLET.wheelR + HAMLET.tube) * 1000;
    assert.ok(Math.abs(g - 9.81) < 1e-6, `hamlet floors at ${g.toFixed(2)} m/s^2`);
    results.hamletPeriodSeconds = +(2 * Math.PI / HAMLET.omega).toFixed(1);
    // the courier's bow meets the port
    const cv = verts(hf.courier.geo, hf.courier.m).map((p) => p.multiplyScalar(0.001));
    assert.ok(Math.abs(Math.max(...cv.map((p) => p.y)) - HAMLET.port) < 1e-6, 'hamlet courier berthed bow-on at the port');
    for (let i = 0; i < RING.count; i++) {
      const a = hamletAngle(i), { a0, a1 } = tramArc(i);
      assert.ok(a > a0 + 0.05 && a < a1 - 0.05, 'hamlets hang midway between the platforms');
      assert.ok(Math.abs(hamletMatrix(i).determinant() - 1) < 1e-9, 'hamlet frames are proper rotations');
    }
    // everything a hamlet has lies below the tram rail and inside the collector line's shadow of the ring
    const hv = [...verts(hf.geo), ...wv.map((p) => p.clone().setY(p.y + HAMLET.wheelY))];
    assert.ok(Math.max(...hv.map((p) => p.y)) < RING.rail - 0.5, 'hamlets hang below the trams');
  }
  // placements are proper rotations (a mirrored placement would turn a hull inside out)
  for (const c of buildBerths().cradles) assert.ok(Math.abs(c.ship.determinant() - 1) < 1e-6, 'berthed shuttle placement is proper');
  assert.ok(f.ferry.m.determinant() > 0, 'ferry placement is proper');
  // trams: their arcs stop short of every station's dish and braces; platforms beside the rail
  for (let i = 0; i < RING.count; i++) {
    const { a0, a1 } = tramArc(i);
    assert.ok(a1 > a0 && a0 - (i / 14) * Math.PI * 2 >= 0.0093 + 0.006 && ((i + 1) / 14) * Math.PI * 2 - a1 >= 0.0093 + 0.006, 'tram arcs clear the dishes and braces');
  }
  let tramClear = Infinity;
  const supports = hearth.collectorMounts.map((m) => [m.root, m.mount]);
  for (let t = 0; t < TRAM.T; t += 1) for (let i = 0; i < RING.count; i++) {
    const th2 = tramAngle(i, t), { a0, a1 } = tramArc(i);
    assert.ok(th2 >= a0 && th2 <= a1, 'tram within its arc');
    const p = V(Math.cos(th2) * RING.R, RING.rail + TRAM.h / 2, Math.sin(th2) * RING.R);
    for (const [A, B] of supports) tramClear = Math.min(tramClear, segDist(p, A, B) - 0.55 - TRAM.len / 2);
  }
  assert.ok(tramClear > 5, `trams clear every support by ${tramClear.toFixed(1)} km`);
  results.tramSupportClearanceKm = +tramClear.toFixed(1);
  // tankers: the queue and the working tanker's run clear the feeder and its injector
  const fd = buildFeeder();
  const feT = tree([...tris(fd.hull, I, 1, 2), ...tris(fd.injector)]);
  const s = tankerSlots(), tv = verts(d.tankers[0].mesh.geometry, I, 11);
  const q = d.tankerQuat;
  let tankClear = Infinity;
  const at = (c) => tv.map((p) => p.clone().applyQuaternion(q).add(c));
  for (const c of s.queue) for (const p of at(c)) tankClear = Math.min(tankClear, dist(feT, p, tankClear + 1));
  for (let t = 0; t < TANKER.T; t += 4) for (const p of at(tankerPose(t))) tankClear = Math.min(tankClear, dist(feT, p, tankClear + 1));
  assert.ok(tankClear > 0.25, `tankers clear the feeder by ${(tankClear * 1000).toFixed(0)} m`);
  results.tankerFeederClearanceMetres = +(tankClear * 1000).toFixed(0);
  let qsep = Infinity;
  for (let i = 0; i < s.queue.length; i++) for (let j = i + 1; j < s.queue.length; j++) qsep = Math.min(qsep, s.queue[i].distanceTo(s.queue[j]));
  for (let t = 0; t < TANKER.T; t += 4) for (const c of s.queue.slice(1)) qsep = Math.min(qsep, tankerPose(t).distanceTo(c));
  assert.ok(qsep > TANKER.scale * 1.1 + 1, `tankers keep ${qsep.toFixed(1)} km apart`);
  // distance LOD: hidden far out (no animation work), shown again on return
  d.update(10, 1e6);
  assert.ok(!d.trams.visible && !d.patrol[0].visible && !d.hamlets.visible, 'Hearth district hidden far out');
  const [, tHid] = time(() => { for (let i = 0; i < 200; i++) d.update(i, 1e6); });
  assert.ok(tHid / 200 < 0.01, 'hidden district costs nothing per frame');
  d.update(10, 100);
  assert.ok(d.trams.visible && d.patrol[0].visible && d.gantries.visible, 'Hearth district shown close in');
  // frame cost and finiteness
  const [, ta] = time(() => { for (let i = 0; i < 200; i++) d.update(i * 0.37); });
  results.hearthDistrictFrameMs = +(ta / 200).toFixed(3);
  assert.ok(ta / 200 < 0.3, 'Hearth district frame under 0.3 ms');
  assert.ok(d.trams.instanceMatrix.array.every(Number.isFinite) && d.tramAttr.array.every(Number.isFinite), 'finite trams');
  let tri = 0;
  for (const m of [d.gantries, d.fittings, d.trusses, d.drones, d.hamlets, d.wheels, d.platforms, d.trams, d.coils, ...d.tankers.map((x) => x.mesh)]) tri += triCount(m.geometry) * (m.isInstancedMesh ? m.count : 1);
  results.hearthDistrictRenderedTris = tri;
}

// ======================================================= the Sun and its swarm: shader contracts
// (no GPU here: every varying the fragment stage reads is written by the vertex stage with the
// same type, every uniform either stage declares is supplied, loops have constant bounds, and
// derivatives are taken outside branches and loops)
{
  const sim = new SpaceSim(); sim.syncFromHours(12);
  const space = { camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e9), size: new THREE.Vector2(1280, 720), exposure: 1 };
  const sw = new SunSwarm(space, { swarm: 2000 });
  space.camera.position.copy(sim.sunPos).add(V(0, 0, 3e7));
  sw.update(sim, 5, 0.016, space);
  assert.ok(sw.near > 0.9 && sw.swarm.visible, 'the swarm shows close to the Sun');
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const decl = (src, q) => [...strip(src).matchAll(new RegExp(`^\\s*${q}\\s+(\\w+)\\s+(\\w+)`, 'gm'))].map((m) => [m[1], m[2]]);
  const contract = (vs, fs, uniforms) => {
    const issues = [], vOut = new Map(decl(vs, 'varying').map(([t, n]) => [n, t])), fv = decl(fs, 'varying');
    for (const [t, n] of fv) {
      if (vOut.get(n) !== t) issues.push(`varying ${n} types differ`);
      if (!new RegExp(`\\b${n}\\s*=`).test(strip(vs))) issues.push(`varying ${n} never written`);
    }
    for (const [, n] of [...decl(vs, 'uniform'), ...decl(fs, 'uniform')]) if (!(n in uniforms)) issues.push(`uniform ${n} not supplied`);
    for (const m of strip(vs + fs).matchAll(/for\s*\(\s*int\s+\w+\s*=\s*(-?\d+)\s*;\s*\w+\s*<=?\s*([^;]+);/g)) if (!/^-?\d+$/.test(m[2].trim())) issues.push(`loop bound ${m[2]}`);
    // derivatives never inside a loop or branch body (brace-delimited; one-line bodies are caught by the same regex on the controlling line)
    const stack = [];
    let ctl = false;
    for (const tk of strip(fs).split(/(\{|\})/)) {
      if (tk === '{') { stack.push(ctl); ctl = false; continue; }
      if (tk === '}') { stack.pop(); continue; }
      const lines = tk.split(';');
      for (const ln of lines) {
        const inCtl = stack.slice(1).some(Boolean) || /\b(if|for|while)\s*\(.*\)\s*[^{]*\b(fwidth|dFdx|dFdy)\s*\(/.test(ln);
        if (inCtl && /\b(fwidth|dFdx|dFdy)\s*\(/.test(ln)) issues.push('derivative inside a branch or loop');
      }
      ctl = /\b(for|if|else|while)\b[^;]*$/.test(tk.trim());
    }
    return { issues, varyings: fv.length };
  };
  // positive controls: each fault is caught
  const good = 'varying float vA;\nuniform float uX;\nvoid main() { vA = uX; }', goodF = 'varying float vA;\nuniform float uX;\nvoid main() { float d = fwidth(vA); gl_FragColor = vec4(d); }';
  assert.equal(contract(good, goodF, { uX: 1 }).issues.length, 0, 'control: a sound pair passes');
  assert.ok(contract(good, goodF, {}).issues.length > 0, 'control: a missing uniform is caught');
  assert.ok(contract(good.replace('vA = uX;', ''), goodF, { uX: 1 }).issues.length > 0, 'control: an unwritten varying is caught');
  assert.ok(contract(good, 'varying float vA;\nuniform float uX;\nvoid main() { if (vA > 0.0) { float d = fwidth(vA); } }', { uX: 1 }).issues.length > 0, 'control: a derivative in a branch is caught');
  assert.ok(contract(good, 'varying float vA;\nuniform float uX;\nvoid main() { for (int i = 0; i < int(uX); i++) {} }', { uX: 1 }).issues.length > 0, 'control: a variable loop bound is caught');
  for (const [name, mat] of [['sun', sw.sphere.material], ['corona', sw.corona.material], ['swarm', sw.swarm.material]]) {
    const r = contract(mat.vertexShader, mat.fragmentShader, mat.uniforms);
    assert.deepEqual(r.issues, [], `${name} shader contract`);
    results[`${name}ShaderVaryings`] = r.varyings;
  }
  // a mirror resolved (hundreds of pixels) and the swarm's per-frame cost
  const [, tf] = time(() => { for (let i = 0; i < 200; i++) sw.update(sim, i * 0.1, 0.016, space); });
  results.sunFrameMs = +(tf / 200).toFixed(3);
  assert.ok(tf / 200 < 0.3, 'Sun and swarm frame under 0.3 ms');
}
console.log(JSON.stringify(results));
console.log('SUN_DOMAIN_VERIFIED');
