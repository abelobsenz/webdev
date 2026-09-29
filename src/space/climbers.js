import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { craftMesh, craftPart, addLamps, KM, DK, createDressedMaterial } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { R_EARTH, GEO_ALT, COUNTERWEIGHT_ALT } from './sim.js';
import { stationFrame } from './stations.js';

// Climber cars on Meridian's tether. The elevator draws every climber as a soft point from
// the sim clock; within a few tens of km the nearest ones are real cars, placed by the same
// schedule (a CPU mirror of the point shader), while the points fade out.
//
// Two classes share the guide cables. Passenger climbers are ten-deck towns in a can: a
// glazed observation lounge with its promenade on top, lit passenger decks, a machinery
// drum with radiator fins and lifeboats, and a drive clamp at each end (six trucks of
// paired wheels gripping the cable, pressed on by rams). Freight climbers are open frames
// of stacked containers with a crew cab. Close in, the tether itself becomes structure: the
// ribbon with its beacon collars, and the two guide cables with their marker sleeves.

export const CLIMB_PERIOD = 53400;         // s: surface to GEO at ~2,400 km/h
export const GUIDE_OFFSET = 120;           // m: guide cables either side of the ribbon
export const RIBBON = { width: 30, thick: 1.2 };
export const CABLE_R = 3.5;                // guide cable radius (m)
export const BORE_R = 18;                  // climber sleeve bore (m): clears collars on the cable
export const MARKER_PROUD = 0.15;       // m: flush marker bands on the guides (the drive wheels roll over them)
export const CAR_REACH = 90;               // km: real cars within this of the camera
export const DETAIL_KM = 30;               // km: drive-clamp and cargo detail within this

/** Altitude (km) of a climber with schedule aC = [offset, dir, run] at sim time t (mod period). */
export function climberAlt(t, a0, dir, run) {
  let ph = ((t + a0) / CLIMB_PERIOD) % 1;
  if (ph < 0) ph += 1;
  let s = ph < 0.02 ? ph * ph / 0.04 : (ph > 0.98 ? 1 - (1 - ph) * (1 - ph) / 0.04 : ph);
  if (dir < 0) s = 1 - s;
  return run < 0.5 ? s * GEO_ALT : GEO_ALT + s * (COUNTERWEIGHT_ALT - GEO_ALT);
}

/** Freight or passenger, fixed per schedule slot (every third car carries freight). */
export function climberClass(i) { return i % 3 === 2 ? 1 : 0; }

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const toY = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
function latheY(B, y, prof, seg, closed = false) {
  B.push(new THREE.Matrix4().makeTranslation(0, y, 0).multiply(toY));
  lathe(B, prof, seg, 0, { closedProfile: closed });
  B.pop();
}

/** Drive clamp: a collar round the bore and six trucks of paired wheels on the cable. */
function driveClamp(B, D, y, flip) {
  latheY(B, y, [[BORE_R + 0.5, -7, CK.DARK], [34, -6, DK.LIVERY], [36, -3, CK.BRONZE], [36, 3, CK.BRONZE], [34, 6, DK.LIVERY], [BORE_R + 0.5, 7, CK.DARK]], 36, true);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
    B.push(new THREE.Matrix4().makeRotationY(-a).setPosition(0, y + flip * 16, 0));
    // truck frame beside the cable (local x radial), wheels pressed onto the cable surface
    B.box(CABLE_R + 9, 0, 0, 8, 22, 12, CK.BRONZE);
    D.box(CABLE_R + 12, 0, 0, 3, 18, 14, CK.DARK);
    for (const wy of [-7, 0, 7]) {
      // wheel: axle along local z, rim touching the cable at radius CABLE_R
      D.push(new THREE.Matrix4().makeTranslation(CABLE_R + 3.2, wy, 0));
      lathe(D, [[0.1, -2.2, CK.DARK], [3.2, -2.2, CK.DARK], [3.2, 2.2, CK.DARK], [0.1, 2.2, CK.DARK]], 14);
      D.pop();
    }
    B.pop();
    // hydraulic ram from the collar to the truck
    D.tube([V(c * 30, y + flip * 5, -s * 30), V(c * (BORE_R + 1.5), y + flip * 12, -s * (BORE_R + 1.5))], 1.4, 6, CK.CONDUIT);
  }
}

/** Passenger climber (metres, +y up the tether, the bore on the guide cable along y). */
export function buildPassengerClimber() {
  const B = new CB(), D = new CB(), lamps = [];
  // sleeve through the whole car
  latheY(B, 0, [[BORE_R, -104, CK.DARK], [BORE_R + 1, -104, CK.DARK], [BORE_R + 1, 104, CK.DARK], [BORE_R, 104, CK.DARK]], 28, true);
  // machinery drum (bottom): radiators, batteries, the power pickups
  latheY(B, 0, [[BORE_R + 1, -84, DK.GRIME], [40, -84, DK.GRIME], [42, -80, CK.BRONZE], [42, -52, DK.GRIME], [46, -48, CK.BRONZE], [BORE_R + 1, -48, DK.GRIME]], 36, true);
  // passenger decks: ten 9 m decks under bronze rims and lantern soffits
  const prof = [[BORE_R + 1, -48, DK.GRIME], [48, -46, DK.GRIME], [50, -44, CK.BRONZE]];
  let y = -42;
  for (let d = 0; d < 10; d++) {
    prof.push([50, y, DK.PORTS], [50.5, y + 1, CK.GLASS], [50.5, y + 7, CK.GLASS], [51.5, y + 7.5, CK.LANTERN], [51.5, y + 8.5, CK.BRONZE], [50, y + 9, DK.PORTS]);
    y += 9;
  }
  // observation lounge: flared glass ring under a shallow dome, the promenade outside it
  prof.push([54, y + 1, CK.BRONZE], [58, y + 3, CK.DECK], [58, y + 4, CK.BRONZE], [52, y + 5, CK.GLASS], [48, y + 14, CK.GLASS], [44, y + 18, CK.BRONZE], [34, y + 22, CK.ROOF], [BORE_R + 1, y + 25, CK.HULL]);
  latheY(B, 0, prof, 48, true);
  const top = y + 25;
  // promenade railing and lounge columns
  B.push(new THREE.Matrix4().makeTranslation(0, y + 5.2, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  D.push(new THREE.Matrix4().makeTranslation(0, y + 5.2, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  D.torus(57.6, 0.3, 64, 5, CK.BRONZE);
  B.pop(); D.pop();
  for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; D.box(Math.cos(a) * 57.6, y + 4.6, Math.sin(a) * 57.6, 0.4, 1.3, 0.4, CK.BRONZE); }
  // radiator fins round the drum (radial vanes, no further out than the passenger decks' shadow)
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + TAU / 16;
    B.push(new THREE.Matrix4().makeRotationY(-a));
    B.box(62, -66, 0, 38, 30, 1.6, CK.RADIATOR);
    B.box(44, -66, 0, 4, 32, 4, CK.CONDUIT);
    B.pop();
  }
  // lifeboats clamped between the fins
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU, c = Math.cos(a), s = Math.sin(a);
    B.push(new THREE.Matrix4().makeTranslation(c * 46.2, -64, s * 46.2).multiply(toY));
    lathe(B, [[0.1, -9, DK.LIVERY], [3.6, -8, DK.LIVERY], [4.2, -3, CK.GLASS], [4.2, 5, DK.LIVERY], [2.4, 9, CK.BRONZE], [0.1, 9.5, CK.BRONZE]], 14);
    B.pop();
    lamps.push({ p: V(c * 53, -64, s * 53), r: 0.9, color: LAMP.AMBER, i: 1.6 });
  }
  // drive clamps below and above the cabin, and the pickup shoes on the power sheath
  driveClamp(B, D, -94, -1);
  driveClamp(B, D, top + 10, 1);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU;
    B.push(new THREE.Matrix4().makeRotationY(-a));
    D.box(CABLE_R + 1.2, -30, 0, 2.4, 14, 3, CK.BRONZE);
    B.pop();
  }
  // docking collar hatches on the lounge roof and under the drum, masts
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + TAU / 8, c = Math.cos(a), s = Math.sin(a);
    B.box(c * 30, top - 2, s * 30, 8, 6, 8, CK.BRONZE);
    B.box(c * 30, -86, s * 30, 8, 6, 8, CK.BRONZE);
  }
  D.tube([V(0, top, 36), V(0, top + 30, 36)], 0.6, 5, CK.DARK);
  // lamps: deck-edge lights breathing round the stack, nav set, top strobe
  for (let d = 0; d < 10; d += 3) for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + d;
    lamps.push({ p: V(Math.cos(a) * 52, -42 + d * 9 + 8, Math.sin(a) * 52), r: 1.1, color: LAMP.AMBER, i: 1.8, breathe: 0.25, phase: k / 6 });
  }
  lamps.push({ p: V(58.5, y + 4, 0), r: 1.6, color: LAMP.GREEN, i: 3.0 }, { p: V(-58.5, y + 4, 0), r: 1.6, color: LAMP.RED, i: 3.0 });
  lamps.push({ p: V(0, top + 31, 36), r: 2.2, color: LAMP.WHITE, i: 3.2, breathe: 0.6 });
  return { geo: B.geometry(), detail: D.geometry(), lamps, height: 208, top, radius: 81 };
}

/** Freight climber: an open lattice of stacked containers round the bore, a crew cab on top. */
export function buildFreightClimber(seed = 3) {
  const B = new CB(), D = new CB(), lamps = [];
  let h = seed;
  const rnd = () => { h = (h * 16807) % 2147483647; return (h - 1) / 2147483646; };
  latheY(B, 0, [[BORE_R, -96, CK.DARK], [BORE_R + 1, -96, CK.DARK], [BORE_R + 1, 96, CK.DARK], [BORE_R, 96, CK.DARK]], 24, true);
  // frame: eight posts on a 46 m circle, rings every 20 m, diagonals (detail)
  const posts = 8, Rf = 46;
  for (let k = 0; k < posts; k++) {
    const a = (k / posts) * TAU;
    B.tube([V(Math.cos(a) * Rf, -80, Math.sin(a) * Rf), V(Math.cos(a) * Rf, 70, Math.sin(a) * Rf)], 1.6, 6, DK.GRIME);
  }
  for (let yy = -80; yy <= 70; yy += 30) {
    B.push(new THREE.Matrix4().makeTranslation(0, yy, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    B.torus(Rf, 1.4, 32, 5, CK.BRONZE);
    B.pop();
    // spokes from the bore to the ring
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + TAU / 8; B.tube([V(Math.cos(a) * (BORE_R + 1), yy, Math.sin(a) * (BORE_R + 1)), V(Math.cos(a) * Rf, yy, Math.sin(a) * Rf)], 1.2, 5, CK.DARK); }
    if (yy < 70) for (let k = 0; k < posts; k++) {
      const a0 = (k / posts) * TAU, a1 = ((k + 1) / posts) * TAU;
      D.tube([V(Math.cos(a0) * Rf, yy, Math.sin(a0) * Rf), V(Math.cos(a1) * Rf, yy + 30, Math.sin(a1) * Rf)], 0.6, 4, CK.DARK);
    }
  }
  // containers: 12 x 12 x 24 m modules, radial, four tiers in eight bays (a few bays empty)
  const kinds = [DK.LIVERY, CK.BRONZE, CK.PANEL, CK.RADIATOR, DK.LIVERY];
  for (let tier = 0; tier < 5; tier++) for (let k = 0; k < posts; k++) {
    if (rnd() < 0.18) continue;
    const a = ((k + 0.5) / posts) * TAU;
    B.push(new THREE.Matrix4().makeRotationY(-a).setPosition(0, -65 + tier * 30, 0));
    B.box(BORE_R + 1 + 13, 0, 0, 24, 12.5, 13, kinds[Math.floor(rnd() * kinds.length)]);
    D.box(BORE_R + 1 + 13, 6.5, 0, 24.4, 0.6, 13.4, CK.DARK);
    B.pop();
  }
  // crew cab and its glazing, clamps, a pickup skirt
  latheY(B, 0, [[BORE_R + 1, 72, DK.PORTS], [30, 74, DK.PORTS], [32, 78, CK.GLASS], [32, 84, CK.GLASS], [28, 88, CK.BRONZE], [BORE_R + 1, 90, DK.PORTS]], 32, true);
  driveClamp(B, D, -88, -1);
  driveClamp(B, D, 96, 1);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    lamps.push({ p: V(Math.cos(a) * (Rf + 2), 70, Math.sin(a) * (Rf + 2)), r: 1.2, color: LAMP.AMBER, i: 2.4, breathe: 0.5, phase: k / 8 });
  }
  lamps.push({ p: V(0, 92, 30), r: 2, color: LAMP.WHITE, i: 3.0, breathe: 0.6 });
  return { geo: B.geometry(), detail: D.geometry(), lamps, height: 208, top: 90, radius: 50 };
}

/** A 4 km length of tether in metres (+y up): the ribbon and both guide cables. */
export function buildTetherSegment(len = 4000) {
  const B = new CB(), lamps = [];
  B.box(0, 0, 0, RIBBON.thick, len, RIBBON.width, DK.GRIME);
  for (const z of [-RIBBON.width / 2, RIBBON.width / 2]) B.box(0, 0, z, 2.4, len, 1.2, CK.BRONZE);
  for (const x of [-GUIDE_OFFSET, GUIDE_OFFSET]) B.tube([V(x, -len / 2, 0), V(x, len / 2, 0)], CABLE_R, 10, CK.DARK);
  for (let y = -len / 2 + 125; y < len / 2; y += 250) {
    // beacon collar on the ribbon; marker sleeves on the guides (inside the climber bore)
    B.box(0, y, 0, 4, 6, RIBBON.width + 3, CK.LANTERN);
    for (const x of [-GUIDE_OFFSET, GUIDE_OFFSET]) B.tube([V(x, y - 3, 0), V(x, y + 3, 0)], CABLE_R + MARKER_PROUD, 10, CK.BRONZE);
    if ((y + len / 2 - 125) % 1000 === 0) lamps.push({ p: V(0, y, RIBBON.width / 2 + 3), r: 2.5, color: LAMP.AMBER, i: 2.2, breathe: 0.3 }, { p: V(0, y, -RIBBON.width / 2 - 3), r: 2.5, color: LAMP.AMBER, i: 2.2, breathe: 0.3 });
  }
  return { geo: B.geometry(), lamps, len };
}

const _inv = new THREE.Quaternion();
const _cam = new THREE.Vector3();
const _p = new THREE.Vector3();

export class ClimberCars {
  constructor(space, up, schedule, count = 10) {
    this.space = space;
    this.up = up.clone();
    this.guideAxis = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0)).normalize();
    this.schedule = schedule;               // flat [offset, dir, run, ...]
    this.group = new THREE.Group();
    const classes = [buildPassengerClimber(), buildFreightClimber()];
    this.classes = classes;
    // dressed: the Concord's lift livery (cream plate, oxide-red bands), worn plate on the frames, rows of lit ports
    const mats = [createDressedMaterial({ accent: [1.0, 0.78, 0.5], lit: 0.72, livery: [0.84, 0.8, 0.7], livery2: [0.58, 0.2, 0.12] }), createDressedMaterial({ accent: [1.0, 0.62, 0.35], lit: 0.4, livery: [0.3, 0.3, 0.33], livery2: [0.86, 0.56, 0.12] })];
    this.cars = [];
    const q = stationFrame(this.up);
    for (let i = 0; i < count; i++) {
      // each car slot holds both classes and shows the one its climber flies
      const g = new THREE.Group();
      g.quaternion.copy(q);
      g.visible = false;
      g.userData.parts = classes.map((c, k) => {
        const m = craftMesh(c.geo, {}, mats[k]);
        const d = craftPart(m, c.detail);
        m.add(d);
        addLamps(m, c.lamps, { minPx: 1.2 });
        g.add(m);
        return { mesh: m, detail: d };
      });
      this.group.add(g);
      this.cars.push(g);
    }
    // the tether as structure near the camera: 9 segments round the nearest point
    const seg = buildTetherSegment();
    this.segLen = seg.len * KM;
    const segMat = createDressedMaterial({ accent: [1.0, 0.72, 0.45], lit: 0.5, livery: [0.5, 0.48, 0.44], livery2: [0.86, 0.56, 0.12] });
    this.segments = [];
    for (let i = 0; i < 9; i++) {
      const m = craftMesh(seg.geo, {}, segMat);
      addLamps(m, seg.lamps, { minPx: 1.1 });
      m.quaternion.copy(q);
      m.visible = false;
      this.group.add(m);
      this.segments.push(m);
    }
    // per-frame scratch (no allocations in update)
    this._bestD = new Float64Array(count);
    this._bestR = new Float64Array(count);
    this._bestI = new Int32Array(count);
  }

  update(sim, realTime, dt, space) {
    // camera in the body frame
    _inv.copy(sim.earthQuat).invert();
    const cam = _cam.copy(space.camera.position).applyQuaternion(_inv);
    // distance from the camera to the tether line
    const along = cam.dot(this.up);
    const off = _p.copy(cam).addScaledVector(this.up, -along).length();
    for (const c of this.cars) c.visible = false;
    for (const s of this.segments) s.visible = false;
    if (off > CAR_REACH) return;
    // tether segments round the camera's nearest altitude (bounded by the ground and the rock)
    if (off < 25) {
      const base = Math.round(along / this.segLen) * this.segLen;
      for (let i = 0; i < this.segments.length; i++) {
        const s = this.segments[i], r = base + (i - 4) * this.segLen;
        if (r - this.segLen / 2 < R_EARTH || r + this.segLen / 2 > R_EARTH + COUNTERWEIGHT_ALT) continue;
        s.position.copy(this.up).multiplyScalar(r);
        s.visible = true;
      }
    }
    const t = sim.t % CLIMB_PERIOD;
    const S = this.schedule, n = this.cars.length;
    const bd = this._bestD, br = this._bestR, bi = this._bestI;
    let m = 0;
    // keep the n nearest by insertion (no sort, no allocation)
    for (let i = 0; i < S.length; i += 3) {
      const r = R_EARTH + climberAlt(t, S[i], S[i + 1], S[i + 2]);
      const dAlong = r - along;
      const d = Math.sqrt(dAlong * dAlong + off * off);
      if (d > CAR_REACH) continue;
      let j = m < n ? m++ : n;
      if (j === n) { if (d >= bd[n - 1]) continue; j = n - 1; }
      while (j > 0 && bd[j - 1] > d) { bd[j] = bd[j - 1]; br[j] = br[j - 1]; bi[j] = bi[j - 1]; j--; }
      bd[j] = d; br[j] = r; bi[j] = i / 3;
    }
    for (let k = 0; k < m; k++) {
      const c = this.cars[k], i = bi[k], dir = S[i * 3 + 1];
      // up and down cars ride opposite guide cables
      c.position.copy(this.up).multiplyScalar(br[k]).addScaledVector(this.guideAxis, dir * GUIDE_OFFSET * KM);
      c.visible = true;
      c.userData.dir = dir;
      c.userData.index = i;
      const cls = climberClass(i);
      const parts = c.userData.parts;
      for (let p = 0; p < parts.length; p++) {
        parts[p].mesh.visible = p === cls;
        parts[p].detail.visible = bd[k] < DETAIL_KM;
      }
      // a descending car runs with its lounge still up-tether (cars do not flip)
    }
  }
}

export { KM };
