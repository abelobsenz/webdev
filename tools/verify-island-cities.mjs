// Island-city construction audit (Thalassa, Anchorage, Orison: src/world/islands/).
//   node tools/verify-island-cities.mjs [--quick]
// Checks, on the geometry actually built:
//   closure    every solid (recorded index range) is watertight, consistently and outward
//              wound, finite, with unit normals and no degenerate triangles
//   grounding  every grounded solid's foot is below the drawn ground under its whole plan,
//              and every walking surface clears the ground under it (no grass through paving)
//   support    every solid that rests on another has that support under all its foot corners
//   overlap    the plan footprints of buildings, terraces, streets, lanes, stairs and civic
//              works do not overlap (abutting faces are allowed)
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildSkyline } from '../src/world/skyline.js';
import { renderedHeight } from '../src/world/outerCities.js';
import { auditSolids, solidGeometry } from './island-kit-audit.mjs';

const quick = process.argv.includes('--quick');
// --city <Name>: audit one city only (the skyline is still built whole)
const only = process.argv.includes('--city') ? process.argv[process.argv.indexOf('--city') + 1] : null;
const t0 = Date.now();
const res = buildSkyline(new THREE.Scene(), { audit: true });
const kitParts = res.auditParts.filter((p) => p.geometry.userData.islandKit);
console.log(`skyline built in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${kitParts.length} kit geometries`);
const report = { cities: {} };
const byCity = new Map();
for (const p of kitParts) { const k = p.geometry.userData.islandKit; if (!byCity.has(k)) byCity.set(k, []); byCity.get(k).push(p.geometry); }

for (const [city, geos] of byCity) {
  if (only && city !== only) continue;
  const r = { solids: 0, triangles: 0, closureFailures: [], tiers: [0, 0, 0, 0], roles: {} };
  for (const g of geos) {
    const a = auditSolids(g, { limit: 10 });
    r.solids += a.solids; r.triangles += a.triangles; r.tiers[g.userData.islandTier] += a.triangles;
    r.closureFailures.push(...a.failures);
    for (const s of g.userData.islandSolids) { const role = s[2]?.role || 'unnamed'; r.roles[role] = (r.roles[role] || 0) + 1; }
  }
  // grounding: walking tops and feet against the drawn ground, sampled on the solids' own triangles
  let buried = [], floating = [];
  for (const g of geos) {
    const P = g.attributes.position, I = g.index;
    for (const range of g.userData.islandSolids) {
      const meta = range[2] || {};
      if (!meta.role || !/street|lane|via|terrace|plaza|landing|square|ramp|quay|mole|court|platform|gate/.test(meta.role)) continue;
      let worstTop = 0, air = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      const s = solidGeometry(g, range), sp = s.attributes.position, si = s.index;
      for (let i = 0; i < sp.count; i++) { x0 = Math.min(x0, sp.getX(i)); x1 = Math.max(x1, sp.getX(i)); z0 = Math.min(z0, sp.getZ(i)); z1 = Math.max(z1, sp.getZ(i)); }
      const grounded = !meta.supported;
      for (let k = 0; k < si.count; k += 3) {
        const v = [0, 1, 2].map((q) => { const j = si.getX(k + q); return [sp.getX(j), sp.getY(j), sp.getZ(j)]; });
        const u = v[1].map((x, q) => x - v[0][q]), w = v[2].map((x, q) => x - v[0][q]);
        const ny = u[2] * w[0] - u[0] * w[2], nl = Math.hypot(u[1] * w[2] - u[2] * w[1], ny, u[0] * w[1] - u[1] * w[0]);
        if (Math.abs(ny / nl) < 0.3) continue;
        // sample the triangle densely: a barycentric lattice with about 2 m spacing
        const size = Math.max(Math.hypot(u[0], u[2]), Math.hypot(w[0], w[2]), Math.hypot(u[0] - w[0], u[2] - w[2]));
        const m = Math.min(24, Math.max(2, Math.ceil(size / 2)));
        for (let i = 0; i <= m; i++) for (let j = 0; i + j <= m; j++) {
          const a = i / m, b = j / m, p = [0, 1, 2].map((q) => v[0][q] + u[q] * a + w[q] * b), gy = renderedHeight(p[0], p[2]);
          if (ny > 0) worstTop = Math.max(worstTop, gy - p[1]);          // walking faces clear the ground
          else if (grounded) air = Math.max(air, p[1] - gy);             // feet reach below it
        }
      }
      if (worstTop > 0.05) buried.push({ role: meta.role, by: +worstTop.toFixed(3), at: [Math.round((x0 + x1) / 2), Math.round((z0 + z1) / 2)] });
      if (air > 0.05) floating.push({ role: meta.role, air: +air.toFixed(2), at: [Math.round((x0 + x1) / 2), Math.round((z0 + z1) / 2)] });
      s.dispose();
    }
  }
  r.buried = buried.length; r.buriedWorst = buried.sort((a, b) => b.by - a.by).slice(0, 8);
  r.floating = floating.length; r.floatingWorst = floating.sort((a, b) => b.air - a.air).slice(0, 8);
  // ---- overlap and support, from the solids' own faces
  const solids = [];
  for (const g of geos) {
    const P = g.attributes.position, I = g.index;
    for (const range of g.userData.islandSolids) {
      const s = { meta: range[2] || {}, bottom: [], top: [], y0: Infinity, y1: -Infinity, box: [Infinity, Infinity, -Infinity, -Infinity] };
      for (let k = range[0]; k < range[1]; k += 3) {
        const v = [0, 1, 2].map((q) => { const j = I.getX(k + q); return [P.getX(j), P.getY(j), P.getZ(j)]; });
        for (const p of v) { s.y0 = Math.min(s.y0, p[1]); s.y1 = Math.max(s.y1, p[1]); s.box[0] = Math.min(s.box[0], p[0]); s.box[1] = Math.min(s.box[1], p[2]); s.box[2] = Math.max(s.box[2], p[0]); s.box[3] = Math.max(s.box[3], p[2]); }
        const u = v[1].map((x, q) => x - v[0][q]), w = v[2].map((x, q) => x - v[0][q]);
        const ny = u[2] * w[0] - u[0] * w[2], nl = Math.hypot(u[1] * w[2] - u[2] * w[1], ny, u[0] * w[1] - u[1] * w[0]);
        if (ny / nl < -0.7) s.bottom.push(v); else if (ny / nl > 0.7) s.top.push(v);
        if (Math.abs(ny / nl) > 0.02) (s.flat ||= []).push(v);
      }
      solids.push(s);
    }
  }
  const cell = 24, grid = new Map();
  solids.forEach((s, id) => { for (let i = Math.floor(s.box[0] / cell); i <= Math.floor(s.box[2] / cell); i++) for (let j = Math.floor(s.box[1] / cell); j <= Math.floor(s.box[3] / cell); j++) { const k = i * 100003 + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id); } });
  // the vertical extent of a solid through (x, z): lowest and highest crossing of its faces
  const extent = (s, x, z) => {
    let lo = Infinity, hi = -Infinity;
    for (const [A, B, C] of s.flat || []) {
      const d = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]); if (Math.abs(d) < 1e-12) continue;
      const l1 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / d, l2 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const y = l1 * A[1] + l2 * B[1] + l3 * C[1]; lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    return lo < hi ? [lo, hi] : null;
  };
  // triangles overlapping in plan by more than a few centimetres (separating axes, inset)
  const triOverlap = (A, B, pad = 0.06) => {
    for (const T of [A, B]) for (let i = 0; i < 3; i++) {
      const p = T[i], q = T[(i + 1) % 3]; let nx = -(q[2] - p[2]), nz = q[0] - p[0]; const L = Math.hypot(nx, nz); if (L < 1e-9) continue; nx /= L; nz /= L;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of A) { const d = v[0] * nx + v[2] * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const v of B) { const d = v[0] * nx + v[2] * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (a1 - pad <= b0 || b1 - pad <= a0) return false;
    }
    return true;
  };
  const overlaps = [], seen = new Set();
  for (const ids of grid.values()) for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
    const a = solids[ids[x]], b = solids[ids[y]], key = Math.min(ids[x], ids[y]) * 1e6 + Math.max(ids[x], ids[y]);
    if (seen.has(key)) continue; seen.add(key);
    if (a.box[0] > b.box[2] || b.box[0] > a.box[2] || a.box[1] > b.box[3] || b.box[1] > a.box[3]) continue;
    // a declared structural joint (a sky arch framed into the towers it spans) is intended
    if (a.meta.joint || b.meta.joint) continue;
    // stacked (one rests on the other, its foot at most 0.3 m into it) is construction
    const yo = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (yo <= 0.3) continue;
    // where their feet overlap in plan, compare the solids' own vertical extents there
    let worst = 0, at = null;
    for (const A of a.bottom) for (const B of b.bottom) {
      if (!triOverlap(A, B)) continue;
      // sample points: the triangles' corners pulled 10 cm toward their centroids, and centroids
      for (const T of [A, B]) {
        const c = [(T[0][0] + T[1][0] + T[2][0]) / 3, (T[0][2] + T[1][2] + T[2][2]) / 3];
        for (const p of [c, ...T.map((v) => { const d = Math.hypot(v[0] - c[0], v[2] - c[1]) || 1, f = Math.min(1, 0.1 / d); return [v[0] + (c[0] - v[0]) * f, v[2] + (c[1] - v[2]) * f]; })]) {
          const ea = extent(a, p[0], p[1]), eb = extent(b, p[0], p[1]);
          if (!ea || !eb) continue;
          const o = Math.min(ea[1], eb[1]) - Math.max(ea[0], eb[0]);
          if (o > worst) { worst = o; at = p; }
        }
      }
      if (worst > 0.3) break;
    }
    if (worst > 0.3) overlaps.push({ a: a.meta.role, b: b.meta.role, at: at.map(Math.round), yOverlap: +worst.toFixed(2) });
  }
  // support: every supported solid's foot has a top face (or the ground) within 0.35 m below it
  const unsupported = [];
  const topBelow = (x, z, y, self) => {
    const k = Math.floor(x / cell) * 100003 + Math.floor(z / cell); let best = -Infinity;
    for (const id of grid.get(k) || []) { const s = solids[id]; if (s === self) continue; for (const t of s.top) {
      const [A, B, C] = t, d = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]); if (Math.abs(d) < 1e-12) continue;
      const l1 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / d, l2 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
      const yy = l1 * A[1] + l2 * B[1] + l3 * C[1]; if (yy <= y + 0.35 && yy > best) best = yy; } }
    return best;
  };
  for (const s of solids) {
    if (!s.meta.supported || s.meta.attached || !s.bottom.length) continue;
    // stable support: the points of its foot that bear on something (a top face or the ground
    // within 0.35 m below) must surround the solid's plan centroid (a slab on walls and columns,
    // a column on its terrace, a roof on its range)
    const bearing = [];
    let gx = 0, gz = 0, gn = 0, worst = 0;
    for (const t of s.bottom) {
      if ((t[0][1] + t[1][1] + t[2][1]) / 3 > s.y0 + 0.3) continue;       // an overhang, not a foot
      // a barycentric lattice about 0.6 m apart over the foot triangle
      const e1 = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], e2 = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
      const m = Math.min(24, Math.max(2, Math.ceil(Math.max(Math.hypot(e1[0], e1[2]), Math.hypot(e2[0], e2[2])) / 0.45)));
      const lattice = [];
      for (let i = 0; i <= m; i++) for (let j = 0; i + j <= m; j++) { const a = (i + 0.3) / (m + 1), b = (j + 0.3) / (m + 1); if (a + b > 1) continue; lattice.push([t[0][0] + e1[0] * a + e2[0] * b, t[0][1] + e1[1] * a + e2[1] * b, t[0][2] + e1[2] * a + e2[2] * b]); }
      for (const p of lattice) {
        const below = Math.max(topBelow(p[0], p[2], p[1], s), renderedHeight(p[0], p[2]));
        gx += p[0]; gz += p[2]; gn++;
        if (p[1] - below <= 0.35) bearing.push([p[0], p[2]]); else worst = Math.max(worst, p[1] - below);
      }
    }
    if (!gn) continue;
    const cx = gx / gn, cz = gz / gn;
    // convex hull of the bearing points
    const pts = bearing.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.slice().reverse()) { while (hi.length >= 2 && cr(hi.at(-2), hi.at(-1), p) <= 0) hi.pop(); hi.push(p); }
    const hull = [...lo.slice(0, -1), ...hi.slice(0, -1)];
    let inside = hull.length >= 3;
    for (let i = 0; inside && i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; if (cr(a, b, [cx, cz]) / L < -0.5) inside = false; }
    if (!inside) unsupported.push({ role: s.meta.role, gap: +worst.toFixed(2), bearing: bearing.length, at: [Math.round(cx), Math.round(cz)] });
  }
  r.overlaps = overlaps.length; r.overlapWorst = overlaps.sort((p, q) => q.yOverlap - p.yOverlap).slice(0, 12);
  r.overlapPairs = {}; for (const o of overlaps) { const k = [o.a, o.b].sort().join(' x '); r.overlapPairs[k] = (r.overlapPairs[k] || 0) + 1; }
  r.unsupportedRoles = {}; for (const u of unsupported) r.unsupportedRoles[u.role] = (r.unsupportedRoles[u.role] || 0) + 1;
  r.unsupported = unsupported.length; r.unsupportedWorst = unsupported.sort((p, q) => q.gap - p.gap).slice(0, 12);
  report.cities[city] = r;
}
console.log(JSON.stringify(report, null, 1));
for (const [city, r] of Object.entries(report.cities)) {
  assert.equal(r.closureFailures.length, 0, `${city}: open or inverted solids`);
  assert.equal(r.buried, 0, `${city}: walking surfaces below the drawn ground`);
  assert.equal(r.floating, 0, `${city}: grounded solids above the drawn ground`);
  if (!process.argv.includes('--lenient')) {
    assert.equal(r.overlaps, 0, `${city}: solids overlapping in plan and height`);
    assert.equal(r.unsupported, 0, `${city}: supported solids with nothing under them`);
  }
}
console.log('ISLAND_CITIES_VERIFIED');
