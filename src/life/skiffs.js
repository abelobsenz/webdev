import * as THREE from 'three';
import { buildSkiff } from '../craft/craftGeometry.js';
import { createFacadeMaterial } from '../world/facade.js';
import { createEngine, createPlumeTrail } from '../craft/plumes.js';
import { FLOATING_ISLANDS, CHORUS } from '../world/layout.js';

// Courier skiffs: small personal craft (descended from the bundle's interceptor, unarmed)
// flying scenic loops over the lagoon, round the Axis and through the floating gardens.
// Each carries two plasma-throat engines and, behind them, the bundle's world-space
// trailing plume, so the exhaust hangs in the air and bends through every turn.

const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

function loop(center, rx, rz, y, amp, n = 64, phase = 0, lobes = 2) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + phase;
    pts.push(new THREE.Vector3(center.x + Math.cos(a) * rx, y + amp * Math.sin(a * lobes), center.z + Math.sin(a) * rz));
  }
  return pts;
}

function figureEight(a, b, y, amp, n = 96) {
  const pts = [];
  const c = a.clone().add(b).multiplyScalar(0.5), d = b.clone().sub(a);
  const L = d.length() * 0.5, side = new THREE.Vector3(-d.z, 0, d.x).normalize();
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2;
    const p = c.clone().addScaledVector(d.clone().normalize(), Math.sin(t) * L * 1.15).addScaledVector(side, Math.sin(2 * t) * L * 0.45);
    p.y = y + amp * Math.cos(t);
    pts.push(p);
  }
  return pts;
}

export class Skiffs {
  constructor(scene, world) {
    this.scene = scene;
    const clear = world.traffic && world.traffic.clear;
    const fi = FLOATING_ISLANDS;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const paths = [
      loop(V(0, 0, 0), 1250, 1250, 430, 70, 96, 0, 3),
      loop(V(0, 0, 0), 1450, 1300, 360, 50, 96, Math.PI, 2),
      figureEight(V(fi[0].x, 0, fi[0].z), V(CHORUS.x, 0, CHORUS.z), 640, 90),
      figureEight(V(fi[6].x, 0, fi[6].z), V(-400, 0, -2600), 760, 110),
      loop(V(2200, 0, 800), 900, 700, 240, 40, 80, 0.7, 2),
      loop(V(-1900, 0, 900), 850, 1000, 260, 50, 80, 1.9, 3),
      loop(V(-600, 0, -1600), 1000, 700, 520, 80, 80, 2.4, 2),
      loop(V(1600, 0, -1900), 800, 900, 300, 60, 80, 4.0, 3),
    ];
    // keep every loop clear of towers, islands, the Axis and its lattice
    for (const P of paths) {
      for (let pass = 0; pass < 3; pass++) {
        for (const p of P) {
          if (!clear) break;
          const c = clear.clearance(p);
          if (c < 40) p.y += 40 - c;
        }
        // smooth the lifted profile
        const ys = P.map((p) => p.y);
        for (let i = 0; i < P.length; i++) P[i].y = Math.max(ys[i], (ys[(i + P.length - 1) % P.length] + ys[i] * 2 + ys[(i + 1) % P.length]) / 4);
      }
    }
    this.curves = paths.map((P) => new THREE.CatmullRomCurve3(P, true, 'centripetal'));
    const sk = buildSkiff();
    const mat = createFacadeMaterial('pearl', 620, { litFrac: 0.8, uplight: 0 });
    this.craft = [];
    const colors = [[0x7fd8ff, 0xeefaff], [0xffb46a, 0xfff2e0], [0x9affd6, 0xf2fff8], [0xc8a6ff, 0xf6f0ff]];
    const perPath = [2, 2, 1, 1, 1, 1, 1, 1];
    let idx = 0;
    this.curves.forEach((curve, ci) => {
      const L = curve.getLength();
      for (let k = 0; k < perPath[ci]; k++) {
        const mesh = new THREE.Mesh(sk.geo, mat);
        mesh.castShadow = true;
        const scale = 1.25;
        mesh.scale.setScalar(scale);
        const [c0, c1] = colors[idx % colors.length];
        const engines = sk.glows.map((g, j) => {
          const e = createEngine({ radius: g.r * 0.85, length: 9, color: c0, core: c1, seed: idx * 0.31 + j * 0.13 });
          e.position.copy(g.p);
          mesh.add(e);
          return e;
        });
        const trails = sk.glows.map((g, j) => {
          const t = createPlumeTrail({ color: c0, coreColor: c1, segments: 28, spacing: 4.5, width: 0.9, decay: 0.9, seed: idx + j * 0.5, gain: 0.9, farNear: 700, farFar: 1500 });
          scene.add(t.mesh);
          return t;
        });
        scene.add(mesh);
        this.craft.push({ mesh, engines, trails, glows: sk.glows, curve, L, u: (k / perPath[ci] + ci * 0.137) % 1, speed: 72 + ((idx * 37) % 40), roll: 0, scale });
        idx++;
      }
    });
    this.enabled = true;
  }

  applyQuality(s) { this.enabled = s.traffic > 0.5; for (const c of this.craft) { c.mesh.visible = this.enabled; for (const t of c.trails) t.mesh.visible = this.enabled && t.mesh.visible; } }

  update(dt, t, camera) {
    if (!this.enabled || !dt) return;
    const cam = camera ? camera.position : null;
    for (const c of this.craft) {
      c.u = (c.u + (c.speed * dt) / c.L) % 1;
      const p = c.curve.getPointAt(c.u, _v);
      const tan = c.curve.getTangentAt(c.u, _t);
      const ahead = c.curve.getTangentAt((c.u + 0.004) % 1, _n);
      // bank into the turn: lateral acceleration from the change of heading
      const turn = new THREE.Vector3().crossVectors(tan, ahead).y;
      const targetRoll = THREE.MathUtils.clamp(-turn * 90, -1.1, 1.1);
      c.roll += (targetRoll - c.roll) * (1 - Math.exp(-dt * 2.5));
      _m.lookAt(p.clone().add(tan), p, new THREE.Vector3(0, 1, 0));
      _q.setFromRotationMatrix(_m);
      c.mesh.position.copy(p);
      c.mesh.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), c.roll));
      c.mesh.updateMatrixWorld();
      const climb = tan.y;
      const throttle = THREE.MathUtils.clamp(0.9 + climb * 2.0 + Math.abs(turn) * 8, 0.5, 1.4);
      for (const e of c.engines) e.setThrottle(throttle);
      const far = cam ? cam.distanceTo(p) > 4000 : false;
      c.glows.forEach((g, j) => {
        const tr = c.trails[j];
        if (far) { tr.mesh.visible = false; return; }
        const noz = g.p.clone().add(new THREE.Vector3(0, 0, -0.2)).applyMatrix4(c.mesh.matrixWorld);
        tr.update(noz, throttle * 1.1, dt, 1);
      });
    }
  }
}
