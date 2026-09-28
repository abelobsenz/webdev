import { MASSIF_GARDENS } from '../massifTowns.js';
import { hash2, SPC } from './cover.js';
import { crownR } from './woods.js';

// The terrace towns' gardens: Ridgeholm, Highgate and Cloudmere step up their slopes on level
// contour terraces, and a third of those terraces are garden terraces (grassed tops, the houses
// few and far between). Here they are planted: flowering trees, shade trees and the odd Norfolk
// pine in the gaps between the houses, a few courtyard trees on the paved terraces too, so the
// towns read from the lagoon as hill towns in their gardens, not as bare stone.
//
// A tree is planted on a built terrace top only (rooted 5 cm into the stone at its level), with
// its trunk at least a metre inside the terrace's edges and clear of the promenade walk that runs
// along its front, of every stair and civic corridor and landing, and of the town's own reserves
// (the square, the gondola and funicular, the towers); its crown clears every house and chapel on
// the terrace (and on the terraces above and below) and every other tree.

const inPoly = (q, x, z) => {
  let sg = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length], c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    if (!sg) sg = Math.sign(c); else if (Math.sign(c) !== sg) return false;
  }
  return true;
};
const segD = (x, z, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
};
/** Distance from (x, z) to the polygon q (0 inside). */
const polyDist = (q, x, z) => {
  if (inPoly(q, x, z)) return 0;
  let d = Infinity;
  for (let i = 0; i < q.length; i++) d = Math.min(d, segD(x, z, q[i], q[(i + 1) % q.length]));
  return d;
};
/** Distance from (x, z) to the polygon's edges, positive inside. */
const insideBy = (q, x, z) => {
  if (!inPoly(q, x, z)) return -1;
  let d = Infinity;
  for (let i = 0; i < q.length; i++) d = Math.min(d, segD(x, z, q[i], q[(i + 1) % q.length]));
  return d;
};

export function planTownGardens() {
  const out = [];
  for (const town of MASSIF_GARDENS) {
    const B = 24, cellOf = (x, z) => Math.floor(x / B) * 65536 + Math.floor(z / B);
    const index = (list, key) => { const m = new Map(); for (const it of list) for (const k of key(it)) { let L = m.get(k); if (!L) m.set(k, (L = [])); L.push(it); } return m; };
    const bboxKeys = (q, pad) => { const xs = q.map((p) => p[0]), zs = q.map((p) => p[1]), ks = []; for (let i = Math.floor((Math.min(...xs) - pad) / B); i <= Math.floor((Math.max(...xs) + pad) / B); i++) for (let j = Math.floor((Math.min(...zs) - pad) / B); j <= Math.floor((Math.max(...zs) + pad) / B); j++) ks.push(i * 65536 + j); return ks; };
    const houses = index(town.houses, (h) => bboxKeys(h.q, 12));
    const walks = index(town.terraces.filter((t) => t.walkQ), (t) => bboxKeys(t.walkQ, 4));
    const mine = new Map();
    const clear = (x, z, cr) => {
      for (const h of houses.get(cellOf(x, z)) || []) if (polyDist(h.q, x, z) < cr * 0.95 + 0.6) return false;
      for (const t of walks.get(cellOf(x, z)) || []) if (polyDist(t.walkQ, x, z) < 0.9) return false;
      for (const c of town.corridors) if (segD(x, z, c.a, c.b) < c.width / 2 + 1.6) return false;
      for (const p of town.landings) if (Math.hypot(p[0] - x, p[1] - z) < 7) return false;
      if (!town.free([x, z], 1.5)) return false;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const t of mine.get(cellOf(x, z) + i * 65536 + j) || []) if (Math.hypot(t.x - x, t.z - z) < (t.cr + cr) * 0.72 + 1) return false;
      return true;
    };
    let n = 0;
    town.terraces.forEach((t, ti) => {
      const q = t.q;   // P0, P1 (back, on the contour), F1, F0 (front)
      const back = [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2], front = [(q[2][0] + q[3][0]) / 2, (q[2][1] + q[3][1]) / 2];
      const len = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), depth = Math.hypot(front[0] - back[0], front[1] - back[1]);
      if (len < 4 || depth < 6) return;
      // garden terraces are planted generously, the paved ones with an occasional courtyard tree
      const want = t.garden ? 0.9 : 0.16;
      if (hash2(ti, Math.round(t.L), 81) > want) return;
      for (const f of [0.5, 0.2, 0.8]) {
        const r = hash2(ti, Math.round(f * 10), 82);
        const sp = r < 0.42 ? SPC.flowering : r < 0.72 ? SPC.forestBroad : r < 0.9 ? SPC.rainTree : SPC.araucaria;
        const s = sp === SPC.flowering ? 7 + 3 * hash2(ti, 1, 83) : sp === SPC.forestBroad ? 9 + 3 * hash2(ti, 2, 83) : sp === SPC.rainTree ? 8 + 2.5 * hash2(ti, 3, 83) : 14 + 5 * hash2(ti, 4, 83);
        const cr = crownR(sp, s);
        // between the houses (they stand at the back) and the walk (at the front)
        for (const v of [0.42, 0.3, 0.55]) {
          const bx = q[0][0] + (q[1][0] - q[0][0]) * f, bz = q[0][1] + (q[1][1] - q[0][1]) * f, fx = q[3][0] + (q[2][0] - q[3][0]) * f, fz = q[3][1] + (q[2][1] - q[3][1]) * f;
          const x = bx + (fx - bx) * v, z = bz + (fz - bz) * v;
          if (insideBy(q, x, z) < 1.1 || !clear(x, z, cr)) continue;
          const k = n++, tint = 0.9 + 0.2 * hash2(k, 5, 84);
          const tree = { x, y: t.L - 0.05, z, sp, s, cr, rot: hash2(k, 6, 84) * Math.PI * 2, t0: tint * 0.96, t1: tint, t2: tint * 0.92, bloom: hash2(k, 7, 84), why: 'town garden', support: t.L, town: town.town };
          out.push(tree);
          const key = cellOf(x, z); let L = mine.get(key); if (!L) mine.set(key, (L = [])); L.push(tree);
          break;
        }
      }
    });
  }
  return out;
}
