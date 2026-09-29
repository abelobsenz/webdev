import * as THREE from 'three';
import { SPACE_SKY_GLSL } from './glsl.js';
import { U } from '../core/uniforms.js';
import { planetSky, magWeight, SKY_PLANETS, cometSky, cometGain, COMET, AU_KM } from './ephemeris.js';
import { SUN_DIR, SUN_DIST } from './sim.js';
import { precessionMatrix, starPalette } from './skyCatalog.js';
import { StarPoints } from './skyStars.js';

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
  col += sk_comet(cameraPosition, d, px) * uSkyStars;
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

// The planets on their orbits at the sim's epoch (ephemeris.js), refreshed by SkyLife as the
// clock runs; the initial directions here are the epoch's.
function initialPlanets() {
  const rows = planetSky(0, []);
  return {
    dirs: rows.map((r) => new THREE.Vector4(r.dir.x, r.dir.y, r.dir.z, magWeight(r.mag))),
    cols: SKY_PLANETS.map((p) => new THREE.Vector3(...p.col)),
  };
}
const PL0 = initialPlanets();
const CM0 = cometSky(0, SUN_DIR.clone().multiplyScalar(SUN_DIST), { pos: new THREE.Vector3(), vel: new THREE.Vector3() });
// equatorial of date -> J2000 (the galaxy, the Clouds and Andromeda are placed in J2000)
const PREC = precessionMatrix().transpose();

export const SKY_UNIFORMS = {
  uPlanets: { value: PL0.dirs },
  uPlanetCol: { value: PL0.cols },
  uSkyPrec: { value: PREC },
  uStarPal: { value: starPalette() },
  uCometPos: { value: CM0.pos.clone() },
  uCometVel: { value: CM0.vel.clone() },
  uCometK: { value: new THREE.Vector4(cometGain(CM0.mag), COMET.ionAU * AU_KM, COMET.dustAU * AU_KM, COMET.comaKm) },
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
  // the named stars ride on the backdrop (hidden with it where the Hearth's lens takes over)
  const stars = new StarPoints(SKY_UNIFORMS);
  mesh.add(stars.points);
  mesh.userData.stars = stars;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    mat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    mat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
    mat.uniformsNeedUpdate = true;
  };
  return mesh;
}
