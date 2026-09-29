// Invariants of the Halo's second pass (headless, no renderer):
//   buffers: every InstancedMesh draws no more instances than it holds, instanced attributes
//            cover their instance counts, every index stays inside its vertex buffer;
//   seam:    the district tiles close the ring exactly (no undressed gap at theta = 0), the
//            seam run is stretched only a few percent and holds no hub arch;
//   vault:   the frame rides outside the glass and under the gantry pods;
//   water:   lakes, pools and cascades seated (no water under the deck, none through the glass);
//   LOD:     fine and minor detail only near, mid silhouettes beyond the full massing range;
//   shader:  the Halo kinds are woven into the craft shader, with no derivatives inside them,
//            no pow() of a signed base, and every function they call defined;
//   budget:  triangle counts per layer, build slices, update time and no per-frame allocation.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SpaceSim, bodyDir } from '../src/space/sim.js';
import { HALO_PORTS } from '../src/space/earthData.js';
import { Rings } from '../src/space/rings.js';
import { TILE_L, WINDOW, GANTRY, MAJOR_RANGE_KM, MINOR_RANGE_KM, FINE_RANGE_KM, FRAME_RANGE_KM } from '../src/space/haloDistricts.js';
import { VAULT_FRAME, HARBOUR } from '../src/space/haloArchitecture.js';
import { HARBOUR_V } from '../src/space/haloDistricts.js';
import { buildPortStation } from '../src/space/stations.js';
import { createHaloMaterial, HK } from '../src/space/haloMaterial.js';

const out = {};
const sim = new SpaceSim();
sim.syncFromHours(21);
const space = {
  scene: new THREE.Scene(), earthFixed: new THREE.Group(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e7), size: new THREE.Vector2(1920, 1080), sim,
  addBody(name, objects, center, radius, opts) { const b = { name, objects, center, radius, ...opts }; this.bodies.push(b); return b; },
};
space.scene.add(space.earthFixed);
let t0 = performance.now();
const rings = new Rings(space, { ringSegs: 1 });
out.ringsCtorMs = Math.round(performance.now() - t0);
space.earthFixed.add(rings.group);
const D = rings.districts, S = D.S;
D._queue();
const slices = [];
while (D.buildQueue.length) { const a = performance.now(); D._step(); slices.push(performance.now() - a); }
out.buildSlices = slices.length;
out.buildMs = Math.round(slices.reduce((s, x) => s + x, 0));
out.maxSliceMs = Math.round(Math.max(...slices));
assert.ok(out.maxSliceMs < 100 && out.buildMs < 1500, 'District build lazily, in slices under 100 ms');
assert.ok(out.ringsCtorMs < 400, 'The rings constructor stays light (districts wait for the approach)');

const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const finite = (g) => g.attributes.position.array.every(Number.isFinite);
function eachVertex(g, fn) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) fn(p.getX(i), p.getY(i), p.getZ(i), i); }

// ------------------------------------------------------------ buffers ----
function checkBuffers(root, where) {
  let n = 0;
  root.traverse((o) => {
    const g = o.geometry;
    if (!g) return;
    n++;
    const pc = g.attributes.position ? g.attributes.position.count : 0;
    if (g.index) {
      let mx = 0; const a = g.index.array;
      for (let i = 0; i < a.length; i++) if (a[i] > mx) mx = a[i];
      assert.ok(a.length === 0 || mx < pc, `${where}: index ${mx} beyond ${pc} vertices`);
      assert.equal(a.length % 3, 0, `${where}: whole triangles`);
    }
    if (o.isInstancedMesh) {
      assert.ok(o.count <= o.instanceMatrix.count, `${where}: InstancedMesh draws ${o.count} of ${o.instanceMatrix.count}`);
      assert.ok(o.instanceMatrix.count > 0, `${where}: InstancedMesh allocated with capacity 0`);
      assert.ok(o.instanceMatrix.array.every(Number.isFinite), `${where}: finite instance matrices`);
    }
    if (g.isInstancedBufferGeometry) {
      for (const [k, at] of Object.entries(g.attributes)) if (at.isInstancedBufferAttribute) assert.ok(at.count >= g.instanceCount, `${where}: instanced ${k} holds ${at.count} < ${g.instanceCount}`);
    }
    if (g.attributes.position) assert.ok(finite(g), `${where}: finite positions`);
  });
  return n;
}

// ------------------------------------------------------------ seam ----
const C = 2 * Math.PI * D.Rm;
{
  let covered = 0, maxStretch = 1, prevEnd = 0, gap = 0;
  for (let k = 0; k < D.nTiles; k++) {
    const L = TILE_L * D.tileStretch(k), c = D.tileAngle(k) * D.Rm;
    gap = Math.max(gap, Math.abs(c - L / 2 - prevEnd));
    prevEnd = c + L / 2; covered += L; maxStretch = Math.max(maxStretch, D.tileStretch(k));
    if (k % 97 === 0) assert.equal(D.tileAt(c), k, 'tileAt inverts tileAngle');
  }
  out.seamGapMetres = +Math.max(gap, Math.abs(prevEnd - C)).toFixed(4);
  out.seamStretch = +maxStretch.toFixed(4);
  assert.ok(out.seamGapMetres < 0.01, 'The tiles close the ring with no gap');
  assert.ok(Math.abs(covered - C) < 0.01, 'The tiles cover the circumference exactly');
  assert.ok(maxStretch < 1.06, 'The seam run is stretched only a few percent');
  for (const k of D.hubTiles.keys()) assert.ok(k < D.seamK, 'No hub arch stands on a stretched tile');
  // gantry bays: every tile of their travel dressed
  for (const b of D.gantryBays) for (let u = b.u - GANTRY.range; u <= b.u + GANTRY.range; u += 1000) assert.ok(D.tileOk(u, C), 'Gantries run over dressed tiles');
}

// ------------------------------------------------------------ vault frame ----
{
  const g = D.vaultFrame.geo;
  let lo = Infinity, hi = -Infinity, pod = Infinity;
  eachVertex(g, (x, y) => {
    if (Math.abs(x) > S.hw - 1) return;
    lo = Math.min(lo, y - S.roofLow(x));
    if (Math.abs(x) < S.hw - 200) hi = Math.max(hi, y - S.roofCurve(x));   // (the last 200 m is the wall crest's steep shoulder)
  });
  pod = GANTRY.podY - 8.4 - 1;                         // pod underside above the curve
  out.frameOverGlassMetres = +lo.toFixed(2);
  out.frameUnderPodsMetres = +(pod - hi).toFixed(2);
  assert.ok(lo > 0.5, 'Vault ribs and purlins ride outside the glass');
  assert.ok(pod - hi > 20, 'Vault frame stays well under the gantry pods and chords');
  out.frameTris = tris(g);
  assert.ok(out.frameTris < 40000, 'Vault frame is light');
  assert.ok(D.vaultFrame.lampCount > 0);
}

// ------------------------------------------------------------ harbours ----
{
  const hubs = [...D.hubTiles.keys()];
  const harbours = hubs.filter((k) => D.tileVariant[k] === HARBOUR_V);
  out.harbourTowns = harbours.length;
  assert.ok(harbours.length > 10, 'Harbour towns stand under the arches');
  assert.equal(harbours.length, hubs.filter((k) => D.tileVariant[k] >= 0).length, 'Every dressed hub tile is a harbour');
  // boat routes: clear of the viaduct piers (x = 0, every 200 m from z = -1900), the island,
  // the marina and ferry piers (radii R - 180 .. R), and inside the basin
  const I = HARBOUR.island;
  let minPier = Infinity, minIsland = Infinity;
  for (const rt of HARBOUR.routes) {
    assert.ok(rt.r + 12 < HARBOUR.R - 180 || rt.r - 12 > HARBOUR.R, 'Routes clear of the piers');
    assert.ok(rt.r + 12 < HARBOUR.R, 'Routes stay in the basin');
    for (let a = 0; a < Math.PI * 2; a += 0.0005) {
      const x = rt.r * Math.cos(a), z = rt.r * Math.sin(a);
      if (Math.abs(x) < 20) for (let pz = -1900; pz <= 1900; pz += 200) minPier = Math.min(minPier, Math.abs(z - pz) - 7 - 12);
      minIsland = Math.min(minIsland, Math.hypot(x - I.x, z - I.z) - I.r - 12);
    }
  }
  out.boatPierClearance = +minPier.toFixed(1); out.boatIslandClearance = +minIsland.toFixed(1);
  assert.ok(minPier > 5 && minIsland > 20, 'Boats thread the viaduct piers and keep off the island');
  const hv = D.variants[HARBOUR_V];
  let lightTop = -Infinity;
  eachVertex(hv.major, (x, y) => { if (Math.abs(x - I.x) < 80 && Math.abs(y) < 9000) lightTop = Math.max(lightTop, y - S.roofLow(x)); });
  out.harbourLightUnderGlassMetres = Math.round(-lightTop);
  assert.ok(lightTop < -300, 'The Harbour Light stands well under the glass');
}

// ------------------------------------------------------------ port quarters ----
{
  const a = performance.now();
  const st = buildPortStation({ junction: false });
  out.portBuildMs = Math.round(performance.now() - a);
  const j = buildPortStation({ junction: true });
  out.portTris = tris(st.geo); out.junctionTris = tris(j.geo);
  let hi = -Infinity, lo = Infinity, n = 0;
  eachVertex(st.geo, (x, y, z) => {
    const rr = Math.hypot(x, z);
    if (rr < 4500 || rr > 6000 || y < -60) return;
    n++;
    hi = Math.max(hi, y - S.roofLow(z));                   // station z runs across the ring
    lo = Math.min(lo, y - S.deck(z));
  });
  out.portQuarterVerts = n;
  out.portQuarterVaultGap = Math.round(-hi);
  assert.ok(n > 1000, 'Ports carry their terminal quarter');
  assert.ok(-hi > 150, 'The port quarter stays under the glass');
  assert.ok(lo > -40, 'The port quarter is seated on the deck, not sunk through it');
  assert.ok(out.portTris - out.junctionTris < 150e3, 'The quarter is light');
  assert.ok(st.lamps.every((l) => Number.isFinite(l.p.x + l.p.y + l.p.z)), 'Port lamps finite');
  // the districts come up to the ports but stop short of the concourse wings (9.8 km along)
  let nearest = Infinity;
  for (const p of HALO_PORTS) {
    if (p.name === 'Meridian') continue;
    const dir = bodyDir(0, THREE.MathUtils.degToRad(p.lon));
    for (let k = 0; k < D.nTiles; k++) {
      if (D.tileVariant[k] < 0) continue;
      const th = D.tileAngle(k), c = D.basis.a.clone().multiplyScalar(Math.cos(th)).addScaledVector(D.basis.b, Math.sin(th));
      const d = Math.acos(THREE.MathUtils.clamp(c.dot(dir), -1, 1)) * D.basis.R - TILE_L * D.tileStretch(k) / 2000;
      nearest = Math.min(nearest, d);
    }
  }
  out.portToDistrictKm = +nearest.toFixed(2);
  assert.ok(nearest > 9.9 && nearest < 14, 'Districts reach the ports and stop clear of their wings');
}

// ------------------------------------------------------------ water and LOD layers ----
const kindOf = (g, i) => Math.round(g.attributes.aFacade.getZ(i));
let waterUnder = 0, waterHigh = -Infinity, waterV = 0;
const layerTris = { major: 0, minor: 0, fine: 0, far: 0 };
for (const v of D.variants) {
  for (const L of ['major', 'minor', 'fine', 'far']) {
    const g = v[L];
    assert.ok(g && finite(g), `${L} geometry finite`);
    layerTris[L] = Math.max(layerTris[L], tris(g));
    eachVertex(g, (x, y, z, i) => {
      if (kindOf(g, i) !== HK.WATER || Math.abs(x) > S.hw - 1) return;
      waterV++;
      if (y < S.deck(x) - 30) waterUnder++;
      waterHigh = Math.max(waterHigh, y - S.roofLow(x));
    });
  }
  assert.ok(v.flampCount > 0 && v.lampCount > 0, 'Every variant has beacons and street lamps');
}
out.layerTris = layerTris;
// people's loops: on the pavements (just above the deck, never inside a wall or the water)
{
  let bad = 0, loops = 0;
  for (const v of D.variants) for (let i = 0; i < v.walks.length; i += 6) {
    loops++;
    const [type, cx, cz, a2, b2, y] = v.walks.subarray(i, i + 6);
    for (const x of type ? [cx - a2, cx + a2, cx] : [cx - a2, cx + a2]) { const d = y - S.deck(x); if (!(d > 0 && d < 12)) bad++; }
    if (Math.abs(cx) + a2 > S.hw - 700 || Math.abs(cz) + (type ? a2 : b2) > TILE_L / 2) bad++;
  }
  out.walkLoops = loops;
  assert.ok(loops > 1000 && bad === 0, `Walk loops seated on the deck and inside the tile (${bad} bad)`);
}
out.waterVertices = waterV;
assert.ok(waterV > 0, 'Districts carry water');
assert.equal(waterUnder, 0, 'No water sunk more than 30 m under the deck');
assert.ok(waterHigh < -150, 'Water (cascades included) stays under the glass');
assert.ok(layerTris.major < 260e3 && layerTris.minor < 400e3 && layerTris.fine < 400e3 && layerTris.far < 20e3, 'Per-layer budgets');
const majorSlots = 2 * Math.ceil(MAJOR_RANGE_KM / 4) + 1, minorSlots = 2 * Math.ceil(MINOR_RANGE_KM / 4) + 1, fineSlots = 2 * Math.ceil(FINE_RANGE_KM / 4) + 1;
const frameSlots = Math.min(2 * WINDOW + 1, 2 * Math.ceil(FRAME_RANGE_KM / 4) + 1);
out.closestApproachTris = majorSlots * layerTris.major + (2 * WINDOW + 1 - majorSlots) * layerTris.far + minorSlots * layerTris.minor + fineSlots * layerTris.fine + frameSlots * out.frameTris;
assert.ok(out.closestApproachTris < 12e6, 'District tiles within 12M rendered triangles at closest approach');

// ------------------------------------------------------------ shader ----
{
  const m = createHaloMaterial({});
  const fs = m.fragmentShader, vs = m.vertexShader;
  assert.ok(vs.includes('vUp = normal.y') && vs.includes('varying float vUp'), 'vUp varying written');
  assert.ok(fs.includes('varying float vUp') && fs.includes('haloKinds(k, f, fw, px, alb, rough, metal, em, bump);'), 'Halo kinds called');
  const body = fs.slice(fs.indexOf('void haloKinds('), fs.indexOf('void main() {'));
  assert.ok(!/fwidth|dFdx|dFdy|texture/.test(body), 'No derivatives or texture reads inside the kind branches');
  let depth = 0; for (const ch of fs) { if (ch === '{') depth++; if (ch === '}') depth--; assert.ok(depth >= 0); }
  assert.equal(depth, 0, 'Balanced braces');
  for (const fn of ['hash12', 'vnoise', 'hBox', 'haloPalette', 'haloTree']) assert.ok(new RegExp(`float ${fn}\\(|vec3 ${fn}\\(`).test(fs), `${fn} defined`);
  // pow() bases in the kinds are all max()/clamp()ed or constants
  for (const p of body.matchAll(/pow\(([^,]+),/g)) assert.ok(/max\(|clamp\(|^\s*[0-9.]+\s*$/.test(p[1]), `pow base guarded: ${p[1]}`);
  // integer literals in float arithmetic (GLSL ES 3.0 has no implicit int -> float)
  const bad = body.match(/[^\w.]([0-9]+)\s*[*/+-]\s*[a-zA-Z(]|[a-zA-Z)]\s*[*/+-]\s*([0-9]+)(?![0-9.eE])/g) || [];
  assert.equal(bad.length, 0, `No bare integer literals in float expressions: ${bad.slice(0, 4).join(' | ')}`);
  for (const f of [rings.meshes[0].material, rings.roofs[0].material, rings.far[0].material]) {
    const src = f.fragmentShader;
    for (const u of Object.keys(f.uniforms)) if (!src.includes(u) && !f.vertexShader.includes(u)) throw new Error(`uniform ${u} unused?`);
    for (const m2 of src.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)) assert.ok(m2[1] in f.uniforms, `uniform ${m2[1]} supplied`);
  }
}

// ------------------------------------------------------------ fly in: LOD, update timing, buffers ----
{
  const { a, b, n } = D.basis;
  const th = D.tileAngle(1234);
  const up = a.clone().multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
  const place = (heightKm) => {
    sim.step(0);
    space.earthFixed.quaternion.copy(sim.earthQuat); space.earthFixed.updateMatrixWorld(true);
    space.camera.position.copy(up).multiplyScalar(D.basis.R + heightKm).applyQuaternion(sim.earthQuat);
    space.camera.up.copy(n).applyQuaternion(sim.earthQuat);
    space.camera.lookAt(new THREE.Vector3(0, 0, 0));
    space.camera.updateMatrixWorld(true);
  };
  place(3);
  rings.update(sim, 10, 0.016, space);
  space.scene.updateMatrixWorld(true);
  let fine = 0, minor = 0, major = 0, mid = 0, frame = 0;
  for (const s of D.slots) if (s.g.visible) { fine += s.fine.visible; minor += s.minor.visible; major += s.major.visible; mid += s.mid.visible; frame += s.frame.visible; }
  out.slotsNear = { fine, minor, major, mid, frame };
  out.people = D.people.count;
  assert.ok(D.people.count > 50 && D.people.count <= D.people.instanceMatrix.count, 'People walking round the camera, within their buffer');
  assert.ok(fine >= 3 && fine <= fineSlots, 'Fine detail only on the nearest tiles');
  assert.ok(minor <= minorSlots && major <= majorSlots && mid > 0, 'Minor and major in range, silhouettes beyond');
  for (const s of D.slots) if (s.g.visible) assert.ok(!(s.major.visible && s.mid.visible), 'Massing and silhouette never drawn together');
  out.meshesChecked = checkBuffers(space.scene, 'scene');
  // over a harbour: its boats at work, within their buffers
  {
    const k = [...D.hubTiles.keys()].find((kk) => D.tileVariant[kk] === HARBOUR_V);
    const thh = D.tileAngle(k);
    up.copy(a).multiplyScalar(Math.cos(thh)).addScaledVector(b, Math.sin(thh));
    place(4);
    rings.update(sim, 30, 0.016, space);
    out.harbourBoats = D.boats.map((im) => im.count);
    assert.ok(D.boats.every((im) => im.count > 0 && im.count <= im.instanceMatrix.count), 'Ferries and sailing boats on the basin');
    checkBuffers(space.scene, 'harbour');
  }
  // the seam: fly to theta ~ 0 and see the tiles either side dressed and abutting
  const th0 = 0.2 / D.basis.R;
  up.copy(a).multiplyScalar(Math.cos(th0)).addScaledVector(b, Math.sin(th0));
  place(3);
  rings.update(sim, 12, 0.016, space);
  const ks = D.slots.map((s) => s.k);
  assert.ok(ks.includes(0) && ks.includes(D.nTiles - 1), 'The window wraps over theta = 0');
  // update timing and allocation (heap growth over many frames, the anchor fixed)
  up.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
  place(3);
  const times = [];
  for (let i = 0; i < 400; i++) { const q = performance.now(); rings.update(sim, 20 + i * 0.016, 0.016, space); times.push(performance.now() - q); }
  times.sort((x, y) => x - y);
  out.updateMedianMs = +times[200].toFixed(3);
  out.updateP95Ms = +times[380].toFixed(3);
  assert.ok(out.updateMedianMs < 0.3, 'Per-frame update under 0.3 ms');
  if (global.gc) {
    global.gc();
    const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 2000; i++) D.update(sim, 40 + i * 0.016, 0.016, space);
    global.gc();
    out.heapGrowthKB = Math.round((process.memoryUsage().heapUsed - h0) / 1024);
    assert.ok(out.heapGrowthKB < 256, 'No per-frame allocation in the districts update');
  }
  checkBuffers(space.scene, 'scene after update');
}
console.log(JSON.stringify(out));
console.log('HALO_VERIFIED');
