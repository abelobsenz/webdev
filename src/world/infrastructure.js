import * as THREE from 'three';
import { latheFacade, sweepTube, mergeClean } from './geom.js';
import { createFacadeMaterial } from './facade.js';
import { CENTRAL_ISLAND, ISLANDS, GATE, SKYPORT } from './layout.js';
import { mulberry32 } from './noise.js';
import { U } from '../core/uniforms.js';

const TAU = Math.PI * 2;

/** Extrude a 2D cross-section (in side/up coordinates) along a path with a world-up frame. */
function extrudeAlong(path, section, kindFn) {
  const pos = [], fac = [], idx = [];
  const n = section.length;
  let len = 0;
  const up = new THREE.Vector3(0, 1, 0);
  for (let j = 0; j < path.length; j++) {
    const a = path[Math.max(j - 1, 0)], b = path[Math.min(j + 1, path.length - 1)];
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    const side = new THREE.Vector3().crossVectors(t, up).normalize();
    const u2 = new THREE.Vector3().crossVectors(side, t).normalize();
    if (j > 0) len += path[j].distanceTo(path[j - 1]);
    let per = 0;
    for (let i = 0; i <= n; i++) {
      const s = section[i % n];
      if (i > 0) { const q = section[i - 1]; per += Math.hypot(s[0] - q[0], s[1] - q[1]); }
      const p = path[j];
      pos.push(p.x + side.x * s[0] + u2.x * s[1], p.y + side.y * s[0] + u2.y * s[1], p.z + side.z * s[0] + u2.z * s[1]);
      fac.push(len, per, kindFn ? kindFn(i % n) : 1);
    }
  }
  const cols = n + 1;
  for (let j = 0; j < path.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------ promenades --
function buildPromenades(groundHeight) {
  const parts = [];
  const paths = [];
  const deckSection = [[-14, 0], [-14.5, 1.2], [-13.6, 1.4], [-13, 0.2], [13, 0.2], [13.6, 1.4], [14.5, 1.2], [14, 0], [11, -3.2], [-11, -3.2]].reverse();
  for (const isl of ISLANDS) {
    const dir = new THREE.Vector2(isl.x - CENTRAL_ISLAND.x, isl.z - CENTRAL_ISLAND.z);
    const dist = dir.length();
    dir.normalize();
    const start = CENTRAL_ISLAND.r * 0.78, end = dist - isl.r * 0.72;
    const perp = new THREE.Vector2(-dir.y, dir.x);
    const path = [];
    const N = 90;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const d = start + (end - start) * t;
      const sway = Math.sin(t * Math.PI * 2) * 80;
      const x = dir.x * d + perp.x * sway, z = dir.y * d + perp.y * sway;
      const g0 = groundHeight(x, z);
      const y = Math.max(g0 + 3, 18 + 26 * Math.sin(Math.PI * t));
      path.push(new THREE.Vector3(x, y, z));
    }
    paths.push(path);
    parts.push(extrudeAlong(path, deckSection, (i) => (i === 5 || i === 6 ? 3 : (i === 3 || i === 4 || i === 7 || i === 8) ? 2 : 1)));
    // transit tube along the outer edge
    parts.push(sweepTube(path.map((p, i) => {
      const a = path[Math.max(i - 1, 0)], b = path[Math.min(i + 1, path.length - 1)];
      const t = new THREE.Vector3().subVectors(b, a).normalize();
      const side = new THREE.Vector3(-t.z, 0, t.x).normalize();
      return p.clone().addScaledVector(side, 17).add(new THREE.Vector3(0, 2.5, 0));
    }), () => 3.0, 10, { kind: 4 }));
    // piers with lotus capitals
    for (let k = 6; k < N - 3; k += 9) {
      const p = path[k];
      const base = groundHeight(p.x, p.z);
      if (base > p.y - 8) continue;
      const pier = latheFacade([
        { r: 7, y: -14, kind: 1 }, { r: 5.5, y: base + 0, kind: 1 }, { r: 3.6, y: p.y * 0.6, kind: 1 },
        { r: 5, y: p.y - 7, kind: 1 }, { r: 12, y: p.y - 3.4, kind: 1 },
      ].map((q) => ({ ...q, y: Math.max(q.y, -14) })), 16);
      pier.translate(p.x, 0, p.z);
      parts.push(pier);
    }
  }
  return { geo: mergeClean(parts), paths };
}

// ----------------------------------------------------------------- Gate --
function buildGate() {
  const parts = [];
  const { span, height } = GATE;
  const half = span / 2;
  for (const lean of [-0.2, 0.2]) {
    const pts = [];
    const N = 120;
    const k = 2.2;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = -half + span * u;
      const c = Math.cosh(k * (x / half));
      const y = height * (Math.cosh(k) - c) / (Math.cosh(k) - 1);
      // lean the arch out of plane; both arches meet at the base points
      const z = Math.sin(lean) * y;
      pts.push(new THREE.Vector3(x, y * Math.cos(lean) - 8, z));
    }
    parts.push(sweepTube(pts, (u) => { const m = Math.abs(u - 0.5) * 2; return 16 + 26 * Math.pow(m, 1.6); }, 20, { kind: 0, ellipse: 0.8 }));
    // luminous spine along the intrados
    parts.push(sweepTube(pts.map((p) => p.clone().add(new THREE.Vector3(0, -2, 0))), (u) => 3 + 2 * Math.abs(u - 0.5), 8, { kind: 4 }));
  }
  // keystone ring suspended at the apex
  const pts = [];
  for (let i = 0; i <= 96; i++) { const a = (i / 96) * TAU; pts.push(new THREE.Vector3(Math.cos(a) * 70, Math.sin(a) * 70, 0)); }
  const ring = sweepTube(pts, () => 5, 10, { kind: 2 });
  ring.translate(0, height * 0.93 - 90, 0);
  parts.push(ring);
  // foundations
  for (const sx of [-1, 1]) {
    const f = latheFacade([{ r: 95, y: -12, kind: 1 }, { r: 90, y: 6, kind: 1 }, { r: 70, y: 12, kind: 3 }, { r: 0.1, y: 13, kind: 3 }], 48);
    f.translate(sx * half, 0, 0);
    parts.push(f);
  }
  const g = mergeClean(parts);
  g.translate(GATE.x, 0, GATE.z);
  return g;
}

// -------------------------------------------------------- lotus platforms --
function buildLotusPads(groundHeight, promenadePaths) {
  const rnd = mulberry32(555);
  const parts = [];
  const pads = [];
  let tries = 0;
  while (pads.length < 34 && tries < 3000) {
    tries++;
    const a = rnd() * TAU, r = 1200 + rnd() * 3800;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const pr = 36 + rnd() * 70;
    if (groundHeight(x, z) > -3) continue;
    let ok = true;
    for (const p of pads) if (Math.hypot(p.x - x, p.z - z) < p.r + pr + 60) ok = false;
    for (const path of promenadePaths) for (let k = 0; k < path.length; k += 3) if (Math.hypot(path[k].x - x, path[k].z - z) < pr + 40) { ok = false; break; }
    if (!ok) continue;
    pads.push({ x, z, r: pr });
    const petals = 8 + Math.floor(rnd() * 6);
    const prof = [
      { r: pr * 0.95, y: -2, kind: 1 }, { r: pr * 1.02, y: 1.8, kind: 1 }, { r: pr, y: 2.6, kind: 2 }, { r: pr * 0.94, y: 3.0, kind: 1 },
      { r: pr * 0.9, y: 3.2, kind: 3 }, { r: 0.1, y: 3.4, kind: 3 },
    ];
    const pad = latheFacade(prof, 64);
    // scalloped rim: petals
    const pp = pad.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const px = pp.getX(i), pz = pp.getZ(i);
      const ang = Math.atan2(pz, px);
      const k = 1 + 0.06 * Math.cos(ang * petals);
      pp.setXYZ(i, px * k, pp.getY(i), pz * k);
    }
    pad.computeVertexNormals();
    pad.translate(x, 0, z);
    parts.push(pad);
    // pavilion: dome or pagoda-like spire
    if (rnd() < 0.6) {
      const h = 12 + rnd() * 16;
      const dome = latheFacade([
        { r: pr * 0.32, y: 3, kind: 0 }, { r: pr * 0.32, y: h * 0.5, kind: 0 }, { r: pr * 0.36, y: h * 0.55, kind: 2 },
        { r: pr * 0.3, y: h * 0.75, kind: 0 }, { r: pr * 0.18, y: h * 0.95, kind: 0 }, { r: 0.3, y: h * 1.05, kind: 1 },
      ], 32);
      dome.translate(x + (rnd() - 0.5) * pr * 0.3, 0, z + (rnd() - 0.5) * pr * 0.3);
      parts.push(dome);
    }
  }
  return { geo: mergeClean(parts), pads };
}

// ------------------------------------------------------------- skyport ----
function buildSkyport() {
  const parts = [];
  const R = SKYPORT.r;
  // main landing ring (lens-profile torus)
  const ringPts = [];
  for (let i = 0; i <= 256; i++) { const a = (i / 256) * TAU; ringPts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)); }
  parts.push(sweepTube(ringPts, () => 26, 16, { kind: 0, ellipse: 0.45 }));
  parts.push(sweepTube(ringPts.map((p) => p.clone().multiplyScalar(0.9).add(new THREE.Vector3(0, 10, 0))), () => 4, 8, { kind: 2 }));
  // spokes to the hub
  for (let s = 0; s < 6; s++) {
    const a = (s / 6) * TAU;
    const pts = [];
    for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push(new THREE.Vector3(Math.cos(a) * R * t, -30 * Math.sin(Math.PI * t) - 10 * t, Math.sin(a) * R * t)); }
    parts.push(sweepTube(pts, (t) => 7 - 3 * t, 8, { kind: 1 }));
  }
  // hub: stacked lenses with a docking spire
  parts.push(latheFacade([
    { r: 0.1, y: -140, kind: 1 }, { r: 20, y: -110, kind: 1 }, { r: 60, y: -40, kind: 0 }, { r: 90, y: -12, kind: 0 }, { r: 96, y: 0, kind: 2 },
    { r: 86, y: 14, kind: 0 }, { r: 50, y: 30, kind: 3 }, { r: 18, y: 40, kind: 1 }, { r: 10, y: 150, kind: 4 }, { r: 0.5, y: 190, kind: 1 },
  ], 64));
  // upper halo ring and short docking clamps; ships berth tangentially along the rim
  const upper = [];
  for (let i = 0; i <= 192; i++) { const a = (i / 192) * TAU; upper.push(new THREE.Vector3(Math.cos(a) * R * 0.62, 70, Math.sin(a) * R * 0.62)); }
  parts.push(sweepTube(upper, () => 12, 12, { kind: 0, ellipse: 0.5 }));
  for (let s = 0; s < 6; s++) {
    const a = (s / 6) * TAU + TAU / 12;
    const pts = [];
    for (let k = 0; k <= 10; k++) { const t = k / 10; const rr = R * 0.62 + (R - R * 0.62) * t; pts.push(new THREE.Vector3(Math.cos(a) * rr, 70 * (1 - t) + 8 * Math.sin(Math.PI * t) * 0, Math.sin(a) * rr)); }
    parts.push(sweepTube(pts, () => 4, 8, { kind: 1 }));
  }
  const berths = [];
  for (let s = 0; s < 10; s++) {
    const a = (s / 10) * TAU + 0.3;
    for (let k = 0; k <= 4; k++) {
      const pts = [new THREE.Vector3(Math.cos(a) * (R + 10), -6, Math.sin(a) * (R + 10)), new THREE.Vector3(Math.cos(a) * (R + 38), -10, Math.sin(a) * (R + 38))];
      if (k === 0) parts.push(sweepTube(pts, () => 3, 6, { kind: 1 }));
    }
    berths.push({ p: new THREE.Vector3(Math.cos(a) * (R + 52), -12, Math.sin(a) * (R + 52)), a });
  }
  const g = mergeClean(parts);
  return { geo: g, berths };
}

// Elegant starship hull (used for docked and travelling ships)
export function shipGeometry(len = 1) {
  const prof = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const r = 0.11 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.8) * (1 + 0.25 * Math.exp(-Math.pow((t - 0.75) / 0.08, 2)));
    prof.push({ r: r + 0.002, y: t - 0.5, kind: t > 0.72 && t < 0.8 ? 2 : t < 0.08 ? 4 : 0 });
  }
  const g = latheFacade(prof, 24, { sx: 1, sz: 0.55 });
  // fins
  const fin = latheFacade([{ r: 0.001, y: -0.5 }, { r: 0.2, y: -0.35 }, { r: 0.12, y: -0.1 }, { r: 0.001, y: 0.05 }].map((p) => ({ ...p, kind: 1 })), 3, { sx: 1, sz: 0.04 });
  const m = mergeClean([g, fin]);
  m.rotateX(Math.PI / 2); // length along +Z
  m.scale(len, len, len);
  return m;
}

// ------------------------------------------------------------- beacons ----
export function createBeacons(points) {
  const n = points.length / 3;
  const seeds = new Float32Array(n);
  for (let i = 0; i < n; i++) seeds[i] = Math.random();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uCityLights: U.uCityLights, uNight: U.uNight },
    vertexShader: /* glsl */ `
attribute float aSeed; uniform float uTime; varying float vI; varying float vRed;
void main() {
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float blink = step(0.82, fract(uTime * 0.55 + aSeed));
  vRed = step(0.35, aSeed);
  vI = blink;
  gl_PointSize = clamp(9000.0 / -mv.z, 2.0, 14.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uCityLights; uniform float uNight; varying float vI; varying float vRed;
void main() {
  vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard;
  float core = exp(-d * 6.0);
  vec3 col = mix(vec3(1.0, 0.95, 0.9), vec3(1.0, 0.15, 0.08), vRed);
  gl_FragColor = vec4(col * core * vI * (0.6 + 3.0 * uNight), 1.0);
}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

export function buildInfrastructure(scene, groundHeight, rawHeight) {
  const mat = createFacadeMaterial('pearl', 400, { litFrac: 0.6 });
  const prom = buildPromenades(groundHeight);
  const promMesh = new THREE.Mesh(prom.geo, mat);
  promMesh.castShadow = true; promMesh.receiveShadow = true;
  scene.add(promMesh);

  const gateMat = createFacadeMaterial('silver', 401, { litFrac: 0.5, band: 160 });
  const gate = new THREE.Mesh(buildGate(), gateMat);
  gate.castShadow = true; gate.receiveShadow = true;
  gate.name = 'Gate of Concord';
  scene.add(gate);

  const lotus = buildLotusPads(rawHeight, prom.paths);
  const lotusMesh = new THREE.Mesh(lotus.geo, createFacadeMaterial('jade', 402, { litFrac: 0.7 }));
  lotusMesh.castShadow = true; lotusMesh.receiveShadow = true;
  scene.add(lotusMesh);

  const sp = buildSkyport();
  const skyport = new THREE.Mesh(sp.geo, createFacadeMaterial('silver', 403, { litFrac: 0.75 }));
  skyport.position.set(SKYPORT.x, SKYPORT.y, SKYPORT.z);
  skyport.castShadow = true; skyport.receiveShadow = true;
  scene.add(skyport);
  // docked ships
  const shipMat = createFacadeMaterial('pearl', 404, { litFrac: 0.8 });
  const docked = new THREE.InstancedMesh(shipGeometry(1), shipMat, sp.berths.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  sp.berths.forEach((b, i) => {
    const len = 90 + (i % 3) * 45;
    // tangential: ship's +Z along the ring direction (-sin a, 0, cos a)
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -b.a);
    m4.compose(b.p.clone().add(new THREE.Vector3(SKYPORT.x, SKYPORT.y, SKYPORT.z)), q, new THREE.Vector3(len, len, len));
    docked.setMatrixAt(i, m4);
  });
  docked.castShadow = true;
  scene.add(docked);

  const colliders = [
    { x: SKYPORT.x, z: SKYPORT.z, y0: SKYPORT.y - 150, y1: SKYPORT.y + 200, radius: 100 },
  ];
  const beacons = [];
  beacons.push(GATE.x, GATE.height - 4, GATE.z, GATE.x - GATE.span / 2, 20, GATE.z, GATE.x + GATE.span / 2, 20, GATE.z);
  beacons.push(SKYPORT.x, SKYPORT.y + 192, SKYPORT.z);
  for (let s = 0; s < 12; s++) { const a = (s / 12) * TAU; beacons.push(SKYPORT.x + Math.cos(a) * SKYPORT.r, SKYPORT.y + 14, SKYPORT.z + Math.sin(a) * SKYPORT.r); }
  return { promenades: prom.paths, pads: lotus.pads, colliders, beacons, berths: sp.berths };
}
