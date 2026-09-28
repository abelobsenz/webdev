import * as THREE from 'three';
import { ATMO_CONSTANTS, ATMO_SAMPLING } from '../shaders/atmosphere.glsl.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/uniforms.js';
import { SNOISE_GLSL, SPACE_UTIL_GLSL } from './glsl.js';
import { R_EARTH, MERIDIAN_LON, bodyDir } from './sim.js';

// The planet, rendered in one pass on a proxy sphere at the top of the
// atmosphere. Each fragment ray-traces the ground and the cloud shell and
// ray-marches single scattering (Rayleigh, Mie, ozone; same constants and
// transmittance LUT as the city sky) plus the multiple-scattering LUT.

export const R_TOP = 6460;
export const R_CLOUD = R_EARTH + 8;

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
uniform float uCloudPh;       // 0..1 flow phase
uniform float uCloudP;        // flow period (s)
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
varying vec3 vWorld;

${ATMO_CONSTANTS}
${ATMO_SAMPLING}
${NOISE_GLSL}
${SNOISE_GLSL}
${SPACE_UTIL_GLSL}

const float RC = ${R_CLOUD.toFixed(1)};
const float RTOP = ${R_TOP.toFixed(1)};

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

float zonalOmega(float lat) {
  float al = abs(lat);
  float u = -6.0 + 22.0 * smoothstep(0.26, 0.78, al) - 20.0 * smoothstep(0.96, 1.3, al);
  return u / (6.371e6 * max(cos(lat), 0.25));
}

// Cloud density in the body frame, flowing with the zonal winds
float cloudDensity(vec3 b, float lod, float fp) {
  float lat = asin(clamp(b.y, -1.0, 1.0));
  float w = zonalOmega(lat) * uCloudP;
  float ph0 = uCloudPh, ph1 = fract(uCloudPh + 0.5);
  vec4 c0 = textureLod(uClouds, rotY(b, -w * ph0), lod);
  vec4 c1 = textureLod(uClouds, rotY(b, -w * ph1), lod);
  float k = abs(2.0 * ph0 - 1.0);           // 1 at the ends of phase 0 -> use c1
  float pot = mix(c0.r, c1.g, k);
  float bias = mix(c0.b, c1.b, k) - 0.5;
  pot += bias;
#if QUALITY > 0
  if (fp < 18.0) {
    float det = snoise(b * 900.0 + vec3(uCloudPh * 3.0, 0.0, 0.0)) * 0.5 + snoise(b * 2300.0) * 0.25;
    pot += det * 0.06 * smoothstep(18.0, 4.0, fp);
  }
#endif
  float dens = smoothstep(0.5, 0.66, pot);
  float ci = mix(c0.a, c1.a, k);
  dens = max(dens, smoothstep(0.45, 0.85, ci) * 0.45);
  return dens;
}

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
      S += vec3(0.25, 1.0, 0.45) * 2.2e-5 * exp(-pow(abs(h - 94.0) / 5.0, 2.0)) * (1.0 - smoothstep(-0.25, 0.05, mu));
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
  float Hd = H;
#if QUALITY > 0
  float coastW = exp(-abs(H) * 10.0) * smoothstep(14.0, 2.0, fp);
  if (coastW > 0.01) Hd += (snoise(b * 1500.0) * 0.6 + snoise(b * 4100.0) * 0.4) * 0.05 * coastW;
#endif
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
  float hK = max(H, 0.0) * 6.0 * 3.5;        // km, exaggerated x3.5
#if QUALITY > 0
  // sub-texel ridges and valleys in the uplands (~18 km and ~6 km), each fading to flat
  // while it still spans a few pixels; evaluated unconditionally so the derivatives stay defined
  float mtn = smoothstep(0.02, 0.25, H);
  float rA = 0.5 - abs(snoise(b * 350.0));
  float rB = 0.5 - abs(snoise(b * 1100.0 + 7.0));
  hK += mtn * (rA * 1.4 * (1.0 - smoothstep(3.0, 6.0, fp)) + rB * 0.45 * (1.0 - smoothstep(1.0, 2.0, fp)));
#endif
  float dhx = dFdx(hK), dhy = dFdy(hK);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  vec3 nb = normalize(abs(det) * n - grad * landF);
  if (abs(det) < 1e-12) nb = n;

  float mu = dot(n, sun);
  vec3 sunT = sampleTransmittance(uTransmittanceLUT, Rg + 0.3, mu) * smoothstep(-0.03, 0.02, mu);
  float rsh = ringShadow(pG, sun);
  // cloud shadow: density where the sun ray leaves the cloud shell
  float csh = 1.0;
  {
    vec2 ts = sphereHits(pG, sun, RC);
    vec3 ps = pG + sun * max(ts.y, 0.0);
    float cs = cloudDensity(uToBody * normalize(ps), 2.5, 30.0);
    csh = 1.0 - 0.82 * cs;
  }
  float shadow = rsh * csh;
  vec3 skyAmb = uSunE * vec3(0.05, 0.085, 0.16) * smoothstep(-0.28, 0.35, mu) * (0.35 + 0.65 * clamp(mu + 0.3, 0.0, 1.0));
  vec3 V = -rd;
  // land
  float ndl = max(dot(nb, sun), 0.0);
  vec3 landCol = landAlb / S_PI * (uSunE * sunT * ndl * shadow + skyAmb * (0.6 + 0.4 * shadow));
  // ocean with sun glint
  vec3 seaCol;
  {
    // sea-surface roughness from the wind (Cox-Munk, ~7 m/s): a broad smooth glint, gently
    // varied by weather systems, with calm slicks streaking it where they are resolved
    float wind = snoise(b * 7.0 + vec3(0.0, uCloudPh * 0.6, 0.0)) * 0.5 + 0.5;
    float al = mix(0.17, 0.25, wind);
#if QUALITY > 0
    float slick = smoothstep(0.55, 0.8, snoise(b * vec3(90.0, 260.0, 90.0) + wind * 3.0) * 0.5 + 0.5) * (1.0 - smoothstep(2.0, 8.0, fp));
    al -= 0.05 * slick;
#endif
    al = mix(al, 0.5, ice);
    vec3 Hh = normalize(V + sun);
    float nh = max(dot(n, Hh), 0.0), nv = max(dot(n, V), 1e-3), nl = max(dot(n, sun), 0.0);
    float a2 = al * al;
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (S_PI * dd * dd);
    float k = al * 0.5;
    float G = (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k));
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, Hh), 0.0), 5.0);
    float Fv = 0.02 + 0.98 * pow(clamp(1.0 - nv, 0.0, 1.0), 5.0);
    vec3 spec = vec3(D * G * F / (4.0 * nv + 1e-4)) * uSunE * sunT * shadow;
    vec3 skyRefl = uSunE * vec3(0.03, 0.06, 0.13) * smoothstep(-0.2, 0.3, mu);
    vec3 body = seaAlb / S_PI * (uSunE * sunT * nl * shadow + skyAmb);
    seaCol = body * (1.0 - Fv) + Fv * skyRefl + spec * (1.0 - ice);
    seaCol = mix(seaCol, seaAlb / S_PI * (uSunE * sunT * nl * shadow + skyAmb), ice);
  }
  vec3 col = mix(seaCol, landCol, landF);

  // Meridian's atoll
  float mLights;
  vec4 site = meridianSite(b, fp, mLights);
  if (site.a > 0.0) {
    vec3 sc = site.rgb / S_PI * (uSunE * sunT * max(mu, 0.0) * shadow + skyAmb);
    col = mix(col, sc, site.a);
  }

  // night lights of the Concord: warm old cores, cool new districts, transit filaments
  // (baked), with district and block lattices where they are resolved, and Meridian
  float night = 1.0 - smoothstep(-0.12, 0.05, mu);
  vec4 LT = texture(uLights, b);
  float lw = LT.r, lc = LT.g, ln = LT.b;
  float micro = 1.0;
#if QUALITY > 0
  micro = cityLattice(b, fp);
#endif
  // brighter from afar, where a city is a pixel's mean, calmer close up so districts keep their
  // structure (a smooth function of range: nothing pops)
  float rangeK = mix(0.6, 1.7, smoothstep(3.0, 30.0, fp));
  vec3 emis = ((vec3(1.0, 0.58, 0.26) * lw * 7.0 + vec3(0.62, 0.88, 1.0) * lc * 6.5) * micro + vec3(0.72, 0.86, 1.0) * ln * 0.95) * rangeK;
  emis += meridianNight(b, fp);

  // clouds
  vec2 tC = sphereHits(ro, rd, RC);
  vec3 pC = ro + rd * max(tC.x, 0.0);
  vec3 nC = normalize(pC);
  vec3 bC = uToBody * nC;
  float fpC = max(tC.x, 0.0) * uPixAng;
  float cA = tC.x < tC.y ? cloudDensity(bC, 0.0, fpC) : 0.0;
  vec3 cloudCol = vec3(0.0);
  {
    float muC = dot(nC, sun);
    vec3 sunTc = sampleTransmittance(uTransmittanceLUT, RC, muC) * earthShadow(pC * 1.0005, sun);
    // self shadowing: density a little toward the Sun
    vec3 st = normalize(sun - nC * muC + 1e-5);
    float cs = cloudDensity(uToBody * normalize(nC + st * 0.006), 1.0, 30.0);
    float shade = exp(-2.2 * max(cs - cA * 0.35, 0.0));
    float wrap = clamp((muC + 0.12) / 1.12, 0.0, 1.0);
    float rs = ringShadow(pC, sun);
    vec3 amb = uSunE * vec3(0.06, 0.09, 0.15) * smoothstep(-0.25, 0.3, muC);
    cloudCol = vec3(0.92) / S_PI * (uSunE * sunTc * wrap * (0.35 + 0.65 * shade) * rs + amb * (0.7 + 0.3 * shade));
    // city glow on cloud undersides, lightning in the deep convection
    float nightC = 1.0 - smoothstep(-0.10, 0.06, muC);
    // lights below glow through the deck and light it from beneath, softened by scattering
    vec4 LU = textureLod(uLights, bC, 3.0);
    float under = LU.r * 1.2 + LU.g * 0.8 + LU.b * 0.3;
    cloudCol += mix(vec3(1.0, 0.62, 0.34), vec3(0.8, 0.85, 0.95), 0.3) * under * 1.1 * nightC;
    vec3 cell = floor(bC * 260.0);
    float hsh = hash13(cell + floor(uTime * 1.7));
    float flash = step(0.9975, hsh) * smoothstep(0.55, 0.9, cA) * nightC;
    flash *= 0.5 + 0.5 * sin(uTime * 40.0 + hsh * 60.0);
    // only where a storm cell spans a few pixels: from high orbit single-pixel strikes
    // read as random flashing lights
    flash *= 1.0 - smoothstep(6.0, 16.0, fpC);
    cloudCol += vec3(0.75, 0.82, 1.0) * flash * 1.6;
    // faint moonlight
    cloudCol += vec3(0.5, 0.6, 0.8) * 0.004 * max(dot(nC, uMoonDir), 0.0) * nightC;
  }
  emis *= 1.0 - cA * 0.8;
  col += emis * uLightGain * night;
  col = mix(col, cloudCol, cA);

  // atmosphere
  vec3 T;
  float tEnd = hitG ? tG.x : tA.y;
  vec3 L = integrateAtmo(ro, rd, t0, tEnd, hitG, sun, T);
  // artistic: thin the blue veil over the disc a little, keep the limb at full strength
  L *= mix(1.0, uAtmoGain, smoothstep(0.08, 0.6, dot(n, -rd)) * (hitG ? 1.0 : 0.0));
  if (hitG) {
    gl_FragColor = vec4(col * T + L, 1.0);
    vec4 clip = projectionMatrix * viewMatrix * vec4(pG, 1.0);
    gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  } else {
    // limb: clouds that poke above the horizon, then the glowing air
    float lc = cA * step(tC.x, tC.y);
    float a = max(lc, 1.0 - dot(T, vec3(1.0 / 3.0)));
    gl_FragColor = vec4(cloudCol * lc * T + L, a);
    gl_FragDepth = gl_FragCoord.z;
  }
  gl_FragColor.rgb *= uReady;
}
`;

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
      uCloudPh: { value: 0 },
      uCloudP: { value: 3 * 86400 },
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
    u.uCloudPh.value = ((sim.t / u.uCloudP.value) % 1 + 1) % 1;
    u.uTime.value = realTime;
    u.uMoonDir.value.copy(sim.moonPos).normalize();
    u.uReady.value = this.bake.ready ? 1 : 0;
  }
}
