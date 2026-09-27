import * as THREE from 'three';
import { CB, CK, sectionEllipse, buildSkiff } from './craftGeometry.js';
import { LAMP } from '../space/lamps.js';

// The working ships of a capital's orbit, in the same language as the liner and tenders
// (pearl composite, bronze bands and heat shields, lantern galleries, glass decks), in
// metres, +Z forward, +Y up. Port is +X, starboard -X (seen from behind, looking ahead).
// Every builder returns { geo, glows: [{ p, r, dir }], lamps: [{ p, r, color, i, ... }] }.
//
//   shuttle    Halo port shuttle: a 110 m lifting body that flies the ground ports to the
//              ring and back, bronze heat-shield belly, one deck of windows, twin fins
//   tug        cargo tug: engine block, glazed cab, a clamp spine carrying eight containers
//   courier    fast courier: the skiff drawn at 4x, a sculpted dart with swept wings
//   freighter  outer-system freighter: drive and shadow shield, cross radiators, a truss
//              spine of tank rings, a glazed crew section at the bow
//   climber    elevator climber car: five glazed decks round a sleeve that grips the
//              tether, drive rollers above and below, a beamed-power receiver skirt

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

/** Lathe about local z with one facade kind per band: prof = [[r, z, kind], ...]; band i..i+1 takes prof[i+1]'s kind. */
export function lathe(B, prof, seg = 16, phase = 0) {
  for (let i = 0; i < prof.length - 1; i++) {
    const [r0, z0] = prof[i];
    const [r1, z1, k] = prof[i + 1];
    if (Math.abs(r0 - r1) < 1e-6 && Math.abs(z0 - z1) < 1e-6) continue;
    const e0 = Math.max(r0, 1e-3), e1 = Math.max(r1, 1e-3);
    B.loft([{ z: z0, pts: sectionEllipse(e0, e0, seg, 2, phase) }, { z: z1, pts: sectionEllipse(e1, e1, seg, 2, phase) }], k ?? CK.HULL);
  }
}

/** Sphere (as a lathe) centred at the builder's current origin. */
export function sphere(B, r, k, seg = 16, rings = 8) {
  const prof = [];
  for (let i = 0; i <= rings; i++) { const a = -Math.PI / 2 + (i / rings) * Math.PI; prof.push([Math.max(Math.cos(a) * r, 0.01), Math.sin(a) * r, k]); }
  lathe(B, prof, seg);
}

/** Engine bell opening toward -z at the current origin: returns the glow record (local coords). */
function bell(B, x, y, z, r, len, glows, s = 1, k = CK.BRONZE) {
  B.at(x, y, z);
  lathe(B, [[r * 0.55, 0, CK.HULL], [r * 0.5, -len * 0.2, CK.DARK], [r * 0.72, -len * 0.55, k], [r, -len, CK.DARK], [r * 0.93, -len * 1.02, CK.CONDUIT]], 18);
  B.pop();
  glows.push({ p: V(x, y, z - len).multiplyScalar(s), r: r * 0.9 * s, dir: V(0, 0, -1) });
}

// ---------------------------------------------------------------- shuttle ----
export function buildShuttle(len = 110) {
  const s = len / 110;
  const B = new CB();
  B.push(new THREE.Matrix4().makeScale(s, s, s));
  const K = 36, N = 40;
  const rings = [];
  for (let j = 0; j <= N; j++) {
    const u = j / N;
    const z = lerp(-52, 56, u);
    const w = u < 0.55 ? lerp(14.5, 16.5, u / 0.55) : 16.5 * Math.pow(Math.max(Math.cos((Math.PI / 2) * (u - 0.55) / 0.45), 0), 0.7);
    const h = u < 0.5 ? 6.0 + 1.4 * Math.sin(Math.PI * u) : 7.3 * Math.pow(Math.max(Math.cos((Math.PI / 2) * (u - 0.5) / 0.5), 0), 0.85);
    const lift = 1.6 * ss(0.55, 1, u);
    rings.push({ z, cy: lift, pts: sectionEllipse(Math.max(w, 0.25), Math.max(h, 0.25), K, 2.7, 0, 0.42).map(([x, y]) => [x, y + lift]) });
  }
  B.loft(rings, (i, j) => {
    const a = (i / K) * TAU;
    const sn = Math.sin(a), cs = Math.cos(a);
    if (sn < -0.3) return CK.BRONZE;                                    // heat-shield belly
    if (j === 6 || j === 7 || j === 31) return CK.BRONZE;                 // trim bands
    if (j >= 9 && j <= 29 && Math.abs(sn) < 0.28 && Math.abs(cs) > 0.8) return CK.GLASS;   // passenger deck windows
    if (j >= 32 && j <= 36 && sn > 0.45) return CK.GLASS;                  // flight deck
    return CK.HULL;
  }, { capStart: CK.DARK });
  // blended delta wings with bronze leading edges, winglets canted up
  for (const sd of [-1, 1]) {
    const wr = [];
    for (let j = 0; j <= 8; j++) {
      const u = j / 8;
      const x = sd * lerp(12, 31, u);
      const chord = lerp(46, 13, u), zc = lerp(-22, -40, u), th = lerp(1.6, 0.5, u);
      const pts = [];
      for (let i = 0; i < 14; i++) {
        const t = (i / 14) * TAU;
        pts.push([zc + Math.cos(t) * chord * 0.5, Math.sin(t) * th * (Math.cos(t) > 0 ? 1 : 0.6) - 1.6 + 1.2 * u * u]);
      }
      wr.push({ z: x, pts, cx: zc, cy: -1.6 });
    }
    B.push(new THREE.Matrix4().makeBasis(V(0, 0, 1), V(0, 1, 0), V(1, 0, 0)));
    B.loft(wr, (i) => (i === 0 || i === 1 ? CK.BRONZE : CK.HULL), { capEnd: CK.HULL });
    B.pop();
    // winglet
    B.at(sd * 31, -0.6, -42, 0, 0, sd * -0.35);
    B.box(0, 4.5, -1, 0.7, 9, 9, CK.HULL);
    B.box(0, 9.1, 0.4, 0.8, 0.3, 6.5, CK.BRONZE);
    B.pop();
    // twin tail fins
    B.at(sd * 7.5, 5.2, -44, 0, 0, sd * -0.28);
    B.box(0, 6, -1, 0.8, 12, 12, CK.HULL);
    B.box(0, 12.1, 1.2, 0.9, 0.35, 8, CK.BRONZE);
    B.pop();
  }
  // dorsal docking hatch with a bronze collar
  B.at(0, 7.9, 6, -Math.PI / 2, 0, 0);
  lathe(B, [[3.2, -0.2, CK.BRONZE], [3.2, 0.6, CK.BRONZE], [2.6, 0.9, CK.DARK], [0.1, 0.9, CK.DARK]], 16);
  B.pop();
  // engines: three bells in the stern
  const glows = [];
  bell(B, -6.5, 0.4, -52, 2.8, 5, glows, s);
  bell(B, 6.5, 0.4, -52, 2.8, 5, glows, s);
  bell(B, 0, 2.8, -52, 3.2, 5.5, glows, s);
  B.pop();
  const lamps = [
    { p: V(31.5, 1.2, -40).multiplyScalar(s), r: 0.9 * s, color: LAMP.RED, i: 3.5, dir: V(1, 0, 0.3) },
    { p: V(-31.5, 1.2, -40).multiplyScalar(s), r: 0.9 * s, color: LAMP.GREEN, i: 3.5, dir: V(-1, 0, 0.3) },
    { p: V(0, 7.2, -52).multiplyScalar(s), r: 0.8 * s, color: LAMP.WHITE, i: 2.2, dir: V(0, 0, -1) },
    { p: V(0, 9.1, 6).multiplyScalar(s), r: 0.9 * s, color: LAMP.AMBER, i: 2.6, breathe: 0.35 },
    { p: V(0, 1.6 + 1.4, 56.5).multiplyScalar(s), r: 0.7 * s, color: LAMP.WHITE, i: 1.6 },
  ];
  return { geo: B.geometry(), glows, lamps, length: len };
}

// -------------------------------------------------------------------- tug ----
export function buildTug(len = 80) {
  const s = len / 80;
  const B = new CB();
  B.push(new THREE.Matrix4().makeScale(s, s, s));
  // engine block: an octagonal prism with bronze bands
  const oct = (r) => sectionEllipse(r, r, 8, 2, Math.PI / 8);
  B.loft([{ z: -36, pts: oct(7.5) }, { z: -34, pts: oct(8.2) }, { z: -31, pts: oct(8.2) }, { z: -29, pts: oct(8.2) }, { z: -17, pts: oct(8.2) }, { z: -15, pts: oct(7.2) }],
    (i, j) => (j === 1 || j === 2 ? CK.BRONZE : j === 4 ? CK.DARK : CK.HULL), { capStart: CK.DARK, capEnd: CK.HULL });
  // glazed cab above the forward end of the block
  B.at(0, 8.6, -19);
  sphere(B, 3.6, CK.GLASS, 18, 8);
  B.pop();
  B.box(0, 7.2, -21, 3.2, 2.2, 7, CK.HULL);
  // spine: four longerons and braces
  for (const x of [-3, 3]) for (const y of [-3, 3]) B.tube([V(x, y, -15), V(x, y, 38)], 0.6, 6, CK.DARK);
  for (let z = -12; z <= 36; z += 8) {
    B.tube([V(-3, -3, z), V(3, 3, z + 4)], 0.3, 4, CK.DARK);
    B.tube([V(3, -3, z), V(-3, 3, z + 4)], 0.3, 4, CK.DARK);
  }
  // clamp frames and eight containers
  for (const z of [-13, 12, 37]) {
    B.box(0, 10.5, z, 22, 1.2, 1.4, CK.BRONZE); B.box(0, -10.5, z, 22, 1.2, 1.4, CK.BRONZE);
    B.box(10.5, 0, z, 1.2, 22, 1.4, CK.BRONZE); B.box(-10.5, 0, z, 1.2, 22, 1.4, CK.BRONZE);
  }
  const ck = [CK.HULL, CK.BRONZE, CK.DECK, CK.HULL, CK.DECK, CK.HULL, CK.BRONZE, CK.HULL];
  let n = 0;
  for (const zc of [0, 24.5]) for (const x of [-5.1, 5.1]) for (const y of [-5.1, 5.1]) B.box(x, y, zc, 9.6, 9.6, 23, ck[n++]);
  // RCS pods on the block corners
  for (const x of [-8.6, 8.6]) for (const y of [-8.6, 8.6]) B.box(x * 0.72, y * 0.72, -33, 2.2, 2.2, 2.2, CK.DARK);
  const glows = [];
  for (const x of [-4.2, 4.2]) for (const y of [-4.2, 4.2]) bell(B, x, y, -36, 2.4, 4.2, glows, s);
  B.pop();
  const lamps = [
    { p: V(8.6, 0, -24).multiplyScalar(s), r: 0.6 * s, color: LAMP.RED, i: 3.2, dir: V(1, 0, 0.2) },
    { p: V(-8.6, 0, -24).multiplyScalar(s), r: 0.6 * s, color: LAMP.GREEN, i: 3.2, dir: V(-1, 0, 0.2) },
    { p: V(0, 5.6, -36.2).multiplyScalar(s), r: 0.6 * s, color: LAMP.WHITE, i: 2, dir: V(0, 0, -1) },
  ];
  for (const x of [-11, 11]) for (const y of [-11, 11]) lamps.push({ p: V(x, y, 37.8).multiplyScalar(s), r: 0.55 * s, color: LAMP.AMBER, i: 2.4, breathe: 0.3, phase: (x > 0 ? 0.25 : 0) + (y > 0 ? 0.5 : 0) });
  return { geo: B.geometry(), glows, lamps, length: len };
}

// ---------------------------------------------------------------- courier ----
export function buildCourier(len = 44) {
  const sk = buildSkiff();
  const k = len / sk.length;
  sk.geo.scale(k, k, k);
  sk.geo.computeBoundingSphere();
  const glows = sk.glows.map((g) => ({ p: g.p.clone().multiplyScalar(k), r: g.r * k, dir: g.dir }));
  const lamps = [
    { p: V(4.3, 0.2, -3.3).multiplyScalar(k), r: 0.12 * k, color: LAMP.RED, i: 3, dir: V(1, 0, 0.3) },
    { p: V(-4.3, 0.2, -3.3).multiplyScalar(k), r: 0.12 * k, color: LAMP.GREEN, i: 3, dir: V(-1, 0, 0.3) },
    { p: V(0, 0.5, -5.3).multiplyScalar(k), r: 0.1 * k, color: LAMP.WHITE, i: 2, dir: V(0, 0, -1) },
  ];
  return { geo: sk.geo, glows, lamps, length: len };
}

// -------------------------------------------------------------- freighter ----
export function buildFreighter(len = 1100) {
  const s = len / 1100;
  const B = new CB();
  B.push(new THREE.Matrix4().makeScale(s, s, s));
  // drive: bell, thrust structure, shadow shield
  lathe(B, [[0.1, -392, CK.DARK], [64, -392, CK.DARK], [66, -386, CK.BRONZE], [62, -380, CK.HULL], [34, -372, CK.HULL], [34, -300, CK.HULL], [40, -296, CK.BRONZE], [40, -290, CK.BRONZE], [26, -284, CK.HULL], [0.1, -284, CK.HULL]], 32);
  const glows = [];
  B.at(0, 0, -392);
  lathe(B, [[20, 0, CK.DARK], [22, -20, CK.BRONZE], [34, -60, CK.DARK], [52, -118, CK.DARK], [49, -121, CK.CONDUIT]], 32);
  B.pop();
  glows.push({ p: V(0, 0, -512).multiplyScalar(s), r: 44 * s, dir: V(0, 0, -1) });
  // cross radiators on booms: heat goes out edge-on to the drive, never back into the hull
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    B.push(new THREE.Matrix4().makeRotationZ(a));
    B.tube([V(30, 0, -330), V(80, 0, -330)], 4, 8, CK.DARK);
    B.box(170, 0, -250, 190, 3, 250, CK.RADIATOR);
    B.box(170, 0, -377, 194, 5, 5, CK.BRONZE);
    B.box(170, 0, -123, 194, 5, 5, CK.BRONZE);
    B.pop();
  }
  // spine: square truss
  for (const x of [-14, 14]) for (const y of [-14, 14]) B.tube([V(x, y, -284), V(x, y, 392)], 3, 6, CK.DARK);
  for (let z = -276; z < 390; z += 34) {
    B.tube([V(-14, -14, z), V(14, 14, z + 17)], 1.4, 4, CK.DARK);
    B.tube([V(14, -14, z + 17), V(-14, 14, z + 34)], 1.4, 4, CK.DARK);
  }
  // tank rings: six tanks round the spine at each station
  let st = 0;
  for (let z = -236; z <= 336; z += 82, st++) {
    B.box(0, 0, z - 38, 34, 34, 4, CK.BRONZE);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + (st % 2) * (Math.PI / 6);
      B.at(Math.cos(a) * 44, Math.sin(a) * 44, z);
      lathe(B, [[0.1, -36, CK.HULL], [12, -35, CK.HULL], [17, -30, CK.HULL], [17, -3, (k + st) % 3 === 0 ? CK.BRONZE : CK.HULL], [17, 3, CK.DECK], [17, 30, CK.HULL], [12, 35, CK.HULL], [0.1, 36, CK.HULL]], 18);
      B.pop();
    }
  }
  // bow: crew section with a gallery of windows and a docking collar
  lathe(B, [[0.1, 392, CK.HULL], [30, 392, CK.HULL], [36, 402, CK.BRONZE], [38, 410, CK.BRONZE], [38, 440, CK.GLASS], [40, 446, CK.LANTERN], [38, 452, CK.BRONZE], [38, 480, CK.GLASS], [30, 500, CK.HULL], [14, 518, CK.HULL], [9, 520, CK.BRONZE], [9, 528, CK.BRONZE], [0.1, 530, CK.DARK]], 32);
  // comms mast
  B.tube([V(0, 34, 420), V(0, 70, 420)], 1.2, 6, CK.DARK);
  B.pop();
  const lamps = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    const tip = V(Math.cos(a) * 266, Math.sin(a) * 266, -250).multiplyScalar(s);
    const col = Math.cos(a) > 0 ? LAMP.RED : LAMP.GREEN;
    lamps.push({ p: tip, r: 3 * s, color: col, i: 3.4, dir: V(Math.cos(a), Math.sin(a), 0) });
  }
  lamps.push({ p: V(0, 66, -390).multiplyScalar(s), r: 2.6 * s, color: LAMP.WHITE, i: 2.4, dir: V(0, 0, -1) });
  lamps.push({ p: V(0, 71, 420).multiplyScalar(s), r: 2.2 * s, color: LAMP.WHITE, i: 2.0, breathe: 0.3 });
  lamps.push({ p: V(0, 0, 531).multiplyScalar(s), r: 2.4 * s, color: LAMP.AMBER, i: 2.6, breathe: 0.35 });
  return { geo: B.geometry(), glows, lamps, length: len };
}

// ---------------------------------------------------------------- climber ----
/** Climber car, axis along local +Y (up the tether). Returns { geo, lamps, height }. */
export function buildClimber(scale = 1) {
  const B = new CB();
  B.push(new THREE.Matrix4().makeScale(scale, scale, scale));
  B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));       // local z -> +y
  // sleeve round the tether (the ribbon is ~30 m across)
  lathe(B, [[19, -74, CK.DARK], [19, 74, CK.DARK]], 24);
  // passenger stack: five glazed decks between bronze rims, domed ends
  const prof = [[19, -52, CK.HULL], [30, -50, CK.HULL], [40, -44, CK.HULL], [44, -38, CK.BRONZE], [44, -35, CK.BRONZE]];
  let z = -35;
  for (let d = 0; d < 5; d++) {
    prof.push([45, z + 1, CK.HULL], [45, z + 11, CK.GLASS], [46, z + 12, CK.LANTERN], [45, z + 13, CK.BRONZE], [45, z + 14, CK.HULL]);
    z += 14;
  }
  prof.push([44, z + 1, CK.BRONZE], [40, z + 7, CK.HULL], [30, z + 13, CK.HULL], [19, z + 15, CK.HULL]);
  lathe(B, prof, 36);
  // drive units: rollers gripping the tether above and below
  for (const zz of [-66, 66]) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      B.at(Math.cos(a) * 24, Math.sin(a) * 24, zz, 0, 0, a);
      B.box(0, 0, 0, 10, 12, 16, CK.BRONZE);
      B.box(3, 0, 0, 5, 14, 10, CK.DARK);
      B.pop();
    }
    B.at(0, 0, zz);
    lathe(B, [[19, -9, CK.HULL], [32, -6, CK.HULL], [32, 6, CK.HULL], [19, 9, CK.HULL]], 24);
    B.pop();
  }
  // beamed-power receiver skirt below the cabin, facing the ground station
  B.at(0, 0, -58);
  lathe(B, [[46, 0, CK.PANEL], [70, 5, CK.PANEL], [72, 5.5, CK.BRONZE], [72, 7, CK.BRONZE], [46, 2, CK.DARK]], 36);
  B.pop();
  B.pop(); B.pop();
  const lamps = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    lamps.push({ p: V(Math.cos(a) * 46, 38, Math.sin(a) * 46).multiplyScalar(scale), r: 1.6 * scale, color: LAMP.AMBER, i: 2.2, breathe: 0.25, phase: k / 6 });
    lamps.push({ p: V(Math.cos(a + 0.5) * 73, -64, Math.sin(a + 0.5) * 73).multiplyScalar(scale), r: 1.6 * scale, color: LAMP.WHITE, i: 1.6 });
  }
  return { geo: B.geometry(), lamps, height: 150 * scale };
}
