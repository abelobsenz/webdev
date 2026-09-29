import * as THREE from 'three';
import { CB, CK, sectionEllipse } from '../craft/craftGeometry.js';
import { lathe, sphere, buildFreighter, buildTug } from '../craft/craftClasses.js';
import { createGlowMesh } from '../craft/craftMaterial.js';
import { craftMesh, craftPart, addEngines, addLamps, placeMerge, placeLamps, pixelRadius, KM, dressedMesh, DK, LIVERIES } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { R_EARTH, GEO_ALT, MERIDIAN_LON, bodyDir } from './sim.js';
import { stationFrame, CORRIDORS } from './stations.js';
import { YardWorks } from './yardWorks.js';
import { StoreWorks } from './storeWorks.js';
import { WaterRun } from './waterRun.js';
import { DynLamps } from './lifeKit.js';
import { HS } from './harbour.js';
import { quadLoft, smoothRange, createPortMaterial, bakeCavity, stamp } from './portMaterial.js';

// THE GEOSTATIONARY ROADS: the Harbour's neighbourhood along the geostationary arc.
//
//   Concord Yard   a building dock east of the Harbour: a Concord-class liner two thirds
//                  plated, her bow still an open skeleton of ribs and stringers, held in
//                  nine portal frames by surveyed clamps; a gantry lowers a hull plate, the
//                  scoop ring waits in the bow frame, the crews live in a wheel astern and
//                  the stock (plates, radiator leaves, cable drums) waits on a keel deck
//   Water Store    hung on the tether below the Harbour: a hollow cage round the ribbon (the
//                  climbers pass through it), three rings of tanks, a crew wheel and radiator
//                  leaves beneath, two tankers berthed bow-in at the upper collars
//   movements      eight freighters that really use the Harbour, one per arm head: in along the arrival lane
//                  (tail first, braking), flip at the gate, glide to a free arm head and dock
//                  bow-in, lie alongside, back out, and leave by the departure gate under power
//
//   the works    the yard's plating, bay cranes, welders, drones, crew pods, stages and keel
//                deck (yardWorks.js); the store's mains, risers, pump houses and drones
//                (storeWorks.js); the water run between them (waterRun.js); docking guidance
//                lamps at the arm heads (below)
//
// Everything is in metres (craft builder and material), placed in the Harbour's local frame
// (x west, y up the tether, z north) and drawn at true size.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const TO_Y = new THREE.Matrix4().makeRotationX(-Math.PI / 2);        // lathe z -> +y

// ------------------------------------------------------------ Concord Yard ----
// The Concord-class hull, as src/craft/craftGeometry.js buildLiner draws it.
const LA = 170, LB = 118;
const linerProf = (u) => (u < 0.4 ? 0.62 + 0.38 * Math.sin((Math.PI / 2) * (u / 0.4)) : Math.pow(Math.max(Math.cos((Math.PI / 2) * ((u - 0.4) / 0.6)), 0), 0.8));
const linerF = (z) => Math.max(linerProf((z + 1150) / 2400), 0.02);
/** A point of the hull section at angle t (the superellipse of the liner's loft). */
export function sectionPoint(z, t, out) {
  const f = linerF(z), c = Math.cos(t), s = Math.sin(t);
  const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / 2.3) * LA * f;
  let y = Math.sign(s) * Math.pow(Math.abs(s), 2 / 2.3) * LB * f;
  if (y < 0) y *= 0.8;
  return out ? out.set(x, y, z) : V(x, y, z);
}

export const YARD = {
  plated: 260,                                                    // bulkhead of the plated hull
  ribs: Array.from({ length: 12 }, (_, k) => 300 + 80 * k),       // 300 .. 1180
  frames: Array.from({ length: 9 }, (_, k) => -1300 + 320 * k),   // -1300 .. 1260
  frameR: 250,                                                    // octagon apothem
  wheelZ: -1640, wheelR: 460,
};

/** Depth of a skeleton rib's web at z: 14 m, less toward the fine bow (never a third of its keel-side radius). */
export const ribDepth = (z) => Math.min(14, 0.3 * Math.abs(sectionPoint(z, 1.5 * Math.PI).y));

/**
 * A web frame round the hull section at z: a closed rectangular-section ring `depth` inboard of
 * the final lines and `thick` along z (n stations round). Every face quad owns its vertices
 * (hard edges), wound outward. Returns nothing; appends to B.
 */
function webFrame(B, z, depth, thick, kind, n = 48) {
  const O = [], I = [];
  for (let i = 0; i < n; i++) {
    const p = sectionPoint(z, (i / n) * TAU), r = Math.hypot(p.x, p.y), s = Math.max(r - depth, 0.5) / r;
    O.push([p.x, p.y]); I.push([p.x * s, p.y * s]);
  }
  const z0 = z - thick / 2, z1 = z + thick / 2, h = V(0, 0, 0);
  let arc = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = O[i], b = O[j], c = I[j], d = I[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, ml = Math.hypot(mx, my) || 1;
    // outer and inner faces (the web's flanges)
    h.set(mx / ml, my / ml, 0);
    let q = [B.v(a[0], a[1], z0, arc, 0, kind), B.v(b[0], b[1], z0, arc + seg, 0, kind), B.v(b[0], b[1], z1, arc + seg, thick, kind), B.v(a[0], a[1], z1, arc, thick, kind)];
    B.tri(q[0], q[1], q[2], h); B.tri(q[0], q[2], q[3], h);
    h.negate();
    q = [B.v(d[0], d[1], z0, arc, depth, kind), B.v(c[0], c[1], z0, arc + seg, depth, kind), B.v(c[0], c[1], z1, arc + seg, depth + thick, kind), B.v(d[0], d[1], z1, arc, depth + thick, kind)];
    B.tri(q[0], q[1], q[2], h); B.tri(q[0], q[2], q[3], h);
    // fore and aft faces (the web plate itself)
    for (const [zz, sg] of [[z0, -1], [z1, 1]]) {
      h.set(0, 0, sg);
      q = [B.v(a[0], a[1], zz, arc, depth, kind), B.v(b[0], b[1], zz, arc + seg, depth, kind), B.v(c[0], c[1], zz, arc + seg, 0, kind), B.v(d[0], d[1], zz, arc, 0, kind)];
      B.tri(q[0], q[1], q[2], h); B.tri(q[0], q[2], q[3], h);
    }
    arc += seg;
  }
}

/** Octagon vertex k of a dock frame (flat sides face up, down, port and starboard). */
const octV = (k, z) => { const a = Math.PI / 8 + k * Math.PI / 4, r = YARD.frameR / Math.cos(Math.PI / 8); return V(Math.cos(a) * r, Math.sin(a) * r, z); };
/** Mid point of the octagon side facing angle phi (a multiple of 45 degrees). */
const octSide = (phi, z) => V(Math.cos(phi) * YARD.frameR, Math.sin(phi) * YARD.frameR, z);

export function buildConcordYard() {
  const H = new CB();          // the ship: plated hull, skeleton, engines (one closed set of solids)
  const B = new CB();          // the dock
  const W = new CB();          // the crew wheel (turns)
  const lamps = [], clamps = [], stock = [];
  // ---- the plated two thirds of the hull, closed by a dark construction bulkhead
  const NR = 48;
  const rings = [];
  const N = 35;
  for (let j = 0; j <= N; j++) {
    const z = lerp(-1150, YARD.plated, j / N);
    const f = linerF(z);
    rings.push({ z, pts: sectionEllipse(LA * f, LB * f, NR, 2.3, 0, 0.8) });
  }
  // one kind per plate (quadLoft): the old per-vertex kinds blended glazing (0) into livery (20)
  // through every kind between, drawing thin bands of foil, hazard and lantern along each seam.
  // Toward the construction front the paint gives out: the last eight rings of plate go ragged
  // from painted to bare working plate, the newest few still dark unfaired insulation.
  const hsh = (i, j) => { const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return x - Math.floor(x); };
  const skin = quadLoft(H, rings, (i, j) => {
    const t = (i + 0.5) / NR, c = Math.cos(t * TAU), sn = Math.sin(t * TAU), side = Math.abs(c);
    const front = (j - (N - 8)) / 8;
    if (front > 0 && hsh(i, j) < front * 1.15) return front > 0.6 && hsh(i + 7, j) < 0.4 ? CK.DARK : DK.GRIME;
    if (j > 10 && side > 0.9 && Math.abs(sn) < 0.22) return CK.LANTERN;
    if (side > 0.55 && side < 0.8) return CK.GLASS;
    return sn < -0.35 ? DK.GRIME : j % 3 === 1 ? DK.PORTS : DK.LIVERY;
  }, { capStart: CK.DARK, capEnd: CK.DARK });
  // the garden atrium over the plated part: planted deck under its colonnade of ribs
  const zA0 = -600, zA1 = 200;
  for (let z = zA0; z <= zA1; z += 26) {
    const f = linerF(z), top = LB * f, w = LA * f * 0.42;
    const arc = [];
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; arc.push(V(Math.cos(a) * w, top - 6 + Math.sin(a) * w * 0.62, z)); }
    H.tube(arc, 2.6, 6, CK.HULL);
  }
  {
    const deck = [];
    for (let j = 0; j <= 16; j++) {
      const z = lerp(zA0, zA1, j / 16), f = linerF(z);
      const w = LA * f * 0.4, top = LB * f - 5;
      deck.push({ z, pts: [[-w, top], [w, top], [w, top - 8], [-w, top - 8]] });
    }
    quadLoft(H, deck, (i) => (i === 0 ? CK.GARDEN : CK.HULL), { capStart: CK.HULL, capEnd: CK.HULL });   // (per-vertex kinds drew a lantern seam: 3 -> 1 through 2)
  }
  // crown bridge astern of the atrium (as on the finished ships)
  {
    const top = LB * linerF(-760);
    H.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    H.at(0, 760, top - 10);
    lathe(H, [[46, 0, CK.HULL], [40, 30, CK.GLASS], [36, 80, CK.GLASS], [52, 96, CK.BRONZE], [48, 110, CK.LANTERN], [30, 126, CK.HULL], [4, 170, CK.HULL], [1, 230, CK.LANTERN]], 28);
    H.pop(); H.pop();
  }
  // engines are fitted first: three great bells and a ring of six
  const bell = (x, y, r) => {
    H.at(x, y, -1150);
    lathe(H, [[r * 0.82, -r * 1.6, CK.DARK], [r, -r * 1.55, CK.DARK], [r * 0.7, -r * 0.9, CK.DARK], [r * 0.45, -r * 0.2, CK.BRONZE], [r * 0.6, 0, CK.HULL],
      [r * 0.5, 0, CK.HULL], [r * 0.35, -r * 0.2, CK.DARK], [r * 0.59, -r * 0.9, CK.DARK], [r * 0.77, -r * 1.55, CK.DARK]], 20, 0, { closedProfile: true });
    H.pop();
  };
  for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + Math.PI / 2; bell(Math.cos(a) * 58, Math.sin(a) * 44, 42); }
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + Math.PI / 6; bell(Math.cos(a) * 88, Math.sin(a) * 58, 16); }
  // ---- the bow, still a skeleton: ribs on the final lines, eight stringers, a keel spine
  const ribLoop = (z, n = 24) => { const pts = []; for (let i = 0; i < n; i++) pts.push(sectionPoint(z, (i / n) * TAU)); pts.push(pts[0].clone()); return pts; };
  // each rib a deep web frame (14 m inboard of the final lines, 5 m thick, working grey) with its
  // bronze face flange on the lines: a 3 m pipe alone was subpixel at the yard's framing and the
  // bow read as a wire cage; the lightening holes of the web show as dark ports along it
  for (const [k, z] of YARD.ribs.entries()) { webFrame(H, z, ribDepth(z), 5, DK.GRIME); H.tube(ribLoop(z, 48), 3.2, 6, CK.BRONZE); }
  const zLast = YARD.ribs[YARD.ribs.length - 1];
  for (let s = 0; s < 8; s++) {
    const t = (s / 8) * TAU;
    const pts = [sectionPoint(YARD.plated - 16, t), ...YARD.ribs.map((z) => sectionPoint(z, t))];
    H.tube(pts, 2.2, 6, CK.DARK);
  }
  H.tube([V(0, 0, YARD.plated - 10), V(0, 0, zLast + 30)], 9, 12, CK.DARK);
  // radial spokes start inside the keel spine's surface, each from its own point, and stop at the
  // web frame's inner face
  for (const [k, z] of YARD.ribs.entries()) for (const t of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) {
    const o = sectionPoint(z, t), r = Math.hypot(o.x, o.y), d = (ribDepth(z) - 0.5) / r;
    if (r * (1 - d) < 12) continue;
    H.tube([V(Math.cos(t) * 7, Math.sin(t) * 7, z), V(o.x * (1 - d), o.y * (1 - d), z)], 3, 8, CK.DARK);
  }
  // welders' lamps along the construction front
  for (const [k, z] of YARD.ribs.entries()) for (const t of [Math.PI / 4, 3 * Math.PI / 4, 1.25 * Math.PI, 1.75 * Math.PI]) {
    if ((k + Math.round(t * 2)) % 3) continue;
    lamps.push({ p: sectionPoint(z, t).multiplyScalar(1).add(V(0, 0, 0)).addScaledVector(sectionPoint(z, t).setZ(0).normalize(), 6), r: 2.4, color: (k % 2) ? LAMP.TEAL : LAMP.WHITE, i: 3.2, breathe: 0.6, phase: (k * 0.37 + t) % 1 });
  }
  const hullGeo = smoothRange(H.geometry(), skin[0], skin[1]);

  // ---- the dock: nine octagonal portal frames, four rails, surveyed clamps
  const probe = new THREE.Mesh(hullGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  probe.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  // Each portal frame is a box truss 26 m deep and 13 m thick (it was a single 16 m pipe, and
  // read as a wire cage): four oxide-red chords, Warren lacing in working grey on its two
  // faces, ties across them at every panel point, bronze nodes at the corners. The inner chords
  // keep the old tube's inner face (apothem 250 m), so the clamps, hatches and walkway brackets
  // still seat on them; the truss deepens outward, clear of the ship.
  const FA = YARD.frameR, FD = 26, FZ = 6.5, NP = 9;
  const corner = (k, a, z) => { const ang = Math.PI / 8 + (k % 8) * Math.PI / 4, r = a / Math.cos(Math.PI / 8); return V(Math.cos(ang) * r, Math.sin(ang) * r, z); };
  // one side's lacing and ties, built once at z = 0 for side 0 and stamped round every frame
  const yardSide = new CB();
  {
    const at = (a, u, dz) => corner(0, a, dz).lerp(corner(1, a, dz), u);
    for (const dz of [-FZ, FZ]) for (let m = 0; m < NP; m++) {
      const u0 = m / NP + 0.004, u1 = (m + 1) / NP - 0.004;      // (ends inside the chord, each its own cap)
      const [a0, a1] = m % 2 ? [FA + FD, FA] : [FA, FA + FD];
      yardSide.tube([at(a0, u0, dz), at(a1, u1, dz)], 1.1, 6, DK.GRIME);
    }
    for (let m = 1; m < NP; m++) for (const a of [FA, FA + FD]) yardSide.tube([at(a, m / NP, -FZ), at(a, m / NP, FZ)], 0.9, 6, DK.GRIME);
    // plated panels: knee plates boxing the truss in at both corners of the side and a painted
    // name panel at its middle, so each portal reads as a massive octagonal frame broken by open
    // lacing rather than a ring of wire (the lacing shows between them)
    const mid = FA + FD / 2, nrm = V(Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), 0);
    const dir = corner(1, mid, 0).sub(corner(0, mid, 0)), sideLen = dir.length();
    dir.normalize();
    for (const [u0, u1, k] of [[0.02, 1.35 / NP, DK.GRIME], [1 - 1.35 / NP, 0.98, DK.GRIME], [3.6 / NP, 5.4 / NP, DK.LIVERY]]) {
      const c = corner(0, mid, 0).lerp(corner(1, mid, 0), (u0 + u1) / 2);
      yardSide.push(new THREE.Matrix4().makeBasis(dir, nrm, V(0, 0, 1)).setPosition(c));
      yardSide.box(0, 0, 0, sideLen * (u1 - u0), FD - 3, 2 * FZ - 1.6, k);
      yardSide.box(0, FD / 2 - 1.2, 0, sideLen * (u1 - u0) + 1, 1.2, 2 * FZ + 1.2, CK.BRONZE);   // capping strip on the outer face
      yardSide.pop();
    }
  }
  for (const z of YARD.frames) {
    for (const a of [FA, FA + FD]) for (const dz of [-FZ, FZ]) {
      const loop = []; for (let k = 0; k < 8; k++) loop.push(corner(k, a, z + dz)); loop.push(loop[0].clone());
      B.tube(loop, 3.2, 8, DK.LIVERY);
    }
    for (let k = 0; k < 8; k++) {
      stamp(B, yardSide, new THREE.Matrix4().makeTranslation(0, 0, z).multiply(new THREE.Matrix4().makeRotationZ(k * Math.PI / 4)));
      const p = octV(k, z), q = corner(k, FA + FD, z);
      B.box(p.x, p.y, p.z, 26, 26, 26, CK.BRONZE);
      B.box(q.x, q.y, q.z, 18, 18, 18, CK.BRONZE);
      lamps.push({ p: q.clone().multiplyScalar((FA + FD + 12) / (FA + FD)), r: 2.2, color: k % 2 ? LAMP.RED : LAMP.WHITE, i: 2.6, breathe: 0.8, phase: (k * 0.13 + z * 0.0007) % 1 });
    }
  }
  for (const k of [1, 2, 5, 6]) B.tube([octV(k, YARD.frames[0]), octV(k, YARD.frames[8])], 6, 8, CK.DARK);
  // cross bracing on the port and starboard faces between frames (the sides stay open above and below)
  for (let i = 0; i < 8; i++) for (const [k0, k1] of [[0, 7], [3, 4]]) {
    const a = octV(k0, YARD.frames[i]), b = octV(k1, YARD.frames[i + 1]);
    B.tube([a, b], 2.4, 6, CK.DARK);
  }
  // clamps: from the flat side of a frame to the surveyed hull (plated part) or to a rib's
  // centreline (skeleton), ending in a bronze pad seated on the surface
  const clampTo = (z, phi) => {
    const root = octSide(phi, z);
    const dir = V(-Math.cos(phi), -Math.sin(phi), 0);
    let end, contact, normal;
    if (z < YARD.plated) {
      ray.set(root, dir); ray.far = 400;
      const hit = ray.intersectObject(probe, false)[0];
      if (!hit) throw new Error('Concord Yard clamp missed the hull');
      contact = hit.point.clone();
      normal = hit.face.normal.clone().normalize();
      if (normal.dot(dir) > 0) normal.negate();
      end = contact.clone().addScaledVector(dir, 3);
      B.push(new THREE.Matrix4().compose(contact.clone().addScaledVector(normal, 1.0), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), normal), V(1, 1, 1)));
      B.box(0, 0, 0, 22, 4, 22, CK.BRONZE);
      B.pop();
    } else {
      contact = sectionPoint(z, phi);
      end = contact.clone();
      normal = dir.clone().negate();
    }
    B.tube([root, end], 4.2, 8, CK.HULL);
    B.at(...root.clone().addScaledVector(dir, 16).toArray());
    B.box(0, 0, 0, 14, 14, 14, CK.BRONZE);
    B.pop();
    clamps.push({ root, contact, end, normal, z, phi });
  };
  for (const z of YARD.frames) {
    if (z <= -1150 - 42 * 1.6) continue;                  // the aft frame carries the house, not the ship
    if (z > zLast + 40) continue;                          // the bow frame holds the scoop ring
    if (z < YARD.plated) { for (const phi of [0, Math.PI / 4, 3 * Math.PI / 4, Math.PI, 1.5 * Math.PI]) clampTo(z, phi); }
    else for (const phi of [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, 1.25 * Math.PI, 1.5 * Math.PI, 1.75 * Math.PI]) clampTo(z, phi);
  }
  // the scoop ring waits in the bow frame, held on four arms
  const zBow = YARD.frames[8];
  B.push(new THREE.Matrix4().makeTranslation(0, 0, zBow));
  B.torus(150, 9, 72, 12, CK.HULL);
  B.torus(138, 3.5, 72, 8, CK.CONDUIT);
  B.pop();
  for (const phi of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) B.tube([octSide(phi, zBow), V(Math.cos(phi) * 150, Math.sin(phi) * 150, zBow)], 4, 8, CK.HULL);
  // gantry crane on the two top rails, lowering a hull plate onto the bow
  {
    const zg = 780, xr = octV(1, 0).x, yr = octV(1, 0).y;
    // a twin box-girder bridge slung under the rails (two 20 m girders in working grey, a deck
    // between them, hazard-banded ends), end carriages on the bogies, a machinery house and a lit
    // cab: the single 16 m beam was a thin line at the yard's framing
    for (const dz of [-10, 10]) B.box(0, yr - 16, zg + dz, 2 * xr + 24, 20, 7, DK.GRIME);
    B.box(0, yr - 6.6, zg, 2 * xr + 24, 1.2, 27.4, CK.DARK);
    for (const x of [-xr + 14, xr - 14]) B.box(x, yr - 16, zg, 12, 20.4, 27.6, DK.HAZARD);
    for (const x of [-xr, xr]) { B.box(x, yr - 3, zg, 22, 18, 36, CK.DARK); B.box(x, yr - 13, zg, 24, 4, 40, CK.BRONZE); }   // end carriages on the rails
    B.box(-44, yr - 3.6, zg, 36, 5, 22, DK.LIVERY);                                // machinery house on the deck
    B.box(-44, yr - 0.7, zg, 38, 0.8, 24, CK.DARK);
    B.box(70, yr - 31, zg + 14, 14, 10, 10, CK.LANTERN);                           // the driver's cab
    B.box(70, yr - 25.6, zg + 14, 15, 0.8, 11, CK.DARK);
    const trolleyY = yr - 6 - 16 - 10;
    B.box(24, trolleyY, zg, 34, 20, 26, CK.DARK);
    B.box(24, trolleyY + 10.5, zg, 36, 1.2, 28, CK.BRONZE);
    const plateTop = LB * linerF(zg) + 95;
    B.tube([V(24, trolleyY - 10, zg), V(24, plateTop + 2, zg)], 1.3, 6, CK.DARK);
    B.box(24, plateTop - 2, zg, 64, 4, 42, CK.HULL);
    B.box(24, plateTop + 1.5, zg, 20, 3, 14, CK.BRONZE);
    lamps.push({ p: V(24, trolleyY - 12, zg), r: 3, color: LAMP.AMBER, i: 2.8, breathe: 0.4 });
    stock.push({ name: 'hoisted plate', min: V(-8, plateTop - 4, zg - 21), max: V(56, plateTop, zg + 21) });
  }
  // keel deck of stock: plates, radiator leaves and cable drums, slung under the bottom rails
  {
    const yr = octV(5, 0).y, deckY = yr - 6 - 30;
    B.box(0, deckY - 6, -250, 380, 12, 900, CK.DARK);
    for (const x of [-190, 190]) B.box(x, deckY - 6, -250, 8, 16, 904, CK.BRONZE);
    for (const z of [-690, -450, -210, 30, 190]) for (const x of [octV(5, 0).x, octV(6, 0).x]) B.tube([V(x, yr, z), V(x, deckY - 2, z)], 3, 6, CK.DARK);
    // plates stacked face to face (alternate sizes so every sheet reads), clear of the hangers
    for (let k = 0; k < 4; k++) for (let h = 0; h < 3 + (k % 2); h++) B.box(-150, deckY + 3 + h * 6, -620 + k * 70, h % 2 ? 54 : 60, 6, h % 2 ? 36 : 40, h % 2 ? CK.BRONZE : CK.HULL);
    // two radiator leaves for the stern, one laid on the other
    for (let h = 0; h < 2; h++) B.box(10, deckY + 3 + h * 6, -250, 90 - h * 6, 6, 360 - h * 12, CK.RADIATOR);
    for (let k = 0; k < 3; k++) {
      B.push(new THREE.Matrix4().makeTranslation(-150, deckY + 22, 20 + k * 60).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
      lathe(B, [[14, -26, CK.BRONZE], [22, -24, CK.BRONZE], [22, -20, CK.DARK], [18, -18, CK.DARK], [18, 18, CK.DARK], [22, 20, CK.DARK], [22, 24, CK.BRONZE], [14, 26, CK.BRONZE]], 20, 0, { closedProfile: true });
      B.pop();
    }
  }
  // ---- the yard house: a hub on the dock's axis astern, struts to the aft frame
  const zw = YARD.wheelZ, zAft = YARD.frames[0];
  B.push(new THREE.Matrix4().makeTranslation(0, 0, 0));
  lathe(B, [[0.1, zw - 170, CK.DARK], [40, zw - 160, CK.BRONZE], [80, zw - 120, CK.HULL], [80, zw + 90, CK.GLASS], [86, zw + 100, CK.BRONZE], [70, zw + 140, CK.HULL], [40, zw + 190, CK.HULL], [0.1, zw + 200, CK.BRONZE]], 32);
  B.pop();
  for (const k of [0, 2, 4, 6]) {
    const v = octV(k, zAft), d = v.clone().setZ(0).normalize();
    B.tube([d.clone().multiplyScalar(30).setZ(zw + 185), v], 5, 8, CK.HULL);
  }
  // the wheel: a glazed habitat ring with a bronze belt, spokes to a transfer collar round the hub
  // (a habitat section, not a glass tube: livery floor plate outward, ported walls, glazed
  // shoulders, the lit concourse roof toward the hub, eight pressure bulkheads)
  {
    const R = YARD.wheelR;
    W.lathe([[R + 35, zw - 38, DK.LIVERY], [R + 35, zw + 38, DK.LIVERY], [R + 10, zw + 38, DK.PORTS], [R - 35, zw + 22, CK.GLASS], [R - 35, zw - 22, DK.CONCOURSE], [R + 10, zw - 38, CK.GLASS], [R + 35, zw - 38, DK.PORTS]], 96, 0, { closedProfile: true });
    for (let k = 0; k < 8; k++) {
      W.push(new THREE.Matrix4().makeTranslation(0, 0, zw).multiply(new THREE.Matrix4().makeRotationZ(((k + 0.5) / 8) * TAU)));
      W.box(R, 0, 0, 74, 9, 82, DK.GRIME);
      W.pop();
    }
  }
  W.push(new THREE.Matrix4().makeTranslation(0, 0, zw));
  W.torus(YARD.wheelR + 36, 6, 96, 6, CK.BRONZE);
  W.pop();
  W.lathe([[84, zw - 40, CK.BRONZE], [100, zw - 34, CK.HULL], [100, zw + 34, CK.HULL], [84, zw + 40, CK.BRONZE]], 32, 0, { closedProfile: true });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4, d = V(Math.cos(a), Math.sin(a), 0);
    W.tube([d.clone().multiplyScalar(96).setZ(zw), d.clone().multiplyScalar(YARD.wheelR - 30).setZ(zw)], 11, 8, CK.HULL);
  }
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; lamps.push({ p: V(Math.cos(a) * (YARD.wheelR + 44), Math.sin(a) * (YARD.wheelR + 44), zw), r: 5, color: LAMP.AMBER, i: 2.0, breathe: 0.25, phase: k / 8 }); }
  // floodlights at the frame corners, nav lamps at the dock's ends
  for (const z of YARD.frames) for (const k of [1, 2, 5, 6]) {
    const p = octV(k, z), o = p.clone().setZ(0).normalize();
    lamps.push({ p: p.clone().addScaledVector(o, 18), r: 4, color: LAMP.WHITE, i: 1.8 });
  }
  lamps.push({ p: octV(0, zBow).add(V(20, 0, 20)), r: 6, color: LAMP.RED, i: 3, dir: V(1, 0, 0) });
  lamps.push({ p: octV(3, zBow).add(V(-20, 0, 20)), r: 6, color: LAMP.GREEN, i: 3, dir: V(-1, 0, 0) });
  const dockGeo = B.geometry();
  probe.material.dispose();
  return { hullGeo, dockGeo, wheelGeo: W.geometry(), lamps, clamps, stock, radius: 1.9, length: 3.2 };
}

// ------------------------------------------------------------- Water Store ----
// Hung on the tether 12.5 km below the Harbour: water and oxygen climb from the ocean and are
// held here for the ships. The tether's ribbon runs up the axis; the climbers ride the guide
// cables 120 m to either side (x), so the whole cage is hollow to 280 m and grips the ribbon
// only on two arms along z, clear of the climbers' 193 m sweep.
export const STORE = { apothem: 280, frames: [-800, -400, 0, 400, 800], rings: [-560, -160, 240], tankR: 95, tankOrbit: 440, berthY: 640, wheelY: -1000, wheelR: 560 };

export function buildWaterStore() {
  const B = new CB(), lamps = [], berths = [], tanks = [], grips = [];
  const ap = STORE.apothem, rv = ap / Math.cos(Math.PI / 8);
  const oct = (k, y) => { const a = Math.PI / 8 + k * Math.PI / 4; return V(Math.cos(a) * rv, y, Math.sin(a) * rv); };
  const side = (phi, y, r = ap) => V(Math.cos(phi) * r, y, Math.sin(phi) * r);
  const F = STORE.frames, yLo = F[0], yHi = F[F.length - 1];
  // the cage: octagonal frames, eight longerons, bronze nodes
  // each ring frame a box truss 24 m deep (it was one 18 m pipe): pearl chords, dark lacing and
  // ties; the inner chords keep the old pipe's inner face, so the ribbon's climbers and the
  // drones inside see the same clear bore
  const SA = ap - 6, SD = 24, SY = 6, SP = 8;
  const sc = (k, a, y) => { const ang = Math.PI / 8 + (k % 8) * Math.PI / 4, r = a / Math.cos(Math.PI / 8); return V(Math.cos(ang) * r, y, Math.sin(ang) * r); };
  const storeSide = new CB();
  {
    const at = (a, u, dy) => sc(0, a, dy).lerp(sc(1, a, dy), u);
    for (const dy of [-SY, SY]) for (let m = 0; m < SP; m++) {
      const [a0, a1] = m % 2 ? [SA + SD, SA] : [SA, SA + SD];
      storeSide.tube([at(a0, m / SP + 0.005, dy), at(a1, (m + 1) / SP - 0.005, dy)], 1.3, 6, DK.GRIME);
    }
    for (let m = 1; m < SP; m++) for (const a of [SA, SA + SD]) storeSide.tube([at(a, m / SP, -SY), at(a, m / SP, SY)], 1, 6, DK.GRIME);
  }
  for (const y of F) {
    for (const a of [SA, SA + SD]) for (const dy of [-SY, SY]) {
      const loop = []; for (let k = 0; k < 8; k++) loop.push(sc(k, a, y + dy)); loop.push(loop[0].clone());
      B.tube(loop, 3, 8, CK.HULL);
    }
    for (let k = 0; k < 8; k++) {
      stamp(B, storeSide, new THREE.Matrix4().makeTranslation(0, y, 0).multiply(new THREE.Matrix4().makeRotationY(-k * Math.PI / 4)));
      const p = oct(k, y), q = sc(k, SA + SD, y);
      B.box(p.x, p.y, p.z, 30, 30, 30, CK.BRONZE);
      B.box(q.x, q.y, q.z, 16, 16, 16, CK.BRONZE);
    }
  }
  for (let k = 0; k < 8; k++) B.tube([oct(k, yLo), oct(k, yHi)], 7, 8, CK.DARK);
  for (let i = 0; i < F.length - 1; i++) for (let k = 0; k < 8; k += 2) B.tube([oct(k, F[i]), oct(k + 1, F[i + 1])], 2.6, 6, CK.DARK);
  // ribbon grips on the middle frame: two arms along z to a sheave block round the ribbon
  for (const sd of [-1, 1]) {
    const root = side(sd * Math.PI / 2, 0), inner = V(0, 0, sd * 26);
    B.tube([root, inner], 8, 8, CK.HULL);
    B.box(0, 0, sd * 26, 40, 60, 16, CK.BRONZE);
    grips.push({ root, inner });
  }
  // tank rings: eight spheres each on radial saddles, bronze belts, alternate rings in bronze
  for (const [ri, y] of STORE.rings.entries()) for (let k = 0; k < 8; k++) {
    // each tank faces a longeron (the vertices sit at odd multiples of 22.5 degrees), so its
    // saddle is radial and every saddle has its own root
    const phi = Math.PI / 8 + (k / 8) * TAU, d = V(Math.cos(phi), 0, Math.sin(phi));
    const c = d.clone().multiplyScalar(STORE.tankOrbit).setY(y);
    const v = oct(k, y);
    B.tube([v, d.clone().multiplyScalar(STORE.tankOrbit - STORE.tankR + 14).setY(y)], 10, 8, CK.HULL);
    B.at(c.x, c.y, c.z); B.push(TO_Y);
    sphere(B, STORE.tankR, ri % 2 ? DK.FOIL : DK.LIVERY, 28, 14);
    B.pop(); B.pop();
    B.push(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    B.torus(STORE.tankR + 1.5, 3.2, 48, 6, ri % 2 ? CK.HULL : CK.BRONZE);
    B.pop();
    tanks.push({ center: c, radius: STORE.tankR, root: v });
  }
  // the crew wheel below the cage: a hollow transfer collar round the tether, spokes, a glazed rim
  const yw = STORE.wheelY;
  B.push(new THREE.Matrix4().makeTranslation(0, yw, 0).multiply(TO_Y));
  lathe(B, [[262, -45, CK.BRONZE], [306, -40, CK.HULL], [306, 40, CK.GLASS], [262, 45, CK.BRONZE]], 48, 0, { closedProfile: true });
  B.pop();
  B.push(new THREE.Matrix4().makeTranslation(0, yw, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  B.torus(STORE.wheelR, 30, 96, 12, CK.GLASS);
  B.torus(STORE.wheelR + 30, 5, 96, 6, CK.BRONZE);
  B.pop();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + Math.PI / 6, d = V(Math.cos(a), 0, Math.sin(a));
    B.tube([d.clone().multiplyScalar(300).setY(yw), d.clone().multiplyScalar(STORE.wheelR - 24).setY(yw)], 10, 8, CK.HULL);
  }
  for (let k = 0; k < 8; k += 2) { const v = oct(k, yLo), d = v.clone().setY(0).normalize(); B.tube([v, d.multiplyScalar(292).setY(yw + 40)], 6, 8, CK.HULL); }
  // radiators: four leaves hung edge-on beneath the wheel, fed down the longerons
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU, d = V(Math.cos(a), 0, Math.sin(a));
    const top = d.clone().multiplyScalar(620).setY(yw - 100);
    B.tube([d.clone().multiplyScalar(STORE.wheelR - 20).setY(yw - 6), top.clone().add(V(0, -20, 0))], 8, 8, CK.DARK);
    // each leaf five ceramic panels hung from a bronze header, coolant risers in the gaps
    // between them and a tie bar along the foot (one 360 x 600 m slab read as a lit billboard)
    B.at(top.x, yw - 420, top.z, 0, -a, 0);
    for (let p = 0; p < 5; p++) B.box(-148 + p * 74, -2, 0, 64, 596, 5, CK.RADIATOR);
    for (let p = 0; p < 6; p++) B.tube([V(-185 + p * 74, 300, 0), V(-185 + p * 74, -300, 0)], 3.2, 6, p % 5 ? CK.DARK : CK.BRONZE);
    B.box(0, 304, 0, 380, 8, 16, CK.BRONZE);
    B.box(0, -303, 0, 380, 6, 10, CK.DARK);
    lamps.push({ p: V(0, -310, 0).applyMatrix4(B.M), r: 3, color: LAMP.RED, i: 3, breathe: 1, phase: k / 4 });
    B.pop();
  }
  // berths: two collars facing out along x at the top level (the ships lie across the ribbon's
  // plane), a tanker bow-in at each
  const tanker = buildFreighter(560);
  tanker.geo.computeBoundingBox();
  const bowTip = tanker.geo.boundingBox.max.z;
  const ships = [];
  for (const sd of [-1, 1]) {
    const y = STORE.berthY, root = side(sd > 0 ? 0 : Math.PI, y);
    // a short bronze-banded collar with a dark docking face
    B.push(new THREE.Matrix4().makeTranslation(root.x, y, 0).multiply(new THREE.Matrix4().makeRotationY(sd * Math.PI / 2)));
    lathe(B, [[30, -14, CK.HULL], [38, 0, CK.BRONZE], [38, 36, CK.BRONZE], [26, 44, CK.LANTERN], [18, 60, CK.DARK], [0.1, 60, CK.DARK]], 20);
    B.pop();
    const face = V(sd * (ap + 60), y, 0);
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -sd * Math.PI / 2);
    const pos = face.clone().add(V(sd * (bowTip - 0.5), 0, 0));
    const m = new THREE.Matrix4().compose(pos, q, V(1, 1, 1));
    ships.push({ geo: tanker.geo, m });
    lamps.push(...placeLamps(tanker.lamps, m, 3));
    berths.push({ face, pos, forward: V(-sd, 0, 0), matrix: m });
    lamps.push({ p: face.clone().add(V(0, 48, 0)), r: 6, color: LAMP.TEAL, i: 2.6, breathe: 0.35, phase: sd > 0 ? 0.5 : 0 });
  }
  for (const [i, y] of STORE.rings.entries()) for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + i * 0.4; lamps.push({ p: V(Math.cos(a) * (STORE.tankOrbit + STORE.tankR + 8), y, Math.sin(a) * (STORE.tankOrbit + STORE.tankR + 8)), r: 6, color: LAMP.AMBER, i: 2.0, breathe: 0.25, phase: (i + k) / 7 }); }
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; lamps.push({ p: V(Math.cos(a) * (STORE.wheelR + 40), yw, Math.sin(a) * (STORE.wheelR + 40)), r: 5, color: LAMP.WHITE, i: 1.8 }); }
  lamps.push({ p: oct(0, yHi + 24), r: 7, color: LAMP.RED, i: 3 }, { p: oct(4, yHi + 24), r: 7, color: LAMP.GREEN, i: 3 });
  return { geo: B.geometry(), ships: placeMerge(ships), lamps, berths, tanks, grips, radius: 1.45 };
}

// ------------------------------------------------------ Harbour movements ----
/** Centripetal-free piecewise path: [{ t (0..1 of the leg), p }] sampled by Catmull-Rom. */
function catmull(pts, s, out) {
  const n = pts.length - 1;
  const x = Math.min(Math.max(s, 0), 1) * n;
  const i = Math.min(Math.floor(x), n - 1), t = x - i;
  const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, n)];
  const t2 = t * t, t3 = t2 * t;
  for (const k of ['x', 'y', 'z']) {
    out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  }
  return out;
}

const _p = new THREE.Vector3(), _p2 = new THREE.Vector3(), _f = new THREE.Vector3(), _f2 = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _m4 = new THREE.Matrix4();
const _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _lz = new THREE.Vector3();
function lookQuat(fwd, upHint, out) {
  const z = _lz.copy(fwd).normalize();
  const x = _lx.crossVectors(upHint, z);
  if (x.lengthSq() < 1e-10) x.set(1, 0, 0).cross(z);
  x.normalize();
  const y = _ly.crossVectors(z, x);
  return out.setFromRotationMatrix(_m4.makeBasis(x, y, z));
}

/**
 * One ship's cycle through the Harbour, in the Harbour's frame (km). Phases (fractions of T):
 *   in    arrival lane, tail first under a braking burn, to the gate
 *   flip  turn nose-in at the gate while coasting onto the approach
 *   glide approach path round the outside of the arms to the staging point off the arm head
 *   dock  the last kilometres along the arm's axis, bow to the docking face
 *   stay  berthed (engines cold, lamps lit)
 *   back  backs out to the staging point on thrusters
 *   turn  swings onto the departure path, which keeps outside the arms and wings
 *   out   departure lane under power, out past the gate into the road
 */
export const PHASES = [['in', 0.15], ['flip', 0.03], ['glide', 0.1], ['dock', 0.04], ['stay', 0.4], ['back', 0.03], ['turn', 0.09], ['out', 0.16]];
export function movementPhase(u) {
  let a = 0;
  for (const [name, w] of PHASES) { if (u < a + w) return [name, (u - a) / w]; a += w; }
  return ['out', 1];
}

export function movementPose(u, c, outPos, outFwd) {
  const [ph, s] = movementPhase(u);
  let thr = 0;
  if (ph === 'in') {
    const k = 1 - s;
    outPos.copy(c.gateA).addScaledVector(c.dA, c.S * k * k);
    outFwd.copy(c.dA);
    thr = smooth(0, 0.08, s) * (1 - smooth(0.8, 0.98, s));
  } else if (ph === 'flip') {
    catmull(c.approach, 0, outPos);
    outPos.copy(c.gateA).lerp(outPos, smooth(0, 1, s));
    catmull(c.approach, 0.02, _f2).sub(c.approach[0]).normalize();
    outFwd.copy(c.dA).lerp(_f2, smooth(0.1, 0.9, s));
    if (outFwd.lengthSq() < 1e-6) outFwd.copy(_f2);
    outFwd.normalize();
  } else if (ph === 'glide') {
    const e = smooth(0, 1, s);
    catmull(c.approach, e, outPos);
    catmull(c.approach, Math.min(e + 0.01, 1), _p2);
    _f.subVectors(_p2, outPos);
    if (_f.lengthSq() < 1e-10) _f.copy(c.dockDir);
    outFwd.copy(_f.normalize());
    thr = 0.18 * (1 - smooth(0, 0.2, s)) + 0.12 * smooth(0.75, 0.9, s) * (1 - smooth(0.92, 1, s));
  } else if (ph === 'dock') {
    outPos.copy(c.stage).lerp(c.berth, smooth(0, 1, s));
    outFwd.copy(c.dockDir);
  } else if (ph === 'stay') {
    outPos.copy(c.berth);
    outFwd.copy(c.dockDir);
  } else if (ph === 'back') {
    outPos.copy(c.berth).lerp(c.stage, smooth(0, 1, s));
    outFwd.copy(c.dockDir);
  } else if (ph === 'turn') {
    const e = smooth(0, 1, s);
    catmull(c.departure, e, outPos);
    catmull(c.departure, Math.min(e + 0.01, 1), _p2);
    _f.subVectors(_p2, outPos).normalize();
    // the ship pivots from its berthing heading onto the path during the first third
    outFwd.copy(c.dockDir).lerp(_f, smooth(0, 0.35, s)).normalize();
    thr = 0.25 * smooth(0.3, 0.5, s);
  } else {
    outPos.copy(c.gateD).addScaledVector(c.dD, c.S * s * s);
    outFwd.copy(c.dD);
    thr = 0.3 + 0.85 * smooth(0, 0.1, s);
  }
  return thr;
}

/** Arm geometry (km, Harbour frame) from buildHarbour's arm records (drawn metres). */
export function armDock(arm) {
  const tipR = (arm.L + 780 * 0.42) * KM;                  // the arm head's dark docking face
  return { d: arm.d.clone(), tip: arm.d.clone().multiplyScalar(tipR).setY(arm.y * KM), y: arm.y * KM, tipR };
}

/** Choreography for one movement: arrival path to arm `armIndex`, departure path back out. */
export function movementPlan(arms, armIndex, { scale = 0.85, S = 420, T = 1600, offset = 0, lift = 0, lane = 0 } = {}) {
  const dA = CORRIDORS.dA.clone().normalize(), dD = CORRIDORS.dD.clone().normalize();
  // each ship keeps to its own lane of the three-lane road (1.3 km apart, inside the gate ring)
  const side = (d) => new THREE.Vector3().crossVectors(d, V(0, 1, 0)).normalize().multiplyScalar(lane * 1.3);
  const dock = armDock(arms[armIndex]);
  const bow = 530 * (1100 / 1100) * scale * KM;             // freighter bow tip ahead of its centre
  const berth = dock.tip.clone().addScaledVector(dock.d, bow + 0.0005);
  const stage = berth.clone().addScaledVector(dock.d, 3.2);
  const gateA = dA.clone().multiplyScalar(21).add(V(0, lift, 0)).add(side(dA));
  const gateD = dD.clone().multiplyScalar(21).add(V(0, lift, 0)).add(side(dD));
  // approach: from the gate, keep outside the arm ring (radius > 13 km) and come in along the arm
  const out = (p, r, y) => p.clone().setY(0).normalize().multiplyScalar(r).setY(y);
  const approach = [gateA.clone(), gateA.clone().lerp(out(stage, 17, stage.y + 3), 0.55), out(stage, 13 + dock.tipR * 0.35, stage.y + 0.6), stage.clone()];
  const departure = [stage.clone(), out(stage, 13 + dock.tipR * 0.35, stage.y + 1.2)];
  return { dA, dD, S, T, offset, scale, dock, berth, stage, gateA, gateD, dockDir: dock.d.clone().negate(), approach, departure, arm: armIndex };
}

/** Departure waypoints that go round the outside of the Harbour from a stage point to the gate. */
export function routeAround(from, to, r = 16.5, yLift = 3) {
  const a0 = Math.atan2(from.z, from.x), a1 = Math.atan2(to.z, to.x);
  let da = a1 - a0;
  while (da > Math.PI) da -= TAU;
  while (da < -Math.PI) da += TAU;
  const pts = [];
  const n = Math.max(1, Math.ceil(Math.abs(da) / 0.7));
  for (let k = 1; k < n; k++) {
    const a = a0 + (da * k) / n, t = k / n;
    pts.push(V(Math.cos(a) * r, lerp(from.y, to.y, t) + yLift * Math.sin(Math.PI * t), Math.sin(a) * r));
  }
  return pts;
}

// ------------------------------------------------------------- escort tugs ----
/**
 * Every arm head keeps an escort tug on its stand (src/space/harbour.js). It meets its ship at
 * the staging point, rides her flank (250 m ahead of her centre, 95 m out) while she docks, goes
 * home while she lies alongside, fetches her again, walks her back out to the staging point and
 * returns. Harbour frame, km. stand: { pos (km), lat, fwd }. Returns the throttle.
 */
export const ESCORT = { along: 0.25, lateral: 0.095 };
const _sp = new THREE.Vector3(), _sf = new THREE.Vector3(), _fl = new THREE.Vector3(), _rv = new THREE.Vector3(), _lat = new THREE.Vector3();
export function escortWeights(u) {
  const [ph, s] = movementPhase(u);
  let a = 0, b = 0;
  if (ph === 'glide') { a = smooth(0.5, 0.88, s); b = smooth(0.9, 1.0, s); }
  else if (ph === 'dock' || ph === 'back') { a = 1; b = 1; }
  else if (ph === 'stay') { b = 1 - smooth(0, 0.12, s) + smooth(0.86, 1, s); a = 0; }
  else if (ph === 'turn') { b = 1 - smooth(0.22, 0.38, s); a = 1 - smooth(0.42, 0.85, s); }
  return { a, b, ph, s };
}
function flankOf(pos, fwd, c, stand, out) {
  const k = Math.sign(_lat.crossVectors(c.dockDir, V(0, 1, 0)).dot(stand.lat)) || 1;
  _lat.crossVectors(fwd, V(0, 1, 0)).normalize().multiplyScalar(k);
  return out.copy(pos).addScaledVector(fwd, ESCORT.along * c.scale / 0.85).addScaledVector(_lat, ESCORT.lateral);
}
export function escortPose(u, c, stand, outPos, outFwd) {
  const { a, b } = escortWeights(u);
  movementPose(u, c, _sp, _sf);
  _sf.normalize();
  flankOf(c.stage, c.dockDir, c, stand, _rv);
  flankOf(_sp, _sf, c, stand, _fl);
  outPos.copy(stand.pos).lerp(_rv, a).lerp(_fl, b);
  outFwd.copy(stand.fwd).lerp(_sf, b).normalize();
  const moving = (a > 0.001 && a < 0.999) || (b > 0.001 && b < 0.999);
  return moving ? 0.35 : 0;
}

// ------------------------------------------------------------- the module ----
/** Scene integration: the Yard, the Store and the movements, each its own depth-sliced body. */
export class GeoRoads {
  constructor(space) {
    this.space = space;
    const el = space.elevator;
    const up = bodyDir(0, MERIDIAN_LON);
    this.frameQ = stationFrame(up);
    this.origin = up.clone().multiplyScalar(R_EARTH + GEO_ALT);
    const place = (g, local, qLocal) => {
      g.position.copy(local).applyQuaternion(this.frameQ).add(this.origin);
      g.quaternion.copy(this.frameQ).multiply(qLocal);
      space.earthFixed.add(g);
    };
    // ---- Concord Yard, 24 km east along the arc; the hull's bow points east (-x)
    this.yardData = buildConcordYard();
    this.yard = new THREE.Group();
    const qYard = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, 1), V(0, 1, 0), V(-1, 0, 0)));
    this.yardLocal = YARD_POS.clone();
    place(this.yard, this.yardLocal, qYard);
    // the dressed finishes with baked cavity shade (baked on first approach, _bakeNear)
    const yOpts = { accent: [1.0, 0.72, 0.45], lit: 0.6, livery: [0.58, 0.2, 0.12], livery2: [0.88, 0.84, 0.74] };
    const ym = craftMesh(this.yardData.dockGeo, yOpts, createPortMaterial(yOpts));
    ym.add(craftPart(ym, this.yardData.hullGeo));
    this.yardWheel = craftPart(ym, this.yardData.wheelGeo);
    ym.add(this.yardWheel);
    addLamps(ym, this.yardData.lamps, { minPx: 1.2 });
    this.yard.add(ym);
    this.yardMesh = ym;
    // the work on her: plating, bay cranes, welders, drones, crew pods, platforms (yardWorks.js)
    this.yardWorks = new YardWorks(ym);
    const _c = new THREE.Vector3();
    this.yardBody = space.addBody('concordYard', [this.yard], () => this.yard.getWorldPosition(_c), this.yardData.radius, { solid: true, hint: 0.5 });
    // ---- Water Store, south-west of the Harbour, its spine along the arc
    this.storeData = buildWaterStore();
    this.store = new THREE.Group();
    place(this.store, STORE_POS.clone(), new THREE.Quaternion());
    const sOpts = { accent: [0.55, 0.9, 1.0], lit: 0.55, livery: [0.82, 0.8, 0.74], livery2: [0.16, 0.42, 0.52] };
    const sm = craftMesh(this.storeData.geo, sOpts, createPortMaterial(sOpts));
    sm.add(craftPart(sm, this.storeData.ships));
    addLamps(sm, this.storeData.lamps, { minPx: 1.2 });
    this.store.add(sm);
    // its plumbing, plant rooms, tank galleries and inspection drones (storeWorks.js)
    this.storeWorks = new StoreWorks(sm, this.storeData);
    const _c2 = new THREE.Vector3();
    this.storeBody = space.addBody('waterStore', [this.store], () => this.store.getWorldPosition(_c2), this.storeData.radius, { solid: true, hint: 0.5 });
    // ---- movements through the Harbour
    const arms = el.station.data.arms;
    this.plans = MOVEMENTS.map((m) => {
      const c = movementPlan(arms, m.arm, m);
      c.departure = [c.stage.clone(), c.stage.clone().addScaledVector(c.dock.d, 1.6), ...routeAround(c.stage, c.gateD, 16.5, 2.5), c.gateD.clone().addScaledVector(c.dD, -3), c.gateD.clone()];
      c.approach = [c.gateA.clone(), c.gateA.clone().addScaledVector(c.dA, -3), ...routeAround(c.gateA, c.stage, 17, 1.5), c.stage.clone().addScaledVector(c.dock.d, 2.2), c.stage.clone()];
      return c;
    });
    const fr = buildFreighter(1100);
    // the escort tugs: children of the Harbour (its frame, km), one on each arm head's stand
    const tug = buildTug(80);
    this.stands = el.station.data.stands.map((st) => ({ ...st, pos: st.pos.clone().multiplyScalar(KM) }));
    this.escorts = this.plans.map((c) => {
      const m = craftMesh(tug.geo, { accent: [0.55, 0.9, 1.0], lit: 0.5 });
      const engines = addEngines(m, tug.glows, { scale: 0.7, length: 7, throttle: 0 });
      addLamps(m, tug.lamps, { minPx: 1.2 });
      el.harbour.add(m);
      return { mesh: m, engines, stand: this.stands[c.arm], pos: new THREE.Vector3(), fwd: new THREE.Vector3() };
    });
    this.movers = this.plans.map((c, i) => {
      const g = new THREE.Group();
      const m = dressedMesh(fr.geo, { accent: [0.55, 0.85, 1.0], lit: 0.5, livery: LIVERIES[i % LIVERIES.length][0], livery2: LIVERIES[i % LIVERIES.length][1] });
      m.scale.setScalar(KM * c.scale);
      const engines = addEngines(m, fr.glows, { scale: 0.62, length: 16, color: 0x7fd8ff, throttle: 0 });
      // lamps and the drive glow ride a holder at the hull's scale, so they stay when the hull is culled
      const holder = new THREE.Object3D();
      holder.scale.setScalar(KM * c.scale);
      const glow = createGlowMesh(fr.glows, { color: [0.55, 0.8, 1.0], strength: 2.0, scale: KM * c.scale });
      holder.add(glow);
      addLamps(holder, fr.lamps, { minPx: 1.3 });
      g.add(m, holder);
      space.scene.add(g);
      const _w = new THREE.Vector3();
      space.addBody(`movement${i}`, [g], () => g.getWorldPosition(_w), 1100 * KM * c.scale * 0.5 + 0.4, { solid: true, hint: 0.45 });
      return { group: g, mesh: m, engines, glow, c, pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1) };
    });
    // docking guidance: a ring of lamps round every arm head's docking collar that chases
    // toward the face while its freighter comes in, holds steady green while she lies
    // alongside and breathes amber as she backs out (drawn metres, the Harbour life holder)
    this.guideN = 12;
    const gl = [];
    for (const arm of arms) {
      const up = V(0, 1, 0), side = arm.side;
      for (let k = 0; k < this.guideN; k++) {
        const a = (k / this.guideN) * TAU;
        const p = arm.d.clone().multiplyScalar(arm.L + 420 * HS).addScaledVector(side, Math.cos(a) * 600 * HS).addScaledVector(up, Math.sin(a) * 600 * HS);
        p.y += arm.y;
        gl.push({ p, r: 7, color: LAMP.AMBER, i: 2.6 });
      }
    }
    this.guide = new DynLamps(gl, { minPx: 1.2 });
    el.station.life.root.add(this.guide.mesh);
    this.guideCol = this.guide.C.array;
    // the water run: a tanker between the Water Store and the yard (waterRun.js)
    this.waterRun = new WaterRun(space);
    this._q = new THREE.Quaternion();
    this._w = new THREE.Vector3();
  }

  /** Pose of movement i at real time t (Harbour frame, km), for verification and targets. */
  localPose(i, t, outPos, outFwd) {
    const c = this.movers[i].c;
    const u = (((t / c.T) + c.offset) % 1 + 1) % 1;
    return movementPose(u, c, outPos, outFwd);
  }

  /** Docking guidance for arm i's freighter at cycle fraction u: [mode, fraction] (0 off, 1 chase, 2 steady, 3 backing). */
  guideState(u) {
    const [ph, s] = movementPhase(u);
    if ((ph === 'glide' && s > 0.55) || ph === 'dock') return 1;
    if (ph === 'stay') return 2;
    if (ph === 'back') return 3;
    return 0;
  }

  updateGuide(t) {
    const n = this.guideN, C = this.guideCol;
    for (let i = 0; i < this.movers.length; i++) {
      const c = this.movers[i].c;
      const u = (((t / c.T) + c.offset) % 1 + 1) % 1;
      const mode = this.guideState(u);
      const arm = c.arm;
      for (let k = 0; k < n; k++) {
        const j = (arm * n + k) * 4;
        let g = 0, r = 1, gr = 0.6, b = 0.22;                       // amber
        if (mode === 1) { const ph = ((k / n - t * 0.8) % 1 + 1) % 1; g = 0.15 + 1.2 * Math.max(0, 1 - ph * 5); }
        else if (mode === 2) { g = 0.8; r = 0.16; gr = 1.0; b = 0.42; }  // green
        else if (mode === 3) g = 0.5 + 0.4 * Math.sin(t * 1.5);
        C[j] = r * 2.6 * g; C[j + 1] = gr * 2.6 * g; C[j + 2] = b * 2.6 * g;
      }
    }
    this.guide.C.needsUpdate = true;
  }

  update(sim, realTime, dt, space) {
    this.updateGuide(realTime);
    const q = this._q.copy(sim.earthQuat).multiply(this.frameQ);
    const o = this._w.copy(this.origin).applyQuaternion(sim.earthQuat);
    for (const [i, mv] of this.movers.entries()) {
      const thr = this.localPose(i, realTime, mv.pos, mv.fwd);
      mv.group.position.copy(mv.pos).applyQuaternion(q).add(o);
      lookQuat(mv.fwd, _p.set(0, 1, 0), mv.group.quaternion);
      mv.group.quaternion.premultiply(q);
      for (const e of mv.engines) e.setThrottle(thr);
      mv.glow.material.uniforms.uStrength.value = 2.0 * thr;
      mv.glow.visible = thr > 0.02;
      // sub-pixel far out on the roads: only its lamps remain
      const px = pixelRadius(space.camera, mv.group.position, 0.55 * mv.c.scale, space.size.y);
      mv.mesh.visible = px > 0.35;
    }
    this.waterRun.update(realTime, q, o, space, lookQuat);
    // escort tugs ride their ships' flanks in and out, and wait on their stands between
    for (const [i, e] of this.escorts.entries()) {
      const c = this.movers[i].c;
      const u = (((realTime / c.T) + c.offset) % 1 + 1) % 1;
      const thr = escortPose(u, c, e.stand, e.pos, e.fwd);
      e.mesh.position.copy(e.pos);
      lookQuat(e.fwd, _p.set(0, 1, 0), e.mesh.quaternion);
      for (const g of e.engines) g.setThrottle(thr);
    }
    // the crew wheel turns slowly (0.3 g at its rim, a comfortable working weight)
    this.yardWheel.rotation.z = (realTime * Math.sqrt(2.94 / (YARD.wheelR + 38))) % TAU;
    // (body objects are shown per depth slice: cull through the body record)
    const yardPx = pixelRadius(space.camera, this.yard.getWorldPosition(this._w), this.yardData.radius, space.size.y);
    if (this.yardBody) this.yardBody.visible = yardPx > 0.5;
    this.yardWorks.update(realTime, yardPx);
    // cavity shade baked the first time each works fills a good part of the view (~12 ms and
    // ~4 ms, once, off the entry path; until then aOcc reads 0)
    if (!this._yardBaked && yardPx > 60) { this._yardBaked = true; for (const g of [this.yardData.dockGeo, this.yardData.hullGeo, this.yardData.wheelGeo]) bakeCavity(g, { minCell: 6 }); }
    const storePx = pixelRadius(space.camera, this.store.getWorldPosition(this._w), this.storeData.radius, space.size.y);
    if (this.storeBody) this.storeBody.visible = storePx > 0.5;
    this.storeWorks.update(realTime, storePx);
    if (!this._storeBaked && storePx > 60) { this._storeBaked = true; bakeCavity(this.storeData.geo, { minCell: 4 }); }
  }
}

/** Positions in the Harbour frame (km): the yard east along the arc, the store south-west. */
export const YARD_POS = V(-16, -8, -2);
export const STORE_POS = V(0, -12.5, 0);
/**
 * The movements: a freighter for every one of the eight arm heads, on one 2,600 s cycle, their
 * offsets and lanes scheduled (a searched timetable) so no two ships come within 5 km of each
 * other near the Harbour: at any moment three or four lie alongside, the rest are on the roads.
 */
export const MOVEMENTS = [
  { arm: 0, scale: 0.9, offset: 0.1354, lane: -1, T: 2600 },
  { arm: 1, scale: 0.8, offset: 0.0356, lane: 0, T: 2600 },
  { arm: 2, scale: 0.85, offset: 0.9018, lane: 1, T: 2600 },
  { arm: 3, scale: 0.75, offset: 0.5078, lane: 0, T: 2600 },
  { arm: 4, scale: 0.8, offset: 0.752, lane: -1, T: 2600 },
  { arm: 5, scale: 0.85, offset: 0.386, lane: 0, T: 2600 },
  { arm: 6, scale: 0.9, offset: 0.281, lane: -1, T: 2600 },
  { arm: 7, scale: 0.8, offset: 0.6535, lane: 1, T: 2600 },
];

/** Focus targets for the neighbourhood (merged into the space target list; analytic poses). */
export function geoRoadTargets(space) {
  const sim = space.sim;
  const up = bodyDir(0, MERIDIAN_LON), fq = stationFrame(up), origin = up.clone().multiplyScalar(R_EARTH + GEO_ALT);
  const at = (local) => (o) => o.copy(local).applyQuaternion(fq).add(origin).applyQuaternion(sim.earthQuat);
  const frame = (q) => q.copy(sim.earthQuat).multiply(fq);
  return {
    concordYard: { position: at(YARD_POS.clone().add(V(0, 0, 0))), frame, minDist: 0.6, maxDist: 200000, defaultDist: 4.4, view: { az: 0.75, el: 0.3 } },
    waterStore: { position: at(STORE_POS), frame, minDist: 0.6, maxDist: 200000, defaultDist: 5.5, view: { az: 2.2, el: 0.25 } },
  };
}
