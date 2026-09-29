import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { buildFreighter } from '../craft/craftClasses.js';
import { createLamps, LAMP } from './lamps.js';
import { craftInstances, MovingLamps } from './helianthDistrict.js';

// The Earth Road: the freight corridor from the Helianth toward the Earth.
//
// The Helianth sends its power home in its beam; what cannot travel as light (the fuel and
// antimatter its works make, the crews, the spares) goes by ship. Two lanes run under the beam's bearing,
// 45 km above the Helianth's plane (clear of its statite flotilla) and 25 km either side of the
// beam's line: outbound to the Earth on one, inbound on the other. Every 100 km a lane passes
// through a gate: a transponder ring 8 km across on four buoys, eight lamps round it (green
// and white outbound, amber and red inbound) breathing in sequence so the lane reads as a
// flowing avenue of light toward the Earth. Freighters run the lanes, all lying bow to the
// Earth: outbound ones accelerating on their torches, inbound ones coming in drive first,
// braking. The whole road turns with the Earth's direction through the year.
//
// The road runs level between the collector shells, on the Earth's bearing, out to the lattice's
// edge 2,500 km off, where the ships climb out of the shells onto their transfer (the Earth
// lies up to ten degrees out of the Helianth's plane through the year; the beam goes straight).
//
// Units: the road frame is km (+Z the Earth's bearing, +Y the Helianth's up);
// geometry and ship matrices are metres (craftInstances scales them).

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export const ROAD = {
  y: 45, side: 25, z0: 60, len: 2400, gate: 100, gateR: 4, ships: 14, speed: 7.5,  // km, km/s
  shipLen: 1400, range: 1.2e5,
};
/** Lane l (0 outbound, 1 inbound): its centre line x (km, road frame). */
export const laneX = (l) => (l ? -ROAD.side : ROAD.side);
export const gateZ = (g) => ROAD.z0 + ROAD.gate * (g + 0.5);
export const GATES = Math.floor(ROAD.len / ROAD.gate);

/** A lane gate (metres, the ring about local +Z): the transponder ring, four buoys, their struts. */
export function buildGate() {
  const B = new CB(), R = ROAD.gateR * 1000;
  B.torus(R, 60, 64, 6, CK.BRONZE);
  B.torus(R, 64, 64, 4, CK.LANTERN, TAU / 64);
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * TAU + Math.PI / 4, c = V(Math.cos(a) * R, Math.sin(a) * R, 0);
    B.at(c.x, c.y, c.z);
    B.lathe([[20, -220, CK.DARK], [140, -180, CK.HULL], [160, -40, CK.HULL], [160, 40, CK.GLASS], [140, 180, CK.HULL], [20, 220, CK.DARK]], 12);
    B.box(0, 0, 0, 420, 30, 60, CK.RADIATOR);
    B.pop();
    // a dish on each buoy, looking down the lane
    B.at(c.x * 1.06, c.y * 1.06, 120); B.lathe([[10, 0, CK.DARK], [90, 30, CK.HULL], [100, 50, CK.BRONZE], [10, 40, CK.DARK]], 10); B.pop();
  }
  return B.geometry();
}

/** Ship k's lane, its distance along the road (km) at time t, and its heading sign. */
export function shipPose(k, t, out) {
  const lane = k % 2, i = k >> 1, n = ROAD.ships / 2, L = ROAD.len;
  const s0 = (i + 0.37 * lane) / n * L;
  const dir = lane ? -1 : 1;
  const u = (((s0 + dir * ROAD.speed * t) % L) + L) % L;
  // ships keep a little off the lane's axis, never outside the gate's inner half
  const off = 1.2 * Math.sin(i * 2.1), offy = 0.9 * Math.cos(i * 1.7);
  out.set(laneX(lane) + off, ROAD.y + offy, ROAD.z0 + u);
  return dir;
}

export class HelianthRoad {
  /** station: the Helianth's group (km); sunDir: world light direction. */
  constructor(station, sunDir, space) {
    this.station = station; this.sunDir = sunDir;
    this.group = new THREE.Group(); this.group.visible = false; station.add(this.group);
    this.built = false; this.on = false; this.dist = Infinity; this.buildMs = 0;
    this._w = V(); this._d = V(); this._iq = new THREE.Quaternion(); this._m = new THREE.Matrix4(); this._p = V(); this._s = V(1, 1, 1);
    this._x = V(); this._y = V(); this._z = V(); this._basis = new THREE.Matrix4();
    if (space?.addBody) {
      this.body = space.addBody('helianthRoad', [this.group], (v) => (v || V()).copy(station.position), ROAD.z0 + ROAD.len + 10, {
        interval: () => [Math.max(0.05, (this.dist - ROAD.z0 - ROAD.len - 10) * 0.9, this._gap * 0.9), this.dist + ROAD.z0 + ROAD.len + 10],
      });
      this.body.visible = false;
    }
    this._gap = 1;
  }

  build() {
    if (this.built) return;
    const t0 = performance.now();
    const opt = { accent: [1, 0.72, 0.4], lit: 0.6, fill: 0.08 };
    const gm = [], lamps = [];
    for (let l = 0; l < 2; l++) for (let g = 0; g < GATES; g++) {
      const z = gateZ(g), x = laneX(l);
      gm.push(new THREE.Matrix4().makeTranslation(x * 1000, ROAD.y * 1000, z * 1000));
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * TAU;
        const col = l ? (k % 2 ? LAMP.AMBER : LAMP.RED) : (k % 2 ? LAMP.WHITE : LAMP.GREEN);
        // the lamps breathe in a wave running down the lane: outbound away from the Helianth, inbound toward it
        lamps.push({ p: V(x + Math.cos(a) * (ROAD.gateR + 0.25), ROAD.y + Math.sin(a) * (ROAD.gateR + 0.25), z), r: 0.09, color: col, i: 2.6, breathe: 0.85, phase: (((l ? g : -g) * 0.13) % 1 + 1) % 1 });
      }
    }
    this.gateGeo = buildGate();
    this.gates = craftInstances(this.gateGeo, gm, opt);
    this.gates.userData.sunDir = this.sunDir;
    this.gateLamps = createLamps(lamps, { minPx: 1.1 });
    const fr = buildFreighter(ROAD.shipLen);
    this.shipGeo = fr.geo;
    this.ships = craftInstances(fr.geo, Array.from({ length: ROAD.ships }, () => new THREE.Matrix4()), opt, this.gates.material);
    this.ships.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ships.userData.sunDir = this.sunDir;
    // each ship: its torch at the stern (blue-white, big) and a masthead light
    this.torches = new MovingLamps(ROAD.ships, { r: 0.35, color: [0.7, 0.85, 1.0], i: 5, minPx: 1.6 });
    this.heads = new MovingLamps(ROAD.ships, { r: 0.05, color: LAMP.WHITE, i: 2.4, minPx: 1.1, breathe: 0.5 });
    // (the torch sits past the stern: the freighter's drive bell is at z -392 of 1100 m)
    this.stern = 392 / 1100 * ROAD.shipLen / 1000 + 0.25;
    this.group.add(this.gates, this.gateLamps, this.ships, this.torches.mesh, this.heads.mesh);
    this.group.traverse((o) => { o.frustumCulled = false; });
    this.built = true;
    this.buildMs = performance.now() - t0;
  }

  /** The road frame in the station's: +Z the Earth's bearing (the world origin) in the Helianth's plane, +Y its up. */
  orient() {
    this.station.getWorldPosition(this._w);
    const z = this._z.copy(this._w).negate().normalize().applyQuaternion(this._iq.copy(this.station.quaternion).invert());
    // (level with the shells: the Earth's bearing in the Helianth's plane)
    z.y = 0;
    if (z.lengthSq() < 1e-8) return;
    z.normalize();
    const y = this._y.set(0, 1, 0);
    const x = this._x.crossVectors(y, z);
    this._basis.makeBasis(x, y, z);
    this.group.quaternion.setFromRotationMatrix(this._basis);
  }

  update(realTime, camWorld) {
    if (!camWorld) return;
    this.station.getWorldPosition(this._w);
    this.dist = camWorld.distanceTo(this._w);
    const on = this.dist < ROAD.range;
    if (on && !this.built) this.build();
    this.on = on && this.built;
    this.group.visible = this.on;
    if (this.body) this.body.visible = this.on;
    if (!this.on) return;
    this.orient();
    // nearest approach of the camera to the road (a lane's line), for the depth interval
    const c = this._d.copy(camWorld).sub(this._w).applyQuaternion(this._iq.copy(this.station.quaternion).invert()).applyQuaternion(this._iq.copy(this.group.quaternion).invert());
    const zc = Math.min(Math.max(c.z, ROAD.z0), ROAD.z0 + ROAD.len);
    this._gap = Math.max(0.05, Math.min(Math.hypot(c.x - laneX(0), c.y - ROAD.y, c.z - zc), Math.hypot(c.x - laneX(1), c.y - ROAD.y, c.z - zc)) - ROAD.gateR - 1);
    this.animate(realTime);
  }

  animate(t) {
    const m = this._m, p = this._p;
    for (let k = 0; k < ROAD.ships; k++) {
      shipPose(k, t, p);
      // every ship lies bow to the Earth: outbound ones accelerate on their torches, inbound
      // ones come in drive first, braking toward the Helianth (the torch ahead of their motion)
      m.makeTranslation(p.x * 1000, p.y * 1000, p.z * 1000);
      this.ships.setMatrixAt(k, m);
      this.heads.set(k, p.set(p.x, p.y + 0.12, p.z + 0.3));
      this.torches.set(k, p.set(p.x, p.y - 0.12, p.z - 0.3 - this.stern));
    }
    this.ships.instanceMatrix.needsUpdate = true; this.torches.commit(); this.heads.commit();
  }

  triangles() {
    if (!this.built) return 0;
    const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    return tri(this.gateGeo) * this.gates.count + tri(this.shipGeo) * this.ships.count;
  }
}
