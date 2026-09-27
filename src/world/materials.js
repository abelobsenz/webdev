import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { AERIAL_GLSL } from '../shaders/atmosphere.glsl.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { CLOUD_SHADOW_LOOKUP } from '../shaders/clouds.glsl.js';

/**
 * Creates a MeshStandardMaterial (PBR, shadows, IBL) extended with hooks:
 *  vertex.pars / vertex.transform (edit `transformed`, `objectNormal`) / vertex.main (after world pos)
 *  fragment.pars / color (edit diffuseColor) / surface (roughnessFactor, metalnessFactor)
 *  normal (edit view-space `normal`) / emissive (edit totalEmissiveRadiance) / lights (after lighting)
 * Every patched material gets aerial perspective + shared uniforms.
 * Available varyings: vWPos (world position), vWNrm (world normal), vObjPos (object position).
 */
export function patchedMaterial(params = {}, hooks = {}) {
  const { physical = false, ...matParams } = params;
  const mat = physical ? new THREE.MeshPhysicalMaterial(matParams) : new THREE.MeshStandardMaterial(matParams);
  applyPatch(mat, hooks);
  return mat;
}

let _uid = 0;
export function applyPatch(mat, hooks = {}) {
  const key = hooks.key || `patch${_uid++}`;
  const v = hooks.vertex || {};
  const f = hooks.fragment || {};
  mat.userData.hooks = hooks;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, hooks.uniforms || {});
    if (hooks.defines) Object.assign(shader.defines || (shader.defines = {}), hooks.defines);
    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec3 vObjPos;
uniform float uTime;
uniform vec2 uWind;
${NOISE_GLSL}
${v.pars || ''}`);
    vs = vs.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
${v.preNormal || ''}`);
    vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
vObjPos = transformed;
${v.transform || ''}`);
    vs = vs.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
{
  vec4 wp = vec4(transformed, 1.0);
  vec3 wn = objectNormal;
  #ifdef USE_BATCHING
    wp = batchingMatrix * wp; wn = mat3(batchingMatrix) * wn;
  #endif
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp; wn = mat3(instanceMatrix) * wn;
  #endif
  wp = modelMatrix * wp;
  vWPos = wp.xyz;
  vWNrm = normalize(mat3(modelMatrix) * wn);
}
${v.main || ''}`);
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec3 vObjPos;
uniform float uTime;
uniform float uCityLights;
uniform vec3 uSunColor;
uniform vec2 uCloudOffset;
uniform float uCloudCoverage;
uniform float uCloudShadow;
${NOISE_GLSL}
${AERIAL_GLSL}
${CLOUD_SHADOW_LOOKUP}
float cloudShadowAt(vec3 wp) {
  // rendering agent: sample the volumetric clouds' top-down optical-depth map
  // (same density field as the visible clouds, see src/life/clouds.js)
  float T = exp(-cloudShadowOD(wp));
  return mix(1.0, mix(0.08, 1.0, T), uCloudShadow);
}
${f.pars || ''}`);
    fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
${f.color || ''}`);
    fs = fs.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
${f.surface || ''}`);
    fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
${f.normal || ''}`);
    fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${f.emissive || ''}`);
    fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  float cs = cloudShadowAt(vWPos);
  reflectedLight.directDiffuse *= cs;
  reflectedLight.directSpecular *= cs;
}
${f.lights || ''}`);
    fs = fs.replace('#include <fog_fragment>', `${f.preAerial || ''}
gl_FragColor.rgb = applyAerial(gl_FragColor.rgb, vWPos);
${f.end || ''}`);
    shader.fragmentShader = fs;
    if (hooks.onShader) hooks.onShader(shader);
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/**
 * ShaderMaterial helper that includes aerial perspective and the shared uniforms.
 * The fragment shader should call `applyAerial(color, worldPos)`.
 */
export function aerialShaderMaterial({ vertexShader, fragmentShader, uniforms = {}, ...rest }) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: `${NOISE_GLSL}\n${AERIAL_GLSL}\nuniform float uTime;\nuniform float uCityLights;\nuniform vec3 uSunColor;\n${fragmentShader}`,
    uniforms: Object.assign({}, U, uniforms),
    ...rest,
  });
}

// Shared facade glass / structural helpers used by towers & low-rise buildings.
export const FACADE_GLSL = /* glsl */ `
// Anti-aliased rectangular pulse: 1 inside [0, w) of each period (filtered by footprint)
float filteredPulse(float x, float period, float w, float fw) {
  float p = x / period;
  float dw = max(fw / period, 1e-4);
  // integral of pulse train (box-filtered)
  float a = floor(p + dw * 0.5) * w / period + max(fract(p + dw * 0.5) - (1.0 - w / period), 0.0);
  float b = floor(p - dw * 0.5) * w / period + max(fract(p - dw * 0.5) - (1.0 - w / period), 0.0);
  return (a - b) / dw;
}
`;
