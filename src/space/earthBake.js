import * as THREE from 'three';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';
import { SNOISE_GLSL } from './glsl.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { LAND_MASK_PNG } from './landmask.js';
import { CITIES, RANGES, DESERTS, HALO_PORTS, WILDS, FISHING, RIVERS, VORTEX_ISLES } from './earthData.js';
import { LANE_BAKE_GLSL, buildLaneTexture } from './earthDetail.js';
import { bodyDir } from './sim.js';

// GPU bake of the planet's surface and weather into cube maps (body frame).
//   surfA: rgb = sqrt(albedo), a = height (0.5 = sea level)
//   surfB: r = mineral dust optical depth / 1.2, g = ice, b = aridity, a = shallow shelf
//   clouds (half float): r = cloud potential, g = stratiform share, b = open cells, a = cirrus

const D2R = Math.PI / 180;

const BAKE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMask;
uniform sampler2D uData;
uniform int uNumSeg;
uniform int uNumCity;
uniform int uFace;
uniform int uOut;
uniform vec4 uDeserts[10];
uniform vec4 uCyc[28];
uniform int uNumCyc;
uniform int uNumArc;
uniform vec4 uPorts[7];
uniform vec4 uWild[10];
uniform vec4 uSc[5];
uniform float uTexelKm;
uniform vec4 uFish[5];
uniform vec4 uIsles[${VORTEX_ISLES.length}];
uniform vec4 uRivers[${RIVERS.length}];
varying vec2 vUv;
${NOISE_GLSL}
${SNOISE_GLSL}
#define PI 3.14159265359
${LANE_BAKE_GLSL}

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
float maskAt(vec2 uv, float lod) { return textureLod(uMask, uv, lod).r; }

float boxMask(float lat, float lon, vec4 b, float soft) {
  // b = (latMin, latMax, lonMin, lonMax) in degrees
  float la = smoothstep(b.x - soft, b.x + soft, lat) * (1.0 - smoothstep(b.y - soft, b.y + soft, lat));
  float lo = smoothstep(b.z - soft, b.z + soft, lon) * (1.0 - smoothstep(b.w - soft, b.w + soft, lon));
  return la * lo;
}

vec3 rotAround(vec3 p, vec3 axis, float a) {
  float c = cos(a), s = sin(a);
  return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}

// Weather in the body frame, baked once (the Earth shader drifts it slowly and adds every
// scale below ~60 km). Outputs:
//   P  low/middle cloud potential: cloud from 0.5, thicker above (0.8 = deep convection)
//   S  stratiform share: 0 cumuliform (puffs, towers), 1 sheets (stratocumulus, frontal cloud)
//   O  open cells: 1 where cold air over warm sea breaks into rings of cumulus round clear hearts
//   CI cirrus cover
// Regimes: the ITCZ's convective complexes under their anvils, trade cumulus fields just over
// the threshold, clear subtropical highs, stratocumulus sheets over the cold eastern currents
// fraying westward into open cells, comma clouds on the mid-latitude lows (cold-front tail,
// warm-front shield, hooked head, dry slot) with open cells in the cold air behind them,
// tropical cyclones (eye, eyewall, central dense overcast, broken rainbands, ice canopy), polar
// stratus, and cirrus streaming along the jets.
// Von Karman vortex streets: a mountainous island in a shallow marine deck under an inversion
// sheds eddies alternately from either flank, and they march downwind in two staggered rows,
// each a clear-hearted spiral in the cloud, ~5 island diameters apart, growing as they go.
const float ISLE_AZ[${VORTEX_ISLES.length}] = float[${VORTEX_ISLES.length}](${VORTEX_ISLES.map((v) => (v[3] * Math.PI / 180).toFixed(4)).join(', ')});
float vortexStreets(vec3 d) {
  float dp = 0.0;
  for (int i = 0; i < ${VORTEX_ISLES.length}; i++) {
    vec3 c = uIsles[i].xyz;
    float R = uIsles[i].w;
    vec3 dv = d - c;
    float dk = length(dv) * 6371.0;
    if (dk > R * 70.0) continue;
    vec3 e = normalize(cross(vec3(0.0, 1.0, 0.0), c));
    vec3 nn = cross(c, e);
    vec2 P2 = vec2(dot(dv, e), dot(dv, nn)) * 6371.0;
    float az = ISLE_AZ[i];
    vec2 w = vec2(sin(az), cos(az));
    float x = dot(P2, w), y = w.x * P2.y - w.y * P2.x;
    if (x < -R * 2.0) continue;
    float a = 9.0 * R;                                   // spacing along the street
    float fade = exp(-max(x, 0.0) / (a * 6.0));
    // the lee: clear just behind the island, the rows of eddies beyond
    float yl = y / (R * 1.1 + 0.08 * max(x, 0.0));
    float lee = exp(-yl * yl) * exp(-max(x, 0.0) / (R * 5.0)) * step(0.0, x);
    dp -= 0.22 * lee;
    for (int k = 0; k < 7; k++) {
      float fk = float(k);
      float side = mod(fk, 2.0) < 0.5 ? 1.0 : -1.0;
      vec2 vc = vec2(R * 2.5 + (fk + 0.5 * (1.0 - side) * 0.5) * a, side * (0.55 * R + 0.06 * fk * R));
      vec2 q = vec2(x, y) - vc;
      float rv = R * (0.9 + 0.22 * fk);
      float r = length(q);
      if (r > rv * 3.0) continue;
      float th = atan(q.y, q.x) * side;
      // a spiral arm of cloud round a clear heart
      float spiral = 0.5 + 0.5 * cos(th - 3.2 * log(r / rv + 0.05));
      float core = exp(-r * r / (rv * rv * 0.35));
      float zr = (r - rv) / (rv * 0.6);
      float ring = exp(-zr * zr);
      dp += (-0.25 * core + 0.1 * ring * spiral) * fade;
    }
  }
  return dp;
}

void cloudPotential(vec3 d, float seed, out float P, out float S, out float O, out float CI) {
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float alat = abs(lat);
  vec3 p = d;
  float comma = 0.0, shieldC = 0.0, dry = 0.0, calm = 0.0, trop = 0.0, eye = 0.0, canopy = 0.0, coldAir = 0.0, frontS = 0.0, tcS = 0.0;
  for (int i = 0; i < 28; i++) {
    if (i >= uNumCyc) break;
    vec4 c = uCyc[i];
    float R = length(c.xyz);
    if (R < 1e-4 || c.w == 0.0) continue;
    vec3 cd = c.xyz / R;
    float r = length(p - cd);
    float fall = exp(-r * r / (R * R));
    // (a tropical cyclone winds its cloud a turn or so, not so far that the texture shears to threads)
    float cw = abs(c.w) > 7.0 ? c.w * 0.55 : c.w;
    float ang = cw * fall * (1.0 + 0.8 * exp(-r * r / (R * R * 0.1)));
    p = rotAround(p, cd, ang);
    if (r > R * 4.5) continue;
    float hemi = cd.y >= 0.0 ? 1.0 : -1.0;
    vec3 e = normalize(cross(vec3(0.0, 1.0, 0.0), cd));
    vec3 nn = cross(cd, e);
    // local coordinates in radii, y poleward in both hemispheres; the warp already spun p, so
    // the features wind into a spiral toward the centre
    float x = dot(p - cd, e) / R, y = dot(p - cd, nn) / R * hemi;
    float rr = length(vec2(x, y));
    float brk = sfbm(p * 70.0 + float(i) * 3.7, 3) * 0.5 + 0.5;           // convective breakup
    if (abs(c.w) > 7.0) {
      // tropical cyclone: a clear eye inside a bright eyewall, the central dense overcast with a
      // ragged edge, two or three rainbands broken into convective cells, the canopy over all
      float th = atan(y, x) * hemi;
      float edgeN = sfbm(p * 40.0 + float(i), 3);
      float spiral = 0.5 + 0.5 * cos(2.0 * th + 5.0 * log(rr + 0.04) + 1.3 * edgeN);
      // the overcast's edge runs out along the bands (a spiral, not a disc), its top lumpy with
      // the overshooting towers
      float cdo = 1.0 - smoothstep(0.38, 0.8, rr + 0.14 * edgeN - 0.3 * spiral * smoothstep(0.2, 0.55, rr));
      float wall = exp(-pow((rr - 0.1) / 0.05, 2.0));
      float arms = pow(spiral, 3.0) * smoothstep(0.3, 0.55, rr) * exp(-rr / 0.9) * smoothstep(0.25, 0.7, brk + 0.2 * spiral);
      trop = max(trop, max(cdo * (0.78 + 0.3 * brk) + wall * 0.25, arms * 0.85));
      tcS = max(tcS, max(cdo, arms * 0.7));
      eye = max(eye, (1.0 - smoothstep(0.025, 0.07, rr)) * 0.8);
      // the canopy spreads a little beyond the overcast, its outflow fibrous
      canopy = max(canopy, (1.0 - smoothstep(0.35, 1.1, rr + 0.25 * edgeN)) * (0.75 + 0.25 * spiral));
    } else if (c.w * hemi > 0.0) {
      // extratropical low: the comma
      float t = max(-y, 0.0);
      float xc = 0.42 - 0.06 * t - 0.12 * t * t;                          // cold front, trailing west
      float wT = 0.13 + 0.07 * t;
      float tail = exp(-pow((x - xc) / wT, 2.0)) * smoothstep(-0.25, 0.2, -y) * exp(-t / 2.6);
      float shield = exp(-(pow(x - 0.62, 2.0) / 0.45 + pow(y - 0.3, 2.0) / 0.2));   // warm-front shield
      float hook = exp(-pow((rr - 0.33) / 0.12, 2.0)) * smoothstep(-0.2, 0.5, 0.8 * y - 0.6 * x) + 0.8 * exp(-rr * rr / 0.02);
      float slot = exp(-(pow(x + 0.02, 2.0) / 0.06 + pow(y + 0.4, 2.0) / 0.11));    // the dry slot
      float st = clamp(c.w * hemi / 1.6, 0.5, 1.4);
      float band = max(tail * (0.75 + 0.35 * brk), hook) * 0.95 + shield * 0.55;
      comma = max(comma, band * st);
      frontS = max(frontS, max(tail * 0.7, shield) * st);
      shieldC = max(shieldC, (shield * 0.85 + tail * 0.4 + hook * 0.3) * st);
      dry = max(dry, slot * st);
      // the cold air behind the front, streaming out over the sea: open cells
      // (a tongue a radius or two behind the front, over the mid-latitude sea only)
      coldAir = max(coldAir, smoothstep(0.05, 0.5, xc - x) * smoothstep(-1.7, -0.5, y) * (1.0 - smoothstep(0.0, 0.8, y)) * exp(-rr / 1.1) * smoothstep(0.55, 0.75, alat) * st);
    } else {
      calm = max(calm, fall);                                               // subsiding high
    }
  }
  // domain-warped weather at three scales
  vec3 q = p * 2.6 + seed;
  vec3 warp = vec3(sfbm(q * 1.3 + 3.1, 4), sfbm(q * 1.3 + 7.7, 4), sfbm(q * 1.3 + 1.9, 4));
  float large = sfbm(q + warp * 0.55, 5) * 0.5 + 0.5;
  vec3 w2 = vec3(sfbm(p * 9.0 + 5.3, 3), sfbm(p * 9.0 + 2.2, 3), sfbm(p * 9.0 + 8.8, 3));
  float mid = sfbm(p * 8.0 + w2 * 0.5 + seed * 1.3, 5) * 0.5 + 0.5;
  float fine = sfbm(p * 30.0 + w2 * 1.2 + seed * 3.0, 3) * 0.5 + 0.5;
  float lon = atan(-p.z, p.x);
  // the ITCZ sits north of the equator in June, wandering with longitude
  float itczLat = 0.12 + 0.05 * sin(lon * 2.0 + 0.7) + 0.04 * sfbm(vec3(lon * 3.0, seed, 1.0), 2);
  float itcz = exp(-pow((lat - itczLat) / 0.08, 2.0));
  // convective complexes a few hundred km across, merged by their anvils
  float mcsN = sfbm(p * 6.0 + warp * 0.8 + seed * 2.1, 4) * 0.5 + 0.5;
  float mcs = smoothstep(0.5, 0.7, mcsN);
  float subtrop = exp(-pow((alat - 0.5) / 0.1, 2.0));
  float trades = exp(-pow((alat - 0.29) / 0.12, 2.0));
  // the southern winter's storm track is the stronger
  float storm = exp(-pow((alat - 0.93) / 0.2, 2.0)) * (lat < 0.0 ? 1.15 : 0.85);
  float polar = smoothstep(1.12, 1.35, alat);
  float n = large * 0.62 + mid * 0.38;
  // (centred below the threshold with a wide spread: broad clear skies and broad cloud, little
  // of the field left hovering at the edge, where it would read as a grey veil from afar)
  float pot = 0.45 + (n - 0.5) * 1.75 + 0.05 * (fine - 0.5);
  pot += 0.1 * storm + 0.07 * polar - 0.3 * subtrop - 0.04 * trades;
  // ITCZ: bright complexes, fair-weather cumulus between them
  pot = mix(pot, mix(0.405 + 0.1 * (fine - 0.5), 0.8, mcs) + 0.1 * (n - 0.5), itcz * 0.9);
  // trade cumulus: patchy fields that reach the threshold in clusters (a soft grey texture
  // from afar, discrete puffs close up) with clear sea between, thinned under the highs
  float tradeP = 0.39 + 0.18 * (mid - 0.5) + 0.1 * smoothstep(0.55, 0.8, fine);
  pot = mix(pot, tradeP, trades * (1.0 - itcz) * 0.8);
  // storm tracks: long frontal bands
  float frontN = pow(max(1.0 - abs(sfbm(p * vec3(2.2, 6.0, 2.2) + seed * 1.7, 4)), 0.0), 4.0) * storm;
  pot += frontN * 0.18;
  pot += comma * 0.32 - dry * 0.25 - calm * 0.12;
  // the cold air behind the fronts: open cells at the threshold
  pot = mix(pot, 0.52 + 0.06 * (mid - 0.5), coldAir * 0.7);
  // marine stratocumulus sheets over the cold eastern boundary currents
  float deck = 0.0;
  for (int i = 0; i < 5; i++) deck = max(deck, uSc[i].w * exp(-pow(length((vec2(lat, lon) - uSc[i].xy) / uSc[i].z), 2.0)));
  deck *= 1.0 - itcz;
  // (its outline ragged at every scale, not the oval of the climatology)
  deck = clamp(deck + (1.1 * (large - 0.5) + 0.7 * (mid - 0.5) + 0.2 * (fine - 0.5)) * smoothstep(0.02, 0.2, deck), 0.0, 1.0);
  float sheetP = 0.6 + 0.06 * (large - 0.5) + 0.05 * (mid - 0.5);
  // the sheet frays at its western and equatorward edge into open cells
  float core = smoothstep(0.35, 0.7, deck);
  pot = mix(pot, mix(0.5 + 0.05 * (fine - 0.5), sheetP, core), smoothstep(0.12, 0.3, deck) * 0.92);
  // tropical cyclones override the field
  // (only where there is one: a floor everywhere would lift every clear sky toward the edge)
  pot = max(pot, mix(pot, 0.41 + 0.45 * trop, smoothstep(0.0, 0.12, trop)));
  pot -= eye * 0.6;
  // the eddies in the lee of the islands (only where there is a deck to show them)
  pot += vortexStreets(d) * smoothstep(0.1, 0.35, deck);
  P = pot;
  // regime
  S = clamp(max(max(core * smoothstep(0.08, 0.35, deck), frontS * 0.9), max(polar * 0.7, frontN * 0.6 + storm * 0.25)), 0.0, 1.0);
  S *= 1.0 - 0.8 * itcz * mcs;
  S = max(S, tcS);                                                          // the overcast and its bands are sheets
  // (open cells in a belt along the sheet's frayed edge, not over the whole fringe)
  O = clamp(max(coldAir, (1.0 - core) * smoothstep(0.12, 0.24, deck) * (1.0 - smoothstep(0.3, 0.55, deck)) * 0.45) * (1.0 - frontS), 0.0, 1.0);
  // --- cirrus: streaks along the jets, anvils over the convection, frontal shields, canopies ---
  float ci = sfbm(vec3(p.x * 5.0, p.y * 42.0, p.z * 5.0) + vec3(sfbm(p * 6.0, 3) * 2.0), 5) * 0.5 + 0.5;
  float jet = exp(-pow((alat - 0.62) / 0.2, 2.0)) + 0.15 * exp(-pow((lat - 0.1) / 0.17, 2.0));
  float anvil = itcz * smoothstep(0.45, 0.72, mcsN) * (0.75 + 0.25 * ci);
  CI = max(max(smoothstep(0.56, 0.86, ci) * jet * 0.7, anvil), max(shieldC * (0.45 + 0.55 * ci), canopy));
  CI *= 1.0 - eye;
}

void main() {
  vec3 d = faceDir(vUv);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float lon = atan(-d.z, d.x);
  float latD = lat / PI * 180.0, lonD = lon / PI * 180.0, alat = abs(latD);
  vec2 muv = vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
  float m0 = maskAt(muv, 0.0);
  float mc = maskAt(muv, 4.0);
  float mC = maskAt(muv, 6.5);
  if (latD < -85.0) { m0 = 1.0; mc = 1.0; mC = 1.0; }

  if (uOut == 2) {
    float P, S, O, CI;
    cloudPotential(d, 0.0, P, S, O, CI);
    gl_FragColor = vec4(P, S, O, CI);
    return;
  }

  // --- coastline with fractal detail ---
  float coastBand = 1.0 - abs(2.0 * m0 - 1.0);
  float nearCoast = 1.0 - abs(2.0 * mc - 1.0);
  float nC = sfbm(d * 160.0, 5);
  float s = (m0 - 0.5) + 0.3 * nC * clamp(coastBand * 1.2 + nearCoast * 0.35, 0.0, 1.0);
  float land = step(0.0, s);

  // --- deserts / aridity ---
  float n1 = sfbm(d * 7.0 + 4.0, 5);
  float n2 = sfbm(d * 36.0 + 11.0, 4);
  // desert basins with warped, soft margins (no box edges): the dry heart, a steppe and
  // savanna fringe, broken by highlands and the green belts people planted
  float latW = latD + 4.5 * sfbm(d * 3.3 + 21.0, 4), lonW = lonD + 6.5 * sfbm(d * 3.3 + 37.0, 4);
  float region = 0.0;
  for (int i = 0; i < 10; i++) {
    vec4 b = uDeserts[i];
    region = max(region, boxMask(latW, lonW, b, 9.0) * (0.6 + 0.4 * b.w));
  }
  // the dry core follows the subtropical high and the distance from the sea, not the box
  float band = exp(-pow(abs(abs(latW) - 24.0) / 10.5, 2.0));
  float inland = smoothstep(0.45, 0.92, mC + 0.12 * sfbm(d * 9.0, 3));
  float desert = clamp(region * (0.2 + 0.8 * band) * inland * 1.25, 0.0, 1.0);
  float subtrop = exp(-pow(abs(alat - 24.0) / 8.0, 2.0)) * smoothstep(0.5, 0.95, mC);
  float arid = clamp(max(desert * (0.75 + 0.35 * n1), subtrop * 0.55) + n2 * 0.12, 0.0, 1.0);
  arid *= smoothstep(0.1, 0.6, mc + 0.2);

  if (uOut == 3) {
    // ---- night lights of the Terran Concord (linear, half float): r warm (old cores, towns,
    // roads), g cool (new districts, stations), b transit (maglev lines, rail) ----
    float wild = 0.0;
    for (int i = 0; i < 10; i++) wild = max(wild, boxMask(latD, lonD, uWild[i], 3.0));
    float landS = smoothstep(-0.04, 0.06, s);
    float habit = land * (1.0 - arid * 0.93) * (1.0 - smoothstep(58.0, 68.0, alat)) * (1.0 - step(latD, -50.0)) * (1.0 - 0.96 * wild);
    float coastNear = smoothstep(0.98, 0.55, mc);                 // within ~a hundred km of the sea
    float c50 = maskAt(muv, 1.6);
    float coastStrip = (1.0 - abs(2.0 * c50 - 1.0)) * step(0.0, s);  // within ~50 km of the coast, on land
    float warm = 0.0, cool = 0.0, net = 0.0;
    float grain = sfbm(d * 210.0 + 3.0, 3) * 0.5 + 0.5;
    float arter = pow(max(sridged(d * 140.0 + 11.0, 3), 0.0), 3.0);
    float nearMetro = 0.0;
    // metros from the atlas: a small bright old core inside a wide, irregular built-up
    // footprint of lit districts, dark parks and water between them, on the land (the
    // harbours and sea-steads off its waterfront a little dimmer)
    for (int i = 0; i < 160; i++) {
      if (i >= uNumCity) break;
      vec4 c = texelFetch(uData, ivec2(i, 2), 0);
      vec3 dv = d - c.xyz;
      float dk2 = dot(dv, dv) * 40589641.0;                         // km^2
      float w = c.w;
      float rc = 3.0 + 4.0 * w, rm = 12.0 + 26.0 * w;
      if (dk2 > rm * rm * 30.0) continue;
      nearMetro = max(nearMetro, w * exp(-dk2 / (rm * rm * 16.0)));
      float dk = sqrt(dk2);
      float core = exp(-dk2 / (rc * rc));
      float modern = fract(sin(float(i) * 12.9898) * 43758.5453);
      // the built-up fabric thins outward from the old core, reaching further along the
      // corridors that radiate from it; parks and water break it up
      vec3 ce = normalize(cross(vec3(0.0, 1.0, 0.0), c.xyz));
      vec3 cn = cross(c.xyz, ce);
      float ang = atan(dot(dv, cn), dot(dv, ce));
      float nArms = 5.0 + floor(modern * 4.0);
      float arms = pow(0.5 + 0.5 * cos(ang * nArms + 2.2 * sfbm(d * 30.0 + float(i) * 1.3, 2) + modern * 6.28), 6.0);
      float edgeN = sfbm(d * 330.0 + float(i) * 1.7, 3) + 0.5 * sfbm(d * 90.0 + float(i) * 3.1, 2);
      float dens = exp(-dk / rm) + 0.45 * arms * exp(-dk / (rm * 2.4));
      float urban = smoothstep(0.12, 0.45, dens + 0.16 * edgeN + 0.1 * arter);
      float lit = urban * (0.3 + 0.7 * grain) * (0.55 + 0.45 * arter) * (0.4 + 0.6 * min(dens * 1.6, 1.0));
      float onLand = mix(0.1, 1.0, landS);
      warm += w * (core * 0.12 + lit * 0.11 * (1.0 - 0.45 * modern)) * onLand;
      cool += w * (lit * (0.02 + 0.1 * modern) + core * 0.05 * modern) * onLand;
      // the harbour: container terminals and quays strung along the waterfront, their floodlit
      // berths in dashes (sodium-warm and LED-white), within ~30 km of the old core
      float hb = coastStrip * exp(-dk / (18.0 + 14.0 * w)) * smoothstep(3.0, 7.0, dk);
      float dash = 0.35 + 0.65 * smoothstep(0.35, 0.8, sfbm(d * 900.0 + float(i) * 2.9, 2) * 0.5 + 0.5);
      warm += w * hb * dash * 0.22;
      cool += w * hb * dash * 0.16 * (0.4 + modern);
      // ships at anchor in the roads off the port: a scatter of lights over the water
      float roads = (1.0 - landS) * exp(-pow(max(dk - 22.0 - 10.0 * w, 0.0) / 14.0, 2.0)) * smoothstep(6.0, 14.0, dk) * (1.0 - smoothstep(0.98, 1.0, mc));
      if (roads > 0.01) {
        vec3 aq = d * 2400.0;
        vec3 ac = floor(aq);
        vec3 ah = hash33(ac + float(i));
        float ship = step(0.78, ah.x) * exp(-dot(aq - ac - 0.5, aq - ac - 0.5) / 0.08);
        warm += w * roads * ship * 0.5;
        cool += w * roads * ship * 0.25;
      }
    }
    // towns everywhere people live (a jittered lattice ~60 km apart, denser round the metros
    // and along the coasts and river valleys), joined by a lit web of roads and local rail
    float valley = pow(max(sridged(d * 16.0 + 5.0, 3), 0.0), 5.0);     // river valleys inland
    // where people live: settled coasts, river plains and the metros' hinterlands, with wide
    // dark country between them (the interiors given back to forest, steppe and marsh)
    float popN = sfbm(d * 5.5 + 13.0, 4) * 0.5 + 0.5;
    float region = smoothstep(0.5, 0.72, popN + 0.28 * coastNear + 0.5 * nearMetro + 0.2 * valley - 0.12 * (1.0 - mc));
    float place = habit * region * clamp(max(coastNear * 0.9, valley * 0.85) + 0.15 + nearMetro * 0.8, 0.0, 1.0);
    {
      const float QS = 105.0;
      vec3 q = d * QS;
      vec3 cq = floor(q);
      float towns = 0.0, tcool = 0.0, road = 0.0;
      float rw = max(0.012, uTexelKm * 0.6 / (6371.0 / QS));        // road half-width, cells
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
        vec3 cell = cq + vec3(float(x), float(y), float(z));
        vec3 h = hash33(cell * 1.013 + 0.37);
        vec3 pt = normalize(cell + 0.2 + 0.6 * h) * QS;
        float r2 = dot(q - pt, q - pt);
        float size = 0.035 + 0.1 * h.x * h.x;
        float t = exp(-r2 / (size * size));
        towns += t * (0.12 + 1.4 * h.y * h.y * h.y);
        tcool += t * h.z;
        // roads to the towns in the next cells along each axis (and one diagonal)
        for (int k = 0; k < 4; k++) {
          vec3 dc = k == 0 ? vec3(1.0, 0.0, 0.0) : k == 1 ? vec3(0.0, 1.0, 0.0) : k == 2 ? vec3(0.0, 0.0, 1.0) : (h.y > 0.5 ? vec3(1.0, 1.0, 0.0) : vec3(0.0, 1.0, 1.0));
          vec3 c2 = cell + dc;
          vec3 h2 = hash33(c2 * 1.013 + 0.37);
          if (hash13(cell * 3.1 + dc * 7.3) > 0.82) continue;            // not every pair is joined
          vec3 pt2 = normalize(c2 + 0.2 + 0.6 * h2) * QS;
          vec3 ab = pt2 - pt;
          float tt = clamp(dot(q - pt, ab) / dot(ab, ab), 0.0, 1.0);
          vec3 dq = q - pt - ab * tt;
          float dd = dot(dq, dq);
          if (dd > rw * rw * 16.0) continue;
          // villages strung along the road
          float bq = fract(tt * 3.0 + h.x) - 0.5;
          road = max(road, exp(-dd / (rw * rw)) * (0.45 + 0.55 * exp(-bq * bq * 30.0)));
        }
      }
      // coastal strings: small towns ~20 km apart along every settled shore
      float ctown = 0.0;
      {
        vec3 q2 = d * 320.0;
        vec3 c2 = floor(q2);
        for (int x = 0; x <= 1; x++) for (int y = 0; y <= 1; y++) for (int z = 0; z <= 1; z++) {
          vec3 cell = c2 + vec3(float(x), float(y), float(z));
          vec3 h = hash33(cell + 5.1);
          if (h.z < 0.35) continue;
          vec3 pt = normalize(cell + 0.2 + 0.6 * h) * 320.0;
          ctown += exp(-dot(q2 - pt, q2 - pt) / (0.02 + 0.05 * h.x)) * (0.15 + 1.2 * h.y * h.y);
        }
        // coastal towns come in strings with dark shore between them
        ctown *= smoothstep(0.45, 0.72, sfbm(d * 24.0 + 7.0, 3) * 0.5 + 0.5 + 0.3 * nearMetro);
      }
      float rural = habit * (1.0 - 0.7 * wild) * step(0.35, hash13(floor(d * 18.0) + 3.0) + region);
      warm += towns * place * 0.2 * (1.0 - 0.4 * clamp(tcool, 0.0, 1.0));
      cool += tcool * place * 0.08;
      warm += ctown * coastStrip * habit * (0.3 + 0.7 * region) * 0.18;
      warm += road * rural * region * (0.002 + 0.01 * place);
      net += road * rural * 0.003 * place;
    }
    // sea-steads and floating towns on the continental shelves
    {
      float shelfT = (1.0 - land) * smoothstep(0.35, 0.95, mc + 0.25 * coastBand + n1 * 0.1) * (1.0 - smoothstep(48.0, 60.0, alat));
      vec3 q = d * 38.0;
      vec3 cq = floor(q);
      float sea = 0.0;
      for (int x = 0; x <= 1; x++) for (int y = 0; y <= 1; y++) for (int z = 0; z <= 1; z++) {
        vec3 cell = cq + vec3(float(x), float(y), float(z));
        vec3 h = vec3(fract(sin(dot(cell, vec3(41.3, 289.1, 97.7))) * 43758.5453), fract(sin(dot(cell, vec3(157.9, 23.3, 311.1))) * 43758.5453), fract(sin(dot(cell, vec3(71.1, 131.7, 207.3))) * 43758.5453));
        if (h.z < 0.55) continue;
        float r2 = dot(q - cell - h, q - cell - h);
        sea += exp(-r2 / 0.004) * (0.5 + h.y);
      }
      cool += sea * shelfT * 0.35;
      warm += sea * shelfT * 0.15;
    }
    // fires on the savannas at night: prescribed burns keeping the grasslands open, strings of
    // orange points along the fire fronts, in the dry season (June: the southern tropics)
    {
      float savZone = land * smoothstep(0.08, 0.2, arid) * (1.0 - smoothstep(0.45, 0.6, arid)) * smoothstep(-2.0, -8.0, latD) * (1.0 - smoothstep(-20.0, -26.0, latD));
      if (savZone > 0.0) {
        vec3 fq = d * 420.0;
        vec3 fc = floor(fq);
        vec3 fh = hash33(fc + 61.3);
        float front = step(0.93, fh.x) * exp(-dot(fq - fc - 0.5, fq - fc - 0.5) / 0.06);
        warm += front * savZone * (0.3 + 0.5 * fh.y);
      }
    }
    // settled countryside: a faint even glow, none in the wilds
    warm += habit * place * 0.0015 * (0.4 + 1.2 * grain);
    // maglev corridors between the metros: great-circle filaments, dim where they run under the
    // sea or through the wilds, stations every ~45 km
    for (int i = 0; i < 400; i++) {
      if (i >= uNumArc) break;
      vec4 N = texelFetch(uData, ivec2(i, 3), 0);
      float off = dot(d, N.xyz);
      float wk = max(N.w, uTexelKm * 0.75);
      if (abs(off) * 6371.0 > wk * 4.0) continue;
      vec4 A = texelFetch(uData, ivec2(i, 4), 0);
      vec4 Bq = texelFetch(uData, ivec2(i, 5), 0);
      vec3 pp = d - N.xyz * off;
      if (dot(cross(A.xyz, pp), N.xyz) < 0.0 || dot(cross(pp, Bq.xyz), N.xyz) < 0.0) continue;
      float dk = abs(off) * 6371.0;
      float along = acos(clamp(dot(normalize(pp), A.xyz), -1.0, 1.0)) * 6371.0;
      // stations at uneven intervals, towns of every size, so a line reads as a string of places
      // rather than a dotted rule
      float sa = along / 45.0 + float(i) * 0.37 + 0.35 * sin(along / 131.0 + float(i));
      float bq = fract(sa) - 0.5;
      float beads = 0.3 + 0.7 * exp(-bq * bq * 60.0) * (0.3 + 0.7 * hash11(floor(sa) + float(i) * 17.0));
      net += A.w * 0.2 * beads * beads * exp(-dk * dk / (wk * wk)) * (0.12 + 0.88 * land) * (1.0 - 0.75 * wild) * (N.w / wk);
    }
    // the Halo's ground ports: the brightest cities after Meridian, their avenues radiating from
    // the tether station, built out over the water where the coast is short of room
    for (int i = 0; i < 7; i++) {
      vec3 dv = d - uPorts[i].xyz;
      float dk2 = dot(dv, dv) * 40589641.0;
      if (dk2 > 40000.0) continue;
      float pw = uPorts[i].w;
      float dk = sqrt(dk2);
      vec3 pe = normalize(cross(vec3(0.0, 1.0, 0.0), uPorts[i].xyz));
      vec3 pn = cross(uPorts[i].xyz, pe);
      float ang = atan(dot(dv, pn), dot(dv, pe));
      float av = pow(0.5 + 0.5 * cos(ang * 12.0), 24.0) * exp(-dk / 70.0) * smoothstep(3.0, 8.0, dk);
      float footprint = smoothstep(0.22, 0.4, exp(-dk2 / (46.0 * 46.0)) + 0.22 * sfbm(d * 300.0 + float(i) * 5.3, 3));
      float rings = exp(-pow((dk - 16.0) / 1.5, 2.0)) * 0.6 + exp(-pow((dk - 30.0) / 2.0, 2.0)) * 0.35;
      warm += pw * (exp(-dk2 / 90.0) * 0.9 + footprint * (0.3 + 0.25 * grain) + av * 0.5 + rings * 0.4);
      cool += pw * (exp(-dk2 / 12.0) * 2.5 + footprint * 0.12 + av * 0.2);
      net += pw * exp(-dk2 / 5000.0) * 0.12;
    }
    warm *= 1.0 - 0.85 * wild;
    cool *= 1.0 - 0.85 * wild;
    // the light-fleets on the fishing grounds: clusters of boats under blinding green-white
    // lamps, a few tens of km across, working the shelf edges
    {
      float ground = 0.0;
      for (int i = 0; i < 5; i++) ground = max(ground, boxMask(latD, lonD, uFish[i], 1.5));
      ground *= 1.0 - land;
      if (ground > 0.0) {
        vec3 fq = d * 190.0;                                            // ~34 km cells
        vec3 fc = floor(fq);
        float fleet = 0.0;
        for (int x = 0; x <= 1; x++) for (int y = 0; y <= 1; y++) for (int z = 0; z <= 1; z++) {
          vec3 cell = fc + vec3(float(x), float(y), float(z));
          vec3 h = hash33(cell + 41.7);
          if (h.x < 0.55) continue;
          vec3 o = cell + 0.25 + 0.5 * hash33(cell + 3.3);
          float r2 = dot(fq - o, fq - o);
          // a fleet of boats in a ragged patch, brighter at its heart
          fleet += exp(-r2 / (0.03 + 0.06 * h.y)) * (0.5 + h.z) * (0.6 + 0.4 * sfbm(d * 1400.0 + h * 9.0, 2));
        }
        cool += fleet * ground * 0.9;
        warm += fleet * ground * 0.12;
      }
    }
    // the alpha channel marks the sea lanes for the Earth shader's ships (an exact leg index + 1)
    gl_FragColor = vec4(min(warm, 8.0), min(cool, 8.0), min(net, 8.0), nearestLane(d));
    return;
  }

  if (uOut == 1) {
    // r: mineral dust optical depth (x 1/1.2). The Saharan Air Layer rolls off West Africa and
    // across the Atlantic toward the Caribbean in billowing fronts; Arabian and Thar dust over
    // the Arabian Sea; the Taklamakan and Gobi's out over the Yellow Sea; a haze over every
    // desert heart. Domain-warped, so the plumes' edges curl.
    vec3 dw = vec3(sfbm(d * 9.0 + 71.0, 3), sfbm(d * 9.0 + 83.0, 3), sfbm(d * 9.0 + 97.0, 3));
    float billow = sfbm(d * 26.0 + dw * 1.8, 4) * 0.5 + 0.5;
    float dust = desert * 0.35;
    {
      // Sahara to the Caribbean: the plume leaves the coast near 15 - 20 N and drifts west, rising
      // and thinning, bending north a little with the subtropical high
      float t = clamp((-12.0 - lonD) / 55.0, 0.0, 1.0);
      float inl = smoothstep(-16.0, -8.0, lonD) * (1.0 - smoothstep(20.0, 30.0, lonD));
      float lc = mix(16.0, 21.0, t) + 5.0 * sfbm(d * 4.0 + 3.0, 3);
      float zs = (latD - lc) / mix(7.0, 9.0, t);
      float sahara = exp(-zs * zs) * (step(lonD, -12.0) * exp(-t * 1.6) * smoothstep(-75.0, -60.0, lonD) + inl * 0.8);
      float za = (latD - 18.0) / 7.0;
      float arabian = exp(-za * za) * smoothstep(50.0, 58.0, lonD) * (1.0 - smoothstep(66.0, 75.0, lonD)) * 0.7;
      float zg = (latD - 38.0) / 5.0;
      float gobi = exp(-zg * zg) * smoothstep(100.0, 112.0, lonD) * (1.0 - smoothstep(128.0, 140.0, lonD)) * 0.45;
      dust = max(dust, (sahara + arabian + gobi) * smoothstep(0.3, 0.75, billow + 0.1));
    }
    float ice = 0.0;
    if (latD < -62.0) ice = land;
    if (latD > 59.0 && lonD > -74.0 && lonD < -12.0) ice = land * smoothstep(0.35, 0.8, mc);
    ice = max(ice, (1.0 - land) * smoothstep(77.0, 82.0, latD + n2 * 6.0));
    ice = max(ice, (1.0 - land) * smoothstep(-68.0, -71.0, latD + n2 * 4.0));
    float shelf = (1.0 - land) * smoothstep(0.35, 0.95, mc + 0.25 * coastBand + n1 * 0.1);
    gl_FragColor = vec4(clamp(dust, 0.0, 1.0), ice, arid, shelf);
    return;
  }

  // --- relief ---
  float mount = 0.0;
  for (int i = 0; i < 200; i++) {
    if (i >= uNumSeg) break;
    vec4 a = texelFetch(uData, ivec2(i, 0), 0);
    vec4 b = texelFetch(uData, ivec2(i, 1), 0);
    vec3 ab = b.xyz - a.xyz;
    float t = clamp(dot(d - a.xyz, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
    vec3 dv = d - a.xyz - ab * t;
    mount = max(mount, b.w * exp(-dot(dv, dv) / (a.w * a.w)));
  }
  float rid = sridged(d * 55.0 + 1.3, 7);
  float hills = sfbm(d * 24.0 + 9.0, 5) * 0.5 + 0.5;
  float hland = 0.015 + 0.05 * mc + mount * (0.28 + 0.72 * rid) * 0.9 + 0.06 * hills * hills + 0.05 * rid * smoothstep(0.4, 0.9, hills);
  float depth = 0.08 + 0.55 * smoothstep(0.0, 0.55, 1.0 - mc) + 0.12 * (sfbm(d * 12.0, 4) * 0.5 + 0.5);
  depth -= 0.1 * pow(max(1.0 - abs(sfbm(d * vec3(3.0, 5.0, 3.0) + 2.0, 4)), 0.0), 8.0); // mid-ocean ridges
  float H = s * 0.25 + (land > 0.5 ? hland : -depth);

  // --- biomes (linear albedo) ---
  vec3 rain = vec3(0.03, 0.068, 0.024);
  vec3 temperate = vec3(0.06, 0.095, 0.04);
  vec3 borealC = vec3(0.036, 0.058, 0.032);
  vec3 savanna = vec3(0.15, 0.135, 0.065);
  vec3 steppe = vec3(0.2, 0.18, 0.11);
  vec3 sand = vec3(0.47, 0.36, 0.21);
  vec3 redsand = vec3(0.46, 0.25, 0.12);
  vec3 tundraC = vec3(0.15, 0.14, 0.115);
  vec3 rock = vec3(0.2, 0.18, 0.155);
  float wet = exp(-pow(abs(latD) / 11.0, 2.0)) * (1.0 - arid);
  float boreal = smoothstep(47.0, 55.0, alat) * (1.0 - smoothstep(63.0, 69.0, alat));
  float tundra = smoothstep(62.0, 70.0, alat);
  vec3 c = mix(temperate, rain, wet);
  c = mix(c, borealC, boreal);
  c = mix(c, tundraC, tundra);
  float sav = smoothstep(0.08, 0.45, arid) * (1.0 - tundra);
  c = mix(c, mix(savanna, steppe, smoothstep(30.0, 42.0, alat)), sav);
  float dune = smoothstep(0.45, 0.8, arid);
  vec3 dsand = mix(sand, redsand, smoothstep(0.2, 0.7, sfbm(d * 5.0 + 17.0, 3) + (lonD > 110.0 && latD < -10.0 ? 0.6 : 0.0)));
  dsand *= 0.8 + 0.35 * (sfbm(d * 60.0, 4) * 0.5 + 0.5);
  // hamada and massifs: dark rock plateaus between the sand seas
  dsand = mix(dsand, vec3(0.22, 0.16, 0.11), smoothstep(0.56, 0.74, sfbm(d * 13.0 + 3.0, 4) * 0.5 + 0.5) * 0.75);
  c = mix(c, dsand, dune);
  // the desert works: solar fields (dark, blue-grey rectangles) and centre-pivot irrigation
  // (clusters of green discs) scattered through the dry country, ~20 km cells, a few per cent lit
  if (dune > 0.3) {
    vec3 wq = d * 300.0;
    vec3 wc = floor(wq);
    vec3 wh = hash33(wc + 13.7);
    vec3 wf = wq - wc - 0.5;
    if (wh.x > 0.965) {
      // a solar field: a rectangle of panels in a sub-rectangle of the cell
      vec2 half = vec2(0.12 + 0.2 * wh.y, 0.08 + 0.12 * wh.z);
      vec2 qq = abs(vec2(wf.x + wf.z, wf.y)) - half;
      float fld = 1.0 - smoothstep(-0.02, 0.02, max(qq.x, qq.y));
      c = mix(c, vec3(0.055, 0.065, 0.085), fld * dune);
    } else if (wh.x > 0.93) {
      // irrigation: green pivots on the gravel plain
      float piv = smoothstep(0.55, 0.8, sfbm(d * 2400.0 + wh * 7.0, 2) * 0.5 + 0.5) * (1.0 - smoothstep(0.25, 0.45, length(wf)));
      c = mix(c, vec3(0.05, 0.09, 0.03), piv * dune);
    }
  }
  c *= 0.78 + 0.44 * (n2 * 0.5 + 0.5);
  // farmland: the settled plains as a county-scale patchwork of crops, fallow and woodlots
  // (greener in the wet, straw and ochre toward the steppe), none in the deserts or the far north
  {
    float farm = land * (1.0 - smoothstep(0.35, 0.7, arid)) * (1.0 - smoothstep(52.0, 60.0, alat)) * (1.0 - wet * 0.8) * smoothstep(0.45, 0.62, sfbm(d * 6.0 + 29.0, 3) * 0.5 + 0.5 + 0.15 * (1.0 - mc));
    if (farm > 0.0) {
      vec3 fq = d * 520.0;                                   // ~12 km parcels (districts of fields)
      vec3 fh = hash33(floor(fq + 0.35 * vec3(sfbm(d * 90.0, 2))));
      vec3 crop = fh.x < 0.4 ? vec3(0.07, 0.11, 0.035) : fh.x < 0.7 ? vec3(0.16, 0.14, 0.07) : fh.x < 0.88 ? vec3(0.11, 0.1, 0.06) : vec3(0.045, 0.07, 0.03);
      crop *= 0.85 + 0.3 * fh.y;
      c = mix(c, mix(crop, c, 0.35), farm * 0.75);
    }
  }
  // the built-up land of the metros by day: grey-ochre fabric with green parks and dark water
  // between, densest round the old cores
  {
    float urban = 0.0;
    for (int i = 0; i < 160; i++) {
      if (i >= uNumCity) break;
      vec4 cc = texelFetch(uData, ivec2(i, 2), 0);
      vec3 dv = d - cc.xyz;
      float dk2 = dot(dv, dv) * 40589641.0;
      float rm = 10.0 + 22.0 * cc.w;
      if (dk2 > rm * rm * 9.0) continue;
      float dk = sqrt(dk2);
      urban = max(urban, smoothstep(0.2, 0.55, exp(-dk / rm) + 0.18 * sfbm(d * 330.0 + float(i) * 1.7, 3)) * cc.w);
    }
    vec3 urbC = mix(vec3(0.13, 0.12, 0.105), vec3(0.19, 0.175, 0.15), n2 * 0.5 + 0.5);
    urbC = mix(urbC, vec3(0.05, 0.07, 0.035), smoothstep(0.55, 0.8, sfbm(d * 700.0 + 3.0, 2) * 0.5 + 0.5) * 0.6);
    c = mix(c, urbC, clamp(urban, 0.0, 1.0) * land * 0.85);
  }
  // mountains: bare rock and snow above a latitude-dependent snowline
  c = mix(c, rock * (0.8 + 0.4 * rid), smoothstep(0.18, 0.45, mount * rid));
  float snowline = mix(0.62, 0.12, smoothstep(0.0, 65.0, alat));
  float snow = smoothstep(snowline, snowline + 0.08, hland + 0.05 * n2) ;
  // ice sheets
  float ice = 0.0;
  if (latD < -62.0) ice = 1.0;
  if (latD > 59.0 && lonD > -74.0 && lonD < -12.0) ice = smoothstep(0.35, 0.8, mc);
  vec3 iceC = vec3(0.78, 0.82, 0.88) * (0.92 + 0.08 * n2);
  c = mix(c, iceC, max(snow, ice));
  // ocean
  // shelf seas: turquoise over the tropical sand banks and reef lagoons, green and silty on
  // the temperate shelves with plankton swirls, deep blue beyond the break
  float shelf = smoothstep(0.35, 0.95, mc + 0.25 * coastBand + n1 * 0.1);
  float tropic = 1.0 - smoothstep(22.0, 34.0, alat);
  float bank = smoothstep(0.52, 0.9, maskAt(muv, 2.0) + 0.3 * coastBand + 0.12 * n2) * (1.0 - land);
  float swirl = sfbm(d * 44.0 + vec3(sfbm(d * 11.0 + 5.0, 3) * 2.2), 4) * 0.5 + 0.5;
  vec3 shelfC = mix(vec3(0.009, 0.038, 0.044), vec3(0.012, 0.062, 0.07), tropic);
  shelfC = mix(shelfC, vec3(0.02, 0.062, 0.046), (1.0 - tropic) * smoothstep(0.52, 0.8, swirl) * 0.7);
  vec3 bankC = mix(vec3(0.018, 0.06, 0.05), vec3(0.05, 0.2, 0.18), tropic) * (0.8 + 0.4 * smoothstep(0.3, 0.7, n2 * 0.5 + 0.5));
  vec3 ocean = mix(vec3(0.004, 0.011, 0.028), shelfC, shelf);
  ocean = mix(ocean, bankC, bank * (0.35 + 0.65 * tropic) * smoothstep(0.3, 0.6, n1 * 0.5 + 0.5 + 0.25 * tropic));
  // plankton blooms: milky turquoise (coccolithophores) and green (diatoms) swirling through the
  // eddies of the high-latitude seas and the upwelling off the western coasts
  {
    vec3 bw = vec3(sfbm(d * 18.0 + 3.0, 3), sfbm(d * 18.0 + 9.0, 3), sfbm(d * 18.0 + 15.0, 3));
    float eddy = sfbm(d * 70.0 + bw * 2.4, 4) * 0.5 + 0.5;
    float zl = (alat - 55.0) / 9.0;
    float hiLat = exp(-zl * zl);
    float upwell = 0.0;
    for (int i = 0; i < 5; i++) upwell = max(upwell, exp(-pow(length((vec2(lat, lon) - uSc[i].xy) / (uSc[i].z * 0.7)), 2.0)));
    float bloomZone = (hiLat * 0.9 + upwell * 0.8) * smoothstep(0.45, 0.7, sfbm(d * 8.0 + 51.0, 3) * 0.5 + 0.5 + 0.2 * shelf);
    float bloom = bloomZone * smoothstep(0.45, 0.75, eddy);
    vec3 bloomC = mix(vec3(0.012, 0.05, 0.035), vec3(0.04, 0.12, 0.12), smoothstep(0.6, 0.9, eddy) * hiLat);
    ocean = mix(ocean, bloomC, clamp(bloom, 0.0, 1.0) * (1.0 - land) * 0.85);
  }
  // river plumes: the sediment of the great rivers fanning out over the shelf, ochre near the
  // mouth, green-brown at its swirling edge
  {
    float plume = 0.0;
    for (int i = 0; i < ${RIVERS.length}; i++) {
      vec3 dv = d - uRivers[i].xyz;
      float dk = length(dv) * 6371.0;
      float L = 60.0 + 260.0 * uRivers[i].w;
      if (dk > L * 3.0) continue;
      float edge = sfbm(d * 160.0 + float(i) * 4.1, 3);
      plume = max(plume, smoothstep(0.15, 0.55, exp(-dk / L) + 0.2 * edge) * uRivers[i].w);
    }
    vec3 silt = mix(vec3(0.03, 0.05, 0.035), vec3(0.1, 0.075, 0.04), smoothstep(0.3, 0.8, plume));
    ocean = mix(ocean, silt, clamp(plume * 1.3, 0.0, 1.0) * (1.0 - land) * (0.6 + 0.4 * shelf));
  }
  // icebergs: tabular bergs calved from the Antarctic shelves drifting in the Southern Ocean,
  // and the Greenland bergs down Baffin Bay: white specks over the dark sea
  {
    float bergZone = smoothstep(-52.0, -58.0, latD) * (1.0 - smoothstep(-66.0, -70.0, latD))
                   + boxMask(latD, lonD, vec4(60.0, 75.0, -70.0, -48.0), 2.0) * 0.8;
    if (bergZone > 0.0) {
      vec3 iq = d * 900.0;
      vec3 ic = floor(iq);
      vec3 ih = hash33(ic + 29.3);
      float berg = step(0.975, ih.x) * (1.0 - smoothstep(0.1 + 0.2 * ih.y, 0.2 + 0.25 * ih.y, length(iq - ic - 0.5 - 0.3 * (ih - 0.5))));
      ocean = mix(ocean, vec3(0.62, 0.68, 0.74), berg * bergZone * (1.0 - land));
    }
  }
  float seaIce = smoothstep(77.0, 82.0, latD + n2 * 6.0) + smoothstep(-68.0, -71.0, latD + n2 * 4.0);
  ocean = mix(ocean, vec3(0.7, 0.75, 0.8) * (0.85 + 0.15 * n2), clamp(seaIce, 0.0, 1.0));
  vec3 alb = land > 0.5 ? c : ocean;
  gl_FragColor = vec4(sqrt(clamp(alb, 0.0, 1.0)), clamp(0.5 + 0.5 * H, 0.0, 1.0));
}
`;

function loadMask() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = reject;
    img.src = LAND_MASK_PNG;
  });
}

// Start decoding immediately so the mask is ready long before anyone ascends.
export const maskPromise = loadMask();
let maskTex = null;
maskPromise.then((t) => { maskTex = t; }).catch(() => { maskTex = null; });
export function maskReady() { return !!maskTex; }

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * Maglev corridors: each metro joins its nearest neighbours (great-circle arcs, a few
 * thousand km at most), so the network follows the settled coasts and river plains.
 */
function buildArcs() {
  const pts = CITIES.map(([lat, lon, w]) => ({ v: bodyDir(lat * D2R, lon * D2R, new THREE.Vector3()), w }));
  const pairs = new Set();
  const arcs = [];
  pts.forEach((p, i) => {
    if (p.w < 0.3) return;
    const near = pts.map((q, j) => ({ j, d: Math.acos(Math.min(1, p.v.dot(q.v))) * 6371 }))
      .filter((o) => o.j !== i && pts[o.j].w >= 0.3 && o.d < 2600 && o.d > 60)
      .sort((a, b) => a.d - b.d).slice(0, p.w > 0.75 ? 4 : 3);
    for (const o of near) {
      const key = i < o.j ? `${i}-${o.j}` : `${o.j}-${i}`;
      if (pairs.has(key)) continue;
      pairs.add(key);
      const q = pts[o.j];
      const n = new THREE.Vector3().crossVectors(p.v, q.v).normalize();
      const s = 0.18 + 0.32 * Math.min(p.w, q.w);
      arcs.push({ a: p.v.clone(), b: q.v.clone(), n, w: 5.5, s });
    }
  });
  return arcs.slice(0, 400);
}

function buildDataTexture() {
  const segs = [];
  for (const r of RANGES) {
    for (let i = 0; i < r.pts.length - 1; i++) segs.push([r.pts[i], r.pts[i + 1], r.w, r.h]);
  }
  const arcs = buildArcs();
  const W = Math.max(segs.length, CITIES.length + 2, arcs.length, 8);
  const ROWS = 6;
  const data = new Float32Array(W * ROWS * 4);
  const v = new THREE.Vector3();
  segs.forEach(([a, b, w, h], i) => {
    bodyDir(a[0] * D2R, a[1] * D2R, v); data.set([v.x, v.y, v.z, w * D2R], i * 4);
    bodyDir(b[0] * D2R, b[1] * D2R, v); data.set([v.x, v.y, v.z, h], (W + i) * 4);
  });
  const cities = CITIES.slice();
  cities.forEach(([lat, lon, w], i) => {
    bodyDir(lat * D2R, lon * D2R, v); data.set([v.x, v.y, v.z, w], (2 * W + i) * 4);
  });
  arcs.forEach((a, i) => {
    data.set([a.n.x, a.n.y, a.n.z, a.w], (3 * W + i) * 4);
    data.set([a.a.x, a.a.y, a.a.z, a.s], (4 * W + i) * 4);
    data.set([a.b.x, a.b.y, a.b.z, 0], (5 * W + i) * 4);
  });
  const tex = new THREE.DataTexture(data, W, ROWS, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { tex, numSeg: segs.length, numCity: cities.length, numArc: arcs.length };
}

function cyclones() {
  const rnd = mulberry(1977);
  const out = [];
  const v = new THREE.Vector3();
  const add = (lat, lon, R, s) => { bodyDir(lat * D2R, lon * D2R, v).multiplyScalar(R); out.push(new THREE.Vector4(v.x, v.y, v.z, s)); };
  // mid-latitude lows (counter-clockwise in the north, clockwise in the south)
  for (let i = 0; i < 18; i++) {
    const south = i % 2 === 1;
    const lat = (38 + rnd() * 24) * (south ? -1 : 1);
    add(lat, rnd() * 360 - 180, 0.1 + rnd() * 0.12, (south ? -1 : 1) * (1.1 + rnd() * 1.2));
  }
  // tropical cyclones (tight, strong)
  add(16, -128, 0.055, 9.5);
  add(19, 134, 0.06, 10.5);
  add(-14, 64, 0.05, -9.0);
  add(27, 150, 0.05, 8.5);
  // subtropical highs (anticyclones spread cloud into rings)
  for (let i = 0; i < 6; i++) {
    const south = i % 2 === 1;
    add((24 + rnd() * 10) * (south ? -1 : 1), rnd() * 360 - 180, 0.2 + rnd() * 0.1, (south ? 1 : -1) * 1.2);
  }
  return out;
}

const LANES = buildLaneTexture();

export class EarthBake {
  constructor(renderer, size, cloudSize) {
    this.renderer = renderer;
    const mk = (s) => {
      const rt = new THREE.WebGLCubeRenderTarget(s, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      rt.texture.colorSpace = THREE.NoColorSpace;
      return rt;
    };
    this.surfA = mk(size);
    this.surfB = mk(size);
    // weather: half floats, so the thresholds the Earth shader draws its cloud edges at never
    // show 8-bit contour steps
    this.clouds = new THREE.WebGLCubeRenderTarget(cloudSize, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.clouds.texture.colorSpace = THREE.NoColorSpace;
    // night lights: linear half floats, so mip levels average true light, not its square root
    this.lights = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.lights.texture.colorSpace = THREE.NoColorSpace;
    this.data = buildDataTexture();
    const cyc = cyclones();
    while (cyc.length < 28) cyc.push(new THREE.Vector4(0, 1, 0, 0));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: BAKE_FRAG,
      uniforms: {
        uMask: { value: null },
        uData: { value: this.data.tex },
        uNumSeg: { value: this.data.numSeg },
        uNumCity: { value: this.data.numCity },
        uFace: { value: 0 },
        uOut: { value: 0 },
        uDeserts: { value: DESERTS.map((b) => new THREE.Vector4(b[0], b[1], b[2], b[3])) },
        uCyc: { value: cyc },
        uNumCyc: { value: 28 },
        uNumArc: { value: this.data.numArc },
        uPorts: { value: HALO_PORTS.map((p) => { const v = bodyDir(0, p.lon * D2R, new THREE.Vector3()); return new THREE.Vector4(v.x, v.y, v.z, p.name === 'Meridian' ? 0 : 1); }) },
        uWild: { value: WILDS.map((b) => new THREE.Vector4(b[0], b[1], b[2], b[3])) },
        // stratocumulus decks: lat, lon (rad), extent (rad), strength: California, Peru, Namibia, Canaries, Western Australia
        uSc: { value: [[27, -128, 11, 1], [-17, -85, 13, 1], [-17, 5, 11, 0.9], [22, -24, 8, 0.7], [-27, 103, 9, 0.7]].map(([la, lo, e, w]) => new THREE.Vector4(la * D2R, lo * D2R, e * D2R, w)) },
        uTexelKm: { value: (Math.PI / 2 / size) * 6371 },
        uRivers: { value: RIVERS.map(([la, lo, w]) => { const v = bodyDir(la * D2R, lo * D2R, new THREE.Vector3()); return new THREE.Vector4(v.x, v.y, v.z, w); }) },
        uIsles: { value: VORTEX_ISLES.map(([la, lo, r]) => { const v = bodyDir(la * D2R, lo * D2R, new THREE.Vector3()); return new THREE.Vector4(v.x, v.y, v.z, r); }) },
        uFish: { value: FISHING.map((b) => new THREE.Vector4(b[0], b[1], b[2], b[3])) },
        uLanes: { value: LANES.tex },
        uNumLane: { value: LANES.count },
      },
      depthTest: false, depthWrite: false,
    });
    this.pass = new FullscreenPass(this.mat);
    this.jobs = [];
    for (const [out, rt] of [[0, this.surfA], [1, this.surfB], [2, this.clouds], [3, this.lights]]) for (let f = 0; f < 6; f++) this.jobs.push({ out, rt, f });
    this.done = false;
  }

  get ready() { return this.done; }

  /** Run up to `n` face renders (call once per frame while ascending). Returns true when finished. */
  step(n = 1) {
    if (this.done) return true;
    if (!maskTex) return false;
    this.mat.uniforms.uMask.value = maskTex;
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
    if (!this.jobs.length) {
      this.done = true;
      this.data.tex.dispose();
    }
    return this.done;
  }

  dispose() { this.surfA.dispose(); this.surfB.dispose(); this.clouds.dispose(); this.lights.dispose(); this.mat.dispose(); }
}
