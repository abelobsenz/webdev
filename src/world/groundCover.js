import * as THREE from 'three';
import { patchedMaterial } from './materials.js';
import { NATURE_GLSL, NATURE_U } from './natureGlsl.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { INNER, TERRAIN_DATA, FAR_ISLANDS } from './terrain.js';
import { outerCities, renderedHeight } from './outerCities.js';
import { SKYLINE_KEEPOUT } from './skyline.js';
import { PLAZA_R } from './layout.js';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';
import { U } from '../core/uniforms.js';

// Living ground cover: real 3D grass on every lawn, verge and meadow, flowers in the beds
// and wildflower drifts, and leafy perennials in the verge beds beside the buildings.
//
// Each layer is an instanced mesh over a camera-centred grid of cells. A small GPU pass
// classifies every cell with the terrain shader's own rules (lawn / meadow / bed / paving /
// sand / rock / forest floor, building footprints) and writes height, normal, scale and
// colour into a float texture, recomputed only when the grid recentres; the blade vertices
// then need a single texel fetch. Blades are coloured from the same palettes the terrain
// paints, widen and thin out with distance (constant coverage, no shimmer), and hand over
// to the painted lawn beyond the last ring.

const TAU = Math.PI * 2;

// ------------------------------------------------------------------ footprints --
// Signed distance to the nearest building footprint (lot + podium apron) or tower /
// station base, like the street field: RGBA8-free R8 over the inner grid, +-16 m.
const OCC_N = 4096, OCC_R = 16;
function buildOccupancy(world) {
  const half = INNER.half, N = OCC_N, cell = (2 * half) / N;
  const dist = new Float32Array(N * N).fill(OCC_R);
  const range = (x0, z0, x1, z1) => [
    Math.max(0, Math.floor((x0 + half) / cell)), Math.min(N - 1, Math.ceil((x1 + half) / cell)),
    Math.max(0, Math.floor((z0 + half) / cell)), Math.min(N - 1, Math.ceil((z1 + half) / cell)),
  ];
  const box = (x, z, w, d, rot) => {
    const hw = w / 2, hd = d / 2, c = Math.cos(rot), s = Math.sin(rot);
    const R = Math.hypot(hw, hd) + OCC_R;
    const [i0, i1, j0, j1] = range(x - R, z - R, x + R, z + R);
    for (let j = j0; j <= j1; j++) {
      const pz = -half + (j + 0.5) * cell - z;
      for (let i = i0; i <= i1; i++) {
        const px = -half + (i + 0.5) * cell - x;
        const lx = px * c - pz * s, lz = px * s + pz * c;
        const qx = Math.abs(lx) - hw, qz = Math.abs(lz) - hd;
        const o = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
        const k = j * N + i;
        if (o < dist[k]) dist[k] = o;
      }
    }
  };
  const circle = (x, z, r) => {
    const R = r + OCC_R;
    const [i0, i1, j0, j1] = range(x - R, z - R, x + R, z + R);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const o = Math.hypot(-half + (i + 0.5) * cell - x, -half + (j + 0.5) * cell - z) - r;
      const k = j * N + i;
      if (o < dist[k]) dist[k] = o;
    }
  };
  const plan = world.plan;
  if (plan) for (const L of plan.lots) box(L.x, L.z, L.w + 1.6, L.d + 1.6, L.rot);   // podium + apron
  for (const t of world.towers || []) {
    if (Math.abs(t.def.x) > half || Math.abs(t.def.z) > half) continue;
    circle(t.def.x, t.def.z, (t.footprint || (t.collide ? t.collide(0) : 40)) + 2);
  }
  for (const st of (world.infra && world.infra.stations) || []) circle(st.x, st.z, st.r);
  circle(0, 0, PLAZA_R);                // under the Commons' stone disc: nothing to see, nothing to grow
  const data = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) data[k] = Math.max(0, Math.min(255, Math.round((dist[k] + OCC_R) * (255 / (2 * OCC_R)))));
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------- shared GLSL --
// placement record packing, and the jittered root of a cell (both passes must agree)
const PACK_GLSL = /* glsl */ `
float packRGB(vec3 c) { vec3 q = floor(clamp(c, 0.0, 1.0) * 255.0 + 0.5); return q.r * 65536.0 + q.g * 256.0 + q.b; }
vec3 unpackRGB(float v) { float r = floor(v / 65536.0); float g = floor((v - r * 65536.0) / 256.0); float b = v - r * 65536.0 - g * 256.0; return vec3(r, g, b) / 255.0; }
float packN(vec3 n) { vec2 q = floor(clamp(n.xz * 0.5 + 0.5, 0.0, 1.0) * 1023.0 + 0.5); return q.x * 1024.0 + q.y; }
vec3 unpackN(float v) { float x = floor(v / 1024.0); float z = v - x * 1024.0; vec2 xz = vec2(x, z) / 1023.0 * 2.0 - 1.0; return normalize(vec3(xz.x, sqrt(max(1.0 - dot(xz, xz), 0.02)), xz.y)); }
vec2 gcRoot(vec2 cid, float cell) { return (cid + 0.5 + (hash22(cid * 1.37 + 11.0) - 0.5) * 0.92) * cell; }
`;

const GROUND_GLSL = /* glsl */ `
uniform sampler2D uInfo;
uniform sampler2D uNature;
uniform sampler2D uHeight;
uniform sampler2D uOcc;
uniform float uInfoHalf;
uniform float uHN;
vec4 gcInfo(vec2 p) {
  vec2 uv = (p + uInfoHalf) / (2.0 * uInfoHalf);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(-100.0, 0.0, -1.0, 0.0);
  return textureLod(uInfo, uv, 0.0);
}
vec4 gcNature(vec2 p, float h) {
  vec2 uv = (p + uInfoHalf) / (2.0 * uInfoHalf);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(h * 12.0, 1.0, 0.0, 0.0);
  return textureLod(uNature, uv, 0.0);
}
// signed metres to the nearest building / tower / station footprint (< 0 inside)
float gcOcc(vec2 p) { return textureLod(uOcc, p / (2.0 * uInfoHalf) + 0.5, 0.0).r * 32.0 - 16.0; }
// the terrain surface exactly as the inner mesh triangulates it (alternating diagonals)
float gcHeight(vec2 p, out vec3 nrm) {
  float st = 2.0 * uInfoHalf / uHN;
  vec2 g = (p + uInfoHalf) / st;
  vec2 c = clamp(floor(g), vec2(0.0), vec2(uHN - 1.0));
  vec2 f = clamp(g - c, 0.0, 1.0);
  ivec2 i = ivec2(c);
  float a = texelFetch(uHeight, i, 0).r, b = texelFetch(uHeight, i + ivec2(1, 0), 0).r;
  float cc = texelFetch(uHeight, i + ivec2(0, 1), 0).r, d = texelFetch(uHeight, i + ivec2(1, 1), 0).r;
  float h;
  if (mod(c.x + c.y, 2.0) > 0.5) {
    if (f.x + f.y <= 1.0) { h = a + (b - a) * f.x + (cc - a) * f.y; nrm = vec3(-(b - a), st, -(cc - a)); }
    else { h = d + (cc - d) * (1.0 - f.x) + (b - d) * (1.0 - f.y); nrm = vec3(-(d - cc), st, -(d - b)); }
  } else {
    if (f.x >= f.y) { h = a + (b - a) * f.x + (d - b) * f.y; nrm = vec3(-(b - a), st, -(d - b)); }
    else { h = a + (cc - a) * f.y + (d - cc) * f.x; nrm = vec3(-(d - cc), st, -(cc - a)); }
  }
  nrm = normalize(nrm);
  return h;
}
// The far islands have no surveyed grid: a camera-following tile sampled on the CPU from
// renderedHeight() (the surface actually drawn), r = height, g = metres to the nearest
// built footprint / quay (< 0 inside). Bilinear over its 4 m texels.
uniform sampler2D uLocal;
uniform vec4 uLocalR;       // x0, z0, texel step, texels per side (0 = no tile)
bool gcLocal(vec2 p, out float h, out vec3 nrm, out float keep) {
  vec2 g = (p - uLocalR.xy) / uLocalR.z;
  if (uLocalR.w < 2.0 || any(lessThan(g, vec2(0.0))) || any(greaterThanEqual(g, vec2(uLocalR.w - 1.0)))) return false;
  vec2 c = floor(g), f = g - c;
  ivec2 i = ivec2(c);
  vec2 a = texelFetch(uLocal, i, 0).rg, b = texelFetch(uLocal, i + ivec2(1, 0), 0).rg;
  vec2 cc = texelFetch(uLocal, i + ivec2(0, 1), 0).rg, d = texelFetch(uLocal, i + ivec2(1, 1), 0).rg;
  vec2 v = mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
  h = v.x;
  keep = min(v.y, min(min(a.x, b.x), min(cc.x, d.x)) < 0.3 ? -1.0 : 16.0);   // never at the waterline
  nrm = normalize(vec3(-mix(b.x - a.x, d.x - cc.x, f.y), uLocalR.z, -mix(cc.x - a.x, d.x - b.x, f.x)));
  return true;
}
${PACK_GLSL}
`;

// Classification: the terrain shader's ground rules at one point. Returns
//   x lawn / grassland cover, y meadow (unmown) share, z verge-bed cover, w hedge band;
// col = the grass colour the terrain paints there; also forest and strand shares.
const CLASSIFY_GLSL = /* glsl */ `
vec4 gcClassify(vec2 p, float h, vec3 n, out vec3 col, out float forestD, out float strand, out float natW, out float uwOut) {
  vec4 info = gcInfo(p);
  vec4 nat = gcNature(p, h);
  float urban = max(info.y, 0.0);
  float slope = 1.0 - n.y;
  float m1 = fbm2(p * 0.0017), m2 = vnoise(p * 0.013), m3 = vnoise(p * 0.11);
  float expo = nat.y;
  float mz = smoothstep(80.0, 420.0, h);
  vec4 stS = streetAt(p);
  float stE = streetEdge(stS), stC = streetCentre(stS);
  float stHW = abs(stC) - stE;
  float nearStreet = max(1.0 - smoothstep(3.0, 9.0, stE), smoothstep(0.1, 0.5, stS.b));
  forestD = info.z >= 0.0 ? info.z : 0.0;
  forestD *= 1.0 - nearStreet;
  float beachTop = 1.5 + 1.3 * m2 + 1.4 * expo;
  float wVeg = smoothstep(beachTop - 0.5, beachTop + 0.9, h);
  float rockT = slope + (m2 - 0.5) * 0.2 + (m3 - 0.5) * 0.08;
  float wRock = smoothstep(mix(0.30, 0.48, mz), mix(0.44, 0.64, mz), rockT) * smoothstep(0.3, 3.0, h);
  wRock = max(wRock, smoothstep(1850.0, 2250.0, h + m1 * 320.0) * 0.8);
  strand = 1.0 - smoothstep(beachTop + 1.0, beachTop + 6.0, h);
  // natural grassland (reduced to a sparse understorey under the canopy)
  natW = wVeg * (1.0 - wRock);
  vec3 g = mix(vec3(0.07, 0.145, 0.028), vec3(0.15, 0.22, 0.05), clamp(m1 * 0.9 + m3 * 0.35 - 0.1, 0.0, 1.0));
  g = mix(g, vec3(0.22, 0.21, 0.09), smoothstep(0.58, 0.82, m2) * 0.35 * (1.0 - forestD));
  g = mix(g, g * vec3(1.3, 1.12, 0.78), smoothstep(0.55, 0.8, vnoise(p * 0.05 + 21.0)) * 0.45);
  g = mix(g, vec3(0.2, 0.22, 0.08), strand * 0.55);
  float pa = fbm2_3(p * 0.0021 + 31.0);
  g = mix(g, vec3(0.2, 0.2, 0.07), smoothstep(0.55, 0.7, pa) * 0.55 * smoothstep(20.0, 160.0, h));
  float uw = 0.0, lawn = 0.0, bed = 0.0, hedge = 0.0, meadow = 0.0, pav = 0.0;
  vec3 lc = g;
  if (urban > 0.05 || nearStreet > 0.01) {
    float e = stE;
    float onStreet = 1.0 - smoothstep(-0.04, 0.04, e);
    float square = smoothstep(0.3, 0.7, stS.b);
    float isAve = smoothstep(6.5, 7.5, stHW), isLane = 1.0 - smoothstep(3.6, 4.4, stHW);
    float median = isAve * (1.0 - smoothstep(2.08, 2.12, abs(stC))) * onStreet * (1.0 - square);
    float border = smoothstep(0.35, 0.8, e) * (1.0 - smoothstep(2.6, 3.2, e)) * (1.0 - isLane) * (1.0 - square);
    border = max(border, median * (1.0 - smoothstep(1.5, 1.9, abs(stC))));
    hedge = smoothstep(0.35, 0.42, e) * (1.0 - smoothstep(0.88, 0.95, e)) * (1.0 - median) * border;
    float paved = max(onStreet * (1.0 - median), square);
    pav = paved;
    uw = max(smoothstep(0.08, 0.4, urban), nearStreet) * wVeg * (1.0 - wRock * 0.7);
    bed = border * (1.0 - paved) * uw;
    lawn = (1.0 - paved) * (1.0 - border) * uw;
    meadow = smoothstep(0.58, 0.62, fbm2_3(p * 0.009 + 21.0));
    lc = mix(vec3(0.075, 0.15, 0.03), vec3(0.12, 0.21, 0.045), m3);
    lc = mix(lc, vec3(0.16, 0.19, 0.07), smoothstep(0.6, 0.85, m2) * 0.4);
    float dry = smoothstep(0.55, 0.8, vnoise(p * 0.07 + 13.0));
    lc = mix(lc, lc * vec3(1.35, 1.14, 0.76), dry * 0.6);
    lc *= 0.9 + 0.2 * vnoise(p * 0.21 + 4.0);
    lc = mix(lc, lc * vec3(1.22, 1.08, 0.72), meadow);
  }
  col = mix(g, lc, uw);
  uwOut = uw;
  // wild grass never on paving (rocky ground leaves uw short of 1 on a square)
  float grass = lawn + natW * (1.0 - uw) * (1.0 - forestD * 0.8) * (1.0 - pav);
  return vec4(grass, meadow * lawn / max(grass, 1e-3), bed, hedge);
}
`;

// ------------------------------------------------------------------- placement --
// layer: 0 grass, 1 flowers, 2 bed perennials. Output RGBA32F:
//   r = ground height, g = scale (0 = nothing here), b = packed colour, a = packed normal
const PLACE_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uOriginCell;   // integer cell id of texel (0,0)
uniform float uCell;
uniform float uN;
uniform float uLayer;
uniform float uBloom;
varying vec2 vUv;
${NOISE_GLSL}
${NATURE_GLSL}
${GROUND_GLSL}
${CLASSIFY_GLSL}
void main() {
  vec2 ij = floor(vUv * uN);
  vec2 cid = uOriginCell + ij;
  vec2 p = gcRoot(cid, uCell);
  vec3 n;
  float h;
  if (abs(p.x) < uInfoHalf - 20.0 && abs(p.y) < uInfoHalf - 20.0) {
    h = gcHeight(p, n);
    if (h < 0.6 || gcOcc(p) < 0.4) { gl_FragColor = vec4(h, 0.0, 0.0, 0.0); return; }
  } else {
    // outer land: natural grassland only (gcClassify sees no grid, streets or forest mask there)
    float keep;
    if (!gcLocal(p, h, n, keep)) { gl_FragColor = vec4(0.0); return; }
    if (h < 0.6 || keep < 0.4) { gl_FragColor = vec4(h, 0.0, 0.0, 0.0); return; }
  }
  vec3 col; float forestD, strand, natW, uw;
  vec4 k = gcClassify(p, h, n, col, forestD, strand, natW, uw);
  float r = hash12(cid * 0.731 + 5.0);
  float scale = 0.0;
  vec3 outC = col;
  if (uLayer < 0.5) {
    // grass: mown lawns short, meadows and wild grassland long, strand grass wiry, a thin
    // understorey in the forest. Probabilistic thinning keeps the edges soft.
    float cover = k.x * (1.0 - k.z);
    if (r < cover) {
      float hgt = mix(0.17, 0.6, k.y);                                           // mown lawn -> unmown meadow
      float wildH = mix(0.32 + 0.3 * vnoise(p * 0.05 + 3.0), 0.4, strand);       // grassland, strand grass
      hgt = mix(wildH, hgt, uw);
      hgt *= 1.0 - 0.45 * forestD;
      hgt *= 0.75 + 0.5 * vnoise(p * 0.9 + 7.0);                                 // clumps and hollows
      scale = hgt;
      outC = col;
    }
  } else if (uLayer < 1.5) {
    // flowers: in the verge beds (on the terrain's own perennial drifts), wildflower drifts
    // in the unmown lawns, and scattered wildflowers in the grassland
    vec3 wv = worley2(p * 0.9);
    float plant = 1.0 - smoothstep(0.3, 0.66, wv.x);
    float bloom = smoothstep(0.5, 0.75, vnoise(p * 6.0 + wv.z * 20.0)) * step(0.55, fract(wv.z * 3.7)) * uBloom;
    float bedF = k.z * (1.0 - k.w) * plant * bloom;
    float drift = smoothstep(0.78, 0.9, vnoise(p * 3.7)) * smoothstep(0.4, 0.7, vnoise(p * 0.3 + 8.0)) * k.y * k.x;
    vec2 fcell = floor(p * 3.0);
    float wild = step(0.972, hash12(fcell)) * (1.0 - forestD) * natW * (1.0 - uw);
    if (r < bedF * 0.9) { scale = 0.3 + 0.35 * hash12(cid + 3.0); outC = flowerPalette(fract(wv.z * 7.3)); }
    else if (r < drift * 0.8) { scale = 0.35 + 0.25 * hash12(cid + 5.0); outC = flowerPalette(vnoise(p * 0.05 + 3.0)); }
    else if (wild > 0.5) { scale = 0.22 + 0.2 * hash12(cid + 9.0); outC = flowerPalette(hash12(fcell + 7.0)); }
  } else {
    // bed perennials: leafy clumps on the terrain's plant cells, clear of the hedge band
    vec3 wv = worley2(p * 0.9);
    float plant = 1.0 - smoothstep(0.3, 0.66, wv.x);
    float bedP = k.z * (1.0 - k.w) * plant;
    if (r < bedP) {
      scale = 0.28 + 0.4 * plant * (0.7 + 0.6 * fract(wv.z * 5.3));
      outC = mix(vec3(0.03, 0.07, 0.02), vec3(0.1, 0.16, 0.045), fract(wv.z * 3.1)) * 1.15;
    }
  }
  gl_FragColor = vec4(h, scale, packRGB(outC), packN(n));
}
`;

// --------------------------------------------------------------------- geometry --
/** A tuft of `blades` blades, `segs` segments each: position.x = side (-0.5..0.5), y = t, z = blade index. */
function tuftGeometry(blades, segs) {
  const pos = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      if (s === segs) { pos.push(0, 1, b); }
      else { pos.push(-0.5, t, b, 0.5, t, b); }
    }
    for (let s = 0; s < segs; s++) {
      const a = base + s * 2;
      if (s === segs - 1) idx.push(a, a + 1, a + 2);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** A flower: stem, two leaves and a five-petalled head. aPart: 0 stem/leaf, 1 petal, 2 centre. */
function flowerGeometry() {
  const pos = [], part = [], idx = [];
  const v = (x, y, z, p) => { pos.push(x, y, z); part.push(p); return pos.length / 3 - 1; };
  // stem: a thin ribbon (y 0..1 of the plant height)
  const s0 = v(-0.012, 0, 0, 0), s1 = v(0.012, 0, 0, 0), s2 = v(-0.008, 0.97, 0, 0), s3 = v(0.008, 0.97, 0, 0);
  idx.push(s0, s1, s2, s1, s3, s2);
  // two leaves
  for (const [a, y] of [[0.4, 0.28], [3.6, 0.45]]) {
    const c = Math.cos(a), s = Math.sin(a);
    const b0 = v(0, y, 0, 0), b1 = v(c * 0.16 - s * 0.035, y + 0.1, s * 0.16 + c * 0.035, 0);
    const b2 = v(c * 0.28, y + 0.05, s * 0.28, 0), b3 = v(c * 0.16 + s * 0.035, y + 0.06, s * 0.16 - c * 0.035, 0);
    idx.push(b0, b1, b2, b0, b2, b3);
  }
  // head: centre and five petals (in head units; the shader scales the head separately)
  const hc = v(0, 1.0, 0, 2);
  const ring = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU, r = k % 2 === 0 ? 1.0 : 0.42;
    ring.push(v(Math.cos(a) * r, 1.0 + (k % 2 === 0 ? 0.12 : 0.02), Math.sin(a) * r, 1));
  }
  for (let k = 0; k < 10; k++) idx.push(hc, ring[k], ring[(k + 1) % 10]);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

/** A perennial clump: seven arching leaves round the crown. */
function clumpGeometry() {
  const pos = [], idx = [];
  const L = 7, segs = 3;
  for (let l = 0; l < L; l++) {
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      if (s === segs) pos.push(0, t, l);
      else pos.push(-0.5, t, l, 0.5, t, l);
    }
    for (let s = 0; s < segs; s++) {
      const a = base + s * 2;
      if (s === segs - 1) idx.push(a, a + 1, a + 2);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// ----------------------------------------------------------------- blade shaders --
const INSTANCE_PARS = /* glsl */ `
uniform sampler2D uPlace;
uniform vec2 uOriginCell;
uniform float uCell;
uniform float uN;
uniform float uRIn;
uniform float uROut;
uniform float uPixAng;
uniform float uWidthK;
varying vec3 vGC;
varying float vGT;
varying float vGPart;
${PACK_GLSL}
`;

// common instance setup: fetch placement, ring fade, frustum cull. Sets gRoot, gH, gS,
// gN, gCol, gKeep (0 = collapse), gDist, gHash.
const INSTANCE_SETUP = /* glsl */ `
  int iN = int(uN);
  ivec2 ij = ivec2(gl_InstanceID % iN, gl_InstanceID / iN);
  vec4 pl = texelFetch(uPlace, ij, 0);
  vec2 cid = uOriginCell + vec2(ij);
  vec2 gRoot = gcRoot(cid, uCell);
  float gH = pl.r, gS = pl.g;
  vec3 gN = unpackN(pl.a);
  vec3 gCol = unpackRGB(pl.b);
  float gHash = hash12(cid * 0.917 + 3.0);
  float gDist = length(gRoot - cameraPosition.xz);
  float band = (uROut - uRIn) * 0.18 + 2.0;
  float ringW = smoothstep(uRIn - band, uRIn, gDist) * (1.0 - smoothstep(uROut - band, uROut, gDist));
  if (uRIn <= 0.0) ringW = 1.0 - smoothstep(uROut - band, uROut, gDist);
  // blades widen with distance to at least ~1.4 px, and thin out to keep the same cover
  float pxW = gDist * uPixAng * 1.4;
  float widen = max(1.0, pxW / uWidthK);
  float gKeep = step(gHash, ringW / widen) * step(0.001, gS);
  vec4 cc = projectionMatrix * viewMatrix * vec4(gRoot.x, gH + gS * 0.5, gRoot.y, 1.0);
  if (cc.w > 0.0) { vec2 ndc = cc.xy / cc.w; if (any(greaterThan(abs(ndc), vec2(1.25)))) gKeep = 0.0; }
  else if (gDist > 4.0) gKeep = 0.0;
`;

const GRASS_TRANSFORM = /* glsl */ `
{
  ${INSTANCE_SETUP}
  float bi = position.z, t = position.y;
  float hb = hash12(cid * 1.31 + bi * 7.7 + 1.0);
  float ang = hash12(cid * 2.17 + bi * 3.3) * 6.2831853;
  vec2 off = (hash22(cid * 0.61 + bi * 5.1) - 0.5) * uCell * 0.7;
  float H = gS * (0.65 + 0.55 * hb);
  float W = uWidthK * widen * (0.8 + 0.4 * hb);
  vec2 fdir = vec2(cos(ang), sin(ang));            // the blade faces this way
  vec2 sdir = vec2(-fdir.y, fdir.x);               // and spreads along this
  // natural curvature, a random lean, and wind: a steady sway plus travelling gusts
  vec2 wind = uWind * (0.55 + 0.45 * sin(uTime * 1.3 + dot(gRoot, vec2(0.21, 0.17))))
            + uWind * 0.8 * (vnoise(gRoot * 0.07 - uWind * uTime * 0.35) - 0.35);
  vec2 lean = fdir * (0.18 + 0.35 * hb) + wind * 0.55;
  float bend = t * t;
  vec2 xz = gRoot + off + sdir * position.x * W * (1.0 - t * 0.85) + lean * H * bend;
  float y = gH + H * t * (1.0 - 0.28 * bend * length(lean)) - 0.02;
  gcP = vec3(xz.x, y, xz.y) * gKeep;
  // normal: the blade face, bent back and rounded across, blended toward the ground normal
  vec3 bn = normalize(vec3(fdir.x, 0.35 + t * 0.4, fdir.y) + vec3(sdir.x, 0.0, sdir.y) * position.x * 0.9);
  gcN = normalize(mix(bn, gN, 0.45));
  // each blade its own shade: greener, yellower, a few dry ones
  float hc = hash12(cid * 3.3 + bi * 1.7);
  vGC = gCol * (0.78 + 0.44 * hb) * vec3(1.0 + 0.2 * (hc - 0.5), 1.0, 1.0 - 0.25 * (hc - 0.5));
  vGC = mix(vGC, vec3(0.34, 0.3, 0.14), step(0.94, hc) * 0.6);
  vGT = t;
  vGPart = 0.0;
}
`;

const FLOWER_TRANSFORM = /* glsl */ `
{
  ${INSTANCE_SETUP}
  float part = aPart;
  float hb = hash12(cid * 1.9 + 4.0);
  float ang = hb * 6.2831853;
  float c = cos(ang), s = sin(ang);
  vec2 wind = uWind * (0.5 + 0.5 * sin(uTime * 1.1 + dot(gRoot, vec2(0.3, 0.2)))) * 0.08;
  float H = gS;
  vec3 p = position;
  float head = 0.028 + 0.03 * hash12(cid + 17.0);
  vec3 q;
  if (part > 0.5) {
    // the head: petals round a centre, tilted toward the light
    q = vec3(p.x * head, H, p.z * head);
    q.y += (p.y - 1.0) * head * 2.0;
  } else {
    q = vec3(p.x * H, p.y * H, p.z * H);
    q.xz *= 1.0 + 0.0 * p.y;
  }
  vec2 r = vec2(q.x * c - q.z * s, q.x * s + q.z * c);
  float sway = clamp(q.y / max(H, 0.01), 0.0, 1.0);
  vec2 xz = gRoot + r + wind * sway * H * 4.0;
  gcP = vec3(xz.x, gH + q.y - 0.01, xz.y) * gKeep;
  gcN = normalize(mix(vec3(0.0, 1.0, 0.0), gN, 0.3));
  vGC = part > 1.5 ? mix(vec3(0.95, 0.78, 0.2), gCol, 0.35) : part > 0.5 ? gCol : vec3(0.07, 0.16, 0.035);
  vGT = part > 0.5 ? 1.0 : p.y;
  vGPart = part;
}
`;

const CLUMP_TRANSFORM = /* glsl */ `
{
  ${INSTANCE_SETUP}
  float li = position.z, t = position.y;
  float hb = hash12(cid * 1.7 + li * 3.9);
  float ang = (li / 7.0 + hash12(cid * 0.3) ) * 6.2831853;
  vec2 dir = vec2(cos(ang), sin(ang)), side = vec2(-dir.y, dir.x);
  float H = gS * (0.75 + 0.5 * hb);
  float W = 0.06 + 0.05 * gS;
  vec2 wind = uWind * (0.4 + 0.3 * sin(uTime * 0.9 + dot(gRoot, vec2(0.2, 0.3)))) * 0.1;
  // arching leaf: up and out, the tip drooping
  float outR = H * (0.15 + 0.55 * t);
  float y = H * (sin(t * 2.4) * 0.72);
  vec2 xz = gRoot + dir * outR + side * position.x * W * sin(3.14159 * max(t, 0.12)) + wind * t * H;
  gcP = vec3(xz.x, gH + y - 0.01, xz.y) * gKeep;
  gcN = normalize(vec3(dir.x * 0.4, 1.0 - t * 0.5, dir.y * 0.4));
  vGC = gCol * (0.85 + 0.3 * hb);
  vGT = t;
  vGPart = 0.0;
}
`;

function layerMaterial(transform, place, uniforms, { flower = false } = {}) {
  const u = { uPlace: { value: place }, ...uniforms };
  return patchedMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, side: THREE.DoubleSide }, {
    key: `groundcover-${transform.length}-${flower ? 'f' : 'g'}`,
    uniforms: u,
    vertex: {
      pars: INSTANCE_PARS + (flower ? 'attribute float aPart;' : '') + '\nvec3 gcN; vec3 gcP;',
      // the blade is built before three derives its normals, so the lighting normal and
      // the position come from the same instance record
      preNormal: transform + '\nobjectNormal = gcN;',
      transform: 'transformed = gcP;',
    },
    fragment: {
      pars: 'varying vec3 vGC; varying float vGT; varying float vGPart;',
      color: `
        // darker, cooler down in the sward; sun-bleached tips
        vec3 gc = vGC * mix(0.42, 1.25, smoothstep(0.0, 0.95, vGT));
        gc = mix(gc, gc * vec3(1.18, 1.1, 0.8), smoothstep(0.7, 1.0, vGT) * 0.4 * step(vGPart, 0.5));
        diffuseColor.rgb = gc;`,
      surface: 'roughnessFactor = vGPart > 0.5 ? 0.55 : mix(0.75, 0.5, vGT);',
      // light through the blades: a warm-green glow when looking toward the sun
      emissive: `{
        vec3 vdir = normalize(vWPos - cameraPosition);
        float back = pow(max(dot(vdir, uSunDir), 0.0), 3.0) * smoothstep(0.0, 0.25, uSunDir.y);
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * back * vGT * 0.35;
      }`,
    },
  });
}

// --------------------------------------------------------------------- the system --
// far-island tile: texel spacing and recentring step (m); nothing nearer the capital than
// LT_RMIN (the Outer Wards reach 17.5 km, the far islands' shores start at 22 km)
const LT_STEP = 4, LT_SNAP = 64, LT_RMIN = 19000;
const LAYERS = [
  // grass: dense multi-blade tufts close by, simpler blades further out
  { kind: 'grass', layer: 0, cell: 0.22, rIn: 0, rOut: 38, blades: 3, segs: 4, width: 0.016 },
  { kind: 'grass', layer: 0, cell: 0.7, rIn: 34, rOut: 105, blades: 3, segs: 2, width: 0.034 },
  { kind: 'grass', layer: 0, cell: 1.6, rIn: 98, rOut: 220, blades: 2, segs: 1, width: 0.075 },
  { kind: 'flower', layer: 1, cell: 1 / 3, rIn: 0, rOut: 42 },
  { kind: 'clump', layer: 2, cell: 0.6, rIn: 0, rOut: 40 },
];

export class GroundCover {
  constructor(world, settings) {
    this.world = world;
    this.scene = world.scene;
    this.renderer = world.app.renderer;
    this.occ = buildOccupancy(world);
    this.common = {
      uInfo: { value: world.info.tex }, uNature: { value: TERRAIN_DATA.natureTex }, uHeight: { value: TERRAIN_DATA.heightTex },
      uOcc: { value: this.occ }, uInfoHalf: { value: INNER.half }, uHN: { value: INNER.n },
      uLocal: { value: null }, uLocalR: { value: new THREE.Vector4(0, 0, LT_STEP, 0) },
      uStreets: NATURE_U.uStreets, uStreetHalf: NATURE_U.uStreetHalf, uStreetFrame: NATURE_U.uStreetFrame, uBloom: NATURE_U.uBloom,
    };
    this.layers = [];
    this.enabled = true;
    this.scaleQ = 1;
    this.applyQuality(settings, true);
  }

  _build() {
    for (const L of this.layers) { this.scene.remove(L.mesh); L.mesh.geometry.dispose(); L.mesh.material.dispose(); L.rt.dispose(); L.placeMat.dispose(); }
    this.layers = [];
    if (!this.enabled) return;
    for (const def of LAYERS) {
      const q = this.scaleQ;
      const rOut = def.rOut * q, rIn = def.rIn * q;
      const snap = 16;
      const N = Math.ceil((2 * rOut) / def.cell) + 2 * snap;
      const rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
      const placeU = {
        ...this.common, uOriginCell: { value: new THREE.Vector2() }, uCell: { value: def.cell }, uN: { value: N }, uLayer: { value: def.layer },
      };
      const placeMat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: PLACE_FRAG, uniforms: placeU, depthTest: false, depthWrite: false });
      const shared = {
        uOriginCell: placeU.uOriginCell, uCell: placeU.uCell, uN: placeU.uN, uRIn: { value: rIn }, uROut: { value: rOut },
        uPixAng: { value: 0.001 }, uWidthK: { value: def.width || 0.02 },
      };
      let geo, mat;
      if (def.kind === 'grass') { geo = tuftGeometry(def.blades, def.segs); mat = layerMaterial(GRASS_TRANSFORM, rt.texture, shared); }
      else if (def.kind === 'flower') { geo = flowerGeometry(); mat = layerMaterial(FLOWER_TRANSFORM, rt.texture, shared, { flower: true }); }
      else { geo = clumpGeometry(); mat = layerMaterial(CLUMP_TRANSFORM, rt.texture, shared); }
      geo.instanceCount = N * N;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.layers.set(1);                 // main view only (not the water reflection)
      mesh.name = `Ground cover (${def.kind} ${rIn.toFixed(0)}-${rOut.toFixed(0)} m)`;
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      this.layers.push({ def, N, snap, rt, placeMat, pass: new FullscreenPass(placeMat), mesh, shared, origin: new THREE.Vector2(1e9, 1e9), dirty: true });
    }
  }

  applyQuality(s, init = false) {
    const q = s.grass ?? (s.lowrise >= 1 ? 1 : s.lowrise >= 0.75 ? 0.65 : 0);
    const enabled = q > 0.01;
    if (!init && q === this.scaleQ && enabled === this.enabled) return;
    this.scaleQ = Math.max(q, 0.3);
    this.enabled = enabled;
    this._build();
  }

  update(dt, t, camera) {
    if (!this.enabled || !camera) return;
    const r = this.renderer;
    const fovPix = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)) / Math.max(r.domElement.height, 1);
    const cp = camera.position;
    const outside = Math.max(Math.abs(cp.x), Math.abs(cp.z)) > INNER.half - 60;
    const alt = cp.y - Math.max(outside ? renderedHeight(cp.x, cp.z) : this.world.groundHeight(cp.x, cp.z), 0);
    const visible = alt < 260 * this.scaleQ;
    if (visible) this._updateLocal(cp.x, cp.z);
    for (const L of this.layers) {
      L.mesh.visible = visible;
      L.shared.uPixAng.value = fovPix;
      if (!visible) continue;
      // recentre the cell grid in steps of `snap` cells, then reclassify it
      const c = L.def.cell, step = c * L.snap;
      const ox = Math.floor(camera.position.x / step) * step, oz = Math.floor(camera.position.z / step) * step;
      if (ox !== L.origin.x || oz !== L.origin.y || L.dirty) {
        L.origin.set(ox, oz);
        const oc = L.shared.uOriginCell.value;
        oc.set(Math.round(ox / c) - Math.floor(L.N / 2), Math.round(oz / c) - Math.floor(L.N / 2));
        const prev = r.getRenderTarget();
        L.pass.render(r, L.rt);
        r.setRenderTarget(prev);
        L.dirty = false;
      }
    }
  }

  // The far-island height / keep-out tile around the camera (see gcLocal). Recentred in 64 m
  // steps; each refill is ~25k memoised surface samples (a few ms) and reclassifies the layers.
  _updateLocal(x, z) {
    const R = this.common.uLocalR.value;
    const reach = Math.max(...LAYERS.map((d) => d.rOut * this.scaleQ + 16 * d.cell)) + LT_SNAP / 2 + 2 * LT_STEP;
    const isl = FAR_ISLANDS.find(([ix, iz, ir]) => Math.hypot(x - ix, z - iz) < ir * 3 + reach);
    if (!isl || Math.hypot(x, z) < LT_RMIN - reach) {
      if (R.w !== 0) { R.w = 0; this.invalidate(); }
      return;
    }
    const N = 2 * Math.ceil(reach / LT_STEP) + 1;
    const cx = Math.round(x / LT_SNAP) * LT_SNAP, cz = Math.round(z / LT_SNAP) * LT_SNAP;
    let lt = this.lt;
    if (lt && lt.N === N && lt.cx === cx && lt.cz === cz && R.w === N) return;
    if (!lt || lt.N !== N) {
      if (lt) lt.tex.dispose();
      const data = new Float32Array(N * N * 4);
      const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      lt = this.lt = { N, data, tex };
      this.common.uLocal.value = tex;
    }
    lt.cx = cx; lt.cz = cz;
    const half = ((N - 1) / 2) * LT_STEP, x0 = cx - half, z0 = cz - half;
    // keep-out: districts, landmarks, villas and lighthouses (skyline.js), and the quays with
    // the 70 m quay top behind them, pre-culled to the tile
    if (!this.quays) {
      this.quays = [];
      for (const c of outerCities().islands) for (let k = 0; k < c.quayLine.length - 1; k++) this.quays.push([...c.quayLine[k], ...c.quayLine[k + 1]]);
    }
    const lim = half * 1.42 + 20;
    const circ = SKYLINE_KEEPOUT.filter((c) => Math.hypot(c.x - cx, c.z - cz) < lim + c.r);
    const segs = this.quays.filter((q) => Math.hypot((q[0] + q[2]) / 2 - cx, (q[1] + q[3]) / 2 - cz) < lim + 200);
    const d = lt.data;
    for (let j = 0; j < N; j++) {
      const pz = z0 + j * LT_STEP;
      for (let i = 0; i < N; i++) {
        const px = x0 + i * LT_STEP, k = (j * N + i) * 4;
        d[k] = renderedHeight(px, pz);
        let keep = 16;
        if (Math.hypot(px, pz) < LT_RMIN) keep = -16;
        else {
          for (const c of circ) { const o = Math.hypot(px - c.x, pz - c.z) - c.r; if (o < keep) keep = o; }
          for (const q of segs) {
            const vx = q[2] - q[0], vz = q[3] - q[1], t = Math.min(1, Math.max(0, ((px - q[0]) * vx + (pz - q[1]) * vz) / (vx * vx + vz * vz || 1)));
            const o = Math.hypot(px - q[0] - vx * t, pz - q[1] - vz * t) - 80;
            if (o < keep) keep = o;
          }
        }
        d[k + 1] = Math.max(keep, -16);
      }
    }
    lt.tex.needsUpdate = true;
    R.set(x0, z0, LT_STEP, N);
    this.invalidate();
  }

  /** Streets or bloom changed: reclassify everything on the next frame. */
  invalidate() { for (const L of this.layers) L.dirty = true; }
}

// ------------------------------------------------------------------------ hedges --
// Clipped hedges along the kerb side of every verge bed (the band the terrain paints
// as hedge: 0.42-0.9 m in from the kerb), built on the CPU as continuous runs with a
// rounded section and closed ends, chunked so only the near ones draw.
const HEDGE_SECTION = [[-0.24, -0.3], [-0.265, 0.32], [-0.22, 0.6], [-0.11, 0.7], [0.11, 0.7], [0.22, 0.6], [0.265, 0.32], [0.24, -0.3]];

function hedgeRun(pts, height, out) {
  const n = HEDGE_SECTION.length;
  const base = out.pos.length / 3;
  const up = new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3(), side = new THREE.Vector3();
  for (let j = 0; j < pts.length; j++) {
    const a = pts[Math.max(j - 1, 0)], b = pts[Math.min(j + 1, pts.length - 1)];
    t.subVectors(b, a).setY(0).normalize();
    side.crossVectors(t, up).normalize();
    for (const [x, y] of HEDGE_SECTION) {
      const p = pts[j];
      out.pos.push(p.x + side.x * x, p.y + y * height, p.z + side.z * x);
    }
  }
  for (let j = 0; j < pts.length - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = base + j * n + i, b = a + 1, c = a + n, d = c + 1;
      out.idx.push(a, c, b, b, c, d);
    }
  }
  // end caps
  for (const [j, flip] of [[0, true], [pts.length - 1, false]]) {
    const c0 = base + j * n;
    for (let i = 1; i < n - 1; i++) {
      if (flip) out.idx.push(c0, c0 + i, c0 + i + 1); else out.idx.push(c0, c0 + i + 1, c0 + i);
    }
  }
}

const HEDGE_COLOR = /* glsl */ `
{
  // clipped box, privet and pittosporum: leaf clusters at three scales, lighter new growth
  // on the clipped top, darker in the recesses; every scale fades to its average once it
  // is smaller than a few pixels (no shimmer)
  float fw = max(length(fwidth(vWPos)), 1e-3);
  float d1 = 1.0 - smoothstep(0.08, 0.3, fw), d2 = 1.0 - smoothstep(0.02, 0.08, fw);
  float n1 = vnoise(vWPos.xz * 1.3 + vWPos.y * 2.0);
  float n2 = mix(0.5, vnoise(vec2(vWPos.x + vWPos.z, vWPos.y) * 9.0 + vWPos.xz * 6.0), d1);
  float n3 = mix(0.5, vnoise(vec2(vWPos.x - vWPos.z, vWPos.y) * 31.0 + vWPos.zx * 23.0), d2);
  vec3 dark = vec3(0.025, 0.06, 0.018), mid = vec3(0.06, 0.12, 0.03), light = vec3(0.13, 0.2, 0.05);
  vec3 c = mix(dark, mid, n1 * 0.6 + n2 * 0.4);
  c = mix(c, light, smoothstep(0.55, 0.85, n3) * 0.45 + smoothstep(0.45, 0.9, vWNrm.y) * 0.25);
  c *= 0.75 + 0.4 * n2 * n3 + 0.1;
  diffuseColor.rgb = c;
}
`;

export function buildHedges(world) {
  const plan = world.plan;
  const out = { meshes: [], chunks: [] };
  if (!plan) return out;
  const f = plan.field;
  const ground = (x, z) => world.sampler.get(x, z);
  const CH = 400;
  const chunks = new Map();
  const put = (pts, hgt) => {
    const m = pts[Math.floor(pts.length / 2)];
    const key = `${Math.floor(m.x / CH)},${Math.floor(m.z / CH)}`;
    if (!chunks.has(key)) chunks.set(key, { pos: [], idx: [], cx: (Math.floor(m.x / CH) + 0.5) * CH, cz: (Math.floor(m.z / CH) + 0.5) * CH });
    hedgeRun(pts, hgt, chunks.get(key));
  };
  const stations = (world.infra && world.infra.stations) || [];
  // the street lamps stand on the verge line: every hedge breaks around a lamp pole
  const LG = 8, lampGrid = new Map();
  for (const l of [...(plan.lamps || []), ...((world.streetscape && world.streetscape.lamps) || [])]) {
    const k = `${Math.floor(l.x / LG)},${Math.floor(l.z / LG)}`;
    if (!lampGrid.has(k)) lampGrid.set(k, []);
    lampGrid.get(k).push(l);
  }
  const nearLamp = (x, z) => {
    const cx = Math.floor(x / LG), cz = Math.floor(z / LG);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = lampGrid.get(`${cx + a},${cz + b}`);
      if (l) for (const q of l) if (Math.hypot(q.x - x, q.z - z) < 1.3) return true;
    }
    return false;
  };
  let total = 0;
  plan.streets.forEach((st, si) => {
    if (st.cls === 1) return;                                   // lanes have no verge beds
    const P = st.pts;
    const hgt = 0.62 + 0.3 * ((si * 0.618) % 1);                // each street clipped to its own height
    for (const sgn of [-1, 1]) {
      let run = [];
      const flush = () => { if (run.length >= 3) { put(run, hgt); total += run.length; } run = []; };
      let acc = 0;
      for (let i = 1; i < P.length; i++) {
        const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1];
        const L = Math.hypot(dx, dz);
        if (L < 1e-6) continue;
        const nx = -dz / L, nz = dx / L;
        for (let s = acc; s < L; s += 2.0) {
          const t = s / L;
          const x = P[i - 1][0] + dx * t + nx * sgn * (st.hw + 0.66), z = P[i - 1][1] + dz * t + nz * sgn * (st.hw + 0.66);
          const e = f.edge(x, z);
          const ok = e > 0.45 && e < 0.9 && f.squareAt(x, z) < 0.05 && ground(x, z) > 1.8
            && !nearLamp(x, z) && !stations.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 3);
          if (ok) run.push(new THREE.Vector3(x, ground(x, z), z)); else flush();
          acc = s + 2.0 - L;
        }
      }
      flush();
    }
  });
  const mat = patchedMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 }, {
    key: 'hedge',
    fragment: {
      color: HEDGE_COLOR,
      normal: `{
        float fw = max(length(fwidth(vWPos)), 1e-3);
        float d = 1.0 - smoothstep(0.05, 0.25, fw);
        vec3 g = vnoised(vec2(vWPos.x + vWPos.z * 0.7, vWPos.y * 1.4) * 7.0);
        normal = normalize(normal + (viewMatrix * vec4(g.y, 0.0, g.z, 0.0)).xyz * 0.55 * d);
      }`,
    },
  });
  for (const [key, c] of chunks) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
    g.setIndex(c.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    m.name = `Hedges ${key}`;
    m.layers.set(1);
    m.matrixAutoUpdate = false;
    world.scene.add(m);
    out.meshes.push(m);
    out.chunks.push({ mesh: m, cx: c.cx, cz: c.cz });
  }
  chunks.clear();   // their plain-array streams are copied into the meshes; out.update's closure would keep them
  out.samples = total;
  out.update = (camera) => {
    const p = camera.position;
    for (const c of out.chunks) c.mesh.visible = Math.hypot(p.x - c.cx, p.z - c.cz) < 700 && p.y < 900;
  };
  return out;
}
