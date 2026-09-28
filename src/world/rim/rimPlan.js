import { surveyRim, aOf, kOf, at, polar } from './rimFrame.js';
import { RIM_TOWNS, RIM_COUNTRY, RIM_LIDOS, QUARTERS } from './rimTowns.js';
import { rimLotSize } from './rimLots.js';
import { mulberry32 } from '../noise.js';

// The plan of the Rim, laid in its own frame (rimFrame.js) before the city plan is baked.
//
// Rim Way runs the whole length of each run of land on the rim's spine, a tree-lined avenue that
// swings round each arcology's forecourt in a circus on whichever side leaves more land, keeps
// inside the ward bridgeheads (an approach street leads out to each) and ends at a turning
// square at every channel. The lagoon strand is a continuous promenade on the 3.4 m contour
// (an esplanade with an arcaded frontage in the towns, a palm walk in the country); the sea side
// has a parade on the 4.4 m contour in the towns and a dune walk in the country.
// The ten towns are planned towns in the frame: streets that run with Rim Way every 70-96 m
// (by quarter), streets and lanes that cross the rim from the strand to the parade every 62-80 m,
// so every block is a perimeter block round a garden court; a market square on Rim Way and a
// harbour square on the strand at each town's centre. Between the towns the country is divided
// by lanes (strand to parade, every ~320 m) into parcels on either side of Rim Way, each laid
// out as what its ground and its stretch want (rimSites.js builds them).
// Everything here is plain data (streets, squares, parcels); urban.js takes the streets and
// squares through its usual clipping, so lots, lamps, trees, verges and people follow.

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
export const RIM_LEVEL = { strand: 3.4, parade: 4.4 };
export const RIM_HW = { rimWay: 9, strandTown: 6.5, strandCountry: 4.2, paradeTown: 5, dune: 2.6, street: 5, lane: 3 };
const CLS = { LANE: 1, STREET: 2, AVENUE: 3, ESPLANADE: 4 };
const R_MEAN = 5900;

const wrap = (a) => ((a % TAU) + TAU) % TAU;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const plen = (P) => { let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return L; };

/** Split a polyline into the runs of points that pass ok(x, z, i); runs shorter than minLen dropped. */
function splitBy(P, ok, minLen) {
  const out = [];
  let cur = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (ok(p[0], p[1], i)) cur.push(p);
    else { if (cur.length > 1 && plen(cur) >= minLen) out.push(cur); cur = []; }
  }
  if (cur.length > 1 && plen(cur) >= minLen) out.push(cur);
  return out;
}

/** Resample a polyline at a fixed step (keeps both ends). */
export function resample(P, step) {
  if (P.length < 2) return P.slice();
  const out = [P[0]];
  let acc = 0;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9) continue;
    let t = step - acc;
    while (t <= L) { out.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]); t += step; }
    acc = L - (t - step);
  }
  const last = P[P.length - 1], q = out[out.length - 1];
  if (Math.hypot(last[0] - q[0], last[1] - q[1]) > step * 0.35) out.push(last); else out[out.length - 1] = last;
  return out;
}

/** Nearest-distance queries against a set of polylines (a 48 m segment grid). */
export class PolyIndex {
  constructor(lines, G = 48) {
    this.G = G; this.cells = new Map();
    for (const P of lines) for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      for (let gi = Math.floor(Math.min(a[0], b[0]) / G); gi <= Math.floor(Math.max(a[0], b[0]) / G); gi++)
        for (let gj = Math.floor(Math.min(a[1], b[1]) / G); gj <= Math.floor(Math.max(a[1], b[1]) / G); gj++) {
          const k = gi * 100003 + gj;
          if (!this.cells.has(k)) this.cells.set(k, []);
          this.cells.get(k).push([a[0], a[1], b[0], b[1]]);
        }
    }
  }
  dist(x, z, reach = 96) {
    const G = this.G, n = Math.ceil(reach / G);
    let best = reach;
    const gi = Math.floor(x / G), gj = Math.floor(z / G);
    for (let i = gi - n; i <= gi + n; i++) for (let j = gj - n; j <= gj + n; j++) {
      const l = this.cells.get(i * 100003 + j);
      if (l) for (const [ax, az, bx, bz] of l) {
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
        let t = ((x - ax) * dx + (z - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
        if (d < best) best = d;
      }
    }
    return best;
  }
}

/** Gaussian smoothing of arr over run r (bins k0..k1, indices mod N), NaN left as holes. */
function smoothRun(arr, run, N, sigma) {
  const out = Float32Array.from(arr);
  const w = Math.ceil(sigma * 2.5);
  for (let k = run.k0; k <= run.k1; k++) {
    const q = k % N;
    if (Number.isNaN(arr[q])) continue;
    let s = 0, n = 0;
    for (let d = -w; d <= w; d++) {
      const kk = k + d;
      if (kk < run.k0 || kk > run.k1) continue;
      const v = arr[kk % N];
      if (Number.isNaN(v)) continue;
      const g = Math.exp(-(d * d) / (2 * sigma * sigma));
      s += v * g; n += g;
    }
    out[q] = s / n;
  }
  return out;
}

/**
 * Plan the rim. ground(x, z) = the terrain the city is planned on; towers = the rim arcologies
 * as { x, z, base } (base = town core, as planCity excludes it); heads = the ward bridgeheads
 * (metro.js: x, z, u, side, hw, hd); gateFeet = [{ x, z, r }].
 * Returns { streets: [{ pts, cls, hw, name, ... }], squares, parcels, frame, ... }.
 */
export function planRim({ ground, towers, heads, gateFeet }) {
  const F = surveyRim(ground);
  const N = F.N;
  const rnd = mulberry32(5490);
  const streets = [], squares = [], debug = [];

  // ---- what stands on the rim already: the arcologies' forecourts (their paved squares reach
  // base + 33), the bridgehead podiums, the Gate's feet
  const T = towers.map((t) => ({ ...t, RT: t.base + 17, RS: t.base + 33 }));
  const boxD = (h, x, z) => {
    const dx = x - h.x, dz = z - h.z;
    const qx = Math.abs(dx * h.u[0] + dz * h.u[1]) - h.hw, qz = Math.abs(dx * h.side[0] + dz * h.side[1]) - h.hd;
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  };
  /** Signed metres from (x, z) to the nearest keep-out (a forecourt square, a podium, a Gate foot). */
  const block = (x, z) => {
    let d = 1e9;
    for (const t of T) { const e = Math.hypot(x - t.x, z - t.z) - t.RS; if (e < d) d = e; }
    for (const h of heads) { const e = boxD(h, x, z); if (e < d) d = e; }
    for (const g of gateFeet) { const e = Math.hypot(x - g.x, z - g.z) - g.r; if (e < d) d = e; }
    return d;
  };

  // ---- the contours the shore walks follow
  const rS = new Float32Array(N).fill(NaN), rP = new Float32Array(N).fill(NaN);
  const refine = (c, s, lo, hi, level) => { for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (ground(c * m, s * m) >= level) hi = m; else lo = m; } return (lo + hi) / 2; };
  for (const run of F.runs) for (let k = run.k0; k <= run.k1; k++) {
    const q = k % N, a = aOf(k), c = Math.cos(a), s = Math.sin(a);
    for (let r = F.rIn[q]; r < F.spine[q] - 20; r += 2) if (ground(c * r, s * r) >= RIM_LEVEL.strand) { rS[q] = refine(c, s, r - 2, r, RIM_LEVEL.strand); break; }
    for (let r = F.rOut[q]; r > F.spine[q] + 20; r -= 2) if (ground(c * r, s * r) >= RIM_LEVEL.parade) { rP[q] = refine(c, s, r + 2, r, RIM_LEVEL.parade); break; }
  }
  let rSs = rS, rPs = rP;
  for (const run of F.runs) { rSs = smoothRun(rSs, run, N, 3); rPs = smoothRun(rPs, run, N, 3); }

  // ---- Rim Way: a radius for every bearing of each run, pushed off the keep-outs
  const rw = new Float32Array(N).fill(NaN);
  const obst = [
    ...T.map((t) => ({ x: t.x, z: t.z, K: t.RS + RIM_HW.rimWay + 5, t })),
    ...heads.map((h) => ({ x: h.x, z: h.z, K: Math.hypot(h.hw, h.hd) + RIM_HW.rimWay + 6, h })),
    ...gateFeet.map((g) => ({ x: g.x, z: g.z, K: g.r + RIM_HW.rimWay + 40, gate: true })),
  ];
  const cut = (o, a) => {
    // where the ray at bearing a enters and leaves the circle (radii), or null
    const c = Math.cos(a), s = Math.sin(a), b = c * o.x + s * o.z, cc = o.x * o.x + o.z * o.z - o.K * o.K, disc = b * b - cc;
    if (disc <= 0) return null;
    const sq = Math.sqrt(disc);
    return [b - sq, b + sq];
  };
  const runWays = [];
  for (const [ri, run] of F.runs.entries()) {
    const own = obst.filter((o) => { const p = polar(o.x, o.z); const k = kOf(p.a); return [k, k + N, k - N].some((kk) => kk >= run.k0 - 60 && kk <= run.k1 + 60); });
    for (const o of own) {
      // pass on the side with more land: the least room between the circle and the shore
      let mIn = 1e9, mOut = 1e9;
      for (let k = run.k0; k <= run.k1; k++) {
        const q = k % N, cr = cut(o, aOf(k));
        if (!cr) continue;
        mIn = Math.min(mIn, cr[0] - F.rIn[q]); mOut = Math.min(mOut, F.rOut[q] - cr[1]);
      }
      o.side = o.gate ? 0 : mIn >= mOut ? -1 : 1;
      o.room = o.side < 0 ? mIn : mOut;
    }
    const clamp = (k, r) => {
      const a = aOf(k);
      for (const o of own) {
        if (!o.side) continue;
        const cr = cut(o, a);
        if (!cr) continue;
        if (o.side < 0 && r > cr[0]) r = cr[0];
        if (o.side > 0 && r < cr[1]) r = cr[1];
      }
      return r;
    };
    for (let k = run.k0; k <= run.k1; k++) rw[k % N] = clamp(k, F.spine[k % N]);
    for (let it = 0; it < 90; it++) {
      const sm = smoothRun(rw, run, N, 2.2);
      for (let k = run.k0; k <= run.k1; k++) rw[k % N] = clamp(k, sm[k % N]);
    }
    // the ends: where the land is still 240 m across and dry, clear of the Gate's feet
    const good = (k) => {
      const q = ((k % N) + N) % N, [x, z] = at(aOf(k), rw[q]);
      return F.rOut[q] - F.rIn[q] > 240 && ground(x, z) > 4 && gateFeet.every((g) => Math.hypot(x - g.x, z - g.z) > g.r + 60) && rw[q] - F.rIn[q] > 60 && F.rOut[q] - rw[q] > 60;
    };
    let e0 = run.k0, e1 = run.k1;
    while (e0 < e1 && !good(e0)) e0++;
    while (e1 > e0 && !good(e1)) e1--;
    const pts = [];
    for (let k = e0; k <= e1; k++) {
      const q = k % N, p = at(aOf(k), rw[q]);
      if (pts.length) {
        // densify where the circus bends the way off the bearing grid
        const l = pts[pts.length - 1], d = Math.hypot(p[0] - l[0], p[1] - l[1]);
        if (d > 10) {
          const n = Math.ceil(d / 8), rq = rw[(k - 1) % N];
          for (let i = 1; i < n; i++) { const t = i / n; pts.push(at(aOf(k - 1 + t), rq + (rw[q] - rq) * t)); }
        }
      }
      pts.push(p);
    }
    runWays.push({ run: ri, k0: e0, k1: e1, pts, own });
  }
  const rimWayIdx = new PolyIndex(runWays.map((w) => w.pts));
  const inRange = (k, w) => k >= w.k0 && k <= w.k1;
  /** Rim Way's radius at bearing a (null off the way). */
  const rimWayR = (a) => {
    const k = kOf(a);
    for (const w of runWays) for (const kk of [k, k + N]) if (inRange(kk, w)) { const f = Math.floor(kk), t = kk - f; return rw[f % N] * (1 - t) + rw[(f + 1) % N] * t; }
    return null;
  };
  const sampleArr = (arr, a) => { const k = kOf(a), f = Math.floor(k), t = k - f, A = arr[f % N], B = arr[(f + 1) % N]; if (Number.isNaN(A) || Number.isNaN(B)) return NaN; return A * (1 - t) + B * t; };

  // ---- towns: which town a bearing lies in
  const towns = RIM_TOWNS.map((t) => ({ ...t, a0r: t.a0 * D2R, a1r: t.a1 * D2R, cr: t.centre * D2R, Q: QUARTERS[t.quarter], streets: [], squares: [] }));
  const townAt = (a) => towns.find((t) => wrap(a - t.a0r) <= wrap(t.a1r - t.a0r)) || null;
  const quarterAt = (a) => {
    const t = townAt(a);
    if (t) return t.quarter;
    let best = null, bd = 1e9;
    for (const q of towns) { const d = Math.min(Math.abs(angDiff(a, q.a0r)), Math.abs(angDiff(a, q.a1r))); if (d < bd) { bd = d; best = q; } }
    return best ? best.quarter : 'harbour';
  };

  const pushStreet = (pts, cls, hw, props) => { const st = { pts, cls, hw, ...props }; st.lotSize = rimLotSize(st); streets.push(st); return st; };

  // ---- Rim Way itself, cut into its town and country stretches (lots stand only in the towns)
  for (const w of runWays) {
    let cur = null;
    for (const p of w.pts) {
      const t = townAt(polar(p[0], p[1]).a), key = t ? t.name : '';
      if (!cur || cur.key !== key) {
        const prev = cur;
        if (prev && prev.pts.length > 1) pushStreet(prev.pts, CLS.AVENUE, RIM_HW.rimWay, prev.props);
        cur = { key, pts: prev ? [prev.pts[prev.pts.length - 1]] : [], props: { name: 'Rim Way', role: 'rimWay', town: t ? t.name : null, quarter: quarterAt(polar(p[0], p[1]).a), noLots: !t } };
      }
      cur.pts.push(p);
    }
    if (cur && cur.pts.length > 1) pushStreet(cur.pts, CLS.AVENUE, RIM_HW.rimWay, cur.props);
  }

  // ---- the strand and the sea side walks
  const shoreWalk = (arr, side) => {
    const out = [];
    for (const w of runWays) {
      let cur = [];
      const flush = () => { if (cur.length > 4) out.push(cur); cur = []; };
      for (let k = w.k0 - 30; k <= w.k1 + 30; k++) {
        const q = ((k % N) + N) % N, v = arr[q];
        if (Number.isNaN(v) || k < F.runs[w.run].k0 + 4 || k > F.runs[w.run].k1 - 4) { flush(); continue; }
        cur.push(at(aOf(k), v));
      }
      flush();
    }
    // each piece at a 6 m step, kept on dry, walkable ground clear of every keep-out and of Rim Way
    const pieces = [];
    for (const P of out) {
      const R = resample(P, 6);
      for (const seg of splitBy(R, (x, z) => {
        const h = ground(x, z);
        const lv = side < 0 ? RIM_LEVEL.strand : RIM_LEVEL.parade;
        return h > 2.4 && h < lv + 5 && block(x, z) > 9 && rimWayIdx.dist(x, z) > RIM_HW.rimWay + 34;
      }, 80)) pieces.push(seg);
    }
    return pieces;
  };
  const strandPieces = shoreWalk(rSs, -1), seaPieces = shoreWalk(rPs, 1);
  // cut each piece into its town and country stretches (a town strand is an esplanade with an
  // arcaded frontage on its landward side; the country's a palm walk)
  const byTown = (P) => {
    const out = [];
    let cur = null;
    for (const p of P) {
      const t = townAt(polar(p[0], p[1]).a), key = t ? t.name : '';
      if (!cur || cur.key !== key) { const prev = cur; if (prev && prev.pts.length > 1) out.push(prev); cur = { key, town: t, pts: prev ? [prev.pts[prev.pts.length - 1]] : [] }; }
      cur.pts.push(p);
    }
    if (cur && cur.pts.length > 1) out.push(cur);
    return out;
  };
  const strands = [], parades = [];
  for (const P of strandPieces) for (const s of byTown(P)) {
    if (plen(s.pts) < 40) continue;
    const town = !!s.town;
    // polylines run with increasing bearing: side -1 of the lot loop is the seaward (landward) side
    strands.push(pushStreet(s.pts, CLS.ESPLANADE, town ? RIM_HW.strandTown : RIM_HW.strandCountry, { name: town ? `${s.town.name} Strand` : 'The Strand', role: 'strand', town: town ? s.town.name : null, quarter: quarterAt(polar(...s.pts[0]).a), noLots: !town, lotSides: [-1] }));
  }
  for (const P of seaPieces) for (const s of byTown(P)) {
    if (plen(s.pts) < 40) continue;
    const town = !!s.town;
    parades.push(pushStreet(s.pts, town ? CLS.ESPLANADE : CLS.LANE, town ? RIM_HW.paradeTown : RIM_HW.dune, { name: town ? `${s.town.name} Parade` : 'Dune Walk', role: town ? 'parade' : 'dune', town: town ? s.town.name : null, quarter: quarterAt(polar(...s.pts[0]).a), noLots: !town, lotSides: [1] }));
  }
  const strandIdx = new PolyIndex(strands.map((s) => s.pts)), paradeIdx = new PolyIndex(parades.map((s) => s.pts));
  const inRun = (a) => runWays.some((w) => { const k = kOf(a); return [k, k + N].some((kk) => kk >= F.runs[w.run].k0 && kk <= F.runs[w.run].k1); });

  /** The radial span a street crossing the rim at bearing a runs over: strand to parade. */
  const crossSpan = (a) => {
    const s = sampleArr(rSs, a), p = sampleArr(rPs, a), k = Math.round(kOf(a)) % N;
    return [Number.isNaN(s) ? F.rIn[k] + 26 : s, Number.isNaN(p) ? F.rOut[k] - 26 : p];
  };
  const radial = (a, r0, r1, step = 6) => { const P = []; const n = Math.max(2, Math.ceil((r1 - r0) / step)); for (let i = 0; i <= n; i++) P.push(at(a, r0 + ((r1 - r0) * i) / n)); return P; };

  // ---- the towns
  for (const town of towns) {
    const Q = town.Q, span = wrap(town.a1r - town.a0r);
    if (!inRun(town.cr)) continue;
    // the market square on Rim Way's lagoon side, the harbour square on the strand
    let market = null, harbour = null;
    for (const da of [0, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8, -8]) {
      const a = town.cr + (da * 22) / R_MEAN, r = rimWayR(a);
      if (r === null) continue;
      const R = town.quarter === 'garden' ? 30 : 26;
      for (const sgn of [-1, 1]) {
        const [x, z] = at(a, r + sgn * (RIM_HW.rimWay + R + 3));
        if (block(x, z) < R + 8 || ground(x, z) < 3.2) continue;
        let ok = true;
        for (let i = 0; i < 16 && ok; i++) { const t = (i / 16) * TAU; if (ground(x + Math.cos(t) * R, z + Math.sin(t) * R) < 2.8) ok = false; }
        if (ok) { market = { x, z, r: R, kind: 'civic', district: 'rim', town: town.name, role: 'market', a }; break; }
      }
      if (market) break;
    }
    for (const da of [0, 1, -1, 2, -2, 3, -3, 5, -5, 7, -7]) {
      const a = (market ? market.a : town.cr) + (da * 24) / R_MEAN, s = sampleArr(rSs, a);
      if (Number.isNaN(s)) continue;
      const R = 17, [x, z] = at(a, s + RIM_HW.strandTown + R + 2);
      if (block(x, z) < R + 8 || ground(x, z) < 2.8 || rimWayIdx.dist(x, z) < R + RIM_HW.rimWay + 30) continue;
      if (strandIdx.dist(x, z) > R + RIM_HW.strandTown + 6) continue;
      harbour = { x, z, r: R, kind: 'village', district: 'rim', town: town.name, role: 'harbour', a };
      break;
    }
    for (const q of [market, harbour]) if (q) { squares.push(q); town.squares.push(q); }
    town.market = market; town.harbour = harbour;
  }
  const townSquares = squares.slice();
  const inSq = (x, z, pad) => townSquares.some((q) => Math.hypot(x - q.x, z - q.z) < q.r + pad);

  for (const town of towns) {
    const Q = town.Q;
    if (!inRun(town.cr)) continue;
    // streets that run with Rim Way, every Q.long metres either side of its spine
    const k0 = Math.ceil(kOf(town.a0r)), k1f = kOf(town.a0r) + (wrap(town.a1r - town.a0r) / TAU) * N;
    for (const sgn of [-1, 1]) for (let m = 1; m <= 5; m++) {
      const v = sgn * m * Q.long, P = [];
      for (let k = k0; k <= k1f; k++) { const q = k % N; P.push(at(aOf(k), F.spine[q] + v)); }
      const R = resample(P, 7);
      const hw = RIM_HW.street;
      for (const seg of splitBy(R, (x, z) => {
        const h = ground(x, z);
        if (h < 2.8 || h > 58) return false;
        if (block(x, z) < hw + 4 || inSq(x, z, hw + 1)) return false;
        if (rimWayIdx.dist(x, z) < RIM_HW.rimWay + hw + 27) return false;
        if (sgn < 0 && strandIdx.dist(x, z) < RIM_HW.strandTown + hw + 27) return false;
        if (sgn > 0 && paradeIdx.dist(x, z) < RIM_HW.paradeTown + hw + 27) return false;
        const p = polar(x, z), q = Math.round(kOf(p.a)) % N;
        return p.r - F.rIn[q] > 34 && F.rOut[q] - p.r > 34;
      }, 90)) {
        const st = pushStreet(seg, CLS.STREET, hw, { name: `${town.name} ${sgn < 0 ? 'Lagoon' : 'Sea'} Row ${m}`, role: 'row', town: town.name, quarter: town.quarter });
        town.streets.push(st);
      }
    }
    // streets and lanes across the rim, the main one through the market square
    const span = wrap(town.a1r - town.a0r), step = Q.cross / R_MEAN;
    const c0 = town.market ? town.market.a : town.cr;
    for (let j = -Math.ceil(span / step); j <= Math.ceil(span / step); j++) {
      const a = c0 + j * step;
      if (wrap(a - town.a0r) > span || !inRun(a)) continue;
      const major = j % 2 === 0, hw = major ? RIM_HW.street : RIM_HW.lane;
      const [r0, r1] = crossSpan(a);
      if (r1 - r0 < 60) continue;
      const P = radial(a, r0, r1);
      for (const seg of splitBy(P, (x, z) => ground(x, z) > 2.5 && block(x, z) > hw + 3 && !inSq(x, z, -3), 34)) {
        const st = pushStreet(seg, major ? CLS.STREET : CLS.LANE, hw, { name: j === 0 ? `${town.name} High Street` : `${town.name} ${major ? 'Street' : 'Lane'} ${j < 0 ? 'W' : 'E'}${Math.abs(j)}`, role: j === 0 ? 'high' : major ? 'cross' : 'mews', town: town.name, quarter: town.quarter });
        town.streets.push(st);
      }
    }
  }

  // ---- approaches: from Rim Way to every arcology's forecourt and every bridgehead podium
  for (const t of T) {
    const p = polar(t.x, t.z), r = rimWayR(p.a);
    if (r === null) continue;
    const toWay = Math.sign(r - p.r) || 1;
    const P = radial(p.a, p.r, r);
    const P2 = toWay > 0 ? P : P;
    pushStreet(P2, CLS.STREET, RIM_HW.street, { name: 'Forecourt Approach', role: 'approach', town: townAt(p.a) ? townAt(p.a).name : null, quarter: quarterAt(p.a), noLots: true });
    // and down to the shore walk on the far side, where one passes
    const other = toWay > 0 ? sampleArr(rSs, p.a) : sampleArr(rPs, p.a);
    if (!Number.isNaN(other) && Math.abs(other - p.r) > t.RS + 10) {
      const Q2 = radial(p.a, p.r, other);
      if (Q2.every(([x, z]) => ground(x, z) > 2.2)) pushStreet(Q2, CLS.STREET, RIM_HW.street, { name: 'Forecourt Stair', role: 'approach', town: townAt(p.a) ? townAt(p.a).name : null, quarter: quarterAt(p.a), noLots: true });
    }
  }
  for (const h of heads) {
    const p = polar(h.x, h.z), r = rimWayR(p.a);
    if (r === null) continue;
    pushStreet(radial(p.a, r, p.r), CLS.STREET, RIM_HW.street, { name: `${h.ward ? h.ward[0].toUpperCase() + h.ward.slice(1) : 'Ward'} Bridge Approach`, role: 'approach', town: townAt(p.a) ? townAt(p.a).name : null, quarter: quarterAt(p.a), noLots: true });
  }

  // ---- the country: lanes across the rim every ~320 m, parcels between them either side of Rim Way
  const parcels = [], stretches = [];
  for (const C of RIM_COUNTRY) {
    for (const w of runWays) {
      const run = F.runs[w.run];
      // the stretch in this run's own (unwrapped) bearing range, pulled in off the towns
      let b0 = C.a0 * D2R, b1 = C.a1 * D2R;
      const r0 = aOf(w.k0), r1 = aOf(w.k1);
      while (b0 < r0 - Math.PI) { b0 += TAU; b1 += TAU; }
      while (b0 > r1 + Math.PI) { b0 -= TAU; b1 -= TAU; }
      b0 = Math.max(b0, r0 + 0.002); b1 = Math.min(b1, r1 - 0.002);
      while (b0 < b1 && townAt(b0)) b0 += 0.0005;
      while (b1 > b0 && townAt(b1)) b1 -= 0.0005;
      // clear of the towns' last streets by a block
      b0 += townAt(b0 - 0.004) ? 42 / R_MEAN : 0;
      b1 -= townAt(b1 + 0.004) ? 42 / R_MEAN : 0;
      if ((b1 - b0) * R_MEAN < 140) continue;
      void run;
      const n = Math.max(1, Math.round(((b1 - b0) * R_MEAN) / 320));
      const cuts = [];
      for (let j = 0; j <= n; j++) cuts.push(b0 + ((b1 - b0) * j) / n);
      const stretch = { ...C, b0, b1, parcels: [], lanes: [] };
      stretches.push(stretch);
      for (let j = 0; j <= n; j++) {
        // lanes on every cut but the ends that meet a town (its own streets serve it)
        const a = cuts[j];
        if ((j === 0 && townAt(a - 0.01)) || (j === n && townAt(a + 0.01))) continue;
        const [s0, s1] = crossSpan(a);
        if (s1 - s0 < 80) continue;
        for (const seg of splitBy(radial(a, s0, s1), (x, z) => ground(x, z) > 2.5 && block(x, z) > RIM_HW.lane + 4, 40)) {
          stretch.lanes.push(pushStreet(seg, CLS.LANE, RIM_HW.lane, { name: 'Field Lane', role: 'lane', town: null, quarter: quarterAt(a), noLots: true }));
        }
      }
      for (let j = 0; j < n; j++) for (const side of [-1, 1]) {
        const pa0 = cuts[j] + 12 / R_MEAN, pa1 = cuts[j + 1] - 12 / R_MEAN;
        const nb = Math.max(2, Math.ceil(((pa1 - pa0) * R_MEAN) / 10));
        const lo = [], hi = [];
        let okN = 0;
        for (let i = 0; i <= nb; i++) {
          const a = pa0 + ((pa1 - pa0) * i) / nb, k = Math.round(kOf(a)) % N;
          const rwa = rimWayR(a) ?? F.spine[k];
          const [s0, s1] = crossSpan(a);
          let A, B;
          if (side < 0) { A = s0 + RIM_HW.strandCountry + 9; B = rwa - RIM_HW.rimWay - 11; }
          else { A = rwa + RIM_HW.rimWay + 11; B = s1 - RIM_HW.dune - 8; }
          lo.push(A); hi.push(B);
          if (B - A > 30) okN++;
        }
        if (okN < nb * 0.6) continue;
        const P = { side, a0: pa0, a1: pa1, lo, hi, nb, kind: null, quarter: quarterAt((pa0 + pa1) / 2), stretch };
        P.inside = (x, z, pad = 0) => {
          const pp = polar(x, z);
          let a = pp.a;
          while (a < pa0 - Math.PI) a += TAU;
          while (a > pa0 + Math.PI) a -= TAU;
          if (a < pa0 + pad / pp.r || a > pa1 - pad / pp.r) return false;
          const f = ((a - pa0) / (pa1 - pa0)) * nb, i = Math.min(nb - 1, Math.floor(f)), t = f - i;
          const l2 = lo[i] + (lo[i + 1] - lo[i]) * t, h2 = hi[i] + (hi[i + 1] - hi[i]) * t;
          return pp.r > l2 + pad && pp.r < h2 - pad && block(x, z) > pad + 6;
        };
        // its ground
        let hs = 0, hmax = -1e9, hmin = 1e9, sl = 0, cnt = 0, face = 0;
        for (let i = 0; i <= nb; i += 2) {
          const a = pa0 + ((pa1 - pa0) * i) / nb;
          if (hi[i] - lo[i] < 20) continue;
          for (let f = 0.1; f < 0.95; f += 0.2) {
            const r = lo[i] + (hi[i] - lo[i]) * f, [x, z] = at(a, r);
            if (block(x, z) < 8) continue;
            const h = ground(x, z);
            const hr = ground(...at(a, r + 4)) - ground(...at(a, r - 4)), ht = ground(...at(a + 4 / r, r)) - ground(...at(a - 4 / r, r));
            hs += h; hmax = Math.max(hmax, h); hmin = Math.min(hmin, h); sl += Math.hypot(hr, ht) / 8; face += hr / 8; cnt++;
          }
        }
        if (cnt < 4) continue;
        P.h = hs / cnt; P.hmax = hmax; P.hmin = hmin; P.slope = sl / cnt; P.face = face / cnt;
        P.len = (pa1 - pa0) * R_MEAN;
        P.width = hi.reduce((s, v, i) => s + Math.max(0, v - lo[i]), 0) / hi.length;
        P.area = P.len * P.width;
        parcels.push(P); stretch.parcels.push(P);
      }
      // what each parcel is laid out as
      const free = () => stretch.parcels.filter((p) => !p.kind);
      const pick = (score) => { let best = null, bs = -1e8; for (const p of free()) { const s = score(p); if (s > bs) { bs = s; best = p; } } return best; };
      const fits = {
        sports: (p) => (p.len > 230 && p.width > 120 ? -p.slope * 100 - (p.hmax - p.hmin) * 0.3 : -1e9),
        amphitheatre: (p) => (p.side < 0 && p.len > 150 && p.width > 90 ? -Math.abs(p.face - 0.12) * 60 : -1e9),
        observatory: (p) => (p.width > 70 && p.len > 120 ? p.hmax : -1e9),
        botanical: (p) => (p.len > 200 && p.width > 120 ? -p.slope * 60 : -1e9),
        memorial: (p) => (p.len > 160 && p.width > 70 ? -p.slope * 40 + (p.side < 0 ? 2 : 0) : -1e9),
        market: (p) => (p.width > 50 ? -p.slope * 80 : -1e9),
        allotments: (p) => (p.width > 50 ? -p.slope * 60 : -1e9),
        hamlet: (p) => (p.len > 180 && p.width > 80 ? -p.slope * 50 : -1e9),
        vineyard: (p) => (p.width > 45 && p.slope > 0.05 ? -Math.abs(p.slope - 0.15) * 40 : -1e9),
        orchard: (p) => (p.width > 40 ? -p.slope * 20 : -1e9),
        palmGrove: (p) => (p.width > 40 ? -p.h * 0.2 : -1e9),
        meadow: () => 0,
      };
      for (const want of C.want) { const p = pick(fits[want] || fits.meadow); if (p) p.kind = want; }
      for (const p of free()) {
        const r = rnd();
        p.kind = p.slope > 0.24 ? 'wood'
          : p.slope > 0.08 && (p.quarter === 'garden' || p.quarter === 'upland') && r < 0.6 ? 'vineyard'
            : p.width > 40 && r < 0.55 ? 'orchard' : p.width > 40 && r < 0.75 ? 'market' : p.width > 40 && r < 0.85 ? 'palmGrove' : 'meadow';
      }
    }
  }

  // ---- turning squares where Rim Way ends at a channel
  for (const w of runWays) for (const end of [0, 1]) {
    const P = w.pts, p = end ? P[P.length - 1] : P[0], q = end ? P[P.length - 4] : P[3];
    const dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz) || 1;
    const R = 20, x = p[0] + (dx / l) * (R - 4), z = p[1] + (dz / l) * (R - 4);
    if (block(x, z) > R + 4 && ground(x, z) > 3) squares.push({ x, z, r: R, kind: 'village', district: 'rim', role: 'channelHead', end, run: w.run });
  }

  // lidos: the strand point nearest each bearing
  const lidos = [];
  for (const b of RIM_LIDOS) {
    const a = b * D2R, s = sampleArr(rSs, a);
    if (!Number.isNaN(s)) lidos.push({ a, r: s });
  }

  return { frame: F, streets, squares, parcels, stretches, towns, runWays, strands, parades, lidos, rS: rSs, rP: rPs, rw, block, townAt, quarterAt, rimWayR, T, heads, gateFeet, debug };
}
