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
void main() {
  vRing = aRing;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
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
${SUNLIGHT_GLSL}
${NOISE_GLSL}
${FACADE_GLSL}

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
  float rib = (1.0 - fPulse(u, 2.0, 0.0, 1.94, fk)) * mix(0.3, 1.0, ribFade);
  float mull = (1.0 - fPulse(v * uWidth + 1.0, 2.0, 0.0, 1.965, fk)) * (1.0 - smoothstep(0.02, 0.07, fk));
  float frame = max(rib, mull * 0.5);
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float Fg = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  float nh = max(dot(N, H), 0.0);
  vec3 glint = min(sunL * (pow(nh, 400.0) * 1.6 + pow(nh, 40.0) * 0.05) * Fg, sunL * 0.5);
  vec3 sky = vec3(0.02, 0.03, 0.05) * uSunE * 0.05 * Fg + earthshine * 0.3 * Fg;
  vec3 frameC = uAlbedo * 0.7 / 3.14159 * (sunL * ndl + earthshine * 2.0) + min(sunL * pow(nh, 60.0) * 0.3, sunL * 0.4);
  frameC += uHabitatColor * (0.02 + 0.06 * nightSide) * rib;      // the ribs' own faint lamps
  float glassA = 0.05 + 0.5 * Fg;
  // premultiplied: frame opaque, glass a thin tint that reflects the sky and the Sun
  gl_FragColor = vec4(mix(glint + sky, frameC, frame), mix(glassA, 1.0, frame));
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
      vec3 diff = alb / 3.14159 * sunL * ndl;
      // water: a bounded glint (the glass roof carries its own)
      float spec = pow(max(dot(N, H), 0.0), 80.0) * 0.45 + pow(max(dot(N, H), 0.0), 20.0) * 0.06;
      float F = 0.04 + 0.96 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
      col = diff + min(sunL * spec * F * (0.1 + 0.9 * water), sunL * 0.6);
      col += vec3(0.02, 0.03, 0.05) * F * uSunE * 0.05;
      // lights: lit rooms in the towns, lamps along the boulevards, the quays and both river banks
      float urban = max(max(town, wallT), ringQ);
      float cell = hash12(floor(vec2(u / 0.35, vk / 0.35)));
      float lit = mix(0.24, step(0.55, cell) * (0.5 + cell), dL);
      em += uHabitatColor * urban * lit * (0.08 + 0.22 * nightSide) * (1.0 - water);
      float banks = aaBand(abs(dr) - rw - 0.05, 0.02, aa) * (1.0 - wallT) * (1.0 - basin);
      em += uHabitatColor * (max(max(boul, rings2), avenue * 0.7) * (0.12 + 0.5 * nightSide) + quay * (0.3 + 0.9 * nightSide) + banks * (0.12 + 0.7 * nightSide));
      em += uHabitatColor * island * aaDisc(rH, 0.3, aa) * (0.25 + 0.6 * nightSide);
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
    // ---- retaining walls: an inhabited terrace city two kilometres high. Galleries every
    //      280 m of height behind glazed bands, piers every 120 m, a buttress every 3 km, a
    //      plinth of dark service decks at the foot and a bronze parapet along the crest.
    //      Every order falls to its exact mean while its cell still spans ~3 px. ----
    float wallH = max(1.2, uWidth * 0.07);
    float hk = v * wallH;                                  // height above the deck, km
    float vert = 1.0 - abs(dot(N, rhat));                  // 1 on the faces, 0 on the crest
    float fh = max(fwidth(hk), 1e-5);
    float fwk = max(fu, fh);
    vec3 alb = uAlbedo * 1.1;
    float rib = 1.0 - fPulse(u, 3.0, 0.0, 2.76, fk);
    float band = fPulse(hk, 0.28, 0.14, 0.24, fh) * step(0.2, hk) * (1.0 - step(wallH - 0.12, hk));
    float pier = 1.0 - fPulse(u, 0.12, 0.0, 0.1, fu);
    float glaze = band * (1.0 - pier) * vert;
    float plinth = (1.0 - smoothstep(0.14, 0.2, hk)) * vert;
    float crest = smoothstep(wallH - 0.1, wallH - 0.05, hk) * vert;
    alb *= 1.0 - 0.3 * rib;
    alb = mix(alb, vec3(0.05, 0.06, 0.07), glaze * 0.85);
    alb = mix(alb, uAlbedo * 0.45, plinth);
    alb = mix(alb, vec3(0.5, 0.36, 0.2), crest * (1.0 - rib));
    float spec = mix(0.5, 1.4, glaze);
    col = alb / 3.14159 * (sunL * ndl + earthshine * 2.0);
    col += min(sunL * pow(max(dot(N, H), 0.0), mix(70.0, 200.0, glaze)) * spec, sunL * 0.6);
    // lit rooms behind the glazing: neighbourhoods a shade apart, warmer and fuller at night
    float room = hash12(floor(vec2(u / 0.12, hk / 0.28)) + uSeed);
    float hood = hash12(floor(vec2(u / 4.0, hk / 1.2)) + uSeed * 3.1);
    float rl = 1.0 - smoothstep(0.03, 0.09, fwk);
    float lit = mix(0.42, step(0.52, room) * (0.6 + 0.8 * hood), rl);
    em += uHabitatColor * glaze * lit * (0.05 + 0.3 * nightSide);
    float stripe = 1.0 - smoothstep(0.0, 0.06, abs(v - 0.9));
    em += uHabitatColor * stripe * 0.2;
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
void main() {
  vec3 sunL = spaceSunlight(uTransmittanceLUT, vWorld, uSunDir) * uSunE;
  vec3 rhat = normalize(vWorld);
  float night = 1.0 - smoothstep(-0.05, 0.1, dot(rhat, uSunDir));
  vec3 V = normalize(cameraPosition - vWorld);
  float face = 0.3 + 0.5 * abs(dot(V, rhat));
  vec3 col = uAlb * 0.3 * sunL * face + uHab * (0.05 + 0.2 * night) + uStream * 0.06;
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
