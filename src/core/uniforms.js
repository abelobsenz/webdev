import * as THREE from 'three';

/**
 * Uniforms shared by (almost) every material in the world. Materials receive
 * the *same* uniform objects, so updating `.value` here updates every shader.
 */
export const U = {
  uTime: { value: 0 },                       // seconds since start (animation clock)
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },    // direction *towards* the sun (world)
  uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },    // sun radiance reaching the ground (transmitted)
  uSunIlluminance: { value: 18.0 },          // scale applied to LUT radiance
  uSkyViewLUT: { value: null },              // atmosphere sky-view LUT (sampled for aerial perspective)
  uTransmittanceLUT: { value: null },
  uMultiScatLUT: { value: null },
  uNightAmbient: { value: new THREE.Color(0.004, 0.006, 0.012) },
  uNight: { value: 0 },                      // 0 = full day, 1 = deep night
  uCityLights: { value: 0 },                 // 0..1 how many artificial lights are on
  uHaze: { value: 1.0 },                     // aerosol density multiplier
  uCloudShadow: { value: 1.0 },              // enable cloud-shadow term
  uCloudOffset: { value: new THREE.Vector2(0, 0) },
  uCloudCoverage: { value: 0.26 },
  uCameraAltitude: { value: 0 },
  uWind: { value: new THREE.Vector2(0.8, 0.3) },
  // --- rendering agent: volumetric cloud shadow map (see src/life/clouds.js) ---
  uCloudShadowMap: { value: null },          // RGBA optical depth toward the light at 4 levels through the deck
  uCloudShadowRect: { value: new THREE.Vector4(0, 0, 1 / 24000, 0) }, // origin.xy (m), 1/size, valid
  uCloudLightDir: { value: new THREE.Vector3(0, 1, 0) },   // sun, or the moon once the deck is in earth shadow
};

/** Collect a subset of the shared uniforms plus material-specific ones. */
export function withShared(extra = {}) {
  return Object.assign({}, U, extra);
}
