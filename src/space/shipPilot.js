import * as THREE from 'three';
import { Starship, ENGINE_FRAME } from './starship.js';
import { WarpFx } from './warp.js';
import { R_EARTH, R_MOON } from './sim.js';
import { RS } from './hearth.js';
import { TARGET_INFO } from './targets.js';
import { EngineVoice } from '../core/engineAudio.js';

// Flying the Lodestar in the orbital view (km, seconds). Newtonian: the drive and thrusters push
// with realistic accelerations, gravity pulls, and nothing slows the ship but its own thrust.
//
//   W            main drive (12 g; with Shift, 300 g)    S           retro thrusters (3 g)
//   A / D        roll       Up / Down  pitch    Q / E  yaw (RCS: rates build and stop gradually)
//   Space / C    thrusters up / down (0.1 g)             B           brake to rest (flight computer)
//   Z            flight assist on / off                  G           landing legs
//   X            chase / bridge camera                   J           jump to the selected place
//   drag, wheel  look around, camera distance            V           leave the helm
//
// Frames. Near the Earth the ship moves in the Earth's rotating frame (gravity GM/r^2 with the
// centrifugal and Coriolis terms, so at geostationary altitude a ship at rest stays at rest over
// the Harbour); near the Moon, in the Moon's frame with lunar gravity; elsewhere (the solar
// stations, the Hearth) in the local free-fall frame they share. Time runs at 1x while flying.
// Flight assist spends up to 16 g of thrust to hold the ship against gravity, damp its sideslip
// and stop its rotation when the stick is released; switched off, the ship is purely ballistic.
//
// The jump drive is an Alcubierre bubble: it spools up round the ship, runs a smooth path round
// any body in the way (many times the speed of light on long jumps), and collapses at the
// destination, leaving the ship at rest in that body's frame.

const G0 = 0.00981;                    // km/s^2
const GM_EARTH = 398600.4, GM_MOON = 4902.8;
const DRIVE = 10, BOOST = 100;           // a torch drive: ten times a chemical ship's push, a hundred on boost
const A_MAIN = 1.2 * G0 * DRIVE, A_BOOST = 3.0 * G0 * BOOST, A_RETRO = 0.3 * G0 * DRIVE, A_RCS = 0.1 * G0 * DRIVE, A_ASSIST = 1.6 * G0 * DRIVE;
const RATE = { pitch: 0.4, yaw: 0.32, roll: 0.7 }, ANG_ACC = 0.45;
const C_LIGHT = 299792.458;
const V = () => new THREE.Vector3();
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const OWN = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight', 'KeyG', 'KeyX', 'KeyJ', 'KeyB', 'KeyZ'];
const _v = V(), _w = V(), _u = V(), _f = V(), _a = V(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();

export class ShipPilot {
  constructor(space) {
    this.space = space;
    this.active = false;
    this.ship = null;
    this.frame = 'world';
    this.moonAnchor = new THREE.Group();
    space.scene.add(this.moonAnchor);
    this.pos = V(); this.vel = V(); this.quat = new THREE.Quaternion();   // in the current frame
    this.rates = V();                       // x pitch (nose up), y yaw (right), z roll (right wing down)
    this.cmdAng = V(); this.cmdLin = V();
    this.burn = 0; this.accel = 0; this.assist = true; this.brake = false; this.legs = 0; this.boost = false;
    this.nearest = { name: '', d: 0 };
    this.jump = null; this._msg = ''; this._msgT = 0;
    this.input = { roll: 0, pitch: 0, yaw: 0, lift: 0, fwd: 0 };
    this.keys = new Set();
    this.cam = { yaw: 0, pitch: 0, dist: 0.4, held: false, idle: 9, bridge: false, q: new THREE.Quaternion(), fov: 50 };
    this._theta = null; this.omega = 0;
    this._moonPrev = null; this.moonVel = V();
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
      if (e.code === 'KeyZ') { this.assist = !this.assist; this._flash(this.assist ? 'flight assist on' : 'flight assist off: ballistic'); }
      if (e.code === 'KeyB') this.brake = true;
      if (e.code === 'KeyJ') this._jumpKey();
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
    d.addEventListener('wheel', (e) => { if (!this.active) return; e.preventDefault(); this.cam.dist = clamp(this.cam.dist * Math.pow(1.0015, e.deltaY), 0.05, 20); }, { passive: false });
  }

  _readInput(dt) {
    const K = this.keys, i = this.input;
    i.fwd = (K.has('KeyW') ? 1 : 0) - (K.has('KeyS') ? 1 : 0);
    i.roll = (K.has('KeyD') ? 1 : 0) - (K.has('KeyA') ? 1 : 0);
    i.pitch = (K.has('ArrowDown') ? 1 : 0) - (K.has('ArrowUp') ? 1 : 0);
    i.yaw = (K.has('KeyE') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyQ') || K.has('ArrowLeft') ? 1 : 0);
    i.lift = (K.has('Space') ? 1 : 0) - (K.has('KeyC') ? 1 : 0);
    this.boost = K.has('ShiftLeft') || K.has('ShiftRight');
    let p = null;
    try { for (const g of navigator.getGamepads ? navigator.getGamepads() : []) if (g && g.connected && g.axes.length >= 4) { p = g; break; } } catch (e) { /* not allowed */ }
    if (p) {
      const dz = (x) => (Math.abs(x) < 0.12 ? 0 : Math.sign(x) * (Math.abs(x) - 0.12) / 0.88), b = (k) => (p.buttons[k] ? p.buttons[k].value : 0);
      i.roll += dz(p.axes[0]); i.pitch += dz(p.axes[1]); i.fwd += b(7) - b(6); i.yaw += b(5) - b(4); i.lift += b(0) - b(1);
      const lx = dz(p.axes[2]), ly = dz(p.axes[3]);
      if (lx || ly) { this.cam.yaw -= lx * 2.2 * dt; this.cam.pitch = clamp(this.cam.pitch + ly * 1.6 * dt, -1.2, 1.2); this.cam.idle = 0; }
    }
    for (const k of ['roll', 'pitch', 'yaw', 'lift', 'fwd']) i[k] = clamp(i[k], -1, 1);
    if (i.fwd > 0 || Math.abs(i.lift) > 0) this.brake = false;
  }

  // ------------------------------------------------------------ frames --
  _parent(name) { return name === 'earth' ? this.space.earthFixed : name === 'moon' ? this.moonAnchor : this.space.scene; }
  _syncFrames(dt) {
    const sim = this.space.sim;
    this.space.earthFixed.quaternion.copy(sim.earthQuat);
    this.space.earthFixed.updateMatrixWorld(true);
    this.moonAnchor.position.copy(sim.moonPos);
    this.moonAnchor.quaternion.copy(sim.moonQuat);
    this.moonAnchor.updateMatrixWorld(true);
    // the frames' own motion, measured from the sim (so the physics matches what is drawn)
    const th = sim.theta;
    if (this._theta !== null && dt > 0) this.omega = (th - this._theta) / dt;
    this._theta = th;
    if (this._moonPrev && dt > 0) this.moonVel.copy(sim.moonPos).sub(this._moonPrev).divideScalar(dt);
    (this._moonPrev ||= V()).copy(sim.moonPos);
  }
  worldPos(out = V()) { return out.copy(this.pos).applyMatrix4(this._parent(this.frame).matrixWorld); }
  worldQuat(out = new THREE.Quaternion()) { return this._parent(this.frame).getWorldQuaternion(out).multiply(this.quat); }
  /** Velocity of the ship in the world (inertial) frame. */
  worldVel(out = V()) {
    const q = this._parent(this.frame).getWorldQuaternion(new THREE.Quaternion());
    if (this.frame === 'earth') return out.copy(this.vel).add(V().crossVectors(V().set(0, this.omega, 0), this.pos)).applyQuaternion(q);
    if (this.frame === 'moon') return out.copy(this.vel).applyQuaternion(q).add(this.moonVel);
    return out.copy(this.vel);
  }
  _setFrame(want, P, Q, Vw) {
    const to = this._parent(want);
    this.frame = want;
    this.pos.copy(P).applyMatrix4(new THREE.Matrix4().copy(to.matrixWorld).invert());
    const qi = to.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.quat.copy(qi).multiply(Q);
    if (want === 'earth') this.vel.copy(Vw).applyQuaternion(qi).sub(V().crossVectors(V().set(0, this.omega, 0), this.pos));
    else if (want === 'moon') this.vel.copy(Vw).sub(this.moonVel).applyQuaternion(qi);
    else this.vel.copy(Vw);
    to.attach(this.ship.root);
  }
  _frameFor(P) {
    const sim = this.space.sim;
    return P.distanceTo(sim.moonPos) < 66000 ? 'moon' : P.length() < 1.5e6 ? 'earth' : 'world';
  }
  _reframe() {
    const P = this.worldPos(V()), want = this._frameFor(P);
    if (want === this.frame) return;
    this._setFrame(want, P, this.worldQuat(new THREE.Quaternion()), this.worldVel(V()));
  }

  // ----------------------------------------------------------- boarding --
  toggle() { if (this.active) this.exit(); else this.enter(); }

  enter() {
    const sp = this.space, cam = sp.camera;
    if (sp.mode !== 'space') return false;
    this._syncFrames(0);
    if (!this.ship) {
      this.ship = new Starship();
      sp.scene.add(this.ship.root);
      this.warp = new WarpFx(this.ship.root);
      const self = this;
      this.body = sp.addBody('lodestar', [this.ship.root], (o) => self.worldPos(o), 0.06, { solid: true, local: true, minNear: 0.0015 });
      sp.targets.lodestar = {
        name: 'lodestar', key: '', position: (o) => self.worldPos(o), frame: (q) => self.worldQuat(q),
        minDist: 0.03, maxDist: 2e6, defaultDist: 0.3, view: { az: 0.9, el: 0.22 },
      };
      this._spawn(cam);
    } else if (this.worldPos(_v).distanceTo(cam.position) > 50) this._spawn(cam);
    // physics runs in real time while flying
    this._warpSaved = { warp: sp.sim.warp, paused: sp.sim.paused };
    sp.sim.warp = 1; sp.sim.paused = false; if (sp.hud.syncWarp) sp.hud.syncWarp();
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
    const fwd = _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const P = V().copy(cam.position).addScaledVector(fwd, this.cam.dist);
    const want = this._frameFor(P);
    this.space.scene.attach(this.ship.root);
    this.frame = 'world';
    this._setFrame(want, P, cam.quaternion.clone(), V());
    this.vel.set(0, 0, 0);                  // at rest in the local frame
    this.rates.set(0, 0, 0); this.burn = 0;
    this._keepOut(this.pos);
  }

  exit() {
    if (!this.active) return;
    const sp = this.space;
    this.active = false;
    this.keys.clear();
    this.hud.hidden = true;
    document.body.classList.remove('piloting');
    this.burn = 0;
    if (this.jump) this._endJump(true);
    if (this._warpSaved) { sp.sim.warp = this._warpSaved.warp; sp.sim.paused = this._warpSaved.paused; if (sp.hud.syncWarp) sp.hud.syncWarp(); }
    sp.rig.enabled = true;
    const t = sp.targets.lodestar;
    const rel = V().copy(sp.camera.position).sub(this.worldPos(V()));
    const d = clamp(rel.length(), t.minDist, 20);
    rel.applyQuaternion(this.worldQuat(new THREE.Quaternion()).invert());
    sp.rig.set(t, Math.atan2(rel.x, rel.z), Math.asin(clamp(rel.y / Math.max(rel.length(), 1e-9), -1, 1)), d);
    sp.hud.select('lodestar', false);
  }

  // ------------------------------------------------------------ physics --
  /** Gravity plus the frame's fictitious accelerations at pos with velocity vel (current frame). */
  _gravity(p, v, out) {
    out.set(0, 0, 0);
    if (this.frame === 'earth') {
      const r = p.length();
      out.copy(p).multiplyScalar(-GM_EARTH / (r * r * r));
      const w = this.omega;
      // centrifugal w^2 (x, 0, z) and Coriolis -2 w x v, the rotation about +Y
      out.x += w * w * p.x; out.z += w * w * p.z;
      out.x += -2 * w * v.z; out.z += 2 * w * v.x;
    } else if (this.frame === 'moon') {
      const r = p.length();
      out.copy(p).multiplyScalar(-GM_MOON / (r * r * r));
    }
    return out;
  }

  /** Keep the ship out of the bodies; returns the surface normal it rests on (or null). */
  _keepOut(p) {
    const sim = this.space.sim;
    const legH = 0.0017 + 0.0047 * (this.ship ? this.ship.state.legs : 0);
    const out = (c, r) => { const d = V().copy(p).sub(c), L = d.length(); if (L < r) { const n = d.divideScalar(Math.max(L, 1e-9)); p.copy(c).addScaledVector(n, r); return n; } return null; };
    if (this.frame === 'earth') return out(V(), R_EARTH + 95);
    if (this.frame === 'moon') return out(V(), R_MOON + legH);
    return out(V().copy(sim.sunPos), 696000 * 1.08) || out(V().copy(sim.hearthPos), RS * 2.5);
  }

  step(h) {
    const i = this.input, q = this.quat;
    // ---- attitude: RCS torques build the rates at a finite angular acceleration; with assist the
    // rates are driven back to zero when the stick is released, without it they persist
    const prev = V().copy(this.rates);
    const tgt = V().set(i.pitch * RATE.pitch, i.yaw * RATE.yaw, i.roll * RATE.roll);
    for (const k of ['x', 'y', 'z']) {
      const want = tgt[k], cmd = Math.abs(want) > 1e-4 || this.assist ? want : this.rates[k];
      const d = cmd - this.rates[k], m = ANG_ACC * h;
      this.rates[k] += clamp(d, -m, m);
    }
    _q.setFromEuler(_e.set(this.rates.x * h, -this.rates.y * h, -this.rates.z * h, 'XYZ'));
    q.multiply(_q).normalize();
    // the angular acceleration the RCS delivered this step (ship frame, units of its capacity)
    const dw = V().copy(this.rates).sub(prev).divideScalar(h * ANG_ACC);
    this.cmdAng.lerp(V().set(dw.x, -dw.y, -dw.z), 1 - Math.exp(-h * 30));
    // ---- forces
    const f = V().set(0, 0, -1).applyQuaternion(q), up = V().set(0, 1, 0).applyQuaternion(q);
    const burnWant = i.fwd > 0 ? (this.boost ? A_BOOST : A_MAIN) : 0;
    this.burn += (burnWant - this.burn) * (1 - Math.exp(-h * 3));        // the drive spools up and down
    const a = V().copy(f).multiplyScalar(this.burn);
    if (i.fwd < 0) a.addScaledVector(f, -A_RETRO);
    a.addScaledVector(up, i.lift * A_RCS);
    const g = this._gravity(this.pos, this.vel, V());
    let assistA = 0;
    if (this.assist || this.brake) {
      // hold against gravity, kill sideslip (braking: all motion) - within the thrust budget
      const want = V().copy(g).negate();
      if (this.brake) want.addScaledVector(this.vel, -0.6);
      else {
        const lat = V().copy(this.vel).addScaledVector(f, -this.vel.dot(f));
        if (Math.abs(i.lift) > 0.05) lat.addScaledVector(up, -lat.dot(up));
        want.addScaledVector(lat, -0.5);
      }
      const L = want.length();
      if (L > A_ASSIST) want.multiplyScalar(A_ASSIST / L);
      a.add(want);
      assistA = want.length();
      if (this.brake && this.vel.length() < 0.0004) { this.brake = false; this.vel.set(0, 0, 0); this._flash('at rest'); }
    }
    this.assistA = assistA;
    // the thrusters' share of the linear push (retro, translation, assist), ship frame, units of A_RCS
    {
      const rcsA = V().copy(a).addScaledVector(f, -this.burn);      // everything but the main drive
      const inv = this.quat.clone().invert();
      this.cmdLin.lerp(rcsA.applyQuaternion(inv).divideScalar(A_RCS), 1 - Math.exp(-h * 30));
    }
    this.accel = a.length();                  // what the crew feels
    this.vel.addScaledVector(a.add(g), h);
    this.pos.addScaledVector(this.vel, h);
    const n = this._keepOut(this.pos);
    if (n) {
      const vn = this.vel.dot(n);
      if (vn < 0) this.vel.addScaledVector(n, -vn);
      this.vel.multiplyScalar(Math.exp(-h * 3));           // resting on the ground: friction
    }
    this._reframe();
  }

  // --------------------------------------------------------------- jump --
  _jumpKey() {
    if (this.jump) { if (this.jump.phase === 'spool') { this._endJump(true); this._flash('jump cancelled'); } return; }
    const sp = this.space, name = sp.hud && sp.hud.selected;
    const t = name && name !== 'lodestar' ? sp.targets[name] : null;
    if (!t) { this._flash('select a destination in the list, then J'); return; }
    const label = (TARGET_INFO[name] && TARGET_INFO[name].name) || name;
    const start = this.worldPos(V());
    const Pt = t.position(V());
    if (Pt.distanceTo(start) < Math.max((t.defaultDist || 1) * 2, 5)) { this._flash(`already at ${label}`); return; }
    this.jump = { name, t, label, phase: 'spool', time: 0, start, bubble: 0, flow: 0, flash: 0, speed: 0 };
    this._planJump();
  }

  /** The destination point (world) for the jump's target, clear of every body. */
  _arrival(j) {
    const sim = this.space.sim, t = j.t, Pt = t.position(V());
    const bodies = [[V(), R_EARTH, 300], [sim.moonPos.clone(), R_MOON, 40], [sim.sunPos.clone(), 696000, 400000]];
    const dir = V().copy(j.start).sub(Pt);
    // a target on a body's surface is reached from above it
    for (const [c, R] of bodies) { const d = Pt.distanceTo(c); if (d < R + 3000 && d > R * 0.5) dir.copy(Pt).sub(c); }
    if (dir.lengthSq() < 1e-9) dir.set(0, 0, 1);
    dir.normalize();
    const stand = Math.max((t.defaultDist || 1) * 1.25, (t.minDist || 0) * 1.8, 0.6);
    const end = V().copy(Pt).addScaledVector(dir, stand);
    for (const [c, R, m] of bodies) { const d = end.distanceTo(c); if (d < R + m) end.copy(c).addScaledVector(end.clone().sub(c).normalize(), R + m); }
    return end;
  }

  _planJump() {
    const j = this.jump, sim = this.space.sim;
    const end = this._arrival(j);
    const bodies = [[V(), R_EARTH + 1500], [sim.moonPos.clone(), R_MOON + 600], [sim.sunPos.clone(), 696000 * 1.6]];
    // detour waypoints: where the straight line would cross a body, a point pushed clear of it;
    // the curve runs through them, and is checked (and pushed wider) until it clears everything
    const pts = [j.start.clone()];
    const ab = V().copy(end).sub(j.start), L2 = Math.max(ab.lengthSq(), 1e-9);
    const way = [];
    for (const [c, R] of bodies) {
      const tt = clamp(V().copy(c).sub(j.start).dot(ab) / L2, 0, 1);
      const close = V().copy(j.start).addScaledVector(ab, tt);
      if (close.distanceTo(c) < R) {
        const out = close.clone().sub(c);
        if (out.lengthSq() < 1e-6) out.copy(V().set(0, 1, 0).cross(ab).lengthSq() > 1e-6 ? V().set(0, 1, 0).cross(ab).cross(ab).negate() : V().set(1, 0, 0));
        way.push({ tt, c, R, out: out.normalize() });
      }
    }
    way.sort((p, q) => p.tt - q.tt);
    let curve = null;
    for (let k = 1.3; k < 8; k *= 1.35) {
      const list = [j.start.clone(), ...way.map((w) => w.c.clone().addScaledVector(w.out, w.R * k)), end.clone()];
      curve = new THREE.CatmullRomCurve3(list, false, 'centripetal');
      let ok = true;
      // sampled uniformly and densely near both ends (a long jump's detours sit close to its ends)
      for (let s = 0; s <= 600 && ok; s++) {
        const x = s / 600;
        for (const u of [x, x ** 4, 1 - x ** 4]) { const P = curve.getPointAt(u); for (const [c, R] of bodies) if (P.distanceTo(c) < R - 1400) { ok = false; break; } if (!ok) break; }
      }
      if (ok) break;
    }
    void pts;
    j.curve = curve; j.end = end;
    j.dist = curve.getLength();
    j.T = clamp(2.4 + 0.95 * Math.log10(j.dist + 1), 3.5, 9);
  }

  _bez(j, u, out) { return out.copy(j.curve.getPointAt(clamp(u, 0, 1))); }

  _jumpStep(dt) {
    const j = this.jump;
    j.time += dt;
    const SPOOL = 2.4, DROP = 1.3;
    if (j.phase === 'spool') {
      // the bubble forms; the ship comes to rest and turns onto the path
      this.vel.multiplyScalar(Math.exp(-dt * 2.5));
      this.pos.addScaledVector(this.vel, dt);
      const P = this.worldPos(V());
      j.start.copy(P);
      this._planJump();
      const dir = this._bez(j, 0.02, V()).sub(P);
      if (dir.lengthSq() > 1e-12) this._face(dir.normalize(), dt, 1.6);
      j.bubble = smooth(0, SPOOL, j.time); j.flow = 0; j.flash = 0;
      if (j.time >= SPOOL) {
        // the bubble carries the ship in the free frame
        this._setFrame('world', P, this.worldQuat(new THREE.Quaternion()), V());
        j.phase = 'transit'; j.time = 0;
      }
    } else if (j.phase === 'transit') {
      { const e = this._arrival(j), pts = j.curve.points; pts[pts.length - 1].copy(e); j.curve.updateArcLengths(); }   // a moving destination is tracked
      const tau = clamp(j.time / j.T, 0, 1), u = smoother(tau);
      const P = this._bez(j, u, V());
      const P2 = this._bez(j, Math.min(u + 0.002, 1), V());
      j.speed = P.distanceTo(this.pos) / Math.max(dt, 1e-6);
      this.pos.copy(P);
      this.vel.set(0, 0, 0);
      const dir = P2.sub(P);
      if (dir.lengthSq() > 1e-12) this._face(dir.normalize(), dt, 3);
      j.bubble = 1; j.flow = Math.pow(Math.sin(Math.PI * tau), 0.5); j.flash = 0;
      if (tau >= 1) { j.phase = 'drop'; j.time = 0; j.speed = 0; }
    } else {
      j.bubble = 1 - smooth(0, DROP, j.time); j.flow = 0; j.flash = Math.exp(-j.time * 5) * Math.min(1, j.time / 0.05);
      if (j.time >= DROP) this._endJump(false);
    }
  }

  _endJump(cancel) {
    const j = this.jump;
    this.jump = null;
    if (this.warp) this.warp.update(0, 0, 0, 0);
    // settle at rest in the frame of wherever the ship now is
    const P = this.worldPos(V());
    this._setFrame(this._frameFor(P), P, this.worldQuat(new THREE.Quaternion()), V());
    this.vel.set(0, 0, 0);
    if (!cancel && j) this._flash(`arrived: ${j.label}`);
  }

  /** Turn the nose onto a world direction at a comfortable rate (keeping an up reference). */
  _face(dirW, dt, rate) {
    const par = this._parent(this.frame).getWorldQuaternion(new THREE.Quaternion());
    const dirL = V().copy(dirW).applyQuaternion(par.invert());
    const upRef = this.frame === 'world' ? V().set(0, 1, 0).applyQuaternion(this.quat) : V().copy(this.pos).normalize();
    _m.lookAt(V(), dirL, upRef);
    const want = new THREE.Quaternion().setFromRotationMatrix(_m);
    const ang = this.quat.angleTo(want);
    this.quat.slerp(want, ang > 1e-5 ? Math.min(1, (rate * dt) / ang) : 1).normalize();
    this.rates.set(0, 0, 0);
  }

  // ------------------------------------------------------------ per frame --
  /** Called by the space mode instead of the orbit rig while the pilot has the helm. */
  drive(dt, cam) {
    this._syncFrames(dt);
    this._readInput(dt);
    if (this.jump) this._jumpStep(dt);
    else { const n = Math.max(1, Math.ceil(dt / (1 / 120))); for (let k = 0; k < n; k++) this.step(dt / n); }
    this._pose();
    this._camera(dt, cam);
    this._survey();
    this._updateHud();
  }

  /** Module hook: animate, and keep the parked ship on its (assisted) station. */
  update(sim, realTime, dt) {
    if (!this.ship) return;
    dt = dt || 0.016;
    ENGINE_FRAME.sunDir.copy(sim.sunDir);
    if (!this.active) {
      this._syncFrames(dt);
      // parked: the flight computer holds station in the local frame
      this.vel.multiplyScalar(Math.exp(-dt * 1.5));
      this.pos.addScaledVector(this.vel, dt);
      this.rates.multiplyScalar(Math.exp(-dt * 3));
      this._pose();
    }
    if (this.body) this.body.radius = 0.08;                 // the hull and its plumes
    const i = this.input, j = this.jump;
    if (this.warp) this.warp.update(dt, j ? j.bubble : 0, j ? j.flow : 0, j ? j.flash : 0);
    // while the bubble bends the light round it, the ship is drawn after the lens pass (renderOverlay)
    if (this.body) this.body.visible = !(this.warp && this.warp.active);
    const burn = this.burn / A_MAIN;
    if (!this.voice && this.space.app.audio) this.voice = new EngineVoice(this.space.app.audio, 'drive');
    const rcs = this.active ? Math.min(1, Math.abs(i.roll) + Math.abs(i.pitch) + Math.abs(i.yaw) + Math.abs(i.lift) + (i.fwd < 0 ? 1 : 0) + (this.assistA || 0) / A_ASSIST) : 0;
    if (this.voice) this.voice.set(this.active && this.space.mode === 'space', 0.5 + 0.5 * Math.min(burn, 1), Math.min(burn, 1.5) + (j ? j.bubble * 0.6 : 0), this.boost && burn > 1.1 ? 1 : 0, rcs);
    // the Earth's shadow (a cylinder behind the planet): cold-gas puffs only show in sunlight
    const Pw = this.worldPos(V()), sd = sim.sunDir, along = Pw.dot(sd);
    const sunlit = along > 0 ? 1 : smooth(R_EARTH * 0.98, R_EARTH * 1.02, V().copy(Pw).addScaledVector(sd, -along).length());
    if (!this.active) { this.cmdAng.multiplyScalar(Math.exp(-dt * 8)); this.cmdLin.multiplyScalar(Math.exp(-dt * 8)); }
    this.ship.update(dt, { throttle: this.active ? Math.min(burn, 1) : 0, aux: this.active ? Math.min(1, burn) * 0.7 : 0, boost: burn > 1.1 ? 1 : 0, legs: this.legs, rcs,
      ang: this.cmdAng, lin: this.cmdLin, sunlit, time: realTime });
  }

  /** After the scene: re-image it through the warp bubble, then draw the ship in its flat interior. */
  renderOverlay(r, cam, space) {
    if (!this.warp || !this.ship || !this.warp.active) return;
    const rt = space.app.pipeline.hdrRT;
    if (!this.warp.render(r, cam, rt)) return;
    const root = this.ship.root, d = this.worldPos(_w).distanceTo(cam.position);
    const n0 = cam.near, f0 = cam.far;
    cam.near = Math.max(d - 0.09, 0.0004); cam.far = d + 0.09; cam.updateProjectionMatrix();
    r.setRenderTarget(rt);
    r.clearDepth();
    root.visible = true;
    r.render(root, cam);
    root.visible = false;
    cam.near = n0; cam.far = f0; cam.updateProjectionMatrix();
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
    const Qs = this.worldQuat(new THREE.Quaternion()), P = this.worldPos(V());
    const off = _q.setFromEuler(_e.set(-c.pitch * (c.bridge ? 0.6 : 1), c.yaw, 0, 'YXZ'));
    const want = Qs.clone().multiply(off);
    c.q.slerp(want, 1 - Math.exp(-dt * (c.bridge ? 14 : 5)));
    let eye;
    if (c.bridge) eye = V().set(0, 4.3, -1.5).multiplyScalar(0.001).applyQuaternion(Qs).add(P);
    else {
      // during a jump the camera rises to look down on the warped sheet
      const el = 0.14 + 0.12 * (this.jump ? this.jump.bubble || 0 : 0);
      eye = V().set(0, Math.sin(el) * c.dist + 0.003, Math.cos(el) * c.dist).applyQuaternion(c.q).add(P);
    }
    cam.position.copy(eye);
    if (c.bridge) cam.quaternion.copy(c.q);
    else {
      const target = V().set(0, 0, -1).applyQuaternion(Qs).multiplyScalar(Math.min(0.02, c.dist * 0.1)).add(P);
      _m.lookAt(eye, target, V().set(0, 1, 0).applyQuaternion(c.q));
      cam.quaternion.setFromRotationMatrix(_m);
    }
    const flow = this.jump ? this.jump.flow || 0 : 0;
    const fovT = (c.bridge ? 60 : 48) + flow * 22;
    c.fov += (fovT - c.fov) * (1 - Math.exp(-dt * 2.5));
    if (Math.abs(cam.fov - c.fov) > 1e-3) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
  }

  /** Nearest body surface or station, for the HUD. */
  _survey() {
    const sim = this.space.sim, P = this.worldPos(V());
    let best = ['Earth', P.length() - R_EARTH];
    for (const c of [['Moon', P.distanceTo(sim.moonPos) - R_MOON], ['Sun', P.distanceTo(sim.sunPos) - 696000], ['the Hearth', P.distanceTo(sim.hearthPos) - RS]]) if (c[1] < best[1]) best = c;
    if (--this._poiT <= 0 || !this._poi) {
      this._poiT = 12;
      let pd = Infinity, pn = '';
      for (const [k, t] of Object.entries(this.space.targets)) {
        if (['lodestar', 'earth', 'moon', 'sun', 'hearth'].includes(k) || !t.position) continue;
        const d = t.position(_u).distanceTo(P);
        if (d < pd) { pd = d; pn = (TARGET_INFO[k] && TARGET_INFO[k].name) || k; }
      }
      this._poi = [pn, pd];
    }
    if (this._poi[1] < best[1]) best = this._poi;
    this.nearest = { name: best[0], d: Math.max(best[1], 0) };
  }

  // ----------------------------------------------------------------- HUD --
  _flash(msg) { this._msg = msg; this._msgT = 2.6; }

  _hud() {
    const el = document.createElement('div');
    el.id = 'ship-hud';
    el.hidden = true;
    el.innerHTML = `
      <div class="ph-row">
        <div class="ph-cell"><span class="ph-val" data-k="spd">0</span><span class="ph-unit" data-k="spdU">m/s</span></div>
        <div class="ph-cell"><span class="ph-val" data-k="acc">0.00</span><span class="ph-unit">g</span></div>
        <div class="ph-cell"><span class="ph-val" data-k="near">0</span><span class="ph-unit" data-k="nearN">to Earth</span></div>
        <div class="ph-cell ph-thr"><span class="ph-unit" data-k="thrL">drive</span><span class="ph-bar"><i data-k="thr"></i></span></div>
        <div class="ph-cell"><span class="ph-mode" data-k="mode">HOLD</span><span class="ph-unit" data-k="sub">assist on</span></div>
      </div>
      <div class="ph-keys"><kbd>W</kbd> drive · <kbd>S</kbd> retro · <kbd>A</kbd><kbd>D</kbd> roll · <kbd>↑</kbd><kbd>↓</kbd> pitch · <kbd>Q</kbd><kbd>E</kbd> yaw · <kbd>Space</kbd><kbd>C</kbd> thrusters · <kbd>B</kbd> brake · <kbd>Z</kbd> assist · <kbd>J</kbd> jump to selection · <kbd>G</kbd> legs · <kbd>X</kbd> view · <kbd>V</kbd> leave</div>`;
    document.body.appendChild(el);
    this.hud = el;
    this._hk = {};
    for (const n of el.querySelectorAll('[data-k]')) this._hk[n.dataset.k] = n;
  }

  _updateHud() {
    const k = this._hk, j = this.jump;
    const fmt = (km) => (km < 1 ? [Math.round(km * 1000), 'm'] : km < 1000 ? [km.toFixed(km < 10 ? 2 : 1), 'km'] : [Math.round(km).toLocaleString('en-GB'), 'km']);
    if (j && j.phase === 'transit') {
      const v = j.speed || 0;
      if (v > C_LIGHT * 0.5) { k.spd.textContent = (v / C_LIGHT).toFixed(v > 10 * C_LIGHT ? 0 : 1); k.spdU.textContent = 'c (warp)'; }
      else { k.spd.textContent = Math.round(v).toLocaleString('en-GB'); k.spdU.textContent = 'km/s (warp)'; }
    } else {
      const v = this.vel.length();
      if (v < 1) { k.spd.textContent = (v * 1000).toFixed(v < 0.01 ? 1 : 0); k.spdU.textContent = 'm/s'; }
      else { k.spd.textContent = v.toFixed(2); k.spdU.textContent = 'km/s'; }
    }
    k.acc.textContent = (j ? 0 : this.accel / G0).toFixed(2);
    const [n, u] = fmt(this.nearest.d);
    k.near.textContent = n; k.nearN.textContent = `${u} to ${this.nearest.name}`;
    const bar = j ? (j.phase === 'transit' ? 1 : j.bubble) : Math.min(this.burn / A_MAIN, 1) * 0.5 + clamp((this.burn - A_MAIN) / (A_BOOST - A_MAIN), 0, 1) * 0.5;   // main fills half, boost the rest
    k.thr.style.width = `${Math.round(clamp(bar, 0, 1) * 100)}%`;
    k.thrL.textContent = j ? 'bubble' : 'drive';
    k.thr.classList.toggle('boost', !!j || this.boost);
    if (this._msgT > 0) this._msgT -= 1 / 60;
    k.mode.textContent = this._msgT > 0 ? this._msg.toUpperCase()
      : j ? (j.phase === 'spool' ? 'JUMP · SPOOLING (J CANCELS)' : j.phase === 'transit' ? `JUMP · ${j.label.toUpperCase()}` : 'DROPPING OUT')
      : this.brake ? 'BRAKING' : this.burn > 0.001 ? (this.boost ? 'BURN · BOOST' : 'BURN') : this.vel.length() < 0.0005 ? 'HOLD' : 'COAST';
    const frame = this.frame === 'earth' ? 'Earth frame' : this.frame === 'moon' ? 'lunar frame' : 'free frame';
    k.sub.textContent = `${this.assist ? 'assist on' : 'ballistic'} · ${frame} · legs ${this.legs > 0.5 ? 'down' : 'up'}`;
  }
}
