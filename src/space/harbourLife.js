import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { LAMP } from './lamps.js';
import { addLamps, pixelRadius, KM } from './craftMesh.js';
import { HS } from './harbour.js';
import {
  TAU, V, smooth, lerp, rng, hash1, schedule, instancedPart, fillInstances, DynLamps,
  capsuleGeo, containerGeo, droneGeo, cableGeo, poseMatrix, spanMatrix,
} from './lifeKit.js';

// THE HARBOUR AT WORK. The station (harbour.js) is the fabric; this is what moves in it and
// the working kit bolted onto it, all in the Harbour's drawn metres (children of a holder at
// the km scale) and instanced wherever a part repeats:
//
//   conveyors     every arm carries a pod line on each flank of its gallery: sealed cargo pods
//                 run out to the berth fingers on one side and back empty on the other,
//                 through lit transfer houses at both ends
//   straddle      each arm's keel face has a rail-borne straddle crane over its cargo racks: it
//   cranes        lifts a capsule off one end pad, carries it the length of the racks over the
//                 stock, sets it down on the far pad and, next cycle, brings it back
//   berth work    every berth gantry's trolley runs out along its boom with a container on the
//                 hook, lowers it over the ship's hatch and returns; stacks wait on the finger
//                 tip blocks beside the gantry legs
//   drones        inspection drones fly racetracks under every arm (the ring side), lit
//   rings         lift cars climb the spokes of all three wheels; radiator fins and lit street
//                 bands stand on the rims (they turn with the rings, as children of them)
//
// Everything keeps to envelopes the verifier checks (tools/verify-geo.mjs): conveyors end
// before the first berth finger, crane loads clear the racked stock, drones keep clear of the
// galleries and the middle ring, lift cars ride above the spoke collars.

// ---- layout, in the arm's local design frame: x along the arm, y out from the keel face
//      (the keel is at y 330), z across (s * side); scale HS to drawn metres
export const LIFE = {
  conveyor: { r0: 1500, r1: 12000, rail: 330, pod: 430, podR: 60, podL: 240, spacing: 500, speed: 42 },
  // (arms 1, 2 and 5 have their outer racks loaded by the fleet's tugs from a station 530 m
  // above the rack at 9,700 m, src/space/fleet.js: their cranes stand parked at the inboard pad)
  crane: { r0: 1400, r1: 11650, railZ: 420, railY: 410, padA: 1790, padB: 11000, padZ: 190, pad: 596, travel: 1000, bridge: 1320, legX: 150, T: 260, parked: [1, 2, 5] },
  town: { r0: 2000, pitch: 1400, segs: 7, len: 360, gap: 60, top: -200 },
  drone: { y: -520, r0: 2400, r1: 11600, z: 300, perArm: 6, speed: 55 },
  finger0: 12600,
};

const CR = LIFE.crane, CV = LIFE.conveyor, DR = LIFE.drone;
// crane cycle: at pad A lower, lift, carry to B, lower, rise; wait; at B lower, lift, carry back, lower, rise; wait
const CRANE_STEPS = schedule([['downA', 5], ['upA', 6], ['toB', 30], ['downB', 6], ['upB', 5], ['waitB', 12], ['downB2', 5], ['upB2', 6], ['toA', 30], ['downA2', 6], ['upA2', 5], ['waitA', 12]]);

/** Crane state at cycle fraction u: { r, z, hook (capsule centre height), carrying, at: 'A'|'B' where the capsule rests if not carried }. */
export function cranePose(u, out = {}) {
  const f = [0];
  const i = CRANE_STEPS.at(u, f), s = f[0], e = smooth(0, 1, s);
  const A = CR.padA, B = CR.padB, H = CR.travel, P = CR.pad;
  const name = CRANE_STEPS.names[i];
  let r = A, z = -CR.padZ, hook = H, carrying = false, rest = 'A';
  switch (name) {
    case 'downA': hook = lerp(H, P, e); break;
    case 'upA': hook = lerp(P, H, e); carrying = true; break;
    case 'toB': r = lerp(A, B, e); z = lerp(-CR.padZ, CR.padZ, smooth(0.2, 0.8, s)); carrying = true; break;
    case 'downB': r = B; z = CR.padZ; hook = lerp(H, P, e); carrying = true; break;
    case 'upB': r = B; z = CR.padZ; hook = lerp(P, H, e); rest = 'B'; break;
    case 'waitB': r = B; z = CR.padZ; rest = 'B'; break;
    case 'downB2': r = B; z = CR.padZ; hook = lerp(H, P, e); rest = 'B'; break;
    case 'upB2': r = B; z = CR.padZ; hook = lerp(P, H, e); carrying = true; break;
    case 'toA': r = lerp(B, A, e); z = lerp(CR.padZ, -CR.padZ, smooth(0.2, 0.8, s)); carrying = true; break;
    case 'downA2': hook = lerp(H, P, e); carrying = true; break;
    case 'upA2': hook = lerp(P, H, e); break;
    default: break;
  }
  out.r = r; out.z = z; out.hook = hook; out.carrying = carrying; out.rest = rest;
  return out;
}

/** Conveyor pod k of a line at time t: design r along the arm (wraps inside the end houses). */
export function podR(t, k, lineSign) {
  const len = CV.r1 - CV.r0, n = Math.floor(len / CV.spacing);
  const x = ((t * CV.speed + k * (len / n) + (lineSign > 0 ? 0 : len * 0.37)) % len + len) % len;
  return lineSign > 0 ? CV.r0 + x : CV.r1 - x;       // +1 runs outward, -1 inward
}
export const PODS_PER_LINE = Math.floor((CV.r1 - CV.r0) / CV.spacing);

/** Drone j of an arm's racetrack at time t: local design (r, y, z) and heading written to outP / outF. */
export function dronePose(t, j, armIndex, outP, outF) {
  const Ls = DR.r1 - DR.r0, Rt = DR.z, per = 2 * Ls + TAU * Rt;
  let s = ((t * DR.speed + (j / DR.perArm) * per + armIndex * 911) % per + per) % per;
  const bob = 18 * Math.sin(t * 0.21 + j * 1.7 + armIndex);
  if (s < Ls) { outP.set(DR.r0 + s, DR.y + bob, -Rt); outF.set(1, 0, 0); return outP; }
  s -= Ls;
  if (s < Math.PI * Rt) { const a = s / Rt - Math.PI / 2; outP.set(DR.r1 + Math.cos(a) * Rt, DR.y + bob, Math.sin(a) * Rt); outF.set(-Math.sin(a), 0, Math.cos(a)); return outP; }
  s -= Math.PI * Rt;
  if (s < Ls) { outP.set(DR.r1 - s, DR.y + bob, Rt); outF.set(-1, 0, 0); return outP; }
  s -= Ls;
  const a = s / Rt + Math.PI / 2;
  outP.set(DR.r0 + Math.cos(a) * Rt, DR.y + bob, Math.sin(a) * Rt); outF.set(-Math.sin(a), 0, Math.cos(a));
  return outP;
}

/** Arm frame: design-local (x along, y keel-out, z across) to the Harbour's drawn metres. */
export function armFrame(arm) {
  const s = arm.up ? 1 : -1;
  return new THREE.Matrix4().makeBasis(arm.d, V(0, s, 0), arm.side.clone().multiplyScalar(s)).setPosition(0, arm.y, 0).multiply(new THREE.Matrix4().makeScale(HS, HS, HS));
}

// ------------------------------------------------------------- geometry --
/** Static kit on every arm (design units, arm frame): conveyor rails, houses, crane rails, pads. */
function buildArmKit(B, lamps) {
  // conveyor rails on both flanks with their struts to the gallery, and a lit transfer house at each end
  for (const zs of [-1, 1]) {
    const z = zs * CV.rail;
    B.tube([V(CV.r0 - 200, 0, z), V(CV.r1 + 200, 0, z)], 18, 8, CK.BRONZE);
    for (let r = CV.r0 - 150; r <= CV.r1 + 150; r += 700) {
      const dm = ((r - 2000) % 1400 + 1400) % 1400;
      if (dm < 90 || dm > 1310) continue;                                         // clear of the gallery girdles
      B.tube([V(r, 0, zs * 215), V(r, 0, z)], 12, 6, CK.DARK);
    }
    for (const r of [CV.r0, CV.r1]) {
      const zc = zs * (CV.pod - 10);
      B.box(r, 0, zc, 380, 190, 190, CK.HULL);
      B.box(r, 100, zc, 400, 14, 204, CK.BRONZE);
      for (const dx of [-120, 0, 120]) B.box(r + dx, 0, zc + zs * 96, 70, 60, 4, CK.LANTERN);
      B.tube([V(r, 0, zs * 215), V(r, 0, zc - zs * 95)], 30, 8, CK.HULL);
      lamps.push({ p: V(r, 118, zc), r: 16, color: LAMP.AMBER, i: 1.8, breathe: 0.3, phase: (r * 0.0013 + zs) % 1 });
    }
    // crane rails on the keel face, held on struts from the keel between the racks
    const zc = zs * CR.railZ;
    B.tube([V(CR.r0, CR.railY, zc), V(CR.r1, CR.railY, zc)], 16, 8, CK.DARK);
    for (const r of [CR.r0, 3400, 4800, 6200, 7600, 9000, 10400, CR.r1]) B.tube([V(r, 360, 0), V(r, CR.railY, zc)], 14, 6, CK.HULL);
    for (const r of [CR.r0, CR.r1]) { B.box(r, CR.railY + 20, zc, 40, 50, 50, CK.BRONZE); lamps.push({ p: V(r, CR.railY + 60, zc), r: 12, color: LAMP.RED, i: 2.0 }); }
  }
  // the gallery town: lit terrace blocks slung under the gallery on its ring side (hotels, crew
  // quarters, offices over the cargo), three to a span between the girdles, with balconies,
  // roof gardens facing the rings and masts; lit window collars round the gallery by the girdles
  const TW = LIFE.town;
  for (let k = 0; k < TW.segs; k++) {
    const g = TW.r0 + k * TW.pitch;
    B.push(new THREE.Matrix4().makeTranslation(g + 60, 0, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
    lathe(B, [[232, -12, CK.BRONZE], [240, -10, CK.BRONZE], [240, -6, CK.LANTERN], [240, 6, CK.LANTERN], [240, 10, CK.BRONZE], [232, 12, CK.BRONZE]], 32);
    B.pop();
    for (let j = 0; j < 3; j++) {
      const rc = g + 80 + TW.len / 2 + j * (TW.len + TW.gap), y0 = TW.top;
      const tall = (k + j) % 3 === 1 ? 40 : 0;
      B.box(rc, y0 - 15, 0, TW.len, 30, 220, CK.DARK);                                   // slab seated in the gallery skin
      B.box(rc, y0 - 75 - tall / 2, 0, TW.len - 20, 90 + tall, 200, CK.HULL);
      for (const [yy, kk] of [[y0 - 55, CK.LANTERN], [y0 - 90, CK.LANTERN], [y0 - 120 - tall, (k + j) % 2 ? CK.LANTERN : CK.GLASS]]) B.box(rc, yy, 0, TW.len - 18, 14, 202, kk);
      B.box(rc, y0 - 124 - tall, 0, TW.len - 10, 8, 210, CK.BRONZE);
      B.box(rc, y0 - 130 - tall, 0, TW.len - 60, 4, 160, CK.GARDEN);                     // roof garden, facing the rings
      for (let x = -TW.len / 2 + 30; x <= TW.len / 2 - 30; x += 40) for (const yy of [y0 - 62, y0 - 97]) for (const zs of [-1, 1]) B.box(rc + x, yy, zs * 104, 24, 3, 8, CK.BRONZE);
      for (const x of [-TW.len / 2 + 20, TW.len / 2 - 20]) B.tube([V(rc + x, y0 - 128 - tall, 60), V(rc + x, y0 - 200 - tall, 60)], 3, 6, CK.DARK);
      lamps.push({ p: V(rc + TW.len / 2 - 20, y0 - 205 - tall, 60), r: 6, color: j % 2 ? LAMP.AMBER : LAMP.WHITE, i: 1.4, breathe: 0.2, phase: (k * 3 + j) / 21 });
    }
  }
  // the crane's two end pads: saddles like the racks'
  for (const [r, z] of [[CR.padA, -CR.padZ], [CR.padB, CR.padZ]]) {
    B.box(r, 422, z, 700, 56, 340, CK.BRONZE);
    for (const dx of [-300, 300]) B.box(r + dx, 470, z, 30, 40, 330, CK.DARK);
    lamps.push({ p: V(r, 470, z * 1.9), r: 10, color: LAMP.TEAL, i: 1.6, breathe: 0.4, phase: r * 0.0003 });
  }
}

/** The straddle crane's frame (design units, centred on its travel line at the keel face). */
function craneFrameGeo() {
  const B = new CB();
  const X = CR.legX, Z = CR.railZ, top = CR.bridge;
  for (const x of [-X, X]) for (const z of [-Z, Z]) {
    B.box(x, CR.railY + 36, z, 120, 40, 60, CK.DARK);                              // bogie on the rail
    B.tube([V(x, CR.railY + 56, z), V(x, top - 20, z)], 22, 8, CK.HULL);           // leg
  }
  for (const z of [-Z, Z]) {
    B.box(0, CR.railY + 70, z, 2 * X + 60, 24, 30, CK.BRONZE);                     // sill beam
    B.tube([V(-X, CR.railY + 80, z), V(X, top - 60, z)], 9, 6, CK.DARK);            // diagonal
  }
  for (const x of [-X, X]) B.box(x, top, 0, 44, 56, 2 * Z + 60, CK.BRONZE);          // bridge girders
  for (const z of [-Z, Z]) B.box(0, top, z, 2 * X + 44, 56, 44, CK.HULL);             // end ties
  // operator's cab hung outside a leg, lit, with its walkway
  B.box(X + 70, top - 150, Z, 90, 70, 80, CK.LANTERN);
  B.box(X + 70, top - 110, Z, 100, 10, 90, CK.BRONZE);
  B.box(X + 70, top - 190, Z, 94, 8, 84, CK.DARK);
  B.box(0, top + 34, 0, 2 * X + 40, 10, 30, CK.DECK);                                 // top catwalk
  return B.geometry();
}
function trolleyGeo() {
  const B = new CB();
  B.box(0, CR.bridge - 50, 0, 2 * CR.legX + 60, 40, 90, CK.DARK);
  B.box(0, CR.bridge - 76, 0, 120, 16, 70, CK.BRONZE);
  for (const x of [-100, 100]) B.box(x, CR.bridge - 40, 0, 30, 20, 100, CK.HULL);
  return B.geometry();
}
function hookGeo() {
  const B = new CB();
  B.box(0, 0, 0, 760, 24, 70, CK.BRONZE);           // spreader bar over the capsule's length
  for (const x of [-340, 340]) B.box(x, -30, 0, 20, 40, 40, CK.DARK);
  B.box(0, 20, 0, 90, 30, 60, CK.DARK);
  return B.geometry();
}

/** Berth trolley (drawn metres): a carriage under the boom with a winch house. */
function berthTrolleyGeo() {
  const B = new CB();
  B.box(0, 0, 0, 30, 8, 26, CK.DARK);
  B.box(0, -6, 0, 16, 5, 14, CK.BRONZE);
  B.box(0, 4, 8, 12, 6, 8, CK.LANTERN);
  return B.geometry();
}

/** Spoke lift car (design units): a pressurised car riding the spoke's rail, lit. +z along the spoke. */
function liftCarGeo() {
  const B = new CB();
  B.box(0, 0, 0, 80, 70, 130, CK.HULL);
  B.box(0, 0, 0, 84, 30, 110, CK.LANTERN);
  B.box(0, -40, 0, 30, 14, 140, CK.DARK);            // the running gear on the rail
  for (const z of [-66, 66]) B.box(0, 0, z, 86, 76, 6, CK.BRONZE);
  return B.geometry();
}

/** Rim radiator fin (design units): radial panel, root at y 0 rising +y, axial along z. */
function rimFinGeo(axial) {
  const B = new CB();
  B.box(0, 110, 0, 14, 220, axial, CK.RADIATOR);
  B.box(0, 224, 0, 22, 10, axial + 10, CK.BRONZE);
  B.box(0, 0, 0, 40, 26, axial * 0.9, CK.DARK);      // manifold on the rim
  return B.geometry();
}
/** Lit street band (design units): a glazed strip module on the rim with a bronze coping. */
function streetBandGeo(axial) {
  const B = new CB();
  B.box(0, 8, 0, 160, 18, axial, CK.LANTERN);
  B.box(0, 18, 0, 170, 4, axial + 8, CK.BRONZE);
  for (const z of [-axial / 2 + 20, 0, axial / 2 - 20]) B.box(0, 30, z, 12, 24, 12, CK.HULL);
  return B.geometry();
}

// ------------------------------------------------------------- the system --
export class HarbourLife {
  /** station: HarbourStation (its body material and data). */
  constructor(station) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    this.station = station;
    const h = station.data, body = station.body;
    this.root = new THREE.Group();
    this.root.scale.setScalar(KM);
    station.group.add(this.root);
    this.arms = h.arms.map((arm, i) => ({ arm, i, F: armFrame(arm) }));
    // ---- static kit on every arm: one merged mesh (design geometry placed by arm frames)
    const kitLamps = [];
    const kit = new CB();
    const kitLocal = [];
    buildArmKit(kit, kitLocal);
    const kitGeo = kit.geometry();
    const kitMats = this.arms.map((a) => a.F);
    this.kit = fillInstances(instancedPart(body, kitGeo, kitMats.length), kitMats);
    this.root.add(this.kit);
    for (const a of this.arms) for (const l of kitLocal) kitLamps.push({ ...l, p: l.p.clone().applyMatrix4(a.F), r: l.r * HS });
    // ---- conveyors: pods on both lines of every arm
    this.podGeo = capsuleGeo(CV.podL, CV.podR, 12, true);
    this.pods = instancedPart(body, this.podGeo, this.arms.length * PODS_PER_LINE * 2);
    this.root.add(this.pods);
    // ---- straddle cranes
    const n = this.arms.length;
    this.craneFrames = instancedPart(body, craneFrameGeo(), n);
    this.trolleys = instancedPart(body, trolleyGeo(), n);
    this.hooks = instancedPart(body, hookGeo(), n);
    this.loads = instancedPart(body, capsuleGeo(880, 150, 16, false), n);
    this.craneCables = instancedPart(body, cableGeo(6, 5), n * 2);
    this.root.add(this.craneFrames, this.trolleys, this.hooks, this.loads, this.craneCables);
    this.cranePhase = this.arms.map((a) => hash1(a.i * 5.3 + 1));
    // ---- berth gantries at work
    const berthsWorked = h.berths.filter((b) => b.ship);
    this.berthWork = berthsWorked.map((b, k) => {
      const gi = h.berths.indexOf(b);
      const g = h.gantries[gi];
      return { b, g, phase: hash1(k * 2.7 + 0.3), T: 150 + 60 * hash1(k * 9.1), zShip: Math.min(125 + b.ship.halfW, 520) };
    });
    this.bTrolleys = instancedPart(body, berthTrolleyGeo(), this.berthWork.length);
    this.bBoxes = instancedPart(body, containerGeo(14, 8, 8), this.berthWork.length);
    this.bCables = instancedPart(body, cableGeo(0.35, 5), this.berthWork.length * 2);
    this.root.add(this.bTrolleys, this.bBoxes, this.bCables);
    // container stacks on the finger tip blocks, beside the gantry legs (static)
    const stack = [];
    const R = rng(4242);
    for (const g of h.gantries) {
      for (const z of [-30, -46, -62]) for (const x of [-45, -15, 15, 45]) {
        const hN = 1 + Math.floor(R() * 3);
        for (let k = 0; k < hN; k++) stack.push(g.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(x, 80 + 4 + k * 8.2, z)));
      }
    }
    this.stacks = fillInstances(instancedPart(body, containerGeo(24, 8, 8), stack.length), stack);
    this.root.add(this.stacks);
    // ---- drones under the arms, each with its own moving lamp
    this.drones = instancedPart(body, droneGeo(8), this.arms.length * DR.perArm);
    this.root.add(this.drones);
    const dl = [];
    for (let i = 0; i < this.arms.length * DR.perArm; i++) dl.push({ p: V(0, 0, 0), r: 2.5, color: i % 3 ? LAMP.WHITE : LAMP.TEAL, i: 2.4, breathe: 0.5, phase: (i * 0.37) % 1 });
    // crane beacons ride the cranes
    for (let i = 0; i < n; i++) dl.push({ p: V(0, 0, 0), r: 9, color: LAMP.AMBER, i: 2.6, breathe: 0.6, phase: i / n });
    this.dynLamps = new DynLamps(dl, { minPx: 1.1 });
    this.root.add(this.dynLamps.mesh);
    // ---- the rings: lift cars on the spokes, fins and street bands on the rims (children of the rings)
    this.ringLife = station.rings.map((ring, ri) => {
      const d = h.rings[ri];
      const big = d.R > 9000 * HS;
      const R0 = d.R / HS, yc = d.y / HS;
      const b = big ? 560 : 430, a = big ? 980 : 720, hubR = big ? 3100 : 1400;
      const cars = instancedPart(body, liftCarGeo(), 6 * 2);
      const nRib = big ? 48 : 36;
      const fins = [], bands = [];
      const finG = rimFinGeo(a * 0.8), bandG = streetBandGeo(a * 0.5);
      for (let k = 0; k < nRib; k++) {
        if (k % (nRib / 6) === 0) continue;               // the spokes meet the rim here
        const th = (k / nRib) * TAU;
        const dir = V(Math.cos(th), 0, Math.sin(th));
        // fins root 14 below the rim's crown (their manifold seats on the curved floor across
        // their whole length); the short street bands sit 2 into it
        const M = poseMatrix(new THREE.Matrix4(), dir.clone().multiplyScalar(R0 + b - (k % 2 ? 14 : 2)).setY(yc), V(0, 1, 0), dir, 1);
        (k % 2 ? fins : bands).push(new THREE.Matrix4().makeScale(HS, HS, HS).multiply(M));
      }
      // instance frame: basis x = side, y = radial out, z = axial (world y)
      const finM = fillInstances(instancedPart(body, finG, fins.length), fins);
      const bandM = fillInstances(instancedPart(body, bandG, bands.length), bands);
      // a pivot beside the ring (not a child: the station's own surveys walk the ring meshes)
      // that copies its turn every frame
      const pivot = new THREE.Group();
      pivot.add(cars, finM, bandM);
      this.root.add(pivot);
      return { ring, pivot, cars, R0, yc, b, hubR, fins: finM, bands: bandM };
    });
    // ---- static lamps for the kit
    this.kitLamps = addLamps(this.root, kitLamps, { minPx: 1.0 });
    this.root.traverse((o) => { o.frustumCulled = false; });
    this._w = new THREE.Vector3();
    this._m = new THREE.Matrix4(); this._m2 = new THREE.Matrix4();
    this._p = new THREE.Vector3(); this._f = new THREE.Vector3(); this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._crane = {};
    this.buildMs = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    this.update(0, null);
  }

  /** Count of rendered triangles at full detail (for the budget check). */
  triangles() {
    let t = 0;
    this.root.traverse((o) => { if (o.isMesh && o.geometry.index) t += (o.geometry.index.count / 3) * (o.isInstancedMesh ? o.count : 1); });
    return t;
  }

  update(realTime, space) {
    // detail only while the Harbour spans enough of the screen to show it
    let px = 1e9;
    if (space && space.camera) px = pixelRadius(space.camera, this.station.group.getWorldPosition(this._w), 13, space.size.y);
    const on = px > 220;
    this.root.visible = on;
    if (!on) return;
    for (const rl of this.ringLife) rl.pivot.rotation.y = rl.ring.rotation.y;
    const t = realTime;
    const m = this._m, T = this._m2, p = this._p, f = this._f;
    // conveyors
    let k = 0;
    for (const a of this.arms) for (const ls of [1, -1]) for (let j = 0; j < PODS_PER_LINE; j++) {
      const r = podR(t, j, ls);
      T.makeTranslation(r, 0, ls * CV.pod);
      m.multiplyMatrices(a.F, T);
      this.pods.setMatrixAt(k++, m);
    }
    this.pods.instanceMatrix.needsUpdate = true;
    // straddle cranes
    const c = this._crane, nA = this.arms.length;
    for (const a of this.arms) {
      const i = a.i;
      cranePose(CR.parked.includes(i) ? 0.97 : t / CR.T + this.cranePhase[i], c);
      T.makeTranslation(c.r, 0, 0); m.multiplyMatrices(a.F, T); this.craneFrames.setMatrixAt(i, m);
      T.makeTranslation(c.r, 0, c.z); m.multiplyMatrices(a.F, T); this.trolleys.setMatrixAt(i, m);
      const hookY = c.hook + 150 + 40;
      T.makeTranslation(c.r, hookY, c.z); m.multiplyMatrices(a.F, T); this.hooks.setMatrixAt(i, m);
      const lr = c.carrying ? c.r : c.rest === 'A' ? CR.padA : CR.padB;
      const lz = c.carrying ? c.z : c.rest === 'A' ? -CR.padZ : CR.padZ;
      const ly = c.carrying ? c.hook : CR.pad;
      T.makeTranslation(lr, ly, lz); m.multiplyMatrices(a.F, T); this.loads.setMatrixAt(i, m);
      for (const s of [0, 1]) {
        const dx = s ? 300 : -300;
        this._a.set(c.r + dx, CR.bridge - 84, c.z).applyMatrix4(a.F);
        this._b.set(c.r + dx, hookY + 12, c.z).applyMatrix4(a.F);
        spanMatrix(m, this._b, this._a);
        m.scale(p.set(HS, 1, HS));
        this.craneCables.setMatrixAt(i * 2 + s, m);
      }
      p.set(c.r, CR.bridge + 50, 0).applyMatrix4(a.F);
      this.dynLamps.setV(nA * DR.perArm + i, p);
    }
    for (const im of [this.craneFrames, this.trolleys, this.hooks, this.loads, this.craneCables]) im.instanceMatrix.needsUpdate = true;
    // berth gantries: out along the boom with a box, down over the hatch, back empty, down to the block
    for (let q = 0; q < this.berthWork.length; q++) {
      const w = this.berthWork[q];
      const u = ((t / w.T + w.phase) % 1 + 1) % 1;
      // 0-.3 run out loaded, .3-.4 lower over the hatch and let go, .4-.5 raise empty, .5-.8 run
      // back; the next box waits on the block from the hand-over on: .8-.9 lower onto it, .9-1 lift
      let z, hy, boxY, boxZ, shown = true;
      if (u < 0.3) { z = lerp(70, w.zShip, smooth(0, 0.3, u)); hy = 226; boxY = hy; boxZ = z; }
      else if (u < 0.4) { z = w.zShip; hy = lerp(226, 206, smooth(0.3, 0.4, u)); boxY = hy; boxZ = z; }
      else {
        boxY = 84; boxZ = 70;
        if (u < 0.5) { z = w.zShip; hy = lerp(206, 226, smooth(0.4, 0.5, u)); }
        else if (u < 0.8) { z = lerp(w.zShip, 70, smooth(0.5, 0.8, u)); hy = 226; }
        else if (u < 0.9) { z = 70; hy = lerp(226, 84, smooth(0.8, 0.9, u)); }
        else { z = 70; hy = lerp(84, 226, smooth(0.9, 1, u)); boxY = hy; }
        shown = u >= 0.42;                                                     // gone into the hatch
      }
      T.makeTranslation(0, 250, z); m.multiplyMatrices(w.g.matrix, T); this.bTrolleys.setMatrixAt(q, m);
      T.makeTranslation(0, boxY, boxZ); m.multiplyMatrices(w.g.matrix, T);
      if (!shown) m.scale(p.set(0.001, 0.001, 0.001));
      this.bBoxes.setMatrixAt(q, m);
      const by = hy;
      for (const s of [0, 1]) {
        this._a.set(s ? 5 : -5, 244, z).applyMatrix4(w.g.matrix);
        this._b.set(s ? 5 : -5, by + 4, z).applyMatrix4(w.g.matrix);
        spanMatrix(m, this._b, this._a);
        this.bCables.setMatrixAt(q * 2 + s, m);
      }
    }
    for (const im of [this.bTrolleys, this.bBoxes, this.bCables]) im.instanceMatrix.needsUpdate = true;
    // drones
    k = 0;
    for (const a of this.arms) for (let j = 0; j < DR.perArm; j++) {
      dronePose(t, j, a.i, p, f);
      this._a.copy(p).applyMatrix4(a.F);
      this._b.copy(f).transformDirection(a.F);
      poseMatrix(m, this._a, this._b, this._up, 1);
      this.drones.setMatrixAt(k, m);
      this._a.addScaledVector(this._b, 3.4);
      this.dynLamps.setV(k, this._a);
      k++;
    }
    this.drones.instanceMatrix.needsUpdate = true;
    this.dynLamps.commit();
    // lift cars on the spokes (ring-local; the ring's own rotation carries them round)
    for (const rl of this.ringLife) {
      for (let s = 0; s < 6; s++) {
        const th = (s / 6) * TAU;
        const dx = Math.cos(th), dz = Math.sin(th);
        for (let q = 0; q < 2; q++) {
          // two cars per spoke, out of phase, each easing between hub and rim stations
          const u = ((t / 180 + s * 0.17 + q * 0.5) % 1 + 1) % 1;
          const e = u < 0.5 ? smooth(0.05, 0.45, u) : 1 - smooth(0.55, 0.95, u);
          const fr = lerp(0.13, 0.87, e);
          const rr = rl.hubR + fr * (rl.R0 - rl.b * 0.9 - rl.hubR);
          // the two cars run side by side on the rail's two faces (45 m either side of its crown)
          const o = (q ? -45 : 45) * HS;
          p.set(dx * rr * HS + dz * o, (rl.yc + 220) * HS, dz * rr * HS - dx * o);
          f.set(dx, 0, dz);
          poseMatrix(m, p, f, this._up, HS);
          rl.cars.setMatrixAt(s * 2 + q, m);
        }
      }
      rl.cars.instanceMatrix.needsUpdate = true;
    }
  }
}
