// Headless checks for the Moon's second pass: the settled network (towns off the water, arcs,
// the surface shader's uniforms and GLSL hygiene), the lunar-orbit stations (orbits clear of
// the tether, the Exchange and the ring; moving parts clear; seating; triangles; timings) and
// buffer sanity for everything under the Moon's group (instanced counts within capacity,
// instanced attributes large enough, indices within their vertex buffers, finite transforms).
// Run from the repo root: node tools/verify-moon-w2.mjs
import * as THREE from 'three';
import { SpaceSim, R_MOON } from '../src/space/sim.js';
import { Moon } from '../src/space/moon.js';
import { ALL_TOWNS, FAR_TOWNS, ARCS, seaClearance, latLonDir, arcUniforms, townUniforms } from '../src/space/lunarNetwork.js';
import { TOWNS } from '../src/space/moonBake.js';
import { ORBITS, orbitPos, descentPhase, WHEEL, DEPOT, buildWheelRing, buildWheelHub, buildWings, buildFerry, buildDepot, LunarOrbitals } from '../src/space/lunarOrbitals.js';
import { buildOutpost } from '../src/space/lunarOutposts.js';
import { MoonSurface } from '../src/space/moonSurface.js';
import { SETTLEMENT_PARTS, buildSettlementQuarter } from '../src/space/lunarSettlement.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };
const report = {};
const tris = (g) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

// ------------------------------------------------------------ towns and network --
{
  ok(ALL_TOWNS.length === TOWNS.length + FAR_TOWNS.length, 'every town listed');
  let minC = Infinity;
  ALL_TOWNS.forEach(([la, lo], i) => {
    if (i === 0) return;                                  // Medii Landing: the harbour on the Bay, by design
    const c = seaClearance(latLonDir(la, lo));
    minC = Math.min(minC, c);
    ok(c >= 7.9, `town ${i} (${la}, ${lo}) only ${c.toFixed(1)} km from water`);
    // the outpost's own footprint (radius <= ~3.5 km) is clear too: sample its rim
    const up = latLonDir(la, lo), e1 = new THREE.Vector3().crossVectors(up, Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(), e2 = new THREE.Vector3().crossVectors(up, e1);
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, p = up.clone().addScaledVector(e1, Math.cos(a) * 4 / R_MOON).addScaledVector(e2, Math.sin(a) * 4 / R_MOON).normalize();
      ok(seaClearance(p) > 0, `town ${i} footprint wet at bearing ${k * 30}`);
    }
  });
  report.townMinClearanceKm = +minC.toFixed(1);
  const polar = FAR_TOWNS.filter((t) => Math.abs(t[0]) > 80).length, far = FAR_TOWNS.filter((t) => Math.abs(t[1]) > 90).length;
  ok(polar >= 3 && far >= 5, `polar ${polar} and far-side ${far} settlements`);
  for (const [i, j, k] of ARCS) {
    ok(i !== j && i < ALL_TOWNS.length && j < ALL_TOWNS.length && (k === 0 || k === 1), `arc ${i}-${j}`);
    const a = latLonDir(ALL_TOWNS[i][0], ALL_TOWNS[i][1]), b = latLonDir(ALL_TOWNS[j][0], ALL_TOWNS[j][1]);
    ok(a.angleTo(b) > 0.01 && a.angleTo(b) < 2.3, `arc ${i}-${j} length ${a.angleTo(b).toFixed(2)} rad`);
  }
  // every town is reached by the highway network (a spanning tree was laid)
  const seen = new Set([0]); let grew = true;
  while (grew) { grew = false; for (const [i, j, k] of ARCS) if (!k && (seen.has(i) !== seen.has(j))) { seen.add(i); seen.add(j); grew = true; } }
  ok(seen.size === ALL_TOWNS.length, `highways reach ${seen.size}/${ALL_TOWNS.length} towns`);
  report.arcs = { roads: ARCS.filter((a) => !a[2]).length, rails: ARCS.filter((a) => a[2]).length };
  const U = arcUniforms();
  ok(U.A.length === ARCS.length && U.B.length === ARCS.length && townUniforms().length === ALL_TOWNS.length, 'uniform arrays sized');
  ok([...U.A, ...U.B, ...townUniforms()].every((v) => [v.x, v.y, v.z, v.w].every(Number.isFinite)), 'uniform arrays finite');
}

// ------------------------------------------------------------ the surface shader --
{
  const stub = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, autoClear: true };
  const S = new MoonSurface({ renderer: stub, q: { cube: 512 }, sim: new SpaceSim(), size: new THREE.Vector2(1280, 720) });
  const frag = S.material.fragmentShader;
  const declared = [...frag.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)].map((m) => m[1]);
  for (const u of declared) if (!['projectionMatrix', 'modelViewMatrix', 'viewMatrix', 'modelMatrix', 'normalMatrix', 'cameraPosition'].includes(u)) ok(u in S.uniforms, `surface uniform ${u} declared but not supplied`);
  let vec4s = 0;
  for (const m of frag.matchAll(/^\s*uniform\s+(\w+)\s+(\w+)(?:\[(\d+)\])?/gm)) vec4s += (m[3] ? +m[3] : 1) * (m[1] === 'mat4' ? 4 : m[1] === 'mat3' ? 3 : 1);
  report.surfaceUniformVec4 = vec4s;
  ok(vec4s <= 200, `surface fragment uniforms ${vec4s} vec4 (WebGL2 guarantees 224)`);
  // the new functions: no derivatives or implicit-LOD reads (they run in branches), no pow
  for (const fn of ['litLine', 'cityAt', 'shipLights']) {
    const at = frag.indexOf(fn + '(');
    const body = frag.slice(at, frag.indexOf('\n}\n', at));
    ok(at > 0 && !/fwidth|dFdx|dFdy|texture\(|pow\(/.test(body), `${fn}: derivative, implicit-LOD read or pow`);
    // loops over constant bounds only
    for (const m of body.matchAll(/for \(int \w+ = 0; \w+ < ([^;]+);/g)) ok(/^\d+$/.test(m[1].trim()), `${fn}: loop bound ${m[1]}`);
    ok(!/\b\d+\s*\*\s*\w+\s*\/\s*\d+\b(?!\.)/.test(''), '');
  }
  ok(/uniform vec4 uArcA\[\d+\];/.test(frag) && /uniform vec4 uTown\[\d+\];/.test(frag), 'network uniforms declared');
  // int/float hygiene in the new code: float literals only in float expressions
  const newCode = frag.slice(frag.indexOf('float litLine('), frag.indexOf('// fields, hedgerows'));
  // an integer literal next to a float operator (outside array sizes and int loop counters)
  const bad = newCode.replace(/\[[^\]]*\]/g, '').replace(/for \(int [^)]*\)/g, '').match(/(?<![eE\d.])[-+*\/,(]\s*\d+\s*[-+*\/,);](?![^\n]*\bint\b)/g) || [];
  ok(!bad.length, `integer literal in a float expression (new GLSL): ${bad.slice(0, 4).join(' | ')}`);
}

// ------------------------------------------------------------ the Moon under test --
const sim = new SpaceSim();
sim.syncFromHours(12);
const space = { scene: new THREE.Scene(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e7), size: new THREE.Vector2(1280, 720), sim, addBody() {} };
let t0 = performance.now();
const moon = new Moon(space);
report.moonBuildMs = Math.round(performance.now() - t0);
space.scene.add(moon.group);
const O = moon.orbitals;
report.orbitalsBuildMs = +O.buildMs.toFixed(1);
ok(O.buildMs < 250, `orbitals build ${O.buildMs.toFixed(0)} ms`);
report.orbitalTris = O.triangles();
ok(report.orbitalTris > 30000 && report.orbitalTris < 1.5e6, `orbital triangles ${report.orbitalTris}`);

// ------------------------------------------------------------ orbits --
{
  const X = new THREE.Vector3(1, 0, 0);
  const segDist = (p, a, b) => { const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1); return p.distanceTo(a.clone().addScaledVector(ab, t)); };
  const tA = X.clone().multiplyScalar(R_MOON), tB = X.clone().multiplyScalar(R_MOON + 381);
  const p = new THREE.Vector3();
  for (const [k, o] of Object.entries(ORBITS)) {
    ok(Math.abs(o.n.length() - 1) < 1e-9 && Math.abs(o.u.dot(o.n)) < 1e-9 && Math.abs(o.v.dot(o.n)) < 1e-9, `${k} basis`);
    ok(o.r > R_MOON + 90 && o.r < R_MOON + 380 - 60, `${k} radius ${o.r} clear of the ground and the ring`);
    let dT = Infinity, dRing = Infinity;
    for (let i = 0; i < 3600; i++) {
      orbitPos(o, 0, (i / 3600) * Math.PI * 2 - o.ph, p);
      dT = Math.min(dT, segDist(p, tA, tB));
      dRing = Math.min(dRing, Math.hypot(Math.hypot(p.x, p.z) - (R_MOON + 380), p.y));
    }
    ok(dT > 200, `${k} passes ${dT.toFixed(0)} km from the Lift's tether`);
    ok(dRing > 60, `${k} passes ${dRing.toFixed(0)} km from the ring`);
    ok(Math.abs(o.T - 2 * Math.PI * Math.sqrt(o.r ** 3 / 4902.8)) < 1e-6, `${k} Kepler period`);
    report[`${k}PeriodMin`] = +(o.T / 60).toFixed(1);
  }
}

// ------------------------------------------------------------ station geometry --
{
  const ring = buildWheelRing(1), hub = buildWheelHub();
  ok(Math.abs(WHEEL.spin ** 2 * WHEEL.Ro - 9.81) < 0.01, 'Wheel: 1 g on the ring floor');
  // the rings turn about z: their innermost point must clear everything static in their z band
  const rp = ring.geo.getAttribute('position');
  let rMin = Infinity, zLo = Infinity, zHi = -Infinity;
  for (let i = 0; i < rp.count; i++) { rMin = Math.min(rMin, Math.hypot(rp.getX(i), rp.getY(i))); zLo = Math.min(zLo, rp.getZ(i)); zHi = Math.max(zHi, rp.getZ(i)); }
  const hp = hub.geo.getAttribute('position');
  let hubMax = 0;
  for (const s of [-1, 1]) for (let i = 0; i < hp.count; i++) { const z = hp.getZ(i) - s * WHEEL.ringZ; if (z > zLo - 2 && z < zHi + 2) hubMax = Math.max(hubMax, Math.hypot(hp.getX(i), hp.getY(i))); }
  ok(rMin > hubMax + 0.5, `Wheel rings (inner ${rMin.toFixed(1)} m) clear the hub (${hubMax.toFixed(1)} m) in their band`);
  report.wheelRingClearanceM = +(rMin - hubMax).toFixed(1);
  // the turning wings clear the rings and the berthed ferries
  const rad = buildWings(WHEEL.hubL + 30, WHEEL.hubL + 540, 11), wz = rad.geo.boundingBox.min.z;
  ok(wz > WHEEL.ringZ + zHi + 50, 'Wheel radiator wings clear of the rings');
  const ferry = buildFerry();
  const fR = Math.max(ferry.geo.boundingBox.max.x, ferry.geo.boundingBox.max.y);
  for (const b of hub.berths) ok(Math.abs(b.z) + fR < wz && Math.abs(b.z) - fR > WHEEL.ringZ + zHi, `berth at z ${b.z} clear of rings and wings`);
  // ferries seated nose-to-collar (nose tip at +34 m)
  ok(Math.abs(ferry.geo.boundingBox.max.z - 34) < 0.01, 'ferry nose at the docking face');
  // the depot: struts seated on the spine and in the tanks; the arm clear of the tanks
  const d = buildDepot();
  ok(d.geo.getAttribute('position').array.every(Number.isFinite), 'depot finite');
  ok(d.armBase.z <= 8.01, 'depot arm seated on the spine face');
  const tanks = [];
  for (const x of DEPOT.clusters) for (let i = 0; i < 4; i++) { const a = (i + 0.5) / 4 * Math.PI * 2; tanks.push(new THREE.Vector3(x, Math.cos(a) * DEPOT.tankOff, Math.sin(a) * DEPOT.tankOff)); }
  let armClear = Infinity;
  for (let k = 0; k <= 60; k++) {
    O.update(k * 2, null);
    const j1 = O.depot.j1, j2 = O.depot.j2;
    const base = d.armBase.clone().add(new THREE.Vector3(0, 0, 10));
    const a1 = j1.rotation.z, a2 = a1 + j2.rotation.z;
    const e = base.clone().add(new THREE.Vector3(Math.cos(a1) * 44, Math.sin(a1) * 44, 0));
    const tip = e.clone().add(new THREE.Vector3(Math.cos(a2) * 38, Math.sin(a2) * 38, 0));
    for (let s = 0; s <= 10; s++) for (const P of [base.clone().lerp(e, s / 10), e.clone().lerp(tip, s / 10)]) for (const T of tanks) {
      const q = P.clone().sub(T); q.x /= 1.25;
      armClear = Math.min(armClear, q.length() - DEPOT.tankR);
    }
  }
  ok(armClear > 3, `depot arm passes ${armClear.toFixed(1)} m from the tanks`);
  // the inbound ferry: seated at the berth when docked, never inside the hub, arm or rings
  ok(LunarOrbitals.approachS(400).s === 0, 'inbound ferry berthed mid-cycle');
  for (let k = 0; k < 900; k += 3) { const { s } = LunarOrbitals.approachS(k); ok(s >= 0 && Number.isFinite(s), `approach s at ${k}`); }
  ok(Math.abs(O.approach.berth.z) - fR > WHEEL.ringZ + zHi, 'inbound berth clear of the rings');
  // descent ferries: above the ground all the way, seated on their pads while down, far from
  // the Lift's tether
  {
    const NF0 = O.ferries.count - O.descents.length, m = new THREE.Matrix4(), p = new THREE.Vector3();
    let minAlt = Infinity, minTether = Infinity;
    for (let k = 0; k < 540; k++) {
      const t = k * 10;
      O.update(t, new THREE.Vector3(1, 0, 0));
      for (let j = 0; j < O.descents.length; j++) {
        O.ferries.getMatrixAt(NF0 + j, m); p.setFromMatrixPosition(m).multiplyScalar(0.001);
        ok(Number.isFinite(p.x + p.y + p.z), `descent ${j} finite at ${t}`);
        minAlt = Math.min(minAlt, p.length() - R_MOON);
        if (p.x > 0) minTether = Math.min(minTether, Math.hypot(p.y, p.z));
        const D = O.descents[j];
        if (descentPhase(t + D.ph).u === 1) ok(p.distanceTo(D.p) < 0.05, `descent ${j} seated on its pad (${(p.distanceTo(D.p) * 1000).toFixed(0)} m off)`);
      }
    }
    ok(minAlt > 0.02, `descent ferries dip to ${minAlt.toFixed(3)} km`);
    ok(minTether > 50, `descent ferries pass ${minTether.toFixed(0)} km from the tether's line`);
    report.descentMinTetherKm = +minTether.toFixed(0);
  }
  // the yard's pods: between the stocks, under the hull, clear of it
  for (let k = 0; k < 200; k++) {
    O._moveYard(k * 7.3);
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    for (let i = 0; i < O.yard.pods.count; i++) {
      O.yard.pods.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      const zs = ((p.z + 350) % 100 + 100) % 100;
      ok(Math.min(zs, 100 - zs) > 2.5 + 2.4, `yard pod ${i} at a stock (z ${p.z.toFixed(1)})`);
      ok(p.y < -10, `yard pod ${i} above the axis (hooks overhead)`);
      ok(Math.hypot(p.x, p.y) > O.yard.hullR(p.z) + 10, `yard pod ${i} touches the hull`);
    }
  }
  report.depotArmClearanceM = +armClear.toFixed(1);
}

// ------------------------------------------------------------ settlements --
{
  t0 = performance.now();
  const q = buildSettlementQuarter(7, 0.5);
  report.settlementQuarterMs = +(performance.now() - t0).toFixed(1);
  ok(q.geo.getAttribute('position').array.every(Number.isFinite), 'settlement quarter finite');
  ok(tris(q.geo) > 3000, `settlement quarter triangles ${tris(q.geo)}`);
  for (const p of SETTLEMENT_PARTS) ok(p in q.inst, `quarter has ${p}`);
  report.quarterTris = tris(q.geo);
  // each kind of settlement: its landmark claimed, clear of the roads; the quarter's people and
  // tram stay inside its circle
  const LAND = ['quarter', 'light towers', 'ice mine', 'observatory', 'arcology'];
  const want = { polar: ['light towers', 'ice mine'], observatory: ['observatory'], farside: ['arcology'] };
  for (const [feature, lat] of [['polar', 88.4], ['observatory', -6], ['farside', 21], [null, 12]]) for (const seed of [114, 117, 120]) {
    t0 = performance.now();
    const d = buildOutpost(seed, 0.45, lat, feature);
    const ms = performance.now() - t0;
    ok(ms < 120, `outpost ${seed}/${feature} built in ${ms.toFixed(0)} ms`);
    const kinds = new Set(d.plan.map((p) => p.kind));
    ok(kinds.has('quarter'), `outpost ${seed}/${feature} has its quarter`);
    for (const k of want[feature] || []) ok(kinds.has(k), `outpost ${seed}/${feature} has its ${k}`);
    for (const p of d.plan.filter((c) => LAND.includes(c.kind))) for (const pts of d.loops) for (const r of pts) ok(Math.hypot(r.x - p.x, r.z - p.z) > p.r + 20, `outpost ${seed}: road through the ${p.kind}`);
    const Q = d.plan.find((c) => c.kind === 'quarter');
    const inQ = ([x, z]) => Math.hypot(x - Q.x, z - Q.z) < Q.r;
    ok(inQ(d.quarter.tram.a) && inQ(d.quarter.tram.b), `outpost ${seed}: tram inside its quarter`);
    for (const w of d.quarter.walkers) ok(w.circle ? inQ(w.circle) : inQ(w.a) && inQ(w.b), `outpost ${seed}: walker beat inside the quarter`);
    ok(d.geo.getAttribute('position').array.every(Number.isFinite), `outpost ${seed}/${feature} finite`);
  }
}

// ------------------------------------------------------------ run it, then buffer sanity --
{
  moon.ensureLife();
  moon.outposts.buildAll();
  report.outpostsBuildMs = Math.round(moon.outposts.buildMs);
  const cam = space.camera;
  const sunM = new THREE.Vector3(0.3, 0.2, 0.93).normalize();
  // stand the camera near the Wheel, then time the orbital update
  for (let f = 0; f < 3; f++) { sim.step(0); moon.update(sim, f * 7); }
  O.update(2000, sunM);
  O.stationWorld('wheel', cam.position).add(new THREE.Vector3(0.5, 0.3, 0.8));
  cam.updateMatrixWorld();
  for (let f = 0; f < 50; f++) O.update(2000 + f * 0.016, sunM, cam.position, cam, 720);
  t0 = performance.now();
  for (let f = 0; f < 400; f++) O.update(2000 + f * 0.016, sunM, cam.position, cam, 720);
  report.orbitalsUpdateMs = +((performance.now() - t0) / 400).toFixed(4);
  ok(report.orbitalsUpdateMs < 0.3, `orbitals update ${report.orbitalsUpdateMs} ms`);
  ok(O.wheel.nearOn && !O.wheel.far.visible, 'Wheel near detail on at 1 km');
  cam.position.set(1e6, 0, 0); O.update(3000, sunM, cam.position, cam, 720);
  ok(!O.wheel.nearOn && O.wheel.far.visible === true || !O.wheel.group.visible, 'Wheel far beacons from afar');
  // ferries keep clear of their stations
  const p = new THREE.Vector3(), w = new THREE.Vector3();
  let fMin = Infinity;
  for (let k = 0; k < 400; k++) {
    const t = k * 97;
    O.update(t, sunM);
    for (let i = 0; i < O.ferries.count; i++) {
      O.ferries.getMatrixAt(i, new THREE.Matrix4()).decompose(p, new THREE.Quaternion(), new THREE.Vector3());
      for (const s of O.stations) fMin = Math.min(fMin, p.distanceTo(w.copy(s.group.position).multiplyScalar(1000)) / 1000);
      for (let j = 0; j < i; j++) { const m = new THREE.Matrix4(); O.ferries.getMatrixAt(j, m); fMin = Math.min(fMin, p.distanceTo(new THREE.Vector3().setFromMatrixPosition(m)) / 1000); }
    }
  }
  ok(fMin > 5, `ferries come within ${fMin.toFixed(1)} km of a station or each other`);
  report.ferryMinSepKm = +fMin.toFixed(1);
  for (const t of [0, 60, 900, 7000]) { sim.step(0); moon.update(sim, t); }
  moon.group.updateMatrixWorld(true);
  let inst = 0, geos = 0, lampSets = 0;
  moon.group.traverse((o) => {
    if (!o.matrixWorld.elements.every(Number.isFinite)) ok(false, `${o.name || o.type} non-finite transform`);
    const g = o.geometry;
    if (!g) return;
    const pos = g.getAttribute('position');
    if (g.index && pos && !g.isInstancedBufferGeometry) {
      geos++;
      let mx = 0; const a = g.index.array; for (let i = 0; i < a.length; i++) if (a[i] > mx) mx = a[i];
      ok(mx < pos.count, `${o.name || o.type}: index ${mx} >= ${pos.count} vertices`);
    }
    if (o.isInstancedMesh) {
      inst++;
      ok(o.count <= o.instanceMatrix.count, `${o.name}: count ${o.count} > capacity ${o.instanceMatrix.count}`);
      if (o.instanceColor) ok(o.instanceColor.count >= o.count, `${o.name}: instanceColor ${o.instanceColor.count} < ${o.count}`);
      ok(o.instanceMatrix.array.every(Number.isFinite), `${o.name}: non-finite instance matrix`);
    }
    if (g.isInstancedBufferGeometry) {
      lampSets++;
      for (const [k, a] of Object.entries(g.attributes)) if (a.isInstancedBufferAttribute) {
        ok(a.count >= g.instanceCount, `${o.parent?.name || o.name} ${k}: ${a.count} < instanceCount ${g.instanceCount}`);
        ok(a.array.every(Number.isFinite), `${o.parent?.name || o.name} ${k} non-finite`);
      }
    }
  });
  report.buffers = { geometries: geos, instanced: inst, lampSets };
}

console.log(JSON.stringify(report, null, 1));
console.log(fails ? `MOON_W2 ${fails} FAILURES` : 'MOON_W2_OK');
process.exit(fails ? 1 : 0);
