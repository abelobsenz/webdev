import * as THREE from 'three';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { SNOISE_GLSL } from './glsl.js';
import { SITE_GLSL } from './lunarSite.js';

// GPU bake of the terraformed Moon into cube maps (Moon frame: +X faces the Earth,
// +Y north, east = -Z).
//   moonA: rgb = sqrt(albedo) (land, or the sea bed under water), a = height, encoded
//          0.5 + 0.5 sign(h) sqrt(|h| / 9 km): sea level at 0.5, fine steps near the shore
//   moonN: rgb = surface normal (Moon frame) * 0.5 + 0.5, a = water (1 sea or lake, 0 land)
//   moonC: r, g = two cloud potentials (cross-faded as they drift), b = cirrus, a = spare
//
// The old maria are shallow seas: each basin floor lies a few hundred metres below the
// datum and the sea fills it to the level where the drowned highlands rise out of it, so
// the coasts follow the terrain (bays where craters breach the shore, islands on ghost
// crater rims). Craters come from the lunar size-frequency law in six octaves, flooded
// in the maria where they are older than the seas, plus the named craters people know
// from Earth, with the bright ray systems of the young ones (Tycho, Copernicus, Kepler).

const D2R = Math.PI / 180;

// Mare basins: [lat, lon, angular radius (deg), floor depth (km)]. The irregular seas are
// chains of lobes; the shore itself comes from the terrain.
export const MARIA = [
  // Oceanus Procellarum
  [43, -50, 7, 0.45], [34, -57, 8, 0.55], [22, -59, 8.5, 0.6], [11, -56, 8, 0.55], [1, -58, 6.5, 0.45],
  [-6, -47, 6, 0.45], [18, -45, 7, 0.55], [29, -43, 6, 0.5], [5, -44, 5, 0.4], [-2, -39, 4, 0.35],
  // Imbrium, Sinus Iridum, Sinus Aestuum
  [33, -16, 17.5, 1.1], [44.5, -31, 4, 0.5], [12, -8.5, 3.2, 0.35],
  // Frigoris
  [57, -38, 3, 0.3], [58.5, -24, 3.6, 0.32], [57, -9, 3.6, 0.35], [56, 6, 3.6, 0.35], [57, 20, 3.3, 0.3], [56, 33, 3, 0.28],
  // Serenitatis, Tranquillitatis, Vaporum
  [28, 17.5, 10.5, 0.95], [8.5, 30, 9, 0.75], [14, 25, 5, 0.55], [3, 36, 6, 0.55], [-1.5, 26.5, 3.5, 0.35], [13.2, 4, 4, 0.45],
  // Crisium, Fecunditatis, Nectaris
  [17, 59, 8, 1.05], [-7, 51, 8, 0.65], [-2, 55.5, 4.5, 0.45], [-14, 49.5, 5, 0.5], [-15.2, 35.5, 5, 0.8],
  // Nubium, Cognitum, Humorum, Insularum
  [-21, -17, 8, 0.7], [-15, -12, 4.5, 0.5], [-10, -23, 5, 0.45], [-24.4, -38.6, 6, 0.9], [7.5, -31, 6.5, 0.5],
  // the eastern limb: Marginis, Smythii, Undarum, Australe, Humboldtianum
  [13.3, 86, 5, 0.5], [1.3, 87.5, 5.5, 0.6], [6.8, 68.4, 3.5, 0.4], [-39, 93, 6, 0.5], [-45, 82, 4, 0.4], [56.8, 81.5, 4.5, 0.6],
  // Orientale
  [-19.4, -92.8, 5, 1.0],
  // far side: Moscoviense, Ingenii, Apollo, and the South Pole-Aitken inland sea
  [27.3, 147.9, 4.5, 0.6], [-33.7, 163.5, 5, 0.5], [-36, -151, 5, 0.8], [-53, -169, 17, 2.4], [-45, 170, 9, 1.6],
];

// Basin ring mountains: [lat, lon, ring radius (deg), height (km), width (deg), open side bearing (deg, -1 none)]
export const BASINS = [
  [33, -16, 19.5, 3.4, 1.7, 260],     // Imbrium: Apennines, Carpathians, Alps, Caucasus (open to Procellarum)
  [28, 17.5, 12.5, 1.8, 1.2, -1],     // Serenitatis: Haemus
  [17, 59, 9.5, 2.4, 1.1, -1],        // Crisium
  [-15.2, 35.5, 9.3, 1.6, 1.0, -1],   // Nectaris: Rupes Altai
  [-24.4, -38.6, 7.6, 1.5, 0.9, -1],  // Humorum
  [-19.4, -92.8, 10.3, 3.0, 0.8, -1], // Orientale: Montes Rook
  [-19.4, -92.8, 15.4, 3.4, 1.0, -1], // Orientale: Cordillera
  [-53, -169, 36, 2.8, 5.0, -1],      // South Pole-Aitken rim
  [27.3, 147.9, 7.0, 2.0, 1.0, -1],   // Moscoviense
  [8.5, 30, 13.5, 1.0, 1.5, 120],     // Tranquillitatis
];

// Named craters: [lat, lon, diameter (km), age 0 fresh .. 1 ancient, rays, lake]
export const CRATERS = [
  [-43.3, -11.2, 86, 0.02, 1, 0],   // Tycho
  [9.6, -20.1, 93, 0.06, 1, 0],     // Copernicus
  [8.1, -38.0, 31, 0.05, 1, 0],     // Kepler
  [23.7, -47.4, 40, 0.03, 1, 0],    // Aristarchus
  [36.1, 102.9, 22, 0.01, 1, 0],    // Giordano Bruno
  [16.1, 46.8, 28, 0.05, 1, 0],     // Proclus
  [-0.7, -5.9, 25, 0.12, 1, 0],     // Mosting
  [51.6, -9.4, 101, 0.7, 0, 1],     // Plato
  [-58.4, -14.4, 225, 0.9, 0, 0],   // Clavius
  [-9.3, -1.9, 153, 0.92, 0, 0],    // Ptolemaeus
  [-13.4, -2.8, 108, 0.82, 0, 0],   // Alphonsus
  [-18.2, -1.9, 97, 0.5, 0, 0],     // Arzachel
  [-11.4, 26.4, 100, 0.3, 0, 0],    // Theophilus
  [-13.2, 24.0, 98, 0.8, 0, 0],     // Cyrillus
  [-18.0, 23.4, 100, 0.86, 0, 0],   // Catharina
  [-8.9, 61.1, 132, 0.3, 0, 0],     // Langrenus
  [-25.3, 60.4, 184, 0.5, 0, 0],    // Petavius
  [-5.2, -68.6, 172, 0.9, 0, 1],    // Grimaldi
  [29.7, -4.0, 83, 0.5, 0, 0],      // Archimedes
  [14.5, -11.3, 58, 0.35, 0, 0],    // Eratosthenes
  [-20.4, 129.1, 185, 0.4, 0, 1],   // Tsiolkovskiy
  [-50.0, -6.2, 194, 0.9, 0, 0],    // Maginus
  [-49.6, -21.7, 145, 0.8, 0, 0],   // Longomontanus
  [-44.4, -54.6, 227, 0.9, 0, 1],   // Schickard
  [-5.1, 5.2, 138, 0.95, 0, 0],     // Hipparchus
  [-11.2, 4.1, 136, 0.9, 0, 0],     // Albategnius
  [-41.1, 6.0, 126, 0.9, 0, 0],     // Stofler
  [-45.4, 40.3, 190, 0.95, 0, 0],   // Janssen
  [-27.2, 80.9, 207, 0.6, 0, 0],    // Humboldt
  [53.9, 56.5, 125, 0.8, 0, 1],     // Endymion
  [31.8, 29.9, 95, 0.7, 0, 0],      // Posidonius
  [46.7, 44.4, 87, 0.5, 0, 0],      // Atlas
  [50.2, 17.4, 87, 0.45, 0, 0],     // Aristoteles
  [44.3, 16.3, 67, 0.45, 0, 0],     // Eudoxus
  [14.5, 9.1, 38, 0.3, 0, 0],       // Manilius
  [4.2, 3.6, 26, 0.2, 0, 0],        // Triesnecker (an island crater in the Bay)
  [-5.7, -2.1, 40, 0.6, 0, 0],      // Herschel
  [-3.4, -3.7, 75, 0.95, 0, 0],     // Flammarion
  [0.0, 4.9, 45, 0.85, 0, 0],       // Rhaeticus
  [26.3, 3.7, 0, 0, 0, 0],          // (Hadley: marker only, no crater)
  [-38.0, 108.0, 170, 0.7, 0, 1],   // far-side lake
  [60.0, 120.0, 150, 0.6, 0, 0],
  [10.0, 170.0, 160, 0.75, 0, 0],   // Korolev-like
  [-5.0, -128.0, 437, 0.95, 0, 0],  // Hertzsprung (worn)
];

// Settled places at night: [lat, lon, weight]. Medii Landing first (under the Exchange).
// Every other town stands on dry land: at least 8 km from anywhere the bake can put water
// (lunarNetwork.js seaClearance, asserted by tools/verify-moon-w2.mjs); the ones first laid
// out in the maria were moved to the nearest dry shore.
export const TOWNS = [
  [0, 0, 1.0], [8, -2.5, 0.6], [24, 3, 0.55], [18.56, 30.37, 0.6], [2, 21.83, 0.55], [-8.08, 42.34, 0.45], [-22, -30, 0.45],
  [40.82, 5.11, 0.45], [12, -24, 0.5], [26.62, -36.34, 0.45], [-2, 15, 0.5], [14.39, 49.19, 0.4], [-29.34, -21.1, 0.35], [-13.68, -6.51, 0.4],
];

const BAKE_FRAG = /* glsl */ `
precision highp float;
uniform int uFace;
uniform int uOut;
uniform vec4 uMaria[${MARIA.length}];
uniform vec4 uMariaD[${MARIA.length}];
uniform vec4 uBasin[${BASINS.length}];
uniform vec4 uBasinP[${BASINS.length}];
uniform vec4 uCrat[${CRATERS.length}];
uniform vec4 uCratP[${CRATERS.length}];
uniform float uEps;
varying vec2 vUv;
${NOISE_GLSL}
${SNOISE_GLSL}
${SITE_GLSL}
#define RM 1737.0

vec3 faceDir(vec2 st) {
  float sc = st.x * 2.0 - 1.0, tc = st.y * 2.0 - 1.0;
  vec3 d;
  if (uFace == 0) d = vec3(1.0, -tc, -sc);
  else if (uFace == 1) d = vec3(-1.0, -tc, sc);
  else if (uFace == 2) d = vec3(sc, 1.0, tc);
  else if (uFace == 3) d = vec3(sc, -1.0, -tc);
  else if (uFace == 4) d = vec3(sc, -tc, 1.0);
  else d = vec3(-sc, -tc, -1.0);
  return normalize(d);
}

float angTo(vec3 a, vec3 b) { return acos(clamp(dot(a, b), -1.0, 1.0)); }

// Crater relief (km) at normalised distance x = d / R, for a crater of radius Rk (km).
// Simple bowls below ~18 km across, flat floors, terraces and central peaks above
// (depth and rim height from the lunar morphometry laws), ejecta falling off as x^-3.
float craterProfile(float x, float Rk, float age, out float inner) {
  float D = 2.0 * Rk;
  float cx = smoothstep(14.0, 24.0, D);                       // simple -> complex
  float depth = mix(0.196 * D, 1.044 * pow(D, 0.301), cx) * (1.0 - 0.62 * age);
  float rim = mix(0.036 * D, 0.236 * pow(D, 0.399), cx) * (1.0 - 0.5 * age);
  float fl = cx * clamp(0.28 + D / 450.0, 0.28, 0.62);
  float h;
  inner = 0.0;
  if (x < 1.0) {
    float t = clamp((x - fl) / (1.0 - fl), 0.0, 1.0);
    float tt = t * t * (1.6 - 0.6 * t);
    tt += cx * 0.035 * sin(t * 25.13) * t * (1.0 - age);       // wall terraces
    h = -depth + (depth + rim) * tt;
    h += cx * depth * 0.42 * exp(-x * x / 0.011) * (1.0 - 0.6 * age) * step(D, 180.0);   // central peak
    inner = 1.0 - smoothstep(fl + 0.05, fl + 0.25, x);
  } else {
    h = rim * pow(x, -3.0) * (1.0 - smoothstep(2.2, 3.0, x));
  }
  return h;
}

// Ray system of a young crater (angle-dependent streaks reaching ~15 radii)
float raySystem(vec3 p, vec3 c, float Rang, float seed) {
  float x = angTo(p, c) / Rang;
  if (x < 0.9 || x > 22.0) return 0.0;
  vec3 e1 = normalize(cross(c, abs(c.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(c, e1);
  float th = atan(dot(p, e2), dot(p, e1));
  vec2 cs = vec2(cos(th), sin(th));
  float s = snoise(vec3(cs * 5.0, seed)) * 0.55 + snoise(vec3(cs * 14.0, seed + 3.0)) * 0.3 + snoise(vec3(cs * 38.0, seed + 7.0)) * 0.15;
  float spoke = pow(clamp(s * 0.5 + 0.55, 0.0, 1.0), 5.0) * 2.4;
  float mott = 0.55 + 0.45 * snoise(vec3(cs * 9.0 + x * 0.35, seed + 11.0));
  float blanket = exp(-(x - 1.0) * 1.6);
  return spoke * mott * exp(-(x - 1.0) / 6.5) + blanket;
}

struct Surf { float h; float mare; float fresh; float ray; float lake; float coast; float inner; };

// The whole terrain at one direction.
Surf terrain(vec3 p) {
  Surf s;
  s.fresh = 0.0; s.ray = 0.0; s.lake = 0.0; s.inner = 0.0;
  vec3 SW = SITE_WEST, SN = SITE_NORTH;
  float siteD = angTo(p, SITE_UP) * RM;                    // km from the Lift
  // --- highland terrain ---
  float n1 = sfbm(p * 4.0 + 3.0, 5);
  float r1 = sridged(p * 11.0 + 1.7, 5);
  float r2 = sridged(p * 37.0 + 8.3, 4);
  float hLand = 0.9 + 0.75 * n1 + 1.1 * r1 * r1 + 0.35 * r2 + 0.25 * sfbm(p * 90.0, 3);
  // --- maria: basin floors below the datum ---
  vec3 pw = normalize(p + 0.03 * vec3(snoise(p * 3.1 + 5.0), snoise(p * 3.1 + 11.0), snoise(p * 3.1 + 23.0)));
  float blend = 0.0, floorD = 0.0, coast = 0.0;
  for (int i = 0; i < ${MARIA.length}; i++) {
    vec4 M = uMaria[i];
    float d = angTo(pw, M.xyz);
    float e = (M.w - d) / M.w;
    float b = smoothstep(-0.18, 0.12, e);
    blend = max(blend, b);
    floorD = max(floorD, uMariaD[i].x * b * (0.75 + 0.25 * smoothstep(0.0, 0.7, e)));
  }
  // the Bay of the Middle, exact near the Lift so the harbour meets the drawn coast
  {
    vec2 q = vec2(dot(p, SW), dot(p, SN)) * RM;
    float bd = dot(p, SITE_UP) > 0.5 ? bayDist(q) : -1000.0;
    float b = smoothstep(-26.0, 16.0, bd);
    blend = max(blend, b);
    floorD = max(floorD, 0.42 * b);
  }
  float wrinkle = sridged(p * 60.0 + 4.0, 3) * 0.12;         // wrinkle ridges: shoals in the seas
  float h = mix(hLand, -floorD + wrinkle, blend);
  // --- basin rings ---
  for (int i = 0; i < ${BASINS.length}; i++) {
    vec4 B = uBasin[i]; vec4 P = uBasinP[i];
    float d = angTo(p, B.xyz);
    float x = (d - B.w) / P.y;
    if (abs(x) > 3.0) continue;
    float br = smoothstep(-0.25, 0.35, sfbm(p * 26.0 + float(i) * 3.7, 3)) * (0.55 + 0.45 * sridged(p * 70.0 + float(i), 3));
    if (P.w >= 0.0) {
      vec3 e1 = normalize(cross(B.xyz, vec3(0.0, 1.0, 0.0)));
      vec3 e2 = cross(B.xyz, e1);
      float th = atan(dot(p, e1), dot(p, e2)) * 57.2958;
      float dth = abs(mod(th - P.w + 180.0, 360.0) - 180.0);
      br *= smoothstep(40.0, 85.0, dth);
    }
    h += P.x * exp(-x * x) * br;
  }
  // --- named craters ---
  for (int i = 0; i < ${CRATERS.length}; i++) {
    vec4 C = uCrat[i]; vec4 P = uCratP[i];
    if (C.w <= 0.0) continue;
    float d = angTo(p, C.xyz);
    float x = d / C.w;
    if (P.y > 0.5) s.ray = max(s.ray, raySystem(p, C.xyz, C.w, P.w) * (1.0 - 0.8 * P.x / 0.2));
    if (x > 3.0) continue;
    float inner;
    float hc = craterProfile(x, C.w * RM, P.x, inner);
    h += hc * (1.0 - blend * 0.6 * step(0.3, P.x));
    s.inner = max(s.inner, inner);
    if (P.z > 0.5 && inner > 0.5) s.lake = max(s.lake, smoothstep(0.5, 0.8, inner));
    s.fresh = max(s.fresh, (1.0 - smoothstep(0.02, 0.25, P.x)) * (1.0 - smoothstep(1.0, 2.6, x)));
  }
  // --- the crater population: five octaves, from ~230 km down to ~6 km across ---
  float quiet = smoothstep(9.0, 30.0, siteD);               // no random craters on the Landing
  for (int o = 0; o < 5; o++) {
    float sc = 6.0 * pow(2.0, float(o));
    float dens = 0.3 + 0.05 * float(o);
    vec3 q = p * sc;
    vec3 base = floor(q);
    for (int k = 0; k < 27; k++) {
      vec3 cell = base + vec3(float(k / 9) - 1.0, float((k / 3) % 3) - 1.0, float(k % 3) - 1.0);
      vec3 hh = hash33(cell + float(o) * 17.13);
      if (hh.x > dens) continue;
      vec3 hh2 = hash33(cell * 1.37 + float(o) * 5.1 + 3.3);
      vec3 cen = normalize(cell + 0.15 + 0.7 * hh2);
      float Rang = (0.1 + 0.3 * hh.y * hh.y) / sc;       // radius (rad), many small, few large
      float d = angTo(p, cen);
      float x = d / Rang;
      if (x > 3.0) continue;
      float age = hh.z;
      float inner;
      float hc = craterProfile(x, Rang * RM, age, inner);
      // older than the seas: drowned in the maria (their rims survive as shoals)
      float flood = blend * mix(0.25, 0.85, step(0.3, age));
      h += hc * (1.0 - flood) * quiet;
      s.inner = max(s.inner, inner * quiet * (1.0 - blend));
      s.fresh = max(s.fresh, 0.6 * (1.0 - smoothstep(0.01, 0.04, age)) * (1.0 - smoothstep(1.0, 2.0, x)) * quiet);
      if (o < 4 && hh2.x > 0.92 && age > 0.3) s.lake = max(s.lake, smoothstep(0.5, 0.8, inner) * quiet * (1.0 - blend));
    }
  }
  // the Landing's coastal plain: level ground a few metres above the Bay
  float plain = 1.0 - smoothstep(6.0, 22.0, siteD);
  vec2 qs = vec2(dot(p, SW), dot(p, SN)) * RM;
  float bdS = bayDist(qs);
  float plainH = bdS > 0.0 ? -min(0.3, bdS * 0.03) : 0.012 + 0.004 * min(-bdS, 8.0);
  h = mix(h, plainH, plain);
  s.h = h;
  s.mare = blend;
  // coast band (for settlement): within ~40 km of sea level on land
  s.coast = (1.0 - smoothstep(0.0, 0.9, abs(h))) * step(0.0, h);
  return s;
}

void main() {
  vec3 p = faceDir(vUv);
  if (uOut == 2) {
    // weather: two drifting potential fields and cirrus
    vec3 q = p * 3.2;
    vec3 w = vec3(sfbm(q + 3.1, 4), sfbm(q + 7.7, 4), sfbm(q + 1.9, 4));
    float a = sfbm(q * 1.4 + w * 0.8, 6) * 0.5 + 0.5;
    float b = sfbm(q * 1.4 + w * 0.8 + 19.0, 6) * 0.5 + 0.5;
    float cells = sridged(p * 40.0, 3);
    float ci = sfbm(vec3(p.x * 6.0, p.y * 30.0, p.z * 6.0) + w, 4) * 0.5 + 0.5;
    gl_FragColor = vec4(a * 0.85 + cells * 0.15, b * 0.85 + cells * 0.15, ci * 0.8, 1.0);
    return;
  }
  Surf s = terrain(p);
  // water: the flooded basins (and the crater lakes); deep crater floors in the highlands
  // below the datum stay dry land
  bool water = (s.h < 0.0 && s.mare > 0.4) || s.lake > 0.5;
  if (uOut == 1) {
    // normal from the height field (finite differences one texel apart)
    vec3 e1 = normalize(cross(p, abs(p.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(p, e1);
    float h0 = max(s.h, 0.0);
    Surf sx = terrain(normalize(p + e1 * uEps));
    Surf sy = terrain(normalize(p + e2 * uEps));
    float gx = (max(sx.h, 0.0) - h0) / (uEps * RM);
    float gy = (max(sy.h, 0.0) - h0) / (uEps * RM);
    if (water) { gx = 0.0; gy = 0.0; }
    vec3 n = normalize(p - e1 * gx - e2 * gy);
    gl_FragColor = vec4(n * 0.5 + 0.5, water ? 1.0 : 0.0);
    return;
  }
  // ---- albedo ----
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float nA = sfbm(p * 18.0 + 5.0, 4);
  float nB = sfbm(p * 70.0 + 2.0, 3);
  // climate: wetter toward the seas and in the lowlands, drier on the high far-side plateaus
  float seaNear = smoothstep(-0.9, 0.2, s.mare - 0.3) * 0.0 + s.mare;
  float wet = clamp(0.52 + 0.38 * sfbm(p * 2.3 + 9.0, 3) + 0.22 * nA + 0.3 * seaNear + 0.15 * s.coast - 0.3 * smoothstep(1.6, 3.2, s.h), 0.0, 1.0);
  vec3 forest = vec3(0.018, 0.036, 0.014);
  vec3 meadow = vec3(0.045, 0.066, 0.022);
  vec3 steppe = vec3(0.1, 0.088, 0.055);
  vec3 heath = vec3(0.09, 0.078, 0.058);
  vec3 rock = vec3(0.19, 0.185, 0.175);
  vec3 fresh = vec3(0.26, 0.255, 0.24);
  vec3 c = mix(steppe, meadow, smoothstep(0.2, 0.5, wet));
  c = mix(c, forest, smoothstep(0.55, 0.85, wet) * (1.0 - smoothstep(1.6, 2.6, s.h)));
  c = mix(c, heath, smoothstep(2.4, 3.3, s.h) * (1.0 - s.inner * 0.5));
  // bare anorthosite on the heights and on crater walls; crater floors grassed
  c = mix(c, rock, clamp(smoothstep(3.0, 4.2, s.h) + 0.5 * smoothstep(0.55, 0.95, sridged(p * 140.0, 3)) * smoothstep(1.5, 3.0, s.h), 0.0, 1.0));
  // fresh ejecta and rays: pale young soil, thinly grassed
  c = mix(c, fresh, clamp(s.fresh * 0.85 + s.ray * 0.32, 0.0, 0.9));
  c *= 0.85 + 0.3 * (nB * 0.5 + 0.5);
  // beaches
  c = mix(c, vec3(0.33, 0.3, 0.23), (1.0 - smoothstep(0.004, 0.03, s.h)) * step(0.0, s.h));
  // snow and ice toward the poles and on the high massifs
  float snow = smoothstep(1.2, 1.32, abs(lat) + 0.04 * nA) + smoothstep(4.6, 5.3, s.h + 0.4 * nA);
  c = mix(c, vec3(0.74, 0.77, 0.8), clamp(snow, 0.0, 1.0));
  if (water) {
    // the sea bed: sand in the shallows, silt below
    float dep = s.lake > 0.5 ? 0.04 : -s.h;
    c = mix(vec3(0.3, 0.27, 0.2), vec3(0.05, 0.06, 0.05), smoothstep(0.005, 0.12, dep));
    c = mix(c, vec3(0.7, 0.73, 0.78), smoothstep(1.26, 1.34, abs(lat) + 0.03 * nA));   // polar sea ice
  }
  float hEnc = s.lake > 0.5 ? -0.03 : (water ? min(s.h, -0.0005) : s.h);
  float enc = 0.5 + 0.5 * sign(hEnc) * sqrt(min(abs(hEnc), 9.0) / 9.0);
  gl_FragColor = vec4(sqrt(clamp(c, 0.0, 1.0)), enc);
}
`;

const dir = ([lat, lon], v = new THREE.Vector3()) => {
  const la = lat * D2R, lo = lon * D2R;
  return v.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
};

export class MoonBake {
  constructor(renderer, size) {
    this.renderer = renderer;
    // Albedo+height and normals bake to half floats: in 8 bits the height code stepped every
    // ~65 m at 2 km altitude and the normals every half a degree, which read as terraced
    // plateaus and square shadow blocks under a low Sun. Clouds keep 8 bits.
    const mk = (s, type = THREE.UnsignedByteType) => {
      const rt = new THREE.WebGLCubeRenderTarget(s, { type, format: THREE.RGBAFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      rt.texture.colorSpace = THREE.NoColorSpace;
      return rt;
    };
    this.size = size;
    this.moonA = mk(size, THREE.HalfFloatType);
    this.moonN = mk(size, THREE.HalfFloatType);
    this.moonC = mk(Math.min(size, 512));
    const v4 = (a, w) => { const v = dir(a); return new THREE.Vector4(v.x, v.y, v.z, w); };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: BAKE_FRAG,
      uniforms: {
        uFace: { value: 0 },
        uOut: { value: 0 },
        uEps: { value: 2 / size },
        uMaria: { value: MARIA.map((m) => v4(m, m[2] * D2R)) },
        uMariaD: { value: MARIA.map((m) => new THREE.Vector4(m[3], 0, 0, 0)) },
        uBasin: { value: BASINS.map((b) => v4(b, b[2] * D2R)) },
        uBasinP: { value: BASINS.map((b) => new THREE.Vector4(b[3], b[4] * D2R, 0, b[5])) },
        uCrat: { value: CRATERS.map((c) => v4(c, (c[2] / 2) / 1737)) },
        uCratP: { value: CRATERS.map((c, i) => new THREE.Vector4(c[3], c[4], c[5], i * 7.31 + 1.7)) },
      },
      depthTest: false, depthWrite: false,
    });
    this.pass = new FullscreenPass(this.mat);
    this.jobs = [];
    for (const [out, rt] of [[2, this.moonC], [0, this.moonA], [1, this.moonN]]) for (let f = 0; f < 6; f++) this.jobs.push({ out, rt, f });
    this.done = false;
  }

  get ready() { return this.done; }

  /** Render up to n cube faces. Returns true once every map is baked. */
  step(n = 1) {
    if (this.done) return true;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    for (let i = 0; i < n && this.jobs.length; i++) {
      const j = this.jobs.shift();
      this.mat.uniforms.uOut.value = j.out;
      this.mat.uniforms.uFace.value = j.f;
      r.setRenderTarget(j.rt, j.f);
      r.render(this.pass.scene, this.pass.camera);
    }
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
    if (!this.jobs.length) this.done = true;
    return this.done;
  }
}
