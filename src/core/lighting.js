import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightShadow } from 'three/addons/lights/SunLightShadow.js';
import { U } from './uniforms.js';
import { sunTransmittance } from '../sky/atmosphere.js';

const _c = new THREE.Color();
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// --------------------------------------------------------------------------
// Two-cascade sun shadows. three's SunLight renders both cascades into one atlas
// and blends them in the standard lighting chunks; this subclass only replaces
// the split scheme: a tight near cascade (crisp contact shadows for people,
// trees and plinths) and a wide far cascade that reaches across the whole
// lagoon so every tower casts its golden-hour shadow in the hero views.
const _lightOrientationMatrix = new THREE.Matrix4();
const _viewToLightMatrix = new THREE.Matrix4();
const _lightDirection = new THREE.Vector3();
const _up = new THREE.Vector3();
const _center = new THREE.Vector3();
const _nearCorners = [0, 1, 2, 3].map(() => new THREE.Vector3());
const _farCorners = [0, 1, 2, 3].map(() => new THREE.Vector3());
const _cascadeCorners = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Vector3());
const CASCADES = 2;
const FADE = 0.12;

class MeridianSunShadow extends SunLightShadow {
  constructor() {
    super();
    this.splitDistance = 400;
  }

  updateMatrices(light, viewCamera) {
    if (viewCamera === undefined) return;
    const insetX = Math.min(0.25, (Math.ceil(this.radius) + 1) / this.mapSize.x);
    const insetY = Math.min(0.25, (Math.ceil(this.radius) + 1) / this.mapSize.y);
    for (let i = 0; i < CASCADES; i++) this._viewports[i].set(i + insetX, insetY, 1 - 2 * insetX, 1 - 2 * insetY);
    const resolutionX = this.mapSize.x * (1 - 2 * insetX);
    const resolutionY = this.mapSize.y * (1 - 2 * insetY);
    const resolution = Math.min(resolutionX, resolutionY);
    const camera = this.camera;
    const cameraNear = viewCamera.near;
    const cameraFar = Math.max(cameraNear + 1e-6, Math.min(camera.far, viewCamera.far));
    const splits = this._cascadeSplits;
    splits[0] = cameraNear;
    splits[1] = THREE.MathUtils.clamp(this.splitDistance, cameraNear + 1, cameraFar * 0.9);
    splits[2] = cameraFar;

    _lightDirection.setFromMatrixPosition(light.matrixWorld).negate().normalize();
    _up.set(0, 1, 0);
    if (Math.abs(_up.dot(_lightDirection)) > 0.99) _up.set(0, 0, 1);
    _lightOrientationMatrix.lookAt(_center.set(0, 0, 0), _lightDirection, _up);
    _viewToLightMatrix.copy(_lightOrientationMatrix).transpose().multiply(viewCamera.matrixWorld);
    const zNear = viewCamera.reversedDepth ? 1 : -1;
    const inverseProjectionMatrix = viewCamera.projectionMatrixInverse;
    let globalMaxZ = -Infinity;
    for (let i = 0; i < 4; i++) {
      const x = i === 0 || i === 1 ? 1 : -1;
      const y = i === 0 || i === 3 ? 1 : -1;
      const nearCorner = _nearCorners[i].set(x, y, zNear).applyMatrix4(inverseProjectionMatrix);
      const farCorner = _farCorners[i];
      farCorner.copy(nearCorner).multiplyScalar(cameraFar / cameraNear);
      nearCorner.applyMatrix4(_viewToLightMatrix);
      farCorner.applyMatrix4(_viewToLightMatrix);
      globalMaxZ = Math.max(globalMaxZ, nearCorner.z, farCorner.z);
    }
    // casters up to one shadow range toward the light still cast into the view
    globalMaxZ += Math.min(cameraFar, 12000);
    const shadowNear = camera.near;
    for (let i = 0; i < CASCADES; i++) {
      const cascadeNear = i === 0 ? splits[0] : this._cascadeData[i - 1].z;
      const cascadeFar = splits[i + 1];
      const fadeStart = cascadeFar - FADE * (cascadeFar - splits[i]);
      this._cascadeData[i].set(i === 0 ? -1e10 : cascadeNear, cascadeFar, fadeStart, 0);
      const nearAlpha = (cascadeNear - cameraNear) / (cameraFar - cameraNear);
      const farAlpha = (cascadeFar - cameraNear) / (cameraFar - cameraNear);
      _center.set(0, 0, 0);
      for (let j = 0; j < 4; j++) {
        _cascadeCorners[j * 2].lerpVectors(_nearCorners[j], _farCorners[j], nearAlpha);
        _cascadeCorners[j * 2 + 1].lerpVectors(_nearCorners[j], _farCorners[j], farAlpha);
        _center.add(_cascadeCorners[j * 2]).add(_cascadeCorners[j * 2 + 1]);
      }
      _center.multiplyScalar(1 / 8);
      let radiusSq = 0, minZ = Infinity;
      for (let j = 0; j < 8; j++) {
        radiusSq = Math.max(radiusSq, _cascadeCorners[j].distanceToSquared(_center));
        minZ = Math.min(minZ, _cascadeCorners[j].z);
      }
      let radius = Math.sqrt(radiusSq);
      if (resolution > 1) {
        radius /= 1 - 1 / resolution;
        const texelSizeX = 2 * radius / resolutionX;
        const texelSizeY = 2 * radius / resolutionY;
        _center.x = Math.round(_center.x / texelSizeX) * texelSizeX;
        _center.y = Math.round(_center.y / texelSizeY) * texelSizeY;
      }
      _center.z = globalMaxZ + shadowNear;
      _center.applyMatrix4(_lightOrientationMatrix);
      const cascadeCamera = this._cameras[i];
      cascadeCamera.position.copy(_center);
      cascadeCamera.quaternion.setFromRotationMatrix(_lightOrientationMatrix);
      cascadeCamera.left = -radius; cascadeCamera.right = radius;
      cascadeCamera.top = radius; cascadeCamera.bottom = -radius;
      cascadeCamera.near = shadowNear;
      cascadeCamera.far = globalMaxZ - minZ + 2 * shadowNear;
      cascadeCamera.coordinateSystem = camera.coordinateSystem;
      cascadeCamera._reversedDepth = camera.reversedDepth;
      cascadeCamera.updateProjectionMatrix();
      cascadeCamera.updateMatrixWorld();
      this._updateMatrix(cascadeCamera, this._matrices[i], this._frustums[i], this._viewports[i]);
    }
  }
}

/**
 * Sun / moon lights, two-cascade sun shadows and the image-based ambient
 * (PMREM of the sky scene, refreshed as the sun moves).
 */
export class Lighting {
  constructor(renderer, scene, settings) {
    this.renderer = renderer;
    this.scene = scene;
    // rendering agent: SunLight (cascaded shadow atlas) replaces the single-map DirectionalLight
    this.sun = new SunLight(0xffffff, 1);
    this.sun.shadow = new MeridianSunShadow();
    this.sun.castShadow = settings.shadows;
    this.cascadeSize = (size) => Math.min(4096, Math.round(size * 0.75));
    this.sun.shadow.mapSize.set(this.cascadeSize(settings.shadowSize), this.cascadeSize(settings.shadowSize));
    this.sun.shadow.bias = -0.00003;
    this.sun.shadow.normalBias = 0.9;
    this.sun.shadow.radius = 1.6;
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 8000;
    scene.add(this.sun);
    this.moon = new THREE.DirectionalLight(0x9fb8ff, 0);
    scene.add(this.moon);
    this.hemi = new THREE.HemisphereLight(0x8fb4ff, 0x2a3a2a, 0);
    scene.add(this.hemi);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvSun = new THREE.Vector3(0, -2, 0);
    this.envTimer = 0;
    this.sunVisibility = 1;
    this._dir = new THREE.Vector3();
  }

  setShadowQuality(enabled, size) {
    this.sun.castShadow = enabled;
    const cs = this.cascadeSize(size);
    if (this.sun.shadow.mapSize.x !== cs) {
      this.sun.shadow.mapSize.set(cs, cs);
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

    // light direction (kept a little above the horizon so shadow frusta stay sane)
    const lightDir = sunY > 0.03 ? this._dir.copy(sunDir) : this._dir.set(sunDir.x, 0.03, sunDir.z).normalize();
    this.sun.position.copy(lightDir);
    this.sun.updateMatrixWorld();
    // cascades: near split grows with altitude; the far cascade reaches across the lagoon
    const alt = Math.max(camera.position.y, 2);
    const sh = this.sun.shadow;
    sh.splitDistance = THREE.MathUtils.clamp(260 + alt * 0.9, 260, 4000);
    const far = THREE.MathUtils.clamp(9000 + alt * 2.2, 9000, 70000);
    if (Math.abs(sh.camera.far - far) > 50) { sh.camera.far = far; }

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
