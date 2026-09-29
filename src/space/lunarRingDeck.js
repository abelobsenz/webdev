import * as THREE from 'three';
import { CB } from '../craft/craftGeometry.js';
import { LK, lunarInstanced, createLunarMaterial } from './lunarMaterial.js';
import { kit } from './lunarKit.js';

// The lunar ring's deck in three dimensions near the camera. The ring's own shader (moon.js
// RING_FRAG) paints the whole 13,300 km deck plan: the central boulevard, the keel galleries'
// skylights, the two transit beds, the terrace streets with their blocks, the garden terraces
// and the shield yards at the edges. From a few kilometres that plan read as flat stripes.
// Here the same plan stands up round the camera: the terrace blocks at the shader's own plots
// and heights (its hash, reproduced in float32 steps), with stone street fronts over lit
// arcades, podium gardens and coloured roofs; barrel-vaulted glazing over the keel galleries;
// portal frames striding over the express rails; the shield galleries along both edges; tree
// avenues down the boulevard and the long garden walk; and trams running the carriageways.
//
// Everything is instanced in the Moon frame, metres (like the ring's trains and halls), and
// refilled only when the camera moves ANCHOR km along the ring (no per-frame work but the
// trams). Kept clear of the Tranquillity Exchange (|u| < 7.2 km) and the Service Court.

export const DECK = {
  R: 2117000,                 // deck top radius (m): the ring band's top face (moon.js buildBand)
  P: 0.24,                    // terrace plot pitch along the ring (km), as blockH()
  rowIn: 2.2, rowOut: 2.78,   // terrace row, km across (either side)
  skyl: [0.91, 1.33],         // the keel galleries' skylight band (km across)
  rail: 1.7,                  // express rail centreline (km across)
  shield: 4.86,               // shield gallery centreline (km across)
  walk: 3.0,                  // the long garden walk (km across)
  boul: 0.88,                 // boulevard half-width (km)
  exch: 7.2,                  // the Exchange's half-length along the ring (km)
  court: { u0: 6.8, u1: 10.0, a0: 1.3, a1: 3.3 },   // the Service Court's footprint (+ side)
  sector: 2 * Math.PI * 2117 / 768,                  // district pitch (km): the halls' sectors
  win: { blocks: 40, vaults: 12, portals: 10, shield: 30, trees: 5, trams: 8, glass: 24 },
  glassA: 3.62, glassStep: 1.44,   // glasshouses on the garden terraces: across, pitch (the cross streets')
  anchor: 3,
  segs: 1800,                 // the band's segments (moon.js: buildBand(R_MOON + 380, 11, 1800))
  window: 260,                // km off the deck beyond which none of it is drawn
};
const CIRC = 2 * Math.PI * DECK.R / 1000;              // km

// ---- the ring shader's hash12, in float32 (so the blocks stand on the painted plots) ----
const fr = Math.fround;
const fract = (x) => x - Math.floor(x);
export function hash12(x, y) {
  let a = fract(fr(fr(x) * fr(0.1031))), b = fract(fr(fr(y) * fr(0.1031))), c = a;
  const d = fr(fr(a * fr(b + 33.33)) + fr(b * fr(c + 33.33)) + fr(c * fr(a + 33.33)));
  a = fr(a + d); b = fr(b + d); c = fr(c + d);
  return fract(fr(fr(a + b) * c));
}

/** The ring shader's plotHash (moon.js): PCG on the plot index, exact in both. */
export function plotHash(bi, sd, salt) {
  const v = (Math.imul((bi + 1048576) >>> 0, 2) + (sd > 0 ? 1 : 0) + Math.imul(salt, 2654435761)) >>> 0;
  const st = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((st >>> ((st >>> 28) + 4)) ^ st) >>> 0, 277803737) >>> 0;
  return (((w >>> 22) ^ w) >>> 0) / 4294967295;
}

/** The terrace plot at plot index bi on side sd (+-1): null for a pocket square, else its
 * height (m), whether it is built round a light-well court, and its roof colour. As blockH(). */
export function plot(bi, sd) {
  const h = plotHash(bi, sd, 1);
  if (h < 0.12) return null;
  const H = (0.018 + 0.05 * plotHash(bi, sd, 2)) * 1000;
  const rh = plotHash(bi, sd, 3);
  const roof = rh < 0.3 ? [0.3, 0.15, 0.1] : rh < 0.55 ? [0.14, 0.145, 0.16] : rh < 0.78 ? [0.1, 0.15, 0.07] : [0.05, 0.07, 0.14];
  return { H, court: h > 0.5, roof };
}

/** Is the deck point (u km along from the Exchange, signed; a km across) clear of the
 * Exchange and the Service Court? */
export function deckClear(u, a, pad = 0) {
  if (Math.abs(u) < DECK.exch + pad) return false;
  const C = DECK.court;
  if (a > C.a0 - pad && a < C.a1 + pad && u > C.u0 - pad && u < C.u1 + pad) return false;
  return true;
}

// ------------------------------------------------------------------------ geometry --

/** Offset a geometry's facade x (so instanced variants do not repeat one window pattern). */
function shiftFacade(g, dx) {
  const f = g.attributes.aFacade;
  for (let i = 0; i < f.count; i++) {
    const k = f.getZ(i);
    if (k > 19.5 && k < 20.5) f.setX(i, f.getX(i) + dx);
  }
  return g;
}

/** A barrel vault along x from x0 to x1, centred at z = cz, radius r across, rising `rise`. */
function barrel(B, x0, x1, cz, r, rise, seg, k) {
  const up = new THREE.Vector3();
  for (let i = 0; i < seg; i++) {
    const a0 = Math.PI * i / seg, a1 = Math.PI * (i + 1) / seg, am = (a0 + a1) / 2;
    const z0 = cz + r * Math.cos(a0), y0 = rise * Math.sin(a0), z1 = cz + r * Math.cos(a1), y1 = rise * Math.sin(a1);
    const p0 = B.v(x0, y0, z0, x0, a0 * r, k), p1 = B.v(x1, y0, z0, x1, a0 * r, k);
    const p2 = B.v(x1, y1, z1, x1, a1 * r, k), p3 = B.v(x0, y1, z1, x0, a1 * r, k);
    up.set(0, Math.sin(am) * r, Math.cos(am) * rise);
    B.tri(p0, p1, p2, up); B.tri(p0, p2, p3, up);
  }
}

/**
 * A terrace block on one plot (metres: x along the ring, y up, z across; the plot 212 m by
 * 580 m, the street fronts at z = +-290). Solid: two ranges back to back over a service mews,
 * each a stone podium of shops and workshops under a garden roof, the tall range set back
 * along the street over a lit arcade. Court: four ranges round a planted light well.
 * Upper roofs are in the instance colour (terracotta, slate, sedum, photovoltaic).
 */
export function buildTerraceBlock(H, court) {
  const B = new CB();
  const L = 212, hd = 290;
  const storey = 3.6, snap = (h) => Math.max(2, Math.round(h / storey)) * storey;
  const Hp = snap(H * 0.42), Hu = snap(H);
  const roofSlab = (cx, cy, cz, sx, sz, k) => {
    B.box(cx, cy + 0.5, cz, sx + 1.2, 1, sz + 1.2, k);
    B.box(cx, cy + 1.6, cz + sz / 2 + 0.3, sx + 1.2, 1.2, 0.6, LK.DARK);    // the parapets
    B.box(cx, cy + 1.6, cz - sz / 2 - 0.3, sx + 1.2, 1.2, 0.6, LK.DARK);
  };
  if (!court) {
    for (const s of [-1, 1]) {
      // the podium: the range's whole depth, workshops and shops, its roof a garden terrace
      B.box(0, Hp / 2, s * 165, L, Hp, 250, LK.STONE);
      roofSlab(0, Hp, s * 165, L, 250, LK.ROOFG);
      // the tall range along the street, set back 12 m over the arcade
      const zc = s * (hd - 12 - 55);
      B.box(0, Hu / 2, zc, L - 24, Hu, 110, LK.STONE);
      roofSlab(0, Hu, zc, L - 24, 110, LK.PAINT);
      // roof plant and a lift overrun, the stair towers at the ends of the range
      B.box(-40, Hu + 4, zc, 14, 6, 20, LK.HULL);
      B.box(50, Hu + 3, zc + s * 20, 10, 4, 12, LK.DARK);
      for (const e of [-1, 1]) B.box(e * (L / 2 - 20), Hu / 2 + 2, zc - s * 60, 14, Hu + 4, 12, LK.STONE);
      // the arcade: a lit glazed shopfront along the foot of the street face, its canopy
      B.box(0, 3, s * (hd + 0.2), L - 10, 5.4, 0.4, LK.GLASS);
      B.box(0, 6.2, s * (hd + 3), L - 6, 0.6, 6, LK.DARK);
      B.box(0, 8.4, s * (hd + 0.5), L - 40, 1.4, 0.3, LK.SIGN);
      // the podium's garden: planters and a pergola walk down the middle of it
      B.box(0, Hp + 2.2, s * 120, L - 60, 1.4, 6, LK.GARDEN);
      B.box(0, Hp + 4.5, s * 108, L - 60, 0.5, 4, LK.BRONZE);
    }
    // the service mews between the ranges: paving, loading bays, a canopy walk
    B.box(0, 0.3, 0, L, 0.6, 80, LK.PAVE);
    B.box(0, 5.5, 0, L - 30, 0.5, 8, LK.DECK);
  } else {
    const w = 58;
    for (const s of [-1, 1]) {
      // the street ranges, full length, and the cross ranges at the plot's ends, lower
      const zc = s * (hd - w / 2);
      B.box(0, Hu / 2, zc, L, Hu, w, LK.STONE);
      roofSlab(0, Hu, zc, L, w, LK.PAINT);
      B.box(-50, Hu + 3.5, zc, 16, 5, 18, LK.HULL);
      const xc = s * (L / 2 - 20);
      B.box(xc, snap(Hp * 1.3) / 2, 0, 40, snap(Hp * 1.3), 2 * (hd - w), LK.STONE);
      roofSlab(xc, snap(Hp * 1.3), 0, 40, 2 * (hd - w), LK.ROOFG);
      B.box(0, 3, s * (hd + 0.2), L - 10, 5.4, 0.4, LK.GLASS);
      B.box(0, 6.2, s * (hd + 3), L - 6, 0.6, 6, LK.DARK);
      B.box(0, 8.4, s * (hd + 0.5), L - 40, 1.4, 0.3, LK.SIGN);
    }
    // the light well: a garden court with its trees and a glazed winter garden in the middle
    B.box(0, 0.4, 0, L - 80, 0.8, 2 * (hd - w) - 4, LK.COURT);
    B.box(0, 6, 0, 60, 11, 90, LK.CONSERVATORY);
  }
  return B.geometry();
}

/** A tree for the avenues (metres, base at the origin): a trunk and a two-tier crown. */
export function buildTree() {
  const B = new CB();
  B.box(0, 3.5, 0, 0.9, 7, 0.9, LK.DARK);
  B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  B.lathe([[0.3, 5, LK.GARDEN], [5.2, 7, LK.GARDEN], [6.4, 10.5, LK.GARDEN], [4.6, 14, LK.GARDEN], [0.3, 16.5, LK.GARDEN]], 7);
  B.pop();
  return B.geometry();
}

/** The glazing over the keel galleries: seven barrel vaults across the 420 m skylight band,
 * a 120 m length of them, on bronze ribs (metres, z = 0 at the band's centre). */
export function buildVaults() {
  const B = new CB();
  const L = 120, n = 7, w = 60;
  for (let i = 0; i < n; i++) {
    const cz = (i - (n - 1) / 2) * w;
    barrel(B, -L / 2, L / 2, cz, w / 2 - 1.5, 13, 8, LK.ROOF);
    // the gutters between the barrels, and the rib at the length's end
    B.box(0, 0.6, cz + w / 2, L, 1.2, 3, LK.DARK);
    B.box(-L / 2 + 0.6, 6, cz, 1.2, 12, w - 6, LK.BRONZE);
  }
  B.box(0, 0.6, -n * w / 2, L, 1.2, 3, LK.DARK);
  return B.geometry();
}

/** A portal frame over an express rail (metres; the rail's centre at z = 0, its top 70 m up):
 * two lattice-looking masts 220 m apart, the beam with its signal heads, 135 m up. */
export function buildPortal() {
  const B = new CB();
  for (const s of [-1, 1]) {
    B.box(0, 68, s * 110, 5, 136, 5, LK.PAINT);
    B.box(0, 68, s * 110 + s * 3.2, 1.2, 130, 1.2, LK.DARK);
    B.box(0, 3, s * 110, 12, 6, 12, LK.HAZARD);
    B.box(0, 124, s * 98, 3, 3, 24, LK.PAINT);                               // the knee braces
  }
  B.box(0, 136, 0, 6, 7, 230, LK.PAINT);
  B.box(0, 132, 0, 3, 1, 200, LK.DARK);
  for (const z of [-30, 30]) { B.box(0, 130, z, 4, 5, 3, LK.DARK); B.box(2.1, 130, z, 0.3, 3, 2, LK.LIGHT); }
  return B.geometry();
}

/** A 200 m length of the shield gallery along the deck's edge (metres, the inboard face
 * toward -z): a pressurised gallery 60 m deep with its window bands, buttresses and roof walk. */
export function buildShieldGallery() {
  const B = new CB();
  const L = 200;
  B.box(0, 18, 0, L, 36, 60, LK.HULL);
  B.box(0, 22, -30.3, L - 8, 4, 0.4, LK.GLASS);
  B.box(0, 12, -30.3, L - 8, 4, 0.4, LK.GLASS);
  B.box(0, 30.5, -30.4, L - 20, 1.4, 0.3, LK.SIGN);
  B.box(0, 36.5, 0, L, 1, 56, LK.DECK);
  for (let x = -L / 2 + 25; x < L / 2; x += 50) {
    B.box(x, 16, -33, 5, 32, 6, LK.DARK);
    B.box(x, 38.5, 0, 3, 3, 60, LK.HULL);
  }
  B.box(0, 1.4, -34, L, 2.8, 8, LK.HAZARD);
  return B.geometry();
}

/** A garden glasshouse on the terraces (metres, long axis along the ring): a glazed barrel
 * 90 m long over a stone plinth, a lantern at the crown, two lower wings, a pool before it. */
export function buildGlasshouse() {
  const B = new CB();
  B.box(0, 1.5, 0, 96, 3, 40, LK.WALL);
  B.at(0, 3, 0);
  barrel(B, -45, 45, 0, 17, 16, 10, LK.CONSERVATORY);
  B.pop();
  for (const e of [-1, 1]) {
    B.box(e * 45.3, 11, 0, 0.6, 16, 34, LK.CONSERVATORY);
    B.at(e * 62, 3, 0);
    barrel(B, -14, 14, 0, 11, 9, 8, LK.CONSERVATORY);
    B.pop();
    B.box(e * 76.3, 7, 0, 0.6, 8, 22, LK.CONSERVATORY);
  }
  B.box(0, 20.5, 0, 22, 3, 6, LK.LIGHT);
  B.box(0, 19, 0, 26, 1, 8, LK.BRONZE);
  B.box(0, 0.2, 34, 60, 0.4, 16, LK.POOL);
  B.box(0, 0.15, 34, 64, 0.3, 20, LK.WALL);
  return B.geometry();
}

// ------------------------------------------------------------------------- runtime --

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _c = new THREE.Vector3(), _inv = new THREE.Matrix4(), _s = new THREE.Vector3();
const HC = [24, 40, 60];                               // the blocks' height classes (m)
const LIVERY = [[0.72, 0.18, 0.12], [0.86, 0.82, 0.74], [0.12, 0.3, 0.5], [0.2, 0.42, 0.3]];
const TRAM = { lanes: [-0.62, -0.3, 0.3, 0.62], spacing: 0.6, cars: 3, pitch: 26, speed: 0.02 };   // km, km, m, km/s

/** The instance matrix at deck point (u km, a km across), height y (m), scaled (sx, sy, sz),
 * yawed half a turn when `flip` (local x along the ring, y up, z across). */
function deckMatrix(m, u, a, y, sx = 1, sy = 1, sz = 1, flip = false) {
  const th = u / (DECK.R / 1000);
  const c = Math.cos(th), s = Math.sin(th);
  const f = flip ? -1 : 1;
  _x.set(-s * f * sx, 0, c * f * sx);
  _y.set(c * sy, 0, s * sy);
  _z.set(0, f * sz, 0);
  m.makeBasis(_x, _y, _z);
  const r = deckTop(th) + y;
  return m.setPosition(c * r, a * 1000, s * r);
}

/** The deck's top radius (m) at angle th: the band is a polygon of DECK.segs chords, whose
 * middles sag 3 m inside the true circle; everything stands on the chord, not the circle. */
export function deckTop(th) {
  const seg = 2 * Math.PI / DECK.segs;
  const l = th - (Math.floor(th / seg) + 0.5) * seg;
  return DECK.R * Math.cos(seg / 2) / Math.cos(l);
}

export class LunarRingDeck {
  constructor(parent) {
    this.parent = parent;
    this.mat = createLunarMaterial({ lit: 0.7, accent: [0.95, 0.78, 0.5] });
    const W = DECK.win;
    const nPlots = Math.ceil(2 * (W.blocks + DECK.anchor) / DECK.P) * 2;
    this.blocks = [];
    let seq = 0;
    for (const H of HC) for (const court of [false, true]) {
      const g = shiftFacade(buildTerraceBlock(H, court), 5000 * ++seq);
      const m = lunarInstanced(g, nPlots, {}, this.mat, { tint: true });
      m.name = `Ring terrace blocks (${court ? 'court' : 'solid'}, ${H} m)`;
      this.blocks.push({ mesh: m, H, court });
    }
    const perKm = (step) => Math.ceil(2 * (step + DECK.anchor));
    this.vaults = lunarInstanced(buildVaults(), perKm(W.vaults) / 0.12 * 2, {}, this.mat);
    this.vaults.name = 'Ring keel gallery vaults';
    this.portals = lunarInstanced(buildPortal(), Math.ceil(perKm(W.portals) / 0.15) * 2, {}, this.mat, { tint: true });
    this.portals.name = 'Ring express rail portals';
    this.shield = lunarInstanced(buildShieldGallery(), Math.ceil(perKm(W.shield) / 0.2) * 2, {}, this.mat);
    this.shield.name = 'Ring shield galleries';
    // avenues: the boulevard's median (two rows), both kerbs, both sides of the long walk
    this.treeRows = [[-0.018, 0.016], [0.018, 0.016], [-0.84, 0.02], [0.84, 0.02], [-DECK.walk - 0.012, 0.02], [-DECK.walk + 0.012, 0.02], [DECK.walk - 0.012, 0.02], [DECK.walk + 0.012, 0.02]];
    this.trees = lunarInstanced(buildTree(), this.treeRows.reduce((n, [, st]) => n + Math.ceil(perKm(W.trees) / st), 0), {}, this.mat);
    this.trees.name = 'Ring avenue trees';
    this.glass = lunarInstanced(buildGlasshouse(), Math.ceil(perKm(W.glass) / DECK.glassStep) * 2, {}, this.mat);
    this.glass.name = 'Ring garden glasshouses';
    const nTram = TRAM.lanes.length * Math.ceil(2 * W.trams / TRAM.spacing + 2) * TRAM.cars;
    this.trams = lunarInstanced(kit('tram'), nTram, {}, this.mat, { tint: true });
    this.trams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trams.name = 'Ring boulevard trams';
    this.statics = [...this.blocks.map((b) => b.mesh), this.vaults, this.portals, this.shield, this.trees, this.glass];
    this.all = [...this.statics, this.trams];
    for (const m of this.all) { m.count = 0; m.visible = false; parent.add(m); }
    this.key = null;
    this.uCam = 0;
  }

  /** The camera's place along the ring (signed km from the Exchange), or null when it is
   * more than DECK.window km off the deck. */
  camU(camWorld) {
    _inv.copy(this.parent.matrixWorld).invert();
    _c.copy(camWorld).applyMatrix4(_inv);                     // Moon frame, km
    const rc = Math.hypot(_c.x, _c.z);
    if (Math.abs(rc - DECK.R / 1000) > DECK.window || Math.abs(_c.y) > DECK.window) return null;
    return Math.atan2(_c.z, _c.x) * DECK.R / 1000;
  }

  /** Refill the static sets round u0 (signed km). */
  fill(u0) {
    const W = DECK.win;
    // terrace blocks on the shader's plots
    for (const b of this.blocks) b.mesh.count = 0;
    const P = DECK.P;
    // the shader's plots count from angle zero round to 2 pi (u = th R): walk them in that u,
    // the window split where it crosses zero, and place each at its signed u
    const usLo = u0 - W.blocks, usHi = u0 + W.blocks;
    const spans = usLo < 0 ? [[usLo + CIRC, CIRC, -CIRC], [0, Math.max(usHi, 0), 0]] : [[usLo, usHi, 0]];
    for (const [s0, s1, shift] of spans) for (let bi = Math.floor(s0 / P); bi <= Math.floor(s1 / P); bi++) {
      if ((bi + 1) * P > CIRC || s1 <= s0) continue;                           // (the part plot at the seam)
      const uc = (bi + 0.5) * P + shift;
      const j = bi;
      for (const sd of [-1, 1]) {
        const a = sd * (DECK.rowIn + DECK.rowOut) / 2;
        if (!deckClear(uc, a, 0.3)) continue;
        const pl = plot(bi, sd);
        if (!pl) continue;
        const cls = pl.H < 32 ? 0 : pl.H < 50 ? 1 : 2;
        const set = this.blocks[cls * 2 + (pl.court ? 1 : 0)];
        const m = set.mesh;
        if (m.count >= m.instanceMatrix.count) continue;
        m.setMatrixAt(m.count, deckMatrix(_m, uc, a, 0, 1, pl.H / set.H, 1, (j & 1) === 1));
        m.instanceColor.setXYZ(m.count, pl.roof[0], pl.roof[1], pl.roof[2]);
        m.count++;
      }
    }
    // keel gallery vaults either side of the boulevard
    let n = 0;
    const vc = (DECK.skyl[0] + DECK.skyl[1]) / 2;
    for (let u = Math.floor((u0 - W.vaults) / 0.12) * 0.12; u < u0 + W.vaults; u += 0.12) {
      for (const sd of [-1, 1]) {
        if (!deckClear(u + 0.06, sd * vc, 0.1) || n >= this.vaults.instanceMatrix.count) continue;
        this.vaults.setMatrixAt(n++, deckMatrix(_m, u + 0.06, sd * vc, 0));
      }
    }
    this.vaults.count = n;
    // portals over the express rails, every 150 m, in the rail company's colours
    n = 0;
    for (let u = Math.floor((u0 - W.portals) / 0.15) * 0.15; u < u0 + W.portals; u += 0.15) {
      for (const sd of [-1, 1]) {
        if (!deckClear(u, sd * DECK.rail, 0.3) || n >= this.portals.instanceMatrix.count) continue;
        this.portals.setMatrixAt(n, deckMatrix(_m, u, sd * DECK.rail, 0));
        const k = Math.round(u / 0.15) % 8 === 0;
        this.portals.instanceColor.setXYZ(n, k ? 0.72 : 0.42, k ? 0.5 : 0.44, k ? 0.12 : 0.47);
        n++;
      }
    }
    this.portals.count = n;
    // shield galleries along both edges, broken where the halls stand at each sector's centre
    n = 0;
    for (let u = Math.floor((u0 - W.shield) / 0.2) * 0.2; u < u0 + W.shield; u += 0.2) {
      const dU = u + 0.1 - Math.round((u + 0.1) / DECK.sector) * DECK.sector;
      if (Math.abs(dU) < 1.0) continue;
      for (const sd of [-1, 1]) {
        if (!deckClear(u + 0.1, sd * DECK.shield, 0.2) || n >= this.shield.instanceMatrix.count) continue;
        this.shield.setMatrixAt(n++, deckMatrix(_m, u + 0.1, sd * DECK.shield, 0, 1, 1, 1, sd < 0));
      }
    }
    this.shield.count = n;
    // glasshouses on the garden terraces, midway between the cross streets, away from the
    // halls and the district plazas at each sector's centre; one in three plots left open
    n = 0;
    const gs = DECK.glassStep;
    for (let u = Math.floor((u0 - W.glass) / gs) * gs + gs / 2; u < u0 + W.glass; u += gs) {
      const dU = u - Math.round(u / DECK.sector) * DECK.sector;
      if (Math.abs(dU) < 1.3) continue;
      for (const sd of [-1, 1]) {
        if (hash12(Math.round(u / gs) * 3.1, sd * 7.0) < 0.33) continue;
        if (!deckClear(u, sd * DECK.glassA, 0.2) || n >= this.glass.instanceMatrix.count) continue;
        this.glass.setMatrixAt(n++, deckMatrix(_m, u, sd * DECK.glassA, 0, 1, 1, 1, sd < 0));
      }
    }
    this.glass.count = n;
    // the avenues
    n = 0;
    for (const [a, st] of this.treeRows) {
      for (let u = Math.floor((u0 - W.trees) / st) * st; u < u0 + W.trees; u += st) {
        if (!deckClear(u, a, 0.05) || n >= this.trees.instanceMatrix.count) continue;
        const h = hash12(Math.round(u / st), a * 100);
        const sc = 0.8 + 0.45 * h;
        this.trees.setMatrixAt(n++, deckMatrix(_m, u + (h - 0.5) * st * 0.4, a, 0, sc, sc * (0.9 + 0.2 * fract(h * 7.3)), sc, h > 0.5));
      }
    }
    this.trees.count = n;
    for (const m of this.statics) {
      m.visible = m.count > 0;
      if (m.count) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }
  }

  /** Trams on the boulevard round u0: sets of three cars, each lane its own direction. */
  moveTrams(t, u0) {
    const T = this.trams, W = DECK.win.trams;
    let n = 0;
    for (let l = 0; l < TRAM.lanes.length; l++) {
      const a = TRAM.lanes[l], dir = a > 0 ? 1 : -1;
      const off = (dir * TRAM.speed * t + l * 0.21) % TRAM.spacing;
      const k0 = Math.floor((u0 - W - off) / TRAM.spacing), k1 = Math.ceil((u0 + W - off) / TRAM.spacing);
      for (let k = k0; k <= k1; k++) {
        const uh = k * TRAM.spacing + off;
        if (!deckClear(uh, a, 0.1)) continue;
        for (let c = 0; c < TRAM.cars && n < T.instanceMatrix.count; c++) {
          const u = uh - dir * c * TRAM.pitch / 1000;
          deckMatrix(_m, u, a, 0.2);
          // the kit's car runs along its local z: turn the frame so z is along the ring
          const px = _m.elements[12], py = _m.elements[13], pz = _m.elements[14];
          _m.extractBasis(_x, _y, _z);
          _s.copy(_x).multiplyScalar(dir);
          _x.copy(_z).multiplyScalar(-dir);
          _m.makeBasis(_x, _y, _s).setPosition(px, py, pz);
          T.setMatrixAt(n, _m);
          const lv = LIVERY[k & 3];
          T.instanceColor.setXYZ(n, lv[0], lv[1], lv[2]);
          n++;
        }
      }
    }
    T.count = n;
    T.visible = n > 0;
    if (n) { T.instanceMatrix.needsUpdate = true; T.instanceColor.needsUpdate = true; }
    return n;
  }

  /** Per frame: refill round the camera when it has moved ANCHOR km, move the trams. */
  update(t, camWorld) {
    const u = this.camU(camWorld);
    const key = u === null ? null : Math.round(u / DECK.anchor);
    if (key !== this.key) {
      this.key = key;
      if (key === null) for (const m of this.all) { m.count = 0; m.visible = false; }
      else this.fill(key * DECK.anchor);
    }
    if (key === null) return 0;
    return this.moveTrams(t, u);
  }

  triangles() {
    let n = 0;
    for (const m of this.all) n += (m.geometry.index.count / 3) * m.count;
    return n;
  }
}
