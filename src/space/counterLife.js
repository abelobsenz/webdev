import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { lathe, buildTug } from '../craft/craftClasses.js';
import { createCraftMaterial, updateCraftMaterial } from '../craft/craftMaterial.js';
import { craftMesh, craftPart, addLamps, CRAFT_FRAME } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { yardAxes } from './releaseYard.js';

// The counterweight as a working town (metres, the rock's frame: +Y up the tether, away from
// the Earth; the tether arrives along -Y). Added to the works of src/space/stations.js:
//
//  - surface settlements on surveyed platforms: habitat terraces with lit windows, smelting
//    halls under solar-furnace mirrors, volatiles tank farms and landing pads, each on legs
//    that reach the actual faceted rock (raycast per leg), kept clear of mines, the tether
//    terminal, the pole mast, the cradles, the conveyors and the release yard's spar;
//  - Twinwheel: two counter-rotating habitat wheels round the tether below the terminal,
//    3.6 km rims turning at a true 1 g, on bearings on a fixed four-post stem (their angular
//    momentum cancels, so the station does not precess);
//  - ore capsules running out along every conveyor's rail, and tugs working round the stem.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const toY = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

export const WHEELS = [
  { y: -17200, spin: 1 },
  { y: -18800, spin: -1 },
];
export const WHEEL = { rimIn: 3370, rimOut: 3630, halfAxial: 90, hubIn: 950, hubOut: 1100, stemR: 800, stemTube: 30, bearingOut: 940, spokes: 6, g: 9.81 };
export const wheelOmega = () => Math.sqrt(WHEEL.g / WHEEL.rimOut);          // rad/s for 1 g on the rim floor
export const STEM = { top: -15000, bottom: -19500, bore: 320 };   // bore: clear of the climbers (<= 201 m off the axis)
export const TUGS = { n: 8, r: 5000, yMin: -16300, yMax: -14700 };
export const CAPSULE = { spacing: 260, speed: 14, lift: 216 };

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function latheY(B, x, y, z, prof, seg = 16, closed = false) {
  B.push(new THREE.Matrix4().makeTranslation(x, y, z).multiply(toY));
  lathe(B, prof, seg, 0, { closedProfile: closed });
  B.pop();
}
/** Shortest distance from point p to segment ab. */
export function segDist(p, a, b) {
  const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

/** Keep-out segments (metres, rock frame) that no settlement may come near. */
export function counterKeepOuts(works) {
  const segs = [];
  for (const c of works.conveyors) segs.push({ a: c.start, b: c.end, r: c.radius + 250 });
  for (let k = 0; k < 6; k++) {
    // the six cradles from the terminal to the inhabited ring (stations.js buildCounterworks)
    const a = (k / 6) * TAU + 0.26, d = V(Math.cos(a), 0, Math.sin(a));
    const lower = d.clone().multiplyScalar(1200).setY(-13500), knee = d.clone().multiplyScalar(12800).setY(-11800), upper = d.clone().multiplyScalar(15000);
    segs.push({ a: lower, b: knee, r: 600 }, { a: knee, b: upper, r: 600 });
  }
  const { E } = yardAxes();
  segs.push({ a: E.clone().multiplyScalar(9000), b: E.clone().multiplyScalar(40000), r: 2600 });
  segs.push({ a: V(0, -16000, 0), b: V(0, -6000, 0), r: 2200 });          // tether terminal
  segs.push({ a: V(0, 6000, 0), b: V(0, 17000, 0), r: 1500 });            // pole mast and radiators
  for (const m of works.mines) segs.push({ a: m.surface.clone().multiplyScalar(0.8), b: m.deck.clone().addScaledVector(m.direction, 1200), r: 1900 });
  return segs;
}

// ------------------------------------------------------------ settlements ----
function habBlock(B, lamps, r) {
  // stepped terraces of pressure modules, their glazed faces toward the settlement's court
  const tiers = 3 + Math.floor(r() * 3);
  for (let t = 0; t < tiers; t++) {
    const w = 520 - t * 80, d = 300 - t * 40, y = 60 + t * 70;
    B.box(0, y + 30, 0, w, 60, d, CK.GLASS);
    B.box(0, y + 62, 0, w + 6, 4, d + 6, CK.BRONZE);
    B.box(0, y + 65, 0, w - 40, 2, d - 30, CK.GARDEN);
  }
  for (const x of [-280, 280]) {
    B.box(x, 180, 0, 40, 300, 40, CK.HULL);
    B.box(x + Math.sign(x) * 60, 220, 0, 80, 220, 4, CK.RADIATOR);
  }
  latheY(B, 0, 60 + tiers * 70, 0, [[0.1, 0, CK.BRONZE], [60, 0, CK.BRONZE], [56, 18, CK.CONSERVATORY], [30, 40, CK.CONSERVATORY], [0.1, 46, CK.BRONZE]], 20);
  lamps.push({ p: V(0, 60 + tiers * 70 + 56, 0), r: 12, color: LAMP.AMBER, i: 2.4, breathe: 0.3 });
  for (const s of [-1, 1]) lamps.push({ p: V(s * 270, 70, 160), r: 8, color: LAMP.WHITE, i: 1.8 });
}
function smelter(B, lamps, r) {
  // long casting halls, the furnace slot glowing, fed by a solar mirror array on a mast
  for (const z of [-120, 120]) {
    B.box(0, 110, z, 560, 100, 160, CK.HULL);
    B.box(0, 150, z + Math.sign(z) * 81, 520, 14, 2, CK.LANTERN);
    for (let x = -240; x <= 240; x += 80) B.box(x, 164, z, 60, 8, 150, CK.PANEL);
  }
  B.box(0, 90, 0, 140, 60, 80, CK.DARK);
  B.tube([V(0, 60, 0), V(0, 520, 0)], 26, 10, CK.HULL);
  // the concentrator: a faceted dish of mirrors facing the Sun's mean direction (+x in site frame)
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    B.at(10, 540 + j * 44, i * 44, 0, 0, Math.PI / 2 - 0.08 * j);
    B.push(new THREE.Matrix4().makeRotationX(0.08 * i));
    B.box(0, 0, 0, 40, 2, 40, CK.PANEL);
    B.pop(); B.pop();
  }
  lamps.push({ p: V(0, 660, 0), r: 12, color: LAMP.RED, i: 2.8, breathe: 0.5 });
  lamps.push({ p: V(290, 130, 0), r: 10, color: LAMP.AMBER, i: 2.4 });
}
function tankFarm(B, lamps, r) {
  // volatiles won from the rock: water, ammonia, methane in spheres on a pipe-racked apron
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const x = -200 + (i % 3) * 200, z = i < 3 ? -110 : 110, rad = 60 + r() * 25;
    latheY(B, x, 60, z, [[0.1, 0, CK.DARK], [rad * 0.6, 0, CK.DARK], [rad * 0.6, 20, CK.BRONZE]], 14);
    B.push(new THREE.Matrix4().makeTranslation(x, 80 + rad, z));
    lathe(B, Array.from({ length: 9 }, (_, k) => { const a = -Math.PI / 2 + (k / 8) * Math.PI; return [Math.max(0.1, Math.cos(a) * rad), Math.sin(a) * rad, k === 4 ? CK.BRONZE : CK.HULL]; }), 20);
    B.pop();
    pts.push(V(x, 80 + rad, z));
  }
  for (let i = 0; i < 2; i++) B.tube([pts[i * 3].clone().setY(95), pts[i * 3 + 2].clone().setY(95)], 8, 8, CK.CONDUIT);
  B.tube([V(0, 95, -110), V(0, 95, 110)], 8, 8, CK.CONDUIT);
  lamps.push({ p: V(0, 260, 0), r: 10, color: LAMP.AMBER, i: 2.0, breathe: 0.4 });
}
function landingField(B, lamps, r) {
  // three pads with lit rims, a control tower, a hangar
  for (let i = 0; i < 3; i++) {
    const x = -220 + i * 220;
    latheY(B, x, 60, 60, [[0.1, 0, CK.DECK], [90, 0, CK.DECK], [90, 6, CK.BRONZE], [0.1, 6, CK.DECK]], 24);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; lamps.push({ p: V(x + Math.cos(a) * 92, 70, 60 + Math.sin(a) * 92), r: 5, color: i === 1 ? LAMP.GREEN : LAMP.AMBER, i: 2.6, breathe: 0.5, phase: k / 6 }); }
  }
  B.box(0, 120, -170, 380, 120, 120, CK.HULL);
  B.box(0, 130, -109, 340, 90, 2, CK.LANTERN);
  B.tube([V(260, 60, -170), V(260, 300, -170)], 16, 10, CK.HULL);
  latheY(B, 260, 300, -170, [[16, 0, CK.BRONZE], [34, 6, CK.GLASS], [34, 30, CK.GLASS], [20, 40, CK.BRONZE], [0.1, 44, CK.DARK]], 18);
  lamps.push({ p: V(260, 352, -170), r: 8, color: LAMP.WHITE, i: 3.0, breathe: 0.6 });
}
const SITE_KINDS = [habBlock, smelter, tankFarm, landingField, habBlock];

/**
 * Settlements seated on the rock. surfaceRadius(dir) returns the rock's radius in metres along a
 * direction (a raycast on the actual mesh). Each site stands on a 700 m platform on legs.
 */
export function buildSettlements(surfaceRadius, works, { count = 22, seed = 5 } = {}) {
  const B = new CB(), lamps = [], sites = [], legs = [];
  const r = mulberry(seed);
  const keep = counterKeepOuts(works);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const N = 64;
  for (let i = 0; i < N && sites.length < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / N, rad = Math.sqrt(1 - y * y), a = i * golden;
    const d = V(Math.cos(a) * rad, y, Math.sin(a) * rad);
    const sr = surfaceRadius(d);
    const centre = d.clone().multiplyScalar(sr + 300);
    if (keep.some((s) => segDist(centre, s.a, s.b) < s.r + 900)) continue;
    // site frame: y along the radial, a seeded yaw
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), r() * TAU));
    const m0 = new THREE.Matrix4().compose(d.clone().multiplyScalar(sr), q, V(1, 1, 1));
    const inv0 = m0.clone().invert();
    // legs: find the actual ground under each corner (a ray along its radial); the platform
    // sits 40 m over the highest of them
    const corners = [[-330, -200], [330, -200], [-330, 200], [330, 200], [0, 0]];
    const ground = corners.map(([x, z]) => {
      const p = V(x, 0, z).applyMatrix4(m0), dir = p.clone().normalize();
      const rr = surfaceRadius(dir);
      return { dir, rr, local: dir.clone().multiplyScalar(rr).applyMatrix4(inv0) };
    });
    const hi = Math.max(...ground.map((g) => g.local.y));
    const deckY = hi + 40;
    const m = m0.clone();
    B.push(m);
    B.box(0, deckY + 10, 0, 760, 20, 480, CK.DECK);
    B.box(0, deckY - 6, 0, 740, 12, 460, CK.HULL);
    ground.slice(0, 4).forEach((g, k) => {
      const { x, y, z } = g.local;
      const foot = V(x, y - 30, z), top = V(x, deckY - 12, z);
      B.tube([foot, top], 22, 8, CK.BRONZE);
      B.box(x, y - 4, z, 90, 30, 90, CK.DARK);
      legs.push({ site: sites.length, contact: g.dir.clone().multiplyScalar(g.rr), foot: foot.clone().applyMatrix4(m), top: top.clone().applyMatrix4(m), dir: g.dir.clone(), rr: g.rr });
    });
    // the kind builders stand on y = 60: lift them onto the platform's top (deckY + 20)
    const lift = new THREE.Matrix4().makeTranslation(0, deckY - 40, 0);
    B.push(lift);
    const kind = sites.length % SITE_KINDS.length;
    const kindLamps = [];
    SITE_KINDS[kind](B, kindLamps, r);
    B.pop();
    const siteLamps = kindLamps.map((l) => ({ ...l, p: l.p.clone().applyMatrix4(lift) }));
    // platform edge lights
    for (const [x, z] of corners.slice(0, 4)) siteLamps.push({ p: V(x * 1.14, deckY + 24, z * 1.2), r: 7, color: LAMP.AMBER, i: 2.0, breathe: 0.3, phase: r() });
    for (const l of siteLamps) lamps.push({ ...l, p: l.p.clone().applyMatrix4(m) });
    B.pop();
    sites.push({ dir: d, centre: V(0, deckY + 200, 0).applyMatrix4(m), radius: 760, kind: SITE_KINDS[kind].name, deckY, surface: sr });
  }
  return { geo: B.geometry(), lamps, sites, legs, keepOuts: keep };
}

// ------------------------------------------------------------ Twinwheel ----
/** The fixed stem and bearing rings of the wheels. */
export function buildStem() {
  const B = new CB(), lamps = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + TAU / 8, c = Math.cos(a) * WHEEL.stemR, s = Math.sin(a) * WHEEL.stemR;
    B.tube([V(c, STEM.top, s), V(c, STEM.bottom, s)], WHEEL.stemTube, 10, CK.HULL);
  }
  for (let y = STEM.top - 300; y > STEM.bottom; y -= 600) {
    B.push(new THREE.Matrix4().makeTranslation(0, y, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    B.torus(WHEEL.stemR, 14, 40, 6, CK.BRONZE);
    B.pop();
  }
  for (const w of WHEELS) {
    // bearing collar: fixed ring hugging the posts, the rotating hub rides just outside it
    latheY(B, 0, w.y, 0, [[WHEEL.stemR - 40, -70, CK.DARK], [WHEEL.bearingOut, -60, CK.BRONZE], [WHEEL.bearingOut, 60, CK.BRONZE], [WHEEL.stemR - 40, 70, CK.DARK]], 48, true);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; lamps.push({ p: V(Math.cos(a) * (WHEEL.bearingOut + 4), w.y + 64, Math.sin(a) * (WHEEL.bearingOut + 4)), r: 10, color: LAMP.TEAL, i: 2.2, breathe: 0.4, phase: k / 8 }); }
  }
  // the stem's foot: an open ring (the tether and its climbers pass through its bore)
  latheY(B, 0, STEM.bottom, 0, [[STEM.bore, -120, CK.DARK], [700, -60, CK.HULL], [WHEEL.stemR + 60, 0, CK.BRONZE], [WHEEL.stemR + 60, 40, CK.BRONZE], [WHEEL.stemR - 60, 60, CK.HULL], [STEM.bore, 60, CK.HULL]], 40, true);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; lamps.push({ p: V(Math.cos(a) * 500, STEM.bottom - 130, Math.sin(a) * 500), r: 20, color: LAMP.WHITE, i: 3.0, breathe: 0.5, phase: k / 4 }); }
  return { geo: B.geometry(), lamps };
}

/** One habitat wheel (centred on its hub, axis +y). */
export function buildWheel() {
  const B = new CB(), lamps = [];
  const { rimIn, rimOut, halfAxial: h, hubIn, hubOut } = WHEEL;
  // hub ring (rotating), riding outside the fixed bearing collar
  latheY(B, 0, 0, 0, [[hubIn, -80, CK.HULL], [hubOut, -80, CK.BRONZE], [hubOut, 80, CK.BRONZE], [hubIn, 80, CK.HULL]], 48, true);
  // the rim: floor outermost (spin gravity), glazed side galleries, a lit inner arcade
  const prof = [[rimIn, -h, CK.HULL], [rimOut - 20, -h, CK.HULL], [rimOut, -h + 20, CK.BRONZE], [rimOut, h - 20, CK.HULL], [rimOut - 20, h, CK.BRONZE], [rimIn + 40, h, CK.GLASS], [rimIn, h - 30, CK.LANTERN], [rimIn, -h + 30, CK.GLASS]];
  latheY(B, 0, 0, 0, prof, 180, true);
  // side windows: glazed bands on both faces, and bulkhead frames every 10 degrees
  for (const s of [-1, 1]) latheY(B, 0, s * (h + 1), 0, [[rimIn + 70, 0, CK.GLASS], [rimOut - 60, 0, CK.GLASS], [rimOut - 60, s * 2, CK.GLASS], [rimIn + 70, s * 2, CK.GLASS]], 180, true);
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * TAU;
    B.push(new THREE.Matrix4().makeRotationY(-a));
    B.box((rimIn + rimOut) / 2, 0, 0, rimOut - rimIn + 10, 2 * h + 10, 16, CK.BRONZE);
    B.pop();
  }
  // spokes with lift shafts, and radiators on their trailing faces
  for (let k = 0; k < WHEEL.spokes; k++) {
    const a = (k / WHEEL.spokes) * TAU, c = Math.cos(a), s = Math.sin(a);
    B.tube([V(c * hubOut, 0, s * hubOut), V(c * rimIn, 0, s * rimIn)], 42, 12, CK.HULL);
    B.tube([V(c * hubOut, 46, s * hubOut), V(c * rimIn, 46, s * rimIn)], 8, 6, CK.LANTERN);
    B.push(new THREE.Matrix4().makeRotationY(-a));
    B.box((hubOut + rimIn) / 2, -110, 0, (rimIn - hubOut) * 0.7, 120, 4, CK.RADIATOR);
    B.box((hubOut + rimIn) / 2, -46, 0, (rimIn - hubOut) * 0.7, 8, 8, CK.CONDUIT);
    B.pop();
    lamps.push({ p: V(c * (rimOut + 12), 0, s * (rimOut + 12)), r: 16, color: k % 2 ? LAMP.RED : LAMP.GREEN, i: 2.6, breathe: 0.3, phase: k / 6 });
  }
  for (let k = 0; k < 24; k++) { const a = ((k + 0.5) / 24) * TAU; lamps.push({ p: V(Math.cos(a) * (rimIn - 6), 0, Math.sin(a) * (rimIn - 6)), r: 9, color: LAMP.AMBER, i: 1.8, breathe: 0.2, phase: k / 24 }); }
  return { geo: B.geometry(), lamps };
}

function buildCapsule() {
  const B = new CB();
  B.box(0, 0, 0, 22, 18, 40, CK.BRONZE);
  B.box(0, 9.5, 0, 18, 1, 36, CK.DARK);
  B.box(0, -10, 0, 8, 2, 30, CK.HULL);
  B.box(0, 0, 20.3, 16, 8, 0.6, CK.LANTERN);
  return B.geometry();
}

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _d = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);

export class CounterLife {
  /** parent: the counterweight mesh (km); works: buildCounterworks' data; surfaceRadius from the rock. */
  constructor(parent, works, surfaceRadius) {
    const t0 = performance.now();
    this.works = works;
    this.mat = createCraftMaterial({ accent: [1.0, 0.7, 0.42], lit: 0.66 });
    this.settle = buildSettlements(surfaceRadius, works);
    this.mesh = craftMesh(this.settle.geo, {}, this.mat);
    addLamps(this.mesh, this.settle.lamps, { minPx: 1.2 });
    parent.add(this.mesh);
    const stem = buildStem();
    this.stem = craftPart(this.mesh, stem.geo);
    addLamps(this.stem, stem.lamps, { minPx: 1.2 });
    this.mesh.add(this.stem);
    const wheel = buildWheel();
    this.wheelGeo = wheel.geo;
    this.wheels = WHEELS.map((w) => {
      const m = craftPart(this.mesh, wheel.geo);
      m.position.set(0, w.y, 0);
      addLamps(m, wheel.lamps, { minPx: 1.2 });
      this.mesh.add(m);
      return m;
    });
    // conveyors: capsules on each belt's rail, outbound from the mine
    this.belts = works.conveyors.map((c) => {
      const dir = c.end.clone().sub(c.start), len = dir.length();
      dir.normalize();
      const lift = V(0, CAPSULE.lift, 0);
      return { start: c.start.clone().add(lift), dir, len, n: Math.floor(len / CAPSULE.spacing), q: new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir) };
    });
    const nCaps = this.belts.reduce((s, b) => s + b.n, 0);
    const inst = (geo, n) => {
      const im = new THREE.InstancedMesh(geo, this.mat, n);
      im.frustumCulled = false; im.renderOrder = 3;
      im.onBeforeRender = this.mesh.onBeforeRender;
      this.mesh.add(im);
      return im;
    };
    this.capsules = inst(buildCapsule(), Math.max(nCaps, 1));
    this.tugs = inst(buildTug(80).geo, TUGS.n);
    this.omega = wheelOmega();
    this.buildMs = performance.now() - t0;
    this.update(0);
  }

  wheelAngle(i, t) { return WHEELS[i].spin * this.omega * t; }
  tugPose(i, t, out) {
    const a = (i / TUGS.n) * TAU + t * (0.004 + 0.0007 * (i % 3)) * (i % 2 ? 1 : -1);
    const y = (TUGS.yMin + TUGS.yMax) / 2 + ((TUGS.yMax - TUGS.yMin) / 2) * Math.sin(t * 0.01 + i * 1.3);
    return out.set(Math.cos(a) * TUGS.r, y, Math.sin(a) * TUGS.r);
  }

  update(t) {
    for (let i = 0; i < this.wheels.length; i++) this.wheels[i].rotation.y = this.wheelAngle(i, t) % TAU;
    let n = 0;
    for (const b of this.belts) {
      const shift = (t * CAPSULE.speed) % CAPSULE.spacing;
      for (let k = 0; k < b.n; k++) {
        const s = k * CAPSULE.spacing + shift;
        if (s > b.len) continue;
        _p.copy(b.start).addScaledVector(b.dir, s);
        this.capsules.setMatrixAt(n++, _m.compose(_p, b.q, _s));
      }
    }
    this.capsules.count = n;
    this.capsules.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < TUGS.n; i++) {
      this.tugPose(i, t, _p);
      this.tugPose(i, t + 1, _d).sub(_p).normalize();
      _q.setFromUnitVectors(_y.set(0, 0, 1), _d);
      this.tugs.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.tugs.instanceMatrix.needsUpdate = true;
  }
}
