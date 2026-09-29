import * as THREE from 'three';
import { U } from '../core/uniforms.js';

// The jump drive's visuals, drawn the way the Alcubierre metric is usually pictured: a sheet of
// spacetime round the ship, bent by the drive's expansion field
//     theta(x, r) = x / r * df/dr,   f(r) = [tanh(s(r + R)) - tanh(s(r - R))] / 2 tanh(s R)
// (x along the direction of travel, f the bubble's top-hat shape): space swells into a crescent
// ridge behind the ship (expansion, blue) and falls into a crescent well ahead of it (contraction,
// red), and is flat inside the bubble where the ship rides. The grid streams back past the bubble
// while it runs; at drop-out the deformation collapses in a ripple. Round the hull, the drive's
// field rings charge up, their emitter nodes burning white-hot.
// Metres, in a group scaled into km, child of the ship's root (nose -Z, up +Y).

const SHEET_VERT = /* glsl */ `
uniform float uAmp, uR, uSig, uTime, uFlow, uRipple, uRippleT, uNorm;
varying vec2 vXZ; varying float vH; varying float vSlope; varying vec3 vView;
float shapeD(float r) {                       // df/dr of the top-hat bubble
  float a = uSig * (r + uR), b = uSig * (r - uR);
  float ca = 1.0 / cosh(clamp(a, -20.0, 20.0)), cb = 1.0 / cosh(clamp(b, -20.0, 20.0));
  return uSig * (ca * ca - cb * cb) / (2.0 * tanh(uSig * uR));
}
float height(vec2 p) {
  float r = max(length(p), 1e-3);
  // x along the travel: the ship flies toward -Z, so ahead is -z
  float th = (-p.y / r) * shapeD(r) / uNorm;              // expansion (theta > 0) behind, contraction ahead
  float h = th * uAmp;                                     // so a ridge behind the ship and a well ahead of it
  // drop-out: the field collapses in a ripple running outward
  float w = r - uRippleT * 70.0;
  h += uRipple * uAmp * 0.45 * sin(w * 0.22) * exp(-w * w / 900.0) * exp(-r / 160.0);
  return h;
}
void main() {
  vec2 p = position.xz;
  float h = height(p);
  float e = 1.5;
  float hx = height(p + vec2(e, 0.0)) - height(p - vec2(e, 0.0));
  float hz = height(p + vec2(0.0, e)) - height(p - vec2(0.0, e));
  vSlope = length(vec2(hx, hz)) / (2.0 * e);
  vH = h / max(uAmp, 1e-3);
  vXZ = p;
  vec4 mv = modelViewMatrix * vec4(p.x, position.y + h, p.y, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const SHEET_FRAG = /* glsl */ `
uniform float uI, uFlow, uTime, uExtent, uSunE, uGridStep;
varying vec2 vXZ; varying float vH; varying float vSlope; varying vec3 vView;
float gridLine(float x, float p, float w) {
  float fw = max(fwidth(x), 1e-4);
  float d = abs(fract(x / p + 0.5) - 0.5) * p;
  return (1.0 - smoothstep(w, w + fw * 1.5, d)) * min(1.0, w / fw * 1.5);
}
void main() {
  float r = length(vXZ);
  float fade = 1.0 - smoothstep(uExtent * 0.55, uExtent, r);
  // the grid streams aft (+Z) past the bubble as it runs
  vec2 g = vec2(vXZ.x, vXZ.y - uTime * uFlow * 28.0);
  float lines = max(gridLine(g.x, uGridStep, 0.18), gridLine(g.y, uGridStep, 0.18));
  float fine = max(gridLine(g.x, uGridStep * 0.25, 0.05), gridLine(g.y, uGridStep * 0.25, 0.05)) * 0.25;
  vec3 blue = vec3(0.12, 0.45, 1.0), red = vec3(1.0, 0.18, 0.1);
  float up = clamp(vH, 0.0, 1.0), dn = clamp(-vH, 0.0, 1.0);
  // the swell glows blue, the well red, brightest on the steep walls
  vec3 fill = blue * pow(up, 0.8) * (0.45 + 1.4 * vSlope) + red * pow(dn, 0.8) * (0.45 + 1.4 * vSlope);
  // grid: pale white on the flat, tinted where the sheet bends
  vec3 lineC = mix(vec3(0.55, 0.62, 0.8), mix(vec3(0.75, 0.9, 1.0), vec3(1.0, 0.7, 0.6), step(vH, 0.0)), clamp(abs(vH) * 2.0, 0.0, 1.0));
  vec3 col = fill * 0.55 + lineC * (lines * (0.35 + 1.2 * abs(vH)) + fine * 0.5);
  // the crest lines: white-hot contours along the ridge and the rim of the well
  float crest = exp(-pow((abs(vH) - 0.92) * 9.0, 2.0)) * 0.9;
  col += mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.8, 0.75), step(vH, 0.0)) * crest;
  gl_FragColor = vec4(col * fade * uI * uSunE * 0.2, 0.0);
}`;

const RING_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const RING_FRAG = /* glsl */ `
uniform float uI, uTime, uSunE;
uniform vec3 uCol;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.4);
  // charge pulses running round the ring
  float run = fract(vUv.x * 4.0 - uTime * 0.9);
  float pulse = 0.55 + 0.45 * exp(-pow((run - 0.5) * 7.0, 2.0));
  gl_FragColor = vec4(uCol * (0.35 + 0.65 * rim) * pulse * uI * uSunE * 0.35, 0.0);
}`;

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.08, 'rgba(255,255,255,0.9)'); g.addColorStop(0.25, 'rgba(255,255,255,0.28)'); g.addColorStop(0.6, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  // a faint cross-flare
  x.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[128, 3], [3, 128]]) { const lg = x.createLinearGradient(64 - w / 2, 64 - h / 2, 64 + w / 2, 64 + h / 2); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.35)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = lg; x.fillRect(64 - w / 2, 64 - h / 2, w, h); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class WarpFx {
  constructor(root) {
    const G = new THREE.Group();
    G.scale.setScalar(0.001);                                  // metres -> km
    root.add(G);
    this.group = G;
    // ---- the spacetime sheet (a flat grid under the ship, bent in the vertex shader)
    const R = 34, sig = 0.09, extent = 170;
    // normalise theta to 1 at its peak (it peaks on the axis at the bubble wall)
    let peak = 0;
    const shapeD = (r) => { const a = sig * (r + R), b = sig * (r - R); return sig * (1 / Math.cosh(a) ** 2 - 1 / Math.cosh(b) ** 2) / (2 * Math.tanh(sig * R)); };
    for (let r = 1; r < extent; r += 0.25) peak = Math.max(peak, Math.abs(shapeD(r)));
    this.sheetU = { uAmp: { value: 0 }, uR: { value: R }, uSig: { value: sig }, uNorm: { value: peak }, uTime: U.uTime, uFlow: { value: 0 }, uRipple: { value: 0 }, uRippleT: { value: 0 },
      uI: { value: 0 }, uExtent: { value: extent }, uSunE: U.uSunIlluminance, uGridStep: { value: 8 } };
    const sheetG = new THREE.PlaneGeometry(extent * 2, extent * 2, 220, 220);
    sheetG.rotateX(-Math.PI / 2);
    sheetG.translate(0, -7.5, 0);                              // just under the belly and the legs
    this.sheet = new THREE.Mesh(sheetG, new THREE.ShaderMaterial({ vertexShader: SHEET_VERT, fragmentShader: SHEET_FRAG, uniforms: this.sheetU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true, side: THREE.DoubleSide }));
    this.sheet.frustumCulled = false; this.sheet.renderOrder = 16; this.sheet.visible = false;
    G.add(this.sheet);
    // ---- field rings round the hull with their emitter nodes
    const ringMat = (col) => new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, uniforms: { uI: { value: 0 }, uTime: U.uTime, uSunE: U.uSunIlluminance, uCol: { value: new THREE.Color(...col) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true });
    this.rings = [];
    for (const [r, z, tube, col] of [[13.2, 2, 0.32, [0.75, 0.85, 1.0]], [9.4, -7, 0.22, [0.7, 0.8, 1.0]]]) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 16, 160), ringMat(col));
      m.position.z = z; m.frustumCulled = false; m.renderOrder = 17; m.visible = false;
      G.add(m);
      this.rings.push({ m, r, z });
    }
    const tex = glowTexture();
    this.nodes = [];
    for (const { r, z } of this.rings) {
      const n = r === this.rings[0].r ? 4 : 2;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (n === 2 ? Math.PI / 2 : 0);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, premultipliedAlpha: true }));
        s.position.set(Math.cos(a) * r, Math.sin(a) * r, z);
        s.scale.setScalar(n === 4 ? 7 : 5);
        s.visible = false; s.renderOrder = 20;
        G.add(s);
        this.nodes.push({ s, base: n === 4 ? 7 : 5, phase: k * 0.37 });
      }
    }
    this._ripple = 0; this._t = 0;
  }

  /**
   * bubble 0..1 (the field's strength), flow 0..1 (1 at full warp: the grid streams by),
   * flash 0..1 (the collapse at drop-out).
   */
  update(dt, bubble, flow, flash) {
    this._t += dt;
    const on = bubble > 0.003 || flash > 0.003 || this._ripple > 0.003;
    const E = U.uSunIlluminance.value;
    // the sheet: amplitude with the field, a ripple after the collapse
    if (flash > 0.5 && this._rippleT === undefined) { this._rippleT = 0; }
    if (this._rippleT !== undefined) { this._rippleT += dt; this._ripple = Math.exp(-this._rippleT * 1.2); if (this._rippleT > 4) { this._rippleT = undefined; this._ripple = 0; } }
    const su = this.sheetU;
    su.uAmp.value = 22 * bubble;
    su.uFlow.value = flow;
    su.uRipple.value = this._ripple * (bubble < 0.99 ? 1 : 0);
    su.uRippleT.value = this._rippleT || 0;
    su.uI.value = Math.min(1, bubble * 1.4) + this._ripple * 0.8;
    this.sheet.visible = on;
    // the rings charge with the field (they lead it a little), nodes burn white at full field
    const charge = Math.min(1, bubble * 1.6);
    for (const { m } of this.rings) { m.visible = charge > 0.003 || flash > 0.003; m.material.uniforms.uI.value = charge * (0.7 + 0.5 * flow) + flash * 2; }
    for (const n of this.nodes) {
      n.s.visible = charge > 0.003 || flash > 0.003;
      const flick = 0.92 + 0.08 * Math.sin(this._t * 23 + n.phase * 11);
      const I = (charge * (1.2 + 0.8 * flow) + flash * 4) * flick;
      n.s.material.color.setRGB(0.85, 0.92, 1.0).multiplyScalar(I * E * 0.6);
      n.s.scale.setScalar(n.base * (0.6 + 0.4 * charge + flash * 0.8));
    }
    void on;
  }
}
