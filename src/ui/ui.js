import * as THREE from 'three';
import './ui.css';
import { POIS } from './pois.js';
import { formatClock } from '../core/sun.js';
import { U } from '../core/uniforms.js';
import { loadPrefs, savePrefs, detectGPU } from '../core/settings.js';
import { CollisionModel } from '../core/collision.js';
import { clamp } from '../core/camera-path.js';
import { Intro } from './intro.js';
import { Tour } from './tour.js';
import { Atlas } from './atlas.js';
import { PhotoMode } from './photo.js';
import { TouchUI } from './touch.js';

const $ = (id) => document.getElementById(id);
const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const params = new URLSearchParams(location.search);

/**
 * Heads-up display and experience director: landmarks, lore cards, compass, settings,
 * keyboard / gamepad routing, and the intro, tour, atlas, photo and touch modules.
 */
export class UI {
  constructor(app) {
    this.app = app;
    this.hud = $('hud');
    this.prefs = loadPrefs();
    this.capture = params.has('capture');
    this.timeTarget = null;
    this.activePoi = null;
    this.hintTimer = 9;
    this.peekTimer = 0;
    this.zoneTimer = 0;
    this.zone = { land: 0, urban: 0 };
    this.statsTimer = 0;
    this.flowSpeed = this.prefs.flowSpeed;

    // collision model for free flight and for every planned camera path
    this.collision = new CollisionModel(app.world);
    app.controls.setCollision(this.collision);

    this.intro = new Intro(this);
    this.tour = new Tour(this);
    this.atlas = new Atlas(this);
    this.photo = new PhotoMode(this);
    this.touch = new TouchUI(this);

    this._buildLandmarks();
    this._buildCompass();
    this._bind();
    this._applyPrefs();
    this._syncSettings();
    app.controls.onUserInput = (kind) => this._onUserInput(kind);
    app.controls.onGamepadButton = (i) => this._onGamepad(i);
    if (this.capture) document.body.classList.add('capture');
    else this.intro.prepare();
    // returning viewers who left sound on get it back on their first interaction (browsers need a gesture)
    if (this.prefs.audio && !this.capture) {
      const resume = (e) => {
        window.removeEventListener('pointerdown', resume, true); window.removeEventListener('keydown', resume, true);
        const own = e.target && e.target.closest && e.target.closest('#intro-sound, #opt-audio');   // the sound toggles decide for themselves
        if (!own && !this.app.audio.enabled) this.setAudio(true);
      };
      window.addEventListener('pointerdown', resume, true);
      window.addEventListener('keydown', resume, true);
    }
  }

  // ------------------------------------------------------------- prefs --
  get reducedMotion() {
    const m = this.prefs.motion;
    if (m === 'reduce') return true;
    if (m === 'full') return false;
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  savePrefs() { savePrefs(this.prefs); }

  _applyPrefs() {
    const p = this.prefs, c = this.app.controls;
    c.sensitivity = p.sensitivity;
    c.invertY = p.invertY;
    c.wantLock = p.lock;
    c.reducedMotion = this.reducedMotion;
    document.body.classList.toggle('reduce-motion', p.motion === 'reduce');
    document.body.classList.toggle('full-motion', p.motion === 'full');
    if (this.app.world.clouds && this.app.world.clouds.setVisible) this.app.world.clouds.setVisible(p.clouds);
    this.app.audio.setVolume(p.volume);
    this.app.audio.setMusic(p.music);
    $('stats').hidden = !p.stats || this.capture;
    this.touch.refresh();
  }

  _syncSettings() {
    const p = this.prefs;
    $('opt-quality').value = this.app.presetKey;
    $('opt-motion').value = p.motion;
    $('opt-letterbox').checked = p.letterbox;
    $('opt-subtitles').checked = p.subtitles;
    $('opt-clouds').checked = p.clouds;
    $('opt-fps').checked = p.stats;
    $('opt-sens').value = p.sensitivity; $('opt-sens-o').textContent = `${p.sensitivity.toFixed(2)}×`;
    $('opt-invert').checked = p.invertY;
    $('opt-lock').checked = p.lock;
    $('opt-touch').value = p.touchUI;
    $('opt-audio').checked = this.app.audio.enabled;
    $('opt-volume').value = p.volume; $('opt-volume-o').textContent = `${Math.round(p.volume * 100)}%`;
    $('opt-music').value = p.music; $('opt-music-o').textContent = `${Math.round(p.music * 100)}%`;
    const sp = $('opt-speed');
    sp.value = String(p.flowSpeed);
    if (sp.value !== String(p.flowSpeed)) sp.value = '0.0166';
    const s = this.app.settings;
    const gpu = detectGPU();
    const timing = this.app.perf && this.app.perf.hasGpuTimer ? 'measured GPU time' : 'frame time';
    $('opt-note').textContent = `${s.label}: ${s.shadows ? `${s.shadowSize}px sun shadows` : 'no shadows'}, ${s.reflections ? 'mirror reflections' : 'sky reflections'}, render scale up to ${s.pixelRatio}×. Resolution adapts to hold 60 fps using ${timing}.${gpu.renderer ? ` Detected ${gpu.reason}.` : ''}`;
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
      const k = document.createElement('span'); k.className = 'k'; k.textContent = p.key ?? '·';
      const n = document.createElement('span'); n.textContent = p.name;
      const d = document.createElement('span'); d.className = 'd'; d.textContent = p.district;
      n.appendChild(d);
      b.append(k, n);
      b.addEventListener('click', () => { this.tour.stop(); this.goTo(p); });
      li.appendChild(b);
      list.appendChild(li);
    }
  }

  _buildCompass() {
    const tape = $('compass-tape');
    tape.innerHTML = '';
    this.compassItems = [];
    for (let d = 0; d < 360; d += 15) {
      const t = document.createElement('div');
      t.className = 'tick' + (d % 45 === 0 ? ' major' : '');
      tape.appendChild(t);
      this.compassItems.push({ el: t, deg: d, w: 0 });
      if (d % 45 === 0) {
        const l = document.createElement('div');
        l.className = 'lbl' + (d % 90 === 0 ? ' card' : '');
        l.textContent = CARDINALS[d];
        tape.appendChild(l);
        this.compassItems.push({ el: l, deg: d, w: d % 90 === 0 ? 8 : 14 });
      }
    }
    this.compassPois = [];
    for (const p of POIS) {
      if (['halo', 'highsky', 'massif', 'lagoon', 'approach', 'commons'].includes(p.id)) continue;
      if (!p.target || Math.abs(p.target.y) > 20000) continue;
      const e = document.createElement('div');
      e.className = 'poi';
      const s = document.createElement('span');
      s.textContent = p.name.replace(/^The /, '');
      e.appendChild(s);
      tape.appendChild(e);
      const item = { el: e, poi: p, w: s.textContent.length * 5.4 + 10 };
      this.compassItems.push(item);
      this.compassPois.push(item);
    }
  }

  // ------------------------------------------------------------ binding --
  _bind() {
    const app = this.app;
    $('btn-tour2').addEventListener('click', () => (this.tour.active ? this.tour.stop() : this.tour.start(0)));
    $('btn-atlas').addEventListener('click', () => this.atlas.toggle());
    $('btn-photo').addEventListener('click', () => this.photo.toggle());
    $('lore-close').addEventListener('click', () => { $('lore').hidden = true; this.activePoi = null; this._markActive(); this.sound('tick'); });
    $('lm-toggle').addEventListener('click', () => {
      const l = $('landmarks');
      const narrow = window.innerWidth <= 900;
      if (narrow) l.classList.toggle('open'); else l.classList.toggle('collapsed');
      $('lm-toggle').setAttribute('aria-expanded', String(narrow ? l.classList.contains('open') : !l.classList.contains('collapsed')));
      this.sound('tick');
    });
    const time = $('time');
    time.addEventListener('input', () => { app.hours = parseFloat(time.value); this.timeTarget = null; });
    for (const b of document.querySelectorAll('.presets button')) b.addEventListener('click', () => { this.setTimeSmooth(parseFloat(b.dataset.t)); this.sound('tick'); });
    $('btn-play').addEventListener('click', () => this.togglePlay());
    // [space] orbital view
    if ($('btn-orbit')) $('btn-orbit').addEventListener('click', () => { if (app.space) app.space.toggle(); });
    const toggle = (panel) => {
      const open = $(panel).hidden;
      for (const id of ['settings', 'help']) $(id).hidden = true;
      $(panel).hidden = !open;
      $('btn-settings').setAttribute('aria-expanded', String(!$('settings').hidden));
      $('btn-help').setAttribute('aria-expanded', String(!$('help').hidden));
      document.body.classList.toggle('panel-open', open);
      this.sound(open ? 'open' : 'close');
      if (open) this._syncSettings();
    };
    $('btn-settings').addEventListener('click', () => toggle('settings'));
    $('btn-help').addEventListener('click', () => toggle('help'));

    // settings
    const P = this.prefs;
    const save = () => { this._applyPrefs(); this.savePrefs(); };
    $('opt-quality').addEventListener('change', (e) => {
      app.applyPreset(e.target.value);
      if (app.perf) app.perf.onPresetChanged();
      this._syncSettings();
      this.toast(`Quality: ${app.settings.label}`);
    });
    $('opt-motion').addEventListener('change', (e) => { P.motion = e.target.value; save(); });
    $('opt-letterbox').addEventListener('change', (e) => { P.letterbox = e.target.checked; save(); this._updateBars(); });
    $('opt-subtitles').addEventListener('change', (e) => { P.subtitles = e.target.checked; save(); });
    $('opt-clouds').addEventListener('change', (e) => { P.clouds = e.target.checked; save(); });
    $('opt-fps').addEventListener('change', (e) => { P.stats = e.target.checked; save(); });
    $('opt-sens').addEventListener('input', (e) => { P.sensitivity = parseFloat(e.target.value); $('opt-sens-o').textContent = `${P.sensitivity.toFixed(2)}×`; save(); });
    $('opt-invert').addEventListener('change', (e) => { P.invertY = e.target.checked; save(); });
    $('opt-lock').addEventListener('change', (e) => { P.lock = e.target.checked; save(); if (!P.lock && document.exitPointerLock && document.pointerLockElement) document.exitPointerLock(); });
    $('opt-touch').addEventListener('change', (e) => { P.touchUI = e.target.value; save(); });
    $('opt-audio').addEventListener('change', (e) => this.setAudio(e.target.checked));
    $('opt-volume').addEventListener('input', (e) => { P.volume = parseFloat(e.target.value); $('opt-volume-o').textContent = `${Math.round(P.volume * 100)}%`; save(); });
    $('opt-music').addEventListener('input', (e) => { P.music = parseFloat(e.target.value); $('opt-music-o').textContent = `${Math.round(P.music * 100)}%`; save(); });
    $('opt-speed').addEventListener('change', (e) => { this.flowSpeed = P.flowSpeed = parseFloat(e.target.value); if (app.timeSpeed) app.timeSpeed = this.flowSpeed; save(); });

    // keyboard: capture phase so the UI can own keys (tour transport, atlas) before flight controls see them
    window.addEventListener('keydown', (e) => this._onKey(e), { capture: true });
    window.addEventListener('resize', () => { this._layoutCompass(); this.atlas.resize(); this.photo.layout(); });
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && document.body.classList.contains('cinema')) this._peek(); }, { passive: true });
    this._layoutCompass();
    document.addEventListener('fullscreenchange', () => setTimeout(() => this._layoutCompass(), 50));
    try { document.fonts && document.fonts.ready.then(() => this._layoutCompass()); } catch (e) { /* optional */ }
  }

  _onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['range', 'checkbox'].includes(t.type)))) return;
    if (e.metaKey || e.ctrlKey) return;
    const code = e.code;
    const own = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.repeat && !code.startsWith('Bracket')) {
      if (['Space', 'ArrowLeft', 'ArrowRight', 'KeyM', 'KeyK', 'KeyT', 'KeyH', 'Enter'].includes(code) && (this.tour.active || this.atlas.open || this.photo.active || this.intro.active)) own();
      return;
    }
    // intro title card
    if (this.intro.active) {
      if (code === 'Enter') { own(); this.intro.finish(false); return; }
      if (code === 'KeyT') { own(); this.intro.finish(true); return; }
      if (code === 'Escape') { own(); this.intro.skipOrExplore(); return; }
      return;   // movement keys fall through: controls hand over and the intro closes
    }
    // atlas is modal
    if (this.atlas.open) {
      if (code === 'Escape' || code === 'KeyM') { own(); this.atlas.close(); return; }
      if (t && t.closest && t.closest('#atlas') && (code === 'Enter' || code === 'Space' || code === 'Tab')) return;
      if (code !== 'Tab') own();
      return;
    }
    if (this.photo.active) {
      if (code === 'KeyK' || code === 'Escape') { own(); this.photo.exit(); return; }
      if (code === 'KeyH') { own(); this.photo.togglePanel(); return; }
      if (code === 'Enter') { own(); this.photo.capture(); return; }
      return;   // flight keys pass through for framing
    }
    if (this.tour.active) {
      if (code === 'Space') { own(); this.tour.togglePause(); return; }
      if (code === 'ArrowRight') { own(); this.tour.next(); return; }
      if (code === 'ArrowLeft') { own(); this.tour.prev(); return; }
      if (code === 'Escape') { own(); this.tour.stop(); return; }
    }
    if (t && t.type === 'range' && code.startsWith('Arrow')) return;
    // [space] orbital view: its own keys while it is up; O toggles it from anywhere
    if (this.app.space && this.app.space.handleKey(e)) return;
    if (code === 'KeyO' && this.app.space) { own(); this.tour.stop(); this.app.space.toggle(); return; }
    if (this.app.space && this.app.space.active) return;
    const poi = POIS.find((p) => p.key === e.key);
    if (poi && !e.altKey) { this.tour.stop(); this.goTo(poi); return; }
    switch (code) {
      case 'KeyT': this.tour.active ? this.tour.stop() : this.tour.start(0); break;
      case 'KeyM': this.atlas.toggle(); break;
      case 'KeyK': this.photo.toggle(); break;
      case 'KeyH': document.body.classList.toggle('hide-ui'); break;
      case 'KeyP': this.togglePlay(); break;
      case 'BracketLeft': this.setTimeSmooth((this.app.hours - 0.5 + 24) % 24, 0.6); break;
      case 'BracketRight': this.setTimeSmooth((this.app.hours + 0.5) % 24, 0.6); break;
      case 'KeyF': this._fullscreen(); break;
      case 'Backquote': this.prefs.stats = !this.prefs.stats; this._applyPrefs(); this.savePrefs(); $('opt-fps').checked = this.prefs.stats; break;
      case 'Escape':
        if ($('settings').hidden && $('help').hidden && document.body.classList.contains('hide-ui')) document.body.classList.remove('hide-ui');
        $('settings').hidden = true; $('help').hidden = true;
        $('btn-settings').setAttribute('aria-expanded', 'false'); $('btn-help').setAttribute('aria-expanded', 'false');
        document.body.classList.remove('panel-open');
        break;
      case 'Slash': if (e.shiftKey) $('help').hidden = !$('help').hidden; break;
      default: break;
    }
  }

  _onGamepad(i) {
    if (this.intro.active) { if (i === 0) this.intro.finish(false); else if (i === 9) this.intro.finish(true); return; }
    if (this.atlas.open) { if (i === 1 || i === 3) this.atlas.close(); return; }
    if (this.photo.active) { if (i === 2 || i === 0) this.photo.capture(); else if (i === 1) this.photo.exit(); return; }
    if (this.tour.active) {
      if (i === 0 || i === 15) this.tour.next(); else if (i === 14) this.tour.prev(); else if (i === 1) this.tour.stop(); else if (i === 9) this.tour.togglePause();
      return;
    }
    if (i === 3) this.atlas.toggle();
    else if (i === 2) this.photo.toggle();
    else if (i === 9) this.tour.start(0);
    else if (i === 8) document.body.classList.toggle('hide-ui');
    else if (i === 14) this.setTimeSmooth((this.app.hours - 0.5 + 24) % 24, 0.6);
    else if (i === 15) this.setTimeSmooth((this.app.hours + 0.5) % 24, 0.6);
  }

  _fullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else { const p = document.documentElement.requestFullscreen?.(); if (p && p.catch) p.catch(() => {}); }
    } catch (e) { /* optional */ }
  }

  _onUserInput(kind) {
    if (this.intro.active && kind === 'move') this.intro.finish(false);
    if (this.tour.active && kind === 'move') this.tour.stop({ handoff: false });
    if (kind === 'look' && document.body.classList.contains('cinema')) this._peek();
    this.hintTimer = Math.min(this.hintTimer, 2);
  }

  _peek() {
    this.peekTimer = 2.8;
    document.body.classList.add('peek');
  }

  // -------------------------------------------------------------- shell --
  showHUD() {
    if (!this.hud.hidden) return;
    this.hud.hidden = false;
    this.hintTimer = 9;
    $('hint').classList.remove('gone');
    this._layoutCompass();
  }

  setAudio(on) {
    this.prefs.audio = on;
    this.savePrefs();
    this.app.audio.setEnabled(on);
    $('opt-audio').checked = on;
    const b = $('intro-sound');
    if (b) { b.setAttribute('aria-pressed', String(on)); b.querySelector('.snd-label').textContent = on ? 'Sound on' : 'Sound off'; }
  }

  sound(kind) { try { this.app.audio.ui(kind); } catch (e) { /* audio optional */ } }

  _updateBars() {
    const want = this.prefs.letterbox && (this.tour.active || this.intro.active) && !this.photo.active;
    document.body.classList.toggle('bars', want);
  }

  toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('on'), ms);
  }

  /** Fade the screen to black (true) or back (false); resolves when the transition ends. */
  fade(on, ms = 700) {
    const f = $('fade');
    f.style.transitionDuration = `${ms}ms`;
    f.classList.toggle('on', on);
    return new Promise((r) => setTimeout(r, ms + 30));
  }

  // ------------------------------------------------------------- actions --
  togglePlay() {
    const app = this.app;
    if (app.space && app.space.active) { app.space.hud.togglePause(); return; } // [space] pause the time warp
    app.timeSpeed = app.timeSpeed ? 0 : this.flowSpeed;
    this.timeTarget = null;
    this._syncPlay();
    this.sound('tick');
  }

  _syncPlay() {
    const on = !!this.app.timeSpeed;
    $('play-glyph').setAttribute('d', on ? 'M4 3h3v10H4zM9 3h3v10H9z' : 'M4 2.5v11l9-5.5z');
    $('btn-play').setAttribute('aria-label', on ? 'Pause time' : 'Let time flow');
  }

  setTimeSmooth(h, duration = 2.5) {
    const from = this.app.hours;
    let d = h - from;
    if (d > 12) d -= 24; if (d < -12) d += 24;
    this.timeTarget = { from, delta: d, t: 0, dur: this.reducedMotion ? 0.01 : duration };
  }

  /** Fly to a landmark in free exploration (collision-safe spline, gentle arrival). */
  goTo(p, { duration } = {}) {
    const c = this.app.controls;
    this.activePoi = p;
    this._markActive();
    this.showLore(p);
    if (p.time != null) this.setTimeSmooth(p.time, 3.5);
    this.sound('fly');
    if (this.reducedMotion) { this._cutTo(p.view, p.target); return; }
    const dist = c.camera.position.distanceTo(p.view);
    if (dist > 60000) { this._cutTo(p.view, p.target); return; }
    c.flyTo(p.view, p.target, { duration, interruptible: true });
  }

  /** Fly to look at a world point from a sensible vantage (atlas clicks). */
  flyToPoint(x, z) {
    const c = this.app.controls;
    const cam = c.camera.position;
    const g = this.collision.planFloor(x, z);
    const target = new THREE.Vector3(x, g + 20, z);
    const dir = new THREE.Vector3(x - cam.x, 0, z - cam.z);
    if (dir.lengthSq() < 1) dir.set(0, 0, -1);
    dir.normalize();
    const back = 520;
    const vp = new THREE.Vector3(x - dir.x * back, 0, z - dir.z * back);
    vp.y = Math.max(this.collision.planFloor(vp.x, vp.z), g) + 190;
    this.tour.stop();
    this.sound('fly');
    if (this.reducedMotion) { this._cutTo(vp, target); return; }
    c.flyTo(vp, target, { interruptible: true });
  }

  async _cutTo(pos, look) {
    await this.fade(true, 450);
    this.app.controls.setPose(pos, 0, 0);
    this.app.controls.lookAt(look);
    await this.fade(false, 450);
  }

  showLore(p) {
    $('lore-district').textContent = p.district;
    $('lore-name').textContent = p.name;
    $('lore-text').textContent = p.lore;
    const facts = $('lore-facts');
    facts.innerHTML = '';
    for (const [k, v] of p.facts || []) {
      const d = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      d.append(dt, dd);
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
    for (const b of document.querySelectorAll('#lm-list button')) b.setAttribute('aria-current', String(!!(this.activePoi && b.dataset.id === this.activePoi.id)));
  }

  // -------------------------------------------------------------- update --
  _layoutCompass() {
    const el = $('compass');
    this.compassW = el ? el.clientWidth : 400;
    // cache label half-widths (reading layout every frame would force reflows)
    if (this.compassItems) for (const it of this.compassItems) it.hw = it.el.classList.contains('tick') ? 0 : (it.el.offsetWidth || it.w) / 2;
    if (this.compassPois) for (const p of this.compassPois) { const s = p.el.firstChild; if (s && s.offsetWidth) p.w = s.offsetWidth + 10; }
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
    this.intro.update(dt);
    this.tour.update(dt);
    this.photo.update(dt);
    this.atlas.update(dt);

    if (this.peekTimer > 0) { this.peekTimer -= dt; if (this.peekTimer <= 0) document.body.classList.remove('peek'); }
    this._updateStats(dt);
    this._updateAudio(dt);
    if (this.hud.hidden) return;

    const timeEl = $('time');
    if (document.activeElement !== timeEl) timeEl.value = app.hours.toFixed(2);
    $('ro-time').textContent = formatClock(app.hours);
    const cam = app.camera.position;
    const alt = cam.y;
    $('ro-alt').textContent = alt < 10000 ? `${Math.round(alt).toLocaleString('en-US')} m` : `${(alt / 1000).toFixed(1)} km`;
    const dr = app.controls.driver;
    const v = dr && dr.vel ? dr.vel.length() : app.controls.velocity.length();
    $('ro-speed').textContent = v < 1000 ? `${Math.round(v).toLocaleString('en-US')} m/s` : `${(v / 1000).toFixed(1)} km/s`;
    this._updateCompass(cam);
    // live monument caption
    if (this.activePoi && this.activePoi.live === 'chorus' && app.world.chorus) {
      const c = app.world.chorus;
      $('lore-live').textContent = c.morphing ? `Re-forming: ${c.current.name} → ${c.next.name}` : `Now showing: ${c.caption}`;
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) $('hint').classList.add('gone');
    }
  }

  _updateCompass(cam) {
    if (!this.compassW) this._layoutCompass();
    if (!this.compassW) return;
    const heading = this.app.controls.heading;
    const pxPerDeg = this.compassW / 110;
    const cx = this.compassW / 2;
    for (const it of this.compassItems) {
      let deg = it.deg;
      if (it.poi) {
        const d = it.poi.target;
        deg = (Math.atan2(d.x - cam.x, -(d.z - cam.z)) * 180) / Math.PI;
      }
      const rel = ((deg - heading + 540) % 360) - 180;
      it.rel = rel;
      it.x = cx + rel * pxPerDeg;
      const vis = Math.abs(rel) < 58;
      if (vis !== it.vis) { it.el.style.visibility = vis ? 'visible' : 'hidden'; it.vis = vis; }
      if (vis) {
        const half = it.hw ?? 0;
        it.el.style.transform = `translate3d(${(it.x - half).toFixed(1)}px,0,0)`;
      }
    }
    // landmark labels: nearest to the centre first, hide any that would overlap
    const placed = [];
    const sorted = this.compassPois.filter((p) => p.vis).sort((a, b) => Math.abs(a.rel) - Math.abs(b.rel));
    for (const p of sorted) {
      const w = p.w;
      const x0 = p.x - w / 2, x1 = p.x + w / 2;
      const clash = placed.some(([a, b]) => x1 > a - 6 && x0 < b + 6);
      p.el.classList.toggle('nolabel', clash);
      p.el.classList.toggle('active', !!(this.activePoi && this.activePoi.id === p.poi.id));
      if (!clash) placed.push([x0, x1]);
    }
  }

  _updateStats(dt) {
    if (!this.prefs.stats || this.capture) return;
    this.statsTimer -= dt;
    if (this.statsTimer > 0) return;
    this.statsTimer = 0.25;
    const perf = this.app.perf;
    if (!perf) return;
    const s = perf.stats;
    const gpu = s.gpu != null ? `${s.gpu.toFixed(1)} ms` : (perf.hasGpuTimer ? '…' : 'n/a');
    const warn = s.fps && s.fps < 50 ? ' class="warn"' : '';
    $('stats').innerHTML =
      `<b>FPS</b>  <span${warn}>${s.fps ? s.fps.toFixed(0) : '–'}</span>   <b>CPU</b> ${s.cpu ? s.cpu.toFixed(1) : '–'} ms\n` +
      `<b>GPU</b>  ${gpu}\n` +
      `<b>RES</b>  ${s.w}×${s.h}  (${Math.round((s.scale || 1) * 100)}%)\n` +
      `<b>DRAW</b> ${s.calls}  <b>TRI</b> ${(s.tris / 1e6).toFixed(2)} M\n` +
      `<b>SET</b>  ${this.app.settings.label}`;
  }

  _updateAudio(dt) {
    const app = this.app;
    if (!app.audio.enabled) return;
    const cam = app.camera.position;
    this.zoneTimer -= dt;
    if (this.zoneTimer <= 0) {
      this.zoneTimer = 0.25;
      const agl = Math.max(cam.y - Math.max(app.world.groundHeight(cam.x, cam.z), 0), 0);
      const r = clamp(80 + agl * 0.6, 80, 900);
      let land = 0;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        if (app.world.groundHeight(cam.x + Math.cos(a) * r, cam.z + Math.sin(a) * r) > 1.0) land++;
      }
      if (app.world.groundHeight(cam.x, cam.z) > 1.0) land += 4;
      this.zone.land = land / 16;
      this.zone.urban = this._urbanNear(cam.x, cam.z);
      this.zone.agl = agl;
    }
    const dr = app.controls.driver;
    const v = dr && dr.vel ? dr.vel.length() : app.controls.velocity.length();
    app.audio.update(dt, { altitude: this.zone.agl ?? cam.y, height: cam.y, speed: v, night: U.uNight.value, hours: app.hours, land: this.zone.land, urban: this.zone.urban });
  }

  _urbanNear(x, z) {
    const info = this.app.world.info;
    if (!info || !info.urban) return 0;
    const N = info.N, half = 7200;
    let acc = 0, n = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx * 450, pz = z + dz * 450;
      const i = Math.floor(((px + half) / (2 * half)) * N), j = Math.floor(((pz + half) / (2 * half)) * N);
      if (i < 0 || j < 0 || i >= N || j >= N) { n++; continue; }
      acc += info.urban[j * N + i]; n++;
    }
    return n ? acc / n : 0;
  }
}
