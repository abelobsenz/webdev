import * as THREE from 'three';
import { buildLiner, buildTender, buildRefinery } from '../craft/craftGeometry.js';
import { createCraftMaterial, updateCraftMaterial, createGlowMesh } from '../craft/craftMaterial.js';
import { R_EARTH, R_MOON, GEO_ALT, MERIDIAN_LON, bodyDir } from './sim.js';

// MERIDIAN's ships in the orbital view (km units; the craft are built in metres).
//  - a Concord-class liner berthed at the Geostationary Harbour, and a second one
//    easing in on approach, engines lit
//  - reclamation tenders working near the Halo, cradles opening and closing
//  - Selene Works, the lunar ice refinery, stationed above the Moon's near side
// Each craft is a single merged mesh with its own material (view-space lighting, so
// nothing jitters 42,000 km from the origin) plus a mesh of engine glows.

const KM = 0.001;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _m2 = new THREE.Matrix4();

function craftMesh(geo, opts) {
  const mat = createCraftMaterial(opts);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(KM);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.userData.world = new THREE.Vector3();
  mesh.onBeforeRender = (r, s, cam) => {
    mesh.getWorldPosition(mesh.userData.world);
    updateCraftMaterial(mat, cam, mesh.userData.sunDir || _v.set(1, 0, 0), mesh.userData.world, mesh.userData.time || 0);
    mat.uniformsNeedUpdate = true;
  };
  return mesh;
}

export class Fleet {
  constructor(space) {
    this.space = space;
    this.crafts = [];
    const el = space.elevator;
    // ---- liners
    const liner = buildLiner(2400);
    // berthed side-on at the tip of one of the harbour's docking arms
    {
      const a = 0.2, L = 19;
      const m = craftMesh(liner.geo, { accent: [0.55, 0.85, 1.0], lit: 0.6 });
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      m.position.copy(dir).multiplyScalar(L + 0.34).add(new THREE.Vector3(0, -2.4, 0));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)));
      const glow = createGlowMesh(liner.glows, { color: [0.5, 0.75, 1.0], strength: 1.2, scale: KM });
      m.add(glow);
      el.harbour.add(m);
      this.docked = m;
      this.crafts.push(m);
    }
    // on approach: a slow pass along the harbour's orbit, engines at cruise
    {
      const m = craftMesh(liner.geo, { accent: [1.0, 0.72, 0.45], lit: 0.5 });
      const glow = createGlowMesh(liner.glows, { color: [0.55, 0.8, 1.0], strength: 7, scale: KM });
      m.add(glow);
      this.approach = new THREE.Group();
      this.approach.add(m);
      space.scene.add(this.approach);
      this.approachShip = m;
      this.crafts.push(m);
      space.addBody('liner', [this.approach], () => this.approach.getWorldPosition(_v), 2.2, { solid: true });
    }
    // ---- tenders near the Halo
    const tender = buildTender(320);
    this.tenders = [];
    this.tenderGroup = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const m = craftMesh(tender.geo, { accent: [0.5, 1.0, 0.8], lit: 0.45 });
      const arms = tender.arms.map((A) => {
        const pivot = new THREE.Group();
        pivot.position.copy(A.pivot);
        const am = new THREE.Mesh(A.geo, m.material);
        am.position.copy(A.pivot).negate();
        am.frustumCulled = false;
        am.renderOrder = 3;
        am.onBeforeRender = m.onBeforeRender;
        pivot.add(am);
        m.add(pivot);
        return { pivot, axis: A.axis };
      });
      m.add(createGlowMesh(tender.glows, { color: [0.6, 1.0, 0.85], strength: 3, scale: KM }));
      this.tenderGroup.add(m);
      this.tenders.push({ mesh: m, arms, phase: i * 2.1, offset: new THREE.Vector3((i - 1) * 3.2, 1.2 * Math.sin(i * 2.0), (i - 1) * 1.4 + 1.5) });
      this.crafts.push(m);
    }
    space.scene.add(this.tenderGroup);
    space.addBody('tenders', [this.tenderGroup], () => this.tenderGroup.getWorldPosition(_v), 6, { solid: true });
    // ---- Selene Works over the Moon's near side
    const ref = buildRefinery(1);
    this.refinery = new THREE.Group();
    const rm = craftMesh(ref.geo, { accent: [1.0, 0.7, 0.4], lit: 0.5 });
    const wm = new THREE.Mesh(ref.wheel, rm.material);
    wm.frustumCulled = false;
    wm.renderOrder = 3;
    wm.onBeforeRender = rm.onBeforeRender;
    rm.add(wm);
    this.wheel = wm;
    rm.add(createGlowMesh(ref.glows, { color: [1.0, 0.62, 0.35], strength: 2.4, scale: KM }));
    this.refinery.add(rm);
    this.refineryMesh = rm;
    this.crafts.push(rm);
    space.scene.add(this.refinery);
    space.addBody('selene', [this.refinery], () => this.refinery.getWorldPosition(_v), 6, { solid: true });
    this.moonAlt = 2600;
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
      const up = bodyDir(0, MERIDIAN_LON + 0.5, _v2).applyQuaternion(q);
      const east = _v3.set(0, 1, 0).cross(up).normalize();
      const north = _v4.copy(up).cross(east);
      if (outPos) outPos.copy(up).multiplyScalar(R_EARTH + 620 + 14).addScaledVector(north, 26);
      if (outQuat) outQuat.setFromRotationMatrix(_m2.makeBasis(east, up, north));
    } else if (name === 'selene') {
      const toEarth = _v2.copy(sim.moonPos).negate().normalize();
      if (outPos) outPos.copy(sim.moonPos).addScaledVector(toEarth, R_MOON + this.moonAlt);
      if (outQuat) outQuat.setFromUnitVectors(_v3.set(0, 1, 0), toEarth);
    }
    return outPos || outQuat;
  }

  update(sim, realTime, dt, space) {
    const el = space.elevator;
    for (const c of this.crafts) { c.userData.sunDir = sim.sunDir; c.userData.time = realTime; }
    // approach: along the harbour's local tangent, a 12-minute pass that loops
    {
      el.harbour.updateMatrixWorld(true);
      const T = 720, t = (realTime % T) / T;
      const along = THREE.MathUtils.lerp(-90, 30, t);
      const ease = 1 - Math.pow(1 - t, 2);
      const local = new THREE.Vector3(Math.cos(1.1) * 34, 6 - 3 * ease, Math.sin(1.1) * 34).add(new THREE.Vector3(-Math.sin(1.1), 0, Math.cos(1.1)).multiplyScalar(along));
      this.approach.position.copy(local).applyMatrix4(el.harbour.matrixWorld);
      _q.setFromRotationMatrix(_m.extractRotation(el.harbour.matrixWorld));
      this.approach.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-Math.sin(1.1), 0, Math.cos(1.1))));
      this.approachShip.children[0].material.uniforms.uStrength.value = 7 * (1 - 0.7 * ease);
    }
    // tenders: station-keeping above and beside the Halo, cradles breathing open and closed
    {
      this.pose('tenders', sim, this.tenderGroup.position, this.tenderGroup.quaternion);
      for (const t of this.tenders) {
        const w = realTime * 0.05 + t.phase;
        t.mesh.position.copy(t.offset).add(new THREE.Vector3(Math.sin(w) * 0.2, Math.sin(w * 0.7) * 0.1, Math.cos(w) * 0.2));
        t.mesh.rotation.set(0.1 * Math.sin(w * 0.5), w * 0.2, 0.05 * Math.sin(w * 0.3));
        const open = 0.5 + 0.5 * Math.sin(realTime * 0.25 + t.phase);
        for (const a of t.arms) a.pivot.quaternion.setFromAxisAngle(a.axis, -0.15 + 0.55 * open);
      }
    }
    // Selene Works: fixed over the near side, spindle pointing away from the Moon
    {
      this.pose('selene', sim, this.refinery.position, this.refinery.quaternion);
      this.wheel.rotation.y = realTime * 0.04;
    }
  }
}

/** Focus targets for the craft (merged into the space target list). */
export function fleetTargets(space) {
  const P = (name) => ({
    position: (o) => (space.fleet ? space.fleet.pose(name, space.sim, o, null) : o.set(0, 0, 0)),
    frame: (q) => (space.fleet ? space.fleet.pose(name, space.sim, null, q) : q.identity()),
  });
  return {
    liner: { ...P('liner'), minDist: 1.2, maxDist: 20000, defaultDist: 6.5, view: { az: 0.8, el: 0.25 } },
    tenders: { ...P('tenders'), minDist: 0.4, maxDist: 20000, defaultDist: 4.2, view: { az: 0.6, el: 0.3 } },
    selene: { ...P('selene'), minDist: 4, maxDist: 60000, defaultDist: 17, view: { az: 0.9, el: 0.18 } },
  };
}
