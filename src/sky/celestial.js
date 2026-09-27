import * as THREE from 'three';
import { ATMO_CONSTANTS, ATMO_SAMPLING } from '../shaders/atmosphere.glsl.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/uniforms.js';

export const RG_KM = 6360;

// Common header for objects seen *through* the atmosphere from the viewer.
const THROUGH_ATMO = /* glsl */ `
uniform sampler2D uTransmittanceLUT;
uniform vec3 uSunDir;
uniform float uSunIlluminance;
uniform float uNight;
uniform float uTime;
${ATMO_CONSTANTS}
${ATMO_SAMPLING}
vec3 viewTransmittance(vec3 worldKm, out float occluded) {
  vec3 camPlanet = cameraPosition + vec3(0.0, Rg, 0.0);
  float vh = max(length(camPlanet), Rg + 0.002);
  vec3 up = camPlanet / length(camPlanet);
  vec3 ro = up * vh;
  vec3 dv = (worldKm + vec3(0.0, Rg, 0.0)) - ro;
  float dist = length(dv);
  vec3 dir = dv / dist;
  float tP = raySphere(ro, dir, Rg);
  occluded = (tP > 0.0 && tP < dist) ? 1.0 : 0.0;
  return sampleTransmittance(uTransmittanceLUT, vh, dot(up, dir));
}
// Illumination of a point in space by the sun, including the planet's shadow
// with a reddened penumbra where sunlight grazes the atmosphere.
vec3 sunlightAt(vec3 pPlanet) {
  float b = dot(pPlanet, uSunDir);
  vec3 closest = pPlanet - uSunDir * b;
  float hMin = length(closest) - Rg;
  if (b > 0.0) return vec3(1.0);
  float lit = smoothstep(-5.0, 60.0, hMin);
  vec3 tint = mix(vec3(1.0, 0.35, 0.12), vec3(1.0), smoothstep(10.0, 90.0, hMin));
  return lit * tint;
}
`;

// ------------------------------------------------------------------ Rings --
const RING_VERT = /* glsl */ `
attribute vec3 aRing;      // x: km along ring, y: across (-0.5..0.5), z: part id
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vRing = aRing;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const RING_FRAG = /* glsl */ `
${THROUGH_ATMO}
${NOISE_GLSL}
uniform vec3 uAlbedo;
uniform vec3 uHabitatColor;
uniform vec3 uStreamColor;
uniform float uHubSpacing;
uniform float uHabitatWidth;
uniform float uStreamSpeed;
uniform float uLights;
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  float occ;
  vec3 T = viewTransmittance(vWorld, occ);
  if (occ > 0.5) discard;
  vec3 pPlanet = vWorld + vec3(0.0, Rg, 0.0);
  vec3 rhat = normalize(pPlanet);
  vec3 N = normalize(vNormalW);
  float u = vRing.x, v = vRing.y;
  float part = vRing.z;
  // --- base structure ---
  float panel = hash12(vec2(floor(u / 1.6), floor(v * 10.0)));
  vec3 alb = uAlbedo * (0.82 + 0.3 * panel);
  // longitudinal decks: habitat band, darker accelerator lanes, bright rims
  float lane = smoothstep(0.30, 0.34, abs(v)) * (1.0 - smoothstep(0.46, 0.48, abs(v)));
  alb *= 1.0 - 0.45 * lane;
  float groove = smoothstep(0.012, 0.0, abs(abs(v) - 0.30)) + smoothstep(0.012, 0.0, abs(abs(v) - 0.12));
  alb *= 1.0 - 0.25 * groove;
  float seam = smoothstep(0.03, 0.0, abs(fract(u / 25.0) - 0.5) - 0.47);
  alb *= 1.0 - 0.12 * seam;
  float hubPhase = fract(u / uHubSpacing);
  float hub = smoothstep(0.02, 0.0, abs(hubPhase - 0.5) - 0.01);
  alb = mix(alb, uAlbedo * 1.12, hub * 0.6);
  // --- lighting ---
  // (the eye adapts locally to a sunlit ring in a dark sky; emulate it)
  vec3 sunL = sunlightAt(pPlanet) * uSunIlluminance * mix(1.0, 0.1, uNight);
  float ndl = max(dot(N, uSunDir), 0.0);
  float dayBelow = max(dot(rhat, uSunDir), 0.0);
  vec3 earthshine = vec3(0.45, 0.62, 0.95) * dayBelow * uSunIlluminance * 0.12 * max(dot(N, -rhat), 0.0);
  vec3 col = alb * (sunL * ndl * 0.6 + earthshine);
  // specular glint from the sun on the outer skin
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(V + uSunDir);
  col += sunL * pow(max(dot(N, H), 0.0), 120.0) * 0.6;
  // --- lights ---
  float habitat = smoothstep(uHabitatWidth, uHabitatWidth - 0.04, abs(v)) * step(part, 0.5);
  float cell = hash12(vec2(floor(u / 0.9), floor(v * 30.0))) * (0.6 + 0.4 * vnoise(vec2(u * 0.02, v * 3.0)));
  float lit = step(0.35, cell) * (0.6 + 0.4 * cell);
  float lights = habitat * lit * (0.55 + 0.45 * uNight);
  vec3 em = uHabitatColor * lights * 0.12;
  em += uHabitatColor * hub * 0.25 * habitat;
  // accelerator streams along the edges with travelling pulses
  float stream = smoothstep(0.035, 0.0, abs(abs(v) - 0.44));
  float pulse = pow(fract(u / 37.0 - uTime * uStreamSpeed * sign(v)), 12.0);
  em += uStreamColor * stream * (0.06 + 0.9 * pulse);
  // navigation beacons
  float beaconU = fract(u / 50.0);
  float beacon = smoothstep(0.004, 0.0, abs(beaconU - 0.5)) * smoothstep(0.03, 0.0, abs(abs(v) - 0.49));
  float blink = step(0.85, fract(uTime * 0.7 + floor(u / 50.0) * 0.37));
  em += vec3(1.0, 0.25, 0.2) * beacon * blink * 3.0;
  if (part > 0.5) { // rim tubes
    em = uStreamColor * (0.08 + 0.8 * pulse);
    col = alb * (sunL * max(dot(N, uSunDir), 0.0) + earthshine) * 0.8;
  }
  col += em * uLights;
  float a = smoothstep(0.0, 1.0, uNight) * 0.97;
  gl_FragColor = vec4(col * T, a);
}
`;

function buildRingGeometry({ radius, width, segments = 2048, rim = true }) {
  // Profile across the band (s along axis, dr radial offset, part id)
  const prof = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n - 0.5; // -0.5..0.5
    const dr = 0.012 * width * (1 - 4 * t * t) * -1 + 0.0; // gently concave toward planet
    prof.push({ s: t * width, dr, v: t, part: 0 });
  }
  const verts = [], norms = [], ring = [], idx = [];
  const addBand = (profile, closed) => {
    const base = verts.length / 3;
    const P = profile.length;
    for (let j = 0; j <= segments; j++) {
      const th = (j / segments) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      for (let i = 0; i < P; i++) {
        const p = profile[i];
        const r = radius + p.dr;
        // ring lies in plane spanned by e1 = +Y (local) and e2 = +X, axis = +Z
        verts.push(s * r, c * r, p.s);
        // normal: inward for band, computed from profile tangent
        const pp = profile[Math.max(i - 1, 0)], pn = profile[Math.min(i + 1, P - 1)];
        const ds = pn.s - pp.s, ddr = pn.dr - pp.dr;
        // radial-axial 2D normal pointing inwards (-radial)
        let nr = -ds, nz = ddr;
        if (p.nOut) { nr = -nr; nz = -nz; }
        const l = Math.hypot(nr, nz) || 1;
        nr /= l; nz /= l;
        norms.push(s * nr, c * nr, nz);
        ring.push(th * radius, p.v, p.part);
      }
    }
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < P - 1; i++) {
        const a = base + j * P + i, b = a + P, c2 = a + 1, d = b + 1;
        idx.push(a, b, c2, c2, b, d);
      }
    }
  };
  addBand(prof);
  if (rim) {
    // two thin tubes at the edges (mass-stream accelerators)
    for (const side of [-0.5, 0.5]) {
      const tube = [];
      const tr = width * 0.035;
      for (let k = 0; k <= 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        tube.push({ s: side * width * 1.02 + Math.cos(a) * tr, dr: Math.sin(a) * tr - width * 0.01, v: side * 0.99, part: 1 });
      }
      // normals for a tube: compute radially from tube centre
      const base = verts.length / 3;
      for (let j = 0; j <= segments; j++) {
        const th = (j / segments) * Math.PI * 2;
        const c = Math.cos(th), s = Math.sin(th);
        for (let k = 0; k < tube.length; k++) {
          const p = tube[k];
          const r = radius + p.dr;
          verts.push(s * r, c * r, p.s);
          const a = (k / 8) * Math.PI * 2;
          const nr = Math.sin(a), nz = Math.cos(a);
          norms.push(s * nr, c * nr, nz);
          ring.push(th * radius, p.v, 1);
        }
      }
      const P = tube.length;
      for (let j = 0; j < segments; j++) {
        for (let i = 0; i < P - 1; i++) {
          const a = base + j * P + i, b = a + P, c2 = a + 1, d = b + 1;
          idx.push(a, c2, b, c2, d, b);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export const RINGS = [
  { name: 'Halo', altitude: 620, width: 32, inclination: 0, lon: 0, albedo: [0.4, 0.4, 0.42], habitat: [1.0, 0.72, 0.42], stream: [0.55, 0.85, 1.0], hub: 140, habitatWidth: 0.34, speed: 0.9 },
  { name: 'Aurea', altitude: 1450, width: 26, inclination: 23, lon: 0, albedo: [0.44, 0.42, 0.39], habitat: [1.0, 0.8, 0.55], stream: [1.0, 0.7, 0.4], hub: 260, habitatWidth: 0.26, speed: 0.6 },
  { name: 'Selene', altitude: 1450, width: 26, inclination: -27, lon: 0, albedo: [0.39, 0.41, 0.45], habitat: [0.7, 0.85, 1.0], stream: [0.6, 0.8, 1.0], hub: 260, habitatWidth: 0.26, speed: -0.6 },
  { name: 'Meridian Polar', altitude: 2100, width: 18, polar: true, lon: -34, albedo: [0.42, 0.42, 0.43], habitat: [0.85, 0.9, 1.0], stream: [0.8, 0.6, 1.0], hub: 300, habitatWidth: 0.2, speed: 0.5 },
];

function createRing(def) {
  const radius = RG_KM + def.altitude;
  const geo = buildRingGeometry({ radius, width: def.width, segments: def.name === 'Halo' ? 3072 : 2048 });
  const mat = new THREE.ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    uniforms: {
      uTransmittanceLUT: U.uTransmittanceLUT,
      uSunDir: U.uSunDir,
      uSunIlluminance: U.uSunIlluminance,
      uNight: U.uNight,
      uTime: U.uTime,
      uAlbedo: { value: new THREE.Color(...def.albedo) },
      uHabitatColor: { value: new THREE.Color(...def.habitat) },
      uStreamColor: { value: new THREE.Color(...def.stream) },
      uHubSpacing: { value: def.hub },
      uHabitatWidth: { value: def.habitatWidth },
      uStreamSpeed: { value: def.speed },
      uLights: { value: 1.0 },
    },
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  // geometry is built around the planet centre in its local frame
  mesh.position.set(0, -RG_KM, 0);
  if (def.polar) {
    // plane contains the planet's rotation axis (local Z) and is rotated in longitude
    // local ring plane = (Y, X) with axis Z; rotate so that the axis becomes the plane normal (cos lon, sin lon, 0)
    const lon = THREE.MathUtils.degToRad(def.lon);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(lon), Math.sin(lon), 0));
    mesh.quaternion.copy(q);
  } else {
    mesh.rotation.x = THREE.MathUtils.degToRad(def.inclination);
  }
  mesh.userData.def = def;
  return mesh;
}

// ------------------------------------------------------------------- Moon --
const MOON_VERT = /* glsl */ `
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
const MOON_FRAG = /* glsl */ `
${THROUGH_ATMO}
${NOISE_GLSL}
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  float occ;
  vec3 T = viewTransmittance(vWorld, occ);
  if (occ > 0.5) discard;
  vec3 n = normalize(vN);
  vec3 p = vLocal;
  // terraformed Luna: seas in the old maria, green highlands, polar ice, cloud bands
  float h = fbm3(p * 2.2 + vec3(3.1, 1.7, 0.4));
  float maria = smoothstep(0.50, 0.46, h);
  float lat = abs(p.y);
  vec3 land = mix(vec3(0.18, 0.30, 0.12), vec3(0.42, 0.38, 0.30), smoothstep(0.55, 0.72, h));
  land = mix(land, vec3(0.55, 0.52, 0.48), smoothstep(0.7, 0.8, h));
  vec3 sea = mix(vec3(0.02, 0.07, 0.16), vec3(0.03, 0.14, 0.22), smoothstep(0.35, 0.47, h));
  vec3 alb = mix(land, sea, maria);
  alb = mix(alb, vec3(0.85, 0.88, 0.92), smoothstep(0.82, 0.9, lat));
  float cl = fbm3(p * 4.0 + vec3(uTime * 0.002, 0.0, 0.0));
  float clouds = smoothstep(0.52, 0.72, cl) * 0.85;
  alb = mix(alb, vec3(0.9), clouds);
  float ndl = dot(n, uSunDir);
  float day = smoothstep(-0.08, 0.25, ndl);
  vec3 col = alb * max(ndl, 0.0) * uSunIlluminance * 0.9 * mix(1.0, 0.14, uNight);
  // city lights on the night side: coastal settlements
  float coast = smoothstep(0.08, 0.0, abs(h - 0.48));
  float cells = step(0.72, hash13(floor(p * 90.0)));
  float cityLight = (coast * 0.8 + (1.0 - maria) * 0.15) * cells * (1.0 - clouds);
  col += vec3(1.0, 0.7, 0.4) * cityLight * (1.0 - day) * 1.2;
  // lunar equatorial ring (bright thread)
  float ringLine = smoothstep(0.012, 0.0, abs(p.y + 0.02 * sin(atan(p.z, p.x) * 3.0)));
  col += vec3(0.9, 0.85, 1.0) * ringLine * (0.3 + 0.7 * day);
  // atmosphere rim
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col += vec3(0.25, 0.5, 1.0) * rim * smoothstep(-0.3, 0.4, ndl) * uSunIlluminance * 0.25;
  float a = smoothstep(0.0, 1.0, uNight) * 0.98;
  gl_FragColor = vec4(col * T, a);
}
`;

// -------------------------------------------------- Tether (screen-space line) --
const LINE_VERT = /* glsl */ `
attribute vec3 aNext;
attribute float aSide;
attribute float aAlt;
uniform float uWidthKm;
uniform float uMinPx;
uniform vec2 uResolution;
varying float vAlt;
varying float vCoverage;
varying vec3 vWorld;
void main() {
  vAlt = aAlt;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec4 wn = modelMatrix * vec4(aNext, 1.0);
  vWorld = w.xyz;
  vec4 c0 = projectionMatrix * viewMatrix * w;
  vec4 c1 = projectionMatrix * viewMatrix * wn;
  vec2 s0 = c0.xy / c0.w * uResolution * 0.5;
  vec2 s1 = c1.xy / c1.w * uResolution * 0.5;
  vec2 dir = normalize(s1 - s0 + 1e-6);
  vec2 perp = vec2(-dir.y, dir.x);
  float dist = length(w.xyz - cameraPosition);
  float pxPerKm = uResolution.y * 0.5 * projectionMatrix[1][1] / dist;
  float wpx = uWidthKm * pxPerKm;
  float px = max(wpx, uMinPx);
  vCoverage = clamp(wpx / px, 0.0, 1.0);
  c0.xy += perp * aSide * px / uResolution * c0.w;
  gl_Position = c0;
}
`;
const LINE_FRAG = /* glsl */ `
${THROUGH_ATMO}
${NOISE_GLSL}
uniform float uFadeStart;
varying float vAlt;
varying float vCoverage;
varying vec3 vWorld;
void main() {
  float occ;
  vec3 T = viewTransmittance(vWorld, occ);
  vec3 pPlanet = vWorld + vec3(0.0, Rg, 0.0);
  vec3 sunL = sunlightAt(pPlanet) * uSunIlluminance;
  vec3 col = vec3(0.7, 0.72, 0.75) * sunL * 0.25 + vec3(0.02, 0.03, 0.05);
  // beacons + climbers (bright pulses travelling up and down)
  float beacon = step(0.9, fract(vAlt / 12.0)) * (0.6 + 0.4 * sin(uTime * 3.0 + vAlt));
  float up = pow(fract(vAlt / 220.0 - uTime * 0.02), 60.0);
  float dn = pow(fract(vAlt / 310.0 + uTime * 0.013 + 0.5), 60.0);
  col += vec3(1.0, 0.8, 0.5) * beacon * 0.8 + vec3(0.7, 0.9, 1.0) * (up + dn) * 30.0;
  col += vec3(0.5, 0.75, 1.0) * 0.5 * uNight;
  float fadeIn = smoothstep(uFadeStart, uFadeStart + 10.0, vAlt);
  float fadeOut = 1.0 - smoothstep(4000.0, 40000.0, vAlt) * 0.7;
  float a = vCoverage * fadeIn * fadeOut;
  gl_FragColor = vec4(col * T * a, 0.0);
}
`;

function buildLineGeometry(points) {
  const pos = [], next = [], side = [], alt = [], idx = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[Math.min(i + 1, points.length - 1)];
    const qq = i === points.length - 1 ? [p[0] * 2 - points[i - 1][0], p[1] * 2 - points[i - 1][1], p[2] * 2 - points[i - 1][2]] : q;
    for (const s of [-1, 1]) {
      pos.push(...p); next.push(...qq); side.push(s); alt.push(p[1]);
    }
    if (i < points.length - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aNext', new THREE.Float32BufferAttribute(next, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('aAlt', new THREE.Float32BufferAttribute(alt, 1));
  g.setIndex(idx);
  return g;
}

// --------------------------------------------------------- Sky scene setup --
export class Celestial {
  constructor() {
    this.group = new THREE.Group();
    this.rings = RINGS.map(createRing);
    this.rings.forEach((r) => this.group.add(r));

    // Moon (radius exaggerated x1.6 for presence)
    const moonGeo = new THREE.SphereGeometry(1, 96, 48);
    this.moonMat = new THREE.ShaderMaterial({
      vertexShader: MOON_VERT, fragmentShader: MOON_FRAG,
      uniforms: { uTransmittanceLUT: U.uTransmittanceLUT, uSunDir: U.uSunDir, uSunIlluminance: U.uSunIlluminance, uNight: U.uNight, uTime: U.uTime },
      transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, depthWrite: false,
    });
    this.moon = new THREE.Mesh(moonGeo, this.moonMat);
    this.moon.scale.setScalar(1737 * 1.6);
    this.moon.frustumCulled = false;
    this.moon.renderOrder = 5;
    this.moonDistance = 384400;
    this.group.add(this.moon);

    // Space-elevator tether: from 30 km to beyond geostationary orbit
    const pts = [];
    const alts = [];
    for (let a = 30; a < 800; a += 5) alts.push(a);
    for (let a = 800; a < 100000; a *= 1.04) alts.push(a);
    for (const a of alts) pts.push([0, a, 0]);
    this.tetherMat = new THREE.ShaderMaterial({
      vertexShader: LINE_VERT, fragmentShader: LINE_FRAG,
      uniforms: {
        uTransmittanceLUT: U.uTransmittanceLUT, uSunDir: U.uSunDir, uSunIlluminance: U.uSunIlluminance, uNight: U.uNight, uTime: U.uTime,
        uWidthKm: { value: 0.024 }, uMinPx: { value: 1.3 }, uResolution: { value: new THREE.Vector2(1920, 1080) }, uFadeStart: { value: 34 },
      },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.tether = new THREE.Mesh(buildLineGeometry(pts), this.tetherMat);
    this.tether.frustumCulled = false;
    this.tether.renderOrder = 20;
    this.group.add(this.tether);

    // Geostationary harbour + counterweight: bright points
    this.stationMat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, color: new THREE.Color(1.0, 0.92, 0.8).multiplyScalar(6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 35786, 0, 0, 36200, 0, 0, 99000, 0, 0, 620, 0], 3));
    this.stations = new THREE.Points(sg, this.stationMat);
    this.stations.frustumCulled = false;
    this.group.add(this.stations);
  }

  setResolution(w, h) { this.tetherMat.uniforms.uResolution.value.set(w, h); }

  update(camKm, moonDir) {
    this.moon.position.copy(camKm).addScaledVector(moonDir, this.moonDistance);
    // tidally locked: keep the same hemisphere facing the planet
    this.moon.lookAt(camKm);
  }
}
