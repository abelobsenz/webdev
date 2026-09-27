/**
 * Performance manager.
 *
 *  - Measures real GPU time per frame with EXT_disjoint_timer_query_webgl2 when the browser
 *    exposes it (results are read a few frames later, never stalling the pipeline). Falls back
 *    to CPU frame time.
 *  - Dynamic resolution on a fixed ladder of render scales with hysteresis: it steps down
 *    quickly when a frame budget is exceeded for a sustained window, steps up only after a long
 *    calm window and only if the predicted cost at the next rung fits, and remembers rungs that
 *    recently failed so it cannot oscillate between two levels.
 *  - Keeps rolling stats for the optional overlay (FPS, CPU ms, GPU ms, scale, draw calls).
 */
const LADDER = [0.45, 0.5, 0.56, 0.62, 0.69, 0.76, 0.84, 0.92, 1.0];

export class PerfManager {
  constructor(app) {
    this.app = app;
    this.gl = app.renderer.getContext();
    this.ext = null;
    try { this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2'); } catch (e) { this.ext = null; }
    this.free = [];
    this.pending = [];
    this.active = null;
    this.gpuSamples = [];
    this.cpuSamples = [];
    this.gpuMs = 0;
    this.frameMs = 16.7;
    this.fps = 60;
    this.level = LADDER.length - 1;
    this.lastChange = performance.now();
    this.startedAt = performance.now();
    this.banned = new Map();       // level -> until timestamp
    this.upAt = 0;                 // when we last stepped up (to detect a failed probe)
    this.upFrom = -1;
    this.targetMs = 1000 / 60;
    this.enabled = !new URLSearchParams(location.search).has('capture');
    this.frozen = false;           // photo capture, hidden tab …
    this.stats = { fps: 0, cpu: 0, gpu: null, scale: 1, calls: 0, tris: 0, w: 0, h: 0 };
    this._acc = 0; this._frames = 0; this._cpuAcc = 0;
    // ?rs=<scale> caps the render scale (below the ladder it pins it, for quick UI tests)
    const rs = parseFloat(new URLSearchParams(location.search).get('rs'));
    this.maxLevelScale = Number.isFinite(rs) && rs > 0 ? Math.min(rs, 1) : 1;
    this.fixedScale = Number.isFinite(rs) && rs > 0 && rs < LADDER[0] ? rs : 0;
    if (this.fixedScale) this.enabled = false;
    this.applyLevelLimit();
  }

  get hasGpuTimer() { return !!this.ext; }

  applyLevelLimit() {
    while (this.level > 0 && LADDER[this.level] > this.maxLevelScale + 1e-6) this.level--;
    this.app.dynScale = this.fixedScale || LADDER[this.level];
  }

  onPresetChanged() {
    this.level = LADDER.length - 1;
    this.banned.clear();
    this.applyLevelLimit();
    this.lastChange = performance.now();
    this.gpuSamples.length = 0; this.cpuSamples.length = 0;
  }

  // ---------------------------------------------------------- GPU timer --
  begin() {
    const gl = this.gl, ext = this.ext;
    if (!ext || this.active) return;
    // only one TIME_ELAPSED query may be active: yield to the per-pass profiler (?gpuprof)
    if (this.app.pipeline && this.app.pipeline.timer && this.app.pipeline.timer.enabled) return;
    const q = this.free.pop() || gl.createQuery();
    try { gl.beginQuery(ext.TIME_ELAPSED_EXT, q); this.active = q; } catch (e) { this.ext = null; }
  }

  end() {
    const gl = this.gl, ext = this.ext;
    if (!ext || !this.active) return;
    try { gl.endQuery(ext.TIME_ELAPSED_EXT); } catch (e) { this.ext = null; return; }
    this.pending.push(this.active);
    this.active = null;
    // collect finished queries (oldest first)
    while (this.pending.length) {
      const q = this.pending[0];
      const avail = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (!avail && !disjoint) break;
      this.pending.shift();
      if (avail && !disjoint) {
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        const ms = ns / 1e6;
        if (ms > 0 && ms < 500) { this.gpuSamples.push(ms); if (this.gpuSamples.length > 240) this.gpuSamples.shift(); }
      }
      this.free.push(q);
    }
    if (this.pending.length > 8) { for (const q of this.pending) gl.deleteQuery(q); this.pending.length = 0; }
  }

  // ------------------------------------------------------- measurement --
  /** Called once per frame with the frame delta (seconds). */
  adapt(dt) {
    const ms = dt * 1000;
    this.cpuSamples.push(ms); if (this.cpuSamples.length > 240) this.cpuSamples.shift();
    this._acc += dt; this._frames++;
    if (this._acc >= 0.5) {
      const info = this.app.renderer.info.render;
      const r = this.app.renderer;
      this.stats.fps = this._frames / this._acc;
      this.stats.cpu = (this._acc / this._frames) * 1000;
      this.stats.gpu = this.hasGpuTimer && this.gpuSamples.length ? median(this.gpuSamples.slice(-30)) : null;
      this.stats.scale = this.app.dynScale;
      this.stats.pr = r.getPixelRatio();
      this.stats.calls = info.calls; this.stats.tris = info.triangles;
      this.stats.w = Math.floor(window.innerWidth * this.stats.pr); this.stats.h = Math.floor(window.innerHeight * this.stats.pr);
      this._acc = 0; this._frames = 0;
    }
    if (!this.enabled || this.frozen || document.hidden) { this.lastChange = Math.max(this.lastChange, performance.now() - 1500); return; }
    const now = performance.now();
    if (now - this.startedAt < 4000) return;          // shader warm-up
    if (now - (this.app.lastResize || 0) < 1500) return;
    this._decide(now);
  }

  _decide(now) {
    const useGpu = this.hasGpuTimer && this.gpuSamples.length >= 30;
    const budget = this.targetMs;
    const since = now - this.lastChange;
    let down = false, up = false, severe = false;
    if (useGpu) {
      const recent = median(this.gpuSamples.slice(-40));
      const calm = median(this.gpuSamples.slice(-150));
      down = recent > budget * 0.93 && since > 900;
      severe = recent > budget * 1.35;
      if (this.level < LADDER.length - 1 && this.gpuSamples.length >= 150 && since > 4000) {
        const s0 = LADDER[this.level], s1 = LADDER[this.level + 1];
        const predicted = calm * (0.3 + 0.7 * (s1 * s1) / (s0 * s0));
        up = predicted < budget * 0.78;
      }
    } else {
      // CPU fallback: frame time is vsync-quantised, so only react to clear overload
      const recent = mean(this.cpuSamples.slice(-60));
      const calm = mean(this.cpuSamples.slice(-180));
      down = recent > budget * 1.2 && since > 1500 && this.cpuSamples.length >= 60;
      severe = recent > budget * 1.8;
      up = this.cpuSamples.length >= 180 && calm < budget * 1.05 && since > 6000;
    }
    if (down && this.level > this._minLevel()) {
      const from = this.level;
      this.level = Math.max(this._minLevel(), this.level - (severe ? 2 : 1));
      // stepping down soon after stepping up means the upper rung does not fit: ban it for a while
      if (this.upFrom >= 0 && now - this.upAt < 10000) this.banned.set(this.upFrom + 1, now + 60000);
      this.upFrom = -1;
      if (from !== this.level) this._set(now);
    } else if (up && this.level < LADDER.length - 1) {
      const next = this.level + 1;
      const until = this.banned.get(next) || 0;
      if (now > until && LADDER[next] <= this.maxLevelScale + 1e-6) {
        this.upFrom = this.level;
        this.upAt = now;
        this.level = next;
        this._set(now);
      }
    }
  }

  _minLevel() {
    const min = this.app.settings.minScale ?? 0.5;
    let l = 0;
    while (l < LADDER.length - 1 && LADDER[l] < min - 1e-6) l++;
    return l;
  }

  _set(now) {
    this.app.dynScale = LADDER[this.level];
    this.lastChange = now;
    this.gpuSamples.length = 0;
    this.cpuSamples.length = 0;
    this.app.resize();
  }
}

function median(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
