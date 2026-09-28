import * as THREE from 'three';
import { latheFacade, loftSections, sweepTube } from '../geom.js';
import { sweepLoop } from '../platform.js';
import { renderedHeight } from '../outerCities.js';
import { SPECIES } from '../treeGeometry.js';

// The construction kit of the island cities (Thalassa, Anchorage, Orison).
//
// Every solid is closed by construction: a prism, a lathe, a loft, a swept section, an
// extruded profile or a ribbon, each emitting its own caps, soffits and ends with outward
// winding and unit normals, and each recorded as a separate index range so the audit can
// check it on its own (two solids that merely touch never share an edge in the check).
// Solids are written into buffers keyed by LOD tier (see outerLod.js: tier 0 draws only
// near, tier 3 everywhere) and by the 700 m LOD cell of their anchor, so each cell becomes a
// handful of merged meshes. Facade coordinates follow facade.js: walls carry (metres along
// the wall, metres up from the storey datum), flat faces their plan position.
//
// Everything stands on the surface actually drawn (renderedHeight): platforms are fill,
// never cut (their tops clear the highest ground under them, their feet go below the
// lowest), and the helpers here measure that ground densely.

export const K = { GLASS: 0, STONE: 1, LANTERN: 2, GARDEN: 3, CONDUIT: 4, PUNCHED: 5, POOL: 6, PV: 7, TIMBER: 8, PAVING: 9, METAL: 10, CERAMIC: 11, FRIT: 12 };
export const TAU = Math.PI * 2;
export const LOD_CELL = 700;
export const H = renderedHeight;

// ------------------------------------------------------------------- plan geometry --
export const rect = (x, z, w, d, a = 0) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [x + u * c - v * s, z + u * s + v * c]);
};
export const circlePoly = (x, z, r, n = 24, ph = 0) => Array.from({ length: n }, (_, k) => [x + Math.cos(ph + k * TAU / n) * r, z + Math.sin(ph + k * TAU / n) * r]);
export const area2 = (q) => { let a = 0; for (let i = 0; i < q.length; i++) { const p = q[i], r = q[(i + 1) % q.length]; a += p[0] * r[1] - r[0] * p[1]; } return a; };
export const centroid = (q) => { let x = 0, z = 0; for (const p of q) { x += p[0]; z += p[1]; } return [x / q.length, z / q.length]; };
export function pointInPoly(q, x, z) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const a = q[i], b = q[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export const segDist = (x, z, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
};
/** Convex polygons overlap (separating axes); `pad` > 0 demands that much clearance. */
export function convexOverlap(a, b, pad = 0) {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    let nx = -(q[1] - p[1]), nz = q[0] - p[0];
    const L = Math.hypot(nx, nz); if (L < 1e-9) continue; nx /= L; nz /= L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const v of a) { const d = v[0] * nx + v[1] * nz; if (d < a0) a0 = d; if (d > a1) a1 = d; }
    for (const v of b) { const d = v[0] * nx + v[1] * nz; if (d < b0) b0 = d; if (d > b1) b1 = d; }
    if (a1 + pad <= b0 + 1e-6 || b1 + pad <= a0 + 1e-6) return false;
  }
  return true;
}
/** Inset (d < 0) or outset (d > 0) a convex polygon by d along its edge normals. */
export function offsetConvex(q, d) {
  const s = Math.sign(area2(q)) || 1, n = q.length, lines = [];
  for (let i = 0; i < n; i++) {
    const a = q[i], b = q[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = ((b[1] - a[1]) / L) * s, nz = (-(b[0] - a[0]) / L) * s;          // outward
    lines.push({ p: [a[0] + nx * d, a[1] + nz * d], t: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i - 1 + n) % n], B = lines[i];
    const den = A.t[0] * B.t[1] - A.t[1] * B.t[0];
    if (Math.abs(den) < 1e-9) { out.push(B.p.slice()); continue; }
    const t = ((B.p[0] - A.p[0]) * B.t[1] - (B.p[1] - A.p[1]) * B.t[0]) / den;
    out.push([A.p[0] + A.t[0] * t, A.p[1] + A.t[1] * t]);
  }
  return out;
}
export const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * Triangulate a simple polygon keeping every vertex (strict ear clipping: a vertex lying on a
 * straight run is never dropped, so walls meeting the cap at it stay watertight). Returns
 * index triples; falls back to the library's ear clipping only if the polygon is degenerate.
 */
export function triangulate(q) {
  const n = q.length;
  if (n === 3) return [[0, 1, 2]];
  const s = Math.sign(area2(q)) || 1;
  let scale = 0; for (const p of q) scale = Math.max(scale, Math.abs(p[0] - q[0][0]), Math.abs(p[1] - q[0][1]));
  const eps = 1e-10 * scale * scale;
  const cr = (a, b, c) => s * ((q[b][0] - q[a][0]) * (q[c][1] - q[a][1]) - (q[b][1] - q[a][1]) * (q[c][0] - q[a][0]));
  const act = q.map((_, i) => i), out = [];
  let guard = 0;
  while (act.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let k = 0; k < act.length; k++) {
      const a = act[(k - 1 + act.length) % act.length], b = act[k], c = act[(k + 1) % act.length];
      if (cr(a, b, c) <= eps) continue;
      let ok = true;
      for (const j of act) {
        if (j === a || j === b || j === c) continue;
        if (q[j][0] === q[a][0] && q[j][1] === q[a][1] || q[j][0] === q[c][0] && q[j][1] === q[c][1]) continue;
        if (cr(a, b, j) >= -eps && cr(b, c, j) >= -eps && cr(c, a, j) >= -eps) { ok = false; break; }
      }
      if (!ok) continue;
      out.push([a, b, c]); act.splice(k, 1); clipped = true; break;
    }
    if (!clipped) break;
  }
  if (act.length === 3 && cr(act[0], act[1], act[2]) > eps) { out.push([act[0], act[1], act[2]]); return out; }
  if (act.length === 3) return out;
  return THREE.ShapeUtils.triangulateShape(q.map((p) => new THREE.Vector2(p[0], p[1])), []);
}

// ---------------------------------------------------------------------- the ground --
/** Lowest and highest drawn ground under a polygon: its outline every `step` metres and an
 *  interior grid at the same spacing. */
export function groundRange(q, step = 3) {
  let min = Infinity, max = -Infinity;
  const s = (x, z) => { const h = renderedHeight(x, z); if (h < min) min = h; if (h > max) max = h; };
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) s(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n);
    x0 = Math.min(x0, a[0]); x1 = Math.max(x1, a[0]); z0 = Math.min(z0, a[1]); z1 = Math.max(z1, a[1]);
  }
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) if (pointInPoly(q, x, z)) s(x, z);
  return { min, max };
}
/** Drawn ground along a segment's width: max and min over a strip of half width hw. */
export function stripRange(a, b, hw, step = 3) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L * hw, nz = dx / L * hw;
  return groundRange([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]], step);
}

/** A smoothed height field over a region: for laying out contours, not for seating. */
export class Field {
  constructor(x0, z0, cell, nx, nz, fn = renderedHeight) {
    Object.assign(this, { x0, z0, cell, nx, nz });
    this.v = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) this.v[j * nx + i] = fn(x0 + i * cell, z0 + j * cell);
  }
  blur(sigma) {
    const r = Math.ceil((sigma * 2.5) / this.cell), w = [];
    let sum = 0; for (let k = -r; k <= r; k++) { const g = Math.exp(-0.5 * ((k * this.cell) / sigma) ** 2); w.push(g); sum += g; }
    const { nx, nz } = this, t = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let a = 0; for (let k = -r; k <= r; k++) a += w[k + r] * this.v[j * nx + Math.min(nx - 1, Math.max(0, i + k))]; t[j * nx + i] = a / sum; }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let a = 0; for (let k = -r; k <= r; k++) a += w[k + r] * t[Math.min(nz - 1, Math.max(0, j + k)) * nx + i]; this.v[j * nx + i] = a / sum; }
    return this;
  }
  at(x, z) {
    const fx = Math.min(this.nx - 1.001, Math.max(0, (x - this.x0) / this.cell)), fz = Math.min(this.nz - 1.001, Math.max(0, (z - this.z0) / this.cell));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, w = fz - j, n = this.nx;
    const a = this.v[j * n + i], b = this.v[j * n + i + 1], c = this.v[(j + 1) * n + i], d = this.v[(j + 1) * n + i + 1];
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  }
}

// --------------------------------------------------------------------- occupancy --
/** Plan footprints (convex polygons) of everything built, filed on a grid, with a layer tag. */
export class Occupancy {
  constructor(cell = 48) { this.cell = cell; this.grid = new Map(); this.items = []; }
  _box(q) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const p of q) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } return [x0, z0, x1, z1]; }
  add(q, tag = 'solid', data) {
    const it = { q, tag, data, box: this._box(q), id: this.items.length };
    this.items.push(it);
    const c = this.cell, [x0, z0, x1, z1] = it.box;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
      const k = i * 100003 + j; let l = this.grid.get(k); if (!l) this.grid.set(k, (l = [])); l.push(it);
    }
    return it;
  }
  /** Items whose footprint comes within pad of q (optionally only those passing `filter`). */
  query(q, pad = 0, filter) {
    const c = this.cell, [x0, z0, x1, z1] = this._box(q), seen = new Set(), out = [];
    for (let i = Math.floor((x0 - pad) / c); i <= Math.floor((x1 + pad) / c); i++) for (let j = Math.floor((z0 - pad) / c); j <= Math.floor((z1 + pad) / c); j++) {
      for (const it of this.grid.get(i * 100003 + j) || []) {
        if (seen.has(it.id)) continue; seen.add(it.id);
        if (filter && !filter(it)) continue;
        if (it.box[0] > x1 + pad || it.box[2] < x0 - pad || it.box[1] > z1 + pad || it.box[3] < z0 - pad) continue;
        if (convexOverlap(it.q, q, pad)) out.push(it);
      }
    }
    return out;
  }
  free(q, pad = 0, filter) { return this.query(q, pad, filter).length === 0; }
}

// ------------------------------------------------------------------------ meshing --
class Buf {
  constructor(tier, mat, cx, cz) { Object.assign(this, { tier, mat, cx, cz }); this.pos = []; this.nrm = []; this.fac = []; this.idx = []; this.solids = []; }
}
const _v = new THREE.Vector3();

export class Kit {
  constructor(name) {
    this.name = name;
    this.bufs = new Map();
    this.b = null;
    this.open = null;
    this.trees = [];        // TreeField records (far: true)
    this.keepout = [];      // circles for ground cover and the island woods
    this.solidCount = 0;
    this.tier = 3; this.mat = 'main';
  }
  /** Direct the following solids to (tier, material) at the LOD cell of (x, z). */
  at(x, z, tier = this.tier, mat = this.mat) {
    const cx = Math.floor(x / LOD_CELL), cz = Math.floor(z / LOD_CELL), key = `${tier}|${mat}|${cx},${cz}`;
    let b = this.bufs.get(key);
    if (!b) this.bufs.set(key, (b = new Buf(tier, mat, (cx + 0.5) * LOD_CELL, (cz + 0.5) * LOD_CELL)));
    this.b = b;
    return this;
  }
  with(tier, mat = 'main') { this.tier = tier; this.mat = mat; return this; }
  _begin(meta) { if (this.open) return false; this.open = { b: this.b, i0: this.b.idx.length, meta }; return true; }
  _end() { const o = this.open; this.open = null; o.b.solids.push([o.i0, o.b.idx.length, o.meta]); this.solidCount++; }
  /** Run fn as one closed solid (for composite solids assembled from faces). */
  solid(meta, fn) { const own = this._begin(meta); fn(); if (own) this._end(); }
  v(x, y, z, nx, ny, nz, u, w, kind) {
    const b = this.b, i = b.pos.length / 3;
    const l = Math.hypot(nx, ny, nz);
    if (l > 1e-9) { nx /= l; ny /= l; nz /= l; } else { nx = 0; ny = 1; nz = 0; }
    b.pos.push(x, y, z); b.nrm.push(nx, ny, nz); b.fac.push(u, w, kind);
    return i;
  }
  /** Triangle wound to face along n (degenerate ones dropped). */
  tri(a, b, c, n) {
    const P = this.b.pos;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * gx + gy * gy + gz * gz < 1e-12) return;
    if (gx * n[0] + gy * n[1] + gz * n[2] >= 0) this.b.idx.push(a, b, c); else this.b.idx.push(a, c, b);
  }
  quad(a, b, c, d, n) { this.tri(a, b, c, n); this.tri(a, c, d, n); }

  /** Flat polygon face through 3D points p (in order round the face) facing n, facade (u, w) given per point. */
  face(p, n, kind, uv) {
    const ids = p.map((q, i) => this.v(q[0], q[1], q[2], n[0], n[1], n[2], uv ? uv[i][0] : q[0], uv ? uv[i][1] : q[2], kind));
    if (p.length === 3) { this.tri(ids[0], ids[1], ids[2], n); return; }
    if (p.length === 4) { this.quad(ids[0], ids[1], ids[2], ids[3], n); return; }
    // general planar polygon: triangulate in its own plane
    const ax = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : (Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2);
    const [i0, i1] = ax === 0 ? [2, 1] : ax === 1 ? [0, 2] : [0, 1];
    const tris = triangulate(p.map((q) => [q[i0], q[i1]]));
    for (const [a, b, c] of tris) this.tri(ids[a], ids[b], ids[c], n);
  }

  // ------------------------------------------------------------------ primitives --
  /**
   * Upright prism over the plan polygon q (any simple polygon) from y0 to y1 (numbers or
   * per-vertex arrays). Walls carry (metres along from uBase, metres above vBase).
   */
  prism(q, y0, y1, { wall = K.STONE, top = K.PAVING, bottom = K.STONE, vBase = 0, uBase = 0, meta = null, noBottom = false } = {}) {
    const own = this._begin(meta);
    const n = q.length, s = Math.sign(area2(q)) || 1;
    const Y0 = Array.isArray(y0) ? y0 : q.map(() => y0), Y1 = Array.isArray(y1) ? y1 : q.map(() => y1);
    let u = uBase;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = q[i], b = q[j], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-7) continue;
      const nx = ((b[1] - a[1]) / L) * s, nz = (-(b[0] - a[0]) / L) * s, N = [nx, 0, nz];
      const i0 = this.v(a[0], Y0[i], a[1], nx, 0, nz, u, Y0[i] - vBase, wall), i1 = this.v(b[0], Y0[j], b[1], nx, 0, nz, u + L, Y0[j] - vBase, wall);
      const i2 = this.v(b[0], Y1[j], b[1], nx, 0, nz, u + L, Y1[j] - vBase, wall), i3 = this.v(a[0], Y1[i], a[1], nx, 0, nz, u, Y1[i] - vBase, wall);
      this.quad(i0, i1, i2, i3, N);
      u += L;
    }
    this._cap(q, Y1, top, true);
    if (!noBottom) this._cap(q, Y0, bottom, false);
    if (own) this._end();
    return this;
  }
  _cap(q, Y, kind, up) {
    const tris = triangulate(q);
    const flat = Y.every((y) => y === Y[0]);
    const N = [0, up ? 1 : -1, 0];
    if (flat) {
      const ids = q.map((p, i) => this.v(p[0], Y[i], p[1], 0, N[1], 0, p[0], p[1], kind));
      for (const [a, b, c] of tris) this.tri(ids[a], ids[b], ids[c], N);
      return;
    }
    for (const t of tris) {
      const P = t.map((k) => [q[k][0], Y[k], q[k][1]]);
      const u = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], w = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      if ((n[1] > 0) !== up) n = n.map((x) => -x);
      const ids = P.map((p) => this.v(p[0], p[1], p[2], n[0], n[1], n[2], p[0], p[2], kind));
      this.tri(ids[0], ids[1], ids[2], n);
    }
  }
  box(x, z, w, d, a, y0, y1, opts) { return this.prism(rect(x, z, w, d, a), y0, y1, opts); }

  /**
   * A plan profile extruded along a horizontal direction: prof is a simple polygon of
   * (s, y) points in the vertical plane through O spanned by the unit A (horizontal) and up;
   * the solid runs across it along the horizontal unit B from b0 to b1. kinds(i) names the
   * material of the face on profile edge i (from point i to i + 1).
   */
  extrude(prof, O, A, B, b0, b1, { kinds = () => K.STONE, capKind = K.STONE, meta = null, capTris = null } = {}) {
    const own = this._begin(meta);
    const s = Math.sign(area2(prof)) || 1, n = prof.length;
    const P = (p, b) => [O[0] + A[0] * p[0] + B[0] * b, p[1], O[1] + A[1] * p[0] + B[1] * b];
    const sideN = (b) => { const sg = (b === b1 ? 1 : -1) * Math.sign(b1 - b0); return [B[0] * sg, 0, B[1] * sg]; };
    for (let i = 0; i < n; i++) {
      const p = prof[i], q = prof[(i + 1) % n], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < 1e-7) continue;
      // outward normal of the edge in (s, y) is (dy, -ds) for a counter-clockwise profile
      const ns = ((q[1] - p[1]) / L) * s, ny = (-(q[0] - p[0]) / L) * s;
      const N = [A[0] * ns, ny, A[1] * ns];
      const kind = kinds(i), horiz = Math.abs(ny) > 0.7;
      // flat faces carry their plan position, the others (metres across, metres up)
      const uv = (X, pp, b) => (horiz ? [X[0], X[2]] : [b - b0, pp[1]]);
      const ids = [[p, b0], [q, b0], [q, b1], [p, b1]].map(([pp, b]) => { const X = P(pp, b), t = uv(X, pp, b); return this.v(X[0], X[1], X[2], N[0], N[1], N[2], t[0], t[1], kind); });
      this.quad(ids[0], ids[1], ids[2], ids[3], N);
    }
    // (ear clipping drops collinear vertices, so profiles with them pass their own triangles)
    const tris = capTris || triangulate(prof);
    for (const b of [b0, b1]) {
      const N = sideN(b);
      const ids = prof.map((p) => { const X = P(p, b); return this.v(X[0], X[1], X[2], N[0], 0, N[2], p[0], p[1], capKind); });
      for (const [a, c, d] of tris) this.tri(ids[a], ids[c], ids[d], N);
    }
    if (own) this._end();
    return this;
  }

  /** Append a built geometry (lathe, loft, tube, sweep) translated by (x, 0, z), as one solid. */
  geometry(g, meta = null, dx = 0, dz = 0) {
    const own = this._begin(meta);
    const b = this.b, base = b.pos.length / 3;
    const p = g.attributes.position, nr = g.attributes.normal, f = g.attributes.aFacade;
    for (let i = 0; i < p.count; i++) {
      b.pos.push(p.getX(i) + dx, p.getY(i), p.getZ(i) + dz);
      _v.set(nr.getX(i), nr.getY(i), nr.getZ(i)); if (!(_v.lengthSq() > 1e-12)) _v.set(0, 1, 0); _v.normalize();
      b.nrm.push(_v.x, _v.y, _v.z);
      b.fac.push(f.getX(i), f.getY(i), f.getZ(i));
    }
    const idx = g.index;
    if (idx) for (let i = 0; i < idx.count; i++) b.idx.push(base + idx.getX(i));
    else for (let i = 0; i < p.count; i++) b.idx.push(base + i);
    g.dispose();
    if (own) this._end();
    return this;
  }
  /** Solid of revolution: prof [[r, y, kind], ...] bottom to top, closed on the axis or capped. */
  lathe(x, z, prof, seg = 16, opts = {}) {
    const pr = prof.map((p) => (Array.isArray(p) ? { r: p[0], y: p[1], kind: p[2] ?? K.STONE } : { ...p }));
    // a tip or foot narrower than a few centimetres closes on the axis: a cap that small
    // collapses in single precision far from the origin
    if (!opts.closedProfile) for (const e of [pr[0], pr[pr.length - 1]]) if (e.r < 0.25) e.r = 0;
    const g = latheFacade(pr, seg, opts);
    return this.geometry(g, opts.meta ?? null, x, z);
  }
  loft(sections, opts = {}) { return this.geometry(loftSections(sections, opts), opts.meta ?? null); }
  tube(points, r, radial = 8, opts = {}) { return this.geometry(sweepTube(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]))), typeof r === 'function' ? r : () => r, radial, opts), opts.meta ?? null); }
  /** A section swept along an open polyline and closed at both ends (sea walls, moles, copings). */
  sweep(path, section, opts = {}) { return this.geometry(sweepLoop(path, section, { closed: false, closeSection: true, capEnds: true, capKind: K.STONE, ...opts }), opts.meta ?? null); }
  /**
   * A parapet round a roof outline q (counter-clockwise or not): a closed ring of thickness t
   * standing inside the outline from y to y + h.
   */
  parapet(q, y, h = 1.0, t = 0.35, { kind = K.STONE, meta = { role: 'parapet', supported: true } } = {}) {
    const ccw = area2(q) > 0, loop = ccw ? q.slice().reverse() : q.slice();
    // sweepLoop offsets toward the right of travel; a clockwise loop has its inside on the right
    return this.geometry(sweepLoop(loop, () => [{ a: [0, y - 0.02], b: [t, y - 0.02], kind }, { a: [t, y - 0.02], b: [t, y + h], kind }, { a: [t, y + h], b: [0, y + h], kind }, { a: [0, y + h], b: [0, y - 0.02], kind }], { closed: true, closeSection: false }), meta);
  }

  /**
   * A closed ribbon: sections [{l: [x, z], r: [x, z], y, yb}] with its walking top (kind top,
   * facade u along / v across), side walls down to yb, a soffit and both ends.
   */
  ribbon(S, { top = K.PAVING, side = K.STONE, bottom = K.STONE, meta = null, sideV = 0 } = {}) {
    const own = this._begin(meta);
    const n = S.length, along = [0];
    for (let i = 1; i < n; i++) {
      const m0 = lerp2(S[i - 1].l, S[i - 1].r, 0.5), m1 = lerp2(S[i].l, S[i].r, 0.5);
      along.push(along[i - 1] + Math.hypot(m1[0] - m0[0], m1[1] - m0[1]));
    }
    // top: shared vertices down each edge, normals from the local surface
    const topN = (i) => {
      const a = S[Math.max(0, i - 1)], b = S[Math.min(n - 1, i + 1)], m0 = lerp2(a.l, a.r, 0.5), m1 = lerp2(b.l, b.r, 0.5);
      const t = [m1[0] - m0[0], b.y - a.y, m1[1] - m0[1]], w = [S[i].l[0] - S[i].r[0], 0, S[i].l[1] - S[i].r[1]];
      let N = [t[1] * w[2] - t[2] * w[1], t[2] * w[0] - t[0] * w[2], t[0] * w[1] - t[1] * w[0]];
      if (N[1] < 0) N = N.map((x) => -x);
      return N;
    };
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const N = topN(i), s = S[i], hw = Math.hypot(s.l[0] - s.r[0], s.l[1] - s.r[1]) / 2;
      L.push(this.v(s.l[0], s.y, s.l[1], N[0], N[1], N[2], along[i], -hw, top));
      R.push(this.v(s.r[0], s.y, s.r[1], N[0], N[1], N[2], along[i], hw, top));
    }
    for (let i = 1; i < n; i++) { const N = topN(i); this.quad(L[i - 1], R[i - 1], R[i], L[i], N[1] > 0 ? N : [0, 1, 0]); }
    // soffit
    for (let i = 1; i < n; i++) {
      const a = S[i - 1], b = S[i];
      this.face([[a.l[0], a.yb, a.l[1]], [a.r[0], a.yb, a.r[1]], [b.r[0], b.yb, b.r[1]], [b.l[0], b.yb, b.l[1]]], [0, -1, 0], bottom);
    }
    // side walls: outward is toward l for the left edge
    for (const e of ['l', 'r']) for (let i = 1; i < n; i++) {
      const a = S[i - 1], b = S[i], o = e === 'l' ? 'r' : 'l';
      const out = [(a[e][0] - a[o][0]) + (b[e][0] - b[o][0]), 0, (a[e][1] - a[o][1]) + (b[e][1] - b[o][1])];
      this.face([[a[e][0], a.yb, a[e][1]], [b[e][0], b.yb, b[e][1]], [b[e][0], b.y, b[e][1]], [a[e][0], a.y, a[e][1]]], out, side,
        [[along[i - 1], a.yb - sideV], [along[i], b.yb - sideV], [along[i], b.y - sideV], [along[i - 1], a.y - sideV]]);
    }
    // ends
    for (const i of [0, n - 1]) {
      const s = S[i], o = S[i === 0 ? 1 : n - 2], m = lerp2(s.l, s.r, 0.5), mo = lerp2(o.l, o.r, 0.5);
      const out = [m[0] - mo[0], 0, m[1] - mo[1]], hw = Math.hypot(s.l[0] - s.r[0], s.l[1] - s.r[1]) / 2;
      this.face([[s.l[0], s.yb, s.l[1]], [s.r[0], s.yb, s.r[1]], [s.r[0], s.y, s.r[1]], [s.l[0], s.y, s.l[1]]], out, side, [[-hw, s.yb], [hw, s.yb], [hw, s.y], [-hw, s.y]]);
    }
    if (own) this._end();
    return this;
  }

  // ------------------------------------------------------------ architectural parts --
  /** Gabled roof over the rectangle (x, z, w along the ridge, d across, angle a) from eaves y. */
  gable(x, z, w, d, a, y, rise, { roof = K.CERAMIC, end = K.STONE, meta = null } = {}) {
    const A = [Math.cos(a), Math.sin(a)], B = [-Math.sin(a), Math.cos(a)];
    const O = [x - B[0] * d / 2, z - B[1] * d / 2];
    // profile across the ridge in the (B, up) plane, extruded along A
    return this.extrude([[0, y], [d, y], [d / 2, y + rise]], O, B, A, -w / 2, w / 2, { kinds: (i) => (i === 0 ? K.STONE : roof), capKind: end, meta });
  }
  /** Hipped roof: rectangle w x d at eaves y, ridge along w of length w - d (pyramid when w <= d). */
  hip(x, z, w, d, a, y, rise, { roof = K.CERAMIC, meta = null } = {}) {
    const own = this._begin(meta);
    const c = Math.cos(a), s = Math.sin(a), W = (u, v, yy) => [x + u * c - v * s, yy, z + u * s + v * c];
    const r = Math.max(0, (w - d) / 2);
    const E = [W(-w / 2, -d / 2, y), W(w / 2, -d / 2, y), W(w / 2, d / 2, y), W(-w / 2, d / 2, y)], T0 = W(-r, 0, y + rise), T1 = W(r, 0, y + rise);
    const fn = (p) => { const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]; let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; if (n[1] < 0) n = n.map((q) => -q); return n; };
    // facade (along the eave, up the slope)
    const put = (pts) => { const n = fn(pts), hl = Math.hypot(n[0], n[2]) || 1, e = [-n[2] / hl, n[0] / hl], k = Math.hypot(hl, n[1]) / Math.max(1e-6, hl); this.face(pts, n, roof, pts.map((p) => [p[0] * e[0] + p[2] * e[1], (p[1] - y) * k])); };
    if (r > 1e-6) {
      put([E[0], E[1], T1, T0]); put([E[2], E[3], T0, T1]); put([E[1], E[2], T1]); put([E[3], E[0], T0]);
    } else { put([E[0], E[1], T0]); put([E[1], E[2], T0]); put([E[2], E[3], T0]); put([E[3], E[0], T0]); }
    this.face(E.slice().reverse(), [0, -1, 0], K.STONE);
    if (own) this._end();
    return this;
  }
  /** Barrel vault along w over the rectangle, springing at y (closed ends and floor). */
  vault(x, z, w, d, a, y, rise, { kind = K.CERAMIC, end = K.STONE, seg = 10, meta = null } = {}) {
    const A = [Math.cos(a), Math.sin(a)], B = [-Math.sin(a), Math.cos(a)], O = [x - B[0] * d / 2, z - B[1] * d / 2];
    // the arc runs from s = d back over to s = 0
    const arc = [];
    for (let i = 1; i < seg; i++) { const t = (i / seg) * Math.PI; arc.push([d / 2 + (Math.cos(t) * d) / 2, y + Math.sin(t) * rise]); }
    return this.extrude([[0, y], [d, y], ...arc], O, B, A, -w / 2, w / 2, { kinds: (i) => (i === 0 ? K.STONE : kind), capKind: end, meta });
  }
  /** Dome on a drum: a lathe from the drum foot at y (radius r) to the lantern tip. */
  dome(x, z, r, y, drumH, rise, { drum = K.STONE, shell = K.STONE, lantern = true, seg = 24, meta = null, tipKind = K.LANTERN } = {}) {
    const p = [[r, y, drum], [r, y + drumH, drum], [r * 1.05, y + drumH, K.STONE], [r * 1.05, y + drumH + 0.9, K.STONE], [r, y + drumH + 0.9, shell]];
    for (let i = 1; i <= 8; i++) { const t = (i / 8) * (Math.PI / 2) * 0.93; p.push([Math.max(0.05, r * Math.cos(t)), y + drumH + 0.9 + Math.sin(t) * rise, shell]); }
    const top = p[p.length - 1];
    if (lantern) { const lr = Math.max(0.6, r * 0.14); p.push([lr, top[1], shell], [lr, top[1] + lr * 1.6, tipKind], [lr * 1.2, top[1] + lr * 1.7, K.STONE], [0.05, top[1] + lr * 2.6, K.STONE]); }
    else p.push([0.05, top[1] + r * 0.05, shell]);
    return this.lathe(x, z, p, seg, { meta });
  }
  column(x, z, y, h, r = 0.5, { seg = 8, kind = K.STONE, meta = null } = {}) {
    return this.lathe(x, z, [[r * 1.35, y, kind], [r * 1.35, y + r * 0.8, kind], [r, y + r * 0.8, kind], [r * 0.86, y + h - r * 0.9, kind], [r * 1.4, y + h - r * 0.5, kind], [r * 1.4, y + h, kind]], seg, { meta });
  }
  /** Street lamp (post, arm-less lantern). Kind 2 heads glow at night. */
  lamp(x, z, y, h = 5.5) {
    return this.lathe(x, z, [[0.16, y, K.METAL], [0.16, y + 0.5, K.METAL], [0.07, y + 0.6, K.METAL], [0.06, y + h - 0.6, K.METAL], [0.22, y + h - 0.5, K.LANTERN], [0.22, y + h, K.LANTERN], [0.3, y + h + 0.05, K.METAL], [0.02, y + h + 0.25, K.METAL]], 6, { meta: { role: 'lamp', supported: true } });
  }
  /** A planted tree for TreeField (rooted at y: its flare must stand on that surface). */
  tree(x, y, z, sp, s, rnd, extra = {}) {
    const v = 0.85 + rnd() * 0.3;
    this.trees.push({ x, y: y - 0.1, z, s, sp, rot: rnd() * TAU, lean: rnd() * 0.03, tint: [v * (0.9 + rnd() * 0.16), v * (0.92 + rnd() * 0.16), v * (0.88 + rnd() * 0.14)], far: true, ...extra });
  }
  crownR(sp, s) { return SPECIES[sp].shape[2] * s * 0.5; }
  keep(x, z, r) { this.keepout.push({ x, z, r }); }

  // --------------------------------------------------------------------------- out --
  /** One BufferGeometry per (tier, material, cell) with its solids recorded for the audit. */
  finish() {
    const out = [];
    for (const b of this.bufs.values()) {
      if (!b.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute('aFacade', new THREE.Float32BufferAttribute(b.fac, 3));
      g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.userData.islandTier = b.tier;
      g.userData.islandMaterial = b.mat;
      g.userData.islandAnchor = [b.cx, b.cz];
      g.userData.islandSolids = b.solids;
      g.userData.islandKit = this.name;
      out.push(g);
    }
    this.bufs.clear();
    return out;
  }
}
