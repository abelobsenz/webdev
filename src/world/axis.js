import * as THREE from 'three';
import { latheFacade, sweepTube, mergeClean } from './geom.js';
import { createFacadeMaterial } from './facade.js';
import { patchedMaterial, aerialShaderMaterial, FACADE_GLSL } from './materials.js';
import { PLAZA_Y, PLAZA_R } from './layout.js';
import { buildPlaza } from './plaza.js';
import { U } from '../core/uniforms.js';

const TAU = Math.PI * 2;

// Hyperboloid lattice parameters (straight rulings between two circles)
export const AXIS = {
  latticeBase: 330, latticeTop: 132, latticeY0: 560, latticeY1: 2820, twist: THREE.MathUtils.degToRad(104),
  coreBase: 74, coreTop: 46, crownY: 3060, anchorY: 3140, height: 3200,
};

/** Radius of the hyperboloid lattice at height y. */
export function latticeRadius(y) {
  const { latticeBase: rb, latticeTop: rt, latticeY0: y0, latticeY1: y1, twist } = AXIS;
  const v = THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1);
  const ax = rb + (Math.cos(twist) * rt - rb) * v, az = Math.sin(twist) * rt * v;
  return Math.hypot(ax, az);
}

export function coreRadius(y) {
  const v = THREE.MathUtils.clamp(y / AXIS.crownY, 0, 1);
  return AXIS.coreBase + (AXIS.coreTop - AXIS.coreBase) * Math.pow(v, 0.8);
}

// Additive glow shell (tether halo, crown aura)
function glowMaterial(color, strength, { fresnelPow = 2.0, nightOnly = 0.7 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uCityLights: U.uCityLights, uTime: U.uTime, uNightOnly: { value: nightOnly }, uPow: { value: fresnelPow } },
    vertexShader: /* glsl */ `
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  vY = w.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor; uniform float uStrength; uniform float uCityLights; uniform float uTime; uniform float uNightOnly; uniform float uPow;
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  float f = pow(abs(dot(normalize(vN), normalize(vV))), uPow);
  float pulse = 0.85 + 0.15 * sin(vY * 0.004 - uTime * 1.5);
  float k = mix(1.0, uCityLights, uNightOnly);
  gl_FragColor = vec4(uColor * f * uStrength * k * pulse, 1.0);
}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}

export function buildAxis(scene, updaters) {
  const group = new THREE.Group();
  group.name = 'The Axis';
  scene.add(group);

  // ------------------------------------------------ structure material ------
  const boneMat = createFacadeMaterial('pearl', 101, { litFrac: 0.6 });
  const coreMat = createFacadeMaterial('silver', 102, { litFrac: 0.7, band: 128 });
  const parts = [];

  // --------------------------------------------------------- root arches ----
  const legs = 8;
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * TAU + TAU / 16;
    const pts = [];
    const topR = latticeRadius(AXIS.latticeY0) * 0.98;
    for (let k = 0; k <= 40; k++) {
      const u = k / 40;
      // outward-bowing root: starts wide on the plaza, sweeps up and in to the lattice base
      const r = THREE.MathUtils.lerp(505, topR, Math.pow(u, 0.8)) + 120 * Math.sin(Math.PI * u) * (1 - u);
      const y = PLAZA_Y - 4 + (AXIS.latticeY0 + 20 - PLAZA_Y) * (1 - Math.pow(1 - u, 1.7));
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    parts.push(sweepTube(pts, (u) => 36 - 16 * u + 12 * Math.exp(-u * 14), 20, { kind: 1, ellipse: 0.72 }));
    // secondary tendrils
    for (const off of [-0.09, 0.09]) {
      const p2 = [];
      for (let k = 0; k <= 30; k++) {
        const u = k / 30;
        const aa = a + off * (1 - u);
        const r = THREE.MathUtils.lerp(535, topR * 1.02, Math.pow(u, 0.9)) + 60 * Math.sin(Math.PI * u) * (1 - u);
        const y = PLAZA_Y - 2 + (AXIS.latticeY0 * 0.7 - PLAZA_Y) * (1 - Math.pow(1 - u, 2.0));
        p2.push(new THREE.Vector3(Math.cos(aa) * r, y, Math.sin(aa) * r));
      }
      parts.push(sweepTube(p2, (u) => 9 - 4 * u, 10, { kind: 1 }));
    }
  }

  // ------------------------------------------------------ lattice struts ----
  const N = 52;
  const { latticeBase: rb, latticeTop: rt, latticeY0: y0, latticeY1: y1, twist } = AXIS;
  for (let fam = -1; fam <= 1; fam += 2) {
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU;
      const a1 = a0 + fam * twist;
      const p0 = new THREE.Vector3(Math.cos(a0) * rb, y0, Math.sin(a0) * rb);
      const p1 = new THREE.Vector3(Math.cos(a1) * rt, y1, Math.sin(a1) * rt);
      const pts = [];
      for (let k = 0; k <= 16; k++) pts.push(p0.clone().lerp(p1, k / 16));
      parts.push(sweepTube(pts, (u) => 5.4 - 1.8 * u, 8, { kind: 1 }));
    }
  }
  // three luminous helices wind up the lattice: the elevator's power conduits
  for (let h = 0; h < 3; h++) {
    const pts = [];
    for (let k = 0; k <= 400; k++) {
      const u = k / 400;
      const y = y0 + 40 + u * (y1 - y0 - 60);
      const a = (h / 3) * TAU + u * TAU * 2.25;
      const r = latticeRadius(y) + 16;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    parts.push(sweepTube(pts, () => 3.4, 8, { kind: 4 }));
  }
  // hoops
  const hoopHeights = [];
  for (let y = y0 + 200; y < y1; y += 250) hoopHeights.push(y);
  for (const y of hoopHeights) {
    const r = latticeRadius(y);
    const pts = [];
    for (let k = 0; k <= 160; k++) { const a = (k / 160) * TAU; pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); }
    parts.push(sweepTube(pts, () => 3.2, 8, { kind: 2 }));
  }

  // --------------------------------------------------------- sky decks ------
  const deck = (y, rOuter, thick, kindRim = 2) => latheFacade([
    { r: coreRadius(y) * 0.9, y: y - thick * 0.9, kind: 1 },
    { r: rOuter * 0.72, y: y - thick * 0.75, kind: 1 },
    { r: rOuter * 0.96, y: y - thick * 0.28, kind: 0 },
    { r: rOuter, y: y, kind: kindRim },
    { r: rOuter * 0.985, y: y + thick * 0.18, kind: 0 },
    { r: rOuter * 0.93, y: y + thick * 0.24, kind: 3 },
    { r: coreRadius(y) * 0.9, y: y + thick * 0.26, kind: 3 },
  ], 128);
  const decks = [
    { y: AXIS.latticeY0 + 20, r: latticeRadius(AXIS.latticeY0 + 20) + 26, t: 46, name: 'Root Deck' },
    { y: 1260, r: latticeRadius(1260) + 16, t: 34, name: 'Garden Deck' },
    { y: 2180, r: latticeRadius(2180) + 38, t: 30, name: 'The Collar' },
    { y: AXIS.latticeY1 + 10, r: latticeRadius(AXIS.latticeY1) + 22, t: 40, name: 'Coronet' },
  ];
  for (const d of decks) parts.push(deck(d.y, d.r, d.t));

  const structure = new THREE.Mesh(mergeClean(parts), boneMat);
  structure.castShadow = true;
  structure.receiveShadow = true;
  group.add(structure);

  // ---------------------------------------------------------- plaza --------
  // the Commons (plaza.js): built after the roots, whose footprints it cuts the pools around
  buildPlaza(group);

  // --------------------------------------------------------------- core -----
  const coreProf = [];
  for (let j = 0; j <= 120; j++) {
    const y = PLAZA_Y - 2 + (j / 120) * (AXIS.crownY - PLAZA_Y);
    let r = coreRadius(y);
    // bulges where decks attach
    for (const d of decks) r += 8 * Math.exp(-Math.pow((y - d.y) / 30, 2));
    coreProf.push({ r, y, kind: j % 12 === 0 ? 4 : 0 });
  }
  coreProf.push({ r: AXIS.coreTop * 0.8, y: AXIS.crownY + 20, kind: 1 });
  coreProf.push({ r: 12, y: AXIS.crownY + 60, kind: 4 });
  coreProf.push({ r: 8, y: AXIS.anchorY, kind: 4 });
  const core = new THREE.Mesh(latheFacade(coreProf, 96), coreMat);
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  // ------------------------------------------------------------ crown -------
  const crown = new THREE.Group();
  crown.position.y = AXIS.crownY + 60;
  group.add(crown);
  const gyroMat = createFacadeMaterial('pearl', 103, { litFrac: 0.8 });
  const gyros = [];
  const ringDefs = [{ r: 250, tube: 11, tilt: 0.0 }, { r: 205, tube: 8, tilt: 0.42 }, { r: 165, tube: 7, tilt: -0.55 }];
  for (const rd of ringDefs) {
    const pts = [];
    for (let k = 0; k <= 200; k++) { const a = (k / 200) * TAU; pts.push(new THREE.Vector3(Math.cos(a) * rd.r, 0, Math.sin(a) * rd.r)); }
    const g = mergeClean([
      sweepTube(pts, () => rd.tube, 12, { kind: 1 }),
      sweepTube(pts.map((p) => p.clone().multiplyScalar(1 - (rd.tube * 1.1) / rd.r)), () => rd.tube * 0.35, 8, { kind: 2 }),
    ]);
    const m = new THREE.Mesh(g, gyroMat);
    m.castShadow = true;
    const holder = new THREE.Group();
    holder.rotation.x = rd.tilt;
    holder.add(m);
    crown.add(holder);
    gyros.push({ holder, mesh: m, speed: 0.02 + Math.abs(rd.tilt) * 0.05, tilt: rd.tilt });
  }
  // anchor node where the tether meets the tower
  const node = new THREE.Mesh(latheFacade([
    { r: 0.1, y: -40, kind: 1 }, { r: 42, y: -18, kind: 1 }, { r: 58, y: 0, kind: 2 }, { r: 42, y: 22, kind: 0 }, { r: 10, y: 60, kind: 4 }, { r: 6, y: 95, kind: 4 },
  ], 48), gyroMat);
  node.position.y = AXIS.anchorY - crown.position.y;
  crown.add(node);

  // --------------------------------------------------- tether & climbers ---
  const tetherTop = 45000;
  const tetherGeo = new THREE.CylinderGeometry(3.5, 6, tetherTop - AXIS.anchorY, 12, 1, true);
  tetherGeo.translate(0, (tetherTop + AXIS.anchorY) / 2, 0);
  // The tether seen from the city: a dark braided nanotube ribbon with four polished climber
  // tracks, white collars every 400 m, guide lights racing up the tracks at night, red and
  // white beacons, lit by the real sun and hazed by the same aerial perspective as the city.
  const tetherMat = aerialShaderMaterial({
    vertexShader: /* glsl */ `
varying float vY; varying vec3 vN; varying vec3 vW; varying float vA;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vY = w.y; vA = atan(position.z, position.x); vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
varying float vY; varying vec3 vN; varying vec3 vW; varying float vA;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float fw = max(length(fwidth(vW)), 1e-3);            // metres per pixel
  float rad = mix(6.0, 3.5, clamp((vY - 3140.0) / 41860.0, 0.0, 1.0));
  float q = fract(vA / 6.28318 * 4.0 + 0.5);
  float dq = abs(q - 0.5) * 6.28318 * rad / 4.0;         // metres from the nearest track's centre
  float track = 1.0 - smoothstep(0.9 - fw, 0.9 + fw, dq);
  float led = 1.0 - smoothstep(0.07, 0.07 + fw, dq);
  float cy = abs(mod(vY + 200.0, 400.0) - 200.0);
  float collar = 1.0 - smoothstep(1.2, 1.2 + fw, cy);
  float sd = 1.0 - smoothstep(0.03, 0.2, fw);
  float strand = vnoise(vec2(vA * rad * 5.0 + vY * 0.3, vY * 0.015)) * 0.6 + vnoise(vec2(vA * rad * 17.0 - vY * 0.8, vY * 0.05)) * 0.4;
  vec3 alb = vec3(0.1, 0.105, 0.115) * mix(1.0, 0.75 + 0.5 * strand, sd);
  alb = mix(alb, vec3(0.55, 0.57, 0.6), track);
  alb = mix(alb, vec3(0.82, 0.82, 0.8), collar);
  float metal = track * (1.0 - collar);
  vec3 sunC = uSunColor * uSunIlluminance;
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 H = normalize(V + uSunDir);
  float spec = pow(max(dot(N, H), 0.0), mix(30.0, 220.0, metal)) * mix(0.25, 3.0, metal);
  vec3 F0 = mix(vec3(0.04), alb, metal);
  vec3 col = alb * (1.0 - 0.8 * metal) / 3.14159 * (sunC * ndl + aerialInscatter(vec3(0.0, 1.0, 0.0)) * 1.2);
  col += F0 * spec * sunC * ndl;
  col += F0 * aerialInscatter(reflect(-V, N)) * (0.3 + 0.7 * metal);
  // guide lights race up the tracks; beacons every 120 m
  float lights = uCityLights;
  float pulse = pow(fract(vY / 2400.0 - uTime * 0.12), 14.0);
  col += vec3(0.55, 0.85, 1.0) * led * (0.04 + 0.5 * lights) * (0.3 + 3.0 * pulse);
  float beacon = step(0.985, fract(vY / 120.0)) * (0.6 + 0.4 * sin(uTime * 4.0));
  col += mix(vec3(1.0, 0.18, 0.1), vec3(1.0, 0.85, 0.6), step(0.5, fract(vY / 240.0))) * beacon * (1.0 + 3.0 * lights) * (1.0 - track);
  col = applyAerial(col, vW);
  float fade = 1.0 - smoothstep(34000.0, 44000.0, vY);
  gl_FragColor = vec4(col * fade, fade);
}`,
    transparent: true,
  });
  const tether = new THREE.Mesh(tetherGeo, tetherMat);
  tether.frustumCulled = false;
  group.add(tether);
  const halo = new THREE.Mesh(new THREE.CylinderGeometry(40, 60, tetherTop - AXIS.anchorY, 16, 1, true).translate(0, (tetherTop + AXIS.anchorY) / 2, 0), glowMaterial(0x6fb4ff, 0.07, { fresnelPow: 3.0, nightOnly: 0.97 }));
  halo.frustumCulled = false;
  group.add(halo);

  // climber pods: capsules riding the tether
  const podGeo = mergeClean([
    latheFacade([{ r: 0.1, y: -34, kind: 1 }, { r: 10, y: -26, kind: 1 }, { r: 14, y: -8, kind: 0 }, { r: 14, y: 8, kind: 2 }, { r: 10, y: 26, kind: 0 }, { r: 0.1, y: 34, kind: 1 }], 24),
  ]);
  const pods = [];
  const podMat = createFacadeMaterial('silver', 104, { litFrac: 0.9, band: 1e5, colW: 2.6, floorH: 3.4 });
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(podGeo, podMat);
    m.castShadow = true;
    group.add(m);
    const light = new THREE.Mesh(new THREE.SphereGeometry(22, 12, 8), glowMaterial(i % 2 ? 0xffc890 : 0x9fd4ff, 1.2, { fresnelPow: 1.5, nightOnly: 0.3 }));
    m.add(light);
    pods.push({ mesh: m, phase: i / 7, dir: i % 2 ? -1 : 1, speed: 0.012 + (i % 3) * 0.002 });
  }

  // ----------------------------------------------------------- beacons ----
  const beaconPts = [];
  for (const d of decks) for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; beaconPts.push(Math.cos(a) * d.r, d.y + 2, Math.sin(a) * d.r); }
  for (const rd of ringDefs) { /* crown lights handled by lantern kind */ }
  beaconPts.push(0, AXIS.anchorY + 100, 0);

  updaters.push({
    update(dt, t) {
      for (const g of gyros) {
        g.holder.rotation.y += dt * g.speed;
        g.mesh.rotation.y -= dt * g.speed * 0.6;
      }
      for (const p of pods) {
        // travel up/down between the anchor and 40 km with smooth easing near the ends
        const s = (p.phase + t * p.speed * p.dir) % 1;
        const u = s < 0 ? s + 1 : s;
        const y = AXIS.anchorY + 120 + Math.pow(u, 2.2) * 38000;
        p.mesh.position.set(0, y, 0);
      }
    },
  });

  const colliders = [
    { x: 0, z: 0, y0: 0, y1: AXIS.crownY + 100, radius: (y) => coreRadius(y) + 10 },
    { x: 0, z: 0, y0: AXIS.crownY - 60, y1: AXIS.crownY + 200, radius: 70 },
  ];
  return { group, decks, colliders, beacons: beaconPts, reflectHide: [halo, tether] };
}
