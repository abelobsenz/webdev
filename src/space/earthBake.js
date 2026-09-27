import * as THREE from 'three';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';
import { SNOISE_GLSL } from './glsl.js';
import { LAND_MASK_PNG } from './landmask.js';
import { CITIES, RANGES, DESERTS } from './earthData.js';
import { bodyDir } from './sim.js';

// GPU bake of the planet's surface and weather into cube maps (body frame).
//   surfA: rgb = sqrt(albedo), a = height (0.5 = sea level)
//   surfB: r = night-light density, g = ice, b = aridity, a = shallow shelf
//   clouds: r, g = two weather "potential" fields (cross-faded while they drift),
//           b = static coverage bias, a = cirrus streaks

const D2R = Math.PI / 180;

const BAKE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMask;
uniform sampler2D uData;
uniform int uNumSeg;
uniform int uNumCity;
uniform int uFace;
uniform int uOut;
uniform vec4 uDeserts[10];
uniform vec4 uCyc[28];
uniform int uNumCyc;
varying vec2 vUv;
${SNOISE_GLSL}
#define PI 3.14159265359

vec3 faceDir(vec2 st) {
  float sc = st.x * 2.0 - 1.0, tc = st.y * 2.0 - 1.0;
  vec3 d;
  if (uFace == 0) d = vec3(1.0, -tc, -sc);
  else if (uFace == 1) d = vec3(-1.0, -tc, sc);
  else if (uFace == 2) d = vec3(sc, 1.0, tc);
  else if (uFace == 3) d = vec3(sc, -1.0, -tc);
  else if (uFace == 4) d = vec3(sc, -tc, 1.0);
  else d = vec3(-sc, -tc, -1.0);
  return normalize(d);
}
float maskAt(vec2 uv, float lod) { return textureLod(uMask, uv, lod).r; }

float boxMask(float lat, float lon, vec4 b, float soft) {
  // b = (latMin, latMax, lonMin, lonMax) in degrees
  float la = smoothstep(b.x - soft, b.x + soft, lat) * (1.0 - smoothstep(b.y - soft, b.y + soft, lat));
  float lo = smoothstep(b.z - soft, b.z + soft, lon) * (1.0 - smoothstep(b.w - soft, b.w + soft, lon));
  return la * lo;
}

vec3 rotAround(vec3 p, vec3 axis, float a) {
  float c = cos(a), s = sin(a);
  return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}

float cloudPotential(vec3 d, float seed, out float hurricane) {
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float alat = abs(lat);
  vec3 p = d;
  hurricane = 0.0;
  for (int i = 0; i < 28; i++) {
    if (i >= uNumCyc) break;
    vec4 c = uCyc[i];
    float R = length(c.xyz);
    vec3 cd = c.xyz / R;
    float r = length(p - cd);
    float fall = exp(-r * r / (R * R));
    float ang = c.w * fall * (1.0 + 0.8 * exp(-r * r / (R * R * 0.1)));
    p = rotAround(p, cd, ang);
    if (abs(c.w) > 7.0) hurricane = max(hurricane, fall);
  }
  // domain-warped fractal weather
  vec3 q = p * 2.6 + seed;
  vec3 warp = vec3(sfbm(q * 1.3 + 3.1, 4), sfbm(q * 1.3 + 7.7, 4), sfbm(q * 1.3 + 1.9, 4));
  float large = sfbm(q + warp * 0.55, 5) * 0.5 + 0.5;
  vec3 w2 = vec3(sfbm(p * 9.0 + 5.3, 3), sfbm(p * 9.0 + 2.2, 3), sfbm(p * 9.0 + 8.8, 3));
  float mid = sfbm(p * 8.0 + w2 * 0.5 + seed * 1.3, 6) * 0.5 + 0.5;
  float cells = sridged(p * 34.0 + seed * 3.0, 4);
  float n = large * 0.62 + mid * 0.38;
  // zonal climate: ITCZ (a little north in June), dry subtropics, stormy mid-latitudes
  float itcz = exp(-pow((lat - 0.1) / 0.075, 2.0));
  float subtrop = exp(-pow((alat - 0.43) / 0.12, 2.0));
  float storm = exp(-pow((alat - 0.96) / 0.22, 2.0));
  float polar = smoothstep(1.15, 1.4, alat);
  float bias = 0.03 + 0.26 * itcz - 0.22 * subtrop + 0.16 * storm + 0.05 * polar;
  float pot = n * 0.8 + cells * 0.2 + bias;
  // storm tracks become streaky fronts
  float front = pow(1.0 - abs(sfbm(p * vec3(2.2, 7.0, 2.2) + seed * 1.7, 5)), 6.0) * storm;
  pot += front * 0.35;
  return pot;
}

void main() {
  vec3 d = faceDir(vUv);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float lon = atan(-d.z, d.x);
  float latD = lat / PI * 180.0, lonD = lon / PI * 180.0, alat = abs(latD);
  vec2 muv = vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
  float m0 = maskAt(muv, 0.0);
  float mc = maskAt(muv, 4.0);
  float mC = maskAt(muv, 6.5);
  if (latD < -85.0) { m0 = 1.0; mc = 1.0; mC = 1.0; }

  if (uOut == 2) {
    float hA, hB;
    float a = cloudPotential(d, 0.0, hA);
    float b = cloudPotential(d, 37.0, hB);
    // cirrus: streaks along the jets
    float ci = sfbm(vec3(d.x * 5.0, d.y * 42.0, d.z * 5.0) + vec3(sfbm(d * 6.0, 3) * 2.0), 5) * 0.5 + 0.5;
    float jet = exp(-pow((alat - 38.0) / 14.0, 2.0)) + 0.5 * exp(-pow((latD - 6.0) / 10.0, 2.0));
    // land: clearer deserts, cloudier rainforest
    float des = 0.0;
    for (int i = 0; i < 10; i++) des = max(des, boxMask(latD, lonD, uDeserts[i], 3.0));
    float bias = -0.22 * des * mc + 0.06 * exp(-pow(latD / 10.0, 2.0)) * mc;
    gl_FragColor = vec4(clamp(a * 0.8, 0.0, 1.0), clamp(b * 0.8, 0.0, 1.0), clamp(0.5 + bias, 0.0, 1.0), clamp(ci * jet, 0.0, 1.0));
    return;
  }

  // --- coastline with fractal detail ---
  float coastBand = 1.0 - abs(2.0 * m0 - 1.0);
  float nearCoast = 1.0 - abs(2.0 * mc - 1.0);
  float nC = sfbm(d * 160.0, 5);
  float s = (m0 - 0.5) + 0.3 * nC * clamp(coastBand * 1.2 + nearCoast * 0.35, 0.0, 1.0);
  float land = step(0.0, s);

  // --- deserts / aridity ---
  float n1 = sfbm(d * 7.0 + 4.0, 5);
  float n2 = sfbm(d * 36.0 + 11.0, 4);
  float desert = 0.0;
  for (int i = 0; i < 10; i++) {
    vec4 b = uDeserts[i];
    desert = max(desert, boxMask(latD, lonD, b, 4.0));
  }
  float subtrop = exp(-pow((alat - 24.0) / 8.0, 2.0)) * smoothstep(0.5, 0.95, mC);
  float arid = clamp(max(desert * (0.75 + 0.35 * n1), subtrop * 0.55) + n2 * 0.12, 0.0, 1.0);
  arid *= smoothstep(0.1, 0.6, mc + 0.2);

  if (uOut == 1) {
    // night lights
    float city = 0.0;
    for (int i = 0; i < 160; i++) {
      if (i >= uNumCity) break;
      vec4 c = texelFetch(uData, ivec2(i, 2), 0);
      vec3 dv = d - c.xyz;
      float sg = (18.0 + 42.0 * c.w) / 6371.0;
      city += c.w * exp(-dot(dv, dv) / (sg * sg)) * (0.7 + 0.3 * sfbm(d * 900.0 + float(i), 2));
    }
    float hab = land * (1.0 - arid * 0.85) * (1.0 - smoothstep(52.0, 66.0, alat)) * (1.0 - step(latD, -56.0));
    float coastal = 0.35 + 0.65 * (1.0 - mc);
    float towns = smoothstep(0.5, 0.85, sfbm(d * 70.0 + 2.0, 4) * 0.5 + 0.5) * smoothstep(0.35, 0.8, sfbm(d * 9.0 + 5.0, 3) * 0.5 + 0.5);
    city = (city + hab * coastal * towns * 0.07) * land;
    float ice = 0.0;
    if (latD < -62.0) ice = land;
    if (latD > 59.0 && lonD > -74.0 && lonD < -12.0) ice = land * smoothstep(0.35, 0.8, mc);
    ice = max(ice, (1.0 - land) * smoothstep(77.0, 82.0, latD + n2 * 6.0));
    ice = max(ice, (1.0 - land) * smoothstep(-68.0, -71.0, latD + n2 * 4.0));
    float shelf = (1.0 - land) * smoothstep(0.35, 0.95, mc + 0.25 * coastBand + n1 * 0.1);
    gl_FragColor = vec4(clamp(city, 0.0, 1.0), ice, arid, shelf);
    return;
  }

  // --- relief ---
  float mount = 0.0;
  for (int i = 0; i < 200; i++) {
    if (i >= uNumSeg) break;
    vec4 a = texelFetch(uData, ivec2(i, 0), 0);
    vec4 b = texelFetch(uData, ivec2(i, 1), 0);
    vec3 ab = b.xyz - a.xyz;
    float t = clamp(dot(d - a.xyz, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
    vec3 dv = d - a.xyz - ab * t;
    mount = max(mount, b.w * exp(-dot(dv, dv) / (a.w * a.w)));
  }
  float rid = sridged(d * 55.0 + 1.3, 7);
  float hills = sfbm(d * 24.0 + 9.0, 5) * 0.5 + 0.5;
  float hland = 0.015 + 0.05 * mc + mount * (0.28 + 0.72 * rid) * 0.9 + 0.06 * hills * hills + 0.05 * rid * smoothstep(0.4, 0.9, hills);
  float depth = 0.08 + 0.55 * smoothstep(0.0, 0.55, 1.0 - mc) + 0.12 * (sfbm(d * 12.0, 4) * 0.5 + 0.5);
  depth -= 0.1 * pow(1.0 - abs(sfbm(d * vec3(3.0, 5.0, 3.0) + 2.0, 4)), 8.0); // mid-ocean ridges
  float H = s * 0.25 + (land > 0.5 ? hland : -depth);

  // --- biomes (linear albedo) ---
  vec3 rain = vec3(0.03, 0.068, 0.024);
  vec3 temperate = vec3(0.06, 0.095, 0.04);
  vec3 borealC = vec3(0.036, 0.058, 0.032);
  vec3 savanna = vec3(0.15, 0.135, 0.065);
  vec3 steppe = vec3(0.2, 0.18, 0.11);
  vec3 sand = vec3(0.52, 0.39, 0.22);
  vec3 redsand = vec3(0.46, 0.25, 0.12);
  vec3 tundraC = vec3(0.15, 0.14, 0.115);
  vec3 rock = vec3(0.2, 0.18, 0.155);
  float wet = exp(-pow(latD / 11.0, 2.0)) * (1.0 - arid);
  float boreal = smoothstep(47.0, 55.0, alat) * (1.0 - smoothstep(63.0, 69.0, alat));
  float tundra = smoothstep(62.0, 70.0, alat);
  vec3 c = mix(temperate, rain, wet);
  c = mix(c, borealC, boreal);
  c = mix(c, tundraC, tundra);
  float sav = smoothstep(0.08, 0.45, arid) * (1.0 - tundra);
  c = mix(c, mix(savanna, steppe, smoothstep(30.0, 42.0, alat)), sav);
  float dune = smoothstep(0.45, 0.8, arid);
  vec3 dsand = mix(sand, redsand, smoothstep(0.2, 0.7, sfbm(d * 5.0 + 17.0, 3) + (lonD > 110.0 && latD < -10.0 ? 0.6 : 0.0)));
  dsand *= 0.8 + 0.35 * (sfbm(d * 60.0, 4) * 0.5 + 0.5);
  c = mix(c, dsand, dune);
  c *= 0.78 + 0.44 * (n2 * 0.5 + 0.5);
  // mountains: bare rock and snow above a latitude-dependent snowline
  c = mix(c, rock * (0.8 + 0.4 * rid), smoothstep(0.18, 0.45, mount * rid));
  float snowline = mix(0.62, 0.12, smoothstep(0.0, 65.0, alat));
  float snow = smoothstep(snowline, snowline + 0.08, hland + 0.05 * n2) ;
  // ice sheets
  float ice = 0.0;
  if (latD < -62.0) ice = 1.0;
  if (latD > 59.0 && lonD > -74.0 && lonD < -12.0) ice = smoothstep(0.35, 0.8, mc);
  vec3 iceC = vec3(0.78, 0.82, 0.88) * (0.92 + 0.08 * n2);
  c = mix(c, iceC, max(snow, ice));
  // ocean
  float shelf = smoothstep(0.35, 0.95, mc + 0.25 * coastBand + n1 * 0.1);
  vec3 ocean = mix(vec3(0.004, 0.011, 0.028), vec3(0.012, 0.05, 0.06), shelf);
  float seaIce = smoothstep(77.0, 82.0, latD + n2 * 6.0) + smoothstep(-68.0, -71.0, latD + n2 * 4.0);
  ocean = mix(ocean, vec3(0.7, 0.75, 0.8) * (0.85 + 0.15 * n2), clamp(seaIce, 0.0, 1.0));
  vec3 alb = land > 0.5 ? c : ocean;
  gl_FragColor = vec4(sqrt(clamp(alb, 0.0, 1.0)), clamp(0.5 + 0.5 * H, 0.0, 1.0));
}
`;

function loadMask() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = reject;
    img.src = LAND_MASK_PNG;
  });
}

// Start decoding immediately so the mask is ready long before anyone ascends.
export const maskPromise = loadMask();
let maskTex = null;
maskPromise.then((t) => { maskTex = t; }).catch(() => { maskTex = null; });
export function maskReady() { return !!maskTex; }

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function buildDataTexture() {
  const segs = [];
  for (const r of RANGES) {
    for (let i = 0; i < r.pts.length - 1; i++) segs.push([r.pts[i], r.pts[i + 1], r.w, r.h]);
  }
  const W = Math.max(segs.length, CITIES.length + 2, 8);
  const data = new Float32Array(W * 3 * 4);
  const v = new THREE.Vector3();
  segs.forEach(([a, b, w, h], i) => {
    bodyDir(a[0] * D2R, a[1] * D2R, v); data.set([v.x, v.y, v.z, w * D2R], i * 4);
    bodyDir(b[0] * D2R, b[1] * D2R, v); data.set([v.x, v.y, v.z, h], (W + i) * 4);
  });
  const cities = CITIES.slice();
  cities.forEach(([lat, lon, w], i) => {
    bodyDir(lat * D2R, lon * D2R, v); data.set([v.x, v.y, v.z, w], (2 * W + i) * 4);
  });
  const tex = new THREE.DataTexture(data, W, 3, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { tex, numSeg: segs.length, numCity: cities.length };
}

function cyclones() {
  const rnd = mulberry(1977);
  const out = [];
  const v = new THREE.Vector3();
  const add = (lat, lon, R, s) => { bodyDir(lat * D2R, lon * D2R, v).multiplyScalar(R); out.push(new THREE.Vector4(v.x, v.y, v.z, s)); };
  // mid-latitude lows (counter-clockwise in the north, clockwise in the south)
  for (let i = 0; i < 18; i++) {
    const south = i % 2 === 1;
    const lat = (38 + rnd() * 24) * (south ? -1 : 1);
    add(lat, rnd() * 360 - 180, 0.1 + rnd() * 0.12, (south ? -1 : 1) * (1.1 + rnd() * 1.2));
  }
  // tropical cyclones (tight, strong)
  add(16, -128, 0.055, 9.5);
  add(19, 134, 0.06, 10.5);
  add(-14, 64, 0.05, -9.0);
  add(24, 142, 0.05, 8.5);
  // subtropical highs (anticyclones spread cloud into rings)
  for (let i = 0; i < 6; i++) {
    const south = i % 2 === 1;
    add((24 + rnd() * 10) * (south ? -1 : 1), rnd() * 360 - 180, 0.2 + rnd() * 0.1, (south ? 1 : -1) * 1.2);
  }
  return out;
}

export class EarthBake {
  constructor(renderer, size, cloudSize) {
    this.renderer = renderer;
    const mk = (s) => {
      const rt = new THREE.WebGLCubeRenderTarget(s, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      rt.texture.colorSpace = THREE.NoColorSpace;
      return rt;
    };
    this.surfA = mk(size);
    this.surfB = mk(size);
    this.clouds = mk(cloudSize);
    this.data = buildDataTexture();
    const cyc = cyclones();
    while (cyc.length < 28) cyc.push(new THREE.Vector4(0, 1, 0, 0));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: BAKE_FRAG,
      uniforms: {
        uMask: { value: null },
        uData: { value: this.data.tex },
        uNumSeg: { value: this.data.numSeg },
        uNumCity: { value: this.data.numCity },
        uFace: { value: 0 },
        uOut: { value: 0 },
        uDeserts: { value: DESERTS.map((b) => new THREE.Vector4(b[0], b[1], b[2], b[3])) },
        uCyc: { value: cyc },
        uNumCyc: { value: 28 },
      },
      depthTest: false, depthWrite: false,
    });
    this.pass = new FullscreenPass(this.mat);
    this.jobs = [];
    for (const [out, rt] of [[0, this.surfA], [1, this.surfB], [2, this.clouds]]) for (let f = 0; f < 6; f++) this.jobs.push({ out, rt, f });
    this.done = false;
  }

  get ready() { return this.done; }

  /** Run up to `n` face renders (call once per frame while ascending). Returns true when finished. */
  step(n = 1) {
    if (this.done) return true;
    if (!maskTex) return false;
    this.mat.uniforms.uMask.value = maskTex;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    for (let i = 0; i < n && this.jobs.length; i++) {
      const j = this.jobs.shift();
      this.mat.uniforms.uOut.value = j.out;
      this.mat.uniforms.uFace.value = j.f;
      r.setRenderTarget(j.rt, j.f);
      r.render(this.pass.scene, this.pass.camera);
    }
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
    if (!this.jobs.length) {
      this.done = true;
      this.data.tex.dispose();
    }
    return this.done;
  }

  dispose() { this.surfA.dispose(); this.surfB.dispose(); this.clouds.dispose(); this.mat.dispose(); }
}
