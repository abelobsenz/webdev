import * as THREE from 'three';
import { aerialShaderMaterial } from '../world/materials.js';
import { U } from '../core/uniforms.js';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';
import { ATMO_CONSTANTS, ATMO_SAMPLING } from '../shaders/atmosphere.glsl.js';
import { sunTransmittance } from '../sky/atmosphere.js';
import { CLOUD_FIELD, CLOUD_PARAMS, CLOUD_SHADOW_LOOKUP, GEN_BASE_FRAG, GEN_DETAIL_FRAG, GEN_WEATHER_FRAG } from '../shaders/clouds.glsl.js';

/**
 * MERIDIAN sky: ray-marched cumulus.
 *
 *  - Tiling Perlin-Worley / Worley 3D noise and a weather map are generated on
 *    the GPU at startup (128^3 + 32^3 + 512^2).
 *  - Every frame a top-down "cloud shadow map" stores optical depth toward the
 *    sun at four levels through the deck; world materials (cloudShadowAt), the
 *    water, the god-ray pass and the reflection impostor all read it, so ground
 *    shadows match the clouds you see.
 *  - The main view is marched at reduced resolution between the planet-centred
 *    shells (1.65 - 4.7 km) and clipped against scene depth captured mid-frame
 *    (after opaque geometry + water, before other transparents), then
 *    temporally accumulated with reprojection and composited with a depth-aware
 *    upsample: towers and the Axis pierce the deck correctly.
 *  - Lighting: Beer + powder, 3-octave multiple scattering (Wrenninge), dual-lobe
 *    HG phase (silver lining), sky-LUT ambient, earth-shadow terminator, sunlight
 *    reddened at cloud altitude, moonlight and the warm city glow at night.
 *  - Reflections and the 'low' preset use a cheap impostor plane driven by the
 *    same field.
 */

// ------------------------------------------------------------------ passes --
const RAY_VERT = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
varying vec2 vUv;
varying vec3 vRay;
varying vec3 vViewRay;
void main() {
  vUv = uv;
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  vViewRay = v.xyz / v.w;
  vRay = mat3(uCamWorld) * vViewRay;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const MARCH_FRAG = /* glsl */ `
${ATMO_CONSTANTS}
uniform sampler2D uSkyViewLUT;
${ATMO_SAMPLING}
${CLOUD_FIELD}
uniform sampler2D tDepth;
uniform vec3 uCamPos;
uniform float uFrame;
uniform int uSteps;
uniform int uLightSteps;
uniform float uDetailDist;
uniform float uStepK;
uniform vec3 uLightDir;
uniform vec3 uLightColBase;
uniform vec3 uLightColTop;
uniform float uSunIlluminance;
uniform vec3 uNightAmbient;
uniform vec3 uSunDir;
uniform float uCityLights;
uniform float uHaze;
uniform float uMsBoost;
uniform float uAmbBoost;
varying vec2 vUv;
varying vec3 vRay;

float hgPhase(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI_A * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
float cloudPhase(float c, float k) { return mix(hgPhase(c, 0.82 * k), hgPhase(c, -0.3 * k), 0.22); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float havg(float h0, float h1, float H) {
  h0 = max(h0, 0.0); h1 = max(h1, 0.0);
  float dh = h1 - h0; float e0 = exp(-h0 / H);
  if (abs(dh) < 1.0) return e0;
  return H * (e0 - exp(-h1 / H)) / dh;
}

float lightOD(vec3 p, float lod) {
  float od = 0.0, s = 55.0, t = 0.0;
  for (int j = 0; j < 8; j++) {
    if (j >= uLightSteps) break;
    vec3 q = p + uLightDir * (t + s * 0.5);
    float hq = cloudHeight(q);
    if (hq > CLOUD_TOP || hq < CLOUD_BOTTOM) break;
    od += cloudDensity(q, hq, j < 1 ? 1.0 : 0.0, lod + float(j) * 0.45) * s;
    t += s; s *= 1.9;
  }
  return od * CLOUD_SIGMA;
}

void main() {
  vec3 rd = normalize(vRay);
  float sceneT = texture(tDepth, vUv).r;
  vec2 seg = cloudSegment(uCamPos, rd, sceneT, 62000.0);
  if (seg.y <= seg.x + 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float jitter = fract(ign(gl_FragCoord.xy) + uFrame * 0.61803398875);

  // ambient: sky dome from the sky-view LUT, ground bounce, city glow
  float vh = Rg + max(uCamPos.y * 0.001, 0.002);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 sunH = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(1e-4, 0.0, 0.0));
  vec3 skyZen = skyRadiance(uSkyViewLUT, vh, up, up, uSunDir);
  vec3 skyH = 0.5 * (skyRadiance(uSkyViewLUT, vh, up, normalize(sunH + vec3(0.0, 0.2, 0.0)), uSunDir) +
                     skyRadiance(uSkyViewLUT, vh, up, normalize(-sunH + vec3(0.0, 0.2, 0.0)), uSunDir));
  vec3 ambTop = (skyZen * 0.6 + skyH * 0.4) * uSunIlluminance + uNightAmbient * 1.5;
  vec3 ambBot = skyH * uSunIlluminance * 0.22 + uLightColBase * max(uLightDir.y, 0.0) * 0.045 + uNightAmbient * 0.6;
  ambTop *= uAmbBoost; ambBot *= uAmbBoost;

  float cosT = dot(rd, uLightDir);
  float ph1 = cloudPhase(cosT, 1.0), ph2 = cloudPhase(cosT, 0.55), ph3 = cloudPhase(cosT, 0.3);
  float len = seg.y - seg.x;
  float invN = 1.0 / float(uSteps);
  float minStep = len * invN;
  float T = 1.0;
  vec3 L = vec3(0.0);
  float wsum = 0.0, tsum = 0.0;
  float t = seg.x + jitter * clamp(max(minStep, seg.x * uStepK), 12.0, 2500.0);
  for (int i = 0; i < 200; i++) {
    if (i >= uSteps || t > seg.y) break;
    float ds = clamp(max(minStep, t * uStepK), 12.0, 2500.0);
    vec3 p = uCamPos + rd * t;
    float h = cloudHeight(p);
    float lod = clamp(log2(ds / 45.0), 0.0, 4.0) * 0.7;
    vec3 wx = cloudWeather(p.xz);
    if (wx.x < 0.01) { t += ds * 1.7; continue; }      // clear column: stride ahead
    float detailW = 1.0 - smoothstep(uDetailDist * 0.55, uDetailDist, t);
    float dens = cloudDensityWx(p, h, wx, detailW, lod) * (1.0 - smoothstep(40000.0, 62000.0, t - seg.x + min(seg.x, 12000.0)));
    if (dens > 0.003) {
      float sigS = dens * CLOUD_SIGMA;
      float od = lightOD(p, lod);
      float hs = cSat((h - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM));
      vec3 lc = mix(uLightColBase, uLightColTop, hs);
      // earth-shadow terminator sweeps across the deck at dusk (planet curvature)
      vec3 upP = normalize(p - CLOUD_C);
      float dip = sqrt(2.0 * max(h, 0.0) / CLOUD_PLANET_R);
      lc *= smoothstep(-0.004, 0.006, dot(uLightDir, upP) + dip);
      // 3 scattering orders (Wrenninge): each flatter and less attenuated than the last
      // (+ a small floor: light diffusing through kilometres of neighbouring cloud)
      vec3 sunIn = lc * (exp(-od) * ph1 + 0.6 * exp(-od * 0.25) * ph2 + 0.45 * exp(-od * 0.06) * 0.0796 + 0.0032);
      // powder: dark crevices and edges seen away from the light
      float powder = 1.0 - exp(-sigS * 220.0);
      sunIn *= mix(1.0, powder, 0.7 * cSat(0.6 - 0.6 * cosT));
      float hfLocal = cSat((h - CLOUD_BOTTOM - 150.0) / 2200.0);
      float city = uCityLights * smoothstep(11000.0, 3500.0, length(p.xz)) * (1.0 - hfLocal) * (1.0 - hfLocal);
      vec3 amb = mix(ambBot, ambTop, hfLocal) + vec3(1.0, 0.56, 0.28) * 0.016 * city * (1.0 - hfLocal);
      vec3 S = sigS * (sunIn * uMsBoost + amb * (0.35 + 0.65 * exp(-od * 0.08)));
      float Ts = exp(-sigS * ds);
      L += T * (S - S * Ts) / max(sigS, 1e-7);
      float wgt = T * (1.0 - Ts);
      wsum += wgt; tsum += wgt * t;
      T *= Ts;
      if (T < 0.012) break;
    }
    t += ds;
  }
  if (T > 0.999) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // aerial perspective between the eye and the (opacity-weighted) cloud distance
  float tAvg = wsum > 0.0 ? tsum / wsum : seg.x;
  float yEnd = uCamPos.y + rd.y * tAvg;
  vec3 odA = tAvg * (vec3(5.802e-6, 13.558e-6, 33.1e-6) * havg(uCamPos.y, yEnd, 8000.0) + vec3(1.6e-5 * uHaze * havg(uCamPos.y, yEnd, 1100.0)));
  vec3 Tair = exp(-odA);
  vec3 ins = skyRadiance(uSkyViewLUT, vh, up, normalize(vec3(rd.x, max(rd.y, 0.035), rd.z)), uSunDir) * uSunIlluminance + uNightAmbient;
  L = L * Tair + ins * (1.0 - Tair) * (1.0 - T);
  gl_FragColor = vec4(L, T);
}
`;

const RESOLVE_FRAG = /* glsl */ `
${CLOUD_FIELD}
uniform sampler2D tCurr;
uniform sampler2D tHist;
uniform sampler2D tDepth;
uniform mat4 uPrevViewProj;
uniform vec3 uCamPos;
uniform float uBlend;
uniform vec2 uTexel;
varying vec2 vUv;
varying vec3 vRay;
void main() {
  vec4 c = texture(tCurr, vUv);
  vec4 mn = c, mx = c;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    vec4 s = texture(tCurr, vUv + vec2(float(i), float(j)) * uTexel);
    mn = min(mn, s); mx = max(mx, s);
  }
  vec3 rd = normalize(vRay);
  float tScene = texture(tDepth, vUv).r;
  float te = cloudEntry(uCamPos, rd);
  float tr = min(te < 1e8 ? max(te + 300.0, 600.0) : 25000.0, tScene);
  vec4 pc = uPrevViewProj * vec4(uCamPos + rd * tr, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  bool valid = pc.w > 0.0 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)));
  vec4 h = texture(tHist, puv);
  // widen the clamp box a little: the per-pixel noise is high, cloud motion is slow
  vec4 ext = (mx - mn) * 0.25;
  h = clamp(h, mn - ext, mx + ext);
  gl_FragColor = mix(h, c, valid ? uBlend : 1.0);
}
`;

const COMPOSITE_VERT = RAY_VERT;
const COMPOSITE_FRAG = /* glsl */ `
${CLOUD_FIELD}
uniform sampler2D tCloud;
uniform sampler2D tDepthHalf;
uniform sampler2D tDepthFull;
uniform vec2 uHalfRes;
uniform vec2 uNearFar;
uniform vec3 uCamPos;
varying vec2 vUv;
varying vec3 vRay;
varying vec3 vViewRay;
void main() {
  float d = texture(tDepthFull, vUv).r;
  float n = uNearFar.x, f = uNearFar.y;
  float vz = 2.0 * n * f / (f + n - (d * 2.0 - 1.0) * (f - n));
  float tFull = d >= 0.999999 ? 1e9 : vz * length(vViewRay) / max(-vViewRay.z, 1e-6);
  vec3 rd = normalize(vRay);
  if (tFull < cloudEntry(uCamPos, rd)) discard;
  vec2 tc = vUv * uHalfRes - 0.5;
  vec2 fr = fract(tc);
  vec2 b = (floor(tc) + 0.5) / uHalfRes;
  vec2 tx = 1.0 / uHalfRes;
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 uv = b + vec2(float(i), float(j)) * tx;
    float dh = texture(tDepthHalf, uv).r;
    float wb = (i == 0 ? 1.0 - fr.x : fr.x) * (j == 0 ? 1.0 - fr.y : fr.y);
    float wd = 1.0 / (0.02 + abs(dh - tFull) / max(min(dh, tFull), 1.0));
    float w = wb * wd + 1e-5;
    acc += texture(tCloud, uv) * w;
    ws += w;
  }
  vec4 c = acc / ws;
  gl_FragColor = vec4(c.rgb, c.a);
}
`;

// Reflection pass: upsample the low-res march over the mirrored sky (before the scene).
const REFL_COMP_FRAG = /* glsl */ `
uniform sampler2D tCloud;
varying vec2 vUv;
void main() { gl_FragColor = texture(tCloud, vUv); }
`;

// Top-down optical depth toward the light at four levels through the deck.
const SHADOW_FRAG = /* glsl */ `
${CLOUD_FIELD}
uniform vec2 uOrigin;
uniform float uSize;
uniform vec3 uLightDir;
varying vec2 vUv;
void main() {
  vec2 xz = uOrigin + vUv * uSize;
  vec3 L = uLightDir;
  float ly = max(L.y, 0.08);
  vec3 stepDir = vec3(L.x / ly, 1.0, L.z / ly);   // per metre of height
  const int N = 28;
  float dy = (CLOUD_TOP - CLOUD_BOTTOM) / float(N);
  float ds = dy * length(stepDir);                  // path length per step
  float bins[4];
  bins[0] = 0.0; bins[1] = 0.0; bins[2] = 0.0; bins[3] = 0.0;
  for (int i = 0; i < N; i++) {
    vec3 p = vec3(xz.x, CLOUD_BOTTOM, xz.y) + stepDir * ((float(i) + 0.5) * dy);
    float dens = cloudDensity(p, p.y, 0.35, 1.0) * ds;
    int bi = min(i * 4 / N, 3);
    if (bi == 0) bins[0] += dens; else if (bi == 1) bins[1] += dens; else if (bi == 2) bins[2] += dens; else bins[3] += dens;
  }
  // optical depth above each level; softened (x0.22) for forward-scattered light
  float s = CLOUD_SIGMA * 0.22;
  gl_FragColor = vec4(bins[0] + bins[1] + bins[2] + bins[3], bins[1] + bins[2] + bins[3], bins[2] + bins[3], bins[3]) * s;
}
`;

// Cheap impostor deck: reflection-only when the volumetric pass is active,
// the visible cloud layer on the 'low' preset.
const IMP_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const IMP_FRAG = /* glsl */ `
${CLOUD_FIELD}
${CLOUD_SHADOW_LOOKUP}
uniform float uLayer;
varying vec3 vW;
void main() {
  vec3 toCam = cameraPosition - vW;
  float dist = length(toCam);
  vec3 p = vW;
  float d = 0.0;
  // integrate a few heights through the deck at this column
  for (int k = 0; k < 3; k++) {
    float hk = CLOUD_BOTTOM + 350.0 + float(k) * 450.0 + uLayer * 220.0;
    vec3 q = vec3(p.x, hk, p.z);
    d += cloudDensity(q, hk, 0.0, 1.5);
  }
  d = clamp(d * 0.9, 0.0, 1.0);
  if (d < 0.01) discard;
  vec3 L = uCloudLightDir;
  float od = cloudShadowOD(vec3(p.x, CLOUD_BOTTOM + 900.0, p.z)) * 3.0;
  vec3 V = toCam / dist;
  float cosT = dot(-V, uSunDir);
  float silver = pow(max(cosT, 0.0), 10.0) * 2.0 * (1.0 - d);
  vec3 sun = uSunColor * uSunIlluminance;
  vec3 amb = (aerialInscatter(vec3(0.0, 1.0, 0.0)) - uNightAmbient) * 1.3 + uNightAmbient * 0.6;
  vec3 col = sun * (exp(-od) * 0.12 + silver * 0.06) * max(uSunDir.y + 0.08, 0.0) * 1.2 + amb * (0.6 + 0.4 * (1.0 - d));
  col += vec3(1.0, 0.58, 0.3) * uCityLights * 0.03 * smoothstep(11000.0, 3500.0, length(p.xz));
  float a = d * (1.0 - smoothstep(26000.0, 42000.0, dist)) * 0.92;
  col = applyAerial(col, vW);
  gl_FragColor = vec4(col * a, a);
}`;

function makeRT(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, ...opts,
  });
}

export class Clouds {
  constructor(scene) {
    this.scene = scene;
    // uniforms shared by every cloud shader (the field itself)
    this.fieldUniforms = {
      uCloudBase: { value: null },
      uCloudDetail: { value: null },
      uCloudWeather: { value: null },
      uCloudOffset: U.uCloudOffset,
      uCloudCoverage: U.uCloudCoverage,
      uCloudTime: { value: 0 },
      uCloudTune: { value: new THREE.Vector4(0.12, 4.0, 0.62, 1.0) },
    };
    this.layers = [];
    const geo = new THREE.PlaneGeometry(90000, 90000, 1, 1).rotateX(-Math.PI / 2);
    for (let l = 0; l < 2; l++) {
      const mat = aerialShaderMaterial({
        vertexShader: IMP_VERT, fragmentShader: IMP_FRAG,
        uniforms: { uLayer: { value: l }, ...this.fieldUniforms },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = 2300 + l * 160;
      m.renderOrder = 8 + l;
      m.frustumCulled = false;
      scene.add(m);
      this.layers.push(m);
    }
    this.enabled = true;
    this.volumetric = false;
    this.ready = false;
    this.frame = 0;
  }

  /** GPU resources (called once the renderer is known). */
  init(renderer, settings) {
    this.renderer = renderer;
    this.fs = new FullscreenPass(null);
    this.generateNoise(renderer);
    // cloud shadow map (top-down optical depth)
    this.shadowSize = 24000;
    this.shadowRes = 384;
    this.shadowRT = makeRT(this.shadowRes, this.shadowRes);
    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: SHADOW_FRAG, depthTest: false, depthWrite: false,
      uniforms: { ...this.fieldUniforms, uOrigin: { value: new THREE.Vector2() }, uSize: { value: this.shadowSize }, uLightDir: U.uCloudLightDir },
    });
    U.uCloudShadowMap.value = this.shadowRT.texture;

    // volumetric main-view passes
    const rayUniforms = () => ({ uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() } });
    this.marchRT = makeRT(2, 2);
    this.histRT = [makeRT(2, 2), makeRT(2, 2)];
    this.histIdx = 0;
    this.lightColBase = new THREE.Color();
    this.lightColTop = new THREE.Color();
    this.marchMat = new THREE.ShaderMaterial({
      vertexShader: RAY_VERT, fragmentShader: MARCH_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        ...this.fieldUniforms, ...rayUniforms(),
        uSkyViewLUT: U.uSkyViewLUT, uSunDir: U.uSunDir, uSunIlluminance: U.uSunIlluminance, uNightAmbient: U.uNightAmbient,
        uCityLights: U.uCityLights, uHaze: U.uHaze,
        tDepth: { value: null }, uFrame: { value: 0 }, uSteps: { value: 64 }, uLightSteps: { value: 6 }, uDetailDist: { value: 16000 }, uStepK: { value: 0.02 },
        uLightDir: U.uCloudLightDir, uLightColBase: { value: this.lightColBase }, uLightColTop: { value: this.lightColTop },
        uMsBoost: { value: 3.5 }, uAmbBoost: { value: 1.6 },
      },
    });
    this.resolveMat = new THREE.ShaderMaterial({
      vertexShader: RAY_VERT, fragmentShader: RESOLVE_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        ...this.fieldUniforms, ...rayUniforms(),
        tCurr: { value: this.marchRT.texture }, tHist: { value: null }, tDepth: { value: null },
        uPrevViewProj: { value: new THREE.Matrix4() }, uBlend: { value: 1 }, uTexel: { value: new THREE.Vector2() },
      },
    });
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: COMPOSITE_VERT, fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        ...this.fieldUniforms, ...rayUniforms(),
        tCloud: { value: null }, tDepthHalf: { value: null }, tDepthFull: { value: null },
        uHalfRes: { value: new THREE.Vector2(1, 1) }, uNearFar: { value: new THREE.Vector2(1, 1000) },
      },
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    // Composite quad: drawn inside the main scene pass right after the water
    // (renderOrder -1) so later transparents (traffic, motes) stay on top.
    this.composite = new THREE.Mesh(this.fs.mesh.geometry, this.compositeMat);
    this.composite.frustumCulled = false;
    this.composite.renderOrder = -0.5;
    this.composite.layers.set(1);   // main view only (not the reflection camera)
    this.composite.visible = false;
    this.scene.add(this.composite);
    this.prevViewProj = new THREE.Matrix4();
    this.lastCamPos = new THREE.Vector3(1e9, 0, 0);
    this.historyValid = false;
    this.framesSinceReset = 0;
    this.ready = true;
    this.applyQuality(settings);
  }

  generateNoise(renderer) {
    const prevTarget = renderer.getRenderTarget();
    const make3D = (size, frag) => {
      const rt = new THREE.WebGL3DRenderTarget(size, size, size, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false });
      const tex = rt.texture;
      tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;   // generated once after the last slice
      const mat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, uniforms: { uSlice: { value: 0 }, uSize: { value: size } } });
      this.fs.material = mat;
      for (let z = 0; z < size; z++) {
        if (z === size - 1) tex.generateMipmaps = true;
        mat.uniforms.uSlice.value = z;
        renderer.setRenderTarget(rt, z);
        renderer.render(this.fs.scene, this.fs.camera);
      }
      mat.dispose();
      return rt;
    };
    this.baseRT = make3D(128, GEN_BASE_FRAG);
    this.detailRT = make3D(32, GEN_DETAIL_FRAG);
    this.weatherRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.UnsignedByteType, depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    const wm = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: GEN_WEATHER_FRAG, depthTest: false, depthWrite: false });
    this.fs.material = wm;
    this.fs.render(renderer, this.weatherRT);
    wm.dispose();
    renderer.setRenderTarget(prevTarget);
    this.fieldUniforms.uCloudBase.value = this.baseRT.texture;
    this.fieldUniforms.uCloudDetail.value = this.detailRT.texture;
    this.fieldUniforms.uCloudWeather.value = this.weatherRT.texture;
  }

  applyQuality(s) {
    this.settings = s;
    if (!this.ready) return;
    const q = s.clouds || 'impostor';
    this.volumetric = q !== 'impostor' && this.enabled;
    const m = this.marchMat.uniforms;
    m.uSteps.value = s.cloudSteps || 64;
    m.uLightSteps.value = s.cloudLightSteps || 6;
    m.uDetailDist.value = s.cloudDetailDist || 16000;
    this.resScale = s.cloudScale || 0.5;
    // impostor deck: the visible layer without volumetrics, else reflection-only
    // (and not at all when the reflection gets its own volumetric march)
    for (const l of this.layers) {
      if (!this.volumetric) { l.layers.set(0); l.layers.enable(2); }
      else if (s.reflectionClouds) l.layers.disableAll();
      else l.layers.set(2);
    }
    this.composite.visible = this.volumetric;
    this.historyValid = false;
    if (this.size) this.setSize(this.size.x, this.size.y);
  }

  setSize(w, h) {
    this.size = new THREE.Vector2(w, h);
    if (!this.ready) return;
    const cw = Math.max(2, Math.round(w * this.resScale)), ch = Math.max(2, Math.round(h * this.resScale));
    this.marchRT.setSize(cw, ch);
    this.histRT.forEach((r) => r.setSize(cw, ch));
    this.resolveMat.uniforms.uTexel.value.set(1 / cw, 1 / ch);
    this.compositeMat.uniforms.uHalfRes.value.set(cw, ch);
    this.historyValid = false;
  }

  setVisible(v) {
    this.enabled = v;
    for (const l of this.layers) l.visible = v;
    U.uCloudShadow.value = v ? 1 : 0;
    if (this.ready) { this.volumetric = v && (this.settings.clouds || 'impostor') !== 'impostor'; this.composite.visible = this.volumetric; }
  }

  update(dt, camera) {
    U.uCloudOffset.value.x += dt * 9.0;
    U.uCloudOffset.value.y += dt * 3.5;
    this.fieldUniforms.uCloudTime.value += dt;
    if (camera) {
      const below = camera.position.y < this.layers[0].position.y;
      this.layers[0].renderOrder = below ? 9 : 8;
      this.layers[1].renderOrder = below ? 8 : 9;
    }
  }

  /** Per-frame work before the main render: light colours and the cloud shadow map. */
  prepare(renderer, camera, sunDir, moonDir) {
    if (!this.ready) return;
    // main light for the clouds: the sun until the deck is in earth shadow, then the moon
    const sunUp = sunDir.y > -0.07;
    const L = U.uCloudLightDir.value.copy(sunUp ? sunDir : moonDir);
    const E = U.uSunIlluminance.value;
    if (sunUp) {
      // sunlight at the cloud base and tops (slightly raised sun: distant clouds see it longer)
      sunTransmittance(Math.max(sunDir.y, -0.03) + 0.012, 1.9, this.lightColBase);
      sunTransmittance(Math.max(sunDir.y, -0.03) + 0.012, 3.8, this.lightColTop);
      const fade = THREE.MathUtils.smoothstep(sunDir.y, -0.07, -0.035);
      this.lightColBase.multiplyScalar(E * fade);
      this.lightColTop.multiplyScalar(E * fade);
    } else {
      const moonUp = THREE.MathUtils.smoothstep(moonDir.y, -0.02, 0.15);
      const k = 0.05 * moonUp;
      this.lightColBase.setRGB(0.55, 0.68, 1.0).multiplyScalar(k);
      this.lightColTop.copy(this.lightColBase);
    }
    // shadow map centred on the footprint of the ground around the camera, snapped to texels
    const ly = Math.max(L.y, 0.08);
    const cx = camera.position.x + (L.x / ly) * CLOUD_PARAMS.bottom;
    const cz = camera.position.z + (L.z / ly) * CLOUD_PARAMS.bottom;
    const texel = this.shadowSize / this.shadowRes;
    const ox = Math.round((cx - this.shadowSize / 2) / texel) * texel;
    const oz = Math.round((cz - this.shadowSize / 2) / texel) * texel;
    this.shadowMat.uniforms.uOrigin.value.set(ox, oz);
    this.fs.material = this.shadowMat;
    this.fs.render(renderer, this.shadowRT);
    U.uCloudShadowRect.value.set(ox, oz, 1 / this.shadowSize, 1);
  }

  /**
   * Volumetric clouds in the planar water reflection: a cheap, depth-less march at
   * a quarter of the reflection resolution composited over the mirrored sky before
   * the mirrored scene is drawn (called by Water.renderReflection).
   */
  renderReflection(renderer, cam, target) {
    if (!this.volumetric || !this.settings.reflectionClouds) return;
    const w = Math.max(2, target.width >> 1), h = Math.max(2, target.height >> 1);
    if (!this.reflMarchRT) {
      this.reflMarchRT = makeRT(w, h);
      this.farDepth = new THREE.DataTexture(new Float32Array([1e9, 0, 0, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
      this.farDepth.needsUpdate = true;
      this.reflCompMat = new THREE.ShaderMaterial({
        vertexShader: FS_VERT, fragmentShader: REFL_COMP_FRAG, uniforms: { tCloud: { value: this.reflMarchRT.texture } },
        transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      });
    }
    if (this.reflMarchRT.width !== w || this.reflMarchRT.height !== h) this.reflMarchRT.setSize(w, h);
    const m = this.marchMat.uniforms;
    const saved = [m.uSteps.value, m.uLightSteps.value, m.uFrame.value, m.tDepth.value];
    m.uSteps.value = 36; m.uLightSteps.value = 3; m.uFrame.value = 0; m.tDepth.value = this.farDepth;
    m.uInvProj.value.copy(cam.projectionMatrixInverse);
    m.uCamWorld.value.copy(cam.matrixWorld);
    m.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    this.fs.material = this.marchMat;
    this.fs.render(renderer, this.reflMarchRT);
    [m.uSteps.value, m.uLightSteps.value, m.uFrame.value, m.tDepth.value] = saved;
    this.fs.material = this.reflCompMat;
    this.fs.render(renderer, target);
  }

  /** Mid-frame (inside the main scene render): march + temporal resolve. */
  renderVolume(renderer, camera, depthHalf, depthFull) {
    if (!this.volumetric) return;
    this.frame++;
    const cam = camera;
    const setRay = (u) => {
      u.uInvProj.value.copy(cam.projectionMatrixInverse);
      u.uCamWorld.value.copy(cam.matrixWorld);
      u.uCamPos.value.copy(cam.position);
    };
    // reset accumulation on camera jumps
    if (cam.position.distanceTo(this.lastCamPos) > 400) this.historyValid = false;
    this.lastCamPos.copy(cam.position);

    const m = this.marchMat.uniforms;
    setRay(m);
    m.uDetailDist.value = (this.settings.cloudDetailDist || 16000) + Math.max(0, cam.position.y - 3000) * 1.2;
    m.tDepth.value = depthHalf;
    m.uFrame.value = this.frame % 64;
    this.fs.material = this.marchMat;
    this.fs.render(renderer, this.marchRT);

    const prev = this.histRT[this.histIdx], next = this.histRT[1 - this.histIdx];
    const r = this.resolveMat.uniforms;
    setRay(r);
    r.tHist.value = prev.texture;
    r.tDepth.value = depthHalf;
    r.uPrevViewProj.value.copy(this.prevViewProj);
    if (!this.historyValid) this.framesSinceReset = 0;
    this.framesSinceReset++;
    r.uBlend.value = this.historyValid ? Math.max(1 / this.framesSinceReset, 0.14) : 1;
    this.fs.material = this.resolveMat;
    this.fs.render(renderer, next);
    this.histIdx = 1 - this.histIdx;
    this.historyValid = true;
    this.prevViewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    const c = this.compositeMat.uniforms;
    setRay(c);
    c.tCloud.value = next.texture;
    c.tDepthHalf.value = depthHalf;
    c.tDepthFull.value = depthFull;
    c.uNearFar.value.set(cam.near, cam.far);
  }
}
