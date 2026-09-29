import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { LAMP } from './lamps.js';
import { DynLamps, instancedPart, droneGeo, weldGain, rng, smooth, poseMatrix, TAU, V } from './lifeKit.js';

// THE BELT STATIONS AT WORK (metres, the station's frame, drawn with its material): the life
// that gives a station its scale once it fills the view.
//
//   approach lights   a chain of ten lamps down every berth's approach axis, chasing in toward
//                     the collar (the axis is the clear corridor the ships fly)
//   pilot drones      one at each of the first berths: it waits on the apron, runs out along
//                     the axis to meet the next ship, holds, and leads it in
//   patrol drones     inspection drones on inclined circuits just outside the structure, a
//                     strobe each
//   crews             suited people walking the catwalks and decks the builders laid out,
//                     helmet lamps lit, stopping to work at the rails
//   welders           arcs crackling along a slipway's construction front
//
// Built with the station (on approach), animated only while it is resolved. No per-frame
// allocation; the drone and suit meshes are shared by every station.

let _droneGeo = null, _suitGeo = null;
/** A suited figure (1.8 m, +z forward, +y up, feet at 0): white suit, visor, pack, boots. */
export function suitGeo() {
  if (_suitGeo) return _suitGeo;
  const B = new CB();
  B.box(0, 0.45, 0, 0.36, 0.9, 0.26, CK.HULL);            // legs
  B.box(0, 0.06, 0.04, 0.4, 0.12, 0.34, CK.DARK);          // boots
  B.box(0, 1.15, 0, 0.5, 0.6, 0.32, CK.HULL);             // torso
  B.box(0, 1.2, -0.25, 0.44, 0.56, 0.2, CK.BRONZE);        // life-support pack
  for (const s of [-1, 1]) B.box(s * 0.32, 1.08, 0.02, 0.13, 0.56, 0.14, CK.HULL);   // arms
  B.at(0, 1.62, 0);
  lathe(B, [[0.02, -0.16, CK.HULL], [0.15, -0.12, CK.HULL], [0.17, 0.0, CK.GLASS], [0.14, 0.12, CK.HULL], [0.02, 0.17, CK.HULL]], 10);
  B.pop();
  B.box(0, 1.62, 0.15, 0.2, 0.1, 0.04, CK.LANTERN);        // visor light strip
  _suitGeo = B.geometry();
  _suitGeo.userData.shared = true;
  return _suitGeo;
}
function sharedDrone() {
  if (!_droneGeo) { _droneGeo = droneGeo(5); _droneGeo.userData.shared = true; }
  return _droneGeo;
}

const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _m = new THREE.Matrix4();
const UP = V(0, 1, 0);
const CHAIN = 10;
export const PILOT_SIDE = 30;     // m off the berth axis

export class BeltLife {
  /** parent: the station's craft mesh (metres); data: buildBeltStation's record. */
  constructor(parent, data, seed = 1) {
    const t0 = performance.now();
    const r = rng(seed * 977 + 13);
    this.data = data;
    const R = data.radius;
    // ---- approach chains and pilot drones on the berths' axes
    const docks = data.docks.slice(0, 6);
    this.docks = docks.map((d) => {
      const n = d.d.clone().normalize();
      // the pilots keep station beside the axis (a berthed ship lies on it)
      const side = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? V(1, 0, 0) : UP).normalize().multiplyScalar(PILOT_SIDE);
      return { p: d.p.clone(), d: n, side, reach: Math.min(320, R * 1.6 + 40) };
    });
    const lamps = [];
    this.chain0 = 0;
    for (const k of this.docks) {
      for (let i = 0; i < CHAIN; i++) {
        const s = 24 + (i / (CHAIN - 1)) * (k.reach - 24);
        lamps.push({ p: k.p.clone().addScaledVector(k.d, s), r: 1.1, color: i % 3 === 2 ? LAMP.WHITE : LAMP.GREEN, i: 3.2 });
      }
    }
    // ---- drones: pilots at up to three berths, patrols round the outside
    const nPilot = Math.min(3, this.docks.length);
    const nPatrol = 2 + Math.min(4, Math.floor(R / 150));
    this.pilots = [];
    for (let i = 0; i < nPilot; i++) this.pilots.push({ dock: this.docks[i], T: 70 + r() * 40, off: r() });
    this.patrols = [];
    for (let i = 0; i < nPatrol; i++) {
      const tilt = (r() - 0.5) * 1.6, yaw = r() * TAU;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0));
      this.patrols.push({ q, rad: R * (1.12 + 0.2 * r()) + 20, w: (0.012 + 0.012 * r()) * (r() < 0.5 ? -1 : 1), ph: r() * TAU, bob: 4 + r() * 6 });
    }
    this.drone0 = lamps.length;
    for (let i = 0; i < nPilot + nPatrol; i++) lamps.push({ p: V(0, 0, 0), r: 0.9, color: i < nPilot ? LAMP.GREEN : LAMP.WHITE, i: 3.6, breathe: 1, phase: (i * 0.37) % 1 });
    this.drones = instancedPart(parent, sharedDrone(), nPilot + nPatrol);
    parent.add(this.drones);
    // ---- crews on the walks (catwalks and decks recorded by the builder)
    this.walkers = [];
    for (const w of data.walks || []) {
      const n = Math.max(1, Math.min(6, Math.round(w.a.distanceTo(w.b) / 60)));
      for (let i = 0; i < n; i++) this.walkers.push({ w, u0: r(), speed: 1.0 + 0.4 * r(), pause: r() });
    }
    this.walker0 = lamps.length;
    for (let i = 0; i < this.walkers.length; i++) lamps.push({ p: V(0, 0, 0), r: 0.35, color: [1.0, 0.9, 0.72], i: 2.6 });
    this.suits = instancedPart(parent, suitGeo(), this.walkers.length);
    parent.add(this.suits);
    // ---- welders' arcs
    this.welds = (data.welds || []).slice(0, 24);
    this.weld0 = lamps.length;
    for (const p of this.welds) lamps.push({ p: p.clone(), r: 1.6, color: [0.75, 0.9, 1.0], i: 5 });
    this.lamps = new DynLamps(lamps.length ? lamps : [{ p: V(0, 0, 0), r: 0, color: [0, 0, 0], i: 0 }], { minPx: 1.1 });
    parent.add(this.lamps.mesh);
    this.nLamps = lamps.length;
    this.buildMs = performance.now() - t0;
  }

  /** Instanced and lamp counts, for tools. */
  counts() { return { drones: this.drones.count, suits: this.suits.count, lamps: this.nLamps }; }

  /** Pilot drone along its berth's axis at time t: distance out (m) and whether it is lit. */
  pilotAt(pd, t) {
    const u = ((t / pd.T + pd.off) % 1 + 1) % 1;
    // wait on the apron, run out, hold, lead in slowly
    const out = smooth(0.2, 0.45, u) * (1 - smooth(0.6, 0.95, u));
    return 12 + out * (pd.dock.reach - 30);
  }

  update(t) {
    const L = this.lamps;
    // approach chains: a pulse running in toward each collar every 3 s
    let k = 0;
    for (let d = 0; d < this.docks.length; d++) {
      for (let i = 0; i < CHAIN; i++, k++) {
        const ph = ((t / 3 + (CHAIN - i) / CHAIN + d * 0.13) % 1 + 1) % 1;
        L.gain(k, 0.25 + 1.2 * Math.max(0, 1 - ph * 6));
      }
    }
    // pilots
    let j = 0;
    for (const pd of this.pilots) {
      const s = this.pilotAt(pd, t);
      _p.copy(pd.dock.p).addScaledVector(pd.dock.d, s).add(pd.dock.side);
      _f.copy(pd.dock.d).negate();
      _u.copy(Math.abs(pd.dock.d.y) > 0.9 ? V(1, 0, 0) : UP);
      this.drones.setMatrixAt(j, poseMatrix(_m, _p, _f, _u));
      L.set(this.drone0 + j, _p.x, _p.y + 3, _p.z);
      j++;
    }
    // patrols: inclined circuits outside the structure, a slow bob
    for (const pa of this.patrols) {
      const a = pa.ph + pa.w * t;
      _p.set(Math.cos(a) * pa.rad, Math.sin(t * 0.2 + pa.ph) * pa.bob, Math.sin(a) * pa.rad).applyQuaternion(pa.q);
      _f.set(-Math.sin(a) * Math.sign(pa.w), 0, Math.cos(a) * Math.sign(pa.w)).applyQuaternion(pa.q);
      _u.set(0, 1, 0).applyQuaternion(pa.q);
      this.drones.setMatrixAt(j, poseMatrix(_m, _p, _f, _u));
      L.set(this.drone0 + j, _p.x, _p.y + 3, _p.z);
      j++;
    }
    this.drones.instanceMatrix.needsUpdate = true;
    // crews: walk, pause to work, walk on (back and forth along their walk)
    for (let i = 0; i < this.walkers.length; i++) {
      const wk = this.walkers[i], w = wk.w;
      const len = w.a.distanceTo(w.b);
      const per = (2 * len) / wk.speed + 40;
      const u = ((t / per + wk.u0) % 1 + 1) % 1;
      const walkT = (2 * len) / wk.speed / per;
      let s, dir = 1;
      if (u < walkT * 0.5) s = u / (walkT * 0.5);
      else if (u < walkT * 0.5 + 20 / per) s = 1;
      else if (u < walkT + 20 / per) { s = 1 - (u - walkT * 0.5 - 20 / per) / (walkT * 0.5); dir = -1; }
      else { s = 0; dir = -1; }
      _p.copy(w.a).lerp(w.b, s).addScaledVector(w.up, w.lift || 0);
      _f.subVectors(w.b, w.a).multiplyScalar(dir);
      this.suits.setMatrixAt(i, poseMatrix(_m, _p, _f, w.up));
      L.set(this.walker0 + i, _p.x + w.up.x * 1.7, _p.y + w.up.y * 1.7, _p.z + w.up.z * 1.7);
    }
    if (this.walkers.length) this.suits.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.welds.length; i++) L.gain(this.weld0 + i, weldGain(t, i + 1));
    L.commit();
  }

  triangles() {
    return this.drones.count * (sharedDrone().index.count / 3) + this.suits.count * (suitGeo().index.count / 3);
  }
}

// ------------------------------------------------------------ fittings ----
// The near-detail layer: thousands of small fittings scattered over a station's plating (area
// weighted, on hull, livery, worn and ported plate only), each standing on its face's outward
// normal - equipment boxes, access hatches, pipe runs, vent stacks, stub antennas, handrails.
// Instanced (four shared shapes), built the first time the station fills the view, hidden when
// it does not. Kept clear of spinning parts' sweeps, berths and the crews' walks.

let _fitGeos = null;
/** The fitting shapes (+y out of the plate, feet at y = 0, metres). */
export function fittingGeos() {
  if (_fitGeos) return _fitGeos;
  const box = new CB();
  box.box(0, 0.5, 0, 2.4, 1.0, 1.6, 24);                     // equipment box in worn plate
  box.box(0, 1.06, 0, 2.0, 0.12, 1.2, CK.DARK);
  box.box(0.9, 0.5, 0.81, 0.3, 0.6, 0.04, CK.LANTERN);        // status panel
  const hatch = new CB();
  hatch.box(0, 0.08, 0, 1.8, 0.16, 1.8, CK.BRONZE);
  hatch.box(0, 0.2, 0, 1.3, 0.1, 1.3, CK.DARK);
  for (const s of [-1, 1]) hatch.tube([V(s * 1.1, 0.05, -0.5), V(s * 1.1, 0.35, -0.4), V(s * 1.1, 0.35, 0.4), V(s * 1.1, 0.05, 0.5)], 0.035, 4, CK.BRONZE);
  const pipe = new CB();
  pipe.tube([V(0, 0.45, -4), V(0, 0.45, 4)], 0.28, 6, CK.BRONZE);
  for (const z of [-3.2, 0, 3.2]) pipe.box(0, 0.2, z, 0.5, 0.4, 0.3, CK.DARK);
  pipe.tube([V(0.7, 0.35, -4), V(0.7, 0.35, 4)], 0.16, 5, CK.DARK);
  const vent = new CB();
  vent.box(0, 0.9, 0, 0.9, 1.8, 0.9, CK.HULL);
  vent.box(0, 1.9, 0, 1.3, 0.2, 1.3, CK.DARK);
  vent.tube([V(0.3, 1.9, 0.3), V(0.3, 4.2, 0.3)], 0.05, 4, CK.DARK);
  _fitGeos = [box, hatch, pipe, vent].map((b) => { const g = b.geometry(); g.userData.shared = true; return g; });
  return _fitGeos;
}
const FIT_KINDS = new Set([CK.HULL, 20, 21, 24]);   // plate, livery, ported plate, worn plate

/**
 * Scatter fittings over the static plating of a station (data from buildBeltStation) under
 * parent (its craft mesh). Returns { meshes, count, triangles, ms }.
 */
export function buildFittings(parent, data, seed = 1, max = 2600) {
  const t0 = performance.now();
  const r = rng(seed * 4099 + 7);
  const g = data.geo, P = g.attributes.position.array, F = g.attributes.aFacade.array, I = g.index.array;
  // candidate faces and their areas
  const faces = [], areas = [];
  let total = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  for (let i = 0; i < I.length; i += 3) {
    const k = Math.round(F[I[i] * 3 + 2]);
    if (!FIT_KINDS.has(k)) continue;
    a.fromArray(P, I[i] * 3); b.fromArray(P, I[i + 1] * 3); c.fromArray(P, I[i + 2] * 3);
    const ar = n.subVectors(b, a).cross(e.subVectors(c, a)).length() * 0.5;
    if (ar < 2) continue;                                    // too small to carry a fitting
    total += ar; faces.push(i); areas.push(total);
  }
  const spins = data.parts.filter((p) => p.mode === 'spin');
  const walks = data.walks || [];
  const want = Math.min(max, Math.floor(total / 28));
  const mats = [[], [], [], []];
  const p = new THREE.Vector3(), q = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3(), m = new THREE.Matrix4(), inv = new THREE.Quaternion();
  let tries = 0;
  const clear = (pt) => {
    for (const s of spins) {
      q.copy(pt).sub(s.pivot).applyQuaternion(inv.copy(s.q).invert());
      if (Math.hypot(q.x, q.y) > s.hub - 6 && Math.hypot(q.x, q.y) < s.radius + 6 && Math.abs(q.z) < s.halfW + 6) return false;
    }
    for (const d of data.docks) if (pt.distanceToSquared(d.p) < 22 * 22) return false;
    for (const w of walks) {
      const L2 = w.a.distanceToSquared(w.b);
      const u = L2 > 0 ? THREE.MathUtils.clamp(q.subVectors(pt, w.a).dot(e.subVectors(w.b, w.a)) / L2, 0, 1) : 0;
      if (q.copy(w.a).lerp(w.b, u).distanceToSquared(pt) < 16) return false;
    }
    return true;
  };
  while (mats[0].length + mats[1].length + mats[2].length + mats[3].length < want && tries++ < want * 3) {
    // area-weighted face, a uniform point on it
    const x = r() * total;
    let lo = 0, hi = areas.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (areas[mid] < x) lo = mid + 1; else hi = mid; }
    const i = faces[lo];
    a.fromArray(P, I[i] * 3); b.fromArray(P, I[i + 1] * 3); c.fromArray(P, I[i + 2] * 3);
    let u = r(), v = r();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    p.copy(a).addScaledVector(e.subVectors(b, a), u).addScaledVector(q.subVectors(c, a), v);
    up.subVectors(b, a).cross(q.subVectors(c, a)).normalize();
    if (!clear(p)) continue;
    // lie along the face's longer edge, a random quarter turn
    fwd.subVectors(b, a);
    if (r() < 0.5) fwd.subVectors(c, a);
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-8) continue;
    const kind = r() < 0.34 ? 0 : r() < 0.45 ? 1 : r() < 0.6 ? 2 : 3;
    mats[kind].push(poseMatrix(new THREE.Matrix4(), p, fwd, up, 0.7 + r() * 0.8).clone());
    void m;
  }
  const meshes = fittingGeos().map((geo, k) => {
    const im = instancedPart(parent, geo, mats[k].length);
    for (let j = 0; j < mats[k].length; j++) im.setMatrixAt(j, mats[k][j]);
    im.count = mats[k].length;
    im.instanceMatrix.needsUpdate = true;
    parent.add(im);
    return im;
  });
  const count = mats.reduce((s, l) => s + l.length, 0);
  const triangles = meshes.reduce((s, im) => s + im.count * (im.geometry.index.count / 3), 0);
  return { meshes, count, triangles, ms: performance.now() - t0, mats };
}
