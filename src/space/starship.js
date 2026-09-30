import * as THREE from 'three';
import { craftMesh, craftPart, addLamps } from './craftMesh.js';
import { createEngine, ENGINE_FRAME } from './exhaust.js';
import { createRcsJet } from './plume.js';
import { V3, merge } from './lodestarKit.js';
import { SHIP, buildHull, hullPt } from './lodestarHull.js';
import { buildBridge, BRIDGE_EYE } from './lodestarBridge.js';
import { buildGear, poseGear } from './lodestarGear.js';
import { buildDrive, ENGINE_MOUNTS, THROAT_DZ, ZS } from './lodestarDrive.js';

// The Concord starcourier "Lodestar": the ship the visitor flies in the orbital view. A 36 m
// lifting-body cutter drawn in metres with the craft material (view-space sunlight, the Earth's
// shadow, earthshine, the Earth mirrored in its glazing) like every other hull out here:
//   hull      a manta-lens section, its plates parted by real seams, heat-shield tiles on the belly,
//             bronze chine strakes, framed window rows, hatches, cargo doors, the name on both bows
//             (space/lodestarHull.js)
//   bridge    a glazed flight deck amidships, furnished (consoles with live screens, seats); the
//             bridge camera is the pilot's eye (space/lodestarBridge.js)
//   gear      a landing tripod in belly bays: doors, struts, sliding oleos with torque links, feet
//             that level themselves; the dorsal docking ring with petals and latches; landing
//             lights (space/lodestarGear.js)
//   drive     a main engine and two auxiliaries on a thrust structure (chambers, gimbals, pumps and
//             feed lines, space/lodestarDrive.js) with their glowing bells and plumes
//             (space/exhaust.js), reverse pods on the bow flanks, RCS quads fore and aft
//   radiators ribbed radiator wings from the chines and canted stern fins
// Nose toward -Z, up +Y, starboard +X. The close-up dressing (tiles, interior, greebles) is its
// own mesh, drawn only while the camera is within DETAIL_KM.

export { SHIP };
const DETAIL_KM = 0.55;

// Ship-local points other systems rely on (metres; nose -Z, up +Y, starboard +X). The landing
// physics stands the ship on LODESTAR_FEET and the autopilot mates LODESTAR_DOCK to station ports;
// keep these names (and their accuracy: tools/verify-lodestar.mjs measures them) whenever the
// model changes.
/** The soles of the foot pads with the legs fully down (nose, starboard main, port main). */
export const LODESTAR_FEET = [V3(0, -6.95, -11.092), V3(4.229, -6.95, 12.621), V3(-4.229, -6.95, 12.621)];
/** The dorsal docking ring's mating face centre and its outward axis. */
export const LODESTAR_DOCK = { pos: V3(0, 3.233, -9.5), axis: V3(0, 1, 0) };
/** The pilot's eye on the flight deck (where the bridge camera belongs). */
export const LODESTAR_EYE = BRIDGE_EYE.clone();
const DOCK_Z = -9.5;

export class Starship {
  constructor() {
    this.root = new THREE.Group();            // km units: position and orientation of the ship
    this.root.name = 'Lodestar';
    this.movers = {};
    this.state = { throttle: 0, aux: 0, boost: 0, legs: 0, rcs: 0, reverse: 0, gear: [0, 0, 0], docked: 0, lights: 0, gimbal: [0, 0] };
    this._camD = 1;
    this._t = 0;
    this._build();
  }

  _build() {
    const H = buildHull(), B = buildBridge(), D = buildDrive();
    const hull = craftMesh(merge([...H.base, ...B.base, ...D.geo]), { accent: [0.5, 0.82, 1.0], lit: 0.75, fill: 0.03, flood: 1 });
    hull.name = 'Lodestar hull';
    this.root.add(hull);
    this.hull = hull;
    const part = (g) => craftPart(hull, g);
    // camera distance for the detail switch (km, from the last frame drawn)
    const draw = hull.onBeforeRender;
    hull.onBeforeRender = (r, s, cam, ...rest) => { draw(r, s, cam, ...rest); this._camD = cam.position.distanceTo(hull.userData.world); };

    // close-up dressing: tiles, frames, greebles, the furnished flight deck
    this.detail = part(merge([...H.detail, ...B.detail]));
    this.detail.name = 'Lodestar detail';
    hull.add(this.detail);
    B.screens.name = 'Lodestar screens';
    hull.add(B.screens);
    this.screenU = B.screenU;
    this.canopy = B.glass;
    const gU = B.glassU, _up = new THREE.Vector3();
    B.glass.onBeforeRender = (r, s, cam) => {
      gU.uSunView.value.copy(ENGINE_FRAME.sunDir).transformDirection(cam.matrixWorldInverse);
      gU.uUpView.value.copy(_up.set(0, 1, 0).transformDirection(hull.matrixWorld)).transformDirection(cam.matrixWorldInverse);
    };
    hull.add(B.glass);

    // gear, docking ring, landing lights
    const G = buildGear(hull, part, { dockZ: DOCK_Z });
    this.gear = G;
    this.fittings = part(merge(G.staticGeo));
    this.fittings.name = 'Lodestar fittings';
    hull.add(this.fittings);
    this.movers.legs = G.legs;
    this.movers.doors = G.doors;
    this.movers.dock = { petals: G.petals, latches: G.latches };

    // ---- engines (metres, in the hull's frame: their axis +Z, exhaust aft)
    this.engineMounts = ENGINE_MOUNTS;
    this.engines = [];
    for (const e of ENGINE_MOUNTS) {
      const eng = createEngine({ rt: e.rt, re: e.re, len: e.len, plumeLen: e.re * (e.main ? 19 : 16) });
      eng.position.set(e.p.x, e.p.y, ZS + THROAT_DZ);
      hull.add(eng);
      this.engines.push({ g: eng, main: !!e.main });
    }
    // reverse engines: their axis +Z turned to face forward, canted 0.3 rad outboard
    this.reverseMounts = D.reverseMounts;
    this.reverse = this.reverseMounts.map((m) => {
      const eng = createEngine({ rt: 0.2, re: 0.5, len: 1.1, plumeLen: 0.5 * 15 });
      eng.position.copy(m.p);
      eng.rotation.y = Math.PI - m.side * 0.3;
      hull.add(eng);
      return eng;
    });
    // RCS: a cold-gas jet at every nozzle, with the force and torque it gives the ship (for thruster
    // selection: each manoeuvre fires the nozzles that push the right way)
    this.rcs = D.rcs;
    this.jets = this.rcs.map((n) => {
      const jet = createRcsJet(n.p, n.dir);
      hull.add(jet);
      const F = n.dir.clone().negate();                                   // the push on the ship
      const tau = new THREE.Vector3().crossVectors(n.p, F);
      return { jet, F, tau: tau.lengthSq() > 1e-8 ? tau.normalize() : tau };
    });

    // ---- lights: navigation (port red, starboard green, stern white), beacons, strobes, the
    // docking ring's lamps, and the landing lamps (switched)
    this.navTips = H.navTips;
    const zs = ZS;
    addLamps(hull, [
      { p: this.navTips[1], r: 0.3, color: [1.0, 0.12, 0.08], i: 2.2, dir: V3(-1, 0, -0.3).normalize() },   // port
      { p: this.navTips[0], r: 0.3, color: [0.12, 1.0, 0.35], i: 2.2, dir: V3(1, 0, -0.3).normalize() },    // starboard
      { p: V3(0, 1.35, zs + 0.2), r: 0.28, color: [1.0, 1.0, 1.0], i: 1.8 },                                // stern
      { p: hullPt(0.62, Math.PI / 2, 0.3), r: 0.34, color: [1.0, 0.1, 0.05], i: 2.4, breathe: 1 },          // beacon, top
      { p: hullPt(0.5, -Math.PI / 2, 0.3), r: 0.34, color: [1.0, 0.1, 0.05], i: 2.4, breathe: 1, phase: 0.5 }, // beacon, belly
    ], { minPx: 1.2, gain: 1 });
    // the docking ring's lamps: amber and breathing while it is free, steady green once latched
    const ring = (color, i, breathe) => {
      const o = [];
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; o.push({ p: V3(Math.cos(a) * 1.1, LODESTAR_DOCK.pos.y - 0.12, DOCK_Z + Math.sin(a) * 1.1), r: 0.1, color, i, breathe, phase: k / 8 }); }
      return o;
    };
    this.ringLamps = addLamps(hull, ring([1.0, 0.72, 0.3], 1.4, 1), { minPx: 0.8, gain: 1 });
    this.ringLampsDocked = addLamps(hull, ring([0.25, 1.0, 0.45], 1.6, 0), { minPx: 0.8, gain: 1 });
    this.ringLampsDocked.visible = false;
    this.landingLamps = addLamps(hull, G.lampSpots, { minPx: 1.0, gain: 1 });
    // strobes: wingtips and fin tips, a double flash every 1.4 s
    const strobe = [...this.navTips.map((p) => ({ p: p.clone().add(V3(0, 0.12, 0.5)), r: 0.34, color: [1, 1, 1], i: 3.2 })), ...H.finTips.map((p) => ({ p, r: 0.28, color: [1, 1, 1], i: 2.6 }))];
    this.strobes = addLamps(hull, strobe, { minPx: 1.3, gain: 1 });
  }

  /**
   * Animate: throttle 0..1 (main), aux 0..1 (small engines), boost 0/1, legs 0..1; ang / lin: the
   * angular and linear acceleration the thrusters are asked for (ship frame, in units of their
   * capacity); sunlit 0..1 (the cold-gas puffs only show in sunlight); time (s). Optional: gear
   * (three oleo compressions 0..1, nose / starboard / port), docked 0..1 (latches closed), lights
   * 0..1 (landing lights; on with the legs by default).
   */
  update(dt, s) {
    const st = this.state, k = (r) => 1 - Math.exp(-dt * r);
    st.throttle += (s.throttle - st.throttle) * k(6);
    st.aux += ((s.aux ?? s.throttle) - st.aux) * k(6);
    st.boost += (s.boost - st.boost) * k(3);
    st.legs += ((s.legs || 0) - st.legs) * k(1.2);
    st.rcs += ((s.rcs || 0) - st.rcs) * k(12);
    const gin = s.gear;
    for (let i = 0; i < 3; i++) st.gear[i] += (((gin && gin[i]) || 0) - st.gear[i]) * k(20);
    st.docked += ((s.docked ? Math.min(1, +s.docked) : 0) - st.docked) * k(2.5);
    const lightsOn = s.lights ?? (st.legs > 0.5 ? 1 : 0);
    st.lights += ((lightsOn ? 1 : 0) - st.lights) * k(8);
    poseGear(this.gear, st.legs, st.gear, st.docked, st.lights);
    for (const e of this.engines) e.g.setThrust(e.main ? Math.min(1, st.throttle) : st.aux, dt, st.boost);
    // gimbals: the bells swing (up to ~6 degrees) to help the pitch and yaw the thrusters are asked
    // for, centring when the drive is cold. Pitch up (+x) tilts the exhaust up, yaw left (+y) tilts
    // it to port, so the thrust at the stern turns the nose the right way.
    const burning = st.throttle > 0.02 || st.aux > 0.02, G = 0.105;
    const gx = burning && s.ang ? Math.max(-G, Math.min(G, -s.ang.x * 0.12)) : 0, gy = burning && s.ang ? Math.max(-G, Math.min(G, -s.ang.y * 0.12)) : 0;
    st.gimbal[0] += (gx - st.gimbal[0]) * k(5); st.gimbal[1] += (gy - st.gimbal[1]) * k(5);
    for (const e of this.engines) { e.g.rotation.order = 'YXZ'; e.g.rotation.x = st.gimbal[0]; e.g.rotation.y = st.gimbal[1]; }
    st.reverse += ((s.reverse || 0) - st.reverse) * k(8);
    if (this.reverse) for (const e of this.reverse) e.setThrust(st.reverse, dt, s.reverseBoost || 0);
    const ang = s.ang, lin = s.lin, sun = s.sunlit ?? 1, time = s.time ?? (this._t += dt);
    for (const j of this.jets) {
      let d = 0;
      if (ang) d += Math.max(0, j.tau.dot(ang));
      if (lin) d += Math.max(0, j.F.dot(lin));
      j.jet.setDemand(d, dt, sun, time);
    }
    // switched and flashing lights, screens, the close-up switch
    if (this.landingLamps) this.landingLamps.visible = st.lights > 0.5;
    if (this.ringLampsDocked) { this.ringLampsDocked.visible = st.docked > 0.5; this.ringLamps.visible = st.docked <= 0.5; }
    if (this.strobes) { const ph = time % 1.4; this.strobes.visible = ph < 0.05 || (ph > 0.16 && ph < 0.21); }
    this.screenU.uTime.value = time;
    const near = this._camD < DETAIL_KM;
    this.detail.visible = near;
    this.hull.children.forEach((c) => { if (c.name === 'Lodestar screens') c.visible = near; });
  }
}

export { ENGINE_FRAME };
