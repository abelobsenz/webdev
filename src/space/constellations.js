import * as THREE from 'three';
import { createCraftMaterial, updateCraftMaterial } from '../craft/craftMaterial.js';
import { CRAFT_FRAME, KM } from './craftMesh.js';
import { R_EARTH } from './sim.js';
import { MU, J2, sunSyncInclination } from './kepler.js';

// The working satellites of the low and middle shell: Walker constellations on real circular
// orbits, every plane precessing under J2. They are drawn the way the eye would see them from
// orbit, which is mostly not at all: a satellite a few metres across is a faint moving star
// within a few hundred km, and nothing beyond. What does carry is the flare: each satellite
// has a flat panel (an antenna face or a radiator, fixed in its orbital frame) that throws the
// Sun at the viewer for a few seconds when the geometry lines up, like the old Iridium flares.
// So far off, the shell is a scatter of brief sunlit glints that come and go, never a traced
// ring; in the Earth's shadow there is nothing but, close to, the nav strobes.
//
// One draw for all of them (points computed on the GPU from their elements; the dim ones are
// clipped in the vertex shader so they cost no fill). Within a few tens of km of the camera the
// nearest are real models (instanced, three designs), placed by a CPU mirror of the same maths;
// apparent() mirrors the brightness model for the checks.
//
// Shells (altitude km, inclination, planes x per plane, kind, walker phasing F, size m). All
// above the Halo (620 km): its deck and tethers are where every lower orbit would cross the
// equator.

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

// The brightness model (shared by the shader and apparent()): diffuse light from a Lambert
// body of the satellite's size, and a specular flare off its panel. K scales m^2 / km^2 to
// display radiance: a 9 m satellite is a faint star (0.3) at 150 km and gone by 700 km; its
// flare, a sixty-fold specular peak in a lobe about two degrees wide, carries to ~2,500 km.
export const SAT = {
  K: 280, ALBEDO: 0.3, FLARE: 60, LOBE: 3000, MAXB: 1.4, CUT: 0.004,
  PEN: 8,                          // km: half-width of the penumbra at the umbra's edge
  STROBE_KM: 40,                   // nav strobes only read inside this range
};

const VERT = /* glsl */ `
attribute vec4 aOrb;     // radius (km), inclination, node at t = 0, phase at t = 0
attribute vec4 aInfo;    // shell, kind, seed, size (m)
attribute vec2 aPanel;   // the flare panel's tilt off nadir, and the heading of that tilt (rad, 0 along the track)
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
  vec3 rh = N * cos(u) + E * sin(u);
  vec3 tv = -N * sin(u) + E * cos(u);
  vec3 p = aOrb.x * rh;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 toCam = cameraPosition - p;
  float d = max(length(toCam), 1e-3);
  vec3 v = toCam / d;
  // the Earth's shadow: a cylindrical umbra with a thin penumbra
  float along = dot(p, uSun);
  float q = length(p - along * uSun);
  float lit = along > 0.0 ? 1.0 : smoothstep(${(R_EARTH - SAT.PEN).toFixed(1)}, ${(R_EARTH + SAT.PEN).toFixed(1)}, q);
  // diffuse: a Lambert sphere's phase law (full when the Sun is behind the viewer)
  float ca = clamp(dot(v, uSun), -1.0, 1.0);
  float al = acos(ca);
  float phase = max(((3.14159265 - al) * ca + sin(al)) / 3.14159265, 0.0);
  float area = aInfo.w * aInfo.w;
  float inv = 1.0 / (d * d);
  float diff = ${SAT.K.toFixed(1)} * ${SAT.ALBEDO.toFixed(2)} * area * phase * inv;
  // flare: the panel's normal, off nadir by aPanel.x toward heading aPanel.y in the local
  // horizontal, mirrors the Sun at the viewer when it bisects the two
  vec3 ct = cross(rh, tv);
  vec3 hz = tv * cos(aPanel.y) + ct * sin(aPanel.y);
  vec3 pn = -rh * cos(aPanel.x) + hz * sin(aPanel.x);
  vec3 H = normalize(v + uSun);
  float hn = clamp(dot(H, pn), 0.0, 1.0);
  float facing = step(0.0, dot(v, pn)) * step(0.0, dot(uSun, pn));
  float flare = ${SAT.K.toFixed(1)} * ${SAT.FLARE.toFixed(1)} * area * pow(hn, ${SAT.LOBE.toFixed(1)}) * facing * inv;
  float b = min((diff + flare) * lit, ${SAT.MAXB.toFixed(2)});
  float kind = aInfo.y;
  float seed = aInfo.z;
  vec3 skin = kind < 0.5 ? vec3(1.0, 0.95, 0.86) : (kind < 1.5 ? vec3(1.0, 0.84, 0.64) : vec3(0.86, 0.92, 1.0));
  vec3 col = skin * b;
  // nav strobes: a double flash every couple of seconds, only close in (they are small lamps)
  float ph = fract(uTime * (0.45 + 0.1 * fract(seed * 5.1)) + seed * 13.0);
  float strobe = (1.0 - smoothstep(0.0, 0.03, ph)) + (1.0 - smoothstep(0.1, 0.13, ph)) * step(0.1, ph);
  float nearL = 1.0 - smoothstep(${(SAT.STROBE_KM * 0.5).toFixed(1)}, ${SAT.STROBE_KM.toFixed(1)}, d);
  col += (fract(seed * 11.0) > 0.5 ? vec3(1.0, 0.25, 0.15) : vec3(0.85, 0.92, 1.0)) * strobe * nearL * 0.5;
  // near in, the real model takes over
  col *= smoothstep(uNearKm * 0.6, uNearKm * 1.2, d);
  vC = col;
  float m = max(col.r, max(col.g, col.b));
  // too faint to see: clipped here (behind the far plane), so the thousands out of sight cost no fill
  bool dim = m < ${SAT.CUT.toFixed(4)};
  gl_Position = dim ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * mv;
  gl_PointSize = dim ? 0.0 : uPx * clamp(1.2 + 0.9 * sqrt(m), 1.2, 2.6);
}
`;
const FRAG = /* glsl */ `
varying vec3 vC;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vC * exp(-r2 * 4.0), 0.0);
}
`;

const _pn = new THREE.Vector3(), _rh = new THREE.Vector3(), _tv = new THREE.Vector3(), _ct = new THREE.Vector3();
const _hz = new THREE.Vector3(), _vv = new THREE.Vector3(), _hh = new THREE.Vector3(), _pp = new THREE.Vector3();

function hash(n) { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); }

export class Constellations {
  constructor(designs) {
    this.group = new THREE.Group();
    this.group.name = 'constellations';
    const n = SHELLS.reduce((a, sh) => a + sh.P * sh.S, 0);
    const orb = new Float32Array(n * 4), info = new Float32Array(n * 4), panel = new Float32Array(n * 2);
    this.orb = new Float64Array(n * 4);
    let i = 0;
    this.shells = SHELLS.map((sh, si) => {
      const a = R_EARTH + sh.alt;
      const inc = sh.inc === 'sso' ? sunSyncInclination(a) : sh.inc * DEG;
      const nn = Math.sqrt(MU / (a * a * a));
      const nodeRate = -1.5 * nn * J2 * (R_J2 / a) ** 2 * Math.cos(inc);
      const node0 = si * 0.37;
      for (let p = 0; p < sh.P; p++) for (let k = 0; k < sh.S; k++, i++) {
        const seed = ((si * 977 + p * 131 + k * 17) * 0.618034) % 1;
        const o = [a, inc, node0 + (p / sh.P) * TAU, (k / sh.S) * TAU + (p * sh.F / (sh.P * sh.S)) * TAU];
        for (let c = 0; c < 4; c++) { this.orb[i * 4 + c] = o[c]; orb[i * 4 + c] = o[c]; }
        info[i * 4] = si; info[i * 4 + 1] = sh.kind; info[i * 4 + 2] = seed; info[i * 4 + 3] = sh.size;
        // the flare panel: comms birds look down with their antennas canted up to 40 deg off
        // nadir, fore or aft or abeam; the sun-synchronous imagers carry radiators abeam, the
        // navigation birds broad nadir arrays
        const h1 = hash(i * 1.37 + 0.5), h2 = hash(i * 2.91 + 7.1);
        panel[i * 2] = sh.kind === 2 ? 0.08 + 0.2 * h1 : sh.kind === 1 ? 0.5 + 0.5 * h1 : 0.12 + 0.58 * h1;
        panel[i * 2 + 1] = sh.kind === 1 ? (h2 < 0.5 ? 0.5 : -0.5) * Math.PI : h2 * TAU;
      }
      return { a, inc, n: nn, nodeRate, kind: sh.kind, size: sh.size };
    });
    this.count = n;
    this.info = info;
    this.panel = panel;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aOrb', new THREE.Float32BufferAttribute(orb, 4));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
    g.setAttribute('aPanel', new THREE.Float32BufferAttribute(panel, 2));
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

  /**
   * CPU mirror of the shader's brightness (before the near-model fade and the strobes):
   * satellite i seen from camPos with the Sun along sun. Returns the display radiance; the
   * shader clips anything under SAT.CUT.
   */
  apparent(i, camPos, sun) {
    const p = this.position(i, _pp, _tv);
    _rh.copy(p).normalize();
    const d = Math.max(_vv.subVectors(camPos, p).length(), 1e-3);
    _vv.divideScalar(d);
    const along = p.dot(sun);
    const q = Math.sqrt(Math.max(p.lengthSq() - along * along, 0));
    const t = Math.min(Math.max((q - (R_EARTH - SAT.PEN)) / (2 * SAT.PEN), 0), 1);
    const lit = along > 0 ? 1 : t * t * (3 - 2 * t);
    if (lit <= 0) return 0;
    const ca = Math.min(Math.max(_vv.dot(sun), -1), 1), al = Math.acos(ca);
    const phase = Math.max(((Math.PI - al) * ca + Math.sin(al)) / Math.PI, 0);
    const size = this.info[i * 4 + 3], area = size * size, inv = 1 / (d * d);
    const diff = SAT.K * SAT.ALBEDO * area * phase * inv;
    _ct.crossVectors(_rh, _tv);
    const tilt = this.panel[i * 2], head = this.panel[i * 2 + 1];
    _hz.copy(_tv).multiplyScalar(Math.cos(head)).addScaledVector(_ct, Math.sin(head));
    _pn.copy(_rh).multiplyScalar(-Math.cos(tilt)).addScaledVector(_hz, Math.sin(tilt));
    _hh.addVectors(_vv, sun).normalize();
    const hn = Math.min(Math.max(_hh.dot(_pn), 0), 1);
    const facing = _vv.dot(_pn) >= 0 && sun.dot(_pn) >= 0 ? 1 : 0;
    const flare = SAT.K * SAT.FLARE * area * Math.pow(hn, SAT.LOBE) * facing * inv;
    return Math.min((diff + flare) * lit, SAT.MAXB);
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
