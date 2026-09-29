import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { LAMP } from './lamps.js';
import { addLamps } from './craftMesh.js';
import { STORE } from './geoRoads.js';
import { TAU, V, smooth, hash1, instancedPart, DynLamps, droneGeo, poseMatrix } from './lifeKit.js';

// THE WATER STORE'S PLUMBING AND CREW (metres, the store's frame: +y up the tether).
// buildWaterStore (geoRoads.js) hangs the tanks in their cage; this is what makes it a store:
//
//   headers      a ring main at every tank ring, 30 m above the tanks' equator, just outside
//                the cage's longerons, with a feed pipe and valve chest down to each tank
//   risers       two risers up the port and starboard faces from the lowest main to the berth
//                collars, where the tankers take on water, with pump houses on the way
//   pump houses  eight lit plant rooms on the cage faces between the tank rings
//   galleries    a railed catwalk round every tank on its belt, lit, with a hatch
//   drones       inspection drones circling the tanks above their equators
//
// Clearances (tools/verify-geo.mjs): mains clear the longerons and the tanks, drones keep off
// the tanks, longerons and mains, nothing enters the climbers' hollow core.

export const PLUMB = {
  mainR: 322, mainLift: 30, mainTube: 6, feedR: 3, riserX: 322, riserTop: 612,
  houses: { y: [-400, 400], r0: 292, depth: 46, w: 70, h: 44 },
  drone: { r: 120, lift: 60, perTank: 0.5 },
};

/** Drone orbit round tank k at time t: position into out. */
export function storeDronePos(tank, i, t, out, outF) {
  const w = 0.045 * (i % 2 ? 1 : -1);
  const a = t * w + hash1(i * 4.1) * TAU;
  const c = tank.center, R = PLUMB.drone.r;
  out.set(c.x + Math.cos(a) * R, c.y + PLUMB.drone.lift + 6 * Math.sin(t * 0.3 + i), c.z + Math.sin(a) * R);
  if (outF) outF.set(-Math.sin(a) * Math.sign(w), 0, Math.cos(a) * Math.sign(w));
  return out;
}

export function buildStorePlumbing(tanks) {
  const B = new CB(), lamps = [], feeds = [];
  const P = PLUMB;
  // ring mains
  for (const y of STORE.rings) {
    B.push(new THREE.Matrix4().makeTranslation(0, y + P.mainLift, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    B.torus(P.mainR, P.mainTube, 96, 8, CK.CONDUIT);
    B.pop();
    // flanges every 22.5 degrees
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU + Math.PI / 16;
      B.at(Math.cos(a) * P.mainR, y + P.mainLift, Math.sin(a) * P.mainR, 0, -a, 0);
      lathe(B, [[P.mainTube + 0.5, -2, CK.BRONZE], [P.mainTube + 2, -1.2, CK.BRONZE], [P.mainTube + 2, 1.2, CK.BRONZE], [P.mainTube + 0.5, 2, CK.BRONZE]], 10);
      B.pop();
    }
  }
  // feed pipe and valve chest from each main down to its tank
  for (const tk of tanks) {
    const c = tk.center, d = V(c.x, 0, c.z).normalize();
    const from = d.clone().multiplyScalar(P.mainR).setY(c.y + P.mainLift);
    const dir = from.clone().sub(c).normalize();
    const to = c.clone().addScaledVector(dir, tk.radius - 2);
    B.tube([from, to], P.feedR, 8, CK.CONDUIT);
    const mid = from.clone().lerp(to, 0.45);
    B.push(new THREE.Matrix4().compose(mid, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir), V(1, 1, 1)));
    B.box(0, 0, 0, 9, 6, 9, CK.BRONZE);
    B.box(0, 0, 5, 3, 3, 2, CK.LANTERN);
    B.tube([V(0, 3, 0), V(0, 3, 0).add(V(0, 5, 0))], 0.6, 6, CK.DARK);            // hand wheel stem
    B.pop();
    feeds.push({ from, to, tank: tk });
    // the railed gallery on the tank's belt, and its lamps
    B.push(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    B.torus(tk.radius + 7, 0.25, 64, 4, CK.BRONZE);                              // hand rail
    B.torus(tk.radius + 7, 0.12, 64, 4, CK.HULL);
    B.pop();
    for (const dy of [-1.8, 1.8]) {
      B.push(new THREE.Matrix4().makeTranslation(c.x, c.y + dy, c.z).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
      B.torus(tk.radius + 4.2, 0.9, 64, 4, CK.DECK);                              // grating either side of the belt
      B.pop();
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      const p = V(c.x + Math.cos(a) * (tk.radius + 4.8), c.y, c.z + Math.sin(a) * (tk.radius + 4.8));
      const q = V(c.x + Math.cos(a) * (tk.radius + 7), c.y, c.z + Math.sin(a) * (tk.radius + 7));
      B.tube([p, q], 0.14, 4, CK.HULL);                                            // stanchions
      if (k % 4 === 1) lamps.push({ p: q.clone().add(V(0, 1.2, 0)), r: 1.2, color: LAMP.WHITE, i: 1.5, breathe: 0.15, phase: hash1(c.x + k) });
    }
  }
  // risers from the lowest main to the berth collars, with a pump house on each
  const yLo = STORE.rings[0] + P.mainLift;
  for (const sd of [-1, 1]) {
    const x = sd * P.riserX;
    B.tube([V(x, yLo - 4, 0), V(x, P.riserTop, 0)], 5, 10, CK.CONDUIT);
    for (let y = -400; y <= 400; y += 400) {                                        // clamps to the frame's side
      B.tube([V(sd * 283, y, 0), V(x, y, 0)], 4, 8, CK.HULL);
      B.box(x, y, 0, 18, 12, 18, CK.BRONZE);
    }
    for (let y = yLo + 60; y < P.riserTop - 30; y += 120) B.box(x, y, 0, 13, 3, 13, CK.DARK);
    lamps.push({ p: V(x + sd * 8, P.riserTop - 20, 0), r: 2, color: LAMP.TEAL, i: 1.8, breathe: 0.4, phase: sd > 0 ? 0.2 : 0.7 });
  }
  // pump houses on the cage faces (between the tank rings, at 45 degrees off the risers)
  const H = P.houses;
  for (const y of H.y) for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const d = V(Math.cos(a), 0, Math.sin(a));
    const cc = d.clone().multiplyScalar(H.r0 + H.depth / 2).setY(y);
    B.at(cc.x, cc.y, cc.z, 0, -a, 0);
    B.box(0, 0, 0, H.depth, H.h, H.w, CK.HULL);
    B.box(H.depth / 2 + 0.2, 4, 0, 0.6, 8, H.w * 0.84, CK.LANTERN);            // lit window band facing out
    B.box(0, H.h / 2 + 1, 0, H.depth + 2, 2, H.w + 2, CK.BRONZE);
    B.box(0, -H.h / 2 - 1, 0, H.depth + 2, 2, H.w + 2, CK.BRONZE);
    for (const z of [-H.w / 3, 0, H.w / 3]) {
      B.push(new THREE.Matrix4().makeTranslation(H.depth / 2 + 3, -H.h / 4, z).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
      lathe(B, [[0.1, -3, CK.DARK], [4, -2.6, CK.BRONZE], [4, 2.6, CK.BRONZE], [0.1, 3, CK.DARK]], 12);          // pump volutes
      B.pop();
    }
    B.box(-H.depth / 2 - 6, 0, 0, 14, 10, 10, CK.DARK);                          // seat on the frame
    B.pop();
    lamps.push({ p: cc.clone().addScaledVector(d, H.depth / 2 + 4).setY(y + H.h / 2 + 4), r: 2.2, color: LAMP.AMBER, i: 1.8, breathe: 0.3, phase: k / 4 });
  }
  return { geo: B.geometry(), lamps, feeds };
}

export class StoreWorks {
  constructor(storeMesh, storeData) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    this.root = new THREE.Group();
    storeMesh.add(this.root);
    this.data = buildStorePlumbing(storeData.tanks);
    const m = new THREE.Mesh(this.data.geo, storeMesh.material);
    m.onBeforeRender = storeMesh.onBeforeRender; m.renderOrder = 3;
    this.root.add(m);
    addLamps(this.root, this.data.lamps, { minPx: 0.9 });
    // one drone per two tanks
    this.tanks = storeData.tanks.filter((_, i) => i % 2 === 0);
    this.drones = instancedPart(storeMesh, droneGeo(7), this.tanks.length);
    this.root.add(this.drones);
    this.dyn = new DynLamps(this.tanks.map((_, i) => ({ p: V(), r: 1.6, color: i % 2 ? LAMP.WHITE : LAMP.TEAL, i: 2.2, breathe: 0.4, phase: i / 7 })), { minPx: 1.0 });
    this.root.add(this.dyn.mesh);
    this.root.traverse((o) => { o.frustumCulled = false; });
    this._m = new THREE.Matrix4(); this._p = V(); this._f = V(); this._up = V(0, 1, 0);
    this.buildMs = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    this.update(0, 1e9);
  }

  triangles() {
    let t = 0;
    this.root.traverse((o) => { if (o.isMesh && o.geometry.index && !o.geometry.isInstancedBufferGeometry) t += (o.geometry.index.count / 3) * (o.isInstancedMesh ? o.count : 1); });
    return t;
  }

  update(t, px) {
    const on = px > 90;
    this.root.visible = on;
    if (!on) return;
    for (let i = 0; i < this.tanks.length; i++) {
      storeDronePos(this.tanks[i], i, t, this._p, this._f);
      poseMatrix(this._m, this._p, this._f, this._up, 1);
      this.drones.setMatrixAt(i, this._m);
      this.dyn.set(i, this._p.x, this._p.y + 3, this._p.z);
      this.dyn.gain(i, 0.6 + 0.4 * smooth(-1, 1, Math.sin(t * 0.8 + i)));
    }
    this.drones.instanceMatrix.needsUpdate = true;
    this.dyn.commit();
  }
}
