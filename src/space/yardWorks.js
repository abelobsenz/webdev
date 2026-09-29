import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { LAMP } from './lamps.js';
import { addLamps, placeLamps, placeMerge } from './craftMesh.js';
import { YARD, sectionPoint } from './geoRoads.js';
import {
  TAU, V, smooth, lerp, rng, hash1, schedule, instancedPart, fillInstances, DynLamps, weldGain,
  droneGeo, crewPodGeo, cableGeo, poseMatrix, spanMatrix,
} from './lifeKit.js';

// CONCORD YARD AT WORK (metres, the yard's own frame: the hull along z, bow +z, y up).
// buildConcordYard (geoRoads.js) is the dock and the half-built liner; this is the work on her:
//
//   plating      the skeleton bow is being skinned: plates fitted between the ribs, densest
//                just ahead of the finished hull and thinning toward the bow, fresh ones still
//                in primer; the plating front crackles with welding arcs
//   bay cranes   five travelling cranes, two on the top rails and three on the bottom, each
//                confined to its bay between two portal frames: it takes a plate off the bay's
//                magazine platform, carries it over the hull, lowers it into its gap and holds
//                it while the welders tack it, then goes back for the next
//   drones       welding drones hop between sites on the hull's flanks inside their bays,
//                arcs lit while they hold
//   crew pods    four pods run the lanes outside the frames between the crew house astern
//                and the work platforms, stopping at each frame's hatch
//   platforms    a walkway with railings, lockers, floodlights and a site cabin inside every
//                side of every working frame (the aft face, clear of the clamps and cranes)
//
// Every moving path is checked by tools/verify-geo.mjs against the dock, the hull line and
// the other movers.

export const WORKS = {
  plateInset: 5, plateLift: 4,
  // top cranes on the top rails, bottom cranes on the bottom rails: [bay start frame index, target z]
  cranes: [
    { bay: 5, top: true, target: 500, T: 210 },
    { bay: 7, top: true, target: 1060, T: 190 },
    { bay: 5, top: false, target: 420, T: 230 },
    { bay: 6, top: false, target: 780, T: 200 },
    { bay: 7, top: false, target: 1140, T: 220 },
  ],
  platformY: 168, travelY: 192, plate: [64, 4, 42],
  walk: { z0: -36, z1: -16, apothem: 236 },
  lane: { x: 300, z0: -1340, z1: 1200 },
  drones: 36, droneOff: 14, droneHop: 50, droneMinX: 45,
};

/** Outward unit normal of the hull section at (z, t) in the x-y plane. */
function sectionOut(z, t, out = V(0, 0, 0)) {
  const p = sectionPoint(z, t);
  return out.set(p.x, p.y, 0).normalize();
}

/** The crane's bay z range for its frame index i: travel keeps clear of both frames and the next frame's walkway. */
export function craneBay(c) {
  const z0 = YARD.frames[c.bay], z1 = YARD.frames[c.bay + 1];
  return { z0, z1, pick: z0 + 60, lo: z0 + 30, hi: z1 - 60 };
}

const CRANE_STEPS = schedule([['grab', 6], ['lift', 6], ['travel', 22], ['lower', 10], ['hold', 40], ['release', 6], ['return', 22], ['reload', 12]]);
/** Crane state at fraction u: z of the bridge, y of the carried plate (top-crane sense), plate states. */
export function cranePlate(c, u, out = {}) {
  const f = [0], i = CRANE_STEPS.at(u, f), s = f[0], e = smooth(0, 1, s);
  const bay = craneBay(c);
  const sgn = c.top ? 1 : -1;
  // plate centre over its gap: 5 m off the highest crown under its length (the hull swells
  // toward the stern across the plate's 42 m), which clears the crown stringer (2.2 m)
  let hullY = 0;
  for (let k = 0; k <= 4; k++) { const y = hullCrown(c.target + (k / 4 - 0.5) * WORKS.plate[2], c.top); if (Math.abs(y) > Math.abs(hullY)) hullY = y; }
  const yT = hullY + sgn * 5;
  const P = WORKS.platformY * sgn + sgn * 2, Tr = WORKS.travelY * sgn;
  let z = bay.pick, hook = P, carried = true, fitted = false, onPad = false;
  switch (CRANE_STEPS.names[i]) {
    case 'grab': hook = P; carried = false; onPad = true; break;
    case 'lift': hook = lerp(P, Tr, e); break;
    case 'travel': z = lerp(bay.pick, c.target, e); hook = Tr; break;
    case 'lower': z = c.target; hook = lerp(Tr, yT, e); break;
    case 'hold': z = c.target; hook = yT; break;
    case 'release': z = c.target; hook = lerp(yT, Tr, e); carried = false; fitted = true; break;
    case 'return': z = lerp(c.target, bay.pick, e); hook = Tr; carried = false; fitted = true; break;
    case 'reload': hook = lerp(Tr, P, e); carried = false; fitted = true; onPad = true; break;
    default: break;
  }
  out.z = z; out.hook = hook; out.carried = carried; out.fitted = fitted; out.onPad = onPad; out.yT = yT; out.pad = P;
  out.welding = CRANE_STEPS.names[i] === 'hold' && s > 0.15 && s < 0.95;
  return out;
}
/** Hull crown (top, or the keel line below) at z: where a crane's plate goes. */
export function hullCrown(z, top) { return top ? sectionPoint(z, Math.PI / 2).y : sectionPoint(z, 1.5 * Math.PI).y; }

/** Drone sites: on the flanks (within 35 degrees of port or starboard), inside one bay, clear of frames. */
export function droneSites(seed = 17) {
  const R = rng(seed), list = [];
  const bays = [[330, 575], [650, 895], [970, 1000], [205, 250]];
  for (let d = 0; d < WORKS.drones; d++) {
    const [a, b] = bays[d % bays.length];
    const side = d % 2 ? 0 : Math.PI;
    const sites = [];
    for (let k = 0; k < 4; k++) {
      const z = lerp(a, b, R()), t = side + (R() * 2 - 1) * (35 * Math.PI / 180);
      sites.push({ z, t });
    }
    list.push({ sites, T: 22 + 10 * R(), phase: R() });
  }
  return list;
}
/** Drone position: holding at a site (offset off the hull), or hopping out and across to the next. */
export function dronePos(dr, t, outP, outSite) {
  const n = dr.sites.length;
  const x = t / dr.T + dr.phase;
  const k = ((Math.floor(x) % n) + n) % n, u = x - Math.floor(x);
  const A = dr.sites[k], B = dr.sites[(k + 1) % n];
  const hold = u < 0.65;
  const s = hold ? 0 : smooth(0.65, 1, u);
  const z = lerp(A.z, B.z, s), tt = lerp(A.t, B.t, s);
  const off = WORKS.droneOff + WORKS.droneHop * Math.sin(Math.PI * s);
  const p = sectionPoint(z, tt), o = sectionOut(z, tt, _o);
  outP.set(p.x + o.x * off, p.y + o.y * off, z);
  if (outSite) outSite.set(p.x + o.x * 6, p.y + o.y * 6, z);
  return hold;
}
const _o = V(0, 0, 0);

/** Crew pod on its lane: runs from the house to the front, stopping at each frame's hatch. */
let _stops = null;
/** The pods' stops: abeam of each working frame's hatch (the hatch box meets the frame tube). */
export function podStops() { return (_stops ||= YARD.frames.slice(1).map((z) => z - 12)); }
export function crewPodPos(k, t, outP, outF) {
  const L = WORKS.lane;
  const stops = [L.z0, ...podStops(), L.z1];
  // out and back: 2*(n-1) legs, each a move (smoothed) then a dwell
  const nLeg = stops.length - 1, legT = 34, cyc = 2 * nLeg * legT;
  const x = ((t + k * 97) % cyc + cyc) % cyc;
  const leg = Math.floor(x / legT), u = (x - leg * legT) / legT;
  const fwd = leg < nLeg;
  const i0 = fwd ? leg : 2 * nLeg - leg, i1 = fwd ? i0 + 1 : i0 - 1;
  const e = smooth(0, 0.6, u);
  const side = k % 2 ? -1 : 1, yoff = k < 2 ? 40 : -40;
  outP.set(side * L.x, yoff, lerp(stops[i0], stops[i1], e));
  outF.set(0, 0, fwd ? 1 : -1);
  return u > 0.6;
}

// ------------------------------------------------------------- geometry --
/** Plates fitted over the skeleton (unique, merged): returns geometry, the weld front sites and the panel map. */
function buildPlating(seed = 5) {
  const B = new CB(), R = rng(seed);
  const edges = [YARD.plated, ...YARD.ribs];
  const NT = 24, inset = WORKS.plateInset, lift = WORKS.plateLift;
  const fitted = [];
  // a crane's gap: every panel under its plate's footprint (|x| within the plate's half width
  // and a margin) on its side of the hull, in the bay between the ribs round its target
  const reserved = (zc, i) => WORKS.cranes.some((c) => {
    if (Math.abs(c.target - zc) >= 40) return false;
    const pa = sectionPoint(zc, (i / NT) * TAU), pb = sectionPoint(zc, ((i + 1) / NT) * TAU);
    const side = c.top ? 1 : -1;
    if (pa.y * side <= 0 && pb.y * side <= 0) return false;
    const half = WORKS.plate[0] / 2 + 6;
    return Math.min(Math.abs(pa.x), Math.abs(pb.x)) < half || pa.x * pb.x <= 0;
  });
  for (let j = 0; j < edges.length - 1; j++) {
    const za = edges[j] + inset, zb = edges[j + 1] - inset, zc = (za + zb) / 2;
    const p = Math.min(Math.max(1.08 - (zc - 260) / 760, 0.04), 1);
    const row = [];
    for (let i = 0; i < NT; i++) {
      const on = !reserved(zc, i) && R() < p;
      row.push(on);
      if (!on) continue;
      const t0 = (i / NT) * TAU + 0.012, t1 = ((i + 1) / NT) * TAU - 0.012;
      const primer = zc > 260 + 760 * (0.5 + 0.3 * R());
      const k = primer ? CK.DECK : (R() < 0.12 ? CK.BRONZE : CK.HULL);
      const grid = [];
      const NZ = 4, NA = 4;
      for (let a = 0; a <= NA; a++) {
        const tt = lerp(t0, t1, a / NA);
        const col = [];
        for (let b = 0; b <= NZ; b++) {
          const z = lerp(za, zb, b / NZ);
          const q = sectionPoint(z, tt), o = sectionOut(z, tt);
          col.push(B.v(q.x + o.x * lift, q.y + o.y * lift, z, tt * 150, z, k));
        }
        grid.push(col);
      }
      const hintO = sectionOut(zc, (t0 + t1) / 2);
      for (let a = 0; a < NA; a++) for (let b = 0; b < NZ; b++) {
        const i0 = grid[a][b], i1 = grid[a + 1][b], i2 = grid[a][b + 1], i3 = grid[a + 1][b + 1];
        B.tri(i0, i1, i3, hintO); B.tri(i0, i3, i2, hintO);
      }
      // raised edge frame: the plate's welded lands
      const rim = [];
      for (let a = 0; a <= NA; a++) { const tt = lerp(t0, t1, a / NA), q = sectionPoint(za, tt), o = sectionOut(za, tt); rim.push(V(q.x + o.x * (lift + 0.5), q.y + o.y * (lift + 0.5), za)); }
      B.tube(rim, 0.7, 4, CK.DARK);
      rim.length = 0;
      for (let a = 0; a <= NA; a++) { const tt = lerp(t0, t1, a / NA), q = sectionPoint(zb, tt), o = sectionOut(zb, tt); rim.push(V(q.x + o.x * (lift + 0.5), q.y + o.y * (lift + 0.5), zb)); }
      B.tube(rim, 0.7, 4, CK.DARK);
    }
    fitted.push({ za, zb, row });
  }
  // the weld front: fitted plates with an open neighbour ahead of them (toward the bow) or beside
  const welds = [];
  for (let j = 0; j < fitted.length; j++) for (let i = 0; i < NT; i++) {
    if (!fitted[j].row[i]) continue;
    const ahead = j + 1 < fitted.length ? fitted[j + 1].row[i] : true;
    const beside = fitted[j].row[(i + 1) % NT];
    if (ahead && beside) continue;
    const tt = ((i + (beside ? 0.5 : 1)) / NT) * TAU, z = ahead ? (fitted[j].za + fitted[j].zb) / 2 : fitted[j].zb;
    const q = sectionPoint(z, tt), o = sectionOut(z, tt);
    welds.push(V(q.x + o.x * (lift + 1.5), q.y + o.y * (lift + 1.5), z));
  }
  return { geo: B.geometry(), welds, fitted };
}

/** Walkway module for one side of a frame (the top side; rotate about z for the others). */
function walkwayGeo(lamps) {
  const B = new CB();
  const W = WORKS.walk, ap = W.apothem, zc = (W.z0 + W.z1) / 2, wz = W.z1 - W.z0;
  B.box(0, ap, zc, 176, 3, wz, CK.DECK);                                  // grating deck
  for (const x of [-88, 88]) B.box(x, ap, zc, 3, 4, wz + 2, CK.BRONZE);   // end kerbs
  for (const x of [-60, 0, 60]) B.tube([V(x, ap + 1.5, zc), V(x, 246, -6)], 0.9, 6, CK.HULL);   // brackets into the frame tube
  // railings on both long edges, 1.1 m toward the axis
  for (const z of [W.z0 + 0.4, W.z1 - 0.4]) {
    for (let x = -84; x <= 84; x += 12) B.tube([V(x, ap - 1.5, z), V(x, ap - 2.6, z)], 0.07, 4, CK.HULL);
    B.tube([V(-84, ap - 2.6, z), V(84, ap - 2.6, z)], 0.06, 4, CK.BRONZE);
    B.tube([V(-84, ap - 2.05, z), V(84, ap - 2.05, z)], 0.04, 4, CK.HULL);
  }
  // lockers, a tool cart and a lit site cabin
  for (let k = 0; k < 4; k++) B.box(-70 + k * 2.2, ap - 2.6, W.z1 - 2, 2, 2.2, 1.2, k % 2 ? CK.HULL : CK.BRONZE);
  B.box(30, ap - 2.1, zc, 3, 1.2, 1.8, CK.DARK);
  B.box(-30, ap - 4.5, zc + 3, 12, 6, 8, CK.HULL);
  B.box(-30, ap - 4.5, zc + 3, 12.2, 2, 8.2, CK.LANTERN);
  B.box(-30, ap - 7.6, zc + 3, 13, 0.4, 9, CK.BRONZE);
  // floodlight poles at the ends
  for (const x of [-80, 80]) {
    B.tube([V(x, ap - 1.5, W.z0 + 2), V(x, ap - 7, W.z0 + 2)], 0.15, 4, CK.DARK);
    B.box(x, ap - 7.3, W.z0 + 2, 1.4, 0.6, 1.0, CK.BRONZE);
    lamps.push({ p: V(x, ap - 7.9, W.z0 + 2), r: 1.6, color: LAMP.WHITE, i: 1.6, dir: V(0, -1, 0) });
  }
  lamps.push({ p: V(-30, ap - 8.3, zc + 3), r: 1.0, color: LAMP.AMBER, i: 1.4, breathe: 0.2 });
  return B.geometry();
}

/** Plate magazine platform hung inside the frame (top sense; bottom ones are turned half round z). */
function magazineGeo(z0) {
  const B = new CB();
  const y = WORKS.platformY;
  B.box(0, y - 2, z0 + 60, 80, 4, 60, CK.DECK);
  for (const x of [-36, 36]) B.tube([V(x, y, z0 + 32), V(x, 245, z0 + 4)], 1.6, 6, CK.HULL);
  for (const x of [-40, 40]) B.box(x, y + 1, z0 + 60, 2, 2, 60, CK.BRONZE);
  // a stack of spare plates on the platform's aft end, clear of the pick
  for (let h = 0; h < 3; h++) B.box(0, y + 1 + h * 1.5, z0 + 34, 60, 1.4, 6, h % 2 ? CK.DECK : CK.HULL);
  return B.geometry();
}

function bayCraneGeo() {
  const B = new CB();
  const xr = 103.5, yr = 250;
  B.box(0, yr - 14, 0, 2 * xr + 30, 16, 22, CK.BRONZE);
  for (const x of [-xr, xr]) B.box(x, yr - 3, 0, 22, 18, 30, CK.DARK);
  B.box(62, yr - 27, 12, 16, 10, 10, CK.LANTERN);         // cab under the bridge
  B.box(62, yr - 21, 12, 17, 1, 11, CK.DARK);
  B.box(0, 218, 0, 30, 20, 30, CK.DARK);                  // trolley (on the bridge's centre)
  B.box(0, 224, 0, 34, 4, 34, CK.BRONZE);
  return B.geometry();
}
function plateGeo() {
  const [sx, sy, sz] = WORKS.plate;
  const B = new CB();
  B.box(0, 0, 0, sx, sy, sz, CK.DECK);
  B.box(0, sy / 2 + 0.3, 0, sx * 0.9, 0.6, 1.2, CK.BRONZE);
  B.box(0, sy / 2 + 0.3, 0, 1.2, 0.6, sz * 0.9, CK.BRONZE);
  return B.geometry();
}
function hatchGeo() {
  const B = new CB();
  B.box(0, 0, 0, 20, 10, 20, CK.HULL);
  B.box(10.5, 0, -2, 1, 7, 7, CK.LANTERN);
  B.box(0, 5.4, 0, 21, 0.8, 21, CK.BRONZE);
  return B.geometry();
}

// ------------------------------------------------------------- the system --
export class YardWorks {
  /** yardMesh: the yard's craft mesh (metres, km scale); its children draw in yard metres. */
  constructor(yardMesh) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    this.mesh = yardMesh;
    this.root = new THREE.Group();
    yardMesh.add(this.root);
    const lamps = [];
    // plating (unique)
    const pl = buildPlating();
    this.plating = pl;
    const platingMesh = new THREE.Mesh(pl.geo, yardMesh.material);
    platingMesh.onBeforeRender = yardMesh.onBeforeRender;
    platingMesh.renderOrder = 3;
    this.root.add(platingMesh);
    // walkways inside every side of every working frame (the aft frame carries the house struts)
    const wLamps = [];
    const wGeo = walkwayGeo(wLamps);
    const wm = [];
    for (const z of YARD.frames.slice(1)) for (let k = 0; k < 8; k++) {
      const M = new THREE.Matrix4().makeTranslation(0, 0, z).multiply(new THREE.Matrix4().makeRotationZ(k * Math.PI / 4));
      wm.push(M);
      if (k % 2 === 0) lamps.push(...placeLamps(wLamps, M));
    }
    this.walkways = fillInstances(instancedPart(yardMesh, wGeo, wm.length), wm);
    this.root.add(this.walkways);
    this.walkwayMatrices = wm;
    // crane bays: magazine platforms (static) and the cranes (moving)
    const mags = new CB();
    for (const c of WORKS.cranes) {
      const g = magazineGeo(craneBay(c).z0);
      if (!c.top) g.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI));
      c._mag = g;
    }
    const magGeo = placeMerge(WORKS.cranes.map((c) => ({ geo: c._mag, m: new THREE.Matrix4() })));
    const magMesh = new THREE.Mesh(magGeo, yardMesh.material);
    magMesh.onBeforeRender = yardMesh.onBeforeRender; magMesh.renderOrder = 3;
    this.root.add(magMesh);
    for (const c of WORKS.cranes) {
      const b = craneBay(c), s = c.top ? 1 : -1;
      lamps.push({ p: V(40 * s, (WORKS.platformY + 6) * s, b.pick), r: 2.2, color: LAMP.AMBER, i: 1.8, breathe: 0.4, phase: c.target * 0.001 });
    }
    const nC = WORKS.cranes.length;
    this.cranes = instancedPart(yardMesh, bayCraneGeo(), nC);
    this.plates = instancedPart(yardMesh, plateGeo(), nC * 2);
    this.cables = instancedPart(yardMesh, cableGeo(0.6, 5), nC);
    this.root.add(this.cranes, this.plates, this.cables);
    // drones
    this.droneData = droneSites();
    this.drones = instancedPart(yardMesh, droneGeo(6), this.droneData.length);
    this.root.add(this.drones);
    // crew pods and their hatches on the frames' outer sides
    this.pods = instancedPart(yardMesh, crewPodGeo(9), 4);
    const hm = [];
    for (const z of podStops()) for (const sx of [-1, 1]) {
      hm.push(new THREE.Matrix4().makeTranslation(sx * (YARD.frameR + 10), 0, z).multiply(new THREE.Matrix4().makeRotationY(sx > 0 ? 0 : Math.PI)));
      for (const y of [40, -40]) lamps.push({ p: V(sx * (YARD.frameR + 22), y * 0.3, z), r: 1.4, color: LAMP.TEAL, i: 1.6, breathe: 0.3, phase: z * 0.001 });
    }
    // (the hatch sits on the frame's flat side: the frame's apothem plus half the hatch)
    this.hatches = fillInstances(instancedPart(yardMesh, hatchGeo(), hm.length), hm);
    this.root.add(this.pods, this.hatches);
    // lamps: static set, then a dynamic set for drones, pods, crane beacons and every welding arc
    this.staticLamps = addLamps(this.root, lamps, { minPx: 0.9 });
    const dl = [];
    this.iDrone = 0;
    for (let i = 0; i < this.droneData.length; i++) dl.push({ p: V(), r: 1.2, color: LAMP.TEAL, i: 1.8 });
    this.iDroneArc = dl.length;
    for (let i = 0; i < this.droneData.length; i++) dl.push({ p: V(), r: 2.2, color: [0.75, 0.88, 1.0], i: 5.5 });
    this.iPod = dl.length;
    for (let i = 0; i < 4; i++) dl.push({ p: V(), r: 1.6, color: LAMP.WHITE, i: 2.2 });
    this.iCrane = dl.length;
    for (let i = 0; i < nC; i++) dl.push({ p: V(), r: 3, color: LAMP.AMBER, i: 2.4, breathe: 0.6, phase: i / nC });
    this.iCraneArc = dl.length;
    for (let i = 0; i < nC * 2; i++) dl.push({ p: V(), r: 2.4, color: [0.8, 0.9, 1.0], i: 6 });
    this.iFront = dl.length;
    const R = rng(77);
    this.front = pl.welds.filter(() => R() < 0.5).slice(0, 40);
    for (const p of this.front) dl.push({ p: p.clone(), r: 2.0, color: [0.78, 0.9, 1.0], i: 5 });
    this.dyn = new DynLamps(dl, { minPx: 1.0 });
    this.root.add(this.dyn.mesh);
    this.root.traverse((o) => { o.frustumCulled = false; });
    this._c = {}; this._m = new THREE.Matrix4(); this._p = V(); this._f = V(); this._a = V(); this._b = V(); this._s = V(); this._up = V(0, 1, 0);
    this.buildMs = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    this.update(0, 1e9);
  }

  triangles() {
    let t = 0;
    this.root.traverse((o) => { if (o.isMesh && o.geometry.index && !o.geometry.isInstancedBufferGeometry) t += (o.geometry.index.count / 3) * (o.isInstancedMesh ? o.count : 1); });
    return t;
  }

  /** px: the yard's apparent radius in pixels (details show from 120 px). */
  update(t, px) {
    const on = px > 120;
    this.root.visible = on;
    if (!on) return;
    const m = this._m, p = this._p, f = this._f, c = this._c, d = this.dyn;
    // cranes
    WORKS.cranes.forEach((cr, i) => {
      cranePlate(cr, t / cr.T + hash1(i * 3.3), c);
      m.makeTranslation(0, 0, c.z);
      if (!cr.top) m.multiply(this._rz || (this._rz = new THREE.Matrix4().makeRotationZ(Math.PI)));
      this.cranes.setMatrixAt(i, m);
      // plate in hand (or waiting on the magazine)
      m.makeTranslation(0, c.hook, c.onPad && !c.carried ? craneBay(cr).pick : c.z);
      if (c.fitted && !c.onPad) m.scale(this._s.set(1e-3, 1e-3, 1e-3));                 // the next plate is not out yet
      if (c.fitted && c.onPad) m.makeTranslation(0, c.pad, craneBay(cr).pick);            // reloaded onto the pad
      this.plates.setMatrixAt(i * 2, m);
      // the plate just fitted, held in its gap until the crane is back at the magazine
      m.makeTranslation(0, c.yT, cr.target);
      if (!c.fitted || c.onPad) m.scale(this._s.set(1e-3, 1e-3, 1e-3));
      this.plates.setMatrixAt(i * 2 + 1, m);
      const s = cr.top ? 1 : -1;
      this._a.set(0, 208 * s, c.z);
      this._b.set(0, c.hook + s * (WORKS.plate[1] / 2 + 0.6), c.z);
      spanMatrix(m, this._b, this._a);
      this.cables.setMatrixAt(i, m);
      d.set(this.iCrane + i, 0, 246 * s, c.z);
      for (const e of [0, 1]) {
        const k = this.iCraneArc + i * 2 + e;
        d.set(k, (e ? 30 : -30), c.yT + s * 2, cr.target + (e ? 12 : -12));
        d.gain(k, c.welding ? weldGain(t, i * 2 + e) : 0);
      }
    });
    for (const im of [this.cranes, this.plates, this.cables]) im.instanceMatrix.needsUpdate = true;
    // drones
    for (let i = 0; i < this.droneData.length; i++) {
      const dr = this.droneData[i];
      const hold = dronePos(dr, t, p, this._a);
      f.copy(this._a).sub(p);
      if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
      poseMatrix(m, p, f, this._up, 1);
      this.drones.setMatrixAt(i, m);
      d.setV(this.iDrone + i, p);
      d.setV(this.iDroneArc + i, this._a);
      d.gain(this.iDroneArc + i, hold ? weldGain(t, 100 + i) : 0);
    }
    this.drones.instanceMatrix.needsUpdate = true;
    // crew pods
    for (let k = 0; k < 4; k++) {
      crewPodPos(k, t, p, f);
      poseMatrix(m, p, f, this._up, 1);
      this.pods.setMatrixAt(k, m);
      d.set(this.iPod + k, p.x, p.y + 3, p.z + f.z * 5);
    }
    this.pods.instanceMatrix.needsUpdate = true;
    // the plating front
    for (let i = 0; i < this.front.length; i++) d.gain(this.iFront + i, weldGain(t, 300 + i));
    d.commit();
  }
}
