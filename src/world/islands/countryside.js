import * as THREE from 'three';
import { createFacadeMaterial } from '../facade.js';
import { renderedHeight } from '../outerCities.js';
import { OUTER } from '../terrain.js';
import { mulberry32 } from '../noise.js';
import { islandRoadHeight, pointSegmentDistance } from '../islandPlan.js';
import { Solids, Drape, Instances, TAU, FIELD_COL, LANE_COL, groundNormal, drapeMaterial, detailMaterial, instancedDetailMaterial, prototypes, buildLayerLOD } from './kit.js';

// The cultivated countryside of the five island cities, c. 5000: the land between the
// harbour towns and their hill villages is farmed as a coherent landscape. Courtyard farms
// stand along the island roads with their fields laid on the contour round them (grain,
// green crops, lavender, hay meadows, market gardens), vineyards and orchards on the warmer
// slopes, olive groves higher up, all bounded by hedgerows on the gentle ground and dry-stone
// walls on the terraced slopes. Villas take the panoramic spurs with a cypress drive and a
// formal garden; tholos shrines crown the knolls; an observatory stands on the summit. Farm
// lanes are routed along the contours to the nearest public road and meet it on a founded
// stone apron.
//
// Physical rules (verified by tools/verify-island-countryside.mjs):
//  * an occupancy raster (6 m) holds everything already built on the island (every triangle
//    of the city, its roads, stairs, plots and harbour, dilated) and everything laid here;
//    nothing is placed over an occupied cell, so nothing overlaps;
//  * every building stands on a stone plinth taken down to the lowest drawn ground under it
//    (renderedHeight), every wall, hedge, vine row, tree and column is founded below the
//    ground at each of its ends; every solid is closed and convex (or a closed lathe);
//  * fields, yards and lanes are drapes laid 0.1 m over the drawn surface at every vertex
//    (sampled at 4-6 m, finer than the terrain mesh) with a depth offset: finishes, not solids.

const OCC = 6;
// occupancy codes, in priority order (a stronger claim always wins a cell)
const LANE = 1, FIELD = 2, YARD = 3, HARD = 4;

function contourFrame(x, z, s = 18) {
  const gx = (renderedHeight(x + s, z) - renderedHeight(x - s, z)) / (2 * s);
  const gz = (renderedHeight(x, z + s) - renderedHeight(x, z - s)) / (2 * s);
  const g = Math.hypot(gx, gz);
  // u runs along the contour, v up the slope
  const ang = g > 1e-4 ? Math.atan2(gx, -gz) : 0;
  return { ang, slope: g, gx, gz };
}

class Raster {
  constructor(c) {
    const E = Math.min(9200, c.coast.s * 1.14);
    this.x0 = c.ix - E; this.z0 = c.iz - E; this.N = Math.ceil((2 * E) / OCC) + 1;
    this.a = new Uint8Array(this.N * this.N);
  }
  i(x) { return Math.floor((x - this.x0) / OCC); }
  j(z) { return Math.floor((z - this.z0) / OCC); }
  get(x, z) { const i = this.i(x), j = this.j(z); if (i < 0 || j < 0 || i >= this.N || j >= this.N) return HARD; return this.a[j * this.N + i]; }
  fillBox(x0, z0, x1, z1, v, a = this.a) {
    const N = this.N, i0 = Math.max(0, this.i(x0)), i1 = Math.min(N - 1, this.i(x1)), j0 = Math.max(0, this.j(z0)), j1 = Math.min(N - 1, this.j(z1));
    for (let j = j0; j <= j1; j++) { const r = j * N; for (let i = i0; i <= i1; i++) if (a[r + i] < v) a[r + i] = v; }
  }
  /** Cells whose centre lies in the convex polygon q grown by m. */
  cells(q, m, fn) {
    const N = this.N;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of q) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const area = q.reduce((s, a, k) => { const b = q[(k + 1) % q.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0), sg = area > 0 ? 1 : -1;
    const E = q.map((a, k) => { const b = q[(k + 1) % q.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [a[0], a[1], (b[0] - a[0]) / L, (b[1] - a[1]) / L]; });
    const i0 = Math.max(0, this.i(x0 - m)), i1 = Math.min(N - 1, this.i(x1 + m)), j0 = Math.max(0, this.j(z0 - m)), j1 = Math.min(N - 1, this.j(z1 + m));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = this.x0 + (i + 0.5) * OCC, pz = this.z0 + (j + 0.5) * OCC;
      let inside = true;
      for (const [ax, az, tx, tz] of E) if (sg * (tx * (pz - az) - tz * (px - ax)) < -m) { inside = false; break; }
      if (inside && fn(j * N + i) === false) return false;
    }
    return true;
  }
  free(q, m = 0, allow = 0) { return this.cells(q, m, (k) => (this.a[k] > allow ? false : undefined)); }
  mark(q, v, m = 0) { this.cells(q, m, (k) => { if (this.a[k] < v) this.a[k] = v; }); }
  circleFree(x, z, r, allow = 0) {
    const N = this.N, i0 = Math.max(0, this.i(x - r)), i1 = Math.min(N - 1, this.i(x + r)), j0 = Math.max(0, this.j(z - r)), j1 = Math.min(N - 1, this.j(z + r));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = this.x0 + (i + 0.5) * OCC - x, pz = this.z0 + (j + 0.5) * OCC - z;
      if (px * px + pz * pz <= r * r && this.a[j * N + i] > allow) return false;
    }
    return true;
  }
  markSeg(a, b, hw, v) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L * hw, nz = (b[0] - a[0]) / L * hw;
    this.mark([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]], v, 0);
  }
}

// The outer terrain is drawn as a polar grid (terrain.js: OUTER, subdivided K times near the
// viewer): fine cell (I, J) spans angles I..I+1 of A*K and rings J..J+1 of R*K (geometric radii)
// and is split into triangles (I,J)(I+1,J)(I,J+1) and (I+1,J)(I+1,J+1)(I,J+1). A finish clipped
// to these triangles lies in their planes: it neither floats nor dips anywhere.
const OA = OUTER.A * OUTER.K, ORK = OUTER.R * OUTER.K, OLN = Math.log(OUTER.r1 / OUTER.r0);
const polar = (I, J) => { const a = (I / OA) * Math.PI * 2, r = OUTER.r0 * Math.pow(OUTER.r1 / OUTER.r0, J / ORK); return [Math.cos(a) * r, Math.sin(a) * r]; };
function clipConvex(poly, tri) {
  const area = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]), sg = area > 0 ? 1 : -1;
  let out = poly;
  for (let e = 0; e < 3 && out.length; e++) {
    const a = tri[e], b = tri[(e + 1) % 3], inp = out, side = (p) => sg * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const p = inp[i], q = inp[(i + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
  }
  // drop slivers and repeated points
  const clean = [];
  for (const p of out) if (!clean.length || Math.hypot(p[0] - clean[clean.length - 1][0], p[1] - clean[clean.length - 1][1]) > 1e-3) clean.push(p);
  while (clean.length > 1 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) <= 1e-3) clean.pop();
  if (clean.length < 3) return null;
  let A2 = 0; for (let i = 0; i < clean.length; i++) { const p = clean[i], q = clean[(i + 1) % clean.length]; A2 += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(A2) > 1e-3 ? clean : null;
}
/** Calls fn(piece) for every convex piece of `poly` inside one fine terrain triangle. */
export function terrainPieces(poly, fn) {
  let t0 = Infinity, t1 = -Infinity, r0 = Infinity, r1 = -Infinity;
  const ref = Math.atan2(poly[0][1], poly[0][0]);
  for (const [x, z] of poly) {
    let t = Math.atan2(z, x); if (t - ref > Math.PI) t -= Math.PI * 2; if (ref - t > Math.PI) t += Math.PI * 2;
    const r = Math.hypot(x, z);
    t0 = Math.min(t0, t); t1 = Math.max(t1, t); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
  }
  const I0 = Math.floor((t0 / (Math.PI * 2)) * OA) - 1, I1 = Math.floor((t1 / (Math.PI * 2)) * OA) + 1;
  const J0 = Math.floor((Math.log(r0 / OUTER.r0) / OLN) * ORK) - 1, J1 = Math.floor((Math.log(r1 / OUTER.r0) / OLN) * ORK) + 1;
  for (let J = J0; J <= J1; J++) for (let I = I0; I <= I1; I++) {
    const a = polar(I, J), b = polar(I + 1, J), c = polar(I, J + 1), d = polar(I + 1, J + 1);
    for (const T of [[a, b, c], [b, d, c]]) { const piece = clipConvex(poly, T); if (piece) fn(piece); }
  }
}

const rect = (x, z, ang, hl, hw) => { const ax = Math.cos(ang), az = Math.sin(ang), sx = -az, sz = ax; return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + ax * a * hl + sx * b * hw, z + az * a * hl + sz * b * hw]); };

/** Lowest and highest drawn ground over an oriented rectangle, sampled every ~2.5 m. */
function groundRange(x, z, ang, hl, hw, step = 2.5) {
  const ax = Math.cos(ang), az = Math.sin(ang), sx = -az, sz = ax;
  let lo = Infinity, hi = -Infinity;
  const nu = Math.max(1, Math.ceil((2 * hl) / step)), nv = Math.max(1, Math.ceil((2 * hw) / step));
  for (let a = 0; a <= nu; a++) for (let b = 0; b <= nv; b++) {
    const u = -hl + (2 * hl * a) / nu, v = -hw + (2 * hw * b) / nv, h = renderedHeight(x + ax * u + sx * v, z + az * u + sz * v);
    if (h < lo) lo = h; if (h > hi) hi = h;
  }
  return { lo, hi };
}

// ---------------------------------------------------------------------------------------
export function buildIslandCountryside(scene, c, plan, parts, { audit = null, keepouts = [], palette = 'sand', seed = 1 } = {}) {
  const rnd = mulberry32(70117 + c.island * 7919);
  const R = new Raster(c);
  const stats = { farms: 0, villas: 0, fields: 0, vineyards: 0, orchards: 0, olives: 0, lanes: 0, laneLength: 0, shrines: 0, observatories: 0, trees: 0 };
  const records = { buildings: [], fields: [], lanes: [], ramps: [], yards: [], runs: audit ? [] : null, trees: audit ? [] : null, drapes: audit ? [] : null, laneDrapes: audit ? [] : null };

  // ---- 1. everything already built on the island is hard occupancy (dilated 3 m); the
  // non-road solids (stairs, plots, walls, buildings) also go, barely dilated, into a second
  // raster the road aprons must keep clear of
  const obst = new Uint8Array(R.N * R.N);
  for (const g of parts) {
    const p = g.attributes.position.array, idx = g.index ? g.index.array : null, n = idx ? idx.length : p.length / 3;
    const isRoad = !!(g.userData.islandRoad && !g.userData.islandStair && (g.userData.islandRole || g.userData.islandStreet));
    for (let t = 0; t < n; t += 3) {
      const a = (idx ? idx[t] : t) * 3, b = (idx ? idx[t + 1] : t + 1) * 3, d = (idx ? idx[t + 2] : t + 2) * 3;
      const x0 = Math.min(p[a], p[b], p[d]), x1 = Math.max(p[a], p[b], p[d]), z0 = Math.min(p[a + 2], p[b + 2], p[d + 2]), z1 = Math.max(p[a + 2], p[b + 2], p[d + 2]);
      R.fillBox(x0 - 3, z0 - 3, x1 + 3, z1 + 3, HARD);
      if (!isRoad) R.fillBox(x0 - 1, z0 - 1, x1 + 1, z1 + 1, 1, obst);
    }
  }
  const obstFree = (q) => R.cells(q, 0.5, (k) => (obst[k] ? false : undefined));
  for (const p of plan.circles) R.fillBox(p.x - p.r, p.z - p.r, p.x + p.r, p.z + p.r, HARD);
  // the harbour front (quay, its 70 m quay top and the waterfront row) and the station approach
  for (let k = 1; k < c.quayLine.length; k++) R.markSeg(c.quayLine[k - 1], c.quayLine[k], 170, HARD);

  // ---- 2. the public road network: lanes may end on it (target raster, 12 m)
  const TG = 12, TN = Math.ceil((R.N * OCC) / TG) + 1, target = new Int32Array(TN * TN).fill(-1), roadSegs = [];
  const publicRoads = parts.filter((g) => g.userData.islandRoad && (g.userData.islandRole === 'regional' || g.userData.islandRole === 'local' || g.userData.islandRole === 'connection'));
  for (const g of publicRoads) {
    const r = g.userData.islandRoad, S = r.sections;
    for (let k = 1; k < S.length; k++) {
      const a = S[k - 1], b = S[k], ca = [(a.left[0] + a.right[0]) / 2, (a.left[1] + a.right[1]) / 2], cb = [(b.left[0] + b.right[0]) / 2, (b.left[1] + b.right[1]) / 2];
      if (Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) < 0.5) continue;
      const id = roadSegs.length;
      roadSegs.push({ a: ca, b: cb, sa: a, sb: b, hw: r.width / 2 });
      const reach = r.width / 2 + 10;
      const i0 = Math.floor((Math.min(ca[0], cb[0]) - reach - R.x0) / TG), i1 = Math.floor((Math.max(ca[0], cb[0]) + reach - R.x0) / TG);
      const j0 = Math.floor((Math.min(ca[1], cb[1]) - reach - R.z0) / TG), j1 = Math.floor((Math.max(ca[1], cb[1]) + reach - R.z0) / TG);
      for (let j = Math.max(0, j0); j <= Math.min(TN - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(TN - 1, i1); i++) {
        const px = R.x0 + i * TG, pz = R.z0 + j * TG;
        if (pointSegmentDistance(px, pz, ca, cb) < reach) target[j * TN + i] = id;
      }
    }
  }
  const nearestRoad = (x, z, maxD = 1e9) => {
    let best = null;
    const i = Math.round((x - R.x0) / TG), j = Math.round((z - R.z0) / TG);
    const tryId = (id) => { if (id < 0) return; const s = roadSegs[id], d = pointSegmentDistance(x, z, s.a, s.b); if (d < maxD && (!best || d < best.d)) best = { s, d, id }; };
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < TN && jj < TN) tryId(target[jj * TN + ii]); }
    return best;
  };

  const smoothNormal = (x, z) => {
    const dx = renderedHeight(x + 10, z) - renderedHeight(x - 10, z), dz = renderedHeight(x, z + 10) - renderedHeight(x, z - 10), l = Math.hypot(dx, 20, dz);
    return [-dx / l, 20 / l, -dz / l];
  };
  // ---- layers and chunks (1 km)
  const CH = 1000, chunks = new Map();
  const chunk = (x, z) => {
    const ci = Math.floor(x / CH), cj = Math.floor(z / CH), k = ci + ',' + cj;
    if (!chunks.has(k)) chunks.set(k, { arch: new Solids(audit, `${c.name} countryside architecture`), stone: new Solids(audit, `${c.name} countryside stonework`), detail: new Solids(audit, `${c.name} countryside planting`), drape: new Drape(), walls: new Instances(), trees: new Instances(), cyp: new Instances() });
    return chunks.get(k);
  };
  // a reservation journal: claims made while a place is planned, undone if it fails
  const reserve = (q, v, m = 0) => { const undo = []; R.cells(q, m, (k) => { if (R.a[k] < v) { undo.push(k, R.a[k]); R.a[k] = v; } }); return undo; };
  const restore = (undo) => { for (let i = undo.length - 2; i >= 0; i -= 2) R.a[undo[i]] = undo[i + 1]; };

  // ---- lanes: least-cost routes on a 10 m grid along the contours to the nearest road or lane
  const LG = 10;
  const lanes = [];                  // built lanes {pts, hw}
  const laneAt = new Map();          // LG cell -> lane index
  const route = (sx, sz, maxR = 1100) => {
    const W = Math.ceil(maxR / LG), M = 2 * W + 1, X0 = sx - W * LG, Z0 = sz - W * LG;
    const H = new Float32Array(M * M), cost = new Float64Array(M * M).fill(Infinity), done = new Uint8Array(M * M), from = new Int32Array(M * M).fill(-1), block = new Uint8Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const x = X0 + i * LG, z = Z0 + j * LG, k = j * M + i;
      H[k] = renderedHeight(x, z);
      block[k] = H[k] < 2.5 || R.get(x, z) >= FIELD ? 1 : 0;
    }
    const heap = [], hk = [];
    const push = (n, v) => { heap.push(n); hk.push(v); let q = heap.length - 1; while (q > 0) { const p = (q - 1) >> 1; if (hk[p] <= hk[q]) break; [heap[p], heap[q]] = [heap[q], heap[p]]; [hk[p], hk[q]] = [hk[q], hk[p]]; q = p; } };
    const pop = () => { const top = heap[0], L = heap.length - 1; heap[0] = heap[L]; hk[0] = hk[L]; heap.pop(); hk.pop(); let q = 0; for (;;) { const l = 2 * q + 1, r = l + 1; let m = q; if (l < heap.length && hk[l] < hk[m]) m = l; if (r < heap.length && hk[r] < hk[m]) m = r; if (m === q) break; [heap[m], heap[q]] = [heap[q], heap[m]]; [hk[m], hk[q]] = [hk[q], hk[m]]; q = m; } return top; };
    const s0 = W * M + W;
    cost[s0] = 0; push(s0, 0);
    let goal = -1, goalKind = null, goalLane = -1;
    while (heap.length) {
      const n = pop();
      if (done[n]) continue;
      done[n] = 1;
      const i = n % M, j = (n / M) | 0, x = X0 + i * LG, z = Z0 + j * LG;
      if (Math.hypot(i - W, j - W) > 3) {
        const ti = Math.round((x - R.x0) / TG), tj = Math.round((z - R.z0) / TG);
        if (ti >= 0 && tj >= 0 && ti < TN && tj < TN && target[tj * TN + ti] >= 0) { goal = n; goalKind = 'road'; break; }
        const li = laneAt.get(Math.round(x / LG) + ',' + Math.round(z / LG));
        if (li !== undefined) { goal = n; goalKind = 'lane'; goalLane = li; break; }
      }
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= M || jj >= M) continue;
        const m = jj * M + ii;
        if (block[m] && Math.hypot(ii - W, jj - W) > 2.5) continue;
        const d = LG * (di && dj ? Math.SQRT2 : 1), g = Math.abs(H[m] - H[n]) / d;
        const cc = cost[n] + d * (1 + 60 * g * g) + (g > 0.1 ? d * (g - 0.1) * 400 : 0);
        if (!done[m] && cc < cost[m]) { cost[m] = cc; from[m] = n; push(m, cc); }
      }
    }
    if (goal < 0) return null;
    const path = [];
    for (let n = goal; n >= 0; n = from[n]) path.push([X0 + (n % M) * LG, Z0 + ((n / M) | 0) * LG]);
    path.reverse();
    path[0] = [sx, sz];
    return { path, goalKind, goalLane };
  };
  const smooth = (pts, it) => { for (let r = 0; r < it; r++) { const o = [pts[0]]; for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } o.push(pts[pts.length - 1]); pts = o; } return pts; };
  const resample = (pts, step) => {
    const o = [pts[0]]; let acc = 0;
    for (let k = 1; k < pts.length; k++) { const a = pts[k - 1], b = pts[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let s = step - acc; while (s <= L) { o.push([a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L]); s += step; } acc = L - (s - step); }
    const last = pts[pts.length - 1], pl = o[o.length - 1];
    if (o.length === 1 || Math.hypot(last[0] - pl[0], last[1] - pl[1]) > step * 0.3) o.push(last); else o[o.length - 1] = last;
    return o;
  };
  const polyDist = (x, z, pts) => { let d = Infinity; for (let k = 1; k < pts.length; k++) d = Math.min(d, pointSegmentDistance(x, z, pts[k - 1], pts[k])); return d; };
  const segQuad = (a, b, hw) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L * hw, nz = (b[0] - a[0]) / L * hw; return [[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]]; };

  /**
   * Straighten the grid route (Douglas-Peucker, tolerance tol) where the straighter line
   * stays on free ground and no steeper than the route it replaces.
   */
  const simplify = (pts, tol) => {
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const ok = (i, j) => {
      const a = pts[i], b = pts[j], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1) return true;
      const q = segQuad(a, b, 2.5);
      if (!R.free(q, 0, LANE)) return false;
      const n = Math.ceil(L / 10);
      for (let k = 1; k <= n; k++) { const f0 = (k - 1) / n, f1 = k / n; const h0 = renderedHeight(a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0), h1 = renderedHeight(a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1); if (Math.abs(h1 - h0) / (L / n) > 0.16) return false; }
      return true;
    };
    const rec = (i, j) => {
      let worst = 0, at = -1;
      for (let k = i + 1; k < j; k++) { const d = pointSegmentDistance(pts[k][0], pts[k][1], pts[i], pts[j]); if (d > worst) { worst = d; at = k; } }
      if (at < 0) return;
      if (worst > tol || !ok(i, j)) { keep[at] = 1; rec(i, at); rec(at, j); }
    };
    rec(0, pts.length - 1);
    return pts.filter((_, k) => keep[k]);
  };
  /** The founded stone apron that carries a lane from the ground up onto a road's edge. */
  const planApron = (end, road, hw) => {
    const s = road.s, ex = s.b[0] - s.a[0], ez = s.b[1] - s.a[1], L2 = ex * ex + ez * ez || 1;
    const t = Math.max(0.05, Math.min(0.95, ((end[0] - s.a[0]) * ex + (end[1] - s.a[1]) * ez) / L2));
    const cx = s.a[0] + ex * t, cz = s.a[1] + ez * t;
    let nx = end[0] - cx, nz = end[1] - cz; const nl = Math.hypot(nx, nz);
    if (nl < 1e-3) return null;
    nx /= nl; nz /= nl;
    const edge = [cx + nx * (s.hw - 0.35), cz + nz * (s.hw - 0.35)];
    const yRoad = islandRoadHeight([s.sa, s.sb], edge);
    if (yRoad === undefined) return null;
    const gOut = renderedHeight(cx + nx * (s.hw + 0.6), cz + nz * (s.hw + 0.6));
    const rise = yRoad - (gOut + 0.1);
    if (rise < -0.2) return null;
    const len = Math.max(2.5, Math.min(16, rise / 0.1));
    if (rise / len > 0.16) return null;
    const far = [cx + nx * (s.hw - 0.35 + len), cz + nz * (s.hw - 0.35 + len)];
    const tx = -nz, tz = nx;
    const quad = [[edge[0] + tx * hw, edge[1] + tz * hw], [far[0] + tx * hw, far[1] + tz * hw], [far[0] - tx * hw, far[1] - tz * hw], [edge[0] - tx * hw, edge[1] - tz * hw]];
    if (!obstFree(quad)) return null;
    let lo = Infinity;
    for (let q = 0; q <= 8; q++) for (const w of [-1, -0.5, 0, 0.5, 1]) { const f = q / 8, x = edge[0] + (far[0] - edge[0]) * f + tx * w * hw, z = edge[1] + (far[1] - edge[1]) * f + tz * w * hw; lo = Math.min(lo, renderedHeight(x, z)); }
    if (lo < 1) return null;
    const topFar = Math.max(...[-1, 0, 1].map((w) => renderedHeight(far[0] + tx * w * hw, far[1] + tz * w * hw) + 0.1));
    const topEdge = yRoad - 0.01;
    // the sloped top must clear the ground over its whole surface
    for (let q = 0; q <= 8; q++) for (const w of [-1, -0.5, 0, 0.5, 1]) {
      const f = q / 8, x = edge[0] + (far[0] - edge[0]) * f + tx * w * hw, z = edge[1] + (far[1] - edge[1]) * f + tz * w * hw;
      if (renderedHeight(x, z) > topEdge + (topFar - topEdge) * f + 0.02) return null;
    }
    return { edge, far, quad, bottom: lo - 0.6, topEdge, topFar, len, hw, road: road.id };
  };
  /** Plan a lane from (x, z): a contour route ending on a road apron or on another lane. */
  const planLane = (x, z, hw, lead = [], maxR = 1100) => {
    const r = route(x, z, maxR);
    if (!r) return null;
    let pts = resample(smooth(simplify([...lead, ...r.path.slice(lead.length ? 0 : 0)], 11), 3), 4);
    if (lead.length) pts[0] = lead[0];
    if (r.goalKind === 'road') {
      const end = pts[pts.length - 1], road = nearestRoad(end[0], end[1], 40);
      if (!road) return null;
      const ap = planApron(end, road, hw + 0.25);
      if (!ap) return null;
      const reach = road.s.hw - 0.35 + ap.len;
      while (pts.length > 1 && pointSegmentDistance(pts[pts.length - 1][0], pts[pts.length - 1][1], road.s.a, road.s.b) < reach + 1.5) pts.pop();
      const last = pts[pts.length - 1];
      if (Math.hypot(last[0] - ap.far[0], last[1] - ap.far[1]) > 0.5) {
        if (!obstFree(segQuad(last, ap.far, hw))) return null;
        pts.push(ap.far);
      } else pts[pts.length - 1] = ap.far;
      if (pts.length < 2) return null;
      return { pts, hw, goal: 'road', apron: ap };
    }
    // joining another lane: stop at its edge so the two finishes do not lie on each other
    const other = lanes[r.goalLane];
    while (pts.length > 2 && polyDist(pts[pts.length - 1][0], pts[pts.length - 1][1], other.pts) < other.hw * 0.92) pts.pop();
    if (pts.length < 2) return null;
    return { pts, hw, goal: 'lane', join: r.goalLane };
  };
  /** Drape a lane of half width hw along pts, cut along the terrain triangles (exact). */
  const drapeLane = (pts, hw, lift) => {
    const S = pts.map((p, k) => {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return { x: p[0], z: p[1], sx: -(b[1] - a[1]) / l, sz: (b[0] - a[0]) / l };
    });
    const pieces = records.laneDrapes ? [] : null;
    let u = 0;
    for (let k = 1; k < S.length; k++) {
      const s = S[k - 1], t = S[k], L = Math.hypot(t.x - s.x, t.z - s.z), C = chunk((s.x + t.x) / 2, (s.z + t.z) / 2);
      if (L < 1e-3) continue;
      const q = [[s.x - s.sx * hw, s.z - s.sz * hw], [t.x - t.sx * hw, t.z - t.sz * hw], [t.x + t.sx * hw, t.z + t.sz * hw], [s.x + s.sx * hw, s.z + s.sz * hw]];
      const dx = (t.x - s.x) / L, dz = (t.z - s.z) / L, u0 = u;
      terrainPieces(q, (poly) => {
        const ids = poly.map(([x, z]) => {
          const f = Math.max(0, Math.min(1, ((x - s.x) * dx + (z - s.z) * dz) / L)), cx = s.x + (t.x - s.x) * f, cz = s.z + (t.z - s.z) * f;
          let nx = s.sx + (t.sx - s.sx) * f, nz = s.sz + (t.sz - s.sz) * f; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
          return C.drape.vert(x, renderedHeight(x, z) + lift, z, smoothNormal(x, z), LANE_COL, u0 + f * L, ((x - cx) * nx + (z - cz) * nz) / hw, 0);
        });
        const up = ((poly[1][1] - poly[0][1]) * (poly[2][0] - poly[0][0]) - (poly[1][0] - poly[0][0]) * (poly[2][1] - poly[0][1])) > 0;
        for (let m = 1; m < ids.length - 1; m++) { if (up) C.drape.tri(ids[0], ids[m], ids[m + 1]); else C.drape.tri(ids[0], ids[m + 1], ids[m]); }
        if (pieces) pieces.push(poly);
      });
      u += L;
    }
    if (pieces) records.laneDrapes.push({ pieces, lift });
  };
  const buildLane = (L) => {
    const { pts, hw } = L;
    for (let k = 1; k < pts.length; k++) R.markSeg(pts[k - 1], pts[k], hw + 1.5, LANE);
    drapeLane(pts, hw, L.goal === 'lane' ? 0.13 : 0.1);
    if (L.apron) {
      const a = L.apron, tx = -(a.far[1] - a.edge[1]) / a.len, tz = (a.far[0] - a.edge[0]) / a.len, P = [];
      for (const [p, y] of [[a.edge, a.topEdge], [a.far, a.topFar]]) for (const w of [-1, 1]) P.push([p[0] + tx * w * a.hw, y, p[1] + tz * w * a.hw]);
      const Q = [[P[0][0], a.bottom, P[0][2]], [P[1][0], a.bottom, P[1][2]], [P[3][0], a.bottom, P[3][2]], [P[2][0], a.bottom, P[2][2]], P[0], P[1], P[3], P[2]];
      chunk(a.edge[0], a.edge[1]).stone.hexa(Q, 1, a.bottom);
      R.mark(a.quad, HARD, 0);
      records.ramps.push(a);
    }
    for (const p of pts) laneAt.set(Math.round(p[0] / LG) + ',' + Math.round(p[1] / LG), lanes.length);
    lanes.push(L);
    let len = 0; for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    stats.lanes++; stats.laneLength += len;
    records.lanes.push({ pts, hw, goal: L.goal, join: L.join, apron: L.apron });
  };
  /**
   * Plan a place: reserve its footprints, route its lane from `gate` (with an optional
   * straight lead-in), and only then build it; otherwise every claim is withdrawn.
   */
  const place = (footprints, gate, hw, lead, build) => {
    const undo = [];
    for (const q of footprints) undo.push(...reserve(q, HARD, 1));
    const L = planLane(gate[0], gate[1], hw, lead);
    if (!L) { restore(undo); return null; }
    build(L);
    buildLane(L);
    return L;
  };

  // ---- buildings --------------------------------------------------------------------
  const plinth = (C, x, z, ang, hl, hw, lo, base) => C.stone.box(x, z, Math.cos(ang), Math.sin(ang), hl, hw, lo - 1.2, base, 1, lo - 1.2);
  /** Survey a plinthed building footprint: {lo, base, q} or null (occupied/too steep). */
  const siteBuilding = (x, z, ang, L, W, maxStep = 4.5, allow = 0) => {
    const q = rect(x, z, ang, L / 2 + 0.8, W / 2 + 0.8);
    if (!R.free(q, 1, allow)) return null;
    const g = groundRange(x, z, ang, L / 2 + 0.6, W / 2 + 0.6);
    if (g.lo < 4 || g.hi - g.lo > maxStep) return null;
    return { lo: g.lo, base: g.hi + 0.35, q, x, z, ang, L, W };
  };
  const commit = (s, type) => { R.mark(s.q, HARD, 1); records.buildings.push({ x: s.x, z: s.z, ang: s.ang, L: s.L, W: s.W, lo: s.lo, base: s.base, q: s.q, type }); keepouts.push({ x: s.x, z: s.z, r: Math.hypot(s.L, s.W) / 2 + 3 }); };
  const buildHouse = (s, wallH, opts = {}) => {
    const C = chunk(s.x, s.z), ang = s.ang;
    plinth(C, s.x, s.z, ang, s.L / 2 + 0.5, s.W / 2 + 0.5, s.lo, s.base);
    const r = C.arch.gable(s.x, s.z, ang, s.L, s.W, s.base, wallH, { pitch: opts.pitch ?? 0.55, wall: opts.wall ?? 5, roof: opts.roof ?? 11 });
    if (opts.chimney) C.arch.box(s.x + Math.cos(ang) * s.L * 0.3, s.z + Math.sin(ang) * s.L * 0.3, Math.cos(ang), Math.sin(ang), 0.55, 0.55, s.base + wallH - 0.2, r.ridge + 1.2, 1, s.base);
    commit(s, opts.type || 'house');
    return r;
  };
  const buildBarn = (s, wallH, opts = {}) => {
    const C = chunk(s.x, s.z);
    plinth(C, s.x, s.z, s.ang, s.L / 2 + 0.5, s.W / 2 + 0.5, s.lo, s.base);
    const top = C.arch.vault(s.x, s.z, s.ang, s.L, s.W, s.base, wallH, { wall: opts.wall ?? 1, roof: opts.roof ?? 3, seg: 8, overhang: 0.35 });
    commit(s, opts.type || 'barn');
    return top;
  };
  const buildGranary = (s, h) => {
    const C = chunk(s.x, s.z), b = s.base, r = s.L / 2, x = s.x, z = s.z;
    C.stone.lathe([{ r: r + 0.6, y: s.lo - 1.2, kind: 1 }, { r: r + 0.6, y: b, kind: 1 }, { r: r + 0.6, y: b, kind: 9 }, { r: 0, y: b, kind: 9 }], 12, x, z);
    C.arch.lathe([{ r, y: b - 0.05, kind: 5 }, { r: r * 0.94, y: b + h, kind: 5 }, { r: r * 0.94, y: b + h, kind: 1 }, { r: r * 1.1, y: b + h, kind: 1 }, { r: r * 1.1, y: b + h + 0.5, kind: 1 },
      { r: r * 0.95, y: b + h + 0.5, kind: 1 }, { r: r * 0.8, y: b + h + r * 0.6, kind: 1 }, { r: r * 0.42, y: b + h + r * 0.95, kind: 1 }, { r: 0.3, y: b + h + r * 1.1, kind: 2 }, { r: 0, y: b + h + r * 1.35, kind: 10 }], 14, x, z);
    commit(s, 'granary');
  };
  /**
   * A founded run following the ground between two points (field walls, hedges, vine rows):
   * sheared unit boxes, each at most `seg` long, whose bottom edge lies 0.45 m below the
   * lowest ground across the run's thickness at each end, and whose constant height takes
   * the top `h` above the highest ground sampled along the run.
   */
  const groundRun = (C, p0, p1, h, t, kind, seg = 12, foot = 0.45) => {
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), n = Math.max(1, Math.ceil(L / seg));
    const nx = -(p1[1] - p0[1]) / (L || 1) * t / 2, nz = (p1[0] - p0[0]) / (L || 1) * t / 2;
    const span = (a) => { let lo = Infinity, hi = -Infinity; for (const w of [-1, 0, 1]) { const y = renderedHeight(a[0] + nx * w, a[1] + nz * w); lo = Math.min(lo, y); hi = Math.max(hi, y); } return [lo, hi]; };
    let sa = span(p0);
    for (let k = 0; k < n; k++) {
      const a = [p0[0] + ((p1[0] - p0[0]) * k) / n, p0[1] + ((p1[1] - p0[1]) * k) / n], b = [p0[0] + ((p1[0] - p0[0]) * (k + 1)) / n, p0[1] + ((p1[1] - p0[1]) * (k + 1)) / n];
      const sb = span(b);
      let ya = sa[0] - foot, yb = sb[0] - foot, H = Math.max(sa[1] - ya, sb[1] - yb);
      for (const f of [0.2, 0.4, 0.6, 0.8]) {
        const m = span([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]), yb0 = ya + (yb - ya) * f;
        // a hollow between the ends: take the whole bottom edge down to it
        if (m[0] - foot < yb0) { const d = yb0 - (m[0] - foot); ya -= d; yb -= d; }
        H = Math.max(H, m[1] - (ya + (yb - ya) * f));
      }
      H += h;
      C.walls.run(a, ya, b, yb, H, t, kind);
      if (records.runs) records.runs.push({ a, b, ya, yb, H, t, kind });
      sa = sb;
    }
  };

  /**
   * Lay a finish over the rectangle u in [-hl, hl], v in [-hw, hw] (P maps (u, v) to plan):
   * the rectangle is cut along the drawn terrain's triangles and every piece lies in its
   * triangle's plane, `lift` above it, so the finish follows the ground exactly.
   */
  const drapeGrid = (C, P, hl, hw, col, kind, lift = 0.08) => {
    const o = P(0, 0), pu = P(1, 0), pv = P(0, 1), ax = pu[0] - o[0], az = pu[1] - o[1], sx = pv[0] - o[0], sz = pv[1] - o[1];
    const q = [P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw)];
    C.drape.extent(hl, hw);
    const pieces = records.drapes ? [] : null;
    terrainPieces(q, (poly) => {
      const ids = poly.map(([x, z]) => { const du = x - o[0], dv = z - o[1]; return C.drape.vert(x, renderedHeight(x, z) + lift, z, smoothNormal(x, z), col, du * ax + dv * az, du * sx + dv * sz, kind); });
      // wind every fan triangle to face up
      const up = ((poly[1][1] - poly[0][1]) * (poly[2][0] - poly[0][0]) - (poly[1][0] - poly[0][0]) * (poly[2][1] - poly[0][1])) > 0;
      for (let k = 1; k < ids.length - 1; k++) { if (up) C.drape.tri(ids[0], ids[k], ids[k + 1]); else C.drape.tri(ids[0], ids[k + 1], ids[k]); }
      if (pieces) pieces.push(poly);
    });
    C.drape.extent();
    if (pieces) records.drapes.push({ pieces, lift });
  };

  // ---- farmsteads: along the public roads, set back on the gentle ground ----------------
  const farms = [];
  const siteClear = (x, z, r) => plan.sites.every((s) => Math.hypot(s.x - x, s.z - z) > (s.radius ?? 440) * 0.85 + r) && Math.hypot(x - c.coast.x, z - c.coast.z) > 1250 + r;
  const farmCourt = (x, z, ang, kind) => {
    const fq = rect(x, z, ang, 36, 27);
    if (!R.free(fq, 4)) return false;
    const g = groundRange(x, z, ang, 36, 27, 6);
    if (g.lo < 6 || g.hi - g.lo > 11) return false;
    const ax = Math.cos(ang), az = Math.sin(ang), sx = -az, sz = ax;
    const P = (u, v) => [x + ax * u + sx * v, z + az * u + sz * v];
    // the uphill side carries the long barn, the house faces downhill across the yard
    const fr = contourFrame(x, z);
    const up = (fr.gx * sx + fr.gz * sz) >= 0 ? 1 : -1;
    const hp = P(0, -up * 17), bp = P(-2, up * 16), sp = P(25, 0), gp = P(-25, -up * 10);
    const hs = siteBuilding(hp[0], hp[1], ang, 17 + rnd() * 5, 9, 5.5);
    if (!hs) return false;
    const bs = siteBuilding(bp[0], bp[1], ang, 28 + rnd() * 8, 11, 5);
    const ss = siteBuilding(sp[0], sp[1], ang + Math.PI / 2, 15, 7.5, 4);
    const gs = rnd() < 0.7 ? siteBuilding(gp[0], gp[1], 0, 6.8, 6.8, 3) : null;
    const yard = rect(x, z, ang, 18, 9);
    if (!R.free(yard, 0)) return false;
    const gate = P(-36, 0), lead = [P(-18, 0), P(-27, 0)];
    const L = place([fq], gate, 1.8, lead, () => {
      buildHouse(hs, 6.2, { chimney: true, type: 'farmhouse' });
      const roof = kind === 'glass' ? 0 : rnd() < 0.45 ? 7 : rnd() < 0.5 ? 3 : 11;
      if (bs) buildBarn(bs, 4.8, { roof, wall: kind === 'glass' ? 0 : 1, type: kind === 'glass' ? 'glasshouse' : 'barn' });
      if (ss) buildHouse(ss, 4.2, { wall: 8, pitch: 0.5, type: 'cart shed' });
      if (gs) buildGranary(gs, 10 + rnd() * 4);
      // the yard: setts between the ranges
      R.mark(yard, YARD, 0);
      drapeGrid(chunk(x, z), P, 18, 9, FIELD_COL[8], 8);
      records.yards.push({ q: yard, x, z, ang });
    });
    if (!L) return false;
    // the court's reservation stays; the parts of it not built on become the farm garden
    farms.push({ x, z, ang, r: 45, kind });
    stats.farms++;
    return true;
  };

  const along = (pts, step, fn) => {
    let acc = step * (0.4 + rnd() * 0.6);
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (acc <= L) { const f = acc / L; fn(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, (b[0] - a[0]) / L, (b[1] - a[1]) / L); acc += step * (0.7 + rnd() * 0.6); }
      acc -= L;
    }
  };
  const roadLines = [...plan.routes.map((r) => r.points), ...plan.localStreets.map((r) => r.points)];
  for (const pts of roadLines) along(pts, 240, (x, z, tx, tz) => {
    for (const sg of rnd() < 0.5 ? [1, -1] : [-1, 1]) {
      const off = 70 + rnd() * 70, fx = x - tz * sg * off, fz = z + tx * sg * off;
      if (!siteClear(fx, fz, 60) || farms.some((f) => Math.hypot(f.x - fx, f.z - fz) < 340)) continue;
      const fr = contourFrame(fx, fz);
      if (fr.slope > 0.15) continue;
      if (farmCourt(fx, fz, fr.ang, rnd() < 0.12 ? 'glass' : 'court')) break;
    }
  });
  // remote farms in the interior valleys, joined by longer lanes
  for (let k = 0; k < 420; k++) {
    const a = rnd() * TAU, rr = Math.sqrt(rnd()) * c.coast.s * 1.05, x = c.ix + Math.cos(a) * rr, z = c.iz + Math.sin(a) * rr;
    if (!siteClear(x, z, 80) || farms.some((f) => Math.hypot(f.x - x, f.z - z) < 460)) continue;
    const fr = contourFrame(x, z);
    if (fr.slope > 0.13 || renderedHeight(x, z) < 10) continue;
    farmCourt(x, z, fr.ang, 'court');
  }

  // ---- villas on the panoramic spurs: a house with its loggia, a formal garden and pool,
  // and a cypress drive
  const villas = [];
  const cypress = (C, x, z, y, h, r) => {
    C.cyp.tree(x, y, z, r, h, rnd() * TAU, 12);
    if (records.trees) records.trees.push({ x, z, y, r, h, cypress: true });
    stats.trees++;
  };
  const villa = (x, z) => {
    const fr = contourFrame(x, z), ang = fr.ang;
    const q = rect(x, z, ang, 40, 30);
    if (!R.free(q, 6)) return false;
    const g = groundRange(x, z, ang, 40, 30, 5);
    if (g.lo < 15 || g.hi - g.lo > 7) return false;
    const ax = Math.cos(ang), az = Math.sin(ang), sx = -az, sz = ax, P = (u, v) => [x + ax * u + sx * v, z + az * u + sz * v];
    const down = (fr.gx * sx + fr.gz * sz) >= 0 ? -1 : 1;     // v toward the view (downhill)
    const top = g.hi + 0.5;
    const gate = P(-46, 0), lead = [P(-40, 0)];
    const L = place([q], gate, 2.0, lead, () => {
      const C = chunk(x, z);
      // one levelled garden terrace carries house, garden and pool, walled in white stone
      C.arch.prism(q, g.lo - 1.5, top, 1, 3);
      records.buildings.push({ x, z, ang, L: 80, W: 60, lo: g.lo, base: top, q, type: 'villa terrace' });
      keepouts.push({ x, z, r: 52 });
      // the house on the uphill half; its loggia faces the view
      const hv = -down * 14, face = hv + down * 8;
      const hp = P(0, hv);
      C.arch.box(hp[0], hp[1], ax, az, 16, 8, top - 0.2, top + 7.4, 5, top);
      C.arch.box(hp[0], hp[1], ax, az, 16.6, 8.6, top + 7.4, top + 8.1, 1, top);
      C.arch.box(hp[0], hp[1], ax, az, 14.5, 6.6, top + 8.1, top + 8.5, 3, top);
      const colV = face + down * 3.4;
      for (let i = -3; i <= 3; i++) {
        const cp = P(i * 4.4, colV);
        C.arch.lathe([{ r: 0.5, y: top - 0.05, kind: 1 }, { r: 0.5, y: top + 0.35, kind: 1 }, { r: 0.33, y: top + 0.35, kind: 1 }, { r: 0.28, y: top + 5.9, kind: 1 }, { r: 0.48, y: top + 6.05, kind: 1 }, { r: 0.48, y: top + 6.3, kind: 1 }, { r: 0, y: top + 6.3, kind: 1 }], 8, cp[0], cp[1]);
      }
      // the loggia roof runs from inside the house face out over the columns
      const lp = P(0, face + down * 1.9);
      C.arch.box(lp[0], lp[1], ax, az, 15.4, 2.3, top + 6.3, top + 7.05, 1, top);
      // the pool: a basin frame round a sunken water slab, and the parterre beds
      const pp = P(-14, down * 12);
      for (const [du, dv, hu, hv2] of [[0, 3.3, 9.9, 0.3], [0, -3.3, 9.9, 0.3], [9.6, 0, 0.3, 3.0], [-9.6, 0, 0.3, 3.0]]) {
        const bp = [pp[0] + ax * du + sx * dv, pp[1] + az * du + sz * dv];
        C.arch.box(bp[0], bp[1], ax, az, hu, hv2, top - 0.2, top + 0.45, 1, top);
      }
      C.arch.box(pp[0], pp[1], ax, az, 9.3, 3.0, top - 0.2, top + 0.32, 6, top);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        const bp = P(6 + i * 9, down * (5 + j * 11));
        C.detail.box(bp[0], bp[1], ax, az, 3.4, 3.8, top - 0.05, top + 0.7, 3, top);
      }
      for (const [u, v] of [[-37, -down * 27], [37, -down * 27], [-37, down * 27], [37, down * 27]]) {
        const cp = P(u, v); cypress(C, cp[0], cp[1], top - 0.3, 11 + rnd() * 3, 1.3);
      }
    });
    if (!L) return false;
    // a cypress drive along the first stretch of the villa's lane
    let acc = 0;
    for (let k = 1; k < L.pts.length && acc < 150; k++) {
      const a = L.pts[k - 1], b = L.pts[k], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      acc += l;
      if (k % 3 || acc < 12) continue;
      const nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
      for (const sg of [-1, 1]) {
        const px = a[0] + nx * sg * (L.hw + 3.4), pz = a[1] + nz * sg * (L.hw + 3.4), cq = rect(px, pz, 0, 1.6, 1.6);
        if (!R.free(cq, 0, LANE) || !obstFree(cq) || renderedHeight(px, pz) < 4) continue;
        R.mark(cq, HARD, 0);
        let gy = Infinity; for (const p of cq) gy = Math.min(gy, renderedHeight(p[0], p[1]));
        cypress(chunk(px, pz), px, pz, gy - 0.2, 10 + rnd() * 3, 1.2);
      }
    }
    villas.push({ x, z, ang, top });
    stats.villas++;
    return true;
  };
  {
    const cands = [];
    for (let k = 0; k < 900; k++) {
      const a = rnd() * TAU, rr = Math.sqrt(rnd()) * c.coast.s, x = c.ix + Math.cos(a) * rr, z = c.iz + Math.sin(a) * rr, h = renderedHeight(x, z);
      if (h < 30 || h > c.ih * 0.85) continue;
      let ring = 0; for (let q = 0; q < 8; q++) ring += renderedHeight(x + Math.cos(q * TAU / 8) * 220, z + Math.sin(q * TAU / 8) * 220);
      const rel = h - ring / 8;          // convexity: spurs and shoulders with a view
      const fr = contourFrame(x, z);
      if (fr.slope > 0.12 || rel < 4) continue;
      cands.push({ x, z, score: rel - fr.slope * 60 + rnd() * 6 });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const s of cands) {
      if (villas.length >= 6 + Math.round(c.coast.s / 1400)) break;
      if (!siteClear(s.x, s.z, 90) || villas.some((v) => Math.hypot(v.x - s.x, v.z - s.z) < 1100) || farms.some((f) => Math.hypot(f.x - s.x, f.z - s.z) < 260)) continue;
      villa(s.x, s.z);
    }
  }

  // ---- tholos shrines on the knolls and the summit observatory ----------------------
  const shrines = [];
  const tholos = (x, z) => {
    const g = groundRange(x, z, 0, 11, 11, 2.2);
    if (g.hi - g.lo > 5 || g.lo < 20) return false;
    const fq = rect(x, z, 0, 12, 12);
    if (!R.free(fq, 3)) return false;
    const fr = contourFrame(x, z), dl = Math.hypot(fr.gx, fr.gz) || 1, dx = -fr.gx / dl, dz = -fr.gz / dl;
    const gate = [x + dx * 19, z + dz * 19], lead = [[x + dx * 11.5, z + dz * 11.5]];
    const L = place([fq], gate, 1.2, lead, () => {
      const C = chunk(x, z), b = g.hi + 0.3;
      C.stone.lathe([{ r: 11, y: g.lo - 1.2, kind: 1 }, { r: 11, y: b, kind: 1 }, { r: 11, y: b, kind: 9 }, { r: 0, y: b, kind: 9 }], 24, x, z);
      C.arch.lathe([{ r: 9.4, y: b - 0.05, kind: 1 }, { r: 9.4, y: b + 0.5, kind: 1 }, { r: 9.4, y: b + 0.5, kind: 9 }, { r: 8.6, y: b + 0.5, kind: 9 }, { r: 8.6, y: b + 0.5, kind: 1 }, { r: 8.6, y: b + 1.0, kind: 1 }, { r: 8.6, y: b + 1.0, kind: 9 }, { r: 0, y: b + 1.0, kind: 9 }], 24, x, z);
      const y = b + 1.0, H = 6.2;
      for (let k = 0; k < 10; k++) {
        const a = k * TAU / 10, px = x + Math.cos(a) * 6.6, pz = z + Math.sin(a) * 6.6;
        C.arch.lathe([{ r: 0.46, y: y - 0.05, kind: 1 }, { r: 0.46, y: y + 0.3, kind: 1 }, { r: 0.34, y: y + 0.3, kind: 1 }, { r: 0.29, y: y + H - 0.3, kind: 1 }, { r: 0.46, y: y + H - 0.25, kind: 1 }, { r: 0.46, y: y + H + 0.02, kind: 1 }, { r: 0, y: y + H + 0.02, kind: 1 }], 8, px, pz);
      }
      // entablature ring, a dome with a lantern finial, the altar stone at the centre
      C.arch.lathe([{ r: 5.8, y: y + H, kind: 1 }, { r: 7.4, y: y + H, kind: 1 }, { r: 7.4, y: y + H + 1.1, kind: 1 }, { r: 5.8, y: y + H + 1.1, kind: 1 }], 24, x, z, { closedProfile: true });
      const d = [{ r: 6.0, y: y + H + 1.05, kind: 1 }];
      for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; d.push({ r: Math.max(0.35, 6.9 * Math.cos(a)), y: y + H + 1.1 + Math.sin(a) * 4.2, kind: 1 }); }
      d.push({ r: 0.35, y: y + H + 6.2, kind: 2 }, { r: 0, y: y + H + 6.9, kind: 10 });
      C.arch.lathe(d, 24, x, z);
      C.arch.box(x, z, 1, 0, 0.8, 0.8, y - 0.05, y + 1.0, 1, y);
      R.mark(fq, HARD, 1);
      records.buildings.push({ x, z, ang: 0, L: 22, W: 22, lo: g.lo, base: b, q: rect(x, z, 0, 11, 11), type: 'tholos shrine' });
      keepouts.push({ x, z, r: 14 });
    });
    if (!L) return false;
    shrines.push({ x, z });
    stats.shrines++;
    return true;
  };
  {
    const cands = [];
    for (let k = 0; k < 1400; k++) {
      const a = rnd() * TAU, rr = Math.sqrt(rnd()) * c.coast.s * 0.95, x = c.ix + Math.cos(a) * rr, z = c.iz + Math.sin(a) * rr, h = renderedHeight(x, z);
      if (h < 40) continue;
      let ring = 0, top = true;
      for (let q = 0; q < 8; q++) { const hh = renderedHeight(x + Math.cos(q * TAU / 8) * 140, z + Math.sin(q * TAU / 8) * 140); ring += hh; if (hh > h) top = false; }
      if (!top) continue;
      cands.push({ x, z, h, rel: h - ring / 8 });
    }
    cands.sort((a, b) => b.rel - a.rel);
    for (const s of cands) {
      if (shrines.length >= 3 + Math.round(c.coast.s / 2500)) break;
      if (shrines.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 1300) || !siteClear(s.x, s.z, 40)) continue;
      tholos(s.x, s.z);
    }
  }
  const observatory = () => {
    if (c.id === 'thalassa') return;
    let best = null;
    for (let r = 0; r < c.coast.s; r += 60) for (let a = 0; a < TAU; a += 0.12) {
      const x = c.ix + Math.cos(a) * r, z = c.iz + Math.sin(a) * r, h = renderedHeight(x, z);
      if (!best || h > best.h) best = { x, z, h };
    }
    for (let tries = 0; tries < 60 && best; tries++) {
      const x = best.x + (tries ? (rnd() - 0.5) * 220 : 0), z = best.z + (tries ? (rnd() - 0.5) * 220 : 0);
      const ang = contourFrame(x, z).ang;
      const g = groundRange(x, z, ang, 24, 24, 3);
      const fq = rect(x, z, ang, 26, 26);
      if (g.hi - g.lo > 9 || !R.free(fq, 4)) continue;
      const ax = Math.cos(ang), az = Math.sin(ang), sx = -az, sz = ax;
      const gate = [x - ax * 33, z - az * 33], lead = [[x - ax * 24.6, z - az * 24.6]];
      const L = place([fq], gate, 1.6, lead, () => {
        const C = chunk(x, z), top = g.hi + 0.5;
        C.stone.box(x, z, ax, az, 24, 24, g.lo - 1.5, top, 1, g.lo - 1.5);
        // a parapet with its entrance toward the path (on the -u side)
        for (const [p0, p1] of [[[-23.7, -23.7], [23.7, -23.7]], [[23.7, -23.7], [23.7, 23.7]], [[23.7, 23.7], [-23.7, 23.7]]]) {
          const a = [x + ax * p0[0] + sx * p0[1], z + az * p0[0] + sz * p0[1]], b = [x + ax * p1[0] + sx * p1[1], z + az * p1[0] + sz * p1[1]];
          C.stone.wall(a[0], a[1], top - 0.1, top + 1.1, b[0], b[1], top - 0.1, top + 1.1, 0.5, 1);
        }
        for (const [v0, v1] of [[-23.45, -2.6], [2.6, 23.45]]) {
          const a = [x - ax * 23.7 + sx * v0, z - az * 23.7 + sz * v0], b = [x - ax * 23.7 + sx * v1, z - az * 23.7 + sz * v1];
          C.stone.wall(a[0], a[1], top - 0.1, top + 1.1, b[0], b[1], top - 0.1, top + 1.1, 0.5, 1);
        }
        // the great dome on its drum with a dark slit band, a smaller dome, the wing, a mast
        const dome = (du, dv, R0, H0, n) => {
          const X = x + ax * du + sx * dv, Z = z + az * du + sz * dv;
          const p = [{ r: R0, y: top - 0.05, kind: 5 }, { r: R0, y: top + H0, kind: 5 }, { r: R0, y: top + H0, kind: 1 }, { r: R0 * 1.06, y: top + H0, kind: 1 }, { r: R0 * 1.06, y: top + H0 + 0.6, kind: 1 }, { r: R0 * 0.98, y: top + H0 + 0.6, kind: 1 }];
          for (let i = 1; i <= 7; i++) { const a = (i / 7) * Math.PI / 2; p.push({ r: i === 7 ? 0 : R0 * 0.98 * Math.cos(a), y: top + H0 + 0.6 + Math.sin(a) * R0 * 0.95, kind: i === 3 || i === 4 ? 10 : 1 }); }
          C.arch.lathe(p, n, X, Z);
        };
        dome(4, -4, 10.5, 7.5, 28);
        dome(-12, 13, 5, 4.5, 20);
        const wp = [x + ax * 12 + sx * 12, z + az * 12 + sz * 12];
        C.arch.box(wp[0], wp[1], sx, sz, 9, 4, top - 0.05, top + 4.6, 5, top);
        C.arch.box(wp[0], wp[1], sx, sz, 9.4, 4.4, top + 4.6, top + 5.1, 1, top);
        const mp = [x + ax * 16 - sx * 16, z + az * 16 - sz * 16];
        C.arch.lathe([{ r: 0.9, y: top - 0.05, kind: 1 }, { r: 0.6, y: top + 16, kind: 10 }, { r: 0.6, y: top + 16, kind: 10 }, { r: 1.6, y: top + 16, kind: 10 }, { r: 1.6, y: top + 16.4, kind: 10 }, { r: 0.3, y: top + 16.4, kind: 2 }, { r: 0, y: top + 18, kind: 10 }], 10, mp[0], mp[1]);
        R.mark(fq, HARD, 2);
        records.buildings.push({ x, z, ang, L: 48, W: 48, lo: g.lo, base: top, q: rect(x, z, ang, 24, 24), type: 'observatory' });
        keepouts.push({ x, z, r: 36 });
      });
      if (!L) continue;
      shrines.push({ x, z });
      stats.observatories++;
      return;
    }
  };
  observatory();

  // ---- the farmland: a patchwork of fields laid on the contour ------------------------
  const fruitTree = (C, x, z, r, h, kind) => {
    let g = Infinity;
    for (let q = 0; q < 4; q++) g = Math.min(g, renderedHeight(x + Math.cos(q * 1.57) * 0.45, z + Math.sin(q * 1.57) * 0.45));
    C.trees.tree(x, g - 0.02, z, r, h, rnd() * TAU, kind);
    if (records.trees) records.trees.push({ x, z, y: g - 0.02, r, h });
    stats.trees++;
  };
  // crops cluster: a slow noise over the island decides which kinds of field a district grows
  const hsh = (i, j, s) => { const v = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
  const vnoise = (x, z, s) => {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hsh(i, j, s), b = hsh(i + 1, j, s), cc = hsh(i, j + 1, s), d = hsh(i + 1, j + 1, s);
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
  };
  const layField = (x, z, fr, hl, hw, kind, bounded) => {
    const ang = fr.ang, ax = Math.cos(ang), az = Math.sin(ang), sx = -az, sz = ax, C = chunk(x, z);
    const pk = kind === 'vine' ? 5 : kind === 'orchard' || kind === 'olive' ? 6 : kind;
    const tint = 0.88 + rnd() * 0.2, col = FIELD_COL[pk].map((v) => v * tint);
    const P = (u, v) => [x + ax * u + sx * v, z + az * u + sz * v];
    drapeGrid(C, P, hl, hw, col, pk);
    records.fields.push({ x, z, ang, hl, hw, kind: pk, crop: kind, q: rect(x, z, ang, hl, hw) });
    stats.fields++;
    // bounds: hedgerows on the gentle ground, dry-stone walls on the slopes, one gate gap
    const hedge = fr.slope < 0.08;
    if (bounded) {
      const e = 0.9;
      const edges = [[P(-hl + e, -hw + e), P(hl - e, -hw + e)], [P(hl - e, -hw + e), P(hl - e, hw - e)], [P(hl - e, hw - e), P(-hl + e, hw - e)], [P(-hl + e, hw - e), P(-hl + e, -hw + e)]];
      const gateEdge = Math.floor(rnd() * 4);
      edges.forEach(([a, b], k) => {
        const segs = k === gateEdge ? [[0, 0.45], [0.55, 1]] : [[0, 1]];
        for (const [f0, f1] of segs) {
          const p0 = [a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0], p1 = [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1];
          if (hedge) groundRun(C, p0, p1, 1.3, 1.1, 3, 16); else groundRun(C, p0, p1, 0.8, 0.55, 1, 16);
        }
      });
    }
    // terrace walls along the contour on the slopes (every ~1.6 m of fall)
    const terr = fr.slope > 0.09 && (kind === 'vine' || kind === 'olive');
    const step = Math.max(7, Math.min(20, 1.6 / Math.max(fr.slope, 1e-3)));
    if (terr) for (let v = -hw + step; v < hw - 3; v += step) groundRun(C, P(-hl + 2.5, v), P(hl - 2.5, v), 0.6, 0.5, 1, 16);
    // true when a row at v would stand within `gap` of a terrace wall
    const nearTerrace = (v, gap) => { const d = (v + hw) % step; return Math.min(d, step - d) < gap && v + hw > step - gap && v < hw - 3 + gap; };
    if (kind === 'vine') {
      stats.vineyards++;
      for (let v = -hw + 3; v < hw - 2.5; v += 3.2) {
        if (terr && nearTerrace(v, 1.1)) continue;
        groundRun(C, P(-hl + 3.5, v), P(hl - 3.5, v), 1.25, 0.6, 3, 16, 0.3);
      }
    } else if (kind === 'orchard' || kind === 'olive') {
      if (kind === 'olive') stats.olives++; else stats.orchards++;
      const sp = kind === 'olive' ? 10 : 8.5;
      const rows = [];
      if (terr) for (let v = -hw + step * 0.5; v < hw - 3; v += step) { if (step > 2 * sp) rows.push(v - sp / 2, v + sp / 2); else rows.push(v); }
      else for (let v = -hw + sp * 0.6; v < hw - sp * 0.6 + 0.01; v += sp) rows.push(v);
      for (const v of rows) {
        if (Math.abs(v) > hw - 3) continue;
        for (let u = -hl + sp * 0.6; u < hl - sp * 0.6 + 0.01; u += sp) {
          const [px, pz] = P(u + (rnd() - 0.5), v + (rnd() - 0.5) * 0.6);
          fruitTree(C, px, pz, kind === 'olive' ? 2.2 : 2.5, kind === 'olive' ? 4.4 : 5.0, kind === 'olive' ? 14 : 13);
        }
      }
    }
  };
  const cropFor = (x, z, slope) => {
    const n1 = vnoise(x / 520, z / 520, c.island * 3 + 1), n2 = vnoise(x / 260, z / 260, c.island * 3 + 2), r = rnd() * 0.35 + n2 * 0.65;
    if (slope > 0.13) return n1 > 0.62 ? 'vine' : n1 < 0.3 ? 'olive' : r < 0.5 ? 7 : null;
    if (slope > 0.075) return n1 > 0.66 ? 'vine' : n1 < 0.24 ? 'olive' : r < 0.25 ? 'orchard' : r < 0.7 ? 7 : 2;
    if (n1 > 0.7) return r < 0.4 ? 3 : r < 0.7 ? 1 : 7;           // the lavender and grain district
    if (n1 < 0.28) return r < 0.4 ? 9 : r < 0.7 ? 2 : 'orchard';   // market gardens round the farms
    return [1, 1, 2, 2, 4, 7, 7, 1, 2, 4][Math.floor(r * 9.99)];
  };
  const tryField = (x, z, big) => {
    if (renderedHeight(x, z) < 6) return false;
    const fr = contourFrame(x, z, 24);
    if (fr.slope > 0.2) return false;
    const crop = cropFor(x, z, fr.slope);
    if (crop === null) return false;
    const maxW = fr.slope > 0.1 ? Math.max(14, 1.6 / fr.slope * 1.6) : 48;
    for (const f of big ? [1, 0.7, 0.45] : [0.55, 0.35]) {
      const hl = (40 + rnd() * 70) * f + 16, hw = Math.max(12, Math.min(maxW, (20 + rnd() * 28) * f + 8));
      const q = rect(x, z, fr.ang, hl, hw);
      if (!R.free(q, 2.5)) continue;
      const g = groundRange(x, z, fr.ang, hl, hw, 12);
      if (g.lo < 4) continue;
      R.mark(q, FIELD, 0);
      layField(x, z, fr, hl, hw, crop, rnd() < 0.45);
      return true;
    }
    return false;
  };
  // first round the farms, the villas and the hill villages, then over all the cultivable land
  for (const f of farms) for (let t = 0; t < 26; t++) { const a = rnd() * TAU, rr = 48 + Math.sqrt(rnd()) * 330; tryField(f.x + Math.cos(a) * rr, f.z + Math.sin(a) * rr, true); }
  for (const v of villas) for (let t = 0; t < 10; t++) { const a = rnd() * TAU, rr = 60 + Math.sqrt(rnd()) * 240; tryField(v.x + Math.cos(a) * rr, v.z + Math.sin(a) * rr, false); }
  for (const s of plan.sites) for (let t = 0; t < 60; t++) { const a = rnd() * TAU, rr = (s.radius ?? 440) + 20 + Math.sqrt(rnd()) * 480; tryField(s.x + Math.cos(a) * rr, s.z + Math.sin(a) * rr, true); }
  {
    let top = 0;
    for (let x = c.ix - c.coast.s; x <= c.ix + c.coast.s; x += 90) for (let z = c.iz - c.coast.s; z <= c.iz + c.coast.s; z += 90) top = Math.max(top, renderedHeight(x, z));
    const cands = [], G = 34, E = c.coast.s * 1.12;
    for (let x = c.ix - E; x <= c.ix + E; x += G) for (let z = c.iz - E; z <= c.iz + E; z += G) {
      const px = x + (rnd() - 0.5) * G, pz = z + (rnd() - 0.5) * G, h = renderedHeight(px, pz);
      if (h < 7 || h > top * 0.56) continue;
      const zone = vnoise(px / 900, pz / 900, c.island * 3 + 7);
      if (zone < 0.42) continue;      // the open downs and grazing between the farmed basins
      if (R.get(px, pz)) continue;
      cands.push({ x: px, z: pz, s: zone + rnd() * 0.25 - h / top * 0.3 });
    }
    cands.sort((a, b) => b.s - a.s);
    for (const p of cands) tryField(p.x, p.z, true);
  }

  // ---- hill pastures: large dry-stone enclosures over the upper slopes and the downs ----
  {
    let top = 0;
    for (let x = c.ix - c.coast.s; x <= c.ix + c.coast.s; x += 120) for (let z = c.iz - c.coast.s; z <= c.iz + c.coast.s; z += 120) top = Math.max(top, renderedHeight(x, z));
    const cands = [];
    for (let k = 0; k < 2600; k++) {
      const a = rnd() * TAU, rr = Math.sqrt(rnd()) * c.coast.s, x = c.ix + Math.cos(a) * rr, z = c.iz + Math.sin(a) * rr, h = renderedHeight(x, z);
      if (h < top * 0.3 || h > top * 0.9) continue;
      cands.push({ x, z, s: rnd() });
    }
    cands.sort((a, b) => a.s - b.s);
    let made = 0;
    for (const p of cands) {
      if (made >= 20 + Math.round(c.coast.s / 250)) break;
      const fr = contourFrame(p.x, p.z, 30);
      if (fr.slope > 0.32) continue;
      const hl = 70 + rnd() * 70, hw = Math.min(90, Math.max(40, (fr.slope > 0.05 ? 9 / fr.slope : 90) * (0.5 + rnd() * 0.5)));
      const q = rect(p.x, p.z, fr.ang, hl, hw);
      if (!R.free(q, 4)) continue;
      const g = groundRange(p.x, p.z, fr.ang, hl, hw, 20);
      if (g.lo < 12) continue;
      R.mark(q, FIELD, 0);
      const C = chunk(p.x, p.z), ax = Math.cos(fr.ang), az = Math.sin(fr.ang), sx = -az, sz = ax, P = (u, v) => [p.x + ax * u + sx * v, p.z + az * u + sz * v];
      const e = 0.8, gap = Math.floor(rnd() * 4);
      [[P(-hl + e, -hw + e), P(hl - e, -hw + e)], [P(hl - e, -hw + e), P(hl - e, hw - e)], [P(hl - e, hw - e), P(-hl + e, hw - e)], [P(-hl + e, hw - e), P(-hl + e, -hw + e)]].forEach(([a, b], k) => {
        for (const [f0, f1] of k === gap ? [[0, 0.47], [0.53, 1]] : [[0, 1]]) groundRun(C, [a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0], [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1], 0.9, 0.6, 1, 16);
      });
      // a stone shepherd's shelter in one corner, on its own plinth
      const sp = P(-hl + 9, -hw + 7), ss = siteBuilding(sp[0], sp[1], fr.ang, 7, 5, 3, FIELD);
      if (ss) buildHouse(ss, 2.8, { wall: 1, roof: 11, pitch: 0.5, type: 'pasture shelter' });
      records.fields.push({ x: p.x, z: p.z, ang: fr.ang, hl, hw, kind: 0, crop: 'pasture', q });
      stats.pastures = (stats.pastures || 0) + 1;
      made++;
    }
  }

  // ---- meshes -------------------------------------------------------------------------
  const archMat = createFacadeMaterial(palette, seed, { litFrac: 0.45, colW: 2.8, floorH: 3.2, band: 1e5, uplight: 0, warmth: 0.8 });
  const P0 = prototypes(), instMat = instancedDetailMaterial();
  const cells = [...chunks.values()].map((C) => ({ layers: {
    arch: C.arch.geometry(), stone: C.stone.geometry(), detail: C.detail.geometry(), drape: C.drape.geometry(),
    walls: { inst: C.walls, proto: P0.box }, trees: { inst: C.trees, proto: P0.tree }, cyp: { inst: C.cyp, proto: P0.cypress },
  } }));
  const lod = buildLayerLOD(scene, cells, { arch: archMat, stone: detailMaterial(), detail: detailMaterial(), drape: drapeMaterial(), walls: instMat, trees: instMat, cyp: instMat }, [
    { dist: 0, layers: ['arch', 'stone', 'detail', 'drape', 'walls', 'trees', 'cyp'], cast: ['arch', 'stone', 'cyp'] },
    { dist: 1500, layers: ['arch', 'stone', 'drape', 'cyp'], cast: ['arch'] },
    { dist: 4200, layers: ['arch', 'drape'], cast: [] },
    { dist: 13000, layers: ['arch'], cast: [] },
    { dist: 22000, layers: [], cast: [] },
  ], `${c.name} countryside`);
  stats.instances = lod.instances; stats.tris = lod.tris;
  // a coarse (12 m) occupancy mask for the island woods and later queries
  const mask = { x0: R.x0, z0: R.z0, N: Math.ceil(R.N / 2), a: null };
  mask.a = new Uint8Array(mask.N * mask.N);
  for (let j = 0; j < R.N; j++) for (let i = 0; i < R.N; i++) { const v = R.a[j * R.N + i]; if (v >= LANE && v !== HARD) mask.a[(j >> 1) * mask.N + (i >> 1)] = 1; }
  const free = (x, z, r = 0) => {
    const s = OCC * 2, i0 = Math.floor((x - r - mask.x0) / s), i1 = Math.floor((x + r - mask.x0) / s), j0 = Math.floor((z - r - mask.z0) / s), j1 = Math.floor((z + r - mask.z0) / s);
    for (let j = Math.max(0, j0); j <= Math.min(mask.N - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(mask.N - 1, i1); i++) if (mask.a[j * mask.N + i]) return false;
    return true;
  };
  // the buildings, courts and aprons laid here are HARD in the raster: keep them (grown by
  // a few metres) in the woods mask as well
  const markMask = (q, m) => {
    const s = OCC * 2;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of q) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    for (let j = Math.max(0, Math.floor((z0 - m - mask.z0) / s)); j <= Math.min(mask.N - 1, Math.floor((z1 + m - mask.z0) / s)); j++)
      for (let i = Math.max(0, Math.floor((x0 - m - mask.x0) / s)); i <= Math.min(mask.N - 1, Math.floor((x1 + m - mask.x0) / s)); i++) mask.a[j * mask.N + i] = 1;
  };
  for (const b of records.buildings) markMask(b.q, 4);
  for (const a of records.ramps) markMask(a.quad, 2);
  for (const f of farms) markMask(rect(f.x, f.z, f.ang, 36, 27), 2);
  return { meshes: lod.meshes, tris: lod.tris, stats, records, free };
}
