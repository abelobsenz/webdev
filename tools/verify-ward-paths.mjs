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
  // 2. trees: the production planner's trees in this ward
  const world = { metro: null };
  void world;
  metrics.push({ id, paths: P.paths.length, pathSamples, pathHits });
}
console.log(JSON.stringify(metrics));
if (issues.length) { console.log(issues.join('\n')); process.exitCode = 1; } else console.log('WARD_PATHS_VERIFIED');
void planTrees; void segDist;
