import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { LAMP } from './lamps.js';
import { V, smooth, lerp, hash1, instancedPart, DynLamps, poseMatrix } from './lifeKit.js';

// THE EMBARKATION TERRACE AT PEOPLE SCALE (metres, the terrace's frame from interfaces.js:
// +x along the pier, +z away from the liner, deck at y = floor). The terrace's halls and
// gardens are glazed rooms; what moves in the open is drawn here:
//
//   baggage     carts running the two baggage rails of the eastern court, stopping at the
//               sorting bins, each with its handler riding the tail step
//   rim crews   maintenance crews walking the railed rim round the deck edge (the southern
//               rim is split where the lift core's walk crosses it)
//   apron       the courier's ground crew working round its berth, clear of its hull and bots
//
// Every figure walks on the deck and keeps clear of every triangle of the terrace
// (tools/verify-geo.mjs).

export const TL = {
  rails: [441, 473], railZ: [-188, 50], stops: [-170, -135, -100, -35, 20], carts: 3,
  rim: { z: 228.5, x0: -470, x1: 470, gap: 22, crews: 10 },
  apron: { x0: 300, x1: 430, z0: 70, z1: 156, crew: 8 },
};

/** A person, 1.75 m, standing on y = 0, facing +z: boots, legs, coverall, arms, head and helmet lamp. */
export function personGeo(suit = CK.BRONZE) {
  const B = new CB();
  for (const x of [-0.12, 0.12]) { B.box(x, 0.06, 0.04, 0.13, 0.12, 0.28, CK.DARK); B.box(x, 0.47, 0, 0.14, 0.72, 0.16, suit); }
  B.box(0, 1.1, 0, 0.42, 0.62, 0.24, suit);
  B.box(0, 1.28, 0.125, 0.3, 0.1, 0.02, CK.LANTERN);                   // reflective band
  for (const x of [-0.27, 0.27]) B.box(x, 1.05, 0, 0.1, 0.58, 0.12, suit);
  B.at(0, 1.58, 0);
  lathe(B, [[0.01, -0.13, CK.HULL], [0.11, -0.09, CK.HULL], [0.12, 0.02, CK.HULL], [0.1, 0.11, CK.HULL], [0.01, 0.15, CK.HULL]], 8);
  B.pop();
  B.box(0, 1.62, 0.11, 0.08, 0.05, 0.04, CK.LANTERN);                  // helmet lamp
  return B.geometry();
}
/** A baggage cart on a rail (centred on the rail, running along z). */
function cartGeo() {
  const B = new CB();
  B.box(0, 0.55, 0, 2.4, 0.5, 4.6, CK.HULL);
  for (const z of [-1.8, 1.8]) B.box(0, 0.2, z, 1.2, 0.4, 0.6, CK.DARK);
  B.box(0, 1.25, -0.4, 2.0, 0.9, 3.2, CK.BRONZE);                      // luggage
  B.box(0.3, 1.9, -0.8, 1.2, 0.4, 1.6, CK.HULL);
  B.box(0, 0.9, 2.2, 2.2, 0.8, 0.2, CK.LANTERN);                       // lit nose panel
  B.box(0, 0.35, -2.55, 1.6, 0.1, 0.5, CK.DARK);                       // tail step
  return B.geometry();
}

/** Cart k on rail r at time t: z and whether it is stopped at a bin. */
export function cartZ(r, k, t) {
  const S = TL.stops, n = S.length;
  const legT = 26, cyc = 2 * (n - 1) * legT;
  const x = ((t + k * 61 + r * 29) % cyc + cyc) % cyc;
  const leg = Math.floor(x / legT), u = (x - leg * legT) / legT;
  const fwd = leg < n - 1;
  const i0 = fwd ? leg : 2 * (n - 1) - leg, i1 = fwd ? i0 + 1 : i0 - 1;
  return { z: lerp(S[i0], S[i1], smooth(0, 0.55, u)), dir: fwd ? 1 : -1, stopped: u > 0.55 };
}
/** Rim walker k at time t: x, z and heading along x. */
export function rimWalker(k, t, out) {
  const R = TL.rim, side = k % 2 ? 1 : -1;
  // the southern rim (z < 0) is split at the lift walk: walkers there keep to one half
  let x0 = R.x0, x1 = R.x1;
  if (side < 0) { if (k % 4 === 0) x1 = -R.gap; else x0 = R.gap; }
  const L = x1 - x0, speed = 1.1 + 0.3 * hash1(k);
  const T = (2 * L) / speed + 30;
  const u = ((t / T + hash1(k * 3.7)) % 1 + 1) % 1;
  const half = (L / speed) / T;
  let x, dir;
  if (u < half) { x = lerp(x0, x1, u / half); dir = 1; }
  else if (u < half + 15 / T) { x = x1; dir = 1; }
  else if (u < 2 * half + 15 / T) { x = lerp(x1, x0, (u - half - 15 / T) / half); dir = -1; }
  else { x = x0; dir = -1; }
  out.x = x; out.z = side * R.z; out.dir = dir;
  return out;
}
/** Apron crew k: walking the apron's perimeter loop (inside its edges, clear of the courier). */
export function apronWalker(k, t, out) {
  const A = TL.apron, w = A.x1 - A.x0, d = A.z1 - A.z0, per = 2 * (w + d);
  const s = ((t * 0.9 + (k / A.crew) * per) % per + per) % per;
  if (s < w) { out.x = A.x0 + s; out.z = A.z0; out.fx = 1; out.fz = 0; }
  else if (s < w + d) { out.x = A.x1; out.z = A.z0 + s - w; out.fx = 0; out.fz = 1; }
  else if (s < 2 * w + d) { out.x = A.x1 - (s - w - d); out.z = A.z1; out.fx = -1; out.fz = 0; }
  else { out.x = A.x0; out.z = A.z1 - (s - 2 * w - d); out.fx = 0; out.fz = -1; }
  return out;
}

export class TerraceLife {
  constructor(terraceMesh, terraceData) {
    this.floor = terraceData.floor;
    this.root = new THREE.Group();
    terraceMesh.add(this.root);
    const nCarts = TL.rails.length * TL.carts;
    this.carts = instancedPart(terraceMesh, cartGeo(), nCarts);
    this.handlers = instancedPart(terraceMesh, personGeo(CK.LANTERN), nCarts);
    this.crew = instancedPart(terraceMesh, personGeo(CK.BRONZE), TL.rim.crews + TL.apron.crew);
    this.root.add(this.carts, this.handlers, this.crew);
    const dl = [];
    for (let i = 0; i < nCarts; i++) dl.push({ p: V(), r: 0.5, color: LAMP.AMBER, i: 1.6, breathe: 0.6, phase: i / nCarts });
    this.dyn = new DynLamps(dl, { minPx: 0.8 });
    this.root.add(this.dyn.mesh);
    this.root.traverse((o) => { o.frustumCulled = false; });
    this._m = new THREE.Matrix4(); this._p = V(); this._f = V(); this._up = V(0, 1, 0); this._w = {};
    this.update(0, true);
  }

  update(t, on) {
    this.root.visible = on;
    if (!on) return;
    const m = this._m, p = this._p, f = this._f, y = this.floor, w = this._w;
    let q = 0;
    for (const [ri, x] of TL.rails.entries()) for (let k = 0; k < TL.carts; k++) {
      const c = cartZ(ri, k, t);
      p.set(x, y + 0.62, c.z); f.set(0, 0, c.dir);
      poseMatrix(m, p, f, this._up, 1);
      this.carts.setMatrixAt(q, m);
      p.set(x, y + 0.62 + 0.4, c.z - c.dir * 2.55); poseMatrix(m, p, f, this._up, 1);
      this.handlers.setMatrixAt(q, m);
      this.dyn.set(q, x, y + 2.4, c.z + c.dir * 2.3);
      this.dyn.gain(q, c.stopped ? 0.35 : 1);
      q++;
    }
    q = 0;
    for (let k = 0; k < TL.rim.crews; k++) {
      rimWalker(k, t, w);
      p.set(w.x, y + 0.03 * Math.abs(Math.sin(t * 5 + k)), w.z); f.set(w.dir, 0, 0);
      poseMatrix(m, p, f, this._up, 1);
      this.crew.setMatrixAt(q++, m);
    }
    for (let k = 0; k < TL.apron.crew; k++) {
      apronWalker(k, t, w);
      p.set(w.x, y + 0.4 + 0.03 * Math.abs(Math.sin(t * 5 + k)), w.z); f.set(w.fx, 0, w.fz);
      poseMatrix(m, p, f, this._up, 1);
      this.crew.setMatrixAt(q++, m);
    }
    for (const im of [this.carts, this.handlers, this.crew]) im.instanceMatrix.needsUpdate = true;
    this.dyn.commit();
  }
}
