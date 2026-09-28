import { KIND as K } from '../buildings.js';
import { ISLANDS } from '../layout.js';
import { column } from './kit.js';

// The gardens of the island towns. The blocks of every island town were lawn inside their
// frontages, and the parks the plan leaves (where no lot was laid) plain grass; the green belt
// between the outer esplanade and the shore walk the same. Now the town is furnished as a
// garden city: wherever a lawn leaves room, a garden room of its own - a bandstand, a pergola
// walk, a parterre round a fountain basin, a children's playground, a kitchen garden of raised
// beds with its tool shed and rain tank - ringed by trees of the island's own species, benches
// facing in; and on the green belt, at the highest ground looking out over the lagoon,
// belvederes: round stone terraces behind a balustrade with a domed pavilion. Every piece is a
// closed solid standing on the lowest ground of its footprint (its plinth level with the
// highest), sited clear of the kerbs, lots, squares, lamps, towers, stations and of each other.

const TAU = Math.PI * 2;
const ISLAND_TREE = {
  aster: ['flowering', 7.5], lumen: ['rainTree', 9], solace: ['palm', 11], verdant: ['flowering', 7.2],
  cantor: ['rainTree', 8.8], halcyon: ['flowering', 7.6], oriel: ['araucaria', 12.5], thule: ['rainTree', 9.2],
};
const CROWN = { flowering: 1.35, palm: 0.6, araucaria: 0.38, rainTree: 1.55 };

// ------------------------------------------------------------------ designs --
// In a local frame, the plinth top at y = 0; R = the radius the piece needs clear.

/** A bandstand: an octagonal stone base with steps, eight slender columns, a bronze ogee roof. */
function bandstand(B, lod) {
  const r = 3.6, h = 3.4;
  B.lathe(0, 0, [[r + 0.25, -0.02, K.STONE], [r + 0.25, 0.75, K.STONE], [0, 0.75, K.PAVING]], 8);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; column(B, Math.cos(a) * (r - 0.4), Math.sin(a) * (r - 0.4), 0.13, 0.75, 0.75 + h, lod); }
  const y = 0.75 + h;
  B.lathe(0, 0, [[r - 0.2, y, K.STONE], [r + 0.3, y, K.STONE], [r + 0.3, y + 0.35, K.STONE], [r + 0.1, y + 0.45, K.METAL], [r * 0.7, y + 1.0, K.METAL], [r * 0.35, y + 1.9, K.METAL], [0.3, y + 2.4, K.METAL], [0.12, y + 2.9, K.METAL], [0, y + 3.1, K.METAL]], 8);
  if (!lod) B.box(-0.9, 0.9, r - 0.2, r + 1.4, -0.02, 0.37, K.STONE, K.PAVING);
  return 3.1 + y;
}

/** A pergola walk: a paved strip under a timber pergola, benches under it facing each other. */
function pergolaWalk(B, lod) {
  const L = 7, W = 2.1, H = 2.7;
  B.box(-W - 0.4, W + 0.4, -L - 0.4, L + 0.4, -0.02, 0.12, K.STONE, K.PAVING);
  for (let z = -L; z <= L + 1e-6; z += L / 3) for (const sx of [-1, 1]) B.box(sx * W - 0.12, sx * W + 0.12, z - 0.12, z + 0.12, 0.12, 0.12 + H, K.TIMBER, K.TIMBER);
  for (const sx of [-1, 1]) B.box(sx * W - 0.14, sx * W + 0.14, -L - 0.4, L + 0.4, 0.12 + H, 0.12 + H + 0.26, K.TIMBER, K.TIMBER);
  if (!lod) {
    for (let z = -L - 0.2; z <= L + 0.2 + 1e-6; z += (2 * L + 0.4) / 12) B.box(-W - 0.5, W + 0.5, z - 0.06, z + 0.06, 0.12 + H + 0.26, 0.12 + H + 0.42, K.TIMBER, K.TIMBER);
    // climbing roses in planters at the posts' feet, benches between them
    for (let z = -L; z <= L + 1e-6; z += L / 3) for (const sx of [-1, 1]) B.box(sx * W - 0.35 * sx - 0.25, sx * W - 0.35 * sx + 0.25, z + 0.18, z + 0.7, 0.12, 0.55, K.STONE, K.GARDEN);
    for (const zc of [-L / 2, L / 2]) for (const sx of [-1, 1]) {
      const x = sx * (W - 0.55);
      for (const dz of [-0.7, 0.7]) B.box(x - 0.2, x + 0.2, zc + dz - 0.1, zc + dz + 0.1, 0.12, 0.5, K.STONE, K.STONE);
      B.box(x - 0.24, x + 0.24, zc - 0.95, zc + 0.95, 0.5, 0.58, K.TIMBER, K.TIMBER);
    }
  }
  return 0.12 + H + 0.42;
}

/** A parterre: four beds in stone kerbs round a fountain basin at the crossing of their paths. */
function parterre(B, lod) {
  const r = 7.5;
  B.box(-r - 0.4, r + 0.4, -r - 0.4, r + 0.4, -0.02, 0.1, K.STONE, K.PAVING);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pts = [];
    const x0 = sx * 1.6, z0 = sz * 1.6, x1 = sx * r, z1 = sz * r;
    // an L-shaped bed cut by the round of the basin: a rectangle with its inner corner clipped
    pts.push([x0 + sx * 2.2, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0 + sz * 2.2]);
    B.prism(sx * sz > 0 ? pts.reverse() : pts, 0.1, 0.5, K.STONE, K.GARDEN);
    if (!lod) { const cx = (x0 + x1) / 2 + sx * 0.8, cz = (z0 + z1) / 2 + sz * 0.8; B.lathe(cx, cz, [[0.35, 0.5, K.STONE], [0.3, 0.9, K.STONE], [0.55, 1.1, K.GARDEN], [0.45, 1.6, K.GARDEN], [0, 1.8, K.GARDEN]], 8); }
  }
  B.lathe(0, 0, [[2.0, 0.1, K.STONE], [2.0, 0.6, K.STONE], [1.75, 0.6, K.STONE], [1.75, 0.42, K.POOL], [0.35, 0.42, K.POOL], [0.3, 1.1, K.STONE], [0.75, 1.25, K.METAL], [0.8, 1.32, K.METAL], [0.12, 1.36, K.METAL], [0.1, 1.8, K.METAL], [0, 1.95, K.METAL]], lod ? 12 : 28);
  return 1.95;
}

/** A playground: a sand court in a timber kerb, a swing frame, a slide on its tower, a see-saw. */
function playground(B, lod) {
  const r = 6.5;
  B.box(-r, r, -r * 0.8, r * 0.8, -0.02, 0.3, K.TIMBER, K.PAVING);
  if (lod) { B.box(-4.5, -1.5, -1.6, 1.6, 0.3, 2.5, K.METAL, K.METAL); B.box(1.5, 3.5, -1, 1, 0.3, 2.6, K.TIMBER, K.TIMBER); return 3; }
  // swings: an A-frame each end, a beam, two seats on chains
  for (const x of [-4.5, -1.5]) for (const sz of [-1, 1]) B.box(x - 0.07, x + 0.07, sz * 1.3 - 0.07, sz * 1.3 + 0.07, 0.3, 2.5, K.METAL, K.METAL);
  B.box(-4.6, -1.4, -0.08, 0.08, 2.5, 2.62, K.METAL, K.METAL);
  B.box(-4.6, -1.4, -1.38, 1.38, 2.5, 2.62, K.METAL, K.METAL);
  for (const x of [-3.7, -2.3]) {
    for (const dz of [-0.25, 0.25]) B.box(x - 0.015, x + 0.015, dz - 0.015, dz + 0.015, 0.75, 2.5, K.METAL, K.METAL);
    B.box(x - 0.25, x + 0.25, -0.3, 0.3, 0.7, 0.75, K.TIMBER, K.TIMBER);
  }
  // the slide tower: four posts, a deck, a roof, the chute down to the sand
  for (const [px, pz] of [[1.5, -1], [3.5, -1], [3.5, 1], [1.5, 1]]) B.box(px - 0.08, px + 0.08, pz - 0.08, pz + 0.08, 0.3, 3.0, K.TIMBER, K.TIMBER);
  B.box(1.4, 3.6, -1.1, 1.1, 1.6, 1.75, K.TIMBER, K.TIMBER);
  B.box(1.3, 3.7, -1.2, 1.2, 3.0, 3.12, K.TIMBER, K.TIMBER);
  B.face([[3.6, 1.75, -0.4], [3.6, 1.75, 0.4], [5.8, 0.45, 0.4], [5.8, 0.45, -0.4]], [0.51, 0.86, 0], K.METAL);
  B.face([[3.6, 1.6, -0.4], [5.8, 0.3, -0.4], [5.8, 0.3, 0.4], [3.6, 1.6, 0.4]], [-0.51, -0.86, 0], K.METAL);
  B.face([[3.6, 1.6, -0.4], [3.6, 1.75, -0.4], [5.8, 0.45, -0.4], [5.8, 0.3, -0.4]], [0, 0, -1], K.METAL);
  B.face([[3.6, 1.6, 0.4], [5.8, 0.3, 0.4], [5.8, 0.45, 0.4], [3.6, 1.75, 0.4]], [0, 0, 1], K.METAL);
  B.face([[3.6, 1.6, -0.4], [3.6, 1.6, 0.4], [3.6, 1.75, 0.4], [3.6, 1.75, -0.4]], [-1, 0, 0], K.METAL);
  B.face([[5.8, 0.3, -0.4], [5.8, 0.45, -0.4], [5.8, 0.45, 0.4], [5.8, 0.3, 0.4]], [1, 0, 0], K.METAL);
  // a see-saw on its pivot
  B.box(-0.15, 0.15, 3.2, 3.5, 0.3, 0.75, K.METAL, K.METAL);
  B.box(-2.1, 2.1, 3.25, 3.45, 0.75, 0.85, K.TIMBER, K.TIMBER);
  return 3.2;
}

/** A kitchen garden: rows of raised beds, a timber tool shed with a planted roof, a rain tank. */
function kitchenGarden(B, lod) {
  const hx = 7, hz = 5.5;
  B.box(-hx - 0.3, hx + 0.3, -hz - 0.3, hz + 0.3, -0.02, 0.1, K.STONE, K.PAVING);
  for (let i = 0; i < 4; i++) {
    const z = -hz + 1 + i * 2.6;
    B.box(-hx + 1, hx - 5, z, z + 1.4, 0.1, 0.6, K.TIMBER, K.GARDEN);
  }
  // the shed: timber walls, a planted mono-pitch roof slab, a door
  B.box(hx - 3.8, hx - 0.6, -hz + 0.8, -hz + 3.6, 0.1, 2.5, K.TIMBER, K.GARDEN);
  B.box(hx - 4.0, hx - 0.4, -hz + 0.6, -hz + 3.8, 2.5, 2.7, K.TIMBER, K.GARDEN);
  if (!lod) B.box(hx - 2.8, hx - 1.8, -hz + 3.6, -hz + 3.68, 0.1, 2.1, K.METAL, K.METAL);
  // the rain tank beside it
  B.lathe(hx - 2.2, hz - 2.0, [[1.0, 0.1, K.METAL], [1.0, 2.2, K.METAL], [1.05, 2.2, K.METAL], [0, 2.45, K.METAL]], lod ? 8 : 16);
  return 2.7;
}

/** A belvedere: a round stone terrace on the high ground, a balustrade round its rim, a small
 *  domed pavilion of six columns at its back and benches looking out. */
function belvedere(B, lod) {
  const r = 7.5;
  B.lathe(0, 0, [[r, -0.02, K.STONE], [r, 0.4, K.STONE], [0, 0.4, K.PAVING]], lod ? 16 : 40);
  if (!lod) {
    // the balustrade: balusters every 0.6 m round the rim (the entry gap facing the town) and a rail
    const n = Math.round((TAU * (r - 0.3)) / 0.6);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + Math.PI / 2;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a)) + Math.PI / 2) < 0.2) continue;   // the way in, from the town (-z)
      const x = Math.cos(a) * (r - 0.3), z = Math.sin(a) * (r - 0.3);
      B.lathe(x, z, [[0.09, 0.4, K.STONE], [0.12, 0.6, K.STONE], [0.07, 0.95, K.STONE], [0.09, 1.02, K.STONE]], 6);
    }
    B.lathe(0, 0, [[r - 0.45, 1.02, K.STONE], [r - 0.15, 1.02, K.STONE], [r - 0.15, 1.14, K.STONE], [r - 0.45, 1.14, K.STONE], [r - 0.45, 1.02, K.STONE]], 40);
  } else B.lathe(0, 0, [[r - 0.45, 0.4, K.STONE], [r - 0.15, 0.4, K.STONE], [r - 0.15, 1.1, K.STONE], [r - 0.45, 1.1, K.STONE], [r - 0.45, 0.4, K.STONE]], 16);
  // the pavilion at the back (toward the town, -z), the terrace open toward the view (+z)
  const pz = -r + 3.2, pr = 2.3;
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; column(B, Math.cos(a) * pr, pz + Math.sin(a) * pr, 0.14, 0.4, 3.6, lod); }
  B.lathe(0, pz, [[pr - 0.3, 3.6, K.STONE], [pr + 0.35, 3.6, K.STONE], [pr + 0.35, 3.95, K.STONE], [pr, 3.95, K.STONE], [pr * 0.8, 4.9, K.STONE], [pr * 0.45, 5.5, K.STONE], [0.2, 5.75, K.METAL], [0, 6.2, K.METAL]], lod ? 8 : 20);
  // benches before the pavilion looking out over the balustrade
  if (!lod) for (const x of [-2.4, 0, 2.4]) {
    const z = -0.4;
    for (const u of [-0.6, 0.6]) B.box(x + u - 0.1, x + u + 0.1, z - 0.1, z + 0.1, 0.4, 0.82, K.STONE, K.STONE);
    B.box(x - 0.85, x + 0.85, z - 0.22, z + 0.22, 0.82, 0.9, K.TIMBER, K.TIMBER);
  }
  return 6.2;
}

/** A fountain court: a round basin with a bronze bowl, four benches round it facing in. */
function fountainCourt(B, lod) {
  B.lathe(0, 0, [[2.3, -0.02, K.STONE], [2.3, 0.5, K.STONE], [2.45, 0.55, K.STONE], [2.45, 0.62, K.STONE], [2.1, 0.62, K.STONE], [2.1, 0.42, K.POOL], [0.4, 0.42, K.POOL],
    [0.35, 0.9, K.STONE], [0.28, 1.2, K.STONE], [0.85, 1.35, K.METAL], [0.92, 1.44, K.METAL], [0.12, 1.47, K.METAL], [0.1, 2.0, K.METAL], [0, 2.15, K.METAL]], lod ? 12 : 28);
  if (!lod) for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU, x = Math.cos(a) * 3.9, z = Math.sin(a) * 3.9;
    // a bench on the circle, its seat along the tangent (legs radial pairs)
    const tx = -Math.sin(a), tz = Math.cos(a);
    for (const u of [-0.65, 0.65]) { const px = x + tx * u, pz = z + tz * u; B.box(px - 0.11, px + 0.11, pz - 0.11, pz + 0.11, -0.02, 0.42, K.STONE, K.STONE); }
    const hx = Math.abs(tx) * 0.9 + Math.abs(tz) * 0.23, hz = Math.abs(tz) * 0.9 + Math.abs(tx) * 0.23;
    B.box(x - hx, x + hx, z - hz, z + hz, 0.42, 0.5, K.TIMBER, K.TIMBER);
  }
  return 2.15;
}

/** A tree seat: a ring bench of stone round a planted bed, a tree growing from its heart. */
function treeSeat(B, lod) {
  B.lathe(0, 0, [[2.2, -0.02, K.STONE], [2.2, 0.42, K.STONE], [2.28, 0.42, K.STONE], [2.28, 0.5, K.TIMBER], [1.5, 0.5, K.TIMBER], [1.5, 0.3, K.GARDEN], [0, 0.3, K.GARDEN]], lod ? 10 : 24);
  return 0.5;
}

/** A garden café: a round glass kiosk under a broad thin roof on slender posts, tables round it. */
function cafePavilion(B, lod) {
  const r = 2.6, R = 4.4, H = 3.1;
  B.lathe(0, 0, [[r, -0.02, K.GLASS], [r, H, K.GLASS], [r + 0.1, H, K.STONE], [0, H, K.STONE]], lod ? 10 : 24);
  B.lathe(0, 0, [[R, H, K.STONE], [R, H + 0.22, K.STONE], [R - 0.3, H + 0.3, K.STONE], [0, H + 0.34, K.PV]], lod ? 12 : 32);
  const n = 8;
  for (let k = 0; k < n; k++) { const a = (k / n) * TAU; const x = Math.cos(a) * (R - 0.35), z = Math.sin(a) * (R - 0.35); B.box(x - 0.06, x + 0.06, z - 0.06, z + 0.06, -0.02, H, K.METAL, K.METAL); }
  if (!lod) for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + 0.5, x = Math.cos(a) * (R + 1.3), z = Math.sin(a) * (R + 1.3);
    B.lathe(x, z, [[0.25, -0.02, K.METAL], [0.05, 0.1, K.METAL], [0.04, 0.7, K.METAL], [0.4, 0.72, K.TIMBER], [0.4, 0.76, K.TIMBER], [0, 0.76, K.TIMBER]], 10);
    for (const da of [-0.9, 0.9]) {
      const cx = x + Math.cos(a + da) * 0.75, cz = z + Math.sin(a + da) * 0.75;
      B.box(cx - 0.2, cx + 0.2, cz - 0.2, cz + 0.2, -0.02, 0.45, K.TIMBER, K.TIMBER);
    }
  }
  return H + 0.34;
}

/** A sculpture: a bronze form of stacked, turning discs on a stone plinth. */
function sculpture(B, lod) {
  B.box(-0.9, 0.9, -0.9, 0.9, -0.02, 0.9, K.STONE, K.STONE);
  B.lathe(0, 0, [[0.5, 0.9, K.METAL], [0.2, 1.4, K.METAL], [0.75, 2.1, K.METAL], [0.25, 2.8, K.METAL], [0.55, 3.3, K.METAL], [0, 3.9, K.METAL]], lod ? 8 : 16);
  return 3.9;
}

const DESIGNS = {
  bandstand: { R: 5.4, build: bandstand, square: false },
  fountain: { R: 5.2, build: fountainCourt, square: false },
  treeSeat: { R: 3.6, build: treeSeat, square: false, tree: true },
  cafe: { R: 6.5, build: cafePavilion, square: false },
  sculpture: { R: 2.4, build: sculpture, square: false },
  pergola: { build: pergolaWalk, square: true, hx: 2.6, hz: 7.5 },
  parterre: { build: parterre, square: true, hx: 7.9, hz: 7.9 },
  playground: { build: playground, square: true, hx: 6.5, hz: 5.2 },
  kitchen: { build: kitchenGarden, square: true, hx: 7.3, hz: 5.8 },
  belvedere: { R: 8.0, build: belvedere, square: false },
};
// a square design needs the circle round its footing course (0.4 m beyond it) clear
for (const D of Object.values(DESIGNS)) if (D.square) D.R = Math.hypot(D.hx + 0.4, D.hz + 0.4) + 0.3;

/** The work that draws a garden piece at (x, z) turned by yaw, seated on its ground. */
function gardenWork(S, x, z, yaw, name, district) {
  const D = DESIGNS[name];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let lo = Infinity, hi = -Infinity;
  const ex = D.square ? D.hx + 0.4 : D.R - 0.4, ez = D.square ? D.hz + 0.4 : D.R - 0.4;
  for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
    const lx = (i / 5) * ex, lz = (j / 5) * ez;
    if (!D.square && Math.hypot(lx, lz) > D.R) continue;
    const g = S.ground(x + lx * c + lz * s, z - lx * s + lz * c);
    lo = Math.min(lo, g); hi = Math.max(hi, g);
  }
  const top = hi + 0.05, foot = lo - top - 0.6;
  return {
    district, x, z, r: D.R, kind: `garden:${name}`, lo, hi,
    build(B, lod) {
      // the ground course: a stone footing from below the lowest ground up to the level
      B.frame(x, top, z, yaw);
      if (D.square) B.box(-ex, ex, -ez, ez, foot, 0, K.STONE, K.PAVING);
      else B.lathe(0, 0, [[D.R - 0.4, foot, K.STONE], [D.R - 0.4, 0, K.STONE], [0, 0, K.PAVING]], lod ? 12 : 32);
      D.build(B, lod);
    },
  };
}

// ------------------------------------------------------------------ plan --
export function planGardens(S, out) {
  const plan = S.plan, F = plan.field;
  const stats = { gardens: 0, belvederes: 0, trees: 0, benches: 0, byKind: {} };
  // lots near a point: the distance from it to their podium and apron (buildings.js), metres
  const lotDist = (x, z, cap) => {
    let d = cap;
    for (const L of S._near(S.lots, x, z, cap + 30)) {
      const c = Math.cos(L.rot), s = Math.sin(L.rot), dx = x - L.x, dz = z - L.z;
      const u = Math.abs(dx * c - dz * s) - (L.w / 2 + 0.6), v0 = dx * s + dz * c;
      const vlo = -L.d / 2 - 0.6, vhi = L.d / 2 + 3.3;
      const v = v0 < vlo ? vlo - v0 : v0 > vhi ? v0 - vhi : 0;
      d = Math.min(d, Math.hypot(Math.max(u, 0), v));
    }
    return d;
  };
  const room = (x, z, cap) => {
    let r = Math.min(cap, F.edge(x, z) - 2.0);
    if (r <= 0) return 0;
    r = Math.min(r, lotDist(x, z, r + 1.5) - 1.5);
    for (const q of S.squaresAt(x, z, r + 2)) r = Math.min(r, Math.hypot(q.x - x, q.z - z) - q.r - 2);
    for (const l of S._near(S.lamps, x, z, r + 2)) r = Math.min(r, Math.hypot(l.x - x, l.z - z) - 1.4);
    for (const t of S.towers) r = Math.min(r, Math.hypot(t.x - x, t.z - z) - t.base - 8);
    for (const st of S.stations) r = Math.min(r, Math.hypot(st.x - x, st.z - z) - (st.r || 40) - 6);
    for (const o of S._near(S.occ, x, z, r + 30)) r = Math.min(r, Math.hypot(o.x - x, o.z - z) - o.r - 1);
    for (const p of plan.civicParks || []) r = Math.min(r, Math.hypot(p.x - x, p.z - z) - p.landmarkR - 8);
    return r;
  };
  for (const isl of ISLANDS) {
    const [sp, ts] = ISLAND_TREE[isl.id] || ['flowering', 7.5];
    const cr = CROWN[sp] * ts * 0.5;
    // candidate sites on a 5 m grid over the island: the room each leaves (to 14 m)
    const cand = [];
    for (let x = isl.x - isl.r * 1.05; x <= isl.x + isl.r * 1.05; x += 5) for (let z = isl.z - isl.r * 1.05; z <= isl.z + isl.r * 1.05; z += 5) {
      const dc = Math.hypot(x - isl.x, z - isl.z);
      if (dc > isl.r * 1.05) continue;
      const g = S.ground(x, z);
      if (g < 3.0) continue;
      const r = room(x, z, 14);
      if (r >= 5.8) cand.push({ x, z, r, g, dc });
    }
    // ---- belvederes on the green belt: the highest open ground beyond the outer esplanade
    const belt = cand.filter((c) => c.dc > isl.r * 0.84 && c.r >= DESIGNS.belvedere.R + 2).sort((a, b) => b.g - a.g);
    const bel = [];
    for (const c of belt) {
      if (bel.length >= 3) break;
      if (bel.some((b) => Math.hypot(b.x - c.x, b.z - c.z) < isl.r * 0.9)) continue;
      const R = DESIGNS.belvedere.R;
      if (room(c.x, c.z, 14) < R + 1.5) continue;
      const gr = S.groundRange(c.x, c.z, R);
      if (gr.hi - gr.lo > 1.6 || S.headroom(c.x, c.z, R) < 20) continue;
      // facing out: the terrace's open side toward the lagoon (away from the island's heart)
      const yaw = Math.atan2(c.x - isl.x, c.z - isl.z);
      out.works.push(gardenWork(S, c.x, c.z, yaw, 'belvedere', isl.id));
      S.claim(c.x, c.z, R + 1, 'belvedere');
      out.sites.push({ x: c.x, z: c.z, r: R, color: [230, 120, 20] });
      bel.push(c);
      stats.belvederes++;
    }
    // ---- garden rooms in the lawns: the roomiest first, each a design that fits its room
    cand.sort((a, b) => b.r - a.r);
    const order = ['parterre', 'playground', 'cafe', 'kitchen', 'fountain', 'pergola', 'bandstand', 'treeSeat', 'playground', 'fountain', 'kitchen', 'cafe', 'sculpture', 'pergola', 'bandstand', 'treeSeat'];
    let k = 0, n = 0;
    const maxN = Math.round(isl.r / 26), placed = [];
    for (const c of cand) {
      if (n >= maxN) break;
      // spread through the town: no two garden rooms within 38 m
      if (placed.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 38)) continue;
      const r = room(c.x, c.z, 14);
      // the design: the next in turn that fits (with a ring of trees round it where there is room)
      let name = null;
      for (let t = 0; t < order.length; t++) {
        const nm = order[(k + t) % order.length];
        if (DESIGNS[nm].R + 0.8 <= r) { name = nm; k += t + 1; break; }
      }
      if (!name) continue;
      const D = DESIGNS[name];
      const gr = S.groundRange(c.x, c.z, D.R);
      if (gr.lo < 2.8 || gr.hi - gr.lo > 1.2 || S.headroom(c.x, c.z, D.R) < 25) continue;
      // turned square to the nearest street (its kerb's frame): along the gradient of the field
      const e0 = F.edge(c.x, c.z), gx = F.edge(c.x + 1, c.z) - e0, gz = F.edge(c.x, c.z + 1) - e0;
      const yaw = Math.atan2(-gx, -gz);
      out.works.push(gardenWork(S, c.x, c.z, yaw, name, isl.id));
      S.claim(c.x, c.z, D.R + 0.6, 'garden');
      out.sites.push({ x: c.x, z: c.z, r: D.R, color: [250, 170, 40] });
      stats.byKind[name] = (stats.byKind[name] || 0) + 1;
      stats.gardens++; n++; placed.push(c);
      if (D.tree) {
        const top = out.works[out.works.length - 1].hi + 0.05;
        out.trees.push({ x: c.x, z: c.z, y: Math.min(top + 0.18, S.ground(c.x, c.z) + 0.55), sp, s: ts * 1.05 });
      }
      // trees round it (their crowns may shade it; their trunks keep clear of everything)
      const rt = D.R + 3.3, m = Math.max(4, Math.floor((TAU * rt) / Math.max(6.5, cr * 1.4)));
      for (let i = 0; i < m; i++) {
        const a = yaw + (i / m) * TAU + 0.3, x = c.x + Math.cos(a) * rt, z = c.z + Math.sin(a) * rt;
        if (room(x, z, 4) < 1.6 || S.discInLot(x, z, Math.min(cr, 3.5), 0.6) || !S.towerClear(x, z, cr, 2) || S.lampNear(x, z, Math.max(2.2, cr * 0.8 + 0.3))) continue;
        const g = S.groundRange(x, z, 0.8);
        if (g.lo < 2 || S.headroom(x, z, cr) < ts + 2) continue;
        out.trees.push({ x, z, y: g.lo - 0.15, sp, s: ts * (0.9 + ((i * 0.37) % 0.2)) });
        S.claim(x, z, Math.max(cr * 0.8, 1.6), 'tree');
        stats.trees++;
      }
    }
  }
  return stats;
}
