// Construction cost of the sun domain's modules (headless). Run: node tools/prof-sun-domain.mjs
import * as THREE from 'three';
import { SpaceSim } from '../src/space/sim.js';
import { Hearth } from '../src/space/hearth.js';
import { SunSwarm } from '../src/space/sun.js';
import { WorkingStations, buildSolarCollector, buildFoundry } from '../src/space/workingStations.js';

const sim = new SpaceSim(); sim.syncFromHours(12);
const space = {
  scene: new THREE.Scene(), earthFixed: new THREE.Group(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e7), size: new THREE.Vector2(1280, 720), sim,
  addBody(name) { const b = { name }; this.bodies.push(b); return b; },
};
const out = {};
const t = (n, f) => { const a = performance.now(); const r = f(); out[n] = Math.round(performance.now() - a); return r; };
t('warmup', () => buildSolarCollector());
t('buildFoundry', () => buildFoundry());
t('buildSolarCollector', () => buildSolarCollector());
t('Hearth', () => new Hearth(space, { bhSteps: 110, bhScale: 0.6 }));
t('SunSwarm', () => new SunSwarm(space, { swarm: 24000 }));
const w = t('WorkingStations', () => new WorkingStations(space));
t('district.build', () => w.district.build());
t('yard.build', () => w.yard.build());
t('swarm.build', () => w.swarm.build());
console.log(JSON.stringify(out));
