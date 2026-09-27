// Volumetric cloud GLSL: tiling noise generators (run once at startup on the
// GPU) and the shared cloud density field used by the ray-marcher, the cloud
// shadow map, the reflection impostor and ground shadows. World units: metres.
//
// Density model after Schneider (Nubis, "The real-time volumetric cloudscapes
// of Horizon Zero Dawn", 2015/2017): a Perlin-Worley base shape shaped by a
// weather map and a height gradient, eroded by high-frequency Worley detail.

// ---------------------------------------------------------------- hashing --
export const CLOUD_HASH = /* glsl */ `
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 rand3(vec3 c) { return vec3(pcg3d(uvec3(ivec3(c) + 4096))) * (1.0 / 4294967295.0); }
`;

// ------------------------------------------------------- noise generators --
const GEN_COMMON = /* glsl */ `
${CLOUD_HASH}
float remapN(float v, float l0, float h0, float l1, float h1) { return l1 + (v - l0) * (h1 - l1) / (h0 - l0); }
// tiling gradient noise, period in cells
float perlinT(vec3 p, vec3 period) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define PG(o) dot(rand3(mod(i + o, period)) * 2.0 - 1.0, f - o)
  float n = mix(mix(mix(PG(vec3(0, 0, 0)), PG(vec3(1, 0, 0)), u.x), mix(PG(vec3(0, 1, 0)), PG(vec3(1, 1, 0)), u.x), u.y),
                mix(mix(PG(vec3(0, 0, 1)), PG(vec3(1, 0, 1)), u.x), mix(PG(vec3(0, 1, 1)), PG(vec3(1, 1, 1)), u.x), u.y), u.z);
  #undef PG
  return n;
}
float perlinFbm(vec3 p, float freq, int oct, float zPeriodScale) {
  float amp = 1.0, n = 0.0, norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    n += amp * perlinT(p * freq, vec3(freq, freq, freq * zPeriodScale));
    norm += amp;
    freq *= 2.0; amp *= 0.55;
  }
  return n / norm;
}
// 1 - distance to the nearest feature point (tiling)
float worleyT(vec3 p, vec3 period) {
  vec3 id = floor(p), f = fract(p);
  float d = 1e4;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(x, y, z);
    vec3 h = rand3(mod(id + o, period)) + o - f;
    d = min(d, dot(h, h));
  }
  return 1.0 - sqrt(d);
}
float worleyFbm(vec3 p, float freq, float zs) {
  return worleyT(p * freq, vec3(freq, freq, freq * zs)) * 0.625 +
         worleyT(p * freq * 2.0, vec3(freq, freq, freq * zs) * 2.0) * 0.25 +
         worleyT(p * freq * 4.0, vec3(freq, freq, freq * zs) * 4.0) * 0.125;
}
`;

/** 3D base shape: R = Perlin-Worley, GBA = Worley fBm at increasing frequency. */
export const GEN_BASE_FRAG = /* glsl */ `
${GEN_COMMON}
uniform float uSlice;
uniform float uSize;
varying vec2 vUv;
void main() {
  vec3 p = vec3(vUv, (uSlice + 0.5) / uSize);
  float pf = perlinFbm(p, 4.0, 6, 1.0) * 0.5 + 0.5;
  pf = abs(pf * 2.0 - 1.0);           // billowy
  pf = 1.0 - pf;
  float g = worleyFbm(p, 4.0, 1.0);
  float b = worleyFbm(p, 8.0, 1.0);
  float a = worleyFbm(p, 16.0, 1.0);
  float r = clamp(remapN(pf, 0.0, 1.0, g, 1.0), 0.0, 1.0);
  gl_FragColor = vec4(r, g, b, a);
}
`;

/** 3D detail: Worley fBm at three frequencies (erodes the edges into billows / wisps). */
export const GEN_DETAIL_FRAG = /* glsl */ `
${GEN_COMMON}
uniform float uSlice;
uniform float uSize;
varying vec2 vUv;
void main() {
  vec3 p = vec3(vUv, (uSlice + 0.5) / uSize);
  gl_FragColor = vec4(worleyFbm(p, 2.0, 1.0), worleyFbm(p, 4.0, 1.0), worleyFbm(p, 8.0, 1.0), 1.0);
}
`;

/** 2D weather map (tiling): R coverage potential, G cloud type (height), B base offset, A cell id noise. */
export const GEN_WEATHER_FRAG = /* glsl */ `
${GEN_COMMON}
varying vec2 vUv;
void main() {
  vec3 p = vec3(vUv, 0.37);
  // clusters of cumulus: Perlin fBm carved by inverted Worley cells
  float pf = perlinFbm(p, 5.0, 5, 64.0) * 0.5 + 0.5;
  float w = worleyFbm(p, 6.0, 64.0);
  float cov = clamp(remapN(pf, 0.28, 0.78, 0.0, 1.0), 0.0, 1.0);
  cov = clamp(cov * 0.55 + w * 0.65 - 0.18, 0.0, 1.0);
  float type = clamp(perlinFbm(p + 3.7, 3.0, 3, 64.0) * 0.9 + 0.5, 0.0, 1.0);
  float baseOff = clamp(perlinFbm(p + 9.1, 4.0, 3, 64.0) * 0.8 + 0.5, 0.0, 1.0);
  float big = clamp(perlinFbm(p + 17.3, 2.0, 3, 64.0) * 0.9 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(cov, type, baseOff, big);
}
`;

// ----------------------------------------------------- shared cloud field --
export const CLOUD_PARAMS = {
  bottom: 1650,        // shell bottom (m): lowest possible cloud base
  top: 4700,           // shell top (m): tallest congestus tops
  baseTile: 5200,      // metres per base-noise tile
  detailTile: 700,     // metres per detail-noise tile
  weatherTile: 32000,  // metres per weather-map tile
  sigma: 0.042,        // extinction per metre at density 1
};

/**
 * Uniforms: uCloudBase (sampler3D), uCloudDetail (sampler3D), uCloudWeather,
 * uCloudOffset (vec2 wind offset, m), uCloudCoverage, uCloudTime.
 */
export const CLOUD_FIELD = /* glsl */ `
#ifndef MERIDIAN_CLOUD_FIELD
#define MERIDIAN_CLOUD_FIELD
uniform sampler3D uCloudBase;
uniform sampler3D uCloudDetail;
uniform sampler2D uCloudWeather;
uniform vec2 uCloudOffset;
uniform float uCloudCoverage;
uniform float uCloudTime;
uniform vec4 uCloudTune;   // x coverage bias, y density scale, z detail erosion, w shape power

#define CLOUD_BOTTOM ${CLOUD_PARAMS.bottom.toFixed(1)}
#define CLOUD_TOP ${CLOUD_PARAMS.top.toFixed(1)}
#define CLOUD_PLANET_R 6360000.0
#define CLOUD_BASE_TILE ${CLOUD_PARAMS.baseTile.toFixed(1)}
#define CLOUD_DETAIL_TILE ${CLOUD_PARAMS.detailTile.toFixed(1)}
#define CLOUD_WEATHER_TILE ${CLOUD_PARAMS.weatherTile.toFixed(1)}
#define CLOUD_SIGMA ${CLOUD_PARAMS.sigma}
const vec3 CLOUD_C = vec3(0.0, -CLOUD_PLANET_R, 0.0);

float cRemap(float v, float l0, float h0, float l1, float h1) { return l1 + (v - l0) * (h1 - l1) / (h0 - l0); }
float cSat(float x) { return clamp(x, 0.0, 1.0); }

float cloudHeight(vec3 p) { return length(p - CLOUD_C) - CLOUD_PLANET_R; }

// x: coverage 0..1, y: vertical extent factor, z: base offset 0..1
vec3 cloudWeather(vec2 xz) {
  vec2 p = xz + uCloudOffset;
  vec4 w = textureLod(uCloudWeather, p / CLOUD_WEATHER_TILE, 0.0);
  vec4 w2 = textureLod(uCloudWeather, vec2(p.y, -p.x) / (CLOUD_WEATHER_TILE * 3.3) + 0.31, 0.0);
  // geography (fixed to the ground, not the wind): towering cumulus build over the
  // northern massif and cap Mount Anchor; the cool lagoon keeps the sky over the
  // Axis open-ish
  float massif = smoothstep(9500.0, 3500.0, length((xz - vec2(1200.0, -16000.0)) * vec2(0.55, 1.0)));
  float anchor = smoothstep(6500.0, 1500.0, length(xz - vec2(-18800.0, -6800.0)));
  float lagoon = smoothstep(5200.0, 1500.0, length(xz));
  float cov = w.r * mix(0.75, 1.2, w2.a);
  float c = uCloudCoverage + uCloudTune.x + 0.2 * massif + 0.22 * anchor - 0.16 * lagoon;
  cov = min(smoothstep(1.0 - c - 0.12, 1.0 - c + 0.3, cov), 0.9);
  float type = cSat(w.g * 0.8 + 0.45 * massif + 0.35 * anchor + 0.15 * w2.b - 0.12 * lagoon);
  return vec3(cov, type, w.b);
}

// Height of cloud base / thickness for a weather sample
void cloudSpan(vec3 wx, out float base, out float thick) {
  base = CLOUD_BOTTOM + 150.0 + wx.z * 420.0;
  thick = mix(480.0, CLOUD_TOP - base - 50.0, pow(wx.y, 1.6));
}

// Base (low-frequency) density, no erosion.
float cloudBaseDensity(vec3 p, float h, vec3 wx, out float hf, float lod) {
  float base, thick;
  cloudSpan(wx, base, thick);
  hf = (h - base) / thick;
  if (hf <= 0.0 || hf >= 1.0 || wx.x < 0.01) return 0.0;
  // rounded, flat-ish bottoms and billowing, narrowing tops
  float grad = smoothstep(0.0, 0.07, hf) * smoothstep(1.0, mix(0.6, 0.2, wx.y), hf);
  // wind shear: tops lean downwind
  vec3 q = p + vec3(uCloudOffset.x, 0.0, uCloudOffset.y) + vec3(hf * 260.0, uCloudTime * 1.2, hf * 90.0);
  vec4 n = textureLod(uCloudBase, q / CLOUD_BASE_TILE, lod);
  float lowFbm = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float shape = cRemap(n.r, lowFbm - 1.0, 1.0, 0.0, 1.0);
  // only the strongest cores climb: coverage erodes with height -> cauliflower towers
  float cov = wx.x * mix(1.0, 0.45, hf * sqrt(hf));
  float d = cRemap(shape * grad, 1.0 - cov, 1.0, 0.0, 1.0);
  return max(d, 0.0) * wx.x;
}

// Full density with detail erosion (detail weight 0..1 for LOD)
float cloudDensityWx(vec3 p, float h, vec3 wx, float detailW, float lod) {
  float hf;
  float d = cloudBaseDensity(p, h, wx, hf, lod);
  if (d <= 0.0) return 0.0;
  if (detailW > 0.0) {
    vec3 q = p + vec3(uCloudOffset.x, 0.0, uCloudOffset.y) * 1.15 + vec3(0.0, uCloudTime * 3.0, 0.0);
    vec3 dn = textureLod(uCloudDetail, q / CLOUD_DETAIL_TILE, lod * 0.5).rgb;
    float hiFbm = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
    float m = mix(hiFbm, 1.0 - hiFbm, cSat(hf * 6.0));   // wispy base, billowy tops
    d = cRemap(d, m * uCloudTune.z * detailW, 1.0, 0.0, 1.0);
  }
  return max(d, 0.0) * uCloudTune.y;
}
float cloudDensity(vec3 p, float h, float detailW, float lod) {
  return cloudDensityWx(p, h, cloudWeather(p.xz), detailW, lod);
}

// Ray / shell helpers (planet-centred spheres, metres)
vec2 cSphere(vec3 ro, vec3 rd, float R) {
  vec3 oc = ro - CLOUD_C;
  float b = dot(oc, rd);
  float r0 = length(oc);
  float c = (r0 - R) * (r0 + R);
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
// Segment of the ray inside the cloud shell, clipped to tMax. y <= x => none.
vec2 cloudSegment(vec3 ro, vec3 rd, float tMax, float maxLen) {
  float h = cloudHeight(ro);
  vec2 hb = cSphere(ro, rd, CLOUD_PLANET_R + CLOUD_BOTTOM);
  vec2 ht = cSphere(ro, rd, CLOUD_PLANET_R + CLOUD_TOP);
  float t0, t1;
  if (h < CLOUD_BOTTOM) {
    vec2 hg = cSphere(ro, rd, CLOUD_PLANET_R);
    if (hg.x > 0.0) return vec2(0.0, -1.0);
    t0 = hb.y; t1 = ht.y;
  } else if (h < CLOUD_TOP) {
    t0 = 0.0;
    t1 = hb.x > 0.0 ? hb.x : ht.y;
  } else {
    if (ht.x < 0.0) return vec2(0.0, -1.0);
    t0 = ht.x;
    t1 = hb.x > 0.0 ? hb.x : ht.y;
  }
  t1 = min(min(t1, tMax), t0 + maxLen);
  return vec2(t0, t1);
}
// distance at which the ray first enters the shell (0 when inside)
float cloudEntry(vec3 ro, vec3 rd) {
  float h = cloudHeight(ro);
  if (h >= CLOUD_BOTTOM && h <= CLOUD_TOP) return 0.0;
  vec2 hb = cSphere(ro, rd, CLOUD_PLANET_R + CLOUD_BOTTOM);
  vec2 ht = cSphere(ro, rd, CLOUD_PLANET_R + CLOUD_TOP);
  if (h < CLOUD_BOTTOM) return hb.y > 0.0 ? hb.y : 1e9;
  return ht.x > 0.0 ? ht.x : 1e9;
}
#endif
`;

// Ground shadow lookup (4 optical-depth levels through the deck, see Clouds.renderShadow).
export const CLOUD_SHADOW_LOOKUP = /* glsl */ `
#ifndef MERIDIAN_CLOUD_SHADOW
#define MERIDIAN_CLOUD_SHADOW
uniform sampler2D uCloudShadowMap;
uniform vec4 uCloudShadowRect;   // xy: origin (m), z: 1/size, w: 1 when the map is valid
uniform vec3 uCloudLightDir;
float cloudShadowOD(vec3 wp) {
  vec3 L = uCloudLightDir;
  float ly = max(L.y, 0.08);
  vec2 q = wp.xz + L.xz / ly * (${CLOUD_PARAMS.bottom.toFixed(1)} - wp.y);
  vec2 uv = (q - uCloudShadowRect.xy) * uCloudShadowRect.z;
  vec4 od = texture(uCloudShadowMap, uv);
  float k = clamp((wp.y - ${CLOUD_PARAMS.bottom.toFixed(1)}) / ${(CLOUD_PARAMS.top - CLOUD_PARAMS.bottom).toFixed(1)} * 4.0, 0.0, 3.0);
  float o = k < 1.0 ? mix(od.x, od.y, k) : (k < 2.0 ? mix(od.y, od.z, k - 1.0) : mix(od.z, od.w, k - 2.0));
  float edge = smoothstep(0.0, 0.08, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
  return mix(0.6, o, edge * uCloudShadowRect.w);
}
#endif
`;
