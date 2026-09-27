import * as THREE from 'three';
import { aerialShaderMaterial } from '../world/materials.js';
import { U } from '../core/uniforms.js';

// A drifting deck of fair-weather cumulus. Two stacked layers give parallax
// thickness; lighting marches a few taps toward the sun for self-shadowing.
const VERT = /* glsl */ `
uniform float uLayer;
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform vec2 uCloudOffset;
uniform float uCloudCoverage;
uniform float uLayer;
varying vec3 vW;
float density(vec2 p) {
  vec2 q = (p + uCloudOffset) * 0.00022;
  float base = fbm2_3(q);
  float cov = 1.0 - uCloudCoverage;
  float d = smoothstep(cov - 0.02, cov + 0.28, base);
  // billowy detail erodes the edges
  float det = fbm2((p + uCloudOffset * 1.3) * 0.0016 + uLayer * 7.1);
  d = clamp(d * 1.25 - (1.0 - d) * det * 0.9 - det * 0.25 + 0.1, 0.0, 1.0);
  return d;
}
void main() {
  vec3 toCam = cameraPosition - vW;
  float dist = length(toCam);
  float d = density(vW.xz);
  if (d < 0.01) discard;
  // self shadowing toward the sun
  vec2 sdir = normalize(uSunDir.xz + 1e-4) * (1.0 - clamp(uSunDir.y, 0.0, 1.0) * 0.6);
  float occ = density(vW.xz + sdir * 140.0) + density(vW.xz + sdir * 380.0) * 0.8;
  float shade = exp(-occ * 1.1 - d * 0.6);
  vec3 V = toCam / dist;
  float cosT = dot(-V, uSunDir);
  float silver = pow(max(cosT, 0.0), 8.0) * 2.5 * (1.0 - d);
  vec3 sun = uSunColor * uSunIlluminance;
  vec3 amb = (aerialInscatter(vec3(0.0, 1.0, 0.0)) - uNightAmbient) * 1.4 + (aerialInscatter(normalize(vec3(uSunDir.x, 0.15, uSunDir.z))) - uNightAmbient) * 0.4 + uNightAmbient * 0.5;
  vec3 col = vec3(0.98) * (sun * (shade * 0.55 + silver * 0.2) * max(uSunDir.y + 0.08, 0.0) * 1.2 + amb * (0.55 + 0.45 * (1.0 - d)));
  // undersides glow faintly with the city at night
  col += vec3(1.0, 0.7, 0.45) * uCityLights * 0.012 * (1.0 - shade) * step(vW.y, cameraPosition.y + 1e5);
  float a = d * (1.0 - smoothstep(22000.0, 38000.0, dist)) * 0.92;
  col = applyAerial(col, vW);
  gl_FragColor = vec4(col * a, a);
}`;

export class Clouds {
  constructor(scene) {
    this.layers = [];
    const geo = new THREE.PlaneGeometry(80000, 80000, 1, 1).rotateX(-Math.PI / 2);
    for (let l = 0; l < 2; l++) {
      const mat = aerialShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: { uLayer: { value: l }, uCloudOffset: U.uCloudOffset, uCloudCoverage: U.uCloudCoverage },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = 2400 + l * 110;
      m.renderOrder = 8 + l;
      m.frustumCulled = false;
      scene.add(m);
      this.layers.push(m);
    }
    this.enabled = true;
  }
  update(dt, camera) {
    U.uCloudOffset.value.x += dt * 9.0;
    U.uCloudOffset.value.y += dt * 3.5;
    // draw the far layer first
    if (camera) {
      const below = camera.position.y < this.layers[0].position.y;
      this.layers[0].renderOrder = below ? 9 : 8;
      this.layers[1].renderOrder = below ? 8 : 9;
    }
  }
  setVisible(v) { for (const l of this.layers) l.visible = v; U.uCloudShadow.value = v ? 1 : 0; }
}
