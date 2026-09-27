// Quality presets. "Ultra" is tuned for Apple M-series Pro/Max GPUs.
export const PRESETS = {
  low: { label: 'Low', pixelRatio: 0.75, msaa: 0, shadows: false, shadowSize: 1024, reflections: false, reflectionScale: 0.25, trees: 0.35, traffic: 0.4, particles: 0.4, bloom: true, rays: false, lowrise: 0.5, people: false, minScale: 0.6 },
  medium: { label: 'Medium', pixelRatio: 1.0, msaa: 2, shadows: true, shadowSize: 2048, reflections: false, reflectionScale: 0.35, trees: 0.6, traffic: 0.7, particles: 0.7, bloom: true, rays: true, lowrise: 0.75, people: true, minScale: 0.55 },
  high: { label: 'High', pixelRatio: 1.25, msaa: 4, shadows: true, shadowSize: 4096, reflections: true, reflectionScale: 0.4, trees: 0.85, traffic: 1.0, particles: 1.0, bloom: true, rays: true, lowrise: 1.0, people: true, minScale: 0.5 },
  ultra: { label: 'Ultra', pixelRatio: 2.0, msaa: 4, shadows: true, shadowSize: 4096, reflections: true, reflectionScale: 0.5, trees: 1.0, traffic: 1.0, particles: 1.0, bloom: true, rays: true, lowrise: 1.0, people: true, minScale: 0.45 },
};

// ------------------------------------------------------------------------
// GPU detection. Reads the unmasked renderer string from a throwaway WebGL2
// context (released immediately) and maps it to a starting preset. The
// dynamic-resolution controller in core/perf.js corrects from there.
// ------------------------------------------------------------------------
let gpuInfo = null;

export function detectGPU() {
  if (gpuInfo) return gpuInfo;
  gpuInfo = { renderer: '', vendor: '', preset: null, reason: 'unknown GPU' };
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: false, powerPreference: 'high-performance' });
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      gpuInfo.renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
      gpuInfo.vendor = String(gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR) || '');
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (e) { /* no probe available */ }
  const r = gpuInfo.renderer;
  const pick = (preset, reason) => { gpuInfo.preset = preset; gpuInfo.reason = reason; };
  let m;
  if (/SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic/i.test(r)) pick('low', 'software renderer');
  else if ((m = r.match(/Apple M(\d+)\s*(Pro|Max|Ultra)?/i))) {
    const gen = parseInt(m[1], 10), tier = (m[2] || '').toLowerCase();
    if (tier === 'max' || tier === 'ultra') pick('ultra', `Apple M${gen} ${m[2]}`);
    else if (tier === 'pro') pick('high', `Apple M${gen} Pro`);
    else pick('high', `Apple M${gen}`);
  } else if (/Apple A\d+|Mali|Adreno|PowerVR|Immortalis|Xclipse/i.test(r)) pick('low', 'mobile GPU');
  else if (/Apple GPU/i.test(r)) pick(isMobile() ? 'low' : 'high', 'Apple GPU');
  else if ((m = r.match(/RTX\s*(\d{2})(\d{2})/i))) pick(parseInt(m[1], 10) >= 30 ? 'ultra' : 'high', `NVIDIA RTX ${m[1]}${m[2]}`);
  else if (/RTX|Quadro|A\d000/i.test(r)) pick('high', 'NVIDIA RTX');
  else if (/GTX\s*16|GTX\s*10/i.test(r)) pick('medium', 'NVIDIA GTX');
  else if ((m = r.match(/Radeon\s*(RX\s*)?(\d{4})/i))) pick(parseInt(m[2], 10) >= 6000 ? 'ultra' : 'high', `AMD Radeon ${m[2]}`);
  else if (/Radeon Pro|Radeon\(TM\) Graphics|Vega/i.test(r)) pick('medium', 'AMD integrated');
  else if (/Arc/i.test(r)) pick('high', 'Intel Arc');
  else if (/Iris|Xe/i.test(r)) pick('medium', 'Intel Iris Xe');
  else if (/Intel|UHD|HD Graphics/i.test(r)) pick('low', 'Intel integrated');
  return gpuInfo;
}

function isMobile() {
  try { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900); } catch (e) { return false; }
}

export function detectPreset() {
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (q && PRESETS[q]) return q;
    const saved = localStorage.getItem('meridian.quality');
    if (saved && PRESETS[saved]) return saved;
  } catch (e) { /* storage may be unavailable */ }
  const gpu = detectGPU();
  if (gpu.preset) return gpu.preset;
  if (isMobile()) return 'low';
  return 'high';
}

// ------------------------------------------------------------------------
// Viewer preferences (persisted). Every access is wrapped: storage can be
// blocked, full, or throw in private windows and sandboxed frames.
// ------------------------------------------------------------------------
export const PREF_DEFAULTS = {
  sensitivity: 1.0,        // mouse / touch look multiplier
  invertY: false,
  volume: 0.8,             // master volume 0..1
  music: 0.7,              // generative score level relative to ambience
  audio: false,            // remembered choice; still needs a gesture to start
  clouds: true,
  stats: false,            // FPS / GPU overlay
  letterbox: true,         // cinematic bars during the intro and tour
  subtitles: true,         // tour narration
  motion: 'auto',          // 'auto' follows prefers-reduced-motion, or 'reduce' / 'full'
  lock: false,             // pointer lock while flying
  flowSpeed: 0.0166,       // game hours per real second when time flows
  touchUI: 'auto',         // 'auto' | 'on' | 'off'
  seenIntro: false,
};

const PREF_KEY = 'meridian.prefs';

export function loadPrefs() {
  const p = { ...PREF_DEFAULTS };
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const k of Object.keys(PREF_DEFAULTS)) if (saved && typeof saved[k] === typeof PREF_DEFAULTS[k]) p[k] = saved[k];
    }
  } catch (e) { /* ignore */ }
  return p;
}

export function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
}
