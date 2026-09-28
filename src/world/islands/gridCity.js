import { K, H, rect, circlePoly, groundRange, Occupancy, lerp2, centroid, pointInPoly } from './cityKit.js';
import { planDistrict, levelPlots, buildStreets, steps, upperHull, STEP_SEAT } from './district.js';
import { archGate } from './civic.js';
import { buildHarbour, quaySheds } from './harbour.js';
import { harbourFront } from './thalassaCivic.js';
import { terrace, plotMap, stepTerraces } from './typology.js';
import { SP } from '../treeGeometry.js';

// A planned city on a grid, for the island cities built on their coastal lowlands (Anchorage,
// Orison). The frame is the station footbridge's line: A0 its landing, u inland along it, v
// across. The grid follows district.js (rows of streets across the axis, lanes between them,
// two rows of plots to a block, civic places as groups of blocks), with a grand avenue down the
// axis: from the Sea Gate on the harbour through the city to the Land Gate where the island's
// regional roads begin. The avenue is one of the grid's lanes, so its crossings are the row
// streets themselves and civic places may span it (the avenue then enters and leaves them).
//
// spec: {
//   rows: { u0, uMax, depth(k) -> block depth after row k, w(k) -> street width }
//   cols: { avenueW, vMax, length(j) -> block length, w(j) -> lane width }
//   inside(u, v) -> is (u, v) within the city outline
//   civic(L, i, j, quad, g) -> civic place id or null (g: the block's ground range)
//   house(kit, p, rnd, L, need) -> build on a levelled plot (need: the front setback of its flight)
//   place(kit, L, g, ctx) -> build a civic place (g from planDistrict)
//   harbour: options for buildHarbour; gateU: where the Land Gate stands on the axis
//   avenue: { mall, sides, tree, treeS, lampH } planting of the avenue
// }

const cache = new Map();

export function gridLayout(c, spec) {
  if (cache.has(c.id)) return cache.get(c.id);
  const A0 = [c.deep.x - c.d[0] * 34, c.deep.z - c.d[1] * 34];
  const a = [-c.d[0], -c.d[1]], b = [-a[1], a[0]];
  const P = (u, v) => [A0[0] + a[0] * u + b[0] * v, A0[1] + a[1] * u + b[1] * v];
  const UV = (x, z) => { const dx = x - A0[0], dz = z - A0[1]; return [dx * a[0] + dz * a[1], dx * b[0] + dz * b[1]]; };
  const ang = Math.atan2(a[1], a[0]);
  // rows: straight streets across the axis
  const R = spec.rows, rows = [];
  for (let k = 0, u = R.u0; u < R.uMax; k++) {
    const w = R.w(k), uk = u;
    rows.push({ U: () => uk, u: uk, v0: -spec.cols.vMax, v1: spec.cols.vMax, w, main: w >= 14 });
    u = uk + w / 2 + R.depth(k) + R.w(k + 1) / 2;
  }
  // cols: the avenue on the axis, lanes either side
  const C = spec.cols, cols = [{ v: 0, w: C.avenueW, avenue: true }];
  for (const s of [-1, 1]) {
    let v = C.avenueW / 2;
    for (let j = 0; ; j++) {
      const w = C.w(j), L = C.length(j);
      const vc = v + L + w / 2;
      if (vc + w / 2 > C.vMax) break;
      cols.push({ v: s * vc, w });
      v = vc + w / 2;
    }
  }
  cols.sort((p, q) => p.v - q.v);
  const L = { c, A0, a, b, P, UV, ang, rows, cols, spec, jAve: cols.findIndex((q) => q.avenue) };
  L.F = { O: A0, A: a, B: b, a: ang, f: P };
  // the Land Gate: a round plaza on the axis where the regional roads start
  // (an octagon with flat sides square to the axis, where the avenue and the way beyond meet it)
  const [gx, gz] = P(spec.gateU, 0), gq = circlePoly(gx, gz, 22 / Math.cos(Math.PI / 8), 8, ang + Math.PI / 8), gg = groundRange(gq, 3);
  L.gate = { x: gx, z: gz, u: spec.gateU, top: gg.max + 0.3, gmin: gg.min, y: gg.max + 0.27, q: gq };
  cache.set(c.id, L);
  return L;
}

/** Circles over the city for the island's road planner (the regional roads keep out). */
export function gridReserve(L) {
  const out = [], { P, spec, gate } = L;
  for (let u = spec.rows.u0 - 40; u <= spec.rows.uMax + 60; u += 150) for (let v = -spec.cols.vMax; v <= spec.cols.vMax; v += 150) {
    if (!spec.inside(u, v)) continue;
    const [x, z] = P(u, v);
    if (H(x, z) < 2) continue;
    if (Math.hypot(x - gate.x, z - gate.z) < 150) continue;
    out.push({ x, z, r: 110 });
  }
  // the avenue's last reach to the gate
  for (let u = spec.rows.uMax; u < gate.u - 60; u += 60) { const [x, z] = P(u, 0); out.push({ x, z, r: 40 }); }
  for (const o of spec.reserveExtra?.(L) || []) out.push(o);
  return { obstacles: out, gate: { x: gate.x, z: gate.z, y: gate.y } };
}

// =============================================================================== build
export function buildGridCity(ctx, L, spec) {
  const { kit, c, rnd, placed } = ctx, { P, UV } = L, plan = c.plan;
  const occ = new Occupancy(48);
  const circleOf = (q, r) => { const [x, z] = centroid(q); return { x, z, r: r ?? Math.max(...q.map((p) => Math.hypot(p[0] - x, p[1] - z))) + 1 }; };
  const place = (q, tag, r) => { if (tag !== 'plot' && tag !== 'grove') occ.add(q, tag); placed.push(circleOf(q, r)); };
  const roadFree = (q) => { const [x, z] = centroid(q), r = Math.max(...q.map((p) => Math.hypot(p[0] - x, p[1] - z))); return plan.isRoadFree(x, z, r) && !plan.reserved.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 20); };
  Object.assign(ctx, { occ, place, circleOf, L });
  // ------------------------------------------------------------------ the harbour first:
  // the quay and its moles, the Sea Gate plaza in the gap of the quay on the axis
  const hb = buildHarbour(kit, { A0: L.A0, a: L.a, place, gapU: 70, gapHalf: spec.cols.avenueW / 2 + 22, apronOut: 32, ...spec.harbour });
  L.hb = hb;
  harbourLights(ctx.signals, L, spec.harbour.lightH ?? 38);
  seaGate(kit, L, place, spec);
  // ------------------------------------------------------------------ the district
  const landOk = (quad, minH = 2.4) => {
    for (const [x, z] of quad) { const [u, v] = UV(x, z); if (!spec.inside(u, v)) return null; if (H(x, z) < minH + 0.4) return null; }
    const g = groundRange(quad, 6);
    if (g.min < minH) return null;
    for (const it of occ.query(quad, 1)) if (it.tag !== 'plot') return null;
    return g;
  };
  const slopes = [];
  const D = {
    P, rows: L.rows, cols: L.cols, rnd, grade: spec.grade ?? 0.07,
    plotWidths: (r, b) => spec.plotWidth(r, b, L),
    split: (b) => b.depth >= 34,
    // a civic place may fill a dry hollow (its terrace is fill), a block of houses may not
    civic: (i, j, quad, vv) => { const g = landOk(quad, spec.civicMin ?? 2.4); if (!g || !roadFree(quad) || g.max - g.min > (spec.civicSlope ?? 14)) return null; const id = spec.civic(L, i, j, quad, { ...vv, g }); return id && (g.min >= 2.4 || spec.lowOk?.(id)) ? id : null; },
    blockOk: (i, j, quad) => {
      const g = landOk(quad); if (!g || !roadFree(quad)) return false;
      if (g.max - g.min >= (spec.maxSlope ?? 16)) { slopes.push(quad); return false; }
      return true;
    },
  };
  const dp = planDistrict(D);
  L.dp = dp;
  levelPlots(dp, { maxFill: spec.maxFill ?? 10 });
  for (const st of dp.streets) for (let k = 0; k < st.pts.length - 1; k++) occ.add([st.pts[k].l, st.pts[k + 1].l, st.pts[k + 1].r, st.pts[k].r], 'street');
  const aveLanes = dp.lanes.filter((ln) => L.cols[ln.j].avenue);
  dp.lanes = dp.lanes.filter((ln) => !L.cols[ln.j].avenue);
  for (const ln of dp.lanes) occ.add([ln.a[0], ln.a[1], ln.b[1], ln.b[0]], 'lane');
  for (const p of dp.plots) occ.add(p.q, 'plot');
  // ------------------------------------------------------------------ streets and avenue
  buildStreets(kit, dp);
  for (const s of dp.streets) for (let k = 0; k < s.pts.length - 1; k += 2) placed.push(circleOf([s.pts[k].l, s.pts[k + 1].l, s.pts[k + 1].r, s.pts[k].r]));
  for (const ln of dp.lanes) placed.push(circleOf([ln.a[0], ln.a[1], ln.b[1], ln.b[0]]));
  avenue(kit, L, dp, aveLanes, rnd, place, spec);
  // ------------------------------------------------------------------ plots
  for (const p of dp.plots) {
    if (!p.ok) {
      // too steep or too deep a hollow for one terrace: garden terraces down it, else its trees
      if (p.gmin > 2 && stepTerraces(kit, p, rnd, { tree: spec.terraceTree ?? SP.rainTree })) { place(p.q, 'plot'); continue; }
      if (p.gmin > 2) plantPlot(kit, p, rnd, spec);
      place(p.q, 'grove'); continue;
    }
    const need = terrace(kit, p);
    if (need === null) { gardenPlot(kit, p, rnd, spec); place(p.q, 'plot'); continue; }
    spec.house(kit, p, rnd, L, need);
    place(p.q, 'plot');
  }
  // the harbour front behind the quay
  if (spec.front !== false) harbourFront(kit, L, rnd, occ, place, spec.front || {});
  // the port's transit sheds on the quay, behind its lamps and clear of the flights
  if (spec.sheds) L.sheds = quaySheds(kit, L.hb, occ, place, spec.sheds);
  if (typeof process !== 'undefined' && process.env?.ISLAND_DEBUG) console.log(c.id, 'sheds', L.sheds, 'plots', dp.plots.length, 'steep', dp.plots.filter((p) => !p.ok).length, 'slopes', slopes.length);
  for (const q of slopes) if (occ.free(q, -0.5)) { plantPlot(kit, { q }, rnd, spec, 4); place(q, 'grove'); }
  bank(kit, L, rnd, occ, spec);
  for (const g of dp.civic.values()) spec.place(kit, L, g, ctx);
  gate(kit, L, place);
  spec.extras?.(kit, L, ctx);
  return dp;
}

// --------------------------------------------------------------------------- sea gate
function seaGate(kit, L, place, spec) {
  const { P } = L, hb = L.hb, hw = spec.cols.avenueW / 2;
  const { A, B } = hb.gap;
  const uOf = (p) => L.UV(p[0], p[1])[0];
  let uStart = Math.max(uOf(A.r), uOf(B.r)) + 6;
  const poly = (u) => [A.l, B.l, B.r, P(u, hw), P(u, -hw), A.r];
  let g = groundRange(poly(uStart), 3);
  while (g.max > hb.yq - 0.3 && uStart > Math.max(uOf(A.r), uOf(B.r)) - 20) { uStart -= 3; g = groundRange(poly(uStart), 3); }
  const top = Math.max(hb.yq, g.max + 0.3), q = poly(uStart);
  kit.at(...centroid(q), 3).prism(q, g.min - 1.5, top, { top: K.PAVING, meta: { role: 'sea gate plaza' } });
  place(q, 'plaza');
  L.seaGate = { u: uStart, y: top };
  // the gate itself across the plaza where it is widest
  const uw = Math.max(uOf(A.l), uOf(B.l));
  let ug = uw + 10, W = Math.min(76, 2 * hw + 20);
  const inside = (uu, ww) => [[uu - 5.5, -ww / 2 - 1], [uu + 5.5, -ww / 2 - 1], [uu + 5.5, ww / 2 + 1], [uu - 5.5, ww / 2 + 1]].every(([u, v]) => pointInPoly(q, ...P(u, v)));
  while (W > 30 && !inside(ug, W)) { if (ug < uStart - 8) ug += 2; else { ug = uw + 10; W -= 4; } }
  if (spec.seaGate !== false && inside(ug, W)) archGate(kit, L.F, ug, top, { W, T: 10, Hh: Math.min(26, W * 0.36), main: [11, Math.min(17, W * 0.25)], side: [6, Math.min(11, W * 0.16)], spacing: W * 0.28 });
}

// ------------------------------------------------------------------------------ avenue
/**
 * The avenue down the axis: from the Sea Gate plaza to the first row street, between the row
 * streets (a planted boulevard on ramps, flights where steep), and past the last row to the
 * Land Gate. Where a civic place spans the axis the avenue enters it and leaves it.
 */
function avenue(kit, L, dp, aveLanes, rnd, place, spec) {
  const { P } = L, hw = spec.cols.avenueW / 2;
  const at = (i, side) => L.rows[i].u + side * L.rows[i].w / 2;
  const street = (i) => { const s = dp.streetAt(i, -hw); return s && s === dp.streetAt(i, hw) ? s : null; };
  const spanning = (i) => [...dp.civic.values()].some((g) => g.j0 <= L.jAve - 1 && g.j1 >= L.jAve && i >= g.i0 && i < g.i1);
  const edge = (u) => [P(u, -hw), P(u, hw)];
  const seg = (ua, ya, ub, yb) => { const ln = { a: edge(ua), b: edge(ub), ya, yb, w: 2 * hw }; avenueLane(kit, ln, rnd, spec.avenue || {}); place([ln.a[0], ln.a[1], ln.b[1], ln.b[0]], 'avenue'); };
  const withStreet = L.rows.map((_, i) => i).filter((i) => street(i));
  if (!withStreet.length) return;
  // the Sea Gate to the first row
  const i0 = withStreet[0];
  seg(L.seaGate.u, L.seaGate.y, at(i0, -1), dp.heightOn(street(i0), -hw));
  for (let k = 0; k < withStreet.length - 1; k++) {
    const i = withStreet[k], j = withStreet[k + 1];
    if (spanning(i)) continue;
    seg(at(i, 1), dp.heightOn(street(i), hw), at(j, -1), dp.heightOn(street(j), -hw));
  }
  // the last row to the Land Gate
  const iz = withStreet.at(-1), g = L.gate;
  const ue = g.u - 22;
  if (ue - at(iz, 1) > 4) {
    const gw = Math.min(hw, 9);
    const ln = { a: [P(at(iz, 1), -gw), P(at(iz, 1), gw)], b: [P(ue, -gw), P(ue, gw)], ya: dp.heightOn(street(iz), 0), yb: g.top, w: 2 * gw };
    avenueLane(kit, ln, rnd, { ...(spec.avenue || {}), mall: 0 });
    place([ln.a[0], ln.a[1], ln.b[1], ln.b[0]], 'avenue');
  }
  L.aveLanes = aveLanes;
}

/**
 * One reach of a planted avenue between two edge pairs (a at ya, b at yb): its ramps over
 * the taut line above the ground, flights where steeper than 8 %, planters down the middle
 * (mall) and both sides (sides: [inner, outer] distance from the edge) with trees and lamps.
 */
export function avenueLane(kit, ln, rnd, { mall = 8, sides = [1.2, 3.8], tree = SP.araucaria, treeS = [10, 3], lampH = 6.5, gap = 11 } = {}) {
  const A = lerp2(ln.a[0], ln.a[1], 0.5), B = lerp2(ln.b[0], ln.b[1], 0.5), len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (len < 1) return;
  const dir = [(B[0] - A[0]) / len, (B[1] - A[1]) / len], W = ln.w;
  const n = Math.max(2, Math.ceil(len / 2)), pts = [[0, ln.ya]];
  for (let k = 1; k < n; k++) {
    const p0 = lerp2(ln.a[0], ln.b[0], k / n), p1 = lerp2(ln.a[1], ln.b[1], k / n);
    let g = -Infinity;
    for (let f = 0; f <= 1.0001; f += 0.125) { const p = lerp2(p0, p1, f); g = Math.max(g, H(p[0], p[1]), H(p[0] + dir[0], p[1] + dir[1])); }
    pts.push([(len * k) / n, g + 0.3]);
  }
  pts.push([len, ln.yb]);
  const hull = upperHull(pts);
  const at = (s, f) => lerp2(lerp2(ln.a[0], ln.b[0], s / len), lerp2(ln.a[1], ln.b[1], s / len), f);
  // strips across the avenue (fractions of its width): planters, and the walks between them
  const planters = [];
  if (mall > 0) planters.push([0.5 - mall / 2 / W, 0.5 + mall / 2 / W]);
  if (sides) { planters.push([sides[0] / W, sides[1] / W]); planters.push([1 - sides[1] / W, 1 - sides[0] / W]); }
  planters.sort((p, q) => p[0] - q[0]);
  const walks = []; let f0 = 0;
  for (const [p0, p1] of planters) { if (p0 - f0 > 0.01) walks.push([f0, p0]); f0 = p1; }
  if (1 - f0 > 0.01) walks.push([f0, 1]);
  for (let k = 0; k < hull.length - 1; k++) {
    const [s0, y0] = hull[k], [s1, y1] = hull[k + 1];
    if (s1 - s0 < 0.05) continue;
    const e0 = [at(s0, 0), at(s0, 1)], e1 = [at(s1, 0), at(s1, 1)];
    const gmin = groundRange([e0[0], e1[0], e1[1], e0[1]], 3).min;
    const c = lerp2(lerp2(e0[0], e0[1], 0.5), lerp2(e1[0], e1[1], 0.5), 0.5);
    const grade = Math.abs(y1 - y0) / (s1 - s0), stepped = grade > 0.08, dy = stepped ? STEP_SEAT : 0;
    const yb = Math.min(gmin, y0, y1) - 1.0;
    kit.at(c[0], c[1], 3).ribbon([{ l: e0[0], r: e0[1], y: y0 - dy, yb }, { l: e1[0], r: e1[1], y: y1 - dy, yb }], { meta: { role: stepped ? 'avenue flight ramp' : 'avenue' } });
    const planted = s1 - s0 > 14;
    if (stepped) {
      for (const [fa, fb] of planted ? walks : [[0, 1]]) {
        const hwS = ((fb - fa) * W) / 2;
        if (hwS < 0.6) continue;
        steps(kit, [at(s0, fa), at(s0, fb)], [at(s1, fa), at(s1, fb)], y0, y1, hwS);
      }
    }
    if (!planted) continue;
    const a = s0 + 3, b = s1 - 3, yAt = (s) => y0 - dy + ((y1 - y0) * (s - s0)) / (s1 - s0);
    for (const [fa, fb] of planters) {
      const top = 0.7;
      kit.at(...at((a + b) / 2, (fa + fb) / 2), 1).ribbon([{ l: at(a, fa), r: at(a, fb), y: yAt(a) + top, yb: yAt(a) - 0.02 }, { l: at(b, fa), r: at(b, fb), y: yAt(b) + top, yb: yAt(b) - 0.02 }], { top: K.GARDEN, meta: { role: 'avenue planter', supported: true } });
      const m = Math.max(1, Math.floor((b - a) / gap)), fm = (fa + fb) / 2;
      for (let q = 0; q < m; q++) {
        const s = a + ((b - a) * (q + 0.5)) / m, [x, z] = at(s, fm);
        kit.tree(x, yAt(s) + top, z, tree, treeS[0] + rnd() * treeS[1], rnd, { lean: 0 });
        if (q < m - 1 && (fb - fa) * W > 1.2) { const sl = a + ((b - a) * (q + 1)) / m, [lx, lz] = at(sl, fm); kit.at(lx, lz, 0).lamp(lx, lz, yAt(sl) + top - 0.05, lampH); }
      }
    }
  }
  kit.keep(A[0], A[1], W / 2 + 2); kit.keep(B[0], B[1], W / 2 + 2); kit.keep((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, W / 2 + 2);
}

// ------------------------------------------------------------------------------- gate
function gate(kit, L, place) {
  const g = L.gate;
  kit.at(g.x, g.z, 3).prism(g.q, g.gmin - 1, g.top, { top: K.PAVING, meta: { role: 'city gate' } });
  place(g.q, 'plaza');
}

// ---------------------------------------------------------------------------- planting
/** A plot left as a planted terrace. */
export function gardenPlot(kit, p, rnd, spec) {
  if (p.fill > 22 || p.gmin < 1.2) return;
  kit.at(...centroid(p.q), 3).prism(p.q, p.gmin - 1, p.top, { top: K.GARDEN, meta: { role: 'garden terrace' } });
  if (rnd() < 0.7) { const [x, z] = centroid(p.q); kit.tree(x, p.top, z, spec.gardenTree ?? SP.flowering, 5 + rnd() * 3, rnd); }
}
/** Ground too steep to terrace: trees rooted on the drawn ground. */
export function plantPlot(kit, p, rnd, spec, many = 0) {
  const M = plotMap(p.corners || p.q), n = many ? many + Math.floor(rnd() * many) : 1 + Math.floor(rnd() * 2.5);
  for (let k = 0; k < n; k++) {
    const [x, z] = M(0.25 + rnd() * 0.5, 0.25 + rnd() * 0.5);
    const g = Math.min(H(x, z), H(x + 0.8, z), H(x - 0.8, z), H(x, z + 0.8), H(x, z - 0.8));
    if (g < 2) continue;
    kit.tree(x, g, z, spec.slopeTree ?? SP.rainTree, 9 + rnd() * 4, rnd);
  }
}

/** The outline of a civic group as a plaza terrace (its top clears the ground under it). */
export function civicPlaza(kit, g, role, { minTop = -Infinity, top: kind = K.PAVING } = {}) {
  const r = groundRange(g.poly, 3), y = Math.max(r.max + 0.3, minTop);
  kit.at(...centroid(g.poly), 3).prism(g.poly, r.min - 1.2, y, { top: kind, meta: { role } });
  return y;
}
export { rect };

/**
 * A processional way on the axis beyond the Land Gate: landings every `spacing` metres just
 * above the ground, planted runs between them (flights where steep) and cypresses along both
 * sides, up to the terrace edge at u1 (at height yEnd, built by the caller).
 */
export function processional(kit, L, rnd, place, { u0, y0, u1, yEnd, hw = 9, spacing = 96, landL = 12, tree = SP.araucaria }) {
  const { P } = L;
  const edge = (u) => [P(u, -hw), P(u, hw)];
  const run = (ua, ya, ub, yb) => { if (ub - ua < 1) return; const ln = { a: edge(ua), b: edge(ub), ya, yb, w: 2 * hw }; avenueLane(kit, ln, rnd, { mall: 0, sides: [1.0, 3.2], tree, treeS: [10, 3], gap: 10 }); place([ln.a[0], ln.a[1], ln.b[1], ln.b[0]], 'way'); };
  const lands = [];
  for (let u = u0; u + spacing + landL < u1 - 40; ) {
    const a = u + spacing, b = a + landL, q = [P(a, -hw), P(b, -hw), P(b, hw), P(a, hw)], g = groundRange(q, 3);
    lands.push({ a, b, y: g.max + 0.3, gmin: g.min, q }); u = b;
  }
  let cur = { b: u0, y: y0 };
  for (const l of lands) {
    run(cur.b, cur.y, l.a, l.y);
    kit.at(...centroid(l.q), 3).prism(l.q, l.gmin - 1.2, l.y, { top: K.PAVING, meta: { role: 'way landing' } });
    place(l.q, 'way');
    cur = l;
  }
  run(cur.b, cur.y, u1, yEnd);
  // cypresses in pairs along the way, rooted on the drawn ground beside it
  for (let u = u0 + 12; u < u1 - 10; u += 20) for (const side of [-1, 1]) {
    const [x, z] = P(u, side * (hw + 4.5));
    const g = Math.min(H(x, z), H(x + 1, z), H(x, z + 1), H(x - 1, z), H(x, z - 1));
    if (g < 3) continue;
    kit.tree(x, g, z, SP.araucaria, 12 + rnd() * 4, rnd, { lean: 0 });
    kit.keep(x, z, 3);
  }
}
/** The corridor of a processional way for the island's road planner. */
export function wayReserve(L, u0, u1, r = 30) {
  const out = [];
  for (let u = u0 + 40; u <= u1; u += 45) { const [x, z] = L.P(u, 0); out.push({ x, z, r }); }
  return out;
}

/** The harbour's lights on the lighthouses of its mole heads: red to port, green to starboard. */
export function harbourLights(signals, L, lightH) {
  if (!signals) return;
  for (const m of L.hb.moles) {
    const left = (m.tip[0] - L.A0[0]) * L.b[0] + (m.tip[1] - L.A0[1]) * L.b[1] > 0;
    signals.push({ x: m.tip[0], y: m.top + lightH * 0.9, z: m.tip[1], c: left ? [1.0, 0.22, 0.12] : [0.25, 1.0, 0.45], s: 2.6 });
  }
}

/**
 * The bank between the harbour front and the first street: the ground left between the
 * esplanade and the city, planted as a hanging garden of trees rooted on the drawn ground.
 */
function bank(kit, L, rnd, occ, spec) {
  const { P } = L, u1 = L.rows[0].u - L.rows[0].w / 2 - 3;
  for (let u = 6; u < u1; u += 13) for (let v = -spec.cols.vMax; v <= spec.cols.vMax; v += 13) {
    const uu = u + (rnd() - 0.5) * 8, vv = v + (rnd() - 0.5) * 8;
    if (!spec.inside(Math.max(uu, spec.rows.u0), vv)) continue;
    const [x, z] = P(uu, vv), q = rect(x, z, 5, 5, L.ang);
    if (!occ.free(q, 1.5)) continue;
    const g = Math.min(H(x, z), H(x + 1.2, z), H(x - 1.2, z), H(x, z + 1.2), H(x, z - 1.2));
    if (g < 3.2 || Math.max(H(x + 1.2, z), H(x, z + 1.2)) - g > 1.4) continue;
    const r = rnd();
    kit.tree(x, g, z, r < 0.45 ? SP.rainTree : r < 0.75 ? SP.flowering : SP.palm, 8 + rnd() * 5, rnd);
    kit.keep(x, z, 4);
  }
}
