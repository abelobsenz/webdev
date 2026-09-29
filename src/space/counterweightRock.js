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

/**
 * Impact craters on the unit sphere: a few large, many small (sizes by a power law), each a
 * direction and an angular radius. Deterministic, so the footings sampled from the mesh agree.
 */
export function rockCraters(n = 54, seed = 0x2c1b) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return s / 4294967296; };
  const out = [];
  for (let c = 0; c < n; c++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    out.push({ d: new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), z), size: 0.06 + 0.3 * Math.pow(rnd(), 2.6), fresh: rnd() });
  }
  return out;
}

/**
 * Relative relief of the craters at unit direction v: a parabolic bowl about a fifth as deep as
 * it is wide, a raised rim that falls off outside (the ejecta), softened on the older ones.
 */
export function craterRelief(v, craters) {
  let h = 0;
  for (const c of craters) {
    const cosT = v.dot(c.d);
    if (cosT < Math.cos(c.size * 1.8)) continue;
    const s = Math.acos(Math.min(1, cosT)) / c.size;
    const depth = 0.19 * c.size * (0.55 + 0.45 * c.fresh);
    if (s < 1) h -= depth * (1 - s * s) - depth * 0.28;
    else h += depth * 0.28 * Math.exp(-(((s - 1) / 0.32) ** 2));
  }
  return h;
}

export function buildCounterweightRock() {
  const base = new THREE.IcosahedronGeometry(9, 24);
  base.deleteAttribute('normal'); base.deleteAttribute('uv');
  const g = mergeVertices(base, 1e-5);
  base.dispose();
  const p = g.attributes.position, v = new THREE.Vector3();
  const craters = rockCraters();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let h = 0, amplitude = 1, f = 2.25;
    for (let o = 0; o < 5; o++) { h += amplitude * (noise(v.x * f + 3, v.y * f, v.z * f) - .5); amplitude *= .5; f *= 2.1; }
    // ridged octave: the body is a rubble pile, its surface broken in scarps, not rolled smooth
    const rn = 1 - Math.abs(2 * noise(v.x * 5.3 - 7, v.y * 5.3 + 2, v.z * 5.3) - 1);
    h += .12 * rn * rn;
    v.multiplyScalar(9 * (1 + .25 * v.x * v.x - .15 * v.z * v.z) * (1 + h * .4 + craterRelief(v, craters)));
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
