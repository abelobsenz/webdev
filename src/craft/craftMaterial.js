import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { SUNLIGHT_GLSL } from '../space/lines.js';

// Materials for MERIDIAN's craft in the orbital view (km units, far from the origin).
// Projection goes through modelViewMatrix (built in double precision on the CPU) and all
// lighting happens in view space, so a ship parked 42,000 km out is as steady as one at
// the origin. Surface detail comes from the geometry's aFacade coordinates in metres.

const VERT = /* glsl */ `
attribute vec3 aFacade;
varying vec3 vFac;
varying vec3 vView;
varying vec3 vN;
void main() {
  vFac = aFacade;
#ifdef USE_INSTANCING
  // instanced hulls (traffic close-ups): instance matrices are relative to a local origin
  // near the camera, so the composed transform stays small and exact in float32
  vec4 mv = modelViewMatrix * (instanceMatrix * vec4(position, 1.0));
  vN = normalize(normalMatrix * (mat3(instanceMatrix) * normal));
#else
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
#endif
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uTransmittanceLUT;
uniform vec3 uSunView;       // sun direction, view space
uniform vec3 uSunWorld;      // sun direction, world space
uniform vec3 uObjWorld;      // object centre, world km (for the Earth's shadow)
uniform vec3 uEarthView;     // Earth centre, view space km
uniform float uSunE;
uniform float uTime;
uniform vec3 uAccent;
uniform float uLit;          // fraction of windows lit
uniform float uFill;         // bounce light from the craft's own sunlit parts (fraction of the Sun)
uniform float uFlood;        // exterior floodlights, on while the craft is in shadow
varying vec3 vFac;
varying vec3 vView;
varying vec3 vN;
${SUNLIGHT_GLSL}
${NOISE_GLSL}
float gridLine(float x, float p, float w, float fw) { float d = abs(fract(x / p + 0.5) - 0.5) * p; return 1.0 - smoothstep(w, w + fw, d); }
// energy-conserving line (half-width w): thins to its average instead of thickening at range
float cLine(float x, float p, float w, float fw) { float d = abs(fract(x / p + 0.5) - 0.5) * p; return clamp(1.0 - d / max(w, fw), 0.0, 1.0) * min(1.0, w / fw); }
// normal tilt across a bevelled edge: -1 near 0, +1 near L
float cBevel(float l, float L, float w) { return (1.0 - smoothstep(0.0, w, L - l)) - (1.0 - smoothstep(0.0, w, l)); }

// What a glossy surface mirrors out here: black sky, and the Earth where the reflected ray
// meets it (lit where the Sun is up, a thin blue limb of atmosphere). All in view space, km.
vec3 craftEnv(vec3 P, vec3 R, float rough) {
  vec3 oc = P - uEarthView;
  float b = dot(oc, R);
  float c = dot(oc, oc) - 6371.0 * 6371.0;
  float h = b * b - c;
  float dist = length(oc);
  // soft edge: the reflected Earth is blurred by roughness
  float ang = asin(clamp(6371.0 / dist, 0.0, 1.0));
  float cosToC = dot(R, -oc / dist);
  float edge = clamp(rough * 1.6 + 0.004, 0.004, 1.0);
  float disc = smoothstep(cos(ang + edge), cos(max(ang - edge, 0.0)), cosToC);
  vec3 col = vec3(0.0);
  if (disc > 0.0) {
    float t = -b - sqrt(max(h, 0.0));
    vec3 hit = P + R * max(t, 0.0);
    vec3 nE = normalize(h > 0.0 ? hit - uEarthView : P + R * dot(-oc, R) - uEarthView);
    float mu = dot(nE, uSunView);
    float day = smoothstep(-0.08, 0.2, mu);
    vec3 ground = mix(vec3(0.05, 0.12, 0.26), vec3(0.34, 0.38, 0.42), 0.45) * 0.3 * uSunE / 3.14159 * max(mu, 0.0);
    float limb = pow(clamp(1.0 - abs(dot(nE, -R)), 0.0, 1.0), 3.0);
    col = ground + vec3(0.25, 0.45, 1.0) * limb * uSunE * 0.05 * day;
    col *= disc;
  }
  return col;
}

// Kinds added for stations and big hulls (applied after the base palette):
//  13 small conservatory: planted beds under glazing, scaled to public garden rooms
//  12 glass roof over gardens: planted parkland and lit towns seen through glazing on 9 m
//     mullions, with an order of fields, woods and towns that still reads from tens of km
void craftExtraKinds(float k, vec2 f, vec2 fw, float px, inout vec3 alb, inout float rough, inout float metal, inout vec3 em) {
  if (k > 12.5 && k < 13.5) {
    // Small enclosed public gardens use rooms and planted beds, not the kilometre
    // district mask of a liner roof. Keep the planted identity when bays go subpixel.
    float resolved = 1.0-smoothstep(2.5,7.0,px);
    float paths = max(cLine(f.x,18.0,1.1,fw.x),cLine(f.y,24.0,1.2,fw.y));
    float foliage = mix(0.5,vnoise(f*.13)*.6+vnoise(f*.65)*.4,1.0-smoothstep(.7,2.0,px));
    vec3 planted = mix(vec3(.035,.09,.025),vec3(.13,.22,.065),foliage);
    vec3 under = mix(planted,vec3(.29,.27,.21),mix(.18,paths,resolved));
    float mull = mix(.10,max(cLine(f.x,6.0,.15,fw.x),cLine(f.y,6.0,.15,fw.y)),1.0-smoothstep(1.4,3.2,px));
    alb = mix(under,vec3(.53,.55,.49),mull);
    rough = mix(.23,.42,mull);metal=mix(.18,.12,mull);
    em=vec3(1.0,.76,.46)*(.035+.08*mix(.18,paths,resolved))*(1.0-mull);
  }
  if (k > 11.5 && k < 12.5) {
    float dM = 1.0 - smoothstep(2.0, 3.6, px);                       // 9 m mullions >= 3 px
    float dG = 1.0 - smoothstep(0.8, 2.4, px);                       // garden texture
    float dT = 1.0 - smoothstep(60.0, 150.0, px);                    // 450 m districts
    float g = vnoise(f * 0.011) * 0.55 + mix(0.5, vnoise(f * 0.09), dG) * 0.45;
    vec3 garden = mix(vec3(0.03, 0.075, 0.028), vec3(0.11, 0.16, 0.055), g);
    // districts: parkland, fields, lakes and towns along the roof's length
    float dh = hash12(floor(f / vec2(450.0, 260.0)) + 29.0);
    float town = mix(0.3, step(0.62, dh), dT);
    float lake = mix(0.1, step(dh, 0.1), dT);
    vec3 townC = vec3(0.26, 0.25, 0.23) * (0.9 + 0.2 * mix(0.5, hash12(floor(f / 18.0)), dG));
    vec3 under = mix(garden, townC, town);
    under = mix(under, vec3(0.012, 0.035, 0.05), lake);
    float mull = mix(0.1, max(cLine(f.x, 9.0, 0.35, fw.x), cLine(f.y, 9.0, 0.35, fw.y)), dM);
    alb = mix(under * 0.85, vec3(0.62, 0.61, 0.58), mull);
    rough = mix(0.08, 0.4, mull); metal = mix(0.45, 0.15, mull);
    // warm town light under the glass, its mean kept as it falls below a few pixels
    float lc = hash12(floor(f / 22.0) + 5.0);
    float lampOn = mix(0.18, smoothstep(0.55, 0.9, lc), 1.0 - smoothstep(4.0, 8.0, px));
    em = vec3(1.0, 0.76, 0.5) * (0.04 + 0.5 * town * lampOn) * (1.0 - mull) * 0.6;
  }
}

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(-vView);
  float k = floor(vFac.z + 0.5);
  vec2 f = vFac.xy;
  vec2 fw = max(fwidth(f), vec2(1e-3));
  float px = max(fw.x, fw.y);
  // tangent frame of the facade coordinates (view space) for surface relief
  vec3 dp1 = dFdx(vView), dp2 = dFdy(vView);
  vec2 dq1 = dFdx(f), dq2 = dFdy(f);
  vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
  vec3 T = dp2p * dq1.x + dp1p * dq2.x, B = dp2p * dq1.y + dp1p * dq2.y;
  T /= max(length(T), 1e-12); B /= max(length(B), 1e-12);
  vec2 bump = vec2(0.0);
  vec3 sunL = spaceSunlight(uTransmittanceLUT, uObjWorld, uSunWorld) * uSunE;
  vec3 alb = vec3(0.74, 0.73, 0.7);          // pearl composite (sunlit, it must sit below the tone curve shoulder)
  float rough = 0.38, metal = 0.08;
  vec3 em = vec3(0.0);
  // every pattern settles to its exact average while its cell still spans ~3 px
  float det = 1.0 - smoothstep(0.4, 1.2, px);          // 3.6-4 m bays and decks
  float detP = 1.0 - smoothstep(0.8, 2.3, px);         // 7-12 m plates
  float fine = 1.0 - smoothstep(0.02, 0.1, px);
  if (k < 0.5) {
    // glazing with rooms behind it: 4 m bays, 3.6 m decks, mullions with rounded caps
    vec2 cell = floor(f / vec2(4.0, 3.6));
    float h = hash12(cell);
    float mx = gridLine(f.x, 4.0, 0.18, fw.x), my = gridLine(f.y, 3.6, 0.2, fw.y);
    float frame = max(mx, my) * det;
    alb = mix(vec3(0.05, 0.07, 0.09), vec3(0.6, 0.6, 0.58), frame);
    rough = mix(0.05, 0.4, frame); metal = mix(0.6, 0.2, frame);
    float lit = step(1.0 - uLit, h);
    vec3 lamp = mix(vec3(1.0, 0.74, 0.48), vec3(0.9, 0.92, 1.0), step(0.85, fract(h * 7.3)));
    // rooms: a warm pool high on the back wall, darker toward the floor
    vec2 lc = fract(f / vec2(4.0, 3.6));
    float lx = (lc.x - 0.5) * 2.2;
    float pool = mix(1.0, 0.55 + 0.65 * exp(-lx * lx) * smoothstep(0.1, 0.8, lc.y), det * fine);
    em = lamp * mix(uLit * 0.8, lit, det) * (1.0 - frame) * 0.55 * pool;
    bump.x += (fract(f.x / 4.0 + 0.5) - 0.5 > 0.0 ? 1.0 : -1.0) * mx * 0.5 * det;   // (mullion relief only while resolved)
    // larger order that still reads from kilometres: a solid spandrel every fourth deck, a
    // structural rib every 40 m, and neighbourhoods lit more or less brightly (mean kept)
    float solid = max(cLine(f.y, 14.4, 0.9, fw.y), cLine(f.x, 40.0, 0.6, fw.x));
    float hood = mix(1.0, 0.75 + 0.5 * hash12(floor(f / vec2(40.0, 14.4)) + 7.0), 1.0 - smoothstep(4.5, 13.0, px));
    alb = mix(alb, vec3(0.58, 0.58, 0.56), solid);
    rough = mix(rough, 0.4, solid); metal = mix(metal, 0.2, solid);
    em *= (1.0 - solid) * hood;
  } else if (k < 1.5) {
    // pearl composite in 12 x 7 m plates: each a shade apart, bevelled seams, fasteners at the
    // corners, a few dark service hatches, and faint streaks where micrometeoroids scoured it
    vec2 pc = floor(f / vec2(12.0, 7.0));
    vec2 pl = f - pc * vec2(12.0, 7.0);
    float h = hash12(pc + 3.0);
    alb *= mix(1.0, 0.93 + 0.1 * h, detP);
    float seam = max(gridLine(f.x, 12.0, 0.08, fw.x), gridLine(f.y, 7.0, 0.08, fw.y)) * detP;
    alb *= 1.0 - 0.35 * seam;
    bump += vec2(cBevel(pl.x, 12.0, 0.25), cBevel(pl.y, 7.0, 0.25)) * 0.5 * (1.0 - smoothstep(0.03, 0.09, px));
    vec2 fc = min(pl, vec2(12.0, 7.0) - pl);
    float fast = (1.0 - smoothstep(0.08, 0.08 + fw.x, length(fc - 0.45))) * (1.0 - smoothstep(0.02, 0.05, px));
    alb *= 1.0 - 0.4 * fast;
    float hatchOn = step(0.86, hash12(pc + 17.0)) * detP;
    float hatch = hatchOn * gridLine(pl.x - 3.0, 12.0, 1.4, fw.x) * gridLine(pl.y - 3.5, 7.0, 1.0, fw.y) * det;
    float hatchE = hatchOn * max(gridLine(pl.x - 1.6, 12.0, 0.04, fw.x), gridLine(pl.x - 4.4, 12.0, 0.04, fw.x)) * gridLine(pl.y - 3.5, 7.0, 1.0, fw.y) * det;
    alb = mix(alb, vec3(0.42, 0.42, 0.43), hatch);
    alb *= 1.0 - 0.5 * hatchE;
    alb *= 1.0 - 0.07 * smoothstep(0.55, 0.9, vnoise(vec2(f.x * 0.05, f.y * 0.8) + h * 9.0)) * det;
    // structural frames every six plates along and three round, and super-panels a shade
    // apart: the scale still reads when single plates are long gone
    alb *= 1.0 - 0.16 * max(cLine(f.y, 42.0, 0.5, fw.y), cLine(f.x, 36.0, 0.4, fw.x));
    alb *= mix(1.0, 0.95 + 0.1 * hash12(floor(f / vec2(36.0, 21.0)) + 11.0), 1.0 - smoothstep(2.5, 7.0, px));
    rough = 0.34 + 0.12 * h * detP + 0.1 * hatch;
    metal = 0.08 + 0.3 * hatch;
  } else if (k < 2.5) {
    // lantern glass: faceted, glowing warm from within
    float fin = max(gridLine(f.x, 3.0, 0.12, fw.x), gridLine(f.y, 5.0, 0.15, fw.y)) * det;
    alb = mix(vec3(0.9, 0.85, 0.75), vec3(0.5, 0.5, 0.5), fin);
    em = vec3(1.0, 0.8, 0.56) * (1.1 + 0.25 * sin(uTime * 0.7 + f.y * 0.01)) * (1.0 - 0.7 * fin);
  } else if (k < 3.5) {
    float g = vnoise(f * 0.21) * 0.6 + vnoise(f * 1.3) * 0.4 * det;
    alb = mix(vec3(0.05, 0.13, 0.035), vec3(0.2, 0.3, 0.09), g);
    alb = mix(alb, vec3(0.42, 0.38, 0.3), smoothstep(0.78, 0.86, vnoise(f * 0.07)) * 0.8);   // paths
    rough = 0.9;
    float dl = 1.0 - smoothstep(0.35, 1.0, px);
    em = vec3(1.0, 0.78, 0.5) * mix(0.015, step(0.985, hash12(floor(f / 3.0))), dl) * 0.8;     // garden lamps
  } else if (k < 4.5) {
    // accent conduit: soft pulses drifting along it between collars
    float fp = fract(f.y / 90.0 - uTime * 0.06) - 0.5;
    float flow = mix(0.3, exp(-fp * fp * 40.0), 1.0 - smoothstep(4.0, 12.0, fw.y));
    float collar = gridLine(f.y, 15.0, 0.6, fw.y) * det;
    alb = vec3(0.08);
    em = uAccent * (0.7 + 1.8 * flow) * (1.0 - 0.85 * collar);
  } else if (k < 7.5) {
    // photovoltaic wings: cells with silver fingers, strung between spars
    alb = vec3(0.025, 0.04, 0.1);
    rough = 0.12; metal = 0.7;
    float cells = max(gridLine(f.x, 1.4, 0.04, fw.x), gridLine(f.y, 1.4, 0.04, fw.y)) * det;
    float spar = max(gridLine(f.x, 28.0, 0.4, fw.x), gridLine(f.y, 42.0, 0.4, fw.y)) * det;
    alb += vec3(0.25) * cells;
    alb = mix(alb, vec3(0.5, 0.5, 0.52), spar);
    alb *= 1.0 + 0.15 * (hash12(floor(f / 14.0)) - 0.5) * (1.0 - smoothstep(1.5, 4.6, px));
  } else if (k < 8.5) {
    // bronze: brushed, darker where handled
    float br = vnoise(vec2(f.x * 0.2, f.y * 30.0));
    alb = vec3(0.72, 0.52, 0.3) * mix(1.0, 0.9 + 0.2 * br, fine); rough = 0.26 + 0.08 * br * fine; metal = 1.0;
  } else if (k < 9.5) {
    // deck: non-slip plates
    float pl = max(gridLine(f.x, 2.4, 0.03, fw.x), gridLine(f.y, 2.4, 0.03, fw.y)) * det;
    alb = vec3(0.62, 0.61, 0.58) * (1.0 - 0.3 * pl) * mix(1.0, 0.92 + 0.12 * hash12(floor(f / 2.4)), 1.0 - smoothstep(0.3, 0.8, px)); rough = 0.6;
  } else if (k < 10.5) {
    alb = vec3(0.13, 0.13, 0.14); rough = 0.5; metal = 0.6;
    alb *= 1.0 - 0.3 * max(gridLine(f.x, 6.0, 0.05, fw.x), gridLine(f.y, 6.0, 0.05, fw.y)) * det;
  } else if (k < 11.5) {
    // heat radiator: dark ceramic fins with glowing coolant channels, hottest near the manifold
    alb = vec3(0.1, 0.09, 0.085); rough = 0.7;
    float ch = mix(0.17, gridLine(f.y, 24.0, 2.0, fw.y), 1.0 - smoothstep(4.0, 9.0, fw.y));   // mean once under ~3 px
    float fin2 = gridLine(f.x, 3.0, 0.3, fw.x) * det;
    float heat = 0.55 + 0.45 * sin(f.x * 0.003 + 1.3);
    alb *= 1.0 - 0.3 * fin2;
    // relief: corrugated fins every 3 m and raised coolant channels every 24 m, faded to flat
    // (their average) before they drop under a few pixels
    float rF = 1.0 - smoothstep(0.35, 0.9, fw.x);
    float cp = fract(f.y / 24.0 + 0.5) - 0.5;
    float rC = 1.0 - smoothstep(1.5, 4.0, fw.y);
    bump.x += 0.3 * sin(f.x * 2.0944) * rF;
    bump.y += -clamp(cp * 24.0 / 2.0, -1.0, 1.0) * exp(-cp * cp * 60.0) * 0.6 * rC;
    em = vec3(1.0, 0.36, 0.12) * (0.14 + 0.5 * ch) * heat * (0.8 + 0.2 * sin(uTime * 0.3 + f.x * 0.002));
  }
  craftExtraKinds(k, f, fw, px, alb, rough, metal, em);
  N = normalize(N + T * bump.x + B * bump.y);
  // light: the Sun, earthshine, a little ambient, and the Earth mirrored in glossy surfaces
  vec3 toE = uEarthView - vView;
  float dE = length(toE);
  vec3 eDir = toE / dE;
  float eSize = clamp(6371.0 / dE, 0.0, 1.0);
  vec3 earthshine = vec3(0.35, 0.5, 0.85) * uSunE * 0.3 * eSize * eSize * max(dot(N, eDir), 0.0) * max(dot(-eDir, uSunView) * 0.5 + 0.5, 0.0);
  float ndl = max(dot(N, uSunView), 0.0);
  vec3 H = normalize(V + uSunView);
  // flat hull facets reflecting the Sun: a soft sheen with a bounded peak (a sharp lobe
  // turned whole faceted plates white for a frame as a ship turned)
  float sp = pow(max(dot(N, H), 0.0), mix(60.0, 10.0, rough)) * mix(0.5, 0.25, rough);
  vec3 F0 = mix(vec3(0.04), alb, metal);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 Fr = F0 + (1.0 - F0) * fres * (1.0 - rough);
  vec3 col = alb * (1.0 - metal * 0.8) / 3.14159 * (sunL * ndl + earthshine) + min((F0 + (1.0 - F0) * fres * 0.3) * sp * sunL * ndl, sunL * 0.5);
  col += Fr * craftEnv(vView, reflect(-V, N), max(rough, 0.12)) * 0.8;
  // bounce from the craft's own sunlit plating (soft, from the side away from the Sun), and
  // floodlights washing the hull while it is in shadow
  float sunVis = clamp(dot(sunL, vec3(0.333)) / max(uSunE, 1e-3), 0.0, 1.0);
  col += alb * (1.0 - metal * 0.6) / 3.14159 * sunL * uFill * (0.55 + 0.45 * max(dot(N, -uSunView), 0.0));
  col += alb * (1.0 - metal * 0.5) * vec3(1.0, 0.86, 0.68) * uFlood * 0.06 * (1.0 - sunVis) * (0.6 + 0.4 * max(N.y, 0.0));
  col += alb * 0.004 + em;
  gl_FragColor = vec4(col, 1.0);
}
`;

const _m = new THREE.Matrix4(), _v = new THREE.Vector3();

export function createCraftMaterial({ accent = [0.55, 0.85, 1.0], lit = 0.55, fill = 0.025, flood = 1 } = {}) {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTransmittanceLUT: U.uTransmittanceLUT, uSunE: U.uSunIlluminance,
      uSunView: { value: new THREE.Vector3(1, 0, 0) }, uSunWorld: { value: new THREE.Vector3(1, 0, 0) },
      uObjWorld: { value: new THREE.Vector3() }, uEarthView: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uAccent: { value: new THREE.Color(...accent) }, uLit: { value: lit },
      uFill: { value: fill }, uFlood: { value: flood },
    },
    side: THREE.DoubleSide,
  });
  return m;
}

/** Per-frame: sun and Earth in view space, object centre for the eclipse test. */
export function updateCraftMaterial(m, camera, sunDir, objWorld, time) {
  const u = m.uniforms;
  _m.copy(camera.matrixWorldInverse);
  u.uSunView.value.copy(sunDir).transformDirection(_m);
  u.uSunWorld.value.copy(sunDir);
  u.uEarthView.value.set(0, 0, 0).applyMatrix4(_m);
  if (objWorld) u.uObjWorld.value.copy(objWorld);
  u.uTime.value = time;
}

// ------------------------------------------------------------- engine glow --
const GLOW_VERT = /* glsl */ `
attribute vec4 iGlow;     // xyz nozzle (object space), w radius (object units)
attribute vec3 iDir;      // exhaust direction (object space)
uniform float uScale;     // object -> view units (the mesh scale)
varying vec2 vQ;
varying float vFace;
void main() {
  vec4 c = modelViewMatrix * vec4(iGlow.xyz, 1.0);
  vec3 d = normalize(mat3(modelViewMatrix) * iDir);
  vFace = max(dot(d, normalize(-c.xyz)), 0.0);                   // looking up the nozzle
  float r = iGlow.w * uScale * (1.0 + 1.2 * vFace);
  vQ = position.xy;
  c.xy += position.xy * r;
  gl_Position = projectionMatrix * c;
}
`;
const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
varying vec2 vQ;
varying float vFace;
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 14.0), halo = exp(-r2 * 3.0) * 0.25;
  float flick = 0.97 + 0.03 * sin(uTime * 9.0 + vQ.x * 3.0);
  gl_FragColor = vec4(uColor * (core * (0.5 + 1.5 * vFace) + halo) * uStrength * flick, 0.0);
}
`;

/** Additive engine glows as camera-facing quads riding on a craft mesh. */
export function createGlowMesh(glows, { color = [0.55, 0.8, 1.0], strength = 6, scale = 1 } = {}) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const iG = new Float32Array(glows.length * 4), iD = new Float32Array(glows.length * 3);
  glows.forEach((q, i) => { iG.set([q.p.x, q.p.y, q.p.z, q.r], i * 4); iD.set([q.dir.x, q.dir.y, q.dir.z], i * 3); });
  g.setAttribute('iGlow', new THREE.InstancedBufferAttribute(iG, 4));
  g.setAttribute('iDir', new THREE.InstancedBufferAttribute(iD, 3));
  g.instanceCount = glows.length;
  const m = new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
    uniforms: { uColor: { value: new THREE.Color(...color) }, uStrength: { value: strength }, uTime: U.uTime, uScale: { value: scale } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 18;
  return mesh;
}
