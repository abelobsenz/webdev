import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { buildTug } from '../craft/craftClasses.js';
import { craftMesh, addLamps, KM } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { craftInstances } from './helianthDistrict.js';
import { truss, radiatorWing, mast } from './shipKit.js';
import { DynLamps, weldGain } from './lifeKit.js';
import { SWARM, shellY } from './helianthSwarm.js';

// The Swarm Yard: where the Helianth's collectors are built, in the sunward shell's window
// 610 km off (metres in the yard's frame: +Y away from the Sun, the line along +X).
//
// A 64 km spine truss carries five assembly jigs. Down the line a collector grows: a bare
// hexagonal rim in the first jig, the spokes and trusses in the second, three facets, then six,
// then the finished mirror with its receiver being hung in the last, ready to be towed out to
// its place in the lattice. Two gantry cranes ride rails on the spine, each carrying a facet
// from the stock racks at the line's head to a jig and back; welders flicker at every jig.
// The crew lives in a spun wheel at the head of the line (a full gravity at its floor, its
// windows lit), beside the smelter that turns the stock into facets, its radiators edge-on to
// the Sun and a beacon mast over all. A tug holds station at the tail, waiting for its tow.

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TO_Y = new THREE.Matrix4().makeRotationX(-Math.PI / 2), TO_NY = new THREE.Matrix4().makeRotationX(Math.PI / 2);

export const YARD = {
  x: 480, z: -380, layer: 0,         // km, the station frame (inside the sunward shell's window)
  spine: { half: 32000, y: 900, w: 900 },
  jigs: [-20000, -10000, 0, 10000, 20000],
  jigY: -600,                        // the jigs' collectors hang below the spine, faces to the Sun
  rail: { y: 1500, z: 520 },
  cranes: 2, craneT: 360,
  wheel: { x: -27500, y: 900, z: -3200, R: 1500, omega: Math.sqrt(9.81 / 1500) },
  racks: { x: -25500, n: 6 },
  smelter: { x: -31000, r: 1000, h: 2800 },
};

/** A collector at assembly stage s (0 rim .. 4 finished), metres, face at y = 0 toward -Y. */
export function buildCollectorStage(s) {
  const B = new CB(), { facetR: fr, rimR, focus } = SWARM;
  const rim = [];
  for (let k = 0; k <= 6; k++) { const a = (k % 6) / 6 * TAU + Math.PI / 6; rim.push(V(Math.cos(a) * rimR, 70, Math.sin(a) * rimR)); }
  B.tube(rim, 48, 8, s >= 4 ? CK.BRONZE : CK.HULL);
  for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + Math.PI / 6; B.box(Math.cos(a) * rimR, 70, Math.sin(a) * rimR, 140, 140, 140, CK.HULL); }
  if (s >= 1) {
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU + Math.PI / 6;
      B.tube([V(Math.cos(a) * 260, 90, Math.sin(a) * 260), V(Math.cos(a) * (rimR - 40), 70, Math.sin(a) * (rimR - 40))], 30, 6, CK.DARK);
    }
    for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; truss(B, V(Math.cos(a) * 300, 220, Math.sin(a) * 300), V(Math.cos(a) * rimR * 0.84, 120, Math.sin(a) * rimR * 0.84), 90, 520, 7, CK.DARK); }
    B.at(0, 80, 0); B.push(TO_Y); B.lathe([[240, 0, CK.BRONZE], [260, 40, CK.HULL], [260, 260, s >= 3 ? CK.LANTERN : CK.HULL], [120, 360, CK.BRONZE], [60, 400, CK.DARK]], 16); B.pop(); B.pop();
  }
  const facets = s >= 4 ? 7 : s === 3 ? 6 : s === 2 ? 3 : 0;
  const step = fr * Math.sqrt(3) + 70;
  const centres = [[0, 0]];
  for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; centres.push([Math.cos(a) * step, Math.sin(a) * step]); }
  for (let f = 0; f < facets; f++) {
    const [x, z] = centres[f];
    B.at(x, -28, z); B.push(TO_Y); B.lathe([[0.01, 0, CK.PANEL], [fr, 0, CK.PANEL], [fr, 28, CK.DARK], [0.01, 28, CK.DARK]], 6, Math.PI / 6); B.pop(); B.pop();
  }
  if (s >= 4) {
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * TAU + Math.PI / 2;
      B.tube([V(Math.cos(a) * 2600, -30, Math.sin(a) * 2600), V(Math.cos(a) * 150, -focus + 60, Math.sin(a) * 150)], 22, 6, CK.DARK);
    }
    B.at(0, -focus - 200, 0); B.push(TO_Y); B.lathe([[40, 0, CK.DARK], [170, 60, CK.BRONZE], [170, 300, CK.HULL], [60, 420, CK.DARK]], 14); B.pop(); B.pop();
  }
  return B.geometry();
}

/** The fixed yard (metres): spine, jig cradles, rails, racks, smelter, wheel bearing, mast. */
export function buildYardFixed() {
  const B = new CB(), lamps = [], welds = [];
  const { spine, jigs, jigY, rail, racks, wheel } = YARD;
  // the spine: a deep square truss, bronze chords every 4 km
  truss(B, V(-spine.half, spine.y, 0), V(spine.half, spine.y, 0), spine.w, 2000, 40, CK.DARK);
  for (let x = -spine.half; x <= spine.half; x += 4000) B.box(x, spine.y, 0, 120, spine.w + 120, spine.w + 120, CK.BRONZE);
  // crane rails on both flanks of the spine's top
  for (const s of [-1, 1]) {
    B.box(0, rail.y - 40, s * rail.z, spine.half * 2, 40, 60, CK.BRONZE);
    for (let x = -spine.half + 1000; x < spine.half; x += 2000) B.box(x, (rail.y - 60 + spine.y + spine.w / 2) / 2, s * rail.z, 60, rail.y - 60 - spine.y - spine.w / 2 + 20, 60, CK.DARK);
  }
  // jig cradles: six hangers from the spine to each collector's rim nodes
  jigs.forEach((jx, j) => {
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU + Math.PI / 6, c = V(jx + Math.cos(a) * SWARM.rimR, jigY + 140, Math.sin(a) * SWARM.rimR);
      B.tube([V(jx + Math.cos(a) * spine.w * 0.4, spine.y - spine.w / 2, Math.sin(a) * spine.w * 0.4), c], 22, 6, CK.BRONZE);
      B.box(c.x, c.y, c.z, 180, 60, 180, CK.DARK);
    }
    // a work platform on the spine's underside, lit, with its welders' arcs round the rim
    B.box(jx, spine.y - spine.w / 2 - 60, 0, 1400, 120, 700, CK.DECK);
    B.box(jx, spine.y - spine.w / 2 - 180, 0, 900, 120, 500, CK.GLASS);
    lamps.push({ p: V(jx, spine.y - spine.w / 2 - 260, 0), r: 60, color: LAMP.WHITE, i: 2.6, dir: V(0, -1, 0) });
    for (let k = 0; k < 4; k++) { const a = (k + 0.3 * j) / 4 * TAU; welds.push({ p: V(jx + Math.cos(a) * SWARM.rimR * 0.97, jigY + 90, Math.sin(a) * SWARM.rimR * 0.97), r: 40, color: [0.75, 0.88, 1.0], i: 4.5 }); }
    lamps.push({ p: V(jx, spine.y + spine.w / 2 + 120, 0), r: 50, color: j % 2 ? LAMP.AMBER : LAMP.TEAL, i: 2.4, breathe: 0.6, phase: j / 5 });
  });
  // stock racks at the head of the line: shelves of facet blanks
  for (let r = 0; r < racks.n; r++) {
    const x = racks.x + (r - (racks.n - 1) / 2) * 1400, z = 2600;
    B.box(x, spine.y, z, 900, 2400, 60, CK.DARK); B.box(x, spine.y, -z, 900, 2400, 60, CK.DARK);
    for (let k = 0; k < 5; k++) for (const s of [-1, 1]) B.box(x, spine.y - 1000 + k * 500, s * (z - 250), 800, 60, 420, k % 2 ? CK.PANEL : CK.BRONZE);
    for (const s of [-1, 1]) B.tube([V(x, spine.y, s * spine.w / 2), V(x, spine.y, s * (z - 40))], 30, 6, CK.HULL);
  }
  // the smelter: a drum hung sunward under the spine's head, its furnace window glowing, and
  // two radiators off its back, their planes holding the Sun's line (edge-on to it)
  const sm = YARD.smelter, sy = spine.y - spine.w / 2;
  B.at(sm.x, sy, 0); B.push(TO_NY);
  B.lathe([[900, 0, CK.BRONZE], [sm.r, 200, CK.HULL], [sm.r, 1300, CK.HULL], [900, 1400, CK.LANTERN], [sm.r, 1500, CK.HULL], [sm.r, 2200, CK.HULL], [600, 2600, CK.BRONZE], [200, sm.h, CK.DARK]], 24);
  B.pop(); B.pop();
  lamps.push({ p: V(sm.x, sy - 1450, sm.r + 60), r: 200, color: [1.0, 0.45, 0.15], i: 3.6, breathe: 0.3 });
  for (const s of [-1, 1]) radiatorWing(B, V(sm.x - sm.r + 20, sy - 1500, s * 400), V(-1, 0, 0), V(0, 0, 1), 9000, 1600, lamps, s > 0 ? LAMP.GREEN : LAMP.RED);
  // the wheel's axle off the spine's flank and its hub
  B.tube([V(wheel.x, wheel.y, -spine.w / 2 + 20), V(wheel.x, wheel.y, wheel.z + 480)], 160, 12, CK.HULL);
  B.at(wheel.x, wheel.y, wheel.z); B.lathe([[380, -500, CK.BRONZE], [420, -300, CK.HULL], [420, 300, CK.GLASS], [380, 500, CK.BRONZE]], 20); B.pop();
  // the beacon mast over the line's tail and the tow point
  const tip = mast(B, V(spine.half, spine.y + spine.w / 2, 0), V(0, 1, 0), 2400, 30);
  lamps.push({ p: tip.clone().setY(tip.y + 60), r: 160, color: LAMP.RED, i: 4, breathe: 0.9 });
  for (const s of [-1, 1]) lamps.push({ p: V(s * spine.half, spine.y, spine.w), r: 90, color: s > 0 ? LAMP.GREEN : LAMP.RED, i: 2.6 });
  return { geo: B.geometry(), lamps, welds };
}

/** The crew wheel (metres, spinning about local +Z at the hub). */
export function buildYardWheel() {
  const B = new CB(), R = YARD.wheel.R;
  B.torus(R, 150, 72, 10, CK.GLASS);
  B.torus(R, 158, 72, 6, CK.LANTERN, TAU / 72);
  for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; B.tube([V(Math.cos(a) * 420, Math.sin(a) * 420, 0), V(Math.cos(a) * (R - 140), Math.sin(a) * (R - 140), 0)], 60, 8, CK.HULL); }
  for (let k = 0; k < 24; k++) { const a = (k + 0.5) / 24 * TAU; B.box(Math.cos(a) * (R + 160), Math.sin(a) * (R + 160), 0, 60, 60, 220, k % 3 ? CK.BRONZE : CK.RADIATOR); }
  return B.geometry();
}

/** Crane k at time t: its x along the spine (metres) and the load it carries (0..1 of the run). */
export function cranePose(k, t) {
  const T = YARD.craneT, u = (((t / T) + k * 0.5) % 1 + 1) % 1, s = u < 0.5 ? u * 2 : 2 - u * 2;
  const e = s * s * (3 - 2 * s);
  const x0 = YARD.racks.x + 1000, x1 = YARD.jigs[1 + 2 * k];
  return { x: x0 + (x1 - x0) * e, loaded: u < 0.5 };
}

/** The yard's pose (km, station frame): on the sunward shell, +Y away from the Sun. */
export function yardMatrix(D, out = new THREE.Matrix4()) {
  const L = SWARM.layers[YARD.layer], y = shellY(D, L.y, YARD.x, YARD.z);
  const up = V(YARD.x, y + D, YARD.z).normalize(), x = V(1, 0, 0).addScaledVector(up, -up.x).normalize(), z = V().crossVectors(x, up);
  return out.makeBasis(x, up, z).setPosition(YARD.x, y, YARD.z);
}

export class SwarmYard {
  constructor(parent, D, sunDir) {
    this.group = new THREE.Group(); parent.add(this.group);
    yardMatrix(D).decompose(this.group.position, this.group.quaternion, this.group.scale);
    const t0 = performance.now();
    const opt = { accent: [1, 0.72, 0.4], lit: 0.6, fill: 0.08 };
    this.fixed = buildYardFixed();
    const fm = craftMesh(this.fixed.geo, opt); fm.userData.sunDir = sunDir;
    addLamps(fm, this.fixed.lamps, { minPx: 1.2 });
    this.group.add(fm); this.mesh = fm;
    // the line: five stages, each on its own jig
    this.stages = YARD.jigs.map((jx, s) => { const m = craftMesh(buildCollectorStage(s), opt, fm.material); m.userData.sunDir = sunDir; m.position.set(jx * KM, YARD.jigY * KM, 0); this.group.add(m); return m; });
    // welders
    this.welds = new DynLamps(this.fixed.welds, { minPx: 1.2 });
    this.welds.mesh.scale.setScalar(KM); this.group.add(this.welds.mesh);
    // the wheel
    this.wheel = craftMesh(buildYardWheel(), opt, fm.material); this.wheel.userData.sunDir = sunDir;
    this.wheel.position.set(YARD.wheel.x * KM, YARD.wheel.y * KM, YARD.wheel.z * KM); this.group.add(this.wheel);
    // cranes (a gantry bridge across both rails, a facet blank under it when loaded)
    const cb = new CB();
    cb.box(0, 0, 0, 500, 160, YARD.rail.z * 2 + 240, CK.HULL);
    for (const s of [-1, 1]) cb.box(0, -110, s * YARD.rail.z, 400, 80, 120, CK.BRONZE);
    cb.box(0, 140, YARD.rail.z, 300, 120, 300, CK.GLASS);
    this.craneGeo = cb.geometry();
    this.cranes = craftInstances(this.craneGeo, [new THREE.Matrix4(), new THREE.Matrix4()], opt, fm.material);
    this.cranes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cranes.userData.sunDir = sunDir; this.group.add(this.cranes);
    const lb = new CB(); lb.box(0, 0, 0, 2000, 40, 600, CK.PANEL); lb.box(0, 40, 0, 200, 60, 200, CK.DARK);
    this.loads = craftInstances(lb.geometry(), [new THREE.Matrix4(), new THREE.Matrix4()], opt, fm.material);
    this.loads.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.loads.userData.sunDir = sunDir; this.group.add(this.loads);
    // the tug waiting at the tail for its tow
    const tug = buildTug(260);
    this.tug = craftInstances(tug.geo, [new THREE.Matrix4().makeTranslation(YARD.spine.half + 4200, YARD.jigY, 0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2))], opt, fm.material);
    this.tug.userData.sunDir = sunDir; this.group.add(this.tug);
    this.group.traverse((o) => { o.frustumCulled = false; });
    this.buildMs = performance.now() - t0;
    this._m = new THREE.Matrix4();
  }
  animate(t) {
    this.wheel.rotation.z = (t * YARD.wheel.omega) % TAU;
    const m = this._m;
    for (let k = 0; k < YARD.cranes; k++) {
      const c = cranePose(k, t);
      m.makeTranslation(c.x, YARD.rail.y + 100, 0); this.cranes.setMatrixAt(k, m);
      // the blank rides on the gantry's deck (seated on its top); on the empty run back it is gone
      m.makeTranslation(c.x, YARD.rail.y + 100 + 80 + 20, 0);
      if (!c.loaded) m.scale(V(0.001, 0.001, 0.001));
      this.loads.setMatrixAt(k, m);
    }
    this.cranes.instanceMatrix.needsUpdate = true; this.loads.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.welds.n; i++) this.welds.gain(i, weldGain(t, i * 1.7 + 0.3));
    this.welds.commit();
  }
  triangles() {
    const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    return tri(this.mesh.geometry) + this.stages.reduce((a, s) => a + tri(s.geometry), 0) + tri(this.wheel.geometry) + tri(this.craneGeo) * 2 + tri(this.loads.geometry) * 2 + tri(this.tug.geometry);
  }
}

// ------------------------------------------------------------ crew shuttles ----
// Crews and parts shuttle between the Helianth and the yard: down from the Helianth's side 40 km
// out (inside its statite flotilla's inner edge), across 60 km below the Helianth's plane
// (under the flotilla, over the shell), and down to the yard's line; they dwell at each end.
export const SHUTTLES = { count: 4, y: -60, r0: 40, T: 900, dwell: 0.12, lane: 0.8 };

/** The shuttle run (km, station frame): [P0 .. P3], the Helianth end first. */
export function shuttlePath(D) {
  const b = V(YARD.x, 0, YARD.z).normalize();
  const c = V().setFromMatrixPosition(yardMatrix(D));
  const up = V(c.x, c.y + D, c.z).normalize();
  const dock = c.clone().addScaledVector(up, (YARD.spine.y + YARD.spine.w / 2 + 600) / 1000);   // over the spine's top
  return [
    b.clone().multiplyScalar(SHUTTLES.r0).setY(-6),
    b.clone().multiplyScalar(SHUTTLES.r0).setY(SHUTTLES.y),
    dock.clone().addScaledVector(b, -30).setY(SHUTTLES.y),
    dock,
  ];
}

/** Shuttle k at time t: position (km) and heading along the run, out and back with dwells. */
export function shuttlePose(k, t, path, outP, outF) {
  const u = (((t / SHUTTLES.T) + k / SHUTTLES.count) % 1 + 1) % 1, d = SHUTTLES.dwell;
  // [dwell at the Helianth][out][dwell at the yard][back]
  let s, dir;
  if (u < d) { s = 0; dir = 1; } else if (u < 0.5) { s = (u - d) / (0.5 - d); dir = 1; } else if (u < 0.5 + d) { s = 1; dir = -1; } else { s = 1 - (u - 0.5 - d) / (0.5 - d); dir = -1; }
  s = s * s * (3 - 2 * s);
  let L = 0;
  for (let i = 1; i < path.length; i++) L += path[i].distanceTo(path[i - 1]);
  let x = s * L, i = 1;
  for (; i < path.length - 1; i++) { const seg = path[i].distanceTo(path[i - 1]); if (x <= seg) break; x -= seg; }
  const a = path[i - 1], b = path[i], seg = a.distanceTo(b) || 1;
  outP.copy(a).lerp(b, Math.min(x / seg, 1));
  // out- and inbound shuttles keep lanes apart (the lanes meet only at the dwell points, where each waits its turn)
  const e = Math.abs(2 * s - 1), lane = 1 - e * e * e * e * e * e * e * e;
  outP.y += (dir > 0 ? 1 : -1) * SHUTTLES.lane * lane;
  outF.subVectors(b, a).normalize().multiplyScalar(dir);
  return outP;
}
