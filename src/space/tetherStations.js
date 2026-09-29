import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { createCraftMaterial } from '../craft/craftMaterial.js';
import { craftMesh, craftPart, addLamps, pixelRadius, KM } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { R_EARTH } from './sim.js';
import { stationFrame } from './stations.js';
import { GUIDE_OFFSET, RIBBON } from './climbers.js';

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
    B.torus(R, RELAY.collarTube, 64, 8, CK.HULL);
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
    lathe(B, [[0.1, 0, CK.BRONZE], [40, 0, CK.BRONZE], [40, 90, CK.LANTERN], [36, 96, CK.HULL], [0.1, 98, CK.HULL]], 20);
    B.pop();
    lamps.push({ p: V(0, 184, s * 200), r: 6, color: LAMP.BLUE, i: 2.4, breathe: 0.5, phase: s > 0 ? 0 : 0.5 });
  }
  // radiators above the ring plane on four masts
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + TAU / 8, c = Math.cos(a), s = Math.sin(a);
    B.tube([V(c * R, 60, s * R), V(c * 700, 420, s * 700)], 10, 8, CK.HULL);
    B.push(new THREE.Matrix4().makeRotationY(-a));
    B.box(560, 460, 0, 380, 320, 4, CK.RADIATOR);
    B.box(560, 300, 0, 380, 8, 8, CK.CONDUIT);
    B.pop();
  }
  // tug dock below the ring plane
  B.tube([V(0, -60, R), V(0, -300, R + 200)], 14, 8, CK.HULL);
  B.box(0, -320, R + 230, 90, 40, 90, CK.DECK);
  lamps.push({ p: V(0, -300, R + 280), r: 8, color: LAMP.AMBER, i: 2.4, breathe: 0.4 });
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; lamps.push({ p: V(Math.cos(a) * (R + 26), 60, Math.sin(a) * (R + 26)), r: 5, color: LAMP.AMBER, i: 2.0 }); }
  return { geo: B.geometry(), lamps };
}

/** The spinning crew ring: hub on the bearing, four spokes, a glazed torus. */
export function buildRelayRing() {
  const B = new CB(), lamps = [];
  latheY(B, 0, [[RELAY.bearingOut, -40, CK.HULL], [RELAY.bearingOut + 40, -40, CK.HULL], [RELAY.bearingOut + 40, 40, CK.BRONZE], [RELAY.bearingOut, 40, CK.HULL]], 64, true);
  // the torus section: floor outboard, windows on the faces, a lit arcade inboard
  const n = 16, prof = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, x = RELAY.ringR + Math.cos(a) * RELAY.ringTube, y = Math.sin(a) * RELAY.ringTube;
    prof.push([x, y, Math.abs(Math.sin(a)) > 0.5 ? CK.GLASS : Math.cos(a) < 0 ? CK.LANTERN : CK.HULL]);
  }
  latheY(B, 0, prof, 96, true);
  for (let k = 0; k < RELAY.spokes; k++) {
    const a = (k / RELAY.spokes) * TAU, c = Math.cos(a), s = Math.sin(a);
    B.tube([V(c * (RELAY.bearingOut + 40), 0, s * (RELAY.bearingOut + 40)), V(c * (RELAY.ringR - RELAY.ringTube + 4), 0, s * (RELAY.ringR - RELAY.ringTube + 4))], 16, 10, CK.HULL);
    lamps.push({ p: V(c * (RELAY.ringR + RELAY.ringTube + 6), 0, s * (RELAY.ringR + RELAY.ringTube + 6)), r: 7, color: k % 2 ? LAMP.RED : LAMP.GREEN, i: 2.6 });
  }
  for (let k = 0; k < 16; k++) { const a = ((k + 0.5) / 16) * TAU; lamps.push({ p: V(Math.cos(a) * (RELAY.ringR - RELAY.ringTube - 4), 0, Math.sin(a) * (RELAY.ringR - RELAY.ringTube - 4)), r: 4, color: LAMP.AMBER, i: 1.6, breathe: 0.2, phase: k / 16 }); }
  return { geo: B.geometry(), lamps };
}

export class TetherStations {
  constructor(space, up, parent) {
    this.list = [];
    const collar = buildRelayCollar(), ring = buildRelayRing();
    this.collarGeo = collar.geo; this.ringGeo = ring.geo;
    const mat = createCraftMaterial({ accent: [0.6, 0.85, 1.0], lit: 0.6 });
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
      m.add(r);
      g.add(m);
      parent.add(g);
      if (space && space.addBody) { const w = new THREE.Vector3(); space.addBody(`relay-${alt}`, [g], () => g.getWorldPosition(w), 1.6, { solid: true, hint: 0.2 }); }
      this.list.push({ alt, group: g, mesh: m, ring: r, phase: i * 0.7 });
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
    }
  }
}
const _w = new THREE.Vector3();
export { KM };
