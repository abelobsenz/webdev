import * as THREE from 'three';
import { SpaceSim } from '../src/space/sim.js';
import { Rings } from '../src/space/rings.js';
const sim = new SpaceSim(); sim.syncFromHours(12);
const space = { scene: new THREE.Scene(), earthFixed: new THREE.Group(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16/9, 0.01, 1e7), size: new THREE.Vector2(1280,720), sim,
  addBody(name, objects, center, radius, opts) { const b = { name, objects, center, radius, ...opts }; this.bodies.push(b); return b; } };
let t0=performance.now();
const rings = new Rings(space, { ringSegs: 1 });
console.log('rings ctor ms', (performance.now()-t0).toFixed(0));
const D = rings.districts;
t0=performance.now(); D._queue(); const times=[]; while (D.buildQueue.length) { const a=performance.now(); D._step(); times.push((performance.now()-a).toFixed(0)); } D.built = true;
console.log('build pieces ms', times.join(','), 'total', (performance.now()-t0).toFixed(0));
for (const [i,v] of D.variants.entries()) console.log('variant', i, 'major', v.major.index.count/3, 'minor', v.minor.index.count/3, 'lamps', v.lampCount, JSON.stringify(v.cells));
for (const c of D.crests) console.log('crest', c.major.index.count/3, c.minor.index.count/3, c.lampCount);
console.log('gantry', D.gantryGeo.index.count/3, 'bays', D.gantryBays.length, 'hubTiles', D.hubTiles.size, 'bay', JSON.stringify(D.bay), JSON.stringify(D.shipBox));
// camera 3 km above the deck of a dressed tile, a few km from a gantry bay
const bay = D.gantryBays[0];
const th = bay.u / D.Rm + 20000 / D.Rm;
const { a, b, R } = D.basis;
const camBody = a.clone().multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th)).multiplyScalar(R + 3);
sim.step(0);
space.earthFixed.quaternion.copy(sim.earthQuat); space.earthFixed.updateMatrixWorld(true);
space.camera.position.copy(camBody).applyQuaternion(sim.earthQuat);
space.camera.updateMatrixWorld(true);
const ut = [];
for (const t of [0, 100, 2000, 5000, 9000]) { const s = performance.now(); rings.update(sim, t, 0.016, space); ut.push(performance.now() - s); space.scene.updateMatrixWorld(true); }
console.log('update ms', ut.map((x) => x.toFixed(3)).join(','), 'anchor', D.anchor.visible, 'trains', D.trains.count, 'trams', D.trams.count, 'pods', D.pods.count, 'ships', D.ships.map((s) => s.count).join('/'), 'gantries', D.gantries.map((g) => g.visible).join('/'));
// ---- counterweight town
import { Elevator } from '../src/space/elevator.js';
t0 = performance.now();
const el = new Elevator(space, { climbers: 60 });
console.log('elevator ctor ms', (performance.now() - t0).toFixed(0), 'counterLife ms', el.counterLife.buildMs.toFixed(0));
const CL = el.counterLife;
console.log('sites', CL.settle.sites.length, CL.settle.sites.map((s) => s.kind).join(','), 'tris', CL.settle.geo.index.count / 3, 'wheel', CL.wheelGeo.index.count / 3, 'caps', CL.capsules.count);
