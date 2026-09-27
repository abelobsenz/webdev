import * as THREE from 'three';
import './style.css';
import { U } from './core/uniforms.js';
import { PRESETS, detectPreset } from './core/settings.js';
import { computeSky } from './core/sun.js';
import { FlyControls } from './core/controls.js';
import { Lighting } from './core/lighting.js';
import { Atmosphere } from './sky/atmosphere.js';
import { createSkyDome } from './sky/skyDome.js';
import { Celestial } from './sky/celestial.js';
import { Pipeline } from './post/pipeline.js';
import { World } from './world/world.js';
import { UI } from './ui/ui.js';
import { POIS } from './ui/pois.js';
import { AmbientAudio } from './ui/audio.js';
import { PerfManager } from './core/perf.js';            // [experience] GPU timing + dynamic resolution
import { loaderProgress, nextPaint } from './ui/loader.js'; // [experience] loader stages

const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const params = new URLSearchParams(location.search);

class App {
  constructor() {
    this.presetKey = detectPreset();
    this.settings = { ...PRESETS[this.presetKey] };
    this.canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: true, preserveDrawingBuffer: params.has('capture') });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = false;

    this.hours = params.has('t') ? parseFloat(params.get('t')) : 17.55;
    this.timeSpeed = 0;            // game-hours per real second
    this.clock = new THREE.Timer();
    this.elapsed = 0;
    this.skyState = { sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), celestial: new THREE.Matrix3() };

    // Scenes & cameras ------------------------------------------------------
    this.scene = new THREE.Scene();
    this.skyScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 1.0, 60000);
    this.camera.layers.enable(1);
    this.skyCamera = new THREE.PerspectiveCamera(60, 1, 8, 2.5e6);

    this.atmosphere = new Atmosphere(this.renderer);
    this.atmosphere.precompute();
    this.skyDome = createSkyDome();
    this.skyScene.add(this.skyDome);
    this.celestial = new Celestial();
    this.skyScene.add(this.celestial.group);

    this.pipeline = new Pipeline(this.renderer, this.settings);
    this.scene.add(this.pipeline.backdrop);
    this.lighting = new Lighting(this.renderer, this.scene, this.settings);

    this.frameTimes = [];
    this.dynScale = 1;
    this.lastResize = 0;
  }

  async init(progress) {
    this.world = new World(this);
    await this.world.build(progress);
    this.controls = new FlyControls(this.camera, this.canvas, {
      groundHeight: (x, z) => this.world.groundHeight(x, z),
      colliders: this.world.colliders,
    });
    this.controls.wantLock = false;
    this.audio = new AmbientAudio();
    // [experience] performance manager: measures GPU time per frame (EXT_disjoint_timer_query_webgl2)
    // and drives dynamic resolution with hysteresis. It wraps frame() so the timer spans all GPU work.
    this.perf = new PerfManager(this);
    { const frame = this.frame.bind(this); this.frame = (dt) => { this.perf.begin(); frame(dt); this.perf.end(); }; }
    this.ui = new UI(this);
    const start = POIS[0];
    if (params.has('cam')) {
      const [x, y, z, yaw, pitch] = params.get('cam').split(',').map(Number);
      this.controls.setPose(new THREE.Vector3(x, y, z), THREE.MathUtils.degToRad(yaw), THREE.MathUtils.degToRad(pitch));
    } else {
      this.controls.setPose(start.view.clone(), 0, 0);
      this.controls.lookAt(start.target);
    }
    if (params.has('fov')) { this.controls.baseFov = this.controls.fov = parseFloat(params.get('fov')); }
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.updateSky(0);
    this.lighting.updateEnvironment(this.skyScene, this.skyState.sunDir, 0, true, this.skyDome.material);
    // warm up shader programs to avoid hitches on first view
    progress(0.95, 'Compiling light and materials'); await nextPaint(); // [experience] show the last loader stage
    try { this.renderer.compile(this.scene, this.camera); this.renderer.compile(this.skyScene, this.skyCamera); } catch (e) { /* optional */ }
    if (params.has('capture')) {
      // deterministic stepping for automated captures
      this.step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) this.frame(dt); this.renderer.getContext().finish(); };
    } else {
      this.renderer.setAnimationLoop(() => this.frame());
    }
  }

  applyPreset(key) {
    this.presetKey = key;
    this.settings = { ...PRESETS[key] };
    try { localStorage.setItem('meridian.quality', key); } catch (e) { /* ignore */ }
    this.pipeline.setMSAA(this.settings.msaa);
    this.lighting.setShadowQuality(this.settings.shadows, this.settings.shadowSize);
    this.world.applyQuality(this.settings);
    this.dynScale = 1;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.settings.pixelRatio) * this.dynScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const bw = Math.floor(w * pr), bh = Math.floor(h * pr);
    this.pipeline.setSize(bw, bh);
    this.world.setSize(bw, bh);
    this.celestial.setResolution(bw, bh);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.lastResize = performance.now();
  }

  updateSky(dt) {
    computeSky(this.hours, this.skyState);
    const sun = this.skyState.sunDir, moon = this.skyState.moonDir;
    U.uSunDir.value.copy(sun);
    U.uMoonDir.value.copy(moon);
    const night = 1 - smooth(-0.16, 0.02, sun.y);
    U.uNight.value = night;
    // city lights ramp on through dusk, dim a little in the small hours
    const h = this.hours;
    const lateNight = (h > 1.5 && h < 5.0) ? 0.75 : 1.0;
    U.uCityLights.value = smooth(0.12, -0.06, sun.y) * lateNight;
    this.skyDome.material.uniforms.uCelestial.value.copy(this.skyState.celestial);
    this.skyDome.material.uniforms.uStarBoost.value = smooth(-0.07, -0.22, sun.y);
  }

  exposureFor(sunY, alt) {
    // Analytic exposure curve (EV-like): bright day → deep night
    const day = smooth(-0.16, 0.14, sunY);
    const twilight = smooth(-0.22, 0.0, sunY);
    const ev = THREE.MathUtils.lerp(3.0, 0.0, day) + (1 - twilight) * 0.8;
    return 0.6 * Math.pow(2, ev);
  }

  frame(fixedDt) {
    this.clock.update();
    let dt = fixedDt ?? Math.min(this.clock.getDelta(), 0.1);
    this.elapsed += dt;
    U.uTime.value = this.elapsed;
    this.hours = (this.hours + this.timeSpeed * dt + 24) % 24;

    this.controls.update(dt);
    // adapt clip planes: keep depth precision when flying high above the city
    {
      const alt = this.camera.position.y;
      const near = THREE.MathUtils.clamp((alt - 3400) * 0.03, 1, 700);
      const far = Math.max(60000, alt * 4);
      if (Math.abs(near - this.camera.near) > 0.5 || far !== this.camera.far) {
        this.camera.near = near; this.camera.far = far;
        this.camera.updateProjectionMatrix();
      }
    }
    this.camera.updateMatrixWorld();
    this.updateSky(dt);

    const cam = this.camera;
    U.uCameraAltitude.value = cam.position.y;
    this.skyCamera.position.copy(cam.position).multiplyScalar(0.001);
    this.skyCamera.quaternion.copy(cam.quaternion);
    this.skyCamera.fov = cam.fov; this.skyCamera.aspect = cam.aspect;
    this.skyCamera.updateProjectionMatrix();
    this.skyCamera.updateMatrixWorld();
    this.celestial.update(this.skyCamera.position, this.skyState.moonDir);

    this.atmosphere.update(this.skyState.sunDir, cam.position.y);
    this.lighting.update(dt, cam, this.skyState.sunDir, this.skyState.moonDir);
    this.lighting.updateEnvironment(this.skyScene, this.skyState.sunDir, dt, false, this.skyDome.material);
    this.world.update(dt, this.elapsed);

    this.render(dt);
    if (this.ui) this.ui.update(dt);
    this.adaptResolution(dt);
  }

  render(dt) {
    const r = this.renderer;
    const p = this.pipeline;
    r.info.reset();
    // 1. planar reflections (uses last frame's shadow map, so skip until it exists)
    if (!this.settings.shadows || this.lighting.sun.shadow.map) this.world.renderReflections(r, this.camera, this.skyScene, this.skyCamera);
    // 2. sky (km scale)
    r.setRenderTarget(p.skyRT);
    r.clear();
    r.render(this.skyScene, this.skyCamera);
    // 3. world (metres) into the MSAA HDR target
    r.shadowMap.needsUpdate = this.settings.shadows;
    r.setRenderTarget(p.hdrRT);
    r.clear();
    r.render(this.scene, this.camera);
    // 4. post
    const exposure = this.exposureFor(this.skyState.sunDir.y, this.camera.position.y);
    p.finalMat.uniforms.uExposure.value = exposure;
    p.downMat.uniforms.uThreshold.value = 1.1 / exposure;
    p.downMat.uniforms.uKnee.value = 0.7 / exposure;
    p.finalMat.uniforms.uTime.value = this.elapsed;
    p.renderBloom();
    this.updateGrade();
    // sun rays
    const sunW = this.skyState.sunDir.clone().multiplyScalar(1e5).add(this.camera.position);
    const sp = sunW.project(this.camera);
    const sunUV = new THREE.Vector2(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    const inFront = sp.z < 1 && sp.z > -1;
    const onScreen = inFront ? Math.max(0, 1 - Math.max(Math.abs(sp.x), Math.abs(sp.y)) * 0.6) : 0;
    const raysStrength = this.settings.rays ? onScreen * smooth(-0.06, 0.05, this.skyState.sunDir.y) * (1 - smooth(0.25, 0.7, this.skyState.sunDir.y) * 0.6) * 0.55 : 0;
    p.finalMat.uniforms.uRaysColor.value.copy(U.uSunColor.value).multiplyScalar(1.0);
    p.renderRays(sunUV, raysStrength);
    p.finalMat.uniforms.uFlare.value = this.settings.bloom ? 0.012 * onScreen : 0;
    p.composite();
  }

  updateGrade() {
    const f = this.pipeline.finalMat.uniforms;
    const sy = this.skyState.sunDir.y;
    const golden = smooth(0.35, 0.05, sy) * smooth(-0.1, 0.03, sy);
    const night = U.uNight.value;
    // warm highlights at golden hour, cool lift at night
    f.uGain.value.set(1.0 + golden * 0.06, 1.0, 1.0 - golden * 0.06);
    f.uLift.value.set(0.0, 0.0015 * night, 0.004 * night);
    f.uSaturation.value = 1.12 + golden * 0.08 - night * 0.1;
    f.uContrast.value = 1.06;
    f.uBloom.value = this.settings.bloom ? 0.035 + night * 0.025 : 0;
  }

  adaptResolution(dt) {
    if (this.perf) { this.perf.adapt(dt); return; } // [experience] see src/core/perf.js
    if (params.has('capture')) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const now = performance.now();
    if (now - this.lastResize < 3000 || document.hidden) return;
    const target = 1 / 58;
    if (avg > target * 1.18 && this.dynScale > 0.55) { this.dynScale = Math.max(0.55, this.dynScale * 0.87); this.resize(); }
    else if (avg < target * 0.8 && this.dynScale < 1) { this.dynScale = Math.min(1, this.dynScale * 1.1); this.resize(); }
  }
}

// ----------------------------------------------------------------- boot --
const loader = document.getElementById('loader');
const bar = document.getElementById('loader-bar');
const status = document.getElementById('loader-status');
function progress(p, msg) {
  if (bar) bar.style.transform = `scaleX(${p})`;
  if (status && msg) status.textContent = msg;
  loaderProgress(p); // [experience]
}

async function boot() {
  try {
    const app = new App();
    window.meridian = app;
    app.THREE = THREE;
    await app.init(progress);
    progress(1, 'Ready');
    document.body.classList.add('ready');
    if (params.has('capture')) document.body.classList.add('capture');
  } catch (err) {
    console.error(err);
    if (status) status.textContent = 'This browser could not start WebGL 2: ' + (err && err.message ? err.message : err);
    if (loader) loader.classList.add('error');
  }
}
boot();
