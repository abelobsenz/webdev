import { POIS, TOUR } from './pois.js';
import { formatClock } from '../core/sun.js';
import { U } from '../core/uniforms.js';

const $ = (id) => document.getElementById(id);
const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

/** Heads-up display, landmarks, lore cards, guided tour and settings. */
export class UI {
  constructor(app) {
    this.app = app;
    this.hud = $('hud');
    this.touring = false;
    this.tourIndex = -1;
    this.tourTimer = 0;
    this.timeTarget = null;
    this.fpsAcc = 0; this.fpsFrames = 0;
    this.activePoi = null;
    this.hintTimer = 9;
    this._buildLandmarks();
    this._buildCompass();
    this._bind();
    this._syncSettings();
    $('intro').hidden = false;
    this.app.controls.onUserInput = () => this._onUserInput();
  }

  // ------------------------------------------------------------ building --
  _buildLandmarks() {
    const list = $('lm-list');
    list.innerHTML = '';
    for (const p of POIS) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = p.id;
      b.innerHTML = `<span class="k">${p.key ?? '·'}</span><span>${p.name}<span class="d">${p.district}</span></span>`;
      b.addEventListener('click', () => { this.stopTour(); this.goTo(p); });
      li.appendChild(b);
      list.appendChild(li);
    }
  }

  _buildCompass() {
    const tape = $('compass-tape');
    this.compassItems = [];
    for (let d = 0; d < 360; d += 15) {
      const t = document.createElement('div');
      t.className = 'tick' + (d % 45 === 0 ? ' major' : '');
      tape.appendChild(t);
      this.compassItems.push({ el: t, deg: d });
      if (d % 45 === 0) {
        const l = document.createElement('div');
        l.className = 'lbl' + (d % 90 === 0 ? ' card' : '');
        l.textContent = CARDINALS[d];
        tape.appendChild(l);
        this.compassItems.push({ el: l, deg: d });
      }
    }
    for (const p of POIS) {
      if (['halo', 'highsky', 'massif', 'lagoon', 'approach', 'commons'].includes(p.id)) continue;
      const e = document.createElement('div');
      e.className = 'poi';
      e.textContent = p.name.replace(/^The /, '');
      tape.appendChild(e);
      this.compassItems.push({ el: e, poi: p });
    }
  }

  _bind() {
    const app = this.app;
    $('btn-tour').addEventListener('click', () => this._enter(true));
    $('btn-explore').addEventListener('click', () => this._enter(false));
    $('btn-tour2').addEventListener('click', () => (this.touring ? this.stopTour() : this.startTour()));
    $('tour-exit').addEventListener('click', () => this.stopTour());
    $('tour-next').addEventListener('click', () => this.nextTourStop());
    $('lore-close').addEventListener('click', () => { $('lore').hidden = true; this.activePoi = null; this._markActive(); });
    $('lm-toggle').addEventListener('click', () => {
      const l = $('landmarks');
      const narrow = window.innerWidth <= 900;
      if (narrow) l.classList.toggle('open'); else l.classList.toggle('collapsed');
      $('lm-toggle').setAttribute('aria-expanded', String(narrow ? l.classList.contains('open') : !l.classList.contains('collapsed')));
    });
    const time = $('time');
    time.addEventListener('input', () => { app.hours = parseFloat(time.value); this.timeTarget = null; });
    for (const b of document.querySelectorAll('.presets button')) b.addEventListener('click', () => this.setTimeSmooth(parseFloat(b.dataset.t)));
    $('btn-play').addEventListener('click', () => this.togglePlay());
    // [space] orbital view
    if ($('btn-orbit')) $('btn-orbit').addEventListener('click', () => { if (app.space) app.space.toggle(); });
    const toggle = (btn, panel) => {
      const open = $(panel).hidden;
      for (const id of ['settings', 'help']) $(id).hidden = true;
      $(panel).hidden = !open;
      $('btn-settings').setAttribute('aria-expanded', String(!$('settings').hidden));
      $('btn-help').setAttribute('aria-expanded', String(!$('help').hidden));
    };
    $('btn-settings').addEventListener('click', () => toggle('btn-settings', 'settings'));
    $('btn-help').addEventListener('click', () => toggle('btn-help', 'help'));
    $('opt-quality').addEventListener('change', (e) => { app.applyPreset(e.target.value); this._syncSettings(); });
    $('opt-speed').addEventListener('change', (e) => { this.flowSpeed = parseFloat(e.target.value); if (app.timeSpeed) app.timeSpeed = this.flowSpeed; });
    $('opt-clouds').addEventListener('change', (e) => app.world.clouds.setVisible(e.target.checked));
    $('opt-audio').addEventListener('change', (e) => app.audio.setEnabled(e.target.checked));
    $('opt-fps').addEventListener('change', (e) => { $('ro-fps-wrap').hidden = !e.target.checked; });
    $('opt-lock').addEventListener('change', (e) => { app.controls.wantLock = e.target.checked; if (!e.target.checked && document.exitPointerLock) document.exitPointerLock(); });
    this.flowSpeed = parseFloat($('opt-speed').value);

    window.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && e.target.type !== 'range') return;
      if (!$('intro').hidden) { if (e.code === 'Enter') this._enter(false); return; }
      if (app.space && app.space.handleKey(e)) return; // [space] orbital view keys
      const k = e.key;
      const poi = POIS.find((p) => p.key === k);
      if (poi && !e.metaKey && !e.ctrlKey) { this.stopTour(); this.goTo(poi); return; }
      switch (e.code) {
        case 'KeyT': this.touring ? this.stopTour() : this.startTour(); break;
        case 'KeyO': if (app.space) app.space.toggle(); break; // [space]
        case 'KeyH': document.body.classList.toggle('hide-ui'); break;
        case 'KeyP': this.togglePlay(); break;
        case 'BracketLeft': this.setTimeSmooth((app.hours - 0.5 + 24) % 24, 0.6); break;
        case 'BracketRight': this.setTimeSmooth((app.hours + 0.5) % 24, 0.6); break;
        case 'KeyF': this._fullscreen(); break;
        case 'Escape':
          if (this.touring) this.stopTour();
          $('settings').hidden = true; $('help').hidden = true;
          break;
        case 'Slash': if (e.shiftKey) $('help').hidden = !$('help').hidden; break;
        default: break;
      }
    });
    window.addEventListener('resize', () => this._layoutCompass());
    this._layoutCompass();
  }

  _syncSettings() {
    $('opt-quality').value = this.app.presetKey;
    const s = this.app.settings;
    $('opt-note').textContent = `${s.label}: ${s.shadows ? `${s.shadowSize}px sun shadows` : 'no shadows'}, ${s.reflections ? 'mirror reflections' : 'sky reflections'}, render scale up to ${s.pixelRatio}×. Resolution adapts automatically to hold 60 fps.`;
  }

  _fullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else { const p = document.documentElement.requestFullscreen?.(); if (p && p.catch) p.catch(() => {}); }
    } catch (e) { /* optional */ }
  }

  _enter(tour) {
    $('intro').hidden = true;
    this.hud.hidden = false;
    this._layoutCompass();
    const audioOn = $('opt-audio-intro').checked;
    $('opt-audio').checked = audioOn;
    this.app.audio.setEnabled(audioOn);
    if (tour) this.startTour(); else this.showLore(POIS[0]);
  }

  _onUserInput() {
    if (this.touring) this.stopTour();
    this.hintTimer = Math.min(this.hintTimer, 2);
  }

  // ------------------------------------------------------------- actions --
  togglePlay() {
    const app = this.app;
    if (app.space && app.space.active) { app.space.hud.togglePause(); return; } // [space] pause the time warp
    app.timeSpeed = app.timeSpeed ? 0 : this.flowSpeed;
    this.timeTarget = null;
    $('play-glyph').setAttribute('d', app.timeSpeed ? 'M4 3h3v10H4zM9 3h3v10H9z' : 'M4 2.5v11l9-5.5z');
    $('btn-play').setAttribute('aria-label', app.timeSpeed ? 'Pause time' : 'Let time flow');
  }

  setTimeSmooth(h, duration = 2.5) {
    const from = this.app.hours;
    let d = h - from;
    if (d > 12) d -= 24; if (d < -12) d += 24;
    this.timeTarget = { from, delta: d, t: 0, dur: duration };
  }

  goTo(p, { duration } = {}) {
    const c = this.app.controls;
    this.activePoi = p;
    this._markActive();
    c.flyTo(p.view, p.target, {
      duration,
      interruptible: true,
      onDone: () => {
        if (this.touring && p.orbit) {
          const o = p.orbit;
          const ang = Math.atan2(c.camera.position.z - o.center.z, c.camera.position.x - o.center.x);
          c.startOrbit(o.center, Math.hypot(c.camera.position.x - o.center.x, c.camera.position.z - o.center.z), c.camera.position.y - o.center.y, ang, o.speed, 0);
        }
      },
    });
    if (p.time != null) this.setTimeSmooth(p.time, 3.5);
    this.showLore(p);
  }

  showLore(p) {
    $('lore-district').textContent = p.district;
    $('lore-name').textContent = p.name;
    $('lore-text').textContent = p.lore;
    const facts = $('lore-facts');
    facts.innerHTML = '';
    for (const [k, v] of p.facts || []) {
      const d = document.createElement('div');
      d.innerHTML = `<dt></dt><dd></dd>`;
      d.firstChild.textContent = k; d.lastChild.textContent = v;
      facts.appendChild(d);
    }
    $('lore-live').hidden = p.live !== 'chorus';
    const lore = $('lore');
    lore.hidden = false;
    lore.style.animation = 'none'; void lore.offsetWidth; lore.style.animation = '';
    this.activePoi = p;
    this._markActive();
  }

  _markActive() {
    for (const b of document.querySelectorAll('#lm-list button')) b.setAttribute('aria-current', String(this.activePoi && b.dataset.id === this.activePoi.id));
  }

  startTour() {
    this.touring = true;
    this.tourIndex = -1;
    $('tourbar').hidden = false;
    $('btn-tour2').classList.add('active');
    this.nextTourStop();
  }

  stopTour() {
    if (!this.touring) return;
    this.touring = false;
    $('tourbar').hidden = true;
    $('btn-tour2').classList.remove('active');
    this.app.controls.orbit = null;
  }

  nextTourStop() {
    this.tourIndex = (this.tourIndex + 1) % TOUR.length;
    const p = POIS.find((q) => q.id === TOUR[this.tourIndex]);
    $('tour-step').textContent = `Tour · ${this.tourIndex + 1} / ${TOUR.length}`;
    this.tourTimer = 0;
    this.goTo(p);
    // dwell = flight time + time to read the card
    this.tourDwell = (this.app.controls.flight ? this.app.controls.flight.dur : 3) + 13;
  }

  // -------------------------------------------------------------- update --
  _layoutCompass() {
    const el = $('compass');
    this.compassW = el ? el.clientWidth : 400;
  }

  update(dt) {
    const app = this.app;
    if (app.space && app.space.active && app.space.mode !== 'ascend') { app.space.updateHud(dt); return; } // [space]
    // animated time changes
    if (this.timeTarget) {
      const tt = this.timeTarget;
      tt.t += dt / tt.dur;
      const e = tt.t >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * tt.t);
      app.hours = (tt.from + tt.delta * e + 24) % 24;
      if (tt.t >= 1) this.timeTarget = null;
    }
    if (this.touring) {
      this.tourTimer += dt;
      if (this.tourTimer > this.tourDwell) this.nextTourStop();
    }
    if (this.hud.hidden) return;
    const timeEl = $('time');
    if (document.activeElement !== timeEl) timeEl.value = app.hours.toFixed(2);
    $('ro-time').textContent = formatClock(app.hours);
    const cam = app.camera.position;
    const alt = cam.y;
    $('ro-alt').textContent = alt < 10000 ? `${Math.round(alt).toLocaleString('en-US')} m` : `${(alt / 1000).toFixed(1)} km`;
    const v = app.controls.flight ? 0 : app.controls.velocity.length();
    $('ro-speed').textContent = `${Math.round(v).toLocaleString('en-US')} m/s`;
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc > 0.5) { $('ro-fps').textContent = String(Math.round(this.fpsFrames / this.fpsAcc)); this.fpsAcc = 0; this.fpsFrames = 0; }
    // compass tape
    const heading = app.controls.heading;
    if (!this.compassW) this._layoutCompass();
    const pxPerDeg = this.compassW / 110;
    const cx = this.compassW / 2;
    for (const it of this.compassItems) {
      let deg = it.deg;
      if (it.poi) {
        const d = it.poi.target;
        deg = (Math.atan2(d.x - cam.x, -(d.z - cam.z)) * 180) / Math.PI;
      }
      let rel = ((deg - heading + 540) % 360) - 180;
      const x = cx + rel * pxPerDeg;
      it.el.style.transform = `translateX(${x.toFixed(1)}px)${it.el.classList.contains('tick') ? '' : ' translateX(-50%)'}`;
      it.el.style.visibility = Math.abs(rel) < 58 ? 'visible' : 'hidden';
    }
    // live monument caption
    if (this.activePoi && this.activePoi.live === 'chorus' && app.world.chorus) {
      const c = app.world.chorus;
      $('lore-live').textContent = c.morphing ? `Re-forming: ${c.current.name} → ${c.next.name}` : `Now showing: ${c.caption}`;
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) $('hint').classList.add('gone');
    }
    app.audio.update(dt, { altitude: alt, night: U.uNight.value });
  }
}
