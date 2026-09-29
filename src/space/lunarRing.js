import * as THREE from 'three';
import { lunarInstanced, createLunarMaterial } from './lunarMaterial.js';
import { kit } from './lunarKit.js';

// Expresses on the ring's transit rails: the equatorial ring 380 km up (lunarPort.js
// buildLunarRingDistricts) carries two fast rails, tori of 45 m section 1.7 km either side of
// its centreline. Trains of eight cars (the kit's tram car at four times the size: 97 m long,
// lit saloons) run on top of them at 250 m/s, one direction on each rail, two hundred around
// the ring on each - a train every 66 km, so about one every four minutes passes a hall.
//
// Only the trains within a few hundred kilometres of the camera are drawn (the instance list
// is refilled each frame from the ones in the window), in metres about the Moon's centre.

export const RING_R = 2117000;                          // the districts' deck radius, metres (buildLunarRingDistricts)
export const RAIL_Z = 1700, RAIL_TOP = 25 + 45;         // rail offsets (metres): across, and radially to its top
const PER_RAIL = 200, CARS = 8, SCALE = 4, PITCH = 24.4 * SCALE, SPEED = 250;
const WINDOW = 260000;                                   // metres of ring either side of the camera

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _c = new THREE.Vector3(), _inv = new THREE.Matrix4();

export class LunarRingTrains {
  constructor(parent) {
    this.mat = createLunarMaterial({ lit: 0.8 });
    const max = Math.ceil(2 * WINDOW / (2 * Math.PI * RING_R / PER_RAIL) + 2) * 2 * CARS;
    this.cars = lunarInstanced(kit('tram'), max, {}, this.mat, { tint: true });
    this.cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cars.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.cars.count = 0;
    this.cars.name = 'Ring expresses';
    this.max = max;
    this.parent = parent;
    parent.add(this.cars);
  }

  /** Angle (rad, Moon frame, about +y from +x toward +z) of train i on rail r at time t. */
  static angle(r, i, t) {
    const dir = r ? -1 : 1;
    return (i / PER_RAIL) * Math.PI * 2 + dir * SPEED * t / RING_R + r * 0.013;
  }

  /** Fill the instance list with the cars near the camera (world position). */
  update(t, camWorld) {
    _inv.copy(this.parent.matrixWorld).invert();
    _c.copy(camWorld).applyMatrix4(_inv).multiplyScalar(1000);   // camera in Moon-frame metres
    const rc = Math.hypot(_c.x, _c.z);
    let n = 0;
    if (Math.abs(rc - RING_R) < WINDOW && Math.abs(_c.y) < WINDOW) {
      const ac = Math.atan2(_c.z, _c.x), win = WINDOW / RING_R;
      for (let r = 0; r < 2; r++) {
        const dir = r ? -1 : 1, zOff = r ? -RAIL_Z : RAIL_Z;
        for (let i = 0; i < PER_RAIL; i++) {
          const a = LunarRingTrains.angle(r, i, t);
          let d = a - ac;
          d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
          if (Math.abs(d) > win) continue;
          for (let k = 0; k < CARS && n < this.max; k++) {
            const ak = a - dir * k * PITCH / RING_R;
            const cs = Math.cos(ak), sn = Math.sin(ak);
            _y.set(cs, 0, sn);                                // radial: the rail's top faces out
            _z.set(-sn * dir, 0, cs * dir);                   // along the direction of travel
            _x.crossVectors(_y, _z);
            _m.makeBasis(_x.multiplyScalar(SCALE), _y.multiplyScalar(SCALE), _z.multiplyScalar(SCALE));
            _m.setPosition(cs * (RING_R + RAIL_TOP), zOff, sn * (RING_R + RAIL_TOP));
            this.cars.setMatrixAt(n, _m);
            const lead = k === 0 || k === CARS - 1;
            this.cars.instanceColor.setXYZ(n, lead ? 0.86 : 0.14, lead ? 0.82 : 0.26, lead ? 0.74 : 0.55);
            n++;
          }
        }
      }
    }
    this.cars.count = n;
    this.cars.visible = n > 0;
    if (n) { this.cars.instanceMatrix.needsUpdate = true; this.cars.instanceColor.needsUpdate = true; }
    return n;
  }
}
