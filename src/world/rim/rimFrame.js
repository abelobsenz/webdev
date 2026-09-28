// The Rim's own frame of reference.
//
// The atoll rim is a ring of land some 600 m across (420-1120 m), its middle wandering 400 m
// in and out round the lagoon and cut by four channels. Everything laid on it is laid in this
// frame: for every bearing the land band across the rim (the lagoon shore and the sea shore
// where the ground meets the water), the spine Rim Way follows (the band's smoothed middle,
// kept well inside it), and the runs of land between the channels. It is surveyed once from
// the terrain the city is built on (the height grid), before anything is planned.

const TAU = Math.PI * 2;
export const RIM_N = 2048;                 // bearings surveyed (a bearing every 18 m round the ring)
const R0 = 4700, R1 = 7300, DR = 3;        // the radial survey

let FRAME = null, FRAME_GROUND = null;
/** The surveyed frame (null before surveyRim has run). */
export function rimFrame() { return FRAME; }

const wrapA = (a) => ((a % TAU) + TAU) % TAU;
/** Bearing (0..TAU) to fractional survey index. */
export const kOf = (a) => (wrapA(a) / TAU) * RIM_N;
export const aOf = (k) => (k / RIM_N) * TAU;
export const polar = (x, z) => ({ a: wrapA(Math.atan2(z, x)), r: Math.hypot(x, z) });
export const at = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];

/** Circular gaussian smoothing of arr over the indices where mask is set (others untouched). */
function smoothRuns(arr, runs, sigma) {
  const out = Float32Array.from(arr);
  const w = Math.ceil(sigma * 2.5);
  const g = []; for (let d = -w; d <= w; d++) g.push(Math.exp(-(d * d) / (2 * sigma * sigma)));
  for (const run of runs) {
    for (let k = run.k0; k <= run.k1; k++) {
      let s = 0, n = 0;
      for (let d = -w; d <= w; d++) {
        // reflect at the run's ends so the ends keep their own values
        let q = k + d;
        if (q < run.k0) q = 2 * run.k0 - q;
        if (q > run.k1) q = 2 * run.k1 - q;
        q = Math.max(run.k0, Math.min(run.k1, q));
        s += arr[q % RIM_N] * g[d + w]; n += g[d + w];
      }
      out[k % RIM_N] = s / n;
    }
  }
  return out;
}

/**
 * Survey the rim. ground(x, z) = the terrain height the city is planned on. Returns (and keeps)
 * { rIn, rOut, spine, w, runs, ... } with every array indexed by bearing (RIM_N round the ring).
 */
export function surveyRim(ground) {
  if (FRAME && FRAME_GROUND === ground) return FRAME;
  const N = RIM_N;
  const rIn = new Float32Array(N), rOut = new Float32Array(N), hMax = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const a = aOf(k), c = Math.cos(a), s = Math.sin(a);
    let best = null, cur = null;
    for (let r = R0; r <= R1; r += DR) {
      const h = ground(c * r, s * r);
      if (h > 0) { if (!cur) cur = { a: r, b: r, h }; cur.b = r; cur.h = Math.max(cur.h, h); }
      else if (cur) { if (!best || cur.b - cur.a > best.b - best.a) best = cur; cur = null; }
    }
    if (cur && (!best || cur.b - cur.a > best.b - best.a)) best = cur;
    if (best && best.b - best.a > 60) {
      // refine both shores to a few centimetres
      const edge = (lo, hi) => { for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if ((ground(c * m, s * m) > 0) === (ground(c * lo, s * lo) > 0)) lo = m; else hi = m; } return (lo + hi) / 2; };
      rIn[k] = edge(best.a - DR, best.a); rOut[k] = edge(best.b, best.b + DR); hMax[k] = best.h;
    }
  }
  // the ring proper: bearings with at least 160 m of land across, in runs over a kilometre long
  const land = new Uint8Array(N);
  for (let k = 0; k < N; k++) land[k] = rOut[k] - rIn[k] > 160 ? 1 : 0;
  let start = land.indexOf(0);
  const runs = [];
  if (start < 0) runs.push({ k0: 0, k1: N - 1, loop: true });
  else {
    let cur = null;
    for (let j = 1; j <= N; j++) {
      const k = start + j;
      if (land[k % N]) { if (!cur) cur = { k0: k, k1: k }; else cur.k1 = k; } else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
  }
  const kept = runs.filter((r) => ((r.k1 - r.k0) / N) * TAU * 5900 > 1000);
  for (const r of kept) { r.a0 = aOf(r.k0); r.a1 = aOf(r.k1); }
  // the spine: the band's middle, smoothed over ~250 m, then kept at least 70 m inside each shore
  const mid = new Float32Array(N);
  for (let k = 0; k < N; k++) mid[k] = (rIn[k] + rOut[k]) / 2;
  let spine = smoothRuns(mid, kept, 14);
  for (const r of kept) for (let k = r.k0; k <= r.k1; k++) {
    const q = k % N, m = Math.min(70, (rOut[q] - rIn[q]) / 2 - 10);
    spine[q] = Math.max(rIn[q] + m, Math.min(rOut[q] - m, spine[q]));
  }
  spine = smoothRuns(spine, kept, 5);
  FRAME = { N, rIn, rOut, hMax, spine, runs: kept, land, ground };
  FRAME_GROUND = ground;
  return FRAME;
}

/** Linear interpolation of a frame array at bearing a. */
export function sampleAt(arr, a) {
  const f = kOf(a), k = Math.floor(f), t = f - k;
  return arr[k % RIM_N] * (1 - t) + arr[(k + 1) % RIM_N] * t;
}

/** The run a bearing lies in (runs may wrap past TAU: their k1 can exceed RIM_N), or null. */
export function runAt(frame, a) {
  const k = kOf(a);
  for (const r of frame.runs) if ((k >= r.k0 && k <= r.k1) || (k + RIM_N >= r.k0 && k + RIM_N <= r.k1)) return r;
  return null;
}

/** Unwrap bearing a into run r's own angular range (a0 <= a <= a1, with a1 possibly > TAU). */
export function inRun(r, a) {
  let x = wrapA(a);
  if (x < r.a0 - 1e-9) x += TAU;
  return x;
}
