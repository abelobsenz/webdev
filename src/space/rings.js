import * as THREE from 'three';
import { RINGS } from '../sky/celestial.js';
import { U } from '../core/uniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { SUNLIGHT_GLSL, createRibbonMaterial, buildRibbonGeometry } from './lines.js';
import { R_EARTH, bodyDir, cityToBody } from './sim.js';
import { HALO_PORTS } from './earthData.js';

// The four orbital rings at planetary scale, with the same radii, widths and
// orientations as RINGS in src/sky/celestial.js (defined there in Meridian's
// local frame; converted here to the Earth-fixed frame). Each ring is a trough:
// a habitat floor facing space, retaining walls, and two rotor tubes beneath.

/** Ring basis in the body frame: a = direction of u = 0, b = direction of increasing u, n = axis. */
export function ringBasis(def) {
  const m = cityToBody();
  const q = new THREE.Quaternion();
  if (def.polar) {
    const lon = THREE.MathUtils.degToRad(def.lon);
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(lon), Math.sin(lon), 0));
  } else {
    q.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(def.inclination), 0, 0));
  }
  const a = new THREE.Vector3(0, 1, 0).applyQuaternion(q).transformDirection(m);
  const b = new THREE.Vector3(1, 0, 0).applyQuaternion(q).transformDirection(m);
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q).transformDirection(m);
  return { a, b, n, R: R_EARTH + def.altitude };
}

const VERT = /* glsl */ `
attribute vec3 aRing;
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vRad;
void main() {
  vRing = aRing;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uTransmittanceLUT;
uniform vec3 uSunDir;
uniform float uSunE;
uniform float uTime;
uniform float uSimT;
uniform vec3 uAlbedo;
uniform vec3 uHabitatColor;
uniform vec3 uStreamColor;
uniform float uHub;
uniform float uSpeed;
uniform float uSeed;
uniform float uWidth;
uniform float uLen;
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vN;
${SUNLIGHT_GLSL}
${NOISE_GLSL}

float aaStep(float e, float x, float w) { return smoothstep(e - w, e + w, x); }

void main() {
  float u = vRing.x, v = vRing.y, part = vRing.z;
  // below ~2 px across, the far-field ribbon takes over (no aliased dotted lines)
  float fwv = fwidth(v);
  if (fwv > (part > 1.5 ? 0.03 : 0.45)) discard;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 p = vWorld;
  vec3 rhat = normalize(p);
  vec3 V = normalize(cameraPosition - p);
  vec3 sunL = spaceSunlight(uTransmittanceLUT, p, uSunDir) * uSunE;
  float ndl = max(dot(N, uSunDir), 0.0);
  float dayBelow = max(dot(rhat, uSunDir), 0.0);
  vec3 earthshine = vec3(0.35, 0.5, 0.8) * dayBelow * uSunE * 0.09 * max(dot(N, -rhat), 0.0);
  float fu = max(fwidth(u), 1e-4);                 // km per pixel along the ring
  float detail = 1.0 - smoothstep(0.15, 1.2, fu);  // fade fine patterns with distance
  float hubPh = fract(u / uHub);
  float hub = 1.0 - smoothstep(0.012, 0.03, abs(hubPh - 0.5));
  float nightSide = 1.0 - smoothstep(-0.05, 0.1, dot(rhat, uSunDir));
  vec3 col = vec3(0.0), em = vec3(0.0);
  float topSide = dot(N, rhat);

  if (part < 0.5) {
    if (topSide > 0.0) {
      // ---- habitat floor seen from space: parks, towns, lakes, farms under a glass roof ----
      float zi = floor(u / 48.0);
      float zone = hash11(zi * 1.37 + uSeed);
      float zoneN = hash11((zi + 1.0) * 1.37 + uSeed);
      float blend = smoothstep(0.8, 1.0, fract(u / 48.0));
      float z = mix(zone, zoneN, blend);
      vec3 park = vec3(0.05, 0.1, 0.035) * (0.8 + 0.4 * vnoise(vec2(u * 0.4, v * 20.0)));
      vec3 farm = mix(vec3(0.16, 0.15, 0.07), vec3(0.09, 0.13, 0.05), step(0.5, fract(u * 0.9 + v * 3.0)) * detail + 0.5 * (1.0 - detail));
      float blk = hash12(floor(vec2(u / 0.5, v * uWidth / 0.5)));
      vec3 town = mix(vec3(0.22, 0.21, 0.2), vec3(0.34, 0.32, 0.29), blk * detail + 0.5 * (1.0 - detail));
      vec3 alb = z < 0.38 ? park : (z < 0.62 ? farm : town);
      float urban = z >= 0.62 ? 1.0 : 0.25;
      // towns always line the walls, a river runs down the middle
      float edge = smoothstep(0.34, 0.38, abs(v));
      alb = mix(alb, town, edge);
      urban = max(urban, edge);
      float river = 1.0 - smoothstep(0.018, 0.028, abs(v + 0.02 * sin(u * 0.05)));
      alb = mix(alb, vec3(0.02, 0.04, 0.06), river);
      alb = mix(alb, uAlbedo * 1.25, hub);
      vec3 diff = alb / 3.14159 * sunL * ndl;
      // glass roof: glints
      vec3 H = normalize(V + uSunDir);
      float spec = pow(max(dot(N, H), 0.0), 900.0) * 40.0 + pow(max(dot(N, H), 0.0), 60.0) * 0.25;
      float F = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
      col = diff + sunL * spec * F * (0.4 + 0.6 * river);
      col += vec3(0.02, 0.03, 0.05) * F * uSunE * 0.05;
      // lights
      float cell = hash12(floor(vec2(u / 0.35, v * uWidth / 0.35)));
      float lit = mix(0.35, step(0.55, cell) * (0.5 + cell), detail);
      em += uHabitatColor * urban * lit * (0.08 + 0.22 * nightSide) * (1.0 - river);
      em += uHabitatColor * hub * 0.35;
    } else {
      // ---- underside, facing the Earth: structure, radiators, lights ----
      float panel = hash12(floor(vec2(u / 2.4, v * 8.0)));
      vec3 alb = uAlbedo * (0.7 + 0.35 * mix(0.5, panel, detail));
      float rib = 1.0 - smoothstep(0.0, 0.05 + fu * 0.3, abs(fract(u / 6.0) - 0.5) - 0.44);
      alb *= 1.0 - 0.3 * rib * detail;
      float trus = 1.0 - smoothstep(0.02, 0.05, abs(abs(v) - 0.25));
      alb *= 1.0 - 0.25 * trus;
      col = alb / 3.14159 * (sunL * ndl + earthshine * 3.0);
      vec3 H = normalize(V + uSunDir);
      col += sunL * pow(max(dot(N, H), 0.0), 120.0) * 0.4;
      float cell = hash12(floor(vec2(u / 0.8, v * 24.0)));
      float lit = mix(0.3, step(0.62, cell) * (0.6 + cell), detail);
      float band = smoothstep(0.34, 0.3, abs(v));
      em += uHabitatColor * band * lit * (0.05 + 0.2 * nightSide);
      em += uHabitatColor * hub * 0.5;
      // travelling light pulses along the keel
      float keel = 1.0 - smoothstep(0.004, 0.012, abs(v));
      em += uStreamColor * keel * (0.08 + 1.6 * pow(fract(u / 90.0 - uTime * 0.12 * uSpeed), 18.0));
    }
  } else if (part < 1.5) {
    // ---- retaining walls ----
    vec3 alb = uAlbedo * 1.1;
    float rib = 1.0 - smoothstep(0.0, 0.08 + fu * 0.2, abs(fract(u / 3.0) - 0.5) - 0.42);
    alb *= 1.0 - 0.3 * rib * detail;
    col = alb / 3.14159 * (sunL * ndl + earthshine * 2.0);
    vec3 H = normalize(V + uSunDir);
    col += sunL * pow(max(dot(N, H), 0.0), 200.0) * 0.8;
    float stripe = 1.0 - smoothstep(0.0, 0.06, abs(v - 0.9));
    em += uHabitatColor * stripe * 0.25;
    float beacon = step(0.985, fract(u / 25.0)) * stripe * step(0.8, fract(uTime * 0.6 + floor(u / 25.0) * 0.37));
    em += vec3(1.0, 0.3, 0.2) * beacon * 6.0;
  } else {
    // ---- rotor tubes: the mass stream that holds the ring up ----
    vec3 alb = uAlbedo * 0.6;
    col = alb / 3.14159 * (sunL * ndl + earthshine * 2.0);
    float pulse = pow(fract(u / 37.0 - uTime * 0.9 * uSpeed * sign(v)), 14.0);
    float rim = pow(max(1.0 - abs(dot(N, V)), 0.0), 2.0);
    em += uStreamColor * (0.12 + 1.6 * pulse * detail + 0.3 * rim);
  }
  gl_FragColor = vec4(col + em, 1.0);
}
`;

function buildRing(def, basis, segs) {
  const { a, b, n, R } = basis;
  const w = def.width;
  const hw = w / 2;
  const wall = Math.max(1.2, w * 0.07);
  const tubeR = w * 0.035;
  // profile: [s (axial km), dr (radial km), ns, nr (normal in s/r plane), v, part]
  const floor = [];
  const NF = 16;
  for (let i = 0; i <= NF; i++) {
    const t = i / NF - 0.5;
    floor.push([t * w, -0.004 * w * (1 - 4 * t * t), 0, 1, t, 0]);
  }
  const wallL = [[-hw, 0, 1, 0, 0.0, 1], [-hw, wall, 1, 0, 1.0, 1]];
  const wallR = [[hw, wall, -1, 0, 1.0, 1], [hw, 0, -1, 0, 0.0, 1]];
  const tubes = [];
  for (const side of [-1, 1]) {
    const tube = [];
    for (let k = 0; k <= 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const sx = side * (hw + tubeR * 0.6) + Math.cos(ang) * tubeR;
      tube.push([sx, -tubeR * 1.4 + Math.sin(ang) * tubeR, Math.cos(ang), Math.sin(ang), sx / w, 2]);
    }
    tubes.push(tube);
  }
  const profiles = [floor, wallL, wallR, ...tubes];
  const pos = [], nor = [], ring = [], idx = [];
  const P = new THREE.Vector3(), rad = new THREE.Vector3(), tan = new THREE.Vector3();
  for (const prof of profiles) {
    const base = pos.length / 3;
    const M = prof.length;
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * Math.PI * 2;
      rad.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
      for (const [s, dr, ns, nr, v, part] of prof) {
        P.copy(rad).multiplyScalar(R + dr).addScaledVector(n, s);
        pos.push(P.x, P.y, P.z);
        tan.copy(rad).multiplyScalar(nr).addScaledVector(n, ns).normalize();
        nor.push(tan.x, tan.y, tan.z);
        ring.push(th * R, v, part);
      }
    }
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < M - 1; i++) {
        const i0 = base + j * M + i, i1 = i0 + M, i2 = i0 + 1, i3 = i1 + 1;
        idx.push(i0, i1, i2, i2, i1, i3);
      }
    }
  }
  // make every triangle wind counter-clockwise when seen from its normal side
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let k = 0; k < idx.length; k += 3) {
    const [i0, i1, i2] = [idx[k], idx[k + 1], idx[k + 2]];
    vA.fromArray(pos, i0 * 3); vB.fromArray(pos, i1 * 3); vC.fromArray(pos, i2 * 3);
    vB.sub(vA); vC.sub(vA);
    nn.crossVectors(vB, vC);
    const dn = nn.x * (nor[i0 * 3] + nor[i1 * 3]) + nn.y * (nor[i0 * 3 + 1] + nor[i1 * 3 + 1]) + nn.z * (nor[i0 * 3 + 2] + nor[i1 * 3 + 2]);
    if (dn < 0) { idx[k + 1] = i2; idx[k + 2] = i1; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R + wall + 5);
  return g;
}

const FAR_FRAG = /* glsl */ `
uniform vec3 uAlb;
uniform vec3 uHab;
uniform vec3 uStream;
void main() {
  vec3 sunL = spaceSunlight(uTransmittanceLUT, vWorld, uSunDir) * uSunE;
  vec3 rhat = normalize(vWorld);
  float night = 1.0 - smoothstep(-0.05, 0.1, dot(rhat, uSunDir));
  vec3 V = normalize(cameraPosition - vWorld);
  float face = 0.3 + 0.5 * abs(dot(V, rhat));
  vec3 col = uAlb * 0.3 * sunL * face + uHab * (0.05 + 0.2 * night) + uStream * 0.06;
  float fade = 1.0 - smoothstep(1.6, 3.2, vPx);
  gl_FragColor = vec4(col * vCoverage * fade, 0.0);
}
`;

const TETHER_FRAG = /* glsl */ `
uniform vec3 uColor;
void main() {
  vec3 sunL = spaceSunlight(uTransmittanceLUT, vWorld, uSunDir) * uSunE;
  float alt = vData.x;
  vec3 col = vec3(0.55, 0.58, 0.62) * sunL * 0.05 + vec3(0.02, 0.03, 0.05);
  float beacon = step(0.93, fract(alt / 40.0)) * (0.6 + 0.4 * sin(uTime * 3.0 + alt));
  float climb = pow(fract(alt / 90.0 - uSimT * 0.0067 + vData.y * 0.31), 50.0);
  col += uColor * beacon * 1.2 + vec3(0.8, 0.9, 1.0) * climb * 6.0;
  float fade = smoothstep(0.0, 12.0, alt) * (1.0 - smoothstep(560.0, 618.0, alt) * 0.5);
  gl_FragColor = vec4(col * vCoverage * fade, 0.0);
}
`;

export class Rings {
  constructor(space, q) {
    this.space = space;
    this.group = new THREE.Group();
    this.meshes = [];
    this.far = [];
    this.defs = RINGS;
    this.bases = RINGS.map(ringBasis);
    RINGS.forEach((def, i) => {
      const basis = this.bases[i];
      const segs = Math.round((def.name === 'Halo' ? 4096 : 2560) * q.ringSegs);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          uTransmittanceLUT: U.uTransmittanceLUT, uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunE: U.uSunIlluminance,
          uTime: { value: 0 }, uSimT: { value: 0 },
          uAlbedo: { value: new THREE.Color(...def.albedo) },
          uHabitatColor: { value: new THREE.Color(...def.habitat) },
          uStreamColor: { value: new THREE.Color(...def.stream) },
          uHub: { value: def.hub }, uSpeed: { value: def.speed }, uSeed: { value: i * 17.3 + 3.1 },
          uWidth: { value: def.width }, uLen: { value: basis.R * Math.PI * 2 },
        },
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(buildRing(def, basis, segs), mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.userData.def = def;
      this.meshes.push(mesh);
      this.group.add(mesh);
      // far-field ribbon (smooth line when the band is thinner than a couple of pixels)
      const pts = [], along = [];
      const NP = 1440;
      for (let k = 0; k <= NP; k++) {
        const th = (k / NP) * Math.PI * 2;
        pts.push(basis.a.clone().multiplyScalar(Math.cos(th)).addScaledVector(basis.b, Math.sin(th)).multiplyScalar(basis.R));
        along.push(th * basis.R);
      }
      const fm = createRibbonMaterial({ widthKm: def.width, minPx: 1.0, frag: FAR_FRAG, uniforms: {
        uAlb: { value: new THREE.Color(...def.albedo) }, uHab: { value: new THREE.Color(...def.habitat) }, uStream: { value: new THREE.Color(...def.stream) },
      } });
      const far = new THREE.Mesh(buildRibbonGeometry([{ pts, along, id: i }]), fm);
      far.frustumCulled = false;
      far.renderOrder = 11;
      far.userData.axis = basis.n.clone();
      this.far.push(far);
      this.group.add(far);
    });
    // tethers hanging from the Halo to the equatorial ports (Meridian's main tether is separate)
    const lines = [];
    const halo = this.bases[0];
    let id = 0;
    for (const port of HALO_PORTS) {
      if (port.name === 'Meridian') continue;
      const lon = THREE.MathUtils.degToRad(port.lon);
      for (const off of [-9, 0, 9]) {
        const dir = bodyDir(0, lon + off / (R_EARTH + 620));
        const pts = [], along = [];
        for (let h = 0; h <= 620; h += 10) { pts.push(dir.clone().multiplyScalar(R_EARTH + h)); along.push(h); }
        lines.push({ pts, along, id: id++ });
      }
    }
    this.tetherMat = createRibbonMaterial({ widthKm: 0.02, minPx: 1.1, frag: TETHER_FRAG, uniforms: { uColor: { value: new THREE.Color(1.0, 0.75, 0.45) } } });
    this.tethers = new THREE.Mesh(buildRibbonGeometry(lines), this.tetherMat);
    this.tethers.frustumCulled = false;
    this.tethers.renderOrder = 12;
    this.group.add(this.tethers);
  }

  setSize(w, h) {
    this.tetherMat.uniforms.uResolution.value.set(w, h);
    for (const f of this.far) f.material.uniforms.uResolution.value.set(w, h);
  }

  update(sim, realTime) {
    for (const m of this.meshes) {
      const u = m.material.uniforms;
      u.uSunDir.value.copy(sim.sunDir);
      u.uTime.value = realTime;
      u.uSimT.value = sim.t % 1e6;
    }
    const tu = this.tetherMat.uniforms;
    tu.uSunDir.value.copy(sim.sunDir); tu.uTime.value = realTime; tu.uSimT.value = sim.t % 1e6;
    for (const f of this.far) {
      const fu = f.material.uniforms;
      fu.uSunDir.value.copy(sim.sunDir); fu.uTime.value = realTime;
      fu.uBandAxis.value.copy(f.userData.axis).applyQuaternion(sim.earthQuat);
    }
  }

  /** Uniform data for the Earth shader's ring shadows (inertial axes). */
  shadowUniforms(sim, outN, outW) {
    this.bases.forEach((b, i) => {
      const n = b.n.clone().applyQuaternion(sim.earthQuat);
      outN[i].set(n.x, n.y, n.z, b.R);
      outW[i].set(this.defs[i].width / 2, 0.92, 0, 0);
    });
  }
}
