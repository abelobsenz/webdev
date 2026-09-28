import * as THREE from 'three';
import { buildLiner, buildTender, buildRefinery, CB, CK } from '../craft/craftGeometry.js';
import { buildShuttle, buildTug, buildCourier, buildFreighter, lathe } from '../craft/craftClasses.js';
import { createGlowMesh } from '../craft/craftMaterial.js';
import { craftMesh, craftPart, addEngines, addLamps, placeMerge, placeLamps, KM } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { R_EARTH, R_MOON, MERIDIAN_LON, bodyDir } from './sim.js';
import { stationFrame, CORRIDORS } from './stations.js';
import { HS } from './harbour.js';

// MERIDIAN's ships in the orbital view (km units; the craft are built in metres).
//
//  Harbour     the Concord-class liner berthed at the liner pier; a second liner and an
//              outer-system freighter on voyage cycles through the arrival corridor (tail
//              first, braking toward the Harbour, amber lane) and the departure corridor
//              (drive lit, outbound, blue lane); tugs working between the arms and bays
//  Halo        port shuttles climbing the Nauru port column to the Halo and diving back
//              down the other; three reclamation tenders nearby, one carrying a relic
//  Moon        Selene Works above the near side, tankers berthed at its docking ring and
//              one on the Earth run
//
// Everything decorative moves in real time (warped sim time made ships strobe). Each ship
// that can wander far from its station is its own depth-sliced body; targets read the
// analytic pose() (the rig samples targets before the modules update).

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

/** The Nauru port on the Halo: the Halo target and the tenders work here (afternoon light at Meridian's default hour). */
export const NAURU_LON = THREE.MathUtils.degToRad(166.9);

/** Orientation with +Z along fwd and +Y as close to upHint as possible. */
const _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _lz = new THREE.Vector3(), _lm = new THREE.Matrix4();
function lookQuat(fwd, upHint, out) {
  const z = _lz.copy(fwd).normalize();
  const x = _lx.crossVectors(upHint, z);
  if (x.lengthSq() < 1e-10) x.set(1, 0, 0).cross(z);
  if (x.lengthSq() < 1e-10) x.set(0, 0, 1).cross(z);
  x.normalize();
  const y = _ly.crossVectors(z, x);
  return out.setFromRotationMatrix(_lm.makeBasis(x, y, z));
}

/**
 * A voyage cycle in a station frame: arrive tail-first along dA (braking burn, the plume
 * pointing at the station), turn at the hold point, depart along dD with the drive lit.
 * The cycle wraps while the ship is far out in both corridors (sub-pixel from the station).
 */
export function voyage(u, c, outPos, outFwd) {
  let thr = 0;
  if (u < 0.42) {
    const s = u / 0.42;
    outPos.copy(c.hold).addScaledVector(c.dA, c.S * (1 - s) * (1 - s));
    outFwd.copy(c.dA);
    thr = smooth(0, 0.06, s) * (1 - smooth(0.72, 0.98, s));
  } else if (u < 0.58) {
    const s = smooth(0, 1, (u - 0.42) / 0.16);
    outPos.copy(c.hold).lerp(c.start, s).addScaledVector(c.bulge, Math.sin(Math.PI * s));
    // turn through the station's up axis (dA and dD point roughly apart)
    const w = smooth(0.15, 0.85, s);
    outFwd.copy(c.dA).multiplyScalar(1 - w).addScaledVector(c.dD, w).addScaledVector(TURN_AXIS, Math.sin(Math.PI * w)).normalize();
  } else {
    const s = (u - 0.58) / 0.42;
    outPos.copy(c.start).addScaledVector(c.dD, c.S * s * s);
    outFwd.copy(c.dD);
    thr = 1.15 * smooth(0, 0.07, s) * (1 - smooth(0.88, 1, s));
  }
  return thr;
}

const TURN_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * The visiting liner's voyage (Harbour frame, km): it holds high above the freighters'
 * arrival lanes (8 km off their axis) and turns over the top to leave well above the
 * departure lanes, so the three docking movements (src/space/geoRoads.js) keep their roads.
 */
export function approachVoyage() {
  const c = CORRIDORS;
  return {
    hold: c.dA.clone().multiplyScalar(30).add(V(0, 9, 0)), start: c.dD.clone().multiplyScalar(28).add(V(0, 8, 3)),
    dA: c.dA.clone().add(V(0.05, -0.1, 0.12)).normalize(), dD: c.dD.clone().add(V(0, -0.08, -0.1)).normalize(), S: 3000, bulge: V(0, 10, 0), T: 2100, offset: 0.3,
  };
}

/** Back-and-forth transit along a cubic Bezier with pauses at both ends. */
export function shuttleRun(t, c, outPos, outFwd) {
  const T = c.move * 2 + c.pause * 2;
  let ph = ((t + c.offset) % T + T) % T;
  let back = false;
  if (ph >= c.move + c.pause) { back = true; ph -= c.move + c.pause; }
  const moving = ph < c.move;
  const s = moving ? smooth(0, 1, ph / c.move) : 1;
  const e = back ? 1 - s : s;
  const P = c.pts;
  const a = 1 - e;
  outPos.set(0, 0, 0).addScaledVector(P[0], a * a * a).addScaledVector(P[1], 3 * a * a * e).addScaledVector(P[2], 3 * a * e * e).addScaledVector(P[3], e * e * e);
  // tangent
  const d = _v.set(0, 0, 0).addScaledVector(P[0], -3 * a * a).addScaledVector(P[1], 3 * a * a - 6 * a * e).addScaledVector(P[2], 6 * a * e - 3 * e * e).addScaledVector(P[3], 3 * e * e);
  if (d.lengthSq() > 1e-12) outFwd.copy(d).normalize().multiplyScalar(back ? -1 : 1);
  const q = moving ? ph / c.move : 1;
  return moving ? 0.55 * (1 - smooth(0.12, 0.3, q)) + 0.4 * smooth(0.72, 0.8, q) * (1 - smooth(0.9, 1, q)) : 0;
}

/** A dead satellite of the old kind: box bus in foil, two wings, a dish. Metres. */
function buildRelic() {
  const B = new CB();
  B.box(0, 0, 0, 6, 6, 9, CK.BRONZE);
  B.box(0, 3.4, 0, 3, 0.8, 3, CK.DARK);
  for (const s of [-1, 1]) {
    B.box(s * 4.5, 0, 0, 3, 0.3, 0.3, CK.DARK);
    B.panel(s * 6, s * 18, -2.2, 2.2, 0, 0.12, CK.PANEL);
  }
  B.at(0, -3.6, 1.5, Math.PI / 2 + 0.4, 0, 0);
  lathe(B, [[0.3, 0, CK.HULL], [2.8, 1.1, CK.HULL], [2.9, 1.2, CK.DARK]], 14);
  B.pop();
  return B.geometry();
}

export class Fleet {
  constructor(space) {
    this.space = space;
    this.crafts = [];
    this.movers = [];
    const el = space.elevator;
    const station = el.station;
    // ---- the Concord-class liner at the liner pier (engines dark, lamps lit)
    const liner = buildLiner(2400);
    this.linerGeo = liner;
    {
      const m = craftMesh(liner.geo, { accent: [0.55, 0.85, 1.0], lit: 0.62 });
      station.linerBerth(m.position, m.quaternion);
      addLamps(m, liner.lamps, { minPx: 1.3 });
      el.harbour.add(m);
      this.docked = m;
      this.crafts.push(m);
      // port shuttles docked at two keel collars, dorsal hatch to the collar's face
      this.linerAttendants = linerAttendants(liner.geo);
      const att = craftPart(m, this.linerAttendants.geo);
      m.add(att);
      addLamps(m, this.linerAttendants.lamps, { minPx: 1.2 });
    }
    // ---- voyage cycles through the Harbour's corridors (harbour frame, km)
    const H = el.harbour;
    const corr = CORRIDORS;
    this.corridors = corr;
    // (freighters now dock at the arm heads: src/space/geoRoads.js movements)
    this._addVoyager('approach', liner, H, { ...approachVoyage(),
      engine: { scale: 0.55, length: 16, color: 0x7fd8ff }, glow: [0.55, 0.8, 1.0], accent: [1.0, 0.72, 0.45],
    });
    // ---- tugs and a courier working the Harbour (children of the Harbour: short hops)
    const tug = buildTug(80), courier = buildCourier(44), shuttle = buildShuttle(110);
    const A = station.data.arms;
    // (the arm heads belong to the berthing freighters and their escort tugs, src/space/geoRoads.js)
    // a tug's loading station 420 m (drawn) over the outermost cargo rack on an arm's keel
    const rack = (i) => A[i].d.clone().multiplyScalar(9700 * HS * KM).setY((A[i].y + (A[i].up ? 1 : -1) * 1000 * HS) * KM);
    // the shuttle's stand beside the customs pod on arm 6, on the side away from its berthed ships
    const pod = (i, dy) => A[i].d.clone().multiplyScalar((A[i].L - 980 - 250) * KM).addScaledVector(A[i].side, -0.55).setY((A[i].y + (A[i].up ? 1 : -1) * 590) * KM + dy);
    const flat = (p, k) => p.clone().setY(0).multiplyScalar(k).setY(p.y);
    // The lower tug passes beneath the thermal fins before climbing to the rack it loads.
    const runs = [
      { craft: tug, pts: [V(1.25, -6.1, 0.35), V(3.8, -7.2, 1.7), rack(5).add(V(0, -3.0, 0)), rack(5)], move: 150, pause: 45, offset: 0 },
      // stock handed between the racks of two neighbouring arms, level beneath the upper ring
      { craft: tug, pts: [rack(1), flat(rack(1), 1.3), flat(rack(2), 1.3), rack(2)], move: 130, pause: 60, offset: 80 },
      { craft: courier, pts: [V(-0.95, 6.1, 0.2), V(-2.5, 7.2, 1.3), corr.dD.clone().multiplyScalar(9.5).add(V(0, 2.5, 0)), corr.dD.clone().multiplyScalar(13).add(V(0, 2.1, 0))], move: 110, pause: 50, offset: 30 },
      { craft: shuttle, pts: [V(0.2, -6.1, -1.0), V(0, -8.4, -3.4), pod(6, -1.5), pod(6, 0)], move: 170, pause: 55, offset: 120 },
    ];
    this.runs = runs.map((r, i) => {
      const m = craftMesh(r.craft.geo, { accent: [0.55, 0.9, 1.0], lit: 0.5 });
      const eng = addEngines(m, r.craft.glows, { scale: 0.7, length: 7, throttle: 0 });
      addLamps(m, r.craft.lamps, { minPx: 1.2 });
      H.add(m);
      this.crafts.push(m);
      return { ...r, mesh: m, engines: eng, pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1) };
    });
    // ---- port shuttles on the Nauru columns: up the east column, down the west one
    const nUp = bodyDir(0, NAURU_LON);
    this.portFrame = new THREE.Group();
    this.portFrame.position.copy(nUp).multiplyScalar(R_EARTH);
    stationFrame(nUp, this.portFrame.quaternion);
    space.earthFixed.add(this.portFrame);
    this.portShuttles = [0, 1].map((i) => {
      const g = new THREE.Group();
      const m = craftMesh(shuttle.geo, { accent: [0.55, 0.9, 1.0], lit: 0.5 });
      const eng = addEngines(m, shuttle.glows, { scale: 0.7, length: 12, throttle: 0 });
      addLamps(m, shuttle.lamps, { minPx: 1.2 });
      const glow = createGlowMesh(shuttle.glows, { color: [0.6, 0.85, 1.0], strength: 1.5, scale: KM });
      m.add(glow);
      g.add(m);
      this.portFrame.add(g);
      this.crafts.push(m);
      space.addBody(`port${i}`, [g], () => g.getWorldPosition(_v), 1.2, { solid: true, hint: 0.4 });
      return { group: g, mesh: m, engines: eng, glow, offset: i * 470 };
    });
    // ---- reclamation tenders above the Halo near the Nauru port
    const tender = buildTender(620);
    const relic = buildRelic();
    this.tenders = [];
    this.tenderGroup = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const m = craftMesh(tender.geo, { accent: [0.5, 1.0, 0.8], lit: 0.5 });
      const arms = tender.arms.map((Ar) => {
        const pivot = new THREE.Group();
        pivot.position.copy(Ar.pivot);
        const am = craftPart(m, Ar.geo);
        am.position.copy(Ar.pivot).negate();
        pivot.add(am);
        m.add(pivot);
        return { pivot, axis: Ar.axis };
      });
      m.add(createGlowMesh(tender.glows, { color: [0.6, 1.0, 0.85], strength: 1.0, scale: KM }));
      addEngines(m, tender.glows, { scale: 0.7, length: 9, color: 0x8affd8, core: 0xf0fff8, throttle: 0.4 });
      addLamps(m, tenderLamps(tender), { minPx: 1.2 });
      if (i === 1) {
        const rm = craftPart(m, relic);
        rm.position.set(0, 0, 398);
        rm.rotation.set(0.4, 0.9, 0.2);
        m.add(rm);
        this.relic = rm;
      }
      this.tenderGroup.add(m);
      this.tenders.push({ mesh: m, arms, phase: i * 2.1, offset: V((i - 1) * 1.25, 0.3 * Math.sin(i * 2.0), (i - 1) * 0.5 - Math.abs(i - 1) * 0.55), grip: i === 1 });
      this.crafts.push(m);
    }
    space.scene.add(this.tenderGroup);
    space.addBody('tenders', [this.tenderGroup], () => this.tenderGroup.getWorldPosition(_v), 2.2, { solid: true, hint: 0.85 });
    // ---- Selene Works over the Moon's near side, with tankers
    const ref = buildRefinery(1);
    this.refineryData = ref;
    this.refinery = new THREE.Group();
    const rm = craftMesh(ref.geo, { accent: [1.0, 0.7, 0.4], lit: 0.55 });
    const wm = craftPart(rm, ref.wheel);
    rm.add(wm);
    this.wheel = wm;
    rm.add(createGlowMesh(ref.glows, { color: [1.0, 0.62, 0.35], strength: 1.0, scale: KM }));
    addEngines(rm, ref.glows, { scale: 0.55, length: 9, color: 0xff9a55, core: 0xfff0dc, throttle: 0.5 });   // the process vent
    addLamps(rm, refineryLamps(), { minPx: 1.3 });
    // tankers berthed radially at the docking ring (y = 2150 m)
    const tanker = buildFreighter(560);
    const berthed = [];
    for (const berth of ref.berths) {
      const M = new THREE.Matrix4().compose(berth.position, lookQuat(berth.forward, V(0, 1, 0), new THREE.Quaternion()), V(1, 1, 1));
      berthed.push({ geo: tanker.geo, m: M });
    }
    rm.add(craftPart(rm, placeMerge(berthed)));
    this.refinery.add(rm);
    this.refineryMesh = rm;
    this.crafts.push(rm);
    space.scene.add(this.refinery);
    space.addBody('selene', [this.refinery], () => this.refinery.getWorldPosition(_v), 6, { solid: true, hint: 0.85 });
    this.moonAlt = 2600;
    // a tanker on the Earth run, cycling through Selene's corridors (refinery frame, km)
    this._addVoyager('tanker', tanker, this.refinery, {
      hold: V(3.2, 5.5, 1.5), start: V(-2.5, 5.2, -2.2),
      dA: V(0.35, 1, 0.25).normalize(), dD: V(-0.3, 1, -0.3).normalize(), S: 1800, bulge: V(0, 2, 0), T: 1300, offset: 0.62,
      engine: { scale: 0.62, length: 16, color: 0xffb070, core: 0xfff2e0 }, glow: [1.0, 0.72, 0.45], accent: [1.0, 0.72, 0.45], radius: 1.2,
    });
  }

  /** A ship on a voyage cycle: a top-level group (its own depth-sliced body) placed from a station frame. */
  _addVoyager(name, craft, frameObj, c) {
    const g = new THREE.Group();
    const m = craftMesh(craft.geo, { accent: c.accent, lit: 0.5 });
    const engines = addEngines(m, craft.glows, { scale: c.engine.scale, length: c.engine.length, color: c.engine.color, core: c.engine.core, throttle: 0 });
    const glow = createGlowMesh(craft.glows, { color: c.glow, strength: 2.0, scale: KM });
    m.add(glow);
    addLamps(m, craft.lamps, { minPx: 1.3 });
    g.add(m);
    this.space.scene.add(g);
    this.crafts.push(m);
    const r = c.radius ?? craft.length * KM * 0.5 + 0.8;
    this.space.addBody(name, [g], () => g.getWorldPosition(_v), r, { solid: true, hint: 0.5 });
    const vy = { name, group: g, mesh: m, engines, glow, frameObj, c, pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1) };
    this.movers.push(vy);
    return vy;
  }

  /**
   * Analytic world poses from the current sim state (the rig reads targets before the
   * modules update, and at high warp a one-frame-old transform is kilometres off).
   */
  pose(name, sim, outPos, outQuat) {
    const q = _q2.copy(sim.earthQuat);
    if (name === 'liner') {
      const el = this.space.elevator;
      const hq = _q3.copy(q).multiply(el.harbour.quaternion);
      if (outPos) outPos.copy(this.docked.position).applyQuaternion(hq).add(_v2.copy(el.harbour.position).applyQuaternion(q));
      if (outQuat) outQuat.copy(hq).multiply(this.docked.quaternion);
    } else if (name === 'tenders') {
      const up = bodyDir(0, NAURU_LON + 0.009, _v2).applyQuaternion(q);
      const east = _v3.set(0, 1, 0).cross(up).normalize();
      const north = _v4.copy(up).cross(east);
      if (outPos) outPos.copy(up).multiplyScalar(R_EARTH + 620 + 7).addScaledVector(north, 30);
      if (outQuat) outQuat.setFromRotationMatrix(_m2.makeBasis(east.negate(), up, north));
    } else if (name === 'selene') {
      const toEarth = _v2.copy(sim.moonPos).negate().normalize();
      if (outPos) outPos.copy(sim.moonPos).addScaledVector(toEarth, R_MOON + this.moonAlt);
      if (outQuat) outQuat.setFromUnitVectors(_v3.set(0, 1, 0), toEarth);
    }
    return outPos || outQuat;
  }

  update(sim, realTime, dt, space) {
    const el = space.elevator;
    el.harbour.updateMatrixWorld(true);
    // voyage cycles
    for (const vy of this.movers) {
      const c = vy.c;
      const u = (((realTime / c.T) + c.offset) % 1 + 1) % 1;
      const thr = voyage(u, c, vy.pos, vy.fwd);
      vy.frameObj.updateMatrixWorld(true);
      vy.group.position.copy(vy.pos).applyMatrix4(vy.frameObj.matrixWorld);
      vy.frameObj.getWorldQuaternion(_q);
      const upH = _v.set(0, 1, 0);
      lookQuat(vy.fwd, upH, vy.group.quaternion);
      vy.group.quaternion.premultiply(_q);
      for (const e of vy.engines) e.setThrottle(thr);
      vy.glow.material.uniforms.uStrength.value = 2.0 * thr;
      vy.glow.visible = thr > 0.02;
    }
    // Harbour runs
    for (const r of this.runs) {
      const thr = shuttleRun(realTime, r, r.pos, r.fwd);
      r.mesh.position.copy(r.pos);
      lookQuat(r.fwd, _v.set(0, 1, 0), r.mesh.quaternion);
      for (const e of r.engines) e.setThrottle(thr);
    }
    // port shuttles: up the east column (x = -12 km) to the station's arrival gate, a pause,
    // across beneath the keel to the departure gate, and down the west column (x = +12 km)
    for (const p of this.portShuttles) {
      const T = 940;
      const u = (((realTime + p.offset) / T) % 1 + 1) % 1;
      let x, alt, fwd, thr = 0;
      if (u < 0.42) {
        const s = u / 0.42;
        alt = 611.4 * (1 - (1 - s) * (1 - s));
        x = -12;
        fwd = _v2.set(0, 1, 0);
        thr = (0.95 * smooth(0, 0.04, s) * (1 - smooth(0.55, 0.9, s)) + 0.15) * (1 - smooth(0.93, 1, s));
      } else if (u < 0.5) {
        alt = 611.4 + 0.6 * smooth(0, 1, (u - 0.42) / 0.08); x = -12;
        fwd = _v2.set(0, 1, 0);
      } else if (u < 0.6) {
        const s = smooth(0, 1, (u - 0.5) / 0.1);
        // Dip under the horizontal gate hoops before the cross-port transfer.
        // A level transfer at 612 km flew sideways through their solid bronze rims.
        alt = 612 - 2 * Math.sin(Math.PI*s); x = -12 + 24 * s;
        fwd = _v2.set(24, -2*Math.PI*Math.cos(Math.PI*s), 0).normalize();
        thr = 0.3 * smooth(0, 0.15, s) * (1 - smooth(0.4, 0.6, s));
      } else {
        const s = (u - 0.6) / 0.4;
        alt = 612 * (1 - s * s);
        x = 12;
        fwd = _v2.set(0, -1, 0);
        thr = 0.5 * smooth(0, 0.04, s) * (1 - smooth(0.1, 0.25, s));          // de-orbit burn, then glide
      }
      p.group.position.set(x, alt, 0);
      lookQuat(fwd, _v3.set(0, 0, 1), p.group.quaternion);
      for (const e of p.engines) e.setThrottle(thr);
      p.glow.material.uniforms.uStrength.value = 1.5 * thr;
      p.glow.visible = thr > 0.02;
    }
    // tenders: station-keeping above and beside the Halo, cradles breathing open and closed
    {
      this.pose('tenders', sim, this.tenderGroup.position, this.tenderGroup.quaternion);
      for (const t of this.tenders) {
        const w = realTime * 0.05 + t.phase;
        t.mesh.position.copy(t.offset).add(_v.set(Math.sin(w) * 0.06, Math.sin(w * 0.7) * 0.03, Math.cos(w) * 0.06));
        t.mesh.rotation.set(0.1 * Math.sin(w * 0.5), w * 0.2, 0.05 * Math.sin(w * 0.3));
        // the tender with a relic keeps its cradle closed round it
        const open = t.grip ? 0.12 : 0.5 + 0.5 * Math.sin(realTime * 0.25 + t.phase);
        for (const a of t.arms) a.pivot.quaternion.setFromAxisAngle(a.axis, -0.15 + 0.55 * open);
      }
      if (this.relic) this.relic.rotation.z = 0.2 + 0.05 * Math.sin(realTime * 0.3);
    }
    // Selene Works: fixed over the near side, spindle pointing away from the Moon
    {
      this.pose('selene', sim, this.refinery.position, this.refinery.quaternion);
      this.refinery.updateMatrixWorld(true);
      this.wheel.rotation.y = realTime * 0.04;
    }
  }
}

/**
 * Craft berthed at the docked liner's keel collars (liner-local metres). Both the collar face
 * and the shuttle's dorsal hatch are found by casting against the real meshes, and the hatch
 * is seated 0.3 m into the collar's docking face.
 */
export function linerAttendants(linerGeo, collars = [-170, 330]) {
  const sh = buildShuttle(110);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const liner = new THREE.Mesh(linerGeo, mat), shuttle = new THREE.Mesh(sh.geo, mat);
  liner.updateMatrixWorld(true); shuttle.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.set(V(0, 100, 6), V(0, -1, 0));
  const hatch = ray.intersectObject(shuttle, false)[0];
  if (!hatch) throw new Error('Shuttle dorsal hatch not found');
  const list = [], lamps = [], docks = [];
  for (const z of collars) {
    ray.set(V(0, -400, z), V(0, 1, 0));
    const face = ray.intersectObject(liner, false)[0];
    if (!face) throw new Error('Liner keel collar not found');
    const pos = face.point.clone().sub(hatch.point).add(V(0, 0.3, 0));
    const m = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);
    list.push({ geo: sh.geo, m });
    lamps.push(...placeLamps(sh.lamps, m, 3));
    docks.push({ face: face.point.clone(), hatch: hatch.point.clone().add(pos), matrix: m });
  }
  mat.dispose();
  return { geo: placeMerge(list), lamps, docks };
}

function tenderLamps(t) {
  const s = t.length / 300;
  const out = [
    { p: V(104 * s, 13.5 * s, -30 * s), r: 1.6 * s, color: LAMP.RED, i: 3, dir: V(1, 0, 0.2) },
    { p: V(-104 * s, 13.5 * s, -30 * s), r: 1.6 * s, color: LAMP.GREEN, i: 3, dir: V(-1, 0, 0.2) },
    { p: V(0, 15 * s, -140 * s), r: 1.4 * s, color: LAMP.WHITE, i: 2, dir: V(0, 0, -1) },
    { p: V(0, 39.5 * s, -92 * s), r: 1.2 * s, color: LAMP.WHITE, i: 1.8, breathe: 0.3 },
  ];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
    out.push({ p: V(Math.cos(a) * 17 * s, Math.sin(a) * 17 * s, 126 * s), r: 1.3 * s, color: LAMP.TEAL, i: 2.2, breathe: 0.3, phase: k / 3 });
  }
  return out;
}

function refineryLamps() {
  const out = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    out.push({ p: V(Math.cos(a) * 2390, -600, Math.sin(a) * 2390), r: 26, color: LAMP.WHITE, i: 1.6 });
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    out.push({ p: V(Math.cos(a) * 460, 2150, Math.sin(a) * 460), r: 24, color: LAMP.AMBER, i: 2.2, breathe: 0.3, phase: k / 8 });
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    out.push({ p: V(Math.cos(a) * 2350, -1350, Math.sin(a) * 2350), r: 30, color: k % 2 ? LAMP.RED : LAMP.GREEN, i: 2.6 });
  }
  out.push({ p: V(0, 2810, 0), r: 30, color: LAMP.WHITE, i: 2.4, breathe: 0.35 });
  return out;
}

/** Focus targets for the craft (merged into the space target list). */
export function fleetTargets(space) {
  const P = (name) => ({
    position: (o) => (space.fleet ? space.fleet.pose(name, space.sim, o, null) : o.set(0, 0, 0)),
    frame: (q) => (space.fleet ? space.fleet.pose(name, space.sim, null, q) : q.identity()),
  });
  return {
    liner: { ...P('liner'), minDist: 1.2, maxDist: 20000, defaultDist: 2.6, view: { az: 1.5, el: 0.4 } },
    tenders: { ...P('tenders'), minDist: 0.5, maxDist: 20000, defaultDist: 2.6, view: { az: 2.5, el: 0.3 } },
    selene: { ...P('selene'), minDist: 4, maxDist: 60000, defaultDist: 13, view: { az: 0.75, el: 0.22 } },
  };
}
