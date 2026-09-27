// Quality presets. "Max" is the default on Apple M3/M4 Pro and Max GPUs.
export const PRESETS = {
  low: { label: 'Low', grass: 0, pixelRatio: 0.75, msaa: 0, shadows: false, shadowSize: 1024, reflections: false, reflectionScale: 0.25, trees: 0.35, traffic: 0.4, particles: 0.4, bloom: true, rays: false, lowrise: 0.5, people: false, minScale: 0.6,
    clouds: 'impostor', cloudScale: 0.5, refraction: false, shafts: false, fxaa: false, ao: false },
  medium: { label: 'Medium', grass: 0.6, pixelRatio: 1.0, msaa: 2, shadows: true, shadowSize: 2048, reflections: false, reflectionScale: 0.35, trees: 0.6, traffic: 0.7, particles: 0.7, bloom: true, rays: true, lowrise: 0.75, people: true, minScale: 0.55,
    clouds: 'volumetric', cloudScale: 0.38, cloudSteps: 48, cloudLightSteps: 4, cloudDetailDist: 9000, refraction: false, shafts: true, fxaa: false, ao: true },
  high: { label: 'High', grass: 1.0, pixelRatio: 1.25, msaa: 4, shadows: true, shadowSize: 4096, reflections: true, reflectionScale: 0.4, trees: 0.85, traffic: 1.0, particles: 1.0, bloom: true, rays: true, lowrise: 1.0, people: true, minScale: 0.5,
    clouds: 'volumetric', cloudScale: 0.42, cloudSteps: 56, cloudLightSteps: 5, cloudDetailDist: 14000, refraction: true, shafts: true, fxaa: true, ao: true, reflectionClouds: true },
  ultra: { label: 'Ultra', grass: 1.25, pixelRatio: 2.0, msaa: 4, shadows: true, shadowSize: 4096, reflections: true, reflectionScale: 0.6, trees: 1.0, traffic: 1.0, particles: 1.0, bloom: true, rays: true, lowrise: 1.0, people: true, minScale: 0.7, treeNear: 420, lowriseNear: 1100,
    clouds: 'volumetric', cloudScale: 0.45, cloudSteps: 96, cloudLightSteps: 6, cloudDetailDist: 20000, refraction: true, shafts: true, fxaa: true, ao: true, reflectionClouds: true },
  // Max: the real-time top tier. Never renders below the display's native resolution
  // (supersampled on 1x screens), MSAA + contrast-adaptive sharpening instead of FXAA,
  // 8K shadows, near full-resolution reflections and clouds, long detail distances.
  max: { label: 'Max', grass: 1.5, pixelRatio: 2.0, supersample: true, msaa: 4, shadows: true, shadowSize: 8192, reflections: true, reflectionScale: 0.85, trees: 1.0, traffic: 1.0, particles: 1.0, bloom: true, rays: true, lowrise: 1.0, people: true, minScale: 1.0,
    clouds: 'volumetric', cloudScale: 0.62, cloudSteps: 112, cloudLightSteps: 8, cloudDetailDist: 26000, refraction: true, shafts: true, fxaa: false, sharpen: 0.35, ao: true, reflectionClouds: true,
    treeNear: 560, lowriseNear: 1500, caScale: 0.35 },
  // Above Max: supersampled beyond native for smoother edges and finer texture.
  cinematic: { label: 'Cinematic', grass: 1.8, pixelRatio: 2.5, supersample: true, msaa: 4, shadows: true, shadowSize: 8192, reflections: true, reflectionScale: 0.9, trees: 1.0, traffic: 1.0, particles: 1.0, bloom: true, rays: true, lowrise: 1.0, people: true, minScale: 0.85,
    clouds: 'volumetric', cloudScale: 0.66, cloudSteps: 128, cloudLightSteps: 8, cloudDetailDist: 28000, refraction: true, shafts: true, fxaa: false, sharpen: 0.25, ao: true, reflectionClouds: true,
    treeNear: 700, lowriseNear: 1900, caScale: 0.5 },
  // Reference: for stills and slow flights. 3x supersampled, full-resolution clouds and
  // reflections, everything at its highest detail everywhere; frame rate is not a goal.
  reference: { label: 'Reference', grass: 2.2, pixelRatio: 3.0, supersample: true, msaa: 4, shadows: true, shadowSize: 8192, reflections: true, reflectionScale: 1.0, trees: 1.0, traffic: 1.0, particles: 1.0, bloom: true, rays: true, lowrise: 1.0, people: true, minScale: 1.0,
    clouds: 'volumetric', cloudScale: 0.85, cloudSteps: 192, cloudLightSteps: 10, cloudDetailDist: 36000, refraction: true, shafts: true, fxaa: false, sharpen: 0.15, ao: true, reflectionClouds: true,
    treeNear: 900, lowriseNear: 3000, caScale: 0.5 },
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
    if (tier === 'max' || tier === 'ultra' || tier === 'pro') pick(gen >= 3 ? 'max' : 'ultra', `Apple M${gen} ${m[2]}`);
    else pick('high', `Apple M${gen}`);
  } else if (/Apple A\d+|Mali|Adreno|PowerVR|Immortalis|Xclipse/i.test(r)) pick('low', 'mobile GPU');
  else if (/Apple GPU/i.test(r)) pick(isMobile() ? 'low' : 'ultra', 'Apple GPU');
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
