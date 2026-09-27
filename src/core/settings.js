// Quality presets. "Ultra" is tuned for Apple M-series Pro/Max GPUs.
export const PRESETS = {
  low: { label: 'Low', pixelRatio: 0.75, msaa: 0, shadows: false, shadowSize: 1024, reflections: false, reflectionScale: 0.25, trees: 0.35, traffic: 0.4, particles: 0.4, bloom: true, rays: false, lowrise: 0.5, people: false,
    clouds: 'impostor', cloudScale: 0.5, refraction: false, shafts: false, fxaa: false, ao: false },
  medium: { label: 'Medium', pixelRatio: 1.0, msaa: 2, shadows: true, shadowSize: 2048, reflections: false, reflectionScale: 0.35, trees: 0.6, traffic: 0.7, particles: 0.7, bloom: true, rays: true, lowrise: 0.75, people: true,
    clouds: 'volumetric', cloudScale: 0.38, cloudSteps: 48, cloudLightSteps: 4, cloudDetailDist: 9000, refraction: false, shafts: true, fxaa: false, ao: true },
  high: { label: 'High', pixelRatio: 1.25, msaa: 4, shadows: true, shadowSize: 4096, reflections: true, reflectionScale: 0.4, trees: 0.85, traffic: 1.0, particles: 1.0, bloom: true, rays: true, lowrise: 1.0, people: true,
    clouds: 'volumetric', cloudScale: 0.42, cloudSteps: 56, cloudLightSteps: 5, cloudDetailDist: 14000, refraction: true, shafts: true, fxaa: true, ao: true },
  ultra: { label: 'Ultra', pixelRatio: 2.0, msaa: 4, shadows: true, shadowSize: 4096, reflections: true, reflectionScale: 0.5, trees: 1.0, traffic: 1.0, particles: 1.0, bloom: true, rays: true, lowrise: 1.0, people: true,
    clouds: 'volumetric', cloudScale: 0.4, cloudSteps: 96, cloudLightSteps: 6, cloudDetailDist: 20000, refraction: true, shafts: true, fxaa: true, ao: true },
};

export function detectPreset() {
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (q && PRESETS[q]) return q;
    const saved = localStorage.getItem('meridian.quality');
    if (saved && PRESETS[saved]) return saved;
  } catch (e) { /* storage may be unavailable */ }
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900);
  if (mobile) return 'low';
  return 'high';
}
