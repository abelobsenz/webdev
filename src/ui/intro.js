import * as THREE from 'three';
import { CameraPath, FlightDriver, DwellDriver, makeSafe, trajectoryIsSafe, clamp } from '../core/camera-path.js';
import { POIS } from './pois.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// The opening shot: framed by the Gate of Concord, in through the arches low over the water,
// across the lagoon past Verdant, then rising towards the Axis as the sun goes gold.
const KEYS = [V(-70, 44, 7050), V(0, 36, 5900), V(240, 26, 4760), V(820, 30, 3600), V(1040, 150, 3180), V(1130, 470, 2930), V(1160, 810, 2740)];
const LOOK_FROM = V(0, 760, 0);
const LOOK_TO = V(0, 1480, 0);
const DURATION = 48;
const HOURS = [17.38, 17.7];
const STAGES = [[1.3, 's1'], [2.2, 's2'], [5.2, 's3'], [7.0, 's4']];

/**
 * Cinematic opening: a slow spline flythrough runs behind the title sequence, then settles into
 * a gentle orbit of the Axis until the viewer chooses. Choosing hands control over without a cut:
 * free flight inherits the camera's motion, the tour flies on from wherever the shot is.
 */
export class Intro {
  constructor(ui) {
    this.ui = ui;
    this.app = ui.app;
    this.active = false;
    this.started = false;
    this.time = 0;
    this.stage = 0;
    this.driver = null;
  }

  /** Show the title card (called once at start-up, before the first frame). */
  prepare() {
    const el = $('intro');
    el.hidden = false;
    this.active = true;
    // split the wordmark into letters for the staggered reveal
    const h = $('intro-title');
    const word = h.textContent.trim();
    h.setAttribute('aria-label', word);
    h.textContent = '';
    [...word].forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'ch'; s.textContent = ch; s.style.setProperty('--i', String(i));
      s.setAttribute('aria-hidden', 'true');
      h.appendChild(s);
    });
    const snd = $('intro-sound');
    const ico = snd.querySelector('.snd-ico');
    ico.innerHTML = '<i></i><i></i><i></i><i></i>';
    $('btn-tour').addEventListener('click', () => this.finish(true));
    $('btn-explore').addEventListener('click', () => this.finish(false));
    $('intro-skip').addEventListener('click', () => this.skipOrExplore());
    snd.addEventListener('click', () => this.ui.setAudio(!this.app.audio.enabled));
    if (this.ui.prefs.audio) snd.classList.add('suggest');
    this.ui._updateBars();
  }

  _begin() {
    this.started = true;
    const c = this.app.controls;
    const reduced = this.ui.reducedMotion;
    const fixedCam = params.has('cam');
    this.app.hours = params.has('t') ? this.app.hours : HOURS[0];
    this.hours0 = this.app.hours;
    // the settle orbit that follows the flythrough
    const end = KEYS[KEYS.length - 1];
    this.dwell = this._settle(end);
    if (fixedCam) { this._reveal(99); return; }
    if (reduced) {
      c.setPose(end, 0, 0);
      c.lookAt(LOOK_TO);
      this._reveal(99);
      return;
    }
    const v1 = this.dwell ? this.dwell.initialVelocity() : new THREE.Vector3();
    const path = new CameraPath(KEYS, { startDir: V(0.04, -0.02, -1).normalize(), endDir: v1.lengthSq() > 1e-4 ? v1.clone().normalize() : null });
    makeSafe(this.ui.collision, path, { minClear: 14, pad: 30 });
    c.setPose(path.pointAt(0), 0, 0);
    c.lookAt(LOOK_FROM);
    this.driver = new FlightDriver(path, {
      duration: DURATION, v0: 42, v1: v1.length(), fromLook: LOOK_FROM, toLook: LOOK_TO,
      trackPeak: 0.42, accel: 0.18, decel: 0.5, bank: true,
      onDone: () => { if (this.dwell && this.active) { this.dwell.allowLook = true; c.setDriver(this.dwell); } },
    });
    this.driver.allowLook = true;
    this.driver.onRelease = () => { if (this.active) this.finish(false, true); };
    c.setDriver(this.driver);
  }

  _settle(start) {
    const center = V(0, start.y, 0);
    for (const sign of [-1, 1]) {
      const d = new DwellDriver({ start, center, look: LOOK_TO, omega: sign * 0.0125, dolly: 0.04, rise: 0.8, duration: 120, kind: 'dwell' });
      if (trajectoryIsSafe(this.ui.collision, (t, o) => d.positionAt(t, o), 60)) { d.onRelease = () => { if (this.active) this.finish(false, true); }; return d; }
    }
    return null;
  }

  _reveal(t) {
    const el = $('intro');
    while (this.stage < STAGES.length && t >= STAGES[this.stage][0]) { el.classList.add(STAGES[this.stage][1]); this.stage++; }
  }

  update(dt) {
    if (!this.active) return;
    if (!this.started) this._begin();
    this.time += dt;
    // titles run on the wall clock so they keep their rhythm even if the first frames are slow
    if (this.wall0 == null) this.wall0 = performance.now();
    this._reveal((performance.now() - this.wall0) / 1000);
    // the light warms through the shot
    if (this.driver && this.app.controls.driver === this.driver && !params.has('t')) {
      const k = clamp(this.driver.time / DURATION, 0, 1);
      this.app.hours = THREE.MathUtils.lerp(this.hours0, HOURS[1], k);
    }
  }

  /** Esc / Skip: jump to the end of the flythrough with a quick fade; a second press explores. */
  async skipOrExplore() {
    if (!this.active) return;
    const c = this.app.controls;
    if (this.driver && c.driver === this.driver && this.driver.time < DURATION - 1 && !this.skipping) {
      this.skipping = true;
      await this.ui.fade(true, 380);
      if (!this.active) { this.ui.fade(false, 380); return; }
      this.driver.time = DURATION - 0.02;
      this.app.hours = HOURS[1];
      c.update(0.016);
      this._reveal(99);
      this.skipping = false;
      await this.ui.fade(false, 520);
      return;
    }
    this.finish(false);
  }

  /** Leave the title card: tour (true) or free flight (false). */
  finish(tour, fromRelease = false) {
    if (!this.active) return;
    this.active = false;
    const el = $('intro');
    el.classList.add('leaving');
    setTimeout(() => { el.hidden = true; }, 950);
    const c = this.app.controls;
    this.ui.showHUD();
    this.ui._updateBars();
    if (tour) {
      this.ui.sound('open');
      this.ui.tour.start(0);
      return;
    }
    if (!fromRelease && c.driver) c.release();
    // context card for wherever the shot left us
    const cam = c.camera.position;
    let best = POIS[0], bd = Infinity;
    for (const p of POIS) {
      if (!p.view || Math.abs(p.view.y) > 20000) continue;
      const d = p.view.distanceTo(cam);
      if (d < bd) { bd = d; best = p; }
    }
    this.ui.showLore(best);
  }

  /** Development helper: pose the camera at time t of the opening shot (capture mode). */
  preview(t) {
    if (!this.started) this._begin();
    if (!this.driver) return;
    this.driver.time = 0; this.driver.q = null;
    const c = this.app.controls;
    c.setDriver(this.driver);
    const steps = Math.max(1, Math.ceil(t / 0.25));
    for (let i = 0; i < steps; i++) this.driver.update(t / steps, c.camera, c);
    c._apply(0.016);
    this.app.hours = THREE.MathUtils.lerp(HOURS[0], HOURS[1], clamp(t / DURATION, 0, 1));
  }
}
