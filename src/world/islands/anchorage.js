import { K, TAU, H, rect, circlePoly, groundRange, lerp2, centroid, pointInPoly, offsetConvex, Occupancy } from './cityKit.js';
import { gridLayout, gridReserve, buildGridCity, civicPlaza, processional, wayReserve } from './gridCity.js';
import { colonnade, stoa, fountain, obelisk, tholos, lighthouse, frameOf } from './civic.js';
import { stairBlock } from './district.js';
import { plotMap, FH, arcadedRange } from './typology.js';
import { SP } from '../treeGeometry.js';

// ANCHORAGE - the great western port.
//
// The city fills the coastal lowland behind its harbour on a grid laid square to the station
// footbridge: sixteen streets across the axis, lanes every hundred metres, perimeter blocks of
// stone and glass round garden courts. The Strand runs along the harbour front on its
// esplanade; the Harbour Way, a planted boulevard 48 m wide, climbs from the Sea Gate between
// the Twin Towers of the Harbour Gate (their sky arch 470 m over the boulevard), through the
// Exchange Square, past the Commons to the Land Gate where the island's roads begin. The
// business towers stand in their own courts either side of the Way, tallest near the twins.
// West of the city the Mere, a lagoon cut off by the dunes, is a park; the harbour's long
// moles carry the port's cranes out to a lighthouse on each head.

const ROWS = { u0: 128, uMax: 1420, depth: () => 62, w: (k) => (k % 3 === 1 ? 18 : 12) };
const COLS = { avenueW: 48, vMax: 1250, length: () => 96, w: (j) => (j % 3 === 2 ? 16 : 12) };
const MERE = { u: 735, v: -690 };

function inside(u, v) {
  if (u < 100 || u > 1440 || Math.abs(v) > 1250) return false;
  return true;
}

export function layout(c) {
  const L = gridLayout(c, SPEC);
  if (!L.named) {
    L.named = true;
    // rows of the civic places (the rows whose streets lie nearest the planned u)
    const near = (u) => L.rows.reduce((best, r, i) => (Math.abs(r.u - u) < Math.abs(L.rows[best].u - u) ? i : best), 0);
    L.iTwin = near(394); L.iEx = near(622); L.iCom = near(1001);
  }
  return L;
}
export function reserve(c) { return gridReserve(layout(c)); }

const hash = (i, j) => { let h = (i * 73856093) ^ (j * 19349663); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

const SPEC = {
  rows: ROWS, cols: COLS, inside, gateU: 1520, civicMin: 0.6, lowOk: (id) => id.startsWith('mere'), grade: 0.06, maxSlope: 14, civicSlope: 12, maxFill: 9,
  front: { depth: 80, rise: 7 },
  sheds: { len: 66, gap: 16 },
  harbour: { span: 470, mouth: 540, width: 64, moleW: 20, lightH: 46, mouthHalf: 70 },
  avenue: { mall: 10, sides: [1.2, 4.2], tree: SP.araucaria, treeS: [11, 4], lampH: 7, gap: 12 },
  gardenTree: SP.flowering, slopeTree: SP.rainTree,
  plotWidth: (r, b) => 16 + r() * 12,
  civic(L, i, j, quad, { va, vb, g }) {
    const [u, v] = L.UV(...centroid(quad)), jA = L.jAve;
    if ((j === jA - 1 || j === jA) && (i === L.iTwin || i === L.iTwin + 1)) return j < jA ? 'twin-w' : 'twin-e';
    if ((j === jA - 1 || j === jA) && (i === L.iEx || i === L.iEx + 1)) return 'exchange';
    if (j >= jA - 2 && j <= jA + 1 && (i === L.iCom || i === L.iCom + 1)) return 'commons';
    if (Math.hypot((u - MERE.u) * 1.25, v - MERE.v) < 330) return `mere:${i}:${j}`;
    // the business district: towers in their own courts, most of them near the Way
    const dv = Math.abs(v), du = u - L.rows[L.iTwin].u;
    if (dv < 700 && u > 280 && u < 1100 && g.max - g.min < 8 && Math.min(vb - va, 62) >= 58) {
      const p = 0.85 * (1 - dv / 800) * (1 - Math.max(0, du) / 1100);
      if (hash(i + 7, j + 3) < p) return `tower:${i}:${j}`;
    }
    return null;
  },
  house: portHouse,
  place: civicPlace,
  extras,
  reserveExtra: (L) => [...wayReserve(L, L.gate.u, OBS.u1 + 40, 34), { ...Object.fromEntries(['x', 'z'].map((k, i) => [k, L.P((OBS.u0 + OBS.u1) / 2, 0)[i]])), r: 110 }],
};
// the Navigators' Observatory on the ridge at the head of the Harbour Way
const OBS = { u0: 2390, u1: 2530, hw: 66 };

// ------------------------------------------------------------------------------ build
export function build(ctx) {
  const L = layout(ctx.c);
  L.towers = [];
  buildGridCity(ctx, L, SPEC);
}

// ---------------------------------------------------------------------------- houses
/**
 * A house of the port's perimeter blocks: the full width of its plot at the street, four to
 * seven storeys of punched stone (glass near the towers), an arcade on the main streets, an
 * attic storey set back behind a roof terrace, a turret and cupola on the block's corners.
 */
function portHouse(kit, p, rnd, L, need) {
  const M = plotMap(p.corners || p.q), W = p.width, D = p.depth, y = p.top;
  const [u, v] = L.UV(...centroid(p.q)), dv = Math.abs(v);
  const central = dv < 650 && u < 1050;
  const main = L.rows[p.row]?.main;
  const floors = Math.max(3, Math.round(4 + rnd() * 2.2 + (central ? 2 : 0) + (main ? 1 : 0) - Math.max(0, dv - 700) / 250));
  const fr = Math.max(need, (p.frontSag || 0) + 0.6, 0.6 + rnd() * 0.8), depth = Math.min(D - 5, 14 + rnd() * 6);
  const tA = fr / D, tB = (fr + depth) / D;
  if (tB - tA < 9 / D || W < 8) return;
  const glass = central && rnd() < 0.35;
  const wall = glass ? K.GLASS : K.PUNCHED;
  const roof = () => { const r = rnd(); return r < 0.45 ? K.GARDEN : r < 0.62 ? K.PV : K.PAVING; };
  const box = (q, y0, y1, o = {}) => kit.at(...centroid(q), o.tier ?? 3).prism(q, y0, y1, { wall, top: K.PAVING, vBase: y, ...o, meta: { supported: true, role: 'house', ...o.meta } });
  const Q = (s0, s1, t0, t1) => [M(s0, t0), M(s1, t0), M(s1, t1), M(s0, t1)];
  const h = y + FH * floors + 0.5;
  if (main && W >= 14 && depth > 12) {
    // arcade: the ground storey set back behind columns, the storeys above carried forward
    const rec = 4.2 / D;
    box(Q(0, 1, tA + rec, tB), y - 0.25, y + FH + 0.02, { top: K.STONE });
    box(Q(0, 1, tA, tB), y + FH, h, { top: roof(), meta: { role: 'house upper' } });
    const n = Math.max(3, Math.round(W / 3.8));
    for (let k = 0; k < n; k++) { const c = M((k + 0.5) / n, tA + 0.5 / D); kit.at(c[0], c[1], 1).column(c[0], c[1], y - 0.05, FH + 0.07, 0.34, { meta: { role: 'column', supported: true } }); }
  } else box(Q(0, 1, tA, tB), y - 0.25, h, { top: roof() });
  // the block's corner: a turret two storeys higher with a cupola, the full depth of the
  // house; the attic storey and the roof's parapet keep to the rest of the roof
  const b = p.block, corner = Math.abs(p.va - b.va) < 1e-6 ? 0 : Math.abs(p.vb - b.vb) < 1e-6 ? 1 : -1;
  const turret = corner >= 0 && W > 12 && !glass;
  const tw = turret ? Math.min(8, W * 0.45) / W : 0;
  const s0 = corner === 0 ? tw : 0, s1 = corner === 1 ? 1 - tw : 1;
  const q0 = Q(s0, s1, tA, tB);
  if (rnd() < 0.7 && depth > 12) {
    const t2 = tA + 3 / D;
    box(Q(s0 + (s0 ? 0 : 0.02), s1 - (s1 < 1 ? 0 : 0.02), t2, tB), h - 0.2, h + FH, { top: roof(), meta: { role: 'house attic' } });
    kit.at(...centroid(q0), 1).parapet(Q(s0, s1, tA, t2), h, 1.0, 0.3);
  } else kit.at(...centroid(q0), 1).parapet(q0, h, 1.0, 0.3);
  if (turret) {
    const td = Math.min(9, depth) / D;
    const tq = corner === 0 ? Q(0, tw, tA, tA + td) : Q(1 - tw, 1, tA, tA + td);
    const ht = h + FH * 2;
    box(tq, h - 0.2, ht, { wall: K.PUNCHED, top: K.STONE, meta: { role: 'corner turret' } });
    const c = centroid(tq), r = Math.min(tw * W, td * D) * 0.4;
    if (r > 1.5) kit.at(c[0], c[1], 2).dome(c[0], c[1], r, ht - 0.05, 1.2, r * 1.1, { seg: 12, meta: { role: 'cupola', supported: true } });
  }
  // a tree in the court behind
  const gd = (1 - tB) * D;
  if (gd > 6 && rnd() < 0.5) { const [x, z] = M(0.3 + rnd() * 0.4, tB + (1 - tB) * 0.55); kit.tree(x, y, z, rnd() < 0.5 ? SP.flowering : SP.rainTree, 7 + rnd() * 4, rnd); }
}

// ---------------------------------------------------------------------------- towers
/**
 * A business tower: glass shaft in three stages with stone bands at the setbacks, a lit
 * crown and a spire (one closed lathe per stage, each resting on the one below).
 */
export function officeTower(kit, x, z, y, Ht, R, rnd, { seg = 12, phase = 0 } = {}) {
  const stages = [[0, 0.52, 1], [0.52, 0.8, 0.84], [0.8, 1, 0.68]];
  let y0 = y;
  for (const [f0, f1, k] of stages) {
    const r = R * k, ya = y + Ht * f0, yb = y + Ht * f1;
    kit.at(x, z, 3).lathe(x, z, [[r, ya - 0.2, K.STONE], [r, ya + 1.2, K.STONE], [r * 0.97, ya + 1.2, K.GLASS], [r * 0.95, yb - 1.4, K.GLASS], [r * 1.02, yb - 1.4, K.STONE], [r * 1.02, yb, K.STONE], [0, yb, K.STONE]], seg, { meta: { role: 'tower', supported: true }, phase });
    y0 = yb;
  }
  const rc = R * 0.52;
  kit.at(x, z, 3).lathe(x, z, [[rc, y0 - 0.2, K.LANTERN], [rc, y0 + 7, K.LANTERN], [rc * 1.1, y0 + 7, K.STONE], [rc * 1.1, y0 + 8.2, K.STONE], [rc * 0.5, y0 + 8.2, K.METAL], [0.3, y0 + 8.2 + Ht * 0.07, K.METAL], [0, y0 + 8.4 + Ht * 0.07, K.METAL]], Math.max(8, seg - 4), { meta: { role: 'tower crown', supported: true }, phase });
  return y0 + 8.4 + Ht * 0.07;
}

/**
 * A slab tower: a chamfered block of glass with stone ends in three stages, each set back
 * from the one below, a lit lantern and a mast (w along the angle a, d across).
 */
function slabTower(kit, x, z, y, Ht, w, d, a) {
  const oct = (W, Dd) => { const c = Math.min(W, Dd) * 0.22, A = [Math.cos(a), Math.sin(a)], B = [-A[1], A[0]]; return [[-W / 2 + c, -Dd / 2], [W / 2 - c, -Dd / 2], [W / 2, -Dd / 2 + c], [W / 2, Dd / 2 - c], [W / 2 - c, Dd / 2], [-W / 2 + c, Dd / 2], [-W / 2, Dd / 2 - c], [-W / 2, -Dd / 2 + c]].map(([u, v]) => [x + A[0] * u + B[0] * v, z + A[1] * u + B[1] * v]); };
  const st = [[0, 0.6, 1, 1], [0.6, 0.85, 0.8, 0.86], [0.85, 1, 0.56, 0.72]];
  for (const [f0, f1, kw, kd] of st) {
    const q = oct(w * kw, d * kd), ya = y + Ht * f0, yb = y + Ht * f1;
    kit.at(x, z, 3).prism(q, ya - 0.2, yb, { wall: K.GLASS, top: K.STONE, vBase: y, meta: { role: 'slab tower', supported: true } });
    kit.at(x, z, 2).parapet(q, yb, 1.4, 0.5, { kind: K.STONE });
  }
  const top = y + Ht, lq = oct(w * 0.3, d * 0.4);
  kit.at(x, z, 3).prism(lq, top - 0.2, top + 9, { wall: K.LANTERN, top: K.METAL, meta: { role: 'tower lantern', supported: true } });
  kit.at(x, z, 3).lathe(x, z, [[1.4, top + 8.9, K.METAL], [0.25, top + 9 + Ht * 0.08, K.METAL], [0, top + 9.2 + Ht * 0.08, K.METAL]], 8, { meta: { role: 'mast', supported: true } });
}

/** A fluted tower: twelve soft lobes of glass in two stages, a crown of stone fins. */
function flutedTower(kit, x, z, y, Ht, R) {
  const N = 48, sec = (r, yy, kind, amp = 0.09) => ({ y: yy, kind, pts: Array.from({ length: N }, (_, i) => { const t = (i / N) * TAU, rr = r * (1 + amp * Math.cos(12 * t)); return [x + Math.cos(t) * rr, z + Math.sin(t) * rr]; }) });
  const stages = [[0, 0.7, 1, 0.86], [0.7, 1, 0.8, 0.6]];
  for (const [f0, f1, k0, k1] of stages) {
    const ya = y + Ht * f0, yb = y + Ht * f1, secs = [sec(R * k0 * 1.04, ya - 0.2, K.STONE, 0), sec(R * k0 * 1.04, ya + 1.6, K.STONE, 0)];
    for (let q = 0; q <= 4; q++) { const t = q / 4; secs.push(sec(R * (k0 + (k1 - k0) * t), ya + 1.6 + (yb - ya - 1.6) * t, K.GLASS)); }
    kit.at(x, z, 3).loft(secs, { kindTop: K.STONE, meta: { role: 'fluted tower', supported: true } });
  }
  const top = y + Ht, rc = R * 0.6;
  kit.at(x, z, 3).lathe(x, z, [[rc, top - 0.2, K.LANTERN], [rc * 0.9, top + 10, K.LANTERN], [rc * 0.5, top + 16, K.STONE], [0.3, top + 16 + Ht * 0.06, K.METAL], [0, top + 16.2 + Ht * 0.06, K.METAL]], 12, { meta: { role: 'tower crown', supported: true } });
}

/**
 * A Harbour Gate tower: a fluted glass shaft of eight lobes in five stages narrowing to a
 * lantern and a mast, each stage a closed loft on the one below.
 */
function gateTower(kit, x, z, y, Ht, R) {
  const N = 64, stages = [[0, 0.3, 1, 0.94], [0.3, 0.55, 0.9, 0.84], [0.55, 0.75, 0.8, 0.74], [0.75, 0.9, 0.69, 0.63], [0.9, 1, 0.57, 0.5]];
  const sec = (r, yy, kind) => ({ y: yy, kind, pts: Array.from({ length: N }, (_, i) => { const t = (i / N) * TAU; const rr = r * (1 + 0.07 * Math.cos(8 * t)); return [x + Math.cos(t) * rr, z + Math.sin(t) * rr]; }) });
  const out = [];
  for (const [f0, f1, k0, k1] of stages) {
    const ya = y + Ht * f0, yb = y + Ht * f1, secs = [];
    secs.push(sec(R * k0 * 1.03, ya - 0.2, K.STONE), sec(R * k0 * 1.03, ya + 2.2, K.STONE));
    for (let q = 0; q <= 6; q++) { const t = q / 6; secs.push(sec(R * (k0 + (k1 - k0) * t), ya + 2.2 + (yb - ya - 2.2) * t, K.GLASS)); }
    kit.at(x, z, 3).loft(secs, { kindTop: K.STONE, meta: { role: 'gate tower', supported: true } });
    out.push({ y: yb, r: R * k1 });
  }
  const top = y + Ht, rc = R * 0.42;
  kit.at(x, z, 3).lathe(x, z, [[rc, top - 0.2, K.LANTERN], [rc, top + 14, K.LANTERN], [rc * 1.15, top + 14, K.STONE], [rc * 1.15, top + 16, K.STONE], [rc * 0.6, top + 16, K.METAL], [0.5, top + 16 + Ht * 0.11, K.METAL], [0, top + 16.5 + Ht * 0.11, K.METAL]], 16, { meta: { role: 'gate tower crown', supported: true } });
  return out;
}

// ----------------------------------------------------------------------- civic places
function civicPlace(kit, L, g, ctx) {
  const kind = g.id.split(':')[0], { P } = L;
  const lo = new Occupancy(16);
  const fits = (q, pad = 0.4) => q.every((p) => pointInPoly(g.poly, ...p)) && lo.free(q, pad);
  const take = (q) => lo.add(q, 'x');
  const uLo = Math.max(g.uAt(g.va, 0), g.uAt(g.vb, 0)), uHi = Math.min(g.uAt(g.va, 1), g.uAt(g.vb, 1));
  // the place's centre in the frame (its outline carries the street sections of both sides,
  // unevenly spaced, so the average of its vertices is not its middle)
  const uc = (uLo + uHi) / 2, vc = (g.va + g.vb) / 2, cen = P(uc, vc);
  const box = (u0, u1, v0, v1) => [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
  const trees = (list, y, sp, s) => { for (const [u, v] of list) { const q = box(u - 1.5, u + 1.5, v - 1.5, v + 1.5); if (fits(q, 1)) { const [x, z] = P(u, v); kit.tree(x, y, z, sp, s[0] + ctx.rnd() * s[1], ctx.rnd, { lean: 0 }); take(q); } } };
  ctx.place(g.poly, 'civic');
  if (kind === 'twin-w' || kind === 'twin-e') {
    const y = civicPlaza(kit, g, 'harbour gate court');
    const R = 34, Ht = 560, [x, z] = cen;
    // the colonnaded court round the tower's foot: columns and their ring beam
    const Rc = R + 7.5, nC = 28;
    for (let k = 0; k < nC; k++) { const a = (k / nC) * TAU; kit.at(x, z, 1).column(x + Math.cos(a) * Rc, z + Math.sin(a) * Rc, y, 11, 0.7, { meta: { role: 'column', supported: true } }); }
    kit.at(x, z, 3).lathe(x, z, [[Rc - 1.6, y + 10.98, K.STONE], [Rc + 1.6, y + 10.98, K.STONE], [Rc + 1.6, y + 12.6, K.STONE], [Rc - 1.6, y + 12.6, K.STONE]], 48, { closedProfile: true, meta: { role: 'court ring beam', supported: true } });
    take(circlePoly(x, z, Rc + 2, 24));
    const st = gateTower(kit, x, z, y, Ht, R);
    L.towers.push({ id: kind, x, z, y, Ht, st, R });
    ctx.signals?.push({ x, y: y + Ht + 16 + Ht * 0.11, z, c: [1.0, 0.25, 0.15], s: 3.2 }, { x, y: y + Ht + 7, z, c: [0.9, 0.95, 1.0], s: 3.4 });
    fountainPair(kit, L, g, y, lo, fits, take);
    trees([[uLo + 8, g.va + 8], [uLo + 8, g.vb - 8], [uHi - 8, g.va + 8], [uHi - 8, g.vb - 8]], y, SP.palm, [9, 3]);
  } else if (kind === 'exchange') {
    const y = civicPlaza(kit, g, 'exchange square');
    // the Exchange: a long hall across the inland side of the square, its portico to the sea,
    // a drum and dome at its centre; the square before it with fountains and tree rows
    const hd = 30, hw = Math.min(150, (g.vb - g.va) - 40), u1 = uHi - 6, u0 = u1 - hd;
    const hq = box(u0, u1, -hw / 2, hw / 2);
    if (fits(hq)) {
      kit.at(...centroid(hq), 3).prism(hq, y - 0.2, y + 18, { wall: K.PUNCHED, top: K.STONE, vBase: y, meta: { role: 'exchange hall', supported: true } });
      const [dx, dz] = P((u0 + u1) / 2, 0);
      kit.at(dx, dz, 3).dome(dx, dz, 13, y + 17.9, 6, 12, { seg: 32, meta: { role: 'exchange dome', supported: true } });
      colonnade(kit, frameOf(P(u0 - 7, -hw / 2 + 2), L.ang + Math.PI / 2), 0, hw - 4, 0, y, 14, { n: 16, r: 0.85 });
      const rq = box(u0 - 8, u0 + 0.02, -hw / 2 + 0.5, hw / 2 - 0.5);
      kit.at(...centroid(rq), 3).prism(rq, y + 14.98, y + 16.2, { wall: K.STONE, top: K.STONE, meta: { role: 'portico roof', supported: true, attached: true } });
      take(box(u0 - 9, u1, -hw / 2, hw / 2));
    }
    for (const dv of [-45, 45]) { const [fx, fz] = P((uLo + u0) / 2, dv), fq = circlePoly(fx, fz, 8, 16); if (fits(fq)) { fountain(kit, fx, fz, y, 7.5); take(fq); } }
    const [ox, oz] = P((uLo + u0) / 2, 0), oq = circlePoly(ox, oz, 4, 8);
    if (fits(oq)) { obelisk(kit, ox, oz, y, 26, 1.8, { tier: 3 }); take(oq); }
    const rowsT = []; for (let u = uLo + 8; u < u0 - 12; u += 12) for (const v of [g.va + 8, g.vb - 8]) rowsT.push([u, v]);
    trees(rowsT, y, SP.araucaria, [10, 3]);
  } else if (kind === 'commons') {
    const y = civicPlaza(kit, g, 'the commons', { top: K.GARDEN });
    // the park: a round pool with a pavilion on its island, walks, groves
    const [px, pz] = P((uLo + uHi) / 2, 0), pr = Math.min(38, (uHi - uLo) / 2 - 14);
    if (pr > 12 && fits(circlePoly(px, pz, pr + 2, 32))) {
      kit.at(px, pz, 2).lathe(px, pz, [[pr, y - 0.1, K.STONE], [pr, y + 0.6, K.STONE], [pr - 0.8, y + 0.6, K.STONE], [pr - 0.8, y + 0.3, K.POOL], [0, y + 0.3, K.POOL]], 40, { meta: { role: 'commons pool', supported: true } });
      tholos(kit, px, pz, y + 0.28, 7, { cols: 10, colH: 8, tier: 3, gilt: false });
      take(circlePoly(px, pz, pr + 2, 32));
    }
    const list = [];
    for (let u = uLo + 10; u < uHi - 8; u += 14) for (let v = g.va + 10; v < g.vb - 8; v += 16) list.push([u + (ctx.rnd() - 0.5) * 6, v + (ctx.rnd() - 0.5) * 6]);
    trees(list, y, SP.rainTree, [10, 5]);
  } else if (kind === 'mere') {
    const y = civicPlaza(kit, g, 'mere park', { top: K.GARDEN });
    const list = [];
    for (let u = uLo + 8; u < uHi - 6; u += 13) for (let v = g.va + 8; v < g.vb - 6; v += 15) list.push([u + (ctx.rnd() - 0.5) * 7, v + (ctx.rnd() - 0.5) * 7]);
    trees(list, y, ctx.rnd() < 0.5 ? SP.rainTree : SP.flowering, [9, 4]);
  } else if (kind === 'tower') {
    const y = civicPlaza(kit, g, 'tower court');
    const du = uc - L.rows[L.iTwin].u, dv = Math.abs(vc);
    const w = Math.min(g.vb - g.va, uHi - uLo);
    // (a fluted shaft's lobes stand 9 % proud of R: the widest keeps 9 m inside the court)
    const R = Math.min(24, (w / 2 - 9) / 1.09);
    if (R < 12) return;
    // a podium of two storeys under the tower, the court round it
    const pq = offsetConvex(g.poly, -6);
    const ph = y + FH * 2 + 0.6;
    kit.at(...cen, 3).prism(pq, y - 0.2, ph, { wall: K.GLASS, top: K.GARDEN, vBase: y, meta: { role: 'tower podium', supported: true } });
    kit.at(...cen, 1).parapet(pq, ph, 1.0, 0.3);
    const Ht = Math.max(120, (480 - dv * 0.36 - Math.max(0, du) * 0.25) * (0.72 + 0.56 * hash(g.i0 * 3 + 1, g.j0 * 5 + 2)));
    const type = hash(g.j0 * 3 + 7, g.i0 * 11 + 5);
    if (type < 0.34) slabTower(kit, cen[0], cen[1], ph, Ht * 0.8, Math.min(g.vb - g.va, uHi - uLo) - 30, R * 1.3, L.ang + Math.PI / 2);
    else if (type < 0.6) flutedTower(kit, cen[0], cen[1], ph, Ht, R);
    else officeTower(kit, cen[0], cen[1], ph, Ht, R, ctx.rnd, { seg: 12, phase: L.ang });
    if (Ht > 250) ctx.signals?.push({ x: cen[0], y: ph + Ht * 1.08, z: cen[1], c: [1.0, 0.25, 0.15], s: 2.2 });
  }
}

/** Two fountains either side of a court's axis. */
function fountainPair(kit, L, g, y, lo, fits, take) {
  const um = (Math.max(g.uAt(g.va, 0), g.uAt(g.vb, 0)) + 12);
  for (const v of [g.va + 14, g.vb - 14]) { const [fx, fz] = L.P(um, v), fq = circlePoly(fx, fz, 5.5, 12); if (fits(fq)) { fountain(kit, fx, fz, y, 5); take(fq); } }
}

// --------------------------------------------------------------------------- extras
function extras(kit, L, ctx) {
  skyArch(kit, L);
  cranes(kit, L, ctx);
  observatory(kit, L, ctx);
}

/**
 * The Navigators' Observatory: the Harbour Way climbs on beyond the Land Gate as a planted
 * way to a terrace on the ridge, the vista's end seen from the harbour: the great dome of the
 * observatory on its drum, the academy's two colonnaded ranges either side of the court, and a
 * gilt meridian obelisk on the axis at the head of the way.
 */
function observatory(kit, L, ctx) {
  const { P } = L, { u0, u1, hw } = OBS;
  const q = [P(u0, -hw), P(u1, -hw), P(u1, hw), P(u0, hw)], g = groundRange(q, 4);
  if (g.max - g.min > 26) return;
  const top = g.max + 0.4;
  kit.at(...centroid(q), 3).prism(q, g.min - 1.5, top, { top: K.PAVING, meta: { role: 'observatory terrace' } });
  ctx.place(q, 'civic', hw * 1.45);
  // the parapet round the terrace, open where the way arrives on the axis
  kit.at(...centroid(q), 1).parapetOpen(P, u0, u1, -hw, hw, -9.5, 9.5, top, 1.0, 0.5);
  processional(kit, L, ctx.rnd, ctx.place, { u0: L.gate.u + 22, y0: L.gate.top, u1: u0, yEnd: top, hw: 9 });
  // the courses of the retaining wall where it stands high (the front's stop short of the way)
  for (let yy = Math.ceil((g.min + 3) / 6) * 6; yy < top - 2; yy += 6) {
    for (const [a, b] of [[[u0, -hw], [u1, -hw]], [[u1, -hw], [u1, hw]], [[u1, hw], [u0, hw]], [[u0, hw], [u0, 10]], [[u0, -10], [u0, -hw]]]) {
      const pa = P(...a), pb = P(...b), m = lerp2(pa, pb, 0.5), cc = P((u0 + u1) / 2, 0);
      const dx = pb[0] - pa[0], dz = pb[1] - pa[1], len = Math.hypot(dx, dz); let n = [dz / len, -dx / len];
      if ((m[0] - cc[0]) * n[0] + (m[1] - cc[1]) * n[1] < 0) n = [-n[0], -n[1]];
      const band = [pa, pb, [pb[0] + n[0] * 0.5, pb[1] + n[1] * 0.5], [pa[0] + n[0] * 0.5, pa[1] + n[1] * 0.5]];
      if (groundRange(band, 6).max > yy - 0.1) continue;
      kit.at(m[0], m[1], 2).prism(band, yy, yy + 0.6, { wall: K.STONE, top: K.STONE, meta: { role: 'wall course', supported: true, attached: true } });
    }
  }
  // the dome
  const [dx, dz] = P(u1 - 42, 0);
  kit.at(dx, dz, 3).prism(circlePoly(dx, dz, 24, 32), top - 0.2, top + 1.4, { wall: K.STONE, top: K.PAVING, meta: { role: 'observatory base', supported: true } });
  kit.at(dx, dz, 3).dome(dx, dz, 19, top + 1.35, 14, 17, { seg: 40, meta: { role: 'observatory dome', supported: true } });
  // the academy ranges either side of the court, facing the axis
  const F = (O, a) => frameOf(O, a);
  stoa(kit, F(P(u0 + 22, -hw + 4), L.ang), u1 - u0 - 92, 13, top, 9);
  stoa(kit, F(P(u1 - 70, hw - 4), L.ang + Math.PI), u1 - u0 - 92, 13, top, 9);
  // the meridian obelisk at the head of the way
  const [ox, oz] = P(u0 + 20, 0);
  kit.at(ox, oz, 3).prism(circlePoly(ox, oz, 4.5, 16), top - 0.1, top + 1.2, { wall: K.STONE, top: K.STONE, meta: { role: 'obelisk base', supported: true } });
  kit.at(ox, oz, 3, 'gilt').lathe(ox, oz, [[1.6, top + 1.15, K.GLASS], [1.0, top + 30, K.GLASS], [0, top + 33, K.LANTERN]], 4, { meta: { role: 'meridian obelisk', supported: true }, phase: L.ang + Math.PI / 4 });
  for (const v of [-hw + 22, hw - 22]) for (let u = u0 + 12; u < u1 - 72; u += 16) { const [x, z] = P(u, v); kit.tree(x, top, z, SP.araucaria, 9 + ctx.rnd() * 3, ctx.rnd, { lean: 0 }); }
}

/** The sky arch between the Harbour Gate towers: a curved truss tube and a walkway tube. */
function skyArch(kit, L) {
  const [A, B] = ['twin-w', 'twin-e'].map((id) => L.towers.find((t) => t.id === id));
  if (!A || !B) return;
  const yA = A.y + A.Ht * 0.84, yB = B.y + B.Ht * 0.84;
  const dx = B.x - A.x, dz = B.z - A.z, D = Math.hypot(dx, dz), e = [dx / D, dz / D];
  // the arch leaves each tower from inside its shaft (the ends are buried in the glass)
  const r0 = A.R * 0.6, pts = [];
  for (let k = 0; k <= 24; k++) { const t = k / 24, s = r0 + (D - 2 * r0) * t; pts.push([A.x + e[0] * s, yA + (yB - yA) * t + 42 * Math.sin(Math.PI * t), A.z + e[1] * s]); }
  kit.at((A.x + B.x) / 2, (A.z + B.z) / 2, 3).tube(pts, 5.5, 12, { kind: K.GLASS, meta: { role: 'sky arch', supported: true, attached: true, joint: true } });
  const walk = []; for (let k = 0; k <= 12; k++) { const t = k / 12, s = r0 + (D - 2 * r0) * t; walk.push([A.x + e[0] * s, yA - 26, A.z + e[1] * s]); }
  kit.at((A.x + B.x) / 2, (A.z + B.z) / 2, 3).tube(walk, 3.2, 8, { kind: K.LANTERN, meta: { role: 'sky bridge', supported: true, attached: true, joint: true } });
}

/** Gantry cranes along the moles, their jibs over the water. */
function cranes(kit, L, ctx) {
  const hb = L.hb;
  for (const m of hb.moles) {
    const P = m.path, cum = [0];
    for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
    const total = cum.at(-1);
    for (let s = 90; s < total - 70; s += 58) {
      let k = 1; while (k < P.length - 1 && cum[k] < s) k++;
      const t = (s - cum[k - 1]) / (cum[k] - cum[k - 1]), p = lerp2(P[k - 1], P[k], t), d = [(P[k][0] - P[k - 1][0]) / (cum[k] - cum[k - 1]), (P[k][1] - P[k - 1][1]) / (cum[k] - cum[k - 1])];
      // the jib reaches over the harbour side (toward the axis mouth: inside the basin)
      const nrm = [-d[1], d[0]], toAxis = (L.A0[0] - p[0]) * nrm[0] + (L.A0[1] - p[1]) * nrm[1] > 0 ? 1 : -1, n = [nrm[0] * toAxis, nrm[1] * toAxis];
      gantry(kit, p, d, n, m.top);
    }
  }
}
function gantry(kit, p, d, n, y) {
  const ang = Math.atan2(d[1], d[0]), W = 14, G = 12, Hh = 34;
  const at = (a, b) => [p[0] + d[0] * a + n[0] * b, p[1] + d[1] * a + n[1] * b];
  // four legs on the mole's deck, a portal beam each side, the machinery house, the jib
  for (const a of [-G / 2, G / 2]) for (const b of [-W / 2, W / 2]) { const c = at(a, b); kit.at(c[0], c[1], 2).prism(rect(c[0], c[1], 1.6, 1.6, ang), y - 0.02, y + Hh, { wall: K.METAL, top: K.METAL, meta: { role: 'crane leg', supported: true } }); }
  for (const a of [-G / 2, G / 2]) { const c = at(a, 0); kit.at(c[0], c[1], 2).prism(rect(c[0], c[1], 1.8, W + 1.6, ang), y + Hh - 0.02, y + Hh + 2.4, { wall: K.METAL, top: K.METAL, meta: { role: 'crane portal', supported: true } }); }
  const mh = at(0, -2);
  kit.at(mh[0], mh[1], 2).prism(rect(mh[0], mh[1], G + 1.8, 10, ang), y + Hh + 2.38, y + Hh + 7, { wall: K.METAL, top: K.METAL, meta: { role: 'crane house', supported: true } });
  // the jib over the water balanced by its counter-jib and counterweight over the mole
  const reach = W / 2 + 36, back = W / 2 + 30, j0 = at(0, -back), j1 = at(0, reach), jc = lerp2(j0, j1, 0.5);
  kit.at(jc[0], jc[1], 2).prism(rect(jc[0], jc[1], 2.4, reach + back, ang), y + Hh + 7 - 0.02, y + Hh + 9.2, { wall: K.METAL, top: K.METAL, meta: { role: 'crane jib', supported: true } });
  const cw = at(0, -back + 4);
  kit.at(cw[0], cw[1], 2).prism(rect(cw[0], cw[1], 5, 7, ang), y + Hh + 1.5, y + Hh + 7.02, { wall: K.METAL, top: K.METAL, meta: { role: 'crane counterweight', supported: true, attached: true } });
}
