import * as THREE from 'three';
import { createCraftMaterial, updateCraftMaterial } from '../craft/craftMaterial.js';
import { CRAFT_FRAME, KM } from './craftMesh.js';
import { R_EARTH } from './sim.js';
import { MU, J2, sunSyncInclination } from './kepler.js';

// The working satellites of the low and middle shell: Walker constellations on real circular
// orbits, every plane precessing under J2. Far off they are points computed on the GPU from
// their elements (one draw for all of them): sunlit ones glint in the colour of their skins,
// the occasional panel flares as it catches the Sun, and in the Earth's shadow only their
// beacons show, breathing slowly. Within a few tens of km of the camera the nearest are real
// models (instanced, three designs), placed by a CPU mirror of the same orbit maths.
//
// Shells (altitude km, inclination, planes x per plane, kind, walker phasing F). All above
// the Halo (620 km): its deck and tethers are where every lower orbit would cross the equator.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const R_J2 = 6378.137;
export const SHELLS = [
  { alt: 720, inc: 53, P: 36, S: 30, kind: 0, F: 11, size: 9 },
  { alt: 760, inc: 70, P: 24, S: 20, kind: 0, F: 7, size: 9 },
  { alt: 690, inc: 'sso', P: 18, S: 24, kind: 1, F: 5, size: 7 },
  { alt: 1150, inc: 40, P: 20, S: 30, kind: 0, F: 3, size: 11 },
  { alt: 1400, inc: 86, P: 12, S: 24, kind: 1, F: 2, size: 8 },
  { alt: 2400, inc: 60, P: 10, S: 12, kind: 2, F: 1, size: 14 },
  { alt: 8000, inc: 56, P: 6, S: 10, kind: 2, F: 1, size: 22 },
  { alt: 20200, inc: 55, P: 6, S: 8, kind: 2, F: 2, size: 30 },
];
const NS = SHELLS.length;
export const NEAR_KM = 32;        // real models inside this range
const SCAN_KM = 420;              // candidates kept inside this range
const NEAR_MAX = 64;

const VERT = /* glsl */ `
attribute vec4 aOrb;     // radius (km), inclination, node at t = 0, phase at t = 0
attribute vec4 aInfo;    // shell, kind, seed, size (m)
uniform float uAng[${NS}];
uniform float uNode[${NS}];
uniform vec3 uSun;
uniform float uPx;
uniform float uTime;
uniform float uNearKm;
varying vec3 vC;
void main() {
  int s = int(aInfo.x + 0.5);
  float u = aOrb.w + uAng[s];
  float W = aOrb.z + uNode[s];
  float ci = cos(aOrb.y), si = sin(aOrb.y), cW = cos(W), sW = sin(W);
  vec3 N = vec3(cW, 0.0, -sW);
  vec3 E = vec3(-sW * ci, si, -cW * ci);
  vec3 p = aOrb.x * (N * cos(u) + E * sin(u));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(length(mv.xyz), 1e-3);
  // in the Earth's shadow? (cylindrical umbra, soft over 80 km)
  float along = dot(p, uSun);
  float q = length(p - along * uSun);
  float lit = along > 0.0 ? 1.0 : smoothstep(${(R_EARTH - 40).toFixed(1)}, ${(R_EARTH + 40).toFixed(1)}, q);
  vec3 toCam = (cameraPosition - p) / max(length(cameraPosition - p), 1e-3);
  float phase = 0.3 + 0.7 * (0.5 + 0.5 * dot(toCam, uSun));
  float kind = aInfo.y;
  float seed = aInfo.z;
  vec3 skin = kind < 0.5 ? vec3(1.0, 0.93, 0.8) : (kind < 1.5 ? vec3(1.0, 0.74, 0.5) : vec3(0.78, 0.88, 1.0));
  // reflected light: size / distance, a floor so the shell still shows as dust from the Moon
  float refl = clamp(aInfo.w * 0.02 / d, 0.0, 1.2) + 0.012;
  // panel flares: a few seconds of bright glint now and then, only when sunlit
  float g = fract(seed * 17.13 + uTime * (0.012 + 0.02 * fract(seed * 7.7)));
  float flare = smoothstep(0.0, 0.015, g) * (1.0 - smoothstep(0.015, 0.05, g)) * step(0.72, fract(seed * 3.3));
  vec3 day = skin * refl * phase * (1.0 + 7.0 * flare) * lit;
  // beacons in shadow: nav sats blue-white, the rest a dim red/green pair breathing
  float br = 0.5 + 0.5 * sin(uTime * (0.9 + 0.6 * fract(seed * 5.1)) + seed * 40.0);
  vec3 bc = kind > 1.5 ? vec3(0.55, 0.75, 1.0) : (fract(seed * 11.0) > 0.5 ? vec3(1.0, 0.18, 0.1) : vec3(0.2, 1.0, 0.4));
  vec3 night = bc * (1.0 - lit) * br * clamp(90.0 / d, 0.0, 0.5) * (kind > 1.5 ? 1.6 : 0.6);
  float fadeNear = smoothstep(uNearKm * 0.6, uNearKm * 1.2, d);
  vC = (day + night) * 2.2 * fadeNear;
  gl_PointSize = uPx * clamp(1.5 + 2.5 * flare * lit + 20.0 / d, 1.5, 3.2);
}
`;
const FRAG = /* glsl */ `
varying vec3 vC;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vC * exp(-r2 * 5.0), 0.0);
}
`;

export class Constellations {
  constructor(designs) {
    this.group = new THREE.Group();
    this.group.name = 'constellations';
    const orb = [], info = [];
    this.shells = SHELLS.map((sh, si) => {
      const a = R_EARTH + sh.alt;
      const inc = sh.inc === 'sso' ? sunSyncInclination(a) : sh.inc * DEG;
      const n = Math.sqrt(MU / (a * a * a));
      const nodeRate = -1.5 * n * J2 * (R_J2 / a) ** 2 * Math.cos(inc);
      const node0 = si * 0.37;
      for (let p = 0; p < sh.P; p++) for (let k = 0; k < sh.S; k++) {
        const seed = ((si * 977 + p * 131 + k * 17) * 0.618034) % 1;
        orb.push(a, inc, node0 + (p / sh.P) * TAU, (k / sh.S) * TAU + (p * sh.F / (sh.P * sh.S)) * TAU);
        info.push(si, sh.kind, seed, sh.size);
      }
      return { a, inc, n, nodeRate, kind: sh.kind };
    });
    this.count = orb.length / 4;
    this.orb = Float64Array.from(orb);
    this.info = Float32Array.from(info);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.count * 3), 3));
    g.setAttribute('aOrb', new THREE.Float32BufferAttribute(Float32Array.from(orb), 4));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uAng: { value: new Array(NS).fill(0) }, uNode: { value: new Array(NS).fill(0) },
        uSun: { value: new THREE.Vector3(1, 0, 0) }, uPx: { value: 3 }, uTime: { value: 0 }, uNearKm: { value: NEAR_KM },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 14;
    this.group.add(this.points);
    // near models: one instanced mesh per design, placed about a local origin near the camera
    this.near = new THREE.Group();
    this.near.userData.world = new THREE.Vector3();
    this.group.add(this.near);
    this.nearMat = createCraftMaterial({ accent: [0.6, 0.85, 1.0], lit: 0.3 });
    this.sets = designs.map((d) => {
      const im = new THREE.InstancedMesh(d.geo, this.nearMat, NEAR_MAX);
      im.count = 0;
      im.frustumCulled = false;
      im.renderOrder = 3;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.onBeforeRender = (r, sc, cam) => { updateCraftMaterial(this.nearMat, cam, CRAFT_FRAME.sunDir, this.near.userData.world, CRAFT_FRAME.time); this.nearMat.uniformsNeedUpdate = true; };
      this.near.add(im);
      return im;
    });
    this.cand = new Int32Array(512);
    this.nCand = 0;
    this.scan = 0;
    this.scanStep = 480;
    this._ang = new Float64Array(NS); this._node = new Float64Array(NS);
    this._p = new THREE.Vector3(); this._v = new THREE.Vector3(); this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
    this.nearCount = 0;
  }

  /** CPU mirror of the vertex shader: satellite i's inertial position (and along-track direction). */
  position(i, out, vel) {
    const o = this.orb, j = i * 4, si = this.info[j] | 0;
    const u = o[j + 3] + this._ang[si], W = o[j + 2] + this._node[si], inc = o[j + 1], r = o[j];
    const ci = Math.cos(inc), sn = Math.sin(inc), cW = Math.cos(W), sW = Math.sin(W), cu = Math.cos(u), su = Math.sin(u);
    const Nx = cW, Nz = -sW, Ex = -sW * ci, Ey = sn, Ez = -cW * ci;
    out.set(r * (Nx * cu + Ex * su), r * (Ey * su), r * (Nz * cu + Ez * su));
    if (vel) vel.set(-Nx * su + Ex * cu, Ey * cu, -Nz * su + Ez * cu);
    return out;
  }

  update(t, realTime, sun, cam, H) {
    const U = this.mat.uniforms;
    for (let s = 0; s < NS; s++) {
      const sh = this.shells[s];
      this._ang[s] = (sh.n * t) % TAU;
      this._node[s] = (sh.nodeRate * t) % TAU;
      U.uAng.value[s] = this._ang[s];
      U.uNode.value[s] = this._node[s];
    }
    U.uSun.value.copy(sun);
    U.uTime.value = realTime;
    this._nearModels(cam);
  }

  _nearModels(cam) {
    for (const im of this.sets) im.count = 0;
    this.nearCount = 0;
    if (!cam) return;
    const cp = cam.position;
    const alt = cp.length() - R_EARTH;
    // only in the low shell (the few MEO beacons are left as points)
    if (alt > 3200 || alt < 0) { this.nCand = 0; return; }
    const p = this._p;
    // keep candidates still in range, then scan a slice of the catalogue for new ones
    let n = 0;
    for (let k = 0; k < this.nCand; k++) {
      const i = this.cand[k];
      if (this.position(i, p).distanceToSquared(cp) < SCAN_KM * SCAN_KM && n < this.cand.length) this.cand[n++] = i;
    }
    const end = Math.min(this.scan + this.scanStep, this.count);
    for (let i = this.scan; i < end; i++) {
      if (this.position(i, p).distanceToSquared(cp) < SCAN_KM * SCAN_KM && n < this.cand.length) {
        let dup = false;
        for (let k = 0; k < n; k++) if (this.cand[k] === i) { dup = true; break; }
        if (!dup) this.cand[n++] = i;
      }
    }
    this.scan = end >= this.count ? 0 : end;
    this.nCand = n;
    // place models round a local origin at the camera (small numbers in the instance matrices)
    const origin = this.near.userData.world.copy(cp);
    this.near.position.copy(origin);
    for (let k = 0; k < n; k++) {
      const i = this.cand[k];
      this.position(i, p, this._v);
      if (p.distanceToSquared(cp) > NEAR_KM * NEAR_KM) continue;
      const im = this.sets[this.info[i * 4 + 1] | 0];
      if (!im || im.count >= NEAR_MAX) continue;
      this._y.copy(p).normalize();
      this._z.copy(this._v).normalize();
      this._x.crossVectors(this._y, this._z);
      this._m.makeBasis(this._x, this._y, this._z).scale(this._x.set(KM, KM, KM));
      this._m.setPosition(p.sub(origin));
      im.setMatrixAt(im.count++, this._m);
      this.nearCount++;
    }
    for (const im of this.sets) if (im.count) im.instanceMatrix.needsUpdate = true;
  }

  setSize(w, h) { this.mat.uniforms.uPx.value = Math.max(2, h / 400); }
}
