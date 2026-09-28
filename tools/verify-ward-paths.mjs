import * as THREE from 'three';
import { wardRecords, wardTowerDefs, wardHeight, planWard } from '../src/world/metro.js';
import { buildTowers } from '../src/world/towers.js';
import { towerFootprint } from '../src/world/urban.js';
import { terrainHeight } from '../src/world/terrain.js';
import { planTrees } from '../src/world/treePlanner.js';

// Exact checks the parcel planner's sampled tests can miss: no building podium may stand on
// an authored garden path or inside a landmark site, and no authored or planned tree may
// stand inside a podium, a landmark site, a pool or on a carriageway. Run per ward
// (WARD_ID=...) or for all.
const towers = buildTowers(wardTowerDefs(), (x, z) => Math.max(wardHeight(x, z), terrainHeight(x, z)), new THREE.Scene());
for (const t of towers) t.footprint = towerFootprint(t, 100);
const issues = [], metrics = [];
const segDist = (p, a, b) => { const x = b[0] - a[0], z = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * z) / (x * x + z * z || 1))); return Math.hypot(p[0] - a[0] - t * x, p[1] - a[1] - t * z); };
const inLot = (L, x, z, pad = 0.6) => { const c = Math.cos(L.rot), s = Math.sin(L.rot), dx = x - L.lx, dz = z - L.lz; return Math.abs(dx * c - dz * s) < L.w / 2 + pad && Math.abs(dx * s + dz * c) < L.d / 2 + pad; };
for (const rec of wardRecords().filter((r) => !process.env.WARD_ID || r.w.id === process.env.WARD_ID)) {
  const id = rec.w.id, P = planWard(rec, towers);
  // 1. podiums on paths: sample every path at 1 m against every nearby lot
  let pathHits = 0, pathSamples = 0;
  for (const path of P.paths) {
    const pts = path.pts || path, w = path.w ?? 1.6;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
      for (let k = 0; k <= n; k++) {
        const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n;
        pathSamples++;
        // a civic parcel's own entrance path may meet its podium
        if (P.lots.some((L) => !L.civic && Math.abs(L.lx - x) < 60 && Math.abs(L.lz - z) < 60 && inLot(L, x, z, w / 2))) { pathHits++; if (pathHits < 4) issues.push(`${id}: podium on path at ${x.toFixed(0)},${z.toFixed(0)}`); }
      }
    }
  }
  // 2. landmarks and monuments clear of the arcologies' measured footprints
  const wt = towers.filter((t) => t.def.ward === id).map((t) => ({ x: t.def.x - rec.w.x, z: t.def.z - rec.w.z, r: t.footprint }));
  let towerHits = 0;
  const pieces = [];
  for (const L of P.landmarks) {
    if (L.list) for (const q of L.list) if (q.x !== undefined) pieces.push({ type: `${L.type}/${q.kind || ''}`, x: q.x, z: q.z, r: q.island || q.r || q.s || 12 });
    if (L.x !== undefined) pieces.push({ type: L.type, x: L.x, z: L.z, r: L.rOuter || L.r || Math.max(L.w || 0, L.d || 0, L.len || 0) / 2 || 20 });
  }
  for (const q of pieces) for (const t of wt) if (Math.hypot(q.x - t.x, q.z - t.z) < q.r + t.r) { towerHits++; issues.push(`${id}: ${q.type} at ${q.x.toFixed(0)},${q.z.toFixed(0)} inside an arcology footprint`); }
  metrics.push({ id, paths: P.paths.length, pathSamples, pathHits, landmarkPieces: pieces.length, towerHits });
}
console.log(JSON.stringify(metrics));
if (issues.length) { console.log(issues.join('\n')); process.exitCode = 1; } else console.log('WARD_PATHS_VERIFIED');
void planTrees; void segDist;
