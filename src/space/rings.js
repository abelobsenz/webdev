import * as THREE from 'three';
import { RINGS } from '../sky/celestial.js';
import { U } from '../core/uniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { SUNLIGHT_GLSL, createRibbonMaterial, buildRibbonGeometry } from './lines.js';
import { R_EARTH, MERIDIAN_LON, bodyDir, cityToBody } from './sim.js';
import { FACADE_GLSL } from '../world/materials.js';
import { HALO_PORTS } from './earthData.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createHullMaterial, KIND } from './hull.js';
import { createLamps, LAMP } from './lamps.js';
import { HaloDistricts } from './haloDistricts.js';

// The four orbital rings at planetary scale, with the same radii, widths and
// orientations as RINGS in src/sky/celestial.js (defined there in Meridian's
// local frame; converted here to the Earth-fixed frame). Each ring is a trough:
// a habitat floor facing space, retaining walls, and two rotor tubes beneath.

/** Ring basis in the body frame: a = direction of u = 0, b = direction of increasing u, n = axis. */
export function ringBasis(def) {
  const m = cityToBody();
  const q = new THREE.Quaternion();
  if (def.polar) {
    const lon = THREE.MathUtils.degToRad(def.lon);
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(lon), Math.sin(lon), 0));
  } else {
    q.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(def.inclination), 0, 0));
  }
  const a = new THREE.Vector3(0, 1, 0).applyQuaternion(q).transformDirection(m);
  const b = new THREE.Vector3(1, 0, 0).applyQuaternion(q).transformDirection(m);
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q).transformDirection(m);
  return { a, b, n, R: R_EARTH + def.altitude };
}

const VERT = /* glsl */ `
attribute vec3 aRing;
uniform vec2 uResolution;
uniform vec3 uAxisBody;
uniform float uWidth;
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vRad;
varying float vWpx;
varying float vS;
varying vec3 vAx;
void main() {
  vRing = aRing;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  // the ring's axis and the point's offset along it (the ring's plane passes through the Earth's
  // centre): which face of a wall is inboard
  vAx = normalize(mat3(modelMatrix) * uAxisBody);
  vS = dot(w.xyz, vAx);
  // the band's width on screen, per vertex (the same estimate as the far-field ribbon), so the
  // hand-over between the two is a clean edge rather than a per-pixel fwidth threshold
  float dist = max(length(w.xyz - cameraPosition), 1e-3);
  float pxPerKm = uResolution.y * 0.5 * projectionMatrix[1][1] / dist;
  float ca = dot((w.xyz - cameraPosition) / dist, normalize(mat3(modelMatrix) * uAxisBody));
  vWpx = uWidth * pxPerKm * (sqrt(max(1.0 - ca * ca, 0.0)) + 0.06);
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uTransmittanceLUT;
uniform vec3 uSunDir;
uniform float uSunE;
uniform float uTime;
uniform float uSimT;
uniform vec3 uAlbedo;
uniform vec3 uHabitatColor;
uniform vec3 uStreamColor;
uniform float uHub;
uniform float uSpeed;
uniform float uSeed;
uniform float uWidth;
uniform float uLen;
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vN;
varying float vWpx;
varying float vS;
varying vec3 vAx;
${SUNLIGHT_GLSL}
${NOISE_GLSL}
${FACADE_GLSL}
#ifdef HALO_CELLS
// ---- the district plan (src/space/haloDistricts.js: cellKinds, cellPlanTextures) painted on
//      the deck, so the band reads as the same towns, parks, lakes and glasshouse ranges from
//      orbit that the silhouettes and full districts raise onto it near the camera ----
uniform sampler2D uPlanCells;
uniform sampler2D uPlanTiles;
uniform vec4 uPlan;            // seam tile index, seam tile length (km), tile count, deck span (km)
vec3 planStone(float v) {
  if (v < 0.5) return vec3(0.70, 0.62, 0.50);          // limestone
  if (v < 1.5) return vec3(0.68, 0.47, 0.33);          // terracotta
  if (v < 2.5) return vec3(0.70, 0.72, 0.72);          // white render
  if (v < 3.5) return vec3(0.49, 0.41, 0.36);          // brick
  if (v < 4.5) return vec3(0.66, 0.71, 0.62);          // sage ceramic
  if (v < 5.5) return vec3(0.67, 0.58, 0.60);          // rose
  return vec3(0.70, 0.72, 0.72);
}
float planPitched(float v) { return v < 0.5 ? 0.55 : v < 1.5 ? 0.8 : v < 2.5 ? 0.2 : v < 3.5 ? 0.35 : v < 4.5 ? 0.5 : v < 5.5 ? 0.4 : 0.3; }
// coverage of [a, b] by a pixel w wide, and of a disc
float pBox(float x, float a, float b, float w) { return clamp(min(x - a, b - x) / max(w, 1e-5) + 0.5, 0.0, 1.0); }
float pDisc(float r, float R, float w) { return clamp((R - r) / max(w, 1e-5) + 0.5, 0.0, 1.0); }

const vec3 P_STREET = vec3(0.17, 0.17, 0.18);
const vec3 P_PAVE = vec3(0.46, 0.43, 0.38);
const vec3 P_LAWN = vec3(0.075, 0.15, 0.045);
const vec3 P_WOOD = vec3(0.03, 0.07, 0.025);
const vec3 P_TILE = vec3(0.50, 0.25, 0.14);
const vec3 P_FLAT = vec3(0.34, 0.34, 0.30);
const vec3 P_GLASS = vec3(0.07, 0.09, 0.11);
const vec3 P_WATER = vec3(0.018, 0.038, 0.058);
const vec3 P_WARM = vec3(1.0, 0.72, 0.44);

// One town block (bw x bd km, local coords q from its corner): a court block, a tower on its
// podium, stepped terraces or a pocket square, by hash. Returns the albedo; lit windows in wl.
vec3 planBlock(vec2 q, vec2 bs, float h, float tv, float aa, out float bld) {
  vec2 c = q - 0.5 * bs;
  float fp = pBox(q.x, 0.018, bs.x - 0.018, aa) * pBox(q.y, 0.018, bs.y - 0.018, aa);   // footprint
  float pave = pBox(q.x, 0.013, bs.x - 0.013, aa) * pBox(q.y, 0.013, bs.y - 0.013, aa);
  vec3 stone = planStone(tv) * (0.85 + 0.3 * fract(h * 13.7));
  vec3 roof = fract(h * 7.3) < planPitched(tv) ? P_TILE * (0.85 + 0.35 * fract(h * 3.1)) : mix(P_FLAT, P_LAWN * 1.6, step(0.5, fract(h * 5.9)));
  vec3 col;
  if (h < 0.1) {
    // pocket square: paving, a round basin, trees round it
    float r = length(c);
    col = mix(P_PAVE, P_WATER, pDisc(r, 0.03, aa));
    col = mix(col, P_WOOD * 1.4, pBox(r, 0.045, 0.075, aa) * 0.7);
    bld = 0.1;
  } else if (h < 0.38) {
    // tower on a planted podium: the tower's dark roof and lantern crown in the middle
    col = mix(P_LAWN * 1.3, stone * 0.8, 0.35);
    float tw = 0.02 + 0.03 * fract(h * 17.0);
    float tower = pBox(c.x, -tw, tw, aa) * pBox(c.y, -tw, tw, aa);
    col = mix(col, fract(h * 23.0) < 0.5 ? P_GLASS : stone * 0.7, tower);
    bld = 0.6 + 0.4 * tower;
  } else if (h < 0.78) {
    // courtyard block: four wings round a green court
    float wing = 0.015 + 0.008 * fract(h * 11.0);
    float court = pBox(q.x, 0.018 + wing, bs.x - 0.018 - wing, aa) * pBox(q.y, 0.018 + wing, bs.y - 0.018 - wing, aa);
    col = mix(roof, P_LAWN * 1.2, court);
    bld = 1.0 - court;
  } else {
    // stepped terraces: storeys stepping down one way, a garden on every step
    float st = fract((fract(h * 29.0) < 0.5 ? q.x / bs.x : q.y / bs.y) * 4.0);
    col = mix(stone * 0.75, P_LAWN * 1.4, mix(0.35, pBox(st, 0.0, 0.35, aa * 4.0 / bs.x), 1.0 - smoothstep(0.02, 0.06, aa)));
    bld = 0.8;
  }
  col = mix(P_PAVE, col, fp);
  bld *= fp;
  return mix(P_STREET, col, pave);
}

/**
 * The plan at (u along, x across in the tile frame; km) for a pixel aa km wide: 1 where the
 * tile is dressed, with its albedo, water cover and night light.
 */
/**
 * District variant of the tile at arc u (km; -1 undressed), its index k, the position zl along
 * it, and what an undressed tile's ground is (0 none, 1 a port's green belt, 2 foundry works).
 */
float planTile(float u, out float k, out float zl, out float ground) {
  float seam0 = uPlan.x * 4.0;
  if (u < seam0) { k = floor(u / 4.0); zl = u - (k + 0.5) * 4.0; }
  else { float j = min(floor((u - seam0) / uPlan.y), 7.0); k = uPlan.x + j; zl = (u - seam0 - (j + 0.5) * uPlan.y) * 4.0 / uPlan.y; }
  k = clamp(k, 0.0, uPlan.z - 1.0);
  vec4 t = texelFetch(uPlanTiles, ivec2(int(mod(k, 256.0)), int(floor(k / 256.0))), 0);
  ground = floor(t.g * 255.0 + 0.5);
  return floor(t.r * 255.0 + 0.5) - 1.0;
}
float haloPlan(float u, float x, float aa, float night, out vec3 alb, out float water, out vec3 em) {
  alb = vec3(0.0); water = 0.0; em = vec3(0.0);
  float k, zl, ground;
  float tv = planTile(u, k, zl, ground);
  if (tv < 0.0 && ground < 0.5) return 0.0;
  float ax = abs(x);
  float dBlk = 1.0 - smoothstep(0.25 / 9.0, 0.25 / 3.0, aa);   // blocks resolved
  float lampN = 0.04 + 0.5 * night;
  if (ax > 15.0) {
    // the foot of the terraced cliffs: promenade, the glazed concourse, then the stepped decks
    // (stone slabs and their gardens) climbing to the wall
    float conc = pBox(ax, 15.26, 15.42, aa);
    float steps = fPulse(ax, 0.036, 0.0, 0.014, aa);
    vec3 terr = mix(planStone(tv) * 0.8, P_LAWN * 1.5, steps);
    alb = mix(P_PAVE, terr, smoothstep(15.44 - aa, 15.48 + aa, ax));
    alb = mix(alb, P_GLASS * 1.5, conc);
    float spine = pBox(ax, 15.337, 15.343, aa);
    em = P_WARM * (conc * 0.06 + spine * 0.8 + fPulse(ax, 0.036, 0.013, 0.016, aa) * step(15.48, ax) * 0.25) * lampN;
    return 1.0;
  }
  if (tv < 0.0 && ground < 1.5 && ax < 0.62) {
    // a port's esplanade under its concourse wings: paving in courses, lamp lines both sides
    alb = P_PAVE * (0.92 + 0.12 * fPulse(zl, 0.05, 0.0, 0.025, aa));
    em = P_WARM * (pBox(abs(ax - 0.56), -0.003, 0.003, aa) * 1.5 + 0.05) * lampN;
    return 1.0;
  }
  float ix = clamp(floor(x + 15.0), 0.0, 29.0), iz = clamp(floor(zl + 2.0), 0.0, 3.0);
  float lx = x + 15.0 - ix, lz = zl + 2.0 - iz;
  float mLo = (ix == 15.0 || ix == 8.0 || ix == 22.0) ? 0.09 : 0.03;
  float mHi = (ix == 14.0 || ix == 7.0 || ix == 21.0) ? 0.09 : 0.03;
  float inCell = pBox(lx, mLo, 1.0 - mHi, aa) * pBox(lz, 0.03, 0.97, aa);
  // between the cells: streets with their lamps, the spine viaduct, the planted tram boulevards
  vec3 gut = P_STREET;
  float spineV = pBox(ax, 0.0, 0.018, aa), boul = pBox(abs(ax - 7.0), 0.0, 0.03, aa);
  gut = mix(gut, vec3(0.32, 0.31, 0.3), spineV);
  gut = mix(gut, P_LAWN, boul * 0.8);
  vec3 gutEm = P_WARM * (0.25 + 1.2 * spineV + 0.4 * boul) * lampN;
  // (round a port the stations own the deck: a green belt of parkland round their quarters, and
  // works round the foundry)
  float code = tv < 0.0 ? (ground > 1.5 ? 7.0 : 2.0) : floor(texelFetch(uPlanCells, ivec2(int(ix), int(tv * 4.0 + iz)), 0).r * 255.0 + 0.5);
  float cx = lx - mLo, sx = 1.0 - mLo - mHi, cz = lz - 0.03, sz = 0.94;   // inside the cell (km)
  vec2 cc = vec2(lx - 0.5 * (mLo + 1.0 - mHi), lz - 0.5);                // from the cell centre
  float hc = hash12(vec2(ix, k * 4.0 + iz) + 0.37);
  vec3 cAlb = P_LAWN; vec3 cEm = vec3(0.0); float cW = 0.0;
  if (code < 0.5) {
    // the harbour under the arch: a basin 3 km across round the island of the Harbour Light,
    // stone quays, and the ring quarter's blocks round it
    vec2 hp = vec2(x, zl);
    float rH = length(hp);
    float basin = pDisc(rH, 1.5, aa), isl = pDisc(length(hp - vec2(0.72, 0.0)), 0.3, aa);
    float quay = pBox(rH, 1.5, 1.56, aa);
    vec2 q = mod(hp + 3.0, vec2(0.25)); float bld;
    vec3 town = planBlock(q, vec2(0.25), hash12(floor((hp + 3.0) / 0.25) + k), tv, aa, bld);
    town = mix(mix(planStone(tv) * 0.45, P_LAWN, 0.3), town, dBlk);
    cAlb = mix(town, P_WATER, basin);
    cAlb = mix(cAlb, P_LAWN * 1.2, isl * basin);
    cAlb = mix(cAlb, P_PAVE * 1.2, quay);
    cW = basin * (1.0 - isl);
    cEm = P_WARM * (bld * (1.0 - basin) * 0.35 + quay * 1.2 + isl * basin * pDisc(length(hp - vec2(0.72, 0.0)), 0.05, aa) * 3.0) * lampN;
    alb = cAlb; water = cW; em = cEm;
    return 1.0;
  }
  if (code < 1.5) {
    // town: four by four blocks on a street grid
    vec2 bs = vec2(sx, sz) / 4.0;
    vec2 bq = vec2(cx, cz), bi = floor(bq / bs), q = bq - bi * bs;
    float bld;
    vec3 blk = planBlock(q, bs, hash12(bi + vec2(ix * 4.0, k * 4.0 + iz) * 4.1 + tv), tv, aa, bld);
    vec3 mean = mix(P_STREET, mix(planStone(tv) * 0.5, P_LAWN * 1.3, 0.25), 0.72);
    cAlb = mix(mean, blk, dBlk);
    float lit = mix(0.5, step(0.35, hash12(bi * 3.7 + floor(vec2(cx, cz) / 0.05) + k)), dBlk);
    cEm = P_WARM * (mix(0.55, bld, dBlk) * lit * 0.45 + mix(0.28, 1.0 - bld, dBlk) * 0.3) * lampN;
  } else if (code < 4.5) {
    // parks: lawns and woods in drifts, two stone walks crossing, a pond or a lake
    float n = vnoise(vec2(lx, lz + mod(k, 64.0) * 4.0) * 9.0 + ix) * 0.7 + vnoise(vec2(lx, lz) * 27.0 + ix * 3.0) * 0.3;
    float woods = mix(0.35, smoothstep(0.45, 0.6, n), 1.0 - smoothstep(0.012, 0.04, aa));
    cAlb = mix(P_LAWN, P_WOOD, woods);
    float walks = max(pBox(cc.x, -0.004, 0.004, aa), pBox(cc.y, -0.004, 0.004, aa));
    cAlb = mix(cAlb, P_PAVE, walks);
    float R = code > 3.5 ? 0.29 : code > 2.5 ? 0.165 : 0.0;
    float e = 0.7 + 0.3 * hash11(hc * 91.0);
    float rr = length(vec2(cc.x, cc.y / e));
    float lake = R > 0.0 ? pDisc(rr, R, aa) : 0.0;
    cAlb = mix(cAlb, P_PAVE, R > 0.0 ? pBox(rr, R, R + 0.007, aa) : 0.0);
    cAlb = mix(cAlb, P_WATER, lake);
    cW = lake;
    cEm = P_WARM * (walks * 0.5 + (R > 0.0 ? pBox(rr, R, R + 0.01, aa) : 0.0) * 0.9) * lampN;
  } else if (code < 5.5) {
    // glasshouse ranges along the ring with crops between them, a farmstead at the near end
    float p = sx / 6.0, gi = floor(cx / p), gq = cx - gi * p;
    float glass = pBox(gq, 0.2 * p, 0.8 * p, aa) * pBox(cz, 0.06, 0.93, aa);
    vec3 crop = mix(vec3(0.16, 0.2, 0.07), vec3(0.36, 0.3, 0.12), hash11(gi + hc * 17.0));
    crop *= 0.9 + 0.2 * fPulse(cz, 0.012, 0.0, 0.006, aa);
    cAlb = mix(crop, vec3(0.34, 0.42, 0.38), glass);
    cAlb = mix(cAlb, P_TILE, pBox(cx, 0.5 * sx - 0.09, 0.5 * sx + 0.09, aa) * pBox(cz, 0.024, 0.044, aa));
    cEm = vec3(0.6, 1.0, 0.55) * glass * (0.01 + 0.08 * night) + P_WARM * pBox(cz, 0.02, 0.05, aa) * pBox(abs(cx - 0.5 * sx), 0.0, 0.25, aa) * 0.3 * lampN;
  } else if (code < 6.5) {
    // civic plaza: stone, the tower's glass drum, four halls, reflecting pools, a ring of trees
    float r = length(cc);
    cAlb = P_PAVE * 1.15;
    cAlb = mix(cAlb, P_LAWN * 1.3, pBox(r, 0.18, 0.2, aa));
    for (int q = 0; q < 4; q++) {
      float a = float(q) * 1.5707963 + 0.7853982;
      vec2 hq = cc - 0.3 * vec2(cos(a) * sx, sin(a) * sz);
      cAlb = mix(cAlb, q == 1 || q == 3 ? vec3(0.32, 0.44, 0.36) : planStone(tv) * 0.8, pBox(hq.x, -0.075, 0.075, aa) * pBox(hq.y, -0.055, 0.055, aa));
    }
    float pool = pBox(cc.x, -0.09, 0.09, aa) * (pBox(cc.y, 0.18, 0.22, aa) + pBox(cc.y, -0.22, -0.18, aa));
    cAlb = mix(cAlb, P_WATER, pool);
    cW = pool;
    float tower = pDisc(r, 0.1, aa);
    cAlb = mix(cAlb, P_GLASS, tower);
    cEm = P_WARM * (pBox(r, 0.155, 0.165, aa) * 1.0 + tower * 0.5 + pBox(r, 0.09, 0.1, aa) * 2.0) * lampN;
  } else if (code < 7.5) {
    // works: fabrication halls under dark photovoltaic sawtooth roofs, tanks, the yard
    float halls = 2.0 + floor(hc * 2.0), hp = sx / halls, hi = floor(cx / hp), hq = cx - hi * hp;
    float hall = pBox(hq, 0.035, hp - 0.035, aa) * pBox(cz, 0.04, 0.04 + 0.55 * sz, aa);
    vec3 pv = vec3(0.05, 0.07, 0.12) * (0.8 + 0.4 * fPulse(cz, 0.064, 0.0, 0.03, aa));
    cAlb = mix(vec3(0.22, 0.21, 0.2), pv, hall);
    float tq = mod(cx - 0.09, (sx - 0.18) / 4.0);
    float tank = pDisc(length(vec2(min(tq, (sx - 0.18) / 4.0 - tq), cz - 0.72 * sz)), 0.03, aa) * step(0.05, cx) * step(cx, sx - 0.05);
    cAlb = mix(cAlb, vec3(0.6, 0.58, 0.54), tank);
    cEm = vec3(1.0, 0.58, 0.26) * ((1.0 - hall) * 0.35 + pBox(cz, 0.0, 0.04, aa) * 0.8) * lampN;
  } else if (code < 8.5) {
    // sports ground: pitch, raked stands, the roof ring and its floodlit rim
    float r = length(cc);
    cAlb = mix(P_PAVE, vec3(0.5, 0.5, 0.52), pDisc(r, 0.3, aa));
    cAlb = mix(cAlb, vec3(0.1, 0.24, 0.06) * (0.9 + 0.2 * fPulse(cc.x, 0.02, 0.0, 0.01, aa)), pDisc(r, 0.15, aa));
    cAlb = mix(cAlb, P_GLASS * 2.0, pBox(r, 0.25, 0.29, aa));
    cEm = vec3(0.85, 0.92, 1.0) * (pBox(r, 0.274, 0.278, aa) * 3.0 + pDisc(r, 0.15, aa) * 0.3) * lampN;
  } else if (code < 9.5) {
    // covered markets: three lantern-roofed arcades along the ring
    float p = sx / 3.0, mq = mod(cx, p);
    float arc = pBox(mq, 0.2 * p, 0.8 * p, aa) * pBox(cz, 0.04, 0.9, aa);
    cAlb = mix(P_PAVE, vec3(0.62, 0.48, 0.32), arc);
    cEm = (P_WARM * 0.8 + vec3(0.3, 0.0, 0.15)) * arc * (0.03 + 0.4 * night) + P_WARM * (1.0 - arc) * 0.2 * lampN;
  } else {
    // canal quarter: four canals between stone quays, gabled terraces lining both sides
    float p = sx / 4.0, cq = mod(cx, p) - 0.5 * p;
    float canal = pBox(cq, -0.011, 0.011, aa);
    float houses = pBox(abs(cq), 0.018, 0.032, aa) * pBox(cz, 0.014, 0.9, aa);
    cAlb = mix(P_PAVE, P_TILE * (0.85 + 0.3 * hash11(floor(cz / 0.044) + cx)), houses);
    cAlb = mix(cAlb, P_WATER, canal);
    cW = canal;
    cEm = P_WARM * (houses * 0.35 + pBox(abs(cq), 0.012, 0.016, aa) * 0.8) * lampN;
  }
  alb = mix(gut, cAlb, inCell);
  water = cW * inCell;
  em = mix(gutEm, cEm, inCell);
  return 1.0;
}
#endif

float aaStep(float e, float x, float w) { return smoothstep(e - w, e + w, x); }
// coverage of the band |d| < hw for a pixel aa wide: a band narrower than the pixel keeps its
// energy spread over it instead of breaking into dashes
float aaBand(float d, float hw, float aa) { float w = max(hw, aa * 0.5); return clamp((w - abs(d)) / max(aa, 1e-5) + 0.5, 0.0, 1.0) * min(1.0, hw / w); }
float aaDisc(float r, float R, float aa) { return clamp((R - r) / max(aa, 1e-5) + 0.5, 0.0, 1.0); }
// the Halo river's centre line (km across the deck), periodic round the whole ring and
// straight and centred through each hub basin
float haloRiver(float u, float hub) {
  float hk = mod(u, hub) - 0.5 * hub;
  float calm = smoothstep(4.0, 16.0, abs(hk));
  float f1 = 6.2831853 * floor(uLen / 61.0) / uLen, f2 = 6.2831853 * floor(uLen / 23.3) / uLen;
  return calm * (2.9 * sin(u * f1 + 0.7) + 1.5 * sin(u * f2 + 2.1));
}
// lamps every P km, w km long, filtered so a sub-pixel lamp keeps its energy spread over
// the pixel instead of popping on and off as the view moves
float aaLamp(float x, float P, float w) {
  float d = abs(fract(x / P + 0.5) - 0.5) * P;
  float fw = max(fwidth(x), 1e-5);
  return clamp(1.0 - d / max(w, fw), 0.0, 1.0) * min(1.0, w / fw);
}

void main() {
  float u = vRing.x, v = vRing.y, part = vRing.z;
  // below ~2 px across, the far-field ribbon takes over (no aliased dotted lines)
  if (vWpx < ((part > 1.5 && part < 2.5) ? 33.0 : 2.2)) discard;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 p = vWorld;
  vec3 rhat = normalize(p);
  vec3 V = normalize(cameraPosition - p);
  vec3 sunL = spaceSunlight(uTransmittanceLUT, p, uSunDir) * uSunE;
  float ndl = max(dot(N, uSunDir), 0.0);
  float dayBelow = max(dot(rhat, uSunDir), 0.0);
  vec3 earthshine = vec3(0.35, 0.5, 0.8) * dayBelow * uSunE * 0.09 * max(dot(N, -rhat), 0.0);
  float fu = max(fwidth(u), 1e-4);                 // km per pixel along the ring
  float fv = fwidth(v);                             // (derivatives taken here, in uniform flow)
  float fk = max(fu, fv * uWidth);                  // km per pixel, either way
  // every pattern reaches its exact average while its cell still spans ~3 px
  #define RDET(c) (1.0 - smoothstep((c) / 9.0, (c) / 3.0, fk))
  float detail = RDET(0.8);
  float hubPh = fract(u / uHub);
  float hub = 1.0 - smoothstep(0.012, 0.03 + fu / uHub, abs(hubPh - 0.5));
  float nightSide = 1.0 - smoothstep(-0.05, 0.1, dot(rhat, uSunDir));
  vec3 col = vec3(0.0), em = vec3(0.0);
  float topSide = dot(N, rhat);
  vec3 H = normalize(V + uSunDir);
  float av = abs(v);

#ifdef ROOF
  // ---- glass vault over the habitat: arched ribs every 2 km, mullions 1 km apart across it,
  //      clear glass that turns to a Fresnel sheen at grazing angles, a bounded sun glint ----
  // ribs across the vault every 2 km, fading toward a faint tint once they are under ~10 px
  // apart (a far-off vault read as graph paper laid over the deck); the long mullions only near
  float ribFade = 1.0 - smoothstep(2.0 / 26.0, 2.0 / 9.0, fk);
  float rib = (1.0 - fPulse(u, 2.0, 0.0, 1.94, fk)) * mix(0.14, 1.0, ribFade);
  float mull = (1.0 - fPulse(v * uWidth + 1.0, 2.0, 0.0, 1.965, fk)) * (1.0 - smoothstep(0.02, 0.07, fk));
  // glazing bars every 50 m both ways, seen from the deck and from low over the vault
  float vkm0 = v * uWidth;
  float bars = max(1.0 - fPulse(mod(u, 100.0), 0.05, 0.0, 0.0485, fk), 1.0 - fPulse(vkm0, 0.05, 0.0, 0.0485, fk)) * (1.0 - smoothstep(0.004, 0.012, fk));
  float frame = max(max(rib, mull * 0.5), bars * 0.35);
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float Fg = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  float nh = max(dot(N, H), 0.0);
  // the glass is laid in 250 m panes, each set a fraction of a degree off true: resolved, the
  // Sun's reflection breaks into a scatter of flashing panes; unresolved, a wider soft lobe
  // carrying the same energy
  float vkm = v * uWidth;
  vec2 pc = floor(vec2(u / 0.25, vkm / 0.25));
  float dPane = 1.0 - smoothstep(0.25 / 9.0, 0.25 / 3.0, fk);
  vec3 jit = (vec3(hash12(pc), hash12(pc + 7.1), hash12(pc + 13.7)) - 0.5) * 0.03;
  float nhj = max(dot(N, normalize(H + jit)), 0.0);
  float sparkle = pow(nhj, 1800.0) * 5.0;
  float smoothG = pow(nh, 400.0) * 1.6;
  // (the vault is a cylinder: its Sun is a narrow streak along the ring, not a disc; unresolved
  // panes spread it only a little, and its peak stays well under the Sun's own brightness)
  vec3 glint = min(sunL * (mix(pow(nh, 700.0) * 0.8, sparkle, dPane) * 0.5 + smoothG * 0.25) * Fg, sunL * 0.22);
  vec3 sky = vec3(0.02, 0.03, 0.05) * uSunE * 0.05 * Fg + earthshine * 0.3 * Fg;
  // ribs: bronze box girders, a highlight along the edge that faces the Sun, darker flanks
  float ribX = clamp((mod(u, 2.0) - 1.97) / 0.03, -1.0, 1.0) * (1.0 - smoothstep(0.004, 0.02, fk));
  vec3 Nr = normalize(N + normalize(cross(rhat, vAx)) * ribX * 0.8);
  float ndlR = max(dot(Nr, uSunDir), 0.0);
  vec3 frameC = vec3(0.36, 0.28, 0.19) / 3.14159 * (sunL * mix(ndl, ndlR, abs(ribX)) + earthshine * 2.0) + min(sunL * pow(max(dot(Nr, H), 0.0), 90.0) * 0.25, sunL * 0.3);
  // the ribs carry strings of lamps (a bead every 500 m across the vault) that trace its
  // arches in the night, and glow as lines once the beads are too small to see
  float bead = aaLamp(vkm + 0.25, 0.5, 0.014);
  vec3 warm = vec3(1.0, 0.72, 0.42);
  frameC += uHabitatColor * (0.02 + 0.06 * nightSide) * rib;
  vec3 ribLight = warm * rib * ribFade * (bead * 3.0 + 0.03) * (0.06 + nightSide);          // (lost in daylight)
  // panes a shade apart in tint (the mean kept), a faint bloom where the towns below shine up
  float glassA = 0.05 + 0.5 * Fg + 0.03 * (hash12(pc + 3.3) - 0.5) * dPane;
  // premultiplied: frame opaque, glass a thin tint that reflects the sky and the Sun
  gl_FragColor = vec4(mix(glint + sky, frameC, frame) + ribLight, mix(glassA, 1.0, frame));
  return;
#endif

  if (part < 0.5) {
    if (topSide > 0.0) {
      // ---- the habitat floor, planned: a river meanders down the spine of the deck; at every
      //      hub (under its arch) it widens into the round basin of a harbour town, ringed by
      //      pale quays, eight boulevards and a green belt; river towns sit on alternate banks
      //      between the hubs, each with its bridge; terraced quarters climb the foot of both
      //      walls; between them fields lie in long strips across the deck with woods in drifts.
      //      Every order is filtered to its mean while it still spans a few pixels. ----
      float vk = v * uWidth;                                // km across the deck from its centre line
      float aa = fk;                                        // km per pixel
      float dB = RDET(0.5), dL = RDET(0.35), dF = RDET(0.85), dT = RDET(0.3);
      float quarter = uHub * 0.25;
      float q = (u - 0.5 * uHub) / quarter;
      float ti = floor(q + 0.5);                            // settlement cell (every fourth a hub town)
      float du = (q - ti) * quarter;                        // km along the ring from its centre
      float isHub = 1.0 - step(0.5, mod(ti + 4000.0, 4.0));
      float hk = mod(u, uHub) - 0.5 * uHub;                 // km from the nearest hub centre
      // the river's line: calm and centred through each hub basin
      float rc = haloRiver(u, uHub);
      float dr = vk - rc;
      float rw = 0.42 + 0.07 * sin(u * 0.047);
      // hub town: basin, island, quays, ring quarter, boulevards, green belt
      float rH = length(vec2(du, vk));
      float basin = isHub * aaDisc(rH, 2.6, aa);
      float island = isHub * aaDisc(rH, 0.8, aa);
      float ringQ = isHub * aaDisc(rH, 6.4, aa) * (1.0 - aaDisc(rH, 2.75, aa));
      float belt = isHub * aaDisc(rH, 7.3, aa) * (1.0 - aaDisc(rH, 6.4, aa));
      float a8 = (fract(atan(vk, du) / 0.7853982 + 0.5) - 0.5) * 0.7853982;
      float boul = ringQ * aaBand(rH * sin(a8), 0.09, aa);
      float rings2 = ringQ * max(aaBand(rH - 4.0, 0.06, aa), aaBand(rH - 5.25, 0.06, aa));
      float quay = isHub * aaBand(rH - 2.68, 0.08, aa);
      // under the arch, a civic avenue crosses the whole deck from wall to wall
      float avenue = aaBand(hk, 0.28, aa) * (1.0 - basin);
      // river towns, on the bank chosen for each cell, following the meander
      float tid = ti + uSeed * 7.0;
      float h1 = hash11(tid * 1.37 + 0.3), h2 = hash11(tid * 2.11 + 1.7), h3 = hash11(tid * 3.07 + 4.1);
      float side = h1 < 0.5 ? -1.0 : 1.0;
      float ta = 3.0 + 2.6 * h2, tb = 1.4 + 1.0 * h3;
      float edgeN = (vnoise(vec2(u * 0.8, vk * 0.8) + tid) - 0.5) * 0.22 * RDET(1.5);
      float te = length(vec2(du / ta, (dr - side * (rw + 0.1 + tb)) / tb)) + edgeN;
      float town = (1.0 - isHub) * (1.0 - smoothstep(1.0 - aa / tb, 1.0 + aa / tb, te));
      // a village across the water from about half of them
      float tv = length(vec2((du - (h2 - 0.5) * ta) / (ta * 0.45), (dr + side * (rw + 0.1 + tb * 0.55)) / (tb * 0.55))) + edgeN;
      town = max(town, (1.0 - isHub) * step(0.5, h3) * (1.0 - smoothstep(1.0 - aa / tb, 1.0 + aa / tb, tv)));
      float bridge = (1.0 - isHub) * aaBand(du, 0.05, aa) * step(abs(dr), rw + 0.12) * step(te, 2.2);
      // terraced quarters along both walls, their streets parallel to the wall
      float wallT = smoothstep(12.3 - aa, 12.3 + aa, abs(vk));
      float terr = 1.0 - fPulse(abs(vk), 0.45, 0.0, 0.39, aa);
      float crossL = 1.0 - fPulse(u, 0.8, 0.0, 0.72, aa);
      // ---- colours
      float cellT = hash12(floor(vec2(u / 0.5, vk / 0.5)));
      vec3 park = vec3(0.05, 0.1, 0.035) * (0.85 + 0.3 * mix(0.5, vnoise(vec2(u * 0.4, vk * 0.6)), dT));
      vec3 wood = vec3(0.022, 0.055, 0.02) * (0.85 + 0.3 * mix(0.5, vnoise(vec2(u * 1.3, vk * 1.3) + 5.0), dT));
      // fields in long strips across the deck (one farm lane splits each side), muted crops
      // each farm (3.4 km along, one side of its lane) keeps one crop family; its strips differ
      // only a shade, so the patchwork reads as holdings rather than a checkerboard
      float side2 = floor(abs(vk) / 4.3) + step(0.0, vk) * 17.0;
      float farmId = hash12(vec2(floor(u / 3.4), side2) + uSeed);
      float strip = hash12(vec2(floor(u / 0.85), side2) + uSeed * 1.7);
      vec3 cropC = farmId < 0.3 ? vec3(0.165, 0.155, 0.078) : farmId < 0.62 ? vec3(0.105, 0.145, 0.056) : vec3(0.135, 0.15, 0.066);
      cropC *= 0.93 + 0.14 * strip;
      vec3 farm = mix(vec3(0.135, 0.148, 0.066), cropC, dF);
      farm *= 1.0 - 0.14 * (1.0 - fPulse(u, 0.85, 0.0, 0.81, aa));        // hedges between strips
      farm *= 1.0 - 0.2 * aaBand(mod(abs(vk), 4.3) - 2.15, 0.02, aa);      // farm lanes
      float forest = smoothstep(0.57, 0.67, vnoise(vec2(u * 0.055, vk * 0.13) + 3.0) * 0.7 + vnoise(vec2(u * 0.21, vk * 0.4) + 9.0) * 0.3);
      // pale stone towns (bone-white blocks, darker lanes, green yards) that stand out on the fields
      vec3 townC = mix(vec3(0.31, 0.295, 0.26), mix(vec3(0.25, 0.24, 0.215), vec3(0.42, 0.4, 0.35), cellT), dB);
      float streets = 1.0 - fPulse(u, 0.5, 0.0, 0.44, aa) * fPulse(vk, 0.5, 0.0, 0.44, aa);
      townC = mix(townC, vec3(0.12, 0.12, 0.125), streets * 0.5);
      townC = mix(townC, park, 0.28 * mix(0.5, vnoise(vec2(u * 2.0, vk * 2.0)), dB));    // yards and street trees
      vec3 terrC = mix(vec3(0.21, 0.2, 0.18), vec3(0.26, 0.25, 0.225), terr * dB);
      terrC = mix(terrC, park, 0.35 * (1.0 - terr) * dB + 0.12);
      terrC = mix(terrC, vec3(0.12, 0.12, 0.125), crossL * 0.4);
      vec3 hubC = mix(vec3(0.3, 0.29, 0.27), mix(vec3(0.24, 0.23, 0.215), vec3(0.36, 0.345, 0.31), cellT), dB);
      hubC = mix(hubC, park, 0.18);
      vec3 alb = mix(farm, wood, forest);
      float riparian = 1.0 - smoothstep(rw + 0.7, rw + 1.1, abs(dr));
      alb = mix(alb, park, riparian);
      alb = mix(alb, terrC, wallT);
      alb = mix(alb, townC, town * (1.0 - wallT));
      alb = mix(alb, park * 1.1, belt);
      alb = mix(alb, hubC, ringQ);
      alb = mix(alb, vec3(0.4, 0.38, 0.34), max(max(boul, rings2), max(quay, avenue * (1.0 - wallT) * 0.8)));
      float river = aaBand(dr, rw, aa) * (1.0 - wallT);
      float water = max(max(river, basin) * (1.0 - island), 0.0);
      water *= 1.0 - bridge * 0.9;
      alb = mix(alb, vec3(0.018, 0.038, 0.058), water);
      alb = mix(alb, mix(park, vec3(0.38, 0.36, 0.32), aaDisc(rH, 0.3, aa)), island);
      alb = mix(alb, vec3(0.36, 0.34, 0.3), bridge * step(abs(dr), rw + 0.12));
#ifdef HALO_CELLS
      // where the ring is dressed with districts, the deck carries their plan instead
      vec3 pAlb, pEm; float pWater;
      float plan = haloPlan(u, -v * uPlan.w, aa, nightSide, pAlb, pWater, pEm);
      alb = mix(alb, pAlb, plan);
      water = mix(water, pWater, plan);
#endif
      vec3 diff = alb / 3.14159 * sunL * ndl;
      // water: wind-rippled, so the Sun's reflection breaks into a moving scatter of glints while
      // the ripples are resolved (tens of metres), a steady lobe once they are not
      float dRip = RDET(0.06) * water;
      float uw = mod(u, 6.2831853);                          // (integer wavenumbers per 2 pi km: seamless, and exact in float32)
      vec3 rip = vec3(sin(uw * 61.0 + vk * 23.0 + uTime * 1.3), sin(vk * 57.0 - uw * 19.0 - uTime * 1.1), sin((uw - vk) * 41.0 + uTime * 0.7));
      vec3 Nw = normalize(N + rip * 0.035 * dRip);
      float nhw = max(dot(Nw, H), 0.0);
      float spec = mix(pow(max(dot(N, H), 0.0), 80.0) * 0.45, pow(nhw, 600.0) * 3.0, dRip) + pow(max(dot(N, H), 0.0), 20.0) * 0.06;
      float F = 0.04 + 0.96 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
      col = diff + min(sunL * spec * F * (0.1 + 0.9 * water), sunL * 0.6);
      // the lights of the banks and quays trembling on the water at night
      float nearBank = 1.0 - smoothstep(0.0, 0.35, abs(abs(dr) - rw));
      float shimmer = 0.5 + 0.5 * sin(uw * 90.0 + uTime * 2.1) * sin(vk * 70.0 - uTime * 1.7);
      em += uHabitatColor * water * (max(nearBank, quay + isHub * (1.0 - aaDisc(rH, 2.2, aa))) * mix(0.5, shimmer, RDET(0.05))) * (0.04 + 0.35 * nightSide);
      // farm lanes lit with a lamp every 400 m, and the hedgerow villages' windows
      float laneL = aaBand(mod(abs(vk), 4.3) - 2.15, 0.02, aa) * (1.0 - fPulse(u, 0.4, 0.0, 0.36, aa)) * (1.0 - max(max(town, wallT), ringQ));
      float hamlet = step(0.93, hash12(floor(vec2(u / 1.7, vk / 1.7)) + 91.0)) * aaDisc(length(fract(vec2(u, vk) / 1.7) - 0.5) * 1.7, 0.12, aa) * (1.0 - wallT) * (1.0 - water);
      em += uHabitatColor * (laneL * 0.5 + hamlet * 0.35) * (0.03 + 0.5 * nightSide);
      col += vec3(0.02, 0.03, 0.05) * F * uSunE * 0.05;
      // lights: lit rooms in the towns, lamps along the boulevards, the quays and both river banks
      float urban = max(max(town, wallT), ringQ);
      float cell = hash12(floor(vec2(u / 0.35, vk / 0.35)));
      float lit = mix(0.24, step(0.55, cell) * (0.5 + cell), dL);
      em += uHabitatColor * urban * lit * (0.08 + 0.22 * nightSide) * (1.0 - water);
      float banks = aaBand(abs(dr) - rw - 0.05, 0.02, aa) * (1.0 - wallT) * (1.0 - basin);
      em += uHabitatColor * (max(max(boul, rings2), avenue * 0.7) * (0.12 + 0.5 * nightSide) + quay * (0.3 + 0.9 * nightSide) + banks * (0.12 + 0.7 * nightSide));
      em += uHabitatColor * island * aaDisc(rH, 0.3, aa) * (0.25 + 0.6 * nightSide);
#ifdef HALO_CELLS
      em = mix(em, pEm, plan);
#endif
    } else {
      // ---- underside, facing the Earth: structure, radiators, lights ----
      float dP = RDET(2.4), dR = RDET(6.0), dL = RDET(0.8);
      float panel = hash12(floor(vec2(u / 2.4, v * 8.0)));
      vec3 alb = uAlbedo * (0.7 + 0.35 * mix(0.5, panel, dP));
      float rib = 1.0 - fPulse(u, 6.0, 0.0, 5.6, fk);
      alb *= 1.0 - 0.3 * rib;
      float trus = 1.0 - smoothstep(0.02, 0.05 + fv, abs(av - 0.25));
      alb *= 1.0 - 0.25 * trus;
      col = alb / 3.14159 * (sunL * ndl + earthshine * 3.0);
      col += min(sunL * pow(max(dot(N, H), 0.0), 60.0) * 0.3, sunL * 0.5);
      float cell = hash12(floor(vec2(u / 0.8, v * 24.0)));
      float lit = mix(0.24, step(0.62, cell) * (0.6 + cell), dL);
      float band = 1.0 - smoothstep(0.3, 0.34, av);
      em += uHabitatColor * band * lit * (0.05 + 0.2 * nightSide);
      em += uHabitatColor * hub * 0.5;
      // soft pulses drifting along the keel (their mean once they are under a few pixels)
      float keel = 1.0 - smoothstep(0.004, 0.012 + fv, av);
      float kp = fract(u / 90.0 - uTime * 0.04 * uSpeed) - 0.5;
      float kpulse = mix(0.1, exp(-kp * kp * 300.0), 1.0 - smoothstep(0.6, 1.8, fu));
      em += uStreamColor * keel * (0.08 + 1.2 * kpulse);
    }
  } else if (part < 1.5) {
    // ---- retaining walls, 2.2 km high. Inboard: the terraced cliffs - thirteen decks of 160 m
    //      in 500 m blocks of their district's stone or of glass, every deck capped by a stone
    //      slab and its garden, light wells with glass lift shafts between the blocks, a cascade
    //      down every third block. Outboard, facing space: heat radiators on stand-offs between
    //      the docking bays (their lit mouths every 2 km) and the conduits that feed them. Both:
    //      a buttress every 3 km standing proud and lit from the side it faces, a dark plinth
    //      with the deck's shadow at its foot, a bronze parapet along the crest. Every order
    //      falls to its exact mean while its cell still spans a few pixels. ----
    float wallH = max(1.2, uWidth * 0.07);
    float hk = v * wallH;                                  // height above the deck, km
    float vert = 1.0 - abs(dot(N, rhat));                  // 1 on the faces, 0 on the crest
    float fh = max(fv * wallH, 1e-5);                      // (v's derivative, taken in uniform flow)
    float fwk = max(fu, fh);
    float inboard = 1.0 - step(0.0, dot(N, vAx) * vS);
    float inner = inboard * vert, outer = (1.0 - inboard) * vert;
    vec3 Tr = normalize(cross(rhat, vAx));                 // along the ring, toward increasing u
    // neighbourhood cladding (one per 3 km bay): limestone, terracotta, white render, bronze
    // panel, sage ceramic; the district's own stone where the ring is dressed
    float bay = floor(u / 3.0);
    float hb = hash12(vec2(bay, 7.0) + uSeed);
    vec3 clad = hb < 0.25 ? vec3(0.62, 0.56, 0.46) : hb < 0.45 ? vec3(0.60, 0.41, 0.29) : hb < 0.7 ? vec3(0.70, 0.71, 0.70) : hb < 0.85 ? vec3(0.44, 0.35, 0.25) : vec3(0.50, 0.60, 0.52);
#ifdef HALO_CELLS
    float tk, tz, tg;
    float tvw = planTile(u, tk, tz, tg);
    if (tvw >= 0.0) clad = mix(clad, planStone(tvw), 0.7);
#endif
    float bayRes = 1.0 - smoothstep(0.25, 0.9, fu);
    clad = mix(vec3(0.59, 0.54, 0.46), clad, bayRes);
    // buttress: 240 m wide at the start of each bay, its flanks shaded by the way they face
    float bq = mod(u, 3.0);
    float butt = fPulse(u, 3.0, 0.0, 0.24, fu) * vert;
    float flankRes = (1.0 - smoothstep(0.012, 0.05, fu)) * vert;
    float flL = (1.0 - smoothstep(0.0, 0.02, bq)) * flankRes, flR = (1.0 - smoothstep(0.0, 0.02, 0.24 - bq)) * flankRes * step(bq, 0.24);
    vec3 Nb = normalize(N * 0.35 - Tr * flL + Tr * flR);
    float ndlW = max(dot(Nb, uSunDir), 0.0);
    // ---- inboard: decks, slabs, gardens, blocks, wells, cascades
    float dq = fPulse(hk, 0.16, 0.012, 0.13, fh);            // the glazed storeys of each deck
    float slab = fPulse(hk, 0.16, 0.13, 0.148, fh);
    float garden = fPulse(hk, 0.16, 0.148, 0.16, fh) * step(0.16, hk);
    float blockM = fPulse(u, 0.5, 0.015, 0.485, fu);         // blocks, and the 30 m wells between
    float bi = floor(u / 0.5);
    float hbk = hash12(vec2(bi, 3.0) + uSeed);
    float glassBlk = mix(0.38, step(0.62, hbk), 1.0 - smoothstep(0.12, 0.4, fu));
    float cascade = step(abs(mod(bi, 3.0) - 1.0), 0.5) * fPulse(u, 0.5, 0.241, 0.259, fu) * step(0.16, hk) * step(hk, 2.07);
    vec3 glassC = vec3(0.07, 0.09, 0.1);
    vec3 face = mix(clad * 0.92, glassC, glassBlk);
    vec3 innerC = mix(clad * 0.85, face, dq);
    innerC = mix(innerC, clad * 1.08, slab);
    innerC = mix(innerC, vec3(0.08, 0.17, 0.05), garden);
    innerC = mix(vec3(0.05, 0.055, 0.06), innerC, blockM);  // the wells, in shadow
    innerC = mix(innerC, vec3(0.62, 0.72, 0.76), cascade);
    float innerGlaze = dq * blockM * mix(0.35, 1.0, glassBlk) * (1.0 - cascade);
    // ---- outboard: radiators between the bays, conduits, bay mouths
    float rad = step(0.3, hk) * step(hk, 1.8);
    float seam = 1.0 - fPulse(u, 0.15, 0.0, 0.146, fu);
    float mouth = fPulse(u, 2.0, 0.9, 1.1, fu) * fPulse(hk, 4.0, 1.42, 1.58, fh);
    float frameB = fPulse(u, 2.0, 0.88, 1.12, fu) * fPulse(hk, 4.0, 1.40, 1.60, fh) - mouth;
    vec3 outerC = mix(clad * 0.7, vec3(0.05, 0.055, 0.065) * (1.0 + 0.6 * seam), rad);
    float cond = fPulse(hk, 4.0, 0.285, 0.295, fh) + fPulse(hk, 4.0, 1.805, 1.815, fh);
    outerC = mix(outerC, vec3(0.5, 0.36, 0.2), clamp(cond + frameB, 0.0, 1.0));
    outerC = mix(outerC, vec3(0.9, 0.7, 0.45), mouth);
    // ---- together: buttress, plinth and its contact shadow, crest parapet
    vec3 alb = mix(clad, innerC, inner);
    alb = mix(alb, outerC, outer);
    alb = mix(alb, clad * 0.8, butt * (1.0 - cascade));
    float plinth = (1.0 - smoothstep(0.14, 0.2, hk)) * vert;
    alb = mix(alb, clad * 0.4, plinth);
    alb *= 1.0 - 0.45 * inner * (1.0 - smoothstep(0.0, 0.35, hk));          // the deck's shade at the foot
    alb *= 1.0 - 0.3 * vert * smoothstep(wallH - 0.1, wallH - 0.04, hk);      // under the parapet
    float crest = smoothstep(wallH - 0.1, wallH - 0.05, hk) * vert + (1.0 - vert);
    float rails = (1.0 - vert) * (fPulse(u, 0.25, 0.0, 0.004, fu) * 0.3 + 0.2);
    alb = mix(alb, vec3(0.5, 0.36, 0.2), clamp(crest * (1.0 - butt) * 0.8 + rails, 0.0, 1.0));
    float glaze = innerGlaze * (1.0 - butt);
    float spec = mix(0.4, 1.4, glaze + rad * outer * 0.6);
    col = alb / 3.14159 * (sunL * mix(ndl, ndlW, max(flL, flR)) + earthshine * 2.0);
    col += min(sunL * pow(max(dot(N, H), 0.0), mix(70.0, 200.0, glaze)) * spec, sunL * 0.6);
    // lit rooms behind the glazing: neighbourhoods a shade apart, warmer and fuller at night
    float room = hash12(floor(vec2(u / 0.03, hk / 0.16)) + uSeed);
    float hood = hash12(floor(vec2(u / 4.0, hk / 1.2)) + uSeed * 3.1);
    float rl = 1.0 - smoothstep(0.012, 0.04, fwk);
    float lit = mix(0.42, step(0.52, room) * (0.6 + 0.8 * hood), rl);
    vec3 roomC = mix(vec3(1.0), mix(vec3(1.05, 0.9, 0.75), vec3(0.75, 0.88, 1.2), step(0.8, fract(room * 7.7))), rl);
    roomC = mix(roomC, vec3(1.2, 0.7, 0.85), step(0.96, fract(room * 3.3)) * rl);
    em += uHabitatColor * roomC * glaze * lit * (0.05 + 0.3 * nightSide);
    // pergola lamps along the gardens, the cascades' cool glow, the wells' lift shafts with cars
    em += vec3(1.0, 0.78, 0.5) * garden * inner * blockM * (0.02 + 0.2 * nightSide);
    em += vec3(0.35, 0.6, 0.7) * cascade * inner * (0.05 + 0.15 * nightSide);
    float shaftL = fPulse(u, 0.5, 0.494, 0.506, fu) * inner * step(0.05, hk) * (1.0 - crest);
    float car = mix(0.25, smoothstep(0.9, 1.0, fract(hk / 0.6 - uTime * 0.05 + hash12(vec2(floor(u / 0.5), uSeed)))), 1.0 - smoothstep(0.02, 0.06, fh));
    em += vec3(0.85, 0.93, 1.0) * shaftL * (0.12 + 0.6 * car) * (0.3 + 0.7 * nightSide);
    // the bays' lit mouths and the buttresses' lift slots
    em += vec3(1.0, 0.75, 0.45) * mouth * outer * (0.35 + 0.8 * nightSide);
    em += vec3(1.0, 0.74, 0.46) * fPulse(u, 3.0, 0.115, 0.125, fu) * vert * step(0.2, hk) * (1.0 - crest) * (0.1 + 0.5 * nightSide);
    float stripe = 1.0 - smoothstep(0.0, 0.06, abs(v - 0.9));
    em += uHabitatColor * stripe * 0.2 * (1.0 - butt * 0.5);
    // small marker lamps every 25 km, filtered so they never shrink below their energy
    float md = abs(fract(u / 25.0 + 0.5) - 0.5) * 25.0;
    float mw = 0.12;
    float marker = clamp(1.0 - md / max(mw, fu), 0.0, 1.0) * min(1.0, mw / fu);
    em += vec3(1.0, 0.45, 0.3) * marker * stripe * (0.75 + 0.25 * sin(uTime * 0.8 + floor(u / 25.0) * 1.7)) * 1.4;
  } else {
    // ---- rotor tubes: the mass stream that holds the ring up ----
    vec3 alb = uAlbedo * 0.6;
    col = alb / 3.14159 * (sunL * ndl + earthshine * 2.0);
    float rp = fract(u / 37.0 - uTime * 0.25 * uSpeed * sign(v)) - 0.5;
    float pulse = mix(0.13, exp(-rp * rp * 180.0), 1.0 - smoothstep(0.5, 1.5, fu));
    float rim = pow(max(1.0 - abs(dot(N, V)), 0.0), 2.0);
    em += uStreamColor * (0.12 + 1.2 * pulse + 0.3 * rim);
  }
  gl_FragColor = vec4(col + em, 1.0);
}
`;

export function buildRing(def, basis, segs, roof = false) {
  const { a, b, n, R } = basis;
  const w = def.width;
  const hw = w / 2;
  const wall = Math.max(1.2, w * 0.07);
  const tubeR = w * 0.035;
  const wt = Math.max(0.15, w * 0.012);
  // profile: [s (axial km), dr (radial km), ns, nr (normal in s/r plane), v, part]
  const floor = [];
  const NF = 16;
  for (let i = 0; i <= NF; i++) {
    const t = i / NF - 0.5;
    floor.push([t * (w + 2 * wt), -0.004 * w * (1 - 4 * t * t), 0, 1, t, 0]);
  }
  const floorBack = floor.map(([s,dr,,,v,part]) => [s,dr-0.4,0,-1,v,part]);
  const floorEdges = [-1,1].map(sd => [[sd*(hw+wt),0,sd,0,sd*.5,0],[sd*(hw+wt),-0.4,sd,0,sd*.5,0]]);
  // retaining walls as solid slabs: inner face, top, outer face and foot (each its own strip
  // so the corners stay sharp); a single sheet showed the walls paper-thin edge-on
  const wallL = [[-hw, -0.06, 1, 0, 0.0, 1], [-hw, wall, 1, 0, 1.0, 1]];
  const wallR = [[hw, wall, -1, 0, 1.0, 1], [hw, -0.06, -1, 0, 0.0, 1]];
  const slabs = [];
  for (const sd of [-1, 1]) {
    const si = sd * hw, so = sd * (hw + wt);
    slabs.push([[si, wall, 0, 1, 1.0, 1], [so, wall, 0, 1, 1.0, 1]]);
    slabs.push([[so, wall, sd, 0, 1.0, 1], [so, -0.06, sd, 0, 0.0, 1]]);
    slabs.push([[so, -0.06, 0, -1, 0.0, 1], [si, -0.06, 0, -1, 0.0, 1]]);
  }
  // glass roof: a flat-topped vault from wall top to wall top (clear of the port stations'
  // masts), normals from the section's own tangent
  const roofP = [];
  const NR = 24, rise = w * 0.085;
  const rf = (t) => wall + rise * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(2 * t), 4)));
  for (let i = 0; i <= NR; i++) {
    const t = i / NR - 0.5;
    const e = 0.5 / NR;
    const ta = Math.max(-0.5, t - e), tb = Math.min(0.5, t + e);
    let ds = (tb - ta) * w, dd = rf(tb) - rf(ta);
    const l = Math.hypot(ds, dd) || 1;
    roofP.push([t * w, rf(t), -dd / l, ds / l, t, 3]);
  }
  const tubes = [];
  for (const side of [-1, 1]) {
    const tube = [];
    for (let k = 0; k <= 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const sx = side * (hw + tubeR * 0.6) + Math.cos(ang) * tubeR;
      tube.push([sx, -tubeR * 1.4 + Math.sin(ang) * tubeR, Math.cos(ang), Math.sin(ang), sx / w, 2]);
    }
    tubes.push(tube);
  }
  const profiles = roof ? [roofP] : [floor, floorBack, ...floorEdges, wallL, wallR, ...slabs, ...tubes];
  const angles = Array.from({length:segs+1},(_,i)=>i/segs*Math.PI*2);
  const jDir = bodyDir(0,MERIDIAN_LON);
  const junctionAngle = ((Math.atan2(jDir.dot(b),jDir.dot(a)) % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
  if (roof && def.name === 'Halo') {
    for (const x of [-2.52,2.52]) angles.push(junctionAngle+x/R);
    angles.sort((x,y)=>x-y); segs=angles.length-1;
  }
  const pos = [], nor = [], ring = [], idx = [];
  const P = new THREE.Vector3(), rad = new THREE.Vector3(), tan = new THREE.Vector3();
  for (const prof of profiles) {
    const base = pos.length / 3;
    const M = prof.length;
    for (let j = 0; j <= segs; j++) {
      const th = angles[j];
      rad.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
      for (const [s, dr, ns, nr, v, part] of prof) {
        P.copy(rad).multiplyScalar(R + dr).addScaledVector(n, s);
        pos.push(P.x, P.y, P.z);
        tan.copy(rad).multiplyScalar(nr).addScaledVector(n, ns).normalize();
        nor.push(tan.x, tan.y, tan.z);
        ring.push(th * R, v, part);
      }
    }
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < M - 1; i++) {
        if (roof && def.name === 'Halo' && Math.abs(((angles[j]+angles[j+1])/2-junctionAngle)*R)<2.52 && Math.abs((prof[i][0]+prof[i+1][0])/2)<2.67) continue;
        const i0 = base + j * M + i, i1 = i0 + M, i2 = i0 + 1, i3 = i1 + 1;
        idx.push(i0, i1, i2, i2, i1, i3);
      }
    }
  }
  // make every triangle wind counter-clockwise when seen from its normal side
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let k = 0; k < idx.length; k += 3) {
    const [i0, i1, i2] = [idx[k], idx[k + 1], idx[k + 2]];
    vA.fromArray(pos, i0 * 3); vB.fromArray(pos, i1 * 3); vC.fromArray(pos, i2 * 3);
    vB.sub(vA); vC.sub(vA);
    nn.crossVectors(vB, vC);
    const dn = nn.x * (nor[i0 * 3] + nor[i1 * 3]) + nn.y * (nor[i0 * 3 + 1] + nor[i1 * 3 + 1]) + nn.z * (nor[i0 * 3 + 2] + nor[i1 * 3 + 2]);
    if (dn < 0) { idx[k + 1] = i2; idx[k + 2] = i1; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R + wall + rise + 5);
  return g;
}

// ------------------------------------------------------------ hub arches ----
// The Halo's vault is carried at every hub (140 km) by a great arch: a plated rib that stands
// on a corbel on each wall crest, rises clear of the glass and follows the vault 360 m above
// it, banded in bronze. Built once in km (local x across the ring, y up from the deck, z along
// it) and instanced round the ring; hubs within reach of a port station or the foundry are
// left open. Kinds map the craft builder onto the station material.
export function haloArchProfile(def) {
  const w = def.width, hw = w / 2, wall = Math.max(1.2, w * 0.07), wt = Math.max(0.15, w * 0.012), rise = w * 0.085;
  const rf = (sAx) => wall + rise * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(2 * sAx / w), 4)));
  const leg = hw + wt * 0.78, r = 0.16, clear = 0.42;
  const half = [[leg, wall + 0.2], [leg, wall + 1.1], [leg - 0.25, wall + 1.7], [leg - 0.9, wall + 1.96]];
  const pts = [];
  for (const [x, y] of half) pts.push([x, y]);
  for (let x = hw - 1.5; x >= -(hw - 1.5) - 1e-9; x -= (Math.abs(x) > hw - 5 ? 0.25 : 0.5)) pts.push([x, rf(x) + clear]);
  for (const [x, y] of half.slice().reverse()) pts.push([-x, y]);
  return { pts, rf, wall, hw, wt, leg, r, clear, crest: rf(0) + clear + r };
}
export function buildHaloArch(def) {
  const P = haloArchProfile(def);
  // a box girder swept along the arch: 0.9 km along the ring, 0.32 km deep. Its back plated,
  // the faces seen along the ring glazed, the soffit over the glass dark. Closed by end caps
  // buried in the corbels.
  const W = 0.9, D = 0.32;
  // tapered section: 1.0 km across at the soffit, 0.56 km across the back, so the glazed flanks
  // lean 34 degrees toward space and catch the sunlight that falls on the vault
  const half = (v) => (v > 0 ? 0.5 : 0.28);
  const pos = [], nor = [], kind = [], idx = [];
  const pts = P.pts.map(([x, y]) => new THREE.Vector2(x, y));
  const nrm = pts.map((p, i) => {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
    const t = b.clone().sub(a).normalize();
    return new THREE.Vector2(-t.y, t.x);            // left of the path: up over the crest
  });
  const quadStrip = (corner, normalFn, k) => {
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) for (const c of corner) {
      const [u, v] = c, p = pts[i], n = nrm[i];
      pos.push(p.x + n.x * v * D / 2, p.y + n.y * v * D / 2, u * half(v));
      const nn = normalFn(i); nor.push(nn[0], nn[1], nn[2]); kind.push(k);
    }
    for (let i = 0; i < pts.length - 1; i++) { const a0 = base + i * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3; idx.push(a0, b0, a1, a1, b0, b1); }
  };
  // (the path runs from +x to -x, so its left normal points down, into the vault)
  quadStrip([[-1, 1], [1, 1]], (i) => [nrm[i].x, nrm[i].y, 0], KIND.TRUSS);          // soffit, over the glass
  quadStrip([[1, -1], [-1, -1]], (i) => [-nrm[i].x, -nrm[i].y, 0], KIND.PLATE);      // plated back, facing space
  // the faces seen along the ring are inhabited: galleries of windows looking down the vault
  // (bare metal there read black, mirroring empty space)
  const flank = (i, sz) => { const lean = half(1) - half(-1), l = Math.hypot(lean, D); return [-nrm[i].x * lean / l, -nrm[i].y * lean / l, sz * D / l]; };
  quadStrip([[1, 1], [1, -1]], (i) => flank(i, 1), KIND.HAB);                          // +z flank
  quadStrip([[-1, -1], [-1, 1]], (i) => flank(i, -1), KIND.HAB);                       // -z flank
  for (const [i, sgn] of [[0, -1], [pts.length - 1, 1]]) {
    const p = pts[i], n = nrm[i], t = new THREE.Vector2(n.y, -n.x).multiplyScalar(sgn);
    const base = pos.length / 3;
    for (const [u, v] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) { pos.push(p.x + n.x * v * D / 2, p.y + n.y * v * D / 2, u * half(v)); nor.push(t.x, t.y, 0); kind.push(KIND.PLATE); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // wind every triangle to face its normal
  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
  for (let k = 0; k < idx.length; k += 3) {
    A.fromArray(pos, idx[k] * 3); Bv.fromArray(pos, idx[k + 1] * 3); C.fromArray(pos, idx[k + 2] * 3);
    N.crossVectors(Bv.sub(A), C.sub(A));
    if (N.x * nor[idx[k] * 3] + N.y * nor[idx[k] * 3 + 1] + N.z * nor[idx[k] * 3 + 2] < 0) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute('aSurface', new THREE.Float32BufferAttribute(new Float32Array(kind.length * 2), 2));
  g.setIndex(idx);
  // corbels on the wall crests (outboard of the glass, cantilevered past the wall's outer face)
  const parts = [g];
  for (const sd of [-1, 1]) {
    const c = new THREE.BoxGeometry(0.56, 0.3, 1.1).translate(sd * P.leg, P.wall + 0.15, 0).toNonIndexed();
    c.deleteAttribute('uv');
    c.setAttribute('aKind', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count).fill(KIND.PLATE), 1));
    c.setAttribute('aSurface', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2));
    parts.push(c);
  }
  const geo = mergeGeometries(parts.map((q) => (q.index ? q.toNonIndexed() : q)), false);
  geo.computeBoundingSphere();
  // lamps along both upper edges of the crest, and on the corbels (arch-local km)
  const lamps = [];
  for (const x of [-12, -6, 0, 6, 12]) for (const z of [-W / 2, W / 2]) lamps.push({ x, y: P.rf(x) + P.clear + D / 2 + 0.04, z });
  for (const sd of [-1, 1]) lamps.push({ x: sd * P.leg, y: P.wall + 0.36, z: 0 });
  return { geo, lamps, profile: { ...P, crest: P.rf(0) + P.clear + D / 2, depth: D, girder: W } };
}

/** Hub angles round a ring (u = R th), skipping hubs near the given exclusion directions. */
export function haloArchAngles(def, basis, exclude) {
  const R = basis.R, n = Math.floor((2 * Math.PI * R) / def.hub);
  const out = [];
  for (let k = 0; k < n; k++) {
    const th = (def.hub * (k + 0.5)) / R;
    const dir = basis.a.clone().multiplyScalar(Math.cos(th)).addScaledVector(basis.b, Math.sin(th));
    if (exclude.some(([d, km]) => Math.acos(THREE.MathUtils.clamp(dir.dot(d), -1, 1)) * R < km)) continue;
    out.push(th);
  }
  return out;
}

const FAR_FRAG = /* glsl */ `
uniform vec3 uAlb;
uniform vec3 uHab;
uniform vec3 uStream;
uniform float uHubKm;
uniform float uGlass;
// lamps every P km, w km long, their energy kept once they are under a pixel (no popping)
float farLamp(float x, float P, float w, float fw) {
  float d = abs(fract(x / P + 0.5) - 0.5) * P;
  float W = max(w, fw);
  return clamp(1.0 - d / W, 0.0, 1.0) * min(1.0, w / fw);
}
float farHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  vec3 sunL = spaceSunlight(uTransmittanceLUT, vWorld, uSunDir) * uSunE;
  vec3 rhat = normalize(vWorld);
  float night = 1.0 - smoothstep(-0.05, 0.1, dot(rhat, uSunDir));
  vec3 V = normalize(cameraPosition - vWorld);
  float face = 0.3 + 0.5 * abs(dot(V, rhat));
  float along = vData.x;
  float fw = max(fwidth(along), 1e-3);
  vec3 col = uAlb * 0.3 * sunL * face + uHab * (0.05 + 0.2 * night) + uStream * 0.06;
  // what still reads from Earth orbit: the hub cities under their arches (a bead of light every
  // hub), the river towns between them, the lit wall crests; and by day the vault glass
  // throwing the Sun back in flashes that run along the band as the view moves
  float hubs = farLamp(along - 0.5 * uHubKm, uHubKm, 7.0, fw);
  float towns = farLamp(along, uHubKm * 0.25, 2.2, fw) * (1.0 - hubs);
  vec3 warm = vec3(1.0, 0.7, 0.42);
  col += warm * (hubs * 1.6 + towns * 0.5) * (0.12 + 0.9 * night);
  // the districts between them: the whole ring is lived in, so by night the band is a
  // continuous thread of city light, brighter and dimmer by district (40 km stretches, their
  // mean kept once a stretch is under a few pixels); by day a faint warm cast over the glass
  float stretch = mix(0.9, 0.45 + 0.9 * farHash(floor(along / 40.0) + 7.0 * uGlass), 1.0 - smoothstep(10.0, 40.0, fw));
  col += warm * stretch * (0.004 + 0.1 * night) * (1.0 - hubs);          // (the deck's own mean, for a clean hand-over)
  col += vec3(1.0, 0.45, 0.3) * farLamp(along, 25.0, 0.12, fw) * 0.8;               // crest markers
  vec3 H = normalize(V + uSunDir);
  float nh = max(dot(rhat, H), 0.0);
  float seg = floor(along / 6.0);
  float flash = step(0.55, farHash(seg + uGlass)) * (0.6 + 0.8 * farHash(seg * 1.7 + 3.1));
  float cell = 1.0 - smoothstep(0.5, 3.0, fw / 6.0);                                  // flashes only while 6 km spans a few px
  col += sunL * uGlass * (pow(nh, 900.0) * mix(1.0, flash * 2.0, cell) * 0.35 + pow(nh, 60.0) * 0.012) * (1.0 - night);
  float fade = 1.0 - smoothstep(1.6, 3.2, vPx);
  gl_FragColor = vec4(col * vCoverage * fade, 0.0);
}
`;

const TETHER_FRAG = /* glsl */ `
uniform vec3 uColor;
float aaBand(float x, float P, float w) {
  // lamps every P km, w km long: a filtered band whose energy stays constant once it is
  // thinner than a pixel, so beacons never pop in and out as the view moves
  float d = abs(fract(x / P + 0.5) - 0.5) * P;
  float fw = max(fwidth(x), 1e-5);
  float W = max(w, fw);
  return clamp(1.0 - d / W, 0.0, 1.0) * min(1.0, w / fw);
}
void main() {
  vec3 sunL = spaceSunlight(uTransmittanceLUT, vWorld, uSunDir) * uSunE;
  float alt = vData.x;
  float x = clamp(vAcross, -1.0, 1.0);
  float cyl = sqrt(max(1.0 - x * x, 0.0));
  float spec = exp(-((x - 0.35) * 5.0) * ((x - 0.35) * 5.0));
  vec3 col = vec3(0.55, 0.58, 0.62) * sunL * (0.03 + 0.04 * cyl + 0.035 * spec) + vec3(0.02, 0.03, 0.05) * (0.5 + 0.5 * cyl);
  float beacon = aaBand(alt, 40.0, 0.12) * (0.75 + 0.25 * sin(uTime * 1.5 + alt));
  // climber pulses run on real time (in sim time they raced up the cable at warp)
  float climb = aaBand(alt + uTime * 0.6 - vData.y * 28.0, 90.0, 0.4);
  col += uColor * beacon * 1.2 + vec3(0.8, 0.9, 1.0) * climb * 3.0 * cyl;
  float fade = smoothstep(0.0, 12.0, alt) * (1.0 - smoothstep(560.0, 618.0, alt) * 0.5);
  gl_FragColor = vec4(col * vCoverage * fade, 0.0);
}
`;

export class Rings {
  constructor(space, q) {
    this.space = space;
    this.group = new THREE.Group();
    this.meshes = [];
    this.roofs = [];
    this.far = [];
    this.defs = RINGS;
    this.bases = RINGS.map(ringBasis);
    RINGS.forEach((def, i) => {
      const basis = this.bases[i];
      const segs = Math.round((def.name === 'Halo' ? 4096 : 2560) * q.ringSegs);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          uTransmittanceLUT: U.uTransmittanceLUT, uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunE: U.uSunIlluminance,
          uTime: { value: 0 }, uSimT: { value: 0 },
          uAlbedo: { value: new THREE.Color(...def.albedo) },
          uHabitatColor: { value: new THREE.Color(...def.habitat) },
          uStreamColor: { value: new THREE.Color(...def.stream) },
          uHub: { value: def.hub }, uSpeed: { value: def.speed }, uSeed: { value: i * 17.3 + 3.1 },
          uWidth: { value: def.width }, uLen: { value: basis.R * Math.PI * 2 },
          uResolution: { value: new THREE.Vector2(1920, 1080) }, uAxisBody: { value: basis.n.clone() },
        },
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(buildRing(def, basis, segs), mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.userData.def = def;
      this.meshes.push(mesh);
      this.group.add(mesh);
      // the glass vault: its own premultiplied, depth-tested (not depth-writing) mesh
      // (uniform objects shared with the deck, so update() and setSize() drive both)
      const roofMat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...mat.uniforms }, defines: { ROOF: 1 },
        side: THREE.DoubleSide, transparent: true, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const roofMesh = new THREE.Mesh(buildRing(def, basis, Math.round(segs / 2), true), roofMat);
      roofMesh.frustumCulled = false;
      roofMesh.renderOrder = 3;
      this.roofs.push(roofMesh);
      this.group.add(roofMesh);
      // far-field ribbon (smooth line when the band is thinner than a couple of pixels)
      const pts = [], along = [];
      const NP = 1440;
      for (let k = 0; k <= NP; k++) {
        const th = (k / NP) * Math.PI * 2;
        pts.push(basis.a.clone().multiplyScalar(Math.cos(th)).addScaledVector(basis.b, Math.sin(th)).multiplyScalar(basis.R));
        along.push(th * basis.R);
      }
      const fm = createRibbonMaterial({ widthKm: def.width, minPx: 1.0, frag: FAR_FRAG, uniforms: {
        uAlb: { value: new THREE.Color(...def.albedo) }, uHab: { value: new THREE.Color(...def.habitat) }, uStream: { value: new THREE.Color(...def.stream) },
        uHubKm: { value: def.hub }, uGlass: { value: 1.0 },
      } });
      const far = new THREE.Mesh(buildRibbonGeometry([{ pts, along, id: i }]), fm);
      far.frustumCulled = false;
      far.renderOrder = 11;
      far.userData.axis = basis.n.clone();
      this.far.push(far);
      this.group.add(far);
    });
    // tethers hanging from the Halo to the equatorial ports (Meridian's main tether is separate)
    const lines = [];
    const halo = this.bases[0];
    let id = 0;
    for (const port of HALO_PORTS) {
      if (port.name === 'Meridian') continue;
      const lon = THREE.MathUtils.degToRad(port.lon);
      for (const off of [-9, 0, 9]) {
        const dir = bodyDir(0, lon + off / (R_EARTH + 620));
        const pts = [], along = [];
        for (let h = 0; h <= 620; h += 10) { pts.push(dir.clone().multiplyScalar(R_EARTH + h)); along.push(h); }
        lines.push({ pts, along, id: id++ });
      }
    }
    // the Halo's hub arches (instanced), and their crest lamps
    {
      const def = RINGS[0], basis = this.bases[0];
      const arch = buildHaloArch(def);
      const nauru = bodyDir(0, THREE.MathUtils.degToRad(166.9));
      const exclude = [...HALO_PORTS.map((p) => [bodyDir(0, THREE.MathUtils.degToRad(p.lon)), 32]), [bodyDir(0, THREE.MathUtils.degToRad(166.9) + 0.009), 12], [nauru, 32]];
      const angles = haloArchAngles(def, basis, exclude);
      this.archMat = createHullMaterial({ pattern: 0.08, accent: [1.0, 0.72, 0.45] });
      this.archMat.defines = { INSTANCE_SIZE: arch.profile.crest.toFixed(3) };
      const im = new THREE.InstancedMesh(arch.geo, this.archMat, angles.length);
      this.archAll = [];
      const m = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
      const lamps = [];
      angles.forEach((th, i) => {
        Y.copy(basis.a).multiplyScalar(Math.cos(th)).addScaledVector(basis.b, Math.sin(th));
        Z.copy(basis.a).multiplyScalar(-Math.sin(th)).addScaledVector(basis.b, Math.cos(th));
        X.crossVectors(Y, Z);
        // local x must run along the ring's axis n (X = Y x Z is +/- n)
        m.makeBasis(X, Y, Z).setPosition(Y.clone().multiplyScalar(basis.R));
        im.setMatrixAt(i, m);
        this.archAll.push({ m: m.clone(), c: Y.clone().multiplyScalar(basis.R + 3) });
        for (const l of arch.lamps) lamps.push({ p: new THREE.Vector3(l.x, l.y, l.z).applyMatrix4(m), r: 0.1, color: l.y > 4 ? LAMP.WHITE : LAMP.AMBER, i: 2.6, breathe: 0.2, phase: (i * 0.37) % 1 });
      });
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      im.renderOrder = 3;
      this.arches = im;
      this.archAngles = angles;
      this.archData = arch;
      this.group.add(im);
      this.archLamps = createLamps(lamps, { minPx: 1.2 });
      this.group.add(this.archLamps);
    }
    this.tetherMat = createRibbonMaterial({ widthKm: 0.02, minPx: 1.1, frag: TETHER_FRAG, uniforms: { uColor: { value: new THREE.Color(1.0, 0.75, 0.45) } } });
    this.tethers = new THREE.Mesh(buildRibbonGeometry(lines), this.tetherMat);
    this.tethers.frustumCulled = false;
    this.tethers.renderOrder = 12;
    this.group.add(this.tethers);
    // the Halo's districts, docks, gantries and traffic within reach (src/space/haloDistricts.js):
    // their own anchor and depth slice under the Earth-fixed frame, built on first approach
    if (space && space.earthFixed && space.addBody) this.districts = new HaloDistricts(space, this);
    // the Halo's deck paints the districts' own plan (known before any of them is built)
    if (this.districts) {
      const D = this.districts, m = this.meshes[0].material, def = RINGS[0];
      const pu = { uPlanCells: { value: D.plan.cells }, uPlanTiles: { value: D.plan.tiles }, uPlan: { value: new THREE.Vector4(D.seamK, D.seamLen / 1000, D.nTiles, def.width + 2 * Math.max(0.15, def.width * 0.012)) } };
      Object.assign(m.uniforms, pu);
      Object.assign(this.roofs[0].material.uniforms, pu);          // (declared in the shared source; unused under the glass)
      m.defines = { ...(m.defines || {}), HALO_CELLS: 1 };
      m.needsUpdate = true;
    }
  }

  setSize(w, h) {
    if (this.archMat) this.archMat.uniforms.uResY.value = h;
    this.tetherMat.uniforms.uResolution.value.set(w, h);
    for (const m of this.meshes) m.material.uniforms.uResolution.value.set(w, h);
    for (const f of this.far) f.material.uniforms.uResolution.value.set(w, h);
  }

  update(sim, realTime, dt, space) {
    for (const m of this.meshes) {
      const u = m.material.uniforms;
      u.uSunDir.value.copy(sim.sunDir);
      u.uTime.value = realTime;
      u.uSimT.value = sim.t % 1e6;
    }
    const tu = this.tetherMat.uniforms;
    tu.uSunDir.value.copy(sim.sunDir); tu.uTime.value = realTime; tu.uSimT.value = sim.t % 1e6;
    if (this.archMat) {
      const au = this.archMat.uniforms; au.uSunDir.value.copy(sim.sunDir); au.uTime.value = realTime; au.uEarthPos.value.set(0, 0, 0);
      // only the arches that can cover a pixel or two are submitted (camera in the body frame)
      if (space && space.camera) {
        const cam = this._archCam || (this._archCam = new THREE.Vector3());
        const iq = this._archQ || (this._archQ = new THREE.Quaternion());
        cam.copy(space.camera.position).applyQuaternion(iq.copy(sim.earthQuat).invert());
        const reach = this.archData.profile.crest * (space.size.y * 0.5) / Math.tan(THREE.MathUtils.degToRad(space.camera.fov) * 0.5) / 1.5;
        let n = 0;
        for (const a of this.archAll) if (a.c.distanceToSquared(cam) < reach * reach) this.arches.setMatrixAt(n++, a.m);
        if (n !== this.arches.count || n) { this.arches.count = n; this.arches.instanceMatrix.needsUpdate = true; }
      }
    }
    if (this.districts) this.districts.update(sim, realTime, dt, space);
    for (const f of this.far) {
      const fu = f.material.uniforms;
      fu.uSunDir.value.copy(sim.sunDir); fu.uTime.value = realTime;
      fu.uBandAxis.value.copy(f.userData.axis).applyQuaternion(sim.earthQuat);
    }
  }

  /** Uniform data for the Earth shader's ring shadows (inertial axes). */
  shadowUniforms(sim, outN, outW) {
    this.bases.forEach((b, i) => {
      const n = b.n.clone().applyQuaternion(sim.earthQuat);
      outN[i].set(n.x, n.y, n.z, b.R);
      outW[i].set(this.defs[i].width / 2, 0.92, 0, 0);
    });
  }
}
