import * as THREE from 'three';
import { patchedMaterial, aerialShaderMaterial, FACADE_GLSL } from './materials.js';
import { createFacadeMaterial } from './facade.js';
import { SPECIES } from './treeGeometry.js';
import { createNoise2D, mulberry32, smoothstep, lerp, clamp, smin } from './noise.js';

// The floating gardens: eight sky islands, each resting on a lattice of diamagnetic crystal.
//  - the island body is one closed, seamless mesh: a meadow of walks, parterres and groves, a turf
//    lip over a band of rooty soil, then bedded volcanic rock (hard beds stand proud as ledges, soft
//    beds are scooped back, flutes and buttresses run down the root) closing to a single point
//  - on top, a garden plan: a colonnaded pavilion on a stepped plinth, a spring pool and a stone
//    rill running out to a spout on the rim, walks and flower parterres (exact distance fields on
//    the mesh, so the shader draws crisp kerbs), allées and groves rooted in the meadow, every
//    crown kept inside the rim
//  - the rill pours off the spout as a sheet that arcs clear of the rock, frays and turns to mist
//  - a geodesic cradle of crystal struts anchored in the rock carries the island; its keystone
//    holds the tip of the root
//  - two levels of detail: the near body and lattice give way to a coarse body with the same
//    massing and bare crystal nodes; the built garden, the water and the fall stay throughout

const n2 = createNoise2D(909);
const n3 = createNoise2D(311);
const TAU = Math.PI * 2;
const G = 9.81;
const wrapA = (a) => ((a % TAU) + TAU) % TAU;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };

// --------------------------------------------------------------------------------- the plan --
function islandPlan(d) {
  const r = d.r;
  const rnd = mulberry32(d.seed * 131 + 17);
  const o = [0, 0, 0, 0, 0, 0].map(() => rnd() * 60);
  // plan outline (radius factor); the waterfall leaves from the outermost promontory
  const E = (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return 0.95 + 0.075 * n2(c * 1.15 + o[0], s * 1.15 + o[1]) + 0.022 * n2(c * 3.1 + o[2], s * 3.1 + o[3]);
  };
  let thF = 0, eMax = -1, eMin = 9, eSum = 0;
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * TAU, e = E(a);
    eSum += e;
    if (e > eMax) { eMax = e; thF = a; }
    eMin = Math.min(eMin, e);
  }
  const P = { r, seed: d.seed, E, thF, eMin, eMax, eAvg: eSum / 720 };
  const Re = P.Re = (a) => r * E(a);
  P.Ec = eMin * 0.985;
  // meadow rings: circles round the pavilion, the island's own outline further out
  P.ringR = (rho, a) => rho * r * lerp(P.Ec, E(a), smoothstep(0.45, 0.58, rho));

  // ---- the garden: pavilion plinth, a circular walk round it, the parterre ring, the garden
  //      ring walk, radial walks out to overlooks near the rim, the spring pool and its rill
  const Rp = P.Rp = 7 + 0.045 * r;                 // colonnade radius
  const Rplo = P.Rplo = Rp + 3.2;                  // foot of the plinth
  const walkR = Rplo + 1.6, walkHw = 1.4;
  const Rb1 = P.Rb1 = Rplo + 4.3, Rb2 = P.Rb2 = Rb1 + 8 + 0.08 * r;
  const rhoP = P.rhoP = 0.64, hwR = P.hwR = 1.8, hwS = P.hwS = 1.5;
  const nS = P.nS = r >= 130 ? 6 : 4;
  // rill axis (outward along thF) and its sections: pool, rill, spout past the rim
  const uf = P.uf = [Math.cos(thF), Math.sin(thF)];
  const s0 = P.s0 = Rplo + 4.5, s1 = P.s1 = s0 + 6 + 0.03 * r;
  const hwPi = P.hwPi = 2.2 + 0.006 * r, hwPo = P.hwPo = hwPi + 0.5;
  const hwRi = P.hwRi = 0.7 + 0.0025 * r, hwRo = P.hwRo = hwRi + 0.42;
  const sRim = P.sRim = Re(thF), sLip = P.sLip = sRim + 1.8;
  const hwo = (s) => (s < s1 ? hwPo : hwRo);
  P.hwo = hwo;
  const spokes = P.spokes = [];
  for (let k = 0; k < nS; k++) {
    const a = wrapA(thF + ((k + 0.5) / nS) * TAU);     // multiples of 15 degrees from the rill: mesh columns
    const orr = 4.2 + 0.01 * r;
    const oa = Re(a) - 4.5 - orr;
    spokes.push({ a, c: Math.cos(a), s: Math.sin(a), a0: Rplo - 2, a1: oa, ox: Math.cos(a) * oa, oz: Math.sin(a) * oa, or: orr });
  }
  // signed distances (metres, negative inside). On the mesh these are exact: the spokes run
  // along mesh columns and the ring walks along mesh rings, so the |d| creases lie on edges.
  P.spokeD = (x, z) => {
    let best = 1e9;
    for (const sp of spokes) {
      const al = x * sp.c + z * sp.s, lat = Math.abs(-x * sp.s + z * sp.c);
      const dd = al < sp.a0 ? Math.hypot(al - sp.a0, lat) : al > sp.a1 ? Math.hypot(al - sp.a1, lat) : lat;
      best = Math.min(best, dd - hwS, Math.hypot(x - sp.ox, z - sp.oz) - sp.or);
    }
    return best;
  };
  P.ringD = (x, z) => {
    const R = Math.hypot(x, z);
    return Math.min(Math.abs(R - rhoP * Re(Math.atan2(z, x))) - hwR, Math.abs(R - walkR) - walkHw);
  };
  P.troughD = (x, z) => {
    const s = x * uf[0] + z * uf[1], l = Math.abs(-x * uf[1] + z * uf[0]);
    return Math.max(l - hwo(s), s0 - s, s - sLip);
  };
  P.bedD = (x, z) => {
    const R = Math.hypot(x, z);
    let dd = Math.min(R - Rb1, Rb2 - R);
    for (const sp of spokes) if (x * sp.c + z * sp.s > 0) dd = Math.min(dd, Math.abs(-x * sp.s + z * sp.c) - (hwS + 1.1));
    return Math.min(dd, P.troughD(x, z) - 1.6);
  };
  // parterre sector coordinate: its integer part changes on the walks only (never inside a bed)
  const secOff = 10 * (d.seed % 7);
  P.sector = (x, z) => (((wrapA(Math.atan2(z, x) - thF) / TAU) * nS + 0.5) % nS) + secOff;

  // ---- meadow heights: a gentle dome with rolling hills, flattened toward the rim (y = 0 there),
  //      graded flat round the plinth and along the rill, parterres raised, walks dished
  const Hnat = (x, z) => {
    const q = Math.hypot(x, z) / Re(Math.atan2(z, x));
    const hill = 2.1 * (0.7 * n3(x / 62 + o[1], z / 62 - o[2]) + 0.3 * n3(x / 23 - o[3], z / 23 + o[4]));
    return (r * 0.013 * (1 - q * q) + hill) * (1 - smoothstep(0.78, 0.97, q));
  };
  const Ht = P.Ht = Math.max(Hnat(0, 0), 0.8 + 0.009 * (sRim - s1));   // the rill always runs downhill
  const cPool = P.cPool = Ht + 0.12;
  P.cop = (s) => (s <= s1 ? cPool : s >= sRim ? 0.12 : lerp(cPool, 0.12, (s - s1) / (sRim - s1)));
  P.H = (x, z) => {
    let h = Hnat(x, z);
    const R = Math.hypot(x, z);
    h = lerp(h, Ht, 1 - smoothstep(Rplo + 2, Rplo + 13, R));
    const s = x * uf[0] + z * uf[1], l = Math.abs(-x * uf[1] + z * uf[0]);
    const hwc = lerp(hwPo, hwRo, smoothstep(s1 - 1, s1 + 6, s));
    const wc = (1 - smoothstep(hwc + 1.2, hwc + 8, l)) * smoothstep(s0 - 9, s0 - 2, s);
    if (wc > 0) h = lerp(h, P.cop(Math.min(s, sLip)) - 0.12, wc);
    h += 0.2 * smoothstep(0, 1.0, P.bedD(x, z));
    h -= 0.06 * (1 - smoothstep(-0.3, 0.5, Math.min(P.spokeD(x, z), P.ringD(x, z))));
    return h;
  };
  // mesh height: under the plinth and the trough the meadow drops inside their solids
  P.meadowY = (x, z) => {
    let y = P.H(x, z);
    if (Math.hypot(x, z) < Rplo - 0.03) y = Math.min(y, Ht - 1.2);
    if (P.troughD(x, z) < -0.03) y = Math.min(y, P.cop(clamp(x * uf[0] + z * uf[1], s0, sLip)) - 1.25);
    return y;
  };

  // ---- the rock: bedded strata below the soil band, a rounded bowl tapering to one point
  P.D = r * (1.3 + 0.45 * rnd());
  P.yRT = -3.2;
  P.yApex = P.yRT - P.D;
  const nl = 5 + Math.floor(rnd() * 4), phl = rnd() * TAU;
  const Kf = sRim / 7.5;
  const Al = P.Al = 1.5 + 0.0065 * r;              // ledge relief
  const Af = 0.7 + 0.006 * r;                      // flute relief
  const alD = 3 + 0.02 * r, alW = P.alW = hwRi + 8;   // the wet alcove behind the fall
  const beds = P.beds = [];
  for (let y = P.yRT, k = 0; y > P.yApex - 12; k++) {
    const T = (4.2 + 5.0 * rnd()) * Math.sqrt(r / 150);
    beds.push({ y0: y, y1: y - T, T, hard: k === 0 || rnd() < 0.5, e: Math.min(0.45, 0.09 * T) });
    y -= T;
  }
  const bedIx = (y) => {
    let lo = 0, hi = beds.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (beds[m].y0 >= y) lo = m; else hi = m - 1; }
    return lo;
  };
  P.strat = (y) => { const k = bedIx(y), b = beds[k]; return k + clamp((b.y0 - y) / b.T, 0, 1); };
  // hard beds stand proud (1) with bevelled arrises; soft beds are scooped back (to -0.55)
  P.ledgeP = (y) => {
    const k = bedIx(y), b = beds[k];
    const f = clamp((b.y0 - y) / b.T, 0, 1);
    if (b.hard) { const e = b.e / b.T; return Math.min(1, (1 - f) / e, k === 0 ? 1 : f / e); }
    return -0.55 * Math.pow(Math.sin(Math.PI * f), 0.8);
  };
  const S = P.S = (v) => Math.pow(Math.max(0, 1 - Math.pow(v, 1.6)), 0.9) * (1 - 0.1 * v);
  P.rockR = (a, y, near = true) => {
    const v = clamp((P.yRT - y) / P.D, 0, 1);
    const c = Math.cos(a), s = Math.sin(a);
    const re = Re(a), sv = S(v);
    // buttresses running down the root, weathered bulges, erosion flutes
    const lobe = Math.pow(Math.abs(Math.sin(nl * a * 0.5 + phl + 0.6 * n2(c * 1.3 + o[4], s * 1.3 - o[5]))), 1.6);
    let R = re * sv * (1 + 0.17 * (lobe - 0.4) * smoothstep(0.06, 0.5, v));
    R += re * sv * 0.05 * n2(c * 2.2 + o[3], s * 2.2 + y * 0.006) * smoothstep(0.02, 0.2, v);
    R += Af * n3(c * Kf + y * 0.011 + o[0], s * Kf - y * 0.008) * Math.sqrt(sv) * smoothstep(0, 0.03, v);
    // strata (the far body carries their average)
    const lw = 1 - smoothstep(0.36, 0.46, v);
    if (lw > 0) R += Al * lw * (near ? P.ledgeP(y) - 1 : -0.5 * smoothstep(0, 0.02, v));
    const da = angDiff(a, thF) * re;
    R -= alD * Math.exp(-(da / alW) * (da / alW)) * smoothstep(-3.2, -5.5, y) * (1 - smoothstep(0.16, 0.34, v));
    // never out past the rim above it
    R = smin(R, re + 0.2, 1.5);
    return Math.max(R, re * sv * 0.3);
  };
  P.wet = (a, y) => {
    const v = clamp((P.yRT - y) / P.D, 0, 1);
    const da = angDiff(a, thF) * Re(a);
    return Math.exp(-(da / alW) * (da / alW)) * (1 - smoothstep(0.08, 0.4, v));
  };
  P.rockRows = (near) => {
    const rows = [];
    const ledgeEnd = P.yRT - 0.47 * P.D;
    for (let k = 0; k < beds.length; k++) {
      const b = beds[k];
      if (b.y0 < ledgeEnd) break;
      rows.push(b.y0);
      if (!near) continue;
      if (b.hard) { if (k > 0) rows.push(b.y0 - b.e); rows.push(b.y1 + b.e); if (b.T > 7.5) rows.push((b.y0 + b.y1) / 2); }
      else rows.push(b.y0 - 0.22 * b.T, b.y0 - 0.5 * b.T, b.y0 - 0.78 * b.T);
    }
    let y = Math.min(...rows);
    const dy = near ? Math.max(3, P.D / 48) : Math.max(8, P.D / 16);
    const yEnd = P.yApex + 0.015 * P.D;
    while (y - dy > yEnd) { y -= dy; rows.push(y); }
    rows.push(yEnd);
    rows.sort((a, b) => b - a);
    return rows.filter((yy, i) => i === 0 || rows[i - 1] - yy > 0.1);
  };

  // ---- the waterfall: leaves the spout lip level, arcs clear of the rock, frays into mist
  P.fall = {
    lip: [uf[0] * sLip, -0.31, uf[1] * sLip],
    v0: 2.5,
    H: r * (0.95 + 0.45 * rnd()),
    hw: hwRi,
  };
  P.rnd = rnd;
  return P;
}

// column angles: 24 * 2^k columns from the rill axis, so every ring holds the spoke angles
function colAngles(P, circ, spacing) {
  const k = Math.max(0, Math.round(Math.log2(Math.max(1, circ / (spacing * 24)))));
  const N = 24 * (1 << k);
  const out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = wrapA(P.thF + (TAU * i) / N);
  return out.sort((a, b) => a - b);
}

function mergeAngles(base, extra) {
  if (!extra.length) return base;
  const out = base.slice();
  for (const e of extra) if (out.every((b) => Math.abs(angDiff(b, e)) > 1e-4)) out.push(e);
  return out.sort((a, b) => a - b);
}

// angles where a meadow ring meets the side walls of the pool / rill trough (so the meadow
// that drops inside the trough folds exactly at its walls)
function rillEdges(P, rho) {
  const R0 = P.ringR(rho, P.thF);
  if (R0 < P.s0 - 0.5 || R0 > P.sLip) return [];
  const out = [];
  for (const sg of [1, -1]) {
    let da = 0;
    for (let it = 0; it < 4; it++) {
      const a = P.thF + sg * da, R = P.ringR(rho, a);
      const hw = P.hwo(R * Math.cos(da));
      if (hw >= R * 0.9) return [];
      da = Math.asin(hw / R);
    }
    out.push(wrapA(P.thF + sg * da));
  }
  return out;
}

function meadowRings(P, near) {
  const Rc = P.r * P.Ec, u = P.r * P.eAvg;
  const feats = [P.Rplo * 0.5 / Rc, P.Rplo / Rc, (P.Rplo + 1.6) / Rc, P.Rb1 / Rc, P.Rb2 / Rc, P.rhoP, 1.0];
  const stepIn = near ? 4.4 : 13, stepRim = near ? 2.6 : 8;
  const fill = [];
  const rimZ = 1 - 14 / u;
  for (let rho = P.Rplo / Rc + stepIn / u; rho < rimZ; rho += stepIn / u) fill.push(rho);
  for (let rho = rimZ; rho < 1; rho += stepRim / u) fill.push(rho);
  const minD = (near ? 1.2 : 4) / u;
  const out = [...feats];
  for (const f of fill) if (out.every((q) => Math.abs(q - f) > minD)) out.push(f);
  return out.sort((a, b) => a - b);
}

// Triangulate the band between two closed rings ({ a: angle in [0, 2pi), i: vertex } sorted by
// angle). Vertices at equal angles are joined by an edge, so spoke columns stay mesh lines.
// Rings passed from the centre outward and down the rock give one consistent winding: the
// meadow faces up and the rock faces out.
function zip(A, B, idx) {
  const na = A.length, nb = B.length;
  if (na === 1 && nb === 1) return;
  if (na === 1) { for (let j = 0; j < nb; j++) idx.push(A[0].i, B[(j + 1) % nb].i, B[j].i); return; }
  if (nb === 1) { for (let i = 0; i < na; i++) idx.push(A[i].i, A[(i + 1) % na].i, B[0].i); return; }
  let j0 = 0, best = 9;
  for (let j = 0; j < nb; j++) { const dd = Math.abs(angDiff(B[j].a, A[0].a)); if (dd < best) { best = dd; j0 = j; } }
  const d0 = B[j0].a - A[0].a;
  const shift = d0 > Math.PI ? -TAU : d0 < -Math.PI ? TAU : 0;
  const ua = (i) => A[i % na].a + TAU * Math.floor(i / na);
  const ub = (j) => B[(j0 + j) % nb].a + TAU * Math.floor((j0 + j) / nb) + shift;
  let i = 0, j = 0;
  while (i < na || j < nb) {
    const ai = A[i % na].i, bj = B[(j0 + j) % nb].i;
    const aN = A[(i + 1) % na].i, bN = B[(j0 + j + 1) % nb].i;
    if (i >= na) { idx.push(ai, bN, bj); j++; continue; }
    if (j >= nb) { idx.push(ai, aN, bj); i++; continue; }
    const ta = ua(i + 1), tb = ub(j + 1);
    if (ta < tb - 1e-9) { idx.push(ai, aN, bj); i++; }
    else if (tb < ta - 1e-9) { idx.push(ai, bN, bj); j++; }
    else { idx.push(ai, aN, bj); idx.push(aN, bN, bj); i++; j++; }
  }
}

// ---------------------------------------------------------------------------- island body --
function buildBody(P, near) {
  const pos = [], col = [], surf = [], strat = [], idx = [];
  let prev = null;
  const vert = (x, y, z, t, s0, s1, s2, s3, b) => { pos.push(x, y, z); col.push(t, t, t); surf.push(s0, s1, s2, s3); strat.push(b); return pos.length / 3 - 1; };
  const ring = (angles, fn) => {
    const cur = angles.map((a) => ({ a, i: fn(a) }));
    if (prev) zip(prev, cur, idx);
    prev = cur;
  };
  const meadowV = (x, z) => vert(x, P.meadowY(x, z), z, 1, P.spokeD(x, z), P.ringD(x, z), P.bedD(x, z), P.sector(x, z), 0);
  const rimCirc = TAU * P.r * P.eAvg, rimSp = near ? 3.0 : 9;
  ring([0], () => meadowV(0, 0));
  for (const rho of meadowRings(P, near)) {
    const spc = near ? lerp(4.4, rimSp, smoothstep(0.8, 1.0, rho)) : lerp(13, rimSp, smoothstep(0.8, 1.0, rho));
    const circ = rho >= 0.9999 ? rimCirc : TAU * rho * P.r * lerp(P.Ec, P.eAvg, smoothstep(0.45, 0.58, rho));
    ring(mergeAngles(colAngles(P, circ, spc), rillEdges(P, rho)), (a) => {
      const R = P.ringR(rho, a);
      return meadowV(Math.cos(a) * R, Math.sin(a) * R);
    });
  }
  // the turf lip curls over a band of soil
  const rimA = colAngles(P, rimCirc, rimSp);
  const lip = near ? [[0.45, -0.28], [0.72, -0.95], [0.55, -1.75], [0.25, -2.6]] : [[0.5, -0.4], [0.7, -1.2], [0.25, -2.6]];
  for (const [dr, y] of lip) ring(rimA, (a) => { const R = P.Re(a) + dr; return vert(Math.cos(a) * R, y, Math.sin(a) * R, 1, 9, 9, -9, 0, 0); });
  // the rock, bed by bed, down to the tip of the root
  for (const y of P.rockRows(near)) {
    const v = (P.yRT - y) / P.D;
    const lw = 1 - smoothstep(0.36, 0.46, v);
    ring(colAngles(P, rimCirc * P.S(v), rimSp), (a) => {
      const R = P.rockR(a, y, near);
      const wet = P.wet(a, y);
      const t = (1 - 0.3 * v) * (near ? 1 + 0.06 * (P.ledgeP(y) - 1) * lw : 1 - 0.03 * lw) * (1 - 0.18 * wet);
      return vert(Math.cos(a) * R, y, Math.sin(a) * R, t, 9, 9, -9, wet, P.strat(y));
    });
  }
  ring([0], () => vert(0, P.yApex, 0, 0.62, 9, 9, -9, 0, P.strat(P.yApex)));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSurf', new THREE.Float32BufferAttribute(surf, 4));
  g.setAttribute('aStrat', new THREE.Float32BufferAttribute(strat, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  fixNormals(g);
  g.computeBoundingSphere();
  return g;
}

// a zero or non-finite normal normalises to NaN in the shader and renders black
function fixNormals(g) {
  const nr = g.attributes.normal;
  for (let i = 0; i < nr.count; i++) {
    const l = Math.hypot(nr.getX(i), nr.getY(i), nr.getZ(i));
    if (!(l > 1e-6)) nr.setXYZ(i, 0, 1, 0);
  }
}

// ------------------------------------------------------------------ closed flat-faced solids --
// Non-indexed, every face its own normal. `ext(p)` supplies the extra per-vertex attribute.
class Solid {
  constructor(size) { this.P = []; this.N = []; this.X = []; this.size = size; }
  // `out`: any vector pointing out of the solid at this face; the winding follows it
  tri(a, b, c, out, xa, xb, xc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-9)) return;
    nx /= l; ny /= l; nz /= l;
    if (out && nx * out[0] + ny * out[1] + nz * out[2] < 0) { [b, c] = [c, b]; [xb, xc] = [xc, xb]; nx = -nx; ny = -ny; nz = -nz; }
    for (const [p, x] of [[a, xa], [b, xb], [c, xc]]) {
      this.P.push(p[0], p[1], p[2]); this.N.push(nx, ny, nz);
      for (let k = 0; k < this.size; k++) this.X.push(x[k]);
    }
  }
  geometry(name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute(name, new THREE.Float32BufferAttribute(this.X, this.size));
    g.computeBoundingSphere();
    return g;
  }
}

// Garden stonework and the pavilion in the shared facade material (aFacade = u, v, kind):
// walls read (run along the wall, height), flat-lying faces read the plan (x, z).
class Built extends Solid {
  constructor() { super(3); }
  face(a, b, c, kind, out, fa, fb, fc) {
    const f = (p, q) => q || [p[0], p[2]];
    this.tri(a, b, c, out, [...f(a, fa), kind], [...f(b, fb), kind], [...f(c, fc), kind]);
  }
  // closed lathe: prof [[r, y], ...] from the axis at the bottom, round the outside, back to the
  // axis on top; kinds[j] is the kind of the band from prof[j] to prof[j + 1]
  lathe(at, prof, segs, kinds) {
    for (let j = 0; j < prof.length - 1; j++) {
      const [r0, y0] = prof[j], [r1, y1] = prof[j + 1];
      const dr = r1 - r0, dy = y1 - y0, L = Math.hypot(dr, dy);
      if (L < 1e-6) continue;
      const nr = dy / L, ny = -dr / L;
      const flat = Math.abs(ny) > 0.7;
      const kind = Array.isArray(kinds) ? kinds[j] : kinds;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU, am = (a0 + a1) / 2;
        const p = (rr, yy, a) => [at[0] + Math.cos(a) * rr, at[1] + yy, at[2] + Math.sin(a) * rr];
        const uv = (rr, yy, a) => (flat ? null : [a * Math.max(rr, 1), at[1] + yy]);
        const out = [Math.cos(am) * nr, ny, Math.sin(am) * nr];
        const A = p(r0, y0, a0), B = p(r0, y0, a1), C = p(r1, y1, a1), D = p(r1, y1, a0);
        const fA = uv(r0, y0, a0), fB = uv(r0, y0, a1), fC = uv(r1, y1, a1), fD = uv(r1, y1, a0);
        if (r0 > 1e-6) this.face(A, B, C, kind, out, fA, fB, fC);
        if (r1 > 1e-6) this.face(A, C, D, kind, out, fA, fC, fD);
      }
    }
  }
  // closed loft of a polygon section (CCW in its own (l, y) plane, its first edge level)
  // through stations { pts: [[x, y, z]...], l2: [[l, y]...], u }; kinds per section edge (or one
  // kind). Every face is wound by its own outward direction: the section edge's outward normal
  // (ey, -el) carried into 3D on the station's across axis, and at the ends the loft direction.
  loft(st, kinds) {
    const n = st[0].pts.length;
    const kindOf = (i) => (Array.isArray(kinds) ? kinds[i] : kinds);
    const across = (S) => {
      const dl = S.l2[1][0] - S.l2[0][0];
      return [(S.pts[1][0] - S.pts[0][0]) / dl, (S.pts[1][1] - S.pts[0][1]) / dl, (S.pts[1][2] - S.pts[0][2]) / dl];
    };
    const ctr = (S) => S.pts.reduce((c, q) => [c[0] + q[0] / n, c[1] + q[1] / n, c[2] + q[2] / n], [0, 0, 0]);
    for (let j = 0; j < st.length - 1; j++) {
      const S0 = st[j], S1 = st[j + 1];
      const x0 = across(S0), x1 = across(S1);
      const ax = [x0[0] + x1[0], x0[1] + x1[1], x0[2] + x1[2]];
      for (let i = 0; i < n; i++) {
        const i1 = (i + 1) % n;
        const a = S0.pts[i], b = S0.pts[i1], c = S1.pts[i1], dd = S1.pts[i];
        const el = S0.l2[i1][0] - S0.l2[i][0], ey = S0.l2[i1][1] - S0.l2[i][1];
        const out = [ax[0] * ey, ax[1] * ey - 2 * el, ax[2] * ey];
        const vert = Math.abs(ey) > 0.3 * Math.abs(el);
        const fa = vert ? [S0.u, a[1]] : null, fb = vert ? [S0.u, b[1]] : null, fc = vert ? [S1.u, c[1]] : null, fd = vert ? [S1.u, dd[1]] : null;
        this.face(a, b, c, kindOf(i), out, fa, fb, fc);
        this.face(a, c, dd, kindOf(i), out, fa, fc, fd);
      }
    }
    // end caps, facing out along the loft at each end
    const cap = (S, Sn) => {
      const c0 = ctr(S), c1 = ctr(Sn);
      const out = [c0[0] - c1[0], c0[1] - c1[1], c0[2] - c1[2]];
      const tris = THREE.ShapeUtils.triangulateShape(S.l2.map((q) => new THREE.Vector2(q[0], q[1])), []);
      for (const [i0, i1, i2] of tris) this.face(S.pts[i0], S.pts[i1], S.pts[i2], kindOf(0), out, [S.l2[i0][0], S.pts[i0][1]], [S.l2[i1][0], S.pts[i1][1]], [S.l2[i2][0], S.pts[i2][1]]);
    };
    cap(st[0], st[1]);
    cap(st[st.length - 1], st[st.length - 2]);
  }
}

// hexagonal crystal: prism from `base` along `dir`, pointed at the far end (tip: fraction of the
// length), pointed at the near end too when foot > 0, else closed with a flat cap
function crystal(S, base, dir, len, rad, glow, along, { tip = 0.3, foot = 0, spin = 0 } = {}) {
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
  const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
  const ul = Math.hypot(u[0], u[1], u[2]); u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const at = (t) => [base[0] + d[0] * len * t, base[1] + d[1] * len * t, base[2] + d[2] * len * t];
  const ringAt = (t) => {
    const c = at(t);
    return [0, 1, 2, 3, 4, 5].map((k) => { const a = spin + (k / 6) * TAU; const ca = Math.cos(a) * rad, sa = Math.sin(a) * rad; return [c[0] + u[0] * ca + w[0] * sa, c[1] + u[1] * ca + w[1] * sa, c[2] + u[2] * ca + w[2] * sa]; });
  };
  const R0 = ringAt(foot), R1 = ringAt(1 - tip);
  const ctr = at(0.5);
  const x = [along, glow];
  const outOf = (a, b, c) => [(a[0] + b[0] + c[0]) / 3 - ctr[0], (a[1] + b[1] + c[1]) / 3 - ctr[1], (a[2] + b[2] + c[2]) / 3 - ctr[2]];
  const T = (a, b, c) => S.tri(a, b, c, outOf(a, b, c), x, x, x);
  const apex = at(1), foot0 = at(0);
  for (let k = 0; k < 6; k++) {
    const k1 = (k + 1) % 6;
    T(R0[k], R0[k1], R1[k1]); T(R0[k], R1[k1], R1[k]);
    T(R1[k], R1[k1], apex);
    T(R0[k1], R0[k], foot > 0 ? foot0 : at(foot));
  }
}

// hexagonal bipyramid: the node cores of the lattice
function bipyramid(S, c, rad, h, glow, along, spin = 0) {
  const top = [c[0], c[1] + h, c[2]], bot = [c[0], c[1] - h, c[2]];
  const rg = [0, 1, 2, 3, 4, 5].map((k) => { const a = spin + (k / 6) * TAU; return [c[0] + Math.cos(a) * rad, c[1], c[2] + Math.sin(a) * rad]; });
  const x = [along, glow];
  for (let k = 0; k < 6; k++) {
    const a = rg[k], b = rg[(k + 1) % 6];
    const o1 = [(a[0] + b[0]) / 2 - c[0], h * 0.5, (a[2] + b[2]) / 2 - c[2]];
    S.tri(a, b, top, o1, x, x, x);
    S.tri(a, b, bot, [o1[0], -h * 0.5, o1[2]], x, x, x);
  }
}

// ---------------------------------------------------------------------- the garden, built --
function buildGarden(P) {
  const always = new Built(), near = new Built();
  const { r, Ht, Rp, uf } = P;
  // stepped plinth under the pavilion (its foot is buried 1.4 m in the terrace)
  const R3 = P.Rplo, R2 = Rp + 2.4, R1 = Rp + 1.6;
  const yTop = Ht + 1.05;
  always.lathe([0, 0, 0], [[0, Ht - 1.4], [R3, Ht - 1.4], [R3, Ht + 0.35], [R2, Ht + 0.35], [R2, Ht + 0.7], [R1, Ht + 0.7], [R1, yTop], [0, yTop]], 72, 9);
  // colonnade: slender columns with a base and a capital, set 4 cm into the platform
  const nc = r >= 140 ? 12 : 10;
  const rc = 0.42 + 0.001 * r, hc = 7.2 + 0.008 * r;
  const yb = yTop - 0.04;
  for (let k = 0; k < nc; k++) {
    const a = P.thF + ((k + 0.5) / nc) * TAU;
    always.lathe([Math.cos(a) * Rp, yb, Math.sin(a) * Rp], [[0, 0], [1.35 * rc, 0], [1.35 * rc, 0.34], [rc, 0.46], [0.88 * rc, hc - 0.5], [1.3 * rc, hc - 0.25], [1.3 * rc, hc], [0, hc]], 12, 9);
  }
  // the lens roof: coffered soffit resting on the capitals, a shallow dome and a lantern
  const ys = yb + hc - 0.03, Rr = Rp + 4;
  always.lathe([0, ys, 0], [[0, 0], [Rr - 0.5, 0], [Rr, 0.4], [Rr, 0.85], [Rr - 0.9, 1.15], [Rr * 0.55, 1.9], [Rr * 0.2, 2.4], [1.1, 2.6], [1.1, 3.4], [0.5, 4.2], [0, 6.5]], 64, [1, 1, 1, 1, 1, 1, 1, 2, 2, 2]);
  // a pedestal for the crystal at the heart of the pavilion
  always.lathe([0, yTop - 0.04, 0], [[0, 0], [1.4, 0], [1.4, 0.44], [0.95, 0.6], [0.95, 1.3], [1.25, 1.45], [1.25, 1.6], [0, 1.6]], 24, 9);
  P.crystalBase = [0, yTop - 0.04 + 1.6, 0];
  P.roofTop = ys + 6.5;
  // ---- the pool and rill: a stone trough (coping, walls, floor) lofted along the rill axis;
  //      its outer walls go 1.4 m into the ground, and 3.9 m through the rim at the spout
  const lat = [-uf[1], 0, uf[0]];
  const at = (s, l, y) => [uf[0] * s + lat[0] * l, y, uf[1] * s + lat[2] * l];
  const sec = (s, wi, wo, c, f, bot) => {
    const l2 = [[-wo, bot], [wo, bot], [wo, c], [wi, c], [wi, f], [-wi, f], [-wi, c], [-wo, c]];
    return { pts: l2.map(([l, y]) => at(s, l, y)), l2, u: s };
  };
  const { s0, s1, sRim, sLip, hwPi, hwPo, hwRi, hwRo, cPool } = P;
  const cop = P.cop;
  always.loft([
    sec(s0, hwPi, hwPo, cPool, cPool - 0.62, cPool - 1.4),
    sec(s1, hwPi, hwPo, cPool, cPool - 0.62, cPool - 1.4),
    sec(s1 + 0.002, hwRi, hwRo, cPool, cPool - 0.48, cPool - 1.4),
    sec(sRim - 2.2, hwRi, hwRo, cop(sRim - 2.2), cop(sRim - 2.2) - 0.48, cop(sRim - 2.2) - 1.4),
    sec(sRim - 1.8, hwRi, hwRo, cop(sRim - 1.8), cop(sRim - 1.8) - 0.48, -3.9),
    sec(sRim, hwRi, hwRo, 0.12, 0.12 - 0.48, -3.9),
    sec(sLip, hwRi, hwRo, 0.12, 0.12 - 0.48, -3.9),
  ], 9);
  // spring stone in the pool
  const sp = (s0 + s1) / 2;
  near.lathe(at(sp, 0, cPool - 0.62), [[0, 0], [0.9, 0], [0.9, 0.35], [0.55, 0.5], [0.45, 0.95], [0.75, 1.05], [0.7, 1.2], [0, 1.28]], 16, 9);
  // ---- a hump bridge where the garden ring walk crosses the rill
  {
    const sb = P.rhoP * P.Re(P.thF);
    const c = cop(sb);
    const hw = P.hwR, wo = hwRo;
    const st = [];
    for (const [l, top, bot] of [[-(wo + 1.6), c - 0.1, c - 0.7], [-(wo + 0.03), c + 0.18, c - 0.45], [-(wo - 0.06), c + 0.2, c - 0.03], [0, c + 0.3, c + 0.02], [wo - 0.06, c + 0.2, c - 0.03], [wo + 0.03, c + 0.18, c - 0.45], [wo + 1.6, c - 0.1, c - 0.7]]) {
      const l2 = [[-hw, bot], [hw, bot], [hw, top], [-hw, top]];
      st.push({ pts: l2.map(([a, y]) => at(sb + a, l, y)), l2, u: l });
    }
    near.loft(st, 9);
  }
  // ---- low parapets round the overlooks at the ends of the walks
  for (const s of P.spokes) {
    const R = s.or + 0.25, t = 0.35;
    const st = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = s.a - 1.95 + (3.9 * i) / n;
      const ca = Math.cos(a), sa = Math.sin(a);
      const cx = s.ox + ca * R, cz = s.oz + sa * R;
      const g = P.H(cx, cz);
      const l2 = [[-t / 2, g - 0.45], [t / 2, g - 0.45], [t / 2, g + 0.95], [-t / 2, g + 0.95]];
      st.push({ pts: l2.map(([l, y]) => [cx + ca * l, y, cz + sa * l]), l2, u: a * R });
    }
    near.loft(st, 9);
  }
  return { always: always.geometry('aFacade'), near: near.geometry('aFacade') };
}

// water in the pool and rill: one ribbon at the water level, tucked 3 cm into the trough walls;
// the last metre drops over the brink of the spout
function buildWater(P) {
  const { uf, s0, s1, sRim, sLip, hwPi, hwRi, cPool } = P;
  const lat = [-uf[1], uf[0]];
  const st = [[s0, hwPi, cPool - 0.2, 0], [s1, hwPi, cPool - 0.2, 0], [s1 + 0.002, hwRi, cPool - 0.2, 1], [sRim, hwRi, -0.08, 1], [sLip - 1.2, hwRi, -0.08, 1], [sLip, hwRi, -0.26, 1]];
  const pos = [], flow = [], idx = [];
  for (const [s, hw, y, sp] of st) {
    for (const l of [-(hw + 0.03), hw + 0.03]) {
      pos.push(uf[0] * s + lat[0] * l, y, uf[1] * s + lat[1] * l);
      flow.push(uf[0], uf[1], sp, smoothstep(sLip - 6, sLip, s));
    }
  }
  for (let j = 0; j < st.length - 1; j++) {
    const a = j * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  // winding: the ribbon must face up
  if (g.attributes.normal.getY(0) < 0) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
  fixNormals(g);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------ crystal lattice --
function buildLattice(P) {
  const { r, rockR, yRT, D, thF } = P;
  const rs = 0.35 + 0.004 * r;                          // strut radius
  const near = new Solid(2), far = new Solid(2);
  const rowsV = [0.13, 0.36, 0.58, 0.79];
  const counts = r >= 150 ? [12, 10, 8, 6] : r >= 120 ? [10, 9, 7, 5] : [9, 8, 6, 5];
  const rows = [];
  for (let j = 0; j < 4; j++) {
    const y = yRT - rowsV[j] * D, n = counts[j];
    const off = thF + (j % 2 === 0 ? Math.PI / n : 0);
    let Rmax = 0;
    if (j > 0) for (let i = 0; i < 180; i++) for (const dy of [-8, 0, 8]) Rmax = Math.max(Rmax, rockR((i / 180) * TAU, y + dy));
    const nodes = [];
    for (let k = 0; k < n; k++) {
      const a = off + (k / n) * TAU;
      const R = j === 0 ? rockR(a, y) - 0.5 * rs : (Rmax + rs + 2.5) / Math.cos(Math.PI / n);
      nodes.push({ a, y, R, p: [Math.cos(a) * R, y, Math.sin(a) * R], row: j });
    }
    rows.push(nodes);
  }
  const key = { p: [0, P.yApex - 2.4 * rs, 0], row: 4 };
  // struts: rings in the free rows, diagonals between rows, spokes into the keystone
  const struts = [];
  for (let j = 1; j < 4; j++) for (let k = 0; k < rows[j].length; k++) struts.push([rows[j][k], rows[j][(k + 1) % rows[j].length]]);
  for (let j = 0; j < 3; j++) {
    for (const a of rows[j]) {
      const nb = rows[j + 1].slice().sort((p, q) => Math.abs(angDiff(p.a, a.a)) - Math.abs(angDiff(q.a, a.a)));
      struts.push([a, nb[0]], [a, nb[1]]);
    }
  }
  for (const a of rows[3]) struts.push([a, key]);
  // keep every strut clear of the rock (except where it is anchored) and of the falling water
  const fall = fallPath(P, 40);
  const clearOf = (A, B) => {
    for (let i = 1; i < 24; i++) {
      const t = i / 24;
      const x = A.p[0] + (B.p[0] - A.p[0]) * t, y = A.p[1] + (B.p[1] - A.p[1]) * t, z = A.p[2] + (B.p[2] - A.p[2]) * t;
      const dA = Math.hypot(x - A.p[0], y - A.p[1], z - A.p[2]), dB = Math.hypot(x - B.p[0], y - B.p[1], z - B.p[2]);
      if ((A.row === 0 && dA < 6 * rs) || (B.row === 0 && dB < 6 * rs) || (B.row === 4 && dB < 5 * rs)) continue;
      if (y > yRT - 1) return false;
      if (Math.hypot(x, z) - rs - 0.6 < rockR(Math.atan2(z, x), y)) return false;
      for (const f of fall) if (Math.hypot(x - f.p[0], y - f.p[1], z - f.p[2]) < f.hw + rs + 3) return false;
    }
    return true;
  };
  let along = 0;
  const kept = struts.filter(([A, B]) => clearOf(A, B));
  for (const [A, B] of kept) {
    const dir = [B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    along = (A.p[1] + B.p[1]) * -0.5;
    crystal(near, A.p, dir, len, rs, 0.55, along, { tip: Math.min(0.2, 2.2 * rs / len), foot: Math.min(0.2, 2.2 * rs / len), spin: A.a || 0 });
  }
  // node cores and their clusters of points, pointing out and down; anchors go into the rock
  const rnd = mulberry32(P.seed * 53 + 5);
  const sc = 1 + r / 150;
  for (const row of rows) {
    for (const nd of row) {
      const [x, y, z] = nd.p;
      const c = Math.cos(nd.a), s = Math.sin(nd.a);
      bipyramid(near, nd.p, 2.2 * rs, 2.6 * rs, 1.0, -y, nd.a);
      bipyramid(far, nd.p, 3.0 * rs, 3.4 * rs, 1.0, -y, nd.a);
      if (nd.row === 0) crystal(near, nd.p, [-c, -0.15, -s], 5 * rs + 2, 1.3 * rs, 0.5, -y, { tip: 0.3 });
      const np = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < np; i++) {
        const ta = nd.a + (rnd() - 0.5) * 1.4, el = -0.25 - rnd() * 0.9;
        const dir = [Math.cos(ta) * Math.cos(el), Math.sin(el), Math.sin(ta) * Math.cos(el)];
        crystal(near, [x - dir[0] * rs, y - dir[1] * rs, z - dir[2] * rs], dir, (1.6 + rnd() * 2.6) * sc, (0.55 + 0.35 * rnd()) * rs * 1.2, 0.8, -y, { tip: 0.32, spin: rnd() });
      }
    }
  }
  // the keystone under the tip of the root: a crystal up into the rock and a pendant cluster
  bipyramid(near, key.p, 2.8 * rs, 3.4 * rs, 1.0, -key.p[1]);
  bipyramid(far, key.p, 3.4 * rs, 4.0 * rs, 1.0, -key.p[1]);
  crystal(near, key.p, [0, 1, 0], 2.4 * rs + 6, 1.6 * rs, 1.0, -key.p[1], { tip: 0.35 });
  crystal(near, key.p, [0, -1, 0], (5 + r * 0.04) * sc, 1.5 * rs, 1.0, -key.p[1], { tip: 0.35 });
  crystal(far, key.p, [0, -1, 0], (5 + r * 0.04) * sc, 1.8 * rs, 1.0, -key.p[1], { tip: 0.35 });
  for (let i = 0; i < 7; i++) {
    const ta = (i / 7) * TAU + rnd(), el = -0.7 - rnd() * 0.5;
    const dir = [Math.cos(ta) * Math.cos(el), Math.sin(el), Math.sin(ta) * Math.cos(el)];
    crystal(near, key.p, dir, (2.5 + 3 * rnd()) * sc, 0.9 * rs, 0.9, -key.p[1], { tip: 0.35, spin: rnd() });
  }
  // the crystal at the heart of the pavilion
  const cb = P.crystalBase;
  crystal(near, [cb[0], cb[1] - 0.15, cb[2]], [0, 1, 0], 4.5 + 0.01 * r, 0.55, 1.0, 0, { tip: 0.25 });
  crystal(far, [cb[0], cb[1] - 0.15, cb[2]], [0, 1, 0], 4.5 + 0.01 * r, 0.55, 1.0, 0, { tip: 0.25 });
  for (let i = 0; i < 5; i++) {
    const ta = (i / 5) * TAU + 0.3;
    crystal(near, [cb[0] + Math.cos(ta) * 0.5, cb[1] - 0.1, cb[2] + Math.sin(ta) * 0.5], [Math.cos(ta) * 0.45, 1, Math.sin(ta) * 0.45], 1.1 + 0.6 * rnd(), 0.22, 0.9, 0, { tip: 0.35, spin: ta });
  }
  return { near: near.geometry('aCry'), far: far.geometry('aCry'), bottom: key.p[1] - (5 + r * 0.04) * sc, struts: kept.length };
}

// ------------------------------------------------------------------------------ waterfall --
// centreline samples of the falling sheet (ballistic from the lip: v0 out, gravity down)
function fallPath(P, n) {
  const F = P.fall, tf = Math.sqrt((2 * F.H) / G);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * tf, h = 0.5 * G * t * t;
    const run = F.v0 * t;
    out.push({ t, h, p: [F.lip[0] + P.uf[0] * run, F.lip[1] - h, F.lip[2] + P.uf[1] * run], hw: F.hw * (1 + 0.012 * h) + 0.02 * h, th: 0.1 + 0.02 * h });
  }
  return out;
}

// the sheet as an elliptical tube (it reads from the side as well as face-on)
function buildFall(P) {
  const path = fallPath(P, 44);
  const tf = path[path.length - 1].t;
  const across = [-P.uf[1], 0, P.uf[0]];
  const pos = [], fa = [], idx = [];
  const segs = 10;
  for (let i = 0; i < path.length; i++) {
    const f = path[i];
    // frame: tangent of the arc, horizontal across, and the thickness axis between them
    const tx = P.uf[0] * P.fall.v0, ty = -G * f.t, tz = P.uf[1] * P.fall.v0;
    const tl = Math.hypot(tx, ty, tz);
    const T = [tx / tl, ty / tl, tz / tl];
    const K = [T[1] * across[2] - T[2] * across[1], T[2] * across[0] - T[0] * across[2], T[0] * across[1] - T[1] * across[0]];
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      pos.push(f.p[0] + across[0] * ca * f.hw + K[0] * sa * f.th, f.p[1] + across[1] * ca * f.hw + K[1] * sa * f.th, f.p[2] + across[2] * ca * f.hw + K[2] * sa * f.th);
      fa.push(f.h, f.t, ca, f.t / tf);
    }
  }
  const cols = segs + 1;
  for (let i = 0; i < path.length - 1; i++) for (let k = 0; k < segs; k++) {
    const a = i * cols + k, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFall', new THREE.Float32BufferAttribute(fa, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  fixNormals(g);
  g.computeBoundingSphere();
  return g;
}

// mist: camera-facing puffs born along the lower part of the fall, drifting out and down
function buildMist(P) {
  const path = fallPath(P, 60);
  const rnd = mulberry32(P.seed * 71 + 3);
  const N = 110;
  const m = new Float32Array(N * 4), m2 = new Float32Array(N * 4);
  for (let k = 0; k < N; k++) {
    const t = 0.3 + 0.7 * Math.pow(rnd(), 0.8);
    const f = path[Math.min(path.length - 1, Math.floor(t * (path.length - 1)))];
    const lat = (rnd() - 0.5) * 2.2 * f.hw, rad = (rnd() - 0.3) * (3 + 0.06 * f.h);
    m[k * 4] = f.p[0] - P.uf[1] * lat + P.uf[0] * rad;
    m[k * 4 + 1] = f.p[1] + (rnd() - 0.5) * 12;
    m[k * 4 + 2] = f.p[2] + P.uf[0] * lat + P.uf[1] * rad;
    m[k * 4 + 3] = rnd();
    m2[k * 4] = P.uf[0]; m2[k * 4 + 1] = P.uf[1];
    m2[k * 4 + 2] = P.fall.H;
    m2[k * 4 + 3] = 10 + 0.16 * f.h * (0.6 + 0.8 * rnd());
  }
  const q = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = q.index;
  g.setAttribute('position', q.getAttribute('position'));
  g.setAttribute('aM', new THREE.InstancedBufferAttribute(m, 4));
  g.setAttribute('aM2', new THREE.InstancedBufferAttribute(m2, 4));
  g.instanceCount = N;
  return g;
}

// ------------------------------------------------------------------------------ materials --
// Sky-island rock and meadow, shaded in the island's own frame (metres). The rock: strata bed by
// bed from the geometry (vStrat), each bed its own tone, joint spacing and laminae; biplanar
// joints, blocks, seeps and micro relief; moss on every ledge and in the damp upper reaches; the
// wet alcove behind the fall. The soil band: loam, pebbles and hanging roots. The meadow: lawn and
// wildflowers, gravel walks with stone kerbs and path lights (vSurf.xy are signed distances to
// the walk edges), flower parterres edged with box (vSurf.z; their palette from vSurf.w). Every
// layer fades to its own average with the pixel footprint.
function rockMaterial() {
  return patchedMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.38 }, {
    key: 'floatrock6',
    vertex: {
      pars: 'attribute vec4 aSurf; attribute float aStrat; varying vec4 vSurf; varying float vStrat; varying vec3 vONrm; varying vec3 vRotX;',
      transform: 'vSurf = aSurf; vStrat = aStrat; vONrm = objectNormal;',
      main: 'vRotX = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));',
    },
    fragment: {
      pars: /* glsl */ `
${FACADE_GLSL}
varying vec4 vSurf; varying float vStrat; varying vec3 vONrm; varying vec3 vRotX;
float rkRough; float rkAO; vec3 rkBump; vec3 rkEmit;
vec3 rkLayer(float id) {
  float h = hash11(id * 7.13 + 0.37);
  if (h < 0.3) return vec3(0.25, 0.22, 0.2);        // basalt
  if (h < 0.52) return vec3(0.42, 0.32, 0.22);      // ochre tuff
  if (h < 0.68) return vec3(0.46, 0.41, 0.34);      // pale ash
  if (h < 0.84) return vec3(0.37, 0.26, 0.2);       // oxidised scoria
  return vec3(0.31, 0.28, 0.24);                    // grey lava
}
const vec3 RK_AVG = vec3(0.35, 0.29, 0.24);
vec3 flFlower(float k) {
  if (k < 0.17) return vec3(0.92, 0.9, 0.82);       // white
  if (k < 0.34) return vec3(0.9, 0.66, 0.1);        // gold
  if (k < 0.5) return vec3(0.5, 0.34, 0.8);         // violet
  if (k < 0.67) return vec3(0.82, 0.18, 0.24);      // crimson
  if (k < 0.84) return vec3(0.95, 0.5, 0.42);       // coral
  return vec3(0.36, 0.5, 0.9);                      // blue
}
// thin line of half-width w round d = 0 that keeps its coverage once the footprint is wider
float aaLine(float d, float w, float fw) { return clamp(1.0 - abs(d) / max(w, fw), 0.0, 1.0) * min(1.0, w / max(fw, 1e-4)); }
`,
      color: /* glsl */ `
{
  vec3 p = vObjPos;
  vec3 No = vONrm / max(length(vONrm), 1e-6);
  float up = No.y;
  // footprints first: derivatives stay outside every branch
  float fw = max(length(fwidth(p)), 1e-3);
  float fb = max(fwidth(vStrat), 1e-4);
  float fwX = max(fwidth(p.x), 1e-4), fwZ = max(fwidth(p.z), 1e-4);
  vec4 fS = max(fwidth(vSurf), vec4(1e-3));
  float d1 = 1.0 - smoothstep(0.3, 1.5, fw);          // metre-scale detail resolvable
  float d2 = 1.0 - smoothstep(0.04, 0.25, fw);        // hand-scale detail
  float dM = 1.0 - smoothstep(3.0, 9.0, fw);
  vec3 vc = diffuseColor.rgb;
  rkRough = 0.9; rkAO = 1.0; rkBump = vec3(0.0); rkEmit = vec3(0.0);
  float turf = smoothstep(-1.5, -1.05, p.y);          // the meadow and its turf lip (rim at y = 0)
  float soilW = smoothstep(-3.55, -2.95, p.y);        // the band of soil under the turf
  vec2 bw = No.xz * No.xz; bw *= bw; bw /= max(bw.x + bw.y, 1e-5);   // biplanar: faces toward x / z
  vec3 rock = vec3(0.3);
  vec3 mead = vec3(0.1);
  if (turf < 1.0) {
    // ---- rock: bedded strata carried by the geometry, each bed a shade and a character apart
    float bid = floor(vStrat), bfr = vStrat - bid;
    vec3 lay = mix(rkLayer(bid), rkLayer(bid + 1.0), smoothstep(1.0 - clamp(fb * 1.5, 0.02, 0.5), 1.0, bfr));
    lay = mix(lay, RK_AVG, smoothstep(0.3, 0.8, fb));
    rock = lay * vc;
    float lam = vnoise(vec2(vStrat * 11.0, bid * 3.1));
    rock *= mix(1.0, 0.9 + 0.2 * lam, 1.0 - smoothstep(0.02, 0.09, fb));            // laminae
    rock *= 1.0 - 0.3 * filteredPulse(vStrat + 0.02, 1.0, 0.04, fb);                  // parting planes
    // vertical joints, spaced bed by bed; faces toward x read z, faces toward z read x
    float jP = 2.6 + 4.0 * hash11(bid * 3.7 + 1.3);
    float jO = hash11(bid * 5.1 + 2.9) * 17.0;
    float joint = (filteredPulse(p.z + jO, jP, 0.05, fwZ) * bw.x + filteredPulse(p.x + jO, jP, 0.05, fwX) * bw.y) * (1.0 - up * up);
    float blkX = hash12(vec2(floor((p.z + jO) / jP), bid)), blkZ = hash12(vec2(floor((p.x + jO) / jP), bid + 0.5));
    float dB = 1.0 - smoothstep(jP * 0.1, jP * 0.3, fw);
    rock *= mix(1.0, 0.9 + 0.2 * (blkX * bw.x + blkZ * bw.y), dB);
    rock *= 1.0 - 0.45 * joint;
    rkBump += (vec3(0.0, 0.0, blkX - 0.5) * bw.x + vec3(blkZ - 0.5, 0.0, 0.0) * bw.y) * 0.22 * dB;
    // seeps and rain tracks down the faces, glossier while wet; the alcove behind the fall
    float stX = vnoise(vec2(p.z * 0.35 + 3.0, p.y * 0.018)), stZ = vnoise(vec2(p.x * 0.35 - 5.0, p.y * 0.018));
    float stain = mix(0.18, smoothstep(0.58, 0.82, stX * bw.x + stZ * bw.y), 1.0 - smoothstep(1.5, 5.0, fw)) * (1.0 - max(up, 0.0));
    float wet = clamp(vSurf.w, 0.0, 1.0) * (1.0 - soilW);
    rock *= 1.0 - 0.35 * stain - 0.3 * wet;
    rkRough = mix(0.92, 0.55, max(stain * 0.5, wet));
    // blotches (3D, so nothing streaks round a face)
    float blot = mix(0.5, vnoise3(p * 0.08), dM) * 0.6 + mix(0.5, vnoise3(p * 0.33 + 5.0), d1) * 0.4;
    rock *= 0.86 + 0.28 * blot;
    // micro relief
    if (d2 > 0.0) {
      vec3 nX = vnoised(vec2(p.z, p.y) * 2.1), nZ = vnoised(vec2(p.x, p.y) * 2.1 + 7.0);
      rkBump += (vec3(0.0, nX.z, nX.y) * bw.x + vec3(nZ.y, nZ.z, 0.0) * bw.y) * 0.12 * d2;
    }
    // moss on the ledges and in the damp upper reaches; lichen on the dry faces
    float mossN = mix(0.5, vnoise3(p * 0.11), dM) * 0.6 + mix(0.5, vnoise3(p * 0.7 + 3.0), d1) * 0.4;
    float moss = smoothstep(0.22, 0.55, up + 0.3 * (mossN - 0.5)) + (smoothstep(-26.0, -5.0, p.y) + wet) * mix(0.25, smoothstep(0.5, 0.72, mossN), dM) * 0.6;
    moss = clamp(moss, 0.0, 1.0);
    vec3 mossC = mix(vec3(0.05, 0.1, 0.03), vec3(0.15, 0.22, 0.07), mossN) * (0.8 + 0.4 * mix(0.5, vnoise3(p * 3.1), d2));
    float lichen = mix(0.1, smoothstep(0.7, 0.84, vnoise3(p * 0.5 + 9.0)), 1.0 - smoothstep(0.7, 2.2, fw)) * (1.0 - moss) * (1.0 - stain);
    rock = mix(rock, vec3(0.5, 0.49, 0.42), lichen * 0.2);
    rock = mix(rock, mossC, moss * 0.85);
    rkRough = mix(rkRough, 0.95, moss);
    rkAO = 1.0 - 0.35 * joint * d1 - 0.12 * stain;
    // ---- the soil band: dark loam with pebbles; roots hang from it over the top of the rock
    float grit = mix(0.5, vnoise3(p * 3.7), d2);
    vec3 soilC = mix(vec3(0.085, 0.062, 0.043), vec3(0.16, 0.115, 0.078), vnoise3(p * 0.6)) * (0.85 + 0.3 * grit);
    float hX = p.z + vnoise(vec2(p.z * 0.3, p.y * 0.4)) * 0.8, hZ = p.x + vnoise(vec2(p.x * 0.3, p.y * 0.4) + 4.0) * 0.8;
    float strand = filteredPulse(hX, 0.9, 0.08, fwZ) * bw.x + filteredPulse(hZ, 0.9, 0.08, fwX) * bw.y;
    float rootLen = 1.5 + 7.0 * (hash11(floor(hX / 0.9) * 0.37) * bw.x + hash11(floor(hZ / 0.9) * 0.53) * bw.y);
    float roots = strand * (1.0 - smoothstep(rootLen * 0.6, rootLen, -2.6 - p.y)) * (1.0 - smoothstep(0.1, 0.5, up)) * mix(0.35, smoothstep(0.4, 0.65, vnoise(vec2(p.x + p.z, 3.0) * 0.08)), dM);
    rock = mix(rock, vec3(0.13, 0.095, 0.065), roots * 0.6 * (1.0 - soilW));
    rock = mix(rock, mix(soilC, vec3(0.12, 0.09, 0.06), roots * 0.5), soilW);
    rkRough = mix(rkRough, 0.95, soilW);
    rkAO *= 1.0 - 0.15 * soilW;
  }
  if (turf > 0.0) {
    // ---- meadow: lawn and wildflowers
    vec2 q = p.xz;
    float lush = fbm2_3(q * 0.035 + 11.0);
    vec3 grass = mix(vec3(0.07, 0.15, 0.035), vec3(0.15, 0.24, 0.065), lush) * (0.88 + 0.24 * mix(0.5, vnoise(q * 0.4), d1));
    grass = mix(grass, grass * vec3(1.25, 1.1, 0.8), mix(0.2, smoothstep(0.58, 0.8, vnoise(q * 0.06 + 9.0)), 1.0 - smoothstep(4.0, 12.0, fw)) * 0.4);
    if (d2 > 0.0) {
      float blade = vnoise(q * vec2(29.0, 7.0)) * 0.5 + vnoise(q * vec2(8.0, 31.0)) * 0.5;
      grass *= mix(1.0, 0.8 + 0.4 * blade, 1.0 - smoothstep(0.004, 0.03, fw));
      rkBump += vec3(vnoised(q * 4.0).y, 0.0, vnoised(q * 4.0 + 3.0).y) * 0.15 * d2 * turf;
    }
    float fk = hash12(floor(q / 5.0) + 7.0);
    float fl = smoothstep(0.62, 0.8, vnoise(q * 1.7 + fk * 20.0)) * step(0.45, fk);
    grass = mix(grass, flFlower(fk) * 0.8, fl * mix(0.2, 0.7, d1));
    // ---- flower parterres edged with clipped box
    float bedS = vSurf.z;
    float bed = smoothstep(-fS.z, fS.z, bedS);
    float hedge = bed * (1.0 - smoothstep(0.5 - fS.z, 0.5 + fS.z, bedS));
    vec3 flC = flFlower(hash11(floor(vSurf.w) * 1.37 + 0.5));
    float heads = mix(0.5, smoothstep(0.42, 0.68, vnoise(q * 4.5 + floor(vSurf.w) * 7.0)), 1.0 - smoothstep(0.08, 0.4, fw));
    vec3 bedC = mix(vec3(0.05, 0.11, 0.03), flC * 0.85, heads * 0.85);
    vec3 hedgeC = vec3(0.035, 0.085, 0.025) * (0.85 + 0.3 * mix(0.5, vnoise(q * 6.0), d2));
    // ---- gravel walks with a stone kerb along each edge
    float dW = min(vSurf.x, vSurf.y);
    float fW = vSurf.x < vSurf.y ? fS.x : fS.y;
    float walk = 1.0 - smoothstep(-fW, fW, dW);
    vec3 grav = vec3(0.5, 0.46, 0.38) * (0.9 + 0.2 * mix(0.5, vnoise(q * 7.0), d2)) * (0.94 + 0.12 * mix(0.5, vnoise(q * 0.9), d1));
    float kerb = aaLine(dW + 0.15, 0.15, fW) * walk;
    mead = grass;
    mead = mix(mead, bedC, bed);
    mead = mix(mead, hedgeC, hedge);
    mead = mix(mead, grav, walk);
    mead = mix(mead, vec3(0.62, 0.6, 0.55), kerb);
    if (d2 > 0.0) rkBump += vec3(vnoised(q * 9.0).y, 0.0, vnoised(q * 9.0 + 5.0).y) * 0.08 * d2 * walk * turf;
    float mr = mix(mix(0.9, 0.82, hedge), 0.75, walk);
    rkRough = mix(rkRough, mr, turf);
    rkAO = mix(rkAO, 1.0 - 0.25 * hedge - 0.15 * bed * (1.0 - hedge), turf);
    // path lights along the walk edges at night (energy-conserving: they spread and dim with range)
    if (uCityLights > 0.01) {
      float R = length(q);
      float lS = mod(R, 8.0) - 4.0, lR = mod(atan(q.y, q.x) * R, 9.0) - 4.5;
      float eS = vSurf.x - 0.45, eR = vSurf.y - 0.45;
      float s2 = 0.018 + fw * fw;
      float lamp = exp(-(lS * lS + eS * eS) / s2) * step(vSurf.x, vSurf.y) + exp(-(lR * lR + eR * eR) / s2) * step(vSurf.y, vSurf.x);
      rkEmit += vec3(1.0, 0.78, 0.5) * lamp * (0.018 / s2) * uCityLights * 5.0 * turf;
    }
  }
  diffuseColor.rgb = mix(rock, mead, turf);
}`,
      surface: 'roughnessFactor = rkRough;',
      normal: /* glsl */ `
{
  vec3 rz = cross(vRotX, vec3(0.0, 1.0, 0.0));
  vec3 wb = rkBump.x * vRotX + vec3(0.0, rkBump.y, 0.0) + rkBump.z * rz;
  vec3 Nw = vWNrm / max(length(vWNrm), 1e-6);
  wb -= Nw * dot(wb, Nw);
  normal = normalize(normal + (viewMatrix * vec4(wb, 0.0)).xyz);
}`,
      // fill light in the rock's shade is not only sky: it has bounced off warm rock and meadow
      lights: 'reflectedLight.indirectDiffuse *= rkAO * vec3(1.1, 1.0, 0.86); reflectedLight.indirectSpecular *= rkAO;',
      emissive: 'totalEmissiveRadiance += rkEmit;',
    },
  });
}

// diamagnetic crystal: pale and glassy, with a faint glow that breathes along the lattice
function crystalMaterial() {
  return patchedMaterial({ color: 0xbfe3f5, roughness: 0.18, metalness: 0.05, envMapIntensity: 1.25 }, {
    key: 'floatcrystal1',
    vertex: { pars: 'attribute vec2 aCry; varying vec2 vCry;', transform: 'vCry = aCry;' },
    fragment: {
      pars: 'varying vec2 vCry;',
      color: 'diffuseColor.rgb *= 0.86 + 0.14 * vCry.y;',
      emissive: /* glsl */ `
{
  float fres = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
  float breathe = 0.7 + 0.3 * sin(uTime * 0.5 - vCry.x * 0.035);
  totalEmissiveRadiance += vec3(0.35, 0.78, 1.0) * vCry.y * breathe * (0.35 + 0.65 * fres * fres) * (0.03 + 0.42 * uCityLights);
}`,
    },
  });
}

// pool and rill water: ripples carried down the rill, white water at the brink of the spout
function waterMaterial() {
  return patchedMaterial({ color: 0x1b4550, roughness: 0.16, metalness: 0, envMapIntensity: 1.0 }, {
    key: 'floatwater1',
    vertex: {
      pars: 'attribute vec4 aFlow; varying vec4 vFlow; varying vec3 vRotX;',
      transform: 'vFlow = aFlow;',
      main: 'vRotX = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));',
    },
    fragment: {
      pars: 'varying vec4 vFlow; varying vec3 vRotX; vec3 wBump; float wFoam;',
      color: /* glsl */ `
{
  vec2 dir = vFlow.xy / max(length(vFlow.xy), 1e-4);
  vec2 q = vObjPos.xz;
  float al = dot(q, dir), ac = dot(q, vec2(-dir.y, dir.x));
  float fw = max(length(fwidth(q)), 1e-3);
  float dd = 1.0 - smoothstep(0.08, 0.5, fw);
  float sp = vFlow.z;
  vec2 c1 = vec2(al * 0.9 - uTime * (0.25 + 1.6 * sp), ac * 1.6);
  vec2 c2 = vec2(al * 2.3 - uTime * (0.4 + 2.4 * sp) + 3.0, ac * 3.1 + uTime * 0.2 * (1.0 - sp));
  vec3 r1 = vnoised(c1), r2 = vnoised(c2);
  vec2 g = (vec2(r1.y, r1.z) * vec2(0.9, 1.6) * 0.5 + vec2(r2.y, r2.z) * vec2(2.3, 3.1) * 0.2) * dd * 0.35;
  wBump = vec3(dir.x * g.x - dir.y * g.y, 0.0, dir.y * g.x + dir.x * g.y);
  wFoam = vFlow.w * mix(0.5, smoothstep(0.35, 0.75, r2.x * 0.6 + r1.x * 0.4), dd);
  vec3 wc = mix(vec3(0.03, 0.16, 0.19), vec3(0.08, 0.3, 0.33), r1.x * dd + 0.5 * (1.0 - dd));
  diffuseColor.rgb = mix(wc, vec3(0.8, 0.86, 0.88), wFoam * 0.8);
}`,
      surface: 'roughnessFactor = mix(0.16, 0.55, wFoam);',
      normal: /* glsl */ `
{
  vec3 rz = cross(vRotX, vec3(0.0, 1.0, 0.0));
  vec3 wb = wBump.x * vRotX + wBump.z * rz;
  normal = normalize(normal + (viewMatrix * vec4(wb, 0.0)).xyz);
}`,
      lights: 'reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(mix(6.0, 0.3, uNight)));',
    },
  });
}

const FALL_VERT = /* glsl */ `
attribute vec4 aFall;
varying vec4 vF; varying vec3 vW; varying vec3 vNw;
void main() {
  vF = aFall;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vNw = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
// the sheet: streaks ride down at the water's own speed (the pattern runs in fall time), the
// sheet aerates, frays and thins out into the mist; seen edge-on it is denser
const FALL_FRAG = /* glsl */ `
varying vec4 vF; varying vec3 vW; varying vec3 vNw;
void main() {
  float h = vF.x, tau = vF.y, s = vF.z, v = vF.w;
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = vNw / max(length(vNw), 1e-5);
  float edgeOn = 1.0 - abs(dot(N, V));
  float fx = s * (3.0 + 0.05 * h);
  float fwx = max(fwidth(fx), 1e-4), fwt = max(fwidth(tau), 1e-4);
  float st1 = mix(0.5, vnoise(vec2(fx * 1.3, (tau - uTime) * 2.2)), 1.0 - smoothstep(0.3, 1.0, max(fwx * 1.3, fwt * 2.2)));
  float st2 = mix(0.5, vnoise(vec2(fx * 3.1 + 7.0, (tau - uTime) * 4.7)), 1.0 - smoothstep(0.3, 1.0, max(fwx * 3.1, fwt * 4.7)));
  float streak = st1 * 0.6 + st2 * 0.4;
  float core = 1.0 - smoothstep(0.55, 1.0, abs(s));
  float aer = smoothstep(0.05, 0.6, v);
  float body = 1.0 - smoothstep(0.45, 1.0, v);
  float a = core * body * mix(0.55 + 0.45 * streak, smoothstep(0.3, 0.8, streak), aer) * (0.55 + 0.45 * edgeOn);
  a = clamp(a, 0.0, 0.9);
  vec3 light = uSunColor * uSunIlluminance * max(uSunDir.y, 0.05) * 0.3 + aerialInscatter(vec3(0.0, 1.0, 0.0)) * 0.6;
  vec3 col = mix(vec3(0.62, 0.78, 0.86), vec3(0.92, 0.95, 1.0), aer * 0.8 + 0.2 * streak) * light;
  col += vec3(0.4, 0.8, 1.0) * uCityLights * 0.05;
  col = applyAerial(col, vW);
  gl_FragColor = vec4(col * a, a * 0.9);
}`;

const MIST_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
attribute vec4 aM;
attribute vec4 aM2;
varying float vA; varying vec3 vW; varying vec2 vC;
void main() {
  float t = fract(uTime * 0.035 + aM.w);
  vec3 p = aM.xyz;
  vec3 wind = transpose(mat3(modelMatrix)) * vec3(uWind.x, 0.0, uWind.y);
  p.xz += aM2.xy * (3.0 + 20.0 * t) + wind.xz * 16.0 * t;
  p.xz += vec2(sin(aM.w * 40.0 + uTime * 0.21), cos(aM.w * 31.0 + uTime * 0.17)) * (1.5 + 8.0 * t);
  p.y -= aM2.z * 0.3 * t;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  mv.xy += position.xy * aM2.w * (0.55 + 1.1 * t);
  vC = position.xy;
  gl_Position = projectionMatrix * mv;
  vA = smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.55, 1.0, t)) * 0.12;
}`;
const MIST_FRAG = /* glsl */ `
varying float vA; varying vec3 vW; varying vec2 vC;
void main() {
  float d2 = dot(vC, vC) * 4.0;
  float a = exp(-d2 * 3.2) * (1.0 - smoothstep(0.75, 1.0, d2)) * vA;
  if (a < 0.002) discard;
  vec3 light = uSunColor * uSunIlluminance * max(uSunDir.y, 0.05) * 0.25 + aerialInscatter(vec3(0.0, 1.0, 0.0)) * 0.7;
  vec3 col = applyAerial(vec3(0.9, 0.94, 1.0) * light, vW);
  gl_FragColor = vec4(col * a, a * 0.7);
}`;

// ------------------------------------------------------------------------------ the trees --
// Trees rooted on the meadow (y is the meadow under the trunk; the root flare runs on below
// ground), clear of walks, beds, water and stonework, crowns inside the rim.
function plantTrees(P) {
  const rnd = mulberry32(P.seed * 97 + 11);
  const trees = [];
  const crownR = (sp, s) => s * SPECIES[sp].shape[2] * 0.55;
  const ok = (x, z, cr) => {
    const R = Math.hypot(x, z), re = P.Re(Math.atan2(z, x));
    if (R + cr + 2.5 > re * 0.985) return false;                     // crown inside the rim
    if (R < P.Rplo + 4 + cr * 0.6) return false;                     // clear of the pavilion roof
    if (P.spokeD(x, z) < 1.2 || P.ringD(x, z) < 1.2) return false;   // off the walks
    if (P.bedD(x, z) > -0.8) return false;                           // out of the parterres
    if (P.troughD(x, z) < 2.2 + cr * 0.25) return false;             // clear of the pool and rill
    for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < 0.55 * (t.cr + cr)) return false;
    return true;
  };
  const add = (x, z, s, sp) => {
    const cr = crownR(sp, s);
    if (!ok(x, z, cr)) return;
    trees.push({ x, y: P.H(x, z) - 0.15, z, s, sp, cr, rot: rnd() * TAU, tint: [0.9 + rnd() * 0.2, 0.9 + rnd() * 0.25, 0.85 + rnd() * 0.2] });
  };
  // allées of flowering trees along the walks, beyond the parterres
  for (const w of P.spokes) {
    const off = P.hwS + 3.4;
    for (let a = P.Rb2 + 5; a < w.a1 - w.or - 4; a += 11.5 + rnd() * 1.5) {
      for (const side of [-1, 1]) add(w.c * a - w.s * off * side, w.s * a + w.c * off * side, 8 + rnd() * 2, 3);
    }
  }
  // tree ferns along the rill
  for (let s = P.s1 + 8; s < P.sRim - 10; s += 9 + rnd() * 4) {
    const side = rnd() < 0.5 ? -1 : 1, l = side * (P.hwRo + 3.2 + rnd() * 1.5);
    add(P.uf[0] * s - P.uf[1] * l, P.uf[1] * s + P.uf[0] * l, 5 + rnd() * 2, 5);
  }
  // groves in the outer garden: rain trees, broadleaf and flowering trees, in clumps
  const tries = Math.floor(P.r * P.r * 0.03);
  for (let k = 0; k < tries; k++) {
    const a = rnd() * TAU, R = P.Re(a) * (0.42 + 0.56 * Math.sqrt(rnd()));
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    const clump = n2(x / 45 + P.seed * 3.1, z / 45);
    if (clump < -0.05 + 0.25 * rnd()) continue;
    const u = rnd();
    const sp = u < 0.35 ? 2 : u < 0.7 ? 1 : 3;
    add(x, z, sp === 2 ? 10 + rnd() * 5 : sp === 1 ? 11 + rnd() * 6 : 8 + rnd() * 3, sp);
  }
  for (const t of trees) delete t.cr;
  return trees;
}

// ------------------------------------------------------------------------------ assembly --
export function buildFloatingIslands(defs, scene, treeField) {
  const rockMat = rockMaterial();
  const cryMat = crystalMaterial();
  const waterMat = waterMaterial();
  const fallMat = aerialShaderMaterial({ vertexShader: FALL_VERT, fragmentShader: FALL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const mistMat = aerialShaderMaterial({ vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const pavMat = createFacadeMaterial('pearl', 300, { litFrac: 0.8 });
  const islands = [];
  const treeLists = [];
  for (const d of defs) {
    const rnd = mulberry32(d.seed * 97);
    const P = islandPlan(d);
    const group = new THREE.Group();
    group.name = `Floating garden ${islands.length}`;
    group.position.set(d.x, d.y, d.z);
    group.rotation.y = rnd() * Math.PI * 2;
    scene.add(group);
    const garden = buildGarden(P);
    const lattice = buildLattice(P);
    // levels of detail: the near body, lattice and small stonework; the far body and the
    // crystal nodes (same massing) beyond
    const lod = new THREE.LOD();
    const nearG = new THREE.Group(), farG = new THREE.Group();
    const bodyN = new THREE.Mesh(buildBody(P, true), rockMat);
    const bodyF = new THREE.Mesh(buildBody(P, false), rockMat);
    const latN = new THREE.Mesh(lattice.near, cryMat), latF = new THREE.Mesh(lattice.far, cryMat);
    const hardN = new THREE.Mesh(garden.near, pavMat);
    for (const m of [bodyN, bodyF, latN, latF, hardN]) { m.castShadow = true; m.receiveShadow = true; }
    nearG.add(bodyN, latN, hardN);
    farG.add(bodyF, latF);
    lod.addLevel(nearG, 0, 0.08);
    lod.addLevel(farG, 1500 + 4.5 * d.r, 0.08);
    group.add(lod);
    const hard = new THREE.Mesh(garden.always, pavMat);
    hard.castShadow = true; hard.receiveShadow = true;
    const water = new THREE.Mesh(buildWater(P), waterMat);
    water.receiveShadow = true;
    const fall = new THREE.Mesh(buildFall(P), fallMat);
    fall.renderOrder = 2;
    const mist = new THREE.Mesh(buildMist(P), mistMat);
    mist.frustumCulled = false;
    mist.renderOrder = 3;
    group.add(hard, water, fall, mist);
    const trees = plantTrees(P);
    treeLists.push({ group, trees });
    const bottom = Math.min(lattice.bottom, P.yApex);
    islands.push({ group, def: d, base: group.position.clone(), phase: rnd() * 10, depth: -bottom, radius: P.r * P.eMax + 2.6, top: Math.max(P.roofTop, P.Ht + 20), lod, plan: P });
  }
  return {
    islands,
    treeLists,
    update(dt, t) {
      for (const i of islands) {
        i.group.position.y = i.base.y + Math.sin(t * 0.25 + i.phase) * 2.5;
        i.group.rotation.y += dt * 0.004;
      }
    },
  };
}
