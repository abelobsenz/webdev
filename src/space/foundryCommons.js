import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { buildTug } from '../craft/craftClasses.js';
import { craftMesh, addLamps } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { craftInstances, MovingLamps } from './helianthDistrict.js';
import { radiatorWing, mast, dish } from './shipKit.js';
import { droneGeo } from './lifeKit.js';

// The Foundry Commons: the town the foundry's people live in, north of the garden wheel
// (foundry metres, +Z north, the receiving bays and every tender approach lie to the south).
//
// A pressurised high street runs north from the wheel's hub tube, 1.3 km below the wheel,
// to a harbour pier 10 km on. Along it stand the tenements: glazed blocks four to nine
// storeys of rooms deep with lit windows, their roofs gardens under glass, balconies and
// gantries railed at people height, hatches and airlocks, rooftop beacons and signage
// lanterns. Between them bridges cross the street; east and west the forge's heat leaves
// through two radiator fans, edge-on to the Sun and glowing dull red at their roots; a
// cooling stack of the anneal works breathes above the street's middle. Floodlight masts
// light the pier, where a tug lies berthed.
// Life: trams run the street's two tracks, drones ply between blocks, the pier lamps sweep.
//
// Built lazily on approach (build()), hidden beyond 400 km.

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TO_Y = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

export const COMMONS = {
  street: { y: -1300, z0: 6400, z1: 16200, r: 210 },
  track: { y: -1071, x: 50 },                      // tram origin height (bogies on the rails) and the two tracks' offset
  blocks: { z0: 8800, z1: 15600, pitch: 560, gap: 180, depth: 380 },
  pier: { z: 16200, len: 1800 },
  fans: { z: 11250, x0: 3400, span: 3600 },
  stack: { z: 11950, r: 380, h: 2600 },
  range: 400,                                       // km
  trams: 6, tramT: 260, drones: 14,
};

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** Tenement layout: [{ x, z, w (x), d (z), h (storeys) , side }] either side of the street. */
export function commonsBlocks() {
  const r = rng(907), out = [];
  const { z0, z1, pitch, depth } = COMMONS.blocks;
  for (const side of [-1, 1]) for (let z = z0; z <= z1; z += pitch) {
    if (z > 11000 && z < 12500) continue;   // the anneal stack's plaza and the fans' headers
    const w = 380 + 200 * r(), h = 6 + Math.floor(r() * 7), d = depth * (0.8 + 0.3 * r());
    const x0 = COMMONS.street.r + 60;
    out.push({ x: side * (x0 + w / 2), z, w, d, h, side, seed: r(), tier: 0 });
    // the back row, lower, across a lane from the front row
    const w2 = 300 + 160 * r(), h2 = 3 + Math.floor(r() * 4);
    out.push({ x: side * (x0 + w + COMMONS.blocks.gap + w2 / 2), z: z + (r() - 0.5) * 60, w: w2, d: d * 0.9, h: h2, side, seed: r(), tier: 1 });
  }
  return out;
}
const STOREY = 42;           // a storey of rooms, including its slab (m)
export const blockBase = () => COMMONS.street.y - 140;     // blocks stand on the street's footing plinths
export const COMMONS_CRUISE = COMMONS.street.y - 140 + 60 + 12 * 42 + 200;   // above the tallest roof (twelve storeys)
export const BRIDGE_Y = -975;                    // street bridges: clear over the trams (their roofs at -1038)

/** The fixed town (metres, foundry frame). */
export function buildCommons() {
  const B = new CB(), lamps = [];
  const { street, track, pier, fans, stack } = COMMONS;
  // the high street: a pressurised tube with glazed clerestories, rib frames every 200 m
  B.tube([V(0, street.y, street.z0), V(0, street.y, street.z1)], street.r, 20, CK.HULL);
  for (let z = street.z0 + 200; z < street.z1; z += 200) {
    B.push(new THREE.Matrix4().makeTranslation(0, street.y, z));
    B.torus(street.r + 10, 14, 24, 5, z % 1000 === 0 ? CK.BRONZE : CK.DARK);
    B.pop();
  }
  for (const s of [-1, 1]) B.box(s * street.r * 0.62, street.y + street.r * 0.74, (street.z0 + street.z1) / 2, 60, 14, street.z1 - street.z0 - 200, CK.GLASS);
  // the tramway along its crown: a deck on a keel seated in the tube, two rails, cross ribs
  const yt = street.y + street.r, zm = (street.z0 + street.z1) / 2, zl = street.z1 - street.z0 - 100;
  B.box(0, yt, zm, 180, 12, zl, CK.DECK);
  B.box(0, yt - 15, zm, 110, 30, zl, CK.DARK);
  for (const s of [-1, 1]) B.box(s * track.x, yt + 10, zm, 12, 8, zl, CK.BRONZE);
  for (let z = street.z0 + 110; z < street.z1 - 60; z += 120) B.box(0, yt + 7, z, 176, 2, 10, CK.DARK);
  // the crossovers at the termini, where the loop changes track
  for (const [zA, zE] of [[street.z1 - 500, street.z1 - 350], [street.z0 + 500, street.z0 + 350]]) B.tube([V(track.x, yt + 10, zA), V(0, yt + 10, zE), V(-track.x, yt + 10, zA)], 5, 6, CK.BRONZE);
  // the wheel's hub tube meets the street at its south end: a collar
  B.at(0, street.y, street.z0); B.lathe([[street.r + 60, -60, CK.BRONZE], [street.r + 80, 0, CK.HULL], [street.r + 60, 60, CK.BRONZE]], 20, 0, { closedProfile: false }); B.pop();
  // tenements
  const blocks = commonsBlocks();
  for (const b of blocks) {
    const base = blockBase(), H = b.h * STOREY, top = base + 60 + H;
    // footing plinth tied to the street's flank
    B.box(b.x, base + 30, b.z, b.w + 40, 60, b.d + 40, CK.DARK);
    B.box(b.side * (street.r + 30), street.y - 60, b.z, 120, 100, 160, CK.BRONZE);
    // the block: glazed faces, plate ends; a set-back upper floor on the taller ones
    const up = b.h > 6 ? 2 : 0, lowH = (b.h - up) * STOREY;
    B.box(b.x, base + 60 + lowH / 2, b.z, b.w, lowH, b.d, CK.GLASS);
    for (const s of [-1, 1]) B.box(b.x + b.side * b.w * 0.2, base + 60 + lowH / 2, b.z + s * (b.d / 2 + 6), b.w * 0.3, lowH, 12, CK.HULL);   // stair cores on the ends
    if (up) B.box(b.x - b.side * b.w * 0.12, base + 60 + lowH + up * STOREY / 2, b.z, b.w * 0.7, up * STOREY, b.d * 0.75, CK.GLASS);
    // slab edges every storey: balconies with a people-height rail on the street face
    const face = b.x - b.side * b.w / 2;
    for (let k = 1; k < b.h - up; k++) {
      const y = base + 60 + k * STOREY;
      B.box(face - b.side * 5, y, b.z, 10, 1.2, b.d, CK.DECK);
      B.box(face - b.side * 9.5, y + 1.1, b.z, 0.3, 0.3, b.d, CK.BRONZE);
      for (let z = -b.d / 2; z <= b.d / 2; z += 30) B.box(face - b.side * 9.5, y + 0.55, b.z + z, 0.3, 1.1, 0.3, CK.DARK);
    }
    // roof garden under glass, its lantern rim, a beacon and a sign lantern
    const roofY = up ? base + 60 + H : top;
    B.box(b.x, roofY + 10, b.z, b.w * (up ? 0.66 : 0.94), 20, b.d * (up ? 0.7 : 0.94), CK.ROOF);
    B.box(b.x, roofY + 22, b.z - b.d * 0.47, b.w * 0.9, 4, 4, CK.LANTERN);
    B.box(face - b.side * 3, base + 60 + lowH * 0.72, b.z + b.d * 0.35, 6, 60, 110, CK.LANTERN);
    lamps.push({ p: V(b.x + b.side * b.w * 0.4, roofY + 40, b.z + b.d * 0.4), r: 8, color: b.seed < 0.5 ? LAMP.RED : LAMP.AMBER, i: 2.2, breathe: 0.6, phase: b.seed });
    lamps.push({ p: V(face - b.side * 10, base + 60 + lowH * 0.72, b.z + b.d * 0.35), r: 14, color: b.seed < 0.33 ? LAMP.TEAL : b.seed < 0.66 ? LAMP.AMBER : LAMP.WHITE, i: 1.6 });
    // airlock hatches on the ends, with their door lamps
    for (const s of [-1, 1]) {
      B.box(b.x, base + 90, b.z + s * (b.d / 2 + 8), 40, 50, 16, CK.DARK);
      lamps.push({ p: V(b.x, base + 124, b.z + s * (b.d / 2 + 18)), r: 3, color: LAMP.GREEN, i: 1.4 });
    }
    // service conduits down the back
    B.tube([V(b.x + b.side * b.w / 2 + 12, base + 60, b.z - b.d * 0.3), V(b.x + b.side * b.w / 2 + 12, roofY, b.z - b.d * 0.3)], 5, 6, CK.CONDUIT);
  }
  // bridges across the street between facing blocks every other pitch: a glazed gallery
  const west = blocks.filter((b) => b.side < 0 && !b.tier), east = blocks.filter((b) => b.side > 0 && !b.tier);
  // lane bridges from each back-row block to its front-row neighbour
  for (let i = 0; i + 1 < blocks.length; i += 2) {
    const f = blocks[i], k = blocks[i + 1], y = blockBase() + 60 + 2.5 * STOREY;
    const xa = f.x + f.side * f.w / 2, xb = k.x - k.side * k.w / 2;
    B.box((xa + xb) / 2, y, (f.z + k.z) / 2, Math.abs(xb - xa) + 20, 20, 24, CK.GLASS);
    B.box((xa + xb) / 2, y - 11, (f.z + k.z) / 2, Math.abs(xb - xa) + 20, 2, 30, CK.BRONZE);
  }
  west.forEach((w, i) => {
    const e = east[i]; if (!e || i % 2 || Math.min(w.h, e.h) < 9) return;
    const y = BRIDGE_Y;
    const x0 = w.x + w.w / 2, x1 = e.x - e.w / 2;
    B.box((x0 + x1) / 2, y, w.z, x1 - x0, 24, 30, CK.GLASS);
    B.box((x0 + x1) / 2, y - 13, w.z, x1 - x0, 3, 36, CK.BRONZE);
  });
  // the anneal works' cooling stack on its plaza, glowing at the throat
  const plaza = street.y - street.r - 70;   // (the plaza deck's centre, under the street tube)
  B.box(0, plaza, stack.z, 2900, 60, 1000, CK.DECK);
  for (let k = -3; k <= 3; k++) B.box(0, plaza + 30 + (street.y - street.r - plaza - 30) / 2 + 5, stack.z + k * 140, 50, street.y - street.r - plaza - 20, 50, CK.BRONZE);   // posts up to the street's keel
  for (const s of [-1, 1]) {
    B.at(s * 900, plaza + 30, stack.z); B.push(TO_Y);
    B.lathe([[stack.r, 0, CK.HULL], [stack.r * 0.82, stack.h * 0.45, CK.HULL], [stack.r * 0.7, stack.h * 0.7, CK.BRONZE], [stack.r * 0.78, stack.h, CK.LANTERN], [stack.r * 0.7, stack.h, CK.DARK]], 24, 0, { closedProfile: false });
    B.pop(); B.pop();
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; B.tube([V(s * 900 + Math.cos(a) * stack.r * 1.25, plaza + 30, stack.z + Math.sin(a) * stack.r * 1.25), V(s * 900 + Math.cos(a) * stack.r * 0.9, street.y + stack.h * 0.3, stack.z + Math.sin(a) * stack.r * 0.9)], 14, 5, CK.DARK); }
    lamps.push({ p: V(s * 900, plaza + 30 + stack.h + 30, stack.z), r: 24, color: LAMP.RED, i: 2.6, breathe: 0.9, phase: s > 0 ? 0 : 0.5 });
    // pipe runs from the stack's foot into the street
    B.tube([V(s * 900, street.y - 60, stack.z - stack.r), V(s * 500, street.y - 60, stack.z - 300), V(s * (street.r + 10), street.y - 60, stack.z - 300)], 36, 8, CK.BRONZE);
  }
  // radiator fans east and west (the forge's heat): vertical fins fanned off their headers
  for (const s of [-1, 1]) {
    B.tube([V(s * (street.r - 20), street.y, fans.z), V(s * fans.x0, street.y, fans.z)], 90, 10, CK.HULL);
    for (let k = 0; k < 5; k++) {
      const a = (k - 2) * 0.22;
      radiatorWing(B, V(s * fans.x0, street.y, fans.z + (k - 2) * 60), V(s * Math.cos(a), 0, Math.sin(a)), V(0, 0, 1).applyAxisAngle(V(0, 1, 0), s * a), fans.span, 420, lamps, s > 0 ? LAMP.GREEN : LAMP.RED);
    }
    B.box(s * fans.x0, street.y, fans.z, 260, 260, 520, CK.BRONZE);
  }
  // the harbour pier: a deck on the street's end, two berths, floodlight masts, a dish
  const pz = pier.z;
  B.at(0, street.y, pz); B.lathe([[street.r, -40, CK.HULL], [street.r * 1.6, 60, CK.BRONZE], [street.r * 1.6, 200, CK.HULL], [street.r * 1.1, 320, CK.DARK]], 20); B.pop();
  B.box(0, street.y - 200, pz + pier.len / 2, 900, 40, pier.len, CK.DECK);
  for (const s of [-1, 1]) {
    B.box(s * 452, street.y - 186, pz + pier.len / 2, 4, 4, pier.len, CK.BRONZE);   // edge rail
    for (let z = 0; z <= pier.len; z += 40) B.box(s * 452, street.y - 191, pz + z, 1, 14, 1, CK.DARK);
    for (let k = 0; k < 4; k++) lamps.push({ p: V(s * 440, street.y - 170, pz + 200 + k * 450), r: 6, color: LAMP.AMBER, i: 1.8, breathe: 0.2, phase: k / 4 });
    // berth clamps
    B.box(s * 300, street.y - 120, pz + 1300, 120, 120, 300, CK.BRONZE);
    const tip = mast(B, V(s * 420, street.y - 180, pz + pier.len - 80), V(0, 1, 0), 340, 4);
    lamps.push({ p: tip.clone().setY(tip.y + 10), r: 20, color: LAMP.WHITE, i: 3.2, dir: V(-s * 0.3, -1, -0.4).normalize() });
  }
  dish(B, V(0, street.y + street.r + 30, pz + 120), V(0, 0.6, 0.8).normalize(), 110);
  return { geo: B.geometry(), lamps, blocks };
}

/** A tram car (metres, +Z along the street): 120 m, glazed, on its bogies. */
export function buildTram() {
  const B = new CB();
  B.box(0, 16, 0, 26, 24, 120, CK.GLASS);
  B.box(0, 30, 0, 24, 5, 116, CK.ROOF);
  B.box(0, 3, 0, 22, 6, 112, CK.DARK);
  for (const z of [-44, 44]) B.box(0, -2, z, 18, 6, 18, CK.BRONZE);
  for (const z of [-61, 61]) B.box(0, 16, z, 20, 18, 2, CK.LANTERN);
  return B.geometry();
}
/** The tram loop: north on the east track, south on the west, crossing over at the termini. */
const tramU = (k, t) => (((t / COMMONS.tramT) + k / COMMONS.trams) % 1 + 1) % 1;
const TRAM_L = () => COMMONS.street.z1 - COMMONS.street.z0 - 700, CROSS = 150;
/** Tram k at time t: z along the street (metres). */
export function tramZ(k, t) {
  const u = tramU(k, t), s = u < 0.5 ? u * 2 : 2 - u * 2;
  return COMMONS.street.z0 + 350 + TRAM_L() * s;
}
/** Tram k at time t: x across the street (on its track, sliding over at the crossovers). */
export function tramX(k, t) {
  const u = tramU(k, t), s = u < 0.5 ? u * 2 : 2 - u * 2, L = TRAM_L();
  const toEnd = Math.min(s * L, (1 - s) * L), side = u < 0.5 ? 1 : -1;
  return side * COMMONS.track.x * Math.min(1, toEnd / CROSS);
}

/** Drone k at time t (metres): hopping between block roofs across the street. */
export function commonsDrone(k, t, blocks, out) {
  const n = blocks.length, T = 70 + (k % 5) * 9, c = Math.floor(t / T + k * 0.37), u = t / T + k * 0.37 - c;
  const a = blocks[(c * 7 + k * 3) % n], b = blocks[(c * 7 + k * 3 + 5) % n];
  // lift off a roof, cruise above the tallest roof, set down on the other
  const ya = blockBase() + 60 + a.h * STOREY + 60, yb = blockBase() + 60 + b.h * STOREY + 60, yc = COMMONS_CRUISE;
  const sm = (x) => { const c = x < 0 ? 0 : x > 1 ? 1 : x; return c * c * (3 - 2 * c); };
  const e = sm((u - 0.2) / 0.6);
  const y = u < 0.2 ? ya + (yc - ya) * sm(u / 0.2) : u > 0.8 ? yc + (yb - yc) * sm((u - 0.8) / 0.2) : yc;
  out.set(a.x + (b.x - a.x) * e, y, a.z + (b.z - a.z) * e);
  return out;
}

export class FoundryCommons {
  constructor(group) {
    this.group = group;
    this.root = new THREE.Group(); this.root.scale.setScalar(0.001); this.root.visible = false; group.add(this.root);
    this.built = false; this.buildMs = 0;
    this._m = new THREE.Matrix4(); this._p = V(); this._q = new THREE.Quaternion(); this._s = V(1, 1, 1);
  }
  build() {
    if (this.built) return;
    const t0 = performance.now();
    const opt = { accent: [1, 0.66, 0.36], lit: 0.72, fill: 0.09, scale: 1 };
    this.data = buildCommons();
    const m = craftMesh(this.data.geo, opt);
    addLamps(m, this.data.lamps, { minPx: 1.2 });
    this.root.add(m);
    this.mesh = m;
    this.trams = craftInstances(buildTram(), Array.from({ length: COMMONS.trams }, () => new THREE.Matrix4()), opt, m.material);
    this.trams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.drones = craftInstances(droneGeo(18), Array.from({ length: COMMONS.drones }, () => new THREE.Matrix4()), opt, m.material);
    this.drones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const tug = buildTug(200);
    this.tug = craftInstances(tug.geo, [new THREE.Matrix4().makeTranslation(0, COMMONS.street.y - 120, COMMONS.pier.z + 1300)], opt, m.material);
    for (const im of [this.trams, this.drones, this.tug]) this.root.add(im);
    this.tramLamps = new MovingLamps(COMMONS.trams * 2, { r: 6, color: LAMP.WHITE, i: 2.4, minPx: 1.1 });
    this.droneLamps = new MovingLamps(COMMONS.drones, { r: 4, color: LAMP.TEAL, i: 2.2, minPx: 1.0 });
    this.root.add(this.tramLamps.mesh, this.droneLamps.mesh);
    this.root.traverse((o) => { o.frustumCulled = false; });
    this.built = true;
    this.buildMs = performance.now() - t0;
    this.animate(0);
  }
  update(t, distKm) {
    const on = distKm < COMMONS.range;
    if (on && !this.built) this.build();
    this.root.visible = on && this.built;
    if (this.root.visible) this.animate(t);
  }
  animate(t) {
    const m = this._m, p = this._p;
    for (let k = 0; k < COMMONS.trams; k++) {
      const z = tramZ(k, t), x = tramX(k, t);
      m.makeTranslation(x, COMMONS.track.y, z);
      this.trams.setMatrixAt(k, m);
      this.tramLamps.set(k * 2, p.set(x, COMMONS.track.y + 16, z + 64));
      this.tramLamps.set(k * 2 + 1, p.set(x, COMMONS.track.y + 16, z - 64));
    }
    this.trams.instanceMatrix.needsUpdate = true; this.tramLamps.commit();
    for (let k = 0; k < COMMONS.drones; k++) {
      commonsDrone(k, t, this.data.blocks, p);
      m.makeTranslation(p.x, p.y, p.z);
      this.drones.setMatrixAt(k, m);
      this.droneLamps.set(k, p.setY(p.y + 8));
    }
    this.drones.instanceMatrix.needsUpdate = true; this.droneLamps.commit();
  }
  triangles() {
    if (!this.built) return 0;
    const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    return tri(this.mesh.geometry) + tri(this.trams.geometry) * this.trams.count + tri(this.drones.geometry) * this.drones.count + tri(this.tug.geometry);
  }
}
