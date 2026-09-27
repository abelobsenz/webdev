import * as THREE from 'three';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';
import { SNOISE_GLSL } from './glsl.js';
import { LAND_MASK_PNG } from './landmask.js';
import { CITIES, RANGES, DESERTS, HALO_PORTS, WILDS } from './earthData.js';
import { bodyDir } from './sim.js';

// GPU bake of the planet's surface and weather into cube maps (body frame).
//   surfA: rgb = sqrt(albedo), a = height (0.5 = sea level)
//   surfB: r = night-light density, g = ice, b = aridity, a = shallow shelf
//   clouds: r, g = two weather "potential" fields (cross-faded while they drift),
//           b = static coverage bias, a = cirrus streaks

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
uniform float uTexelKm;
varying vec2 vUv;
${SNOISE_GLSL}
#define PI 3.14159265359

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

float cloudPotential(vec3 d, float seed, out float hurricane) {
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float alat = abs(lat);
  vec3 p = d;
  hurricane = 0.0;
  for (int i = 0; i < 28; i++) {
    if (i >= uNumCyc) break;
    vec4 c = uCyc[i];
    float R = length(c.xyz);
    vec3 cd = c.xyz / R;
    float r = length(p - cd);
    float fall = exp(-r * r / (R * R));
    float ang = c.w * fall * (1.0 + 0.8 * exp(-r * r / (R * R * 0.1)));
    p = rotAround(p, cd, ang);
    if (abs(c.w) > 7.0) hurricane = max(hurricane, fall);
  }
  // domain-warped fractal weather
  vec3 q = p * 2.6 + seed;
  vec3 warp = vec3(sfbm(q * 1.3 + 3.1, 4), sfbm(q * 1.3 + 7.7, 4), sfbm(q * 1.3 + 1.9, 4));
  float large = sfbm(q + warp * 0.55, 5) * 0.5 + 0.5;
  vec3 w2 = vec3(sfbm(p * 9.0 + 5.3, 3), sfbm(p * 9.0 + 2.2, 3), sfbm(p * 9.0 + 8.8, 3));
  float mid = sfbm(p * 8.0 + w2 * 0.5 + seed * 1.3, 6) * 0.5 + 0.5;
  float cells = sridged(p * 34.0 + seed * 3.0, 4);
  float n = large * 0.62 + mid * 0.38;
  // zonal climate: ITCZ (a little north in June), dry subtropics, stormy mid-latitudes
  float itcz = exp(-pow(abs(lat - 0.1) / 0.075, 2.0));
  float subtrop = exp(-pow(abs(alat - 0.43) / 0.12, 2.0));
  float storm = exp(-pow(abs(alat - 0.96) / 0.22, 2.0));
  float polar = smoothstep(1.15, 1.4, alat);
  float bias = 0.03 + 0.26 * itcz - 0.22 * subtrop + 0.16 * storm + 0.05 * polar;
  float pot = n * 0.8 + cells * 0.2 + bias;
  // storm tracks become streaky fronts
  float front = pow(max(1.0 - abs(sfbm(p * vec3(2.2, 7.0, 2.2) + seed * 1.7, 5)), 0.0), 6.0) * storm;
  pot += front * 0.35;
  return pot;
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
    float hA, hB;
    float a = cloudPotential(d, 0.0, hA);
    float b = cloudPotential(d, 37.0, hB);
    // cirrus: streaks along the jets
    float ci = sfbm(vec3(d.x * 5.0, d.y * 42.0, d.z * 5.0) + vec3(sfbm(d * 6.0, 3) * 2.0), 5) * 0.5 + 0.5;
    float jet = exp(-pow(abs(alat - 38.0) / 14.0, 2.0)) + 0.5 * exp(-pow(abs(latD - 6.0) / 10.0, 2.0));
    // land: clearer deserts, cloudier rainforest
    float des = 0.0;
    for (int i = 0; i < 10; i++) des = max(des, boxMask(latD, lonD, uDeserts[i], 3.0));
    float bias = -0.22 * des * mc + 0.06 * exp(-pow(abs(latD) / 10.0, 2.0)) * mc;
    gl_FragColor = vec4(clamp(a * 0.8, 0.0, 1.0), clamp(b * 0.8, 0.0, 1.0), clamp(0.5 + bias, 0.0, 1.0), clamp(ci * jet, 0.0, 1.0));
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
  float desert = 0.0;
  for (int i = 0; i < 10; i++) {
    vec4 b = uDeserts[i];
    desert = max(desert, boxMask(latD, lonD, b, 4.0));
  }
  float subtrop = exp(-pow(abs(alat - 24.0) / 8.0, 2.0)) * smoothstep(0.5, 0.95, mC);
  float arid = clamp(max(desert * (0.75 + 0.35 * n1), subtrop * 0.55) + n2 * 0.12, 0.0, 1.0);
  arid *= smoothstep(0.1, 0.6, mc + 0.2);

  if (uOut == 3) {
    // ---- night lights of the Terran Concord (r: warm cores, g: cool new districts,
    // b: transit filaments; each stored as sqrt for range in 8 bits) ----
    float wild = 0.0;
    for (int i = 0; i < 10; i++) wild = max(wild, boxMask(latD, lonD, uWild[i], 3.0));
    float habit = land * (1.0 - arid * 0.93) * (1.0 - smoothstep(58.0, 68.0, alat)) * (1.0 - step(latD, -50.0)) * (1.0 - 0.92 * wild);
    float coastNear = smoothstep(0.98, 0.55, mc);                 // within ~a hundred km of the sea
    float warm = 0.0, cool = 0.0, net = 0.0;
    // metros from the atlas: a bright old core, lattice-textured districts spreading out
    float grain = sfbm(d * 210.0 + 3.0, 3) * 0.5 + 0.5;
    float arter = pow(max(sridged(d * 140.0 + 11.0, 3), 0.0), 3.0);
    for (int i = 0; i < 160; i++) {
      if (i >= uNumCity) break;
      vec4 c = texelFetch(uData, ivec2(i, 2), 0);
      vec3 dv = d - c.xyz;
      float dk2 = dot(dv, dv) * 40589641.0;                         // km^2
      float w = c.w;
      float rc = 9.0 + 16.0 * w, rm = 34.0 + 90.0 * w;
      if (dk2 > rm * rm * 9.0) continue;
      float core = exp(-dk2 / (rc * rc));
      float metro = exp(-dk2 / (rm * rm));
      float modern = fract(sin(float(i) * 12.9898) * 43758.5453);
      float dist = (0.55 + 0.45 * grain) * (0.7 + 0.6 * arter);
      warm += w * (core * 0.75 + metro * 0.22 * dist * (1.0 - 0.5 * modern));
      cool += w * metro * (0.14 + 0.45 * modern) * dist + w * core * 0.3 * modern;
    }
    // coastal and river towns everywhere people can live: cellular points ~95 km apart
    {
      vec3 q = d * 67.0;
      vec3 cq = floor(q);
      float towns = 0.0, tcool = 0.0;
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
        vec3 cell = cq + vec3(float(x), float(y), float(z));
        vec3 h = vec3(fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453), fract(sin(dot(cell, vec3(269.5, 183.3, 246.1))) * 43758.5453), fract(sin(dot(cell, vec3(113.5, 271.9, 124.6))) * 43758.5453));
        vec3 pt = cell + h;
        float r2 = dot(q - pt, q - pt);                              // in cell units (~95 km)
        float size = 0.04 + 0.13 * h.x * h.x;
        float t = exp(-r2 / (size * size));
        towns += t * (0.35 + 0.65 * h.y);
        tcool += t * h.z;
      }
      float valley = pow(max(sridged(d * 16.0 + 5.0, 3), 0.0), 5.0);     // river valleys inland
      float place = habit * max(coastNear, valley * 0.8 + 0.12);
      warm += towns * place * 0.15 * (1.0 - 0.4 * clamp(tcool, 0.0, 1.0));
      cool += tcool * place * 0.1;
    }
    // sea-steads and floating cities on the continental shelves
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
      cool += sea * shelfT * 0.5;
      warm += sea * shelfT * 0.2;
    }
    // settled countryside: a faint even glow; the coast road
    warm += habit * 0.0012 * (0.4 + 1.2 * grain);
    net += habit * coastBand * 0.05;
    // maglev corridors between the metros: great-circle filaments, dim where they run under the sea
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
      // stations and towns strung along the line every ~45 km
      float along = acos(clamp(dot(normalize(pp), A.xyz), -1.0, 1.0)) * 6371.0;
      float bq = fract(along / 45.0 + float(i) * 0.37) - 0.5;
      float beads = 0.3 + 0.7 * exp(-bq * bq * 30.0);
      net += A.w * 0.45 * beads * exp(-dk * dk / (wk * wk)) * (0.25 + 0.75 * land) * (1.0 - 0.8 * wild) * (N.w / wk);
    }
    // the Halo's ground ports: tether stations, the brightest nodes after Meridian
    for (int i = 0; i < 7; i++) {
      vec3 dv = d - uPorts[i].xyz;
      float dk2 = dot(dv, dv) * 40589641.0;
      warm += uPorts[i].w * exp(-dk2 / 110.0) * 1.2;
      cool += uPorts[i].w * exp(-dk2 / 900.0) * 0.5;
      net += uPorts[i].w * exp(-dk2 / 5000.0) * 0.25;
    }
    warm *= 1.0 - 0.85 * wild;
    cool *= 1.0 - 0.85 * wild;
    // linear, in a half-float target: mip averages stay true means, so a far planet keeps its lights
    gl_FragColor = vec4(min(warm, 8.0), min(cool, 8.0), min(net, 8.0), 1.0);
    return;
  }

  if (uOut == 1) {
    // night lights
    float city = 0.0;
    for (int i = 0; i < 160; i++) {
      if (i >= uNumCity) break;
      vec4 c = texelFetch(uData, ivec2(i, 2), 0);
      vec3 dv = d - c.xyz;
      float sg = (18.0 + 42.0 * c.w) / 6371.0;
      city += c.w * exp(-dot(dv, dv) / (sg * sg)) * (0.7 + 0.3 * sfbm(d * 900.0 + float(i), 2));
    }
    float hab = land * (1.0 - arid * 0.85) * (1.0 - smoothstep(52.0, 66.0, alat)) * (1.0 - step(latD, -56.0));
    float coastal = 0.35 + 0.65 * (1.0 - mc);
    float towns = smoothstep(0.5, 0.85, sfbm(d * 70.0 + 2.0, 4) * 0.5 + 0.5) * smoothstep(0.35, 0.8, sfbm(d * 9.0 + 5.0, 3) * 0.5 + 0.5);
    city = (city + hab * coastal * towns * 0.07) * land;
    float ice = 0.0;
    if (latD < -62.0) ice = land;
    if (latD > 59.0 && lonD > -74.0 && lonD < -12.0) ice = land * smoothstep(0.35, 0.8, mc);
    ice = max(ice, (1.0 - land) * smoothstep(77.0, 82.0, latD + n2 * 6.0));
    ice = max(ice, (1.0 - land) * smoothstep(-68.0, -71.0, latD + n2 * 4.0));
    float shelf = (1.0 - land) * smoothstep(0.35, 0.95, mc + 0.25 * coastBand + n1 * 0.1);
    gl_FragColor = vec4(clamp(city, 0.0, 1.0), ice, arid, shelf);
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
  vec3 sand = vec3(0.52, 0.39, 0.22);
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
  c = mix(c, dsand, dune);
  c *= 0.78 + 0.44 * (n2 * 0.5 + 0.5);
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
  float shelf = smoothstep(0.35, 0.95, mc + 0.25 * coastBand + n1 * 0.1);
  vec3 ocean = mix(vec3(0.004, 0.011, 0.028), vec3(0.012, 0.05, 0.06), shelf);
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
  add(24, 142, 0.05, 8.5);
  // subtropical highs (anticyclones spread cloud into rings)
  for (let i = 0; i < 6; i++) {
    const south = i % 2 === 1;
    add((24 + rnd() * 10) * (south ? -1 : 1), rnd() * 360 - 180, 0.2 + rnd() * 0.1, (south ? 1 : -1) * 1.2);
  }
  return out;
}

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
    this.clouds = mk(cloudSize);
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
        uTexelKm: { value: (Math.PI / 2 / size) * 6371 },
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
