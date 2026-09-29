import * as THREE from 'three';
import { CB } from '../craft/craftGeometry.js';
import { LK, lunarMesh, lunarInstanced, createLunarMaterial } from './lunarMaterial.js';
import { LAMP } from './lamps.js';
import { surfaceY } from './lunarSite.js';
import { kit, seat, seatLocal, mulberry, KIT_R, TRACKER_AXLE } from './lunarKit.js';
import { stationFrame } from './stations.js';
import { addLamps, pixelRadius } from './craftMesh.js';
import { TOWNS } from './moonBake.js';
import { R_MOON } from './sim.js';
import { Path, LunarTraffic, plumeMesh } from './lunarTraffic.js';

// The Moon's other settlements: the towns whose lights the night side shows (moonBake.js
// TOWNS), each a working outpost built where its lights are. Every one is generated from its
// own seed and weight: a core of pressure domes and regolith-shielded vaults round a lit
// square, a landing field with blast berms and craft standing on it, a solar array, a radiator
// farm, a mine with its excavator, spoil and haul road, floodlit masts, service roads with
// rovers running them, and the ground around - boulders and small fresh craters.
//
// Outposts are built on approach (one per frame, the nearest first) and drawn only while a
// few kilometres of them would cover more than a pixel or two. Metres in each outpost's own
// site frame (x west, y up, z north, origin on the sphere under its centre), placed on the
// Moon like Medii Landing is.

const UP = new THREE.Vector3(0, 1, 0);
const DETAIL_KM = 90;
const TAU = Math.PI * 2;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _t = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const LIVERY = [[0.14, 0.26, 0.55], [0.86, 0.82, 0.72], [0.7, 0.2, 0.14], [0.2, 0.45, 0.4], [0.9, 0.6, 0.12]];

/** Moon-frame unit vector of a [lat, lon] (degrees), as the surface shader places its towns. */
export function townDir(lat, lon, out = new THREE.Vector3()) {
  const a = lat * Math.PI / 180, o = lon * Math.PI / 180;
  return out.set(Math.cos(a) * Math.cos(o), Math.sin(a), -Math.cos(a) * Math.sin(o));
}

/**
 * Lay out one outpost (pure data + geometry, no renderer): returns { geo, lamps, inst, plan,
 * loops, radius }. weight (0.3..0.6) scales it; seed makes it its own.
 */
export function buildOutpost(seed, weight = 0.5, lat = 0) {
  const rnd = mulberry(seed * 7919 + 13);
  const B = new CB();
  const lamps = [];
  const plan = [];                                 // { kind, x, z, r } circles (metres)
  const inst = {};
  const put = (part, m, tint) => (inst[part] ||= []).push({ m: m.clone(), tint });
  const gy = (x, z) => surfaceY(x, z);
  const sz = 0.7 + weight;                         // overall scale of the layout
  const free = (x, z, r) => plan.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r);
  const claim = (kind, x, z, r) => { plan.push({ kind, x, z, r }); };
  /** Find a free spot on a ring (angle a0 +- spread) for a circle of radius r. */
  const spot = (r, d0, d1, a0 = rnd() * TAU, spread = TAU) => {
    for (let k = 0; k < 80; k++) {
      const a = a0 + (rnd() - 0.5) * spread, d = d0 + rnd() * (d1 - d0);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (free(x, z, r)) return [x, z, a];
    }
    return null;
  };
  const pushSeat = (x, z, yaw = 0, h = 0) => B.push(seat(_m, x, z, yaw, h));
  /** A flat slab (packed regolith or paving) over a disc, following the sphere. */
  const apron = (x, z, R, top, k, ringK = LK.WALL) => {
    pushSeat(x, z);
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const seg = Math.max(24, Math.round(R / 6));
    B.lathe([[0, -1.2, ringK], [R, -1.2, ringK], [R, top, ringK], [0, top, k]], seg);
    B.pop(); B.pop();
  };
  /** A road of packed regolith between two points (tessellated boxes on the sphere). */
  const road = (a, b, w = 10) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 60));
    const pts = [];
    for (let i = 0; i <= n; i++) { const x = a[0] + (b[0] - a[0]) * i / n, z = a[1] + (b[1] - a[1]) * i / n; pts.push(new THREE.Vector3(x, gy(x, z) + 0.3, z)); }
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[i + 1];
      const m = new THREE.Matrix4().lookAt(p, q, UP).setPosition(p.clone().add(q).multiplyScalar(0.5));
      B.push(m); B.box(0, -0.45, 0, w, 1.5, p.distanceTo(q) + 0.3, LK.GROUND); B.pop();
    }
    return pts;
  };

  // --- the core: domes round a square, vault rows, the square's pylon ---
  const nDomes = 1 + Math.round(weight * 4 * rnd() + weight * 2);
  apron(0, 0, 60 * sz, 0.35, LK.PAVE);
  claim('square', 0, 0, 60 * sz);
  for (let i = 0; i < nDomes; i++) {
    const a = i / nDomes * TAU + rnd() * 0.3, d = 60 * sz + 50;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!free(x, z, KIT_R.dome + 4)) continue;
    put('dome', seat(_m, x, z, rnd() * TAU, 0));
    claim('dome', x, z, KIT_R.dome + 4);
    lamps.push({ p: new THREE.Vector3(x, gy(x, z) + 8.8 + 30 * 0.78 + 6.2, z), r: 1.8, color: LAMP.AMBER, i: 1.3 });
  }
  pushSeat(0, 0);
  B.box(0, 7, 0, 3, 14, 3, LK.STONE);
  for (const r of [0, Math.PI / 2]) { B.push(new THREE.Matrix4().makeRotationY(r)); B.box(0, 10.5, 0, 2, 4, 3.4, LK.SIGN); B.pop(); }
  B.pop();
  lamps.push({ p: new THREE.Vector3(0, 15, 0), r: 1.4, color: LAMP.TEAL, i: 1.2 });
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; const x = Math.cos(a) * 52 * sz, z = Math.sin(a) * 52 * sz; lamps.push({ p: new THREE.Vector3(x, gy(x, z) + 5, z), r: 1.1, color: LAMP.AMBER, i: 0.9 }); }
  // vault terraces: rows of shielded vaults on two or three bearings, doors to a lane
  const nRows = 2 + Math.round(weight * 4);
  for (let r = 0; r < nRows; r++) {
    // a row pair: n vaults either side of a lane, 34 m apart (the berms 5 m clear), doors in
    const n = 4 + Math.floor(rnd() * 5 * sz);
    const RR = Math.hypot(n * 17 + 1, 30 + 18.5) + 2;
    const s = spot(RR, 260 * sz + RR * 0.5, 460 * sz + RR);
    if (!s) continue;
    const [cx, cz, a] = s;
    claim('vaults', cx, cz, RR);
    const yaw = a + Math.PI / 2;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
      const lx = (i - (n - 1) / 2) * 34, lz = side * 30;
      const x = cx + lx * c + lz * sn, z = cz - lx * sn + lz * c;
      put('vault', seatLocal(_m, cx, cz, yaw, lx, lz, side > 0 ? Math.PI : 0));
      lamps.push({ p: new THREE.Vector3(x - side * 18.6 * sn, gy(x, z) + 5.3, z - side * 18.6 * c), r: 0.9, color: LAMP.AMBER, i: 0.8 });
    }
    // the lane between the rows, to the square
    road([cx, cz], [cx * 0.3, cz * 0.3], 8);
  }

  // --- the landing field ---
  const pads = [], parked = [];
  let cycler = null;
  const nPads = 1 + Math.round(weight * 3);
  const fieldA = rnd() * TAU;
  for (let i = 0; i < nPads; i++) {
    const s = spot(130, 700 * sz, 1000 * sz, fieldA, 1.2);
    if (!s) continue;
    const [x, z] = s;
    claim('pad', x, z, 130);
    apron(x, z, 95, 0.9, LK.PAD);
    // the blast berm: a ring of bagged regolith open toward the core
    pushSeat(x, z, Math.atan2(-x, -z));
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    for (let k = 0; k < 20; k++) {
      if (k === 0 || k === 19) continue;                   // the gap, facing the core (+z)
      const a0 = (k / 20) * TAU - Math.PI / 2, a1 = ((k + 1) / 20) * TAU - Math.PI / 2;
      B.push(new THREE.Matrix4().makeRotationZ((a0 + a1) / 2));
      B.box(118, 0, 3, 16, (a1 - a0) * 118 + 0.4, 7, LK.REGOLITH);
      B.pop();
    }
    B.pop(); B.pop();
    for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; const lx = x + Math.cos(a) * 92, lz = z + Math.sin(a) * 92; lamps.push({ p: new THREE.Vector3(lx, gy(lx, lz) + 1.6, lz), r: 1.3, color: k % 3 ? LAMP.AMBER : LAMP.GREEN, i: 1.1 }); }
    // craft standing on it; the first field keeps its centre for the shuttle that comes and goes
    const first = pads.length === 0;
    const nCraft = first ? 1 + Math.floor(rnd() * 1.99) : 1 + Math.floor(rnd() * 2.2);
    if (first) cycler = [x, z, rnd() * TAU];
    const a = rnd() * TAU;
    for (let c = 0; c < nCraft; c++) {
      const d = first ? 55 : nCraft === 1 ? 0 : 45;
      const lx = x + Math.cos(a + c * TAU / nCraft) * d, lz = z + Math.sin(a + c * TAU / nCraft) * d;
      const part = rnd() < 0.5 ? 'lander' : 'cargoLander';
      put(part, seat(_m, lx, lz, rnd() * TAU, 0.9), LIVERY[Math.floor(rnd() * LIVERY.length)]);
      parked.push([lx, lz]);
    }
    pads.push([x, z]);
    road([x * (1 - 100 / Math.hypot(x, z)), z * (1 - 100 / Math.hypot(x, z))], [x * 60 * sz / Math.hypot(x, z), z * 60 * sz / Math.hypot(x, z)], 12);
  }

  // --- the solar array: fixed panels tilted to the equator, rows on a grid ---
  {
    const s = spot(260 * sz, 700 * sz, 1100 * sz, fieldA + Math.PI, 1.6);
    if (s) {
      const [cx, cz] = s;
      const R = 240 * sz;
      claim('array', cx, cz, R + 10);
      const tilt = Math.min(Math.abs(lat), 70) * Math.PI / 180 * Math.sign(lat || 1);
      // normal toward the equator (site -z is south at northern latitudes), rows running east-west
      const rot = new THREE.Matrix4().makeRotationX(-tilt);
      for (let gx = -R; gx <= R; gx += 12) for (let gz = -R; gz <= R; gz += 14) {
        if (gx * gx + gz * gz > R * R) continue;
        const x = cx + gx, z = cz + gz;
        put('tracker', seat(_m, x, z, 0, 0));
        seat(_m, x, z, 0, TRACKER_AXLE);
        put('panel', _m.multiply(rot));
      }
      const L = Math.hypot(cx, cz);
      road([cx * (1 - (R + 6) / L), cz * (1 - (R + 6) / L)], [cx * 0.25, cz * 0.25], 8);
    }
  }

  // --- the radiator farm and the plant ---
  {
    const s = spot(120, 450 * sz, 700 * sz);
    if (s) {
      const [cx, cz, a] = s;
      claim('plant', cx, cz, 120);
      const yaw = Math.PI / 2 - a;                           // local +z points away from the core
      apron(cx, cz, 110, 0.25, LK.GROUND);
      pushSeat(cx, cz, yaw);
      B.box(-65, 9, 0, 80, 18, 40, LK.STONE);
      B.box(-65, 10, 20.05, 72, 2, 0.1, LK.GLASS);
      B.box(-65, 10, -20.05, 72, 2, 0.1, LK.GLASS);
      B.box(-65, 18.4, 0, 82, 0.8, 42, LK.ROOF);
      B.box(-85, 5, 20.3, 12, 10, 0.3, LK.HAZARD);
      B.box(-50, 16, 20.2, 24, 2.4, 0.2, LK.SIGN);
      B.pop();
      for (let r = 0; r < 4; r++) for (let k = 0; k < 14; k++) put('radiator', seatLocal(_m, cx, cz, yaw, 30 + k * 4.6, -36 + r * 24, 0, 0.25));
      for (let k = 0; k < 3; k++) put('silo', seatLocal(_m, cx, cz, yaw, -60 + k * 22, 50, 0, 0.25));
      lamps.push({ p: new THREE.Vector3(cx, gy(cx, cz) + 22, cz), r: 1.6, color: LAMP.WHITE, i: 1.2 });
      road([cx, cz], [cx * 0.3, cz * 0.3], 10);
    }
  }

  // --- the mine: an excavator at a working face, spoil, a haul road home ---
  const loops = [];
  {
    const s = spot(200, 1100 * sz, 1500 * sz);
    if (s) {
      const [cx, cz, a] = s;
      claim('mine', cx, cz, 200);
      apron(cx, cz, 170, 0.25, LK.GROUND);
      const yaw = Math.PI / 2 - a;                           // local +z points away from the core
      // the face: a crescent bench of fresh regolith on the far side
      pushSeat(cx, cz, yaw);
      B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      for (let k = 0; k < 14; k++) {
        const a0 = -0.9 + k / 14 * 1.8, a1 = -0.9 + (k + 1) / 14 * 1.8;
        B.push(new THREE.Matrix4().makeRotationZ((a0 + a1) / 2 - Math.PI / 2));
        B.box(150, 0, 4, 24, (a1 - a0) * 150 + 0.6, 9 + 3 * Math.sin(k * 1.7), LK.REGOLITH);
        B.pop();
      }
      B.pop(); B.pop();
      put('excavator', seatLocal(_m, cx, cz, yaw, 0, 100, 0, 0.25), [0.86, 0.62, 0.12]);
      // spoil heap beside
      const [hx, hz] = [cx + Math.cos(a + 1.6) * 260, cz + Math.sin(a + 1.6) * 260];
      if (free(hx, hz, 90)) {
        claim('spoil', hx, hz, 90);
        pushSeat(hx, hz);
        B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        B.lathe([[85, -1, LK.REGOLITH], [85, 0, LK.REGOLITH], [60, 8, LK.REGOLITH], [48, 8, LK.REGOLITH], [30, 16, LK.REGOLITH], [0, 17, LK.REGOLITH]], 24, rnd());
        B.pop(); B.pop();
      }
      const home = [cx * 0.12, cz * 0.12];
      const pts = road([cx, cz], home, 12);
      loops.push(pts);
      for (const d of [-1, 1]) { const lx = cx + Math.cos(a + d) * 150, lz = cz + Math.sin(a + d) * 150; put('mast', seat(_m, lx, lz, 0, 0)); lamps.push({ p: new THREE.Vector3(lx, gy(lx, lz) + 17.6, lz), r: 1.8, color: LAMP.WHITE, i: 1.4 }); }
    }
  }
  // the pads' and the plant's roads are rover routes too
  for (const [x, z] of pads) {
    const L = Math.hypot(x, z);
    const pts = [];
    for (let i = 0; i <= 12; i++) { const f = (60 * sz + (L - 100 - 60 * sz) * i / 12) / L; pts.push(new THREE.Vector3(x * f, gy(x * f, z * f) + 0.6, z * f)); }
    loops.push(pts);
  }

  // --- the ground: craters and boulders beyond the works ---
  const outer = 1700 * sz;
  let nCr = 0;
  for (let k = 0; k < 120 && nCr < 14; k++) {
    const a = rnd() * TAU, d = 300 + rnd() * outer, R = 8 + 60 * rnd() ** 3;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!free(x, z, R * 1.6 + 12)) continue;
    // keep the haul and service roads clear
    if (loops.some((pts) => pts.some((p) => Math.hypot(p.x - x, p.z - z) < R * 1.6 + 14))) continue;
    claim('crater', x, z, R * 1.5);
    nCr++;
    pushSeat(x, z, rnd() * 6);
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const h = R * 0.09, seg = Math.max(16, Math.round(R * 0.8));
    B.lathe([[R * 0.72, 0.12, LK.GROUND], [R * 0.95, h, LK.REGOLITH], [R * 1.08, h * 0.95, LK.REGOLITH], [R * 1.5, 0.05, LK.REGOLITH], [R * 1.5, -0.8, LK.REGOLITH], [R * 0.72, -0.8, LK.REGOLITH], [R * 0.72, 0.12, LK.GROUND]], seg, 0, { closedProfile: true });
    B.lathe([[0, 0.14, LK.GROUND], [R * 0.74, 0.14, LK.GROUND], [R * 0.74, -0.6, LK.GROUND], [0, -0.6, LK.GROUND]], seg);
    B.pop(); B.pop();
    for (let b = 0; b < R * 1.2; b++) {
      const ba = rnd() * TAU, bd = R * (1.6 + rnd() * rnd() * 2.2), bx = x + Math.cos(ba) * bd, bz = z + Math.sin(ba) * bd, s = 0.3 + R * 0.03 * rnd() + rnd() * rnd();
      if (!free(bx, bz, s + 1)) continue;
      const tone = 0.8 + rnd() * 0.35;
      put('boulder' + (b % 3), seat(_m, bx, bz, rnd() * TAU, -0.1 * s, s), [tone, tone * 0.97, tone * 0.93]);
    }
  }
  for (let k = 0; k < 700; k++) {
    const a = rnd() * TAU, d = 200 + rnd() * outer, s = 0.3 + 3 * rnd() ** 5;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!free(x, z, s + 2) || loops.some((pts) => pts.some((p) => Math.hypot(p.x - x, p.z - z) < s + 9))) continue;
    const tone = 0.8 + rnd() * 0.35;
    put('boulder' + (k % 3), seat(_m, x, z, rnd() * TAU, -0.1 * s, s), [tone, tone * 0.97, tone * 0.93]);
  }

  return { geo: B.geometry(), lamps, inst, plan, loops, pads, parked, cycler, radius: outer + 200 };
}

// ------------------------------------------------------------------------ runtime --

export class LunarOutposts {
  constructor(parent) {
    this.parent = parent;                 // the Moon's group (Moon frame, km)
    this.mat = createLunarMaterial({ lit: 0.55 });
    this.sites = TOWNS.slice(1).map(([lat, lon, w], i) => {
      const up = townDir(lat, lon);
      const g = new THREE.Group();
      g.name = `Lunar outpost ${i + 1}`;
      g.position.copy(up).multiplyScalar(R_MOON);
      stationFrame(up, g.quaternion);
      g.visible = false;
      parent.add(g);
      return { lat, lon, w, up, group: g, built: false, data: null, rovers: null, riders: null };
    });
    this._wp = new THREE.Vector3();
    this._local = new THREE.Vector3();
    this._inv = new THREE.Matrix4();
    this.buildMs = 0;
  }

  /** Build one outpost now (its geometry and instanced furniture). */
  build(site, idx) {
    const t0 = performance.now();
    const d = buildOutpost(idx + 101, site.w, site.lat);
    site.data = d;
    const mesh = lunarMesh(d.geo, {}, this.mat);
    mesh.name = `${site.group.name}: works, pads, domes and ground`;
    addLamps(mesh, d.lamps, { minPx: 0.9 });
    site.group.add(mesh);
    for (const [part, list] of Object.entries(d.inst)) {
      const tint = list.some((e) => e.tint);
      const im = lunarInstanced(kit(part), list.length, {}, this.mat, { tint });
      list.forEach((e, i) => { im.setMatrixAt(i, e.m); if (tint) im.instanceColor.setXYZ(i, ...(e.tint || [1, 1, 1])); });
      im.name = `${site.group.name} ${part}`;
      site.group.add(im);
      (site.detail ||= []).push(im);                       // hidden beyond DETAIL_KM
    }
    // rovers on the outpost's roads
    site.paths = d.loops.filter((p) => p.length > 1).map((p) => new Path(p));
    site.riders = [];
    site.paths.forEach((P, pi) => { const n = Math.max(1, Math.round(P.L / 500)); for (let i = 0; i < n; i++) site.riders.push({ pi, ph: i * 997 + pi * 131, v: 8 + ((i * 7 + pi * 3) % 5) }); });
    site.rovers = lunarInstanced(kit('rover'), site.riders.length, {}, this.mat, { tint: true });
    site.rovers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    site.riders.forEach((r, i) => site.rovers.instanceColor.setXYZ(i, ...LIVERY[(i + idx) % LIVERY.length]));
    site.group.add(site.rovers);
    // the field's shuttle, its plume, and suited crews round the parked craft
    site.crew = [];
    for (const [x, z] of d.parked) for (let i = 0; i < 5; i++) site.crew.push({ x, z, r: 22 + ((i * 37 + idx * 11) % 50) / 10, a0: i * 1.3 + idx, w: i % 2 ? 1 : -1.2 });
    site.suits = lunarInstanced(kit('suit'), Math.max(1, site.crew.length), {}, this.mat, { tint: true });
    site.suits.count = site.crew.length;
    site.suits.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < site.crew.length; i++) site.suits.instanceColor.setXYZ(i, ...(i % 3 ? [0.92, 0.9, 0.86] : [0.95, 0.62, 0.18]));
    site.group.add(site.suits);
    site.shuttle = null;
    if (d.cycler) {
      site.shuttle = lunarInstanced(kit('lander'), 1, {}, this.mat);
      site.shuttle.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      site.plume = plumeMesh();
      site.plume.scale.setScalar(0.001);
      site.group.add(site.shuttle, site.plume);
    }
    site.live = [site.rovers, site.suits, site.shuttle].filter(Boolean);
    site.group.traverse((o) => { o.frustumCulled = false; });
    site.built = true;
    this.buildMs += performance.now() - t0;
  }

  buildAll() { this.sites.forEach((s, i) => { if (!s.built) this.build(s, i); }); }

  /** cam: camera world position. Builds at most one outpost per frame, nearest first. */
  update(t, cam, camera, viewH) {
    let want = -1, wantD = Infinity;
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i];
      s.group.getWorldPosition(this._wp);
      const d = this._wp.distanceTo(cam);
      if (!s.built && d < 600 && d < wantD) { want = i; wantD = d; }
      s.group.visible = s.built && (camera ? pixelRadius(camera, this._wp, (s.data?.radius || 3000) * 0.001, viewH) > 1.5 : d < 200);
      if (!s.built) continue;
      // the furniture (craft, domes, vaults, trackers, boulders) and the rovers only near enough
      // to be told apart; from farther the merged ground plan and its lamps stand for the town
      const near = s.group.visible && d < DETAIL_KM;
      if (near !== s.detailOn) { s.detailOn = near; for (const m of s.detail || []) m.visible = near; for (const m of s.live) m.visible = near; if (!near && s.plume) s.plume.visible = false; }
      if (near && d < 40) { this.moveRovers(s, t); this.moveLife(s, t, i); }
    }
    if (want >= 0) this.build(this.sites[want], want);
  }

  moveLife(s, t, idx) {
    for (let i = 0; i < s.crew.length; i++) {
      const c = s.crew[i], a = c.a0 + t * c.w / c.r;
      seat(_m, c.x + Math.cos(a) * c.r, c.z + Math.sin(a) * c.r, -a + (c.w > 0 ? 0 : Math.PI), 0.9);
      s.suits.setMatrixAt(i, _m);
    }
    s.suits.instanceMatrix.needsUpdate = true;
    if (!s.shuttle) return;
    const [x, z, yaw] = s.data.cycler;
    const { h, thr } = LunarTraffic.landerCycle(t, idx * 53.1);
    if (h < 0) { _m.makeScale(0, 0, 0); s.plume.visible = false; }
    else {
      seat(_m, x, z, yaw + h * 1e-4, 0.9 + h);
      s.plume.visible = thr > 0.01;
      if (s.plume.visible) {
        _p.set(0, 0.9, 0).applyMatrix4(_m);
        s.plume.position.copy(_p).multiplyScalar(0.001);
        s.plume.quaternion.setFromRotationMatrix(_m);
        const len = Math.min(1, (h + 0.9) / 42 + 0.05);
        s.plume.scale.set(0.001 * (1 + (1 - len) * 1.8), 0.001 * len, 0.001 * (1 + (1 - len) * 1.8));
        s.plume.material.uniforms.uI.value = thr * (0.8 + 0.2 * Math.sin(t * 37 + idx));
      }
    }
    s.shuttle.setMatrixAt(0, _m);
    s.shuttle.instanceMatrix.needsUpdate = true;
  }

  moveRovers(s, t) {
    for (let i = 0; i < s.riders.length; i++) {
      const r = s.riders[i], P = s.paths[r.pi];
      const span = Math.max(P.L - 20, 1);
      let q = ((t * r.v + r.ph) % (2 * span) + 2 * span) % (2 * span);
      let sg = 1;
      if (q > span) { q = 2 * span - q; sg = -1; }
      P.at(q + 10, _p, _t);
      if (sg < 0) _t.negate();
      _y.crossVectors(_t, UP).normalize();
      _p.addScaledVector(_y, 2.4);
      _z.copy(_t).normalize(); _x.crossVectors(UP, _z).normalize(); _y.crossVectors(_z, _x);
      _m.makeBasis(_x, _y, _z).setPosition(_p);
      s.rovers.setMatrixAt(i, _m);
    }
    s.rovers.instanceMatrix.needsUpdate = true;
  }
}
