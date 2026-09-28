import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildTowers } from '../src/world/towers.js';
import { TOWERS } from '../src/world/layout.js';
import { wardTowerDefs, wardHeight } from '../src/world/metro.js';
import { buildTerrainData, HeightSampler } from '../src/world/terrain.js';
import { auditGeometry, solidComponents, materialContact } from './geometry-audit.mjs';

// Exercise production geometry and the triangulated terrain sampler used at runtime.
const sampler = new HeightSampler(await buildTerrainData(() => {}));
const ground = (x, z) => Math.max(0, sampler.get(x, z), wardHeight(x, z));
const scene = new THREE.Scene();
const towers = buildTowers([...TOWERS, ...wardTowerDefs()], ground, scene);
scene.updateMatrixWorld(true);
const point = new THREE.Vector3(), counts = { towers: towers.length, meshes: 0, triangles: 0, foundationVertices: 0 };
let highestFoundationGap = -Infinity;
for (const tower of towers) {
  tower.mesh.traverse(mesh => {
    if (!mesh.isMesh) return;
    const a = auditGeometry(mesh.geometry, { tolerance: 1e-4 });
    for (const key of ['boundaryEdges', 'inconsistentEdges', 'degenerates', 'nonFinite', 'invalidNormals']) {
      assert.equal(a[key], 0, `${mesh.name}: ${key}`);
    }
    assert.ok(a.signedVolume > 0, `${mesh.name}: outward orientation`);
    // Composite receiver assemblies share a few contact edges. The repaired
    // nautilus tier volumes and every balustrade are individually manifold.
    if (tower.def.type === 'shell') assert.equal(a.nonManifoldEdges, 0, `${mesh.name}: manifold shell`);
    counts.meshes++; counts.triangles += a.triangles;
  });
  const p = tower.mesh.geometry.attributes.position;
  let bottom = Infinity;
  for (let i = 0; i < p.count; i++) bottom = Math.min(bottom, p.getY(i));
  for (let i = 0; i < p.count; i++) if (p.getY(i) < bottom + .01) {
    point.fromBufferAttribute(p, i).applyMatrix4(tower.mesh.matrixWorld);
    const gap = point.y - ground(point.x, point.z);
    assert.ok(gap <= .025, `${tower.mesh.name}: foundation vertex hovers ${gap} m above terrain`);
    highestFoundationGap = Math.max(highestFoundationGap, gap);
    counts.foundationVertices++;
  }
}

// A removed base cap is distinguishable from the complete geometry.
const closed = new THREE.CylinderGeometry(5, 5, 10, 16, 1, false);
const open = new THREE.CylinderGeometry(5, 5, 10, 16, 1, true);
assert.equal(auditGeometry(closed).boundaryEdges, 0);
assert.ok(auditGeometry(open).boundaryEdges > 0);

// Reproduce the original sparse survey's missed hollow under Halcyon.
const halcyon = TOWERS.find(t => t.name === 'Halcyon Spire');
const oldReach = halcyon.radius * 2.85 * 1.25;
let oldLow = ground(halcyon.x, halcyon.z);
for (let i = 0; i < 16; i++) oldLow = Math.min(oldLow, ground(halcyon.x + Math.cos(i * Math.PI / 8) * oldReach, halcyon.z + Math.sin(i * Math.PI / 8) * oldReach));
const current = towers.find(t => t.def === halcyon), p = current.mesh.geometry.attributes.position;
let min = Infinity, oldGap = -Infinity;
for (let i = 0; i < p.count; i++) min = Math.min(min, p.getY(i));
for (let i = 0; i < p.count; i++) if (p.getY(i) < min + .01) {
  point.fromBufferAttribute(p, i).applyMatrix4(current.mesh.matrixWorld);
  oldGap = Math.max(oldGap, oldLow - 3 - ground(point.x, point.z));
}
assert.ok(oldGap > 1.5, 'positive control: the old outer-ring survey leaves Halcyon unsupported');

// A sky court remains open above the podium. Search actual ray intersections
// instead of assuming that closing a concave outline preserved the opening.
const nautilus = towers.find(t => t.def.name === 'Cantor Nautilus');
const local = new THREE.Mesh(nautilus.mesh.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
local.updateMatrixWorld();
const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
let clearCanyonSamples = 0, solidWallSamples = 0;
for (let x = -100; x <= 100; x += 10) for (let z = -100; z <= 100; z += 10) {
  ray.set(new THREE.Vector3(x, 150, z), down); ray.far = 100;
  if (ray.intersectObject(local, false).length) solidWallSamples++;
  else clearCanyonSamples++;
}
assert.ok(clearCanyonSamples > 50 && solidWallSamples > 20, 'both solid spiral walls and open canyon remain');
assert.ok(counts.triangles < 2_500_000, 'arcology geometry stays within its reviewed static budget');
// Bounds are only a broad phase. These controls require real surface contact or
// containment, including intersecting bars with no corner inside the other bar.
const solid = g => solidComponents(g)[0];
const cube = solid(new THREE.BoxGeometry(2, 2, 2));
assert.ok(materialContact(cube, solid(new THREE.BoxGeometry(1, 1, 1))), 'fully nested material is connected');
assert.ok(materialContact(cube, solid(new THREE.BoxGeometry(2, 2, 2).translate(2, 0, 0))), 'coplanar face contact');
assert.equal(materialContact(cube, solid(new THREE.BoxGeometry(2, 2, 2).translate(2.02, 0, 0))), false, 'a real centimetre air gap must fail');
assert.ok(materialContact(solid(new THREE.BoxGeometry(8, .3, .3)), solid(new THREE.BoxGeometry(.3, 8, .3))), 'crossed structural bars');
const hoopControl = solid(new THREE.TorusGeometry(5, .5, 8, 32));
assert.equal(materialContact(hoopControl, cube), false, 'overlapping bounds do not fill a genuine torus aperture');

const support = { components: 0, foundations: 0, connections: 0, towers: [] };
const unsupported = [];
for (const tower of towers) {
  const components = [];
  tower.mesh.traverse(mesh => {
    if (!mesh.isMesh) return;
    for (const component of solidComponents(mesh.geometry, mesh.matrixWorld)) components.push({ ...component, mesh: mesh.name });
  });
  const reached = new Set();
  for (const [i, c] of components.entries()) {
    // A foundation really enters the surveyed terrain under one of its own
    // bottom vertices. Later pieces must reach one through actual material.
    if (c.vertices.some(v => v.y < c.bounds.min.y + .01 && v.y <= ground(v.x, v.z) + .005)) reached.add(i);
  }
  const foundations = reached.size;
  const frontier = [...reached];
  for (let q = 0; q < frontier.length; q++) {
    const a = components[frontier[q]];
    for (let j = 0; j < components.length; j++) {
      if (reached.has(j) || !materialContact(a, components[j])) continue;
      reached.add(j); frontier.push(j); support.connections++;
    }
  }
  const missing = components.map((c, i) => ({ c, i })).filter(({ i }) => !reached.has(i)).map(({ c, i }) => ({
    component: i, mesh: c.mesh, triangles: c.triangles.length,
    min: c.bounds.min.toArray(), max: c.bounds.max.toArray(),
  }));
  if (missing.length) unsupported.push({ name: tower.def.name, type: tower.def.type, missing });
  support.components += components.length; support.foundations += foundations;
  support.towers.push({ name: tower.def.name, type: tower.def.type, components: components.length, foundations, reached: reached.size });
}
console.log(JSON.stringify({ ...counts, highestFoundationGap, oldHalcyonGap: oldGap, clearCanyonSamples, solidWallSamples, support, unsupported }));
assert.equal(unsupported.length, 0, 'every authored structural component reaches actual terrain through material contact');
console.log('ARCOLOGIES_VERIFIED');
