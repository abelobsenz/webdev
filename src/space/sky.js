import * as THREE from 'three';
import { SPACE_SKY_GLSL } from './glsl.js';
import { U } from '../core/uniforms.js';

// Full-screen deep-space backdrop (drawn first, no depth).
const VERT = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
varying vec3 vRay;
void main() {
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  vRay = (uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform float uSunE;
uniform float uShowSun;
uniform float uSwarmFar;
varying vec3 vRay;
${SPACE_SKY_GLSL}
void main() {
  vec3 d = normalize(vRay);
  float px = max(length(fwidth(d)), 1e-5);
  vec3 col = sk_background(d, px);
  col += sk_swarm(cameraPosition, d, px) * uSunE * 0.06 * uSwarmFar;
  col += sk_sun(cameraPosition, d, px, uSunE) * uShowSun;
  // alpha 0: the backdrop is not an occluder (alpha marks solid geometry for the glare mask)
  gl_FragColor = vec4(col, 0.0);
}
`;

export function swarmRings() {
  // four inclined collector rings, radii 0.05 - 0.13 AU
  const out = [];
  const AU = 1.496e8;
  const base = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < 4; k++) {
    const inc = 0.35 + 0.33 * k;
    const psi = 0.6 + 1.3 * k;
    const n = base.clone().applyAxisAngle(new THREE.Vector3(Math.cos(psi), 0, Math.sin(psi)), inc);
    out.push(new THREE.Vector4(n.x, n.y, n.z, (0.05 + 0.028 * k) * AU));
  }
  return out;
}

export const SKY_UNIFORMS = {
  uSkySunDir: { value: new THREE.Vector3(1, 0, 0) },
  uSkySunPos: { value: new THREE.Vector3(1.496e8, 0, 0) },
  uSkyStars: { value: 1.0 },
  uSwarmN: { value: swarmRings() },
  uSwarmT: { value: 0 },
  uSkyTime: { value: 0 },
};

export function createSpaceSky() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      ...SKY_UNIFORMS,
      uSunE: U.uSunIlluminance,
      uShowSun: { value: 1 },
      uSwarmFar: { value: 1 },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
    },
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    mat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    mat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
    mat.uniformsNeedUpdate = true;
  };
  return mesh;
}
