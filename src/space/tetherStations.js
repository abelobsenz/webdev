import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { craftMesh, craftPart, addLamps, pixelRadius, KM, DK, createDressedMaterial } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { R_EARTH } from './sim.js';
import { stationFrame } from './stations.js';
import { GUIDE_OFFSET, RIBBON } from './climbers.js';
import { instancedPart, DynLamps } from './lifeKit.js';

// Relay waystations along Meridian's tether. Every few thousand km the power sheath is boosted
// and the ribbon inspected from a station clamped round it: a collar gripping the ribbon's
// edges (its arms run along the ribbon's width, between the two climber lanes, so the cars
// pass straight through the bore), capacitor drums and radiators on the collar, and a crew
// ring spinning at 1 g on a bearing round it, with a tug dock. Metres; +y up the tether, x
// toward the guide cables (the station frame of stations.js), the ribbon's width along z.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const toY = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
export const RELAY_ALTS = [6000, 12000, 18000, 24000, 30000, 50000, 65000, 80000];
export const RELAY = { bore: 280, collarTube: 20, bearingIn: 322, bearingOut: 332, ringR: 900, ringTube: 60, spokes: 4, climberR: 81 };
export const relayOmega = () => Math.sqrt(9.81 / (RELAY.ringR + RELAY.ringTube));

function latheY(B, y, prof, seg, closed = false) {
  B.push(new THREE.Matrix4().makeTranslation(0, y, 0).multiply(toY));
  lathe(B, prof, seg, 0, { closedProfile: closed });
  B.pop();
}

/** The fixed part: collar, clamp arms, bearing race, capacitor drums, radiators, dock. */
export function buildRelayCollar() {
  const B = new CB(), lamps = [];
  const R = RELAY.bore + RELAY.collarTube;
  for (const y of [-60, 60]) {
    B.push(new THREE.Matrix4().makeTranslation(0, y, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    B.torus(R, RELAY.collarTube, 64, 8, DK.GRIME);
    B.pop();
  }
  // bearing race joining the two collar rings (outside the bore)
  latheY(B, 0, [[R, -60, CK.DARK], [RELAY.bearingIn, -44, CK.BRONZE], [RELAY.bearingIn, 44, CK.BRONZE], [R, 60, CK.DARK]], 64, true);
  // clamp arms along the ribbon's width (z), from its edges out to the collar, and the jaws
  for (const s of [-1, 1]) for (const y of [-60, 60]) {
    B.box(0, y, s * (RIBBON.width / 2 + (R - RIBBON.width / 2) / 2), 10, 14, R - RIBBON.width / 2, CK.BRONZE);
  }
  for (const s of [-1, 1]) B.box(0, 0, s * (RIBBON.width / 2 + 3), 8, 140, 6, CK.DARK);
  // capacitor drums on the collar's top, clear of the climber lanes (on the ribbon's axis)
  for (const s of [-1, 1]) {
    B.push(new THREE.Matrix4().makeTranslation(0, 80, s * 200).multiply(toY));
    lathe(B, [[0.1, 0, CK.BRONZE], [40, 0, CK.BRONZE], [40, 90, CK.LANTERN], [36, 96, DK.FOIL], [0.1, 98, DK.FOIL]], 20);
    B.pop();
    lamps.push({ p: V(0, 184, s * 200), r: 6, color: LAMP.BLUE, i: 2.4, breathe: 0.5, phase: s > 0 ? 0 : 0.5 });
  }
  // radiators above the ring plane on four masts
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + TAU / 8, c = Math.cos(a), s = Math.sin(a);
    B.tube([V(c * R, 60, s * R), V(c * 700, 420, s * 700)], 10, 8, DK.LIVERY);
    B.push(new THREE.Matrix4().makeRotationY(-a));
    B.box(560, 460, 0, 380, 320, 4, CK.RADIATOR);
    B.box(560, 300, 0, 380, 8, 8, CK.CONDUIT);
    B.pop();
  }
  // tug dock below the ring plane
  B.tube([V(0, -60, R), V(0, -300, R + 200)], 14, 8, DK.GRIME);
  B.box(0, -320, R + 230, 90, 40, 90, CK.DECK);
  lamps.push({ p: V(0, -300, R + 280), r: 8, color: LAMP.AMBER, i: 2.4, breathe: 0.4 });
  // the relay crew's working quarters: four glazed modules standing on the collar between the
  // radiator masts (clear above the spinning ring's plane), each on a bronze saddle with a
  // walkway to the next, and a railed walk right round the collar's top
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU, c = Math.cos(a), s = Math.sin(a), rr = R + 22;
    if (Math.abs(c) > 0.5) continue;            // at the ribbon-edge ends (z), away from the climber lanes (x)
    B.box(c * rr, 72, s * rr, 34, 12, 34, CK.BRONZE);
    B.push(new THREE.Matrix4().makeTranslation(c * rr, 72, s * rr).multiply(toY));
    lathe(B, [[0.1, 0, CK.DARK], [15, 1, DK.PORTS], [16, 6, CK.BRONZE], [16, 10, CK.GLASS], [16, 26, CK.GLASS], [16.5, 29, CK.BRONZE], [16, 32, CK.GLASS], [16, 46, CK.GLASS], [15.5, 50, DK.PORTS], [9, 58, DK.PORTS], [4, 64, CK.BRONZE], [0.1, 66, CK.LANTERN]], 24);
    B.pop();
    lamps.push({ p: V(c * rr, 140, s * rr), r: 3.2, color: LAMP.RED, i: 3.2, breathe: 0.7, phase: k / 4 });
    for (let j = 0; j < 6; j++) { const b = (j / 6) * TAU; lamps.push({ p: V(c * rr + Math.cos(b) * 16.6, 90 + (j % 2) * 20, s * rr + Math.sin(b) * 16.6), r: 1.6, color: [1.0, 0.8, 0.55], i: 1.8 }); }
    // floodlights on the ribbon from the module's inboard face
    for (const dy of [-1, 1]) lamps.push({ p: V(c * (rr - 17), 80, s * (rr - 17)), r: 4, color: LAMP.WHITE, i: 2.6, dir: V(-c, dy * 0.4, -s).normalize() });
  }
  B.push(new THREE.Matrix4().makeTranslation(0, 82.3, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  B.torus(R, 2.5, 128, 6, CK.DECK);
  B.pop();
  for (const ry of [85.4, 86.2]) { B.push(new THREE.Matrix4().makeTranslation(0, ry, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))); B.torus(R + 2.2, 0.1, 128, 4, CK.BRONZE); B.pop(); }
  for (let k = 0; k < 96; k++) { const a = (k / 96) * TAU; B.box(Math.cos(a) * (R + 2.2), 85.2, Math.sin(a) * (R + 2.2), 0.14, 1.2, 0.14, CK.DARK); }
  // service hatches and equipment boxes round the collar's outer face (people-scale scale cues)
  for (let k = 0; k < 24; k++) {
    const a = ((k + 0.5) / 24) * TAU, c = Math.cos(a), s = Math.sin(a);
    B.box(c * (R + RELAY.collarTube + 0.6), 60, s * (R + RELAY.collarTube + 0.6), 3, 2.4, 3, k % 3 ? CK.DARK : CK.BRONZE);
  }
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; lamps.push({ p: V(Math.cos(a) * (R + 26), 60, Math.sin(a) * (R + 26)), r: 5, color: LAMP.AMBER, i: 2.0 }); }
  return { geo: B.geometry(), lamps };
}

/** The spinning crew ring: hub on the bearing, four spokes, a glazed torus. */
export function buildRelayRing() {
  const B = new CB(), lamps = [];
  latheY(B, 0, [[RELAY.bearingOut, -40, DK.GRIME], [RELAY.bearingOut + 40, -40, DK.GRIME], [RELAY.bearingOut + 40, 40, CK.BRONZE], [RELAY.bearingOut, 40, DK.GRIME]], 64, true);
  // the torus section: floor outboard, windows on the faces, a lit arcade inboard
  const n = 16, prof = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, x = RELAY.ringR + Math.cos(a) * RELAY.ringTube, y = Math.sin(a) * RELAY.ringTube;
    prof.push([x, y, Math.abs(Math.sin(a)) > 0.5 ? CK.GLASS : Math.cos(a) < 0 ? CK.LANTERN : DK.PORTS]);
  }
  latheY(B, 0, prof, 96, true);
  for (let k = 0; k < RELAY.spokes; k++) {
    const a = (k / RELAY.spokes) * TAU, c = Math.cos(a), s = Math.sin(a);
    B.tube([V(c * (RELAY.bearingOut + 40), 0, s * (RELAY.bearingOut + 40)), V(c * (RELAY.ringR - RELAY.ringTube + 4), 0, s * (RELAY.ringR - RELAY.ringTube + 4))], 16, 10, DK.LIVERY);
    lamps.push({ p: V(c * (RELAY.ringR + RELAY.ringTube + 6), 0, s * (RELAY.ringR + RELAY.ringTube + 6)), r: 7, color: k % 2 ? LAMP.RED : LAMP.GREEN, i: 2.6 });
  }
  // bay-window pods on the torus's outer face (cabins with a view down the tether)
  for (let k = 0; k < 64; k++) {
    const a = ((k + 0.25) / 64) * TAU;
    B.push(new THREE.Matrix4().makeRotationY(-a));
    B.box(RELAY.ringR + RELAY.ringTube - 1, (k % 2 ? 1 : -1) * 16, 0, 10, 14, 26, CK.GLASS);
    B.box(RELAY.ringR + RELAY.ringTube + 4.2, (k % 2 ? 1 : -1) * 16 + 7.5, 0, 2, 1, 28, CK.BRONZE);
    B.pop();
  }
  // lift nodes where the spokes meet the ring
  for (let k = 0; k < RELAY.spokes; k++) {
    const a = (k / RELAY.spokes) * TAU;
    B.push(new THREE.Matrix4().makeRotationY(-a));
    B.box(RELAY.ringR - RELAY.ringTube + 8, 0, 0, 30, 44, 44, DK.PORTS);
    B.box(RELAY.ringR - RELAY.ringTube - 7.5, 0, 0, 1, 30, 30, CK.GLASS);
    B.pop();
  }
  for (let k = 0; k < 16; k++) { const a = ((k + 0.5) / 16) * TAU; lamps.push({ p: V(Math.cos(a) * (RELAY.ringR - RELAY.ringTube - 4), 0, Math.sin(a) * (RELAY.ringR - RELAY.ringTube - 4)), r: 4, color: LAMP.AMBER, i: 1.6, breathe: 0.2, phase: k / 16 }); }
  return { geo: B.geometry(), lamps };
}

/** An inspection crawler that runs on the ribbon's face: a low car on tracks, a lit cab, a sensor boom. */
export function buildCrawler() {
  const B = new CB();
  B.box(1.6, 0, 0, 2.2, 7, 5.2, DK.LIVERY);                 // body on the ribbon's face (x = 0 the face)
  B.box(2.9, 1.2, 0, 0.6, 2.6, 3.6, CK.GLASS);             // cab
  for (const z of [-2.2, 2.2]) B.box(0.45, 0, z, 0.9, 6.4, 1.1, CK.DARK);   // tracks
  B.box(1.6, -3.9, 0, 1.2, 0.8, 4, CK.BRONZE);             // bumper
  B.tube([V(2.6, 3.3, 0), V(4.8, 4.8, 0)], 0.12, 4, CK.DARK);   // sensor boom
  B.box(4.9, 4.9, 0, 0.5, 0.5, 0.5, CK.LANTERN);
  return B.geometry();
}
export const CRAWLERS = 4;          // per relay
export const CRAWL_RANGE = 1800;    // m either side of the collar

/** Crawler k's height on the ribbon (m, station frame) and which face it rides (+-1), at real time t. */
export function crawlerAt(k, t, phase = 0) {
  const period = 260 + 70 * k;
  const u = ((t + phase * 97 + k * 61) / period) % 1;
  const tri = u < 0.5 ? u * 2 : 2 - u * 2;                 // up and back
  const e = tri * tri * (3 - 2 * tri);
  return { y: -CRAWL_RANGE + 2 * CRAWL_RANGE * e, face: k % 2 ? 1 : -1, z: ((k >> 1) ? 1 : -1) * 7 };
}

export class TetherStations {
  constructor(space, up, parent) {
    this.list = [];
    const collar = buildRelayCollar(), ring = buildRelayRing(), crawlerGeo = buildCrawler();
    this.collarGeo = collar.geo; this.ringGeo = ring.geo;
    const mat = createDressedMaterial({ accent: [0.6, 0.85, 1.0], lit: 0.6, livery: [0.66, 0.66, 0.68], livery2: [0.16, 0.34, 0.56] });
    const q = stationFrame(up);
    this.omega = relayOmega();
    RELAY_ALTS.forEach((alt, i) => {
      const g = new THREE.Group();
      g.position.copy(up).multiplyScalar(R_EARTH + alt);
      g.quaternion.copy(q);
      const m = craftMesh(collar.geo, {}, mat);
      addLamps(m, collar.lamps, { minPx: 1.2 });
      const r = craftPart(m, ring.geo);
      addLamps(r, ring.lamps, { minPx: 1.2 });
      // crawlers on the ribbon (instanced, the collar's material) and their headlamps
      const cr = instancedPart(m, crawlerGeo, CRAWLERS);
      const cl = new DynLamps(Array.from({ length: CRAWLERS * 2 }, (_, j) => ({ p: new THREE.Vector3(), r: j % 2 ? 1.2 : 1.6, color: j % 2 ? LAMP.AMBER : LAMP.WHITE, i: j % 2 ? 2.6 : 3.0, breathe: j % 2 ? 0.5 : 0 })), { minPx: 1.0 });
      m.add(cr, cl.mesh);
      m.add(r);
      g.add(m);
      parent.add(g);
      if (space && space.addBody) { const w = new THREE.Vector3(); space.addBody(`relay-${alt}`, [g], () => g.getWorldPosition(w), 1.6, { solid: true, hint: 0.2 }); }
      this.list.push({ alt, group: g, mesh: m, ring: r, phase: i * 0.7, crawlers: cr, crawlLamps: cl });
    });
  }

  update(realTime, space) {
    for (const s of this.list) {
      if (space && space.camera && space.size) {
        const px = pixelRadius(space.camera, s.group.getWorldPosition(_w), 1.2, space.size.y);
        s.group.visible = px > 0.4;
        if (!s.group.visible) continue;
      }
      s.ring.rotation.y = (this.omega * realTime + s.phase) % TAU;
      // crawlers only while the relay is more than a speck
      const near = !space || !space.camera || pixelRadius(space.camera, _w, 1.2, space.size.y) > 25;
      s.crawlers.visible = near; s.crawlLamps.mesh.visible = near;
      if (near) {
        for (let k = 0; k < CRAWLERS; k++) {
          const c = crawlerAt(k, realTime, s.phase);
          const x = c.face * (RIBBON.thick / 2);
          _cm.makeRotationY(c.face > 0 ? 0 : Math.PI).setPosition(x, c.y, c.z);
          s.crawlers.setMatrixAt(k, _cm);
          s.crawlLamps.set(k * 2, x + c.face * 3.3, c.y + 1.4, c.z);
          s.crawlLamps.set(k * 2 + 1, x + c.face * 4.9, c.y + 5.3, c.z);
        }
        s.crawlers.instanceMatrix.needsUpdate = true;
        s.crawlLamps.commit();
      }
    }
  }
}
const _w = new THREE.Vector3(), _cm = new THREE.Matrix4();
export { KM };
