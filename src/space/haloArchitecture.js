import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { LAMP } from './lamps.js';
import { HK, facadeKind, treeKind, tintKind } from './haloMaterial.js';

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
  { pal: 0, pitched: 0.55, trees: [0, 1, 0, 2], street: LAMPC.SODIUM, accent: LAMPC.WARM, roofT: [0.0, 0.62] },      // residential: limestone
  { pal: 1, pitched: 0.8, trees: [1, 4, 0, 3], street: LAMPC.WARM, accent: LAMPC.AMBER, roofT: [0.0, 0.45] },         // agrarian: terracotta
  { pal: 2, pitched: 0.2, trees: [0, 1, 2, 0], street: LAMPC.COOL, accent: LAMPC.COOL, roofT: [0.62, 0.9] },          // civic: white render
  { pal: 3, pitched: 0.35, trees: [0, 4, 0, 1], street: LAMPC.SODIUM, accent: LAMPC.AMBER, roofT: [0.45, 0.8] },      // works: brick
  { pal: 4, pitched: 0.5, trees: [1, 3, 1, 0], street: LAMPC.LEAF, accent: LAMPC.TEAL, roofT: [0.6, 1.0] },          // lakeland: ceramic
  { pal: 5, pitched: 0.4, trees: [3, 2, 0, 1], street: LAMPC.ROSE, accent: LAMPC.VIOLET, roofT: [0.2, 0.62] },        // markets: rose
  { pal: 2, pitched: 0.3, trees: [0, 3, 1, 2], street: LAMPC.WARM, accent: LAMPC.TEAL, roofT: [0.62, 0.8] },          // harbour towns under the arches
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
  if (L.stack.length === 1) treeCone(L, x, y + s * 0.3, z, s, k, (species * 1.3) % 1.2);
  else latheAt(L, x, y + s * 0.3, z, [[0, 0, k], [s * 0.48, s * 0.4, k], [0, s * 0.72, k]], 5, false, (species * 1.3) % 1.2);
  if (T) T.box(x, y + s * 0.18, z, s * 0.07 + 0.3, s * 0.36, s * 0.07 + 0.3, CK.DARK);
}
/**
 * The same double cone written straight into an unstacked builder: the lathe's own vertices
 * (three a facet, so the crown stays faceted), facade coordinates and outward winding, without
 * its per-vertex matrix and per-triangle vectors (a tile plants some twenty thousand trees).
 */
const _cone = { c: new Float64Array(5), s: new Float64Array(5), ph: NaN };
function treeCone(L, x, y0, z, s, k, ph) {
  if (_cone.ph !== ph) { for (let i = 0; i < 5; i++) { const a = ph + (i / 5) * TAU; _cone.c[i] = Math.cos(a); _cone.s[i] = Math.sin(a); } _cone.ph = ph; }
  const R = s * 0.48, hr = s * 0.4, ht = s * 0.72, P = L.pos, Fc = L.fac, I = L.idx;
  for (let i = 0; i < 5; i++) {
    // lower facets (apex under the crown), wound outward and down
    const j = (i + 1) % 5, a = ph + (i / 5) * TAU, b = ph + (j / 5) * TAU;
    const n = P.length / 3;
    P.push(x, y0, z, x + _cone.c[i] * R, y0 + hr, z - _cone.s[i] * R, x + _cone.c[j] * R, y0 + hr, z - _cone.s[j] * R);
    Fc.push(a * R, 0, k, a * R, hr, k, b * R, hr, k);
    I.push(n, n + 2, n + 1);
  }
  for (let i = 0; i < 5; i++) {
    // upper facets (apex on top)
    const j = (i + 1) % 5, a = ph + (i / 5) * TAU, b = ph + (j / 5) * TAU;
    const n = P.length / 3;
    P.push(x + _cone.c[i] * R, y0 + hr, z - _cone.s[i] * R, x, y0 + ht, z, x + _cone.c[j] * R, y0 + hr, z - _cone.s[j] * R);
    Fc.push(a * R, hr, k, a * R, ht, k, b * R, hr, k);
    I.push(n, n + 2, n + 1);
  }
}
/** Railing along a straight edge (top rail and posts as two thin boxes). */
function railing(N, x, y, z, lx, lz) {
  N.box(x, y + 1.1, z, Math.max(lx, 0.12), 0.12, Math.max(lz, 0.12), CK.BRONZE);
  N.box(x, y + 0.55, z, Math.max(lx, 0.05) * (lx > lz ? 1 : 0.4) + 0.02, 1.0, Math.max(lz, 0.05) * (lz > lx ? 1 : 0.4) + 0.02, CK.DARK);
}
/** A walking loop for the people of the district (rectangle half sizes a x b, or circle radius a). */
function walk(C, type, cx, cz, a, b, y) { if (C.walks) C.walks.push(type, cx, cz, a, b, y); }
function pickTree(C) { const t = C.style.trees; return t[Math.floor(C.r() * t.length)]; }

// ------------------------------------------------------------ city form ----
/**
 * How built-up the city is at (x, z) of a tile: 0 garden suburb, 1 downtown. Each variant has
 * its own downtown (C.core: centre and radii, m), the spine draws a spine of density along the
 * ring's centre line, and the city thins toward the terraced walls. Tower heights, block types
 * and street trees all follow it, so a district reads as a centre with towers falling away to
 * courts, terraces and houses in gardens rather than one even speckle.
 */
export function densityAt(C, x, z) {
  if (!C.core) return 0.62;
  const [cx, cz, rx, rz] = C.core;
  const dx = (x - cx) / rx, dz = (z - cz) / rz;
  const core = Math.exp(-(dx * dx + dz * dz));
  const spine = Math.exp(-((x / 3200) ** 2));
  const wall = THREE.MathUtils.smoothstep(Math.abs(x), 9000, 14500);
  return THREE.MathUtils.clamp(0.2 + 0.66 * core + 0.2 * spine - 0.16 * wall, 0, 1);
}
/** A tinted kind with a fresh draw from the tile's stream. */
const tk = (C, k) => tintKind(k, C.r());
/** A pitched roof's tile draw inside the district's range (terracotta, slate, glazed...). */
function roofTint(C) { const [a, b] = C.style.roofT || [0, 1]; return tintKind(HK.TILE, a + (b - a) * C.r()); }
/** A glass tower's curtain wall, or a stone tier, each with its own draw. */
function towerKind(C, glassy, fk) { return glassy ? tk(C, HK.CURTAIN) : tintKind(fk, C.r()); }

/** Hipped roof over a footprint (a four-sided pyramid, flattened to the plan). */
export function hipRoof(B, x, y, z, sx, sz, h, k) {
  B.push(new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeScale(sx / Math.SQRT2, 1, sz / Math.SQRT2)).multiply(toY));
  lathe(B, [[0.001, 0, k], [1, 0, k], [0.001, h, k]], 4, Math.PI / 4);
  B.pop();
}
/**
 * A wood as one mass: a low dome of canopy (ellipse rx x rz, h tall) whose rim sags and bulges
 * crown by crown, turned at random. From a few kilometres a wood reads as a dark mass with a
 * lit and a shaded side; the individual trees round its edge carry it close in.
 */
export function canopyMass(B, S, x, z, rx, rz, h, k, rot, seg = 12, r = Math.random) {
  const y = Math.min(S.deck(x - rx), S.deck(x + rx)) - 2;
  const wob = [];
  for (let i = 0; i < seg; i++) wob.push(0.82 + 0.3 * r());
  B.push(new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationY(rot)));
  const prof = [[1.0, 0.0], [1.02, 0.35], [0.86, 0.72], [0.52, 0.94], [0.001, 1.0]];
  const rings = prof.map(([pr, ph]) => wob.map((w, i) => {
    const a = (i / seg) * TAU, ww = 1 + (w - 1) * (1 - ph * 0.6);
    return [Math.cos(a) * rx * pr * ww, ph * h + (ph > 0 && ph < 1 ? (w - 1) * h * 0.5 : 0), Math.sin(a) * rz * pr * ww];
  }));
  const base = B.pos.length / 3;
  rings.forEach((ring, j) => ring.forEach(([px, py, pz], i) => B.v(px, py, pz, (i / seg) * TAU * Math.max(rx, rz), py + j * 7, k)));
  const up = V3(0, 1, 0);
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < seg; i++) {
    const a = base + j * seg + i, b = base + j * seg + ((i + 1) % seg), c = a + seg, d = b + seg;
    const out = V3(Math.cos(((i + 0.5) / seg) * TAU), 0.6, Math.sin(((i + 0.5) / seg) * TAU));
    B.tri(a, b, d, out); B.tri(a, d, c, out);
  }
  void up;
  B.pop();
  return y + h;
}

// ------------------------------------------------------------ buildings ----
/**
 * A tower on a podium in one to four set-back tiers, its height and girth from the city's
 * density: slim stone towers at the edge of the centre, broad curtain-walled ones downtown.
 * Each tier its own draw (glass colour or stone), terraces planted and railed at each step,
 * a lit band at every set-back, and a crown: lantern drum, planted roof, bronze spire,
 * stepped ziggurat, an open crown ring, or a raked top.
 */
function setbackTower(C, cx, cz, sx, sz, hmax, fk, dens = 0.6) {
  const { B, M, N, S, r, F } = C;
  const y0 = deckHi(S, cx, sx);
  const podK = tintKind(fk, r());
  const pod = standBox(B, S, cx, cz, sx, sz, 8 + r() * 14, podK);
  B.box(cx, pod + 0.8, cz, sx - 8, 1.6, sz - 8, HK.ROOFGARDEN);
  if (F) massBox(F, S, cx, cz, sx, sz, pod + 1.6, podK, HK.ROOFGARDEN);
  // shopfronts: a band of light along both street faces, and awnings over the pavement
  for (const s of [-1, 1]) {
    M.box(cx, y0 + 4.2, cz + s * (sz / 2 + 0.4), sx * 0.86, 2.0, 0.6, HK.NEON);
    if (s > 0) N.box(cx, y0 + 6.2, cz + s * (sz / 2 + 2.2), sx * 0.7, 0.4, 4.0, HK.AWNING);
  }
  const d = THREE.MathUtils.clamp(dens, 0, 1);
  const th = Math.max(40, Math.min(hmax - (pod - y0), 60 + (0.25 + 0.75 * r()) * (80 + 560 * d * d)));
  const girth = 44 + d * 50;
  let tw = Math.min(sx - 20, girth + r() * 40), td = Math.min(sz - 20, girth + r() * 40);
  let tx = cx + (r() - 0.5) * (sx - tw) * 0.4, tz = cz + (r() - 0.5) * (sz - td) * 0.4;
  const tiers = th > 300 ? 4 : th > 180 ? 3 : th > 110 ? 2 : 1;
  const glassy = r() < 0.3 + 0.5 * d;
  const glassK = tk(C, HK.CURTAIN), stoneK = tintKind(fk, r());
  const frac = [[1], [0.62, 0.38], [0.48, 0.32, 0.2], [0.4, 0.28, 0.2, 0.12]][tiers - 1];
  let y = pod + 1.6;
  if (F) F.box(tx, (pod + pod + th) / 2, tz, tw, th, td, glassy ? glassK : stoneK);
  for (let t = 0; t < tiers; t++) {
    const h = th * frac[t];
    const k = glassy ? glassK : (t % 2 ? glassK : stoneK);
    const isGlass = k === glassK;
    B.box(tx, y + h / 2, tz, tw, h, td, k);
    // a lit band at each set-back (the tiers read as rings of light at night)
    B.box(tx, y + h - 2.5, tz, tw + 0.8, 2.4, td + 0.8, t === tiers - 1 ? CK.LANTERN : CK.BRONZE);
    // corner piers on stone tiers and fins on glass ones: the tier keeps its edges from afar
    if (!isGlass) for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) N.box(tx + ax * (tw / 2 - 1), y + h / 2, tz + az * (td / 2 - 1), 3.2, h - 3, 3.2, stoneK);
    else for (const s of [-1, 1]) N.box(tx + s * tw * 0.25, y + h / 2, tz + td / 2 + 0.6, 1.2, h - 4, 1.2, CK.BRONZE);
    // balconies on the long faces of stone tiers, floor lines on glass
    if (!isGlass) for (let yy = y + 10.8; yy < y + h - 6; yy += 10.8) N.box(tx, yy, tz + (t % 2 ? 1 : -1) * (td / 2 + 0.9), tw * 0.8, 0.3, 1.8, CK.DECK);
    else for (let yy = y + 28.8; yy < y + h - 6; yy += 28.8) N.box(tx, yy, tz, tw + 0.6, 0.5, td + 0.6, CK.BRONZE);
    y += h;
    if (t < tiers - 1) {
      // the set-back: next tier narrower, its terrace planted and railed
      const nw = tw * (0.7 + r() * 0.12), nd = td * (0.7 + r() * 0.12);
      M.box(tx, y + 0.6, tz, tw - 2, 1.2, td - 2, HK.ROOFGARDEN);
      railing(N, tx, y + 1.2, tz + td / 2 - 1, tw - 2, 0.1);
      railing(N, tx, y + 1.2, tz - td / 2 + 1, tw - 2, 0.1);
      if (tw > 50) for (let q = 0; q < 2; q++) tree(M, null, tx + (q ? 1 : -1) * (tw / 2 - 6), y + 1.2, tz + (r() - 0.5) * (td - 12), 5 + r() * 3, pickTree(C));
      tx += (r() - 0.5) * (tw - nw) * 0.5; tz += (r() - 0.5) * (td - nd) * 0.5;
      tw = nw; td = nd;
    }
  }
  // crown
  const cr = r(), m = Math.min(tw, td);
  if (cr < 0.22) {
    latheAt(B, tx, y - 0.5, tz, [[0.1, 0, CK.BRONZE], [m * 0.42, 0, CK.BRONZE], [m * 0.42, 9, CK.LANTERN], [m * 0.3, 14, CK.BRONZE], [0.1, 16, CK.BRONZE]], 12);
  } else if (cr < 0.42) {
    B.box(tx, y + 0.6, tz, tw - 4, 1.2, td - 4, HK.ROOFGARDEN);
    for (let q = 0; q < 3; q++) tree(N, null, tx + (r() - 0.5) * (tw - 12), y + 1.2, tz + (r() - 0.5) * (td - 12), 5 + r() * 3, pickTree(C));
  } else if (cr < 0.58) {
    latheAt(B, tx, y - 0.5, tz, [[0.1, 0, CK.BRONZE], [m * 0.5, 0, CK.BRONZE], [m * 0.12, Math.min(40, th * 0.12), CK.BRONZE], [0.1, Math.min(60, th * 0.18), CK.BRONZE]], 4, false, Math.PI / 4);
  } else if (cr < 0.74) {
    // stepped ziggurat crown, each step lit along its edge
    let w2 = tw, d2 = td, yy = y;
    for (let q = 0; q < 3; q++) {
      w2 *= 0.78; d2 *= 0.78;
      B.box(tx, yy + 4, tz, w2, 8, d2, q % 2 ? CK.BRONZE : (glassy ? glassK : stoneK));
      M.box(tx, yy + 7.6, tz, w2 + 0.6, 0.8, d2 + 0.6, CK.LANTERN);
      yy += 8;
    }
  } else if (cr < 0.88) {
    // an open crown: four lit piers and a ring beam round a roof garden
    for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box(tx + ax * (tw / 2 - 2), y + 11, tz + az * (td / 2 - 2), 4, 22, 4, CK.BRONZE);
    B.box(tx, y + 23, tz, tw, 2.4, td, CK.BRONZE);
    B.box(tx, y + 21.2, tz, tw - 6, 1.2, td - 6, CK.LANTERN);
    M.box(tx, y + 0.6, tz, tw - 6, 1.2, td - 6, HK.ROOFGARDEN);
  } else {
    // a raked top: the roof sloping across the tower, glazed, lit from within
    B.push(new THREE.Matrix4().makeTranslation(tx, y, tz));
    // inset 0.3 m so the roof sits on the tier instead of sharing its top face
    const rw = tw / 2 - 0.3, rd = td / 2 - 0.3;
    const pts = [[-rw, 0], [rw, 0], [rw, Math.min(36, tw * 0.45)]];
    B.loft([{ z: -rd, pts }, { z: rd, pts }], glassy ? glassK : CK.LANTERN, { capStart: stoneK, capEnd: stoneK });
    B.pop();
  }
  // rooftop plant and a maintenance hoist
  N.box(tx - tw * 0.25, y + 3, tz + (r() - 0.5) * td * 0.4, tw * 0.18, 6, td * 0.2, CK.DARK);
  if (th > 200) {
    M.box(tx + tw / 2 - 4, y + 18, tz + td / 2 - 4, 1.6, 36, 1.6, CK.DARK);
    C.lamps.push({ p: V3(tx + tw / 2 - 4, y + 38, tz + td / 2 - 4), r: 4, color: LAMPC.RED, i: 2.8, breathe: 0.5, phase: r() });
  }
  if (th > 140) C.lamps.push({ p: V3(tx, y + 18, tz), r: 5, color: C.style.accent, i: 1.8, breathe: 0.15, phase: r() });
  return y;
}

/**
 * Towers sharing a podium: two or three of different heights, girths and glass, joined by a
 * sky bridge; the downtown block that makes a skyline rather than a lone spike.
 */
function towerCluster(C, cx, cz, sx, sz, hmax, fk, dens) {
  const { B, M, S, r, F } = C;
  const y0 = deckHi(S, cx, sx);
  const podK = tintKind(fk, r());
  const pod = standBox(B, S, cx, cz, sx, sz, 14 + r() * 12, podK);
  B.box(cx, pod + 0.8, cz, sx - 6, 1.6, sz - 6, HK.ROOFGARDEN);
  if (F) massBox(F, S, cx, cz, sx, sz, pod + 1.6, podK, HK.ROOFGARDEN);
  M.box(cx, y0 + 4.2, cz + sz / 2 + 0.4, sx * 0.9, 2.0, 0.6, HK.NEON);
  M.box(cx, y0 + 4.2, cz - sz / 2 - 0.4, sx * 0.9, 2.0, 0.6, HK.NEON);
  const n = sx > 170 && sz > 170 && r() < 0.5 ? 3 : 2;
  const spots = n === 3 ? [[-0.25, -0.25], [0.25, -0.2], [0, 0.26]] : (r() < 0.5 ? [[-0.24, 0], [0.24, 0]] : [[0, -0.24], [0, 0.24]]);
  const tops = [];
  spots.forEach(([fx, fz], q) => {
    const w = Math.min(sx * 0.4, 42 + dens * 26 + r() * 16), dd = Math.min(sz * 0.4, 42 + dens * 26 + r() * 16);
    const x = cx + fx * sx, z = cz + fz * sz;
    const h = Math.min(hmax - (pod - y0) - 40, (q === 0 ? 1 : 0.55 + 0.35 * r()) * (120 + 520 * dens * dens) * (0.75 + 0.25 * r()));
    const k = r() < 0.75 ? tk(C, HK.CURTAIN) : tintKind(fk, r());
    const cut = h * (0.72 + r() * 0.12);
    B.box(x, pod + cut / 2, z, w, cut, dd, k);
    B.box(x, pod + cut + (h - cut) / 2, z, w * 0.74, h - cut, dd * 0.74, k);
    B.box(x, pod + cut + 1.2, z, w + 0.8, 2.4, dd + 0.8, CK.LANTERN);
    M.box(x, pod + cut + 3, z, w - 2, 1.2, dd - 2, HK.ROOFGARDEN);
    latheAt(B, x, pod + h - 0.5, z, [[0.1, 0, CK.BRONZE], [Math.min(w, dd) * 0.36, 0, CK.BRONZE], [0.1, 24 + r() * 50, CK.BRONZE]], 4, false, Math.PI / 4);
    if (F) F.box(x, pod + h / 2, z, w * 0.9, h, dd * 0.9, k);
    tops.push(V3(x, pod + h, z));
    C.lamps.push({ p: V3(x, pod + h + 30, z), r: 4, color: q ? C.style.accent : LAMPC.RED, i: 2.4, breathe: 0.4, phase: r() });
  });
  // the sky bridge between the first two, a third of the way up the shorter
  const [a, b] = tops, yb = pod + (Math.min(a.y, b.y) - pod) * 0.34;
  const len = a.distanceTo(V3(b.x, a.y, b.z));
  B.at((a.x + b.x) / 2, yb, (a.z + b.z) / 2, 0, Math.atan2(b.x - a.x, b.z - a.z), 0);
  B.box(0, 0, 0, 10, 8, len, CK.GLASS);
  B.box(0, -4.4, 0, 12, 0.8, len, CK.BRONZE);
  B.box(0, 4.4, 0, 10.4, 0.8, len, CK.LANTERN);
  B.pop();
}

/**
 * A slab: a long mid-rise along the block in two or three stretches of different heights, its
 * top storey set back behind a planted terrace, balcony bands down the long faces.
 */
function slabBlock(C, cx, cz, sx, sz, hmax, fk, dens) {
  const { B, M, N, S, r, F } = C;
  const alongX = r() < 0.5, L = alongX ? sx : sz, D = Math.min(alongX ? sz : sx, 26 + r() * 16);
  const parts = 2 + Math.floor(r() * 2), base = 18 + dens * 70;
  const off = (r() < 0.5 ? -1 : 1) * ((alongX ? sz : sx) / 2 - D / 2 - 6);
  let maxTop = 0;
  // the other half of the block: a garden court with trees
  const gx = alongX ? cx : cx - off * 0.9, gz = alongX ? cz - off * 0.9 : cz;
  const gw = alongX ? sx - 12 : (sx - D - 18), gd = alongX ? (sz - D - 18) : sz - 12;
  standBox(B, S, gx, gz, gw, gd, 0.9, tk(C, HK.LAWN), 6);
  for (let q = 0; q < 5; q++) tree(M, null, gx + (r() - 0.5) * (gw - 16), deckHi(S, gx, gw) + 0.9, gz + (r() - 0.5) * (gd - 16), 8 + r() * 6, pickTree(C));
  for (let p = 0; p < parts; p++) {
    const l = L / parts, c = -L / 2 + (p + 0.5) * l;
    const x = alongX ? cx + c : cx + off, z = alongX ? cz + off : cz + c;
    const w = alongX ? l - 1 : D, d = alongX ? D : l - 1;
    const h = Math.min(hmax, base * (0.7 + 0.6 * r()));
    const k = tintKind(fk, r());
    const top = standBox(B, S, x, z, w, d, h, k);
    maxTop = Math.max(maxTop, top);
    // the set-back top storey and its terrace
    B.box(x, top + 1.8, z, w - (alongX ? 4 : 10), 3.6, d - (alongX ? 10 : 4), k);
    M.box(x, top + 0.4, z, w - 1, 0.8, d - 1, HK.ROOFGARDEN);
    N.box(x, top + 4.2, z, w - (alongX ? 4 : 10) + 1, 1.2, d - (alongX ? 10 : 4) + 1, CK.BRONZE);
    // balcony bands along the long faces every other storey
    for (let yy = deckHi(S, x, w) + 10.8; yy < top - 4; yy += 7.2) for (const s of [-1, 1]) {
      if (alongX) N.box(x, yy, z + s * (d / 2 + 0.8), w - 4, 0.35, 1.6, CK.DECK);
      else N.box(x + s * (w / 2 + 0.8), yy, z, 1.6, 0.35, d - 4, CK.DECK);
    }
    M.box(alongX ? x : x + (off > 0 ? -1 : 1) * (w / 2 + 0.3), deckHi(S, x, w) + 4, alongX ? z + (off > 0 ? -1 : 1) * (d / 2 + 0.3) : z, alongX ? w * 0.8 : 0.5, 2, alongX ? 0.5 : d * 0.8, HK.NEON);
  }
  // (far: the slab as one mass under its planted roof)
  if (F) massBox(F, S, alongX ? cx : cx + off, alongX ? cz + off : cz, alongX ? sx : D, alongX ? D : sz, maxTop + 2, tintKind(fk, r()), HK.ROOFGARDEN);
  C.flamps.push({ p: V3(gx, deckHi(S, gx, 1) + 5, gz), r: 1.5, color: LAMPC.WARM, i: 1.5 });
  return maxTop;
}

/**
 * Terraced houses round a block of back gardens: runs of three to six houses under one
 * pitched roof, each run its own render and height, gables and chimneys, a tree in every
 * other garden. The suburbs' grain, where the city thins toward the walls.
 */
function rowHouses(C, cx, cz, sx, sz, fk) {
  const { B, M, N, S, r, F } = C;
  const depth = 11 + r() * 4;
  const inner = standBox(B, S, cx, cz, sx - 2 * depth - 4, sz - 2 * depth - 4, 0.9, tk(C, HK.LAWN), 6);
  const roofK = roofTint(C);
  const runs = [];
  for (let side = 0; side < 4; side++) {
    const alongX = side < 2, s = side % 2 ? 1 : -1;
    const L = alongX ? sx : sz - 2 * depth - 2;
    let t = -L / 2;
    while (t < L / 2 - 8) {
      const w = Math.min(L / 2 - t, 20 + r() * 30);
      if (w < 8) break;
      const c = t + w / 2;
      const x = alongX ? cx + c : cx + s * (sx / 2 - depth / 2), z = alongX ? cz + s * (sz / 2 - depth / 2) : cz + c;
      const h = 7.2 + Math.floor(r() * 3) * 3.6;
      const k = tintKind(r() < 0.3 ? facadeKind(C.style.pal + 1) : fk, r());
      const top = standBox(B, S, x, z, alongX ? w - 0.4 : depth, alongX ? depth : w - 0.4, h, k);
      gableRoof(B, x, top, z, depth + 1, 3.5 + depth * 0.25, w - 0.2, r() < 0.8 ? roofK : roofTint(C), k, alongX);
      if (r() < 0.6) N.box(alongX ? x + (r() - 0.5) * w * 0.6 : x, top + 3.4, alongX ? z : z + (r() - 0.5) * w * 0.6, 1.4, 3, 1.4, k);
      runs.push([x, z, alongX ? w : depth, alongX ? depth : w, top, k]);
      t += w + (r() < 0.25 ? 6 : 0);
    }
  }
  let hiTop = 0;
  for (const [x, z, w, d, top] of runs) {
    hiTop = Math.max(hiTop, top);
    N.box(x, deckHi(S, x, w) + 3.2, z, w * 0.9 + 0.8, 1.4, d * 0.9 + 0.8, HK.NEON);
  }
  // (far: the four sides as four runs under their roofs)
  if (F) for (let side = 0; side < 2; side++) {
    const s = side ? 1 : -1;
    massBox(F, S, cx, cz + s * (sz / 2 - depth / 2), sx, depth, hiTop + 1, tintKind(fk, r()), roofK);
  }
  const nt = 6 + Math.floor(r() * 6);
  for (let q = 0; q < nt; q++) tree(M, null, cx + (r() - 0.5) * (sx - 2 * depth - 20), inner, cz + (r() - 0.5) * (sz - 2 * depth - 20), 7 + r() * 6, pickTree(C));
  C.flamps.push({ p: V3(cx, inner + 4, cz), r: 1.3, color: LAMPC.WARM, i: 1.3 });
}

/**
 * Villas in gardens: four to seven detached houses under hipped roofs, each with its lawn,
 * trees and some a pool, hedged plots. The lowest density, near the walls.
 */
function villaBlock(C, cx, cz, sx, sz, fk) {
  const { B, M, N, S, r, F } = C;
  const g = standBox(B, S, cx, cz, sx, sz, 0.9, tk(C, HK.LAWN), 6);
  const nx = 2, nz = 2 + (r() < 0.5 ? 1 : 0), px = sx / nx, pz = sz / nz;
  const roofK = roofTint(C);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (r() < 0.12) continue;
    const x = cx - sx / 2 + (i + 0.5) * px + (r() - 0.5) * px * 0.2, z = cz - sz / 2 + (j + 0.5) * pz + (r() - 0.5) * pz * 0.2;
    const w = 16 + r() * 10, d = 12 + r() * 8, h = 7.2 + (r() < 0.4 ? 3.6 : 0);
    const k = tintKind(fk, r());
    const top = standBox(B, S, x, z, w, d, h, k);
    hipRoof(B, x, top, z, w + 1.6, d + 1.6, 4 + r() * 3, r() < 0.75 ? roofK : roofTint(C));
    if (r() < 0.5) {
      const wx = x + (i ? -1 : 1) * (w / 2 + 8), wz = z;
      B.box(wx, deckHi(S, wx, 10) + 1.0, wz, 8, 1.2, 14, HK.WATER);
      B.box(wx, deckHi(S, wx, 10) + 0.6, wz, 11, 1.4, 17, HK.STONE);
    }
    // the plot's hedge along the street side, and a tree or two
    N.box(x, g + 0.8, z + (j ? 1 : -1) * pz * 0.45, px * 0.8, 1.6, 1.2, tk(C, HK.CANOPY));
    for (let q = 0; q < 2; q++) tree(M, null, x + (r() - 0.5) * px * 0.7, g, z + (r() < 0.5 ? -1 : 1) * (d / 2 + 6 + r() * 8), 9 + r() * 7, pickTree(C));
    C.flamps.push({ p: V3(x, g + 3.5, z + d / 2 + 3), r: 1.1, color: LAMPC.WARM, i: 1.2 });
  }
}

/** Perimeter block: four wings round a planted court, tiled or planted roofs, a corner turret. */
function courtBlock(C, cx, cz, sx, sz, hmax, fk, dens = 0.5) {
  const { B, M, N, S, r } = C;
  const wing = 15 + r() * 8, pitched = r() < C.style.pitched * (1.25 - dens * 0.6);
  const base = Math.min(hmax, 10.8 + Math.round((r() * 5 + dens * 9)) * 3.6);
  const roofK = roofTint(C);
  let maxTop = 0;
  const wings = [
    [cx - sx / 2 + wing / 2, cz, wing, sz, false], [cx + sx / 2 - wing / 2, cz, wing, sz, false],
    // (the cross wings stand a hair inside the long ones' ends: no edge is shared between boxes)
    [cx, cz - sz / 2 + wing / 2 + 0.3, sx - 2 * wing, wing - 0.6, true], [cx, cz + sz / 2 - wing / 2 - 0.3, sx - 2 * wing, wing - 0.6, true],
  ];
  wings.forEach(([x, z, w, d, alongX], q) => {
    const h = base + (q % 2 ? 3.6 : 0) * Math.round(r() * 2);
    const k = tintKind(r() < 0.2 ? facadeKind(C.style.pal + 1) : fk, r());
    const top = standBox(B, S, x, z, w, d, h, k);
    maxTop = Math.max(maxTop, top);
    if (pitched) {
      gableRoof(B, x, top, z, (alongX ? d : w) + 1.2, 5 + (alongX ? d : w) * 0.22, (alongX ? w : d) + (alongX ? 0 : 1.2), roofK, k, alongX);
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
  if (C.F) massBox(C.F, S, cx, cz, sx, sz, maxTop + (pitched ? 4 + wing * 0.11 : 1), tintKind(fk, r()), pitched ? roofK : HK.ROOFGARDEN);
  // the court: lawn, a tree or three, a lamp
  standBox(B, S, cx, cz, sx - 2 * wing - 2, sz - 2 * wing - 2, 0.9, tk(C, HK.LAWN), 6);
  const nt = 2 + Math.floor(r() * 3);
  for (let t = 0; t < nt; t++) {
    const x = cx + (r() - 0.5) * (sx - 2 * wing - 20), z = cz + (r() - 0.5) * (sz - 2 * wing - 20);
    tree(M, null, x, deckHi(S, x, 1) + 0.9, z, 9 + r() * 7, pickTree(C));
  }
  C.flamps.push({ p: V3(cx, deckHi(S, cx, 1) + 5, cz), r: 1.6, color: LAMPC.WARM, i: 1.6 });
  // a corner turret with a pyramid cap on some blocks
  if (r() < 0.4) {
    const s = r() < 0.5 ? -1 : 1, t2 = r() < 0.5 ? -1 : 1, x = cx + s * (sx / 2 - wing / 2), z = cz + t2 * (sz / 2 - wing / 2);
    const top = standBox(B, S, x, z, wing + 4, wing + 4, base + 14, tintKind(fk, r()));
    hipRoof(B, x, top, z, wing + 5, wing + 5, 12, roofK);
  }
}

/** Stepped terraces: storeys stepping down to the south, a garden on every step. */
function steppedBlock(C, cx, cz, sx, sz, hmax, fk) {
  const { B, M, N, S, r } = C;
  const steps = 3 + Math.floor(r() * 3), alongX = r() < 0.5, L = alongX ? sx : sz, dir = r() < 0.5 ? -1 : 1;
  const storey = 3.6 * (2 + Math.floor(r() * 2));
  fk = tintKind(fk, r());
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

/**
 * A town cell: four by four blocks on a street grid, each block's type drawn from the city's
 * density there - downtown, towers on podiums, tower clusters and slabs; the middle city,
 * courtyard blocks, slabs, stepped terraces and the odd tower; the suburbs, terraced houses
 * round back gardens and villas. Squares and building sites anywhere. Street trees line the
 * blocks wherever the street is not a downtown canyon, lamps at the corners.
 */
export function townCell(C, x0, x1, z0, z1) {
  const { B, N, M, S, r } = C;
  const nb = 4, bw = (x1 - x0) / nb, bd = (z1 - z0) / nb;
  const hmax = Math.min(S.roofLow(x0), S.roofLow(x1)) - Math.max(S.deck(x0), S.deck(x1)) - 350;
  standBox(B, S, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 0.5, HK.STREET, 8);
  for (let i = 0; i < nb; i++) for (let j = 0; j < nb; j++) {
    const cx = x0 + (i + 0.5) * bw, cz = z0 + (j + 0.5) * bd, sx = bw - 36, sz = bd - 36;
    const pave = standBox(B, S, cx, cz, sx + 10, sz + 10, 0.9, HK.STONE, 6);            // pavements
    walk(C, 0, cx, cz, sx / 2 + 2.5, sz / 2 + 2.5, pave);
    const d = densityAt(C, cx, cz);
    const roll = r(), fk = facadeKind(C.style.pal + (r() < 0.25 ? (r() < 0.5 ? 1 : 5) : 0));
    if (roll < 0.035) constructionSite(C, cx, cz, sx, sz, hmax);
    else if (roll < 0.035 + 0.08 * (1.2 - d)) pocketSquare(C, cx, cz, sx, sz);
    else {
      const u = r();
      if (d > 0.68) {
        if (u < 0.42) setbackTower(C, cx, cz, sx, sz, hmax, fk, d);
        else if (u < 0.66) towerCluster(C, cx, cz, sx, sz, hmax, fk, d);
        else if (u < 0.86) slabBlock(C, cx, cz, sx, sz, hmax, fk, d);
        else courtBlock(C, cx, cz, sx, sz, hmax, fk, d);
      } else if (d > 0.42) {
        if (u < 0.18) setbackTower(C, cx, cz, sx, sz, hmax, fk, d);
        else if (u < 0.56) courtBlock(C, cx, cz, sx, sz, hmax, fk, d);
        else if (u < 0.76) slabBlock(C, cx, cz, sx, sz, hmax, fk, d);
        else steppedBlock(C, cx, cz, sx, sz, hmax, fk);
      } else {
        if (u < 0.42) rowHouses(C, cx, cz, sx, sz, fk);
        else if (u < 0.66) courtBlock(C, cx, cz, sx, sz, hmax, fk, d);
        else if (u < 0.86) villaBlock(C, cx, cz, sx, sz, fk);
        else steppedBlock(C, cx, cz, sx, sz, hmax, fk);
      }
    }
    // street lamps at the corners
    for (const [s, t] of [[-1, -1], [1, 1]]) {
      const lx = cx + s * (sx / 2 + 11), lz = cz + t * (sz / 2 + 11), ly = S.deck(lx);
      if (s > 0) N.box(lx, ly + 4.5, lz, 0.35, 9, 0.35, CK.DARK);
      C.flamps.push({ p: V3(lx, ly + 9.4, lz), r: 1.3, color: C.style.street, i: 1.5 });
    }
    // street trees: both long sides of the block outside downtown, one side within it
    const rows = d > 0.75 ? [(i + 2 * j) % 2 ? -1 : 1] : [-1, 1];
    const sp = pickTree(C);
    for (const s of rows) for (let t = -sx / 2 + 12, q = 0; t < sx / 2 - 8; t += 27, q++) {
      const tx = cx + t, tz = cz + s * (sz / 2 + 8);
      tree(N, null, tx, S.deck(tx) + 0.9, tz, 7 + r() * 3 + (q % 3) * 0.6, sp);
    }
    if ((i + j) % 2 === 0) C.lamps.push({ p: V3(x0 + i * bw + 8, S.deck(x0 + i * bw) + 9, z0 + j * bd + 8), r: 2.5, color: C.style.street, i: 1.4 });
  }
}

// ------------------------------------------------------------ open ground ----
export function parkCell(C, x0, x1, z0, z1, lakeFrac) {
  const { B, M, N, S, r, F } = C;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
  const lawnK = tk(C, HK.LAWN);
  const yg = standBox(B, S, cx, cz, sx, sz, 1.5, lawnK, 12);
  if (F) standBox(F, S, cx, cz, sx, sz, 1.5, lawnK, 12);
  let lake = null;
  if (lakeFrac > 0) {
    // an oval lake with a stone quay, an island, boats and a boathouse
    const lx = cx + (r() - 0.5) * sx * 0.2, lz = cz + (r() - 0.5) * sz * 0.2, R = sx * lakeFrac * 0.5, e = 0.7 + r() * 0.3;
    const y = deckHi(S, lx, 2 * R);
    lake = { lx, lz, R, e };
    B.push(new THREE.Matrix4().makeTranslation(lx, 0, lz).multiply(new THREE.Matrix4().makeScale(1, 1, e)));
    latheAt(B, 0, y + 1.0, 0, [[0.1, 0, HK.WATER], [R, 0, HK.WATER], [R, 1.1, HK.WATER], [0.1, 1.1, HK.WATER]], 28);
    latheAt(B, 0, y + 0.6, 0, [[R - 1, 0, HK.STONE], [R + 7, 0, HK.STONE], [R + 7, 2.6, HK.STONE], [R - 1, 2.6, HK.STONE]], 28, true);
    if (F) latheAt(F, 0, y + 1.0, 0, [[0.1, 1.1, HK.WATER], [R, 1.1, HK.WATER], [R, 0, HK.WATER]], 7);
    // island mound with a pavilion
    const ir = R * 0.16, ia = r() * TAU, ix = Math.cos(ia) * R * 0.4, iz = Math.sin(ia) * R * 0.4;
    latheAt(B, ix, y + 1.5, iz, [[0.1, 0, HK.LAWN], [ir, 0, HK.LAWN], [ir * 0.6, 6, HK.LAWN], [0.1, 8, HK.LAWN]], 10);
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
  // the formal garden before it: four planted beds round a basin, clipped hedges, stone walks
  const fz = pz + (pz < cz ? 1 : -1) * 90;
  if (!(lake && Math.hypot(px - lake.lx, (fz - lake.lz) / lake.e) < lake.R + 70)) {
    const fy = standBox(B, S, px, fz, 96, 76, 1.8, HK.STONE, 6);
    for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      B.box(px + ax * 24, fy + 0.5, fz + az * 18, 36, 1.0, 26, HK.ROOFGARDEN);
      M.box(px + ax * 24, fy + 1.2, fz + az * 18 + az * 13.5, 36, 2.4, 1.6, tk(C, HK.CANOPY));
    }
    latheAt(B, px, fy - 0.4, fz, [[0.1, 0, HK.WATER], [6, 0, HK.WATER], [6, 1.2, HK.WATER], [0.1, 1.2, HK.WATER]], 12);
    N.tube([V3(px, fy + 0.8, fz), V3(px, fy + 7, fz)], 0.5, 5, HK.WATER);
    walk(C, 1, px, fz, 9, 0, fy);
  }
  const clear = (x, z, pad) => !(lake && Math.hypot(x - lake.lx, (z - lake.lz) / lake.e) < lake.R + pad) && Math.hypot(x - px, z - pz) > 60 + pad && Math.abs(x - cx) > 10 + pad * 0.2 && Math.abs(z - cz) > 10 + pad * 0.2;
  // gentle hills: grassed mounds that break the lawn's plane and throw a shaded side
  const mounds = [];
  for (let q = 0; q < 3; q++) {
    const mr = 50 + r() * 70, mx = x0 + mr + 20 + r() * (sx - 2 * mr - 40), mz = z0 + mr + 20 + r() * (sz - 2 * mr - 40);
    if (!clear(mx, mz, mr + 10)) continue;
    const mh = 5 + r() * 9, my = Math.min(S.deck(mx - mr), S.deck(mx + mr)) + 1;
    const mk = tk(C, HK.LAWN);
    latheAt(B, mx, my, mz, [[mr, 0, mk], [mr * 0.72, mh * 0.45, mk], [mr * 0.35, mh * 0.92, mk], [0.1, mh, mk]], 12);
    mounds.push([mx, mz, mr]);
  }
  const onMound = (x, z) => mounds.some(([mx, mz, mr]) => Math.hypot(x - mx, z - mz) < mr + 4);
  // woods: massed canopies, each with trees standing out along its edge, and in the far layer
  // too, so a park reads as lawn and dark woods from 30 km instead of a flat green panel
  const woods = 3 + Math.floor(r() * 3);
  for (let c = 0; c < woods; c++) {
    const rx = 45 + r() * 80, rz = 35 + r() * 70, qx = x0 + rx + 15 + r() * (sx - 2 * rx - 30), qz = z0 + rx + 15 + r() * (sz - 2 * rx - 30);
    if (!clear(qx, qz, Math.max(rx, rz) + 12) || onMound(qx, qz)) continue;
    const kk = tk(C, HK.CANOPY), rot = r() * TAU, h = 14 + r() * 10;
    canopyMass(B, S, qx, qz, rx, rz, h, kk, rot, 10, r);
    if (F) massBox(F, S, qx, qz, 1.5 * Math.max(rx, rz), 1.5 * Math.max(rx, rz) * 0.8, S.deck(qx) + h * 0.7, kk, kk);
    const sp = pickTree(C), ne = 8 + Math.floor(r() * 8);
    for (let t = 0; t < ne; t++) {
      const a = r() * TAU, e = 1.0 + r() * 0.25, lx = Math.cos(a) * rx * e, lz = Math.sin(a) * rz * e;
      const tx = qx + lx * Math.cos(rot) + lz * Math.sin(rot), tz = qz - lx * Math.sin(rot) + lz * Math.cos(rot);
      if (!clear(tx, tz, 8)) continue;
      tree(M, N, tx, S.deck(tx) + 1.5, tz, 12 + r() * 12, r() < 0.7 ? sp : pickTree(C));
    }
  }
  // specimen trees standing alone on the lawns
  for (let t = 0; t < 18; t++) {
    const tx = x0 + 30 + r() * (sx - 60), tz = z0 + 30 + r() * (sz - 60);
    if (!clear(tx, tz, 12) || onMound(tx, tz)) continue;
    tree(M, N, tx, S.deck(tx) + 1.5, tz, 14 + r() * 12, pickTree(C));
  }
  // stone walks crossing the park, lamp-lit, lined with trees
  M.box(cx, S.deck(cx) + 1.8, cz, 8, 0.6, sz - 20, HK.STONE);
  walk(C, 0, cx, cz, 2.2, sz / 2 - 12, S.deck(cx) + 2.1);
  M.box(cx, S.deck(cx) + 1.8, cz, sx - 20, 0.6, 8, HK.STONE);
  for (let t = -sz / 2 + 40; t < sz / 2; t += 60) C.flamps.push({ p: V3(cx + 7, S.deck(cx) + 5, cz + t), r: 1.2, color: C.style.street, i: 1.3 });
  const avSp = pickTree(C);
  for (let t = -sz / 2 + 30; t < sz / 2 - 20; t += 26) for (const s of [-1, 1]) {
    const tx = cx + s * 10, tz = cz + t;
    if (lake && Math.hypot(tx - lake.lx, (tz - lake.lz) / lake.e) < lake.R + 12) continue;
    if (Math.abs(tz - cz) < 8) continue;
    tree(M, null, tx, S.deck(tx) + 1.5, tz, 10 + r() * 3, avSp);
  }
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
    for (let z = len0 + 110; z < len1; z += 220) ribArc(M, x, y, z, half, h, 1.1, CK.BRONZE, 6);
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

/**
 * The civic landmark at the heart of a plaza, in one of three forms by draw, each on a
 * colonnaded podium drum with a planted roof, each in its own curtain glass:
 *   0  the drum: a tapering glass tower girdled by lantern sky-lobbies, bronze fins running
 *      its full height (the silhouette keeps its taper and its rhythm from 40 km);
 *   1  the stack: six square prisms, each turned fifteen degrees on the one below and a little
 *      narrower, a lit band at every joint - a twisting skyline landmark;
 *   2  the gate: twin shafts of unequal height joined by glazed sky bridges, a bronze arch
 *      springing between their heads.
 * Returns the height over y its beacon is reckoned from, and whether a crown ring of lamps
 * stands clear round it.
 */
function landmark(C, cx, y, cz, top) {
  const { B, M, F, r } = C;
  const form = Math.floor(r() * 3);
  const gk = tintKind(HK.CURTAIN, r()), sk = tintKind(facadeKind(C.style.pal + 2), r());
  latheAt(B, cx, y - 10, cz, [[0.1, 0, CK.HULL], [150, 0, CK.HULL], [150, 26, sk], [146, 30, CK.BRONZE], [0.1, 30, HK.ROOFGARDEN]], 32);
  for (let q = 0; q < 24; q++) { const a = ((q + 0.5) / 24) * TAU; M.box(cx + Math.cos(a) * 154, y + 3, cz + Math.sin(a) * 154, 3.6, 26, 3.6, HK.STONE); }
  if (form === 0) {
    const prof = [[0.1, -10, CK.HULL], [124, -10, CK.HULL], [124, 20, CK.BRONZE]];
    const lobbies = 5, R0 = 118, R1 = 58;
    for (let q = 0; q < lobbies; q++) {
      const a = q / lobbies, b = (q + 1) / lobbies, ra = R0 - (R0 - R1) * a, rb = R0 - (R0 - R1) * b;
      prof.push([ra, 22 + a * top, gk], [rb, b * top - 14, gk], [rb + 4, b * top - 12, CK.LANTERN], [rb + 4, b * top - 2, CK.LANTERN], [rb, b * top, CK.BRONZE]);
    }
    prof.push([46, top + 30, CK.HULL], [12, top + 60, CK.BRONZE], [3, top + 150, CK.DARK], [0.1, top + 152, CK.DARK]);
    latheAt(B, cx, y, cz, prof, 28);
    for (let q = 0; q < 12; q++) {
      const a = (q / 12) * TAU;
      B.tube([V3(cx + Math.cos(a) * (R0 + 3), y + 20, cz + Math.sin(a) * (R0 + 3)), V3(cx + Math.cos(a) * (R1 + 3), y + top - 16, cz + Math.sin(a) * (R1 + 3))], 2.4, 4, CK.BRONZE);
    }
    for (let q = 0; q < 12; q++) {
      const a = (q / 12) * TAU * 2.5, t = 0.08 + (q / 12) * 0.84, rr = R0 - (R0 - R1) * t + 4;
      M.at(cx + Math.cos(a) * rr, y + t * top, cz + Math.sin(a) * rr, 0, -a, 0);
      M.box(0, 0, 0, 10, 2, 34, HK.ROOFGARDEN);
      M.pop();
    }
    if (F) latheAt(F, cx, y, cz, [[0.1, -10, CK.HULL], [R0, -10, gk], [R1, top, gk], [R1 + 4, top + 4, CK.LANTERN], [3, top + 150, CK.DARK], [0.1, top + 152, CK.DARK]], 8);
    return { crown: top, ring: true };
  }
  if (form === 1) {
    const n = 6, h = (top - 30) / n;
    let w = 176;
    for (let q = 0; q < n; q++) {
      const yq = y + 20 + q * h, a = (q * Math.PI) / 12;
      B.at(cx, yq, cz, 0, a, 0);
      B.box(0, h / 2 - 3, 0, w, h - 6, w, gk);
      B.box(0, h - 3, 0, w * 0.94, 6, w * 0.94, CK.LANTERN);
      for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) M.box(ax * (w / 2 - 1.5), h / 2 - 3, az * (w / 2 - 1.5), 4, h - 6, 4, CK.BRONZE);
      B.pop();
      if (F) { F.at(cx, yq, cz, 0, a, 0); F.box(0, h / 2, 0, w, h, w, gk); F.pop(); }
      w *= 0.87;
    }
    latheAt(B, cx, y + 20 + n * h, cz, [[0.1, 0, CK.BRONZE], [w * 0.5, 0, CK.BRONZE], [w * 0.2, 40, CK.LANTERN], [3, 150, CK.DARK], [0.1, 152, CK.DARK]], 4, false, Math.PI / 4);
    return { crown: 20 + n * h, ring: true };
  }
  // the gate: twin shafts, bridges, an arch
  const H = [top, top * (0.8 + r() * 0.1)];
  [-1, 1].forEach((s, i) => {
    const x = cx + s * 72;
    B.box(x, y + 20 + H[i] / 2, cz, 76, H[i], 108, gk);
    for (let q = 1; q < 4; q++) B.box(x, y + 20 + (H[i] * q) / 4, cz, 78, 4, 110, CK.LANTERN);
    B.box(x, y + 22 + H[i], cz, 70, 4, 100, CK.BRONZE);
    if (F) F.box(x, y + 20 + H[i] / 2, cz, 76, H[i], 108, gk);
  });
  for (let q = 1; q <= 3; q++) {
    const yb = y + 20 + (H[1] * q) / 4 + 30;
    B.box(cx, yb, cz, 70, 14, 40, CK.GLASS);
    B.box(cx, yb + 7.6, cz, 70, 1.2, 42, CK.LANTERN);
  }
  const pts = [];
  for (let q = 0; q <= 12; q++) { const a = (q / 12) * Math.PI; pts.push(V3(cx - Math.cos(a) * 72, y + 22 + H[1] + Math.sin(a) * 150, cz)); }
  B.tube(pts, 5, 6, CK.BRONZE);
  if (F) F.tube(pts.filter((p, i) => i % 3 === 0), 6, 4, CK.BRONZE);
  return { crown: H[1] + 22, ring: false };
}

/**
 * The street hierarchy between the cells, dressed after they are built (codeAt(ix, iz) gives
 * each cell's kind, 0 for the harbour quarter):
 *  - the tram boulevards at x = +-7 km: lawn verges either side of the rails with a double
 *    avenue of trees and lamp standards down each;
 *  - the spine's flanks: a linear park along both sides of the maglev viaduct, clear of its
 *    stations;
 *  - every street between cells: an avenue of kerb trees on both sides wherever the cells on
 *    either side are town, park or civic ground (not along the farms and works);
 *  - far: each avenue as a low strip of canopy, so the street grid reads from 12-40 km as
 *    green lines between the blocks, heavier along the boulevards.
 */
export function boulevards(C, codeAt, cellsX, cellsZ) {
  const { B, M, N, S, r, F } = C, TL = C.tileL;
  const urban = (c) => c > 0 && c !== 5 && c !== 7;       // not the harbour, farms or works
  const canopy = () => tintKind(HK.CANOPY, r());
  // tram boulevards
  for (const bx of [-7000, 7000]) for (const s of [-1, 1]) {
    const yb = S.deck(bx + s * 58), sp = pickTree(C);
    standBox(B, S, bx + s * 59, 0, 52, TL, 1.0, tintKind(HK.LAWN, r()), 8);
    for (let z = -TL / 2 + 10; z < TL / 2 - 4; z += 16) {
      if (Math.abs(Math.abs(z) - 1000) < 34) continue;               // the tram stops
      tree(M, null, bx + s * 40, yb + 1.0, z, 10 + r() * 3, sp);
      tree(N, null, bx + s * 76, yb + 1.0, z + 8, 11 + r() * 3, sp);
    }
    for (let z = -TL / 2 + 24; z < TL / 2; z += 48) C.flamps.push({ p: V3(bx + s * 31, yb + 8, z), r: 1.3, color: C.style.street, i: 1.4 });
    if (F) F.box(bx + s * 58, yb + 6, 0, 44, 12, TL, canopy());
  }
  // the spine's flanks, a kilometre at a time (not over the harbour)
  for (let iz = 0; iz < cellsZ; iz++) {
    const zc = -TL / 2 + (iz + 0.5) * 1000;
    if (!codeAt(14, iz) || !codeAt(15, iz)) continue;
    for (const s of [-1, 1]) {
      const x = s * 73, yb = S.deck(x);
      standBox(B, S, x, zc, 26, 1000, 1.0, tintKind(HK.LAWN, r()), 8);
      const sp = pickTree(C);
      for (let z = zc - 490; z < zc + 490; z += 18) {
        if (Math.abs(z) < 230) continue;                              // the station and its stairs
        tree(M, null, x, yb + 1.0, z, 11 + r() * 4, sp);
      }
      if (F) F.box(x, yb + 6, zc, 22, 12, 1000, canopy());
    }
  }
  // kerb avenues along the streets between cells: along z between columns...
  for (let ix = 1; ix < cellsX; ix++) {
    if (ix === 15 || ix === 8 || ix === 22) continue;                 // the spine and the tram boulevards
    const x = -15000 + ix * 1000;
    for (let iz = 0; iz < cellsZ; iz++) {
      const a = codeAt(ix - 1, iz), b = codeAt(ix, iz);
      if (!urban(a) || !urban(b)) continue;
      const zc = -TL / 2 + (iz + 0.5) * 1000, sp = pickTree(C);
      for (const s of [-1, 1]) for (let z = zc - 470 + (s > 0 ? 20 : 0); z < zc + 470; z += 40) tree(N, null, x + s * 18, S.deck(x + s * 18) + 0.6, z, 8 + r() * 3, sp);
      if (F) standBox(F, S, x, zc, 30, 940, 8, canopy(), 4);
    }
  }
  // ...and along x between rows (the tile's own edges carry one row each; the next tile the other)
  for (let iz = 0; iz <= cellsZ; iz++) {
    const zg = -TL / 2 + iz * 1000, rowsZ = iz === 0 ? [12] : iz === cellsZ ? [-12] : [-18, 18];
    for (let ix = 0; ix < cellsX; ix++) {
      const a = iz > 0 ? codeAt(ix, iz - 1) : codeAt(ix, iz), b = iz < cellsZ ? codeAt(ix, iz) : codeAt(ix, iz - 1);
      if (!urban(a) || !urban(b)) continue;
      const x0 = -15000 + ix * 1000, sp = pickTree(C);
      for (const dz of rowsZ) for (let x = x0 + 40 + (dz > 0 ? 20 : 0); x < x0 + 960; x += 40) tree(N, null, x, S.deck(x) + 0.6, zg + dz, 8 + r() * 3, sp);
      if (F && iz > 0 && iz < cellsZ) standBox(F, S, x0 + 500, zg, 920, 30, 8, canopy(), 4);
    }
  }
}

export function civicCell(C, x0, x1, z0, z1) {
  const { B, M, N, S, r, F } = C;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
  standBox(B, S, cx, cz, sx, sz, 2, HK.STONE, 12);
  const y = Math.max(S.deck(cx - 120), S.deck(cx + 120)) + 2;
  const top = Math.min(1300, Math.min(S.roofLow(cx - 100), S.roofLow(cx + 100)) - y - 320) * (0.6 + r() * 0.4);
  const lm = landmark(C, cx, y, cz, top);
  C.lamps.push({ p: V3(cx, y + lm.crown + 156, cz), r: 6, color: LAMPC.RED, i: 3.0, breathe: 0.5 });
  if (lm.ring) for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; C.lamps.push({ p: V3(cx + Math.cos(a) * 60, y + lm.crown + 34, cz + Math.sin(a) * 60), r: 3.5, color: C.style.accent, i: 2.0 }); }
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
    M.torus(rr, 0.8, 40, 4, q % 2 ? facadeKind(C.style.pal + 1) : HK.AWNING);
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
        if (F && i % 4 === 0) massBox(F, S, (xin + xw) / 2, zc, Math.abs(xw - xin), zl, Math.min(levels, i + 4) * H - 12, blockK, HK.STONE);
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
