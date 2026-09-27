import { formatClock } from '../core/sun.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;

/**
 * Photo mode: hides the interface, slows flight for careful framing, and offers field of view,
 * time of day, exposure, roll, frame shapes and a thirds grid. Capture renders a fresh frame at
 * full render scale and saves the framed area as a PNG. Where downloads are blocked the capture
 * stays in the panel as an image that can be saved by hand (or shared on phones).
 */
export class PhotoMode {
  constructor(ui) {
    this.ui = ui;
    this.app = ui.app;
    this.active = false;
    this.aspect = 0;
    this.ev = 0;
    this.lastUrl = null;
    this._hookExposure();
    this._bind();
  }

  /** Exposure offset: wraps App.exposureFor so the post pipeline (and bloom threshold) follow it. */
  _hookExposure() {
    const app = this.app;
    if (app._photoExposureHook || typeof app.exposureFor !== 'function') return;
    const base = app.exposureFor.bind(app);
    app.exposureFor = (sunY, alt) => base(sunY, alt) * Math.pow(2, app.exposureEV || 0);
    app._photoExposureHook = true;
  }

  _bind() {
    const c = this.app.controls;
    $('photo-exit').addEventListener('click', () => this.exit());
    $('ph-capture').addEventListener('click', () => this.capture());
    $('ph-reset').addEventListener('click', () => { this._set({ fov: 60, ev: 0, roll: 0 }); this.ui.sound('tick'); });
    $('ph-fov').addEventListener('input', (e) => this._set({ fov: parseFloat(e.target.value) }));
    $('ph-ev').addEventListener('input', (e) => this._set({ ev: parseFloat(e.target.value) }));
    $('ph-roll').addEventListener('input', (e) => this._set({ roll: parseFloat(e.target.value) }));
    $('ph-time').addEventListener('input', (e) => { this.app.hours = parseFloat(e.target.value); this.ui.timeTarget = null; });
    $('ph-grid').addEventListener('change', (e) => $('photo').classList.toggle('grid', e.target.checked));
    $('ph-freeze').addEventListener('change', (e) => { this.app.timeSpeed = e.target.checked ? 0 : this.saved?.timeSpeed || 0; this.ui._syncPlay(); });
    for (const b of document.querySelectorAll('#photo .chips button')) {
      b.addEventListener('click', () => {
        this.aspect = parseFloat(b.dataset.aspect) || 0;
        for (const o of document.querySelectorAll('#photo .chips button')) o.setAttribute('aria-pressed', String(o === b));
        this.layout();
        this.ui.sound('tick');
      });
    }
    // double-click the canvas in photo mode to hide or show the panel
    this.app.canvas.addEventListener('dblclick', () => { if (this.active) this.togglePanel(); });
    void c;
  }

  toggle() { this.active ? this.exit() : this.enter(); }

  enter() {
    if (this.active) return;
    const ui = this.ui, app = this.app, c = app.controls;
    ui.tour.stop();
    if (ui.atlas.open) ui.atlas.close();
    if (ui.intro.active) ui.intro.finish(false);
    this.active = true;
    this.saved = { fov: c.baseFov, timeSpeed: app.timeSpeed, speedScale: c.speedScale };
    c.speedScale = 0.22;
    if ($('ph-freeze').checked) { app.timeSpeed = 0; ui._syncPlay(); }
    if (c.driver) c.release();
    document.body.classList.add('photo-on');
    ui._updateBars();
    $('photo').hidden = false;
    $('photo').classList.remove('panel-hidden');
    $('btn-photo').classList.add('active');
    this._set({ fov: c.baseFov, ev: app.exposureEV || 0, roll: (c.targetRoll || 0) / DEG });
    $('ph-time').value = app.hours.toFixed(2);
    this.layout();
    ui.sound('open');
  }

  exit() {
    if (!this.active) return;
    const ui = this.ui, app = this.app, c = app.controls;
    this.active = false;
    c.speedScale = this.saved ? this.saved.speedScale : 1;
    c.baseFov = 60;
    c.targetRoll = 0;
    app.exposureEV = 0;
    if (this.saved && $('ph-freeze').checked) app.timeSpeed = this.saved.timeSpeed;
    ui._syncPlay();
    document.body.classList.remove('photo-on');
    $('photo').hidden = true;
    $('btn-photo').classList.remove('active');
    ui._updateBars();
    ui.sound('close');
  }

  togglePanel() { $('photo').classList.toggle('panel-hidden'); }

  _set({ fov, ev, roll }) {
    const c = this.app.controls;
    if (fov != null) { c.baseFov = fov; $('ph-fov').value = fov; $('ph-fov-o').textContent = `${fov.toFixed(fov < 20 ? 1 : 0)}°`; }
    if (ev != null) { this.app.exposureEV = ev; $('ph-ev').value = ev; $('ph-ev-o').textContent = `${ev > 0 ? '+' : ev < 0 ? '−' : ''}${Math.abs(ev).toFixed(1)} EV`; }
    if (roll != null) { c.targetRoll = roll * DEG; $('ph-roll').value = roll; $('ph-roll-o').textContent = `${roll.toFixed(1)}°`; }
  }

  /** Size the framing window for the chosen aspect ratio. */
  layout() {
    if (!this.active) return;
    const win = $('photo-window');
    const W = window.innerWidth, H = window.innerHeight;
    if (!this.aspect) { win.style.width = `${W}px`; win.style.height = `${H}px`; this.rect = { x: 0, y: 0, w: W, h: H }; return; }
    const m = Math.min(W, H) * 0.06;
    let w = W - 2 * m, h = w / this.aspect;
    if (h > H - 2 * m) { h = H - 2 * m; w = h * this.aspect; }
    win.style.width = `${w}px`; win.style.height = `${h}px`;
    this.rect = { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  update() {
    if (!this.active) return;
    const t = $('ph-time');
    if (document.activeElement !== t) t.value = this.app.hours.toFixed(2);
    $('ph-time-o').textContent = formatClock(this.app.hours);
  }

  /** Render a clean frame at full render scale and save the framed area as a PNG. */
  async capture() {
    if (!this.active || this.busy) return;
    this.busy = true;
    const app = this.app, ui = this.ui;
    ui.sound('shutter');
    const flash = $('photo-flash');
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    let blob = null, url = null;
    const prevScale = app.dynScale;
    try {
      if (app.perf) app.perf.frozen = true;
      if (prevScale < 1) { app.dynScale = 1; app.resize(); }
      // render and read back in the same task, while the drawing buffer is still valid
      app.frame(0);
      const canvas = app.canvas;
      const k = canvas.width / window.innerWidth;
      const r = this.rect || { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
      const sx = Math.round(r.x * k), sy = Math.round(r.y * k), sw = Math.round(r.w * k), sh = Math.round(r.h * k);
      const out = document.createElement('canvas');
      out.width = sw; out.height = sh;
      out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      blob = await new Promise((res) => { try { out.toBlob((b) => res(b), 'image/png'); } catch (e) { res(null); } });
      if (!blob) url = out.toDataURL('image/png');
    } catch (e) {
      console.warn('Photo capture failed:', e);
    } finally {
      if (prevScale < 1) { app.dynScale = prevScale; app.resize(); }
      if (app.perf) app.perf.frozen = false;
    }
    if (!blob && !url) { ui.toast('This browser would not hand over the picture. Try a screenshot instead.'); this.busy = false; return; }
    if (this.lastUrl && this.lastUrl.startsWith('blob:')) URL.revokeObjectURL(this.lastUrl);
    url = blob ? URL.createObjectURL(blob) : url;
    this.lastUrl = url;
    const d = new Date();
    const name = `meridian-5026-${formatClock(app.hours).replace(':', '')}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.png`;
    $('ph-img').src = url;
    const link = $('ph-link');
    link.href = url; link.download = name;
    $('ph-last').hidden = false;
    let saved = false;
    try {
      const a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      saved = true;
    } catch (e) { saved = false; }
    $('ph-saved').textContent = saved ? 'Saved to your downloads. If nothing arrived, right-click or press and hold the picture.' : 'Downloads are blocked here. Right-click or press and hold the picture to save it.';
    $('ph-img').title = name;
    // phones: offer the share sheet when files can be shared
    try {
      if (blob && navigator.canShare && window.matchMedia('(pointer: coarse)').matches) {
        const file = new File([blob], name, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          link.textContent = 'Share';
          link.onclick = (e) => { e.preventDefault(); navigator.share({ files: [file], title: 'Meridian' }).catch(() => {}); };
        }
      }
    } catch (e) { /* optional */ }
    ui.toast('Photo captured');
    this.busy = false;
  }
}
