import * as THREE from 'three';
import { CB, CK, TAU, V, lerp, rng, here, atAim, tank, rcsQuad, catwalk, dish, mast, flood } from './shipKit.js';
import { LAMP } from './lamps.js';

// THE CONCORD-CLASS LINER, CLOSE TO: the fittings a 2.4 km passenger liner carries on her
// skin, drawn as one overlay geometry that rides the hull (src/craft/craftGeometry.js
// buildLiner, liner-local metres) and is only built when a camera first comes near her.
//
//   stringers       raised hull stringers running bow to stern, so the seed-shaped hull reads
//                   as built plating at every distance
//   promenade       a glazed promenade gallery cantilevered along each flank above the lantern
//                   galleries: deck, sill, mullions, railings, lamps along its length
//   lifeboats       two rows of lifeboat capsules in bronze cradles along the upper flanks,
//                   each with its hatch and a green station lamp
//   atrium rails    railings along both edges of the garden atrium, the walk round the park
//   blisters        observation blisters (glass domes on bronze collars) down the dorsal line
//   antenna farm    dishes and masts round the crown bridge
//   hangar          a lit hangar bay in the keel astern, doors drawn back, a shuttle inside
//   cargo locks     side cargo doors on the lower flanks with floodlights
//   RCS             reaction-control clusters in four quadrants at the bow and the stern
//
// The keel docking collars (and the port shuttles on them) are left clear: nothing is placed
// within KEEL_CLEAR of the keel line. Returns { geo, lamps, rcs, parts }.

const LA = 170, LB = 118, NEXP = 2.3;
const prof = (u) => (u < 0.4 ? 0.62 + 0.38 * Math.sin((Math.PI / 2) * (u / 0.4)) : Math.pow(Math.max(Math.cos((Math.PI / 2) * ((u - 0.4) / 0.6)), 0), 0.8));
export const linerF = (z) => Math.max(prof((z + 1150) / 2400), 0.02);
export const KEEL_CLEAR = 46;       // m either side of the keel line kept free (collars, shuttles)

/** A point on the liner's hull at station z and section angle t (0 starboard-side +x, pi/2 top). */
export function hullPoint(z, t, out = V()) {
  const f = linerF(z), c = Math.cos(t), s = Math.sin(t);
  const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / NEXP) * LA * f;
  let y = Math.sign(s) * Math.pow(Math.abs(s), 2 / NEXP) * LB * f;
  if (y < 0) y *= 0.8;
  return out.set(x, y, z);
}

/** Outward hull normal at (z, t), by differences along the section and the length. */
export function hullNormal(z, t, out = V()) {
  const a = hullPoint(z, t - 0.01), b = hullPoint(z, t + 0.01), c = hullPoint(z - 2, t), d = hullPoint(z + 2, t);
  const tu = b.sub(a), tz = d.sub(c);
  out.crossVectors(tz, tu).normalize();
  // outward: away from the section's centre
  const p = hullPoint(z, t);
  if (out.x * p.x + out.y * p.y < 0) out.negate();
  return out;
}

/**
 * The Harbour's liner pier (src/space/harbour.js) reaches the berthed liner's starboard (-x)
 * upper flank with three gangways, at liner stations about z = -850, -50 and +750 m: the
 * fittings leave those stretches of that flank bare.
 */
export const GANGWAY_Z = [-850, -50, 750];
export function clearOfGangways(p, gap = 70) {
  if (p.x > -20 || p.y < 0) return true;
  for (const z of GANGWAY_Z) if (Math.abs(p.z - z) < gap) return false;
  return true;
}

export function buildLinerDetail(seed = 2400) {
  const r = rng(seed);
  const B = new CB();
  const lamps = [], rcs = [];
  const parts = {};
  const P = V(), N = V();
  const mark = (name) => { parts[name] = B.idx.length / 3; };
  // ---- stringers: 14 raised strakes along the hull (the keel band left clear)
  mark('stringers');
  for (let k = 0; k < 16; k++) {
    const t = (k / 16) * TAU + TAU / 32;
    const p0 = hullPoint(0, t);
    if (p0.y < 0 && Math.abs(p0.x) < KEEL_CLEAR + 20) continue;
    // runs broken where the pier's gangways meet the flank
    let pts = [];
    const flush = () => { if (pts.length > 1) B.tube(pts, 1.1, 5, k % 4 === 0 ? CK.BRONZE : CK.HULL); pts = []; };
    for (let z = -1100; z <= 1180; z += 40) {
      hullPoint(z, t, P); hullNormal(z, t, N);
      if (!clearOfGangways(P)) { flush(); continue; }
      pts.push(P.clone().addScaledVector(N, 0.6));
    }
    flush();
  }
  // ---- promenade galleries on both flanks (t = +-0.32 rad above the waterline gallery)
  mark('promenade');
  for (const side of [1, -1]) {
    const t = side > 0 ? 0.32 : Math.PI - 0.32;
    const z0 = -520, z1 = 760, step = 20;
    let rings = [];
    const flush = () => { if (rings.length > 1) B.loft(rings, (i) => (i === 0 ? CK.DECK : i === 1 ? CK.BRONZE : i === 2 ? CK.GLASS : CK.HULL), { capStart: CK.BRONZE, capEnd: CK.BRONZE }); rings = []; };
    for (let z = z0; z <= z1; z += step) {
      hullPoint(z, t, P);
      if (!clearOfGangways(P, 80)) { flush(); continue; }
      const sx = Math.sign(P.x);
      // section of the gallery (x out from the hull, y up): floor, glazed front sloping in, roof
      const x0 = P.x - sx * 2, x1 = P.x + sx * 7, y = P.y;
      rings.push({ z, pts: [[x0, y - 2.2], [x1, y - 2.2], [x1 + sx * 0.6, y + 1.2], [x1 - sx * 0.8, y + 4.2], [x0, y + 4.6]] });
    }
    flush();
    // mullion posts every 8 m along the glazing and warm lamps along the walk
    for (let z = z0; z <= z1; z += 8) {
      hullPoint(z, t, P);
      if (!clearOfGangways(P, 84)) continue;
      const sx = Math.sign(P.x);
      B.box(P.x + sx * 7.3, P.y - 0.5, z, 0.25, 3.6, 0.25, CK.BRONZE);
      if ((z - z0) % 80 === 0) lamps.push({ p: V(P.x + sx * 7.9, P.y + 1.2, z), r: 0.9, color: [1.0, 0.82, 0.58], i: 1.5, breathe: 0.12, phase: (z - z0) / 400 });
    }
  }
  // ---- lifeboats: capsules in cradles along the upper flanks
  mark('lifeboats');
  for (const side of [1, -1]) {
    const t = side > 0 ? 0.62 : Math.PI - 0.62;
    for (let z = -470; z <= 690; z += 29) {
      hullPoint(z, t, P); hullNormal(z, t, N);
      if (!clearOfGangways(P, 80)) continue;
      const base = P.clone().addScaledVector(N, 3.2);
      // cradle
      B.box(base.x - N.x * 1.6, base.y - N.y * 1.6, z - 4, 1.2, 1.2, 1.2, CK.BRONZE);
      B.box(base.x - N.x * 1.6, base.y - N.y * 1.6, z + 4, 1.2, 1.2, 1.2, CK.BRONZE);
      B.at(base.x, base.y, z);
      tank(B, 2.4, 12, CK.HULL, CK.BRONZE, 10);
      B.pop();
      // the capsule's hatch facing out and its station lamp
      const h = base.clone().addScaledVector(N, 2.45);
      atAim(B, h, N);
      B.box(0, 0, 0, 1.6, 1.8, 0.12, CK.DARK);
      B.pop();
      if (((z + 470) / 29) % 3 === 0) lamps.push({ p: h.clone().addScaledVector(N, 0.3).add(V(0, 0, 3)), r: 0.35, color: LAMP.GREEN, i: 1.3 });
    }
  }
  // ---- atrium walks: railings along both edges of the garden deck
  mark('atriumRails');
  for (const side of [-1, 1]) {
    const a0 = V(), a1 = V();
    const pts = [];
    for (let z = -590; z <= 690; z += 80) {
      const f = linerF(z), top = LB * f - 5, w = LA * f * 0.4;
      pts.push(V(side * (w - 1.2), top + 0.1, z));
    }
    for (let i = 1; i < pts.length; i++) catwalk(B, a0.copy(pts[i - 1]), a1.copy(pts[i]), V(0, 1, 0), 2.2, 1.1);
    for (let i = 0; i < pts.length; i += 2) lamps.push({ p: pts[i].clone().add(V(-side * 1.0, 1.6, 0)), r: 0.5, color: [1.0, 0.78, 0.5], i: 1.4, breathe: 0.1 });
  }
  // ---- observation blisters down the dorsal line, fore of the atrium and astern of the bridge
  mark('blisters');
  for (const z of [760, 830, 900, 970, -900, -960]) {
    hullPoint(z, Math.PI / 2, P);
    B.at(P.x, P.y - 1, z, -Math.PI / 2, 0, 0);
    const R0 = z > 0 ? 9 : 7;
    B.lathe([[R0 + 1.2, -0.5, CK.BRONZE], [R0 + 1.2, 0.8, CK.BRONZE], [R0, 1.0, CK.GLASS], [R0 * 0.8, R0 * 0.55, CK.GLASS], [R0 * 0.45, R0 * 0.8, CK.GLASS], [0.02, R0 * 0.88, CK.GLASS]], 20);
    B.pop();
    lamps.push({ p: V(P.x + R0 + 1.6, P.y + 0.6, z), r: 0.6, color: LAMP.WHITE, i: 1.2 });
  }
  // ---- antenna farm round the crown bridge (z = -760)
  mark('antennas');
  for (let k = 0; k < 6; k++) {
    const z = -700 - (k % 3) * 45, t = Math.PI / 2 + (k < 3 ? 0.42 : -0.42);
    hullPoint(z, t, P); hullNormal(z, t, N);
    if (!clearOfGangways(P, 90)) continue;
    dish(B, P.clone().addScaledVector(N, 4), N.clone().add(V(0, 0.6, k % 2 ? 0.4 : -0.4)).normalize(), 5 + (k % 3) * 2.5);
  }
  for (let k = 0; k < 8; k++) {
    const z = -620 - k * 26, t = Math.PI / 2 + (k % 2 ? 0.25 : -0.25);
    hullPoint(z, t, P); hullNormal(z, t, N);
    const tip = mast(B, P.clone(), N.clone().add(V(0, 0.5, 0)).normalize(), 18 + (k % 3) * 8, 0.35);
    lamps.push({ p: tip, r: 0.9, color: k % 2 ? LAMP.RED : LAMP.WHITE, i: 2.0, breathe: 0.35, phase: k / 8 });
  }
  // ---- the hangar bay in the keel astern (clear of the collars, which start at z = -420)
  mark('hangar');
  {
    // a hangar pod slung under the keel, open astern: the hull is its roof
    const zc = -760, f = linerF(zc), yb = -LB * f * 0.8 + 3;
    const w = 44, h = 16, l = 110, yf = yb - h - 3;
    B.box(0, yb - 2.2, zc, w, 1.2, l, CK.LANTERN);                                   // lit ceiling
    for (const s of [-1, 1]) B.box(s * w / 2, yb - h / 2 - 1.5, zc, 1.6, h + 3, l, CK.HULL);   // side walls
    B.box(0, yb - h / 2 - 1.5, zc + l / 2, w, h + 3, 1.6, CK.HULL);                  // forward bulkhead
    B.box(0, yf, zc, w + 1.6, 1.4, l, CK.HULL);                                      // floor (outside)
    B.box(0, yf + 0.9, zc, w - 3, 0.4, l - 4, CK.DECK);                              // deck (inside)
    // bronze frame round the open mouth and the two door leaves swung wide
    B.box(0, yf, zc - l / 2, w + 3, 2, 2, CK.BRONZE);
    for (const s of [-1, 1]) {
      B.box(s * (w / 2 + 0.8), yb - h / 2 - 1.5, zc - l / 2, 2, h + 4, 2, CK.BRONZE);
      B.at(s * (w / 2 + 1), yb - h / 2 - 1.5, zc - l / 2, 0, s * 1.9, 0);
      B.box(s * 11, 0, 0, 22, h + 2, 0.9, CK.DARK);
      B.pop();
    }
    // a lighter on its cradle inside, with a crew walk to it
    B.at(0, yf + 5, zc + 6);
    B.box(0, 0, 0, 14, 3, 30, CK.HULL);
    B.box(0, 2.6, 10, 8, 2.4, 8, CK.GLASS);
    B.box(0, -2.6, 0, 4, 2.2, 26, CK.BRONZE);
    B.pop();
    catwalk(B, V(w / 2 - 3, yf + 1.1, zc + 40), V(8, yf + 1.1, zc + 40), V(0, 1, 0), 1.4, 1.1);
    for (let i = 0; i < 5; i++) lamps.push({ p: V(-w / 2 + 6 + i * ((w - 12) / 4), yb - 3.2, zc - 20), r: 1.1, color: [1.0, 0.86, 0.66], i: 1.6 });
    lamps.push({ p: V(w / 2 + 2, yf - 1, zc - l / 2), r: 1.3, color: LAMP.AMBER, i: 2.4, breathe: 0.5 }, { p: V(-w / 2 - 2, yf - 1, zc - l / 2), r: 1.3, color: LAMP.AMBER, i: 2.4, breathe: 0.5, phase: 0.5 });
  }
  // ---- cargo locks on the lower flanks, floodlit
  mark('cargoLocks');
  for (const side of [1, -1]) for (const z of [-300, -40, 220, 480]) {
    const t = side > 0 ? -0.5 : Math.PI + 0.5;
    hullPoint(z, t, P); hullNormal(z, t, N);
    if (!clearOfGangways(P, 80)) continue;
    atAim(B, P.clone().addScaledVector(N, 0.4), N);
    B.box(0, 0, 0, 22, 16, 0.8, CK.DARK);
    B.box(0, 8.4, 0.3, 24, 1.2, 1.2, CK.BRONZE); B.box(0, -8.4, 0.3, 24, 1.2, 1.2, CK.BRONZE);
    B.box(11.6, 0, 0.3, 1.2, 17, 1.2, CK.BRONZE); B.box(-11.6, 0, 0.3, 1.2, 17, 1.2, CK.BRONZE);
    for (let i = -2; i <= 2; i++) B.box(i * 4.2, 0, 0.5, 0.3, 15, 0.3, CK.HULL);
    B.pop();
    lamps.push(flood(B, P.clone().addScaledVector(N, 2).add(V(0, 11, 0)), N.clone().add(V(0, -1.2, 0)).normalize(), 1.0, LAMP.WHITE, 1.8));
  }
  // ---- RCS clusters: four quadrants at the bow and the stern
  // ---- cabin lights: warm lamps along the flank window bands (the band of glazing at
  // |cos| 0.55..0.8 on the hull), a few rooms brighter than others, the pier side included
  mark('cabinLamps');
  for (const side of [1, -1]) for (const tb of [0.72, -0.62]) {
    const t = side > 0 ? tb : Math.PI - tb;
    for (let z = -900; z <= 1000; z += 24) {
      hullPoint(z, t, P); hullNormal(z, t, N);
      const warm = 0.8 + 0.6 * r();
      lamps.push({ p: P.clone().addScaledVector(N, 1.2), r: 1.6, color: r() < 0.12 ? [0.85, 0.9, 1.0] : [1.0, 0.78, 0.52], i: warm, dir: N.clone(), breathe: r() < 0.1 ? 0.15 : 0, phase: r() });
    }
  }
  mark('rcs');
  for (const z of [980, -1060]) for (let k = 0; k < 4; k++) {
    const t = TAU * (k / 4) + TAU / 8;
    hullPoint(z, t, P); hullNormal(z, t, N);
    rcs.push(...rcsQuad(B, P.clone().addScaledVector(N, -0.2), N, V(0, 0, 1), 5));
  }
  mark('end');
  const geo = B.geometry();
  void r; void lerp; void here;
  return { geo, lamps, rcs, parts };
}
