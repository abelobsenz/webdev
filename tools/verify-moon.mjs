// Headless checks for the Moon's settlements (Medii Landing, Medii Works, the Landing's
// traffic, the outposts): build timings, triangle budgets, finite transforms, footprints that
// must not overlap, clearances of the moving parts, seating, and per-frame update cost.
// Run from the repo root: node tools/verify-moon.mjs
import * as THREE from 'three';
import { buildMediiLanding, shoreV } from '../src/space/lunarLanding.js';
import { buildMediiWorks, RAIL_H, TRACK_X, ARRAY, TOWER_D, PAD_STACKS, YARD } from '../src/space/lunarWorks.js';
import { LunarTraffic } from '../src/space/lunarTraffic.js';
import { LunarOutposts, buildOutpost, townDir } from '../src/space/lunarOutposts.js';
import { kit, KIT_PARTS, KIT_R, TRACKER_AXLE } from '../src/space/lunarKit.js';
import { createLunarMaterial } from '../src/space/lunarMaterial.js';
import { surfaceY } from '../src/space/lunarSite.js';
import { TOWNS } from '../src/space/moonBake.js';
import { R_MOON } from '../src/space/sim.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };
const S2 = Math.SQRT1_2;
const toUV = (x, z) => [(x + z) * S2, (z - x) * S2];
const tris = (g) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const finiteGeo = (g) => g.getAttribute('position').array.every(Number.isFinite);
const inRect = (u, v, p, m = 0) => p.u0 !== undefined && u > p.u0 - m && u < p.u1 + m && v > p.v0 - m && v < p.v1 + m;
const rectsOverlap = (a, b) => a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1;
const report = {};

// ------------------------------------------------------------------ kit --
{
  const t0 = performance.now();
  for (const p of KIT_PARTS) { const g = kit(p); ok(finiteGeo(g), `kit ${p} finite`); ok(tris(g) > 20 && tris(g) < 6000, `kit ${p} triangles ${tris(g)}`); }
  report.kitMs = +(performance.now() - t0).toFixed(1);
  // parts stand on their origin (nothing but boulders below y = -0.05)
  for (const p of KIT_PARTS) if (!p.startsWith('boulder') && !['wheel', 'panel', 'sled', 'drone', 'launch', 'tram', 'trolley'].includes(p)) ok(kit(p).boundingBox.min.y > -1.3, `kit ${p} base at ${kit(p).boundingBox.min.y.toFixed(2)}`);
}

// ------------------------------------------------------------------ builds --
let t0 = performance.now();
const L = buildMediiLanding();
report.landingMs = Math.round(performance.now() - t0);
t0 = performance.now();
const W = buildMediiWorks(L.plan, L.driver, L.S.PADS);
report.worksMs = Math.round(performance.now() - t0);
t0 = performance.now();
const life = new LunarTraffic(L, { works: W });
report.trafficMs = Math.round(performance.now() - t0);
ok(finiteGeo(L.geo) && finiteGeo(W.geo), 'landing and works geometry finite');
report.landingTris = tris(L.geo); report.worksTris = tris(W.geo);

// ------------------------------------------------------------------ footprints --
{
  const hard = L.plan.filter((p) => p.u0 !== undefined);
  for (const w of W.plan) for (const p of hard) ok(!rectsOverlap(w, p), `works ${w.kind} overlaps landing ${p.kind} at ${Math.round(p.u0)},${Math.round(p.v0)}`);
  const big = W.plan.filter((p) => p.kind !== 'crater');
  for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
    const a = big[i], b = big[j];
    if ((a.kind === 'station' || b.kind === 'station') && (a.kind === 'array' || b.kind === 'array')) continue;
    ok(!rectsOverlap(a, b), `works ${a.kind} overlaps ${b.kind}`);
  }
  // hamlet roads and the town's pads vs the works
  for (const p of L.plan.filter((q) => q.kind === 'road')) for (const [u, v] of p.pts) for (const w of big) ok(!inRect(u, v, w, 4), `hamlet road through works ${w.kind}`);
}

// ------------------------------------------------------------------ the Fields Line --
{
  const PADS = L.S.PADS;
  const railUV = W.rail.pts.map((p) => toUV(p.x, p.z));
  let minPad = 1e9;
  for (const [u, v] of railUV) for (const [pu, pv] of PADS) minPad = Math.min(minPad, Math.hypot(u - pu, v - pv));
  ok(minPad > 276 + 20, `rail clears the blast walls (${minPad.toFixed(0)} m from a pad centre)`);
  for (const [u, v] of railUV) for (const p of L.plan) if (p.u0 !== undefined && ['house', 'dome', 'green', 'hamlet'].includes(p.kind)) ok(!inRect(u, v, p, 8), `rail over ${p.kind}`);
  // the driver's line: the rail never comes within 150 m of it (plan distance)
  const P0 = toUV(L.driver.P0.x, L.driver.P0.z), D = toUV(L.driver.dir.x, L.driver.dir.z); const dl = Math.hypot(...D); D[0] /= dl; D[1] /= dl;
  let minDrv = 1e9;
  for (const [u, v] of railUV) { const px = u - P0[0], pz = v - P0[1]; if (px * D[0] + pz * D[1] > -200) minDrv = Math.min(minDrv, Math.abs(px * D[1] - pz * D[0])); }
  ok(minDrv > 150, `rail clears the mass driver (${minDrv.toFixed(0)} m)`);
  // guideway height above the ground
  for (const p of W.rail.pts) ok(Math.abs(p.y - surfaceY(p.x, p.z) - RAIL_H) < 1e-6, 'guideway at RAIL_H');
  report.railKm = +(W.rail.s.at(-1) / 1000).toFixed(2);
}

// ------------------------------------------------------------------ the array --
{
  let minD = 1e9;
  const T = W.trackers;
  // neighbours on the grid: the pitch is fixed, check a sample exhaustively by bins
  const bins = new Map();
  T.forEach(([x, z], i) => { const k = `${Math.floor(x / 20)},${Math.floor(z / 20)}`; (bins.get(k) || bins.set(k, []).get(k)).push(i); });
  T.forEach(([x, z], i) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of bins.get(`${Math.floor(x / 20) + a},${Math.floor(z / 20) + b}`) || []) if (j !== i) minD = Math.min(minD, Math.hypot(T[j][0] - x, T[j][1] - z));
  });
  const sweep = Math.hypot(4.1, 2.05) * 2;
  ok(minD > sweep + 0.5, `trackers clear each other when turning (${minD.toFixed(2)} m vs ${sweep.toFixed(2)})`);
  // lowest panel corner above the ground for suns all round the sky
  const bb = kit('panel').boundingBox;
  const corners = [];
  for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) corners.push(new THREE.Vector3(x, y, z));
  let low = 1e9;
  const m = new THREE.Matrix4(), c = new THREE.Vector3();
  for (let el = -0.2; el <= 1.6; el += 0.1) for (let az = 0; az < 6.28; az += 0.4) {
    life.setPanels(new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)), true);
    for (const i of [0, 777, T.length - 1]) {
      life.panels.getMatrixAt(i, m);
      for (const q of corners) { c.copy(q).applyMatrix4(m); low = Math.min(low, c.y - surfaceY(c.x, c.z)); }
    }
  }
  ok(low > 0.5, `panels clear the ground at any sun (${low.toFixed(2)} m)`);
  ok(TRACKER_AXLE > 2.05 + 0.5, 'tracker axle high enough');
  report.trackers = T.length;
}

// ------------------------------------------------------------------ landers --
{
  const PADS = L.S.PADS;
  const hoppers = [[PADS[0][0] - 30, PADS[0][1] + 30], [PADS[2][0] + 40, PADS[2][1] - 20]];
  const S = life.slots;
  for (const s of S) {
    const [pu, pv] = PADS[s.k];
    ok(Math.hypot(s.u - pu, s.v - pv) + 13 < 248, `lander on pad ${s.k} inside the pad`);
    for (const [hu, hv] of hoppers) ok(Math.hypot(s.u - hu, s.v - hv) > 13 + 28 + 4, 'lander clear of a standing hopper');
  }
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) ok(Math.hypot(S[i].u - S[j].u, S[i].v - S[j].v) > 2 * 13 + 30, 'landers apart');
  // seated: parked landers' feet on the pad top (1.2 m above the sphere)
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  life.update(200, new THREE.Vector3(0, 0, 0), new THREE.Object3D(), new THREE.Vector3(0, 1, 0));   // (group matrices identity: camera at the site origin)
  for (const s of S.filter((q) => q.part === 'lander')) {
    life.landers.getMatrixAt(s.index, m); p.setFromMatrixPosition(m);
    const h = p.y - surfaceY(p.x, p.z) - 1.2;
    const cyc = LunarTraffic.landerCycle(200, s.phase).h;
    if (cyc === 0) ok(Math.abs(h) < 0.02, `lander seated (${h.toFixed(3)})`);
  }
  ok(kit('lander').boundingBox.min.y > -0.01 && kit('cargoLander').boundingBox.min.y > -0.01, 'lander footpads at the origin');
  // service towers: beside their craft, clear of its footpads and of every other craft; the
  // crews' circles pass outside the towers and inside the next craft's reach
  for (const [tx, tz] of W.towers) {
    const [tu, tv] = toUV(tx, tz);
    const own = S.reduce((b, s) => Math.min(b, Math.hypot(s.u - tu, s.v - tv)), 1e9);
    ok(Math.abs(own - TOWER_D) < 0.01, `tower ${own.toFixed(2)} m from its craft`);
    for (const s of S) if (Math.hypot(s.u - tu, s.v - tv) > TOWER_D + 1) ok(Math.hypot(s.u - tu, s.v - tv) > 13 + 3.2 + 4, 'tower clear of other craft');
    for (const s of S) { const d = Math.hypot(s.u - tu, s.v - tv); if (d < TOWER_D + 1) { const fp = [0, 1, 2, 3].map((k) => { const a = s.yaw + Math.PI / 4 + k * Math.PI / 2; return [s.x + Math.sin(a) * 11.5, s.z + Math.cos(a) * 11.5]; }); for (const [fx, fz] of fp) ok(Math.hypot(fx - tx, fz - tz) > 3.2 + 1.2, 'tower clear of the footpads'); } }
    const [pu, pv] = PADS.reduce((b, p) => (Math.hypot(p[0] - tu, p[1] - tv) < Math.hypot(b[0] - tu, b[1] - tv) ? p : b));
    ok(Math.hypot(tu - pu, tv - pv) + 3.2 < 214 - 8, 'tower inside the tugs\' circuit');
  }
  for (const c of life.crew) ok(c.r - 0.4 > TOWER_D + 3.2, 'crew circle outside the tower');
  for (let i = 0; i < S.length; i++) for (let j = 0; j < S.length; j++) if (i !== j) ok(Math.hypot(S[i].u - S[j].u, S[i].v - S[j].v) > 28 + 40 + 13 + 1, `crews of one craft clear of the next (${Math.hypot(S[i].u - S[j].u, S[i].v - S[j].v).toFixed(0)})`);
  // container stacks on the pads: inside the tugs' circuit, clear of the craft
  PADS.forEach(([pu, pv], k) => {
    const [su, sv] = PAD_STACKS[k];
    const r = Math.hypot(su, sv) + Math.hypot(4.5, 13.2);
    ok(r < 214 - 8.5, `pad ${k} stacks inside the tugs' circuit (${r.toFixed(0)})`);
    for (const s of S) ok(Math.hypot(pu + su - s.u, pv + sv - s.v) > 13 + 14 + 28, `pad ${k} stacks clear of craft and crews`);
  });
  // the yard's container rows between the gantry legs
  for (const [u] of W.stacks) ok(Math.abs(u - YARD.gantryU) + 1.3 < 30 - 1.4, 'yard stacks between the gantry legs');
  // tugs' circuit clears the parked craft
  for (const s of S) { const d = Math.hypot(s.u - PADS[s.k][0], s.v - PADS[s.k][1]); ok(Math.abs(d - 214) > 13 + 4 + 3, `tug circuit clears lander (${d.toFixed(0)})`); }
}

// ------------------------------------------------------------------ the driver's sled --
{
  const bb = kit('sled').boundingBox;
  ok(bb.max.x < 10 && bb.min.x > -10, `sled fits the coil opening in width (${bb.max.x.toFixed(2)})`);
  ok(bb.max.y < 23, `sled fits under the coil's top bar (${bb.max.y.toFixed(2)})`);
  // the sled body's underside above the guideway conduit (top 5.2 m over the axis)
  const g = kit('sled'), pos = g.getAttribute('position');
  let minOver = 1e9;
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i)) < 3) minOver = Math.min(minOver, pos.getY(i));
  ok(minOver > 5.2, `sled clears the conduit (${minOver.toFixed(2)})`);
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i)) < 8.05 && pos.getY(i) < 4.05) { ok(false, 'sled inside the beam'); break; }
}

// ------------------------------------------------------------------ motion: runs --
{
  const cam = new THREE.Vector3();
  const site = new THREE.Object3D(); site.updateMatrixWorld(true);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Vector3();
  const trees = L.trees;
  const blocks = L.plan.filter((r) => r.u0 !== undefined && ['house', 'dome', 'colonnade', 'ferry', 'pad', 'market'].includes(r.kind));
  let walkBad = 0, rovBad = 0, tramBad = 0, gapMin = 1e9, haulGap = 1e9;
  const railUV = W.rail.pts.map((r) => toUV(r.x, r.z));
  for (let k = 0; k < 60; k++) {
    const t = k * 37.3 + 5;
    cam.set(0, 0.2, 1.6);                                     // inside the town, everything in range (km)
    life.update(t, cam, site, new THREE.Vector3(0.3, 0.8, 0.5).normalize());
    // townspeople clear of trunks and buildings
    for (let i = 0; i < life.walks.length; i += 3) {
      life.walkers.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      if (!Number.isFinite(p.x + p.y + p.z)) { walkBad++; continue; }
      const [u, v] = toUV(p.x, p.z);
      if (blocks.some((r) => inRect(u, v, r, 0.3))) walkBad++;
      for (const tr of trees) if (Math.abs(tr.u - u) < 2 && Math.abs(tr.v - v) < 2 && Math.hypot(tr.u - u, tr.v - v) < Math.max(0.35, tr.r * 0.12) / 2 + 0.35) walkBad++;
    }
    // rovers on their roads (plan distance to the road's centreline within its half-width)
    for (let i = 0; i < life.riders.length; i++) {
      life.rovers.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      const P = life.roads[life.riders[i].ri].path;
      let dmin = 1e9;
      for (let j = 0; j < P.p.length - 1; j++) {
        const a = P.p[j], b = P.p[j + 1];
        const ab = q.copy(b).sub(a); const tt = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.z - a.z) * ab.z) / (ab.x * ab.x + ab.z * ab.z)));
        dmin = Math.min(dmin, Math.hypot(a.x + ab.x * tt - p.x, a.z + ab.z * tt - p.z));
      }
      if (dmin > 4.1) rovBad++;
    }
    // runabouts on the streets, never inside a building
    for (let i = 0; i < life.carts.length; i++) {
      life.cartMesh.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      const [u, v] = toUV(p.x, p.z);
      if (blocks.some((r) => inRect(u, v, r, 1.4))) rovBad++;
    }
    // trains on their tracks, cars apart
    for (let i = 0; i < 8; i++) {
      life.trams.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      const [u, v] = toUV(p.x, p.z);
      let dmin = 1e9;
      for (let j = 0; j < railUV.length - 1; j++) {
        const [a0, b0] = railUV[j], [a1, b1] = railUV[j + 1], du = a1 - a0, dv = b1 - b0;
        const tt = Math.max(0, Math.min(1, ((u - a0) * du + (v - b0) * dv) / (du * du + dv * dv)));
        dmin = Math.min(dmin, Math.hypot(a0 + du * tt - u, b0 + dv * tt - v));
      }
      if (Math.abs(dmin - TRACK_X) > 0.3) tramBad++;
      if (i % 4) { life.trams.getMatrixAt(i - 1, m); q.setFromMatrixPosition(m); gapMin = Math.min(gapMin, p.distanceTo(q)); }
    }
    for (let i = 0; i < 9; i++) { life.haulers.getMatrixAt(i, m); p.setFromMatrixPosition(m); life.haulers.getMatrixAt((i + 1) % 9, m); q.setFromMatrixPosition(m); haulGap = Math.min(haulGap, p.distanceTo(q)); }
  }
  // street lamps and kiosks: out of the buildings, clear of the trunks
  let furnBad = 0;
  for (const mm of [...life.streetPosts, ...life.kioskMats]) {
    p.setFromMatrixPosition(mm);
    const [u, v] = toUV(p.x, p.z);
    if (blocks.some((r) => inRect(u, v, r, 0.7))) furnBad++;
    for (const tr of trees) if (Math.hypot(tr.u - u, tr.v - v) < 2.2) furnBad++;
  }
  ok(furnBad === 0, `street furniture clear (${furnBad} bad)`);
  report.streetLamps = life.streetPosts.length; report.kiosks = life.kioskMats.length;
  ok(walkBad === 0, `townspeople clear of trunks and buildings (${walkBad} bad)`);
  ok(rovBad === 0, `rovers on their roads (${rovBad} off)`);
  ok(tramBad === 0, `trains on their tracks (${tramBad} off)`);
  ok(gapMin > 24.4, `train cars do not overlap (${gapMin.toFixed(2)} m between centres)`);
  ok(haulGap > 20, `haulers keep their distance (${haulGap.toFixed(1)})`);
  // the timetable: trains stop at each station
  const stops = life.railStops;
  for (const s of stops) { let hit = false; for (let t = 0; t < life.railCycle; t += 2) if (Math.abs(life.trainAt(t).s - s) < 0.01) { hit = true; break; } ok(hit, `trains call at ${s.toFixed(0)}`); }
  report.railCycleMin = +(life.railCycle / 60).toFixed(1);
  // every instance matrix finite
  life.group.traverse((o) => { if (o.isInstancedMesh) ok(o.instanceMatrix.array.every(Number.isFinite), `${o.name} matrices finite`); });
}

// ------------------------------------------------------------------ per-frame cost --
{
  const site = new THREE.Object3D(); site.updateMatrixWorld(true);
  const cam = new THREE.Vector3(0, 0.2, 1.6), sun = new THREE.Vector3(0.3, 0.8, 0.5).normalize();
  for (let i = 0; i < 60; i++) life.update(i / 60, cam, site, sun);
  const N = 300;
  t0 = performance.now();
  for (let i = 0; i < N; i++) life.update(100 + i / 60, cam, site, sun);
  report.updateMsNear = +((performance.now() - t0) / N).toFixed(3);
  cam.set(0, 400, 0);
  t0 = performance.now();
  for (let i = 0; i < N; i++) life.update(100 + i / 60, cam, site, sun);
  report.updateMsFar = +((performance.now() - t0) / N).toFixed(4);
  ok(report.updateMsNear < 0.3, `traffic update ${report.updateMsNear} ms (camera in the town, everything live)`);
}

// ------------------------------------------------------------------ outposts --
{
  const g = new THREE.Group();
  const O = new LunarOutposts(g);
  t0 = performance.now();
  O.buildAll();
  report.outpostsMs = Math.round(performance.now() - t0);
  report.outposts = O.sites.length;
  let uniq = 0, inst = 0;
  O.sites.forEach((s, i) => {
    const d = s.data;
    uniq += tris(d.geo);
    ok(finiteGeo(d.geo), `outpost ${i} geometry finite`);
    const P = d.plan.filter((p) => p.kind !== 'crater');
    for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) ok(Math.hypot(P[a].x - P[b].x, P[a].z - P[b].z) > P[a].r + P[b].r - 1e-6, `outpost ${i}: ${P[a].kind} overlaps ${P[b].kind}`);
    for (const [part, list] of Object.entries(d.inst)) { inst += list.length * tris(kit(part)); for (const e of list) ok(e.m.elements.every(Number.isFinite), `outpost ${i} ${part} finite`); }
    ok(d.loops.length >= 1, `outpost ${i} has roads`);
    // craft on their fields: inside the apron, apart, the shuttle's centre spot kept clear
    for (const [x, z] of d.parked) ok(d.pads.some(([px, pz]) => Math.hypot(px - x, pz - z) + 13 < 95), `outpost ${i} craft on a field`);
    for (let a = 0; a < d.parked.length; a++) for (let b = a + 1; b < d.parked.length; b++) ok(Math.hypot(d.parked[a][0] - d.parked[b][0], d.parked[a][1] - d.parked[b][1]) > 13 + 13 + 5, `outpost ${i} craft apart`);
    if (d.cycler) for (const [x, z] of d.parked) ok(Math.hypot(d.cycler[0] - x, d.cycler[1] - z) > 13 + 27 + 13, `outpost ${i} shuttle spot clear of crews`);
  });
  // no two outposts (or an outpost and Medii Landing) overlap on the sphere
  const dirs = TOWNS.map(([la, lo]) => townDir(la, lo));
  for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) ok(dirs[i].angleTo(dirs[j]) * R_MOON > 10, `towns ${i} and ${j} apart`);
  // runtime: rovers moving, one build per frame on approach
  const cam = new THREE.Vector3();
  O.sites[0].group.updateMatrixWorld(true);
  O.sites[0].group.getWorldPosition(cam); cam.multiplyScalar(1 + 2 / R_MOON);
  g.updateMatrixWorld(true);
  t0 = performance.now();
  for (let i = 0; i < 200; i++) O.update(i / 30, cam, null, 1080);
  report.outpostUpdateMs = +((performance.now() - t0) / 200).toFixed(4);
  ok(report.outpostUpdateMs < 0.1, `outposts update ${report.outpostUpdateMs} ms`);
  report.outpostUniqueTris = uniq; report.outpostInstancedTris = inst;
}

// ------------------------------------------------------------------ budgets --
{
  let inst = 0;
  life.group.traverse((o) => { if (o.isInstancedMesh) inst += o.count * tris(o.geometry); });
  report.lifeInstancedTris = inst;
  const unique = report.landingTris + report.worksTris + report.outpostUniqueTris;
  report.uniqueTris = unique;
  ok(unique < 4.0e6, `unique lunar geometry ${unique} triangles`);
  ok(inst + report.landingTris + report.worksTris < 9e6, 'Medii Landing rendered triangles within budget');
  ok(report.worksMs + report.trafficMs < 1000, `works and traffic build ${report.worksMs + report.trafficMs} ms`);
}

// ------------------------------------------------------------------ shaders (static) --
{
  const m = createLunarMaterial();
  const vs = m.vertexShader, fs = m.fragmentShader;
  for (const v of ['vFac', 'vView', 'vN', 'vTint']) ok(vs.includes(`varying vec3 ${v};`) && fs.includes(`varying vec3 ${v};`), `varying ${v} in both stages`);
  for (const u of fs.matchAll(/uniform \w+ (\w+);/g)) ok(u[1] in m.uniforms, `uniform ${u[1]} supplied`);
  const depth = [...fs].reduce((d, ch) => (d < 0 ? d : d + (ch === '{') - (ch === '}')), 0);
  ok(depth === 0, 'lunar fragment shader braces balance');
  ok(!/fwidth|dFdx|dFdy/.test(fs.slice(fs.indexOf('} else if (k < 29.5)'))), 'no derivatives in the new branches');
}

console.log(JSON.stringify(report));
if (fails) { console.log(`VERIFY_MOON_FAILED ${fails}`); process.exit(1); }
console.log('VERIFY_MOON_OK');
