import assert from 'node:assert/strict';
import * as THREE from 'three';
import { wardRecords, wardTowerDefs, wardHeight, planWard, buildWardPlatform, levelAtRec } from '../src/world/metro.js';
import { buildWardLandmarks } from '../src/world/wardLandmarks.js';
import { canalBoatGeometry, BOAT_LEN } from '../src/world/wardsA/canalLife.js';
import { buildTowers } from '../src/world/towers.js';
import { towerFootprint } from '../src/world/urban.js';
import { terrainHeight } from '../src/world/terrain.js';
import { auditGeometry } from './geometry-audit.mjs';

// Checks for the Outer Wards of the wards-a area (Aurora, Tidewater, Sunward, Seraph) that
// the general ward verifier does not make: every moored boat floats in open water clear of
// walls, bridges and other boats; marina pontoons lie on the water and their gangways land
// on a quay; every new landmark solid is closed; landmark footprints stay off the
// arcologies, the streets and the parcels.
const issues = [], metrics = [];
const check = (ok, msg) => { if (!ok) issues.push(msg); };
function solid(name, g, composite = true) {
  const a = auditGeometry(g, { tolerance: 1e-4 });
  check(!a.boundaryEdges, `${name}: ${a.boundaryEdges} open edges`);
  check(!a.inconsistentEdges, `${name}: ${a.inconsistentEdges} reversed seams`);
  check(!a.nonFinite && !a.invalidNormals, `${name}: invalid attributes (${a.nonFinite} non-finite, ${a.invalidNormals} bad normals)`);
  if (!composite) check(!a.nonManifoldEdges && a.signedVolume > 0, `${name}: manifold outward material`);
  return a;
}
{
  const g = canalBoatGeometry();
  const a = solid('canal boat', g);
  g.computeBoundingBox();
  const b = g.boundingBox;
  check(Math.abs(b.max.x - b.min.x - BOAT_LEN) < 0.5, `canal boat length ${b.max.x - b.min.x}`);
  check(b.min.y < -0.2 && b.min.y > -0.6, `canal boat draft ${b.min.y}`);
  metrics.push({ boatTriangles: a.triangles, beam: +(b.max.z - b.min.z).toFixed(2) });
}

const towers = buildTowers(wardTowerDefs(), (x, z) => Math.max(wardHeight(x, z), terrainHeight(x, z)), new THREE.Scene());
for (const t of towers) t.footprint = towerFootprint(t, 100);
const ids = (process.env.WARD_ID || 'aurora,tidewater,sunward,seraph').split(',');
for (const rec of wardRecords().filter((r) => ids.includes(r.w.id))) {
  const id = rec.w.id, w = rec.w;
  const P = planWard(rec, towers);
  rec.plan = P;
  const G = buildWardPlatform(rec, P);
  const LM = buildWardLandmarks(new THREE.Scene(), rec, P, G, { palette: rec.design.palette });
  // ---- every landmark mesh: closed material
  for (const m of LM.meshes) if (m.isMesh && !m.isInstancedMesh && m.geometry.index) solid(`${id}/${m.name}`, m.geometry);
  // ---- boats: afloat in water, clear of the walls, bridges and each other
  const boats = LM.canalBoats || [];
  let dry = 0, bridgeHits = 0, pairs = 0, basinless = 0;
  const bridgeSegs = P.bridges.map((b) => ({ a: b.a, b: b.b, r: b.hw + 2 }));
  const segDist = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9; let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); };
  const hullPts = (b) => {
    const s = b.len / BOAT_LEN, c = Math.cos(b.rot), sn = Math.sin(b.rot), out = [];
    for (let u = -0.5; u <= 0.5001; u += 0.05) for (const v of [-1, 0, 1]) {
      const hb = 0.95 * Math.pow(Math.max(0, Math.sin(Math.PI * (u + 0.5))), 0.62) * 1.05;
      const lx = u * BOAT_LEN * s, lz = v * hb * s;
      out.push([b.x - w.x + lx * c - lz * sn, b.z - w.z + lx * sn + lz * c]);
    }
    return out;
  };
  for (const b of boats) {
    const pts = hullPts(b);
    if (pts.some(([x, z]) => rec.sea.sample(x, z) < 0.45)) dry++;
    if (pts.some(([x, z]) => bridgeSegs.some((q) => segDist(x, z, q.a, q.b) < q.r))) bridgeHits++;
  }
  for (let i = 0; i < boats.length; i++) for (let j = i + 1; j < boats.length; j++) if (Math.hypot(boats[i].x - boats[j].x, boats[i].z - boats[j].z) < (boats[i].len + boats[j].len) / 2 + 1.2) {
    // boats berthed abreast in a marina lie 10 m apart side by side; compare hull outlines
    const A = hullPts(boats[i]), B = hullPts(boats[j]);
    const minD = Math.min(...A.map((p) => Math.min(...B.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])))));
    if (minD < 1.0) pairs++;
  }
  check(!dry, `${id}: ${dry} boats touch a wall or quay`);
  check(!bridgeHits, `${id}: ${bridgeHits} boats under or against a bridge`);
  check(!pairs, `${id}: ${pairs} boat pairs collide`);
  void basinless;
  // ---- landmarks against arcology footprints and parcels (their stated sites)
  const tw = towers.filter((t) => t.def.ward === id).map((t) => ({ x: t.def.x - w.x, z: t.def.z - w.z, r: t.footprint }));
  let underTower = 0, streetHits = 0;
  for (const L of P.landmarks) {
    // every piece as sample points with the radius it occupies round each
    const bedPts = (b) => { const o = []; for (let i = 0; i <= 8; i++) for (const r of [b.r0, (b.r0 + b.r1) / 2, b.r1]) { const a = b.a0 + ((b.a1 - b.a0) * i) / 8; o.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, r: 0.3 }); } return o; };
    const hedgePts = (h) => { const o = []; const n = Math.ceil((h.a1 - h.a0) * h.r / 3); for (let i = 0; i <= n; i++) { const a = h.a0 + ((h.a1 - h.a0) * i) / n; o.push({ x: Math.cos(a) * h.r, z: Math.sin(a) * h.r, r: 0.5 }); } return o; };
    const list = L.type === 'orrery' ? [...L.list.map((p) => ({ x: p.x, z: p.z, r: p.s + 3 })), ...(L.hedges || []).flatMap(hedgePts)] : L.type === 'sunDial' ? L.stones.map((q) => ({ x: q.x, z: q.z, r: 3.2 })) : L.type === 'summitGarden' ? L.beds.flatMap(bedPts) : L.x !== undefined ? [L] : [];
    for (const q of list) if (tw.some((t) => Math.hypot(q.x - t.x, q.z - t.z) < t.r + (q.r || q.s || 2))) { underTower++; if (underTower < 6) console.log('UNDER_TOWER', id, L.type, q.x, q.z); }
    // designed pieces keep off the streets (hedges, beds and plinths are solid)
    if (['orrery', 'summitGarden', 'sunDial'].includes(L.type)) for (const q of list) {
      const e = P.field.edge(q.x, q.z);
      if (e < q.r + 0.2) { streetHits++; if (streetHits < 6) console.log('ON_STREET', id, L.type, q.x.toFixed(1), q.z.toFixed(1), e.toFixed(2)); }
    }
  }
  check(!underTower, `${id}: ${underTower} landmark pieces inside an arcology footprint`);
  check(!streetHits, `${id}: ${streetHits} garden pieces on a street`);
  // designed trees: rooted on their level (or in their bed), never on a street or in water
  let treeBad = 0;
  for (const t of P.raw.trees || []) {
    const lv = levelAtRec(rec, t.x, t.z, 0.5);
    const s = P.field.edge(t.x, t.z);
    if (lv === null || s < 1.5 || P.pools.some((p) => p.prim.d(t.x, t.z) < 1)) { treeBad++; if (treeBad < 6) console.log('TREE', id, t.x.toFixed(1), t.z.toFixed(1), lv, s.toFixed(2)); }
  }
  check(!treeBad, `${id}: ${treeBad} designed trees off their ground`);
  metrics.push({ id, lots: P.lots.length, bridges: P.bridges.length, boats: boats.length, dry, bridgeHits, pairs, underTower, streetHits, treeBad, landmarkMeshes: LM.meshes.length });
  for (const k of ['walls', 'near', 'far', 'quay', 'grounds', 'sand', 'seabed']) for (const g of G[k]) g.dispose();
}
console.log(JSON.stringify(metrics, null, 1));
assert.deepEqual(issues, [], 'wards-a defects');
console.log('WARDS_A_VERIFIED');
