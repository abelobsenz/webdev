import * as THREE from 'three';
import { ATMO_CONSTANTS, ATMO_SAMPLING } from '../shaders/atmosphere.glsl.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/uniforms.js';

// Screen-space ribbons for tethers: a true width in km, never thinner than a
// minimum pixel width (brightness scaled by coverage so thin lines don't shimmer).

/** Sunlight reaching a point in space (inertial km), with the Earth's shadow and a reddened penumbra. */
export const SUNLIGHT_GLSL = /* glsl */ `
${ATMO_CONSTANTS}
${ATMO_SAMPLING}
#ifndef SPACE_SUNLIGHT
#define SPACE_SUNLIGHT
vec3 spaceSunlight(sampler2D lut, vec3 p, vec3 s) {
  float b = dot(p, s);
  if (b > 0.0) return vec3(1.0);
  vec3 closest = p - s * b;
  float hMin = length(closest) - Rg;
  if (hMin > 110.0) return vec3(1.0);
  // light grazing the atmosphere: transmittance along the full chord
  vec3 T = sampleTransmittance(lut, Rg + max(hMin, 0.5), 0.0);
  T = T * T;
  float lit = smoothstep(-4.0, 14.0, hMin);
  return mix(T, vec3(1.0), smoothstep(40.0, 110.0, hMin)) * lit;
}
#endif
`;

const VERT = /* glsl */ `
attribute vec3 aNext;
attribute float aSide;
attribute vec2 aData;          // x: km along the line, y: line id
uniform float uWidthKm;
uniform float uMinPx;
uniform vec2 uResolution;
uniform vec3 uBandAxis;        // non-zero: a band of width uWidthKm along this axis (world)
varying vec2 vData;
varying float vCoverage;
varying vec3 vWorld;
varying float vAcross;
varying float vPx;
void main() {
  vData = aData;
  vAcross = aSide;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  // project camera-relative (double-precision modelViewMatrix): world km in float32 put
  // metres of jitter on a tether seen from the Harbour
  vec4 mv0 = modelViewMatrix * vec4(position, 1.0);
  vec4 c0 = projectionMatrix * mv0;
  vec4 c1 = projectionMatrix * (modelViewMatrix * vec4(aNext, 1.0));
  // pull segment ends that lie behind the camera onto the near side
  const float EPS = 1e-3;
  if (c0.w < EPS && c1.w > EPS) c0 = mix(c0, c1, (EPS - c0.w) / (c1.w - c0.w));
  else if (c1.w < EPS && c0.w > EPS) c1 = mix(c0, c1, (EPS - c0.w) / (c1.w - c0.w));
  // keep the direction stable when one end is behind the camera
  vec2 s0 = c0.xy / max(abs(c0.w), 1e-6) * uResolution * 0.5;
  vec2 s1 = c1.xy / max(abs(c1.w), 1e-6) * uResolution * 0.5;
  vec2 dir = s1 - s0;
  dir = length(dir) > 1e-5 ? normalize(dir) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float dist = max(length(mv0.xyz), 1e-3);
  float pxPerKm = uResolution.y * 0.5 * projectionMatrix[1][1] / dist;
  float wpx = uWidthKm * pxPerKm;
  if (dot(uBandAxis, uBandAxis) > 0.5) {
    vec3 vd = normalize(w.xyz - cameraPosition);
    float ca = dot(vd, uBandAxis);
    wpx *= sqrt(max(1.0 - ca * ca, 0.0)) + 0.06;
  }
  vPx = wpx;
  float px = max(wpx, uMinPx);
  vCoverage = clamp(wpx / px, 0.0, 1.0);
  c0.xy += perp * aSide * px / uResolution * c0.w;
  gl_Position = c0;
}
`;

export function createRibbonMaterial({ widthKm = 0.03, minPx = 1.2, frag, uniforms = {}, blending = THREE.AdditiveBlending }) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
uniform sampler2D uTransmittanceLUT;
uniform vec3 uSunDir;
uniform float uSunE;
uniform float uTime;
uniform float uSimT;
varying vec2 vData;
varying float vCoverage;
varying vec3 vWorld;
varying float vAcross;
varying float vPx;
${SUNLIGHT_GLSL}
${NOISE_GLSL}
${frag}
`,
    uniforms: {
      uWidthKm: { value: widthKm }, uMinPx: { value: minPx }, uResolution: { value: new THREE.Vector2(1920, 1080) },
      uTransmittanceLUT: U.uTransmittanceLUT, uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunE: U.uSunIlluminance,
      uTime: { value: 0 }, uSimT: { value: 0 }, uBandAxis: { value: new THREE.Vector3(0, 0, 0) },
      ...uniforms,
    },
    // Screen expansion changes winding with the projected tangent. Optical ribbons
    // must survive both orientations, including the far lunar and Earth ring bands.
    side: THREE.DoubleSide, transparent: true, blending, depthWrite: false, depthTest: true,
  });
}

/** lines: array of { pts: Vector3[], along: number[] (km), id } */
export function buildRibbonGeometry(lines) {
  const pos = [], next = [], side = [], data = [], idx = [];
  let base = 0;
  for (const L of lines) {
    const P = L.pts;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      const q = i < P.length - 1 ? P[i + 1] : p.clone().multiplyScalar(2).sub(P[i - 1]);
      for (const s of [-1, 1]) { pos.push(p.x, p.y, p.z); next.push(q.x, q.y, q.z); side.push(s); data.push(L.along[i], L.id); }
      if (i < P.length - 1) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    }
    base += P.length * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aNext', new THREE.Float32BufferAttribute(next, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('aData', new THREE.Float32BufferAttribute(data, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
