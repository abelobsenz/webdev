/**
 * Optional GPU pass timings (EXT_disjoint_timer_query_webgl2). Enabled with the
 * URL parameter `?gpuprof`: prints averaged per-pass milliseconds to the console
 * every two seconds and keeps them in `meridian.pipeline.timer.averages`.
 * Queries are strictly sequential (WebGL allows one active TIME_ELAPSED query),
 * so the main scene pass is split at the mid-frame hook.
 */
export class GpuTimer {
  constructor(gl, enabled) {
    this.gl = gl;
    this.ext = enabled ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    this.enabled = !!this.ext;
    this.pending = [];
    this.free = [];
    this.active = null;
    this.sums = {};
    this.counts = {};
    this.averages = {};
    this.lastPrint = performance.now();
  }

  begin(name) {
    if (!this.enabled) return;
    if (this.active) this.end();
    const gl = this.gl;
    const q = this.free.pop() || gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = { q, name };
  }

  end() {
    if (!this.enabled || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Collect finished queries (call once per frame, outside any pass). */
  poll() {
    if (!this.enabled) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const p = this.pending[0];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        const ms = gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
        this.sums[p.name] = (this.sums[p.name] || 0) + ms;
        this.counts[p.name] = (this.counts[p.name] || 0) + 1;
      }
      this.free.push(p.q);
    }
    const now = performance.now();
    if (now - this.lastPrint > 2000) {
      this.lastPrint = now;
      let total = 0;
      const out = {};
      for (const k of Object.keys(this.sums)) {
        out[k] = +(this.sums[k] / this.counts[k]).toFixed(3);
        total += out[k];
      }
      out.total = +total.toFixed(3);
      this.averages = out;
      this.sums = {}; this.counts = {};
      console.info('[gpu ms]', JSON.stringify(out));
    }
  }
}
