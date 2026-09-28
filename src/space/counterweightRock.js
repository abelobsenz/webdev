import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tag, KIND } from './hull.js';

// The captured carbonaceous body is deliberately shared by the mesh and its footings.
// Dimensions are km here; station builders convert sampled contact radii to metres.
function noise(x, y, z) {
  const h = (i, j, k) => { let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177); n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; };
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const s = t => t * t * (3 - 2 * t), u = s(x - i), v = s(y - j), w = s(z - k);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h(i,j,k),h(i+1,j,k),u),l(h(i,j+1,k),h(i+1,j+1,k),u),v),l(l(h(i,j,k+1),h(i+1,j,k+1),u),l(h(i,j+1,k+1),h(i+1,j+1,k+1),u),v),w);
}

export function buildCounterweightRock() {
  const base = new THREE.IcosahedronGeometry(9, 24);
  base.deleteAttribute('normal'); base.deleteAttribute('uv');
  const g = mergeVertices(base, 1e-5);
  base.dispose();
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let h = 0, amplitude = 1, f = 2.25;
    for (let o = 0; o < 5; o++) { h += amplitude * (noise(v.x * f + 3, v.y * f, v.z * f) - .5); amplitude *= .5; f *= 2.1; }
    v.multiplyScalar(9 * (1 + .25 * v.x * v.x - .15 * v.z * v.z) * (1 + h * .4));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); g.computeBoundingSphere();
  const geo = tag(g, KIND.ROCK);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, material); mesh.updateMatrixWorld();
  const ray = new THREE.Raycaster(), direction = new THREE.Vector3();
  const surfaceRadius = d => {
    direction.copy(d).normalize();
    ray.set(direction.clone().multiplyScalar(30), direction.clone().negate());
    const hit = ray.intersectObject(mesh, false)[0];
    if (!hit) throw new Error('Counterweight footing missed the rock');
    return (30 - hit.distance) * 1000;
  };
  return { geo, surfaceRadius };
}
