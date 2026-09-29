import * as THREE from 'three';
import { CB, CK, TAU, V, lerp, rng, here, hereDir, atAim, tank, sphereTank, rcsQuad, dockingCollar, truss, catwalk, radiatorWing, dish, mast, container, bridge, bell, flood, navSet, hull, sectionAt } from './shipKit.js';
import { LAMP } from './lamps.js';
import { DK } from './craftMesh.js';
import { hullDressing } from './shipKit.js';

// THE WORKING FLEET: individually designed ships for the lanes round the Harbour and Selene
// (metres, +Z forward, +Y up, port +X). Every design is seeded, so a class is a family of
// sister ships rather than one model stamped out: lengths, bay counts, cargo, tank strings,
// radiator spans and fittings vary hull by hull.
//
//   hauler     container freighter: a bow crew section with a glazed bridge over two decks of
//              cabins, a truss spine carrying bays of ribbed containers in bronze clamp frames,
//              floodlights on the cargo, radiator wings, a three-bell drive behind a shadow shield
//   tanker     volatiles carrier: a string of banded spheres or capsules on a spine with a
//              catwalk and railings along its back, pump manifolds, a crew drum, radiators
//   tug        harbour tug: a stubby armoured body, a pusher cone forward, two manipulator
//              arms folded along the flanks, a glazed cab, big RCS clusters, four bells
//   packet     passenger packet: a lofted body with three decks of lit windows, a lantern
//              lounge ring, a dorsal fin with its beacon, docking collars port and starboard
//   barge      Selene ore barge: an open hopper frame of regolith blocks, a cab tower, a drive
//   lighter    small cargo lighter: a cab, a flat deck of pallets, four RCS quads, two bells
//
// Each builder returns { geo, glows: [{ p, r, dir }], lamps, rcs: [{ p, dir }], length, radius, kind }.

function finish(B, glows, lamps, rcs, kind, length) {
  const geo = B.geometry();
  geo.computeBoundingSphere();
  const bs = geo.boundingSphere;
  return { geo, glows, lamps, rcs, kind, length, radius: bs.center.length() + bs.radius };
}

// ----------------------------------------------------------------- hauler ----
export function buildHauler(seed = 1) {
  const r = rng(seed * 7919 + 11);
  const B = new CB();
  const glows = [], lamps = [], rcs = [];
  const bays = r.int(3, 6), bayL = r.pick([26, 32]), stack = r.pick([[2, 2], [3, 2], [2, 3], [3, 3]]);
  const cw = 5.2, ch = 5.2;
  const spineW = 4;
  const zCargo0 = -20, zCargo1 = zCargo0 + bays * (bayL + 2);
  const zBow = zCargo1 + 6;
  // ---- drive section: thrust frame, shadow shield, three bells
  B.lathe([[0.1, -62, CK.DARK], [8, -62, CK.DARK], [9, -58, CK.BRONZE], [9, -46, CK.HULL], [11, -44, CK.BRONZE], [11, -40, CK.HULL], [7, -34, CK.HULL], [4, -26, CK.DARK], [0.1, -26, CK.DARK]], 20);
  B.at(0, 0, -38);
  B.lathe([[0.1, 0, CK.DARK], [16, 0, CK.DARK], [17, 1.2, CK.BRONZE], [16, 2.4, CK.HULL], [0.1, 2.4, CK.HULL]], 28);   // shadow shield
  B.pop();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2;
    bell(B, Math.cos(a) * 5, Math.sin(a) * 5, -62, 3.4, 8, glows);
  }
  // propellant tanks beneath the shield
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    B.at(Math.cos(a) * 10, Math.sin(a) * 10, -30);
    tank(B, 3.2, 14, CK.HULL, CK.BRONZE, 14);
    B.pop();
  }
  // ---- spine truss and cargo bays
  truss(B, V(0, 0, -26), V(0, 0, zBow), spineW, 6.5, 0.22);
  const kinds = [DK.LIVERY, CK.BRONZE, DK.GRIME, CK.DARK, CK.HULL, DK.LIVERY, DK.GRIME];
  const [nx, ny] = stack;
  // container slots: a grid round the spine (an even count opens a gap for the truss)
  const slots = (n, pitch) => Array.from({ length: n }, (_, i) => { const c = i - (n - 1) / 2; return c * pitch + (n % 2 === 0 ? Math.sign(c) * (spineW / 2 + 0.3) : 0); });
  const xs = slots(nx, cw + 0.6), ys = slots(ny, ch + 0.6);
  const ox = Math.max(...xs.map(Math.abs)), oy = Math.max(...ys.map(Math.abs));
  for (let b = 0; b < bays; b++) {
    const zc = zCargo0 + b * (bayL + 2) + bayL / 2 + 1;
    // clamp frame: a bronze square ring with shoes to the spine
    const fx = ox + cw / 2 + 1.4, fy = oy + ch / 2 + 1.4;
    for (const dz of [-bayL / 2 - 0.4, bayL / 2 + 0.4]) {
      B.box(0, fy, zc + dz, fx * 2 + 1, 0.9, 0.9, CK.BRONZE); B.box(0, -fy, zc + dz, fx * 2 + 1, 0.9, 0.9, CK.BRONZE);
      B.box(fx, 0, zc + dz, 0.9, fy * 2 + 1, 0.9, CK.BRONZE); B.box(-fx, 0, zc + dz, 0.9, fy * 2 + 1, 0.9, CK.BRONZE);
      for (const s of [-1, 1]) { B.tube([V(s * fx, 0, zc + dz), V(s * spineW / 2, 0, zc + dz)], 0.35, 5, CK.DARK); B.tube([V(0, s * fy, zc + dz), V(0, s * spineW / 2, zc + dz)], 0.35, 5, CK.DARK); }
    }
    // containers in their slots (never the spine's own), a few slots empty
    for (const x of xs) for (const y of ys) {
      if (Math.abs(x) < (cw + spineW) / 2 && Math.abs(y) < (ch + spineW) / 2) continue;
      if (r() < 0.12) continue;
      container(B, x, y, zc, cw, ch, bayL - 1.2, r.pick(kinds));
    }
    // floodlights on the frame corners, looking in at the cargo (the loading crews' light)
    if (b % 2 === 0) for (const s of [-1, 1]) lamps.push(flood(B, V(s * fx, fy + 0.8, zc - bayL / 2), V(-s * 0.4, -0.5, 1), 0.7, LAMP.WHITE, 1.8));
  }
  // ---- radiator wings aft of the cargo, edge-on to the drive
  const span = r.range(26, 44), chord = r.range(14, 20);
  for (const s of [-1, 1]) radiatorWing(B, V(s * 3, 0, -18), V(s, 0, 0), V(0, 1, 0), span, chord, lamps, s > 0 ? LAMP.RED : LAMP.GREEN);
  // ---- bow: crew section (two decks of cabins), bridge, collar
  B.at(0, 0, zBow);
  hull(B, 0, 30, (u) => [8.5 * (1 - 0.55 * u * u), 7 * (1 - 0.5 * u * u)], {
    K: 24, N: 10, kind: (i, j, u, a) => (j === 1 ? CK.BRONZE : Math.abs(Math.sin(a)) < 0.35 && j > 1 && j < 9 ? DK.PORTS : j === 5 ? CK.BRONZE : DK.LIVERY), capStart: CK.HULL,
  });
  B.at(0, 7.4, 12);
  bridge(B, 8, 3.2, 10, lamps);
  B.pop();
  B.at(0, 0, 30.5);
  const col = dockingCollar(B, 2.4);
  lamps.push(...col.lamps);
  B.pop();
  const tip = mast(B, V(0, 8.6, 4), V(0, 1, -0.1), 9, 0.18);
  dish(B, V(4.5, 6.6, 3), V(0.4, 1, 0.3), 2.2);
  for (const s of [-1, 1]) rcs.push(...rcsQuad(B, V(s * 7.4, 0, 22), V(s, 0, 0), V(0, 0, 1), 1.1));
  rcs.push(...rcsQuad(B, V(0, 6.6, 26), V(0, 1, 0.3), V(0, 0, 1), 1.0));
  rcs.push(...rcsQuad(B, V(0, -5.4, 26), V(0, -1, 0.3), V(0, 0, 1), 1.0));
  B.pop();
  for (const s of [-1, 1]) for (const t of [-1, 1]) rcs.push(...rcsQuad(B, V(s * 7.5, t * 7.5, -44), V(s, t, 0), V(0, 0, 1), 1.2));
  navSet(lamps, { hw: 9.2, y: 0, z: zBow + 10, stern: V(0, 9.5, -58), mastTip: tip, r: 0.7 });
  lamps.push({ p: V(0, 0, zBow + 31.5), r: 0.7, color: LAMP.AMBER, i: 2.4, breathe: 0.4 });
  hullDressing(B, r, { z0: zBow + 2, z1: zBow + 13, w: 7.4, h: 5.9, n: 10, lamps });
  return finish(B, glows, lamps, rcs, 'hauler', zBow + 31 + 70);
}

// ----------------------------------------------------------------- tanker ----
export function buildTanker(seed = 1) {
  const r = rng(seed * 104729 + 3);
  const B = new CB();
  const glows = [], lamps = [], rcs = [];
  const spheres = r() < 0.5;
  const n = r.int(4, 7);
  const R = spheres ? r.range(9, 12) : r.range(6.5, 8.5);
  const pitch = spheres ? R * 2 + 3 : r.range(22, 30);
  const z0 = -10, z1 = z0 + n * pitch;
  // drive and thrust frame
  B.lathe([[0.1, -48, CK.DARK], [7, -48, CK.DARK], [7.6, -44, CK.BRONZE], [7.6, -30, CK.HULL], [9, -28, CK.BRONZE], [9, -24, CK.HULL], [4, -14, CK.DARK], [0.1, -14, CK.DARK]], 20);
  for (const x of [-3.6, 3.6]) bell(B, x, 0, -48, 3, 7.5, glows);
  // spine: a heavy tube with a catwalk along its back and railings
  B.tube([V(0, 0, -14), V(0, 0, z1 + 8)], 2.2, 12, CK.DARK);
  catwalk(B, V(0, 2.25, -10), V(0, 2.25, z1 + 4), V(0, 1, 0), 1.4, 1.1);
  // the tank string, each lug on bronze saddles, manifold pipes running alongside
  const tk = r.pick([DK.FOIL, DK.LIVERY, CK.HULL, DK.FOIL]);
  for (let i = 0; i < n; i++) {
    const zc = z0 + pitch * (i + 0.5);
    for (const s of [-1, 1]) {
      B.at(s * (R + 2.6), 0, zc);
      if (spheres) sphereTank(B, R, tk, 20); else tank(B, R, pitch - 2.5, tk, CK.BRONZE, 18);
      B.pop();
      B.box(s * 2.6, 0, zc, 2.2, 1.4, pitch * 0.35, CK.BRONZE);                    // saddle
      B.tube([V(s * 2.6, 1.2, zc - pitch / 2 + 0.5), V(s * 2.6, 1.2, zc + pitch / 2 - 0.5)], 0.35, 6, CK.CONDUIT);   // manifold
      B.tube([V(s * 2.6, 1.2, zc), V(s * (R * 0.5 + 2.6), R * 0.86, zc)], 0.3, 6, CK.DARK);   // fill line to the tank's crown
      // valve wheel at each tank's fill
      B.at(s * (R * 0.5 + 2.6), R * 0.86 + 0.4, zc, Math.PI / 2, 0, 0);
      B.torus(0.7, 0.1, 12, 4, CK.BRONZE);
      B.pop();
    }
    // tank lights: an amber lamp on each tank's crown
    if (i % 2 === 0) lamps.push({ p: V((R + 2.6), R + 0.6, zc), r: 0.45, color: LAMP.AMBER, i: 2.0, breathe: 0.3, phase: i / n },
      { p: V(-(R + 2.6), R + 0.6, zc), r: 0.45, color: LAMP.AMBER, i: 2.0, breathe: 0.3, phase: i / n + 0.5 });
  }
  // radiators: dorsal and ventral, between the drive and the tanks
  const span = r.range(18, 30);
  radiatorWing(B, V(0, 2.4, -22), V(0, 1, 0), V(1, 0, 0), span, 12, lamps, LAMP.WHITE);
  radiatorWing(B, V(0, -2.4, -22), V(0, -1, 0), V(1, 0, 0), span, 12, null, null);
  // crew drum at the bow
  B.at(0, 0, z1 + 8);
  B.lathe([[0.1, 0, CK.HULL], [6, 0, CK.HULL], [6.5, 1, CK.BRONZE], [6.5, 3, CK.GLASS], [6.8, 3.4, CK.LANTERN], [6.5, 3.8, CK.BRONZE], [6.5, 6.5, CK.GLASS], [5.5, 9, CK.HULL], [2.6, 11, CK.HULL], [0.1, 11, CK.HULL]], 24);
  B.at(0, 5.8, 5.5);
  bridge(B, 5, 2.4, 6, lamps);
  B.pop();
  B.at(0, 0, 11);
  lamps.push(...dockingCollar(B, 1.8).lamps);
  B.pop();
  const tip = mast(B, V(0, 6, 2), V(0, 1, 0), 7, 0.15);
  dish(B, V(-4, 5, 4), V(-0.5, 1, 0.4), 1.8);
  for (const s of [-1, 1]) rcs.push(...rcsQuad(B, V(s * 6.4, 0, 6), V(s, 0, 0), V(0, 0, 1), 0.9));
  B.pop();
  for (const s of [-1, 1]) for (const t of [-1, 1]) rcs.push(...rcsQuad(B, V(s * 6.5, t * 6.5, -34), V(s, t, 0), V(0, 0, 1), 1.0));
  navSet(lamps, { hw: 2 * R + 3, y: 0, z: z0 + pitch * 0.5, stern: V(0, 8, -46), mastTip: tip, r: 0.7 });
  return finish(B, glows, lamps, rcs, 'tanker', z1 + 19 + 56);
}

// -------------------------------------------------------------------- tug ----
export function buildWorkTug(seed = 1) {
  const r = rng(seed * 15485863 + 5);
  const B = new CB();
  const glows = [], lamps = [], rcs = [];
  const L = r.range(34, 46), W = r.range(6.5, 8), H = r.range(5, 6.2);
  // body: a stubby armoured hull, flat-sided, a bronze bumper belt
  hull(B, -L / 2, L / 2, (u) => [W * (u < 0.15 ? 0.85 + u : u > 0.8 ? 1 - 1.2 * (u - 0.8) : 1), H * (u > 0.85 ? 1 - 1.4 * (u - 0.85) : 1)], {
    K: 24, N: 12, n: 4, belly: 0.9, kind: (i, j, u, a) => (Math.abs(Math.sin(a)) < 0.12 ? CK.BRONZE : j === 2 || j === 9 ? DK.HAZARD : j > 9 ? DK.LIVERY : DK.GRIME),
  });
  // pusher cone and docking probe forward: soft bronze rim for shoving hulls into line
  B.at(0, 0, L / 2 - 0.5);
  B.lathe([[W * 0.7, 0, CK.HULL], [W * 0.75, 1, CK.BRONZE], [W * 0.62, 2.2, CK.DARK], [2, 3, CK.DARK], [1.2, 4.5, CK.BRONZE], [0.02, 5.3, CK.BRONZE]], 20);
  B.pop();
  // glazed cab on top, forward
  B.at(0, H + 1.3, L * 0.18);
  bridge(B, W * 0.9, 2.8, L * 0.32, lamps);
  B.pop();
  // manipulator arms folded along the flanks: shoulder, upper arm, elbow, forearm, claw
  const arm = r.range(0.5, 1.1);
  for (const s of [-1, 1]) {
    const sh = V(s * (W + 0.6), H * 0.3, L * 0.25);
    const el = V(s * (W + 1.6), H * 0.3 + 1.2 * arm, L * 0.25 - 9);
    const wr = V(s * (W + 1.3), -0.5, L / 2 + 2 * arm);
    B.at(sh.x, sh.y, sh.z); B.lathe([[1.1, -0.8, CK.BRONZE], [1.2, 0.8, CK.BRONZE]], 12); B.pop();
    B.tube([sh, el], 0.55, 8, CK.HULL);
    B.at(el.x, el.y, el.z, 0, Math.PI / 2, 0); B.lathe([[0.8, -0.6, CK.BRONZE], [0.8, 0.6, CK.BRONZE]], 10); B.pop();
    B.tube([el, wr], 0.42, 8, CK.HULL);
    atAim(B, wr, V(0, 0, 1));
    for (const t of [-1, 1]) B.tube([V(0, 0, 0), V(t * 0.9, 0, 1.4), V(t * 0.5, 0, 2.6)], 0.18, 5, CK.DARK);
    B.pop();
    lamps.push(flood(B, wr.clone().add(V(0, 0.8, 0)), V(-s * 0.2, -0.1, 1), 0.45, LAMP.WHITE, 2.4));
  }
  // engine block aft: four bells
  B.box(0, 0, -L / 2 - 1.5, W * 1.4, H * 1.4, 3, CK.DARK);
  for (const x of [-2.6, 2.6]) for (const y of [-2.2, 2.2]) bell(B, x, y, -L / 2 - 3, 1.6, 3.2, glows);
  // RCS clusters at the eight corners (tugs live on their thrusters)
  for (const s of [-1, 1]) for (const t of [-1, 1]) for (const z of [-L / 2 + 3, L / 2 - 4]) rcs.push(...rcsQuad(B, V(s * W * 0.92, t * H * 0.85, z), V(s, t * 0.8, 0), V(0, 0, 1), 0.8));
  // lights: a working-light bar across the cab roof, warning beacon, nav set
  for (let k = -2; k <= 2; k++) lamps.push({ p: V(k * W * 0.18, H + 3.4, L * 0.18 + L * 0.16), r: 0.25, color: LAMP.WHITE, i: 1.6, dir: V(0, -0.3, 1) });
  const tip = mast(B, V(0, H + 3, L * 0.02), V(0, 1, 0), 3.5, 0.1);
  lamps.push({ p: tip, r: 0.5, color: LAMP.AMBER, i: 3.0, breathe: 0.6 });
  navSet(lamps, { hw: W + 0.3, y: H * 0.5, z: 0, stern: V(0, H * 0.8, -L / 2 - 1), r: 0.45 });
  hullDressing(B, r, { z0: -L * 0.3, z1: L * 0.25, w: W, h: H, n: 12, lamps });
  return finish(B, glows, lamps, rcs, 'tug', L + 12);
}

// ----------------------------------------------------------------- packet ----
export function buildPacket(seed = 1) {
  const r = rng(seed * 2750159 + 7);
  const B = new CB();
  const glows = [], lamps = [], rcs = [];
  const L = r.range(90, 150), W = r.range(11, 15), H = r.range(8, 10);
  const K = 32;
  // three decks of cabins: window bands low, mid and high on the flanks; bronze girdles
  hull(B, -L / 2, L / 2, (u) => {
    const w = u < 0.2 ? lerp(0.7, 1, u / 0.2) : u > 0.6 ? Math.pow(Math.max(Math.cos((Math.PI / 2) * (u - 0.6) / 0.4), 0), 0.75) : 1;
    const h = u < 0.2 ? lerp(0.75, 1, u / 0.2) : u > 0.65 ? Math.pow(Math.max(Math.cos((Math.PI / 2) * (u - 0.65) / 0.35), 0), 0.85) : 1;
    return [W * w + 0.2, H * h + 0.2, 1.2 * Math.max(0, u - 0.6)];
  }, {
    K, N: 36, n: 2.4, belly: 0.7,
    kind: (i, j, u, a) => {
      const sn = Math.sin(a), cs = Math.abs(Math.cos(a));
      if (j % 9 === 0 && j > 0 && j < 36) return CK.BRONZE;
      if (j > 3 && j < 30 && cs > 0.55 && ((sn > -0.35 && sn < -0.15) || (sn > 0.0 && sn < 0.2) || (sn > 0.32 && sn < 0.5))) return j % 3 === 0 ? CK.GLASS : DK.PORTS;
      if (sn > 0.93 && j > 8 && j < 24) return CK.CONSERVATORY;
      return sn < -0.5 ? CK.HULL : DK.LIVERY;
    },
  });
  // the lantern lounge: a glazed ring round the waist, with a bronze sill
  B.at(0, 0, -L * 0.08);
  B.lathe([[W * 1.0, -3, CK.BRONZE], [W * 1.08, -2.4, CK.LANTERN], [W * 1.08, 2.4, CK.LANTERN], [W * 1.0, 3, CK.BRONZE]], K, 0, { closedProfile: false });
  B.pop();
  // dorsal fin with a beacon and a ventral keel with the boarding hatch
  B.push(new THREE.Matrix4());
  const fin = [];
  for (let j = 0; j <= 6; j++) { const u = j / 6; fin.push({ z: lerp(-L / 2 + 4, -L * 0.1, u), pts: [[-0.5, H * 0.9], [0.5, H * 0.9], [0.4, H * 0.9 + lerp(10, 2, u)], [-0.4, H * 0.9 + lerp(10, 2, u)]] }); }
  B.loft(fin, (i) => (i === 2 ? CK.BRONZE : CK.HULL));
  B.pop();
  lamps.push({ p: V(0, H * 0.9 + 10.6, -L / 2 + 4.5), r: 0.7, color: LAMP.WHITE, i: 2.6, breathe: 0.35 });
  // docking collars port and starboard, amidships
  for (const s of [-1, 1]) {
    atAim(B, V(s * (W - 0.4), -H * 0.1, L * 0.12), V(s, 0, 0));
    lamps.push(...dockingCollar(B, 2.1).lamps);
    B.pop();
  }
  // bridge windows at the nose: a glazed eyebrow
  B.at(0, H * 0.45, L * 0.36);
  bridge(B, W * 0.8, 2.4, 8, lamps);
  B.pop();
  // drive: twin nacelles on short pylons
  for (const s of [-1, 1]) {
    B.tube([V(s * W * 0.7, 0, -L / 2 + 10), V(s * (W + 3.5), -1, -L / 2 + 8)], 1.1, 8, CK.BRONZE);
    B.at(s * (W + 4), -1, -L / 2 + 6);
    B.lathe([[0.1, -10, CK.DARK], [2.6, -10, CK.DARK], [3, -8, CK.BRONZE], [3, 6, CK.HULL], [2.2, 10, CK.HULL], [0.1, 11, CK.HULL]], 16);
    B.pop();
    bell(B, s * (W + 4), -1, -L / 2 - 4, 2.4, 4.6, glows);
    radiatorWing(B, V(s * (W + 4), 2.2, -L / 2 + 6), V(0, 1, 0), V(1, 0, 0), 9, 10, lamps, LAMP.WHITE);
  }
  for (const s of [-1, 1]) for (const z of [L * 0.3, -L * 0.3]) rcs.push(...rcsQuad(B, V(s * W * 0.8, H * 0.55, z), V(s, 0.6, 0), V(0, 0, 1), 0.9));
  const tip = mast(B, V(0, H + 0.4, L * 0.15), V(0, 1, 0), 5, 0.12);
  dish(B, V(W * 0.4, H * 0.9, -L * 0.2), V(0.3, 1, -0.2), 2);
  navSet(lamps, { hw: W + 0.4, y: 0, z: L * 0.05, stern: V(0, H * 0.6, -L / 2 - 0.5), mastTip: tip, r: 0.65 });
  hullDressing(B, r, { z0: -L * 0.3, z1: L * 0.05, w: W * 0.99 + 0.2, h: H * 0.985 + 0.2, n: 16, lamps });
  return finish(B, glows, lamps, rcs, 'packet', L + 20);
}

// ------------------------------------------------------------------ barge ----
/** Selene's ore barge: an open hopper frame of sintered regolith blocks, cab tower, drive. */
export function buildBarge(seed = 1) {
  const r = rng(seed * 32452843 + 9);
  const B = new CB();
  const glows = [], lamps = [], rcs = [];
  const bays = r.int(3, 5), bw = 18, bl = 22;
  const z1 = bays * (bl + 2);
  B.lathe([[0.1, -40, CK.DARK], [8, -40, CK.DARK], [9, -36, CK.BRONZE], [9, -22, CK.HULL], [5, -12, CK.DARK], [0.1, -12, CK.DARK]], 18);
  for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + Math.PI / 2; bell(B, Math.cos(a) * 4, Math.sin(a) * 4, -40, 2.8, 6.5, glows); }
  truss(B, V(0, -6, -12), V(0, -6, z1 + 4), 4, 8, 0.25);
  for (let b = 0; b < bays; b++) {
    const zc = b * (bl + 2) + bl / 2;
    // the hopper: an open box frame (floor and four walls of grating), blocks piled inside
    B.box(0, -3.6, zc, bw, 0.6, bl, CK.DECK);
    for (const s of [-1, 1]) { B.box(s * bw / 2, 1, zc, 0.6, 9.2, bl, CK.DARK); B.box(0, 1, zc + s * bl / 2, bw, 9.2, 0.6, CK.DARK); }
    for (const x of [-bw / 2, bw / 2]) for (const z of [-bl / 2, bl / 2]) B.box(x, 1, zc + z, 1.1, 9.6, 1.1, CK.BRONZE);
    const n = r.int(10, 18);
    for (let i = 0; i < n; i++) {
      const sx = r.range(2.5, 5), sy = r.range(2, 4), sz = r.range(2.5, 5);
      B.at(r.range(-bw / 2 + 3, bw / 2 - 3), -2.2 + sy / 2 + r() * 4, zc + r.range(-bl / 2 + 3, bl / 2 - 3), r() * 0.3, r() * 3, r() * 0.3);
      B.box(0, 0, 0, sx, sy, sz, r() < 0.7 ? CK.DARK : CK.DECK);
      B.pop();
    }
    if (b % 2 === 1) for (const s of [-1, 1]) lamps.push(flood(B, V(s * bw / 2, 6, zc), V(-s, -0.6, 0), 0.6, LAMP.WHITE, 1.6));
  }
  // cab tower at the bow
  B.at(0, -2, z1 + 6);
  B.box(0, 4, 0, 6, 12, 6, CK.HULL);
  B.box(0, 10.4, 0, 6.6, 0.6, 6.6, CK.BRONZE);
  B.at(0, 12, 0.5);
  bridge(B, 6, 2.6, 6.5, lamps);
  B.pop();
  const tip = mast(B, V(0, 13.5, -2), V(0, 1, 0), 5, 0.12);
  B.pop();
  for (const s of [-1, 1]) for (const t of [-1, 1]) rcs.push(...rcsQuad(B, V(s * 7, t * 7, -28), V(s, t, 0), V(0, 0, 1), 1.0));
  for (const s of [-1, 1]) rcs.push(...rcsQuad(B, V(s * 3.2, -2, z1 + 6), V(s, 0, 0), V(0, 0, 1), 0.9));
  navSet(lamps, { hw: bw / 2 + 0.5, y: 5.6, z: z1 * 0.5, stern: V(0, 8, -38), mastTip: tip, r: 0.6 });
  return finish(B, glows, lamps, rcs, 'barge', z1 + 55);
}

// ---------------------------------------------------------------- lighter ----
export function buildLighter(seed = 1) {
  const r = rng(seed * 49979687 + 13);
  const B = new CB();
  const glows = [], lamps = [], rcs = [];
  const L = r.range(22, 30), W = r.range(8, 10);
  // flat cargo deck on a keel beam, pallets strapped down
  B.box(0, 0, 0, W, 0.8, L, CK.DECK);
  B.box(0, -1.4, 0, 2.4, 2, L + 2, CK.HULL);
  for (const s of [-1, 1]) B.tube([V(s * W / 2, 0.9, -L / 2), V(s * W / 2, 0.9, L / 2)], 0.08, 4, CK.BRONZE);   // deck-edge rails
  for (let z = -L / 2 + 1; z <= L / 2 - 1; z += 2) for (const s of [-1, 1]) B.box(s * W / 2, 0.5, z, 0.08, 0.9, 0.08, CK.DARK);
  const pal = r.int(3, 6);
  for (let i = 0; i < pal; i++) {
    const zc = -L / 2 + 3 + (i * (L - 8)) / Math.max(pal - 1, 1);
    for (const s of [-1, 1]) if (r() < 0.85) container(B, s * W * 0.24, 1.6, zc, W * 0.4, 2.2, 3, r.pick([CK.BRONZE, DK.LIVERY, DK.GRIME, CK.HULL, DK.FOIL]));
  }
  // cab forward, raised on a pillar
  B.at(0, 2.8, L / 2 + 1);
  bridge(B, 4.2, 2.6, 4.4, lamps);
  B.pop();
  B.box(0, 1.2, L / 2 + 1, 2, 2.4, 3, CK.HULL);
  for (const x of [-2, 2]) bell(B, x, -1.4, -L / 2 - 1, 1.1, 2.2, glows);
  for (const s of [-1, 1]) for (const z of [-L / 2 + 1.5, L / 2 - 1.5]) rcs.push(...rcsQuad(B, V(s * (W / 2 + 0.3), -0.2, z), V(s, 0, 0), V(0, 0, 1), 0.6));
  navSet(lamps, { hw: W / 2 + 0.4, y: 0.6, z: 0, stern: V(0, 1.4, -L / 2 - 0.4), r: 0.35 });
  lamps.push({ p: V(0, 4.8, L / 2 + 1), r: 0.35, color: LAMP.AMBER, i: 2.8, breathe: 0.6 });
  return finish(B, glows, lamps, rcs, 'lighter', L + 8);
}

/** The catalogue by class name. */
// ---------------------------------------------------------------- clipper ----
/**
 * Long-haul clipper for the outer system: a spine with a drive and shadow shield astern, a
 * propellant tank string, and forward two counter-rotating habitat rings on a common bearing
 * (a spin-gravity deck for passengers on a months-long run; counter-rotation cancels the
 * spin's torque on the ship). The rings are a separate geometry (`spin`) turned about +Z by the
 * traffic system; omega gives ~0.4 g on the ring floor. Bow: a glazed command drum and collar.
 */
export function buildClipper(seed = 1) {
  const r = rng(seed * 86028121 + 17);
  const B = new CB();
  const glows = [], lamps = [], rcs = [];
  const ringR = r.range(95, 120), ringZ = [r.range(150, 170), r.range(205, 225)];
  const zBow = 290;
  // drive: bell cluster, thrust frame and a broad shadow shield
  B.lathe([[0.1, -150, CK.DARK], [16, -150, CK.DARK], [18, -142, CK.BRONZE], [18, -120, CK.HULL], [24, -116, CK.BRONZE], [24, -110, CK.HULL], [9, -96, CK.DARK], [0.1, -96, CK.DARK]], 24);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + Math.PI / 4; bell(B, Math.cos(a) * 9, Math.sin(a) * 9, -150, 6, 13, glows); }
  B.at(0, 0, -100);
  B.lathe([[0.1, 0, CK.DARK], [38, 0, CK.DARK], [40, 2, CK.BRONZE], [38, 4, CK.HULL], [0.1, 4, CK.HULL]], 32);
  B.pop();
  // spine: a heavy truss the length of the ship, a lit conduit along it
  truss(B, V(0, 0, -96), V(0, 0, zBow - 30), 8, 12, 0.5);
  B.tube([V(0, 4.6, -90), V(0, 4.6, zBow - 34)], 0.8, 6, CK.CONDUIT);
  // tank string: four rings of tanks
  for (let i = 0; i < 4; i++) {
    const zc = -60 + i * 44;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + i * 0.3;
      B.at(Math.cos(a) * 17, Math.sin(a) * 17, zc);
      tank(B, 10, 38, i % 2 ? DK.FOIL : DK.LIVERY, CK.BRONZE, 14);
      B.pop();
    }
    B.box(0, 0, zc, 20, 20, 3, CK.BRONZE);
  }
  // radiators: a cross of long wings astern of the tanks, edge-on to the drive
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU;
    const out = V(Math.cos(a), Math.sin(a), 0), n = V(-Math.sin(a), Math.cos(a), 0);
    radiatorWing(B, out.clone().multiplyScalar(5), out, n, r.range(70, 100), 36, lamps, k === 0 ? LAMP.RED : k === 2 ? LAMP.GREEN : LAMP.WHITE);
  }
  // the ring bearing: a non-rotating hub drum with the spokes' races
  B.at(0, 0, (ringZ[0] + ringZ[1]) / 2);
  B.lathe([[0.1, -50, CK.HULL], [14, -50, CK.HULL], [16, -46, CK.BRONZE], [16, -30, CK.DARK], [14, -26, CK.HULL], [14, 26, CK.HULL], [16, 30, CK.DARK], [16, 46, CK.BRONZE], [14, 50, CK.HULL], [0.1, 50, CK.HULL]], 24);
  B.pop();
  // bow: command drum, glazed, with collar and masts
  B.at(0, 0, zBow - 30);
  B.lathe([[0.1, 0, CK.HULL], [16, 0, CK.HULL], [18, 3, CK.BRONZE], [18, 8, CK.GLASS], [19, 10, CK.LANTERN], [18, 12, CK.BRONZE], [18, 20, CK.GLASS], [14, 26, CK.HULL], [5, 30, CK.HULL], [0.1, 30, CK.HULL]], 28);
  B.at(0, 0, 30);
  lamps.push(...dockingCollar(B, 3).lamps);
  B.pop();
  const tip = mast(B, V(0, 16, 12), V(0, 1, 0), 16, 0.3);
  dish(B, V(12, 11, 6), V(0.6, 1, 0.3), 5);
  for (const s of [-1, 1]) rcs.push(...rcsQuad(B, V(s * 17, 0, 14), V(s, 0, 0), V(0, 0, 1), 1.4));
  rcs.push(...rcsQuad(B, V(0, -17, 14), V(0, -1, 0), V(0, 0, 1), 1.4));
  B.pop();
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + Math.PI / 4; rcs.push(...rcsQuad(B, V(Math.cos(a) * 23, Math.sin(a) * 23, -126), V(Math.cos(a), Math.sin(a), 0), V(0, 0, 1), 1.6)); }
  navSet(lamps, { hw: 24.5, y: 0, z: -113, stern: V(0, 26, -146), mastTip: tip, r: 1.2 });
  // ---- the habitat rings (separate: they turn): rim of cabins, window band, spokes
  const spinLamps = [], spinGeos = [];
  ringZ.forEach((z0, ri) => {
    const S = new CB();
    S.at(0, 0, z0);
    const sec = [];
    const NS = 16;
    for (let i = 0; i < NS; i++) {
      const t = (i / NS) * TAU, c = Math.cos(t), s = Math.sin(t);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / 2.6) * 11, y = Math.sign(s) * Math.pow(Math.abs(s), 2 / 2.6) * 8;
      sec.push([ringR + x, y, c > 0.55 ? CK.GLASS : c < -0.6 ? CK.CONSERVATORY : Math.abs(s) > 0.9 ? CK.HULL : CK.BRONZE]);
    }
    sec.push([...sec[0]]);
    // lathe about local z with (radius, z) pairs: the ring's section swept round the spin axis
    S.lathe(sec, 72, 0, { closedProfile: true });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + ri * Math.PI / 4;
      S.tube([V(Math.cos(a) * 16, Math.sin(a) * 16, 0), V(Math.cos(a) * (ringR - 10), Math.sin(a) * (ringR - 10), 0)], 2.6, 8, k % 2 ? CK.HULL : CK.GLASS);
    }
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * TAU;
      spinLamps.push({ p: here(S, Math.cos(a) * (ringR + 11.5), Math.sin(a) * (ringR + 11.5), 0), r: 1.2, color: [1.0, 0.8, 0.55], i: 1.4, dir: V(Math.cos(a), Math.sin(a), 0) });
    }
    S.pop();
    spinGeos.push(S.geometry());
  });
  // ~0.4 g on the ring floor (the rim's outer wall, ringR + 8 m): omega = sqrt(a / r)
  const omega = Math.sqrt(3.9 / (ringR + 8));
  const out = finish(B, glows, lamps, rcs, 'clipper', zBow + 150 + 20);
  // the fore ring turns one way, the aft ring the other (lamps 0..23 ride the first, 24..47 the second)
  out.spin = { rings: spinGeos.map((geo, i) => ({ geo, omega: i ? -omega : omega })), lamps: spinLamps, perRing: 24, ringZ, ringR, omega };
  for (const g of spinGeos) out.radius = Math.max(out.radius, g.boundingSphere.center.length() + g.boundingSphere.radius);
  return out;
}

// ------------------------------------------------------------------ drone ----
/**
 * Work drone (the reclamation crews' hands): a 5 m instrument body with a glazed sensor eye,
 * four thruster pods on outriggers, two manipulator arms folded under, a work light and a
 * strobe-free amber beacon. Lives on its RCS: the pods are its drive.
 */
export function buildDrone(seed = 1) {
  const r = rng(seed * 179424673 + 19);
  const B = new CB();
  const glows = [], lamps = [], rcs = [];
  const L = r.range(4.2, 5.6);
  hull(B, -L / 2, L / 2, (u) => [1.3 * (1 - 0.3 * u * u), 0.9 * (1 - 0.35 * u * u)], { K: 20, N: 8, n: 3, kind: (i, j) => (j === 4 ? CK.BRONZE : j < 3 ? DK.GRIME : DK.LIVERY) });
  B.at(0, 0.1, L / 2);
  B.lathe([[0.7, 0, CK.BRONZE], [0.62, 0.3, CK.GLASS], [0.3, 0.55, CK.GLASS], [0.02, 0.6, CK.GLASS]], 16);
  B.pop();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pod = V(sx * 2.2, 0, sz * 1.4);
    B.tube([V(sx * 1.1, 0, sz * 1.0), pod], 0.12, 5, CK.DARK);
    B.at(pod.x, pod.y, pod.z);
    B.lathe([[0.02, -0.5, CK.DARK], [0.36, -0.45, CK.DARK], [0.4, 0, CK.HULL], [0.36, 0.45, CK.BRONZE], [0.02, 0.5, CK.BRONZE]], 12);
    B.pop();
    rcs.push(...rcsQuad(B, pod.clone().add(V(0, 0.38, 0)), V(0, 1, 0), V(0, 0, 1), 0.28));
    if (sz < 0) bell(B, pod.x, pod.y, pod.z - 0.5, 0.26, 0.45, glows);
  }
  for (const sx of [-1, 1]) {
    B.tube([V(sx * 0.6, -0.8, L * 0.3), V(sx * 0.8, -1.2, L * 0.55), V(sx * 0.5, -1.0, L * 0.75)], 0.08, 5, CK.BRONZE);
  }
  lamps.push(flood(B, V(0, -0.5, L / 2 + 0.1), V(0, -0.2, 1), 0.3, LAMP.WHITE, 2.2));
  lamps.push(flood(B, V(0, -0.95, 0), V(0, -1, 0.3), 0.25, LAMP.WHITE, 1.8));          // belly light over the work
  lamps.push({ p: V(0, 1.0, -L * 0.2), r: 0.22, color: LAMP.AMBER, i: 2.6, breathe: 0.6 });
  navSet(lamps, { hw: 2.7, y: 0, z: 1.4, stern: V(0, 0.4, -L / 2 - 0.1), r: 0.18 });
  return finish(B, glows, lamps, rcs, 'drone', L + 1);
}

export const DESIGNS = { drone: buildDrone, hauler: buildHauler, tanker: buildTanker, tug: buildWorkTug, packet: buildPacket, barge: buildBarge, lighter: buildLighter, clipper: buildClipper };

/** A design by class and seed, built once and shared (the working lanes and the streak traffic's hulls). */
const _built = new Map();
export function design(cls, seed) {
  const key = `${cls}:${seed}`;
  if (!_built.has(key)) _built.set(key, DESIGNS[cls](seed));
  return _built.get(key);
}
