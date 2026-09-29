import * as THREE from 'three';
import { R_EARTH, bodyDir } from './sim.js';

// The aurorae: curtains of light hung along the geomagnetic field in the two auroral ovals.
//
// The ovals are fixed to the Sun and the magnetic pole, not to the ground: each is drawn in a
// frame whose axis is that hemisphere's geomagnetic pole (turning with the planet) and whose
// +x points to magnetic midnight (away from the Sun), so the Earth turns beneath them. The oval
// sits near 67 degrees magnetic latitude at midnight and 77 at noon.
//
// Discrete arcs are real ribbons of geometry (along the arc x up the field line); the vertex
// shader folds and curls them with waves that travel along the arc, and a substorm cycle
// brightens the midnight sector and sends a westward-travelling surge round the oval. The
// fragment shader draws the physics of the emission: a sharp lower border near 100 km, where
// the electrons stop, with a pink N2 fringe when the arc is active; the green 557.7 nm oxygen
// line peaking near 110 - 150 km; the red 630 nm oxygen line above 200 km; rays along the field
// lines drifting along the arc; and the brightness of a thin emitting sheet, faint face-on and
// bright when seen edge-on. The diffuse aurora is a horizontal band at ~110 km under the arcs,
// with slowly pulsating patches. Everything is additive (alpha 0) and hidden on the dayside.

// geomagnetic north pole (body frame): the dipole has drifted since the second millennium
export const MAG_POLE_LAT = 80.4 * Math.PI / 180;
export const MAG_POLE_LON = -72.6 * Math.PI / 180;
export const H_BOTTOM = 96;       // km, lowest lower border
export const H_TOP_MAX = 420;     // km, tallest rays

const RE = R_EARTH.toFixed(1);

const COMMON = /* glsl */ `
uniform float uTime;
uniform float uActivity;     // 0 quiet .. 1 substorm
uniform float uSurge;        // magnetic local time (rad) of the westward travelling surge
uniform vec3 uSunDir;
uniform float uGain;
const float RE = ${RE};
float ovalColat(float phi) { return 0.314 + 0.087 * cos(phi); }   // 18 deg + 5 deg toward midnight
`;

const ARC_VERT = /* glsl */ `
attribute vec4 aArc;      // centre MLT (rad), half span (rad), colatitude offset (rad), seed
attribute vec2 aH;        // lower border, top (km)
attribute vec2 aSV;       // s along the arc (-1..1), v up the curtain (0..1)
${COMMON}
varying vec3 vPosW;
varying vec3 vNormW;
varying vec2 vSV;
varying float vH;
varying float vU;          // km along the arc
varying float vPhi;
varying float vSeed;

vec3 arcPos(float s, float v) {
  float seed = aArc.w;
  float phi = aArc.x + s * aArc.y;
  float t = uTime;
  float act = 0.5 + 0.5 * uActivity;
  // folds travelling along the arc at several scales (hundreds of km, tens, a few)
  float fold = 0.012 * sin(phi * 7.0 + t * 0.045 + seed * 6.28)
             + 0.0065 * sin(phi * 19.0 - t * 0.13 + seed * 17.0) * act
             + 0.0028 * sin(phi * 53.0 + t * 0.41 + seed * 29.0) * act
             + 0.0011 * sin(phi * 131.0 - t * 1.1 + seed * 3.0) * uActivity;
  // the surge bulges the oval poleward where it passes
  float dS = phi - uSurge;
  float surge = exp(-dS * dS / 0.18) * uActivity;
  float th = ovalColat(phi) + aArc.z + fold - 0.03 * surge;
  // the field lines lean a little poleward with height (inclination ~78 deg)
  th -= 0.0035 * v;
  float h = mix(aH.x, aH.y, v);
  float R = RE + h;
  return R * vec3(sin(th) * cos(phi), sin(th) * sin(phi), cos(th));
}

void main() {
  float s = aSV.x, v = aSV.y;
  vec3 p = arcPos(s, v);
  float e = 0.004 / max(aArc.y, 0.05);
  vec3 tg = arcPos(s + e, v) - arcPos(s - e, v);
  vec3 up = normalize(p);
  vec3 n = normalize(cross(tg, up) + 1e-6);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vPosW = w.xyz;
  vNormW = normalize(mat3(modelMatrix) * n);
  vSV = aSV;
  vH = mix(aH.x, aH.y, v);
  float phi = aArc.x + s * aArc.y;
  vPhi = phi;
  vU = phi * (RE + 110.0) * 0.33;
  vSeed = aArc.w;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const EMISSION = /* glsl */ `
float au_hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float au_noise(float x) {
  float i = floor(x), f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(au_hash(i), au_hash(i + 1.0), u);
}
// the colour of the aurora at height h (km): the N2 fringe at the lower border, the green oxygen
// line, the red oxygen line of the thin upper air
vec3 au_colour(float h, float fringe) {
  float g = exp(-pow(max(h - 118.0, 0.0) / 60.0, 1.6)) * smoothstep(92.0, 104.0, h);
  float r = smoothstep(165.0, 250.0, h) * exp(-max(h - 260.0, 0.0) / 120.0);
  float b = exp(-abs(h - 100.0) / 7.0) * fringe;
  return vec3(0.22, 1.0, 0.42) * g + vec3(0.95, 0.12, 0.2) * r * 0.42 + vec3(0.85, 0.22, 0.75) * b * 0.9;
}
// the aurora is only seen against the night: the sunlit disc drowns it
float au_night(vec3 pw) {
  float mu = dot(normalize(pw), uSunDir);
  return 1.0 - smoothstep(-0.22, 0.02, mu);
}
`;

const ARC_FRAG = /* glsl */ `
${COMMON}
varying vec3 vPosW;
varying vec3 vNormW;
varying vec2 vSV;
varying float vH;
varying float vU;
varying float vPhi;
varying float vSeed;
${EMISSION}
void main() {
  float night = au_night(vPosW);
  if (night <= 0.0) discard;
  float s = vSV.x, v = vSV.y;
  float t = uTime;
  // rays: the field-aligned striations, a few km apart, drifting along the arc
  float drift = t * (0.8 + 0.6 * vSeed);
  float r1 = au_noise(vU * 0.55 - drift + vSeed * 50.0);
  float r2 = au_noise(vU * 1.9 + drift * 1.7 + vSeed * 90.0);
  float ray = pow(r1, 2.5) * 0.65 + pow(r2, 3.0) * 0.35;
  // the arc breaks up along its length into brighter and darker stretches
  float patchN = au_noise(vU * 0.018 + t * 0.03 + vSeed * 13.0);
  float patchI = 0.35 + 0.9 * smoothstep(0.25, 0.8, patchN);
  // the substorm: the midnight sector brightens and the surge runs westward
  float dS = vPhi - uSurge;
  float surge = exp(-dS * dS / 0.18) * uActivity;
  float midnight = exp(-vPhi * vPhi / 0.9);
  float act = 0.35 + 0.65 * uActivity * (0.4 + 0.6 * midnight) + 1.4 * surge;
  // vertical profile: a sharp lower border, then decay, the rays reaching much higher
  float border = smoothstep(0.0, 0.035, v);
  float decay = exp(-v * mix(4.2, 1.2, ray));
  float I = border * decay * (0.25 + 1.3 * ray) * patchI * act;
  // the ends of the arc fade out
  I *= smoothstep(1.0, 0.7, abs(s));
  // a thin emitting sheet: bright edge-on, faint face-on
  vec3 V = normalize(cameraPosition - vPosW);
  float path = 1.0 / max(abs(dot(vNormW, V)), 0.14);
  vec3 col = au_colour(vH, 0.3 + 0.7 * uActivity) * I * min(path, 7.0);
  gl_FragColor = vec4(col * uGain * night * 0.05, 0.0);
}
`;

const OVAL_VERT = /* glsl */ `
attribute vec2 aPC;       // magnetic local time (rad), band coordinate (-1..1)
${COMMON}
varying vec3 vPosW;
varying vec3 vUp;
varying vec2 vPC;
void main() {
  float phi = aPC.x;
  float th = ovalColat(phi) + 0.035 + aPC.y * 0.075;
  float R = RE + 112.0;
  vec3 p = R * vec3(sin(th) * cos(phi), sin(th) * sin(phi), cos(th));
  vec4 w = modelMatrix * vec4(p, 1.0);
  vPosW = w.xyz;
  vUp = normalize(mat3(modelMatrix) * p);
  vPC = aPC;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const OVAL_FRAG = /* glsl */ `
${COMMON}
varying vec3 vPosW;
varying vec3 vUp;
varying vec2 vPC;
${EMISSION}
void main() {
  float night = au_night(vPosW);
  if (night <= 0.0) discard;
  float y = vPC.y;
  // the diffuse band: brightest on its equatorward side, soft edges
  float yb = (y + 0.25) / 0.55;
  float band = exp(-yb * yb);
  // pulsating patches tens of km across, each on its own few-second rhythm
  float u = vPC.x * 60.0;
  float cell = floor(u) + floor((y + 1.0) * 4.0) * 97.0;
  float ph = au_hash(cell);
  float pulse = 0.55 + 0.45 * smoothstep(0.2, 0.9, sin(uTime * (0.6 + 0.9 * ph) + ph * 40.0));
  float pat = 0.6 + 0.4 * au_noise(u * 0.7 + y * 3.0 + ph);
  float midnight = 0.45 + 0.55 * exp(-vPC.x * vPC.x / 1.6);
  vec3 V = normalize(cameraPosition - vPosW);
  float path = 1.0 / max(abs(dot(vUp, V)), 0.1);
  float I = band * pulse * pat * midnight * (0.4 + 0.6 * uActivity);
  vec3 col = vec3(0.25, 1.0, 0.45) * I * min(path, 9.0);
  gl_FragColor = vec4(col * uGain * night * 0.03, 0.0);
}
`;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * The arcs of one hemisphere: [{ c (MLT centre, rad), span (half, rad), dth (colatitude offset,
 * rad), seed, h0, h1 (km) }]. Most hang in the evening-to-midnight sector, where the aurora is
 * brightest; a few thin poleward arcs and a long dawn arc complete the oval.
 */
export function arcLayout(seed, count) {
  const r = rng(seed);
  const arcs = [];
  for (let i = 0; i < count; i++) {
    const kind = i % 4;
    let c, span, dth, h0, h1;
    if (kind === 0 || kind === 1) {          // the main evening/midnight arcs
      c = -0.2 + (r() - 0.5) * 1.4;
      span = 0.55 + r() * 0.7;
      dth = (r() - 0.5) * 0.05;
      h0 = H_BOTTOM + r() * 14;
      h1 = h0 + 150 + r() * 140;
    } else if (kind === 2) {                 // thin poleward arcs
      c = (r() - 0.5) * 2.6;
      span = 0.3 + r() * 0.5;
      dth = -0.05 - r() * 0.04;
      h0 = H_BOTTOM + 10 + r() * 20;
      h1 = h0 + 90 + r() * 110;
    } else {                                 // the dawn and dusk arcs
      c = (r() < 0.5 ? -1 : 1) * (1.2 + r() * 0.9);
      span = 0.35 + r() * 0.55;
      dth = (r() - 0.3) * 0.05;
      h0 = H_BOTTOM + 6 + r() * 16;
      h1 = h0 + 110 + r() * 120;
    }
    arcs.push({ c, span, dth, seed: r(), h0, h1: Math.min(h1, H_TOP_MAX) });
  }
  return arcs;
}

/** Ribbon geometry for a set of arcs: nS segments along each, nV rows up the curtain. */
export function buildArcGeometry(arcs, nS, nV) {
  const nVert = arcs.length * (nS + 1) * (nV + 1);
  const pos = new Float32Array(nVert * 3);   // unused by the shader (bounds only)
  const aArc = new Float32Array(nVert * 4), aH = new Float32Array(nVert * 2), aSV = new Float32Array(nVert * 2);
  const idx = new Uint32Array(arcs.length * nS * nV * 6);
  let vi = 0, ii = 0;
  const R0 = R_EARTH + 200;
  for (const a of arcs) {
    const base = vi;
    for (let i = 0; i <= nS; i++) {
      const s = -1 + (2 * i) / nS;
      for (let j = 0; j <= nV; j++) {
        // rows packed toward the lower border, where the light is
        const v = Math.pow(j / nV, 1.6);
        const phi = a.c + s * a.span, th = 0.314 + 0.087 * Math.cos(phi);
        pos[vi * 3] = R0 * Math.sin(th) * Math.cos(phi); pos[vi * 3 + 1] = R0 * Math.sin(th) * Math.sin(phi); pos[vi * 3 + 2] = R0 * Math.cos(th);
        aArc.set([a.c, a.span, a.dth, a.seed], vi * 4);
        aH[vi * 2] = a.h0; aH[vi * 2 + 1] = a.h1;
        aSV[vi * 2] = s; aSV[vi * 2 + 1] = v;
        vi++;
      }
    }
    for (let i = 0; i < nS; i++) for (let j = 0; j < nV; j++) {
      const a0 = base + i * (nV + 1) + j, b0 = a0 + nV + 1;
      idx[ii++] = a0; idx[ii++] = b0; idx[ii++] = a0 + 1;
      idx[ii++] = a0 + 1; idx[ii++] = b0; idx[ii++] = b0 + 1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aArc', new THREE.BufferAttribute(aArc, 4));
  g.setAttribute('aH', new THREE.BufferAttribute(aH, 2));
  g.setAttribute('aSV', new THREE.BufferAttribute(aSV, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R_EARTH + H_TOP_MAX + 50);
  return g;
}

/** The diffuse oval: a band of nP x nB quads round the magnetic pole. */
export function buildOvalGeometry(nP, nB) {
  const n = (nP + 1) * (nB + 1);
  const pos = new Float32Array(n * 3), aPC = new Float32Array(n * 2);
  const idx = new Uint32Array(nP * nB * 6);
  let vi = 0, ii = 0;
  for (let i = 0; i <= nP; i++) {
    const phi = -Math.PI + (2 * Math.PI * i) / nP;
    for (let j = 0; j <= nB; j++) {
      const y = -1 + (2 * j) / nB;
      const th = 0.314 + 0.087 * Math.cos(phi) + 0.035 + y * 0.075, R = R_EARTH + 112;
      pos.set([R * Math.sin(th) * Math.cos(phi), R * Math.sin(th) * Math.sin(phi), R * Math.cos(th)], vi * 3);
      aPC[vi * 2] = phi; aPC[vi * 2 + 1] = y;
      vi++;
    }
  }
  for (let i = 0; i < nP; i++) for (let j = 0; j < nB; j++) {
    const a0 = i * (nB + 1) + j, b0 = a0 + nB + 1;
    idx[ii++] = a0; idx[ii++] = b0; idx[ii++] = a0 + 1;
    idx[ii++] = a0 + 1; idx[ii++] = b0; idx[ii++] = b0 + 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPC', new THREE.BufferAttribute(aPC, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R_EARTH + 200);
  return g;
}

const _pole = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();

export class Aurora {
  constructor(space, q = {}) {
    this.space = space;
    const hi = (q.earthQ ?? 2) >= 2;
    this.nS = hi ? 720 : 360;
    this.nV = hi ? 18 : 10;
    this.uniforms = {
      uTime: { value: 0 }, uActivity: { value: 0.5 }, uSurge: { value: 0 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uGain: { value: 1 },
    };
    const mk = (vert, frag) => new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    });
    this.arcMat = mk(ARC_VERT, ARC_FRAG);
    this.ovalMat = mk(OVAL_VERT, OVAL_FRAG);
    this.group = new THREE.Group();
    this.group.name = 'aurora';
    this.hemis = [];
    const ovalGeo = buildOvalGeometry(hi ? 512 : 256, 12);
    for (const [sign, seed] of [[1, 5021], [-1, 1905]]) {
      const frame = new THREE.Group();
      frame.matrixAutoUpdate = false;
      const arcs = new THREE.Mesh(buildArcGeometry(arcLayout(seed, hi ? 14 : 8), this.nS, this.nV), this.arcMat);
      const oval = new THREE.Mesh(ovalGeo, this.ovalMat);
      for (const m of [arcs, oval]) { m.frustumCulled = false; m.renderOrder = 7; frame.add(m); }
      oval.renderOrder = 6;
      this.group.add(frame);
      this.hemis.push({ sign, frame, arcs, oval });
    }
    this.poleBody = new THREE.Vector3();
    bodyDir(MAG_POLE_LAT, MAG_POLE_LON, this.poleBody);
    if (space && space.scene) space.scene.add(this.group);
    if (space && space.addBody) space.addBody('aurora', [this.group], (o) => o.set(0, 0, 0), R_EARTH + H_TOP_MAX + 40);
    this.triangles = this.hemis.reduce((n, h) => n + h.arcs.geometry.index.count / 3 + h.oval.geometry.index.count / 3, 0);
  }

  /** Substorm cycle (~7 min real time): growth, a quick onset, the surge westward, recovery. */
  static activity(t) {
    const P = 420, x = ((t % P) + P) % P / P;
    const onset = 0.55;
    if (x < onset) return { act: 0.25 + 0.2 * (x / onset), surge: 0 };
    const y = (x - onset) / (1 - onset);
    return { act: 0.45 + 0.55 * Math.exp(-y * 3.0) * Math.min(1, y * 25), surge: -2.2 * Math.sqrt(y) };
  }

  update(sim, realTime, dt, space) {
    const u = this.uniforms;
    u.uTime.value = realTime;
    const a = Aurora.activity(realTime);
    u.uActivity.value = a.act;
    u.uSurge.value = a.surge;
    u.uSunDir.value.copy(sim.sunDir);
    // magnetic pole in the inertial frame
    _pole.copy(this.poleBody).applyMatrix4(sim.earthMat).normalize();
    for (const h of this.hemis) {
      _z.copy(_pole).multiplyScalar(h.sign);
      // +x to magnetic midnight: away from the Sun, square to the pole
      _x.copy(sim.sunDir).multiplyScalar(-1).addScaledVector(_z, sim.sunDir.dot(_z));
      if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0);
      _x.normalize();
      _y.crossVectors(_z, _x);
      h.frame.matrix.copy(_m.makeBasis(_x, _y, _z));
      h.frame.matrixWorldNeedsUpdate = true;
    }
    // subpixel from beyond cislunar space
    const cam = space && space.camera;
    this.group.visible = !cam || cam.position.length() < 250000;
  }
}
