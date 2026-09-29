import * as THREE from 'three';
import { CB } from '../craft/craftGeometry.js';
import { LK, lunarMesh, lunarInstanced, createLunarMaterial } from './lunarMaterial.js';
import { LAMP, createLamps } from './lamps.js';
import { addLamps, pixelRadius } from './craftMesh.js';
import { mulberry } from './lunarKit.js';
import { R_MOON } from './sim.js';

// The Moon's own orbital stations, below the ring: real circular orbits about the Moon
// (GM 4902.8 km^3/s^2), each station-kept in a plane that never crosses the Lift's tether or
// the Exchange, at a height that never meets the ring.
//
//   Selene Wheel   110 km up, 32 degrees inclined: the Moon's orbital town. Two counter-
//                  rotating habitat rings 964 m across (1 g on the floor at 0.146 rad/s, one
//                  turn in 43 s, their spins cancelling), each twelve decks of lit windows
//                  under a glazed roof over parkland, on spokes with lift cars running them; a
//                  despun hub with docking arms and ferries berthed, the radiator mast turned
//                  edge-on to the Sun and the solar mast turned to face it.
//   Aitken Depot   293 km up, polar: the propellant depot for the far side and the poles.
//                  A kilometre of truss hanging along the local vertical (gravity-gradient
//                  stable), gold-foiled tank clusters, a lit crew hangar, a robot arm at work,
//                  a tanker alongside, sun-tracking wings.
//   Relays         six comm and navigation relays 203 km up in two planes, strobing.
//   Ferries        the shuttles between them and the surface, trailing and leading the
//                  stations along their orbits with running lights and engine glow.
//
// Station geometry is metres in each station's own frame (the lunar material: sunlight cut
// by the Moon's limb, earthlight in the night); the groups are km in the Moon frame.

const TAU = Math.PI * 2;
const GM = 4902.8;                                  // km^3/s^2
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _s = new THREE.Vector3();
const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _w = new THREE.Vector3();
const _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);

/** Orbit records (Moon frame): radius km, plane normal, phase at t = 0. */
export const ORBITS = {
  wheel: { r: R_MOON + 110, n: V(0.42, 0.86, 0.29).normalize(), ph: 0.4 },
  depot: { r: R_MOON + 293, n: V(0.96, 0.0, 0.28).normalize(), ph: 2.1 },
  relayA: { r: R_MOON + 203, n: V(-0.5, 0.62, 0.6).normalize(), ph: 0 },
  relayB: { r: R_MOON + 203, n: V(0.62, -0.35, 0.7).normalize(), ph: 1 },
};
for (const o of Object.values(ORBITS)) {
  o.u = new THREE.Vector3().crossVectors(o.n, Math.abs(o.n.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
  o.v = new THREE.Vector3().crossVectors(o.n, o.u);
  o.w = Math.sqrt(GM / (o.r * o.r * o.r));        // rad/s
  o.T = TAU / o.w;
}
/** Moon-frame position (km) on an orbit at time t, phase offset dph. */
export function orbitPos(o, t, dph = 0, out = new THREE.Vector3(), dr = 0) {
  const a = o.ph + o.w * t + dph;
  return out.copy(o.u).multiplyScalar(Math.cos(a)).addScaledVector(o.v, Math.sin(a)).multiplyScalar(o.r + dr);
}

// ------------------------------------------------------------------ geometry helpers --

/** Cylinder band radius R about local z, z0..z1, facing out (sign +1) or in (-1). Facade (arc m, z). */
function band(B, R, z0, z1, seg, k, sign = 1, a0 = 0, a1 = TAU) {
  for (let i = 0; i < seg; i++) {
    const a = a0 + (a1 - a0) * i / seg, b = a0 + (a1 - a0) * (i + 1) / seg, am = (a + b) / 2;
    const p0 = B.v(Math.cos(a) * R, Math.sin(a) * R, z0, a * R, z0, k), p1 = B.v(Math.cos(b) * R, Math.sin(b) * R, z0, b * R, z0, k);
    const p2 = B.v(Math.cos(b) * R, Math.sin(b) * R, z1, b * R, z1, k), p3 = B.v(Math.cos(a) * R, Math.sin(a) * R, z1, a * R, z1, k);
    const h = V(Math.cos(am) * sign, Math.sin(am) * sign, 0);
    B.tri(p0, p1, p2, h); B.tri(p0, p2, p3, h);
  }
}
/** Annulus R0..R1 in the plane z, facing +z (sign +1) or -z. Facade (arc m at R1, r - R0): decks stack outward. */
function annulus(B, R0, R1, z, seg, k, sign = 1, a0 = 0, a1 = TAU) {
  const h = V(0, 0, sign);
  for (let i = 0; i < seg; i++) {
    const a = a0 + (a1 - a0) * i / seg, b = a0 + (a1 - a0) * (i + 1) / seg;
    const p0 = B.v(Math.cos(a) * R0, Math.sin(a) * R0, z, a * R1, 0, k), p1 = B.v(Math.cos(b) * R0, Math.sin(b) * R0, z, b * R1, 0, k);
    const p2 = B.v(Math.cos(b) * R1, Math.sin(b) * R1, z, b * R1, R1 - R0, k), p3 = B.v(Math.cos(a) * R1, Math.sin(a) * R1, z, a * R1, R1 - R0, k);
    B.tri(p0, p1, p2, h); B.tri(p0, p2, p3, h);
  }
}
/** Square truss along local z (centre x, y), width w, bays of length L: longerons, frames, diagonals. */
function truss(B, x, y, z0, z1, w, L, k = LK.HULL, t = 0.9) {
  const n = Math.max(1, Math.round((z1 - z0) / L)), dz = (z1 - z0) / n, h = w / 2;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box(x + sx * h, y + sy * h, (z0 + z1) / 2, t, t, z1 - z0, k);
  for (let i = 0; i <= n; i++) {
    const z = z0 + i * dz;
    B.box(x, y - h, z, w, t * 0.8, t * 0.8, k); B.box(x, y + h, z, w, t * 0.8, t * 0.8, k);
    B.box(x - h, y, z, t * 0.8, w, t * 0.8, k); B.box(x + h, y, z, t * 0.8, w, t * 0.8, k);
    if (i === n) break;
    // one diagonal per face, alternating (a Warren truss)
    const zm = z + dz / 2, len = Math.hypot(w, dz), ang = Math.atan2(w, dz) * (i % 2 ? 1 : -1);
    for (const [fx, fy, axis] of [[0, -h, 'y'], [0, h, 'y'], [-h, 0, 'x'], [h, 0, 'x']]) {
      if (axis === 'y') { B.at(x + fx, y + fy, zm, 0, ang, 0); B.box(0, 0, 0, t * 0.6, t * 0.6, len, k); B.pop(); }
      else { B.at(x + fx, y + fy, zm, -ang, 0, 0); B.box(0, 0, 0, t * 0.6, t * 0.6, len, k); B.pop(); }
    }
  }
}
/** A sphere (lathe about local z) at x, y, z. */
function sphere(B, x, y, z, r, k, seg = 16) {
  const prof = [];
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + Math.PI * i / 8; prof.push([Math.cos(a) * r, Math.sin(a) * r, k]); }
  B.at(x, y, z); B.lathe(prof, seg); B.pop();
}
/** A radial arm from the hub at angle a (about z) at height z: base r0 to tip r1, with a docking collar. */
function dockArm(B, a, z, r0, r1, lamps) {
  B.at(0, 0, z, 0, 0, a);
  B.box((r0 + r1) / 2, 0, 0, r1 - r0, 7, 7, LK.HULL);
  B.box((r0 + r1) / 2, 4.2, 0, r1 - r0 - 6, 1.4, 5, LK.SIGN);          // the lit gallery along the arm
  B.box((r0 + r1) / 2, -4.2, 0, r1 - r0 - 6, 1.4, 5, LK.GLASS);
  B.push(new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(r1, 0, 0));
  B.lathe([[5.5, -2, LK.DARK], [6.5, 0, LK.BRONZE], [6.5, 3, LK.BRONZE], [4.2, 4.5, LK.HAZARD], [3.4, 4.5, LK.DARK]], 20);
  B.pop();
  B.pop();
  const c = Math.cos(a), s = Math.sin(a);
  lamps.push({ p: V(c * (r1 + 5) - s * 7, s * (r1 + 5) + c * 7, z), r: 1.6, color: LAMP.GREEN, i: 2.4 });
  lamps.push({ p: V(c * (r1 + 5) + s * 7, s * (r1 + 5) - c * 7, z), r: 1.6, color: LAMP.RED, i: 2.4 });
  lamps.push({ p: V(c * (r1 - 2), s * (r1 - 2), z + 6), r: 2.4, color: LAMP.WHITE, i: 1.6, breathe: 0.6 });
}

// --------------------------------------------------------------------- Selene Wheel --

export const WHEEL = { Ri: 436, Ro: 482, hz: 26, ringZ: 96, spokes: 6, hubR: 44, hubL: 345, spin: Math.sqrt(9.81 / 482) };

/** One habitat ring (about local z, centred on z = 0): { geo, lamps }. */
export function buildWheelRing(seed = 1) {
  const { Ri, Ro, hz, spokes } = WHEEL;
  const B = new CB();
  const lamps = [];
  const rnd = mulberry(seed * 977 + 5);
  const seg = 288;
  band(B, Ro, -hz, hz, seg, LK.HULL, 1);                 // the floor's underside: shield hull
  band(B, Ri, -hz, hz, seg, LK.CONSERVATORY, -1);        // the glazed roof over the parkland
  annulus(B, Ri, Ro, hz, seg, LK.GLASS, 1);              // twelve decks of windows each side
  annulus(B, Ri, Ro, -hz, seg, LK.GLASS, -1);
  // lit signage and a promenade band on both faces, just inside the rim (the station's name
  // and the district names, glowing)
  annulus(B, Ro - 5, Ro - 1.2, hz + 0.25, seg, LK.SIGN, 1);
  annulus(B, Ro - 5, Ro - 1.2, -hz - 0.25, seg, LK.SIGN, -1);
  // shield ribs every 7.5 degrees, wrapped over both faces (the ring's frames), and service
  // blisters, radiator panels and hatches between them on the hull
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    B.at(0, 0, 0, 0, 0, a);
    B.box(Ro + 1.6, 0, 0, 3.2, 4.5, 2 * hz + 7, LK.DARK);
    for (const s of [-1, 1]) B.box((Ri + Ro) / 2 + 1.5, 0, s * (hz + 2.1), Ro - Ri + 6, 2.2, 3.4, LK.HULL);
    B.box(Ri - 2, 0, 0, 3, 3.4, 2 * hz + 5, LK.BRONZE);  // the roof's arch frames
    // between the ribs: alternating radiator panels and hatch blisters on the hull
    B.push(new THREE.Matrix4().makeRotationZ(TAU / 96));
    if (i % 2) {
      B.box(Ro + 2.4, 0, 0, 1, 26, 34, LK.RADIATOR);
      B.box(Ro + 1.2, 0, 0, 2.4, 2, 36, LK.CONDUIT);
    } else {
      const bl = 8 + rnd() * 6;
      B.box(Ro + 2.5, 0, (rnd() - 0.5) * 20, 5, bl, bl * 0.8, LK.PANEL);
      B.box(Ro + 1.5, 7, 12, 3, 3, 3, LK.HAZARD);
    }
    B.pop();
    B.pop();
    lamps.push({ p: V(Math.cos(a) * (Ro + 3.5), Math.sin(a) * (Ro + 3.5), (i % 2 ? 1 : -1) * (hz + 3)), r: 2.2, color: LAMP.AMBER, i: 1.4 });
  }
  // spoke towers where the spokes meet the roof, and the spokes themselves with their lift
  // shafts (the cars run in them: see update), conduits alongside
  for (let s = 0; s < spokes; s++) {
    const a = (s / spokes) * TAU;
    B.at(0, 0, 0, 0, 0, a);
    B.box(Ri - 17, 0, 0, 34, 30, 44, LK.GLASS);
    B.box(Ri - 35, 0, 0, 2.5, 32, 46, LK.LANTERN);
    B.box(Ri - 17, 15.4, 0, 30, 0.8, 40, LK.SIGN);
    B.push(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    B.lathe([[8.5, WHEEL.hubR + 12, LK.HULL], [8.5, Ri - 36, LK.HULL]], 16);
    B.pop();
    for (const o of [-11, 11]) B.box((Ri - 36 + 64) / 2, o, 0, Ri - 36 - 64, 1.6, 1.6, LK.CONDUIT);
    B.box(WHEEL.hubR + 14, 0, 0, 8, 22, 22, LK.BRONZE);  // the spoke's root, riding clear of the hub's bearing
    B.pop();
    lamps.push({ p: V(Math.cos(a) * (Ro + 5), Math.sin(a) * (Ro + 5), 0), r: 3.2, color: LAMP.RED, i: 2.6, breathe: 0.8 });
    lamps.push({ p: V(Math.cos(a) * (Ri - 37), Math.sin(a) * (Ri - 37), 0), r: 4, color: LAMP.WHITE, i: 1.2 });
  }
  return { geo: B.geometry(), lamps };
}

/** The despun hub, docking arms, the radiator and solar masts' fixed trusses: { geo, lamps, berths }. */
export function buildWheelHub() {
  const { hubR, hubL, ringZ } = WHEEL;
  const B = new CB();
  const lamps = [];
  const berths = [];
  const bz = ringZ + 34;
  B.lathe([
    [0, -hubL, LK.DARK], [16, -hubL, LK.DARK], [26, -hubL + 12, LK.HULL], [hubR, -hubL + 40, LK.HULL],
    [hubR, -bz, LK.HULL], [hubR + 9, -bz + 6, LK.BRONZE], [hubR + 9, -ringZ + 30, LK.BRONZE], [hubR, -ringZ + 36, LK.HULL],
    [hubR, -14, LK.HULL], [hubR + 1, -12, LK.SIGN], [hubR + 1, 12, LK.SIGN], [hubR, 14, LK.HULL],
    [hubR, ringZ - 36, LK.HULL], [hubR + 9, ringZ - 30, LK.BRONZE], [hubR + 9, bz - 6, LK.BRONZE], [hubR, bz, LK.HULL],
    [hubR, hubL - 40, LK.HULL], [26, hubL - 12, LK.HULL], [16, hubL, LK.DARK], [0, hubL, LK.DARK],
  ], 40);
  // window bands on the despun hub (offices, the port's customs halls)
  for (const z of [-250, -200, 200, 250]) band(B, hubR + 0.3, z - 12, z + 12, 40, LK.GLASS, 1);
  // axial docking ports at both ends
  for (const s of [-1, 1]) {
    B.at(0, 0, s * (hubL + 4), s > 0 ? 0 : Math.PI, 0, 0);
    B.lathe([[12, -4, LK.DARK], [14, 0, LK.BRONZE], [14, 6, LK.BRONZE], [9, 9, LK.HAZARD], [7, 9, LK.DARK]], 24);
    B.pop();
    lamps.push({ p: V(0, 16, s * (hubL + 10)), r: 2, color: LAMP.GREEN, i: 2.6 }, { p: V(0, -16, s * (hubL + 10)), r: 2, color: LAMP.RED, i: 2.6 });
  }
  // docking arms: four at each end of the hub, berths for the ferries at their tips
  for (const z of [-hubL + 90, hubL - 90]) for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) / 4 * TAU;
    dockArm(B, a, z, hubR - 2, hubR + 72, lamps);
    berths.push({ a, z, r: hubR + 72 + 4.5 });       // (the collar's face)
  }
  // the masts: trusses out of each end, 12 m square in 24 m bays
  truss(B, 0, 0, hubL + 14, hubL + 560, 12, 24);
  truss(B, 0, 0, -hubL - 560, -hubL - 14, 12, 24);
  // mast tips: beacons and the communication dishes
  for (const s of [-1, 1]) {
    B.at(0, 0, s * (hubL + 566), s > 0 ? 0 : Math.PI, 0, 0);
    B.lathe([[0, -6, LK.HULL], [6, -6, LK.HULL], [6, 4, LK.HULL], [0, 8, LK.DARK]], 12);
    B.at(0, 14, 10, -0.6, 0, 0);
    B.lathe([[0, 0, LK.HULL], [9, 1.8, LK.HULL], [16, 5, LK.HULL], [15.6, 5.4, LK.DARK], [0, 1.2, LK.DARK]], 24);
    B.pop();
    B.pop();
    lamps.push({ p: V(0, 0, s * (hubL + 578)), r: 5, color: LAMP.WHITE, i: 3.5, breathe: 1 });
  }
  return { geo: B.geometry(), lamps, berths };
}

/** A pair of wings on the mast (about the mast axis z, between z0 and z1): radiators or solar arrays. */
export function buildWings(z0, z1, kind) {
  const B = new CB();
  const lamps = [];
  const span = kind === LK.RADIATOR ? 150 : 210, width = kind === LK.RADIATOR ? 44 : 58;
  const n = Math.floor((z1 - z0) / (width + 8));
  for (let k = 0; k < n; k++) {
    const zc = z0 + (k + 0.5) * (width + 8);
    for (const s of [-1, 1]) {
      // the boom and the panel (panel plane: local x-z, facing y)
      B.box(s * (span / 2 + 8), 0, zc, span + 4, 1.4, 1.4, LK.HULL);
      B.box(s * (span / 2 + 10), 0, zc, span, kind === LK.RADIATOR ? 0.6 : 0.3, width, kind);
      B.box(s * (span + 11), 0, zc, 2, 1.6, width + 2, LK.DARK);
      if (kind === LK.RADIATOR) B.box(s * (span / 2 + 10), 0.5, zc, span, 0.4, 1.6, LK.CONDUIT);   // the coolant header
    }
    // the gimbal on the mast
    B.box(0, 0, zc, 10, 10, 10, LK.BRONZE);
    if (k === n - 1) for (const s of [-1, 1]) lamps.push({ p: V(s * (span + 13), 0, zc), r: 2.5, color: s > 0 ? LAMP.GREEN : LAMP.RED, i: 2 });
  }
  return { geo: B.geometry(), lamps };
}

// ---------------------------------------------------------------------- ships --

/** The orbit-to-surface ferry (metres, nose +z, belly -y): { geo, glows: engine points, lamps }. */
export function buildFerry() {
  const B = new CB();
  // pressure hull: the nose with its flight deck windows, the cabin with a window band, the
  // tank bay, the engine section
  B.lathe([
    [0, 34, LK.HULL], [3.2, 33, LK.HULL], [5.2, 30, LK.GLASS], [6.2, 26.5, LK.HULL], [6.4, 20, LK.GLASS], [6.4, 14, LK.HULL],
    [6.4, 10, LK.PAINT], [6.2, 2, LK.HULL], [5.4, -2, LK.DARK], [5.4, -18, LK.DARK], [6.6, -20, LK.HULL], [6.6, -26, LK.HULL], [4.2, -29, LK.DARK], [0, -29, LK.DARK],
  ], 20);
  // four propellant spheres in gold foil round the tank bay, on struts
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) / 4 * TAU;
    sphere(B, Math.cos(a) * 9.4, Math.sin(a) * 9.4, -10, 4.6, LK.BRONZE, 14);
    B.box(Math.cos(a) * 6.2, Math.sin(a) * 6.2, -10, 3, 3, 1, LK.HULL);
  }
  // three engine bells
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * TAU + Math.PI / 2;
    B.at(Math.cos(a) * 2.6, Math.sin(a) * 2.6, -29);
    B.lathe([[1.1, 0, LK.DARK], [1.6, -2.5, LK.DARK], [2.4, -5.5, LK.DARK]], 14);
    B.pop();
  }
  // RCS quads, landing legs folded along the body, the docking collar at the nose
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU;
    B.box(Math.cos(a) * 6.8, Math.sin(a) * 6.8, 16, 1.4, 1.4, 1.4, LK.DARK);
    B.box(Math.cos(a + 0.785) * 6.9, Math.sin(a + 0.785) * 6.9, -8, 0.8, 0.8, 22, LK.HULL);
  }
  B.box(0, 6.6, 6, 7, 0.5, 9, LK.RADIATOR);
  B.box(0, 6.5, 12, 2.2, 0.4, 3, LK.HAZARD);
  const lamps = [
    { p: V(-6.6, 0, 8), r: 0.9, color: LAMP.RED, i: 3.2, dir: V(-1, 0, 0.3) },
    { p: V(6.6, 0, 8), r: 0.9, color: LAMP.GREEN, i: 3.2, dir: V(1, 0, 0.3) },
    { p: V(0, 6.8, -24), r: 1.1, color: LAMP.WHITE, i: 3, breathe: 1 },
  ];
  return { geo: B.geometry(), lamps, glows: [V(0, 0, -36)] };
}

/** The depot's tanker (metres, nose +z): a long tank stack behind a small crew section. */
export function buildTanker() {
  const B = new CB();
  B.lathe([
    [0, 70, LK.HULL], [4, 68, LK.GLASS], [6, 63, LK.HULL], [6, 56, LK.PAINT], [7, 54, LK.DARK],
    [11, 50, LK.BRONZE], [11, 10, LK.BRONZE], [8, 8, LK.DARK], [11, 6, LK.HULL], [11, -34, LK.HULL], [8, -38, LK.DARK],
    [6, -44, LK.DARK], [0, -44, LK.DARK],
  ], 24);
  for (let z = 44; z > -34; z -= 8) band(B, 11.15, z - 0.5, z + 0.5, 24, LK.DARK, 1);
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) / 4 * TAU;
    B.box(Math.cos(a) * 12, Math.sin(a) * 12, -14, 1, 1, 44, LK.CONDUIT);
  }
  B.at(0, 0, -44);
  B.lathe([[3, 0, LK.DARK], [4, -3, LK.DARK], [6.5, -9, LK.DARK]], 18);
  B.pop();
  B.box(0, 12, 20, 18, 0.5, 26, LK.RADIATOR);
  B.box(0, -12, 20, 18, 0.5, 26, LK.RADIATOR);
  return B.geometry();
}

/** A comm relay (metres): bus, dish to the Moon (-y), two panels. */
export function buildRelay() {
  const B = new CB();
  B.box(0, 0, 0, 5, 5, 6, LK.BRONZE);
  B.box(0, 2.6, 0, 3, 0.4, 3, LK.HAZARD);
  B.at(0, -3, 0, Math.PI / 2, 0, 0);
  B.lathe([[0, 0, LK.HULL], [3, 0.6, LK.HULL], [5.5, 1.8, LK.HULL], [5.3, 2.1, LK.DARK], [0, 0.5, LK.DARK]], 20);
  B.pop();
  B.box(0, -7, 0, 0.4, 5, 0.4, LK.HULL);
  for (const s of [-1, 1]) { B.box(s * 11, 0, 0, 14, 0.25, 4.5, LK.PANEL); B.box(s * 3.4, 0, 0, 2, 0.6, 0.6, LK.HULL); }
  return B.geometry();
}

// ---------------------------------------------------------------------- Aitken Depot --

export const DEPOT = { spine: [-520, 520], clusters: [-300, 0, 300], tankR: 26, tankOff: 48 };

/**
 * The depot (metres; local x = the spine, along the local vertical, +x away from the Moon; z the
 * orbit normal): { geo, lamps, arm: { base, l1, l2 }, tanker: Matrix4 }.
 */
export function buildDepot() {
  const B = new CB();
  const lamps = [];
  const { spine, clusters, tankR, tankOff } = DEPOT;
  // the spine: a 16 m truss along x
  B.push(new THREE.Matrix4().makeRotationY(Math.PI / 2));
  truss(B, 0, 0, spine[0], spine[1], 16, 26);
  B.pop();
  // tank clusters: four spheres round the spine on struts, gold foil and white alternating,
  // a red beacon on each
  for (const x of clusters) {
    for (let i = 0; i < 4; i++) {
      const a = (i + 0.5) / 4 * TAU;
      const y = Math.cos(a) * tankOff, z = Math.sin(a) * tankOff;
      B.at(x, y, z, 0, Math.PI / 2, 0);
      B.lathe(Array.from({ length: 11 }, (_, j) => { const t = -Math.PI / 2 + Math.PI * j / 10; return [Math.cos(t) * tankR, Math.sin(t) * tankR * 1.25, (i + (x > 0 ? 1 : 0)) % 2 ? LK.BRONZE : LK.HULL]; }), 22);
      band(B, tankR + 0.3, -2, 2, 22, LK.DARK, 1);
      B.pop();
      B.at(x, y / 3, z / 3, Math.atan2(z, y), 0, 0);   // the strut from the spine's face into the tank
      B.box(0, 0, 0, 5, 18, 5, LK.HULL);
      B.pop();
      lamps.push({ p: V(x, y * (1 + (tankR + 2) / tankOff), z * (1 + (tankR + 2) / tankOff)), r: 2.4, color: LAMP.RED, i: 2.2, breathe: 0.7, phase: i * 0.25 });
    }
    // the transfer manifold ring round the spine at the cluster
    B.push(new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(x, 0, 0));
    B.torus(tankOff * 0.55, 2.2, 32, 8, LK.CONDUIT);
    B.pop();
  }
  // the crew hangar at the outer end: a lit hall, glazed on its outer face, signage, docking
  // collars on its flanks
  const hx = spine[1] + 40;
  B.box(hx, 0, 0, 80, 64, 64, LK.HULL);
  B.box(hx + 40.3, 0, 0, 0.6, 50, 50, LK.GLASS);
  B.box(hx + 40.5, 0, 28, 0.8, 40, 4, LK.SIGN);
  B.box(hx, 32.3, 0, 70, 0.6, 20, LK.LANTERN);
  B.box(hx, -32.3, 0, 70, 0.6, 20, LK.ROOF);
  for (const z of [-32, 32]) {
    B.at(hx - 10, 0, z + Math.sign(z) * 2, z > 0 ? 0 : Math.PI, 0, 0);
    B.lathe([[8, 0, LK.DARK], [9, 3, LK.BRONZE], [9, 7, LK.BRONZE], [6, 9, LK.HAZARD], [5, 9, LK.DARK]], 20);
    B.pop();
    lamps.push({ p: V(hx - 10, 11, z * 1.35), r: 1.8, color: LAMP.GREEN, i: 2.4 }, { p: V(hx - 10, -11, z * 1.35), r: 1.8, color: LAMP.RED, i: 2.4 });
  }
  for (const [y, z] of [[34, 34], [-34, 34], [34, -34], [-34, -34]]) lamps.push({ p: V(hx + 42, y, z), r: 4, color: LAMP.WHITE, i: 1.2 });
  lamps.push({ p: V(hx + 45, 0, 0), r: 6, color: LAMP.WHITE, i: 3.5, breathe: 1 });
  // radiators along the spine between the clusters (fixed in the orbit plane: edge-on to the
  // Moon below, their faces to cold space)
  for (const x of [-150, 150]) for (const s of [-1, 1]) {
    B.box(x, s * 14, 0, 4, 12, 4, LK.HULL);
    B.box(x, s * 80, 0, 200, 110, 0.7, LK.RADIATOR);
    B.box(x, s * 80, 0.5, 200, 3, 0.4, LK.CONDUIT);
  }
  // the robot arm's base on the spine beside the berth
  const armBase = V(-420, 0, 8);
  B.at(armBase.x, armBase.y, armBase.z);
  B.lathe([[6, 0, LK.HULL], [6, 6, LK.HULL], [4, 9, LK.BRONZE], [0, 9, LK.BRONZE]], 16);
  B.pop();
  // floods along the spine
  for (let x = spine[0] + 40; x < spine[1]; x += 130) lamps.push({ p: V(x, 12, 12), r: 3, color: LAMP.AMBER, i: 1 });
  // the lower end: the tanker's berth
  const tanker = new THREE.Matrix4().compose(V(spine[0] - 80, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), _one);
  B.at(spine[0] - 4, 0, 0, 0, -Math.PI / 2, 0);
  B.lathe([[10, 0, LK.DARK], [11, 3, LK.BRONZE], [11, 6, LK.BRONZE], [7, 8, LK.HAZARD], [6, 8, LK.DARK]], 20);
  B.pop();
  lamps.push({ p: V(spine[0] - 10, 14, 0), r: 2, color: LAMP.GREEN, i: 2.4 }, { p: V(spine[0] - 10, -14, 0), r: 2, color: LAMP.RED, i: 2.4 });
  return { geo: B.geometry(), lamps, armBase, tanker };
}

/** The robot arm's two booms and its end effector (metres, pivot at the origin, along +x). */
function buildArmSegment(len) {
  const B = new CB();
  B.box(len / 2, 0, 0, len, 2.2, 2.2, LK.HULL);
  B.box(len / 2, 1.2, 0, len * 0.8, 0.3, 1.2, LK.HAZARD);
  B.at(0, 0, 0, Math.PI / 2, 0, 0);
  B.lathe([[2.4, -2, LK.BRONZE], [2.4, 2, LK.BRONZE]], 12);
  B.pop();
  B.box(len, 0, 0, 3, 3, 3, LK.DARK);
  return B.geometry();
}

// ---------------------------------------------------------------------- runtime --

const FERRY_SLOTS = [
  // [orbit, phase offset (rad), radial offset (km), speed of the drift toward its berth (rad per orbit)]
  ['wheel', 0.055, -0.6, 0], ['wheel', -0.11, 1.2, 0], ['wheel', 0.24, -2.5, 0], ['wheel', -0.35, 3, 0],
  ['depot', 0.07, 0.8, 0], ['depot', -0.18, -1.5, 0],
];
const RELAYS = [['relayA', 0], ['relayA', TAU / 3], ['relayA', 2 * TAU / 3], ['relayB', 0.5], ['relayB', 0.5 + TAU / 3], ['relayB', 0.5 + 2 * TAU / 3]];

export class LunarOrbitals {
  constructor(parent) {
    const t0 = performance.now();
    this.parent = parent;
    this.mat = createLunarMaterial({ lit: 0.62, accent: [0.55, 0.85, 1.0] });
    this.stations = [];
    // --- the Wheel ---
    {
      const g = new THREE.Group();
      g.name = 'Selene Wheel';
      const o = ORBITS.wheel;
      g.quaternion.setFromRotationMatrix(_m.makeBasis(o.u, o.v, o.n));
      const hub = buildWheelHub();
      const hubMesh = lunarMesh(hub.geo, {}, this.mat);
      hubMesh.name = 'Selene Wheel hub, docking arms and masts';
      addLamps(hubMesh, hub.lamps, { minPx: 1.1 });
      g.add(hubMesh);
      const ringData = buildWheelRing(1);
      const rings = [];
      for (const s of [-1, 1]) {
        const rg = new THREE.Group();
        rg.position.z = s * WHEEL.ringZ * 1e-3;
        const rm = lunarMesh(ringData.geo, {}, this.mat);
        rm.name = `Selene Wheel ${s > 0 ? 'north' : 'south'} ring`;
        addLamps(rm, ringData.lamps, { minPx: 1.0 });
        rg.add(rm);
        g.add(rg);
        rings.push({ group: rg, sign: s });
      }
      // lift cars in the spokes (instanced in each ring's own frame, metres)
      const carGeo = (() => {
        const B = new CB();
        B.lathe([[0, -7, LK.HULL], [5.5, -6, LK.HULL], [6, -3, LK.GLASS], [6, 3, LK.GLASS], [5.5, 6, LK.HULL], [0, 7, LK.HULL]], 12);
        B.lathe([[6.3, -0.4, LK.LIGHT], [6.3, 0.4, LK.LIGHT]], 12);
        return B.geometry();
      })();
      for (const r of rings) {
        r.cars = lunarInstanced(carGeo, WHEEL.spokes * 2, {}, this.mat);
        r.cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        r.cars.name = 'Selene Wheel spoke lift cars';
        r.group.add(r.cars);
      }
      // radiators turned edge-on to the Sun, solar arrays turned to face it
      const rad = buildWings(WHEEL.hubL + 30, WHEEL.hubL + 540, LK.RADIATOR);
      const sol = buildWings(-WHEEL.hubL - 540, -WHEEL.hubL - 30, LK.PANEL);
      const radG = new THREE.Group(), solG = new THREE.Group();
      const radM = lunarMesh(rad.geo, {}, this.mat), solM = lunarMesh(sol.geo, {}, this.mat);
      addLamps(radM, rad.lamps, { minPx: 1.0 }); addLamps(solM, sol.lamps, { minPx: 1.0 });
      radG.add(radM); solG.add(solM); g.add(radG, solG);
      // ferries berthed at the arms (three of the eight berths)
      const f = buildFerry();
      this.ferryGeo = f.geo;
      const berthed = [0, 3, 5].map((k) => hub.berths[k]);
      const docked = lunarInstanced(f.geo, berthed.length, {}, this.mat, { tint: true });
      berthed.forEach((b, i) => {
        // nose into the collar: the ferry's +z along the arm, pointing in
        _x.set(Math.cos(b.a), Math.sin(b.a), 0);
        _z.copy(_x).negate(); _y.set(0, 0, 1); _x.crossVectors(_y, _z);
        _m.makeBasis(_x, _y, _z).setPosition(Math.cos(b.a) * (b.r + 34), Math.sin(b.a) * (b.r + 34), b.z);
        docked.setMatrixAt(i, _m);
        docked.instanceColor.setXYZ(i, ...[[0.86, 0.3, 0.16], [0.18, 0.34, 0.62], [0.9, 0.84, 0.7]][i]);
      });
      docked.name = 'Selene Wheel berthed ferries';
      g.add(docked);
      g.visible = false;
      parent.add(g);
      this.wheel = { group: g, orbit: o, rings, radG, solG, near: [hubMesh, radM, solM, docked, ...rings.map((r) => r.group)], hubR: 1.2 };
      this.stations.push(this.wheel);
    }
    // --- the Depot ---
    {
      const g = new THREE.Group();
      g.name = 'Aitken Depot';
      const o = ORBITS.depot;
      const d = buildDepot();
      const mesh = lunarMesh(d.geo, {}, this.mat);
      mesh.name = 'Aitken Depot truss, tanks, hangar and radiators';
      addLamps(mesh, d.lamps, { minPx: 1.1 });
      g.add(mesh);
      const tk = lunarInstanced(buildTanker(), 1, {}, this.mat, { tint: true });
      tk.setMatrixAt(0, d.tanker);
      tk.instanceColor.setXYZ(0, 0.2, 0.42, 0.36);
      tk.name = 'Aitken Depot tanker alongside';
      g.add(tk);
      // sun-tracking solar wings at the lower end, turning about the spine
      const sol = buildWings(-200, 200, LK.PANEL);
      const solG = new THREE.Group();
      solG.position.x = (DEPOT.spine[0] + 60) * 1e-3;
      const solM = lunarMesh(sol.geo, {}, this.mat);
      solM.rotation.y = Math.PI / 2;           // the wings' axis (their z) along the spine (x)
      solG.add(solM);
      g.add(solG);
      // the robot arm: shoulder, elbow, wrist
      const arm = new THREE.Group();
      arm.position.copy(d.armBase).multiplyScalar(1e-3);
      const s1 = lunarMesh(buildArmSegment(44), {}, this.mat), s2 = lunarMesh(buildArmSegment(38), {}, this.mat);
      const j1 = new THREE.Group(), j2 = new THREE.Group();
      j1.position.z = 10e-3;
      j1.add(s1); j2.position.x = 44e-3; j1.add(j2); j2.add(s2);
      arm.add(j1);
      g.add(arm);
      g.visible = false;
      parent.add(g);
      this.depot = { group: g, orbit: o, solG, j1, j2, near: [mesh, tk, solG, arm], hubR: 1.1 };
      this.stations.push(this.depot);
    }
    // --- relays, instanced in the Moon frame (metres about the Moon's centre) ---
    this.relays = lunarInstanced(buildRelay(), RELAYS.length, {}, this.mat);
    this.relays.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.relays.name = 'Lunar relays';
    this.relayLamps = createLamps(RELAYS.map((_, i) => ({ p: new THREE.Vector3(), r: 3, color: i % 2 ? LAMP.WHITE : LAMP.TEAL, i: 3.2, breathe: 1, phase: i / RELAYS.length })), { minPx: 0.9 });
    this.relayLamps.scale.setScalar(0.001);
    // --- ferries in flight ---
    this.ferries = lunarInstanced(this.ferryGeo, FERRY_SLOTS.length, {}, this.mat, { tint: true });
    this.ferries.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    FERRY_SLOTS.forEach((_, i) => this.ferries.instanceColor.setXYZ(i, ...[[0.86, 0.3, 0.16], [0.18, 0.34, 0.62], [0.9, 0.84, 0.7], [0.2, 0.45, 0.4], [0.9, 0.6, 0.12], [0.7, 0.2, 0.14]][i % 6]));
    this.ferries.name = 'Lunar ferries in orbit';
    // their running lights and engine glow, carried with them (4 per ferry)
    this.ferryLamps = createLamps(FERRY_SLOTS.flatMap(() => [
      { p: new THREE.Vector3(), r: 1.2, color: LAMP.RED, i: 3 }, { p: new THREE.Vector3(), r: 1.2, color: LAMP.GREEN, i: 3 },
      { p: new THREE.Vector3(), r: 1.5, color: LAMP.WHITE, i: 3.2, breathe: 1 }, { p: new THREE.Vector3(), r: 6, color: LAMP.BLUE, i: 2.2 },
    ]), { minPx: 0.9 });
    this.ferryLamps.scale.setScalar(0.001);
    for (const o of [this.relays, this.relayLamps, this.ferries, this.ferryLamps]) { o.frustumCulled = false; parent.add(o); }
    this.parent.updateMatrixWorld?.();
    for (const s of this.stations) s.group.traverse((o) => { o.frustumCulled = false; });
    // far beacons: what a station is from thousands of km, while its structure is sub-pixel
    for (const s of this.stations) {
      s.far = createLamps([
        { p: V(0, 0, 0), r: 40, color: LAMP.WHITE, i: 2.4, breathe: 1 },
        { p: V(0, 60, 0), r: 30, color: LAMP.AMBER, i: 1.6 },
        { p: V(0, -60, 0), r: 30, color: LAMP.RED, i: 1.6, breathe: 0.6, phase: 0.5 },
      ], { minPx: 1.0 });
      s.far.scale.setScalar(0.001);
      s.far.frustumCulled = false;
      s.group.add(s.far);
    }
    this._moveCars(0);
    this._sun = new THREE.Vector3(1, 0, 0);
    this.buildMs = performance.now() - t0;
    this.update(0, null);
  }

  /** World position (km) of a station now ('wheel' | 'depot'). */
  stationWorld(name, out = new THREE.Vector3()) {
    const s = this[name];
    return out.copy(s.group.position).applyMatrix4(this.parent.matrixWorld);
  }

  /**
   * t: seconds; sunM: toward the Sun in the Moon frame (or null); cam: camera world position.
   * Moves every orbiter, spins the rings, turns the wings, and hides near detail beyond range.
   */
  update(t, sunM, cam = null, camera = null, viewH = 1080) {
    if (sunM) this._sun.copy(sunM);
    // --- Wheel ---
    const W = this.wheel;
    orbitPos(W.orbit, t, 0, W.group.position);
    const spin = WHEEL.spin * t;
    for (const r of W.rings) r.group.rotation.z = r.sign * spin;
    _qi.copy(W.group.quaternion).invert();
    _s.copy(this._sun).applyQuaternion(_qi);
    const sa = Math.atan2(_s.y, _s.x);
    W.radG.rotation.z = sa;                       // local x (the panels' plane) toward the Sun: edge-on
    W.solG.rotation.z = sa - Math.PI / 2;         // local y (the panels' normal) toward the Sun
    // --- Depot: spine along the local vertical, turning with its orbit ---
    const D = this.depot;
    orbitPos(D.orbit, t, 0, D.group.position);
    _x.copy(D.group.position).normalize(); _z.copy(D.orbit.n); _y.crossVectors(_z, _x);
    D.group.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    _qi.copy(D.group.quaternion).invert();
    _s.copy(this._sun).applyQuaternion(_qi);
    D.solG.rotation.x = Math.atan2(_s.z, _s.y);   // the panels' normal (y) toward the Sun
    // the arm: a slow reach between the tanker's manifold and the spine, two minutes a cycle
    const ap = 0.5 - 0.5 * Math.cos(t * TAU / 120);
    D.j1.rotation.z = -0.4 - 1.1 * ap;
    D.j2.rotation.z = 0.9 + 1.2 * ap;
    // --- visibility: near detail within reach, the lamps from much farther ---
    let camNear = false;
    for (const s of this.stations) {
      if (!cam) { s.group.visible = true; for (const m of s.near) m.visible = true; continue; }
      _w.copy(s.group.position).applyMatrix4(this.parent.matrixWorld);
      const d = _w.distanceTo(cam);
      s.group.visible = d < 60000;
      const near = camera ? pixelRadius(camera, _w, s.hubR, viewH) > 0.5 : d < 2000;
      if (near !== s.nearOn) { s.nearOn = near; for (const m of s.near) m.visible = near; s.far.visible = !near; }
      if (d < 3000) camNear = true;
      if (s === W && near && d < 60) this._moveCars(t);
    }
    // --- relays and ferries (Moon frame, metres) ---
    for (let i = 0; i < RELAYS.length; i++) {
      const [on, ph] = RELAYS[i], o = ORBITS[on];
      orbitPos(o, t, ph, _p);
      _y.copy(_p).normalize().negate();            // the dish down at the Moon
      _z.copy(o.n); _x.crossVectors(_y, _z);
      _m.makeBasis(_x, _y, _z).setPosition(_p.multiplyScalar(1000));
      this.relays.setMatrixAt(i, _m);
      const L = this.relayLamps.geometry.attributes.iLamp.array;
      L[i * 4] = _p.x; L[i * 4 + 1] = _p.y + 0; L[i * 4 + 2] = _p.z;
    }
    this.relays.instanceMatrix.needsUpdate = true;
    this.relayLamps.geometry.attributes.iLamp.needsUpdate = true;
    const FL = this.ferryLamps.geometry.attributes.iLamp.array;
    for (let i = 0; i < FERRY_SLOTS.length; i++) {
      const [on, ph, dr] = FERRY_SLOTS[i], o = ORBITS[on];
      // station-keeping approaches: each ferry closes on its station and falls back again over
      // an orbit (a slow relative drift, as on a co-orbital approach corridor)
      const drift = ph * (0.75 + 0.25 * Math.cos(o.w * t * 0.5 + i));
      orbitPos(o, t, drift, _p, dr * (0.8 + 0.2 * Math.sin(o.w * t + i)));
      _z.crossVectors(o.n, _p).normalize();        // nose along the velocity (prograde)
      _y.copy(_p).normalize();                     // +y away from the Moon
      _x.crossVectors(_y, _z).normalize(); _y.crossVectors(_z, _x);
      _p.multiplyScalar(1000);
      _m.makeBasis(_x, _y, _z).setPosition(_p);
      this.ferries.setMatrixAt(i, _m);
      const o4 = i * 16;
      for (let k = 0; k < 4; k++) {
        const lx = k === 0 ? -6.6 : k === 1 ? 6.6 : 0, ly = k === 2 ? 6.8 : 0, lz = k === 0 || k === 1 ? 8 : k === 2 ? -24 : -38;
        FL[o4 + k * 4] = _p.x + _x.x * lx + _y.x * ly + _z.x * lz;
        FL[o4 + k * 4 + 1] = _p.y + _x.y * lx + _y.y * ly + _z.y * lz;
        FL[o4 + k * 4 + 2] = _p.z + _x.z * lx + _y.z * ly + _z.z * lz;
      }
    }
    this.ferries.instanceMatrix.needsUpdate = true;
    this.ferryLamps.geometry.attributes.iLamp.needsUpdate = true;
    this.ferries.visible = !cam || camNear;
    this.relays.visible = !cam || camNear;
  }

  _moveCars(t) {
    const { Ri, hubR, spokes } = WHEEL;
    const lo = hubR + 20, hi = Ri - 44;
    for (const r of this.wheel.rings) {
      for (let s = 0; s < spokes; s++) {
        const a = (s / spokes) * TAU;
        for (let k = 0; k < 2; k++) {
          // each spoke's two cars run opposite ways: 90 s a trip, 20 s at each end
          const ph = ((t + s * 17 + k * 55) % 110) / 110;
          const u = ph < 0.18 ? 0 : ph < 0.5 ? (ph - 0.18) / 0.32 : ph < 0.68 ? 1 : 1 - (ph - 0.68) / 0.32;
          const e = u * u * (3 - 2 * u);
          const rr = lo + (hi - lo) * (k ? 1 - e : e);
          const off = k ? 4.5 : -4.5;
          _x.set(Math.cos(a), Math.sin(a), 0); _y.set(-Math.sin(a), Math.cos(a), 0);
          _m.makeBasis(_y, V0, _x);                  // the car's axis along the spoke
          _m.setPosition(_x.x * rr + _y.x * off, _x.y * rr + _y.y * off, 0);
          r.cars.setMatrixAt(s * 2 + k, _m);
        }
      }
      r.cars.instanceMatrix.needsUpdate = true;
    }
  }

  triangles() {
    let n = 0;
    for (const s of this.stations) s.group.traverse((o) => {
      if (!o.isMesh || !o.geometry.index || o.geometry.isInstancedBufferGeometry) return;
      n += (o.geometry.index.count / 3) * (o.isInstancedMesh ? o.count : 1);
    });
    for (const m of [this.relays, this.ferries]) n += (m.geometry.index.count / 3) * m.count;
    return n;
  }
}
const V0 = new THREE.Vector3(0, 0, 1);
