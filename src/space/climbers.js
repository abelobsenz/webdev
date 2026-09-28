import * as THREE from 'three';
import { buildClimber } from '../craft/craftClasses.js';
import { craftMesh, addLamps, KM } from './craftMesh.js';
import { R_EARTH, GEO_ALT, COUNTERWEIGHT_ALT } from './sim.js';
import { stationFrame } from './stations.js';

// Climber cars on Meridian's tether. The elevator draws every climber as a soft point from
// the sim clock; within a few tens of km the nearest ones are real cars, placed by the same
// schedule (a CPU mirror of the point shader), while the points fade out.

export const CLIMB_PERIOD = 53400;         // s: surface to GEO at ~2,400 km/h

/** Altitude (km) of a climber with schedule aC = [offset, dir, run] at sim time t (mod period). */
export function climberAlt(t, a0, dir, run) {
  let ph = ((t + a0) / CLIMB_PERIOD) % 1;
  if (ph < 0) ph += 1;
  let s = ph < 0.02 ? ph * ph / 0.04 : (ph > 0.98 ? 1 - (1 - ph) * (1 - ph) / 0.04 : ph);
  if (dir < 0) s = 1 - s;
  return run < 0.5 ? s * GEO_ALT : GEO_ALT + s * (COUNTERWEIGHT_ALT - GEO_ALT);
}

export class ClimberCars {
  constructor(space, up, schedule, count = 4) {
    this.space = space;
    this.up = up.clone();
    this.guideAxis = new THREE.Vector3().crossVectors(up,new THREE.Vector3(0,1,0)).normalize();
    this.schedule = schedule;               // flat [offset, dir, run, ...]
    this.group = new THREE.Group();
    const car = buildClimber(1);
    this.cars = [];
    for (let i = 0; i < count; i++) {
      const m = craftMesh(car.geo, { accent: [1.0, 0.78, 0.5], lit: 0.7 });
      addLamps(m, car.lamps, { minPx: 1.2 });
      m.visible = false;
      stationFrame(this.up, m.quaternion);
      this.group.add(m);
      this.cars.push(m);
    }
    this._cam = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._best = [];
  }

  update(sim, realTime, dt, space) {
    // camera in the body frame
    const inv = this._inv || (this._inv = new THREE.Quaternion());
    inv.copy(sim.earthQuat).invert();
    const cam = this._cam.copy(space.camera.position).applyQuaternion(inv);
    // distance from the camera to the tether line
    const along = cam.dot(this.up);
    const off = this._p.copy(cam).addScaledVector(this.up, -along).length();
    for (const c of this.cars) c.visible = false;
    if (off > 90) return;
    const t = sim.t % CLIMB_PERIOD;
    const S = this.schedule;
    const best = this._best;
    best.length = 0;
    for (let i = 0; i < S.length; i += 3) {
      const alt = climberAlt(t, S[i], S[i + 1], S[i + 2]);
      const r = R_EARTH + alt;
      const dAlong = r - along;
      const d = Math.sqrt(dAlong * dAlong + off * off);
      if (d > 90) continue;
      best.push({ d, r, dir: S[i + 1] });
    }
    best.sort((a, b) => a.d - b.d);
    for (let k = 0; k < this.cars.length && k < best.length; k++) {
      const c = this.cars[k];
      // up and down cars ride opposite faces of the ribbon
      c.position.copy(this.up).multiplyScalar(best[k].r).addScaledVector(this.guideAxis,best[k].dir*.12);
      c.visible = true;
      c.userData.dir = best[k].dir;
    }
  }
}

export { KM };
