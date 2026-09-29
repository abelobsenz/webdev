import * as THREE from 'three';
import { CB, CK, sectionEllipse } from '../craft/craftGeometry.js';
import { lathe, buildShuttle, buildTug } from '../craft/craftClasses.js';
import { createCraftMaterial, updateCraftMaterial } from '../craft/craftMaterial.js';
import { CRAFT_FRAME } from './craftMesh.js';
import { createLamps, LAMP } from './lamps.js';
import { HALO_PORTS } from './earthData.js';
import { bodyDir } from './sim.js';

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
export const MINOR_RANGE_KM = 30;            // small detail (railings, trees, loggias) within this
export const VARIANTS = ['residential', 'agrarian', 'civic', 'works'];
const MOVER_RANGE = (WINDOW + 0.5) * TILE_L; // m either side of the anchor

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
function latheAt(B, x, y, z, prof, seg = 16) {
  B.push(new THREE.Matrix4().makeTranslation(x, y, z).multiply(toY));
  lathe(B, prof, seg);
  B.pop();
}
/** Box standing on the deck across its footprint, its foot sunk under the lowest deck point. */
function standBox(B, S, x, z, sx, sz, h, k, sink = 16) {
  const lo = Math.min(S.deck(x - sx / 2), S.deck(x + sx / 2)), hi = Math.max(S.deck(x - sx / 2), S.deck(x + sx / 2));
  const y0 = lo - sink, top = hi + h;
  B.box(x, (y0 + top) / 2, z, sx, top - y0, sz, k);
  return top;
}
/** Half-round vault along z on the deck (glasshouses, galleries, station halls). */
function vault(B, x, y, z0, z1, half, h, kind, rib = CK.BRONZE, n = 12, steps = 4) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; pts.push([x + Math.cos(a) * half, y + Math.sin(a) * h]); }
  pts.push([x - half, y - 12], [x + half, y - 12]);
  const rings = [];
  for (let j = 0; j <= steps; j++) rings.push({ z: z0 + ((z1 - z0) * j) / steps, pts });
  B.loft(rings, (i) => (i <= n ? kind : CK.HULL), { capStart: rib, capEnd: rib });
}
function ribArc(B, x, y, z, half, h, r, k = CK.BRONZE, n = 8) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; pts.push(V3(x + Math.cos(a) * (half + r), y + Math.sin(a) * (h + r), z)); }
  B.tube(pts, r, 5, k);
}

// ------------------------------------------------------------ the tile ----
function cliffs(B, M, lamps, S, r) {
  // terraced habitat on the inner face of each wall: 13 decks of 160 m stepping back up the
  // wall in 500 m blocks, each with a lit glazed face, a slab, a garden on the exposed step and
  // a railing on its edge. Lift shafts rise in the light wells between blocks to the crest.
  const levels = 13, H = 160, segL = 500, gap = 30;
  for (const sg of [-1, 1]) {
    const X0 = S.hw;
    for (let j = 0; j < TILE_L / segL; j++) {
      const z0 = -TILE_L / 2 + j * segL + gap / 2, z1 = z0 + segL - gap, zc = (z0 + z1) / 2, zl = z1 - z0;
      const d0 = 520 + (r() - 0.5) * 60, step = 30 + r() * 12;
      for (let i = 0; i < levels; i++) {
        const depth = d0 - i * step, next = d0 - (i + 1) * step;
        const y0 = i === 0 ? S.deck(sg * (X0 - depth)) - 18 : i * H, y1 = (i + 1) * H - 12;
        const xin = sg * (X0 - depth), xw = sg * (X0 + 20);
        B.box((xin + xw) / 2, (y0 + y1) / 2, zc, Math.abs(xw - xin), y1 - y0, zl, CK.GLASS);
        B.box((xin + xw) / 2, y1 + 6, zc, Math.abs(xw - xin) + 6, 12, zl + 4, CK.HULL);
        if (i < levels - 1) {
          const gx0 = sg * (X0 - depth + 4), gx1 = sg * (X0 - next - 4);
          B.box((gx0 + gx1) / 2, y1 + 13.5, zc, Math.abs(gx1 - gx0), 3, zl - 8, CK.GARDEN);
          // railing along the terrace edge (minor detail)
          M.box(sg * (X0 - depth + 1.5), y1 + 12.6, zc, 0.35, 1.3, zl - 4, CK.BRONZE);
        }
        // loggias: framed balconies standing proud of the glazing
        const nl = 3 + Math.floor(r() * 4);
        for (let q = 0; q < nl; q++) {
          const zq = z0 + ((q + 0.5) / nl) * zl, lw = 26 + r() * 30;
          M.box(sg * (X0 - depth - 4), (y0 + y1) / 2 - 20, zq, 8, 3, lw, CK.DECK);
          M.box(sg * (X0 - depth - 7.8), (y0 + y1) / 2 - 18, zq, 0.3, 1.2, lw, CK.BRONZE);
        }
      }
      // sky bridges across the next light well on every third deck (clear of the lift shaft)
      if (j < TILE_L / segL - 1) for (let i = 1; i < levels; i += 3) {
        const depth = d0 - i * step, xb = sg * (X0 - depth * 0.55);
        B.box(xb, i * H + 60, z1 + gap / 2, 30, 8, gap + 6, CK.GLASS);
        M.box(xb, i * H + 55.6, z1 + gap / 2, 32, 0.8, gap + 6, CK.BRONZE);
      }
      // light-well lift shaft and its glass at the crest
      const zs = z1 + gap / 2;
      if (j < TILE_L / segL - 1) {
        // (they stop at the top terrace: the glass meets the wall just above it)
        const shaftTop = levels * H + 20;
        B.tube([V3(sg * (X0 - 26), S.deck(sg * (X0 - 26)) - 10, zs), V3(sg * (X0 - 26), shaftTop, zs)], 11, 10, CK.GLASS);
        for (let yy = 320; yy < shaftTop; yy += 480) M.box(sg * (X0 - 60), yy, zs, 70, 5, gap + 8, CK.DECK);
        lamps.push({ p: V3(sg * (X0 - 26), shaftTop + 6, zs), r: 6, color: LAMP.AMBER, i: 2.2, breathe: 0.2, phase: j / 8 });
      }
      if (j % 2 === 0) lamps.push({ p: V3(sg * (X0 - d0 - 6), H * 0.6, zc), r: 8, color: LAMP.WHITE, i: 1.6 });
    }
    // glazed concourse along the foot of the terraces, ribbed every 100 m
    const xg = sg * (X0 - 660), yg = S.deck(xg);
    vault(B, xg, yg, -TILE_L / 2, TILE_L / 2, 80, 55, CK.GLASS, false, 10, 4);
    for (let z = -TILE_L / 2 + 50; z < TILE_L / 2; z += 100) ribArc(M, xg, yg, z, 80, 55, 1.6, CK.BRONZE, 8);
  }
}

function townCell(B, M, lamps, S, r, x0, x1, z0, z1) {
  const nb = 4, bw = (x1 - x0) / nb, bd = (z1 - z0) / nb;
  const hmax = Math.min(S.roofLow(x0), S.roofLow(x1)) - Math.max(S.deck(x0), S.deck(x1)) - 350;
  for (let i = 0; i < nb; i++) for (let j = 0; j < nb; j++) {
    const cx = x0 + (i + 0.5) * bw, cz = z0 + (j + 0.5) * bd, sx = bw - 30, sz = bd - 30;
    const roll = r();
    if (roll < 0.12) {
      // pocket square: planted, with a kiosk
      standBox(B, S, cx, cz, sx, sz, 1.2, CK.GARDEN, 10);
      M.box(cx, S.deck(cx) + 5, cz, 14, 8, 14, CK.GLASS);
      lamps.push({ p: V3(cx, S.deck(cx) + 12, cz), r: 3, color: LAMP.AMBER, i: 1.8 });
      continue;
    }
    const pod = standBox(B, S, cx, cz, sx, sz, 10 + r() * 16, CK.GLASS);
    B.box(cx, pod + 1.5, cz, sx + 2, 3, sz + 2, CK.HULL);
    if (roll < 0.45) {
      // tower on a podium, a garden roof, and a crown lit at night
      const tw = 36 + r() * 50, td = 36 + r() * 50, th = Math.min(hmax, 70 + r() * r() * 380);
      const tx = cx + (r() - 0.5) * (sx - tw) * 0.6, tz = cz + (r() - 0.5) * (sz - td) * 0.6;
      B.box(tx, pod + th / 2, tz, tw, th, td, CK.GLASS);
      B.box(tx, pod + th + 3, tz, tw + 2, 6, td + 2, CK.HULL);
      if (r() < 0.5) B.box(tx, pod + th - 10, tz, tw + 1.2, 6, td + 1.2, CK.LANTERN);
      M.box(tx, pod + th + 7, tz, tw - 8, 2, td - 8, CK.GARDEN);
      M.box(tx + tw / 2 - 5, pod + th + 12, tz + td / 2 - 5, 3, 12, 3, CK.DARK);
      if (th > 200) lamps.push({ p: V3(tx, pod + th + 22, tz), r: 4, color: LAMP.RED, i: 2.6, breathe: 0.4, phase: r() });
    } else {
      // mid-rise court: two to four slabs round a garden
      const n = 2 + Math.floor(r() * 3);
      for (let q = 0; q < n; q++) {
        const along = q % 2 === 0, h = 24 + r() * 60;
        const w = along ? sx * (0.3 + r() * 0.2) : 22 + r() * 10, d = along ? 22 + r() * 10 : sz * (0.3 + r() * 0.2);
        const bx = cx + (along ? (r() - 0.5) * (sx - w) : (q < 2 ? -1 : 1) * (sx - w) / 2);
        const bz = cz + (along ? (q < 2 ? -1 : 1) * (sz - d) / 2 : (r() - 0.5) * (sz - d));
        B.box(bx, pod + h / 2, bz, w, h, d, CK.GLASS);
        B.box(bx, pod + h + 1.5, bz, w + 1, 3, d + 1, CK.ROOF);
      }
      M.box(cx, pod + 3.5, cz, sx * 0.4, 1, sz * 0.4, CK.GARDEN);
    }
    if ((i + j) % 2 === 0) lamps.push({ p: V3(x0 + i * bw + 8, S.deck(x0 + i * bw) + 9, z0 + j * bd + 8), r: 2.5, color: LAMP.AMBER, i: 1.5 });
  }
}

function parkCell(B, M, lamps, S, r, x0, x1, z0, z1, lakeFrac) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
  standBox(B, S, cx, cz, sx, sz, 1.5, CK.GARDEN, 12);
  if (lakeFrac > 0) {
    const lx = cx + (r() - 0.5) * sx * 0.2, lz = cz + (r() - 0.5) * sz * 0.2, lw = sx * lakeFrac, ld = sz * lakeFrac * (0.7 + r() * 0.3);
    standBox(B, S, lx, lz, lw, ld, 2.0, CK.DARK, 4);
    B.box(lx, Math.max(S.deck(lx - lw / 2), S.deck(lx + lw / 2)) + 2.6, lz - ld / 2 - 5, lw + 20, 1.2, 10, CK.DECK);
    // a pier and boathouse
    M.box(lx + lw * 0.25, S.deck(lx) + 3.5, lz, 8, 1.2, ld * 0.35, CK.DECK);
    M.box(lx + lw * 0.25, S.deck(lx) + 8, lz + ld * 0.17, 20, 9, 14, CK.GLASS);
    lamps.push({ p: V3(lx + lw * 0.25, S.deck(lx) + 16, lz + ld * 0.17), r: 3, color: LAMP.AMBER, i: 1.8 });
  }
  // a pavilion under a small conservatory dome
  const px = cx + (r() - 0.5) * sx * 0.6, pz = cz + (r() - 0.5) * sz * 0.6, py = S.deck(px);
  latheAt(B, px, py - 6, pz, [[0.1, 0, CK.DECK], [46, 0, CK.DECK], [46, 8, CK.BRONZE], [44, 14, CK.CONSERVATORY], [34, 34, CK.CONSERVATORY], [18, 44, CK.CONSERVATORY], [4, 48, CK.BRONZE], [0.1, 52, CK.BRONZE]], 20);
  lamps.push({ p: V3(px, py + 50, pz), r: 3.5, color: LAMP.WHITE, i: 1.6, breathe: 0.2 });
  // woods: canopies (minor detail)
  const clumps = 5 + Math.floor(r() * 5);
  for (let c = 0; c < clumps; c++) {
    const qx = x0 + 60 + r() * (sx - 120), qz = z0 + 60 + r() * (sz - 120), n = 6 + Math.floor(r() * 10);
    for (let t = 0; t < n; t++) {
      const tx = qx + (r() - 0.5) * 90, tz = qz + (r() - 0.5) * 90, s = 10 + r() * 12;
      M.box(tx, S.deck(tx) + 1.5 + s * 0.9, tz, s, s * 1.3, s, CK.GARDEN);
    }
  }
  // paths
  M.box(cx, S.deck(cx) + 1.8, cz, 8, 0.6, sz - 20, CK.DECK);
  M.box(cx, S.deck(cx) + 1.8, cz, sx - 20, 0.6, 8, CK.DECK);
}

function farmCell(B, M, lamps, S, r, x0, x1, z0, z1) {
  // glasshouse ranges along the ring, fields between, a packing hall at one end
  const n = 6, pitch = (x1 - x0) / n, half = pitch * 0.34, len0 = z0 + 70, len1 = z1 - 20;
  standBox(B, S, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 1.0, CK.GARDEN, 10);
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * pitch, y = Math.max(S.deck(x - half), S.deck(x + half)) + 1;
    const h = 30 + r() * 16;
    vault(B, x, y, len0, len1, half, h, CK.CONSERVATORY, CK.BRONZE, 10, 3);
    for (let z = len0 + 75; z < len1; z += 150) ribArc(M, x, y, z, half, h, 1.1, CK.BRONZE, 6);
  }
  standBox(B, S, (x0 + x1) / 2, z0 + 34, (x1 - x0) - 40, 48, 22, CK.HULL);
  B.box((x0 + x1) / 2, S.deck((x0 + x1) / 2) + 20, z0 + 10, (x1 - x0) - 80, 6, 2, CK.LANTERN);
  lamps.push({ p: V3((x0 + x1) / 2, S.deck((x0 + x1) / 2) + 30, z0 + 10), r: 4, color: LAMP.WHITE, i: 1.8 });
}

function civicCell(B, M, lamps, S, r, x0, x1, z0, z1) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
  standBox(B, S, cx, cz, sx, sz, 2, CK.DECK, 12);
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
  lamps.push({ p: V3(cx, y + top + 156, cz), r: 6, color: LAMP.RED, i: 3.0, breathe: 0.5 });
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; lamps.push({ p: V3(cx + Math.cos(a) * 60, y + top + 34, cz + Math.sin(a) * 60), r: 3.5, color: LAMP.WHITE, i: 2.2 }); }
  // four low halls round the plaza, colonnaded (columns are minor detail)
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4, hx = cx + Math.cos(a) * sx * 0.3, hz = cz + Math.sin(a) * sz * 0.3;
    const hh = 26 + r() * 20;
    B.box(hx, y + hh / 2, hz, 150, hh, 110, CK.GLASS);
    B.box(hx, y + hh + 2, hz, 160, 4, 120, CK.BRONZE);
    for (let c = -3; c <= 3; c++) M.box(hx + c * 22, y + hh / 2, hz + 60, 3, hh, 3, CK.BRONZE);
  }
  // fountains ring (lamps) and trees
  for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; M.box(cx + Math.cos(a) * 190, y + 9, cz + Math.sin(a) * 190, 12, 16, 12, CK.GARDEN); }
}

function worksCell(B, M, lamps, S, r, x0, x1, z0, z1) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
  standBox(B, S, cx, cz, sx, sz, 1.2, CK.DECK, 10);
  // fabrication halls with photovoltaic sawtooth roofs (the vault's own light)
  const halls = 2 + Math.floor(r() * 2);
  for (let h = 0; h < halls; h++) {
    const hx = x0 + ((h + 0.5) / halls) * sx, hw = sx / halls - 70, hl = sz * 0.55, hz = z0 + 40 + hl / 2, hh = 30 + r() * 18;
    const top = standBox(B, S, hx, hz, hw, hl, hh, CK.HULL);
    for (let t = 0; t < 8; t++) {
      const tz = hz - hl / 2 + ((t + 0.5) / 8) * hl;
      B.at(hx, top + 8, tz, -0.5, 0, 0);
      B.box(0, 0, 0, hw - 6, 1.2, hl / 8 / Math.cos(0.5) - 2, CK.PANEL);
      B.pop();
      M.box(hx, top + 8, tz + hl / 16 - 1, hw - 6, 16, 1.2, CK.GLASS);
    }
    B.box(hx - hw / 2 - 0.6, top - hh * 0.5, hz, 1.2, hh * 0.4, hl * 0.9, CK.LANTERN);
    lamps.push({ p: V3(hx, top + 20, hz - hl / 2 - 4), r: 3.5, color: LAMP.AMBER, i: 2.0 });
  }
  // reclamation tanks and the pipe rack between them
  const tz0 = z0 + sz * 0.72;
  const tanks = [];
  for (let t = 0; t < 5; t++) {
    const tx = x0 + 90 + t * ((sx - 180) / 4), tr = 26 + r() * 16, th = 40 + r() * 30, ty = S.deck(tx);
    latheAt(B, tx, ty - 8, tz0, [[0.1, 0, CK.HULL], [tr, 0, CK.HULL], [tr, th, CK.BRONZE], [tr * 0.7, th + tr * 0.35, CK.HULL], [0.1, th + tr * 0.45, CK.HULL]], 18);
    tanks.push(V3(tx, ty + th * 0.6, tz0));
  }
  for (let t = 0; t < tanks.length - 1; t++) {
    M.tube([tanks[t].clone().add(V3(0, 0, 40)), tanks[t + 1].clone().add(V3(0, 0, 40))], 3, 6, CK.CONDUIT);
    M.tube([tanks[t].clone().add(V3(0, 6, 46)), tanks[t + 1].clone().add(V3(0, 6, 46))], 2, 6, CK.BRONZE);
  }
  for (const p of tanks) lamps.push({ p: p.clone().add(V3(0, 50, 0)), r: 3, color: LAMP.AMBER, i: 1.6, breathe: 0.3 });
}

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
  for (let i = 0; i < TILE_L / 100; i++) lamps.push({ p: V3(i % 2 ? 18 : -18, yT + 6, -TILE_L / 2 + 50 + i * 100), r: 1.6, color: LAMP.WHITE, i: 1.2 });
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
    for (let z = -TILE_L / 2 + 25; z < TILE_L / 2; z += 50) M.box(bx + (z % 100 ? 22 : -22), yb + 7, z, 7, 10, 7, CK.GARDEN);
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
export function buildDistrictTile(variant, S, bay, seed = 1) {
  const B = new CB(), M = new CB(), lamps = [];
  const r = mulberry(seed * 7919 + variant * 104729 + 17);
  cliffs(B, M, lamps, S, r);
  spine(B, M, lamps, S, true);
  outerWall(B, M, lamps, S, bay);
  rotors(B, M, lamps, S);
  const weights = [
    { town: 0.56, park: 0.18, farm: 0.1, civic: 0.08, lake: 0.08, works: 0 },
    { town: 0.14, park: 0.2, farm: 0.52, civic: 0.02, lake: 0.08, works: 0.04 },
    { town: 0.42, park: 0.22, farm: 0.04, civic: 0.2, lake: 0.12, works: 0 },
    { town: 0.3, park: 0.12, farm: 0.18, civic: 0.04, lake: 0.04, works: 0.32 },
  ][variant];
  const kinds = Object.keys(weights);
  const cells = { town: 0, park: 0, farm: 0, civic: 0, lake: 0, works: 0 };
  for (let cx = -15000; cx < 15000; cx += 1000) for (let cz = -TILE_L / 2; cz < TILE_L / 2; cz += 1000) {
    const edge = (x) => (x === 0 || Math.abs(x) === 7000 ? 90 : 30);
    const x0 = cx + edge(cx), x1 = cx + 1000 - edge(cx + 1000);
    const z0 = cz + 30, z1 = cz + 1000 - 30;
    let u = r(), kind = kinds[kinds.length - 1];
    for (const k of kinds) { if (u < weights[k]) { kind = k; break; } u -= weights[k]; }
    // civic towers only where the vault is high (away from the walls)
    if (kind === 'civic' && Math.abs(cx + 500) > 11000) kind = 'town';
    cells[kind]++;
    if (kind === 'town') townCell(B, M, lamps, S, r, x0, x1, z0, z1);
    else if (kind === 'park') parkCell(B, M, lamps, S, r, x0, x1, z0, z1, r() < 0.4 ? 0.35 : 0);
    else if (kind === 'lake') parkCell(B, M, lamps, S, r, x0, x1, z0, z1, 0.62);
    else if (kind === 'farm') farmCell(B, M, lamps, S, r, x0, x1, z0, z1);
    else if (kind === 'civic') civicCell(B, M, lamps, S, r, x0, x1, z0, z1);
    else worksCell(B, M, lamps, S, r, x0, x1, z0, z1);
  }
  return { major: B.geometry(), minor: M.geometry(), lamps, cells };
}

/** Crest furniture for a tile: plain, or dressed for an arch foot at the tile's centre. */
export function buildCrest(S, hubArch) {
  const B = new CB(), M = new CB(), lamps = [];
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
const _m = new THREE.Matrix4(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();

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
    this.archProfile = rings.archData.profile;
    // tiles near the ports, the foundry and Nauru stay bare (their stations own the deck)
    const exclude = [...HALO_PORTS.map((p) => [bodyDir(0, THREE.MathUtils.degToRad(p.lon)), 18]), [bodyDir(0, THREE.MathUtils.degToRad(166.9) + 0.009), 14]];
    const { a, b } = this.basis;
    this.tileVariant = new Int8Array(this.nTiles);
    const dir = new THREE.Vector3();
    for (let k = 0; k < this.nTiles; k++) {
      const th = this.tileAngle(k);
      dir.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
      const bad = exclude.some(([d, km]) => Math.acos(THREE.MathUtils.clamp(dir.dot(d), -1, 1)) * this.basis.R < km + TILE_L / 2000);
      this.tileVariant[k] = bad ? -1 : Math.floor(hash2(k, 11) * VARIANTS.length);
    }
    // hub tiles carrying an arch (arches sit at hub*(j+0.5), the centre of tile 35j+17)
    this.hubTiles = new Map();
    const perHub = Math.round((this.def.hub * 1000) / TILE_L);
    for (const th of rings.archAngles || []) {
      const k = Math.round((th * this.Rm) / TILE_L - 0.5);
      if (k >= 0 && k < this.nTiles && Math.abs(this.tileAngle(k) - th) * this.Rm < 1) this.hubTiles.set(k, true);
    }
    // gantries: one per bay between arches whose whole travel stays on dressed tiles
    this.gantryBays = [];
    const nBays = Math.floor((TAU * this.basis.R) / this.def.hub);
    for (let j = 1; j < nBays; j++) {
      const u = j * this.def.hub * 1000, k0 = Math.floor((u - GANTRY.range - 2000) / TILE_L), k1 = Math.floor((u + GANTRY.range + 2000) / TILE_L);
      let ok = k1 < this.nTiles;
      for (let k = k0; ok && k <= k1; k++) if (this.tileVariant[k] < 0) ok = false;
      if (ok) this.gantryBays.push({ u, phase: hash2(j, 3) * TAU });
    }
    this.perHub = perHub;
    this.anchor = new THREE.Group();
    this.anchor.scale.setScalar(0.001);
    this.anchor.visible = false;
    this.anchor.userData.world = new THREE.Vector3();
    space.earthFixed.add(this.anchor);
    this.anchorTile = -1e9;
    this.body = space.addBody('halo-districts', [this.anchor], () => this.anchor.getWorldPosition(_c), (MOVER_RANGE + 20000) / 1000, { solid: true });
    this.mat = createCraftMaterial({ accent: [1.0, 0.76, 0.48], lit: 0.66 });
    this.moverMat = createCraftMaterial({ accent: [0.6, 0.88, 1.0], lit: 0.7 });
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

  tileAngle(k) { return ((k + 0.5) * TILE_L) / this.Rm; }

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
    VARIANTS.forEach((_, v) => q.push(() => { this.variants[v] = this._pack(buildDistrictTile(v, S, this.bay, 1)); }));
    q.push(() => { this.crests[0] = this._pack(buildCrest(S, null)); });
    q.push(() => {
      this.crests[1] = this._pack(buildCrest(S, { profile: this.archProfile, gap: 760, corbelHalf: 550 }));
    });
    q.push(() => this._buildLife());
    q.push(() => this._buildSlots());
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
    return { major: t.major, minor: t.minor, lamps, cells: t.cells, lampCount: t.lamps.length };
  }
  _mesh(geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 3;
    m.onBeforeRender = this._before(mat);
    return m;
  }
  _buildSlots() {
    const v0 = this.variants[0], c0 = this.crests[0];
    for (let i = 0; i < SLOTS; i++) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const major = this._mesh(v0.major, this.mat), minor = this._mesh(v0.minor, this.mat);
      const cMajor = this._mesh(c0.major, this.mat), cMinor = this._mesh(c0.minor, this.mat);
      const lamps = v0.lamps.clone(), cLamps = c0.lamps.clone();
      g.add(major, minor, cMajor, cMinor, lamps, cLamps);
      g.visible = false;
      this.anchor.add(g);
      this.slots.push({ g, major, minor, cMajor, cMinor, lamps, cLamps, k: -1e9 });
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
    this.trains = inst(buildTrainCar(), 8 * 24);
    this.trams = inst(buildTram(), 320);
    this.ships = this.shipClasses.map((c) => inst(c.geo, SLOTS * 4));
    const G = rotorGeometry(S);
    this.rotorCrawlers = [-1, 1].map((sg) => inst(buildCrawler(sg, G), 64));
    this.aircars = inst(buildAircar(), 1400);
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
  _place(out, u, x, y, dirSign) {
    let d = u / this.Rm - this.anchorAngle;
    d -= Math.round(d / TAU) * TAU;
    const c = Math.cos(d), s = Math.sin(d), R = this.Rm + y, f = dirSign < 0 ? -1 : 1;
    out.set(f, 0, 0, x, 0, c, -f * s, R * c - this.Rm, 0, s, f * c, R * s, 0, 0, 0, 1);
    return out;
  }

  update(sim, realTime, dt, space) {
    if (!space || !space.camera) return;
    const { a, b, n } = this.basis;
    const cam = _c.copy(space.camera.position).applyQuaternion(_q.copy(sim.earthQuat).invert());
    const ca = cam.dot(a), cb = cam.dot(b), cn = cam.dot(n);
    const radial = Math.hypot(ca, cb) - this.basis.R;
    const off = Math.hypot(Math.max(Math.abs(cn) - this.def.width / 2, 0), Math.max(radial - 5, -radial, 0));
    if (off > 600 && !this.buildQueue) { this.anchor.visible = false; return; }
    if (!this.built) {
      this._queue();
      this._step();                               // one piece per frame
      this.anchor.visible = false;
      return;
    }
    if (off > NEAR_RANGE_KM) { this.anchor.visible = false; return; }
    this.anchor.visible = true;
    let th = Math.atan2(cb, ca); if (th < 0) th += TAU;
    const kc = Math.min(this.nTiles - 1, Math.floor((th * this.Rm) / TILE_L));
    if (kc !== this.anchorTile) this._recentre(kc);
    // per-slot distance LOD: small detail only close in
    const camL = this.anchor.worldToLocal(_c.copy(space.camera.position));
    for (const s of this.slots) {
      if (!s.g.visible) continue;
      const e = s.g.matrix.elements, dx = camL.x, dy = camL.y - e[13], dz = camL.z - e[14];
      const dKm = Math.max(Math.abs(dx) - this.S.outer, 0, Math.hypot(dy, Math.max(Math.abs(dz) - TILE_L / 2, 0))) / 1000;
      const nearMinor = dKm < MINOR_RANGE_KM;
      s.minor.visible = nearMinor; s.cMinor.visible = nearMinor;
      s.major.visible = dKm < NEAR_RANGE_KM; s.cMajor.visible = s.major.visible;
    }
    this._life(realTime);
  }

  _recentre(kc) {
    this.anchorTile = kc;
    this.anchorAngle = this.tileAngle(kc);
    const { a, b } = this.basis;
    const th = this.anchorAngle;
    const Y = _c.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
    const Z = new THREE.Vector3().copy(a).multiplyScalar(-Math.sin(th)).addScaledVector(b, Math.cos(th));
    const X = new THREE.Vector3().crossVectors(Y, Z);
    _m.makeBasis(X, Y, Z);
    this.anchor.quaternion.setFromRotationMatrix(_m);
    this.anchor.position.copy(Y).multiplyScalar(this.basis.R);
    this.anchor.updateMatrix();
    this.anchor.updateMatrixWorld(true);
    this.anchor.getWorldPosition(this.anchor.userData.world);
    for (let k = kc - WINDOW; k <= kc + WINDOW; k++) {
      const kk = ((k % this.nTiles) + this.nTiles) % this.nTiles;
      const slot = this.slots[k - kc + WINDOW];
      const v = this.tileVariant[kk];
      slot.k = kk;
      if (v < 0) { slot.g.visible = false; continue; }
      const V = this.variants[v], C = this.crests[this.hubTiles.has(kk) ? 1 : 0];
      slot.major.geometry = V.major; slot.minor.geometry = V.minor;
      slot.lamps.geometry = V.lamps.geometry; slot.lamps.material = V.lamps.material;
      slot.cMajor.geometry = C.major; slot.cMinor.geometry = C.minor;
      slot.cLamps.geometry = C.lamps.geometry; slot.cLamps.material = C.lamps.material;
      this._place(slot.g.matrix, this.tileAngle(kk) * this.Rm, 0, 0, 1);
      slot.g.matrixWorldNeedsUpdate = true;
      slot.g.visible = true;
    }
  }

  _life(t) {
    const R = this.Rm, u0 = this.anchorAngle * R, C = TAU * R;
    const tileOk = (u) => { const k = Math.floor((((u % C) + C) % C) / TILE_L); return k < this.nTiles && this.tileVariant[k] >= 0; };
    // trains and trams: each service is a lattice of vehicles u = off + v t + i gap
    for (const im of [this.trains, this.trams, this.aircars, ...this.rotorCrawlers]) im.count = 0;
    for (const L of this.lines) {
      const im = L.im, head = L.off + L.v * t;
      const i0 = Math.ceil((u0 - MOVER_RANGE - head) / L.gap), i1 = Math.floor((u0 + MOVER_RANGE - head) / L.gap);
      for (let i = i0; i <= i1; i++) {
        const u = head + i * L.gap;
        if (!tileOk(u)) continue;
        for (let c = 0; c < L.cars && im.count < im.instanceMatrix.count; c++) {
          im.setMatrixAt(im.count++, this._place(_m, u - Math.sign(L.v) * c * L.pitch, L.x, L.y, L.v));
        }
      }
    }
    for (const im of [this.trains, this.trams, this.aircars, ...this.rotorCrawlers]) im.instanceMatrix.needsUpdate = true;
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
      for (const sg of [-1, 1]) for (const zb of [-1000, 1000]) {
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
  }

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
