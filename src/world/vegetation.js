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
export function createTreeMaterial() {
  return patchedMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.5, side: THREE.DoubleSide }, {
    key: 'trees',
    vertex: {
      pars: 'attribute float aCanopy; varying float vCanopy;',
      transform: /* glsl */ `
vCanopy = aCanopy;
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

// ------------------------------------------------------------- tree field --
const TYPES = { broadleaf: 0, palm: 1, cypress: 2 };

export class TreeField {
  constructor(scene, settings) {
    this.scene = scene;
    this.material = createTreeMaterial();
    const rnd = mulberry32(77);
    this.geos = [broadleafGeometry(rnd), palmGeometry(rnd), cypressGeometry()];
    this.chunks = [];
    this.settings = settings;
  }

  /** trees: [{x,y,z,s,type,rot,tint}] — built into spatial chunks for culling. */
  build(trees, { chunk = 2400, layer = 1 } = {}) {
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
      const mesh = new THREE.InstancedMesh(this.geos[type], this.material, list.length);
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
  }

  update(dt, t, camera) {
    if (!camera) return;
    const cp = camera.position;
    const maxD = 6500 + cp.y * 1.2;
    for (const m of this.chunks) {
      const d = Math.hypot(m.userData.center.x - cp.x, m.userData.center.y - cp.z);
      m.visible = d < maxD;
    }
  }
}

export { TYPES };
