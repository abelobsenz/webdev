import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { LAMP } from './lamps.js';
import { HK, facadeKind, treeKind } from './haloMaterial.js';

// The Halo's architecture, second pass: what each kilometre cell of a district tile holds,
// built in metres (x across the ring, y up from its radius, z along it) into four layers:
//
//   B  major  - massing seen from 60 km: set-back towers, courtyard blocks under tiled roofs,
//               stepped terraces, lakes, plazas, halls; every roof and street its own kind
//   M  minor  - within 18 km: trees and woods, balconies, shopfront light, boats, stalls
//   N  fine   - within 8 km: railings, street trees, rooftop plant, pier fins, fountain jets
//   F  far    - silhouettes instanced for 180 km beyond the window
//
// Districts differ in palette (stone, terracotta, render, brick, ceramic, rose), roof habit
// (pitched or flat and planted), tree species and lamp colour, so the band reads as a chain
// of distinct towns rather than one grey pattern. Lamps come in two sets: `lamps` (beacons,
// crowns, stations; always drawn with the tile) and `flamps` (street lamps; fine range only),
// so a distant district glows through its windows and streets instead of a speckle of sprites.

const TAU = Math.PI * 2;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const toY = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const rotY90 = new THREE.Matrix4().makeRotationY(Math.PI / 2);

export const LAMPC = {
  WARM: [1.0, 0.74, 0.46], SODIUM: [1.0, 0.58, 0.26], COOL: [0.78, 0.88, 1.0], ROSE: [1.0, 0.42, 0.62],
  TEAL: LAMP.TEAL, VIOLET: [0.72, 0.52, 1.0], LEAF: [0.7, 1.0, 0.62], RED: LAMP.RED, WHITE: LAMP.WHITE, AMBER: LAMP.AMBER,
};

/** Per-variant character: palette, roof habit, tree species mix, street lamp colour. */
export const DISTRICT_STYLE = [
  { pal: 0, pitched: 0.55, trees: [0, 1, 0, 2], street: LAMPC.SODIUM, accent: LAMPC.WARM },      // residential: limestone
  { pal: 1, pitched: 0.8, trees: [1, 4, 0, 3], street: LAMPC.WARM, accent: LAMPC.AMBER },         // agrarian: terracotta
  { pal: 2, pitched: 0.2, trees: [0, 1, 2, 0], street: LAMPC.COOL, accent: LAMPC.COOL },          // civic: white render
  { pal: 3, pitched: 0.35, trees: [0, 4, 0, 1], street: LAMPC.SODIUM, accent: LAMPC.AMBER },      // works: brick
  { pal: 4, pitched: 0.5, trees: [1, 3, 1, 0], street: LAMPC.LEAF, accent: LAMPC.TEAL },          // lakeland: ceramic
  { pal: 5, pitched: 0.4, trees: [3, 2, 0, 1], street: LAMPC.ROSE, accent: LAMPC.VIOLET },        // markets: rose
  { pal: 2, pitched: 0.3, trees: [0, 3, 1, 2], street: LAMPC.WARM, accent: LAMPC.TEAL },          // harbour towns under the arches
];

/** A glass-survey drone (4 m across): a pod, four ducted rotors, a lit sensor bar underneath. */
export function buildDrone() {
  const B = new CB();
  B.box(0, 0, 0, 1.6, 0.9, 2.4, CK.HULL);
  B.box(0, -0.55, 0, 1.2, 0.2, 1.8, CK.LANTERN);
  for (const x of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) {
    B.box(x * 0.55, 0.1, z * 0.55, 1.2, 0.12, 0.2, CK.DARK);
    B.box(x, 0.2, z, 1.3, 0.3, 1.3, CK.BRONZE);
  }
  return B.geometry();
}

/** A person, 1.75 m: legs, coat (the canvas kind: every colour going), head. +z forward. */
export function buildPerson() {
  const B = new CB();
  for (const x of [-0.12, 0.12]) B.box(x, 0.42, 0, 0.14, 0.84, 0.16, CK.DARK);
  B.box(0, 1.14, 0, 0.46, 0.64, 0.26, HK.AWNING);
  B.box(0, 1.6, 0, 0.2, 0.26, 0.22, CK.DECK);
  return B.geometry();
}

/** A harbour ferry (fleet 0) or a sailing boat (fleet 1), +z forward, waterline at y = 0. */
export function buildHarbourBoat(fleet) {
  const B = new CB();
  if (fleet === 0) {
    B.loft([{ z: -11, pts: [[-2.6, 0.2], [2.6, 0.2], [3.2, 2.6], [-3.2, 2.6]] }, { z: 8, pts: [[-2.6, 0.2], [2.6, 0.2], [3.2, 2.6], [-3.2, 2.6]] }, { z: 12, pts: [[-0.4, 0.6], [0.4, 0.6], [0.8, 2.8], [-0.8, 2.8]] }], CK.HULL, { capStart: CK.DARK, capEnd: CK.HULL });
    B.box(0, 4.2, -1.5, 5.4, 3.2, 14, CK.GLASS);
    B.box(0, 5.9, -1.5, 5.8, 0.4, 15, CK.BRONZE);
    B.box(0, 2.9, -1.5, 6.5, 0.5, 18, CK.LANTERN);
    B.box(0, 7.4, -5, 1.2, 2.6, 1.2, CK.DARK);
  } else {
    B.loft([{ z: -4.5, pts: [[-1.1, 0.1], [1.1, 0.1], [1.4, 1.2], [-1.4, 1.2]] }, { z: 3, pts: [[-1.1, 0.1], [1.1, 0.1], [1.4, 1.2], [-1.4, 1.2]] }, { z: 5, pts: [[-0.1, 0.4], [0.1, 0.4], [0.2, 1.3], [-0.2, 1.3]] }], CK.HULL, { capStart: CK.DECK, capEnd: CK.HULL });
    B.box(0, 7, 0.4, 0.2, 12, 0.2, CK.BRONZE);
    // the mainsail: a thin triangle between the mast and the boom's end (lofted across x)
    B.push(rotY90);
    const sail = [[-0.4, 1.6], [-0.4, 12.6], [4.2, 1.6]];
    B.loft([{ z: -0.04, pts: sail }, { z: 0.04, pts: sail }], HK.AWNING, { capStart: HK.AWNING, capEnd: HK.AWNING });
    B.pop();
  }
  return B.geometry();
}

// ------------------------------------------------------------ kit ----
export function latheAt(B, x, y, z, prof, seg = 16, closed = false, phase = 0) {
  B.push(new THREE.Matrix4().makeTranslation(x, y, z).multiply(toY));
  lathe(B, prof, seg, phase, closed ? { closedProfile: true } : undefined);
  B.pop();
}
/** Box standing on the deck across its footprint, its foot sunk under the lowest deck point. */
export function standBox(B, S, x, z, sx, sz, h, k, sink = 16) {
  const lo = Math.min(S.deck(x - sx / 2), S.deck(x + sx / 2)), hi = Math.max(S.deck(x - sx / 2), S.deck(x + sx / 2));
  const y0 = lo - sink, top = hi + h;
  B.box(x, (y0 + top) / 2, z, sx, top - y0, sz, k);
  return top;
}
/**
 * A mass for the silhouette layer: four walls in one kind and a roof in another, no floor
 * (10 triangles). From 26 km out a block reads by its roof - tiles, planted terraces, dark glass
 * - so the mid and far districts show the roofscape the full tiles have, not bare grey slabs.
 */
export function massBox(F, S, cx, cz, sx, sz, top, wallK, roofK) {
  const y0 = Math.min(S.deck(cx - sx / 2), S.deck(cx + sx / 2)) - 8, hx = sx / 2, hz = sz / 2;
  const faces = [
    [[1, 0, 0], [[hx, y0, -hz], [hx, top, -hz], [hx, top, hz], [hx, y0, hz]], wallK],
    [[-1, 0, 0], [[-hx, y0, -hz], [-hx, y0, hz], [-hx, top, hz], [-hx, top, -hz]], wallK],
    [[0, 0, 1], [[-hx, y0, hz], [hx, y0, hz], [hx, top, hz], [-hx, top, hz]], wallK],
    [[0, 0, -1], [[-hx, y0, -hz], [-hx, top, -hz], [hx, top, -hz], [hx, y0, -hz]], wallK],
    [[0, 1, 0], [[-hx, top, -hz], [-hx, top, hz], [hx, top, hz], [hx, top, -hz]], roofK],
  ];
  for (const [n, q, k] of faces) {
    const ids = q.map(([x, y, z]) => F.v(cx + x, y, cz + z, n[0] ? z + cz : x + cx, n[1] ? z + cz : y, k));
    const h = new THREE.Vector3(...n);
    F.tri(ids[0], ids[1], ids[2], h); F.tri(ids[0], ids[2], ids[3], h);
  }
  return top;
}
/** Highest deck point under a footprint across x. */
export const deckHi = (S, x, sx) => Math.max(S.deck(x - sx / 2), S.deck(x + sx / 2));
/** Half-round vault along z on the deck (glasshouses, galleries, station halls). */
export function vault(B, x, y, z0, z1, half, h, kind, rib = CK.BRONZE, n = 12, steps = 4) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; pts.push([x + Math.cos(a) * half, y + Math.sin(a) * h]); }
  pts.push([x - half, y - 12], [x + half, y - 12]);
  const rings = [];
  for (let j = 0; j <= steps; j++) rings.push({ z: z0 + ((z1 - z0) * j) / steps, pts });
  B.loft(rings, (i) => (i <= n ? kind : CK.HULL), { capStart: rib, capEnd: rib });
}
export function ribArc(B, x, y, z, half, h, r, k = CK.BRONZE, n = 8) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; pts.push(V3(x + Math.cos(a) * (half + r), y + Math.sin(a) * (h + r), z)); }
  B.tube(pts, r, 5, k);
}
/** Pitched roof: a prism with its ridge along z (or x), eaves at y. Gable ends take capK. */
export function gableRoof(B, x, y, z, w, h, len, k, capK, alongX = false) {
  B.push(new THREE.Matrix4().makeTranslation(x, y, z).multiply(alongX ? rotY90 : new THREE.Matrix4()));
  const pts = [[-w / 2, 0], [0, h], [w / 2, 0]];
  B.loft([{ z: -len / 2, pts }, { z: len / 2, pts }], k, { capStart: capK, capEnd: capK });
  B.pop();
}
/** A tree: canopy (a low-poly crown) on a trunk. The crown goes to layer L, the trunk to T. */
export function tree(L, T, x, y, z, s, species) {
  // a five-sided double cone (10 triangles): the crown's silhouette without its cost
  const k = treeKind(species);
  latheAt(L, x, y + s * 0.3, z, [[0, 0, k], [s * 0.48, s * 0.4, k], [0, s * 0.72, k]], 5, false, (species * 1.3) % 1.2);
  if (T) T.box(x, y + s * 0.18, z, s * 0.07 + 0.3, s * 0.36, s * 0.07 + 0.3, CK.DARK);
}
/** Railing along a straight edge (top rail and posts as two thin boxes). */
function railing(N, x, y, z, lx, lz) {
  N.box(x, y + 1.1, z, Math.max(lx, 0.12), 0.12, Math.max(lz, 0.12), CK.BRONZE);
  N.box(x, y + 0.55, z, Math.max(lx, 0.05) * (lx > lz ? 1 : 0.4) + 0.02, 1.0, Math.max(lz, 0.05) * (lz > lx ? 1 : 0.4) + 0.02, CK.DARK);
}
/** A walking loop for the people of the district (rectangle half sizes a x b, or circle radius a). */
function walk(C, type, cx, cz, a, b, y) { if (C.walks) C.walks.push(type, cx, cz, a, b, y); }
function pickTree(C) { const t = C.style.trees; return t[Math.floor(C.r() * t.length)]; }

// ------------------------------------------------------------ buildings ----
/** A tower on a podium in two to four set-back tiers, garden terraces on each step. */
function setbackTower(C, cx, cz, sx, sz, hmax, fk) {
  const { B, M, N, S, r, F } = C;
  const y0 = deckHi(S, cx, sx);
  const pod = standBox(B, S, cx, cz, sx, sz, 8 + r() * 14, fk);
  B.box(cx, pod + 0.8, cz, sx - 8, 1.6, sz - 8, HK.ROOFGARDEN);
  if (F) massBox(F, S, cx, cz, sx, sz, pod + 1.6, fk, HK.ROOFGARDEN);
  // shopfronts: a band of light along both street faces, and awnings over the pavement
  for (const s of [-1, 1]) {
    M.box(cx, y0 + 4.2, cz + s * (sz / 2 + 0.4), sx * 0.86, 2.0, 0.6, HK.NEON);
    if (s > 0) N.box(cx, y0 + 6.2, cz + s * (sz / 2 + 2.2), sx * 0.7, 0.4, 4.0, HK.AWNING);
  }
  const th = Math.min(hmax - (pod - y0), 70 + r() * r() * 440);
  let tw = Math.min(sx - 24, 40 + r() * 60), td = Math.min(sz - 24, 40 + r() * 60);
  let tx = cx + (r() - 0.5) * (sx - tw) * 0.4, tz = cz + (r() - 0.5) * (sz - td) * 0.4;
  const tiers = th > 260 ? 4 : th > 170 ? 3 : th > 110 ? 2 : 1;
  const glassy = r() < 0.5;
  const frac = [[1], [0.62, 0.38], [0.48, 0.32, 0.2], [0.4, 0.28, 0.2, 0.12]][tiers - 1];
  let y = pod + 1.6;
  if (F) F.box(tx, (pod + pod + th) / 2, tz, tw, th, td, glassy ? CK.GLASS : fk);
  for (let t = 0; t < tiers; t++) {
    const h = th * frac[t];
    const k = t === 0 ? (glassy ? CK.GLASS : fk) : (glassy ? CK.GLASS : (t % 2 ? CK.GLASS : fk));
    B.box(tx, y + h / 2, tz, tw, h, td, k);
    // a lit band at each set-back (the tiers read as rings of light at night)
    B.box(tx, y + h - 2.5, tz, tw + 0.8, 2.4, td + 0.8, t === tiers - 1 ? CK.LANTERN : CK.BRONZE);
    // balconies on the long faces of stone tiers
    if (k !== CK.GLASS) for (let yy = y + 10.8; yy < y + h - 6; yy += 10.8) N.box(tx, yy, tz + (t % 2 ? 1 : -1) * (td / 2 + 0.9), tw * 0.8, 0.3, 1.8, CK.DECK);
    else for (let yy = y + 28.8; yy < y + h - 6; yy += 28.8) N.box(tx, yy, tz, tw + 0.6, 0.5, td + 0.6, CK.BRONZE);   // floor lines
    y += h;
    if (t < tiers - 1) {
      // the set-back: next tier narrower, its terrace planted and railed
      const nw = tw * (0.7 + r() * 0.12), nd = td * (0.7 + r() * 0.12);
      M.box(tx, y + 0.6, tz, tw - 2, 1.2, td - 2, HK.ROOFGARDEN);
      railing(N, tx, y + 1.2, tz + td / 2 - 1, tw - 2, 0.1);
      railing(N, tx, y + 1.2, tz - td / 2 + 1, tw - 2, 0.1);
      tx += (r() - 0.5) * (tw - nw) * 0.5; tz += (r() - 0.5) * (td - nd) * 0.5;
      tw = nw; td = nd;
    }
  }
  // crown: a lantern drum, a planted roof, or a bronze spire; masts and beacons on the tall
  const cr = r();
  if (cr < 0.35) {
    latheAt(B, tx, y - 0.5, tz, [[0.1, 0, CK.BRONZE], [Math.min(tw, td) * 0.42, 0, CK.BRONZE], [Math.min(tw, td) * 0.42, 9, CK.LANTERN], [Math.min(tw, td) * 0.3, 14, CK.BRONZE], [0.1, 16, CK.BRONZE]], 12);
  } else if (cr < 0.7) {
    B.box(tx, y + 0.6, tz, tw - 4, 1.2, td - 4, HK.ROOFGARDEN);
    for (let q = 0; q < 3; q++) tree(N, null, tx + (r() - 0.5) * (tw - 12), y + 1.2, tz + (r() - 0.5) * (td - 12), 5 + r() * 3, pickTree(C));
  } else {
    latheAt(B, tx, y - 0.5, tz, [[0.1, 0, CK.BRONZE], [Math.min(tw, td) * 0.5, 0, CK.BRONZE], [Math.min(tw, td) * 0.12, Math.min(40, th * 0.12), CK.BRONZE], [0.1, Math.min(60, th * 0.18), CK.BRONZE]], 4);
  }
  // rooftop plant and a maintenance hoist
  for (let q = 0; q < 1; q++) N.box(tx + (q ? 1 : -1) * tw * 0.25, y + 3, tz + (r() - 0.5) * td * 0.4, tw * 0.18, 6, td * 0.2, q ? CK.HULL : CK.DARK);
  if (th > 200) {
    M.box(tx + tw / 2 - 4, y + 18, tz + td / 2 - 4, 1.6, 36, 1.6, CK.DARK);
    C.lamps.push({ p: V3(tx + tw / 2 - 4, y + 38, tz + td / 2 - 4), r: 4, color: LAMPC.RED, i: 2.8, breathe: 0.5, phase: r() });
  }
  if (th > 140) C.lamps.push({ p: V3(tx, y + 18, tz), r: 5, color: C.style.accent, i: 1.8, breathe: 0.15, phase: r() });
}

/** Perimeter block: four wings round a planted court, tiled or planted roofs, a corner turret. */
function courtBlock(C, cx, cz, sx, sz, hmax, fk) {
  const { B, M, N, S, r } = C;
  const wing = 15 + r() * 8, pitched = r() < C.style.pitched;
  const base = Math.min(hmax, 14 + r() * 26);
  let maxTop = 0;
  const wings = [
    [cx - sx / 2 + wing / 2, cz, wing, sz, false], [cx + sx / 2 - wing / 2, cz, wing, sz, false],
    // (the cross wings stand a hair inside the long ones' ends: no edge is shared between boxes)
    [cx, cz - sz / 2 + wing / 2 + 0.3, sx - 2 * wing, wing - 0.6, true], [cx, cz + sz / 2 - wing / 2 - 0.3, sx - 2 * wing, wing - 0.6, true],
  ];
  wings.forEach(([x, z, w, d, alongX], q) => {
    const h = base + (q % 2 ? 3.6 : 0) * Math.round(r() * 2);
    const k = r() < 0.2 ? facadeKind(C.style.pal + 1) : fk;
    const top = standBox(B, S, x, z, w, d, h, k);
    maxTop = Math.max(maxTop, top);
    if (pitched) {
      gableRoof(B, x, top, z, (alongX ? d : w) + 1.2, 5 + (alongX ? d : w) * 0.22, (alongX ? w : d) + (alongX ? 0 : 1.2), HK.TILE, k, alongX);
      // dormers and chimneys on the long slopes
      const L = alongX ? w : d;
      if (q < 2) for (let t = -L / 2 + 14; t < L / 2 - 10; t += 40 + r() * 16) {
        const px = alongX ? x + t : x + (r() < 0.5 ? -1 : 1) * w * 0.18, pz = alongX ? z + (r() < 0.5 ? -1 : 1) * d * 0.18 : z + t;
        N.box(px, top + 2.4, pz, 2.4, 3.2, 2.4, k);
      }
    } else {
      M.box(x, top + 0.5, z, w - 3, 1, d - 3, HK.ROOFGARDEN);
      N.box(x, top + 2.5, z, Math.min(w, 8), 4, Math.min(d, 8), CK.DARK);
    }
    // loggias of light at the court side, shopfront band at the street side
    M.box(x + (alongX ? 0 : (q === 0 ? 1 : -1) * (w / 2 + 0.3)), deckHi(S, x, w) + 4, z + (alongX ? (q === 2 ? 1 : -1) * (d / 2 + 0.3) : 0), alongX ? w * 0.8 : 0.5, 2, alongX ? 0.5 : d * 0.8, HK.NEON);
  });
  // (silhouette: the block under its roofs - tiles to the ridge line, or planted flat roofs)
  if (C.F) massBox(C.F, S, cx, cz, sx, sz, maxTop + (pitched ? 4 + wing * 0.11 : 1), fk, pitched ? HK.TILE : HK.ROOFGARDEN);
  // the court: lawn, a tree or three, a lamp
  standBox(B, S, cx, cz, sx - 2 * wing - 2, sz - 2 * wing - 2, 0.9, HK.ROOFGARDEN, 6);
  const nt = 2 + Math.floor(r() * 3);
  for (let t = 0; t < nt; t++) {
    const x = cx + (r() - 0.5) * (sx - 2 * wing - 20), z = cz + (r() - 0.5) * (sz - 2 * wing - 20);
    tree(M, null, x, deckHi(S, x, 1) + 0.9, z, 9 + r() * 7, pickTree(C));
  }
  C.flamps.push({ p: V3(cx, deckHi(S, cx, 1) + 5, cz), r: 1.6, color: LAMPC.WARM, i: 1.6 });
  // a corner turret with a pyramid cap on some blocks
  if (r() < 0.4) {
    const s = r() < 0.5 ? -1 : 1, t2 = r() < 0.5 ? -1 : 1, x = cx + s * (sx / 2 - wing / 2), z = cz + t2 * (sz / 2 - wing / 2);
    const top = standBox(B, S, x, z, wing + 4, wing + 4, base + 14, fk);
    latheAt(B, x, top, z, [[0.1, 0, HK.TILE], [(wing + 4) * 0.72, 0, HK.TILE], [0.1, 12, HK.TILE]], 4);
  }
}

/** Stepped terraces: storeys stepping down to the south, a garden on every step. */
function steppedBlock(C, cx, cz, sx, sz, hmax, fk) {
  const { B, M, N, S, r } = C;
  const steps = 3 + Math.floor(r() * 3), alongX = r() < 0.5, L = alongX ? sx : sz, dir = r() < 0.5 ? -1 : 1;
  const storey = 3.6 * (2 + Math.floor(r() * 2));
  for (let i = 0; i < steps; i++) {
    const w = L * (1 - i / steps), c = -dir * (L - w) / 2, h = Math.min(hmax, storey * (i + 1));
    const x = alongX ? cx + c : cx, z = alongX ? cz : cz + c;
    const top = standBox(B, S, x, z, alongX ? w : sx - 0.5 * i, alongX ? sz - 0.5 * i : w, h, fk);
    if (C.F && i === steps - 1) massBox(C.F, S, cx, cz, sx, sz, deckHi(S, cx, sx) + (top - deckHi(S, cx, sx)) * 0.55, fk, HK.ROOFGARDEN);
    // the exposed step of this storey band (the part the next one does not cover)
    const ew = L / steps, ec = -dir * (L - w) / 2 + dir * (w / 2 - ew / 2);
    const gx = alongX ? cx + ec : cx, gz = alongX ? cz : cz + ec;
    if (i < steps - 1 || true) {
      M.box(gx, top + 0.6, gz, alongX ? ew - 2 : sx - 2, 1.2, alongX ? sz - 2 : ew - 2, HK.ROOFGARDEN);
      const ex = alongX ? gx + dir * (ew / 2 - 1) : gx, ez = alongX ? gz : gz + dir * (ew / 2 - 1);
      railing(N, ex, top + 1.2, ez, alongX ? 0.1 : sx - 2, alongX ? sz - 2 : 0.1);
      if (i % 2 === 0) tree(N, null, gx, top + 1.2, gz, 4 + r() * 2, pickTree(C));
    }
  }
}

/** A tower going up: its concrete core and floor plates, open top storeys, a tower crane. */
export const CRANE_JIB = { len: 40, back: 14, mastW: 2.4 };
function constructionSite(C, cx, cz, sx, sz, hmax) {
  const { B, M, N, S, r } = C;
  const y0 = standBox(B, S, cx, cz, sx, sz, 0.8, CK.DECK, 10);
  const tw = 36 + r() * 22, td = 36 + r() * 22, built = Math.min(hmax - 80, 40 + r() * 110);
  // the core rises ahead of the floors; plates on columns up to the working level
  B.box(cx, y0 + (built + 14) / 2, cz, tw * 0.32, built + 14, td * 0.32, CK.DARK);
  for (let yy = y0 + 3.6; yy < y0 + built; yy += 3.6) B.box(cx, yy, cz, tw, 0.5, td, CK.DECK);
  for (const [sx2, sz2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box(cx + sx2 * (tw / 2 - 0.6), y0 + built / 2, cz + sz2 * (td / 2 - 0.6), 1.0, built, 1.0, CK.DARK);
  // the finished lower storeys already glazed
  B.box(cx, y0 + built * 0.25, cz, tw - 0.4, built * 0.5, td - 0.4, CK.GLASS);
  // hoarding round the site, lit
  for (const s of [-1, 1]) { M.box(cx, y0 + 1.5, cz + s * (sz / 2 - 2), sx - 6, 3, 0.3, HK.AWNING); M.box(cx + s * (sx / 2 - 2), y0 + 1.5, cz, 0.3, 3, sz - 6, HK.AWNING); }
  // the tower crane's mast beside the core (its jib slews, HaloDistricts life)
  const mx = cx + tw / 2 + 6, mz = cz, top = y0 + built + 36;
  B.box(mx, (y0 + top) / 2, mz, CRANE_JIB.mastW, top - y0, CRANE_JIB.mastW, CK.BRONZE);
  for (let yy = y0 + 12; yy < top; yy += 24) N.box(mx - 3.2, yy, mz, 6.4, 0.5, 0.5, CK.BRONZE);   // ties to the core
  C.lamps.push({ p: V3(mx, top + 8, mz), r: 2.5, color: LAMPC.RED, i: 2.4, breathe: 0.6, phase: r() });
  C.flamps.push({ p: V3(cx, y0 + built + 4, cz), r: 3, color: LAMPC.COOL, i: 2.0 });   // work lights on the deck
  if (C.cranes) C.cranes.push(mx, top, mz, r() * TAU);
}

/** The slewing part of a tower crane: jib, counter-jib and weights, cab, trolley and hook. */
export function buildCraneJib() {
  const B = new CB(), L = CRANE_JIB.len, K = CRANE_JIB.back;
  B.box(0, 1.2, (L - K) / 2, 1.8, 1.8, L + K, CK.BRONZE);
  B.box(0, 3.6, 0, 1.6, 3.4, 1.6, CK.BRONZE);                   // the peak
  B.box(0, 0.4, -K + 2, 3.2, 3, 4, CK.DARK);                      // counterweights
  B.box(1.6, 0.2, 1.6, 1.8, 2.2, 2.2, CK.GLASS);                  // cab
  B.box(0, -0.2, L * 0.6, 1.2, 0.8, 2, CK.DARK);                  // trolley
  B.box(0, -9, L * 0.6, 0.08, 17, 0.08, CK.DARK);                 // hoist line
  B.box(0, -17.8, L * 0.6, 1.2, 1.2, 1.2, CK.LANTERN);            // hook block, lit
  return B.geometry();
}

function pocketSquare(C, cx, cz, sx, sz) {
  const { B, M, N, S, r } = C;
  const y = standBox(B, S, cx, cz, sx, sz, 1.2, HK.STONE, 10);
  walk(C, 1, cx, cz, Math.min(sx, sz) * 0.16 + 6, 0, y);
  // a round basin and its jet
  const R = Math.min(sx, sz) * 0.16;
  latheAt(B, cx, y - 0.2, cz, [[R - 1.6, 0, HK.STONE], [R + 1.6, 0, HK.STONE], [R + 1.6, 1.4, HK.STONE], [R - 1.6, 1.4, HK.STONE]], 16, true);
  latheAt(B, cx, y - 0.2, cz, [[0.1, 0, HK.WATER], [R - 1.5, 0, HK.WATER], [R - 1.5, 0.9, HK.WATER], [0.1, 0.9, HK.WATER]], 16);
  N.tube([V3(cx, y + 0.7, cz), V3(cx, y + 9, cz)], 0.8, 6, HK.WATER);
  for (let t = 0; t < 8; t++) {
    const a = (t / 8) * TAU + r() * 0.3, d = R + 16 + r() * (Math.min(sx, sz) * 0.3 - R);
    tree(M, N, cx + Math.cos(a) * d, y, cz + Math.sin(a) * d, 8 + r() * 6, pickTree(C));
  }
  M.box(cx + sx * 0.3, y + 3, cz - sz * 0.3, 8, 6, 8, HK.NEON);
  C.lamps.push({ p: V3(cx, y + 11, cz), r: 2.5, color: C.style.accent, i: 1.6, breathe: 0.25, phase: r() });
}

export function townCell(C, x0, x1, z0, z1) {
  const { B, N, S, r } = C;
  const nb = 4, bw = (x1 - x0) / nb, bd = (z1 - z0) / nb;
  const hmax = Math.min(S.roofLow(x0), S.roofLow(x1)) - Math.max(S.deck(x0), S.deck(x1)) - 350;
  standBox(B, S, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 0.5, HK.STREET, 8);
  for (let i = 0; i < nb; i++) for (let j = 0; j < nb; j++) {
    const cx = x0 + (i + 0.5) * bw, cz = z0 + (j + 0.5) * bd, sx = bw - 36, sz = bd - 36;
    const pave = standBox(B, S, cx, cz, sx + 10, sz + 10, 0.9, HK.STONE, 6);            // pavements
    walk(C, 0, cx, cz, sx / 2 + 2.5, sz / 2 + 2.5, pave);
    const roll = r(), fk = facadeKind(C.style.pal + (r() < 0.25 ? (r() < 0.5 ? 1 : 5) : 0));
    if (roll < 0.1) pocketSquare(C, cx, cz, sx, sz);
    else if (roll < 0.135) constructionSite(C, cx, cz, sx, sz, hmax);
    else if (roll < 0.38) setbackTower(C, cx, cz, sx, sz, hmax, fk);
    else if (roll < 0.78) courtBlock(C, cx, cz, sx, sz, hmax, fk);
    else steppedBlock(C, cx, cz, sx, sz, hmax, fk);
    // street lamps at the corners and a row of street trees on every other block
    for (const [s, t] of [[-1, -1], [1, 1]]) {
      const lx = cx + s * (sx / 2 + 11), lz = cz + t * (sz / 2 + 11), ly = S.deck(lx);
      if (s > 0) N.box(lx, ly + 4.5, lz, 0.35, 9, 0.35, CK.DARK);
      C.flamps.push({ p: V3(lx, ly + 9.4, lz), r: 1.3, color: C.style.street, i: 1.5 });
    }
    if ((i + 2 * j) % 4 === 0) for (let t = -sx / 2 + 14; t < sx / 2 - 10; t += 30) {
      const tx = cx + t, tz = cz - sz / 2 - 8;
      tree(N, null, tx, S.deck(tx) + 0.9, tz, 7 + r() * 3, pickTree(C));
    }
    if ((i + j) % 2 === 0) C.lamps.push({ p: V3(x0 + i * bw + 8, S.deck(x0 + i * bw) + 9, z0 + j * bd + 8), r: 2.5, color: C.style.street, i: 1.4 });
  }
}

// ------------------------------------------------------------ open ground ----
export function parkCell(C, x0, x1, z0, z1, lakeFrac) {
  const { B, M, N, S, r, F } = C;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
  const yg = standBox(B, S, cx, cz, sx, sz, 1.5, CK.GARDEN, 12);
  if (F) standBox(F, S, cx, cz, sx, sz, 1.5, CK.GARDEN, 12);
  let lake = null;
  if (lakeFrac > 0) {
    // an oval lake with a stone quay, an island, boats and a boathouse
    const lx = cx + (r() - 0.5) * sx * 0.2, lz = cz + (r() - 0.5) * sz * 0.2, R = sx * lakeFrac * 0.5, e = 0.7 + r() * 0.3;
    const y = deckHi(S, lx, 2 * R);
    lake = { lx, lz, R, e };
    B.push(new THREE.Matrix4().makeTranslation(lx, 0, lz).multiply(new THREE.Matrix4().makeScale(1, 1, e)));
    latheAt(B, 0, y + 1.0, 0, [[0.1, 0, HK.WATER], [R, 0, HK.WATER], [R, 1.1, HK.WATER], [0.1, 1.1, HK.WATER]], 28);
    latheAt(B, 0, y + 0.6, 0, [[R - 1, 0, HK.STONE], [R + 7, 0, HK.STONE], [R + 7, 2.6, HK.STONE], [R - 1, 2.6, HK.STONE]], 28, true);
    if (F) latheAt(F, 0, y + 1.0, 0, [[0.1, 0, HK.WATER], [R, 0, HK.WATER], [R, 1.1, HK.WATER], [0.1, 1.1, HK.WATER]], 10);
    // island mound with a pavilion
    const ir = R * 0.16, ia = r() * TAU, ix = Math.cos(ia) * R * 0.4, iz = Math.sin(ia) * R * 0.4;
    latheAt(B, ix, y + 1.5, iz, [[0.1, 0, CK.GARDEN], [ir, 0, CK.GARDEN], [ir * 0.6, 6, CK.GARDEN], [0.1, 8, CK.GARDEN]], 10);
    B.pop();
    const isx = lx + ix, isz = lz + iz * e;
    for (let t = 0; t < 5; t++) tree(M, N, isx + (r() - 0.5) * ir, y + 5, isz + (r() - 0.5) * ir * e, 9 + r() * 6, pickTree(C));
    C.lamps.push({ p: V3(isx, y + 20, isz), r: 3, color: C.style.accent, i: 1.6, breathe: 0.3, phase: r() });
    // boats: hulls with a mast or a canopy, moored and afloat
    for (let t = 0; t < 6; t++) {
      const a = r() * TAU, d = R * (0.55 + r() * 0.35), bx = lx + Math.cos(a) * d, bz = lz + Math.sin(a) * d * e, rot = r() * TAU;
      M.at(bx, y + 2.6, bz, 0, rot, 0);
      M.box(0, 0, 0, 2.6, 1.2, 8, t % 3 ? CK.HULL : HK.AWNING);
      M.box(0, 1.1, -0.8, 2, 1.0, 3, t % 2 ? CK.GLASS : CK.DECK);
      N.at(bx, y + 2.6, bz, 0, rot, 0); N.box(0, 5, 0.6, 0.2, 9, 0.2, CK.BRONZE); N.pop();
      M.pop();
    }
    // the boathouse on its pier, lit
    const px = lx + R + 2, py = y + 3.2;
    M.box(px - 20, py, lz, 40, 1.2, 8, CK.DECK);
    B.box(px + 10, py + 5, lz, 22, 10, 16, facadeKind(C.style.pal));
    gableRoof(B, px + 10, py + 10, lz, 23, 6, 17, HK.TILE, facadeKind(C.style.pal));
    C.lamps.push({ p: V3(px - 38, py + 4, lz), r: 2.5, color: LAMPC.WARM, i: 1.8 });
    for (let t = 0; t < 12; t++) {
      const a = (t / 12) * TAU;
      C.flamps.push({ p: V3(lx + Math.cos(a) * (R + 5), y + 7, lz + Math.sin(a) * (R + 5) * e), r: 1.4, color: C.style.street, i: 1.4 });
    }
  }
  // a pavilion under a small conservatory dome (clear of the lake)
  let px = cx + (r() - 0.5) * sx * 0.6, pz = cz + (r() - 0.5) * sz * 0.6;
  if (lake && Math.hypot(px - lake.lx, (pz - lake.lz) / lake.e) < lake.R + 60) { px = x0 + 80; pz = z0 + 80; }
  const py = S.deck(px);
  latheAt(B, px, py - 6, pz, [[0.1, 0, CK.DECK], [46, 0, CK.DECK], [46, 8, CK.BRONZE], [44, 14, CK.CONSERVATORY], [34, 34, CK.CONSERVATORY], [18, 44, CK.CONSERVATORY], [4, 48, CK.BRONZE], [0.1, 52, CK.BRONZE]], 20);
  C.lamps.push({ p: V3(px, py + 50, pz), r: 3.5, color: LAMPC.COOL, i: 1.4, breathe: 0.2 });
  // woods: clumps of mixed species (off the water)
  const clumps = 5 + Math.floor(r() * 5);
  for (let c = 0; c < clumps; c++) {
    const qx = x0 + 60 + r() * (sx - 120), qz = z0 + 60 + r() * (sz - 120), n = 6 + Math.floor(r() * 10), sp = pickTree(C);
    for (let t = 0; t < n; t++) {
      const tx = qx + (r() - 0.5) * 110, tz = qz + (r() - 0.5) * 110, s = 10 + r() * 14;
      if (lake && Math.hypot(tx - lake.lx, (tz - lake.lz) / lake.e) < lake.R + 14) continue;
      if (Math.hypot(tx - px, tz - pz) < 56) continue;
      tree(M, N, tx, S.deck(tx) + 1.5, tz, s, r() < 0.75 ? sp : pickTree(C));
    }
  }
  // stone walks crossing the park, lamp-lit
  M.box(cx, S.deck(cx) + 1.8, cz, 8, 0.6, sz - 20, HK.STONE);
  walk(C, 0, cx, cz, 2.2, sz / 2 - 12, S.deck(cx) + 2.1);
  M.box(cx, S.deck(cx) + 1.8, cz, sx - 20, 0.6, 8, HK.STONE);
  for (let t = -sz / 2 + 40; t < sz / 2; t += 60) C.flamps.push({ p: V3(cx + 7, S.deck(cx) + 5, cz + t), r: 1.2, color: C.style.street, i: 1.3 });
  void yg;
}

export function farmCell(C, x0, x1, z0, z1) {
  const { B, M, N, S, r, F } = C;
  // glasshouse ranges along the ring, crop strips between, orchards, a farmstead at one end
  const n = 6, pitch = (x1 - x0) / n, half = pitch * 0.3, len0 = z0 + 90, len1 = z1 - 20;
  standBox(B, S, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 1.0, HK.CROPS, 10);
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * pitch, y = Math.max(S.deck(x - half), S.deck(x + half)) + 1;
    if (i === 1 && r() < 0.6) {
      // an orchard in rows instead of a glasshouse
      for (let ox = -half + 10; ox < half - 6; ox += 24) for (let oz = len0 + 12; oz < len1 - 6; oz += 30) tree(M, null, x + ox, y, oz, 8 + r() * 2, C.style.trees[1]);
      if (F) F.box(x, y + 4, (len0 + len1) / 2, half * 2, 8, len1 - len0, treeKind(C.style.trees[1]));
      continue;
    }
    const h = 30 + r() * 16;
    vault(B, x, y, len0, len1, half, h, CK.CONSERVATORY, CK.BRONZE, 10, 3);
    if (F) F.box(x, y + h * 0.35, (len0 + len1) / 2, half * 2, h * 0.7, len1 - len0, CK.CONSERVATORY);
    for (let z = len0 + 75; z < len1; z += 150) ribArc(M, x, y, z, half, h, 1.1, CK.BRONZE, 6);
    C.flamps.push({ p: V3(x, y + h + 2, (len0 + len1) / 2), r: 1.6, color: LAMPC.LEAF, i: 1.2, breathe: 0.2, phase: r() });
  }
  // farmstead: a barn and houses under tiled roofs round a yard, silos
  const fx = (x0 + x1) / 2, fz = z0 + 44, fk = facadeKind(C.style.pal);
  const top = standBox(B, S, fx, fz, 180, 40, 12, fk);
  gableRoof(B, fx, top, fz, 41, 10, 181, HK.TILE, fk, true);
  for (const s of [-1, 1]) {
    const hx = fx + s * 230, ht = standBox(B, S, hx, fz, 36, 22, 8, fk);
    gableRoof(B, hx, ht, fz, 23, 6, 37, HK.TILE, fk, true);
    latheAt(B, fx + s * 130, S.deck(fx + s * 130) - 4, fz + 6, [[0.1, 0, CK.HULL], [7, 0, CK.HULL], [7, 30, CK.HULL], [4, 36, CK.BRONZE], [0.1, 37, CK.BRONZE]], 10);
    C.flamps.push({ p: V3(hx, ht + 3, fz + 12), r: 1.5, color: LAMPC.WARM, i: 1.6 });
  }
  B.box(fx, S.deck(fx) + 7, fz + 20.6, 120, 3, 1, CK.LANTERN);
  C.lamps.push({ p: V3(fx, S.deck(fx) + 30, fz + 20), r: 4, color: LAMPC.WARM, i: 1.6 });
  void N;
}

export function civicCell(C, x0, x1, z0, z1) {
  const { B, M, N, S, r, F } = C;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
  standBox(B, S, cx, cz, sx, sz, 2, HK.STONE, 12);
  const y = Math.max(S.deck(cx - 120), S.deck(cx + 120)) + 2;
  const top = Math.min(1300, Math.min(S.roofLow(cx - 100), S.roofLow(cx + 100)) - y - 320) * (0.6 + r() * 0.4);
  // a tapering glass tower with lantern sky-lobbies every ~quarter, a crown and a mast
  const prof = [[0.1, -10, CK.HULL], [110, -10, CK.HULL], [110, 20, CK.BRONZE]];
  const lobbies = 4;
  for (let q = 0; q < lobbies; q++) {
    const a = q / lobbies, b = (q + 1) / lobbies, ra = 100 - 45 * a, rb = 100 - 45 * b;
    prof.push([ra, 22 + a * top, CK.GLASS], [rb, b * top - 14, CK.GLASS], [rb + 4, b * top - 12, CK.LANTERN], [rb + 4, b * top - 2, CK.LANTERN], [rb, b * top, CK.BRONZE]);
  }
  prof.push([44, top + 30, CK.HULL], [12, top + 60, CK.BRONZE], [3, top + 150, CK.DARK], [0.1, top + 152, CK.DARK]);
  latheAt(B, cx, y, cz, prof, 28);
  // sky gardens: planted balconies spiralling up between the lobbies
  for (let q = 0; q < 12; q++) {
    const a = (q / 12) * TAU * 2.5, t = 0.08 + (q / 12) * 0.84, rr = 100 - 45 * t + 4;
    M.at(cx + Math.cos(a) * rr, y + t * top, cz + Math.sin(a) * rr, 0, -a, 0);
    M.box(0, 0, 0, 10, 2, 34, HK.ROOFGARDEN);
    M.pop();
  }
  if (F) { latheAt(F, cx, y, cz, [[0.1, -10, CK.HULL], [100, -10, CK.GLASS], [55, top, CK.GLASS], [58, top + 4, CK.LANTERN], [3, top + 150, CK.DARK], [0.1, top + 152, CK.DARK]], 8); }
  C.lamps.push({ p: V3(cx, y + top + 156, cz), r: 6, color: LAMPC.RED, i: 3.0, breathe: 0.5 });
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; C.lamps.push({ p: V3(cx + Math.cos(a) * 60, y + top + 34, cz + Math.sin(a) * 60), r: 3.5, color: C.style.accent, i: 2.0 }); }
  // four halls round the plaza: colonnaded stone, pitched copper or planted roofs
  const fk = facadeKind(C.style.pal + 2);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4, hx = cx + Math.cos(a) * sx * 0.3, hz = cz + Math.sin(a) * sz * 0.3;
    const hh = 26 + r() * 20;
    B.box(hx, y + hh / 2, hz, 150, hh, 110, fk);
    if (k % 2) gableRoof(B, hx, y + hh, hz, 112, 16, 152, CK.BRONZE, fk, true);
    else { B.box(hx, y + hh + 2, hz, 156, 4, 116, CK.BRONZE); M.box(hx, y + hh + 4.6, hz, 140, 1.2, 100, HK.ROOFGARDEN); }
    for (let c = -3; c <= 3; c++) M.box(hx + c * 22, y + hh / 2, hz + 60, 3.4, hh, 3.4, HK.STONE);
    B.box(hx, y + 5, hz + 55.4, 140, 8, 0.6, CK.LANTERN);
    C.flamps.push({ p: V3(hx, y + hh + 6, hz + 58), r: 2, color: LAMPC.COOL, i: 1.4 });
  }
  // reflecting pools either side of the tower with jets, and an avenue of trees
  for (const s of [-1, 1]) {
    const pz = cz + s * 200;
    B.box(cx, y + 0.6, pz, 180, 1.2, 40, HK.WATER);
    B.box(cx, y + 0.3, pz, 186, 1.8, 46, HK.STONE);
    for (let j = -3; j <= 3; j++) N.tube([V3(cx + j * 24, y + 1.1, pz), V3(cx + j * 24, y + 6 + 3 * Math.abs(Math.sin(j)), pz)], 0.5, 5, HK.WATER);
  }
  walk(C, 1, cx, cz, 175, 0, y); walk(C, 1, cx, cz, 128, 0, y);
  for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; tree(M, N, cx + Math.cos(a) * 190, y, cz + Math.sin(a) * 190, 12 + r() * 5, pickTree(C)); }
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; C.flamps.push({ p: V3(cx + Math.cos(a) * 160, y + 6, cz + Math.sin(a) * 160), r: 1.6, color: C.style.street, i: 1.5 }); }
}

export function worksCell(C, x0, x1, z0, z1) {
  const { B, M, N, S, r, F } = C;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
  standBox(B, S, cx, cz, sx, sz, 1.2, HK.STREET, 10);
  // fabrication halls in brick and panel, photovoltaic sawtooth roofs, lit loading doors
  const halls = 2 + Math.floor(r() * 2), fk = facadeKind(3);
  for (let h = 0; h < halls; h++) {
    const hx = x0 + ((h + 0.5) / halls) * sx, hw = sx / halls - 70, hl = sz * 0.55, hz = z0 + 40 + hl / 2, hh = 30 + r() * 18;
    const top = standBox(B, S, hx, hz, hw, hl, hh, h % 2 ? fk : CK.HULL);
    if (F) standBox(F, S, hx, hz, hw, hl, hh, h % 2 ? fk : CK.HULL);
    for (let t = 0; t < 8; t++) {
      const tz = hz - hl / 2 + ((t + 0.5) / 8) * hl;
      B.at(hx, top + 8, tz, -0.5, 0, 0);
      B.box(0, 0, 0, hw - 6, 1.2, hl / 8 / Math.cos(0.5) - 2, CK.PANEL);
      B.pop();
      M.box(hx, top + 8, tz + hl / 16 - 1, hw - 6, 16, 1.2, CK.GLASS);
    }
    B.box(hx - hw / 2 - 0.6, top - hh * 0.5, hz, 1.2, hh * 0.4, hl * 0.9, CK.LANTERN);
    for (let d = -2; d <= 2; d++) M.box(hx + d * hw * 0.18, S.deck(hx) + 7, hz - hl / 2 - 0.5, 12, 12, 1, d % 2 ? CK.LANTERN : CK.DARK);
    C.lamps.push({ p: V3(hx, top + 20, hz - hl / 2 - 4), r: 3.5, color: LAMPC.SODIUM, i: 2.0 });
    // a travelling crane over the yard in front of the hall
    const yc = S.deck(hx) + 34;
    for (const s of [-1, 1]) M.box(hx + s * (hw / 2 - 4), yc / 2 + S.deck(hx) / 2, hz - hl / 2 - 40, 3, yc - S.deck(hx), 3, CK.BRONZE);
    M.box(hx, yc, hz - hl / 2 - 40, hw, 4, 5, CK.BRONZE);
    N.box(hx + (r() - 0.5) * hw * 0.6, yc - 5, hz - hl / 2 - 40, 6, 6, 7, CK.DARK);
  }
  // reclamation tanks and the pipe rack between them
  const tz0 = z0 + sz * 0.72;
  const tanks = [];
  for (let t = 0; t < 5; t++) {
    const tx = x0 + 90 + t * ((sx - 180) / 4), tr = 26 + r() * 16, th = 40 + r() * 30, ty = S.deck(tx);
    latheAt(B, tx, ty - 8, tz0, [[0.1, 0, CK.HULL], [tr, 0, CK.HULL], [tr, th * 0.5, t % 2 ? CK.HULL : fk], [tr, th, CK.BRONZE], [tr * 0.7, th + tr * 0.35, CK.HULL], [0.1, th + tr * 0.45, CK.HULL]], 18);
    tanks.push(V3(tx, ty + th * 0.6, tz0));
  }
  for (let t = 0; t < tanks.length - 1; t++) {
    M.tube([tanks[t].clone().add(V3(0, 0, 40)), tanks[t + 1].clone().add(V3(0, 0, 40))], 3, 6, CK.CONDUIT);
    M.tube([tanks[t].clone().add(V3(0, 6, 46)), tanks[t + 1].clone().add(V3(0, 6, 46))], 2, 6, CK.BRONZE);
  }
  for (const p of tanks) C.lamps.push({ p: p.clone().add(V3(0, 50, 0)), r: 3, color: LAMPC.AMBER, i: 1.6, breathe: 0.3 });
}

export function stadiumCell(C, x0, x1, z0, z1) {
  const { B, M, N, S, r, F } = C;
  // a sports ground: raked stands in a bowl round a striped pitch, floodlight masts, a plaza
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
  standBox(B, S, cx, cz, sx, sz, 1.2, HK.STONE, 10);
  const y = Math.max(S.deck(cx - 300), S.deck(cx + 300)) + 1.2;
  const fk = facadeKind(C.style.pal + 2);
  latheAt(B, cx, y - 6, cz, [[150, 0, CK.GARDEN], [150, 7, CK.HULL], [170, 10, CK.DECK], [250, 52, CK.DECK], [262, 56, CK.GLASS], [262, 76, CK.BRONZE], [290, 76, fk], [300, 0, fk]], 48, true);
  if (F) latheAt(F, cx, y - 6, cz, [[150, 0, CK.GARDEN], [262, 56, CK.GLASS], [290, 76, CK.HULL], [300, 0, CK.HULL]], 12, true);
  latheAt(B, cx, y - 6, cz, [[0.1, 0, HK.CROPS], [150, 0, HK.CROPS], [150, 7.4, HK.CROPS], [0.1, 7.4, HK.CROPS]], 48);
  // the roof ring's lit edge and banners round the rim
  M.push(new THREE.Matrix4().makeTranslation(cx, y + 70, cz).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  M.torus(276, 1.4, 64, 4, CK.LANTERN);
  M.pop();
  for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; N.box(cx + Math.cos(a) * 296, y + 50, cz + Math.sin(a) * 296, 6, 18, 0.4, HK.AWNING); }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + 0.26, mx = cx + Math.cos(a) * 320, mz = cz + Math.sin(a) * 320;
    B.box(mx, y + 60, mz, 6, 120, 6, CK.BRONZE);
    M.box(mx, y + 121, mz, 18, 4, 8, CK.LANTERN);
    C.lamps.push({ p: V3(mx, y + 126, mz), r: 5, color: LAMPC.COOL, i: 2.4 });
  }
  // rows of seats as ribs on the rake (minor)
  for (let q = 0; q < 8; q++) {
    const rr = 178 + q * 9.5, yy = y - 6 + 10 + (q + 0.5) * 5.25;
    M.push(new THREE.Matrix4().makeTranslation(cx, yy, cz).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    M.torus(rr, 0.8, 64, 4, q % 2 ? facadeKind(C.style.pal + 1) : HK.AWNING);
    M.pop();
  }
  void r;
}

export function marketCell(C, x0, x1, z0, z1) {
  const { B, M, N, S, F } = C;
  // covered markets: three long arcades with lantern roofs, awnings down both aisles, signs
  const pitch = (x1 - x0) / 3;
  standBox(B, S, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 1.0, HK.STONE, 10);
  for (let i = 0; i < 3; i++) {
    const x = x0 + (i + 0.5) * pitch, half = pitch * 0.3, y = Math.max(S.deck(x - half), S.deck(x + half)) + 1;
    vault(B, x, y + 14, z0 + 40, z1 - 40, half, 22, CK.LANTERN, CK.GLASS, 10, 4);
    if (F) F.box(x, y + 18, (z0 + z1) / 2, half * 2, 34, z1 - z0 - 80, CK.LANTERN);
    for (const sd of [-1, 1]) {
      B.box(x + sd * (half - 1), y + 6, (z0 + z1) / 2, 2, 16, z1 - z0 - 80, facadeKind(C.style.pal));
      M.box(x + sd * (half - 2.4), y + 11, (z0 + z1) / 2, 0.6, 2, z1 - z0 - 90, HK.NEON);
    }
    for (let z = z0 + 70; z < z1 - 60; z += 32) for (const sd of [-1, 1]) {
      M.box(x + sd * half * 0.55, y + 2, z, 10, 4, 14, (z / 32) % 3 < 1 ? CK.BRONZE : facadeKind(C.style.pal + 1));
      M.at(x + sd * (half * 0.55 - 6), y + 5, z, 0, 0, sd * 0.35); M.box(0, 0, 0, 6, 0.3, 15, HK.AWNING); M.pop();
    }
    C.lamps.push({ p: V3(x, y + 42, z0 + 40), r: 3.5, color: C.style.accent, i: 2.0 }, { p: V3(x, y + 42, z1 - 40), r: 3.5, color: LAMPC.TEAL, i: 1.8 });
    for (let z = z0 + 60; z < z1 - 40; z += 80) C.flamps.push({ p: V3(x, y + 20, z), r: 1.6, color: z % 160 < 80 ? LAMPC.ROSE : LAMPC.WARM, i: 1.5, breathe: 0.2, phase: z / 1000 });
  }
  void N;
}

// ------------------------------------------------------------ terraces ----
/**
 * Terraced habitat on the inner face of each wall: 13 decks of 160 m stepping back up the wall
 * in 500 m blocks. Blocks alternate stone-and-window facades in the district palette with
 * glass curtain walls; each deck is capped by a stone slab with a garden on the exposed step.
 * Every third block carries a cascade: water spilling from terrace to terrace down its face.
 */
export function cliffs(C) {
  const { B, M, N, S, r, F } = C;
  const levels = 13, H = 160, segL = 500, gap = 30, TL = C.tileL;
  for (const sg of [-1, 1]) {
    const X0 = S.hw;
    for (let j = 0; j < TL / segL; j++) {
      const z0 = -TL / 2 + j * segL + gap / 2, z1 = z0 + segL - gap, zc = (z0 + z1) / 2, zl = z1 - z0;
      const d0 = 520 + (r() - 0.5) * 60, step = 30 + r() * 12;
      const blockK = r() < 0.62 ? facadeKind(C.style.pal + (j % 3 === 2 ? 2 : 0)) : CK.GLASS;
      const cascade = j % 3 === 1;
      for (let i = 0; i < levels; i++) {
        const depth = d0 - i * step, next = d0 - (i + 1) * step;
        const y0 = i === 0 ? S.deck(sg * (X0 - depth)) - 18 : i * H, y1 = (i + 1) * H - 12;
        const xin = sg * (X0 - depth), xw = sg * (X0 + 20);
        const k = blockK === CK.GLASS || i % 4 !== 3 ? blockK : CK.GLASS;
        B.box((xin + xw) / 2, (y0 + y1) / 2, zc, Math.abs(xw - xin), y1 - y0, zl, k);
        if (F && i % 3 === 0) F.box((xin + xw) / 2, (y0 + Math.min(levels, i + 3) * H - 12) / 2, zc, Math.abs(xw - xin), Math.min(levels, i + 3) * H - 12 - y0, zl, blockK);
        B.box((xin + xw) / 2, y1 + 6, zc, Math.abs(xw - xin) + 6, 12, zl + 4, HK.STONE);
        B.box(xin - sg * 3.4, y1 - 3, zc, 0.8, 2.4, zl, CK.LANTERN);                 // the slab's lit soffit edge
        if (i < levels - 1) {
          const gx0 = sg * (X0 - depth + 4), gx1 = sg * (X0 - next - 4);
          B.box((gx0 + gx1) / 2, y1 + 13.5, zc, Math.abs(gx1 - gx0), 3, zl - 8, HK.ROOFGARDEN);
          M.box(sg * (X0 - depth + 1.5), y1 + 12.6, zc, 0.35, 1.3, zl - 4, CK.BRONZE);
          // garden trees along the step (minor) and pergola lamps (fine)
          for (let t = 0; t < 3; t++) {
            const tz = z0 + ((t + 0.3 + r() * 0.4) / 3) * zl;
            if (cascade && Math.abs(tz - zc) < 20) continue;
            tree(M, null, (gx0 + gx1) / 2, y1 + 15, tz, 7 + r() * 5, pickTree(C));
          }
          C.flamps.push({ p: V3((gx0 + gx1) / 2, y1 + 19, zc + (r() - 0.5) * zl * 0.6), r: 1.4, color: C.style.street, i: 1.3 });
        }
        // pier fins on stone blocks (fine): the storeys read as a carved face close up
        if (k !== CK.GLASS && i % 2 === 0) for (let zz = z0 + 20; zz < z1 - 10; zz += 40) N.box(xin - sg * 0.9, (y0 + y1) / 2, zz, 1.8, y1 - y0 - 2, 1.4, HK.STONE);
        // loggias: framed balconies standing proud of the glazing
        const nl = 3 + Math.floor(r() * 4);
        for (let q = 0; q < nl; q++) {
          const zq = z0 + ((q + 0.5) / nl) * zl, lw = 26 + r() * 30;
          if (cascade && Math.abs(zq - zc) < lw / 2 + 10) continue;
          M.box(sg * (X0 - depth - 4), (y0 + y1) / 2 - 20, zq, 8, 3, lw, CK.DECK);
          M.box(sg * (X0 - depth - 7.8), (y0 + y1) / 2 - 18, zq, 0.3, 1.2, lw, CK.BRONZE);
          if (q === 0) M.box(sg * (X0 - depth - 4), (y0 + y1) / 2 - 17.6, zq, 6, 1.8, lw * 0.5, HK.ROOFGARDEN);
        }
        // the cascade: a sheet of water down this deck's face into the garden below, and a basin
        if (cascade) {
          const top = i === levels - 1 ? y1 : y1 + 15;
          B.box(sg * (X0 - depth - 1.4), (y0 + 14 + top) / 2 - 7, zc, 1.2, top - y0 - 14, 18, HK.WATER);
          if (i > 0) B.box(sg * (X0 - depth - 9), y0 + 1.2, zc, 14, 2.4, 26, HK.WATER);
        }
      }
      if (cascade) {
        // the pool at the foot, over the concourse approach
        const px = sg * (X0 - d0 - 40), py = S.deck(px);
        latheAt(B, px, py - 1, zc, [[0.1, 0, HK.WATER], [34, 0, HK.WATER], [34, 2.4, HK.WATER], [0.1, 2.4, HK.WATER]], 16);
        latheAt(B, px, py - 2, zc, [[33, 0, HK.STONE], [38, 0, HK.STONE], [38, 3.4, HK.STONE], [33, 3.4, HK.STONE]], 16, true);
        C.lamps.push({ p: V3(px, py + 8, zc), r: 3, color: LAMPC.TEAL, i: 1.6, breathe: 0.4, phase: j / 8 });
      }
      // sky bridges across the next light well on every third deck (clear of the lift shaft)
      if (j < TL / segL - 1) for (let i = 1; i < levels; i += 3) {
        const depth = d0 - i * step, xb = sg * (X0 - depth * 0.55);
        B.box(xb, i * H + 60, z1 + gap / 2, 30, 8, gap + 6, CK.GLASS);
        M.box(xb, i * H + 55.6, z1 + gap / 2, 32, 0.8, gap + 6, CK.BRONZE);
        B.box(xb, i * H + 64.4, z1 + gap / 2, 30.4, 0.8, gap + 6.4, CK.LANTERN);
      }
      // light-well lift shaft and its glass at the crest
      const zs = z1 + gap / 2;
      if (j < TL / segL - 1) {
        const shaftTop = levels * H + 20;
        B.tube([V3(sg * (X0 - 26), S.deck(sg * (X0 - 26)) - 10, zs), V3(sg * (X0 - 26), shaftTop, zs)], 11, 10, CK.GLASS);
        for (let yy = 320; yy < shaftTop; yy += 480) M.box(sg * (X0 - 60), yy, zs, 70, 5, gap + 8, CK.DECK);
        C.lamps.push({ p: V3(sg * (X0 - 26), shaftTop + 6, zs), r: 6, color: LAMPC.AMBER, i: 2.2, breathe: 0.2, phase: j / 8 });
      }
      if (j % 2 === 0) C.lamps.push({ p: V3(sg * (X0 - d0 - 6), H * 0.6, zc), r: 8, color: C.style.accent, i: 1.4 });
    }
    // glazed concourse along the foot of the terraces, ribbed every 100 m, lit along its spine
    const xg = sg * (X0 - 660), yg = S.deck(xg);
    vault(B, xg, yg, -TL / 2, TL / 2, 80, 55, CK.GLASS, false, 10, 4);
    B.box(xg, yg + 55.6, 0, 3, 1.2, TL, CK.LANTERN);
    for (let z = -TL / 2 + 50; z < TL / 2; z += 100) ribArc(M, xg, yg, z, 80, 55, 1.6, CK.BRONZE, 8);
  }
}

// ------------------------------------------------------------ the vault frame ----
export const VAULT_FRAME = { lift: 5, ribR: 3.2, ribPitch: 250, purlinPitch: 1000, purlinR: 1.8 };
/**
 * The structure of the glass itself, near the camera: arched bronze ribs every 250 m riding
 * just outside the vault (clear of the gantry pods above), purlins along the ring every
 * kilometre across it, and lamps strung along every other rib that trace the vault's curve
 * in the night. One geometry, identical in every tile (the vault is uniform along the ring).
 */
export function buildVaultFrame(S, tileL) {
  const B = new CB(), lamps = [];
  const N = 96, xs = [];
  for (let i = 0; i <= N; i++) xs.push(S.hw * Math.sin((i / N - 0.5) * Math.PI));
  const yOf = (x) => S.roofCurve(x) + VAULT_FRAME.lift + VAULT_FRAME.ribR;
  for (let z = -tileL / 2 + VAULT_FRAME.ribPitch / 2, q = 0; z < tileL / 2; z += VAULT_FRAME.ribPitch, q++) {
    B.tube(xs.map((x) => V3(x, yOf(x), z)), VAULT_FRAME.ribR * (q % 4 === 0 ? 1.6 : 1), 6, q % 4 === 0 ? CK.BRONZE : CK.HULL);
    if (q % 2 === 0) for (let i = 4; i < N; i += 8) lamps.push({ p: V3(xs[i], yOf(xs[i]) + VAULT_FRAME.ribR * 2 + 2, z), r: 3, color: q % 4 ? LAMPC.WARM : LAMPC.AMBER, i: 1.5, breathe: 0.25, phase: i / N });
  }
  for (let x = -S.hw + VAULT_FRAME.purlinPitch; x < S.hw; x += VAULT_FRAME.purlinPitch) {
    const y = S.roofCurve(x) + VAULT_FRAME.lift + VAULT_FRAME.purlinR;
    B.box(x, y, 0, VAULT_FRAME.purlinR * 2, VAULT_FRAME.purlinR * 2, tileL, CK.BRONZE);
  }
  return { geo: B.geometry(), lamps };
}

// ------------------------------------------------------------ the harbour towns ----
/**
 * Under every hub arch the river widens into a round harbour: a basin 3 km across with stone
 * quays, a lit island carrying the Harbour Light (a lantern tower on the arch's axis line, off
 * the spine), a ring quarter of towers and terraces round the quay broken by eight radial
 * avenues, marinas, ferry piers and quay cranes. The maglev crosses the basin on its viaduct.
 * Boats and ferries (HaloDistricts life) work the water. Returns the footprint the regular
 * cells must leave clear.
 */
export const HARBOUR = {
  R: 1500, quay: 60, island: { x: 720, z: 0, r: 300 }, lanes: [520, 880, 1240], ground: 3000,
  // boat routes round the basin (m radius, m/s, count, fleet 0 ferries / 1 sail), threading the
  // viaduct's piers (every 200 m at z = 100 + 200 k) and clear of the island and the piers
  routes: [{ r: 1250, v: 6, n: 5, fleet: 0 }, { r: 1180, v: -3.5, n: 7, fleet: 1 }, { r: 1215, v: 2.5, n: 6, fleet: 1 }],
};
export function harbourTown(C) {
  const { B, M, N, S, r, F } = C;
  const H = HARBOUR, R = H.R;
  const y = Math.max(S.deck(-R - 250), S.deck(R + 250), S.deck(0)) + 1.0;
  // the basin and its quay wall (a stepped stone rim, bollards and lamps along the edge)
  latheAt(B, 0, y, 0, [[0.1, 0, HK.WATER], [R, 0, HK.WATER], [R, 1.2, HK.WATER], [0.1, 1.2, HK.WATER]], 48);
  walk(C, 1, 0, 0, R + 24, 0, y + 2.5); walk(C, 1, 0, 0, R + 44, 0, y + 2.5);
  latheAt(B, 0, y - 3, 0, [[R - 2, 0, HK.STONE], [R + H.quay, 0, HK.STONE], [R + H.quay, 5.5, HK.STONE], [R + 8, 5.5, HK.STONE], [R + 8, 3.5, HK.STONE], [R - 2, 3.5, HK.STONE]], 64, true);
  if (F) {
    latheAt(F, 0, y, 0, [[0.1, 0, HK.WATER], [R, 0, HK.WATER], [R, 1.2, HK.WATER], [0.1, 1.2, HK.WATER]], 16);
    latheAt(F, 0, y - 3, 0, [[R, 0, HK.STONE], [R + H.quay, 0, HK.STONE], [R + H.quay, 5.5, HK.STONE], [R, 5.5, HK.STONE]], 16, true);
  }
  M.push(new THREE.Matrix4().makeTranslation(0, y + 3.2, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  M.torus(R + 9, 0.6, 128, 4, CK.BRONZE);                       // the quay rail
  M.pop();
  for (let k = 0; k < 96; k++) {
    const a = (k / 96) * TAU, cx = Math.cos(a), sz = Math.sin(a);
    if (Math.abs(cx * (R + 30)) < 40) continue;                 // (the viaduct's crossing)
    C.flamps.push({ p: V3(cx * (R + 14), y + 10, sz * (R + 14)), r: 1.6, color: k % 8 ? LAMPC.WARM : C.style.accent, i: 1.6 });
    N.box(cx * (R + 14), y + 5.5, sz * (R + 14), 0.4, 9, 0.4, CK.DARK);
    if (k % 3 === 0) N.box(cx * (R + 5), y + 3.2, sz * (R + 5), 0.8, 1.2, 0.8, CK.DARK);   // bollards
  }
  // the island: a planted mound, a stone apron, the Harbour Light
  const I = H.island;
  latheAt(B, I.x, y - 1, I.z, [[0.1, 0, HK.STONE], [I.r, 0, HK.STONE], [I.r, 4, HK.STONE], [I.r - 20, 4, CK.GARDEN], [I.r * 0.5, 16, CK.GARDEN], [0.1, 22, CK.GARDEN]], 32);
  if (F) latheAt(F, I.x, y - 1, I.z, [[0.1, 0, CK.GARDEN], [I.r, 0, CK.GARDEN], [0.1, 22, CK.GARDEN]], 10);
  const hmax = Math.min(S.roofLow(I.x - 60), S.roofLow(I.x + 60)) - y - 360;
  const top = Math.min(760, hmax);
  const light = [[0.1, 0, HK.STONE], [70, 0, HK.STONE], [64, 40, facadeKind(C.style.pal + 2)], [48, top * 0.45, facadeKind(C.style.pal + 2)], [50, top * 0.45 + 4, CK.BRONZE], [44, top * 0.45 + 8, CK.GLASS], [34, top * 0.82, CK.GLASS], [40, top * 0.82 + 4, CK.BRONZE], [40, top * 0.82 + 10, CK.LANTERN], [36, top * 0.92, CK.LANTERN], [40, top * 0.92 + 4, CK.BRONZE], [14, top * 0.97, CK.BRONZE], [3, top, CK.DARK], [0.1, top + 2, CK.DARK]];
  latheAt(B, I.x, y + 18, I.z, light, 20);
  if (F) latheAt(F, I.x, y + 18, I.z, [[0.1, 0, HK.STONE], [64, 0, HK.STONE], [40, top * 0.82, CK.GLASS], [40, top * 0.92, CK.LANTERN], [0.1, top + 2, CK.DARK]], 8);
  C.lamps.push({ p: V3(I.x, y + 18 + top * 0.88, I.z), r: 14, color: LAMPC.WHITE, i: 3.2, breathe: 0.6 });
  C.lamps.push({ p: V3(I.x, y + 20 + top, I.z), r: 6, color: LAMPC.RED, i: 3.0, breathe: 0.5, phase: 0.5 });
  for (let t = 0; t < 14; t++) { const a = (t / 14) * TAU, d = I.r * (0.45 + r() * 0.3); tree(M, N, I.x + Math.cos(a) * d, y + 6, I.z + Math.sin(a) * d, 10 + r() * 6, pickTree(C)); }
  // marinas: finger piers off the quay at four points, moored boats along them
  for (let q = 0; q < 4; q++) {
    const a = (q / 4) * TAU + Math.PI / 4, cx = Math.cos(a), sz = Math.sin(a), tx = -sz, tz = cx;
    const px = cx * (R - 60), pz = sz * (R - 60);
    M.at(px, y + 2.2, pz, 0, -a, 0);
    M.box(-60, 0, 0, 120, 1, 6, CK.DECK);                                                    // the spine pier, radial
    for (let f = -2; f <= 2; f++) M.box(-60 + f * 22, 0, 0, 3, 1, 70, CK.DECK);            // fingers
    for (let f = -2; f <= 2; f++) for (const s of [-1, 1]) {
      const bx = -60 + f * 22 + s * 5, bz = (r() - 0.5) * 50;
      M.box(bx, 0.8, bz, 3, 1.4, 10, f % 2 ? CK.HULL : HK.AWNING);
      N.box(bx, 6, bz + 1, 0.2, 10, 0.2, CK.BRONZE);
    }
    M.pop();
    C.flamps.push({ p: V3(px - cx * 60 + tx * 0, y + 8, pz - sz * 60), r: 1.8, color: LAMPC.TEAL, i: 1.6, breathe: 0.3, phase: q / 4 });
  }
  // ferry piers where the avenues meet the water, each with a lit shelter
  for (let q = 0; q < 8; q++) {
    const a = (q / 8) * TAU, cx = Math.cos(a), sz = Math.sin(a);
    if (Math.abs(cx) > 0.99) continue;
    M.at(cx * (R - 40), y + 2.4, sz * (R - 40), 0, -a, 0);
    M.box(0, 0, 0, 80, 1.2, 12, CK.DECK);
    M.box(-30, 4, 0, 14, 6, 10, CK.GLASS);
    M.box(-30, 7.4, 0, 16, 0.6, 12, HK.AWNING);
    M.pop();
    C.flamps.push({ p: V3(cx * (R - 70), y + 10, sz * (R - 70)), r: 2, color: LAMPC.WARM, i: 1.8 });
  }
  // quay cranes on the eastern quays (the working side), jibs over the water
  for (const a of [-0.35, 0, 0.35]) {
    const cx = Math.cos(a + Math.PI), sz = Math.sin(a + Math.PI), qx = cx * (R + 30), qz = sz * (R + 30);
    B.box(qx, y + 30, qz, 6, 60, 6, CK.BRONZE);
    B.at(qx, y + 62, qz, 0, -(a + Math.PI), 0);
    B.box(-30, 0, 0, 90, 4, 4, CK.BRONZE);
    B.box(16, -6, 0, 10, 10, 10, CK.DARK);
    B.pop();
    C.lamps.push({ p: V3(qx, y + 68, qz), r: 3, color: LAMPC.RED, i: 2.2, breathe: 0.4 });
  }
  // the ring quarter: blocks on three rings of lots round the quay, eight avenues left open
  const fkA = facadeKind(C.style.pal), fkB = facadeKind(C.style.pal + 4);
  const hm = (x) => Math.min(S.roofLow(x - 150), S.roofLow(x + 150)) - Math.max(S.deck(x - 150), S.deck(x + 150)) - 350;
  H.lanes.forEach((ringR, li) => {
    const lots = Math.floor((TAU * (R + ringR)) / 230);
    for (let q = 0; q < lots; q++) {
      const a = ((q + 0.5) / lots) * TAU;
      const aa = ((a % (TAU / 8)) + TAU / 8) % (TAU / 8);
      if (Math.min(aa, TAU / 8 - aa) * (R + ringR) < 70) continue;            // radial avenues
      const cx = Math.cos(a) * (R + ringR), cz = Math.sin(a) * (R + ringR);
      if (Math.abs(cx) < 120) continue;                                         // the viaduct and its aircar lanes
      if (Math.abs(cz) > 1930) continue;                                        // stay in the tile
      const sx = 150, sz = 150;
      standBox(B, S, cx, cz, sx + 12, sz + 12, 0.9, HK.STONE, 6);
      const fk = r() < 0.7 ? fkA : fkB;
      const roll = r();
      if (li === 0 && roll < 0.6) setbackTower(C, cx, cz, sx, sz, hm(cx), fk);
      else if (roll < 0.75) courtBlock(C, cx, cz, sx, sz, hm(cx), fk);
      else if (roll < 0.9) steppedBlock(C, cx, cz, sx, sz, hm(cx), fk);
      else pocketSquare(C, cx, cz, sx, sz);
    }
  });
  // avenue lamps and trees along the eight radials
  for (let q = 0; q < 8; q++) {
    const a = (q / 8) * TAU, cx = Math.cos(a), sz = Math.sin(a);
    for (let d = R + 90; d < R + H.lanes[2] + 100; d += 45) {
      const x = cx * d, z = sz * d;
      if (Math.abs(z) > 1960 || Math.abs(x) < 60) continue;
      C.flamps.push({ p: V3(x - sz * 18, S.deck(x) + 8, z + cx * 18), r: 1.4, color: C.style.street, i: 1.4 });
      tree(M, N, x + sz * 18, S.deck(x) + 1, z - cx * 18, 9 + r() * 3, pickTree(C));
    }
  }
  // the ground of the quarter in 500 m strips (each seated on its own stretch of the deck's sag)
  for (let x = -H.ground; x < H.ground; x += 500) standBox(B, S, x + 250, 0, 500, 3960, 0.4, HK.STREET, 8);
  return { ground: H.ground };
}

// ------------------------------------------------------------ the port quarters ----
/**
 * The terminal quarter round a Halo port's podium (in the station's frame: x along the ring,
 * z across it, y up from the ring's radius): lots on three rings between the podium and the
 * wing roots, left open along the concourse wings and at eight avenues, each a tower, a
 * courtyard block or a stepped terrace in the port palette, beacons on the tall ones. The
 * builders work across x, so the quarter is built turned a quarter round (their x = -z).
 */
export function portQuarter(B, S, lamps, seed = 1) {
  const r = (() => { let a = (seed * 2654435761) >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const flamps = [];
  const C = { B, M: B, N: B, F: null, lamps, flamps, S, r, style: DISTRICT_STYLE[6], tileL: TILE_Q };
  const l0 = lamps.length;
  B.push(rotY90);
  for (const [ring, lot] of [[4700, 170], [5200, 190], [5750, 210]]) {
    const n = Math.floor((TAU * ring) / (lot + 70));
    for (let q = 0; q < n; q++) {
      const a = ((q + 0.5) / n) * TAU, bx = Math.cos(a) * ring, bz = Math.sin(a) * ring;   // builder frame (x across)
      if (Math.abs(bx) < 700) continue;                                                     // the wings run along the ring (builder z)
      const aa = ((a % (TAU / 8)) + TAU / 8) % (TAU / 8);
      if (Math.min(aa, TAU / 8 - aa) * ring < 60) continue;                                 // avenues
      const hmax = Math.min(S.roofLow(bx - lot), S.roofLow(bx + lot)) - Math.max(S.deck(bx - lot), S.deck(bx + lot)) - 360;
      standBox(B, S, bx, bz, lot + 12, lot + 12, 0.9, HK.STONE, 6);
      const fk = facadeKind(r() < 0.6 ? 2 : r() < 0.5 ? 0 : 4), roll = r();
      if (ring === 4700 && roll < 0.5) setbackTower(C, bx, bz, lot, lot, Math.min(hmax, 900), fk);
      else if (roll < 0.8) courtBlock(C, bx, bz, lot, lot, hmax, fk);
      else steppedBlock(C, bx, bz, lot, lot, hmax, fk);
    }
  }
  B.pop();
  for (let i = l0; i < lamps.length; i++) lamps[i].p.applyMatrix4(rotY90);   // (lamps were placed in the builder's frame)
  return flamps.length;
}
const TILE_Q = 12000;

// ------------------------------------------------------------ canal quarters ----
/**
 * A canal quarter: six canals along the ring, 22 m wide between stone quays, lined both sides
 * with narrow gabled houses in terraces (each house its own height and gable, turned to face
 * the water), humpback footbridges every 200 m, moored boats, quay trees and lamps, and the
 * people strolling the quays.
 */
export function canalCell(C, x0, x1, z0, z1) {
  const { B, M, N, S, r, F } = C;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
  const yg = standBox(B, S, cx, cz, sx, sz, 1.0, HK.STONE, 10);
  if (F) standBox(F, S, cx, cz, sx, sz, 1.0, HK.STONE, 10);
  const n = 4, pitch = sx / n, cw = 22;
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * pitch, y = deckHi(S, x, cw) + 1.0;
    const top = Math.max(yg, y);
    // the water, its kerbs and the quay walk
    B.box(x, top + 0.3, cz, cw, 0.6, sz - 16, HK.WATER);
    if (F) F.box(x, top + 0.3, cz, cw, 0.6, sz - 16, HK.WATER);
    for (const s of [-1, 1]) M.box(x + s * (cw / 2 + 0.4), top + 0.9, cz, 0.8, 0.8, sz - 16, HK.STONE);
    walk(C, 0, x, cz, cw / 2 + 3.5, sz / 2 - 14, top + 0.6);
    // houses both sides, in 40 m terraces of five, gables to the canal
    for (const s of [-1, 1]) {
      const hx = x + s * (cw / 2 + 7 + 7), hd = 14;
      for (let z = z0 + 14; z < z1 - 50; z += 44) {
        const fk = facadeKind(C.style.pal + (r() < 0.3 ? 1 : 0));
        let hmax = 0;
        // one terrace block, then each house's own gable (and a taller house or two standing proud)
        const base = 10.8 + Math.floor(r() * 2) * 3.6;
        const t0 = standBox(B, S, hx, z + 20, hd, 39.7, base, fk);
        hmax = t0;
        for (let q = 0; q < 5; q++) {
          const zq = z + 4 + q * 8;
          let t = t0;
          if (r() < 0.3) { t = t0 + 3.6; B.box(hx, t0 + 1.8, zq, hd - 0.2, 3.6, 7.6, facadeKind(C.style.pal + 2)); hmax = Math.max(hmax, t); }
          gableRoof(M, hx, t, zq, 8.2, 4 + r() * 3, hd + 0.6, q % 3 ? HK.TILE : CK.BRONZE, q % 2 ? fk : facadeKind(C.style.pal + 2), true);
        }
        M.box(hx - s * (hd / 2 + 0.3), deckHi(S, hx, hd) + 3.2, z + 22, 0.6, 2.4, 36, HK.NEON);     // lit ground-floor fronts
        if (F && r() < 0.5) F.box(hx, hmax / 2, z + 22, hd, hmax, 40, fk);
      }
      // quay trees and lamps
      for (let z = z0 + 30; z < z1 - 20; z += 36) {
        tree(N, null, x + s * (cw / 2 + 3), top + 0.6, z, 7 + r() * 3, pickTree(C));
        if (Math.round((z - z0) / 36) % 2 === 0) C.flamps.push({ p: V3(x + s * (cw / 2 + 1.5), top + 5, z + 18), r: 1.3, color: C.style.street, i: 1.4 });
      }
    }
    // footbridges and moored boats
    for (let z = z0 + 100; z < z1 - 60; z += 200) {
      M.box(x, top + 2.2, z, cw + 6, 0.8, 5, HK.STONE);
      M.box(x, top + 3.2, z + 2.3, cw + 6, 1.1, 0.3, CK.BRONZE);
      M.box(x, top + 3.2, z - 2.3, cw + 6, 1.1, 0.3, CK.BRONZE);
      for (const s of [-1, 1]) { M.box(x + s * (cw / 2 + 1.8), top + 1.5, z, 3.4, 1.8, 5.4, HK.STONE); }   // the abutments
    }
    for (let z = z0 + 40; z < z1 - 40; z += 50 + r() * 40) {
      const s = r() < 0.5 ? -1 : 1;
      if (Math.abs(((z - z0 - 100) % 200 + 200) % 200) < 14 || Math.abs(((z - z0 - 100) % 200 + 200) % 200) > 186) continue;   // not under a bridge
      M.box(x + s * (cw / 2 - 2.6), top + 0.9, z, 3.2, 1.2, 14, r() < 0.5 ? CK.HULL : HK.AWNING);
      M.box(x + s * (cw / 2 - 2.6), top + 2.0, z - 1, 2.6, 1.2, 6, CK.GLASS);
    }
  }
  C.lamps.push({ p: V3(cx, yg + 16, cz), r: 3, color: C.style.accent, i: 1.4, breathe: 0.2 });
}
