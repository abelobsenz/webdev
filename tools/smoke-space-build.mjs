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
import { Rings } from '../src/space/rings.js';
import { HaloPorts } from '../src/space/stations.js';
import { HALO_PORTS } from '../src/space/earthData.js';
import { SunSwarm } from '../src/space/sun.js';
import { Aurora } from '../src/space/aurora.js';
import { Meteors } from '../src/space/meteors.js';
import { SkyLife } from '../src/space/skyStars.js';
import { SKY_UNIFORMS } from '../src/space/sky.js';

const sim = new SpaceSim();
sim.syncFromHours(12);
const space = {
  scene: new THREE.Scene(), earthFixed: new THREE.Group(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e7), size: new THREE.Vector2(1280, 720), sim,
  addBody(name, objects, center, radius, opts) { const b = { name, objects, center, radius, ...opts }; this.bodies.push(b); return b; },
};
space.scene.add(space.earthFixed);
space.rings = new Rings(space, { ringSegs: 0.5 });
space.earthFixed.add(space.rings.group);
space.rings.districts.buildAll();
space.ports = new HaloPorts(space, HALO_PORTS);
space.elevator = new Elevator(space, { climbers: 60 });
space.earthFixed.add(space.elevator.group);
space.hearth = new Hearth(space, { bhSteps: 110, bhScale: 0.6 });
space.scene.add(space.hearth.group);
space.sunSwarm = new SunSwarm(space, { swarm: 4000 });
space.scene.add(space.sunSwarm.group);
space.moon = new Moon(space);
space.scene.add(space.moon.group);
space.moon.ensureLife();            // Medii Works and the Landing's traffic (built on approach in the app)
space.moon.outposts.buildAll();     // the other lunar settlements (likewise)
const mods = [];
space.aurora = new Aurora(space, { earthQ: 2 }); mods.push(space.aurora);
space.skyLife = new SkyLife(space, SKY_UNIFORMS); mods.push(space.skyLife);
space.meteors = new Meteors(space); mods.push(space.meteors);
for (const [k, C] of [['fleet', Fleet], ['works', WorkingStations], ['geoRoads', GeoRoads], ['lanes', Lanes], ['releaseYard', ReleaseYard]]) { space[k] = new C(space); mods.push(space[k]); }
// the fleet's lazily built near detail (liners, Selene, tenders), forced so it is exercised too
space.fleet._linerDetail(null, true); space.fleet._seleneDetail(null, 0, true); space.fleet._tenderDetail(null, true);
// the lazily built near detail (Helianth district and flotilla, foundry yard): force it, then animate it below
space.works.district.build(); space.works.yard.build(); space.works.swarm.build(); space.works.commons.build();   // (and the Helianth's collector shells, the foundry's town)
let tri = 0;
space.scene.traverse((o) => { if (o.isMesh && o.geometry?.index && !o.geometry.isInstancedBufferGeometry) tri += o.geometry.index.count / 3; });
for (const t of [0, 60, 400, 900, 1500]) {
  sim.step(0);
  space.earthFixed.quaternion.copy(sim.earthQuat); space.earthFixed.updateMatrixWorld(true);
  space.elevator.update(sim, t, 0.016, space);
  space.rings.update(sim, t, 0.016, space);
  space.ports.update(sim, t, 0.016, space);
  space.hearth.update(sim, t, 0.016, space);
  space.moon.update(sim, t);
  space.sunSwarm.update(sim, t, 0.016, space);
  for (const m of mods) if (m.update) m.update(sim, t, 0.016, space);
  space.scene.updateMatrixWorld(true);
}
let bad = 0;
space.scene.traverse((o) => { if (!o.matrixWorld.elements.every(Number.isFinite)) bad++; });
if (bad) throw new Error(`${bad} objects with non-finite transforms`);
// the geostationary arc at work (harbourLife, terraceLife, yardWorks, storeWorks, releaseWorks, waterRun)
const works = { harbourLife: space.elevator.station.life, terraceLife: space.elevator.station.terraceLife, yardWorks: space.geoRoads.yardWorks, storeWorks: space.geoRoads.storeWorks, releaseWorks: space.releaseYard.works, waterRun: space.geoRoads.waterRun };
for (const [k, w] of Object.entries(works)) if (!w) throw new Error(`${k} missing`);
if (!space.geoRoads.guide.C.array.every(Number.isFinite) || space.geoRoads.guide.n !== space.elevator.station.data.arms.length * 12) throw new Error('docking guidance lamps');
console.log(JSON.stringify(Object.fromEntries(Object.entries(works).filter(([, w]) => w.triangles).map(([k, w]) => [k, { tris: w.triangles(), buildMs: +(w.buildMs ?? 0).toFixed(1) }]))));
console.log(JSON.stringify({ bodies: space.bodies.length, indexedTriangles: tri }));
console.log('SPACE_BUILD_SMOKE_OK');
