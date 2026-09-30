// Headless checks for the Lodestar (src/space/starship.js and its lodestar*.js parts): build time,
// triangle budget, finite geometry, that LODESTAR_FEET and LODESTAR_DOCK match the model (legs
// animated down, soles and the ring's mating face measured from the posed geometry, within 5 cm),
// that the gear folds inside the belly when stowed, that nothing sits within the near-plane
// clearance ahead of the bridge camera, and the per-frame update cost.
// Run from the repo root: node tools/verify-lodestar.mjs
import * as THREE from 'three';
import { Starship, LODESTAR_FEET, LODESTAR_DOCK, LODESTAR_EYE, SHIP } from '../src/space/starship.js';
import { NEAR_CLEAR } from '../src/space/lodestarBridge.js';
import { PAD_H } from '../src/space/lodestarGear.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const f3 = (v) => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

let t0 = performance.now();
const ship = new Starship();
const buildMs = performance.now() - t0;
const hull = ship.hull;

// ---- triangles, finiteness
let total = 0, detail = 0, nan = 0;
const byName = {};
hull.traverse((o) => {
  if (!o.isMesh) return;
  const g = o.geometry, n = tris(g);
  total += n;
  if (o === ship.detail) detail += n;
  const key = o.name || (o.material && o.material.type) || 'mesh';
  byName[key] = (byName[key] || 0) + n;
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) { nan++; break; }
  if (g.attributes.normal) { const q = g.attributes.normal.array; for (let i = 0; i < q.length; i++) if (!Number.isFinite(q[i])) { nan++; break; } }
});
ok(nan === 0, `non-finite geometry in ${nan} meshes`);
ok(total < 1.5e6, `triangle budget: ${total}`);

// ---- pose: legs fully down, uncompressed, then measure soles (lowest points of each pad)
const settle = (s, n = 400) => { for (let i = 0; i < n; i++) ship.update(1 / 30, s); };
settle({ throttle: 0, boost: 0, legs: 1, gear: [0, 0, 0], docked: 0 });
ship.root.updateMatrixWorld(true);
hull.scale.setScalar(1); hull.updateMatrixWorld(true);                 // measure in metres
const inv = new THREE.Matrix4().copy(hull.matrixWorld).invert();
const lowest = (obj) => {
  let best = null;
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv); if (!best || v.y < best.y - 1e-6) best = v.clone(); }
  });
  return best;
};
const soleCentre = (pad) => {
  // the sole: the pad's own frame (levelled) at the sole plate's depth, checked against its lowest vertex
  pad.updateMatrixWorld(true);
  const c = new THREE.Vector3(0, -PAD_H, 0).applyMatrix4(pad.matrixWorld).applyMatrix4(inv);
  const low = lowest(pad);
  ok(Math.abs(low.y - c.y) < 0.03, `pad sole plate at ${c.y.toFixed(3)} but its lowest vertex at ${low.y.toFixed(3)}`);
  return c;
};
const soles = ship.gear.legs.map((l) => soleCentre(l.pad));
soles.forEach((s, i) => {
  const d = s.distanceTo(LODESTAR_FEET[i]);
  console.log(`foot ${i}: measured ${f3(s)} constant ${f3(LODESTAR_FEET[i])} off ${(d * 100).toFixed(1)} cm`);
  ok(d < 0.05, `LODESTAR_FEET[${i}] off by ${d.toFixed(3)} m`);
});
// the lowest point of the whole ship with the legs down must be a sole
let low = null;
hull.traverse((o) => { if (o.isMesh && o.material === hull.material && o !== hull) { const l = lowest(o); if (!low || l.y < low.y) low = l; } });
ok(low.y > Math.min(...soles.map((s) => s.y)) - 0.02, `something hangs below the feet: ${f3(low)}`);

// ---- compression: soles rise by the stroke
settle({ legs: 1, gear: [1, 1, 1] }, 200);
hull.updateMatrixWorld(true);
const soles1 = ship.gear.legs.map((l) => soleCentre(l.pad));
soles1.forEach((s, i) => ok(s.y - soles[i].y > 0.35 && s.y - soles[i].y < 0.6, `oleo ${i} stroke ${(s.y - soles[i].y).toFixed(2)}`));

// ---- dock: the ring's mating face (the highest flat annulus of the fittings near the ring axis)
{
  const f = ship.fittings.geometry.attributes.position, v = new THREE.Vector3();
  let top = -1e9;
  for (let i = 0; i < f.count; i++) {
    v.fromBufferAttribute(f, i);
    const r = Math.hypot(v.x - LODESTAR_DOCK.pos.x, v.z - LODESTAR_DOCK.pos.z);
    if (r > 0.7 && r < 1.02 && Math.abs(v.y - LODESTAR_DOCK.pos.y) < 0.5) {
      // skip the pins and fasteners (narrow): only the flange profile vertices sit on whole rings
      top = Math.max(top, v.y);
    }
  }
  const face = ship.gear.dock.pos;
  console.log(`dock: model face ${f3(face)} constant ${f3(LODESTAR_DOCK.pos)}; highest flange vertex y ${top.toFixed(3)}`);
  ok(face.distanceTo(LODESTAR_DOCK.pos) < 0.05, 'LODESTAR_DOCK.pos matches the ring');
  ok(Math.abs(LODESTAR_DOCK.axis.length() - 1) < 1e-6 && LODESTAR_DOCK.axis.y > 0.99, 'dock axis is up');
  // nothing of the hull or bridge rises above the mating face within 2.5 m of the ring axis
  // (except the pins and the petals, which are the ring's own)
  let clash = 0;
  const base = hull.geometry.attributes.position;
  for (let i = 0; i < base.count; i++) {
    v.fromBufferAttribute(base, i);
    if (Math.hypot(v.x, v.z - LODESTAR_DOCK.pos.z) < 2.5 && v.y > LODESTAR_DOCK.pos.y + 0.02) clash++;
  }
  ok(clash === 0, `${clash} hull vertices above the docking face near the ring`);
}

// ---- stowed: every leg part inside the hull envelope (above the belly's outer skin)
settle({ legs: 0, gear: [0, 0, 0] }, 600);
hull.updateMatrixWorld(true);
{
  const lowLeg = Math.min(...ship.gear.legs.map((l) => lowest(l.hinge).y));
  const doorsLow = Math.min(...ship.gear.doors.map((d) => lowest(d.g).y));
  console.log(`stowed: lowest leg point y ${lowLeg.toFixed(2)}, lowest door point ${doorsLow.toFixed(2)}`);
  ok(lowLeg > -1.52, `a stowed leg pokes out of the belly (${lowLeg.toFixed(2)})`);
  const lowAct = Math.min(...ship.gear.doors.flatMap((d) => [lowest(d.aBody).y, lowest(d.aRod).y]));
  ok(lowAct > -1.52, `a door actuator pokes out of the belly with the doors shut (${lowAct.toFixed(2)})`);
}

// ---- the bridge: clear space ahead of the eye (the near plane), eye inside the pod
{
  const E = LODESTAR_EYE, v = new THREE.Vector3();
  let close = 0, closest = 1e9;
  hull.traverse((o) => {
    if (!o.isMesh || o.name === 'Lodestar canopy') return;
    if (o.material && o.material.blending === THREE.AdditiveBlending) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      if (v.z > E.z - 0.05) continue;                                   // behind the eye: out of view
      const d = v.distanceTo(E);
      if (d < closest) closest = d;
      if (d < NEAR_CLEAR) close++;
    }
  });
  console.log(`bridge: nearest geometry ahead of the eye ${closest.toFixed(2)} m (clearance ${NEAR_CLEAR} m)`);
  ok(close === 0, `${close} vertices within ${NEAR_CLEAR} m ahead of the bridge eye`);
  // the eye must be enclosed: rays up, forward, left, right hit the canopy glass before anything else
  const ray = new THREE.Raycaster();
  const glass = ship.canopy;
  for (const d of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.25, -1), new THREE.Vector3(1, 0.2, -0.3), new THREE.Vector3(-1, 0.2, -0.3)]) {
    ray.set(E.clone(), d.normalize());
    const hit = ray.intersectObject(glass, false)[0];
    ok(!!hit, `bridge eye enclosed by the canopy toward ${f3(d)}`);
  }
}

// ---- normals face out: the pod's roof, the belly tiles, the hull's flanks
{
  const frac = (mesh, sel, want) => {
    const p = mesh.geometry.attributes.position, n = mesh.geometry.attributes.normal, v = new THREE.Vector3(), q = new THREE.Vector3();
    let good = 0, all = 0;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (!sel(v)) continue; q.fromBufferAttribute(n, i); all++; if (want(v, q)) good++; }
    return all ? good / all : 1;
  };
  const roof = frac(hull, (v) => v.y > 5.4 && Math.abs(v.x) < 0.5 && v.z > 0.15 && v.z < 0.35, (v, q) => q.y > 0.5);
  const belly = frac(ship.detail, (v) => v.y < -1.2 && Math.abs(v.x) < 1.5, (v, q) => q.y < -0.3 || Math.abs(q.y) < 0.3);
  const flank = frac(hull, (v) => v.y > 0.4 && v.y < 1.0 && Math.abs(v.x) > 3 && v.z > -5 && v.z < 5, (v, q) => q.x * Math.sign(v.x) > 0);
  console.log(`normals out: pod roof ${(roof * 100).toFixed(0)}%, belly tiles ${(belly * 100).toFixed(0)}%, flanks ${(flank * 100).toFixed(0)}%`);
  ok(roof > 0.95 && belly > 0.95 && flank > 0.9, 'outward normals');
}

// ---- the drive: gimbals follow the pitch / yaw asked for, the docked lamps and latches switch
{
  settle({ throttle: 1, legs: 0, ang: new THREE.Vector3(1, 0, 0), docked: 1 }, 120);
  const e = ship.engines[0].g;
  ok(e.rotation.x < -0.08 && e.rotation.x > -0.11, `main engine gimbal pitch ${e.rotation.x.toFixed(3)}`);
  ok(ship.ringLampsDocked.visible && !ship.ringLamps.visible, 'docked ring lamps');
  ok(Math.abs(ship.movers.dock.latches[0].rotation.x + 0.05) < 0.02, 'latches closed when docked');
  settle({ throttle: 0, legs: 0, docked: 0 }, 200);
  ok(Math.abs(ship.engines[0].g.rotation.x) < 0.005, 'gimbal centres when cold');
}

// ---- timing
{
  const n = 600;
  t0 = performance.now();
  for (let i = 0; i < n; i++) ship.update(1 / 60, { throttle: (i % 100) / 100, boost: i % 200 > 100 ? 1 : 0, legs: i % 300 > 150 ? 1 : 0, gear: [0.3, 0.2, 0.1], docked: i % 400 > 200, ang: new THREE.Vector3(0.2, 0, 0.1), lin: new THREE.Vector3(0, 0.1, 0), time: i / 60 });
  const us = ((performance.now() - t0) / n) * 1000;
  console.log(`update: ${us.toFixed(1)} us/frame`);
  ok(us < 400, 'update under 0.4 ms');
}

console.log(`build ${buildMs.toFixed(0)} ms; triangles ${total} (close-up detail ${detail}); length ${SHIP.L} m`);
console.log('by mesh:', Object.entries(byName).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
