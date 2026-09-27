import * as THREE from 'three';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';
import { ATMO_CONSTANTS, ATMO_SAMPLING } from '../shaders/atmosphere.glsl.js';
import { U } from '../core/uniforms.js';

const TRANSMITTANCE_FRAG = /* glsl */ `
${ATMO_CONSTANTS}
varying vec2 vUv;
void main() {
  vec2 uv = (vUv * vec2(256.0, 64.0) - 0.5) / vec2(255.0, 63.0);
  float r, mu;
  uvToTransmittance(clamp(uv, 0.0, 1.0), r, mu);
  vec3 ro = vec3(0.0, r, 0.0);
  vec3 rd = vec3(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
  float tMax = raySphere(ro, rd, Rt);
  vec3 od = vec3(0.0);
  const int N = 48;
  float dt = tMax / float(N);
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (float(i) + 0.5) * dt;
    vec3 sR; float sM; vec3 ext;
    mediumAt(length(p) - Rg, sR, sM, ext);
    od += ext * dt;
  }
  gl_FragColor = vec4(exp(-od), 1.0);
}
`;

const MULTISCAT_FRAG = /* glsl */ `
${ATMO_CONSTANTS}
uniform sampler2D uTransmittanceLUT;
${ATMO_SAMPLING}
varying vec2 vUv;
void main() {
  vec2 uv = clamp((vUv * 32.0 - 0.5) / 31.0, 0.0, 1.0);
  float muS = uv.x * 2.0 - 1.0;
  float r = Rg + max(uv.y * (Rt - Rg), 0.01);
  vec3 ro = vec3(0.0, r, 0.0);
  vec3 sun = vec3(sqrt(max(1.0 - muS * muS, 0.0)), muS, 0.0);
  vec3 L2 = vec3(0.0), fms = vec3(0.0);
  const float iso = 1.0 / (4.0 * PI_A);
  for (int i = 0; i < 8; i++) {
    for (int j = 0; j < 8; j++) {
      float th = 2.0 * PI_A * (float(i) + 0.5) / 8.0;
      float ph = acos(1.0 - 2.0 * (float(j) + 0.5) / 8.0);
      vec3 rd = vec3(cos(th) * sin(ph), cos(ph), sin(th) * sin(ph));
      float tB = raySphere(ro, rd, Rg);
      float tT = raySphere(ro, rd, Rt);
      float tMax = tB > 0.0 ? tB : tT;
      vec3 L = vec3(0.0), f = vec3(0.0), T = vec3(1.0);
      const int N = 20;
      float dt = tMax / float(N);
      for (int k = 0; k < N; k++) {
        vec3 p = ro + rd * (float(k) + 0.5) * dt;
        float pr = length(p);
        vec3 up = p / pr;
        vec3 sR; float sM; vec3 ext;
        mediumAt(pr - Rg, sR, sM, ext);
        float mu = dot(sun, up);
        vec3 Ts = sampleTransmittance(uTransmittanceLUT, pr, mu) * (raySphere(p, sun, Rg) > 0.0 ? 0.0 : 1.0);
        vec3 scat = sR + vec3(sM);
        vec3 sampleT = exp(-ext * dt);
        vec3 S = scat * Ts * iso;
        L += T * (S - S * sampleT) / ext;
        f += T * (scat - scat * sampleT) / ext;
        T *= sampleT;
      }
      if (tB > 0.0) {
        vec3 pg = ro + rd * tB;
        vec3 n = normalize(pg);
        float nl = clamp(dot(n, sun), 0.0, 1.0);
        L += T * sampleTransmittance(uTransmittanceLUT, Rg, dot(n, sun)) * nl * GROUND_ALBEDO / PI_A;
      }
      L2 += L / 64.0;
      fms += f / 64.0;
    }
  }
  gl_FragColor = vec4(L2 / max(1.0 - fms, vec3(1e-3)), 1.0);
}
`;

const SKYVIEW_FRAG = /* glsl */ `
${ATMO_CONSTANTS}
uniform sampler2D uTransmittanceLUT;
uniform sampler2D uMultiScatLUT;
uniform float uViewHeight;
uniform float uSunZenithCos;
${ATMO_SAMPLING}
varying vec2 vUv;
void main() {
  vec2 uv = clamp((vUv * SKYLUT_SIZE - 0.5) / (SKYLUT_SIZE - 1.0), 0.0, 1.0);
  float vh = uViewHeight;
  float vHorizon = sqrt(max(vh * vh - Rg * Rg, 0.0));
  float beta = acos(clamp(vHorizon / vh, -1.0, 1.0));
  float zh = PI_A - beta;
  float vza;
  if (uv.y < 0.5) { float c = 1.0 - 2.0 * uv.y; c = 1.0 - c * c; vza = zh * c; }
  else { float c = uv.y * 2.0 - 1.0; vza = zh + beta * c * c; }
  float lvc = -(uv.x * uv.x * 2.0 - 1.0);
  float svz = sin(vza);
  vec3 rd = vec3(svz * lvc, cos(vza), svz * sqrt(max(1.0 - lvc * lvc, 0.0)));
  float sz = uSunZenithCos;
  vec3 sun = vec3(sqrt(max(1.0 - sz * sz, 0.0)), sz, 0.0);
  vec3 ro = vec3(0.0, vh, 0.0);
  float tB = raySphere(ro, rd, Rg);
  float tT = raySphere(ro, rd, Rt);
  float tMax = tB > 0.0 ? tB : tT;
  tMax = min(tMax, 4000.0);
  float ct = dot(rd, sun);
  float pR = phaseRayleigh(ct), pM = phaseMie(ct);
  vec3 L = vec3(0.0), T = vec3(1.0);
  const int N = 40;
  float tPrev = 0.0;
  for (int i = 0; i < N; i++) {
    float a0 = float(i) / float(N), a1 = float(i + 1) / float(N);
    float t0 = tMax * a0 * a0, t1 = tMax * a1 * a1;
    float t = mix(t0, t1, 0.3);
    float dt = t1 - t0;
    vec3 p = ro + rd * t;
    float pr = length(p);
    vec3 up = p / pr;
    vec3 sR; float sM; vec3 ext;
    mediumAt(pr - Rg, sR, sM, ext);
    float mu = dot(sun, up);
    // soft earth shadow: fade over a small angle to avoid a hard terminator line
    float tShadow = raySphere(p, sun, Rg);
    float vis = tShadow > 0.0 ? 0.0 : 1.0;
    vec3 Ts = sampleTransmittance(uTransmittanceLUT, pr, mu) * vis;
    vec3 ms = sampleMultiScat(uMultiScatLUT, pr, mu);
    vec3 S = (sR * pR + sM * pM) * Ts + (sR + vec3(sM)) * ms;
    vec3 sampleT = exp(-ext * dt);
    L += T * (S - S * sampleT) / ext;
    T *= sampleT;
  }
  gl_FragColor = vec4(L, 1.0);
}
`;

export class Atmosphere {
  constructor(renderer) {
    this.renderer = renderer;
    const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, generateMipmaps: false };
    this.transmittanceRT = new THREE.WebGLRenderTarget(256, 64, rtOpts);
    this.multiScatRT = new THREE.WebGLRenderTarget(32, 32, rtOpts);
    this.skyViewRT = new THREE.WebGLRenderTarget(192, 108, rtOpts);

    this.pass = new FullscreenPass(null);
    this.tMat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: TRANSMITTANCE_FRAG, depthTest: false, depthWrite: false });
    this.msMat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: MULTISCAT_FRAG, depthTest: false, depthWrite: false, uniforms: { uTransmittanceLUT: { value: this.transmittanceRT.texture } } });
    this.svMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: SKYVIEW_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        uTransmittanceLUT: { value: this.transmittanceRT.texture },
        uMultiScatLUT: { value: this.multiScatRT.texture },
        uViewHeight: { value: 6360.1 },
        uSunZenithCos: { value: 0.5 },
      },
    });
    U.uSkyViewLUT.value = this.skyViewRT.texture;
    U.uTransmittanceLUT.value = this.transmittanceRT.texture;
    U.uMultiScatLUT.value = this.multiScatRT.texture;
    this._last = { h: -1, s: -2 };
  }

  precompute() {
    const r = this.renderer;
    this.pass.material = this.tMat; this.pass.render(r, this.transmittanceRT);
    this.pass.material = this.msMat; this.pass.render(r, this.multiScatRT);
    r.setRenderTarget(null);
  }

  /** Re-render the sky-view LUT when the sun or viewer altitude changed. */
  update(sunDir, cameraAltitudeMeters) {
    const h = 6360 + Math.max(cameraAltitudeMeters * 0.001, 0.002);
    const s = sunDir.y;
    if (Math.abs(h - this._last.h) < 0.02 && Math.abs(s - this._last.s) < 0.0004) return;
    this._last.h = h; this._last.s = s;
    this.svMat.uniforms.uViewHeight.value = h;
    this.svMat.uniforms.uSunZenithCos.value = s;
    this.pass.material = this.svMat;
    this.pass.render(this.renderer, this.skyViewRT);
    this.renderer.setRenderTarget(null);
  }
}

// ---------------------------------------------------------------------------
// CPU mirror of the transmittance integral: colour of sunlight at the ground.
const RG = 6360, RT = 6460;
const BR = [5.802e-3, 13.558e-3, 33.1e-3];
const BM = 4.44e-3 * 1.6;
const BO = [0.650e-3, 1.881e-3, 0.085e-3];

function raySphereJS(oy, dx, dy, r) {
  // origin (0, oy, 0)
  const b = oy * dy;
  const c = oy * oy - r * r;
  const d = b * b - c;
  if (d < 0) return -1;
  const s = Math.sqrt(d);
  const t0 = -b - s, t1 = -b + s;
  if (t0 > 0) return t0;
  if (t1 > 0) return t1;
  return -1;
}

export function sunTransmittance(sunY, altitudeKm = 0.05, out = new THREE.Color()) {
  const oy = RG + altitudeKm;
  const dy = sunY, dx = Math.sqrt(Math.max(0, 1 - dy * dy));
  // Soft planet shadow: sample a few points across the solar disc
  let acc = [0, 0, 0];
  const offsets = [-0.0045, -0.0015, 0.0015, 0.0045];
  for (const o of offsets) {
    const y = Math.min(1, dy + o);
    const x = Math.sqrt(Math.max(0, 1 - y * y));
    if (raySphereJS(oy, x, y, RG) > 0) continue;
    const tMax = raySphereJS(oy, x, y, RT);
    const N = 64;
    const dt = tMax / N;
    const od = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) * dt;
      const px = x * t, py = oy + y * t;
      const h = Math.hypot(px, py) - RG;
      const dR = Math.exp(-h / 8), dM = Math.exp(-h / 1.2), dO = Math.max(0, 1 - Math.abs(h - 25) / 15);
      for (let k = 0; k < 3; k++) od[k] += (BR[k] * dR + BM * dM + BO[k] * dO) * dt;
    }
    for (let k = 0; k < 3; k++) acc[k] += Math.exp(-od[k]) / offsets.length;
  }
  return out.setRGB(acc[0], acc[1], acc[2]);
}
