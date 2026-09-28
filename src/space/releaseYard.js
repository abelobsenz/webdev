import * as THREE from 'three';
import { CB, CK, buildLiner } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { craftMesh, craftPart, addEngines, addLamps, placeLamps, pixelRadius, KM } from './craftMesh.js';
import { createGlowMesh } from '../craft/craftMaterial.js';
import { createLamps, LAMP } from './lamps.js';
import { R_EARTH, COUNTERWEIGHT_ALT, MERIDIAN_LON, bodyDir } from './sim.js';
import { stationFrame } from './stations.js';

// THE RELEASE YARD at the counterweight (metres, in the counterweight's own frame: +Y up the
// tether, the rock at the origin). A ship let go out here leaves at the tether's tip speed,
// well past escape: the outer-system liners are caught and released from this yard.
//
//   spar      a gallery girder from the habitat ring's east face, 23 km out along the
//             direction of the counterweight's motion, braced back to the ring by two stays
//   cradles   two octagonal cradles beside the spar's outer half, open at both ends and wide
//             enough for a liner's radiator cross to pass; telescoping clamps meet the hull
//   liners    one held in the north cradle; the south cradle's liner is let go on a cycle:
//             in along the lane stern first under a braking burn, clamped, released, and away
//             bow first, drifting clear of the yard before its drive lights
//   lane      paired blue beacons out along the release line, ever further apart
//
// Built in counterweight-local coordinates from the real east and north directions, so every
// piece can be checked against the counterworks it shares the rock with.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

export const YARD = {
  ringR: 15000, ringTube: 520,
  sparFrom: 15300, sparTo: 38000, sparR: 200,
  stayRoot: 0.3, stayAt: 24000,
  cradleAt: 31000, offset: 1400,                  // liner centre along the spar, and to either side of it
  apothem: 480, hoops: [-450, 150, 750],           // hoops clear of the stern radiator cross (z < -620)
  sleeve: 210,                                     // clamp sleeves stop 210 m off the axis (the hull is 170)
  laneS: 800000, T: 1600,
};

/** East (prograde), north and up in the counterweight mesh's frame (see Elevator). */
export function yardAxes() {
  const up = bodyDir(0, MERIDIAN_LON);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), up).invert();
  const sf = stationFrame(up);
  const E = V(-1, 0, 0).applyQuaternion(sf).applyQuaternion(q).setY(0).normalize();
  const N = V(0, 0, 1).applyQuaternion(sf).applyQuaternion(q).setY(0).normalize();
  return { E, N, U: V(0, 1, 0) };
}

const octV = (k, ap) => { const a = Math.PI / 8 + k * Math.PI / 4, r = ap / Math.cos(Math.PI / 8); return [Math.cos(a) * r, Math.sin(a) * r]; };

/** The yard (metres, counterweight frame). liner: buildLiner(2400).geo, used to survey the clamps. */
export function buildReleaseYard(linerGeo = buildLiner(2400).geo) {
  const { E, N, U } = yardAxes();
  const B = new CB(), lamps = [], cradles = [], clampsFixed = [], clampsMoving = [];
  const at = (s, n = 0, y = 0) => E.clone().multiplyScalar(s).addScaledVector(N, n).addScaledVector(U, y);
  const ringAt = (ang) => { const c = Math.cos(ang), s = Math.sin(ang); return E.clone().multiplyScalar(c).addScaledVector(N, s).multiplyScalar(YARD.ringR); };
  // ---- the spar: a pressurised gallery girder with a lantern walk along its crown
  const p0 = at(YARD.sparFrom), p1 = at(YARD.sparTo);
  B.tube([p0, p1], YARD.sparR, 16, CK.HULL);
  B.tube([at(YARD.sparFrom + 300, 0, YARD.sparR + 40), at(YARD.sparTo - 400, 0, YARD.sparR + 40)], 45, 8, CK.LANTERN);
  for (let s = YARD.sparFrom + 1500; s < YARD.sparTo - 500; s += 2500) {
    B.push(new THREE.Matrix4().makeBasis(N, U, E).setPosition(at(s)));
    lathe(B, [[YARD.sparR - 8, -60, CK.BRONZE], [YARD.sparR + 18, -40, CK.BRONZE], [YARD.sparR + 18, 40, CK.BRONZE], [YARD.sparR - 8, 60, CK.BRONZE]], 24);
    B.pop();
  }
  // the spar's root: a bronze saddle over the ring tube; its head: a beacon mast
  B.push(new THREE.Matrix4().makeBasis(N, U, E).setPosition(at(YARD.ringR)));
  lathe(B, [[YARD.ringTube - 40, -700, CK.BRONZE], [YARD.ringTube + 60, -600, CK.BRONZE], [YARD.ringTube + 60, 600, CK.BRONZE], [YARD.ringTube - 40, 700, CK.BRONZE]], 32);
  B.pop();
  B.push(new THREE.Matrix4().makeBasis(N, U, E).setPosition(p1));
  lathe(B, [[YARD.sparR, -200, CK.HULL], [YARD.sparR + 60, 0, CK.BRONZE], [YARD.sparR * 0.5, 260, CK.HULL], [40, 420, CK.LANTERN], [0.1, 480, CK.LANTERN]], 24);
  B.pop();
  lamps.push({ p: at(YARD.sparTo + 520), r: 60, color: LAMP.WHITE, i: 3.2, breathe: 0.35 });
  // stays back to the ring, either side of the spar
  for (const sd of [-1, 1]) {
    const root = ringAt(sd * YARD.stayRoot);
    B.tube([root.clone().addScaledVector(root.clone().normalize(), YARD.ringTube - 60), at(YARD.stayAt, sd * (YARD.sparR - 30))], 90, 10, CK.DARK);
    B.push(new THREE.Matrix4().makeBasis(root.clone().normalize().cross(U).normalize(), U, root.clone().normalize()).setPosition(root));
    lathe(B, [[YARD.ringTube - 30, -260, CK.BRONZE], [YARD.ringTube + 50, -200, CK.BRONZE], [YARD.ringTube + 50, 200, CK.BRONZE], [YARD.ringTube - 30, 260, CK.BRONZE]], 28);
    B.pop();
  }
  // ---- the cradles, north (+N) and south (-N) of the spar
  const probe = new THREE.Mesh(linerGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const ray = new THREE.Raycaster();
  for (const sd of [1, -1]) {
    const c = at(YARD.cradleAt, sd * YARD.offset);
    // cradle frame: x = N, y = U, z = E (the liner's axis, bow east)
    const F = new THREE.Matrix4().makeBasis(N, U, E).setPosition(c);
    const Finv = F.clone().invert();
    probe.matrix.copy(F); probe.matrixAutoUpdate = false; probe.updateMatrixWorld(true);
    B.push(F);
    const hoopPts = (z) => { const L = []; for (let k = 0; k < 8; k++) { const [x, y] = octV(k, YARD.apothem); L.push(V(x, y, z)); } L.push(L[0].clone()); return L; };
    for (const z of YARD.hoops) {
      B.tube(hoopPts(z), 22, 8, CK.HULL);
      for (let k = 0; k < 8; k++) { const [x, y] = octV(k, YARD.apothem); B.box(x, y, z, 50, 50, 50, CK.BRONZE); }
      // two arms from the hoop's spar-side vertices to the spar's flank
      for (const ky of [3, 4]) {
        const [x, y] = octV(sd > 0 ? ky : (ky === 3 ? 0 : 7), YARD.apothem);
        const target = V(-sd * (YARD.offset - YARD.sparR + 20), y * 0.35, z);
        B.tube([V(x, y, z), target], 26, 8, CK.HULL);
      }
    }
    // longerons tie the hoops together at the four corners away from the liner's fins
    for (const k of [1, 2, 5, 6]) {
      const [x, y] = octV(k, YARD.apothem);
      B.tube([V(x, y, YARD.hoops[0]), V(x, y, YARD.hoops[YARD.hoops.length - 1])], 16, 8, CK.DARK);
    }
    B.pop();
    // telescoping clamps from the hoops' flat sides (port, starboard and keel; never over the
    // top, where the crown bridge and the masts pass when she leaves): a sleeve from the hoop
    // in to 210 m off the axis, a rod and pad out of it to the surveyed hull
    for (const z of YARD.hoops) for (const phi of [0, Math.PI, -Math.PI / 2]) {
      const dir = V(-Math.cos(phi), -Math.sin(phi), 0);
      const rootL = V(Math.cos(phi) * YARD.apothem, Math.sin(phi) * YARD.apothem, z);
      const root = rootL.clone().applyMatrix4(F), dW = dir.clone().transformDirection(F);
      ray.set(root, dW); ray.far = YARD.apothem;
      const hit = ray.intersectObject(probe, false)[0];
      if (!hit) throw new Error('Release yard clamp missed the liner');
      const contact = hit.point.clone();
      const rc = hit.point.clone().applyMatrix4(Finv).setZ(0).length();      // contact radius off the axis
      const at = (r) => V(Math.cos(phi) * r, Math.sin(phi) * r, z).applyMatrix4(F);
      B.tube([at(YARD.apothem + 10), at(YARD.sleeve)], 16, 10, CK.BRONZE);
      const rec = { cradle: sd, z, phi, root, contact, dirW: dW.clone(), rodFrom: at(YARD.sleeve + 40), rodTo: contact.clone(), retract: YARD.sleeve - rc, contactR: rc };
      (sd > 0 ? clampsFixed : clampsMoving).push(rec);
    }
    cradles.push({ side: sd, center: c, frame: F });
    // floodlights on the hoop corners, facing the hull
    for (const z of YARD.hoops) for (const k of [1, 2, 5, 6]) {
      const [x, y] = octV(k, YARD.apothem + 40);
      lamps.push({ p: V(x, y, z).applyMatrix4(F), r: 22, color: LAMP.WHITE, i: 1.8 });
    }
  }
  probe.material.dispose();
  // clamp rods: the held liner's are part of the yard; the released liner's retract into their
  // sleeves (each its own geometry, moved along its own axis)
  const rod = (b, c) => {
    b.tube([c.rodFrom, c.rodTo.clone().addScaledVector(c.dirW, -6)], 9, 8, CK.HULL);
    b.push(new THREE.Matrix4().makeBasis(...frameOf(c.dirW)).setPosition(c.rodTo.clone().addScaledVector(c.dirW, -3)));
    b.box(0, 0, 0, 44, 44, 6, CK.BRONZE);
    b.pop();
  };
  for (const c of clampsFixed) rod(B, c);
  const rods = clampsMoving.map((c) => { const R = new CB(); rod(R, c); return R.geometry(); });
  // the lane: pairs of blue beacons along the south cradle's line, spreading out and apart
  const lane = [];
  for (let i = 0; i < 18; i++) {
    const s = YARD.sparTo + 3000 + i * i * 2400;
    for (const w of [-1, 1]) lane.push({ p: at(s, -YARD.offset + w * (1200 + i * 150)), r: 40 + i * 12, color: LAMP.BLUE, i: 3.0, breathe: 0.4, phase: (i / 18) % 1 });
  }
  return { geo: B.geometry(), rods, lamps, lane, cradles, clampsFixed, clampsMoving, axes: { E, N, U }, radius: 40 };
}

function frameOf(z) {
  const x = new THREE.Vector3().crossVectors(Math.abs(z.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0), z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return [x, y, z];
}

/** The released liner's cycle in the yard (metres, counterweight frame). Returns throttle and clamp extension. */
export function releasePose(u, data, outPos, outFwd) {
  const { E } = data.axes, c = data.cradles.find((q) => q.side < 0).center;
  outFwd.copy(E);
  let thr = 0, clamp = 1;
  if (u < 0.25) {                                          // in stern first, braking
    const s = u / 0.25, k = 1 - s;
    outPos.copy(c).addScaledVector(E, YARD.laneS * k * k);
    thr = smooth(0, 0.08, s) * (1 - smooth(0.82, 0.98, s)) * 0.9;
    clamp = 0;
  } else if (u < 0.3) { outPos.copy(c); clamp = smooth(0, 1, (u - 0.25) / 0.05); }
  else if (u < 0.55) { outPos.copy(c); clamp = 1; }
  else if (u < 0.6) { outPos.copy(c); clamp = 1 - smooth(0, 1, (u - 0.55) / 0.05); }
  else {                                                   // let go: drifting clear, then the drive
    const s = (u - 0.6) / 0.4;
    outPos.copy(c).addScaledVector(E, YARD.laneS * s * s);
    thr = 1.15 * smooth(0.1, 0.2, s);
    clamp = 0;
  }
  return { thr, clamp };
}

export class ReleaseYard {
  constructor(space) {
    this.space = space;
    const el = space.elevator;
    const liner = buildLiner(2400);
    this.data = buildReleaseYard(liner.geo);
    const d = this.data;
    // the yard: a group in the counterweight's frame (a body of its own, it reaches 38 km)
    this.group = new THREE.Group();
    this.group.position.copy(el.counter.position);
    this.group.quaternion.copy(el.counter.quaternion);
    space.earthFixed.add(this.group);
    this.mesh = craftMesh(d.geo, { accent: [0.55, 0.85, 1.0], lit: 0.6 });
    addLamps(this.mesh, d.lamps, { minPx: 1.3 });
    this.group.add(this.mesh);
    this.rods = d.rods.map((g, i) => { const r = craftPart(this.mesh, g); r.userData = d.clampsMoving[i]; this.mesh.add(r); return r; });
    // the held liner
    const held = craftPart(this.mesh, liner.geo);
    const hc = d.cradles.find((c) => c.side > 0);
    held.matrix.copy(hc.frame); held.matrixAutoUpdate = false;
    this.mesh.add(held);
    addLamps(held, liner.lamps, { minPx: 1.3 });
    this.held = held;
    const _c = new THREE.Vector3();
    space.addBody('releaseYard', [this.group], () => this.group.localToWorld(_c.copy(d.cradles[0].center).multiplyScalar(KM * 0.8)), d.radius, { solid: true, hint: 0.5 });
    // the lane beacons (non-solid, 800 km long)
    this.lane = createLamps(d.lane, { minPx: 1.4 });
    this.lane.scale.setScalar(KM);
    this.laneGroup = new THREE.Group();
    this.laneGroup.position.copy(this.group.position); this.laneGroup.quaternion.copy(this.group.quaternion);
    this.laneGroup.add(this.lane);
    space.earthFixed.add(this.laneGroup);
    const _l = new THREE.Vector3();
    space.addBody('releaseLane', [this.laneGroup], () => this.laneGroup.localToWorld(_l.copy(d.axes.E).multiplyScalar(YARD.laneS * KM * 0.5)), YARD.laneS * KM * 0.55);
    // the released liner: its own top-level group and body
    this.ship = new THREE.Group();
    const m = craftMesh(liner.geo, { accent: [0.55, 0.85, 1.0], lit: 0.62 });
    this.engines = addEngines(m, liner.glows, { scale: 0.55, length: 16, color: 0x7fd8ff, throttle: 0 });
    this.glow = createGlowMesh(liner.glows, { color: [0.55, 0.8, 1.0], strength: 2.0, scale: KM });
    m.add(this.glow);
    addLamps(m, liner.lamps, { minPx: 1.3 });
    this.ship.add(m);
    this.shipMesh = m;
    space.scene.add(this.ship);
    const _s = new THREE.Vector3();
    space.addBody('releasedLiner', [this.ship], () => this.ship.getWorldPosition(_s), 1.6, { solid: true, hint: 0.5 });
    this._p = new THREE.Vector3(); this._f = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4();
    this._ex = [];
  }

  update(sim, realTime, dt, space) {
    const d = this.data;
    const u = (((realTime / YARD.T) + 0.35) % 1 + 1) % 1;
    const { thr, clamp } = releasePose(u, d, this._p, this._f);
    // the clamps draw back into their sleeves while she is free
    for (const r of this.rods) r.position.copy(r.userData.dirW).multiplyScalar(-r.userData.retract * (1 - clamp));
    this.group.updateMatrixWorld(true);
    // liner pose: metres in the counterweight frame -> world
    this.ship.position.copy(this._p).multiplyScalar(KM).applyMatrix4(this.group.matrixWorld);
    this._m.makeBasis(d.axes.N, d.axes.U, this._f);
    this._q.setFromRotationMatrix(this._m);
    this.ship.quaternion.copy(this.group.getWorldQuaternion(new THREE.Quaternion())).multiply(this._q);
    for (const e of this.engines) e.setThrottle(thr);
    this.glow.material.uniforms.uStrength.value = 2.0 * thr;
    this.glow.visible = thr > 0.02;
    const px = pixelRadius(space.camera, this.ship.position, 1.2, space.size.y);
    this.shipMesh.visible = px > 0.3;
  }
}
