import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

/**
 * Free-flight camera: mouse-look (pointer lock or drag), WASD / arrows,
 * Space/E up, C/Q down, Shift boost, Alt precise, wheel = cruise speed,
 * right-mouse or Z = zoom lens. Touch: drag to look, two-finger drag to fly.
 * Also drives cinematic flights between viewpoints.
 */
export class FlyControls {
  constructor(camera, dom, { groundHeight, colliders }) {
    this.camera = camera;
    this.dom = dom;
    this.groundHeight = groundHeight;
    this.colliders = colliders || [];
    this.yaw = 0; this.pitch = 0;
    this.targetYaw = 0; this.targetPitch = 0;
    this.velocity = new THREE.Vector3();
    this.keys = new Set();
    this.speed = 60;                // m/s cruise, adjusted with wheel
    this.enabled = true;
    this.locked = false;
    this.dragging = false;
    this.zoom = false;
    this.baseFov = 60;
    this.fov = 60;
    this.flight = null;             // active cinematic flight
    this.orbit = null;              // slow orbit around a subject during tour
    this.onUserInput = null;
    this.touch = { mode: null, x: 0, y: 0, d: 0, mx: 0, my: 0 };
    this._bind();
  }

  _bind() {
    const d = this.dom;
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 2) { this.zoom = true; return; }
      if (e.button === 0) {
        this.dragging = true;
        this._lastX = e.clientX; this._lastY = e.clientY;
        if (this.wantLock && !this.locked && d.requestPointerLock) {
          try { const p = d.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* optional */ }
        }
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.zoom = false;
      if (e.button === 0) this.dragging = false;
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === d; });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) this._look(e.movementX, e.movementY, 0.0022);
      else if (this.dragging) {
        const dx = e.clientX - this._lastX, dy = e.clientY - this._lastY;
        this._lastX = e.clientX; this._lastY = e.clientY;
        this._look(dx, dy, 0.0032);
      }
    });
    d.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.speed = THREE.MathUtils.clamp(this.speed * Math.pow(1.0015, -e.deltaY), 4, 4000);
      this._user();
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      this.keys.add(e.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE', 'KeyQ', 'KeyC'].includes(e.code)) {
        this._user();
        if (e.code === 'Space') e.preventDefault();
      }
      if (e.code === 'KeyZ') this.zoom = true;
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.code === 'KeyZ') this.zoom = false; });
    window.addEventListener('blur', () => { this.keys.clear(); this.zoom = false; this.dragging = false; });

    // touch
    d.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      const t = e.touches;
      if (t.length === 1) { this.touch.mode = 'look'; this.touch.x = t[0].clientX; this.touch.y = t[0].clientY; }
      else if (t.length >= 2) {
        this.touch.mode = 'fly';
        this.touch.mx = (t[0].clientX + t[1].clientX) / 2; this.touch.my = (t[0].clientY + t[1].clientY) / 2;
        this.touch.d = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      }
      this._user();
    }, { passive: true });
    d.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      const t = e.touches;
      if (this.touch.mode === 'look' && t.length === 1) {
        this._look(t[0].clientX - this.touch.x, t[0].clientY - this.touch.y, 0.004);
        this.touch.x = t[0].clientX; this.touch.y = t[0].clientY;
      } else if (t.length >= 2) {
        const mx = (t[0].clientX + t[1].clientX) / 2, my = (t[0].clientY + t[1].clientY) / 2;
        const dd = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        const fwd = (dd - this.touch.d) * 0.02;
        this._touchMove = { fwd, strafe: -(mx - this.touch.mx) * 0.01, up: (my - this.touch.my) * 0.01 };
        this.touch.mx = mx; this.touch.my = my; this.touch.d = dd;
      }
      e.preventDefault();
    }, { passive: false });
    d.addEventListener('touchend', () => { this.touch.mode = null; this._touchMove = null; }, { passive: true });
  }

  _user() {
    if (this.flight && this.flight.interruptible) this.flight = null;
    if (this.orbit) this.orbit = null;
    if (this.onUserInput) this.onUserInput();
  }

  _look(dx, dy, s) {
    const zs = this.fov / this.baseFov;
    this.targetYaw -= dx * s * zs;
    this.targetPitch = THREE.MathUtils.clamp(this.targetPitch - dy * s * zs, -1.53, 1.53);
    this._user();
  }

  setPose(position, yaw, pitch) {
    this.camera.position.copy(position);
    this.yaw = this.targetYaw = yaw;
    this.pitch = this.targetPitch = pitch;
    this.velocity.set(0, 0, 0);
    this._apply();
  }

  lookAt(target) {
    _v.subVectors(target, this.camera.position).normalize();
    this.yaw = this.targetYaw = Math.atan2(-_v.x, -_v.z);
    this.pitch = this.targetPitch = Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1));
    this._apply();
  }

  static yawPitchTo(from, to) {
    const d = new THREE.Vector3().subVectors(to, from).normalize();
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) };
  }

  /** Smooth cinematic flight to a pose. Arcs upward for long hops. */
  flyTo(position, lookTarget, { duration, interruptible = true, onDone } = {}) {
    const from = this.camera.position.clone();
    const dist = from.distanceTo(position);
    const dur = duration ?? THREE.MathUtils.clamp(2.2 + Math.sqrt(dist) * 0.045, 2.5, 9);
    const { yaw, pitch } = FlyControls.yawPitchTo(position, lookTarget);
    const lift = Math.min(dist * 0.25, 1600);
    const mid = from.clone().lerp(position, 0.5);
    mid.y = Math.max(from.y, position.y) + lift;
    this.flight = {
      t: 0, dur, from, to: position.clone(), mid, interruptible, onDone,
      yaw0: this.yaw, pitch0: this.pitch, yaw1: yaw, pitch1: pitch,
      lookTarget: lookTarget.clone(),
    };
    this.orbit = null;
  }

  /** Slow cinematic drift around a subject (used by the guided tour). */
  startOrbit(center, radius, height, angle, speed, lookOffsetY = 0) {
    this.orbit = { center: center.clone(), radius, height, angle, speed, lookOffsetY };
  }

  update(dt) {
    if (this.flight) {
      const f = this.flight;
      f.t += dt / f.dur;
      const t = Math.min(f.t, 1);
      const e = easeInOutCubic(t);
      // quadratic Bezier through the lifted midpoint
      const a = f.from, b = f.mid, c = f.to;
      const u = 1 - e;
      this.camera.position.set(
        u * u * a.x + 2 * u * e * b.x + e * e * c.x,
        u * u * a.y + 2 * u * e * b.y + e * e * c.y,
        u * u * a.z + 2 * u * e * b.z + e * e * c.z,
      );
      // orientation: look along the path early on, settle on the target late
      let dy = f.yaw1 - f.yaw0;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const oe = easeInOutCubic(THREE.MathUtils.clamp(t * 1.25, 0, 1));
      this.yaw = this.targetYaw = f.yaw0 + dy * oe;
      this.pitch = this.targetPitch = THREE.MathUtils.lerp(f.pitch0, f.pitch1, oe);
      if (f.t >= 1) {
        this.flight = null;
        this.velocity.set(0, 0, 0);
        if (f.onDone) f.onDone();
      }
      this._apply(dt);
      return;
    }
    if (this.orbit) {
      const o = this.orbit;
      o.angle += o.speed * dt;
      const p = new THREE.Vector3(o.center.x + Math.cos(o.angle) * o.radius, o.center.y + o.height, o.center.z + Math.sin(o.angle) * o.radius);
      this.camera.position.lerp(p, 1 - Math.exp(-dt * 2.0));
      const tgt = o.center.clone(); tgt.y += o.lookOffsetY;
      const { yaw, pitch } = FlyControls.yawPitchTo(this.camera.position, tgt);
      let dy = yaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * (1 - Math.exp(-dt * 2.5));
      this.pitch += (pitch - this.pitch) * (1 - Math.exp(-dt * 2.5));
      this.targetYaw = this.yaw; this.targetPitch = this.pitch;
      this._apply(dt);
      return;
    }
    // smooth look
    const k = 1 - Math.exp(-dt * 18);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;

    // movement
    const K = this.keys;
    const fwd = (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0);
    const str = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
    const upd = (K.has('Space') || K.has('KeyE') ? 1 : 0) - (K.has('KeyC') || K.has('KeyQ') ? 1 : 0);
    let boost = K.has('ShiftLeft') || K.has('ShiftRight') ? 6 : 1;
    if (K.has('AltLeft') || K.has('AltRight')) boost *= 0.2;
    const ground = this.groundHeight(this.camera.position.x, this.camera.position.z);
    const agl = Math.max(this.camera.position.y - ground, 1);
    const altScale = THREE.MathUtils.clamp(Math.sqrt(agl / 40), 1, 12);
    const spd = this.speed * boost * altScale;

    _e.set(this.pitch, this.yaw, 0);
    _q.setFromEuler(_e);
    const want = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(_q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(_q);
    want.addScaledVector(forward, fwd).addScaledVector(right, str);
    want.y += upd;
    if (this._touchMove) {
      want.addScaledVector(forward, this._touchMove.fwd * 3).addScaledVector(right, this._touchMove.strafe * 3);
      want.y += this._touchMove.up * 3;
    }
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(spd);
    const acc = 1 - Math.exp(-dt * (want.lengthSq() > 0 ? 3.5 : 2.2));
    this.velocity.lerp(want, acc);
    this.camera.position.addScaledVector(this.velocity, dt);
    this._collide();
    this._apply(dt);
  }

  _collide() {
    const p = this.camera.position;
    const g = this.groundHeight(p.x, p.z);
    const minY = Math.max(g + 1.8, 1.2);
    if (p.y < minY) { p.y = minY; if (this.velocity.y < 0) this.velocity.y = 0; }
    if (p.y > 42000) p.y = 42000;
    const r = Math.hypot(p.x, p.z);
    if (r > 40000) { p.x *= 40000 / r; p.z *= 40000 / r; }
    for (const c of this.colliders) {
      if (p.y < c.y0 || p.y > c.y1) continue;
      const rad = typeof c.radius === 'function' ? c.radius(p.y) : c.radius;
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const m = rad + 3;
      if (d < m && d > 1e-3) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; }
    }
  }

  _apply(dt = 0.016) {
    const targetFov = this.zoom ? 14 : this.baseFov;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 8));
    if (Math.abs(this.camera.fov - this.fov) > 1e-3) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
    _e.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(_e);
  }

  get heading() { return ((-this.yaw * 180) / Math.PI % 360 + 360) % 360; }
}
