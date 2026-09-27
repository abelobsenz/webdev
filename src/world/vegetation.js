import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchedMaterial } from './materials.js';
import { mulberry32 } from './noise.js';

// ---------------------------------------------------------------- geometry --
function colorize(geo, c, canopy) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const can = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; can[i] = canopy; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aCanopy', new THREE.BufferAttribute(can, 1));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color', 'aCanopy'].includes(k)) geo.deleteAttribute(k);
  return geo.index ? geo.toNonIndexed() : geo;
}

/** Tropical rain tree: short trunk, broad umbrella canopy of clustered crowns (unit height ~1). */
function broadleafGeometry(rnd) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.035, 0.06, 0.5, 5, 1, true).translate(0, 0.25, 0);
  parts.push(colorize(trunk, [0.25, 0.19, 0.13], 0));
  const blobs = 4;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rnd() * 0.5;
    const r = i === 0 ? 0 : 0.2 + rnd() * 0.1;
    const s = i === 0 ? 0.32 : 0.23 + rnd() * 0.08;
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(s * 1.25, s * 0.62, s * 1.25);
    g.translate(Math.cos(a) * r, 0.62 + rnd() * 0.12 + (i === 0 ? 0.1 : 0), Math.sin(a) * r);
    parts.push(colorize(g, [0.1 + rnd() * 0.04, 0.2 + rnd() * 0.06, 0.06], 1));
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  // soften normals outward from the crown centre for rounder shading
  const p = g.attributes.position, nrm = g.attributes.normal, can = g.attributes.aCanopy;
  for (let i = 0; i < p.count; i++) {
    if (can.getX(i) < 0.5) continue;
    const v = new THREE.Vector3(p.getX(i), (p.getY(i) - 0.6) * 1.6, p.getZ(i)).normalize();
    const n = new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).lerp(v, 0.65).normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

// ------------------------------------------------ high-detail (near) trees --
function smoothBlob(detail, s, center, rnd, jitter = 0.12) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const ph = rnd() * 10;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + jitter * Math.sin(v.x * 5.1 + ph) * Math.sin(v.y * 4.3 + ph * 1.3) * Math.sin(v.z * 4.7 - ph);
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  g.scale(s[0], s[1], s[2]);
  g.translate(center.x, center.y, center.z);
  g.computeVertexNormals();
  return g;
}

function shadeCanopy(g, base, rnd, cy) {
  // per-vertex colour: self-shadowed underside, sun-bleached top, hue drift per crown
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const drift = (rnd() - 0.5) * 0.05;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const ao = THREE.MathUtils.clamp(0.55 + (y - cy) * 3.2, 0.45, 1.15);
    col[i * 3] = (base[0] + drift) * ao;
    col[i * 3 + 1] = (base[1] + drift * 0.5) * ao;
    col[i * 3 + 2] = base[2] * ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const can = new Float32Array(p.count).fill(1);
  g.setAttribute('aCanopy', new THREE.BufferAttribute(can, 1));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'aCanopy'].includes(k)) g.deleteAttribute(k);
  return g.index ? g.toNonIndexed() : g;
}

function broadleafHigh(rnd) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.028, 0.06, 0.56, 9, 3, true).translate(0, 0.28, 0);
  parts.push(colorize(trunk, [0.24, 0.18, 0.12], 0));
  // spreading limbs
  for (let b = 0; b < 4; b++) {
    const a = (b / 4) * Math.PI * 2 + rnd() * 0.6;
    const pts = [new THREE.Vector3(0, 0.42, 0), new THREE.Vector3(Math.cos(a) * 0.12, 0.55, Math.sin(a) * 0.12), new THREE.Vector3(Math.cos(a) * 0.26, 0.64, Math.sin(a) * 0.26)];
    parts.push(colorize(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 5, 0.016, 5, false), [0.24, 0.18, 0.12], 0));
  }
  const crowns = [{ a: 0, r: 0, s: 0.3, y: 0.76 }];
  for (let i = 0; i < 6; i++) crowns.push({ a: (i / 6) * Math.PI * 2 + rnd() * 0.5, r: 0.2 + rnd() * 0.1, s: 0.18 + rnd() * 0.07, y: 0.66 + rnd() * 0.1 });
  for (const c of crowns) {
    const center = new THREE.Vector3(Math.cos(c.a) * c.r, c.y, Math.sin(c.a) * c.r);
    const g = smoothBlob(1, [c.s * 1.3, c.s * 0.72, c.s * 1.3], center, rnd);
    parts.push(shadeCanopy(g, [0.1 + rnd() * 0.04, 0.21 + rnd() * 0.06, 0.06], rnd, c.y));
  }
  return mergeGeometries(parts, false);
}

function palmHigh(rnd) {
  const parts = [];
  const pts = [];
  const lean = 0.12 + rnd() * 0.1;
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector3(lean * t * t, t * 0.95, 0)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  const trunk = new THREE.TubeGeometry(curve, 14, 0.019, 7, false);
  // ring scars on the trunk
  const tp = trunk.attributes.position;
  const tcol = new Float32Array(tp.count * 3);
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); const ring = 0.85 + 0.15 * Math.sin(y * 160); tcol.set([0.38 * ring, 0.32 * ring, 0.24 * ring], i * 3); }
  const tg = colorize(trunk, [0.38, 0.32, 0.24], 0);
  parts.push(tg);
  const top = pts[pts.length - 1];
  const fronds = 13;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rnd() * 0.25;
    const up = f % 3 === 0 ? 0.18 : 0.08;
    const seg = 8, len = 0.4 + rnd() * 0.12, w = 0.085;
    const verts = [];
    const ribAt = (t) => {
      const r = t * len;
      return new THREE.Vector3(top.x + Math.cos(a) * r, top.y + up * Math.sin(t * Math.PI * 0.7) - t * t * 0.3, top.z + Math.sin(a) * r);
    };
    for (let sI = 0; sI < seg; sI++) {
      const t0 = sI / seg, t1 = (sI + 1) / seg;
      const c0 = ribAt(t0), c1 = ribAt(t1);
      const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const w0 = w * Math.sin(Math.PI * Math.min(1, t0 * 1.15 + 0.05)), w1 = w * Math.sin(Math.PI * Math.min(1, t1 * 1.15 + 0.05));
      const droop = -0.035;
      for (const sd of [-1, 1]) {
        const l0 = c0.clone().addScaledVector(side, sd * w0).add(new THREE.Vector3(0, droop * (w0 / w), 0));
        const l1 = c1.clone().addScaledVector(side, sd * w1).add(new THREE.Vector3(0, droop * (w1 / w), 0));
        if (sd < 0) verts.push(...c0.toArray(), ...l0.toArray(), ...c1.toArray(), ...l0.toArray(), ...l1.toArray(), ...c1.toArray());
        else verts.push(...c0.toArray(), ...c1.toArray(), ...l0.toArray(), ...l0.toArray(), ...c1.toArray(), ...l1.toArray());
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.computeVertexNormals();
    parts.push(colorize(g, [0.15 + rnd() * 0.04, 0.3 + rnd() * 0.05, 0.08], 1));
  }
  // coconuts
  const nut = new THREE.SphereGeometry(0.018, 6, 4);
  for (let k = 0; k < 4; k++) { const g = nut.clone().translate(top.x + Math.cos(k * 1.7) * 0.02, top.y - 0.02, top.z + Math.sin(k * 1.7) * 0.02); parts.push(colorize(g, [0.3, 0.26, 0.12], 0)); }
  return mergeGeometries(parts, false);
}

function cypressHigh(rnd) {
  const prof = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(0.12 * Math.sin(Math.PI * Math.pow(t, 0.8)) + 0.004, t)); }
  const g = new THREE.LatheGeometry(prof, 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.12 * Math.sin(y * 40 + Math.atan2(z, x) * 3) ;
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return shadeCanopy(g, [0.06, 0.15, 0.06], rnd, 0.5);
}

/** Coconut palm: leaning curved trunk with drooping fronds. */
function palmGeometry(rnd) {
  const parts = [];
  const pts = [];
  const lean = 0.12 + rnd() * 0.1;
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(new THREE.Vector3(lean * t * t, t * 0.95, 0)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  parts.push(colorize(new THREE.TubeGeometry(curve, 6, 0.018, 4, false), [0.36, 0.3, 0.22], 0));
  const top = pts[pts.length - 1];
  const fronds = 8;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rnd() * 0.3;
    const pos = [];
    const seg = 4, len = 0.42 + rnd() * 0.1, w = 0.07;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg;
      const r = t * len;
      const y = top.y + 0.1 * Math.sin(t * Math.PI * 0.6) - t * t * 0.28;
      const cx = top.x + Math.cos(a) * r, cz = top.z + Math.sin(a) * r;
      const px = -Math.sin(a) * w * (1 - t * 0.7), pz = Math.cos(a) * w * (1 - t * 0.7);
      pos.push([cx + px, y - 0.02 * t, cz + pz], [cx - px, y - 0.02 * t, cz - pz], [cx, y + 0.015, cz]);
    }
    const verts = [];
    for (let s = 0; s < seg; s++) {
      const [l0, r0, c0] = pos.slice(s * 3, s * 3 + 3), [l1, r1, c1] = pos.slice(s * 3 + 3, s * 3 + 6);
      verts.push(...l0, ...c0, ...l1, ...c0, ...c1, ...l1, ...c0, ...r0, ...r1, ...c0, ...r1, ...c1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.computeVertexNormals();
    parts.push(colorize(g, [0.16, 0.3, 0.08], 1));
  }
  return mergeGeometries(parts, false);
}

/** Columnar cypress for plazas and terraces. */
function cypressGeometry() {
  const prof = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; prof.push(new THREE.Vector2(0.12 * Math.sin(Math.PI * Math.pow(t, 0.8)) + 0.005, t)); }
  const g = new THREE.LatheGeometry(prof, 6);
  return colorize(g, [0.06, 0.15, 0.06], 1);
}

// --------------------------------------------------------------- material --
export function createTreeMaterial(lod = 0) {
  // lod: 0 = none, 1 = far field (hidden near the viewer), -1 = near set (hidden far away)
  return patchedMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.5, side: THREE.DoubleSide }, {
    key: `trees${lod}`,
    uniforms: { uNearR: SHARED_NEAR_R },
    defines: lod ? { TREE_LOD: lod.toFixed(1) } : {},
    vertex: {
      pars: 'attribute float aCanopy; varying float vCanopy; uniform float uNearR;',
      transform: /* glsl */ `
vCanopy = aCanopy;
#ifdef TREE_LOD
{
  #ifdef USE_INSTANCING
  vec3 lp = instanceMatrix[3].xyz;
  #else
  vec3 lp = vec3(0.0);
  #endif
  float dd = distance(lp, cameraPosition);
  if ((TREE_LOD > 0.0 && dd < uNearR) || (TREE_LOD < 0.0 && dd >= uNearR)) transformed *= 0.0;
}
#endif
{
  #ifdef USE_INSTANCING
  vec3 ip = instanceMatrix[3].xyz;
  #else
  vec3 ip = vec3(0.0);
  #endif
  float ph = dot(ip.xz, vec2(0.05, 0.037));
  float h = max(transformed.y, 0.0);
  float sway = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7) * 0.25;
  transformed.x += sway * h * h * 0.035 * (0.4 + aCanopy);
  transformed.z += cos(uTime * 1.1 + ph) * h * h * 0.02 * aCanopy;
}`,
    },
    fragment: {
      pars: 'varying float vCanopy;',
      color: /* glsl */ `
{
  float n = vnoise(vWPos.xz * 0.9 + vWPos.y * 0.7);
  diffuseColor.rgb *= 0.78 + 0.44 * n;
  #ifdef USE_INSTANCING_COLOR
  #endif
}`,
      normal: /* glsl */ `
{
  vec3 g = vnoised(vWPos.xz * 1.3 + vWPos.y).xyz;
  vec3 wn = normalize(vWNrm + vec3(g.y, 0.0, g.z) * 0.5 * vCanopy);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
  #ifdef DOUBLE_SIDED
  normal *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
}`,
      lights: /* glsl */ `
{
  // light transmitted through backlit leaves
  vec3 V = normalize(cameraPosition - vWPos);
  float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);
  reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * uSunIlluminance * back * 0.35 * vCanopy * cloudShadowAt(vWPos);
}`,
    },
  });
}

const SHARED_NEAR_R = { value: 380 };

// ------------------------------------------------------------- tree field --
const TYPES = { broadleaf: 0, palm: 1, cypress: 2 };

export class TreeField {
  constructor(scene, settings) {
    this.scene = scene;
    this.material = createTreeMaterial(1);     // far field
    this.localMaterial = createTreeMaterial(0); // moving gardens
    this.nearMaterial = createTreeMaterial(-1); // detailed trees around the viewer
    const rnd = mulberry32(77);
    this.geos = [broadleafGeometry(rnd), palmGeometry(rnd), cypressGeometry()];
    this.geosHigh = [broadleafHigh(rnd), palmHigh(rnd), cypressHigh(rnd)];
    this.chunks = [];
    this.settings = settings;
    this.near = null;
  }

  _buildNear(trees) {
    const N = trees.length;
    const mats = new Float32Array(N * 16), cols = new Float32Array(N * 3), pos = new Float32Array(N * 3), types = new Uint8Array(N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const grid = new Map();
    const CELL = 200;
    trees.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot);
      m4.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.s * (t.sx || 1), t.s, t.s * (t.sx || 1)));
      m4.toArray(mats, i * 16);
      cols.set(t.tint, i * 3);
      pos.set([t.x, t.y, t.z], i * 3);
      types[i] = t.type;
      const k = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    const cap = 9000;
    const meshes = this.geosHigh.map((g) => {
      const m = new THREE.InstancedMesh(g, this.nearMaterial, cap);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      m.layers.set(1);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      this.scene.add(m);
      return m;
    });
    this.near = { mats, cols, pos, types, grid, CELL, meshes, cap, last: new THREE.Vector3(1e9, 0, 0) };
  }

  _updateNear(camera) {
    const n = this.near;
    if (!n) return;
    const cp = camera.position;
    const R = SHARED_NEAR_R.value;
    const margin = 70;
    if (n.last.distanceTo(cp) < margin * 0.8) return;
    n.last.copy(cp);
    const counts = [0, 0, 0];
    const RR = R + margin;
    const c0x = Math.floor((cp.x - RR) / n.CELL), c1x = Math.floor((cp.x + RR) / n.CELL);
    const c0z = Math.floor((cp.z - RR) / n.CELL), c1z = Math.floor((cp.z + RR) / n.CELL);
    const thin = this.settings.trees;
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const list = n.grid.get(`${cx},${cz}`);
      if (!list) continue;
      for (const i of list) {
        const dx = n.pos[i * 3] - cp.x, dy = n.pos[i * 3 + 1] - cp.y, dz = n.pos[i * 3 + 2] - cp.z;
        if (dx * dx + dy * dy + dz * dz > RR * RR) continue;
        if (thin < 1 && ((i * 2654435761) % 1000) / 1000 > thin) continue;
        const t = n.types[i];
        if (counts[t] >= n.cap) continue;
        const m = n.meshes[t];
        m.instanceMatrix.array.set(n.mats.subarray(i * 16, i * 16 + 16), counts[t] * 16);
        m.instanceColor.array.set(n.cols.subarray(i * 3, i * 3 + 3), counts[t] * 3);
        counts[t]++;
      }
    }
    n.meshes.forEach((m, t) => {
      m.count = counts[t];
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, counts[t] * 16);
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.clearUpdateRanges();
      m.instanceColor.addUpdateRange(0, counts[t] * 3);
      m.instanceColor.needsUpdate = true;
    });
  }

  /** trees: [{x,y,z,s,type,rot,tint}] — built into spatial chunks for culling. */
  build(trees, { chunk = 2400, layer = 1 } = {}) {
    this._buildNear(trees);
    const buckets = new Map();
    for (const t of trees) {
      const key = `${Math.floor(t.x / chunk)},${Math.floor(t.z / chunk)},${t.type}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    for (const [key, list] of buckets) {
      const type = +key.split(',')[2];
      // shuffle so that reducing .count thins uniformly
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      const mesh = new THREE.InstancedMesh(this.geos[type], this.material, list.length);
      let cx = 0, cz = 0;
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.rot);
        m4.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.s * (t.sx || 1), t.s, t.s * (t.sx || 1)));
        mesh.setMatrixAt(i, m4);
        c.setRGB(t.tint[0], t.tint[1], t.tint[2]);
        mesh.setColorAt(i, c);
        cx += t.x; cz += t.z;
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.layers.set(layer);
      mesh.userData.fullCount = list.length;
      mesh.userData.center = new THREE.Vector2(cx / list.length, cz / list.length);
      this.scene.add(mesh);
      this.chunks.push(mesh);
    }
    this.applyQuality(this.settings);
  }

  /** Trees attached to a moving parent (floating islands, sky gardens). */
  buildLocal(trees, parent) {
    const byType = [[], [], []];
    for (const t of trees) byType[t.type].push(t);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    byType.forEach((list, type) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(this.geosHigh[type], this.localMaterial, list.length);
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.rot);
        m4.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, c.setRGB(t.tint[0], t.tint[1], t.tint[2]));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    });
  }

  applyQuality(s) {
    this.settings = s;
    for (const m of this.chunks) m.count = Math.max(1, Math.floor(m.userData.fullCount * s.trees));
    if (this.near) this.near.last.set(1e9, 0, 0);
  }

  update(dt, t, camera) {
    if (!camera) return;
    this._updateNear(camera);
    const cp = camera.position;
    const maxD = 6500 + cp.y * 1.2;
    for (const m of this.chunks) {
      const d = Math.hypot(m.userData.center.x - cp.x, m.userData.center.y - cp.z);
      m.visible = d < maxD;
    }
  }
}

export { TYPES };
