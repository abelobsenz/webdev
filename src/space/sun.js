import * as THREE from 'three';
import { SNOISE_GLSL } from './glsl.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { SKY_UNIFORMS } from './sky.js';
import { U } from '../core/uniforms.js';

// The Sun (a real sphere once you are close enough to see its surface) and the
// Dyson swarm: collector rings and polar statites as sparkling points.

const R_SUN = 696000;
const AU = 1.496e8;

const SUN_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const SUN_FRAG = /* glsl */ `
uniform float uSunE;
uniform float uDim;
uniform float uTime;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vWorld;
${SNOISE_GLSL}
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float mu = max(dot(normalize(vN), V), 0.0);
  vec3 limb = pow(vec3(max(mu, 0.02)), vec3(0.42, 0.56, 0.75));
  vec3 p = vLocal;
  float g = snoise(p * 180.0 + vec3(0.0, uTime * 0.02, 0.0)) * 0.5 + snoise(p * 420.0 - vec3(uTime * 0.03)) * 0.3;
  float spots = smoothstep(0.62, 0.72, snoise(p * 7.0 + 3.0) * 0.5 + 0.5) * smoothstep(0.55, 0.2, abs(p.y));
  float fac = smoothstep(0.55, 0.62, snoise(p * 7.0 + 3.0) * 0.5 + 0.5) * (1.0 - spots);
  vec3 col = vec3(1.0, 0.95, 0.88) * limb * (1.0 + 0.12 * g) * (1.0 - 0.75 * spots) * (1.0 + 0.4 * fac * (1.0 - mu));
  gl_FragColor = vec4(col * uSunE * 2600.0 * uDim, 0.0);   // the Sun never occludes its own glare
}
`;

const CORONA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy;
  gl_Position = projectionMatrix * mv;
}
`;
const CORONA_FRAG = /* glsl */ `
uniform float uSunE;
uniform float uDim;
uniform float uTime;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  float r = length(vUv) * 5.0;        // in solar radii
  if (r < 0.98) discard;
  float a = atan(vUv.y, vUv.x);
  float streamers = 0.55 + 0.45 * fbm2(vec2(a * 4.0, r * 0.4 - uTime * 0.01));
  float I = pow(1.0 / r, 3.2) * streamers + 0.05 * pow(1.0 / r, 1.5);
  vec3 col = vec3(1.0, 0.9, 0.78) * I * uSunE * 60.0 * uDim * smoothstep(5.0, 3.0, r);
  gl_FragColor = vec4(col, 0.0);
}
`;

const SWARM_VERT = /* glsl */ `
attribute vec4 aS;        // x: ring id (0..3, 4 = statite), y: angle, z: radial jitter, w: axial jitter
uniform vec4 uRings[4];   // normal + radius
uniform vec3 uSunPos;
uniform float uT;         // sim seconds
uniform float uPx;
uniform float uFade;
uniform float uTime;
varying float vB;
varying vec3 vCol;
${NOISE_GLSL}
void main() {
  int k = int(aS.x + 0.5);
  vec3 p;
  float period;
  if (k < 4) {
    vec4 rg = uRings[k];
    vec3 n = rg.xyz;
    vec3 e1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(n, e1);
    float a = rg.w / ${AU.toFixed(1)};
    period = 365.25 * 86400.0 * pow(a, 1.5);
    float th = aS.y + 6.2831853 * fract(uT / period);
    float R = rg.w * (1.0 + aS.z);
    p = (e1 * cos(th) + e2 * sin(th)) * R + n * aS.w * rg.w;
    vCol = vec3(1.0, 0.82, 0.55);
  } else {
    // statites: held above the poles by light pressure, in slowly turning discs
    float side = aS.w > 0.0 ? 1.0 : -1.0;
    float rr = aS.z * 0.035 * ${AU.toFixed(1)};
    float th = aS.y + uTime * 0.01;
    p = vec3(cos(th) * rr, side * (0.02 + 0.01 * abs(aS.w)) * ${AU.toFixed(1)}, sin(th) * rr);
    vCol = vec3(0.75, 0.88, 1.0);
  }
  vec3 w = uSunPos + p;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  // glint: each collector tilts a little differently, so it brightens as it orbits
  vec3 toSun = normalize(-p);
  vec3 toCam = normalize(cameraPosition - w);
  float h = hash11(aS.y * 91.7 + aS.x * 13.1);
  float gl = pow(max(dot(normalize(toSun + toCam), normalize(-p + vec3(h - 0.5, fract(h * 7.0) - 0.5, fract(h * 13.0) - 0.5) * 0.9 * length(p))), 0.0), 16.0);
  // a soft, slow shimmer as collectors turn toward us; no random on/off twinkles, which
  // read as flashing lights
  vB = (0.18 + 1.4 * gl) * uFade;
  gl_PointSize = uPx;
}
`;
const SWARM_FRAG = /* glsl */ `
uniform float uSunE;
varying float vB;
varying vec3 vCol;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * vB * exp(-r2 * 3.0) * uSunE * 0.35, 0.0);
}
`;

export class SunSwarm {
  constructor(space, q) {
    this.space = space;
    this.group = new THREE.Group();
    this.uniforms = { uSunE: U.uSunIlluminance, uDim: { value: 1 }, uTime: { value: 0 } };
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(R_SUN, 128, 64), new THREE.ShaderMaterial({ vertexShader: SUN_VERT, fragmentShader: SUN_FRAG, uniforms: this.uniforms }));
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(R_SUN * 10, R_SUN * 10), new THREE.ShaderMaterial({
      vertexShader: CORONA_VERT, fragmentShader: CORONA_FRAG, uniforms: this.uniforms, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.corona.renderOrder = 20;
    this.sunGroup = new THREE.Group();
    this.sunGroup.add(this.sphere, this.corona);
    this.group.add(this.sunGroup);
    // swarm points
    const n = q.swarm;
    const aS = new Float32Array(n * 4);
    let s = 12345;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) {
      const stat = i < n * 0.08;
      const k = stat ? 4 : Math.floor(rnd() * 4);
      const g = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
      aS.set([k, rnd() * Math.PI * 2, stat ? Math.sqrt(rnd()) : g() * 0.035, stat ? (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd()) : g() * 0.01], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 4));
    this.swarmU = {
      uRings: SKY_UNIFORMS.uSwarmN, uSunPos: { value: new THREE.Vector3() }, uT: { value: 0 }, uPx: { value: 2 }, uFade: { value: 0 },
      uTime: this.uniforms.uTime, uSunE: this.uniforms.uSunE,
    };
    this.swarm = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: SWARM_VERT, fragmentShader: SWARM_FRAG, uniforms: this.swarmU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.swarm.renderOrder = 19;
    this.group.add(this.swarm);
    this.group.traverse((o) => { o.frustumCulled = false; });
    this.near = 0;
  }

  setSize(w, h) { this.swarmU.uPx.value = Math.max(2.0, h / 380); }

  update(sim, realTime, dt, space) {
    const cam = space.camera.position;
    const d = cam.distanceTo(sim.sunPos);
    this.near = 1 - THREE.MathUtils.clamp((d - 5.0e7) / (9.5e7 - 5.0e7), 0, 1);
    this.near = this.near * this.near * (3 - 2 * this.near);
    this.sunGroup.position.copy(sim.sunPos);
    this.uniforms.uTime.value = realTime;
    // close to the Sun the eye stops down: dim the disc so the swarm can be seen
    const dim = THREE.MathUtils.lerp(1, 0.00045, this.near);
    this.uniforms.uDim.value = dim;
    space.skyDim = dim;
    this.swarmU.uSunPos.value.copy(sim.sunPos);
    this.swarmU.uT.value = sim.t % (365.25 * 86400 * 4);
    this.swarmU.uFade.value = this.near;
    this.swarm.visible = this.near > 0.001;
    SKY_UNIFORMS.uSwarmT.value = realTime;
  }

  exposureHint(cam, space) { return this.near * 0.55; }
}
