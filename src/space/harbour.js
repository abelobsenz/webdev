import * as THREE from 'three';
import { CB, CK, buildTender } from '../craft/craftGeometry.js';
import { lathe, buildShuttle, buildTug, buildFreighter, buildCourier } from '../craft/craftClasses.js';
import { LAMP } from './lamps.js';
import { craftMesh, craftPart, addLamps, placeMerge, placeLamps, pixelRadius, KM } from './craftMesh.js';

// THE GEOSTATIONARY HARBOUR, drawn in metres with the ships' own builder and material.
// Local frame: +Y up the tether (away from the Earth), +Z north (the Earth's axis),
// +X west. The tether runs through the spindle.
//
//   spindle     climber terminals at both ends, bearing collars at the three ring hubs,
//               the glass Concourse at the middle
//   rings       three habitat rings (the middle one counter-rotating), a garden trough in
//               section: outer floor, glazed sides with galleries, a glass roof facing the
//               axis; spokes to rotating hub collars
//   arms        eight docking arms between the rings, gallery tubes with berth fingers,
//               freighters and tenders alongside; the liner pier
//   power       four sun-tracking solar wings on north-south booms above; radiator fins below
//   small craft shuttles, tugs and couriers in the terminal bays

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Sweep a closed section [[dr, dy], ...] (with a kind per point) around the Y axis at radius R. */
function sweepRing(B, R, yc, sec, seg) {
  // split the loop into runs of one kind so boundaries stay crisp
  const M = sec.length;
  const runs = [];
  let start = 0;
  for (let i = 1; i <= M; i++) {
    if (i === M || sec[i][2] !== sec[start][2]) { runs.push([start, i]); start = i; }
  }
  const cx = sec.reduce((a, p) => a + p[0], 0) / M, cy = sec.reduce((a, p) => a + p[1], 0) / M;
  for (const [a0, a1] of runs) {
    const idx = [];
    for (let i = a0; i <= a1; i++) idx.push(i % M);
    const k = sec[a0][2];
    const base = B.pos.length / 3;
    const cols = idx.length;
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * TAU;
      const c = Math.cos(th), s = Math.sin(th);
      let per = 0;
      for (let q = 0; q < cols; q++) {
        const [dr, dy] = sec[idx[q]];
        if (q) { const [pr, py] = sec[idx[q - 1]]; per += Math.hypot(dr - pr, dy - py); }
        B.v(c * (R + dr), yc + dy, s * (R + dr), th * R, per, k);
      }
    }
    const hint = new THREE.Vector3();
    for (let j = 0; j < seg; j++) {
      const th = ((j + 0.5) / seg) * TAU;
      const c = Math.cos(th), s = Math.sin(th);
      for (let q = 0; q < cols - 1; q++) {
        const [d0, y0] = sec[idx[q]], [d1, y1] = sec[idx[q + 1]];
        const nr = (d0 + d1) / 2 - cx, ny = (y0 + y1) / 2 - cy;
        hint.set(c * nr, ny, s * nr);
        const i0 = base + j * cols + q, i1 = i0 + 1, i2 = i0 + cols, i3 = i2 + 1;
        B.tri(i0, i1, i3, hint); B.tri(i0, i3, i2, hint);
      }
    }
  }
}

/** Garden-trough habitat section: half width a (axial), half depth b (radial). */
function troughSection(a, b) {
  const pts = [];
  const N = 28;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU;
    const c = Math.cos(t), s = Math.sin(t);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / 3.4) * a;      // axial
    const r = Math.sign(s) * Math.pow(Math.abs(s), 2 / 3.4) * b;      // radial (+ out)
    let k = CK.HULL;
    if (s < -0.55) k = CK.GLASS;                     // roof, facing the axis
    else if (Math.abs(s) < 0.22) k = CK.LANTERN;     // galleries along the sides
    else if (s < -0.3 || (s > 0.22 && s < 0.36)) k = CK.BRONZE;
    pts.push([r, x, k]);
  }
  return pts;
}

export function buildHarbour() {
  const B = new CB();
  const toY = new THREE.Matrix4().makeRotationX(-Math.PI / 2);    // lathe z -> +y
  // ---- spindle
  B.push(toY);
  lathe(B, [
    [0.1, -17200, CK.DARK], [520, -17200, CK.DARK], [760, -16900, CK.BRONZE], [1500, -16300, CK.HULL], [1900, -15500, CK.HULL],
    [1950, -15300, CK.BRONZE], [1950, -14100, CK.GLASS], [2050, -13950, CK.LANTERN], [1950, -13800, CK.BRONZE], [1950, -13300, CK.GLASS],
    [1700, -12700, CK.HULL], [1000, -12000, CK.HULL], [900, -11000, CK.HULL],
    // lower hub collar (static half of the bearing)
    [900, -7000, CK.HULL], [1050, -6900, CK.BRONZE], [1050, -5100, CK.BRONZE], [900, -5000, CK.HULL],
    [900, -2600, CK.HULL], [1200, -2400, CK.BRONZE],
    // the Concourse
    [2000, -1900, CK.HULL], [2500, -1300, CK.GLASS], [2650, -400, CK.GLASS], [2700, -300, CK.LANTERN], [2700, 300, CK.LANTERN], [2650, 400, CK.GLASS],
    [2500, 1300, CK.GLASS], [2000, 1900, CK.HULL], [1200, 2400, CK.BRONZE], [900, 2600, CK.HULL],
    [900, 5000, CK.HULL], [1050, 5100, CK.BRONZE], [1050, 6900, CK.BRONZE], [900, 7000, CK.HULL],
    [900, 11000, CK.HULL], [1000, 12000, CK.HULL], [1700, 12700, CK.HULL], [1950, 13300, CK.GLASS], [1950, 13800, CK.BRONZE],
    [2050, 13950, CK.LANTERN], [1950, 14100, CK.GLASS], [1950, 15300, CK.BRONZE], [1900, 15500, CK.HULL], [1500, 16300, CK.HULL],
    [760, 16900, CK.BRONZE], [520, 17200, CK.DARK], [0.1, 17200, CK.DARK],
  ], 40);
  B.pop();
  // longerons along the spindle between the terminals (visual rhythm, service rails)
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    B.tube([V(Math.cos(a) * 930, -11000, Math.sin(a) * 930), V(Math.cos(a) * 930, 11000, Math.sin(a) * 930)], 60, 5, CK.DARK);
  }
  // ---- docking arms: four above the middle ring, four below, staggered
  const berths = [];
  const arms = [];
  for (let i = 0; i < 8; i++) {
    const up = i < 4;
    const a = (i % 4) * (TAU / 4) + (up ? Math.PI / 4 : 0) + 0.2;
    const y = up ? 3000 : -3000;
    const L = [23500, 20500, 22500, 19500][i % 4] + (up ? 0 : 1200);
    const d = V(Math.cos(a), 0, Math.sin(a));
    const side = V(-Math.sin(a), 0, Math.cos(a));
    arms.push({ a, y, L, d, side, up });
    // gallery tube and its keel truss
    B.tube([d.clone().multiplyScalar(850).setY(y), d.clone().multiplyScalar(L).setY(y)], 230, 12, CK.HULL);
    B.tube([d.clone().multiplyScalar(850).setY(y - (up ? -330 : 330)), d.clone().multiplyScalar(L - 400).setY(y - (up ? -330 : 330))], 70, 5, CK.DARK);
    for (let r = 2000; r < L - 300; r += 1400) {
      const p = d.clone().multiplyScalar(r).setY(y);
      B.tube([p.clone(), p.clone().setY(y - (up ? -330 : 330))], 45, 4, CK.DARK);
      // bronze girdles along the gallery
      B.at(p.x, p.y, p.z, 0, -a + Math.PI / 2, 0);
      lathe(B, [[238, -40, CK.BRONZE], [250, -30, CK.BRONZE], [250, 30, CK.BRONZE], [238, 40, CK.BRONZE]], 12);
      B.pop();
    }
    // windows strip: a lantern gallery on the arm's flank
    B.tube([d.clone().multiplyScalar(1400).add(side.clone().multiplyScalar(200)).setY(y + 60), d.clone().multiplyScalar(L - 500).add(side.clone().multiplyScalar(200)).setY(y + 60)], 40, 6, CK.LANTERN);
    // arm head: a docking hub with a collar ring facing outward
    const head = d.clone().multiplyScalar(L).setY(y);
    B.at(head.x, head.y, head.z, 0, -a + Math.PI / 2, 0);
    lathe(B, [[230, -300, CK.HULL], [520, -150, CK.HULL], [560, 0, CK.BRONZE], [560, 350, CK.GLASS], [520, 450, CK.BRONZE], [300, 600, CK.HULL], [200, 700, CK.BRONZE], [200, 780, CK.DARK], [0.1, 780, CK.DARK]], 20);
    B.pop();
    // berth fingers beyond the middle ring's radius, alternating sides
    let n = 0;
    for (let r = 12600; r < L - 1200; r += 2600, n++) {
      // the liner pier (arm 4) keeps its outboard side clear for the liner
      const sd = i === 4 ? 1 : (n % 2 ? 1 : -1);
      const base = d.clone().multiplyScalar(r).setY(y);
      const tip = base.clone().addScaledVector(side, sd * 900);
      B.tube([base, tip], 110, 8, CK.HULL);
      B.at(tip.x, tip.y, tip.z);
      B.box(0, 0, 0, 380, 380, 380, CK.BRONZE);
      B.pop();
      berths.push({ arm: i, r, sd, base, tip, a, side: side.clone(), d: d.clone(), up, y });
    }
  }
  // ---- radiator fins below and their manifold
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    const d = V(Math.cos(a), 0, Math.sin(a));
    B.tube([d.clone().multiplyScalar(900).setY(-10200), d.clone().multiplyScalar(3200).setY(-10200)], 160, 8, CK.DARK);
    B.at(d.x * 7200, -10200, d.z * 7200, 0, -a, 0);
    B.box(0, 0, 0, 8000, 5200, 90, CK.RADIATOR);
    B.box(-4000, 0, 0, 160, 5400, 220, CK.BRONZE);
    B.box(0, 2650, 0, 8100, 120, 200, CK.BRONZE);
    B.box(0, -2650, 0, 8100, 120, 200, CK.BRONZE);
    B.pop();
  }
  // ---- solar wing booms and gimbals (the wings themselves turn to face the Sun)
  const wingRoots = [];
  for (const sz of [-1, 1]) {
    B.tube([V(0, 10400, sz * 900), V(0, 10400, sz * 3600)], 180, 10, CK.DARK);
    B.at(0, 10400, sz * 3700);
    lathe(B, [[300, -420, CK.DARK], [420, -300, CK.BRONZE], [420, 300, CK.BRONZE], [300, 420, CK.DARK]], 16);
    B.pop();
    wingRoots.push(V(0, 10400, sz * 4000));
  }
  // the liner pier: gangways reaching down and out from arm 4 to the berthed liner's flank
  {
    const pa = arms[4];
    for (const r of [22000, 22900, 23800]) {
      const p0 = pa.d.clone().multiplyScalar(r).setY(pa.y);
      const p1 = p0.clone().addScaledVector(pa.side, -330).setY(pa.y - 170);
      B.tube([p0, p1], 38, 8, CK.HULL);
      B.at(p1.x, p1.y, p1.z);
      B.box(0, 0, 0, 90, 90, 90, CK.BRONZE);
      B.pop();
    }
  }
  const body = B.geometry();

  // ---- habitat rings (separate: they turn)
  const rings = [];
  for (const [yc, R, a, b, dirn] of [[-6000, 7200, 720, 430, 1], [0, 10600, 980, 560, -1], [6000, 7200, 720, 430, 1]]) {
    const W = new CB();
    const seg = R > 9000 ? 360 : 280;
    sweepRing(W, R, yc, troughSection(a, b), seg);
    // bronze rims where the roof meets the walls
    const hubR = R > 9000 ? 3100 : 1400;
    // rotating hub collar
    W.push(toY);
    W.at(0, 0, yc);
    lathe(W, [[hubR - 350, -300, CK.BRONZE], [hubR, -260, CK.HULL], [hubR, 260, CK.GLASS], [hubR - 350, 300, CK.BRONZE], [hubR - 350, -300, CK.DARK]], 48);
    W.pop();
    W.pop();
    // spokes: pressurised tubes with an elevator shaft rail, bronze collars at both ends
    const nSp = 6;
    for (let k = 0; k < nSp; k++) {
      const t = (k / nSp) * TAU;
      const d = V(Math.cos(t), 0, Math.sin(t));
      const p0 = d.clone().multiplyScalar(hubR).setY(yc), p1 = d.clone().multiplyScalar(R - b * 0.9).setY(yc);
      W.tube([p0, p1], 120, 10, CK.HULL);
      W.tube([p0.clone().add(V(0, 150, 0)), p1.clone().add(V(0, 150, 0))], 30, 4, CK.LANTERN);
      for (const f of [0.08, 0.92]) {
        const c = p0.clone().lerp(p1, f);
        W.at(c.x, c.y, c.z, 0, -t + Math.PI / 2, 0);
        lathe(W, [[128, -120, CK.BRONZE], [160, -80, CK.BRONZE], [160, 80, CK.BRONZE], [128, 120, CK.BRONZE]], 12);
        W.pop();
      }
    }
    rings.push({ geo: W.geometry(), dir: dirn, omega: Math.sqrt(9.81 / (R + b)), R, y: yc });
  }

  // ---- solar wings: each a boom with six panel bays, turned about its boom (local Z)
  const wing = new CB();
  wing.tube([V(0, 0, 0), V(0, 0, 21500)], 90, 6, CK.DARK);
  for (let k = 0; k < 6; k++) {
    const z0 = 700 + k * 3500;
    wing.panel(-2100, -120, z0, z0 + 3300, 0, 40, CK.PANEL);
    wing.panel(120, 2100, z0, z0 + 3300, 0, 40, CK.PANEL);
    wing.box(0, 0, z0 - 60, 4400, 60, 60, CK.BRONZE);
  }
  wing.box(0, 0, 21560, 4400, 60, 60, CK.BRONZE);
  const wingGeo = wing.geometry();

  // ---- berthed ships: freighters and tenders alongside the fingers, small craft in the bays
  const shipsBig = [], shipsSmall = [], lamps = [];
  const fr = buildFreighter(1100), te = buildTender(620), sh = buildShuttle(110), tu = buildTug(80), co = buildCourier(44);
  const I = new THREE.Matrix4();
  const teFull = { geo: placeMerge([{ geo: te.geo, m: I }, ...te.arms.map((A) => ({ geo: A.geo, m: I }))]), lamps: [], length: te.length };
  let rs = 91;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  for (const bth of berths) {
    if (bth.arm === 4 && bth.r > 17000) continue;           // the liner pier's outer berths stay clear
    const pick = rnd();
    if (pick < 0.12) continue;                              // an empty berth or two
    const big = pick < 0.66;
    const ship = big ? fr : teFull;
    const sc = big ? 0.62 + rnd() * 0.4 : 1;
    // ship lies parallel to the arm, outboard of the finger tip, hanging away from the rings
    const fwd = bth.d.clone().multiplyScalar(rnd() < 0.5 ? 1 : -1);
    const upv = V(0, bth.up ? 1 : -1, 0);
    const off = bth.side.clone().multiplyScalar(bth.sd * (big ? 230 * sc + 240 : 150));
    const pos = bth.tip.clone().add(off).addScaledVector(upv, big ? 90 : 60);
    const x = new THREE.Vector3().crossVectors(upv, fwd).normalize();
    _m.makeBasis(x, upv, fwd);
    _q.setFromRotationMatrix(_m);
    _s.setScalar(sc);
    const M = new THREE.Matrix4().compose(pos, _q, _s);
    shipsBig.push({ geo: ship.geo, m: M });
    lamps.push(...placeLamps(ship.lamps || [], M, 6));
    lamps.push({ p: bth.tip.clone().addScaledVector(upv, 240), r: 30, color: LAMP.AMBER, i: 2.4, breathe: 0.3, phase: rnd() });
  }
  // small craft in the terminal bays round the lower and upper terminals
  for (const yT of [-14600, 14600]) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU + (yT > 0 ? 0.13 : 0);
      const d = V(Math.cos(a), 0, Math.sin(a));
      const pick = k % 3;
      const ship = pick === 0 ? sh : pick === 1 ? tu : co;
      const pos = d.clone().multiplyScalar(1950 + ship.length * 0.5 + 25).setY(yT + (k % 2 ? 350 : -350));
      const upv = V(0, Math.sign(yT), 0);
      const fwd = d.clone().negate();
      const x = new THREE.Vector3().crossVectors(upv, fwd).normalize();
      _m.makeBasis(x, upv, fwd);
      const M = new THREE.Matrix4().compose(pos, _q.setFromRotationMatrix(_m), _s.setScalar(1));
      shipsSmall.push({ geo: ship.geo, m: M });
      lamps.push(...placeLamps(ship.lamps || [], M, 4));
    }
  }
  // station lamps: arm heads, gallery markers, ring hubs, terminal throats
  for (const arm of arms) {
    const head = arm.d.clone().multiplyScalar(arm.L + 800).setY(arm.y);
    lamps.push({ p: head, r: 60, color: LAMP.WHITE, i: 3.0, breathe: 0.35, phase: arm.a / TAU });
    for (let r = 3000; r < arm.L; r += 2800) {
      lamps.push({ p: arm.d.clone().multiplyScalar(r).addScaledVector(arm.side, 260).setY(arm.y), r: 26, color: LAMP.AMBER, i: 1.6 });
      lamps.push({ p: arm.d.clone().multiplyScalar(r).addScaledVector(arm.side, -260).setY(arm.y), r: 26, color: LAMP.AMBER, i: 1.6 });
    }
  }
  for (const yT of [-17250, 17250]) for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    lamps.push({ p: V(Math.cos(a) * 560, yT, Math.sin(a) * 560), r: 40, color: LAMP.TEAL, i: 2.2, breathe: 0.25, phase: k / 8 });
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    lamps.push({ p: V(Math.cos(a) * 11300, -10200, Math.sin(a) * 11300), r: 60, color: k % 2 ? LAMP.RED : LAMP.GREEN, i: 2.6 });
  }
  const shipsBigGeo = placeMerge(shipsBig);
  const shipsSmallGeo = placeMerge(shipsSmall);
  // the liner pier: arm 4's outer berths
  const pierArm = arms[4];
  const pier = {
    pos: pierArm.d.clone().multiplyScalar(pierArm.L - 1900).addScaledVector(pierArm.side, -520).setY(pierArm.y - 260),
    fwd: pierArm.d.clone(),
    side: pierArm.side.clone(),
  };
  return { body, rings, wingGeo, wingRoots, shipsBigGeo, shipsSmallGeo, lamps, berths, arms, pier };
}

/** The Harbour as a scene object: a group in km, rings turning, wings tracking the Sun. */
export class HarbourStation {
  constructor() {
    const h = buildHarbour();
    this.data = h;
    this.group = new THREE.Group();
    this.body = craftMesh(h.body, { accent: [0.55, 0.85, 1.0], lit: 0.62 });
    this.group.add(this.body);
    this.rings = h.rings.map((r) => {
      const m = craftPart(this.body, r.geo);
      m.scale.setScalar(KM);
      m.userData = { ...r };
      this.group.add(m);
      return m;
    });
    this.wings = h.wingRoots.map((p) => {
      const pivot = new THREE.Group();
      pivot.position.copy(p).multiplyScalar(KM);
      const m = craftPart(this.body, h.wingGeo);
      m.scale.setScalar(KM);
      if (p.z < 0) m.rotation.y = Math.PI;
      pivot.add(m);
      this.group.add(pivot);
      return { pivot, sign: Math.sign(p.z) };
    });
    this.shipsBig = craftPart(this.body, h.shipsBigGeo);
    this.shipsBig.scale.setScalar(KM);
    this.shipsSmall = craftPart(this.body, h.shipsSmallGeo);
    this.shipsSmall.scale.setScalar(KM);
    this.group.add(this.shipsBig, this.shipsSmall);
    this.lampMesh = addLamps(this.body, h.lamps, { minPx: 1.4, halo: 3 });
    this.group.traverse((o) => { o.frustumCulled = false; });
    this._sunL = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._w = new THREE.Vector3();
  }

  /** Liner berth (km, harbour frame): position and orientation. */
  linerBerth(outPos, outQuat) {
    const p = this.data.pier;
    if (outPos) outPos.copy(p.pos).multiplyScalar(KM);
    if (outQuat) {
      const fwd = p.fwd, up = V(0, 1, 0);
      const x = new THREE.Vector3().crossVectors(up, fwd).normalize();
      outQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, fwd));
    }
  }

  update(sim, realTime, space) {
    // rings at their real 1 g rate, in real time (sim time at warp strobed)
    for (const r of this.rings) r.rotation.y = r.userData.dir * r.userData.omega * (realTime % 1e5);
    // wings: turn about their boom (local Z) so the panels face the Sun
    this.group.updateMatrixWorld(true);
    this._q.copy(this.group.getWorldQuaternion(this._q)).invert();
    const s = this._sunL.copy(sim.sunDir).applyQuaternion(this._q);
    const ang = Math.atan2(s.x, s.y);
    for (const w of this.wings) w.pivot.rotation.z = -ang;
    // small craft and lamps only when the station is big enough on screen to show them
    const cam = space.camera;
    const px = pixelRadius(cam, this.group.getWorldPosition(this._w), 30, space.size.y);
    this.shipsSmall.visible = px > 600;
    this.shipsBig.visible = px > 60;
    if (this.lampMesh) this.lampMesh.visible = px > 12;
  }
}
