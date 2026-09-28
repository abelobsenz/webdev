import { FAR_ISLANDS } from './terrain.js';
import { renderedHeight, outerCities } from './outerCities.js';
import { SPECIES, SP } from './treeGeometry.js';
import { mulberry32 } from './noise.js';

// Woods on the far islands (21-36 km out). The heights carry them: closed broadleaf woods on
// the summits and upper slopes, rain trees round their margins and out along the ridges,
// Norfolk pines standing proud on the exposed crowns, and clearings where the grove noise
// thins. A coarse height grid (64 m) scores every site for elevation, convexity (hilltops,
// ridge crests) and slope; a fixed budget per island (a few thousand trees) is shared out over
// the best of them. Every trunk is rooted at the lowest point of the drawn surface
// (renderedHeight) under its root flare, never in the water, never on a cliff, and kept off
// the island cities (streets, harbours, villas, farms) via the skyline's footprint query.
// Records carry far: true so TreeField shows them at island range.

const CELL = 64;
const hash = (i, j, s) => { const v = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
function vnoise(x, z, s) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const crownR = (sp, s) => SPECIES[sp].shape[2] * s * 0.5;

/** isFree(x, z, r): false where the island cities, harbours or villas stand. */
export function planIslandTrees(isFree = () => true) {
  const oc = outerCities();
  const trees = [];
  const OG = 24, occ = new Map();
  const near = (x, z, r) => {
    const cx = Math.floor(x / OG), cz = Math.floor(z / OG), span = Math.ceil((r + 16) / OG);
    for (let dx = -span; dx <= span; dx++) for (let dz = -span; dz <= span; dz++) {
      const l = occ.get((cx + dx) * 65536 + (cz + dz));
      if (l) for (const o of l) if (Math.hypot(o.x - x, o.z - z) < 0.46 * (o.r + r)) return true;
    }
    return false;
  };
  const occupy = (x, z, r) => { const k = Math.floor(x / OG) * 65536 + Math.floor(z / OG); if (!occ.has(k)) occ.set(k, []); occ.get(k).push({ x, z, r }); };

  FAR_ISLANDS.forEach(([ix, iz], n) => {
    const city = oc.islands.find((c) => c.island === n);
    const E = Math.min(9000, (city ? city.coast.s : 4000) * 1.1);
    const rnd = mulberry32(4100 + n * 31);
    const M = Math.ceil((2 * E) / CELL) + 1, x0 = ix - E, z0 = iz - E;
    const H = new Float32Array(M * M).fill(-50);
    let top = 1;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const x = x0 + i * CELL, z = z0 + j * CELL;
      if (Math.hypot(x - ix, z - iz) > E + CELL * 5) continue;
      const h = renderedHeight(x, z);
      H[j * M + i] = h;
      if (h > top) top = h;
    }
    // site score per cell
    const R4 = 4, D = new Float32Array(M * M), info = new Float32Array(M * M * 2);
    let sum = 0;
    for (let j = R4; j < M - R4; j++) for (let i = R4; i < M - R4; i++) {
      const k = j * M + i, h = H[k];
      if (h < 16 || Math.hypot(x0 + i * CELL - ix, z0 + j * CELL - iz) > E) continue;
      const sl = Math.hypot(H[k + 1] - H[k - 1], H[k + M] - H[k - M]) / (2 * CELL);
      if (sl > 0.8) continue;                                    // cliffs and scarps stay bare
      let ring = 0;
      for (let a = 0; a < 8; a++) {
        const di = Math.round(Math.cos(a * Math.PI / 4) * R4), dj = Math.round(Math.sin(a * Math.PI / 4) * R4);
        ring += H[(j + dj) * M + i + di];
      }
      const rel = h - ring / 8;                                   // > 0 on hilltops and ridge crests
      const elev = h / top;
      const heights = sstep(0.3, 0.72, elev) * (0.6 + 0.4 * sstep(-4, 14, rel));
      const crest = sstep(3, 20, rel) * sstep(0.1, 0.3, elev) * 0.8;
      const site = Math.max(heights, crest) * (1 - sstep(0.5, 0.8, sl));
      if (site < 0.05) continue;
      const x = x0 + i * CELL, z = z0 + j * CELL;
      const g = 0.62 * vnoise(x / 560, z / 560, n) + 0.38 * vnoise(x / 180, z / 180, n + 7);
      const wood = sstep(0.7 - 0.08 * site, 0.75 - 0.08 * site, g);   // groves and clearings, denser up high
      const d = site * wood;
      if (d < 0.03 || !isFree(x, z, 20)) continue;          // budget only where trees may stand
      D[k] = d; info[k * 2] = elev; info[k * 2 + 1] = rel;
      sum += Math.pow(d, 4);
    }
    if (sum <= 0) return;
    // share the island's budget out over the cells: k * d^4 trees each (dense groves, not a scatter), at most CAP
    const target = Math.min(4200, Math.round(E * 0.55)), CAP = 15;
    let lo = 0, hi = (target / sum) * 1000;
    for (let it = 0; it < 24; it++) {
      const kk = (lo + hi) / 2;
      let tot = 0;
      for (let k = 0; k < D.length; k++) if (D[k] > 0) tot += Math.min(CAP, kk * Math.pow(D[k], 4));
      if (tot > target) hi = kk; else lo = kk;
    }
    let made = 0;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const k = j * M + i, d = D[k];
      if (!d) continue;
      const elev = info[k * 2], rel = info[k * 2 + 1];
      const want = Math.floor(Math.min(CAP, lo * Math.pow(d, 4)) + rnd());
      for (let t = 0, tries = 0; t < want && tries < want * 6; tries++) {
        const x = x0 + (i + rnd() - 0.5) * CELL, z = z0 + (j + rnd() - 0.5) * CELL;
        const q = rnd();
        const exposed = elev > 0.84 || (rel > 26 && elev > 0.6);
        let sp, s;
        if (exposed && q < 0.5) { sp = SP.araucaria; s = 18 + rnd() * 12; }
        else if (d > 0.5) {
          if (q < 0.06) { sp = SP.banyan; s = 19 + rnd() * 7; }
          else if (q < 0.62) { sp = rnd() < 0.5 ? SP.forest : SP.forestBroad; s = 18 + rnd() * 11; }
          else { sp = SP.rainTree; s = 14 + rnd() * 5; }
        } else if (q < 0.55) { sp = SP.rainTree; s = 12 + rnd() * 5; }
        else if (q < 0.8) { sp = SP.flowering; s = 9 + rnd() * 3; }
        else { sp = SP.forestBroad; s = 15 + rnd() * 7; }
        const cr = crownR(sp, s);
        if (near(x, z, cr)) continue;
        if (!isFree(x, z, cr + 6)) continue;
        // root at the lowest drawn ground under the flare; no water, no cliff
        const fr = sp === SP.banyan ? 3.5 : Math.max(1.2, s * 0.06);
        let yMin = renderedHeight(x, z), yMax = yMin;
        for (let a = 0; a < 4; a++) {
          const h = renderedHeight(x + Math.cos(a * 1.5708 + 0.4) * fr, z + Math.sin(a * 1.5708 + 0.4) * fr);
          yMin = Math.min(yMin, h); yMax = Math.max(yMax, h);
        }
        if (yMin < 3 || (yMax - yMin) / (2 * fr) > 0.85) continue;
        const v = 0.85 + rnd() * 0.3;
        trees.push({ x, y: yMin - 0.15, z, s, sp, rot: rnd() * Math.PI * 2, lean: rnd() * 0.05,
          tint: [v * (0.9 + rnd() * 0.16), v * (0.92 + rnd() * 0.16), v * (0.88 + rnd() * 0.14)], far: true });
        occupy(x, z, cr);
        t++; made++;
      }
    }
  });
  return trees;
}
