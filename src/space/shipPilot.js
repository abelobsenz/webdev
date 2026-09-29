import * as THREE from 'three';
import { Starship } from './starship.js';
import { R_EARTH, R_MOON } from './sim.js';
import { RS } from './hearth.js';
import { TARGET_INFO } from './targets.js';
import { EngineVoice } from '../core/engineAudio.js';

// Flying the Lodestar in the orbital view (km units).
//
//   W / S       drive up / down               A / D        roll
//   Up / Down   nose down / nose up           Q / E        yaw (also Left / Right arrows)
//   Space / C   thrusters up / down           Shift        boost
//   G           landing legs                  X            chase / bridge camera
//   drag        look around the ship          wheel        camera distance
//   J           autopilot to the place selected in the list (any flight key takes back control)
//   V           leave the helm (the ship holds station) / take it again
//
// The drive is scale-adaptive: its top speed follows the distance to whatever is nearest (a
// planet's surface, a station, the Sun), so the ship creeps past a berth at walking pace and
// crosses to the Moon in seconds, and it brakes by itself as it comes up on anything.
// Flight assist keeps the velocity on the nose; the ship rides in the frame of the body it is
// near (the turning Earth, the Moon) so stations stay put under it at any time warp.

const V = () => new THREE.Vector3();
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const OWN = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight', 'KeyG', 'KeyX', 'KeyJ'];
const _v = V(), _w = V(), _u = V(), _f = V(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();

export class ShipPilot {
  constructor(space) {
    this.space = space;
    this.active = false;
    this.ship = null;
    this.frame = 'world';
    this.moonAnchor = new THREE.Group();
    space.scene.add(this.moonAnchor);
    this.pos = V(); this.vel = V(); this.quat = new THREE.Quaternion();   // in the current frame
    this.rates = V();
    this.throttle = 0; this.speed = 0; this.boost = false; this.legs = 0;
    this.vmax = 1; this.scale = 1; this.nearest = { name: '', d: 0 }; this.auto = null; this._msg = ''; this._msgT = 0;
    this.input = { roll: 0, pitch: 0, yaw: 0, lift: 0, thr: 0 };
    this.keys = new Set();
    this.cam = { yaw: 0, pitch: 0, dist: 0.13, held: false, idle: 9, bridge: false, q: new THREE.Quaternion(), fov: 50 };
    this._poiT = 0;
    this._bind();
    this._hud();
  }

  owns(code) { return OWN.includes(code); }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.metaKey || e.ctrlKey || !OWN.includes(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyG') this.legs = this.legs > 0.5 ? 0 : 1;
      if (e.code === 'KeyX') { this.cam.bridge = !this.cam.bridge; this.cam.yaw = this.cam.pitch = 0; }
      if (e.code === 'KeyJ') this._autopilot();
      else if (!['KeyG', 'KeyX', 'ShiftLeft', 'ShiftRight'].includes(e.code)) this.auto = null;   // any flight key takes the helm back
    }, true);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    const d = this.space.app.canvas;
    d.addEventListener('pointerdown', (e) => { if (!this.active || (e.pointerType === 'mouse' && e.button !== 0)) return; this.cam.held = true; this._lx = e.clientX; this._ly = e.clientY; });
    const up = () => { this.cam.held = false; this.cam.idle = 0; };
    d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
    d.addEventListener('pointermove', (e) => {
      if (!this.active || !this.cam.held) return;
      this.cam.yaw -= (e.clientX - this._lx) * 0.005; this.cam.pitch = clamp(this.cam.pitch + (e.clientY - this._ly) * 0.004, -1.2, 1.2);
      this._lx = e.clientX; this._ly = e.clientY; this.cam.idle = 0;
    });
    d.addEventListener('wheel', (e) => { if (!this.active) return; e.preventDefault(); this.cam.dist = clamp(this.cam.dist * Math.pow(1.0015, e.deltaY), 0.06, 3); }, { passive: false });
  }

  _readInput(dt) {
    const K = this.keys, i = this.input;
    i.thr = (K.has('KeyW') ? 1 : 0) - (K.has('KeyS') ? 1 : 0);
    i.roll = (K.has('KeyD') ? 1 : 0) - (K.has('KeyA') ? 1 : 0);
    i.pitch = (K.has('ArrowDown') ? 1 : 0) - (K.has('ArrowUp') ? 1 : 0);
    i.yaw = (K.has('KeyE') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyQ') || K.has('ArrowLeft') ? 1 : 0);
    i.lift = (K.has('Space') ? 1 : 0) - (K.has('KeyC') ? 1 : 0);
    this.boost = K.has('ShiftLeft') || K.has('ShiftRight');
    let p = null;
    try { for (const g of navigator.getGamepads ? navigator.getGamepads() : []) if (g && g.connected && g.axes.length >= 4) { p = g; break; } } catch (e) { /* not allowed */ }
    if (p) {
      const dz = (x) => (Math.abs(x) < 0.12 ? 0 : Math.sign(x) * (Math.abs(x) - 0.12) / 0.88), b = (k) => (p.buttons[k] ? p.buttons[k].value : 0);
      i.roll += dz(p.axes[0]); i.pitch += dz(p.axes[1]); i.thr += b(7) - b(6); i.yaw += b(5) - b(4); i.lift += b(0) - b(1);
      const lx = dz(p.axes[2]), ly = dz(p.axes[3]);
      if (lx || ly) { this.cam.yaw -= lx * 2.2 * dt; this.cam.pitch = clamp(this.cam.pitch + ly * 1.6 * dt, -1.2, 1.2); this.cam.idle = 0; }
    }
    for (const k of ['roll', 'pitch', 'yaw', 'lift']) i[k] = clamp(i[k], -1, 1);
  }

  // ------------------------------------------------------------ frames --
  /** The parent object whose frame the ship rides in. */
  _parent(name) { return name === 'earth' ? this.space.earthFixed : name === 'moon' ? this.moonAnchor : this.space.scene; }
  _syncFrames() {
    const sim = this.space.sim;
    this.space.earthFixed.quaternion.copy(sim.earthQuat);
    this.space.earthFixed.updateMatrixWorld(true);
    this.moonAnchor.position.copy(sim.moonPos);
    this.moonAnchor.quaternion.copy(sim.moonQuat);
    this.moonAnchor.updateMatrixWorld(true);
  }
  /** World position of the ship. */
  worldPos(out = V()) { return out.copy(this.pos).applyMatrix4(this._parent(this.frame).matrixWorld); }
  worldQuat(out = new THREE.Quaternion()) { return this._parent(this.frame).getWorldQuaternion(out).multiply(this.quat); }
  /** Move the state into the frame of the body the ship is nearest to. */
  _reframe() {
    const sim = this.space.sim, P = this.worldPos(_v);
    const want = P.distanceTo(sim.moonPos) < 66000 ? 'moon' : P.length() < 1.5e6 ? 'earth' : 'world';
    if (want === this.frame) return;
    const from = this._parent(this.frame), to = this._parent(want);
    const Q = this.worldQuat(_q);
    const Vw = _w.copy(this.vel).transformDirection(from.matrixWorld).multiplyScalar(this.vel.length());
    this.frame = want;
    this.pos.copy(P).applyMatrix4(_m.copy(to.matrixWorld).invert());
    this.quat.copy(to.getWorldQuaternion(_q2).invert().multiply(Q));
    this.vel.copy(Vw).transformDirection(_m).multiplyScalar(Vw.length());
    to.attach(this.ship.root);
  }

  // ----------------------------------------------------------- boarding --
  toggle() { if (this.active) this.exit(); else this.enter(); }

  enter() {
    const sp = this.space, cam = sp.camera;
    if (sp.mode !== 'space') return false;
    this._syncFrames();
    if (!this.ship) {
      this.ship = new Starship();
      sp.scene.add(this.ship.root);
      this.frame = 'world';
      const self = this, local = V();
      sp.addBody('lodestar', [this.ship.root], (o) => self.worldPos(o), 0.05, { solid: true, local: true, minNear: 0.002 });
      sp.targets.lodestar = {
        name: 'lodestar', key: '', position: (o) => self.worldPos(o), frame: (q) => self.worldQuat(q),
        minDist: 0.04, maxDist: 2e6, defaultDist: 0.16, view: { az: 0.9, el: 0.22 },
      };
      void local;
      this._spawn(cam);
    } else if (this.worldPos(_v).distanceTo(cam.position) > 50) this._spawn(cam);
    this.cam.q.copy(cam.quaternion);
    this.cam.fov = cam.fov;
    this.cam.yaw = this.cam.pitch = 0;
    sp.rig.enabled = false;
    this.active = true;
    this.keys.clear();
    this.hud.hidden = false;
    document.body.classList.add('piloting');
    return true;
  }

  _spawn(cam) {
    // a little ahead of the camera, on its heading
    const fwd = _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const P = V().copy(cam.position).addScaledVector(fwd, 0.16);
    this.frame = 'world';
    this.space.scene.attach(this.ship.root);
    this.pos.copy(P); this.quat.copy(cam.quaternion); this.vel.set(0, 0, 0);
    this.speed = 0; this.throttle = 0; this.rates.set(0, 0, 0);
    this._keepOut(this.pos);
    this._reframe();
  }

  exit() {
    if (!this.active) return;
    const sp = this.space;
    this.active = false;
    this.auto = null;
    this.keys.clear();
    this.hud.hidden = true;
    document.body.classList.remove('piloting');
    this.throttle = 0;
    // the orbit camera takes over, circling the ship where it holds station
    sp.rig.enabled = true;
    const t = sp.targets.lodestar;
    const rel = _v.copy(sp.camera.position).sub(this.worldPos(_w));
    const d = clamp(rel.length(), t.minDist, 2);
    const fq = this.worldQuat(_q).invert();
    rel.applyQuaternion(fq);
    const az = Math.atan2(rel.x, rel.z), el = Math.asin(clamp(rel.y / Math.max(rel.length(), 1e-6), -1, 1));
    sp.rig.set(t, az, el, d);
    sp.hud.select('lodestar', false);
  }

  // ---------------------------------------------------------- autopilot --
  _autopilot() {
    if (this.auto) { this.auto = null; return; }
    const sp = this.space, name = sp.hud && sp.hud.selected;
    const t = name && name !== 'lodestar' ? sp.targets[name] : null;
    if (!t) { this._flash('select a place in the list first'); return; }
    this.auto = { name, t, label: (TARGET_INFO[name] && TARGET_INFO[name].name) || name };
  }

  _flash(msg) { this._msg = msg; this._msgT = 2.5; }

  /** Autopilot: turn onto the target, run the drive, and ease in to its viewing distance. */
  _autoStep(dt) {
    const a = this.auto, t = a.t;
    const Pt = t.position(_u);
    const inv = _m.copy(this._parent(this.frame).matrixWorld).invert();
    const local = Pt.applyMatrix4(inv);
    const to = local.sub(this.pos), d = to.length();
    const stop = Math.max((t.defaultDist || 1) * 1.15, (t.minDist || 0) * 1.6, 0.08);
    if (d < stop * 1.02 && this.speed < Math.max(this.vmax * 0.02, 0.005)) { this.auto = null; this.throttle = 0; this._flash(`arrived: ${a.label}`); return; }
    // turn the nose onto the target (a smooth slerp capped at a comfortable rate)
    const dir = to.normalize();
    const cur = _f.set(0, 0, -1).applyQuaternion(this.quat);
    const ang = Math.acos(clamp(cur.dot(dir), -1, 1));
    const want = _q2.setFromUnitVectors(_w.set(0, 0, -1), dir);
    // keep the ship's up toward the local vertical where there is one
    const upRef = this.frame === 'world' ? _v.set(0, 1, 0).applyQuaternion(this.quat) : _v.copy(this.pos).normalize();
    _m.lookAt(V(), dir, upRef);
    want.setFromRotationMatrix(_m);
    const step = Math.min(1, (1.1 * dt) / Math.max(ang, 1e-4));
    this.quat.slerp(want, ang > 1e-4 ? step : 1).normalize();
    // drive: full while facing the target, easing off with the remaining distance
    const facing = smooth(0.5, 0.08, ang);
    const rem = Math.max(d - stop, 0);
    const vWant = Math.min(this.vmax * (this.boost ? 4 : 1), rem * 0.9) * facing;
    this.throttle = clamp(Math.sqrt(vWant / Math.max(this.vmax, 1e-6)), 0, 1);
    this.rates.multiplyScalar(Math.exp(-dt * 6));
  }

  // ------------------------------------------------------------ physics --
  /** The world distances that set the drive's scale (surfaces, then stations). */
  _survey(P) {
    const sim = this.space.sim, targets = this.space.targets;
    const cands = [
      ['Earth', P.length() - R_EARTH],
      ['Moon', P.distanceTo(sim.moonPos) - R_MOON],
      ['Sun', P.distanceTo(sim.sunPos) - 696000],
      ['the Hearth', P.distanceTo(sim.hearthPos) - RS * 3],
    ];
    let best = cands[0];
    for (const c of cands) if (c[1] < best[1]) best = c;
    let surf = best[1];
    // stations and craft (throttled: they move slowly)
    this._poiT -= 1;
    if (this._poiT <= 0 || !this._poi) {
      this._poiT = 10;
      let pd = Infinity, pn = '';
      for (const [k, t] of Object.entries(targets)) {
        if (k === 'lodestar' || k === 'earth' || k === 'moon' || k === 'sun' || k === 'hearth' || !t.position) continue;
        const d = t.position(_u).distanceTo(P) - (t.minDist || 0) * 0.5;
        if (d < pd) { pd = d; pn = t.label || t.name || k; }
      }
      this._poi = [pn, pd];
    }
    if (this._poi[1] < surf) { best = this._poi; surf = this._poi[1]; }
    this.nearest = { name: best[0], d: Math.max(best[1], 0) };
    return Math.max(surf, 0.03);
  }

  /** Keep a point (current frame) out of the bodies. */
  _keepOut(p) {
    const sim = this.space.sim;
    const legH = this.ship ? 0.0055 + 0.0060 * this.ship.state.legs : 0.006;
    const floor = (c, r) => {
      const d = _u.copy(p).sub(c), L = d.length();
      if (L < r) { p.copy(c).addScaledVector(d.divideScalar(Math.max(L, 1e-9)), r); return d; }
      return null;
    };
    let hit = null;
    if (this.frame === 'earth') hit = floor(_w.set(0, 0, 0), R_EARTH + 95);
    else if (this.frame === 'moon') hit = floor(_w.set(0, 0, 0), R_MOON + legH + 0.0005);
    else {
      hit = floor(_w.copy(sim.sunPos), 696000 * 1.08) || floor(_w.copy(sim.hearthPos), RS * 2.5);
    }
    return hit;
  }

  step(dt) {
    const i = this.input, q = this.quat;
    if (this.auto) {
      if (Math.abs(i.roll) + Math.abs(i.pitch) + Math.abs(i.yaw) + Math.abs(i.lift) + Math.abs(i.thr) > 0.05) this.auto = null;
      else { this.scale = this._survey(this.worldPos(_v)); this.vmax = clamp(this.scale * 0.45, 0.15, 3.5e5); this._autoStep(dt); }
    }
    if (!this.auto) this.throttle = clamp(this.throttle + i.thr * 0.5 * dt, 0, 1);
    // attitude: rates with smoothing; in the Earth's or Moon's frame the ship rolls level to the
    // local vertical when the roll is released
    _f.set(0, 0, -1).applyQuaternion(q);
    let roll = i.roll * 1.5, pitch = i.pitch * 0.85, yaw = i.yaw * 0.65;
    if (this.auto) roll = pitch = yaw = 0;
    if (Math.abs(i.roll) < 0.05 && this.frame !== 'world' && this.nearest.d < 60000) {
      const up = _u.copy(this.pos).normalize();
      const right = _w.set(1, 0, 0).applyQuaternion(q);
      roll -= clamp(right.dot(up), -1, 1) * 0.6;
    }
    _v.set(pitch, yaw, roll);
    this.rates.lerp(_v, 1 - Math.exp(-dt * 4));
    _q.setFromEuler(_e.set(this.rates.x * dt, -this.rates.y * dt, -this.rates.z * dt, 'XYZ'));
    q.multiply(_q).normalize();
    // the scale-adaptive drive, with flight assist on the nose
    const P = this.worldPos(_v);
    this.scale = this._survey(P);
    this.vmax = clamp(this.scale * 0.45, 0.15, 3.5e5);
    const target = this.throttle * this.throttle * this.vmax * (this.boost ? 4 : 1);
    const k = target > this.speed ? 1.1 : 2.6;          // brake harder than it accelerates
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * k));
    if (this.speed > this.vmax * 4.2) this.speed = this.vmax * 4.2;
    _f.set(0, 0, -1).applyQuaternion(q);
    _u.set(0, 1, 0).applyQuaternion(q);
    const strafe = clamp(this.scale * 0.06, 0.004, 5000) * i.lift;
    _w.copy(_f).multiplyScalar(this.speed).addScaledVector(_u, strafe);
    this.vel.lerp(_w, 1 - Math.exp(-dt * 1.8));
    this.pos.addScaledVector(this.vel, dt);
    const hit = this._keepOut(this.pos);
    if (hit) {
      // settle on the surface: velocity into it removed, a soft stop
      const n = hit.normalize(), vn = this.vel.dot(n);
      if (vn < 0) this.vel.addScaledVector(n, -vn);
      this.speed *= Math.exp(-dt * 4);
    }
    this._reframe();
  }

  // ------------------------------------------------------------ per frame --
  /** Called by the space mode instead of the orbit rig while the pilot has the helm. */
  drive(dt, cam) {
    this._syncFrames();
    this._readInput(dt);
    const n = Math.max(1, Math.ceil(dt / (1 / 90)));
    for (let k = 0; k < n; k++) this.step(dt / n);
    this._pose();
    this._camera(dt, cam);
    this._updateHud();
  }

  /** Module hook: animate, and hold station while parked. */
  update(sim, realTime, dt) {
    if (!this.ship) return;
    if (!this.active) {
      this._syncFrames();
      this.speed *= Math.exp(-(dt || 0) * 1.5);
      this.vel.multiplyScalar(Math.exp(-(dt || 0) * 1.5));
      this.pos.addScaledVector(this.vel, dt || 0);
      this.rates.multiplyScalar(Math.exp(-(dt || 0) * 3));
      this._pose();
    }
    const i = this.input;
    if (!this.voice && this.space.app.audio) this.voice = new EngineVoice(this.space.app.audio, 'drive');
    if (this.voice) this.voice.set(this.active && this.space.mode === 'space', 0.5 + 0.5 * this.throttle, this.ship.state.throttle, this.boost ? 1 : 0, this.ship.state.rcs);
    this.ship.update(dt || 0.016, {
      throttle: this.active ? Math.max(this.throttle, this.speed / Math.max(this.vmax, 1e-6) * 0.6) : 0,
      boost: this.active && this.boost ? 1 : 0, legs: this.legs,
      rcs: this.active ? Math.min(1, Math.abs(i.roll) + Math.abs(i.pitch) + Math.abs(i.yaw) + Math.abs(i.lift)) : 0,
    });
  }

  _pose() {
    const r = this.ship.root;
    r.position.copy(this.pos);
    r.quaternion.copy(this.quat);
    r.updateMatrixWorld(true);
  }

  _camera(dt, cam) {
    const c = this.cam;
    if (!c.held) { c.idle += dt; if (c.idle > 1.6) { const k = 1 - Math.exp(-dt * 1.8); c.yaw -= c.yaw * k; c.pitch -= c.pitch * k; } }
    const Qs = this.worldQuat(_q2), P = this.worldPos(_v);
    const off = _q.setFromEuler(_e.set(-c.pitch * (c.bridge ? 0.6 : 1), c.yaw, 0, 'YXZ'));
    const want = Qs.clone().multiply(off);
    c.q.slerp(want, 1 - Math.exp(-dt * (c.bridge ? 14 : 6)));
    let eye;
    if (c.bridge) eye = _w.set(0, 7.2, -4).multiplyScalar(0.001).applyQuaternion(Qs).add(P);
    else {
      const el = 0.16;
      eye = _w.set(0, Math.sin(el) * c.dist + 0.004, Math.cos(el) * c.dist).applyQuaternion(c.q).add(P);
    }
    cam.position.copy(eye);
    if (c.bridge) cam.quaternion.copy(c.q);
    else {
      const target = _u.set(0, 0, -1).applyQuaternion(Qs).multiplyScalar(0.03).add(P);
      const upv = _f.set(0, 1, 0).applyQuaternion(c.q);
      _m.lookAt(eye, target, upv);
      cam.quaternion.setFromRotationMatrix(_m);
    }
    const fovT = (c.bridge ? 62 : 50) + (this.boost ? 8 : 0) + 6 * clamp(this.speed / Math.max(this.vmax, 1e-6), 0, 1);
    c.fov += (fovT - c.fov) * (1 - Math.exp(-dt * 2));
    if (Math.abs(cam.fov - c.fov) > 1e-3) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
  }

  // ----------------------------------------------------------------- HUD --
  _hud() {
    const el = document.createElement('div');
    el.id = 'ship-hud';
    el.className = 'pilot-hud';
    el.hidden = true;
    el.innerHTML = `
      <div class="ph-row">
        <div class="ph-cell"><span class="ph-val" data-k="spd">0</span><span class="ph-unit" data-k="spdU">m/s</span></div>
        <div class="ph-cell"><span class="ph-val" data-k="near">0</span><span class="ph-unit" data-k="nearN">to Earth</span></div>
        <div class="ph-cell ph-thr"><span class="ph-unit">drive</span><span class="ph-bar"><i data-k="thr"></i></span></div>
        <div class="ph-cell"><span class="ph-mode" data-k="mode">HOLD</span><span class="ph-unit" data-k="legs">legs up</span></div>
      </div>
      <div class="ph-keys"><kbd>W</kbd><kbd>S</kbd> drive · <kbd>A</kbd><kbd>D</kbd> roll · <kbd>↑</kbd><kbd>↓</kbd> pitch · <kbd>Q</kbd><kbd>E</kbd> yaw · <kbd>Space</kbd><kbd>C</kbd> thrusters · <kbd>Shift</kbd> boost · <kbd>G</kbd> legs · <kbd>X</kbd> view · <kbd>J</kbd> autopilot to selection · <kbd>V</kbd> leave the helm</div>`;
    document.body.appendChild(el);
    this.hud = el;
    this._hk = {};
    for (const n of el.querySelectorAll('[data-k]')) this._hk[n.dataset.k] = n;
  }

  _updateHud() {
    const k = this._hk, v = this.vel.length();
    const fmt = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : km < 1000 ? `${km.toFixed(km < 10 ? 2 : 1)} km` : `${Math.round(km).toLocaleString('en-GB')} km`);
    if (v < 1) { k.spd.textContent = Math.round(v * 1000); k.spdU.textContent = 'm/s'; }
    else if (v < 29979) { k.spd.textContent = v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString('en-GB'); k.spdU.textContent = 'km/s'; }
    else { k.spd.textContent = (v / 299792).toFixed(2); k.spdU.textContent = 'c'; }
    k.near.textContent = fmt(this.nearest.d).replace(/ (m|km)$/, '');
    k.nearN.textContent = `${fmt(this.nearest.d).split(' ')[1] || ''} to ${this.nearest.name}`;
    k.thr.style.width = `${Math.round(this.throttle * 100)}%`;
    k.thr.classList.toggle('boost', this.boost);
    if (this._msgT > 0) this._msgT -= 1 / 60;
    k.mode.textContent = this._msgT > 0 ? this._msg.toUpperCase() : this.auto ? `AUTOPILOT · ${this.auto.label.toUpperCase()}` : this.throttle < 0.01 && v < 0.002 ? 'HOLD' : this.boost ? 'BOOST' : this.vmax > 2000 ? 'CRUISE' : 'MANOEUVRE';
    k.legs.textContent = `legs ${this.legs > 0.5 ? 'down' : 'up'}`;
  }
}
