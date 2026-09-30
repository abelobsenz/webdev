import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { CRAFT_FRAME, refineCraftMaterial, setCraftEnvelope } from './craftMesh.js';
import { createCraftMaterial, updateCraftMaterial } from '../craft/craftMaterial.js';
import { createLamps, LAMP } from './lamps.js';

// Docking hardware for the ports registry (src/space/ports.js): where a station had no plausible
// place for the Lodestar to mate or set down, this kit adds the real thing.
//
//   collar  a short pressurised tube standing off the hull on a flange, a mating ring at its face
//           (the androgynous ring the Lodestar's dorsal ring meets), three capture petals leaning
//           out from the ring, and an alignment target (a cross on a stand-off post) beside it that
//           a pilot lines up against the ring for roll. Built in metres, axis +Y out of the hull,
//           +Z the roll reference (the mated ship's nose points along it).
//   pad     a landing pad's paint (a pale ring and an aiming cross, a heading bar along +Z) as a
//           thin disc, for pads that have no markings of their own. Local +Y up.
//   lamps   approach lights: a ring of steady green and white lamps round each collar face and
//           a slowly breathing white lamp out along the axis; pad edge lights round each pad.
//
// Every collar (and every pad disc) on one parent group is a single InstancedMesh with the craft
// material, so a station with several ports costs one draw, and all the lamps of a parent share
// one lamp sprite mesh. Instance matrices carry the metres-to-parent-unit scale.

const TAU = Math.PI * 2;

/** Collar dimensions (metres): the ship's ring meets the face at y = COLLAR.face. */
export const COLLAR = { face: 3.4, tubeR: 1.45, flangeR: 2.6, ringR: 1.62, petalR: 1.9, targetX: 2.9, reach: 4.2 };

let _collarGeo = null, _padGeo = null;

/** Collar geometry (metres), axis +Y, roll reference +Z. Cached, shared by every station. */
export function collarGeometry() {
  if (_collarGeo) return _collarGeo;
  const B = new CB();
  // the lathe revolves round local z; turn it so the collar's axis is +Y
  B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  B.lathe([
    [COLLAR.flangeR, 0, CK.BRONZE], [COLLAR.flangeR, 0.35, CK.BRONZE], [COLLAR.tubeR + 0.25, 0.5, CK.HULL],
    [COLLAR.tubeR, 0.7, CK.HULL], [COLLAR.tubeR, COLLAR.face - 0.55, CK.HULL], [COLLAR.ringR + 0.12, COLLAR.face - 0.4, CK.DARK],
    [COLLAR.ringR + 0.12, COLLAR.face - 0.05, CK.DARK], [COLLAR.ringR - 0.2, COLLAR.face, CK.CONDUIT], [1.05, COLLAR.face, CK.DARK],
    [1.05, COLLAR.face - 0.3, CK.DARK],
  ], 20);
  B.pop();
  // the mating ring's latch torus
  B.push(new THREE.Matrix4().makeTranslation(0, COLLAR.face - 0.22, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  B.torus(COLLAR.ringR, 0.09, 24, 5, CK.BRONZE);
  B.pop();
  // three capture petals leaning out of the ring, 120 degrees apart (one on the roll reference)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    B.push(new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(0, COLLAR.face - 0.05, COLLAR.petalR - 0.3))
      .multiply(new THREE.Matrix4().makeRotationX(-0.38)));
    B.box(0, 0.42, 0, 0.62, 0.95, 0.07, CK.HULL);
    B.box(0, 0.9, 0.0, 0.38, 0.12, 0.1, CK.LANTERN);
    B.pop();
  }
  // four latch housings on the tube
  for (let i = 0; i < 4; i++) {
    const a = (i / 4 + 0.125) * TAU;
    B.box(Math.sin(a) * (COLLAR.tubeR + 0.12), COLLAR.face - 1.0, Math.cos(a) * (COLLAR.tubeR + 0.12), 0.34, 0.8, 0.34, CK.BRONZE);
  }
  // the alignment target: a post off the flange on +X, a black plate with a white cross, stood off
  B.box(COLLAR.targetX, 1.2, 0, 0.16, 2.4, 0.16, CK.CONDUIT);
  B.box(COLLAR.targetX, 2.45, 0, 0.9, 0.06, 0.9, CK.DARK);
  B.box(COLLAR.targetX, 2.49, 0, 0.7, 0.03, 0.12, CK.LANTERN);
  B.box(COLLAR.targetX, 2.49, 0, 0.12, 0.03, 0.7, CK.LANTERN);
  B.box(COLLAR.targetX, 2.95, 0, 0.08, 0.9, 0.08, CK.LANTERN);
  // hazard-striped handrail hoops either side of the tube
  for (const s of [-1, 1]) B.box(0, 1.6, s * (COLLAR.tubeR + 0.35), 0.1, 1.6, 0.1, CK.CONDUIT);
  _collarGeo = B.geometry();
  return _collarGeo;
}

/** Pad paint (metres) for a pad of radius r, local +Y up, 6 cm proud. Cached per radius bucket. */
export function padGeometry() {
  if (_padGeo) return _padGeo;
  const B = new CB();
  B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  // unit radius: an outer pale ring, a dark field, an inner ring (scaled per pad by the instance)
  B.lathe([[1, 0, CK.DECK], [1, 0.004, CK.LANTERN], [0.93, 0.004, CK.LANTERN], [0.93, 0.003, CK.DARK], [0.42, 0.003, CK.DARK],
    [0.42, 0.004, CK.LANTERN], [0.36, 0.004, CK.LANTERN], [0.36, 0.003, CK.DECK], [0, 0.003, CK.DECK]], 32);
  B.pop();
  // the aiming cross and the heading bar along +Z
  B.box(0, 0.0045, 0, 0.5, 0.001, 0.05, CK.LANTERN);
  B.box(0, 0.0045, 0, 0.05, 0.001, 0.5, CK.LANTERN);
  B.box(0, 0.0045, 0.65, 0.06, 0.001, 0.4, CK.LANTERN);
  _padGeo = B.geometry();
  return _padGeo;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

/** Basis matrix: +Y along n, +Z along fwd (made perpendicular), at p, uniform scale s. */
export function portMatrix(p, n, fwd, s, out = new THREE.Matrix4()) {
  _y.copy(n).normalize();
  _z.copy(fwd).addScaledVector(_y, -_y.dot(fwd));
  if (_z.lengthSq() < 1e-12) _z.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _z.normalize();
  _x.crossVectors(_y, _z);
  out.makeBasis(_x, _y, _z).scale(_s.setScalar(s)).setPosition(p);
  return out;
}

/**
 * Hardware on one parent group. unit: metres per parent unit (1 for a metres group, 1000 for
 * a km group). Add collars and pads with the port's mating point in parent units: the collar's
 * face lands exactly on it (the collar grows back into the hull along -n).
 */
export class DockHardware {
  constructor(parent, unit = 1) {
    this.parent = parent;
    this.unit = unit;
    this.collars = [];
    this.pads = [];
    this.lamps = [];
    this.meshes = [];
  }
  /** A collar whose mating face centre is at p (parent units), axis n, roll reference fwd. */
  collar(p, n, fwd) {
    const s = 1 / this.unit;
    const base = p.clone().addScaledVector(n.clone().normalize(), -COLLAR.face * s);
    const m = portMatrix(base, n, fwd, s);
    this.collars.push(m);
    // approach ring of eight lamps round the face (green on the roll-reference side, white
    // elsewhere) and a breathing lamp 12 m out along the axis
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const lp = new THREE.Vector3(Math.sin(a) * 2.35, COLLAR.face - 0.1, Math.cos(a) * 2.35).applyMatrix4(m);
      this.lamps.push({ p: lp, r: 0.22 * s, color: i === 0 || i === 1 || i === 7 ? LAMP.GREEN : LAMP.WHITE, i: 2.4 });
    }
    this.lamps.push({ p: new THREE.Vector3(0, COLLAR.face + 12, 0).applyMatrix4(m), r: 0.3 * s, color: LAMP.WHITE, i: 2.0, breathe: 0.6 });
    return this;
  }
  /** A painted pad of radius r (metres) at p (parent units), up n, heading fwd, with edge lights. */
  pad(p, n, fwd, r, { paint = true, lights = 12 } = {}) {
    const s = 1 / this.unit;
    const m = portMatrix(p, n, fwd, s);
    if (paint) this.pads.push(m.clone().multiply(_m.makeScale(r, r, r)));
    for (let i = 0; i < lights; i++) {
      const a = (i / lights) * TAU;
      this.lamps.push({ p: new THREE.Vector3(Math.sin(a) * r * 1.02, 0.5, Math.cos(a) * r * 1.02).applyMatrix4(m), r: 0.9 * s, color: i === 0 ? LAMP.GREEN : LAMP.AMBER, i: 2.2 });
    }
    return this;
  }
  /** Build the instanced meshes and the lamp sprites and add them to the parent. */
  build() {
    const add = (geo, list, name) => {
      if (!list.length) return;
      const mat = refineCraftMaterial(createCraftMaterial({}));
      setCraftEnvelope(mat, geo);
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.name = name;
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      im.renderOrder = 3;
      const world = new THREE.Vector3();
      im.onBeforeRender = (r, sc, cam) => {
        im.getWorldPosition(world);
        updateCraftMaterial(mat, cam, CRAFT_FRAME.sunDir, world, CRAFT_FRAME.time);
        mat.uniformsNeedUpdate = true;
      };
      this.parent.add(im);
      this.meshes.push(im);
    };
    add(collarGeometry(), this.collars, 'dockCollars');
    add(padGeometry(), this.pads, 'padPaint');
    if (this.lamps.length) {
      const l = createLamps(this.lamps, { minPx: 1.2, gain: 1 });
      l.name = 'dockLamps';
      this.parent.add(l);
      this.meshes.push(l);
    }
    return this;
  }
}
