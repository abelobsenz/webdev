import * as THREE from 'three';
import { patchedMaterial, applyPatch } from './materials.js';
import { mulberry32 } from './noise.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/uniforms.js';
import { getNatureTextures } from './natureTextures.js';
import { SPECIES, SP, buildSpeciesGeometry, buildFarGeometry } from './treeGeometry.js';
import { NATURE_U } from './natureGlsl.js';

// MERIDIAN's trees. Eleven species with detailed near geometry (textured bark, leaf-cluster
// cards, fronds) around the viewer and a parametric far LOD for everything else. The two
// LODs hand over with a complementary per-pixel dither so there is no visible pop; the far
// crowns also cast every tree's shadow (with a matching depth material).
//
// Tree records: { x, y, z, s (height m), sp (species index), rot, tint:[r,g,b], lean (rad) }

export { SPECIES, SP };

const LOD = { nearR: { value: 320 }, band: { value: 45 } };

const FLOWERS = [[0.78, 0.13, 0.05], [0.36, 0.26, 0.72], [0.88, 0.64, 0.08], [0.88, 0.40, 0.58], [0.92, 0.88, 0.74], [0.72, 0.10, 0.40]];
const FLOWER_EDGES = [0.2, 0.37, 0.54, 0.7, 0.85, 1.01];
export function flowerColor(k) { for (let i = 0; i < 6; i++) if (k < FLOWER_EDGES[i]) return FLOWERS[i]; return FLOWERS[5]; }
const hashXZ = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

const LOD_GLSL = /* glsl */ `
uniform float uNearR;
uniform float uBand;
float lodFade(vec3 ip) {
  // 1 = fully near representation, 0 = fully far
  return 1.0 - smoothstep(uNearR - uBand, uNearR, distance(ip, cameraPosition));
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const WIND_GLSL = /* glsl */ `
vec3 windOffset(vec3 ip, float sway, float scale) {
  float ph = dot(ip.xz, vec2(0.031, 0.023));
  vec2 wd = normalize(uWind + vec2(1e-4));
  float gust = 0.55 + 0.45 * sin(uTime * 0.37 - dot(ip.xz, wd) * 0.004);
  float bend = (sin(uTime * 1.05 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7) * 0.22) * gust;
  return vec3(wd.x, 0.0, wd.y) * bend * sway * sway * scale;
}
`;

// ---------------------------------------------------------------- near LOD --
function createNearMaterial(tex, { lod = true, key = 'treeNear' } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, envMapIntensity: 0.55, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true });
  applyPatch(mat, {
    key,
    uniforms: { uNearR: LOD.nearR, uBand: LOD.band, uLeafAlb: { value: tex.leafAlbedo }, uLeafNrm: { value: tex.leafNormal }, uBarkAlb: { value: tex.barkAlbedo }, uBarkNrm: { value: tex.barkNormal } },
    defines: lod ? { TREE_NEAR_LOD: 1 } : {},
    vertex: {
      pars: `attribute vec4 aTan; attribute vec4 aKind; attribute vec4 aBloom;
varying vec2 vUv2; varying vec4 vKind; varying vec3 vTanW; varying float vFade; varying vec3 vBloomC;
${LOD_GLSL}
${WIND_GLSL}`,
      transform: /* glsl */ `
vUv2 = uv; vKind = aKind; vBloomC = aBloom.rgb;
{
  #ifdef USE_INSTANCING
  vec3 ip = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  mat3 im = mat3(instanceMatrix);
  #else
  vec3 ip = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  mat3 im = mat3(1.0);
  #endif
  #ifdef TREE_NEAR_LOD
  vFade = lodFade(ip);
  if (vFade <= 0.0) transformed *= 0.0;
  #else
  vFade = 1.0;
  #endif
  // wind: whole-tree sway in world wind direction, plus leaf flutter
  vec3 wo = transpose(im) * windOffset(ip, aKind.z, 0.55);
  wo /= max(dot(im[0], im[0]), 1e-4);
  transformed += wo;
  if (aKind.x > 0.5) transformed += normal * sin(uTime * 5.0 + aTan.w * 40.0 + ip.x * 0.3) * 0.035 * aKind.z;
  vTanW = normalize(mat3(modelMatrix) * im * aTan.xyz);
}`,
    },
    fragment: {
      pars: `uniform highp sampler2DArray uLeafAlb; uniform highp sampler2DArray uLeafNrm; uniform highp sampler2DArray uBarkAlb; uniform highp sampler2DArray uBarkNrm;
varying vec2 vUv2; varying vec4 vKind; varying vec3 vTanW; varying float vFade; varying vec3 vBloomC;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`,
      color: /* glsl */ `
{
  if (vKind.x < 0.5) {
    vec4 ba = texture(uBarkAlb, vec3(vUv2, vKind.y));
    diffuseColor.rgb *= ba.rgb;
    diffuseColor.a = 1.0;
  } else {
    vec4 la = texture(uLeafAlb, vec3(vUv2, vKind.y));
    vec2 dx = dFdx(vUv2 * 512.0), dy = dFdy(vUv2 * 512.0);
    float lod = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-6));
    float a = la.a * (1.0 + max(lod, 0.0) * 0.28);
    vec3 lc = la.rgb;
    if (vKind.x > 2.5) lc = mix(lc, lc * vBloomC * 1.25, step(0.001, dot(vBloomC, vec3(1.0))));
    diffuseColor.rgb *= lc;
    diffuseColor.a = a;
  }
  if (ign(gl_FragCoord.xy) >= vFade) discard;
}`,
      surface: /* glsl */ `
roughnessFactor = vKind.x < 0.5 ? 0.92 : 0.7;
`,
      normal: /* glsl */ `
{
  vec3 Nw;
  if (vKind.x < 0.5) {
    vec4 nb = texture(uBarkNrm, vec3(vUv2, vKind.y));
    vec3 nm = nb.xyz * 2.0 - 1.0;
    vec3 N0 = normalize(vWNrm);
    vec3 T = normalize(vTanW - N0 * dot(vTanW, N0) + vec3(1e-5));
    vec3 Bt = cross(N0, T);
    Nw = normalize(Bt * nm.x + T * nm.y + N0 * max(nm.z, 0.2));
  } else {
    vec3 nm = texture(uLeafNrm, vec3(vUv2, vKind.y)).xyz * 2.0 - 1.0;
    vec3 fn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
    if (dot(fn, cameraPosition - vWPos) < 0.0) fn = -fn;
    vec3 T = normalize(vTanW - fn * dot(vTanW, fn) + vec3(1e-5));
    vec3 Bt = cross(fn, T);
    vec3 leafN = normalize(T * nm.x + Bt * nm.y + fn * nm.z);
    Nw = normalize(mix(normalize(vWNrm), leafN, 0.38));
  }
  normal = normalize((viewMatrix * vec4(Nw, 0.0)).xyz);
}`,
      lights: /* glsl */ `
{
  float ao = vKind.w;
  if (vKind.x < 0.5) {
    float cav = texture(uBarkNrm, vec3(vUv2, vKind.y)).a;
    ao *= 0.55 + 0.45 * cav;
  }
  reflectedLight.indirectDiffuse *= ao;
  reflectedLight.indirectSpecular *= ao;
  reflectedLight.directDiffuse *= mix(1.0, ao, 0.35);
  if (vKind.x > 0.5) {
    // sunlight through the leaves
    vec3 V = normalize(cameraPosition - vWPos);
    float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
    float wrap = max(0.0, -dot(normalize(vWNrm), uSunDir));
    vec3 trans = diffuseColor.rgb * vec3(0.85, 1.0, 0.5) * uSunColor * uSunIlluminance * (back * 0.4 + wrap * 0.1) * smoothstep(0.35, 0.95, ao);
    // grazing cards against a bright sky: bound the Fresnel sheen so thin leaves never wash out to white
    reflectedLight.indirectSpecular *= 0.5;
    reflectedLight.directSpecular *= 0.7;
    reflectedLight.directDiffuse += trans * cloudShadowAt(vWPos);
  }
}`,
    },
  });
  return mat;
}

// ----------------------------------------------------------------- far LOD --
const FAR_SHAPE = /* glsl */ `
attribute float aPart;
attribute vec4 aShape;
attribute vec4 aBloom;
varying float vPart; varying vec3 vCrownN; varying float vCrownY; varying vec3 vBloomF; varying float vSeed;
${NOISE_GLSL}
void farShape(inout vec3 p, inout vec3 n, vec3 ip) {
  float seed = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
  vSeed = seed;
  float cb = aShape.x, ch = aShape.y, cw = aShape.z;
  int prof = int(aShape.w + 0.5);
  vPart = aPart;
  vBloomF = aBloom.rgb * aBloom.a;
  if (aPart < 0.5) {
    bool star = prof >= 4;
    float tr = star ? 0.011 : (prof == 3 ? 0.03 : 0.024);
    float top = star ? cb : cb + ch * 0.5;   // ends at the crown centre: never pokes out below an umbrella crown
    float y = mix(-0.14, top, p.y);
    vec2 r = p.xz * tr * (1.0 - 0.35 * p.y) * (prof == 3 ? 1.6 : 1.0);
    float bend = star ? 0.09 * p.y * p.y * (0.5 + seed) : 0.0;
    p = vec3(r.x + bend, y, r.y);
    vCrownY = -1.0;
  } else if (aPart < 1.5) {
    vec3 d = normalize(p);
    float lump = 1.0 + 0.34 * (vnoise3(d * 2.1 + seed * 17.0) - 0.5) + 0.14 * (vnoise3(d * 4.7 + seed * 9.0) - 0.5);
    vec3 R = vec3(cw * 0.5, ch * 0.5, cw * 0.5);
    vec3 dd = d;
    if (prof == 1) { if (dd.y < 0.0) dd.y *= 0.4; R.y *= 1.0; }
    if (prof == 2) {
      float k = clamp(0.5 - 0.5 * dd.y, 0.0, 1.0);
      float tier = 0.82 + 0.18 * abs(sin(dd.y * 18.0 + seed * 6.0));
      dd.xz *= (0.06 + k * 1.1) * tier;
    }
    if (prof == 3) { dd.xz *= 0.55 + 0.45 * (0.5 + 0.5 * dd.y); lump += 0.12 * (vnoise3(d * 9.0 + seed) - 0.5); }
    p = vec3(0.0, cb + ch * 0.5, 0.0) + dd * R * lump;
    n = normalize(d / max(R, vec3(1e-3)));
    vCrownN = n;
    vCrownY = d.y;
  } else {
    float len = cw * 0.5 * (0.85 + 0.3 * seed);
    p = vec3(0.09 * (0.5 + seed), cb, 0.0) + p * vec3(len, len * (prof == 5 ? 0.8 : 1.0), len);
    n = normalize(vec3(p.x - 0.1, 1.5, p.z));
    vCrownN = n;
    vCrownY = 0.5;
  }
}
`;

function createFarMaterial(lod = true) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.85, metalness: 0, envMapIntensity: 0.5 });
  applyPatch(mat, {
    key: lod ? 'treeFar' : 'treeFarLocal',
    uniforms: { uNearR: LOD.nearR, uBand: LOD.band, uBloom: NATURE_U.uBloom },
    defines: lod ? { TREE_FAR_LOD: 1 } : {},
    vertex: {
      pars: `${FAR_SHAPE}\n${LOD_GLSL}\n${WIND_GLSL}\nvarying float vFade;`,
      preNormal: /* glsl */ `
{
  #ifdef USE_INSTANCING
  vec3 ipn = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  #else
  vec3 ipn = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  vec3 pp = position;
  farShape(pp, objectNormal, ipn);
}`,
      transform: /* glsl */ `
{
  #ifdef USE_INSTANCING
  vec3 ip = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  mat3 im = mat3(instanceMatrix);
  #else
  vec3 ip = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  mat3 im = mat3(1.0);
  #endif
  vec3 nn = objectNormal;
  farShape(transformed, nn, ip);
  #ifdef TREE_FAR_LOD
  vFade = 1.0 - lodFade(ip);
  if (vFade <= 0.0) transformed *= 0.0;
  #else
  vFade = 1.0;
  #endif
  float sw = clamp(transformed.y, 0.0, 1.0);
  vec3 wo = transpose(im) * windOffset(ip, sw, 0.5);
  transformed += wo / max(dot(im[0], im[0]), 1e-4);
}`,
    },
    fragment: {
      pars: 'uniform float uBloom; varying float vPart; varying vec3 vCrownN; varying float vCrownY; varying vec3 vBloomF; varying float vSeed; varying float vFade; float ignF(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); } float tAOf;',
      color: /* glsl */ `
{
  if (ignF(gl_FragCoord.xy) < 1.0 - vFade) discard;
  if (vPart < 0.5) {
    diffuseColor.rgb = vec3(0.16, 0.13, 0.10) * (0.8 + 0.4 * vnoise(vWPos.xz * 3.0 + vWPos.y));
    tAOf = 0.7;
  } else {
    float n = vnoise(vWPos.xz * 0.8 + vWPos.y * 0.9) * 0.6 + vnoise(vWPos.xz * 2.7 - vWPos.y * 2.1) * 0.4;
    diffuseColor.rgb *= 0.72 + 0.56 * n;
    float top = smoothstep(-0.1, 0.8, vCrownY);
    float bl = dot(vBloomF, vec3(1.0)) > 0.001 ? smoothstep(0.35, 0.7, n + top * 0.4) * uBloom : 0.0;
    diffuseColor.rgb = mix(diffuseColor.rgb, vBloomF * 0.85, bl);
    tAOf = mix(0.45, 1.0, smoothstep(-0.9, 0.7, vCrownY)) * (0.75 + 0.25 * n);
  }
}`,
      normal: /* glsl */ `
if (vPart > 0.5) {
  vec3 g = vnoised(vWPos.xz * 0.9 + vWPos.y * 0.7).xyz;
  vec3 wn = normalize(vWNrm + vec3(g.y, 0.0, g.z) * 0.45);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
      lights: /* glsl */ `
{
  reflectedLight.indirectDiffuse *= tAOf;
  reflectedLight.directDiffuse *= mix(1.0, tAOf, 0.4);
  if (vPart > 0.5) {
    vec3 V = normalize(cameraPosition - vWPos);
    float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);
    reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * uSunIlluminance * back * 0.3 * cloudShadowAt(vWPos);
  }
}`,
    },
  });
  return mat;
}

/** Depth material for the far crowns so every tree casts a crown-shaped shadow. */
function createFarDepthMaterial() {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: U.uTime, uWind: U.uWind });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; uniform vec2 uWind;\n${FAR_SHAPE}\n${WIND_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
  vec3 ip = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  #else
  vec3 ip = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  vec3 nn = vec3(0.0, 1.0, 0.0);
  farShape(transformed, nn, ip);
  if (aPart > 1.5) transformed *= 0.0;
}`);
  };
  mat.customProgramCacheKey = () => 'treeFarDepth';
  return mat;
}

/** A light far crown (80-face sphere, 5-sided trunk) sharing the blob's shape attributes. */
function farLoBlob(blob) {
  const parts = [[new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0), 0], [new THREE.IcosahedronGeometry(1, 1), 1]];
  const pos = [], nrm = [], part = [];
  for (const [g0, k] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) part.push(k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.boundingSphere = blob.boundingSphere;
  return g;
}

// -------------------------------------------------------------- tree field --
export class TreeField {
  constructor(scene, settings) {
    this.scene = scene;
    this.settings = settings;
    this.tex = getNatureTextures();
    const rnd = mulberry32(77);
    this.species = buildSpeciesGeometry(rnd);
    this.farGeo = buildFarGeometry();
    this.farLo = farLoBlob(this.farGeo.blob);
    this.loChunks = [];
    this.nearMat = createNearMaterial(this.tex, { lod: true, key: 'treeNear' });
    this.farMat = createFarMaterial(true);
    this.localFarMat = createFarMaterial(false);
    this.farDepthMat = createFarDepthMaterial();
    this.chunks = [];
    this.locals = [];
    this.near = null;
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  /** Instance matrix for a tree record (yaw, a slight lean, uniform scale to its height). */
  _matrix(t, out) {
    const H = this.species[t.sp].H;
    const lean = t.lean || 0;
    this._e.set(Math.cos(t.rot * 1.7) * lean, t.rot, Math.sin(t.rot * 1.7) * lean, 'YXZ');
    this._q.setFromEuler(this._e);
    const k = t.s / H;
    return out.compose(this._v.set(t.x, t.y, t.z), this._q, this._s.set(k, k, k));
  }

  _bloom(t) {
    if (!SPECIES[t.sp].bloom) return [0, 0, 0, 0];
    const c = flowerColor(t.bloom ?? hashXZ(t.x, t.z));
    return [c[0], c[1], c[2], 1];
  }

  _buildNear(trees) {
    const N = trees.length;
    const mats = new Float32Array(N * 16), cols = new Float32Array(N * 3), blooms = new Float32Array(N * 4), pos = new Float32Array(N * 3), sp = new Uint8Array(N), keep = new Uint8Array(N);
    const grid = new Map();
    const CELL = 150;
    trees.forEach((t, i) => {
      this._matrix(t, this._m4).toArray(mats, i * 16);
      cols.set(t.tint, i * 3);
      blooms.set(this._bloom(t), i * 4);
      pos.set([t.x, t.y, t.z], i * 3);
      sp[i] = t.sp;
      keep[i] = t.keep ? 1 : 0;       // a designed tree (a planter's): never thinned by the quality setting
      const k = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    const caps = SPECIES.map(() => 0);
    for (const t of trees) caps[t.sp]++;
    const meshes = this.species.map((s, i) => {
      const cap = Math.max(16, Math.min(caps[i], 16000));   // (the near radius reaches 900-1400 m on the top presets)
      const g = s.geo.clone();
      const bl = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      bl.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aBloom', bl);
      const m = new THREE.InstancedMesh(g, this.nearMat, cap);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      m.layers.set(1);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.userData.cap = cap;
      this.scene.add(m);
      return m;
    });
    this.near = { mats, cols, blooms, pos, sp, keep, grid, CELL, meshes, last: new THREE.Vector3(1e9, 0, 0), lastR: 0 };
  }

  _updateNear(camera) {
    const n = this.near;
    if (!n) return;
    const cp = camera.position;
    const R = LOD.nearR.value;
    if (n.last.distanceTo(cp) < 18 && n.lastR === R) return;
    n.last.copy(cp); n.lastR = R;
    const counts = SPECIES.map(() => 0);
    const RR = R + 30;
    const c0x = Math.floor((cp.x - RR) / n.CELL), c1x = Math.floor((cp.x + RR) / n.CELL);
    const c0z = Math.floor((cp.z - RR) / n.CELL), c1z = Math.floor((cp.z + RR) / n.CELL);
    const thin = this.settings.trees;
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const list = n.grid.get(`${cx},${cz}`);
      if (!list) continue;
      for (const i of list) {
        const dx = n.pos[i * 3] - cp.x, dy = n.pos[i * 3 + 1] - cp.y, dz = n.pos[i * 3 + 2] - cp.z;
        if (dx * dx + dy * dy + dz * dz > RR * RR) continue;
        if (thin < 1 && !n.keep[i] && ((i * 2654435761) % 1000) / 1000 > thin) continue;
        const s = n.sp[i];
        const m = n.meshes[s];
        if (counts[s] >= m.userData.cap) continue;
        const c = counts[s]++;
        m.instanceMatrix.array.set(n.mats.subarray(i * 16, i * 16 + 16), c * 16);
        m.instanceColor.array.set(n.cols.subarray(i * 3, i * 3 + 3), c * 3);
        m.geometry.attributes.aBloom.array.set(n.blooms.subarray(i * 4, i * 4 + 4), c * 4);
      }
    }
    n.meshes.forEach((m, s) => {
      const c = counts[s];
      m.count = c;
      m.visible = c > 0;
      for (const [attr, size] of [[m.instanceMatrix, 16], [m.instanceColor, 3], [m.geometry.attributes.aBloom, 4]]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, Math.max(1, c) * size);
        attr.needsUpdate = true;
      }
    });
  }

  _farMesh(list, farType, material, layer, base = this.farGeo[farType]) {
    const g = new THREE.BufferGeometry();
    for (const k of Object.keys(base.attributes)) g.setAttribute(k, base.attributes[k]);
    g.boundingSphere = base.boundingSphere;
    const shape = new Float32Array(list.length * 4), bloom = new Float32Array(list.length * 4);
    const mesh = new THREE.InstancedMesh(g, material, list.length);
    const c = new THREE.Color();
    let cx = 0, cz = 0;
    list.forEach((t, i) => {
      const S = SPECIES[t.sp];
      shape.set(S.shape, i * 4);
      bloom.set(this._bloom(t), i * 4);
      // far instances are scaled to the full tree height (unit geometry)
      const lean = t.lean || 0;
      this._e.set(Math.cos(t.rot * 1.7) * lean, t.rot, Math.sin(t.rot * 1.7) * lean, 'YXZ');
      this._q.setFromEuler(this._e);
      this._m4.compose(this._v.set(t.x, t.y, t.z), this._q, this._s.set(t.s, t.s, t.s));
      mesh.setMatrixAt(i, this._m4);
      c.setRGB(S.farColor[0] * t.tint[0], S.farColor[1] * t.tint[1], S.farColor[2] * t.tint[2]);
      mesh.setColorAt(i, c);
      cx += t.x; cz += t.z;
    });
    g.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
    g.setAttribute('aBloom', new THREE.InstancedBufferAttribute(bloom, 4));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    // crowns extend beyond the instance origins
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 40;
    mesh.customDepthMaterial = this.farDepthMat;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.set(layer);
    mesh.userData.fullCount = list.length;
    mesh.userData.center = new THREE.Vector2(cx / list.length, cz / list.length);
    return mesh;
  }

  /** trees: tree records, built into spatial chunks for culling. */
  build(trees, { chunk = 1800, layer = 1 } = {}) {
    this._buildNear(trees);
    const buckets = new Map();
    for (const t of trees) {
      const ft = SPECIES[t.sp].far;
      const key = `${Math.floor(t.x / chunk)},${Math.floor(t.z / chunk)},${ft}${t.far ? ',far' : t.keep ? ',keep' : ''}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }
    const rnd = mulberry32(5);
    for (const [key, list] of buckets) {
      const ft = key.split(',')[2];
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      const mesh = this._farMesh(list, ft, this.farMat, layer);
      this.scene.add(mesh);
      if (key.endsWith(',keep')) { this.kept = this.kept || []; this.kept.push(mesh); continue; }   // designed: never thinned
      this.chunks.push(mesh);
      if (key.endsWith(',far')) {
        // the far islands' woods: seen from 15-40 km, so a long reach, and a light
        // (80-face) crown beyond a few km where each tree is a handful of pixels
        mesh.userData.reach = 46000;
        if (ft === 'blob') {
          const lo = this._farMesh(list, ft, this.farMat, layer, this.farLo);
          lo.userData.center = mesh.userData.center;
          lo.visible = false;
          this.scene.add(lo);
          this.loChunks.push(lo);
          mesh.userData.lo = lo;
        }
      }
    }
    this.count = trees.length;
    this.applyQuality(this.settings);
  }

  /** Trees attached to a moving parent (floating islands). Near/far chosen per group by distance. */
  buildLocal(trees, parent) {
    if (!trees.length) return null;
    const bySp = SPECIES.map(() => []);
    for (const t of trees) bySp[t.sp].push(t);
    const nearMeshes = [];
    bySp.forEach((list, sp) => {
      if (!list.length) return;
      const g = this.species[sp].geo.clone();
      const bl = new Float32Array(list.length * 4);
      const mesh = new THREE.InstancedMesh(g, this.nearMat, list.length);
      mesh.layers.set(1);
      list.forEach((t, i) => {
        mesh.setMatrixAt(i, this._matrix(t, this._m4));
        mesh.setColorAt(i, new THREE.Color(t.tint[0], t.tint[1], t.tint[2]));
        bl.set(this._bloom(t), i * 4);
      });
      g.setAttribute('aBloom', new THREE.InstancedBufferAttribute(bl, 4));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      parent.add(mesh);
      nearMeshes.push(mesh);
    });
    const farMeshes = [];
    for (const ft of ['blob', 'star']) {
      const list = trees.filter((t) => SPECIES[t.sp].far === ft);
      if (!list.length) continue;
      const m = this._farMesh(list, ft, this.localFarMat, 0);
      m.frustumCulled = false;
      parent.add(m);
      farMeshes.push(m);
    }
    const group = { parent, nearMeshes, farMeshes, near: null };
    this.locals.push(group);
    return group;
  }

  applyQuality(s) {
    this.settings = s;
    LOD.nearR.value = s.treeNear ?? 320;
    for (const m of [...this.chunks, ...this.loChunks]) m.count = Math.max(1, Math.floor(m.userData.fullCount * s.trees));
    const a2c = (s.msaa || 0) > 0;
    for (const m of [this.nearMat]) {
      if (m.alphaToCoverage !== a2c) { m.alphaToCoverage = a2c; m.needsUpdate = true; }
    }
    if (this.near) this.near.last.set(1e9, 0, 0);
  }

  update(dt, t, camera) {
    if (!camera) return;
    this._updateNear(camera);
    const cp = camera.position;
    const maxD = 6500 + cp.y * 1.2;
    for (const m of this.chunks) {
      const d = Math.hypot(m.userData.center.x - cp.x, m.userData.center.y - cp.z);
      const reach = m.userData.reach;
      if (!reach) { m.visible = d < maxD; continue; }
      const lo = m.userData.lo, inReach = d < reach + cp.y * 2;
      const detailed = !lo || d < 4200;
      m.visible = inReach && detailed;
      if (lo) lo.visible = inReach && !detailed;
    }
    // local groups: detailed trees only when close
    const R = LOD.nearR.value;
    for (const g of this.locals) {
      g.parent.getWorldPosition(this._v);
      const d = this._v.distanceTo(cp);
      const near = d < R + 220;
      if (near !== g.near) {
        g.near = near;
        for (const m of g.nearMeshes) m.visible = near;
        for (const m of g.farMeshes) m.material = near ? this.farMat : this.localFarMat;
      }
    }
  }
}
