import * as THREE from 'three';
import { CK, FS, TAU, V3, smooth, lerp, clamp01, rng, loft, finish, stock, tube, rod, box, bbox, revolve, placeY } from './lodestarKit.js';
import { DK } from './craftMesh.js';

// The Lodestar's hull: a lens-section lifting body, 36 m from the nose (z = -20) to the thrust
// frame (z = +16), built as one lofted skin whose plates are separated by real grooves (the skin
// steps in at every seam) and whose landing-gear bays are real recesses with vertical walls.
// Over it: bronze chine strakes, heat-shield tiles on the belly (a brick-laid field of proud
// ceramic tiles that parts round the gear bays), framed window rows with mullions, access
// hatches with hinges and handles, cargo doors on the aft deck, radiator wings with ribs and
// coolant manifolds, canted stern fins, and the name worked in raised letters on both bows.

export const SHIP = { Z0: -20, L: 36 };
export const zOf = (t) => SHIP.Z0 + SHIP.L * t;
export const tOf = (z) => (z - SHIP.Z0) / SHIP.L;
const C = clamp01;

/** Section of the hull at station t: half-width, top and bottom heights, exponents. */
export function sec(t) {
  const w = 5.2 * Math.pow(Math.sin((Math.min(t / 0.6, 1) * Math.PI) / 2), 0.8) * (1 - 0.18 * smooth(0.8, 1, t));
  const hump = 0.8 * Math.exp(-(((t - 0.29) / 0.12) ** 2));
  const ht = 1.9 * Math.pow(Math.sin((Math.min(t / 0.45, 1) * Math.PI) / 2), 0.75) * (1 - 0.25 * smooth(0.75, 1, t)) + hump * smooth(0.05, 0.2, t);
  const hb = 1.5 * Math.pow(Math.sin((Math.min(t / 0.4, 1) * Math.PI) / 2), 0.75) * (1 - 0.15 * smooth(0.75, 1, t));
  return { w, ht, hb, nx: 3.0, ny: 1.35 };
}
const sgnPow = (c, e) => Math.sign(c) * Math.pow(Math.abs(c), e);

/** Point on the hull at station t and section angle a (0 = starboard chine, pi/2 = top). */
export function hullPt(t, a, off = 0) {
  const S = sec(C(t)), c = Math.cos(a), s = Math.sin(a);
  const p = V3(S.w * sgnPow(c, 2 / S.nx), (s > 0 ? S.ht : S.hb) * sgnPow(s, 2 / S.ny), zOf(C(t)));
  if (off) {
    const e = 1e-3, c2 = Math.cos(a + e), s2 = Math.sin(a + e);
    const q = V3(S.w * sgnPow(c2, 2 / S.nx), (s2 > 0 ? S.ht : S.hb) * sgnPow(s2, 2 / S.ny), 0);
    const tx = q.x - p.x, ty = q.y - p.y, L = Math.hypot(tx, ty) || 1;
    p.x += (ty / L) * off; p.y += (-tx / L) * off;
  }
  return p;
}
/** Surface frame at (t, a): point, outward normal, unit tangents along the ship and round it. */
export function hullFrame(t, a, off = 0) {
  const p = hullPt(t, a, off);
  const tz = hullPt(t + 1e-3, a, off).sub(hullPt(t - 1e-3, a, off)).normalize();
  const ta = hullPt(t, a + 1e-3, off).sub(hullPt(t, a - 1e-3, off)).normalize();
  const n = new THREE.Vector3().crossVectors(ta, tz).normalize();
  if (n.dot(V3(p.x, p.y, 0)) < 0) n.negate();
  return { p, n, tz, ta };
}
/** Section angle (in [pi/2, 5pi/2)) where the hull passes x at station t, upper or lower side. */
export function aOfX(t, x, upper) {
  const S = sec(C(t)), c = Math.sign(x) * Math.pow(Math.min(Math.abs(x) / S.w, 0.9999), S.nx / 2);
  const a = Math.acos(c);
  return upper ? (a < Math.PI / 2 ? a + TAU : a) : TAU - a;
}

// ---------------------------------------------------------- seams and bays --
// Regions of the skin that step in: seams (narrow, full length or full girth) and the gear bays.
const SEAM_T = [0.085, 0.16, 0.235, 0.31, 0.385, 0.46, 0.535, 0.61, 0.685, 0.76, 0.835, 0.905];
const SEAM_A = [Math.PI / 2 + 0.34, Math.PI / 2 - 0.34 + TAU, Math.PI / 2 + 0.82, Math.PI / 2 - 0.82 + TAU, 0.3 + TAU, Math.PI - 0.3, 0.1 + TAU, Math.PI - 0.1, Math.PI + 0.12, TAU - 0.12];
const SEAM_DT = 0.013 / SHIP.L, SEAM_DA = 0.0035, SEAM_D = 0.028;

/** The landing gear bays: t and section-angle ranges (bays in the belly, recessed BAY_D). */
export const BAY_D = 0.95;
function bayRange(zc, len, xc, halfW) {
  const t0 = tOf(zc - len / 2), t1 = tOf(zc + len / 2), tm = tOf(zc);
  const aA = aOfX(tm, xc - halfW, false), aB = aOfX(tm, xc + halfW, false);
  return { t0, t1, a0: Math.min(aA, aB), a1: Math.max(aA, aB), zc, len, xc, halfW };
}
export const BAYS = [bayRange(-7.9, 7.4, 0, 0.72), bayRange(9.3, 7.6, 3.0, 0.74), bayRange(9.3, 7.6, -3.0, 0.74)];

function regions() {
  const R = [];
  for (const t of SEAM_T) R.push({ t0: t - SEAM_DT, t1: t + SEAM_DT, a0: -1, a1: 99, d: SEAM_D, k: CK.DARK });
  for (const a of SEAM_A) R.push({ t0: 0.05, t1: 0.985, a0: a - SEAM_DA, a1: a + SEAM_DA, d: SEAM_D, k: CK.DARK });
  for (const b of BAYS) R.push({ t0: b.t0, t1: b.t1, a0: b.a0, a1: b.a1, d: BAY_D, k: CK.DARK, bay: true });
  return R;
}

/** Sample list over [lo, hi): base samples plus a doubled sample at every region boundary. */
function samples(base, bounds) {
  const out = base.map((v) => ({ v, e: 0 }));
  for (const [b0, b1] of bounds) { out.push({ v: b0, e: -1 }, { v: b0, e: 1 }, { v: b1, e: -1 }, { v: b1, e: 1 }); }
  out.sort((p, q) => p.v - q.v || p.e - q.e);
  // drop base samples crowding a boundary
  return out.filter((s, i) => s.e !== 0 || !out.some((o, j) => j !== i && o.e !== 0 && Math.abs(o.v - s.v) < 2.5e-4));
}

/** The skin: returns the geometry. */
function skin() {
  const R = regions();
  const tb = []; for (let k = 0; k <= 190; k++) tb.push(0.5 - 0.5 * Math.cos((Math.PI * k) / 190));
  const ts = samples(tb, R.filter((r) => r.t0 > 0).map((r) => [r.t0, r.t1]));
  const ab = []; const NA = 264; for (let i = 0; i < NA; i++) ab.push(Math.PI / 2 + (i / NA) * TAU);
  const as = samples(ab, R.filter((r) => r.a0 >= 0 && r.a1 < 50).map((r) => [r.a0, r.a1]));
  const inR = (s, lo, hi) => s.v + s.e * 1e-7 > lo && s.v + s.e * 1e-7 < hi;
  const rings = [], kinds = [];
  for (const st of ts) {
    const t = st.v, ring = [], kr = [];
    for (const sa of as) {
      let d = 0, k = CK.HULL;
      for (const r of R) if (r.d > d && inR(st, r.t0, r.t1) && (r.a0 < 0 || inR(sa, r.a0, r.a1))) { d = r.d; k = r.k; }
      if (t < 1e-4) ring.push(V3(0, 0, SHIP.Z0)); else ring.push(hullPt(t, sa.v, -d));
      kr.push(k);
    }
    rings.push(ring); kinds.push(kr);
  }
  return loft(rings, (j, i) => kinds[j][i], { capEnd: true, capKind: CK.DARK, fs: 1 });
}

// ---------------------------------------------------------------- helpers --
/** A shell strip on the hull over t0..t1 and angles a0..a1 (proud by o, sunk by i). */
export function hullStrip(t0, t1, a0, a1, k, { o = 0.06, i = 0.12, nt = 8, na = 8 } = {}) {
  const rings = [];
  for (let j = 0; j <= nt; j++) {
    const t = lerp(t0, t1, j / nt), out = [], inn = [];
    for (let q = 0; q <= na; q++) { const a = lerp(a0, a1, q / na); out.push(hullPt(t, a, o)); inn.push(hullPt(t, a, -i)); }
    rings.push([...out, ...inn.reverse()]);
  }
  return loft(rings, k, { capStart: true, capEnd: true });
}
/** A patch of the hull at (t, a) sized w (along) x h (round) metres, proud o (converted to t/a). */
function patchTA(t, a, w, h) {
  const f = hullFrame(t, a), dt = w / 2 / SHIP.L / Math.max(f.tz.z, 0.2);
  const da = (h / 2) / Math.max(hullPt(t, a + 0.01).distanceTo(hullPt(t, a - 0.01)) / 0.02, 0.05);
  return { t0: t - dt, t1: t + dt, a0: a - da, a1: a + da };
}
/** A box sitting on the hull at (t, a), its local Y along the surface normal and Z along the ship. */
export function onHull(g, t, a, lift = 0, spin = 0) {
  const f = hullFrame(t, a);
  const x = new THREE.Vector3().crossVectors(f.n, f.tz).normalize(), z = new THREE.Vector3().crossVectors(x, f.n).normalize();
  const m = new THREE.Matrix4().makeBasis(x, f.n, z);
  if (spin) m.multiply(new THREE.Matrix4().makeRotationY(spin));
  m.setPosition(f.p.clone().addScaledVector(f.n, lift));
  return g.applyMatrix4(m);
}

// -------------------------------------------------------------- the tiles --
/** Heat-shield tiles over the belly: proud ceramic tiles with gaps, brick-laid, clear of the bays. */
function tiles() {
  const pos = [], fac = [], idx = [], R = rng(7);
  const gap = 0.018, T = 0.5;
  const aLo = Math.PI + 0.2, aHi = TAU - 0.2;
  const push = (quad, lift, k, fu) => {
    // quad: 4 surface points (base), lift along their normals -> a box without a floor
    const top = quad.map((q) => q.p.clone().addScaledVector(q.n, lift));
    const base = pos.length / 3;
    const faces = [[top[0], top[1], top[2], top[3]]];
    for (let e = 0; e < 4; e++) { const a = quad[e].p, b = quad[(e + 1) % 4].p; faces.push([a, b, top[(e + 1) % 4], top[e]]); }
    let vi = base;
    for (const f of faces) {
      for (const p of f) { pos.push(p.x, p.y, p.z); }
      fac.push(fu, 1.5, k, fu + 0.8, 1.5, k, fu + 0.8, 2.3, k, fu, 2.3, k);
      idx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);            // wound to face out of the belly
      vi += 4;
    }
  };
  let row = 0;
  for (let z = zOf(0.035); z < zOf(0.975) - T; z += T, row++) {
    const t0 = tOf(z + gap / 2), t1 = tOf(z + T - gap / 2), tm = (t0 + t1) / 2;
    // arc-length table round the belly at this row
    const N = 240, arc = [0];
    let prev = hullPt(tm, aLo);
    for (let i = 1; i <= N; i++) { const p = hullPt(tm, lerp(aLo, aHi, i / N)); arc.push(arc[i - 1] + p.distanceTo(prev)); prev = p; }
    const L = arc[N];
    const aAt = (s) => { let i = 1; while (i < N && arc[i] < s) i++; const f = (s - arc[i - 1]) / Math.max(arc[i] - arc[i - 1], 1e-9); return lerp(aLo, aHi, (i - 1 + f) / N); };
    const off = (row % 2) * T * 0.5;
    const nose = z < zOf(0.12);
    for (let s = -off; s < L; s += T) {
      const s0 = Math.max(s + gap / 2, 0), s1 = Math.min(s + T - gap / 2, L);
      if (s1 - s0 < 0.12) continue;
      const a0 = aAt(s0), a1 = aAt(s1), am = (a0 + a1) / 2;
      let skip = false;
      for (const b of BAYS) if (tm > b.t0 - 0.004 && tm < b.t1 + 0.004 && am > b.a0 - 0.02 && am < b.a1 + 0.02) skip = true;
      if (skip) continue;
      const q = [[t0, a0], [t1, a0], [t1, a1], [t0, a1]].map(([t, a]) => ({ p: hullPt(t, a), n: hullFrame(t, a).n }));
      const lift = 0.035 + 0.008 * R() + (nose ? 0.01 : 0);
      push(q, lift, CK.DARK, 1.5 + (R() < 0.5 ? 0 : 0.1));
    }
  }
  return finish(pos, fac, idx, { noOrient: true, noWeld: true });
}

// ------------------------------------------------------------ lettering --
// 5 x 7 pixel glyphs for the name and the registration
const GLYPH = {
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
/** Raised letters along the hull, reading left to right as seen from outside on either side. */
function lettering(text, z0, aMid, px, side, k, rowShift = 0) {
  const dirZ = side > 0 ? -1 : 1;                                   // reading left to right from outside
  const out = [];
  let col = 0;
  for (const ch of text) {
    const g = GLYPH[ch] || GLYPH[' '];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (g[r][c] !== '1') continue;
      // starboard reads nose -> tail along +z; port reads tail -> nose (mirror so both read left to right)
      const along = (col + c) * px * dirZ;
      const z = z0 + along, t = tOf(z);
      const ds = (3 - r) * px + rowShift;                               // row 0 on top
      const f0 = hullFrame(t, aMid);
      const a = aMid + (side > 0 ? 1 : -1) * ds / Math.max(hullPt(t, aMid + 0.01).distanceTo(hullPt(t, aMid - 0.01)) / 0.02, 0.05);
      out.push(onHull(box(px * 0.92, 0.03, px * 0.92, k), t, a, 0.012));
      void f0;
    }
    col += 6;
  }
  return out;
}

// ---------------------------------------------------------------- build --
/**
 * Build the hull. Returns { base: [geo], detail: [geo] (close-up only), navTips, rcs spots }.
 */
export function buildHull() {
  const base = [], detail = [];
  base.push(skin());

  // ---- chines: a bronze strake (a thin blade out of the chine) and a rubbing tube along it
  for (const a of [0, Math.PI]) {
    const rings = [];
    for (let t = 0.07; t <= 0.975; t += 0.01) {
      const p = hullPt(t, a), sx = a === 0 ? 1 : -1, wEdge = 0.2 * smooth(0.07, 0.16, t) * (1 - smooth(0.93, 0.975, t)) + 0.02;
      rings.push([V3(p.x - sx * 0.1, p.y + 0.035, p.z), V3(p.x + sx * wEdge, p.y + 0.012, p.z), V3(p.x + sx * wEdge, p.y - 0.012, p.z), V3(p.x - sx * 0.1, p.y - 0.035, p.z)]);
    }
    base.push(loft(rings, CK.BRONZE, { capStart: true, capEnd: true }));
    const pts = []; for (let t = 0.1; t <= 0.95; t += 0.03) pts.push(hullPt(t, a, 0.03).add(V3(0, 0.07, 0)));
    detail.push(tube(pts, 0.035, CK.BRONZE, 6, 2));
  }

  // ---- belly heat shield
  detail.push(tiles());

  // ---- window rows along the forward cabin (both flanks): recessed glass, raised frames, mullions
  for (const side of [1, -1]) {
    const aW = side > 0 ? 0.5 + TAU : Math.PI - 0.5;
    for (let i = 0; i < 8; i++) {
      const t0 = 0.205 + i * 0.026, t1 = t0 + 0.019, da = 0.06, a0 = aW - da, a1 = aW + da;
      base.push(hullStrip(t0, t1, a0, a1, CK.GLASS, { o: -0.015, i: 0.1, nt: 2, na: 3 }));
      const fr = 0.0022, fa = 0.012;
      detail.push(hullStrip(t0 - fr, t0 + fr * 0.3, a0 - fa, a1 + fa, CK.BRONZE, { o: 0.035, i: 0.04, nt: 1, na: 3 }));
      detail.push(hullStrip(t1 - fr * 0.3, t1 + fr, a0 - fa, a1 + fa, CK.BRONZE, { o: 0.035, i: 0.04, nt: 1, na: 3 }));
      detail.push(hullStrip(t0, t1, a0 - fa, a0 + fa * 0.2, CK.BRONZE, { o: 0.035, i: 0.04, nt: 2, na: 1 }));
      detail.push(hullStrip(t0, t1, a1 - fa * 0.2, a1 + fa, CK.BRONZE, { o: 0.035, i: 0.04, nt: 2, na: 1 }));
      const tm = (t0 + t1) / 2;
      detail.push(hullStrip(tm - 0.0006, tm + 0.0006, a0, a1, CK.DARK, { o: 0.02, i: 0.03, nt: 1, na: 3 }));
      detail.push(hullStrip(t0, t1, aW - 0.004, aW + 0.004, CK.DARK, { o: 0.02, i: 0.03, nt: 2, na: 1 }));
      // an eyebrow over each window (a rain gutter's space cousin: a sun hood)
      detail.push(hullStrip(t0 - 0.002, t1 + 0.002, a1 + (side > 0 ? 0.012 : 0.012), a1 + 0.03, CK.HULL, { o: 0.07, i: 0.02, nt: 2, na: 1 }));
    }
    // a lower row of small ports along the crew deck
    const aP = side > 0 ? 0.22 + TAU : Math.PI - 0.22;
    for (let i = 0; i < 11; i++) {
      const tc = 0.2 + i * 0.019, f = hullFrame(tc, aP);
      const ring = revolve([[0.0, -0.02, CK.GLASS], [0.17, -0.02, CK.GLASS], [0.17, -0.02, CK.BRONZE], [0.23, 0.02, CK.BRONZE], [0.23, 0.05, CK.BRONZE], [0.17, 0.06, CK.BRONZE]], 14, { closed: false });
      detail.push(placeZ2(ring, f.p, f.n));
    }
  }

  // ---- access hatches: a raised plate in a dark reveal, two hinge knuckles and a handle
  const hatches = [[0.13, 0.62], [0.13, Math.PI - 0.62], [0.47, 0.35 + TAU], [0.47, Math.PI - 0.35], [0.58, 0.55 + TAU], [0.58, Math.PI - 0.55],
    [0.72, 0.18 + TAU], [0.72, Math.PI - 0.18], [0.66, Math.PI / 2 + 1.05], [0.66, Math.PI / 2 - 1.05 + TAU], [0.9, 0.35 + TAU], [0.9, Math.PI - 0.35]];
  for (const [t, a] of hatches) {
    const P = patchTA(t, a, 1.3, 0.8);
    detail.push(hullStrip(P.t0, P.t1, P.a0, P.a1, CK.DARK, { o: 0.008, i: 0.03, nt: 2, na: 2 }));
    const m = 0.0014, ma = (P.a1 - P.a0) * 0.06;
    detail.push(hullStrip(P.t0 + m, P.t1 - m, P.a0 + ma, P.a1 - ma, CK.HULL, { o: 0.022, i: 0.03, nt: 2, na: 2 }));
    for (const s of [0.3, 0.7]) detail.push(onHull(stock(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 8), CK.BRONZE).rotateX(Math.PI / 2), lerp(P.t0, P.t1, s), P.a1 - ma, 0.03, Math.PI / 2));
    detail.push(onHull(box(0.22, 0.04, 0.05, CK.BRONZE), (P.t0 + P.t1) / 2, P.a0 + ma * 2.5, 0.045));
  }

  // ---- cargo doors on the aft deck: two leaves meeting on the centreline, hinge fairings, actuators
  {
    const t0 = tOf(4.6), t1 = tOf(11.4), aC = Math.PI / 2;
    for (const side of [1, -1]) {
      const aIn = aC - side * 0.006, aOut = aC - side * 0.36;
      base.push(hullStrip(t0, t1, Math.min(aIn, aOut), Math.max(aIn, aOut), CK.HULL, { o: 0.05, i: 0.02, nt: 10, na: 8 }));
      // stiffening ribs across each leaf, and a hinge fairing along its outer edge
      for (let r = 1; r < 6; r++) { const tr = lerp(t0, t1, r / 6); detail.push(hullStrip(tr - 0.0012, tr + 0.0012, Math.min(aIn, aOut) + 0.02, Math.max(aIn, aOut) - 0.02, CK.HULL, { o: 0.085, i: 0.0, nt: 1, na: 6 })); }
      const pts = []; for (let k = 0; k <= 8; k++) pts.push(hullPt(lerp(t0 + 0.003, t1 - 0.003, k / 8), aOut, 0.05));
      detail.push(tube(pts, 0.07, CK.DARK, 8, 2));
      for (const s of [0.2, 0.5, 0.8]) detail.push(onHull(bbox(0.2, 0.16, 0.6, 0.04, CK.BRONZE), lerp(t0, t1, s), aOut + side * 0.03, 0.1));
    }
    detail.push(hullStrip(t0 - 0.002, t0 + 0.0005, aC - 0.38, aC + 0.38, CK.DARK, { o: 0.07, i: 0.02, nt: 1, na: 10 }));
    detail.push(hullStrip(t1 - 0.0005, t1 + 0.002, aC - 0.38, aC + 0.38, CK.DARK, { o: 0.07, i: 0.02, nt: 1, na: 10 }));
  }

  // ---- the spine: a glowing conduit aft of the flight deck, in collars
  {
    const pts = []; for (let t = 0.88; t <= 0.965; t += 0.017) pts.push(hullPt(t, Math.PI / 2, 0.15));
    base.push(tube(pts, 0.14, CK.CONDUIT, 10, 3));
    for (let t = 0.895; t < 0.96; t += 0.02) detail.push(onHull(revolve([[0.19, -0.08, CK.BRONZE], [0.21, -0.05, CK.BRONZE], [0.21, 0.05, CK.BRONZE], [0.19, 0.08, CK.BRONZE]], 14, { closed: true }).rotateX(0), t, Math.PI / 2, 0.15 - 0.0));
  }

  // ---- radiator wings from the chines (swept, slight anhedral), ribbed, with coolant manifolds
  const navTips = [];
  for (const sg of [1, -1]) {
    const aC = sg > 0 ? 0 : Math.PI;
    const r0 = hullPt(0.55, aC), r1 = hullPt(0.93, aC);
    r0.x -= sg * 0.3; r1.x -= sg * 0.3;
    const span = 6.8, drop = -0.7;
    const t0 = V3(r0.x + sg * span, r0.y + drop, r0.z + 7.2), t1 = V3(r0.x + sg * span, r0.y + drop, r0.z + 11.0);
    // the panel: a thin plate; facade x across the chord, y out along the span
    const th = 0.2, up = V3(0, th / 2, 0);
    const NS = 10, rings = [];
    for (let j = 0; j <= NS; j++) {
      const u = j / NS, a = r0.clone().lerp(t0, u), b = r1.clone().lerp(t1, u);
      rings.push([a.clone().add(up), b.clone().add(up), b.clone().sub(up), a.clone().sub(up)]);
    }
    base.push(loft(rings, CK.RADIATOR, { capStart: true, capEnd: true }));
    // ribs across the panel (top and bottom), every 0.62 m of span
    for (let j = 1; j < 11; j++) {
      const u = j / 11, a = r0.clone().lerp(t0, u), b = r1.clone().lerp(t1, u);
      for (const yy of [th / 2 + 0.02, -th / 2 - 0.02]) detail.push(rod(a.clone().add(V3(0, yy, 0.05)), b.clone().add(V3(0, yy, -0.05)), 0.025, CK.DARK, 6));
    }
    // coolant manifolds: a fat header along the root, a return along the leading edge, feed stubs
    base.push(tube([r0.clone().add(V3(sg * 0.05, 0, -0.1)), t0.clone().add(V3(sg * 0.05, 0, -0.12))], 0.14, CK.BRONZE, 10, 2));
    base.push(tube([t0.clone().add(V3(sg * 0.03, 0, -0.1)), t1.clone().add(V3(sg * 0.03, 0, 0.12))], 0.12, CK.BRONZE, 10, 2));
    detail.push(tube([r0.clone().add(V3(sg * 0.15, 0.16, 0.3)), r1.clone().add(V3(sg * 0.15, 0.16, -0.3))], 0.09, CK.BRONZE, 8, 2));
    for (let j = 0; j < 5; j++) {
      const p = r0.clone().lerp(r1, 0.1 + j * 0.2);
      detail.push(tube([p.clone().add(V3(-sg * 0.35, 0.05, 0)), p.clone().add(V3(sg * 0.25, 0.16, 0))], 0.05, CK.DARK, 6, 2));
      detail.push(stock(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 10), CK.BRONZE).translate(p.x + sg * 0.1, p.y + 0.18, p.z));
    }
    // wingtip pod: a small fairing carrying the navigation light and the strobe
    detail.push(revolve([[0.0, -0.45, CK.DARK], [0.12, -0.35, CK.HULL], [0.16, 0.0, CK.HULL], [0.14, 0.9, CK.HULL], [0.0, 1.2, CK.DARK]], 12).translate(t0.x + sg * 0.12, t0.y, t0.z));
    navTips.push(t0.clone().add(V3(sg * 0.2, 0.0, -0.35)));
  }

  // ---- stern fins: canted radiator fins with ribs, a bronze leading-edge header
  for (const sg of [1, -1]) {
    const b0 = hullPt(0.76, Math.PI / 2 - sg * 0.55, -0.05), b1 = hullPt(0.97, Math.PI / 2 - sg * 0.55, -0.05);
    const dir = V3(sg * Math.sin(0.42), Math.cos(0.42), 0);
    const t0 = b0.clone().addScaledVector(dir, 3.2).add(V3(0, 0, 3.6)), t1 = b1.clone().addScaledVector(dir, 3.2).add(V3(0, 0, 0.9));
    const nrm = new THREE.Vector3().crossVectors(dir, V3(0, 0, 1)).normalize();
    const up = nrm.clone().multiplyScalar(0.1);
    const ring = (a, b) => [a.clone().add(up), b.clone().add(up), b.clone().sub(up), a.clone().sub(up)];
    const rr = []; for (let j = 0; j <= 6; j++) { const u = j / 6; rr.push(ring(b0.clone().lerp(t0, u), b1.clone().lerp(t1, u))); }
    base.push(loft(rr, CK.RADIATOR, { capStart: true, capEnd: true }));
    base.push(tube([b0.clone(), t0.clone()], 0.1, CK.BRONZE, 8, 2));
    for (let j = 1; j < 6; j++) {
      const u = j / 6, a = b0.clone().lerp(t0, u), b = b1.clone().lerp(t1, u);
      for (const s of [1, -1]) detail.push(rod(a.clone().addScaledVector(nrm, s * 0.12).add(V3(0, 0, 0.06)), b.clone().addScaledVector(nrm, s * 0.12).add(V3(0, 0, -0.06)), 0.022, CK.DARK, 6));
    }
    // a fin-tip light housing
    detail.push(box(0.16, 0.2, 0.9, CK.DARK, t0.clone().lerp(t1, 0.2).addScaledVector(dir, 0.08)));
  }

  // ---- name plates on both bows: a dark plate in a bronze rim, the name and registration raised
  for (const side of [1, -1]) {
    const aM = side > 0 ? 0.3 + TAU : Math.PI - 0.3;
    const z0 = -14.6, px = 0.085;
    const len = 8 * 6 * px;
    const ta = tOf(z0 - 0.35), tb = tOf(z0 + len + 0.1);
    const P = patchTA((ta + tb) / 2, aM, (tb - ta) * SHIP.L, 1.3);
    detail.push(hullStrip(ta, tb, P.a0, P.a1, CK.BRONZE, { o: 0.012, i: 0.02, nt: 12, na: 3 }));
    detail.push(hullStrip(ta + 0.001, tb - 0.001, P.a0 + 0.004, P.a1 - 0.004, CK.DARK, { o: 0.018, i: 0.02, nt: 12, na: 3 }));
    const zs = side > 0 ? z0 + len - px * 2 : z0;
    detail.push(...lettering('LODESTAR', zs, aM, px, side, CK.BRONZE, 0.26));
    // the registration, smaller, on a line below the name
    const pr = 0.055, zr = side > 0 ? z0 + len - px * 2 : z0;
    detail.push(...lettering('CS-71', zr, aM, pr, side, CK.HULL, -0.36));
  }

  // ---- greebles: vents, valve boxes, grab rails and conduit runs on the flanks and aft deck
  {
    const R = rng(31);
    const clear = (x, z) => (Math.abs(x) < 2.6 && z > -12.5 && z < 4.5) || (Math.abs(x) < 2.1 && z > 4.3 && z < 11.8);
    let placed = 0;
    for (let tries = 0; tries < 900 && placed < 170; tries++) {
      const t = 0.12 + R() * 0.82, a = Math.PI / 2 + (R() - 0.5) * 2 * 1.35;
      const p = hullPt(t, a);
      if (clear(p.x, p.z)) continue;
      if (t > 0.53 && Math.abs(Math.cos(a)) > 0.93) continue;                    // radiator roots
      const kind = R();
      if (kind < 0.35) detail.push(onHull(bbox(0.25 + R() * 0.5, 0.08 + R() * 0.12, 0.3 + R() * 0.8, 0.03, R() < 0.3 ? CK.BRONZE : CK.DARK), t, a, 0.05));
      else if (kind < 0.55) {
        // a louvred vent: a frame and slats
        const w = 0.5 + R() * 0.4, l = 0.5 + R() * 0.5;
        detail.push(onHull(bbox(w, 0.06, l, 0.02, CK.DARK), t, a, 0.02));
        for (let s = 0; s < 4; s++) detail.push(onHull(box(w * 0.85, 0.02, 0.05, CK.HULL, V3(0, 0.05, (s - 1.5) * l * 0.22), new THREE.Euler(0.5, 0, 0)), t, a, 0.02));
      } else if (kind < 0.7) {
        detail.push(onHull(stock(new THREE.CylinderGeometry(0.09 + R() * 0.08, 0.12 + R() * 0.08, 0.12 + R() * 0.2, 12), R() < 0.5 ? CK.BRONZE : CK.DARK), t, a, 0.06));
      } else if (kind < 0.85) {
        // a grab rail on two standoffs
        const L = 0.6 + R() * 0.6, g = [];
        g.push(rod(V3(-L / 2, 0.12, 0), V3(L / 2, 0.12, 0), 0.018, CK.BRONZE, 6));
        g.push(rod(V3(-L / 2, 0, 0), V3(-L / 2, 0.13, 0), 0.016, CK.BRONZE, 6), rod(V3(L / 2, 0, 0), V3(L / 2, 0.13, 0), 0.016, CK.BRONZE, 6));
        for (const x of g) detail.push(onHull(x, t, a, 0.0, R() * Math.PI));
      } else {
        // a short conduit run along the ship with clamps
        const pts = [], L = 1.2 + R() * 2.4;
        for (let k = 0; k <= 4; k++) pts.push(hullPt(t + (k / 4) * (L / SHIP.L), a, 0.07));
        detail.push(tube(pts, 0.04, R() < 0.5 ? CK.BRONZE : CK.DARK, 6, 2));
        for (let k = 1; k < 4; k++) detail.push(onHull(box(0.12, 0.06, 0.05, CK.DARK), t + (k / 4) * (L / SHIP.L), a, 0.06));
      }
      placed++;
    }
  }

  // ---- doubler plates: proud reinforcing plates between the seams, each outlined by a fastener
  // rim; EVA handrails along the upper flanks; blade antennas on the belly and flanks
  {
    const R = rng(53);
    const tS = SEAM_T, aBand = [[Math.PI / 2 + 0.36, Math.PI / 2 + 0.8], [Math.PI / 2 - 0.8 + TAU, Math.PI / 2 - 0.36 + TAU], [Math.PI / 2 + 0.84, Math.PI - 0.32], [0.32 + TAU, Math.PI / 2 - 0.84 + TAU]];
    for (let i = 0; i < tS.length - 1; i++) for (const [a0, a1] of aBand) {
      if (R() < 0.45) continue;
      const t0 = tS[i] + 0.004 + R() * 0.01, t1 = tS[i + 1] - 0.004 - R() * 0.01;
      const b0 = lerp(a0, a1, 0.08 + R() * 0.2), b1 = lerp(a0, a1, 0.72 + R() * 0.2);
      const pm = hullPt((t0 + t1) / 2, (b0 + b1) / 2);
      if ((Math.abs(pm.x) < 2.7 && pm.z > -12.5 && pm.z < 4.6) || (Math.abs(pm.x) < 2.2 && pm.z > 4.3 && pm.z < 11.8)) continue;
      detail.push(hullStrip(t0, t1, b0, b1, CK.HULL, { o: 0.014, i: 0.01, nt: 4, na: 4 }));
      detail.push(hullStrip(t0 - 0.0008, t1 + 0.0008, b0 - 0.004, b1 + 0.004, CK.DARK, { o: 0.007, i: 0.01, nt: 4, na: 4 }));
    }
    for (const side of [1, -1]) {
      const a = side > 0 ? Math.PI / 2 - 1.12 + TAU : Math.PI / 2 + 1.12;
      for (const [tA, tB] of [[0.15, 0.36], [0.5, 0.74]]) {
        const pts = []; for (let k = 0; k <= 10; k++) pts.push(hullPt(lerp(tA, tB, k / 10), a, 0.13));
        detail.push(tube(pts, 0.022, CK.BRONZE, 6, 2));
        for (let k = 0; k <= 5; k++) { const t = lerp(tA, tB, k / 5); detail.push(rod(hullPt(t, a, 0.0), hullPt(t, a, 0.14), 0.018, CK.BRONZE, 6)); }
      }
    }
    for (const [t, a, h] of [[0.47, 3 * Math.PI / 2, 0.55], [0.62, 3 * Math.PI / 2 + 0.12, 0.4], [0.62, 3 * Math.PI / 2 - 0.12, 0.4], [0.45, 0.62 + TAU, 0.35], [0.45, Math.PI - 0.62, 0.35]]) {
      const blade = loft([[V3(-0.02, 0, -0.25), V3(0.02, 0, -0.25), V3(0.02, 0, 0.25), V3(-0.02, 0, 0.25)], [V3(-0.012, h, 0.05), V3(0.012, h, 0.05), V3(0.012, h, 0.25), V3(-0.012, h, 0.25)]], CK.DARK, { capStart: true, capEnd: true });
      detail.push(onHull(blade, t, a, 0.04));
    }
  }

  // ---- sensors: a probe on the nose, a chin turret, and blisters on the flanks
  {
    const tip = hullPt(0.0, 0);
    base.push(revolve([[0.0, -1.35, CK.DARK], [0.03, -1.3, CK.BRONZE], [0.035, -0.6, CK.BRONZE], [0.07, -0.55, CK.DARK], [0.09, -0.2, CK.HULL], [0.14, 0.15, CK.HULL], [0.0, 0.3, CK.HULL]], 12).translate(tip.x, tip.y + 0.02, tip.z + 0.1));
    for (const sx of [1, -1]) detail.push(rod(V3(tip.x + sx * 0.05, tip.y + 0.02, tip.z - 0.9), V3(tip.x + sx * 0.2, tip.y + 0.02, tip.z - 0.95), 0.012, CK.DARK, 5));
    const ch = hullPt(0.1, -Math.PI / 2, 0.02);
    base.push(stock(new THREE.CylinderGeometry(0.26, 0.3, 0.12, 20), CK.DARK).translate(ch.x, ch.y - 0.04, ch.z));
    base.push(stock(new THREE.SphereGeometry(0.24, 20, 12, 0, TAU, Math.PI / 2, Math.PI / 2), CK.HULL).translate(ch.x, ch.y - 0.1, ch.z));
    base.push(revolve([[0.0, 0.0, CK.GLASS], [0.09, 0.0, CK.GLASS], [0.09, 0.0, CK.DARK], [0.11, -0.04, CK.DARK], [0.11, -0.1, CK.DARK]], 14).translate(ch.x, ch.y - 0.22, ch.z - 0.12).applyMatrix4(new THREE.Matrix4()));
    for (const side of [1, -1]) {
      const a = side > 0 ? -0.35 + TAU : Math.PI + 0.35;
      detail.push(onHull(stock(new THREE.SphereGeometry(0.35, 16, 8, 0, TAU, 0, Math.PI / 2), CK.HULL).scale(1, 0.45, 1.8), 0.27, a, 0.0));
      detail.push(onHull(box(0.3, 0.05, 0.12, CK.GLASS, V3(0, 0.14, -0.2)), 0.27, a, 0.0));
    }
  }

  return { base, detail, navTips };
}

/** Place a geometry built along +Z (out of the surface) at p facing n. */
function placeZ2(g, p, n) {
  return g.applyMatrix4(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), n.clone().normalize()), V3(1, 1, 1)));
}
void FS; void placeY;
