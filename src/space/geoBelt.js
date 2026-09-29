import * as THREE from 'three';
import { dressedMesh, craftPart, addLamps, pixelRadius, CRAFT_FRAME, KM, LIVERIES } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { DynLamps, rng, smooth, TAU } from './lifeKit.js';
import { R_EARTH, GEO_ALT, MERIDIAN_LON, bodyDir } from './sim.js';
import { stationFrame } from './stations.js';
import { buildBeltStation } from './beltStations.js';
import { BeltLife, buildFittings, liftCarGeo } from './beltLife.js';
import { instancedPart, poseMatrix } from './lifeKit.js';
import { StationTraffic, makeRoute } from './fleetTraffic.js';
import { design } from './shipDesigns.js';
const _mx = new THREE.Vector3(), _mm = new THREE.Matrix4();

// THE GEOSTATIONARY BELT: the whole arc, not only the Harbour's neighbourhood. Thirty sites
// round the ring at 42,164 km, some of them pairs a few tens of kilometres apart, each a
// working station built from its own seed (beltStations.js): signal platforms, wheel towns,
// propellant depots, slipways, power relays, way stations, garden cylinders, observatories.
//
//   near        the station itself (dressed craft material: liveries, lit ports, concourses),
//               built on approach, one per frame, and let go again far away; its wheels and
//               drums spin at their rim gravity, dishes slew, crane bridges run their rails,
//               relay blankets turn to the Sun; ships berth at its docks all the time
//               (StationTraffic: in tail first under a braking burn, flip at the gate, glide
//               to the berth, lie alongside, back off, turn and leave under power)
//   lanes       buoys every degree round the arc, the eastbound lane 32 km inside the belt and
//               the westbound 32 km outside (lower orbits drift east, higher ones west)
//   far         every station a coloured beacon in its kind's colour, and between them the
//               belt's couriers: torch ships running from site to site along the arc (drive
//               lit while they accelerate and brake, coasting between), so the ring reads as
//               a working road from anywhere in cislunar space
//
// Positions are fixed in the Earth's frame (the stations are geostationary): each station
// group is a child of space.earthFixed in its local station frame (x west, y up, z north), km.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const R_GEO = R_EARTH + GEO_ALT;
export const BUILD_RANGE = 5000;       // km: stations are built inside this
export const DROP_RANGE = 40000;       // km: and let go beyond this
export const TRAFFIC_RANGE = 3500;     // km: their berthing traffic runs inside this
export const BUOY_LANE = 32;           // km inside / outside the belt: the courier lanes' buoys
export const FIT_PX = 30;              // px (station radius): its fittings are scattered beyond this
const KIND_COLOR = {
  comms: LAMP.RED, habitat: [1.0, 0.8, 0.5], depot: LAMP.AMBER, shipyard: LAMP.WHITE,
  relay: [1.0, 0.35, 0.2], transit: LAMP.TEAL, farm: LAMP.GREEN, science: LAMP.BLUE, anchorage: [1.0, 0.9, 0.7], drydock: LAMP.WHITE,
};
const NAMES = {
  comms: ['Vela Signal', 'Lyre Signal', 'Corvus Relay Deck', 'Ansa Signal', 'Tarn Listening Post'],
  habitat: ['Kalani Wheel', 'Anuenue', 'New Aroha', 'Solace Wheel', 'Mahina Town'],
  depot: ['Kerosene Point', 'Hydra Depot', 'Pele Stores', 'Long Water', 'Cold Ferry Depot'],
  shipyard: ['Ironwood Slip', 'Tolan Yards', 'Makana Slip', 'Seventh Slip'],
  relay: ['Helion Relay 4', 'Helion Relay 9', 'Kaula Relay', 'Sunward Relay'],
  transit: ['Wayhouse East', 'Crossing', 'Farstair', 'Nine Roads'],
  farm: ['Orchard', 'Greenhold', 'Maile Drum', 'Harvest Drum'],
  science: ['Deepglass', 'Keck Station', 'Pale Eye'],
  anchorage: ['Outer Roads', 'Kapena Anchorage', 'Lee Moorings', 'Waiting Water'],
  drydock: ['Refit Dock 2', 'Graving Dock', 'Survey Dock', 'Refit Dock 5'],
};
/** Ship classes that call at each kind of station. */
const CALLERS = {
  comms: ['drone', 'lighter'], habitat: ['packet', 'lighter', 'packet'], depot: ['tanker', 'lighter', 'tug'],
  shipyard: ['lighter', 'tug', 'lighter'], relay: ['drone', 'tug'], transit: ['packet', 'hauler', 'lighter'],
  farm: ['lighter', 'hauler'], science: ['drone', 'lighter'], anchorage: ['tug'], drydock: ['lighter', 'tug'],
};

/** The belt: deterministic list of stations with their places on the arc (station-frame offsets, km). */
export function beltLayout() {
  const r = rng(5021);
  const order = ['habitat', 'depot', 'comms', 'anchorage', 'transit', 'shipyard', 'relay', 'drydock', 'farm', 'science'];
  const used = {};
  const name = (k) => { const i = used[k] = (used[k] ?? -1) + 1; const list = NAMES[k]; return i < list.length ? list[i] : `${list[i % list.length]} ${Math.floor(i / list.length) + 1}`; };
  const N = 30;
  const out = [];
  for (let i = 0; i < N; i++) {
    // the Harbour's own neighbourhood (4 degrees either side of the meridian) is left to it
    const du = (i + 0.5) / N * (TAU - 0.14) + 0.07;
    const lon = MERIDIAN_LON + du + (r() - 0.5) * 0.06;
    const kind = order[(i * 3 + Math.floor(i / 10)) % order.length];
    const site = { i, lon, kind, name: name(kind), seed: 101 + i * 37, livery: (i * 5 + 3) % LIVERIES.length, local: V((r() - 0.5) * 20, (r() - 0.5) * 40, (r() - 0.5) * 40), yaw: kind === 'habitat' || kind === 'farm' ? 0 : r() * TAU };
    out.push(site);
    // every third site keeps a companion a few tens of km along the arc
    if (i % 3 === 1) {
      const k2 = order[(i * 5 + 2) % order.length];
      const k = k2 === kind ? order[(i * 5 + 3) % order.length] : k2;
      out.push({ i, lon, kind: k, name: name(k), seed: 907 + i * 53, livery: (i * 3 + 1) % LIVERIES.length, local: site.local.clone().add(V((r() < 0.5 ? -1 : 1) * (25 + r() * 35), (r() - 0.5) * 16, (r() - 0.5) * 16)), yaw: k === 'habitat' || k === 'farm' ? 0 : r() * TAU });
    }
  }
  out.forEach((s, id) => { s.id = id; });
  return out;
}

/** Earth-frame position (km) and frame of a belt station. */
export function beltPlace(s, outPos = new THREE.Vector3(), outQ = new THREE.Quaternion()) {
  const up = bodyDir(0, s.lon);
  const fq = stationFrame(up);
  outPos.copy(s.local).applyQuaternion(fq).addScaledVector(up, R_GEO);
  outQ.copy(fq).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), s.yaw));
  return { pos: outPos, q: outQ };
}

/**
 * A berthing route at one dock (station frame, km): in along the dock's axis from `far`, tail
 * first and braking; flip at the gate; glide in bow first; lie alongside; back off; turn; out
 * under power on the other side of the axis; the seam far out where the ship has faded.
 */
export function berthRoute(dock, bow, { far = 26, gate = 2.2, lat = 2.4, stay = 360, seed = 0, turn = 0 } = {}) {
  const d = dock.d.clone().normalize();
  // the plane of this berth's lanes, turned about its axis so neighbouring berths' lanes fan apart
  const e1 = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0)).normalize().applyAxisAngle(d, turn);
  const P = dock.p.clone().multiplyScalar(KM);
  const stop = P.clone().addScaledVector(d, bow);
  const aFar = P.clone().addScaledVector(d, far).addScaledVector(e1, lat);
  const aGate = P.clone().addScaledVector(d, gate).addScaledVector(e1, 0.12);
  const dGate = P.clone().addScaledVector(d, gate * 0.8).addScaledVector(e1, -0.18);
  const dFar = P.clone().addScaledVector(d, far).addScaledVector(e1, -lat);
  const L = (a, b, t) => a.clone().lerp(b, t);
  const j = (seed * 0.618) % 1;
  const legs = [
    { k: 'bez', p: [aFar, L(aFar, aGate, 0.34), L(aFar, aGate, 0.67), aGate], dur: 300 + 60 * j, ease: 'out', face: 'back', thr: 1 },
    { k: 'hold', at: aGate, dur: 45 },
    { k: 'bez', p: [aGate, L(aGate, stop, 0.4), L(aGate, stop, 0.8), stop], dur: 170, ease: 'out', face: 'fwd', thr: 0.08 },
    { k: 'hold', at: stop, dur: stay },
    { k: 'bez', p: [stop, L(stop, dGate, 0.2), L(stop, dGate, 0.6), dGate], dur: 130, ease: 'in', face: 'back', thr: 0 },
    { k: 'hold', at: dGate, dur: 50 },
    { k: 'bez', p: [dGate, L(dGate, dFar, 0.33), L(dGate, dFar, 0.67), dFar], dur: 280, ease: 'in', face: 'fwd', thr: 1 },
    { k: 'bez', p: [dFar, L(dFar, aFar, 0.33), L(dFar, aFar, 0.67), aFar], dur: 160, ease: 'lin', face: 'fwd', thr: 0 },
  ];
  const R = makeRoute(legs, { fadeIn: 0.05, fadeOut: 0.16 });
  R.stop = stop; R.dock = dock;
  return R;
}

/** Courier timing between two sites: [angle fraction 0..1, drive 0..1] at cycle fraction u of one leg. */
export function courierLeg(u, out = [0, 0]) {
  // accelerate (0 - 0.18), coast, flip, brake (0.82 - 1): constant-thrust ends, distance continuous
  const a = 0.18, vmax = 1 / (1 - a);                 // area under the speed curve = 1
  let s, thr;
  if (u < a) { s = 0.5 * vmax * u * u / a; thr = 1; }
  else if (u < 1 - a) { s = 0.5 * vmax * a + vmax * (u - a); thr = 0; }
  else { const w = 1 - u; s = 1 - 0.5 * vmax * w * w / a; thr = 1; }
  out[0] = s; out[1] = thr;
  return out;
}
const _leg = [0, 0];

const _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3();
const _Z = V(0, 0, 1);

export class GeoBelt {
  constructor(space) {
    const t0 = performance.now();
    this.space = space;
    this.layout = beltLayout();
    this.stations = this.layout.map((desc) => {
      const group = new THREE.Group();
      group.name = `belt:${desc.name}`;
      beltPlace(desc, group.position, group.quaternion);
      space.earthFixed.add(group);
      const st = { desc, group, pos: group.position.clone(), localQ: group.quaternion.clone(), built: null, traffic: null, px: 0, dist: Infinity, worldQ: new THREE.Quaternion(), world: new THREE.Vector3() };
      st.body = space.addBody(`belt-${desc.id}`, [group], (o) => (o || _w).copy(st.world), 1.2, { solid: true, hint: 0.4 });
      st.body.visible = false;
      st.body.remote = true;
      return st;
    });
    // beacons (one per station) and couriers (drive and running light each), km, Earth frame
    this.couriers = [];
    const sites = [...new Set(this.layout.map((s) => s.i))].map((i) => this.layout.find((s) => s.i === i));
    sites.forEach((a, k) => {
      const b = sites[(k + 1) % sites.length];
      let dl = b.lon - a.lon;
      dl = ((dl % TAU) + TAU) % TAU;
      for (let n = 0; n < 2; n++) {
        const legT = 520 + (dl * R_GEO) / 14;          // ~14 km/s along the arc
        this.couriers.push({ a, b, dl, legT, wait: 150 + 40 * n, off: (k * 0.37 + n * 0.5) % 1, lane: (n ? 1 : -1) * (6 + (k % 3) * 3), dip: BUOY_LANE });
      }
    });
    const lamps = [];
    for (const st of this.stations) {
      const c = KIND_COLOR[st.desc.kind];
      lamps.push({ p: st.pos.clone(), r: 0.35, color: c, i: 4.2, breathe: 0.5, phase: (st.desc.id * 0.618) % 1 });
    }
    this.courier0 = lamps.length;
    for (let i = 0; i < this.couriers.length; i++) {
      lamps.push({ p: V(0, 0, 0), r: 0.12, color: [0.6, 0.85, 1.0], i: 6 });       // drive
      lamps.push({ p: V(0, 0, 0), r: 0.04, color: LAMP.WHITE, i: 3, breathe: 1, phase: (i * 0.31) % 1 });   // running light
    }
    // the belt's lanes: buoys every degree round the whole arc, the eastbound lane 32 km inside
    // the belt (amber), the westbound 32 km outside (teal), their breathing running along the ring
    this.buoy0 = lamps.length;
    for (let k = 0; k < 360; k++) {
      const lon = MERIDIAN_LON + ((k + 0.5) / 360) * TAU;
      const off = Math.abs(((lon - MERIDIAN_LON) % TAU + TAU) % TAU - Math.PI);
      if (off > Math.PI - 0.06) continue;                 // the Harbour's own corridors take over there
      for (const lane of [-1, 1]) {
        const R = R_GEO + lane * BUOY_LANE;
        lamps.push({ p: V(Math.cos(lon) * R, 0, -Math.sin(lon) * R), r: 0.06, color: lane < 0 ? LAMP.AMBER : LAMP.TEAL, i: 1.4, breathe: 0.85, phase: ((k * (lane < 0 ? 1 : -1)) / 30 % 1 + 1) % 1 });
      }
    }
    this.nBuoys = lamps.length - this.buoy0;
    this.lights = new DynLamps(lamps, { minPx: 1.6 });
    space.earthFixed.add(this.lights.mesh);
    this.lightsBody = space.addBody('beltLights', [this.lights.mesh], null, 0, {
      interval: (cam) => {
        const d = cam.length();
        return [Math.max(d - R_GEO - 150, 0.01), d + R_GEO + 150];
      },
    });
    this.lightsBody.remote = true;
    this.designs = null;
    this.queue = [];
    this.buildMs = 0;
    this.constructMs = performance.now() - t0;
  }

  /** The traffic designs (shared by every station), built on first need. */
  _designs() {
    if (this.designs) return this.designs;
    const seeds = { drone: [1, 3], lighter: [1, 10], packet: [4, 9], tanker: [5, 12], tug: [2, 11], hauler: [3, 8] };
    this.designs = {};
    for (const [k, list] of Object.entries(seeds)) {
      this.designs[k] = list.map((sd, j) => {
        const d = design(k, sd);
        const lv = LIVERIES[(sd * 3 + j) % LIVERIES.length];
        return { ...d, accent: [0.55, 0.88, 1.0], livery: lv[0], livery2: lv[1], bow: (d.geo.boundingBox ? d.geo.boundingBox.max.z : d.length / 2) };
      });
    }
    return this.designs;
  }

  /** Build one station's hull, moving parts, lamps and its berthing traffic. */
  build(st) {
    if (st.built) return st.built;
    const t0 = performance.now();
    const d = st.desc;
    const data = buildBeltStation(d.kind, d.seed, d.livery);
    const lv = LIVERIES[d.livery];
    const mesh = dressedMesh(data.geo, { accent: d.kind === 'relay' ? [1.0, 0.5, 0.3] : [0.55, 0.88, 1.0], lit: 0.62, livery: lv[0], livery2: lv[1], fill: 0.035 });
    const parts = data.parts.map((p) => {
      const m = craftPart(mesh, p.geo);
      m.position.copy(p.pivot);
      m.quaternion.copy(p.q);
      if (p.lamps.length) addLamps(m, p.lamps, { minPx: 1.1 });
      mesh.add(m);
      // lift cars riding a wheel's spokes (children of the turning part)
      if (p.lifts && p.lifts.length) { p.liftIm = instancedPart(m, liftCarGeo(), p.lifts.length); m.add(p.liftIm); }
      return { ...p, mesh: m, base: p.pivot.clone() };
    });
    addLamps(mesh, data.lamps, { minPx: 1.2 });
    st.group.add(mesh);
    // ships held by the station (anchorage moorings, a dry dock's refit): shared hulls, own paint
    const moored = data.moored.map((mo, k) => {
      const des = design(mo.cls, mo.seed);
      des.geo.userData.shared = true;
      const ml = LIVERIES[(d.id + k * 3) % LIVERIES.length];
      const m = dressedMesh(des.geo, { accent: [0.55, 0.88, 1.0], lit: 0.55, livery: ml[0], livery2: ml[1] });
      m.position.copy(mo.pos).multiplyScalar(KM);
      _mx.crossVectors(mo.up, mo.fwd).normalize();
      m.quaternion.setFromRotationMatrix(_mm.makeBasis(_mx, _s.crossVectors(mo.fwd, _mx), mo.fwd));
      addLamps(m, des.lamps, { minPx: 1.1 });
      st.group.add(m);
      return m;
    });
    st.body.radius = data.radius * KM + 0.05;
    // its working life: approach chains, pilot and patrol drones, crews, welders (beltLife.js)
    const life = new BeltLife(mesh, data, d.id + 1);
    st.built = { data, mesh, parts, life, moored };
    // the berthing traffic, created once (its hulls are instanced; kept when the hull is let go)
    if (!st.traffic && data.docks.length) {
      const D = this._designs();
      const callers = CALLERS[d.kind];
      const roster = [];
      const docks = data.docks.slice(0, Math.min(4, data.docks.length));
      docks.forEach((dock, k) => {
        const fam = D[callers[k % callers.length]];
        const des = fam[(d.id + k) % fam.length];
        const scale = des.kind === 'drone' ? 1 : 1;
        const R = berthRoute(dock, (des.bow * scale + 3) * KM, { seed: d.id * 7 + k, stay: 280 + 90 * ((d.id + k) % 3), lat: 2 + (k % 2) * 1.2, turn: k * 2.39996 + d.id * 0.7 });
        roster.push({ route: R, phase: ((d.id * 0.37 + k * 0.29) % 1) * R.T, design: des, scale, slot: [0, 0, 0], seed: d.id * 11 + k, fidget: 0.6 });
      });
      const used = [...new Set(roster.map((r) => r.design))];
      st.traffic = new StationTraffic(this.space, `belt-${d.id}`, st.group, roster, used, { engineColor: LAMP.BLUE });
      st.traffic.body.remote = true;
      st.traffic.body.visible = false;
    }
    this.buildMs += performance.now() - t0;
    return st.built;
  }

  /** Let a far station's hull go (its geometry is rebuilt on the next approach). */
  drop(st) {
    const b = st.built;
    if (!b) return;
    st.group.remove(b.mesh);
    for (const m of b.moored) { st.group.remove(m); m.material.dispose(); }
    b.mesh.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
    b.mesh.material.dispose();
    st.built = null;
    st.body.visible = false;
  }

  /** Build every station (tools and tests). */
  buildAll(fittings = false) {
    for (const st of this.stations) {
      const b = this.build(st);
      if (fittings && !b.fit) b.fit = buildFittings(b.mesh, b.data, st.desc.id + 3);
    }
  }

  /** Station world position/orientation (km) for the Earth's current attitude. */
  _place(st, earthQuat) {
    st.world.copy(st.pos).applyQuaternion(earthQuat);
    st.worldQ.copy(earthQuat).multiply(st.localQ);
  }

  update(sim, t, dt, space) {
    const cam = space.camera, H = space.size.y;
    const eq = sim.earthQuat;
    let queued = false;
    for (const st of this.stations) {
      this._place(st, eq);
      const dist = st.world.distanceTo(cam.position);
      st.dist = dist;
      const b = st.built;
      const rKm = b ? b.data.radius * KM : 0.5;
      st.px = pixelRadius(cam, st.world, rKm, H);
      if (!b && dist < BUILD_RANGE && !queued) { this.build(st); queued = true; }
      else if (b && dist > DROP_RANGE) this.drop(st);
      const bb = st.built;
      st.body.visible = !!bb && st.px > 0.35;
      // beacon: gives way to the station's own lamps as it resolves
      this.lights.gain(st.desc.id, 1 - smooth(4, 14, st.px));
      if (bb && st.px > 1.5) this._animate(st, bb, t);
      if (bb && st.px > 4) bb.life.update(t);
      // the near-detail fittings: scattered the first time the station fills the view
      if (bb && !bb.fit && st.px > FIT_PX && !queued) { bb.fit = buildFittings(bb.mesh, bb.data, st.desc.id + 3); queued = true; }
      if (bb && bb.fit) { const on = st.px > FIT_PX * 0.7; for (const im of bb.fit.meshes) im.visible = on; }
      if (st.traffic) {
        const near = dist < TRAFFIC_RANGE;
        st.traffic.body.visible = near;
        if (near) st.traffic.update(t, dt, cam);
      }
    }
    this._couriers(t);
    this.lights.commit();
  }

  _animate(st, b, t) {
    for (const p of b.parts) {
      const m = p.mesh;
      if (p.mode === 'spin') {
        m.quaternion.copy(p.q).multiply(_q.setFromAxisAngle(_Z, (p.rate * t) % TAU));
        if (p.liftIm) {
          // each car: a ride of ~90 s hub to rim, a stop at each end
          for (let j = 0; j < p.lifts.length; j++) {
            const L = p.lifts[j];
            const s = smooth(0.1, 0.9, 0.5 - 0.5 * Math.cos(TAU * (t / 240 + j * 0.37)));
            _w.copy(L.a).lerp(L.b, s);
            p.liftIm.setMatrixAt(j, poseMatrix(_mm, _w, L.axis, _Z));
          }
          p.liftIm.instanceMatrix.needsUpdate = true;
        }
      }
      else if (p.mode === 'slew') m.quaternion.copy(p.q).multiply(_q.setFromAxisAngle(_Z, p.amp * Math.sin(p.rate * t + p.phase)));
      else if (p.mode === 'rail') m.position.copy(p.base).setZ(p.base.z + p.travel * Math.sin((TAU * t) / p.period));
      else if (p.mode === 'sun') {
        // the Sun in the station's frame; the blankets' normal (+y of the pivot) turned toward it about z
        _s.copy(CRAFT_FRAME.sunDir).applyQuaternion(_q2.copy(st.worldQ).invert());
        const th = Math.atan2(-_s.x, _s.y);
        m.quaternion.copy(p.q).multiply(_q.setFromAxisAngle(_Z, th));
      }
    }
  }

  /** Couriers between neighbouring sites: out, wait, back, wait; drive lit while under thrust. */
  _couriers(t) {
    const L = this.lights;
    for (let i = 0; i < this.couriers.length; i++) {
      const c = this.couriers[i];
      const cyc = 2 * (c.legT + c.wait);
      const tau = (((t / cyc) + c.off) % 1) * cyc;
      let dir = 1, u = 0, moving = true;
      if (tau < c.legT) u = tau / c.legT;
      else if (tau < c.legT + c.wait) { moving = false; u = 1; }
      else if (tau < 2 * c.legT + c.wait) { dir = -1; u = (tau - c.legT - c.wait) / c.legT; }
      else { moving = false; u = 0; dir = -1; }
      if (moving) courierLeg(u, _leg); else { _leg[0] = 1; _leg[1] = 0; }
      const s = _leg[0], thr = _leg[1];
      const f = dir > 0 ? s : 1 - s;
      const lon = c.a.lon + c.dl * (moving ? f : dir > 0 ? 1 : 0);
      // eastward legs run a little inside the belt, westward ones outside (the phasing sense)
      const lift = moving ? -dir * c.dip * Math.sin(Math.PI * s) : 0;
      const R = R_GEO + lift;
      const x = Math.cos(lon) * R, z = -Math.sin(lon) * R, y = moving ? c.lane * Math.sin(Math.PI * s) : 0;
      const k = this.courier0 + i * 2;
      L.set(k, x, y, z);
      L.set(k + 1, x, y + 0.02, z);
      L.gain(k, moving ? 0.08 + thr : 0);
      L.gain(k + 1, moving ? 1 : 0);
    }
  }

  /** Triangles of the built stations (unique geometry) and their share of the traffic. */
  triangles() {
    let n = 0;
    for (const st of this.stations) if (st.built) n += st.built.data.tris;
    return n;
  }
}

/** Focus targets on the belt: its first wheel town, slipway and power relay (analytic poses). */
export function geoBeltTargets(space) {
  const sim = space.sim;
  const lay = beltLayout();
  const out = {};
  const pick = (key, kind, dist, view) => {
    const s = lay.find((x) => x.kind === kind);
    if (!s) return;
    const { pos, q } = beltPlace(s);
    out[key] = {
      position: (o) => o.copy(pos).applyQuaternion(sim.earthQuat),
      frame: (qq) => qq.copy(sim.earthQuat).multiply(q),
      minDist: 0.25, maxDist: 200000, defaultDist: dist, view,
      station: s,
    };
  };
  pick('beltWheel', 'habitat', 2.2, { az: 0.6, el: 0.35 });
  pick('beltYard', 'shipyard', 1.3, { az: 0.9, el: 0.3 });
  pick('beltRelay', 'relay', 2.0, { az: 0.4, el: 0.5 });
  return out;
}
