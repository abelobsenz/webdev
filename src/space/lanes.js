import * as THREE from 'three';
import { createLamps, LAMP } from './lamps.js';
import { CORRIDORS, stationFrame } from './stations.js';
import { R_EARTH, GEO_ALT, MERIDIAN_LON, bodyDir } from './sim.js';
import { HALO_PORTS } from './earthData.js';
import { CB, CK } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { craftMesh, placeMerge, KM } from './craftMesh.js';

// Lane guidance: soft beacons that make the traffic corridors read as designed ways.
//   Harbour   runway pairs along the arrival (amber) and departure (blue) corridors, a
//             gate ring at each corridor mouth; a slow wave runs along them toward the
//             station on arrival and away from it on departure
//   ports     markers up the port columns under the Halo (blue up, amber down)
// Beacons are lamp sprites: filtered, energy-kept below a pixel, gently breathing.

const _v = new THREE.Vector3();

/**
 * A lane buoy (metres, axis +Y): a spindle with a bronze collar, a lantern crown carrying the
 * beacon, and a gyro ring on three spokes. Closed solids throughout. Returns { geo, top }.
 */
export function buildBuoy() {
  const B = new CB();
  B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  lathe(B, [[0.1, -45, CK.DARK], [9, -42, CK.DARK], [12, -34, CK.BRONZE], [12, 18, CK.HULL], [15, 22, CK.BRONZE], [15, 26, CK.BRONZE], [9, 30, CK.HULL], [5, 40, CK.LANTERN], [0.1, 44, CK.LANTERN]], 14);
  B.pop();
  B.push(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  B.torus(26, 2.2, 32, 6, CK.BRONZE);
  B.pop();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    B.tube([new THREE.Vector3(Math.cos(a) * 11, 0, Math.sin(a) * 11), new THREE.Vector3(Math.cos(a) * 25, 0, Math.sin(a) * 25)], 1.4, 6, CK.DARK);
  }
  return { geo: B.geometry(), top: 44 };
}

/** Beacon buoys and their lamps along one corridor (Harbour frame, km). */
function corridorLamps(dir, color, inward, buoys) {
  const d = dir.clone().normalize();
  const e1 = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
  const e2 = new THREE.Vector3().crossVectors(e1, d);
  const out = [];
  const n = 14;
  // buoys grow along the road (seen by ships at speed from further off); lamps sit on their crowns
  const put = (p, size, lamp) => {
    buoys.push({ p, size });
    out.push({ ...lamp, p: p.clone().add(new THREE.Vector3(0, (BUOY_TOP + 3) * size * KM, 0)), r: 0.011 * size });
  };
  for (let i = 0; i < n; i++) {
    const s = 24 + i * i * 7.5;                     // closer together near the Harbour
    const ph = (inward ? i : n - i) / n * 1.6;
    for (const side of [-1, 1]) {
      put(d.clone().multiplyScalar(s).addScaledVector(e1, side * (2.4 + i * 0.25)), 1 + i * 0.9, { color, i: 3.2, breathe: 0.4, phase: ph % 1 });
    }
  }
  // the gate ring at the corridor mouth
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    put(d.clone().multiplyScalar(21).addScaledVector(e1, Math.cos(a) * 3.2).addScaledVector(e2, Math.sin(a) * 3.2), 1.4, { color, i: 3.0, breathe: 0.3, phase: k / 8 });
  }
  return out;
}
const BUOY_TOP = 44;

export class Lanes {
  constructor(space) {
    this.space = space;
    // Harbour corridors: a frame at the Harbour, outside its own body (they reach 1,500 km)
    const up = bodyDir(0, MERIDIAN_LON);
    this.harbourFrame = new THREE.Group();
    this.harbourFrame.position.copy(up).multiplyScalar(R_EARTH + GEO_ALT);
    stationFrame(up, this.harbourFrame.quaternion);
    const buoys = [];
    const lamps = [...corridorLamps(CORRIDORS.dA, LAMP.AMBER, true, buoys), ...corridorLamps(CORRIDORS.dD, LAMP.BLUE, false, buoys)];
    this.harbourLamps = createLamps(lamps, { minPx: 1.4 });
    this.harbourFrame.add(this.harbourLamps);
    // the buoys themselves (metres, one merged mesh in the lane frame)
    const buoy = buildBuoy();
    this.buoyData = buoys.map((b) => ({ ...b, m: new THREE.Matrix4().compose(b.p.clone().multiplyScalar(1000), new THREE.Quaternion(), new THREE.Vector3(b.size, b.size, b.size)) }));
    this.buoys = craftMesh(placeMerge(this.buoyData.map((b) => ({ geo: buoy.geo, m: b.m }))), { accent: [1.0, 0.72, 0.45], lit: 0.4 });
    this.harbourFrame.add(this.buoys);
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
    // the port columns' buoys: one beacon crown per lamp, the same set at every port (port frame,
    // metres; a body per port so each column keeps its own depth slice)
    const colBuoys = portColumnBuoys();
    this.portColumnData = colBuoys;
    const colGeo = placeMerge(colBuoys.map((b) => ({ geo: buoy.geo, m: b.m })));
    this.portColumns = [];
    for (const p of HALO_PORTS) {
      const lon = THREE.MathUtils.degToRad(p.lon);
      const dir = bodyDir(0, lon);
      const g = new THREE.Group();
      g.position.copy(dir).multiplyScalar(R_EARTH);
      stationFrame(dir, g.quaternion);
      const m = craftMesh(colGeo, { accent: [1.0, 0.72, 0.45], lit: 0.4 });
      g.add(m);
      space.earthFixed.add(g);
      const c = new THREE.Vector3();
      const body = space.addBody(`portColumns-${p.name}`, [g], () => g.localToWorld(c.set(0, 330, 0)), 300);
      this.portColumns.push({ group: g, mesh: m, body, center: c });
    }
  }

  update(sim, realTime, dt, space) {
    // the buoys only when a column's buoys can cover a pixel (they are 350 m tall)
    if (!this.portColumns) return;
    const cam = space.camera, k = space.size.y * 0.5 / Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
    for (const c of this.portColumns) {
      c.group.localToWorld(c.center.set(0, 330, 0));
      const d = Math.max(c.center.distanceTo(cam.position) - 300, 1);
      c.body.visible = (0.35 / d) * k > 0.6;
    }
  }
}

/**
 * Buoys up the port columns (port frame: x west, y up from the
 * ground, metres): a pair at every 60 km of each column, 1.6 km to either side of the column's
 * line, their lantern crowns carrying the column lamps. The columns run 12 km east (arrivals,
 * climbing) and 12 km west (departures) of the port's centre line.
 */
export function portColumnBuoys(size = 8) {
  const out = [];
  for (const upc of [1, -1]) for (let h = 60; h <= 600; h += 60) for (const sd of [1, -1]) {
    // east is -x in the port frame
    const x = -(upc * 12 + sd * 1.6) * 1000;
    const lamp = new THREE.Vector3(x, h * 1000, 0);
    const base = lamp.clone().add(new THREE.Vector3(0, -(BUOY_TOP + 3) * size, 0));
    out.push({ lamp, base, size, column: upc, m: new THREE.Matrix4().compose(base, new THREE.Quaternion(), new THREE.Vector3(size, size, size)) });
  }
  return out;
}
