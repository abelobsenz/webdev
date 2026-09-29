import * as THREE from 'three';
import { CB } from '../craft/craftGeometry.js';
import { LK, lunarInstanced } from './lunarMaterial.js';
import { LAMP } from './lamps.js';
import { kit, seat, mulberry, LAMPPOST_LAMP } from './lunarKit.js';

// A lived-in quarter for every outpost (lunarOutposts.js): the town the works serve. A main
// street of dressed-stone terraces, each block shielded by a stepped berm of sintered
// regolith on its roof (or a roof garden, or a glazed winter garden), shopfronts glazed at
// street level under lit signs and awnings, balconies with railings on the storeys above,
// doors with their lamps, side lanes between the blocks; a plaza in the middle with a glazed
// atrium dome, a pool, benches, planters and trees; a tram running the street on its rails; a
// lattice mast with its beacons and dish at the head of the street; long greenhouse vaults
// behind, lit at night. People walk the pavements (see QuarterLife).
//
// Metres, in the outpost's site frame; built into the outpost's own builder when one is given
// (so it merges into the outpost's single mesh), or standalone for the verifiers.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _t = new THREE.Vector3();
const X90 = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const Z90 = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
const CLOTHES = [[0.82, 0.3, 0.2], [0.2, 0.36, 0.6], [0.9, 0.84, 0.72], [0.3, 0.5, 0.34], [0.86, 0.62, 0.16], [0.55, 0.3, 0.55], [0.15, 0.16, 0.2]];
const AWNING = [[0.75, 0.22, 0.16], [0.18, 0.42, 0.44], [0.86, 0.66, 0.2], [0.24, 0.3, 0.55]];

export const SETTLEMENT_PARTS = ['lamppost', 'kiosk', 'tree', 'bench', 'planter', 'cart'];

/**
 * Lay out the quarter of the outpost with this seed (weight 0.3..0.6). plan: the outpost's
 * claimed circles (the quarter finds room clear of them, and claims its own). B, lamps, put:
 * the outpost's builder, lamp list and instance sink; omitted, the quarter keeps its own.
 * Returns { geo?, lamps, inst, claim, street: { a, b } (walkway ends, site metres),
 * tram: { a, b }, walkers: [{ a, b, off, v, ph }] }.
 */
export function buildSettlementQuarter(seed, weight = 0.5, plan = [], B = null, lamps = null, put = null, roads = []) {
  const rnd = mulberry(seed * 4099 + 71);
  const own = !B;
  B ||= new CB();
  lamps ||= [];
  const inst = {};
  put ||= (part, m, tint) => (inst[part] ||= []).push({ m: m.clone(), tint });
  // --- where: a free circle on a ring round the outpost's core ---
  const L = 150 + 170 * weight;                    // half-length of the main street
  const R = L + 60;
  const free = (x, z, r) => plan.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r + 8) && roads.every((pts) => pts.every((p) => Math.hypot(p.x - x, p.z - z) > r + 45));
  let cx = 0, cz = 0, found = false;
  for (let k = 0; k < 400 && !found; k++) {
    const a = rnd() * TAU, d = 220 + R + k * 4;
    cx = Math.cos(a) * d; cz = Math.sin(a) * d;
    found = free(cx, cz, R);
  }
  const claim = { kind: 'quarter', x: cx, z: cz, r: R };
  plan.push(claim);
  // the street runs tangentially (across the line to the core), so its head faces the core
  const yaw = Math.atan2(cx, cz) + Math.PI / 2;
  B.push(seat(_m, cx, cz, yaw, 0));
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const toSite = (lx, lz, out) => out.set(cx + lx * c + lz * s, 0, cz - lx * s + lz * c);
  const lampAt = (lx, y, lz, color, i = 1, r = 0.8, extra = {}) => { toSite(lx, lz, _p); lamps.push({ p: V(_p.x, y + surf(_p.x, _p.z), _p.z), r, color, i, ...extra }); };
  const surf = (x, z) => { seat(_m2, x, z); return _m2.elements[13]; };
  const putLocal = (part, lx, lz, lyaw, h = 0, tint) => { toSite(lx, lz, _p); put(part, seat(_m2, _p.x, _p.z, yaw + lyaw, h), tint); };

  // --- the ground: the street, pavements, kerbs, rails, lanes ---
  const W = 9, PAV = 5;                            // carriageway half-width, pavement width
  B.box(0, 0.12, 0, 2 * W, 0.5, 2 * L, LK.GROUND);
  for (const sd of [-1, 1]) {
    B.box(sd * (W + PAV / 2), 0.3, 0, PAV, 0.6, 2 * L, LK.PAVE);
    B.box(sd * (W + 0.15), 0.34, 0, 0.3, 0.7, 2 * L, LK.WALL);
    B.box(sd * 0.75, 0.42, 0, 0.14, 0.12, 2 * L - 10, LK.BRONZE);       // the tram's rails
  }
  B.box(0, 0.38, 0, 0.8, 0.06, 2 * L - 10, LK.HAZARD);
  // --- blocks: terraces both sides, lanes between them ---
  const blocks = [];
  for (const sd of [-1, 1]) {
    let z = -L + 6;
    while (z < L - 20) {
      const len = 22 + rnd() * 26;
      if (z + len > -36 && z < 36) { z = 36; continue; }                 // the plaza
      if (z + len > L - 4) break;
      blocks.push({ sd, z0: z, z1: z + len });
      z += len + 7 + (rnd() < 0.35 ? 6 : 0);                           // a lane between
    }
  }
  for (const b of blocks) {
    const floors = 2 + Math.floor(rnd() * (2 + weight * 6));
    const H = floors * 3.6 + 1.2, D = 18 + rnd() * 12, len = b.z1 - b.z0, zc = (b.z0 + b.z1) / 2;
    const x0 = b.sd * (W + PAV), xc = x0 + b.sd * D / 2;
    // the building: dressed stone with its windows, a plinth, the ground-floor shopfront
    B.box(xc, H / 2, zc, D, H, len, LK.STONE);
    B.box(x0 + b.sd * 0.25, 2.1, zc, 0.5, 3.4, len - 3, LK.GLASS);
    B.box(x0 + b.sd * 0.3, 4.1, zc, 0.6, 0.7, len - 2, LK.SIGN);
    // awnings over the shopfronts (tinted cloth), on bronze brackets
    const aw = AWNING[Math.floor(rnd() * AWNING.length)];
    B.push(new THREE.Matrix4().makeTranslation(x0 - b.sd * 1.2, 3.3, zc).multiply(new THREE.Matrix4().makeRotationZ(-b.sd * 0.28)));
    B.box(0, 0, 0, 2.6, 0.08, len - 4, LK.BRONZE);
    B.pop();
    lampAt(x0 - b.sd * 2.2, 3.1, zc, aw, 0.5, 1.4);
    // balconies and railings on the upper storeys, one every other bay
    for (let f = 1; f < floors; f++) {
      const y = f * 3.6 + 0.3;
      B.box(x0 - b.sd * 0.7, y, zc, 1.4, 0.18, len - 4, LK.DECK);
      B.box(x0 - b.sd * 1.35, y + 0.55, zc, 0.06, 0.06, len - 4, LK.BRONZE);
      for (let k = 0; k * 1.2 < len - 4; k++) B.box(x0 - b.sd * 1.35, y + 0.28, b.z0 + 2 + k * 1.2, 0.04, 0.5, 0.04, LK.BRONZE);
    }
    // the doors on the street, a lamp over each
    for (let k = 0; k < Math.max(1, Math.floor(len / 12)); k++) {
      const dz = b.z0 + 5 + k * 12;
      B.box(x0 + b.sd * 0.02, 1.25, dz, 0.3, 2.5, 1.6, LK.DARK);
      lampAt(x0 - b.sd * 0.4, 2.8, dz, LAMP.WHITE, 0.45, 0.35);
    }
    // the roof: a stepped regolith berm (shielding), a roof garden, or a glazed winter garden
    const roof = rnd();
    if (roof < 0.5) {
      for (let k = 0; k < 3; k++) B.box(xc, H + 0.8 + k * 1.6, zc, D - 2 - k * 4, 1.6, len - 1 - k * 4, LK.REGOLITH);
    } else if (roof < 0.8) {
      B.box(xc, H + 0.15, zc, D - 1, 0.3, len - 1, LK.ROOFG);
      B.box(xc, H + 0.7, zc, D - 0.5, 0.8, 0.4, LK.WALL);
    } else {
      B.push(new THREE.Matrix4().makeTranslation(xc, H, b.z0 + 1));
      B.lathe([[0, 0, LK.CONSERVATORY], [D * 0.42, 0, LK.CONSERVATORY], [D * 0.42, len - 2, LK.CONSERVATORY], [0, len - 2, LK.CONSERVATORY]], 12, 0);
      B.pop();
    }
    // plant on the roofs: vents and a heat exchanger
    B.box(xc + b.sd * D * 0.3, H + 1.2, b.z0 + 3, 2, 2.4, 2, LK.DARK);
    b.H = H; b.D = D;
    // street trees and lamps in front of the block
    for (let z = b.z0 + 4; z < b.z1 - 10; z += 16) putLocal('tree', b.sd * (W + 1.0), z + 8, rnd() * TAU, 0);
  }
  // street lamps both sides, every 18 m
  for (const sd of [-1, 1]) for (let z = -L + 8; z < L - 4; z += 18) {
    putLocal('lamppost', sd * (W + 0.5), z, sd > 0 ? -Math.PI / 2 : Math.PI / 2);
    const lx = sd * (W + 0.5) - sd * LAMPPOST_LAMP.z;
    lampAt(lx, LAMPPOST_LAMP.y, z, LAMP.AMBER, 0.9, 0.55);
  }
  // --- the plaza: paving, the atrium dome, a pool, benches, planters, kiosks ---
  {
    B.push(X90);
    B.lathe([[0, -0.2, LK.PAVE], [34, -0.2, LK.WALL], [34, 0.45, LK.PAVE], [0, 0.45, LK.PAVE]], 40);
    B.pop();
    const dx = -(W + PAV + 18);                  // the atrium stands off the street's west side
    B.push(new THREE.Matrix4().makeTranslation(dx, 0, 0).multiply(X90));
    B.lathe([[16.5, 0, LK.WALL], [16.5, 1.2, LK.WALL], [16, 1.2, LK.CONSERVATORY], [15.2, 6, LK.CONSERVATORY], [12.8, 10.5, LK.CONSERVATORY], [8.6, 14, LK.CONSERVATORY], [3, 15.6, LK.CONSERVATORY], [0, 15.8, LK.LANTERN]], 28);
    B.pop();
    lampAt(dx, 16.5, 0, LAMP.WHITE, 1.2, 1.8);
    B.push(new THREE.Matrix4().makeTranslation(W + PAV + 12, 0, 0).multiply(X90));
    B.lathe([[7, 0.2, LK.WALL], [7, 0.9, LK.WALL], [6.4, 0.9, LK.POOL], [0, 0.7, LK.POOL]], 24);
    B.pop();
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * TAU;
      putLocal('bench', W + PAV + 12 + Math.cos(a) * 10, Math.sin(a) * 10, -a + Math.PI / 2);
      if (k % 2 && Math.cos(a + 0.4) > -0.5) putLocal('planter', W + PAV + 12 + Math.cos(a + 0.4) * 13.5, Math.sin(a + 0.4) * 13.5, -a);
    }
    for (const z of [-22, 22]) putLocal('kiosk', W + PAV + 4, z, Math.PI / 2, 0, AWNING[(seed + (z > 0 ? 1 : 0)) % AWNING.length]);
    for (let k = 0; k < 6; k++) lampAt(W + PAV + 12 + Math.cos(k / 6 * TAU) * 18, 4.2, Math.sin(k / 6 * TAU) * 18, LAMP.AMBER, 0.8, 0.5);
    for (let k = 0; k < 3; k++) putLocal('cart', W - 3, -8 + k * 5.5, 0, 0, CLOTHES[(seed + k) % CLOTHES.length]);
  }
  // --- the mast at the street's head: a lattice tower, its dish, the beacons ---
  {
    const mz = L + 22, H = 48 + weight * 30;
    B.push(new THREE.Matrix4().makeTranslation(0, 0, mz));
    B.box(0, 0.5, 0, 9, 1, 9, LK.WALL);
    const n = Math.round(H / 4);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box(sx * 2, H / 2, sz * 2, 0.35, H, 0.35, LK.PAINT);
    for (let k = 0; k <= n; k++) {
      const y = k * H / n;
      B.box(0, y, -2, 4, 0.2, 0.2, LK.PAINT); B.box(0, y, 2, 4, 0.2, 0.2, LK.PAINT);
      B.box(-2, y, 0, 0.2, 0.2, 4, LK.PAINT); B.box(2, y, 0, 0.2, 0.2, 4, LK.PAINT);
      if (k < n) { B.push(new THREE.Matrix4().makeTranslation(0, y + H / n / 2, 2).multiply(new THREE.Matrix4().makeRotationZ((k % 2 ? 1 : -1) * Math.atan2(4, H / n)))); B.box(0, 0, 0, 0.15, Math.hypot(4, H / n), 0.15, LK.PAINT); B.pop(); }
    }
    B.push(new THREE.Matrix4().makeTranslation(0, H * 0.72, -2.4).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 + 0.5)));
    B.lathe([[0, 0, LK.HULL], [2, 0.4, LK.HULL], [3.4, 1.2, LK.HULL], [3.3, 1.4, LK.DARK], [0, 0.3, LK.DARK]], 18);
    B.pop();
    B.pop();
    lampAt(0, H + 0.8, mz, LAMP.RED, 2.4, 1.2, { breathe: 1 });
    lampAt(2.2, H * 0.5, mz, LAMP.RED, 1.4, 0.8, { breathe: 0.6, phase: 0.5 });
  }
  // --- greenhouse vaults behind the east terraces: long glazed barrels, lit at night ---
  {
    const gx = W + PAV + 42;
    for (let k = 0; k < 3 + Math.round(weight * 4); k++) {
      const z0 = -L + 20 + k * 34;
      if (z0 + 28 > L - 10) break;
      B.push(new THREE.Matrix4().makeTranslation(gx + 16, 0, z0).multiply(Z90));
      // a half-barrel about the z axis, 14 m wide and 28 m long (lathed as a half, closed ends)
      B.lathe([[0, 0, LK.CONSERVATORY], [7, 0, LK.CONSERVATORY], [7, 28, LK.CONSERVATORY], [0, 28, LK.CONSERVATORY]], 16, 0);
      B.pop();
      B.box(gx + 16, 0.2, z0 + 14, 15, 0.4, 29, LK.WALL);
      lampAt(gx + 16, 7.8, z0 + 14, [0.85, 0.6, 1.0], 0.6, 1.2);
    }
  }
  B.pop();
  // --- what moves: the tram's run and the walkers' beats (site metres) ---
  const siteXZ = (lx, lz) => { toSite(lx, lz, _t); return [_t.x, _t.z]; };
  const tram = { a: siteXZ(0, -L + 14), b: siteXZ(0, L - 14) };
  const walkers = [];
  const nW = 20 + Math.round(weight * 50);
  for (let i = 0; i < nW; i++) {
    const sd = rnd() < 0.5 ? -1 : 1, off = sd * (W + 2.2 + rnd() * (PAV - 2.7));
    walkers.push({ a: siteXZ(off, -L + 6), b: siteXZ(off, L - 6), v: 1.1 + rnd() * 0.6, ph: rnd() * 2 * L, tint: CLOTHES[Math.floor(rnd() * CLOTHES.length)] });
  }
  // plaza strollers on circles round the pool
  for (let i = 0; i < 10; i++) {
    const r = 12 + rnd() * 5;
    const [px, pz] = siteXZ(W + PAV + 12, 0);
    walkers.push({ circle: [px, pz, r], v: (rnd() < 0.5 ? -1 : 1) * (0.8 + rnd() * 0.5), ph: rnd() * TAU * r, tint: CLOTHES[Math.floor(rnd() * CLOTHES.length)] });
  }
  return { geo: own ? B.geometry() : null, lamps, inst, claim, tram, walkers, center: [cx, cz], yaw };
}
const _m2 = new THREE.Matrix4();

// ------------------------------------------------------------------ landmarks --

/** Find a free circle of radius r on the ring d0..d1 round the outpost (clear of the plan and the roads). */
function findSpot(rnd, plan, roads, r, d0, d1) {
  for (let k = 0; k < 300; k++) {
    const a = rnd() * TAU, d = d0 + (d1 - d0) * rnd() + k * 3;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (plan.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r + 8) && roads.every((pts) => pts.every((p) => Math.hypot(p.x - x, p.z - z) > r + 45))) return [x, z, a];
  }
  return null;
}

/**
 * The feature that makes a settlement its own (lunarNetwork.js FAR_TOWNS): 'polar' - the
 * eternal-light solar towers on the rim, the ice mine in the crater's shadow and the tall
 * beacon mast; 'observatory' - the far side's great radio dish on its mount and the Y of the
 * array; 'farside' - a terraced arcology, glazed gardens stepping up its flanks. Built into
 * the outpost's builder; returns the circles it claimed.
 */
export function buildLandmarks(feature, seed, weight, plan, B, lamps, put, roads = []) {
  const rnd = mulberry(seed * 6007 + 29);
  const claimed = [];
  const claim = (kind, x, z, r) => { const c = { kind, x, z, r }; plan.push(c); claimed.push(c); };
  const lampW = (x, y, z, color, i = 1, r = 1, extra = {}) => { seat(_m2, x, z); lamps.push({ p: V(x, y + _m2.elements[13], z), r, color, i, ...extra }); };
  if (feature === 'polar') {
    // the eternal-light towers: vertical arrays 90 m tall on masts, turned to the low Sun that
    // circles the horizon (each on its own bearing round the rim), with their beacons
    const s = findSpot(rnd, plan, roads, 330, 700, 1300);
    if (s) {
      const [cx, cz] = s;
      claim('light towers', cx, cz, 330);
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * TAU, x = cx + Math.cos(a) * 250, z = cz + Math.sin(a) * 250, yaw = a + Math.PI / 2 + 0.3;
        B.push(seat(_m, x, z, yaw, 0));
        B.box(0, 1, 0, 10, 2, 10, LK.WALL);
        B.box(0, 55, 0, 2.2, 110, 2.2, LK.PAINT);
        for (let j = 0; j < 4; j++) {
          B.box(0, 24 + j * 22, 0.9, 26, 20, 0.35, LK.SOLAR);
          B.box(0, 24 + j * 22 + 10.2, 0.9, 27, 0.5, 0.6, LK.HULL);
        }
        B.box(0, 112, 0, 1.2, 4, 1.2, LK.HULL);
        B.pop();
        lampW(x, 114.5, z, LAMP.RED, 2.2, 1.6, { breathe: 0.8, phase: k / 8 });
      }
      // the beacon mast in the middle: 180 m of lattice, guyed, three tiers of lamps
      const H = 180;
      B.push(seat(_m, cx, cz, 0, 0));
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box(sx * 2.4, H / 2, sz * 2.4, 0.5, H, 0.5, LK.PAINT);
      for (let y = 0; y <= H; y += 6) { B.box(0, y, -2.4, 4.8, 0.3, 0.3, LK.PAINT); B.box(0, y, 2.4, 4.8, 0.3, 0.3, LK.PAINT); B.box(-2.4, y, 0, 0.3, 0.3, 4.8, LK.PAINT); B.box(2.4, y, 0, 0.3, 0.3, 4.8, LK.PAINT); }
      for (let g = 0; g < 3; g++) {
        const ga = g / 3 * TAU, gx = Math.cos(ga) * 110, gz = Math.sin(ga) * 110;
        B.tube([V(0, H * 0.8, 0), V(gx, 0.5, gz)], 0.12, 4, LK.BRONZE);
        B.box(gx, 0.8, gz, 4, 1.6, 4, LK.WALL);
      }
      B.pop();
      for (const y of [H * 0.35, H * 0.7, H + 1.5]) lampW(cx, y, cz, y > H ? LAMP.WHITE : LAMP.RED, y > H ? 3.5 : 2, y > H ? 2.4 : 1.4, { breathe: 1 });
    }
    // the ice mine: a cold trap dug into the crater floor, its gantry, the insulated line home
    const m = findSpot(rnd, plan, roads, 180, 500, 1400);
    if (m) {
      const [mx, mz] = m;
      claim('ice mine', mx, mz, 180);
      B.push(seat(_m, mx, mz, rnd() * TAU, 0));
      B.push(X90);
      B.lathe([[0, -14, LK.GROUND], [60, -14, LK.GROUND], [95, -3, LK.REGOLITH], [120, 2.5, LK.REGOLITH], [150, 0.2, LK.REGOLITH]], 40);
      B.pop();
      // ice faces: pale benches in the pit wall
      for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; B.at(Math.cos(a) * 78, -8, Math.sin(a) * 78, 0, -a, 0); B.box(0, 0, 0, 5, 3, 26, LK.PAVE); B.pop(); }
      // the gantry across the pit, its trolley and the hoist
      for (const s of [-1, 1]) { B.box(s * 128, 10, 0, 6, 20, 6, LK.PAINT); B.box(s * 128, 21, 0, 8, 2, 14, LK.HAZARD); }
      B.box(0, 22, -5, 262, 3, 2, LK.PAINT); B.box(0, 22, 5, 262, 3, 2, LK.PAINT);
      B.box(20, 20, 0, 10, 5, 12, LK.HULL);
      B.tube([V(20, 18, 0), V(20, -10, 0)], 0.15, 4, LK.BRONZE);
      // the processing plant on the rim: domes and a heat-exchanger stack, steam-lit at night
      B.box(170, 9, 0, 34, 18, 24, LK.HULL);
      B.box(170, 20, 0, 6, 8, 6, LK.RADIATOR);
      for (const z of [-24, 24]) B.box(170, 6, z, 22, 12, 14, LK.STONE);
      B.pop();
      lampW(mx, 26, mz, LAMP.AMBER, 1.6, 1.4);
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; lampW(mx + Math.cos(a) * 140, 8, mz + Math.sin(a) * 140, LAMP.WHITE, 1.3, 1.2); }
    }
  } else if (feature === 'observatory') {
    // the great dish: 140 m, on an alt-azimuth mount turning on a ring rail; the Y of the array
    const s = findSpot(rnd, plan, roads, 460, 700, 1300);
    if (s) {
      const [cx, cz] = s;
      claim('observatory', cx, cz, 460);
      B.push(seat(_m, cx, cz, rnd() * TAU, 0));
      B.push(X90);
      B.lathe([[52, 0, LK.WALL], [52, 1.5, LK.WALL], [48, 1.5, LK.DARK], [0, 1.5, LK.DARK]], 48);
      B.pop();
      for (const s2 of [-1, 1]) { B.box(s2 * 30, 40, 0, 8, 80, 18, LK.PAINT); B.box(s2 * 30, 2, 0, 16, 4, 30, LK.HULL); }
      B.box(0, 3, 0, 68, 6, 14, LK.HULL);
      B.push(new THREE.Matrix4().makeTranslation(0, 80, 0).multiply(new THREE.Matrix4().makeRotationX(-0.7)));
      const prof = [];
      for (let i = 0; i <= 10; i++) { const r = i * 7; prof.push([r, r * r / 280, LK.HULL]); }
      prof.push([70, 70 * 70 / 280 + 1.2, LK.DARK], [0, 1.2, LK.DARK]);
      B.lathe(prof, 48);
      for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + 0.785; B.tube([V(Math.cos(a) * 44, Math.sin(a) * 44, 7), V(0, 0, 52)], 0.6, 5, LK.PAINT); }
      B.box(0, 0, 52, 5, 5, 8, LK.BRONZE);
      B.pop();
      B.pop();
      lampW(cx, 150, cz, LAMP.RED, 2.6, 1.6, { breathe: 1 });
      // the array: three arms of dishes (smaller, 22 m) out from the great one
      for (let arm = 0; arm < 3; arm++) for (let k = 1; k <= 4; k++) {
        const a = arm / 3 * TAU + 0.3, d = 110 + k * 80, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (!plan.every((p) => p.kind === 'observatory' || Math.hypot(p.x - x, p.z - z) > p.r + 16)) continue;
        B.push(seat(_m, x, z, a, 0));
        B.box(0, 7, 0, 2.4, 14, 2.4, LK.PAINT);
        B.push(new THREE.Matrix4().makeTranslation(0, 14, 0).multiply(new THREE.Matrix4().makeRotationX(-0.75)));
        B.lathe([[0, 0, LK.HULL], [4, 0.3, LK.HULL], [8, 1.2, LK.HULL], [11, 2.7, LK.HULL], [10.8, 3.1, LK.DARK], [0, 0.8, LK.DARK]], 20);
        B.pop();
        B.pop();
        lampW(x, 1.5, z, LAMP.AMBER, 0.6, 0.6);
      }
    }
  } else if (feature === 'farside') {
    // the arcology: a stepped pyramid of five terraces, lit stone faces, glazed gardens on each step
    const s = findSpot(rnd, plan, roads, 140, 450, 1100);
    if (s) {
      const [cx, cz, a] = s;
      claim('arcology', cx, cz, 140);
      B.push(seat(_m, cx, cz, a, 0));
      let w = 190 + weight * 40;
      for (let t = 0; t < 5; t++) {
        const y0 = t * 14, h = 12;
        B.box(0, y0 + h / 2, 0, w, h, w, LK.STONE);
        B.box(0, y0 + h + 1.2, 0, w - 4, 2.4, w - 4, LK.CONSERVATORY);
        B.box(0, y0 + h + 0.2, w / 2 - 3, w - 8, 0.4, 5, LK.ROOFG);
        w -= 34;
      }
      B.box(0, 74, 0, 14, 8, 14, LK.GLASS);
      B.box(0, 82, 0, 2, 10, 2, LK.PAINT);
      B.pop();
      lampW(cx, 88, cz, LAMP.WHITE, 2.2, 1.6, { breathe: 1 });
      for (let k = 0; k < 8; k++) { const b = k / 8 * TAU; lampW(cx + Math.cos(b) * 110, 1.5, cz + Math.sin(b) * 110, LAMP.AMBER, 1, 1); }
    }
  }
  return claimed;
}

/** The quarter's people and its tram, animated near the camera. */
export class QuarterLife {
  constructor(q, mat, group, seed) {
    this.q = q;
    this.walk = lunarInstanced(kit('walker'), q.walkers.length, {}, mat, { tint: true });
    this.walk.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    q.walkers.forEach((w, i) => this.walk.instanceColor.setXYZ(i, ...w.tint));
    this.walk.name = 'Quarter people';
    this.tram = lunarInstanced(kit('tram'), 1, {}, mat, { tint: true });
    this.tram.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tram.instanceColor.setXYZ(0, ...AWNING[seed % AWNING.length]);
    this.tram.name = 'Quarter tram';
    group.add(this.walk, this.tram);
    const [ax, az] = q.tram.a, [bx, bz] = q.tram.b;
    this.tramL = Math.hypot(bx - ax, bz - az);
    this.tramYaw = Math.atan2(bx - ax, bz - az);
    this.update(0);
  }

  get objects() { return [this.walk, this.tram]; }

  update(t) {
    const W = this.q.walkers;
    for (let i = 0; i < W.length; i++) {
      const w = W[i];
      let x, z, yaw;
      if (w.circle) {
        const [px, pz, r] = w.circle, a = (w.ph + t * w.v) / r;
        x = px + Math.cos(a) * r; z = pz + Math.sin(a) * r; yaw = -a + (w.v > 0 ? 0 : Math.PI);
      } else {
        const [ax, az] = w.a, [bx, bz] = w.b, Lw = Math.hypot(bx - ax, bz - az);
        let q = (w.ph + t * w.v) % (2 * Lw), dir = 1;
        if (q > Lw) { q = 2 * Lw - q; dir = -1; }
        const f = q / Lw;
        x = ax + (bx - ax) * f; z = az + (bz - az) * f;
        yaw = Math.atan2(bx - ax, bz - az) + (dir > 0 ? 0 : Math.PI);
      }
      // a walk's bob in the low gravity: long, floating strides
      this.walk.setMatrixAt(i, seat(_m, x, z, yaw, 0.6 + 0.08 * Math.abs(Math.sin(t * 2.6 + i))));
    }
    this.walk.instanceMatrix.needsUpdate = true;
    // the tram: out and back, 70 s a run, 25 s at each end, easing in and out
    const ph = (t % 190) / 190;
    const u = ph < 0.13 ? 0 : ph < 0.5 ? (ph - 0.13) / 0.37 : ph < 0.63 ? 1 : 1 - (ph - 0.63) / 0.37;
    const e = u * u * (3 - 2 * u);
    const [ax, az] = this.q.tram.a, [bx, bz] = this.q.tram.b;
    this.tram.setMatrixAt(0, seat(_m, ax + (bx - ax) * e, az + (bz - az) * e, this.tramYaw, 0.5));
    this.tram.instanceMatrix.needsUpdate = true;
  }
}
