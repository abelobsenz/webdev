// Physically based atmosphere model (after Hillaire 2020, "A Scalable and
// Production Ready Sky and Atmosphere Rendering Technique"). All distances in km.

export const ATMO_CONSTANTS = /* glsl */ `
#ifndef MERIDIAN_ATMO
#define MERIDIAN_ATMO
#define PI_A 3.14159265359
const float Rg = 6360.0;
const float Rt = 6460.0;
const vec3  RAYLEIGH_SCAT = vec3(5.802, 13.558, 33.1) * 1e-3;
const float RAYLEIGH_H = 8.0;
// Warm, humid tropical air: slightly more aerosol than the reference atmosphere
const float MIE_SCAT = 3.996e-3 * 1.6;
const float MIE_EXT  = 4.440e-3 * 1.6;
const float MIE_H = 1.2;
const float MIE_G = 0.80;
const vec3  OZONE_ABS = vec3(0.650, 1.881, 0.085) * 1e-3;
const vec3  GROUND_ALBEDO = vec3(0.06, 0.09, 0.12);

float raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return -1.0;
  float s = sqrt(d);
  float t0 = -b - s, t1 = -b + s;
  if (t0 > 0.0) return t0;
  if (t1 > 0.0) return t1;
  return -1.0;
}

void mediumAt(float h, out vec3 scatR, out float scatM, out vec3 ext) {
  float dR = exp(-h / RAYLEIGH_H);
  float dM = exp(-h / MIE_H);
  float dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  scatR = RAYLEIGH_SCAT * dR;
  scatM = MIE_SCAT * dM;
  ext = scatR + vec3(MIE_EXT * dM) + OZONE_ABS * dO;
}

float phaseRayleigh(float c) { return 3.0 / (16.0 * PI_A) * (1.0 + c * c); }
float phaseMie(float c) {
  float g = MIE_G, g2 = g * g;
  float k = 3.0 / (8.0 * PI_A) * (1.0 - g2) / (2.0 + g2);
  return k * (1.0 + c * c) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}

// --- Transmittance LUT parameterisation (Bruneton) ---
vec2 transmittanceUV(float r, float mu) {
  float H = sqrt(Rt * Rt - Rg * Rg);
  float rho = sqrt(max(0.0, r * r - Rg * Rg));
  float disc = r * r * (mu * mu - 1.0) + Rt * Rt;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dMin = Rt - r, dMax = rho + H;
  float xMu = (d - dMin) / (dMax - dMin);
  float xR = rho / H;
  return vec2(xMu, xR);
}
void uvToTransmittance(vec2 uv, out float r, out float mu) {
  float H = sqrt(Rt * Rt - Rg * Rg);
  float rho = H * uv.y;
  r = sqrt(rho * rho + Rg * Rg);
  float dMin = Rt - r, dMax = rho + H;
  float d = dMin + uv.x * (dMax - dMin);
  mu = d == 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
  mu = clamp(mu, -1.0, 1.0);
}
#endif
`;

// Sampling helpers that need the LUT uniforms to be declared.
export const ATMO_SAMPLING = /* glsl */ `
#ifndef MERIDIAN_ATMO_SAMPLING
#define MERIDIAN_ATMO_SAMPLING
vec3 sampleTransmittance(sampler2D lut, float r, float mu) {
  return texture(lut, transmittanceUV(r, mu)).rgb;
}
vec3 sampleMultiScat(sampler2D lut, float r, float muS) {
  vec2 uv = vec2(muS * 0.5 + 0.5, clamp((r - Rg) / (Rt - Rg), 0.0, 1.0));
  uv = (uv * 31.0 + 0.5) / 32.0;
  return texture(lut, uv).rgb;
}
// Sky-view LUT lookup (192 x 108) — 'up' is the local zenith at the viewer.
const vec2 SKYLUT_SIZE = vec2(192.0, 108.0);
vec2 skyViewUV(float viewHeight, float viewZenithCos, float lightViewCos, bool hitGround) {
  float vHorizon = sqrt(max(viewHeight * viewHeight - Rg * Rg, 0.0));
  float cosBeta = vHorizon / viewHeight;
  float beta = acos(clamp(cosBeta, -1.0, 1.0));
  float zenithHorizon = PI_A - beta;
  float vza = acos(clamp(viewZenithCos, -1.0, 1.0));
  vec2 uv;
  if (!hitGround) {
    float c = clamp(vza / zenithHorizon, 0.0, 1.0);
    c = 1.0 - sqrt(max(1.0 - c, 0.0));
    uv.y = c * 0.5;
  } else {
    float c = clamp((vza - zenithHorizon) / beta, 0.0, 1.0);
    uv.y = sqrt(c) * 0.5 + 0.5;
  }
  uv.x = sqrt(clamp(-lightViewCos * 0.5 + 0.5, 0.0, 1.0));
  // sub-uv (texel centres)
  uv = (uv * (SKYLUT_SIZE - 1.0) + 0.5) / SKYLUT_SIZE;
  return uv;
}
// Sample the sky radiance (unit sun illuminance) seen from 'viewHeight' (km, from planet centre)
vec3 skyRadiance(sampler2D lut, float viewHeight, vec3 up, vec3 dir, vec3 sunDir) {
  float vzc = dot(dir, up);
  float szc = dot(sunDir, up);
  vec3 vH = dir - up * vzc;
  vec3 sH = sunDir - up * szc;
  float lv = length(vH) * length(sH);
  float lightViewCos = lv > 1e-5 ? dot(vH, sH) / lv : 1.0;
  vec3 ro = vec3(0.0, viewHeight, 0.0);
  vec3 rd = vec3(sqrt(max(1.0 - vzc * vzc, 0.0)), vzc, 0.0);
  bool hitGround = raySphere(ro, rd, Rg) > 0.0 && vzc < 0.0;
  return texture(lut, skyViewUV(viewHeight, vzc, lightViewCos, hitGround)).rgb;
}
#endif
`;

/**
 * Aerial perspective for world-space (metre) geometry. Uses the sky-view LUT
 * for in-scattered colour so distant geometry fades *into the actual sky*
 * behind it, and an analytic height-fog integral for extinction.
 */
export const AERIAL_GLSL = /* glsl */ `
#ifndef MERIDIAN_AERIAL
#define MERIDIAN_AERIAL
uniform sampler2D uSkyViewLUT;
uniform vec3 uSunDir;
uniform float uSunIlluminance;
uniform vec3 uNightAmbient;
uniform float uHaze;
uniform float uNight;

${ATMO_CONSTANTS}
${ATMO_SAMPLING}

float heightAvgDensity(float h0, float h1, float H) {
  h0 = max(h0, 0.0); h1 = max(h1, 0.0);
  float dh = h1 - h0;
  float e0 = exp(-h0 / H);
  if (abs(dh) < 1.0) return e0;
  return H * (e0 - exp(-h1 / H)) / dh;
}

vec3 aerialInscatter(vec3 dir) {
  vec3 d = normalize(vec3(dir.x, max(dir.y, 0.035), dir.z));
  float vh = Rg + max(cameraPosition.y * 0.001, 0.002);
  vec3 L = skyRadiance(uSkyViewLUT, vh, vec3(0.0, 1.0, 0.0), d, uSunDir) * uSunIlluminance;
  return L + uNightAmbient;
}

vec3 applyAerial(vec3 color, vec3 worldPos) {
  vec3 dv = worldPos - cameraPosition;
  float dist = length(dv);
  vec3 dir = dv / max(dist, 1e-3);
  float rhoR = heightAvgDensity(cameraPosition.y, worldPos.y, 8000.0);
  float rhoM = heightAvgDensity(cameraPosition.y, worldPos.y, 1100.0);
  vec3 betaR = vec3(5.802e-6, 13.558e-6, 33.1e-6);
  float betaM = 1.6e-5 * uHaze;
  vec3 od = dist * (betaR * rhoR + vec3(betaM * rhoM));
  vec3 T = exp(-od);
  vec3 ins = aerialInscatter(dir);
  return color * T + ins * (1.0 - T);
}
#endif
`;
