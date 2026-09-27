import * as THREE from 'three';
import { U } from './uniforms.js';
import { sunTransmittance } from '../sky/atmosphere.js';

const _c = new THREE.Color();
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

/**
 * Sun / moon directional lights, a camera-following shadow frustum and the
 * image-based ambient (PMREM of the sky scene, refreshed as the sun moves).
 */
export class Lighting {
  constructor(renderer, scene, settings) {
    this.renderer = renderer;
    this.scene = scene;
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = settings.shadows;
    this.sun.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 1.2;
    this.sun.shadow.radius = 2;
    const sc = this.sun.shadow.camera;
    sc.near = 10; sc.far = 16000;
    this.shadowExtent = 1800;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.moon = new THREE.DirectionalLight(0x9fb8ff, 0);
    scene.add(this.moon);
    this.hemi = new THREE.HemisphereLight(0x8fb4ff, 0x2a3a2a, 0);
    scene.add(this.hemi);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvSun = new THREE.Vector3(0, -2, 0);
    this.envTimer = 0;
    this.sunVisibility = 1;
  }

  setShadowQuality(enabled, size) {
    this.sun.castShadow = enabled;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  update(dt, camera, sunDir, moonDir) {
    const sunY = sunDir.y;
    sunTransmittance(sunY, Math.max(camera.position.y * 0.001, 0.02), _c);
    // Keep a little light slightly below the horizon (atmospheric refraction / twilight)
    const horizon = smooth(-0.035, 0.02, sunY);
    U.uSunColor.value.copy(_c).multiplyScalar(horizon);
    const E = U.uSunIlluminance.value;
    this.sun.color.copy(_c);
    this.sun.intensity = E * horizon * 0.95;
    this.sunVisibility = horizon;

    // shadow frustum follows the camera focus, snapped to texels to avoid shimmering
    const alt = Math.max(camera.position.y, 10);
    const extent = THREE.MathUtils.clamp(900 + alt * 1.6, 1200, 7000);
    this.shadowExtent += (extent - this.shadowExtent) * Math.min(1, dt * 2);
    const ext = this.shadowExtent;
    const sc = this.sun.shadow.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    fwd.y = 0; if (fwd.lengthSq() > 0) fwd.normalize();
    const focus = camera.position.clone().addScaledVector(fwd, ext * 0.45);
    focus.y = 0;
    const lightDir = sunY > 0.02 ? sunDir : new THREE.Vector3(sunDir.x, 0.02, sunDir.z).normalize();
    // texel snapping in light space
    const texel = (2 * ext) / this.sun.shadow.mapSize.x;
    const lightRot = new THREE.Matrix4().lookAt(lightDir, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    const inv = lightRot.clone().invert();
    const lp = focus.clone().applyMatrix4(inv);
    lp.x = Math.round(lp.x / texel) * texel;
    lp.y = Math.round(lp.y / texel) * texel;
    focus.copy(lp.applyMatrix4(lightRot));
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(lightDir, 8000);
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
    sc.near = 100; sc.far = 8000 + ext * 1.5;
    sc.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();

    // moonlight
    const moonUp = smooth(-0.02, 0.15, moonDir.y);
    const night = U.uNight.value;
    this.moon.position.copy(moonDir).multiplyScalar(5000);
    this.moon.intensity = moonUp * night * 0.09;

    // hemisphere fill: sky light from above is in the env map; this adds the
    // bounce from the sunlit lagoon onto down-facing surfaces
    const up = Math.max(sunY, 0);
    this.hemi.color.setRGB(0.05, 0.07, 0.1);
    this.hemi.groundColor.setRGB(0.26, 0.34, 0.32).multiply(_c);
    this.hemi.intensity = 0.02 + night * 0.04 + E * horizon * (0.05 + 0.1 * up);
  }

  /** Re-generate the IBL environment from the sky scene when the sun has moved enough. */
  updateEnvironment(skyScene, sunDir, dt, force = false, skyDomeMat = null) {
    this.envTimer += dt;
    const moved = this.lastEnvSun.angleTo(sunDir);
    if (!force && (moved < 0.004 || this.envTimer < 0.25)) return;
    this.envTimer = 0;
    this.lastEnvSun.copy(sunDir);
    if (skyDomeMat) skyDomeMat.uniforms.uEnvMode.value = 1;
    const rt = this.pmrem.fromScene(skyScene, 0.0, 0.5, 2.0e6, { size: 128 });
    if (skyDomeMat) skyDomeMat.uniforms.uEnvMode.value = 0;
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
  }
}
