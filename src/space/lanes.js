import * as THREE from 'three';
import { createLamps, LAMP } from './lamps.js';
import { CORRIDORS, stationFrame } from './stations.js';
import { R_EARTH, GEO_ALT, MERIDIAN_LON, bodyDir } from './sim.js';
import { HALO_PORTS } from './earthData.js';

// Lane guidance: soft beacons that make the traffic corridors read as designed ways.
//   Harbour   runway pairs along the arrival (amber) and departure (blue) corridors, a
//             gate ring at each corridor mouth; a slow wave runs along them toward the
//             station on arrival and away from it on departure
//   ports     markers up the port columns under the Halo (blue up, amber down)
// Beacons are lamp sprites: filtered, energy-kept below a pixel, gently breathing.

const _v = new THREE.Vector3();

function corridorLamps(dir, color, inward) {
  const d = dir.clone().normalize();
  const e1 = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
  const e2 = new THREE.Vector3().crossVectors(e1, d);
  const out = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const s = 24 + i * i * 7.5;                     // closer together near the Harbour
    const ph = (inward ? i : n - i) / n * 1.6;
    for (const side of [-1, 1]) {
      out.push({ p: d.clone().multiplyScalar(s).addScaledVector(e1, side * (2.4 + i * 0.25)), r: 0.11 + i * 0.012, color, i: 2.6, breathe: 0.4, phase: ph % 1 });
    }
  }
  // the gate ring at the corridor mouth
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    out.push({ p: d.clone().multiplyScalar(21).addScaledVector(e1, Math.cos(a) * 3.2).addScaledVector(e2, Math.sin(a) * 3.2), r: 0.1, color, i: 2.2, breathe: 0.3, phase: k / 8 });
  }
  return out;
}

export class Lanes {
  constructor(space) {
    this.space = space;
    // Harbour corridors: a frame at the Harbour, outside its own body (they reach 1,500 km)
    const up = bodyDir(0, MERIDIAN_LON);
    this.harbourFrame = new THREE.Group();
    this.harbourFrame.position.copy(up).multiplyScalar(R_EARTH + GEO_ALT);
    stationFrame(up, this.harbourFrame.quaternion);
    const lamps = [...corridorLamps(CORRIDORS.dA, LAMP.AMBER, true), ...corridorLamps(CORRIDORS.dD, LAMP.BLUE, false)];
    this.harbourLamps = createLamps(lamps, { minPx: 1.4 });
    this.harbourFrame.add(this.harbourLamps);
    space.earthFixed.add(this.harbourFrame);
    space.addBody('lanesGeo', [this.harbourFrame], () => this.harbourFrame.getWorldPosition(_v), 1500);
    // port columns (body frame, km)
    const pl = [];
    for (const p of HALO_PORTS) {
      const lon = THREE.MathUtils.degToRad(p.lon);
      const dir = bodyDir(0, lon);
      const east = new THREE.Vector3(-Math.sin(lon), 0, -Math.cos(lon));
      for (const upc of [1, -1]) {
        for (let h = 60; h <= 600; h += 60) {
          const base = dir.clone().multiplyScalar(R_EARTH + h).addScaledVector(east, upc * 12);
          pl.push({ p: base.clone().addScaledVector(east, 1.6), r: 0.05, color: upc > 0 ? LAMP.BLUE : LAMP.AMBER, i: 2.0, breathe: 0.35, phase: ((upc > 0 ? h : 660 - h) / 600) % 1 });
          pl.push({ p: base.clone().addScaledVector(east, -1.6), r: 0.05, color: upc > 0 ? LAMP.BLUE : LAMP.AMBER, i: 2.0, breathe: 0.35, phase: ((upc > 0 ? h : 660 - h) / 600) % 1 });
        }
      }
    }
    this.portLamps = createLamps(pl, { minPx: 1.3 });
    space.earthFixed.add(this.portLamps);
    space.addBody('lanesPorts', [this.portLamps], () => _v.set(0, 0, 0), R_EARTH + 700);
  }
}
