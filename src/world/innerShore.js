import { ISLANDS } from './layout.js';
import { ST } from './urban.js';

// The shore promenades of the inner islands. The towns stop at their outer ring roads and the
// land falls away through meadow and beach to the lagoon; the wards meet the water with quays
// and seaside walks, so here a promenade follows each island's shore along the contour a few
// metres above the beach. It is laid as an esplanade in the town plan before the street field is
// baked, so it is paved and kerbed like any street, walked by the island's people, planted with
// its palms (treePlanner.js) and hedged (groundCover.js); its lamps stand on the landward verge.
// It breaks wherever it would touch a lot, a square, a station, an arcology's base, a civic
// park or ground too steep for a walk, and pieces too short to be worth walking are dropped.

const TAU = Math.PI * 2;
const LEVEL = 3.4;          // the contour it follows (m above the lagoon)
const HW = 4.2;             // half-width of the walk
const STEP = 6;             // resampling step along the walk (m)

export function planShorePromenades(plan, ground, towers = [], exclusions = []) {
  const F = plan.field, lots = plan.lots, out = [];
  const lotGrid = new Map(), G = 40;
  for (const L of lots) { const k = Math.floor(L.x / G) * 100003 + Math.floor(L.z / G); if (!lotGrid.has(k)) lotGrid.set(k, []); lotGrid.get(k).push(L); }
  const nearLot = (x, z, r) => {
    for (let i = Math.floor((x - r - 30) / G); i <= Math.floor((x + r + 30) / G); i++) for (let j = Math.floor((z - r - 30) / G); j <= Math.floor((z + r + 30) / G); j++)
      for (const L of lotGrid.get(i * 100003 + j) || []) if (Math.hypot(L.x - x, L.z - z) < Math.hypot(L.w, L.d) * 0.5 + r) return true;
    return false;
  };
  const lampGrid = new Map();
  for (const l of plan.lamps) { const k = Math.floor(l.x / 16) * 100003 + Math.floor(l.z / 16); if (!lampGrid.has(k)) lampGrid.set(k, []); lampGrid.get(k).push(l); }
  const nearLamp = (x, z, r) => {
    for (let i = Math.floor((x - r) / 16); i <= Math.floor((x + r) / 16); i++) for (let j = Math.floor((z - r) / 16); j <= Math.floor((z + r) / 16); j++)
      for (const l of lampGrid.get(i * 100003 + j) || []) if (Math.hypot(l.x - x, l.z - z) < r) return true;
    return false;
  };
  const blocked = (x, z) => {
    if (F.squareAt(x, z) > 0.01 || F.edge(x, z) < HW + 1.5 || nearLamp(x, z, HW + 1)) return true;
    if (nearLot(x, z, HW + 2.5)) return true;
    for (const t of towers) if (Math.hypot(t.def.x - x, t.def.z - z) < (t.collide ? t.collide(1) : 80) + HW + 6) return true;
    for (const e of exclusions) if (Math.hypot(e.x - x, e.z - z) < e.r + HW + 4) return true;
    for (const p of plan.civicParks || []) if (Math.hypot(p.x - x, p.z - z) < p.landmarkR + 14) return true;
    return false;
  };
  for (const isl of ISLANDS) {
    const loop = shoreLoop(isl, ground);
    if (!loop) continue;
    // cut into runs of walkable points
    let run = [];
    const flush = () => {
      if (run.length * STEP >= 60) {
        const st = { pts: run, cls: ST.ESPLANADE, hw: HW, district: isl.id, name: `${isl.name} Shore Walk` };
        plan.streets.push(st);
        F.polyline(run, HW);
        out.push(st);
        // lamps on the landward verge every ~24 m (the side toward the island's centre)
        for (let i = 2; i < run.length - 2; i += 4) {
          const [x, z] = run[i], [x0, z0] = run[i - 1], [x1, z1] = run[i + 1];
          let nx = -(z1 - z0), nz = x1 - x0; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
          if ((isl.x - x) * nx + (isl.z - z) * nz < 0) { nx = -nx; nz = -nz; }
          const lx = x + nx * (HW + 1.3), lz = z + nz * (HW + 1.3);
          if (!nearLot(lx, lz, 1.5) && ground(lx, lz) > 2.0 && F.edge(lx, lz) > 0.6 && F.squareAt(lx, lz) < 0.01) plan.lamps.push({ x: lx, z: lz, yaw: Math.atan2(-nx, -nz), cls: ST.ESPLANADE });
        }
      }
      run = [];
    };
    for (let i = 0; i < loop.length; i++) {
      const [x, z] = loop[i];
      const prev = loop[(i - 1 + loop.length) % loop.length];
      const grade = Math.abs(ground(x, z) - ground(prev[0], prev[1])) / STEP;
      if (blocked(x, z) || grade > 0.09 || ground(x, z) < 2.2) flush(); else run.push([x, z]);
    }
    flush();
  }
  // last word on the verges: no lamp may be left standing in a carriageway (the walks
  // and civic lanes laid over the finished plan can cover one)
  for (let i = plan.lamps.length - 1; i >= 0; i--) { const l = plan.lamps[i]; if (F.edge(l.x, l.z) < -0.2) plan.lamps.splice(i, 1); }
  return out;
}

/** The island's shore contour at LEVEL: the longest closed loop round its centre, resampled. */
function shoreLoop(isl, ground) {
  const S = 8, R = isl.r * 1.9, n = Math.ceil((2 * R) / S) + 1, x0 = isl.x - R, z0 = isl.z - R;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = ground(x0 + i * S, z0 + j * S) - LEVEL;
  // marching squares: one segment per crossed cell edge pair, chained by shared edge points
  const key = (i, j, e) => `${i},${j},${e}`;          // e: 0 = horizontal edge from (i,j), 1 = vertical
  const pt = (i, j, e) => {
    const a = h[j * n + i], b = e ? h[(j + 1) * n + i] : h[j * n + i + 1], t = a / (a - b);
    return e ? [x0 + i * S, z0 + (j + t) * S] : [x0 + (i + t) * S, z0 + j * S];
  };
  const adj = new Map();
  const link = (p, q) => { (adj.get(p) || adj.set(p, []).get(p)).push(q); (adj.get(q) || adj.set(q, []).get(q)).push(p); };
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const c = [h[j * n + i] > 0, h[j * n + i + 1] > 0, h[(j + 1) * n + i + 1] > 0, h[(j + 1) * n + i] > 0];
    const edges = [];
    if (c[0] !== c[1]) edges.push(key(i, j, 0));
    if (c[1] !== c[2]) edges.push(key(i + 1, j, 1));
    if (c[3] !== c[2]) edges.push(key(i, j + 1, 0));
    if (c[0] !== c[3]) edges.push(key(i, j, 1));
    if (edges.length === 2) link(edges[0], edges[1]);
    else if (edges.length === 4) { link(edges[0], edges[1]); link(edges[2], edges[3]); }
  }
  // chain loops; keep the longest one that encloses the island's centre
  const seen = new Set();
  let best = null;
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const chain = [start]; seen.add(start);
    let cur = start, prev = null;
    for (;;) {
      const nb = (adj.get(cur) || []).filter((q) => q !== prev && !seen.has(q));
      if (!nb.length) break;
      prev = cur; cur = nb[0]; seen.add(cur); chain.push(cur);
    }
    if (chain.length < 40) continue;
    const pts = chain.map((k) => { const [i, j, e] = k.split(',').map(Number); return pt(i, j, e); });
    let wind = 0;
    for (let k = 0; k < pts.length; k++) { const a = pts[k], b = pts[(k + 1) % pts.length]; wind += Math.atan2((a[0] - isl.x) * (b[1] - isl.z) - (a[1] - isl.z) * (b[0] - isl.x), (a[0] - isl.x) * (b[0] - isl.x) + (a[1] - isl.z) * (b[1] - isl.z)); }
    if (Math.abs(wind) > Math.PI && (!best || pts.length > best.length)) best = pts;
  }
  if (!best) return null;
  // smooth and resample at STEP
  let pts = best;
  for (let it = 0; it < 3; it++) pts = pts.map((p, k) => { const a = pts[(k - 1 + pts.length) % pts.length], b = pts[(k + 1) % pts.length]; return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4]; });
  const outP = [pts[0]]; let acc = 0;
  for (let k = 1; k <= pts.length; k++) {
    const a = pts[k - 1], b = pts[k % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    acc += L;
    while (acc >= STEP) { acc -= STEP; const t = 1 - acc / L; outP.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return outP;
}
