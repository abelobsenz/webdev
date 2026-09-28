import * as THREE from 'three';
import { mergeClean } from './geom.js';

// Distance LOD for the far districts (island cities, massif towns). They sit 8–40 km
// from the lagoon, so one merged mesh per city was always inside the view and the
// shadow frustum and drew every stair tread at any range. Here the city is cut into
// square cells; every cell is a THREE.LOD whose levels draw progressively fewer tiers
// of parts. An item's `tier` is the last level that still draws it (tier 0: nearest
// level only; the top tier is the massing, drawn everywhere). Levels share the
// per-tier geometry, so nothing is duplicated in memory. Each mesh is frustum-culled
// on its own bounding sphere (main view and shadow cascades alike), and levels past
// the shadow range do not cast.
const _box = new THREE.Box3(), _c = new THREE.Vector3();

/**
 * @param {THREE.Object3D} scene
 * @param {{geo:THREE.BufferGeometry, tier:number, x?:number, z?:number}[]} items
 * @param {THREE.Material} material
 * @param {{cell:number, levels:{dist:number, cast:boolean}[], name:string}} opts
 * @returns {THREE.Mesh[]} the full-detail (level 0) meshes
 */
export function buildOuterLOD(scene, items, material, { cell, levels, name }) {
  const cells = new Map(), top = levels.length - 1;
  for (const it of items) {
    const g = it.geo;
    if (!g || !g.attributes.position.count) continue;
    let x = it.x, z = it.z;
    if (x === undefined) { g.computeBoundingBox(); g.boundingBox.getCenter(_c); x = _c.x; z = _c.z; }
    const key = Math.floor(x / cell) + ',' + Math.floor(z / cell);
    let c = cells.get(key);
    if (!c) cells.set(key, c = { tiers: levels.map(() => []) });
    c.tiers[Math.max(0, Math.min(top, it.tier))].push(g);
  }
  const full = [];
  for (const c of cells.values()) {
    const geos = c.tiers.map((list) => (list.length ? mergeClean(list) : null));
    _box.makeEmpty();
    for (const g of geos) if (g) { g.computeBoundingBox(); g.computeBoundingSphere(); _box.union(g.boundingBox); }
    const centre = _box.getCenter(new THREE.Vector3());
    const lod = new THREE.LOD();
    lod.name = `${name} (lod cell)`;
    lod.position.copy(centre);
    lod.matrixAutoUpdate = false;
    lod.updateMatrix();
    levels.forEach(({ dist, cast }, level) => {
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      for (let t = level; t <= top; t++) {
        if (!geos[t]) continue;
        const m = new THREE.Mesh(geos[t], material);
        m.name = level === 0 && t === top ? name : `${name} (tier ${t}, level ${level})`;
        m.position.copy(centre).negate();
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        m.castShadow = cast;
        m.receiveShadow = true;
        group.add(m);
        if (level === 0) full.push(m);
      }
      lod.addLevel(group, dist);
    });
    lod.updateMatrixWorld(true);
    scene.add(lod);
  }
  return full;
}
