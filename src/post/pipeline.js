import * as THREE from 'three';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';

// ------------------------------------------------------------------ Bloom --
// Physically-inspired bloom (Jimenez 2014, "Next Generation Post Processing in
// Call of Duty"): 13-tap downsample with Karis average, tent upsample.
const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}
vec3 s(vec2 o) { return min(texture(tSrc, vUv + o * uTexel).rgb, vec3(6e4)); }
void main() {
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
  vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 col;
  if (uFirst > 0.5) {
    // Karis average on groups to suppress fireflies
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = 1.0 / (1.0 + luma(g0)), w1 = 1.0 / (1.0 + luma(g1)), w2 = 1.0 / (1.0 + luma(g2)), w3 = 1.0 / (1.0 + luma(g3)), w4 = 1.0 / (1.0 + luma(g4));
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) /
          (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
    col = prefilter(col);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec2 t = uTexel;
  vec3 c = texture(tSrc, vUv).rgb * 4.0;
  c += (texture(tSrc, vUv + vec2(-t.x, 0.0)).rgb + texture(tSrc, vUv + vec2(t.x, 0.0)).rgb + texture(tSrc, vUv + vec2(0.0, -t.y)).rgb + texture(tSrc, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  c += texture(tSrc, vUv + vec2(-t.x, -t.y)).rgb + texture(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture(tSrc, vUv + vec2(-t.x, t.y)).rgb + texture(tSrc, vUv + vec2(t.x, t.y)).rgb;
  gl_FragColor = vec4(c / 16.0 * uWeight, 1.0);
}
`;

// ------------------------------------------------------------ God rays -----
const RAYMASK_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uSun;
uniform float uAspect;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
  float fall = exp(-dot(d, d) * 6.0);
  gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold * 3.0, l) * fall, 1.0);
}
`;
const RAYBLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uSun;
uniform float uStep;
varying vec2 vUv;
void main() {
  vec2 d = (uSun - vUv) * uStep / 32.0;
  vec2 uv = vUv;
  vec3 acc = vec3(0.0);
  float w = 1.0, ws = 0.0;
  float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
  uv += d * jitter;
  for (int i = 0; i < 32; i++) {
    acc += texture(tSrc, uv).rgb * w;
    ws += w;
    w *= 0.965;
    uv += d;
  }
  gl_FragColor = vec4(acc / ws, 1.0);
}
`;

// --------------------------------------------------------------- Composite --
const FINAL_FRAG = /* glsl */ `
uniform sampler2D tHDR;
uniform sampler2D tBloom;
uniform sampler2D tRays;
uniform float uExposure;
uniform float uBloom;
uniform float uRays;
uniform vec3 uRaysColor;
uniform float uTime;
uniform vec2 uRes;
uniform float uVignette;
uniform float uGrain;
uniform float uCA;
uniform float uFlare;
uniform vec2 uSun;
uniform float uSunVis;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uContrast;
varying vec2 vUv;

// AgX (Troy Sobotka) — polynomial approximation (Benjamin Wrensch)
vec3 agxDefaultContrastApprox(vec3 x) {
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 val) {
  const mat3 agx_mat = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                            0.0784335999999992, 0.878468636469772, 0.0784336,
                            0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const float min_ev = -12.47393;
  const float max_ev = 4.026069;
  val = agx_mat * val;
  val = clamp(log2(max(val, 1e-10)), min_ev, max_ev);
  val = (val - min_ev) / (max_ev - min_ev);
  return agxDefaultContrastApprox(val);
}
vec3 agxEotf(vec3 val) {
  const mat3 agx_mat_inv = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                                -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                                -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  val = agx_mat_inv * val;
  return pow(max(val, 0.0), vec3(2.2));
}
vec3 agxLook(vec3 val) {
  float l = dot(val, vec3(0.2126, 0.7152, 0.0722));
  vec3 slope = vec3(1.0), power = vec3(uContrast), offset = vec3(0.0);
  val = pow(max(val * slope + offset, 0.0), power);
  return l + uSaturation * (val - l);
}
vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 flare(vec2 uv) {
  // pseudo lens flare: ghosts from the (blurred) bright image mirrored through the centre
  vec2 tc = 1.0 - uv;
  vec2 gv = (vec2(0.5) - tc) * 0.37;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    vec2 o = fract(tc + gv * float(i));
    float w = pow(1.0 - length(vec2(0.5) - o) / 0.7071, 8.0);
    vec3 s = texture(tBloom, o).rgb;
    float fringe = float(i) * 0.15;
    acc += s * w * mix(vec3(1.0, 0.7, 0.4), vec3(0.5, 0.7, 1.0), fract(fringe));
  }
  // halo ring
  vec2 hv = normalize(vec2(0.5) - tc) * 0.42;
  float hw = pow(1.0 - length(vec2(0.5) - fract(tc + hv)) / 0.7071, 6.0);
  acc += texture(tBloom, fract(tc + hv)).rgb * hw * vec3(0.6, 0.8, 1.0) * 0.6;
  return acc;
}

void main() {
  vec2 uv = vUv;
  vec2 dc = uv - 0.5;
  float r2 = dot(dc, dc);
  vec3 col;
  if (uCA > 0.0) {
    vec2 off = dc * r2 * uCA;
    col.r = texture(tHDR, uv - off).r;
    col.g = texture(tHDR, uv).g;
    col.b = texture(tHDR, uv + off).b;
  } else {
    col = texture(tHDR, uv).rgb;
  }
  col = min(col, vec3(6e4));
  vec3 bloom = texture(tBloom, uv).rgb;
  col = mix(col, bloom, uBloom);
  col += texture(tRays, uv).rgb * uRays * uRaysColor;
  if (uFlare > 0.0) col += flare(uv) * uFlare;
  col *= uExposure;
  // grading in scene-linear: lift / gain
  col = col * uGain + uLift * (1.0 - col / (1.0 + col));
  col = agx(col);
  col = agxLook(col);
  col = agxEotf(col);
  // vignette
  float vig = 1.0 - uVignette * smoothstep(0.15, 0.85, r2 * 1.6);
  col *= vig;
  vec3 srgb = linearToSRGB(clamp(col, 0.0, 1.0));
  // film grain + dither in display space
  float g = hash(uv * uRes + fract(uTime * 13.37) * 100.0) - 0.5;
  srgb += g * uGrain * (1.0 - srgb * 0.7);
  srgb += (hash(uv * uRes + 7.1) - 0.5) / 255.0;
  gl_FragColor = vec4(srgb, 1.0);
}
`;

const BACKDROP_FRAG = /* glsl */ `
uniform sampler2D tSky;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture(tSky, vUv).rgb, 1.0); }
`;

export class Pipeline {
  constructor(renderer, settings) {
    this.renderer = renderer;
    this.settings = settings;
    this.size = new THREE.Vector2(1, 1);
    const hf = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.skyRT = new THREE.WebGLRenderTarget(1, 1, { ...hf, depthBuffer: true });
    this.hdrRT = new THREE.WebGLRenderTarget(1, 1, { ...hf, depthBuffer: true, samples: settings.msaa });
    this.bloomLevels = 7;
    this.bloomRTs = [];
    for (let i = 0; i < this.bloomLevels; i++) this.bloomRTs.push(new THREE.WebGLRenderTarget(1, 1, { ...hf, depthBuffer: false }));
    this.rayRT = [new THREE.WebGLRenderTarget(1, 1, { ...hf, depthBuffer: false }), new THREE.WebGLRenderTarget(1, 1, { ...hf, depthBuffer: false })];

    this.fs = new FullscreenPass(null);
    const mk = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
    this.downMat = mk(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThreshold: { value: 1.2 }, uKnee: { value: 0.6 } });
    this.upMat = mk(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.rayMaskMat = mk(RAYMASK_FRAG, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uThreshold: { value: 3 } });
    this.rayBlurMat = mk(RAYBLUR_FRAG, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uStep: { value: 1 } });
    this.finalMat = mk(FINAL_FRAG, {
      tHDR: { value: this.hdrRT.texture }, tBloom: { value: this.bloomRTs[0].texture }, tRays: { value: this.rayRT[0].texture },
      uExposure: { value: 1 }, uBloom: { value: 0.05 }, uRays: { value: 0 }, uRaysColor: { value: new THREE.Color(1, 0.9, 0.7) },
      uTime: { value: 0 }, uRes: { value: new THREE.Vector2() }, uVignette: { value: 0.35 }, uGrain: { value: 0.025 }, uCA: { value: 0.006 },
      uFlare: { value: 0.0 }, uSun: { value: new THREE.Vector2() }, uSunVis: { value: 0 },
      uLift: { value: new THREE.Vector3(0, 0, 0) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSaturation: { value: 1.15 }, uContrast: { value: 1.08 },
    });

    // Backdrop: draws the sky render at the start of the main (MSAA) pass
    this.backdrop = new THREE.Mesh(this.fs.mesh.geometry, new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BACKDROP_FRAG, uniforms: { tSky: { value: this.skyRT.texture } }, depthTest: false, depthWrite: false,
    }));
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = -10000;
    this.backdrop.layers.set(0);

    this.sunScreen = new THREE.Vector3();
  }

  setSize(w, h) {
    this.size.set(w, h);
    this.skyRT.setSize(w, h);
    this.hdrRT.setSize(w, h);
    let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    for (let i = 0; i < this.bloomLevels; i++) {
      this.bloomRTs[i].setSize(bw, bh);
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    }
    const rw = Math.max(1, w >> 2), rh = Math.max(1, h >> 2);
    this.rayRT.forEach((rt) => rt.setSize(rw, rh));
    this.finalMat.uniforms.uRes.value.set(w, h);
  }

  setMSAA(samples) {
    if (this.hdrRT.samples === samples) return;
    this.hdrRT.dispose();
    this.hdrRT.samples = samples;
    this.finalMat.uniforms.tHDR.value = this.hdrRT.texture;
  }

  renderBloom() {
    const r = this.renderer;
    const fs = this.fs;
    // downsample chain
    fs.material = this.downMat;
    let src = this.hdrRT.texture, sw = this.size.x, sh = this.size.y;
    for (let i = 0; i < this.bloomLevels; i++) {
      this.downMat.uniforms.tSrc.value = src;
      this.downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      this.downMat.uniforms.uFirst.value = i === 0 ? 1 : 0;
      fs.render(r, this.bloomRTs[i]);
      src = this.bloomRTs[i].texture; sw = this.bloomRTs[i].width; sh = this.bloomRTs[i].height;
    }
    // upsample chain (additive into the next larger mip)
    fs.material = this.upMat;
    const prevAuto = r.autoClear;
    r.autoClear = false;
    for (let i = this.bloomLevels - 1; i > 0; i--) {
      const s = this.bloomRTs[i];
      this.upMat.uniforms.tSrc.value = s.texture;
      this.upMat.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
      this.upMat.uniforms.uWeight.value = 1.0;
      fs.render(r, this.bloomRTs[i - 1]);
    }
    r.autoClear = prevAuto;
  }

  renderRays(sunUV, strength) {
    const r = this.renderer;
    const fs = this.fs;
    if (strength <= 0.001) { this.finalMat.uniforms.uRays.value = 0; return; }
    fs.material = this.rayMaskMat;
    this.rayMaskMat.uniforms.tSrc.value = this.bloomRTs[1].texture;
    this.rayMaskMat.uniforms.uSun.value.copy(sunUV);
    this.rayMaskMat.uniforms.uAspect.value = this.size.x / this.size.y;
    fs.render(r, this.rayRT[0]);
    fs.material = this.rayBlurMat;
    this.rayBlurMat.uniforms.uSun.value.copy(sunUV);
    this.rayBlurMat.uniforms.tSrc.value = this.rayRT[0].texture; this.rayBlurMat.uniforms.uStep.value = 0.9;
    fs.render(r, this.rayRT[1]);
    this.rayBlurMat.uniforms.tSrc.value = this.rayRT[1].texture; this.rayBlurMat.uniforms.uStep.value = 0.35;
    fs.render(r, this.rayRT[0]);
    this.finalMat.uniforms.uRays.value = strength;
  }

  composite() {
    this.fs.material = this.finalMat;
    this.fs.render(this.renderer, null);
  }
}
