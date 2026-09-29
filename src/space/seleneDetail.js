import * as THREE from 'three';
import { CB, CK, TAU, V, catwalk, dish, mast, flood } from './shipKit.js';
import { LAMP } from './lamps.js';

// SELENE WORKS, CLOSE TO (refinery-local metres, +Y the spindle away from the Moon): the
// fittings that make the works a place people live and work, built the first time a camera
// comes near (src/space/fleet.js) and hidden again beyond range.
//
//   the wheel     (turns with the habitat wheel, 2.2 km radius, 0.04 rad/s: about a third of
//                 a g on the rim floor) a crown walk with railings round the rim between the
//                 garden halls, airlock hatches and berth lamps on the outer window wall, rows
//                 of warm cabin lamps, a mast and dish pair on every second hall
//   spoke lifts   a lift car on a rail along the top of each of the six spokes, running hub to
//                 rim and back (the spokes are the only way down to the gravity decks)
//   ring cranes   three gantry cranes riding the docking ring's crown between the tanker
//                 berths, each swinging slowly through its sector with a boom over the ring,
//                 a hoist and a load, work lights on the boom
//
// Everything stays inside the wheel's swept envelope (2,020..2,410 m, y -770..-370) or on the
// ring's crown; tools/verify-fleet.mjs checks the envelopes and the cranes' clearances.

export const WHEEL = { y: -600, rim: 2200, rimHalfW: 170, rimHalfH: 150, spokeIn: 330, spokeOut: 2050, spokeR: 60, omega: 0.04 };
/** Height of the rim's crown above the wheel plane at radial offset dr from the rim line (the rim's superellipse section). */
export const crownY = (dr) => WHEEL.y + WHEEL.rimHalfH * Math.pow(Math.max(1 - Math.pow(Math.min(Math.abs(dr) / WHEEL.rimHalfW, 1), 2.6), 0), 1 / 2.6);
/** The spoke lifts' rail height (the spokes are straight 60 m tubes). */
export const RAIL_Y = WHEEL.y + WHEEL.spokeR + 1.5;
export const RING = { y: 2150, R: 420, tube: 34, berthA: [0.5, 0.5 + TAU / 3, 0.5 + (2 * TAU) / 3], swing: 0.55 };

/** The habitat wheel's fittings (wheel-local metres; the wheel turns about +Y). */
export function buildWheelDetail() {
  const B = new CB();
  const lamps = [];
  const W = WHEEL, yTop = W.y + W.rimHalfH, rOut = W.rim + W.rimHalfW;
  // crown walk: a ring of catwalk segments round the rim's outer crown edge
  const walkR = W.rim + 118, segs = 144;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
    // the walk steps round the garden halls (every 30 degrees, 100 m radius about the rim line)
    const hallNear = (a) => { const k = Math.round((a - TAU / 24) / (TAU / 12)); return Math.abs(a - TAU / 24 - k * (TAU / 12)) * W.rim < 118; };
    if (hallNear(a0) || hallNear(a1)) continue;
    const y = crownY(118) + 0.4;
    catwalk(B, V(Math.cos(a0) * walkR, y, Math.sin(a0) * walkR), V(Math.cos(a1) * walkR, y, Math.sin(a1) * walkR), V(0, 1, 0), 4, 1.2);
  }
  // airlock hatches and berth lamps on the outer window wall; cabin lamp rows
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * TAU + 0.02;
    const c = Math.cos(a), s = Math.sin(a);
    B.push(new THREE.Matrix4().makeBasis(V(s, 0, -c), V(0, 1, 0), V(c, 0, s)).setPosition(c * (rOut + 0.5), W.y, s * (rOut + 0.5)));
    B.box(0, 0, 0, 10, 12, 1.2, CK.DARK);
    B.box(0, 6.6, 0.4, 12, 1.2, 1.4, CK.BRONZE); B.box(0, -6.6, 0.4, 12, 1.2, 1.4, CK.BRONZE);
    B.box(5.8, 0, 0.4, 1.2, 14, 1.4, CK.BRONZE); B.box(-5.8, 0, 0.4, 1.2, 14, 1.4, CK.BRONZE);
    B.pop();
    lamps.push({ p: V(c * (rOut + 3), W.y + 9, s * (rOut + 3)), r: 2.2, color: LAMP.AMBER, i: 2.0, breathe: 0.3, phase: k / 36 });
  }
  for (let k = 0; k < 144; k++) {
    const a = (k / 144) * TAU + 0.011;
    for (const dy of [-60, 40]) lamps.push({ p: V(Math.cos(a) * (rOut + 2), W.y + dy, Math.sin(a) * (rOut + 2)), r: 3.4, color: [1.0, 0.8, 0.55], i: 1.1 + 0.5 * ((k * 7) % 5) / 5, dir: V(Math.cos(a), 0, Math.sin(a)) });
  }
  // masts and dishes on every second garden hall's shoulder
  for (let k = 0; k < 12; k += 2) {
    const a = (k / 12) * TAU + TAU / 24 + 0.06;
    const p = V(Math.cos(a) * (W.rim - 60), crownY(60) - 1, Math.sin(a) * (W.rim - 60));
    const tip = mast(B, p, V(0, 1, 0), 60, 1.2);
    lamps.push({ p: tip, r: 3, color: k % 4 ? LAMP.RED : LAMP.WHITE, i: 2.2, breathe: 0.35, phase: k / 12 });
    dish(B, V(Math.cos(a + 0.03) * (W.rim + 40), crownY(40) + 15, Math.sin(a + 0.03) * (W.rim + 40)), V(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4), 22);
  }
  // lift rails along the top of each spoke
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU, c = Math.cos(a), s = Math.sin(a);
    for (const off of [-9, 9]) B.tube([V(c * (W.spokeIn + 40) - s * off, RAIL_Y, s * (W.spokeIn + 40) + c * off), V(c * (W.spokeOut - 30) - s * off, RAIL_Y, s * (W.spokeOut - 30) + c * off)], 2.2, 6, CK.BRONZE);
    for (let r = W.spokeIn + 80; r < W.spokeOut - 40; r += 120) {
      const h = RAIL_Y;
      B.box(c * r, h - 2.5, s * r, 24, 4, 24, CK.DARK);
      lamps.push({ p: V(c * r, h + 2, s * r), r: 1.6, color: LAMP.TEAL, i: 1.4, breathe: 0.2, phase: r / 1800 });
    }
  }
  return { geo: B.geometry(), lamps };
}

/** A spoke lift car (car-local metres, rides along +X, rail at y = 0). */
export function buildLiftCar() {
  const B = new CB();
  B.box(0, 9, 0, 30, 14, 22, CK.HULL);
  B.box(0, 10, 0, 30.4, 5, 22.4, CK.GLASS);
  B.box(0, 16.4, 0, 31, 1.2, 23, CK.BRONZE);
  for (const x of [-11, 11]) for (const z of [-9, 9]) B.box(x, 1.2, z, 3, 2.4, 3, CK.DARK);    // bogies on the rails
  const lamps = [
    { p: V(15.6, 9, 0), r: 1.2, color: LAMP.WHITE, i: 2.0, dir: V(1, 0, 0) },
    { p: V(-15.6, 9, 0), r: 1.2, color: LAMP.RED, i: 2.0, dir: V(-1, 0, 0) },
    { p: V(0, 17.5, 0), r: 1.0, color: LAMP.AMBER, i: 2.2, breathe: 0.5 },
  ];
  return { geo: B.geometry(), lamps };
}

/** Lift car position along a spoke at time t (wheel-local metres): hub to rim and back, pausing at each end. */
export function liftPose(k, j, t, out) {
  const W = WHEEL, T = 240, ph = (((t + k * 37 + j * T * 0.5) / T) % 1 + 1) % 1;
  const move = (x) => { const u = Math.min(Math.max(x, 0), 1); return u * u * (3 - 2 * u); };
  const s = ph < 0.4 ? move(ph / 0.4) : ph < 0.5 ? 1 : ph < 0.9 ? 1 - move((ph - 0.5) / 0.4) : 0;
  const r = W.spokeIn + 120 + s * (W.spokeOut - W.spokeIn - 260);
  const a = (k / 6) * TAU;
  out.set(Math.cos(a) * r, RAIL_Y + 2.2, Math.sin(a) * r);
  return a;
}

/** A gantry crane riding the docking ring's crown (crane-local metres: the ring's crown at the origin, +X radially out). */
export function buildRingCrane() {
  const B = new CB();
  const lamps = [];
  // saddle trolley straddling the ring's crown (2 m clear of the tube)
  B.box(0, 6, 0, 90, 8, 40, CK.DARK);
  for (const x of [-38, 38]) for (const z of [-15, 15]) B.box(x, 1.5, z, 10, 3, 8, CK.BRONZE);
  // the A-frame tower and cab
  for (const x of [-30, 30]) B.tube([V(x, 10, -16), V(0, 70, 0)], 3, 6, CK.HULL), B.tube([V(x, 10, 16), V(0, 70, 0)], 3, 6, CK.HULL);
  B.box(0, 74, 0, 14, 10, 14, CK.HULL);
  B.box(8, 76, 0, 2, 6, 12, CK.GLASS);
  lamps.push({ p: V(9.5, 76, 0), r: 1.6, color: [1.0, 0.8, 0.55], i: 1.6 });
  // the boom: a truss out over the berths, a counter-jib inward, the hoist trolley
  for (const y of [80, 92]) for (const z of [-4, 4]) B.tube([V(-90, y, z), V(260, y, z)], 1.6, 5, CK.BRONZE);
  for (let x = -90; x < 260; x += 17.5) { B.tube([V(x, 80, -4), V(x + 17.5, 92, 4)], 0.9, 4, CK.DARK); B.tube([V(x, 92, -4), V(x + 17.5, 80, 4)], 0.9, 4, CK.DARK); }
  B.box(-80, 72, 0, 24, 14, 14, CK.DARK);                        // counterweight
  B.box(200, 76, 0, 14, 6, 12, CK.BRONZE);                       // hoist trolley
  B.tube([V(200, 73, 0), V(200, 30, 0)], 0.5, 4, CK.DARK);       // cable
  B.box(200, 24, 0, 22, 12, 14, CK.PANEL);                       // the load: a cassette of radiator leaves
  lamps.push(flood(B, V(150, 78, 0), V(0.3, -1, 0), 2.2, LAMP.WHITE, 2.4));
  lamps.push({ p: V(262, 94, 0), r: 2.2, color: LAMP.AMBER, i: 2.8, breathe: 0.45 });
  lamps.push({ p: V(0, 80, 0), r: 2, color: LAMP.RED, i: 2.4, breathe: 0.3 });
  return { geo: B.geometry(), lamps };
}

/** Crane k's angle about the spindle at time t: centred between two berths, swinging through its sector. */
export function craneAngle(k, t) {
  const mid = RING.berthA[k] + TAU / 6;
  return mid + RING.swing * Math.sin(t * (0.011 + k * 0.002) + k * 2.1);
}

// ---------------------------------------------------------------- smooth shells ----
// Selene's builder (src/craft/craftGeometry.js buildRefinery) turns its spindle on 32 sides, the
// cracking columns on 20, its pipe runs on 6 to 8 and its spokes on 10: at the Selene view's
// 11 km those facets are the silhouette. These shells redraw each of those volumes on the
// builder's own profiles at 3 to 8 times the segments, a hair outside (a circle through a
// polygon's vertices encloses it, so the old facets never show through). Same finishes as the
// builder's, so the dressing (src/space/fleet.js dressSelene) repaints them with the rest.

const SH = 1.004;          // shell radius over the builder's
const toY = () => new THREE.Matrix4().makeRotationX(-Math.PI / 2);

/** Static shells (refinery metres, scale 1): spindle, columns, pipe runs, rings and manifolds. */
export function seleneShells() {
  const B = new CB();
  const lath = (prof, seg) => B.lathe(prof.map(([r, z, k]) => [r * SH, z, k]), seg);
  // spindle
  B.push(toY());
  lath([[20, -3000, CK.CONDUIT], [160, -2960, CK.BRONZE], [120, -2700, CK.HULL], [110, -800, CK.HULL], [260, -700, CK.GLASS], [260, -500, CK.GLASS],
    [120, -420, CK.HULL], [110, 1900, CK.HULL], [200, 2000, CK.BRONZE], [140, 2300, CK.HULL], [40, 2600, CK.LANTERN], [8, 2800, CK.HULL]], 160);
  B.pop();
  // cracking columns and the pipe runs joining them to the spindle
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    const x = Math.cos(a) * 560, z = Math.sin(a) * 560;
    B.push(toY());
    B.at(x, -z, 0);
    lath([[90, -2500, CK.HULL], [110, -2440, CK.BRONZE], [96, -2380, CK.HULL], [96, -1700, CK.GLASS], [120, -1660, CK.LANTERN], [96, -1620, CK.HULL], [96, -1100, CK.GLASS],
      [120, -1060, CK.LANTERN], [96, -1020, CK.HULL], [60, -900, CK.HULL], [10, -860, CK.HULL]], 72);
    B.pop(); B.pop();
    for (const y of [-2200, -1500, -1000]) B.tube([V(Math.cos(a) * 130, y, Math.sin(a) * 130), V(x, y, z)], 22 * SH, 20, CK.DARK);
  }
  for (const [y, R, r] of [[-2200, 560, 26], [-1000, 560, 26], [-2200, 125, 24], [-1500, 125, 24], [-1000, 125, 24]]) {
    B.push(new THREE.Matrix4().makeTranslation(0, y, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    B.torus(R, r * SH, R > 300 ? 192 : 96, 16, CK.BRONZE);
    B.pop();
  }
  // tank feed pipes (the tanks' own shells are dressSelene's)
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + 0.2;
    const r = 170 + (k % 3) * 40, y = 1200 + (k % 2) * 260;
    B.tube([V(Math.cos(a) * 110, y, Math.sin(a) * 110), V(Math.cos(a) * (680 - r + 25), y, Math.sin(a) * (680 - r + 25))], 24 * SH, 20, CK.DARK);
  }
  // docking ring and its four struts
  B.push(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  B.at(0, 0, -RING.y);
  B.torus(RING.R, RING.tube * SH, 192, 20, CK.HULL);
  B.torus(400, 10 * SH, 192, 10, CK.CONDUIT);
  B.pop(); B.pop();
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; B.tube([V(Math.cos(a) * 110, RING.y, Math.sin(a) * 110), V(Math.cos(a) * 400, RING.y, Math.sin(a) * 400)], 16 * SH, 16, CK.DARK); }
  return B.geometry();
}

/** Wheel shells (wheel-local metres): the hub race and the six spokes, smooth. */
export function seleneWheelShells() {
  const W = new CB();
  W.push(toY());
  W.lathe([[270, -710, CK.BRONZE], [350, -675, CK.HULL], [350, -525, CK.GLASS], [270, -490, CK.BRONZE]].map(([r, z, k]) => [r * SH, z, k]), 144, 0, { closedProfile: true });
  W.pop();
  // (the builder's spokes are straight 60 m tubes: its radius function is only read at the ends)
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    W.tube([V(Math.cos(a) * WHEEL.spokeIn, WHEEL.y, Math.sin(a) * WHEEL.spokeIn), V(Math.cos(a) * WHEEL.spokeOut, WHEEL.y, Math.sin(a) * WHEEL.spokeOut)], WHEEL.spokeR * SH, 40, k % 2 ? CK.HULL : CK.GLASS);
  }
  return W.geometry();
}
