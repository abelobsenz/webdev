import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { LAMP } from './lamps.js';
import { V, dockingCollar, radiatorWing, dish, truss, catwalk } from './shipKit.js';

// THE FULCRUM: the Earth-Moon L1 gateway (metres; local +Z points at the Moon, +Y the orbit
// normal). Where the pulls of the Earth and the Moon balance, passengers change from the
// Earth ferries to the lunar packets and the colony shuttles.
//
//   spine     a banded pressure spine 1.9 km long with glazed concourses
//   wheels    two counter-rotating habitat wheels (0.5 g hotels and transit halls): glazed
//             outer decks, spokes with lift shafts, hubs on bearings (they spin)
//   docks     a cruciform dock at each end, four arms of berths with collars, galleries and
//             approach-light strings; the Earth dock takes ferries, the Moon dock packets
//   works     a propellant farm of spheres on trusses, radiators edge-on to the Sun,
//             photovoltaic wings, dishes, catwalks and floodlit service decks

export const GATE = {
  HALF: 950, SPINE_R: 60,
  WHEELS: [{ z: -260, R: 520, r: 36, spin: Math.sqrt(4.9 / 520) }, { z: 260, R: 380, r: 30, spin: -Math.sqrt(4.9 / 380) }],
  ARM: 320,
};

const TAU = Math.PI * 2;
/** A closed annular solid of revolution about z (no disc through the axis). */
function ring(B, prof, seg) { B.lathe([...prof, prof[0]], seg, 0, { closedProfile: true }); }

/** The static structure. Returns { geo, lamps, berths: [{ p, dir }] } in metres. */
export function buildGateway() {
  const { HALF, SPINE_R: rs, ARM } = GATE;
  const B = new CB();
  const lamps = [];
  const berths = [];
  // spine
  const prof = [[rs * 0.6, -HALF - 40, CK.DARK]];
  for (let z = -HALF; z <= HALF; z += 190) {
    const glass = Math.abs(z) < 120 || Math.abs(Math.abs(z) - 570) < 100;
    prof.push([rs, z - 60, CK.HULL], [rs + 12, z - 40, CK.BRONZE], [rs + 12, z - 20, CK.BRONZE], [rs + (glass ? 18 : 0), z, glass ? CK.GLASS : CK.HULL]);
  }
  prof.push([rs * 0.6, HALF + 40, CK.DARK]);
  B.lathe(prof, 40);
  // wheel bearings on the spine
  for (const w of GATE.WHEELS) { B.at(0, 0, w.z); ring(B, [[rs + 2, -40, CK.BRONZE], [rs + 22, -30, CK.BRONZE], [rs + 22, 30, CK.DARK], [rs + 2, 40, CK.BRONZE]], 32); B.pop(); }
  // docks: four arms at each end
  for (const s of [-1, 1]) {
    const z = s * (HALF - 60);
    B.at(0, 0, z); ring(B, [[rs + 2, -50, CK.HULL], [rs + 50, -30, CK.HULL], [rs + 50, 30, CK.GLASS], [rs + 2, 50, CK.HULL]], 32); B.pop();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + (s > 0 ? Math.PI / 4 : 0);
      const c = Math.cos(a), sn = Math.sin(a);
      const root = V(c * (rs + 50), sn * (rs + 50), z), tip = V(c * (rs + 50 + ARM), sn * (rs + 50 + ARM), z);
      B.tube([root, tip], 14, 10, CK.HULL);
      catwalk(B, root.clone().add(V(0, 0, 18)), tip.clone().add(V(0, 0, 18)), V(0, 0, 1), 2.4, 1.2);
      // side berths along the arm, facing away from the station (+-z)
      for (const f of [0.36, 0.92]) {
        const p = root.clone().lerp(tip, f).add(V(0, 0, s * 18));
        B.push(new THREE.Matrix4().makeRotationX(s > 0 ? 0 : Math.PI).setPosition(p));
        const dc = dockingCollar(B, 9);
        B.pop();
        lamps.push(...dc.lamps);
        berths.push({ p: dc.face, dir: V(0, 0, s) });
        for (let k = 1; k <= 4; k++) lamps.push({ p: p.clone().add(V(0, 0, s * k * 70)), r: 3.5, color: s > 0 ? LAMP.TEAL : LAMP.AMBER, i: 2.4, phase: k * 0.15, breathe: 0.8 });
      }
      lamps.push({ p: tip.clone().add(V(c * 18, sn * 18, 0)), r: 5, color: i % 2 ? LAMP.RED : LAMP.GREEN, i: 3.2, breathe: 0.3 });
    }
  }
  // propellant farm: spheres ringed round the spine between the wheels, each on a truss
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    const c = Math.cos(a), sn = Math.sin(a);
    B.at(c * 190, sn * 190, 0); B.lathe([[0.1, -48, CK.HULL], [34, -34, CK.HULL], [48, 0, CK.BRONZE], [34, 34, CK.HULL], [0.1, 48, CK.HULL]], 20); B.pop();
    truss(B, V(c * (rs + 10), sn * (rs + 10), 0), V(c * 145, sn * 145, 0), 10, 14, 0.8, CK.DARK);
  }
  // radiators edge-on to the Sun, photovoltaic wings, dishes
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const out = V(Math.cos(a), Math.sin(a), 0);
    radiatorWing(B, out.clone().multiplyScalar(rs + 8).setZ(620), out, V(0, 0, 1).cross(out), 360, 110, lamps, LAMP.RED);
  }
  for (const s of [-1, 1]) {
    B.box(s * (rs + 40), 0, -640, 60, 20, 40, CK.BRONZE);
    B.box(s * (rs + 70 + 260), 0, -640, 520, 4, 150, CK.PANEL);
    B.box(s * (rs + 70 + 260), 0, -640, 520, 8, 6, CK.DARK);
  }
  dish(B, V(0, rs + 10, 700), V(0, 1, 0.6), 30);
  dish(B, V(0, -rs - 10, -700), V(0, -1, -0.6), 22);
  // service decks with floods
  for (const z of [-470, 470]) {
    B.at(0, 0, z); ring(B, [[rs + 2, -8, CK.DECK], [rs + 110, -8, CK.DECK], [rs + 110, 8, CK.BRONZE], [rs + 2, 8, CK.DECK]], 40); B.pop();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; lamps.push({ p: V(Math.cos(a) * (rs + 114), Math.sin(a) * (rs + 114), z + 10), r: 6, color: LAMP.WHITE, i: 2.2 }); }
  }
  lamps.push({ p: V(0, 0, HALF + 60), r: 12, color: LAMP.WHITE, i: 3.5, breathe: 0.5 }, { p: V(0, 0, -HALF - 60), r: 12, color: LAMP.WHITE, i: 3.5, breathe: 0.5, phase: 0.5 });
  return { geo: B.geometry(), lamps, berths };
}

/** One habitat wheel (axis z, centred at the origin). Returns { geo, lamps }. */
export function buildGatewayWheel(w) {
  const B = new CB();
  const lamps = [];
  const segR = 128, segT = 14;
  // the rim, glazed on its outer decks
  const base = B.pos.length / 3;
  for (let i = 0; i <= segR; i++) {
    const a = (i / segR) * TAU;
    for (let j = 0; j <= segT; j++) {
      const b = (j / segT) * TAU, rr = w.R + w.r * Math.cos(b);
      const k = Math.cos(b) > 0.35 ? CK.GLASS : Math.abs(Math.sin(b)) > 0.8 ? CK.BRONZE : CK.HULL;
      B.v(Math.cos(a) * rr, Math.sin(a) * rr, w.r * Math.sin(b), a * w.R, b * w.r, k);
    }
  }
  const h = new THREE.Vector3();
  for (let i = 0; i < segR; i++) for (let j = 0; j < segT; j++) {
    const a = base + i * (segT + 1) + j, b = a + 1, c = a + segT + 1, d = c + 1;
    const am = ((i + 0.5) / segR) * TAU, bm = ((j + 0.5) / segT) * TAU;
    h.set(Math.cos(am) * Math.cos(bm), Math.sin(am) * Math.cos(bm), Math.sin(bm));
    B.tri(a, c, d, h); B.tri(a, d, b, h);
  }
  // spokes with lift shafts, a hub on the bearing
  ring(B, [[GATE.SPINE_R + 24, -34, CK.BRONZE], [GATE.SPINE_R + 60, -26, CK.HULL], [GATE.SPINE_R + 60, 26, CK.HULL], [GATE.SPINE_R + 24, 34, CK.BRONZE]], 32);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    const c = Math.cos(a), s = Math.sin(a);
    B.tube([V(c * (GATE.SPINE_R + 58), s * (GATE.SPINE_R + 58), 0), V(c * (w.R - w.r + 4), s * (w.R - w.r + 4), 0)], 9, 8, CK.HULL);
    B.tube([V(c * (GATE.SPINE_R + 58), s * (GATE.SPINE_R + 58), 10), V(c * (w.R - w.r + 4), s * (w.R - w.r + 4), 10)], 2.5, 5, CK.CONDUIT);
  }
  for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; lamps.push({ p: V(Math.cos(a) * (w.R + w.r + 3), Math.sin(a) * (w.R + w.r + 3), 0), r: 4, color: i % 6 ? LAMP.WHITE : LAMP.AMBER, i: 2.4, phase: i / 24, breathe: 0.4 }); }
  return { geo: B.geometry(), lamps };
}
