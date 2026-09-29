import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';

// The jump drive's visuals: not a diagram of the Alcubierre metric but what it does to light.
// The bubble is a shell of warped spacetime round the ship,
//     theta(x, r) = x / r * df/dr,   f(r) = [tanh(s(r + R)) - tanh(s(r - R))] / 2 tanh(s R)
// (x along the direction of travel): space contracts in the wall ahead of the ship and expands in
// the wall behind it, and is flat inside, where the ship rides. Light reaching the ship through the
// wall is bent and shifted, so the rendered scene is re-imaged in one screen pass after it is drawn:
//
//   through the bubble  the background seen through the shell is aberrated toward the direction of
//            travel with the bubble's effective speed: contracted (squeezed) ahead, expanded
//            (stretched) behind, Doppler shifted - bluer and brighter ahead, redder and dimmer
//            behind (the spectrum re-sampled at the shifted wavelengths, intensity ~ D^2)
//   the wall the deflection is strongest where rays graze the shell: the image is pushed radially
//            there (outward across the contracting front, inward across the expanding back), with
//            fine caustic threads - the only trace of a grid - shimmering as the wall runs
//   bridge   a camera inside the bubble sees the whole sky through the wall: the full-screen view
//            from the bridge (stars crowd forward and blue, the sky behind reddens and thins)
//   drop-out the collapsing field sends a ripple of distortion racing outward
//
// The ship itself is inside the flat interior: it is drawn after the pass, undistorted.

const COPY_FRAG = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }`;

const LENS_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTanHalf;          // tan(fov/2) * aspect, tan(fov/2)
uniform vec3 uC;                // bubble centre, view space (km)
uniform float uR;               // bubble radius (km)
uniform vec3 uDir;              // direction of travel, view space
uniform float uBeta;            // effective speed of the view through the wall (0..~0.5)
uniform float uWall;            // strength of the wall's lensing (0..1)
uniform float uRipple, uRippleR; // drop-out ripple strength and radius (bubble radii)
uniform float uTime;
varying vec2 vUv;

// the scene's spectrum sampled at 465 / 550 / 610 nm, re-read at wavelength l (nm)
float spec(vec3 c, float l) {
  float v = l < 550.0 ? mix(c.b, c.g, clamp((l - 465.0) / 85.0, 0.0, 1.0)) : mix(c.g, c.r, clamp((l - 550.0) / 60.0, 0.0, 1.0));
  return v * smoothstep(360.0, 430.0, l) * (1.0 - smoothstep(660.0, 760.0, l));
}
vec3 doppler(vec3 c, float D) {
  if (abs(D - 1.0) < 1e-3) return c;
  vec3 lam = vec3(610.0, 550.0, 465.0) * D;       // an observed wavelength left the source at l * D
  return vec3(spec(c, lam.x), spec(c, lam.y), spec(c, lam.z)) * D * D;
}
vec2 toUv(vec3 d) {
  float z = max(-d.z, 1e-4);
  return 0.5 + 0.5 * (d.xy / z) / uTanHalf;
}
vec4 fetch(vec2 uv) {
  // mirrored beyond the frame: the wall pulls in light from just outside the picture
  uv = 1.0 - abs(1.0 - abs(uv));
  return texture2D(tSrc, clamp(uv, vec2(0.0005), vec2(0.9995)));
}

void main() {
  vec4 base = texture2D(tSrc, vUv);
  vec3 d = normalize(vec3((vUv * 2.0 - 1.0) * uTanHalf, -1.0));
  float dc = length(uC);
  bool inside = dc < uR;
  // impact parameter of the ray about the bubble centre, in bubble radii (0 inside the bubble)
  float tc = dot(uC, d);
  float rho = inside ? 0.0 : (tc > 0.0 ? length(uC - d * tc) / uR : 1e3);
  // how much of the bubble the ray passes through: 1 within the shell's disc, easing off across the wall
  float w = 0.12;
  float through = inside ? 1.0 : 1.0 - smoothstep(1.0 - w, 1.0 + w, rho);
  float wall = inside ? 0.0 : exp(-pow((rho - 1.0) / w, 2.0));
  // ---- aberration through the wall: sources at psi_s appear at psi
  float beta = uBeta * through;
  vec3 src = d;
  float D = 1.0;
  if (beta > 1e-4) {
    float cp = clamp(dot(d, uDir), -1.0, 1.0);
    float cs = (cp - beta) / (1.0 - beta * cp);
    vec3 perp = d - uDir * cp;
    float pl = length(perp);
    if (pl > 1e-5) src = uDir * cs + perp / pl * sqrt(max(1.0 - cs * cs, 0.0));
    D = sqrt(1.0 - beta * beta) / (1.0 - beta * cs);
  }
  // ---- the wall: radial push where rays graze the shell, outward across the contracting front
  // (the image squeezed), inward across the expanding back, with the drop-out ripple
  vec2 cUv = toUv(normalize(uC));
  vec2 uv = toUv(src);
  if (!inside && tc > 0.0) {
    vec3 pr = normalize(d * tc - uC);                               // where the ray grazes the shell
    float x = dot(pr, uDir);                                         // +1 ahead .. -1 behind
    vec2 rad = vUv - cUv;
    float shim = 0.85 + 0.15 * sin(atan(rad.y, rad.x + 1e-6) * 7.0 + uTime * 3.1) * sin(rho * 23.0 - uTime * 5.3);
    float push = uWall * wall * x * 0.22 * shim;
    float rp = rho - uRippleR;
    push += uRipple * 0.12 * sin(rp * 14.0) * exp(-rp * rp * 6.0);
    uv += rad * push;
  }
  vec4 s = fetch(uv);
  vec3 col = doppler(s.rgb, D);
  // caustic threads along the wall: light from the background concentrated where the deflection
  // turns over (the faint grid that survives), tinted by the Doppler shift of that side
  if (wall > 1e-3 && tc > 0.0) {
    vec3 pr = normalize(d * tc - uC);
    float x = dot(pr, uDir);
    float a = atan(pr.y, pr.x + 1e-6);
    float ph = a * 12.0 / 6.2831853 + x * 2.0 - uTime * 0.25;
    float fw = min(fwidth(ph), 0.5);
    float thread = mix(1.0 - smoothstep(0.0, 0.08 + fw, abs(fract(ph) - 0.5)), 0.2, smoothstep(0.1, 0.4, fw));
    float ring = exp(-pow((rho - 1.0 - 0.02 * sin(uTime * 2.3)) / (w * 0.35), 2.0));
    vec3 tint = mix(vec3(1.0, 0.45, 0.3), vec3(0.45, 0.7, 1.0), 0.5 + 0.5 * x);
    float caus = uWall * (ring * (0.6 + 0.4 * thread) + wall * 0.25);
    col = col * (1.0 + 1.6 * caus) + tint * caus * 0.02 * uSunE;
  }
  col = mix(base.rgb, col, clamp(max(uWall, max(uBeta * 3.0, uRipple)), 0.0, 1.0));
  gl_FragColor = vec4(col, max(base.a, s.a * through));
}`;

export class WarpFx {
  constructor(root) {
    this.root = root;
    this.R = 0.052;                                              // bubble radius (km): the ship and its wings inside
    this._ripple = 0; this._rippleT = undefined; this._t = 0;
    this.state = { bubble: 0, flow: 0, flash: 0 };
    this.copyRT = null;
    this.copy = new FullscreenPass(new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: COPY_FRAG, uniforms: { tSrc: { value: null } }, depthTest: false, depthWrite: false, blending: THREE.NoBlending }));
    this.lensU = {
      tSrc: { value: null }, uTanHalf: { value: new THREE.Vector2(1, 1) }, uC: { value: new THREE.Vector3() }, uR: { value: this.R },
      uDir: { value: new THREE.Vector3(0, 0, -1) }, uBeta: { value: 0 }, uWall: { value: 0 }, uRipple: { value: 0 }, uRippleR: { value: 0 },
      uTime: U.uTime, uSunE: U.uSunIlluminance,
    };
    this.lens = new FullscreenPass(new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: 'uniform float uSunE;\n' + LENS_FRAG, uniforms: this.lensU,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    }));
  }

  /** True while the pass has anything to do. */
  get active() { return this.state.bubble > 0.003 || this.state.flash > 0.003 || this._ripple > 0.003; }

  /**
   * bubble 0..1 (the field's strength), flow 0..1 (1 at full warp), flash 0..1 (the collapse at
   * drop-out).
   */
  update(dt, bubble, flow, flash) {
    this._t += dt;
    if (flash > 0.5 && this._rippleT === undefined) this._rippleT = 0;
    if (this._rippleT !== undefined) { this._rippleT += dt; this._ripple = Math.exp(-this._rippleT * 1.4); if (this._rippleT > 3.5) { this._rippleT = undefined; this._ripple = 0; } }
    this.state.bubble = bubble; this.state.flow = flow; this.state.flash = flash;
  }

  /** After the scene is drawn into rt: re-image it through the bubble (one copy, one pass). */
  render(r, cam, rt) {
    if (!this.active || !rt) return false;
    const w = rt.width, h = rt.height;
    if (!this.copyRT || this.copyRT.width !== w || this.copyRT.height !== h) {
      if (this.copyRT) this.copyRT.dispose();
      this.copyRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    }
    this.copy.material.uniforms.tSrc.value = rt.texture;
    this.copy.render(r, this.copyRT);
    const u = this.lensU, st = this.state;
    const ty = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
    u.tSrc.value = this.copyRT.texture;
    u.uTanHalf.value.set(ty * cam.aspect, ty);
    this.root.updateMatrixWorld();
    u.uC.value.setFromMatrixPosition(this.root.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
    u.uDir.value.set(0, 0, -1).transformDirection(this.root.matrixWorld).transformDirection(cam.matrixWorldInverse);
    u.uR.value = this.R;
    // the field builds through the spool; the view through it speeds up with the flow
    u.uWall.value = Math.min(1, st.bubble * 1.2) * (0.55 + 0.45 * st.flow) + st.flash * 0.6;
    u.uBeta.value = 0.12 * st.bubble + 0.33 * st.flow;
    u.uRipple.value = this._ripple;
    u.uRippleR.value = 1 + (this._rippleT || 0) * 2.6;
    this.lens.render(r, rt);
    r.setRenderTarget(rt);
    return true;
  }
}
