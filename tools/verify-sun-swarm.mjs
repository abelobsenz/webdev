// Wave 2 of the sun domain, headless: the Helianth's collector shells (src/space/helianthSwarm.js),
// the Foundry Commons (src/space/foundryCommons.js) and the Sun's statite shell and collector
// planes (src/space/sun.js). Lattice spacing and clear courts, clearances of every moving part
// (tugs, drones, trams, relay rings) and of the beams, triangle counts per LOD, buffer sanity of
// every instanced draw, finite transforms, build and per-frame timings.
// Run: node tools/verify-sun-swarm.mjs (also run at the end of tools/verify-sun.mjs)
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SWARM, HelianthSwarm, buildCollector, buildRelay, buildRelayRing, RELAY_RING, swarmLayout, swarmMatrix, swarmStreets, tugPose, droneLocal,
  shellY, isStreet, LodField,
} from '../src/space/helianthSwarm.js';
import { flotillaLayout, PETAL } from '../src/space/helianthDistrict.js';
import { COMMONS, buildCommons, commonsBlocks, blockBase, tramZ, buildTram, commonsDrone, COMMONS_CRUISE, BRIDGE_Y, FoundryCommons, tramX } from '../src/space/foundryCommons.js';
import { buildFoundry } from '../src/space/workingStations.js';
import { SunSwarm, SHELL_R, SHELL_DIR, SWARM_PLANES } from '../src/space/sun.js';
import { SKY_UNIFORMS } from '../src/space/sky.js';
import { SpaceSim } from '../src/space/sim.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), out = {};
const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const time = (f) => { const t0 = performance.now(); const r = f(); return [r, performance.now() - t0]; };

// ------------------------------------------------------------ buffer sanity
/** Every mesh under root: index in range, instanced counts within their buffers, finite matrices. */
function buffers(name, root) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, pos = g.attributes.position;
    assert.ok(pos && pos.count > 0, `${name}: ${o.name || o.type} has vertices`);
    if (g.index) {
      let mx = 0; const a = g.index.array; for (let i = 0; i < a.length; i++) if (a[i] > mx) mx = a[i];
      assert.ok(mx < pos.count, `${name}: index ${mx} < vertex count ${pos.count}`);
    }
    for (const [k, at] of Object.entries(g.attributes)) if (!at.isInstancedBufferAttribute) assert.ok(at.count >= pos.count, `${name}: attribute ${k} covers every vertex`);
    if (o.isInstancedMesh) {
      assert.ok(o.count <= o.instanceMatrix.count, `${name}: InstancedMesh count ${o.count} <= capacity ${o.instanceMatrix.count}`);
      assert.ok(o.instanceMatrix.array.length >= o.count * 16, `${name}: instance matrices allocated`);
      assert.ok(o.instanceMatrix.array.subarray(0, o.count * 16).every(Number.isFinite), `${name}: finite instance matrices`);
    }
    if (g.isInstancedBufferGeometry) {
      const ic = g.instanceCount === Infinity ? 0 : g.instanceCount;
      for (const [k, at] of Object.entries(g.attributes)) if (at.isInstancedBufferAttribute) {
        assert.ok(at.count >= ic, `${name}: instanced attribute ${k} (${at.count}) covers instanceCount ${ic}`);
        assert.ok(at.array.subarray(0, ic * at.itemSize).every(Number.isFinite), `${name}: instanced attribute ${k} finite`);
      }
    }
    assert.ok(o.matrixWorld.elements.every(Number.isFinite), `${name}: finite world matrix`);
    n++;
  });
  return n;
}

// ================================================================== swarm geometry
const D = V(0, 0.025 * 1.496e8, 0.004 * 1.496e8).length();
{
  const parts = { collectorNear: buildCollector(0), collectorMid: buildCollector(1), relayNear: buildRelay(0), relayMid: buildRelay(1) };
  for (const [k, p] of Object.entries(parts)) {
    assert.ok(p.geo.attributes.position.array.every(Number.isFinite), `${k} finite`);
    out[`${k}Tris`] = tri(p.geo);
    const b = new THREE.Box3().setFromBufferAttribute(p.geo.attributes.position);
    // everything stays within its lattice cell (collectors) or its relay court
    const lim = k.startsWith('collector') ? SWARM.rimR + 1000 : SWARM.relayClear * 1000 * 0.2;
    assert.ok(Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z) < lim, `${k} within its cell (${b.min.x.toFixed(0)}..${b.max.x.toFixed(0)})`);
  }
  assert.ok(out.collectorNearTris < 12000 && out.collectorMidTris < 120, 'collector LOD budgets');
  assert.ok(out.relayNearTris < 12000 && out.relayMidTris < 400, 'relay LOD budgets');
  out.relayRingTris = tri(buildRelayRing());
  // the relay ring spins about the hub, clear of the spine (r 200) and inside the array's reach
  assert.ok(RELAY_RING.R - 140 > 330 && RELAY_RING.R + 140 < 2400, 'relay ring clear of the spine and within the court');
  // drones: their spiral stays inside the facet ring, sunward of the face, clear of the receiver struts
  const cn = parts.collectorNear.geo, P = cn.attributes.position, st = V();
  let worst = Infinity;
  for (let d = 0; d < 8; d++) for (let t = 0; t < 900; t += 7) {
    droneLocal(d, t, st);
    assert.ok(Math.hypot(st.x, st.z) <= 2200.01 && st.y < -55 && st.y > -85, 'drone pass over the face');
    // distance to the struts' lines (r 2600 at the face to r 150 at the focus)
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2 + Math.PI / 2, A = V(Math.cos(a) * 2600, -30, Math.sin(a) * 2600), B = V(Math.cos(a) * 150, -SWARM.focus + 60, Math.sin(a) * 150);
      const ab = B.clone().sub(A), u = THREE.MathUtils.clamp(st.clone().sub(A).dot(ab) / ab.lengthSq(), 0, 1);
      worst = Math.min(worst, A.clone().addScaledVector(ab, u).distanceTo(st) - 22 - 14 * 3.2 / 6);
    }
  }
  assert.ok(worst > 40, `drones clear of the receiver struts (${worst.toFixed(0)} m)`);
  out.droneStrutClearanceMetres = Math.round(worst);
  void P;
}

// ================================================================== swarm layout
{
  const [layout, ms] = time(() => swarmLayout(D));
  out.layoutMs = +ms.toFixed(1);
  const cols = layout.filter((c) => c.kind === 0), rels = layout.filter((c) => c.kind === 1);
  out.collectors = cols.length; out.relays = rels.length;
  assert.ok(cols.length > 30000 && rels.length > 300, 'a dense lattice');
  // every item on its shell, outside the Helianth's window, off the streets
  for (const c of layout) {
    const L = SWARM.layers[c.layer];
    assert.ok(Math.abs(c.p.y - shellY(D, L.y, c.p.x, c.p.z)) < 1e-6, 'on its shell');
    assert.ok(Math.hypot(c.p.x, c.p.z) >= L.hole, 'outside the window');
    assert.ok(!isStreet(c.i, c.j), 'off the streets');
  }
  // neighbour spacing on each layer: no two closer than the pitch (mirrors 7.6 km at most)
  const grid = new Map(), key = (l, x, z) => `${l},${Math.floor(x / 40)},${Math.floor(z / 40)}`;
  for (const c of layout) { const k = key(c.layer, c.p.x, c.p.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c); }
  let minSep = Infinity, courtMin = Infinity;
  for (const c of layout) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    for (const q of grid.get(key(c.layer, c.p.x + dx * 40, c.p.z + dz * 40)) || []) {
      if (q === c) continue;
      const d = q.p.distanceTo(c.p);
      minSep = Math.min(minSep, d);
      if (c.kind === 1 && q.kind === 0) courtMin = Math.min(courtMin, d);
    }
  }
  assert.ok(minSep > 2 * SWARM.rimR * 1.08 / 1000 + 10, `collectors never touch (${minSep.toFixed(1)} km)`);
  assert.ok(courtMin >= SWARM.relayClear * 0.99, `relay courts clear (${courtMin.toFixed(1)} km)`);
  out.minSeparationKm = +minSep.toFixed(1);
  // the Helianth's own flotilla (statites, concentrators within 400 km, +-24 km) stays clear of both shells
  let fl = Infinity;
  for (const s of flotillaLayout()) {
    const p = s.p.clone().multiplyScalar(0.001);
    for (const L of SWARM.layers) fl = Math.min(fl, Math.abs(p.y - shellY(D, L.y, p.x, p.z)));
  }
  assert.ok(fl > 60, `flotilla clear of the shells (${fl.toFixed(0)} km)`);
  out.flotillaShellClearanceKm = Math.round(fl);
  // matrices: finite, the mirror's -Y at the Sun
  const m = new THREE.Matrix4(), y = V(), toSun = V();
  for (const c of layout.slice(0, 4000)) {
    swarmMatrix(D, c, m);
    assert.ok(m.elements.every(Number.isFinite), 'finite swarm matrix');
    y.setFromMatrixColumn(m, 1).normalize();
    toSun.set(-c.p.x, -D - c.p.y, -c.p.z).normalize();
    assert.ok(y.dot(toSun) < -0.9995, 'mirror faces the Sun');
  }
  // tugs keep to their streets: never within 12 km of a collector's centre (or 20 km of a relay's)
  const streets = swarmStreets(D), p = V(), f = V();
  let tugMin = Infinity;
  for (let k = 0; k < SWARM.tugs; k++) for (let t = 0; t < 2400; t += 37) {
    tugPose(D, streets, k, t, p, f);
    assert.ok(Number.isFinite(p.x + p.y + p.z), 'finite tug');
    const st = streets[k % streets.length];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const q of grid.get(key(st.layer, p.x + dx * 40, p.z + dz * 40)) || []) {
      tugMin = Math.min(tugMin, q.p.distanceTo(p) - (q.kind ? 8 : 0));
    }
  }
  assert.ok(tugMin > 12, `tugs clear of the collectors (${tugMin.toFixed(1)} km)`);
  out.tugClearanceKm = +tugMin.toFixed(1);
  // relay beams: straight to the Helianth's crown, clear of every collector mirror and of the Helianth's petals
  let beamMin = Infinity;
  const arr = V(420, 600, 0), a = V(), b = V(), ab = V(), w = V();
  for (const r of rels) {
    if (Math.hypot(r.p.x, r.p.z) > SWARM.beamR) continue;
    swarmMatrix(D, r, m); a.copy(arr).applyMatrix4(m).multiplyScalar(0.001);
    b.copy(a).normalize().multiplyScalar(SWARM.beamEnd); b.y = 2.2 + Math.sign(a.y) * 3;
    ab.subVectors(b, a);
    for (const c of cols) {
      if (c.layer !== r.layer) continue;
      const u = THREE.MathUtils.clamp(w.subVectors(c.p, a).dot(ab) / ab.lengthSq(), 0, 1);
      beamMin = Math.min(beamMin, w.copy(a).addScaledVector(ab, u).distanceTo(c.p) - SWARM.rimR * 1.08 / 1000);
    }
    assert.ok(Math.hypot(b.x, b.z) > PETAL.outer / 1000 + 2, 'beams end outside the petals');
  }
  assert.ok(beamMin > 0.5, `relay beams clear of the mirrors (${beamMin.toFixed(2)} km)`);
  out.beamMirrorClearanceKm = +beamMin.toFixed(2);
}

// ================================================================== swarm module: LOD, buffers, timings
{
  const station = new THREE.Group();
  station.position.set(0, 0.025 * 1.496e8, 0.004 * 1.496e8);
  station.quaternion.setFromUnitVectors(V(0, 1, 0), station.position.clone().normalize());
  station.updateMatrixWorld(true);
  const bodies = [];
  const space = { addBody(name, objects, center, radius, opts) { const b = { name, objects, center, radius, ...opts }; bodies.push(b); return b; } };
  const sw = new HelianthSwarm(station, D, station.position.clone().normalize().negate(), space);
  assert.equal(bodies.length, 2, 'swarm and beam bodies');
  const cam = V(), local = (x, y, z) => cam.set(x, y, z).applyQuaternion(station.quaternion).add(station.position);
  // far: nothing built
  sw.update(0, local(0, 2e5, 0), {});
  assert.ok(!sw.built && !sw.on, 'not built from afar');
  const [, bms] = time(() => sw.update(0, local(0, 0.06, 0), {}));
  out.swarmBuildMs = +sw.buildMs.toFixed(0);
  assert.ok(sw.buildMs < 1000, 'swarm builds in under a second');
  assert.ok(sw.on, 'on at the Helianth');
  const total = sw.collectors.length;
  const views = { atHelianth: [0, 0.06, 0], overShell: [900, -120, 400], inShell: [1500, -140 + shellY(D, 0, 1500, 300) + 1, 300], outerShell: [-700, 185, -900], relayCourt: null };
  const rel = sw.relays[3]; views.relayCourt = [rel.p.x + 20, rel.p.y + 6, rel.p.z];
  let worst = 0;
  for (const [k, v] of Object.entries(views)) {
    sw.update(10, local(...v), {});
    assert.equal(sw.colNear.count + sw.colMid.count, total, `${k}: every collector drawn once`);
    assert.equal(sw.relNear.count + sw.relMid.count, sw.relays.length, `${k}: every relay drawn once`);
    assert.ok(sw.colNear.count <= SWARM.nearCap && sw.relNear.count <= SWARM.relayNearCap, `${k}: near sets within capacity`);
    buffers(`swarm@${k}`, sw.group); buffers(`beams@${k}`, sw.beamGroup);
    const [lo, hi] = sw.interval();
    assert.ok(lo > 0 && hi > lo && Number.isFinite(hi), `${k}: depth interval`);
    const t = sw.triangles();
    out[`swarmTris_${k}`] = t; worst = Math.max(worst, t);
  }
  assert.ok(worst < 12e6, `swarm under 12M rendered triangles (${(worst / 1e6).toFixed(2)}M)`);
  // the near view resolves collectors: some near, the drones on the nearest
  sw.update(20, local(...views.overShell), {});
  assert.ok(sw.colNear.count > 20 && sw.nHosts > 0, 'near collectors and drone hosts over the shell');
  // drones are over their own hosts' faces, tugs on their shells, the rings spin about their relays
  const m = new THREE.Matrix4(), h = new THREE.Matrix4(), p = V();
  for (let k = 0; k < sw.dronesIM.count; k++) {
    sw.dronesIM.getMatrixAt(k, m); h.fromArray(sw.colNear.instanceMatrix.array, sw.hosts[Math.floor(k / SWARM.drones)] * 16);
    p.setFromMatrixPosition(m).applyMatrix4(h.clone().invert());
    assert.ok(Math.hypot(p.x, p.z) <= 2201 && p.y < -50, 'drone over its host');
  }
  for (let k = 0; k < sw.rings.count; k++) {
    sw.rings.getMatrixAt(k, m); h.fromArray(sw.relNear.instanceMatrix.array, k * 16);
    p.setFromMatrixPosition(m).applyMatrix4(h.clone().invert());
    assert.ok(Math.abs(p.y - RELAY_RING.y) < 1 && Math.hypot(p.x, p.z) < 1, 'ring on its hub');
  }
  // per-frame cost (steady camera) and the refill when the near set changes
  const c0 = local(...views.overShell);
  const [, tf] = time(() => { for (let i = 0; i < 300; i++) sw.update(30 + i / 60, c0, {}); });
  out.swarmFrameMs = +(tf / 300).toFixed(3);
  assert.ok(tf / 300 < 0.3, `swarm frame under 0.3 ms (${(tf / 300).toFixed(3)})`);
  let refill = 0;
  for (let i = 0; i < 40; i++) { const [, t] = time(() => sw.update(40, local(900 + i * 120, -120, 400), {})); refill = Math.max(refill, t); }
  out.swarmRefillMsWorst = +refill.toFixed(2);
  assert.ok(refill < 6, 'refills stay a few ms');
  // the Helianth's beam: finite and aimed at the Earth (the world origin)
  const dir = V(0, 1, 0).applyQuaternion(sw.mainBeam.quaternion).applyQuaternion(station.quaternion);
  assert.ok(dir.dot(station.position.clone().normalize().negate()) > 0.9999, 'the Helianth beams to the Earth');
  void bms;
}

// ================================================================== the Foundry Commons
{
  const [c, ms] = time(() => buildCommons());
  out.commonsBuildMs = +ms.toFixed(1);
  out.commonsTris = tri(c.geo);
  assert.ok(c.geo.attributes.position.array.every(Number.isFinite), 'commons finite');
  assert.ok(out.commonsTris < 400000, 'commons within budget');
  const blocks = commonsBlocks(), { street, stack, fans } = COMMONS;
  const box = (b) => new THREE.Box3(V(b.x - b.w / 2 - 12, blockBase(), b.z - b.d / 2 - 20), V(b.x + b.w / 2 + 12, blockBase() + 60 + b.h * 42 + 30, b.z + b.d / 2 + 20));
  // tenements never overlap one another, stand clear of the street tube and of the stacks and fans
  for (let i = 0; i < blocks.length; i++) {
    const A = box(blocks[i]);
    for (let j = i + 1; j < blocks.length; j++) assert.ok(!A.intersectsBox(box(blocks[j])), `blocks ${i} and ${j} apart`);
    assert.ok(Math.min(Math.abs(A.min.x), Math.abs(A.max.x)) > street.r + 20, 'blocks clear of the street tube');
    for (const s of [-1, 1]) assert.ok(A.distanceToPoint(V(s * 900, A.min.y, stack.z)) > stack.r * 1.25 + 20, 'blocks clear of the stacks');
    assert.ok(A.max.z < fans.z - 330 || A.min.z > fans.z + 330, 'blocks clear of the fan headers');
    assert.ok(A.max.y < COMMONS_CRUISE - 60, 'drones cruise above every roof');
  }
  // bridges clear over the trams' roofs
  const tram = new THREE.Box3().setFromBufferAttribute(buildTram().attributes.position);
  assert.ok(COMMONS.track.y + tram.max.y < BRIDGE_Y - 15 - 10, 'street bridges clear over the trams');
  // trams ride the rails (bogie bottoms on the rail tops) and pass each other on their tracks
  const railTop = street.y + street.r + 14;
  assert.ok(Math.abs(COMMONS.track.y + tram.min.y - railTop) < 0.01, 'tram bogies on the rails');
  assert.ok(2 * COMMONS.track.x - (tram.max.x - tram.min.x) > 20, 'trams pass with room between');
  for (let k = 0; k < COMMONS.trams; k++) for (let t = 0; t < 600; t += 3) {
    const z = tramZ(k, t);
    assert.ok(z + tram.min.z > street.z0 + 100 && z + tram.max.z < street.z1 - 50, 'trams stay on the street');
  }
  // trams on the loop never meet: on one track (or crossing over) they keep a tram's length and more apart
  let tramGap = Infinity;
  for (let t = 0; t < 1200; t += 0.5) for (let a = 0; a < COMMONS.trams; a++) for (let b = a + 1; b < COMMONS.trams; b++) {
    if (Math.abs(tramX(a, t) - tramX(b, t)) < tram.max.x - tram.min.x + 4) tramGap = Math.min(tramGap, Math.abs(tramZ(a, t) - tramZ(b, t)) - 120);
  }
  for (let k = 0; k < COMMONS.trams; k++) for (let t = 0; t < 1200; t += 0.5) assert.ok(Math.abs(tramX(k, t)) <= COMMONS.track.x + 1e-9, 'tram on the tramway');
  assert.ok(tramGap > 10, `trams on a track keep apart (${tramGap.toFixed(0)} m)`);
  out.tramGapMetres = Math.round(tramGap);
  // the commons keeps clear of the foundry (the wheel and its hub tube, where the collar meets it)
  const f = buildFoundry({ supports: true }).geo.attributes.position, fp = V();
  let fmin = Infinity;
  const cpos = c.geo.attributes.position, cp = V();
  const fvs = []; for (let i = 0; i < f.count; i++) { fp.fromBufferAttribute(f, i); if (fp.z > 5000) fvs.push(fp.clone()); }
  for (let i = 0; i < cpos.count; i += 3) {
    cp.fromBufferAttribute(cpos, i);
    if (cp.z < street.z0 + 400) continue;   // (the collar is seated on the hub tube)
    for (const q of fvs) { const d = q.distanceToSquared(cp); if (d < fmin) fmin = d; }
  }
  fmin = Math.sqrt(fmin);
  assert.ok(fmin > 100, `commons clear of the foundry (${fmin.toFixed(0)} m)`);
  out.commonsFoundryClearanceMetres = Math.round(fmin);
  // the drones, the class, buffers and frame time
  const g = new THREE.Group(), fc = new FoundryCommons(g);
  fc.update(0, 1000); assert.ok(!fc.built, 'commons not built from afar');
  fc.update(0, 20); g.updateMatrixWorld(true);
  buffers('commons', g);
  out.commonsRenderedTris = fc.triangles(); out.commonsClassBuildMs = +fc.buildMs.toFixed(1);
  const p = V();
  for (let k = 0; k < COMMONS.drones; k++) for (let t = 0; t < 400; t += 2) { commonsDrone(k, t, blocks, p); assert.ok(Number.isFinite(p.x + p.y + p.z), 'finite drone'); }
  const [, tf] = time(() => { for (let i = 0; i < 300; i++) fc.update(i / 60, 20); });
  out.commonsFrameMs = +(tf / 300).toFixed(3);
  assert.ok(tf / 300 < 0.1, 'commons frame cheap');
}

// ================================================================== the Sun's swarm: shell and planes
{
  const sim = new SpaceSim(); sim.syncFromHours(12);
  const [s, ms] = time(() => new SunSwarm({}, { swarm: 40000 }));
  out.sunSwarmBuildMs = +ms.toFixed(0);
  const g = s.swarm.geometry, aS = g.getAttribute('aS');
  assert.equal(g.instanceCount, s.swarmCounts.rings + s.swarmCounts.shell + s.swarmCounts.planes, 'every instance counted');
  assert.ok(aS.count >= g.instanceCount, 'aS covers instanceCount');
  assert.ok(aS.array.every(Number.isFinite), 'aS finite');
  // shell blocks: none in the Helianth's cap (its 3D lattice), latitudes within the bands
  let cap = 0, kinds = new Set();
  for (let i = 0; i < g.instanceCount; i++) {
    const k = aS.array[i * 4]; kinds.add(Math.round(k));
    if (Math.round(k) === 5) {
      const z = aS.array[i * 4 + 2], lon = aS.array[i * 4 + 1], cl = Math.sqrt(1 - z * z);
      const d = V(cl * Math.cos(lon), z, cl * Math.sin(lon));
      cap = Math.max(cap, d.dot(SHELL_DIR));
    }
    if (k >= 6) assert.ok(k < 12, 'plane index within uPlanes');
  }
  assert.ok(cap < Math.cos(0.012), 'the shell leaves the Helianth its cap');
  assert.ok([0, 1, 2, 3, 4, 5, 6, 11].every((k) => kinds.has(k)), 'rings, statites, shell and all planes present');
  assert.ok(Math.abs(SHELL_R - D) < 1, 'the shell passes through the Helianth');
  // planes lie between the rings and outside the Sun's corona
  const rings = SKY_UNIFORMS.uSwarmN.value.map((v) => v.w);
  for (const pl of SWARM_PLANES) { assert.ok(pl.w > 0.03 * 1.496e8 && pl.w < 0.14 * 1.496e8, 'plane radius'); assert.ok(Math.abs(new THREE.Vector3(pl.x, pl.y, pl.z).length() - 1) < 1e-6, 'unit normal'); }
  // every uniform the swarm shader declares is supplied
  const decl = [...s.swarm.material.vertexShader.matchAll(/uniform\s+\w+\s+(\w+)/g), ...s.swarm.material.fragmentShader.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((x) => x[1]);
  for (const u of decl) assert.ok(u in s.swarm.material.uniforms, `swarm uniform ${u} supplied`);
  out.sunSwarmInstances = g.instanceCount; out.swarmRingRadiiKm = rings.map((r) => Math.round(r));
}
// the beam shader: every uniform supplied, varyings matched, additive with alpha 0
{
  const sw = new HelianthSwarm(new THREE.Group(), D, V(0, -1, 0), null); sw.build();
  for (const mesh of [sw.relayBeams, sw.mainBeam]) {
    const mat = mesh.material, vs = mat.vertexShader, fs = mat.fragmentShader;
    for (const u of [...vs.matchAll(/uniform\s+\w+\s+(\w+)/g), ...fs.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((x) => x[1])) assert.ok(u in mat.uniforms, `beam uniform ${u}`);
    const vv = new Set([...vs.matchAll(/varying\s+(\w+)\s+(\w+)/g)].map((x) => x[1] + ' ' + x[2]));
    for (const x of fs.matchAll(/varying\s+(\w+)\s+(\w+)/g)) assert.ok(vv.has(x[1] + ' ' + x[2]), `beam varying ${x[2]} matched`);
    assert.ok(mat.premultipliedAlpha && mat.blending === THREE.AdditiveBlending && /gl_FragColor = vec4\(c, 0\.0\)/.test(fs), 'beams additive, alpha 0');
    assert.ok(!/pow\(|fwidth|dFd/.test(fs + vs), 'no pow or derivatives in the beams');
  }
  out.beams = sw.beamCount;
}
// ================================================================== the Earth Road
{
  const { HelianthRoad, ROAD, GATES, gateZ, laneX, shipPose, buildGate } = await import('../src/space/helianthRoad.js');
  out.roadGateTris = tri(buildGate());
  const offset = V(0, 0.025 * 1.496e8, 0.004 * 1.496e8);
  let flo = Infinity, shell = Infinity, beam = Infinity, worstMs = 0;
  // through the year: the Sun round the Earth (the world origin), the Helianth fixed on the Sun
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2, sun = V(Math.cos(a) * 1.496e8, 0, Math.sin(a) * 1.496e8);
    const station = new THREE.Group();
    station.position.copy(sun).add(offset);
    station.quaternion.setFromUnitVectors(V(0, 1, 0), offset.clone().normalize());
    station.updateMatrixWorld(true);
    const bodies = [], space = { addBody(n, o, c, r, opts) { const b = { n, o, c, r, ...opts }; bodies.push(b); return b; } };
    const road = new HelianthRoad(station, V(0, -1, 0), space);
    const cam = station.position.clone().add(V(0, 50, 0));
    const [, ms] = time(() => road.update(k * 97, cam)); worstMs = Math.max(worstMs, road.buildMs);
    assert.ok(road.on && bodies.length === 1, 'road on near the Helianth');
    const iv = bodies[0].interval(); assert.ok(iv[0] > 0 && iv[1] > iv[0], 'road depth interval');
    station.add(road.group); station.updateMatrixWorld(true);
    buffers(`road@${k}`, road.group);
    // the road points in the station frame (km) along both lanes
    const toStation = new THREE.Matrix4().compose(V(), road.group.quaternion, V(1, 1, 1));
    const earth = station.position.clone().negate().normalize().applyQuaternion(station.quaternion.clone().invert());
    for (let l = 0; l < 2; l++) for (let z = ROAD.z0; z <= ROAD.z0 + ROAD.len; z += 20) {
      const p = V(laneX(l), ROAD.y, z).applyMatrix4(toStation);
      const r = Math.hypot(p.x, p.z);
      if (r < 420) flo = Math.min(flo, Math.abs(p.y) - 24 - ROAD.gateR);
      for (const L of SWARM.layers) shell = Math.min(shell, Math.abs(p.y - shellY(D, L.y, p.x, p.z)) - ROAD.gateR - 4.5);
      // the beam leaves the hub along the Earth's direction
      const u = Math.max(p.dot(earth), 0);
      beam = Math.min(beam, p.clone().addScaledVector(earth, -u).length() - ROAD.gateR);
    }
    // ships stay inside their gates' inner half
    const p = V();
    for (let s = 0; s < ROAD.ships; s++) for (let t = 0; t < 900; t += 13) {
      shipPose(s, t, p);
      assert.ok(Math.hypot(p.x - laneX(s % 2), p.y - ROAD.y) < ROAD.gateR * 0.5, 'ship within its lane');
      assert.ok(p.z >= ROAD.z0 && p.z <= ROAD.z0 + ROAD.len, 'ship on the road');
    }
    void ms;
  }
  assert.ok(flo > 5, `the road clears the flotilla (${flo.toFixed(1)} km)`);
  assert.ok(shell > 5, `the road runs between the shells (${shell.toFixed(1)} km)`);
  assert.ok(beam > 10, `the lanes keep off the Helianth's beam (${beam.toFixed(1)} km)`);
  assert.ok(gateZ(0) > 40, 'first gate well clear of the Helianth');
  // ships on a lane keep apart
  let sep = Infinity; const a = V(), b = V();
  for (let t = 0; t < 1200; t += 2) for (let i = 0; i < ROAD.ships; i++) for (let j = i + 1; j < ROAD.ships; j++) {
    if (i % 2 !== j % 2) continue;
    shipPose(i, t, a); shipPose(j, t, b); sep = Math.min(sep, a.distanceTo(b));
  }
  assert.ok(sep > ROAD.shipLen / 1000 + 1, `ships on a lane keep apart (${sep.toFixed(1)} km)`);
  Object.assign(out, { roadGates: GATES * 2, roadFloClearKm: +flo.toFixed(1), roadShellClearKm: +shell.toFixed(1), roadBeamClearKm: +beam.toFixed(1), roadShipSepKm: +sep.toFixed(1), roadBuildMs: +worstMs.toFixed(1) });
}
console.log(JSON.stringify(out));
console.log('SUN_SWARM_VERIFIED');
// ================================================================== coronal loops
{
  const { LOOPS, R_SUN } = await import('../src/space/sunLoops.js');
  const s = new SunSwarm({}, { swarm: 4000 });
  const mesh = s.loops, g = mesh.geometry, P = g.attributes.position;
  assert.ok(s.sunGroup.children.includes(mesh), 'loops ride with the Sun');
  buffers('sunLoops', s.sunGroup);
  const lines = mesh.userData.lines;
  assert.equal(lines.length, 8 * LOOPS.perGroup, 'an arcade per spot group');
  let lo = Infinity, hi = 0, footMax = 0;
  for (const ln of lines) {
    for (const p of ln.pts) { const r = p.length() / R_SUN; lo = Math.min(lo, r); hi = Math.max(hi, r); }
    footMax = Math.max(footMax, Math.abs(ln.pts[0].length() / R_SUN - 1), Math.abs(ln.pts[ln.pts.length - 1].length() / R_SUN - 1));
  }
  assert.ok(lo >= 1 - 1e-9 && footMax < 1e-9, 'loops stand on the photosphere, feet on it');
  assert.ok(hi < 1.25, `loops within the low corona (${hi.toFixed(3)} R)`);
  const mat = mesh.material, vs = mat.vertexShader, fs = mat.fragmentShader;
  for (const u of [...vs.matchAll(/uniform\s+\w+\s+(\w+)/g), ...fs.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((x) => x[1])) assert.ok(u in mat.uniforms, `loop uniform ${u}`);
  const vv = new Set([...vs.matchAll(/varying\s+(\w+)\s+(\w+)/g)].map((x) => x[1] + ' ' + x[2]));
  for (const x of fs.matchAll(/varying\s+(\w+)\s+(\w+)/g)) assert.ok(vv.has(x[1] + ' ' + x[2]), `loop varying ${x[2]} matched`);
  assert.ok(!/pow\(|fwidth|dFd/.test(fs + vs) && mat.premultipliedAlpha && /vec4\(c, 0\.0\)/.test(fs), 'loops: additive, alpha 0, no pow or derivatives');
  assert.ok(P.array.every(Number.isFinite), 'finite loops');
  console.log(JSON.stringify({ loopTris: tri(g), loopApexR: +hi.toFixed(3) }));
}
console.log('SUN_LOOPS_VERIFIED');
