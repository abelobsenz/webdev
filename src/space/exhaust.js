import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { createPlume } from './plume.js';

// A physically grounded vacuum engine: nozzle, throat and plume. In metres (the parent mesh
// carries the km scale); the engine's axis is local +Z, the exhaust leaving through the exit
// plane at z = len.
//
// Nozzle   a radiatively cooled extension (a niobium-alloy skirt). It is lit by the Sun like any
//          dark metal and glows from its own heat: temperature falls from ~2100 K at the throat
//          to ~950 K at the lip; the colour is the black-body colour of that temperature and the
//          radiance goes with T^4, so the throat end is white-yellow and blooms while the lip is a
//          dull red. The metal takes a couple of seconds to come up to temperature and keeps its
//          glow a while after cut-off.
// Throat   the chamber seen up the bell: a small, very bright disc, visible only from behind.
// Plume    a volumetric, ray-marched Gaussian jet (space/plume.js): under-expanded in vacuum it
//          fans out and thins as it spreads, white-blue at the exit cooling to violet, its
//          turbulence streaming downstream. No shock diamonds (those need an atmosphere).

const BLACKBODY = /* glsl */ `
// black-body colour of temperature T (kelvin), linear RGB, normalised to its brightest channel
vec3 blackbody(float T) {
  float t = T / 100.0;
  float r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(t - 60.0, -0.1332048), 0.0, 1.0);
  float g = t <= 66.0 ? clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0) : clamp(1.1298909 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
  float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432068 * log(t - 10.0) - 1.1962541, 0.0, 1.0));
  return pow(vec3(r, g, b), vec3(2.2));
}`;

// ------------------------------------------------------------------ nozzle --
const NOZ_VERT = /* glsl */ `
attribute float aX;             // 0 at the throat .. 1 at the lip
varying float vX; varying vec3 vView; varying vec3 vN; varying vec2 vXY;
void main() {
  vX = aX; vXY = position.xy;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz; vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;
const NOZ_FRAG = /* glsl */ `
uniform vec3 uSunView; uniform float uSunE; uniform float uHeat; uniform float uTInner; uniform float uTLip; uniform float uTubes;
varying float vX; varying vec3 vView; varying vec3 vN; varying vec2 vXY;
${BLACKBODY}
void main() {
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(-vView);
  // dark, lightly oxidised metal: spun rings every ~0.25 of the length (a hint of the rolled skirt)
  float ring = 0.9 + 0.1 * smoothstep(0.35, 0.5, abs(fract(vX * 9.0) - 0.5));
  // the regeneratively cooled upper bell: brazed coolant tubes running down it (their shading
  // rolls round each tube), ending in a manifold band; hat-band stiffeners over the skirt
  float ang = atan(vXY.y, vXY.x) * uTubes / 6.28318;
  float fw = max(fwidth(ang), 1e-4);
  float tube = abs(fract(ang) - 0.5) * 2.0;
  float tubeShade = mix(1.0, 0.72 + 0.28 * sqrt(max(1.0 - tube * tube, 0.0)), (1.0 - smoothstep(0.25, 0.6, fw)) * (1.0 - smoothstep(0.34, 0.4, vX)));
  float manifold = smoothstep(0.33, 0.35, vX) * (1.0 - smoothstep(0.39, 0.41, vX));
  float hat = (1.0 - smoothstep(0.0, 0.012, abs(fract(vX * 4.0 + 0.5) - 0.5) - 0.02)) * step(0.45, vX);
  vec3 alb = vec3(0.16, 0.15, 0.145) * ring * tubeShade * (1.0 - 0.35 * manifold) * (1.0 + 0.25 * hat);
  float ndl = max(dot(N, uSunView), 0.0);
  vec3 H = normalize(V + uSunView);
  float sp = pow(max(dot(N, H), 0.0), 40.0) * 0.35;
  vec3 col = alb / 3.14159 * uSunE * ndl + vec3(0.9, 0.86, 0.8) * sp * uSunE * ndl * 0.15 + alb * 0.01;
  // incandescence: temperature along the skirt, scaled by how hot the engine has run
  float T = mix(uTInner, uTLip, pow(vX, 0.8)) * uHeat;
  float rel = T / 2100.0;
  col += blackbody(max(T, 300.0)) * uSunE * 1.4 * rel * rel * rel * rel;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Bell of revolution (outer and inner skin) from the throat to the exit. */
function bellGeometry(rt, re, len, wall = 0.05, seg = 48, rings = 18) {
  const pos = [], ax = [], idx = [];
  // profile: parabolic-ish contour r(x) from the throat to the exit
  const r = (x) => rt + (re - rt) * (1 - Math.pow(1 - x, 1.8));
  const prof = [];
  for (let j = 0; j <= rings; j++) { const x = j / rings; prof.push([r(x) + wall, x * len, x]); }           // outer
  for (let j = rings; j >= 0; j--) { const x = j / rings; prof.push([r(x), x * len - 0.001, x]); }         // inner, back to the throat
  const W = seg + 1;
  for (const [rr, z, x] of prof) for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; pos.push(Math.cos(a) * rr, Math.sin(a) * rr, z); ax.push(x); }
  for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < seg; i++) { const a = j * W + i, b = a + 1, c = a + W + 1, d = a + W; idx.push(a, d, c, a, c, b); }
  // the lip: close outer to inner at the exit is already joined by consecutive rings (x = 1 twice)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aX', new THREE.Float32BufferAttribute(ax, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const THROAT_FRAG = /* glsl */ `
uniform float uThrust; uniform float uSunE;
varying vec2 vUv;
void main() {
  vec2 q = vUv * 2.0 - 1.0; float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float c = exp(-r2 * 3.0);
  gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * c * uThrust * uSunE * 2.4, 0.0);
}`;

const _m = new THREE.Matrix4();

/**
 * One engine. rt/re throat and exit radii, len bell length (metres). Returns a group with
 * setThrust(t, dt) - the skirt temperature lags the throttle as real metal does.
 */
export function createEngine({ rt, re, len, plumeLen = 18 * re, plumeAngle = 0.26, color = [0.42, 0.46, 1.0] }) {
  const g = new THREE.Group();
  const nozU = { uSunView: { value: new THREE.Vector3(1, 0, 0) }, uSunE: U.uSunIlluminance, uHeat: { value: 0 }, uTInner: { value: 2100 }, uTLip: { value: 950 }, uTubes: { value: Math.round(re * 90) } };
  const noz = new THREE.Mesh(bellGeometry(rt, re, len), new THREE.ShaderMaterial({ vertexShader: NOZ_VERT, fragmentShader: NOZ_FRAG, uniforms: nozU, side: THREE.DoubleSide }));
  noz.frustumCulled = false;
  noz.renderOrder = 3;
  noz.onBeforeRender = (r, s, cam) => { nozU.uSunView.value.copy(ENGINE_FRAME.sunDir).transformDirection(_m.copy(cam.matrixWorldInverse)); };
  g.add(noz);
  // the throat, seen up the bell
  const thU = { uThrust: { value: 0 }, uSunE: U.uSunIlluminance };
  const th = new THREE.Mesh(new THREE.CircleGeometry(rt * 0.95, 32).rotateY(Math.PI), new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: THROAT_FRAG, uniforms: thU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
  }));
  th.position.z = 0.02; th.rotation.y = Math.PI;                         // faces aft, out of the bell
  th.frustumCulled = false; th.renderOrder = 17;
  g.add(th);
  // the plume: a volumetric Gaussian jet from the exit plane (space/plume.js)
  // hydrogen plasma: a white exit that blooms, a pale blue coherent jet several nozzle lengths
  // long, a vast faint violet-rose envelope (Balmer glow) opening at ~25 degrees
  void plumeAngle;
  const plume = createPlume({ r0: re * 0.95, len: plumeLen, coreAngle: 0.07, envAngle: 0.44, ax: 5, ac: 1.2, ae: 0.2,
    exit: [1.0, 0.97, 1.0], core: [0.8, 0.88, 1.0], far: color, env: [0.62, 0.42, 1.0] });
  plume.position.z = len;
  g.add(plume);
  let heat = 0, surge = 0;
  // setThrust(t, dt, boost): boost (0..1) is the torch regime, twenty-five times the push, and it
  // should look it: the jet grows to ~3.2x its length and ~1.9x its width, three times as bright,
  // with a whiter core, and the skirt runs hotter
  g.setThrust = (t, dt = 0.016, boost = 0) => {
    surge += (boost - surge) * (1 - Math.exp(-dt * (boost > surge ? 2.5 : 4)));
    const b = surge * Math.min(1, t * 1.5);
    const tt = t * (1 + 2 * b);
    // metal heats in ~1.5 s and cools over ~6 s by radiation
    const k = tt > heat ? 1 - Math.exp(-dt / 1.5) : 1 - Math.exp(-dt / 6);
    heat += (tt - heat) * k;
    nozU.uHeat.value = Math.pow(Math.max(heat, 0), 0.25);                // radiance ~ T^4: temperature ~ power^(1/4)
    thU.uThrust.value = tt;
    plume.scale.set(1 + 0.9 * b, 1 + 0.9 * b, 1 + 2.2 * b);
    plume.setCore(b);
    plume.setThrust(tt, dt);
    th.visible = t > 0.01;
  };
  return g;
}

/** Per-frame values the engines read (set by the ship before it draws). */
export const ENGINE_FRAME = { sunDir: new THREE.Vector3(1, 0, 0) };
