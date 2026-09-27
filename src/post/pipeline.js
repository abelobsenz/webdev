import * as THREE from 'three';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';
import { CLOUD_SHADOW_LOOKUP } from '../shaders/clouds.glsl.js';
import { U } from '../core/uniforms.js';
import { GpuTimer } from './gpuTimer.js';

// ------------------------------------------------------------------ Bloom --
// Physically-inspired bloom (Jimenez 2014, "Next Generation Post Processing in
// Call of Duty"): 13-tap downsample with Karis average, tent upsample.
const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
uniform float uThreshold;
uniform float uKnee;
uniform float uClamp;
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}
// sanitise: a NaN/Inf pixel must never bleed through the whole bloom chain
vec3 s(vec2 o) { vec3 c = texture(tSrc, vUv + o * uTexel).rgb; return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : min(max(c, 0.0), vec3(uClamp)); }
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
// Screen-space radial blur of the bright *sky* (depth-masked) toward the sun:
// crisp shafts through the Axis lattice and between towers when the sun is in view.
const RAYMASK_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform vec2 uSun;
uniform float uAspect;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture(tSrc, vUv).rgb;
  float sky = step(20000.0, texture(tDepth, vUv).r);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
  float fall = exp(-dot(d, d) * 5.0);
  gl_FragColor = vec4(c * smoothstep(uThreshold * 0.5, uThreshold * 3.0, l) * fall * sky, 1.0);
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
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
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

// ------------------------------------------------------ Volumetric shafts --
// Marches the view ray through the sun's shadow map and the cloud shadow map and
// integrates the single-scattered sunlight that is *blocked* (shadowed air) and
// the part that is lit: crepuscular rays from the Axis, towers and clouds, visible
// from any direction (not only toward the sun). Half resolution + temporal.
const RAY_VERT = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
varying vec2 vUv;
varying vec3 vRay;
void main() {
  vUv = uv;
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  vRay = mat3(uCamWorld) * (v.xyz / v.w);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const SHAFT_FRAG = /* glsl */ `
${CLOUD_SHADOW_LOOKUP}
uniform sampler2D tDepth;
uniform sampler2DShadow uShadowMap;   // two-cascade atlas (SunLight): left half near, right half far
uniform mat4 uShadowM0;
uniform mat4 uShadowM1;
uniform float uShadowOn;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform float uFrame;
uniform float uHaze;
uniform float uMaxDist;
uniform float uCloudShadow;
varying vec2 vUv;
varying vec3 vRay;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float shadowVis(vec3 p) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 s0 = uShadowM0 * vec4(p, 1.0);
  vec3 c0 = s0.xyz / s0.w;
  if (c0.x > 0.0 && c0.x < 0.5 && c0.y > 0.0 && c0.y < 1.0 && c0.z < 1.0) return texture(uShadowMap, vec3(c0.xy, c0.z - 0.00005));
  vec4 s1 = uShadowM1 * vec4(p, 1.0);
  vec3 c1 = s1.xyz / s1.w;
  if (c1.x > 0.5 && c1.x < 1.0 && c1.y > 0.0 && c1.y < 1.0 && c1.z < 1.0) return texture(uShadowMap, vec3(c1.xy, c1.z - 0.00005));
  return 1.0;
}
float hgPhase(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
void main() {
  vec3 rd = normalize(vRay);
  float tMax = min(texture(tDepth, vUv).r, uMaxDist);
  const int N = 28;
  float j = fract(ign(gl_FragCoord.xy) + uFrame * 0.61803398875);
  float cosT = dot(rd, uSunDir);
  // aerosol phase: strong forward lobe + a little back-scatter; Rayleigh
  float pM = mix(hgPhase(cosT, 0.76), hgPhase(cosT, -0.2), 0.12);
  float pR = 0.0597 * (1.0 + cosT * cosT);
  vec3 bR = vec3(5.802e-6, 13.558e-6, 33.1e-6);
  float bM = 1.6e-5 * uHaze;
  vec3 all = vec3(0.0), lit = vec3(0.0);
  for (int i = 0; i < N; i++) {
    float x0 = float(i) / float(N), x1 = float(i + 1) / float(N);
    float t0 = tMax * x0 * x0, t1 = tMax * x1 * x1;
    float t = mix(t0, t1, j);
    vec3 p = uCamPos + rd * t;
    float h = max(p.y, 0.0);
    float rM = exp(-h / 1100.0), rR = exp(-h / 8000.0);
    vec3 Tv = exp(-(bR + vec3(bM)) * t * 0.8);
    vec3 s = (bR * rR * pR + vec3(bM * rM * pM)) * Tv * (t1 - t0);
    float vis = shadowVis(p) * mix(1.0, exp(-cloudShadowOD(p)), uCloudShadow);
    all += s;
    lit += s * vis;
  }
  gl_FragColor = vec4(all - lit, dot(lit, vec3(0.2126, 0.7152, 0.0722)));
}
`;
// generic temporal accumulation with reprojection at a (clamped) scene distance
const TEMPORAL_FRAG = /* glsl */ `
uniform sampler2D tCurr;
uniform sampler2D tHist;
uniform sampler2D tDepth;
uniform mat4 uPrevViewProj;
uniform vec3 uCamPos;
uniform float uBlend;
uniform float uReprojDist;
uniform vec2 uTexel;
varying vec2 vUv;
varying vec3 vRay;
void main() {
  vec4 c = texture(tCurr, vUv);
  vec4 mn = c, mx = c;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec4 s = texture(tCurr, vUv + vec2(float(i), float(j)) * uTexel);
    mn = min(mn, s); mx = max(mx, s);
  }
  vec3 rd = normalize(vRay);
  float tr = min(texture(tDepth, vUv).r, uReprojDist);
  vec4 pc = uPrevViewProj * vec4(uCamPos + rd * tr, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  bool valid = pc.w > 0.0 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)));
  vec4 h = clamp(texture(tHist, puv), mn, mx);
  if (any(isnan(h)) || any(isinf(h))) h = c;     // never let a bad sample live in the history
  vec4 o = mix(h, c, valid ? uBlend : 1.0);
  gl_FragColor = (any(isnan(o)) || any(isinf(o))) ? vec4(0.0, 0.0, 0.0, 1.0) : o;
}
`;

// ------------------------------------------------------------------ SSAO --
// Alchemy-style obscurance from the reduced-resolution ray-distance buffer
// (normals reconstructed from depth), rotated per pixel/frame, temporally
// accumulated; grounds buildings, trees and plinths. Fades out with distance.
const SSAO_FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uProj;
uniform vec2 uRes;
uniform float uFrame;
uniform float uIntensity;
varying vec2 vUv;
vec3 viewDir(vec2 uv) { vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0); return normalize(v.xyz / v.w); }
vec3 posAt(vec2 uv) { return viewDir(uv) * texture(tDepth, uv).r; }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  float t = texture(tDepth, vUv).r;
  if (t > 6000.0) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewDir(vUv) * t;
  vec2 px = 1.0 / uRes;
  vec3 pxp = posAt(vUv + vec2(px.x, 0.0)), pxn = posAt(vUv - vec2(px.x, 0.0));
  vec3 pyp = posAt(vUv + vec2(0.0, px.y)), pyn = posAt(vUv - vec2(0.0, px.y));
  vec3 dx = abs(pxp.z - P.z) < abs(pxn.z - P.z) ? pxp - P : P - pxn;
  vec3 dy = abs(pyp.z - P.z) < abs(pyn.z - P.z) ? pyp - P : P - pyn;
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, P) > 0.0) N = -N;
  float R = clamp(-P.z * 0.012, 2.5, 22.0);
  float rpx = min(R * uProj[1][1] * 0.5 * uRes.y / max(-P.z, 1.0), 48.0);
  if (rpx < 1.5) { gl_FragColor = vec4(1.0); return; }
  float phi = (ign(gl_FragCoord.xy) + uFrame * 0.61803398875) * 6.2831853;
  const int NS = 12;
  float acc = 0.0;
  for (int i = 0; i < NS; i++) {
    float fi = (float(i) + 0.5) / float(NS);
    float r = sqrt(fi) * rpx;
    float a = float(i) * 2.39996323 + phi;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * px;
    vec3 Q = posAt(uv);
    vec3 v = Q - P;
    float vv = dot(v, v);
    float fall = 1.0 - smoothstep(R * R * 0.5, R * R * 1.5, vv);
    acc += max(dot(v, N) - 0.01 * -P.z, 0.0) / (vv + 0.02 * R * R) * fall;
  }
  float ao = max(0.0, 1.0 - acc * 2.0 * uIntensity / float(NS) * R * 0.5);
  ao = mix(1.0, ao, 1.0 - smoothstep(2500.0, 6000.0, t));
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

// --------------------------------------------------------- Auto exposure --
// Centre-weighted log-average luminance (mip-reduced), then temporal adaptation
// of an EV *correction* around the designed time-of-day exposure curve: the eye
// adapts to what it looks at, but night stays night.
const LUM_FRAG = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() {
  vec3 c = texture(tSrc, vUv).rgb;
  float l = dot(min(c, vec3(6e4)), vec3(0.2126, 0.7152, 0.0722));
  vec2 d = vUv - 0.5;
  float w = exp(-dot(d, d) * 5.0) + 0.15;
  gl_FragColor = vec4(log2(max(l, 0.0) + 1e-5) * w, w, 0.0, 1.0);
}
`;
const ADAPT_FRAG = /* glsl */ `
uniform sampler2D tLum;
uniform sampler2D tPrev;
uniform float uLevel;
uniform float uExpectedLog;
uniform float uRange;        // max darkening (EV)
uniform float uRangeUp;      // max brightening (EV): small at night so night stays night
uniform float uStrength;
uniform float uDt;
uniform float uReset;
varying vec2 vUv;
void main() {
  vec2 m = textureLod(tLum, vec2(0.5), uLevel).rg;
  float avgLog = m.x / max(m.y, 1e-6);
  float target = clamp((uExpectedLog - avgLog) * uStrength, -uRange, uRangeUp);
  float prev = texture(tPrev, vec2(0.5)).r;
  float speed = target > prev ? 1.1 : 2.2;       // adapt to darkness slowly, to glare quickly
  float ev = uReset > 0.5 ? target : prev + (target - prev) * (1.0 - exp(-uDt * speed));
  gl_FragColor = vec4(ev, avgLog, target, 1.0);
}
`;

// ------------------------------------------------- Anamorphic streaks ------
const STREAK_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uSpread;
varying vec2 vUv;
void main() {
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  for (int i = -12; i <= 12; i++) {
    float x = float(i);
    float w = exp(-abs(x) * 0.22);
    vec3 c = texture(tSrc, vUv + vec2(x * uSpread * uTexel.x, 0.0)).rgb;
    acc += max(c - vec3(uThreshold), vec3(0.0)) * w;
    ws += w;
  }
  gl_FragColor = vec4(acc / ws, 1.0);
}
`;

// --------------------------------------------------------------- Composite --
const FINAL_FRAG = /* glsl */ `
uniform sampler2D tHDR;
uniform sampler2D tBloom;
uniform sampler2D tBloomWide;
uniform sampler2D tRays;
uniform sampler2D tShafts;
uniform sampler2D tExposure;
uniform sampler2D tStreak;
uniform sampler2D tDirt;
uniform sampler2D tAO;
uniform float uAO;
uniform float uExposure;
uniform float uBloom;
uniform float uRays;
uniform vec3 uRaysColor;
uniform vec3 uShaftColor;
uniform float uShaftDark;
uniform float uShaftLit;
uniform float uStreak;
uniform float uDirt;
uniform float uHLKnee;
uniform float uHLSlope;
uniform float uHLLocal;
uniform sampler2D tBloomLocal;
uniform float uTime;
uniform vec2 uRes;
uniform float uVignette;
uniform float uGrain;
uniform float uCA;
uniform float uFlare;
uniform vec2 uSun;
uniform float uSunVis;
uniform vec3 uGlare;         // analytic sun glare (HDR colour x strength); zero = off
uniform vec2 uGlareUV;       // the Sun's position in uv, may lie well off screen
uniform float uGlareFov;     // vertical field of view (radians)
uniform float uGhosts;       // lens ghost strength
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uContrast;
uniform float uLdrOut;
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
    float w = pow(max(1.0 - length(vec2(0.5) - o) / 0.7071, 0.0), 8.0);
    vec3 s = texture(tBloom, o).rgb;
    float fringe = float(i) * 0.15;
    acc += s * w * mix(vec3(1.0, 0.7, 0.4), vec3(0.5, 0.7, 1.0), fract(fringe));
  }
  // halo ring
  vec2 hv = normalize(vec2(0.5) - tc) * 0.42;
  float hw = pow(max(1.0 - length(vec2(0.5) - fract(tc + hv)) / 0.7071, 0.0), 6.0);
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
  col = (any(isnan(col)) || any(isinf(col))) ? vec3(0.0) : min(max(col, 0.0), vec3(6e4));
  if (uAO > 0.0) col *= mix(1.0, texture(tAO, uv).r, uAO);
  // volumetric shafts: remove the in-scatter of shadowed air, add a touch to lit air
  if (uShaftDark > 0.0) {
    vec4 sh = texture(tShafts, uv);
    col = max(col - sh.rgb * uShaftColor * uShaftDark, col * 0.3);
    col += uShaftColor * sh.a * uShaftLit;
  }
  vec3 bloom = texture(tBloom, uv).rgb;
  col = mix(col, bloom, uBloom);
  col += texture(tRays, uv).rgb * uRays * uRaysColor;
  if (uFlare > 0.0) col += flare(uv) * uFlare;
  if (uGlare.r + uGlare.g + uGlare.b > 0.0) {
    // Veiling glare and diffraction from a source far too bright for screen-space bloom.
    // A function of the angle to the Sun, so it fades smoothly as the Sun leaves the frame.
    vec2 asp = vec2(uRes.x / uRes.y, 1.0);
    vec2 dv = (uv - uGlareUV) * asp;
    float th = length(dv) * uGlareFov;
    float t1 = th / 0.006, t2 = th / 0.05, t3 = th / 0.35;
    float g = 0.55 / (1.0 + t1 * t1) + 0.04 / (1.0 + t2 * t2) + 0.004 / (1.0 + t3 * t3);
    float a = atan(dv.y, dv.x);
    float spikes = (pow(abs(cos(a * 3.0 + 0.3)), 90.0) + 0.6 * pow(abs(cos(a * 3.0 + 1.35)), 140.0)) * exp(-th * 30.0) * 0.35;
    col += uGlare * (g + spikes);
    if (uGhosts > 0.0) {
      vec2 axis = vec2(0.5) - uGlareUV;
      float onScreen = 1.0 - smoothstep(0.55, 0.9, max(abs(uGlareUV.x - 0.5), abs(uGlareUV.y - 0.5)));
      vec3 gh = vec3(0.0);
      for (int i = 0; i < 5; i++) {
        float f = float(i);
        float k = 0.55 + f * 0.36;                        // position along the axis
        float r = 0.018 + 0.03 * fract(f * 0.618 + 0.2);  // radius (uv height units)
        vec2 gp = uGlareUV + axis * 2.0 * k;
        float d = length((uv - gp) * asp);
        float disc = smoothstep(r, r * 0.55, d) * (0.5 + 0.5 * smoothstep(r * 0.4, r, d));
        vec3 tint = mix(vec3(1.0, 0.55, 0.25), vec3(0.35, 0.75, 1.0), fract(f * 0.37 + 0.1));
        gh += tint * disc * (0.6 - 0.08 * f);
      }
      // a faint halo ring round the centre
      float ring = exp(-pow(abs(length((uv - 0.5) * asp) - 0.42) / 0.012, 2.0)) * 0.25;
      gh += vec3(0.6, 0.8, 1.0) * ring * smoothstep(0.6, 0.0, length(uv - uGlareUV));
      col += uGlare * gh * uGhosts * onScreen;
    }
  }
  if (uStreak > 0.0) col += texture(tStreak, uv).rgb * uStreak * vec3(0.55, 0.75, 1.0);
  if (uDirt > 0.0) col += texture(tBloomWide, uv).rgb * texture(tDirt, uv).rgb * uDirt;
  float expo = uExposure * exp2(texture(tExposure, vec2(0.5)).r);
  col *= expo;
  // highlight handling: log-domain knee on luminance (hue-preserving); strong at night so
  // the sunlit Halo and the Moon stay dazzling (bloom sees the full HDR) yet detailed.
  // Local term: large bright regions (the blurred bright-pass around this pixel) are
  // compressed harder than isolated points (exposure-fusion style, gated by the
  // pixel's own luminance so dark sky next to the ring is never dimmed).
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  if (lum > uHLKnee) {
    float loc = dot(texture(tBloomLocal, uv).rgb, vec3(0.2126, 0.7152, 0.0722)) * expo;
    float slope = uHLSlope / (1.0 + uHLLocal * max(log2(max(loc, 1e-4) / uHLKnee), 0.0));
    float lc = uHLKnee * exp2(log2(lum / uHLKnee) * slope);
    col *= lc / lum;
  }
  // grading in scene-linear: lift / gain
  col = col * uGain + uLift * (1.0 - col / (1.0 + col));
  col = agx(col);
  col = agxLook(col);
  col = agxEotf(col);
  // vignette
  float vig = 1.0 - uVignette * smoothstep(0.15, 0.85, r2 * 1.6);
  col *= vig;
  vec3 srgb = linearToSRGB(clamp(col, 0.0, 1.0));
  if (uLdrOut < 0.5) {
    // film grain + dither in display space
    float g = hash(uv * uRes + fract(uTime * 13.37) * 100.0) - 0.5;
    srgb += g * uGrain * (1.0 - srgb * 0.7);
    srgb += (hash(uv * uRes + 7.1) - 0.5) / 255.0;
  }
  gl_FragColor = vec4(srgb, 1.0);
}
`;

// FXAA (after Lottes) on the display-referred image, then grain + dither.
const FXAA_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform vec2 uRes;
uniform float uTime;
uniform float uGrain;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 px = uTexel;
  const vec3 LW = vec3(0.299, 0.587, 0.114);
  vec3 rgbNW = texture(tSrc, vUv + vec2(-1.0, -1.0) * px).rgb;
  vec3 rgbNE = texture(tSrc, vUv + vec2(1.0, -1.0) * px).rgb;
  vec3 rgbSW = texture(tSrc, vUv + vec2(-1.0, 1.0) * px).rgb;
  vec3 rgbSE = texture(tSrc, vUv + vec2(1.0, 1.0) * px).rgb;
  vec3 rgbM = texture(tSrc, vUv).rgb;
  float lNW = dot(rgbNW, LW), lNE = dot(rgbNE, LW), lSW = dot(rgbSW, LW), lSE = dot(rgbSE, LW), lM = dot(rgbM, LW);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec3 col = rgbM;
  if (lMax - lMin > max(0.04, lMax * 0.12)) {
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
    float dirReduce = max((lNW + lNE + lSW + lSE) * (0.25 / 8.0), 1.0 / 128.0);
    float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * px;
    vec3 rgbA = 0.5 * (texture(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 rgbB = rgbA * 0.5 + 0.25 * (texture(tSrc, vUv - dir * 0.5).rgb + texture(tSrc, vUv + dir * 0.5).rgb);
    float lB = dot(rgbB, LW);
    col = (lB < lMin || lB > lMax) ? rgbA : rgbB;
  }
  float g = hash(vUv * uRes + fract(uTime * 13.37) * 100.0) - 0.5;
  col += g * uGrain * (1.0 - col * 0.7);
  col += (hash(vUv * uRes + 7.1) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Procedural lens-dirt texture: soft smudges and a few larger blotches. */
function createDirtTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  let seed = 1337;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const acc = new Float32Array(size * size);
  for (let k = 0; k < 110; k++) {
    const cx = rnd() * size, cy = rnd() * size;
    const r = 2 + Math.pow(rnd(), 2.2) * 26;
    const a = 0.08 + rnd() * 0.35;
    const ring = rnd() < 0.3;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(size - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(size - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      const v = ring ? Math.exp(-Math.pow((d - 0.85) / 0.12, 2)) * 0.8 + 0.2 * (1 - d) : Math.pow(1 - d * d, 1.5);
      acc[y * size + x] += v * a;
    }
  }
  for (let i = 0; i < size * size; i++) {
    const v = Math.min(1, acc[i] + 0.05);
    data[i * 4] = v * 255; data[i * 4 + 1] = v * 240; data[i * 4 + 2] = v * 225; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const BACKDROP_FRAG = /* glsl */ `
uniform sampler2D tSky;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture(tSky, vUv).rgb, 1.0); }
`;

// Half-resolution ray distance (metres) from the captured depth buffer; takes the
// farthest depth of the footprint so volumetrics march "past" thin foreground edges.
const LINDEPTH_VERT = /* glsl */ `
uniform mat4 uInvProj;
varying vec2 vUv;
varying vec3 vViewRay;
void main() {
  vUv = uv;
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  vViewRay = v.xyz / v.w;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const LINDEPTH_FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uNearFar;
uniform vec2 uSrcSize;
uniform vec2 uScale;
varying vec2 vUv;
varying vec3 vViewRay;
void main() {
  vec2 base = floor(gl_FragCoord.xy) / uScale;
  vec2 fp = 1.0 / uScale;
  ivec2 mx = ivec2(uSrcSize) - 1;
  float d = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    ivec2 q = clamp(ivec2(base + fp * (vec2(float(i), float(j)) * 0.5 + 0.25)), ivec2(0), mx);
    d = max(d, texelFetch(tDepth, q, 0).r);
  }
  float n = uNearFar.x, f = uNearFar.y;
  float vz = 2.0 * n * f / (f + n - (d * 2.0 - 1.0) * (f - n));
  float t = d >= 0.999999 ? 1e9 : vz * length(vViewRay) / max(-vViewRay.z, 1e-6);
  gl_FragColor = vec4(t, 0.0, 0.0, 1.0);
}
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
    const mkRay = (frag, uniforms) => new THREE.ShaderMaterial({
      vertexShader: RAY_VERT, fragmentShader: frag, depthTest: false, depthWrite: false,
      uniforms: { uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, ...uniforms },
    });
    this.downMat = mk(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThreshold: { value: 1.2 }, uKnee: { value: 0.6 }, uClamp: { value: 6e4 } });
    this.upMat = mk(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.rayMaskMat = mk(RAYMASK_FRAG, { tSrc: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uThreshold: { value: 3 } });
    this.rayBlurMat = mk(RAYBLUR_FRAG, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uStep: { value: 1 } });

    // --- rendering agent: new post passes -------------------------------------------
    // auto exposure
    this.lumRT = new THREE.WebGLRenderTarget(128, 64, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.expRT = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false }));
    this.expIdx = 0;
    this.lumMat = mk(LUM_FRAG, { tSrc: { value: null } });
    this.adaptMat = mk(ADAPT_FRAG, { tLum: { value: this.lumRT.texture }, tPrev: { value: null }, uLevel: { value: 7 }, uExpectedLog: { value: 0 }, uRange: { value: 1.2 }, uRangeUp: { value: 0.7 }, uStrength: { value: 0.6 }, uDt: { value: 0.016 }, uReset: { value: 1 } });
    this.expReset = true;
    // volumetric shafts (resolution follows the cloud / linear-depth buffer)
    this.shaftRT = new THREE.WebGLRenderTarget(1, 1, { ...hf, depthBuffer: false });
    this.shaftHist = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { ...hf, depthBuffer: false }));
    this.shaftIdx = 0;
    this.shaftMat = mkRay(SHAFT_FRAG, {
      tDepth: { value: null }, uShadowMap: { value: null }, uShadowM0: { value: new THREE.Matrix4() }, uShadowM1: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 },
      uSunDir: U.uSunDir, uHaze: U.uHaze, uFrame: { value: 0 }, uMaxDist: { value: 16000 }, uCloudShadow: U.uCloudShadow,
      uCloudShadowMap: U.uCloudShadowMap, uCloudShadowRect: U.uCloudShadowRect, uCloudLightDir: U.uCloudLightDir,
    });
    this.temporalMat = mkRay(TEMPORAL_FRAG, { tCurr: { value: null }, tHist: { value: null }, tDepth: { value: null }, uPrevViewProj: { value: new THREE.Matrix4() }, uBlend: { value: 1 }, uReprojDist: { value: 3000 }, uTexel: { value: new THREE.Vector2() } });
    this.aoRT = new THREE.WebGLRenderTarget(1, 1, { ...hf, depthBuffer: false });
    this.aoHist = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { ...hf, depthBuffer: false }));
    this.aoIdx = 0;
    this.aoMat = mk(SSAO_FRAG, { tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1, 1) }, uFrame: { value: 0 }, uIntensity: { value: 1.0 } });
    this.aoPrevVP = new THREE.Matrix4();
    this.aoValid = false;
    this.shaftPrevVP = new THREE.Matrix4();
    this.shaftValid = false;
    this.shaftFrame = 0;
    // anamorphic streaks + lens dirt
    this.streakRT = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { ...hf, depthBuffer: false }));
    this.streakMat = mk(STREAK_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 }, uSpread: { value: 1 } });
    this.dirtTex = createDirtTexture();
    // FXAA
    this.ldrRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.fxaaMat = mk(FXAA_FRAG, { tSrc: { value: this.ldrRT.texture }, uTexel: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2() }, uTime: { value: 0 }, uGrain: { value: 0.02 } });
    const black = new THREE.DataTexture(new Float32Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    black.needsUpdate = true;
    this.blackTex = black;

    this.finalMat = mk(FINAL_FRAG, {
      tHDR: { value: this.hdrRT.texture }, tBloom: { value: this.bloomRTs[0].texture }, tBloomWide: { value: this.bloomRTs[4].texture }, tRays: { value: this.rayRT[0].texture },
      tShafts: { value: black }, tExposure: { value: this.expRT[0].texture }, tStreak: { value: this.streakRT[0].texture }, tDirt: { value: this.dirtTex },
      uExposure: { value: 1 }, uBloom: { value: 0.05 }, uRays: { value: 0 }, uRaysColor: { value: new THREE.Color(1, 0.9, 0.7) },
      uShaftColor: { value: new THREE.Color() }, uShaftDark: { value: 0 }, uShaftLit: { value: 0 }, uStreak: { value: 0 }, uDirt: { value: 0 },
      uHLKnee: { value: 1.5 }, uHLSlope: { value: 1 }, uHLLocal: { value: 0.35 }, tBloomLocal: { value: this.bloomRTs[3].texture }, tAO: { value: black }, uAO: { value: 0 },
      uTime: { value: 0 }, uRes: { value: new THREE.Vector2() }, uVignette: { value: 0.3 }, uGrain: { value: 0.02 }, uCA: { value: 0.0015 },
      uFlare: { value: 0.0 }, uSun: { value: new THREE.Vector2() }, uSunVis: { value: 0 }, uGlare: { value: new THREE.Vector3() }, uGlareUV: { value: new THREE.Vector2() }, uGlareFov: { value: 1 }, uGhosts: { value: 0 },
      uLift: { value: new THREE.Vector3(0, 0, 0) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSaturation: { value: 1.15 }, uContrast: { value: 1.08 }, uLdrOut: { value: 0 },
    });

    // Backdrop: draws the sky render at the start of the main (MSAA) pass
    this.backdrop = new THREE.Mesh(this.fs.mesh.geometry, new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BACKDROP_FRAG, uniforms: { tSky: { value: this.skyRT.texture } }, depthTest: false, depthWrite: false,
    }));
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = -10000;
    this.backdrop.layers.set(0);

    this.sunScreen = new THREE.Vector3();

    // --- rendering agent: mid-frame capture of the opaque scene -------------------
    // A no-op mesh in the transparent queue (renderOrder -2, main view only) resolves
    // the MSAA depth (and colour, for water refraction) into sceneCopyRT after all
    // opaque geometry, derives a reduced-resolution ray-distance buffer and runs the
    // volumetric cloud march; the clouds are then composited at renderOrder -0.5,
    // after the water (-1) and before traffic / motes / beacons.
    this.sceneCopyRT = new THREE.WebGLRenderTarget(1, 1, { ...hf, depthBuffer: true, depthTexture: new THREE.DepthTexture(1, 1) });
    this.linDepthRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    this.linDepthMat = new THREE.ShaderMaterial({
      vertexShader: LINDEPTH_VERT, fragmentShader: LINDEPTH_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tDepth: { value: this.sceneCopyRT.depthTexture }, uNearFar: { value: new THREE.Vector2(1, 1000) }, uSrcSize: { value: new THREE.Vector2(1, 1) }, uScale: { value: new THREE.Vector2(0.5, 0.5) }, uInvProj: { value: new THREE.Matrix4() } },
    });
    const hookGeo = new THREE.BufferGeometry();
    hookGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    this.hook = new THREE.Mesh(hookGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, colorWrite: false }));
    this.hook.frustumCulled = false;
    this.hook.renderOrder = -2;
    this.hook.layers.set(1);
    this.hook.onBeforeRender = (renderer, scene, camera) => this.captureOpaque(renderer, camera);
    this.clouds = null;
    this.mainCamera = null;
    this.captured = false;
    this.wantColorCopy = false;
    this.linScale = 0.5;
    this._v = new THREE.Vector3();
    this.timer = new GpuTimer(renderer.getContext(), typeof location !== 'undefined' && new URLSearchParams(location.search).has('gpuprof'));
  }

  /** Hook the volumetric passes into the main scene (called once the world exists). */
  attach(world, scene, camera, sunLight) {
    this.mainCamera = camera;
    scene.add(this.hook);
    if (world && world.clouds) {
      this.clouds = world.clouds;
      this.clouds.init(this.renderer, this.settings);
    }
    if (world && world.water && world.water.attachScene) {
      world.water.attachScene(this, camera, sunLight);
      if (this.clouds) world.water.reflectionSkyHook = (r, cam, target) => this.clouds.renderReflection(r, cam, target);
    }
    this.applySettings(this.settings);
  }

  applySettings(settings) {
    this.settings = settings;
    this.linScale = settings.cloudScale || 0.5;
    this.wantColorCopy = !!settings.refraction;
    // the mid-frame capture is only needed by volumetric / depth-aware features
    this.captureNeeded = settings.clouds === 'volumetric' || !!settings.refraction || settings.shafts !== false || !!settings.ao || !!settings.rays;
    if (this.clouds) this.clouds.applyQuality(settings);
    this.shaftValid = false;
    this.setSize(this.size.x, this.size.y);
  }

  /** Per-frame preparation before the main scene render. */
  beginFrame(camera, sunDir, moonDir) {
    this.captured = false;
    const r = this.renderer;
    r.initRenderTarget(this.sceneCopyRT);
    if (this.clouds) this.clouds.prepare(r, camera, sunDir, moonDir);
  }

  blitScene(renderer, src, withColor) {
    const gl = renderer.getContext();
    const sp = renderer.properties.get(src);
    const srcFbo = src.samples > 0 ? sp.__webglMultisampledFramebuffer : sp.__webglFramebuffer;
    const dstFbo = renderer.properties.get(this.sceneCopyRT).__webglFramebuffer;
    if (!srcFbo || !dstFbo || src.width !== this.sceneCopyRT.width || src.height !== this.sceneCopyRT.height) return false;
    const state = renderer.state;
    state.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFbo);
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFbo);
    const w = src.width, h = src.height;
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT | (withColor ? gl.COLOR_BUFFER_BIT : 0), gl.NEAREST);
    state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    return true;
  }

  captureOpaque(renderer, camera) {
    if (camera !== this.mainCamera || this.captured || this.captureNeeded === false) return;
    const target = renderer.getRenderTarget();
    if (target !== this.hdrRT) return;
    this.timer.begin('capture+clouds');
    this.captured = this.blitScene(renderer, target, this.wantColorCopy);
    if (!this.captured) { renderer.setRenderTarget(target); return; }
    const u = this.linDepthMat.uniforms;
    u.uNearFar.value.set(camera.near, camera.far);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    this.fs.material = this.linDepthMat;
    this.fs.render(renderer, this.linDepthRT);
    if (this.clouds) this.clouds.renderVolume(renderer, camera, this.linDepthRT.texture, this.sceneCopyRT.depthTexture);
    renderer.setRenderTarget(target);
    this.timer.begin('scene:transparent');
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
    // mid-frame capture targets
    this.sceneCopyRT.setSize(w, h);
    const lw = Math.max(2, Math.round(w * this.linScale)), lh = Math.max(2, Math.round(h * this.linScale));
    this.linDepthRT.setSize(lw, lh);
    this.linDepthMat.uniforms.uSrcSize.value.set(w, h);
    this.linDepthMat.uniforms.uScale.value.set(lw / w, lh / h);
    this.aoRT.setSize(lw, lh);
    this.aoHist.forEach((rt) => rt.setSize(lw, lh));
    this.aoMat.uniforms.uRes.value.set(lw, lh);
    this.aoValid = false;
    this.shaftRT.setSize(lw, lh);
    this.shaftHist.forEach((rt) => rt.setSize(lw, lh));
    this.temporalMat.uniforms.uTexel.value.set(1 / lw, 1 / lh);
    this.shaftValid = false;
    const sw = Math.max(1, w >> 2), sh = Math.max(1, h >> 3);
    this.streakRT.forEach((rt) => rt.setSize(sw, sh));
    this.ldrRT.setSize(w, h);
    this.fxaaMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.fxaaMat.uniforms.uRes.value.set(w, h);
    if (this.clouds) this.clouds.setSize(w, h);
  }

  setMSAA(samples) {
    if (this.hdrRT.samples === samples) return;
    this.hdrRT.dispose();
    this.hdrRT.samples = samples;
    this.finalMat.uniforms.tHDR.value = this.hdrRT.texture;
  }

  renderBloom() {
    this.timer.begin('bloom');
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

  /**
   * Auto exposure: returns nothing, the adapted EV correction lives on the GPU
   * (1x1 float texture read by the composite). expectedLum = the average scene
   * luminance the designed exposure curve expects at this time of day.
   */
  renderExposure(dt, expectedLum, reset = false) {
    this.timer.begin('exposure');
    const r = this.renderer;
    const fs = this.fs;
    this.lumMat.uniforms.tSrc.value = this.hdrRT.texture;
    fs.material = this.lumMat;
    fs.render(r, this.lumRT);
    const a = this.adaptMat.uniforms;
    const prev = this.expRT[this.expIdx], next = this.expRT[1 - this.expIdx];
    a.tPrev.value = prev.texture;
    a.uExpectedLog.value = Math.log2(Math.max(expectedLum, 1e-6));
    a.uDt.value = dt;
    a.uReset.value = (reset || this.expReset) ? 1 : 0;
    a.uStrength.value = this.settings.autoExposure === false ? 0 : 0.65;
    a.uRangeUp.value = 0.7 - 0.5 * U.uNight.value;
    fs.material = this.adaptMat;
    fs.render(r, next);
    this.expIdx = 1 - this.expIdx;
    this.expReset = false;
    this.finalMat.uniforms.tExposure.value = next.texture;
  }

  /** Volumetric light shafts (shadow map + cloud shadows), temporally accumulated. */
  renderShafts(camera, sunLight, sunRadiance, strength) {
    const f = this.finalMat.uniforms;
    if (!this.captured || strength <= 0.001 || this.settings.shafts === false) {
      f.uShaftDark.value = 0; f.uShaftLit.value = 0; f.tShafts.value = this.blackTex; this.shaftValid = false;
      return;
    }
    this.timer.begin('shafts');
    const r = this.renderer;
    const fs = this.fs;
    const setRay = (u) => {
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uCamWorld.value.copy(camera.matrixWorld);
      u.uCamPos.value.copy(camera.position);
    };
    const u = this.shaftMat.uniforms;
    setRay(u);
    u.tDepth.value = this.linDepthRT.texture;
    const sm = sunLight.shadow && sunLight.shadow.map;
    u.uShadowOn.value = sm && sunLight.castShadow ? 1 : 0;
    u.uShadowMap.value = sm ? sm.depthTexture : null;
    if (sm) {
      const sh = sunLight.shadow;
      u.uShadowM0.value.copy(sh.getMatrix ? sh.getMatrix(0) : sh.matrix);
      u.uShadowM1.value.copy(sh.getMatrix ? sh.getMatrix(1) : sh.matrix);
    }
    u.uFrame.value = (this.shaftFrame++) % 64;
    // teleports (tour, captures) invalidate the temporal histories
    if (!this._lastPos) this._lastPos = camera.position.clone();
    if (this._lastPos.distanceTo(camera.position) > 300) { this.shaftValid = false; this.aoValid = false; }
    this._lastPos.copy(camera.position);
    u.uMaxDist.value = THREE.MathUtils.clamp(9000 + camera.position.y * 2, 9000, 30000);
    fs.material = this.shaftMat;
    fs.render(r, this.shaftRT);
    const t = this.temporalMat.uniforms;
    setRay(t);
    const prev = this.shaftHist[this.shaftIdx], next = this.shaftHist[1 - this.shaftIdx];
    t.tCurr.value = this.shaftRT.texture;
    t.tHist.value = prev.texture;
    t.tDepth.value = this.linDepthRT.texture;
    t.uPrevViewProj.value.copy(this.shaftPrevVP);
    t.uBlend.value = this.shaftValid ? 0.2 : 1;
    t.uReprojDist.value = 3000;
    fs.material = this.temporalMat;
    fs.render(r, next);
    this.shaftIdx = 1 - this.shaftIdx;
    this.shaftValid = true;
    this.shaftPrevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    f.tShafts.value = next.texture;
    f.uShaftColor.value.copy(sunRadiance);
    f.uShaftDark.value = 0.85 * strength;
    f.uShaftLit.value = 0.15 * strength;
  }

  /** Screen-space ambient obscurance (reduced resolution, temporally accumulated). */
  renderAO(camera, strength) {
    const f = this.finalMat.uniforms;
    if (!this.captured || strength <= 0.001 || !this.settings.ao) { f.uAO.value = 0; this.aoValid = false; return; }
    this.timer.begin('ao');
    const r = this.renderer, fs = this.fs;
    const u = this.aoMat.uniforms;
    u.tDepth.value = this.linDepthRT.texture;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uProj.value.copy(camera.projectionMatrix);
    u.uFrame.value = (this.shaftFrame + 17) % 64;
    fs.material = this.aoMat;
    fs.render(r, this.aoRT);
    const t = this.temporalMat.uniforms;
    t.uInvProj.value.copy(camera.projectionMatrixInverse);
    t.uCamWorld.value.copy(camera.matrixWorld);
    t.uCamPos.value.copy(camera.position);
    const prev = this.aoHist[this.aoIdx], next = this.aoHist[1 - this.aoIdx];
    t.tCurr.value = this.aoRT.texture;
    t.tHist.value = prev.texture;
    t.tDepth.value = this.linDepthRT.texture;
    t.uPrevViewProj.value.copy(this.aoPrevVP);
    t.uBlend.value = this.aoValid ? 0.25 : 1;
    t.uReprojDist.value = 1e7;
    fs.material = this.temporalMat;
    fs.render(r, next);
    this.aoIdx = 1 - this.aoIdx;
    this.aoValid = true;
    this.aoPrevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    f.tAO.value = next.texture;
    f.uAO.value = strength;
  }

  renderRays(sunUV, strength) {
    const r = this.renderer;
    const fs = this.fs;
    if (strength <= 0.001) { this.finalMat.uniforms.uRays.value = 0; return; }
    this.timer.begin('rays');
    fs.material = this.rayMaskMat;
    this.rayMaskMat.uniforms.tSrc.value = this.bloomRTs[1].texture;
    this.rayMaskMat.uniforms.tDepth.value = this.captured ? this.linDepthRT.texture : this.blackTex;
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

  /** Anamorphic streaks from the strongest highlights (sun, beacons at night). */
  renderStreaks(strength, threshold) {
    const f = this.finalMat.uniforms;
    f.uStreak.value = strength;
    if (strength <= 0.001) return;
    this.timer.begin('streaks');
    const r = this.renderer, fs = this.fs;
    const u = this.streakMat.uniforms;
    fs.material = this.streakMat;
    u.tSrc.value = this.bloomRTs[1].texture;
    u.uTexel.value.set(1 / this.streakRT[0].width, 1 / this.streakRT[0].height);
    u.uThreshold.value = threshold; u.uSpread.value = 1.5;
    fs.render(r, this.streakRT[1]);
    u.tSrc.value = this.streakRT[1].texture;
    u.uThreshold.value = 0; u.uSpread.value = 5.0;
    fs.render(r, this.streakRT[0]);
    f.tStreak.value = this.streakRT[0].texture;
  }

  composite() {
    this.timer.begin('composite+fxaa');
    const fxaa = !!this.settings.fxaa;
    const f = this.finalMat.uniforms;
    f.uLdrOut.value = fxaa ? 1 : 0;
    this.fs.material = this.finalMat;
    this.fs.render(this.renderer, fxaa ? this.ldrRT : null);
    if (fxaa) {
      const u = this.fxaaMat.uniforms;
      u.uTime.value = f.uTime.value;
      u.uGrain.value = f.uGrain.value;
      this.fs.material = this.fxaaMat;
      this.fs.render(this.renderer, null);
    }
    this.timer.end();
    this.timer.poll();
  }
}
