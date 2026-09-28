import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildAxis } from '../src/world/axis.js';
import { PLAZA_R, PLAZA_Y } from '../src/world/layout.js';
import { auditGeometry } from './geometry-audit.mjs';

const scene = new THREE.Scene(), updaters = [];
buildAxis(scene, updaters);
scene.updateMatrixWorld(true);
const optical = new Set(['Axis plaza pools', 'Axis plaza box']);
let structuralMeshes = 0, structuralTriangles = 0, opticalSurfaces = 0;
scene.traverse(mesh => {
  if (!mesh.isMesh) return;
  if (optical.has(mesh.name) || (mesh.material.transparent && mesh.name !== 'Axis tether')) { opticalSurfaces++; return; }
  const a = auditGeometry(mesh.geometry, { tolerance: 1e-4 });
  for (const key of ['boundaryEdges', 'inconsistentEdges', 'degenerates', 'nonFinite', 'invalidNormals']) assert.equal(a[key], 0, `${mesh.name || 'Axis structure'}: ${key}`);
  assert.ok(a.signedVolume > 0, `${mesh.name || 'Axis structure'}: positive material volume`);
  structuralMeshes++; structuralTriangles += a.triangles;
});
assert.equal(structuralMeshes, 19, 'complete Axis structure, masonry, nodes, gyros, anchor, tether and pods covered');
assert.ok(opticalSurfaces > 24, 'foliage, water and glow volumes are explicitly classified');
assert.ok(auditGeometry(new THREE.CylinderGeometry(2, 2, 8, 16, 1, true)).boundaryEdges > 0, 'open-shell positive control');

const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const anchor = new THREE.Mesh(scene.getObjectByName('Axis anchor and cradle').geometry, material);
anchor.updateMatrixWorld();
const ray = new THREE.Raycaster(new THREE.Vector3(0, -20, 0), new THREE.Vector3(0, 1, 0), 0, 260);
assert.equal(ray.intersectObject(anchor, false).length, 0, 'anchor material closes around a genuine cable bore');
ray.ray.origin.x = 25;
assert.ok(ray.intersectObject(anchor, false).length > 0, 'control ray crosses the anchor collar material');

// Check real walking treads. Avenue/deck overlap can suppress a stair, so the
// positive count is measured from the actual rim mesh and every found flight
// must retain all nineteen horizontal treads at 175 mm increments.
const rim = new THREE.Mesh(scene.getObjectByName('Axis plaza rim').geometry, material);
rim.updateMatrixWorld();
const down = new THREE.Vector3(0, -1, 0);
let flights = 0, treads = 0;
for (let k = 0; k < 12; k++) {
  const a = k * Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
  const sample = i => {
    const r = PLAZA_R + (i - .5) * .36;
    ray.set(new THREE.Vector3(c * r, PLAZA_Y + 4, s * r), down); ray.far = 9;
    return ray.intersectObject(rim, false)[0]?.point.y;
  };
  if (Math.abs((sample(1) ?? Infinity) - (PLAZA_Y - .175)) > .01) continue;
  flights++;
  for (let i = 1; i < 20; i++) {
    assert.ok(Math.abs(sample(i) - (PLAZA_Y - i * .175)) < .01, `avenue ${k}: tread ${i} remains at its original walking height`);
    treads++;
  }
}
assert.ok(flights >= 4, 'several real Commons approaches are exercised');
assert.ok(structuralTriangles < 500_000, 'Axis architectural solidification has bounded cost');
console.log(JSON.stringify({ structuralMeshes, structuralTriangles, opticalSurfaces, flights, treads }));
console.log('AXIS_VERIFIED');
