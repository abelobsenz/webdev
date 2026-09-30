import * as THREE from 'three';
import { DockHardware } from './dockKit.js';
import { SELENE_DOCK, TENDER_DOCK } from './portSites.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildLiner, buildTender, buildRefinery, CB, CK } from '../craft/craftGeometry.js';
import { buildShuttle, buildTug, buildCourier, buildFreighter, lathe } from '../craft/craftClasses.js';
import { createGlowMesh } from '../craft/craftMaterial.js';
import { craftMesh, craftPart, addEngines, addLamps, placeMerge, placeLamps, KM, dressedMesh, DK, LIVERIES } from './craftMesh.js';
import { LAMP, createLamps } from './lamps.js';
import { R_EARTH, R_MOON, MERIDIAN_LON, bodyDir } from './sim.js';
import { stationFrame, CORRIDORS } from './stations.js';
import { HS } from './harbour.js';
import { FleetTraffic } from './fleetTraffic.js';
import { buildWorksTender } from './tenderHull.js';
import { buildConcordLiner } from './linerHull.js';
import { buildLinerDetail, buildFreighterDetail, buildTenderDetail, buildEvaWorker, evaPose, evaLines, EVA_PARTIES } from './linerDetail.js';
import { buildWheelDetail, buildLiftCar, buildRingCrane, liftPose, craneAngle, RING, seleneShells, seleneWheelShells } from './seleneDetail.js';

/** km: the liners' near fittings are drawn inside this range (a 2.4 km hull spans ~60 px at 60 km). */
export const LINER_DETAIL_RANGE = 60;
/** km: Selene's wheel walks, lifts and cranes are drawn inside this range. */
export const SELENE_DETAIL_RANGE = 45;
/** km: the tenders' deck fittings are drawn inside this range. */
export const TENDER_DETAIL_RANGE = 25;

// MERIDIAN's ships in the orbital view (km units; the craft are built in metres).
//
//  Harbour     the Concord-class liner berthed at the liner pier; a second liner and an
//              outer-system freighter on voyage cycles through the arrival corridor (tail
//              first, braking toward the Harbour, amber lane) and the departure corridor
//              (drive lit, outbound, blue lane); tugs working between the arms and bays
//  Halo        port shuttles climbing the Nauru port column to the Halo and diving back
//              down the other; three reclamation tenders nearby, one carrying a relic
//  Moon        Selene Works above the near side, tankers berthed at its docking ring and
//              one on the Earth run
//
//  Working lanes  (src/space/fleetTraffic.js, designs in src/space/shipDesigns.js) seventy
//              more ships: two outer roads round the Harbour (tail-first braking arrivals, a
//              flip and hold at the outer gate, a wide swing round the tether, departures
//              under power; convoys with tug escorts, a packet train, spin-ring clippers),
//              holding stacks off the arrival side, Selene's ore barges, patrol and convoys,
//              and two crews of work drones over the tenders; instanced hulls, nav lamps,
//              drive plumes and RCS puffs from each design's real nozzles
//  Close to     built on first approach, hidden beyond range: the Concord liners' fittings
//              (src/space/linerDetail.js), Selene's wheel walks, spoke lifts and ring cranes
//              (src/space/seleneDetail.js), the tankers' and the tenders' deck fittings
//
// Everything decorative moves in real time (warped sim time made ships strobe). Each ship
// that can wander far from its station is its own depth-sliced body; targets read the
// analytic pose() (the rig samples targets before the modules update).

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

/** The Nauru port on the Halo: the Halo target and the tenders work here (afternoon light at Meridian's default hour). */
export const NAURU_LON = THREE.MathUtils.degToRad(166.9);

/** Orientation with +Z along fwd and +Y as close to upHint as possible. */
const _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _lz = new THREE.Vector3(), _lm = new THREE.Matrix4();
function lookQuat(fwd, upHint, out) {
  const z = _lz.copy(fwd).normalize();
  const x = _lx.crossVectors(upHint, z);
  if (x.lengthSq() < 1e-10) x.set(1, 0, 0).cross(z);
  if (x.lengthSq() < 1e-10) x.set(0, 0, 1).cross(z);
  x.normalize();
  const y = _ly.crossVectors(z, x);
  return out.setFromRotationMatrix(_lm.makeBasis(x, y, z));
}

/**
 * A voyage cycle in a station frame: arrive tail-first along dA (braking burn, the plume
 * pointing at the station), turn at the hold point, depart along dD with the drive lit.
 * The cycle wraps while the ship is far out in both corridors (sub-pixel from the station).
 */
export function voyage(u, c, outPos, outFwd) {
  let thr = 0;
  if (u < 0.42) {
    const s = u / 0.42;
    outPos.copy(c.hold).addScaledVector(c.dA, c.S * (1 - s) * (1 - s));
    outFwd.copy(c.dA);
    thr = smooth(0, 0.06, s) * (1 - smooth(0.72, 0.98, s));
  } else if (u < 0.58) {
    const s = smooth(0, 1, (u - 0.42) / 0.16);
    outPos.copy(c.hold).lerp(c.start, s).addScaledVector(c.bulge, Math.sin(Math.PI * s));
    // turn through the station's up axis (dA and dD point roughly apart)
    const w = smooth(0.15, 0.85, s);
    outFwd.copy(c.dA).multiplyScalar(1 - w).addScaledVector(c.dD, w).addScaledVector(TURN_AXIS, Math.sin(Math.PI * w)).normalize();
  } else {
    const s = (u - 0.58) / 0.42;
    outPos.copy(c.start).addScaledVector(c.dD, c.S * s * s);
    outFwd.copy(c.dD);
    thr = 1.15 * smooth(0, 0.07, s) * (1 - smooth(0.88, 1, s));
  }
  return thr;
}

const TURN_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * The visiting liner's voyage (Harbour frame, km): it holds high above the freighters'
 * arrival lanes (8 km off their axis) and turns over the top to leave well above the
 * departure lanes, so the three docking movements (src/space/geoRoads.js) keep their roads.
 */
export function approachVoyage() {
  const c = CORRIDORS;
  return {
    hold: c.dA.clone().multiplyScalar(30).add(V(0, 9, 0)), start: c.dD.clone().multiplyScalar(28).add(V(0, 8, 3)),
    dA: c.dA.clone().add(V(0.05, -0.1, 0.12)).normalize(), dD: c.dD.clone().add(V(0, -0.08, -0.1)).normalize(), S: 3000, bulge: V(0, 10, 0), T: 2100, offset: 0.3,
  };
}

/** Back-and-forth transit along a cubic Bezier with pauses at both ends. */
export function shuttleRun(t, c, outPos, outFwd) {
  const T = c.move * 2 + c.pause * 2;
  let ph = ((t + c.offset) % T + T) % T;
  let back = false;
  if (ph >= c.move + c.pause) { back = true; ph -= c.move + c.pause; }
  const moving = ph < c.move;
  const s = moving ? smooth(0, 1, ph / c.move) : 1;
  const e = back ? 1 - s : s;
  const P = c.pts;
  const a = 1 - e;
  outPos.set(0, 0, 0).addScaledVector(P[0], a * a * a).addScaledVector(P[1], 3 * a * a * e).addScaledVector(P[2], 3 * a * e * e).addScaledVector(P[3], e * e * e);
  // tangent
  const d = _v.set(0, 0, 0).addScaledVector(P[0], -3 * a * a).addScaledVector(P[1], 3 * a * a - 6 * a * e).addScaledVector(P[2], 6 * a * e - 3 * e * e).addScaledVector(P[3], 3 * e * e);
  if (d.lengthSq() > 1e-12) outFwd.copy(d).normalize().multiplyScalar(back ? -1 : 1);
  const q = moving ? ph / c.move : 1;
  return moving ? 0.55 * (1 - smooth(0.12, 0.3, q)) + 0.4 * smooth(0.72, 0.8, q) * (1 - smooth(0.9, 1, q)) : 0;
}

/**
 * Selene's tanker run (refinery frame, km): in tail first down the amber corridor to the hold
 * point over the docking ring, across, and out along the blue one. Two tankers keep it, a
 * quarter cycle apart (the second holds for a berth as the scene opens while the first leaves).
 */
export const SELENE_RUN = {
  hold: V(3.2, 5.5, 1.5), start: V(-2.5, 5.2, -2.2),
  dA: V(0.35, 1, 0.25).normalize(), dD: V(-0.3, 1, -0.3).normalize(), S: 1800, bulge: V(0, 2, 0), T: 1300, offsets: [0.62, 0.425],
};

/** Beacon pairs along Selene's corridors (refinery frame, km): hold/start points and directions from the tanker's voyage. */
export function seleneLanes(c) {
  const out = [];
  for (const [from, dir, color, inward] of [[c.hold, c.dA, LAMP.AMBER, true], [c.start, c.dD, LAMP.BLUE, false]]) {
    const e1 = new THREE.Vector3().crossVectors(dir, V(0, 0, 1)).normalize();
    for (let i = 0; i < 16; i++) {
      const s = 6 + i * i * 4.6;
      for (const sd of [-1, 1]) out.push({ p: from.clone().addScaledVector(dir, s).addScaledVector(e1, sd * (0.9 + i * 0.12)), r: 0.03 + i * 0.01, color, i: 2.8, breathe: 0.4, phase: ((inward ? i : 16 - i) / 16) % 1 });
    }
  }
  return out;
}

/**
 * The capturing tender's cradle opening (1 wide open .. 0.12 closed on the relic), a 200 s cycle,
 * phased so the scene opens with the petals half closed over the settling relic.
 */
export function captureOpen(t) {
  const u = (((t / 200) + 0.47) % 1 + 1) % 1;
  if (u < 0.4) return 1;
  if (u < 0.55) return 1 - 0.88 * smooth(0.4, 0.55, u);
  if (u < 0.85) return 0.12;
  return 0.12 + 0.88 * smooth(0.85, 1, u);
}

/** A dead satellite of the old kind: box bus in foil, two wings, a dish. Metres. */
export function buildRelic() {
  const B = new CB();
  B.box(0, 0, 0, 6, 6, 9, CK.BRONZE);
  B.box(0, 3.4, 0, 3, 0.8, 3, CK.DARK);
  for (const s of [-1, 1]) {
    B.box(s * 4.5, 0, 0, 3, 0.3, 0.3, CK.DARK);
    B.panel(Math.min(s * 6, s * 18), Math.max(s * 6, s * 18), -2.2, 2.2, 0, 0.12, CK.PANEL);   // (ordered: a reversed span built an inside-out wing)
  }
  B.at(0, -3.6, 1.5, Math.PI / 2 + 0.4, 0, 0);
  lathe(B, [[0.3, 0, CK.HULL], [2.8, 1.1, CK.HULL], [2.9, 1.2, CK.DARK]], 14);
  B.pop();
  return B.geometry();
}

export class Fleet {
  constructor(space) {
    this.space = space;
    this.crafts = [];
    this.movers = [];
    const el = space.elevator;
    const station = el.station;
    // ---- the Concord-class liner at the liner pier (engines dark, lamps lit)
    // (the builder's liner stays the reference the pier, the clamps and the fittings are
    // surveyed against; she is drawn rebuilt on the same envelope: src/space/linerHull.js)
    const liner = buildLiner(2400);
    this.linerGeo = liner;
    const linerPainted = buildConcordLiner(2400);
    this.linerHull = linerPainted;
    {
      const m = dressedMesh(linerPainted.geo, { accent: [0.55, 0.85, 1.0], lit: 0.62, livery: [0.58, 0.2, 0.12], livery2: [0.88, 0.84, 0.74] });
      station.linerBerth(m.position, m.quaternion);
      addLamps(m, linerPainted.lamps, { minPx: 1.3 });
      el.harbour.add(m);
      this.docked = m;
      this.crafts.push(m);
      // port shuttles docked at two keel collars, dorsal hatch to the collar's face
      this.linerAttendants = linerAttendants(liner.geo);
      const att = craftPart(m, this.linerAttendants.geo);
      m.add(att);
      addLamps(m, this.linerAttendants.lamps, { minPx: 1.2 });
    }
    // ---- voyage cycles through the Harbour's corridors (harbour frame, km)
    const H = el.harbour;
    const corr = CORRIDORS;
    this.corridors = corr;
    // (freighters now dock at the arm heads: src/space/geoRoads.js movements)
    this._addVoyager('approach', linerPainted, H, { ...approachVoyage(), livery: LIVERIES[1],
      engine: { scale: 0.55, length: 16, color: 0x7fd8ff }, glow: [0.55, 0.8, 1.0], accent: [1.0, 0.72, 0.45],
    });
    // ---- tugs and a courier working the Harbour (children of the Harbour: short hops)
    const tug = buildTug(80), courier = buildCourier(44), shuttle = buildShuttle(110);
    const A = station.data.arms;
    // (the arm heads belong to the berthing freighters and their escort tugs, src/space/geoRoads.js)
    // a tug's loading station 530 m (drawn) off the arm, clear over the outermost cargo rack's pods on an arm's keel
    const rack = (i) => A[i].d.clone().multiplyScalar(9700 * HS * KM).setY((A[i].y + (A[i].up ? 1 : -1) * 1260 * HS) * KM);
    // the shuttle's stand beside the customs pod on arm 6, on the side away from its berthed ships
    const pod = (i, dy) => A[i].d.clone().multiplyScalar((A[i].L - 980 - 250) * KM).addScaledVector(A[i].side, -0.55).setY((A[i].y + (A[i].up ? 1 : -1) * 590) * KM + dy);
    const flat = (p, k) => p.clone().setY(0).multiplyScalar(k).setY(p.y);
    // The lower tug passes beneath the thermal fins before climbing to the rack it loads.
    const runs = [
      { craft: tug, pts: [V(1.25, -6.1, 0.35), V(3.8, -7.2, 1.7), rack(5).add(V(0, -3.0, 0)), rack(5)], move: 150, pause: 45, offset: 0 },
      // stock handed between the racks of two neighbouring arms, level beneath the upper ring
      { craft: tug, pts: [rack(1), flat(rack(1), 1.3), flat(rack(2), 1.3), rack(2)], move: 130, pause: 60, offset: 80 },
      { craft: courier, pts: [V(-0.95, 6.1, 0.2), V(-2.5, 7.2, 1.3), corr.dD.clone().multiplyScalar(9.5).add(V(0, 2.5, 0)), corr.dD.clone().multiplyScalar(13).add(V(0, 2.1, 0))], move: 110, pause: 50, offset: 30 },
      { craft: shuttle, pts: [V(0.2, -6.1, -1.0), V(0, -8.4, -3.4), pod(6, -1.5), pod(6, 0)], move: 170, pause: 55, offset: 120 },
    ];
    this.runs = runs.map((r, i) => {
      const m = craftMesh(r.craft.geo, { accent: [0.55, 0.9, 1.0], lit: 0.5 });
      const eng = addEngines(m, r.craft.glows, { scale: 0.7, length: 7, throttle: 0 });
      addLamps(m, r.craft.lamps, { minPx: 1.2 });
      H.add(m);
      this.crafts.push(m);
      return { ...r, mesh: m, engines: eng, pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1) };
    });
    // ---- port shuttles on the Nauru columns: up the east column, down the west one
    const nUp = bodyDir(0, NAURU_LON);
    this.portFrame = new THREE.Group();
    this.portFrame.position.copy(nUp).multiplyScalar(R_EARTH);
    stationFrame(nUp, this.portFrame.quaternion);
    space.earthFixed.add(this.portFrame);
    this.portShuttles = [0, 1].map((i) => {
      const g = new THREE.Group();
      const m = craftMesh(shuttle.geo, { accent: [0.55, 0.9, 1.0], lit: 0.5 });
      const eng = addEngines(m, shuttle.glows, { scale: 0.7, length: 12, throttle: 0 });
      addLamps(m, shuttle.lamps, { minPx: 1.2 });
      const glow = createGlowMesh(shuttle.glows, { color: [0.6, 0.85, 1.0], strength: 1.5, scale: KM });
      m.add(glow);
      g.add(m);
      this.portFrame.add(g);
      this.crafts.push(m);
      space.addBody(`port${i}`, [g], () => g.getWorldPosition(_v), 1.2, { solid: true, hint: 0.4 });
      return { group: g, mesh: m, engines: eng, glow, offset: i * 470 };
    });
    // ---- reclamation tenders above the Halo near the Nauru port
    const tender = buildTender(620);
    this.tenderData = tender;
    const tenderPainted = buildWorksTender(tender);   // drawn built on the builder's stations (src/space/tenderHull.js)
    const relic = buildRelic();
    this.tenders = [];
    this.tenderGroup = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const m = dressedMesh(tenderPainted, { accent: [0.5, 1.0, 0.8], lit: 0.5, livery: LIVERIES[4][0], livery2: LIVERIES[4][1] });
      const arms = tender.arms.map((Ar) => {
        const pivot = new THREE.Group();
        pivot.position.copy(Ar.pivot);
        const am = craftPart(m, Ar.geo);
        am.position.copy(Ar.pivot).negate();
        pivot.add(am);
        m.add(pivot);
        // a floodlight at the petal's root, turning with the arm and looking into the cradle
        addLamps(am, petalLamps(Ar, tender.length), { minPx: 1.1 });
        return { pivot, axis: Ar.axis };
      });
      m.add(createGlowMesh(tender.glows, { color: [0.6, 1.0, 0.85], strength: 1.0, scale: KM }));
      addEngines(m, tender.glows, { scale: 0.7, length: 9, color: 0x8affd8, core: 0xf0fff8, throttle: 0.4 });
      addLamps(m, tenderLamps(tender), { minPx: 1.2 });
      let captured = null;
      if (i === 1 || i === 0) {
        // tender 0 carries a relic home; tender 1, in the middle of the group, closes its cradle on one
        const rm = craftPart(m, relic);
        rm.position.set(0, 0, 398);
        rm.rotation.set(0.4, 0.9, 0.2);
        m.add(rm);
        // the salvage marker the tender's crew fixed to the relic's dish mast: a steady amber lamp
        addLamps(rm, [{ p: V(0, 4.6, 0), r: 1.1, color: LAMP.AMBER, i: 2.6 }], { minPx: 1.1 });
        if (i === 0) this.relic = rm; else captured = rm;
      }
      this.tenderGroup.add(m);
      // (the group is laid out round the capture: tender 1's cradle, as the scene opens, sits at
      // the group's origin, the point the Tenders view orbits)
      // tender 2 (the middle of the group) carries a dorsal collar for visiting ships (src/space/portSites.js)
      if (i === 1) this.tenderDock = new DockHardware(m, 1).collar(TENDER_DOCK.p, TENDER_DOCK.n, TENDER_DOCK.fwd).build();
      this.tenders.push({ mesh: m, arms, phase: i * 2.1, offset: V((i - 1) * 1.25, 0.3 * Math.sin(i * 2.0), (i - 1) * 0.5 - Math.abs(i - 1) * 0.55).sub(TENDER_CAPTURE_AT), grip: i === 0, capture: captured });
      this.crafts.push(m);
    }
    space.scene.add(this.tenderGroup);
    space.addBody('tenders', [this.tenderGroup], () => this.tenderGroup.getWorldPosition(_v), 2.6, { solid: true, hint: 0.85 });   // the capture cradle reaches 2.32 km
    // ---- Selene Works over the Moon's near side, with tankers
    const ref = buildRefinery(1);
    this.refineryData = ref;
    this.refinery = new THREE.Group();
    const rm = dressedMesh(dressSelene(ref), { accent: [1.0, 0.7, 0.4], lit: 0.55, livery: LIVERIES[3][0], livery2: LIVERIES[3][1] });
    const wm = craftPart(rm, mergeCraft([ref.wheel, seleneWheelShells()]));      // (smooth hub and spokes: seleneDetail.js)
    rm.add(wm);
    this.wheel = wm;
    rm.add(createGlowMesh(ref.glows, { color: [1.0, 0.62, 0.35], strength: 1.0, scale: KM }));
    addEngines(rm, ref.glows, { scale: 0.55, length: 9, color: 0xff9a55, core: 0xfff0dc, throttle: 0.5 });   // the process vent
    addLamps(rm, refineryLamps(), { minPx: 1.3 });
    // tankers berthed radially at the docking ring (y = 2150 m)
    const tanker = buildFreighter(560);
    const berthed = [];
    for (const berth of ref.berths) {
      const M = new THREE.Matrix4().compose(berth.position, lookQuat(berth.forward, V(0, 1, 0), new THREE.Quaternion()), V(1, 1, 1));
      berthed.push({ geo: tanker.geo, m: M });
    }
    rm.add(craftPart(rm, placeMerge(berthed)));
    this.tankerBerths = berthed.map((b) => b.m);
    this.refinery.add(rm);
    // Selene's ship dock: a collar on the spindle's spire (src/space/portSites.js; the ports registry flies to it)
    this.seleneDock = new DockHardware(this.refinery, 1000).collar(SELENE_DOCK.p.clone().multiplyScalar(KM), SELENE_DOCK.n, SELENE_DOCK.fwd).build();
    this.refineryMesh = rm;
    this.crafts.push(rm);
    space.scene.add(this.refinery);
    space.addBody('selene', [this.refinery], () => this.refinery.getWorldPosition(_v), 6, { solid: true, hint: 0.85 });
    this.moonAlt = 2600;
    // a tanker on the Earth run, cycling through Selene's corridors (refinery frame, km)
    this._addVoyager('tanker', tanker, this.refinery, { ...SELENE_RUN, offset: SELENE_RUN.offsets[0],
      engine: { scale: 0.62, length: 16, color: 0xffb070, core: 0xfff2e0 }, glow: [1.0, 0.72, 0.45], accent: [1.0, 0.72, 0.45], radius: 1.2,
    });
    // the tanker road to the Harbour: beacon pairs out along Selene's two corridors (inbound amber,
    // outbound blue), closer together near the works, a body of their own (they reach 1,200 km)
    {
      const tc = this.movers[this.movers.length - 1].c;
      this.seleneLaneData = seleneLanes(tc);
      this.seleneLanes = new THREE.Group();
      this.seleneLaneLamps = createLamps(this.seleneLaneData, { minPx: 1.3 });
      this.seleneLanes.add(this.seleneLaneLamps);
      space.scene.add(this.seleneLanes);
      const _c = new THREE.Vector3();
      space.addBody('seleneLanes', [this.seleneLanes], () => this.seleneLanes.localToWorld(_c.set(0, 600, 0)), 700);
    }
    // a second tanker on the same run, half a day behind: in from the Harbour down the amber
    // lane and holding off the docking ring for a berth (the same corridors, the same beacons)
    this._addVoyager('tankerInbound', tanker, this.refinery, { ...this.movers[this.movers.length - 1].c, offset: SELENE_RUN.offsets[1] });
    // ---- the working lanes round the Harbour and Selene (src/space/fleetTraffic.js)
    this.traffic = new FleetTraffic(space, this);
  }

  /** A ship on a voyage cycle: a top-level group (its own depth-sliced body) placed from a station frame. */
  _addVoyager(name, craft, frameObj, c) {
    const g = new THREE.Group();
    const m = c.livery ? dressedMesh(craft.geo, { accent: c.accent, lit: 0.5, livery: c.livery[0], livery2: c.livery[1] }) : craftMesh(craft.geo, { accent: c.accent, lit: 0.5 });
    const engines = addEngines(m, craft.glows, { scale: c.engine.scale, length: c.engine.length, color: c.engine.color, core: c.engine.core, throttle: 0 });
    const glow = createGlowMesh(craft.glows, { color: c.glow, strength: 2.0, scale: KM });
    m.add(glow);
    addLamps(m, craft.lamps, { minPx: 1.3 });
    g.add(m);
    this.space.scene.add(g);
    this.crafts.push(m);
    const r = c.radius ?? craft.length * KM * 0.5 + 0.8;
    this.space.addBody(name, [g], () => g.getWorldPosition(_v), r, { solid: true, hint: 0.5 });
    const vy = { name, group: g, mesh: m, engines, glow, frameObj, c, pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1) };
    this.movers.push(vy);
    return vy;
  }

  /**
   * Analytic world poses from the current sim state (the rig reads targets before the
   * modules update, and at high warp a one-frame-old transform is kilometres off).
   */
  pose(name, sim, outPos, outQuat) {
    const q = _q2.copy(sim.earthQuat);
    if (name === 'liner') {
      const el = this.space.elevator;
      const hq = _q3.copy(q).multiply(el.harbour.quaternion);
      if (outPos) outPos.copy(this.docked.position).applyQuaternion(hq).add(_v2.copy(el.harbour.position).applyQuaternion(q));
      if (outQuat) outQuat.copy(hq).multiply(this.docked.quaternion);
    } else if (name === 'tenders') {
      const up = bodyDir(0, NAURU_LON + 0.009, _v2).applyQuaternion(q);
      const east = _v3.set(0, 1, 0).cross(up).normalize();
      const north = _v4.copy(up).cross(east);
      if (outPos) outPos.copy(up).multiplyScalar(R_EARTH + 620 + 7).addScaledVector(north, 30);
      if (outQuat) outQuat.setFromRotationMatrix(_m2.makeBasis(east.negate(), up, north));
    } else if (name === 'selene') {
      const toEarth = _v2.copy(sim.moonPos).negate().normalize();
      if (outPos) outPos.copy(sim.moonPos).addScaledVector(toEarth, R_MOON + this.moonAlt);
      if (outQuat) outQuat.setFromUnitVectors(_v3.set(0, 1, 0), toEarth);
    }
    return outPos || outQuat;
  }

  update(sim, realTime, dt, space) {
    const el = space.elevator;
    el.harbour.updateMatrixWorld(true);
    // voyage cycles
    for (const vy of this.movers) {
      const c = vy.c;
      const u = (((realTime / c.T) + c.offset) % 1 + 1) % 1;
      const thr = voyage(u, c, vy.pos, vy.fwd);
      vy.frameObj.updateMatrixWorld(true);
      vy.group.position.copy(vy.pos).applyMatrix4(vy.frameObj.matrixWorld);
      vy.frameObj.getWorldQuaternion(_q);
      const upH = _v.set(0, 1, 0);
      lookQuat(vy.fwd, upH, vy.group.quaternion);
      vy.group.quaternion.premultiply(_q);
      for (const e of vy.engines) e.setThrottle(thr);
      vy.glow.material.uniforms.uStrength.value = 2.0 * thr;
      vy.glow.visible = thr > 0.02;
    }
    // Harbour runs
    for (const r of this.runs) {
      const thr = shuttleRun(realTime, r, r.pos, r.fwd);
      r.mesh.position.copy(r.pos);
      lookQuat(r.fwd, _v.set(0, 1, 0), r.mesh.quaternion);
      for (const e of r.engines) e.setThrottle(thr);
    }
    // port shuttles: up the east column (x = -12 km) to the station's arrival gate, a pause,
    // across beneath the keel to the departure gate, and down the west column (x = +12 km)
    for (const p of this.portShuttles) {
      const T = 940;
      const u = (((realTime + p.offset) / T) % 1 + 1) % 1;
      let x, alt, fwd, thr = 0;
      if (u < 0.42) {
        const s = u / 0.42;
        alt = 611.4 * (1 - (1 - s) * (1 - s));
        x = -12;
        fwd = _v2.set(0, 1, 0);
        thr = (0.95 * smooth(0, 0.04, s) * (1 - smooth(0.55, 0.9, s)) + 0.15) * (1 - smooth(0.93, 1, s));
      } else if (u < 0.5) {
        alt = 611.4 + 0.6 * smooth(0, 1, (u - 0.42) / 0.08); x = -12;
        fwd = _v2.set(0, 1, 0);
      } else if (u < 0.6) {
        const s = smooth(0, 1, (u - 0.5) / 0.1);
        // Dip under the horizontal gate hoops before the cross-port transfer.
        // A level transfer at 612 km flew sideways through their solid bronze rims.
        alt = 612 - 2 * Math.sin(Math.PI*s); x = -12 + 24 * s;
        fwd = _v2.set(24, -2*Math.PI*Math.cos(Math.PI*s), 0).normalize();
        thr = 0.3 * smooth(0, 0.15, s) * (1 - smooth(0.4, 0.6, s));
      } else {
        const s = (u - 0.6) / 0.4;
        alt = 612 * (1 - s * s);
        x = 12;
        fwd = _v2.set(0, -1, 0);
        thr = 0.5 * smooth(0, 0.04, s) * (1 - smooth(0.1, 0.25, s));          // de-orbit burn, then glide
      }
      p.group.position.set(x, alt, 0);
      lookQuat(fwd, _v3.set(0, 0, 1), p.group.quaternion);
      for (const e of p.engines) e.setThrottle(thr);
      p.glow.material.uniforms.uStrength.value = 1.5 * thr;
      p.glow.visible = thr > 0.02;
    }
    // tenders: station-keeping above and beside the Halo, cradles breathing open and closed
    {
      this.pose('tenders', sim, this.tenderGroup.position, this.tenderGroup.quaternion);
      for (const t of this.tenders) {
        const w = realTime * 0.05 + t.phase;
        t.mesh.position.copy(t.offset).add(_v.set(Math.sin(w) * 0.06, Math.sin(w * 0.7) * 0.03, Math.cos(w) * 0.06));
        t.mesh.rotation.set(0.1 * Math.sin(w * 0.5), w * 0.2, 0.05 * Math.sin(w * 0.3));
        // the tender with a relic keeps its cradle closed round it; the capturing tender opens
        // wide, lets the tumbling relic settle into the cradle, closes on it, and later lets it
        // go for inspection (the relic stops tumbling as the petals meet it)
        const open = t.grip ? 0.12 : t.capture ? captureOpen(realTime) : 0.5 + 0.5 * Math.sin(realTime * 0.25 + t.phase);
        for (const a of t.arms) a.pivot.quaternion.setFromAxisAngle(a.axis, -0.15 + 0.55 * open);
        if (t.capture) {
          const free = (open - 0.12) / 0.88, q = realTime * 0.11;
          t.capture.position.set(Math.sin(q * 1.3) * 5 * free, Math.cos(q) * 4 * free, 398 + 16 * free);
          t.capture.rotation.set(0.4 + free * 0.5 * Math.sin(q * 0.7), 0.9 + free * q * 0.35, 0.2 + free * 0.4 * Math.cos(q * 0.5));
        }
      }
      if (this.relic) this.relic.rotation.z = 0.2 + 0.05 * Math.sin(realTime * 0.3);
    }
    // Selene Works: fixed over the near side, spindle pointing away from the Moon
    {
      this.pose('selene', sim, this.refinery.position, this.refinery.quaternion);
      this.refinery.updateMatrixWorld(true);
      this.seleneLanes.position.copy(this.refinery.position);
      this.seleneLanes.quaternion.copy(this.refinery.quaternion);
      // the corridor beacons are for the tankers: full on the run, faded out from across the sky
      const lg = space.camera ? 1 - smooth(900, 2600, space.camera.position.distanceTo(this.refinery.position)) : 1;
      this.seleneLaneLamps.material.uniforms.uGain.value = lg;
      this.seleneLaneLamps.visible = lg > 0.002;
      this.wheel.rotation.y = realTime * 0.04;
    }
    // the working lanes: outer roads, holding stacks, Selene's ore run, patrol and convoys
    this.traffic.update(sim, realTime, dt, space);
    // the Concord liners' fittings, built the first time a camera comes near either of them
    this._linerDetail(space.camera, false, realTime);
    // Selene's wheel walks, spoke lifts and ring cranes, likewise
    this._seleneDetail(space.camera, realTime);
    // and the tenders' deck fittings
    this._tenderDetail(space.camera);
  }

  /** The tenders' deck fittings (catwalks, floods, RCS, masts), seated on their hulls; lazy. */
  _tenderDetail(cam, force = false) {
    if (!cam && !force) return;
    let near = force;
    if (!near) { this.tenderGroup.getWorldPosition(_v); near = _v.distanceTo(cam.position) < TENDER_DETAIL_RANGE; }
    if (near && !this.tenderDetail) {
      const d = buildTenderDetail(this.tenderData.geo);
      const parts = this.tenders.map((t) => {
        const p = craftPart(t.mesh, d.geo);
        addLamps(p, d.lamps, { minPx: 1.0 });
        t.mesh.add(p);
        return p;
      });
      this.tenderDetail = { data: d, parts };
    }
    if (this.tenderDetail) for (const p of this.tenderDetail.parts) p.visible = near;
  }

  /** Selene Works' near detail (src/space/seleneDetail.js): built on first approach, animated only while near. */
  _seleneDetail(cam, t, force = false) {
    if (!cam && !force) return;
    let near = force;
    if (!near) { this.refinery.getWorldPosition(_v); near = _v.distanceTo(cam.position) < SELENE_DETAIL_RANGE; }
    if (near && !this.seleneDetail) {
      const rm = this.refineryMesh, wd = buildWheelDetail(), car = buildLiftCar(), crane = buildRingCrane();
      const wheelPart = craftPart(rm, wd.geo);
      addLamps(wheelPart, wd.lamps, { minPx: 1.1 });
      this.wheel.add(wheelPart);
      const cars = [];
      for (let k = 0; k < 6; k++) for (let j = 0; j < 1; j++) {   // one car to a spoke: they share its rail
        const m = craftPart(rm, car.geo);
        addLamps(m, car.lamps, { minPx: 1.0 });
        this.wheel.add(m);
        cars.push({ mesh: m, k, j });
      }
      const cranes = [];
      for (let k = 0; k < 3; k++) {
        const pivot = new THREE.Group();
        const m = craftPart(rm, crane.geo);
        m.position.set(RING.R, RING.y + RING.tube, 0);
        addLamps(m, crane.lamps, { minPx: 1.0 });
        pivot.add(m);
        rm.add(pivot);
        cranes.push({ pivot, mesh: m, k });
      }
      // the tankers' fittings: on the three berthed at the ring and the two on the Earth run
      const tf = buildFreighterDetail(560);
      const berthFit = craftPart(rm, placeMerge(this.tankerBerths.map((m) => ({ geo: tf.geo, m }))));
      addLamps(berthFit, this.tankerBerths.flatMap((m) => placeLamps(tf.lamps, m)), { minPx: 1.0 });
      rm.add(berthFit);
      const runFits = this.movers.filter((m) => m.frameObj === this.refinery).map((mv) => {
        const f = craftPart(mv.mesh, tf.geo);
        addLamps(f, tf.lamps, { minPx: 1.0 });
        mv.mesh.add(f);
        return f;
      });
      this.seleneDetail = { wheelPart, cars, cranes, berthFit, runFits, parts: [wheelPart, berthFit, ...runFits, ...cars.map((c) => c.mesh), ...cranes.map((c) => c.pivot)], data: { wd, car, crane, tf } };
    }
    const D = this.seleneDetail;
    if (!D) return;
    for (const p of D.parts) p.visible = near;
    if (!near) return;
    for (const c of D.cars) { const a = liftPose(c.k, c.j, t, c.mesh.position); c.mesh.rotation.y = -a; }
    for (const c of D.cranes) c.pivot.rotation.y = -craneAngle(c.k, t);
  }

  /** Near detail for the berthed and the visiting liner (src/space/linerDetail.js): lazy, hidden beyond range. */
  _linerDetail(cam, force = false, t = 0) {
    if (!cam && !force) return;
    const hulls = (this._linerHulls ||= [this.docked, this.movers.find((m) => m.name === 'approach')?.mesh].filter(Boolean));   // (cached: no per-frame allocation)
    let near = force;
    for (const h of hulls) {
      h.getWorldPosition(_v);
      h.userData.detailNear = force || (cam && _v.distanceTo(cam.position) < LINER_DETAIL_RANGE);
      near ||= h.userData.detailNear;
    }
    if (near && !this.linerDetail) {
      this.linerDetail = buildLinerDetail();
      for (const h of hulls) {
        const part = craftPart(h, this.linerDetail.geo);
        addLamps(part, this.linerDetail.lamps, { minPx: 1.1 });
        h.add(part);
        h.userData.detail = part;
      }
      // the EVA work parties on the berthed liner's port flank, on their safety lines
      const dp = this.docked.userData.detail, wk = buildEvaWorker();
      dp.add(craftPart(this.docked, evaLines()));
      this.eva = [];
      for (let k = 0; k < EVA_PARTIES.length; k++) for (let j = 0; j < 3; j++) {
        const m = craftPart(this.docked, wk.geo);
        addLamps(m, wk.lamps, { minPx: 0.9 });
        dp.add(m);
        this.eva.push({ mesh: m, k, j, pose: { pos: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3() } });
      }
    }
    if (this.linerDetail) for (const h of hulls) h.userData.detail.visible = !!h.userData.detailNear;
    if (this.eva && this.docked.userData.detailNear) {
      for (const w of this.eva) {
        const P = evaPose(w.k, w.j, t, w.pose);
        _v.crossVectors(P.up, P.fwd).normalize();
        _m.makeBasis(_v, P.up, _v2.crossVectors(_v, P.up)).setPosition(P.pos);
        w.mesh.position.copy(P.pos);
        w.mesh.quaternion.setFromRotationMatrix(_m);
      }
    }
  }
}

/**
 * Craft berthed at the docked liner's keel collars (liner-local metres). Both the collar face
 * and the shuttle's dorsal hatch are found by casting against the real meshes, and the hatch
 * is seated 0.3 m into the collar's docking face.
 */
/**
 * A copy of a craft geometry with its plate kinds repainted (kinds only: the shape, normals and
 * index are the builder's and shared). paint(x, y, z, kind) returns the new kind, or the old one.
 */
export function repaint(geo, paint) {
  const P = geo.attributes.position, F = geo.attributes.aFacade;
  const fac = new Float32Array(F.array);
  for (let i = 0; i < P.count; i++) fac[i * 3 + 2] = paint(P.getX(i), P.getY(i), P.getZ(i), fac[i * 3 + 2]);
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
  g.setAttribute('aFacade', new THREE.BufferAttribute(fac, 3));
  g.setIndex(geo.index);
  g.boundingBox = geo.boundingBox; g.boundingSphere = geo.boundingSphere;
  return g;
}

/**
 * The Concord liner's markings on her pearl skin (src/craft/craftGeometry.js buildLiner's
 * spindle: superellipse sections, half-widths 170 x 118 m, belly 0.8): the Concord oxide-red
 * livery band down each lower flank under the window galleries (cream hoops and registration
 * marks), working plate along the keel where the tenders and shuttles dock and round the drive
 * section astern, the rest pearl. Only skin vertices change (the ribs, masts and scoop ring
 * keep their finishes).
 */
export function markLiner(geo, len = 2400) {
  const s = len / 2400, A = 170, Bh = 118;
  const prof = (u) => (u < 0.4 ? 0.62 + 0.38 * Math.sin((Math.PI / 2) * (u / 0.4)) : Math.pow(Math.max(Math.cos((Math.PI / 2) * ((u - 0.4) / 0.6)), 0), 0.8));
  return repaint(geo, (x, y, z, k) => {
    if (Math.abs(k - CK.HULL) > 0.01) return k;
    x /= s; y /= s; z /= s;
    const f = Math.max(prof((z + 1150) / 2400), 0.02);
    if (z < -1150 || z > 1250 || f < 0.08) return k;
    const ax = Math.abs(x) / (A * f), ay = Math.abs(y) / (Bh * f * (y < 0 ? 0.8 : 1));
    const rho = Math.pow(Math.pow(ax, 2.3) + Math.pow(ay, 2.3), 1 / 2.3);
    if (Math.abs(rho - 1) > 0.04) return k;                    // not the skin
    const t = Math.atan2(y / (Bh * f), x / (A * f));
    const side = Math.abs(Math.cos(t)), below = Math.sin(t) < 0;
    if (z < -930) return DK.GRIME;                             // the drive section
    if (below && Math.sin(t) < -0.62) return DK.GRIME;         // the keel
    if (below && side > 0.78 && side < 0.95 && z < 1060) return DK.LIVERY;
    return k;
  });
}

/** The reclamation tenders' paint: works-yellow dorsal plate, weathered working plate below. */
export function markTender(geo) {
  return repaint(geo, (x, y, z, k) => (Math.abs(k - CK.HULL) > 0.01 ? k : y > 18 ? DK.LIVERY : DK.GRIME));
}

/** Merge craft geometries on their shared attributes (position, normal, aFacade). */
export function mergeCraft(list) {
  const gs = list.map((g) => {
    const o = new THREE.BufferGeometry();
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of ['position', 'normal', 'aFacade']) o.setAttribute(k, g.attributes[k]);
    o.setIndex(g.index);
    return o;
  });
  const g = mergeGeometries(gs, false);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/**
 * Selene Works dressed (the refinery's shape is the builder's), for its 11 km framing:
 *   tanks       the eight cryogenic tanks in smooth insulated shells (the builder's 18-sided
 *               lathes read as faceted balls; each shell's inner chords clear the old vertices,
 *               so nothing shows through): white gores four times the tank finish's metre scale,
 *               a Selene-green girth band between dark saddle lines, readable from the view
 *   radiators   the four great fins repainted as finned radiators glowing at the spindle and
 *               cooling outward (facade in quarter scale: 24 m coolant tubes, 160 m panels, a
 *               380 m falloff), with standing spars every 170 m across both faces and a
 *               coolant header along the root and the tip
 *   spindle     weathered working plate
 * Returns the merged geometry (metres, the refinery frame).
 */
export const SELENE_FIN = { r0: 650, r1: 2350, y: -1350, h: 620, pitch: 170, spar: [8, 640, 44] };
export function dressSelene(ref) {
  const angles = ref.radiators.map((r) => r.angle);
  const painted = repaint(mergeCraft([ref.geo, seleneShells()]), (x, y, z, k) => (Math.abs(k - CK.HULL) < 0.01 && x * x + z * z < 300 * 300 ? DK.GRIME : Math.abs(k - CK.RADIATOR) < 0.01 ? DK.HOTRAD : k));
  // the radiator panels' facade: across (height) and out from the root, at quarter scale
  {
    const P = painted.attributes.position, F = painted.attributes.aFacade.array;
    for (let i = 0; i < P.count; i++) {
      if (F[i * 3 + 2] !== DK.HOTRAD) continue;
      const r = Math.hypot(P.getX(i), P.getZ(i));
      F[i * 3] = (P.getY(i) - SELENE_FIN.y) / 4;
      F[i * 3 + 1] = Math.max(r - SELENE_FIN.r0, 0) / 4;
    }
  }
  const NA = 48, NL = 24, pos = [], nrm = [], fac = [], idx = [];
  for (const t of ref.tanks) {
    const R = t.radius * 1.006, b = pos.length / 3;
    for (let j = 0; j <= NL; j++) {
      const la = -Math.PI / 2 + (j / NL) * Math.PI, cl = Math.cos(la), sl = Math.sin(la);
      for (let i = 0; i <= NA; i++) {
        const lo = (i / NA) * Math.PI * 2, nx = cl * Math.cos(lo), nz = cl * Math.sin(lo);
        pos.push(t.center.x + nx * R, t.center.y + sl * R, t.center.z + nz * R);
        nrm.push(nx, sl, nz);
        fac.push(lo * R / 4, la * R / 4, DK.TANK);
      }
    }
    for (let j = 0; j < NL; j++) for (let i = 0; i < NA; i++) {
      const a = b + j * (NA + 1) + i, c = a + NA + 1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const shells = new THREE.BufferGeometry();
  shells.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shells.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  shells.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  shells.setIndex(idx);
  // radiator spars and headers (the builder's API: its normals come out of the merged geometry)
  const B = new CB();
  const F0 = SELENE_FIN;
  for (const a of angles) {
    B.push(new THREE.Matrix4().makeRotationY(-a));
    for (let x = F0.r0 + F0.pitch; x < F0.r1 - 20; x += F0.pitch) B.box(x, F0.y, 0, ...F0.spar, CK.DARK);
    B.tube([V(F0.r0 + 40, F0.y + F0.h / 2 + 6, 0), V(F0.r1 - 20, F0.y + F0.h / 2 + 6, 0)], 11, 8, CK.BRONZE);
    B.tube([V(F0.r0 + 40, F0.y - F0.h / 2 + 30, 14), V(F0.r0 + 40, F0.y + F0.h / 2 - 30, 14)], 14, 8, CK.BRONZE);
    B.tube([V(F0.r0 + 40, F0.y - F0.h / 2 + 30, -14), V(F0.r0 + 40, F0.y + F0.h / 2 - 30, -14)], 14, 8, CK.BRONZE);
    B.pop();
  }
  const spars = B.geometry();
  const g = mergeCraft([painted, shells, spars]);
  g.userData.shellVertices = pos.length / 3;
  return g;
}

export function linerAttendants(linerGeo, collars = [-170, 330]) {
  const sh = buildShuttle(110);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const liner = new THREE.Mesh(linerGeo, mat), shuttle = new THREE.Mesh(sh.geo, mat);
  liner.updateMatrixWorld(true); shuttle.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.set(V(0, 100, 6), V(0, -1, 0));
  const hatch = ray.intersectObject(shuttle, false)[0];
  if (!hatch) throw new Error('Shuttle dorsal hatch not found');
  const list = [], lamps = [], docks = [];
  for (const z of collars) {
    ray.set(V(0, -400, z), V(0, 1, 0));
    const face = ray.intersectObject(liner, false)[0];
    if (!face) throw new Error('Liner keel collar not found');
    const pos = face.point.clone().sub(hatch.point).add(V(0, 0.3, 0));
    const m = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);
    list.push({ geo: sh.geo, m });
    lamps.push(...placeLamps(sh.lamps, m, 3));
    docks.push({ face: face.point.clone(), hatch: hatch.point.clone().add(pos), matrix: m });
  }
  mat.dispose();
  return { geo: placeMerge(list), lamps, docks };
}

/** Tender 1's cradle (the capture) at t = 0 in the tender group's frame (km): the group's layout is shifted by it. */
export const TENDER_CAPTURE_AT = V(0.214, 0.271, 0.332);

/** A floodlight on a cradle arm (tender-local metres): at the petal's root, facing the cradle's axis. */
export function petalLamps(arm, length) {
  const s = length / 300, a = Math.atan2(arm.pivot.y, arm.pivot.x);
  const radial = V(Math.cos(a), Math.sin(a), 0);
  return [{ p: radial.clone().multiplyScalar(8.4 * s).setZ(193 * s), r: 1.3 * s, color: LAMP.WHITE, i: 2.2, dir: radial.clone().negate().add(V(0, 0, 0.35)).normalize() }];
}

function tenderLamps(t) {
  const s = t.length / 300;
  const out = [
    { p: V(104 * s, 13.5 * s, -30 * s), r: 1.6 * s, color: LAMP.RED, i: 3, dir: V(1, 0, 0.2) },
    { p: V(-104 * s, 13.5 * s, -30 * s), r: 1.6 * s, color: LAMP.GREEN, i: 3, dir: V(-1, 0, 0.2) },
    { p: V(0, 15 * s, -140 * s), r: 1.4 * s, color: LAMP.WHITE, i: 2, dir: V(0, 0, -1) },
    { p: V(0, 39.5 * s, -92 * s), r: 1.2 * s, color: LAMP.WHITE, i: 1.8, breathe: 0.3 },
  ];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
    out.push({ p: V(Math.cos(a) * 17 * s, Math.sin(a) * 17 * s, 126 * s), r: 1.3 * s, color: LAMP.TEAL, i: 2.2, breathe: 0.3, phase: k / 3 });
  }
  return out;
}

function refineryLamps() {
  const out = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    out.push({ p: V(Math.cos(a) * 2390, -600, Math.sin(a) * 2390), r: 26, color: LAMP.WHITE, i: 1.6 });
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    out.push({ p: V(Math.cos(a) * 460, 2150, Math.sin(a) * 460), r: 24, color: LAMP.AMBER, i: 2.2, breathe: 0.3, phase: k / 8 });
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    out.push({ p: V(Math.cos(a) * 2350, -1350, Math.sin(a) * 2350), r: 30, color: k % 2 ? LAMP.RED : LAMP.GREEN, i: 2.6 });
  }
  out.push({ p: V(0, 2810, 0), r: 30, color: LAMP.WHITE, i: 2.4, breathe: 0.35 });
  return out;
}

/** Focus targets for the craft (merged into the space target list). */
export function fleetTargets(space) {
  const P = (name) => ({
    position: (o) => (space.fleet ? space.fleet.pose(name, space.sim, o, null) : o.set(0, 0, 0)),
    frame: (q) => (space.fleet ? space.fleet.pose(name, space.sim, null, q) : q.identity()),
  });
  return {
    liner: { ...P('liner'), minDist: 1.2, maxDist: 20000, defaultDist: 2.6, view: { az: 1.5, el: 0.4 } },
    // the capture at the heart of the frame, its sister tenders and the Halo's river country beyond
    tenders: { ...P('tenders'), minDist: 0.3, maxDist: 20000, defaultDist: 0.75, view: { az: -0.4, el: 0.3 } },
    // Selene over the Moon: seen from above her docking ring, the grey limb beneath the wheel
    selene: { ...P('selene'), minDist: 4, maxDist: 60000, defaultDist: 11, view: { az: -0.6, el: 1.0 } },
  };
}
