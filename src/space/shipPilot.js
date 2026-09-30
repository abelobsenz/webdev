import * as THREE from 'three';
import { Starship, ENGINE_FRAME } from './starship.js';
import { WarpFx } from './warp.js';
import { R_EARTH, R_MOON } from './sim.js';
import { RS } from './hearth.js';
import { TARGET_INFO } from './targets.js';
import { EngineVoice } from '../core/engineAudio.js';
import { ShipContact, PortTrack, matedQuat, DOCK_POS, CAPTURE } from './shipContact.js';
import { Autopilot } from './autopilot.js';
import { getPorts, portsFor } from './ports.js';
import { LandingDust } from './landingDust.js';

// Flying the Lodestar in the orbital view (km, seconds). Newtonian: the drive and thrusters push
// with realistic accelerations, gravity pulls, and nothing slows the ship but its own thrust.
//
//   W            main drive (12 g; with Shift, 300 g)    S           reverse engines (20 g; with Shift, 300 g)
//   A / D        roll       Up / Down  pitch    Q / E  yaw (RCS: rates build and stop gradually)
//   Space / C    thrusters up / down (0.1 g)             B           brake to rest (flight computer)
//   Z            flight assist on / off                  G           landing legs
//   X            chase / bridge camera                   J           jump to the selected place
//   drag, wheel  look around, camera distance            V           leave the helm
//   N            autopilot to the selected place's port  M           next port of that place
//   U            undock                                  L           landing lights
//
// Contact (shipContact.js). The three landing legs stand the ship on the Moon's real ground
// (moonGround) and on landing pads on oleo struts; with the legs up the hull touches down hard.
// Docking: bring the dorsal ring (LODESTAR_DOCK) to a dock port slowly and square and the latches
// take it; the ship then rides the port (spin and orbit) until U pushes it off.
// Autopilot (autopilot.js): N flies to the selected destination's port and docks or lands there with
// the ship's own drives and thrusters; any flight key, or N again, hands the helm back.
// The physics core (tick) runs without a page: the verification harness (tools/verify-autopilot.mjs)
// drives it headlessly against a stand-in scene.
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
const A_MAIN = 1.2 * G0 * DRIVE, A_BOOST = 3.0 * G0 * BOOST, A_RETRO = 20 * G0, A_RETRO_BOOST = 300 * G0,   // (the bow's reverse engines: S, and Shift+S)
      A_RCS = 0.1 * G0 * DRIVE, A_ASSIST = 1.6 * G0 * DRIVE;
const RATE = { pitch: 0.4, yaw: 0.32, roll: 0.7 }, ANG_ACC = 0.45;
const C_LIGHT = 299792.458;
const V = () => new THREE.Vector3();
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const OWN = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight', 'KeyG', 'KeyX', 'KeyJ', 'KeyB', 'KeyZ', 'KeyN', 'KeyM', 'KeyU', 'KeyL'];
const FLY = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'KeyB'];
export const CAPS = { A_MAIN, A_BOOST, A_RETRO, A_RETRO_BOOST, A_RCS, A_ASSIST, RATE, ANG_ACC, G0 };
const HAS_DOM = typeof window !== 'undefined' && typeof document !== 'undefined';
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
    this.input = { roll: 0, pitch: 0, yaw: 0, lift: 0, fwd: 0, strafe: 0, surge: 0 };
    this.keys = new Set();
    this.caps = CAPS;
    this.time = 0;
    this.legPos = 0;                        // the legs' actual deployment (the model animates the same way)
    this.lights = false; this._lightsAuto = true;
    this.dock = null;                       // { track, t, relP0, relQ0, relP1, relQ1, label }
    this.contact = new ShipContact(this);
    this.ap = new Autopilot(this);
    this._docks = new Map(); this._dockT = 0;
    this._inv = new THREE.Matrix4(); this._invQ = new THREE.Quaternion(); this._parQ = new THREE.Quaternion();
    this.cam = { yaw: 0, pitch: 0, dist: 0.4, held: false, idle: 9, bridge: false, q: new THREE.Quaternion(), fov: 50 };
    this._theta = null; this.omega = 0;
    this._moonPrev = null; this.moonVel = V();
    this._poiT = 0;
    if (HAS_DOM) { this._bind(); this._hud(); }
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
      if (e.code === 'KeyN') this.navKey();
      if (e.code === 'KeyM') this.navKey(true);
      if (e.code === 'KeyU') this.undock();
      if (e.code === 'KeyL') { this.lights = !this.lights; this._lightsAuto = false; this._flash(this.lights ? 'lights on' : 'lights off'); }
      if (this.ap.on && FLY.includes(e.code)) this.ap.disengage('autopilot off: manual control');
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
    i.strafe = i.surge = 0;
    if (i.fwd > 0 || Math.abs(i.lift) > 0) this.brake = false;
    if (this.ap.on && p && (Math.abs(i.fwd) + Math.abs(i.roll) + Math.abs(i.pitch) + Math.abs(i.yaw) + Math.abs(i.lift)) > 0.3) this.ap.disengage('autopilot off: manual control');
  }

  // ---------------------------------------------------------- autopilot --
  /** N: fly to the selected destination's best port (again: stop). M: its next port. */
  navKey(cycle = false) {
    const sp = this.space, name = sp.hud && sp.hud.selected;
    if (this.ap.on && !cycle) { this.ap.disengage('autopilot off'); return; }
    if (!name || name === 'lodestar' || !sp.targets[name]) { this._flash('select a destination in the list, then N'); return; }
    const list = Autopilot.portsOf(sp, name, this.worldPos(V()));
    if (!list.length) { this._flash('no port or pad there'); return; }
    let port = list[0];
    if (cycle) {
      const cur = this.ap.port && this.ap.port.target === name ? list.indexOf(this.ap.port) : -1;
      port = list[(cur + 1) % list.length];
      if (!this.ap.on) { this.ap.port = port; this._flash(`port: ${port.label || port.id} (N to go)`); this._navPick = port; return; }
    } else if (this._navPick && this._navPick.target === name) port = this._navPick;
    if (this.jump) this._endJump(true);
    this.ap.engage(port);
  }

  /** The destination list clicked at the helm: select it (the autopilot and the jump fly there). */
  pickDestination(name) {
    const sp = this.space;
    if (sp.hud && sp.hud.select) sp.hud.select(name, false);
    this._navPick = null;
    const n = portsFor(sp, name).length, label = (TARGET_INFO[name] && TARGET_INFO[name].name) || name;
    this._flash(n ? `${label}: N auto-nav (${n} port${n > 1 ? 's' : ''}, M picks) · J jump` : `${label}: J jump`);
  }

  /** Engage the autopilot on a given port (the harness, and the HUD button). */
  navigate(port) { if (this.jump) this._endJump(true); return this.ap.engage(port); }

  // ------------------------------------------------------------- frame maps --
  _frameCache() {
    const par = this._parent(this.frame);
    this._inv.copy(par.matrixWorld).invert();
    par.getWorldQuaternion(this._parQ);
    this._invQ.copy(this._parQ).invert();
  }
  toLocal(Pw, out = V()) { return out.copy(Pw).applyMatrix4(this._inv); }
  dirToLocal(dw, out = V()) { return out.copy(dw).applyQuaternion(this._invQ); }
  toWorld(P, out = V()) { return out.copy(P).applyMatrix4(this._parent(this.frame).matrixWorld); }
  dirToWorld(d, out = V()) { return out.copy(d).applyQuaternion(this._parQ); }

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
    this._frameCache();
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
    this._frameCache();
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
    this.dock = null; this.contact.landed = false;
    this._keepOut(this.pos);
    if (this.frame === 'moon') {
      // never inside the ground: at least 40 m clear of the relief under the spawn point
      const L = this.pos.length(), g = this.contact.ground(V().copy(this.pos).divideScalar(L), {});
      const min = R_MOON + g.h + 0.04;
      if (L < min) this.pos.multiplyScalar(min / L);
    }
  }

  exit() {
    if (!this.active) return;
    const sp = this.space;
    this.active = false;
    this.ap.disengage();
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
    if (this.frame === 'moon') { void legH; return out(V(), R_MOON - 12); }   // the ground itself is the contact model's (a deep guard only)
    return out(V().copy(sim.sunPos), 696000 * 1.08) || out(V().copy(sim.hearthPos), RS * 2.5);
  }

  step(h) {
    const i = this.input, q = this.quat, ap = this.ap.on;
    if (ap) this.ap.control(h);
    const C = this.contact;
    const idle = !ap && Math.abs(i.fwd) + Math.abs(i.lift) + Math.abs(i.roll) + Math.abs(i.pitch) + Math.abs(i.yaw) < 1e-3 && !this.brake;
    if (C.landed && idle) {
      // parked on the ground: the drive idles, the ship rests on its legs and rides the Moon round
      this.vel.set(0, 0, 0); this.rates.set(0, 0, 0);
      this.burn *= Math.exp(-h * 3); this.accel = 0; this.assistA = 0;
      this.cmdAng.multiplyScalar(Math.exp(-h * 30)); this.cmdLin.multiplyScalar(Math.exp(-h * 30));
      this.reverseOn = this.reverseBoost = 0;
      this.legPos += (this.legs - this.legPos) * (1 - Math.exp(-h * 1.2));
      return;
    }
    if (C.landed && !idle) C.landed = false;
    // ---- attitude: RCS torques build the rates at a finite angular acceleration; with assist the
    // rates are driven back to zero when the stick is released, without it they persist
    const prev = V().copy(this.rates);
    const tgt = V().set(i.pitch * RATE.pitch, i.yaw * RATE.yaw, i.roll * RATE.roll);
    const planted = C.footTouch >= 2 || C.hullTouch > 0;
    for (const k of ['x', 'y', 'z']) {
      const want = tgt[k], cmd = Math.abs(want) > 1e-4 || this.assist || ap ? want : this.rates[k];
      if (planted && Math.abs(want) < 1e-4) continue;          // on the ground the legs, not the RCS, hold the attitude
      const d = cmd - this.rates[k], m = ANG_ACC * h;
      this.rates[k] += clamp(d, -m, m);
    }
    // the angular acceleration the RCS delivered this step (ship frame, units of its capacity)
    const dw = V().copy(this.rates).sub(prev).divideScalar(h * ANG_ACC);
    // the stabilisers fire only while the ship is actually being turned (or its turn stopped): no
    // demand below a small deadband, so a ship holding its attitude shows no puffs
    const dwv = V().set(dw.x, -dw.y, -dw.z);
    if (dwv.length() < 0.03) dwv.set(0, 0, 0);
    this.cmdAng.lerp(dwv, 1 - Math.exp(-h * 30));
    // ---- forces
    const f = V().set(0, 0, -1).applyQuaternion(q), up = V().set(0, 1, 0).applyQuaternion(q), rt = V().set(1, 0, 0).applyQuaternion(q);
    const burnWant = i.fwd > 0 ? i.fwd * (this.boost ? A_BOOST : A_MAIN) : 0;
    this.burn += (burnWant - this.burn) * (1 - Math.exp(-h * 3));        // the drive spools up and down
    const a = V().copy(f).multiplyScalar(this.burn);
    if (i.fwd < 0) a.addScaledVector(f, i.fwd * (this.boost ? A_RETRO_BOOST : A_RETRO));
    a.addScaledVector(up, i.lift * A_RCS).addScaledVector(rt, (i.strafe || 0) * A_RCS).addScaledVector(f, (i.surge || 0) * A_RCS);
    const g = this._gravity(this.pos, this.vel, V());
    let assistA = 0;
    if ((this.assist || this.brake) && !ap) {
      // hold against gravity, kill sideslip (braking: all motion) - within the thrust budget; with
      // the feet planted the hold lets go and the legs take the weight
      const want = V().copy(g).negate();
      if (planted && i.lift <= 0 && i.fwd <= 0) want.set(0, 0, 0);
      if (this.brake) want.addScaledVector(this.vel, -0.6);
      else {
        const lat = V().copy(this.vel).addScaledVector(f, -this.vel.dot(f));
        if (Math.abs(i.lift) > 0.05 || planted) lat.addScaledVector(up, -lat.dot(up));
        want.addScaledVector(lat, planted ? 0 : -0.5);
      }
      const L = want.length();
      if (L > A_ASSIST) want.multiplyScalar(A_ASSIST / L);
      a.add(want);
      assistA = want.length();
      if (this.brake && this.vel.length() < 0.0004) { this.brake = false; this.vel.set(0, 0, 0); this._flash('at rest'); }
    }
    this.assistA = assistA;
    // the thrusters' visible linear work is only what the pilot (or the autopilot) asks of them;
    // flight assist's hold against gravity is trimmed by the drives, and braking fires the reverse engines
    this.cmdLin.lerp(_a.set(i.strafe || 0, i.lift, -(i.surge || 0)), 1 - Math.exp(-h * 30));
    this.reverseOn = i.fwd < 0 ? -i.fwd : 0;
    this.reverseBoost = i.fwd < 0 && this.boost ? 1 : 0;
    this.accel = a.length();                  // what the crew feels
    // ---- contact: legs, hull, pads
    const cl = V(), ca = V();
    this.legPos += (this.legs - this.legPos) * (1 - Math.exp(-h * 1.2));
    C.step(h, cl, ca);
    this.vel.addScaledVector(a.add(g).add(cl), h);
    this.rates.x += ca.x * h; this.rates.y -= ca.y * h; this.rates.z -= ca.z * h;
    _q.setFromEuler(_e.set(this.rates.x * h, -this.rates.y * h, -this.rates.z * h, 'XYZ'));
    q.multiply(_q).normalize();
    this.pos.addScaledVector(this.vel, h);
    const n = this._keepOut(this.pos);
    if (n) {
      const vn = this.vel.dot(n);
      if (vn < 0) this.vel.addScaledVector(n, -vn);
      this.vel.multiplyScalar(Math.exp(-h * 3));           // resting on the ground: friction
    }
    this._reframe();
  }

  // ------------------------------------------------------------ docking --
  /** Follow the dock ports near the ship and latch onto one when the ring meets it square and slow. */
  _checkCapture(dt) {
    if (this.dock || this.jump) return;
    const sp = this.space;
    if ((this._dockT -= dt) <= 0) {
      this._dockT = 0.5;
      const Pw = this.worldPos(V()), near = [];
      for (const port of getPorts(sp)) if (port.kind === 'dock' && port.pose(sp, {}).pos.distanceTo(Pw) < 1.5) near.push(port);
      for (const k of [...this._docks.keys()]) if (!near.includes(k)) this._docks.delete(k);
      for (const port of near) if (!this._docks.has(port)) this._docks.set(port, new PortTrack(port));
    }
    for (const [port, tr] of this._docks) {
      tr.sense(this, dt);
      if (tr.age < 2) continue;
      const pose = tr.at(0, this._cp || (this._cp = {}));
      const st = ShipContact.ringState(this, pose, this._rs || (this._rs = {}));
      if (st.d > CAPTURE.dist) continue;
      const wF = V().set(this.rates.x, -this.rates.y, -this.rates.z).applyQuaternion(this.quat);
      const vR = V().crossVectors(wF, V().copy(st.ring).sub(this.pos)).add(this.vel).sub(tr.pointVel(st.ring, 0, V()));
      const ok = vR.length() < CAPTURE.speed && st.axisErr < CAPTURE.axis && st.rollErr < CAPTURE.roll;
      if (!ok) { if (!this._capWarnT || this.time - this._capWarnT > 2) { this._capWarnT = this.time; this._flash(vR.length() >= CAPTURE.speed ? 'too fast to latch' : 'not square to the port'); } continue; }
      this._capture(port, tr, pose, vR.length());
      return;
    }
  }

  _capture(port, tr, pose, v) {
    const qi = pose.q.clone().invert();
    const Qt = matedQuat('dock', pose.n, pose.fwd);
    const Pt = V().copy(DOCK_POS).applyQuaternion(Qt).negate().add(pose.pos);
    const st = ShipContact.ringState(this, pose);
    this.dock = {
      port, track: tr, t: 0, hard: false, label: port.label || port.id, v,
      relQ0: qi.clone().multiply(this.quat), relP0: V().copy(this.pos).sub(pose.pos).applyQuaternion(qi),
      relQ1: qi.clone().multiply(Qt), relP1: V().copy(Pt).sub(pose.pos).applyQuaternion(qi),
    };
    this.lastCapture = { v, axisErr: st.axisErr, rollErr: st.rollErr, d: st.d, t: this.time, label: this.dock.label };
    this.burn = 0; this.rates.set(0, 0, 0);
    this.brake = false;
    this._flash(`soft capture ${(v * 1000).toFixed(2)} m/s`);
    if (this.ap.on) this.ap.disengage();
    if (this.onDocked) this.onDocked(this.dock);
  }

  _clampPad(port) {
    const tr = this.contact._tracks.get(port);
    if (!tr || !tr.ok) return;
    const pose = tr.at(this.contact._s || 0, {}), qi = pose.q.clone().invert();   // (called mid-step: the pose at this substep)
    const relQ = qi.clone().multiply(this.quat), relP = V().copy(this.pos).sub(pose.pos).applyQuaternion(qi);
    this.dock = { port, track: tr, t: 0, hard: false, pad: true, label: port.label || port.id, v: 0, relQ0: relQ, relQ1: relQ.clone(), relP0: relP, relP1: relP.clone() };
  }

  /** Docked: the ship's pose is the port's (drawn in over the soft-capture second). */
  _dockStep(dt) {
    const d = this.dock, tr = d.track;
    tr.sense(this, dt);
    const pose = tr.at(0, this._dp || (this._dp = {}));
    d.t += dt;
    const k = smooth(0, 1.2, d.t);
    const relQ = _q.slerpQuaternions(d.relQ0, d.relQ1, k), relP = V().lerpVectors(d.relP0, d.relP1, k);
    this.quat.copy(pose.q).multiply(relQ);
    this.pos.copy(relP).applyQuaternion(pose.q).add(pose.pos);
    tr.pointVel(this.pos, 0, this.vel);
    this.rates.set(0, 0, 0); this.burn = 0; this.accel = 0;
    this.cmdAng.multiplyScalar(0.8); this.cmdLin.multiplyScalar(0.8);
    this.input.fwd = 0; this.reverseOn = 0;
    if (!d.hard && k >= 1) { d.hard = true; if (!d.pad) this._flash(`docked: ${d.label}`); }
  }

  /** U: release the latches and push off gently along the port's axis. */
  undock(quiet = false) {
    const d = this.dock;
    if (!d) { if (!quiet) this._flash('not docked'); return; }
    const pose = d.track.at(0, {});
    this.dock = null;
    d.track.pointVel(this.pos, 0, this.vel).addScaledVector(pose.n, 0.0004);
    const wb = V().copy(d.track.omega).applyQuaternion(this.quat.clone().invert());
    this.rates.set(wb.x, -wb.y, -wb.z);
    this._docks.clear(); this._dockT = 3;                    // no re-latching while it drifts clear
    if (!quiet) this._flash('undocked');
  }

  /** The physics without the page: frames, autopilot, jump, flight, contact, capture. */
  tick(dt) {
    this.time += dt;
    this._syncFrames(dt);
    if (this.dock) { this._dockStep(dt); this.contact.survey(); return; }
    this.contact.sense(dt);
    if (this.ap.on) this.ap.sense(dt);
    if (this.jump) this._jumpStep(dt);
    else { const n = Math.max(1, Math.ceil(dt / (1 / 120))); for (let k = 0; k < n; k++) this.step(dt / n); }
    this._checkCapture(dt);
    this.contact.survey();
    if (this._lightsAuto) this.lights = this.legs > 0.5 && this.contact.agl < 3;
    if (this.dust) this.dust.feed(dt, this);
  }

  onLanded() {
    const c = this.contact;
    // a pad that moves (a deck on a station): the landing clamps hold the ship to it, and from
    // then on it rides the pad exactly as a docked ship rides its port
    if (c.surfPad && (this.frame !== 'moon' || c.surfV.length() > 0.0005)) this._clampPad(c.surfPad);
    this._flash(`landed${this.contact.padUnder ? `: ${this.contact.padUnder.label || ''}` : ''}`);
    if (this.ap.on && this.ap.port.kind === 'pad' && this.ap.phase === 'touchdown') this.ap.disengage();
    this.lastLanding = { t: this.time, impact: this.contact.impact };
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

  /** Jump to an exact world point (at(out) fills it; it may move while the bubble runs). */
  jumpTo(label, at) {
    if (this.jump) return false;
    const start = this.worldPos(V());
    this.jump = { name: label, t: { position: at, defaultDist: 0, minDist: 0 }, at, label, phase: 'spool', time: 0, start, bubble: 0, flow: 0, flash: 0, speed: 0 };
    this._planJump();
    return true;
  }

  /** The destination point (world) for the jump's target, clear of every body. */
  _arrival(j) {
    const sim = this.space.sim, t = j.t, Pt = j.at ? j.at(V()) : t.position(V());
    const bodies = [[V(), R_EARTH, 300], [sim.moonPos.clone(), R_MOON, 40], [sim.sunPos.clone(), 696000, 400000]];
    if (j.at) {
      // an exact standoff (the autopilot's): only kept clear of the bodies
      for (const [c, R, m] of bodies) { const d = Pt.distanceTo(c); if (d < R + m) { const u = Pt.clone().sub(c).normalize(); Pt.copy(c).addScaledVector(u, R + m); } }
      return Pt;
    }
    const dir = V().copy(j.start).sub(Pt);
    // a target on a body's surface is reached from above it
    for (const [c, R] of bodies) { const d = Pt.distanceTo(c); if (d < R + 3000 && d > R * 0.5) dir.copy(Pt).sub(c); }
    if (dir.lengthSq() < 1e-9) dir.set(0, 0, 1);
    dir.normalize();
    const stand = Math.max((t.defaultDist || 1) * 1.25, (t.minDist || 0) * 1.8, 0.6);
    const end = V().copy(Pt).addScaledVector(dir, stand);
    // (the direction out of the body is taken before end is overwritten: copy-then-read gave the body's centre)
    for (const [c, R, m] of bodies) { const d = end.distanceTo(c); if (d < R + m) { const u = end.clone().sub(c).normalize(); end.copy(c).addScaledVector(u, R + m); } }
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
    this._readInput(dt);
    if (this.dust === undefined) this.dust = new LandingDust(this.moonAnchor);
    this.tick(dt);
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
      if (this.dock) this._dockStep(dt);                    // docked: still riding the port
      else if (!this.contact.landed) {
        // parked: the flight computer holds station in the local frame (a landed ship just stands)
        this.vel.multiplyScalar(Math.exp(-dt * 1.5));
        this.pos.addScaledVector(this.vel, dt);
        this.rates.multiplyScalar(Math.exp(-dt * 3));
      }
      this._pose();
    }
    if (this.body) this.body.radius = 0.08;                 // the hull and its plumes
    const i = this.input, j = this.jump;
    if (this.warp) this.warp.update(dt, j ? j.bubble : 0, j ? j.flow : 0, j ? j.flash : 0);
    // while the bubble bends the light round it, the ship is drawn after the lens pass (renderOverlay)
    if (this.body) this.body.visible = !(this.warp && this.warp.active);
    const burn = this.burn / A_MAIN;
    if (!this.voice && this.space.app.audio) this.voice = new EngineVoice(this.space.app.audio, 'drive');
    const rcs = this.active ? Math.min(1, Math.abs(i.roll) + Math.abs(i.pitch) + Math.abs(i.yaw) + Math.abs(i.lift)) : 0;
    if (this.voice) this.voice.set(this.active && this.space.mode === 'space', 0.5 + 0.5 * Math.min(burn, 1), Math.min(burn, 1.5) + (j ? j.bubble * 0.6 : 0), this.boost && burn > 1.1 ? 1 : 0, rcs);
    // the Earth's shadow (a cylinder behind the planet): cold-gas puffs only show in sunlight
    const Pw = this.worldPos(V()), sd = sim.sunDir, along = Pw.dot(sd);
    const sunlit = along > 0 ? 1 : smooth(R_EARTH * 0.98, R_EARTH * 1.02, V().copy(Pw).addScaledVector(sd, -along).length());
    if (!this.active) { this.cmdAng.multiplyScalar(Math.exp(-dt * 8)); this.cmdLin.multiplyScalar(Math.exp(-dt * 8)); }
    this.ship.update(dt, { throttle: this.active ? Math.min(burn, 1) : 0, aux: this.active ? Math.min(1, burn) * 0.7 : 0, boost: burn > 1.1 ? 1 : 0, legs: this.legs, rcs, reverse: this.active ? (this.reverseOn || 0) : 0, reverseBoost: this.active ? (this.reverseBoost || 0) : 0,
      ang: this.cmdAng, lin: this.cmdLin, sunlit, time: realTime,
      gear: this.contact.gear, docked: this.dock ? (this.dock.hard ? 1 : 0.5) : 0, lights: this.lights ? 1 : 0 });
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
      <div class="ph-row ph-land" data-k="land" hidden>
        <div class="ph-cell"><span class="ph-val" data-k="ralt">0</span><span class="ph-unit" data-k="raltU">m radar alt</span></div>
        <div class="ph-cell"><span class="ph-val" data-k="vs">0.0</span><span class="ph-unit">m/s vertical</span></div>
        <div class="ph-cell"><span class="ph-val" data-k="hs">0.0</span><span class="ph-unit">m/s across</span></div>
        <div class="ph-cell"><span class="ph-val" data-k="lvl">0.0</span><span class="ph-unit" data-k="lvlU">deg off level</span></div>
        <div class="ph-cell"><span class="ph-mode" data-k="gear">LEGS UP</span><span class="ph-unit" data-k="gearU">lights off</span></div>
      </div>
      <div class="ph-row ph-ap" data-k="apRow" hidden>
        <div class="ph-cell" style="min-width:150px;justify-items:start"><span class="ph-mode" data-k="apPhase">AUTOPILOT</span><span class="ph-unit" data-k="apLabel">-</span></div>
        <div class="ph-cell"><span class="ph-val" data-k="apD">0</span><span class="ph-unit" data-k="apDU">m to go</span></div>
        <div class="ph-cell"><span class="ph-val" data-k="apV">0.0</span><span class="ph-unit" data-k="apVU">m/s closing</span></div>
        <div class="ph-cell"><span class="ph-val" data-k="apEta">-</span><span class="ph-unit">eta</span></div>
      </div>
      <button type="button" data-k="apBtn" style="pointer-events:auto;cursor:pointer;font:inherit;font-size:10.5px;letter-spacing:0.16em;color:var(--gold);background:rgba(8,12,20,0.5);border:1px solid rgba(233,198,143,0.35);border-radius:8px;padding:5px 12px">AUTO-NAV TO SELECTION (N)</button>
      <div class="ph-keys"><kbd>W</kbd> drive · <kbd>S</kbd> reverse (Shift: 300 g) · <kbd>A</kbd><kbd>D</kbd> roll · <kbd>↑</kbd><kbd>↓</kbd> pitch · <kbd>Q</kbd><kbd>E</kbd> yaw · <kbd>Space</kbd><kbd>C</kbd> thrusters · <kbd>B</kbd> brake · <kbd>Z</kbd> assist · <kbd>J</kbd> jump to selection · <kbd>N</kbd> auto-nav · <kbd>M</kbd> next port · <kbd>U</kbd> undock · <kbd>G</kbd> legs · <kbd>L</kbd> lights · <kbd>X</kbd> view · <kbd>V</kbd> leave</div>`;
    document.body.appendChild(el);
    this.hud = el;
    this._hk = {};
    for (const n of el.querySelectorAll('[data-k]')) this._hk[n.dataset.k] = n;
    this._hk.apBtn.addEventListener('click', (e) => { e.preventDefault(); e.currentTarget.blur(); if (this.active) this.navKey(); });
    this._hk.apBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /** The landing aids and the autopilot panel. */
  _updateAids() {
    const k = this._hk, c = this.contact, ap = this.ap;
    const show = (el, on) => { if (el.hidden === on) el.hidden = !on; };
    // landing aids near the ground, a pad or a port
    const near = !this.jump && (c.agl < 3 || this.dock || c.landed || (ap.on && (ap.phase === 'final' || ap.phase === 'touchdown' || ap.phase === 'approach')));
    show(k.land, !!near);
    if (near) {
      const up = c.agl < Infinity ? c.groundN : V().copy(this.pos).normalize();
      const vr = V().copy(this.vel);
      if (this.dock) vr.set(0, 0, 0);
      const vs = vr.dot(up), hs = V().copy(vr).addScaledVector(up, -vs).length();
      const alt = this.dock ? 0 : Math.max(c.agl, 0);
      if (alt < 1) { k.ralt.textContent = (alt * 1000).toFixed(alt < 0.1 ? 1 : 0); k.raltU.textContent = 'm radar alt'; } else { k.ralt.textContent = alt.toFixed(2); k.raltU.textContent = 'km radar alt'; }
      k.vs.textContent = `${vs >= 0 ? '+' : ''}${(vs * 1000).toFixed(1)}`;
      k.hs.textContent = (hs * 1000).toFixed(1);
      const sUp = V().set(0, 1, 0).applyQuaternion(this.quat);
      const off = Math.acos(clamp(sUp.dot(up), -1, 1)) * 180 / Math.PI;
      k.lvl.textContent = off.toFixed(1);
      k.lvlU.textContent = `deg to ground · slope ${(c.slope * 180 / Math.PI).toFixed(0)}`;
      k.lvl.style.color = off > 12 ? '#ff9a7a' : '';
      k.vs.style.color = vs < -0.003 && alt < 0.05 ? '#ff9a7a' : '';
      k.gear.textContent = this.dock ? (this.dock.pad ? 'LANDED · CLAMPED' : this.dock.hard ? 'DOCKED' : 'CAPTURE') : c.landed ? 'LANDED' : this.legs > 0.5 ? (this.legPos > 0.95 ? 'LEGS DOWN' : 'LEGS …') : 'LEGS UP';
      k.gearU.textContent = `lights ${this.lights ? 'on' : 'off'}${c.footTouch ? ` · ${c.footTouch} feet down` : ''}${c.gear.some((x) => x > 0.01) ? ` · struts ${c.gear.map((x) => Math.round(x * 100)).join('/')}%` : ''}`;
    }
    // the autopilot
    const picked = !ap.on && this._navPick;
    show(k.apRow, ap.on || !!picked);
    k.apBtn.textContent = ap.on ? 'AUTOPILOT OFF (N)' : this.dock ? 'UNDOCK (U) · AUTO-NAV (N)' : 'AUTO-NAV TO SELECTION (N)';
    if (ap.on) {
      const i = ap.info;
      k.apPhase.textContent = `AUTO · ${ap.phaseLabel().toUpperCase()}`;
      k.apLabel.textContent = i.label;
      const d = ap.phase === 'jump' ? (this.jump ? this.jump.dist || 0 : 0) : i.d;
      if (d < 1) { k.apD.textContent = Math.round(d * 1000); k.apDU.textContent = 'm to go'; } else { k.apD.textContent = d < 100 ? d.toFixed(1) : Math.round(d).toLocaleString('en-GB'); k.apDU.textContent = 'km to go'; }
      const v = i.vc;
      if (Math.abs(v) < 1) { k.apV.textContent = (v * 1000).toFixed(Math.abs(v) < 0.01 ? 2 : 0); k.apVU.textContent = 'm/s closing'; } else { k.apV.textContent = v.toFixed(2); k.apVU.textContent = 'km/s closing'; }
      const e = i.eta;
      k.apEta.textContent = !Number.isFinite(e) || e > 36000 ? '-' : e < 90 ? `${Math.round(e)} s` : `${Math.floor(e / 60)}:${String(Math.round(e % 60)).padStart(2, '0')}`;
    } else if (picked) {
      k.apPhase.textContent = 'PORT SELECTED'; k.apLabel.textContent = picked.label || picked.id;
      k.apD.textContent = '-'; k.apV.textContent = '-'; k.apEta.textContent = 'N to go';
    }
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
      : this.dock ? (this.dock.pad ? 'LANDED · U LIFTS OFF' : this.dock.hard ? 'DOCKED · U UNDOCKS' : 'SOFT CAPTURE') : this.contact.landed ? 'LANDED' : this.ap.on ? 'AUTOPILOT' : this.brake ? 'BRAKING' : this.burn > 0.001 ? (this.boost ? 'BURN · BOOST' : 'BURN') : this.vel.length() < 0.0005 ? 'HOLD' : 'COAST';
    this._updateAids();
    const frame = this.frame === 'earth' ? 'Earth frame' : this.frame === 'moon' ? 'lunar frame' : 'free frame';
    k.sub.textContent = `${this.assist ? 'assist on' : 'ballistic'} · ${frame} · legs ${this.legs > 0.5 ? 'down' : 'up'}`;
  }
}
