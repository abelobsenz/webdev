import * as THREE from 'three';

/**
 * Cinematic camera paths.
 *
 *  - CameraPath: a centripetal Catmull-Rom spline through key positions, with phantom end points
 *    that set the entry/exit tangents, and an arc-length table so motion is parameterised by
 *    distance (constant visual speed, no bunching at the keys).
 *  - SpeedProfile: a smooth trapezoid (ease in, cruise, ease out) from entry speed v0 to exit speed
 *    v1, so consecutive legs join without a velocity jump.
 *  - planFlight(): builds a collision-free path between two poses. It lays out departure, cruise
 *    and approach keys, then samples the spline against terrain, roofs and colliders and pushes
 *    interior keys clear until the whole path is safe.
 *  - FlightDriver / DwellDriver: drive the camera along a leg (position, orientation with
 *    look-ahead that blends between subjects, gentle banking) and the slow orbit / dolly that
 *    follows each arrival.
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const smootherstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };

/** yaw/pitch (YXZ, camera looks down -Z) that point from `from` towards `to`. */
export function yawPitch(from, to, out = { yaw: 0, pitch: 0 }) {
  _a.subVectors(to, from);
  const l = _a.length() || 1;
  out.yaw = Math.atan2(-_a.x, -_a.z);
  out.pitch = Math.asin(clamp(_a.y / l, -1, 1));
  return out;
}

export function quatFromYawPitch(yaw, pitch, roll = 0, out = new THREE.Quaternion()) {
  _e.set(pitch, yaw, roll, 'YXZ');
  return out.setFromEuler(_e);
}

export function quatLookFrom(from, to, out = new THREE.Quaternion(), maxPitch = 1.5) {
  const yp = yawPitch(from, to);
  return quatFromYawPitch(yp.yaw, clamp(yp.pitch, -maxPitch, maxPitch), 0, out);
}

// ----------------------------------------------------------------- path --
export class CameraPath {
  /**
   * @param {THREE.Vector3[]} points  key positions (>= 2)
   * @param {object} o  { startDir, endDir } unit vectors for the entry / exit tangent (optional)
   */
  constructor(points, { startDir = null, endDir = null } = {}) {
    this.keys = points.map((p) => p.clone());
    this.startDir = startDir ? startDir.clone() : null;
    this.endDir = endDir ? endDir.clone() : null;
    this.rebuild();
  }

  rebuild() {
    const k = this.keys;
    const n = k.length;
    const first = k[0], last = k[n - 1];
    const d0 = first.distanceTo(k[1]) || 1, d1 = last.distanceTo(k[n - 2]) || 1;
    const ps = this.startDir ? first.clone().addScaledVector(this.startDir, -d0) : first.clone().multiplyScalar(2).sub(k[1]);
    const pe = this.endDir ? last.clone().addScaledVector(this.endDir, d1) : last.clone().multiplyScalar(2).sub(k[n - 2]);
    this.curve = new THREE.CatmullRomCurve3([ps, ...k, pe], false, 'centripetal', 0.5);
    // arc-length table over the native parameter
    const segs = n + 1;
    const per = 48;
    const M = segs * per;
    this.tTab = new Float32Array(M + 1);
    this.sTab = new Float32Array(M + 1);
    let s = 0;
    const prev = this.curve.getPoint(0, new THREE.Vector3());
    const cur = new THREE.Vector3();
    for (let i = 0; i <= M; i++) {
      const t = i / M;
      this.curve.getPoint(t, cur);
      if (i > 0) s += cur.distanceTo(prev);
      prev.copy(cur);
      this.tTab[i] = t; this.sTab[i] = s;
    }
    this.sStart = this._sAtT(1 / segs);
    this.sEnd = this._sAtT(n / segs);
    this.length = Math.max(this.sEnd - this.sStart, 1e-3);
    this.keyS = k.map((_, i) => this._sAtT((i + 1) / segs) - this.sStart);
  }

  _sAtT(t) {
    const M = this.tTab.length - 1;
    const f = t * M;
    const i = Math.min(Math.floor(f), M - 1);
    return this.sTab[i] + (this.sTab[i + 1] - this.sTab[i]) * (f - i);
  }

  _tAtS(s) {
    const S = this.sTab;
    let lo = 0, hi = S.length - 1;
    if (s <= S[0]) return 0;
    if (s >= S[hi]) return 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] < s) lo = m; else hi = m; }
    const f = (s - S[lo]) / Math.max(S[hi] - S[lo], 1e-9);
    return this.tTab[lo] + (this.tTab[hi] - this.tTab[lo]) * f;
  }

  /** Position at distance s (metres from the first key). Extrapolates slightly past the ends. */
  pointAt(s, out = new THREE.Vector3()) {
    return this.curve.getPoint(this._tAtS(this.sStart + s), out);
  }

  tangentAt(s, out = new THREE.Vector3()) {
    return this.curve.getTangent(this._tAtS(this.sStart + clamp(s, 0, this.length)), out);
  }

  /** Native curve parameter of a key index (0..keys-1) expressed as normalised distance. */
  keyFraction(i) { return this.keyS[i] / this.length; }
}

// -------------------------------------------------------- speed profile --
export class SpeedProfile {
  constructor(L, T, v0 = 0, v1 = 0, accel = 0.36, decel = 0.42) {
    this.L = L; this.T = Math.max(T, 0.05);
    const ta = this.T * accel, td = this.T * decel, tc = Math.max(this.T - ta - td, 0);
    // keep the exit/entry speeds physically possible for short legs
    const maxEnd = (L / this.T) * 1.6;
    v0 = Math.min(v0, maxEnd); v1 = Math.min(v1, maxEnd);
    let vm = (L - v0 * ta / 2 - v1 * td / 2) / (ta / 2 + tc + td / 2);
    if (vm < 0) { v0 = v1 = 0; vm = L / (ta / 2 + tc + td / 2); }
    Object.assign(this, { ta, td, tc, v0, v1, vm });
  }

  s(t) {
    const { ta, td, tc, v0, v1, vm, T } = this;
    t = clamp(t, 0, T);
    const I = (x) => x * x * x - (x * x * x * x) / 2;          // ∫ smoothstep
    if (t <= ta) return v0 * t + (vm - v0) * ta * I(t / ta);
    const sA = v0 * ta + (vm - v0) * ta * 0.5;
    if (t <= ta + tc) return sA + vm * (t - ta);
    const sC = sA + vm * tc;
    const u = t - ta - tc;
    return Math.min(sC + vm * u + (v1 - vm) * td * I(u / td), this.L + 1e-6);
  }

  v(t) {
    const { ta, td, tc, v0, v1, vm, T } = this;
    t = clamp(t, 0, T);
    const S = (x) => x * x * (3 - 2 * x);
    if (t <= ta) return v0 + (vm - v0) * S(t / ta);
    if (t <= ta + tc) return vm;
    return vm + (v1 - vm) * S((t - ta - tc) / td);
  }
}

// --------------------------------------------------------------- planner --
/**
 * Plan a safe spline from (from, moving along fromDir at speed v0) to (to, looking at toLook,
 * leaving along endDir at speed v1).
 * Returns { path, ok } — ok=false means some residual clearance violation remained.
 */
export function planFlight(model, from, to, { fromDir = null, endDir = null, toLook = null, minClear = 14, pad = 34, cruiseLift = 1 } = {}) {
  const d = from.distanceTo(to);
  const toward = _a.subVectors(to, from).normalize().clone();
  const flatToward = toward.clone(); flatToward.y = 0;
  if (flatToward.lengthSq() < 1e-6) flatToward.set(0, 0, -1); else flatToward.normalize();

  // departure: blend the current heading with the destination, with a gentle rise
  const k1 = clamp(d * 0.14, 12, 520);
  const dep = new THREE.Vector3();
  if (fromDir && fromDir.lengthSq() > 1e-6) dep.copy(fromDir).normalize().multiplyScalar(0.55).addScaledVector(toward, 0.45);
  else dep.copy(toward);
  dep.y += 0.18 + (d > 2500 ? 0.12 : 0);
  dep.normalize();
  const D = from.clone().addScaledVector(dep, k1);

  // approach: come in along the exit direction (keeps the dwell move continuous)
  const k2 = clamp(d * 0.2, 14, 760);
  let arrive = endDir && endDir.lengthSq() > 1e-6 ? endDir.clone().normalize() : null;
  if (!arrive) {
    arrive = toLook ? _b.subVectors(toLook, to).setY(0).normalize().clone() : flatToward.clone();
    if (arrive.lengthSq() < 1e-6) arrive.copy(flatToward);
  }
  const A = to.clone().addScaledVector(arrive, -k2);
  A.y += Math.min(k2 * 0.22, 160) * (to.y < 60 ? 0.6 : 1);

  const keys = [from.clone(), D];
  const dh = Math.hypot(to.x - from.x, to.z - from.z);
  const lift = clamp(dh * 0.055, 0, 650) * cruiseLift;
  if (dh > 700) {
    const nMid = dh > 6500 ? 2 : 1;
    for (let i = 1; i <= nMid; i++) {
      const f = i / (nMid + 1);
      const m = D.clone().lerp(A, f);
      m.y = Math.max(m.y, THREE.MathUtils.lerp(D.y, A.y, f) + lift * Math.sin(Math.PI * f));
      keys.push(m);
    }
  }
  keys.push(A, to.clone());
  // drop keys that are too close to their neighbours (degenerate spans)
  const clean = [keys[0]];
  for (let i = 1; i < keys.length; i++) {
    const minGap = Math.max(4, d * 0.04);
    if (keys[i].distanceTo(clean[clean.length - 1]) > minGap || i === keys.length - 1) clean.push(keys[i]);
  }
  if (clean.length === 2 && d > 1) clean.splice(1, 0, from.clone().lerp(to, 0.5));
  const path = new CameraPath(clean, { startDir: fromDir && fromDir.lengthSq() > 1e-6 ? fromDir.clone().normalize() : dep, endDir: arrive });
  const ok = model ? makeSafe(model, path, { minClear, pad }) : true;
  return { path, ok };
}

/**
 * Iteratively move interior keys until the sampled path keeps `minClear` above terrain/roofs
 * and `pad` from colliders. Clearance tapers near the end points (which may be low vantage
 * points by design).
 */
export function makeSafe(model, path, { minClear = 14, pad = 34, iterations = 10 } = {}) {
  const p = new THREE.Vector3();
  const endClear = [clearanceAt(model, path.keys[0]), clearanceAt(model, path.keys[path.keys.length - 1])];
  for (let insert = 0; insert < 3; insert++) {
    for (let it = 0; it < iterations; it++) {
      const n = path.keys.length;
      const push = path.keys.map(() => new THREE.Vector3());
      const L = path.length;
      const steps = Math.min(1000, Math.max(40, Math.ceil(L / 10)));
      let worst = 0, worstS = 0;
      for (let i = 0; i <= steps; i++) {
        const s = (i / steps) * L;
        path.pointAt(s, p);
        const de = Math.min(s, L - s);
        const endC = s < L / 2 ? endClear[0] : endClear[1];
        const taper = clamp(de / 160, 0, 1);
        const need = THREE.MathUtils.lerp(Math.min(endC, minClear), minClear, taper);
        const padHere = THREE.MathUtils.lerp(Math.min(pad, 6), pad, taper);
        const fl = model.planFloor(p.x, p.z);
        const vert = fl + need - p.y;
        const pen = de > 3 ? model.penetration(p.x, p.y, p.z, padHere, true) : null;
        let v = null;
        if (vert > 0.25 && de > 2) v = _c.set(0, vert, 0);
        if (pen && pen.depth > 0.25) {
          const c = pen.c;
          const over = c.y1 !== undefined ? c.y1 + padHere - p.y : Infinity;
          if (over < pen.depth * 2.5 && over < 400) v = (v || _c.set(0, 0, 0)).set(v ? v.x : 0, Math.max(v ? v.y : 0, over), v ? v.z : 0);
          else {
            // push sideways, perpendicular to the path, towards the side we are already on
            const tng = path.tangentAt(s, _b);
            let sx = -tng.z, sz = tng.x;
            const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
            const side = Math.sign(sx * pen.nx + sz * pen.nz) || 1;
            const mag = pen.depth + 10;
            v = (v || _c.set(0, 0, 0));
            v.x += sx * side * mag; v.z += sz * side * mag;
          }
        }
        if (!v) continue;
        const mag = v.length();
        if (mag > worst) { worst = mag; worstS = s; }
        // distribute to interior keys by proximity along the path
        const f = s / L;
        for (let k = 1; k < n - 1; k++) {
          const kf = path.keyFraction(k);
          const span = 1.35 / (n - 1);
          const w = Math.max(0, 1 - Math.abs(f - kf) / span);
          if (w <= 0) continue;
          const wv = _a.copy(v).multiplyScalar(w * 1.25);
          if (wv.y > push[k].y) push[k].y = wv.y;
          if (Math.abs(wv.x) > Math.abs(push[k].x)) push[k].x = wv.x;
          if (Math.abs(wv.z) > Math.abs(push[k].z)) push[k].z = wv.z;
        }
      }
      if (worst <= 0.25) return true;
      let moved = false;
      for (let k = 1; k < n - 1; k++) if (push[k].lengthSq() > 0.01) { path.keys[k].add(push[k]); moved = true; }
      if (!moved) break;
      path.rebuild();
      if (it === iterations - 1) { path._worstS = worstS; }
    }
    // still unsafe: add a high key above the worst spot and try again
    const s = path._worstS ?? path.length / 2;
    const q = path.pointAt(s, new THREE.Vector3());
    q.y = Math.max(q.y, model.planFloor(q.x, q.z) + minClear + 60);
    const f = s / path.length;
    let idx = 1;
    while (idx < path.keys.length - 1 && path.keyFraction(idx) < f) idx++;
    path.keys.splice(idx, 0, q);
    path.rebuild();
  }
  return false;
}

function clearanceAt(model, p) {
  return Math.max(p.y - model.planFloor(p.x, p.z), 0.5);
}

/** Check a sampled trajectory function f(t)->Vector3 for violations (used for dwell moves). */
export function trajectoryIsSafe(model, fn, T, { minClear = 10, pad = 30 } = {}) {
  const p = new THREE.Vector3();
  const start = fn(0, new THREE.Vector3());
  const startClear = clearanceAt(model, start);
  const need = Math.min(minClear, startClear * 0.8);
  for (let i = 1; i <= 24; i++) {
    fn((i / 24) * T, p);
    if (p.y < model.planFloor(p.x, p.z) + need) return false;
    const pen = model.penetration(p.x, p.y, p.z, Math.min(pad, 8 + i * 2), true);
    if (pen && pen.depth > 0.5) return false;
  }
  return true;
}

// ------------------------------------------------------------- drivers --
/**
 * Drives the camera along a CameraPath with a SpeedProfile. Orientation blends a look-ahead
 * along the path with a subject that moves from `fromLook` to `toLook`, then a critically
 * damped rotation smooths the result. Adds a gentle bank into turns.
 */
export class FlightDriver {
  constructor(path, { duration, v0 = 0, v1 = 0, fromLook = null, toLook, fov0 = null, fov1 = null, interruptible = true, onDone = null, bank = true, trackPeak = null, kind = 'flight', timeOffset = 0, accel = 0.36, decel = 0.42 }) {
    this.kind = kind;
    this.path = path;
    this.dur = duration;
    this.t = 0;                  // normalised progress (kept for API compatibility)
    this.time = timeOffset;
    this.profile = new SpeedProfile(path.length, duration, v0, v1, accel, decel);
    this.fromLook = fromLook ? fromLook.clone() : null;
    this.toLook = toLook.clone();
    this.fov0 = fov0; this.fov1 = fov1;
    this.interruptible = interruptible;
    this.onDone = onDone;
    this.bank = bank;
    const L = path.length;
    this.trackPeak = trackPeak ?? clamp((L - 250) / 2600, 0, 0.82);
    this.lookAhead = clamp(L * 0.1, 50, 1100);
    this.q = null;
    this.qVel = 0;
    this.roll = 0;
    this.prevYaw = null;
    this.subject = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
  }

  /** Advance and write the pose. Returns false once finished. */
  update(dt, cam, ctl) {
    const prevPos = this.pos.clone();
    this.time = Math.min(this.time + dt, this.dur);
    const T = this.dur;
    this.t = this.time / T;
    const s = this.profile.s(this.time);
    const L = this.path.length;
    this.path.pointAt(s, this.pos);
    const speed = this.profile.v(this.time);
    this.path.tangentAt(s, this.vel).multiplyScalar(speed);
    cam.position.copy(this.pos);

    // subject drifts from the old focus to the new one
    const u = s / L;
    if (!this.fromLook) this.fromLook = this.toLook.clone();
    this.subject.copy(this.fromLook).lerp(this.toLook, smootherstep(0.12, 0.82, u));
    const qSub = quatLookFrom(this.pos, this.subject, _q, 1.45);
    // look-ahead along the path (limited pitch so descents do not stare at the ground)
    const ahead = this.path.pointAt(Math.min(s + this.lookAhead, L + this.lookAhead * 0.5), _b);
    const yp = yawPitch(this.pos, ahead);
    const qTrack = quatFromYawPitch(yp.yaw, clamp(yp.pitch, -0.42, 0.34), 0, _q2);
    const w = this.trackPeak * Math.pow(Math.sin(Math.PI * clamp(u * 1.05, 0, 1)), 1.4);
    const target = qSub.clone().slerp(qTrack, w);
    if (!this.q) this.q = cam.quaternion.clone();
    // critically damped approach to the target orientation (stiffer near the end so we land exactly)
    const stiff = 3.2 + 9 * smoothstep(0.82, 1, this.t);
    this.q.slerp(target, 1 - Math.exp(-dt * stiff));
    // bank into turns
    _e.setFromQuaternion(this.q, 'YXZ');
    let yaw = _e.y;
    if (this.bank && this.prevYaw !== null && dt > 0) {
      let dy = yaw - this.prevYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const rate = dy / dt;
      const want = clamp(-rate * 0.22 * clamp(speed / 120, 0, 1), -0.07, 0.07);
      this.roll += (want - this.roll) * (1 - Math.exp(-dt * 2.2));
    }
    this.prevYaw = yaw;
    ctl._setOrientation(_e.y, _e.x, this.roll * (1 - smoothstep(0.85, 1, this.t)));
    if (this.fov0 != null && this.fov1 != null) ctl.baseFov = THREE.MathUtils.lerp(this.fov0, this.fov1, smootherstep(0, 1, this.t));
    if (this.time >= T) {
      if (this.onDone) { const f = this.onDone; this.onDone = null; f(this); }
      return false;
    }
    return true;
  }
}

/**
 * The slow move that follows an arrival: an orbit arc around `center` (angular speed `omega`)
 * with a slight dolly and rise, always framing `look`.
 */
export class DwellDriver {
  constructor({ start, center, look, omega = 0, dolly = 0, rise = 0, truck = null, duration = 14, easeOut = false, kind = 'dwell' }) {
    this.kind = kind;
    this.easeOut = easeOut;
    this.start = start.clone();
    this.center = center.clone();
    this.look = look.clone();
    this.omega = omega;
    this.dolly = dolly;         // fraction of radius closed over the dwell
    this.rise = rise;           // metres per second
    this.truck = truck ? truck.clone() : null;  // linear drift (m/s) when there is no orbit
    this.dur = duration;
    this.t = 0;
    this.time = 0;
    this.interruptible = true;
    this.q = null;
    this.rel = new THREE.Vector3().subVectors(this.start, this.center);
    this.r0 = Math.hypot(this.rel.x, this.rel.z);
    this.a0 = Math.atan2(this.rel.z, this.rel.x);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
  }

  /** Position after `t` seconds (the motion eases out over the last third). */
  positionAt(t, out = new THREE.Vector3()) {
    const T = this.dur;
    // distance-like parameter: full speed for most of the dwell, easing to a halt at the very end
    const tau = !this.easeOut || t <= T * 0.7 ? t : T * 0.7 + (T * 0.3) * (1 - Math.pow(1 - (t - T * 0.7) / (T * 0.3), 2)) / 2;
    if (this.truck) {
      out.copy(this.start).addScaledVector(this.truck, tau);
      const toLook = _c.subVectors(this.look, this.start);
      out.addScaledVector(toLook, this.dolly * (tau / T));
      out.y += this.rise * tau;
      return out;
    }
    const a = this.a0 + this.omega * tau;
    const r = this.r0 * (1 - this.dolly * (tau / T));
    out.set(this.center.x + Math.cos(a) * r, this.start.y + this.rise * tau, this.center.z + Math.sin(a) * r);
    return out;
  }

  /** Velocity at t=0 (used to shape the incoming flight). */
  initialVelocity(out = new THREE.Vector3()) {
    const p0 = this.positionAt(0, _a), p1 = this.positionAt(0.05, _b);
    return out.subVectors(p1, p0).multiplyScalar(20);
  }

  update(dt, cam, ctl) {
    this.time += dt;
    this.t = Math.min(this.time / this.dur, 1);
    const prev = this.pos.clone();
    this.positionAt(Math.min(this.time, this.dur * (this.easeOut ? 1 : 1.5)), this.pos);
    if (dt > 0 && this.time > dt) this.vel.subVectors(this.pos, prev).divideScalar(dt);
    cam.position.copy(this.pos);
    const target = quatLookFrom(this.pos, this.look, _q, 1.45);
    if (!this.q) this.q = cam.quaternion.clone();
    this.q.slerp(target, 1 - Math.exp(-dt * 4));
    _e.setFromQuaternion(this.q, 'YXZ');
    ctl._setOrientation(_e.y, _e.x, 0);
    return true;   // dwell never ends by itself; the director decides
  }
}

/** Slow orbit used by the legacy `startOrbit` API. */
export class OrbitDriver {
  constructor({ center, radius, height, angle, speed, lookOffsetY = 0 }) {
    this.kind = 'orbit';
    Object.assign(this, { center: center.clone(), radius, height, angle, speed, lookOffsetY });
    this.interruptible = true;
    this.q = null;
    this.vel = new THREE.Vector3();
  }

  update(dt, cam, ctl) {
    this.angle += this.speed * dt;
    const p = _a.set(this.center.x + Math.cos(this.angle) * this.radius, this.center.y + this.height, this.center.z + Math.sin(this.angle) * this.radius);
    const prev = cam.position.clone();
    cam.position.lerp(p, 1 - Math.exp(-dt * 2.0));
    if (dt > 0) this.vel.subVectors(cam.position, prev).divideScalar(dt);
    const tgt = _b.copy(this.center); tgt.y += this.lookOffsetY;
    const target = quatLookFrom(cam.position, tgt, _q, 1.45);
    if (!this.q) this.q = cam.quaternion.clone();
    this.q.slerp(target, 1 - Math.exp(-dt * 2.5));
    _e.setFromQuaternion(this.q, 'YXZ');
    ctl._setOrientation(_e.y, _e.x, 0);
    return true;
  }
}

export { UP };
