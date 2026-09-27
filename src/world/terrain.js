import * as THREE from 'three';
import { createNoise2D, fbm, ridged, smoothstep, smax, mulberry32 } from './noise.js';
import { CENTRAL_ISLAND, ISLANDS, RIM } from './layout.js';
import { patchedMaterial } from './materials.js';

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

  // --- central island (Axis foundation) ---
  const cw = 1 + 0.08 * nD(x * 0.002, z * 0.002);
  land = smax(land, bump(wx - CENTRAL_ISLAND.x, wz - CENTRAL_ISLAND.z, CENTRAL_ISLAND.r, CENTRAL_ISLAND.h, cw), 8);

  // --- district islands & islets ---
  for (const i of ISLANDS) {
    const dx = wx - i.x, dz = wz - i.z;
    if (Math.abs(dx) > i.r * 2.4 || Math.abs(dz) > i.r * 2.4) continue;
    const wob = 1 + 0.14 * nD(x * 0.0017 + i.x, z * 0.0017);
    const hh = i.h * (0.85 + 0.35 * fbm(nC, x * 0.003, z * 0.003, 3));
    land = smax(land, bump(dx, dz, i.r, hh, wob), 10);
  }
  for (const i of ISLETS) {
    const dx = wx - i.x, dz = wz - i.z;
    if (Math.abs(dx) > i.r * 2.4 || Math.abs(dz) > i.r * 2.4) continue;
    const wob = 1 + 0.2 * nD(x * 0.004 + i.x, z * 0.004);
    land = smax(land, bump(dx, dz, i.r, i.h, wob), 6);
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
    const d = Math.hypot(x - ix, z - iz);
    if (d < ir * 2.5) {
      const rg = ridged(nA, x * 0.0004, z * 0.0004, 4);
      mountain = Math.max(mountain, ih * Math.exp(-Math.pow(d / ir, 1.8)) * (0.7 + 0.5 * rg) - 30);
    }
  }
  land = smax(land, mountain, 60);

  let h = smax(land, floor, 5);
  // gentle beaches: flatten the band just above sea level
  if (h > 0 && h < 8) h = 8 * Math.pow(h / 8, 1.45);
  return h;
}

const MASSIF = [
  { x: -2500, z: -16500, r: 4300, h: 1950, sx: 0.85 },
  { x: 4800, z: -15000, r: 3300, h: 1500, sx: 0.9 },
  { x: -8800, z: -14200, r: 3000, h: 1300, sx: 1.0 },
  { x: 9800, z: -19000, r: 3800, h: 1150, sx: 1.0 },
];

const FAR_ISLANDS = [
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
      const hl = heights[j * s + Math.max(i - 1, 0)], hr = heights[j * s + Math.min(i + 1, n)];
      const hd = heights[Math.max(j - 1, 0) * s + i], hu = heights[Math.min(j + 1, n) * s + i];
      let nx = hl - hr, ny = 2 * step, nz = hd - hu;
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

/** Polar ring from the inner grid out to the horizon (mountains, far islands). */
export async function buildOuterGeometry(progress) {
  const A = 1024, R = 210;
  const r0 = 6900, r1 = 46000;
  const cols = A + 1;
  const pos = new Float32Array(cols * (R + 1) * 3);
  const nrm = new Float32Array(cols * (R + 1) * 3);
  const radii = [];
  for (let j = 0; j <= R; j++) radii.push(r0 * Math.pow(r1 / r0, j / R));
  for (let j = 0; j <= R; j++) {
    const r = radii[j];
    const e = Math.max(r * 0.004, 12);
    for (let i = 0; i <= A; i++) {
      const a = (i / A) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // pull the seam slightly under the inner grid to hide cracks
      const inside = Math.max(Math.abs(x), Math.abs(z)) < INNER.half - 30;
      const h = terrainHeight(x, z) - (inside ? 4 : 0);
      const k = (j * cols + i) * 3;
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
      const hx = terrainHeight(x + e, z), hz = terrainHeight(x, z + e);
      let nx = h - hx, ny = e, nz = h - hz;
      const l = Math.hypot(nx, ny, nz);
      nrm[k] = nx / l; nrm[k + 1] = ny / l; nrm[k + 2] = nz / l;
    }
    if (j % 20 === 0) { progress && progress(j / R); await yieldFrame(); }
  }
  const idx = new Uint32Array(A * R * 6);
  let p = 0;
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < A; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx[p++] = a; idx[p++] = b; idx[p++] = c; idx[p++] = b; idx[p++] = d; idx[p++] = c;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), r1 * 1.1);
  return g;
}

/** Info texture over the inner grid: R height, G urban, B forest, A shoreline district glow. */
export function buildInfoTexture(heights, urbanFn, forestFn) {
  const { half, n } = INNER;
  const s = n + 1;
  const N = 1024;
  const data = new Uint16Array(N * N * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  const urban = new Float32Array(N * N);
  const forest = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N, v = (j + 0.5) / N;
      const x = -half + u * 2 * half, z = -half + v * 2 * half;
      const gi = Math.min(Math.floor(u * n), n - 1), gj = Math.min(Math.floor(v * n), n - 1);
      const h = heights[gj * s + gi];
      const k = j * N + i;
      const ub = urbanFn(x, z, h);
      const fo = forestFn(x, z, h, ub);
      urban[k] = ub; forest[k] = fo;
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
  return { tex, urban, forest, N };
}

// ---------------------------------------------------------------- material --
export function createTerrainMaterial(infoTex) {
  const uniforms = { uInfo: { value: infoTex }, uInfoHalf: { value: INNER.half } };
  return patchedMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0, envMapIntensity: 0.6 }, {
    key: 'terrain',
    uniforms,
    fragment: {
      pars: /* glsl */ `
uniform sampler2D uInfo;
uniform float uInfoHalf;
vec4 infoAt(vec2 xz) {
  vec2 uv = (xz + uInfoHalf) / (2.0 * uInfoHalf);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(-100.0, 0.0, -1.0, 0.0);
  return texture(uInfo, uv);
}
float tUrban; float tForest; float tRock; float tWet;
vec3 tWorldN;
`,
      color: /* glsl */ `
{
  vec3 wp = vWPos;
  vec3 N = normalize(vWNrm);
  float slope = 1.0 - N.y;
  vec4 info = infoAt(wp.xz);
  float h = wp.y;
  float dist = length(wp - cameraPosition);
  float detailFade = 1.0 - smoothstep(1500.0, 6000.0, dist);
  // macro variation
  float m1 = fbm2(wp.xz * 0.0019);
  float m2 = vnoise(wp.xz * 0.013);
  float m3 = vnoise(wp.xz * 0.11);
  float forestD = info.z >= 0.0 ? info.z : smoothstep(0.35, 0.65, m1 + 0.2 * (1.0 - slope)) * (1.0 - smoothstep(1500.0, 1900.0, h + m2 * 200.0));
  tUrban = info.y;
  // palette
  vec3 sand = mix(vec3(0.62, 0.57, 0.46), vec3(0.72, 0.66, 0.53), m2);
  vec3 wetSand = vec3(0.50, 0.46, 0.38);
  vec3 grass = mix(vec3(0.16, 0.30, 0.07), vec3(0.34, 0.44, 0.13), m1 * 0.8 + m3 * 0.3);
  vec3 forest = mix(vec3(0.045, 0.12, 0.035), vec3(0.09, 0.19, 0.05), m2) * (0.75 + 0.5 * m3 * detailFade + 0.25 * (1.0 - detailFade));
  vec3 rock = mix(vec3(0.20, 0.19, 0.18), vec3(0.34, 0.31, 0.27), m2);
  rock *= 0.85 + 0.3 * vnoise(vec2(wp.y * 0.05, m1 * 8.0));
  vec3 reef = mix(vec3(0.62, 0.58, 0.46), vec3(0.42, 0.50, 0.40), smoothstep(0.4, 0.7, fbm2(wp.xz * 0.02)));
  vec3 paving = mix(vec3(0.62, 0.60, 0.56), vec3(0.72, 0.70, 0.66), m3);
  // layering
  vec3 c = sand;
  float beach = smoothstep(0.7, 2.0 + m2 * 1.2, h);
  c = mix(wetSand, sand, smoothstep(-0.4, 0.8, h));
  c = mix(c, reef, smoothstep(-1.5, -4.0, h) * 0.8);
  c = mix(c, vec3(0.30, 0.34, 0.30), smoothstep(-8.0, -30.0, h));
  vec3 veg = mix(grass, forest, forestD);
  c = mix(c, veg, beach);
  // tropical volcanic slopes stay green even when steep; bare rock only on cliffs
  float mountainZone = smoothstep(120.0, 500.0, h);
  tRock = smoothstep(mix(0.34, 0.62, mountainZone), mix(0.55, 0.85, mountainZone), slope + m2 * 0.12) * beach;
  tRock = max(tRock, smoothstep(1900.0, 2300.0, h + m1 * 300.0) * 0.8);
  vec3 moss = mix(vec3(0.06, 0.15, 0.04), vec3(0.14, 0.22, 0.08), m3);
  vec3 cliff = mix(rock, moss, 0.45 * mountainZone * (1.0 - smoothstep(0.7, 0.95, slope)));
  c = mix(c, cliff, tRock);
  // cloud forest on the upper slopes: darker, bluer green
  c = mix(c, c * vec3(0.8, 0.95, 1.05), smoothstep(700.0, 1400.0, h) * (1.0 - tRock));
  // urban paving with garden courts
  float court = smoothstep(0.45, 0.55, vnoise(wp.xz * 0.02));
  vec3 urbanC = mix(paving, grass * 1.1, court * 0.55);
  c = mix(c, urbanC, tUrban * beach);
  tForest = forestD * beach * (1.0 - tUrban) * (1.0 - tRock);
  tWet = 1.0 - smoothstep(-0.2, 1.0, h);
  tWorldN = N;
  diffuseColor.rgb = c;
}
`,
      surface: /* glsl */ `
roughnessFactor = mix(0.92, 0.35, tWet);
roughnessFactor = mix(roughnessFactor, 0.6, tUrban);
roughnessFactor = mix(roughnessFactor, 0.78, tRock);
`,
      normal: /* glsl */ `
{
  float dist = length(vWPos - cameraPosition);
  float fade = 1.0 - smoothstep(200.0, 4000.0, dist);
  vec3 g1 = vnoised(vWPos.xz * 0.045);
  vec3 g2 = vnoised(vWPos.xz * 0.21 + 3.1);
  vec3 g3 = vnoised(vWPos.xz * 0.006 - 7.0);
  float amp = mix(0.35, 1.1, tForest) * (1.0 - tUrban * 0.8);
  vec2 grad = (g1.yz * 0.045 * 6.0 + g2.yz * 0.21 * 1.5 * fade) * amp * fade + g3.yz * 0.006 * 40.0 * (0.3 + tRock);
  vec3 wn = normalize(tWorldN + vec3(-grad.x, 0.0, -grad.y) * 0.9);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}
`,
      emissive: /* glsl */ `
{
  // pathways and plaza lighting in urban districts at night
  float u = tUrban;
  if (u > 0.05 && uCityLights > 0.0) {
    vec2 p = vWPos.xz;
    // lamp posts along curving garden paths: discrete warm points, not painted lines
    vec2 q = p / 14.0;
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    float lamp = step(0.55, hash12(cell)) * smoothstep(0.22, 0.0, length(f - (hash22(cell) - 0.5) * 0.5));
    float path = smoothstep(0.06, 0.0, abs(vnoise(p * 0.012) - 0.5)) ;
    float dist = length(vWPos - cameraPosition);
    float far = smoothstep(900.0, 5000.0, dist);
    float L = mix(lamp * 1.6 + path * 0.25, 0.08, far);
    vec3 tint = mix(vec3(1.0, 0.68, 0.38), vec3(0.75, 0.85, 1.0), step(0.8, hash12(cell + 3.0)));
    totalEmissiveRadiance += tint * L * u * uCityLights * 0.12;
  }
}
`,
      preAerial: /* glsl */ `
{
  // seen through the lagoon: red light is absorbed on the way down and back up,
  // sunlight is focused into dancing caustics on the sand
  float depthW = -vWPos.y;
  if (depthW > 0.0) {
    vec3 V = normalize(cameraPosition - vWPos);
    float path = depthW + depthW / max(V.y, 0.2);
    vec3 Tw = exp(-vec3(0.30, 0.055, 0.030) * path);
    vec2 cp = vWPos.xz * 0.35;
    float c1 = vnoise(cp + vec2(uTime * 0.35, uTime * 0.2));
    float c2 = vnoise(cp * 1.7 - vec2(uTime * 0.25, -uTime * 0.3));
    float caus = pow(1.0 - abs(c1 - c2), 8.0) * 1.8 * exp(-depthW * 0.12);
    vec3 sunIrr = uSunColor * uSunIlluminance * max(uSunDir.y, 0.0);
    gl_FragColor.rgb = gl_FragColor.rgb * Tw * (1.0 + caus * max(uSunDir.y, 0.0));
  }
}
`,
    },
  });
}
