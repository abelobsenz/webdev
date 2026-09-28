import * as THREE from 'three';
import { buildTug } from '../craft/craftClasses.js';
import { craftMesh, addEngines, addLamps } from './craftMesh.js';
import { buildBuoy } from './lanes.js';
import { LAMP } from './lamps.js';
import { placeMerge } from './craftMesh.js';

// THE HELIANTH AT WORK (metres, the collector's frame: +Y away from the Sun, the petals near
// y = 0 reaching 14.5 km out, the service crown on the hub at 3.5 km).
//
//   tugs     three service tugs fly closed loops from their holding points above the crown out
//            to a pair of petals, hovering over each receiver in turn, and back. Every loop keeps
//            to the petals between the radiator fins (the fins stand over every other petal),
//            clears the habitat wheel and its shield, and never enters the crown's reserved
//            departure column
//   relays   four relay beacons on the rim of the working field, their crowns lit, the
//            station's link to the swarm's traffic control
//
// Poses are analytic in real time; the verifier samples them against the station's triangles.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const D = (deg) => (deg * Math.PI) / 180;
const polar = (r, deg, y) => V(Math.cos(D(deg)) * r, y, Math.sin(D(deg)) * r);

export const HELIANTH = { hold: 1800, holdY: 5200, midR: 6500, midY: 3000, hoverR: 11000, hoverY: 1150, tug: 360 };

/** Catmull-Rom through a closed list of points. */
function loopPoint(pts, s, out) {
  const n = pts.length, x = (((s % 1) + 1) % 1) * n, i = Math.floor(x), t = x - i;
  const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
  const t2 = t * t, t3 = t2 * t;
  for (const k of ['x', 'y', 'z']) out[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  return out;
}

/**
 * The tug circuits: [holding point, over the first petal's root, hover A, over the petal between,
 * hover B, over the second petal's root] with a dwell at each hover. Petal azimuths (degrees, atan2(z, x)) lie between
 * the fins (fins at 0, 60, 120 ... degrees).
 */
export function helianthCircuits() {
  const H = HELIANTH;
  return [[60, 30, 90], [180, 150, 210], [300, 270, 330]].map(([hold, a, b], i) => ({
    // (the crossing between the two hovers follows the rim of the field over the petal between)
    pts: [polar(H.hold, hold, H.holdY), polar(H.midR, a, H.midY), polar(H.hoverR, a, H.hoverY), polar(H.hoverR + 200, (a + b) / 2, H.hoverY + 150), polar(H.hoverR, b, H.hoverY), polar(H.midR, b, H.midY)],
    hovers: [2, 4], T: 460, dwell: 0.13, offset: i / 3,
  }));
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
/** Pose on a circuit at real time t (metres). Returns the throttle. */
export function circuitPose(c, t, outPos, outFwd) {
  // the loop parameter pauses at each hover: map time to s with two dwells
  const u = (((t / c.T) + c.offset) % 1 + 1) % 1, n = c.pts.length;
  const moveFrac = 1 - c.dwell * c.hovers.length;
  // piecewise: legs between control points share moveFrac, hovers take c.dwell each
  const legs = n, legT = moveFrac / legs;
  let acc = 0, s = 0, hovering = false;
  for (let i = 0; i < n; i++) {
    if (u < acc + legT) {
      // ease out of and into the hovers only: elsewhere the tug keeps moving through its turns
      const x = (u - acc) / legT, a = c.hovers.includes(i), b = c.hovers.includes((i + 1) % n);
      const e = a && b ? smooth(0, 1, x) : a ? x * x : b ? 1 - (1 - x) * (1 - x) : x;
      s = (i + e) / n; break;
    }
    acc += legT;
    const next = (i + 1) % n;
    if (c.hovers.includes(next)) {
      if (u < acc + c.dwell) { s = next / n; hovering = true; break; }
      acc += c.dwell;
    }
    s = ((i + 1) % n) / n;
  }
  loopPoint(c.pts, s, outPos);
  loopPoint(c.pts, s + 0.004, _a);
  loopPoint(c.pts, s - 0.004, _b);
  outFwd.subVectors(_a, _b);
  if (outFwd.lengthSq() < 1e-6) outFwd.set(1, 0, 0);
  outFwd.normalize();
  return hovering ? 0.05 : 0.5;
}

/** Relay beacons on the rim of the working field (metres). */
export function helianthRelays() {
  const out = [];
  for (let k = 0; k < 4; k++) {
    const p = polar(18500, 45 + k * 90, 600);
    out.push({ base: p, m: new THREE.Matrix4().compose(p, new THREE.Quaternion(), V(14, 14, 14)), top: p.clone().add(V(0, 44 * 14 + 40, 0)) });
  }
  return out;
}

export class HelianthTraffic {
  constructor(station, sunDir) {
    this.station = station;
    const tug = buildTug(HELIANTH.tug);
    this.circuits = helianthCircuits();
    this.tugs = this.circuits.map((c) => {
      const m = craftMesh(tug.geo, { accent: [1.0, 0.72, 0.4], lit: 0.5, fill: 0.075 });
      m.userData.sunDir = sunDir;
      const engines = addEngines(m, tug.glows, { scale: 0.7, length: 7, color: 0xffc080, core: 0xfff4e0, throttle: 0 });
      addLamps(m, tug.lamps, { minPx: 1.2 });
      m.frustumCulled = true;
      station.add(m);
      return { mesh: m, c, engines, pos: V(0, 0, 0), fwd: V(0, 0, 1) };
    });
    const relays = helianthRelays();
    this.relayData = relays;
    const buoy = buildBuoy();
    const rm = craftMesh(placeMerge(relays.map((r) => ({ geo: buoy.geo, m: r.m }))), { accent: [1.0, 0.72, 0.4], lit: 0.5, fill: 0.075 });
    rm.userData.sunDir = sunDir;
    addLamps(rm, relays.map((r, k) => ({ p: r.top, r: 60, color: k % 2 ? LAMP.AMBER : LAMP.WHITE, i: 3.2, breathe: 0.4, phase: k / 4 })), { minPx: 1.4 });
    rm.frustumCulled = true;
    station.add(rm);
    this.relays = rm;
    this._m = new THREE.Matrix4(); this._x = V(0, 0, 0); this._y = V(0, 0, 0);
  }

  update(realTime) {
    for (const t of this.tugs) {
      const thr = circuitPose(t.c, realTime, t.pos, t.fwd);
      t.mesh.position.copy(t.pos).multiplyScalar(0.001);
      // level flight: +Y stays away from the Sun (the station's up)
      this._x.crossVectors(V(0, 1, 0), t.fwd);
      if (this._x.lengthSq() < 1e-6) this._x.set(1, 0, 0);
      this._x.normalize();
      this._y.crossVectors(t.fwd, this._x);
      t.mesh.quaternion.setFromRotationMatrix(this._m.makeBasis(this._x, this._y, t.fwd));
      for (const e of t.engines) e.setThrottle(thr);
    }
  }
}
