import * as THREE from 'three';
import { CB, CK, sectionEllipse } from '../craft/craftGeometry.js';
import { buildShuttle, buildTug, lathe } from '../craft/craftClasses.js';
import { createCraftMaterial, updateCraftMaterial } from '../craft/craftMaterial.js';
import { craftMesh, addEngines, addLamps, placeMerge, placeLamps, KM, CRAFT_FRAME } from './craftMesh.js';
import { createLamps, LAMP } from './lamps.js';

// THE HELIANTH DISTRICT (metres, the collector's frame: +Y away from the Sun, the twelve petals
// near y = 0 reaching 14.5 km out, the hub and its crown above them).
//
//   petals    every petal carries a crawler catwalk along its spine (deck, railings and stanchions
//             every 50 m), two coolant lines on its mirror skin, six thermal receiver cassettes
//             glowing with the heat they drink, a tip mast, and lamp strings down both edges.
//             Built once and instanced twelve times (one InstancedMesh per piece)
//   crawlers  two maintenance crawlers per petal run the catwalk, pausing at the receivers; the
//             suited crews walk the decks with helmet lamps (moving lamps, no allocation)
//   berths    six docking arms off the hub below the habitat wheel, a shuttle seated on each
//             cradle (seated by its surveyed lowest point)
//   flotilla  the Helianth's own neighbourhood of the swarm (km): forty-eight concentrator
//             statites and relay platforms hovering 60-400 km round the station, every one
//             turned to the Sun and slewing slowly, and couriers working between them
//
// Heavy geometry is built lazily on first approach (build()), spread across frames; beyond
// range the district and the flotilla are hidden. The verifier (tools/verify-sun.mjs) builds
// everything synchronously and checks seating, clearances and the traffic.

const V = (x, y, z) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2;
const TO_Y = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------ petal survey ----
// (the petal lofts and spines of buildSolarCollector, reproduced analytically)
export const PETAL = { inner: 1550, outer: 14500, spineR: 55, spine0: 1500, spineL: 13000, count: 12 };
const petalT = (z) => (z - PETAL.inner) / (PETAL.outer - PETAL.inner);
export const petalY = (z) => 420 * Math.sin(Math.PI * THREE.MathUtils.clamp(petalT(z), 0, 1));
export const petalW = (z) => 100 + 1450 * Math.pow(Math.sin(Math.PI * THREE.MathUtils.clamp(petalT(z), 0, 1)), 0.8);
export const spineY = (z) => 460 * Math.sin(Math.PI * THREE.MathUtils.clamp((z - PETAL.spine0) / PETAL.spineL, 0, 1)) + 80;
export const spineSlope = (z) => 460 * Math.PI / PETAL.spineL * Math.cos(Math.PI * THREE.MathUtils.clamp((z - PETAL.spine0) / PETAL.spineL, 0, 1));
const SECTION = sectionEllipse(1, 35, 12, 3);        // unit half-width, true thickness
/** Height of the petal's upper skin at lateral x (the faceted section's chord, exactly). */
export function petalTop(x, z) {
  const w = petalW(z), u = Math.abs(x) / w;
  // upper chain of the 12-gon: vertices 0..6 run from +x over the top to -x
  const up = SECTION.slice(0, 7).map(([px, py]) => [Math.abs(px), py]).sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < up.length - 1; i++) if (u <= up[i + 1][0] + 1e-9) {
    const [x0, y0] = up[i], [x1, y1] = up[i + 1], t = (u - x0) / Math.max(x1 - x0, 1e-9);
    return petalY(z) + y0 + (y1 - y0) * t;
  }
  return petalY(z);
}
/** Petal k's frame: local +Z along the petal (makeRotationY(k/12 turn), as the station builds it). */
export const petalMatrix = (k, out = new THREE.Matrix4()) => out.makeRotationY((k / PETAL.count) * TAU);

export const CATWALK = { z0: 1750, z1: 14200, half: 7, deck: 2, rail: 1.1 };
export const DECK_TOP = (z) => spineY(z) + PETAL.spineR - 1 + CATWALK.deck;   // (deck seated 1 m into the spine)
export const RECEIVERS = [0.2, 0.32, 0.44, 0.56, 0.68, 0.8];

/** One petal's fittings (petal-local metres). Returns the geometry and its lamps. */
export function buildPetalFittings() {
  const B = new CB(), lamps = [], receivers = [];
  // catwalk: sloped deck segments following the spine, railings and stanchions
  const N = 64, dz = (CATWALK.z1 - CATWALK.z0) / N;
  for (let j = 0; j < N; j++) {
    const z = CATWALK.z0 + (j + 0.5) * dz, s = spineSlope(z), len = dz * Math.hypot(1, s) + 1.5;
    B.at(0, DECK_TOP(z) - CATWALK.deck / 2, z, -Math.atan(s));
    B.box(0, 0, 0, CATWALK.half * 2, CATWALK.deck, len, CK.DECK);
    // side kerbs: a bronze toe-board each side
    for (const sd of [-1, 1]) B.box(sd * (CATWALK.half - 0.25), CATWALK.deck / 2 + 0.2, 0, 0.5, 0.4, len, CK.BRONZE);
    B.pop();
  }
  for (const sd of [-1, 1]) {
    const rail = [];
    for (let j = 0; j <= N; j++) { const z = CATWALK.z0 + j * dz; rail.push(V(sd * (CATWALK.half - 0.3), DECK_TOP(z) + CATWALK.rail, z)); }
    B.tube(rail, 0.12, 4, CK.BRONZE);
    const mid = rail.map((p) => p.clone().setY(p.y - CATWALK.rail * 0.5));
    B.tube(mid, 0.08, 4, CK.HULL);
    for (let z = CATWALK.z0 + 25; z < CATWALK.z1; z += 50) B.box(sd * (CATWALK.half - 0.3), DECK_TOP(z) + CATWALK.rail / 2, z, 0.18, CATWALK.rail + 0.3, 0.18, CK.HULL);
  }
  // coolant lines on the skin, seated two metres into the faceted surface, glowing with flow
  for (const sd of [-1, 1]) {
    const pts = [];
    for (let z = 1650; z <= 14400; z += 250) {
      const w = petalW(z), x = sd * (70 + 0.25 * (w - 100));
      pts.push(V(x, petalTop(x, z) + 12 - 2, z));
    }
    B.tube(pts, 12, 8, CK.CONDUIT);
    // pipe saddles every 750 m
    for (let z = 2000; z < 14200; z += 750) {
      const w = petalW(z), x = sd * (70 + 0.25 * (w - 100));
      B.box(x, petalTop(x, z) + 6, z, 34, 14, 10, CK.BRONZE);
    }
  }
  // thermal receiver cassettes: dark housings astride the petal skin, their apertures glowing
  for (const t of RECEIVERS) for (const sd of [-1, 1]) {
    const z = PETAL.inner + t * (PETAL.outer - PETAL.inner), w = petalW(z), x = sd * w * 0.55;
    const y0 = Math.max(petalTop(x - 40, z), petalTop(x + 40, z), petalTop(x, z - 55), petalTop(x, z + 55)) - 3;
    B.box(x, y0 + 16, z, 80, 32, 110, CK.DARK);
    B.box(x, y0 + 33, z, 64, 4, 90, CK.LANTERN);                       // the hot aperture
    B.box(x, y0 + 26, z + 56, 50, 10, 3, CK.GLASS);                    // inspection ports
    for (const dx of [-38, 38]) B.box(x + dx, y0 + 20, z, 6, 30, 118, CK.BRONZE);
    receivers.push({ x, z, top: y0 + 35, base: y0 });
    lamps.push({ p: V(x, y0 + 38, z), r: 6, color: LAMP.AMBER, i: 1.4, breathe: 0.5, phase: t + (sd > 0 ? 0.5 : 0) });
  }
  // the tip mast: a lattice post with a lamp head (the tip lamp itself is the station's)
  {
    const z = 14300, y = spineY(z) + PETAL.spineR - 4;
    for (const [dx, dz] of [[-6, -6], [6, -6], [6, 6], [-6, 6]]) B.tube([V(dx, y, z + dz), V(dx * 0.4, y + 140, z + dz * 0.4)], 1.4, 5, CK.HULL);
    B.box(0, y + 146, z, 14, 12, 14, CK.BRONZE);
    B.box(0, y + 156, z, 8, 8, 8, CK.LANTERN);
    lamps.push({ p: V(0, y + 166, z), r: 7, color: LAMP.WHITE, i: 2.2, breathe: 0.3 });
  }
  // edge lamp strings
  for (let j = 1; j < 16; j++) {
    const z = PETAL.inner + (j / 16) * (PETAL.outer - PETAL.inner);
    for (const sd of [-1, 1]) lamps.push({ p: V(sd * (petalW(z) + 6), petalY(z), z), r: 4, color: j % 4 === 0 ? LAMP.WHITE : LAMP.AMBER, i: 1.2 });
  }
  return { geo: B.geometry(), lamps, receivers };
}

/** A maintenance crawler (metres, its deck contact at y = 0, facing +z). */
export function buildCrawler() {
  const B = new CB();
  for (const sd of [-1, 1]) for (const z of [-5, 5]) B.tube([V(sd * 2.6, 1.6, z), V(sd * 4, 1.6, z)], 1.6, 10, CK.DARK);
  B.box(0, 4.4, 0, 5.4, 3.6, 15, CK.HULL);
  B.box(0, 6.6, -1, 5, 0.8, 12, CK.BRONZE);
  B.box(0, 8.2, 4.8, 4.4, 2.6, 4, CK.GLASS);
  B.box(0, 5, 7.7, 4, 1.2, 0.6, CK.LANTERN);
  B.tube([V(0, 6.8, -4), V(0, 14, -8), V(0, 11.5, -14)], 0.6, 6, CK.BRONZE);
  B.box(0, 11, -14.6, 2.6, 2, 2.2, CK.DARK);
  return B.geometry();
}

/** Crawler pose on its catwalk: z along the petal, pausing at each receiver station. */
export function crawlerZ(t, i) {
  const stops = RECEIVERS.map((r) => PETAL.inner + r * (PETAL.outer - PETAL.inner));
  const legs = stops.length - 1, T = 900, u = (((t / T + i * 0.37) % 1) + 1) % 1;
  // out along the stations and back: a ping-pong over legs, dwelling 40 % of each leg
  const x = u < 0.5 ? u * 2 * legs : (1 - u) * 2 * legs;
  const k = Math.min(Math.floor(x), legs - 1), f = x - k;
  return stops[k] + (stops[k + 1] - stops[k]) * smooth(0.2, 0.8, f);
}

/** +1 while the crawler runs outward, -1 homeward. */
export function crawlerDir(t, i) { const u = (((t / 900 + i * 0.37) % 1) + 1) % 1; return u < 0.5 ? 1 : -1; }

// ------------------------------------------------------------------ berths ----
export const BERTH = { y: 1950, root: 1150, end: 2550, count: 6, ship: 160 };
/** Hub docking arms and their seated shuttles (station metres). */
export function buildBerths() {
  const B = new CB(), lamps = [], cradles = [];
  const sh = buildShuttle(BERTH.ship), bb = new THREE.Box3().setFromBufferAttribute(sh.geo.attributes.position);
  const ships = [];
  for (let k = 0; k < BERTH.count; k++) {
    const a = ((k + 0.5) / BERTH.count) * TAU, d = V(Math.cos(a), 0, Math.sin(a)), t = V(-d.z, 0, d.x);
    const root = d.clone().multiplyScalar(BERTH.root).setY(BERTH.y), end = d.clone().multiplyScalar(BERTH.end).setY(BERTH.y);
    B.tube([root, end], 28, 12, CK.HULL);
    for (let j = 1; j < 5; j++) { const p = root.clone().lerp(end, j / 5); B.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d), V(1, 1, 1))); B.torus(31, 4, 24, 6, CK.BRONZE); B.pop(); }
    // cradle platform at the arm's end, a glazed control cab under it
    const top = BERTH.y + 32;
    const m = new THREE.Matrix4().makeBasis(t, V(0, 1, 0), d.clone().negate()).setPosition(end.clone().setY(top - 6));
    B.push(m);
    B.box(0, 0, 0, 190, 12, 70, CK.DARK);
    for (const x of [-80, 80]) B.box(x, 6.5, 0, 16, 1, 60, CK.LANTERN);
    B.box(0, -16, 0, 44, 20, 40, CK.GLASS);
    B.box(0, -27, 0, 50, 3, 46, CK.BRONZE);
    B.pop();
    // the shuttle lies tangentially on the cradle, its lowest point on the deck
    const sm = new THREE.Matrix4().makeBasis(d.clone().negate(), V(0, 1, 0), t).setPosition(end.clone().setY(top - bb.min.y));
    ships.push({ geo: sh.geo, m: sm });
    cradles.push({ deck: top, center: end.clone().setY(top), ship: sm });
    lamps.push(...placeLamps(sh.lamps || [], sm), { p: end.clone().setY(top + 2).addScaledVector(t, 100), r: 5, color: LAMP.GREEN, i: 2 }, { p: end.clone().setY(top + 2).addScaledVector(t, -100), r: 5, color: LAMP.RED, i: 2 });
  }
  const geo = placeMerge([{ geo: B.geometry(), m: new THREE.Matrix4() }, ...ships]);
  return { geo, lamps, cradles, shipGeo: sh.geo };
}

// ---------------------------------------------------------------- flotilla ----
export const FLOTILLA = { count: 48, rMin: 60000, rMax: 400000, yMin: -24000, yMax: 24000, range: 2.5e3 };
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** Statite placements (station metres): position, kind (0 concentrator, 1 relay), slew phase. */
export function flotillaLayout() {
  const r = rng(90210), out = [];
  for (let i = 0; i < FLOTILLA.count; i++) {
    // golden-angle spiral, so they fill the disc without clumping
    const u = (i + 0.5) / FLOTILLA.count, R = FLOTILLA.rMin + (FLOTILLA.rMax - FLOTILLA.rMin) * Math.sqrt(u);
    const a = i * 2.39996 + (r() - 0.5) * 0.3;
    out.push({ p: V(Math.cos(a) * R, FLOTILLA.yMin + (FLOTILLA.yMax - FLOTILLA.yMin) * r(), Math.sin(a) * R), kind: i % 4 === 3 ? 1 : 0, phase: r() * TAU, spin: r() * TAU, size: 0.8 + 0.5 * r() });
  }
  return out;
}

/** A concentrator statite: seven hexagonal mirror facets toed in to a hot receiver (metres, sun at -Y). */
export function buildConcentrator() {
  const B = new CB(), lamps = [];
  const facet = (cx, cz, r, tilt, ay) => {
    B.at(cx, 0, cz, 0, ay, 0); B.push(new THREE.Matrix4().makeRotationX(tilt)); B.push(TO_Y);
    lathe(B, [[0, -3, CK.PANEL], [r, -3, CK.PANEL], [r, 3, CK.BRONZE], [0, 3, CK.DARK]], 6, Math.PI / 6);
    B.pop();
    const ring = [];
    for (let i = 0; i <= 6; i++) { const q = Math.PI / 6 + (i / 6) * TAU; ring.push(V(Math.cos(q) * (r + 4), 5, Math.sin(q) * (r + 4))); }
    ring[6] = ring[0].clone();
    B.tube(ring, 5, 5, CK.HULL);
    // three actuator legs behind the facet
    for (let i = 0; i < 3; i++) { const q = (i / 3) * TAU; B.tube([V(Math.cos(q) * r * 0.5, 4, Math.sin(q) * r * 0.5), V(Math.cos(q) * r * 0.2, 60, Math.sin(q) * r * 0.2)], 4, 5, CK.DARK); }
    B.pop(); B.pop();
  };
  facet(0, 0, 440, 0, 0);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; facet(Math.cos(a) * 800, Math.sin(a) * 800, 430, 0.2, -a + Math.PI / 2); }
  // backing truss and the spine to the receiver
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; B.tube([V(0, 60, 0), V(Math.cos(a) * 800, 110, Math.sin(a) * 800)], 12, 6, CK.DARK); }
  B.push(TO_Y); B.at(0, 0, 0); B.torus(800, 9, 36, 6, CK.HULL); B.pop(); B.pop();
  B.tube([V(0, -3, 0), V(0, -1350, 0)], 16, 8, CK.HULL);
  for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + 0.5; B.tube([V(Math.cos(a) * 800, 0, Math.sin(a) * 800), V(0, -1300, 0)], 6, 5, CK.DARK); }
  B.at(0, -1400, 0); B.push(TO_Y);
  lathe(B, [[40, -60, CK.HULL], [70, 0, CK.BRONZE], [70, 40, CK.LANTERN], [30, 70, CK.LANTERN], [0, 80, CK.LANTERN]], 16);
  B.pop(); B.pop();
  lamps.push({ p: V(0, -1500, 0), r: 40, color: [1.0, 0.72, 0.4], i: 3.0, breathe: 0.2 });
  // the service bus behind the mirror: a drum, radiators edge-on to the Sun, a transmitter dish
  B.at(0, 110, 0); B.push(TO_Y);
  lathe(B, [[120, 0, CK.BRONZE], [150, 20, CK.HULL], [150, 180, CK.HULL], [110, 220, CK.BRONZE], [0, 240, CK.HULL]], 20);
  B.pop(); B.pop();
  for (const sd of [-1, 1]) { B.box(sd * 700, 240, 0, 1000, 280, 5, CK.RADIATOR); B.box(sd * 230, 240, 0, 170, 20, 20, CK.BRONZE); B.box(sd * 700, 105, 0, 1000, 8, 12, CK.BRONZE); }
  B.at(0, 400, 0, 0.6, 0, 0); B.push(TO_Y);
  lathe(B, [[20, -60, CK.HULL], [160, 0, CK.BRONZE], [180, 30, CK.BRONZE], [0, 10, CK.DARK]], 20);
  B.pop(); B.pop();
  B.tube([V(0, 340, 0), V(0, 400, 0)], 14, 6, CK.HULL);
  lamps.push({ p: V(0, 470, 0), r: 18, color: LAMP.RED, i: 2.6, breathe: 0.5 }, { p: V(1200, 240, 0), r: 14, color: LAMP.WHITE, i: 2 }, { p: V(-1200, 240, 0), r: 14, color: LAMP.WHITE, i: 2 });
  return { geo: B.geometry(), lamps };
}

/** A crewed relay platform: a pressure drum with lit decks, a slewing beam dish and a berth. */
export function buildRelayPlatform() {
  const B = new CB(), lamps = [];
  B.push(TO_Y);
  lathe(B, [[0, -420, CK.BRONZE], [180, -400, CK.HULL], [260, -300, CK.HULL], [260, -180, CK.BRONZE], [260, -160, CK.GLASS], [260, 60, CK.GLASS], [260, 80, CK.BRONZE], [230, 200, CK.HULL], [120, 300, CK.HULL], [0, 320, CK.BRONZE]], 32);
  B.pop();
  // a counter-rotating habitat ring (kept static here: it is the drum's pressure torus)
  B.push(TO_Y); B.torus(620, 60, 64, 12, CK.GLASS); B.pop();
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; B.tube([V(Math.cos(a) * 250, 0, Math.sin(a) * 250), V(Math.cos(a) * 570, 0, Math.sin(a) * 570)], 22, 8, CK.HULL); }
  // the beam dish on a yoke over the drum
  B.tube([V(0, 310, 0), V(0, 520, 0)], 30, 10, CK.BRONZE);
  B.at(0, 560, 0, Math.PI / 2 - 0.35, 0, 0);
  lathe(B, [[30, -40, CK.HULL], [480, 60, CK.BRONZE], [500, 80, CK.BRONZE], [40, 20, CK.DARK]], 36);
  B.tube([V(0, 0, 0), V(0, 0, 360)], 10, 6, CK.DARK);
  B.box(0, 0, 370, 40, 40, 30, CK.LANTERN);
  B.pop();
  // PV wings (sun at -Y: wings face it)
  for (const sd of [-1, 1]) {
    B.tube([V(sd * 260, -250, 0), V(sd * 1900, -250, 0)], 14, 6, CK.DARK);
    for (let j = 0; j < 4; j++) B.box(sd * (500 + j * 380), -262, 0, 340, 4, 520, CK.PANEL);
  }
  // berth: a docking tube down the -z side with a lit collar
  B.tube([V(0, -250, -240), V(0, -250, -560)], 40, 12, CK.HULL);
  B.at(0, -250, -560); lathe(B, [[46, -10, CK.BRONZE], [52, 0, CK.BRONZE], [40, 8, CK.DARK]], 16); B.pop();
  lamps.push({ p: V(0, -250, -580), r: 16, color: LAMP.GREEN, i: 2.4, breathe: 0.4 }, { p: V(0, 940, 0), r: 20, color: LAMP.RED, i: 2.4, breathe: 0.5 },
    { p: V(1920, -250, 0), r: 12, color: LAMP.WHITE, i: 2 }, { p: V(-1920, -250, 0), r: 12, color: LAMP.WHITE, i: 2 });
  return { geo: B.geometry(), lamps };
}

/** Slew of statite i at time t: a small, slow wander about Sun-pointing (radians). */
export function statiteSlew(s, t, out = new THREE.Quaternion()) {
  const e = new THREE.Euler(0.04 * Math.sin(t * 0.011 + s.phase), s.spin + 0.02 * t * (s.kind ? 0.2 : 0.05), 0.04 * Math.cos(t * 0.013 + s.phase * 1.7));
  return out.setFromEuler(e);
}

// ---------------------------------------------------------------- couriers ----
export const COURIER = { count: 6, holdR: 2600, holdY: 8200, exitR: 24000, exitY: 6500, T: 520, dwell: 0.14, len: 90 };
/** Courier c's run (station metres): hold over the crown, out through the exit gate, to its statite's berth. */
export function courierRoute(c, layout) {
  const target = layout[(c * 7 + 3) % layout.length];
  const az = Math.atan2(target.p.z, target.p.x);
  const hold = V(Math.cos(az) * COURIER.holdR, COURIER.holdY + c * 180, Math.sin(az) * COURIER.holdR);
  const exit = V(Math.cos(az) * COURIER.exitR, COURIER.exitY + c * 180, Math.sin(az) * COURIER.exitR);
  // berth: short of the statite on the anti-Sun side (behind its bus)
  const berth = target.p.clone().add(V(0, 2600 * target.size, 0)).addScaledVector(target.p.clone().setY(0).normalize(), -1800);
  return { hold, exit, berth, target, offset: c / COURIER.count };
}
/** Pose on a courier route at time t. Returns the throttle. */
export function courierPose(r, t, outPos, outFwd) {
  const u = (((t / COURIER.T) + r.offset) % 1 + 1) % 1, D = COURIER.dwell, run = (1 - 2 * D) / 2;
  let a, b, s, fwdSign = 1;
  if (u < D) { outPos.copy(r.hold); outFwd.copy(r.exit).sub(r.hold).setY(0).normalize(); return 0.02; }
  if (u < D + run) { s = (u - D) / run; fwdSign = 1; }
  else if (u < 2 * D + run) { outPos.copy(r.berth); outFwd.copy(r.berth).sub(r.exit).normalize(); return 0.02; }
  else { s = 1 - (u - 2 * D - run) / run; fwdSign = -1; }
  // two legs: hold to exit takes the first fifth of the run
  const e = smooth(0, 1, s);
  if (e < 0.2) { a = r.hold; b = r.exit; s = e / 0.2; } else { a = r.exit; b = r.berth; s = (e - 0.2) / 0.8; }
  outPos.copy(a).lerp(b, s);
  outFwd.copy(b).sub(a).normalize().multiplyScalar(fwdSign);
  const sp = Math.abs(Math.sin(Math.PI * smooth(0, 1, (u < 0.5 ? (u - D) : (u - 2 * D - run)) / run)));
  return 0.15 + 0.6 * sp;
}

// ------------------------------------------------------------- instancing ----
/** An InstancedMesh with the space craft material and its per-frame update (metres, scaled to km). */
export function craftInstances(geo, matrices, opts = {}, mat = null) {
  const m = mat || createCraftMaterial(opts);
  const im = new THREE.InstancedMesh(geo, m, Math.max(matrices.length, 1));
  im.count = matrices.length;
  matrices.forEach((mm, i) => im.setMatrixAt(i, mm));
  im.instanceMatrix.needsUpdate = true;
  im.scale.setScalar(opts.scale ?? KM);
  im.frustumCulled = false;
  im.renderOrder = 3;
  im.userData.world = new THREE.Vector3();
  im.onBeforeRender = (r, s, cam) => {
    im.getWorldPosition(im.userData.world);
    updateCraftMaterial(m, cam, im.userData.sunDir || CRAFT_FRAME.sunDir, im.userData.world, CRAFT_FRAME.time);
    m.uniformsNeedUpdate = true;
  };
  return im;
}

/** Lamps whose positions are rewritten each frame (object units). */
export class MovingLamps {
  constructor(count, { r, color, i = 2, minPx = 1.2, breathe = 0 }) {
    this.mesh = createLamps(Array.from({ length: count }, (_, k) => ({ p: V(0, 0, 0), r, color, i, breathe, phase: (k * 0.618) % 1 })), { minPx });
    this.attr = this.mesh.geometry.getAttribute('iLamp');
    this.count = count;
  }
  set(k, p) { const a = this.attr.array; a[k * 4] = p.x; a[k * 4 + 1] = p.y; a[k * 4 + 2] = p.z; }
  commit() { this.attr.needsUpdate = true; }
}

export const CREW_LANE = 5.5;
/** Walkers on the petal catwalks: position of crew j at time t (petal-local), and its petal. */
export function crewOnCatwalk(j, t, out) {
  const petal = j % PETAL.count, lane = j % 2 ? 1 : -1, T = 1400 + (j % 5) * 90;
  const u = (((t / T) + j * 0.137) % 1 + 1) % 1, s = u < 0.5 ? u * 2 : 2 - u * 2;
  const z = CATWALK.z0 + 200 + (CATWALK.z1 - CATWALK.z0 - 400) * (0.1 + 0.8 * s);
  out.set(lane * CREW_LANE, DECK_TOP(z) + 1.7, z);
  return petal;
}

// ---------------------------------------------------------------- district ----
export class HelianthDistrict {
  /** station: the collector's group (km); sunDir: its light direction; scene: where the flotilla lives. */
  constructor(station, sunDir, space) {
    this.station = station; this.sunDir = sunDir; this.space = space; this._center = new THREE.Vector3();
    this.built = false; this.queue = null;
    this.near = new THREE.Group(); this.near.visible = false; station.add(this.near);
    this.flotilla = new THREE.Group(); this.flotilla.visible = false;
    if (space?.scene) space.scene.add(this.flotilla);
    this.layout = flotillaLayout();
    this.routes = Array.from({ length: COURIER.count }, (_, c) => courierRoute(c, this.layout));
    this.crawlers = null; this.couriers = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = V(0, 0, 0); this._f = V(0, 0, 1); this._x = V(0, 0, 0); this._y = V(0, 0, 0);
    this._pm = new THREE.Matrix4(); this._s = V(1, 1, 1); this._flip = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI);
    if (space?.addBody) this.body = space.addBody('helianthFlotilla', [this.flotilla], (v) => (v || this._center).copy(this.flotilla.position), FLOTILLA.rMax * 0.001 + 5, {});
  }

  /** Build steps (each a few tens of ms at most), run one per frame on approach. */
  steps() {
    const opt = { accent: [1, 0.72, 0.4], lit: 0.55, fill: 0.075 };
    const sd = this.sunDir;
    const mk = (geo, mats) => { const m = craftInstances(geo, mats, opt); m.userData.sunDir = sd; return m; };
    return [
      () => {
        const f = buildPetalFittings();
        this.petalData = f;
        const mats = Array.from({ length: PETAL.count }, (_, k) => petalMatrix(k));
        this.petals = mk(f.geo, mats);
        this.near.add(this.petals);
        const L = [];
        for (const m of mats) L.push(...placeLamps(f.lamps, m));
        addLamps(this.petals, L, { minPx: 1.1 });
      },
      () => {
        const g = buildCrawler();
        this.crawlers = mk(g, Array.from({ length: PETAL.count }, () => new THREE.Matrix4()));
        this.near.add(this.crawlers);
        this.crawlerLamps = new MovingLamps(PETAL.count, { r: 2.2, color: LAMP.AMBER, i: 3, breathe: 0.6 });
        this.crawlerLamps.mesh.scale.setScalar(0.001);
        this.near.add(this.crawlerLamps.mesh);
        this.crew = new MovingLamps(PETAL.count * 4, { r: 1.2, color: LAMP.WHITE, i: 2.4 });
        this.crew.mesh.scale.setScalar(0.001);
        this.near.add(this.crew.mesh);
      },
      () => {
        const b = buildBerths();
        this.berthData = b;
        const m = craftMesh(b.geo, opt);
        m.userData.sunDir = sd;
        addLamps(m, b.lamps, { minPx: 1.2 });
        this.near.add(m);
      },
      () => {
        const c = buildConcentrator(), r = buildRelayPlatform();
        this.statiteGeo = [c, r];
        this.statites = [0, 1].map((kind) => {
          const idx = this.layout.map((s, i) => (s.kind === kind ? i : -1)).filter((i) => i >= 0);
          const im = mk((kind ? r : c).geo, idx.map(() => new THREE.Matrix4()));
          im.userData.idx = idx;
          this.flotilla.add(im);
          // lamps: one lamp set per statite (static in the statite's frame: placed at build time,
          // the slew is a few degrees, so their small drift is invisible at these ranges)
          const L = [];
          for (const i of idx) { const s = this.layout[i]; const mm = new THREE.Matrix4().compose(s.p, statiteSlew(s, 0), this._s.set(s.size, s.size, s.size)); L.push(...placeLamps((kind ? r : c).lamps, mm, 1.6)); }
          addLamps(im, L, { minPx: 1.3 });
          return im;
        });
      },
      () => {
        const tug = buildTug(COURIER.len);
        const opt2 = { ...opt, lit: 0.6 };
        const mat = createCraftMaterial(opt2);
        for (const r of this.routes) {
          const m = craftMesh(tug.geo, opt2, mat);
          m.userData.sunDir = sd;
          const engines = addEngines(m, tug.glows, { scale: 0.8, length: 10, color: 0xffb070, core: 0xfff0d8, throttle: 0 });
          addLamps(m, tug.lamps, { minPx: 1.2 });
          this.flotilla.add(m);
          this.couriers.push({ mesh: m, r, engines });
        }
      },
    ];
  }

  /** Build everything now (headless tests). */
  build() { if (this.built) return; for (const s of this.queue || this.steps()) s(); this.queue = []; this.built = true; this.animate(0); }

  update(realTime, camWorld) {
    this.flotilla.position.copy(this.station.position);
    this.flotilla.quaternion.copy(this.station.quaternion);
    if (!camWorld) return;
    const d = camWorld.distanceTo(this.station.position);
    // lazily: start building inside 6,000 km, one step a frame
    if (!this.built && d < 6000) {
      if (!this.queue) this.queue = this.steps();
      const s = this.queue.shift();
      if (s) s();
      if (!this.queue.length) this.built = true;
    }
    this.near.visible = this.built && d < 140;
    this.flotilla.visible = this.built && d < FLOTILLA.range;
    if (this.body) this.body.visible = this.flotilla.visible;
    if (this.built && (this.near.visible || this.flotilla.visible)) this.animate(realTime);
  }

  animate(t) {
    const P = this._p, F = this._f;
    if (this.crawlers) {
      for (let k = 0; k < PETAL.count; k++) {
        const z = crawlerZ(t, k), dir = crawlerDir(t, k);
        petalMatrix(k, this._pm);
        this._q.setFromAxisAngle(this._x.set(1, 0, 0), -Math.atan(spineSlope(z)));
        if (dir < 0) this._q.multiply(this._flip);
        this._m.compose(P.set(0, DECK_TOP(z), z), this._q, this._s.set(1, 1, 1)).premultiply(this._pm);
        this.crawlers.setMatrixAt(k, this._m);
        this.crawlerLamps.set(k, P.set(0, DECK_TOP(z) + 16, z).applyMatrix4(this._pm));
      }
      this.crawlers.instanceMatrix.needsUpdate = true;
      this.crawlerLamps.commit();
      for (let j = 0; j < this.crew.count; j++) { const petal = crewOnCatwalk(j, t, P); this.crew.set(j, P.applyMatrix4(petalMatrix(petal, this._pm))); }
      this.crew.commit();
    }
    if (this.statites) for (const im of this.statites) {
      im.userData.idx.forEach((i, n) => { const s = this.layout[i]; im.setMatrixAt(n, this._m.compose(s.p, statiteSlew(s, t, this._q), this._s.set(s.size, s.size, s.size))); });
      im.instanceMatrix.needsUpdate = true;
    }
    for (const c of this.couriers) {
      const thr = courierPose(c.r, t, P, F);
      c.mesh.position.copy(P).multiplyScalar(0.001);
      this._x.crossVectors(this._y.set(0, 1, 0), F);
      if (this._x.lengthSq() < 1e-6) this._x.set(1, 0, 0);
      this._x.normalize(); this._y.crossVectors(F, this._x);
      c.mesh.quaternion.setFromRotationMatrix(this._m.makeBasis(this._x, this._y, F));
      for (const e of c.engines) e.setThrottle(thr);
    }
  }
}
