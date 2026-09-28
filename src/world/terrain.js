import * as THREE from 'three';
import { createNoise2D, fbm, ridged, smoothstep, smax, mulberry32 } from './noise.js';
import { CENTRAL_ISLAND, ISLANDS, RIM } from './layout.js';
import { createTerrainShaderMaterial } from './terrainShading.js';

const nA = createNoise2D(11);
const nB = createNoise2D(23);
const nC = createNoise2D(37);
const nD = createNoise2D(51);

// Small scattered islets inside the lagoon (seeded)
export const ISLETS = (() => {
  const rnd = mulberry32(99);
  const out = [];
  let tries = 0;
  while (out.length < 22 && tries < 2000) {
    tries++;
    const a = rnd() * Math.PI * 2, r = 1300 + rnd() * 3900;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const rad = 70 + rnd() * 170;
    let ok = Math.hypot(x, z) > CENTRAL_ISLAND.r + 300;
    for (const i of ISLANDS) if (Math.hypot(x - i.x, z - i.z) < i.r + rad + 250) ok = false;
    for (const i of out) if (Math.hypot(x - i.x, z - i.z) < i.r + rad + 200) ok = false;
    if (ok) out.push({ x, z, r: rad, h: 5 + rnd() * 14 });
  }
  return out;
})();

function angDist(a, b) { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; }

function bump(dx, dz, r, h, wobble) {
  const d = Math.hypot(dx, dz) / (r * wobble);
  if (d > 2.2) return -1e9;
  // plateau with soft shoulders; crosses sea level at d = 1
  return h * (1 - Math.pow(d, 2.6));
}

/** Fringing reef around an island: a shallow coral flat (~ -1.5 m) that drops to the lagoon floor. */
function reefShelf(dx, dz, r, wobble, x, z, width) {
  const dm = Math.hypot(dx, dz) / wobble;              // metres from the island centre (wobbled)
  const w = width * (0.7 + 0.6 * (0.5 + 0.5 * nC(x * 0.0023 + 7, z * 0.0023)));
  const t = (dm - r * 0.985) / w;
  if (t > 1.6) return -1e9;
  if (t < 0) return -1.3;
  return -1.3 - 1.1 * t - 30 * smoothstep(0.7, 1.5, t);
}

/** Terrain height (metres above sea level) — the single source of truth. */
export function terrainHeight(x, z) {
  // domain warp for organic coastlines
  const wx = x + 260 * nA(x * 0.00042, z * 0.00042);
  const wz = z + 260 * nA(x * 0.00042 + 17.3, z * 0.00042 - 4.1);
  const r = Math.hypot(wx, wz);
  const th = Math.atan2(wz, wx);

  // --- sea floor: sandy lagoon inside the atoll, deep ocean outside ---
  const rimR = RIM.radius + 380 * fbm(nB, Math.cos(th) * 1.7 + 3, Math.sin(th) * 1.7 - 2, 3);
  const lagoonFloor = -11 - 5 * fbm(nC, x * 0.0006, z * 0.0006, 3) + 3.5 * Math.max(0, fbm(nC, x * 0.004, z * 0.004, 2));
  const outside = Math.max(0, r - rimR - RIM.width * 0.4);
  let floor = lagoonFloor - outside * 0.05 - Math.min(outside, 1600) * 0.06;
  floor = Math.max(floor, -260);

  // --- the atoll rim ---
  const dr = (r - rimR) / (RIM.width * 0.5);
  let chan = 1;
  for (const c of RIM.channels) chan *= smoothstep(c.width * 0.45, c.width, angDist(th, c.angle));
  const rimNoise = fbm(nB, x * 0.0011, z * 0.0011, 4);
  const rimH = (14 + 46 * Math.max(0, rimNoise + 0.35)) * (1 - dr * dr) - 6;
  let land = rimH * chan + (1 - chan) * Math.min(rimH, -40);
  // reef platforms (always below sea level, so land heights are untouched):
  // a shallow outer reef flat on the ocean side of the rim that ends in a steep
  // wall where the surf breaks, and a sandy apron shelving into the lagoon.
  let shelf = -1e9;
  if (chan > 0.01 && dr > -2.6 && dr < 2.4) {
    const ca = Math.cos(th), sa = Math.sin(th);
    if (dr > 0) {
      const wOut = 0.32 + 0.34 * (0.5 + 0.5 * nC(ca * 9 + 4, sa * 9));
      const t = Math.max(0, (dr - 0.9) / wOut);
      shelf = -1.1 - 1.3 * t - 200 * smoothstep(0.82, 1.5, t);
    } else {
      const wIn = 0.5 + 0.6 * (0.5 + 0.5 * nC(ca * 7 - 3, sa * 7 + 1));
      const t = Math.max(0, (-dr - 0.9) / wIn);
      shelf = -1.4 - 2.4 * t - 30 * smoothstep(0.6, 1.6, t);
    }
    shelf = shelf * chan + (1 - chan) * -40;
  }

  // --- central island (Axis foundation) ---
  const cw = 1 + 0.08 * nD(x * 0.002, z * 0.002);
  land = smax(land, bump(wx - CENTRAL_ISLAND.x, wz - CENTRAL_ISLAND.z, CENTRAL_ISLAND.r, CENTRAL_ISLAND.h, cw), 8);
  shelf = Math.max(shelf, reefShelf(wx - CENTRAL_ISLAND.x, wz - CENTRAL_ISLAND.z, CENTRAL_ISLAND.r, cw, x, z, 120));

  // --- district islands & islets ---
  for (const i of ISLANDS) {
    const dx = wx - i.x, dz = wz - i.z;
    if (Math.abs(dx) > i.r * 2.4 || Math.abs(dz) > i.r * 2.4) continue;
    const wob = 1 + 0.14 * nD(x * 0.0017 + i.x, z * 0.0017);
    const hh = i.h * (0.85 + 0.35 * fbm(nC, x * 0.003, z * 0.003, 3));
    land = smax(land, bump(dx, dz, i.r, hh, wob), 10);
    shelf = Math.max(shelf, reefShelf(dx, dz, i.r, wob, x, z, 150));
  }
  for (const i of ISLETS) {
    const dx = wx - i.x, dz = wz - i.z;
    if (Math.abs(dx) > i.r * 2.4 || Math.abs(dz) > i.r * 2.4) continue;
    const wob = 1 + 0.2 * nD(x * 0.004 + i.x, z * 0.004);
    land = smax(land, bump(dx, dz, i.r, i.h, wob), 6);
    shelf = Math.max(shelf, reefShelf(dx, dz, i.r, wob, x, z, 70));
  }
  land = Math.max(land, shelf);

  // --- the plaza berm: the island rises in a landscaped slope to meet the Axis plaza's
  //     planted terrace (12.5 m), so the plaza's rim sits in the land instead of standing
  //     proud of the low east shore as a wall ---
  {
    const rp = Math.hypot(x, z);
    if (rp < 900) {
      const reach = 170 + 60 * (0.5 + 0.5 * nD(x * 0.003 + 7, z * 0.003 - 3));
      const t = smoothstep(606, 606 + reach, rp);
      const berm = 12.3;
      land = Math.max(land, berm + (land - berm) * t);
    }
  }

  // --- northern volcanic massif: broad eroded domes carved by radial ridges ---
  let mountain = -1e9;
  if (z < -7000) {
    let dome = 0;
    for (const m of MASSIF) {
      const dx = x - m.x, dz = z - m.z;
      const d = Math.hypot(dx * m.sx, dz);
      dome = Math.max(dome, m.h * Math.exp(-Math.pow(d / m.r, 1.35)));
    }
    // connecting ridge line along the massif
    const spine = 850 * Math.exp(-Math.pow((z + 16500 + 1200 * Math.sin(x * 0.00018)) / 3000, 2)) * smoothstep(15000, 7000, Math.abs(x + 800));
    dome = Math.max(dome, spine);
    if (dome > 1) {
      const mx = x + 1300 * nA(x * 0.00015, z * 0.00015);
      const mz = z + 1300 * nA(x * 0.00015 + 9.1, z * 0.00015);
      const rg = ridged(nD, mx * 0.00034, mz * 0.00034, 6);           // knife-edge ridges
      const valleys = Math.pow(Math.abs(nB(mx * 0.00011, mz * 0.00011)), 0.7);
      const hills = fbm(nC, x * 0.0009, z * 0.0009, 3);
      const t = dome / 2000;
      mountain = dome * (0.52 + 0.62 * rg * (0.6 + 0.4 * t)) * (0.78 + 0.22 * valleys) + 40 * hills - 60;
      // spurs, gullies and knolls below the old 100 m mesh: they read from the gondolas and
      // the hill roads, and stay gentle enough for the terrace towns
      const relief = smoothstep(30, 450, dome);
      const spur = ridged(nC, mx * 0.0024 + 3.7, mz * 0.0024 - 1.3, 3);
      mountain += relief * (18 * (spur - 0.35) + 5 * nA(x * 0.0071 + 5.3, z * 0.0071 - 2.1) + 2.5 * nB(x * 0.016, z * 0.016));
      mountain = mountain * smoothstep(-7300, -9800, z) - 80 * (1 - smoothstep(-7300, -9800, z));
    }
  }
  // Mount Anchor: a lone, cloud-capped volcanic cone to the west-north-west
  {
    const ax = x + 18800, az = z + 6800;
    const d = Math.hypot(ax, az);
    if (d < 14000) {
      const ang = Math.atan2(az, ax);
      const ribs = ridged(nB, Math.cos(ang) * 3 + d * 0.0003, Math.sin(ang) * 3 + d * 0.0003, 4);
      const cone = 2450 * Math.exp(-Math.pow(d / 4300, 1.7)) * (0.82 + 0.3 * ribs) - 60 - 120 * smoothstep(900, 0, d) * 0.9;
      mountain = Math.max(mountain, cone);
    }
  }
  // Distant islands on the horizon
  for (const [ix, iz, ir, ih] of FAR_ISLANDS) {
    const dx = x - ix, dz = z - iz, d0 = Math.hypot(dx, dz);
    if (d0 < ir * 2.5) {
      const ca = dx / (d0 + 1e-6), sa = dz / (d0 + 1e-6);
      // a lobed coast of headlands and bays instead of a round dome
      const d = d0 / (1 + 0.2 * nB(ca * 1.6 + ix * 1e-3, sa * 1.6 + iz * 1e-3) + 0.08 * nC(x * 0.0011, z * 0.0011));
      const rg = ridged(nA, x * 0.0004, z * 0.0004, 4);
      let isl = ih * Math.exp(-Math.pow(d / ir, 1.8)) * (0.7 + 0.5 * rg) - 30;
      // ravines cut down the flanks with spurs between, and knolls
      const flank = smoothstep(4, 60, isl) * (1 - smoothstep(ih * 0.55, ih * 0.9, isl));
      isl += flank * (20 * (ridged(nD, x * 0.0019 + ix * 1e-3, z * 0.0019, 3) - 0.35) + 5 * nA(x * 0.008, z * 0.008));
      // sea cliffs on the ocean side, never on the harbour side that faces the capital
      const away = (dx * ix + dz * iz) / ((d0 + 1e-6) * Math.hypot(ix, iz));
      const cliff = smoothstep(0.1, 0.5, away) * smoothstep(0.05, 0.4, nC(ca * 2.3 + 9, sa * 2.3 - 4) + 0.3);
      isl += cliff * 30 * smoothstep(-6, -1, isl);
      mountain = Math.max(mountain, isl);
    }
  }
  land = smax(land, mountain, 60);

  let h = smax(land, floor, 5);
  // gentle beaches: flatten the band just above sea level
  if (h > 0 && h < 8) h = 8 * Math.pow(h / 8, 1.45);
  return h;
}

export const MASSIF = [
  { x: -2500, z: -16500, r: 4300, h: 1950, sx: 0.85 },
  { x: 4800, z: -15000, r: 3300, h: 1500, sx: 0.9 },
  { x: -8800, z: -14200, r: 3000, h: 1300, sx: 1.0 },
  { x: 9800, z: -19000, r: 3800, h: 1150, sx: 1.0 },
];

export const FAR_ISLANDS = [
  [21000, 24000, 3200, 420],
  [-26000, 19000, 4200, 640],
  [31000, -4000, 2600, 380],
  [-9000, 33000, 2400, 260],
  [14000, 36000, 3000, 520],
];

// ---------------------------------------------------------------------------
export const INNER = { half: 7200, n: 1024 };

/** Samples the inner grid heights quickly (bilinear), falls back to analytic outside. */
export class HeightSampler {
  constructor(heights) { this.h = heights; }
  get(x, z) {
    const { half, n } = INNER;
    const u = ((x + half) / (2 * half)) * n, v = ((z + half) / (2 * half)) * n;
    if (u < 0 || v < 0 || u >= n || v >= n) return terrainHeight(x, z);
    const i = Math.floor(u), j = Math.floor(v);
    const fu = u - i, fv = v - j;
    const s = n + 1;
    const h00 = this.h[j * s + i], h10 = this.h[j * s + i + 1], h01 = this.h[(j + 1) * s + i], h11 = this.h[(j + 1) * s + i + 1];
    return (h00 * (1 - fu) + h10 * fu) * (1 - fv) + (h01 * (1 - fu) + h11 * fu) * fv;
  }
}

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

export async function buildTerrainData(progress) {
  const { half, n } = INNER;
  const s = n + 1;
  const heights = new Float32Array(s * s);
  const step = (2 * half) / n;
  for (let j = 0; j < s; j++) {
    const z = -half + j * step;
    for (let i = 0; i < s; i++) heights[j * s + i] = terrainHeight(-half + i * step, z);
    if (j % 96 === 0) { progress && progress(j / s); await yieldFrame(); }
  }
  return heights;
}

export function buildInnerGeometry(heights) {
  const { half, n } = INNER;
  const s = n + 1;
  const step = (2 * half) / n;
  const pos = new Float32Array(s * s * 3);
  const nrm = new Float32Array(s * s * 3);
  for (let j = 0; j < s; j++) {
    for (let i = 0; i < s; i++) {
      const k = j * s + i;
      pos[k * 3] = -half + i * step;
      pos[k * 3 + 1] = heights[k];
      pos[k * 3 + 2] = -half + j * step;
      // central differences, one-sided at the grid border (scaled to the span actually sampled)
      const il = Math.max(i - 1, 0), ir = Math.min(i + 1, n), jd = Math.max(j - 1, 0), ju = Math.min(j + 1, n);
      const hl = heights[j * s + il], hr = heights[j * s + ir];
      const hd = heights[jd * s + i], hu = heights[ju * s + i];
      const nx = (hl - hr) / (ir - il), ny = step, nz = (hd - hu) / (ju - jd);
      const l = Math.hypot(nx, ny, nz);
      nrm[k * 3] = nx / l; nrm[k * 3 + 1] = ny / l; nrm[k * 3 + 2] = nz / l;
    }
  }
  const idx = new Uint32Array(n * n * 6);
  let p = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * s + i, b = a + 1, c = a + s, d = c + 1;
      // alternate diagonal to avoid directional artefacts
      if ((i + j) & 1) { idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; }
      else { idx[p++] = a; idx[p++] = c; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), half * 1.5);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-half, -300, -half), new THREE.Vector3(half, 2500, half));
  return g;
}

// ---------------------------------------------------------------- outer ring --
// The outer terrain is a polar grid of log-spaced rings from under the inner grid to the
// horizon. Every coarse cell that holds land or shallows is also subdivided K x K (about
// 25 m cells at 12 km, 60 m at 30 km). Subdivided cells are grouped in chunks that swap
// between their fine and coarse triangulations by distance (OuterLod), all in one draw call.
// A fine vertex on an edge its cell shares with a coarse cell (or with another chunk) lies
// exactly on the coarse edge, so the surface is watertight whichever way each chunk is drawn.
// outerSurfaceHeight() interpolates the fine surface exactly: everything on the outer land is
// placed with it (outerCities.renderedHeight).
export const OUTER = { A: 1024, R: 210, r0: 6900, r1: 46000, K: 4, CA: 16, CR: 15, NEAR: 10000 };
const OCOLS = OUTER.A + 1;
let OLAYOUT = null;
function outerLayout() {
  if (OLAYOUT) return OLAYOUT;
  const { A, R, r0, r1 } = OUTER;
  const n = OCOLS * (R + 1);
  const radii = new Float64Array(R + 1), H = new Float64Array(n), P = new Float64Array(n * 2), sq = new Float64Array(n);
  for (let j = 0; j <= R; j++) {
    const r = (radii[j] = r0 * Math.pow(r1 / r0, j / R));
    for (let i = 0; i <= A; i++) {
      const a = (i / A) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r, k = j * OCOLS + i;
      sq[k] = Math.max(Math.abs(x), Math.abs(z));
      // pull the seam slightly under the inner grid to hide cracks
      H[k] = terrainHeight(x, z) - (sq[k] < INNER.half - 30 ? 4 : 0);
      P[k * 2] = x; P[k * 2 + 1] = z;
    }
  }
  // cells worth subdividing: land or shallows, clear of the inner grid's overlap
  const fine = new Uint8Array(A * R);
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < A; i++) {
      const k = j * OCOLS + i;
      const hi = Math.max(H[k], H[k + 1], H[k + OCOLS], H[k + OCOLS + 1]);
      const lo = Math.min(sq[k], sq[k + 1], sq[k + OCOLS], sq[k + OCOLS + 1]);
      if (hi > -8 && lo > INNER.half + 150) fine[j * A + i] = 1;
    }
  }
  OLAYOUT = { radii, H, P, fine };
  return OLAYOUT;
}
const oCellFine = (i, j) => (j < 0 || j >= OUTER.R ? 0 : OLAYOUT.fine[j * OUTER.A + ((i + OUTER.A) % OUTER.A)]);
const oChunk = (i, j) => Math.floor(((i + OUTER.A) % OUTER.A) / OUTER.CA) + Math.floor(j / OUTER.CR) * (OUTER.A / OUTER.CA);
const oCoarse = (i, j) => { const k = j * OCOLS + i; return [OLAYOUT.P[k * 2], OLAYOUT.H[k], OLAYOUT.P[k * 2 + 1]]; };
const oLerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
const oRadius = (J) => OUTER.r0 * Math.pow(OUTER.r1 / OUTER.r0, J / (OUTER.R * OUTER.K));
/** Fine vertex (I, J) of the subdivided polar grid, as drawn. */
function outerFineVertex(I, J) {
  const { A, R, K } = OUTER;
  const i = Math.floor(I / K), j = Math.min(Math.floor(J / K), R), fi = I - i * K, fj = J - j * K;
  if (fi === 0 && fj === 0) return oCoarse(i, j);
  const same = (i1, j1, i2, j2) => oCellFine(i1, j1) && oCellFine(i2, j2) && oChunk(i1, j1) === oChunk(i2, j2);
  if (fj === 0) {
    if (!same(i, j - 1, i, j)) return oLerp(oCoarse(i, j), oCoarse(i + 1, j), fi / K);       // on a ring edge
  } else if (fi === 0) {
    if (!same(i - 1, j, i, j)) {                                                               // on a spoke edge
      const t = (oRadius(J) - OLAYOUT.radii[j]) / (OLAYOUT.radii[j + 1] - OLAYOUT.radii[j]);
      return oLerp(oCoarse(i, j), oCoarse(i, j + 1), t);
    }
  }
  const a = (I / (A * K)) * Math.PI * 2, r = oRadius(J);
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  return [x, terrainHeight(x, z), z];
}
function oBary(a, b, c, d, x, z) {
  // cells split into (a, b, c) and (b, d, c): interpolate on the plane of the triangle that
  // contains the point
  const bary = (p, q, s) => {
    const v0x = q[0] - p[0], v0z = q[2] - p[2], v1x = s[0] - p[0], v1z = s[2] - p[2], v2x = x - p[0], v2z = z - p[2];
    const den = v0x * v1z - v1x * v0z || 1e-9;
    const u = (v2x * v1z - v1x * v2z) / den, v = (v0x * v2z - v2x * v0z) / den;
    return [1 - u - v, u, v];
  };
  const w1 = bary(a, b, c);
  if (w1[0] >= -1e-4 && w1[1] >= -1e-4 && w1[2] >= -1e-4) return a[1] * w1[0] + b[1] * w1[1] + c[1] * w1[2];
  const w2 = bary(b, d, c);
  return b[1] * w2[0] + d[1] * w2[1] + c[1] * w2[2];
}
// Surface queries come in dense patches (ground cover samples a camera tile of it), so the
// fine vertices they interpolate are memoised; the values are identical to the mesh's.
const OFV_CACHE = new Map();
function ofvCached(I, J) {
  const k = J * 8192 + I;
  let v = OFV_CACHE.get(k);
  if (v === undefined) {
    if (OFV_CACHE.size > 60000) OFV_CACHE.clear();
    v = outerFineVertex(I, J);
    OFV_CACHE.set(k, v);
  }
  return v;
}
/** Height of the outer mesh surface exactly as its near (fine) LOD draws it. */
export function outerSurfaceHeight(x, z) {
  outerLayout();
  const { A, R, K, r0, r1 } = OUTER;
  const r = Math.hypot(x, z);
  let th = Math.atan2(z, x);
  if (th < 0) th += Math.PI * 2;
  const fi = (th / (Math.PI * 2)) * A, fj = (Math.log(Math.max(r, r0) / r0) / Math.log(r1 / r0)) * R;
  const i = Math.min(Math.floor(fi), A - 1), j = Math.min(Math.floor(fj), R - 1);
  if (OLAYOUT.fine[j * A + i]) {
    const I = Math.min(Math.max(Math.floor(fi * K), i * K), i * K + K - 1), J = Math.min(Math.max(Math.floor(fj * K), j * K), j * K + K - 1);
    return oBary(ofvCached(I, J), ofvCached(I + 1, J), ofvCached(I, J + 1), ofvCached(I + 1, J + 1), x, z);
  }
  return oBary(oCoarse(i, j), oCoarse(i + 1, j), oCoarse(i, j + 1), oCoarse(i + 1, j + 1), x, z);
}

/** Swaps each land chunk of the outer mesh between its fine and coarse cells by distance. */
export class OuterLod {
  constructor(geo, statics, chunks) {
    this.geo = geo; this.statics = statics; this.chunks = chunks;
    this.rebuild();
  }
  update(camera) {
    const p = camera.position, N = OUTER.NEAR;
    let changed = false;
    for (const c of this.chunks) {
      const d = Math.hypot(Math.max(Math.hypot(p.x - c.x, p.z - c.z) - c.rad, 0), Math.max(p.y - c.top, 0));
      const want = c.near ? d < N * 1.12 : d < N;
      if (want !== c.near) { c.near = want; changed = true; }
    }
    if (changed) this.rebuild();
  }
  rebuild() {
    const idx = this.geo.index, arr = idx.array;
    let n = this.statics;
    for (const c of this.chunks) { const s = c.near ? c.fine : c.coarse; arr.set(s, n); n += s.length; }
    this.geo.setDrawRange(0, n);
    idx.clearUpdateRanges();
    idx.addUpdateRange(this.statics, n - this.statics);
    idx.needsUpdate = true;
  }
}

/**
 * Polar ring from the inner grid out to the horizon (mountains, far islands). Returns the
 * main-view geometry (userData.lod: an OuterLod, update(camera) it every frame) with
 * userData.coarse, the plain coarse ring for the reflection pass.
 */
export async function buildOuterGeometry(progress) {
  const L = outerLayout();
  const { A, R, K, r1 } = OUTER;
  const FC = A * K + 1, FR = R * K + 1;
  // vertex slots: every coarse vertex, then the fine vertices of subdivided cells
  const fmap = new Int32Array(FC * FR).fill(-1);
  let nv = OCOLS * (R + 1);
  for (let j = 0; j < R; j++) for (let i = 0; i < A; i++) {
    if (!L.fine[j * A + i]) continue;
    for (let J = j * K; J <= j * K + K; J++) for (let I = i * K; I <= i * K + K; I++) if (fmap[J * FC + I] < 0) fmap[J * FC + I] = nv++;
  }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
  const setN = (k, nx, ny, nz) => {
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-9) || ny <= 0) { nrm[k] = 0; nrm[k + 1] = 1; nrm[k + 2] = 0; return; }
    nrm[k] = nx / l; nrm[k + 1] = ny / l; nrm[k + 2] = nz / l;
  };
  for (let j = 0; j <= R; j++) {
    const e = Math.max(L.radii[j] * 0.004, 12);
    for (let i = 0; i <= A; i++) {
      const q = j * OCOLS + i, k = q * 3, x = L.P[q * 2], z = L.P[q * 2 + 1], h = L.H[q];
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
      setN(k, h - terrainHeight(x + e, z), e, h - terrainHeight(x, z + e));
    }
    if (j % 30 === 0) { progress && progress((0.3 * j) / R); await yieldFrame(); }
  }
  // fine vertices: heights cached so the normals come from the fine surface itself
  const AK = A * K;
  const fy = new Float32Array(FC * FR).fill(NaN);
  const yAt = (I, J) => {
    I = (I + AK) % AK;
    const q = J * FC + I;
    if (Number.isNaN(fy[q])) fy[q] = outerFineVertex(I, J)[1];
    return fy[q];
  };
  const pAt = (I, J) => { const a = (I / AK) * Math.PI * 2, r = oRadius(J); return [Math.cos(a) * r, yAt(I, J), Math.sin(a) * r]; };
  for (let J = 0; J < FR; J++) {
    for (let I = 0; I < FC; I++) {
      const v = fmap[J * FC + I];
      if (v < 0) continue;
      const p = outerFineVertex(I, J), k = v * 3;
      pos[k] = p[0]; pos[k + 1] = p[1]; pos[k + 2] = p[2];
      fy[J * FC + (I % AK)] = p[1];
      const u0 = pAt(I - 1, J), u1 = pAt(I + 1, J), w0 = pAt(I, Math.max(J - 1, 0)), w1 = pAt(I, Math.min(J + 1, FR - 1));
      const ux = u1[0] - u0[0], uy = u1[1] - u0[1], uz = u1[2] - u0[2];
      const vx = w1[0] - w0[0], vy = w1[1] - w0[1], vz = w1[2] - w0[2];
      setN(k, uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    }
    if (J % 120 === 0) { progress && progress(0.3 + (0.7 * J) / FR); await yieldFrame(); }
  }
  // index lists: coarse cells that are never subdivided, then per land chunk its fine and
  // coarse triangulations
  const statics = [], full = new Uint32Array(A * R * 6), chunkMap = new Map();
  let fp = 0;
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < A; i++) {
      const a = j * OCOLS + i, b = a + 1, c = a + OCOLS, d = c + 1;
      full[fp++] = a; full[fp++] = b; full[fp++] = c; full[fp++] = b; full[fp++] = d; full[fp++] = c;
      if (!L.fine[j * A + i]) { statics.push(a, b, c, b, d, c); continue; }
      const id = oChunk(i, j);
      let ch = chunkMap.get(id);
      if (!ch) chunkMap.set(id, (ch = { fine: [], coarse: [], minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9, top: -1e9 }));
      ch.coarse.push(a, b, c, b, d, c);
      for (let J = j * K; J < j * K + K; J++) {
        for (let I = i * K; I < i * K + K; I++) {
          const fa = fmap[J * FC + I], fb = fmap[J * FC + I + 1], fc = fmap[(J + 1) * FC + I], fd = fmap[(J + 1) * FC + I + 1];
          ch.fine.push(fa, fb, fc, fb, fd, fc);
        }
      }
      for (const q of [a, b, c, d]) {
        ch.minX = Math.min(ch.minX, L.P[q * 2]); ch.maxX = Math.max(ch.maxX, L.P[q * 2]);
        ch.minZ = Math.min(ch.minZ, L.P[q * 2 + 1]); ch.maxZ = Math.max(ch.maxZ, L.P[q * 2 + 1]);
        ch.top = Math.max(ch.top, L.H[q]);
      }
    }
  }
  const chunks = [...chunkMap.values()].map((c) => ({
    x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2, rad: Math.hypot(c.maxX - c.minX, c.maxZ - c.minZ) / 2,
    top: c.top + 60, near: false, fine: new Uint32Array(c.fine), coarse: new Uint32Array(c.coarse),
  }));
  const total = statics.length + chunks.reduce((s, c) => s + Math.max(c.fine.length, c.coarse.length), 0);
  const idx = new Uint32Array(total);
  idx.set(statics);
  const posA = new THREE.BufferAttribute(pos, 3), nrmA = new THREE.BufferAttribute(nrm, 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', posA);
  g.setAttribute('normal', nrmA);
  g.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), r1 * 1.1);
  g.userData.lod = new OuterLod(g, statics.length, chunks);
  // the reflection pass keeps the plain coarse ring (the fine vertices go unreferenced there)
  const gc = new THREE.BufferGeometry();
  gc.setAttribute('position', posA);
  gc.setAttribute('normal', nrmA);
  gc.setIndex(new THREE.BufferAttribute(full, 1));
  gc.boundingSphere = g.boundingSphere.clone();
  g.userData.coarse = gc;
  return g;
}

// ------------------------------------------------------------ shared data --
/**
 * Terrain data shared with other nature systems (ground cover, fauna, surf) and
 * available to any other module that needs it once the world is built:
 *  heights    Float32Array (n+1)^2 inner grid heights (row-major, z rows)
 *  heightTex  R32F (n+1)^2 texture of the same heights (NearestFilter, use texelFetch)
 *  natureTex  RGBA16F 1024^2 over the inner grid (same layout as the info texture):
 *             R signed distance to the shoreline in metres (+ land, - water, clamped +-400)
 *             G ocean exposure 0..1 (1 = seaward side of the atoll)
 *             B outer-reef crest 0..1 (where ocean swell breaks)
 *             A surface curvature (+ valleys / gullies, - ridges), roughly -1..1
 *  shore      Float32Array 1024^2 of R, exposure and crest as CPU copies
 */
export const TERRAIN_DATA = { heights: null, heightTex: null, natureTex: null, info: null, shore: null, exposure: null, crest: null, N: 1024 };

function bilinearGrid(heights, u, v) {
  const { n } = INNER;
  const s = n + 1;
  const x = Math.min(Math.max(u * n, 0), n - 1e-4), y = Math.min(Math.max(v * n, 0), n - 1e-4);
  const i = Math.floor(x), j = Math.floor(y), fu = x - i, fv = y - j;
  const h00 = heights[j * s + i], h10 = heights[j * s + i + 1], h01 = heights[(j + 1) * s + i], h11 = heights[(j + 1) * s + i + 1];
  return (h00 * (1 - fu) + h10 * fu) * (1 - fv) + (h01 * (1 - fu) + h11 * fu) * fv;
}

// exact Euclidean distance transform (Felzenszwalb & Huttenlocher), squared distances in cells
export function edt2d(sites, N) {
  const INF = 1e20;
  const f = new Float64Array(N), d = new Float64Array(N), zz = new Float64Array(N + 1);
  const v = new Int32Array(N);
  const out = new Float64Array(N * N);
  for (let k = 0; k < N * N; k++) out[k] = sites[k] ? 0 : INF;
  const pass = (get, set) => {
    for (let q = 0; q < N; q++) f[q] = get(q);
    let k = 0; v[0] = 0; zz[0] = -INF; zz[1] = INF;
    for (let q = 1; q < N; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= zz[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; zz[k] = s; zz[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < N; q++) { while (zz[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
    for (let q = 0; q < N; q++) set(q, d[q]);
  };
  for (let j = 0; j < N; j++) pass((q) => out[j * N + q], (q, val) => { out[j * N + q] = val; });
  for (let i = 0; i < N; i++) pass((q) => out[q * N + i], (q, val) => { out[q * N + i] = val; });
  return out;
}

export function buildHeightTexture(heights) {
  const s = INNER.n + 1;
  const tex = new THREE.DataTexture(heights, s, s, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Info texture over the inner grid: R height, G urban, B forest, A 1. Also builds TERRAIN_DATA. */
export function buildInfoTexture(heights, urbanFn, forestFn) {
  const { half } = INNER;
  const N = 1024;
  const cellM = (2 * half) / N;
  const data = new Uint16Array(N * N * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  const urban = new Float32Array(N * N);
  const forest = new Float32Array(N * N);
  const hgt = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N, v = (j + 0.5) / N;
      const x = -half + u * 2 * half, z = -half + v * 2 * half;
      const h = bilinearGrid(heights, u, v);
      const k = j * N + i;
      const ub = urbanFn(x, z, h);
      const fo = forestFn(x, z, h, ub);
      urban[k] = ub; forest[k] = fo; hgt[k] = h;
      data[k * 4] = toHalf(h);
      data[k * 4 + 1] = toHalf(ub);
      data[k * 4 + 2] = toHalf(fo);
      data[k * 4 + 3] = toHalf(1);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  // ---- shoreline / reef data ----
  const land = new Uint8Array(N * N), water = new Uint8Array(N * N), deep = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, h = hgt[k];
    land[k] = h > 0 ? 1 : 0; water[k] = h > 0 ? 0 : 1;
    const x = -half + (i + 0.5) * cellM, z = -half + (j + 0.5) * cellM;
    deep[k] = h < -28 && Math.hypot(x, z) > 5500 ? 1 : 0;
  }
  const dLand = edt2d(land, N), dWater = edt2d(water, N), dDeep = edt2d(deep, N);
  const shore = new Float32Array(N * N), exposure = new Float32Array(N * N), crest = new Float32Array(N * N), curv = new Float32Array(N * N);
  const nat = new Uint16Array(N * N * 4);
  const sm = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, h = hgt[k];
    const sd = land[k] ? Math.sqrt(dWater[k]) * cellM - cellM * 0.5 : -(Math.sqrt(dLand[k]) * cellM - cellM * 0.5);
    const dd = Math.sqrt(dDeep[k]) * cellM;
    const ex = 1 - sm(60, 900, dd);
    const cr = h < -0.2 && h > -6 ? ex * (1 - sm(20, 110, dd)) : 0;
    // curvature: laplacian of heights over ~3 cells (valleys positive)
    const at = (a, b) => hgt[Math.min(N - 1, Math.max(0, j + b)) * N + Math.min(N - 1, Math.max(0, i + a))];
    const lap = (at(3, 0) + at(-3, 0) + at(0, 3) + at(0, -3)) * 0.25 - h;
    shore[k] = sd; exposure[k] = ex; crest[k] = cr; curv[k] = Math.max(-1, Math.min(1, lap * 0.35));
    nat[k * 4] = toHalf(Math.max(-400, Math.min(400, sd)));
    nat[k * 4 + 1] = toHalf(ex);
    nat[k * 4 + 2] = toHalf(cr);
    nat[k * 4 + 3] = toHalf(Math.max(-1, Math.min(1, lap * 0.35)));
  }
  const natureTex = new THREE.DataTexture(nat, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  natureTex.magFilter = natureTex.minFilter = THREE.LinearFilter;
  natureTex.wrapS = natureTex.wrapT = THREE.ClampToEdgeWrapping;
  natureTex.needsUpdate = true;

  const info = { tex, urban, forest, N, natureTex, shore, exposure, crest, curv, hgt };
  Object.assign(TERRAIN_DATA, { heights, heightTex: buildHeightTexture(heights), natureTex, info, shore, exposure, crest, N });
  return info;
}

// ---------------------------------------------------------------- material --
export function createTerrainMaterial(infoTex, natureTex = TERRAIN_DATA.natureTex) {
  return createTerrainShaderMaterial(infoTex, natureTex, INNER.half);
}
