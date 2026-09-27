import * as THREE from 'three';
import { TARGET_INFO, TARGET_ORDER } from './targets.js';
import { R_EARTH } from './sim.js';

const $ = (id) => document.getElementById(id);
const WARPS = [0, 1, 60, 3600, 86400];
const WARP_LABEL = { 0: 'Pause', 1: '1×', 60: '60×', 3600: '3,600×', 86400: '86,400×' };
const _v = new THREE.Vector3();

function fmtKm(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  if (km < 1e6) return `${Math.round(km).toLocaleString('en-US')} km`;
  if (km < 1e9) return `${(km / 1e6).toFixed(km < 1e7 ? 2 : 1)} M km`;
  return `${(km / 1.496e8).toFixed(2)} AU`;
}

/** Space-mode interface: target list, time warp, readouts, on-screen labels. */
export class SpaceHud {
  constructor(space) {
    this.space = space;
    this.selected = null;
    this.visible = false;
    this.labels = [];
    this.userTimer = 0;
    this._built = false;
  }

  _build() {
    if (this._built) return;
    const hud = $('hud');
    if (!hud) return;
    this._built = true;
    // target list (mirrors the landmarks panel)
    const panel = document.createElement('aside');
    panel.className = 'landmarks space-only';
    panel.id = 'space-panel';
    panel.innerHTML = '<p class="panel-toggle space-title">Orbital view</p><ol id="space-list"></ol>';
    hud.appendChild(panel);
    const list = panel.querySelector('ol');
    for (const name of TARGET_ORDER) {
      const t = TARGET_INFO[name];
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = name;
      b.innerHTML = `<span class="k">${t.key}</span><span>${t.name}<span class="d">${t.district}</span></span>`;
      b.addEventListener('click', () => this.space.focus(name));
      li.appendChild(b);
      list.appendChild(li);
    }
    // time warp control in the time bar
    const bar = document.querySelector('.timebar');
    const warp = document.createElement('div');
    warp.className = 'space-warp space-only';
    warp.id = 'space-warp';
    warp.setAttribute('role', 'group');
    warp.setAttribute('aria-label', 'Time warp');
    warp.innerHTML = '<span class="space-warp-label">Time warp</span>' + WARPS.map((w) => `<button type="button" data-w="${w}">${WARP_LABEL[w]}</button>`).join('');
    for (const b of warp.querySelectorAll('button')) b.addEventListener('click', () => this.space.setWarp(parseFloat(b.dataset.w)));
    if (bar) bar.insertBefore(warp, bar.querySelector('.actions'));
    // labels
    const lab = document.createElement('div');
    lab.id = 'space-labels';
    lab.className = 'space-only';
    hud.insertBefore(lab, hud.firstChild);
    this.labelRoot = lab;
    const mk = (name, text, cls = '') => {
      const e = document.createElement('button');
      e.type = 'button';
      e.className = `space-label ${cls}`;
      e.innerHTML = `<i></i><span>${text}</span>`;
      e.addEventListener('click', () => { if (TARGET_INFO[name]) this.space.focus(name); });
      lab.appendChild(e);
      return e;
    };
    for (const name of TARGET_ORDER) this.labels.push({ name, el: mk(name, TARGET_INFO[name].name), x: -1e4, y: -1e4, on: false });
    this.extra = [];
    this.syncWarp();
  }

  show(on) {
    this._build();
    this.visible = on;
    document.body.classList.toggle('space-mode', on);
    const btn = $('btn-orbit');
    if (btn) { btn.textContent = on ? 'Return to Meridian' : 'Orbit'; btn.classList.toggle('active', on); btn.title = on ? 'Return to the city (O)' : 'Ride the elevator to orbit (O)'; }
    const labels = document.querySelectorAll('.readouts dt');
    if (labels.length >= 3) {
      if (on) {
        this._saved = [...labels].map((l) => l.textContent);
        labels[0].textContent = 'Meridian'; labels[1].textContent = 'Altitude'; labels[2].textContent = 'Target';
      } else if (this._saved) {
        [...labels].forEach((l, i) => { if (this._saved[i] !== undefined) l.textContent = this._saved[i]; });
      }
    }
    if (!on) {
      const lore = $('lore');
      if (lore && this.selected) lore.hidden = true;
      this.selected = null;
      const live = $('lore-live'); if (live) live.hidden = true;
    }
  }

  select(name, showCard = true) {
    this._build();
    this.selected = name;
    for (const b of document.querySelectorAll('#space-list button')) b.setAttribute('aria-current', String(b.dataset.id === name));
    if (!name) return;
    const t = TARGET_INFO[name];
    const ui = this.space.app.ui;
    if (showCard && ui && t) {
      ui.showLore({ id: `space-${name}`, district: t.district, name: t.name, lore: t.lore, facts: t.facts });
      const live = $('lore-live'); if (live) live.hidden = false;
      for (const b of document.querySelectorAll('#lm-list button')) b.setAttribute('aria-current', 'false');
    }
  }

  onUser() { this.userTimer = 0; }

  syncWarp() {
    const s = this.space.sim;
    const w = s.paused ? 0 : s.warp;
    for (const b of document.querySelectorAll('#space-warp button')) b.classList.toggle('active', parseFloat(b.dataset.w) === w);
    const glyph = $('play-glyph');
    if (glyph && this.visible) glyph.setAttribute('d', s.paused ? 'M4 2.5v11l9-5.5z' : 'M4 3h3v10H4zM9 3h3v10H9z');
  }

  stepWarp(d) {
    const s = this.space.sim;
    const cur = s.paused ? 0 : s.warp;
    let i = WARPS.indexOf(cur); if (i < 0) i = 2;
    i = THREE.MathUtils.clamp(i + d, 0, WARPS.length - 1);
    this.space.setWarp(WARPS[i]);
  }

  togglePause() {
    const s = this.space.sim;
    if (s.paused) this.space.setWarp(s.warp || 60); else this.space.setWarp(0);
  }

  pickLabel(x, y) {
    let best = null, bd = 22;
    for (const l of this.labels) {
      if (!l.on) continue;
      const d = Math.hypot(l.x - x, l.y - y);
      if (d < bd) { bd = d; best = l.name; }
    }
    return best;
  }

  update(dt) {
    if (!this.visible || !this._built) return;
    const sp = this.space;
    const cam = sp.camera;
    const sim = sp.sim;
    const W = window.innerWidth, H = window.innerHeight;
    // readouts
    const h = sim.hours;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    $('ro-time').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    $('ro-alt').textContent = fmtKm(Math.max(cam.position.length() - R_EARTH, 0));
    const tgt = sp.rig.target;
    const dist = tgt ? cam.position.distanceTo(tgt.position(_v)) : 0;
    $('ro-speed').textContent = tgt ? fmtKm(dist) : '—';
    const live = $('lore-live');
    if (live && !live.hidden && this.selected && tgt) {
      const w = sim.paused ? 'paused' : `${WARP_LABEL[sim.warp] || sim.warp + '×'}`;
      const day = Math.floor(sim.t / 86400);
      live.textContent = `${TARGET_INFO[this.selected].name} · ${fmtKm(dist)} away · time ${w}${day > 0 ? ` · day ${day + 1}` : ''}`;
    }
    // labels
    const camPos = cam.position;
    const fovR = THREE.MathUtils.degToRad(cam.fov);
    for (const l of this.labels) {
      const t = sp.targets[l.name];
      const p = t.position(_v.set(0, 0, 0));
      const d = p.distanceTo(camPos);
      const size = t.labelRadius ?? (t.minDist * 0.5);
      let op = 1;
      // too large on screen (you are looking at it) or too small to matter
      const ang = size / Math.max(d, 1e-3);
      op *= 1 - smoothstep(0.12, 0.3, ang / fovR);
      if (t.labelMaxDist) op *= 1 - smoothstep(t.labelMaxDist * 0.6, t.labelMaxDist, d);
      if (sp.rig.target === t && !sp.rig.flight) op *= 0.0;
      // behind the Earth?
      if (l.name !== 'earth') {
        const dir = p.clone().sub(camPos).normalize();
        const b = camPos.dot(dir), c = camPos.lengthSq() - R_EARTH * R_EARTH;
        const disc = b * b - c;
        if (disc > 0) { const tt = -b - Math.sqrt(disc); if (tt > 0 && tt < d) op = 0; }
      }
      const s = p.clone().project(cam);
      if (s.z > 1 || s.z < -1 || Math.abs(s.x) > 1.1 || Math.abs(s.y) > 1.1) op = 0;
      l.x = (s.x * 0.5 + 0.5) * W; l.y = (-s.y * 0.5 + 0.5) * H;
      l.on = op > 0.05;
      l.el.style.opacity = op.toFixed(3);
      l.el.style.visibility = l.on ? 'visible' : 'hidden';
      l.el.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px)`;
    }
    const ui = sp.app.ui;
    if (ui) {
      ui.fpsAcc += dt; ui.fpsFrames++;
      if (ui.fpsAcc > 0.5) { const f = $('ro-fps'); if (f) f.textContent = String(Math.round(ui.fpsFrames / ui.fpsAcc)); ui.fpsAcc = 0; ui.fpsFrames = 0; }
    }
    this.syncWarp();
  }
}

function smoothstep(a, b, x) { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }
