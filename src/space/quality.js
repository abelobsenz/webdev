// Orbital-view quality, keyed by the app's preset name (src/core/settings.js).
// Kept separate from PRESETS so the shared settings file stays untouched.
export const SPACE_QUALITY = {
  low: { cube: 512, cloudCube: 512, earthQ: 0, atmoSteps: 5, bhSteps: 70, bhScale: 0.5, bhQ: 0, traffic: 3000, climbers: 120, ringSegs: 0.5, swarm: 6000 },
  medium: { cube: 768, cloudCube: 768, earthQ: 1, atmoSteps: 7, bhSteps: 110, bhScale: 0.6, bhQ: 1, traffic: 8000, climbers: 220, ringSegs: 0.75, swarm: 14000 },
  high: { cube: 1024, cloudCube: 1024, earthQ: 2, atmoSteps: 9, bhSteps: 160, bhScale: 0.75, bhQ: 2, traffic: 16000, climbers: 320, ringSegs: 1, swarm: 24000 },
  ultra: { cube: 1536, cloudCube: 1024, earthQ: 3, atmoSteps: 12, bhSteps: 260, bhScale: 1.0, bhQ: 3, traffic: 24000, climbers: 320, ringSegs: 1, swarm: 40000 },
};

export function spaceQuality(key) { return SPACE_QUALITY[key] || SPACE_QUALITY.high; }
