import * as THREE from 'three';
import { lunarMesh, lunarInstanced, createLunarMaterial } from './lunarMaterial.js';
import { kit, seat, mulberry, EXCAVATOR_HUB, TRACKER_AXLE } from './lunarKit.js';
import { buildMediiWorks, TRACK_X, LANDER_SLOTS, slotFrame, YARD } from './lunarWorks.js';
import { shoreV } from './lunarLanding.js';
import { surfaceY } from './lunarSite.js';
import { addLamps } from './craftMesh.js';
import { R_MOON } from './sim.js';

// Life at Medii Landing: everything that moves, and the furniture it moves among.
//
//   the Works      (lunarWorks.js) merged, with its repeated parts instanced from the kit
//   the Fields Line   two four-car trains shuttling the double-track guideway, easing into
//                  each of the five stations and dwelling there
//   the fields     crew and cargo landers parked on the three pads, three more coming down
//                  on a light plume from three kilometres, standing a while, lifting off;
//                  tugs with propellant bowsers circling, suited crews walking round the craft
//   the mine       haulers on the loop from the face to the hopper, bucket wheels turning
//   the roads      rovers on the hamlet roads and the Works service road, keeping right
//   the town       townspeople on the Boulevard's walks, the Strand promenade and round the
//                  Lift plaza, each at their own pace
//   the Bay        harbour launches running out through the moles and round the bay
//   the air        survey drones over the array and the plant
//   the driver     a cargo sled riding the launch pulse down the 36 km guideway and away
//   the array      twelve thousand trackers following the Sun (stowed flat at night)
//
// All in metres in the Landing's site frame (the parent group is the Landing, in km; every
// mesh here carries the 0.001 scale). Per-frame work touches only what is near enough to
// be seen, writes instance matrices in place, and allocates nothing.

const S2 = Math.SQRT1_2;
const UV = (u, v) => [(u - v) * S2, (u + v) * S2];
const ROT_UV = -Math.PI / 4;
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const LIVERY = [[0.14, 0.26, 0.55], [0.86, 0.82, 0.72], [0.7, 0.2, 0.14], [0.2, 0.45, 0.4], [0.9, 0.6, 0.12], [0.35, 0.36, 0.4]];
const CLOTHES = [[0.62, 0.28, 0.18], [0.78, 0.62, 0.3], [0.16, 0.38, 0.42], [0.14, 0.18, 0.34], [0.85, 0.8, 0.7], [0.36, 0.4, 0.2], [0.42, 0.2, 0.34], [0.9, 0.9, 0.88], [0.55, 0.12, 0.1], [0.24, 0.5, 0.62]];
const SUITS = [[0.92, 0.9, 0.86], [0.95, 0.62, 0.18], [0.9, 0.9, 0.86], [0.3, 0.55, 0.85], [0.92, 0.9, 0.86]];

// ------------------------------------------------------------------------ paths --

/** A polyline of site-frame points (metres) with arc length; sampled without allocation. */
export class Path {
  constructor(pts, closed = false) {
    this.p = pts.map((q) => q.clone());
    if (closed && this.p[0].distanceTo(this.p[this.p.length - 1]) > 1e-6) this.p.push(this.p[0].clone());
    this.closed = closed;
    this.s = new Float64Array(this.p.length);
    for (let i = 1; i < this.p.length; i++) this.s[i] = this.s[i - 1] + this.p[i].distanceTo(this.p[i - 1]);
    this.L = this.s[this.p.length - 1];
    this._i = 1;
  }
  /** Position (and unit tangent) at arc length s (clamped, or wrapped when closed). */
  at(s, out, tan) {
    const L = this.L;
    if (this.closed) s = ((s % L) + L) % L; else s = Math.min(Math.max(s, 0), L);
    let i = this._i;
    const S = this.s, n = S.length;
    if (i >= n || S[i - 1] > s) i = 1;
    while (i < n - 1 && S[i] < s) i++;
    this._i = i;
    const a = this.p[i - 1], b = this.p[i];
    const t = (s - S[i - 1]) / Math.max(S[i] - S[i - 1], 1e-9);
    out.copy(a).lerp(b, t);
    if (tan) tan.copy(b).sub(a).normalize();
    return out;
  }
}

/** Ping-pong: distance along a segment of length L at time t for speed v and phase (s). */
const BO = { q: 0, sg: 1 };
const bounce = (t, v, L, ph) => { const q = ((t * v + ph) % (2 * L) + 2 * L) % (2 * L); if (q < L) { BO.q = q; BO.sg = 1; } else { BO.q = 2 * L - q; BO.sg = -1; } return BO; };
const TR = { s: 0, dir: 1 };
/**
 * The mass driver's law (the coil shader's launch pulse follows it): a 60 s cycle, 10 s at the
 * breech, then 40 m/s^2 to the gate (1.7 km/s at 36 km), and on out at that speed.
 */
export function driverS(t, L = 36000) {
  const tau = (((t % 60) + 60) % 60) - 10;
  if (tau <= 0) return 0;
  const s = 20 * tau * tau;
  if (s <= L) return s;
  const tg = Math.sqrt(L / 20);
  return L + 40 * tg * (tau - tg);
}
const LC = { h: 0, thr: 0 };

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _p = new THREE.Vector3(), _t = new THREE.Vector3();
const _e2 = new THREE.Matrix4();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s1 = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
/** Frame with +z along `fwd` and +y as close to `up` as it can be, at p. */
function frameAlong(out, p, fwd, up = UP) {
  _z.copy(fwd).normalize();
  _x.crossVectors(up, _z);
  if (_x.lengthSq() < 1e-10) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_z, _x);
  out.makeBasis(_x, _y, _z);
  out.elements[12] = p.x; out.elements[13] = p.y; out.elements[14] = p.z;
  return out;
}
/** Up at a site-frame point (the sphere's radial). */
function upAt(p, out) { return out.set(p.x, R_MOON * 1000 + surfaceY(p.x, p.z), p.z).normalize(); }

// ------------------------------------------------------------------------ plume --

const PLUME_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const PLUME_FRAG = /* glsl */ `
uniform float uI;
varying vec2 vUv;
void main() {
  // brightest at the nozzle (uv.y = 1 at the cone's narrow top), fading down the column;
  // a pale blue methalox core warming into the dust it raises
  float a = clamp(vUv.y, 0.0, 1.0);
  float core = a * a * a;
  vec3 c = mix(vec3(1.0, 0.7, 0.42), vec3(0.62, 0.78, 1.0), a);
  gl_FragColor = vec4(c * (core * 1.6 + a * 0.12) * uI, 0.0);
}
`;
export function plumeMesh() {
  const g = new THREE.ConeGeometry(9, 42, 18, 1, true);
  g.translate(0, -21, 0);                                     // the narrow top at the nozzle
  const m = new THREE.ShaderMaterial({
    vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG, uniforms: { uI: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 16;
  mesh.visible = false;
  return mesh;
}

// ------------------------------------------------------------------------ the life --

export class LunarTraffic {
  /**
   * landingData: buildMediiLanding()'s result. The Works are built here too (their placements
   * furnish this module), so the whole working half of the town appears together.
   */
  constructor(landingData, { works = null } = {}) {
    const t0 = performance.now();
    this.group = new THREE.Group();
    this.group.name = 'Medii Landing life and Works';
    this.works = works || buildMediiWorks(landingData.plan, landingData.driver, landingData.S.PADS);
    const W = this.works;
    const rnd = mulberry(5150);
    this.mat = createLunarMaterial({ lit: 0.6 });
    this.meshes = {};
    // the Works' unique structures
    this.worksMesh = lunarMesh(W.geo, {}, this.mat);
    this.worksMesh.name = 'Medii Works: the Fields Line, plant, mine, quarter and array';
    addLamps(this.worksMesh, W.lamps, { minPx: 0.9 });
    this.group.add(this.worksMesh);
    // their instanced furniture (silos, radiators, masts, vaults, domes, excavators, boulders)
    this.statics = [];
    for (const [part, list] of Object.entries(W.inst)) {
      const tint = list.some((e) => e.tint);
      const im = lunarInstanced(kit(part), list.length, {}, this.mat, { tint });
      list.forEach((e, i) => { im.setMatrixAt(i, e.m); if (tint) im.instanceColor.setXYZ(i, ...(e.tint || [1, 1, 1])); });
      im.name = `Works ${part}`;
      this.group.add(im);
      this.statics.push(im);
      this.meshes[part] = im;
    }
    this.boulders = this.statics.filter((m) => m.name.startsWith('Works boulder'));

    // --- the array: posts fixed, panels following the Sun ---
    {
      const n = W.trackers.length;
      this.posts = lunarInstanced(kit('tracker'), n, {}, this.mat);
      this.panels = lunarInstanced(kit('panel'), n, {}, this.mat);
      this.panels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.pivot = new Float32Array(n * 3);
      W.trackers.forEach(([x, z], i) => {
        seat(_m, x, z, 0, 0);
        this.posts.setMatrixAt(i, _m);
        upAt(_p.set(x, 0, z), _t);
        this.pivot[i * 3] = x + _t.x * TRACKER_AXLE; this.pivot[i * 3 + 1] = surfaceY(x, z) + _t.y * TRACKER_AXLE; this.pivot[i * 3 + 2] = z + _t.z * TRACKER_AXLE;
      });
      this.posts.name = 'Array tracker posts'; this.panels.name = 'Array panels';
      this.group.add(this.posts, this.panels);
      this.panelRot = new THREE.Matrix4();
      this.panelSun = new THREE.Vector3(0, -2, 0);        // the sun the panels were last turned to
      this.panelNext = 0;                                  // next index to rewrite (chunked)
      this.panelBusy = false;
      this.setPanels(new THREE.Vector3(0, 1, 0), true);
    }

    // --- the Fields Line: two trains of four cars, one on each track ---
    {
      this.rail = new Path(W.rail.pts);
      this.railStops = W.rail.stations.slice().sort((a, b) => a - b);
      this.trams = lunarInstanced(kit('tram'), 8, {}, this.mat, { tint: true });
      this.trams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < 8; i++) this.trams.instanceColor.setXYZ(i, ...(i < 4 ? [0.14, 0.26, 0.55] : [0.72, 0.2, 0.14]));
      this.trams.name = 'Fields Line trains';
      this.group.add(this.trams);
      // a timetable: accelerate at 0.8 m/s^2 to 32 m/s, dwell 28 s at each stop, and back
      const legs = [];
      const stops = this.railStops;
      const leg = (a, b) => {
        const d = Math.abs(b - a), vmax = 32, acc = 0.8;
        const ta = vmax / acc, da = 0.5 * acc * ta * ta;
        const T = d < 2 * da ? 2 * Math.sqrt(d / acc) : 2 * ta + (d - 2 * da) / vmax;
        return { a, b, d, T, dwell: 28, vmax: d < 2 * da ? Math.sqrt(d * acc) : vmax, acc };
      };
      for (let i = 0; i < stops.length - 1; i++) legs.push(leg(stops[i], stops[i + 1]));
      for (let i = stops.length - 1; i > 0; i--) legs.push(leg(stops[i], stops[i - 1]));
      this.legs = legs;
      this.railCycle = legs.reduce((a, l) => a + l.T + l.dwell, 0);
    }

    // --- the landing fields ---
    {
      const PADS = landingData.S.PADS;
      // parked craft face their service towers (lunarWorks.js); the cycling ones turn as they come
      this.slots = LANDER_SLOTS.map((sl, i) => { const f = slotFrame(sl, PADS); return { k: sl[0], u: f.u, v: f.v, x: f.x, z: f.z, part: sl[3], cyc: sl[4], yaw: f.yaw, phase: i * 97.3 }; });
      const byPart = (p) => this.slots.filter((s) => s.part === p);
      this.landers = lunarInstanced(kit('lander'), byPart('lander').length, {}, this.mat);
      this.cargo = lunarInstanced(kit('cargoLander'), byPart('cargoLander').length, {}, this.mat, { tint: true });
      this.landers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      byPart('cargoLander').forEach((s, i) => { seat(_m, s.x, s.z, s.yaw, 1.2); this.cargo.setMatrixAt(i, _m); this.cargo.instanceColor.setXYZ(i, ...LIVERY[i % LIVERY.length]); });
      byPart('lander').forEach((s, i) => { s.index = i; seat(_m, s.x, s.z, s.yaw, 1.2); this.landers.setMatrixAt(i, _m); });
      this.landers.name = 'Crew landers'; this.cargo.name = 'Cargo landers';
      this.group.add(this.landers, this.cargo);
      this.plumes = [];
      for (const s of this.slots) if (s.cyc) { const pm = plumeMesh(); pm.scale.setScalar(0.001); this.group.add(pm); this.plumes.push({ slot: s, mesh: pm }); }
      // tugs: two circling inside each pad's rim
      this.tugPaths = PADS.map(([u, v]) => { const pts = []; for (let i = 0; i <= 72; i++) { const a = i / 72 * TAU; const [x, z] = UV(u + Math.cos(a) * 214, v + Math.sin(a) * 214); pts.push(new THREE.Vector3(x, surfaceY(x, z) + 1.2, z)); } return new Path(pts, true); });
      this.tugs = lunarInstanced(kit('tug'), 6, {}, this.mat, { tint: true });
      this.tugs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < 6; i++) this.tugs.instanceColor.setXYZ(i, 0.92, 0.66, 0.14);
      this.tugs.name = 'Pad tugs';
      this.group.add(this.tugs);
      // suited crews round the parked craft
      const crew = [];
      for (const s of this.slots) {
        const n = s.cyc ? 6 : 10;
        for (let i = 0; i < n; i++) crew.push({ x: s.x, z: s.z, r: 22.5 + rnd() * 5, a0: rnd() * TAU, w: (rnd() < 0.5 ? -1 : 1) * (0.9 + rnd() * 0.5), slot: s, tint: SUITS[Math.floor(rnd() * SUITS.length)] });
      }
      this.crew = crew;
      this.suits = lunarInstanced(kit('suit'), crew.length, {}, this.mat, { tint: true });
      this.suits.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      crew.forEach((c, i) => this.suits.instanceColor.setXYZ(i, ...c.tint));
      this.suits.name = 'Pad crews';
      this.group.add(this.suits);
      this.fieldsCentre = new THREE.Vector3(...(() => { const [x, z] = UV(-500, -2600); return [x, 0, z]; })());
    }

    // --- the mine: haulers on the loop, bucket wheels turning ---
    {
      this.haul = new Path(W.haul, true);
      this.haulers = lunarInstanced(kit('hauler'), 9, {}, this.mat, { tint: true });
      this.haulers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < 9; i++) this.haulers.instanceColor.setXYZ(i, 0.9, 0.62, 0.14);
      this.haulers.name = 'Ore haulers';
      this.wheels = lunarInstanced(kit('wheel'), W.excavators.length, {}, this.mat, { tint: true });
      this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < W.excavators.length; i++) this.wheels.instanceColor.setXYZ(i, 0.86, 0.62, 0.12);
      this.wheelBase = W.excavators.map((e) => { const m = new THREE.Matrix4(); seat(m, e.x, e.z, e.yaw, 0.25); return m.multiply(new THREE.Matrix4().makeTranslation(EXCAVATOR_HUB.x, EXCAVATOR_HUB.y, EXCAVATOR_HUB.z)); });
      this.group.add(this.haulers, this.wheels);
      this.mineCentre = W.haul[0].clone();
    }

    // --- the freight yard's gantries ---
    {
      this.gantries = lunarInstanced(kit('gantry'), 2, {}, this.mat, { tint: true });
      this.trolleys = lunarInstanced(kit('trolley'), 2, {}, this.mat, { tint: true });
      for (const m of [this.gantries, this.trolleys]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); for (let i = 0; i < 2; i++) m.instanceColor.setXYZ(i, 0.9, 0.62, 0.12); }
      this.gantries.name = 'Freight yard gantries'; this.trolleys.name = 'Gantry trolleys';
      const mid = (YARD.v0 + YARD.v1) / 2;
      this.gantrySpans = [[YARD.v0 + 22, mid - 12], [mid + 12, YARD.v1 - 22]];
      this.group.add(this.gantries, this.trolleys);
    }

    // --- rovers on the hamlet roads and the service road ---
    {
      const roads = landingData.plan.filter((p) => p.kind === 'road').map((p) => {
        // each road's (u, v) polyline, resampled on the ground at its top (0.3 m)
        const pts = [];
        for (let i = 0; i < p.pts.length - 1; i++) {
          const [ua, va] = p.pts[i], [ub, vb] = p.pts[i + 1];
          const n = Math.max(1, Math.ceil(Math.hypot(ub - ua, vb - va) / 40));
          for (let k = i ? 1 : 0; k <= n; k++) { const u = ua + (ub - ua) * k / n, v = va + (vb - va) * k / n; const [x, z] = UV(u, v); pts.push(new THREE.Vector3(x, surfaceY(x, z) + 0.3, z)); }
        }
        return { path: new Path(pts), s0: 70, s1: 30 };
      });
      roads.push({ path: new Path(W.service), s0: 10, s1: 10 });
      this.roads = roads;
      const riders = [];
      roads.forEach((r, ri) => { const n = Math.max(2, Math.round(r.path.L / 900)); for (let i = 0; i < n; i++) riders.push({ ri, ph: rnd() * 1e5, v: 9 + rnd() * 5 }); });
      this.riders = riders;
      this.rovers = lunarInstanced(kit('rover'), riders.length, {}, this.mat, { tint: true });
      this.rovers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      riders.forEach((r, i) => this.rovers.instanceColor.setXYZ(i, ...LIVERY[i % LIVERY.length]));
      this.rovers.name = 'Rovers';
      this.group.add(this.rovers);
    }

    // --- townspeople ---
    {
      const { T, V, U_TOWN } = landingData.S;
      const walks = [];
      // the Boulevard: six lanes each side on each terrace, clear of the trunks and lamp posts
      for (const [v0, v1, h] of [[V.MID + 26, V.LOW - 14, T.MID], [V.LOW + 18, V.STRAND - 14, T.LOW]]) {
        for (const s of [-1, 1]) for (const uu of [8.8, 11.4, 20.2, 22.8, 30.2, 37.4]) {
          const n = Math.round((v1 - v0) / 26);
          for (let i = 0; i < n; i++) walks.push({ kind: 0, a: s * uu + (rnd() - 0.5) * 0.6, v0, v1, h, ph: rnd() * 5000, sp: 1.0 + rnd() * 0.6 });
        }
      }
      // the Strand promenade, between the seafront halls and the tree row, and on to the stoa
      for (const vv of [2974, 2980, 3004, 3018, 3032, 3048]) {
        const n = 70;
        for (let i = 0; i < n; i++) walks.push({ kind: 1, a: vv + (rnd() - 0.5) * 1.2, v0: -1650, v1: 1650, h: T.STRAND, ph: rnd() * 8000, sp: 0.9 + rnd() * 0.6 });
      }
      // round the Lift plaza, both ways
      for (const [r, n] of [[300, 90], [345, 110]]) for (let i = 0; i < n; i++) walks.push({ kind: 2, a: r + (rnd() - 0.5) * 3, v0: 0, v1: 0, h: T.LIFT, ph: rnd() * TAU, sp: (rnd() < 0.5 ? -1 : 1) * (1.0 + rnd() * 0.5) });
      // the cross streets of the courtyard town: along v between the blocks, along u between the rows
      const streets = [];
      for (const [v0, v1, h] of [[V.MID + 12, V.LOW - 116, T.MID], [V.LOW + 12, V.STRAND - 72, T.LOW]]) for (const s of [-1, 1]) for (let u = 200; u < U_TOWN - 150; u += 170) streets.push({ along: 'v', c: s * u, a0: v0, a1: v1, h });
      for (let v = V.MID + 9 + 110 + 9; v < V.LOW - 20; v += 128) for (const s of [-1, 1]) streets.push({ along: 'u', c: v, a0: s > 0 ? 44 : -U_TOWN + 12, a1: s > 0 ? U_TOWN - 12 : -44, h: T.MID });
      for (let v = V.LOW + 9 + 110 + 9; v < V.STRAND - 80; v += 128) for (const s of [-1, 1]) streets.push({ along: 'u', c: v, a0: s > 0 ? 44 : -U_TOWN + 12, a1: s > 0 ? U_TOWN - 12 : -44, h: T.LOW });
      this.streets = streets;
      for (const st of streets) for (const off of [-7.2, 7.2]) {
        const n = Math.round((st.a1 - st.a0) / 60);
        for (let i = 0; i < n; i++) walks.push({ kind: st.along === 'v' ? 0 : 3, a: st.c + off + (rnd() - 0.5) * 0.8, v0: st.a0, v1: st.a1, h: st.h, ph: rnd() * 6000, sp: 1.0 + rnd() * 0.6 });
      }
      this.walks = walks;
      this.walkers = lunarInstanced(kit('walker'), walks.length, {}, this.mat, { tint: true });
      this.walkers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      walks.forEach((w, i) => { const c = CLOTHES[Math.floor(rnd() * CLOTHES.length)]; this.walkers.instanceColor.setXYZ(i, ...c); });
      this.walkers.name = 'Townspeople';
      this.group.add(this.walkers);
      this.townCentre = new THREE.Vector3(...(() => { const [x, z] = UV(0, 1600); return [x, 0, z]; })());
    }

    // --- runabouts on the cross streets, keeping right ---
    {
      const carts = [];
      this.streets.forEach((st, si) => { const n = Math.max(1, Math.round((st.a1 - st.a0) / 220)); for (let i = 0; i < n; i++) carts.push({ si, ph: rnd() * 1e4, v: 5 + rnd() * 4 }); });
      this.carts = carts;
      this.cartMesh = lunarInstanced(kit('cart'), carts.length, {}, this.mat, { tint: true });
      this.cartMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      carts.forEach((c, i) => this.cartMesh.instanceColor.setXYZ(i, ...LIVERY[(i * 7) % LIVERY.length]));
      this.cartMesh.name = 'Town runabouts';
      this.group.add(this.cartMesh);
    }

    // --- harbour launches ---
    {
      const route = [[170, 3250], [170, 3420], [60, 3500], [0, 3600], [300, 3900], [900, 4300], [1200, 4800], [600, 5250], [-400, 5150], [-1100, 4600], [-900, 4000], [-300, 3700], [0, 3600], [-60, 3500], [-170, 3420], [-170, 3250]];
      const pts = route.map(([u, v]) => { const [x, z] = UV(u, v); return new THREE.Vector3(x, surfaceY(x, z), z); });
      this.bay = new Path(pts);
      this.boats = lunarInstanced(kit('launch'), 5, {}, this.mat, { tint: true });
      this.boats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < 5; i++) this.boats.instanceColor.setXYZ(i, ...[[0.85, 0.82, 0.74], [0.14, 0.26, 0.55], [0.7, 0.2, 0.14], [0.85, 0.82, 0.74], [0.2, 0.45, 0.4]][i]);
      this.boats.name = 'Harbour launches';
      this.group.add(this.boats);
    }

    // --- drones over the works ---
    {
      this.droneSpots = [];
      for (let i = 0; i < 14; i++) {
        const u = 900 + rnd() * 4000, v = -5800 + rnd() * 2600;
        const [x, z] = UV(u, v);
        this.droneSpots.push({ x, z, h: 30 + rnd() * 50, r: 40 + rnd() * 120, w: 0.05 + rnd() * 0.08, ph: rnd() * TAU });
      }
      this.drones = lunarInstanced(kit('drone'), this.droneSpots.length, {}, this.mat, { tint: true });
      this.drones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < this.droneSpots.length; i++) this.drones.instanceColor.setXYZ(i, 0.9, 0.9, 0.86);
      this.drones.name = 'Survey drones';
      this.group.add(this.drones);
    }

    // --- the mass driver's sled ---
    {
      const d = landingData.driver;
      this.driver = d;
      this.sled = lunarInstanced(kit('sled'), 1, {}, this.mat, { tint: true });
      this.sled.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.sled.instanceColor.setXYZ(0, 0.86, 0.84, 0.8);
      this.sled.name = 'Mass-driver sled';
      this.group.add(this.sled);
    }

    this.vehicles = [this.tugs, this.rovers, this.haulers, this.wheels, this.drones, this.boats, this.gantries, this.trolleys];
    this.group.traverse((o) => { o.frustumCulled = false; });
    this._cam = new THREE.Vector3();
    this._inv = new THREE.Matrix4();
    this.buildMs = performance.now() - t0;
  }

  /** Turn the array to face a site-frame sun direction (chunked unless `all`). */
  setPanels(sun, all = false) {
    const el = sun.y;
    // single-axis roll perpendicular to the Sun's azimuth, so the panel's short side swings;
    // stowed flat at night, never steeper than 85 degrees
    _t.set(sun.x, 0, sun.z);
    if (_t.lengthSq() < 1e-8) _t.set(0, 0, 1);
    _t.normalize();
    _x.crossVectors(UP, _t).normalize();
    if (el <= 0) _y.copy(UP);
    else { const e = Math.max(Math.asin(Math.min(el, 1)), 5 * Math.PI / 180); _y.copy(UP).multiplyScalar(Math.sin(e)).addScaledVector(_t, Math.cos(e)); }
    _z.crossVectors(_x, _y).normalize();
    this.panelRot.makeBasis(_x, _y, _z);
    this.panelSun.copy(sun);
    this.panelNext = 0;
    this.panelBusy = true;
    this.stepPanels(all ? Infinity : 3000);
  }

  stepPanels(budget) {
    if (!this.panelBusy) return;
    const n = this.works.trackers.length, e = this.panelRot.elements, arr = this.panels.instanceMatrix.array, P = this.pivot;
    const end = Math.min(n, this.panelNext + budget);
    for (let i = this.panelNext; i < end; i++) {
      const o = i * 16;
      arr[o] = e[0]; arr[o + 1] = e[1]; arr[o + 2] = e[2]; arr[o + 3] = 0;
      arr[o + 4] = e[4]; arr[o + 5] = e[5]; arr[o + 6] = e[6]; arr[o + 7] = 0;
      arr[o + 8] = e[8]; arr[o + 9] = e[9]; arr[o + 10] = e[10]; arr[o + 11] = 0;
      arr[o + 12] = P[i * 3]; arr[o + 13] = P[i * 3 + 1]; arr[o + 14] = P[i * 3 + 2]; arr[o + 15] = 1;
    }
    this.panelNext = end;
    this.panels.instanceMatrix.needsUpdate = true;
    if (end >= n) this.panelBusy = false;
  }

  /** Train position along the line at time t: [s, direction]. */
  trainAt(t) {
    let q = ((t % this.railCycle) + this.railCycle) % this.railCycle;
    for (let li = 0; li < this.legs.length; li++) {
      const l = this.legs[li];
      if (q < l.dwell) { TR.s = l.a; TR.dir = Math.sign(l.b - l.a); return TR; }
      q -= l.dwell;
      if (q < l.T) {
        const acc = l.acc, vm = l.vmax, ta = vm / acc;
        let d;
        if (q < ta) d = 0.5 * acc * q * q;
        else if (q > l.T - ta) { const r = l.T - q; d = l.d - 0.5 * acc * r * r; }
        else d = 0.5 * acc * ta * ta + vm * (q - ta);
        const sg = Math.sign(l.b - l.a);
        TR.s = l.a + sg * Math.min(d, l.d); TR.dir = sg;
        return TR;
      }
      q -= l.T;
    }
    TR.s = this.legs[0].a; TR.dir = 1;
    return TR;
  }

  /** Lander cycle: height above its pad (m) and plume intensity at time t. */
  static landerCycle(t, phase) {
    const C = 330, q = (((t + phase) % C) + C) % C;
    const H = 3000;
    LC.h = 0; LC.thr = 0;
    if (q < 80) { const x = q / 80; LC.h = H * (1 - x) ** 3; LC.thr = LC.h < 700 ? 0.4 + 0.6 * (1 - LC.h / 700) : 0.25; }  // descent
    else if (q < 90) LC.thr = 1 - (q - 80) / 10;                                                                              // engine shutdown
    else if (q < 250) LC.thr = 0;                                                                                             // on the pad
    else if (q < 256) LC.thr = (q - 250) / 6;                                                                                 // spool-up
    else if (q < 316) { const x = (q - 256) / 60; LC.h = H * 1.4 * x ** 2.2; LC.thr = 1; }                                  // ascent
    else LC.h = -1;                                                                                                           // away (hidden)
    return LC;
  }

  /** cam: camera world position; landing: the Landing group (world matrix current); sunSite: site-frame sun. */
  update(t, cam, landing, sunSite) {
    this._inv.copy(landing.matrixWorld).invert();
    const c = this._cam.copy(cam).applyMatrix4(this._inv).multiplyScalar(1000);   // camera in site metres
    const dTown = c.distanceTo(this.townCentre), dFields = c.distanceTo(this.fieldsCentre), dMine = c.distanceTo(this.mineCentre);
    const near = Math.min(dTown, dFields, dMine);
    this.group.visible = near < 90000;
    if (!this.group.visible) return;
    // detail ranges: people 4 km, vehicles 25 km, boulders 14 km
    this.walkers.visible = dTown < 4500;
    this.suits.visible = dFields < 4000;
    for (const b of this.boulders) b.visible = dMine < 14000;
    this.posts.visible = this.panels.visible = near < 40000;
    const vehNear = near < 30000;
    for (let i = 0; i < this.vehicles.length; i++) this.vehicles[i].visible = vehNear;
    // the array follows the Sun (a new turn when it has moved 0.3 degrees)
    if (sunSite && this.panelSun.dot(sunSite) < 0.999986) this.setPanels(sunSite);
    this.stepPanels(3000);

    this.updateTrains(t);
    this.updateLanders(t);
    this.updateSled(t);
    if (vehNear) { this.updateVehicles(t); this.updateMine(t); this.updateYard(t); }
    if (this.suits.visible) this.updateCrews(t);
    if (this.walkers.visible) this.updateWalkers(t);
    this.cartMesh.visible = dTown < 9000;
    if (this.cartMesh.visible) this.updateCarts(t);
  }

  updateCarts(t) {
    const arr = this.cartMesh.instanceMatrix.array;
    for (let i = 0; i < this.carts.length; i++) {
      const c = this.carts[i], st = this.streets[c.si];
      const { q, sg } = bounce(t, c.v, st.a1 - st.a0, c.ph);
      // keep right: 3 m off the street's centreline, to the right of the direction of travel
      let u, v, yaw;
      if (st.along === 'v') { v = st.a0 + q; u = st.c - 3 * sg; yaw = sg > 0 ? 0 : Math.PI; }
      else { u = st.a0 + q; v = st.c + 3 * sg; yaw = sg > 0 ? Math.PI / 2 : -Math.PI / 2; }
      const x = (u - v) * S2, z = (u + v) * S2;
      const ang = ROT_UV + yaw, cs = Math.cos(ang), sn = Math.sin(ang), o = i * 16;
      arr[o] = cs; arr[o + 1] = 0; arr[o + 2] = -sn; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = 1; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = sn; arr[o + 9] = 0; arr[o + 10] = cs; arr[o + 11] = 0;
      arr[o + 12] = x; arr[o + 13] = surfaceY(x, z) + st.h; arr[o + 14] = z; arr[o + 15] = 1;
    }
    this.cartMesh.instanceMatrix.needsUpdate = true;
  }

  updateTrains(t) {
    const R = this.rail;
    for (let k = 0; k < 2; k++) {
      const { s, dir } = this.trainAt(t + k * this.railCycle * 0.37);
      const side = k ? TRACK_X : -TRACK_X;
      for (let j = 0; j < 4; j++) {
        const sj = s + (j - 1.5) * 25.2 * dir;
        R.at(sj, _p, _t);
        _y.crossVectors(UP, _t).normalize();                  // across the line
        _p.addScaledVector(_y, side);
        frameAlong(_m, _p, _t);
        this.trams.setMatrixAt(k * 4 + j, _m);
      }
    }
    this.trams.instanceMatrix.needsUpdate = true;
  }

  updateLanders(t) {
    for (const pl of this.plumes) {
      const s = pl.slot;
      const { h, thr } = LunarTraffic.landerCycle(t, s.phase);
      if (h < 0) { _m.makeScale(0, 0, 0); this.landers.setMatrixAt(s.index, _m); pl.mesh.visible = false; continue; }
      // a slow yaw correction on the way down, none on the pad
      seat(_m, s.x, s.z, s.yaw + (h > 0 ? h * 1e-4 : 0), 1.2 + h);
      this.landers.setMatrixAt(s.index, _m);
      pl.mesh.visible = thr > 0.01;
      if (pl.mesh.visible) {
        // the plume hangs from the engine bell (0.9 m up the stage) and shortens near the ground
        _p.set(0, 0.9, 0).applyMatrix4(_m);
        pl.mesh.position.copy(_p).multiplyScalar(0.001);
        pl.mesh.quaternion.setFromRotationMatrix(_m);
        const len = Math.min(1, (h + 0.9) / 42 + 0.05);
        pl.mesh.scale.set(0.001 * (1 + (1 - len) * 1.8), 0.001 * len, 0.001 * (1 + (1 - len) * 1.8));
        pl.mesh.material.uniforms.uI.value = thr * (0.8 + 0.2 * Math.sin(t * 37 + s.phase));
      }
    }
    this.landers.instanceMatrix.needsUpdate = true;
  }

  updateSled(t) {
    const d = this.driver;
    const s = driverS(t, d.L);                               // rides the coils' launch pulse
    this.sled.visible = s < d.L + 2500;
    if (!this.sled.visible) return;
    _p.copy(d.P0).addScaledVector(d.dir, s);
    if (s > d.L) _p.addScaledVector(UP, (s - d.L) ** 2 * 2e-5);   // off the gate, climbing away
    frameAlong(_m, _p, d.dir);
    this.sled.setMatrixAt(0, _m);
    this.sled.instanceMatrix.needsUpdate = true;
  }

  updateVehicles(t) {
    // tugs: two per pad, opposite each other on the pad's inner circuit, 6 m/s
    for (let i = 0; i < 6; i++) {
      const P = this.tugPaths[i % 3];
      P.at(t * 6 + (i >= 3 ? P.L / 2 : 0) + i * 211, _p, _t);
      frameAlong(_m, _p, _t);
      this.tugs.setMatrixAt(i, _m);
    }
    this.tugs.instanceMatrix.needsUpdate = true;
    // rovers: back and forth along their roads, keeping 2 m right of the crown
    for (let i = 0; i < this.riders.length; i++) {
      const r = this.riders[i], road = this.roads[r.ri], P = road.path;
      const span = P.L - road.s0 - road.s1;
      const { q, sg } = bounce(t, r.v, span, r.ph);
      P.at(road.s0 + q, _p, _t);
      if (sg < 0) _t.negate();
      _y.crossVectors(_t, UP).normalize();                   // to the right of travel
      _p.addScaledVector(_y, 2.0);
      frameAlong(_m, _p, _t);
      this.rovers.setMatrixAt(i, _m);
    }
    this.rovers.instanceMatrix.needsUpdate = true;
    // launches in the Bay
    const B = this.bay;
    for (let i = 0; i < 5; i++) {
      const { q, sg } = bounce(t, 7 + i * 0.8, B.L, i * 1900);
      B.at(q, _p, _t);
      if (sg < 0) _t.negate();
      _p.y += 0.05 * Math.sin(t * 1.3 + i);
      frameAlong(_m, _p, _t);
      this.boats.setMatrixAt(i, _m);
    }
    this.boats.instanceMatrix.needsUpdate = true;
    // drones: slow figure-eights at their stations
    for (let i = 0; i < this.droneSpots.length; i++) {
      const d = this.droneSpots[i], a = t * d.w + d.ph;
      const x = d.x + Math.sin(a) * d.r, z = d.z + Math.sin(a * 2) * d.r * 0.4;
      _p.set(x, surfaceY(x, z) + d.h + Math.sin(a * 3) * 2, z);
      _t.set(Math.cos(a) * d.r, 0, Math.cos(a * 2) * d.r * 0.8);
      frameAlong(_m, _p, _t);
      this.drones.setMatrixAt(i, _m);
    }
    this.drones.instanceMatrix.needsUpdate = true;
  }

  updateYard(t) {
    for (let i = 0; i < 2; i++) {
      const [a, b] = this.gantrySpans[i];
      const { q } = bounce(t, 0.8 + i * 0.3, b - a, i * 90);
      const v = a + q;
      const [x, z] = UV(YARD.gantryU, v);
      seat(_m, x, z, ROT_UV, 0.3);
      this.gantries.setMatrixAt(i, _m);
      // the trolley shuttles across the bridge between the container rows
      const tx = 22 * Math.sin(t * 0.07 + i * 2.1);
      _m.multiply(_e2.makeTranslation(tx, 0, 0));
      this.trolleys.setMatrixAt(i, _m);
    }
    this.gantries.instanceMatrix.needsUpdate = true;
    this.trolleys.instanceMatrix.needsUpdate = true;
  }

  updateMine(t) {
    const P = this.haul;
    for (let i = 0; i < 9; i++) {
      P.at(t * 7 + i * P.L / 9, _p, _t);
      frameAlong(_m, _p, _t);
      this.haulers.setMatrixAt(i, _m);
    }
    this.haulers.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.wheelBase.length; i++) {
      _m.makeRotationX(-t * 0.35 - i).premultiply(this.wheelBase[i]);
      this.wheels.setMatrixAt(i, _m);
    }
    this.wheels.instanceMatrix.needsUpdate = true;
  }

  updateCrews(t) {
    for (let i = 0; i < this.crew.length; i++) {
      const c = this.crew[i];
      // crews round a craft that is away, or coming down, stand back at the blast wall's gap
      const h = c.slot.cyc ? LunarTraffic.landerCycle(t, c.slot.phase).h : 0;
      const rr = h === 0 ? c.r : c.r + 40;
      const a = c.a0 + t * c.w / rr;
      const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
      seat(_m, x, z, -a + (c.w > 0 ? 0 : Math.PI), 1.2);
      this.suits.setMatrixAt(i, _m);
    }
    this.suits.instanceMatrix.needsUpdate = true;
  }

  updateWalkers(t) {
    const arr = this.walkers.instanceMatrix.array;
    for (let i = 0; i < this.walks.length; i++) {
      const w = this.walks[i];
      let u, v, yaw;
      if (w.kind === 2) {
        const a = w.ph + t * w.sp / w.a;
        u = Math.cos(a) * w.a; v = Math.sin(a) * w.a;
        yaw = -a + (w.sp > 0 ? 0 : Math.PI);
      } else {
        const { q, sg } = bounce(t, w.sp, w.v1 - w.v0, w.ph);
        if (w.kind === 0) { u = w.a; v = w.v0 + q; yaw = sg > 0 ? 0 : Math.PI; }
        else if (w.kind === 3) { u = w.v0 + q; v = w.a; yaw = sg > 0 ? Math.PI / 2 : -Math.PI / 2; }
        else { u = w.v0 + q; v = Math.min(w.a, shoreV(u) - 36); yaw = sg > 0 ? Math.PI / 2 : -Math.PI / 2; }
      }
      const x = (u - v) * S2, z = (u + v) * S2;
      // (townspeople stand upright on their terraces: the site frame's tilt over 3 km is 0.1 degree)
      const ang = ROT_UV + yaw, cs = Math.cos(ang), sn = Math.sin(ang), o = i * 16;
      arr[o] = cs; arr[o + 1] = 0; arr[o + 2] = -sn; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = 1; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = sn; arr[o + 9] = 0; arr[o + 10] = cs; arr[o + 11] = 0;
      arr[o + 12] = x; arr[o + 13] = surfaceY(x, z) + w.h + 0.03 * Math.abs(Math.sin(t * 5.5 + i)); arr[o + 14] = z; arr[o + 15] = 1;
    }
    this.walkers.instanceMatrix.needsUpdate = true;
  }
}
