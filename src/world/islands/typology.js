import { K, H, lerp2, centroid, groundRange } from './cityKit.js';
import { STEP_SEAT, steps } from './district.js';

// Buildings on their plots. A plot is a fill terrace (its quad q: front-left, front-right,
// back-right, back-left; its top) fronting a street at frontY. Every building stands on the
// terrace top (its foot 25 cm into the paving), every upper volume on the one below, every
// column on the terrace and under its beam; roofs carry their parapets. Walls take the
// punched-window stone of the island (kind 5) measured from the terrace, so storeys line up.

export const FH = 3.6;

/** Plot-local bilinear map: s along the frontage (0..1), t from the front (0) to the back (1). */
export const plotMap = (q) => (s, t) => lerp2(lerp2(q[0], q[1], s), lerp2(q[3], q[2], s), t);

/**
 * The plot's terrace, notched at the front for its entry flight when it stands above its
 * street. Returns the front setback the flight needs (m), or null when the plot is too
 * shallow for a flight and a house (the caller then plants it).
 */
export function terrace(kit, p, { top = K.PAVING, minHouseDepth = 9 } = {}) {
  const Q = p.corners || p.q, [cx, cz] = centroid(p.q), M = plotMap(Q);
  const rise = p.frontY != null ? p.top - p.frontY : 0;
  // the front: the street's own section points (a plot without them fronts one straight chord)
  const fp = p.frontPts || [{ v: 0, p: Q[0] }, { v: 1, p: Q[1] }], vA = fp[0].v, vB = fp.at(-1).v;
  let notch = null, need = 0;
  if (rise > 0.35 && p.frontAt) {
    const n = Math.ceil(rise / 0.17), run = n * 0.3;
    if (run + minHouseDepth > p.depth || p.width < 8) return null;
    // the flight's mouth lies within one chord of the street edge (the longest, near the middle)
    let best = -1, bl = 0;
    for (let k = 0; k < fp.length - 1; k++) { const l = Math.hypot(fp[k + 1].p[0] - fp[k].p[0], fp[k + 1].p[1] - fp[k].p[1]), mid = ((fp[k].v + fp[k + 1].v) / 2 - vA) / (vB - vA); const sc = l - Math.abs(mid - 0.5) * 6; if (l > 4.2 && sc > bl) { bl = sc; best = k; } }
    if (best < 0) return null;
    const c = (fp[best].v + fp[best + 1].v) / 2, hw = 1.3;
    const v0 = c - hw * (vB - vA) / p.width, v1 = c + hw * (vB - vA) / p.width;
    const onFront = (v) => lerp2(fp[best].p, fp[best + 1].p, (v - fp[best].v) / (fp[best + 1].v - fp[best].v));
    const s0 = (v0 - vA) / (vB - vA), s1 = (v1 - vA) / (vB - vA), tr = run / p.depth;
    const n0 = onFront(v0), n1 = onFront(v1);
    const inward = (s) => { const a = M(s, 0), b = M(s, tr); return [b[0] - a[0], b[1] - a[1]]; };
    const d0 = inward(s0), d1 = inward(s1);
    notch = { s0, s1, tr, best, n0, n1, i0: [n0[0] + d0[0], n0[1] + d0[1]], i1: [n1[0] + d1[0], n1[1] + d1[1]] };
    need = run + 1.2;
    // the flight's inner-corner line must clear the ground all along the notch
    const y0 = Math.max(p.frontAt(s0), p.frontAt(s1));
    for (let k = 0; k <= 24; k++) for (const f of [0, 0.5, 1]) {
      const t = k / 24, a = lerp2(n0, n1, f), b = lerp2(notch.i0, notch.i1, f), pt = lerp2(a, b, t), line = y0 + (p.top - y0) * t - STEP_SEAT;
      if (H(pt[0], pt[1]) > line - 0.12) return null;
    }
  }
  let tq = p.q;
  if (notch) {
    const nf = fp.length, back = p.q.slice(nf);
    tq = [...fp.slice(0, notch.best + 1).map((f) => f.p), notch.n0, notch.i0, notch.i1, notch.n1, ...fp.slice(notch.best + 1).map((f) => f.p), ...back];
  }
  kit.at(cx, cz, 3).prism(tq, p.gmin - 1.0, p.top, { top, vBase: p.top, meta: { role: 'terrace' } });
  if (notch) {
    const e0 = [notch.n0, notch.n1], e1 = [notch.i0, notch.i1];
    const y0 = Math.max(p.frontAt(notch.s0), p.frontAt(notch.s1));
    const g = groundRange([e0[0], e0[1], e1[1], e1[0]], 2);
    kit.at(cx, cz, 2).ribbon([{ l: e0[0], r: e0[1], y: y0 - STEP_SEAT, yb: g.min - 0.8 }, { l: e1[0], r: e1[1], y: p.top - STEP_SEAT, yb: g.min - 0.8 }], { meta: { role: 'entry ramp' } });
    steps(kit, e0, e1, y0, p.top, Math.hypot(e0[1][0] - e0[0][0], e0[1][1] - e0[0][1]) / 2);
  }
  return need;
}

const quadOf = (M, s0, s1, t0, t1) => [M(s0, t0), M(s1, t0), M(s1, t1), M(s0, t1)];
const block = (kit, q, y0, y1, opts) => kit.at(...centroid(q), opts.tier ?? 3).prism(q, y0, y1, { wall: K.PUNCHED, top: K.PAVING, ...opts, meta: { supported: true, ...opts.meta } });

/** Flat roof furniture: parapet, and a pergola or a small dome over part of it. */
function roofKit(kit, rnd, q, y, { dome = 0.12, pergola = 0.2, parapet = true } = {}) {
  if (parapet) kit.at(...centroid(q), 1).parapet(q, y, 0.95, 0.3);
  const r = rnd();
  if (r < dome) {
    const c = centroid(q), w = Math.min(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]));
    const rr = w * 0.26;
    if (rr > 1.4) kit.at(c[0], c[1], 1).dome(c[0], c[1], rr, y - 0.05, 0.9, rr * 0.95, { seg: 16, lantern: false, meta: { role: 'roof dome', supported: true } });
  } else if (r < dome + pergola) {
    // a pergola on four posts with a timber roof of slats (one closed slab), near detail
    const M = plotMap(q), Wr = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), Dr = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]);
    const s0 = Math.max(0.18, 1.0 / Wr) + rnd() * 0.08, s1 = Math.min(s0 + 0.4, 1 - 1.0 / Wr), t0 = Math.max(0.2, 1.0 / Dr), t1 = Math.min(0.62, 1 - 1.0 / Dr);
    if ((s1 - s0) * Wr < 2.2 || (t1 - t0) * Dr < 2.2) return;
    for (const [s, t] of [[s0, t0], [s1, t0], [s1, t1], [s0, t1]]) { const p = M(s, t); kit.at(p[0], p[1], 0).prism(rect4(p, 0.3), y - 0.02, y + 2.6, { wall: K.TIMBER, top: K.TIMBER, meta: { role: 'pergola post', supported: true } }); }
    kit.at(...centroid(q), 0).prism(quadOf(M, s0 - 0.03, s1 + 0.03, t0 - 0.03, t1 + 0.03), y + 2.58, y + 2.78, { wall: K.TIMBER, top: K.TIMBER, meta: { role: 'pergola', supported: true } });
  }
}
const rect4 = (p, r) => [[p[0] - r, p[1] - r], [p[0] + r, p[1] - r], [p[0] + r, p[1] + r], [p[0] - r, p[1] + r]];

/**
 * A house of the white city on its plot (after terrace()). front: the setback its entry
 * flight needs. Returns the footprint quad(s) it occupies (for the garden and trees).
 */
export function thalassaHouse(kit, p, rnd, { front = 0, extraFloors = 0, onVia = false } = {}) {
  const M = plotMap(p.corners || p.q), W = p.width, D = p.depth, y = p.top;
  const fr = Math.max(front, (p.frontSag || 0) + 0.7, 1.0 + rnd() * 2.2), side = 0.8 + rnd() * 1.0, back = 3.5 + rnd() * 4.5;
  let sA = side / W, sB = 1 - side / W, tA = fr / D, tB = 1 - back / D;
  if (tB - tA < 8 / D || sB - sA < 6 / W) return null;
  const roofKind = () => { const r = rnd(); return r < 0.3 ? K.GARDEN : r < 0.42 ? K.PV : K.PAVING; };
  const pick = rnd();
  const floors = Math.min(4, 1 + Math.floor(rnd() * 2.1) + extraFloors);
  const out = [];
  if (pick < 0.16 && W >= 17 && (tB - tA) * D >= 20) {
    // courtyard house: two wings and a back range round a court open to the street
    const w = Math.min(6.5, (sB - sA) * W * 0.3) / W, wb = 6.5 / D, h = y + FH * Math.max(1, floors - 1) + 0.4;
    const L = quadOf(M, sA, sA + w, tA, tB), R = quadOf(M, sB - w, sB, tA, tB), Bk = quadOf(M, sA + w, sB - w, tB - wb, tB);
    for (const q of [L, R, Bk]) { block(kit, q, y - 0.25, h, { top: roofKind(), vBase: y, meta: { role: 'house' } }); roofKit(kit, rnd, q, h, { dome: 0, pergola: 0.1 }); out.push(q); }
    // the court: a pool with its coping, near detail
    const pq = quadOf(M, sA + w + 1.2 / W, sB - w - 1.2 / W, tA + 1.5 / D, tB - wb - 1.2 / D);
    kit.at(...centroid(pq), 1).prism(pq, y - 0.05, y + 0.35, { wall: K.STONE, top: K.POOL, meta: { role: 'court pool', supported: true } });
    return { quads: out, court: quadOf(M, sA + w, sB - w, tA, tB - wb) };
  }
  if (pick < 0.3 && floors >= 2) {
    // loggia house: the upper storeys carried forward over a colonnade at the street
    const rec = Math.min(3.2, (tB - tA) * D * 0.3) / D;
    const gq = quadOf(M, sA, sB, tA + rec, tB), uq = quadOf(M, sA, sB, tA, tB);
    const y1 = y + FH, h = y + FH * floors + 0.4;
    block(kit, gq, y - 0.25, y1 + 0.02, { top: K.STONE, vBase: y, meta: { role: 'house' } });
    block(kit, uq, y1, h, { top: roofKind(), vBase: y, meta: { role: 'house upper', supported: true } });
    const n = Math.max(2, Math.round(((sB - sA) * W) / 3.4));
    for (let k = 0; k < n; k++) { const s = sA + 0.5 / W + ((sB - sA - 1 / W) * k) / (n - 1), c = M(s, tA + 0.45 / D); kit.at(c[0], c[1], 1).column(c[0], c[1], y - 0.05, FH + 0.07, 0.3, { meta: { role: 'column', supported: true } }); }
    roofKit(kit, rnd, uq, h, {});
    out.push(uq);
    return { quads: out };
  }
  if (pick < 0.4 && W >= 12) {
    // tower house: a slender tower on one corner over a low range, a belvedere on top
    const tw = Math.min(7.5, (sB - sA) * W * 0.45) / W, td = Math.min(7.5, (tB - tA) * D * 0.5) / D, left = rnd() < 0.5;
    const tq = left ? quadOf(M, sA, sA + tw, tB - td, tB) : quadOf(M, sB - tw, sB, tB - td, tB);
    const lq = left ? quadOf(M, sA + tw, sB, tA, tB) : quadOf(M, sA, sB - tw, tA, tB);
    const hl = y + FH + 0.4, ht = y + FH * (floors + 2) + 0.4;
    block(kit, lq, y - 0.25, hl, { top: roofKind(), vBase: y, meta: { role: 'house' } });
    roofKit(kit, rnd, lq, hl, { dome: 0, pergola: 0.35 });
    block(kit, tq, y - 0.25, ht, { top: K.STONE, vBase: y, meta: { role: 'house tower' } });
    // belvedere: four piers and a roof slab over the tower top
    const Mt = plotMap(tq);
    for (const [s, t] of [[0.12, 0.12], [0.88, 0.12], [0.88, 0.88], [0.12, 0.88]]) { const c = Mt(s, t); kit.at(c[0], c[1], 1).prism(rect4(c, 0.35), ht - 0.02, ht + 2.8, { wall: K.STONE, top: K.STONE, meta: { role: 'belvedere pier', supported: true } }); }
    kit.at(...centroid(tq), 1).prism(quadOf(Mt, -0.04, 1.04, -0.04, 1.04), ht + 2.78, ht + 3.3, { wall: K.STONE, top: K.STONE, meta: { role: 'belvedere roof', supported: true } });
    out.push(lq, tq);
    return { quads: out };
  }
  if (pick < 0.45 && W <= 20 && !onVia) {
    // a chapel: a white cube under a drum and dome, a gilded finial
    const cw = Math.min(10, (sB - sA) * W, (tB - tA) * D) ;
    const sm = (sA + sB) / 2, tm = tA + (cw / 2 + 0.5) / D;
    const cq = quadOf(M, sm - cw / 2 / W, sm + cw / 2 / W, tm - cw / 2 / D, tm + cw / 2 / D);
    const h = y + 6.5;
    block(kit, cq, y - 0.25, h, { wall: K.STONE, top: K.STONE, meta: { role: 'chapel' } });
    const c = centroid(cq);
    kit.at(c[0], c[1], 3).dome(c[0], c[1], cw * 0.36, h - 0.05, 1.6, cw * 0.36, { seg: 20, meta: { role: 'chapel dome', supported: true } });
    out.push(cq);
    return { quads: out, chapel: true };
  }
  // the white cube: storeys, the top one set back to leave a roof terrace at the street
  const q0 = quadOf(M, sA, sB, tA, tB), h0 = y + FH * floors + 0.4;
  block(kit, q0, y - 0.25, h0, { top: roofKind(), vBase: y, meta: { role: 'house' } });
  out.push(q0);
  if (rnd() < 0.55 && (tB - tA) * D > 11) {
    const t2 = tA + (tB - tA) * (0.34 + rnd() * 0.16), s2a = sA + (rnd() < 0.5 ? 0 : (sB - sA) * 0.3), s2b = sB - (rnd() < 0.5 ? 0 : (sB - sA) * 0.3);
    const q1 = quadOf(M, s2a, s2b, t2, tB);
    block(kit, q1, h0 - 0.2, h0 + FH, { top: roofKind(), vBase: y, meta: { role: 'house upper', supported: true } });
    // the lower roof's parapet runs round the front terrace only up to the upper storey
    roofKit(kit, rnd, q1, h0 + FH, { dome: 0.22 });
    kit.at(...centroid(q0), 1).parapet(quadOf(M, sA, sB, tA, t2), h0, 0.95, 0.3);
  } else roofKit(kit, rnd, q0, h0, {});
  return { quads: out };
}

/**
 * A plot too steep for one terrace, laid out as garden terraces stepping down the fall line
 * (the way the island's hillsides are farmed): n strips across the plot from its front edge (the
 * street's own sections) to its back, each a fill terrace just clearing the highest ground
 * under it, its walls of stone, its top planted, and a row of olive trees along each. The
 * strips share their edges exactly, with the plot's sides and with each other.
 * Returns false (building nothing) when the plot cannot be stepped.
 */
export function stepTerraces(kit, p, rnd, { stepRise = 2.8, minDepth = 4.5, maxFill = 8.5, tree = null, treeS = [4.2, 1.4], spacing = 7.5, top: kind = K.GARDEN } = {}) {
  const Q = p.corners || p.q, M = plotMap(Q), D = p.depth, W = p.width;
  if (p.gmin == null || p.gmin < 1.6 || D < 2 * minDepth || W < 8) return false;
  const G = p.gmax - p.gmin, n = Math.max(2, Math.min(Math.floor(D / minDepth), Math.ceil(G / stepRise)));
  const fp = p.frontPts ? p.frontPts.map((f) => f.p) : [Q[0], Q[1]];
  const back = p.q.slice(fp.length);                       // back-right .. back-left (the plot's own)
  const polys = [];
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const front = k === 0 ? fp : [M(0, t0), M(1, t0)];
    const rear = k === n - 1 ? back : [M(1, t1), M(0, t1)];
    polys.push({ q: [...front, ...rear], t0, t1 });
  }
  // every strip must be buildable (else the plot is left to its trees)
  for (const s of polys) { const g = groundRange(s.q, 2); s.g = g; s.top = g.max + 0.3; if (s.top - g.min > maxFill) return false; }
  for (const s of polys) {
    kit.at(...centroid(s.q), 3).prism(s.q, s.g.min - 1.0, s.top, { wall: K.STONE, top: kind, meta: { role: 'garden terrace' } });
    if (tree === null) continue;
    // olive trees in a row down the middle of the strip, their crowns clear of the plot's sides
    const dk = (s.t1 - s.t0) * D, margin = kit.crownR(tree, treeS[0] + treeS[1]) + 0.9, span = W - 2 * margin;
    if (dk < 3.6 || span < 0) continue;
    const m = Math.max(1, Math.floor(span / spacing) + 1);
    for (let j = 0; j < m; j++) {
      if (rnd() < 0.18) continue;
      const sj = (margin + (m > 1 ? (span * j) / (m - 1) : span / 2)) / W, [x, z] = M(sj, (s.t0 + s.t1) / 2 + (rnd() - 0.5) * 0.12 * (s.t1 - s.t0));
      kit.tree(x, s.top, z, tree, treeS[0] + rnd() * treeS[1], rnd);
    }
  }
  return true;
}

/**
 * An arcaded range on a waterfront or square: storeys over a colonnaded portico along its
 * front (the portico floor is the terrace), a cornice and a flat roof with a parapet.
 */
export function arcadedRange(kit, p, rnd, { floors = 3, portico = 4.2, kind = K.PUNCHED, footBelow } = {}) {
  const M = plotMap(p.corners || p.q), W = p.width, D = p.depth, y = p.top;
  const tP = portico / D, h = y + FH * floors + 0.6;
  // bays abut their neighbours: the range runs the full width of its plot
  const back = quadOf(M, 0, 1, tP, 1), full = quadOf(M, 0, 1, 0.02, 1);
  block(kit, back, Math.min(y - 0.25, footBelow ?? Infinity), y + FH + 0.02, { wall: kind, top: K.STONE, vBase: y, meta: { role: 'range' } });
  block(kit, full, y + FH, h, { wall: kind, top: rnd() < 0.4 ? K.GARDEN : K.PAVING, vBase: y, meta: { role: 'range upper', supported: true } });
  const n = Math.max(3, Math.round(W / 3.6));
  for (let k = 0; k < n; k++) { const s = (k + 0.5) / n, c = M(s, 0.02 + 0.45 / D); kit.at(c[0], c[1], 1).column(c[0], c[1], y - 0.05, FH + 0.07, 0.34, { meta: { role: 'column', supported: true } }); }
  kit.at(...centroid(full), 1).parapet(full, h, 1.0, 0.35);
  return { quads: [full] };
}
