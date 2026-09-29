import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { Fleet, fleetTargets, NAURU_LON } from './fleet.js';
import { CRAFT_FRAME } from './craftMesh.js';
import { LAMP_UNIFORMS } from './lamps.js';
import { stationFrame, HaloPorts } from './stations.js';
import { HALO_PORTS } from './earthData.js';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';
import { SpaceSim, R_EARTH, R_MOON, GEO_ALT, COUNTERWEIGHT_ALT, MERIDIAN_LON, bodyDir, cityToBody } from './sim.js';
import { EarthBake, maskReady } from './earthBake.js';
import { Earth, R_TOP } from './earth.js';
import { createSpaceSky, SKY_UNIFORMS } from './sky.js';
import { SkyLife } from './skyStars.js';
import { Aurora } from './aurora.js';
import { Meteors } from './meteors.js';
import { OrbitRig } from './controls.js';
import { spaceQuality } from './quality.js';
import { SpaceHud } from './hud.js';
import { TARGET_INFO } from './targets.js';
import { Rings } from './rings.js';
import { Elevator } from './elevator.js';
import { Moon } from './moon.js';
import { SunSwarm } from './sun.js';
import { Hearth, RS } from './hearth.js';
import { Traffic } from './traffic.js';
import { Lanes } from './lanes.js';
import { WorkingStations } from './workingStations.js';
import { GeoRoads, geoRoadTargets } from './geoRoads.js';
import { ReleaseYard, releaseYardTarget } from './releaseYard.js';
import { computeSky } from '../core/sun.js';
import { ShipPilot } from './shipPilot.js';

const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _qg = new THREE.Quaternion();
const _q = new THREE.Quaternion();

const FADE_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform float uAlpha;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture(tSrc, vUv).rgb, uAlpha); }
`;

/**
 * MERIDIAN's orbital view: a second, kilometre-scale scene with the whole
 * planet, the rings, the elevator, the Moon, the Sun and the Hearth. While it
 * is active the city scene is not rendered at all.
 *
 * Modes: 'off' | 'ascend' (city camera rides the tether) | 'space' |
 *        'descend' (space camera returns, then the city camera lands).
 */
export class SpaceMode {
  constructor(app) {
    this.app = app;
    this.renderer = app.renderer;
    this.sim = new SpaceSim();
    this.mode = 'off';
    this.built = false;
    this.q = spaceQuality(app.presetKey);
    this.realTime = 0;
    this.scene = new THREE.Scene();
    this.skyScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 1e7);
    this.earthFixed = new THREE.Group();          // rotates with the planet
    this.scene.add(this.earthFixed);
    this.cityToBody = cityToBody();
    this.rig = new OrbitRig(app.canvas);
    this.rig.onPick = (x, y) => this.pick(x, y);
    this.rig.onUser = () => { if (this.hud) this.hud.onUser(); };
    this.bodies = [];
    this.targets = {};
    this.exposure = 1;
    this.fade = null;           // transition state
    this.size = new THREE.Vector2(1, 1);
    this.hud = new SpaceHud(this);
    this._defineTargets();
  }

  // ------------------------------------------------------------- targets --
  _defineTargets() {
    const sim = this.sim;
    const self = this;
    const identity = (q) => q.identity();
    const earthFrame = (q) => q.copy(sim.earthQuat);
    const merid = bodyDir(0, MERIDIAN_LON);
    const T = (name, o) => { this.targets[name] = { name, ...TARGET_INFO[name], ...o }; };
    T('earth', { position: (o) => o.set(0, 0, 0), frame: identity, minDist: R_EARTH + 800, maxDist: 1.5e6, defaultDist: 26000, view: { az: 0.9, el: 0.28 } });
    T('meridian', {
      position: (o) => o.copy(merid).multiplyScalar(R_EARTH).applyQuaternion(sim.earthQuat),
      frame: (q) => q.setFromUnitVectors(_v2.set(0, 1, 0), _v.copy(merid).applyQuaternion(sim.earthQuat)),
      minDist: 800, maxDist: 60000, defaultDist: 3400, view: { az: 2.6, el: 0.62 },
      lookOffset: (rig, o) => o.copy(merid).applyQuaternion(sim.earthQuat).multiplyScalar(Math.min(rig.distance * 0.35, 3000)),
    });
    // the Halo at the Nauru port, in the port's local frame (x west, y up, z north)
    const nauru = bodyDir(0, NAURU_LON);
    const nauruQ = stationFrame(nauru);
    T('halo', {
      position: (o) => o.copy(nauru).multiplyScalar(R_EARTH + 620).applyQuaternion(sim.earthQuat),
      frame: (q) => q.copy(sim.earthQuat).multiply(nauruQ), minDist: 40, maxDist: 60000, defaultDist: 260, view: { az: 2.2, el: 0.28 },
    });
    T('geo', {
      position: (o) => o.copy(merid).multiplyScalar(R_EARTH + GEO_ALT).applyQuaternion(sim.earthQuat),
      frame: (q) => q.setFromUnitVectors(_v2.set(0, 1, 0), _v.copy(merid).applyQuaternion(sim.earthQuat)).multiply(_q.setFromAxisAngle(_v2.set(1, 0, 0), 0)),
      minDist: 8, maxDist: 200000, defaultDist: 36, view: { az: 0.7, el: 0.32 },
    });
    // the default view of the Moon keeps a little of the night side, the terminator's relief across it
    T('moon', { position: (o) => o.copy(sim.moonPos), frame: (q) => q.copy(sim.moonQuat), minDist: R_MOON + 250, maxDist: 400000, defaultDist: 7400, view: { az: 1.3, el: 0.24 } });
    T('sun', { position: (o) => o.copy(sim.sunPos), frame: identity, minDist: 3e6, maxDist: 1.2e8, defaultDist: 3.2e7, view: { az: 2.2, el: 0.55 } });
    for (const [k, o] of Object.entries(fleetTargets(this))) T(k, o);
    for (const [k, o] of Object.entries(geoRoadTargets(this))) T(k, o);
    T('releaseYard', releaseYardTarget(this));
    // unlisted targets (no key): the junction on the Halo and the counterweight
    const meridQ = stationFrame(merid);
    T('junction', {
      position: (o) => o.copy(merid).multiplyScalar(R_EARTH + 620).applyQuaternion(sim.earthQuat),
      frame: (q) => q.copy(sim.earthQuat).multiply(meridQ), minDist: 3, maxDist: 60000, defaultDist: 70, view: { az: 0.9, el: 0.3 },
    });
    T('counter', {
      position: (o) => o.copy(merid).multiplyScalar(R_EARTH + COUNTERWEIGHT_ALT + 10).applyQuaternion(sim.earthQuat),
      frame: (q) => q.copy(sim.earthQuat).multiply(meridQ), minDist: 20, maxDist: 400000, defaultDist: 84, view: { az: 0.1, el: 1.2 },   // the release yard across the frame, the Earth below, the cable falling to it
    });
    T('hearth', {
      position: (o) => o.copy(sim.hearthPos),
      frame: (q) => q.copy(self.hearth ? self.hearth.quat : q.identity()),
      minDist: 190, maxDist: 1.4e6, defaultDist: 640, view: { az: 0.45, el: 0.09 },
    });
    T('lunarport', {
      position:o=>o.set(R_MOON+380,0,0).applyQuaternion(sim.moonQuat).add(sim.moonPos),
      frame:q=>q.copy(sim.moonQuat).multiply(stationFrame(new THREE.Vector3(1,0,0))),
      minDist:8,maxDist:20000,defaultDist:27,view:{az:2.25,el:.4},
    });
    const lunarFrame=stationFrame(new THREE.Vector3(1,0,0));
    T('lunarReceiving', {
      position:o=>o.set(0,-.6,7.6).applyQuaternion(lunarFrame).add(_v2.set(R_MOON+380,0,0)).applyQuaternion(sim.moonQuat).add(sim.moonPos),
      frame:q=>q.copy(sim.moonQuat).multiply(lunarFrame),
      minDist:.12,maxDist:20000,defaultDist:11,view:{az:.55,el:.45},
    });
    // Medii Landing, on the lunar surface beneath the Exchange (src/space/lunarLanding.js)
    T('lunarLanding', {
      position:o=>o.set(R_MOON+0.02,0,0).applyQuaternion(sim.moonQuat).add(sim.moonPos),
      frame:q=>q.copy(sim.moonQuat).multiply(lunarFrame),
      minDist:.25,maxDist:20000,defaultDist:15,view:{az:-0.55,el:.3},   // from over the Bay, the town lit by the morning Sun
    });
    // Medii Works and the landing fields, inland of the town (src/space/lunarWorks.js, lunarTraffic.js)
    T('mediiWorks', {
      position:o=>o.set(5.798,0.03,-0.424).applyQuaternion(lunarFrame).add(_v2.set(R_MOON,0,0)).applyQuaternion(sim.moonQuat).add(sim.moonPos),
      frame:q=>q.copy(sim.moonQuat).multiply(lunarFrame),
      minDist:.08,maxDist:20000,defaultDist:3.2,view:{az:2.4,el:.32},
    });
    T('lunarFields', {
      position:o=>o.set(1.485,0.02,-2.192).applyQuaternion(lunarFrame).add(_v2.set(R_MOON,0,0)).applyQuaternion(sim.moonQuat).add(sim.moonPos),
      frame:q=>q.copy(sim.moonQuat).multiply(lunarFrame),
      minDist:.05,maxDist:20000,defaultDist:1.6,view:{az:-2.2,el:.28},
    });
    const terraceLocal=new THREE.Vector3(Math.cos(.2),0,Math.sin(.2)).multiplyScalar(9.174).addScaledVector(new THREE.Vector3(-Math.sin(.2),0,Math.cos(.2)),.32).setY(-1.07);
    T('harbourTerrace',{
      position:o=>o.copy(terraceLocal).applyQuaternion(meridQ).addScaledVector(merid,R_EARTH+GEO_ALT).applyQuaternion(sim.earthQuat),
      frame:q=>q.copy(sim.earthQuat).multiply(meridQ).multiply(_q.setFromAxisAngle(_v2.set(0,1,0),-.2)),
      minDist:.12,maxDist:200000,defaultDist:1.25,view:{az:.55,el:.6},
    });
    const courtAngle=8.35/(R_MOON+380),courtUp=new THREE.Vector3(Math.cos(courtAngle),0,Math.sin(courtAngle)),courtFrame=stationFrame(courtUp);
    T('lunarCourt',{
      position:o=>o.copy(courtUp).multiplyScalar(R_MOON+380).add(_v2.set(0,2.75,0)).applyQuaternion(sim.moonQuat).add(sim.moonPos),
      frame:q=>q.copy(sim.moonQuat).multiply(courtFrame),
      minDist:.12,maxDist:20000,defaultDist:1.35,view:{az:1.15,el:.55},
    });
    const foundryUp=bodyDir(0,NAURU_LON+.009);
    T('foundry', {
      position:o=>o.copy(foundryUp).multiplyScalar(R_EARTH+627).add(_v2.set(0,42,0)).applyQuaternion(sim.earthQuat),
      frame:q=>q.copy(sim.earthQuat).multiply(stationFrame(foundryUp)),
      minDist:8,maxDist:30000,defaultDist:48,view:{az:.4,el:.55},   // the works against the Halo wall that carries them
    });
    const solarOffset=new THREE.Vector3(0,.025*1.496e8,.004*1.496e8);
    T('solarCollector', {
      position:o=>o.copy(sim.sunPos).add(solarOffset),
      frame:q=>q.setFromUnitVectors(_v2.set(0,1,0),_v3.copy(solarOffset).normalize()),
      minDist:12,maxDist:1e8,defaultDist:56,view:{az:.55,el:1.08},   // the flower over the Sun's disc
    });
    T('solarService', {
      position:o=>o.set(0,3.7,0).applyQuaternion(_q.setFromUnitVectors(_v2.set(0,1,0),_v3.copy(solarOffset).normalize())).add(solarOffset).add(sim.sunPos),
      frame:q=>q.setFromUnitVectors(_v2.set(0,1,0),_v3.copy(solarOffset).normalize()),
      minDist:.12,maxDist:1e8,defaultDist:6,view:{az:1,el:.4},
    });
    T('hearthworks', {
      position:o=>self.hearth?o.copy(self.hearth.refugePosition).applyAxisAngle(_v2.set(0,0,1),.12).applyQuaternion(self.hearth.quat).add(sim.hearthPos):o.copy(sim.hearthPos),
      frame:q=>self.hearth?q.copy(self.hearth.quat):q.identity(),
      minDist:16,maxDist:1.4e6,defaultDist:95,view:{az:.9,el:.12},   // the Refuge against the disc it serves
    });
  }

  // --------------------------------------------------------------- build --
  build() {
    if (this.built) return;
    this.built = true;
    const q = this.q;
    this.bake = new EarthBake(this.renderer, q.cube, q.cloudCube);
    this.earth = new Earth(this.bake, q);
    this.scene.add(this.earth.mesh);
    this.sky = createSpaceSky();
    this.skyScene.add(this.sky);
    this.modules = [];
    // rings and the elevator turn with the planet
    this.rings = new Rings(this, q);
    this.earthFixed.add(this.rings.group);
    this.elevator = new Elevator(this, q);
    this.earthFixed.add(this.elevator.group);
    this.modules.push(this.rings, this.elevator);
    const el = this.elevator;
    this.addBody('earth', [this.earth.mesh], () => _v.set(0, 0, 0), R_TOP + 4, { solid: true });
    this.addBody('rings', [this.rings.group], () => _v.set(0, 0, 0), R_EARTH + 2140);
    this.addBody('junction', [el.junction], () => el.junction.getWorldPosition(_v), 24, { solid: true, hint: 0.7 });
    const segA = new THREE.Vector3(), segB = new THREE.Vector3(), segP = new THREE.Vector3();
    this.addBody('tether', [el.tether, el.climbers, el.cars.group], null, 0, {
      interval: (cam) => {
        segA.copy(el.up).multiplyScalar(R_EARTH).applyQuaternion(this.sim.earthQuat);
        segB.copy(el.up).multiplyScalar(R_EARTH + COUNTERWEIGHT_ALT + 20).applyQuaternion(this.sim.earthQuat);
        const line = new THREE.Line3(segA, segB);
        line.closestPointToPoint(cam, true, segP);
        return [Math.max(.001,segP.distanceTo(cam)-.25), Math.max(segA.distanceTo(cam), segB.distanceTo(cam))+.25];
      },
    });
    this.addBody('harbour', [el.harbour], () => el.harbour.getWorldPosition(_v), 17, { solid: true, hint: 0.95 });
    this.addBody('counter', [el.counter], () => el.counter.getWorldPosition(_v), 20, { solid: true, hint: 0.6 });
    // Moon, Sun and swarm, the Hearth
    this.moon = new Moon(this);
    this.scene.add(this.moon.group);
    this.sunSwarm = new SunSwarm(this, q);
    this.scene.add(this.sunSwarm.group);
    this.hearth = new Hearth(this, q);
    this.scene.add(this.hearth.group);
    this.skyScene.add(this.hearth.composite);
    this.modules.push(this.moon, this.sunSwarm, this.hearth);
    this.addBody('moon', [this.moon.group], () => _v.copy(this.sim.moonPos), R_MOON + 420, { solid: true });
    this.sunBody = this.addBody('sun', [this.sunSwarm.sunGroup], () => _v.copy(this.sim.sunPos), 696000 * 5, { solid: true });
    this.swarmBody = this.addBody('swarm', [this.sunSwarm.swarm], () => _v.copy(this.sim.sunPos), 0.2 * 1.496e8);
    this.addBody('hearth', [this.hearth.stations], () => _v.copy(this.sim.hearthPos), 32 * RS + 60, { solid: true, local: true });
    this.traffic = new Traffic(this, this.rings, q);
    this.scene.add(this.traffic.mesh);
    this.modules.push(this.traffic);
    this.addBody('traffic', [this.traffic.mesh], null, 0, {
      interval: (cam) => {
        const d = cam.length();
        const reach = R_EARTH + GEO_ALT + 21000;     // the departure corridor runs out 20,000 km
        return [Math.max(d - reach, 0.01), Math.max(d + reach, cam.distanceTo(this.sim.moonPos) + 6000)];
      },
    });
    // the Halo's port stations at the ground ports
    this.ports = new HaloPorts(this, HALO_PORTS);
    this.modules.push(this.ports);
    // lane guidance beacons along the corridors
    this.lanes = new Lanes(this);
    this.modules.push(this.lanes);
    // ships: liners at the Harbour, tenders over the Halo, Selene Works above the Moon
    this.fleet = new Fleet(this);
    this.modules.push(this.fleet);
    this.works = new WorkingStations(this);
    this.modules.push(this.works);
    // the Harbour's neighbourhood on the geostationary arc: yard, store, ship movements
    this.geoRoads = new GeoRoads(this);
    this.modules.push(this.geoRoads);
    // the counterweight's release yard: cradles, a held liner, one let go, its lit lane
    this.releaseYard = new ReleaseYard(this);
    this.modules.push(this.releaseYard);
    // the Lodestar, flown by the visitor (V): built on first boarding
    this.ship = new ShipPilot(this);
    this.modules.push(this.ship);
    // the planets moving on their orbits; the aurorae over the night side
    this.skyLife = new SkyLife(this, SKY_UNIFORMS);
    this.modules.push(this.skyLife);
    this.aurora = new Aurora(this, q);
    this.modules.push(this.aurora);
    this.meteors = new Meteors(this);
    this.modules.push(this.meteors);
    for (const b of this.bodies) if (!b.local) b.remote = true;
    // post: crossfade helper
    this.fadeRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.fadePass = new FullscreenPass(new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: FADE_FRAG, uniforms: { tSrc: { value: this.fadeRT.texture }, uAlpha: { value: 0 } },
      transparent: true, depthTest: false, depthWrite: false,
    }));
    // The additive shaders here write light with alpha 0 so they never touch coverage;
    // blend them ONE, ONE (three's straight-alpha additive mode would scale them by that 0).
    for (const sc of [this.scene, this.skyScene]) sc.traverse((o) => {
      for (const m of [].concat(o.material || [])) if (m.blending === THREE.AdditiveBlending) m.premultipliedAlpha = true;
    });
    this.setSize(this.size.x, this.size.y);
    try { if (this.renderer.compileAsync) this.renderer.compileAsync(this.scene, this.camera).catch(() => {}); } catch (e) { /* optional */ }
  }

  /** Register a group of objects as a body for near/far pass partitioning. */
  addBody(name, objects, center, radius, opts = {}) {
    const b = { name, objects, center, radius, visible: true, ...opts };
    this.bodies.push(b);
    return b;
  }

  // ------------------------------------------------------------ settings --
  applyQuality(settings) {
    const q = spaceQuality(this.app.presetKey);
    this.q = q;
    if (!this.built) return;
    this.earth.setQuality(q);
    for (const m of this.modules) if (m.setQuality) m.setQuality(q);
  }

  setSize(w, h) {
    this.size.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.fadeRT) this.fadeRT.setSize(w, h);
    LAMP_UNIFORMS.uRes.value.set(w, h);
    if (this.modules) for (const m of this.modules) if (m.setSize) m.setSize(w, h);
  }

  get active() { return this.mode !== 'off'; }
  /** True while the city must not be rendered at all. */
  get onlySpace() { return this.mode === 'space' || (this.fade && this.fade.phase === 'space'); }
  /** True while the space mode scripts the city camera. */
  get cityCam() { return this.fade && this.fade.phase === 'city'; }

  // ------------------------------------------------------- mode switches --
  toggle() { if (this.mode === 'off') this.enter(); else if (this.mode === 'space') this.exit(); }

  enter(immediate = false) {
    this._expReset = true;
    if (this.mode !== 'off' && !(immediate && this.mode === 'ascend')) return;
    this.build();
    const app = this.app;
    // the Moon from this hour's sky, not the last city frame's (a clock set without a city
    // frame between, as the tour and the capture harness do, put the near side in the dark)
    const sky = { sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), celestial: new THREE.Matrix3() };
    computeSky(app.hours, sky);
    this.sim.syncFromHours(app.hours, sky.moonDir);
    this.savedTimeSpeed = app.timeSpeed;
    app.timeSpeed = 0;
    if (app.controls) { app.controls.enabled = false; app.controls.flight = null; app.controls.orbit = null; app.controls.keys.clear(); }
    if (app.ui && app.ui.touring) app.ui.stopTour();
    this.hud.show(true);
    if (immediate) {
      if (maskReady() && !this.noBake) this.bake.step(18);
      this.mode = 'space';
      this.fade = null;
      this.rig.enabled = true;
      const t = this.targets.earth;
      this.rig.set(t, t.view.az, t.view.el, t.defaultDist);
      this.hud.select('earth', false);
      return;
    }
    this.mode = 'ascend';
    const cam = app.camera;
    this.fade = {
      phase: 'city', t: 0, dir: 1,
      p0: cam.position.clone(), q0: cam.quaternion.clone(), fov0: cam.fov,
    };
  }

  exit(immediate = false) {
    this._cityReset = true;
    if (this.mode === 'off') return;
    const app = this.app;
    if (this.ship && this.ship.active) this.ship.exit();
    this.rig.enabled = false;
    if (immediate) { this._finishExit(); return; }
    this.mode = 'descend';
    this.fade = { phase: 'space', t: 0, dir: -1, p0: this.camera.position.clone(), q0: this.camera.quaternion.clone() };
    this.hud.select(null, false);
  }

  _finishExit() {
    const app = this.app;
    this.mode = 'off';
    this.fade = null;
    this.hud.show(false);
    if (app.controls) {
      app.controls.enabled = true;
      app.controls.keys.clear();
      const c = app.controls;
      const p = app.camera.position.clone();
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(app.camera.quaternion);
      c.setPose(p, Math.atan2(-dir.x, -dir.z), Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)));
      c.fov = c.baseFov; app.camera.fov = c.baseFov; app.camera.updateProjectionMatrix();
    }
    app.timeSpeed = this.savedTimeSpeed || 0;
  }

  /** Focus a target by name (earth, meridian, halo, geo, moon, sun, hearth). */
  focus(name, opts = {}) {
    const t = this.targets[name];
    if (!t) return;
    if (this.mode !== 'space') this.enter(true);
    const v = { ...t.view, ...opts };
    if (opts.immediate) this.rig.set(t, v.az, v.el, v.dist ?? t.defaultDist);
    else this.rig.flyTo(t, { az: v.az, el: v.el, dist: v.dist ?? t.defaultDist });
    this.hud.select(name, true);
  }

  /** Capture helper: jump to a spherical view around a target. */
  view(name, { az, el, dist, fov, warp } = {}) {
    const t = this.targets[name];
    if (this.mode !== 'space') this.enter(true);
    if (fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (warp !== undefined) this.sim.warp = warp;
    this.rig.set(t, az ?? t.view.az, el ?? t.view.el, dist ?? t.defaultDist);
    this.hud.select(name, false);
  }

  setWarp(w) {
    if (w === 0) this.sim.paused = true;
    else { this.sim.paused = false; this.sim.warp = w; }
    this.hud.syncWarp();
  }

  // ---------------------------------------------------------- per frame --
  /** Called by App.frame when onlySpace. */
  frame(dt) {
    this.realTime += dt;
    this.updateSim(dt);
    if (this.fade && this.fade.phase === 'space') this._driveSpaceTransition(dt);
    else if (this.ship && this.ship.active) this.ship.drive(dt, this.camera);
    else this.rig.update(dt, this.camera);
    this.renderToScreen(dt);
  }

  updateSim(dt) {
    const app = this.app;
    // external clock changes (time dial, capture harness) re-sync the planet
    if (this.sim._lastHours !== null && Math.abs(app.hours - this.sim._lastHours) > 1e-4) this.sim.syncFromHours(app.hours);
    const running = this.mode === 'space';
    this.sim.step(running ? dt : 0);
    app.hours = this.sim.hours;
    this.sim._lastHours = app.hours;
    if (this.bake && !this.bake.ready && !this.noBake) this.bake.step(this.mode === 'space' ? 18 : 2);
  }

  _updateModules(dt) {
    const sim = this.sim;
    this.earthFixed.quaternion.copy(sim.earthQuat);
    this.earthFixed.updateMatrixWorld(true);
    this.earth.update(sim, this.realTime);
    this.rings.shadowUniforms(sim, this.earth.uniforms.uRingN.value, this.earth.uniforms.uRingW.value);
    SKY_UNIFORMS.uSkySunDir.value.copy(sim.sunDir);
    SKY_UNIFORMS.uSkySunPos.value.copy(sim.sunPos);
    SKY_UNIFORMS.uSwarmT.value = this.realTime;
    SKY_UNIFORMS.uSkyTime.value = this.realTime;
    SKY_UNIFORMS.uSkyStars.value = THREE.MathUtils.lerp(0.55, 0.2, this.litEstimate || 0);
    CRAFT_FRAME.sunDir.copy(sim.sunDir);
    CRAFT_FRAME.time = this.realTime;
    LAMP_UNIFORMS.uTime.value = this.realTime;
    for (const m of this.modules) if (m.update) m.update(sim, this.realTime, dt, this);
  }

  /** Render the space scene into pipeline.hdrRT and run the shared post chain to `target`. */
  renderScene(dt, target = null) {
    const r = this.renderer;
    const p = this.app.pipeline;
    const cam = this.camera;
    cam.updateMatrixWorld();
    this._updateModules(dt);
    this.earth.uniforms.uPixAng.value = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / Math.max(this.size.y, 1);
    this.earth.material.side = cam.position.length() < R_TOP + 3 ? THREE.BackSide : THREE.FrontSide;
    r.info.reset();
    if (this.sunBody) {
      this.sunBody.visible = this.sunSwarm.near > 0.001;
      this.swarmBody.visible = this.sunSwarm.near > 0.001;
      this.sky.material.uniforms.uShowSun.value = this.skyDim ?? 1;
      this.sky.material.uniforms.uSwarmFar.value = 1 - this.sunSwarm.near;
    }
    cam.near = 1; cam.far = 1e7; cam.updateProjectionMatrix();
    if (this.hearth) {
      this.hearth.renderLens(r, cam);
      this.sky.visible = !this.hearth.nearZone || !this.hearth.active;
    }
    r.setRenderTarget(p.hdrRT);
    // alpha starts at 0 and only solid geometry writes 1: the final pass reads it as a
    // coverage mask, so the Sun's glare sits behind stations, ships and planets
    r.setClearColor(0x000000, 0);
    r.clear();
    r.setClearColor(0x000000, 1);
    const prevAuto = r.autoClear;
    r.autoClear = false;
    // backdrop: stars, Sun, far swarm, and the Hearth's lensed image
    r.render(this.skyScene, cam);
    for (const m of this.modules) if (m.renderBackdrop) m.renderBackdrop(r, cam, this);
    // depth slices: disjoint [near, far] ranges drawn far to near, depth cleared
    // between them, so kilometre-scale detail and million-km distances both keep
    // full depth precision without a logarithmic buffer.
    const slices = this._planSlices(cam.position);
    this.lastSlices = slices.length;
    for (const b of this.bodies) for (const o of b.objects) o.visible = false;
    for (let i = slices.length - 1; i >= 0; i--) {
      const sl = slices[i];
      for (const e of sl.set) for (const o of e.b.objects) o.visible = true;
      cam.near = sl.near; cam.far = sl.far; cam.updateProjectionMatrix();
      r.clearDepth();
      r.render(this.scene, cam);
      for (const e of sl.set) for (const o of e.b.objects) o.visible = false;
    }
    cam.near = slices.length ? slices[0].near : 1; cam.far = slices.length ? slices[slices.length - 1].far : 1e7;
    cam.updateProjectionMatrix();
    for (const m of this.modules) if (m.renderOverlay) m.renderOverlay(r, cam, this);
    r.autoClear = prevAuto;
    this._post(dt, target);
  }

  _planSlices(camPos) {
    const items = [];
    const hearthNear = this.hearth && this.hearth.nearZone;
    for (const b of this.bodies) {
      if (b.visible === false) continue;
      if (hearthNear && b.remote) continue;
      let dmin, dmax;
      if (b.interval) [dmin, dmax] = b.interval(camPos);
      else { const d = b.center(_v).distanceTo(camPos); dmin = d - b.radius; dmax = d + b.radius; }
      dmin = Math.max(dmin, b.minNear || 0.003);
      if (dmax <= dmin) continue;
      items.push({ b, dmin, dmax });
    }
    const out = [];
    if (!items.length) return out;
    const RMAX = 400, RHARD = 30000;
    let z = Math.min(...items.map((e) => e.dmin)) * 0.9;
    const zFar = Math.max(...items.map((e) => e.dmax)) * 1.02;
    let guard = 0;
    while (z < zFar && guard++ < 24) {
      let zEnd = Math.min(z * RMAX, zFar);
      for (const e of items) {
        if (!e.b.solid || !(e.dmin < zEnd && e.dmax > zEnd)) continue;
        if (e.dmax <= z * RHARD) zEnd = Math.max(zEnd, e.dmax * 1.001);
        else if (e.dmin > z * 1.5) zEnd = Math.min(zEnd, e.dmin * 0.999);
      }
      const set = items.filter((e) => e.dmax > z && e.dmin < zEnd);
      if (set.length) {
        // tighten to the content of the slice
        const lo = Math.max(z, Math.min(...set.map((e) => e.dmin)) * 0.98);
        const hi = Math.min(zEnd, Math.max(...set.map((e) => e.dmax)) * 1.02);
        out.push({ near: lo, far: Math.max(hi, lo * 1.01), set });
      }
      // jump over empty space
      const nextMin = Math.min(...items.filter((e) => e.dmax > zEnd).map((e) => e.dmin), Infinity);
      z = Math.max(zEnd, Math.min(nextMin * 0.98, zFar));
      if (nextMin === Infinity) break;
    }
    return out;
  }

  _post(dt, target) {
    const p = this.app.pipeline;
    const cam = this.camera;
    const want = this._autoExposure();
    this.exposure += (want - this.exposure) * (1 - Math.exp(-(dt || 0.016) * 2.5));
    if (!isFinite(this.exposure)) this.exposure = want;
    const f = p.finalMat.uniforms;
    // These buffers belong to the ground camera. Sampling its last shafts/AO frame in
    // orbit stamped the Axis and city horizon into every star field, even at the Sun.
    f.uAO.value = 0;
    f.uShaftDark.value = 0;
    f.uShaftLit.value = 0;
    f.uStreak.value = 0;
    f.uDirt.value = 0;
    p.shaftValid = false;
    p.aoValid = false;
    f.uExposure.value = this.exposure;
    // small bright specks (glints, window lights) should not each bloom into a flash
    p.downMat.uniforms.uThreshold.value = 1.8 / this.exposure;
    p.downMat.uniforms.uKnee.value = 0.9 / this.exposure;
    // the Sun is handled analytically (glare below): keep its disc out of the bloom chain,
    // or the screen-space halo would switch on and off as the disc crosses the frame edge
    p.downMat.uniforms.uClamp.value = 40 / this.exposure;
    f.uTime.value = this.realTime;
    p.renderBloom();
    // measured exposure on top of the analytic estimate: sunlit megastructures filling
    // the frame (the Halo deck below you at an orbital sunrise) no longer white it out
    p.adaptMat.uniforms.uRange.value = 2.6;
    // in orbit the meter only ever pulls exposure down (sunrise over the limb, a sunlit
    // hull filling the view); a mostly black frame must not lift a white station into glare
    p.renderExposure(dt || 0.016, 0.16 / this.exposure, this._expReset !== false, 0.0);
    this._expReset = false;
    f.uGain.value.set(1.0, 1.0, 1.0);
    f.uLift.value.set(0.0, 0.0005, 0.0012);
    f.uSaturation.value = 1.1;
    f.uContrast.value = 1.07;
    f.uBloom.value = this.app.settings.bloom ? 0.055 : 0;
    p.renderRays(new THREE.Vector2(0.5, 0.5), 0);
    // analytic sun glare + ghosts: smooth in angle, in and out of frame and across limbs
    const g = this._sunGlare();
    f.uFlare.value = 0;
    f.uGlareUV.value.copy(g.uv);
    f.uGlareFov.value = THREE.MathUtils.degToRad(cam.fov);
    // the solar disc's radius in uv-height units (at least a pixel and a half)
    f.uGlareR.value = Math.max(Math.atan(696000 / Math.max(this.sim.sunPos.distanceTo(cam.position), 1)) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5)), 1.5 / Math.max(this.size.y, 1));
    f.uGlareMask.value = 1;
    const E = U.uSunIlluminance.value * g.vis * (this.skyDim ?? 1);
    f.uGlare.value.set(1.0, 0.93, 0.84).multiplyScalar(this.app.settings.bloom ? E * 0.6 : E * 0.2);
    f.uGhosts.value = this.app.settings.bloom ? 0.012 : 0;
    // the planets hide the rays that would cross their discs
    {
      const inv = cam.matrixWorldInverse;
      const ty = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
      f.uTanHalf.value.set(ty * cam.aspect, ty);
      const e = _v3.set(0, 0, 0).applyMatrix4(inv);
      f.uOcc1.value.set(e.x, e.y, e.z, R_EARTH + 30);
      const m = _v3.copy(this.sim.moonPos).applyMatrix4(inv);
      f.uOcc2.value.set(m.x, m.y, m.z, R_MOON);
    }
    if (target) { p.fs.material = p.finalMat; p.fs.render(this.renderer, target); }
    else p.composite();
  }

  /** Sun position on screen (may be off screen) and a smooth visibility factor. */
  _sunGlare() {
    const cam = this.camera;
    const o = cam.position;
    const toS = _v.copy(this.sim.sunPos).sub(o);
    const dS = toS.length();
    const sd = toS.divideScalar(dS);
    const rs = 696000 / dS;                                   // solar angular radius
    // fraction of the disc clear of a body of angular radius rb at separation sep
    const clearOf = (center, radius) => {
      const rel = _v2.copy(center).sub(o);
      const d = rel.length();
      if (d < radius) return 1;
      if (rel.dot(sd) < 0) return 1;
      const sep = Math.acos(THREE.MathUtils.clamp(rel.dot(sd) / d, -1, 1));
      const rb = Math.asin(Math.min(1, radius / d));
      return smooth(rb - rs * 1.2, rb + rs * 1.2, sep);
    };
    let vis = clearOf(_v3.set(0, 0, 0), R_EARTH + 45);
    if (this.moon) vis *= clearOf(this.sim.moonPos, R_MOON);
    // fade as the Sun swings behind the viewer (the glare lives in the lens)
    const fwd = _v2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const off = Math.acos(THREE.MathUtils.clamp(fwd.dot(sd), -1, 1));
    const halfDiag = Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5) * Math.hypot(1, cam.aspect));
    vis *= smooth(halfDiag + 0.4, halfDiag - 0.05, off);
    // project the direction (not a point: the depth-sliced projection has no fixed near/far)
    const vd = _v3.copy(sd).applyQuaternion(_qg.copy(cam.quaternion).invert());
    const ty = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5), tx = ty * cam.aspect;
    const zz = Math.max(-vd.z, 0.02);
    if (!this._glareUV) this._glareUV = new THREE.Vector2();
    this._glareUV.set(0.5 + 0.5 * (vd.x / zz) / tx, 0.5 + 0.5 * (vd.y / zz) / ty);
    return { uv: this._glareUV, vis };
  }

  _sunScreen() {
    const cam = this.camera;
    const s = _v.copy(this.sim.sunPos);
    // occluded by the Earth?
    const o = cam.position, d = _v2.copy(s).sub(o).normalize();
    const b = o.dot(d), c = o.lengthSq() - (R_EARTH + 40) * (R_EARTH + 40);
    if (c > 0 && b < 0 && b * b - c > 0) return 0;
    if (this.moon) {
      const m = _v2.copy(this.sim.moonPos).sub(o);
      const bm = m.dot(d);
      if (bm > 0 && m.lengthSq() - bm * bm < R_MOON * R_MOON) return 0;
    }
    const sp = s.clone().project(cam);
    if (sp.z > 1 || sp.z < -1) return 0;
    return Math.max(0, 1 - Math.max(Math.abs(sp.x), Math.abs(sp.y)) * 0.7);
  }

  _autoExposure() {
    const cam = this.camera;
    const camPos = cam.position;
    const fwd = _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const halfFov = THREE.MathUtils.degToRad(cam.fov) * 0.5;
    let lit = 0;
    // Earth: screen coverage x sunlit fraction of the visible disc
    const dE = camPos.length();
    const angE = Math.asin(Math.min(1, R_TOP / dE));
    const offE = Math.acos(THREE.MathUtils.clamp(-camPos.dot(fwd) / dE, -1, 1));
    const cover = THREE.MathUtils.clamp((angE * angE) / (halfFov * halfFov * 1.6), 0, 1) * smooth(angE + halfFov * 1.3, Math.max(angE - halfFov, 0), offE);
    const phase = 0.5 + 0.5 * camPos.dot(this.sim.sunDir) / dE;
    lit += cover * phase * 1.5;
    for (const m of this.modules) if (m.exposureHint) lit += m.exposureHint(cam, this);
    // sunlit stations and ships: without this a white hull filling the frame was exposed
    // for empty space and clipped
    for (const b of this.bodies) {
      if (!b.hint || !b.center) continue;
      const c = _v2.copy(b.center());
      const rel = _v3.copy(c).sub(camPos);
      const d = Math.max(rel.length(), 1e-3);
      const ang = Math.asin(Math.min(1, b.radius / d));
      const off = Math.acos(THREE.MathUtils.clamp(rel.dot(fwd) / d, -1, 1));
      if (off > ang + halfFov * 1.2) continue;
      // expose for any sunlit hull that is more than a speck on screen: pearl plating in full
      // sun must stay below the shoulder whether it fills the frame or a tenth of it
      const pxR = (Math.tan(ang) / Math.tan(halfFov)) * this.size.y * 0.5;
      const cov = smooth(2, 26, pxR) * smooth(ang + halfFov * 1.2, Math.max(ang - halfFov, 0), off);
      // in the Earth's shadow?
      const along = c.dot(this.sim.sunDir);
      const sunlit = along > 0 ? 1 : smooth(R_EARTH - 50, R_EARTH + 150, _v4.copy(c).addScaledVector(this.sim.sunDir, -along).length());
      lit += cov * b.hint * sunlit;
    }
    lit = THREE.MathUtils.clamp(lit, 0, 1);
    this.litEstimate = lit;
    // a module can stop the eye further down (a sunlit pale town filling the view)
    let k = 1;
    for (const m of this.modules) if (m.exposureScale) k *= m.exposureScale(cam, this);
    return THREE.MathUtils.lerp(2.4, 0.4, Math.pow(lit, 0.7)) * k;
  }

  renderToScreen(dt) { this.renderScene(dt, null); }

  // ------------------------------------------------------ transitions --
  /** City-side hook: drives the camera during the ride up / down the tether. */
  driveCity(dt) {
    const f = this.fade;
    const cam = this.app.camera;
    if (this.bake && !this.bake.ready) this.bake.step(2);
    if (f.dir > 0) {
      // ascent: ease over to the tether below the cloud deck, then climb and accelerate
      f.t += dt;
      const Ta = 1.8, Tb = 6.2;
      const S = new THREE.Vector3(260, 1700, 240);
      const look0 = new THREE.Vector3(0, 3400, 0);
      if (f.t < Ta) {
        const e = easeInOut(f.t / Ta);
        cam.position.lerpVectors(f.p0, S, e);
        _q.setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, look0, new THREE.Vector3(0, 1, 0)));
        cam.quaternion.copy(f.q0).slerp(_q, e);
      } else {
        const u = Math.min((f.t - Ta) / Tb, 1);
        const y = this._ascentAlt(u);
        const pos = this._ascentPos(y, u);
        cam.position.copy(pos);
        const look = new THREE.Vector3(0, y * 1.9 + 2500, 0).lerp(new THREE.Vector3(0, y + 3.0e5, 0), smooth(0.2, 1, u));
        _q.setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, look, new THREE.Vector3(0, 1, 0)));
        cam.quaternion.copy(_q);
        if (u > 0.86 && f.crossing === undefined) f.crossing = 0;
        if (f.crossing !== undefined) {
          f.crossing = Math.min(1, f.crossing + dt / 0.9);
          if (f.crossing >= 1) this._startSpaceAscent(pos, cam.quaternion, u);
        }
      }
      cam.fov += (58 - cam.fov) * (1 - Math.exp(-dt * 2));
      cam.updateProjectionMatrix();
    } else {
      // descent: from the stratosphere down along the tether to the Crown
      f.t += dt;
      const D = 6.5;
      const u = Math.min(f.t / D, 1);
      const e = easeInOut(u);
      const y = Math.exp(THREE.MathUtils.lerp(Math.log(f.startAlt), Math.log(3180), 1 - Math.pow(1 - u, 2.2)));
      const end = new THREE.Vector3(720, 3180, 840);
      const p = new THREE.Vector3(THREE.MathUtils.lerp(f.startPos.x, end.x, e), y, THREE.MathUtils.lerp(f.startPos.z, end.z, e));
      cam.position.copy(p);
      const lookA = new THREE.Vector3(0, 0, 0), lookB = new THREE.Vector3(0, 3110, 0);
      const look = lookA.lerp(lookB, smooth(0.45, 1, u));
      _q.setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, look, new THREE.Vector3(0, 1, 0)));
      cam.quaternion.slerp(_q, Math.min(1, dt * 4 + (u > 0.95 ? 0.5 : 0)));
      if (f.crossing !== undefined && f.crossing > 0) f.crossing = Math.max(0, f.crossing - dt / 0.9);
      if (u >= 1) this._finishExit();
    }
  }

  _ascentAlt(u) { return 1700 * Math.exp(Math.log(78000 / 1700) * Math.pow(u, 1.35)); }
  _ascentPos(y, u) {
    const r = THREE.MathUtils.lerp(360, 70, smooth(1700, 6000, y)) + y * 0.0015;
    const a = 0.75 + u * 1.3;
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  }

  /** City clip planes while the camera is scripted near the tether. */
  afterCityCamera(camera) {
    if (!this.cityCam) return;
    const alt = camera.position.y;
    camera.near = THREE.MathUtils.clamp(alt * 0.0015, 1, 60);
    camera.far = Math.max(60000, alt * 4);
    camera.updateProjectionMatrix();
  }

  /** City-side hook after the city frame was composited: crossfade the space view over it. */
  afterCityRender(dt) {
    const f = this.fade;
    if (!f || f.phase !== 'city' || !(f.crossing > 0)) return;
    this.realTime += dt;
    this.updateSim(0);
    this._cityPoseToSpace(this.app.camera, this.camera);
    this.renderScene(dt, this.fadeRT);
    const m = this.fadePass.material;
    m.uniforms.uAlpha.value = smooth(0, 1, f.crossing);
    this.renderer.setRenderTarget(null);
    const prevAuto = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.render(this.fadePass.scene, this.fadePass.camera);
    this.renderer.autoClear = prevAuto;
  }

  /** Map a city camera (metres, local frame at Meridian) into the inertial space frame. */
  _cityPoseToSpace(cityCam, out) {
    const toBody = this.cityToBody;
    const p = cityCam.position.clone().multiplyScalar(0.001);
    p.y += R_EARTH;
    p.applyMatrix4(toBody).applyQuaternion(this.sim.earthQuat);
    out.position.copy(p);
    const rq = new THREE.Quaternion().setFromRotationMatrix(toBody);
    out.quaternion.copy(this.sim.earthQuat).multiply(rq).multiply(cityCam.quaternion);
    out.fov = cityCam.fov; out.updateProjectionMatrix();
  }

  _startSpaceAscent(pos, quat, u) {
    // hand over to the space camera and keep climbing past the Halo
    this._cityPoseToSpace(this.app.camera, this.camera);
    this.fade = { phase: 'space', t: 0, dir: 1, p0: this.camera.position.clone(), q0: this.camera.quaternion.clone(), fov0: this.camera.fov };
    const t = this.targets.meridian;
    this.rig.set(t, t.view.az, t.view.el, t.defaultDist);
    this.rig.update(0, new THREE.Object3D());
    this.fade.p1 = this.rig.pos.clone();
    this.fade.q1 = this.rig.quat.clone();
    this.hud.select('meridian', false);
  }

  _driveSpaceTransition(dt) {
    const f = this.fade;
    const cam = this.camera;
    const sim = this.sim;
    const up = _v.copy(bodyDir(0, MERIDIAN_LON)).applyQuaternion(sim.earthQuat).clone();
    if (f.dir > 0) {
      const D = 6.0;
      f.t += dt;
      const u = Math.min(f.t / D, 1);
      // live end pose from the rig (the planet turns underneath)
      this.rig.update(0, new THREE.Object3D());
      const p1 = this.rig.pos, q1 = this.rig.quat;
      // climb the tether past the Halo, then swing out to the end pose
      const alt0 = f.p0.length() - R_EARTH;
      const climb = up.clone().multiplyScalar(R_EARTH + THREE.MathUtils.lerp(alt0, 1400, smooth(0, 0.55, u)));
      const side = _v2.copy(f.p0).sub(up.clone().multiplyScalar(f.p0.dot(up)));
      climb.add(side.multiplyScalar(1 + u * 30));
      const e = smooth(0.35, 1, u);
      cam.position.copy(climb).lerp(p1, e);
      // look up the tether, then down at the planet
      const lookUp = up.clone().multiplyScalar(R_EARTH + 60000);
      const m = new THREE.Matrix4().lookAt(cam.position, lookUp, _v2.set(0, 1, 0));
      const qUp = new THREE.Quaternion().setFromRotationMatrix(m);
      const q0 = f.q0.clone().slerp(qUp, smooth(0, 0.3, u));
      cam.quaternion.copy(q0).slerp(q1, smooth(0.3, 1, u));
      cam.fov += (50 - cam.fov) * (1 - Math.exp(-dt * 1.5));
      cam.updateProjectionMatrix();
      if (u >= 1) {
        this.fade = null;
        this.mode = 'space';
        this.rig.enabled = true;
        cam.fov = 50; cam.updateProjectionMatrix();
        this.hud.select('meridian', true);
      }
    } else {
      // descent: swing to a point above Meridian and dive along the tether
      const D = 6.5;
      f.t += dt;
      const u = Math.min(f.t / D, 1);
      const east = new THREE.Vector3(-Math.sin(MERIDIAN_LON), 0, -Math.cos(MERIDIAN_LON)).applyQuaternion(sim.earthQuat);
      const alt = Math.exp(THREE.MathUtils.lerp(Math.log(2600), Math.log(62), smooth(0.3, 1, u)));
      const above = up.clone().multiplyScalar(R_EARTH + alt).addScaledVector(east, alt * 0.25);
      const e = smooth(0, 0.45, u);
      cam.position.copy(f.p0).lerp(above, e);
      const look = up.clone().multiplyScalar(R_EARTH);
      const m = new THREE.Matrix4().lookAt(cam.position, look, _v2.set(0, 1, 0));
      _q.setFromRotationMatrix(m);
      cam.quaternion.copy(f.q0).slerp(_q, smooth(0, 0.4, u));
      if (u >= 1) this._startCityDescent();
    }
  }

  _startCityDescent() {
    // convert the space camera back into the city frame (metres)
    const cam = this.app.camera;
    const inv = this.cityToBody.clone().invert();
    const p = this.camera.position.clone().applyQuaternion(this.sim.earthQuat.clone().invert()).applyMatrix4(inv);
    p.y -= R_EARTH;
    p.multiplyScalar(1000);
    cam.position.copy(p);
    const rq = new THREE.Quaternion().setFromRotationMatrix(this.cityToBody);
    cam.quaternion.copy(rq.invert()).multiply(this.sim.earthQuat.clone().invert()).multiply(this.camera.quaternion);
    this.fade = { phase: 'city', t: 0, dir: -1, startAlt: Math.max(p.y, 4000), startPos: p.clone(), crossing: 1 };
  }

  // --------------------------------------------------------- picking --
  pick(x, y) {
    if (this.mode !== 'space') return;
    const hit = this.hud.pickLabel(x, y);
    if (hit) { this.focus(hit); return; }
    // ray against the planet / moon
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hitSphere = (c, r) => { const s = new THREE.Sphere(c, r); return ray.ray.intersectsSphere(s) ? ray.ray.origin.distanceTo(c) : Infinity; };
    const dm = hitSphere(this.sim.moonPos, R_MOON * 1.3);
    const de = hitSphere(new THREE.Vector3(), R_EARTH);
    if (dm < de && dm < Infinity) this.focus('moon');
    else if (de < Infinity && this.rig.target && this.rig.target.name !== 'earth' && this.rig.target.name !== 'meridian' && this.rig.target.name !== 'halo') this.focus('earth');
  }

  handleKey(e) {
    if (this.mode === 'off') return false;
    if (this.mode !== 'space') return true;          // swallow keys mid-transition
    // the Lodestar: V takes or leaves the helm; its flight keys are its own while flying
    if (e.code === 'KeyV' && this.ship) { this.ship.toggle(); return true; }
    if (this.ship && this.ship.active) {
      if (this.ship.owns(e.code)) return true;
      if (e.code === 'KeyO' || e.code === 'Escape' || Object.values(this.targets).some((t) => t.key && t.key === e.key)) this.ship.exit();
    }
    const k = e.key;
    for (const name of Object.keys(this.targets)) if (this.targets[name].key === k) { this.focus(name); return true; }
    switch (e.code) {
      case 'KeyO': case 'Escape': this.exit(); return true;
      case 'BracketLeft': this.hud.stepWarp(-1); return true;
      case 'BracketRight': this.hud.stepWarp(1); return true;
      case 'KeyP': case 'Space': this.hud.togglePause(); e.preventDefault(); return true;
      case 'ArrowLeft': case 'KeyA': this.rig.rotateBy(0.08, 0); return true;
      case 'ArrowRight': case 'KeyD': this.rig.rotateBy(-0.08, 0); return true;
      case 'ArrowUp': case 'KeyW': this.rig.rotateBy(0, 0.06); return true;
      case 'ArrowDown': case 'KeyS': this.rig.rotateBy(0, -0.06); return true;
      case 'Equal': case 'NumpadAdd': case 'KeyE': this.rig.zoomBy(-0.25); return true;
      case 'Minus': case 'NumpadSubtract': case 'KeyQ': this.rig.zoomBy(0.25); return true;
      case 'KeyH': return false;
      case 'KeyF': return false;
      default: return true;
    }
  }

  updateHud(dt) { this.hud.update(dt); }
}
