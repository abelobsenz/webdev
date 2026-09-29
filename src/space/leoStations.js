import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { LAMP } from './lamps.js';
import { V, here, atAim, truss, catwalk, radiatorWing, dish, mast, dockingCollar, container, rcsQuad, flood, bell, sphereTank } from './shipKit.js';

// The stations of the low and middle shell, in metres, drawn with the craft builder (facade
// kinds give them lit rooms, plating, gardens under glass, photovoltaic blankets, radiators).
// Each builder returns its fixed and moving parts separately so the orbital module can turn
// habitat wheels, farm drums, solar wings and emitters about their real axes, plus lamp
// records (running lights, window arcades, dock lamps, grow lights) and the docking ports
// the shuttles use. Spin rates come from the radius: omega = sqrt(g / R) for one gravity.
//
//   Aurelia Wheel      orbital hotel, 51.6 deg: a 500 m wheel of suites round a docking
//                      spindle, a glass ballroom sphere at one end, sun-tracking wings.
//   Demeter Reach      orbital farm, 28 deg: two counter-rotating 320 m drums, their axes on
//                      the Sun, glazed land strips fed by hinged louvre-mirrors, and a
//                      granary of zero-g hydroponic stacks lit magenta behind them.
//   Boreal Watch       polar observatory, 90 deg: an Earth-pointing spine with dishes and
//                      telescopes looking down, a crew stack, a 1 g centrifuge.
//   Dawnline           sun-synchronous dawn-dusk power station: 1.9 km of photovoltaic
//                      blanket facing the Sun, a phased-array emitter on a gimbal mast
//                      holding on the ground station below.
//   Anansi skyhook     a rotovator: hub, 900 km of tether, grapple stations at both tips.
//   Halcyon            a torus town: 30 decks of glazed terraces, parkland under the roof, despun docks.
//   Gleaner            debris sweeper: capture net forward, ablation laser, hopper bins.

const TAU = Math.PI * 2;
const rotZ = (a) => new THREE.Matrix4().makeRotationZ(a);
const toY = new THREE.Matrix4().makeRotationX(-Math.PI / 2);   // lathe axis z -> +y
const tr = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
export const GROW = [1.0, 0.32, 0.82];
export const WARM = [1.0, 0.78, 0.5];

function latheAt(B, m, prof, seg, closed = false) { B.push(m); B.lathe(prof, seg, 0, { closedProfile: closed }); B.pop(); }

/** Sphere about local z (poles on z), kind by latitude fraction (0 bottom .. 1 top). */
function sphereZ(B, r, kindAt, seg = 32, rings = 16) {
  const prof = [];
  for (let i = 0; i <= rings; i++) {
    const a = -Math.PI / 2 + (i / rings) * Math.PI;
    prof.push([Math.max(Math.cos(a) * r, 0.02), Math.sin(a) * r, kindAt(i / rings)]);
  }
  B.lathe(prof, seg);
}

/**
 * A triangulated hoop girder about local z at radius r, axial position z: four chords (radial
 * depth d, axial width w) laced with alternating diagonals and a strut at every bay.
 */
function hoopGirder(B, r, z, d, w, n, rad, k = CK.DARK) {
  for (const dr of [-d / 2, d / 2]) for (const dz of [-w / 2, w / 2]) { B.push(tr(0, 0, z + dz)); B.torus(r + dr, rad, n, 4, k); B.pop(); }
  const P = (a, rr, zz) => V(Math.cos(a) * rr, Math.sin(a) * rr, z + zz);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, s = i % 2 ? 1 : -1;
    B.tube([P(a0, r - d / 2, s * w / 2), P(a1, r + d / 2, s * w / 2)], rad * 0.6, 3, k);
    B.tube([P(a0, r + d / 2, s * w / 2), P(a1, r + d / 2, -s * w / 2)], rad * 0.6, 3, k);
    B.tube([P(a0, r - d / 2, 0), P(a0, r + d / 2, 0)], rad * 0.7, 3, k);
  }
}

/** A pressurised module along +z from the current frame: windowed bands between bronze frames. */
function habModule(B, r, len, { glass = 3, seg = 20 } = {}) {
  const prof = [[0.02, 0, CK.DARK], [r * 0.72, len * 0.02, CK.HULL], [r, len * 0.08, CK.HULL]];
  const n = glass;
  for (let i = 0; i < n; i++) {
    const z0 = len * (0.12 + (0.76 * i) / n), z1 = len * (0.12 + (0.76 * (i + 1)) / n);
    prof.push([r * 1.03, z0, CK.BRONZE], [r * 1.03, z0 + len * 0.02, CK.BRONZE], [r, z0 + len * 0.025, CK.HULL], [r, z0 + len * 0.04, CK.GLASS], [r, z1 - len * 0.02, CK.GLASS], [r, z1 - len * 0.01, CK.HULL]);
  }
  prof.push([r * 1.03, len * 0.9, CK.BRONZE], [r, len * 0.92, CK.HULL], [r * 0.72, len * 0.98, CK.HULL], [0.02, len, CK.DARK]);
  B.lathe(prof, seg);
}

/** Photovoltaic wing in the builder's xz plane (normal +y), from x0 outward along +x (sign s). */
function solarWing(B, lamps, s, x0, span, chord, blankets = 5, z = 0) {
  const w = span / blankets;
  B.tube([V(s * (x0 - 6), 0, z), V(s * (x0 + span), 0, z)], Math.max(chord * 0.012, 0.6), 8, CK.DARK);   // mast
  for (let j = 0; j < blankets; j++) {
    const cx = s * (x0 + w * (j + 0.5));
    B.box(cx, 0.3, z, w * 0.94, 0.35, chord, CK.PANEL);
    B.box(cx, 0, z + chord / 2 + 0.4, w * 0.96, 0.8, 0.8, CK.DARK);          // tension frame
    B.box(cx, 0, z - chord / 2 - 0.4, w * 0.96, 0.8, 0.8, CK.DARK);
    B.box(s * (x0 + w * j), 0, z, 1.2, 1.2, chord + 1.6, CK.BRONZE);        // spreader bar
  }
  B.box(s * (x0 + span), 0, z, 1.6, 1.6, chord + 2, CK.BRONZE);
  B.box(s * (x0 - 2), 0, z, 5, 5, 7, CK.BRONZE);                              // drive
  lamps.push({ p: V(s * (x0 + span + 1.2), 0, z + chord / 2), r: 0.9, color: LAMP.WHITE, i: 3.0, breathe: 0.6, phase: s > 0 ? 0 : 0.5 });
  lamps.push({ p: V(s * (x0 + span + 1.2), 0, z - chord / 2), r: 0.9, color: s > 0 ? LAMP.GREEN : LAMP.RED, i: 3.2 });
}

/** A radial docking port: stub from the hull at p0 out along dir, a collar, lamps; records the port. */
function dockPort(B, lamps, ports, p0, dir, len, r) {
  const d = dir.clone().normalize();
  const p1 = p0.clone().addScaledVector(d, len);
  B.tube([p0, p1], r * 0.8, 12, CK.HULL);
  B.tube([p0.clone().addScaledVector(d, len * 0.3), p0.clone().addScaledVector(d, len * 0.34)], r * 0.95, 12, CK.BRONZE);
  atAim(B, p1, d);
  const c = dockingCollar(B, r);
  B.pop();
  lamps.push(...c.lamps);
  ports.push({ p: p1.clone().addScaledVector(d, r * 0.4), dir: d });
}

// -------------------------------------------------------------- hotel ----
export const HOTEL = { R: 250, depth: 20, halfW: 15, hubR: 37, hubIn: 18, spindle: 12, segs: 144, spokes: 6 };
export const hotelOmega = () => Math.sqrt(9.81 / HOTEL.R);
// the roof vault's facets across the rim: [z centre, rise, length, tilt] (half-width 15 m, 5 m rise)
const HOTEL_VAULT = (() => {
  const P = [[-14.4, 0], [-7, 4], [7, 4], [14.4, 0]];
  return P.slice(1).map(([z1, h1], i) => { const [z0, h0] = P[i]; return [(z0 + z1) / 2, (h0 + h1) / 2, Math.hypot(z1 - z0, h1 - h0), Math.atan2(h1 - h0, z1 - z0)]; });
})();

export function buildHotel() {
  const F = new CB(), W = new CB();
  const lamps = [], wheelLamps = [], ports = [];
  const { R, depth, halfW: hw, segs } = HOTEL;
  const r0 = R - depth;
  // ---- the wheel: suites in the side walls, a roof garden inboard, the floor outboard
  for (let k = 0; k < segs; k++) {
    const a = (k / segs) * TAU;
    W.push(rotZ(a));
    const arcO = (TAU * (R + 2)) / segs * 1.01, arcM = (TAU * R) / segs * 1.01, arcI = (TAU * r0) / segs * 1.01;
    W.box(0, R + 1, 0, arcO, 2, 2 * hw + 2, CK.HULL);
    W.box(0, R + 2.2, 0, arcO, 0.5, 1.2, CK.CONDUIT);                               // rim conduit
    for (const s of [-1, 1]) {
      W.box(0, R - depth / 2, s * hw, arcM, depth, 0.8, CK.GLASS);                   // five decks of suites
      W.box(0, R + 0.6, s * (hw + 0.6), arcO, 1.4, 1.4, CK.BRONZE);                 // floor edge beam
      if (k % 2 === 0) {
        W.box(0, R - 7.5, s * (hw + 1.6), arcM * 0.62, 7.4, 2.4, CK.GLASS);          // bay-window suites
        W.box(0, R - 3.6, s * (hw + 1.8), arcM * 0.7, 0.5, 3.0, CK.DARK);            // hood
        W.box(0, R - 11.4, s * (hw + 1.7), arcM * 0.7, 0.5, 2.8, CK.BRONZE);         // sill
      }
      if (k % 6 === 3) W.box(0, R + 2.3, s * 7, 3.2, 0.6, 2.4, CK.DARK);            // service hatch
    }
    // the roof garden under a three-facet glass vault (bronze arch every fourth bay)
    for (const [zm, hm, len, tilt] of HOTEL_VAULT) {
      W.push(tr(0, r0 - 0.5 - hm, zm).multiply(new THREE.Matrix4().makeRotationX(tilt)));
      W.box(0, 0, 0, arcI, 0.6, len + 0.3, k % 8 < 5 ? CK.ROOF : CK.CONSERVATORY);
      if (k % 4 === 0) W.box(0, -0.6, 0, 0.9, 1.0, len + 0.6, CK.BRONZE);
      W.pop();
    }
    // radiator fins on the floor's outer face every twelfth bay, edge-on along the spin axis
    if (k % 12 === 6) for (const s of [-1, 1]) {
      W.box(0, R + 8, s * 8, 0.5, 12, 11, CK.RADIATOR);
      W.box(0, R + 2.6, s * 8, 1.6, 1.2, 12, CK.BRONZE);
    }
    W.box(0, r0 - 1.1, 0, arcI, 0.3, 1.6, CK.DECK);                                   // roof promenade
    if (k % 4 === 0) {
      W.box(arcM / 2, R - depth / 2, 0, 0.9, depth + 3, 2 * hw + 1.8, CK.BRONZE);  // structural rib
      W.box(arcM / 2, r0 - 2.2, 0, 0.5, 2.4, 2 * hw - 1, CK.DARK);                  // rib crown
    }
    W.pop();
    if (k % 4 === 0) for (const s of [-1, 1]) {
      const c = Math.cos(a), sn = Math.sin(a);
      wheelLamps.push({ p: V(-sn * (R + 2.4), c * (R + 2.4), s * (hw + 1.6)), r: 0.7, color: LAMP.AMBER, i: 1.7, breathe: 0.15, phase: k / segs });
    }
    if (k % 12 === 6) { const c = Math.cos(a), sn = Math.sin(a); wheelLamps.push({ p: V(-sn * (r0 - 3), c * (r0 - 3), 0), r: 1.2, color: WARM, i: 1.6 }); }
    if (k % 4 === 2) for (const s of [-1, 1]) { const c = Math.cos(a), sn = Math.sin(a); wheelLamps.push({ p: V(-sn * (r0 - 1.6), c * (r0 - 1.6), s * 1.6), r: 0.4, color: WARM, i: 1.4, breathe: 0.1, phase: k / segs }); }
  }
  // spokes with glazed lift shafts and tension stays, hub drum on the bearings
  for (let k = 0; k < HOTEL.spokes; k++) {
    const a = (k / HOTEL.spokes) * TAU + TAU / (HOTEL.spokes * 2), c = Math.cos(a), s = Math.sin(a);
    const p0 = V(c * (HOTEL.hubR - 1), s * (HOTEL.hubR - 1), 0), p1 = V(c * (r0 - 0.8), s * (r0 - 0.8), 0);
    W.tube([p0, p1], 4.5, 14, CK.HULL);
    for (const z of [-6.2, 6.2]) W.tube([p0.clone().setZ(z), p1.clone().setZ(z)], 1.5, 8, CK.GLASS);
    for (const t of [0.12, 0.5, 0.88]) {
      atAim(W, p0.clone().lerp(p1, t), V(c, s, 0));
      W.lathe([[4.5, -1.2, CK.BRONZE], [6.8, -0.6, CK.BRONZE], [6.8, 0.6, CK.HULL], [4.5, 1.2, CK.BRONZE]], 16, 0, { closedProfile: true });
      W.pop();
    }
    for (const z of [-1, 1]) W.tube([V(c * 30, s * 30, z * 28), V(c * (r0 - 1), s * (r0 - 1), z * (hw - 2))], 0.35, 4, CK.DARK);
    wheelLamps.push({ p: V(c * (R + 3), s * (R + 3), 0), r: 1.4, color: k % 2 ? LAMP.RED : LAMP.GREEN, i: 3.0 });
  }
  // the rim's structure, outside the pressure hull: a laced keel girder under the floor, glazed
  // promenade galleries along both faces at mid-deck, on brackets every third bay
  hoopGirder(W, R + 5, 0, 5, 2 * hw - 6, segs / 2, 0.35, CK.DARK);
  for (const s of [-1, 1]) {
    W.push(tr(0, 0, s * (hw + 5.2))); W.torus(R - depth * 0.62, 2.1, segs * 2, 8, CK.GLASS); W.pop();
    W.push(tr(0, 0, s * (hw + 5.2))); W.torus(R - depth * 0.62 - 2.4, 0.5, segs * 2, 4, CK.BRONZE); W.pop();
    for (let k = 0; k < segs; k += 3) {
      const a = (k / segs) * TAU, c = Math.cos(a), sn = Math.sin(a), rr = R - depth * 0.62;
      W.tube([V(c * rr, sn * rr, s * (hw + 0.4)), V(c * rr, sn * rr, s * (hw + 3.2))], 0.45, 4, CK.BRONZE);
    }
  }
  // each spoke sheathed in a laced truss round its lift shaft
  for (let k = 0; k < HOTEL.spokes; k++) {
    const a = (k / HOTEL.spokes) * TAU + TAU / (HOTEL.spokes * 2), c = Math.cos(a), s = Math.sin(a);
    truss(W, V(c * (HOTEL.hubR + 4), s * (HOTEL.hubR + 4), 0), V(c * (r0 - 8), s * (r0 - 8), 0), 17, 16, 0.3, CK.DARK);
  }
  W.lathe([[HOTEL.hubIn, -32, CK.DARK], [HOTEL.hubR - 3, -32, CK.HULL], [HOTEL.hubR, -28, CK.BRONZE], [HOTEL.hubR, -20, CK.HULL], [HOTEL.hubR + 1, -12, CK.GLASS],
    [HOTEL.hubR + 1, 12, CK.GLASS], [HOTEL.hubR, 20, CK.HULL], [HOTEL.hubR, 28, CK.BRONZE], [HOTEL.hubR - 3, 32, CK.HULL], [HOTEL.hubIn, 32, CK.DARK]], 48, 0, { closedProfile: true });

  // ---- fixed: spindle, bearing races, docking drum, wings, radiators, ballroom sphere
  const sp = HOTEL.spindle;
  F.lathe([[sp, -130, CK.HULL], [sp, -42, CK.HULL], [sp + 1, -41, CK.BRONZE], [sp + 1, 41, CK.BRONZE], [sp, 42, CK.HULL], [sp, 98, CK.HULL]], 28);
  for (const s of [-1, 1]) latheAt(F, tr(0, 0, 0), [[sp, s * 33.5, CK.BRONZE], [31, s * 33.5, CK.BRONZE], [31, s * 41, CK.DARK], [sp, s * 41, CK.DARK]], 40, true);
  F.lathe([[sp, -58, CK.HULL], [26, -64, CK.HULL], [28, -70, CK.BRONZE], [28, -80, CK.HULL], [28.6, -84, CK.GLASS], [28.6, -104, CK.GLASS], [28, -108, CK.HULL], [28, -118, CK.BRONZE], [24, -124, CK.HULL], [sp, -130, CK.DARK]], 40);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + TAU / 8, d = V(Math.cos(a), Math.sin(a), 0);
    dockPort(F, lamps, ports, d.clone().multiplyScalar(27).setZ(-94), d, 18, 4.2);
  }
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; lamps.push({ p: V(Math.cos(a) * 29.2, Math.sin(a) * 29.2, -70), r: 0.6, color: WARM, i: 1.4 }); }
  // power mast aft, wings in x (normal y: the whole fixed frame rolls about z to face the Sun)
  truss(F, V(0, 0, -130), V(0, 0, -300), 9, 10, 0.35, CK.DARK);
  solarWing(F, lamps, 1, 14, 190, 64, 5, -250);
  solarWing(F, lamps, -1, 14, 190, 64, 5, -250);
  for (const s of [-1, 1]) radiatorWing(F, V(0, s * 6, -180), V(0, s, 0), V(1, 0, 0), 90, 34, lamps, s > 0 ? LAMP.AMBER : LAMP.AMBER);
  catwalk(F, V(4.8, -4.8, -134), V(4.8, -4.8, -296), V(1, -1, 0).normalize(), 1.2, 1.1);
  lamps.push({ p: V(0, 0, -304), r: 1.6, color: LAMP.RED, i: 3.4, breathe: 0.7 });
  // the ballroom: a glazed sphere on the spindle's head, gardens in its lower bowl, a balcony
  F.push(tr(0, 0, 142));
  sphereZ(F, 44, (u) => (u < 0.3 ? CK.CONSERVATORY : u > 0.94 ? CK.BRONZE : CK.GLASS), 48, 24);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU, pts = [];
    for (let i = 1; i < 16; i++) { const b = -Math.PI / 2 + (i / 16) * Math.PI; pts.push(V(Math.cos(a) * Math.cos(b) * 44.6, Math.sin(a) * Math.cos(b) * 44.6, Math.sin(b) * 44.6)); }
    F.tube(pts, 0.7, 5, CK.BRONZE);
  }
  F.torus(48.5, 1.4, 120, 6, CK.DECK);
  F.push(tr(0, 0, 1.3)); F.torus(50.2, 0.12, 120, 4, CK.BRONZE); F.pop();
  for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; F.box(Math.cos(a) * 50.2, Math.sin(a) * 50.2, 0.65, 0.12, 0.12, 1.3, CK.DARK); }
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; F.tube([V(Math.cos(a) * 44, Math.sin(a) * 44, -2), V(Math.cos(a) * 48.5, Math.sin(a) * 48.5, 0)], 0.8, 5, CK.BRONZE); }
  F.pop();
  F.tube([V(0, 0, 97), V(0, 0, 100)], 15, 20, CK.BRONZE);
  const tip = mast(F, V(0, 0, 186), V(0, 0, 1), 26, 0.5);
  lamps.push({ p: tip, r: 1.8, color: LAMP.RED, i: 3.6, breathe: 0.7 });
  for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; lamps.push({ p: V(Math.cos(a) * 49.5, Math.sin(a) * 49.5, 143.2), r: 0.45, color: WARM, i: 1.8 }); }
  return { fixed: F.geometry(), wheel: W.geometry(), lamps, wheelLamps, ports, radius: 0.34 };
}

// ------------------------------------------------------------ habitat ----
export const HAB = { R: 960, depth: 110, halfW: 65, hubR: 90, axle: 30, segs: 240, spokes: 6 };
export const habOmega = () => Math.sqrt(9.81 / HAB.R);
export const HAB_COLLECTOR = { petals: 40, rIn: 300, rOut: 1060, cone: THREE.MathUtils.degToRad(11), z: 340 };

/**
 * Halcyon: a town-sized torus (1.9 km across, one turn a minute for 1 g) on six spokes, its axis
 * on the Sun. Thirty decks of terraced apartments glazed in the side walls look out; the inner
 * roof is parkland under glass, shaded by chevron louvres; the rim is a thick shielding floor.
 * A despun axle carries the docks and, sunward, the light-collector annulus.
 */
export function buildHabitat() {
  const F = new CB(), W = new CB();
  const lamps = [], wheelLamps = [], ports = [];
  const { R, depth, halfW: hw, segs } = HAB;
  const r0 = R - depth;
  // The wheel's section, from the rim in: a thick shielding floor with radiator fins standing
  // edge-on to the Sun; side walls stepped back in four terraces of glazed apartments, each
  // tier's roof a planted balcony; a vaulted glass roof over the park, on bronze arch ribs.
  const TIERS = 4, tierH = depth / TIERS, step = 7;
  const vault = [[-(hw - 22), 0], [-(hw - 30), 6], [-(hw - 44), 12], [hw - 44, 12], [hw - 30, 6], [hw - 22, 0]];
  for (let k = 0; k < segs; k++) {
    const a = (k / segs) * TAU;
    W.push(rotZ(a));
    const arcO = (TAU * (R + 6)) / segs * 1.01, arcM = (TAU * R) / segs * 1.01, arcI = (TAU * r0) / segs * 1.01;
    W.box(0, R + 3, 0, arcO, 6, 2 * hw + 6, CK.HULL);                               // shielding floor
    W.box(0, R + 6.4, 0, arcO, 0.8, 3, CK.CONDUIT);
    for (const s of [-1, 1]) W.box(0, R + 7.5, s * (hw - 10), arcO, 3, 8, CK.DARK);   // keel rails
    // radiator fins every eighth bay, in planes that hold the spin axis (edge-on to the Sun)
    if (k % 8 === 4) for (const s of [-1, 1]) {
      W.box(0, R + 26, s * (hw - 30), 1.4, 40, 44, CK.RADIATOR);
      W.box(0, R + 8, s * (hw - 30), 5, 4, 48, CK.BRONZE);                           // manifold
    }
    for (const s of [-1, 1]) {
      // terraces: the lowest tier (at the rim, full gravity) stands furthest out
      for (let t = 0; t < TIERS; t++) {
        const y = R - tierH * (t + 0.5), z = s * (hw - step * t);   // tier 0 on the floor edge, each one above set back 7 m
        W.box(0, y, z, arcM * (1 - t * 0.02), tierH - 2.4, 2, CK.GLASS);             // glazed apartments
        W.box(0, y - tierH / 2 + 0.2, z - s * 3.6, arcM, 1.6, 7.2, t === TIERS - 1 ? CK.BRONZE : CK.DECK);   // floor slab / balcony
        if (t < TIERS - 1 && k % 2 === 0) W.box(0, y - tierH / 2 - 1.2, z - s * 5.0, arcM * 0.86, 1.4, 3.4, CK.CONSERVATORY);   // planters on the terrace above
        if (k % 3 === 0) W.box(0, y, z + s * 0.9, 1.2, tierH - 2.4, 1.4, CK.BRONZE);  // mullion piers
      }
      W.box(0, R - depth / 2, s * (hw - 25), arcM, depth, 3, CK.HULL);              // pressure wall behind the terraces
      W.box(0, r0 - 2, s * (hw - 22), arcI, 4, 6, CK.BRONZE);                       // roof edge beam, over the top tier
    }
    // the park roof: a five-facet glass vault, bronze arch ribs every sixth bay
    for (let v = 0; v < vault.length - 1; v++) {
      const [z0, h0] = vault[v], [z1, h1] = vault[v + 1];
      const zm = (z0 + z1) / 2, hm = (h0 + h1) / 2, len = Math.hypot(z1 - z0, h1 - h0), tilt = Math.atan2(h1 - h0, z1 - z0);
      W.push(tr(0, r0 - 1 - hm, zm).multiply(new THREE.Matrix4().makeRotationX(tilt)));
      W.box(0, 0, 0, arcI, 1.2, len + 0.6, k % 10 < 7 ? CK.ROOF : CK.CONSERVATORY);
      if (k % 6 === 0) W.box(0, -1.2, 0, 2.4, 2.4, len + 1.2, CK.BRONZE);
      W.pop();
    }
    if (k % 2 === 1) W.box(0, r0 - 14.6, 0, arcI * 0.22, 1, 2 * hw - 90, CK.DARK);  // chevron louvre, just over the crown glass
    if (k % 6 === 0) {
      W.box(arcM / 2, R - depth / 2, 0, 3, depth + 10, 2 * (hw - 23), CK.BRONZE);   // bulkhead frame, inside the terraces
      for (const s of [-1, 1]) for (let t = 0; t < TIERS; t++) W.box(arcM / 2, R - tierH * (t + 0.5), s * (hw - step * t + 1.4), 3, tierH, 2.8, CK.BRONZE);   // terrace frame, stepped with the tiers
    }
    W.pop();
    const c = Math.cos(a), sn = Math.sin(a);
    if (k % 6 === 0) for (const s of [-1, 1]) wheelLamps.push({ p: V(-sn * (R + 7), c * (R + 7), s * (hw + 3.2)), r: 2.2, color: LAMP.AMBER, i: 1.6, breathe: 0.12, phase: k / segs });   // on the frames only
    if (k % 4 === 1) wheelLamps.push({ p: V(-sn * (r0 - 16), c * (r0 - 16), 0), r: 2.6, color: WARM, i: 1.7 });
    if (k % 8 === 4) for (const s of [-1, 1]) wheelLamps.push({ p: V(-sn * (R + 47), c * (R + 47), s * (hw - 30)), r: 1.8, color: LAMP.RED, i: 2.4, breathe: 0.5, phase: k / 40 });
  }
  for (let k = 0; k < HAB.spokes; k++) {
    const a = (k / HAB.spokes) * TAU + TAU / 12, c = Math.cos(a), s = Math.sin(a);
    const p0 = V(c * (HAB.hubR - 2), s * (HAB.hubR - 2), 0), p1 = V(c * (r0 - 2), s * (r0 - 2), 0);
    W.tube([p0, p1], 13, 16, CK.HULL);
    for (const z of [-17, 17]) W.tube([p0.clone().setZ(z), p1.clone().setZ(z)], 4, 10, CK.GLASS);
    for (let j = 1; j < 8; j++) { atAim(W, p0.clone().lerp(p1, j / 8), V(c, s, 0)); W.lathe([[13, -2, CK.BRONZE], [18, -1, CK.BRONZE], [18, 1, CK.HULL], [13, 2, CK.BRONZE]], 20, 0, { closedProfile: true }); W.pop(); }
    // the spoke's load-bearing truss round its lift shafts (the pressure tube only carries air)
    truss(W, V(c * (HAB.hubR + 6), s * (HAB.hubR + 6), 0), V(c * (r0 - 24), s * (r0 - 24), 0), 48, 40, 1.0, CK.DARK);
    wheelLamps.push({ p: V(c * (R + 8), s * (R + 8), 0), r: 4, color: k % 2 ? LAMP.RED : LAMP.GREEN, i: 3.2 });
  }
  W.lathe([[HAB.axle + 8, -60, CK.DARK], [HAB.hubR - 6, -60, CK.HULL], [HAB.hubR, -50, CK.BRONZE], [HAB.hubR, -20, CK.HULL], [HAB.hubR + 2, -10, CK.GLASS],
    [HAB.hubR + 2, 10, CK.GLASS], [HAB.hubR, 20, CK.HULL], [HAB.hubR, 50, CK.BRONZE], [HAB.hubR - 6, 60, CK.HULL], [HAB.axle + 8, 60, CK.DARK]], 64, 0, { closedProfile: true });
  // ---- despun: axle, bearings, the docks astern, the collector annulus sunward
  const ax = HAB.axle;
  F.lathe([[ax, -260, CK.HULL], [ax, -70, CK.HULL], [ax + 1, -68, CK.BRONZE], [ax + 1, 68, CK.BRONZE], [ax, 70, CK.HULL], [ax, 290, CK.HULL]], 40);
  for (const s of [-1, 1]) latheAt(F, tr(0, 0, 0), [[ax, s * 63, CK.BRONZE], [HAB.hubR - 10, s * 63, CK.BRONZE], [HAB.hubR - 10, s * 74, CK.DARK], [ax, s * 74, CK.DARK]], 48, true);
  F.lathe([[ax, -150, CK.HULL], [60, -160, CK.HULL], [64, -170, CK.BRONZE], [64.5, -176, CK.GLASS], [64.5, -214, CK.GLASS], [64, -220, CK.BRONZE], [56, -236, CK.HULL], [ax, -260, CK.DARK]], 48);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU, d = V(Math.cos(a), Math.sin(a), 0);
    dockPort(F, lamps, ports, d.clone().multiplyScalar(62).setZ(-195), d, 26, 6);
  }
  // the collector, sunward: forty petals of reflective film on a shallow cone, parted so the
  // wheel and the stars show between them, each on its own spar from a hub girder ring, the
  // lip held by stays from a guyed mast on the axis (an umbrella, not a plate)
  truss(F, V(0, 0, 290), V(0, 0, 330), 20, 20, 0.8, CK.DARK);
  F.push(tr(0, 0, HAB_COLLECTOR.z));
  const { petals: nP, rIn, rOut, cone } = HAB_COLLECTOR, cc = Math.cos(cone), sc = Math.sin(cone);
  hoopGirder(F, rIn, 0, 18, 12, 64, 2.2, CK.DARK);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    F.tube([V(Math.cos(a) * 40, Math.sin(a) * 40, 0), V(Math.cos(a) * (rIn - 8), Math.sin(a) * (rIn - 8), 0)], 3, 6, CK.BRONZE);
    F.tube([V(Math.cos(a) * 40, Math.sin(a) * 40, -20), V(Math.cos(a) * (rIn - 8), Math.sin(a) * (rIn - 8), 0)], 1.2, 4, CK.DARK);
  }
  const span = rOut - rIn, strips = 6, dl = span / strips;
  for (let k = 0; k < nP; k++) {
    const a = ((k + 0.5) / nP) * TAU;
    F.push(rotZ(a - Math.PI / 2).multiply(tr(0, 0, 0)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)).multiply(tr(rIn, 0, 0)).multiply(new THREE.Matrix4().makeRotationY(-cone)));
    for (let j = 0; j < strips; j++) {
      const x = 12 + (j + 0.5) * dl, rr = rIn + x * cc, w = (TAU * rr) / nP * 0.84;
      F.box(x, 0, 1.2, dl - 2.5, w, 0.8, CK.PANEL);                                  // film gore (sunward)
      F.box(x, 0, 0.1, dl - 2.5, w * 0.98, 0.5, CK.DARK);                             // backing
      F.box(x - dl / 2, 0, -0.2, 1.4, w + 2, 1.4, CK.BRONZE);                         // cross batten
    }
    F.box(12 + span / 2, 0, -2.5, span, 5, 4, CK.BRONZE);                              // spar
    F.tube([V(0, 0, -4), V(12 + span * 0.5, 0, -18), V(12 + span, 0, -4)], 0.9, 4, CK.DARK);   // king-post truss under it
    if (k % 4 === 0) lamps.push({ p: here(F, 14 + span, 0, 2), r: 4, color: k % 8 ? LAMP.WHITE : LAMP.RED, i: 3.2, breathe: 0.6, phase: k / nP });
    F.pop();
  }
  const lipR = rIn + (12 + span) * cc, lipZ = (12 + span) * sc;
  F.push(tr(0, 0, lipZ)); F.torus(lipR, 2.6, 160, 5, CK.BRONZE); F.pop();
  truss(F, V(0, 0, 10), V(0, 0, 260), 14, 22, 0.6, CK.DARK);                          // the guyed mast
  for (let k = 0; k < 20; k++) {
    const a = ((k + 0.5) / 20) * TAU;
    F.tube([V(0, 0, 262), V(Math.cos(a) * lipR, Math.sin(a) * lipR, lipZ)], 0.7, 3, CK.DARK);
  }
  lamps.push({ p: V(0, 0, HAB_COLLECTOR.z + 268), r: 4, color: LAMP.WHITE, i: 3.6, breathe: 0.8 });
  F.pop();
  for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; lamps.push({ p: V(Math.cos(a) * 65.2, Math.sin(a) * 65.2, -195 + ((k % 2) ? 12 : -12)), r: 1.4, color: WARM, i: 1.8 }); }
  lamps.push({ p: V(0, 0, -266), r: 4, color: LAMP.RED, i: 3.4, breathe: 0.7 });
  return { fixed: F.geometry(), wheel: W.geometry(), lamps, wheelLamps, ports };
}

/**
 * A flat mirror film (w across x, L along +z from the hinge, at local height y, its reflective
 * face down -y) appended to sheet { pos, nrm, uv, idx } through matrix M; aMir holds the film
 * coordinates in metres for the mirror shader's gores and seams.
 */
function mirrorSheet(sheet, M, w, L, y, nx = 4, nz = 16) {
  const base = sheet.pos.length / 3, p = new THREE.Vector3(), n = new THREE.Vector3(0, -1, 0).transformDirection(M);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = -w / 2 + (w * i) / nx, z = (L * j) / nz;
    p.set(x, y, z).applyMatrix4(M);
    sheet.pos.push(p.x, p.y, p.z); sheet.nrm.push(n.x, n.y, n.z); sheet.uv.push(x, z);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = base + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    sheet.idx.push(a, b, d, a, d, c);
  }
}

// --------------------------------------------------------------- farm ----
export const FARM = { R: 160, halfL: 320, sep: 290, mirrorLen: 520, tilt: THREE.MathUtils.degToRad(12), strips: 3 };
export const farmOmega = () => Math.sqrt(9.81 / FARM.R);
// the drums' end-cap profile beyond the hull's end [radius m, distance beyond the end m, kind]
const FARM_CAP = [[163, 4, CK.HULL], [146, 16, CK.HULL], [118, 26, CK.GLASS], [82, 33, CK.HULL], [45, 37, 'crown'], [9.9, 38, CK.DARK]];   // (the last point: the axle stub, inside the bearing bore)

/** One drum (axis z): alternating land and glazed strips, hoops and mullion ribs, louvre-mirrors. */
export function buildFarmDrum() {
  const B = new CB(), lamps = [], sheet = { pos: [], nrm: [], uv: [], idx: [] };
  const { R, halfL: L } = FARM;
  const K = 72, rings = [];
  for (let j = 0; j <= 16; j++) {
    const z = -L + (j / 16) * 2 * L, pts = [];
    for (let i = 0; i < K; i++) { const a = (i / K) * TAU; pts.push([Math.cos(a) * R, Math.sin(a) * R]); }
    rings.push({ z, pts });
  }
  // six sectors: glazed (gardens under glass) and land (the plated outer shell)
  const sector = (i) => Math.floor((i / K) * 6);
  // land strips are the plated shell, except the towns at their ends, where the hull is glazed
  B.loft(rings, (i, j) => (sector(i) % 2 === 0 ? CK.ROOF : (j === 1 || j === 15 ? CK.GLASS : CK.HULL)), { capStart: false, capEnd: false });
  for (let k = 0; k < 3; k++) {
    const a = ((2 * k + 1.5) / 6) * TAU;
    B.push(rotZ(a - Math.PI / 2));
    B.box(0, R + 0.5, 0, 1.6, 1, 2 * L - 8, CK.DARK);                               // service ladder
    for (let j = 0; j < 32; j++) B.box(0, R + 1.2, -L + 10 + j * ((2 * L - 20) / 31), 3.4, 0.5, 0.4, CK.BRONZE);
    for (const zt of [-L + 40, L - 40]) { B.box(-12, R + 1.6, zt, 8, 3, 10, CK.HULL); B.box(-12, R + 3.2, zt, 6, 0.4, 8, CK.DECK); }   // airlocks
    B.pop();
    for (const zt of [-L + 40, L - 40]) for (const da of [-0.06, 0, 0.06]) lamps.push({ p: V(Math.cos(a + da) * (R + 1.2), Math.sin(a + da) * (R + 1.2), zt + da * 300), r: 1.6, color: WARM, i: 2.0 });
  }
  // end caps: shallow domes, a glazed ring of the cap towns between plated shoulders, the sun
  // cap's crown in photovoltaic film and the shadow cap's in radiator, ribbed with bronze
  for (const s of [-1, 1]) {
    const cap = FARM_CAP.map(([r, dz, k]) => [r, s * (L + dz), k === 'crown' ? (s > 0 ? CK.PANEL : CK.RADIATOR) : k]);
    latheAt(B, tr(0, 0, 0), [[R, s * L, CK.BRONZE], [R + 3, s * (L - 2), CK.BRONZE], ...cap, [10, s * (L + 44), CK.BRONZE], [0.02, s * (L + 44), CK.DARK]], 72);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU, c = Math.cos(a), sn = Math.sin(a);
      B.tube(FARM_CAP.slice(0, -2).map(([r, dz]) => V(c * (r + 1.1), sn * (r + 1.1), s * (L + dz + 1.1))), 0.9, 4, CK.BRONZE);   // (they stop at the crown, clear of the bearing)
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU, r = FARM_CAP[2][0] - 2;
      lamps.push({ p: V(Math.cos(a) * r, Math.sin(a) * r, s * (L + FARM_CAP[2][1] + 2)), r: 1.2, color: WARM, i: 1.9, breathe: 0.2, phase: k / 16 });
    }
  }
  // ring girders round the drum every eighth of its length: the hoops that carry the hull's
  // hoop stress, laced box sections standing proud of the glazing
  for (let h = 1; h < 8; h++) hoopGirder(B, R + 4.5, -L + (h / 8) * 2 * L, 6, 5, 72, 0.55, CK.BRONZE);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    B.push(rotZ(a - Math.PI / 2));
    B.box(0, R + 1.5, 0, 3.2, 3, 2 * L, CK.BRONZE);
    B.pop();
    for (let j = 0; j <= 8; j++) lamps.push({ p: V(Math.cos(a) * (R + 3.4), Math.sin(a) * (R + 3.4), -L + (j / 8) * 2 * L), r: 1.3, color: LAMP.AMBER, i: 1.8 });
  }
  // longitudinal mullion ribs across the glazed strips (every 12 m round)
  for (let i = 0; i < K; i++) if (sector(i) % 2 === 0 && i % 2) {
    const a = (i / K) * TAU;
    B.push(rotZ(a - Math.PI / 2)); B.box(0, R + 0.5, 0, 0.8, 1, 2 * L, CK.DARK); B.pop();
  }
  // hinged louvre-mirrors over the glazed strips (hinge at the anti-sun end, -z)
  const Lm = FARM.mirrorLen;
  for (let k = 0; k < 3; k++) {
    const a = ((2 * k + 0.5) / 6) * TAU;
    const m = rotZ(a - Math.PI / 2).multiply(tr(0, R + 4, -L + 6)).multiply(new THREE.Matrix4().makeRotationX(-FARM.tilt));
    B.push(m);
    const w = R * (TAU / 6) * 0.94;
    // aluminised film facing the drum (a shader sheet, below), on a dark ribbed backing
    for (let j = 0; j < 8; j++) B.box(0, 1.3, (j + 0.5) * (Lm / 8), w, 0.3, Lm / 8 - 2, CK.DARK);
    mirrorSheet(sheet, B.M, w - 1, Lm - 1, 0.95);
    for (const s of [-1, 1]) B.box(s * w / 2, 0, Lm / 2, 2, 2, Lm, CK.DARK);
    for (let j = 0; j <= 8; j++) B.box(0, 0, j * (Lm / 8), w + 2, 1.4, 1.4, CK.BRONZE);
    B.box(0, -1, 0, w * 0.7, 3.6, 5, CK.BRONZE);                                  // hinge
    lamps.push({ p: here(B, w / 2 + 1.5, 0, Lm), r: 1.5, color: LAMP.WHITE, i: 2.6, breathe: 0.5, phase: k / 3 });
    lamps.push({ p: here(B, -w / 2 - 1.5, 0, Lm), r: 1.5, color: LAMP.WHITE, i: 2.6, breathe: 0.5, phase: k / 3 + 0.5 });
    B.pop();
    // stays from the drum's sun end to the mirror's free end hold the tilt
    const tipLocal = V(0, R + 4 + Math.sin(FARM.tilt) * Lm, -L + 6 + Math.cos(FARM.tilt) * Lm).applyMatrix4(rotZ(a - Math.PI / 2));
    B.tube([V(Math.cos(a) * (R + 3), Math.sin(a) * (R + 3), L - 20), tipLocal], 0.6, 4, CK.DARK);
  }
  const mirrors = new THREE.BufferGeometry();
  mirrors.setAttribute('position', new THREE.Float32BufferAttribute(sheet.pos, 3));
  mirrors.setAttribute('normal', new THREE.Float32BufferAttribute(sheet.nrm, 3));
  mirrors.setAttribute('aMir', new THREE.Float32BufferAttribute(sheet.uv, 2));
  mirrors.setIndex(sheet.idx);
  mirrors.computeBoundingSphere();
  return { geo: B.geometry(), mirrors, lamps, sweep: R + 4 + Math.sin(FARM.tilt) * Lm + 2 };
}

/** The fixed frame: end trusses and bearings, the sunward dock, the granary stacks astern. */
export function buildFarmFrame() {
  const B = new CB(), lamps = [], ports = [];
  const { sep, halfL: L } = FARM;
  for (const s of [-1, 1]) {
    const z = s * (L + 56);
    truss(B, V(-sep - 30, 0, z), V(sep + 30, 0, z), 16, 24, 0.7, CK.DARK);
    for (const x of [-sep, sep]) {
      latheAt(B, tr(x, 0, z - s * 10), [[11, -6, CK.BRONZE], [26, -6, CK.BRONZE], [28, -3, CK.HULL], [28, 3, CK.HULL], [26, 6, CK.DARK], [11, 6, CK.DARK]], 36, true);
      lamps.push({ p: V(x, 30, z), r: 1.6, color: LAMP.AMBER, i: 2.2, breathe: 0.3 });
    }
    lamps.push({ p: V(sep + 32, 0, z), r: 1.8, color: LAMP.GREEN, i: 3 }, { p: V(-sep - 32, 0, z), r: 1.8, color: LAMP.RED, i: 3 });
  }
  // sunward: the dock on the forward truss
  B.push(tr(0, 0, L + 64));
  B.lathe([[8, 0, CK.DARK], [22, 4, CK.HULL], [24, 10, CK.BRONZE], [24.5, 14, CK.GLASS], [24.5, 40, CK.GLASS], [24, 44, CK.BRONZE], [22, 70, CK.HULL], [8, 76, CK.DARK]], 36);
  B.pop();
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + TAU / 8, d = V(Math.cos(a), Math.sin(a), 0); dockPort(B, lamps, ports, d.clone().multiplyScalar(23).setZ(L + 64 + 56), d, 16, 4); }
  dockPort(B, lamps, ports, V(0, 0, L + 64 + 76), V(0, 0, 1), 10, 5);
  // astern: the granary, a spine of glazed hydroponic stacks under grow light
  truss(B, V(0, 0, -L - 56), V(0, 0, -L - 520), 12, 18, 0.55, CK.DARK);
  for (let i = 0; i < 5; i++) {
    const z0 = -L - 90 - i * 84;
    for (const sx of [-1, 1]) {
      B.push(tr(sx * 48, 0, z0).multiply(new THREE.Matrix4().makeRotationX(Math.PI)));
      habModule(B, 30, 70, { glass: 3, seg: 28 });
      B.pop();
      B.tube([V(sx * 6, 0, z0 - 35), V(sx * 18, 0, z0 - 35)], 5, 10, CK.HULL);
      for (let j = 0; j < 10; j++) {
        const a = (j / 10) * TAU;
        lamps.push({ p: V(sx * 48 + Math.cos(a) * 31, Math.sin(a) * 31, z0 - 20 - (j % 2) * 30), r: 1.4, color: GROW, i: 2.2, breathe: 0.25, phase: (i + j) / 7 });
      }
    }
    // silos above and below the spine
    for (const sy of [-1, 1]) { B.tube([V(0, sy * 5, z0 - 35), V(0, sy * 20, z0 - 35)], 3, 8, CK.BRONZE); B.push(tr(0, sy * 32, z0 - 35)); sphereTank(B, 14, CK.HULL, 18); B.pop(); }
  }
  // granary radiators: edge-on to the Sun (their planes contain the drum axis)
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) radiatorWing(B, V(0, s * 8, -L - 167 - i * 168), V(0, s, 0), V(1, 0, 0), 150, 40, lamps, i ? LAMP.AMBER : null);
  // cargo court: containers on the aft truss
  for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) container(B, (j ? 1 : -1) * 8.6, 0, -L - 470 - i * 8, 5, 5, 7, (i + j) % 3 === 0 ? CK.BRONZE : CK.HULL);
  lamps.push({ p: V(0, 0, -L - 530), r: 2, color: LAMP.RED, i: 3.4, breathe: 0.7 });
  return { geo: B.geometry(), lamps, ports };
}

// -------------------------------------------------------------- polar ----
export const POLAR = { ringR: 64, ringTube: 7, ringY: 40, wingY: 205 };
export const polarOmega = () => Math.sqrt(9.81 / (POLAR.ringR + POLAR.ringTube));

/** Earth-pointing observatory (+y away from the Earth, +z along track): body, centrifuge, wings. */
export function buildPolar() {
  const B = new CB(), Rg = new CB(), Wg = new CB();
  const lamps = [], ringLamps = [], wingLamps = [], ports = [];
  truss(B, V(0, -226, 0), V(0, 262, 0), 10, 12, 0.4, CK.DARK);
  // nadir deck: instruments looking down
  B.box(0, -232, 0, 96, 8, 96, CK.HULL);
  B.box(0, -237, 0, 88, 2, 88, CK.DARK);
  for (const [x, z] of [[-30, -28], [30, -28], [0, 34]]) dish(B, V(x, -240, z), V(0, -1, 0), 14);
  for (const [x, z] of [[-32, 26], [32, 26]]) {
    B.push(tr(x, -236, z).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    B.lathe([[7, 0, CK.BRONZE], [7.4, 2, CK.HULL], [7.4, 30, CK.HULL], [8.2, 32, CK.BRONZE], [8.2, 40, CK.DARK], [6.6, 40, CK.DARK], [6.6, 36, CK.GLASS], [0.02, 36, CK.GLASS]], 24);
    B.pop();
    lamps.push({ p: V(x, -277, z), r: 1.2, color: LAMP.TEAL, i: 2.4, breathe: 0.5 });
  }
  lamps.push({ p: V(0, -246, -2), r: 2.2, color: LAMP.GREEN, i: 3.2, breathe: 0.8 });   // lidar
  for (const [x, z] of [[-48, -48], [48, -48], [-48, 48], [48, 48]]) lamps.push({ p: V(x, -230, z), r: 1, color: LAMP.AMBER, i: 2 });
  // crew stack: four modules round the spine, a node on top and a ram-face dock
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + TAU / 8, x = Math.cos(a) * 24, z = Math.sin(a) * 24;
    B.push(tr(x, -150, z).multiply(toY)); habModule(B, 11, 90, { glass: 4 }); B.pop();
    B.tube([V(x * 0.25, -110, z * 0.25), V(x * 0.62, -110, z * 0.62)], 3, 8, CK.HULL);
    for (let j = 0; j < 4; j++) lamps.push({ p: V(x * 1.48, -140 + j * 20, z * 1.48), r: 0.6, color: WARM, i: 1.6 });
  }
  B.push(tr(0, -58, 0)); sphereZ(B, 14, (u) => (u > 0.4 && u < 0.6 ? CK.GLASS : CK.HULL), 24, 12); B.pop();
  dockPort(B, lamps, ports, V(0, -58, 13), V(0, 0, 1), 14, 3.6);
  dockPort(B, lamps, ports, V(0, -58, -13), V(0, 0, -1), 14, 3.6);
  // radiators on the spine (along track)
  for (const s of [-1, 1]) radiatorWing(B, V(0, 120, s * 5), V(0, 0, s), V(1, 0, 0), 110, 40, lamps, s > 0 ? LAMP.GREEN : LAMP.RED);
  // bearing collar of the centrifuge on the spine
  latheAt(B, tr(0, POLAR.ringY, 0).multiply(toY), [[7.5, -6, CK.BRONZE], [12, -6, CK.BRONZE], [12, 6, CK.DARK], [7.5, 6, CK.DARK]], 32, true);
  // zenith: comms mast and dock
  const tip = mast(B, V(0, 262, 0), V(0, 1, 0), 40, 0.5);
  lamps.push({ p: tip, r: 2, color: LAMP.RED, i: 3.6, breathe: 0.7 });
  dish(B, V(8, 258, 0), V(1, 1, 0).normalize(), 6);
  catwalk(B, V(5.6, -220, 5.6), V(5.6, 250, 5.6), V(1, 0, 1).normalize(), 1.2, 1.1);
  // the pressurised tunnel inside the spine truss, node to zenith through the centrifuge's
  // bearing, ringed every 18 m; a lit coolant conduit and a power bus down the truss faces
  // (the pieces of the station read as one body instead of a stack of separate parts)
  for (const [y0, y1] of [[-44, POLAR.ringY - 7], [POLAR.ringY + 7, 250]]) {
    B.tube([V(0, y0, 0), V(0, y1, 0)], 3.2, 14, CK.HULL);
    for (let y = y0 + 9; y < y1 - 4; y += 18) { B.push(tr(0, y, 0).multiply(toY)); B.torus(3.4, 0.35, 16, 4, CK.BRONZE); B.pop(); }
  }
  B.tube([V(-5.9, -224, 0), V(-5.9, 256, 0)], 0.8, 6, CK.CONDUIT);
  B.tube([V(0, -224, -5.9), V(0, 256, -5.9)], 0.6, 6, CK.BRONZE);
  // a baffle ring over the nadir deck: it shades the instruments' optics from the Earth's limb glare
  B.push(tr(0, -224, 0).multiply(toY));
  B.lathe([[52, 0, CK.DARK], [66, 6, CK.HULL], [66, 9, CK.BRONZE], [52, 3, CK.HULL], [52, 0, CK.DARK]], 48, Math.PI / 48);
  B.pop();
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; B.tube([V(Math.cos(a) * 40, -228, Math.sin(a) * 40), V(Math.cos(a) * 60, -221.6, Math.sin(a) * 60)], 0.6, 4, CK.DARK); }
  // the centrifuge (spins about y): a glazed torus on four spokes
  Rg.push(tr(0, POLAR.ringY, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  Rg.torus(POLAR.ringR, POLAR.ringTube, 96, 14, CK.GLASS);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    atAim(Rg, V(Math.cos(a) * POLAR.ringR, Math.sin(a) * POLAR.ringR, 0), V(-Math.sin(a), Math.cos(a), 0));
    Rg.lathe([[POLAR.ringTube, -0.8, CK.BRONZE], [POLAR.ringTube + 0.9, -0.5, CK.BRONZE], [POLAR.ringTube + 0.9, 0.5, CK.BRONZE], [POLAR.ringTube, 0.8, CK.BRONZE]], 16, 0, { closedProfile: true });
    Rg.pop();
    ringLamps.push({ p: V(Math.cos(a) * (POLAR.ringR + POLAR.ringTube + 1), POLAR.ringY, -Math.sin(a) * (POLAR.ringR + POLAR.ringTube + 1)), r: 0.8, color: k % 3 ? LAMP.AMBER : WARM, i: 1.9 });
  }
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; Rg.tube([V(Math.cos(a) * 14, Math.sin(a) * 14, 0), V(Math.cos(a) * (POLAR.ringR - POLAR.ringTube + 1), Math.sin(a) * (POLAR.ringR - POLAR.ringTube + 1), 0)], 2.2, 8, CK.HULL); }
  Rg.lathe([[14, -5, CK.HULL], [16, -4, CK.BRONZE], [16, 4, CK.BRONZE], [14, 5, CK.HULL]], 32, 0, { closedProfile: true });
  Rg.pop();
  // the wings (turn about x on a gimbal at POLAR.wingY to hold on the Sun)
  solarWing(Wg, wingLamps, 1, 20, 160, 52, 4, 0);
  solarWing(Wg, wingLamps, -1, 20, 160, 52, 4, 0);
  Wg.tube([V(-20, 0, 0), V(20, 0, 0)], 4, 12, CK.BRONZE);
  return { body: B.geometry(), ring: Rg.geometry(), wings: Wg.geometry(), lamps, ringLamps, wingLamps, ports };
}

// -------------------------------------------------------------- power ----
export const POWER = { half: 950, height: 360, pivotZ: -300, disc: 120, discOff: 64, tramY: 12, tramZ: -16.5 };
export const EMITTER_HEX = { r: 4.6, pitch: 9, tiles: 0 };   // tile circumradius, centre spacing (m)

/** The Dawnline inspection tram (+x along the rail), 14 m. */
export function buildTram() {
  const B = new CB();
  B.box(0, 0, 0, 14, 3.6, 3.2, CK.HULL);
  B.box(0, 0.6, 1.62, 12, 1.4, 0.1, CK.GLASS);
  B.box(0, 0.6, -1.62, 12, 1.4, 0.1, CK.GLASS);
  for (const x of [-5, 5]) B.box(x, 2.1, 1.0, 2.4, 0.8, 1.6, CK.BRONZE);
  B.box(7.1, 0, 0, 0.3, 3, 2.6, CK.LANTERN);
  B.box(-7.1, 0, 0, 0.3, 3, 2.6, CK.DARK);
  return B.geometry();
}

/** Solar-inertial power station (+z to the Sun): the array, hub, radiators, emitter mast. */
export function buildPower() {
  const B = new CB(), E = new CB(), lamps = [], emitterLamps = [], ports = [];
  const { half, height: h } = POWER;
  truss(B, V(-half - 10, 0, -6), V(half + 10, 0, -6), 14, 28, 0.6, CK.DARK);
  const n = 26, w = (2 * half) / n;
  for (let i = 0; i < n; i++) {
    const cx = -half + (i + 0.5) * w;
    if (Math.abs(cx) < w) continue;                                  // the hub bay
    for (const s of [-1, 1]) {
      B.box(cx, s * (h / 4 + 6), 0, w * 0.95, h / 2 - 12, 0.5, CK.PANEL);
      B.box(cx, s * (h / 2), -1, w, 2, 2, CK.DARK);
    }
    B.box(cx - w / 2, 0, -1, 1.4, h + 2, 1.4, CK.BRONZE);
    if (i % 4 === 0) for (const s of [-1, 1]) lamps.push({ p: V(cx - w / 2, s * (h / 2 + 2), 0.6), r: 1.6, color: LAMP.AMBER, i: 2.2, breathe: 0.3, phase: i / n });
  }
  for (const s of [-1, 1]) {
    lamps.push({ p: V(s * (half + 14), 0, 0), r: 2.4, color: s > 0 ? LAMP.GREEN : LAMP.RED, i: 3.4 });
    lamps.push({ p: V(s * (half + 14), 0, -8), r: 2.2, color: LAMP.WHITE, i: 3.2, breathe: 0.8, phase: s > 0 ? 0 : 0.5 });
    // catenary stays from the hub mast tips to the wing ends
    B.tube([V(0, s * 90, -40), V(s * half * 0.5, s * (h / 2), -2)], 0.5, 4, CK.DARK);
    B.tube([V(0, s * 90, -40), V(-s * half * 0.5, s * (h / 2), -2)], 0.5, 4, CK.DARK);
  }
  // the back frame that makes the blanket a structure: edge longerons, a rib truss at every
  // fourth bay, king posts behind the spine with stays to the longerons (a deep, stiff
  // tension frame), and radiator fins standing edge-on to the Sun behind the spine
  for (const s of [-1, 1]) truss(B, V(-half - 4, s * (h / 2 + 3), -7), V(half + 4, s * (h / 2 + 3), -7), 6, 18, 0.3, CK.DARK);
  for (let i = 0; i <= n; i += 4) {
    const x = -half + i * w;
    truss(B, V(x, -h / 2, -7), V(x, h / 2, -7), 5, 15, 0.25, CK.DARK);
    if (i % 8 === 4 && Math.abs(x) > 200) {
      B.tube([V(x, 0, -13), V(x, 0, -62)], 1.2, 6, CK.BRONZE);
      for (const s of [-1, 1]) {
        B.tube([V(x, 0, -62), V(x, s * (h / 2 + 3), -10)], 0.4, 4, CK.DARK);
        B.tube([V(x, 0, -62), V(x + s * w * 4, 0, -13)], 0.4, 4, CK.DARK);
      }
      lamps.push({ p: V(x, 0, -64), r: 1.4, color: LAMP.AMBER, i: 2.2, breathe: 0.4, phase: i / n });
    }
    if (i % 8 === 0 && Math.abs(x + w * 2) > 330) for (const sy of [-1, 1]) {
      B.box(x + w * 2, sy * h / 4, -38, w * 2.4, 0.6, 46, CK.RADIATOR);
      B.box(x + w * 2, sy * h / 4, -14.5, w * 2.5, 1.8, 2, CK.BRONZE);
    }
  }
  // the blankets' tensioning booms at both wing tips, with their reels
  for (const s of [-1, 1]) {
    B.box(s * (half + 6), 0, -3, 4, h + 10, 4, CK.BRONZE);
    for (const sy of [-1, 1]) { B.push(tr(s * (half + 6), sy * (h / 2 + 5), -3).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))); B.lathe([[3.5, -3, CK.DARK], [3.5, 3, CK.DARK]], 16); B.pop(); }
  }
  // the hub behind the array: crew drum, docks, mast to the emitter gimbal
  B.push(tr(0, 0, -20).multiply(new THREE.Matrix4().makeRotationX(Math.PI)));
  habModule(B, 26, 80, { glass: 3, seg: 36 });
  B.pop();
  B.tube([V(0, -90, -40), V(0, 90, -40)], 3, 10, CK.BRONZE);
  B.tube([V(0, 0, -22), V(0, 0, -5)], 9, 16, CK.HULL);
  for (const s of [-1, 1]) dockPort(B, lamps, ports, V(0, s * 25, -60), V(0, s, 0), 16, 4.2);
  for (const s of [-1, 1]) radiatorWing(B, V(s * 26, 0, -60), V(s, 0, 0), V(0, 1, 0), 130, 44, lamps, LAMP.AMBER);
  truss(B, V(0, 0, -100), V(0, 0, POWER.pivotZ + 6), 8, 12, 0.4, CK.DARK);
  // the tram rail along the spine's back, on posts, with a lit stop at the hub
  B.box(0, POWER.tramY, POWER.tramZ + 2.3, 2 * half, 1, 1, CK.BRONZE);
  for (let x = -half; x <= half; x += 60) B.box(x, (POWER.tramY + 7) / 2, POWER.tramZ + 2.5, 0.8, POWER.tramY - 7, 0.8, CK.DARK);
  B.box(0, POWER.tramY - 1, POWER.tramZ - 3, 30, 0.6, 5, CK.DECK);
  lamps.push({ p: V(-15, POWER.tramY - 0.4, POWER.tramZ - 3), r: 0.9, color: WARM, i: 2 }, { p: V(15, POWER.tramY - 0.4, POWER.tramZ - 3), r: 0.9, color: WARM, i: 2 });
  latheAt(B, tr(0, 0, POWER.pivotZ), [[0.02, -2, CK.DARK], [9, 0, CK.BRONZE], [10, 6, CK.BRONZE], [0.02, 8, CK.DARK]], 24);
  for (let i = 0; i < 6; i++) lamps.push({ p: V(26.8 * Math.cos(i), 26.8 * Math.sin(i), -30 - i * 7), r: 0.7, color: WARM, i: 1.6 });
  // the emitter (+z toward the ground station): a phased array of hexagonal tiles on a yoke
  const { disc: R, discOff: d } = POWER;
  E.tube([V(0, 0, 0), V(0, 0, d - 6)], 3.2, 12, CK.BRONZE);
  E.lathe([[0.02, d - 8, CK.HULL], [R * 0.2, d - 6, CK.HULL], [R, d - 1, CK.BRONZE], [R + 1, d, CK.BRONZE], [R, d + 1.6, CK.DARK], [0.02, d + 1.6, CK.DARK]], 64);
  // the aperture: hexagonal radiating tiles close-packed on a hex grid (8 m across the flats,
  // 1 m gaps), every seventh a darker phase-reference tile, sub-array frames in rings
  const hexR = EMITTER_HEX.r, pitch = EMITTER_HEX.pitch;
  let tiles = 0;
  for (let q = -12; q <= 12; q++) for (let r = -12; r <= 12; r++) {
    const x = pitch * (q + r / 2), y = pitch * r * Math.sqrt(3) / 2;
    if (Math.hypot(x, y) > R - hexR - 2) continue;
    const ref = ((q - r) % 7 + 7) % 7 === 0;
    E.push(tr(x, y, d + 1.6));
    E.lathe([[0.02, 0, CK.DARK], [hexR, 0, CK.DARK], [hexR, ref ? 0.8 : 1.4, ref ? CK.DARK : CK.PANEL], [0.02, ref ? 0.8 : 1.4, CK.PANEL]], 6, Math.PI / 6);
    E.pop();
    tiles++;
  }
  EMITTER_HEX.tiles = tiles;
  for (let ring = 2; ring < 6; ring += 1) { const rr = (ring / 6) * R; E.push(tr(0, 0, d + 3.2)); E.torus(rr, 0.45, 96, 4, CK.BRONZE); E.pop(); }
  for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; E.tube([V(0, 0, 4), V(Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95, d - 2)], 0.7, 4, CK.DARK); }
  for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; emitterLamps.push({ p: V(Math.cos(a) * (R + 2), Math.sin(a) * (R + 2), d + 1), r: 1.6, color: LAMP.RED, i: 2.6, breathe: 0.5, phase: k / 24 }); }
  emitterLamps.push({ p: V(0, 0, d + 3.4), r: 3.2, color: [1.0, 0.45, 0.25], i: 2.4, breathe: 0.4 });
  return { body: B.geometry(), emitter: E.geometry(), lamps, emitterLamps, ports };
}

// ------------------------------------------------------------ skyhook ----
export const SKYHOOK = { halfKm: 450, hubR: 44 };

/** The rotovator's hub (tether along +-y): ballast drum, spools, a crew ring, wings in x. */
export function buildSkyhookHub() {
  const B = new CB(), lamps = [];
  B.push(toY);
  B.lathe([[0.02, -70, CK.DARK], [30, -66, CK.BRONZE], [SKYHOOK.hubR, -54, CK.HULL], [SKYHOOK.hubR, -20, CK.DARK], [SKYHOOK.hubR + 1, -18, CK.BRONZE], [SKYHOOK.hubR + 1, 18, CK.BRONZE],
    [SKYHOOK.hubR, 20, CK.DARK], [SKYHOOK.hubR, 54, CK.HULL], [30, 66, CK.BRONZE], [0.02, 70, CK.DARK]], 48);
  B.pop();
  for (const s of [-1, 1]) {
    // spool housings and fairleads where the tether leaves each end
    latheAt(B, tr(0, s * 70, 0).multiply(toY), [[0.02, 0, CK.DARK], [26, s * 2, CK.HULL], [28, s * 10, CK.CONDUIT], [28, s * 26, CK.HULL], [16, s * 34, CK.BRONZE], [6, s * 60, CK.BRONZE], [0.02, s * 64, CK.DARK]], 36);
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; B.tube([V(Math.cos(a) * 26, s * 72, Math.sin(a) * 26), V(Math.cos(a) * 5, s * 128, Math.sin(a) * 5)], 1.1, 6, CK.DARK); }
    lamps.push({ p: V(0, s * 136, 0), r: 2.2, color: LAMP.AMBER, i: 3.2, breathe: 0.6, phase: s > 0 ? 0 : 0.5 });
    solarWing(B, lamps, s, SKYHOOK.hubR + 6, 150, 50, 4, 0);
    radiatorWing(B, V(0, 0, s * SKYHOOK.hubR), V(0, 0, s), V(0, 1, 0), 90, 30, lamps, s > 0 ? LAMP.GREEN : LAMP.RED);
  }
  // the drum's structure: sixteen longerons carrying the tether load from spool to spool past
  // the bearing band, hoop frames between them, and a lit tension gauge band at each shoulder
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU, c = Math.cos(a), sn = Math.sin(a), r0 = SKYHOOK.hubR + 1.6;
    for (const s of [-1, 1]) B.box(c * r0, s * 37, sn * r0, 2.4, 34, 2.4, CK.BRONZE);
    B.tube([V(c * 30, -66, sn * 30), V(c * r0, -54, sn * r0)], 1.0, 4, CK.BRONZE);
    B.tube([V(c * 30, 66, sn * 30), V(c * r0, 54, sn * r0)], 1.0, 4, CK.BRONZE);
  }
  for (const y of [-46, -30, 30, 46]) { B.push(tr(0, y, 0).multiply(toY)); B.torus(SKYHOOK.hubR + 1.2, 1.1, 64, 4, CK.DARK); B.pop(); }
  for (const s of [-1, 1]) { B.push(tr(0, s * 56, 0).multiply(toY)); B.torus(SKYHOOK.hubR - 1, 1.4, 64, 6, CK.CONDUIT); B.pop(); }
  B.push(tr(0, 34, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  B.torus(SKYHOOK.hubR + 14, 6, 96, 12, CK.GLASS);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.3; B.tube([V(Math.cos(a) * SKYHOOK.hubR, Math.sin(a) * SKYHOOK.hubR, 0), V(Math.cos(a) * (SKYHOOK.hubR + 8), Math.sin(a) * (SKYHOOK.hubR + 8), 0)], 2, 8, CK.HULL); }
  B.pop();
  for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; lamps.push({ p: V(Math.cos(a) * (SKYHOOK.hubR + 20.6), 34, Math.sin(a) * (SKYHOOK.hubR + 20.6)), r: 0.9, color: WARM, i: 1.8 }); }
  return { geo: B.geometry(), lamps, radius: 0.2 };
}

/**
 * A grapple station at a tether tip. Local +y points up the tether toward the hub; the tip feels
 * ~2.3 g toward -y. The grapple cradle hangs at -y with three jaws round a catch pin socket.
 */
export function buildGrapple() {
  const B = new CB(), lamps = [];
  // tether stub and fairlead
  B.push(toY);
  B.lathe([[0.02, 150, CK.DARK], [2.2, 150, CK.DARK], [2.6, 60, CK.DARK], [9, 40, CK.BRONZE], [16, 30, CK.HULL], [16, 26, CK.CONDUIT], [18, 18, CK.HULL], [18, 16, CK.BRONZE], [0.02, 14, CK.HULL]], 28);
  // crew cab: decks under the fairlead, windows all round
  B.lathe([[0.02, 14, CK.HULL], [15, 13, CK.HULL], [15.4, 10, CK.BRONZE], [15.4, 8, CK.GLASS], [15.4, -6, CK.GLASS], [15.4, -8, CK.BRONZE], [15.4, -10, CK.GLASS], [15.4, -22, CK.GLASS], [15, -24, CK.BRONZE], [12, -30, CK.HULL], [0.02, -32, CK.DARK]], 36);
  B.pop();
  // the cradle ring and jaws
  B.push(tr(0, -46, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  B.torus(26, 2.2, 72, 8, CK.BRONZE);
  B.pop();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU, c = Math.cos(a), s = Math.sin(a);
    B.tube([V(c * 10, -30, s * 10), V(c * 26, -46, s * 26)], 1.6, 8, CK.HULL);
    B.tube([V(c * 26, -46, s * 26), V(c * 16, -62, s * 16), V(c * 8, -66, s * 8)], 1.4, 8, CK.BRONZE);
    B.box(c * 8, -66, s * 8, 3, 3, 3, CK.DARK);
    lamps.push({ p: V(c * 27.5, -46, s * 27.5), r: 1.2, color: LAMP.AMBER, i: 3, breathe: 0.5, phase: k / 3 });
  }
  for (const d of [V(0, -1, 0.2), V(0.2, -1, 0), V(-0.2, -1, -0.1)]) lamps.push(flood(B, V(d.x * 40, -32, d.z * 40), d.clone().normalize(), 1.6, LAMP.WHITE, 3.4));
  // side galleries and thrusters that trim the tip's swing
  for (const s of [-1, 1]) {
    B.box(s * 21, -4, 0, 12, 8, 26, CK.HULL);
    B.box(s * 27.2, -4, 0, 0.6, 5, 22, CK.GLASS);
    rcsQuad(B, V(s * 27.5, -4, 12), V(s, 0, 0), V(0, 1, 0), 2.2);
    rcsQuad(B, V(s * 27.5, -4, -12), V(s, 0, 0), V(0, 1, 0), 2.2);
    lamps.push({ p: V(s * 28, 4, 0), r: 1.4, color: s > 0 ? LAMP.GREEN : LAMP.RED, i: 3.2 });
  }
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; lamps.push({ p: V(Math.cos(a) * 16.1, -4, Math.sin(a) * 16.1), r: 0.55, color: WARM, i: 1.6 }); }
  lamps.push({ p: V(0, 152, 0), r: 1.6, color: LAMP.RED, i: 3.4, breathe: 0.7 });
  return { geo: B.geometry(), lamps, catchPoint: V(0, -66, 0) };
}

// ------------------------------------------------------------ sweeper ----
/** Debris sweeper (+z forward): net ring, ablation turret, hopper bins, drive. */
export function buildSweeper() {
  const B = new CB(), lamps = [], glows = [];
  truss(B, V(0, 0, -90), V(0, 0, 96), 7, 8, 0.3, CK.DARK);
  // drive block and bells
  B.push(tr(0, 0, -96));
  B.lathe([[0.02, -8, CK.DARK], [10, -6, CK.HULL], [11, 0, CK.BRONZE], [11, 16, CK.HULL], [9, 22, CK.DARK], [0.02, 24, CK.HULL]], 24);
  B.pop();
  for (const [x, y] of [[-6, 0], [6, 0], [0, 6]]) bell(B, x, y, -103, 2.6, 7, glows);
  // hopper bins either side
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
    const z = -60 + i * 26;
    B.box(s * 8.4, 0, z, 10, 10, 22, i % 2 ? CK.HULL : CK.BRONZE);
    B.box(s * 13.6, 0, z, 0.4, 7, 18, CK.DARK);
    B.box(s * 8.4, 5.3, z, 9, 0.6, 20, CK.DECK);
  }
  // crew module and bridge
  B.push(tr(0, 9, 30)); habModule(B, 5.5, 30, { glass: 2, seg: 18 }); B.pop();
  B.box(0, 9, 62, 8, 5, 6, CK.GLASS);
  // ablation laser turret on the dorsal: a barrel looking forward and out
  B.push(tr(0, 16, 50).multiply(new THREE.Matrix4().makeRotationX(-0.25)));
  B.lathe([[3.5, -6, CK.DARK], [4, -4, CK.BRONZE], [2.4, 0, CK.HULL], [2.2, 20, CK.HULL], [2.8, 22, CK.BRONZE], [1.6, 23, CK.LANTERN], [0.02, 23.5, CK.LANTERN]], 16);
  lamps.push({ p: here(B, 0, 0, 24), r: 1.2, color: [0.6, 0.85, 1.0], i: 3.2, breathe: 0.8 });
  B.pop();
  // capture net forward: rim torus, struts, a lattice across the mouth
  const Rn = 64;
  B.push(tr(0, 0, 150));
  B.torus(Rn, 1.6, 96, 8, CK.BRONZE);
  for (let k = -5; k <= 5; k++) {
    const x = (k / 6) * Rn, hh = Math.sqrt(Math.max(Rn * Rn - x * x, 0));
    B.tube([V(x, -hh, 0), V(x, 0, -10), V(x, hh, 0)], 0.25, 3, CK.DARK);
    B.tube([V(-hh, x, 0), V(0, x, -10), V(hh, x, 0)], 0.25, 3, CK.DARK);
  }
  B.pop();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    B.tube([V(Math.cos(a) * 3.5, Math.sin(a) * 3.5, 94), V(Math.cos(a) * Rn, Math.sin(a) * Rn, 150)], 0.7, 5, CK.HULL);
    lamps.push({ p: V(Math.cos(a) * (Rn + 2), Math.sin(a) * (Rn + 2), 150), r: 1.2, color: k % 2 ? LAMP.AMBER : LAMP.WHITE, i: 2.8, breathe: 0.5, phase: k / 8 });
  }
  for (const s of [-1, 1]) solarWing(B, lamps, s, 16, 70, 18, 3, -30);
  lamps.push({ p: V(0, 0, -112), r: 1.4, color: LAMP.WHITE, i: 2.4 });
  return { geo: B.geometry(), lamps, glows, net: V(0, 0, 150), netR: Rn };
}

/** Irregular tumbling fragment (a crushed panel or bus), ~1 m: instanced in front of the nets. */
export function buildDebrisChunk() {
  const B = new CB();
  B.box(0, 0, 0, 1.2, 0.4, 0.9, CK.DARK);
  B.push(new THREE.Matrix4().makeRotationY(0.7).multiply(new THREE.Matrix4().makeRotationZ(0.4)));
  B.box(0.4, 0.2, 0, 1.4, 0.08, 0.7, CK.PANEL);
  B.pop();
  B.box(-0.3, -0.25, 0.2, 0.3, 0.5, 0.3, CK.BRONZE);
  return B.geometry();
}

// --------------------------------------------------------- satellites ----
/** Constellation satellites (+z along track, +y zenith), a few metres: [comms, science, beacon]. */
export function buildSatellites() {
  const out = [];
  {
    // comms: a flat bus with one long wing and a phased panel facing down
    const B = new CB();
    B.box(0, 0, 0, 3.2, 0.5, 1.6, CK.HULL);
    B.box(0, -0.3, 0, 2.8, 0.1, 1.3, CK.DARK);
    B.tube([V(0, 0.3, 0), V(0, 1.2, 0)], 0.08, 4, CK.BRONZE);
    for (let j = 0; j < 4; j++) B.box(0, 1.25, 1.2 + j * 2.1, 2.6, 0.06, 2.0, CK.PANEL);
    B.box(0, 1.25, 5.3, 0.1, 0.1, 8.4, CK.DARK);
    out.push({ geo: B.geometry(), r: 5 });
  }
  {
    // science: a hexagonal bus, a dish, two wings
    const B = new CB();
    B.lathe([[0.02, -1.4, CK.DARK], [1.1, -1.4, CK.BRONZE], [1.1, 1.4, CK.HULL], [0.02, 1.4, CK.HULL]], 6);
    dish(B, V(0, -1.6, 0), V(0, -1, 0), 1.2);
    for (const s of [-1, 1]) { B.tube([V(s * 1.1, 0, 0), V(s * 1.8, 0, 0)], 0.06, 4, CK.DARK); B.box(s * 3.6, 0, 0, 3.6, 0.05, 1.6, CK.PANEL); }
    out.push({ geo: B.geometry(), r: 5.5 });
  }
  {
    // beacon / navigation: a cube bus, two wings, a helix array
    const B = new CB();
    B.box(0, 0, 0, 1.8, 1.8, 1.8, CK.BRONZE);
    B.box(0, 0, 0, 1.9, 0.3, 1.9, CK.DARK);
    for (const s of [-1, 1]) { B.tube([V(s * 0.9, 0, 0), V(s * 1.6, 0, 0)], 0.06, 4, CK.DARK); B.box(s * 4.2, 0, 0, 5, 0.05, 1.8, CK.PANEL); }
    B.tube([V(0, -0.9, 0), V(0, -2.2, 0)], 0.35, 8, CK.HULL);
    out.push({ geo: B.geometry(), r: 7 });
  }
  return out;
}
