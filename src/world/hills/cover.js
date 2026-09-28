import * as THREE from 'three';
import { renderedHeight } from '../outerCities.js';
import { INNER } from '../terrain.js';
import { wardHeight } from '../metro.js';

// The land cover of the northern mainland (the massif, its hill country and Mount Anchor):
// where the woods grow, where the ground is cultivable, where the alpine meadows and the bare
// rock of the peaks begin. One deterministic habitat function drives everything that follows
// (the woods' trees in woods.js, the terrain shader's forest floor, rock and meadow through
// the cover texture), so what is drawn on the ground always agrees with what stands on it.
//
// The habitat reads a 40 m survey of the drawn surface (renderedHeight): elevation, slope,
// curvature (a gully sits below the mean of its surroundings, a crest above it) and aspect,
// broken up by slow noise into woods, woodlots, clearings and glades.
//
// The built fabric already standing on this land (hill country, massif towns, gondolas and
// anything else) is surveyed from its real triangles into a sparse 4 m occupancy raster, so
// nothing is planted into a wall, a road, a field or a house.

export const HILL = { x0: -30000, x1: 17000, z0: -27500, z1: -1400, G: 40 };
HILL.NX = Math.round((HILL.x1 - HILL.x0) / HILL.G) + 1;
HILL.NZ = Math.round((HILL.z1 - HILL.z0) / HILL.G) + 1;

export const sstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
export const hash2 = (i, j, s = 0) => {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const vn = (x, z, s) => {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
export const vnoise = vn;

/** Is (x, z) part of the northern mainland this cover describes? (Not the inner atoll grid.) */
export function inHills(x, z) {
  return x > HILL.x0 && x < HILL.x1 && z > HILL.z0 && z < HILL.z1 && Math.max(Math.abs(x), Math.abs(z)) > INNER.half + 200;
}

let SURVEY = null;
/** The 40 m survey of the drawn surface: heights, then slope and curvature per node. */
export function hillSurvey() {
  if (SURVEY) return SURVEY;
  const { x0, z0, G, NX, NZ } = HILL;
  const H = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = x0 + i * G, z = z0 + j * G;
    H[j * NX + i] = Math.max(Math.abs(x), Math.abs(z)) < INNER.half + 100 ? -20 : renderedHeight(x, z);
  }
  const at = (i, j) => H[Math.min(NZ - 1, Math.max(0, j)) * NX + Math.min(NX - 1, Math.max(0, i))];
  const S = new Float32Array(NX * NZ), K = new Float32Array(NX * NZ), GX = new Float32Array(NX * NZ), GZ = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, gx = (at(i + 1, j) - at(i - 1, j)) / (2 * G), gz = (at(i, j + 1) - at(i, j - 1)) / (2 * G);
    GX[k] = gx; GZ[k] = gz; S[k] = Math.hypot(gx, gz);
    // curvature: the node against the mean of a 120 m ring (+ crest, - gully)
    let ring = 0;
    for (let a = 0; a < 8; a++) ring += at(i + Math.round(Math.cos(a * Math.PI / 4) * 3), j + Math.round(Math.sin(a * Math.PI / 4) * 3));
    K[k] = H[k] - ring / 8;
  }
  SURVEY = { H, S, K, GX, GZ };
  return SURVEY;
}

/** Bilinear survey values at (x, z): [height, slope, curvature, gx, gz]. */
const _sv = new Float64Array(5);
export function surveyAt(x, z) {
  const { x0, z0, G, NX, NZ } = HILL, sv = hillSurvey();
  const u = Math.min(NX - 1.001, Math.max(0, (x - x0) / G)), v = Math.min(NZ - 1.001, Math.max(0, (z - z0) / G));
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * NX + i;
  const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
  const arrs = [sv.H, sv.S, sv.K, sv.GX, sv.GZ];
  for (let q = 0; q < 5; q++) { const A = arrs[q]; _sv[q] = A[k] * w00 + A[k + 1] * w10 + A[k + NX] * w01 + A[k + NX + 1] * w11; }
  return _sv;
}

// the woods have edges: the stand density closes the canopy inside a wood and thins to a margin
export const standDensity = (w) => sstep(0.16, 0.62, w);

// Species indices follow treeGeometry.js SPECIES.
export const SPC = { forest: 0, forestBroad: 1, rainTree: 2, flowering: 3, palm: 4, treeFern: 5, bamboo: 6, banyan: 8, araucaria: 9 };

/**
 * The habitat at (x, z). Returns the shared scratch object:
 *  wood   0..1 density of the woods (closed canopy at 1)
 *  zone   0 lowland, 1 hill, 2 cloud forest, 3 upper montane
 *  gully, crest  0..1
 *  meadow 0..1 alpine meadow and heath above the tree line
 *  rock   0..1 bare rock and scree of the peaks
 *  h, s   elevation, slope
 */
const HAB = { wood: 0, zone: 0, gully: 0, crest: 0, meadow: 0, rock: 0, h: 0, s: 0, open: 0 };
let VILLAGES = [];
// the cultivated ground laid by the builders (terraces, fields): no woods there
let CULT = null;
/** Marks the survey nodes within pad of the convex polygon q as cultivated (the woods avoid them). */
export function markCultivated(q, pad = 0) {
  const { x0, z0, G, NX, NZ } = HILL;
  if (!CULT) CULT = new Float32Array(NX * NZ);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of q) { a0 = Math.min(a0, p[0]); a1 = Math.max(a1, p[0]); b0 = Math.min(b0, p[1]); b1 = Math.max(b1, p[1]); }
  const area = q.reduce((s, a, k) => { const b = q[(k + 1) % q.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0), sg = area > 0 ? 1 : -1;
  for (let j = Math.max(0, Math.floor((b0 - pad - z0) / G)); j <= Math.min(NZ - 1, Math.ceil((b1 + pad - z0) / G)); j++)
    for (let i = Math.max(0, Math.floor((a0 - pad - x0) / G)); i <= Math.min(NX - 1, Math.ceil((a1 + pad - x0) / G)); i++) {
      const px = x0 + i * G, pz = z0 + j * G;
      let inside = true;
      for (let k = 0; k < q.length && inside; k++) {
        const a = q[k], b = q[(k + 1) % q.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        if (sg * ((b[0] - a[0]) * (pz - a[1]) - (b[1] - a[1]) * (px - a[0])) / L < -pad) inside = false;
      }
      if (inside) CULT[j * NX + i] = 1;
    }
}
function cultAt(x, z) {
  if (!CULT) return 0;
  const { x0, z0, G, NX, NZ } = HILL;
  const u = Math.min(NX - 1.001, Math.max(0, (x - x0) / G)), v = Math.min(NZ - 1.001, Math.max(0, (z - z0) / G));
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * NX + i;
  return CULT[k] * (1 - fu) * (1 - fv) + CULT[k + 1] * fu * (1 - fv) + CULT[k + NX] * (1 - fu) * fv + CULT[k + NX + 1] * fu * fv;
}
/** Village sites [{x, z, r}]: the gentle ground round them is kept open for pasture and fields. */
export function setHabitatVillages(list) { VILLAGES = list; }
export function habitat(x, z) {
  const sv = surveyAt(x, z), h = sv[0], s = sv[1], k = sv[2];
  HAB.h = h; HAB.s = s; HAB.wood = 0; HAB.meadow = 0; HAB.rock = 0; HAB.gully = 0; HAB.crest = 0; HAB.open = 0;
  if (h < 3) { HAB.zone = 0; return HAB; }
  const nL = vn(x / 1150, z / 1150, 11), nM = vn(x / 420, z / 420, 12), nS = vn(x / 170, z / 170, 13);
  const gully = sstep(1.5, 9, -k) * sstep(0.05, 0.2, s), crest = sstep(4, 16, k);
  HAB.gully = gully; HAB.crest = crest;
  // the tree line wanders with the noise and climbs the sheltered gullies
  const tl = 1560 + (nM - 0.5) * 260 + gully * 120 - crest * 90;
  const alpine = sstep(tl - 120, tl + 80, h);
  const steep = sstep(0.17, 0.4, s);
  const cliff = sstep(0.95, 1.45, s);
  const lowland = 1 - sstep(70, 240, h);
  const montane = sstep(560, 820, h);
  // woodlots and copses on the gentle farmed ground, closed woods where it is too steep to farm,
  // in every gully, and over the whole cloud-forest belt
  const woodlot = sstep(0.56, 0.7, nL * 0.65 + nM * 0.35) * (0.75 + 0.25 * nS);
  let w = Math.max(steep * (0.72 + 0.28 * nM), gully * 0.95, montane * 0.9, woodlot);
  w *= 1 - lowland * 0.55 * (1 - gully) * (1 - steep);
  // glades and clearings in the woods (rarer in the cloud forest)
  const glade = sstep(0.62, 0.74, vn(x / 260, z / 260, 14)) * (1 - 0.6 * montane);
  w *= 1 - glade * 0.85;
  // the crests thin out; cliffs stay bare; above the tree line only krummholz
  w *= 1 - crest * 0.35;
  w *= 1 - cliff;
  w *= 1 - alpine * 0.93;
  // the strand and the first metres above it stay open
  w *= sstep(4, 14, h);
  // pasture and fields round the villages: open on the gentle ground
  for (const v of VILLAGES) {
    const d = Math.hypot(x - v.x, z - v.z);
    if (d < v.r + 900) w *= 1 - (1 - sstep(v.r + 180, v.r + 800, d)) * (1 - steep * 0.7) * 0.9;
  }
  w *= 1 - cultAt(x, z);
  HAB.wood = Math.max(0, Math.min(1, w));
  HAB.zone = h < 260 ? 0 : h < 760 ? 1 : h < 1380 ? 2 : 3;
  HAB.meadow = alpine * (1 - cliff * 0.8);
  HAB.rock = Math.max(cliff * sstep(200, 700, h), sstep(tl + 160, tl + 420, h + (nS - 0.5) * 140) * (0.55 + 0.45 * sstep(0.3, 0.8, s)));
  HAB.open = (1 - HAB.wood) * (1 - steep) * (1 - alpine);
  return HAB;
}

// ------------------------------------------------------------------ cover texture --
/** Uniforms read by the terrain shader (terrainShading.js) over the northern mainland. */
const EMPTY = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
EMPTY.needsUpdate = true;
export const HILL_U = {
  uHillCover: { value: EMPTY },
  uHillBox: { value: new THREE.Vector4(HILL.x0, HILL.z0, 1 / (HILL.x1 - HILL.x0), 1 / (HILL.z1 - HILL.z0)) },
};

/**
 * The cover texture (one texel per survey node): R woods density, G bare rock and scree,
 * B alpine meadow, A 1 on the mainland (0 outside it, where the shader keeps its own rules).
 */
export function buildCoverTexture() {
  const { x0, z0, G, NX, NZ } = HILL;
  const data = new Uint8Array(NX * NZ * 4);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = x0 + i * G, z = z0 + j * G, o = (j * NX + i) * 4;
    if (!inHills(x, z)) continue;
    const hb = habitat(x, z);
    data[o] = Math.round(standDensity(hb.wood) * 255);
    data[o + 1] = Math.round(hb.rock * 255);
    data[o + 2] = Math.round(hb.meadow * 255);
    data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, NX, NZ, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  HILL_U.uHillCover.value = tex;
  // texel centres: node (i, j) at uv = (i + 0.5) / NX
  HILL_U.uHillBox.value.set(x0 - G / 2, z0 - G / 2, 1 / (NX * G), 1 / (NZ * G));
  return tex;
}

// -------------------------------------------------------------- built occupancy --
// Flags per 4 m cell: FLAT a finish on the ground (road, field, yard), LOW a solid near the
// ground (wall, hedge, kerb, vine row, plinth), TALL a building, terrace, pylon or station,
// CLEAR a reserved clearing (gondola corridors, round the towns: no trees there), HOME the
// garden round a country house (planted trees only), TREE a planted tree.
export const OCC = { FLAT: 1, LOW: 2, TALL: 4, CLEAR: 8, TREE: 16, HOME: 32, CROP: 64 };
const OC = 4, OT = 64;                         // 4 m cells in 256 m tiles
export class Occupancy {
  constructor() { this.tiles = new Map(); }
  _tile(ti, tj, make) {
    const key = ti * 65536 + tj;
    let t = this.tiles.get(key);
    if (!t && make) { t = new Uint8Array(OT * OT); this.tiles.set(key, t); }
    return t;
  }
  get(x, z) {
    const i = Math.floor(x / OC), j = Math.floor(z / OC), t = this._tile(Math.floor(i / OT), Math.floor(j / OT), false);
    return t ? t[(j - Math.floor(j / OT) * OT) * OT + (i - Math.floor(i / OT) * OT)] : 0;
  }
  /** Marks the cells overlapping the box [x0, x1] x [z0, z1] with flag f. */
  box(x0, z0, x1, z1, f) {
    const i0 = Math.floor(x0 / OC), i1 = Math.floor(x1 / OC), j0 = Math.floor(z0 / OC), j1 = Math.floor(z1 / OC);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400000) return;   // a stray giant box (a sky element): not ground occupancy
    for (let j = j0; j <= j1; j++) {
      const tj = Math.floor(j / OT), lj = j - tj * OT;
      for (let i = i0; i <= i1; i++) {
        const ti = Math.floor(i / OT), t = this._tile(ti, tj, true);
        t[lj * OT + (i - ti * OT)] |= f;
      }
    }
  }
  circle(x, z, r, f) {
    const i0 = Math.floor((x - r) / OC), i1 = Math.floor((x + r) / OC), j0 = Math.floor((z - r) / OC), j1 = Math.floor((z + r) / OC);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * OC - x, cz = (j + 0.5) * OC - z;
      if (cx * cx + cz * cz > (r + OC * 0.71) * (r + OC * 0.71)) continue;
      const tj = Math.floor(j / OT), ti = Math.floor(i / OT), t = this._tile(ti, tj, true);
      t[(j - tj * OT) * OT + (i - ti * OT)] |= f;
    }
  }
  /** Calls fn(tile, offset) for every cell whose centre lies in the convex polygon q grown by pad. */
  _poly(q, pad, fn, make) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of q) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const area = q.reduce((s, a, k) => { const b = q[(k + 1) % q.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0), sg = area > 0 ? 1 : -1;
    const E = q.map((a, k) => { const b = q[(k + 1) % q.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [a[0], a[1], (b[0] - a[0]) / L, (b[1] - a[1]) / L]; });
    const m = pad + OC * 0.71;
    for (let j = Math.floor((z0 - m) / OC); j <= Math.floor((z1 + m) / OC); j++) for (let i = Math.floor((x0 - m) / OC); i <= Math.floor((x1 + m) / OC); i++) {
      const px = (i + 0.5) * OC, pz = (j + 0.5) * OC;
      let inside = true;
      for (const [ax, az, tx, tz] of E) if (sg * (tx * (pz - az) - tz * (px - ax)) < -m) { inside = false; break; }
      if (!inside) continue;
      const tj = Math.floor(j / OT), ti = Math.floor(i / OT), t = this._tile(ti, tj, make);
      if (fn(t, (j - tj * OT) * OT + (i - ti * OT)) === false) return false;
    }
    return true;
  }
  /** Is the convex polygon q (grown by pad) free of the flags in mask? */
  polyFree(q, pad, mask) { return this._poly(q, pad, (t, o) => (t && (t[o] & mask) ? false : undefined), false); }
  markPoly(q, pad, f) { this._poly(q, pad, (t, o) => { t[o] |= f; }, true); }
  /** A capsule (segment a-b, half width hw). */
  segment(ax, az, bx, bz, hw, f) {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 2));
    for (let k = 0; k <= n; k++) this.circle(ax + (bx - ax) * k / n, az + (bz - az) * k / n, hw, f);
  }
  /** Any cell within r of (x, z) carrying one of the flags in mask? */
  any(x, z, r, mask) {
    const i0 = Math.floor((x - r) / OC), i1 = Math.floor((x + r) / OC), j0 = Math.floor((z - r) / OC), j1 = Math.floor((z + r) / OC);
    const rr = (r + OC * 0.71) * (r + OC * 0.71);
    for (let j = j0; j <= j1; j++) {
      const tj = Math.floor(j / OT), lj = j - tj * OT;
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * OC - x, cz = (j + 0.5) * OC - z;
        if (cx * cx + cz * cz > rr) continue;
        const ti = Math.floor(i / OT), t = this._tile(ti, tj, false);
        if (t && (t[lj * OT + (i - ti * OT)] & mask)) return true;
      }
    }
    return false;
  }
  /** Rasterize every triangle of a (world-space) geometry: each triangle's box, grown by pad. */
  triangles(pos, index, matrix, f, pad = 0) {
    const e = matrix ? matrix.elements : null;
    const P = (k, out) => {
      const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
      if (!e) { out[0] = x; out[1] = z; return; }
      out[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
      out[1] = e[2] * x + e[6] * y + e[10] * z + e[14];
    };
    const a = [0, 0], b = [0, 0], c = [0, 0];
    const n = index ? index.length : pos.length / 3;
    for (let t = 0; t < n; t += 3) {
      P(index ? index[t] : t, a); P(index ? index[t + 1] : t + 1, b); P(index ? index[t + 2] : t + 2, c);
      const x0 = Math.min(a[0], b[0], c[0]) - pad, x1 = Math.max(a[0], b[0], c[0]) + pad, z0 = Math.min(a[1], b[1], c[1]) - pad, z1 = Math.max(a[1], b[1], c[1]) + pad;
      if (x1 < HILL.x0 || x0 > HILL.x1 || z1 < HILL.z0 || z0 > HILL.z1) continue;
      // a long thin triangle (a cable, a road edge) is walked along its edges instead of boxed
      if ((x1 - x0) * (z1 - z0) > 400) {
        for (const [p, q] of [[a, b], [b, c], [c, a]]) this.segment(p[0], p[1], q[0], q[1], pad + 1, f);
        continue;
      }
      this.box(x0, z0, x1, z1, f);
    }
  }
}

// [name, flags, pad (m), clearing pad (m): wild woods keep this far off]
const FLAG_FOR = [
  [/Hill country: roads and fields/, OCC.FLAT, 0.6, 0],
  [/Hill country: walls, vines and orchards/, OCC.LOW, 0.7, 0],
  [/Hill country: plinths, terraces and retaining walls/, OCC.LOW, 0.8, 0],
  [/Hill country: buildings/, OCC.TALL, 0.8, 9],
  [/massif town/, OCC.TALL, 0.8, -1],
  [/Hill farmland: (fields|lanes|finishes)/, OCC.FLAT, 0.6, 0],
  [/Hill farmland: (walls|stonework|planting)/, OCC.LOW, 0.7, 0],
  [/Hill farmland: (buildings|architecture)/, OCC.TALL, 0.8, 8],
];

/**
 * Survey every mesh standing on the northern mainland into an Occupancy raster (world
 * space, from its real triangles). Terrain, water, sky and trees are skipped. Round the
 * massif towns the wild woods keep a clearing of `townClear` metres off every structure.
 */
export function surveyBuilt(scene, { skip = new Set(), townClear = 26 } = {}) {
  const occ = new Occupancy(), seen = new Set(), box = new THREE.Box3(), towns = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || skip.has(o) || !o.geometry || seen.has(o.geometry)) return;
    const g = o.geometry, p = g.attributes.position;
    if (!p || p.count < 3) return;
    if (!g.boundingBox) g.computeBoundingBox();
    box.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
    if (box.max.x < HILL.x0 || box.min.x > HILL.x1 || box.max.z < HILL.z0 || box.min.z > HILL.z1) return;
    // nothing that spans the world (terrain, sky, sea, cloud decks)
    if (box.max.x - box.min.x > 30000 || box.max.z - box.min.z > 30000) return;
    // nothing wholly out at sea (the Outer Wards' platforms, the sea lines)
    let land = false;
    for (let a = 0; a <= 4 && !land; a++) for (let b = 0; b <= 4 && !land; b++) {
      const x = box.min.x + (box.max.x - box.min.x) * a / 4, z = box.min.z + (box.max.z - box.min.z) * b / 4;
      if (x > HILL.x0 && x < HILL.x1 && z > HILL.z0 && z < HILL.z1 && surveyAt(x, z)[0] > -2) land = true;
    }
    if (!land) return;
    seen.add(g);
    let f = OCC.TALL, pad = 0.8, clear = 4;
    for (const [re, fl, pd, cl] of FLAG_FOR) if (re.test(o.name || '')) { f = fl; pad = pd; clear = cl; break; }
    occ.triangles(p.array, g.index ? g.index.array : null, o.matrixWorld, f, pad);
    if (clear > 0) occ.triangles(p.array, g.index ? g.index.array : null, o.matrixWorld, /Hill (country|farmland)/.test(o.name || '') ? OCC.HOME : OCC.CLEAR, clear);
    if (clear < 0) towns.push(box.clone());
  });
  // the towns: a clearing round every structure (a dilation of their cells on an 8 m grid)
  const B = 8, D = Math.ceil(townClear / B);
  for (const b of towns) {
    const x0 = Math.floor(b.min.x / B) - D, x1 = Math.ceil(b.max.x / B) + D, z0 = Math.floor(b.min.z / B) - D, z1 = Math.ceil(b.max.z / B) + D;
    const W = x1 - x0 + 1, Hh = z1 - z0 + 1, src = new Uint8Array(W * Hh);
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
      const cx = (x0 + i) * B, cz = (z0 + j) * B;
      if (occ.get(cx + 2, cz + 2) & OCC.TALL || occ.get(cx + 6, cz + 2) & OCC.TALL || occ.get(cx + 2, cz + 6) & OCC.TALL || occ.get(cx + 6, cz + 6) & OCC.TALL) src[j * W + i] = 1;
    }
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
      if (!src[j * W + i]) continue;
      occ.box((x0 + i - D) * B, (z0 + j - D) * B, (x0 + i + D + 1) * B - 0.01, (z0 + j + D + 1) * B - 0.01, OCC.CLEAR);
    }
  }
  return occ;
}

/** Lowest drawn ground under a root flare of radius fr (and the highest, for the slope test). */
export function flareGround(x, z, fr) {
  let lo = renderedHeight(x, z), hi = lo;
  for (let a = 0; a < 6; a++) {
    const h = renderedHeight(x + Math.cos(a * 1.0472 + 0.3) * fr, z + Math.sin(a * 1.0472 + 0.3) * fr);
    if (h < lo) lo = h; if (h > hi) hi = h;
  }
  return [lo, hi];
}

export const onPlatform = (x, z) => wardHeight(x, z) > 0;
