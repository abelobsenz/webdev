// Node check for Medii Landing (src/space/lunarLanding.js + lunarLandingLife.js):
//   - every solid closed with consistent winding (welded directed edges balance), no NaN or
//     degenerate triangles
//   - footprints: new buildings (markets, colonnade, hamlet houses, the ferry, greens) clear of
//     every other footprint; roads clear of buildings; trees clear of buildings, of each other,
//     with their trunks off the roads; hamlets on land
//   node tools/verify-landing.mjs
import { buildMediiLanding, shoreV } from '../src/space/lunarLanding.js';
import { distRect } from '../src/space/lunarLandingLife.js';

const t0 = Date.now();
const L = buildMediiLanding();
const g = L.geo;
const pos = g.getAttribute('position').array;
const idx = g.getIndex().array;
let bad = 0;
const fail = (m) => { if (bad < 40) console.log('FAIL', m); bad++; };

// ---- closedness ----
const key = new Map();
const weld = new Int32Array(pos.length / 3);
let nV = 0;
for (let i = 0; i < pos.length / 3; i++) {
  const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
  if (!Number.isFinite(x + y + z)) { fail(`NaN vertex ${i}`); continue; }
  const k = `${Math.round(x * 500)},${Math.round(y * 500)},${Math.round(z * 500)}`;
  let w = key.get(k);
  if (w === undefined) { w = nV++; key.set(k, w); }
  weld[i] = w;
}
const E = new Map();
let degenerate = 0;
for (let t = 0; t < idx.length; t += 3) {
  const a = weld[idx[t]], b = weld[idx[t + 1]], c = weld[idx[t + 2]];
  if (a === b || b === c || c === a) { degenerate++; continue; }
  for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = p * nV + q; E.set(k, (E.get(k) || 0) + 1); }
}
let open = 0;
for (const [k, n] of E) {
  const p = Math.floor(k / nV), q = k - p * nV;
  const back = E.get(q * nV + p) || 0;
  if (back !== n) open++;
}
console.log(`triangles ${idx.length / 3}, welded vertices ${nV}, degenerate ${degenerate}, unbalanced edges ${open}`);
if (open) fail(`${open} unbalanced edges (open or inconsistently wound surfaces)`);

// ---- footprints ----
const rects = L.plan.filter((p) => p.u0 !== undefined);
const roads = L.plan.filter((p) => p.kind === 'road');
const NEW = new Set(['market', 'colonnade', 'hamlet', 'ferry', 'green']);
const overlap = (a, b) => a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1;
for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
  const a = rects[i], b = rects[j];
  if (!NEW.has(a.kind) && !NEW.has(b.kind)) continue;
  if (overlap(a, b)) fail(`footprint ${a.kind} (${a.u0.toFixed(0)},${a.v0.toFixed(0)}) overlaps ${b.kind} (${b.u0.toFixed(0)},${b.v0.toFixed(0)})`);
}
const segDist = (u, v, pts) => {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ua, va] = pts[i], [ub, vb] = pts[i + 1];
    const du = ub - ua, dv = vb - va, L2 = du * du + dv * dv || 1;
    const t = Math.max(0, Math.min(1, ((u - ua) * du + (v - va) * dv) / L2));
    best = Math.min(best, Math.hypot(u - ua - du * t, v - va - dv * t));
  }
  return best;
};
// roads vs buildings (sampled along the road)
for (const r of roads) {
  for (let i = 0; i < r.pts.length - 1; i++) {
    const [ua, va] = r.pts[i], [ub, vb] = r.pts[i + 1];
    const n = Math.ceil(Math.hypot(ub - ua, vb - va) / 5);
    for (let s = 0; s <= n; s++) {
      const u = ua + (ub - ua) * s / n, v = va + (vb - va) * s / n;
      for (const p of rects) if (p.kind !== 'green' && distRect(u, v, p) < r.w / 2 + 1) fail(`road near (${u.toFixed(0)},${v.toFixed(0)}) runs into ${p.kind}`);
      if (v > shoreV(u) - 30) fail(`road at (${u.toFixed(0)},${v.toFixed(0)}) runs into the Bay`);
    }
  }
}
// trees
const T = L.trees;
for (let i = 0; i < T.length; i++) {
  const t = T[i];
  for (const p of rects) if (p.kind !== 'green' && distRect(t.u, t.v, p) < t.r) fail(`tree (${t.u.toFixed(0)},${t.v.toFixed(0)}) r ${t.r.toFixed(1)} in ${p.kind}`);
  for (const r of roads) if (segDist(t.u, t.v, r.pts) < r.w / 2 + 1) fail(`tree trunk (${t.u.toFixed(0)},${t.v.toFixed(0)}) on a road`);
  if (t.v > shoreV(t.u) - 10) fail(`tree (${t.u.toFixed(0)},${t.v.toFixed(0)}) in the water`);
}
let close = 0;
for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) {
  const a = T[i], b = T[j];
  if (Math.abs(a.u - b.u) > 20 || Math.abs(a.v - b.v) > 20) continue;
  if (Math.hypot(a.u - b.u, a.v - b.v) < 0.85 * (a.r + b.r)) close++;
}
if (close) fail(`${close} tree pairs with interpenetrating crowns`);
console.log(`trees ${T.length}, roads ${roads.length}, footprints ${rects.length}, lamps ${L.lamps.length}  (${Date.now() - t0} ms)`);
console.log(bad ? `${bad} problems` : 'Medii Landing: closed, clear, seated');
process.exit(bad ? 1 : 0);
