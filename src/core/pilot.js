import * as THREE from 'three';
import { Aerodyne } from '../craft/aerodyne.js';
import { Trail, Downwash, heatPlume } from '../craft/aerodyneFx.js';
import { EngineVoice } from './engineAudio.js';
import { U } from './uniforms.js';

// Piloted flight in the Concord aerodyne (craft/aerodyne.js), seen from a chase camera.
//
//   W / S        throttle up / down            A / D        bank left / right
//   Up / Down    nose down / nose up           Q / E        yaw (also Left / Right arrows)
//   Space / C    lift up / down (VTOL fans)    Shift        boost
//   G            gear (auto until pressed)     X            chase / hood camera
//   drag         look around the craft         wheel        camera distance
//   V            leave the aircraft (it stays hovering where it is) / board it again
// Gamepad: left stick bank and pitch, right stick look, triggers throttle, bumpers yaw, A/B lift.
//
// The model is forgiving: the ducts tilt from hover to cruise with airspeed and hold the craft up
// while slow, the wings take over above ~60 m/s, bank makes a coordinated turn, and with the
// stick released the craft rolls level (and in hover pitches level too). It never stalls into the
// ground: terrain, roofs and structures are solid and the gear lands it gently.

const G = 9.81;
const V = () => new THREE.Vector3();
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const OWN = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight', 'KeyG', 'KeyX'];

const _f = V(), _u = V(), _r = V(), _v = V(), _w = V(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
const _eye = V(), _tgt = V(), _up = V();

export class Pilot {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.parked = false;
    this.craft = null;
    this.pos = V(); this.vel = V(); this.quat = new THREE.Quaternion();
    this.rates = V();                  // x pitch (nose up), y yaw (right), z roll (right wing down)
    this.throttle = 0; this.speed = 0; this.climb = 0; this.tilt = 1; this.gear = 1; this.gearAuto = true;
    this.onGround = false; this.landed = false; this.shake = 0; this.boost = false;
    this.input = { roll: 0, pitch: 0, yaw: 0, lift: 0, thr: 0 };
    this.keys = new Set();
    this.cam = { yaw: 0, pitch: 0, dist: 24, held: false, idle: 9, hood: false, off: V(), fov: 60 };
    this.pad = { prev: [] };
    this._bind();
    this._hud();
  }

  // ------------------------------------------------------------------ input --
  _bind() {
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.metaKey || e.ctrlKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') && t.type !== 'range' && t.type !== 'checkbox') return;
      if (!OWN.includes(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyG') { this.gearAuto = false; this.gear = this.gear > 0.5 ? 0 : 1; }
      if (e.code === 'KeyX') { this.cam.hood = !this.cam.hood; this.cam.yaw = this.cam.pitch = 0; }
    }, true);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    const d = this.app.canvas;
    d.addEventListener('pointerdown', (e) => {
      if (!this.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
      this.cam.held = true; this._lx = e.clientX; this._ly = e.clientY;
    });
    const up = () => { this.cam.held = false; this.cam.idle = 0; };
    d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
    d.addEventListener('pointermove', (e) => {
      if (!this.active || !this.cam.held) return;
      const dx = e.clientX - this._lx, dy = e.clientY - this._ly;
      this._lx = e.clientX; this._ly = e.clientY;
      this.cam.yaw -= dx * 0.005;
      this.cam.pitch = clamp(this.cam.pitch + dy * 0.004, -0.45, 1.2);
      this.cam.idle = 0;
    });
    d.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.cam.dist = clamp(this.cam.dist * Math.pow(1.0015, e.deltaY), 10, 140);
    }, { passive: false });
  }

  _readInput(dt) {
    const K = this.keys, c = this.app.controls, v = c.virtual || { mx: 0, my: 0, up: 0 };
    const i = this.input;
    i.thr = (K.has('KeyW') ? 1 : 0) - (K.has('KeyS') ? 1 : 0);
    i.roll = (K.has('KeyD') ? 1 : 0) - (K.has('KeyA') ? 1 : 0) + v.mx;
    i.pitch = (K.has('ArrowDown') ? 1 : 0) - (K.has('ArrowUp') ? 1 : 0) - v.my * 0.8;
    i.yaw = (K.has('KeyE') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyQ') || K.has('ArrowLeft') ? 1 : 0);
    i.lift = (K.has('Space') ? 1 : 0) - (K.has('KeyC') ? 1 : 0) + v.up;
    this.boost = K.has('ShiftLeft') || K.has('ShiftRight');
    // gamepad (standard mapping)
    let p = null;
    try { for (const g of navigator.getGamepads ? navigator.getGamepads() : []) if (g && g.connected && g.axes.length >= 4) { p = g; break; } } catch (e) { /* not allowed */ }
    if (p) {
      const dz = (x) => (Math.abs(x) < 0.12 ? 0 : Math.sign(x) * (Math.abs(x) - 0.12) / 0.88);
      const b = (k) => (p.buttons[k] ? p.buttons[k].value : 0);
      i.roll += dz(p.axes[0]); i.pitch += dz(p.axes[1]);
      i.thr += b(7) - b(6);
      i.yaw += b(5) - b(4);
      i.lift += b(0) - b(1);
      const lx = dz(p.axes[2]), ly = dz(p.axes[3]);
      if (lx || ly) { this.cam.yaw -= lx * 2.2 * dt; this.cam.pitch = clamp(this.cam.pitch + ly * 1.6 * dt, -0.45, 1.2); this.cam.idle = 0; }
      const pressed = (k) => !!(p.buttons[k] && p.buttons[k].pressed);
      if (pressed(3) && !this.pad.prev[3]) { this.gearAuto = false; this.gear = this.gear > 0.5 ? 0 : 1; }
      if (pressed(10) && !this.pad.prev[10]) this.boost = !this.boost;
      if (pressed(11) && !this.pad.prev[11]) this.cam.hood = !this.cam.hood;
      for (let k = 0; k < p.buttons.length; k++) this.pad.prev[k] = pressed(k);
    }
    i.roll = clamp(i.roll, -1, 1); i.pitch = clamp(i.pitch, -1, 1); i.yaw = clamp(i.yaw, -1, 1); i.lift = clamp(i.lift, -1, 1);
  }

  // ------------------------------------------------------------ boarding --
  toggle() { if (this.active) this.exit(); else this.enter(); }

  enter() {
    const app = this.app;
    if (app.space && app.space.active) return false;
    if (!this.craft) {
      this.craft = new Aerodyne();
      app.scene.add(this.craft.group);
      // air effects in world space, heat in each duct's own frame
      this.trails = [new Trail(), new Trail()];
      for (const t of this.trails) app.scene.add(t.mesh);
      this.wash = new Downwash();
      app.scene.add(this.wash.points);
      this.heat = [];
      for (const n of this.craft.movers.nacelles) { const h = heatPlume(1); n.add(h); this.heat.push(h); }
      if (this.craft.rear) { const h = heatPlume(0.62); this.craft.rear.add(h); this.heat.push(h); }
      this.voice = new EngineVoice(app.audio, 'fans');
    }
    const cam = app.camera;
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    if (!(this.parked && this.pos.distanceTo(cam.position) < 2500)) {
      // spawn ahead of the camera, level, on its heading
      this.pos.copy(cam.position).addScaledVector(fwd, 30);
      const floor = this._floor(this.pos);
      if (this.pos.y < floor + 8) this.pos.y = floor + 8;
      this._unstick(this.pos, 9);
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      this.quat.setFromEuler(_e.set(0, yaw, 0, 'YXZ'));
      const low = this.pos.y - this._floor(this.pos) < 60;
      this.speed = low ? 0 : 85; this.throttle = low ? 0 : 0.47; this.tilt = low ? 1 : 0;
      this.gear = low ? 1 : 0; this.gearAuto = true; this.climb = 0;
      this.vel.set(0, 0, -1).applyQuaternion(this.quat).multiplyScalar(this.speed);
      this.rates.set(0, 0, 0);
    }
    this.cam.off.copy(cam.position).sub(this.pos);
    this.cam.fov = cam.fov;
    this.cam.yaw = this.cam.pitch = 0;
    const c = app.controls;
    c.enabled = false; c.driver = null; c.velocity.set(0, 0, 0); c.keys.clear(); c.zoom = false;
    this.active = true; this.parked = false;
    this.keys.clear();
    document.body.classList.add('piloting');
    this.hud.hidden = false;
    return true;
  }

  exit() {
    if (!this.active) return;
    const app = this.app, cam = app.camera, c = app.controls;
    this.active = false; this.parked = true;
    this.keys.clear();
    _e.setFromQuaternion(cam.quaternion, 'YXZ');
    c.enabled = true;
    c.setPose(cam.position.clone(), _e.y, _e.x);
    c.baseFov = c.fov = 60; cam.fov = 60; cam.updateProjectionMatrix();
    document.body.classList.remove('piloting');
    this.hud.hidden = true;
  }

  // ------------------------------------------------------------ the world --
  get collision() { return this.app.ui && this.app.ui.collision; }
  _floor(p) {
    const col = this.collision;
    const g = col ? col.floor(p.x, p.z, p.y + 1.5) : this.app.world.surfaceHeight(p.x, p.z);
    return Math.max(g, 0);
  }
  /** Push a point out of any structure (radius r). Returns the push normal or null. */
  _unstick(p, r) {
    const col = this.collision;
    if (!col) return null;
    let n = null;
    for (let it = 0; it < 4; it++) {
      const pen = col.penetration(p.x, p.y, p.z, r);
      if (!pen) break;
      p.x += pen.nx * pen.depth; p.z += pen.nz * pen.depth; if (pen.ny) p.y += pen.ny * pen.depth;
      n = pen;
    }
    return n;
  }

  // -------------------------------------------------------------- update --
  update(dt) {
    if (!this.craft) return;
    if (this.active) this._readInput(dt);
    else { const i = this.input; i.roll = i.pitch = i.yaw = i.lift = i.thr = 0; this.boost = false; }
    const n = Math.max(1, Math.ceil(dt / (1 / 90)));
    for (let k = 0; k < n; k++) this._step(dt / n);
    // pose the model and animate it
    const g = this.craft.group;
    g.position.copy(this.pos);
    g.quaternion.copy(this.quat);
    const i = this.input;
    this.craft.update(dt, {
      tilt: this.tilt, rpm: this.landed && this.throttle < 0.02 ? 0.25 : 0.45 + 0.55 * Math.max(this.throttle, this.tilt * 0.6),
      thrust: Math.max(this.throttle * (this.boost ? 1 : 0.75), this.tilt * (0.4 + 0.3 * Math.max(i.lift, 0))),
      gear: this.gear, roll: i.roll, pitch: i.pitch, yaw: i.yaw,
    });
    if (this.active) { this._camera(dt); this._updateHud(); }
    this._effects(dt);
  }

  _effects(dt) {
    const app = this.app, night = U.uNight.value;
    _f.set(0, 0, -1).applyQuaternion(this.quat); _r.set(1, 0, 0).applyQuaternion(this.quat);
    const bank = Math.asin(clamp(-_r.y, -1, 1));
    // wingtip vortices: fast and pulling hard (or a boosted dash)
    const gl = 1 + (this.speed * Math.abs(this.rates.x)) / G + (1 - this.tilt) * Math.abs(Math.tan(clamp(bank, -1.3, 1.3))) * 0.6;
    const vort = smooth(65, 150, this.speed) * smooth(1.5, 3.0, gl) + (this.boost ? 0.35 * smooth(180, 300, this.speed) : 0);
    const light = lerp(1.7, 0.18, night);
    this.craft.movers.nacelles.forEach((n, i) => {
      const tip = n.getWorldPosition(_v).addScaledVector(_r, (i === 0 ? 1 : -1) * 1.1);
      this.trails[i].update(dt, tip, vort, app.camera.position, light);
    });
    // downwash: the fans thrown against water or ground under a low hover
    const floor = this._floor(this.pos), agl = this.pos.y - floor;
    const water = app.world.surfaceHeight(this.pos.x, this.pos.z) < 0.35;
    const rate = this.tilt * (0.35 + 0.65 * Math.min(1, this.throttle + Math.max(this.input.lift, 0) + 0.3)) * smooth(26, 5, agl) * (this.landed && this.throttle < 0.05 ? (this.active ? 0.12 : 0) : 1);
    this.wash.update(dt, this.pos, floor, rate, water, lerp(1.2, 0.12, night));
    // heat shimmer in the exhausts
    const thrust = this.craft.state.thrust;
    for (const h of this.heat) h.material.uniforms.uThrust.value = thrust * lerp(0.9, 2.6, night) * 0.6;
    // engine voice
    if (this.voice) this.voice.set(this.active, this.craft.state.rpm, thrust, this.boost ? 1 : 0, clamp(vort, 0, 1));
  }

  _step(h) {
    const i = this.input, q = this.quat;
    _f.set(0, 0, -1).applyQuaternion(q); _u.set(0, 1, 0).applyQuaternion(q); _r.set(1, 0, 0).applyQuaternion(q);
    const bank = Math.asin(clamp(-_r.y, -1, 1));           // + = right wing down
    const pitchAng = Math.asin(clamp(_f.y, -1, 1));        // + = nose up
    const hov = this.tilt;

    // throttle (parked craft spool down to a hover)
    if (this.active) this.throttle = clamp(this.throttle + i.thr * 0.45 * h, 0, 1);
    else this.throttle = Math.max(0, this.throttle - 0.25 * h);

    // ---- attitude: commanded rates, auto-level when released, gentle limits in hover
    let p = i.roll * lerp(2.0, 1.2, hov), qq = i.pitch * lerp(0.95, 0.65, hov), r = i.yaw * lerp(0.5, 0.95, hov);
    if (Math.abs(i.roll) < 0.05) p -= bank * lerp(1.6, 2.4, hov);
    const bankMax = lerp(1.35, 0.5, hov);
    if (Math.abs(bank) > bankMax) p -= (bank - Math.sign(bank) * bankMax) * 4;
    if (Math.abs(i.pitch) < 0.05) qq -= pitchAng * (hov * 1.6 + (this.landed ? 3 : 0));
    const pitchMax = lerp(1.25, 0.42, hov);
    if (Math.abs(pitchAng) > pitchMax) qq -= (pitchAng - Math.sign(pitchAng) * pitchMax) * 4;
    if (this.landed) { p = -bank * 4; qq = Math.min(qq, 0) - pitchAng * 4; }
    _v.set(qq, r, p);
    this.rates.lerp(_v, 1 - Math.exp(-h * 6));
    _q.setFromEuler(_e.set(this.rates.x * h, -this.rates.y * h, -this.rates.z * h, 'XYZ'));
    q.multiply(_q);
    // coordinated turn: bank yaws the nose round (in hover the craft pivots on the spot)
    const turn = (1 - hov) * (G * Math.tan(clamp(bank, -1.3, 1.3))) / Math.max(this.speed, 30) + hov * bank * 1.3;
    if (!this.landed) q.premultiply(_q.setFromAxisAngle(UP, -turn * h));
    q.normalize();

    // ---- airspeed along the nose
    _f.set(0, 0, -1).applyQuaternion(q);
    const maxS = this.boost ? 330 : 185;
    const target = this.throttle * maxS;
    let acc = (target - this.speed) * (target > this.speed ? 0.3 * (this.boost ? 1.9 : 1) : 0.2);
    acc -= G * _f.y * 0.55 * (1 - hov * 0.8);              // dives gather speed, climbs bleed it
    this.speed = clamp(this.speed + acc * h, 0, 420);
    if (this.landed) this.speed *= Math.exp(-h * (this.throttle > 0.05 ? 0.2 : 1.6));

    // ---- ducts: vertical below ~40 m/s, fully forward above ~78 m/s (and always on the ground)
    const tiltT = this.landed || (i.lift > 0.1 && this.speed < 50) ? 1 : 1 - smooth(40, 78, this.speed);
    this.tilt += (tiltT - this.tilt) * (1 - Math.exp(-h * 1.3));

    // ---- vertical: the fans lift when tilted, the wings carry the craft at speed
    const liftCap = lerp(3.5, 17, hov);
    this.climb += (i.lift * liftCap - this.climb) * (1 - Math.exp(-h * 2.4));
    // ground effect: within about a duct span of the surface the fans' wash is trapped under the
    // hull and cushions a descent (a soft flare onto the gear rather than a thump)
    const aglNow = this.pos.y - (this._lastFloor ?? -1e9) - 2.28;
    const ge = hov * smooth(9, 1.5, aglNow);
    if (this.climb < 0) this.climb *= 1 - 0.65 * ge;
    const support = Math.max(hov, smooth(30, 62, this.speed));
    const sink = (1 - support) * 16;
    _v.copy(_f).multiplyScalar(this.speed);
    _v.y += this.climb - sink;
    this.vel.lerp(_v, 1 - Math.exp(-h * lerp(2.0, 3.4, hov)));
    if (this.landed) { this.vel.x *= Math.exp(-h * 3); this.vel.z *= Math.exp(-h * 3); }

    // ---- move and collide
    this.pos.addScaledVector(this.vel, h);
    const gearH = lerp(0.98, 2.28, this.craft ? this.craft.state.gear : this.gear);
    const floor = this._floor(this.pos);
    this._lastFloor = floor;
    if (this.pos.y < floor + gearH) {
      const impact = -this.vel.y;
      this.pos.y = floor + gearH;
      if (this.vel.y < 0) this.vel.y = impact > 10 ? impact * 0.22 : 0;
      if (impact > 6) this.shake = Math.min(1, this.shake + impact / 30);
      this.onGround = true;
    } else this.onGround = this.pos.y < floor + gearH + 0.2;
    this.landed = this.onGround && this.speed < 28 && this.climb < 0.6;
    const pen = this._unstick(this.pos, 7.2);
    if (pen) {
      const vn = this.vel.x * pen.nx + this.vel.z * pen.nz + this.vel.y * (pen.ny || 0);
      if (vn < 0) { this.vel.x -= pen.nx * vn; this.vel.z -= pen.nz * vn; this.vel.y -= (pen.ny || 0) * vn; }
      this.speed *= Math.exp(-h * 3);
      this.shake = Math.min(1, this.shake + h * 3);
    }
    const R = Math.hypot(this.pos.x, this.pos.z), MAXR = 40000;
    if (R > MAXR) { this.pos.x *= MAXR / R; this.pos.z *= MAXR / R; }
    if (this.pos.y > 14000) { this.pos.y = 14000; if (this.vel.y > 0) this.vel.y = 0; }

    // ---- gear: down when low and slow, up in flight (until the pilot takes it over with G)
    if (this.gearAuto) {
      const agl = this.pos.y - floor;
      if ((agl < 40 && this.speed < 70) || this.landed) this.gear = 1;
      else if (agl > 70 || this.speed > 90) this.gear = 0;
    }
    this.shake *= Math.exp(-h * 3);
  }

  // -------------------------------------------------------------- camera --
  _camera(dt) {
    const app = this.app, cam = app.camera, c = this.cam, q = this.quat;
    _f.set(0, 0, -1).applyQuaternion(q); _u.set(0, 1, 0).applyQuaternion(q);
    if (!c.held) { c.idle += dt; if (c.idle > 1.6) { const k = 1 - Math.exp(-dt * 1.8); c.yaw -= c.yaw * k; c.pitch -= c.pitch * k; } }
    const eye = _eye, target = _tgt, up = _up;
    if (c.hood) {
      // just behind the canopy, looking over the nose
      eye.set(0, 2.35, 1.2).applyQuaternion(q).add(this.pos);
      _q.setFromEuler(_e.set(-0.07 - c.pitch * 0.6, c.yaw, 0, 'YXZ'));
      _w.set(0, 0, -1).applyQuaternion(_q).applyQuaternion(q);
      target.copy(eye).addScaledVector(_w, 50);
      up.copy(_u);
    } else {
      // chase: heading-stable frame that follows the nose part of the way into climbs and dives
      const flat = _v.copy(_f); flat.y = 0;
      if (flat.lengthSq() < 1e-4) flat.set(0, 0, -1).applyQuaternion(q).setY(0);
      flat.normalize();
      const dir = flat.lerp(_f, 0.35).normalize();
      dir.applyAxisAngle(UP, c.yaw);
      const el = 0.2 + c.pitch;
      const d = c.dist;
      _w.copy(dir).multiplyScalar(-d * Math.cos(el));
      _w.y += d * Math.sin(el) + 1.6;
      c.off.lerp(_w, 1 - Math.exp(-dt * 5.5));
      eye.copy(this.pos).add(c.off);
      target.copy(this.pos).addScaledVector(_f, Math.min(6 + this.speed * 0.06, 20)).addScaledVector(UP, 1.2);
      up.copy(UP).lerp(_u, 0.22).normalize();
    }
    // the camera never enters the ground or a structure
    const fl = this._floor(eye);
    if (eye.y < fl + 1.6) eye.y = fl + 1.6;
    this._unstick(eye, 2);
    if (this.shake > 0.01) {
      const s = this.shake * 0.35, t = app.elapsed * 37;
      eye.x += Math.sin(t) * s; eye.y += Math.sin(t * 1.3 + 1) * s; eye.z += Math.sin(t * 0.9 + 2) * s;
    }
    cam.position.copy(eye);
    _m.lookAt(eye, target, up);
    cam.quaternion.setFromRotationMatrix(_m);
    const fovT = (c.hood ? 66 : 58) + clamp(this.speed / 240, 0, 1) * 10 + (this.boost && this.speed > 150 ? 5 : 0);
    c.fov += (fovT - c.fov) * (1 - Math.exp(-dt * 2));
    if (Math.abs(cam.fov - c.fov) > 1e-3) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
    // keep the free-flight controller in step (compass, atlas and a clean hand-back on exit)
    const ctl = app.controls;
    _e.setFromQuaternion(cam.quaternion, 'YXZ');
    ctl.yaw = ctl.targetYaw = _e.y; ctl.pitch = ctl.targetPitch = _e.x; ctl.roll = ctl.targetRoll = 0;
    ctl.fov = ctl.baseFov = c.fov;
  }

  // ----------------------------------------------------------------- HUD --
  _hud() {
    const el = document.createElement('div');
    el.id = 'pilot-hud';
    el.hidden = true;
    el.innerHTML = `
      <div class="ph-row">
        <canvas class="ph-att" width="132" height="132" data-k="att"></canvas>
        <div class="ph-cell"><span class="ph-val" data-k="spd">0</span><span class="ph-unit">km/h</span></div>
        <div class="ph-cell"><span class="ph-val" data-k="alt">0</span><span class="ph-unit">m</span></div>
        <div class="ph-cell"><span class="ph-val" data-k="vs">0</span><span class="ph-unit">m/s</span></div>
        <div class="ph-cell ph-thr"><span class="ph-unit">thrust</span><span class="ph-bar"><i data-k="thr"></i></span></div>
        <div class="ph-cell"><span class="ph-mode" data-k="mode">HOVER</span><span class="ph-unit" data-k="gear">gear down</span></div>
      </div>
      <div class="ph-keys"><kbd>W</kbd><kbd>S</kbd> thrust · <kbd>A</kbd><kbd>D</kbd> bank · <kbd>↑</kbd><kbd>↓</kbd> pitch · <kbd>Q</kbd><kbd>E</kbd> yaw · <kbd>Space</kbd><kbd>C</kbd> lift · <kbd>Shift</kbd> boost · <kbd>G</kbd> gear · <kbd>X</kbd> view · <kbd>V</kbd> leave</div>`;
    document.body.appendChild(el);
    this.hud = el;
    this._hk = {};
    for (const n of el.querySelectorAll('[data-k]')) this._hk[n.dataset.k] = n;
  }

  _updateHud() {
    const k = this._hk, agl = this.pos.y - this._floor(this.pos);
    k.spd.textContent = Math.round(this.speed * 3.6);
    k.alt.textContent = Math.round(Math.max(agl - (this.gear > 0.5 ? 2.28 : 0.98), 0));
    k.vs.textContent = (this.vel.y >= 0 ? '+' : '') + this.vel.y.toFixed(1);
    k.thr.style.width = `${Math.round(this.throttle * 100)}%`;
    k.thr.classList.toggle('boost', this.boost);
    k.mode.textContent = this.landed ? 'LANDED' : this.tilt > 0.8 ? 'HOVER' : this.tilt > 0.15 ? 'TRANSITION' : this.boost ? 'BOOST' : 'CRUISE';
    k.gear.textContent = `gear ${this.gear > 0.5 ? 'down' : 'up'}${this.gearAuto ? '' : ' · manual'}`;
    this._attitude(k.att);
  }

  /** Artificial horizon: sky over ground turned by the bank, the pitch ladder, heading. */
  _attitude(cv) {
    const x = cv.getContext('2d'), W = cv.width, H = cv.height, c = W / 2;
    _f.set(0, 0, -1).applyQuaternion(this.quat); _r.set(1, 0, 0).applyQuaternion(this.quat);
    const pitch = Math.asin(clamp(_f.y, -1, 1)), bank = Math.asin(clamp(-_r.y, -1, 1));
    const ppd = 2.4;                                      // pixels per degree of pitch
    const deg = pitch * 180 / Math.PI;
    x.clearRect(0, 0, W, H);
    x.save();
    x.beginPath(); x.arc(c, c, c - 2, 0, Math.PI * 2); x.clip();
    x.translate(c, c); x.rotate(-bank);
    x.fillStyle = 'rgba(70, 120, 170, 0.55)'; x.fillRect(-W, -H * 2 + deg * ppd, W * 2, H * 2);
    x.fillStyle = 'rgba(120, 92, 60, 0.55)'; x.fillRect(-W, deg * ppd, W * 2, H * 2);
    x.strokeStyle = 'rgba(236, 230, 216, 0.9)'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(-W, deg * ppd); x.lineTo(W, deg * ppd); x.stroke();
    x.font = '9px ui-monospace, monospace'; x.fillStyle = 'rgba(236, 230, 216, 0.85)'; x.textAlign = 'left'; x.textBaseline = 'middle';
    for (let p = -60; p <= 60; p += 10) {
      if (!p) continue;
      const y = (deg - p) * ppd;
      if (Math.abs(y) > c) continue;
      const w = p % 20 === 0 ? 22 : 12;
      x.beginPath(); x.moveTo(-w, y); x.lineTo(w, y); x.stroke();
      if (p % 20 === 0) x.fillText(String(Math.abs(p)), w + 3, y);
    }
    x.restore();
    // fixed aircraft symbol, bank pointer and heading
    x.strokeStyle = '#e9c68f'; x.lineWidth = 2.2;
    x.beginPath(); x.moveTo(c - 30, c); x.lineTo(c - 10, c); x.lineTo(c - 5, c + 6); x.moveTo(c + 30, c); x.lineTo(c + 10, c); x.lineTo(c + 5, c + 6); x.stroke();
    x.beginPath(); x.arc(c, c, 2.2, 0, Math.PI * 2); x.fillStyle = '#e9c68f'; x.fill();
    x.strokeStyle = 'rgba(236, 230, 216, 0.5)'; x.lineWidth = 1;
    x.beginPath(); x.arc(c, c, c - 2, 0, Math.PI * 2); x.stroke();
    x.save(); x.translate(c, c); x.rotate(-bank);
    x.beginPath(); x.moveTo(0, -c + 4); x.lineTo(-5, -c + 13); x.lineTo(5, -c + 13); x.closePath(); x.fillStyle = '#e9c68f'; x.fill();
    x.restore();
    const hdg = ((Math.atan2(_f.x, -_f.z) * 180) / Math.PI + 360) % 360;
    x.fillStyle = 'rgba(8, 12, 20, 0.6)'; x.fillRect(c - 17, H - 20, 34, 14);
    x.fillStyle = '#ece6d8'; x.font = '10px ui-monospace, monospace'; x.textAlign = 'center';
    x.fillText(String(Math.round(hdg)).padStart(3, '0'), c, H - 13);
  }
}
