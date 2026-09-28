import { K, H, groundRange, stripRange, lerp2, centroid, area2 } from './kit.js';

// A terraced district on a curvilinear grid, the way hill towns are built:
//   rows    streets along the contours (u = U(v) in the city frame P(u, v)), level-ish, graded
//           to at most `grade` along their length and never below the drawn ground
//   lanes   straight stepped lanes up the fall line (constant v) between two rows
//   plots   two plot rows per block: the lower one fronting the street below it, the upper one
//           fronting the street above; each plot a fill terrace (its top clears the highest
//           ground under it and is never below its street frontage, its foot below the lowest)
// Every joint is exact: a lane's ends are the chords of the row streets between two of their
// sections, a plot's front edge is a chord of its street, its sides lie on the lane edges,
// and the two plot rows share the block's middle line. Neighbouring solids abut face to face.
//
// D: { P(u, v) -> [x, z], rows: [{ U(v), v0, v1, w }], cols: [{ v, w, via }], grade,
//      blockOk(i, j, quad) -> bool, plotWidths(rnd) -> number, rnd,
//      viaY(i, side) -> fixed height of row i where it meets the via (side -1 | 1), or undefined }
// Returns the plan (rows, lanes, plots with heights) for the caller to build on.

const EPS = 1e-9;

/** Upper hull of profile points [[s, y], ...] (s ascending): the taut line above them all. */
export function upperHull(pts) {
  const h = [];
  for (const p of pts) {
    while (h.length >= 2) {
      const a = h[h.length - 2], b = h[h.length - 1];
      if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0) h.pop(); else break;
    }
    h.push(p);
  }
  return h;
}
/** Minimal profile >= lo with |slope| <= g (the raising envelope). ys, lo aligned with s. */
export function envelope(s, lo, g) {
  const y = lo.slice();
  for (let k = 1; k < y.length; k++) y[k] = Math.max(y[k], y[k - 1] - g * (s[k] - s[k - 1]));
  for (let k = y.length - 2; k >= 0; k--) y[k] = Math.max(y[k], y[k + 1] - g * (s[k + 1] - s[k]));
  return y;
}

export function planDistrict(D) {
  const { P, rows, cols, rnd } = D;
  const grade = D.grade ?? 0.07;
  const nR = rows.length, nC = cols.length;
  // --------------------------------------------------------------- blocks and plots
  const blocks = [];
  const edge = (i, v, side) => rows[i].U(v) + side * rows[i].w / 2;      // side +1: uphill edge of row i
  for (let i = 0; i < nR - 1; i++) {
    for (let j = 0; j < nC - 1; j++) {
      const va = cols[j].v + cols[j].w / 2, vb = cols[j + 1].v - cols[j + 1].w / 2;
      if (vb - va < 10) continue;
      if (va < Math.max(rows[i].v0, rows[i + 1].v0) || vb > Math.min(rows[i].v1, rows[i + 1].v1)) continue;
      const d0 = edge(i + 1, va, -1) - edge(i, va, 1), d1 = edge(i + 1, vb, -1) - edge(i, vb, 1);
      if (Math.min(d0, d1) < 14) continue;
      const quad = [P(edge(i, va, 1), va), P(edge(i, vb, 1), vb), P(edge(i + 1, vb, -1), vb), P(edge(i + 1, va, -1), va)];
      const civic = D.civic ? D.civic(i, j, quad, { va, vb }) : null;
      if (!civic && !D.blockOk(i, j, quad, { va, vb })) continue;
      blocks.push({ i, j, va, vb, quad, depth: Math.min(d0, d1), civic });
    }
  }
  const blockAt = new Map(blocks.map((b) => [`${b.i},${b.j}`, b]));
  // civic groups must be rectangles of blocks (rows i0..i1 by columns j0..j1, not across the
  // via); any other shape is split into its rows' contiguous runs
  {
    const byId = new Map();
    for (const b of blocks) if (b.civic) { if (!byId.has(b.civic)) byId.set(b.civic, []); byId.get(b.civic).push(b); }
    for (const [id, list] of byId) {
      const i0 = Math.min(...list.map((b) => b.i)), i1 = Math.max(...list.map((b) => b.i)), j0 = Math.min(...list.map((b) => b.j)), j1 = Math.max(...list.map((b) => b.j));
      let rect = list.length === (i1 - i0 + 1) * (j1 - j0 + 1);
      for (let j = j0 + 1; j <= j1; j++) if (cols[j].via) rect = false;
      if (rect) continue;
      for (const b of list) {
        let j = b.j; while (j > 0 && blockAt.get(`${b.i},${j - 1}`)?.civic === id && !cols[j].via) j--;
        b.civic = `${id}:${b.i}:${j}`;
      }
    }
  }
  // a civic place is a group of blocks; the streets and lanes inside a group are not built
  const sameCivic = (a, b) => a && b && a.civic && a.civic === b.civic;
  const serves = (i, j) => { const lo = blockAt.get(`${i - 1},${j}`), hi = blockAt.get(`${i},${j}`); return (lo || hi) && !sameCivic(lo, hi); };
  // plot boundaries along v per block; the same breaks are sections of both streets
  for (const b of blocks) {
    if (b.civic) { b.breaks = [b.va, b.vb]; b.L = b.vb - b.va; continue; }
    const L = b.vb - b.va, breaks = [b.va];
    let v = b.va;
    while (b.vb - v > 0) {
      let w = D.plotWidths(rnd, b);
      if (b.vb - (v + w) < w * 0.6) w = b.vb - v;             // the last plot takes the remainder
      v = Math.min(b.vb, v + w); breaks.push(v);
    }
    b.breaks = breaks; b.L = L;
    b.split = b.depth >= 34;                                   // two plot rows, else one fronting the lower street
  }
  // ------------------------------------------------------------------ row streets
  // A row street serves the blocks below and above it; it continues across a lane only
  // where it serves blocks on both sides, and it stops at the via's edges.
  const streets = [];
  for (let i = 0; i < nR; i++) {
    const served = [];
    for (let j = 0; j < nC - 1; j++) if (serves(i, j)) served.push(j);
    // group consecutive block intervals; the lane between them is crossed (unless it is the via)
    let run = null;
    const runs = [];
    for (const j of served) {
      if (run && run.j1 === j - 1 && !cols[j].via) run.j1 = j;
      else { run = { j0: j, j1: j }; runs.push(run); }
    }
    for (const r of runs) {
      // extent: from the far edge of the first lane to the far edge of the last (lanes at the
      // run's ends are served by this street too), or the via edge
      const c0 = cols[r.j0], c1 = cols[r.j1 + 1];
      let v0 = c0.via ? c0.v + c0.w / 2 : c0.v - c0.w / 2, v1 = c1.via ? c1.v - c1.w / 2 : c1.v + c1.w / 2;
      v0 = Math.max(v0, rows[i].v0); v1 = Math.min(v1, rows[i].v1);
      if (v1 - v0 < 8) continue;
      const vs = new Set([v0, v1]);
      for (let j = r.j0; j <= r.j1 + 1; j++) { const c = cols[j]; for (const e of [c.v - c.w / 2, c.v + c.w / 2]) if (e >= v0 - EPS && e <= v1 + EPS) vs.add(e); }
      for (let j = r.j0; j <= r.j1; j++) for (const k of [`${i - 1},${j}`, `${i},${j}`]) { const b = blockAt.get(k); if (b) for (const v of b.breaks) vs.add(v); }
      let list = [...vs].sort((a, b) => a - b);
      // regular sections every 8 m between breaks
      const all = [];
      for (let k = 0; k < list.length; k++) {
        all.push(list[k]);
        if (k < list.length - 1) { const n = Math.floor((list[k + 1] - list[k]) / 8); for (let q = 1; q < n; q++) all.push(list[k] + ((list[k + 1] - list[k]) * q) / n); }
      }
      list = all.filter((v, k) => k === 0 || v - all[k - 1] > 0.05);
      streets.push({ i, v0, v1, vs: list, w: rows[i].w, j0: r.j0, j1: r.j1 });
    }
  }
  // street heights: the highest ground under each segment, graded, junctions level
  for (const s of streets) {
    const row = rows[s.i], n = s.vs.length;
    s.pts = s.vs.map((v) => ({ v, l: P(row.U(v) - row.w / 2, v), r: P(row.U(v) + row.w / 2, v), c: P(row.U(v), v) }));
    const lo = new Array(n).fill(-Infinity), gmin = new Array(n).fill(Infinity);
    for (let k = 0; k < n - 1; k++) {
      const a = s.pts[k], b = s.pts[k + 1], g = groundRangeQuad(a, b);
      lo[k] = Math.max(lo[k], g.max + 0.25); lo[k + 1] = Math.max(lo[k + 1], g.max + 0.25);
      gmin[k] = Math.min(gmin[k], g.min); gmin[k + 1] = Math.min(gmin[k + 1], g.min);
    }
    // arc length along the street centre
    const sl = [0];
    for (let k = 1; k < n; k++) sl.push(sl[k - 1] + Math.hypot(s.pts[k].c[0] - s.pts[k - 1].c[0], s.pts[k].c[1] - s.pts[k - 1].c[1]));
    s.s = sl; s.lo = lo; s.gmin = gmin;
  }
  // level junctions: both edges of every lane opening share one height
  const levelJunctions = (s, y) => {
    for (let j = s.j0; j <= s.j1 + 1; j++) {
      const c = cols[j]; if (c.via) continue;
      const ka = s.vs.findIndex((v) => Math.abs(v - (c.v - c.w / 2)) < 1e-6), kb = s.vs.findIndex((v) => Math.abs(v - (c.v + c.w / 2)) < 1e-6);
      if (ka < 0 || kb < 0) continue;
      let m = -Infinity; for (let k = ka; k <= kb; k++) m = Math.max(m, y[k]);
      for (let k = ka; k <= kb; k++) y[k] = m;
    }
    return y;
  };
  for (const s of streets) {
    let y = envelope(s.s, s.lo, grade);
    y = levelJunctions(s, y);
    y = envelope(s.s, y, grade);
    s.req = y;               // what the ground asks of it before the via is fixed
  }
  // the via joins: its landing at row i takes the higher of its own needs and the streets'
  const viaNeed = new Map();
  for (const s of streets) for (const [end, k] of [[s.v0, 0], [s.v1, s.vs.length - 1]]) {
    const c = cols.find((q) => q.via && Math.abs(Math.abs(end - q.v) - q.w / 2) < 1e-6);
    if (!c) continue;
    const key = s.i; viaNeed.set(key, Math.max(viaNeed.get(key) ?? -Infinity, s.req[k]));
    (s.viaEnds ||= []).push(k);
  }
  const viaY = D.resolveVia ? D.resolveVia(viaNeed) : new Map();
  for (const s of streets) {
    const lo = s.lo.slice();
    for (const k of s.viaEnds || []) lo[k] = Math.max(lo[k], viaY.get(s.i) ?? s.req[k]);
    let y = envelope(s.s, lo, grade);
    y = levelJunctions(s, y);
    y = envelope(s.s, y, grade);
    // the via landing is exactly the street's end
    for (const k of s.viaEnds || []) if (viaY.has(s.i)) y[k] = Math.max(y[k], viaY.get(s.i));
    s.y = y;
    s.yb = s.gmin.map((g, k) => Math.min(g, y[k]) - 1.2);
  }
  const streetAt = (i, v) => { for (const s of streets) if (s.i === i && v >= s.v0 - 1e-6 && v <= s.v1 + 1e-6) return s; return null; };
  const heightOn = (s, v) => {
    const k = s.vs.findIndex((q) => Math.abs(q - v) < 1e-6);
    if (k >= 0) return s.y[k];
    let a = 0; while (a < s.vs.length - 2 && s.vs[a + 1] < v) a++;
    const t = (v - s.vs[a]) / (s.vs[a + 1] - s.vs[a]);
    return s.y[a] + (s.y[a + 1] - s.y[a]) * t;
  };
  // ------------------------------------------------------------------------ lanes
  const lanes = [];
  for (let i = 0; i < nR - 1; i++) for (let j = 0; j < nC; j++) {
    const c = cols[j]; if (c.via) continue;
    const bl = blockAt.get(`${i},${j - 1}`), br = blockAt.get(`${i},${j}`);
    if ((!bl && !br) || sameCivic(bl, br)) continue;
    const va = c.v - c.w / 2, vb = c.v + c.w / 2;
    const s0 = streetAt(i, va), s0b = streetAt(i, vb), s1 = streetAt(i + 1, va), s1b = streetAt(i + 1, vb);
    if (!s0 || s0 !== s0b || !s1 || s1 !== s1b) continue;
    const ya = heightOn(s0, va), yb = heightOn(s1, va);
    const a0 = P(rows[i].U(va) + rows[i].w / 2, va), a1 = P(rows[i].U(vb) + rows[i].w / 2, vb);
    const b0 = P(rows[i + 1].U(va) - rows[i + 1].w / 2, va), b1 = P(rows[i + 1].U(vb) - rows[i + 1].w / 2, vb);
    lanes.push({ i, j, va, vb, a: [a0, a1], b: [b0, b1], ya, yb, w: c.w });
  }
  // ------------------------------------------------------------------------ plots
  const plots = [];
  for (const b of blocks) {
    const { i } = b;
    if (b.civic) continue;
    const mid = (v) => (edge(i, v, 1) + edge(i + 1, v, -1)) / 2;
    for (let k = 0; k < b.breaks.length - 1; k++) {
      const va = b.breaks[k], vb = b.breaks[k + 1];
      const rowsOfPlots = b.split ? [['low', edge(i, va, 1), edge(i, vb, 1), mid(va), mid(vb), i, 1], ['high', edge(i + 1, va, -1), edge(i + 1, vb, -1), mid(va), mid(vb), i + 1, -1]]
        : [['low', edge(i, va, 1), edge(i, vb, 1), edge(i + 1, va, -1), edge(i + 1, vb, -1), i, 1]];
      for (const [pos, fa, fb, ba, bb, si, dir] of rowsOfPlots) {
        const corners = [P(fa, va), P(fb, vb), P(bb, vb), P(ba, va)];
        const st = streetAt(si, va) && streetAt(si, vb) ? streetAt(si, va) : null;
        const fy = st ? Math.max(heightOn(st, va), heightOn(st, vb)) : null;
        // the front runs through every section of its street (its chords are the street's own
        // edge), the back is the block's middle line between the plot breaks (shared exactly)
        const fvs = st ? st.vs.filter((v) => v > va + 1e-6 && v < vb - 1e-6) : [];
        const frontPts = [{ v: va, p: corners[0] }, ...fvs.map((v) => ({ v, p: P(edge(si, v, dir), v) })), { v: vb, p: corners[1] }];
        // a single-row block's plot backs onto the next street: through its sections too
        const bst = !b.split ? streetAt(i + 1, va) : null;
        const bvs = bst ? bst.vs.filter((v) => v > va + 1e-6 && v < vb - 1e-6) : [];
        const backPts = [corners[3], ...bvs.map((v) => P(edge(i + 1, v, -1), v)), corners[2]];
        const q = [...frontPts.map((f) => f.p), ...backPts.reverse()];
        plots.push({ block: b, pos, q, corners, frontPts, va, vb, row: si, dir, front: [corners[0], corners[1]], frontY: fy, frontAt: st ? (s) => heightOn(st, va + (vb - va) * s) : null, depth: Math.min(Math.abs(ba - fa), Math.abs(bb - fb)), width: vb - va, uFront: [fa, fb], uBack: [ba, bb] });
      }
    }
  }
  // civic places: each group's outline runs along the edges of the streets round it (through
  // their own sections, so the joints are exact) and straight up the lanes or the via at its sides
  const civic = new Map();
  for (const b of blocks) if (b.civic) { if (!civic.has(b.civic)) civic.set(b.civic, { id: b.civic, blocks: [] }); civic.get(b.civic).blocks.push(b); }
  for (const g of civic.values()) {
    const i0 = Math.min(...g.blocks.map((b) => b.i)), i1 = Math.max(...g.blocks.map((b) => b.i)) + 1;
    const j0 = Math.min(...g.blocks.map((b) => b.j)), j1 = Math.max(...g.blocks.map((b) => b.j));
    const va = cols[j0].v + cols[j0].w / 2, vb = cols[j1 + 1].v - cols[j1 + 1].w / 2;
    const sec = (i, side) => {
      const s = streets.find((q) => q.i === i && q.v0 <= va + 1e-6 && q.v1 >= vb - 1e-6);
      const vs = s ? s.vs.filter((v) => v >= va - 1e-6 && v <= vb + 1e-6) : [va, vb];
      return vs.map((v) => ({ v, p: P(edge(i, v, side), v), y: s ? heightOn(s, v) : null }));
    };
    const bottom = sec(i0, 1), top = sec(i1, -1);
    Object.assign(g, { i0, i1, j0, j1, va, vb, bottom, top, poly: [...bottom.map((q) => q.p), ...top.slice().reverse().map((q) => q.p)],
      uAt: (v, f) => edge(i0, v, 1) + (edge(i1, v, -1) - edge(i0, v, 1)) * f });
  }
  return { blocks, streets, lanes, plots, streetAt, heightOn, civic };
}

function groundRangeQuad(a, b) {
  return groundRange([a.l, b.l, b.r, a.r], 3);
}

/** Plot terraces get their tops here (fill: above the highest ground, not below the street). */
export function levelPlots(plan, { margin = 0.3, maxFill = 14 } = {}) {
  for (const p of plan.plots) {
    const g = groundRange(p.q, 3);
    p.gmin = g.min; p.gmax = g.max;
    p.top = Math.max(g.max + margin, p.frontY ?? -Infinity);
    p.fill = p.top - g.min;
    p.ok = p.fill <= maxFill && g.min > 1.2;
  }
}

/**
 * Build the streets and lanes of a planned district. Streets and lane ramps are drawn to
 * every range (they are the white lines of the city), the steps themselves up close.
 */
export function buildStreets(kit, plan, { streetTop = K.PAVING, laneTop = K.PAVING } = {}) {
  for (const s of plan.streets) {
    const S = s.pts.map((p, k) => ({ l: p.l, r: p.r, y: s.y[k], yb: s.yb[k] }));
    const c = centroid([S[0].l, S.at(-1).r]);
    kit.at(c[0], c[1], 3).ribbon(S, { top: streetTop, meta: { role: 'street', row: s.i } });
    for (let k = 0; k < S.length; k += 3) kit.keep(s.pts[k].c[0], s.pts[k].c[1], s.w / 2 + 3);
  }
  for (const L of plan.lanes) buildLane(kit, L, laneTop);
}

/** A lane between two row streets: ramps where gentle, flights of steps on a ramp where steep. */
export function buildLane(kit, L, top = K.PAVING) {
  const A = lerp2(L.a[0], L.a[1], 0.5), B = lerp2(L.b[0], L.b[1], 0.5), len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (len < 1) return;
  const dir = [(B[0] - A[0]) / len, (B[1] - A[1]) / len], hw = L.w / 2;
  // profile: the highest ground across the lane every 2 m, the taut line above it
  const n = Math.max(2, Math.ceil(len / 2)), pts = [[0, L.ya]];
  for (let k = 1; k < n; k++) {
    const s = (len * k) / n, p0 = lerp2(L.a[0], L.b[0], k / n), p1 = lerp2(L.a[1], L.b[1], k / n);
    const g = Math.max(H(p0[0], p0[1]), H(p1[0], p1[1]), H((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2), H(p0[0] + dir[0], p0[1] + dir[1]), H(p1[0] + dir[0], p1[1] + dir[1]));
    pts.push([s, g + 0.3]);
  }
  pts.push([len, L.yb]);
  const hull = upperHull(pts);
  // each hull segment: its own ramp or flight between the lane's two edges
  const at = (s) => [lerp2(L.a[0], L.b[0], s / len), lerp2(L.a[1], L.b[1], s / len)];
  for (let k = 0; k < hull.length - 1; k++) {
    const [s0, y0] = hull[k], [s1, y1] = hull[k + 1];
    if (s1 - s0 < 0.05) continue;
    const e0 = at(s0), e1 = at(s1);
    const gmin = groundRange([e0[0], e1[0], e1[1], e0[1]], 2).min;
    const c = lerp2(lerp2(e0[0], e0[1], 0.5), lerp2(e1[0], e1[1], 0.5), 0.5);
    const grade = Math.abs(y1 - y0) / (s1 - s0), stepped = grade > 0.08, dy = stepped ? STEP_SEAT : 0;
    const yb = Math.min(gmin, y0, y1) - 1.0;
    kit.at(c[0], c[1], 3).ribbon([{ l: e0[0], r: e0[1], y: y0 - dy, yb }, { l: e1[0], r: e1[1], y: y1 - dy, yb }], { top, meta: { role: stepped ? 'flight ramp' : 'lane' } });
    if (stepped) steps(kit, e0, e1, y0, y1, hw);
  }
  kit.keep(A[0], A[1], hw + 2); kit.keep(B[0], B[1], hw + 2); kit.keep((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, hw + 2);
}

/**
 * A free-standing flight on a deck: a closed stepped block from the edge pair e0 (at y0, its
 * foot) to e1 (at y1), its underside flat at `base` (resting on the deck).
 */
export function stairBlock(kit, e0, e1, y0, y1, hw, base, { riser = 0.17, tier = 1 } = {}) {
  const c0 = lerp2(e0[0], e0[1], 0.5), c1 = lerp2(e1[0], e1[1], 0.5), len = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
  const A = [(c1[0] - c0[0]) / len, (c1[1] - c0[1]) / len], B = [-A[1], A[0]];
  const n = Math.max(1, Math.ceil((y1 - y0) / riser - 1e-6)), r = (y1 - y0) / n, t = len / n;
  const prof = [[0, base]];
  for (let k = 0; k < n; k++) { prof.push([k * t, y0 + (k + 1) * r]); prof.push([(k + 1) * t, y0 + (k + 1) * r]); }
  prof.push([len, base]);
  for (let k = n - 1; k >= 1; k--) prof.push([k * t, base]);
  const c = lerp2(c0, c1, 0.5);
  kit.at(c[0], c[1], tier).extrude(prof, c0, A, B, -hw, hw, { kinds: (i) => (i < 2 * n + 1 ? (i % 2 === 1 ? K.PAVING : K.STONE) : K.STONE), meta: { role: 'stair block', supported: true } });
}

/** Stepped ramps sit this far below the line of their flight's inner corners. */
export const STEP_SEAT = 0.08;
/**
 * Steps on a ramp: the ramp's top runs STEP_SEAT below the line of the flight's inner
 * corners from the edge pair e0 (at y0) to e1 (at y1); the teeth are one closed serrated
 * solid whose underside lies on the ramp (drawn only up close; far off the ramp reads alone).
 */
export function steps(kit, e0, e1, y0, y1, hw, { riser = 0.17, tier = 0, seat = STEP_SEAT } = {}) {
  const c0 = lerp2(e0[0], e0[1], 0.5), c1 = lerp2(e1[0], e1[1], 0.5);
  const len = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
  const up = y1 >= y0;
  // run from the low end to the high end
  const lo = up ? c0 : c1, hi = up ? c1 : c0, ylo = Math.min(y0, y1), yhi = Math.max(y0, y1);
  const A = [(hi[0] - lo[0]) / len, (hi[1] - lo[1]) / len], B = [-A[1], A[0]];
  const n = Math.max(1, Math.ceil((yhi - ylo) / riser - 1e-6)), r = (yhi - ylo) / n, t = len / n;
  // profile: riser/tread pairs up the flight (indices 2k: foot of riser k, 2k+1: its nosing),
  // the end face, then the seat line back down with a point under every riser
  const prof = [];
  for (let k = 0; k < n; k++) { prof.push([k * t, k === 0 ? ylo - seat : ylo + k * r]); prof.push([k * t, ylo + (k + 1) * r]); }
  prof.push([len, yhi], [len, yhi - seat]);
  const seatAt = (k) => (k === 0 ? 0 : 2 * n + 1 + (n - k));        // seat point under riser k (k = 0 is the first point)
  for (let k = n - 1; k >= 1; k--) prof.push([k * t, ylo + k * r - seat]);
  // explicit cap triangles: column k is bounded by riser k (seat k .. nosing k), the tread,
  // riser k+1's foot (the inner corner) and the seat line
  const tris = [];
  for (let k = 0; k < n; k++) {
    const sA = seatAt(k), foot = 2 * k, nose = 2 * k + 1;
    const nFoot = k + 1 < n ? 2 * (k + 1) : 2 * n, sB = k + 1 < n ? seatAt(k + 1) : 2 * n + 1;
    // left edge: sA -> foot (inner corner k, absent for k = 0) -> nose
    if (k === 0) { tris.push([sA, sB, nFoot], [sA, nFoot, nose]); }
    else { tris.push([foot, sA, sB], [foot, sB, nFoot], [foot, nFoot, nose]); }
  }
  const c = lerp2(c0, c1, 0.5);
  kit.at(c[0], c[1], tier).extrude(prof, lo, A, B, -hw, hw, { kinds: (i) => (i < 2 * n ? (i % 2 === 1 ? K.PAVING : K.STONE) : K.STONE), meta: { role: 'steps' }, capTris: tris });
}
