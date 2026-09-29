import * as THREE from 'three';
import { CB, CK, sectionEllipse } from '../craft/craftGeometry.js';
import { lathe, buildShuttle, buildTug } from '../craft/craftClasses.js';
import { createCraftMaterial, updateCraftMaterial } from '../craft/craftMaterial.js';
import { CRAFT_FRAME } from './craftMesh.js';
import { createLamps, LAMP } from './lamps.js';
import { HALO_PORTS } from './earthData.js';
import { createHaloMaterial } from './haloMaterial.js';
import { HB } from './haloBuilder.js';
import { canalCell, boulevards, tree, buildCraneJib, CRANE_JIB, buildPerson, buildDrone, DISTRICT_STYLE, standBox, vault, ribArc, cliffs, townCell, parkCell, farmCell, civicCell, worksCell, stadiumCell, marketCell, buildVaultFrame, harbourTown, HARBOUR, buildHarbourBoat, portQuarter } from './haloArchitecture.js';
import { bodyDir, MERIDIAN_LON } from './sim.js';

// The Halo, lived in. Seen from orbit the deck shader already paints a continent of towns and
// fields under glass; within ~150 km of the band this module lays real districts over it:
//
//  - terraced habitat cliffs climbing both retaining walls (thirteen decks, lit window bands,
//    garden terraces with railings, glass lift shafts, a glazed concourse along each foot);
//  - the deck in kilometre cells: towns on street grids, parks and lakes, glasshouse farms,
//    civic towers kept 300 m clear of the vault, fabrication works;
//  - the spine maglev on its viaduct with a station in every tile, and tram boulevards;
//  - the outer wall faces: heat radiators on stand-offs, docking bays with lit mouths and
//    cradles (bays sized from the shuttles that use them);
//  - the wall crests: gantry rails, a walkway with lamp masts; at every hub the arch foot is
//    dressed with lift towers, bridges and a railed walkway along the arch's back;
//  - life: trains and trams running the ring, shuttles arriving and leaving the bays, and a
//    glass-maintenance gantry in every bay between arches, its crawlers sweeping the vault.
//
// Geometry is metres, built once per variant (lazily, one piece per frame on first approach)
// and drawn in 31 tile slots round the camera's tile, parented to an anchor on the ring that
// re-centres as the camera moves (every matrix stays small and exact in float32).

const TAU = Math.PI * 2;
export const TILE_L = 4000;                  // m of ring per district tile
export const WINDOW = 15;                    // tiles either side of the camera's tile
const SLOTS = 2 * WINDOW + 1;
export const NEAR_RANGE_KM = 150;            // districts drawn within this distance of the band
export const MINOR_RANGE_KM = 14;            // small detail (trees, balconies, loggias, boats) within this
export const MAJOR_RANGE_KM = 26;            // full massing within this; out to the window edge the tile's silhouette
export const FINE_RANGE_KM = 8;              // finest detail (railings, street trees, pier fins, street lamps)
export const FRAME_RANGE_KM = 40;            // the vault's ribs and purlins over the tiles within this
const SEAM_TILES = 8;                        // the last tiles before theta = 0 share the ring's remainder
export const FAR_TILES = 45;                 // silhouette tiles either side beyond the near window (180 km)
export const FAR_RANGE_KM = 420;             // silhouettes drawn within this distance of the band
export const VARIANTS = ['residential', 'agrarian', 'civic', 'works', 'lakeland', 'markets'];
/** Glass-survey drones over the vault near the camera: above the frame (15 m), below the pods (55 m). */
export const DRONES = { perTile: 6, reach: 2, lift: 32, half: 2.2 };
export const PEOPLE = { max: 1600, range: 900, spacing: 38, speed: 1.3 };   // walkers round the camera
export const HARBOUR_V = VARIANTS.length;        // the harbour town under each hub arch (tile variant 6)
const MOVER_RANGE = (WINDOW + 0.5) * TILE_L; // m either side of the anchor
export const BUILD_START_KM = 3000;          // district building starts this far off the band
export const LAMP_DAY_DIM = 0.66;            // district lamps dim by this much under the Sun
const BUILD_BUDGET_MS = 5;                   // per frame while approaching (at least one piece)
const ROT_YM90 = new THREE.Matrix4().makeRotationY(-Math.PI / 2);

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(a, b) {
  let n = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 0x9E37, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** The Halo's cross-section in metres (the same profile buildRing and haloArchProfile use). */
export function haloSectionM(def) {
  const w = def.width, hw = w / 2, wall = Math.max(1.2, w * 0.07), wt = Math.max(0.15, w * 0.012), rise = w * 0.085, tubeR = w * 0.035;
  const span = w + 2 * wt;
  const fy = (t) => -0.004 * w * (1 - 4 * t * t);
  // the floor is a 16-segment polyline across the ring: seat on the polyline, not the parabola
  const deck = (xm) => {
    const t = THREE.MathUtils.clamp(xm / 1000 / span, -0.5, 0.5), u = (t + 0.5) * 16;
    const i = Math.min(15, Math.floor(u)), f = u - i;
    return 1000 * (fy(i / 16 - 0.5) * (1 - f) + fy((i + 1) / 16 - 0.5) * f);
  };
  const roofCurve = (xm) => 1000 * (wall + rise * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs((2 * xm) / 1000 / w), 4))));
  // the glass is a 24-segment polyline under the curve: the lowest the vault can be
  const roofLow = (xm) => {
    const t = THREE.MathUtils.clamp(xm / 1000 / w, -0.5, 0.5), u = (t + 0.5) * 24;
    const i = Math.min(23, Math.floor(u)), f = u - i;
    return roofCurve((i / 24 - 0.5) * w * 1000) * (1 - f) + roofCurve(((i + 1) / 24 - 0.5) * w * 1000) * f;
  };
  return {
    hw: hw * 1000, wall: wall * 1000, wt: wt * 1000, outer: (hw + wt) * 1000, rise: rise * 1000,
    tubeR: tubeR * 1000, tubeX: (hw + tubeR * 0.6) * 1000, tubeY: -tubeR * 1.4 * 1000, deck, roofCurve, roofLow,
  };
}

// ------------------------------------------------------------ building kit ----
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const toY = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
// ------------------------------------------------------------ the tile ----
let FAR = null;
// While a tile variant is built, FAR (when set) receives its silhouette: terraced cliffs in three
// stacks, towers as full-height blocks, glasshouses as boxes, parks, lakes and lit halls. It is
// drawn instanced for 45 tiles either side of the near window, so the bands of lit habitat read
// from a few hundred kilometres and hand over to the full tiles without a change of layout.
function spine(B, M, lamps, S, withStation) {
  // the maglev spine on its viaduct over the ring's centre line
  const y0 = S.deck(0), yT = y0 + 34;
  B.box(0, yT - 3, 0, 36, 6, TILE_L, CK.HULL);
  for (const x of [-9, 9]) B.box(x, yT + 0.8, 0, 5, 1.6, TILE_L, CK.BRONZE);
  B.box(0, yT - 6.5, 0, 26, 1, TILE_L, CK.LANTERN);
  for (let z = -TILE_L / 2 + 100; z < TILE_L / 2; z += 200) {
    B.box(0, (y0 - 14 + yT - 6) / 2, z, 9, yT - 6 - y0 + 14, 14, CK.HULL);
    M.box(0, yT - 7, z, 30, 2, 18, CK.DARK);
  }
  for (const x of [-17.6, 17.6]) M.box(x, yT + 0.65, 0, 0.3, 1.3, TILE_L, CK.BRONZE);
  for (let i = 0; i < TILE_L / 100; i++) lamps.push({ p: V3(i % 2 ? 18 : -18, yT + 6, -TILE_L / 2 + 50 + i * 100), r: 1.6, color: [1.0, 0.82, 0.6], i: 1.2 });
  if (withStation) {
    // station hall: platforms either side, a glass vault over them, stair towers down
    for (const x of [-26, 26]) B.box(x, yT - 1, 0, 14, 4, 380, CK.DECK);
    vault(B, 0, yT + 1, -200, 200, 40, 24, CK.GLASS, false, 12, 4);   // open ends: the trains run through
    for (let z = -180; z <= 180; z += 30) ribArc(M, 0, yT + 1, z, 40, 24, 0.8, CK.BRONZE, 8);
    for (const x of [-48, 48]) for (const z of [-150, 150]) {
      B.box(x, (y0 - 12 + yT + 8) / 2, z, 18, yT + 20 - y0, 18, CK.GLASS);
      lamps.push({ p: V3(x, yT + 12, z), r: 3, color: LAMP.AMBER, i: 1.8 });
    }
    B.box(0, yT + 23.5, 0, 60, 1.5, 3, CK.LANTERN);
  }
  // tram boulevards at x = +-7 km: a planted median, rails, shelters at the stops
  for (const bx of [-7000, 7000]) {
    const yb = S.deck(bx);
    standBox(B, S, bx, 0, 60, TILE_L, 0.8, CK.DECK, 8);
    for (const x of [-10.7, -5.3, 5.3, 10.7]) M.box(bx + x, yb + 1.0, 0, 0.8, 0.4, TILE_L, CK.BRONZE);
    M.box(bx, yb + 1.1, 0, 4, 0.6, TILE_L, CK.GARDEN);
    for (let z = -TILE_L / 2 + 25; z < TILE_L / 2; z += 50) tree(M, null, bx + (z % 100 ? 22 : -22), yb + 0.8, z, 11 + (z % 150) * 0.01, 1);
    for (const z of [-1000, 1000]) for (const sd of [-1, 1]) {
      M.box(bx + sd * 17, yb + 4, z, 4, 6, 40, CK.GLASS);
      lamps.push({ p: V3(bx + sd * 17, yb + 8, z), r: 1.6, color: LAMP.AMBER, i: 1.8 });
    }
  }
}

function outerWall(B, M, lamps, S, bay) {
  // radiators on stand-offs between the docking bays, and the bays themselves
  const Xo = S.outer;
  for (const sg of [-1, 1]) {
    const panels = [[-TILE_L / 2 + 20, -1000 - bay.w / 2 - 60], [-1000 + bay.w / 2 + 60, 1000 - bay.w / 2 - 60], [1000 + bay.w / 2 + 60, TILE_L / 2 - 20]];
    for (const [za, zb] of panels) {
      const zc = (za + zb) / 2, zl = zb - za;
      B.box(sg * (Xo + 44), 1050, zc, 4, 1500, zl, CK.RADIATOR);
      for (const y of [290, 1810]) B.tube([V3(sg * (Xo + 44), y, za + 4), V3(sg * (Xo + 44), y, zb - 4)], 7, 8, CK.CONDUIT);
      for (let z = za + 60; z < zb - 20; z += 150) for (const y of [300, 1050, 1800]) M.box(sg * (Xo + 21), y, z, 42, 6, 6, CK.DARK);
    }
    for (const zb of [-1000, 1000]) {
      const xm = sg * (Xo + bay.d / 2), yb = bay.y, hw = bay.w / 2, hh = bay.h / 2;
      B.box(xm, yb + hh + 6, zb, bay.d, 12, bay.w + 24, CK.HULL);
      B.box(xm, yb - hh - 6, zb, bay.d, 12, bay.w + 24, CK.HULL);
      for (const s of [-1, 1]) B.box(xm, yb, zb + s * (hw + 6), bay.d, bay.h, 12, CK.HULL);
      // lit mouth frame and the glowing back of the hangar
      const xmth = sg * (Xo + bay.d + 1);
      B.box(xmth, yb + hh + 1, zb, 3, 3, bay.w, CK.LANTERN);
      B.box(xmth, yb - hh - 1, zb, 3, 3, bay.w, CK.LANTERN);
      for (const s of [-1, 1]) B.box(xmth, yb, zb + s * (hw + 1), 3, bay.h, 3, CK.LANTERN);
      B.box(sg * (Xo + 2), yb, zb, 2, bay.h - 20, bay.w - 20, CK.LANTERN);
      B.box(xm, yb - hh + 1, zb, bay.d - 4, 2, bay.w - 4, CK.DECK);
      // cradle arms and a gangway (minor)
      for (const s of [-1, 1]) {
        M.box(sg * (Xo + bay.d * 0.5), yb - hh + bay.clear * 0.5, zb + s * bay.cradle, 18, bay.clear, 6, CK.BRONZE);
        M.box(sg * (Xo + 12), yb - hh + 18, zb + s * (hw - 20), 24, 8, 8, CK.GLASS);
      }
      for (const [y, z] of [[yb + hh + 10, zb - hw], [yb + hh + 10, zb + hw], [yb - hh - 10, zb - hw], [yb - hh - 10, zb + hw]])
        lamps.push({ p: V3(sg * (Xo + bay.d + 6), y, z), r: 4, color: LAMP.AMBER, i: 2.6, breathe: 0.35, phase: (zb > 0 ? 0.5 : 0) + (y > yb ? 0.25 : 0) });
      lamps.push({ p: V3(sg * (Xo + bay.d * 0.5), yb + hh - 6, zb), r: 5, color: LAMP.WHITE, i: 2.0 });
    }
  }
}

/**
 * The rotor sheaths under the wall feet: octagonal casings (the ring's own tube section) carry
 * bearing hoops every 500 m and a crawler track on the upper outboard face; hangers tie each
 * wall foot to its sheath. Crawlers (movers) ride the track over the hoops.
 */
export function rotorGeometry(S) {
  const apo = S.tubeR * Math.cos(Math.PI / 8), side = 2 * S.tubeR * Math.sin(Math.PI / 8);
  const face = Math.PI / 8;                               // the upper outboard face's normal angle
  return { apo, side, face, crawlerLift: 22, hoop: 12 };
}
function rotors(B, M, lamps, S) {
  const G = rotorGeometry(S);
  for (const sg of [-1, 1]) {
    const cx = sg * S.tubeX, cy = S.tubeY;
    for (let z = -TILE_L / 2 + 250; z < TILE_L / 2; z += 500) {
      for (let k = 0; k < 8; k++) {
        const a = ((k + 0.5) / 8) * TAU, nx = Math.cos(a), ny = Math.sin(a);
        B.at(cx + sg * nx * (G.apo + G.hoop / 2), cy + ny * (G.apo + G.hoop / 2), z, 0, 0, Math.atan2(ny, sg * nx) - Math.PI / 2);
        B.box(0, 0, 0, G.side + 12, G.hoop, 20, k % 2 ? CK.BRONZE : CK.HULL);
        B.pop();
      }
      // hanger from the wall's outer foot to the sheath's upper inboard face
      const fa = (5 * Math.PI) / 8, top = V3(sg * (S.outer - 30), -380, z), bot = V3(sg * (S.tubeX + Math.cos(fa) * (G.apo + 4)), cy + Math.sin(fa) * (G.apo + 4), z);
      B.tube([top, bot], 9, 8, CK.DARK);
      lamps.push({ p: V3(cx + sg * (G.apo + 30) * Math.cos(G.face), cy + (G.apo + 30) * Math.sin(G.face), z), r: 6, color: LAMP.TEAL, i: 2.0, breathe: 0.4, phase: (z / TILE_L + 0.5) % 1 });
    }
    // crawler track: two rails along the upper outboard face
    for (const off of [-40, 40]) {
      const a = G.face, nx = Math.cos(a), ny = Math.sin(a), tx = -ny, ty = nx;
      const px = cx + sg * (nx * (G.apo + G.hoop + 2) + tx * off), py = cy + ny * (G.apo + G.hoop + 2) + ty * off;
      M.box(px, py, 0, 4, 4, TILE_L, CK.BRONZE);
    }
  }
}

/**
 * Service galleries slung under the deck slab (facing the Earth): utility trunks along the
 * ring with lit crew corridors in their keels, hangers to the slab, and inspection lamps.
 */
export const UNDER = { slab: -400, xs: [-11500, -4200, 4200, 11500], half: 60, depth: 48 };
function underDeck(B, M, lamps, S) {
  for (const x of UNDER.xs) {
    // the slab's underside follows the floor's sag, 400 m under it; embed the trunks 12 m
    const y0 = S.deck(x) + UNDER.slab + 12 + 8;
    const n = 10, pts = [];
    for (let i = 0; i <= n; i++) { const a = Math.PI + (i / n) * Math.PI; pts.push([x + Math.cos(a) * UNDER.half, y0 - 8 + Math.sin(a) * UNDER.depth]); }
    const rings = [];
    for (let j = 0; j <= 4; j++) rings.push({ z: -TILE_L / 2 + (TILE_L * j) / 4, pts });
    B.loft(rings, (i) => (i === 4 || i === 5 || i === 6 ? CK.LANTERN : i === 3 || i === 7 ? CK.GLASS : CK.HULL), { capStart: false, capEnd: false });
    for (let z = -TILE_L / 2 + 125; z < TILE_L / 2; z += 250) {
      // a hoop hugging the trunk's elliptical keel (1.6 m tube, touching the skin)
      const hoop = [];
      for (let i = 0; i <= 12; i++) { const a = Math.PI + (i / 12) * Math.PI; hoop.push(V3(x + Math.cos(a) * (UNDER.half + 1.6), y0 - 8 + Math.sin(a) * (UNDER.depth + 1.6), z)); }
      M.tube(hoop, 1.6, 4, CK.BRONZE);
    }
    for (let z = -TILE_L / 2 + 250; z < TILE_L / 2; z += 500) lamps.push({ p: V3(x, y0 - 8 - UNDER.depth - 4, z), r: 5, color: z % 1000 ? LAMP.WHITE : LAMP.AMBER, i: 2.0, breathe: 0.25, phase: (x / 23000 + 0.5) % 1 });
    if (FAR) FAR.box(x, y0 - 8 - UNDER.depth / 2, 0, UNDER.half * 2, UNDER.depth, TILE_L, CK.LANTERN);
  }
}

function crest(B, M, lamps, S, hubArch) {
  // wall crests: gantry rails, walkway, lamp masts; at a hub a gap under the arch corbel
  const gap = hubArch ? hubArch.gap : 0;
  const spans = gap ? [[-TILE_L / 2, -gap], [gap, TILE_L / 2]] : [[-TILE_L / 2, TILE_L / 2]];
  const yc = S.wall;
  for (const sg of [-1, 1]) {
    for (const [za, zb] of spans) {
      const zc = (za + zb) / 2, zl = zb - za;
      for (const x of RAIL_X) B.box(sg * x, yc + 2.5, zc, 6, 5, zl, CK.BRONZE);
      B.box(sg * 16195, yc + 1, zc, 40, 2, zl, CK.DECK);
      for (const x of [16175.2, 16214.8]) M.box(sg * x, yc + 2.6, zc, 0.4, 1.2, zl, CK.BRONZE);
      for (let z = za + 125; z < zb; z += 250) {
        M.box(sg * MAST_X, yc + 12, z, 1, 22, 1, CK.BRONZE);
        lamps.push({ p: V3(sg * MAST_X, yc + 24, z), r: 3, color: LAMP.AMBER, i: 1.6 });
      }
      // navigation lights on the outer edge: red to one side, green to the other
      for (let z = za + 250; z < zb; z += 500) lamps.push({ p: V3(sg * (S.outer - 4), yc + 6, z), r: 10, color: sg > 0 ? LAMP.GREEN : LAMP.RED, i: 2.8, breathe: 0.3, phase: (z / 4000 + 0.5) % 1 });
    }
  }
  if (!hubArch) return;
  // the arch foot: lift towers either side of each corbel, bridges to the girder, and a railed
  // walkway with beacons over the arch's back
  const P = hubArch.profile, W = P.girder * 1000;
  for (const sg of [-1, 1]) {
    for (const s of [-1, 1]) {
      const tz = s * (hubArch.corbelHalf + 70), tx = sg * P.leg * 1000, top = (P.wall + 1.1) * 1000;
      B.box(tx, (yc + top) / 2, tz, 60, top - yc, 60, CK.GLASS);
      B.box(tx, top + 8, tz, 66, 16, 66, CK.BRONZE);
      B.box(tx, top - 60, (tz + s * W / 2) / 2 + s * 20, 22, 8, Math.abs(tz - s * W / 2) - 30 + 2, CK.DECK);
      lamps.push({ p: V3(tx, top + 22, tz), r: 7, color: LAMP.WHITE, i: 2.4, breathe: 0.3 });
    }
  }
  const pts = P.pts, D = P.depth * 1000, back = 0.28 * 1000;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    if (Math.min(ay, by) * 1000 < S.wall + 340) continue;       // the girder's ends are buried in the corbels
    const tx = bx - ax, ty = by - ay, l = Math.hypot(tx, ty) * 1000;
    // outward normal (away from the vault): the right of the +x->-x path
    let nx = -ty, ny = tx; const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
    if (ny < 0) { nx = -nx; ny = -ny; }
    const mx = ((ax + bx) / 2) * 1000 + nx * (D / 2 + 1.5), my = ((ay + by) / 2) * 1000 + ny * (D / 2 + 1.5);
    const ang = Math.atan2(ty, tx);
    B.at(mx, my, 0, 0, 0, ang);
    B.box(0, 0, 0, l + 2, 3, 30, CK.DECK);
    M.box(0, 1.9, 14.8, l + 2, 1.2, 0.4, CK.BRONZE);
    M.box(0, 1.9, -14.8, l + 2, 1.2, 0.4, CK.BRONZE);
    B.pop();
    if (i % 8 === 4) {
      M.box(mx + nx * 12, my + ny * 12, back / 2 - 30, 2, 24, 2, CK.BRONZE);
      lamps.push({ p: V3(mx + nx * 26, my + ny * 26, back / 2 - 30), r: 5, color: LAMP.WHITE, i: 2.2, breathe: 0.25, phase: i / pts.length });
    }
  }
}
const RAIL_X = [16100, 16290];
const MAST_X = 16340;                        // crest lamp masts, outboard of the gantry bogies

/** One district variant (metres, x across the ring, y up from its radius, z along it). */
/**
 * Each variant's downtown: centre (x across, z along; m) and radii. The towers gather there
 * and the city thins away from it (haloArchitecture densityAt); a variant's is fixed, so the
 * plan painted on the deck and every copy of the tile agree.
 */
export function districtCore(variant) {
  const r = mulberry(variant * 7331 + 101);
  const side = r() < 0.5 ? -1 : 1;
  return [side * (1800 + r() * 7200), (r() - 0.5) * 2200, 3200 + r() * 2600, 1700 + r() * 1300];
}
export function buildDistrictTile(variant, S, bay, seed = 1) {
  const B = new HB(), M = new HB(), N = new HB(), F = new HB(), lamps = [], flamps = [];
  const r = mulberry(seed * 7919 + variant * 104729 + 17);
  const C = { B, M, N, F, lamps, flamps, S, r, style: DISTRICT_STYLE[variant], tileL: TILE_L, walks: [], cranes: [], core: districtCore(variant) };
  const steps = buildDistrictSteps(C, bay, variant);
  FAR = F;
  try { while (!steps.next().done); } finally { FAR = null; }
  return { major: B.geometry(), minor: M.geometry(), fine: N.geometry(), far: F.geometry(), lamps, flamps, cells: B.cells, walks: new Float32Array(C.walks), cranes: new Float32Array(C.cranes) };
}
/** The same tile built a slice per call (the terraces and services, then six columns of cells at a time). */
export function* buildDistrictTileSteps(variant, S, bay, seed = 1) {
  const B = new HB(), M = new HB(), N = new HB(), F = new HB(), lamps = [], flamps = [];
  const r = mulberry(seed * 7919 + variant * 104729 + 17);
  const C = { B, M, N, F, lamps, flamps, S, r, style: DISTRICT_STYLE[variant], tileL: TILE_L, walks: [], cranes: [], core: districtCore(variant) };
  const steps = buildDistrictSteps(C, bay, variant);
  for (;;) {
    FAR = F;
    let done;
    try { done = steps.next().done; } finally { FAR = null; }
    if (done) break;
    yield null;
  }
  // the buffers a layer or two per slice (a tile's run to tens of megabytes)
  const out = { lamps, flamps, cells: B.cells, walks: new Float32Array(C.walks), cranes: new Float32Array(C.cranes) };
  out.major = B.geometry();
  yield null;
  out.minor = M.geometry();
  yield null;
  out.fine = N.geometry(); out.far = F.geometry();
  return out;
}
function* buildDistrictSteps(C, bay, variant) {
  const { B, M, F, lamps, S, r } = C;
  cliffs(C);
  // far silhouette of the spine, the outer walls' radiators and lit dock mouths
  F.box(0, S.deck(0) + 20, 0, 36, 40, TILE_L, CK.HULL);
  for (const sg of [-1, 1]) {
    F.box(sg * (S.outer + 44), 1050, 0, 4, 1500, TILE_L - 40, CK.RADIATOR);
    for (const zb of [-1000, 1000]) F.box(sg * (S.outer + bay.d / 2), bay.y, zb, bay.d, bay.h + 24, bay.w + 24, CK.LANTERN);
  }
  spine(B, M, C.flamps, S, true);        // (its platform and viaduct lamps are street lamps: near only)
  outerWall(B, M, lamps, S, bay);
  rotors(B, M, lamps, S);
  underDeck(B, M, lamps, S);
  const harbour = variant === HARBOUR_V ? harbourTown(C) : null;
  yield;
  const codes = cellKinds(variant);
  const cells = Object.fromEntries(CELL_NAMES.slice(1).map((k) => [k, 0]));
  for (let ix = 0; ix < CELLS_X; ix++) for (let iz = 0; iz < CELLS_Z; iz++) {
    const cx = -15000 + ix * 1000, cz = -TILE_L / 2 + iz * 1000;
    if (iz === 0 && ix > 0 && ix % 4 === 0) yield;
    const edge = (x) => (x === 0 || Math.abs(x) === 7000 ? 90 : 30);
    const x0 = cx + edge(cx), x1 = cx + 1000 - edge(cx + 1000);
    const z0 = cz + 30, z1 = cz + 1000 - 30;
    const kind = CELL_NAMES[codes[iz * CELLS_X + ix]];
    if (!kind) continue;                                               // the harbour quarter
    cells[kind]++;
    if (kind === 'town') townCell(C, x0, x1, z0, z1);
    else if (kind === 'park') parkCell(C, x0, x1, z0, z1, 0);
    else if (kind === 'pond') parkCell(C, x0, x1, z0, z1, 0.35);
    else if (kind === 'lake') parkCell(C, x0, x1, z0, z1, 0.62);
    else if (kind === 'farm') farmCell(C, x0, x1, z0, z1);
    else if (kind === 'civic') civicCell(C, x0, x1, z0, z1);
    else if (kind === 'stadium') stadiumCell(C, x0, x1, z0, z1);
    else if (kind === 'market') marketCell(C, x0, x1, z0, z1);
    else if (kind === 'canal') canalCell(C, x0, x1, z0, z1);
    else worksCell(C, x0, x1, z0, z1);
  }
  yield;
  boulevards(C, (ix, iz) => codes[iz * CELLS_X + ix], CELLS_X, CELLS_Z);
  B.cells = cells;
}

// ------------------------------------------------------------ cell plan ----
// Each variant's kilometre cells are chosen by a hash of (variant, cell), not by the builder's
// random stream, so the plan is known before any geometry exists: the deck shader paints the
// very same plan (towns as blocks and streets, parks, lakes, glasshouse ranges, civic plazas)
// round the whole ring, and the silhouettes and full districts rise onto it without a change
// of layout (src/space/rings.js, HALO_CELLS).
export const CELLS_X = 30, CELLS_Z = TILE_L / 1000;
export const CELL_NAMES = ['', 'town', 'park', 'pond', 'lake', 'farm', 'civic', 'works', 'stadium', 'market', 'canal'];
const CELL_WEIGHTS = [
  { town: 0.48, park: 0.18, farm: 0.1, civic: 0.06, lake: 0.08, works: 0, stadium: 0.02, market: 0.08 },
  { town: 0.14, park: 0.2, farm: 0.52, civic: 0.02, lake: 0.08, works: 0.04, stadium: 0, market: 0 },
  { town: 0.36, park: 0.2, farm: 0.04, civic: 0.18, lake: 0.1, works: 0, stadium: 0.04, market: 0.08 },
  { town: 0.28, park: 0.12, farm: 0.18, civic: 0.04, lake: 0.04, works: 0.3, stadium: 0, market: 0.04 },
  { town: 0.3, park: 0.2, farm: 0.06, civic: 0.04, lake: 0.24, works: 0, stadium: 0.04, market: 0.04, canal: 0.06 },
  { town: 0.46, park: 0.14, farm: 0.02, civic: 0.1, lake: 0.04, works: 0.06, stadium: 0.06, market: 0.12 },
  { town: 0.4, park: 0.22, farm: 0, civic: 0.14, lake: 0.06, works: 0, stadium: 0.04, market: 0.14 },
];
const _cellCache = [];
/** Cell codes (index into CELL_NAMES, 0 = left to the harbour) of a variant, row-major by z. */
export function cellKinds(variant) {
  if (_cellCache[variant]) return _cellCache[variant];
  const w = CELL_WEIGHTS[variant], kinds = Object.keys(w), out = new Uint8Array(CELLS_X * CELLS_Z);
  let canals = 0;
  for (let ix = 0; ix < CELLS_X; ix++) for (let iz = 0; iz < CELLS_Z; iz++) {
    const cx = -15000 + ix * 1000;
    if (variant === HARBOUR_V && cx >= -HARBOUR.ground && cx < HARBOUR.ground) continue;
    let u = hash2(variant * 977 + ix * 31 + iz, 71 + variant), kind = kinds[kinds.length - 1];
    for (const k of kinds) { if (u < w[k]) { kind = k; break; } u -= w[k]; }
    // civic towers only where the vault is high (away from the walls)
    if (kind === 'civic' && Math.abs(cx + 500) > 11000) kind = 'town';
    if (kind === 'park' && hash2(ix * 13 + variant, iz * 17 + 5) < 0.4) kind = 'pond';
    // canal quarters are the costliest cells (a thousand gabled houses each): four a tile at most
    if (kind === 'canal' && ++canals > 4) kind = 'lake';
    out[iz * CELLS_X + ix] = CELL_NAMES.indexOf(kind);
  }
  return (_cellCache[variant] = out);
}
/**
 * The plan as textures for the deck shader: cells (CELLS_X x CELLS_Z rows per variant, code in
 * red) and the variant of every tile (+1, 0 = undressed; green: an undressed tile's ground)
 * laid out PLAN_W wide.
 */
export const PLAN_W = 256;
export function cellPlanTextures(tileVariant, tileGround = null) {
  const nV = VARIANTS.length + 1, cd = new Uint8Array(CELLS_X * CELLS_Z * nV * 4);
  for (let v = 0; v < nV; v++) {
    const c = cellKinds(v);
    for (let i = 0; i < c.length; i++) cd[(v * c.length + i) * 4] = c[i];
  }
  const cells = new THREE.DataTexture(cd, CELLS_X, CELLS_Z * nV);
  const H = Math.ceil(tileVariant.length / PLAN_W), td = new Uint8Array(PLAN_W * H * 4);
  for (let k = 0; k < tileVariant.length; k++) { td[k * 4] = tileVariant[k] + 1; td[k * 4 + 1] = tileGround ? tileGround[k] : 0; }
  const tiles = new THREE.DataTexture(td, PLAN_W, H);
  for (const t of [cells, tiles]) { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; }
  return { cells, tiles, rows: H };
}

/** Crest furniture for a tile: plain, or dressed for an arch foot at the tile's centre. */
export function buildCrest(S, hubArch) {
  const B = new HB(), M = new HB(), lamps = [];
  crest(B, M, lamps, S, hubArch);
  return { major: B.geometry(), minor: M.geometry(), lamps };
}

/** A glass-maintenance gantry spanning the vault on the crest rails (metres, same frame). */
export function buildGantry(S) {
  const B = new CB(), lamps = [];
  const N = 120, top = [], bot = [];
  const half = S.hw;
  for (let i = 0; i <= N; i++) {
    const x = half * Math.sin((i / N - 0.5) * Math.PI);
    top.push([x, S.roofCurve(x) + GANTRY.top]);
    bot.push([x, S.roofCurve(x) + GANTRY.bottom]);
  }
  for (const z of [-GANTRY.halfDepth, GANTRY.halfDepth]) {
    B.tube(top.map(([x, y]) => V3(x, y, z)), 4.5, 8, CK.HULL);
    B.tube(bot.map(([x, y]) => V3(x, y, z)), 4, 8, CK.BRONZE);
    for (let i = 0; i < N; i++) {
      const a = i % 2 ? top : bot, b = i % 2 ? bot : top;
      B.tube([V3(a[i][0], a[i][1], z), V3(b[i + 1][0], b[i + 1][1], z)], 1.6, 5, CK.DARK);
      B.tube([V3(top[i][0], top[i][1], z), V3(bot[i][0], bot[i][1], z)], 1.8, 5, CK.DARK);
    }
  }
  for (let i = 0; i <= N; i += 2) {
    B.tube([V3(top[i][0], top[i][1], -GANTRY.halfDepth), V3(top[i][0], top[i][1], GANTRY.halfDepth)], 1.6, 5, CK.DARK);
    B.tube([V3(bot[i][0], bot[i][1], -GANTRY.halfDepth), V3(bot[i][0], bot[i][1], GANTRY.halfDepth)], 1.6, 5, CK.DARK);
    if (i % 10 === 0) lamps.push({ p: V3(top[i][0], top[i][1] + 8, 0), r: 5, color: i % 20 ? LAMP.AMBER : LAMP.WHITE, i: 2.4, breathe: 0.4, phase: i / N });
  }
  // walkway along the top with a railing
  for (let i = 0; i < N; i++) {
    const [ax, ay] = top[i], [bx, by] = top[i + 1], l = Math.hypot(bx - ax, by - ay);
    B.at((ax + bx) / 2, (ay + by) / 2 + 6, 0, 0, 0, Math.atan2(by - ay, bx - ax));
    B.box(0, 0, 0, l + 0.5, 1.2, 10, CK.DECK);
    B.box(0, 1.2, 5, l + 0.5, 1.2, 0.3, CK.BRONZE);
    B.box(0, 1.2, -5, l + 0.5, 1.2, 0.3, CK.BRONZE);
    B.pop();
  }
  // end frames down to bogies on the crest rails, drive houses on them
  for (const sg of [-1, 1]) {
    const xe = sg * half, ye = S.roofCurve(xe);
    for (const z of [-GANTRY.halfDepth, GANTRY.halfDepth]) {
      B.tube([V3(xe, ye + GANTRY.top, z), V3(sg * 16195, S.wall + GANTRY.bogieTop, z)], 3.5, 8, CK.HULL);
      B.tube([V3(xe, ye + GANTRY.bottom, z), V3(sg * 16195, S.wall + GANTRY.bogieTop, z)], 3, 8, CK.HULL);
    }
    for (const x of RAIL_X) B.box(sg * x, S.wall + 5 + 9.5, 0, 16, 19, GANTRY.halfDepth * 2 + 30, CK.DARK);   // wheel trucks on the rails
    B.box(sg * 16195, S.wall + GANTRY.bogieTop - 6, 0, 210, 12, GANTRY.halfDepth * 2 + 10, CK.BRONZE);
    B.box(sg * 16195, S.wall + GANTRY.bogieTop + 12, 0, 60, 24, 50, CK.GLASS);
    lamps.push({ p: V3(sg * 16195, S.wall + GANTRY.bogieTop + 32, 0), r: 7, color: LAMP.AMBER, i: 3.0, breathe: 0.5 });
  }
  return { geo: B.geometry(), lamps };
}
export const GANTRY = { top: 150, bottom: 96, halfDepth: 40, bogieTop: 30, range: 45000, period: 9000, pods: 8, podY: 64, podHalf: 11 };

function buildTrainCar() {
  const B = new CB();
  const rings = [];
  const sec = sectionEllipse(2.3, 2.2, 14, 3.2);
  for (const [z, s] of [[-25, 0.75], [-23, 1], [23, 1], [25, 0.75]]) rings.push({ z, pts: sec.map(([u, v]) => [u * s, v * s + 3]) });
  B.loft(rings, (i) => (i >= 2 && i <= 5) || (i >= 9 && i <= 12) ? CK.GLASS : CK.HULL, { capStart: CK.DARK, capEnd: CK.DARK });
  B.box(0, 0.6, 0, 3.4, 1.2, 46, CK.DARK);
  B.box(0, 3.3, 0, 4.72, 0.5, 44, CK.LANTERN);
  return B.geometry();
}
function buildTram() {
  const B = new CB();
  B.box(0, 2.1, 0, 2.6, 3.2, 30, CK.GLASS);
  B.box(0, 3.9, 0, 2.7, 0.5, 30.4, CK.HULL);
  B.box(0, 0.35, 0, 2.2, 0.7, 28, CK.DARK);
  B.box(0, 2.4, 15.05, 2.3, 1.4, 0.2, CK.LANTERN);
  B.box(0, 2.4, -15.05, 2.3, 1.4, 0.2, CK.LANTERN);
  return B.geometry();
}
function buildCrawler(sg, G) {
  // rides the sheath's upper outboard face: its +y along that face's normal
  const B = new CB();
  B.push(new THREE.Matrix4().makeRotationZ(-sg * (Math.PI / 2 - G.face)));
  B.box(0, 0, 0, 70, 12, 60, CK.HULL);
  B.box(0, 8, 0, 40, 6, 36, CK.GLASS);
  for (const x of [-40, 40]) for (const z of [-24, 24]) B.box(x, -(G.crawlerLift - 2 + 6) / 2, z, 8, G.crawlerLift - 2 - 6, 8, CK.DARK);   // bogies down to the rail tops
  B.box(0, 13, 0, 30, 2, 26, CK.LANTERN);
  B.pop();
  return B.geometry();
}
function buildAircar() {
  const B = new CB();
  B.box(0, 0, 0, 4.2, 2.2, 11, CK.HULL);
  B.box(0, 1.6, 0.8, 3.4, 1.2, 5.5, CK.GLASS);
  B.box(0, 0.2, -5.6, 3.6, 0.8, 0.3, CK.LANTERN);
  for (const x of [-3.4, 3.4]) for (const z of [-3.6, 3.6]) {
    B.push(new THREE.Matrix4().makeTranslation(x, 0.2, z).multiply(toY));
    lathe(B, [[1.2, -0.5, CK.BRONZE], [1.5, -0.4, CK.BRONZE], [1.5, 0.4, CK.BRONZE], [1.2, 0.5, CK.DARK]], 10, 0, { closedProfile: true });
    B.pop();
  }
  return B.geometry();
}
/** Aircar lanes under the vault: over the boulevards and the spine, where no building stands. */
export function aircarLanes(S) {
  const out = [];
  for (const bx of [-7000, 7000]) for (const [dx, dy, v] of [[-25, 180, 55], [25, 180, -55], [-25, 320, 70], [25, 320, -70]]) out.push({ x: bx + dx, y: S.deck(bx) + dy, v, gap: 900 + Math.abs(v) * 4 });
  for (const [dx, v] of [[-30, 80], [30, -80]]) out.push({ x: dx, y: S.deck(0) + 220, v, gap: 1500 });
  return out;
}
function buildPod() {
  const B = new CB();
  B.box(0, 0, 0, 22, 14, 16, CK.HULL);
  B.box(0, -7.5, 0, 26, 1.5, 20, CK.BRONZE);
  B.box(0, 1, 8.1, 18, 6, 0.4, CK.GLASS);
  B.box(0, -8.4, 0, 24, 0.6, 18, CK.LANTERN);
  B.tube([V3(0, 7, 0), V3(0, 25, 0)], 1.2, 5, CK.DARK);
  return B.geometry();
}

// ------------------------------------------------------------ the module ----
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _x = new THREE.Vector3(), _z = new THREE.Vector3();

export class HaloDistricts {
  /**
   * rings: the Rings module (its Halo basis, def and arch data); space: the space mode (for
   * earthFixed and addBody). Nothing heavy is built until the camera first nears the Halo.
   */
  constructor(space, rings) {
    this.space = space;
    this.def = rings.defs[0];
    this.basis = rings.bases[0];
    this.S = haloSectionM(this.def);
    this.Rm = this.basis.R * 1000;
    this.nTiles = Math.floor((TAU * this.Rm) / TILE_L);
    // the tiles close the ring: the last SEAM_TILES before theta = 0 share the remainder (~1.4 km,
    // an undressed seam when every tile was exactly 4 km), each stretched a few percent along
    // the ring. Hub arches stand on exact 4 km tile centres, and none falls in the seam run.
    this.seamK = this.nTiles - SEAM_TILES;
    this.seamLen = (TAU * this.Rm - this.seamK * TILE_L) / SEAM_TILES;
    this.archProfile = rings.archData.profile;
    // tiles near the ports, the foundry and Nauru stay bare (their stations own the deck)
    // (ports keep 10.5 km: their dome, podium quarter and concourse wings reach 9.8 km along the
    // ring. Meridian's junction keeps the same: its vault opening is 2.5 km across, and its
    // terminal quarter, laid here in the district material, fills the deck round the dome)
    const exclude = [...HALO_PORTS.map((p) => [bodyDir(0, THREE.MathUtils.degToRad(p.lon)), 10.5]), [bodyDir(0, THREE.MathUtils.degToRad(166.9) + 0.009), 14]];
    const { a, b } = this.basis;
    this.tileVariant = new Int8Array(this.nTiles);
    this.tileGround = new Uint8Array(this.nTiles);          // undressed: 1 round a port, 2 the foundry
    const dir = new THREE.Vector3();
    for (let k = 0; k < this.nTiles; k++) {
      const th = this.tileAngle(k);
      dir.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
      const hit = exclude.findIndex(([d, km]) => Math.acos(THREE.MathUtils.clamp(dir.dot(d), -1, 1)) * this.basis.R < km + TILE_L / 2000);
      this.tileVariant[k] = hit >= 0 ? -1 : Math.floor(hash2(k, 11) * VARIANTS.length);
      this.tileGround[k] = hit < 0 ? 0 : hit < HALO_PORTS.length ? 1 : 2;
    }
    // hub tiles carrying an arch (arches sit at hub*(j+0.5), the centre of tile 35j+17)
    this.hubTiles = new Map();
    const perHub = Math.round((this.def.hub * 1000) / TILE_L);
    for (const th of rings.archAngles || []) {
      const k = Math.round((th * this.Rm) / TILE_L - 0.5);
      if (k >= 0 && k < this.seamK && Math.abs(this.tileAngle(k) - th) * this.Rm < 1) this.hubTiles.set(k, true);
    }
    // under each arch the district is the harbour town (where the tile is dressed at all)
    for (const k of this.hubTiles.keys()) if (this.tileVariant[k] >= 0) this.tileVariant[k] = HARBOUR_V;
    // gantries: one per bay between arches whose whole travel stays on dressed tiles
    this.gantryBays = [];
    const nBays = Math.floor((TAU * this.basis.R) / this.def.hub);
    for (let j = 1; j < nBays; j++) {
      const u = j * this.def.hub * 1000, k0 = this.tileAt(Math.max(0, u - GANTRY.range - 2000)), k1 = Math.floor((u + GANTRY.range + 2000) / TILE_L);
      let ok = k1 < this.nTiles;
      for (let k = k0; ok && k <= k1; k++) if (this.tileVariant[k] < 0) ok = false;
      if (ok) this.gantryBays.push({ u, phase: hash2(j, 3) * TAU });
    }
    this.perHub = perHub;
    // Meridian's junction on the ring (arc, m): its terminal quarter rides the district anchor
    const jd = bodyDir(0, MERIDIAN_LON);
    this.junctionU = ((Math.atan2(jd.dot(b), jd.dot(a)) + TAU) % TAU) * this.Rm;
    this.plan = cellPlanTextures(this.tileVariant, this.tileGround);
    this.anchor = new THREE.Group();
    this.anchor.scale.setScalar(0.001);
    this.anchor.visible = false;
    this.anchor.userData.world = new THREE.Vector3();
    space.earthFixed.add(this.anchor);
    this.anchorTile = -1e9;
    this.body = space.addBody('halo-districts', [this.anchor], () => this.anchor.getWorldPosition(_c), (MOVER_RANGE + 20000) / 1000, { solid: true });
    this.mat = createHaloMaterial({ accent: [1.0, 0.76, 0.48], lit: 0.66, deck: { sag: -this.S.deck(0), half: this.S.outer } });
    this.moverMat = createHaloMaterial({ accent: [0.6, 0.88, 1.0], lit: 0.7 });
    const anchorWorld = this.anchor.userData.world;
    this._before = (mat) => (r, s, cam) => {
      updateCraftMaterial(mat, cam, CRAFT_FRAME.sunDir, anchorWorld, CRAFT_FRAME.time);
      mat.uniformsNeedUpdate = true;
    };
    this.variants = [];
    this.crests = [];
    this.slots = [];
    this.built = false;
    this.buildQueue = null;
    this.stats = { buildMs: 0, pieces: 0 };
  }

  tileAngle(k) { return (k < this.seamK ? (k + 0.5) * TILE_L : this.seamK * TILE_L + (k - this.seamK + 0.5) * this.seamLen) / this.Rm; }
  /** Along-ring stretch of tile k (1 except in the seam run). */
  tileStretch(k) { return k < this.seamK ? 1 : this.seamLen / TILE_L; }
  /** Tile holding arc position u (m, 0 <= u < circumference). */
  tileAt(u) { const us = this.seamK * TILE_L; return u < us ? Math.floor(u / TILE_L) : Math.min(this.nTiles - 1, this.seamK + Math.floor((u - us) / this.seamLen)); }

  /** Build everything now (tests), or queue it a piece per frame (first approach). */
  buildAll() { this._queue(); while (this.buildQueue.length) this._step(); }
  _queue() {
    if (this.buildQueue) return;
    const S = this.S;
    const q = [];
    q.push(() => {
      // craft first: the docking bays are sized from the shuttles and tugs that use them
      this.shipClasses = [buildShuttle(110), buildTug(80)].map((c) => { c.geo.computeBoundingBox(); return { geo: c.geo, box: c.geo.boundingBox.clone() }; });
      let len = 0, wid = 0, hei = 0;
      for (const { box } of this.shipClasses) { len = Math.max(len, box.max.z - box.min.z); wid = Math.max(wid, box.max.x - box.min.x); hei = Math.max(hei, box.max.y - box.min.y); }
      this.shipBox = { len, wid, hei };
      this.bay = { d: Math.ceil(len + 90), w: Math.ceil(wid + 130), h: Math.ceil(hei + 70), y: 1500, clear: 22, cradle: Math.ceil(wid * 0.3) };
      // each class rides its cradles 2 m clear, its hull centred in the bay along the wall normal
      const floor = this.bay.y - this.bay.h / 2 + 2;
      for (const c of this.shipClasses) { c.y = floor + this.bay.clear + 2 - c.box.min.y; c.zc = (c.box.min.z + c.box.max.z) / 2; }
    });
    // each variant a slice per frame (tens of milliseconds each), not one long stall
    [...VARIANTS.keys(), HARBOUR_V].forEach((v) => {
      let gen = null;
      const piece = () => {
        gen = gen || buildDistrictTileSteps(v, S, this.bay, 1);
        const st = gen.next();
        if (st.done) this.variants[v] = this._pack(st.value);
        else this.buildQueue.unshift(piece);
      };
      q.push(piece);
    });
    q.push(() => { this.crests[0] = this._pack(buildCrest(S, null)); });
    q.push(() => {
      this.crests[1] = this._pack(buildCrest(S, { profile: this.archProfile, gap: 760, corbelHalf: 550 }));
    });
    q.push(() => {
      const f = buildVaultFrame(S, TILE_L);
      this.vaultFrame = { geo: f.geo, lamps: createLamps(f.lamps, { minPx: 1.0, gain: 0.9 }), lampCount: f.lamps.length };
    });
    q.push(() => this._buildLife());
    q.push(() => this._buildJunction());
    q.push(() => this._buildSlots());
    q.push(() => this._buildFar());
    this.buildQueue = q;
  }
  _step() {
    const t0 = performance.now();
    this.buildQueue.shift()();
    this.stats.buildMs += performance.now() - t0;
    this.stats.pieces++;
    if (!this.buildQueue.length) this.built = true;
  }
  _pack(t) {
    const lamps = createLamps(t.lamps, { minPx: 1.2 });
    // street lamps: only drawn close in, and allowed to shrink below a pixel with the distance
    const flamps = t.flamps ? createLamps(t.flamps, { minPx: 0.8, gain: 0.9 }) : null;
    return { major: t.major, minor: t.minor, fine: t.fine, far: t.far, lamps, flamps, cells: t.cells, walks: t.walks, cranes: t.cranes, lampCount: t.lamps.length, flampCount: t.flamps ? t.flamps.length : 0 };
  }
  _mesh(geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 3;
    m.onBeforeRender = this._before(mat);
    return m;
  }
  _buildFar() {
    this.farGroup = new THREE.Group();
    this.farGroup.scale.setScalar(0.001);
    this.farGroup.visible = false;
    this.farGroup.userData.world = new THREE.Vector3();
    this.space.earthFixed.add(this.farGroup);
    const farWorld = this.farGroup.userData.world;
    this.farMeshes = this.variants.map((v) => {
      const im = new THREE.InstancedMesh(v.far, this.mat, 2 * FAR_TILES);
      im.count = 0; im.frustumCulled = false; im.renderOrder = 3;
      im.onBeforeRender = (r, sc, cam) => { updateCraftMaterial(this.mat, cam, CRAFT_FRAME.sunDir, farWorld, CRAFT_FRAME.time); this.mat.uniformsNeedUpdate = true; };
      this.farGroup.add(im);
      return im;
    });
    this.farBody = this.space.addBody('halo-districts-far', [this.farGroup], () => this.farGroup.getWorldPosition(_c), (FAR_TILES + WINDOW + 1) * TILE_L / 1000, { solid: true });
  }
  /**
   * The junction's terminal quarter: the same ring of towers, court blocks and terraces as the
   * other ports' podium quarters (portQuarter), laid in the tile frame and drawn with the
   * district material (the junction station itself is the elevator's, in the plain craft
   * material, which knows none of the Halo's facade kinds).
   */
  _buildJunction() {
    const B = new HB(), lamps = [];
    B.push(ROT_YM90);                           // portQuarter turns its builder frame into a station's
    portQuarter(B, this.S, lamps, 157);
    B.pop();
    for (const l of lamps) l.p.applyMatrix4(ROT_YM90);
    const m = this._mesh(B.geometry(), this.mat);
    m.matrixAutoUpdate = false;
    m.visible = false;
    m.add(createLamps(lamps, { minPx: 1.2 }));
    this.anchor.add(m);
    this.junctionQuarter = m;
    this.junctionLampCount = lamps.length;
  }
  _buildSlots() {
    const v0 = this.variants[0], c0 = this.crests[0];
    for (let i = 0; i < SLOTS; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const major = this._mesh(v0.major, this.mat), mid = this._mesh(v0.far, this.mat), minor = this._mesh(v0.minor, this.mat), fine = this._mesh(v0.fine, this.mat);
      const cMajor = this._mesh(c0.major, this.mat), cMinor = this._mesh(c0.minor, this.mat);
      const frame = this._mesh(this.vaultFrame.geo, this.mat);
      const lamps = v0.lamps.clone(), cLamps = c0.lamps.clone(), fLamps = v0.flamps.clone(), vLamps = this.vaultFrame.lamps.clone();
      g.add(major, mid, minor, fine, cMajor, cMinor, frame, lamps, cLamps, fLamps, vLamps);
      g.visible = false;
      this.anchor.add(g);
      this.slots.push({ g, major, mid, minor, fine, cMajor, cMinor, frame, lamps, cLamps, fLamps, vLamps, k: -1e9 });
    }
  }
  _buildLife() {
    const S = this.S;
    const gantry = buildGantry(S);
    this.gantryGeo = gantry.geo;
    this.gantries = [0, 1].map(() => {
      const m = this._mesh(gantry.geo, this.moverMat);
      m.matrixAutoUpdate = false;
      m.add(createLamps(gantry.lamps, { minPx: 1.2 }));
      m.visible = false;
      this.anchor.add(m);
      return m;
    });
    const inst = (geo, n) => {
      const im = new THREE.InstancedMesh(geo, this.moverMat, n);
      im.count = 0; im.frustumCulled = false; im.renderOrder = 3;
      im.onBeforeRender = this._before(this.moverMat);
      this.anchor.add(im);
      return im;
    };
    this.pods = inst(buildPod(), GANTRY.pods * 2);
    // harbour boats: ferries and sailing boats on their rounds of the basin (a hub tile or two
    // is ever inside the window; capacity for four)
    this.people = inst(buildPerson(), PEOPLE.max);
    // every crane of every tile within minor range can be drawn (capacity from the built variants)
    const cranesPerTile = Math.max(1, ...this.variants.map((v) => v.cranes.length / 4));
    this.jibs = inst(buildCraneJib(), cranesPerTile * (2 * Math.ceil(MINOR_RANGE_KM / (TILE_L / 1000)) + 3));
    this.drones = inst(buildDrone(), DRONES.perTile * (2 * DRONES.reach + 1));
    this.boats = [0, 1].map((fleet) => inst(buildHarbourBoat(fleet), 4 * HARBOUR.routes.reduce((n, rt) => n + (rt.fleet === fleet ? rt.n : 0), 0)));
    this.trains = inst(buildTrainCar(), 8 * 24);
    this.trams = inst(buildTram(), 320);
    this.ships = this.shipClasses.map((c) => inst(c.geo, SLOTS * 4));
    const G = rotorGeometry(S);
    this.rotorCrawlers = [-1, 1].map((sg) => inst(buildCrawler(sg, G), 64));
    this.aircars = inst(buildAircar(), 1400);
    this.harbourWaterY = Math.max(S.deck(-HARBOUR.R - 250), S.deck(HARBOUR.R + 250), S.deck(0)) + 1.0 + 1.2;   // the basin's surface
    this.lineMeshes = [this.trains, this.trams, this.aircars, ...this.rotorCrawlers];
    // services: [x (m), y above radius (m), speed (m/s), spacing (m), cars, car pitch (m), seed]
    const yT = S.deck(0) + 34 + 1.6 + 0.1;
    this.lines = [
      { im: this.trains, x: -9, y: yT, v: 140, gap: 16000, cars: 8, pitch: 50.5, off: 0 },
      { im: this.trains, x: 9, y: yT, v: -140, gap: 16000, cars: 8, pitch: 50.5, off: 5300 },
      ...[-7000, 7000].flatMap((bx, i) => [
        { im: this.trams, x: bx - 8, y: S.deck(bx) + 1.2, v: 14, gap: 2600, cars: 1, pitch: 0, off: 700 * i },
        { im: this.trams, x: bx + 8, y: S.deck(bx) + 1.2, v: -14, gap: 2600, cars: 1, pitch: 0, off: 1900 + 500 * i },
      ]),
      ...aircarLanes(S).map((l, i) => ({ im: this.aircars, x: l.x, y: l.y, v: l.v, gap: l.gap, cars: 1, pitch: 0, off: 317 * i })),
      ...[-1, 1].map((sg, i) => {
        const r = G.apo + G.hoop + 2 + G.crawlerLift;
        return { im: this.rotorCrawlers[i], x: sg * (S.tubeX + r * Math.cos(G.face)), y: S.tubeY + r * Math.sin(G.face), v: sg * 6, gap: 5200, cars: 1, pitch: 0, off: 900 * i };
      }),
    ];
  }

  /** Instance matrix for a point at arc u (m) and axial x, height y (m), relative to the anchor. */
  _place(out, u, x, y, dirSign, stretch = 1) {
    let d = u / this.Rm - this.anchorAngle;
    d -= Math.round(d / TAU) * TAU;
    const c = Math.cos(d), s = Math.sin(d), R = this.Rm + y, f = dirSign < 0 ? -1 : 1, fz = f * stretch;
    out.set(f, 0, 0, x, 0, c, -fz * s, R * c - this.Rm, 0, s, fz * c, R * s, 0, 0, 0, 1);
    return out;
  }

  update(sim, realTime, dt, space) {
    if (!space || !space.camera) return;
    const { a, b, n } = this.basis;
    const cam = _c.copy(space.camera.position).applyQuaternion(_q.copy(sim.earthQuat).invert());
    const ca = cam.dot(a), cb = cam.dot(b), cn = cam.dot(n);
    const radial = Math.hypot(ca, cb) - this.basis.R;
    const off = Math.hypot(Math.max(Math.abs(cn) - this.def.width / 2, 0), Math.max(radial - 5, -radial, 0));
    // building starts well out on the approach (a few milliseconds of it a frame, at least one
    // piece); a camera that arrives at the band before it is done (a jump straight to a Halo
    // target) finishes it at once rather than showing an empty deck for the next fifty frames
    if (off > BUILD_START_KM && !this.buildQueue) { this.anchor.visible = false; return; }
    if (!this.built) {
      this._queue();
      const t0 = performance.now(), urgent = off < NEAR_RANGE_KM;
      do this._step(); while (this.buildQueue.length && (urgent || performance.now() - t0 < BUILD_BUDGET_MS));
      if (!this.built) { this.anchor.visible = false; return; }
    }
    if (off > FAR_RANGE_KM) { this.anchor.visible = false; this.farGroup.visible = false; return; }
    this.anchor.visible = off < NEAR_RANGE_KM;
    this.farGroup.visible = true;
    let th = Math.atan2(cb, ca); if (th < 0) th += TAU;
    const kc = this.tileAt(th * this.Rm);
    if (kc !== this.anchorTile) this._recentre(kc);
    if (!this.anchor.visible) return;
    // per-slot distance LOD: small detail only close in
    const camL = this.anchor.worldToLocal(_c.copy(space.camera.position));
    (this.camLocal || (this.camLocal = new THREE.Vector3())).copy(camL);
    for (const s of this.slots) {
      if (!s.g.visible) continue;
      const e = s.g.matrix.elements, dx = camL.x, dy = camL.y - e[13], dz = camL.z - e[14];
      const dKm = Math.max(Math.abs(dx) - this.S.outer, 0, Math.hypot(dy, Math.max(Math.abs(dz) - TILE_L / 2, 0))) / 1000;
      const nearMinor = dKm < MINOR_RANGE_KM, nearFine = dKm < FINE_RANGE_KM, nearFrame = dKm < FRAME_RANGE_KM;
      s.minor.visible = nearMinor; s.cMinor.visible = nearMinor;
      s.fine.visible = nearFine; s.fLamps.visible = nearFine;
      s.frame.visible = nearFrame; s.vLamps.visible = nearFrame;
      const nearMajor = dKm < MAJOR_RANGE_KM;
      s.major.visible = nearMajor; s.mid.visible = !nearMajor && dKm < NEAR_RANGE_KM; s.cMajor.visible = dKm < NEAR_RANGE_KM;
    }
    this._lampDaylight(sim, space);
    this._life(realTime);
  }

  /**
   * The districts' lamps are lost in daylight: while the Sun stands over the band round the
   * camera they dim to a third (a tile's hundreds of beacons and crowns read as a pale speckle
   * over sunlit roofs), and come up through dusk to full strength on the night side.
   */
  _lampDaylight(sim, space) {
    if (!this.lampMats) {
      const set = new Set();
      const add = (o) => { if (o && o.material && o.material.uniforms && o.material.uniforms.uGain) set.add(o.material); };
      for (const v of this.variants) { add(v.lamps); add(v.flamps); }
      for (const c of this.crests) add(c.lamps);
      add(this.vaultFrame.lamps);
      for (const m of [this.junctionQuarter, ...this.gantries]) if (m) for (const ch of m.children) add(ch);
      this.lampMats = [...set];
      this.lampGain = this.lampMats.map((m) => m.uniforms.uGain.value);
      this.lampK = 1;
    }
    const cp = space.camera.position, cl = Math.hypot(cp.x, cp.y, cp.z), sd = sim.sunDir;
    const sunUp = cl > 0 ? (cp.x * sd.x + cp.y * sd.y + cp.z * sd.z) / cl : 0;
    const k = 1 - LAMP_DAY_DIM * THREE.MathUtils.smoothstep(sunUp, -0.06, 0.14);
    if (Math.abs(k - this.lampK) < 1e-3) return;
    this.lampK = k;
    for (let i = 0; i < this.lampMats.length; i++) this.lampMats[i].uniforms.uGain.value = this.lampGain[i] * k;
  }

  _recentre(kc) {
    this.anchorTile = kc;
    this.anchorAngle = this.tileAngle(kc);
    const { a, b } = this.basis;
    const th = this.anchorAngle;
    const Y = _c.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
    const Z = _z.copy(a).multiplyScalar(-Math.sin(th)).addScaledVector(b, Math.cos(th));
    const X = _x.crossVectors(Y, Z);
    _m.makeBasis(X, Y, Z);
    this.anchor.quaternion.setFromRotationMatrix(_m);
    this.anchor.position.copy(Y).multiplyScalar(this.basis.R);
    this.anchor.updateMatrix();
    this.anchor.updateMatrixWorld(true);
    this.anchor.getWorldPosition(this.anchor.userData.world);
    this.farGroup.position.copy(this.anchor.position); this.farGroup.quaternion.copy(this.anchor.quaternion);
    this.farGroup.updateMatrix(); this.farGroup.updateMatrixWorld(true);
    this.farGroup.getWorldPosition(this.farGroup.userData.world);
    for (const im of this.farMeshes) im.count = 0;
    for (let d = WINDOW + 1; d <= WINDOW + FAR_TILES; d++) for (const sgn of [-1, 1]) {
      const kk = (((kc + sgn * d) % this.nTiles) + this.nTiles) % this.nTiles, v = this.tileVariant[kk];
      if (v < 0) continue;
      const im = this.farMeshes[v];
      im.setMatrixAt(im.count++, this._place(_m, this.tileAngle(kk) * this.Rm, 0, 0, 1, this.tileStretch(kk)));
    }
    for (const im of this.farMeshes) im.instanceMatrix.needsUpdate = true;
    // the junction's quarter, while it is inside the window
    if (this.junctionQuarter) {
      const C = TAU * this.Rm, jq = this.junctionQuarter;
      let du = this.junctionU - this.anchorAngle * this.Rm; du -= Math.round(du / C) * C;
      jq.visible = Math.abs(du) < MOVER_RANGE;
      if (jq.visible) { this._place(jq.matrix, this.junctionU, 0, 0, 1); jq.matrixWorldNeedsUpdate = true; }
    }
    for (let k = kc - WINDOW; k <= kc + WINDOW; k++) {
      const kk = ((k % this.nTiles) + this.nTiles) % this.nTiles;
      const slot = this.slots[k - kc + WINDOW];
      const v = this.tileVariant[kk];
      slot.k = kk;
      if (v < 0) { slot.g.visible = false; continue; }
      const V = this.variants[v], C = this.crests[this.hubTiles.has(kk) ? 1 : 0];
      slot.major.geometry = V.major; slot.mid.geometry = V.far; slot.minor.geometry = V.minor; slot.fine.geometry = V.fine;
      slot.fLamps.geometry = V.flamps.geometry; slot.fLamps.material = V.flamps.material;
      slot.lamps.geometry = V.lamps.geometry; slot.lamps.material = V.lamps.material;
      slot.cMajor.geometry = C.major; slot.cMinor.geometry = C.minor;
      slot.cLamps.geometry = C.lamps.geometry; slot.cLamps.material = C.lamps.material;
      this._place(slot.g.matrix, this.tileAngle(kk) * this.Rm, 0, 0, 1, this.tileStretch(kk));
      slot.g.matrixWorldNeedsUpdate = true;
      slot.g.visible = true;
    }
  }

  _life(t) {
    const R = this.Rm, u0 = this.anchorAngle * R, C = TAU * R;
    // trains and trams: each service is a lattice of vehicles u = off + v t + i gap
    const lineMeshes = this.lineMeshes;
    for (let i = 0; i < lineMeshes.length; i++) lineMeshes[i].count = 0;
    for (const L of this.lines) {
      const im = L.im, head = L.off + L.v * t;
      const i0 = Math.ceil((u0 - MOVER_RANGE - head) / L.gap), i1 = Math.floor((u0 + MOVER_RANGE - head) / L.gap);
      for (let i = i0; i <= i1; i++) {
        const u = head + i * L.gap;
        if (!this.tileOk(u, C)) continue;
        for (let c = 0; c < L.cars && im.count < im.instanceMatrix.count; c++) {
          im.setMatrixAt(im.count++, this._place(_m, u - Math.sign(L.v) * c * L.pitch, L.x, L.y, L.v));
        }
      }
    }
    for (let i = 0; i < lineMeshes.length; i++) lineMeshes[i].instanceMatrix.needsUpdate = true;
    // gantries and their crawler pods
    let g = 0;
    this.pods.count = 0;
    for (const bay of this.gantryBays) {
      if (g >= this.gantries.length) break;
      const ug = this.gantryU(bay, t);
      let du = ug - u0; du -= Math.round(du / C) * C;
      if (Math.abs(du) > MOVER_RANGE) continue;
      const gm = this.gantries[g++];
      this._place(gm.matrix, ug, 0, 0, 1);
      gm.matrixWorldNeedsUpdate = true;
      gm.visible = true;
      for (let p = 0; p < GANTRY.pods; p++) {
        const x = this.podX(bay, p, t);
        this.pods.setMatrixAt(this.pods.count++, this._place(_m, ug + (p % 2 ? 1 : -1) * GANTRY.halfDepth * 0.5, x, this.S.roofCurve(x) + GANTRY.podY, 1));
      }
    }
    for (; g < this.gantries.length; g++) this.gantries[g].visible = false;
    this.pods.instanceMatrix.needsUpdate = true;
    // shuttles and tugs at the wall bays: berthed, leaving, away, returning
    for (const im of this.ships) im.count = 0;
    const bay = this.bay;
    for (const s of this.slots) {
      if (!s.g.visible) continue;
      const uk = this.tileAngle(s.k) * R;
      for (let q = 0; q < 4; q++) {
        const sg = q & 1 ? 1 : -1, zb = q & 2 ? 1000 : -1000;
        const x = this.shipOffset(s.k, sg, zb, t);
        if (x === null) continue;
        const cls = this.shipClass(s.k, sg, zb);
        const im = this.ships[cls], sc = this.shipClasses[cls];
        if (im.count >= im.instanceMatrix.count) continue;
        // nose to the wall: ship +z = -sg x, +y = up
        let d = (uk + zb) / R - this.anchorAngle; d -= Math.round(d / TAU) * TAU;
        const c = Math.cos(d), sn = Math.sin(d), Ry = R + sc.y, px = sg * (this.S.outer + x + sc.zc);
        _m.set(0, 0, -sg, px, -sg * sn, c, 0, Ry * c - R, sg * c, sn, 0, Ry * sn, 0, 0, 0, 1);
        im.setMatrixAt(im.count++, _m);
      }
    }
    for (const im of this.ships) im.instanceMatrix.needsUpdate = true;
    this._harbourBoats(t);
    this._people(t);
    this._drones(t);
    this._cranes(t);
  }

  /** Tower cranes slewing over the building sites of the tiles within minor range. */
  _cranes(t) {
    const im = this.jibs, cap = im.instanceMatrix.count;
    im.count = 0;
    for (const s of this.slots) {
      if (!s.g.visible || !s.minor.visible) continue;
      const W = this.variants[this.tileVariant[s.k]].cranes, uk = this.tileAngle(s.k) * this.Rm, st = this.tileStretch(s.k);
      for (let i = 0; i < W.length && im.count < cap; i += 4) {
        const ph = W[i + 3];
        // slew back and forth between pick-up and placing, pausing at each end
        const a = ph + 1.4 * Math.sin(0.035 * t + ph * 3.0) + 0.3 * Math.sin(0.11 * t + ph);
        this._place(_m, uk + W[i + 2] * st, W[i], W[i + 1], 1);
        _r.makeRotationY(a);
        _m.multiply(_r);
        im.setMatrixAt(im.count++, _m);
      }
    }
    im.instanceMatrix.needsUpdate = true;
  }

  /** Survey drones sweeping the outside of the glass over the tiles round the camera. */
  _drones(t) {
    const im = this.drones, S = this.S, A = S.hw - 1500;
    im.count = 0;
    for (let d = -DRONES.reach; d <= DRONES.reach; d++) {
      const s = this.slots[WINDOW + d];
      if (!s || !s.g.visible || !s.frame.visible) continue;
      const uk = this.tileAngle(s.k) * this.Rm, st = this.tileStretch(s.k);
      for (let i = 0; i < DRONES.perTile && im.count < im.instanceMatrix.count; i++) {
        const h = hash2(s.k * 8 + i, 29), w = 0.004 + 0.003 * h, ph = h * 40 + i * 1.3;
        const x = A * Math.sin(w * t + ph), vx = A * w * Math.cos(w * t + ph);
        const z = (TILE_L * 0.4) * Math.sin(0.23 * w * t + ph * 1.7 + i), vz = TILE_L * 0.4 * 0.23 * w * Math.cos(0.23 * w * t + ph * 1.7 + i);
        this._place(_m, uk + z * st, x, S.roofCurve(x) + DRONES.lift, 1);
        _r.makeRotationY(Math.atan2(vx, vz));
        _m.multiply(_r);
        im.setMatrixAt(im.count++, _m);
      }
    }
    im.instanceMatrix.needsUpdate = true;
  }

  /**
   * People walking the pavements, plazas, park walks and quays round the camera (its own tile,
   * within PEOPLE.range): each loop carries a walker every ~PEOPLE.spacing metres, alternate ones
   * going the other way, at a strolling pace that differs a little between them.
   */
  _people(t) {
    const im = this.people;
    im.count = 0;
    const s = this.slots[WINDOW];
    if (this.camLocal && s && s.g.visible && s.fine.visible) {
      const W = this.variants[this.tileVariant[s.k]].walks, cx0 = this.camLocal.x, cz0 = this.camLocal.z, R2 = PEOPLE.range * PEOPLE.range;
      const uk = this.tileAngle(s.k) * this.Rm, st = this.tileStretch(s.k), cap = im.instanceMatrix.count;
      for (let i = 0; i < W.length && im.count < cap; i += 6) {
        const type = W[i], cx = W[i + 1], cz = W[i + 2], a = W[i + 3], b = W[i + 4], y = W[i + 5];
        const ex = type ? a : a, ez = type ? a : b;
        const dx = Math.max(Math.abs(cx0 - cx) - ex, 0), dz = Math.max(Math.abs(cz0 * 1 - cz * st) - ez, 0);
        if (dx * dx + dz * dz > R2) continue;
        const per = type ? TAU * a : 4 * (a + b);
        const n = Math.max(1, Math.floor(per / PEOPLE.spacing));
        for (let j = 0; j < n && im.count < cap; j++) {
          const h = hash2(i + j * 7, 13), dir = j % 2 ? -1 : 1, v = PEOPLE.speed * (0.8 + 0.4 * h);
          const sp = ((((j + h) / n) * per + dir * v * t) % per + per) % per;
          let px, pz, hx, hz;
          if (type) { const ang = sp / a; px = cx + a * Math.cos(ang); pz = cz + a * Math.sin(ang); hx = -Math.sin(ang) * dir; hz = Math.cos(ang) * dir; }
          else {
            // round the rectangle: +x along the near side, +z up the right, -x back, -z down the left
            let q = sp;
            if (q < 2 * a) { px = cx - a + q; pz = cz - b; hx = dir; hz = 0; }
            else if ((q -= 2 * a) < 2 * b) { px = cx + a; pz = cz - b + q; hx = 0; hz = dir; }
            else if ((q -= 2 * b) < 2 * a) { px = cx + a - q; pz = cz + b; hx = -dir; hz = 0; }
            else { q -= 2 * a; px = cx - a; pz = cz + b - q; hx = 0; hz = -dir; }
          }
          this._place(_m, uk + pz * st, px + (h - 0.5) * 1.6, y, 1);
          _r.makeRotationY(Math.atan2(hx, hz));
          _m.multiply(_r);
          im.setMatrixAt(im.count++, _m);
        }
      }
    }
    im.instanceMatrix.needsUpdate = true;
  }

  /** Ferries and sailing boats round each harbour basin in the window (tile-local circles). */
  _harbourBoats(t) {
    const [ferries, sails] = this.boats;
    ferries.count = 0; sails.count = 0;
    const R = this.Rm;
    for (const s of this.slots) {
      if (!s.g.visible || this.tileVariant[s.k] !== HARBOUR_V || !s.minor.visible) continue;
      const uk = this.tileAngle(s.k) * R, yw = this.harbourWaterY;
      for (const rt of HARBOUR.routes) {
        const im = rt.fleet ? sails : ferries;
        for (let i = 0; i < rt.n && im.count < im.instanceMatrix.count; i++) {
          const phi = (rt.v * t) / rt.r + (i / rt.n) * TAU + s.k * 0.37;
          const x = rt.r * Math.cos(phi), z = rt.r * Math.sin(phi);
          this._place(_m, uk + z, x, yw, 1);
          _r.makeRotationY(rt.v > 0 ? -phi : Math.PI - phi);
          _m.multiply(_r);
          im.setMatrixAt(im.count++, _m);
        }
      }
    }
    ferries.instanceMatrix.needsUpdate = true; sails.instanceMatrix.needsUpdate = true;
  }

  tileOk(u, C) { const k = this.tileAt(((u % C) + C) % C); return k < this.nTiles && this.tileVariant[k] >= 0; }
  shipClass(k, sg, zb) { return hash2(k * 4 + (sg > 0 ? 2 : 0) + (zb > 0 ? 1 : 0), 5) < 0.7 ? 0 : 1; }
  gantryU(bay, t) { return bay.u + GANTRY.range * Math.sin((TAU * t) / GANTRY.period + bay.phase); }
  podX(bay, p, t) { return (this.S.hw - 600) * Math.sin(t * (0.0011 + 0.00023 * p) + bay.phase * 3 + p * 1.7); }
  /** Ship centre's distance out from the outer wall face (m), or null while it is away. */
  shipOffset(k, sg, zb, t) {
    const P = 720, ph = (((t / P + hash2(k * 4 + (sg > 0 ? 2 : 0) + (zb > 0 ? 1 : 0), 9)) % 1) + 1) % 1;
    const berth = this.bay.d * 0.5;
    if (ph < 0.46) return berth;
    if (ph < 0.6) { const e = (ph - 0.46) / 0.14; return berth + 9000 * e * e; }
    if (ph < 0.84) return null;
    const e = (1 - ph) / 0.16; return berth + 9000 * e * e;
  }
}
