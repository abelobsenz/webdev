import * as THREE from 'three';
import { U } from '../core/uniforms.js';

// The jump drive's visuals (km units, children of the ship's root): an Alcubierre bubble - a thin
// shell of warped space round the ship, its front blue-shifted and its back red-shifted, faint
// bands running aft through it - and the streaks of starlight and dust smeared past the bubble
// while it runs faster than light.

const SHELL_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vL;
void main() {
  vL = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SHELL_FRAG = /* glsl */ `
uniform float uI; uniform float uTime; uniform float uSunE; uniform float uFlow;
varying vec3 vN; varying vec3 vV; varying vec3 vL;
void main() {
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  float rim = pow(1.0 - abs(dot(N, normalize(vV))), 2.6);
  float along = clamp(vL.z * 0.5 + 0.5, 0.0, 1.0);                      // 0 at the nose (-Z) .. 1 aft
  vec3 blue = vec3(0.45, 0.72, 1.0), red = vec3(1.0, 0.42, 0.28), mid = vec3(0.85, 0.8, 1.0);
  vec3 c = along < 0.5 ? mix(blue, mid, along * 2.0) : mix(mid, red, along * 2.0 - 1.0);
  float bands = 0.75 + 0.25 * sin(vL.z * 26.0 + uTime * 9.0 * uFlow);
  gl_FragColor = vec4(c * rim * bands * uI * uSunE * 0.5, 0.0);
}`;

const STREAK_VERT = /* glsl */ `
attribute float aA;
varying float vA;
void main() { vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const STREAK_FRAG = /* glsl */ `
uniform float uI; uniform float uSunE;
varying float vA;
void main() { gl_FragColor = vec4(vec3(0.72, 0.84, 1.0) * vA * uI * uSunE * 0.18, 0.0); }`;

export class WarpFx {
  constructor(root) {
    this.shellU = { uI: { value: 0 }, uTime: U.uTime, uSunE: U.uSunIlluminance, uFlow: { value: 0 } };
    const g = new THREE.SphereGeometry(1, 64, 40);
    this.shell = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, uniforms: this.shellU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true, side: THREE.DoubleSide }));
    this.shell.scale.set(0.075, 0.055, 0.12);                          // km: a bubble round a 36 m hull
    this.shell.frustumCulled = false; this.shell.renderOrder = 19; this.shell.visible = false;
    root.add(this.shell);
    // streaks: segments in the ship's frame streaming aft
    this.n = 420;
    this.p = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) this._seed(i, true);
    const pos = new Float32Array(this.n * 2 * 3), a = new Float32Array(this.n * 2);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aA', new THREE.BufferAttribute(a, 1).setUsage(THREE.DynamicDrawUsage));
    this.streakU = { uI: { value: 0 }, uSunE: U.uSunIlluminance };
    this.streaks = new THREE.LineSegments(sg, new THREE.ShaderMaterial({ vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG, uniforms: this.streakU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true }));
    this.streaks.frustumCulled = false; this.streaks.renderOrder = 18; this.streaks.visible = false;
    root.add(this.streaks);
  }

  _seed(i, anyZ) {
    const a = Math.random() * Math.PI * 2, r = 0.12 + Math.pow(Math.random(), 0.7) * 2.2;
    this.p[i * 3] = Math.cos(a) * r; this.p[i * 3 + 1] = Math.sin(a) * r;
    this.p[i * 3 + 2] = anyZ ? -4 + Math.random() * 8 : -4 - Math.random() * 0.5;
  }

  /**
   * bubble 0..1 (the shell's strength), flow 0..1 (how hard space streams past: 1 at full warp),
   * flash 0..1 (the collapse at the end).
   */
  update(dt, bubble, flow, flash) {
    this.shellU.uI.value = bubble * (0.6 + 0.4 * flow) + flash * 3;
    this.shellU.uFlow.value = flow;
    this.shell.visible = bubble > 0.005 || flash > 0.005;
    const s = 1 + flash * 0.6;
    this.shell.scale.set(0.075 * s, 0.055 * s, 0.12 * (1 + 0.5 * flow) * s);
    this.streakU.uI.value = flow;
    this.streaks.visible = flow > 0.01;
    if (!this.streaks.visible) return;
    const pos = this.streaks.geometry.attributes.position, al = this.streaks.geometry.attributes.aA;
    const v = flow * 9, len = 0.05 + flow * 1.6;                         // km/s of apparent drift, streak length (km)
    for (let i = 0; i < this.n; i++) {
      this.p[i * 3 + 2] += v * dt;
      if (this.p[i * 3 + 2] > 4) this._seed(i, false);
      const x = this.p[i * 3], y = this.p[i * 3 + 1], z = this.p[i * 3 + 2];
      pos.setXYZ(i * 2, x, y, z); pos.setXYZ(i * 2 + 1, x, y, z + len);
      const f = Math.min(1, (4 - z) * 0.5) * Math.min(1, (z + 4) * 0.5);
      al.setX(i * 2, 0.9 * f); al.setX(i * 2 + 1, 0);
    }
    pos.needsUpdate = true; al.needsUpdate = true;
  }
}
