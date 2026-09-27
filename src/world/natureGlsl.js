// Shared GLSL for MERIDIAN's living landscape: garden-city ground pattern, canopy crowns,
// Worley cells, slope-aligned erosion and flower palettes. Requires NOISE_GLSL.

/** Uniforms shared by the nature shaders (terrain, trees, ground cover). */
export const NATURE_U = {
  uBloom: { value: 1.0 },          // how much of the flowering canopy is in bloom (0..1)
  uStreets: { value: null },       // town-plan street field (urban.js)
  uStreetHalf: { value: 7200 },
};

export const NATURE_GLSL = /* glsl */ `
#ifndef MERIDIAN_NATURE
#define MERIDIAN_NATURE
const float N_TAU = 6.28318530718;

// Tropical flowering accents: flame tree, jacaranda, golden shower, tabebuia,
// frangipani and bougainvillea.
vec3 flowerPalette(float k) {
  if (k < 0.20) return vec3(0.78, 0.13, 0.05);
  if (k < 0.37) return vec3(0.36, 0.26, 0.72);
  if (k < 0.54) return vec3(0.88, 0.64, 0.08);
  if (k < 0.70) return vec3(0.88, 0.40, 0.58);
  if (k < 0.85) return vec3(0.92, 0.88, 0.74);
  return vec3(0.72, 0.10, 0.40);
}

// Garden-city ground, driven by the town plan's street field (urban.js):
//   r = signed metres from the nearest kerb (negative on the carriageway), g = signed
//   metres from that street's centreline, b = paved squares, a = street-lamp light.
uniform sampler2D uStreets;
uniform float uStreetHalf;
vec4 streetAt(vec2 p) {
  vec2 uv = p / (2.0 * uStreetHalf) + 0.5;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec4(1.0, 1.0, 0.0, 0.0);
  return texture(uStreets, uv);
}
float streetEdge(vec4 s) { return s.r * 32.0 - 16.0; }
float streetCentre(vec4 s) { return s.g * 32.0 - 16.0; }
// approx. metres from the nearest walk centreline (a walk is 2.6 m to either side)
float walkDist(vec2 p, float urban) { return streetEdge(streetAt(p)) + 2.6; }
// 1 on paved squares
float plazaMask(vec2 p, float urban, float aa) { return smoothstep(0.3, 0.7, streetAt(p).b); }
// 1 on streets and squares, 0 on lawns and planted beds. fw = metres per pixel.
float pavedMask(vec2 p, float urban, float fw) {
  vec4 s = streetAt(p);
  float aa = max(fw, 0.12);
  return max(1.0 - smoothstep(-aa, aa, streetEdge(s)), smoothstep(0.3, 0.7, s.b));
}

// Worley cells: x = F1 distance, y = F2 - F1 (edge distance), z = cell hash
vec3 worley2(vec2 p) {
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 r = o + hash22(ip + o) - fp;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash12(ip + o + 5.7); } else if (d < d2) d2 = d;
  }
  d1 = sqrt(d1);
  return vec3(d1, sqrt(d2) - d1, id);
}

// Rainforest canopy seen from above: overlapping crown domes on a jittered grid of
// spacing S metres. Returns xy = dome height gradient (world slope), z = crown
// coverage/AO (0 in the gaps between crowns), w = crown id hash.
vec4 crownField(vec2 p, float S) {
  vec2 q = p / S;
  vec2 iq = floor(q), fq = fract(q);
  float bestH = -1.0, bestR = 1.0, bestId = 0.0;
  vec2 bestV = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 c = iq + o;
    vec2 v = fq - (o + 0.18 + 0.64 * hash22(c));
    float rad = 0.52 + 0.42 * hash12(c + 17.7);
    float r2 = dot(v, v) / (rad * rad);
    if (r2 < 1.0) {
      float ht = rad * (sqrt(1.0 - r2) + 0.45);
      if (ht > bestH) { bestH = ht; bestV = v; bestR = rad; bestId = hash12(c + 3.1); }
    }
  }
  if (bestH < 0.0) return vec4(0.0, 0.0, 0.0, 0.0);
  float r2 = dot(bestV, bestV) / (bestR * bestR);
  float sq = sqrt(max(1.0 - r2, 0.03));
  vec2 g = -bestV / (bestR * sq) * 0.75;
  return vec4(g, sqrt(sq), bestId);
}

// Slope-aligned erosion rills (after Clay John's "eroded terrain" noise).
// dir = unit vector along the contour. Returns x = value (-1..1), yz = d/dp.
vec3 erosionN(vec2 p, vec2 dir) {
  vec2 ip = floor(p), fp = fract(p);
  vec3 va = vec3(0.0);
  float wt = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
    vec2 o = vec2(float(i), float(j));
    vec2 hh = hash22(ip - o) * 0.5;
    vec2 pp = fp + o - hh;
    float d = dot(pp, pp);
    float w = exp(-d * 2.0);
    wt += w;
    float mag = dot(pp, dir);
    va += vec3(cos(mag * N_TAU), -sin(mag * N_TAU) * dir * N_TAU) * w;
  }
  return va / wt;
}
#endif
`;
