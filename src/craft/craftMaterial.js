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
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  vN = normalize(normalMatrix * normal);
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
varying vec3 vFac;
varying vec3 vView;
varying vec3 vN;
${SUNLIGHT_GLSL}
${NOISE_GLSL}
float gridLine(float x, float p, float w, float fw) { float d = abs(fract(x / p + 0.5) - 0.5) * p; return 1.0 - smoothstep(w, w + fw, d); }
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(-vView);
  float k = floor(vFac.z + 0.5);
  vec2 f = vFac.xy;
  vec2 fw = max(fwidth(f), vec2(1e-3));
  float px = max(fw.x, fw.y);
  vec3 sunL = spaceSunlight(uTransmittanceLUT, uObjWorld, uSunWorld) * uSunE;
  vec3 alb = vec3(0.8, 0.79, 0.76);
  float rough = 0.38, metal = 0.08;
  vec3 em = vec3(0.0);
  float det = 1.0 - smoothstep(0.6, 3.0, px / 4.0);
  if (k < 0.5) {
    // glazing with rooms behind it: 4 m bays, 3.6 m decks
    vec2 cell = floor(f / vec2(4.0, 3.6));
    float h = hash12(cell);
    float frame = max(gridLine(f.x, 4.0, 0.18, fw.x), gridLine(f.y, 3.6, 0.2, fw.y)) * det;
    alb = mix(vec3(0.05, 0.07, 0.09), vec3(0.6, 0.6, 0.58), frame);
    rough = mix(0.06, 0.4, frame); metal = mix(0.6, 0.1, frame);
    float lit = step(1.0 - uLit, h);
    vec3 lamp = mix(vec3(1.0, 0.74, 0.48), vec3(0.9, 0.92, 1.0), step(0.85, fract(h * 7.3)));
    em = lamp * mix(uLit * 0.8, lit, det) * (1.0 - frame) * 0.55;
  } else if (k < 1.5) {
    // pearl composite in 12 x 7 m plates, each a shade different, with fine seams
    vec2 pc = floor(f / vec2(12.0, 7.0));
    float h = hash12(pc + 3.0);
    alb *= mix(1.0, 0.93 + 0.1 * h, det);
    float seam = max(gridLine(f.x, 12.0, 0.08, fw.x), gridLine(f.y, 7.0, 0.08, fw.y)) * det;
    alb *= 1.0 - 0.35 * seam;
    rough = 0.34 + 0.12 * h * det;
  } else if (k < 2.5) {
    alb = vec3(0.9, 0.85, 0.75);
    em = vec3(1.0, 0.8, 0.56) * (1.1 + 0.25 * sin(uTime * 0.7 + f.y * 0.01));
  } else if (k < 3.5) {
    float g = vnoise(f * 0.21) * 0.6 + vnoise(f * 1.3) * 0.4 * det;
    alb = mix(vec3(0.05, 0.13, 0.035), vec3(0.2, 0.3, 0.09), g);
    rough = 0.9;
    em = vec3(1.0, 0.78, 0.5) * step(0.985, hash12(floor(f / 3.0))) * 0.8 * det;     // garden lamps
  } else if (k < 4.5) {
    float flow = pow(fract(f.y / 90.0 - uTime * 0.25), 6.0);
    alb = vec3(0.08);
    em = uAccent * (0.7 + 1.8 * flow);
  } else if (k < 7.5) {
    alb = vec3(0.03, 0.05, 0.12);
    rough = 0.12; metal = 0.7;
    alb += vec3(0.25) * max(gridLine(f.x, 1.4, 0.04, fw.x), gridLine(f.y, 1.4, 0.04, fw.y)) * det;
  } else if (k < 8.5) {
    alb = vec3(0.72, 0.52, 0.3); rough = 0.28; metal = 1.0;
  } else if (k < 9.5) {
    alb = vec3(0.62, 0.61, 0.58); rough = 0.6;
  } else if (k < 10.5) {
    alb = vec3(0.13, 0.13, 0.14); rough = 0.5; metal = 0.6;
  } else {
    // heat radiator: dark ceramic with glowing channels
    alb = vec3(0.1, 0.09, 0.085); rough = 0.7;
    float ch = gridLine(f.y, 24.0, 2.0, fw.y);
    em = vec3(1.0, 0.36, 0.12) * (0.18 + 0.5 * ch) * (0.8 + 0.2 * sin(uTime * 0.3 + f.x * 0.002));
  }
  // light: the Sun, earthshine, a little ambient
  vec3 toE = uEarthView - vView;
  float dE = length(toE);
  vec3 eDir = toE / dE;
  float eSize = clamp(6371.0 / dE, 0.0, 1.0);
  vec3 earthshine = vec3(0.35, 0.5, 0.85) * uSunE * 0.3 * eSize * eSize * max(dot(N, eDir), 0.0) * max(dot(-eDir, uSunView) * 0.5 + 0.5, 0.0);
  float ndl = max(dot(N, uSunView), 0.0);
  vec3 H = normalize(V + uSunView);
  float sp = pow(max(dot(N, H), 0.0), mix(180.0, 14.0, rough)) * mix(1.8, 0.35, rough);
  vec3 F0 = mix(vec3(0.04), alb, metal);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = alb * (1.0 - metal * 0.8) / 3.14159 * (sunL * ndl + earthshine) + min((F0 + (1.0 - F0) * fres * 0.3) * sp * sunL * ndl, vec3(6.0));
  col += alb * 0.004 + em;
  gl_FragColor = vec4(col, 1.0);
}
`;

const _m = new THREE.Matrix4(), _v = new THREE.Vector3();

export function createCraftMaterial({ accent = [0.55, 0.85, 1.0], lit = 0.55 } = {}) {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTransmittanceLUT: U.uTransmittanceLUT, uSunE: U.uSunIlluminance,
      uSunView: { value: new THREE.Vector3(1, 0, 0) }, uSunWorld: { value: new THREE.Vector3(1, 0, 0) },
      uObjWorld: { value: new THREE.Vector3() }, uEarthView: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uAccent: { value: new THREE.Color(...accent) }, uLit: { value: lit },
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
  float flick = 0.92 + 0.08 * sin(uTime * 37.0 + vQ.x * 3.0);
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
