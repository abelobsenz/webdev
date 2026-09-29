import * as THREE from 'three';
import { updateCraftMaterial } from '../craft/craftMaterial.js';
import { CRAFT_FRAME, KM, createDressedMaterial, LIVERIES } from './craftMesh.js';
import { createLamps, LAMP } from './lamps.js';
import { CORRIDORS } from './stations.js';
import { design } from './shipDesigns.js';

// THE WORKING LANES: dense, purposeful ship traffic round the Harbour and Selene Works, every
// ship a real hull (src/space/shipDesigns.js) flying an analytic route in its station's frame.
//
//   Harbour   two outer roads, 11 km above and below the arrival and departure corridors (the
//             corridors' own buoys and three-lane road stay the freighters' and the liner's):
//             ships come in tail first under a braking burn, flip at the outer gate, hold on
//             their thrusters, swing wide round the tether (never across it) to the departure
//             side and leave under power; some in convoy, a hauler with a tug on each flank
//             a holding stack of two racetracks off the arrival side, ships waiting for a berth
//             lap slowly with their thrusters puffing at the turns
//   Selene    ore barges up from the Moon (a braking climb tail first), holding beneath the
//             works while their loads are called, then back down; a patrol of lighters
//             circling the works; a convoy of tankers and haulers leaving for the Harbour
//
// All in real time (the fleet's convention), in km in the station frame, the ships' own
// geometry in metres. Hulls are instanced per design (one draw call per sister-ship design),
// drawn only within HULL_RANGE of the station; their lamps (navigation set, cabins, cargo
// floods, docking lights), the drive glows and the RCS puffs are one dynamic lamp buffer per
// station, rewritten each frame from the ships' matrices, so the lanes read as moving lights
// from far off. Per-frame work is allocation-free.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);
const hash = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

export const HULL_RANGE = 900;          // km from the station: hulls drawn inside this
export const LAMP_RANGE = 60000;        // km: beyond this the whole station's traffic is under a pixel
const PUFF_SLOTS = 4;                   // RCS puffs a ship can show at once
const PUFF_LIFE = 0.9;                  // s
/** A drive plume as lamp sprites along the exhaust: [distance aft in bell radii, size, brightness, whiteness]. */
const PLUME = [[0.5, 1.0, 4.5, 0.55], [2.4, 1.5, 2.0, 0.15], [5.5, 2.3, 0.8, 0.0]];

// ------------------------------------------------------------------ routes ----
/**
 * A route is a closed loop of legs in a station frame (km). Leg kinds:
 *   { k: 'bez', p: [P0, P1, P2, P3], dur, ease: 'in' | 'out' | 'io' | 'lin', face: 'fwd' | 'back', thr }
 *   { k: 'hold', at: P, dur, aimFrom, aimTo }                     station-keeping (the flip)
 *   { k: 'track', c, a, b, r, dur }                                one lap of a racetrack
 * Legs meet end to end; the loop's seam is placed far out, where ships fade (vis) to nothing.
 */
function easeOf(e, s) {
  if (e === 'in') return s * s;
  if (e === 'out') return 1 - (1 - s) * (1 - s);
  if (e === 'io') return s * s * (3 - 2 * s);
  return s;
}

function bez(P, s, out) {
  const a = 1 - s;
  return out.set(0, 0, 0).addScaledVector(P[0], a * a * a).addScaledVector(P[1], 3 * a * a * s).addScaledVector(P[2], 3 * a * s * s).addScaledVector(P[3], s * s * s);
}

/** Racetrack (stadium) centred at c, long axis a (unit), short axis b (unit), half-length L, radius r; u in [0,1). */
function track(leg, u, out) {
  const { c, a, b, L, r } = leg;
  const straight = 2 * L, arc = Math.PI * r, per = 2 * straight + 2 * arc;
  let d = fract(u) * per;
  if (d < straight) return out.copy(c).addScaledVector(a, -L + d).addScaledVector(b, -r);
  d -= straight;
  if (d < arc) { const t = -Math.PI / 2 + d / r; return out.copy(c).addScaledVector(a, L + Math.cos(t) * r).addScaledVector(b, Math.sin(t) * r); }
  d -= arc;
  if (d < straight) return out.copy(c).addScaledVector(a, L - d).addScaledVector(b, r);
  d -= straight;
  const t = Math.PI / 2 + d / r;
  return out.copy(c).addScaledVector(a, -L + Math.cos(t) * r).addScaledVector(b, Math.sin(t) * r);
}

export function makeRoute(legs, { fadeIn = 0.02, fadeOut = 0.02 } = {}) {
  let T = 0;
  for (const l of legs) { l.t0 = T; T += l.dur; }
  // a hold turns the ship from the heading it arrived on to the heading it leaves on
  const n = legs.length;
  legs.forEach((l, i) => {
    if (l.k !== 'hold') return;
    const prev = legs[(i - 1 + n) % n], next = legs[(i + 1) % n];
    if (!l.aimFrom) l.aimFrom = prev.k === 'bez' ? V().subVectors(prev.p[3], prev.p[2]).normalize().multiplyScalar(prev.face === 'back' ? -1 : 1) : V(0, 0, 1);
    if (!l.aimTo) l.aimTo = next.k === 'bez' ? V().subVectors(next.p[1], next.p[0]).normalize().multiplyScalar(next.face === 'back' ? -1 : 1) : l.aimFrom.clone();
  });
  return { legs, T, fadeIn, fadeOut };
}

/** Position on a route at loop time tau (s, wrapped); returns { leg, s } for heading and throttle. */
const _rs = { leg: null, s: 0, e: 0 };
export function routePos(R, tau, out) {
  const t = ((tau % R.T) + R.T) % R.T;
  const legs = R.legs;
  let leg = legs[legs.length - 1];
  for (let i = 0; i < legs.length; i++) if (t < legs[i].t0 + legs[i].dur) { leg = legs[i]; break; }
  const s = clamp01((t - leg.t0) / leg.dur);
  _rs.leg = leg; _rs.s = s;
  if (leg.k === 'bez') { _rs.e = easeOf(leg.ease, s); bez(leg.p, _rs.e, out); }
  else if (leg.k === 'hold') { _rs.e = s; out.copy(leg.at); }
  else { _rs.e = s; track(leg, (leg.u0 || 0) + s * (leg.laps || 1), out); }
  return _rs;
}

/** Visibility along a route (fades at the far seam). */
export function routeVis(R, tau) {
  const u = fract(tau / R.T);
  if (!(R.fadeIn > 0) && !(R.fadeOut > 0)) return 1;
  return smooth(0, R.fadeIn, u) * (1 - smooth(1 - R.fadeOut, 1, u));
}

// ------------------------------------------------------- station routes ----
const up = V(0, 1, 0);
/** Unit vectors across a lane: e1 horizontal, e2 perpendicular (mostly up). */
function laneBasis(d) {
  const e1 = V().crossVectors(d, up).normalize();
  const e2 = V().crossVectors(e1, d).normalize();
  return { e1, e2 };
}

/**
 * The Harbour's outer roads (Harbour frame, km: x west, y up the tether, z north). side +1 is
 * the upper road, -1 the lower. Arrival: in along dA 11 km off its axis, braking tail first;
 * hold at the outer gate (40 km out) and flip; swing round the tether at 30+ km to the
 * departure side; out along dD under power.
 */
export function harbourRoad(side, { far = 700, gate = 40, off = 11, swing = 34 } = {}) {
  const dA = CORRIDORS.dA.clone().normalize(), dD = CORRIDORS.dD.clone().normalize();
  const A = laneBasis(dA), D = laneBasis(dD);
  const oA = A.e2.clone().multiplyScalar(off * side), oD = D.e2.clone().multiplyScalar(off * side);
  const aFar = dA.clone().multiplyScalar(far).add(oA), aGate = dA.clone().multiplyScalar(gate).add(oA);
  const dGate = dD.clone().multiplyScalar(gate).add(oD), dFar = dD.clone().multiplyScalar(far * 1.2).add(oD);
  // the swing: out to the side (horizontal, perpendicular to the two corridors), never over the tether
  const across = V().crossVectors(V().subVectors(dGate, aGate).setY(0).normalize(), up).normalize().multiplyScalar(side);
  const mid = aGate.clone().add(dGate).multiplyScalar(0.5).setY(aGate.y * 0.5 + dGate.y * 0.5);
  const sw = mid.clone().addScaledVector(across, swing);
  const legs = [
    { k: 'bez', p: [aFar, aFar.clone().lerp(aGate, 0.34), aFar.clone().lerp(aGate, 0.67), aGate], dur: 560, ease: 'out', face: 'back', thr: 1 },
    { k: 'hold', at: aGate, dur: 70 },
    { k: 'bez', p: [aGate, aGate.clone().lerp(sw, 0.6).addScaledVector(across, 12), dGate.clone().lerp(sw, 0.6).addScaledVector(across, 12), dGate], dur: 420, ease: 'io', face: 'fwd', thr: 0.25 },
    { k: 'bez', p: [dGate, dGate.clone().lerp(dFar, 0.33), dGate.clone().lerp(dFar, 0.67), dFar], dur: 520, ease: 'in', face: 'fwd', thr: 1 },
  ];
  return makeRoute(legs, { fadeIn: 0.03, fadeOut: 0.03 });
}

/** A racetrack holding pattern off the Harbour's arrival side at height dy above the arrival road. */
export function harbourStack(level) {
  const dA = CORRIDORS.dA.clone().normalize();
  const { e1 } = laneBasis(dA);
  const c = dA.clone().multiplyScalar(62).add(V(0, 26 + level * 7, 0));
  const leg = { k: 'track', c, a: e1.clone(), b: V().crossVectors(up, e1).normalize(), L: 9, r: 3.2, dur: 1300 + level * 260 };
  return makeRoute([leg], { fadeIn: 0, fadeOut: 0 });
}

/**
 * Selene's ore run (refinery frame, km: +y toward the Earth, the Moon 2,600 km below): up from
 * low over the Moon tail first, braking; hold beneath the works on thrusters; down again.
 */
export function seleneOreRun(k) {
  const a = (k / 3) * TAU + 0.4;
  const hold = V(Math.cos(a) * 9, -8 - k * 1.5, Math.sin(a) * 9);
  const low = V(Math.cos(a) * 60, -2450, Math.sin(a) * 60);
  const away = V(Math.cos(a + 0.5) * 70, -2450, Math.sin(a + 0.5) * 70);
  const legs = [
    { k: 'bez', p: [low, low.clone().lerp(hold, 0.4), hold.clone().add(V(0, -300, 0)), hold], dur: 640, ease: 'out', face: 'back', thr: 0.9 },
    { k: 'hold', at: hold, dur: 150 },
    { k: 'bez', p: [hold, hold.clone().add(V(Math.cos(a) * 20, -60, Math.sin(a) * 20)), away.clone().add(V(0, 900, 0)), away], dur: 700, ease: 'in', face: 'fwd', thr: 0.35 },
  ];
  return makeRoute(legs, { fadeIn: 0.04, fadeOut: 0.04 });
}

/** The lighters' patrol round Selene: a slow tilted circle outside the docking ring. */
export function selenePatrol() {
  const leg = { k: 'track', c: V(0, 1.2, 0), a: V(1, 0, 0), b: V(0, 0.18, 1).normalize(), L: 0.01, r: 12, dur: 1500 };
  return makeRoute([leg], { fadeIn: 0, fadeOut: 0 });
}

/** Selene's convoy road to the Harbour: out along a lane parallel to the tankers' departure corridor, 14 km aside. */
export function seleneConvoyRun() {
  const d = V(-0.3, 1, -0.3).normalize();
  const side = V(1, 0, -1).normalize().multiplyScalar(14);
  const start = side.clone().multiplyScalar(2).add(V(0, 10, 0)), far = start.clone().addScaledVector(d, 1600);
  const back = side.clone().multiplyScalar(2).add(V(8, -6, -2));
  const legs = [
    { k: 'bez', p: [back, back.clone().add(V(0, 6, 0)), start.clone().add(V(0, -4, 0)), start], dur: 360, ease: 'io', face: 'fwd', thr: 0.2 },
    { k: 'bez', p: [start, start.clone().addScaledVector(d, 400), start.clone().addScaledVector(d, 1000), far], dur: 700, ease: 'in', face: 'fwd', thr: 1 },
    { k: 'bez', p: [far.clone(),far.clone().lerp(back, 0.5).add(V(60, 0, 0)), back.clone().add(V(0, -30, 0)), back], dur: 800, ease: 'out', face: 'back', thr: 0.8 },
  ];
  return makeRoute(legs, { fadeIn: 0.0, fadeOut: 0.0 });
}

/**
 * A work drone's circuit over the tenders (the tender group's frame, km; src/space/fleet.js lays
 * the three tenders out round the capture at the origin). The drone hops from station to
 * station 0.40 or 0.62 km above each tender's centre (above the discs their hulls sweep as they
 * yaw), hovering at each to work; odd drones fly the circuit the other way.
 */
export const TENDER_STATIONS = [V(-1.464, -0.271, -1.382), V(-0.214, 0.002, -0.332), V(1.036, -0.498, -0.382)];
export function tenderCircuit(group) {
  // two crews: the low one works round the tenders one way, the high one (220 m above, a
  // little aside) the other way; within a crew the drones fly one circuit, evenly spaced
  const h = group ? 0.62 : 0.4, shift = group ? V(0.1, 0, 0.1) : V();
  const order = group ? [0, 2, 1] : [0, 1, 2];
  const P = order.map((k) => TENDER_STATIONS[k].clone().add(shift).add(V(0, h, 0)));
  const legs = [];
  for (let k = 0; k < 3; k++) {
    const a = P[k], b = P[(k + 1) % 3];
    const yFl = Math.max(...P.map((q) => q.y)) + 0.15;   // one flight level for the crew, over every tender's swept disc
    legs.push({ k: 'bez', p: [a, a.clone().lerp(b, 0.3).setY(yFl), a.clone().lerp(b, 0.7).setY(yFl), b], dur: 55, ease: 'io', face: 'fwd', thr: 0.6 });
    legs.push({ k: 'hold', at: b, dur: 20 });
  }
  return makeRoute(legs, { fadeIn: 0, fadeOut: 0 });
}

// ------------------------------------------------------------------ ships ----
/** Formations (path frame: x across, y up, z along; km). */
export const FORMATION = {
  solo: [[0, 0, 0]],
  escort: [[0, 0, 0], [0.5, 0.05, 0.08], [-0.5, 0.05, 0.08]],            // a hauler with a tug on each flank
  vee: [[0, 0, 0], [0.62, 0, -0.5], [-0.62, 0, -0.5]],
  line: [[0, 0, 0], [0, 0.12, -0.9], [0, 0.24, -1.8]],
};

const _p = new THREE.Vector3(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _vel = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _f = new THREE.Vector3(), _t = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _w = new THREE.Vector3();
const _spin = new THREE.Matrix4();

/**
 * Local pose of a ship at real time t: position (km), forward (unit), throttle, visibility and
 * the RCS demand (0..1), all in the station frame. Exported for the verifier.
 */
export function shipPose(ship, t, outPos, outFwd, outUp) {
  const R = ship.route;
  const tau = t + ship.phase;
  const st = routePos(R, tau, outPos);
  const leg = st.leg, s = st.s;
  // velocity by central difference (legs meet with matching positions, so this is smooth across them)
  routePos(R, tau + 0.5, _pa);
  routePos(R, tau - 0.5, _pb);
  _vel.subVectors(_pa, _pb);
  const speed = _vel.length();
  let thr = 0, rcs = 0;
  if (leg.k === 'hold') {
    const w = smooth(0.1, 0.8, s);
    outFwd.copy(leg.aimFrom).multiplyScalar(1 - w).addScaledVector(leg.aimTo, w).addScaledVector(up, Math.sin(Math.PI * w) * 0.8).normalize();
    rcs = 0.35 + 0.65 * Math.sin(Math.PI * w);
  } else {
    if (speed > 1e-7) outFwd.copy(_vel).multiplyScalar(1 / speed); else outFwd.set(0, 0, 1);
    if (leg.face === 'back') outFwd.negate();
    if (leg.k === 'bez') {
      if (leg.ease === 'out') thr = leg.thr * smooth(0, 0.05, s) * (1 - smooth(0.8, 0.98, s));
      else if (leg.ease === 'in') thr = leg.thr * smooth(0.02, 0.1, s) * (1 - smooth(0.93, 1, s));
      else thr = leg.thr * (1 - smooth(0.06, 0.2, s) + smooth(0.8, 0.94, s) * (1 - smooth(0.94, 1, s)));
      rcs = ship.fidget * (leg.ease === 'io' ? 0.5 : 0.12);
    } else {
      // racetrack: coasting on thrusters, puffs where the track turns
      const u = fract((leg.u0 || 0) + s * (leg.laps || 1));
      const per = 4 * leg.L + 2 * Math.PI * leg.r;
      const d = u * per, a0 = 2 * leg.L, a1 = a0 + Math.PI * leg.r, a2 = a1 + 2 * leg.L;
      rcs = (d > a0 && d < a1) || d > a2 ? 0.6 : 0.08;
    }
  }
  // formation offset in the path frame (the leader's heading and the station's up)
  const f = ship.slot;
  if (f[0] || f[1] || f[2]) {
    _z.copy(speed > 1e-7 ? _vel : outFwd).normalize();
    _x.crossVectors(up, _z);
    if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0);
    _x.normalize();
    _y.crossVectors(_z, _x);
    outPos.addScaledVector(_x, f[0]).addScaledVector(_y, f[1]).addScaledVector(_z, f[2]);
  }
  if (outUp) {
    // bank a little into turns on the track, otherwise keep the station's up
    outUp.copy(up);
  }
  ship.thr = thr;
  ship.rcs = rcs;
  ship.vis = routeVis(R, tau);
  return ship;
}

// ---------------------------------------------------------------- station ----
/**
 * One station's traffic: the ships, their instanced hulls by design and one dynamic lamp
 * buffer. frameObj: the Object3D whose world transform is the station frame (km).
 */
export class StationTraffic {
  constructor(space, name, frameObj, roster, designs, { engineColor = LAMP.BLUE } = {}) {
    this.space = space;
    this.name = name;
    this.frameObj = frameObj;
    this.group = new THREE.Group();
    this.group.userData.world = new THREE.Vector3();
    this.engineColor = engineColor;
    this.ships = [];
    // instanced hulls, one per design
    this.sets = designs.map((d) => {
      const lv = LIVERIES[((d.seed ?? 0) * 3 + (d.kind || '').length) % LIVERIES.length];
      const mat = createDressedMaterial({ accent: d.accent || [0.55, 0.88, 1.0], lit: 0.6, livery: d.livery || lv[0], livery2: d.livery2 || lv[1] });
      const im = new THREE.InstancedMesh(d.geo, mat, Math.max(1, roster.filter((r) => r.design === d).length));
      im.count = 0;
      im.frustumCulled = false;
      im.renderOrder = 3;
      im.onBeforeRender = (r, sc, cam) => {
        updateCraftMaterial(mat, cam, CRAFT_FRAME.sunDir, this.group.userData.world, CRAFT_FRAME.time);
        mat.uniformsNeedUpdate = true;
      };
      this.group.add(im);
      // spinning parts (a clipper's habitat rings): their own instanced meshes, same material
      const spins = (d.spin?.rings || []).map((ring) => {
        const sm = new THREE.InstancedMesh(ring.geo, mat, im.instanceMatrix.count);   // same capacity as the hulls (im.count is 0 here)
        sm.count = 0; sm.frustumCulled = false; sm.renderOrder = 3; sm.onBeforeRender = im.onBeforeRender;
        this.group.add(sm);
        return { im: sm, omega: ring.omega };
      });
      return { design: d, im, n: 0, spins };
    });
    // ships and their lamp slots
    let nl = 0;
    for (const r of roster) {
      const set = this.sets.find((s) => s.design === r.design);
      const ship = {
        ...r, set, index: set.n++, scale: (r.scale || 1),
        lamp0: nl, nLamps: r.design.lamps.length, glow0: 0, puff0: 0,
        thr: 0, rcs: 0, vis: 1, pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0),
        world: new THREE.Vector3(), mat: new THREE.Matrix4(), puffs: new Float32Array(PUFF_SLOTS * 2).fill(-1),
      };
      nl += ship.nLamps;
      ship.glow0 = nl; nl += r.design.glows.length * PLUME.length;
      ship.puff0 = nl; nl += PUFF_SLOTS;
      ship.spin0 = nl; ship.nSpin = r.design.spin?.lamps.length || 0; nl += ship.nSpin;
      this.ships.push(ship);
    }
    for (const s of this.sets) { s.im.count = s.n; for (const sp of s.spins) sp.im.count = s.n; }
    // the lamp buffer: static colours for the ship lamps, dynamic for glows and puffs
    const placeholder = Array.from({ length: nl }, () => ({ p: new THREE.Vector3(), r: 0, color: [0, 0, 0], i: 0 }));
    for (const sh of this.ships) {
      sh.design.lamps.forEach((l, k) => { placeholder[sh.lamp0 + k] = { ...l, p: l.p.clone(), dir: l.dir ? l.dir.clone() : undefined }; });
      if (sh.nSpin) sh.design.spin.lamps.forEach((l, k) => { placeholder[sh.spin0 + k] = { ...l, p: l.p.clone(), dir: l.dir ? l.dir.clone() : undefined }; });
    }
    this.lamps = createLamps(placeholder, { minPx: 1.25 });
    this.lamps.renderOrder = 17;
    this.group.add(this.lamps);
    const g = this.lamps.geometry;
    this.aL = g.getAttribute('iLamp'); this.aC = g.getAttribute('iCol'); this.aD = g.getAttribute('iDir');
    this.aL.setUsage(THREE.DynamicDrawUsage); this.aC.setUsage(THREE.DynamicDrawUsage); this.aD.setUsage(THREE.DynamicDrawUsage);
    // the ships' lamps in their own frames (metres), kept for the per-frame transform
    this.baseLamps = new Float32Array(nl * 4);
    this.baseDirs = new Float32Array(nl * 4);
    this.baseCols = new Float32Array(nl * 4);
    this.baseLamps.set(this.aL.array); this.baseDirs.set(this.aD.array); this.baseCols.set(this.aC.array);
    space.scene.add(this.group);
    this.hullsOn = true;
    // the body's bound (for tools that read centre and radius): every route, sampled, plus the
    // largest hull's metre-scale geometry; the depth slices use the tight interval below
    let reach = 0;
    const p = new THREE.Vector3(), f = new THREE.Vector3();
    for (const sh of this.ships) for (let t = 0; t < sh.route.T; t += 5) { shipPose(sh, t, p, f); reach = Math.max(reach, p.length()); }
    for (const d of designs) reach = Math.max(reach, d.radius * 1.05);
    this.reach = reach + 5;
    this.body = space.addBody(`fleetTraffic-${name}`, [this.group], (o) => this.group.getWorldPosition(o || _w), this.reach, {
      solid: true,
      interval: (cam) => this.interval(cam),
    });
  }

  /** Nearest and furthest ship from the camera (km), for the depth slices. */
  interval(cam) {
    let dmin = Infinity, dmax = 0;
    for (const s of this.ships) {
      if (s.vis <= 0) continue;
      const d = s.world.distanceTo(cam), r = s.design.radius * KM * s.scale * 1.2 + 0.05;
      if (d - r < dmin) dmin = d - r;
      if (d + r > dmax) dmax = d + r;
    }
    if (!(dmax > 0)) return [1, 0];
    return [Math.max(dmin, 0.002), dmax];
  }

  update(t, dt, cam) {
    const fo = this.frameObj;
    fo.updateMatrixWorld(true);
    fo.getWorldPosition(this.group.position);
    fo.getWorldQuaternion(this.group.quaternion);
    this.group.updateMatrixWorld(true);
    this.group.userData.world.copy(this.group.position);
    const camD = cam ? cam.position.distanceTo(this.group.position) : 0;
    this.group.visible = camD < LAMP_RANGE;
    if (!this.group.visible) return;
    const hulls = camD < HULL_RANGE + 1800;
    for (const s of this.sets) { s.im.visible = hulls; for (const sp of s.spins) sp.im.visible = hulls; }
    const L = this.aL.array, C = this.aC.array, D = this.aD.array;
    const bL = this.baseLamps, bD = this.baseDirs, bC = this.baseCols;
    const eng = this.engineColor;
    for (const sh of this.ships) {
      shipPose(sh, t, sh.pos, sh.fwd, sh.up);
      // orientation: +Z forward, +Y toward the station's up
      _z.copy(sh.fwd);
      _x.crossVectors(sh.up, _z);
      if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0).cross(_z);
      _x.normalize();
      _y.crossVectors(_z, _x);
      const k = KM * sh.scale * (sh.vis > 0.02 ? 1 : 0);
      sh.mat.makeBasis(_x, _y, _z).scale(_s.set(k, k, k)).setPosition(sh.pos);
      sh.world.copy(sh.pos).applyMatrix4(this.group.matrixWorld);
      if (hulls) sh.set.im.setMatrixAt(sh.index, sh.mat);
      // spinning rings: the ship's matrix turned about its own +Z (each ring its own sense)
      const spins = sh.set.spins;
      for (let j = 0; j < spins.length; j++) {
        _spin.makeRotationZ(spins[j].omega * t + sh.seed).premultiply(sh.mat);
        if (hulls) spins[j].im.setMatrixAt(sh.index, _spin);
      }
      if (sh.nSpin) {
        const per = sh.design.spin.perRing, se = _spin.elements;
        for (let j = 0; j < spins.length; j++) {
          _spin.makeRotationZ(spins[j].omega * t + sh.seed).premultiply(sh.mat);
          for (let i = sh.spin0 + j * per; i < sh.spin0 + (j + 1) * per; i++) {
            const o = i * 4, x = bL[o], y = bL[o + 1], z = bL[o + 2];
            L[o] = se[0] * x + se[4] * y + se[8] * z + se[12];
            L[o + 1] = se[1] * x + se[5] * y + se[9] * z + se[13];
            L[o + 2] = se[2] * x + se[6] * y + se[10] * z + se[14];
            L[o + 3] = bL[o + 3] * k;
            const ik = k > 0 ? 1 / k : 0, dx = bD[o], dy = bD[o + 1], dz = bD[o + 2];
            D[o] = (se[0] * dx + se[4] * dy + se[8] * dz) * ik; D[o + 1] = (se[1] * dx + se[5] * dy + se[9] * dz) * ik; D[o + 2] = (se[2] * dx + se[6] * dy + se[10] * dz) * ik;
            C[o] = bC[o] * sh.vis; C[o + 1] = bC[o + 1] * sh.vis; C[o + 2] = bC[o + 2] * sh.vis;
          }
        }
      }
      // lamps: transform the ship-frame records by the ship's matrix
      const e = sh.mat.elements;
      const vis = sh.vis;
      const n1 = sh.puff0 + PUFF_SLOTS;
      for (let i = sh.lamp0; i < sh.puff0; i++) {
        const o = i * 4;
        const x = bL[o], y = bL[o + 1], z = bL[o + 2];
        L[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
        L[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        L[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        L[o + 3] = bL[o + 3] * k;
        const dx = bD[o], dy = bD[o + 1], dz = bD[o + 2];
        if (dx !== 0 || dy !== 0 || dz !== 0) {
          const ik = k > 0 ? 1 / k : 0;
          D[o] = (e[0] * dx + e[4] * dy + e[8] * dz) * ik; D[o + 1] = (e[1] * dx + e[5] * dy + e[9] * dz) * ik; D[o + 2] = (e[2] * dx + e[6] * dy + e[10] * dz) * ik;
        }
        C[o] = bC[o] * vis; C[o + 1] = bC[o + 1] * vis; C[o + 2] = bC[o + 2] * vis;
      }
      // drive glows: at the bells, radius and brightness with the throttle
      const gl = sh.design.glows;
      // each bell's glow is a short plume: the throat, then two puffs of exhaust trailing aft,
      // longer and softer with the throttle (a flickering few percent, never a blink)
      const flick = 0.94 + 0.06 * Math.sin(t * 23.0 + sh.seed * 5.1);
      for (let j = 0; j < gl.length; j++) {
        const g = gl[j];
        for (let q = 0; q < PLUME.length; q++) {
          const o = (sh.glow0 + j * PLUME.length + q) * 4, pl = PLUME[q];
          const back = g.r * pl[0] * (0.4 + sh.thr);
          const x = g.p.x + g.dir.x * back, y = g.p.y + g.dir.y * back, z = g.p.z + g.dir.z * back;
          L[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
          L[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          L[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          L[o + 3] = g.r * k * pl[1] * (0.6 + 0.9 * sh.thr);
          const b = sh.thr * pl[2] * vis * flick;
          // the throat runs hotter (whiter) than the plume
          const w = pl[3];
          C[o] = (eng[0] * (1 - w) + w) * b; C[o + 1] = (eng[1] * (1 - w) + w) * b; C[o + 2] = (eng[2] * (1 - w) + w) * b;
          D[o] = 0; D[o + 1] = 0; D[o + 2] = 0; D[o + 3] = 0;
        }
      }
      // RCS puffs: short white bursts from real nozzles, more of them while the ship manoeuvres
      const rc = sh.design.rcs;
      if (rc.length) {
        for (let j = 0; j < PUFF_SLOTS; j++) {
          const o = (sh.puff0 + j) * 4;
          // each slot fires on its own clock: a window per ~2 s whose chance rises with demand
          const period = 1.7 + j * 0.37;
          const cyc = Math.floor((t + sh.seed * 13.1) / period);
          const age = (t + sh.seed * 13.1) - cyc * period;
          const fire = hash(cyc * 7.31 + j * 19.7 + sh.seed) < sh.rcs * 0.9 && age < PUFF_LIFE;
          if (!fire || vis < 0.05) { C[o] = 0; C[o + 1] = 0; C[o + 2] = 0; L[o + 3] = 0; continue; }
          const nz = rc[Math.floor(hash(cyc * 3.7 + j + sh.seed * 1.3) * rc.length) % rc.length];
          const a = age / PUFF_LIFE;
          const reach = 0.6 + 5.0 * a;                          // metres: the plume blossoms out of the nozzle
          const x = nz.p.x + nz.dir.x * reach, y = nz.p.y + nz.dir.y * reach, z = nz.p.z + nz.dir.z * reach;
          L[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
          L[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          L[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          L[o + 3] = (0.5 + 2.6 * a) * k;
          const b = 2.2 * (1 - a) * (1 - a) * vis;
          C[o] = 0.92 * b; C[o + 1] = 0.95 * b; C[o + 2] = 1.0 * b;
          D[o] = 0; D[o + 1] = 0; D[o + 2] = 0; D[o + 3] = 0;
        }
      }
    }
    this.aL.needsUpdate = true; this.aC.needsUpdate = true; this.aD.needsUpdate = true;
    if (hulls) for (const s of this.sets) { s.im.instanceMatrix.needsUpdate = true; for (const sp of s.spins) sp.im.instanceMatrix.needsUpdate = true; }
  }
}

// ------------------------------------------------------------------ fleet ----
/** Sister-ship families: a few seeded designs per class (shared by both stations). */
export function buildFamilies() {
  const fam = {};
  const seeds = { drone: [1, 2, 3], hauler: [3, 8, 21], tanker: [5, 12], tug: [2, 7, 11], packet: [4, 9], barge: [6, 14], lighter: [1, 10], clipper: [2, 5] };
  const accents = { drone: [0.5, 1.0, 0.8], hauler: [1.0, 0.72, 0.45], tanker: [1.0, 0.62, 0.35], tug: [1.0, 0.8, 0.35], packet: [0.55, 0.88, 1.0], barge: [1.0, 0.66, 0.4], lighter: [0.5, 1.0, 0.8], clipper: [0.6, 0.9, 1.0] };
  for (const [k, list] of Object.entries(seeds)) fam[k] = list.map((sd) => ({ ...design(k, sd), accent: accents[k], seed: sd }));
  return fam;
}

export class FleetTraffic {
  constructor(space, fleet) {
    this.space = space;
    const fam = buildFamilies();
    this.families = fam;
    const pick = (cls, i) => { const n = fam[cls].length; return fam[cls][((Math.round(i) % n) + n) % n]; };
    // ---- the Harbour
    const H = [];
    const roads = [harbourRoad(1), harbourRoad(-1)];
    this.harbourRoads = roads;
    const mix = ['hauler', 'tanker', 'packet', 'clipper', 'hauler', 'packet', 'tanker', 'hauler', 'packet', 'clipper'];
    roads.forEach((R, ri) => {
      const n = 13;
      for (let i = 0; i < n; i++) {
        const cls = mix[(i + ri * 3) % mix.length];
        const phase = (i / n) * R.T + ri * 91;
        if (ri === 1 && i === 5) {
          // the scheduled packet train: three packets in line astern in this ship's slot
          FORMATION.line.forEach((sl, j) => H.push({ route: R, phase, design: pick('packet', j), scale: 1, slot: sl, seed: 60 + j, fidget: 0.4 }));
          continue;
        }
        const lead = { route: R, phase, design: pick(cls, i + ri), scale: cls === 'packet' || cls === 'clipper' ? 1 : 1.6, slot: [0, 0, 0], seed: 1 + i + ri * 17, fidget: 0.6 };
        H.push(lead);
        // every third hauler runs in convoy, a tug on each flank
        if (cls === 'hauler' && i % 3 === 0) {
          for (const sl of FORMATION.escort.slice(1)) H.push({ ...lead, design: pick('tug', i + sl[0] * 10), scale: 1, slot: sl, seed: lead.seed + sl[0] * 31, fidget: 1 });
        }
      }
    });
    this.stacks = [harbourStack(0), harbourStack(1)];
    this.stacks.forEach((R, li) => {
      const n = li ? 6 : 7;
      for (let i = 0; i < n; i++) {
        const cls = ['tanker', 'hauler', 'packet', 'lighter', 'hauler', 'clipper', 'tanker'][(i + li) % 7];
        H.push({ route: R, phase: (i / n) * R.T, design: pick(cls, i + li), scale: cls === 'lighter' ? 1.5 : cls === 'packet' || cls === 'clipper' ? 1 : 1.4, slot: [0, 0, 0], seed: 40 + i + li * 7, fidget: 0.4 });
      }
    });
    const hDesigns = [...new Set(H.map((r) => r.design))];
    this.harbour = new StationTraffic(space, 'harbour', space.elevator.harbour, H, hDesigns, { engineColor: LAMP.BLUE });
    // ---- Selene
    const S = [];
    for (let k = 0; k < 3; k++) {
      const R = seleneOreRun(k);
      for (let i = 0; i < 2; i++) S.push({ route: R, phase: (i / 2) * R.T + k * 233, design: pick('barge', k + i), scale: 1.3, slot: [0, 0, 0], seed: 70 + k * 3 + i, fidget: 0.5 });
    }
    const pat = selenePatrol();
    for (let i = 0; i < 6; i++) S.push({ route: pat, phase: (i / 6) * pat.T, design: pick(i % 2 ? 'tug' : 'lighter', i), scale: 1.2, slot: [0, 0, 0], seed: 90 + i, fidget: 0.8 });
    const conv = seleneConvoyRun();
    for (let g = 0; g < 2; g++) {
      FORMATION.vee.forEach((sl, j) => S.push({ route: conv, phase: g * conv.T * 0.5, design: pick(j ? 'hauler' : 'tanker', j + g), scale: 1.3, slot: sl, seed: 110 + g * 5 + j, fidget: 0.3 }));
    }
    const sDesigns = [...new Set(S.map((r) => r.design))];
    // ---- the reclamation crews' drones, working between the three tenders over the Halo
    const T = [], crews = [tenderCircuit(0), tenderCircuit(1)];
    for (let i = 0; i < 9; i++) {
      const g = i % 2, R = crews[g], n = g ? 4 : 5;
      T.push({ route: R, phase: (Math.floor(i / 2) / n) * R.T, design: pick('drone', i), scale: 1, slot: [0, 0, 0], seed: 130 + i, fidget: 1 });
    }
    this.tenders = new StationTraffic(space, 'tenders', fleet.tenderGroup, T, [...new Set(T.map((r) => r.design))], { engineColor: [0.55, 1.0, 0.85] });
    this.selene = new StationTraffic(space, 'selene', fleet.refinery, S, sDesigns, { engineColor: [1.0, 0.7, 0.42] });
    this.stations = [this.harbour, this.selene, this.tenders];
  }

  update(sim, realTime, dt, space) {
    const cam = space.camera;
    for (const s of this.stations) s.update(realTime, dt, cam);
  }

  /** Total instanced hull triangles when every hull is drawn. */
  triangles() {
    let n = 0;
    for (const st of this.stations) for (const s of st.sets) n += (s.design.geo.index.count / 3) * s.n;
    return n;
  }
}
