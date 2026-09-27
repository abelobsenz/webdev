import * as THREE from 'three';
import { POIS, TOUR } from './pois.js';
import { planFlight, FlightDriver, DwellDriver, trajectoryIsSafe, clamp, smootherstep } from '../core/camera-path.js';

const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3;
const pad2 = (n) => String(n).padStart(2, '0');
const wrap24 = (h) => ((h % 24) + 24) % 24;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function sentences(text) {
  return (String(text).match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text]).map((s) => s.trim()).filter(Boolean);
}
function readTime(s) { return clamp(1.0 + s.split(/\s+/).length * 0.3, 3.0, 8.5); }

function chapterName(h) {
  if (h >= 4.5 && h < 6.8) return 'Dawn';
  if (h >= 6.8 && h < 10.5) return 'Morning';
  if (h >= 10.5 && h < 14) return 'Midday';
  if (h >= 14 && h < 16.8) return 'Afternoon';
  if (h >= 16.8 && h < 18.3) return 'Golden hour';
  if (h >= 18.3 && h < 19.6) return 'Dusk';
  return 'Night';
}

/** How to get from hour h0 to h1: animate a short change during the flight, or cut through black. */
function timePlan(h0, h1) {
  const fwd = wrap24(h1 - h0);
  if (fwd < 0.01 || fwd > 23.99) return { mode: 'none', delta: 0 };
  const back = fwd - 24;
  if (-back <= 2.2) return { mode: 'animate', delta: back };
  if (fwd <= 6) return { mode: 'animate', delta: fwd };
  return { mode: 'cut', delta: fwd };
}

/**
 * Guided tour director. Each stop is a planned flight (collision-safe Catmull-Rom spline with
 * look-ahead) that eases into a slow orbit or dolly while the narration plays as subtitles.
 * Time of day moves with the flight; large jumps become a chapter cut through black.
 * Transport: pause / resume (eases the whole move to a halt), previous, next, end.
 */
export class Tour {
  constructor(ui) {
    this.ui = ui;
    this.app = ui.app;
    this.c = ui.app.controls;
    this.active = false;
    this.paused = false;
    this.index = -1;
    this.scale = 1;
    this.cur = null;
    this.fading = false;
    $('tour-exit').addEventListener('click', () => this.stop());
    $('tour-next').addEventListener('click', () => this.next());
    $('tour-prev').addEventListener('click', () => this.prev());
    $('tour-pause').addEventListener('click', () => this.togglePause());
  }

  get stops() { return TOUR.map((id) => POIS.find((p) => p.id === id)).filter((p) => p && p.view && p.target); }

  start(i = 0) {
    const ui = this.ui, app = this.app;
    if (ui.photo.active) ui.photo.exit();
    if (ui.atlas.open) ui.atlas.close();
    this.active = true;
    this.paused = false;
    this.scale = 1;
    this.savedTimeSpeed = app.timeSpeed;
    app.timeSpeed = 0;
    ui._syncPlay();
    ui.timeTarget = null;
    ui.showHUD();
    $('tour').hidden = false;
    $('tour').classList.remove('paused');
    this._syncPause();
    $('btn-tour2').classList.add('active');
    $('lore').hidden = true;
    for (const id of ['settings', 'help']) $(id).hidden = true;
    document.body.classList.remove('panel-open');
    document.body.classList.add('cinema');
    ui._updateBars();
    this._buildProgress();
    this._go(i);
  }

  stop({ handoff = true } = {}) {
    if (!this.active) return;
    this.active = false;
    this.cur = null;
    const ui = this.ui;
    this.c.timeScale = 1;
    if (handoff && this.c.driver) this.c.release();
    $('tour').hidden = true;
    $('caption').classList.remove('on');
    $('subtitle').classList.remove('on');
    $('chapter').classList.remove('on');
    if (this.fading) { this.fading = false; ui.fade(false, 400); }
    document.body.classList.remove('cinema', 'peek');
    $('btn-tour2').classList.remove('active');
    ui._updateBars();
  }

  next() { if (this.active) this._go(this.index + 1); }
  prev() { if (this.active) this._go(Math.max(this.index - 1, 0)); }

  togglePause() {
    if (!this.active) return;
    this.paused = !this.paused;
    $('tour').classList.toggle('paused', this.paused);
    this._syncPause();
    this.ui.sound('tick');
  }

  _syncPause() {
    $('tour-pause-glyph').setAttribute('d', this.paused ? 'M4 2.5v11l9-5.5z' : 'M4 3h3v10H4zM9 3h3v10H9z');
    $('tour-pause').setAttribute('aria-label', this.paused ? 'Resume tour' : 'Pause tour');
  }

  _buildProgress() {
    const bar = $('tour-progress');
    bar.innerHTML = '';
    this.segs = this.stops.map((p, k) => {
      const s = document.createElement('span');
      s.title = p.name;
      s.addEventListener('click', () => this._go(k));
      bar.appendChild(s);
      return s;
    });
  }

  // ------------------------------------------------------------ stops --
  _go(i) {
    const stops = this.stops;
    if (!this.active) return;
    if (i >= stops.length) { this._finish(); return; }
    i = Math.max(0, i);
    this.index = i;
    const poi = stops[i];
    // a chapter cut may still be dark if the viewer skipped ahead: bring the picture back
    if (this.fading) { this.fading = false; $('chapter').classList.remove('on'); this.ui.fade(false, 500); }
    const ui = this.ui, c = this.c;
    const cam = c.camera.position.clone();
    const dr = c.driver;
    const vel = dr && dr.vel ? dr.vel.clone() : c.velocity.clone();
    if (!Number.isFinite(vel.x)) vel.set(0, 0, 0);
    const narr = this._narration(poi);
    const dwell = this._planDwell(poi, cam, narr.total);
    const st = this.cur = {
      poi, narr, dwell, dwellDur: narr.total, phase: 'flight', t: 0, dwellT: 0, flightDur: 0,
      captionShown: false, captionHidden: false, sub: -1, h0: this.app.hours,
      plan: poi.time != null ? timePlan(this.app.hours, poi.time) : { mode: 'none', delta: 0 },
    };
    $('tour-count').textContent = `${pad2(i + 1)} / ${pad2(stops.length)}`;
    $('tour-title').textContent = poi.name;
    $('caption').classList.remove('on');
    $('subtitle').classList.remove('on');
    this.segs.forEach((s, k) => { s.classList.toggle('done', k < i); s.style.setProperty('--p', k < i ? '1' : '0'); });
    const dist = cam.distanceTo(poi.view);
    if (ui.reducedMotion || st.plan.mode === 'cut' || dist > 45000) { this._cut(st); return; }
    this._fly(st, cam, vel, dwell.initialVelocity());
  }

  _fly(st, from, vel, v1vec, { duration } = {}) {
    const ui = this.ui, c = this.c, poi = st.poi;
    const fromDir = vel.lengthSq() > 1 ? vel.clone().normalize() : c.forward(new V3());
    const endDir = v1vec.lengthSq() > 1e-4 ? v1vec.clone().normalize() : null;
    const { path } = planFlight(ui.collision, from, poi.view, { fromDir, endDir, toLook: poi.target, minClear: 16, pad: 36 });
    const L = path.length;
    const dur = duration ?? clamp(5 + Math.sqrt(L) * 0.12, 7, 22);
    const fromLook = from.clone().addScaledVector(c.forward(new V3()), clamp(L * 0.5, 300, 2500));
    const fd = new FlightDriver(path, {
      duration: dur, v0: vel.length(), v1: v1vec.length(), fromLook, toLook: poi.target, bank: !ui.reducedMotion,
      onDone: () => { if (this.active && this.cur === st) this._startDwell(st); },
    });
    fd.allowLook = true;
    st.flight = fd;
    st.flightDur = dur;
    st.phase = 'flight';
    st.path = path;
    c.setDriver(fd);
    if (L > 2500) ui.sound('fly');
  }

  _startDwell(st) {
    st.phase = 'dwell';
    st.dwellT = 0;
    st.dwell.allowLook = true;
    this.c.setDriver(st.dwell);
  }

  async _cut(st) {
    const ui = this.ui, c = this.c, poi = st.poi, app = this.app;
    const reduced = ui.reducedMotion;
    const chapter = st.plan.mode === 'cut';
    st.phase = 'cut';
    this.fading = true;
    // hold the current move while we fade
    await ui.fade(true, reduced ? 450 : 950);
    if (!this.active || this.cur !== st) return;
    if (poi.time != null) app.hours = poi.time;
    if (chapter) {
      $('chapter-eyebrow').textContent = `Tour · ${pad2(this.index + 1)} / ${pad2(this.stops.length)}`;
      $('chapter-title').textContent = chapterName(poi.time);
      $('chapter').classList.add('on');
      ui.sound('chapter');
    }
    if (reduced) {
      c.setPose(poi.view, 0, 0);
      c.lookAt(poi.target);
      this._startDwell(st);
    } else {
      // start a short approach behind the vantage point and fly the last stretch in
      const v1 = st.dwell.initialVelocity();
      const dir = v1.lengthSq() > 1e-4 ? v1.clone().normalize() : poi.target.clone().sub(poi.view).setY(0).normalize();
      const back = clamp(poi.view.distanceTo(poi.target) * 0.3, 140, 650);
      const from = poi.view.clone().addScaledVector(dir, -back);
      from.y += back * 0.16;
      from.y = Math.max(from.y, ui.collision.planFloor(from.x, from.z) + 18);
      for (let k = 0; k < 6; k++) {
        const pen = ui.collision.penetration(from.x, from.y, from.z, 30, true);
        if (!pen) break;
        from.x += pen.nx * (pen.depth + 5); from.z += pen.nz * (pen.depth + 5);
      }
      c.setPose(from, 0, 0);
      c.lookAt(poi.target);
      this._fly(st, from, dir.clone().multiplyScalar(Math.max(v1.length(), 8) + back / 7), v1, { duration: 7 });
    }
    await wait(chapter ? 1700 : 120);
    if (!this.active || this.cur !== st) return;
    $('chapter').classList.remove('on');
    await ui.fade(false, reduced ? 450 : 1200);
    this.fading = false;
  }

  _finish() {
    this.stop({ handoff: true });
    this.ui.toast('That is the end of the tour. Fly anywhere, or press T to watch it again.', 5200);
  }

  _narration(poi) {
    const lines = [];
    let t = 0.7;
    if (this.ui.prefs.subtitles) {
      for (const s of sentences(poi.lore || '')) { const d = readTime(s); lines.push([t, t + d, s]); t += d + 0.35; }
    }
    const total = lines.length ? clamp(t + 1.4, 10, 36) : 12;
    return { lines, total };
  }

  /** Pick a gentle move for the dwell that stays clear of everything; prefer continuing the arrival direction. */
  _planDwell(poi, from, dur) {
    const view = poi.view, look = poi.target;
    const still = () => new DwellDriver({ start: view, center: look, look, truck: new V3(), dolly: 0, rise: 0, duration: dur });
    if (this.ui.reducedMotion) return still();
    const incoming = view.clone().sub(from).setY(0);
    if (incoming.lengthSq() < 1) incoming.set(0, 0, -1);
    incoming.normalize();
    const cands = [];
    if (poi.orbit && poi.orbit.center) {
      const center = poi.orbit.center;
      const r = Math.max(Math.hypot(view.x - center.x, view.z - center.z), 1);
      const maxLin = clamp(r * 0.016, 3, 34);
      const w = Math.min(Math.abs(poi.orbit.speed || 0.04) * 0.65, maxLin / r);
      const a = Math.atan2(view.z - center.z, view.x - center.x);
      const tx = -Math.sin(a), tz = Math.cos(a);
      const pref = Math.sign(tx * incoming.x + tz * incoming.z) || Math.sign(poi.orbit.speed || 1);
      for (const s of [pref, -pref]) cands.push({ start: view, center, look, omega: s * w, dolly: 0.05, rise: 0.35 });
    } else {
      const d = look.clone().sub(view);
      const dist = d.length();
      d.setY(0);
      if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
      d.normalize();
      const side = new V3(-d.z, 0, d.x);
      const spd = clamp(dist * 0.007, 1.2, 20);
      const pref = Math.sign(side.dot(incoming)) || 1;
      for (const s of [pref, -pref]) cands.push({ start: view, center: look, look, truck: side.clone().multiplyScalar(s * spd), dolly: 0.06, rise: 0.2 });
    }
    cands.push({ start: view, center: look, look, truck: new V3(), dolly: 0.05, rise: 0 });
    for (const cd of cands) {
      const dd = new DwellDriver({ ...cd, duration: dur });
      if (trajectoryIsSafe(this.ui.collision, (t, o) => dd.positionAt(t, o), dur * 1.2)) return dd;
    }
    return still();
  }

  // ----------------------------------------------------------- update --
  update(dt) {
    if (!this.active) return;
    const app = this.app;
    const target = this.paused ? 0 : 1;
    this.scale += (target - this.scale) * (1 - Math.exp(-dt * 3.2));
    if (Math.abs(this.scale - target) < 0.003) this.scale = target;
    this.c.timeScale = this.scale;
    const sdt = dt * this.scale;
    const st = this.cur;
    if (!st) return;
    st.t += sdt;
    // the camera was taken over by something else (e.g. a landmark click) — end quietly
    if (st.phase !== 'cut' && this.c.driver !== st.flight && this.c.driver !== st.dwell) { this.stop({ handoff: false }); return; }

    // time of day follows the flight; a slow drift keeps the light alive while we linger
    if (st.phase === 'flight' && st.flight && st.plan.mode === 'animate') {
      app.hours = wrap24(st.h0 + st.plan.delta * smootherstep(0.05, 0.95, st.flight.t));
    } else if (st.phase === 'dwell') {
      app.hours = wrap24(app.hours + 0.004 * sdt);
    }

    // lower-third caption
    const cap = $('caption');
    if (!st.captionShown && ((st.phase === 'flight' && st.flight && st.flight.t > 0.66) || st.phase === 'dwell')) {
      st.captionShown = true;
      this._fillCaption(st.poi);
      cap.classList.add('on');
    }
    if (st.phase === 'dwell') {
      st.dwellT += sdt;
      if (st.captionShown && !st.captionHidden && st.dwellT > Math.min(8.5, st.dwellDur * 0.55)) { st.captionHidden = true; cap.classList.remove('on'); }
      this._subtitles(st);
      if (st.dwellT >= st.dwellDur) { this._go(this.index + 1); return; }
    }
    // progress
    const seg = this.segs && this.segs[this.index];
    if (seg) {
      const total = (st.flightDur || 0) + st.dwellDur;
      const done = (st.phase === 'dwell' ? (st.flightDur || 0) + st.dwellT : st.flight ? st.flight.time : 0);
      seg.style.setProperty('--p', clamp(done / Math.max(total, 0.1), 0, 1).toFixed(3));
      const bar = $('tour-progress');
      bar.setAttribute('aria-valuenow', String(Math.round(((this.index + clamp(done / total, 0, 1)) / this.stops.length) * 100)));
    }
  }

  _fillCaption(p) {
    $('cap-district').textContent = p.district || '';
    $('cap-name').textContent = p.name;
    const dl = $('cap-facts');
    dl.innerHTML = '';
    for (const [k, v] of (p.facts || []).slice(0, 3)) {
      const d = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      d.append(dt, dd);
      dl.appendChild(d);
    }
  }

  _subtitles(st) {
    const el = $('subtitle');
    const t = st.dwellT;
    let idx = -1;
    for (let k = 0; k < st.narr.lines.length; k++) { const [a, b] = st.narr.lines[k]; if (t >= a && t < b) { idx = k; break; } }
    if (idx === st.sub) return;
    st.sub = idx;
    el.classList.remove('on');
    if (idx < 0) return;
    const text = st.narr.lines[idx][2];
    clearTimeout(this._subT);
    this._subT = setTimeout(() => {
      if (!this.active || this.cur !== st || st.sub !== idx) return;
      el.textContent = text;
      el.classList.add('on');
    }, el.textContent ? 260 : 0);
  }
}
