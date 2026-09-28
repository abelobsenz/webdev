import { QUARTERS } from './rimTowns.js';

// What the rim towns build on their lots, by quarter and by the street a lot fronts
// (rimPlan.js tags every rim street with its role and quarter):
//   Rim Way     the formal frontage: the quarter's grandest types, a storey more
//   the strand  the waterfront: arcades over the walk, lofts and villas facing the lagoon
//   the parade  terraces and villas facing the sea
//   High Street arcaded, the town's shops
//   rows and cross streets the quarter's own mix; lanes (mews) small houses and stacks
// Types needing room (courtyards, domes, porticoes) are only drawn on lots that fit them.

const fitsType = (t, L) => {
  const big = L.w > 26 && L.d > 24;
  switch (t) {
    case 'cloister': case 'college': return big;
    case 'pavilion': return Math.min(L.w, L.d) >= 18;
    case 'warehouse': return L.w >= 16 && L.d >= 14;
    case 'gallery': return L.w >= 16 && L.d >= 16;
    case 'mansion': return L.w >= 14 && L.d >= 14;
    case 'arcade': return L.w >= 12;
    default: return true;
  }
};

function pick(r, list, L) {
  const ok = list.filter(([t]) => fitsType(t, L));
  const tot = ok.reduce((s, [, w]) => s + w, 0);
  if (!tot) return null;
  let x = r * tot;
  for (const [t, w] of ok) { if ((x -= w) <= 0) return t; }
  return ok[ok.length - 1][0];
}

/** The typology of a rim lot (r: a uniform draw). */
export function rimLotType(L, r) {
  const st = L.street || {}, Q = QUARTERS[st.quarter] || QUARTERS.harbour;
  const role = st.role;
  let list;
  if (role === 'strand') list = [[Q.strand[0], 0.55], [Q.strand[1], 0.3], ['terrace', 0.15]];
  else if (role === 'parade') list = [['terrace', 0.4], [st.quarter === 'garden' ? 'mansion' : 'ribbon', 0.35], ['stack', 0.25]];
  else if (role === 'high') list = [['arcade', 0.45], ...Q.types];
  else if (role === 'rimWay') {
    list = { harbour: [['terrace', 0.35], ['arcade', 0.25], ['ribbon', 0.25], ['warehouse', 0.15]], gate: [['college', 0.3], ['cloister', 0.25], ['gallery', 0.25], ['terrace', 0.2]], garden: [['mansion', 0.45], ['gallery', 0.25], ['pavilion', 0.15], ['terrace', 0.15]], upland: [['terrace', 0.45], ['stack', 0.3], ['cloister', 0.25]] }[st.quarter] || Q.types;
  } else if (role === 'mews' || L.cls === 1) list = [['mews', 0.6], ['stack', 0.3], ['terrace', 0.1]];
  else list = Q.types;
  return pick(r, list, L) || pick(r, [['mews', 0.5], ['terrace', 0.3], ['stack', 0.2]], L) || 'mews';
}

/** Storeys of a rim lot (R: its random stream). */
export function rimLotFloors(L, R, type) {
  const st = L.street || {}, Q = QUARTERS[st.quarter] || QUARTERS.harbour;
  const [f0, f1] = Q.floors;
  let f = f0 + Math.floor(R() * (f1 - f0 + 1));
  if (st.role === 'rimWay' || st.role === 'strand') f += 1;
  if (type === 'mansion') f = Math.max(f, 4);
  if (L.cls === 1 || st.role === 'mews') f = Math.min(f, 4);
  return f;
}

/** Lot sizes a rim street draws: the Gate and Garden coasts build on larger lots. */
export function rimLotSize(st) {
  if (!st || st.cls === 1) return 'small';
  if (st.quarter === 'gate' && (st.role === 'rimWay' || st.role === 'row')) return 'large';
  if (st.quarter === 'garden' && st.role !== 'mews') return 'large';
  return 'small';
}
