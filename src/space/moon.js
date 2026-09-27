import * as THREE from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/uniforms.js';
import { SNOISE_GLSL } from './glsl.js';
import { createRibbonMaterial, buildRibbonGeometry } from './lines.js';
import { R_MOON } from './sim.js';

// The terraformed Moon: seas in the old maria, green highlands softened craters,
// polar ice, clouds, city lights, a thin blue atmosphere and an equatorial ring.
// Moon frame: +X faces the Earth (near side), +Y ~ orbit normal.

const D2R = Math.PI / 180;
// selenographic maria [lat, lon, radius] in degrees (lon east positive)
const MARIA = [
  [10, -50, 17], [25, -58, 14], [0, -63, 11], [-5, -48, 9], [33, -16, 16], [28, 17.5, 9.5], [8.5, 31, 11],
  [17, 59, 7.5], [-8, 51, 9], [-15, 35, 5], [-21, -17, 10], [-24, -39, 6], [55, -20, 5], [57, 5, 5], [55, 30, 4],
  [13, 4, 4], [7, -31, 6], [-10, -23, 5], [27, 147, 4], [-53, -169, 17], [-19, -93, 5], [-35, 130, 5],
];

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vLocal = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSunE;
uniform float uTime;
uniform float uCloudT;
uniform vec3 uEarthDir;      // direction from the Moon to the Earth (world)
uniform float uEarthPhase;   // lit fraction of the Earth seen from the Moon
uniform vec4 uMaria[${MARIA.length}];
uniform vec4 uRingN;         // lunar ring axis (world) + radius
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vLocal;
${NOISE_GLSL}
${SNOISE_GLSL}

float craters(vec3 p, float scale, out float rim) {
  vec3 q = p * scale;
  vec3 c = floor(q - 0.5);
  float bowl = 0.0; rim = 0.0;
  for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) for (int k = 0; k < 2; k++) {
    vec3 cell = c + vec3(float(i), float(j), float(k));
    vec3 h = hash33(cell);
    float rr = 0.16 + 0.3 * h.x * h.x;
    float d = length(q - cell - h) / rr;
    float on = step(0.35, h.y);
    bowl = max(bowl, (1.0 - smoothstep(0.0, 1.0, d)) * on);
    rim = max(rim, exp(-pow((d - 1.0) * 5.0, 2.0)) * on);
  }
  return bowl;
}

void main() {
  vec3 n = normalize(vN);
  vec3 p = vLocal;
  float sea = 0.0;
  for (int i = 0; i < ${MARIA.length}; i++) {
    vec4 m = uMaria[i];
    float d = acos(clamp(dot(p, m.xyz), -1.0, 1.0));
    sea = max(sea, 1.0 - smoothstep(m.w * 0.75, m.w * 1.05, d));
  }
  float coast = sfbm(p * 9.0, 5) * 0.28 + snoise(p * 40.0) * 0.06;
  float seaF = smoothstep(0.45, 0.55, sea + coast);
  float rimA, rimB;
  float cA = craters(p, 7.0, rimA);
  float cB = craters(p + 3.1, 19.0, rimB);
  float h = sfbm(p * 3.0 + 1.3, 5) * 0.5 + 0.5;
  float h2 = sfbm(p * 11.0 + 7.7, 4) * 0.5 + 0.5;
  vec3 green = mix(vec3(0.045, 0.085, 0.03), vec3(0.12, 0.13, 0.06), h);
  vec3 tan = mix(vec3(0.2, 0.17, 0.11), vec3(0.3, 0.27, 0.2), h2);
  vec3 rock = vec3(0.3, 0.29, 0.27);
  vec3 land = mix(green, tan, smoothstep(0.45, 0.7, h * 0.7 + h2 * 0.5));
  land = mix(land, rock, smoothstep(0.62, 0.8, h + rimA * 0.3 + rimB * 0.15));
  land *= 0.85 + 0.25 * (rimA * 0.6 + rimB * 0.4) - 0.2 * (cA * 0.5 + cB * 0.3);
  // crater lakes on the highlands
  float lake = step(0.6, cA) * step(0.5, hash13(floor(p * 7.0)));
  vec3 seaC = mix(vec3(0.006, 0.02, 0.045), vec3(0.012, 0.05, 0.06), smoothstep(0.55, 0.45, sea + coast));
  vec3 alb = mix(land, seaC, max(seaF, lake * 0.9));
  float lat = abs(p.y);
  alb = mix(alb, vec3(0.8, 0.83, 0.88), smoothstep(0.86, 0.93, lat + coast * 0.2));
  // clouds
  vec3 cp = p;
  float ang = uCloudT * 0.3;
  cp.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * cp.xz;
  float cl = smoothstep(0.6, 0.82, sfbm(cp * 5.0 + vec3(0.0, 0.0, uCloudT * 0.1), 5) * 0.5 + 0.5 + 0.06 * (1.0 - seaF)) * 0.75;
  float ndl = dot(n, uSunDir);
  vec3 sunL = vec3(1.0, 0.97, 0.93) * uSunE;
  float wrap = max(ndl, 0.0);
  float twilight = smoothstep(-0.12, 0.1, ndl);
  vec3 col = alb / 3.14159 * sunL * wrap;
  col = mix(col, vec3(0.9) / 3.14159 * sunL * clamp((ndl + 0.1) / 1.1, 0.0, 1.0), cl * 0.9);
  // specular seas
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(V + uSunDir);
  col += sunL * pow(max(dot(n, H), 0.0), 180.0) * 0.5 * seaF * (1.0 - cl) * step(0.0, ndl);
  // earthshine on the night side
  col += alb * vec3(0.4, 0.55, 0.9) * uSunE * 0.0025 * uEarthPhase * max(dot(n, uEarthDir), 0.0);
  // city lights along the coasts and in the crater valleys
  float night = 1.0 - smoothstep(-0.08, 0.06, ndl);
  float coastBand = 1.0 - smoothstep(0.0, 0.08, abs(sea + coast - 0.5));
  float cells = step(0.55, hash13(floor(p * 220.0))) * smoothstep(0.5, 0.85, snoise(p * 22.0) * 0.5 + 0.5);
  float towns = (coastBand * 0.9 + (1.0 - seaF) * 0.15 * step(0.75, hash13(floor(p * 30.0)))) * cells;
  towns *= 1.0 + 1.5 * step(0.0, p.x);          // most people live facing home
  col += vec3(1.0, 0.7, 0.42) * towns * night * (1.0 - cl * 0.8) * 0.5;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Thin atmosphere: analytic limb glow on a slightly larger shell
const ATMO_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSunE;
uniform vec3 uCenter;
varying vec3 vWorld;
void main() {
  vec3 ro = cameraPosition - uCenter;
  vec3 rd = normalize(vWorld - cameraPosition);
  float b = dot(ro, rd);
  float t = max(-b, 0.0);
  vec3 cp = ro + rd * t;
  float r = length(cp);
  float h = r - ${R_MOON.toFixed(1)};
  float surf = step(h, 0.0);
  float H = 11.0;
  float dens = exp(-max(h, 0.0) / H) * (1.0 - surf * 0.55);
  float chord = sqrt(max(2.0 * ${R_MOON.toFixed(1)} * H, 1.0));
  vec3 up = cp / max(r, 1e-3);
  float mu = dot(up, uSunDir);
  float lit = smoothstep(-0.25, 0.2, mu);
  float cosT = dot(rd, uSunDir);
  vec3 ray = vec3(0.25, 0.5, 1.0) * (0.75 + 0.25 * cosT * cosT);
  vec3 sunset = vec3(1.0, 0.55, 0.3) * smoothstep(0.25, -0.05, mu) * lit;
  vec3 col = (ray * lit + sunset) * dens * uSunE * 0.0036 * chord / 100.0;
  col += vec3(1.0, 0.9, 0.8) * pow(max(cosT, 0.0), 12.0) * dens * uSunE * 0.01 * lit;
  gl_FragColor = vec4(col, 0.0);
}
`;
const ATMO_VERT = /* glsl */ `
varying vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;

const RING_VERT = /* glsl */ `
attribute vec3 aRing;
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vRing = aRing;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const RING_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSunE;
uniform float uTime;
uniform vec3 uCenter;
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vN;
${NOISE_GLSL}
void main() {
  if (fwidth(vRing.y) > 0.45) discard;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 p = vWorld - uCenter;
  // Moon's shadow on the ring
  float b = dot(p, uSunDir);
  float sh = b > 0.0 ? 1.0 : smoothstep(${R_MOON.toFixed(1)} - 20.0, ${R_MOON.toFixed(1)} + 20.0, length(p - uSunDir * b));
  vec3 sunL = uSunE * sh * vec3(1.0, 0.97, 0.93);
  float u = vRing.x, v = vRing.y;
  float fu = fwidth(u);
  float detail = 1.0 - smoothstep(0.15, 1.0, fu);
  float panel = hash12(floor(vec2(u / 1.2, v * 6.0)));
  vec3 alb = vec3(0.42, 0.42, 0.44) * (0.8 + 0.3 * mix(0.5, panel, detail));
  vec3 col = alb / 3.14159 * sunL * max(dot(N, uSunDir), 0.0);
  vec3 V = normalize(cameraPosition - vWorld);
  col += sunL * pow(max(dot(N, normalize(V + uSunDir)), 0.0), 150.0) * 0.5;
  float cell = hash12(floor(vec2(u / 0.4, v * 16.0)));
  float lit = mix(0.35, step(0.55, cell) * (0.5 + cell), detail);
  col += vec3(0.85, 0.9, 1.0) * lit * (0.06 + 0.2 * (1.0 - sh)) * smoothstep(0.45, 0.3, abs(v));
  float pulse = pow(fract(u / 60.0 - uTime * 0.4), 16.0) * smoothstep(0.42, 0.5, abs(v));
  col += vec3(0.7, 0.8, 1.0) * pulse * 1.2;
  gl_FragColor = vec4(col, 1.0);
}
`;
const FAR_FRAG = /* glsl */ `
uniform vec3 uCenter;
void main() {
  vec3 p = vWorld - uCenter;
  float b = dot(p, uSunDir);
  float sh = b > 0.0 ? 1.0 : smoothstep(${(R_MOON - 20).toFixed(1)}, ${(R_MOON + 20).toFixed(1)}, length(p - uSunDir * b));
  vec3 col = vec3(0.42) * 0.3 * uSunE * sh * 0.5 + vec3(0.8, 0.88, 1.0) * (0.04 + 0.12 * (1.0 - sh));
  float fade = 1.0 - smoothstep(1.6, 3.2, vPx);
  gl_FragColor = vec4(col * vCoverage * fade, 0.0);
}
`;

function buildBand(R, w, segs) {
  const pos = [], nor = [], ring = [], idx = [];
  const prof = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8 - 0.5; prof.push([t * w, 0, 0, 1, t]); }
  const M = prof.length;
  for (let j = 0; j <= segs; j++) {
    const th = (j / segs) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    for (const [ax, dr, , , v] of prof) {
      pos.push(c * (R + dr), ax, s * (R + dr));
      nor.push(c, 0, s);
      ring.push(th * R, v, 0);
    }
  }
  for (let j = 0; j < segs; j++) for (let i = 0; i < M - 1; i++) {
    const a = j * M + i, b = a + M;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 3));
  g.setIndex(idx);
  return g;
}

export class Moon {
  constructor(space) {
    this.space = space;
    this.group = new THREE.Group();
    const maria = MARIA.map(([lat, lon, r]) => {
      const la = lat * D2R, lo = lon * D2R;
      return new THREE.Vector4(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo), r * D2R);
    });
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunE: U.uSunIlluminance, uTime: { value: 0 }, uCloudT: { value: 0 },
      uEarthDir: { value: new THREE.Vector3(1, 0, 0) }, uEarthPhase: { value: 0.5 }, uMaria: { value: maria },
      uRingN: { value: new THREE.Vector4(0, 1, 0, R_MOON + 380) },
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(R_MOON, 192, 96), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms }));
    this.mesh.renderOrder = 4;
    this.group.add(this.mesh);
    this.atmoU = { uSunDir: this.uniforms.uSunDir, uSunE: U.uSunIlluminance, uCenter: { value: new THREE.Vector3() } };
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(R_MOON + 70, 128, 64), new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, uniforms: this.atmoU,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
    }));
    this.atmo.renderOrder = 6;
    this.group.add(this.atmo);
    // equatorial ring (Moon frame XZ plane)
    this.ringU = { uSunDir: this.uniforms.uSunDir, uSunE: U.uSunIlluminance, uTime: this.uniforms.uTime, uCenter: this.atmoU.uCenter };
    this.ring = new THREE.Mesh(buildBand(R_MOON + 380, 11, 1800), new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, uniforms: this.ringU, side: THREE.DoubleSide }));
    this.ring.renderOrder = 3;
    this.group.add(this.ring);
    const pts = [], along = [];
    for (let k = 0; k <= 720; k++) { const th = (k / 720) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(th) * (R_MOON + 380), 0, Math.sin(th) * (R_MOON + 380))); along.push(th); }
    this.farMat = createRibbonMaterial({ widthKm: 11, minPx: 1.0, frag: FAR_FRAG, uniforms: { uCenter: this.atmoU.uCenter } });
    this.far = new THREE.Mesh(buildRibbonGeometry([{ pts, along, id: 0 }]), this.farMat);
    this.far.renderOrder = 11;
    this.group.add(this.far);
    this.group.traverse((o) => { o.frustumCulled = false; });
  }

  setSize(w, h) { this.farMat.uniforms.uResolution.value.set(w, h); }

  exposureHint(cam, space) {
    const rel = space.sim.moonPos.clone().sub(cam.position);
    const d = rel.length();
    const ang = Math.asin(Math.min(1, R_MOON / d));
    const fov = THREE.MathUtils.degToRad(cam.fov) * 0.5;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const off = Math.acos(THREE.MathUtils.clamp(rel.dot(fwd) / d, -1, 1));
    if (off > ang + fov * 1.4) return 0;
    const cover = Math.min(1, (ang * ang) / (fov * fov * 1.6));
    const phase = 0.5 + 0.5 * space.sim.sunDir.dot(rel.clone().normalize().negate());
    return cover * phase * 1.2;
  }

  update(sim, realTime) {
    this.group.position.copy(sim.moonPos);
    this.group.quaternion.copy(sim.moonQuat);
    this.group.updateMatrixWorld(true);
    const u = this.uniforms;
    u.uSunDir.value.copy(sim.sunDir);
    u.uTime.value = realTime;
    u.uCloudT.value = (sim.t / 86400 / 6) % 100;
    const toE = sim.moonPos.clone().negate().normalize();
    u.uEarthDir.value.copy(toE);
    u.uEarthPhase.value = 0.5 + 0.5 * sim.sunDir.dot(sim.moonPos.clone().normalize());
    this.atmoU.uCenter.value.copy(sim.moonPos);
    const fu = this.farMat.uniforms;
    fu.uSunDir.value.copy(sim.sunDir);
    fu.uBandAxis.value.set(0, 1, 0).applyQuaternion(sim.moonQuat);
  }
}
