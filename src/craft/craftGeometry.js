import * as THREE from 'three';

// MERIDIAN's spacecraft, procedural and in metres (+Z forward, +Y up).
//
// Four craft descended from the asset bundle's ships (Hyperspace Arrival), re-drawn in the
// city's own language: pearl composite hulls, bronze bands, lantern-lit galleries, garden
// decks, soft conduit light. Same roles and component architecture as the originals,
// none of their weapons, and a fraction of their cost: each craft is one merged geometry
// carrying the facade kind per vertex, so it draws in one call with the city's facade
// material (metres) or the space craft material (km).
//
//   skiff    (from the interceptor)      11 m courier: sculpted dart hull, canopy, swept
//                                        wings, twin nacelles, canted fins. No cannons.
//   tender   (from the salvage barge)    reclamation tender: spine, paired cargo pods,
//                                        a three-armed lotus capture cradle (animated),
//                                        engine cluster, solar wings. It gathers dead
//                                        satellites and dust for the rings.
//   liner    (from the capital cruiser)  long-haul liner: a seed-shaped hull (no wedge),
//                                        a ribbed garden atrium along its back, lantern
//                                        galleries, a crown bridge, magnetic scoop ring.
//                                        No gun rigs; comms masts and running lights.
//   refinery (from the cryo refinery)    Selene Works: spindle, habitat wheel, cracking
//                                        columns, tank clusters, heat radiators, vent.

export const CK = { GLASS: 0, HULL: 1, LANTERN: 2, GARDEN: 3, CONDUIT: 4, PANEL: 7, BRONZE: 8, DECK: 9, DARK: 10, RADIATOR: 11, ROOF: 12 };
const TAU = Math.PI * 2;

export class CB {
  constructor() {
    this.pos = []; this.fac = []; this.idx = [];
    this.stack = [new THREE.Matrix4()];
    this._v = new THREE.Vector3();
  }
  get M() { return this.stack[this.stack.length - 1]; }
  push(m) { this.stack.push(this.M.clone().multiply(m)); return this; }
  pop() { this.stack.pop(); return this; }
  at(x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
    return this.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s)));
  }
  v(x, y, z, u, w, k) {
    const p = this._v.set(x, y, z).applyMatrix4(this.M);
    this.pos.push(p.x, p.y, p.z);
    this.fac.push(u, w, k);
    return this.pos.length / 3 - 1;
  }
  /** Triangle, wound so its face points along the (local) hint direction. */
  tri(a, b, c, hint) {
    const P = this.pos;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const h = hint.clone().transformDirection(this.M);
    if (nx * h.x + ny * h.y + nz * h.z >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }

  /**
   * Loft closed rings along z. rings: [{ z, pts: [[x, y], ...], cx, cy }] (equal counts).
   * kindFn(i, j) picks the facade kind per vertex (i around, j along).
   */
  loft(rings, kindFn, { capStart = false, capEnd = false } = {}) {
    const n = rings[0].pts.length;
    const base = this.pos.length / 3;
    const cols = n + 1;
    let along = 0;
    for (let j = 0; j < rings.length; j++) {
      const R = rings[j];
      if (j) along += Math.abs(R.z - rings[j - 1].z);
      let per = 0;
      for (let i = 0; i <= n; i++) {
        const p = R.pts[i % n];
        if (i) { const q = R.pts[i - 1]; per += Math.hypot(p[0] - q[0], p[1] - q[1]); }
        this.v(p[0], p[1], R.z, per, along, typeof kindFn === 'function' ? kindFn(i % n, j) : kindFn);
      }
    }
    const hint = new THREE.Vector3();
    for (let j = 0; j < rings.length - 1; j++) {
      const R = rings[j];
      const cx = R.cx || 0, cy = R.cy || 0;
      for (let i = 0; i < n; i++) {
        const a = base + j * cols + i, b = a + 1, c = a + cols, d = c + 1;
        const p = R.pts[i];
        hint.set(p[0] - cx, p[1] - cy, 0);
        if (hint.lengthSq() < 1e-8) hint.set(0, 1, 0);
        this.tri(a, b, d, hint); this.tri(a, d, c, hint);
      }
    }
    const cap = (R, dir, k) => {
      const c = this.v(R.cx || 0, R.cy || 0, R.z, 0, 0, k);
      const first = this.pos.length / 3;
      for (let i = 0; i < n; i++) this.v(R.pts[i][0], R.pts[i][1], R.z, R.pts[i][0], R.pts[i][1], k);
      for (let i = 0; i < n; i++) this.tri(c, first + i, first + ((i + 1) % n), new THREE.Vector3(0, 0, dir));
    };
    if (capStart) cap(rings[0], -1, typeof capStart === 'number' ? capStart : CK.HULL);
    if (capEnd) cap(rings[rings.length - 1], 1, typeof capEnd === 'number' ? capEnd : CK.HULL);
  }

  /** Surface of revolution about local z. prof: [[r, z, kind], ...]. */
  lathe(prof, seg = 16, phase = 0) {
    const rings = prof.map(([r, z]) => ({ z, pts: sectionEllipse(Math.max(r, 1e-3), Math.max(r, 1e-3), seg, 2, phase) }));
    // per-ring kind; lathe hint is radial, which fails where r shrinks to a point: fine
    this.loft(rings, (i, j) => prof[Math.min(j + 1, prof.length - 1)][2] ?? prof[j][2] ?? CK.HULL);
  }

  box(cx, cy, cz, sx, sy, sz, k = CK.HULL) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const F = [
      [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]],
      [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
      [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
      [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]],
      [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
      [[0, 0, -1], [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]]],
    ];
    for (const [n, q] of F) {
      const ids = q.map(([x, y, z]) => this.v(cx + x, cy + y, cz + z, (n[0] ? z : x) + cz, y + cy, k));
      const h = new THREE.Vector3(...n);
      this.tri(ids[0], ids[1], ids[2], h); this.tri(ids[0], ids[2], ids[3], h);
    }
  }

  /** Tube along points (local frame), radius r (number or fn(t)). */
  tube(pts, r, seg = 8, k = CK.HULL) {
    const N = pts.length;
    const T = [], Nn = [], Bn = [];
    for (let i = 0; i < N; i++) T.push(new THREE.Vector3().subVectors(pts[Math.min(i + 1, N - 1)], pts[Math.max(i - 1, 0)]).normalize());
    let n0 = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    n0 = new THREE.Vector3().crossVectors(T[0], n0).normalize();
    Nn.push(n0); Bn.push(new THREE.Vector3().crossVectors(T[0], n0));
    for (let i = 1; i < N; i++) {
      const ax = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
      const n = Nn[i - 1].clone();
      if (ax.length() > 1e-6) n.applyAxisAngle(ax.normalize(), Math.acos(THREE.MathUtils.clamp(T[i - 1].dot(T[i]), -1, 1)));
      Nn.push(n); Bn.push(new THREE.Vector3().crossVectors(T[i], n));
    }
    const base = this.pos.length / 3;
    let L = 0;
    for (let j = 0; j < N; j++) {
      if (j) L += pts[j].distanceTo(pts[j - 1]);
      const rr = typeof r === 'function' ? r(j / (N - 1)) : r;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        const d = Nn[j].clone().multiplyScalar(Math.cos(a)).addScaledVector(Bn[j], Math.sin(a));
        this.v(pts[j].x + d.x * rr, pts[j].y + d.y * rr, pts[j].z + d.z * rr, a * rr, L, k);
      }
    }
    const cols = seg + 1;
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < seg; i++) {
      const a = base + j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      const h = Nn[j].clone().multiplyScalar(Math.cos(((i + 0.5) / seg) * TAU)).addScaledVector(Bn[j], Math.sin(((i + 0.5) / seg) * TAU));
      this.tri(a, b, d, h); this.tri(a, d, c, h);
    }
  }

  /** Torus in the local XY plane (axis +z). */
  torus(R, r, segR = 48, segT = 10, k = CK.HULL, arc = TAU) {
    const pts = [];
    for (let i = 0; i <= segR; i++) { const a = (i / segR) * arc; pts.push(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0)); }
    this.tube(pts, r, segT, k);
  }

  /** Thin panel (both faces) spanning a local rectangle in the XZ plane at y. */
  panel(x0, x1, z0, z1, y, t, k) { this.box((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, t, z1 - z0, k); }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fac, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Superellipse section, half-widths a (x) and b (y), exponent n; optional flatter belly. */
export function sectionEllipse(a, b, count, n = 2, phase = 0, belly = 1) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * TAU + phase;
    const c = Math.cos(t), s = Math.sin(t);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * a;
    let y = Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * b;
    if (y < 0) y *= belly;
    pts.push([x, y]);
  }
  return pts;
}

/** Lathe about local z with one facade kind per band (prof = [[r, z, kind], ...]; band i..i+1 takes prof[i+1]'s kind). */
function lathe(B, prof, seg = 16, phase = 0) {
  for (let i = 0; i < prof.length - 1; i++) {
    const [r0, z0] = prof[i];
    const [r1, z1, k] = prof[i + 1];
    if (Math.abs(r0 - r1) < 1e-6 && Math.abs(z0 - z1) < 1e-6) continue;
    const e0 = Math.max(r0, 1e-3), e1 = Math.max(r1, 1e-3);
    B.loft([{ z: z0, pts: sectionEllipse(e0, e0, seg, 2, phase) }, { z: z1, pts: sectionEllipse(e1, e1, seg, 2, phase) }], k ?? CK.HULL);
  }
}

const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// ----------------------------------------------------------------- skiff ----
/** 11 m courier. Returns { geo, glows: [{ p, r, dir }], length }. */
export function buildSkiff() {
  const B = new CB();
  const L = 11, zT = -5.2, zN = 5.8;
  const rings = [];
  const K = 28;
  for (let j = 0; j <= 30; j++) {
    const u = j / 30;
    const z = lerp(zT, zN, u);
    // plan and elevation: blunt tail, full mid-body, long tapering nose
    const w = 0.12 + 1.02 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.18)), 0.7) * (1 - 0.72 * ss(0.55, 1.0, u)) + 0.02;
    const h = 0.1 + 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.12)), 0.75) * (1 - 0.6 * ss(0.6, 1.0, u));
    const lift = 0.18 * ss(0.6, 1.0, u);
    rings.push({ z, cy: lift, pts: sectionEllipse(Math.max(w, 0.03), Math.max(h, 0.03), K, 2.5, 0, 0.62).map(([x, y]) => [x, y + lift]) });
  }
  B.loft(rings, (i, j) => (j > 26 ? CK.BRONZE : CK.HULL), { capStart: CK.DARK });
  // canopy: a glassy teardrop over the forward body
  const cr = [];
  for (let j = 0; j <= 14; j++) {
    const u = j / 14;
    const z = lerp(0.2, 3.8, u);
    const w = 0.52 * Math.pow(Math.sin(Math.PI * u), 0.65) + 0.01;
    const h = 0.42 * Math.pow(Math.sin(Math.PI * u), 0.8) + 0.01;
    const base = 0.42 + 0.1 * u;
    cr.push({ z, cy: base, pts: sectionEllipse(w, h, 16, 2, 0).map(([x, y]) => [x, base + Math.max(y, -0.02)]) });
  }
  B.loft(cr, CK.LANTERN);
  // swept wings: thin lofted airfoils from root to tip, bronze leading edge
  for (const s of [-1, 1]) {
    const wr = [];
    for (let j = 0; j <= 8; j++) {
      const u = j / 8;
      const x = s * lerp(0.7, 4.2, u);
      const chord = lerp(4.4, 1.1, u), sweep = lerp(0, 2.3, u);
      const zc = -0.9 - sweep, th = lerp(0.2, 0.05, u);
      const pts = [];
      for (let i = 0; i < 12; i++) {
        const t = (i / 12) * TAU;
        pts.push([zc + Math.cos(t) * chord * 0.5, Math.sin(t) * th * (Math.cos(t) > 0 ? 1 : 0.7) - 0.1 + 0.25 * u * u]);
      }
      wr.push({ z: x, pts, cx: zc, cy: -0.1 });
    }
    // loft runs along local z: rotate so that the ring plane is the (z, y) section
    B.push(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)));
    B.loft(wr, (i) => (i === 0 ? CK.BRONZE : CK.HULL), { capEnd: CK.LANTERN });
    B.pop();
    // nacelle at the wing root
    B.at(s * 1.45, -0.18, -2.3);
    B.lathe([[0.02, -2.6, CK.CONDUIT], [0.42, -2.55, CK.CONDUIT], [0.46, -2.3, CK.DARK], [0.5, -1.6, CK.HULL], [0.46, 0.6, CK.HULL], [0.28, 1.6, CK.HULL], [0.02, 1.9, CK.HULL]], 14);
    B.pop();
    // canted tail fin
    B.at(s * 0.7, 0.35, -4.2, 0, 0, s * -0.42);
    B.box(0, 0.8, 0, 0.07, 1.6, 1.4, CK.HULL);
    B.box(0, 1.62, 0.2, 0.08, 0.06, 1.1, CK.BRONZE);
    B.pop();
  }
  return { geo: B.geometry(), glows: [-1, 1].map((s) => ({ p: new THREE.Vector3(s * 1.45, -0.18, -4.95), r: 0.55, dir: new THREE.Vector3(0, 0, -1) })), length: L };
}

// ---------------------------------------------------------------- tender ----
/**
 * Reclamation tender. Returns { geo, arms: [{ geo, pivot, axis }], glows, length }.
 * The capture cradle's three arms are separate geometries so they can open and close.
 */
export function buildTender(len = 300) {
  const s = len / 300;
  const B = new CB();
  B.push(new THREE.Matrix4().makeScale(s, s, s));
  // spine: rounded beam, slightly deeper aft
  const sp = [];
  for (let j = 0; j <= 24; j++) {
    const u = j / 24;
    const z = lerp(-140, 118, u);
    const w = 9 + 4 * (1 - u) + 3 * ss(0.85, 1, u);
    const h = 8 + 5 * (1 - u);
    sp.push({ z, pts: sectionEllipse(w, h, 20, 3.2) });
  }
  B.loft(sp, (i, j) => (j % 6 === 0 ? CK.BRONZE : CK.HULL), { capStart: CK.DARK, capEnd: CK.HULL });
  // paired cargo pods of reclaimed stock, clamped either side of the spine
  for (let k = 0; k < 4; k++) {
    const zc = -70 + k * 42;
    for (const sd of [-1, 1]) {
      B.at(sd * 25, -2, zc);
      const pr = [];
      for (let j = 0; j <= 8; j++) {
        const u = j / 8;
        const r = 11 * Math.pow(Math.sin(Math.PI * lerp(0.08, 0.92, u)), 0.35);
        pr.push({ z: lerp(-17, 17, u), pts: sectionEllipse(r, r * 0.92, 6, 2.2, Math.PI / 6) });
      }
      B.loft(pr, (i, j) => (j === 4 ? CK.LANTERN : j === 1 || j === 7 ? CK.BRONZE : CK.HULL));
      B.pop();
      B.box(sd * 13, -2, zc, 6, 3, 8, CK.DARK);                    // clamp
    }
  }
  // command pod: a lens on the back, with a band of windows
  B.at(0, 15, -92);
  B.lathe([[0.1, -9, CK.HULL], [9, -7, CK.HULL], [12, -3, CK.GLASS], [12, 1, CK.GLASS], [9, 5, CK.HULL], [0.1, 7, CK.HULL]], 24);
  B.pop();
  B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  B.at(0, 92, 12);
  B.lathe([[1.2, 0, CK.DARK], [0.5, 22, CK.DARK], [0.9, 23, CK.LANTERN], [0.05, 24, CK.LANTERN]], 8);   // mast
  B.pop();
  B.pop();
  // engine cluster: five bells in a ring
  const glows = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + Math.PI / 2;
    const x = Math.cos(a) * 9, y = Math.sin(a) * 8;
    B.at(x, y, -140);
    B.lathe([[3.4, -16, CK.CONDUIT], [4.4, -15, CK.DARK], [3.2, -10, CK.DARK], [2.2, -4, CK.BRONZE], [3.0, 0, CK.HULL]], 14);
    B.pop();
    glows.push({ p: new THREE.Vector3(x, y, -156).multiplyScalar(s), r: 5 * s, dir: new THREE.Vector3(0, 0, -1) });
  }
  // solar wings on short booms
  for (const sd of [-1, 1]) {
    B.box(sd * 40, 13, -30, 50, 1.2, 1.6, CK.DARK);
    B.panel(sd * 20 + (sd > 0 ? 44 : -104), sd * 20 + (sd > 0 ? 104 : -44), -52, -8, 13, 0.5, CK.PANEL);
  }
  // capture collar at the bow with a glowing field ring
  B.at(0, 0, 124);
  B.torus(15, 2.4, 40, 10, CK.HULL);
  B.torus(12.5, 0.9, 40, 6, CK.CONDUIT);
  B.pop();
  B.pop();
  // the three arms: shoulder, forearm, lotus petal (pivot at the collar)
  const arms = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2;
    const A = new CB();
    A.push(new THREE.Matrix4().makeScale(s, s, s));
    const r0 = 15;
    const P = (r, z) => new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z);
    A.tube([P(r0, 124), P(r0 + 6, 142), P(r0 + 4, 162)], (t) => 2.2 - 0.8 * t, 10, CK.HULL);
    A.tube([P(r0 + 4, 162), P(r0 - 2, 184), P(r0 - 8, 196)], (t) => 1.5 - 0.6 * t, 10, CK.BRONZE);
    // petal: a curved leaf plate, lantern-lined
    const petal = [];
    for (let j = 0; j <= 8; j++) {
      const u = j / 8;
      const w = 7 * Math.pow(Math.sin(Math.PI * u), 0.8) + 0.2;
      const c = P(r0 - 8 - 10 * u, 196 + 12 * u);
      const tan = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
      petal.push([c.clone().addScaledVector(tan, -w), c.clone().addScaledVector(tan, w)]);
    }
    for (let j = 0; j <= 8; j++) {
      const [l, rr] = petal[j];
      A.tube([l, rr], 0.9, 6, j === 8 || j === 0 ? CK.LANTERN : CK.HULL);
    }
    A.tube(petal.map((q) => q[0]), 0.6, 6, CK.LANTERN);
    A.tube(petal.map((q) => q[1]), 0.6, 6, CK.LANTERN);
    A.pop();
    arms.push({ geo: A.geometry(), pivot: new THREE.Vector3(Math.cos(a) * r0, Math.sin(a) * r0, 124).multiplyScalar(s), axis: new THREE.Vector3(-Math.sin(a), Math.cos(a), 0) });
  }
  return { geo: B.geometry(), arms, glows, length: len };
}

// ----------------------------------------------------------------- liner ----
/** Long-haul liner. Returns { geo, glows, length }. */
export function buildLiner(len = 2400) {
  const s = len / 2400;
  const B = new CB();
  B.push(new THREE.Matrix4().makeScale(s, s, s));
  const A = 170, Bh = 118;
  // seed / spindle: a blunt stern for the engines, fullest at 40 %, a long taper to the prow
  const prof = (u) => (u < 0.4 ? 0.62 + 0.38 * Math.sin((Math.PI / 2) * (u / 0.4)) : Math.pow(Math.max(Math.cos((Math.PI / 2) * ((u - 0.4) / 0.6)), 0), 0.8));
  const rings = [];
  const NR = 64;
  for (let j = 0; j <= 60; j++) {
    const u = j / 60;
    const z = lerp(-1150, 1250, u);
    const f = Math.max(prof(u), 0.02);
    rings.push({ z, pts: sectionEllipse(A * f, Bh * f, NR, 2.3, 0, 0.8) });
  }
  // kinds: window bands along the flanks, bronze girdles, lantern galleries amidships
  B.loft(rings, (i, j) => {
    const t = i / NR;                       // 0 = starboard, 0.25 = top, 0.75 = keel
    const side = Math.abs(Math.cos(t * TAU));
    if (j % 10 === 0 && j > 0) return CK.BRONZE;
    if (j > 18 && j < 44 && side > 0.9 && Math.abs(Math.sin(t * TAU)) < 0.22) return CK.LANTERN;
    if (side > 0.55 && side < 0.8) return CK.GLASS;
    return CK.HULL;
  }, { capStart: CK.DARK });
  // garden atrium: a planted deck along the back under a colonnade of ribs
  const zA0 = -600, zA1 = 700;
  for (let z = zA0; z <= zA1; z += 26) {
    const u = (z + 1150) / 2400;
    const f = prof(u);
    const top = Bh * f;
    const w = A * f * 0.42;
    const arc = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      arc.push(new THREE.Vector3(Math.cos(a) * w, top - 6 + Math.sin(a) * w * 0.62, z));
    }
    B.tube(arc, 2.6, 6, CK.HULL);
  }
  {
    const deck = [];
    for (let j = 0; j <= 26; j++) {
      const z = lerp(zA0, zA1, j / 26);
      const f = prof((z + 1150) / 2400);
      const w = A * f * 0.4, top = Bh * f - 5;
      deck.push({ z, cy: top - 4, pts: [[-w, top], [w, top], [w, top - 8], [-w, top - 8]] });
    }
    B.loft(deck, (i) => (i === 0 ? CK.GARDEN : CK.HULL));
  }
  // crown bridge astern of the atrium
  {
    const u = (-760 + 1150) / 2400, top = Bh * prof(u);
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    B.at(0, 760, top - 10);
    B.lathe([[46, 0, CK.HULL], [40, 30, CK.GLASS], [36, 80, CK.GLASS], [52, 96, CK.BRONZE], [48, 110, CK.LANTERN], [30, 126, CK.HULL], [4, 170, CK.HULL], [1, 230, CK.LANTERN]], 28);
    B.pop(); B.pop();
  }
  // comms masts where the old gun rigs sat
  for (const [x, z] of [[-60, 200], [60, 200], [-50, -300], [50, -300]]) {
    const u = (z + 1150) / 2400;
    const top = Bh * prof(u) * Math.sqrt(Math.max(0, 1 - Math.pow(x / (A * prof(u)), 2)));
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    B.at(x, -z, top - 4);
    B.lathe([[5, 0, CK.DARK], [1.6, 60, CK.DARK], [3, 62, CK.LANTERN], [0.3, 66, CK.LANTERN]], 8);
    B.pop(); B.pop();
  }
  // magnetic scoop ring ahead of the prow, on three struts
  B.at(0, 0, 1420);
  B.torus(150, 9, 72, 12, CK.HULL);
  B.torus(138, 3.5, 72, 8, CK.CONDUIT);
  B.pop();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2;
    B.tube([new THREE.Vector3(Math.cos(a) * 30, Math.sin(a) * 22, 1080), new THREE.Vector3(Math.cos(a) * 90, Math.sin(a) * 90, 1300), new THREE.Vector3(Math.cos(a) * 150, Math.sin(a) * 150, 1420)], (t) => 7 - 3 * t, 8, CK.HULL);
  }
  // engines: three great bells and a ring of six smaller ones
  const glows = [];
  const bell = (x, y, r, glowR) => {
    B.at(x, y, -1150);
    B.lathe([[r * 0.82, -r * 1.6, CK.CONDUIT], [r, -r * 1.55, CK.DARK], [r * 0.7, -r * 0.9, CK.DARK], [r * 0.45, -r * 0.2, CK.BRONZE], [r * 0.6, 0, CK.HULL]], 24);
    B.pop();
    glows.push({ p: new THREE.Vector3(x, y, -1150 - r * 1.6).multiplyScalar(s), r: glowR * s, dir: new THREE.Vector3(0, 0, -1) });
  };
  for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + Math.PI / 2; bell(Math.cos(a) * 58, Math.sin(a) * 44, 42, 70); }
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + Math.PI / 6; bell(Math.cos(a) * 88, Math.sin(a) * 58, 16, 28); }
  // radiator fins in an X round the engine section: the drive's waste heat, shed edge-on
  const lamps = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    const c = Math.cos(a), sn = Math.sin(a);
    const f0 = prof((-1060 + 1150) / 2400);
    const r0 = Math.hypot(A * f0 * c, Bh * f0 * sn) * 0.92;
    B.push(new THREE.Matrix4().makeRotationZ(a));
    B.tube([new THREE.Vector3(r0 - 20, 0, -1000), new THREE.Vector3(r0 + 60, 0, -980)], 9, 8, CK.BRONZE);
    B.box(r0 + 170, 0, -840, 300, 5, 420, CK.RADIATOR);
    B.box(r0 + 170, 0, -1052, 304, 9, 8, CK.BRONZE);
    B.box(r0 + 170, 0, -628, 304, 9, 8, CK.BRONZE);
    B.box(r0 + 322, 0, -840, 6, 10, 428, CK.BRONZE);
    B.pop();
    lamps.push({ p: new THREE.Vector3(c * (r0 + 326), sn * (r0 + 326), -840).multiplyScalar(s), r: 3.2 * s, color: c > 0 ? [1.0, 0.16, 0.08] : [0.16, 1.0, 0.42], i: 3.4, dir: new THREE.Vector3(c, sn, 0) });
  }
  // docking collars along the keel for tenders and port shuttles
  for (const z of [-420, -170, 80, 330, 580]) {
    const f = prof((z + 1150) / 2400);
    const y = -Bh * f * 0.8 + 4;
    B.push(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    B.at(0, z, -y);
    lathe(B, [[16, -2, CK.BRONZE], [19, 4, CK.BRONZE], [19, 10, CK.BRONZE], [15, 13, CK.DARK], [12, 14, CK.DARK], [0.1, 14, CK.DARK]], 16);
    B.pop(); B.pop();
    lamps.push({ p: new THREE.Vector3(21, y - 12, z).multiplyScalar(s), r: 2.2 * s, color: [1.0, 0.6, 0.22], i: 2.6, breathe: 0.3, phase: (z + 500) / 1200 });
    lamps.push({ p: new THREE.Vector3(-21, y - 12, z).multiplyScalar(s), r: 2.2 * s, color: [1.0, 0.6, 0.22], i: 2.6, breathe: 0.3, phase: (z + 520) / 1200 });
  }
  // masthead, stern light, and a ring of teal lamps round the scoop
  {
    const u = (-760 + 1150) / 2400, top = Bh * prof(u);
    lamps.push({ p: new THREE.Vector3(0, top - 10 + 232, -760).multiplyScalar(s), r: 3 * s, color: [1.0, 0.95, 0.86], i: 3.0, breathe: 0.3 });
    lamps.push({ p: new THREE.Vector3(0, 70, -1150).multiplyScalar(s), r: 3 * s, color: [1.0, 0.95, 0.86], i: 2.4, dir: new THREE.Vector3(0, 0, -1) });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      lamps.push({ p: new THREE.Vector3(Math.cos(a) * 160, Math.sin(a) * 160, 1420).multiplyScalar(s), r: 3 * s, color: [0.35, 0.95, 1.0], i: 2.2, breathe: 0.25, phase: k / 8 });
    }
  }
  B.pop();
  return { geo: B.geometry(), glows, lamps, length: len };
}

// -------------------------------------------------------------- refinery ----
/** Selene Works. Local +Y is the spindle axis. Returns { geo, wheel, glows, vent, size }. */
export function buildRefinery(scale = 1) {
  const B = new CB();
  const W = new CB();
  B.push(new THREE.Matrix4().makeScale(scale, scale, scale));
  W.push(new THREE.Matrix4().makeScale(scale, scale, scale));
  const toY = new THREE.Matrix4().makeRotationX(-Math.PI / 2);        // local z -> +y
  // spindle
  B.push(toY);
  B.lathe([[20, -3000, CK.CONDUIT], [160, -2960, CK.BRONZE], [120, -2700, CK.HULL], [110, -800, CK.HULL], [260, -700, CK.GLASS], [260, -500, CK.GLASS],
    [120, -420, CK.HULL], [110, 1900, CK.HULL], [200, 2000, CK.BRONZE], [140, 2300, CK.HULL], [40, 2600, CK.LANTERN], [8, 2800, CK.HULL]], 32);
  B.pop();
  // cracking columns round the lower spindle, joined by rings of pipework
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    const x = Math.cos(a) * 560, z = Math.sin(a) * 560;
    B.push(toY);
    B.at(x, -z, 0);
    B.lathe([[90, -2500, CK.HULL], [110, -2440, CK.BRONZE], [96, -2380, CK.HULL], [96, -1700, CK.GLASS], [120, -1660, CK.LANTERN], [96, -1620, CK.HULL], [96, -1100, CK.GLASS],
      [120, -1060, CK.LANTERN], [96, -1020, CK.HULL], [60, -900, CK.HULL], [10, -860, CK.HULL]], 20);
    B.pop(); B.pop();
    for (const y of [-2200, -1500, -1000]) B.tube([new THREE.Vector3(Math.cos(a) * 130, y, Math.sin(a) * 130), new THREE.Vector3(x, y, z)], 22, 6, CK.DARK);
  }
  for (const y of [-2200, -1000]) {                         // pipe rings round the columns
    B.push(new THREE.Matrix4().makeTranslation(0, y, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    B.torus(560, 26, 72, 8, CK.BRONZE);
    B.pop();
  }
  // tank clusters high on the spindle: pearl and gold spheres
  const sph = (x, y, z, r, k) => {
    const prof = [];
    for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI; prof.push([Math.max(Math.cos(a) * r, 0.5), Math.sin(a) * r, k]); }
    B.push(toY); B.at(x, -z, y); B.lathe(prof, 18); B.pop(); B.pop();
  };
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + 0.2;
    sph(Math.cos(a) * 420, 1200 + (k % 2) * 260, Math.sin(a) * 420, 170 + (k % 3) * 40, k % 3 === 0 ? CK.BRONZE : CK.HULL);
    B.tube([new THREE.Vector3(Math.cos(a) * 110, 1200 + (k % 2) * 260, Math.sin(a) * 110), new THREE.Vector3(Math.cos(a) * 300, 1200 + (k % 2) * 260, Math.sin(a) * 300)], 18, 6, CK.DARK);
  }
  // heat radiators: four great fins below the wheel
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    B.push(new THREE.Matrix4().makeRotationY(-a));
    B.box(700, -350, 0, 1100, 30, 30, CK.DARK);
    B.box(1500, -350, 0, 1700, 620, 16, CK.RADIATOR);
    B.pop();
  }
  // docking ring at the upper end
  B.push(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  B.at(0, 0, -2150);
  B.torus(420, 34, 64, 10, CK.HULL);
  B.torus(400, 10, 64, 6, CK.CONDUIT);
  B.pop(); B.pop();
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; B.tube([new THREE.Vector3(Math.cos(a) * 110, 2150, Math.sin(a) * 110), new THREE.Vector3(Math.cos(a) * 400, 2150, Math.sin(a) * 400)], 16, 6, CK.DARK); }
  // habitat wheel (separate so it can turn): torus, spokes and hub
  W.push(new THREE.Matrix4().makeTranslation(0, -600, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  W.torus(2200, 170, 128, 16, CK.GLASS);
  W.torus(2380, 30, 128, 6, CK.LANTERN);
  W.torus(2020, 22, 128, 6, CK.BRONZE);
  W.pop();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    W.tube([new THREE.Vector3(Math.cos(a) * 280, -600, Math.sin(a) * 280), new THREE.Vector3(Math.cos(a) * 2050, -600, Math.sin(a) * 2050)], (t) => 60 - 20 * Math.sin(Math.PI * t), 10, k % 2 ? CK.HULL : CK.GLASS);
  }
  W.pop();
  B.pop();
  const glows = [{ p: new THREE.Vector3(0, -3010, 0).multiplyScalar(scale), r: 160 * scale, dir: new THREE.Vector3(0, -1, 0) }];
  return { geo: B.geometry(), wheel: W.geometry(), glows, wheelY: -600 * scale, size: 6000 * scale };
}
