import * as THREE from 'three';
import { R_EARTH, R_MOON } from './sim.js';
import { portsFor } from './ports.js';
import { PortTrack, matedQuat, FEET_CENTRE, DOCK_POS } from './shipContact.js';

// The Lodestar's autopilot: flies the ship to a port (ports.js) and docks or lands there, using
// only the ship's own actuators. Every step it writes the pilot's input (fwd: main drive or reverse
// engines; pitch / yaw / roll: RCS rate commands; lift, strafe, surge: RCS translation) and boost,
// exactly as the stick would; gravity and the frames' fictitious forces keep acting on the ship.
//
// Phases
//   jump      far away (a boosted burn would take over ~90 s, or the port lies in another body's
//             sphere of influence): the jump drive carries the ship to a standoff on the port's
//             approach side, clear of every body
//   transfer  powered rendezvous with the port's gate (a point out along the approach axis; for a
//             pad on the Moon, high above it): a braking-limited velocity profile, flown nose-first
//             (main drive to accelerate, the bow's reverse engines to brake, boost when far) with the
//             RCS trimming sideways. The route goes round, never through, the Earth (above
//             R_EARTH + 95 km), the Moon (above its ground) and the station itself: blocked, the ship
//             follows the sphere of safe radius round towards the goal until the way is clear
//   approach  on RCS only, down the axis from the gate to the hold point `approach` km out, turning
//             to the mated attitude and matching the port's motion (orbit, spin) as it goes
//   final     the corridor: closing at v = min(vmax, k d + vmin) with the lateral error trimmed out
//             by RCS translation, attitude locked to the port; a pad is hovered down against gravity
//   touchdown the feet have touched: the thrusters let go and the ship settles on its legs
// Capture (docks: the latches, see shipContact.js) or landing ends it with a message.

const V = () => new THREE.Vector3();
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const KM = 0.001;
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _t = V(), _u = V();

/** Rotation taking unit a to unit b (shortest arc). */
function arc(a, b, out) { return out.setFromUnitVectors(a, b); }

export class Autopilot {
  constructor(pilot) {
    this.pilot = pilot;
    this.on = false;
    this.port = null; this.track = null;
    this.phase = ''; this.jumps = 0; this.t = 0;
    this.info = { d: 0, vc: 0, eta: 0, label: '' };
    this._s = 0; this._pose = {}; this._coarse = false; this._sgn = 1;
    this.Tcmd = V();
  }

  /** The target's ports, best first (the nearest hold point to the ship). */
  static portsOf(space, target, Pw) {
    const list = portsFor(space, target).slice();
    const d = (p) => { const w = p.pose(space, {}); return w.pos.addScaledVector(w.n, p.approach || 0).distanceTo(Pw); };
    return list.map((p) => [p, d(p)]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  }

  engage(port) {
    const p = this.pilot;
    if (!port) return false;
    this.port = port; this.track = new PortTrack(port);
    this.on = true; this.t = 0; this.jumps = 0; this._coarse = false;
    this.phase = 'transfer';
    this.info.label = port.label || port.id;
    p.brake = false;
    if (p.dock) p.undock(true);
    if (p.contact && p.contact.landed) p.contact.landed = false;
    this._frameFlag = null;
    p._flash(`autopilot: ${this.info.label}`);
    return true;
  }

  disengage(msg) {
    if (!this.on) return;
    this.on = false; this.phase = '';
    const i = this.pilot.input;
    i.fwd = i.pitch = i.yaw = i.roll = i.lift = i.strafe = i.surge = 0;
    this.pilot.boost = false;
    if (msg) this.pilot._flash(msg);
  }

  // --------------------------------------------------------------- geometry --
  /** Once per frame: follow the port, and decide whether to jump. */
  sense(dt) {
    const p = this.pilot;
    if (!this.on) return;
    this.t += dt;
    if (p.jump) { this.phase = 'jump'; return; }
    if (this.phase === 'jump') { this.phase = 'transfer'; this.track.ok = false; }
    this.track.sense(p, dt);
    this._s = -dt;                 // the ship integrates from the last frame up to this one: poses are extrapolated back by dt
    if (this.phase === 'transfer' && !this._farChecked) this._checkFar();
  }

  /** Is the gate out of reach of a burn (or in another body's sphere)? Then jump to a standoff. */
  _checkFar() {
    const p = this.pilot, sp = p.space, port = this.port;
    const w = port.pose(sp, {}), Pw = p.worldPos(V());
    const gateW = this._gateWorld(w);
    const d = gateW.distanceTo(Pw);
    const tBurn = 2 * Math.sqrt(d / p.caps.A_BOOST);
    const other = p._frameFor(w.pos) !== p._frameFor(Pw);
    this._farChecked = true;
    if (this.jumps < 2 && (tBurn > 90 || other) && d > 50) {
      this.jumps++;
      const self = this;
      p.jumpTo(this.info.label, (o) => self._gateWorld(port.pose(sp, {}), o).addScaledVector(port.pose(sp, {}).n, self._isBodyPad(port.pose(sp, {})) ? 0 : 3));
      this.phase = 'jump';
      this._farChecked = false;
    }
  }

  _isBodyPad(w) { return this.port.kind === 'pad' && w.pos.distanceTo(this.pilot.space.sim.moonPos) < R_MOON + 60; }

  /** The gate in world space: out along the approach axis, clear of the structure (a Moon pad: 15 km up). */
  _gateWorld(w, out = V()) {
    const port = this.port, app = port.approach || 0.2;
    const C = this._centreW(V());
    const depth = C ? V().copy(w.pos).sub(C).dot(w.n) : 0;
    const Rk = this._keepR(w, C);
    let D = app;
    if (this._isBodyPad(w)) D = Math.max(app, 15);
    else D = Math.max(app, Rk * 1.35 + 0.1 - depth, app);
    return out.copy(w.pos).addScaledVector(w.n, D);
  }

  _centreW(out) {
    const t = this.pilot.space.targets[this.port.target];
    return t && t.position ? t.position(out) : null;
  }

  /** Keep-out radius round the port's structure (km). */
  _keepR(w, C) {
    if (!C || this._isBodyPad(w)) return 0;
    const t = this.pilot.space.targets[this.port.target];
    return Math.max(w.pos.distanceTo(C) + (this.port.clear || 0.02), (t && t.minDist) ? t.minDist : 0);
  }

  // ---------------------------------------------------------------- control --
  /** One physics step: write the stick. */
  control(h) {
    const p = this.pilot, i = p.input, c = p.caps;
    if (!this.on || p.jump || this.phase === 'jump') { if (this.on) { i.fwd = i.lift = i.strafe = i.surge = 0; } return; }
    const s = this._s; this._sc = s; this._s += h;               // poses at the start of this step (the ship's state's time)
    const tr = this.track, pose = tr.at(s, this._pose), port = this.port, pad = port.kind === 'pad';
    const n = pose.n;
    const Qt = matedQuat(port.kind, n, pose.fwd, this._Qt || (this._Qt = new THREE.Quaternion()));
    const ref = pad ? FEET_CENTRE : DOCK_POS;
    const refT = V().copy(ref).applyQuaternion(Qt);
    const Pm = V().copy(pose.pos).sub(refT);                  // ship origin when mated
    const H = V().copy(Pm).addScaledVector(n, port.approach || 0.2);
    const g = p._gravity(p.pos, p.vel, V());
    const w = { pos: p.toWorld(pose.pos, V()), n: p.dirToWorld(n, V()) };
    const gate = p.toLocal(this._gateWorld(w, V()), V());
    const T = this.Tcmd.set(0, 0, 0);
    let att = null, wAtt = tr.omega, allowCoarse = false, boostOK = false;
    const rel = V(), vrel = V();
    if (pad && p.legs < 0.5 && (this.phase !== 'transfer' || p.pos.distanceTo(H) < 30)) p.legs = 1;
    if (this.phase === 'transfer') {
      const VG = tr.pointVel(gate, s, V()), AG = this._accAt(gate, V());
      rel.copy(gate).sub(p.pos); vrel.copy(p.vel).sub(VG);
      const d = rel.length();
      boostOK = d > 20 || vrel.length() > 0.5;
      const vd = this._route(gate, VG, d, boostOK, V(), AG);
      T.copy(AG).sub(g).addScaledVector(vd.sub(p.vel), boostOK ? 2.0 : 1.4);
      allowCoarse = true;
      att = d < 4 ? Qt : null;
      this.info.d = d; this.info.vc = -vrel.dot(rel) / Math.max(d, 1e-9);
      if (d < Math.max(0.03, (port.approach || 0.2) * 0.1) && vrel.length() < 0.004) this.phase = 'approach';
    } else if (this.phase === 'approach') {
      const VH = tr.pointVel(H, s, V()), AH = this._accAt(H, V());
      rel.copy(H).sub(p.pos); vrel.copy(p.vel).sub(VH);
      const d = rel.length(), ab = 0.35 * c.A_RCS;
      const vd = Math.min(pad ? 0.25 : 0.05, Math.sqrt(2 * ab * d), 0.6 * d);
      const vdes = V().copy(rel).multiplyScalar(d > 1e-9 ? vd / d : 0).add(VH);
      T.copy(AH).sub(g).addScaledVector(vdes.sub(p.vel), 1.3);
      att = Qt;
      const aErr = p.quat.angleTo(Qt);
      this.info.d = d + (port.approach || 0.2); this.info.vc = -vrel.dot(rel) / Math.max(d, 1e-9);
      if (d > 2) allowCoarse = true;
      if (d < 0.004 && vrel.length() < 0.0015 && aErr < 0.05) this.phase = 'final';
    } else if (this.phase === 'final' || this.phase === 'touchdown') {
      const R = V().copy(ref).applyQuaternion(p.quat).add(p.pos);
      rel.copy(R).sub(pose.pos);
      const ax = rel.dot(n), lat = V().copy(rel).addScaledVector(n, -ax), latL = lat.length();
      const VpR = tr.pointVel(R, s, V());
      const wF = V().set(p.rates.x, -p.rates.y, -p.rates.z).applyQuaternion(p.quat);
      const VR = V().crossVectors(wF, V().copy(ref).applyQuaternion(p.quat)).add(p.vel);
      vrel.copy(VR).sub(VpR);
      const vmin = pad ? 0.5 * KM : 0.08 * KM, k = pad ? 0.15 : 0.1, vmax = pad ? 0.02 : 0.012;
      const vnear = ax < 0.005 ? (pad ? 0.0009 : 0.00015) : 1;
      const inCone = latL < 0.25 * KM + 0.08 * Math.max(ax, 0) && p.quat.angleTo(Qt) < 0.06;
      const vax = inCone ? -Math.min(vmax, vnear, k * Math.max(ax, 0) + vmin) : clamp(-0.3 * (ax - Math.max(ax, 0.01)), -0.002, 0.002);
      const vlat = V().copy(lat).multiplyScalar(-0.35);
      if (vlat.length() > 0.0006) vlat.setLength(0.0006);
      const vdes = V().copy(n).multiplyScalar(vax).add(vlat);
      const AR = this._accAt(R, V());
      T.copy(AR).sub(g).addScaledVector(vdes.sub(vrel), 1.6);
      att = Qt;
      this.info.d = Math.max(ax, 0); this.info.vc = -vrel.dot(n);
      if (pad && p.contact.footTouch > 0) this.phase = 'touchdown';
      if (this.phase === 'touchdown') {
        // the feet are down: let the legs take the weight, the RCS only holds the attitude until
        // two feet are planted
        T.set(0, 0, 0);
        if (p.contact.footTouch >= 2) att = null;
        if (p.contact.footTouch === 0 && ax > 0.004) this.phase = 'final';
      }
    }
    this.info.eta = this._eta();
    // ---- allocate the thrust to the actuators
    const f = V().set(0, 0, -1).applyQuaternion(p.quat), up = V().set(0, 1, 0).applyQuaternion(p.quat), rt = V().set(1, 0, 0).applyQuaternion(p.quat);
    const TL = T.length();
    if (allowCoarse && (this._coarse ? TL > 0.45 * c.A_RCS : TL > 0.95 * c.A_RCS)) this._coarse = true;
    else this._coarse = false;
    i.fwd = 0; i.surge = 0; p.boost = false;
    let tf = T.dot(f);
    if (this._coarse) {
      if (Math.abs(tf) > 0.25 * TL) this._sgn = tf >= 0 ? 1 : -1;
      const want = _t.copy(T).multiplyScalar(this._sgn / Math.max(TL, 1e-12));
      att = arc(f, want, _q2).multiply(p.quat).normalize();
      wAtt = null;
      // the drives fire only once the nose is nearly on the line (off it, thrust would add new errors)
      const cosA = Math.abs(tf) / Math.max(TL, 1e-12), gate = clamp((cosA - 0.85) / 0.12, 0, 1);
      tf *= gate;
      if (tf > 0) {
        if (boostOK && tf > 0.9 * c.A_MAIN) { p.boost = true; i.fwd = Math.min(1, tf / c.A_BOOST); } else i.fwd = Math.min(1, tf / c.A_MAIN);
      } else if (tf < 0) {
        if (boostOK && -tf > 0.9 * c.A_RETRO) { p.boost = true; i.fwd = -Math.min(1, -tf / c.A_RETRO_BOOST); } else i.fwd = -Math.min(1, -tf / c.A_RETRO);
      }
      tf = 0;
    } else {
      if (!att) att = this.phase === 'touchdown' ? null : this._faceGoal(f, gate);
      i.surge = clamp(tf / c.A_RCS, -1, 1);
    }
    i.lift = clamp(T.dot(up) / c.A_RCS, -1, 1);
    i.strafe = clamp(T.dot(rt) / c.A_RCS, -1, 1);
    if (att) this._attitude(att, wAtt);
    else { i.pitch = i.yaw = i.roll = 0; }
  }

  /** The acceleration of the structure's point at P (orbit and spin). */
  _accAt(P, out) {
    const tr = this.track, r = _u.copy(P).sub(tr.pos);
    return out.crossVectors(tr.omega, _t.crossVectors(tr.omega, r)).add(tr.acc);
  }

  _faceGoal(f, G) {
    const d = V().copy(G).sub(this.pilot.pos);
    if (d.lengthSq() < 1e-10) return null;
    return arc(f, d.normalize(), new THREE.Quaternion()).multiply(this.pilot.quat).normalize();
  }

  /**
   * The velocity to fly toward goal G (moving at VG): a braking-limited profile along the direct
   * line, or, where a body or the station blocks it, round the blocking sphere at its safe radius.
   */
  _route(G, VG, d, boostOK, out, AG) {
    const p = this.pilot, c = p.caps, P = p.pos;
    const ab = boostOK ? 0.3 * c.A_BOOST : 0.3 * c.A_MAIN;
    // obstacles in the frame: the body, and the port's own structure
    const obs = [];
    if (p.frame === 'earth') obs.push({ C: V(), Rb: R_EARTH + 150, Rs: R_EARTH + 260, VC: V() });
    else if (p.frame === 'moon') obs.push({ C: V(), Rb: R_MOON + 10, Rs: R_MOON + 30, VC: V() });
    const Cw = this._centreW(V());
    if (Cw) {
      const w = this.port.pose(p.space, {}), Rk = this._keepR(w, Cw);
      if (Rk > 0) { const C = p.toLocal(Cw, V()); obs.push({ C, Rb: Rk * 1.1, Rs: Rk * 1.35 + 0.05, VC: this.track.pointVel(C, this._sc, V()), station: true }); }
    }
    for (const o of obs) {
      const a = V().copy(P).sub(o.C), b = V().copy(G).sub(o.C);
      if (b.length() < o.Rb * 0.999) continue;                       // the goal itself sits inside: go direct
      const ab2 = V().copy(b).sub(a), L2 = ab2.lengthSq();
      const tt = L2 > 0 ? clamp(-a.dot(ab2) / L2, 0, 1) : 0;
      const close = V().copy(a).addScaledVector(ab2, tt).length();
      if (close >= o.Rb || tt <= 0 || tt >= 1) continue;
      // blocked: follow the safe sphere round towards the goal
      const r = a.length(), rh = V().copy(a).divideScalar(r);
      const tang = V().copy(b).addScaledVector(rh, -b.dot(rh));
      if (tang.lengthSq() < 1e-12) tang.set(0, 1, 0).addScaledVector(rh, -rh.y);
      if (tang.lengthSq() < 1e-12) tang.set(1, 0, 0).addScaledVector(rh, -rh.x);
      tang.normalize();
      const ang = Math.acos(clamp(rh.dot(V().copy(b).normalize()), -1, 1));
      const path = ang * o.Rs + Math.abs(b.length() - o.Rs);
      const vc = Math.min(Math.sqrt(0.25 * (boostOK ? c.A_BOOST : c.A_MAIN) * o.Rs), Math.sqrt(2 * ab * path), 30);
      const vr = clamp(0.25 * (o.Rs - r), -Math.max(vc, 0.05), Math.max(vc, 0.05));
      out.copy(tang).multiplyScalar(vc).addScaledVector(rh, vr).add(o.VC);
      // the turn round the sphere: its centripetal pull as feed-forward
      AG.addScaledVector(rh, -(vc * vc) / Math.max(r, 1e-6));
      this._routing = o.station ? 'station' : 'body';
      return out;
    }
    this._routing = '';
    const vd = Math.min(30, Math.sqrt(2 * ab * d), (boostOK ? 1.2 : 0.8) * d);
    return out.copy(G).sub(P).multiplyScalar(d > 1e-9 ? vd / d : 0).add(VG);
  }

  /** Turn toward attitude Qd, matching angular velocity wd (frame), within the RCS's rates. */
  _attitude(Qd, wd) {
    const p = this.pilot, i = p.input, c = p.caps;
    const qe = _q.copy(p.quat).invert().multiply(Qd);
    if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
    const s = Math.sqrt(Math.max(0, 1 - qe.w * qe.w)), ang = 2 * Math.acos(Math.min(1, qe.w));
    const e = s > 1e-9 ? V().set(qe.x, qe.y, qe.z).multiplyScalar(ang / s) : V();
    const wb = wd ? V().copy(wd).applyQuaternion(_q.copy(p.quat).invert()) : V();
    const prof = (x, m) => Math.sign(x) * Math.min(0.9 * m, Math.sqrt(2 * c.ANG_ACC * 0.5 * Math.abs(x)), 1.6 * Math.abs(x));
    const wx = wb.x + prof(e.x, c.RATE.pitch), wy = wb.y + prof(e.y, c.RATE.yaw), wz = wb.z + prof(e.z, c.RATE.roll);
    i.pitch = clamp(wx / c.RATE.pitch, -1, 1);
    i.yaw = clamp(-wy / c.RATE.yaw, -1, 1);
    i.roll = clamp(-wz / c.RATE.roll, -1, 1);
    this.attErr = ang;
  }

  _eta() {
    const d = this.info.d, v = this.info.vc;
    if (this.phase === 'jump') return 10;
    return v > 1e-6 ? d / v : Infinity;
  }

  phaseLabel() {
    return { jump: 'jump', transfer: this._routing ? `transfer · round the ${this._routing === 'body' ? 'body' : 'station'}` : 'transfer', approach: 'approach', final: this.port && this.port.kind === 'pad' ? 'final · descent' : 'final · closing', touchdown: 'touchdown' }[this.phase] || this.phase;
  }
}
