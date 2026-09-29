import * as THREE from 'three';
import { CB, CK, buildTender } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { craftMesh, addLamps, addEngines, placeMerge } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { craftInstances, MovingLamps } from './helianthDistrict.js';

// THE NAURU WORKS AT WORK (metres, the foundry's frame: x west, y up, z north; the three
// receiving halls open toward -z and stay empty; the stock courts lie behind them at x = +-6500).
//
//   cranes    each stock court carries a gantry crane on two column-borne rails. Its bridge
//             travels the court, its trolley crosses it, and a spreader lifts a cast billet
//             cassette from one stack's roof, carries it clear over the court's spine pipe and
//             sets it down on the next stack: the cassette is always seated or hanging
//   carts     tracked stock carts shuttle each court's outer side lane inside the crane columns
//   furnaces  the three reduction furnaces glow through their glazed bands; the process pods
//             breathe with the arc light of the melt
//   drones    inspection drones circle the garden wheel and the courts on fixed, clear orbits
//   wheel     lift cars ride the tops of the garden wheel's six spokes between hub and rim
//   crews     suited crews walk the stack roofs under the spine pipe, helmet lamps lit
//   queue     three ore tenders hold station in the approach lane south of the halls,
//             waiting their turn at the unloading bays
//
// The verifier (tools/verify-sun.mjs) checks every crane pose against the courts, the carts
// against the columns and stacks, the drones' orbits and the halls' reserved volumes.

const V = (x, y, z) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const TO_Y = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

// the courts, as buildFoundry lays them out
export const COURT = { x: 6500, slabTop: -830, roofTop: 52.5, stacks: [1750, 2600, 3450, 4300, 5150], stackHalfZ: 345, stackHalfX: 650, spineY: 200, spineR: 60 };
export const CRANE = { railY: 700, railX: 810, railZ0: 1200, railZ1: 5800, cols: [1200, 3500, 5800], colR: 26, pickX: 400, carry: 330, box: [200, 120, 300], T: 240 };
export const CART = { laneX: 720, z0: 1320, z1: 5680, size: [60, 32, 120], T: 300 };

/** The gantry crane rails and columns for court s (+1 west, -1 east). */
export function buildCraneWorks(s) {
  const B = new CB(), lamps = [], x0 = s * COURT.x;
  for (const dx of [-CRANE.railX, CRANE.railX]) {
    const x = x0 + dx;
    // the rail girder, a box beam with a bronze running surface
    B.box(x, CRANE.railY - 20, (CRANE.railZ0 + CRANE.railZ1) / 2, 40, 40, CRANE.railZ1 - CRANE.railZ0 + 60, CK.DARK);
    B.box(x, CRANE.railY + 2, (CRANE.railZ0 + CRANE.railZ1) / 2, 18, 4, CRANE.railZ1 - CRANE.railZ0 + 60, CK.BRONZE);
    for (const z of CRANE.cols) {
      // column: founded on the slab through a base plate, braced into the girder
      B.box(x, COURT.slabTop + 6, z, 70, 12, 70, CK.BRONZE);
      B.tube([V(x, COURT.slabTop, z), V(x, CRANE.railY - 38, z)], CRANE.colR, 10, CK.HULL);
      for (const dz of [-1, 1]) if (z + dz * 180 > CRANE.railZ0 - 30 && z + dz * 180 < CRANE.railZ1 + 30) B.tube([V(x, CRANE.railY - 260, z + dz * 18), V(x, CRANE.railY - 40, z + dz * 180)], 8, 6, CK.DARK);
      lamps.push({ p: V(x, CRANE.railY + 20, z), r: 8, color: LAMP.AMBER, i: 2, breathe: 0.3, phase: z / 7000 });
    }
    // end stops
    for (const z of [CRANE.railZ0 - 30, CRANE.railZ1 + 30]) B.box(x, CRANE.railY + 12, z, 44, 24, 20, CK.BRONZE);
  }
  return { geo: B.geometry(), lamps };
}

/** The moving crane: bridge (local x across, origin at the bridge centre on the rail tops). */
export function buildCraneBridge() {
  const B = new CB();
  const span = CRANE.railX * 2 + 60;
  for (const dz of [-24, 24]) B.box(0, 28, dz, span, 36, 14, CK.HULL);
  for (let x = -CRANE.railX; x <= CRANE.railX; x += 200) B.box(x, 28, 0, 8, 30, 50, CK.DARK);
  for (const sd of [-1, 1]) {
    B.box(sd * CRANE.railX, 12, 0, 50, 24, 110, CK.BRONZE);              // end trucks on the rails
    B.box(sd * CRANE.railX, 50, 0, 36, 14, 40, CK.GLASS);                 // driver's cab
  }
  return B.geometry();
}
/** Trolley + hoist block (origin at the trolley's running line, y = bridge top). */
export function buildCraneTrolley() {
  const B = new CB();
  B.box(0, 52, 0, 60, 16, 70, CK.DARK);
  B.box(0, 64, 0, 40, 10, 40, CK.BRONZE);
  B.box(0, 15, 0, 30, 30, 30, CK.HULL);       // hoist block, rising into the bridge's slot
  return B.geometry();
}
/** Spreader + cassette (origin at the cassette's base, hanging from a cable of variable length). */
export function buildCassette() {
  const B = new CB(), [w, h, l] = CRANE.box;
  B.box(0, h / 2, 0, w, h, l, CK.HULL);
  for (let j = 0; j < 5; j++) B.box(0, h * 0.2 + j * h * 0.15, 0, w + 4, 6, l - 30, j % 2 ? CK.BRONZE : CK.DARK);
  B.box(0, h + 5, 0, w * 0.9, 10, l * 0.95, CK.BRONZE);                   // spreader frame
  B.box(0, h + 3, l / 2 + 1, 50, 6, 2, CK.LANTERN);
  return B.geometry();
}

/**
 * Crane state at time t for court s: bridge z, trolley x (court-relative), cassette base y and
 * whether it hangs. The cassette moves from stack n to stack n+1 (bouncing along the five).
 */
export function cranePose(t, s, out = {}) {
  const cyc = t / CRANE.T + (s > 0 ? 0 : 0.5), n = Math.floor(cyc), u = cyc - n;
  const order = [0, 1, 2, 3, 4, 3, 2, 1], a = order[((n % 8) + 8) % 8], b = order[(((n + 1) % 8) + 8) % 8];
  const za = COURT.stacks[a], zb = COURT.stacks[b];
  const xa = (a % 2 ? 1 : -1) * CRANE.pickX, xb = (b % 2 ? 1 : -1) * CRANE.pickX;
  const seat = COURT.roofTop;
  // phases: lift 0-.18, travel .18-.62, lower .62-.8, dwell .8-1 (trolley returns overhead)
  const lift = smooth(0, 0.18, u) * (1 - smooth(0.62, 0.8, u));
  const move = smooth(0.18, 0.62, u);
  out.z = za + (zb - za) * move;
  out.x = xa + (xb - xa) * move;
  out.y = seat + (CRANE.carry - seat) * lift;
  out.hanging = u > 0.005 && u < 0.795;
  out.from = a; out.to = b;
  return out;
}

/** Cart k's pose (court-relative lane x, z): two carts per court share the outer lane, each its own half
 * (the inner lane is crossed by the transfer tube from the halls at z = 1800). */
export function cartPose(t, k, out = V(0, 0, 0)) {
  const half = k % 2, u = (((t / CART.T) + k * 0.29) % 1 + 1) % 1, s = u < 0.5 ? smooth(0, 1, u * 2) : smooth(0, 1, 2 - u * 2);
  const mid = (CART.z0 + CART.z1) / 2, z0 = half ? mid + 70 : CART.z0, z1 = half ? CART.z1 : mid - 70;
  return out.set(CART.laneX, COURT.slabTop, z0 + (z1 - z0) * s);
}
export function buildCart() {
  const B = new CB(), [w, h, l] = CART.size;
  for (const sd of [-1, 1]) B.box(sd * (w / 2 - 6), 7, 0, 12, 14, l, CK.DARK);         // tracks
  B.box(0, 14 + (h - 14) / 2, 0, w - 8, h - 14, l - 20, CK.HULL);
  B.box(0, h + 4, -l / 2 + 26, w - 20, 8, 30, CK.GLASS);
  B.box(0, h - 4, l / 2 - 8, 30, 6, 2, CK.LANTERN);
  return B.geometry();
}

/** Drone orbits (foundry metres): centre, radius, height, period, phase. */
export function droneOrbits() {
  const out = [];
  for (let k = 0; k < 18; k++) out.push({ c: V(0, 500, 6200), R: 2500 + (k % 3) * 110, y: 500 + ((k % 4) - 1.5) * 90, T: 260 + (k % 5) * 25, ph: k / 18, dir: k % 2 ? 1 : -1 });
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) out.push({ c: V(s * COURT.x, 0, 3450), R: 1300 + (k % 2) * 140, y: 1150 + (k % 3) * 80, T: 200 + k * 17, ph: k / 6, dir: s });
  return out;
}
export function dronePos(o, t, out = V(0, 0, 0)) {
  const a = (t / o.T + o.ph) * TAU * o.dir;
  return out.set(o.c.x + Math.cos(a) * o.R, o.y + 12 * Math.sin(a * 3), o.c.z + Math.sin(a) * o.R);
}
export function buildDrone() {
  const B = new CB();
  B.at(0, 0, 0); B.push(TO_Y);
  lathe(B, [[0, -3, CK.DARK], [4, -2, CK.HULL], [4.5, 1.5, CK.HULL], [2.5, 3, CK.GLASS], [0, 3.4, CK.GLASS]], 12);
  B.pop(); B.pop();
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + Math.PI / 4; B.tube([V(Math.cos(a) * 4, 0, Math.sin(a) * 4), V(Math.cos(a) * 8, -1, Math.sin(a) * 8)], 0.6, 5, CK.BRONZE); B.box(Math.cos(a) * 8.4, -1.5, Math.sin(a) * 8.4, 2, 2, 2, CK.DARK); }
  return B.geometry();
}

/** Garden-wheel spoke lifts (foundry metres): spokes of radius 90 m at y 500 round (0, 6200). */
export const WHEEL = { c: V(0, 500, 6200), r: 90, seg: 10, from: 720, to: 1640, T: 120 };
export const wheelCarTop = () => WHEEL.c.y + WHEEL.r * Math.cos(Math.PI / WHEEL.seg) - 0.5;
export function wheelCar(k, t, out = V(0, 0, 0)) {
  const a = (k / 6) * TAU, u = (((t / WHEEL.T) + k * 0.41) % 1 + 1) % 1;
  const s = u < 0.15 ? 0 : u < 0.5 ? smooth(0.15, 0.5, u) : u < 0.65 ? 1 : 1 - smooth(0.65, 1, u);
  const r = WHEEL.from + (WHEEL.to - WHEEL.from) * s;
  return out.set(WHEEL.c.x + Math.cos(a) * r, wheelCarTop(), WHEEL.c.z + Math.sin(a) * r);
}
export function buildWheelCar() {
  const B = new CB();
  for (const sd of [-1, 1]) B.box(sd * 8, 2.5, 0, 5, 5, 40, CK.DARK);
  B.box(0, 11, 0, 26, 13, 44, CK.HULL);
  B.box(0, 12.5, 0, 27, 5, 38, CK.GLASS);
  B.box(0, 18.8, 0, 22, 2.5, 40, CK.BRONZE);
  return B.geometry();
}

/** Crew walking the stack roofs (foundry metres). */
export function crewPos(j, t, out = V(0, 0, 0)) {
  const s = j % 2 ? 1 : -1, stack = (j >> 1) % 5, side = (j >> 1) % 2 ? 1 : -1, T = 180 + (j % 7) * 20;
  const u = (((t / T) + j * 0.23) % 1 + 1) % 1, w = u < 0.5 ? u * 2 : 2 - u * 2;
  return out.set(s * COURT.x + side * (80 + 170 * w), COURT.roofTop + 1.7, COURT.stacks[stack] + ((j * 37) % 200 - 100));
}

/** Tender queue in the approach lane (foundry metres). */
export const QUEUE = [V(-4200, -200, -9200), V(4200, -200, -9800), V(-4200, -350, -12800)];

/** Furnace and process lamps. */
export function furnaceLamps(data) {
  const out = [];
  for (const x of [-4200, 0, 4200]) {
    for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; out.push({ p: V(x + Math.cos(a) * 640, 880, 2550 + Math.sin(a) * 640), r: 30, color: [1.0, 0.42, 0.14], i: 2.2, breathe: 0.8, phase: (k * 0.37) % 1 }); }
    out.push({ p: V(x, 1650, 2550), r: 60, color: [1.0, 0.55, 0.2], i: 1.6, breathe: 0.6 });
  }
  for (const p of data.processPods || []) out.push({ p: p.center.clone().add(V(0, 460, 0)), r: 22, color: [0.7, 0.85, 1.0], i: 2.6, breathe: 0.9, phase: (p.center.x * 0.001) % 1 });
  return out;
}

export class FoundryYard {
  constructor(group, data) {
    this.group = group; this.data = data; this.built = false;
    // (the yard is built in metres: its root carries the km scale)
    this.root = new THREE.Group(); this.root.scale.setScalar(0.001); this.root.visible = false; group.add(this.root);
    this._p = V(0, 0, 0); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = V(1, 1, 1); this._c = {};
  }

  build() {
    if (this.built) return;
    const opt = { accent: [0.5, 1, 0.8], lit: 0.6, scale: 1 };
    for (const s of [-1, 1]) {
      const w = buildCraneWorks(s), m = craftMesh(w.geo, opt);
      addLamps(m, w.lamps, { minPx: 1.2 });
      this.root.add(m);
    }
    this.bridges = craftInstances(buildCraneBridge(), [0, 1].map(() => new THREE.Matrix4()), opt);
    this.trolleys = craftInstances(buildCraneTrolley(), [0, 1].map(() => new THREE.Matrix4()), opt);
    this.cassettes = craftInstances(buildCassette(), [0, 1].map(() => new THREE.Matrix4()), opt);
    // hoist cables: a unit-length vertical tube, scaled per frame
    const cb = new CB(); cb.tube([V(0, 0, 0), V(0, 1, 0)], 1.5, 6, CK.DARK);
    this.cables = craftInstances(cb.geometry(), [0, 1, 2, 3].map(() => new THREE.Matrix4()), opt);
    this.carts = craftInstances(buildCart(), Array.from({ length: 4 }, () => new THREE.Matrix4()), opt);
    this.wheelCars = craftInstances(buildWheelCar(), Array.from({ length: 6 }, () => new THREE.Matrix4()), opt);
    this.root.add(this.wheelCars);
    this.orbits = droneOrbits();
    this.drones = craftInstances(buildDrone(), this.orbits.map(() => new THREE.Matrix4()), opt);
    this.root.add(this.bridges, this.trolleys, this.cassettes, this.cables, this.carts, this.drones);
    this.droneLamps = new MovingLamps(this.orbits.length, { r: 3, color: LAMP.TEAL, i: 3, breathe: 0.5 });
    this.cartLamps = new MovingLamps(4, { r: 3, color: LAMP.AMBER, i: 3 });
    this.crew = new MovingLamps(24, { r: 1.1, color: LAMP.WHITE, i: 2.6 });
    this.root.add(this.droneLamps.mesh, this.cartLamps.mesh, this.crew.mesh);
    // furnace light (the foundry's own lamps ride the foundry mesh; these breathe with the melt)
    addLamps(this.root, furnaceLamps(this.data), { minPx: 1.3 });
    // the tender queue
    const te = buildTender(300), I = new THREE.Matrix4();
    const tg = placeMerge([{ geo: te.geo, m: I }, ...te.arms.map((A) => ({ geo: A.geo, m: I }))]);
    this.queue = QUEUE.map((p, i) => {
      const m = craftMesh(tg, { ...opt, lit: 0.5 });
      m.position.copy(p);
      const eng = addEngines(m, te.glows, { scale: 0.7, length: 6, throttle: 0.04 });
      addLamps(m, [{ p: V(0, 20, 0), r: 5, color: i % 2 ? LAMP.AMBER : LAMP.WHITE, i: 2.4, breathe: 0.4, phase: i / 3 }], { minPx: 1.2 });
      this.root.add(m);
      return { mesh: m, eng };
    });
    this.built = true;
    this.animate(0);
  }

  update(t, camDist) {
    if (!this.built && camDist < 3000) this.build();
    this.root.visible = this.built && camDist < 160;
    if (this.root.visible) this.animate(t);
  }

  animate(t) {
    const P = this._p, m = this._m, q = this._q.identity(), S = this._s, c = this._c;
    let ci = 0;
    [-1, 1].forEach((s, i) => {
      cranePose(t, s, c);
      const x0 = s * COURT.x;
      this.bridges.setMatrixAt(i, m.compose(P.set(x0, CRANE.railY + 4, c.z), q, S.set(1, 1, 1)));
      const bridgeTop = CRANE.railY + 4 + 46;
      this.trolleys.setMatrixAt(i, m.compose(P.set(x0 + c.x, bridgeTop - 52, c.z), q, S.set(1, 1, 1)));
      this.cassettes.setMatrixAt(i, m.compose(P.set(x0 + c.x, c.y, c.z), q, S.set(1, 1, 1)));
      // two falls from the hoist block to the spreader (always, so the load never floats)
      const top = bridgeTop - 52 + 2, bottom = c.y + CRANE.box[1] + 10;
      for (const dz of [-60, 60]) this.cables.setMatrixAt(ci++, m.compose(P.set(x0 + c.x, bottom, c.z + dz * 0.5), q, S.set(1, Math.max(top - bottom, 1), 1)));
    });
    for (let k = 0; k < 4; k++) {
      const s = k < 2 ? -1 : 1;
      cartPose(t, k, P);
      P.x = s * (COURT.x + P.x);
      this.carts.setMatrixAt(k, m.compose(P, q, S.set(1, 1, 1)));
      this.cartLamps.set(k, P.setY(P.y + CART.size[1] + 8));
    }
    for (let k = 0; k < this.orbits.length; k++) {
      dronePos(this.orbits[k], t, P);
      this.drones.setMatrixAt(k, m.compose(P, q, S.set(1, 1, 1)));
      this.droneLamps.set(k, P.setY(P.y + 6));
    }
    for (let j = 0; j < this.crew.count; j++) this.crew.set(j, crewPos(j, t, P));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      wheelCar(k, t, P);
      m.makeRotationY(Math.PI / 2 - a).setPosition(P);          // +z along the spoke, outward
      this.wheelCars.setMatrixAt(k, m);
    }
    for (const im of [this.bridges, this.trolleys, this.cassettes, this.cables, this.carts, this.drones, this.wheelCars]) im.instanceMatrix.needsUpdate = true;
    this.droneLamps.commit(); this.cartLamps.commit(); this.crew.commit();
  }
}
