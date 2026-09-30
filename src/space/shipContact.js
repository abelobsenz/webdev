import * as THREE from 'three';
import { LODESTAR_FEET, LODESTAR_DOCK } from './starship.js';
import { moonGround } from './moonHeight.js';
import { R_MOON } from './sim.js';
import { getPorts } from './ports.js';

// The Lodestar touching things: its three landing legs and its hull against the Moon's ground and
// the raised landing pads, and its dorsal docking ring against station ports.
//
// Legs. Each foot (LODESTAR_FEET, ship-local metres; the ship root is in km) rides on an oleo strut:
// a progressive air spring with a damper over a 0.6 m stroke, then a hard stop. The feet are held
// by friction (a static anchor spring up to mu_s times the load, sliding at mu_k beyond it), and the
// contact forces act at the feet, so their torques settle the ship level on its legs across a slope.
// Everything is mass-normalised: forces are accelerations (km/s^2), torques angular accelerations
// through the hull's radii of gyration.
//
// Hull. With the legs up (or a landing hard enough to bottom the struts) the belly, chines, nose and
// tail touch down on stiff, well-damped contact points; a guard pushes the ship back out of the
// ground if it arrives too fast for the springs (no tunnelling).
//
// Surfaces. On the Moon, moonGround(dir) (body frame = the pilot's 'moon' frame) gives the ground
// height and normal under each point; any 'pad' port nearby (ports.js) is a raised disc at its pose,
// in whatever frame the ship is in (pads on stations move: their velocity is the port's, measured by
// differencing its pose). The highest surface under a point is the one it stands on.
//
// Docking. When the docking ring (LODESTAR_DOCK) comes within 1.5 m of a 'dock' port closing slower
// than 0.3 m/s with its axis and roll both within 5 degrees, the latches take it: a short soft
// capture draws the ship onto the port, and from then on its pose is the port's (the pilot locks it
// every frame, riding the station's spin and orbit).

const KM = 0.001;
export const STROKE = 0.6 * KM;               // oleo stroke (km)
const K_LEG = 6.0, C_LEG = 2.4;                // per foot (1/s^2, 1/s), mass-normalised
const K_HARD = 700, C_HARD = 40;               // hull and bottomed-out struts
const MU_S = 0.8, MU_K = 0.45, K_T = 60, C_T = 14;
const GYR2 = [0.0100 ** 2, 0.0105 ** 2, 0.0045 ** 2];   // radii of gyration^2 (km^2): pitch x, yaw y, roll z
const PAD_R = 0.02, PAD_H = 1.2 * KM;          // default pad radius (km) and the depth of a raised slab
export const CAPTURE = { dist: 1.5 * KM, speed: 0.3 * KM, axis: 5 * Math.PI / 180, roll: 5 * Math.PI / 180 };

const V = () => new THREE.Vector3();
const FEET_DOWN = LODESTAR_FEET.map((p) => p.clone().multiplyScalar(KM));
const FEET_UP = LODESTAR_FEET.map((p) => new THREE.Vector3(p.x * 0.7, -1.7, p.z).multiplyScalar(KM));
/** Feet centroid with the legs down (ship-local km): the point the autopilot centres on a pad. */
export const FEET_CENTRE = FEET_DOWN.reduce((a, p) => a.add(p), V()).divideScalar(FEET_DOWN.length);
export const DOCK_POS = LODESTAR_DOCK.pos.clone().multiplyScalar(KM);
export const DOCK_AXIS = LODESTAR_DOCK.axis.clone().normalize();
// the hull's touch points (metres): keel, chines, nose, tail, dorsal hump, engine bells
const HULL = [
  [0, -1.5, -12], [0, -1.55, -4], [0, -1.5, 4], [0, -1.4, 11], [0, -1.2, 15.5],
  [4.6, -0.6, -2], [-4.6, -0.6, -2], [4.9, -0.4, 8], [-4.9, -0.4, 8], [4.2, -0.2, 14.5], [-4.2, -0.2, 14.5],
  [0, 0, -19.6], [0, 0.4, 16], [0, 2.6, -9], [0, 1.8, 6], [3.2, 1.0, 0], [-3.2, 1.0, 0],
].map(([x, y, z]) => new THREE.Vector3(x, y, z).multiplyScalar(KM));

const _r = V(), _P = V(), _vP = V(), _w = V(), _F = V(), _t = V(), _g = V(), _n = V(), _q = new THREE.Quaternion();

/** A port's pose followed over time, in the pilot's current frame: position, axes, velocity, spin. */
export class PortTrack {
  constructor(port) {
    this.port = port;
    this.pos = V(); this.n = V(); this.fwd = V(); this.vel = V(); this.acc = V(); this.omega = V();
    this.q = new THREE.Quaternion();
    this.frame = null; this.ok = false; this.age = 0;
    this._w = { pos: V(), n: V(), fwd: V() };
  }
  /** Sample the pose now (dt: time since the last sample) in the pilot's frame. */
  sense(pilot, dt) {
    const w = this.port.pose(pilot.space, this._w);
    const p = pilot.toLocal(w.pos, V()), n = pilot.dirToLocal(w.n, V()).normalize(), f = pilot.dirToLocal(w.fwd, V());
    f.addScaledVector(n, -f.dot(n)).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V().crossVectors(n, f), n, f));
    if (this.ok && this.frame === pilot.frame && dt > 1e-4) {
      const v = V().copy(p).sub(this.pos).divideScalar(dt);
      const a = V().copy(v).sub(this._vm || v).divideScalar(dt);
      (this._vm || (this._vm = V())).copy(v);
      const k = this.age < 2 ? 1 : 1 - Math.exp(-dt / 0.25);
      this.acc.lerp(a, this.age < 3 ? 0 : k);
      // the difference is the mean velocity over the interval, i.e. at its midpoint: bring it to now
      this.vel.copy(v).addScaledVector(this.acc, dt / 2);
      // spin: the rotation from the last attitude to this one
      const dq = this.q.clone().invert().premultiply(q);          // q * q0^-1 (frame)
      if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
      const s = Math.sqrt(1 - Math.min(1, dq.w * dq.w)), ang = 2 * Math.acos(Math.min(1, dq.w));
      const om = s > 1e-9 ? V().set(dq.x, dq.y, dq.z).multiplyScalar(ang / s / dt) : V();
      this.omega.lerp(om, this.age < 2 ? 1 : 1 - Math.exp(-dt / 0.15));
      this.age++;
    } else { this.vel.set(0, 0, 0); this.acc.set(0, 0, 0); this.omega.set(0, 0, 0); this.age = 0; this._vm = null; }
    this.pos.copy(p); this.n.copy(n); this.fwd.copy(f); this.q.copy(q);
    this.frame = pilot.frame; this.ok = true;
    return this;
  }
  /** The pose extrapolated s seconds past the last sample. */
  at(s, out) {
    out.pos = (out.pos || V()).copy(this.pos).addScaledVector(this.vel, s).addScaledVector(this.acc, 0.5 * s * s);
    const ang = this.omega.length() * s;
    _q.setFromAxisAngle(ang > 1e-12 ? _t.copy(this.omega).normalize() : _t.set(0, 1, 0), ang);
    out.n = (out.n || V()).copy(this.n).applyQuaternion(_q);
    out.fwd = (out.fwd || V()).copy(this.fwd).applyQuaternion(_q);
    out.q = (out.q || new THREE.Quaternion()).copy(this.q).premultiply(_q);
    return out;
  }
  /** Velocity (frame) of the structure's point at p (spin included). */
  pointVel(p, s, out) {
    return out.crossVectors(this.omega, _t.copy(p).sub(this.pos).addScaledVector(this.vel, -s)).add(this.vel).addScaledVector(this.acc, s);
  }
}

/** The mated ship attitude for a port (frame quaternion): docks put the dorsal ring on the face, pads the legs on the deck. */
export function matedQuat(kind, n, fwd, out = new THREE.Quaternion()) {
  const y = V().copy(n); if (kind !== 'pad') y.negate();
  const z = V().copy(fwd).negate();
  z.addScaledVector(y, -z.dot(y)).normalize();
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V().crossVectors(y, z), y, z));
}

export class ShipContact {
  constructor(pilot) {
    this.pilot = pilot;
    this.gear = [0, 0, 0];
    this.feet = FEET_DOWN.map(() => ({ touch: false, anchor: V(), anchored: false, pen: 0 }));
    this.hullTouch = 0; this.footTouch = 0;
    this.landed = false; this._still = 0;
    this.pads = [];               // nearby pads: { track, r }
    this._padT = 0; this._tracks = new Map();
    this.impact = 0; this.maxPen = 0;
    this.ground = moonGround;     // replaceable (the verification harness supplies its own)
    this._gnd = { normal: V() };
    this.slope = 0; this.agl = Infinity; this.groundN = V(0, 1, 0);
  }

  /** Once per frame: find the pads near the ship and follow them. */
  sense(dt) {
    const p = this.pilot, sp = p.space;
    if ((this._padT -= dt) <= 0) {
      this._padT = 0.5;
      const Pw = p.worldPos(V()), list = [];
      for (const port of getPorts(sp)) {
        if (port.kind !== 'pad') continue;
        const w = port.pose(sp, {});
        if (w.pos.distanceTo(Pw) < 3) list.push(port);
      }
      for (const k of [...this._tracks.keys()]) if (!list.includes(k)) this._tracks.delete(k);
      for (const port of list) if (!this._tracks.has(port)) this._tracks.set(port, new PortTrack(port));
    }
    this.pads.length = 0;
    for (const [port, tr] of this._tracks) { tr.sense(p, dt); this.pads.push({ tr, r: Math.min(Math.max(port.radius || port.clear || PAD_R, 0.012), 0.08) }); }
    this._s = -dt;                 // the ship integrates from the last frame up to this one: poses are extrapolated back by dt
  }

  /** The surface under a frame point: height above it (km), its normal and velocity. null: none near. */
  surface(P, out) {
    let best = null;
    if (this.pilot.frame === 'moon') {
      const L = P.length();
      if (L < R_MOON + 40) {
        const g = this.ground(_g.copy(P).divideScalar(L), this._gnd);
        const Rg = R_MOON + g.h;
        const hgt = (L - Rg) * Math.max(0.2, g.normal.dot(_g));
        best = out; out.h = hgt; out.n.copy(g.normal); out.v.set(0, 0, 0); out.pad = null;
      }
    }
    for (const pd of this.pads) {
      const tr = pd.tr, pose = tr.at(this._s, this._pose || (this._pose = {}));
      _t.copy(P).sub(pose.pos);
      const hgt = _t.dot(pose.n);
      if (hgt < -PAD_H - 0.5 * KM || hgt > 0.05) continue;
      if (_t.addScaledVector(pose.n, -hgt).length() > pd.r) continue;
      if (best && best.h <= hgt) continue;
      best = out; out.h = hgt; out.n.copy(pose.n); tr.pointVel(P, this._s, out.v); out.pad = tr.port;
    }
    return best;
  }

  /**
   * One physics step: accumulate the contact accelerations. lin (frame, km/s^2) and ang (body,
   * rad/s^2 on the ship's x, y, z axes) are added to. Returns true when anything touches.
   */
  step(h, lin, ang) {
    const p = this.pilot, q = p.quat, legs = p.legPos;
    // angular velocity in the frame (the ship's body rates: pitch x, yaw -y, roll -z)
    _w.set(p.rates.x, -p.rates.y, -p.rates.z).applyQuaternion(q);
    const up = V().set(0, 1, 0).applyQuaternion(q);
    const S = this._sf || (this._sf = { n: V(), v: V(), h: 0, pad: null });
    let touch = 0, hull = 0, impact = 0;
    const torque = V();
    const apply = (r, F) => { lin.add(F); torque.add(_t.crossVectors(r, F)); };
    // ---- the three feet
    const legsOK = legs > 0.9;
    for (let i = 0; i < 3; i++) {
      const ft = this.feet[i];
      _r.lerpVectors(FEET_UP[i], FEET_DOWN[i], legs).applyQuaternion(q);
      _P.copy(p.pos).add(_r);
      const s = this.surface(_P, S);
      ft.pen = 0;
      if (!s || s.h >= 0) { ft.touch = false; ft.anchored = false; this.gear[i] += (0 - this.gear[i]) * Math.min(1, h * 10); continue; }
      const pen = -s.h;
      _vP.crossVectors(_w, _r).add(p.vel).sub(s.v);
      const vn = _vP.dot(s.n);
      let Fn;
      if (legsOK) {
        const c = pen / STROKE;
        Fn = c <= 1 ? K_LEG * pen * (1 + 3 * c * c) - C_LEG * vn : K_LEG * STROKE * 4 + K_HARD * (pen - STROKE) - C_HARD * vn;
        if (c > 1) hull++;
      } else { Fn = K_HARD * pen - C_HARD * vn; hull++; }
      Fn = Math.max(Fn, 0);
      if (!ft.touch) impact = Math.max(impact, -vn);
      ft.touch = true; ft.pen = pen; touch++;
      this.gear[i] = legsOK ? Math.min(pen / STROKE, 1) : 0;
      _F.copy(s.n).multiplyScalar(Fn);
      // friction: a static anchor spring up to mu_s N, sliding at mu_k N beyond it
      const vt = _vP.addScaledVector(s.n, -vn);
      if (!ft.anchored) { ft.anchor.copy(_P); ft.anchored = true; }
      const disp = V().copy(_P).sub(ft.anchor); disp.addScaledVector(s.n, -disp.dot(s.n));
      const Ft = V().copy(disp).multiplyScalar(-K_T).addScaledVector(vt, -C_T);
      const lim = MU_S * Fn;
      if (Ft.length() > lim) { Ft.setLength(MU_K * Fn); ft.anchor.copy(_P); }
      _F.add(Ft);
      apply(_r, _F);
    }
    this.footTouch = touch;
    // ---- the hull
    let deepest = 0;
    for (const hp of HULL) {
      _r.copy(hp).applyQuaternion(q);
      _P.copy(p.pos).add(_r);
      const s = this.surface(_P, S);
      if (!s || s.h >= 0) continue;
      const pen = -s.h;
      _vP.crossVectors(_w, _r).add(p.vel).sub(s.v);
      const vn = _vP.dot(s.n);
      if (hull === 0 && touch === 0) impact = Math.max(impact, -vn);
      const Fn = Math.max(K_HARD * pen - C_HARD * vn, 0);
      _F.copy(s.n).multiplyScalar(Fn);
      const vt = _vP.addScaledVector(s.n, -vn), vtl = vt.length();
      if (vtl > 1e-9) _F.addScaledVector(vt, -Math.min(MU_K * Fn / vtl, 1 / h * 0.5));    // skidding
      apply(_r, _F);
      hull++; touch++;
      if (pen > deepest) { deepest = pen; this._deepN = (this._deepN || V()).copy(s.n); this._deepV = (this._deepV || V()).copy(s.v); }
    }
    // anti-tunnelling: a point more than a metre into the surface is put back on it
    if (deepest > 1.0 * KM) {
      p.pos.addScaledVector(this._deepN, deepest - 0.5 * KM);
      const vn = _t.copy(p.vel).sub(this._deepV).dot(this._deepN);
      if (vn < 0) p.vel.addScaledVector(this._deepN, -vn * 1.2);
    }
    this.maxPen = Math.max(this.maxPen, deepest);
    this.hullTouch = hull;
    // torque -> body angular acceleration
    torque.applyQuaternion(_q.copy(q).invert());
    ang.x += torque.x / GYR2[0]; ang.y += torque.y / GYR2[1]; ang.z += torque.z / GYR2[2];
    // a hull grinding on the ground loses its spin quickly (scraping, and the ground giving way)
    if (hull > 0) { const k = Math.min(2.5 * hull, 12); ang.x -= k * p.rates.x; ang.y += k * p.rates.y; ang.z += k * p.rates.z; }
    if (impact > 0) this._impact(impact, hull > 0);
    // landed: all three feet down, the ship still relative to the ground
    const still = touch >= 3 && legsOK && hull === 0 && p.vel.length() < 0.06 * KM && p.rates.length() < 0.01;
    this._still = still ? this._still + h : 0;
    if (!this.landed && this._still > 0.6) { this.landed = true; if (p.onLanded) p.onLanded(); }
    if (this.landed && touch < 2) this.landed = false;
    // tipping: the ship's up axis too far from the ground's
    if (touch && up.dot(S.n) < 0.64 && !this._tipWarn) { this._tipWarn = true; p._flash('tipping over'); }
    if (up.dot(S.n) > 0.8) this._tipWarn = false;
    this._s += h;
    return touch > 0;
  }

  _impact(v, hard) {
    const p = this.pilot;
    if (this._impT && p.time - this._impT < 1.5) return;
    this._impT = p.time;
    this.impact = v;
    const ms = (v / KM).toFixed(1);
    if (hard || v > 3 * KM) p._flash(v > 6 * KM ? `crash: ${ms} m/s` : `hard ${hard ? 'contact' : 'landing'} ${ms} m/s`);
    else if (v > 0.02 * KM) p._flash(`touchdown ${ms} m/s`);
    if (p.onTouch) p.onTouch(v, hard);
  }

  /** Landing aids: radar altitude of the lowest foot, the ground's slope and normal. */
  survey() {
    const p = this.pilot, S = this._sv || (this._sv = { n: V(), v: V(), h: 0, pad: null });
    this._s = this._s || 0;
    let agl = Infinity;
    for (let i = 0; i < 3; i++) {
      _r.lerpVectors(FEET_UP[i], FEET_DOWN[i], p.legPos).applyQuaternion(p.quat);
      _P.copy(p.pos).add(_r);
      const s = this.surface(_P, S);
      if (s && s.h < agl) { agl = s.h; this.groundN.copy(s.n); this.padUnder = s.pad; }
    }
    if (agl === Infinity && p.frame === 'moon') {
      const L = p.pos.length(), g = this.ground(_g.copy(p.pos).divideScalar(L), this._gnd);
      agl = L - R_MOON - g.h; this.groundN.copy(g.normal); this.padUnder = null;
    }
    this.agl = agl;
    this.slope = agl < Infinity ? Math.acos(Math.min(1, this.groundN.dot(_n.copy(p.pos).normalize()))) : 0;
    if (p.frame !== 'moon' && agl < Infinity) this.slope = 0;
    return this;
  }

  /** Docking-ring alignment against a dock port (frame pose): distances and angles. */
  static ringState(pilot, pose, out = {}) {
    const q = pilot.quat;
    out.ring = (out.ring || V()).copy(DOCK_POS).applyQuaternion(q).add(pilot.pos);
    out.axis = (out.axis || V()).copy(DOCK_AXIS).applyQuaternion(q);
    out.d = out.ring.distanceTo(pose.pos);
    out.axisErr = Math.acos(Math.min(1, -out.axis.dot(pose.n)));
    const nose = V().set(0, 0, -1).applyQuaternion(q);
    nose.addScaledVector(pose.n, -nose.dot(pose.n));
    out.rollErr = nose.lengthSq() > 1e-12 ? Math.acos(Math.min(1, nose.normalize().dot(pose.fwd))) : Math.PI;
    return out;
  }
}
