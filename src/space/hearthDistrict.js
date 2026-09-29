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

// -------------------------------------------------------------------- trams ----
/** The arc a tram works: from just past station i to just short of station i+1 (radians). */
export function tramArc(i) {
  const a0 = (i / RING.count) * TAU + RING.delta, a1 = ((i + 1) / RING.count) * TAU - RING.delta;
  return { a0, a1 };
}
export const TRAM = { len: 0.56, half: 0.09, h: 0.16, T: 340, dwell: 0.12 };
/** Tram i's angle at time t. */
export function tramAngle(i, t) {
  const { a0, a1 } = tramArc(i), u = (((t / TRAM.T) + i * 0.173) % 1 + 1) % 1, D = TRAM.dwell, run = 0.5 - D;
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
export function tankerPose(t, out = V(0, 0, 0)) {
  const s = tankerSlots(), head = s.queue[0].clone().addScaledVector(s.fwd, 10), u = (((t / TANKER.T) % 1) + 1) % 1;
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
    for (const o of [this.fittings, this.platforms, this.trams, this.coils, ...this.tankers.map((t) => t.mesh)]) { o.frustumCulled = false; o.renderOrder = 3; }
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
      for (const e of [0, 1]) {
        const k = (i * 2 + e) * 4, o = (e ? -1 : 1) * TRAM.len * 0.5;
        a[k] = P.x + this._t.x * o; a[k + 1] = P.y + TRAM.h * 0.6; a[k + 2] = P.z + this._t.z * o;
      }
    }
    this.trams.instanceMatrix.needsUpdate = true;
    this.tramAttr.needsUpdate = true;
    const w = this.tankers[3];
    tankerPose(t, w.mesh.position);
    const u = (((t / TANKER.T) % 1) + 1) % 1, moving = (u < 0.25) || (u > 0.6 && u < 0.85);
    for (const e of w.engines) e.setThrottle(moving ? 0.35 : 0.02);
  }
}
