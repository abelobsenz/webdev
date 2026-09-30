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
import { releaseStaticGeometry, releaseHeld, uploadAll } from './core/releaseCpu.js';
import { UI } from './ui/ui.js';
import { POIS } from './ui/pois.js';
import { AmbientAudio } from './ui/audio.js';
import { PerfManager } from './core/perf.js';            // [experience] GPU timing + dynamic resolution
import { loaderProgress, nextPaint } from './ui/loader.js'; // [experience] loader stages
// [space] orbital view (src/space): its own km-scale scene, entered by riding the tether
import { SpaceMode } from './space/index.js';
import { Pilot } from './core/pilot.js';

const SPACE_PIXEL_RATIO = 1.25;       // device pixels per CSS pixel in the orbital view (at most)

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
    // a new sky every visit: the cloud field starts at a seeded point in its 32 km weather tile
    // (?clouds=<seed> repeats one; captures stay on seed 0 so review shots are comparable)
    this.cloudSeed = params.has('clouds') ? (parseInt(params.get('clouds'), 10) >>> 0) : params.has('capture') ? 0 : (Math.random() * 1e9) >>> 0;
    {
      let s = this.cloudSeed || 0;
      const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      U.uCloudOffset.value.set(this.cloudSeed ? rnd() * 32000 : 0, this.cloudSeed ? rnd() * 32000 : 0);
    }
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
    // rendering agent: hook volumetric clouds / mid-frame depth capture into the main pass
    this.pipeline.attach(this.world, this.scene, this.camera, this.lighting.sun);
    // free the CPU copies of the city's large static geometry once uploaded (~4 GB of heap); the
    // collision grid reads its solids' positions after load, so those keep theirs
    const solids = (this.world.clearance && this.world.clearance.solids) || [];
    for (const o of solids) if (o.geometry) o.geometry.userData.cpuHold = true;
    this.cpuReleased = releaseStaticGeometry(this.scene);
    this.controls = new FlyControls(this.camera, this.canvas, {
      groundHeight: (x, z) => this.world.surfaceHeight(x, z),   // the drawn surface, outer land included
      colliders: this.world.colliders,
    });
    this.controls.wantLock = false;
    this.audio = new AmbientAudio();
    // [experience] performance manager: measures GPU time per frame (EXT_disjoint_timer_query_webgl2)
    // and drives dynamic resolution with hysteresis. It wraps frame() so the timer spans all GPU work.
    this.perf = new PerfManager(this);
    { const frame = this.frame.bind(this); this.frame = (dt) => { this.perf.begin(); frame(dt); this.perf.end(); }; }
    this.ui = new UI(this);
    // the collision grid is the solids' last CPU reader: release them when it has rasterised them
    if (this.ui.collision) this.ui.collision.onReady = () => { this.cpuReleased.heldFreed = releaseHeld(solids); };
    // the piloted aerodyne (V): built on first boarding
    this.pilot = new Pilot(this);
    // [space] orbital view (heavy resources are built on first use)
    this.space = new SpaceMode(this);
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
    // put every city mesh on the GPU now so the marked geometry drops its CPU copy at load
    try { uploadAll(this.renderer, this.scene, this.camera); } catch (e) { console.warn('uploadAll', e); }
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
    this.pipeline.applySettings(this.settings);   // rendering agent: cloud / post quality keys
    this.lighting.setShadowQuality(this.settings.shadows, this.settings.shadowSize);
    this.world.applyQuality(this.settings);
    if (this.space) this.space.applyQuality(this.settings); // [space]
    this.dynScale = 1;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // 'supersample' presets render above the display's native resolution (SSAA)
    const dpr = window.devicePixelRatio || 1;
    let base = this.settings.supersample ? Math.max(dpr, this.settings.pixelRatio) : Math.min(dpr, this.settings.pixelRatio);
    // the orbital view is shading-bound (the Moon's ground, the Earth's atmosphere and seas are
    // per-pixel ray casts behind 4x MSAA): at a retina display the top presets drew 5-6 million
    // pixels a frame there. It renders at most SPACE_PIXEL_RATIO device pixels per CSS pixel,
    // never supersampled, and the adaptive resolution may go lower (perf.js)
    if (this._spaceRes) base = Math.min(base, dpr, SPACE_PIXEL_RATIO);
    const pr = base * this.dynScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const bw = Math.floor(w * pr), bh = Math.floor(h * pr);
    this.pipeline.setSize(bw, bh);
    this.world.setSize(bw, bh);
    this.celestial.setResolution(bw, bh);
    if (this.space) this.space.setSize(bw, bh); // [space]
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

    // [space] the orbital view renders at its own resolution (see resize); switch it with the mode
    const inSpace = !!(this.space && this.space.onlySpace);
    if (inSpace !== !!this._spaceRes) { this._spaceRes = inSpace; this.resize(); }
    // [space] while the orbital view is up the city is not rendered at all
    if (this.space && this.space.onlySpace) { this.space.frame(dt); if (this.ui) this.ui.update(dt); this.adaptResolution(dt); return; }
    if (this.space && this.space.cityCam) this.space.driveCity(dt); // [space] ride up/down the tether
    else {
      if (!(this.pilot && this.pilot.active)) this.controls.update(dt);
      if (this.pilot) this.pilot.update(dt);    // flies the aerodyne (and the chase camera) or keeps it hovering, parked
    }
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
    if (this.space) this.space.afterCityCamera(this.camera); // [space]
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
    if (this.space) this.space.afterCityRender(dt); // [space] crossfade during the ride
    if (this.ui) this.ui.update(dt);
    this.adaptResolution(dt);
  }

  render(dt) {
    const r = this.renderer;
    const p = this.pipeline;
    r.info.reset();
    // the passes before the main render (reflection, cloud shadows) read camera.matrixWorld, which
    // renderer.render would only refresh later: without this the mirrored view lagged the camera by a
    // frame, and in flight the reflected shoreline slid against the real one and flickered
    this.camera.updateMatrixWorld();
    // 1. planar reflections (uses last frame's shadow map, so skip until it exists)
    p.timer.begin('reflections');   // rendering agent: optional GPU timings (?gpuprof)
    if (!this.settings.shadows || this.lighting.sun.shadow.map) this.world.renderReflections(r, this.camera, this.skyScene, this.skyCamera);
    // 2. sky (km scale)
    p.timer.begin('sky');
    r.setRenderTarget(p.skyRT);
    r.clear();
    r.render(this.skyScene, this.skyCamera);
    // 3. world (metres) into the MSAA HDR target. beginFrame (rendering agent) updates
    //    the cloud shadow map; clouds are marched + composited mid-pass (see Pipeline).
    p.timer.begin('cloudShadowMap');
    p.beginFrame(this.camera, this.skyState.sunDir, this.skyState.moonDir);
    p.timer.begin('scene:shadows+opaque');
    r.shadowMap.needsUpdate = this.settings.shadows;
    // casters whose shadow cannot reach the view skip the shadow pass (restored right after)
    if (this.settings.shadows) this.lighting.cullShadowCasters(this.scene, this.camera);
    r.setRenderTarget(p.hdrRT);
    r.clear();
    r.render(this.scene, this.camera);
    this.lighting.restoreShadowCasters();
    // 4. post
    const exposure = this.exposureFor(this.skyState.sunDir.y, this.camera.position.y);
    p.finalMat.uniforms.uExposure.value = exposure;
    p.downMat.uniforms.uThreshold.value = 1.1 / exposure;
    p.downMat.uniforms.uKnee.value = 0.7 / exposure;
    p.downMat.uniforms.uClamp.value = 6e4;
    p.finalMat.uniforms.uGlare.value.set(0, 0, 0); p.finalMat.uniforms.uGlareMask.value = 0;
    p.finalMat.uniforms.uTime.value = this.elapsed;
    p.renderBloom();
    // rendering agent: auto exposure adapts around the designed time-of-day curve
    // (snaps after teleports / time jumps so captures and the tour never pump)
    {
      const lp = this._lastExpPose || (this._lastExpPose = { pos: this.camera.position.clone(), h: this.hours });
      const jump = lp.pos.distanceTo(this.camera.position) > 300 || Math.abs(lp.h - this.hours) > 0.2;
      lp.pos.copy(this.camera.position); lp.h = this.hours;
      p.adaptMat.uniforms.uRange.value = 1.2;
      p.renderExposure(dt, (0.2 / exposure) * (1 - 0.45 * U.uNight.value), jump || !!(this.space && this.space._cityReset));
      if (this.space) this.space._cityReset = false;
    }
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
    // rendering agent: volumetric shafts (shadowed / lit air), anamorphic streaks, lens dirt
    {
      const sunUp = smooth(-0.04, 0.02, this.skyState.sunDir.y);
      const rad = this._shaftRad || (this._shaftRad = new THREE.Color());
      rad.copy(U.uSunColor.value).multiplyScalar(U.uSunIlluminance.value);
      p.renderShafts(this.camera, this.lighting.sun, rad, this.settings.rays ? sunUp : 0);
      p.renderAO(this.camera, 0.85);
      const sunVis = inFront ? smooth(0.95, 0.6, Math.max(Math.abs(sp.x), Math.abs(sp.y))) * sunUp : 0;
      p.renderStreaks(this.settings.bloom ? 0.05 * sunVis + 0.03 * U.uNight.value : 0, 6.0 / exposure);
      p.finalMat.uniforms.uDirt.value = this.settings.bloom ? 0.3 * sunVis + 0.03 * U.uNight.value : 0;
    }
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
    f.uBloom.value = this.settings.bloom ? 0.035 + night * 0.012 : 0;
    // rendering agent: highlight knee (log domain) replaces the old sky-object night dimming
    f.uHLKnee.value = THREE.MathUtils.lerp(1.4, 0.9, night);
    f.uHLSlope.value = THREE.MathUtils.lerp(0.9, 0.22, smooth(0.0, 0.8, night));
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
