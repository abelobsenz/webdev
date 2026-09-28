import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { R_MOON } from './sim.js';

// Material for everything built on and around the Moon (Medii Landing, the Tranquillity
// Exchange and the ring districts), in metres, drawn in the km-scale orbital scene with a
// camera-relative modelViewMatrix. Unlike the generic craft material it knows where the
// Moon is: sunlight is cut at the local horizon (the terminator sweeps across the town,
// reddening as it goes), the full Earth overhead lights the night side, and the thin
// lunar air adds a faint blue sky light. It also carries the town's own surfaces: pale
// stone with windows, roof gardens, paving, courtyards, landing pads and pools.
//
// Facade kinds (aFacade.z): the craft kinds (0 glass, 1 pearl hull, 2 lantern, 3 garden,
// 4 conduit, 7 panel, 8 bronze, 9 deck, 10 dark, 11 radiator, 12 glazed roof, 13
// conservatory) plus 20 stone facade, 21 roof garden, 22 paving, 23 landing pad, 24
// courtyard, 25 tiled roof, 26 reflecting pool, 27 dressed stone wall.

export const LK = { GLASS: 0, HULL: 1, LANTERN: 2, GARDEN: 3, CONDUIT: 4, PANEL: 7, BRONZE: 8, DECK: 9, DARK: 10, RADIATOR: 11, ROOF: 12, CONSERVATORY: 13, STONE: 20, ROOFG: 21, PAVE: 22, PAD: 23, COURT: 24, TILE: 25, POOL: 26, WALL: 27 };

const VERT = /* glsl */ `
attribute vec3 aFacade;
varying vec3 vFac;
varying vec3 vView;
varying vec3 vN;
void main() {
  vFac = aFacade;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunView;
uniform vec3 uMoonView;      // Moon centre, view space (km)
uniform vec3 uEarthView;     // Earth centre, view space (km)
uniform float uEarthLit;     // lit fraction of the Earth's disc seen from the Moon
uniform float uSunE;
uniform float uTime;
uniform vec3 uAccent;
uniform float uLit;
uniform float uScale;        // view units per facade metre (1e-3: the meshes are metres in a km scene)
varying vec3 vFac;
varying vec3 vView;
varying vec3 vN;
${NOISE_GLSL}
float gridLine(float x, float p, float w, float fw) { float d = abs(fract(x / p + 0.5) - 0.5) * p; return 1.0 - smoothstep(w, w + fw, d); }
float cLine(float x, float p, float w, float fw) { float d = abs(fract(x / p + 0.5) - 0.5) * p; return clamp(1.0 - d / max(w, fw), 0.0, 1.0) * min(1.0, w / fw); }

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(-vView);
  float k = floor(vFac.z + 0.5);
  vec2 f = vFac.xy;
  vec2 fw = max(fwidth(f), vec2(1e-3));
  float px = max(fw.x, fw.y);
  float det = 1.0 - smoothstep(0.4, 1.2, px);
  float detP = 1.0 - smoothstep(0.8, 2.3, px);
  // the Moon's horizon, and the Sun reddened by the thin air as it sinks
  // the Sun's elevation above this point's own horizon: on the ground the local horizontal,
  // on the ring 380 km up a horizon depressed by 35 degrees
  vec3 pRel = vView - uMoonView;
  float rr = length(pRel);
  vec3 upV = pRel / max(rr, 1e-3);
  float mu = dot(upV, uSunView);
  float hh = rr - ${R_MOON.toFixed(1)};
  float dip = hh > 1.0 ? acos(clamp(${R_MOON.toFixed(1)} / rr, 0.0, 1.0)) : sqrt(max(2.0 * hh / ${R_MOON.toFixed(1)}, 0.0));
  float elev = asin(clamp(mu, -1.0, 1.0)) + dip;
  float sunVis = smoothstep(-0.006, 0.006, elev);
  vec3 sunCol = mix(vec3(1.0, 0.6, 0.34), vec3(1.0, 0.975, 0.94), smoothstep(0.0, 0.14, elev));
  vec3 sunL = uSunE * sunCol * sunVis;
  float night = 1.0 - smoothstep(-0.05, 0.04, elev);
  vec3 alb = vec3(0.72, 0.71, 0.68);
  float rough = 0.45, metal = 0.05;
  vec3 em = vec3(0.0);
  if (k < 0.5) {
    // glazing: 4 m bays, 3.6 m decks, rooms lit behind
    vec2 cell = floor(f / vec2(4.0, 3.6));
    float h = hash12(cell);
    float frame = max(gridLine(f.x, 4.0, 0.18, fw.x), gridLine(f.y, 3.6, 0.2, fw.y)) * det;
    alb = mix(vec3(0.05, 0.07, 0.09), vec3(0.6, 0.6, 0.58), frame);
    rough = mix(0.05, 0.4, frame); metal = mix(0.6, 0.2, frame);
    float lit = step(1.0 - uLit, h);
    vec3 lamp = mix(vec3(1.0, 0.74, 0.48), vec3(0.9, 0.92, 1.0), step(0.85, fract(h * 7.3)));
    em = lamp * mix(uLit * 0.8, lit, det) * (1.0 - frame) * 0.55 * (0.35 + 0.65 * night);
  } else if (k < 1.5) {
    vec2 pc = floor(f / vec2(12.0, 7.0));
    float h = hash12(pc + 3.0);
    alb *= mix(1.0, 0.93 + 0.1 * h, detP);
    alb *= 1.0 - 0.3 * max(gridLine(f.x, 12.0, 0.08, fw.x), gridLine(f.y, 7.0, 0.08, fw.y)) * detP;
    alb *= 1.0 - 0.14 * max(cLine(f.y, 42.0, 0.5, fw.y), cLine(f.x, 36.0, 0.4, fw.x));
    rough = 0.36 + 0.1 * h * detP;
  } else if (k < 2.5) {
    float fin = max(gridLine(f.x, 3.0, 0.12, fw.x), gridLine(f.y, 5.0, 0.15, fw.y)) * det;
    alb = mix(vec3(0.9, 0.85, 0.75), vec3(0.5), fin);
    em = vec3(1.0, 0.8, 0.56) * (0.5 + 0.8 * night) * (1.0 - 0.7 * fin);
  } else if (k < 3.5) {
    float g = vnoise(f * 0.21) * 0.6 + vnoise(f * 1.3) * 0.4 * det;
    alb = mix(vec3(0.04, 0.1, 0.03), vec3(0.14, 0.22, 0.07), g);
    rough = 0.9;
  } else if (k < 4.5) {
    float fp = fract(f.y / 90.0 - uTime * 0.06) - 0.5;
    float flow = mix(0.3, exp(-fp * fp * 40.0), 1.0 - smoothstep(4.0, 12.0, fw.y));
    alb = vec3(0.08);
    em = uAccent * (0.5 + 1.4 * flow);
  } else if (k < 7.5) {
    alb = vec3(0.025, 0.04, 0.1); rough = 0.12; metal = 0.7;
    alb += vec3(0.2) * max(gridLine(f.x, 1.4, 0.04, fw.x), gridLine(f.y, 1.4, 0.04, fw.y)) * det;
  } else if (k < 8.5) {
    float br = vnoise(vec2(f.x * 0.2, f.y * 30.0));
    alb = vec3(0.72, 0.52, 0.3) * (0.9 + 0.2 * br * det); rough = 0.28; metal = 1.0;
  } else if (k < 9.5) {
    float pl = max(gridLine(f.x, 2.4, 0.03, fw.x), gridLine(f.y, 2.4, 0.03, fw.y)) * det;
    alb = vec3(0.6, 0.59, 0.56) * (1.0 - 0.3 * pl); rough = 0.6;
  } else if (k < 10.5) {
    alb = vec3(0.13, 0.13, 0.14); rough = 0.5; metal = 0.5;
  } else if (k < 11.5) {
    alb = vec3(0.1, 0.09, 0.085); rough = 0.7;
    float ch = mix(0.17, gridLine(f.y, 24.0, 2.0, fw.y), 1.0 - smoothstep(4.0, 9.0, fw.y));
    em = vec3(1.0, 0.36, 0.12) * (0.1 + 0.4 * ch);
  } else if (k < 12.5) {
    // glazed roof over parkland and lit lanes
    float g = vnoise(f * 0.011) * 0.55 + vnoise(f * 0.09) * 0.45;
    vec3 under = mix(vec3(0.03, 0.075, 0.028), vec3(0.11, 0.16, 0.055), g);
    float mull = mix(0.1, max(cLine(f.x, 9.0, 0.35, fw.x), cLine(f.y, 9.0, 0.35, fw.y)), 1.0 - smoothstep(2.0, 3.6, px));
    alb = mix(under * 0.85, vec3(0.62, 0.61, 0.58), mull);
    rough = mix(0.08, 0.4, mull); metal = mix(0.45, 0.15, mull);
    em = vec3(1.0, 0.76, 0.5) * (0.03 + 0.2 * night * smoothstep(0.6, 0.9, hash12(floor(f / 22.0)))) * (1.0 - mull);
  } else if (k < 13.5) {
    float resolved = 1.0 - smoothstep(2.5, 7.0, px);
    float paths = max(cLine(f.x, 18.0, 1.1, fw.x), cLine(f.y, 24.0, 1.2, fw.y));
    float fol = mix(0.5, vnoise(f * 0.13) * 0.6 + vnoise(f * 0.65) * 0.4, 1.0 - smoothstep(0.7, 2.0, px));
    vec3 planted = mix(vec3(0.035, 0.09, 0.025), vec3(0.13, 0.22, 0.065), fol);
    vec3 under = mix(planted, vec3(0.29, 0.27, 0.21), mix(0.18, paths, resolved));
    float mull = mix(0.1, max(cLine(f.x, 6.0, 0.15, fw.x), cLine(f.y, 6.0, 0.15, fw.y)), 1.0 - smoothstep(1.4, 3.2, px));
    alb = mix(under, vec3(0.6, 0.6, 0.55), mull);
    rough = mix(0.2, 0.42, mull); metal = mix(0.2, 0.12, mull);
    em = vec3(1.0, 0.76, 0.46) * (0.02 + 0.12 * night * mix(0.18, paths, resolved)) * (1.0 - mull);
  } else if (k < 20.5) {
    // pale stone: 4 m window bays on 3.6 m storeys, a plinth course, lit rooms at night
    vec2 cell = floor(f / vec2(4.0, 3.6));
    float h = hash12(cell + 11.0);
    vec2 lc = fract(f / vec2(4.0, 3.6));
    float win = (1.0 - smoothstep(0.3, 0.3 + fw.x / 4.0, abs(lc.x - 0.5))) * (1.0 - smoothstep(0.28, 0.28 + fw.y / 3.6, abs(lc.y - 0.55)));
    float plinth = 1.0 - step(3.6, f.y);
    win *= 1.0 - plinth;
    float meanWin = 0.36 * (1.0 - plinth);
    float wv = mix(meanWin, win, det);
    alb = vec3(0.7, 0.67, 0.6) * (0.94 + 0.08 * mix(0.5, hash12(floor(f / vec2(16.0, 14.4)) + 2.0), detP));
    alb = mix(alb, vec3(0.06, 0.07, 0.08), wv * 0.9);
    alb *= 1.0 - 0.12 * plinth;
    rough = mix(0.7, 0.1, wv); metal = 0.0;
    float lit = mix(uLit, step(1.0 - uLit, h), det);
    vec3 lamp = mix(vec3(1.0, 0.72, 0.45), vec3(1.0, 0.86, 0.66), step(0.7, fract(h * 5.3)));
    em = lamp * wv * lit * 0.5 * (0.15 + 0.85 * night);
  } else if (k < 21.5) {
    float g = vnoise(f * 0.18) * 0.6 + vnoise(f * 0.9) * 0.4 * det;
    alb = mix(vec3(0.035, 0.085, 0.025), vec3(0.11, 0.17, 0.05), g);
    alb = mix(alb, vec3(0.5, 0.47, 0.4), max(cLine(f.x, 11.0, 0.5, fw.x), cLine(f.y, 13.0, 0.5, fw.y)) * 0.6);
    rough = 0.9;
  } else if (k < 22.5) {
    // paving: pale setts in a running bond, a darker gutter band every 20 m
    float sett = max(gridLine(f.x, 1.2, 0.03, fw.x), gridLine(f.y + 0.6 * step(0.5, fract(f.x / 2.4)), 0.8, 0.03, fw.y)) * (1.0 - smoothstep(0.02, 0.06, px));
    alb = vec3(0.4, 0.38, 0.34) * (1.0 - 0.18 * sett) * mix(1.0, 0.94 + 0.1 * vnoise(f * 0.05), 1.0 - smoothstep(3.0, 9.0, px));
    rough = 0.75;
  } else if (k < 23.5) {
    // landing pad: dark composite, a painted ring every 50 m, the central target
    float r = length(f);
    float ring = cLine(r, 50.0, 1.2, px);
    float centre = 1.0 - smoothstep(18.0, 18.0 + px, abs(r - 40.0));
    alb = vec3(0.2, 0.2, 0.21) * (0.92 + 0.08 * vnoise(f * 0.02));
    alb = mix(alb, vec3(0.75, 0.72, 0.6), max(ring * 0.7, centre * 0.6));
    rough = 0.6;
    em = vec3(1.0, 0.8, 0.5) * ring * 0.05 * night;
  } else if (k < 24.5) {
    // courtyard: lawn, a gravel walk, trees as dark crowns
    float g = vnoise(f * 0.12);
    alb = mix(vec3(0.04, 0.09, 0.03), vec3(0.08, 0.14, 0.045), g);
    vec2 tc = fract(f / 9.0) - 0.5;
    float tree = (1.0 - smoothstep(0.28, 0.28 + fw.x / 9.0, length(tc))) * step(0.45, hash12(floor(f / 9.0))) * det;
    alb = mix(alb, vec3(0.02, 0.05, 0.018), mix(0.25, tree, det));
    rough = 0.9;
  } else if (k < 25.5) {
    // tiled roof: bronze-grey tiles in courses
    float course = gridLine(f.y, 0.9, 0.05, fw.y) * det;
    alb = vec3(0.33, 0.27, 0.22) * (0.9 + 0.12 * mix(0.5, hash12(floor(f / vec2(6.0, 0.9))), detP)) * (1.0 - 0.3 * course);
    rough = 0.55; metal = 0.2;
  } else if (k < 26.5) {
    // reflecting pool: dark water mirroring the sky
    alb = vec3(0.01, 0.02, 0.025); rough = 0.05; metal = 0.0;
  } else {
    // dressed stone: ashlar courses of 0.6 m, blocks 1.4 m, weathered a shade apart
    float crs = gridLine(f.y, 0.6, 0.03, fw.y) * det;
    float jnt = gridLine(f.x + 0.7 * step(0.5, fract(f.y / 1.2)), 1.4, 0.03, fw.x) * det;
    alb = vec3(0.5, 0.48, 0.43) * (0.93 + 0.1 * mix(0.5, hash12(floor(f / vec2(1.4, 0.6))), det)) * (1.0 - 0.2 * max(crs, jnt));
    alb *= mix(1.0, 0.95 + 0.08 * vnoise(f * 0.03), 1.0 - smoothstep(6.0, 20.0, px));
    rough = 0.8;
  }
  // light: the Sun (to the Moon's horizon), the Earth, the lunar sky
  vec3 toE = uEarthView - vView;
  float dE = length(toE);
  vec3 eDir = toE / max(dE, 1.0);
  vec3 earthL = uSunE * vec3(0.55, 0.7, 1.0) * 9.0e-4 * uEarthLit * smoothstep(-0.05, 0.1, dot(upV, eDir));
  vec3 skyL = uSunE * vec3(0.03, 0.05, 0.1) * smoothstep(-0.1, 0.3, mu) * (1.0 - smoothstep(20.0, 80.0, hh));
  float ndl = max(dot(N, uSunView), 0.0);
  vec3 H = normalize(V + uSunView);
  float sp = pow(max(dot(N, H), 0.0), mix(80.0, 8.0, rough)) * mix(0.6, 0.15, rough);
  vec3 F0 = mix(vec3(0.04), alb, metal);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = alb * (1.0 - metal * 0.8) / 3.14159 * (sunL * ndl + earthL * max(dot(N, eDir), 0.0) + skyL * (0.55 + 0.45 * max(dot(N, upV), 0.0)));
  col += min((F0 + (1.0 - F0) * fres * 0.3) * sp * sunL * ndl, sunL * 0.5);
  // glossy surfaces mirror the sky: dark blue by day, black at night
  col += (F0 + (1.0 - F0) * fres) * (1.0 - rough) * skyL * 0.6;
  col += alb * 0.002 + em;
  gl_FragColor = vec4(col, 1.0);
}
`;

const _m = new THREE.Matrix4();

export function createLunarMaterial({ accent = [0.6, 0.85, 1.0], lit = 0.55, side = THREE.FrontSide } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uSunE: U.uSunIlluminance,
      uSunView: { value: new THREE.Vector3(1, 0, 0) },
      uMoonView: { value: new THREE.Vector3() },
      uEarthView: { value: new THREE.Vector3() },
      uEarthLit: LUNAR_FRAME.earthLit,
      uTime: { value: 0 }, uAccent: { value: new THREE.Color(...accent) }, uLit: { value: lit },
      uScale: { value: 1e-3 },
    },
    side,
  });
}

/** Frame-wide values set once per frame by the Moon (sun direction, Moon centre, time). */
export const LUNAR_FRAME = { sunDir: new THREE.Vector3(1, 0, 0), moonPos: new THREE.Vector3(), time: 0, earthLit: { value: 0.5 } };

/** A lunar-material mesh in metres, scaled into km. */
export function lunarMesh(geo, opts = {}, mat = null) {
  const m = mat || createLunarMaterial(opts);
  const mesh = new THREE.Mesh(geo, m);
  mesh.scale.setScalar(0.001);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.onBeforeRender = (r, s, cam) => {
    const u = m.uniforms;
    _m.copy(cam.matrixWorldInverse);
    u.uSunView.value.copy(LUNAR_FRAME.sunDir).transformDirection(_m);
    u.uMoonView.value.copy(LUNAR_FRAME.moonPos).applyMatrix4(_m);
    u.uEarthView.value.set(0, 0, 0).applyMatrix4(_m);
    u.uTime.value = LUNAR_FRAME.time;
    m.uniformsNeedUpdate = true;
  };
  return mesh;
}
