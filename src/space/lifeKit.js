import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { createLamps } from './lamps.js';

// Shared pieces for the working life of the geostationary arc (Harbour, Concord Yard, Water
// Store, release yard): instanced craft parts that share a station's material, lamps that move
// or flicker without reallocating, deterministic randomness and the small kinematic helpers
// every cycle (cranes, trolleys, conveyors, drones) is written with. No per-frame allocation.

export const TAU = Math.PI * 2;
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

/** Seeded LCG in [0, 1). */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Cheap deterministic hash of a number to [0, 1). */
export function hash1(x) {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Piecewise schedule: steps [[name, weight], ...]; returns the index of the step holding u
 * (0..1) and writes the local fraction into out[0]. Precomputed cumulative table.
 */
export function schedule(steps) {
  const total = steps.reduce((a, s) => a + s[1], 0);
  const cum = [];
  let a = 0;
  for (const s of steps) { cum.push(a / total); a += s[1]; }
  cum.push(1);
  const names = steps.map((s) => s[0]);
  return {
    names,
    at(u, out) {
      const x = ((u % 1) + 1) % 1;
      for (let i = 0; i < names.length; i++) {
        if (x < cum[i + 1] || i === names.length - 1) { out[0] = clamp01((x - cum[i]) / Math.max(cum[i + 1] - cum[i], 1e-9)); return i; }
      }
      out[0] = 1; return names.length - 1;
    },
  };
}

/** An InstancedMesh sharing a craft mesh's material and per-frame update (units of the parent's children). */
export function instancedPart(parent, geo, count) {
  const m = new THREE.InstancedMesh(geo, parent.material, Math.max(count, 1));
  m.count = count;
  m.frustumCulled = false;
  m.renderOrder = 3;
  m.onBeforeRender = parent.onBeforeRender;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return m;
}

/** Fill a static InstancedMesh from a list of matrices. */
export function fillInstances(im, mats) {
  for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
  im.count = mats.length;
  im.instanceMatrix.needsUpdate = true;
  return im;
}

/**
 * Lamps that move or flicker: a createLamps mesh whose per-instance arrays are written in
 * place. set(i, x, y, z) moves lamp i; gain(i, g) scales its base colour (0 turns it off).
 */
export class DynLamps {
  constructor(lamps, opts) {
    this.mesh = createLamps(lamps, opts);
    this.n = lamps.length;
    const g = this.mesh.geometry;
    this.L = g.attributes.iLamp;
    this.C = g.attributes.iCol;
    this.L.setUsage(THREE.DynamicDrawUsage);
    this.C.setUsage(THREE.DynamicDrawUsage);
    this.base = Float32Array.from(this.C.array);
    this._movedP = false; this._movedC = false;
  }
  set(i, x, y, z) { const a = this.L.array; a[i * 4] = x; a[i * 4 + 1] = y; a[i * 4 + 2] = z; this._movedP = true; }
  setV(i, v) { this.set(i, v.x, v.y, v.z); }
  gain(i, g) { const a = this.C.array, b = this.base; a[i * 4] = b[i * 4] * g; a[i * 4 + 1] = b[i * 4 + 1] * g; a[i * 4 + 2] = b[i * 4 + 2] * g; this._movedC = true; }
  commit() {
    if (this._movedP) { this.L.needsUpdate = true; this._movedP = false; }
    if (this._movedC) { this.C.needsUpdate = true; this._movedC = false; }
  }
}

/**
 * Arc-welding brightness at time t for an arc with seed k: bursts of a few seconds separated by
 * pauses (the welder repositions), crackling within a burst. 0..~1.4, deterministic.
 */
export function weldGain(t, k) {
  const period = 7 + 5 * hash1(k * 3.1);
  const u = (t / period + hash1(k * 7.7)) % 1;
  const on = smooth(0.0, 0.02, u) * (1 - smooth(0.52, 0.56, u));
  if (on <= 0) return 0;
  const f = Math.floor(t * 23 + k * 13.7);
  const crackle = 0.55 + 0.45 * hash1(f + k) + 0.35 * hash1(f * 0.5 + k * 2.3);
  return on * crackle;
}

// ------------------------------------------------------------------ parts --
// Small repeated parts, drawn once in metres with the craft builder (facade kinds give them
// windows, bronze trim and lit panels) and instanced where they are used.

/** A cargo capsule lying along +x: length L, radius r, with bronze bands and a dark docking face. */
export function capsuleGeo(L = 880, r = 150, seg = 16, lit = false) {
  const B = new CB();
  B.push(new THREE.Matrix4().makeRotationY(Math.PI / 2));
  const h = L / 2;
  lathe(B, [[0.1, -h, CK.DARK], [r * 0.6, -h + r * 0.05, CK.HULL], [r, -h + r * 0.35, CK.HULL], [r, -h * 0.42, CK.BRONZE], [r * 1.02, -h * 0.36, lit ? CK.LANTERN : CK.DECK],
    [r * 1.02, h * 0.36, CK.BRONZE], [r, h * 0.42, CK.HULL], [r, h - r * 0.35, CK.HULL], [r * 0.6, h - r * 0.05, CK.HULL], [0.1, h, CK.DARK]], seg);
  B.pop();
  return B.geometry();
}

/** A standard container along +x (sx, sy, sz), ribbed, with a bronze door end. */
export function containerGeo(sx = 12, sy = 2.6, sz = 2.6) {
  const B = new CB();
  B.box(0, 0, 0, sx, sy, sz, CK.HULL);
  const ribs = 5;
  for (let i = 0; i <= ribs; i++) B.box(-sx / 2 + (i / ribs) * sx, 0, 0, sx * 0.02, sy * 1.03, sz * 1.03, i === 0 ? CK.BRONZE : CK.DARK);
  return B.geometry();
}

/** A work drone: a pod body with four thruster pods on outriggers and a lit sensor eye (+z forward). */
export function droneGeo(size = 6) {
  const B = new CB();
  const s = size / 6;
  lathe(B, [[0.1, -3 * s, CK.DARK], [1.4 * s, -2.6 * s, CK.HULL], [1.8 * s, -1 * s, CK.HULL], [1.8 * s, 1.2 * s, CK.BRONZE], [1.3 * s, 2.4 * s, CK.GLASS], [0.6 * s, 3 * s, CK.LANTERN], [0.1, 3.1 * s, CK.LANTERN]], 10);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4, x = Math.cos(a) * 3.2 * s, y = Math.sin(a) * 3.2 * s;
    B.tube([V(Math.cos(a) * 1.5 * s, Math.sin(a) * 1.5 * s, 0), V(x, y, 0)], 0.25 * s, 5, CK.DARK);
    B.at(x, y, 0);
    lathe(B, [[0.1, -0.9 * s, CK.DARK], [0.6 * s, -0.7 * s, CK.HULL], [0.6 * s, 0.7 * s, CK.BRONZE], [0.1, 0.9 * s, CK.HULL]], 8);
    B.pop();
  }
  // a manipulator arm folded under the belly
  B.tube([V(0, -1.6 * s, 0.4 * s), V(0, -2.4 * s, 1.6 * s), V(0, -2.2 * s, 2.8 * s)], 0.22 * s, 5, CK.BRONZE);
  return B.geometry();
}

/** A crew pod: a glazed two-seat capsule with a service collar and skids (+z forward). */
export function crewPodGeo(len = 9) {
  const B = new CB();
  const s = len / 9;
  lathe(B, [[0.1, -4.5 * s, CK.DARK], [1.6 * s, -4.2 * s, CK.HULL], [2.2 * s, -2.8 * s, CK.HULL], [2.3 * s, -1.2 * s, CK.BRONZE], [2.3 * s, 0.4 * s, CK.LANTERN],
    [2.1 * s, 2.2 * s, CK.GLASS], [1.4 * s, 3.8 * s, CK.GLASS], [0.1, 4.5 * s, CK.GLASS]], 14);
  for (const x of [-1.9, 1.9]) B.box(x * s, -2.3 * s, 0, 0.3 * s, 0.3 * s, 6 * s, CK.DARK);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; B.box(Math.cos(a) * 2.35 * s, Math.sin(a) * 2.35 * s, -3.4 * s, 0.7 * s, 0.7 * s, 0.9 * s, CK.DARK); }
  return B.geometry();
}

/** A thin cable segment: unit length along +y from 0 to 1 (scale y to the span). */
export function cableGeo(r = 1, seg = 6) {
  const B = new CB();
  B.tube([V(0, 0, 0), V(0, 1, 0)], r, seg, CK.DARK);
  return B.geometry();
}

// scratch for composing instance matrices
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
/** Write into out a matrix at p with basis from forward f and up hint u (orthonormalised), uniform scale s. */
export function poseMatrix(out, p, f, u, s = 1) {
  _z.copy(f).normalize();
  _x.crossVectors(u, _z);
  if (_x.lengthSq() < 1e-10) _x.set(1, 0, 0).cross(_z);
  _x.normalize();
  _y.crossVectors(_z, _x);
  out.makeBasis(_x, _y, _z);
  if (s !== 1) out.scale(_s.setScalar(s));
  return out.setPosition(p);
}
/** A cable instance from a to b (unit cable along +y), in out. */
export function spanMatrix(out, a, b) {
  _y.subVectors(b, a);
  const L = _y.length();
  if (L < 1e-9) return out.makeScale(0, 0, 0).setPosition(a);
  _y.divideScalar(L);
  _q.setFromUnitVectors(_x.set(0, 1, 0), _y);
  return out.compose(a, _q, _s.set(1, L, 1));
}
export { _m as scratchMatrix };
