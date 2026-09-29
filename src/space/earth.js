import * as THREE from 'three';
import { ATMO_CONSTANTS, ATMO_SAMPLING } from '../shaders/atmosphere.glsl.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/uniforms.js';
import { SNOISE_GLSL, SPACE_UTIL_GLSL } from './glsl.js';
import { R_EARTH, MERIDIAN_LON, bodyDir } from './sim.js';
import { Aurora } from './aurora.js';
import { EARTH_DETAIL_GLSL, buildLaneTexture, buildArcTexture, arcologyUniforms, shipClock, trainClock } from './earthDetail.js';
import { buildArcs } from './earthBake.js';
import { EARTH_FINE_GLSL, EARTH_FINE_SHADOW_GLSL, EARTH_FINE_RELIEF_GLSL } from './earthFine.js';

// The planet, rendered in one pass on a proxy sphere at the top of the
// atmosphere. Each fragment ray-traces the ground and the cloud shell and
// ray-marches single scattering (Rayleigh, Mie, ozone; same constants and
// transmittance LUT as the city sky) plus the multiple-scattering LUT.

export const R_TOP = 6460;
export const R_CLOUD = R_EARTH + 8;
export const R_CIRRUS = R_EARTH + 12.5;

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform mat4 projectionMatrix;
uniform samplerCube uSurfA;
uniform samplerCube uSurfB;
uniform samplerCube uClouds;
uniform samplerCube uLights;
uniform sampler2D uTransmittanceLUT;
uniform sampler2D uMultiScatLUT;
uniform mat3 uToBody;
uniform vec3 uSunDir;
uniform float uSunE;
uniform float uCloudRot;      // the weather's slow eastward drift (rad)
uniform float uCloudTexel;
uniform float uSurfTexel;    // km per surface texel    // km per weather texel
uniform float uTime;          // real seconds
uniform float uSimDay;        // fraction of day for lightning seeds
uniform vec4 uRingN[4];       // ring axis (inertial) + radius
uniform vec4 uRingW[4];       // half width, opacity
uniform vec3 uMeridian;       // body frame
uniform vec3 uMoonDir;
uniform float uLightGain;
uniform float uPixAng;
uniform float uReady;
uniform float uAtmoGain;
uniform float uLimbGain;
varying vec3 vWorld;

${ATMO_CONSTANTS}
${ATMO_SAMPLING}
${NOISE_GLSL}
${SNOISE_GLSL}
${SPACE_UTIL_GLSL}

const float RC = ${R_CLOUD.toFixed(1)};
const float RTOP = ${R_TOP.toFixed(1)};
const float RCI = ${R_CIRRUS.toFixed(1)};

float earthShadow(vec3 p, vec3 s) {
  float b = dot(p, s);
  if (b > 0.0) return 1.0;
  float hMin = length(p - s * b) - Rg;
  return smoothstep(-8.0, 6.0, hMin);
}

// Shadows of the orbital rings (cylindrical bands around the planet)
float ringShadow(vec3 p, vec3 s) {
  float lit = 1.0;
  for (int k = 0; k < 4; k++) {
    vec3 n = uRingN[k].xyz;
    float R = uRingN[k].w;
    vec3 pp = p - n * dot(p, n);
    vec3 sp = s - n * dot(s, n);
    float a = dot(sp, sp);
    if (a < 1e-6) continue;
    float b = dot(pp, sp);
    float c = dot(pp, pp) - R * R;
    float disc = b * b - a * c;
    if (disc < 0.0) continue;
    float t = (-b + sqrt(disc)) / a;
    if (t <= 0.0) continue;
    float ax = dot(p + s * t, n);
    float hw = uRingW[k].x;
    float pen = 0.0047 * t + 0.3;           // penumbra from the Sun's disc
    float band = 1.0 - smoothstep(hw - pen, hw + pen, abs(ax));
    // gaps between the habitat deck and the rim accelerators
    float gap = smoothstep(0.30 * hw, 0.36 * hw, abs(ax)) * (1.0 - smoothstep(0.86 * hw, 0.9 * hw, abs(ax)));
    lit *= 1.0 - band * uRingW[k].y * (1.0 - 0.55 * gap);
  }
  return lit;
}

${EARTH_DETAIL_GLSL}

// ---- clouds ---------------------------------------------------------------------------
// The baked weather (earthBake.js: potential, stratiform share, open cells, cirrus) drifts
// slowly east as one field; the land's bias (clear deserts, cloudy rainforest) stays put.
// Every scale below the bake's ~60 km is added here as fractal detail, and each octave that
// falls below a few pixels is replaced by its effect on the mean: it widens the threshold the
// edge is drawn at, so a field of puffs becomes, with range, the soft grey veil of its mean
// cover and never sparkles or turns to confetti. Covered parts carry an optical depth: thin
// cloud is translucent and grey, thick cloud opaque and bright (reflectance tau / (tau + 13)).
vec4 weatherAt(vec3 b, float fp) {
  float lod = max(log2(max(fp, 1e-3) / uCloudTexel), 0.0);
  return textureLod(uClouds, rotY(b, -uCloudRot), lod);
}
// the land's own bias from the surface bake at this point
float landBias(vec3 b) {
  float land = smoothstep(0.49, 0.53, textureLod(uSurfA, b, 3.0).a);
  float arid = textureLod(uSurfB, b, 3.0).b;
  float lat = asin(clamp(b.y, -1.0, 1.0));
  return land * (-0.26 * arid + 0.06 * (1.0 - arid) * exp(-lat * lat / 0.04));
}
${EARTH_FINE_GLSL}

// convection cells (~30 km): x = distance to the nearest centre, y = F2 - F1 (0 on the lanes)
vec2 cellF(vec3 p) {
  vec3 base = floor(p - 0.5);
  float f1 = 9.0, f2 = 9.0;
  for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) for (int k = 0; k < 2; k++) {
    vec3 c = base + vec3(float(i), float(j), float(k));
    vec3 o = c + 0.2 + 0.6 * hash33(c);
    float d = length(p - o);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return vec2(f1, f2 - f1);
}
const float CU_A = 0.11;     // detail amplitude of cumuliform cloud
// Low and middle cloud at body direction b, footprint fp (km per pixel): x = cover, y = tau.
// oct: the fractal octaves to evaluate (0 = the bake alone, its unresolved detail widening the
// edge); the convection cells and towers only on the full evaluation of the deck itself.
vec2 lowCloud(vec3 b, float fp, float bias, int oct) {
  vec4 w = weatherAt(b, fp);
  vec3 q = rotY(b, -uCloudRot);
  float P = w.r + bias;
  float S = w.g, O = w.b;
  float A = mix(CU_A, 0.035, S);
  vec3 dt = oct > 0 ? ef_cloudDetail(q, fp, 1.0 - S, oct) : vec3(0.0, EF_CD_RMS, 0.0);
  bool fine = oct >= EF_CLOUD_OCT;
  float Pd = P + A * dt.x;
  float edge = 0.012 + 0.3 * A * dt.y;
  // cells: open (cloud in the lanes round clear hearts) and closed (bright hearts, dark lanes)
  float cellRes = 0.0, lane = 0.0, heart = 0.62;
  if (fine && (O > 0.02 || S > 0.3)) {
    cellRes = 1.0 - smoothstep(3.0, 8.0, fp);
    if (cellRes > 0.0) {
      vec2 cf = cellF(q * (6371.0 / 42.0));
      float brk = snoise(q * (6371.0 / 14.0) + 4.0);
      // broad, broken, uneven rings of cumulus on the walls of the open cells round their clear
      // hearts (the hearts themselves shrunk by the fine detail); closed cells with soft seams
      lane = (1.0 - smoothstep(0.16, 0.46 + 0.12 * brk, cf.y)) * smoothstep(-0.8, 0.2, brk);
      heart = smoothstep(0.02, 0.3, cf.y);
    }
  }
  Pd += O * (mix(0.35, lane, cellRes) - 0.35) * 0.35;
  edge += O * 0.08 * (1.0 - cellRes);
  float cover = smoothstep(0.5 - edge, 0.5 + edge, Pd);
  float thick = clamp((Pd - 0.5) / 0.3, 0.0, 1.0);
  float tau = mix(mix(8.0, 5.0, S), 48.0, thick * (0.5 + 0.5 * thick)) * mix(1.0, mix(0.72, 1.12, mix(0.75, heart, cellRes)), S * (1.0 - O));
  // the puffs' own relief where the cumulus octaves are resolved: domes thicker at their
  // centres, thinner at their rims (their tops' height, and so their shading, from tau)
  tau *= 1.0 + 0.9 * dt.z * clamp(dt.x * 2.2, -0.5, 0.5) * (1.0 - S);
  // deep convection resolved: the towers of a storm complex (~10 km domes, overshooting tops
  // punching through the anvil), their optical depth, and so their relief and shadows, heaped
  // at the centres of the updraughts
  float convP = smoothstep(0.66, 0.82, P) * (1.0 - smoothstep(0.35, 0.7, S));
  if (fine && convP > 0.0) {
    float towerRes = 1.0 - smoothstep(2.5, 6.0, fp);
    if (towerRes > 0.0) {
      vec2 tc = cellF(q * (6371.0 / 11.0) + 17.0);
      float dome = 1.0 - smoothstep(0.0, 0.62, tc.x);
      float over = (1.0 - smoothstep(0.0, 0.22, tc.x)) * step(0.72, hash13(floor(q * (6371.0 / 11.0) + 17.0)));
      tau *= mix(1.0, 0.55 + 1.2 * dome * dome + 0.9 * over, convP * towerRes);
    }
  }
  return vec2(cover, tau);
}
${EARTH_FINE_SHADOW_GLSL}
${EARTH_FINE_RELIEF_GLSL}

// High ice cloud on its own shell: thin, fibrous, drawn out along the wind. x = cover, y = tau
vec2 cirrusCloud(vec3 b, float fp, bool fine) {
  float c = weatherAt(b, fp).a;
  float e = 0.1;
  if (fine) {
    vec3 q = rotY(b, -uCloudRot);
    // fibres drawn out along the wind, each filtered by its short (north-south) wavelength:
    // ~20, ~3 and ~1 km across
    float f0 = 1.0 - smoothstep(2.4, 6.0, fp), f1 = 1.0 - smoothstep(0.35, 0.9, fp), f2 = 1.0 - smoothstep(0.12, 0.3, fp);
    float fib = snoise(q * vec3(40.0, 320.0, 40.0) + 9.0) * 0.5 * f0 + snoise(q * vec3(260.0, 2200.0, 260.0)) * 0.3 * f1 + snoise(q * vec3(800.0, 6400.0, 800.0) + 3.0) * 0.2 * f2;
    c += fib * 0.22 * smoothstep(0.05, 0.35, c);
    e += 0.08 * (1.0 - f0) + 0.04 * (1.0 - f1);
  }
  float cover = smoothstep(0.36 - e, 0.7 + e, c) * 0.9;
  return vec2(cover, mix(0.4, 2.6, smoothstep(0.4, 1.0, c)));
}
float cloudR(float tau) { return tau / (tau + 13.0); }

vec3 integrateAtmo(vec3 ro, vec3 rd, float t0, float t1, bool ground, vec3 sun, out vec3 T) {
  vec3 L = vec3(0.0);
  T = vec3(1.0);
  float tMid = ground ? t1 : clamp(-dot(ro, rd), t0, t1);
  float cosT = dot(rd, sun);
  float pR = phaseRayleigh(cosT), pM = phaseMie(cosT);
  float jit = ign(gl_FragCoord.xy);
  for (int seg = 0; seg < 2; seg++) {
    float a = seg == 0 ? t0 : tMid;
    float b = seg == 0 ? tMid : t1;
    if (b - a < 0.01) continue;
    int n = ground ? STEPS * 2 : STEPS;
    for (int i = 0; i < 48; i++) {
      if (i >= n) break;
      float x0 = float(i) / float(n), x1 = float(i + 1) / float(n);
      float s0, s1;
      if (seg == 0) { s0 = a + (b - a) * (1.0 - (1.0 - x0) * (1.0 - x0)); s1 = a + (b - a) * (1.0 - (1.0 - x1) * (1.0 - x1)); }
      else { s0 = a + (b - a) * x0 * x0; s1 = a + (b - a) * x1 * x1; }
      float dt = s1 - s0;
      float t = mix(s0, s1, jit);
      vec3 p = ro + rd * t;
      float r = length(p);
      vec3 up = p / r;
      vec3 sR; float sM; vec3 ext;
      mediumAt(r - Rg, sR, sM, ext);
      float mu = dot(up, sun);
      vec3 Ts = sampleTransmittance(uTransmittanceLUT, r, mu) * earthShadow(p, sun);
      vec3 ms = sampleMultiScat(uMultiScatLUT, r, mu);
      vec3 S = ((sR * pR + sM * pM) * Ts + (sR + vec3(sM)) * ms) * uSunE;
      // green oxygen airglow near 95 km (only visible against the night)
      float h = r - Rg;
      float agN = 1.0 - smoothstep(-0.25, 0.05, mu);
      if (agN > 0.0 && abs(h - 94.0) < 16.0) {
        // (rippled by gravity waves from the weather far below: bands ~100 km apart)
        vec3 ub = uToBody * up;
        float rip = 0.72 + 0.28 * sin(dot(ub, vec3(0.62, 0.21, 0.76)) * 400.0 + 2.2 * snoise(ub * 30.0));
        S += vec3(0.25, 1.0, 0.45) * 2.2e-5 * exp(-pow(abs(h - 94.0) / 5.0, 2.0)) * agN * rip;
        // the sodium layer just beneath it, a thin orange-yellow band (589 nm) near 89 km
        float zNa = (h - 89.0) / 3.5;
        S += vec3(1.0, 0.62, 0.18) * 4.0e-6 * exp(-zNa * zNa) * agN;
      }
      vec3 sT = exp(-ext * dt);
      L += T * (S - S * sT) / max(ext, vec3(1e-7));
      T *= sT;
    }
  }
  return L;
}

// district islands of the lagoon (km east, km north, radius) from src/world/layout.js
const vec3 ISLANDS[8] = vec3[8](vec3(2.5, 2.0, 0.56), vec3(3.75, -0.25, 0.7), vec3(2.35, -2.65, 0.52), vec3(-0.25, -3.65, 0.62),
  vec3(-2.65, -2.3, 0.64), vec3(-3.8, 0.15, 0.74), vec3(-2.35, 2.7, 0.58), vec3(0.35, 3.7, 0.66));
// Greater Meridian (km east, km north of the Axis): the seven Outer Wards on their platforms
// (src/world/layout.js WARDS), the island towns out toward the horizon, the massif terraces
const vec3 WARDS[7] = vec3[7](vec3(10.2, 5.4, 1.35), vec3(12.2, -2.4, 1.15), vec3(16.5, 1.5, 1.0), vec3(8.2, -9.4, 1.05), vec3(0.0, -13.8, 1.25), vec3(-7.8, -9.6, 1.1), vec3(-12.0, -3.0, 1.3));
// the five island cities (src/world/terrain.js FAR_ISLANDS): km east, km north, radius
const vec3 ISLES[5] = vec3[5](vec3(21.0, -24.0, 3.2), vec3(-26.0, -19.0, 4.2), vec3(31.0, 4.0, 2.6), vec3(-9.0, -33.0, 2.4), vec3(14.0, -36.0, 3.0));
// the northern massif (src/world/terrain.js MASSIF): km east, km north, radius
const vec3 MASSIFS[4] = vec3[4](vec3(-2.5, 16.5, 4.3), vec3(4.8, 15.0, 3.3), vec3(-8.8, 14.2, 3.0), vec3(9.8, 19.0, 3.8));

// Greater Meridian by day, drawn at its true size (km east, km north of the Axis): the
// turquoise lagoon inside its city rim, the eight district islands, the seven Outer Wards
// on their pale platforms with the bridges back to the rim, the five island cities, the
// forested massif to the north, all standing on a shallow bank whose pale water is the
// first thing you find from high orbit.
float mSeg(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a; float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0); return length(p - a - ab * t); }
vec4 meridianSite(vec3 b, float fp, out float lightsOut) {
  lightsOut = 0.0;
  vec3 dv = b - uMeridian;
  float dk = length(dv) * 6371.0;
  if (dk > 70.0) return vec4(0.0);
  vec3 e = normalize(vec3(uMeridian.z, 0.0, -uMeridian.x));   // east
  vec2 P = vec2(dot(dv, e), dv.y) * 6371.0;
  float r = length(P);
  float a = atan(P.y, P.x);
  float aa = max(fp * 0.6, 0.03);                                // antialiasing width (km)
  // --- the bank: shallow water over sand round every island and platform ---
  // one irregular platform: a smooth union of the rises under the atoll, wards and islands
  float bf = exp(-r * r / 260.0);
  for (int i = 0; i < 7; i++) { vec2 q = P - WARDS[i].xy; bf += 0.6 * exp(-dot(q, q) / 22.0); }
  for (int i = 0; i < 5; i++) { vec2 q = P - ISLES[i].xy; bf += 0.9 * exp(-dot(q, q) / (ISLES[i].z * ISLES[i].z * 5.0)); }
  bf += 0.16 * snoise(vec3(P * 0.12, 1.0)) + 0.07 * snoise(vec3(P * 0.45, 2.0));
  float bank = smoothstep(0.12, 0.62, bf);
  float shoal = smoothstep(0.7, 1.3, bf);
  // --- the atoll: rim with its channels (the Gate to the south), lagoon, islands ---
  float rimR = 5.9 + 0.35 * snoise(vec3(cos(a) * 1.7, sin(a) * 1.7, 3.0));
  float rim = 1.0 - smoothstep(0.34 - aa, 0.46 + aa, abs(r - rimR));
  float ch = min(min(abs(a + 1.5708), abs(a + 0.05)), min(abs(a - 2.45), abs(a + 2.55)));
  rim *= smoothstep(0.05, 0.12, ch);
  float lagoon = 1.0 - smoothstep(rimR - 0.3, rimR + 0.1, r);
  float land = rim;
  land = max(land, 1.0 - smoothstep(0.9 - aa, 1.02 + aa, r));
  for (int i = 0; i < 8; i++) {
    vec3 isl = ISLANDS[i];
    land = max(land, 1.0 - smoothstep(isl.z * 0.8 - aa, isl.z + aa, length(P - isl.xy)));
  }
  float city = land * (1.0 - smoothstep(rimR + 0.4, rimR + 0.8, r));
  // --- the Outer Wards and their bridges ---
  float ward = 0.0, bridge = 0.0;
  for (int i = 0; i < 7; i++) {
    vec2 c = WARDS[i].xy;
    ward = max(ward, 1.0 - smoothstep(WARDS[i].z - aa, WARDS[i].z + aa, length(P - c)));
    float w0 = 0.09;
    float dB = mSeg(P, normalize(c) * (rimR + 0.2), c - normalize(c) * WARDS[i].z * 0.9);
    bridge = max(bridge, clamp(1.0 - dB / max(w0, aa), 0.0, 1.0) * min(1.0, w0 / aa));
  }
  // --- island cities, the massif and Mount Anchor ---
  float isle = 0.0, town = 0.0;
  for (int i = 0; i < 5; i++) {
    vec2 q = P - ISLES[i].xy;
    float wob = 1.0 + 0.18 * snoise(vec3(q * 0.35, float(i) * 3.1));
    float li = 1.0 - smoothstep(ISLES[i].z * wob - aa, ISLES[i].z * wob + aa, length(q));
    isle = max(isle, li);
    // each town sits on the coast that faces the capital
    vec2 hb = ISLES[i].xy - normalize(ISLES[i].xy) * ISLES[i].z * 0.55;
    town = max(town, li * (1.0 - smoothstep(0.6, 1.5, length(P - hb))));
  }
  float massif = 0.0;
  for (int i = 0; i < 4; i++) massif = max(massif, 1.0 - smoothstep(MASSIFS[i].z * 0.8, MASSIFS[i].z * 1.25, length(P - MASSIFS[i].xy)));
  massif *= smoothstep(-0.3, 0.2, snoise(vec3(P * 0.2, 0.0)) + 0.4);
  float anchor = 1.0 - smoothstep(2.5, 4.5, length(P - vec2(-18.8, 6.8)));
  float green = max(massif, anchor);
  // --- colour ---
  vec3 col = mix(vec3(0.006, 0.03, 0.045), vec3(0.028, 0.13, 0.14), bank);  // bank shallows
  col = mix(col, vec3(0.05, 0.2, 0.19), shoal * 0.7);                          // sandy shoals near the land
  col = mix(col, vec3(0.045, 0.24, 0.22), lagoon);                          // lagoon turquoise
  vec3 cityC = mix(vec3(0.3, 0.3, 0.28), vec3(0.05, 0.1, 0.04), 0.3 + 0.2 * snoise(vec3(P * 1.3, 5.0)));
  col = mix(col, vec3(0.34, 0.32, 0.26), rim * 0.4);                        // reef sand under the rim
  col = mix(col, cityC, city);
  col = mix(col, vec3(0.36, 0.35, 0.32), max(ward, bridge * 0.8));
  vec3 isleC = mix(vec3(0.035, 0.075, 0.028), vec3(0.3, 0.29, 0.26), town);
  col = mix(col, isleC, isle);
  col = mix(col, mix(vec3(0.02, 0.045, 0.018), vec3(0.12, 0.11, 0.1), smoothstep(0.6, 1.0, green)), green);
  float cover = max(max(bank, max(lagoon, land)), max(max(ward, bridge), max(isle, green)));
  cover *= (1.0 - smoothstep(62.0, 70.0, dk)) * (1.0 - smoothstep(18.0, 40.0, fp));
  lightsOut = city;
  return vec4(col, cover);
}

// City lattice where districts (14 km) and blocks (2.6 km) are resolved; each scale falls to
// its mean (1) while its cells still span a few pixels, so nothing sparkles as the planet turns.
float cityLattice(vec3 b, float fp) {
  float lat = asin(clamp(b.y, -1.0, 1.0));
  float lon = atan(-b.z, b.x);
  vec2 q = vec2(lon * cos(lat), lat) * 6371.0;
  float fD = 1.0 - smoothstep(12.0 / 7.0, 12.0 / 3.0, fp);
  float fB = 1.0 - smoothstep(2.4 / 7.0, 2.4 / 3.0, fp);
  float m = 1.0;
  if (fD > 0.0) {
    // districts: irregular cells ~12 km across, bright arterials along their borders,
    // each district a little brighter or dimmer than the next
    vec2 g = q / 12.0;
    vec2 gi = floor(g);
    float f1 = 9.0, f2 = 9.0; vec2 id = vec2(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 c = gi + vec2(float(x), float(y));
      vec2 o = vec2(hash12(c + 1.7), hash12(c + 9.3));
      float dd = length(g - c - o);
      if (dd < f1) { f2 = f1; f1 = dd; id = c; } else if (dd < f2) f2 = dd;
    }
    float edge = 1.0 - smoothstep(0.0, 0.12, f2 - f1);
    float dist = 0.6 + 0.8 * hash12(id + 17.0);
    m *= mix(1.0, (0.55 + 1.9 * edge) * dist / 0.93, fD);
  }
  if (fB > 0.0) {
    vec2 g = q / 2.4;
    vec2 fr = abs(fract(g) - 0.5);
    float street = smoothstep(0.42, 0.5, max(fr.x, fr.y));
    float lit = 0.5 + hash12(floor(g) + 3.0);
    m *= mix(1.0, (0.45 + 2.2 * street) * lit / 0.78, fB);
  }
  // avenues ~800 m apart, resolved from a low pass: each carries platoons of headlights and
  // tail-lights moving along it (alternate avenues flowing opposite ways), so a resolved city
  // is visibly alive; the mean is kept as the pattern fades with range
  float fS = 1.0 - smoothstep(0.8 / 7.0, 0.8 / 2.5, fp);
  if (fS > 0.0) {
    vec2 g = q / 0.8;
    vec2 cellA = floor(g + 0.5);
    vec2 fr = abs(fract(g) - 0.5);
    float ax = smoothstep(0.43, 0.5, fr.x), ay = smoothstep(0.43, 0.5, fr.y);
    float hx = hash12(vec2(cellA.x, 3.0)), hy = hash12(vec2(cellA.y, 7.0));
    float vx = (hx > 0.5 ? 1.0 : -1.0) * (0.018 + 0.014 * hx), vy = (hy > 0.5 ? 1.0 : -1.0) * (0.018 + 0.014 * hy);
    float flowN = 0.5 + 0.5 * sin((q.y - uTime * vx) * 3.927 + hx * 6.2832);     // platoons ~1.6 km apart
    float flowE = 0.5 + 0.5 * sin((q.x - uTime * vy) * 3.927 + hy * 6.2832);
    float streets = max(ax * (0.4 + 1.2 * flowN), ay * (0.4 + 1.2 * flowE));
    m *= mix(1.0, (0.55 + 1.9 * streets) / 0.9, fS);
  }
  return m;
}

// A light element of radius r0 (km) drawn no smaller than w: its peak falls as its drawn
// area grows, so its energy is kept as it shrinks below a pixel (nothing pops).
float mDot(vec2 p, vec2 c, float r0, float w) { float r = max(r0, w); vec2 d = p - c; return exp(-dot(d, d) / (r * r)) * (r0 * r0) / (r * r); }
float mLine(vec2 p, vec2 a, vec2 b, float h0, float w) {
  vec2 ab = b - a; float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float h = max(h0, w); vec2 d = p - a - ab * t;
  return exp(-dot(d, d) / (h * h)) * h0 / h;
}

// Meridian at night: the brightest point on the planet. Resolved, a gold rim round the
// turquoise lagoon, a white-gold Axis, a necklace of ward lights on bridges, island towns
// and the terraces; unresolved, the same lights merged into one glow that dims gently with
// range (a smooth function of the pixel footprint, so it never twinkles).
vec3 meridianNight(vec3 b, float fp) {
  vec3 dv = b - uMeridian;
  float dk = length(dv) * 6371.0;
  float reach = 50.0 + 3.0 * fp;
  if (dk > reach) return vec3(0.0);
  vec3 e = normalize(vec3(uMeridian.z, 0.0, -uMeridian.x));
  vec2 P = vec2(dot(dv, e), dv.y) * 6371.0;
  float w = max(fp * 0.7, 0.2);
  vec3 gold = vec3(1.0, 0.78, 0.46), white = vec3(1.0, 0.94, 0.84), teal = vec3(0.3, 1.0, 0.9);
  float r = length(P);
  vec3 col = vec3(0.0);
  // the atoll rim and its lagoon
  float rimW = max(0.45, w);
  float rq = (r - 5.9) / rimW;
  col += gold * exp(-rq * rq) * (0.45 / rimW) * 9.0;
  col += teal * (1.0 - smoothstep(4.6, 5.9 + w, r)) * 0.9 * min(1.0, 5.0 / max(w, 1e-3));
  col += white * mDot(P, vec2(0.0), 0.9, w) * 60.0;                      // the Axis and the Crown
  for (int i = 0; i < 8; i++) col += gold * mDot(P, ISLANDS[i].xy, ISLANDS[i].z, w) * 7.0;
  // the Outer Wards and their bridges to the rim
  for (int i = 0; i < 7; i++) {
    vec2 c = WARDS[i].xy;
    col += mix(white, gold, 0.4) * mDot(P, c, 1.9, w) * 26.0;
    col += teal * mLine(P, normalize(c) * 6.2, c - normalize(c) * 1.4, 0.15, w) * 14.0;
  }
  // tower towns on the far islands, terraces on the massif's lower slopes
  for (int i = 0; i < 5; i++) col += gold * mDot(P, ISLES[i].xy - normalize(ISLES[i].xy) * ISLES[i].z * 0.55, 1.2, w) * 10.0;
  col += gold * mLine(P, vec2(-7.0, 8.2), vec2(6.5, 8.6), 0.9, w) * 3.0;
  // far off, keep it the brightest point: a glow that shrinks its peak more slowly than area
  float rg = max(8.0, fp * 1.3);
  float I = 140.0 * pow(8.0 / rg, 0.95);
  col += mix(white, teal, smoothstep(0.1 * rg, 0.9 * rg, dk)) * exp(-dk * dk / (rg * rg)) * I * smoothstep(5.0, 16.0, fp);
  return col;
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  vec3 sun = uSunDir;
  vec2 tA = sphereHits(ro, rd, RTOP);
  if (tA.x > tA.y || tA.y < 0.0) discard;
  float t0 = max(tA.x, 0.0);
  vec2 tG = sphereHits(ro, rd, Rg);
  bool hitG = tG.x < tG.y && tG.x > 0.0;
  // ground point (clamped to the closest point on the sphere when missing, so derivatives stay defined)
  float tg = hitG ? tG.x : max(-dot(ro, rd), 0.0);
  vec3 pG = ro + rd * tg;
  pG = normalize(pG) * Rg;
  vec3 n = pG / Rg;
  vec3 b = uToBody * n;
  float fp = tg * uPixAng;                   // km per pixel
  vec4 A = texture(uSurfA, b);
  vec4 B = texture(uSurfB, b);
  float H = A.a * 2.0 - 1.0;
  vec3 alb = A.rgb * A.rgb;
  // the bake's own structure sharpened where a pixel is finer than its texels (an unsharp mask
  // against a coarser mip): rivers, coasts, forest edges and deserts' margins crisp, not bilinear
  float sharpK = 0.75 * (1.0 - smoothstep(0.35, 1.4, fp / uSurfTexel));
  if (sharpK > 0.0) {
    vec3 aC = textureLod(uSurfA, b, 2.0).rgb;
    alb = clamp(alb + sharpK * (alb - aC * aC), alb * 0.55, alb * 1.6);
  }
  // the coast drawn below the bake's texels: headlands, coves, barrier islands
  float Hd = H + ef_coast(b, H, fp);
  float ew = max(fwidth(Hd), 1e-4);
  float landF = smoothstep(-ew, ew, Hd);
  float bakedLand = step(0.0, H);
  vec3 coastLand = mix(vec3(0.07, 0.075, 0.045), alb, bakedLand);
  vec3 coastSea = mix(alb, vec3(0.012, 0.05, 0.06), bakedLand);
  vec3 landAlb = bakedLand > 0.5 ? alb : coastLand;
  vec3 seaAlb = bakedLand > 0.5 ? coastSea : alb;
  float ice = B.g;

  // relief normal (land only)
  vec3 dpdx = dFdx(pG), dpdy = dFdy(pG);
  // sub-texel ridges, drainage valleys, rock, snow, fields and dunes (earthFine.js), each
  // fading to its mean while it still spans a few pixels; evaluated unconditionally so the
  // derivatives of the relief stay defined
  float valley;
  float hK = (max(H, 0.0) * 6.0 + ef_land(b, fp, H, B.b, ice, landAlb, valley)) * 3.5;   // km, exaggerated x3.5
  float dhx = dFdx(hK), dhy = dFdy(hK);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  vec3 nb = normalize(abs(det) * n - grad * landF);
  if (abs(det) < 1e-12) nb = n;

  float mu = dot(n, sun);
  vec3 sunT = sampleTransmittance(uTransmittanceLUT, Rg + 0.3, mu) * smoothstep(-0.03, 0.02, mu);
  float rsh = ringShadow(pG, sun);
  // cloud shadows where the sun ray crosses each shell (the cirrus's falls further off): a
  // cloud takes away the light it reflects, so thin cloud barely shades and thick cloud does
  float csh = 1.0;
  float biasG = landBias(b);
  {
    vec2 ts = sphereHits(pG, sun, RC);
    vec2 cs = lowCloud(uToBody * normalize(pG + sun * max(ts.y, 0.0)), max(fp, 0.4), biasG, fp < 6.0 ? EF_SHADOW_OCT : 0);
    vec2 ti = sphereHits(pG, sun, RCI);
    vec2 ci = cirrusCloud(uToBody * normalize(pG + sun * max(ti.y, 0.0)), max(fp, 0.4), false);
    // (the deck's shadow edge softened by the Sun's disc over the ~8 km drop: ~70 m, so crisp)
    csh = (1.0 - 0.95 * cs.x * cloudR(cs.y)) * (1.0 - ci.x * cloudR(ci.y) * 1.5);
  }
  float shadow = rsh * csh;
  // skylight: blue by day, gold along the terminator, violet in twilight; the valleys see less sky
  vec3 skyAmb = uSunE * ef_skyAmbient(mu);
  float skyOcc = 1.0 - 0.35 * valley * landF;
  vec3 V = -rd;
  // land
  float ndl = max(dot(nb, sun), 0.0);
  vec3 landCol = landAlb / S_PI * (uSunE * sunT * ndl * shadow + skyAmb * (0.6 + 0.4 * shadow) * skyOcc);
  // ocean with sun glint
  // whitecaps: where the storms blow the sea is streaked with foam (Monahan's W = 3.8e-6 U^3.41:
  // a few per cent of the surface at gale force), lifting its albedo and roughening its glint
  float gale = smoothstep(0.55, 0.85, weatherAt(b, max(fp, 12.0)).r) * smoothstep(0.55, 0.85, abs(b.y));
  float U10 = 6.0 + 12.0 * gale;
  // the water's own colour: blooms drawn into filaments by the eddies, sediment on the shelves
  seaAlb = mix(ef_seaColour(b, fp, B.a, H, seaAlb), seaAlb, ice);
  float wcap = 3.84e-6 * pow(U10, 3.41);
  seaAlb += vec3(0.5 * wcap) * (1.0 - ice);
  vec3 seaCol;
  // ships on the lane the bake found here (the id cube, nearest-filtered)
  float shRough, shSlick, shFoam;
  vec3 shipLight;
  vec4 trafficIds = textureLod(uIds, b, 0.0);
  od_ships(b, trafficIds.r, fp, shRough, shSlick, shFoam, shipLight);
  {
    // sea-surface roughness from the wind (Cox-Munk, ~7 m/s): a broad smooth glint, gently
    // varied by weather systems, with calm slicks streaking it where they are resolved
    float wind = snoise(rotY(b, -uCloudRot) * 7.0) * 0.5 + 0.5;
    float al = mix(0.17, 0.25, wind);
    float slick = smoothstep(0.55, 0.8, snoise(b * vec3(90.0, 260.0, 90.0) + wind * 3.0) * 0.5 + 0.5) * (1.0 - smoothstep(2.0, 8.0, fp));
    al -= 0.05 * slick;
    // wind rows and cat's paws in the glint
    al *= ef_windRows(b, fp);
    al *= 1.0 + 0.35 * gale;                         // Cox-Munk: rougher in a gale
    // the sea's texture in the glint, and the ships' wakes through it
    al *= od_seaTexture(b, fp, B.a);
    al *= 1.0 + 0.7 * shRough - 0.45 * clamp(shSlick, 0.0, 1.0);
    al = clamp(al, 0.05, 0.6);
    // the waves themselves where the pixel resolves them: their slope tilts the facet normal, and
    // the roughness keeps only what is still below the pixel
    float swVar;
    vec3 swSlope = od_swell(b, fp, uTime, swVar);
    al = sqrt(max(al * al - swVar, 0.0016));
    vec3 nw = normalize(n - transpose(uToBody) * swSlope * (1.0 - ice));
    al = mix(al, 0.5, ice);
    vec3 Hh = normalize(V + sun);
    float nh = max(dot(nw, Hh), 0.0), nv = max(dot(nw, V), 1e-3), nl = max(dot(n, sun), 0.0);
    float a2 = al * al;
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (S_PI * dd * dd);
    float k = al * 0.5;
    float G = (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k));
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, Hh), 0.0), 5.0);
    float Fv = 0.02 + 0.98 * pow(clamp(1.0 - nv, 0.0, 1.0), 5.0);
    vec3 spec = vec3(D * G * F / (4.0 * nv + 1e-4)) * uSunE * sunT * shadow;
    // the reflected sky whitens toward grazing (the horizon's haze), and warms at the terminator
    float graze = clamp(1.0 - nv, 0.0, 1.0);
    vec3 skyRefl = uSunE * (mix(vec3(0.03, 0.06, 0.13), vec3(0.075, 0.095, 0.14), graze * graze * graze) * smoothstep(-0.2, 0.3, mu) + ef_skyAmbient(mu) * 0.3);
    vec3 body = seaAlb / S_PI * (uSunE * sunT * nl * shadow + skyAmb);
    seaCol = body * (1.0 - Fv) + Fv * skyRefl + spec * (1.0 - ice);
    seaCol = mix(seaCol, seaAlb / S_PI * (uSunE * sunT * nl * shadow + skyAmb), ice);
    // white water at the bows and close astern
    seaCol += vec3(0.55) * clamp(shFoam, 0.0, 1.0) * (1.0 - ice) / S_PI * (uSunE * sunT * nl * shadow + skyAmb);
  }
  vec3 col = mix(seaCol, landCol, landF);

  // Meridian's atoll
  float mLights;
  vec4 site = meridianSite(b, fp, mLights);
  if (site.a > 0.0) {
    vec3 sc = site.rgb / S_PI * (uSunE * sunT * max(mu, 0.0) * shadow + skyAmb);
    col = mix(col, sc, site.a);
  }

  // the arcologies: pale platforms by day, the brightest lights of their regions at night
  vec3 arcoNight;
  float arcoGlass;
  vec4 arco = od_arcology(b, fp, arcoNight, arcoGlass);
  if (arco.a > 0.0) col = mix(col, arco.rgb / S_PI * (uSunE * sunT * max(mu, 0.0) * shadow + skyAmb), arco.a);
  // their glazed roofs flash the Sun back where the geometry is right
  if (arcoGlass > 0.0) col += vec3(od_glint(n, V, sun, 0.09)) * arcoGlass * uSunE * sunT * shadow;

  // Kilauea's vog by day
  vec3 volcNight;
  vec4 volc = od_volcano(b, fp, volcNight);
  if (volc.a > 0.0) col = mix(col, volc.rgb / S_PI * (uSunE * sunT * max(mu, 0.0) * shadow + skyAmb), volc.a);
  // mineral dust (the bake's optical depth): a tan veil over sea and land, lit by the Sun,
  // hiding a little of what lies beneath (the clouds above it are drawn over it)
  float tauD = B.r * 1.2;
  if (tauD > 0.003) {
    float muV = max(dot(n, V), 0.08);
    float tD = exp(-tauD / muV);
    vec3 dustL = vec3(0.6, 0.46, 0.3) / S_PI * (uSunE * sunT * max(mu, 0.0) * rsh + skyAmb * 0.6);
    col = col * tD + dustL * (1.0 - tD);
  }

  // night lights of the Concord: warm old cores, cool new districts, transit filaments
  // (baked), with district and block lattices where they are resolved, and Meridian
  float night = od_switchOn(b, mu, fp);
  vec4 LT = texture(uLights, b);
  float lw = LT.r, lc = LT.g, ln = LT.b;
  // (at every tier, but only where there are lights to structure)
  float micro = (lw + lc) * night > 1e-3 ? cityLattice(b, fp) : 1.0;
  // brighter from afar, where a city is a pixel's mean, calmer close up so districts keep their
  // structure (a smooth function of range: nothing pops)
  float rangeK = mix(0.7, 1.35, smoothstep(3.0, 30.0, fp));
  // the city's night: full through the evening, dimmer in the small hours as the shops and
  // offices go dark, a lift with the early shifts before dawn (local solar time from the Sun)
  {
    vec3 sB = uToBody * sun;
    float hA = atan(-b.z, b.x) - atan(-sB.z, sB.x);
    float hour = mod(12.0 + hA * 3.8197 + 48.0, 24.0);
    float sinceDusk = mod(hour - 18.0 + 24.0, 24.0);
    float zc = (sinceDusk - 11.5) / 1.1;
    rangeK *= mix(1.0, 0.62, smoothstep(4.5, 9.0, sinceDusk)) + 0.22 * exp(-zc * zc);
  }
  vec3 emis = ((vec3(1.0, 0.6, 0.28) * lw * 4.2 + vec3(0.66, 0.88, 1.0) * lc * 3.6) * micro + vec3(0.72, 0.86, 1.0) * ln * 1.05) * rangeK;
  // a soft shoulder, so a metro's heart stays warm-white instead of clipping to a white splat
  // (and stays under the bloom's threshold: no metro flares into a star)
  {
    float le = max(emis.r, max(emis.g, emis.b));
    emis *= 1.0 / (1.0 + le / 0.75);
  }
  emis += meridianNight(b, fp);
  emis += arcoNight * 0.12;
  emis += volcNight * 0.05;
  emis += shipLight * 0.05 * (1.0 - landF);
  emis += od_trains(b, trafficIds.g, fp) * 0.05;

  // clouds: the low and middle deck (8 km) and the cirrus above it (12.5 km), each on its own
  // shell, so they part in parallax at a slant and the cirrus shadows the deck beneath it
  // (at a slant the deck is marched as a height field: towers stand up toward the horizon)
  vec2 tC = sphereHits(ro, rd, RC);
  vec2 lcl;
  float tCl, biasC;
  bool deckHit = ef_deck(ro, rd, tC, lcl, tCl, biasC);
  vec3 pC = ro + rd * tCl;
  vec3 nC = normalize(pC);
  vec3 bC = uToBody * nC;
  float fpC = max(tCl * uPixAng, 1e-3);
  float muVC = max(abs(dot(rd, nC)), 0.04);
  // what the deck hides of what lies below: the covered share times its direct-beam opacity
  float cA = lcl.x * (1.0 - exp(-lcl.y * 0.5 / muVC));
  // relief: the tops' height read from the optical depth, so towers catch the Sun on one side;
  // resolved only where it spans a few pixels
  float hTop = lcl.x * sqrt(clamp(lcl.y / 48.0, 0.0, 1.0));
  vec3 dcx = dFdx(pC), dcy = dFdy(pC);
  float dax = dFdx(hTop), day = dFdy(hTop);
  vec3 cr1 = cross(dcy, nC), cr2 = cross(nC, dcx);
  float cdet = dot(dcx, cr1);
  vec3 cgrad = abs(cdet) > 1e-9 ? (dax * cr1 + day * cr2) / cdet : vec3(0.0);
  cgrad *= (1.0 - smoothstep(1.0, 5.0, fpC)) * EF_TOP_KM;         // tops ~3 km proud
  float cgl = length(cgrad);
  if (cgl > 2.0) cgrad *= 2.0 / cgl;
  vec3 nRel = normalize(nC - cgrad);
  vec3 cloudCol = vec3(0.0);
  {
    float muC = dot(nC, sun);
    vec3 sunTc = sampleTransmittance(uTransmittanceLUT, RC, muC) * earthShadow(pC * 1.0005, sun);
    // self shadowing: the deck a little toward the Sun (nearer when close, so cells shade cells)
    vec3 st = normalize(sun - nC * muC + 1e-5);
    float off = clamp(fpC * 3.0, 1.5, 38.0);
    vec2 cs = lowCloud(uToBody * normalize(nC + st * (off / 6371.0)), max(off * 0.5, fpC), 0.0, 0);
    float shade = exp(-2.4 * max(cs.x * cloudR(cs.y) - lcl.x * cloudR(lcl.y) * 0.4, 0.0));
    // and at the scale of the puffs and towers: the height field marched toward the Sun
    float h0 = EF_TOP_KM * hTop;
    float selfRes = 1.0 - smoothstep(2.5, 5.0, fpC);
    float selfSh = (lcl.x > 0.02 && selfRes > 0.0) ? mix(1.0, ef_cloudSelfShadow(nC, sun, muC, fpC, biasC, h0), selfRes) : 1.0;
    // tall tops keep the Sun a little past the terminator (the horizon dips ~0.03 rad at 3 km)
    float wrap = clamp((dot(nRel, sun) + 0.15) / 1.15, 0.0, 1.0) * smoothstep(-0.06, 0.02, muC + 0.01 * h0) * selfSh;
    float rs = ringShadow(pC, sun);
    // the cirrus overhead shades the deck
    vec2 ti = sphereHits(pC, sun, RCI);
    vec2 cio = cirrusCloud(uToBody * normalize(pC + sun * max(ti.y, 0.0)), 4.0, false);
    float cish = 1.0 - cio.x * cloudR(cio.y) * 1.5;
    // skylight on the tops, less of it down between them (the valleys of a cumulus field)
    vec3 amb = uSunE * ef_skyAmbient(muC) * 1.15 * (0.62 + 0.38 * sqrt(clamp(lcl.y / 48.0, 0.0, 1.0)));
    // reflectance from the optical depth: thin cloud grey, thick cloud white
    float Rc = cloudR(lcl.y) / max(1.0 - exp(-lcl.y * 0.5 / muVC), 0.05);
    Rc = clamp(Rc, 0.0, 0.92);
    cloudCol = vec3(Rc) / S_PI * (uSunE * sunTc * wrap * (0.3 + 0.7 * shade) * rs * cish + amb * (0.7 + 0.3 * shade));
    // silver edges: thin cloud toward the Sun passes the light on forward
    float fwdC = pow(max(dot(rd, sun), 0.0), 10.0);
    cloudCol += vec3(0.95, 0.96, 1.0) / S_PI * uSunE * sunTc * rs * cish * fwdC * exp(-lcl.y * 0.18) * 1.6 * smoothstep(-0.02, 0.05, muC);
    // city glow on cloud undersides, lightning in the deep convection
    float nightC = 1.0 - smoothstep(-0.10, 0.06, muC);
    // lights below glow through the deck and light it from beneath, softened by scattering
    vec4 LU = textureLod(uLights, bC, 3.0);
    float under = LU.r * 1.2 + LU.g * 0.8 + LU.b * 0.3;
    cloudCol += mix(vec3(1.0, 0.62, 0.34), vec3(0.8, 0.85, 0.95), 0.3) * under * 1.1 * nightC;
    // lightning: storm cells brighten in soft, brief pulses (no hard on/off), only where a
    // cell spans a few pixels; from high orbit single-pixel strikes read as blinking lights
    // (deep convection: thick, cumuliform cloud; the storms of the ITCZ, the cyclones' walls)
    float convS = weatherAt(bC, fpC).g;
    float conv = smoothstep(0.55, 0.95, lcl.x * clamp(lcl.y / 40.0, 0.0, 1.0)) * (1.0 - 0.8 * convS) * nightC * (1.0 - smoothstep(25.0, 60.0, fpC));
    float flash = od_lightning(bC, fpC, conv, uTime);
    cloudCol += vec3(0.75, 0.82, 1.0) * flash * 0.9;
    // the aurora's green on the cloud tops beneath the ovals
    cloudCol += vec3(0.15, 0.8, 0.35) * od_auroraGround(bC, uToBody * sun) * 0.012 * nightC;
    // faint moonlight
    cloudCol += vec3(0.5, 0.6, 0.8) * 0.004 * max(dot(nC, uMoonDir), 0.0) * nightC;
  }
  // cirrus
  vec2 tI = sphereHits(ro, rd, RCI);
  vec3 pI = ro + rd * max(tI.x, 0.0);
  vec3 nI = normalize(pI);
  float fpI = max(max(tI.x, 0.0) * uPixAng, 1e-3);
  float muVI = max(abs(dot(rd, nI)), 0.04);
  vec2 ic = tI.x < tI.y ? cirrusCloud(uToBody * nI, fpI, true) : vec2(0.0);
  float iA = ic.x * (1.0 - exp(-ic.y / muVI));
  vec3 ciCol;
  {
    float muI = dot(nI, sun);
    vec3 sunTi = sampleTransmittance(uTransmittanceLUT, RCI, muI) * earthShadow(pI * 1.0005, sun);
    // ice crystals scatter forward: cirrus toward the Sun shines
    float fwd = pow(max(dot(rd, sun), 0.0), 6.0);
    float nightI = 1.0 - smoothstep(-0.10, 0.06, muI);
    float Ri = clamp(cloudR(ic.y * 3.0) / max(1.0 - exp(-ic.y / muVI), 0.05), 0.0, 0.9);
    ciCol = vec3(0.93, 0.96, 1.0) * Ri / S_PI * (uSunE * sunTi * clamp((muI + 0.1) / 1.1, 0.0, 1.0) * (0.9 + 2.0 * fwd) * ringShadow(pI, sun)
          + uSunE * ef_skyAmbient(muI) * 1.3);
    ciCol += vec3(0.5, 0.6, 0.8) * 0.003 * max(dot(nI, uMoonDir), 0.0) * nightI;
  }
  emis *= (1.0 - cA * 0.85) * (1.0 - iA * 0.3);
  col += emis * uLightGain * night;
  col = mix(col, cloudCol, cA);
  col = mix(col, ciCol, iA);

  // atmosphere
  vec3 T;
  float tEnd = hitG ? tG.x : tA.y;
  vec3 L = integrateAtmo(ro, rd, t0, tEnd, hitG, sun, T);
  // artistic: thin the blue veil over the disc a little, keep the limb at full strength
  L *= mix(1.0, uAtmoGain, smoothstep(0.08, 0.6, dot(n, -rd)) * (hitG ? 1.0 : 0.0));
  // the limb's glow: grazing rays through the lowest air, whiter haze beneath, blue above
  {
    float tMin = max(-dot(ro, rd), 0.0);
    float hMin = length(ro + rd * tMin) - Rg;
    L *= ef_limbGain(hMin, hitG, dot(n, -rd), uLimbGain);
  }
  // noctilucent clouds at the summer mesopause
  vec3 nlc = od_nlc(ro, rd, sun, hitG ? tG.x : 1e9);
  // and nacreous clouds in the Antarctic winter stratosphere
  nlc += od_psc(ro, rd, sun, hitG ? tG.x : 1e9);
  if (hitG) {
    gl_FragColor = vec4(col * T + L + nlc, 1.0);
    vec4 clip = projectionMatrix * viewMatrix * vec4(pG, 1.0);
    gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  } else {
    // limb: clouds that poke above the horizon, then the glowing air
    float lcv = deckHit ? cA : 0.0;
    float li = iA * step(tI.x, tI.y);
    vec3 cc = ciCol * li + cloudCol * lcv * (1.0 - li);
    float ca = li + lcv * (1.0 - li);
    float a = max(ca, 1.0 - dot(T, vec3(1.0 / 3.0)));
    // red sprites over the storms along the night limb
    vec3 spr = od_sprites(ro, rd, sun, uTime);
    gl_FragColor = vec4(cc * T + L + nlc + spr, a);
    gl_FragDepth = gl_FragCoord.z;
  }
  gl_FragColor.rgb *= uReady;
}
`;

// the lane legs (shared with the bake, which marks where each runs) and the arcologies
const LANES = buildLaneTexture();
const ARCO = arcologyUniforms();
const ARCS = buildArcTexture(buildArcs());
export { LANES as EARTH_LANES };
const _clock = { t: 0, wrap: 0 };
const _act = { act: 0, surge: 0 };

export class Earth {
  constructor(bake, quality) {
    this.bake = bake;
    this.uniforms = {
      uSurfA: { value: bake.surfA.texture },
      uSurfB: { value: bake.surfB.texture },
      uClouds: { value: bake.clouds.texture },
      uLights: { value: bake.lights.texture },
      uTransmittanceLUT: U.uTransmittanceLUT,
      uMultiScatLUT: U.uMultiScatLUT,
      uToBody: { value: new THREE.Matrix3() },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunE: U.uSunIlluminance,
      uCloudRot: { value: 0 },
      uCloudTexel: { value: (Math.PI / 2 / bake.clouds.width) * 6371 },
      uSurfTexel: { value: (Math.PI / 2 / (bake.surfA.width || 1024)) * 6371 },
      uTime: { value: 0 },
      uSimDay: { value: 0 },
      uRingN: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 1, 0, 1)) },
      uRingW: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) },
      uMeridian: { value: bodyDir(0, MERIDIAN_LON, new THREE.Vector3()) },   // body frame
      uMoonDir: { value: new THREE.Vector3(0, 0, 1) },
      uLightGain: { value: 1 },
      uPixAng: { value: 0.001 },
      uReady: { value: 0 },
      uAtmoGain: { value: 0.36 },
      uLimbGain: { value: 0.55 },
      uLaneTex: { value: LANES.tex },
      uIds: { value: bake.ids ? bake.ids.texture : null },
      uArcTex: { value: ARCS.tex },
      uTrainT: { value: 0 },
      uTrainWrap: { value: 0 },
      uShipT: { value: 0 },
      uShipWrap: { value: 0 },
      uArco: { value: ARCO.pos },
      uArcoK: { value: ARCO.kind },
      uNlcGain: { value: 1 },
      uAuroraAct: { value: 0.5 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      defines: { QUALITY: quality.earthQ, STEPS: quality.atmoSteps },
      transparent: true,
      depthWrite: true,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(R_TOP + 3, 192, 96), this.material);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
  }

  setQuality(q) {
    this.material.defines.QUALITY = q.earthQ;
    this.material.defines.STEPS = q.atmoSteps;
    this.material.needsUpdate = true;
  }

  update(sim, realTime) {
    const u = this.uniforms;
    u.uToBody.value.setFromMatrix4(sim.earthMat).transpose();
    u.uSunDir.value.copy(sim.sunDir);
    // the weather drifts east at ~6 m/s as one field
    u.uCloudRot.value = ((sim.t * 6 / 6.371e6) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    u.uTime.value = realTime;
    u.uMoonDir.value.copy(sim.moonPos).normalize();
    u.uReady.value = this.bake.ready ? 1 : 0;
    // the ships run on the sim clock (wrapped per slot period so float precision never drifts)
    shipClock(sim.t, _clock);
    u.uShipT.value = _clock.t;
    u.uShipWrap.value = _clock.wrap;
    trainClock(sim.t, _clock);
    u.uTrainT.value = _clock.t;
    u.uTrainWrap.value = _clock.wrap;
    u.uAuroraAct.value = Aurora.activity(realTime, _act).act;
  }
}
