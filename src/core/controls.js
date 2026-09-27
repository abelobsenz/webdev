import * as THREE from 'three';
import { planFlight, FlightDriver, OrbitDriver, yawPitch, clamp } from './camera-path.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE', 'KeyQ', 'KeyC'];

/**
 * Free-flight camera with cinematic drivers.
 *
 * Input: mouse drag or pointer lock to look (sensitivity, invert Y), WASD / arrows to fly,
 * Space/E up, C/Q down, Shift boost, Alt fine, wheel = cruise speed, right mouse or Z = zoom lens.
 * Touch: drag to look, pinch to move, plus the virtual joystick in ui/touch.js (setVirtual).
 * Gamepad (standard mapping): left stick fly, right stick look, triggers down/up, RB boost, LB fine.
 *
 * Flight has inertia, speed that scales with height above the surface, sub-stepped collision
 * against terrain, roofs (CollisionModel grid) and structure cylinders with sliding, and gentle
 * terrain avoidance when skimming fast towards rising ground.
 *
 * A `driver` (FlightDriver, DwellDriver, OrbitDriver, or any {update(dt, camera, controls)})
 * can take over the camera for cinematic moves; user input hands control back smoothly,
 * keeping the driver's velocity so the camera glides out of the move.
 */
export class FlyControls {
  constructor(camera, dom, { groundHeight, colliders }) {
    this.camera = camera;
    this.dom = dom;
    this.groundHeight = groundHeight;
    this.colliders = colliders || [];
    this.collision = null;          // CollisionModel (set by the UI once the world exists)
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.targetYaw = 0; this.targetPitch = 0; this.targetRoll = 0;
    this.lookOffset = { yaw: 0, pitch: 0, held: false };
    this.velocity = new THREE.Vector3();
    this.keys = new Set();
    this.speed = 60;                // m/s cruise, adjusted with wheel
    this.speedScale = 1;            // photo mode slows everything down
    this.enabled = true;
    this.locked = false;
    this.dragging = false;
    this.zoom = false;
    this.baseFov = 60;
    this.fov = 60;
    this.zoomFov = 14;
    this.sensitivity = 1;
    this.invertY = false;
    this.reducedMotion = false;
    this.maxAltitude = 42000;
    this.maxRadius = 40000;
    this.clearance = 1.8;
    this.driver = null;             // active cinematic driver
    this.timeScale = 1;             // driver time scale (tour pause eases this to 0)
    this.onUserInput = null;
    this.onGamepadButton = null;
    this.keyFilter = null;          // (event) => true to let the UI own a key
    this.virtual = { mx: 0, my: 0, up: 0 };
    this.pointers = new Map();
    this.pinch = null;
    this._pinchMove = 0;
    this.gamepad = { connected: false, prev: [], boost: false };
    this.altScale = 1;
    this.lastInputAt = 0;
    this._bind();
  }

  setCollision(model) { this.collision = model; }

  // -------------------------------------------------------------- input --
  _bind() {
    const d = this.dom;
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') {
        if (e.button === 2) { this.zoom = true; return; }
        if (e.button !== 0) return;
        this.dragging = true;
        this._lastX = e.clientX; this._lastY = e.clientY;
        try { d.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
        if (this.wantLock && !this.locked && d.requestPointerLock) {
          try { const p = d.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* optional */ }
        }
        if (this.driver && this.driver.allowLook) this.lookOffset.held = true;
        return;
      }
      // touch / pen
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { d.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      }
      if (this.driver && this.driver.allowLook) this.lookOffset.held = true;
    });
    const up = (e) => {
      if (e.pointerType === 'mouse') {
        if (e.button === 2) this.zoom = false;
        if (e.button === 0) { this.dragging = false; this.lookOffset.held = false; }
        return;
      }
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) { this.pinch = null; this._pinchMove = 0; }
      if (this.pointers.size === 0) this.lookOffset.held = false;
    };
    d.addEventListener('pointerup', up);
    d.addEventListener('pointercancel', up);
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === d; });
    d.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') {
        if (this.locked) this._look(e.movementX, e.movementY, 0.0021);
        else if (this.dragging) {
          const dx = e.clientX - this._lastX, dy = e.clientY - this._lastY;
          this._lastX = e.clientX; this._lastY = e.clientY;
          this._look(dx, dy, 0.003);
        }
        return;
      }
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 1) this._look(dx, dy, 0.0042);
      else if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const dd = Math.hypot(a.x - b.x, a.y - b.y);
        this._pinchMove = clamp((dd - this.pinch.d) * 0.08, -3, 3);
        this.pinch.d = dd;
        this._user('move');
      }
    });
    // pointer-lock mouse moves arrive on the document when captured
    document.addEventListener('mousemove', (e) => { if (this.locked && this.enabled && e.target !== d) this._look(e.movementX, e.movementY, 0.0021); });
    d.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.speed = clamp(this.speed * Math.pow(1.0015, -e.deltaY), 4, 4000);
      this._user('speed');
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
      if (e.metaKey || e.ctrlKey) return;
      if (this.keyFilter && this.keyFilter(e)) return;
      if (!this.enabled) return;
      if (MOVE_KEYS.includes(e.code)) {
        // arrow keys on a focused range input belong to the input
        if (e.target && e.target.type === 'range' && e.code.startsWith('Arrow')) return;
        this.keys.add(e.code);
        this._user('move');
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      } else this.keys.add(e.code);
      if (e.code === 'KeyZ') this.zoom = true;
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.code === 'KeyZ') this.zoom = false; });
    window.addEventListener('blur', () => { this.keys.clear(); this.zoom = false; this.dragging = false; this.pointers.clear(); this.lookOffset.held = false; });
    window.addEventListener('gamepadconnected', () => { this.gamepad.connected = true; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepad.connected = !!this._pad(); });
  }

  /** Touch joystick / on-screen buttons. mx, my, up in -1..1. */
  setVirtual(mx, my, upDown) {
    this.virtual.mx = mx; this.virtual.my = my; this.virtual.up = upDown;
    if (mx || my || upDown) this._user('move');
  }

  _user(kind = 'move') {
    this.lastInputAt = performance.now();
    const dr = this.driver;
    if (dr) {
      if (kind === 'look' && dr.allowLook) { /* look around without leaving the move */ }
      else if (kind === 'speed' && dr.allowLook) { /* ignore wheel during tours */ return; }
      else if (dr.interruptible) this.release();
    }
    if (this.onUserInput) this.onUserInput(kind);
  }

  _look(dx, dy, s) {
    const zs = this.fov / this.baseFov * (this.baseFov / 60);
    const k = s * zs * this.sensitivity;
    const iy = this.invertY ? -1 : 1;
    if (this.driver && this.driver.allowLook) {
      this.lookOffset.yaw = clamp(this.lookOffset.yaw - dx * k, -1.2, 1.2);
      this.lookOffset.pitch = clamp(this.lookOffset.pitch - dy * k * iy, -0.7, 0.7);
      this._user('look');
      return;
    }
    this.targetYaw -= dx * k;
    this.targetPitch = clamp(this.targetPitch - dy * k * iy, -1.53, 1.53);
    this._user('look');
  }

  // --------------------------------------------------------------- pose --
  setPose(position, yaw, pitch) {
    this.driver = null;
    this.camera.position.copy(position);
    this.yaw = this.targetYaw = yaw;
    this.pitch = this.targetPitch = pitch;
    this.roll = this.targetRoll = 0;
    this.lookOffset.yaw = this.lookOffset.pitch = 0;
    this.velocity.set(0, 0, 0);
    this._apply();
  }

  lookAt(target) {
    const yp = yawPitch(this.camera.position, target);
    this.yaw = this.targetYaw = yp.yaw;
    this.pitch = this.targetPitch = yp.pitch;
    this._apply();
  }

  static yawPitchTo(from, to) { return yawPitch(from, to, {}); }

  /** Used by drivers: set the orientation directly. */
  _setOrientation(yaw, pitch, roll = 0) {
    // keep yaw continuous so hand-offs never spin the long way round
    let dy = yaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw = this.targetYaw = this.yaw + dy;
    this.pitch = this.targetPitch = pitch;
    this.roll = this.targetRoll = roll;
  }

  /** Current forward direction (unit). */
  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion); }

  // ------------------------------------------------------------ drivers --
  setDriver(driver) {
    this.driver = driver;
    this.lookOffset.held = false;
  }

  /** Hand control back to free flight, keeping the driver's motion as inertia. */
  release() {
    const dr = this.driver;
    if (!dr) return;
    this.driver = null;
    if (dr.vel && Number.isFinite(dr.vel.x)) this.velocity.copy(dr.vel).clampLength(0, 400);
    // fold the look offset into the free-flight orientation
    this.yaw += this.lookOffset.yaw; this.pitch = clamp(this.pitch + this.lookOffset.pitch, -1.53, 1.53);
    this.lookOffset.yaw = this.lookOffset.pitch = 0;
    this.targetYaw = this.yaw; this.targetPitch = this.pitch;
    this.targetRoll = 0;
    if (dr.onRelease) dr.onRelease();
  }

  get flight() { return this.driver && this.driver.kind === 'flight' ? this.driver : null; }
  set flight(v) { if (!v) { if (this.driver && this.driver.kind === 'flight') this.driver = null; } else this.driver = v; }
  get orbit() { return this.driver && this.driver.kind === 'orbit' ? this.driver : null; }
  set orbit(v) { if (!v) { if (this.driver && this.driver.kind === 'orbit') this.driver = null; } else this.driver = v; }

  /**
   * Smooth, collision-safe cinematic flight to a pose. Uses a planned Catmull-Rom spline with
   * look-ahead; lands exactly on (position, looking at lookTarget).
   */
  flyTo(position, lookTarget, { duration, interruptible = true, onDone, endSpeed = 0, endDir = null } = {}) {
    const from = this.camera.position.clone();
    const vel = this.velocity.lengthSq() > 4 ? this.velocity.clone() : null;
    const { path } = planFlight(this.collision, from, position, { fromDir: vel ? vel.clone().normalize() : this.forward(_w).clone(), toLook: lookTarget, endDir });
    const L = path.length;
    const dur = duration ?? clamp(2.6 + Math.sqrt(L) * 0.075, 3, 14);
    const fromLook = from.clone().addScaledVector(this.forward(_v), Math.max(200, Math.min(L * 0.5, 2000)));
    this.driver = new FlightDriver(path, {
      duration: dur, v0: vel ? vel.length() : 0, v1: endSpeed, fromLook, toLook: lookTarget,
      interruptible, onDone, bank: !this.reducedMotion,
    });
    this.velocity.set(0, 0, 0);
    return this.driver;
  }

  /** Slow cinematic drift around a subject (legacy API). */
  startOrbit(center, radius, height, angle, speed, lookOffsetY = 0) {
    this.driver = new OrbitDriver({ center, radius, height, angle, speed, lookOffsetY });
  }

  // -------------------------------------------------------------- update --
  _pad() {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected && p.axes && p.axes.length >= 4) return p;
    } catch (e) { /* not allowed */ }
    return null;
  }

  _readGamepad(dt) {
    const out = { mx: 0, my: 0, up: 0, lx: 0, ly: 0, boost: 1 };
    if (!this.gamepad.connected) return out;
    const p = this._pad();
    if (!p) return out;
    const dz = (x, y, z = 0.14) => {
      const m = Math.hypot(x, y);
      if (m < z) return [0, 0];
      const s = Math.min((m - z) / (1 - z), 1) / m;
      return [x * s, y * s];
    };
    const [mx, my] = dz(p.axes[0], p.axes[1]);
    const [lx, ly] = dz(p.axes[2], p.axes[3], 0.12);
    const b = (i) => (p.buttons[i] ? (typeof p.buttons[i] === 'object' ? p.buttons[i].value : p.buttons[i]) : 0);
    const pressed = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    out.mx = mx; out.my = -my;
    out.up = b(7) - b(6);
    // look rate with a response curve for precision near centre
    const curve = (x) => Math.sign(x) * Math.pow(Math.abs(x), 1.7);
    out.lx = curve(lx); out.ly = curve(ly);
    if (pressed(10)) { if (!this.gamepad.prev[10]) this.gamepad.boost = !this.gamepad.boost; }
    out.boost = (pressed(5) || this.gamepad.boost ? 5 : 1) * (pressed(4) ? 0.25 : 1);
    if (pressed(12) && !this.gamepad.prev[12]) this.speed = clamp(this.speed * 1.5, 4, 4000);
    if (pressed(13) && !this.gamepad.prev[13]) this.speed = clamp(this.speed / 1.5, 4, 4000);
    for (let i = 0; i < p.buttons.length; i++) {
      const now = pressed(i);
      if (now && !this.gamepad.prev[i] && this.onGamepadButton && ![4, 5, 6, 7, 10, 12, 13].includes(i)) this.onGamepadButton(i);
      this.gamepad.prev[i] = now;
    }
    if (Math.abs(out.mx) + Math.abs(out.my) + Math.abs(out.up) > 0.05) this._user('move');
    if (Math.abs(out.lx) + Math.abs(out.ly) > 0.02) {
      const rate = 2.3 * this.sensitivity * (this.fov / 60) * dt;
      const iy = this.invertY ? -1 : 1;
      if (this.driver && this.driver.allowLook) {
        this.lookOffset.yaw = clamp(this.lookOffset.yaw - out.lx * rate, -1.2, 1.2);
        this.lookOffset.pitch = clamp(this.lookOffset.pitch - out.ly * rate * iy, -0.7, 0.7);
        this.lookOffset.padHeld = 0.35;
      } else {
        this.targetYaw -= out.lx * rate;
        this.targetPitch = clamp(this.targetPitch - out.ly * rate * iy, -1.53, 1.53);
      }
      this._user('look');
    }
    return out;
  }

  update(dt) {
    const pad = this._readGamepad(dt);
    if (this.driver) {
      const dr = this.driver;
      const alive = dr.update(dt * this.timeScale, this.camera, this);
      // a finishing driver may hand over to the next one from its onDone callback
      if (!alive && this.driver === dr) this.release();
      // look-around offset springs back when released
      const lo = this.lookOffset;
      if (lo.padHeld > 0) lo.padHeld -= dt;
      if (!lo.held && !(lo.padHeld > 0)) {
        const k = 1 - Math.exp(-dt * 1.8);
        lo.yaw -= lo.yaw * k; lo.pitch -= lo.pitch * k;
      }
      this._safetyFloor();
      this._apply(dt);
      return;
    }
    // smooth look (and roll back to level after a banked move)
    const k = 1 - Math.exp(-dt * 20);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;
    this.roll += (this.targetRoll - this.roll) * (1 - Math.exp(-dt * 3));

    // movement intent
    const K = this.keys;
    let fwd = (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0);
    let str = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
    let upd = (K.has('Space') || K.has('KeyE') ? 1 : 0) - (K.has('KeyC') || K.has('KeyQ') ? 1 : 0);
    fwd += pad.my + this.virtual.my + this._pinchMove;
    str += pad.mx + this.virtual.mx;
    upd += pad.up + this.virtual.up;
    this._pinchMove *= Math.exp(-dt * 6);
    let boost = K.has('ShiftLeft') || K.has('ShiftRight') ? 6 : 1;
    if (K.has('AltLeft') || K.has('AltRight')) boost *= 0.2;
    boost *= pad.boost;

    // speed grows with height above whatever is below
    const p = this.camera.position;
    const floor = this._floor(p.x, p.z, p.y);
    const agl = Math.max(p.y - floor, 1);
    const want = clamp(Math.sqrt(agl / 35), 1, 14);
    this.altScale += (want - this.altScale) * (1 - Math.exp(-dt * 2.5));
    const spd = this.speed * boost * this.altScale * this.speedScale;

    _e.set(this.pitch, this.yaw, 0);
    _q.setFromEuler(_e);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _right.set(1, 0, 0).applyQuaternion(_q);
    const wantV = _v.set(0, 0, 0).addScaledVector(_fwd, fwd).addScaledVector(_right, str);
    wantV.y += upd;
    if (wantV.lengthSq() > 1) wantV.normalize();
    wantV.multiplyScalar(spd);
    const accel = wantV.lengthSq() > 0 ? 4.2 : 2.4;    // brisk response, soft glide to a stop
    this.velocity.lerp(wantV, 1 - Math.exp(-dt * accel));
    if (this.velocity.lengthSq() < 1e-4) this.velocity.set(0, 0, 0);

    // terrain avoidance: when skimming fast towards rising ground, lift early
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (hs > 25) {
      const la = 0.6;
      const ax = p.x + this.velocity.x * la, az = p.z + this.velocity.z * la;
      const ahead = Math.max(this.groundHeight(ax, az), 0) + this.clearance + 2;
      if (ahead > p.y) this.velocity.y = Math.max(this.velocity.y, (ahead - p.y) / la);
    }

    this._move(_w.copy(this.velocity).multiplyScalar(dt));
    this._apply(dt);
  }

  _floor(x, z, y) {
    if (this.collision) return this.collision.floor(x, z, y);
    return Math.max(this.groundHeight(x, z), 0);
  }

  _safetyFloor() {
    const p = this.camera.position;
    const g = Math.max(this.groundHeight(p.x, p.z), 0) + 1.0;
    if (p.y < g) p.y = g;
  }

  /** Sub-stepped move with sliding collision. */
  _move(delta) {
    const p = this.camera.position;
    const len = delta.length();
    if (len < 1e-6) { this._resolve(); return; }
    const steps = Math.min(32, Math.max(1, Math.ceil(len / 6)));
    const sx = delta.x / steps, sy = delta.y / steps, sz = delta.z / steps;
    const col = this.collision;
    for (let i = 0; i < steps; i++) {
      let nx = p.x + sx, nz = p.z + sz;
      const ny = p.y + sy;
      if (col && col.inStructure(nx, nz, ny) && !col.inStructure(p.x, p.z, p.y)) {
        // slide along whichever axis is free
        if (!col.inStructure(nx, p.z, ny)) { nz = p.z; this.velocity.z *= 0.2; }
        else if (!col.inStructure(p.x, nz, ny)) { nx = p.x; this.velocity.x *= 0.2; }
        else { nx = p.x; nz = p.z; this.velocity.x *= 0.2; this.velocity.z *= 0.2; }
      }
      p.set(nx, ny, nz);
      this._resolve();
    }
  }

  _resolve() {
    const p = this.camera.position;
    const v = this.velocity;
    // structure cylinders: push out and slide
    if (this.collision) {
      for (let it = 0; it < 3; it++) {
        const pen = this.collision.penetration(p.x, p.y, p.z, 3);
        if (!pen) break;
        p.x += pen.nx * pen.depth; p.z += pen.nz * pen.depth;
        if (pen.ny) p.y += pen.ny * pen.depth;
        const vn = v.x * pen.nx + v.z * pen.nz + v.y * (pen.ny || 0);
        if (vn < 0) { v.x -= pen.nx * vn; v.z -= pen.nz * vn; v.y -= (pen.ny || 0) * vn; }
      }
    } else {
      for (const c of this.colliders) {
        if (c.y0 === undefined || p.y < c.y0 || p.y > c.y1) continue;
        const rad = typeof c.radius === 'function' ? c.radius(p.y) : c.radius;
        const dx = p.x - c.x, dz = p.z - c.z;
        const d = Math.hypot(dx, dz);
        const m = rad + 3;
        if (d < m && d > 1e-3) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; }
      }
    }
    // floor with a soft cushion
    const f = this._floor(p.x, p.z, p.y) + this.clearance;
    if (p.y < f) { p.y = f; if (v.y < 0) v.y = 0; }
    else if (p.y < f + 3 && v.y < 0) v.y *= 0.85;
    if (p.y > this.maxAltitude) { p.y = this.maxAltitude; if (v.y > 0) v.y = 0; }
    const r = Math.hypot(p.x, p.z);
    if (r > this.maxRadius) { p.x *= this.maxRadius / r; p.z *= this.maxRadius / r; }
  }

  _apply(dt = 0.016) {
    const targetFov = this.zoom ? this.zoomFov : this.baseFov;
    const kf = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 8);
    this.fov += (targetFov - this.fov) * kf;
    if (Math.abs(this.camera.fov - this.fov) > 1e-3) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
    const lo = this.lookOffset;
    _e.set(clamp(this.pitch + lo.pitch, -1.55, 1.55), this.yaw + lo.yaw, this.roll, 'YXZ');
    this.camera.quaternion.setFromEuler(_e);
  }

  get heading() { return ((-(this.yaw + this.lookOffset.yaw) * 180) / Math.PI % 360 + 360) % 360; }
}
