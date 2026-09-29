import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { LAMP } from './lamps.js';
import { DK } from './craftMesh.js';
import { rng, V, dockingCollar, radiatorWing, dish, truss } from './shipKit.js';

// THE LAGRANGE COLONIES: geometry (metres) for an Island-Three cylinder and its despun works.
//
// Frame: the cylinder's axis is local +Z and points at the Sun; x, y span its cross-section.
// The rotor turns about Z for gravity (8 km across: one turn in ~127 s gives 1 g at the land).
// Six 60-degree strips alternate land (centred on 0, 120, 240 degrees) and window (60, 180,
// 300). Sunlight arrives along the axis and is thrown in through the windows by three hinged
// mirrors, one over each window, hinged at the anti-sun rim and opened wider for the day.
//
//   rotor     land-strip hull (regolith shielding in plates), box longerons at every strip
//             edge with a lit conduit along the crest, hoop frames across land and window,
//             lengthwise mullions, the land strips' outer works (habitat blocks with lit
//             windows, radiator banks, tank farms, dishes, beacon masts), terraced end caps
//             whose glazed steps are the cap cities
//   windows   the glazing itself (a separate geometry: its shader shows the lit landscape)
//   mirror    one hinged mirror sheet (shader) and its back structure (craft kinds)
//   stator    the despun works on the axis: spindles and bearings; at the anti-sun end the
//             spaceport (docking wheel, berth arms, collars, the harbour hall) and the
//             zero-g industry with its radiators edge-on to the Sun; at the sunward end the
//             spindle that carries the agricultural rings and the power station
//   agri      one agricultural ring: glazed toroid with spokes and a bearing hub (it spins)
//   pairFrame the trusses that tie a counter-rotating pair together at both ends (their
//             spin angular momenta cancel, so the pair can be turned to follow the Sun)

export const COL = {
  R: 4000, HL: 16000, CAP: 1600,
  STRIP: Math.PI / 3,
  PAIR_X: 20000,                 // each cylinder's axis this far either side of the pair centre
  MIRROR_L: 32000, MIRROR_W: 4200, MIRROR_OFF: 120,
  MIRROR_MIN: THREE.MathUtils.degToRad(3), MIRROR_MAX: THREE.MathUtils.degToRad(20),
  SPIN: Math.sqrt(9.81 / 4000),  // rad/s
  AGRI_Z: [19870, 21270, 22670], AGRI_R: 2600, AGRI_T: 170, AGRI_SPIN: Math.sqrt(9.81 / 2600),
  PORT_Z: -19500, PORT_RING: 1400, BERTHS: 12, BERTH_R: 1950,
  SPINDLE_A: 320, SPINDLE_S: 250,
  TRUSS_Z: [-24800, 25200],
  ROTOR_MAX_R: 4000 + 260,
};

const TAU = Math.PI * 2;
const LAND_CENTRES = [0, 1, 2].map((i) => (i * TAU) / 3);
const WINDOW_CENTRES = LAND_CENTRES.map((a) => a + Math.PI / 3);

/** Push a frame at angle a, radius r, axial z: local x tangential, y radial (out), z along the axis. */
function radial(B, a, r, z) {
  const c = Math.cos(a), s = Math.sin(a);
  return B.push(new THREE.Matrix4().set(-s, c, 0, c * r, c, s, 0, s * r, 0, 0, 1, z, 0, 0, 0, 1));
}

/** A cylindrical patch (radius r, angles a0..a1, z0..z1) facing out (dir 1) or in (-1). */
function band(B, r, a0, a1, z0, z1, na, nz, k, dir = 1) {
  const base = B.pos.length / 3;
  for (let j = 0; j <= nz; j++) {
    const z = z0 + ((z1 - z0) * j) / nz;
    for (let i = 0; i <= na; i++) {
      const a = a0 + ((a1 - a0) * i) / na;
      B.v(Math.cos(a) * r, Math.sin(a) * r, z, a * r, z, typeof k === 'function' ? k(a, z) : k);
    }
  }
  const h = new THREE.Vector3();
  for (let j = 0; j < nz; j++) for (let i = 0; i < na; i++) {
    const a = base + j * (na + 1) + i, b = a + 1, c = a + na + 1, d = c + 1;
    const am = a0 + ((a1 - a0) * (i + 0.5)) / na;
    h.set(Math.cos(am) * dir, Math.sin(am) * dir, 0);
    B.tri(a, b, d, h); B.tri(a, d, c, h);
  }
}

/** An annular sector in the plane z (radii r0..r1, angles a0..a1), facing +z (dir 1) or -z. */
function ringSector(B, r0, r1, a0, a1, z, na, k, dir) {
  const base = B.pos.length / 3;
  for (let i = 0; i <= na; i++) {
    const a = a0 + ((a1 - a0) * i) / na, c = Math.cos(a), s = Math.sin(a);
    B.v(c * r0, s * r0, z, a * r0, r0, k);
    B.v(c * r1, s * r1, z, a * r1, r1, k);
  }
  const h = new THREE.Vector3(0, 0, dir);
  for (let i = 0; i < na; i++) { const a = base + i * 2; B.tri(a, a + 1, a + 3, h); B.tri(a, a + 3, a + 2, h); }
}

/** A closed curved beam: radii r0..r1, angles a0..a1, centred on z with axial width w. */
function arcBeam(B, r0, r1, a0, a1, z, w, na, k, kTop = k) {
  const z0 = z - w / 2, z1 = z + w / 2;
  band(B, r1, a0, a1, z0, z1, na, 1, kTop, 1);
  band(B, r0, a0, a1, z0, z1, na, 1, k, -1);
  ringSector(B, r0, r1, a0, a1, z1, na, k, 1);
  ringSector(B, r0, r1, a0, a1, z0, na, k, -1);
  for (const [a, sgn] of [[a0, -1], [a1, 1]]) {
    const c = Math.cos(a), s = Math.sin(a);
    const q = [[r0, z0], [r1, z0], [r1, z1], [r0, z1]].map(([r, zz]) => B.v(c * r, s * r, zz, r, zz, k));
    const h = new THREE.Vector3(-s * sgn, c * sgn, 0);
    B.tri(q[0], q[1], q[2], h); B.tri(q[0], q[2], q[3], h);
  }
}

/** Torus about local z with the kind chosen by the tube angle (0 = outward, PI/2 = +z). */
function torusK(B, R, r, segR, segT, kindFn, z = 0) {
  const base = B.pos.length / 3;
  for (let i = 0; i <= segR; i++) {
    const a = (i / segR) * TAU, c = Math.cos(a), s = Math.sin(a);
    for (let j = 0; j <= segT; j++) {
      const b = (j / segT) * TAU, rr = R + r * Math.cos(b);
      B.v(c * rr, s * rr, z + r * Math.sin(b), a * R, b * r, kindFn(b));
    }
  }
  const h = new THREE.Vector3();
  for (let i = 0; i < segR; i++) for (let j = 0; j < segT; j++) {
    const a = base + i * (segT + 1) + j, b = a + 1, c = a + segT + 1, d = c + 1;
    const am = ((i + 0.5) / segR) * TAU, bm = ((j + 0.5) / segT) * TAU;
    h.set(Math.cos(am) * Math.cos(bm), Math.sin(am) * Math.cos(bm), Math.sin(bm));
    B.tri(a, c, d, h); B.tri(a, d, b, h);
  }
}

/** A closed annular solid of revolution about z (no disc through the axis): profile [[r, z, kind], ...]. */
function ring(B, prof, seg) { B.lathe([...prof, prof[0]], seg, 0, { closedProfile: true }); }

/** Sphere tank at the builder's origin. */
function sphere(B, r, k, seg = 14, rings = 7) {
  const prof = [];
  for (let i = 0; i <= rings; i++) { const a = -Math.PI / 2 + (i / rings) * Math.PI; prof.push([Math.max(Math.cos(a) * r, 0.01), Math.sin(a) * r, i === rings >> 1 ? CK.BRONZE : k]); }
  B.lathe(prof, seg);
}

/**
 * The cap stair, rim to hub: [r, z past the hull's end, tread kind, riser kind, dome angle] per
 * step (step 0 is the rim). The corners lie on the ellipsoid r = (R + 60) cos t, rising to the
 * hub collar; treads are garden glazing, every fourth a plated service ring, the last three the
 * parkland and town roofs of the cap's centre; risers are terrace decks in rows of lit ports,
 * lit room glazing and plated service floors.
 */
export function capTerraces(n = 18) {
  const { R, CAP } = COL;
  const r0 = R + 60, z0 = 40, rHub = 560, zTop = CAP - 30;
  const tMax = Math.acos(rHub / r0), sMax = Math.sin(tMax);
  const out = [[r0, z0, CK.DECK, DK.GRIME, 0]];
  for (let i = 1; i <= n; i++) {
    const t = tMax * (i / n);
    const tread = i > n - 3 ? CK.ROOF : i % 4 === 0 ? DK.GRIME : CK.CONSERVATORY;
    const riser = i % 5 === 2 ? DK.GRIME : i % 5 === 4 ? CK.GLASS : DK.PORTS;
    out.push([r0 * Math.cos(t), z0 + (zTop - z0) * Math.sin(t) / sMax, tread, riser, t]);
  }
  return out;
}

const inLand = (a) => {
  const m = ((a % (TAU / 3)) + TAU / 3) % (TAU / 3);
  return m < Math.PI / 6 || m > TAU / 3 - Math.PI / 6;
};

// ------------------------------------------------------------------ rotor ----
/** The spinning cylinder in craft kinds. Returns { geo, lamps, modules } (metres, rotor frame). */
export function buildRotor(seed = 7) {
  const { R, HL, CAP } = COL;
  const B = new CB();
  const r = rng(seed);
  const lamps = [];
  const tiles = [], works = [];      // (the tiles' tops and the works' footprints: where the near detail may stand)
  const dA = 70 / R;                         // longeron half-width, as an angle
  // land strips: the shielding hull, in long panels that alternate plate and darker slag
  for (const c of LAND_CENTRES) {
    band(B, R, c - Math.PI / 6 + dA, c + Math.PI / 6 - dA, -HL, HL, 18, 64, (a, z) => { const b = Math.floor((z + HL) / 2000) % 5; return b === 3 ? CK.DARK : b === 1 ? DK.LIVERY : DK.GRIME; });
    // hoop frames every kilometre, crowned with deck plating
    for (let z = -HL + 500; z < HL; z += 1000) arcBeam(B, R - 5, R + 42, c - Math.PI / 6 + dA, c + Math.PI / 6 - dA, z, 56, 16, DK.GRIME, CK.DECK);
    // the shielding mosaic: each kilometre bay between hoops has its own programme of tiles
    // (lit outer decks, plated shield blocks of two tones, solar skirts, radiator beds, hull
    // greenhouses), three rows along and fourteen across, so the hull reads in bays from
    // a hundred kilometres and in tiles from ten
    const span = Math.PI / 3 - 2 * dA - 0.004, across = 14, tileA = span / across;
    const tileW = tileA * R - 16;
    for (let bay = 0; bay < 31; bay++) {
      const zc = -HL + 1000 + bay * 1000;
      const prog = r();
      for (let row = 0; row < 3; row++) for (let q = 0; q < across; q++) {
        const h = r();
        if (h < 0.08) continue;                                    // bare hull: a service apron
        const a = c - span / 2 + (q + 0.5) * tileA;
        const z = zc + (row - 1) * 314;
        let k = DK.GRIME, ht = 4 + 8 * r();
        if (prog < 0.3) { k = (q + row) % 5 === 2 ? CK.DECK : CK.GLASS; ht = 10 + 6 * r(); }
        else if (prog < 0.62) k = h < 0.3 ? DK.GRIME : h < 0.55 ? DK.LIVERY : CK.DARK;
        else if (prog < 0.77) { k = CK.PANEL; ht = 3; }
        else if (prog < 0.88) { k = CK.RADIATOR; ht = 5; }
        else { k = (q % 3 === 1) ? CK.DECK : CK.CONSERVATORY; ht = 12; }
        radial(B, a, R, z);
        B.box(0, (ht - 4) / 2, 0, tileW, ht + 4, 290, k);
        tiles.push({ a, z, top: ht, w: tileW, l: 290 });
        B.pop();
      }
    }
    // outer works between the hoops
    for (let bay = 0; bay < 31; bay++) {
      const zc = -HL + 1000 + bay * 1000;
      const n = 3 + Math.floor(r() * 4);
      for (let q = 0; q < n; q++) {
        const a = c + (r() - 0.5) * (Math.PI / 3 - 0.09);
        const z = zc + (r() - 0.5) * 600;
        const type = r();
        works.push({ a, z, rad: type < 0.8 ? 300 : 40 });
        radial(B, a, R, z);
        if (type < 0.34) {
          // habitat block: lit decks under a plated roof, a lantern stair tower at one end
          const w = 90 + r() * 180, l = 140 + r() * 260, h = 28 + r() * 60;
          B.box(0, h / 2, 0, w, h, l, CK.GLASS);
          B.box(0, h + 4, 0, w + 8, 8, l + 8, DK.GRIME);
          B.box(w / 2 + 8, (h + 18) / 2, l / 2 - 14, 16, h + 18, 16, CK.LANTERN);
          lamps.push({ p: V(w / 2 + 8, h + 20, l / 2 - 14).applyMatrix4(B.M), r: 6, color: LAMP.AMBER, i: 2.4, breathe: 0.3 });
        } else if (type < 0.52) {
          // radiator bank: fins standing radially, edge-on to the Sun, on a manifold sill
          const nf = 3 + Math.floor(r() * 4), l = 260 + r() * 300;
          B.box(0, 6, 0, nf * 26 + 20, 12, l + 20, CK.BRONZE);
          for (let f = 0; f < nf; f++) B.box((f - (nf - 1) / 2) * 26, 12 + 60, 0, 5, 120, l, CK.RADIATOR);
        } else if (type < 0.68) {
          // tank farm: spheres on a deck, piped to a pump house
          B.box(0, 3, 0, 170, 6, 170, CK.DECK);
          for (let t = 0; t < 4; t++) { B.at((t % 2 - 0.5) * 80, 36, (Math.floor(t / 2) - 0.5) * 80); sphere(B, 32, DK.FOIL); B.pop(); }
          B.box(0, 14, 0, 30, 22, 30, CK.DARK);
        } else if (type < 0.8) {
          // photovoltaic skirt on low trestles
          B.box(0, 10, 0, 220, 4, 360, CK.PANEL);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(sx * 100, 5, sz * 170, 6, 10, 6, CK.DARK);
        } else if (type < 0.9) {
          // relay dish on a plinth
          B.box(0, 10, 0, 50, 20, 50, DK.GRIME);
          dish(B, V(0, 20, 0), V(r() - 0.5, 1, r() - 0.5), 34);
        } else {
          // beacon mast
          B.box(0, 70, 0, 8, 140, 8, CK.DARK);
          B.box(0, 142, 0, 16, 8, 16, CK.LANTERN);
          lamps.push({ p: V(0, 150, 0).applyMatrix4(B.M), r: 10, color: q % 2 ? LAMP.RED : LAMP.WHITE, i: 3.6, breathe: 0.6 });
        }
        B.pop();
      }
    }
  }
  // windows: hoops every 800 m and two lengthwise mullions
  for (const c of WINDOW_CENTRES) {
    const a0 = c - Math.PI / 6 + dA, a1 = c + Math.PI / 6 - dA;
    for (let z = -HL + 800; z < HL - 100; z += 800) arcBeam(B, R - 18, R + 32, a0, a1, z, 24, 14, CK.DARK, CK.BRONZE);
    for (const f of [-1, 1]) {
      radial(B, c + f * (Math.PI / 18), R, 0);
      B.box(0, 6, 0, 18, 42, 2 * HL, CK.DARK);
      B.pop();
    }
  }
  // longerons along every strip edge: box girders with a lit conduit on the crest
  for (let e = 0; e < 6; e++) {
    const a = Math.PI / 6 + (e * TAU) / 6;
    radial(B, a, R, 0);
    B.box(0, 50, 0, 140, 180, 2 * HL, CK.BRONZE);
    B.box(0, 144, 0, 40, 8, 2 * HL - 400, CK.CONDUIT);
    for (let z = -HL + 1000; z < HL; z += 2000) lamps.push({ p: V(0, 152, z).applyMatrix4(B.M), r: 14, color: e % 2 ? LAMP.TEAL : LAMP.WHITE, i: 2.2, phase: (z + HL) / (2 * HL), breathe: 0.5 });
    B.pop();
  }
  // end caps: the cap cities, a stair of terraces on a dome (the cap's air load wants an
  // ellipsoid: radius R cos(t), rise CAP sin(t)). Each step is a riser, the outward face of a
  // terrace block (apartment decks in rows of lit ports, plated where the terrace carries
  // services), and a tread, the glazed garden roof of the terrace below. Near the rim the
  // risers are tall and the treads narrow; toward the hub the treads open into the parkland
  // and town roofs of the cap's centre. The sunward cap looks straight at the Sun: its lit
  // faces are the dark garden glazing, the pale risers stand edge-on, so the cap reads as
  // rings of green, warm window light and plate, never one white disc.
  const capSteps = capTerraces();
  const CAP_R0 = R + 60, CAP_Z0 = 40;
  for (const s of [-1, 1]) {
    const zs = (z) => s * (HL + z);
    // the skirt where the cap meets the hull, and its ring girder
    // (bands, not a lathe: an open lathe profile closes itself with discs through the axis)
    band(B, CAP_R0, 0, TAU, zs(-30), zs(0), 128, 1, CK.BRONZE, 1);
    band(B, CAP_R0, 0, TAU, zs(0), zs(CAP_Z0), 128, 1, DK.GRIME, 1);
    // the stair: riser i at radius r(i-1) from z(i-1) to z(i), then tread i at z(i) from r(i-1) in to r(i)
    for (let i = 1; i < capSteps.length; i++) {
      const [r0, z0] = capSteps[i - 1], [r1, z1, tread, riser] = capSteps[i];
      const na = Math.max(48, Math.min(192, Math.round(r0 / 24)));
      band(B, r0, 0, TAU, zs(z0), zs(z1), na, 1, riser, 1);
      ringSector(B, r1, r0, 0, TAU, zs(z1), na, tread, s);
      // parapet along the tread's outer edge (a bronze coping that catches the light)
      if (i < capSteps.length - 1) band(B, r0 + 4, 0, TAU, zs(z1), zs(z1 + 10), na, 1, CK.BRONZE, 1);
      // piers down every third riser: the terrace blocks' party walls, a rhythm that reads from
      // tens of km as ticks round the ring
      if (i % 3 === 1 && z1 - z0 > 60) {
        const np = Math.round((TAU * r0) / 420);
        for (let k = 0; k < np; k++) {
          const a = ((k + 0.5) / np) * TAU;
          radial(B, a, r0, zs((z0 + z1) / 2));
          B.box(0, 7, 0, 34, 14, z1 - z0 - 6, (k % 4 === 0) ? CK.LANTERN : CK.BRONZE);
          B.pop();
        }
      }
    }
    // the hub collar the stator's bearing faces
    const [rh, zh] = capSteps[capSteps.length - 1];
    band(B, rh, 0, TAU, zs(zh), zs(CAP), 64, 1, CK.DARK, 1);
    ringSector(B, 520, rh, 0, TAU, zs(CAP), 64, CK.DARK, s);
    band(B, 520, 0, TAU, zs(CAP), zs(CAP + 50), 64, 1, CK.BRONZE, 1);
    ringSector(B, 1, 520, 0, TAU, zs(CAP + 50), 64, CK.DARK, s);
    // corner points of the stair (the treads' outer edges), pushed off the dome by d
    const corner = (i, d) => {
      const [r0] = capSteps[Math.max(i - 1, 0)], [, z1] = capSteps[i];
      const t = capSteps[i][4], nr = CAP * Math.cos(t), nz = R * Math.sin(t), l = Math.hypot(nr, nz) || 1;
      return [r0 + (nr / l) * d, z1 + (nz / l) * d];
    };
    const path = (a, d) => {
      const c = Math.cos(a), sn = Math.sin(a), pts = [];
      for (let i = 1; i < capSteps.length - 2; i += 1) { const [rr, zz] = corner(i, d); pts.push(V(c * rr, sn * rr, zs(zz))); }
      return pts;
    };
    // twelve lit boulevards radiating down the terraces from the hub to the rim
    for (let k = 0; k < 12; k++) B.tube(path((k / 12) * TAU + Math.PI / 12, 16), 9, 6, CK.CONDUIT);
    // six buttress girders over the longerons' ends (the cap's air load goes into them), with
    // their lamps, and the ring girder at the rim: the structure that reads from tens of km
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * TAU) / 6, c = Math.cos(a), sn = Math.sin(a);
      B.tube(path(a, 74), 52, 6, CK.BRONZE);
      for (let j = 2; j < capSteps.length - 1; j += 3) {
        const [r0, z0] = corner(j, 140);
        lamps.push({ p: V(c * r0, sn * r0, zs(z0)), r: 12, color: LAMP.WHITE, i: 2.6, breathe: 0.5, phase: j / capSteps.length });
      }
    }
    { const [rg, zg] = corner(2, 40); B.push(new THREE.Matrix4().makeTranslation(0, 0, zs(zg))); B.torus(rg, 46, 192, 8, CK.BRONZE); B.pop(); }
    // promenade lamps along every second parapet, and the rim's ring of beacons
    for (let i = 2; i < capSteps.length - 1; i += 2) {
      const [r0] = capSteps[i - 1], [, z1] = capSteps[i], n = Math.max(12, Math.round(r0 / 220));
      for (let k = 0; k < n; k++) { const a = ((k + 0.5 * (i % 4 === 0)) / n) * TAU; lamps.push({ p: V(Math.cos(a) * (r0 + 6), Math.sin(a) * (r0 + 6), zs(z1 + 16)), r: 9, color: LAMP.AMBER, i: 2.2, breathe: 0.25, phase: (k * 0.618) % 1 }); }
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      lamps.push({ p: V(Math.cos(a) * (R + 70), Math.sin(a) * (R + 70), s * (HL + 10)), r: 18, color: i % 6 === 0 ? LAMP.RED : LAMP.WHITE, i: 3.0, breathe: 0.4, phase: i / 24 });
    }
  }
  return { geo: B.geometry(), lamps, tiles, works };
}

// ---------------------------------------------------------------- windows ----
/** The glazing: three strips, with aWin = (arc from the strip's centre m, z m, strip). */
export function buildWindows(na = 24, nz = 80) {
  const { R, HL } = COL;
  const dA = 70 / R;
  const pos = [], nrm = [], win = [], idx = [];
  WINDOW_CENTRES.forEach((c, s) => {
    const base = pos.length / 3;
    const a0 = c - Math.PI / 6 + dA, a1 = c + Math.PI / 6 - dA;
    for (let j = 0; j <= nz; j++) {
      const z = -HL + (2 * HL * j) / nz;
      for (let i = 0; i <= na; i++) {
        const a = a0 + ((a1 - a0) * i) / na;
        pos.push(Math.cos(a) * R, Math.sin(a) * R, z);
        nrm.push(Math.cos(a), Math.sin(a), 0);
        win.push((a - c) * R, z, s);
      }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < na; i++) {
      const a = base + j * (na + 1) + i, b = a + 1, cc = a + na + 1, d = cc + 1;
      idx.push(a, b, d, a, d, cc);         // counter-clockwise seen from outside
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aWin', new THREE.Float32BufferAttribute(win, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ----------------------------------------------------------------- mirror ----
/**
 * One mirror, hinged at the local origin along x; the sheet runs along +z and its reflective
 * face looks down -y (at the glazing). Returns { sheet, back } (shader sheet, craft structure).
 */
export function buildMirror() {
  const { MIRROR_L: L, MIRROR_W: W } = COL;
  const nx = 6, nz = 48;
  const pos = [], nrm = [], uv = [], idx = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = -W / 2 + (W * i) / nx, z = (L * j) / nz;
    pos.push(x, 0, z); nrm.push(0, -1, 0); uv.push(x, z);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);            // front face toward -y
  }
  const sheet = new THREE.BufferGeometry();
  sheet.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sheet.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  sheet.setAttribute('aMir', new THREE.Float32BufferAttribute(uv, 2));
  sheet.setIndex(idx);
  sheet.computeBoundingSphere();
  // back structure: hinge barrel, three spars tapering to the tip, cross ribs, a tip frame
  const B = new CB();
  B.push(new THREE.Matrix4().makeRotationY(Math.PI / 2));
  B.tube([V(0, 40, -W / 2 - 60), V(0, 40, W / 2 + 60)], 50, 12, CK.BRONZE);
  B.pop();
  for (const x of [-W / 2 + 40, 0, W / 2 - 40]) B.tube([V(x, 30, 0), V(x, 24, L * 0.5), V(x, 14, L)], (t) => 34 - 18 * t, 6, CK.DARK);
  for (let z = 1600; z < L; z += 1600) B.box(0, 14, z, W, 22, 24, DK.HAZARD);
  B.box(0, 12, L - 10, W + 40, 26, 30, CK.BRONZE);
  return { sheet, back: B.geometry() };
}

// ----------------------------------------------------------------- stator ----
/** Despun works on one cylinder's axis. Returns { geo, lamps, berths: [{ p, dir }] }. */
export function buildStator(seed = 3) {
  const { HL, CAP, SPINDLE_A: rA, SPINDLE_S: rS, PORT_Z: zP, PORT_RING: rP, BERTHS, BERTH_R } = COL;
  const B = new CB();
  const r = rng(seed);
  const lamps = [];
  const zA0 = -(HL + CAP + 120), zS0 = HL + CAP + 120;
  // bearings: the stator's half of each spin bearing, just clear of the cap collars
  for (const s of [-1, 1]) { B.at(0, 0, s * (HL + CAP + 110)); B.torus(460, 55, 64, 10, CK.BRONZE); B.pop(); }
  // anti-sun spindle: banded, a glazed concourse where the port meets it
  const spA = [[rA, zA0, CK.BRONZE]];
  for (let z = zA0 - 400; z > COL.TRUSS_Z[0] + 200; z -= 600) spA.push([rA, z + 60, CK.HULL], [rA + 40, z + 30, CK.BRONZE], [rA + 40, z - 30, CK.BRONZE], [rA, z - 60, CK.HULL]);
  spA.push([rA, COL.TRUSS_Z[0] - 150, CK.DARK]);
  B.lathe(spA.slice().reverse(), 32);
  B.at(0, 0, zP); ring(B, [[rA + 10, -260, DK.GRIME], [rA + 140, -200, CK.GLASS], [rA + 140, 200, CK.GLASS], [rA + 10, 260, DK.GRIME]], 40); B.pop();
  // the docking wheel: rim, spokes, berth arms with collars; approach lights in strings
  B.at(0, 0, zP); B.torus(rP, 90, 96, 12, DK.PORTS); B.pop();
  for (const s of [-1, 1]) { B.at(0, 0, zP + s * 96); B.torus(rP, 10, 96, 5, CK.BRONZE); B.pop(); }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.26;
    B.tube([V(Math.cos(a) * (rA + 130), Math.sin(a) * (rA + 130), zP), V(Math.cos(a) * (rP - 80), Math.sin(a) * (rP - 80), zP)], 34, 8, CK.DARK);
  }
  const berths = [];
  for (let i = 0; i < BERTHS; i++) {
    const a = (i / BERTHS) * TAU;
    const c = Math.cos(a), s = Math.sin(a);
    radial(B, a, rP + 60, zP);
    B.box(0, (BERTH_R - rP - 60) / 2, 0, 46, BERTH_R - rP - 60, 40, CK.DECK);
    B.box(0, (BERTH_R - rP - 60) / 2, 22, 30, BERTH_R - rP - 90, 6, CK.GLASS);        // the gallery along the arm
    B.box(0, 60, 0, 90, 60, 90, DK.LIVERY);                                             // arm root airlock house
    B.pop();
    // the berth faces -z (ships arrive from the anti-sun side)
    const p = V(c * BERTH_R, s * BERTH_R, zP - 24);
    B.push(new THREE.Matrix4().makeRotationX(Math.PI).setPosition(p));
    const dc = dockingCollar(B, 16);
    B.pop();
    for (const l of dc.lamps) lamps.push(l);
    berths.push({ p, dir: V(0, 0, -1), a });
    // lead-in lights either side of the collar face (a string of lamps hanging in empty space read as a gizmo)
    for (const x of [-24, 24]) lamps.push({ p: V(c * BERTH_R - s * x, s * BERTH_R + c * x, zP - 30), r: 6, color: i % 3 ? LAMP.AMBER : LAMP.GREEN, i: 2.6, phase: i / BERTHS, breathe: 0.8 });
  }
  // the harbour hall: a drum of hangar decks with a dark door ring
  B.at(0, 0, zP - 1500);
  B.lathe([[rA + 10, 450, DK.GRIME], [700, 380, DK.LIVERY], [720, 300, CK.BRONZE], [720, 150, CK.GLASS], [720, -150, CK.GLASS], [720, -300, CK.BRONZE], [700, -380, CK.DARK], [rA + 10, -450, CK.DARK]], 48);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; lamps.push({ p: V(Math.cos(a) * 740, Math.sin(a) * 740, -390), r: 12, color: LAMP.WHITE, i: 2.4 }); }
  B.pop();
  // industry: factory blocks, smelter spheres on trusses, radiators edge-on to the Sun
  const zI = zP - 3200;
  for (let i = 0; i < 14; i++) {
    const a = r() * TAU, rr = rA + 120 + r() * 700, z = zI + (r() - 0.5) * 1400;
    radial(B, a, rr, z);
    const w = 120 + r() * 220, h = 80 + r() * 160, l = 150 + r() * 300;
    const k = r() < 0.4 ? CK.GLASS : r() < 0.6 ? CK.PANEL : r() < 0.5 ? DK.GRIME : DK.PORTS;
    B.box(0, 0, 0, w, h, l, k);
    B.box(0, h / 2 + 6, 0, w * 0.6, 12, l * 0.8, CK.DARK);
    B.box(0, -rr / 2 + rA / 2, 0, 24, rr - rA + h * 0.1, 24, CK.DARK);                 // strut to the spindle
    B.pop();
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    B.at(Math.cos(a) * 900, Math.sin(a) * 900, zI - 300); sphere(B, 150, DK.FOIL, 20, 10); B.pop();
    truss(B, V(Math.cos(a) * (rA + 10), Math.sin(a) * (rA + 10), zI - 300), V(Math.cos(a) * 760, Math.sin(a) * 760, zI - 300), 40, 80, 3, CK.DARK);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const out = V(Math.cos(a), Math.sin(a), 0), n = V(-Math.sin(a), Math.cos(a), 0);
    radiatorWing(B, out.clone().multiplyScalar(rA + 20).setZ(zI + 900), out, n, 2200, 520, lamps, LAMP.RED);
  }
  // sunward spindle and the power station at its tip
  const zT = COL.TRUSS_Z[1];
  const spS = [[rS, zS0, CK.BRONZE]];
  for (let z = zS0 + 400; z < zT - 400; z += 700) spS.push([rS, z - 50, CK.HULL], [rS + 30, z - 25, CK.BRONZE], [rS + 30, z + 25, CK.BRONZE], [rS, z + 50, CK.HULL]);
  spS.push([rS, zT + 150, CK.DARK]);
  B.lathe(spS, 32);
  B.at(0, 0, 24400);
  ring(B, [[rS + 20, -60, CK.DARK], [1700, -40, CK.DARK], [1700, 0, CK.PANEL], [rS + 20, 20, CK.PANEL]], 72);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; B.tube([V(Math.cos(a) * (rS + 30), Math.sin(a) * (rS + 30), -300), V(Math.cos(a) * 1650, Math.sin(a) * 1650, -50)], 16, 6, CK.BRONZE); }
  B.at(0, 0, 60); B.lathe([[rS + 30, -40, CK.BRONZE], [rS + 90, 40, CK.LANTERN], [0.1, 110, CK.LANTERN]], 24); B.pop();
  B.pop();
  lamps.push({ p: V(0, 0, 24560), r: 60, color: LAMP.WHITE, i: 4, breathe: 0.2 });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; lamps.push({ p: V(Math.cos(a) * 1710, Math.sin(a) * 1710, 24380), r: 16, color: i % 3 ? LAMP.WHITE : LAMP.RED, i: 3, phase: i / 12, breathe: 0.6 }); }
  return { geo: B.geometry(), lamps, berths };
}

// ------------------------------------------------------------------- agri ----
/** One agricultural ring (axis z, centred on the origin): glazed on its sunward side. */
export function buildAgriRing() {
  const { AGRI_R: R, AGRI_T: t, SPINDLE_S } = COL;
  const B = new CB();
  const lamps = [];
  torusK(B, R, t, 160, 18, (b) => {
    const cz = Math.sin(b), cr = Math.cos(b);
    if (cz > 0.3) return CK.CONSERVATORY;          // the sunward glazing over the fields
    if (cr > 0.55) return CK.GLASS;                // the outer rim: the farm towns
    return DK.GRIME;
  });
  for (const s of [-1, 1]) torusK(B, R, 7, 160, 5, () => CK.BRONZE, s * (t + 14));
  B.torus(R + t + 6, 8, 160, 5, CK.BRONZE);
  // hub (clear of the spindle) and spokes
  ring(B, [[SPINDLE_S + 12, -70, CK.BRONZE], [SPINDLE_S + 70, -50, DK.LIVERY], [SPINDLE_S + 70, 50, DK.LIVERY], [SPINDLE_S + 12, 70, CK.BRONZE]], 32);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const c = Math.cos(a), s = Math.sin(a);
    B.tube([V(c * (SPINDLE_S + 60), s * (SPINDLE_S + 60), 0), V(c * (R - t + 10), s * (R - t + 10), 0)], 20, 8, DK.LIVERY);
    B.tube([V(c * (SPINDLE_S + 60), s * (SPINDLE_S + 60), 26), V(c * (R - t + 10), s * (R - t + 10), 26)], 6, 5, CK.CONDUIT);
  }
  for (let i = 0; i < 32; i++) { const a = (i / 32) * TAU; lamps.push({ p: V(Math.cos(a) * (R + t + 18), Math.sin(a) * (R + t + 18), 0), r: 10, color: i % 8 ? LAMP.WHITE : LAMP.GREEN, i: 2.6, phase: i / 32, breathe: 0.4 }); }
  return { geo: B.geometry(), lamps };
}

// ------------------------------------------------------------- pair frame ----
/** The trusses tying the two cylinders together (pair frame: cylinders at x = +-PAIR_X). */
export function buildPairFrame() {
  const B = new CB();
  const lamps = [];
  const X = COL.PAIR_X, h = 120;
  for (const z of COL.TRUSS_Z) {
    const x0 = -X + COL.SPINDLE_A + 60, x1 = X - COL.SPINDLE_A - 60;
    const tri = [V(0, h, 0), V(-h * 0.87, -h * 0.5, 0), V(h * 0.87, -h * 0.5, 0)];
    for (const c of tri) B.tube([V(x0, c.y, z + c.x), V(x1, c.y, z + c.x)], 16, 6, CK.BRONZE);
    const bays = Math.round((x1 - x0) / 500);
    for (let i = 0; i <= bays; i++) {
      const x = x0 + ((x1 - x0) * i) / bays, xn = x0 + ((x1 - x0) * (i + 1)) / bays;
      for (let k = 0; k < 3; k++) {
        const a = tri[k], b = tri[(k + 1) % 3];
        B.tube([V(x, a.y, z + a.x), V(x, b.y, z + b.x)], 7, 4, CK.DARK);
        if (i < bays) B.tube([V(x, a.y, z + a.x), V(xn, b.y, z + b.x)], 5, 4, CK.DARK);
      }
      if (i % 4 === 0) lamps.push({ p: V(x, h + 20, z), r: 14, color: i % 8 ? LAMP.AMBER : LAMP.RED, i: 2.6, phase: i / bays, breathe: 0.7 });
    }
    // the transit tube between the twins, glazed, with its cars' lit windows
    B.push(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    B.tube([V(-z, 0, x0), V(-z, 0, x1)], 34, 12, CK.GLASS);
    B.pop();
    // saddles where the truss meets each spindle
    for (const s of [-1, 1]) { B.at(s * X, 0, z); ring(B, [[COL.SPINDLE_A + 5, -180, CK.BRONZE], [COL.SPINDLE_A + 160, -120, CK.HULL], [COL.SPINDLE_A + 160, 120, CK.HULL], [COL.SPINDLE_A + 5, 180, CK.BRONZE]], 32); B.pop(); }
  }
  return { geo: B.geometry(), lamps };
}

export { inLand, LAND_CENTRES, WINDOW_CENTRES };
