import { K, TAU, H, rect, circlePoly, groundRange, lerp2, centroid, pointInPoly, offsetConvex, Occupancy } from './cityKit.js';
import { gridLayout, gridReserve, buildGridCity, civicPlaza, processional, wayReserve } from './gridCity.js';
import { colonnade, fountain, obelisk, exedra, tholos, frameOf } from './civic.js';
import { plotMap, FH } from './typology.js';
import { SP } from '../treeGeometry.js';

// ORISON - the eastern city of needle towers whose gold crowns catch the first light.
//
// The city lies on the lowland behind its harbour, the island's hills rising behind it to the
// east, so that at sunrise the streets are still in shadow while the needles' gilt crowns,
// four and five hundred metres up, take the first light over the ridge. Its axis, the Avenue
// of Dawn, runs due inland (east) from the Sea Gate to the Dawn Plaza: a round sundial of
// stone set in the city's heart, its gilt gnomon on the axis, its seats facing the sunrise.
// The needles stand round the plaza in a forest: the tallest nearest, each in its own court,
// falling away toward the edges of the city. Between them the town is of low bronze-roofed
// courtyard houses, their belvederes capped in gold.

const ROWS = { u0: 128, uMax: 1060, depth: () => 58, w: (k) => (k % 3 === 1 ? 16 : 11) };
const COLS = { avenueW: 40, vMax: 960, length: () => 86, w: (j) => (j % 3 === 2 ? 14 : 10) };

function inside(u, v) {
  if (u < 110 || u > 1080 || Math.abs(v) > 960) return false;
  return true;
}

export function layout(c) {
  const L = gridLayout(c, SPEC);
  if (!L.named) {
    L.named = true;
    const near = (u) => L.rows.reduce((best, r, i) => (Math.abs(r.u - u) < Math.abs(L.rows[best].u - u) ? i : best), 0);
    L.iDawn = near(440);
    // the plaza's centre: the middle of its three rows of blocks on the axis
    const r0 = L.rows[L.iDawn], r3 = L.rows[L.iDawn + 3];
    L.dawnU = ((r0.u + r0.w / 2) + (r3.u - r3.w / 2)) / 2;
  }
  return L;
}
export function reserve(c) { return gridReserve(layout(c)); }

const hash = (i, j) => { let h = (i * 73856093) ^ (j * 19349663); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

const SPEC = {
  rows: ROWS, cols: COLS, inside, gateU: 1150, civicMin: 0.6, lowOk: (id) => id.startsWith('mirror'), grade: 0.07, maxSlope: 15, civicSlope: 12, maxFill: 9,
  harbour: { span: 400, mouth: 340, width: 56, moleW: 16, lightH: 40, mouthHalf: 48 },
  front: { depth: 60, rise: 6.5 },
  avenue: { mall: 8, sides: [1.2, 3.8], tree: SP.araucaria, treeS: [12, 4], lampH: 6.5, gap: 11 },
  gardenTree: SP.flowering, slopeTree: SP.rainTree, terraceTree: SP.flowering,
  plotWidth: (r) => 14 + r() * 8,
  civic(L, i, j, quad, { g }) {
    const [u, v] = L.UV(...centroid(quad)), jA = L.jAve;
    if ((j === jA - 1 || j === jA) && i >= L.iDawn && i <= L.iDawn + 2) return 'dawn';
    // the dry hollow beside the plaza: the Mirror Garden, a long pool reflecting the needles
    if (g.min < 2.4) return u > 380 && u < 820 && Math.abs(v) < 420 ? 'mirror' : null;
    // the needle forest: courts round the plaza, thinning toward the edges of the city
    const d = Math.hypot(u - L.dawnU, v);
    if (d > 150 && d < 660 && g.max - g.min < 7) {
      const p = (d < 270 ? 0.62 : 0.34 * (1 - (d - 270) / 420)) * (u < 260 ? 0.3 : 1);
      if (hash(i + 11, j + 5) < p) return `needle:${i}:${j}`;
    }
    if (d > 300 && hash(j + 29, i + 13) < 0.08) return `garden:${i}:${j}`;
    return null;
  },
  house: orisonHouse,
  place: civicPlace,
  extras,
  reserveExtra: (L) => [...wayReserve(L, L.gate.u, MATINS.u1 + 30, 30), { ...Object.fromEntries(['x', 'z'].map((k, i) => [k, L.P((MATINS.u0 + MATINS.u1) / 2, (MATINS.v0 + MATINS.v1) / 2)[i]])), r: 90 }],
};
// the Matins Terrace on the crest east of the city, where the city watches the sunrise
const MATINS = { u0: 1840, u1: 1932, v0: -92, v1: 30 };

export function build(ctx) {
  const L = layout(ctx.c);
  buildGridCity(ctx, L, SPEC);
}

// ---------------------------------------------------------------------------- houses
/**
 * A courtyard house of the low town: a range of two or three storeys at the street under a
 * hipped ceramic roof, a back range across a court with its tree, and on many a belvedere
 * tower capped in gold.
 */
function orisonHouse(kit, p, rnd, L, need) {
  const M = plotMap(p.corners || p.q), W = p.width, D = p.depth, y = p.top;
  const Q = (s0, s1, t0, t1) => [M(s0, t0), M(s1, t0), M(s1, t1), M(s0, t1)];
  const fr = Math.max(need, (p.frontSag || 0) + 0.6, 0.8 + rnd() * 1.4), side = 0.6 + rnd() * 0.8;
  const sA = side / W, sB = 1 - side / W, tA = fr / D;
  if ((sB - sA) * W < 8) return;
  const floors = 2 + (rnd() < 0.45 ? 1 : 0) + (L.rows[p.row]?.main ? 1 : 0);
  const d1 = Math.min(10 + rnd() * 2, D - fr - 4), tB = tA + d1 / D;
  if (d1 < 7) return;
  const frontDir = [(p.corners[1][0] - p.corners[0][0]) / W, (p.corners[1][1] - p.corners[0][1]) / W], ang = Math.atan2(frontDir[1], frontDir[0]);
  const range = (s0, s1, t0, t1, fl, role) => {
    const q = Q(s0, s1, t0, t1), c = centroid(q), h = y + FH * fl + 0.4;
    kit.at(c[0], c[1], 3).prism(q, y - 0.25, h, { wall: K.PUNCHED, top: K.STONE, vBase: y, meta: { role, supported: true } });
    const w = (s1 - s0) * W, d = (t1 - t0) * D;
    kit.at(c[0], c[1], 3).hip(c[0], c[1], w, d + 0.8, ang, h - 0.02, Math.min(w, d) * 0.28, { roof: K.CERAMIC, meta: { role: 'roof', supported: true } });
    return { q, h, c };
  };
  // a belvedere tower at one end of the front range, the range's full depth, capped in gold
  const bel = rnd() < 0.42 && (sB - sA) * W > 13, left = rnd() < 0.5, tw = 4.4 / W;
  const ra = bel && left ? sA + tw : sA, rb = bel && !left ? sB - tw : sB;
  const front = range(ra, rb, tA, tB, floors, 'house');
  if (bel) {
    const s0 = left ? sA : sB - tw, tq = Q(s0, s0 + tw, tA, tB), c = centroid(tq), ht = front.h + FH * 1.6;
    kit.at(c[0], c[1], 3).prism(tq, y - 0.25, ht, { wall: K.PUNCHED, top: K.STONE, vBase: y, meta: { role: 'belvedere', supported: true } });
    kit.at(c[0], c[1], 2, 'gilt').hip(c[0], c[1], tw * W + 0.6, d1 + 0.6, ang, ht - 0.02, 3.2, { roof: K.GLASS, meta: { role: 'gilt cap', supported: true } });
  }
  // the back range across the court
  const gap = 5 + rnd() * 3, tC = tB + gap / D, d2 = 7 + rnd() * 2;
  if (tC + d2 / D < 1 - 1.2 / D) {
    range(sA, sB, tC, tC + d2 / D, Math.max(1, floors - 1), 'house back');
    const [x, z] = M(0.5, (tB + tC) / 2);
    if (rnd() < 0.7) kit.tree(x, y, z, rnd() < 0.5 ? SP.flowering : SP.palm, 5 + rnd() * 3, rnd);
  } else if (rnd() < 0.6) { const [x, z] = M(0.5, Math.min(0.92, tB + (1 - tB) * 0.5)); kit.tree(x, y, z, SP.araucaria, 8 + rnd() * 4, rnd, { lean: 0 }); }
}

// ---------------------------------------------------------------------------- needles
/**
 * A needle: a round podium drum, the shaft of bronze glass tapering on a gentle curve with
 * stone rings, and the gilt crown, a swelling bud of gold glass with a lit band, and its mast.
 */
export function needle(kit, x, z, y, Ht, R, { seg = 10, phase = 0 } = {}) {
  const Rp = R * 1.55, yp = y + 11;
  kit.at(x, z, 3).lathe(x, z, [[Rp, y - 0.25, K.STONE], [Rp, y + 1.2, K.STONE], [Rp * 0.97, y + 1.2, K.PUNCHED], [Rp * 0.97, yp - 0.8, K.PUNCHED], [Rp * 1.02, yp - 0.8, K.STONE], [Rp * 1.02, yp, K.STONE], [0, yp, K.PAVING]], Math.max(12, seg + 4), { meta: { role: 'needle podium', supported: true }, phase });
  const prof = [], n = 7, top = yp + Ht * 0.84;
  const rAt = (t) => R * (1 - 0.74 * Math.pow(t, 1.5));
  prof.push([rAt(0) * 1.04, yp - 0.2, K.STONE], [rAt(0) * 1.04, yp + 2, K.STONE]);
  for (let k = 0; k <= n; k++) { const t = k / n; prof.push([rAt(t), yp + 2 + (top - yp - 2) * t, K.GLASS]); }
  prof.push([0, top, K.STONE]);
  kit.at(x, z, 3).lathe(x, z, prof, seg, { meta: { role: 'needle', supported: true }, phase });
  // the crown
  // the crown: a gilt bud swelling from the shaft's head, a lit calyx band, a gilt finial
  const rc = rAt(1), ch = Ht * 0.15;
  kit.at(x, z, 3, 'gilt').lathe(x, z, [[rc * 0.98, top - 0.25, K.GLASS], [rc * 1.7, top + ch * 0.16, K.GLASS], [rc * 1.95, top + ch * 0.3, K.GLASS], [rc * 1.95, top + ch * 0.36, K.LANTERN], [rc * 1.7, top + ch * 0.44, K.LANTERN], [rc * 1.25, top + ch * 0.62, K.GLASS], [rc * 0.6, top + ch * 0.84, K.GLASS], [0.4, top + ch, K.GLASS], [0, top + ch + Ht * 0.07, K.GLASS]], Math.max(12, seg + 2), { meta: { role: 'needle crown', supported: true }, phase });
  return top + ch + Ht * 0.07;
}

// ----------------------------------------------------------------------- civic places
function civicPlace(kit, L, g, ctx) {
  const kind = g.id.split(':')[0], { P } = L, rnd = ctx.rnd;
  const lo = new Occupancy(16);
  const fits = (q, pad = 0.4) => q.every((p) => pointInPoly(g.poly, ...p)) && lo.free(q, pad);
  const take = (q) => lo.add(q, 'x');
  const uLo = Math.max(g.uAt(g.va, 0), g.uAt(g.vb, 0)), uHi = Math.min(g.uAt(g.va, 1), g.uAt(g.vb, 1));
  // the place's centre in the frame (not the average of its unevenly spaced outline vertices)
  const uc = (uLo + uHi) / 2, vc = (g.va + g.vb) / 2, cen = P(uc, vc);
  const box = (u0, u1, v0, v1) => [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
  const trees = (list, y, sp, s) => { for (const [u, v] of list) { const q = box(u - 1.5, u + 1.5, v - 1.5, v + 1.5); if (fits(q, 1)) { const [x, z] = P(u, v); kit.tree(x, y, z, sp, s[0] + rnd() * s[1], rnd, { lean: 0 }); take(q); } } };
  ctx.place(g.poly, 'civic');
  if (kind === 'dawn') {
    const y = civicPlaza(kit, g, 'dawn plaza');
    dawnPlaza(kit, L, g, y, { fits, take, uLo, uHi, box, trees, rnd });
  } else if (kind === 'needle') {
    const y = civicPlaza(kit, g, 'needle court', { top: K.GARDEN });
    const d = Math.hypot(uc - L.dawnU, vc);
    const w = Math.min(g.vb - g.va, uHi - uLo);
    const R = Math.min(15, (w / 2 - 6) / 1.55);
    if (R < 8) return;
    const Ht = Math.max(150, (600 - (d - 150) * 0.72) * (0.68 + 0.62 * hash(g.i0 * 5 + 3, g.j0 * 7 + 1)));
    const tip = needle(kit, cen[0], cen[1], y, Ht, R, { seg: 10, phase: L.ang + hash(g.i0, g.j0) });
    ctx.signals?.push({ x: cen[0], y: tip - Ht * 0.12, z: cen[1], c: [1.0, 0.78, 0.42], s: 2.4 });
    take(circlePoly(cen[0], cen[1], R * 1.55 + 1, 16));
    // the court's garden: a ring of cypresses
    const list = [];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + 0.39, rr = R * 1.55 + 7; list.push([uc + Math.cos(a) * rr, vc + Math.sin(a) * rr]); }
    trees(list, y, SP.araucaria, [9, 3]);
  } else if (kind === 'mirror') {
    const y = civicPlaza(kit, g, 'mirror garden', { top: K.GARDEN });
    // the long pool along the group, its coping of stone; cypresses in rows either side
    const pv0 = g.va + 14, pv1 = g.vb - 14, pu0 = uLo + 10, pu1 = uHi - 10;
    if (pv1 - pv0 > 8 && pu1 - pu0 > 30) {
      const pq = box(pu0, pu1, pv0, pv1);
      if (fits(pq)) {
        kit.at(...centroid(pq), 2).prism(pq, y - 0.05, y + 0.4, { wall: K.STONE, top: K.POOL, meta: { role: 'mirror pool', supported: true } });
        kit.at(...centroid(pq), 1).parapet(pq, y + 0.4, 0.35, 0.9, { meta: { role: 'pool coping', supported: true } });
        take(pq);
      }
    }
    const list = [];
    for (let u = uLo + 8; u < uHi - 6; u += 11) for (const v of [g.va + 7, g.vb - 7]) list.push([u, v]);
    trees(list, y, SP.araucaria, [11, 4]);
  } else if (kind === 'garden') {
    const y = civicPlaza(kit, g, 'garden square', { top: K.GARDEN });
    const [fx, fz] = cen, fq = circlePoly(fx, fz, 6, 12);
    if (fits(fq)) { fountain(kit, fx, fz, y, 5.5); take(fq); }
    const list = [];
    for (let u = uLo + 7; u < uHi - 5; u += 12) for (let v = g.va + 7; v < g.vb - 5; v += 13) list.push([u, v]);
    trees(list, y, SP.flowering, [6, 3]);
  }
}

/**
 * The Dawn Plaza: a round sundial of stone on the axis, its hour lines laid out from the gilt
 * gnomon at its centre, a semicircle of seats on its west side facing the sunrise, fountains
 * on the cross axis and a ring of trees on the square round it.
 */
function dawnPlaza(kit, L, g, y, { fits, take, uLo, uHi, box, trees, rnd }) {
  const { P } = L, uc = L.dawnU, [cx, cz] = P(uc, 0);
  const R = Math.min(72, (uHi - uLo) / 2 - 12);
  if (R < 30) return;
  // the dial: a disc raised two steps (flat round slabs, their paving in plan)
  kit.at(cx, cz, 3).prism(circlePoly(cx, cz, R + 1.6, 64), y - 0.1, y + 0.22, { wall: K.STONE, top: K.PAVING, meta: { role: 'dial step', supported: true } });
  kit.at(cx, cz, 3).prism(circlePoly(cx, cz, R + 0.8, 64), y + 0.2, y + 0.44, { wall: K.STONE, top: K.PAVING, meta: { role: 'dial', supported: true } });
  take(circlePoly(cx, cz, R + 2, 32));
  const yd = y + 0.44;
  // hour lines: thin bands of darker stone from the gnomon's foot to the rim (the east half)
  for (let hr = -6; hr <= 6; hr++) {
    const a = (hr / 12) * Math.PI, dir = [Math.cos(a), Math.sin(a)];
    const p0 = P(uc + dir[0] * 9, dir[1] * 9), p1 = P(uc + dir[0] * (R - 2), dir[1] * (R - 2));
    const e = [p1[0] - p0[0], p1[1] - p0[1]], le = Math.hypot(...e), nrm = [-e[1] / le * 0.35, e[0] / le * 0.35];
    kit.at(...lerp2(p0, p1, 0.5), 1).prism([[p0[0] - nrm[0], p0[1] - nrm[1]], [p1[0] - nrm[0], p1[1] - nrm[1]], [p1[0] + nrm[0], p1[1] + nrm[1]], [p0[0] + nrm[0], p0[1] + nrm[1]]], yd - 0.02, yd + 0.05, { wall: K.STONE, top: K.METAL, meta: { role: 'hour line', supported: true } });
    // hour stones at the rim
    const hs = P(uc + dir[0] * (R - 4), dir[1] * (R - 4));
    kit.at(hs[0], hs[1], 1).lathe(hs[0], hs[1], [[0.9, yd - 0.05, K.STONE], [0.9, yd + 1.1, K.STONE], [0.5, yd + 1.4, K.STONE], [0, yd + 1.5, K.STONE]], 8, { meta: { role: 'hour stone', supported: true } });
  }
  // the gnomon: a gilt obelisk on a stepped base
  kit.at(cx, cz, 3).lathe(cx, cz, [[7, yd - 0.05, K.STONE], [7, yd + 0.6, K.STONE], [5.2, yd + 0.6, K.PAVING], [5.2, yd + 1.2, K.STONE], [0, yd + 1.2, K.STONE]], 24, { meta: { role: 'gnomon base', supported: true } });
  kit.at(cx, cz, 3, 'gilt').lathe(cx, cz, [[2.6, yd + 1.15, K.GLASS], [1.7, yd + 44, K.GLASS], [0, yd + 49, K.LANTERN]], 4, { meta: { role: 'gnomon', supported: true }, phase: L.ang + Math.PI / 4 });
  // the seats: a semicircular exedra on the west side (toward the sea), opening east
  exedra(kit, ...P(uc, 0), yd, R - 9, L.ang, { h: 1.0, t: 1.2, tier: 2 });
  // fountains on the cross axis beyond the dial, trees round the square
  for (const s of [-1, 1]) { const v = s * (R + 16), q = box(uc - 7, uc + 7, v - 7, v + 7), [fx, fz] = P(uc, v); if (fits(q)) { fountain(kit, fx, fz, y, 6.5); take(q); } }
  const list = [];
  for (let k = 0; k < 28; k++) { const a = (k / 28) * TAU, rr = R + 9; list.push([uc + Math.cos(a) * rr, Math.sin(a) * rr]); }
  trees(list, y, SP.araucaria, [10, 3]);
}

// --------------------------------------------------------------------------- extras
/**
 * The Matins Terrace: beyond the Land Gate the Avenue of Dawn climbs on as a planted way to
 * the crest east of the city, where a terrace looks both ways: west over the needles to the
 * sea, east to the sunrise. On it the Temple of the First Light, a round temple with a gilt
 * dome on the axis, and a semicircle of seats on its east side facing the dawn.
 */
function extras(kit, L, ctx) {
  const { P } = L, { u0, u1, v0, v1 } = MATINS, vm = (v0 + v1) / 2;
  const q = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], g = groundRange(q, 4);
  if (g.max - g.min > 32) return;
  const top = g.max + 0.4;
  kit.at(...centroid(q), 3).prism(q, g.min - 1.5, top, { top: K.PAVING, meta: { role: 'matins terrace' } });
  ctx.place(q, 'civic');
  // the parapet round the terrace, open where the way arrives on the axis
  kit.at(...centroid(q), 1).parapetOpen(P, u0, u1, v0, v1, -9.5, 9.5, top, 1.0, 0.5);
  processional(kit, L, ctx.rnd, ctx.place, { u0: L.gate.u + 22, y0: L.gate.top, u1: u0, yEnd: top, hw: 9 });
  const [tx, tz] = P(u0 + 38, vm);
  tholos(kit, tx, tz, top, 13, { cols: 16, colH: 15, tier: 3, gilt: true, domeKind: K.GLASS, giltDome: true });
  // seats facing the sunrise (east, +u) on the terrace's east side
  exedra(kit, ...P(u1 - 14, vm), top, 20, L.ang, { h: 1.0, t: 1.2, tier: 2 });
  for (const v of [v0 + 8, v1 - 8]) for (let u = u0 + 10; u < u1 - 8; u += 14) { const [x, z] = P(u, v); kit.tree(x, top, z, SP.araucaria, 10 + ctx.rnd() * 3, ctx.rnd, { lean: 0 }); }
}
