import * as THREE from 'three';

// Built ground for the Outer Wards: signed-distance grids, their contours, and the walls
// and surfaces made from them.
//
// A ward's platform is described by 2D signed distance fields in its local frame (metres,
// negative inside): the built region (its boundary is the sea wall), the street level (its
// boundary is the terrace wall above the quay), and any raised terraces. Fields are
// composed from primitives (lobed discs, capsules, rounded boxes, polylines) with union and
// subtraction, rasterised onto a grid, and contoured with marching squares. Every wall is a
// cross-section swept along a contour, and every flat surface is the contour polygon (with
// its holes) triangulated, so harbour basins, canals, piers, moles and terraces all come out
// of the same machinery with no surface laid over another.

const TAU = Math.PI * 2;

// ------------------------------------------------------------- primitives --
// Each returns { bbox: [x0, z0, x1, z1], d: (x, z) => signed distance }.
export const SD = {
  circle(cx, cz, r) {
    return { bbox: [cx - r, cz - r, cx + r, cz + r], d: (x, z) => Math.hypot(x - cx, z - cz) - r };
  },
  /** Rounded box centred at (cx, cz), half extents hw (local x) and hd (local z), turned by rot. */
  rbox(cx, cz, hw, hd, rot = 0, round = 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const R = Math.hypot(hw, hd);
    const rr = Math.min(round, hw, hd);
    return {
      bbox: [cx - R, cz - R, cx + R, cz + R],
      d: (x, z) => {
        const dx = x - cx, dz = z - cz;
        const lx = Math.abs(dx * c + dz * s) - (hw - rr), lz = Math.abs(-dx * s + dz * c) - (hd - rr);
        return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0) - rr;
      },
    };
  },
  capsule(ax, az, bx, bz, r) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    return {
      bbox: [Math.min(ax, bx) - r, Math.min(az, bz) - r, Math.max(ax, bx) + r, Math.max(az, bz) + r],
      d: (x, z) => {
        let t = ((x - ax) * dx + (z - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        return Math.hypot(x - ax - dx * t, z - az - dz * t) - r;
      },
    };
  },
  /** Polyline with a half width (optionally varying: r(t) over 0..1 of its length). */
  polyline(pts, r) {
    const segs = [];
    let L = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push([pts[i - 1], pts[i], L, l]); L += l; }
    const rf = typeof r === 'function' ? r : () => r;
    let rmax = 0; for (let k = 0; k <= 20; k++) rmax = Math.max(rmax, rf(k / 20));
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const p of pts) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
    return {
      bbox: [x0 - rmax, z0 - rmax, x1 + rmax, z1 + rmax],
      segs, length: L, rf,
      d: (x, z) => {
        let best = 1e9;
        for (const [a, b, s0, l] of segs) {
          const dx = b[0] - a[0], dz = b[1] - a[1];
          let t = ((x - a[0]) * dx + (z - a[1]) * dz) / (l * l || 1e-9);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) - rf((s0 + l * t) / (L || 1));
          if (d < best) best = d;
        }
        return best;
      },
    };
  },
  /** Arbitrary closed polygon (exact distance, sign by crossing number). */
  polygon(pts) {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const p of pts) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
    return {
      bbox: [x0, z0, x1, z1],
      d: (x, z) => {
        let best = 1e18, inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[j], b = pts[i];
          const dx = b[0] - a[0], dz = b[1] - a[1];
          let t = ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1e-9);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = x - a[0] - dx * t, qz = z - a[1] - dz * t;
          best = Math.min(best, qx * qx + qz * qz);
          if ((a[1] > z) !== (b[1] > z) && x < a[0] + ((z - a[1]) * dx) / (dz || 1e-12)) inside = !inside;
        }
        return inside ? -Math.sqrt(best) : Math.sqrt(best);
      },
    };
  },
  /** Radial shape: distance-like field of r(a) around a centre (lobed outlines, annuli). */
  radial(cx, cz, rOf, rmax) {
    return { bbox: [cx - rmax, cz - rmax, cx + rmax, cz + rmax], d: (x, z) => Math.hypot(x - cx, z - cz) - rOf(Math.atan2(z - cz, x - cx)) };
  },
};

// ----------------------------------------------------------------- grid --
export class SDFGrid {
  /** Square grid over [-half, half]² with samples every `cell` metres, clamped to ±M. */
  constructor(half, cell = 5, M = 72) {
    this.half = half; this.cell = cell; this.M = M;
    this.n = Math.ceil((2 * half) / cell) + 1;
    this.o = -half;
    this.d = new Float32Array(this.n * this.n).fill(M);
  }
  clone() { const g = new SDFGrid(this.half, this.cell, this.M); g.d.set(this.d); return g; }

  _range(bb, pad) {
    const { cell, n, o } = this;
    return [
      Math.max(0, Math.floor((bb[0] - pad - o) / cell)), Math.min(n - 1, Math.ceil((bb[2] + pad - o) / cell)),
      Math.max(0, Math.floor((bb[1] - pad - o) / cell)), Math.min(n - 1, Math.ceil((bb[3] + pad - o) / cell)),
    ];
  }

  /** op: 'set' (whole grid), 'union', 'sub' (carve), 'inter' (whole grid), 'smooth' (union, blend k). */
  apply(op, prim, k = 0) {
    const { cell, n, o, d, M } = this;
    if (prim.segs && (op === 'union' || op === 'sub') && prim.rf) {
      // polylines: rasterise segment by segment (min over segments is the polyline's distance)
      for (const [a, b, s0, l] of prim.segs) {
        const r0 = prim.rf(s0 / (prim.length || 1)), r1 = prim.rf((s0 + l) / (prim.length || 1));
        const rr = Math.max(r0, r1);
        const [i0, i1, j0, j1] = this._range([Math.min(a[0], b[0]) - rr, Math.min(a[1], b[1]) - rr, Math.max(a[0], b[0]) + rr, Math.max(a[1], b[1]) + rr], M);
        const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9;
        for (let j = j0; j <= j1; j++) {
          const z = o + j * cell;
          for (let i = i0; i <= i1; i++) {
            const x = o + i * cell;
            let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            let v = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) - (r0 + (r1 - r0) * t);
            v = v < -M ? -M : v > M ? M : v;
            const q = j * n + i;
            if (op === 'union') { if (v < d[q]) d[q] = v; } else if (-v > d[q]) d[q] = -v;
          }
        }
      }
      return this;
    }
    const whole = op === 'set' || op === 'inter';
    const [i0, i1, j0, j1] = whole ? [0, n - 1, 0, n - 1] : this._range(prim.bbox, M + k);
    for (let j = j0; j <= j1; j++) {
      const z = o + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = o + i * cell;
        let v = prim.d(x, z);
        v = v < -M ? -M : v > M ? M : v;
        const q = j * n + i;
        if (op === 'set') d[q] = v;
        else if (op === 'union') { if (v < d[q]) d[q] = v; }
        else if (op === 'sub') { if (-v > d[q]) d[q] = -v; }
        else if (op === 'inter') { if (v > d[q]) d[q] = v; }
        else if (op === 'smooth') {
          const a = d[q], h = Math.max(k - Math.abs(a - v), 0) / k;
          d[q] = Math.min(a, v) - h * h * k * 0.25;
        }
      }
    }
    return this;
  }
  union(p) { return this.apply('union', p); }
  sub(p) { return this.apply('sub', p); }
  /** Combine with another grid of the same layout: fn(a, b) per sample. */
  combine(g, fn) { for (let q = 0; q < this.d.length; q++) this.d[q] = fn(this.d[q], g.d[q]); return this; }
  offset(v) { for (let q = 0; q < this.d.length; q++) this.d[q] += v; return this; }

  /** Bilinear sample (outside the grid: +M). */
  sample(x, z) {
    const { cell, n, o, d, M } = this;
    const fx = (x - o) / cell, fz = (z - o) / cell;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= n - 1 || j >= n - 1) return M;
    const tx = fx - i, tz = fz - j;
    const q = j * n + i;
    return (d[q] * (1 - tx) + d[q + 1] * tx) * (1 - tz) + (d[q + n] * (1 - tx) + d[q + n + 1] * tx) * tz;
  }

  /**
   * Closed iso-contours (marching squares, saddles resolved by the cell centre). Loops are
   * oriented with the inside (value < iso) on their left: outer boundaries run anticlockwise
   * in (x, z), holes clockwise. Points are simplified to `tol` metres.
   */
  contours(iso = 0, tol = 0.2) {
    const { n, d, cell, o } = this;
    const adj = new Map();
    const link = (a, b) => {
      let la = adj.get(a); if (!la) adj.set(a, la = []); la.push(b);
      let lb = adj.get(b); if (!lb) adj.set(b, lb = []); lb.push(a);
    };
    const K = (i, j, h) => (j * n + i) * 2 + h;       // h 0: edge (i,j)-(i+1,j); 1: (i,j)-(i,j+1)
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const q = j * n + i;
        const va = d[q], vb = d[q + 1], vc = d[q + n + 1], vd = d[q + n];
        const code = (va < iso ? 1 : 0) | (vb < iso ? 2 : 0) | (vc < iso ? 4 : 0) | (vd < iso ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const B = K(i, j, 0), R = K(i + 1, j, 1), T = K(i, j + 1, 0), L = K(i, j, 1);
        switch (code) {
          case 1: case 14: link(L, B); break;
          case 2: case 13: link(B, R); break;
          case 3: case 12: link(L, R); break;
          case 4: case 11: link(R, T); break;
          case 6: case 9: link(B, T); break;
          case 7: case 8: link(L, T); break;
          case 5: { const c = (va + vb + vc + vd) * 0.25 < iso; if (c) { link(B, R); link(T, L); } else { link(L, B); link(R, T); } break; }
          case 10: { const c = (va + vb + vc + vd) * 0.25 < iso; if (c) { link(L, B); link(R, T); } else { link(B, R); link(T, L); } break; }
        }
      }
    }
    const P = (k) => {
      const h = k & 1, q = k >> 1, i = q % n, j = (q - i) / n;
      const a = d[q], b = h ? d[q + n] : d[q + 1];
      const t = Math.min(Math.max((iso - a) / ((b - a) || 1e-9), 0), 1);
      return h ? [o + i * cell, o + (j + t) * cell] : [o + (i + t) * cell, o + j * cell];
    };
    const seen = new Set();
    const loops = [];
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const loop = [];
      let prev = -1, cur = start;
      for (let guard = 0; guard < 1e7; guard++) {
        seen.add(cur);
        loop.push(P(cur));
        const nb = adj.get(cur);
        const nx = nb[0] !== prev ? nb[0] : nb[1];
        prev = cur; cur = nx;
        if (cur === undefined || cur === start) break;
      }
      if (loop.length < 4) continue;
      let pts = simplifyClosed(loop, tol);
      if (pts.length < 3) continue;
      // orient: the inside on the left of the first long segment
      let k0 = 0, best = 0;
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l > best) { best = l; k0 = k; }
      }
      const a = pts[k0], b = pts[(k0 + 1) % pts.length];
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const lx = -(b[1] - a[1]) / best, lz = (b[0] - a[0]) / best;
      const e = Math.min(cell * 0.3, best * 0.4);
      if (this.sample(mx + lx * e, mz + lz * e) >= iso) pts.reverse();
      loops.push(pts);
    }
    return loops;
  }
}

/** Douglas-Peucker on a closed loop, then drop near-duplicate points. */
export function simplifyClosed(pts, tol) {
  const n = pts.length;
  if (n < 8) return pts.slice();
  // split at the two mutually far points
  let a = 0, b = 0, best = -1;
  for (let k = 0; k < n; k++) { const dd = (pts[k][0] - pts[0][0]) ** 2 + (pts[k][1] - pts[0][1]) ** 2; if (dd > best) { best = dd; b = k; } }
  best = -1;
  for (let k = 0; k < n; k++) { const dd = (pts[k][0] - pts[b][0]) ** 2 + (pts[k][1] - pts[b][1]) ** 2; if (dd > best) { best = dd; a = k; } }
  if (a > b) [a, b] = [b, a];
  const keep = new Uint8Array(n);
  keep[a] = keep[b] = 1;
  const dp = (i0, i1) => {
    // indices along the loop from i0 to i1 (i1 may wrap past n)
    const stack = [[i0, i1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      if (e - s < 2) continue;
      const A = pts[s % n], Bp = pts[e % n];
      const dx = Bp[0] - A[0], dz = Bp[1] - A[1], L = Math.hypot(dx, dz) || 1e-9;
      let md = -1, mi = -1;
      for (let k = s + 1; k < e; k++) {
        const p = pts[k % n];
        const dd = Math.abs((p[0] - A[0]) * dz - (p[1] - A[1]) * dx) / L;
        if (dd > md) { md = dd; mi = k; }
      }
      if (md > tol) { keep[mi % n] = 1; stack.push([s, mi], [mi, e]); }
    }
  };
  dp(a, b);
  dp(b, a + n);
  const out = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[k]);
  // also keep a vertex at least every 24 m so long gentle curves stay smooth for normals
  const res = [];
  for (let k = 0; k < out.length; k++) {
    const p = out[k], q = out[(k + 1) % out.length];
    res.push(p);
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const m = Math.floor(L / 24);
    for (let s = 1; s <= m; s++) { const t = s / (m + 1); res.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  const clean = [];
  for (const p of res) { const l = clean[clean.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.35) clean.push(p); }
  if (clean.length > 2 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) < 0.35) clean.pop();
  return clean;
}

export function loopArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }

export function pointInLoop(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j], b = pts[i];
    if ((a[1] > z) !== (b[1] > z) && x < a[0] + ((z - a[1]) * (b[0] - a[0])) / ((b[1] - a[1]) || 1e-12)) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------- geometry --
/**
 * Sweep a cross-section along a closed loop (inside on its left, outward = right).
 * section(x, z, k) returns faces [{ a: [o, y], b: [o, y], kind }] (o = metres outward),
 * always the same number of faces; each face's normal is (dy, -do) in (outward, up).
 * ox, oz: the loop's frame origin in world space.
 */
export function sweepLoop(loop, section, { ox = 0, oz = 0, closed = true, u0 = 0 } = {}) {
  const n = loop.length;
  const nrm = [];
  for (let k = 0; k < n; k++) {
    const p = loop[(k - 1 + n) % n], c = loop[k], q = loop[(k + 1) % n];
    let ax = c[0] - p[0], az = c[1] - p[1], bx = q[0] - c[0], bz = q[1] - c[1];
    if (!closed && k === 0) { ax = bx; az = bz; }
    if (!closed && k === n - 1) { bx = ax; bz = az; }
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    // right normals of the two segments, averaged; mitred so offsets stay parallel
    const r1x = az / la, r1z = -ax / la, r2x = bz / lb, r2z = -bx / lb;
    let mx = r1x + r2x, mz = r1z + r2z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const cosH = Math.max(mx * r1x + mz * r1z, 0.55);
    nrm.push([mx, mz, 1 / cosH]);
  }
  const arc = [u0];
  for (let k = 1; k <= n; k++) arc.push(arc[k - 1] + Math.hypot(loop[k % n][0] - loop[k - 1][0], loop[k % n][1] - loop[k - 1][1]));
  const secs = [];
  for (let k = 0; k < n; k++) secs.push(section(loop[k][0], loop[k][1], k));
  const F = secs[0].length;
  const pos = [], nor = [], fac = [], idx = [];
  const segs = closed ? n : n - 1;
  for (let f = 0; f < F; f++) {
    const base = pos.length / 3;
    for (let k = 0; k <= segs; k++) {
      const kk = k % n;
      const [mx, mz, miter] = nrm[kk];
      const face = secs[kk][f];
      // a face collapsed to a point here (a parapet gap) borrows its direction from the
      // nearest station where it has length, so no vertex carries a zero normal
      let fs = face;
      for (let j = 1; j < n && Math.hypot(fs.b[0] - fs.a[0], fs.b[1] - fs.a[1]) < 1e-5; j++) {
        const c1 = secs[(kk + j) % n][f], c2 = secs[(kk - j + n) % n][f];
        fs = Math.hypot(c1.b[0] - c1.a[0], c1.b[1] - c1.a[1]) >= 1e-5 ? c1 : c2;
      }
      const dO = fs.b[0] - fs.a[0], dY = fs.b[1] - fs.a[1];
      const L = Math.hypot(dO, dY);
      const no = L > 1e-5 ? dY / L : 0, ny = L > 1e-5 ? -dO / L : 1;
      const horiz = Math.abs(ny) > 0.7;
      for (const [o, y] of [face.a, face.b]) {
        pos.push(ox + loop[kk][0] + mx * o * miter, y, oz + loop[kk][1] + mz * o * miter);
        nor.push(mx * no, ny, mz * no);
        fac.push(arc[k], horiz ? o : y, face.kind);
      }
    }
    for (let k = 0; k < segs; k++) {
      const a = base + k * 2, b = a + 1, c = a + 2, e = a + 3;
      idx.push(a, c, b, b, c, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(fixWinding(pos, nor, idx));
  return g;
}

/** Flip any triangle whose winding disagrees with its first vertex normal. */
export function fixWinding(pos, nor, idx) {
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dn = nx * (nor[a * 3] + nor[b * 3] + nor[c * 3]) + ny * (nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1]) + nz * (nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2]);
    if (dn < 0) { idx[t + 1] = c; idx[t + 2] = b; }
  }
  return idx;
}

/**
 * Group oriented loops into polygons with holes: outer loops (positive area) each take the
 * holes (negative area) whose first point they contain (innermost outer wins).
 */
export function nestLoops(loops, minArea = 20) {
  const outers = [], holes = [];
  for (const l of loops) {
    const A = loopArea(l);
    if (Math.abs(A) < minArea) continue;
    (A > 0 ? outers : holes).push({ pts: l, A: Math.abs(A) });
  }
  outers.sort((a, b) => a.A - b.A);
  const polys = outers.map((o) => ({ outer: o.pts, holes: [], A: o.A }));
  for (const h of holes) {
    const p = h.pts[0];
    const host = polys.find((q) => q.A > h.A && pointInLoop(p[0], p[1], q.outer));
    if (host) host.holes.push(h.pts);
  }
  return polys;
}

/**
 * Flat surface at height y over polygons with holes. aFacade = (world x, world z, kind)
 * unless `facade` is false (then only positions and up normals).
 */
export function capPolys(polys, y, kind, { ox = 0, oz = 0, facade = true } = {}) {
  const pos = [], idx = [], fac = [], nor = [];
  for (const P of polys) {
    const contour = P.outer.map((p) => new THREE.Vector2(p[0], p[1]));
    const holes = P.holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { continue; }
    const base = pos.length / 3;
    const all = [...P.outer, ...P.holes.flat()];
    for (const p of all) {
      pos.push(ox + p[0], y, oz + p[1]);
      nor.push(0, 1, 0);
      if (facade) fac.push(ox + p[0], oz + p[1], kind);
    }
    for (const [a, b, c] of tris) {
      const pa = all[a], pb = all[b], pc = all[c];
      const cross = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      // (x, z) with y up: cross > 0 faces down
      if (cross < 0) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (facade) g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  return g;
}

/** Resample a loop between arc lengths s0..s1 (open polyline), wrapping. */
export function loopSpan(loop, s0, s1) {
  const n = loop.length;
  const cum = [0];
  for (let k = 1; k <= n; k++) cum.push(cum[k - 1] + Math.hypot(loop[k % n][0] - loop[k - 1][0], loop[k % n][1] - loop[k - 1][1]));
  const L = cum[n];
  const at = (s) => {
    s = ((s % L) + L) % L;
    let k = 0;
    while (k < n - 1 && cum[k + 1] < s) k++;
    const t = (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1);
    const a = loop[k], b = loop[(k + 1) % n];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const out = [];
  const m = Math.max(2, Math.ceil(Math.abs(s1 - s0) / 3));
  for (let i = 0; i <= m; i++) out.push(at(s0 + ((s1 - s0) * i) / m));
  return { pts: out, length: L };
}

/** Arc length along a loop of the point nearest (x, z), and its distance. */
export function nearestOnLoop(loop, x, z) {
  const n = loop.length;
  let best = 1e18, bs = 0, s = 0;
  for (let k = 0; k < n; k++) {
    const a = loop[k], b = loop[(k + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = (x - a[0] - dx * t) ** 2 + (z - a[1] - dz * t) ** 2;
    if (d < best) { best = d; bs = s + Math.sqrt(l2) * t; }
    s += Math.sqrt(l2);
  }
  return { s: bs, d: Math.sqrt(best), length: s };
}

export { TAU };
