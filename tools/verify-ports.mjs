// Invariants of the ports registry (src/space/ports.js), headless.
//   - every target but the bodies (and the Lodestar itself) has at least one port; ids unique
//   - poses finite, |n| = |fwd| = 1, n . fwd = 0, kinds and sizes sane
//   - poses follow their structure continuously: across successive 1/60 s evaluations a port
//     moves with its target (orbital motion) plus at most its spin speed, never jumps
//   - near the Earth every port lies above the ship's keep-out (R_EARTH + 95 km); lunar pads sit
//     on the Moon and face out of it
//   - geometry (where a station can be built headlessly): the approach corridor (a 30 m
//     cylinder out along n for `approach` km, from 25 m off the face) and the mated ship's
//     envelope (36 m x 20 m x 12 m box, dorsal side on the port for docks, legs down for pads)
//     are box-tested against the station's meshes
// Run: node tools/verify-ports.mjs
import * as THREE from 'three';
import { SpaceMode } from '../src/space/index.js';
import { SpaceSim, R_EARTH, R_MOON } from '../src/space/sim.js';
import { getPorts, portsFor } from '../src/space/ports.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else if (process.env.VERBOSE) console.log('ok  ', msg); return c; };

const sim = new SpaceSim();
sim.syncFromHours(21);
sim.warp = 1;   // real time: the flight runs at 1x near a port
sim.step(0);
const space = { sim, targets: {}, realTime: 3.2 };
SpaceMode.prototype._defineTargets.call(space);
const BODIES = new Set(['earth', 'moon', 'sun', 'lodestar']);
let G = null;
if (!process.env.NO_GEOMETRY) {
  const t0 = performance.now();
  G = await buildScene(sim, space);
  console.log(`scene built headlessly in ${((performance.now() - t0) / 1000).toFixed(1)} s, ${G.meshes.length} candidate meshes`);
}

const ports = getPorts(space);
console.log(`${ports.length} ports over ${Object.keys(space.targets).length} targets`);
const ids = new Set();
for (const p of ports) { ok(!ids.has(p.id), `unique id ${p.id}`); ids.add(p.id); }
const rows = [];
for (const k of Object.keys(space.targets)) {
  const list = portsFor(space, k);
  if (!BODIES.has(k)) ok(list.length >= 1, `${k} has a port`);
  rows.push(`${k}:${list.length}`);
  ok(space.targets[k].ports === undefined || space.targets[k].ports === list.length, `${k} target.ports matches`);
}
console.log(rows.join(' '));

// ---- pose sanity and continuity
const out = {};
const pose = (p) => { const o = p.pose(space, {}); return { pos: o.pos.clone(), n: o.n.clone(), fwd: o.fwd.clone() }; };
const dt = 1 / 60;
let maxJump = 0, maxJumpId = '';
for (const p of ports) {
  ok(p.kind === 'dock' || p.kind === 'pad', `${p.id} kind`);
  ok(p.clear > 0 && p.approach > 0, `${p.id} clear/approach positive`);
  ok(typeof p.label === 'string' && p.label.length > 3, `${p.id} label`);
  const a = pose(p);
  const fin = [a.pos, a.n, a.fwd].every((v) => Number.isFinite(v.x + v.y + v.z));
  ok(fin, `${p.id} pose finite`);
  ok(Math.abs(a.n.length() - 1) < 1e-6 && Math.abs(a.fwd.length() - 1) < 1e-6, `${p.id} unit n, fwd`);
  ok(Math.abs(a.n.dot(a.fwd)) < 1e-6, `${p.id} n . fwd = 0 (${a.n.dot(a.fwd).toExponential(1)})`);
  const r = a.pos.length();
  if (r < 200000) ok(r > R_EARTH + 95, `${p.id} above the Earth keep-out (${(r - R_EARTH).toFixed(1)} km up)`);
  const dm = a.pos.distanceTo(sim.moonPos);
  if (p.kind === 'pad' && dm < R_MOON + 50) {
    const up = a.pos.clone().sub(sim.moonPos).normalize();
    ok(dm > R_MOON - 5 && dm < R_MOON + 12, `${p.id} pad on the Moon (${(dm - R_MOON).toFixed(3)} km)`);
    ok(up.dot(a.n) > 0.95, `${p.id} pad faces out of the Moon (${up.dot(a.n).toFixed(3)})`);
  }
}
// continuity: step the whole world one frame at a time
{
  const prev = new Map(), prevT = new Map();
  const tp = new THREE.Vector3();
  for (let f = 0; f < 90; f++) {
    for (const p of ports) {
      const a = pose(p);
      space.targets[p.target].position(tp);
      if (prev.has(p.id)) {
        const d = a.pos.clone().sub(prev.get(p.id));
        const dT = tp.clone().sub(prevT.get(p.id));
        const rel = d.sub(dT).length();       // motion relative to the target's own
        if (rel > maxJump) { maxJump = rel; maxJumpId = p.id; }
        ok(rel < 0.004, `${p.id} continuous (${(rel * 1000).toFixed(2)} m/frame relative)`);
      }
      prev.set(p.id, a.pos); prevT.set(p.id, tp.clone());
    }
    sim.step(dt); space.realTime += dt;
  }
}
console.log(`continuity: largest per-frame motion relative to the target ${(maxJump * 1000).toFixed(2)} m (${maxJumpId})`);

// ---- geometry: build the whole orbital scene headlessly (as tools/smoke-space-build.mjs) and
// box-test each port's corridor and mated envelope against the triangles of every mesh near it
if (G) {
  const g = G;
  const gports = getPorts(space);
  // three instants minutes apart: structure blocks a port at every one, moving traffic (shuttles
  // cycling through berths, cranes, carriers) only at some; a port clear at none is a failure
  const res = new Map();
  for (const step of [0, 420, 480]) {
    for (let k = 0; k < step; k++) { sim.step(1); space.realTime += 1; }
    g.refresh();
    for (const p of gports) {
      const r = boxTest(g, space, p);
      if (!res.has(p.id)) res.set(p.id, []);
      res.get(p.id).push(r);
    }
  }
  const tested = [], shared = [], skipped = [], failed = [];
  for (const p of gports) {
    const rs = res.get(p.id);
    if (rs.every((r) => !r)) { skipped.push(p.id); continue; }
    const clear = rs.filter((r) => r && r.corridor === 0 && r.envelope === 0).length;
    const worst = rs.find((r) => r && (r.corridor || r.envelope)) || rs[0];
    ok(clear > 0, `${p.id} corridor ${worst.corridor} / envelope ${worst.envelope} triangles at every instant${worst.what ? ' (' + worst.what + ')' : ''}`);
    ok(rs.some((r) => r && r.contact), `${p.id} structure within ${p.kind === 'pad' ? 3 : 8} m behind the face`);
    if (!clear) failed.push(p.id);
    else if (clear < rs.length) shared.push(`${p.id}(${worst.what})`);
    else tested.push(p.id);
  }
  console.log(`geometry-verified clear at every instant (${tested.length}): ${tested.join(' ')}`);
  if (shared.length) console.log(`clear, with traffic passing at times (${shared.length}): ${shared.join(' ')}`);
  if (failed.length) console.log(`geometry FAILED (${failed.length}): ${failed.join(' ')}`);
  if (skipped.length) console.log(`no headless geometry near (${skipped.length}): ${skipped.join(' ')}`);
}

async function buildScene(sim, space) {
  const { Elevator } = await import('../src/space/elevator.js');
  const { Hearth } = await import('../src/space/hearth.js');
  const { Fleet } = await import('../src/space/fleet.js');
  const { WorkingStations } = await import('../src/space/workingStations.js');
  const { GeoRoads } = await import('../src/space/geoRoads.js');
  const { ReleaseYard } = await import('../src/space/releaseYard.js');
  const { LowOrbit } = await import('../src/space/lowOrbit.js');
  const { GeoBelt } = await import('../src/space/geoBelt.js');
  const { Moon } = await import('../src/space/moon.js');
  const { Rings } = await import('../src/space/rings.js');
  const { HaloPorts } = await import('../src/space/stations.js');
  const { HALO_PORTS } = await import('../src/space/earthData.js');
  const { SunSwarm } = await import('../src/space/sun.js');
  const { LagrangeColonies } = await import('../src/space/lagrange.js');
  Object.assign(space, {
    scene: new THREE.Scene(), earthFixed: new THREE.Group(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e7), size: new THREE.Vector2(1280, 720),
    addBody(name, objects, center, radius, opts) { const b = { name, objects, center, radius, ...opts }; this.bodies.push(b); return b; },
  });
  space.scene.add(space.earthFixed);
  space.rings = new Rings(space, { ringSegs: 0.5 });
  space.earthFixed.add(space.rings.group);
  space.rings.districts.buildAll();
  space.ports = new HaloPorts(space, HALO_PORTS);
  space.elevator = new Elevator(space, { climbers: 20 });
  space.earthFixed.add(space.elevator.group);
  space.hearth = new Hearth(space, { bhSteps: 60, bhScale: 0.5 });
  space.scene.add(space.hearth.group);
  space.sunSwarm = new SunSwarm(space, { swarm: 500 });
  space.scene.add(space.sunSwarm.group);
  space.moon = new Moon(space);
  space.scene.add(space.moon.group);
  space.moon.ensureLife();
  space.moon.outposts.buildAll();
  const mods = [];
  for (const [k, C] of [['fleet', Fleet], ['works', WorkingStations], ['geoRoads', GeoRoads], ['releaseYard', ReleaseYard], ['lowOrbit', LowOrbit], ['lagrange', LagrangeColonies], ['geoBelt', GeoBelt]]) { space[k] = new C(space); mods.push(space[k]); }
  if (!space.lowOrbit.group.parent) space.scene.add(space.lowOrbit.group);
  space.fleet._linerDetail(null, true); space.fleet._seleneDetail(null, 0, true); space.fleet._tenderDetail(null, true);
  space.works.district.build(); space.works.yard.build(); space.works.swarm.build(); space.works.commons.build(); space.works.road.build();
  space.geoBelt.buildAll();
  const g = { meshes: [], refresh: () => collect(sim, space, mods, g) };
  g.refresh();
  return g;
}

/** Update every module at the current sim instant and gather the candidate meshes' world transforms. */
function collect(sim, space, mods, g) {
  const t = space.realTime;
  sim.step(0);
  space.earthFixed.quaternion.copy(sim.earthQuat); space.earthFixed.updateMatrixWorld(true);
  for (const m of [space.elevator, space.rings, space.ports, space.hearth, space.sunSwarm]) m.update(sim, t, 0.016, space);
  space.moon.update(sim, t);
  for (const m of mods) if (m.update) m.update(sim, t, 0.016, space);
  // the belt lets its stations go when the camera is far (the headless camera sits at the
  // Earth's centre): build them back for the test
  space.geoBelt.buildAll();
  space.scene.updateMatrixWorld(true);
  // candidate meshes: solid, indexed or not, with CPU positions; world bounding spheres
  const meshes = g.meshes = [];
  space.scene.traverse((o) => {
    if (!o.isMesh || !o.visible && false) return;
    const geo = o.geometry;
    if (!geo || !geo.attributes.position || geo.isInstancedBufferGeometry) return;
    const m = o.material;
    if (m && (m.blending === THREE.AdditiveBlending || m.depthWrite === false)) return;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const count = o.isInstancedMesh ? o.count : 1;
    for (let i = 0; i < count; i++) {
      const mw = o.matrixWorld.clone();
      if (o.isInstancedMesh) { const im = new THREE.Matrix4(); o.getMatrixAt(i, im); mw.multiply(im); }
      const c = geo.boundingSphere.center.clone().applyMatrix4(mw);
      const r = geo.boundingSphere.radius * mw.getMaxScaleOnAxis();
      if (!Number.isFinite(r) || r > 3000) continue;        // planets and sky shells
      meshes.push({ o, geo, mw, c, r, name: o.name || o.parent?.name || o.type });
    }
  });
}

/** Triangles of the scene inside a port's approach corridor and its mated envelope. */
function boxTest(g, space, p) {
  const a = p.pose(space, {});
  const M = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(a.n, a.fwd), a.n, a.fwd).setPosition(a.pos);
  const inv = M.clone().invert();
  const km = 0.001;
  const env = p.kind === 'pad'
    ? new THREE.Box3(new THREE.Vector3(-10 * km, 0.4 * km, -16 * km), new THREE.Vector3(10 * km, 12.4 * km, 20 * km))
    : new THREE.Box3(new THREE.Vector3(-10 * km, 0.6 * km, -22.3 * km), new THREE.Vector3(10 * km, 12.6 * km, 13.7 * km));
  const L = Math.min(p.approach, 3);
  const cor = new THREE.Box3(new THREE.Vector3(-15 * km, 25 * km, -15 * km), new THREE.Vector3(15 * km, L, 15 * km));
  const back = new THREE.Box3(new THREE.Vector3(-4 * km, -(p.kind === 'pad' ? 3 : 8) * km, -4 * km), new THREE.Vector3(4 * km, 0.05 * km, 4 * km));
  const reach = L + 0.05;
  const near = g.meshes.filter((m) => m.c.distanceTo(a.pos) < m.r + reach);
  if (process.env.DEBUG_PORT === p.id) console.log(p.id, a.pos.toArray().map((x) => x.toFixed(3)), near.map((m) => `${m.name}@${m.c.distanceTo(a.pos).toFixed(3)}/${m.r.toFixed(3)}`).slice(0, 12).join(" "));
  if (!near.length) return null;
  const tri = new THREE.Triangle(), va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  let corridor = 0, envelope = 0, contact = false, firstY = Infinity; const what = new Set();
  const ringR = (p.ringR || 7.5) * km;
  for (const m of near) {
    const T = inv.clone().multiply(m.mw);
    const pos = m.geo.attributes.position, idx = m.geo.index;
    const n = idx ? idx.count / 3 : pos.count / 3;
    const hw = m.o.name === 'dockCollars' || m.o.name === 'padPaint';
    for (let i = 0; i < n; i++) {
      const i0 = idx ? idx.getX(i * 3) : i * 3, i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1, i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
      va.fromBufferAttribute(pos, i0).applyMatrix4(T); vb.fromBufferAttribute(pos, i1).applyMatrix4(T); vc.fromBufferAttribute(pos, i2).applyMatrix4(T);
      if (Math.min(va.y, vb.y, vc.y) > L || Math.max(va.y, vb.y, vc.y) < -0.01) continue;
      if (Math.min(Math.abs(va.x), Math.abs(vb.x), Math.abs(vc.x)) > 0.03 && Math.sign(va.x) === Math.sign(vb.x) && Math.sign(vb.x) === Math.sign(vc.x)) continue;
      tri.set(va, vb, vc);
      if (!contact && back.intersectsTriangle(tri)) contact = true;
      if (hw) continue;
      // the port's own mating hardware (guides and petals round the ring, under 2.5 m proud of the face) interlocks with the ship's ring
      if (Math.max(va.y, vb.y, vc.y) < 2.5 * km && Math.max(Math.hypot(va.x, va.z), Math.hypot(vb.x, vb.z), Math.hypot(vc.x, vc.z)) < ringR) continue;
      if (env.intersectsTriangle(tri)) { envelope++; what.add(m.name); firstY = Math.min(firstY, va.y, vb.y, vc.y); }
      else if (cor.intersectsTriangle(tri)) { corridor++; what.add(m.name); firstY = Math.min(firstY, va.y, vb.y, vc.y); if (process.env.DEBUG_PORT === p.id && corridor < 6) console.log("hit", m.name, m.o.parent?.name, [va, vb, vc].map((v) => `(${(v.x * 1000).toFixed(0)},${(v.y * 1000).toFixed(0)},${(v.z * 1000).toFixed(0)})`).join(" ")); }
    }
  }
  return { corridor, envelope, contact, what: [...what].slice(0, 3).join(', ') + (firstY < Infinity ? `, from ${(Math.max(firstY, 0) * 1000).toFixed(0)} m out` : '') };
}

console.log(fails ? `${fails} FAILED` : 'all ports ok');
process.exit(fails ? 1 : 0);
