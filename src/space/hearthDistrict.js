import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { buildFreighter, buildShuttle, lathe } from '../craft/craftClasses.js';
import { merge } from './hull.js';
import { createLamps, LAMP } from './lamps.js';
import { placeLamps, addEngines } from './craftMesh.js';
import { toHullKinds, feederFrame } from './hearthWorks.js';
import { RS } from './hearthLens.js';

// THE HEARTH DISTRICT (km; the stations group's frame, where the collector ring lies in y = 0).
//
//   stations  every one of the fourteen collector stations carries a crewed conversion module
//             behind its hab (a lit pressure drum, collars and a docking node with a berthed
//             ferry), a radiator stack and an antenna mast: one geometry, instanced on the
//             collectors' own matrices, all of it behind the hab's far end, clear of the
//             station's supports
//   trams     a maglev tram shuttles each arc of the collector ring between the platforms that
//             stand off the ring short of each station's supports and dish, dwelling at each
//   feeder    the injector's accelerator collars and funnel coils; three matter tankers hold in
//             a queue astern of the feeder and a fourth works the transfer berth above it
//   dishes    every dish is stiffened behind by a lattice of hoops and radial ribs seated on its
//             back shell, outside the hub's bearing drum
//   drones    three cleaning drones sweep circles in front of every dish, standing off its
//             mirror, between the spokes that cross it and the receiver's struts
//   hamlets   a crew hamlet hangs under the ring midway along every arc: a spindle on a hanger
//             from the ring tube, a habitat wheel spun for a full gravity at its floor turning on
//             a bearing collar, radiators below it and a courier berthed at its foot
//   refuge    the wheels' rim lamps and garden lights turn with them
//
// Everything draws with the Hearth's hull material, so it shares the disc's light and the
// lensing mask. tools/verify-sun.mjs checks the clearances.

const V = (x, y, z) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const X_AXIS = new THREE.Matrix4().makeRotationY(Math.PI / 2);       // lathe axis (local z) onto +x

export const RING = { R: 30 * RS, count: 14, rail: 0.85, delta: 0.02 };
export const MODULE = { x0: -4.9, x1: -8.3, r: 0.72, node: -8.9, nodeR: 0.62, mast: -12.5 };

/** Conversion module, node, radiators and mast in a collector's local frame (km; +X toward the hole). */
export function buildStationFittings() {
  const B = new CB(), lamps = [];
  // pressure drum along -x, seated 0.2 km into the hab's end cap (hab ends at x = -5.12)
  B.push(X_AXIS);
  lathe(B, [[0.5, MODULE.x0, CK.HULL], [MODULE.r, -5.2, CK.HULL], [MODULE.r, -5.6, CK.BRONZE], [MODULE.r, -5.7, CK.GLASS], [MODULE.r, -6.6, CK.GLASS], [MODULE.r, -6.7, CK.BRONZE],
    [MODULE.r, -6.8, CK.GLASS], [MODULE.r, -7.7, CK.GLASS], [MODULE.r, -7.8, CK.BRONZE], [0.66, -8.1, CK.HULL], [0.4, -8.4, CK.HULL]], 40);
  B.pop();
  // collars: ribbed shield bands over the drum
  for (const x of [-5.65, -6.75, -7.85]) { B.push(new THREE.Matrix4().makeTranslation(x, 0, 0).multiply(X_AXIS)); B.torus(MODULE.r + 0.02, 0.05, 48, 8, CK.BRONZE); B.pop(); }
  // docking node: a sphere with two ports, a ferry berthed on the +z port
  B.push(new THREE.Matrix4().makeTranslation(MODULE.node, 0, 0));
  B.push(X_AXIS);
  lathe(B, Array.from({ length: 13 }, (_, i) => { const a = (i / 12) * Math.PI; return [Math.sin(a) * MODULE.nodeR, -Math.cos(a) * MODULE.nodeR, i % 3 ? CK.HULL : CK.BRONZE]; }), 32);
  B.pop();
  for (const sd of [-1, 1]) {
    B.tube([V(0, 0, sd * 0.4), V(0, 0, sd * 1.05)], 0.16, 16, CK.HULL);
    B.at(0, 0, sd * 1.03); lathe(B, [[0.2, -0.04 * sd, CK.BRONZE], [0.22, 0, CK.BRONZE], [0.14, 0.04 * sd, CK.DARK]], 20); B.pop();
    lamps.push({ p: V(MODULE.node, 0.28, sd * 1.1), r: 0.035, color: sd > 0 ? LAMP.GREEN : LAMP.RED, i: 2.6 });
  }
  B.pop();
  // radiator stack: two fins above and below the node, edge-on to the disc, on a spine
  for (const sd of [-1, 1]) {
    B.tube([V(MODULE.node, sd * 0.5, 0), V(MODULE.node, sd * 6.2, 0)], 0.09, 8, CK.DARK);
    for (let j = 0; j < 4; j++) {
      const y = sd * (1.1 + j * 1.3);
      B.box(MODULE.node - 0.1, y, 0, 2.2, 1.1, 0.04, CK.RADIATOR);
      B.box(MODULE.node - 0.1, y, 0, 2.3, 0.05, 0.08, CK.BRONZE);
      B.box(MODULE.node + 1.0, y, 0, 0.06, 1.1, 0.1, CK.CONDUIT);
    }
    lamps.push({ p: V(MODULE.node, sd * 6.35, 0), r: 0.05, color: LAMP.AMBER, i: 2.4, breathe: 0.5, phase: sd > 0 ? 0 : 0.5 });
  }
  // antenna mast to the rear with a relay dish
  B.tube([V(MODULE.node - MODULE.nodeR + 0.05, 0, 0), V(MODULE.mast, 0, 0)], 0.06, 8, CK.HULL);
  for (let j = 1; j < 6; j++) { B.push(new THREE.Matrix4().makeTranslation(MODULE.node - 0.6 - j * 0.55, 0, 0).multiply(X_AXIS)); B.torus(0.1, 0.02, 12, 5, CK.BRONZE); B.pop(); }
  B.at(MODULE.mast - 0.3, 0, 0, 0, -Math.PI / 2, 0);
  lathe(B, [[0.08, -0.12, CK.HULL], [0.75, 0.12, CK.BRONZE], [0.8, 0.16, CK.BRONZE], [0.05, 0.02, CK.DARK]], 32);
  B.pop();
  lamps.push({ p: V(MODULE.mast - 0.5, 0, 0), r: 0.06, color: LAMP.WHITE, i: 3, breathe: 0.4 });
  // window lights along the drum
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; lamps.push({ p: V(-6.2 - (k % 2) * 1.1, Math.cos(a) * 0.76, Math.sin(a) * 0.76), r: 0.025, color: LAMP.WHITE, i: 1.4 }); }
  const geo = B.geometry();
  // the berthed ferry: a shuttle lying along -x off the +z port, its dorsal face to the port
  const sh = buildShuttle(110), bb = new THREE.Box3().setFromBufferAttribute(sh.geo.attributes.position);
  // (ship +Y toward the port: its top at the port face z = 1.07 km)
  const S = 7, fm = new THREE.Matrix4(), up = V(0, 0, -1), fwd = V(-1, 0, 0), side = new THREE.Vector3().crossVectors(up, fwd);
  fm.makeBasis(side, up, fwd).scale(V(S, S, S)).setPosition(MODULE.node * 1000, 0, (1.07 + bb.max.y * S * 0.001) * 1000);
  return { geo, lamps, ferry: { geo: sh.geo, m: fm, lamps: sh.lamps } };
}

/** Collector station hull-kind geometry and lamps (km), ready to instance. */
export function stationFittingsKm() {
  const f = buildStationFittings();
  const hull = toHullKinds(f.geo, null, 1), ferry = toHullKinds(f.ferry.geo, f.ferry.m);
  const lamps = [...f.lamps, ...placeLamps(f.ferry.lamps || [], f.ferry.m).map((l) => ({ ...l, p: l.p.clone().multiplyScalar(0.001), r: l.r * 0.001 * 3 }))];
  return { geo: merge([hull, ferry]), parts: { hull, ferry }, lamps };
}

// ------------------------------------------------------------- dish trusses ----
// The dish's back shell (buildCollector): r = 12.992 sin a, x = 12.736 - 12.992 cos a (km), a to 0.72.
export const BACK = { R: 40.6 * 0.32, x0: 39.8 * 0.32, rIn: 2.6, rOut: 8.2, tube: 0.05, seat: 0.03 };
export const backX = (r) => BACK.x0 - BACK.R * Math.cos(Math.asin(Math.min(r / BACK.R, 1)));
export function buildDishTruss() {
  const B = new CB(), X = (r) => backX(r) - BACK.seat;
  // hoops
  for (const r of [2.6, 3.7, 4.8, 5.9, 7.0, 8.1]) {
    const pts = [];
    for (let i = 0; i <= 96; i++) { const a = (i / 96) * TAU; pts.push(V(X(r), Math.cos(a) * r, Math.sin(a) * r)); }
    pts[96] = pts[0].clone();
    B.tube(pts, BACK.tube, 6, CK.DARK);
  }
  // radial ribs between the spokes, and a node block at every crossing
  for (let k = 0; k < 24; k++) {
    const a = ((k + 0.5) / 24) * TAU, c = Math.cos(a), sn = Math.sin(a), pts = [];
    for (let j = 0; j <= 14; j++) { const r = BACK.rIn - 0.1 + (BACK.rOut - BACK.rIn + 0.2) * (j / 14); pts.push(V(X(r), c * r, sn * r)); }
    B.tube(pts, BACK.tube * 0.8, 6, CK.HULL);
    if (k % 2 === 0) for (const r of [3.7, 5.9, 8.1]) { B.at(X(r) - 0.02, c * r, sn * r); B.box(0, 0, 0, 0.1, 0.16, 0.16, CK.BRONZE); B.pop(); }
  }
  return toHullKinds(B.geometry(), null, 1);
}

// ------------------------------------------------------------------ drones ----
// The dish (buildCollector, scaled 0.32): a spherical cap of radius 12.8 km about its vertex at the
// collector's origin, concave toward +x, 8.4 km in radius at its rim.
export const DISH = { R: 40 * 0.32, rim: 8.43, stand: 0.95, radii: [3.3, 4.7, 6.0] };   // (between the spokes behind and the receiver struts in front)
export const dishSag = (r) => DISH.R * (1 - Math.cos(Math.asin(Math.min(r / DISH.R, 1))));
/** Drone j's position in its collector's frame at time t (km). */
export function dishDrone(i, j, t, out = V(0, 0, 0)) {
  const r = DISH.radii[j], T = 160 + 45 * j, th = (t / T) * TAU * (j % 2 ? -1 : 1) + i * 1.3 + j * 2.1;
  return out.set(dishSag(r) + DISH.stand, Math.cos(th) * r, Math.sin(th) * r);
}
export function buildDishDrone() {
  // a flat cleaning drone (metres): a disc body facing the mirror (-x), four thruster pods, a lamp mast
  const B = new CB();
  B.push(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  lathe(B, [[0, -8, CK.DARK], [34, -6, CK.HULL], [40, 0, CK.BRONZE], [34, 8, CK.HULL], [12, 12, CK.GLASS], [0, 13, CK.GLASS]], 16);
  B.pop();
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + Math.PI / 4; B.tube([V(0, Math.cos(a) * 36, Math.sin(a) * 36), V(-4, Math.cos(a) * 56, Math.sin(a) * 56)], 3, 6, CK.BRONZE); B.box(-4, Math.cos(a) * 60, Math.sin(a) * 60, 12, 10, 10, CK.DARK); }
  B.tube([V(6, 0, 0), V(40, 0, 0)], 2, 6, CK.HULL);
  return toHullKinds(B.geometry());
}

// ----------------------------------------------------------------- hamlets ----
// Hamlet frame (km): origin on the ring's centre line, +x radially outward, +y up, +z along the ring.
export const HAMLET = { hangTop: -0.3, spindleR: 0.5, y0: -1.4, y1: -5.2, wheelY: -3.3, wheelR: 1.6, tube: 0.22, hubIn: 0.535, hubOut: 0.64, hubH: 0.13, port: -5.45 };
HAMLET.omega = Math.sqrt(0.00981 / (HAMLET.wheelR + HAMLET.tube));        // 1 g on the wheel's floor (rad/s)
export const hamletAngle = (i) => ((i + 0.5) / RING.count) * TAU;
export function hamletMatrix(i, out = new THREE.Matrix4()) {
  const a = hamletAngle(i), d = V(Math.cos(a), 0, Math.sin(a));
  return out.makeBasis(d, V(0, 1, 0), V(-d.z, 0, d.x)).setPosition(d.multiplyScalar(RING.R));
}
/** The fixed parts: hanger, spindle and its stator collar, radiators, port and a berthed courier. */
export function buildHamletFixed() {
  const B = new CB(), lamps = [], H = HAMLET;
  B.tube([V(0, H.hangTop, 0), V(0, H.y0 + 0.1, 0)], 0.16, 16, CK.HULL);
  for (const sd of [-1, 1]) B.tube([V(sd * 0.3, -0.25, 0), V(sd * 0.12, H.y0 + 0.4, 0)], 0.05, 8, CK.DARK);
  B.push(new THREE.Matrix4().makeRotationX(Math.PI / 2));   // lathe z -> -y
  lathe(B, [[0.12, -H.y0 - 0.05, CK.HULL], [0.42, -H.y0 + 0.1, CK.BRONZE], [H.spindleR, -H.y0 + 0.3, CK.HULL], [H.spindleR, -H.wheelY - 0.5, CK.GLASS], [H.spindleR, -H.wheelY + 0.5, CK.HULL],
    [H.spindleR, -H.y1 - 0.3, CK.GLASS], [0.44, -H.y1, CK.BRONZE], [0.2, -H.port + 0.05, CK.HULL], [0.12, -H.port, CK.DARK]], 48);
  B.pop();
  // stator: field rings seated on the spindle, facing the rotor's hub across the bearing gap
  for (const dy of [-0.1, 0.1]) { B.at(0, H.wheelY + dy, 0, Math.PI / 2, 0, 0); B.torus(H.spindleR + 0.005, 0.012, 64, 6, CK.CONDUIT); B.pop(); }
  // radiators: two edge-on leaves under the wheel
  for (const sd of [-1, 1]) {
    B.tube([V(sd * 0.45, -4.6, 0), V(sd * 2.5, -4.6, 0)], 0.035, 8, CK.DARK);
    B.box(sd * 1.5, -4.6, 0, 1.9, 0.75, 0.025, CK.RADIATOR);
    B.box(sd * 1.5, -4.6, 0, 1.95, 0.03, 0.05, CK.BRONZE);
  }
  // the courier: bow up against the port, its hull hanging clear below
  const sh = buildShuttle(110), bb = new THREE.Box3().setFromBufferAttribute(sh.geo.attributes.position);
  const S = 3.2, cm = new THREE.Matrix4().makeBasis(V(-1, 0, 0), V(0, 0, 1), V(0, 1, 0)).scale(V(S, S, S)).setPosition(0, (H.port - bb.max.z * S * 0.001) * 1000, 0);
  lamps.push({ p: V(0, H.hangTop - 0.15, 0.2), r: 0.02, color: LAMP.AMBER, i: 2.4, breathe: 0.4 }, { p: V(2.55, -4.6, 0), r: 0.03, color: LAMP.RED, i: 2.6 }, { p: V(-2.55, -4.6, 0), r: 0.03, color: LAMP.GREEN, i: 2.6 });
  return { geo: B.geometry(), courier: { geo: sh.geo, m: cm, bb, S } , lamps };
}
/** The rotor: wheel, spokes and hub sleeve (about the hamlet's y axis, at the origin). */
export function buildHamletWheel() {
  const B = new CB(), H = HAMLET;
  B.at(0, 0, 0, Math.PI / 2, 0, 0); B.torus(H.wheelR, H.tube, 128, 16, CK.GLASS); B.pop();
  for (const dy of [-H.tube * 0.75, H.tube * 0.75]) { B.at(0, dy, 0, Math.PI / 2, 0, 0); B.torus(H.wheelR, 0.03, 128, 6, CK.BRONZE); B.pop(); }
  B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  lathe(B, [[H.hubIn, -H.hubH, CK.BRONZE], [H.hubOut, -H.hubH, CK.HULL], [H.hubOut, H.hubH, CK.HULL], [H.hubIn, H.hubH, CK.BRONZE]], 64, 0, { closedProfile: true });
  B.pop();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU, d = V(Math.cos(a), 0, Math.sin(a));
    B.tube([d.clone().multiplyScalar(H.hubOut - 0.02), d.clone().multiplyScalar(H.wheelR - H.tube + 0.03)], 0.05, 10, CK.HULL);
    // a lift car parked at mid-spoke (the crews ride them out to the wheel)
    B.box(d.x * 1.05, 0.07, d.z * 1.05, 0.09, 0.05, 0.09, CK.GLASS);
  }
  return B.geometry();
}

// -------------------------------------------------------------------- trams ----
/** The arc a tram works: from just past station i to just short of station i+1 (radians). */
export function tramArc(i) {
  const a0 = (i / RING.count) * TAU + RING.delta, a1 = ((i + 1) / RING.count) * TAU - RING.delta;
  return { a0, a1 };
}
export const TRAM = { len: 0.56, half: 0.09, h: 0.16, T: 340, dwell: 0.12 };
/** Tram i's angle at time t. */
export function tramAngle(i, t) {
  const a0 = (i / RING.count) * TAU + RING.delta, a1 = ((i + 1) / RING.count) * TAU - RING.delta, u = (((t / TRAM.T) + i * 0.173) % 1 + 1) % 1, D = TRAM.dwell, run = 0.5 - D;
  const s = u < D ? 0 : u < 0.5 ? smooth(0, 1, (u - D) / run) : u < 0.5 + D ? 1 : 1 - smooth(0, 1, (u - 0.5 - D) / run);
  // the ends of the run stop half a car short of the platform ends
  const pad = (TRAM.len * 0.6) / RING.R;
  return a0 + pad + (a1 - a0 - 2 * pad) * s;
}
export function buildTram() {
  const B = new CB(), L = TRAM.len, w = TRAM.half, h = TRAM.h;
  // a slim car on the rail: body, glazed band, bogies (origin on the rail top, +z along the ring)
  B.box(0, h * 0.55, 0, w * 2, h * 0.7, L * 0.86, CK.HULL);
  B.box(0, h * 0.62, 0, w * 2.04, h * 0.22, L * 0.8, CK.GLASS);
  for (const sd of [-1, 1]) {
    B.at(0, h * 0.55, sd * L * 0.43); B.push(new THREE.Matrix4().makeScale(1, 1, sd));
    lathe(B, [[w * 0.98, 0, CK.HULL], [w * 0.8, L * 0.05, CK.HULL], [w * 0.3, L * 0.07, CK.GLASS], [0, L * 0.075, CK.GLASS]], 12);
    B.pop(); B.pop();
    B.box(0, 0.02, sd * L * 0.3, w * 1.6, 0.04, 0.08, CK.DARK);
  }
  return B.geometry();
}
/** Platforms at both ends of every arc (km, ring frame): deck outboard of the rail, shelter, bracket. */
export function buildPlatforms() {
  const B = new CB(), lamps = [];
  for (let i = 0; i < RING.count; i++) for (const e of [0, 1]) {
    const { a0, a1 } = tramArc(i), a = e ? a1 : a0, d = V(Math.cos(a), 0, Math.sin(a)), t = V(-d.z, 0, d.x);
    const m = new THREE.Matrix4().makeBasis(d, V(0, 1, 0), t).setPosition(d.clone().multiplyScalar(RING.R));
    B.push(m);
    B.box(0.46, 0.2, 0, 0.14, 0.5, 0.3, CK.DARK);            // bracket off the ring tube's flank
    B.box(0.72, 0.72, 0, 0.44, 0.05, 1.1, CK.DECK);          // deck, level with the rail top
    B.box(0.82, 0.83, 0, 0.18, 0.16, 0.6, CK.GLASS);          // shelter
    B.box(0.82, 0.92, 0, 0.22, 0.03, 0.66, CK.BRONZE);
    B.pop();
    lamps.push({ p: d.clone().multiplyScalar(RING.R + 0.95).setY(0.8), r: 0.03, color: LAMP.AMBER, i: 2.2, breathe: 0.3, phase: i / 14 });
  }
  return { geo: B.geometry(), lamps };
}

// ------------------------------------------------------------------ feeder ----
export const TANKER = { scale: 4, queue: [22, 34, 46], berthUp: 5.5, T: 420 };
/** Tanker placements (Hearth frame, km): the queue astern (against the prograde) and the transfer berth over the feeder. */
export function tankerSlots() {
  const f = feederFrame(), up = V(0, 1, 0);
  const queue = TANKER.queue.map((k) => f.pos.clone().addScaledVector(f.prograde, -k).addScaledVector(up, 1.5));
  const berth = f.pos.clone().addScaledVector(up, TANKER.berthUp);
  return { queue, berth, fwd: f.prograde.clone(), f };
}
/** The working tanker's position at t: from the queue's head up to the berth, dwelling, and back astern. */
let _slots = null, _head = null;
export function tankerPose(t, out = V(0, 0, 0)) {
  if (!_slots) { _slots = tankerSlots(); _head = _slots.queue[0].clone().addScaledVector(_slots.fwd, 10); }
  const s = _slots, head = _head, u = (((t / TANKER.T) % 1) + 1) % 1;
  const k = u < 0.25 ? smooth(0, 0.25, u) : u < 0.6 ? 1 : 1 - smooth(0.6, 0.85, u);
  return out.copy(head).lerp(s.berth, k);
}
/** Accelerator collars along the injector boom and the funnel coils at its nozzle (Hearth frame km). */
export function buildInjectorCoils() {
  const B = new CB(), f = feederFrame(), lamps = [];
  const dir = f.throat.clone().sub(f.root), L = dir.length(); dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir);
  for (let j = 1; j <= 6; j++) {
    const p = f.root.clone().addScaledVector(dir, (L * j) / 7.2);
    B.push(new THREE.Matrix4().compose(p, q, V(1, 1, 1)));
    B.torus(0.175, 0.05, 32, 8, j % 2 ? CK.BRONZE : CK.CONDUIT);
    B.pop();
    lamps.push({ p: p.clone().add(V(0, 0.24, 0)), r: 0.03, color: [1.0, 0.6, 0.3], i: 2.4, breathe: 0.6, phase: j / 6 });
  }
  return { geo: B.geometry(), lamps };
}

export class HearthDistrict {
  constructor(hearth) {
    this.hearth = hearth;
    const mat = hearth.hullMat, mask = mat.uniforms;
    this.mask = mask;
    // ---- collector station fittings, instanced on the collectors' own matrices
    const sf = stationFittingsKm();
    this.fittingData = sf;
    const mats = hearth.collectorMounts.map((c) => { c.collector.updateMatrix(); return c.collector.matrix.clone(); });
    this.fittings = new THREE.InstancedMesh(sf.geo, mat, mats.length);
    mats.forEach((m, i) => this.fittings.setMatrixAt(i, m));
    const L = [];
    for (const m of mats) L.push(...placeLamps(sf.lamps, m));
    this.fittings.add(createLamps(L, { minPx: 1.1, mask }));
    hearth.stations.add(this.fittings);
    // ---- the dish trusses
    this.trusses = new THREE.InstancedMesh(buildDishTruss(), mat, mats.length);
    mats.forEach((m, i) => this.trusses.setMatrixAt(i, m));
    hearth.stations.add(this.trusses);
    // ---- the dish drones: instanced on the collectors' frames, lamps riding with them
    this.collectorMats = mats;
    this.drones = new THREE.InstancedMesh(buildDishDrone(), mat, mats.length * DISH.radii.length);
    hearth.stations.add(this.drones);
    this.droneLamps = createLamps(Array.from({ length: mats.length * DISH.radii.length }, (_, k) => ({ p: V(0, 0, 0), r: 0.012, color: k % 3 ? LAMP.TEAL : LAMP.AMBER, i: 3, breathe: 0.5, phase: (k * 0.37) % 1 })), { minPx: 1.1, mask });
    this.droneAttr = this.droneLamps.geometry.getAttribute('iLamp');
    hearth.stations.add(this.droneLamps);
    // ---- the ring hamlets: fixed parts instanced, wheels turned each frame
    const hf = buildHamletFixed();
    this.hamletMats = Array.from({ length: RING.count }, (_, i) => hamletMatrix(i));
    const hfGeo = merge([toHullKinds(hf.geo, null, 1), toHullKinds(hf.courier.geo, hf.courier.m)]);
    this.hamlets = new THREE.InstancedMesh(hfGeo, mat, RING.count);
    this.hamletMats.forEach((m, i) => this.hamlets.setMatrixAt(i, m));
    const HL = [];
    for (const m of this.hamletMats) HL.push(...placeLamps(hf.lamps, m));
    this.hamlets.add(createLamps(HL, { minPx: 1.1, mask }));
    hearth.stations.add(this.hamlets);
    this.wheels = new THREE.InstancedMesh(toHullKinds(buildHamletWheel(), null, 1), mat, RING.count);
    hearth.stations.add(this.wheels);
    // window lamps riding the wheels: eight round each
    this.wheelLamps = createLamps(Array.from({ length: RING.count * 8 }, (_, k) => ({ p: V(0, 0, 0), r: 0.03, color: k % 4 ? [1.0, 0.82, 0.6] : LAMP.WHITE, i: 1.6 })), { minPx: 1.1, mask });
    this.wheelAttr = this.wheelLamps.geometry.getAttribute('iLamp');
    hearth.stations.add(this.wheelLamps);
    this._rot = new THREE.Matrix4(); this._wl = V(0, 0, 0);
    // ---- ring platforms and trams
    const pl = buildPlatforms();
    this.platforms = new THREE.Mesh(toHullKinds(pl.geo, null, 1), mat);
    this.platforms.add(createLamps(pl.lamps, { minPx: 1.1, mask }));
    hearth.stations.add(this.platforms);
    this.trams = new THREE.InstancedMesh(toHullKinds(buildTram(), null, 1), mat, RING.count);
    hearth.stations.add(this.trams);
    this.tramLamps = createLamps(Array.from({ length: RING.count * 2 }, (_, k) => ({ p: V(0, 0, 0), r: 0.02, color: k % 2 ? LAMP.RED : LAMP.WHITE, i: 3 })), { minPx: 1.2, mask });
    this.tramAttr = this.tramLamps.geometry.getAttribute('iLamp');
    hearth.stations.add(this.tramLamps);
    // ---- the feeder's coils and its tankers (the works' Hearth-frame group)
    const works = hearth.works, frame = works.frame;
    const ic = buildInjectorCoils();
    this.coils = new THREE.Mesh(toHullKinds(ic.geo, null, 1), mat);
    this.coils.add(createLamps(ic.lamps, { minPx: 1.2, mask }));
    frame.add(this.coils);
    const fr = buildFreighter(1100);
    const S = TANKER.scale, sm = new THREE.Matrix4().makeScale(S, S, S);
    const tg = toHullKinds(fr.geo, sm);
    const tl = placeLamps(fr.lamps, sm, 6).map((l) => ({ ...l, p: l.p.clone().multiplyScalar(0.001), r: l.r * 0.001 }));
    const slots = tankerSlots();
    this.slots = slots;
    const basis = new THREE.Matrix4().lookAt(V(0, 0, 0), slots.fwd.clone().negate(), V(0, 1, 0));   // +z along the prograde
    this.tankerQuat = new THREE.Quaternion().setFromRotationMatrix(basis);
    this.tankers = [...slots.queue, slots.berth].map((p, i) => {
      const m = new THREE.Mesh(tg, mat);
      m.position.copy(p); m.quaternion.copy(this.tankerQuat);
      m.add(createLamps(tl, { minPx: 1.2, mask }));
      const glows = fr.glows.map((g) => ({ ...g, p: g.p.clone().multiplyScalar(S * 0.001), r: g.r * S * 0.001 }));
      const engines = addEngines(m, glows, { scale: 0.7, length: 8, color: 0xffc080, core: 0xfff0d8, throttle: i < 3 ? 0.03 : 0 });
      frame.add(m);
      return { mesh: m, engines };
    });
    // ---- the refuge wheels' rim and garden lights, riding the wheels
    hearth.refugeRotors.forEach((rotor, w) => {
      const R = [];
      for (let k = 0; k < 64; k++) { const a = (k / 64) * TAU; R.push({ p: V(Math.cos(a) * 13.3, (k % 2 ? 0.5 : -0.5), Math.sin(a) * 13.3), r: 0.05, color: k % 8 ? LAMP.WHITE : LAMP.AMBER, i: k % 8 ? 1.2 : 2.4, breathe: k % 8 ? 0 : 0.4, phase: k / 64 }); }
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; R.push({ p: V(Math.cos(a) * 6.8, 0.85, Math.sin(a) * 6.8), r: 0.18, color: [1.0, 0.78, 0.5], i: 1.4, breathe: 0.2, phase: (k + w) / 6 }); }
      rotor.add(createLamps(R, { minPx: 1.1, mask }));
    });
    for (const o of [this.fittings, this.trusses, this.drones, this.hamlets, this.wheels, this.platforms, this.trams, this.coils, ...this.tankers.map((t) => t.mesh)]) { o.frustumCulled = false; o.renderOrder = 3; }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = V(0, 0, 0); this._s = V(1, 1, 1); this._t = V(0, 0, 0); this._y = V(0, 1, 0); this._z = V(0, 0, 0);
    this.update(0);
  }

  update(t) {
    const P = this._p, m = this._m, a = this.tramAttr.array;
    for (let i = 0; i < RING.count; i++) {
      const th = tramAngle(i, t), c = Math.cos(th), s = Math.sin(th);
      P.set(c * RING.R, RING.rail, s * RING.R);
      this._t.set(-s, 0, c);
      this._z.crossVectors(this._y, this._t);    // outward (x) for the basis: x = up x fwd
      m.makeBasis(this._z, this._y, this._t).setPosition(P);
      this.trams.setMatrixAt(i, m);
      for (let e = 0; e < 2; e++) {
        const k = (i * 2 + e) * 4, o = (e ? -1 : 1) * TRAM.len * 0.5;
        a[k] = P.x + this._t.x * o; a[k + 1] = P.y + TRAM.h * 0.6; a[k + 2] = P.z + this._t.z * o;
      }
    }
    this.trams.instanceMatrix.needsUpdate = true;
    this.tramAttr.needsUpdate = true;
    const da = this.droneAttr.array, nr = DISH.radii.length;
    for (let i = 0; i < this.collectorMats.length; i++) for (let j = 0; j < nr; j++) {
      const k = i * nr + j;
      dishDrone(i, j, t, P).applyMatrix4(this.collectorMats[i]);
      m.copy(this.collectorMats[i]).setPosition(P);
      this.drones.setMatrixAt(k, m);
      da[k * 4] = P.x; da[k * 4 + 1] = P.y; da[k * 4 + 2] = P.z;
    }
    this.drones.instanceMatrix.needsUpdate = true;
    this.droneAttr.needsUpdate = true;
    const wa = this.wheelAttr.array, th = (t * HAMLET.omega) % TAU;
    for (let i = 0; i < RING.count; i++) {
      const dir = i % 2 ? 1 : -1;
      this._rot.makeRotationY(th * dir).setPosition(0, HAMLET.wheelY, 0);
      m.multiplyMatrices(this.hamletMats[i], this._rot);
      this.wheels.setMatrixAt(i, m);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        this._wl.set(Math.cos(a) * (HAMLET.wheelR + HAMLET.tube + 0.01), 0, Math.sin(a) * (HAMLET.wheelR + HAMLET.tube + 0.01)).applyMatrix4(m);
        const q = (i * 8 + k) * 4;
        wa[q] = this._wl.x; wa[q + 1] = this._wl.y; wa[q + 2] = this._wl.z;
      }
    }
    this.wheels.instanceMatrix.needsUpdate = true;
    this.wheelAttr.needsUpdate = true;
    const w = this.tankers[3];
    tankerPose(t, w.mesh.position);
    const u = (((t / TANKER.T) % 1) + 1) % 1, moving = (u < 0.25) || (u > 0.6 && u < 0.85);
    for (const e of w.engines) e.setThrottle(moving ? 0.35 : 0.02);
  }
}
