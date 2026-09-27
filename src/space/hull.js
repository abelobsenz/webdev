import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { U } from '../core/uniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { SUNLIGHT_GLSL } from './lines.js';

// Shared material for stations and ships (km units). Surface kind per vertex:
// 0 plating, 1 habitat with windows, 2 solar / radiator panels, 3 dark truss,
// 4 emissive accent, 5 gold foil, 6 mirror (collector dishes)

export const KIND = { PLATE: 0, HAB: 1, PANEL: 2, TRUSS: 3, GLOW: 4, GOLD: 5, MIRROR: 6 };

const VERT = /* glsl */ `
attribute float aKind;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying float vKind;
void main() {
  vKind = aKind;
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  // camera-relative projection (modelViewMatrix is composed in double precision on the
  // CPU): world coordinates 42,000 km out, in float32, jittered vertices by metres each
  // frame and made coincident parts z-fight as the Harbour turned
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uTransmittanceLUT;
uniform vec3 uSunDir;
uniform float uSunE;
uniform float uTime;
uniform vec3 uEarthPos;
uniform vec3 uPointPos;        // extra light (e.g. the Hearth's disc)
uniform vec3 uPointColor;
uniform float uPattern;        // km per window cell
uniform vec3 uAccent;
uniform float uBehindMask;     // 1: fade where the Hearth's image says the disc is in front
uniform sampler2D uHearthTex;
uniform vec2 uHearthRes;
uniform float uHearthDepth;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying float vKind;
${SUNLIGHT_GLSL}
${NOISE_GLSL}
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 sunL = spaceSunlight(uTransmittanceLUT, vWorld, uSunDir) * uSunE;
  float k = floor(vKind + 0.5);
  vec3 toE = uEarthPos - vWorld;
  float dE = length(toE);
  vec3 eDir = toE / dE;
  float eSize = clamp(6400.0 / dE, 0.0, 1.0);
  vec3 earthshine = vec3(0.35, 0.5, 0.85) * uSunE * 0.3 * eSize * eSize * max(dot(N, eDir), 0.0) * max(dot(-eDir, uSunDir) * 0.5 + 0.5, 0.0);
  vec3 toP = uPointPos - vWorld;
  float dP = length(toP);
  vec3 pDir = toP / max(dP, 1e-3);
  vec3 pointL = uPointColor * max(dot(N, pDir), 0.0);
  vec3 cellP = vLocal / uPattern;
  float fw = max(max(fwidth(cellP.x), fwidth(cellP.y)), fwidth(cellP.z));
  // fine cell patterns fade to their average well before they reach a pixel, so lit
  // windows on moving or spinning hulls never sparkle frame to frame
  float detail = 1.0 - smoothstep(0.07, 0.3, fw * 4.0);
  float n = hash13(floor(cellP * vec3(1.0, 1.0, 1.0)));
  vec3 alb = vec3(0.55, 0.56, 0.58);
  float rough = 0.35, metal = 0.4;
  vec3 em = vec3(0.0);
  if (k == 1.0) {
    alb = vec3(0.62, 0.62, 0.6) * (0.85 + 0.15 * mix(0.5, n, detail));
    float lit = step(0.45, hash13(floor(cellP * vec3(2.0, 4.0, 2.0))));
    em = vec3(1.0, 0.8, 0.55) * mix(0.55, lit, detail) * 0.26;
  } else if (k == 2.0) {
    alb = vec3(0.03, 0.05, 0.1);
    rough = 0.08; metal = 0.9;
    float grid = 1.0 - smoothstep(0.0, 0.08 + fw, min(abs(fract(cellP.x * 0.5) - 0.5), abs(fract(cellP.z * 0.5) - 0.5)));
    alb = mix(alb, vec3(0.3), grid * 0.4 * detail);
  } else if (k == 3.0) {
    alb = vec3(0.16, 0.16, 0.17); rough = 0.6;
  } else if (k == 4.0) {
    em = uAccent * (1.2 + 0.6 * sin(uTime * 2.0 + vLocal.x * 0.3));
    alb = vec3(0.1);
  } else if (k == 5.0) {
    alb = vec3(0.85, 0.62, 0.25); rough = 0.25; metal = 1.0;
  } else if (k == 6.0) {
    alb = vec3(0.9, 0.92, 0.95); rough = 0.06; metal = 1.0;
    float facet = hash13(floor(cellP * 0.5));
    alb *= 0.85 + 0.15 * mix(0.5, facet, detail);
  } else {
    alb *= 0.8 + 0.2 * mix(0.5, n, detail);
  }
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 H = normalize(V + uSunDir);
  // glints stay physically shaped but bounded: flat kilometre-scale panels used to flare
  // the whole screen white for an instant as the view swept through the mirror angle
  float sp = pow(max(dot(N, H), 0.0), mix(70.0, 10.0, rough)) * mix(0.55, 0.25, rough);
  vec3 spec = mix(vec3(0.04), alb, metal) * sp;
  vec3 Hp = normalize(V + pDir);
  float spp = pow(max(dot(N, Hp), 0.0), mix(70.0, 10.0, rough)) * mix(0.55, 0.25, rough);
  float diffK = k == 6.0 ? 0.03 : (1.0 - metal * 0.7);
  vec3 col = alb * diffK / 3.14159 * (sunL * ndl + earthshine + pointL) + min(spec * sunL * ndl, sunL * 0.6) + min(mix(vec3(0.04), alb, metal) * spp * pointL, pointL * 0.6);
  col += alb * 0.004;
  col += em;
  // (no random blinking hull cells: they read as flashing white quads once bloomed;
  //  the stations carry explicit beacon lamps instead)
  float a = 1.0;
  if (uBehindMask > 0.5) {
    vec4 hb = texture(uHearthTex, gl_FragCoord.xy / uHearthRes);
    float viewD = length(vWorld - cameraPosition);
    if (viewD > uHearthDepth) a = 1.0 - hb.a;
  }
  if (a < 0.02) discard;
  gl_FragColor = vec4(col * a, 1.0);
}
`;

export function createHullMaterial({ pattern = 0.06, accent = [0.5, 0.85, 1.0], behindMask = false } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTransmittanceLUT: U.uTransmittanceLUT, uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunE: U.uSunIlluminance,
      uTime: { value: 0 }, uEarthPos: { value: new THREE.Vector3() },
      uPointPos: { value: new THREE.Vector3(1e9, 0, 0) }, uPointColor: { value: new THREE.Color(0, 0, 0) },
      uPattern: { value: pattern }, uAccent: { value: new THREE.Color(...accent) },
      uBehindMask: { value: behindMask ? 1 : 0 }, uHearthTex: { value: null }, uHearthRes: { value: new THREE.Vector2(1, 1) }, uHearthDepth: { value: 1e12 },
    },
    side: THREE.DoubleSide,
  });
}

export function tag(geo, kind) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(new Float32Array(n).fill(kind), 1));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aKind'].includes(k)) g.deleteAttribute(k);
  return g;
}

export function merge(list) {
  const g = mergeGeometries(list, false);
  g.computeBoundingSphere();
  return g;
}

/** A cylinder between two points (for trusses, spokes). */
export function beam(a, b, r, kind, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a);
  const L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1, false);
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return tag(g, kind);
}
