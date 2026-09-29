import * as THREE from 'three';
import { buildFreighter } from '../craft/craftClasses.js';
import { createGlowMesh } from '../craft/craftMaterial.js';
import { craftMesh, addEngines, addLamps, pixelRadius, KM } from './craftMesh.js';
import { V, smooth, schedule } from './lifeKit.js';

// THE WATER RUN: a 360 m tanker carries water and oxygen from the Water Store to Concord Yard
// for the liner on the slip and comes back empty, below the Harbour and clear of its roads.
// Harbour frame, km (x west, y up the tether, z north). It lies 1.3 km north of the store's
// tanks to fill, alongside the yard's dock (0.7 km off its axis, bow east) to discharge, and
// turns in place at each end.

export const WATER = {
  T: 1100, len: 360, halfW: 0.062,
  path: [V(0, -12.5, 1.3), V(-0.4, -12.5, 1.8), V(-1.2, -13.2, 2.5), V(-5, -13.9, 2.6), V(-10.5, -12.2, 1.6), V(-14.2, -9.0, -0.4), V(-15.2, -8.0, -1.3), V(-16, -8, -1.3)],
};
const STEPS = schedule([['fillA', 18], ['toYard', 30], ['discharge', 22], ['toStore', 30]]);

function catmull(pts, s, out) {
  const n = pts.length - 1;
  const x = Math.min(Math.max(s, 0), 1) * n;
  const i = Math.min(Math.floor(x), n - 1), t = x - i;
  const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, n)];
  const t2 = t * t, t3 = t2 * t;
  for (const k of ['x', 'y', 'z']) out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  return out;
}
const _a = V(0, 0, 0), _b = V(0, 0, 0);
function tangent(s, out) {
  catmull(WATER.path, Math.max(s - 0.004, 0), _a); catmull(WATER.path, Math.min(s + 0.004, 1), _b);
  return out.subVectors(_b, _a).normalize();
}
const yaw = (v) => Math.atan2(v.x, v.z);
const _tA = V(0, 0, 0), _tB = V(0, 0, 0);

/** Pose at time t (Harbour frame, km): writes position and forward; returns the drive throttle. */
export function waterRunPose(t, outP, outF) {
  const f = [0], i = STEPS.at(t / WATER.T, f), s = f[0];
  const name = STEPS.names[i];
  if (name === 'toYard' || name === 'toStore') {
    const e = smooth(0, 1, s), u = name === 'toYard' ? e : 1 - e;
    catmull(WATER.path, u, outP);
    tangent(u, outF);
    if (name === 'toStore') outF.negate();
    // drive on the first quarter, then coast; the manoeuvring glow as she settles
    return 0.9 * smooth(0.02, 0.08, s) * (1 - smooth(0.22, 0.3, s)) + 0.12 * smooth(0.8, 0.9, s) * (1 - smooth(0.96, 1, s));
  }
  // dwelling: turn in place from the arrival heading to the departure heading (the shorter way)
  const atYard = name === 'discharge';
  outP.copy(WATER.path[atYard ? WATER.path.length - 1 : 0]);
  tangent(atYard ? 1 : 0, _tA);
  if (!atYard) _tA.negate();                    // arrived from the yard heading back
  _tB.copy(_tA).negate();
  const y0 = yaw(_tA);
  let dy = yaw(_tB) - y0;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const a = y0 + dy * smooth(0.3, 0.8, s);
  outF.set(Math.sin(a), 0, Math.cos(a));
  return 0;
}

export class WaterRun {
  /** place(pos, fwd, group): the caller's Harbour-frame placement (GeoRoads.update). */
  constructor(space) {
    const fr = buildFreighter(WATER.len);
    this.group = new THREE.Group();
    this.mesh = craftMesh(fr.geo, { accent: [0.55, 0.9, 1.0], lit: 0.5 });
    this.engines = addEngines(this.mesh, fr.glows, { scale: 0.62, length: 14, color: 0x7fd8ff, throttle: 0 });
    const holder = new THREE.Object3D();
    holder.scale.setScalar(KM);
    this.glow = createGlowMesh(fr.glows, { color: [0.55, 0.8, 1.0], strength: 2.0, scale: KM });
    holder.add(this.glow);
    addLamps(holder, fr.lamps, { minPx: 1.3 });
    this.group.add(this.mesh, holder);
    space.scene.add(this.group);
    const _w = V(0, 0, 0);
    space.addBody('waterRun', [this.group], () => this.group.getWorldPosition(_w), WATER.len * KM * 0.5 + 0.3, { solid: true, hint: 0.45 });
    this.pos = V(0, 0, 0); this.fwd = V(0, 0, 1);
  }

  update(t, q, o, space, lookQuat) {
    const thr = waterRunPose(t, this.pos, this.fwd);
    this.group.position.copy(this.pos).applyQuaternion(q).add(o);
    lookQuat(this.fwd, _up.set(0, 1, 0), this.group.quaternion);
    this.group.quaternion.premultiply(q);
    for (const e of this.engines) e.setThrottle(thr);
    this.glow.material.uniforms.uStrength.value = 2.0 * thr;
    this.glow.visible = thr > 0.02;
    this.mesh.visible = pixelRadius(space.camera, this.group.position, 0.2, space.size.y) > 0.35;
    return thr;
  }
}
const _up = V(0, 1, 0);
