import * as THREE from 'three';
import { CB } from '../craft/craftGeometry.js';
import { LK } from './lunarMaterial.js';
import { surfaceY } from './lunarSite.js';
import { R_MOON } from './sim.js';

// The lunar kit: the parts the Moon's settlements are furnished with, each built once
// (metres, origin on the ground or at its pivot, +y up, +z forward) and drawn by instancing,
// so a town can stand a hundred landers, a thousand rovers and ten thousand solar trackers
// without owning their geometry. Every part is a closed solid on the lunar material: livery
// surfaces take the instance colour (LK.PAINT), lamps and cab glazing glow (LK.LIGHT).
//
//   lander        crew lander: octagonal descent stage in foil, four legs with footpads,
//                 spherical tanks, the crew cabin with its window band, hatch, ladder, RCS,
//                 antenna dish, landing lights
//   cargoLander   the same descent stage with a flat deck and two freight containers
//   suit          a surface worker in a pressure suit (tinted suit, gold visor, backpack)
//   walker        a townsperson (tinted clothes), for the Boulevard, the Strand and plazas
//   rover         pressurised six-wheeled rover: cab glazing, livery, roof rack, lamps
//   hauler        eight-wheeled ore hauler with its bin heaped with regolith
//   tug           pad service tug towing a propellant bowser
//   tram          one maglev car of the surface line (24 m), glazed saloon, lit headlamps
//   excavator     crawler bucket-wheel excavator (its wheel is the separate 'wheel' part)
//   wheel         the bucket wheel, pivot at its hub
//   tracker       solar tracker post; 'panel' is its 4 x 8 m array, pivot on the axle
//   radiator      a vertical radiator wing on its frame
//   boulder0..2   seeded, lumpy regolith boulders of unit radius
//   drone         survey quadcopter (for the terraformed air near the towns)
//   launch        harbour launch for the Bay
//   sled          mass-driver cargo capsule on its sled (+z along the guideway; origin on
//                 the guideway's axis, the sled clearing its top and conduit at +5.3 m)
//   vault         regolith-shielded habitat vault, 32 m, glazed ends, airlock
//   dome          pressure dome habitat, 30 m radius, lit ring gallery
//   silo          processing silo with ring platforms and a ladder cage
//   gantry        pad gantry crane (bridge 60 m) ; 'trolley' rides its bridge
//   mast          lamp and comms mast

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const X90 = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export { mulberry };

/** Lathe about the local +y axis (profile [[r, y, kind], ...]). */
function latheY(B, prof, seg, phase = 0) { B.push(X90); B.lathe(prof.map(([r, y, k]) => [r, y, k]), seg, phase); B.pop(); }
/** A cylinder along +y. */
function cyl(B, x, y0, z, r, h, k, seg = 12) { B.at(x, 0, z); latheY(B, [[r, y0, k], [r, y0 + h, k]], seg); B.pop(); }
/** A sphere (lathe) centred at x, y, z. */
function ball(B, x, y, z, r, k, seg = 12, rings = 6) {
  const prof = [];
  for (let j = 0; j <= rings; j++) { const a = -Math.PI / 2 + j / rings * Math.PI; prof.push([Math.cos(a) * r, y + Math.sin(a) * r, k]); }
  B.at(x, 0, z); latheY(B, prof, seg); B.pop();
}
/** A wheel (tyre and hub) on an axle along x. */
function wheel(B, x, y, z, r, w, seg = 12) {
  B.at(x, y, z, 0, 0, Math.PI / 2);
  latheY(B, [[r * 0.55, -w / 2, LK.BRONZE], [r, -w / 2, LK.DARK], [r, w / 2, LK.DARK], [r * 0.55, w / 2, LK.BRONZE], [r * 0.3, w / 2 + 0.05, LK.HULL]], seg);
  B.pop();
}
/** A strut between two points (square section). */
function strut(B, a, b, w, k) {
  const m = new THREE.Matrix4().lookAt(a, b, Math.abs(b.y - a.y) > 0.99 * a.distanceTo(b) ? V(1, 0, 0) : V(0, 1, 0)).setPosition(a.clone().add(b).multiplyScalar(0.5));
  B.push(m); B.box(0, 0, 0, w, w, a.distanceTo(b), k); B.pop();
}

// ------------------------------------------------------------------------ vehicles --

function descentStage(B) {
  // octagonal stage in gold foil, a hazard band and deck, engine bell below
  latheY(B, [[6.6, 2.6, LK.BRONZE], [7.0, 3.0, LK.BRONZE], [7.0, 6.2, LK.BRONZE], [6.6, 6.6, LK.HAZARD], [6.2, 7.0, LK.DECK]], 8, Math.PI / 8);
  latheY(B, [[0.6, 0.9, LK.DARK], [1.9, 0.9, LK.DARK], [1.2, 2.0, LK.DARK], [0.9, 2.7, LK.HULL]], 16);
  // tanks between the legs
  for (let i = 0; i < 4; i++) { const a = i * TAU / 4; ball(B, Math.cos(a) * 6.9, 4.6, Math.sin(a) * 6.9, 1.5, LK.HULL, 12, 6); }
  // legs: primary strut, two side braces, a footpad
  for (let i = 0; i < 4; i++) {
    const a = i * TAU / 4 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
    const top = V(c * 6.4, 5.8, s * 6.4), foot = V(c * 11.5, 0.55, s * 11.5), knee = V(c * 9.3, 3.0, s * 9.3);
    B.tube([top, knee, foot], 0.32, 6, LK.BRONZE);
    for (const d of [-1, 1]) { const b = V(c * 6.2 - s * d * 2.4, 2.9, s * 6.2 + c * d * 2.4); B.tube([b, knee], 0.16, 5, LK.HULL); }
    B.at(foot.x, 0, foot.z); latheY(B, [[0.3, 0.0, LK.DARK], [1.2, 0.0, LK.DARK], [1.2, 0.18, LK.DARK], [0.6, 0.55, LK.BRONZE]], 10); B.pop();
    B.box(c * 7.05, 6.4, s * 7.05, 0.5, 0.35, 0.5, LK.LIGHT);            // landing lights, looking out
  }
}

function crewLander() {
  const B = new CB();
  descentStage(B);
  // the cabin: a cylinder with its window band, a domed roof, the hatch collar
  latheY(B, [[4.6, 7.0, LK.HULL], [4.8, 7.4, LK.HULL], [4.8, 9.2, LK.HULL], [4.8, 11.0, LK.GLASS], [4.6, 11.4, LK.HULL], [4.0, 12.6, LK.HULL], [2.4, 13.6, LK.HULL], [1.4, 13.8, LK.BRONZE], [1.4, 14.6, LK.BRONZE], [0, 14.7, LK.DARK]], 20);
  B.box(0, 9.0, 4.75, 1.8, 2.4, 0.4, LK.HAZARD);                        // the side hatch, its frame striped
  B.box(0, 9.0, 4.95, 1.3, 2.0, 0.2, LK.DARK);
  B.box(0, 7.45, 5.4, 3.0, 0.2, 1.8, LK.DECK);                          // porch
  // ladder down the leg under the porch
  for (const sx of [-0.45, 0.45]) B.tube([V(sx, 7.3, 6.2), V(sx, 0.4, 9.6)], 0.06, 4, LK.HULL);
  for (let k = 1; k < 12; k++) { const t = k / 12; B.box(0, 7.3 - 6.9 * t, 6.2 + 3.4 * t, 0.9, 0.06, 0.06, LK.HULL); }
  // RCS quads on the cabin's shoulders
  for (let i = 0; i < 4; i++) {
    const a = i * TAU / 4 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
    B.at(c * 4.9, 10.2, s * 4.9, 0, -a, 0);
    B.box(0.35, 0, 0, 0.7, 0.8, 0.8, LK.HULL);
    for (const [dy, dz] of [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) B.box(0.35, dy, dz, 0.25, 0.25, 0.25, LK.DARK);
    B.pop();
  }
  // antenna mast and dish
  B.tube([V(2.6, 12.4, -2.6), V(3.4, 16.0, -3.4)], 0.1, 5, LK.HULL);
  B.at(3.4, 16.0, -3.4, 0.6, 0.8, 0);
  latheY(B, [[0.0, 0.0, LK.HULL], [0.7, 0.08, LK.HULL], [1.3, 0.34, LK.HULL], [1.3, 0.4, LK.HULL], [0.0, 0.1, LK.HULL]], 12);
  B.pop();
  B.box(-3.2, 11.2, 3.2, 0.6, 0.3, 0.3, LK.LIGHT);
  return B.geometry();
}

function cargoLander() {
  const B = new CB();
  descentStage(B);
  B.box(0, 7.3, 0, 13, 0.6, 13, LK.DECK);
  for (const sx of [-6.4, 6.4]) B.box(sx, 8.2, 0, 0.3, 1.2, 13, LK.HAZARD);
  for (const [z, k] of [[-3.1, LK.PAINT], [3.1, LK.PAINT]]) {
    B.box(0, 9.9, z, 12, 4.6, 5.6, k);
    for (let i = -2; i <= 2; i++) B.box(i * 2.6, 9.9, z + Math.sign(z) * 2.83, 0.18, 4.4, 0.08, LK.HULL);   // corrugation ribs
  }
  B.box(0, 12.6, 0, 1.2, 0.8, 12.5, LK.HULL);                          // spreader rail
  B.tube([V(-5.8, 7.6, -5.8), V(-5.8, 15.5, -5.8)], 0.12, 5, LK.HULL);
  B.box(-5.8, 15.7, -5.8, 0.4, 0.4, 0.4, LK.LIGHT);
  return B.geometry();
}

function suit() {
  const B = new CB();
  for (const sx of [-0.13, 0.13]) {
    B.box(sx, 0.07, 0.04, 0.16, 0.14, 0.3, LK.DARK);                     // boots
    B.box(sx, 0.48, 0, 0.17, 0.72, 0.19, LK.PAINT);                      // legs
  }
  B.box(0, 1.1, 0, 0.46, 0.6, 0.3, LK.PAINT);                            // torso
  B.box(0, 1.12, -0.25, 0.42, 0.62, 0.22, LK.HULL);                      // life-support pack
  B.box(0, 1.18, 0.16, 0.2, 0.14, 0.04, LK.LIGHT);                       // chest display
  for (const sx of [-0.3, 0.3]) { B.box(sx, 1.06, 0.03, 0.13, 0.58, 0.14, LK.PAINT); B.box(sx, 0.74, 0.04, 0.12, 0.1, 0.12, LK.DARK); }
  ball(B, 0, 1.58, 0, 0.17, LK.HULL, 8, 4);                               // helmet
  B.box(0, 1.59, 0.1, 0.22, 0.14, 0.1, LK.BRONZE);                       // gold visor
  return B.geometry();
}

function walker() {
  const B = new CB();
  for (const sx of [-0.1, 0.1]) { B.box(sx, 0.04, 0.03, 0.1, 0.08, 0.24, LK.DARK); B.box(sx, 0.45, 0, 0.13, 0.8, 0.14, LK.DARK); }
  B.box(0, 1.15, 0, 0.4, 0.62, 0.24, LK.PAINT);
  for (const sx of [-0.25, 0.25]) B.box(sx, 1.1, 0, 0.1, 0.56, 0.11, LK.PAINT);
  B.box(0, 1.5, 0, 0.12, 0.1, 0.12, LK.STONE);
  ball(B, 0, 1.64, 0, 0.12, LK.STONE, 6, 3);
  return B.geometry();
}

function rover() {
  const B = new CB();
  // chassis and six wheels on rocker bogies
  B.box(0, 1.25, 0, 3.0, 0.5, 8.6, LK.DARK);
  for (const z of [-3.1, 0, 3.1]) for (const sx of [-1.75, 1.75]) wheel(B, sx, 0.72, z, 0.72, 0.5, 12);
  for (const sx of [-1.45, 1.45]) B.box(sx, 1.15, 0, 0.2, 0.2, 6.8, LK.HULL);
  // the pressurised cab: a rounded body, glazing forward, livery aft
  const ring = (z, w, h, y0) => ({ z, pts: [[-w, y0], [w, y0], [w, y0 + h * 0.75], [w * 0.8, y0 + h], [-w * 0.8, y0 + h], [-w, y0 + h * 0.75]] });
  B.loft([ring(-4.0, 1.45, 2.1, 1.5), ring(-3.2, 1.55, 2.4, 1.5), ring(1.8, 1.55, 2.4, 1.5), ring(3.2, 1.45, 2.0, 1.5), ring(4.0, 1.2, 1.3, 1.5)], LK.PAINT);
  B.box(0, 3.5, 3.1, 2.6, 0.6, 0.9, LK.GLASS);                           // windscreen band
  B.box(0, 1.7, 4.2, 2.8, 0.5, 0.3, LK.HAZARD);                          // bumper
  for (const sx of [-1.0, 1.0]) B.box(sx, 2.2, 4.08, 0.5, 0.25, 0.1, LK.LIGHT);
  B.box(0, 4.05, -1.4, 2.4, 0.2, 3.6, LK.HULL);                          // roof rack
  B.box(0, 4.35, -2.0, 1.8, 0.4, 1.6, LK.RADIATOR);
  B.box(0, 2.6, -4.1, 1.2, 1.7, 0.2, LK.DARK);                           // rear docking hatch
  B.tube([V(-1.1, 3.9, -3.2), V(-1.1, 5.6, -3.2)], 0.04, 4, LK.HULL);
  B.box(-1.1, 5.65, -3.2, 0.12, 0.12, 0.12, LK.LIGHT);
  return B.geometry();
}

function hauler() {
  const B = new CB();
  B.box(0, 1.5, 0, 3.4, 0.6, 12.5, LK.DARK);
  for (const z of [-4.6, -1.6, 1.6, 4.6]) for (const sx of [-2.0, 2.0]) wheel(B, sx, 0.95, z, 0.95, 0.7, 12);
  // cab forward, low and glazed
  B.box(0, 2.9, 5.0, 3.2, 2.2, 2.4, LK.PAINT);
  B.box(0, 3.3, 6.22, 2.9, 1.1, 0.06, LK.GLASS);
  for (const sx of [-1.2, 1.2]) B.box(sx, 2.2, 6.24, 0.5, 0.25, 0.05, LK.LIGHT);
  // the bin, heaped with regolith
  B.loft([{ z: -5.9, pts: [[-1.7, 1.8], [1.7, 1.8], [1.9, 4.2], [-1.9, 4.2]] }, { z: 3.4, pts: [[-1.7, 1.8], [1.7, 1.8], [1.9, 4.2], [-1.9, 4.2]] }], LK.PAINT);
  B.loft([{ z: -5.6, pts: [[-1.8, 4.2], [1.8, 4.2], [0.9, 5.0], [-0.9, 5.0]] }, { z: 3.1, pts: [[-1.8, 4.2], [1.8, 4.2], [0.6, 5.4], [-0.6, 5.4]] }], LK.REGOLITH);
  B.box(0, 1.9, -6.3, 3.0, 0.4, 0.3, LK.HAZARD);
  return B.geometry();
}

function tug() {
  const B = new CB();
  B.box(0, 0.9, 1.6, 2.6, 0.8, 4.2, LK.PAINT);
  for (const z of [0.2, 3.0]) for (const sx of [-1.35, 1.35]) wheel(B, sx, 0.5, z, 0.5, 0.4, 10);
  B.box(0, 2.0, 2.4, 2.2, 1.4, 1.8, LK.GLASS);
  B.box(0, 2.78, 2.4, 2.3, 0.16, 1.9, LK.PAINT);
  B.box(0, 1.3, 3.72, 2.4, 0.3, 0.1, LK.HAZARD);
  B.box(0, 3.0, 2.4, 0.3, 0.2, 0.3, LK.LIGHT);                            // beacon
  B.box(0, 0.8, -0.8, 0.3, 0.3, 1.2, LK.DARK);                            // drawbar
  // the bowser: a propellant tank on a two-axle trailer
  B.box(0, 0.8, -4.6, 2.2, 0.35, 6.0, LK.DARK);
  for (const z of [-2.8, -6.4]) for (const sx of [-1.2, 1.2]) wheel(B, sx, 0.5, z, 0.5, 0.35, 10);
  B.at(0, 2.05, -4.6);
  B.push(new THREE.Matrix4().makeRotationX(0));
  B.lathe([[0, -2.8, LK.HULL], [0.9, -2.7, LK.HULL], [1.1, -2.3, LK.HULL], [1.1, 2.3, LK.HULL], [0.9, 2.7, LK.HULL], [0, 2.8, LK.HULL]], 12);
  B.pop(); B.pop();
  B.box(0, 2.05, -4.6, 2.3, 0.3, 0.3, LK.HAZARD);
  return B.geometry();
}

function tram() {
  const B = new CB();
  // the saloon: a rounded section, livery below, a continuous window band, lamps at both ends
  const sec = (z, s) => ({ z, pts: [[-1.6 * s, 0.7], [1.6 * s, 0.7], [1.7 * s, 1.6], [1.7 * s, 3.1], [1.35 * s, 3.9], [-1.35 * s, 3.9], [-1.7 * s, 3.1], [-1.7 * s, 1.6]] });
  const rings = [sec(-12, 0.82), sec(-11.2, 0.97), sec(-10.2, 1), sec(10.2, 1), sec(11.2, 0.97), sec(12, 0.82)];
  B.loft(rings, LK.PAINT);
  for (const sx of [-1, 1]) B.box(sx * 1.705, 2.35, 0, 0.04, 1.2, 19.8, LK.GLASS);
  for (const sx of [-1, 1]) B.box(sx * 1.705, 1.55, 0, 0.05, 0.14, 20.0, LK.SIGN);
  for (const z of [-12.02, 12.02]) { B.box(0, 2.7, z, 2.2, 0.9, 0.06, LK.GLASS); for (const sx of [-0.9, 0.9]) B.box(sx, 1.25, z, 0.4, 0.2, 0.06, LK.LIGHT); }
  // magnetic skirts wrapping the guideway top, and roof equipment
  for (const sx of [-1, 1]) B.box(sx * 1.45, 0.25, 0, 0.3, 0.9, 21.0, LK.DARK);
  B.box(0, 4.0, -5, 1.8, 0.3, 4.0, LK.HULL);
  B.box(0, 4.0, 5, 1.8, 0.3, 4.0, LK.HULL);
  return B.geometry();
}

function excavator() {
  const B = new CB();
  for (const sx of [-3.2, 3.2]) {
    B.box(sx, 1.2, 0, 2.0, 2.4, 11, LK.DARK);                           // crawler tracks
    for (let z = -4.8; z <= 4.8; z += 1.2) B.box(sx, 2.44, z, 2.1, 0.08, 0.5, LK.HULL);
  }
  B.box(0, 3.6, 0, 7.4, 2.4, 9.0, LK.PAINT);                              // superstructure
  B.box(0, 6.0, -1.5, 5.0, 2.4, 5.0, LK.PAINT);
  B.box(1.6, 6.2, 1.2, 2.0, 1.8, 1.6, LK.GLASS);                          // operator cab
  B.box(0, 7.4, -3.6, 5.6, 0.4, 1.2, LK.RADIATOR);
  // boom out to the wheel hub (+z, rising), the counter-jib behind
  strut(B, V(0, 6.5, 2), V(0, 9.0, 16.0), 1.4, LK.PAINT);
  strut(B, V(0, 7.2, -2), V(0, 9.4, -10.0), 1.0, LK.PAINT);
  B.box(0, 8.8, -10.5, 3.2, 3.0, 2.4, LK.WALL);                           // counterweight
  strut(B, V(0, 13.0, -1), V(0, 9.4, 15.0), 0.3, LK.HULL);                // stays
  strut(B, V(0, 13.0, -1), V(0, 9.4, -10.0), 0.3, LK.HULL);
  strut(B, V(0, 6.8, -1), V(0, 13.0, -1), 0.6, LK.PAINT);
  // a conveyor down the boom
  strut(B, V(1.0, 8.4, 15.0), V(1.0, 6.2, 1.0), 0.7, LK.CONDUIT);
  B.box(-2.6, 5.2, 3.6, 0.4, 0.3, 0.3, LK.LIGHT);
  B.box(2.6, 5.2, 3.6, 0.4, 0.3, 0.3, LK.LIGHT);
  return B.geometry();
}
export const EXCAVATOR_HUB = V(0, 9.0, 16.6);

function bucketWheel() {
  const B = new CB();
  B.at(0, 0, 0, 0, 0, Math.PI / 2);
  latheY(B, [[0.4, -0.9, LK.HULL], [4.0, -0.7, LK.PAINT], [4.0, 0.7, LK.PAINT], [0.4, 0.9, LK.HULL]], 16);
  B.pop();
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * TAU;
    B.at(0, Math.sin(a) * 4.3, Math.cos(a) * 4.3, a, 0, 0);
    B.box(0, 0, 0, 1.6, 0.9, 1.1, LK.BRONZE);
    B.box(0, 0.5, 0.3, 1.6, 0.1, 0.5, LK.DARK);
    B.pop();
  }
  return B.geometry();
}

function trackerPost() {
  const B = new CB();
  B.box(0, 0.15, 0, 1.2, 0.3, 1.2, LK.WALL);
  B.box(0, 1.35, 0, 0.3, 2.4, 0.3, LK.HULL);
  B.box(0, 2.6, 0, 0.5, 0.3, 0.5, LK.DARK);                             // slew drive
  return B.geometry();
}
export const TRACKER_AXLE = 2.9;

function trackerPanel() {
  // 4 x 8 m array: cells up (+y), a frame and torque tube beneath, pivot on the axle
  const B = new CB();
  B.box(0, 0.12, 0, 8.0, 0.06, 4.0, LK.SOLAR);
  B.box(0, 0.02, 0, 8.1, 0.1, 0.12, LK.HULL);
  for (const sx of [-3.8, -1.3, 1.3, 3.8]) B.box(sx, 0.02, 0, 0.1, 0.12, 4.0, LK.HULL);
  B.box(0, -0.12, 0, 8.2, 0.2, 0.2, LK.HULL);
  return B.geometry();
}

function radiatorWing() {
  const B = new CB();
  B.box(0, 0.4, 0, 3.6, 0.8, 1.6, LK.WALL);
  B.box(0, 8.0, 0, 3.0, 14.0, 0.18, LK.RADIATOR);
  B.box(0, 15.1, 0, 3.2, 0.3, 0.5, LK.CONDUIT);                           // header pipe
  for (const sx of [-1.6, 1.6]) B.box(sx, 7.9, 0, 0.18, 15.0, 0.5, LK.HULL);
  return B.geometry();
}

function boulder(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.getAttribute('position');
  const r = mulberry(seed);
  const lobes = Array.from({ length: 5 }, () => [V(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), 0.12 + r() * 0.2]);
  const flat = 0.55 + r() * 0.3;
  const p = V(0, 0, 0);
  // a key per unique position, so shared corners move together and the solid stays closed
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    let s = 1;
    for (const [d, a] of lobes) s += a * Math.max(p.dot(d), 0) ** 2 - a * 0.25;
    const k = Math.sin(p.x * 7.1 + seed) * Math.sin(p.y * 6.3) * Math.sin(p.z * 5.7 + seed * 0.3);
    s *= 1 + 0.07 * k;
    p.multiplyScalar(s);
    p.y = p.y * flat + 0.15;                                               // settled: a flatter, sunk base
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.getAttribute('position').count;
  const fac = new Float32Array(n * 3);
  const pp = ng.getAttribute('position');
  for (let i = 0; i < n; i++) { fac[i * 3] = pp.getX(i) * 3 + pp.getZ(i) * 2; fac[i * 3 + 1] = pp.getY(i) * 3; fac[i * 3 + 2] = LK.REGOLITH; }
  ng.setAttribute('aFacade', new THREE.BufferAttribute(fac, 3));
  const idx = []; for (let i = 0; i < n; i++) idx.push(i);
  ng.setIndex(idx);
  ng.deleteAttribute('uv');
  ng.computeVertexNormals();
  ng.computeBoundingSphere();
  return ng;
}

function drone() {
  const B = new CB();
  B.box(0, 0, 0, 0.5, 0.2, 0.5, LK.PAINT);
  for (let i = 0; i < 4; i++) {
    const a = i * TAU / 4 + Math.PI / 4, c = Math.cos(a) * 0.55, s = Math.sin(a) * 0.55;
    strut(B, V(0, 0.05, 0), V(c, 0.08, s), 0.06, LK.DARK);
    B.at(c, 0.12, s); latheY(B, [[0.28, 0, LK.DARK], [0.28, 0.02, LK.DARK]], 10); B.pop();
  }
  B.box(0, -0.13, 0.2, 0.1, 0.08, 0.1, LK.LIGHT);
  return B.geometry();
}

function launch() {
  const B = new CB();
  const L = 12, W = 3.6, rings = [];
  for (let j = 0; j <= 8; j++) {
    const t = j / 8, z = (t - 0.5) * L;
    const bw = t > 0.7 ? Math.max(1 - (t - 0.7) / 0.3, 0.05) ** 0.7 : 1;
    const hw = Math.max(W / 2 * bw, 0.1);
    rings.push({ z, pts: [[-hw, 1.4], [-hw * 0.95, 0.1], [-hw * 0.6, -0.6], [0, -0.8], [hw * 0.6, -0.6], [hw * 0.95, 0.1], [hw, 1.4]] });
  }
  B.loft(rings, (i, j) => (i === 0 || i === 6 ? LK.PAINT : LK.HULL));
  B.box(0, 2.3, -1.0, 2.6, 1.8, 4.2, LK.GLASS);
  B.box(0, 3.3, -1.0, 2.9, 0.2, 4.6, LK.PAINT);
  B.box(0, 1.5, 2.6, 2.4, 0.2, 2.4, LK.DECK);
  B.box(0, 4.0, -2.0, 0.2, 1.2, 0.2, LK.BRONZE);
  B.box(0, 4.7, -2.0, 0.2, 0.2, 0.2, LK.LIGHT);
  return B.geometry();
}

function sled() {
  const B = new CB();
  // the sled straddles the guideway top (beam 16 m wide, its top 4 m above the axis)
  B.box(0, 5.9, 0, 14, 1.2, 40, LK.DARK);
  for (const sx of [-7.4, 7.4]) B.box(sx, 6.8, 0, 0.6, 0.6, 40, LK.HAZARD);
  for (const sx of [-8.6, 8.6]) { B.box(sx, 2.8, 0, 1.0, 5.0, 38, LK.COIL); B.box(sx * 0.93, 5.9, 0, 1.2, 1.2, 38, LK.DARK); }
  B.at(0, 11.4, 0);
  B.lathe([[0, -19, LK.BRONZE], [4.5, -18, LK.HULL], [6.0, -14, LK.HULL], [6.0, 12, LK.HULL], [4.5, 17, LK.HULL], [0, 20, LK.BRONZE]], 16);
  B.lathe([[6.1, -2, LK.HAZARD], [6.1, 2, LK.HAZARD]], 16);
  B.pop();
  for (const z of [-17, 17]) for (const sx of [-6, 6]) B.box(sx, 7.0, z, 1.2, 3.6, 1.2, LK.HULL);
  return B.geometry();
}

// ------------------------------------------------------------------------ buildings --

function vault() {
  // a barrel vault 32 m long, 14 m span, under 3 m of bagged regolith; glazed ends set back
  // behind the berm's portals, a pressure door and its lamp on the +z end
  const B = new CB();
  const arch = (z, r, y0 = 0) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const a = Math.PI - i / 10 * Math.PI; pts.push([Math.cos(a) * r, y0 + Math.sin(a) * r * 0.82]); }
    return { z, pts };
  };
  B.loft([arch(-16, 10.5, -0.5), arch(16, 10.5, -0.5)], LK.REGOLITH);
  // berm shoulders sloping down to the ground
  for (const sx of [-1, 1]) B.loft([{ z: -16, pts: [[sx * 10.4, -0.5], [sx * 14.5, -0.5], [sx * 10.2, 3.2]] }, { z: 16, pts: [[sx * 10.4, -0.5], [sx * 14.5, -0.5], [sx * 10.2, 3.2]] }], LK.REGOLITH);
  for (const sz of [-1, 1]) {
    B.loft([arch(sz * 16, 7.0, -0.5), arch(sz * 17.5, 7.0, -0.5)], LK.GLASS);
    B.box(0, 2.0, sz * 17.8, 3.0, 4.0, 1.0, LK.HULL);                     // the door's frame
    B.box(0, 1.8, sz * 18.32, 2.0, 3.4, 0.1, sz > 0 ? LK.HAZARD : LK.DARK);
    B.box(0, 4.6, sz * 18.2, 5.0, 0.8, 0.3, LK.SIGN);
    B.box(0, 5.3, sz * 18.3, 0.5, 0.3, 0.3, LK.LIGHT);
  }
  // a radiator wing and a vent stack on the ridge
  B.box(0, 9.3, 6, 1.2, 1.0, 4.0, LK.HULL);
  B.box(0, 11.2, 6, 0.2, 3.0, 5.0, LK.RADIATOR);
  B.box(0, 9.5, -8, 1.0, 1.4, 1.0, LK.HULL);
  return B.geometry();
}

function dome() {
  const B = new CB();
  const R = 30;
  const prof = [[R + 3, -0.6, LK.WALL], [R + 3, 4.5, LK.WALL], [R + 1, 5.0, LK.BRONZE], [R + 0.8, 5.2, LK.GLASS], [R + 0.8, 8.4, LK.GLASS], [R + 0.6, 8.8, LK.BRONZE]];
  for (let j = 1; j <= 8; j++) { const a = j / 8 * Math.PI / 2 * 0.95; prof.push([R * Math.cos(a), 8.8 + R * 0.78 * Math.sin(a), LK.CONSERVATORY]); }
  prof.push([3.2, 8.8 + R * 0.78 + 1.2, LK.BRONZE], [1.2, 8.8 + R * 0.78 + 4.5, LK.LANTERN], [0, 8.8 + R * 0.78 + 5.5, LK.BRONZE]);
  latheY(B, prof, 40);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU, pts = [];
    for (let j = 0; j <= 8; j++) { const b = j / 8 * Math.PI / 2 * 0.95; pts.push(V(Math.cos(a) * (R * Math.cos(b) + 0.3), 8.8 + R * 0.78 * Math.sin(b) + 0.3, Math.sin(a) * (R * Math.cos(b) + 0.3))); }
    B.tube(pts, 0.35, 4, LK.BRONZE);
  }
  // four entry locks with lit portals
  for (let i = 0; i < 4; i++) {
    const a = i * TAU / 4;
    B.at(Math.cos(a) * (R + 6), 0, Math.sin(a) * (R + 6), 0, -a + Math.PI / 2, 0);
    B.box(0, 2.4, 0, 5, 4.8, 8, LK.HULL);
    B.box(0, 2.0, 4.02, 2.4, 3.2, 0.06, LK.DARK);
    B.box(0, 4.2, 4.05, 3.6, 0.5, 0.1, LK.SIGN);
    B.box(0, 5.1, 3.0, 0.4, 0.3, 0.4, LK.LIGHT);
    B.pop();
  }
  return B.geometry();
}

function silo() {
  const B = new CB();
  latheY(B, [[6, -0.5, LK.WALL], [6, 1.0, LK.WALL], [5, 1.0, LK.HULL], [5, 24, LK.HULL], [4.2, 26.5, LK.HULL], [1.2, 28, LK.BRONZE], [1.2, 29, LK.DARK]], 20);
  for (const y of [8, 16, 23]) latheY(B, [[5.2, y, LK.DECK], [6.2, y, LK.DECK], [6.2, y + 0.25, LK.DECK], [5.2, y + 0.25, LK.DECK]], 20);
  B.box(5.6, 13, 0, 1.0, 26, 1.0, LK.HULL);                               // ladder cage
  B.box(-4.8, 14, 0, 0.3, 24, 0.3, LK.CONDUIT);
  return B.geometry();
}

function gantry() {
  const B = new CB();
  for (const sx of [-30, 30]) {
    for (const sz of [-4, 4]) strut(B, V(sx, 0, sz * 1.8), V(sx, 22, sz * 0.3), 0.9, LK.PAINT);
    B.box(sx, 0.4, 0, 2.2, 0.8, 16, LK.DARK);                             // bogies on their rails
    B.box(sx, 22.4, 0, 2.0, 1.2, 4.0, LK.PAINT);
  }
  B.box(0, 23.6, -1.1, 62, 1.6, 0.8, LK.PAINT);
  B.box(0, 23.6, 1.1, 62, 1.6, 0.8, LK.PAINT);
  B.box(0, 24.5, 0, 62, 0.2, 3.0, LK.HAZARD);
  B.box(-27, 20.2, 0, 3.0, 2.4, 3.0, LK.GLASS);                           // operator cab
  return B.geometry();
}

function trolley() {
  const B = new CB();
  B.box(0, 24.8, 0, 4.0, 1.6, 3.4, LK.HULL);
  for (const sx of [-0.6, 0.6]) B.box(sx, 18.0, 0, 0.06, 12, 0.06, LK.DARK);
  B.box(0, 11.6, 0, 3.2, 0.6, 2.2, LK.HAZARD);                            // spreader
  B.box(0, 25.8, 0, 0.3, 0.3, 0.3, LK.LIGHT);
  return B.geometry();
}

function mast() {
  const B = new CB();
  B.box(0, 0.3, 0, 1.4, 0.6, 1.4, LK.WALL);
  B.box(0, 9, 0, 0.35, 17.4, 0.35, LK.HULL);
  B.box(0, 17.6, 0, 2.6, 0.5, 0.8, LK.DARK);
  for (const sx of [-0.9, 0, 0.9]) B.box(sx, 17.3, 0.3, 0.6, 0.18, 0.4, LK.LIGHT);
  B.box(0, 18.4, 0, 0.12, 1.2, 0.12, LK.HULL);
  return B.geometry();
}

// ------------------------------------------------------------------------ registry --

const MAKERS = {
  lander: crewLander, cargoLander, suit, walker, rover, hauler, tug, tram, excavator, wheel: bucketWheel,
  tracker: trackerPost, panel: trackerPanel, radiator: radiatorWing, boulder0: () => boulder(11), boulder1: () => boulder(29), boulder2: () => boulder(47),
  drone, launch, sled, vault, dome, silo, gantry, trolley, mast,
};
const CACHE = new Map();
/** A kit part's geometry (built once, shared by every settlement). */
export function kit(name) {
  let g = CACHE.get(name);
  if (!g) {
    const f = MAKERS[name];
    if (!f) throw new Error(`lunarKit: no part '${name}'`);
    g = f();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    CACHE.set(name, g);
  }
  return g;
}
export const KIT_PARTS = Object.keys(MAKERS);

// Footprint radii (metres) for the placement checks.
export const KIT_R = { lander: 13, cargoLander: 13, rover: 4.6, hauler: 6.6, tug: 8, tram: 12.2, excavator: 21, tracker: 4.5, radiator: 2, vault: 18.5, dome: 42, silo: 6.3, gantry: 32, mast: 1 };

// ------------------------------------------------------------------ placement on the sphere --

const _q = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _up = V(0, 1, 0), _s = V(1, 1, 1), _p = V(0, 0, 0), _n = V(0, 0, 0);
/**
 * Matrix placing a part at site-frame x, z (metres), standing on the drawn sphere (plus h),
 * upright on the local vertical, turned by yaw about it; s uniform scale.
 */
export function seat(out, x, z, yaw = 0, h = 0, s = 1) {
  const R = R_MOON * 1000;
  const y = surfaceY(x, z);
  _n.set(x, R + y, z).normalize();
  _q.setFromUnitVectors(_up, _n);
  _qy.setFromAxisAngle(_up, yaw);
  _q.multiply(_qy);
  _p.set(x, y, z).addScaledVector(_n, h);
  return out.compose(_p, _q, _s.setScalar(s));
}

/**
 * Seat a whole cluster (a local planar frame at x, z, yaw) and place a part within it at
 * local lx, lz (metres): the part is re-seated on the sphere at its own position, so a
 * cluster a kilometre across stays on the ground.
 */
export function seatLocal(out, cx, cz, cyaw, lx, lz, yaw = 0, h = 0, s = 1) {
  const c = Math.cos(cyaw), sn = Math.sin(cyaw);
  return seat(out, cx + lx * c + lz * sn, cz - lx * sn + lz * c, cyaw + yaw, h, s);
}
