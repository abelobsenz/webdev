import { K, H, rect, circlePoly, groundRange, centroid, pointInPoly, Occupancy, lerp2 } from './cityKit.js';
import { stairBlock } from './district.js';
import { colonnade, stoa, fountain, exedra, obelisk } from './civic.js';
import { arcadedRange } from './typology.js';
import { SP } from '../treeGeometry.js';

// Thalassa's harbour front and civic places (see thalassa.js for the city frame L: P(u, v)
// maps the frame, u up the via, v across it). Civic places are groups of the district's
// blocks (district.js): each stands on one terrace whose outline is the edges of the streets,
// lanes and via round it, so every joint with the city is exact.

const debug = (...a) => { if (typeof process !== 'undefined' && process.env?.ISLAND_DEBUG) console.log(...a); };
const F = (O, a) => { const A = [Math.cos(a), Math.sin(a)], B = [-A[1], A[0]]; return { O, A, B, a, f: (u, v) => [O[0] + A[0] * u + B[0] * v, O[1] + A[1] * u + B[1] * v] }; };

/** Which civic place (if any) a district block belongs to. */
export function civicOf(L, i, j, quad) {
  const c = L.UV(...centroid(quad)), [u, v] = c;
  if (quad.some(([x, z]) => H(x, z) < 2.6)) return null;
  const T = L.theatre;
  const inBox = (u0, u1, v0, v1) => quad.some(([x, z]) => { const [qu, qv] = L.UV(x, z); return qu > u0 && qu < u1 && qv > v0 && qv < v1; });
  if (inBox(T.u - 36, T.u + 66, T.v - 68, T.v + 68)) return 'theatre';
  if (u < 380 && v < -12 && v > -200) return 'agora';
  if (u < 380 && v > 12 && v < 200) return 'gym';
  if (u > 1110 && u < 1275 && Math.abs(v) < 70) return v < 0 ? 'nym-e' : 'nym-w';
  if (u > L.UTOP - 260 && Math.abs(v) < 230) return v < 0 ? 'upper-e' : 'upper-w';
  return null;
}

/**
 * The harbour front: behind the quay's back edge an esplanade terrace (one level along each
 * run, at most 6 m over the quay), flights up from the quay against its wall every fifth bay,
 * and arcaded merchant ranges on it behind a promenade, their arcades to the sea.
 */
export function harbourFront(kit, L, rnd, occ, place, { depth: D0 = 46, rise = 5.7 } = {}) {
  const hb = L.hb, Sd = hb.Sd;
  const inland = (p, d) => [p[0] - Sd[0] * d, p[1] - Sd[1] * d];
  for (const run of hb.runs) {
    if (run.length < 3) continue;
    // the esplanade: a terrace behind the quay's back edge, as deep as the city allows (up to
    // 46 m) and never more than 6 m above the quay; one level along its whole run
    const depth = run.map(() => D0);
    for (let k = 0; k < run.length; k++) {
      for (;;) {
        const k1 = Math.min(run.length - 1, k + 1), k0 = Math.max(0, k - 1);
        const q = [run[k0].r, run[k1].r, inland(run[k1].r, depth[k]), inland(run[k0].r, depth[k])];
        if (depth[k] < 12) break;
        if (occ.free(q, -0.1) && groundRange(q, 3).max < hb.yq + rise) break;
        depth[k] -= 4;
      }
    }
    // runs of sections deep enough to build on
    let seg = [];
    const flush = () => {
      if (seg.length >= 3) esplanade(kit, L, rnd, occ, place, run, seg, depth);
      seg = [];
    };
    for (let k = 0; k < run.length; k++) { if (depth[k] >= 12) seg.push(k); else flush(); }
    debug("esplanade depths", depth.map(Math.round).join(" "));
    flush();
  }
}

function esplanade(kit, L, rnd, occ, place, run, ks, depth) {
  const hb = L.hb, Sd = hb.Sd;
  const inland = (p, d) => [p[0] - Sd[0] * d, p[1] - Sd[1] * d];
  const front = ks.map((k) => run[k].r), back = ks.map((k) => inland(run[k].r, depth[k]));
  const q = [...front, ...back.slice().reverse()];
  if (!occ.free(q, -0.1)) { debug("esplanade blocked", occ.query(q, -0.1).map((i) => i.tag)); return; }
  const g = groundRange(q, 3), top = Math.max(g.max + 0.3, hb.yq + 1.2);
  kit.at(...centroid(q), 3).prism(q, g.min - 1.2, top, { top: K.PAVING, meta: { role: 'esplanade' } });
  occ.add(q, 'esplanade'); place(q, 'civic');
  // flights from the quay up to the esplanade every fifth bay, on the quay deck against the wall
  const rise = top - hb.yq, runLen = Math.ceil(rise / 0.17) * 0.3;
  const stairs = new Set();
  for (let j = 2; j < ks.length - 1; j += 5) {
    const a = front[j], b = front[j + 1], m = lerp2(a, b, 0.5), dir = [b[0] - a[0], b[1] - a[1]], dl = Math.hypot(...dir), e = [dir[0] / dl, dir[1] / dl];
    const hw = Math.min(4, dl / 2 - 0.5);
    const e1 = [[m[0] - e[0] * hw, m[1] - e[1] * hw], [m[0] + e[0] * hw, m[1] + e[1] * hw]];
    const e0 = e1.map((p) => [p[0] + Sd[0] * runLen, p[1] + Sd[1] * runLen]);
    stairBlock(kit, e0, e1, hb.yq, top, hw, hb.yq - 0.02);
    occ.add([e0[0], e0[1], e1[1], e1[0]], 'stair');
    stairs.add(j);
  }
  // arcaded ranges on the esplanade, set back behind a promenade, the arcades to the sea
  for (let j = 0; j < ks.length - 1; j++) {
    if (stairs.has(j) || depth[ks[j]] < 27 || depth[ks[j + 1]] < 27) continue;
    const a = inland(front[j], 6), b = inland(front[j + 1], 6);
    const rq = [a, b, inland(b, 19), inland(a, 19)];
    const p = { q: rq, width: Math.hypot(b[0] - a[0], b[1] - a[1]), depth: 19, top, gmin: top };
    arcadedRange(kit, p, rnd, { floors: 3 + (rnd() < 0.4 ? 1 : 0) });
    if (rnd() < 0.5) { const t = inland(lerp2(front[j], front[j + 1], 0.5), 2.6); kit.tree(t[0], top, t[1], SP.palm, 8 + rnd() * 3, rnd); }
  }
}

export function civicPlaces(kit, L, rnd, place, occ, dp) {
  const { P } = L, ang = Math.atan2(L.a[1], L.a[0]);
  for (const g of dp.civic.values()) {
    const kind = g.id.split(':')[0];
    // everything placed in a civic place stays inside its outline and clear of the rest
    const lo = new Occupancy(16);
    const uvq = (pts) => pts.map(([u, v]) => P(u, v));
    const fits = (q, pad = 0.4) => q.every((p) => pointInPoly(g.poly, ...p)) && lo.free(q, pad);
    const take = (q) => lo.add(q, 'x');
    const box = (u0, u1, v0, v1) => uvq([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    const stoaBox = (Fr, Ls, D) => [Fr.f(-0.5, -0.5), Fr.f(Ls + 0.5, -0.5), Fr.f(Ls + 0.5, D + 0.7), Fr.f(-0.5, D + 0.7)];
    const tryStoa = (Fr, Ls, D, y, h) => { if (Ls < 20) return; const q = stoaBox(Fr, Ls, D); if (!fits(q)) return; stoa(kit, Fr, Ls, D, y, h); take(q); };
    const plaza = (role, minTop = -Infinity) => {
      const r = groundRange(g.poly, 3), y = Math.max(r.max + 0.3, minTop);
      kit.at(...centroid(g.poly), 3).prism(g.poly, r.min - 1.2, y, { top: K.PAVING, meta: { role } });
      place(g.poly, 'civic'); occ.add(g.poly, 'civic');
      return y;
    };
    // the group's u extent at its narrowest (so what is placed inside fits everywhere)
    const vs = [g.va, (g.va + g.vb) / 2, g.vb];
    const uLo = Math.max(...vs.map((v) => g.uAt(v, 0))), uHi = Math.min(...vs.map((v) => g.uAt(v, 1)));
    const outer = Math.abs(g.va) > Math.abs(g.vb) ? g.va : g.vb, inner = outer === g.va ? g.vb : g.va, so = Math.sign(outer);
    const wide = Math.abs(outer - inner);
    if (kind === 'agora' || kind === 'gym') {
      const y = plaza(kind === 'agora' ? 'harbour agora' : 'gymnasium');
      // a stoa along the uphill side facing down over the square, one along the outer side
      const D = 12;
      tryStoa(F(P(uHi - 1.5, Math.min(g.va, g.vb) + 3), ang + Math.PI / 2), wide - 6, D, y, 8);
      tryStoa(so < 0 ? F(P(uLo + 3, outer + 1.5), ang) : F(P(uHi - D - 5, outer - 1.5), ang + Math.PI), uHi - uLo - D - 10, D, y, 8);
      const um = (uLo + uHi - D) / 2, vm = (inner + outer) / 2 + so * 4;
      if (kind === 'agora') {
        const fq = circlePoly(...P(um, vm), 7.4, 16);
        if (fits(fq)) { const [fx, fz] = P(um, vm); fountain(kit, fx, fz, y, 7); take(fq); }
        for (const du of [-28, 28]) for (const dv of [-24, 24]) { const q = box(um + du - 1.5, um + du + 1.5, vm + dv - 1.5, vm + dv + 1.5); if (fits(q, 1.5)) { const [x, z] = P(um + du, vm + dv); kit.tree(x, y, z, SP.palm, 9 + rnd() * 3, rnd); take(q); } }
        const oq = box(um - 2.5, um + 2.5, inner + so * 10 - 2.5, inner + so * 10 + 2.5);
        if (fits(oq)) { const [ox, oz] = P(um, inner + so * 10); obelisk(kit, ox, oz, y, 16, 1.3); take(oq); }
      } else {
        // a garden court with cypresses, and the domed academy on the inner side
        const cq = box(um - 34, um + 34, vm - 24, vm + 24);
        if (fits(cq)) {
          kit.at(...centroid(cq), 2).prism(cq, y - 0.05, y + 0.45, { wall: K.STONE, top: K.GARDEN, meta: { role: 'court garden', supported: true } });
          take(cq);
          for (let u = um - 28; u <= um + 28; u += 14) for (const dv of [-18, 18]) { const [x, z] = P(u, vm + dv); kit.tree(x, y + 0.45, z, SP.araucaria, 10 + rnd() * 3, rnd, { lean: 0 }); }
        }
        const hq = box(um - 13, um + 13, inner + so * 7 - 10, inner + so * 7 + 10).map((p) => p);
        const hc = centroid(hq);
        if (fits(hq)) {
          kit.at(hc[0], hc[1], 3).prism(hq, y - 0.2, y + 11, { wall: K.STONE, top: K.STONE, meta: { role: 'academy hall' } });
          kit.at(hc[0], hc[1], 3).dome(hc[0], hc[1], 8.5, y + 10.9, 2.5, 8, { seg: 24, meta: { role: 'academy dome', supported: true } });
          take(hq);
        }
      }
    } else if (kind === 'nym-e' || kind === 'nym-w') {
      const um = (uLo + uHi) / 2, yv = L.viaAt(um);
      const y = plaza('nymphaeum', yv ?? -Infinity);
      const R = Math.min(14, (uHi - uLo) / 2 - 2, wide / 2 - 3);
      if (R > 6) {
        const vc = outer - so * (R + 2), [cx, cz] = P(um, vc);
        exedra(kit, cx, cz, y, R, ang + (so < 0 ? Math.PI / 2 : -Math.PI / 2), { h: 5.5, t: 1.4, tier: 3 });
        const pv0 = vc - so * (R * 0.25), pv1 = vc - so * (R * 0.75);
        const pq = uvq([[um - R * 0.6, pv0], [um + R * 0.6, pv0], [um + R * 0.6, pv1], [um - R * 0.6, pv1]]);
        kit.at(...centroid(pq), 1).prism(pq, y - 0.05, y + 0.5, { wall: K.STONE, top: K.POOL, meta: { role: 'nymphaeum pool', supported: true } });
        const [fx, fz] = P(um, (pv0 + pv1) / 2); fountain(kit, fx, fz, y + 0.5, Math.min(3.2, R * 0.2));
      }
    } else if (kind === 'upper-e' || kind === 'upper-w') {
      const y = plaza('upper agora');
      const hu = (uLo + uHi) / 2, hw = Math.min(58, uHi - uLo - 30), hd = Math.min(66, wide - 44), hv = inner + so * (26 + hd / 2);
      if (hw > 24 && hd > 24) {
        const hq = box(hu - hw / 2, hu + hw / 2, hv - hd / 2, hv + hd / 2);
        if (fits(hq, 0.2)) {
          const [hx, hz] = centroid(hq);
          kit.at(hx, hz, 3).prism(hq, y - 0.2, y + 15, { wall: K.PUNCHED, top: K.STONE, vBase: y, meta: { role: so < 0 ? 'council hall' : 'library' } });
          const dr = Math.min(hw, hd) * 0.32;
          kit.at(hx, hz, 3).dome(hx, hz, dr, y + 14.9, 4, dr * 0.9, { seg: 32, meta: { role: 'hall dome', supported: true } });
          take(hq);
          // the portico toward the via: columns, their beam, and a roof slab back to the hall
          const vf = hv - so * hd / 2;
          colonnade(kit, F(P(hu - hw / 2 + 1.5, vf - so * 7), ang), 0, hw - 3, 0, y, 12, { n: 9, r: 0.8 });
          const rq = uvq([[hu - hw / 2 + 0.5, vf - so * 8], [hu + hw / 2 - 0.5, vf - so * 8], [hu + hw / 2 - 0.5, vf], [hu - hw / 2 + 0.5, vf]]);
          kit.at(...centroid(rq), 3).prism(rq, y + 13.18, y + 14.2, { wall: K.STONE, top: K.STONE, meta: { role: 'portico roof', supported: true, attached: true } });
          take(box(hu - hw / 2, hu + hw / 2, Math.min(vf, vf - so * 9), Math.max(vf, vf - so * 9)));
        }
      }
      for (let u = uLo + 10; u <= uHi - 10; u += 16) { const v = inner + so * 6, q = box(u - 1.5, u + 1.5, v - 1.5, v + 1.5); if (fits(q, 0.5)) { const [x, z] = P(u, v); kit.tree(x, y, z, SP.araucaria, 11 + rnd() * 3, rnd, { lean: 0 }); take(q); } }
    } else if (kind === 'theatre') {
      theatre(kit, L, rnd, place, occ, g);
    }
  }
}

/**
 * The Theatre of the Sea: a cavea of stone tiers on the hillside east of the via, looking
 * down over the city to the harbour; its orchestra, and the stage building in front.
 */
function theatre(kit, L, rnd, place, occ, g) {
  const { P } = L, T = L.theatre, ang = Math.atan2(L.a[1], L.a[0]);
  const O = P(T.u, T.v);
  // everything inside the group's outline
  const ring = circlePoly(O[0], O[1], 62, 40).filter((p) => { const [u] = L.UV(...p); return u > T.u - 2; });
  if (!ring.every((p) => pointInPoly(g.poly, ...p))) { debug('theatre does not fit'); return; }
  const orq = circlePoly(O[0], O[1], 15, 32), go = groundRange(orq, 2);
  const yo = go.max + 0.3;
  kit.at(O[0], O[1], 3).prism(orq, go.min - 1, yo, { top: K.PAVING, meta: { role: 'orchestra' } });
  let prev = yo;
  const arc = (r, a0, a1) => { const pts = []; for (let k = 0; k <= 24; k++) { const t = a0 + ((a1 - a0) * k) / 24; pts.push([O[0] + Math.cos(ang + t) * r, O[1] + Math.sin(ang + t) * r]); } return pts; };
  for (let k = 0; k < 22; k++) {
    const r0 = 15.2 + k * 2.1, r1 = r0 + 2.1, rm = (r0 + r1) / 2, pts = arc(rm, -1.75, 1.75);
    let gmax = -Infinity, gmin = Infinity;
    for (let j = 0; j <= 48; j++) { const t = -1.75 + (3.5 * j) / 48; for (const rr of [r0, rm, r1]) { const h = H(O[0] + Math.cos(ang + t) * rr, O[1] + Math.sin(ang + t) * rr); gmax = Math.max(gmax, h); gmin = Math.min(gmin, h); } }
    const y = Math.max(prev + 0.45, yo + 0.9 * (k + 1), gmax + 0.2);
    kit.at(O[0], O[1], 3).sweep(pts, () => [{ a: [1.05, gmin - 1], b: [1.05, y], kind: K.STONE }, { a: [1.05, y], b: [-1.05, y], kind: K.PAVING }, { a: [-1.05, y], b: [-1.05, gmin - 1], kind: K.STONE }], { meta: { role: 'cavea tier' } });
    prev = y;
  }
  // the stage building
  const [sx, sz] = P(T.u - 26, T.v), sq = rect(sx, sz, 9, 56, ang), gs = groundRange(sq, 2);
  if (sq.every((p) => pointInPoly(g.poly, ...p))) {
    const ys = Math.max(gs.max + 0.3, yo);
    kit.at(sx, sz, 3).prism(sq, gs.min - 1, ys + 12, { wall: K.PUNCHED, top: K.STONE, vBase: ys, meta: { role: 'skene' } });
  }
  // stone pines round the cavea on the rest of the ground
  for (let k = 0; k < 10; k++) {
    const a = ang + (k < 5 ? -1 : 1) * (1.95 + (k % 5) * 0.22), r = 40 + (k % 3) * 9, x = O[0] + Math.cos(a) * r, z = O[1] + Math.sin(a) * r;
    if (!pointInPoly(g.poly, x, z)) continue;
    kit.tree(x, Math.min(H(x, z), H(x + 1, z), H(x, z + 1), H(x - 1, z), H(x, z - 1)), z, SP.rainTree, 10 + rnd() * 3, rnd);
  }
  place(g.poly, 'theatre'); occ.add(g.poly, 'theatre');
}
