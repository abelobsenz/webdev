import * as THREE from 'three';
import { CB, CK, TAU, V, lerp, rng, here, hereDir, atAim, tank, sphereTank, rcsQuad, dockingCollar, truss, catwalk, radiatorWing, dish, mast, container, flood } from './shipKit.js';
import { sectionEllipse } from '../craft/craftGeometry.js';
import { DK } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { design } from './shipDesigns.js';

// THE BELT'S STATIONS: the geostationary arc's working platforms, each generated from a seed
// (metres; station frame: +y radial, away from the Earth; +x west along the arc; +z north).
//
//   comms       signal platform: an octagonal equipment bus in decks, slewing dishes on booms,
//               an antenna farm, photovoltaic wings, a crew can with its ports lit
//   habitat     wheel town: a spinning rim of homes (floor plate outward, concourse glazing
//               looking in, ports down the sides) on spokes round a despun hub with docks at
//               both poles, radiators and wings on the hub's ends
//   depot       propellant depot: a spine truss carrying banded tank clusters under gold foil,
//               pump houses, catwalks with railings, tanker berths on arms
//   shipyard    slipway: portal frames round a hull being plated, crane bridges running the
//               frame, welding lights, a floodlit stock yard and the crews' lit block
//   relay       power relay: a cross of photovoltaic blankets turning to face the Sun, and a
//               phased-array emitter facing the Earth that beams the power down
//   transit     way station: a lit concourse drum with radial docking arms, a control tower
//               and a lantern signal ring
//   farm        garden cylinder: a spinning drum of glazed field strips on a despun spine,
//               mirrors at its ends, heat radiators
//   science     observatory: a telescope tube behind layered gold sunshields, an instrument
//               ring, a crew can and dishes
//
// Each builder returns { geo, parts: [{ geo, pivot, q, rate, mode, lamps }], lamps, docks:
// [{ p, d }], radius, tris }. parts spin (mode 'spin', rate rad/s about the pivot's +z), slew
// (mode 'slew', amplitude rate) or track the Sun (mode 'sun'); docks are berth faces (p) with
// their clear approach axes (d, outward).

const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1);
const TO_Y = new THREE.Matrix4().makeRotationX(-Math.PI / 2);        // lathe z -> +y
const TO_X = new THREE.Matrix4().makeRotationY(Math.PI / 2);         // lathe z -> +x
const G = 9.81;

/** Working context of one station build. */
class Ctx {
  constructor(seed, livery) {
    this.r = rng(seed * 2654435 + 97);
    this.B = new CB();
    this.lamps = [];
    this.docks = [];
    this.parts = [];
    this.walks = [];      // crews walk these: { a, b, up } (deck surface)
    this.welds = [];      // welding arcs
    this.moored = [];     // ships held by the station: { cls, seed, pos, fwd, up } (hulls drawn by GeoBelt)
    this.livery = livery;
  }
  /** A moving part in its own builder: build(Bp, lamps) in the pivot frame. */
  part(pivot, q, mode, rate, build, extra = {}) {
    const Bp = new CB();
    const lamps = [];
    build(Bp, lamps);
    const geo = Bp.geometry();
    this.parts.push({ geo, pivot: pivot.clone(), q: q.clone(), mode, rate, lamps, ...extra });
    return geo;
  }
  beacon(p, color = LAMP.RED, r = 3, i = 5, phase = 0) {
    this.lamps.push({ p: p.clone(), r, color, i, breathe: 1, phase });
  }
  glow(p, color = LAMP.WHITE, r = 1.5, i = 2.4) {
    this.lamps.push({ p: p.clone(), r, color, i });
  }
}

// ---------------------------------------------------------------- the kit ----
/** Pressurised can along dir, centred at p: domed ends, bands of ports and livery, joint rings. */
function can(c, p, dir, r, len, { ports = true, seg = 20, ends = true } = {}) {
  const B = c.B;
  atAim(B, p, dir);
  const h = len / 2;
  const n = Math.max(2, Math.round(len / 14));
  const prof = [[0.02, -h - r * 0.45, CK.HULL], [r * 0.55, -h - r * 0.32, CK.HULL], [r * 0.9, -h - r * 0.08, CK.HULL], [r, -h, CK.BRONZE]];
  for (let i = 0; i < n; i++) {
    const z0 = -h + (len * i) / n, z1 = -h + (len * (i + 1)) / n;
    const body = ports && i % 2 === 0 ? DK.PORTS : DK.LIVERY;
    prof.push([r, z0 + 0.6, CK.BRONZE], [r * 1.03, z0 + 0.6, CK.BRONZE], [r * 1.03, z0 + 1.4, CK.DARK], [r, z0 + 1.4, CK.DARK], [r, z1 - 0.1, body]);
  }
  prof.push([r, h, CK.HULL], [r * 0.9, h + r * 0.08, CK.BRONZE], [r * 0.55, h + r * 0.32, CK.HULL], [0.02, h + r * 0.45, CK.HULL]);
  B.lathe(prof, seg);
  if (ends) for (const s of [-1, 1]) B.box(0, 0, s * (h + r * 0.44), r * 0.5, r * 0.5, 0.3, CK.DARK);  // end hatches
  B.pop();
}

/** Berth: a neck out along dir from p, a hazard apron, the docking collar; records the dock. */
function berth(c, p, dir, r = 2.6, neck = 6) {
  const B = c.B;
  const d = dir.clone().normalize();
  atAim(B, p, d);
  B.lathe([[r * 0.8, 0, CK.HULL], [r * 0.8, neck * 0.5, DK.LIVERY], [r * 0.8, neck, CK.HULL]], 14);
  // the apron: a flat hazard-striped disc round the collar's base
  B.lathe([[r * 3.2, neck - 0.3, CK.DARK], [r * 3.2, neck, DK.HAZARD], [r * 0.9, neck, DK.HAZARD], [r * 0.9, neck - 0.3, CK.DARK]], 24, 0, { closedProfile: false });
  B.at(0, 0, neck + r * 0.6);
  const col = dockingCollar(B, r);
  B.pop();
  // approach lights at the apron's rim: red to port of the axis, green to starboard, white over
  c.lamps.push(...col.lamps);
  c.lamps.push({ p: here(B, r * 3.3, 0, neck + 0.2), r: r * 0.35, color: LAMP.RED, i: 3.2, dir: hereDir(B, 0, 0, 1), breathe: 0.2 });
  c.lamps.push({ p: here(B, -r * 3.3, 0, neck + 0.2), r: r * 0.35, color: LAMP.GREEN, i: 3.2, dir: hereDir(B, 0, 0, 1), breathe: 0.2 });
  c.lamps.push({ p: here(B, 0, r * 3.3, neck + 0.2), r: r * 0.3, color: LAMP.WHITE, i: 3, dir: hereDir(B, 0, 0, 1), breathe: 1, phase: c.docks.length * 0.23 });
  c.docks.push({ p: here(B, 0, 0, neck + r * 0.95), d: d.clone() });
  B.pop();
}

/** Photovoltaic wing from p along out (panel face normal n): a spar and blankets in bays. */
function pvWing(c, p, out, n, span, chord, bays = 0) {
  const B = c.B;
  const Xa = out.clone().normalize();
  const Ya = n.clone().addScaledVector(Xa, -n.dot(Xa)).normalize();
  const Za = V().crossVectors(Xa, Ya);
  B.push(new THREE.Matrix4().makeBasis(Xa, Ya, Za).setPosition(p));
  const nb = bays || Math.max(2, Math.round(span / (chord * 0.8)));
  B.tube([V(0, 0, 0), V(span, 0, 0)], Math.max(0.4, chord * 0.015), 6, CK.DARK);
  for (let i = 0; i < nb; i++) {
    const x0 = (span * i) / nb + chord * 0.04, x1 = (span * (i + 1)) / nb - chord * 0.04;
    B.box((x0 + x1) / 2, 0.4, 0, x1 - x0, 0.25, chord, CK.PANEL);
    B.box((x0 + x1) / 2, 0.1, chord / 2, x1 - x0, 0.4, 0.5, CK.BRONZE);
    B.box((x0 + x1) / 2, 0.1, -chord / 2, x1 - x0, 0.4, 0.5, CK.BRONZE);
  }
  c.lamps.push({ p: here(B, span + 1, 0, 0), r: Math.max(1, chord * 0.03), color: LAMP.RED, i: 3.5, breathe: 1, phase: c.r() });
  B.pop();
}

/** Scatter of small fittings on a face (origin o, axes u, v, normal n, half sizes a, b). */
function greebles(c, o, u, v, n, a, b, count, scale = 1) {
  const B = c.B, r = c.r;
  const N = n.clone().normalize(), U = u.clone().normalize(), W = V().crossVectors(N, U);
  B.push(new THREE.Matrix4().makeBasis(U, N, W).setPosition(o));
  for (let i = 0; i < count; i++) {
    const x = (r() * 2 - 1) * a, z = (r() * 2 - 1) * b;
    const t = r();
    const s = scale * (0.6 + r() * 1.2);
    if (t < 0.35) B.box(x, 0.4 * s, z, 2.4 * s, 0.8 * s, 1.6 * s, r() < 0.5 ? DK.GRIME : CK.DARK);            // equipment box
    else if (t < 0.55) { B.box(x, 0.12 * s, z, 1.6 * s, 0.24 * s, 1.6 * s, CK.DARK); B.box(x, 0.3 * s, z, 1.2 * s, 0.12 * s, 1.2 * s, CK.BRONZE); }   // hatch
    else if (t < 0.75) B.tube([V(x, 0.4 * s, z - 3 * s), V(x, 0.4 * s, z + 3 * s)], 0.25 * s, 5, CK.BRONZE);   // pipe run
    else if (t < 0.88) { B.box(x, 0.9 * s, z, 0.9 * s, 1.8 * s, 0.9 * s, CK.HULL); B.box(x, 1.9 * s, z, 1.3 * s, 0.2 * s, 1.3 * s, CK.DARK); }   // vent stack
    else { B.tube([V(x, 0, z), V(x, 3.5 * s, z)], 0.08 * s, 4, CK.DARK); }                                 // whip
  }
  B.pop();
}

/** Railing round a rectangular deck edge (in the builder's frame at height y). */
function railing(B, x0, x1, z0, z1, y, h = 1.1) {
  const pts = [V(x0, y + h, z0), V(x1, y + h, z0), V(x1, y + h, z1), V(x0, y + h, z1), V(x0, y + h, z0)];
  B.tube(pts, 0.05, 4, CK.BRONZE);
  const per = 2 * (x1 - x0 + z1 - z0), n = Math.max(4, Math.round(per / 3));
  for (let i = 0; i < n; i++) {
    const s = (i / n) * per;
    let x, z;
    if (s < x1 - x0) { x = x0 + s; z = z0; } else if (s < x1 - x0 + z1 - z0) { x = x1; z = z0 + s - (x1 - x0); } else if (s < 2 * (x1 - x0) + z1 - z0) { x = x1 - (s - (x1 - x0 + z1 - z0)); z = z1; } else { x = x0; z = z1 - (s - 2 * (x1 - x0) - (z1 - z0)); }
    B.box(x, y + h / 2, z, 0.06, h, 0.06, CK.DARK);
  }
}

/** Floodlight on a bracket aimed at a target (both station frame). */
function floodAt(c, p, target, size = 1.2, color = LAMP.WHITE, i = 2.6) {
  const d = V().subVectors(target, p).normalize();
  c.lamps.push(flood(c.B, p, d, size, color, i));
}

/** Box-section deck block with windows all round (glass bands) and a roof of fittings. */
function block(c, x, y, z, w, h, l, kinds = [DK.PORTS, CK.GLASS]) {
  const B = c.B;
  B.box(x, y, z, w, h, l, kinds[0]);
  const floors = Math.max(1, Math.floor(h / 4.2));
  for (let f = 0; f < floors; f++) B.box(x, y - h / 2 + 2.3 + f * 4.2, z, w + 0.3, 1.6, l + 0.3, kinds[1]);
  B.box(x, y + h / 2 + 0.2, z, w + 0.6, 0.4, l + 0.6, CK.BRONZE);
  railing(B, x - w / 2, x + w / 2, z - l / 2, z + l / 2, y + h / 2 + 0.4);
}

/**
 * Rectangular-section ring (a wheel's rim) about the builder's z: radius R to the floor,
 * height h inward, width w. Floor outward in livery, concourse glazing facing the hub, ports
 * down the sides.
 */
function rim(B, R, h, w, seg, { inner = DK.CONCOURSE, side = DK.PORTS, floor = DK.LIVERY } = {}) {
  B.lathe([[R, -w / 2, floor], [R, w / 2, floor], [R - h * 0.35, w / 2, side], [R - h, w / 2 - h * 0.3, side], [R - h, -w / 2 + h * 0.3, inner], [R - h * 0.35, -w / 2, side], [R, -w / 2, side]], seg, 0, { closedProfile: true });
  // a lit gallery under the eaves each side and rib frames every 1/seg of a turn
  for (const s of [-1, 1]) { B.at(0, 0, s * (w / 2 + 0.4)); B.torus(R - h * 0.45, h * 0.06, seg, 5, CK.LANTERN); B.pop(); }
  for (let i = 0; i < seg; i += 2) {
    const a = (i / seg) * TAU;
    B.push(new THREE.Matrix4().makeRotationZ(a));
    B.box(R - h / 2, 0, 0, h * 1.06, 1.2, w * 1.04, CK.BRONZE);
    B.pop();
  }
}

// ------------------------------------------------------------- archetypes ----
function buildComms(c) {
  const { B, r } = c;
  const decks = r.int(3, 5), rad = r.range(16, 24), dh = 9;
  const H = decks * dh;
  // octagonal equipment bus in decks along y, a livery band on every other deck
  B.push(TO_Y);
  const prof = [[0.02, -H / 2 - 2, CK.DARK], [rad * 0.8, -H / 2 - 2, CK.DARK]];
  for (let i = 0; i < decks; i++) {
    const z0 = -H / 2 + i * dh;
    prof.push([rad, z0, CK.BRONZE], [rad + 0.8, z0 + 0.3, CK.BRONZE], [rad + 0.8, z0 + 1.2, CK.DARK], [rad, z0 + 1.5, CK.DARK], [rad, z0 + dh, i % 2 ? DK.LIVERY : DK.GRIME]);
  }
  prof.push([rad * 0.8, H / 2 + 2, CK.HULL], [0.02, H / 2 + 2, CK.HULL]);
  B.lathe(prof, 8, Math.PI / 8);
  B.pop();
  // equipment on the bus faces, radiators on the east and west, a crew can on the north
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU, n = V(Math.cos(a), 0, Math.sin(a));
    const o = n.clone().multiplyScalar(rad * Math.cos(Math.PI / 8) + 0.8);
    greebles(c, o, Y, V().crossVectors(n, Y), n, rad * 0.3, H * 0.4, 6, 1.3);
  }
  for (const s of [-1, 1]) radiatorWing(B, V(s * (rad + 1), -H * 0.25, 0), V(s, 0, 0), Z, r.range(50, 90), r.range(16, 24), c.lamps, LAMP.AMBER);
  can(c, V(0, H * 0.15, rad + 22), Z, 7, r.range(26, 40));
  truss(B, V(0, H * 0.15, rad), V(0, H * 0.15, rad + 8), 3, 4, 0.2);
  berth(c, V(0, H * 0.15, rad + 22 + 20 + 3), Z, 2.4, 5);
  // booms and dishes: slewing parts, each on its own boom
  const nd = r.int(3, 6);
  for (let i = 0; i < nd; i++) {
    const a = (i / nd) * TAU + r.range(-0.2, 0.2);
    const out = V(Math.cos(a), 0, Math.sin(a) * 0.6).normalize();
    const root = out.clone().multiplyScalar(rad).setY(H / 2 - 4);
    const L = r.range(30, 60);
    const tip = root.clone().addScaledVector(out, L).setY(H / 2 + r.range(4, 18));
    truss(B, root, tip, 2.4, 5, 0.18);
    const dr = r.range(8, 22);
    const aim = V(r.range(-0.5, 0.5), -1, r.range(-0.3, 0.3)).normalize();   // toward the Earth
    const q = new THREE.Quaternion().setFromUnitVectors(Z, Y);
    c.part(tip, q, 'slew', r.range(0.05, 0.14), (Bp) => {
      Bp.box(0, 0, 0, 3, 3, 3, CK.BRONZE);
      dish(Bp, V(0, 0, 0).addScaledVector(aim, dr * 0.85 + 2), aim, dr);
    }, { amp: r.range(0.25, 0.6), phase: r() * TAU });
  }
  // antenna farm on the zenith deck, beacons at the tips
  B.box(0, H / 2 + 2.6, 0, rad * 1.4, 1.2, rad * 1.4, CK.DECK);
  c.walks.push({ a: V(-rad * 0.6, H / 2 + 3.2, -rad * 0.62), b: V(rad * 0.6, H / 2 + 3.2, -rad * 0.62), up: Y });
  railing(B, -rad * 0.7, rad * 0.7, -rad * 0.7, rad * 0.7, H / 2 + 3.2);
  const nm = r.int(4, 8);
  for (let i = 0; i < nm; i++) {
    const p = V(r.range(-rad * 0.6, rad * 0.6), H / 2 + 3.2, r.range(-rad * 0.6, rad * 0.6));
    const tip = mast(B, p, Y, r.range(10, 36), 0.35);
    c.beacon(tip, i % 3 ? LAMP.RED : LAMP.WHITE, 1.6, 4.5, r());
  }
  // wings to the north and south
  for (const s of [-1, 1]) pvWing(c, V(0, -H * 0.3, s * rad), V(0, 0, s), Y, r.range(90, 150), r.range(18, 26));
  c.beacon(V(0, -H / 2 - 3, 0), LAMP.AMBER, 3, 4);
}

function buildHabitat(c) {
  const { B, r } = c;
  // rim gravity 0.6 - 1 g at a comfortable spin (< 2 rpm)
  const R = r.range(260, 520), g = r.range(0.6, 1.0) * G, rate = Math.sqrt(g / R);
  const hubR = r.range(22, 34);
  const rimH = r.range(26, 40), rimW = r.range(60, 110);
  const twin = r() < 0.4;
  // the wheel's sweep (half its axial width): everything fixed to the hub stands clear of it
  const halfW = (twin ? rimW * 0.62 + rimW * 0.275 : rimW / 2) + 2;
  const zRad = halfW + 34, zBerth = halfW + 70, zWing = halfW + 100;
  const hubL = 2 * (zWing + r.range(20, 50));
  // the despun hub along z (north-south), docks at both poles
  B.lathe([[0.02, -hubL / 2 - 10, CK.DARK], [hubR * 0.7, -hubL / 2 - 10, CK.HULL], [hubR, -hubL / 2, CK.BRONZE], [hubR, -rimW * 0.7, DK.GRIME], [hubR * 1.15, -rimW * 0.7, CK.BRONZE],
    [hubR * 1.15, rimW * 0.7, CK.DARK], [hubR, rimW * 0.7, CK.BRONZE], [hubR, hubL / 2, DK.LIVERY], [hubR * 0.7, hubL / 2 + 10, CK.HULL], [0.02, hubL / 2 + 10, CK.HULL]], 24);
  for (const s of [-1, 1]) {
    berth(c, V(0, 0, s * (hubL / 2 + 10)), V(0, 0, s), 3, 8);
    for (const k of [0, 1, 2, 3]) {
      const a = (k / 4) * TAU + Math.PI / 4;
      const p = V(Math.cos(a) * hubR, Math.sin(a) * hubR, s * zBerth);
      berth(c, p, V(Math.cos(a), Math.sin(a), 0), 2.2, 10);
    }
    // radiators and wings on the hub's ends, away from the wheel
    radiatorWing(B, V(hubR, 0, s * zRad), X, Z, r.range(70, 120), 22, c.lamps, LAMP.AMBER);
    radiatorWing(B, V(-hubR, 0, s * zRad), X.clone().negate(), Z, r.range(70, 120), 22, c.lamps, LAMP.AMBER);
    pvWing(c, V(0, hubR, s * zWing), Y, Z, r.range(80, 140), 24);
    c.beacon(V(0, 0, s * (hubL / 2 + 12)), LAMP.WHITE, 3, 5, s > 0 ? 0 : 0.5);
    greebles(c, V(0, -hubR, s * (zBerth + zWing) / 2), X, Z, V(0, -1, 0), hubR * 0.5, 12, 10, 1.4);
  }
  // the wheel (spins about z): rim, spokes with lift shafts, a bearing collar round the hub
  const nSpokes = r.pick([3, 4, 6]);
  const seg = 96;
  c.part(V(0, 0, 0), new THREE.Quaternion(), 'spin', rate, (Bp, lamps) => {
    const offs = twin ? [-rimW * 0.62, rimW * 0.62] : [0];
    for (const zo of offs) {
      Bp.at(0, 0, zo);
      rim(Bp, R, rimH, twin ? rimW * 0.55 : rimW, seg);
      Bp.pop();
      for (let k = 0; k < nSpokes; k++) {
        const a = (k / nSpokes) * TAU + (zo > 0 ? Math.PI / nSpokes : 0);
        const u = V(Math.cos(a), Math.sin(a), 0);
        const p0 = u.clone().multiplyScalar(hubR * 1.25).setZ(zo * 0.5), p1 = u.clone().multiplyScalar(R - rimH * 0.98).setZ(zo);
        Bp.tube([p0, p1], 4.2, 10, DK.LIVERY);
        Bp.tube([p0.clone().addScaledVector(V(-u.y, u.x, 0), 7), p1.clone().addScaledVector(V(-u.y, u.x, 0), 7)], 1.2, 6, CK.GLASS);   // lift shaft
        for (let t = 0.2; t < 0.95; t += 0.25) Bp.tube([p0.clone().lerp(p1, t).addScaledVector(V(-u.y, u.x, 0), -1.5), p0.clone().lerp(p1, t).addScaledVector(V(-u.y, u.x, 0), 8)], 0.8, 5, CK.BRONZE);
        lamps.push({ p: p1.clone().addScaledVector(u, -rimH * 0.2).setZ(zo + (twin ? rimW * 0.3 : rimW * 0.55)), r: 2.4, color: LAMP.AMBER, i: 3, breathe: 0.4 });
      }
    }
    Bp.lathe([[hubR * 1.2, -rimW * 0.62, CK.BRONZE], [hubR * 1.45, -rimW * 0.5, CK.HULL], [hubR * 1.45, rimW * 0.5, CK.HULL], [hubR * 1.2, rimW * 0.62, CK.BRONZE]], 32, 0, { closedProfile: false });
    // rim lamps: a ring of warm floods on the rim's face, reading as a lit circle from afar
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * TAU;
      lamps.push({ p: V(Math.cos(a) * (R + 1.5), Math.sin(a) * (R + 1.5), 0), r: 3.2, color: k % 6 ? [1.0, 0.8, 0.55] : LAMP.WHITE, i: 2.2 });
    }
  }, { radius: R + 4, hub: hubR * 1.45, halfW });
  c.spinR = R;
}

function buildDepot(c) {
  const { B, r } = c;
  const L = r.range(360, 620);
  const w = 8;
  truss(B, V(-L / 2, 0, 0), V(L / 2, 0, 0), w, 12, 0.35);
  catwalk(B, V(-L / 2 + 10, w / 2 + 0.2, 0), V(L / 2 - 10, w / 2 + 0.2, 0), Y, 1.6, 1.1);
  c.walks.push({ a: V(-L / 2 + 12, w / 2 + 0.32, 0), b: V(L / 2 - 12, w / 2 + 0.32, 0), up: Y });
  // tank clusters in bays along the spine
  const bays = Math.floor(L / 70);
  for (let i = 0; i < bays; i++) {
    const x = -L / 2 + 40 + i * ((L - 80) / Math.max(bays - 1, 1));
    const style = r.int(0, 2);
    B.push(new THREE.Matrix4().makeTranslation(x, 0, 0));
    if (style === 0) {
      for (const s of [-1, 1]) { B.at(0, 0, s * 20); sphereTank(B, 14, i % 2 ? DK.FOIL : DK.LIVERY, 20); B.pop(); }
      for (const s of [-1, 1]) B.tube([V(0, 0, s * w / 2), V(0, 0, s * 7)], 1.4, 6, CK.BRONZE);
    } else if (style === 1) {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + Math.PI / 4;
        atAim(B, V(0, Math.cos(a) * 16, Math.sin(a) * 16), X);
        tank(B, 7, 44, k % 2 ? DK.LIVERY : DK.FOIL, CK.BRONZE, 16);
        B.pop();
      }
      for (const xx of [-18, 18]) { atAim(B, V(xx, 0, 0), X); B.lathe([[23.4, -1, CK.BRONZE], [23.4, 1, CK.BRONZE], [22.6, 1, CK.DARK], [22.6, -1, CK.DARK]], 24, 0, { closedProfile: true }); B.pop(); }
    } else {
      for (const sz of [-1, 1]) {
      B.tube([V(0, 0, sz * w / 2), V(0, 0, sz * 10)], 1.4, 6, CK.BRONZE);
      atAim(B, V(0, 0, sz * 23), X);
      B.lathe([[0.02, -26, CK.HULL], [8, -24, CK.HULL], [12.5, -18, DK.LIVERY], [12.5, 18, DK.LIVERY], [8, 24, CK.HULL], [0.02, 26, CK.HULL]], 22);
      for (const z of [-12, 0, 12]) B.lathe([[12.9, z - 1, CK.BRONZE], [12.9, z + 1, CK.BRONZE]], 22, 0, { closedProfile: false });
      B.pop();
      }
    }
    // a pump house on the spine with its lit window strip
    block(c, 0, -w / 2 - 4, 0, 14, 7, 10, [DK.GRIME, CK.GLASS]);
    floodAt(c, V(x, w / 2 + 3, 6), V(x, 0, 18), 0.9);
    greebles(c, V(x, -w / 2 - 8, 0), X, Z, V(0, -1, 0), 20, 5, 5, 1);
    B.pop();
  }
  // tanker berths on arms north and south, a radial pair at the ends
  const nb = r.int(2, 4);
  for (let i = 0; i < nb; i++) {
    const x = -L / 2 + 60 + (i + 0.5) * ((L - 120) / nb);
    const s = i % 2 ? 1 : -1;
    truss(B, V(x, 0, s * w / 2), V(x, 0, s * 60), 4, 8, 0.25);
    berth(c, V(x, 0, s * 60), V(0, 0, s), 2.8, 6);
  }
  for (const s of [-1, 1]) {
    can(c, V(s * (L / 2 + 22), 0, 0), X, 10, 30);
    berth(c, V(s * (L / 2 + 22 + 15 + 5), 0, 0), V(s, 0, 0), 2.6, 5);
    radiatorWing(B, V(s * (L / 2 + 1), 0, w / 2), Z, X, r.range(60, 90), 24, c.lamps, LAMP.AMBER);
    c.beacon(V(s * (L / 2), w, 0), LAMP.RED, 3, 5, s > 0 ? 0.5 : 0);
  }
  pvWing(c, V(0, -w / 2, 0), V(0, -1, 0), X, r.range(70, 120), 28);
}

function buildShipyard(c) {
  const { B, r } = c;
  const nF = r.int(5, 8), pitch = r.range(60, 90), Wd = r.range(90, 140), Hd = r.range(80, 120);
  const L = (nF - 1) * pitch;
  // portal frames along z, joined by top and bottom stringers: an open box of truss
  const zs = Array.from({ length: nF }, (_, i) => -L / 2 + i * pitch);
  for (const z of zs) {
    const a = V(-Wd / 2, -Hd / 2, z), b = V(Wd / 2, -Hd / 2, z), cc = V(Wd / 2, Hd / 2, z), d = V(-Wd / 2, Hd / 2, z);
    truss(B, a, b, 4, 10, 0.3); truss(B, b, cc, 4, 10, 0.3); truss(B, cc, d, 4, 10, 0.3); truss(B, d, a, 4, 10, 0.3);
  }
  for (const [x, y] of [[-Wd / 2, -Hd / 2], [Wd / 2, -Hd / 2], [Wd / 2, Hd / 2], [-Wd / 2, Hd / 2]]) truss(B, V(x, y, -L / 2), V(x, y, L / 2), 4, 12, 0.3);
  // crane rails along the top stringers
  for (const s of [-1, 1]) B.box(s * Wd / 2, Hd / 2 + 2.6, 0, 2.4, 1.2, L, CK.BRONZE);
  // the hull on the slip: plated astern in livery with ports, ribs and stringers forward
  const hl = L * 0.9, hw = Wd * 0.3, hh = Hd * 0.3;
  const plated = r.range(0.35, 0.7);
  const rings = [];
  const N = 20;
  for (let j = 0; j <= Math.round(N * plated); j++) {
    const u = j / N;
    const f = u < 0.15 ? 0.7 + 2 * u : 1;
    rings.push({ z: -hl / 2 + u * hl, pts: sectionEllipse(hw * f, hh * f, 28, 2.4) });
  }
  B.loft(rings, (i, j) => (j % 5 === 0 ? CK.BRONZE : Math.abs(Math.cos((i / 28) * TAU)) > 0.75 ? DK.PORTS : DK.LIVERY), { capStart: CK.DARK, capEnd: CK.DARK });
  const zP = -hl / 2 + plated * hl;
  for (let z = zP + 12; z < hl / 2; z += 14) {
    const f = 1 - Math.max(0, (z - hl * 0.3) / (hl * 0.2)) * 0.6;
    const pts = sectionEllipse(hw * f, hh * f, 20, 2.4).map(([x, y]) => V(x, y, z));
    pts.push(pts[0].clone());
    B.tube(pts, 0.9, 5, CK.BRONZE);
  }
  for (let s = 0; s < 8; s++) {
    const t = (s / 8) * TAU;
    const [x, y] = sectionEllipse(hw, hh, 8, 2.4, 0)[s];
    B.tube([V(x, y, zP - 2), V(x * 0.4, y * 0.4, hl / 2)], 0.6, 5, CK.DARK);
    if (s % 2 === 0) c.lamps.push({ p: V(x * 0.8, y * 0.8, zP + 20 + 30 * (s / 8)), r: 1.4, color: s % 4 ? LAMP.TEAL : LAMP.WHITE, i: 4, breathe: 0.9, phase: r() });   // welders
    c.welds.push(V(x * 0.97, y * 0.97, zP + 12 + 14 * (s % 4)), V(x * 0.9, y * 0.9, zP + 40 + 14 * (s % 3)));
    void t;
  }
  // engine bells already on her, clamps from the frames
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2;
    B.at(Math.cos(a) * hw * 0.4, Math.sin(a) * hh * 0.4, -hl / 2);
    B.lathe([[hw * 0.18, 0, CK.DARK], [hw * 0.22, -hw * 0.3, CK.DARK], [hw * 0.3, -hw * 0.6, CK.BRONZE], [hw * 0.26, -hw * 0.6, CK.DARK], [hw * 0.12, -hw * 0.1, CK.DARK]], 16, 0, { closedProfile: true });
    B.pop();
  }
  for (const z of zs) for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const outer = V(sx * Wd / 2, sy * Hd / 2, z);
    const inner = V(sx * hw * (z < zP ? 1.02 : 0.8), sy * hh * (z < zP ? 1.02 : 0.8), z);
    if (Math.abs(z) > hl / 2) continue;
    B.tube([outer, inner], 1.1, 6, CK.DARK);
    B.box(inner.x, inner.y, z, 3, 3, 3, DK.HAZARD);
  }
  // floods all round the frame, aimed at the hull
  for (const z of zs) for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) floodAt(c, V(sx * Wd / 2 * 0.95, sy * Hd / 2 * 0.95, z), V(0, 0, z), 1.6, r() < 0.2 ? LAMP.AMBER : LAMP.WHITE, 3);
  // the crews' block beside the frame, a stock yard deck of containers and plates below
  block(c, Wd / 2 + 30, 0, -L / 4, 30, 34, 50, [DK.PORTS, DK.CONCOURSE]);
  truss(B, V(Wd / 2 + 2, 0, -L / 4), V(Wd / 2 + 15, 0, -L / 4), 4, 5, 0.3);
  berth(c, V(Wd / 2 + 45, 0, -L / 4), X, 2.6, 6);
  berth(c, V(Wd / 2 + 30, 17, -L / 4 + 12), Y, 2.4, 5);
  B.box(0, -Hd / 2 - 16, 0, Wd * 0.8, 2, L * 0.7, CK.DECK);
  railing(B, -Wd * 0.4, Wd * 0.4, -L * 0.35, L * 0.35, -Hd / 2 - 15);
  for (const s of [-1, 1]) c.walks.push({ a: V(s * Wd * 0.39, -Hd / 2 - 15, -L * 0.33), b: V(s * Wd * 0.39, -Hd / 2 - 15, L * 0.33), up: Y });
  truss(B, V(0, -Hd / 2 - 2, 0), V(0, -Hd / 2 - 15, 0), 4, 6, 0.3);
  for (let i = 0; i < 18; i++) {
    const x = r.range(-Wd * 0.35, Wd * 0.35), z = r.range(-L * 0.32, L * 0.32);
    if (r() < 0.6) container(B, x, -Hd / 2 - 17.6, z, 2.6, 2.6, 12, r.pick([CK.HULL, CK.BRONZE, DK.LIVERY, DK.GRIME]));
    else B.box(THREE.MathUtils.clamp(x, -Wd * 0.35 + 5, Wd * 0.35 - 5), -Hd / 2 - 16.6, z, 10, 0.6, 7, r.pick([CK.HULL, CK.RADIATOR]));
  }
  for (const s of [-1, 1]) radiatorWing(B, V(s * Wd / 2, -Hd / 2, L / 2), V(s, 0, 0), Y, r.range(80, 120), 30, c.lamps, LAMP.AMBER);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) c.beacon(V(sx * Wd / 2, Hd / 2 + 4, sz * L / 2), LAMP.RED, 3.2, 5, (sx + sz + 2) * 0.13);
  // crane bridges ride the rails, their trolleys lowering plates (moving parts)
  const nc = r.int(1, 2);
  for (let i = 0; i < nc; i++) {
    const z0 = -L / 2 + L * (0.25 + 0.5 * i);
    c.part(V(0, Hd / 2 + 4, z0), new THREE.Quaternion(), 'rail', 0, (Bp, lamps) => {
      truss(Bp, V(-Wd / 2, 0, 0), V(Wd / 2, 0, 0), 5, 8, 0.35, CK.BRONZE);
      Bp.box(0, -4, 0, 10, 4, 8, DK.HAZARD);
      Bp.box(0, -2, 0, 7, 3, 7, CK.GLASS);
      Bp.tube([V(0, -6, 0), V(0, -Hd * 0.18, 0)], 0.3, 4, CK.DARK);
      Bp.box(0, -Hd * 0.18 - 1, 0, 14, 0.8, 8, CK.HULL);
      lamps.push({ p: V(0, -7, 0), r: 1.6, color: LAMP.AMBER, i: 4, breathe: 1 });
      lamps.push({ p: V(Wd / 2, 2, 0), r: 1.2, color: LAMP.RED, i: 3 }, { p: V(-Wd / 2, 2, 0), r: 1.2, color: LAMP.RED, i: 3 });
    }, { travel: L * 0.3, period: r.range(160, 260) });
  }
}

function buildRelay(c) {
  const { B, r } = c;
  // the emitter: a phased-array disc facing the Earth on a tower beneath the core
  const eR = r.range(90, 160);
  B.push(TO_Y);
  B.lathe([[0.02, -60, DK.ARRAY], [eR, -60, DK.ARRAY], [eR + 2, -58, CK.BRONZE], [eR, -56, CK.DARK], [eR * 0.3, -40, CK.DARK], [18, -24, DK.GRIME], [18, 24, DK.LIVERY], [14, 30, CK.HULL], [0.02, 32, CK.HULL]], 48);
  B.pop();
  // ribs under the disc and the feed ring
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    B.tube([V(Math.cos(a) * 20, -30, Math.sin(a) * 20), V(Math.cos(a) * eR * 0.95, -57, Math.sin(a) * eR * 0.95)], 1.2, 5, CK.DARK);
  }
  B.torus(eR * 0.55, 1.6, 48, 6, CK.CONDUIT);
  can(c, V(0, 10, 30), Z, 8, 30);
  berth(c, V(0, 10, 30 + 15 + 6), Z, 2.4, 5);
  berth(c, V(0, 10, -24), V(0, 0, -1), 2.4, 5);
  for (const s of [-1, 1]) radiatorWing(B, V(s * 18, 0, 0), V(s, 0, 0), Z, r.range(60, 100), 26, c.lamps, LAMP.AMBER);
  // beam guide beacons round the emitter rim
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    c.beacon(V(Math.cos(a) * (eR + 3), -58, Math.sin(a) * (eR + 3)), [1.0, 0.35, 0.2], 2.6, 4, k / 8);
  }
  // the collector: a cross of photovoltaic blankets on a mast above, turning to face the Sun
  const span = r.range(260, 480), chord = r.range(60, 110);
  c.part(V(0, 60, 0), new THREE.Quaternion(), 'sun', 0, (Bp, lamps) => {
    Bp.push(TO_Y);
    Bp.lathe([[6, -30, CK.BRONZE], [8, -26, CK.DARK], [8, 6, CK.DARK], [10, 8, CK.BRONZE], [0.02, 10, CK.BRONZE]], 16);
    Bp.pop();
    for (const s of [-1, 1]) {
      // blankets spread along x in the pivot frame, their faces along the pivot's +y... turned about z
      truss(Bp, V(s * 8, 0, 0), V(s * (span + 8), 0, 0), 5, 14, 0.35);
      const nb = Math.max(3, Math.round(span / chord));
      for (let i = 0; i < nb; i++) {
        const x0 = 12 + (span - 4) * (i / nb), x1 = 12 + (span - 4) * ((i + 1) / nb) - 3;
        Bp.box(s * (x0 + x1) / 2, 3, 0, x1 - x0, 0.4, chord, CK.PANEL);
        Bp.box(s * (x0 + x1) / 2, 2.4, chord / 2, x1 - x0, 0.6, 0.8, CK.BRONZE);
        Bp.box(s * (x0 + x1) / 2, 2.4, -chord / 2, x1 - x0, 0.6, 0.8, CK.BRONZE);
      }
      lamps.push({ p: V(s * (span + 10), 0, 0), r: 3, color: LAMP.RED, i: 5, breathe: 1, phase: s > 0 ? 0 : 0.5 });
    }
  }, { axis: 'z' });
  truss(B, V(0, 32, 0), V(0, 55, 0), 6, 6, 0.4);
  greebles(c, V(0, 32, 0), X, Z, Y, 12, 12, 8, 1.2);
}

function buildTransit(c) {
  const { B, r } = c;
  const R = r.range(40, 60), H = r.range(60, 100);
  // the drum along y: concourse bands between plated floors, a lantern signal ring round it
  B.push(TO_Y);
  const prof = [[0.02, -H / 2 - 8, CK.DARK], [R * 0.7, -H / 2 - 8, CK.HULL], [R, -H / 2, CK.BRONZE]];
  const bands = Math.max(2, Math.round(H / 16));
  for (let i = 0; i < bands; i++) {
    const z0 = -H / 2 + (H * i) / bands, z1 = -H / 2 + (H * (i + 1)) / bands;
    prof.push([R + 0.5, z0 + 0.5, CK.BRONZE], [R, z0 + 1.5, i % 2 ? DK.PORTS : DK.LIVERY], [R, z0 + (z1 - z0) * 0.45, i % 2 ? DK.PORTS : DK.LIVERY], [R * 1.02, z0 + (z1 - z0) * 0.5, CK.BRONZE], [R * 1.02, z1 - 0.5, DK.CONCOURSE]);
  }
  prof.push([R, H / 2, CK.BRONZE], [R * 0.7, H / 2 + 8, CK.HULL], [0.02, H / 2 + 8, CK.HULL]);
  B.lathe(prof, 36);
  B.pop();
  B.push(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  B.torus(R + 12, 2.2, 48, 6, CK.LANTERN);
  B.pop();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    B.tube([V(Math.cos(a) * R, 0, Math.sin(a) * R), V(Math.cos(a) * (R + 12), 0, Math.sin(a) * (R + 12))], 0.8, 5, CK.BRONZE);
  }
  // radial docking arms: pressurised tubes with ports, a berth at each end
  const na = r.int(4, 6);
  for (let k = 0; k < na; k++) {
    const a = (k / na) * TAU + Math.PI / na;
    const u = V(Math.cos(a), 0, Math.sin(a));
    const y = (k % 2 ? 1 : -1) * H * 0.25;
    const len = r.range(50, 90);
    can(c, u.clone().multiplyScalar(R + len / 2 + 2).setY(y), u, 5, len, { ends: false });
    berth(c, u.clone().multiplyScalar(R + len + 6).setY(y), u, 2.6, 4);
    floodAt(c, u.clone().multiplyScalar(R + 4).setY(y + 8), u.clone().multiplyScalar(R + len + 20).setY(y), 1.1);
  }
  // control tower on the zenith cap: a stalk and a glazed cab with its beacon
  B.push(TO_Y);
  B.lathe([[6, H / 2 + 8, CK.HULL], [4, H / 2 + 40, DK.LIVERY], [10, H / 2 + 44, CK.BRONZE], [12, H / 2 + 50, CK.GLASS], [10, H / 2 + 56, CK.GLASS], [4, H / 2 + 60, CK.HULL], [0.02, H / 2 + 62, CK.HULL]], 16);
  B.pop();
  c.beacon(V(0, H / 2 + 66, 0), LAMP.WHITE, 3.4, 6);
  const tip = mast(B, V(0, H / 2 + 62, 0), Y, 20, 0.3);
  c.beacon(tip, LAMP.RED, 1.8, 4.5, 0.5);
  berth(c, V(0, -H / 2 - 8, 0), V(0, -1, 0), 3, 6);
  for (const s of [-1, 1]) pvWing(c, V(0, s * H * 0.35, 0).add(V(R, 0, 0)), X, Y, r.range(60, 100), 22);
  radiatorWing(B, V(-R, 0, 0), V(-1, 0, 0), Y, r.range(60, 90), 24, c.lamps, LAMP.AMBER);
  greebles(c, V(0, H / 2 + 8.2, 0), X, Z, Y, R * 0.5, R * 0.5, 8, 1.3);
}

function buildFarm(c) {
  const { B, r } = c;
  const R = r.range(90, 150), L = r.range(420, 800), rate = Math.sqrt(r.range(0.4, 0.8) * G / R);
  // the despun spine through the drum's axis (z), a bearing each end, docks, mirrors
  B.tube([V(0, 0, -L / 2 - 110), V(0, 0, L / 2 + 110)], 7, 12, CK.DARK);
  for (const s of [-1, 1]) {
    const e = s * (L / 2 + 30);
    B.at(0, 0, e);
    B.lathe([[0.02, -18, CK.HULL], [16, -16, CK.BRONZE], [18, -8, DK.GRIME], [18, 8, DK.LIVERY], [16, 16, CK.BRONZE], [0.02, 18, CK.HULL]], 20);
    B.pop();
    berth(c, V(0, 0, s * (L / 2 + 110)), V(0, 0, s), 3, 6);
    berth(c, V(0, 18, e), Y, 2.4, 6);
    // mirrors on struts, angled to throw sunlight along the glazing
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + Math.PI / 6;
      const u = V(Math.cos(a), Math.sin(a), 0);
      const root = u.clone().multiplyScalar(18).setZ(e), tipP = u.clone().multiplyScalar(R * 1.1).setZ(s * (L / 2 + 90));
      B.tube([root, tipP], 1.4, 6, CK.BRONZE);
      atAim(B, tipP, u.clone().multiplyScalar(-0.6).add(V(0, 0, -s)).normalize());
      B.box(0, 0, 0, R * 0.7, R * 0.5, 0.6, CK.GLASS);
      B.box(0, 0, -0.5, R * 0.72, R * 0.52, 0.3, CK.DARK);
      B.pop();
    }
    radiatorWing(B, V(0, -18, e), V(0, -1, 0), Z, r.range(60, 90), 26, c.lamps, LAMP.AMBER);
    c.beacon(V(0, 0, s * (L / 2 + 114)), LAMP.WHITE, 3, 5, s > 0 ? 0.25 : 0.75);
  }
  // the drum: alternating glazed and plated strips (the land inside faces the glass), end walls
  const strips = r.pick([3, 4, 6]);
  c.part(V(0, 0, 0), new THREE.Quaternion(), 'spin', rate, (Bp, lamps) => {
    const segs = strips * 8;
    const rings = [];
    const n = 16;
    for (let j = 0; j <= n; j++) {
      const z = -L / 2 + (L * j) / n;
      const pts = [];
      for (let i = 0; i < segs; i++) { const a = (i / segs) * TAU; pts.push([Math.cos(a) * R, Math.sin(a) * R]); }
      rings.push({ z, pts });
    }
    Bp.loft(rings, (i, j) => (j % 4 === 0 ? CK.BRONZE : Math.floor(i / 4) % 2 ? CK.ROOF : DK.LIVERY), { capStart: DK.PORTS, capEnd: DK.PORTS });
    for (let j = 0; j <= n; j += 2) Bp.at(0, 0, -L / 2 + (L * j) / n), Bp.torus(R + 0.8, 1.2, segs, 5, CK.BRONZE), Bp.pop();
    for (const s of [-1, 1]) Bp.lathe([[18, s * (L / 2 + 1), CK.BRONZE], [R * 0.9, s * (L / 2 + 1), DK.CONCOURSE], [R, s * (L / 2), CK.BRONZE]], segs, 0, { closedProfile: false });
    for (let k = 0; k < strips * 2; k++) {
      const a = ((k + 0.5) / (strips * 2)) * TAU;
      lamps.push({ p: V(Math.cos(a) * (R + 2), Math.sin(a) * (R + 2), (k % 2 ? 1 : -1) * L * 0.25), r: 2.4, color: [1.0, 0.8, 0.55], i: 2 });
    }
  }, { radius: R + 3, hub: 8, halfW: L / 2 + 3 });
  c.spinR = R;
}

function buildScience(c) {
  const { B, r } = c;
  const tR = r.range(14, 26), tL = r.range(80, 140);
  // the telescope tube along -y (its aperture looks away from the Earth, up +y)
  B.push(TO_Y);
  B.lathe([[tR * 0.6, -tL / 2 - 12, CK.DARK], [tR, -tL / 2, DK.LIVERY], [tR, 0, DK.LIVERY], [tR * 1.08, 1, CK.BRONZE], [tR * 1.08, 3, CK.BRONZE], [tR, 4, DK.GRIME],
    [tR, tL / 2, DK.GRIME], [tR * 1.1, tL / 2 + 1, CK.BRONZE], [tR * 0.94, tL / 2 + 1, CK.DARK], [tR * 0.94, -tL / 2 + 8, CK.DARK], [0.02, -tL / 2 + 8, CK.DARK]], 32, 0, { closedProfile: false });
  B.pop();
  // layered sunshields on the tube's sunward flank (gold foil), spaced on standoffs
  const layers = r.int(3, 5);
  for (let i = 0; i < layers; i++) {
    const off = tR + 6 + i * 3;
    B.box(off, 0, 0, 0.3, tL * (1.2 - i * 0.05), tR * 5 - i * 4, DK.FOIL);
    for (const y of [-tL * 0.4, 0, tL * 0.4]) B.tube([V(tR, y, 0), V(off, y, 0)], 0.3, 4, CK.DARK);
  }
  // instrument ring round the tube's base, a crew can and two dishes
  B.push(TO_Y);
  B.lathe([[tR + 2, -tL / 2 + 2, CK.BRONZE], [tR + 12, -tL / 2 + 4, DK.PORTS], [tR + 12, -tL / 2 + 14, DK.PORTS], [tR + 2, -tL / 2 + 16, CK.BRONZE]], 32, 0, { closedProfile: false });
  B.pop();
  can(c, V(-tR - 24, -tL / 2 + 9, 0), Z, 7, 34);
  truss(B, V(-tR - 12, -tL / 2 + 9, 0), V(-tR - 17, -tL / 2 + 9, 0), 3, 3, 0.2);
  berth(c, V(-tR - 24, -tL / 2 + 9, 17 + 3 + 3), Z, 2.2, 4);
  berth(c, V(0, -tL / 2 - 12, 0), V(0, -1, 0), 2.4, 5);
  for (const s of [-1, 1]) dish(B, V(-tR - 24, -tL / 2 + 9, s * 30), V(0, -1, s * 0.3).normalize(), r.range(5, 9));
  pvWing(c, V(-tR, tL * 0.2, 0), V(-1, 0, 0), Y, r.range(50, 90), 18);
  for (const s of [-1, 1]) radiatorWing(B, V(0, -tL / 4, s * tR), V(0, 0, s), X, r.range(40, 60), 16, c.lamps, LAMP.AMBER);
  c.beacon(V(0, tL / 2 + 3, 0), LAMP.WHITE, 2.6, 4.5);
  c.beacon(V(-tR - 24, -tL / 2 + 18, 0), LAMP.RED, 2, 4, 0.5);
}

/**
 * Anchorage: a lit mooring tower with booms radiating round it, ships lying bow-on at the
 * boom heads while they wait for a berth at the Harbour (their hulls: GeoBelt, from `moored`).
 */
function buildAnchorage(c) {
  const { B, r } = c;
  const H = r.range(60, 90);
  B.push(TO_Y);
  B.lathe([[0.02, -H / 2 - 10, CK.DARK], [10, -H / 2 - 8, CK.HULL], [14, -H / 2, CK.BRONZE], [14, -H / 2 + 4, DK.LIVERY], [12, -8, DK.LIVERY], [16, -6, CK.BRONZE], [16, 6, DK.CONCOURSE], [12, 8, CK.BRONZE],
    [12, H / 2 - 4, DK.GRIME], [14, H / 2, CK.BRONZE], [10, H / 2 + 6, CK.GLASS], [4, H / 2 + 10, CK.HULL], [0.02, H / 2 + 12, CK.HULL]], 28);
  B.pop();
  const tip = mast(B, V(0, H / 2 + 11, 0), Y, 26, 0.35);
  c.beacon(tip, LAMP.WHITE, 3.4, 6);
  c.beacon(V(0, -H / 2 - 11, 0), LAMP.AMBER, 3, 5, 0.5);
  const classes = [['hauler', 3], ['tanker', 12], ['packet', 9], ['hauler', 8], ['tanker', 5], ['packet', 4]];
  const n = r.int(4, 5);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + r.range(-0.1, 0.1);
    const u = V(Math.cos(a), 0, Math.sin(a));
    const y = ((k % 3) - 1) * H * 0.3;
    const len = r.range(110, 150);
    const root = u.clone().multiplyScalar(14).setY(y), head = u.clone().multiplyScalar(14 + len).setY(y);
    truss(B, root, head, 4, 8, 0.3);
    catwalk(B, root.clone().add(V(0, 2.2, 0)), head.clone().add(V(0, 2.2, 0)), Y, 1.4, 1.1);
    c.walks.push({ a: root.clone().addScaledVector(u, 4).add(V(0, 2.28, 0)), b: head.clone().addScaledVector(u, -4).add(V(0, 2.28, 0)), up: Y });
    atAim(B, head, u);
    B.lathe([[3.2, 0, CK.BRONZE], [5, 1.5, DK.HAZARD], [5, 4, CK.DARK], [3, 5, CK.DARK]], 16, 0, { closedProfile: false });
    B.pop();
    c.lamps.push({ p: head.clone().add(V(0, 5, 0)), r: 1.4, color: LAMP.AMBER, i: 3.2, breathe: 0.6, phase: k / n });
    const [cls, seed] = classes[(k + c.r.int(0, 5)) % classes.length];
    if (k < n - 1) c.moored.push({ cls, seed, pos: head.clone().addScaledVector(u, 8 + design(cls, seed).geo.boundingBox.max.z), fwd: u.clone().negate(), up: Y.clone() });
    else berth(c, head.clone().addScaledVector(u, 5), u, 2.6, 4);      // one boom kept free for the tenders
  }
  for (const s of [-1, 1]) pvWing(c, V(0, s * (H / 2 - 10), 0).add(V(0, 0, 0)), V(0, s, 0), X, r.range(40, 70), 18);
}

/**
 * Dry dock: a cradle frame round a ship in for survey and refit, her hull held in padded
 * clamps, floodlit from every corner, service gantries on her flanks, the crews' block beside.
 */
function buildDrydock(c) {
  const { B, r } = c;
  const [cls, seed] = r.pick([['hauler', 3], ['tanker', 5], ['hauler', 8], ['tanker', 12]]);
  // the ship's box (metres, from shipDesigns' seeded hulls): the cradle is sized round it
  const bb = design(cls, seed).geo.boundingBox;
  const box = [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z];
  const Wd = 2 * Math.max(-box[0], box[3]) + 50, Hd = 2 * Math.max(-box[1], box[4]) + 50;
  const z0 = box[2] - 30, z1 = box[5] + 30, L = z1 - z0;
  const nF = Math.max(4, Math.round(L / 60));
  const zs = Array.from({ length: nF }, (_, i) => z0 + (i * L) / (nF - 1));
  for (const z of zs) {
    const a = V(-Wd / 2, -Hd / 2, z), b = V(Wd / 2, -Hd / 2, z), cc = V(Wd / 2, Hd / 2, z), d = V(-Wd / 2, Hd / 2, z);
    truss(B, a, b, 4, 10, 0.3); truss(B, b, cc, 4, 10, 0.3); truss(B, cc, d, 4, 10, 0.3); truss(B, d, a, 4, 10, 0.3);
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) floodAt(c, V(sx * Wd * 0.47, sy * Hd * 0.47, z), V(0, 0, z), 1.4, LAMP.WHITE, 2.8);
  }
  for (const [x, y] of [[-Wd / 2, -Hd / 2], [Wd / 2, -Hd / 2], [Wd / 2, Hd / 2], [-Wd / 2, Hd / 2]]) truss(B, V(x, y, z0), V(x, y, z1), 4, 12, 0.3);
  // service gantries: decks with railings along both flanks, clear of the hull
  for (const s of [-1, 1]) {
    const x = s * (Wd / 2 - 8);
    B.box(x, 0, (z0 + z1) / 2, 8, 1, L * 0.8, CK.DECK);
    railing(B, x - 4, x + 4, (z0 + z1) / 2 - L * 0.4, (z0 + z1) / 2 + L * 0.4, 0.5);
    for (const z of zs) B.tube([V(s * Wd / 2, 0, z), V(x + s * 4, 0, z)], 0.6, 5, CK.DARK);
    c.walks.push({ a: V(x, 0.5, (z0 + z1) / 2 - L * 0.38), b: V(x, 0.5, (z0 + z1) / 2 + L * 0.38), up: Y });
  }
  // cradle arms from the bottom frames to padded pads just under her keel
  for (const z of zs) if (z > box[2] + 10 && z < box[5] - 10) {
    B.tube([V(0, -Hd / 2, z), V(0, box[1] - 1.2, z)], 1.4, 6, CK.DARK);
    B.box(0, box[1] - 1.0, z, 8, 1.2, 4, DK.HAZARD);
  }
  c.moored.push({ cls, seed, pos: V(0, 0, 0), fwd: Z.clone(), up: Y.clone() });
  // the crews' block and a berth for the tenders, beside the frame
  block(c, Wd / 2 + 26, 0, z0 + L * 0.3, 24, 26, 40, [DK.PORTS, DK.CONCOURSE]);
  truss(B, V(Wd / 2 + 2, 0, z0 + L * 0.3), V(Wd / 2 + 14, 0, z0 + L * 0.3), 4, 5, 0.3);
  berth(c, V(Wd / 2 + 38, 0, z0 + L * 0.3), X, 2.6, 5);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) c.beacon(V(sx * Wd / 2, Hd / 2 + 4, sz > 0 ? z1 : z0), LAMP.RED, 3, 5, (sx + sz + 2) * 0.13);
  radiatorWing(B, V(-Wd / 2, -Hd / 2, z0), V(-1, 0, 0), Y, r.range(60, 90), 26, c.lamps, LAMP.AMBER);
}

export const BUILDERS = { anchorage: buildAnchorage, drydock: buildDrydock, comms: buildComms, habitat: buildHabitat, depot: buildDepot, shipyard: buildShipyard, relay: buildRelay, transit: buildTransit, farm: buildFarm, science: buildScience };

/** Build one station of the belt (metres, station frame). */
export function buildBeltStation(kind, seed, livery = 0) {
  const t0 = performance.now();
  const c = new Ctx(seed, livery);
  BUILDERS[kind](c);
  const geo = c.B.geometry();
  let radius = geo.boundingSphere.center.length() + geo.boundingSphere.radius;
  let tris = geo.index.count / 3;
  for (const p of c.parts) {
    p.geo.computeBoundingSphere();
    radius = Math.max(radius, p.pivot.length() + p.geo.boundingSphere.center.length() + p.geo.boundingSphere.radius + (p.travel || 0));
    tris += p.geo.index.count / 3;
  }
  let mooredTris = 0;
  for (const m of c.moored) { const d = design(m.cls, m.seed); radius = Math.max(radius, m.pos.length() + d.radius); mooredTris += d.geo.index.count / 3; }
  return { kind, seed, geo, parts: c.parts, lamps: c.lamps, docks: c.docks, walks: c.walks, welds: c.welds, moored: c.moored, mooredTris, radius, tris, spinR: c.spinR || 0, buildMs: performance.now() - t0 };
}
