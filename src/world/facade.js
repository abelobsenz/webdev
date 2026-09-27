import * as THREE from 'three';
import { patchedMaterial, FACADE_GLSL } from './materials.js';

/**
 * Facade material for megastructures. Geometry must carry
 * aFacade = (u metres along the surface, v metres up, kind) where kind:
 * 0 = curtain-wall glass, 1 = solid structure (bone-white composite),
 * 2 = lantern / crown (glows), 3 = garden deck (planted), 4 = energy conduit.
 */
// glass colours double as the specular (F0) tint of the coated curtain wall
export const PALETTES = {
  pearl: { glass: [0.52, 0.60, 0.66], rib: [0.93, 0.92, 0.89], light: [1.0, 0.78, 0.52], vein: [0.55, 0.85, 1.0] },
  bronze: { glass: [0.62, 0.50, 0.38], rib: [0.90, 0.85, 0.76], light: [1.0, 0.72, 0.45], vein: [1.0, 0.72, 0.4] },
  jade: { glass: [0.38, 0.58, 0.56], rib: [0.90, 0.94, 0.91], light: [0.95, 0.86, 0.66], vein: [0.45, 1.0, 0.8] },
  silver: { glass: [0.62, 0.66, 0.72], rib: [0.96, 0.96, 0.97], light: [0.92, 0.9, 1.0], vein: [0.7, 0.75, 1.0] },
  rose: { glass: [0.66, 0.52, 0.52], rib: [0.95, 0.91, 0.88], light: [1.0, 0.76, 0.62], vein: [1.0, 0.6, 0.75] },
};

const FACADE_HOOKS = {
  key: 'facade',
  vertex: {
    pars: 'attribute vec3 aFacade; varying vec3 vFacade;',
    transform: 'vFacade = aFacade;',
  },
  fragment: {
    pars: /* glsl */ `
#ifndef FSEED
#define FSEED uSeed
#endif
varying vec3 vFacade;
uniform float uSeed;
uniform vec3 uGlass;
uniform vec3 uRib;
uniform vec3 uLightCol;
uniform vec3 uVein;
uniform float uLitFrac;
uniform float uColW;
uniform float uFloorH;
uniform float uBandPeriod;
${FACADE_GLSL}
float fGlass; float fRib; float fBand; float fKind; float fVein; vec2 fCell; float fPx;
`,
    color: /* glsl */ `
{
  fKind = floor(vFacade.z + 0.5);
  vec2 f = vFacade.xy;
  vec2 fw = max(fwidth(f), vec2(1e-4));
  float colW = uColW, floorH = uFloorH;
  fCell = floor(vec2(f.x / colW, f.y / floorH));
  fPx = max(fw.x / colW, fw.y / floorH);
  float mx = filteredPulse(f.x, colW, colW * 0.8, fw.x);
  float my = filteredPulse(f.y + floorH * 0.12, floorH, floorH * 0.7, fw.y);
  float ribP = colW * 5.0;
  fRib = 1.0 - filteredPulse(f.x + colW * 0.5, ribP, ribP - 2.4, fw.x);
  fVein = 1.0 - filteredPulse(f.x + colW * 0.5 - 1.0, ribP, ribP - 0.4, fw.x);
  fBand = 1.0 - filteredPulse(f.y, uBandPeriod, uBandPeriod - 9.0, fw.y);
  vec3 c;
  if (fKind < 0.5) {
    fGlass = mx * my * (1.0 - fRib) * (1.0 - fBand);
    vec3 frame = uRib * 0.9;
    c = mix(frame, uGlass, fGlass);
    // planted sky-garden bands
    float leaf = vnoise(f * vec2(0.35, 0.8)) * 0.5 + 0.5;
    c = mix(c, mix(vec3(0.07, 0.17, 0.05), vec3(0.2, 0.3, 0.1), leaf), fBand * 0.85);
    c = mix(c, uRib, fRib);
  } else if (fKind < 1.5) {
    fGlass = 0.0; fRib = 1.0; fBand = 0.0;
    float panel = filteredPulse(f.y, 6.0, 5.6, fw.y) * filteredPulse(f.x, 8.0, 7.6, fw.x);
    c = uRib * (0.86 + 0.14 * panel);
  } else if (fKind < 2.5) {
    fGlass = 0.7; fRib = 0.0; fBand = 0.0;
    c = mix(uGlass * 1.4, uRib, 0.25);
  } else if (fKind < 3.5) {
    fGlass = 0.0; fRib = 0.0; fBand = 1.0;
    float leaf = fbm2_3(vWPos.xz * 0.12);
    c = mix(vec3(0.06, 0.16, 0.04), vec3(0.22, 0.32, 0.1), leaf);
  } else {
    fGlass = 0.4; fRib = 0.0; fBand = 0.0;
    c = uGlass * 0.6;
  }
  diffuseColor.rgb = c;
}
`,
    surface: /* glsl */ `
roughnessFactor = mix(0.45, 0.06 + 0.05 * hash13(vec3(fCell * 0.25, 1.0)), fGlass);
roughnessFactor = mix(roughnessFactor, 0.85, fBand);
metalnessFactor = mix(0.0, 0.78, fGlass);
`,
    emissive: /* glsl */ `
{
  float lights = uCityLights;
  if (fKind < 0.5) {
    float h = hash13(vec3(fCell, FSEED));
    float frac = uLitFrac * (0.35 + 0.65 * lights) * 0.7;
    float lit = step(1.0 - frac, h);
    float avgLit = frac * 0.55;
    float L = mix(lit, avgLit, smoothstep(0.25, 0.9, fPx));
    float tone = hash13(vec3(fCell.yx, FSEED + 7.0));
    vec3 wc = mix(uLightCol, vec3(0.72, 0.84, 1.0), step(0.82, tone)) * (0.55 + 0.9 * hash13(vec3(fCell, FSEED + 3.0)));
    totalEmissiveRadiance += wc * L * fGlass * 0.07 * lights;
    totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * fBand * 0.03 * lights;
  }
  // energy veins climbing the ribs
  float column = floor((vFacade.x + uColW * 0.5) / (uColW * 5.0));
  float ph = hash11(column + FSEED * 13.0);
  float pulse = pow(fract(vFacade.y / 340.0 - uTime * (0.05 + 0.04 * ph) + ph), 22.0);
  float veinOn = step(0.45, ph);
  totalEmissiveRadiance += uVein * fVein * veinOn * (0.02 + 0.6 * pulse) * (0.15 + 0.85 * lights);
  if (fKind > 1.5 && fKind < 2.5) {
    float breathe = 0.8 + 0.2 * sin(uTime * 0.6 + FSEED);
    totalEmissiveRadiance += uLightCol * (0.03 + 0.22 * lights) * breathe;
  }
  if (fKind > 3.5) {
    float flow = pow(fract(vFacade.y / 180.0 - uTime * 0.12), 10.0);
    totalEmissiveRadiance += uVein * (0.04 + 0.6 * flow) * (0.25 + 0.75 * lights);
  }
}
`,
  },
};

/**
 * Variant for instanced low-rise buildings: facade coordinates are derived
 * from world position/normal, and each instance carries its own seed + roof kind.
 */
export function createLowriseMaterial(palette = 'pearl', { litFrac = 0.5 } = {}) {
  const p = PALETTES[palette] || PALETTES.pearl;
  const uniforms = {
    uSeed: { value: 0 },
    uGlass: { value: new THREE.Color(...p.glass) },
    uRib: { value: new THREE.Color(...p.rib) },
    uLightCol: { value: new THREE.Color(...p.light) },
    uVein: { value: new THREE.Color(...p.vein) },
    uLitFrac: { value: litFrac },
    uColW: { value: 3.0 },
    uFloorH: { value: 3.8 },
    uBandPeriod: { value: 1e5 },
  };
  const hooks = {
    key: 'lowrise',
    uniforms,
    defines: { FSEED: '(uSeed + vSeed)' },
    vertex: {
      pars: 'attribute vec2 aInst; varying vec3 vFacade; varying float vSeed;',
      transform: '',
      main: /* glsl */ `
{
  vSeed = aInst.x;
  vec2 t = normalize(vec2(-vWNrm.z, vWNrm.x) + vec2(1e-5));
  float roof = step(0.6, abs(vWNrm.y));
  float kind = mix(aInst.y > 0.5 ? 0.0 : 1.0, aInst.y > 0.25 ? 3.0 : 1.0, roof);
  vFacade = vec3(dot(vWPos.xz, t), vWPos.y, kind);
}`,
    },
    fragment: {
      ...FACADE_HOOKS.fragment,
      pars: 'varying float vSeed;\n' + FACADE_HOOKS.fragment.pars,
      color: FACADE_HOOKS.fragment.color + `
{
  // each building gets its own stone: chalk, sandstone, cool limestone, terracotta, sage
  vec3 tints[5] = vec3[5](vec3(1.0), vec3(1.0, 0.93, 0.8), vec3(0.88, 0.92, 0.96), vec3(1.0, 0.84, 0.74), vec3(0.84, 0.9, 0.84));
  vec3 tint = tints[int(fract(vSeed * 0.137) * 4.99)];
  diffuseColor.rgb *= mix(vec3(1.0), tint, 1.0 - fGlass);
}`,
    },
  };
  const m = patchedMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.9 }, hooks);
  m.userData.facadeUniforms = uniforms;
  return m;
}

export function createFacadeMaterial(palette = 'pearl', seed = 1, { litFrac = 0.55, colW = 3.2, floorH = 4.2, band = 112, side = THREE.FrontSide } = {}) {
  const p = PALETTES[palette] || PALETTES.pearl;
  const uniforms = {
    uSeed: { value: seed },
    uGlass: { value: new THREE.Color(...p.glass) },
    uRib: { value: new THREE.Color(...p.rib) },
    uLightCol: { value: new THREE.Color(...p.light) },
    uVein: { value: new THREE.Color(...p.vein) },
    uLitFrac: { value: litFrac },
    uColW: { value: colW },
    uFloorH: { value: floorH },
    uBandPeriod: { value: band },
  };
  const m = patchedMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.0, envMapIntensity: 1.0, side }, { ...FACADE_HOOKS, uniforms });
  m.userData.facadeUniforms = uniforms;
  return m;
}
