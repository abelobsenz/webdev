import { POIS } from './pois.js';
import { ISLANDS, TOWERS, FLOATING_ISLANDS, CHORUS, SKYPORT, GATE, PLAZA_R } from '../world/layout.js';
import { INNER, terrainHeight } from '../world/terrain.js';

const $ = (id) => document.getElementById(id);
const E = 9600;                 // map half-extent in metres (the caldera plus open sea)
const S = 1024;                 // base raster size
const GOLD = '233, 198, 143';
const LAGOON = '127, 218, 210';
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

/**
 * The atlas: an elegant top-down chart of the caldera drawn on a 2D canvas from the terrain
 * heightfield (hill-shaded land, bathymetry, a gold coastline, contours, districts), with
 * landmarks, structures, the camera position and heading, and the tour route. Click a
 * landmark or anywhere on the chart to fly there. Scroll or pinch to zoom, drag to pan.
 */
export class Atlas {
  constructor(ui) {
    this.ui = ui;
    this.app = ui.app;
    this.open = false;
    this.base = null;
    this.canvas = $('atlas-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.view = { cx: 0, cz: 0, zoom: 1 };
    this.hover = null;
    this.hoverPt = null;
    this.pings = [];
    this.pointers = new Map();
    this.time = 0;
    this._bind();
  }

  // ------------------------------------------------------------ open --
  toggle() { this.open ? this.close() : this.show(); }

  show() {
    if (this.open) return;
    const ui = this.ui;
    if (ui.photo.active) ui.photo.exit();
    this.open = true;
    this.returnFocus = document.activeElement;
    $('atlas').hidden = false;
    document.body.classList.add('atlas-on');
    $('btn-atlas').classList.add('active');
    if (!this.base) this._buildBase();
    this._buildList();
    this.resize();
    ui.sound('open');
    setTimeout(() => { const b = document.querySelector('#atlas-list button'); if (b && document.activeElement === document.body) b.focus({ preventScroll: true }); }, 60);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    $('atlas').hidden = true;
    document.body.classList.remove('atlas-on');
    $('btn-atlas').classList.remove('active');
    $('atlas-tip').hidden = true;
    this.ui.sound('close');
    if (this.returnFocus && this.returnFocus.focus && document.contains(this.returnFocus)) this.returnFocus.focus({ preventScroll: true });
  }

  resize() {
    if (!this.open) return;
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.dpr = dpr;
  }

  // ------------------------------------------------------------ input --
  _bind() {
    $('atlas-close').addEventListener('click', () => this.close());
    $('atlas-reset').addEventListener('click', () => { this.view = { cx: 0, cz: 0, zoom: 1 }; this.ui.sound('tick'); });
    $('atlas').addEventListener('click', (e) => { if (e.target === $('atlas')) this.close(); });
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, x0: e.offsetX, y0: e.offsetY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      }
      this.dragged = false;
    });
    cv.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) { this._hover(e.offsetX, e.offsetY); return; }
      const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
      p.x = e.offsetX; p.y = e.offsetY;
      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this._zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / Math.max(this.pinch.d, 1));
        this.pinch.d = d;
        this.dragged = true;
        return;
      }
      if (Math.hypot(e.offsetX - p.x0, e.offsetY - p.y0) > 5) this.dragged = true;
      if (this.dragged) {
        const s = this._scale();
        this.view.cx -= dx / s; this.view.cz -= dy / s;
        this._clampView();
        $('atlas-map').classList.add('dragging');
        $('atlas-tip').hidden = true;
      }
    });
    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      $('atlas-map').classList.remove('dragging');
      if (p && !this.dragged && e.type === 'pointerup') this._click(e.offsetX, e.offsetY);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (!this.pointers.size) { this.hover = null; this.hoverPt = null; $('atlas-tip').hidden = true; } });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._zoomAt(e.offsetX, e.offsetY, Math.pow(1.0018, -e.deltaY));
    }, { passive: false });
  }

  _scale() { return (Math.min(this.W, this.H) / (2 * E)) * this.view.zoom; }
  toScreen(x, z) { const s = this._scale(); return [this.W / 2 + (x - this.view.cx) * s, this.H / 2 + (z - this.view.cz) * s]; }
  toWorld(sx, sy) { const s = this._scale(); return [this.view.cx + (sx - this.W / 2) / s, this.view.cz + (sy - this.H / 2) / s]; }

  _zoomAt(sx, sy, f) {
    const [wx, wz] = this.toWorld(sx, sy);
    this.view.zoom = clamp(this.view.zoom * f, 1, 7);
    const s = this._scale();
    this.view.cx = wx - (sx - this.W / 2) / s;
    this.view.cz = wz - (sy - this.H / 2) / s;
    this._clampView();
  }

  _clampView() {
    const lim = E * (1 - 1 / this.view.zoom) + 1500;
    this.view.cx = clamp(this.view.cx, -lim, lim);
    this.view.cz = clamp(this.view.cz, -lim, lim);
    if (this.view.zoom <= 1.001) { this.view.cx *= 0.5; this.view.cz *= 0.5; }
  }

  _markers() {
    const out = [];
    for (const p of POIS) {
      if (!p.view) continue;
      const off = Math.abs(p.view.x) > E * 0.97 || Math.abs(p.view.z) > E * 0.97 || Math.abs(p.view.y) > 20000;
      out.push({ poi: p, x: p.view.x, z: p.view.z, off });
    }
    return out;
  }

  _hitMarker(sx, sy) {
    let best = null, bd = 16;
    for (const m of this._drawnMarkers || []) {
      const d = Math.hypot(m.sx - sx, m.sy - sy);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  _hover(sx, sy) {
    const tip = $('atlas-tip');
    const m = this._hitMarker(sx, sy);
    this.hover = m ? m.poi : null;
    this.hoverPt = m ? null : [sx, sy];
    for (const b of document.querySelectorAll('#atlas-list button')) b.classList.toggle('hot', !!(m && b.dataset.id === m.poi.id));
    if (m) {
      tip.hidden = false;
      tip.innerHTML = '';
      tip.append(m.poi.name);
      const sm = document.createElement('small'); sm.textContent = `${m.poi.district} · ${this._dist(m.poi.view)}`;
      tip.appendChild(sm);
      tip.style.left = `${m.sx}px`; tip.style.top = `${m.sy}px`;
    } else {
      const [x, z] = this.toWorld(sx, sy);
      if (Math.abs(x) > E || Math.abs(z) > E) { tip.hidden = true; return; }
      tip.hidden = false;
      tip.innerHTML = 'Fly here';
      const sm = document.createElement('small');
      const h = Math.max(this.app.world.groundHeight(x, z), 0);
      sm.textContent = `${(x / 1000).toFixed(2)} km E · ${(-z / 1000).toFixed(2)} km N · ${h < 1 ? 'water' : `${Math.round(h)} m`}`;
      tip.appendChild(sm);
      tip.style.left = `${sx}px`; tip.style.top = `${sy}px`;
    }
  }

  _click(sx, sy) {
    const m = this._hitMarker(sx, sy);
    if (m) {
      this.pings.push({ sx: m.sx, sy: m.sy, t: 0 });
      this.ui.tour.stop();
      setTimeout(() => { this.close(); this.ui.goTo(m.poi); }, 260);
      return;
    }
    const [x, z] = this.toWorld(sx, sy);
    if (Math.abs(x) > E || Math.abs(z) > E) return;
    this.pings.push({ sx, sy, t: 0 });
    setTimeout(() => { this.close(); this.ui.flyToPoint(x, z); }, 260);
  }

  _dist(p) {
    const c = this.app.camera.position;
    const d = Math.hypot(p.x - c.x, p.z - c.z);
    return d < 1000 ? `${Math.round(d / 10) * 10} m away` : `${(d / 1000).toFixed(1)} km away`;
  }

  _buildList() {
    const list = $('atlas-list');
    list.innerHTML = '';
    for (const p of POIS) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = p.id;
      const dot = document.createElement('span'); dot.className = 'dot';
      const n = document.createElement('span'); n.textContent = p.name;
      const d = document.createElement('span'); d.className = 'dist'; d.textContent = p.view ? this._dist(p.view).replace(' away', '') : '';
      b.append(dot, n, d);
      b.addEventListener('click', () => { this.ui.tour.stop(); this.close(); this.ui.goTo(p); });
      b.addEventListener('mouseenter', () => { this.hover = p; });
      b.addEventListener('mouseleave', () => { if (this.hover === p) this.hover = null; });
      b.addEventListener('focus', () => { this.hover = p; });
      li.appendChild(b);
      list.appendChild(li);
    }
  }

  // ------------------------------------------------------------ base --
  _buildBase() {
    const w = this.app.world;
    const heights = w.heights;
    const { half, n } = INNER;
    const s1 = n + 1;
    // coarse analytic grid for the sea beyond the inner heightfield
    const CG = 192;
    const coarse = new Float32Array((CG + 1) * (CG + 1));
    for (let j = 0; j <= CG; j++) for (let i = 0; i <= CG; i++) {
      const x = -E + (i / CG) * 2 * E, z = -E + (j / CG) * 2 * E;
      coarse[j * (CG + 1) + i] = Math.max(Math.abs(x), Math.abs(z)) < half - 60 ? 0 : terrainHeight(x, z);
    }
    const H = new Float32Array(S * S);
    const hAt = (x, z) => {
      const u = ((x + half) / (2 * half)) * n, v = ((z + half) / (2 * half)) * n;
      if (u >= 0 && v >= 0 && u < n && v < n) {
        const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
        const a = heights[j * s1 + i], b = heights[j * s1 + i + 1], c = heights[(j + 1) * s1 + i], d = heights[(j + 1) * s1 + i + 1];
        return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
      }
      const cu = clamp(((x + E) / (2 * E)) * CG, 0, CG - 1e-3), cv = clamp(((z + E) / (2 * E)) * CG, 0, CG - 1e-3);
      const i = Math.floor(cu), j = Math.floor(cv), fu = cu - i, fv = cv - j, C = CG + 1;
      return (coarse[j * C + i] * (1 - fu) + coarse[j * C + i + 1] * fu) * (1 - fv) + (coarse[(j + 1) * C + i] * (1 - fu) + coarse[(j + 1) * C + i + 1] * fu) * fv;
    };
    const px = (2 * E) / S;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) H[j * S + i] = hAt(-E + (i + 0.5) * px, -E + (j + 0.5) * px);

    const info = w.info;
    const urbanAt = (x, z) => {
      if (!info) return 0;
      const N = info.N;
      const i = Math.floor(((x + half) / (2 * half)) * N), j = Math.floor(((z + half) / (2 * half)) * N);
      if (i < 0 || j < 0 || i >= N || j >= N) return [0, 0];
      const k = j * N + i;
      return [info.urban[k], info.forest[k]];
    };
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const D = img.data;
    const L = [-0.55, 0.62, -0.56];      // light from the north-west
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const k = j * S + i;
        const h = H[k];
        const x = -E + (i + 0.5) * px, z = -E + (j + 0.5) * px;
        const hl = H[j * S + Math.max(i - 1, 0)], hr = H[j * S + Math.min(i + 1, S - 1)];
        const hu = H[Math.max(j - 1, 0) * S + i], hd = H[Math.min(j + 1, S - 1) * S + i];
        let r, gg, b;
        if (h <= 0.4) {
          // water: lagoon shallows glow teal, open ocean falls away to ink
          const shallow = sstep(-70, -6, h);
          const reef = sstep(-14, -2, h);
          r = mix(4, 14, shallow) + reef * 10;
          gg = mix(10, 40, shallow) + reef * 26;
          b = mix(20, 58, shallow) + reef * 22;
          // bathymetric bands
          const band = Math.abs(((h + 1000) / 20) % 1 - 0.5);
          if (h < -12 && band < 0.035) { r += 4; gg += 7; b += 9; }
        } else {
          const nx = (hl - hr) / (2 * px), nz = (hu - hd) / (2 * px);
          const len = Math.hypot(nx, 1, nz);
          const shade = clamp(0.62 + 0.8 * ((nx * L[0] + L[1] + nz * L[2]) / len - 0.35), 0.35, 1.35);
          const e = sstep(0, 70, h), e2 = sstep(80, 900, h);
          r = mix(52, 78, e) + e2 * 30; gg = mix(62, 76, e) + e2 * 24; b = mix(52, 62, e) + e2 * 18;
          const [ub, fo] = urbanAt(x, z) || [0, 0];
          const u = (ub || 0) * 0.65, f = (fo || 0) * 0.6;
          r = mix(r, 126, u); gg = mix(gg, 110, u); b = mix(b, 84, u);
          r = mix(r, 30, f); gg = mix(gg, 58, f); b = mix(b, 46, f);
          r *= shade; gg *= shade; b *= shade;
          // contours every 10 m (every 100 m on the massif)
          const step = h > 120 ? 100 : 10;
          const a0 = Math.floor(h / step), a1 = Math.floor(Math.min(hl, hr, hu, hd) / step);
          if (a0 !== a1 && h > 2) { r *= 0.78; gg *= 0.78; b *= 0.78; }
        }
        // coastline
        const land = h > 0.4;
        if (land !== (hl > 0.4) || land !== (hr > 0.4) || land !== (hu > 0.4) || land !== (hd > 0.4)) { r = mix(r, 233, 0.8); gg = mix(gg, 198, 0.8); b = mix(b, 143, 0.8); }
        // soft vignette into the page
        const rr = Math.hypot(x, z) / E;
        const vig = 1 - sstep(0.8, 1.1, rr) * 0.5;
        const edge = 1 - sstep(0.84, 0.995, Math.max(Math.abs(x), Math.abs(z)) / E);
        D[k * 4] = r * vig; D[k * 4 + 1] = gg * vig; D[k * 4 + 2] = b * vig; D[k * 4 + 3] = 255 * edge;
      }
    }
    g.putImageData(img, 0, 0);
    this.base = c;
  }

  // ------------------------------------------------------------ draw --
  update(dt) {
    if (!this.open) return;
    this.time += dt;
    this._draw(dt);
  }

  _draw(dt) {
    const g = this.ctx, W = this.W, H = this.H, dpr = this.dpr || 1;
    if (!W || !this.base) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#040912';
    g.fillRect(0, 0, W, H);
    const s = this._scale();
    const [x0, y0] = this.toScreen(-E, -E);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.base, x0, y0, 2 * E * s, 2 * E * s);

    // graticule every kilometre
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(237, 241, 247, 0.055)';
    g.beginPath();
    for (let k = -9; k <= 9; k++) {
      const [ax, ay] = this.toScreen(k * 1000, -E), [, by] = this.toScreen(k * 1000, E);
      g.moveTo(Math.round(ax) + 0.5, ay); g.lineTo(Math.round(ax) + 0.5, by);
      const [cx, cy] = this.toScreen(-E, k * 1000), [dx] = this.toScreen(E, k * 1000);
      g.moveTo(cx, Math.round(cy) + 0.5); g.lineTo(dx, Math.round(cy) + 0.5);
    }
    g.stroke();

    const font = (px, fam = 'body', weight = 400) => `${weight} ${px}px ${fam === 'mono' ? "'Martian Mono', ui-monospace, monospace" : fam === 'display' ? "'Marcellus', Georgia, serif" : "'Jost', system-ui, sans-serif"}`;
    const zs = Math.sqrt(this.view.zoom);

    // promenades
    const prom = this.app.world.infra && this.app.world.infra.promenades;
    if (prom) {
      g.strokeStyle = `rgba(${GOLD}, 0.5)`;
      g.lineWidth = Math.max(1, 28 * s);
      g.lineCap = 'round';
      for (const path of prom) {
        g.beginPath();
        path.forEach((p, i) => { const [a, b] = this.toScreen(p.x, p.z); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
        g.stroke();
      }
    }
    // the Axis and its plaza
    {
      const [ax, ay] = this.toScreen(0, 0);
      g.strokeStyle = `rgba(${GOLD}, 0.85)`;
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(ax, ay, PLAZA_R * s, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(ax, ay, Math.max(3, 90 * s), 0, Math.PI * 2); g.fillStyle = `rgba(${GOLD}, 0.95)`; g.fill();
      g.strokeStyle = `rgba(${GOLD}, 0.35)`;
      g.beginPath();
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.moveTo(ax + Math.cos(a) * 110 * s, ay + Math.sin(a) * 110 * s); g.lineTo(ax + Math.cos(a) * PLAZA_R * s, ay + Math.sin(a) * PLAZA_R * s); }
      g.stroke();
    }
    // floating gardens, skyport, chorus, gate
    g.setLineDash([3, 3]);
    g.strokeStyle = `rgba(${LAGOON}, 0.7)`;
    g.lineWidth = 1;
    for (const f of FLOATING_ISLANDS) { const [a, b] = this.toScreen(f.x, f.z); g.beginPath(); g.arc(a, b, Math.max(2.5, f.r * s), 0, Math.PI * 2); g.stroke(); }
    { const [a, b] = this.toScreen(SKYPORT.x, SKYPORT.z); g.beginPath(); g.arc(a, b, SKYPORT.r * s, 0, Math.PI * 2); g.stroke(); }
    g.setLineDash([1, 3]);
    { const [a, b] = this.toScreen(CHORUS.x, CHORUS.z); g.beginPath(); g.arc(a, b, CHORUS.scale * s, 0, Math.PI * 2); g.stroke(); }
    g.setLineDash([]);
    {
      const [a, b] = this.toScreen(GATE.x - GATE.span / 2, GATE.z), [c2] = this.toScreen(GATE.x + GATE.span / 2, GATE.z);
      g.strokeStyle = `rgba(${GOLD}, 0.9)`; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(a, b); g.quadraticCurveTo((a + c2) / 2, b - 10 * zs, c2, b); g.stroke();
    }
    // towers
    for (const t of TOWERS) {
      const [a, b] = this.toScreen(t.x, t.z);
      const r = clamp((t.radius || 50) * s * 1.2, 1.8, 7);
      g.fillStyle = t.name ? `rgba(${GOLD}, 0.95)` : `rgba(${GOLD}, 0.55)`;
      g.beginPath(); g.moveTo(a, b - r); g.lineTo(a + r, b); g.lineTo(a, b + r); g.lineTo(a - r, b); g.closePath(); g.fill();
    }
    // district names (their boxes also keep landmark labels clear)
    const placed = [];
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(Math.round(clamp(10.5 * zs, 10, 16)), 'display');
    const spaced = (t) => t.toUpperCase().split('').join('\u200a');
    const districtLabel = (text, x, z, color) => {
      const [a, b] = this.toScreen(x, z);
      const w = g.measureText(text).width;
      placed.push([a - w / 2 - 2, b - 7, a + w / 2 + 2, b + 7]);
      this._label(g, text, a, b, color);
    };
    for (const isl of ISLANDS) districtLabel(spaced(isl.name), isl.x, isl.z + isl.r * 0.55, 'rgba(237, 241, 247, 0.62)');
    districtLabel(spaced('Axis'), 0, PLAZA_R + 170, `rgba(${GOLD}, 0.9)`);
    g.font = font(Math.round(clamp(9.5 * zs, 9.5, 14)), 'mono', 300);
    { const [a, b] = this.toScreen(2600, 4600); this._label(g, 'THE LAGOON', a, b, `rgba(${LAGOON}, 0.5)`); }
    { const [a, b] = this.toScreen(-6800, 7200); this._label(g, 'PACIFIC OCEAN', a, b, 'rgba(156, 166, 184, 0.45)'); }
    { const [a, b] = this.toScreen(4600, -5600); this._label(g, 'ATOLL RIM', a, b, 'rgba(156, 166, 184, 0.5)'); }

    // tour route
    const tour = this.ui.tour;
    if (tour.active && tour.cur && tour.cur.path) {
      const path = tour.cur.path;
      g.strokeStyle = `rgba(${GOLD}, 0.9)`; g.lineWidth = 1.5; g.setLineDash([5, 4]);
      g.beginPath();
      const n = 60;
      for (let k = 0; k <= n; k++) {
        const p = path.pointAt((k / n) * path.length);
        const [a, b] = this.toScreen(p.x, p.z);
        if (k) g.lineTo(a, b); else g.moveTo(a, b);
      }
      g.stroke(); g.setLineDash([]);
    }

    // landmarks (vantage points with a view wedge)
    this._drawnMarkers = [];
    const active = this.ui.activePoi;
    g.font = font(Math.round(clamp(11 * zs, 11, 15)));
    const markers = this._markers();
    // hovered landmark: show what the view looks at
    const hv = this.hover;
    if (hv && hv.view && hv.target && Math.abs(hv.target.y) < 20000 && Math.abs(hv.target.x) < E && Math.abs(hv.target.z) < E) {
      const [a, b] = this.toScreen(hv.view.x, hv.view.z), [c2, d2] = this.toScreen(hv.target.x, hv.target.z);
      if (Math.hypot(c2 - a, d2 - b) > 12) {
        g.strokeStyle = `rgba(${GOLD}, 0.75)`; g.lineWidth = 1; g.setLineDash([4, 4]);
        g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d2); g.stroke(); g.setLineDash([]);
        g.beginPath(); g.arc(c2, d2, 5, 0, Math.PI * 2); g.stroke();
      }
    }
    for (const m of markers) {
      const p = m.poi;
      let [a, b] = this.toScreen(m.x, m.z);
      const margin = 22;
      let edge = false;
      if (m.off || a < margin || b < margin || a > W - margin || b > H - margin) {
        // pin to the edge, pointing towards it
        const cx = W / 2, cy = H / 2;
        const dx = a - cx, dy = b - cy;
        const k = Math.min((W / 2 - margin) / Math.max(Math.abs(dx), 1e-3), (H / 2 - margin) / Math.max(Math.abs(dy), 1e-3), 1);
        if (k < 1) { a = cx + dx * k; b = cy + dy * k; edge = true; }
      }
      const hot = this.hover === p;
      const isActive = active && active.id === p.id;
      const col = hot || isActive ? GOLD : LAGOON;
      // view wedge
      if (!edge && p.target) {
        const ang = Math.atan2(p.target.z - m.z, p.target.x - m.x);
        g.fillStyle = `rgba(${col}, ${hot ? 0.28 : 0.14})`;
        g.beginPath(); g.moveTo(a, b);
        g.arc(a, b, hot ? 26 : 18, ang - 0.4, ang + 0.4); g.closePath(); g.fill();
      }
      const r = hot ? 6 : 4.5;
      g.fillStyle = `rgba(${col}, 1)`;
      g.strokeStyle = 'rgba(4, 9, 18, 0.9)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(a, b - r); g.lineTo(a + r, b); g.lineTo(a, b + r); g.lineTo(a - r, b); g.closePath(); g.fill(); g.stroke();
      if (edge) {
        const ang = Math.atan2(b - H / 2, a - W / 2);
        g.strokeStyle = `rgba(${col}, 0.9)`; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(a + Math.cos(ang) * 9, b + Math.sin(ang) * 9); g.lineTo(a + Math.cos(ang) * 15, b + Math.sin(ang) * 15); g.stroke();
      }
      this._drawnMarkers.push({ poi: p, sx: a, sy: b });
      // label (skip if it would collide, unless hovered)
      const text = p.name.replace(/^The /, '');
      const tw = g.measureText(text).width;
      // try right, left, below, above; skip the label if every side is taken (unless hovered)
      const spots = [[a + 10, b], [a - 10 - tw, b], [a - tw / 2, b + 15], [a - tw / 2, b - 15]];
      let pick = null;
      for (const [lx, ly] of spots) {
        if (lx < 4 || lx + tw > W - 4 || ly < 10 || ly > H - 10) continue;
        const box = [lx - 3, ly - 8, lx + tw + 3, ly + 8];
        if (!placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) { pick = [lx, ly, box]; break; }
      }
      if (!pick && hot) pick = [spots[0][0], spots[0][1], [0, 0, 0, 0]];
      if (pick) {
        g.textAlign = 'left';
        this._label(g, text, pick[0], pick[1], hot || isActive ? `rgba(${GOLD}, 1)` : 'rgba(237, 241, 247, 0.9)');
        placed.push(pick[2]);
      }
    }

    // camera
    {
      const c = this.app.camera.position;
      const [a, b] = this.toScreen(c.x, c.z);
      const heading = (this.app.controls.heading * Math.PI) / 180;
      const ang = heading - Math.PI / 2;           // map: north is up
      const fov = ((this.app.camera.fov * this.app.camera.aspect) * Math.PI) / 180;
      const len = clamp(60 + Math.max(c.y, 0) * 0.08, 60, 170);
      const grd = g.createRadialGradient(a, b, 0, a, b, len);
      grd.addColorStop(0, 'rgba(255, 244, 220, 0.36)');
      grd.addColorStop(1, 'rgba(255, 244, 220, 0)');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(a, b); g.arc(a, b, len, ang - Math.min(fov, 2.6) / 2, ang + Math.min(fov, 2.6) / 2); g.closePath(); g.fill();
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
      g.strokeStyle = `rgba(255, 244, 220, ${0.25 + 0.3 * pulse})`; g.lineWidth = 1;
      g.beginPath(); g.arc(a, b, 10 + pulse * 3, 0, Math.PI * 2); g.stroke();
      g.save(); g.translate(a, b); g.rotate(ang + Math.PI / 2);
      g.fillStyle = '#fff4dc'; g.strokeStyle = 'rgba(4, 9, 18, 0.9)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6); g.closePath(); g.fill(); g.stroke();
      g.restore();
      g.font = font(10, 'mono', 300);
      g.textAlign = 'left';
      const alt = c.y < 10000 ? `${Math.round(c.y)} m` : `${(c.y / 1000).toFixed(1)} km`;
      this._label(g, `YOU · ${alt}`, a + 14, b + 14, 'rgba(255, 244, 220, 0.85)');
    }

    // hover crosshair on open ground
    if (this.hoverPt && !this.pointers.size) {
      const [a, b] = this.hoverPt;
      g.strokeStyle = `rgba(${GOLD}, 0.8)`; g.lineWidth = 1;
      g.beginPath(); g.arc(a, b, 7, 0, Math.PI * 2); g.moveTo(a - 12, b); g.lineTo(a - 4, b); g.moveTo(a + 4, b); g.lineTo(a + 12, b); g.moveTo(a, b - 12); g.lineTo(a, b - 4); g.moveTo(a, b + 4); g.lineTo(a, b + 12); g.stroke();
    }
    // click pings
    for (const p of this.pings) {
      p.t += dt;
      const k = clamp(p.t / 0.5, 0, 1);
      g.strokeStyle = `rgba(${GOLD}, ${1 - k})`; g.lineWidth = 1.5;
      g.beginPath(); g.arc(p.sx, p.sy, 6 + k * 30, 0, Math.PI * 2); g.stroke();
    }
    this.pings = this.pings.filter((p) => p.t < 0.5);

    // compass rose + scale bar
    {
      const x = W - 34, y = 34;
      g.strokeStyle = 'rgba(237, 241, 247, 0.5)'; g.lineWidth = 1;
      g.beginPath(); g.arc(x, y, 16, 0, Math.PI * 2); g.stroke();
      g.fillStyle = `rgba(${GOLD}, 1)`;
      g.beginPath(); g.moveTo(x, y - 13); g.lineTo(x + 4, y); g.lineTo(x - 4, y); g.closePath(); g.fill();
      g.fillStyle = 'rgba(237, 241, 247, 0.5)';
      g.beginPath(); g.moveTo(x, y + 13); g.lineTo(x + 4, y); g.lineTo(x - 4, y); g.closePath(); g.fill();
      g.font = font(9, 'mono'); g.textAlign = 'center';
      this._label(g, 'N', x, y - 24, `rgba(${GOLD}, 1)`);
      // scale: pick a round length about 90 px long
      const target = 90 / s;
      const nice = [250, 500, 1000, 2000, 5000].find((v) => v >= target * 0.6) || 5000;
      const len = nice * s;
      const bx = 18, by = H - 20;
      g.strokeStyle = 'rgba(237, 241, 247, 0.7)';
      g.beginPath(); g.moveTo(bx, by - 4); g.lineTo(bx, by); g.lineTo(bx + len, by); g.lineTo(bx + len, by - 4); g.stroke();
      g.textAlign = 'left';
      this._label(g, nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, bx + len + 8, by - 2, 'rgba(237, 241, 247, 0.7)');
    }
  }

  _label(g, text, x, y, color) {
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(4, 9, 18, 0.75)';
    g.lineJoin = 'round';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }
}
