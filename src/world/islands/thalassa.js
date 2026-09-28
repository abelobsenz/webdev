import { K, TAU, H, rect, circlePoly, groundRange, Field, Occupancy, lerp2, centroid, pointInPoly, convexOverlap, segDist, offsetConvex } from './cityKit.js';
import { planDistrict, levelPlots, buildStreets, steps, upperHull, STEP_SEAT } from './district.js';
import { colonnade, stoa, tholos, archGate, lighthouse, obelisk, fountain, exedra } from './civic.js';
import { buildHarbour } from './harbour.js';
import { terrace, thalassaHouse, plotMap } from './typology.js';
import { harbourFront, civicPlaces, civicOf } from './thalassaCivic.js';
import { SP } from '../treeGeometry.js';
import { mulberry32 } from '../noise.js';

// THALASSA - the white city terraced up its island to a temple of the sea.
//
// One straight processional way, the Via Thalassa, climbs 5.3 km from the Sea Gate on the
// harbour to the Temple of the Sea on the summit, 420 m up (the summit lies within two
// degrees of the line from the capital, so from the lagoon the Via is a white thread up the
// middle of the island). The city is laid across its lower third as terraces along the
// contours: curved streets that keep their level round the hill, stepped lanes straight up
// the fall line between them, and two rows of white houses to each block, each house on its
// own terrace wall. Above the city the Via is a sacred way between olive terraces, with
// shrines at its landings, a viaduct across the ravine (the regional road passes under its
// widest arch), and a last great stair to the temple precinct.

const cache = new Map();

/** The city's frame, contour rows, lanes and civic sites (cheap; shared by reserve and build). */
export function layout(c) {
  if (cache.has(c.id)) return cache.get(c.id);
  // the summit
  let S = { h: -1e9 };
  for (let r = 0; r < c.ir * 0.9; r += 40) for (let a = 0; a < TAU; a += 0.04) {
    const x = c.ix + Math.cos(a) * r, z = c.iz + Math.sin(a) * r, h = H(x, z);
    if (h > S.h) S = { x, z, h };
  }
  for (let it = 0; it < 3; it++) for (let dx = -30; dx <= 30; dx += 6) for (let dz = -30; dz <= 30; dz += 6) { const h = H(S.x + dx, S.z + dz); if (h > S.h) S = { x: S.x + dx, z: S.z + dz, h }; }
  const A0 = [c.deep.x - c.d[0] * 34, c.deep.z - c.d[1] * 34];
  const Lv = Math.hypot(S.x - A0[0], S.z - A0[1]);
  const a = [(S.x - A0[0]) / Lv, (S.z - A0[1]) / Lv], b = [-a[1], a[0]];
  const P = (u, v) => [A0[0] + a[0] * u + b[0] * v, A0[1] + a[1] * u + b[1] * v];
  const UV = (x, z) => { const dx = x - A0[0], dz = z - A0[1]; return [dx * a[0] + dz * a[1], dx * b[0] + dz * b[1]]; };
  // a smoothed ground for laying out the contours
  const corners = [P(-400, -1900), P(-400, 1900), P(Lv + 300, -1900), P(Lv + 300, 1900)];
  const x0 = Math.min(...corners.map((p) => p[0])), x1 = Math.max(...corners.map((p) => p[0])), z0 = Math.min(...corners.map((p) => p[1])), z1 = Math.max(...corners.map((p) => p[1]));
  const F = new Field(x0, z0, 20, Math.ceil((x1 - x0) / 20) + 1, Math.ceil((z1 - z0) / 20) + 1).blur(95);
  const Fs = (u, v) => F.at(...P(u, v));
  // ---------------------------------------------------------------------- rows
  const DV = 10, VMAX = 1300, VS = [];
  for (let v = -VMAX; v <= VMAX; v += DV) VS.push(v);
  const mid = VS.indexOf(0);
  const rowU = [], UTOP = 2660;
  let u = 190;
  const rowsU = [];
  while (u < UTOP) { rowsU.push(u); u += 72; }
  let prev = null;
  for (const u0 of rowsU) {
    const U = new Float64Array(VS.length), L = Fs(u0, 0);
    U[mid] = u0;
    for (const dir of [1, -1]) for (let i = mid + dir; i >= 0 && i < VS.length; i += dir) {
      let q = U[i - dir];
      for (let it = 0; it < 6; it++) {
        const h = Fs(q, VS[i]), dh = (Fs(q + 6, VS[i]) - Fs(q - 6, VS[i])) / 12;
        if (dh < 0.02) break;
        q -= Math.max(-20, Math.min(20, (h - L) / dh));
      }
      U[i] = Math.max(U[i - dir] - 0.42 * DV, Math.min(U[i - dir] + 0.42 * DV, q));
    }
    const order = () => { if (prev) for (let i = 0; i < VS.length; i++) U[i] = Math.max(prev[i] + 46, Math.min(prev[i] + 118, U[i])); };
    const smooth = () => { const t = U.slice(); for (let i = 1; i < VS.length - 1; i++) U[i] = 0.25 * t[i - 1] + 0.5 * t[i] + 0.25 * t[i + 1]; };
    order(); for (let k = 0; k < 4; k++) smooth(); order();
    // every row crosses the via square to it
    for (let i = mid - 3; i <= mid + 3; i++) U[i] = u0;
    for (let k = 0; k < 2; k++) smooth(); order();
    rowU.push(U); prev = U;
  }
  const at = (U) => (v) => { const f = Math.max(0, Math.min(VS.length - 1.0001, (v + VMAX) / DV)), i = Math.floor(f), t = f - i; return U[i] + (U[i + 1] - U[i]) * t; };
  const rows = rowU.map((U, k) => ({ U: at(U), v0: -VMAX + 20, v1: VMAX - 20, w: k % 4 === 2 ? 11 : 8, main: k % 4 === 2 }));
  // ---------------------------------------------------------------------- lanes
  const cols = [{ v: 0, w: 24, via: true }];
  for (const s of [-1, 1]) for (let j = 0, v = 12 + 34; Math.abs(v) < VMAX - 30; j++, v += 74 + (j % 3 === 0 ? 6 : 0)) cols.push({ v: s * v, w: j % 3 === 2 ? 9 : 6 });
  cols.sort((p, q) => p.v - q.v);
  // the city outline in the frame: a leaf from the harbour to the upper agora
  const half = (uu, side) => {
    const t = Math.max(0, Math.min(1, (uu - 150) / 900)), top = Math.max(0, Math.min(1, (UTOP - uu) / 500));
    return (side < 0 ? 780 : 640) * Math.sqrt(t) * (0.45 + 0.55 * Math.sqrt(top)) + 240;
  };
  // civic sites along the via (frame coordinates: u range, v range)
  const civic = [
    { id: 'harbour agora', u0: 150, u1: 330, v0: -170, v1: -12 },
    { id: 'gymnasium', u0: 150, u1: 330, v0: 12, v1: 150 },
    { id: 'nymphaeum', u0: 1150, u1: 1240, v0: -60, v1: 60 },
    { id: 'upper agora', u0: 2380, u1: UTOP + 40, v0: -230, v1: 230 },
  ];
  const L = { c, S, A0, a, b, P, UV, Lv, F, Fs, rows, cols, half, UTOP, civic, VS };
  // the acropolis square round the summit, and the temple a little behind its centre
  L.temple = { u0: Lv - 92, u1: Lv + 86, hw: 88, uc: Lv + 6 };
  // the theatre of the sea: the best seat of a 140 m cavea facing the harbour
  L.theatre = findTheatre(L);
  L.civic.push({ id: 'theatre', ...L.theatre.box });
  // the gate where the island's roads start: the end of a middle row on the east side
  L.gate = findGate(L);
  cache.set(c.id, L);
  return L;
}

function findTheatre(L) {
  // cavea centred on the orchestra at (u, v) opening toward -u (the sea); search a band east of the via
  let best = null;
  for (let u = 1500; u <= 2500; u += 40) for (let v = 300; v <= 700; v += 40) {
    const [x, z] = L.P(u, v), r = 72;
    const front = H(x, z), back = H(...L.P(u + r, v)), l = H(...L.P(u + r * 0.7, v - r * 0.7)), rr = H(...L.P(u + r * 0.7, v + r * 0.7));
    const rise = back - front, side = Math.abs(l - rr);
    if (front < 20) continue;
    const score = Math.abs(rise - 22) + side * 1.5 + Math.abs(v - 460) * 0.02;
    if (!best || score < best.score) best = { u, v, score, r };
  }
  const t = best;
  return { u: t.u, v: t.v, r: t.r, box: { u0: t.u - 30, u1: t.u + t.r + 16, v0: t.v - t.r - 16, v1: t.v + t.r + 16 } };
}

function findGate(L) {
  // the east end of the row nearest u = 1500, just outside the city outline
  let k = 0, bu = 1e9;
  L.rows.forEach((r, i) => { const d = Math.abs(r.U(0) - 1500); if (d < bu) { bu = d; k = i; } });
  const row = L.rows[k];
  const v = -(L.half(row.U(0), -1) + 60);
  const [x, z] = L.P(row.U(v), v);
  // the gate square's floor clears the ground a little beyond it; the road starts 3 cm lower
  const g = groundRange(circlePoly(x, z, 26, 20), 3);
  return { x, z, top: g.max + 0.3, gmin: g.min, y: g.max + 0.27, row: k, v };
}

/** Circles over the city and the via for the island's road planner (regional roads keep out). */
export function reserve(c) {
  const L = layout(c), out = [];
  for (let u = 260; u <= L.UTOP; u += 170) {
    for (let v = -L.half(u, -1); v <= L.half(u, 1); v += 170) {
      const [x, z] = L.P(u, v);
      if (H(x, z) < 2) continue;
      out.push({ x, z, r: 120 });
    }
  }
  // the sacred way: its corridor, open only under the viaduct
  for (let u = L.UTOP; u < L.Lv - 150; u += 110) {
    if (u > 3380 && u < 3760) continue;
    const [x, z] = L.P(u, 0); out.push({ x, z, r: 45 });
  }
  out.push({ x: L.S.x, z: L.S.z, r: 190 });
  return { obstacles: out, gate: { x: L.gate.x, z: L.gate.z, y: L.gate.y } };
}

// =================================================================================== build
export function build({ kit, c, rnd, placed }) {
  const L = layout(c), { P, UV } = L, plan = c.plan;
  const occ = new Occupancy(48);
  const circleOf = (q, r) => { const [x, z] = centroid(q); return { x, z, r: r ?? Math.max(...q.map((p) => Math.hypot(p[0] - x, p[1] - z))) + 1 }; };
  const place = (q, tag, r) => { if (tag !== 'plot' && tag !== 'grove') occ.add(q, tag); placed.push(circleOf(q, r)); };
  const roadFree = (q) => { const [x, z] = centroid(q), r = Math.max(...q.map((p) => Math.hypot(p[0] - x, p[1] - z))); return plan.isRoadFree(x, z, r) && !plan.reserved.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 20); };
  // ------------------------------------------------------------------ the district
  const via = { landings: new Map() }, slopes = [];
  const D = {
    P, rows: L.rows, cols: L.cols, rnd, grade: 0.07,
    plotWidths: (r) => 13 + r() * 9,
    civic: (i, j, quad) => civicOf(L, i, j, quad),
    blockOk: (i, j, quad) => {
      for (const [x, z] of quad) { const [u, v] = UV(x, z); if (Math.abs(v) > L.half(u, Math.sign(v) || 1) || u > L.UTOP) return false; if (H(x, z) < 2.6) return false; }
      if (!roadFree(quad)) return false;
      const g = groundRange(quad, 8);
      if (g.max - g.min >= 18) { slopes.push(quad); return false; }
      return true;

    },
    resolveVia: (need) => { for (const [i, y] of need) via.landings.set(i, y); return resolveLandings(L, via, need); },
  };
  const dp = planDistrict(D);
  levelPlots(dp, { maxFill: 13 });
  for (const st of dp.streets) for (let k = 0; k < st.pts.length - 1; k++) occ.add([st.pts[k].l, st.pts[k + 1].l, st.pts[k + 1].r, st.pts[k].r], 'street');
  for (const ln of dp.lanes) occ.add([ln.a[0], ln.a[1], ln.b[1], ln.b[0]], 'lane');
  for (const p of dp.plots) occ.add(p.q, 'plot');
  // ------------------------------------------------------------------ build
  {
    const T = L.temple, q = [P(T.u0, -T.hw), P(T.u1, -T.hw), P(T.u1, T.hw), P(T.u0, T.hw)];
    T.top = groundRange(q, 4).max + 0.5;
  }
  harbourWorks(kit, L, rnd, place);
  buildVia(kit, L, via, rnd, place);
  sacredWay(kit, L, rnd, place, plan);
  temple(kit, L, rnd, place);
  buildStreets(kit, dp);
  for (const s of dp.streets) for (let k = 0; k < s.pts.length - 1; k += 2) placed.push(circleOf([s.pts[k].l, s.pts[k + 1].l, s.pts[k + 1].r, s.pts[k].r]));
  for (const ln of dp.lanes) placed.push(circleOf([ln.a[0], ln.a[1], ln.b[1], ln.b[0]]));
  // the houses: each plot's terrace (with its entry flight), then its house, its garden tree;
  // plots too steep to fill become wooded slope (stone pines and cypresses on the ground)
  for (const p of dp.plots) {
    if (!p.ok) { if (p.gmin > 2) plantSlope(kit, p, rnd); place(p.q, 'grove'); continue; }
    const need = terrace(kit, p);
    if (need === null) { gardenTerrace(kit, p, rnd); place(p.q, 'plot'); continue; }
    const res = thalassaHouse(kit, p, rnd, { front: need, extraFloors: L.rows[p.row]?.main ? 1 : 0 });
    if (res) gardenTree(kit, p, res, rnd);
    place(p.q, 'plot');
  }
  harbourFront(kit, L, rnd, occ, place);
  for (const q of slopes) if (occ.free(q, -0.5)) { plantSlope(kit, { q }, rnd, 4); place(q, "grove"); }
  civicPlaces(kit, L, rnd, place, occ, dp);
  gate(kit, L, place);
  if (typeof process !== 'undefined' && process.env?.ISLAND_DEBUG) console.log('thalassa', { crossings: L.crossings, templeTop: L.temple.top, seaGate: L.seaGate, quay: L.hb.frontOff });
}

// ------------------------------------------------------------------------- the via
function resolveLandings(L, via, need) {
  const { P } = L;
  const out = new Map();
  for (const [i, y] of need) {
    const row = L.rows[i];
    const us = [row.U(-12), row.U(12)];
    const a = Math.min(...us) - row.w / 2 - 3, b = Math.max(...us) + row.w / 2 + 3;
    const g = groundRange([P(a, -12), P(b, -12), P(b, 12), P(a, 12)], 3);
    const top = Math.max(g.max + 0.3, y);
    out.set(i, top);
    via.landings.set(i, { a, b, y: top, gmin: g.min });
  }
  return out;
}

function buildVia(kit, L, via, rnd, place) {
  const { P } = L, hw = 12;
  const lands = [...via.landings.entries()].sort((p, q) => p[1].a - q[1].a).map(([i, l]) => ({ i, ...l }));
  const segs = [];
  const landing = (a, b, y, gmin) => {
    const q = [P(a, -hw), P(b, -hw), P(b, hw), P(a, hw)];
    kit.at(...centroid(q), 3).prism(q, gmin - 1.2, y, { wall: K.STONE, top: K.PAVING, vBase: y, meta: { role: 'via landing' } });
    segs.push({ s0: a, s1: b, y0: y, y1: y, landing: true });
    place(q, 'via');
  };
  const run = (a, ya, b, yb) => {
    if (b - a < 0.5) return;
    const pts = [[a, ya]];
    for (let s = a + 3; s < b - 1.5; s += 3) {
      let g = -Infinity; for (const v of [-hw, -hw / 2, 0, hw / 2, hw]) g = Math.max(g, H(...P(s, v)), H(...P(s + 1.5, v)));
      pts.push([s, g + 0.3]);
    }
    pts.push([b, yb]);
    const hull = upperHull(pts);
    for (let k = 0; k < hull.length - 1; k++) {
      const [s0, y0] = hull[k], [s1, y1] = hull[k + 1];
      if (s1 - s0 < 0.05) continue;
      const q = [P(s0, -hw), P(s1, -hw), P(s1, hw), P(s0, hw)];
      const g = groundRange(q, 4), stepped = Math.abs(y1 - y0) / (s1 - s0) > 0.08, dy = stepped ? STEP_SEAT : 0;
      kit.at(...centroid(q), 3).ribbon([{ l: P(s0, -hw), r: P(s0, hw), y: y0 - dy, yb: g.min - 1.2 }, { l: P(s1, -hw), r: P(s1, hw), y: y1 - dy, yb: g.min - 1.2 }], { meta: { role: 'via run' } });
      const planted = L.viaPlanters && s1 - s0 > 14;
      if (stepped) steps(kit, [P(s0, planted ? -8.8 : -hw), P(s0, planted ? 8.8 : hw)], [P(s1, planted ? -8.8 : -hw), P(s1, planted ? 8.8 : hw)], y0, y1, planted ? 8.8 : hw);
      if (planted) viaPlanters(kit, L, s0, s1, y0 - dy, y1 - dy, rnd);
      place(q, 'via');
      segs.push({ s0, s1, y0, y1 });
    }
  };
  // from the landward edge of the sea gate plaza (see harbourWorks)
  let cur = { b: L.seaGate.u, y: L.seaGate.y };
  L.viaPlanters = true;
  for (const l of lands) {
    run(cur.b, cur.y, l.a, l.y);
    landing(l.a, l.b, l.y, l.gmin);
    cur = { b: l.b, y: l.y };
  }
  L.viaTop = cur;
  L.viaPlanters = false;
  L.viaRun = run; L.viaLanding = landing; L.viaSegs = segs;
  L.viaAt = (u) => { for (const s of segs) if (u >= s.s0 - 1e-6 && u <= s.s1 + 1e-6) return s.y0 + (s.y1 - s.y0) * (u - s.s0) / Math.max(1e-6, s.s1 - s.s0); return null; };
}

/**
 * Planters down both sides of a run of the via (on the ramp that carries its steps): stone
 * troughs planted with cypresses, lamps between them.
 */
function viaPlanters(kit, L, s0, s1, y0, y1, rnd) {
  const { P } = L, a = s0 + 3, b = s1 - 3, yAt = (s) => y0 + ((y1 - y0) * (s - s0)) / (s1 - s0);
  if (b - a < 8) return;
  for (const side of [-1, 1]) {
    const v0 = side * 9.0, v1 = side * 11.6, top = 0.75;
    kit.at(...P((a + b) / 2, side * 10.3), 1).ribbon([{ l: P(a, v0), r: P(a, v1), y: yAt(a) + top, yb: yAt(a) - 0.02 }, { l: P(b, v0), r: P(b, v1), y: yAt(b) + top, yb: yAt(b) - 0.02 }], { top: K.GARDEN, meta: { role: 'via planter', supported: true } });
    const n = Math.max(1, Math.floor((b - a) / 11));
    for (let k = 0; k < n; k++) {
      const s = a + ((b - a) * (k + 0.5)) / n, [x, z] = P(s, side * 10.3);
      kit.tree(x, yAt(s) + top, z, SP.araucaria, 10 + rnd() * 3, rnd, { lean: 0 });
      if (k < n - 1) { const sl = a + ((b - a) * (k + 1)) / n, [lx, lz] = P(sl, side * 10.3); kit.at(lx, lz, 0).lamp(lx, lz, yAt(sl) + top - 0.05, 5); }
    }
  }
}

/**
 * The sacred way above the city: landings every ~100 m that never descend, straight runs
 * between them over the ground (steps where steep), a viaduct of arches where the way
 * crosses the ravine high above it, and the last flights up to the temple precinct.
 */
function sacredWay(kit, L, rnd, place, plan) {
  const { P } = L, hw = 12;
  const u0 = L.viaTop.b, y0 = L.viaTop.y, uEnd = L.temple.u0;
  const need = (a, b) => { const g = groundRange([P(a, -hw), P(b, -hw), P(b, hw), P(a, hw)], 3); return g; };
  // road crossings: where a regional road crosses the line of the way
  const crossings = [];
  for (const r of plan.routes) for (let k = 1; k < r.points.length; k++) {
    const A = L.UV(...r.points[k - 1]), B = L.UV(...r.points[k]);
    if ((A[1] > 0) === (B[1] > 0)) continue;
    const t = A[1] / (A[1] - B[1]), u = A[0] + (B[0] - A[0]) * t;
    if (u > u0 && u < uEnd) crossings.push({ u, w: r.width });
  }
  L.crossings = crossings;
  // landings
  const lands = [];
  let u = u0, y = y0;
  const spacing = 104;
  while (u + spacing + 12 < uEnd - 40) {
    const a = u + spacing, b = a + 12;
    if (crossings.some((c) => Math.abs(c.u - (a + b) / 2) < 50)) { u += 30; continue; }
    const g = need(a, b);
    y = Math.max(y, g.max + 0.3);
    lands.push({ a, b, y, gmin: g.min });
    u = b - spacing + spacing;   // next
    u = b;
  }
  // the last landing is the head of the stair, level with the acropolis terrace
  const gT = need(uEnd - 14, uEnd);
  lands.push({ a: uEnd - 14, b: uEnd, y: Math.max(y, L.temple.top), gmin: gT.min, last: true });
  // runs (with viaduct spans where the way flies high over the ground)
  let cur = { b: u0, y: y0 };
  for (const l of lands) {
    const high = viaductSpan(kit, L, cur, l, crossings, place);
    if (!high) L.viaRun(cur.b, cur.y, l.a, l.y);
    L.viaLanding(l.a, l.b, l.y, l.gmin);
    if (!l.last && lands.indexOf(l) % 3 === 1) wayShrine(kit, L, l, rnd, place);
    cur = { b: l.b, y: l.y };
  }
  L.templeFootY = cur.y;
  // cypresses in pairs along the way (clear of its edges), rooted on the drawn ground
  for (let s = u0 + 20; s < uEnd - 20; s += 22) for (const side of [-1, 1]) {
    const v = side * (hw + 4.2), [x, z] = P(s, v);
    if (crossings.some((c) => Math.abs(c.u - s) < 45)) continue;
    const g = Math.min(H(x, z), H(x + 1, z), H(x, z + 1), H(x - 1, z), H(x, z - 1));
    if (g < 3) continue;
    kit.tree(x, g, z, SP.araucaria, 13 + rnd() * 4, rnd, { lean: 0 });
    kit.keep(x, z, 3);
  }
}

/** A viaduct of round arches carrying the way over a dip, when the way stands > 9 m above it. */
function viaductSpan(kit, L, from, to, crossings, place) {
  const { P } = L, hw = 12;
  if (Math.abs(to.y - from.y) > 0.5) return false;
  const a = from.b, b = to.a, y = to.y;
  const g = groundRange([P(a, -hw), P(b, -hw), P(b, hw), P(a, hw)], 3);
  if (y - g.min < 10 || g.max + 2.5 > y) return false;
  // piers every ~26 m, a wide span centred over any road passing under
  const cuts = [a];
  const cr = crossings.filter((c) => c.u > a + 20 && c.u < b - 20);
  const wide = cr.map((c) => [c.u - c.w / 2 - 12, c.u + c.w / 2 + 12]);
  let u = a;
  while (u < b - 1) {
    let next = u + 26;
    const w = wide.find(([p, q]) => next > p && u < q);
    if (w) next = Math.max(next, w[1] + 2.5);
    if (b - next < 14) next = b;
    cuts.push(Math.min(b, next)); u = next;
  }
  const deckB = y - 1.8, pierT = 4.4;
  // deck slab on the piers and arches (a closed ribbon, supported)
  kit.at(...P((a + b) / 2, 0), 3).ribbon([{ l: P(a, -hw), r: P(a, hw), y, yb: deckB }, { l: P(b, -hw), r: P(b, hw), y, yb: deckB }], { meta: { role: 'viaduct deck', supported: true } });
  place([P(a, -hw), P(b, -hw), P(b, hw), P(a, hw)], 'via');
  // parapets
  for (const side of [-1, 1]) {
    const q = [P(a, side * hw), P(b, side * hw), P(b, side * (hw - 0.6)), P(a, side * (hw - 0.6))];
    kit.at(...P((a + b) / 2, side * hw), 1).prism(q, y - 0.05, y + 1.1, { wall: K.STONE, top: K.STONE, meta: { role: 'parapet', supported: true } });
  }
  // piers at every inner cut (the ends rest on the landings' walls)
  for (let k = 1; k < cuts.length - 1; k++) {
    const c = cuts[k], q = [P(c - pierT / 2, -hw), P(c + pierT / 2, -hw), P(c + pierT / 2, hw), P(c - pierT / 2, hw)], gg = groundRange(q, 2);
    kit.at(...P(c, 0), 3).prism(q, gg.min - 1.5, deckB + 0.02, { wall: K.STONE, top: K.STONE, meta: { role: 'viaduct pier' } });
  }
  // arch spandrels between pier faces (the landing walls at the ends count as abutments)
  for (let k = 0; k < cuts.length - 1; k++) {
    const s0 = cuts[k] + (k === 0 ? 0 : pierT / 2), s1 = cuts[k + 1] - (k === cuts.length - 2 ? 0 : pierT / 2);
    const span = s1 - s0, rr = span / 2, gg = groundRange([P(s0, -hw), P(s1, -hw), P(s1, hw), P(s0, hw)], 3);
    const spring = Math.max(gg.max + 2.5, deckB - rr - 1.4);
    const rise = Math.min(rr, deckB - 1.2 - spring);
    if (rise < 2) continue;
    const prof = [[s0, deckB + 0.02], [s0, spring]];
    for (let q = 1; q < 16; q++) { const t = Math.PI * (1 - q / 16); prof.push([s0 + rr + Math.cos(t) * rr, spring + Math.sin(t) * rise]); }
    prof.push([s1, spring], [s1, deckB + 0.02]);
    kit.at(...P((s0 + s1) / 2, 0), 3).extrude(prof, L.A0, L.a, L.b, -hw + 0.3, hw - 0.3, { kinds: () => K.STONE, meta: { role: 'viaduct arch', supported: true, attached: true } });
  }
  return true;
}

/** A shrine beside a landing of the sacred way: a small tholos on its own platform. */
function wayShrine(kit, L, l, rnd, place) {
  const side = rnd() < 0.5 ? -1 : 1, um = (l.a + l.b) / 2;
  const q = [L.P(um - 13, side * 12), L.P(um + 13, side * 12), L.P(um + 13, side * 38), L.P(um - 13, side * 38)], g = groundRange(q, 2);
  if (g.max - g.min > 7) return;
  const top = Math.max(g.max + 0.3, l.y);
  kit.at(...centroid(q), 3).prism(q, g.min - 1, top, { top: K.PAVING, meta: { role: 'shrine platform' } });
  const [x, z] = L.P(um, side * 25);
  tholos(kit, x, z, top, 6.5, { cols: 8, colH: 7, gilt: true });
  place(q, 'shrine');
}

// ---------------------------------------------------------------------- the temple
/**
 * The Temple of the Sea on the summit: an acropolis terrace (its retaining walls coursed and
 * buttressed), a propylon where the way arrives, a precinct stoa round three sides, the
 * great round temple with its peristyle, drum and dome, and a lit lantern for the sailors.
 */
function temple(kit, L, rnd, place) {
  const { P } = L, T = L.temple;
  const q = [P(T.u0, -T.hw), P(T.u1, -T.hw), P(T.u1, T.hw), P(T.u0, T.hw)];
  const g = groundRange(q, 4);
  const top = T.top;
  kit.at(L.S.x, L.S.z, 3).prism(q, g.min - 2, top, { wall: K.STONE, top: K.PAVING, meta: { role: 'acropolis terrace' } });
  place(q, 'temple', T.hw * 1.45);
  // courses and buttresses on the retaining walls (tier 2: they read from a few km)
  for (let yy = Math.ceil((g.min + 3) / 7) * 7; yy < top - 2; yy += 7) {
    for (const [a, b] of [[[T.u0, -T.hw], [T.u1, -T.hw]], [[T.u1, -T.hw], [T.u1, T.hw]], [[T.u1, T.hw], [T.u0, T.hw]]]) {
      const pa = P(...a), pb = P(...b), dx = pb[0] - pa[0], dz = pb[1] - pa[1], len = Math.hypot(dx, dz), n = [dz / len, -dx / len];
      // outward normal: away from the terrace centre
      const cc = P((T.u0 + T.u1) / 2, 0), m = lerp2(pa, pb, 0.5), sg = (m[0] - cc[0]) * n[0] + (m[1] - cc[1]) * n[1] > 0 ? 1 : -1;
      const o = [n[0] * sg * 0.5, n[1] * sg * 0.5];
      const band = [pa, pb, [pb[0] + o[0], pb[1] + o[1]], [pa[0] + o[0], pa[1] + o[1]]];
      // only where the wall stands above the ground at this course
      const gb = groundRange(band, 6);
      if (gb.max > yy - 0.1) continue;
      kit.at(m[0], m[1], 2).prism(band, yy, yy + 0.6, { wall: K.STONE, top: K.STONE, meta: { role: 'wall course', supported: true, attached: true } });
    }
  }
  // buttresses along the front wall, grounded
  for (let v = -T.hw + 14; v <= T.hw - 14; v += 22) {
    if (Math.abs(v) < 16) continue;
    const bq = [P(T.u0 - 4, v - 2.5), P(T.u0, v - 2.5), P(T.u0, v + 2.5), P(T.u0 - 4, v + 2.5)], gb = groundRange(bq, 2);
    if (top - gb.min < 4) continue;
    kit.at(...P(T.u0 - 2, v), 3).prism(bq, gb.min - 1, top - 1.2, { wall: K.STONE, top: K.STONE, meta: { role: 'buttress' } });
  }
  const F = { O: L.A0, A: L.a, B: L.b, a: Math.atan2(L.a[1], L.a[0]), f: P };
  // the propylon over the head of the stair
  archGate(kit, F, T.u0 + 8, top, { W: 46, T: 8, Hh: 17, main: [9, 12.5], side: [5, 8], spacing: 12.5 });
  // the precinct stoa round the back and sides
  const sd = 14, sh = 9;
  const stoaF = (O, a) => { const A = [Math.cos(a), Math.sin(a)], B = [-A[1], A[0]]; return { O, A, B, a, f: (u, v) => [O[0] + A[0] * u + B[0] * v, O[1] + A[1] * u + B[1] * v] }; };
  const ang = Math.atan2(L.a[1], L.a[0]);
  // back stoa: along -v..+v at u1, facing the temple (-u)
  stoa(kit, stoaF(P(T.u1 - 3, -(T.hw - 3)), ang + Math.PI / 2), 2 * T.hw - 6, sd, top, sh);
  // side stoas along u at v = +-(hw - 3), facing the axis
  const Ls = T.u1 - T.u0 - 40 - sd;
  stoa(kit, stoaF(P(T.u0 + 34, -(T.hw - 3)), ang), Ls, sd, top, sh);
  stoa(kit, stoaF(P(T.u0 + 34 + Ls, T.hw - 3), ang + Math.PI), Ls, sd, top, sh);
  // the temple
  const [tx, tz] = P(T.uc, 0);
  const R = 34, cols = 28, ch = 17;
  kit.at(tx, tz, 3).lathe(tx, tz, [[R + 9, top - 0.25, K.STONE], [R + 9, top + 1, K.STONE], [R + 7, top + 1, K.PAVING], [R + 7, top + 2, K.STONE], [R + 5, top + 2, K.PAVING], [R + 5, top + 3, K.STONE], [R + 3, top + 3, K.PAVING], [R + 3, top + 4, K.STONE], [0, top + 4, K.PAVING]], 48, { meta: { role: 'temple crepidoma', supported: true } });
  const y1 = top + 4;
  for (let k = 0; k < cols; k++) { const a = (k / cols) * TAU; kit.at(tx, tz, 1).column(tx + Math.cos(a) * R, tz + Math.sin(a) * R, y1, ch, 1.25, { seg: 10, meta: { role: 'column', supported: true } }); }
  // columns stay visible far off as a ring of massing piers (a thin drum is lighter)
  kit.at(tx, tz, 3).lathe(tx, tz, [[R * 0.66, y1 - 0.1, K.PUNCHED], [R * 0.66, y1 + ch, K.STONE], [R + 2.4, y1 + ch - 0.02, K.STONE], [R + 2.4, y1 + ch + 3.2, K.STONE], [R * 0.8, y1 + ch + 3.2, K.STONE], [R * 0.8, y1 + ch + 10, K.STONE], [R * 0.84, y1 + ch + 10, K.STONE], [R * 0.84, y1 + ch + 11, K.STONE],
    ...Array.from({ length: 9 }, (_, i) => { const t = ((i + 1) / 10) * Math.PI / 2; return [Math.max(0.05, R * 0.8 * Math.cos(t)), y1 + ch + 11 + Math.sin(t) * R * 0.62, K.STONE]; }), [0, y1 + ch + 11 + R * 0.62, K.STONE]], 48, { meta: { role: 'temple', supported: true } });
  const dt = y1 + ch + 11 + R * 0.62 - 0.25;
  kit.at(tx, tz, 3, 'gilt').lathe(tx, tz, [[R * 0.13, dt, K.LANTERN], [R * 0.13, dt + 6, K.LANTERN], [R * 0.17, dt + 6.2, K.LANTERN], [R * 0.17, dt + 7, K.LANTERN], [0.05, dt + 13, K.LANTERN]], 16, { meta: { role: 'temple lantern', supported: true } });
  // the altar and two great braziers on the forecourt
  const [ax, az] = P(T.u0 + 30, 0);
  kit.at(ax, az, 2).prism(rect(ax, az, 7, 14, ang), top - 0.1, top + 1.6, { wall: K.STONE, top: K.STONE, meta: { role: 'altar', supported: true } });
  for (const s of [-1, 1]) { const [bx, bz] = P(T.u0 + 30, s * 14); obelisk(kit, bx, bz, top, 16, 1.4, { tier: 2 }); }
}

// -------------------------------------------------------------------------- harbour
/**
 * The harbour: a quay along the shore either side of the arrival square (its sea wall on the
 * 3 m isobath), two moles curving out to a mouth on the axis with a lighthouse on each head,
 * a row of arcaded harbour houses behind the quay, and the Sea Gate at the foot of the Via.
 */
function harbourWorks(kit, L, rnd, place) {
  const { P } = L;
  const hb = buildHarbour(kit, { A0: L.A0, a: L.a, span: 380, mouth: 330, width: 60, moleW: 16, lightH: 40, place, gapU: 70, gapHalf: 44, apronOut: 32 });
  L.hb = hb;
  // the sea gate plaza fills the gap in the quay on the axis, from the sea wall to the foot of
  // the via; the quay's end sections and the via's first section are its edges
  const { A, B } = hb.gap;
  const uOf = (p) => L.UV(p[0], p[1])[0];
  let uStart = Math.max(uOf(A.r), uOf(B.r)) + 6;
  const poly = (u) => [A.l, B.l, B.r, P(u, 12), P(u, -12), A.r];
  let g = groundRange(poly(uStart), 3);
  while (g.max > hb.yq - 0.3 && uStart > Math.max(uOf(A.r), uOf(B.r)) - 20) { uStart -= 3; g = groundRange(poly(uStart), 3); }
  const top = Math.max(hb.yq, g.max + 0.3);
  const q = poly(uStart);
  kit.at(...centroid(q), 3).prism(q, g.min - 1.5, top, { top: K.PAVING, meta: { role: 'sea gate plaza' } });
  place(q, 'plaza');
  L.seaGate = { u: uStart, y: top };
  // the sea gate across the plaza where it is widest, obelisks on the wall line
  const F = { O: L.A0, A: L.a, B: L.b, a: Math.atan2(L.a[1], L.a[0]), f: P };
  const uw = Math.max(uOf(A.l), uOf(B.l));
  let ug = uw + 10, W = 60;
  const inside = (uu, ww) => [[uu - 5.5, -ww / 2 - 1], [uu + 5.5, -ww / 2 - 1], [uu + 5.5, ww / 2 + 1], [uu - 5.5, ww / 2 + 1]].every(([u, v]) => pointInPoly(q, ...P(u, v)));
  while (W > 30 && !inside(ug, W)) { if (ug < uStart - 8) ug += 2; else { ug = uw + 10; W -= 4; } }
  if (inside(ug, W)) archGate(kit, F, ug, top, { W, T: 10, Hh: Math.min(24, W * 0.38), main: [10, Math.min(16, W * 0.26)], side: [5.5, Math.min(10, W * 0.17)], spacing: W * 0.28 });
}
// --------------------------------------------------------------------------- houses
/** A plot left as a planted terrace (it could not take an entry flight and a house). */
function gardenTerrace(kit, p, rnd) {
  if (p.fill > 22 || p.gmin < 1.2) return;
  kit.at(...centroid(p.q), 3).prism(p.q, p.gmin - 1, p.top, { top: K.GARDEN, meta: { role: 'garden terrace' } });
  if (rnd && rnd() < 0.6) { const [x, z] = centroid(p.q); kit.tree(x, p.top, z, SP.flowering, 5 + rnd() * 2, rnd); }
}
/** A cypress or a palm in the garden behind (or the court within) a house. */
function gardenTree(kit, p, res, rnd) {
  const M = plotMap(p.corners || p.q);
  if (res.court && rnd() < 0.7) { const [x, z] = centroid(res.court); kit.tree(x, p.top + 0.35, z, SP.palm, 7 + rnd() * 3, rnd); return; }
  // the back garden: from the house's back wall to the plot's back edge
  const back = res.quads[0];
  const Q = p.corners || p.q, dq = Math.hypot(Q[3][0] - Q[0][0], Q[3][1] - Q[0][1]);
  const hb = Math.hypot(back[3][0] - Q[0][0], back[3][1] - Q[0][1]);
  const gd = dq - hb;
  if (gd < 3.2 || rnd() > 0.55) return;
  const t = 1 - gd / 2 / dq, s = 0.25 + rnd() * 0.5, [x, z] = M(s, t);
  if (rnd() < 0.7) kit.tree(x, p.top, z, SP.araucaria, 8 + rnd() * 5, rnd, { lean: 0 });
  else kit.tree(x, p.top, z, SP.palm, 6 + rnd() * 3, rnd);
}
/** A plot too steep to build: stone pines and cypresses rooted on the drawn ground. */
function plantSlope(kit, p, rnd, many = 0) {
  const M = plotMap(p.corners || p.q), n = many ? many + Math.floor(rnd() * many) : 1 + Math.floor(rnd() * 2.5);

  for (let k = 0; k < n; k++) {
    const [x, z] = M(0.25 + rnd() * 0.5, 0.25 + rnd() * 0.5);
    const g = Math.min(H(x, z), H(x + 0.8, z), H(x - 0.8, z), H(x, z + 0.8), H(x, z - 0.8));
    if (rnd() < 0.55) kit.tree(x, g, z, SP.rainTree, 9 + rnd() * 4, rnd);
    else kit.tree(x, g, z, SP.araucaria, 11 + rnd() * 5, rnd, { lean: 0 });
  }
}

// -------------------------------------------------------------------------- harbour

function gate(kit, L, place) {
  const g = L.gate, q = circlePoly(g.x, g.z, 16, 16);
  kit.at(g.x, g.z, 3).prism(q, g.gmin - 1, g.top, { top: K.PAVING, meta: { role: 'city gate' } });
  place(q, 'plaza');
}
