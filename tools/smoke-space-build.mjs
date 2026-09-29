// Headless construction and a few update frames of every orbital module (no renderer): catches
// constructor and per-frame errors in seconds. Run: node tools/smoke-space-build.mjs
import * as THREE from 'three';
import { SpaceSim } from '../src/space/sim.js';
import { Elevator } from '../src/space/elevator.js';
import { Hearth } from '../src/space/hearth.js';
import { Fleet } from '../src/space/fleet.js';
import { WorkingStations } from '../src/space/workingStations.js';
import { GeoRoads } from '../src/space/geoRoads.js';
import { Lanes } from '../src/space/lanes.js';
import { ReleaseYard } from '../src/space/releaseYard.js';
import { Moon } from '../src/space/moon.js';

const sim = new SpaceSim();
sim.syncFromHours(12);
const space = {
  scene: new THREE.Scene(), earthFixed: new THREE.Group(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e7), size: new THREE.Vector2(1280, 720), sim,
  addBody(name, objects, center, radius, opts) { const b = { name, objects, center, radius, ...opts }; this.bodies.push(b); return b; },
};
space.scene.add(space.earthFixed);
space.elevator = new Elevator(space, { climbers: 60 });
space.earthFixed.add(space.elevator.group);
space.hearth = new Hearth(space, { bhSteps: 110, bhScale: 0.6 });
space.scene.add(space.hearth.group);
space.moon = new Moon(space);
space.scene.add(space.moon.group);
const mods = [];
for (const [k, C] of [['fleet', Fleet], ['works', WorkingStations], ['geoRoads', GeoRoads], ['lanes', Lanes], ['releaseYard', ReleaseYard]]) { space[k] = new C(space); mods.push(space[k]); }
// the fleet's lazily built near detail (liners, Selene, tenders), forced so it is exercised too
space.fleet._linerDetail(null, true); space.fleet._seleneDetail(null, 0, true); space.fleet._tenderDetail(null, true);
let tri = 0;
space.scene.traverse((o) => { if (o.isMesh && o.geometry?.index && !o.geometry.isInstancedBufferGeometry) tri += o.geometry.index.count / 3; });
for (const t of [0, 60, 400, 900, 1500]) {
  sim.step(0);
  space.earthFixed.quaternion.copy(sim.earthQuat); space.earthFixed.updateMatrixWorld(true);
  space.elevator.update(sim, t, 0.016, space);
  space.hearth.update(sim, t, 0.016, space);
  space.moon.update(sim, t);
  for (const m of mods) if (m.update) m.update(sim, t, 0.016, space);
  space.scene.updateMatrixWorld(true);
}
let bad = 0;
space.scene.traverse((o) => { if (!o.matrixWorld.elements.every(Number.isFinite)) bad++; });
if (bad) throw new Error(`${bad} objects with non-finite transforms`);
console.log(JSON.stringify({ bodies: space.bodies.length, indexedTriangles: tri }));
console.log('SPACE_BUILD_SMOKE_OK');
