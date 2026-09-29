// Invariants of the Halo and elevator domain (headless, no renderer):
//   districts: build time, triangle budgets per LOD, nothing through the vault or inside the
//   walls or rotor sheaths, arch feet clear, gantries and pods over the glass and away from the
//   arches, docked craft inside their bays, trains on their guideways, runtime cost;
//   climbers: cars clear the ribbon, wheels on the cable, never inside it, the nearest-car pick;
//   counterweight: legs seated on the actual rock, sites clear of every keep-out, Twinwheel at
//   1 g and counter-rotating, clear of the stem and terminal, tugs and capsules clear;
//   ports: cranes over the stacks, shuttles clear of the gate trusses, all inside their bodies.
// Run: node tools/verify-ring.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SpaceSim, R_EARTH, MERIDIAN_LON, COUNTERWEIGHT_ALT, bodyDir } from '../src/space/sim.js';
import { Rings } from '../src/space/rings.js';
import { Elevator } from '../src/space/elevator.js';
import { HaloPorts, buildPortStation, PORT_LIFE, buildCourtCrane } from '../src/space/stations.js';
import { HALO_PORTS } from '../src/space/earthData.js';
import { TILE_L, WINDOW, MINOR_RANGE_KM, GANTRY, rotorGeometry, buildGantry } from '../src/space/haloDistricts.js';
import { buildPassengerClimber, buildFreightClimber, buildTetherSegment, GUIDE_OFFSET, RIBBON, CABLE_R, MARKER_PROUD, BORE_R } from '../src/space/climbers.js';
import { WHEELS, WHEEL, STEM, TUGS, CAPSULE, wheelOmega, segDist, counterKeepOuts } from '../src/space/counterLife.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const out = {};
const sim = new SpaceSim(); sim.syncFromHours(12);
const space = {
  scene: new THREE.Scene(), earthFixed: new THREE.Group(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e7), size: new THREE.Vector2(1280, 720), sim,
  addBody(name, objects, center, radius, opts) { const b = { name, objects, center, radius, ...opts }; this.bodies.push(b); return b; },
};
space.scene.add(space.earthFixed);
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const finite = (g) => g.attributes.position.array.every(Number.isFinite);
function eachVertex(g, fn) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) fn(p.getX(i), p.getY(i), p.getZ(i)); }

// ------------------------------------------------------------ districts ----
let t0 = performance.now();
const rings = new Rings(space, { ringSegs: 1 });
out.ringsCtorMs = Math.round(performance.now() - t0);
const D = rings.districts, S = D.S;
assert.ok(D && !D.built, 'Districts are deferred until the camera nears the Halo');
D._queue();
const pieceMs = [];
while (D.buildQueue.length) { const a = performance.now(); D._step(); pieceMs.push(performance.now() - a); }
out.districtBuildMs = Math.round(pieceMs.reduce((s, x) => s + x, 0));
out.districtMaxPieceMs = Math.round(Math.max(...pieceMs));
assert.ok(D.built && out.districtBuildMs < 1000, `District build ${out.districtBuildMs} ms (budget 1 s, spread one piece per frame)`);
assert.ok(out.districtMaxPieceMs < 150, 'No single build piece stalls a frame for long');

const maxMajor = Math.max(...D.variants.map((v) => tris(v.major))) + Math.max(...D.crests.map((c) => tris(c.major)));
const maxMinor = Math.max(...D.variants.map((v) => tris(v.minor))) + Math.max(...D.crests.map((c) => tris(c.minor)));
const minorSlots = 2 * Math.ceil(MINOR_RANGE_KM / (TILE_L / 1000)) + 1;
const movers = D.trains.instanceMatrix.count * tris(D.trains.geometry) + D.trams.instanceMatrix.count * tris(D.trams.geometry) + D.ships.reduce((s, im) => s + im.instanceMatrix.count * tris(im.geometry), 0) + 2 * tris(D.gantryGeo);
out.tileMajorTris = maxMajor; out.tileMinorTris = maxMinor;
out.districtWorstRenderedTris = (2 * WINDOW + 1) * maxMajor + minorSlots * maxMinor + movers;
out.districtUniqueTris = D.variants.reduce((s, v) => s + tris(v.major) + tris(v.minor), 0) + D.crests.reduce((s, c) => s + tris(c.major) + tris(c.minor), 0) + tris(D.gantryGeo);
assert.ok(out.districtWorstRenderedTris < 10e6, `Districts render at most ${out.districtWorstRenderedTris} triangles (budget 10M)`);
assert.ok(out.districtUniqueTris < 4e6, 'Unique district geometry within 4M triangles');

const G = rotorGeometry(S);
let vaultGap = Infinity, wallHits = 0, rotorHits = 0, deckSink = Infinity;
for (const v of D.variants) for (const g of [v.major, v.minor]) {
  assert.ok(finite(g));
  eachVertex(g, (x, y, z) => {
    const ax = Math.abs(x);
    if (ax < S.hw - 1 && y > 0) vaultGap = Math.min(vaultGap, S.roofLow(x) - y);
    if (ax < S.hw - 1 && y > -390) deckSink = Math.min(deckSink, y - S.deck(x));   // (below the slab: rotor hardware)
    if (ax > S.hw + 25 && ax < S.outer - 1 && y > -55 && y < S.wall - 1) wallHits++;
    // inside the octagonal rotor sheath (6 m embed allowed for hanger feet)
    const dx = ax - S.tubeX, dy = y - S.tubeY;
    let m = -Infinity;
    for (let k = 0; k < 8; k++) { const a = ((k + 0.5) / 8) * Math.PI * 2; m = Math.max(m, dx * Math.cos(a) + dy * Math.sin(a)); }
    if (m < G.apo - 6) rotorHits++;
  });
}
out.vaultClearanceMetres = Math.round(vaultGap);
out.deckEmbedMetres = Math.round(-deckSink);
assert.ok(vaultGap > 150, `Every district structure stays ${vaultGap} m under the lowest glass (chord sag included)`);
assert.ok(-deckSink < 100 && -deckSink > 10, 'Footings reach 10+ m into the 400 m deck slab (covering its chord sag) and never through it');
assert.equal(wallHits, 0, 'Nothing is built inside the retaining wall slabs');
assert.equal(rotorHits, 0, 'Nothing is built inside the rotor sheaths');

// hub crest: rails gapped under the corbel, nothing inside the corbel block
const P = D.archProfile, hub = D.crests[1];
let corbelHits = 0, railInGap = 0;
for (const g of [hub.major, hub.minor]) eachVertex(g, (x, y, z) => {
  const ax = Math.abs(x);
  if (Math.abs(ax - P.leg * 1000) < 279 && Math.abs(z) < 549 && y > S.wall + 1 && y < S.wall + 299) corbelHits++;
  if (ax > 16090 && ax < 16300 && y < S.wall + 6 && y > S.wall + 0.5 && Math.abs(z) < 700) railInGap++;
});
assert.equal(corbelHits, 0, 'Arch-foot dressing stays out of the corbels');
assert.equal(railInGap, 0, 'Gantry rails stop short of the corbels');
assert.ok(D.hubTiles.size === rings.archAngles.length, 'Every arch has its dressed hub tile');

// gantries: chords and pods over the glass, travel clear of the arches, on dressed tiles only
const gb = buildGantry(S);
let chordGap = Infinity;
{
  const N = 120, pts = [];
  for (let i = 0; i <= N; i++) { const x = S.hw * Math.sin((i / N - 0.5) * Math.PI); pts.push([x, S.roofCurve(x) + GANTRY.bottom]); }
  for (let i = 0; i < N; i++) for (let j = 0; j <= 20; j++) {
    const f = j / 20, x = pts[i][0] * (1 - f) + pts[i + 1][0] * f, y = pts[i][1] * (1 - f) + pts[i + 1][1] * f;
    chordGap = Math.min(chordGap, y - 4 - S.roofCurve(x));
  }
}
out.gantryChordGlassMetres = Math.round(chordGap);
assert.ok(chordGap > 60, 'Gantry bottom chords clear the vault glass by 60 m everywhere');
const podBottom = GANTRY.podY - 8.7;
assert.ok(podBottom > 40 && GANTRY.podY + 25 < GANTRY.bottom - 4, 'Crawler pods hang under the chord and over the glass');
let archGap = Infinity;
for (const bay of D.gantryBays) for (const th of rings.archAngles) {
  let du = th * D.Rm - bay.u; du -= Math.round(du / (D.Rm * 2 * Math.PI)) * D.Rm * 2 * Math.PI;
  archGap = Math.min(archGap, Math.abs(du) - GANTRY.range - GANTRY.halfDepth - 550);
}
out.gantryArchClearanceKm = +(archGap / 1000).toFixed(1);
assert.ok(archGap > 10000, 'Gantry travel never reaches an arch corbel');
assert.ok(finite(gb.geo) && D.gantryBays.length > 200, 'Gantries run in most bays');

// docks: every class berths inside its bay with margins; approaches stay over the rotors
for (const c of D.shipClasses) {
  const b = D.bay, bb = c.box;
  const len = bb.max.z - bb.min.z, wid = bb.max.x - bb.min.x;
  const berth = D.shipOffset(0, 1, -1000, 0);                         // phase-independent berth offset
  const xa = S.outer + b.d * 0.5 - len / 2, xb = S.outer + b.d * 0.5 + len / 2;
  assert.ok(xa > S.outer + 5 && xb < S.outer + b.d - 5, 'Berthed hull inside the bay depth');
  assert.ok(wid / 2 < b.w / 2 - 20, 'Berthed hull clear of the bay walls');
  const yBot = c.y + bb.min.y, yTop = c.y + bb.max.y, floor = b.y - b.h / 2 + 2;
  assert.ok(Math.abs(yBot - (floor + b.clear + 2)) < 1e-6 && yTop < b.y + b.h / 2 - 10, 'Hull rides its cradles under the bay roof');
  assert.ok(berth === null || Math.abs(berth - b.d * 0.5) < 1e-9);
  assert.ok(yBot > S.tubeY + S.tubeR + 500, 'Approach lanes pass well over the rotor sheaths');
}
// trains ride their guideways; trams clear the shelters; crawler bogies on the rails
const yT = S.deck(0) + 34;
const tg = D.trains.geometry; tg.computeBoundingBox();
assert.ok(Math.abs(D.lines[0].y + tg.boundingBox.min.y - (yT + 1.6)) < 0.2, 'Trains sit on the guideway tops');
assert.ok(9 + tg.boundingBox.max.x < 26 - 7 - 1, 'Trains clear the station platforms');
const mg = D.trams.geometry; mg.computeBoundingBox();
assert.ok(8 + mg.boundingBox.max.x < 17 - 2 - 1, 'Trams clear the stop shelters');
const cg = D.rotorCrawlers[1].geometry; cg.computeBoundingBox();
// ---- runtime: a camera 3 km over a dressed tile near a gantry bay
const bay = D.gantryBays[0];
const th = bay.u / D.Rm + 20000 / D.Rm;
const { a, b, R } = D.basis;
sim.step(0);
space.earthFixed.quaternion.copy(sim.earthQuat); space.earthFixed.updateMatrixWorld(true);
space.camera.position.copy(a.clone().multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th)).multiplyScalar(R + 3)).applyQuaternion(sim.earthQuat);
space.camera.updateMatrixWorld(true);
const ut = [];
for (let f = 0; f < 240; f++) { const s = performance.now(); rings.update(sim, f * 7.3, 0.016, space); ut.push(performance.now() - s); }
space.scene.updateMatrixWorld(true);
ut.sort((x, y) => x - y);
out.districtUpdateMedianMs = +ut[120].toFixed(3);
assert.ok(ut[120] < 0.3, `District update ${ut[120]} ms per frame`);
assert.ok(D.anchor.visible && D.trains.count > 0 && D.trams.count > 0 && D.ships[0].count > 0 && D.pods.count > 0 && D.rotorCrawlers[0].count > 0, 'Traffic, docks, gantry and crawlers are live near the ring');
let badInst = 0;
for (const im of [D.trains, D.trams, D.pods, ...D.ships, ...D.rotorCrawlers]) for (let i = 0; i < im.count * 16; i++) if (!Number.isFinite(im.instanceMatrix.array[i])) badInst++;
assert.equal(badInst, 0, 'Instance matrices are finite');
const visSlots = D.slots.filter((s) => s.g.visible).length;
out.visibleTiles = visSlots;
// far away: nothing drawn
space.camera.position.set(0, 0, 60000); space.camera.updateMatrixWorld(true);
rings.update(sim, 0, 0.016, space);
assert.ok(!D.anchor.visible, 'Districts hidden from far away');

// ------------------------------------------------------------ climbers ----
const pc = buildPassengerClimber(), fc = buildFreightClimber();
for (const c of [pc, fc]) {
  let rMax = 0, rMinMain = Infinity, rMinDetail = Infinity;
  eachVertex(c.geo, (x, y, z) => { const r = Math.hypot(x, z); rMax = Math.max(rMax, r); rMinMain = Math.min(rMinMain, r); });
  eachVertex(c.detail, (x, y, z) => { const r = Math.hypot(x, z); rMax = Math.max(rMax, r); rMinDetail = Math.min(rMinDetail, r); });
  assert.ok(rMax < GUIDE_OFFSET - RIBBON.thick / 2 - 1.2 - 20, `Climber (${rMax.toFixed(1)} m) clears the ribbon by 20 m`);
  assert.ok(rMinMain > CABLE_R + MARKER_PROUD + 1, 'Climber structure never touches the cable');
  assert.ok(rMinDetail >= CABLE_R - 1e-3 && rMinDetail < CABLE_R + 1, `Drive wheels ride the cable (${rMinDetail.toFixed(3)} m from its axis)`);
  assert.ok(finite(c.geo) && finite(c.detail));
}
assert.ok(BORE_R > CABLE_R + MARKER_PROUD + 10);
out.climberTris = [tris(pc.geo) + tris(pc.detail), tris(fc.geo) + tris(fc.detail)];
const seg = buildTetherSegment();
seg.geo.computeBoundingBox();
assert.ok(Math.abs(seg.geo.boundingBox.max.x - GUIDE_OFFSET - CABLE_R) < 0.5, 'Guide cables at their offset');

// ------------------------------------------------------------ counterweight ----
t0 = performance.now();
const el = new Elevator(space, { climbers: 60 });
out.elevatorCtorMs = Math.round(performance.now() - t0);
out.counterLifeMs = Math.round(el.counterLife.buildMs);
assert.ok(out.counterLifeMs < 300, 'Counterweight town builds quickly');
const CL = el.counterLife, works = el.counterData;
let legErr = 0;
for (const l of CL.settle.legs) legErr = Math.max(legErr, Math.abs(l.foot.length() - (l.rr - 30)) > 15 ? 1 : 0, Math.abs(l.contact.length() - l.rr));
assert.ok(legErr < 1e-6, 'Settlement legs reach 30 m into the actual rock');
const keep = counterKeepOuts(works);
let keepGap = Infinity;
for (const s of CL.settle.sites) for (const k of keep) keepGap = Math.min(keepGap, segDist(s.centre, k.a, k.b) - k.r - s.radius);
out.siteKeepOutClearanceMetres = Math.round(keepGap);
out.settlements = CL.settle.sites.length;
assert.ok(keepGap > 0 && CL.settle.sites.length >= 12, 'Settlements clear mines, cradles, conveyors, terminal, mast and the release spar');
let reach = 0;
eachVertex(CL.settle.geo, (x, y, z) => { reach = Math.max(reach, Math.hypot(x, y, z)); });
for (const w of WHEELS) reach = Math.max(reach, Math.hypot(WHEEL.rimOut, w.y - 200));
reach = Math.max(reach, Math.hypot(STEM.bottom - 140, 0), Math.hypot(TUGS.r + TUGS.laneGap + 60, TUGS.yMin - 60));
out.counterReachKm = +(reach / 1000).toFixed(2);
assert.ok(reach < 20000, 'The town stays inside the counterweight body radius');
const w = wheelOmega();
assert.ok(Math.abs(w * w * WHEEL.rimOut - 9.81) < 1e-9 && WHEELS.reduce((s, x) => s + x.spin, 0) === 0, 'Twinwheel: 1 g on the rim floor, counter-rotating pair');
assert.ok(WHEEL.hubIn - WHEEL.bearingOut >= 5 && WHEEL.bearingOut > WHEEL.stemR + WHEEL.stemTube + 50, 'Hubs clear their bearing collars and the stem');
assert.ok(Math.abs(WHEELS[0].y - WHEELS[1].y) - 2 * (WHEEL.halfAxial + 5) - 170 > 1000, 'The wheels clear each other (radiators included)');
assert.ok(-15800 - (WHEELS[0].y + WHEEL.halfAxial + 5) > 1000, 'The upper wheel clears the terminal');
assert.ok(STEM.bore > GUIDE_OFFSET + 81 + 30, 'Climbers pass through the stem foot');
let tugGap = Infinity, tugSep = Infinity;
const pA = V(), pB = V();
for (let t = 0; t < 4000; t += 20) for (let i = 0; i < TUGS.n; i++) {
  CL.tugPose(i, t, pA);
  for (const wh of WHEELS) tugGap = Math.min(tugGap, Math.hypot(Math.hypot(pA.x, pA.z) - WHEEL.rimOut, pA.y - wh.y) - 100);
  for (const k of keep) tugGap = Math.min(tugGap, segDist(pA, k.a, k.b) - k.r);
  for (let j = i + 1; j < TUGS.n; j++) { CL.tugPose(j, t, pB); tugSep = Math.min(tugSep, pA.distanceTo(pB)); }
}
out.tugClearanceMetres = Math.round(tugGap); out.tugSeparationMetres = Math.round(tugSep);
assert.ok(tugGap > 500 && tugSep > 300, 'Tugs keep clear of the wheels, cradles, terminal and each other');
let capGap = Infinity;
for (const belt of CL.belts) {
  // body bottom's distance from the tube axis (rail offset perpendicular + hanger), minus the tube
  const k = Math.sqrt(Math.max(0, 1 - belt.dir.y * belt.dir.y));
  capGap = Math.min(capGap, CAPSULE.rail * k + CAPSULE.bodyY - CAPSULE.bodyH / 2 - belt.tubeR);
  assert.ok(Math.abs(belt.up.dot(belt.dir)) < 1e-9, 'Capsule frames square to their belts');
}
out.capsuleClearanceMetres = Math.round(capGap);
assert.ok(capGap > 40, 'Ore capsules hang from the rail top, their bodies clear of the conveyor tube');
const capG = CL.capsules.geometry; capG.computeBoundingBox();
assert.ok(Math.abs(capG.boundingBox.min.y - CAPSULE.railR) < 1e-6, 'Capsule bogies sit on the rail');
for (const t of [0, 100, 777]) CL.update(t);
for (const im of [CL.capsules, CL.tugs]) assert.ok(im.instanceMatrix.array.slice(0, im.count * 16).every(Number.isFinite));

// ------------------------------------------------------------ ports ----
const ports = new HaloPorts(space, HALO_PORTS);
const st = ports.station, crane = buildCourtCrane();
crane.geo.computeBoundingBox();
const stackTop = st.pierY + 300 + 210;
for (const seat of ports.craneSeats) {
  assert.ok(seat.y + crane.geo.boundingBox.min.y - stackTop > 20, 'Crane loads swing over the container stacks');
  assert.ok(Math.abs(seat.z) - 30 > 20945 && Math.abs(seat.z) + 30 < 21200, 'Crane masts stand on the court, clear of the stacks');
  assert.ok(Math.hypot(Math.abs(seat.x), Math.abs(seat.z) - 21700) > 520 + 165 + 200, 'Crane heads and counterweights clear the pier-head sphere by 200 m');
}
for (let t = 0; t < 900; t += 3) for (const side of [0, 1]) {
  const y = ports.shuttleY(t, side, 123);
  if (y !== null) { assert.ok(y + 57 < -7300 - 20 && y > -24000 + 60, 'Gate shuttles stay under the gate trusses and inside the port body'); }
}
for (let t = 0; t < 400; t += 5) for (let k = 0; k < 6; k++) { const y = ports.podY(t, k, 7); assert.ok(y < -1700 && y > -24000, 'Tether pods ride below the sheaves, inside the port body'); }
space.camera.position.copy(bodyDir(0, THREE.MathUtils.degToRad(HALO_PORTS[1].lon)).multiplyScalar(R_EARTH + 640)).applyQuaternion(sim.earthQuat);
ports.update(sim, 50, 0.016, space);
assert.ok(ports.list[0].life.group.visible && ports.list[0].life.pods.count === 6, 'Port life runs when the station fills the view');
// the junction: cranes and gate shuttles, no pods on the climbers' tether
space.earthFixed.add(el.group); space.earthFixed.updateMatrixWorld(true);
space.camera.position.copy(el.junction.position).applyQuaternion(sim.earthQuat).addScaledVector(V(0, 0, 1), 5);
el.update(sim, 300, 0.016, space);
assert.ok(el.junctionLife.group.visible && el.junctionLife.pods.count === 0 && el.junctionLife.cranes.length === 4, 'The junction works too, leaving the main tether to the climbers');

console.log(JSON.stringify(out));
console.log('RING_VERIFIED');
