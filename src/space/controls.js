import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Orbit camera for the space view: drag to rotate (with inertia), wheel or
 * pinch to zoom on a log scale, smooth flights between focus targets.
 * A target supplies position(out), frame(outQuat) (its "up" reference, e.g.
 * the Earth's axis or a co-rotating frame), and distance limits.
 */
export class OrbitRig {
  constructor(dom) {
    this.dom = dom;
    this.enabled = false;
    this.target = null;
    this.az = 0.6; this.el = 0.25; this.logD = Math.log(20000);
    this.goalAz = this.az; this.goalEl = this.el; this.goalLogD = this.logD;
    this.vAz = 0; this.vEl = 0;
    this.flight = null;
    this.pointers = new Map();
    this.onPick = null;
    this.onUser = null;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.lookAtPt = new THREE.Vector3();
    this._down = null;
    this._bind();
  }

  _bind() {
    const d = this.dom;
    d.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._down = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.pointers.size === 2) this._pinch = this._pinchDist();
      try { d.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
    });
    d.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this.pointers.has(e.pointerId)) return;
      const p = this.pointers.get(e.pointerId);
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 1) {
        const k = 0.0052;
        this.goalAz -= dx * k; this.goalEl += dy * k;
        this.goalEl = THREE.MathUtils.clamp(this.goalEl, -1.45, 1.45);
        this.vAz = -dx * k * 60; this.vEl = dy * k * 60;
        this._user();
      } else if (this.pointers.size === 2) {
        const pd = this._pinchDist();
        if (this._pinch && pd > 0) this.zoomBy(Math.log(this._pinch / pd) * 1.6);
        this._pinch = pd;
      }
    });
    const up = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this._pinch = null;
      if (this._down && this.enabled) {
        const moved = Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y);
        if (moved < 5 && performance.now() - this._down.t < 400 && this.onPick) this.onPick(e.clientX, e.clientY);
      }
      this._down = null;
    };
    d.addEventListener('pointerup', up);
    d.addEventListener('pointercancel', up);
    d.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.zoomBy(dy * 0.0016);
    }, { passive: false });
  }

  _pinchDist() {
    const a = [...this.pointers.values()];
    return a.length >= 2 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0;
  }

  _user() { if (this.onUser) this.onUser(); }

  zoomBy(dl) {
    if (!this.target) return;
    this.goalLogD = THREE.MathUtils.clamp(this.goalLogD + dl, Math.log(this.target.minDist), Math.log(this.target.maxDist));
    this._user();
  }

  rotateBy(dAz, dEl) {
    this.goalAz += dAz;
    this.goalEl = THREE.MathUtils.clamp(this.goalEl + dEl, -1.45, 1.45);
    this._user();
  }

  /** Offset (world) from the target for spherical coords in the target frame. */
  offset(az, el, dist, frameQ, out) {
    const ce = Math.cos(el);
    out.set(ce * Math.sin(az), Math.sin(el), ce * Math.cos(az)).multiplyScalar(dist);
    return out.applyQuaternion(frameQ);
  }

  /** Jump straight to a view. */
  set(target, az, el, dist) {
    this.target = target;
    this.az = this.goalAz = az;
    this.el = this.goalEl = el;
    this.logD = this.goalLogD = Math.log(THREE.MathUtils.clamp(dist, target.minDist, target.maxDist));
    this.vAz = this.vEl = 0;
    this.flight = null;
  }

  /** Smooth flight to a target, arriving at the given spherical view. */
  flyTo(target, { az, el, dist, duration } = {}) {
    const from = this.pos.clone();
    const fromLook = this.lookAtPt.clone();
    const fromQ = this.quat.clone();
    const tp = target.position(new THREE.Vector3());
    const d1 = THREE.MathUtils.clamp(dist ?? target.defaultDist, target.minDist, target.maxDist);
    // keep roughly the current viewing direction if none given
    if (az === undefined || el === undefined) {
      const fq = target.frame(new THREE.Quaternion());
      _v.copy(from).sub(tp).applyQuaternion(fq.clone().invert()).normalize();
      az = az ?? Math.atan2(_v.x, _v.z);
      el = el ?? THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1)), -0.9, 0.9);
    }
    const d0 = from.distanceTo(tp);
    const ratio = Math.abs(Math.log(Math.max(d0, 1) / d1));
    const dur = duration ?? THREE.MathUtils.clamp(2.2 + ratio * 0.45, 2.4, 6.5);
    this.flight = { t: 0, dur, from, fromLook, fromQ, fromTarget: this.target, target, d0, d1 };
    this.target = target;
    this.goalAz = this.az = az; this.goalEl = this.el = el; this.goalLogD = this.logD = Math.log(d1);
    this.vAz = this.vEl = 0;
  }

  get distance() { return Math.exp(this.logD); }

  update(dt, camera) {
    if (!this.target) return;
    const T = this.target;
    const tp = T.position(new THREE.Vector3());
    const fq = T.frame(new THREE.Quaternion());
    const upW = new THREE.Vector3(0, 1, 0).applyQuaternion(fq);
    if (this.flight) {
      const f = this.flight;
      f.t += dt / f.dur;
      const t = Math.min(f.t, 1);
      const e = ease(t);
      // end pose (live, targets move)
      const endOff = this.offset(this.az, this.el, f.d1, fq, new THREE.Vector3());
      const startOff = f.from.clone().sub(tp);
      const l0 = Math.log(Math.max(startOff.length(), 1e-3)), l1 = Math.log(f.d1);
      const dir0 = startOff.clone().normalize(), dir1 = endOff.clone().normalize();
      const qa = new THREE.Quaternion().setFromUnitVectors(dir0, dir1);
      const qd = new THREE.Quaternion().slerp(qa, e);
      const dir = dir0.clone().applyQuaternion(qd);
      // log-distance with a slight pull-back mid-flight for long hops
      const bump = Math.sin(Math.PI * e) * Math.min(0.6, Math.abs(l0 - l1) * 0.06 + 0.15);
      const dist = Math.exp(THREE.MathUtils.lerp(l0, l1, e) + bump);
      this.pos.copy(tp).addScaledVector(dir, dist);
      const le = ease(THREE.MathUtils.clamp(t * 1.5, 0, 1));
      this.lookAtPt.copy(f.fromLook).lerp(tp, le);
      _m.lookAt(this.pos, this.lookAtPt, upW);
      _q.setFromRotationMatrix(_m);
      this.quat.copy(f.fromQ).slerp(_q, le);
      if (f.t >= 1) this.flight = null;
    } else {
      // inertia after release
      if (!this.pointers.size) {
        const damp = Math.exp(-dt * 3.5);
        this.goalAz += this.vAz * dt * 0.25; this.goalEl = THREE.MathUtils.clamp(this.goalEl + this.vEl * dt * 0.25, -1.45, 1.45);
        this.vAz *= damp; this.vEl *= damp;
      }
      const k = 1 - Math.exp(-dt * 9);
      const kz = 1 - Math.exp(-dt * 5);
      this.az += (this.goalAz - this.az) * k;
      this.el += (this.goalEl - this.el) * k;
      this.logD += (this.goalLogD - this.logD) * kz;
      const off = this.offset(this.az, this.el, this.distance, fq, new THREE.Vector3());
      this.pos.copy(tp).add(off);
      this.lookAtPt.copy(tp);
      if (T.lookOffset) this.lookAtPt.add(T.lookOffset(this, new THREE.Vector3()));
      _m.lookAt(this.pos, this.lookAtPt, upW);
      this.quat.setFromRotationMatrix(_m);
    }
    camera.position.copy(this.pos);
    camera.quaternion.copy(this.quat);
  }
}
