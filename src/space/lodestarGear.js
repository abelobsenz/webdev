import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { CK, V3, TAU, lerp, smooth, clamp01, merge, stock, tube, rod, box, bbox, revolve, loft } from './lodestarKit.js';
import { BAYS, hullPt, hullStrip, tOf } from './lodestarHull.js';

// The Lodestar's moving and switched parts: the landing tripod (bay doors that open, a main strut
// with its retraction actuator, a sliding oleo piston with torque links that scissor as it
// compresses, a foot pad on a ball joint that levels itself), the dorsal docking ring (capture
// petals, twelve latches, hatch, alignment target), and the landing lights with their beams.
// All in metres in the hull's frame; built once, posed each frame from the ship's state.

export const FOOT_Y = -6.95;                        // sole height with the legs down, uncompressed
const EXT_D = 1.1;                                  // piston showing below the strut with the leg down
export const PAD_H = 0.34;                               // ankle to sole
const STOW_EXT = 0.25;                              // piston showing below the strut when stowed
const OLEO_STROKE = 0.5;                            // full compression

// ------------------------------------------------------------------- legs --
/** One leg's static description: hinge, deploy angles, splay, extension for the given sole height. */
function legSpec(b, i) {
  const nose = i === 0;
  const zh = nose ? b.zc - b.len / 2 + 1.1 : b.zc + b.len / 2 - 1.1;
  const t = tOf(zh);
  // the recess floor at the bay's centre line: the belly stepped in by the bay depth
  const xa = b.xc, aMid = (b.a0 + b.a1) / 2, floor = hullPt(t, aMid, -0.95);
  const hinge = V3(xa, floor.y - 0.32, zh);
  const stow = nose ? -Math.PI / 2 : Math.PI / 2;    // rotation about X: nose leg folds aft, mains forward
  const dep = nose ? 0.1 : -0.1;
  const splay = nose ? 0 : Math.sign(xa) * 0.2;
  const vf = Math.cos(dep) * Math.cos(splay);
  const len = (hinge.y - PAD_H - FOOT_Y) / vf;
  const zs = nose ? -1 : 1;                          // the side of the strut facing the actuator anchor
  return { b, nose, hinge, stow, dep, splay, ext: EXT_D, LS: len - EXT_D, zs, aMid, t0: b.t0, t1: b.t1 };
}

function strutGeo(LS, zs) {
  const g = [];
  // trunnion at the hinge, the outer cylinder with collars, a gusset, hydraulic lines
  g.push(stock(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 14), CK.BRONZE).rotateZ(Math.PI / 2));
  g.push(revolve([[0.0, 0.0, CK.DARK], [0.22, 0.05, CK.DARK], [0.25, 0.3, CK.DARK], [0.25, LS - 0.25, CK.DARK], [0.25, LS - 0.25, CK.BRONZE], [0.3, LS - 0.2, CK.BRONZE], [0.3, LS, CK.BRONZE], [0.2, LS + 0.02, CK.DARK], [0.0, LS + 0.02, CK.DARK]], 18).rotateX(Math.PI / 2));
  for (const y of [0.9, 1.9, 2.8]) g.push(revolve([[0.27, -0.05, CK.BRONZE], [0.28, 0.0, CK.BRONZE], [0.27, 0.05, CK.BRONZE]], 18, { closed: true }).rotateX(Math.PI / 2).translate(0, -y, 0));
  g.push(bbox(0.1, 0.8, 0.5, 0.03, CK.DARK, V3(0, -0.5, 0.22)));
  for (const s of [1, -1]) g.push(tube([V3(s * 0.27, -0.2, 0.05), V3(s * 0.29, -1.6, 0.06), V3(s * 0.29, -LS + 0.3, 0.06)], 0.025, CK.BRONZE, 6, 2));
  g.push(bbox(0.2, 0.2, 0.16, 0.03, CK.DARK, V3(0, -2.0, zs * 0.3)));       // actuator lug
  g.push(bbox(0.08, 0.5, 0.14, 0.02, CK.DARK, V3(0, -1.85, zs * 0.22)));
  // the upper torque-link lug
  g.push(bbox(0.1, 0.16, 0.14, 0.02, CK.DARK, V3(0, -LS + 0.05, 0.28)));
  return merge(g);
}
function pistonGeo(len) {
  const g = [];
  g.push(revolve([[0.0, -0.05, CK.BRONZE], [0.15, -0.05, CK.BRONZE], [0.15, len, CK.BRONZE], [0.2, len, CK.DARK], [0.2, len + 0.18, CK.DARK], [0.0, len + 0.18, CK.DARK]], 16).rotateX(Math.PI / 2));
  g.push(bbox(0.1, 0.14, 0.14, 0.02, CK.DARK, V3(0, -len - 0.06, 0.26)));  // lower torque-link lug
  // the ankle clevis
  for (const s of [1, -1]) g.push(box(0.05, 0.22, 0.2, CK.DARK, V3(s * 0.13, -len - 0.26, 0)));
  return merge(g);
}
function padGeo() {
  const g = [];
  // ball, a ribbed dome, the sole plate and a crushable rim (sole at y = -PAD_H below the ankle)
  g.push(stock(new THREE.SphereGeometry(0.15, 14, 10), CK.BRONZE));
  g.push(revolve([[0.0, 0.0, CK.DARK], [0.62, 0.0, CK.DARK], [0.64, 0.05, CK.DARK], [0.62, 0.09, CK.HULL], [0.4, 0.17, CK.HULL], [0.14, 0.24, CK.HULL], [0.0, 0.25, CK.HULL]], 28).rotateX(-Math.PI / 2).translate(0, -PAD_H, 0));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU, c = Math.cos(a), s = Math.sin(a);
    g.push(rod(V3(c * 0.14, -PAD_H + 0.24, s * 0.14), V3(c * 0.58, -PAD_H + 0.1, s * 0.58), 0.025, CK.DARK, 5));
  }
  g.push(stock(new THREE.CylinderGeometry(0.1, 0.13, 0.12, 12), CK.DARK).translate(0, -0.12, 0));
  return merge(g);
}
/** A link of length L built along -Y from its origin. */
const linkGeo = (L) => merge([bbox(0.06, L, 0.05, 0.015, CK.DARK, V3(0, -L / 2, 0)), stock(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 8), CK.BRONZE).rotateZ(Math.PI / 2)]);

/** Bay door leaf between a hinge edge a_h and a free edge a_f (half the bay). */
function doorLeaf(b, aH, aF) {
  const g = [];
  const t0 = b.t0 + 0.0008, t1 = b.t1 - 0.0008;
  g.push(hullStrip(t0, t1, Math.min(aH, aF), Math.max(aH, aF), CK.DARK, { o: 0.035, i: 0.02, nt: 10, na: 4 }));
  // stiffeners on the inside face, and a tile-like texture of ribs on the outside
  for (let k = 1; k < 5; k++) { const tt = lerp(t0, t1, k / 5); g.push(hullStrip(tt - 0.0012, tt + 0.0012, Math.min(aH, aF) + 0.003, Math.max(aH, aF) - 0.003, CK.HULL, { o: -0.02, i: 0.1, nt: 1, na: 3 })); }
  return merge(g);
}

// ------------------------------------------------------------ docking ring --
function dockParts(zd) {
  const top = hullPt(tOf(zd), Math.PI / 2).y;
  const yF = top + 0.75;                                   // the mating face
  const base = [];
  base.push(revolve([[1.3, top - 0.35, CK.HULL], [1.25, top + 0.1, CK.HULL], [1.12, top + 0.2, CK.HULL], [1.12, top + 0.2, CK.BRONZE], [1.05, yF - 0.28, CK.BRONZE],
    [1.05, yF - 0.28, CK.DARK], [1.08, yF - 0.2, CK.DARK], [1.08, yF - 0.02, CK.DARK], [1.03, yF, CK.DARK], [0.68, yF, CK.DARK], [0.66, yF - 0.04, CK.DARK], [0.66, yF - 0.18, CK.DARK], [0.62, yF - 0.2, CK.DARK], [0.0, yF - 0.2, CK.DARK]], 48)
    .rotateX(-Math.PI / 2).translate(0, 0, 0).applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, zd)));
  // revolve builds about +Z with z = profile height; rotateX(-pi/2) sends +Z to +Y: heights become y
  // the hatch: a disc with a hand wheel, hinge blocks and the alignment target on a short post
  const hy = yF - 0.19;
  base.push(stock(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 36), CK.HULL).translate(0, hy, zd));
  base.push(stock(new THREE.TorusGeometry(0.22, 0.025, 6, 20), CK.BRONZE).rotateX(Math.PI / 2).translate(0, hy + 0.06, zd));
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; base.push(rod(V3(0, hy + 0.06, zd), V3(Math.cos(a) * 0.22, hy + 0.06, zd + Math.sin(a) * 0.22), 0.015, CK.BRONZE, 5)); }
  for (const s of [1, -1]) base.push(bbox(0.14, 0.08, 0.22, 0.02, CK.DARK, V3(s * 0.3, hy + 0.05, zd + 0.5)));
  base.push(stock(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), CK.DARK).translate(0.36, hy + 0.08, zd - 0.12));
  // the alignment target: a cross on a white plate (below the mating face)
  base.push(box(0.26, 0.012, 0.26, CK.HULL, V3(0.36, hy + 0.135, zd - 0.12)));
  base.push(box(0.2, 0.02, 0.03, CK.DARK, V3(0.36, hy + 0.145, zd - 0.12)), box(0.03, 0.02, 0.2, CK.DARK, V3(0.36, hy + 0.145, zd - 0.12)));
  // alignment pins proud of the face, and fasteners round the flange
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + TAU / 8; base.push(stock(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 8), CK.BRONZE).translate(Math.cos(a) * 0.86, yF + 0.06, zd + Math.sin(a) * 0.86)); }
  for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; base.push(stock(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 6), CK.BRONZE).translate(Math.cos(a) * 0.98, yF + 0.01, zd + Math.sin(a) * 0.98)); }
  return { base, yF, top };
}
/** A capture petal (a trapezoid plate with a lip), built standing up from its pivot at the origin. */
const petalGeo = () => merge([
  loft([[V3(-0.34, 0, -0.02), V3(0.34, 0, -0.02), V3(0.34, 0, 0.02), V3(-0.34, 0, 0.02)], [V3(-0.12, 0.46, -0.02), V3(0.12, 0.46, -0.02), V3(0.12, 0.46, 0.02), V3(-0.12, 0.46, 0.02)]], CK.HULL, { capStart: true, capEnd: true }),
  rod(V3(-0.34, 0.0, 0.0), V3(0.34, 0.0, 0.0), 0.03, CK.BRONZE, 8),
  box(0.2, 0.05, 0.05, CK.BRONZE, V3(0, 0.44, 0.02)),
]);
/** A latch hook: a pivot, an arm and a claw, built from its pivot along +Y then bending inward (-Z). */
const latchGeo = () => merge([
  stock(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8), CK.BRONZE).rotateZ(Math.PI / 2),
  box(0.07, 0.2, 0.04, CK.DARK, V3(0, 0.1, 0)),
  box(0.07, 0.04, 0.12, CK.DARK, V3(0, 0.19, -0.05)),
]);

// ---------------------------------------------------------- landing beams --
const BEAM_VERT = /* glsl */ `
varying float vAlong; varying vec3 vView; varying vec3 vN;
void main() {
  vAlong = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz; vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = /* glsl */ `
uniform float uOn;
varying float vAlong; varying vec3 vView; varying vec3 vN;
void main() {
  vec3 V = normalize(-vView);
  float edge = abs(dot(normalize(vN), V));
  float a = uOn * pow(edge, 1.6) * (1.0 - vAlong) * (1.0 - vAlong) * smoothstep(0.0, 0.04, vAlong);
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a * 0.35, 0.0);
}`;
function beamGeo(len, r) {
  // an open cone from the apex (uv.y 0) to the rim (uv.y 1), axis -Y
  const g = new THREE.CylinderGeometry(0.08, r, len, 28, 6, true).translate(0, -len / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  return g;
}

/**
 * Build the gear, the docking ring and the landing lights. `hull` is the craft mesh; `part(geo)`
 * makes a moving part sharing its material. Returns the rig and its update(dt, st, time).
 */
export function buildGear(hull, part, { dockZ = -9.5 } = {}) {
  const rig = { legs: [], doors: [], petals: [], latches: [], beams: [] };
  const staticGeo = [];

  // ---- bays: ribs, lines and a lamp in each recess (static, in the hull's frame)
  for (const b of BAYS) {
    for (let k = 1; k < 7; k++) {
      const t = lerp(b.t0, b.t1, k / 7);
      staticGeo.push(hullStrip(t - 0.0016, t + 0.0016, b.a0 + 0.002, b.a1 - 0.002, CK.BRONZE, { o: -0.95 + 0.1, i: 0.95 - 0.02 + 0.01, nt: 1, na: 4 }));
    }
    for (const f of [0.25, 0.75]) {
      const a = lerp(b.a0, b.a1, f), pts = [];
      for (let k = 0; k <= 6; k++) pts.push(hullPt(lerp(b.t0 + 0.004, b.t1 - 0.004, k / 6), a, -0.86));
      staticGeo.push(tube(pts, 0.035, CK.DARK, 6, 2));
    }
  }

  const padG = padGeo();
  BAYS.forEach((b, i) => {
    const L = legSpec(b, i);
    // doors: two leaves hinged on the bay's long edges
    for (const [aH, aF] of [[b.a0, (b.a0 + b.a1) / 2], [b.a1, (b.a0 + b.a1) / 2]]) {
      const pA = hullPt(b.t0, aH, 0.0), pB = hullPt(b.t1, aH, 0.0), pivot = pA.clone().lerp(pB, 0.5), axis = pB.clone().sub(pA).normalize();
      const geo = doorLeaf(b, aH, aF).translate(-pivot.x, -pivot.y, -pivot.z);
      const m = part(geo), g = new THREE.Group();
      g.position.copy(pivot); g.add(m); hull.add(g);
      // open outward: the free edge must go down and away from the bay's centre
      const free = hullPt((b.t0 + b.t1) / 2, aF).sub(pivot);
      const test = free.clone().applyAxisAngle(axis, 0.3);
      const sign = test.y < free.y ? 1 : -1;
      // its actuator: a cylinder on the bay wall by the hinge, the rod to a lug on the leaf
      const tm = (b.t0 + b.t1) / 2, anchor = hullPt(tm, aH + (aF - aH) * 0.06, -0.72);
      const lugLocal = hullPt(tm, aH + (aF - aH) * 0.32, -0.05).sub(pivot);
      const aBody = part(merge([stock(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10), CK.DARK).translate(0, 0.25, 0), stock(new THREE.SphereGeometry(0.07, 10, 6), CK.BRONZE)]));
      const aRod = part(merge([stock(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), CK.BRONZE).translate(0, 0.25, 0), stock(new THREE.SphereGeometry(0.045, 8, 6), CK.DARK)]));
      hull.add(aBody); hull.add(aRod);
      g.add(part(bbox(0.1, 0.08, 0.14, 0.02, CK.DARK, lugLocal.clone())));
      rig.doors.push({ g, axis, sign, open: 1.72, anchor, lugLocal, aBody, aRod });
    }
    // the leg: hinge group (splay, then deploy about X), strut, piston, torque links, pad
    const hinge = new THREE.Group();
    hinge.position.copy(L.hinge);
    hinge.rotation.order = 'ZYX';
    hinge.rotation.z = L.splay;
    hull.add(hinge);
    hinge.add(part(strutGeo(L.LS, L.zs)));
    const pistonLen = L.ext + 0.55;                          // piston length including what stays in the strut
    const piston = new THREE.Group(); hinge.add(piston);
    piston.add(part(pistonGeo(pistonLen)));
    const ankle = new THREE.Group(); piston.add(ankle); ankle.position.y = -pistonLen - 0.26;
    const pad = new THREE.Group(); ankle.add(pad); pad.add(part(padG));
    // torque links: upper from the strut lug, lower from the piston lug
    const lk = 0.55;
    const up = part(linkGeo(lk)), lo = part(linkGeo(lk));
    hinge.add(up); hinge.add(lo);
    // retraction actuator: body anchored in the bay, rod to the strut lug
    const anchor = V3(L.hinge.x, L.hinge.y + 0.1, L.hinge.z + L.zs * 0.9);
    const body = part(merge([stock(new THREE.CylinderGeometry(0.1, 0.1, 1.7, 12), CK.DARK).translate(0, 0.85, 0), stock(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 12), CK.BRONZE)]));
    const rodM = part(stock(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 10), CK.BRONZE).translate(0, 0.85, 0));
    hull.add(body); hull.add(rodM);
    rig.legs.push({ L, hinge, piston, ankle, pad, up, lo, lk, anchor, body, rodM, pistonLen });
  });

  // ---- docking ring
  const D = dockParts(dockZ);
  staticGeo.push(...D.base);
  rig.dock = { pos: V3(0, D.yF, dockZ), axis: V3(0, 1, 0) };
  const petalG = petalGeo(), latchG = latchGeo();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * 0.86, D.yF, dockZ + Math.sin(a) * 0.86);
    g.rotation.order = 'YXZ';
    g.rotation.y = Math.PI / 2 - a;                         // local +Z radially outward, the pivot along the tangent
    const m = part(petalG); g.add(m); hull.add(g);
    rig.petals.push(g);
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU + TAU / 24;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * 1.0, D.yF - 0.12, dockZ + Math.sin(a) * 1.0);
    g.rotation.order = 'YXZ';
    g.rotation.y = Math.PI / 2 - a;
    g.add(part(latchG)); hull.add(g);
    rig.latches.push(g);
  }

  // ---- landing lights: lamps in the belly and their beams
  const lampSpots = [];
  const bU = { uOn: { value: 0 } };
  const beamMat = new THREE.ShaderMaterial({ vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, uniforms: bU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  for (const [z, x, tilt] of [[-14.2, 0.9, 0.3], [-14.2, -0.9, 0.3], [4.2, 3.9, 0.08], [4.2, -3.9, 0.08]]) {   // tilt > 0 aims forward
    const t = tOf(z), aF = (() => { let a = 3 * Math.PI / 2, best = 1e9; for (let q = Math.PI + 0.1; q < TAU - 0.1; q += 0.002) { const d = Math.abs(hullPt(t, q).x - x); if (d < best) { best = d; a = q; } } return a; })();
    const p = hullPt(t, aF, 0.02);
    staticGeo.push(revolve([[0.0, 0.0, CK.GLASS], [0.2, 0.0, CK.GLASS], [0.2, 0.0, CK.BRONZE], [0.26, 0.06, CK.BRONZE], [0.24, 0.14, CK.DARK], [0.0, 0.14, CK.DARK]], 16).rotateX(Math.PI / 2).translate(p.x, p.y + 0.04, p.z));
    const beam = new THREE.Mesh(beamGeo(11, 3.2), beamMat);
    beam.position.copy(p).add(V3(0, -0.05, 0));
    beam.rotation.set(tilt, 0, Math.sign(x) * 0.12);
    beam.frustumCulled = false; beam.renderOrder = 16;
    hull.add(beam);
    rig.beams.push(beam);
    lampSpots.push({ p: p.clone().add(V3(0, -0.06, 0)), r: 0.3, color: [1.0, 0.94, 0.82], i: 2.4 });
  }
  rig.beamU = bU;
  rig.lampSpots = lampSpots;
  rig.staticGeo = staticGeo;
  return rig;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _Y = V3(0, 1, 0);

/** Aim a mesh's +Y from a to b (its origin at a), scaling nothing. */
function aim(o, a, b) {
  o.position.copy(a);
  o.quaternion.setFromUnitVectors(_Y, _v.subVectors(b, a).normalize());
}

/**
 * Pose the rig: legs 0..1 (stowed .. down), gear[i] oleo compressions 0..1, docked 0..1,
 * lights 0..1.
 */
export function poseGear(rig, legs, gear, docked, lights) {
  // doors lead the legs out and trail them in
  const door = smooth(0.0, 0.3, legs), dep = smooth(0.18, 1.0, legs);
  for (const d of rig.doors) {
    d.g.quaternion.setFromAxisAngle(d.axis, d.sign * d.open * door);
    const lug = d.lugLocal.clone().applyQuaternion(d.g.quaternion).add(d.g.position);
    aim(d.aBody, d.anchor, lug);
    aim(d.aRod, lug, d.anchor);
  }
  rig.legs.forEach((l, i) => {
    const L = l.L, c = clamp01(gear ? gear[i] || 0 : 0);
    l.hinge.rotation.x = lerp(L.stow, L.dep, dep);
    const ext = lerp(STOW_EXT, L.ext, dep) - OLEO_STROKE * c * dep, LS = L.LS;
    // piston: the ankle (pistonLen + 0.26 below the piston's origin) sits at -(LS + ext) on the leg axis
    l.piston.position.y = -(LS + ext) + l.pistonLen + 0.26;
    // the pad levels with the ship as the leg comes down
    l.pad.quaternion.setFromEuler(l.hinge.rotation).invert();
    // torque links in the hinge frame: upper lug at the strut foot, lower lug on the piston collar
    const uA = V3(0, -LS + 0.05, 0.28), lA = V3(0, -(LS + ext) + 0.2, 0.26);
    const mid = uA.clone().lerp(lA, 0.5), half = uA.distanceTo(lA) / 2;
    const knee = mid.add(V3(0, 0, Math.sqrt(Math.max(l.lk * l.lk - half * half, 0.0001))));
    // each link is built along -Y from its pivot: aim -Y from the lug to the knee
    l.up.position.copy(uA); l.up.quaternion.setFromUnitVectors(_Y, _v.subVectors(uA, knee).normalize());
    l.lo.position.copy(lA); l.lo.quaternion.setFromUnitVectors(_Y, _w.subVectors(lA, knee).normalize());
    // actuator: from its bay anchor to the strut lug (in the hull frame)
    l.hinge.updateMatrix();
    const lug = V3(0, -2.0, L.zs * 0.38).applyMatrix4(l.hinge.matrix);
    aim(l.body, l.anchor, lug);
    aim(l.rodM, lug, l.anchor);
    void _m; void _q2;
  });
  // docking ring: petals stand ready (leaning in) and fold flat once docked; latches swing closed
  for (const p of rig.petals) p.rotation.x = lerp(0.25, 1.45, docked);
  for (const g of rig.latches) g.rotation.x = lerp(0.9, -0.05, docked);
  rig.beamU.uOn.value = lights;
  for (const b of rig.beams) b.visible = lights > 0.01;
}
void U; void loft;
