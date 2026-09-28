import { KIND as K } from '../buildings.js';
import { ISLANDS, promenadeAxis } from '../layout.js';

// The forecourts of the inner islands' arcologies and maglev terminals. A tower square was
// 18 m of bare paving round the podium's arcade; a terminal's forecourt the same round its
// plinth. Now each is planted as a place to arrive and to sit: a ring of trees in raised granite
// planters (the seat-height coping is a bench all round), benches between them looking out over
// the town, and on the arcologies' axes four fountain basins. Every island plants its own tree.
// The ring keeps 4.5 m clear of the podium wall (its stairs and canopies), the crowns clear of
// the lamp ring, every piece off the carriageways that cross the square, out of the lots, the
// other squares, the stations, and from under the promenade decks.

const TAU = Math.PI * 2;
const PLANTER_R = 2.3;
const FOUNTAIN_R = 3.4, CAFE_R = 1.45;
// per island: the forecourt tree (species, height) - a crown that clears podium and lamps
const TREE = {
  aster: ['flowering', 7.0], lumen: ['araucaria', 12.5], solace: ['palm', 10.5], verdant: ['flowering', 6.9],
  cantor: ['palm', 10], halcyon: ['araucaria', 12], oriel: ['flowering', 7.1], thule: ['araucaria', 13],
};
const crownR = { flowering: 1.35, araucaria: 0.38, palm: 0.6, rainTree: 1.55 };
const crownBase = { flowering: 0.32, araucaria: 0.12, palm: 0.9, rainTree: 0.33 };

function islandOf(x, z) {
  let best = null, bd = 1e9;
  for (const i of ISLANDS) { const d = Math.hypot(i.x - x, i.z - z) / i.r; if (d < bd) { bd = d; best = i; } }
  return bd < 1.2 ? best : null;
}

/** A tree planter: octagonal granite kerb with a seat-height coping, planted soil. Its top is
 *  level (yTop), its foot below the lowest ground of its footprint (yFoot): on a slope the
 *  downhill side stands taller, a raised bed. */
export function planterWork(x, z, yTop, yFoot) {
  return (B, lod) => {
    B.frame(x, yTop, z, 0);
    const seg = lod ? 8 : 16, f = yFoot - yTop;
    B.lathe(0, 0, [[PLANTER_R, f, K.STONE], [PLANTER_R, -0.1, K.STONE], [PLANTER_R + 0.1, -0.06, K.STONE], [PLANTER_R + 0.1, 0, K.STONE],
      [PLANTER_R - 0.38, 0, K.STONE], [PLANTER_R - 0.38, -0.12, K.GARDEN], [0, -0.12, K.GARDEN]], seg);
  };
}

/** A fountain basin: a granite drum with a moulded coping (level at yTop, its foot below the
 *  lowest ground), still water, a turned pedestal and a bronze bowl brimming over, a finial. */
export function fountainWork(x, z, yTop, yFoot, R = FOUNTAIN_R) {
  return (B, lod) => {
    B.frame(x, yTop, z, 0);
    const seg = lod ? 12 : 32, f = yFoot - yTop, w = -0.22;
    B.lathe(0, 0, [[R, f, K.STONE], [R, -0.18, K.STONE], [R + 0.12, -0.13, K.STONE], [R + 0.12, 0, K.STONE], [R - 0.3, 0, K.STONE], [R - 0.3, w, K.POOL], [0.55, w, K.POOL]], seg);
    if (lod) { B.lathe(0, 0, [[0.5, w - 0.1, K.STONE], [0.4, w + 0.9, K.STONE], [1.0, w + 1.05, K.METAL], [0, w + 1.3, K.METAL]], 8); return; }
    B.lathe(0, 0, [[0.55, w - 0.08, K.STONE], [0.52, w + 0.14, K.STONE], [0.4, w + 0.24, K.STONE], [0.34, w + 0.74, K.STONE], [0.42, w + 0.82, K.STONE], [0.42, w + 0.9, K.METAL],
      [1.05, w + 1.04, K.METAL], [1.12, w + 1.14, K.METAL], [1.0, w + 1.14, K.POOL], [0.16, w + 1.14, K.POOL], [0.12, w + 1.17, K.METAL], [0.07, w + 1.72, K.METAL], [0.13, w + 1.82, K.METAL], [0, w + 1.94, K.METAL]], 24);
  };
}

/** A café table under a parasol: a bronze pedestal table, three timber chairs round it and a
 *  bone-white parasol on its pole. seats: [{ x, z, y, yaw }] the chairs (world, each on its own
 *  ground, facing the table); y: the ground under the table. */
export function cafeWork(x, z, y, seats) {
  return (B, lod) => {
    B.frame(x, y, z, 0);
    if (lod) {
      B.lathe(0, 0, [[0.08, -0.2, K.METAL], [0.05, 2.1, K.METAL], [1.3, 2.05, K.STONE], [1.3, 2.12, K.STONE], [0, 2.5, K.STONE]], 6);
      B.lathe(0, 0, [[0.42, 0.66, K.METAL], [0.42, 0.74, K.METAL], [0, 0.74, K.METAL]], 6);
      return;
    }
    // table: foot, column, top; the parasol's pole rises from its centre
    B.lathe(0, 0, [[0.26, -0.15, K.METAL], [0.26, 0.03, K.METAL], [0.06, 0.08, K.METAL], [0.05, 0.69, K.METAL], [0.4, 0.7, K.METAL], [0.42, 0.72, K.METAL], [0.42, 0.75, K.METAL], [0.05, 0.75, K.METAL],
      [0.03, 0.76, K.METAL], [0.025, 2.02, K.METAL], [0.07, 2.04, K.METAL], [0.07, 2.08, K.STONE], [1.32, 2.06, K.STONE], [1.36, 2.02, K.STONE], [1.36, 2.1, K.STONE], [0.3, 2.42, K.STONE], [0.05, 2.47, K.METAL], [0, 2.56, K.METAL]], 16);
    // chairs: a timber seat on four slim legs, a timber back
    for (const c of seats) {
      B.frame(c.x, c.y, c.z, c.yaw);
      for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.17], [0.19, 0.17]]) B.box(lx - 0.02, lx + 0.02, lz - 0.02, lz + 0.02, -0.12, 0.44, K.METAL, K.METAL);
      B.box(-0.22, 0.22, -0.22, 0.2, 0.44, 0.47, K.TIMBER, K.TIMBER);
      B.box(-0.2, 0.2, -0.25, -0.22, 0.47, 0.84, K.TIMBER, K.TIMBER);
    }
  };
}

/**
 * Plan the forecourts. S: Survey; out: { works, trees, furniture, sites }.
 */
export function planForecourts(S, out) {
  const plan = S.plan;
  const others = plan.squares.filter((q) => q.kind !== 'tower');
  const inOther = (x, z, r, pad = 1.5, self = null) => others.some((q) => q !== self && Math.abs(q.x - x) < q.r + r + pad && Math.hypot(q.x - x, q.z - z) < q.r + r + pad);
  const seatTree = (x, z, sp, s, q) => {
    const cr = crownR[sp] * s * 0.5, cb = crownBase[sp] * s;
    if (!S.free(x, z, PLANTER_R + 0.3)) return false;
    if (S.edgeMin(x, z, PLANTER_R) < 1.0) return false;
    const g = S.groundRange(x, z, PLANTER_R);
    if (g.lo < 1.8 || g.hi - g.lo > 0.85 || g.hi - S.ground(x, z) > 0.4) return false;
    if (!S.towerClear(x, z, PLANTER_R, 4.5) || !S.towerClear(x, z, cr, 1.5)) return false;
    if (!S.stationClear(x, z, Math.max(cr, PLANTER_R), 2)) return false;
    if (inOther(x, z, Math.max(cr, PLANTER_R), 1.5, q)) return false;
    if (S.discInLot(x, z, Math.max(cr, PLANTER_R), 0.8)) return false;
    if (S.lampNear(x, z, Math.max(cr + 0.8, PLANTER_R + 0.8))) return false;
    if (S.headroom(x, z, cr + 0.5) < s + 2.5) return false;
    // the crown's underside clears the planter's coping by a head's height
    if (cb < 1.8 && sp !== 'araucaria') return false;
    return g;
  };
  const seatBench = (x, z, yaw, q) => {
    if (!S.free(x, z, 1.15)) return false;
    if (S.edgeMin(x, z, 1.1) < 0.6) return false;
    const g = S.groundRect(x, z, yaw, 0.96, -0.37, 0.28);
    if (g.lo < 1.8 || g.hi - g.lo > 0.2) return false;
    if (!S.towerClear(x, z, 1.1, 4.5) || !S.stationClear(x, z, 1.1, 1) || inOther(x, z, 1.1, 1.0, q)) return false;
    if (S.discInLot(x, z, 1.1, 0.5) || S.lampNear(x, z, 1.6) || S.headroom(x, z, 1.2) < 3.2) return false;
    return g;
  };
  const seatFountain = (x, z, q) => {
    if (!S.free(x, z, FOUNTAIN_R + 0.5)) return false;
    if (S.edgeMin(x, z, FOUNTAIN_R + 0.2) < 1.0) return false;
    const g = S.groundRange(x, z, FOUNTAIN_R + 0.12);
    if (g.lo < 1.8 || g.hi - g.lo > 0.7) return false;
    if (!S.towerClear(x, z, FOUNTAIN_R + 0.2, 4.5) || !S.stationClear(x, z, FOUNTAIN_R, 2) || inOther(x, z, FOUNTAIN_R, 1.5, q)) return false;
    if (S.discInLot(x, z, FOUNTAIN_R + 0.2, 0.8) || S.lampNear(x, z, FOUNTAIN_R + 1.2) || S.headroom(x, z, FOUNTAIN_R) < 4) return false;
    return g;
  };
  const seatCafe = (x, z, q) => {
    if (!S.free(x, z, CAFE_R + 0.3)) return false;
    if (S.edgeMin(x, z, CAFE_R) < 1.0) return false;
    const g = S.groundRange(x, z, CAFE_R);
    if (g.lo < 1.8 || g.hi - g.lo > 0.3) return false;
    // clear of the podium (its stairs reach 3.7 m out) and of anything overhead
    if (S.headroom(x, z, CAFE_R + 4.2) < 12 || S.headroom(x, z, CAFE_R + 0.5) < 3.5) return false;
    if (!S.towerClear(x, z, CAFE_R, 4.5) || !S.stationClear(x, z, CAFE_R, 1) || inOther(x, z, CAFE_R, 1.0, q)) return false;
    if (S.discInLot(x, z, CAFE_R, 0.5) || S.lampNear(x, z, CAFE_R + 0.6)) return false;
    return g;
  };
  const addTree = (x, z, sp, s, g, district) => {
    // the planter stands on the lowest ground of its footprint; the tree roots in its soil
    const top = g.hi + 0.45;
    out.works.push({ district, x, z, r: PLANTER_R + 0.1, build: planterWork(x, z, top, g.lo - 0.45), kind: 'planter' });
    out.trees.push({ x, z, y: top - 0.12 - 0.15, sp, s: s * (0.95 + ((Math.abs(Math.sin(x * 12.9 + z * 78.2)) * 43758.5) % 1) * 0.1) });
    S.claim(x, z, PLANTER_R + 0.3, 'planter');
  };
  const addBench = (x, z, yaw, g) => {
    out.furniture.push({ kind: 'bench', x, z, y: g.lo - 0.02, yaw, r: 1.05 });
    S.claim(x, z, 1.1, 'bench');
  };

  let nTree = 0, nBench = 0, nFount = 0, nCafe = 0;
  // ---- round the arcologies
  for (const T of S.towers) {
    const q = plan.squares.find((s) => s.kind === 'tower' && s.x === T.x && s.z === T.z);
    const isl = islandOf(T.x, T.z);
    if (!q || !isl || Math.hypot(T.x, T.z) > 4700) continue;
    const [sp, s] = TREE[isl.id] || TREE.aster;
    const cr = crownR[sp] * s * 0.5;
    // the ring: the crown clears the podium (4.5 m out) and the lamp ring (base + 15.5)
    // (a café terrace before the arcade, base + 4.5 to 7.5, sits between the crowns)
    const rT = Math.max(T.base + 9.9, Math.min(T.base + 4.2 + cr + 0.3, T.base + 14.6 - cr));
    if (rT + cr > T.base + 14.7) continue;
    const n = Math.max(8, Math.round((TAU * rT) / 7.5));
    // the axes: toward the island's heart (or, for the tower at its heart, toward the Axis)
    const dc = Math.hypot(isl.x - T.x, isl.z - T.z);
    const a0 = dc > 40 ? Math.atan2(isl.z - T.z, isl.x - T.x) : Math.atan2(-T.z, -T.x);
    // four fountains, as near the four axes as the streets entering the square allow
    const axes = new Set();
    for (let q4 = 0; q4 < 4; q4++) {
      const k0 = Math.round((q4 * n) / 4);
      for (const dk of [0, 2, -2, 4, -4, 6, -6]) {
        const k = (((k0 + dk) % n) + n) % n;
        if (k % 2 || [...axes].some((o) => Math.min(Math.abs(o - k), n - Math.abs(o - k)) < n / 6)) continue;
        const a = a0 + (k / n) * TAU;
        if (seatFountain(T.x + Math.cos(a) * rT, T.z + Math.sin(a) * rT, q)) { axes.add(k); break; }
      }
    }
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * TAU, x = T.x + Math.cos(a) * rT, z = T.z + Math.sin(a) * rT;
      if (axes.has(k)) {
        const g = seatFountain(x, z, q);
        if (g) { out.works.push({ district: isl.id, x, z, r: FOUNTAIN_R + 0.12, build: fountainWork(x, z, g.hi + 0.5, g.lo - 0.5), kind: 'fountain' }); S.claim(x, z, FOUNTAIN_R + 0.5, 'fountain'); nFount++; continue; }
      }
      if (k % 2 === 0) {
        const g = seatTree(x, z, sp, s, q);
        if (g) { addTree(x, z, sp, s, g, isl.id); nTree++; }
      } else {
        // a bench under the trees, looking out over the town
        const yaw = Math.atan2(Math.cos(a), Math.sin(a));
        const g = seatBench(x, z, yaw, q);
        if (g) { addBench(x, z, yaw, g); nBench++; }
        // a café terrace before the arcade's shopfronts, between the crowns (two slots in three)
        if (k % 6 !== 5) {
          const rc = T.base + 6.1, cx = T.x + Math.cos(a) * rc, cz = T.z + Math.sin(a) * rc;
          const gc = seatCafe(cx, cz, q);
          if (gc) {
            // three chairs round the table, each on the ground under it, facing the table
            const seats = [0, 1, 2].map((c) => {
              const ca = a + 0.5 + (c / 3) * TAU + (k % 3) * 0.3, sx = cx + Math.cos(ca) * 0.8, sz = cz + Math.sin(ca) * 0.8;
              let lo = Infinity;
              for (const [ox, oz] of [[0, 0], [0.24, 0.24], [-0.24, 0.24], [0.24, -0.24], [-0.24, -0.24]]) lo = Math.min(lo, S.ground(sx + ox, sz + oz));
              return { x: sx, z: sz, y: lo - 0.01, yaw: Math.atan2(cx - sx, cz - sz) };
            });
            const gt = Math.min(S.ground(cx, cz), S.ground(cx + 0.26, cz), S.ground(cx - 0.26, cz), S.ground(cx, cz + 0.26), S.ground(cx, cz - 0.26));
            out.works.push({ district: isl.id, x: cx, z: cz, r: CAFE_R, top: gt + 2.2, build: cafeWork(cx, cz, gt - 0.01, seats), kind: 'cafe' });
            S.claim(cx, cz, CAFE_R + 0.3, 'cafe'); nCafe++;
          }
        }
      }
    }
    out.sites.push({ x: T.x, z: T.z, r: rT, ring: true, color: [40, 140, 60] });
  }
  // ---- round the island terminals: a ring of trees where the plinth, deck and tube leave room
  for (const q of plan.squares) {
    if (q.kind !== 'station') continue;
    const isl = islandOf(q.x, q.z);
    if (!isl) continue;
    const sp = 'flowering', s = 7.2, cr = crownR[sp] * s * 0.5;
    const rS = q.r - 2.5 - cr - 0.6;
    const n = Math.round((TAU * rS) / 7.5);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU, x = q.x + Math.cos(a) * rS, z = q.z + Math.sin(a) * rS;
      if (k % 2 === 0) {
        // the terminal's own square: only its plinth, deck and tube are to be kept clear of
        if (!S.free(x, z, PLANTER_R + 0.3) || S.edgeMin(x, z, PLANTER_R) < 1.0) continue;
        const g = S.groundRange(x, z, PLANTER_R);
        if (g.lo < 1.8 || g.hi - g.lo > 0.85 || g.hi - S.ground(x, z) > 0.4) continue;
        if (S.headroom(x, z, cr + 1.0) < s + 3 || S.discInLot(x, z, cr, 0.8) || S.lampNear(x, z, cr + 0.8)) continue;
        if (!S.towerClear(x, z, cr, 1.5) || inOther(x, z, cr, 1.5, q)) continue;
        addTree(x, z, sp, s, g, isl.id); nTree++;
      } else {
        const yaw = Math.atan2(Math.cos(a), Math.sin(a));
        if (!S.free(x, z, 1.15) || S.edgeMin(x, z, 1.1) < 0.6) continue;
        const g = S.groundRect(x, z, yaw, 0.96, -0.37, 0.28);
        if (g.lo < 1.8 || g.hi - g.lo > 0.2) continue;
        if (S.headroom(x, z, 1.5) < 4 || S.discInLot(x, z, 1.1, 0.5) || S.lampNear(x, z, 1.6) || !S.towerClear(x, z, 1.1, 4.5) || inOther(x, z, 1.1, 1.0, q)) continue;
        addBench(x, z, yaw, g); nBench++;
      }
    }
  }
  return { trees: nTree, benches: nBench, fountains: nFount, cafes: nCafe };
}

/**
 * Groves in the great squares. The landing squares (where each promenade comes down) and the
 * civic squares were wide paving between the furniture ring round their centre and the walkers'
 * ring near their rim (streetscape.js, people.js): a ring of trees in planters now stands in that
 * band, off the promenade deck's approach. A civic square whose centre the streetscape cannot
 * furnish (its fountain would reach an arcology's exclusion) gets a fountain basin of its own.
 */
export function planSquareGroves(S, out) {
  const plan = S.plan;
  let nTree = 0, nFount = 0;
  for (const q of plan.squares) {
    if (q.kind !== 'civic' && q.kind !== 'landing') continue;
    const isl = islandOf(q.x, q.z);
    if (!isl) continue;
    const innerEdge = q.r * 0.52 - 0.45;
    let deck = null;
    if (q.kind === 'landing') {
      const ax = promenadeAxis(isl);
      deck = { dx: ax.dir.x, dz: ax.dir.z };
    }
    // what the streetscape puts at the centre (a civic building, a fountain) and its ring
    let Rc = 0;
    if (q.landmarkR) Rc = q.landmarkR + 0.6;
    else if (!deck) {
      const R = Math.min(11, q.r * 0.3, innerEdge - 6.5), Rout = R + 0.6;
      const blocked = plan.exclusions.some((e) => Math.hypot(e.x - q.x, e.z - q.z) < e.r + Rout + 0.3 + 2.5);
      if (R >= 3.5 && !blocked) Rc = Rout;
      else {
        // the square's own fountain, as large as the exclusions round it allow
        let Rf = Math.min(4.2, ...plan.exclusions.map((e) => Math.hypot(e.x - q.x, e.z - q.z) - e.r - 2.5));
        if (Rf >= 2.4) {
          const g = S.groundRange(q.x, q.z, Rf + 0.12);
          if (g.hi - g.lo < 0.8 && S.free(q.x, q.z, Rf + 0.5) && !S.lampNear(q.x, q.z, Rf + 1) && S.headroom(q.x, q.z, Rf) > 6) {
            out.works.push({ district: isl.id, x: q.x, z: q.z, r: Rf + 0.12, build: fountainWork(q.x, q.z, g.hi + 0.5, g.lo - 0.5, Rf), kind: 'fountain', inSquare: true });
            S.claim(q.x, q.z, Rf + 0.5, 'fountain');
            q.townR = Rf + 0.12;
            Rc = q.townR + 0.6;
            nFount++;
          }
        }
      }
    }
    const rb = deck ? Math.min(9, innerEdge - 0.45) : Math.max(Rc + 3.4, Math.min(innerEdge - 0.45, Rc + 4.2));
    const rk = q.kind === 'civic' && rb + 5.5 + 2.4 <= innerEdge ? rb + 5.5 : 0;
    const qh = Math.max(0.4, Math.min(q.r * 0.15 - 0.45, q.r * 0.2 - 1.85));
    const lo = (rk ? rk + 2.4 : rb + 0.6) + 1.2 + PLANTER_R, hi = q.r * 0.8 - qh - 0.6 - PLANTER_R;
    if (hi < lo) continue;
    const rG = (lo + hi) / 2;
    const [sp, s0] = GROVE[isl.id] || ['flowering', 7.2];
    const s = Math.min(s0, 9), cr = crownR[sp] * s * 0.5;
    const n = Math.max(6, Math.round((TAU * rG) / 8));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + 0.13, x = q.x + Math.cos(a) * rG, z = q.z + Math.sin(a) * rG;
      if (deck) {
        const u = (x - q.x) * deck.dx + (z - q.z) * deck.dz, v = -(x - q.x) * deck.dz + (z - q.z) * deck.dx;
        if (u < 6 && Math.abs(v) < 18.5) continue;
      }
      if (!S.free(x, z, PLANTER_R + 0.3) || S.edgeMin(x, z, PLANTER_R) < 1.0) continue;
      const g = S.groundRange(x, z, PLANTER_R);
      if (g.lo < 1.8 || g.hi - g.lo > 0.85 || g.hi - S.ground(x, z) > 0.4) continue;
      if (S.lampNear(x, z, Math.max(cr + 0.8, PLANTER_R + 0.8)) || S.discInLot(x, z, Math.min(cr, 3.2), 0.8) || S.headroom(x, z, cr + 0.5) < s + 2.5) continue;
      if (!S.towerClear(x, z, PLANTER_R, 4.5) || !S.towerClear(x, z, cr, 1.5) || !S.stationClear(x, z, Math.max(cr, PLANTER_R), 2)) continue;
      const top = g.hi + 0.45;
      out.works.push({ district: isl.id, x, z, r: PLANTER_R + 0.1, build: planterWork(x, z, top, g.lo - 0.45), kind: 'planter', inSquare: true });
      out.trees.push({ x, z, y: top - 0.27, sp, s: s * (0.95 + ((Math.abs(Math.sin(x * 12.9 + z * 78.2)) * 43758.5) % 1) * 0.1) });
      S.claim(x, z, PLANTER_R + 0.3, 'planter');
      nTree++;
    }
    out.sites.push({ x: q.x, z: q.z, r: rG, ring: true, color: [40, 140, 60] });
  }
  return { trees: nTree, fountains: nFount };
}

// the square groves: a tree of the island's own, a crown the benches and lamps clear
const GROVE = {
  aster: ['flowering', 7.2], lumen: ['palm', 10], solace: ['flowering', 7.2], verdant: ['palm', 9.5],
  cantor: ['flowering', 7.2], halcyon: ['palm', 10], oriel: ['flowering', 7.2], thule: ['palm', 10],
};
