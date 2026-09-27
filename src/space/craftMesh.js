import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createCraftMaterial, updateCraftMaterial } from '../craft/craftMaterial.js';
import { createEngine } from '../craft/plumes.js';
import { createLamps } from './lamps.js';

// Shared helpers for anything built with the craft builder (metres) and drawn in the
// kilometre-scale orbital scene: one merged mesh per object with the space craft
// material (view-space lighting, camera-relative projection), engines, lamps.

export const KM = 0.001;
const _v = new THREE.Vector3();

/** A craft-material mesh in metres, scaled into km. Per-frame uniforms are set before it draws. */
export function craftMesh(geo, opts = {}, mat = null) {
  const m = mat || createCraftMaterial(opts);
  const mesh = new THREE.Mesh(geo, m);
  mesh.scale.setScalar(opts.scale ?? KM);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.userData.world = new THREE.Vector3();
  mesh.onBeforeRender = (r, s, cam) => {
    mesh.getWorldPosition(mesh.userData.world);
    const sd = mesh.userData.sunDir || CRAFT_FRAME.sunDir;
    updateCraftMaterial(m, cam, sd, mesh.userData.world, CRAFT_FRAME.time);
    if (m.uniforms.uFlood) m.uniforms.uFlood.value = mesh.userData.flood ?? 0;
    m.uniformsNeedUpdate = true;
  };
  return mesh;
}

/** A second mesh sharing a craft mesh's material and per-frame update (moving parts). */
export function craftPart(parent, geo) {
  const m = new THREE.Mesh(geo, parent.material);
  m.frustumCulled = false;
  m.renderOrder = 3;
  m.onBeforeRender = parent.onBeforeRender;
  return m;
}

/** Frame-wide values the craft meshes read (set once per frame by the space mode). */
export const CRAFT_FRAME = { sunDir: new THREE.Vector3(1, 0, 0), time: 0 };

/** Plasma-throat + exhaust-column engines at a craft's nozzles (metres, craft frame). */
export function addEngines(mesh, glows, { scale = 0.6, length = 14, color = 0x7fd8ff, core = 0xeefaff, throttle = 1 } = {}) {
  const list = [];
  glows.forEach((g, i) => {
    const r = g.r * scale;
    const e = createEngine({ radius: r, length: r * length, color, core, seed: i * 0.37 + 0.11 });
    e.position.copy(g.p);
    e.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), g.dir);
    e.setThrottle(throttle);
    mesh.add(e);
    list.push(e);
  });
  return list;
}

/** Lamps riding on a mesh (lamp positions in the mesh's own units). */
export function addLamps(mesh, lamps, opts) {
  if (!lamps || !lamps.length) return null;
  const l = createLamps(lamps, opts);
  mesh.add(l);
  return l;
}

/** Merge craft geometries placed by matrices: [{ geo, m: Matrix4 }]. */
export function placeMerge(list) {
  const out = [];
  for (const { geo, m } of list) {
    const g = geo.clone();
    g.applyMatrix4(m);
    out.push(g);
  }
  const g = mergeGeometries(out, false);
  g.computeBoundingSphere();
  return g;
}

/** Transform lamp records by a matrix (positions) and its rotation (facing). */
export function placeLamps(lamps, m, scale = 1) {
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  m.decompose(p, q, s);
  return lamps.map((l) => ({ ...l, p: l.p.clone().applyMatrix4(m), r: l.r * s.x * scale, dir: l.dir ? l.dir.clone().applyQuaternion(q) : undefined }));
}

/** Apparent radius in pixels of a sphere of radius rKm at world position p. */
export function pixelRadius(cam, p, rKm, viewH) {
  const d = Math.max(_v.copy(p).sub(cam.position).length(), 1e-6);
  return (rKm / d) * viewH * 0.5 / Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
}
