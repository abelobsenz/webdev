import { createFacadeMaterial } from '../facade.js';
import { patchedMaterial } from '../materials.js';
import { renderedHeight } from '../outerCities.js';
import { contourLines, resample } from '../massifTowns.js';
import { Solids, Drape, Instances, FIELD_COL, drapeMaterial, instancedDetailMaterial, prototypes, buildLayerLOD } from '../islands/kit.js';
import { terrainPieces } from '../islands/countryside.js';
import { OCC, hash2, habitat, markCultivated, inHills, onPlatform, sstep } from './cover.js';

// The cultivated terraces of the massif's lagoon face, the landscape the capital looks at:
// vineyards, olive groves, citrus and fruit orchards and market gardens stepping up the slopes
// round the three terrace towns and the hill villages between them, and hedged fields on the
// gentler ground by the shore.
//
// A terrace system is traced from the drawn ground itself: the contour lines of a patch of
// hillside, one every bench's fall, each carrying a level bench that follows it round every spur
// and hollow. A bench is a chain of closed stone sections, each a convex solid whose back edge
// lies on its contour, whose level top stands a hand's breadth over the highest drawn ground
// under it (so no terrain shows through), and whose front is the dry-stone retaining wall,
// founded 0.6 m below the lowest ground; the bench above starts on (or just behind) its back
// edge. Flights of stone steps climb the risers, cypresses mark the foot of the systems. The
// crops are rooted in the benches: vine rows along the contour, olive, citrus and fruit trees
// down the middle of the wider benches, vegetable beds in the gardens, all on a grassed (or
// bedded) finish laid on each bench top. The gentle fields by the shore are drapes cut exactly
// to the terrain's triangles, hedged or walled with founded runs, grown as field systems of
// abutting fields three metres apart.
//
// Everything is placed on free ground only: clear of every road, field, wall, house, town,
// pylon and reserved clearing (the built occupancy survey) and of every other system (exact
// polygon claims), never in the water, never in a wooded ravine; the ground it takes is marked
// cultivated so the woods and the terrain's forest floor leave it open.

const TAU = Math.PI * 2;
const BAND = { x0: -11800, x1: 9800, z0: -13900, z1: -8400 };

const rect = (x, z, ax, az, hl, hw) => { const sx = -az, sz = ax; return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + ax * a * hl + sx * b * hw, z + az * a * hl + sz * b * hw]); };
function frame(x, z, e = 18) {
  const gx = (renderedHeight(x + e, z) - renderedHeight(x - e, z)) / (2 * e), gz = (renderedHeight(x, z + e) - renderedHeight(x, z - e)) / (2 * e);
  const s = Math.hypot(gx, gz);
  return { ang: s > 1e-4 ? Math.atan2(gx, -gz) : 0, s, gx, gz };
}
const convex = (q) => {
  let sg = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length], c = q[(i + 2) % q.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 0.05) return false;
    if (sg && Math.sign(cr) !== sg) return false;
    sg = Math.sign(cr);
  }
  return true;
};

export function buildHillTerraces(scene, occ, towns, villages = [], farms = []) {
  const stats = { systems: 0, fieldSystems: 0, benches: 0, sections: 0, vines: 0, olives: 0, orchards: 0, gardens: 0, flat: 0, stairs: 0, cypresses: 0 };
  const records = { fields: [], benches: [], sections: [], stairs: [], trees: [], runs: [] };
  const CH = 2000, chunks = new Map();
  const chunk = (x, z) => {
    const k = Math.floor(x / CH) * 65536 + Math.floor(z / CH);
    if (!chunks.has(k)) chunks.set(k, { arch: new Solids(null, 'Hill farmland: architecture'), stone: new Solids(null, 'Hill farmland: stonework'), drape: new Drape(), walls: new Instances(), trees: new Instances(), cyp: new Instances() });
    return chunks.get(k);
  };
  const ground = (x, z) => renderedHeight(x, z);
  const smoothNormal = (x, z) => {
    const dx = ground(x + 8, z) - ground(x - 8, z), dz = ground(x, z + 8) - ground(x, z - 8), l = Math.hypot(dx, 16, dz);
    return [-dx / l, 16 / l, -dz / l];
  };
  const UP = [0, 1, 0];
  /** Exact lowest and highest drawn ground over the convex polygon q: the terrain is planar on
   *  each of its triangles, so the extremes lie on the vertices of q cut along them. */
  const exactRange = (q) => {
    let lo = Infinity, hi = -Infinity;
    terrainPieces(q, (poly) => { for (const [x, z] of poly) { const h = ground(x, z); if (h < lo) lo = h; if (h > hi) hi = h; } });
    return { lo, hi };
  };
  // a founded run of wall or hedge along the ground (the islands' rule: bottom 0.45 under the
  // lowest ground at each end and every hollow between, top h over the highest ground)
  const groundRun = (C, p0, p1, h, t, kind, seg = 14, foot = 0.45) => {
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), n = Math.max(1, Math.ceil(L / seg));
    const nx = -(p1[1] - p0[1]) / (L || 1) * t / 2, nz = (p1[0] - p0[0]) / (L || 1) * t / 2;
    const span = (a) => { let lo = Infinity, hi = -Infinity; for (const w of [-1, 0, 1]) { const y = ground(a[0] + nx * w, a[1] + nz * w); lo = Math.min(lo, y); hi = Math.max(hi, y); } return [lo, hi]; };
    let sa = span(p0);
    for (let k = 0; k < n; k++) {
      const a = [p0[0] + ((p1[0] - p0[0]) * k) / n, p0[1] + ((p1[1] - p0[1]) * k) / n], b = [p0[0] + ((p1[0] - p0[0]) * (k + 1)) / n, p0[1] + ((p1[1] - p0[1]) * (k + 1)) / n];
      const sb = span(b);
      let ya = sa[0] - foot, yb = sb[0] - foot, H = Math.max(sa[1] - ya, sb[1] - yb);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ns = Math.max(4, Math.ceil(len / 1.0));
      for (let q = 1; q < ns; q++) {
        const f = q / ns, m = span([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]), yb0 = ya + (yb - ya) * f;
        if (m[0] - foot < yb0) { const d = yb0 - (m[0] - foot); ya -= d; yb -= d; }
        H = Math.max(H, m[1] - (ya + (yb - ya) * f));
      }
      for (let q = 0; q <= ns; q++) { const f = q / ns, m = span([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); H = Math.max(H, m[1] - (ya + (yb - ya) * f)); }
      H += h;
      C.walls.run(a, ya, b, yb, H, t, kind);
      records.runs.push({ a, b, ya, yb, H, t, kind });
      sa = sb;
    }
  };
  // a finish over the rectangle P(u, v): cut along the terrain's triangles, `lift` over each
  const drapeTerrain = (C, P, hl, hw, col, kind, lift = 0.08) => {
    const o = P(0, 0), pu = P(1, 0), pv = P(0, 1), ax = pu[0] - o[0], az = pu[1] - o[1], sx = pv[0] - o[0], sz = pv[1] - o[1];
    C.drape.extent(hl, hw);
    terrainPieces([P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw)], (poly) => {
      const ids = poly.map(([x, z]) => { const du = x - o[0], dv = z - o[1]; return C.drape.vert(x, ground(x, z) + lift, z, smoothNormal(x, z), col, du * ax + dv * az, du * sx + dv * sz, kind); });
      const up = ((poly[1][1] - poly[0][1]) * (poly[2][0] - poly[0][0]) - (poly[1][0] - poly[0][0]) * (poly[2][1] - poly[0][1])) > 0;
      for (let k = 1; k < ids.length - 1; k++) { if (up) C.drape.tri(ids[0], ids[k], ids[k + 1]); else C.drape.tri(ids[0], ids[k + 1], ids[k]); }
    });
    C.drape.extent();
  };
  // a level finish over a bench section (planar quad, explicit u/v per corner)
  const drapeQuad = (C, q, uv, y, col, kind, ext) => {
    C.drape.extent(ext[0], ext[1]);
    const ids = q.map(([x, z], i) => C.drape.vert(x, y, z, UP, col, uv[i][0], uv[i][1], kind));
    const up = ((q[1][1] - q[0][1]) * (q[2][0] - q[0][0]) - (q[1][0] - q[0][0]) * (q[2][1] - q[0][1])) > 0;
    if (up) { C.drape.tri(ids[0], ids[1], ids[2]); C.drape.tri(ids[0], ids[2], ids[3]); } else { C.drape.tri(ids[0], ids[2], ids[1]); C.drape.tri(ids[0], ids[3], ids[2]); }
    C.drape.extent();
  };
  const cypress = (C, x, z, h, r) => {
    let g = Infinity;
    for (let q = 0; q < 6; q++) g = Math.min(g, ground(x + Math.cos(q * 1.047) * r * 0.6, z + Math.sin(q * 1.047) * r * 0.6));
    C.cyp.tree(x, g - 0.25, z, r, h, hash2(Math.round(x), Math.round(z), 3) * TAU, 12);
    records.trees.push({ x, z, y: g - 0.25, r, h, cypress: true });
    stats.cypresses++;
  };

  // ---- exact claims between systems: convex polygons in 64 m buckets, separating axes, tagged
  const claims = new Map(), CB = 64;
  const bbox = (q) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of q) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } return [x0, z0, x1, z1]; };
  const sat = (a, b, pad) => {
    for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
      const p = poly[i], r = poly[(i + 1) % poly.length], ax = -(r[1] - p[1]), az = r[0] - p[0], L = Math.hypot(ax, az) || 1;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of a) { const d = (v[0] * ax + v[1] * az) / L; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const v of b) { const d = (v[0] * ax + v[1] * az) / L; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (a1 <= b0 - pad || b1 <= a0 - pad) return false;
    }
    return true;
  };
  const allClaims = [];
  const claim = (q, tag) => { const it = { q, tag }; allClaims.push(it); const [x0, z0, x1, z1] = bbox(q); for (let i = Math.floor(x0 / CB); i <= Math.floor(x1 / CB); i++) for (let j = Math.floor(z0 / CB); j <= Math.floor(z1 / CB); j++) { const k = i * 65536 + j; if (!claims.has(k)) claims.set(k, []); claims.get(k).push(it); } };
  const claimed = (q, pad, skipTag = null) => {
    const [x0, z0, x1, z1] = bbox(q);
    for (let i = Math.floor((x0 - pad) / CB); i <= Math.floor((x1 + pad) / CB); i++) for (let j = Math.floor((z0 - pad) / CB); j <= Math.floor((z1 + pad) / CB); j++)
      for (const o of claims.get(i * 65536 + j) || []) if (o.tag !== skipTag && sat(q, o.q, pad)) return true;
    return false;
  };
  const bad = OCC.FLAT | OCC.LOW | OCC.TALL | OCC.CLEAR | OCC.HOME | OCC.TREE;
  const stoneSolids = [];

  // ---- candidates round the terrace towns, the villages and the farms: the lagoon face (the
  // landscape the capital looks at) most richly, the villages and farms of the hill country
  // beyond it each with its own terraced garden ground; the nearer a settlement the likelier
  const inBand = (x, z) => x > BAND.x0 && x < BAND.x1 && z > BAND.z0 && z < BAND.z1;
  const places = [
    ...towns.map((m) => ({ x: m.town.x, z: m.town.z, r0: 1000, r1: 2600, w: 1 })),
    ...villages.map((v) => inBand(v.x, v.z) ? { x: v.x, z: v.z, r0: v.r + 90, r1: v.r + 900, w: 0.8 } : { x: v.x, z: v.z, r0: v.r + 80, r1: v.r + 560, w: 0.6 }),
    ...farms.map((f) => ({ x: f.x, z: f.z, r0: 70, r1: 300, w: 0.4 })),
  ];
  const PB = 1000, placeCells = new Map();
  for (const p of places) for (let i = Math.floor((p.x - p.r1) / PB); i <= Math.floor((p.x + p.r1) / PB); i++) for (let j = Math.floor((p.z - p.r1) / PB); j <= Math.floor((p.z + p.r1) / PB); j++) { const k = i * 65536 + j; if (!placeCells.has(k)) placeCells.set(k, []); placeCells.get(k).push(p); }
  const nearness = (x, z) => { let near = 0; for (const p of placeCells.get(Math.floor(x / PB) * 65536 + Math.floor(z / PB)) || []) { const d = Math.hypot(x - p.x, z - p.z); if (d > p.r0 * 0.9) near = Math.max(near, p.w * (1 - sstep(p.r0, p.r1, d))); } return near; };
  const cands = [], lattice = new Set();
  for (const p of places) for (let z = Math.floor((p.z - p.r1) / 46) * 46; z < p.z + p.r1; z += 46) for (let x = Math.floor((p.x - p.r1) / 46) * 46; x < p.x + p.r1; x += 46) {
    const key = x * 100003 + z;
    if (lattice.has(key)) continue;
    lattice.add(key);
    const px = x + (hash2(x, z, 41) - 0.5) * 40, pz = z + (hash2(x, z, 42) - 0.5) * 40;
    if (!inHills(px, pz) || onPlatform(px, pz)) continue;
    const near = nearness(px, pz);
    if (near < 0.12) continue;
    const h = ground(px, pz);
    if (h < 8 || h > 900) continue;
    cands.push({ x: px, z: pz, score: near * 1.2 + 0.25 * hash2(px, pz, 43) - h / 2000, near });
  }
  cands.sort((a, b) => b.score - a.score);
  const cropFor = (s, gz, x, z) => {
    const n = hash2(Math.floor(x / 380), Math.floor(z / 380), 45), r = hash2(x, z, 46);
    const sunny = gz < -0.02;           // the slope faces the lagoon (south)
    if (s > 0.26) return sunny && n > 0.4 ? 'vine' : n > 0.7 ? 'vine' : 'olive';
    if (s > 0.14) return n < 0.28 ? 'olive' : n < 0.52 ? 'orchard' : sunny && r < 0.55 ? 'vine' : r < 0.8 ? 'garden' : 'olive';
    if (s > 0.075) return r < 0.3 ? 'orchard' : r < 0.55 ? 'garden' : r < 0.75 ? 'olive' : 'vine';
    return r < 0.3 ? 1 : r < 0.45 ? 3 : r < 0.6 ? 2 : r < 0.75 ? 7 : r < 0.88 ? 9 : 'orchard';
  };

  // ============================================================ contour terrace systems ==
  let sysId = 0;
  const contourSystem = (cx, cz, fr, near) => {
    const tag = 'sys' + sysId++;
    const s = fr.s;
    const crop = cropFor(s, fr.gz, cx, cz);
    // a bench's fall and depth: lower walls on the gentler slopes, benches 3.6 - 12 m deep
    let dh = Math.min(2.2, Math.max(1.2, 0.8 + 3.2 * s)), D = dh / s;
    if (D > 12) { D = 12; dh = D * s; }
    if (D < 3.6) { D = 3.6; dh = D * s; }
    if (dh > 2.6) return 0;
    const R = 36 + (44 + 36 * hash2(cx, cz, 70)) * near;
    // the system's ground: longer along the contour than up the slope, its edge wandering
    // (a spur, a hollow, an old boundary), never a circle
    const ca = Math.cos(fr.ang), sa = Math.sin(fr.ang), Ra = R * 1.55, Rb = R * 0.72, ph = hash2(cx, cz, 71) * TAU;
    const inside = (x, z, m) => {
      const dx = x - cx, dz = z - cz, u = dx * ca + dz * sa, v = -dx * sa + dz * ca, th = Math.atan2(v / Rb, u / Ra);
      const edge = 0.78 + 0.16 * Math.sin(3 * th + ph) + 0.08 * Math.sin(5 * th + ph * 2.3) + 0.06 * Math.sin(8 * th - ph);
      return Math.hypot(u / Ra, v / Rb) < edge + m / Rb;
    };
    const G = 7, E = Ra + D + 12, N = Math.ceil((2 * E) / G) + 1, X0 = cx - E, Z0 = cz - E;
    const hg = new Float32Array(N * N);
    let hmin = Infinity, hmax = -Infinity;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const h = ground(X0 + i * G, Z0 + j * G); hg[j * N + i] = h; if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
    if (hmin < 6) return 0;
    const gradAt = (x, z) => {
      const i = Math.min(N - 2, Math.max(1, Math.round((x - X0) / G))), j = Math.min(N - 2, Math.max(1, Math.round((z - Z0) / G)));
      return [(hg[j * N + i + 1] - hg[j * N + i - 1]) / (2 * G), (hg[(j + 1) * N + i] - hg[(j - 1) * N + i]) / (2 * G)];
    };
    const benches = [];
    const L0 = Math.ceil(hmin / dh) * dh;
    for (let L = L0; L < hmax; L += dh) {
      for (const line of contourLines(hg, N, G, X0, Z0, L)) {
        const pts = resample(line, 9);
        if (pts.length < 4) continue;
        const raw = pts.map((P) => { const g = gradAt(P[0], P[1]), l = Math.hypot(g[0], g[1]); return { l, n: l > 1e-4 ? [-g[0] / l, -g[1] / l] : null }; });
        const secs = pts.map((P, k) => {
          let nx = 0, nz = 0;
          for (let q = Math.max(0, k - 1); q <= Math.min(pts.length - 1, k + 1); q++) if (raw[q].n) { nx += raw[q].n[0]; nz += raw[q].n[1]; }
          const nl = Math.hypot(nx, nz);
          if (nl < 1e-3 || raw[k].l < 0.06 || raw[k].l > 0.62) return null;
          const n = [nx / nl, nz / nl], F = [P[0] + n[0] * D, P[1] + n[1] * D];
          if (!inside(P[0], P[1], 0) || !inside(F[0], F[1], 3)) return null;
          return { P, F, n };
        });
        // runs of sections: convex, unfolded, free, a wall a man can build
        let run = [];
        const flush = () => { if (run.length >= 3) benches.push({ L, secs: run }); run = []; };
        for (let k = 0; k < secs.length; k++) {
          const a = secs[k - 1], b = secs[k];
          if (!b) { flush(); continue; }
          if (!a || !run.length) { flush(); run = [b]; continue; }
          const q = [a.P, b.P, b.F, a.F];
          let ok = convex(q) && Math.hypot(b.F[0] - a.F[0], b.F[1] - a.F[1]) > 1.5;
          if (ok) ok = occ.polyFree(q, 2.2, bad) && !claimed(q, 2.5, tag);
          if (ok) { const g = exactRange(q); ok = g.lo > 4 && g.hi < L + 0.45 && L + 0.06 - g.lo < 3.6; b.g = g; }
          if (!ok) { flush(); run = [b]; continue; }
          run.push(b);
        }
        flush();
      }
    }
    if (benches.length < 3) return 0;
    const kind = crop === 'garden' ? 9 : 6;
    let built = 0;
    benches.forEach((b, bi) => {
      // the run's level: over the highest ground of any of its sections
      let top = b.L + 0.06;
      for (let k = 1; k < b.secs.length; k++) top = Math.max(top, b.secs[k].g.hi + 0.06);
      b.top = top;
      const arc = [0];
      for (let k = 1; k < b.secs.length; k++) arc.push(arc[k - 1] + Math.hypot(b.secs[k].P[0] - b.secs[k - 1].P[0], b.secs[k].P[1] - b.secs[k - 1].P[1]));
      b.arc = arc; b.len = arc.at(-1);
      const tint = 0.9 + 0.2 * hash2(bi, cx, 51), col = FIELD_COL[kind].map((v, i) => v * tint * (crop === 'vine' ? [1.08, 1.0, 0.86][i] : 1));
      for (let k = 1; k < b.secs.length; k++) {
        const a = b.secs[k - 1], c = b.secs[k], q = [a.P, c.P, c.F, a.F];
        const bottom = c.g.lo - 0.6;
        const C = chunk((a.P[0] + c.F[0]) / 2, (a.P[1] + c.F[1]) / 2);
        C.stone.prism(q, bottom, top, 1, 1, bottom);
        stoneSolids.push({ q, bottom, top });
        records.sections.push({ q, bottom, top, L: b.L, system: tag });
        claim(q, tag);
        const hl = b.len / 2, hw = D / 2;
        drapeQuad(C, q, [[arc[k - 1] - hl, -hw], [arc[k] - hl, -hw], [arc[k] - hl, hw], [arc[k - 1] - hl, hw]], top + 0.04, col, kind, [hl, hw]);
        stats.sections++;
      }
      records.benches.push({ L: b.L, top, len: b.len, D, system: tag });
      stats.benches++;
      built++;
    });
    // the sections of every level, indexed (16 m cells), so a plant or a step can ask whether the
    // bench above reaches over it
    const lvIndex = new Map();
    const lvKey = (L, i, j) => `${Math.round(L * 100)}:${i}:${j}`;
    for (const B of benches) for (let k = 1; k < B.secs.length; k++) {
      const q = [B.secs[k - 1].P, B.secs[k].P, B.secs[k].F, B.secs[k - 1].F], bb = bbox(q);
      for (let i = Math.floor(bb[0] / 16); i <= Math.floor(bb[2] / 16); i++) for (let j = Math.floor(bb[1] / 16); j <= Math.floor(bb[3] / 16); j++) {
        const key = lvKey(B.L, i, j); if (!lvIndex.has(key)) lvIndex.set(key, []); lvIndex.get(key).push({ q, B, k });
      }
    }
    const inQuad = (q, x, z, m = 0) => {
      let sg = 0;
      for (let i = 0; i < 4; i++) {
        const p = q[i], r = q[(i + 1) % 4], L = Math.hypot(r[0] - p[0], r[1] - p[1]) || 1, cr = ((r[0] - p[0]) * (z - p[1]) - (r[1] - p[1]) * (x - p[0])) / L;
        if (!sg) sg = Math.sign(cr) || 1;
        if (cr * sg < -m) return false;
      }
      return true;
    };
    /** The section of the bench at level L covering (x, z) within margin m, or null. */
    const sectionAt = (L, x, z, m = 0) => {
      for (const it of lvIndex.get(lvKey(L, Math.floor(x / 16), Math.floor(z / 16))) || []) if (inQuad(it.q, x, z, m)) return it;
      return null;
    };
    /** Is a plant at (x, z) of radius r clear of the bench above (its wall and fill)? */
    const underUpper = (L, x, z, r) => sectionAt(L + dh, x, z, r + 0.15) !== null;
    // flights of steps up the risers (every ~45 m of bench where the bench above stands behind)
    const stairsOn = benches.map(() => []);
    const findUpper = (L, x, z) => sectionAt(L + dh, x, z, 0);
    benches.forEach((b, bi) => {
      for (let u = 12 + 20 * hash2(bi, cz, 72); u < b.len - 8; u += 45) {
        let k = 1; while (k < b.arc.length - 1 && b.arc[k] < u) k++;
        const a = b.secs[k - 1], c = b.secs[k], f = (u - b.arc[k - 1]) / Math.max(1e-6, b.arc[k] - b.arc[k - 1]);
        const P = [a.P[0] + (c.P[0] - a.P[0]) * f, a.P[1] + (c.P[1] - a.P[1]) * f];
        let n = [a.n[0] + (c.n[0] - a.n[0]) * f, a.n[1] + (c.n[1] - a.n[1]) * f]; const nl = Math.hypot(n[0], n[1]); n = [n[0] / nl, n[1] / nl];
        const up = findUpper(b.L, P[0] - n[0] * 0.8, P[1] - n[1] * 0.8);
        if (!up) continue;
        // where the upper bench's front face crosses our line up the slope (f0: metres downhill of P)
        const A = up.q[3], Bq = up.q[2], ex = Bq[0] - A[0], ez = Bq[1] - A[1];
        const den = (-n[0]) * ez - (-n[1]) * ex;
        if (Math.abs(den) < 1e-6) continue;
        const t = ((A[0] - P[0]) * ez - (A[1] - P[1]) * ex) / den;
        const f0 = -t;
        if (f0 < -1.2 || f0 > 1.2) continue;
        const rise = up.B.top - b.top, count = Math.max(2, Math.ceil(rise / 0.19)), tread = 0.3, runL = count * tread;
        if (rise < 0.4 || f0 + runL > D - 0.6) continue;
        const tx = -n[1], tz = n[0];
        const steps = [];
        let ok = true;
        for (let j = 0; j < count; j++) {
          const v0 = f0 + runL - j * tread, v1 = j === count - 1 ? f0 - 0.02 : f0 + runL - (j + 1) * tread;
          const y = j === count - 1 ? up.B.top - 0.004 : b.top + rise * (j + 1) / count;
          const sq = [[P[0] + n[0] * v0 + tx * 0.7, P[1] + n[1] * v0 + tz * 0.7], [P[0] + n[0] * v0 - tx * 0.7, P[1] + n[1] * v0 - tz * 0.7], [P[0] + n[0] * v1 - tx * 0.7, P[1] + n[1] * v1 - tz * 0.7], [P[0] + n[0] * v1 + tx * 0.7, P[1] + n[1] * v1 + tz * 0.7]];
          const g = exactRange(sq);
          if (g.hi > y - 0.02) { ok = false; break; }
          steps.push({ sq, bottom: Math.min(b.top - 0.12, g.lo - 0.15), y });
        }
        if (!ok) continue;
        const C = chunk(P[0], P[1]);
        for (const st of steps) { C.stone.prism(st.sq, st.bottom, st.y, 1, 1, st.bottom); stoneSolids.push({ q: st.sq, bottom: st.bottom, top: st.y, step: true }); }
        stairsOn[bi].push(u);
        records.stairs.push({ x: P[0], z: P[1], n, from: b.top, to: up.B.top, count, f0, steps });
        stats.stairs++;
      }
    });
    // the crops, rooted in the benches (clear of the steps)
    benches.forEach((b, bi) => {
      const clearOfStairs = (u) => stairsOn[bi].every((s) => Math.abs(s - u) > 2.2);
      const at = (u, v) => {
        let k = 1; while (k < b.arc.length - 1 && b.arc[k] < u) k++;
        const a = b.secs[k - 1], c = b.secs[k], f = Math.min(1, Math.max(0, (u - b.arc[k - 1]) / Math.max(1e-6, b.arc[k] - b.arc[k - 1])));
        const P = [a.P[0] + (c.P[0] - a.P[0]) * f, a.P[1] + (c.P[1] - a.P[1]) * f], F = [a.F[0] + (c.F[0] - a.F[0]) * f, a.F[1] + (c.F[1] - a.F[1]) * f];
        return [P[0] + (F[0] - P[0]) * v / D, P[1] + (F[1] - P[1]) * v / D];
      };
      if (crop === 'vine') {
        for (let v = 1.1; v < D - 0.9; v += 2.4) {
          let u = 1.6;
          while (u < b.len - 1.6) {
            const u1 = Math.min(b.len - 1.6, u + 6);
            const p0 = at(u, v), p1 = at(u1, v), pm = at((u + u1) / 2, v);
            if (u1 - u > 0.5 && clearOfStairs(u) && clearOfStairs(u1) && clearOfStairs((u + u1) / 2) && !underUpper(b.L, p0[0], p0[1], 0.3) && !underUpper(b.L, p1[0], p1[1], 0.3) && !underUpper(b.L, pm[0], pm[1], 0.3)) {
              const C = chunk(p0[0], p0[1]);
              C.walls.run(p0, b.top - 0.2, p1, b.top - 0.2, 1.62, 0.55, 3);
              records.runs.push({ a: p0, b: p1, ya: b.top - 0.2, yb: b.top - 0.2, H: 1.62, t: 0.55, kind: 3, bench: true });
            }
            u = u1 + 0.001;
          }
          stats.vines++;
        }
      } else if ((crop === 'olive' || crop === 'orchard') && D >= 5) {
        const sp = crop === 'olive' ? 8 : 6.5;
        const r = Math.min(crop === 'olive' ? 2.3 : 2.2, D / 2 - 0.7), h = crop === 'olive' ? 4.6 : 5.0;
        for (let u = sp * 0.6; u < b.len - 2.5; u += sp) {
          if (!clearOfStairs(u)) continue;
          const [x, z] = at(u, D / 2), C = chunk(x, z);
          if (underUpper(b.L, x, z, r)) continue;
          C.trees.tree(x, b.top - 0.02, z, r, h, hash2(x, z, 53) * TAU, crop === 'olive' ? 14 : 13);
          records.trees.push({ x, z, y: b.top - 0.02, r, h, bench: true });
          if (crop === 'olive') stats.olives++; else stats.orchards++;
        }
      } else if (crop === 'garden') stats.gardens++;
    });
    // a cypress pair at the foot of the lowest bench, on the natural ground below its wall
    const low = benches.reduce((m, b) => (b.L < m.L ? b : m), benches[0]);
    for (const e of [low.secs[0], low.secs.at(-1)]) {
      const x = e.F[0] + e.n[0] * 3, z = e.F[1] + e.n[1] * 3;
      const cq = [[x - 1.6, z - 1.6], [x + 1.6, z - 1.6], [x + 1.6, z + 1.6], [x - 1.6, z + 1.6]];
      if (!occ.polyFree(cq, 0.5, bad) || claimed(cq, 0.8) || ground(x, z) < 4) continue;
      cypress(chunk(x, z), x, z, 10 + 4 * hash2(x, z, 55), 1.25);
      claim(cq, 'cypress');
      occ.circle(x, z, 2, OCC.TREE);
    }
    records.fields.push({ x: cx, z: cz, R, crop, benches: built, D, dh, terraced: true, system: tag });
    stats.systems++;
    return built;
  };

  // ======================================================== gentle hedged field systems ==
  const GAP = 3;
  const flatField = (x, z, hint, want) => {
    const fr = frame(x, z, want ? 30 : 18);
    if (fr.s > 0.1 || !inHills(x, z) || onPlatform(x, z)) return null;
    const hb = habitat(x, z);
    if (hb.gully > 0.55 || hb.h < 8 || hb.h > 900) return null;
    const ang = want ? want.ang : fr.ang;
    const ax = Math.cos(ang), az = Math.sin(ang), sx = -az, sz = ax;
    const crop = hint && hash2(x, z, 49) < 0.6 ? hint.crop : cropFor(Math.min(fr.s, 0.07), fr.gz, x, z);
    for (const shrink of want ? [1, 0.7] : [1, 0.72, 0.5]) {
      const hl = (want ? want.hl : 22 + 34 * hash2(x, z, 47)) * shrink;
      const hw = want ? want.hw : 12 + 18 * hash2(x, z, 48);
      if (hl < 12) break;
      const q = rect(x, z, ax, az, hl, hw);
      if (!occ.polyFree(q, 3.2, bad) || claimed(q, GAP - 0.05)) continue;
      const g = exactRange(q);
      if (g.lo < 5 || g.hi - g.lo > 7) continue;
      const P = (u, v) => [x + ax * u + sx * v, z + az * u + sz * v];
      const C = chunk(x, z);
      const kind = { orchard: 6, olive: 6, garden: 9, vine: 5 }[crop] ?? crop;
      const col = FIELD_COL[kind].map((v) => v * (0.9 + 0.2 * hash2(x, z, 60)));
      drapeTerrain(C, P, hl, hw, col, kind);
      const hedge = fr.s < 0.06;
      const e = 0.9, gateEdge = Math.floor(hash2(x, z, 61) * 4);
      const edges = [[P(-hl + e, -hw + e), P(hl - e, -hw + e)], [P(hl - e, -hw + e), P(hl - e, hw - e)], [P(hl - e, hw - e), P(-hl + e, hw - e)], [P(-hl + e, hw - e), P(-hl + e, -hw + e)]];
      edges.forEach(([a, b], k) => {
        for (const [f0, f1] of k === gateEdge ? [[0, 0.44], [0.56, 1]] : [[0, 1]]) {
          const p0 = [a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0], p1 = [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1];
          if (hedge) groundRun(C, p0, p1, 1.35, 1.1, 3); else groundRun(C, p0, p1, 0.85, 0.55, 1);
        }
      });
      if (crop === 'orchard' || crop === 'olive') {
        const sp = crop === 'olive' ? 8.5 : 7.5;
        for (let v = -hw + 5; v <= hw - 5; v += sp) for (let u = -hl + 5; u <= hl - 5; u += sp) {
          const [tx, tz] = P(u + (hash2(u, v + x, 62) - 0.5), v);
          let gy = Infinity;
          for (let k = 0; k < 4; k++) gy = Math.min(gy, ground(tx + Math.cos(k * 1.57) * 0.45, tz + Math.sin(k * 1.57) * 0.45));
          const r = crop === 'olive' ? 2.3 : 2.4, h = crop === 'olive' ? 4.6 : 5.0;
          C.trees.tree(tx, gy - 0.02, tz, r, h, hash2(tx, tz, 63) * TAU, crop === 'olive' ? 14 : 13);
          records.trees.push({ x: tx, z: tz, y: gy - 0.02, r, h });
          if (crop === 'olive') stats.olives++; else stats.orchards++;
        }
      } else if (crop === 'vine') {
        for (let v = -hw + 3; v < hw - 2.5; v += 3.0) groundRun(C, P(-hl + 3.5, v), P(hl - 3.5, v), 1.3, 0.6, 3, 14, 0.3);
        stats.vines++;
      } else if (crop === 'garden') stats.gardens++;
      claim(q, 'flat');
      const f = { x, z, ang, hl, hw, q, terraced: false, crop, ax, az, sx, sz };
      records.fields.push(f);
      stats.flat++;
      return f;
    }
    return null;
  };

  for (const c of cands) {
    // a new system starts only well clear of the others: the woods grow between them
    const probe = [[c.x - 100, c.z - 100], [c.x + 100, c.z - 100], [c.x + 100, c.z + 100], [c.x - 100, c.z + 100]];
    if (claimed(probe, 0)) continue;
    const fr = frame(c.x, c.z, 30);
    if (fr.s >= 0.1 && fr.s <= 0.55) {
      const hb = habitat(c.x, c.z);
      if (hb.gully > 0.55) continue;
      if (occ.polyFree([[c.x - 12, c.z - 12], [c.x + 12, c.z - 12], [c.x + 12, c.z + 12], [c.x - 12, c.z + 12]], 2, bad)) contourSystem(c.x, c.z, fr, c.near);
      continue;
    }
    if (fr.s < 0.035 || fr.s > 0.1) continue;
    const f0 = flatField(c.x, c.z, null, null);
    if (!f0) continue;
    stats.fieldSystems++;
    const queue = [f0];
    let n = 1;
    const limit = 4 + Math.floor(14 * c.near);
    while (queue.length && n < limit) {
      const f = queue.shift();
      const hlN = 20 + 30 * hash2(f.x, f.z, 56);
      const offers = [
        [f.x + f.ax * (f.hl + GAP + hlN), f.z + f.az * (f.hl + GAP + hlN), hlN, f.hw],
        [f.x - f.ax * (f.hl + GAP + hlN), f.z - f.az * (f.hl + GAP + hlN), hlN, f.hw],
        [f.x + f.sx * (2 * f.hw + GAP), f.z + f.sz * (2 * f.hw + GAP), f.hl, f.hw],
        [f.x - f.sx * (2 * f.hw + GAP), f.z - f.sz * (2 * f.hw + GAP), f.hl, f.hw],
      ];
      for (const [x, z, hl, hw] of offers) {
        if (n >= limit) break;
        if (nearness(x, z) < 0.08) continue;
        const g = flatField(x, z, f, { ang: f.ang, hl, hw });
        if (g) { queue.push(g); n++; }
      }
    }
  }
  // the terraces and fields are now part of the built ground: nothing else is planted over them
  for (const { q, tag } of allClaims) {
    if (tag === 'cypress') continue;
    occ.markPoly(q, 1.0, OCC.FLAT | OCC.LOW | OCC.CROP);
    markCultivated(q, 10);
  }

  // ---------------------------------------------------------------------- meshes --
  const archMat = createFacadeMaterial('sand', 1417, { litFrac: 0.3, colW: 2.8, floorH: 3.2, band: 1e5, uplight: 0, warmth: 0.8 });
  const P0 = prototypes(), instMat = instancedDetailMaterial();
  const cells = [...chunks.values()].map((C) => ({ layers: {
    arch: C.arch.geometry(), stone: C.stone.geometry(), drape: C.drape.geometry(),
    walls: { inst: C.walls, proto: P0.box }, trees: { inst: C.trees, proto: P0.tree }, cyp: { inst: C.cyp, proto: P0.cypress },
  } }));
  const lod = buildLayerLOD(scene, cells, { arch: archMat, stone: terraceStoneMaterial(), drape: drapeMaterial(), walls: instMat, trees: instMat, cyp: instMat }, [
    { dist: 0, layers: ['arch', 'stone', 'drape', 'walls', 'trees', 'cyp'], cast: ['arch', 'stone', 'trees', 'cyp'] },
    { dist: 1500, layers: ['arch', 'stone', 'drape', 'walls', 'trees', 'cyp'], cast: ['arch', 'stone'] },
    { dist: 2400, layers: ['arch', 'stone', 'drape', 'trees', 'cyp'], cast: [] },
    { dist: 4200, layers: ['arch', 'stone', 'drape', 'cyp'], cast: [] },
    // past a few kilometres a bench's riser is under a pixel: the finishes carry the pattern
    { dist: 7000, layers: ['drape'], cast: [] },
    { dist: 17000, layers: [], cast: [] },
  ], 'Hill farmland');
  // the main view only (the lagoon's reflection pass draws the coarse land, not the farms)
  for (const m of lod.meshes) m.layers.set(1);
  stats.tris = lod.tris; stats.instances = lod.instances;
  return { stats, records, meshes: lod.meshes, stoneSolids };
}

let _stone = null;
/**
 * The terraces' dry stone: weathered, darker than the island walls (the lagoon face is wetter),
 * coursed in world space along each face, with lichen, and moss and grass on the level tops of
 * the steps; the courses fade to their average once they fall under a few pixels.
 */
function terraceStoneMaterial() {
  if (_stone) return _stone;
  _stone = patchedMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 }, {
    key: 'hillTerraceStone1',
    vertex: { pars: 'attribute vec3 aFacade; varying vec3 vDF;', transform: 'vDF = aFacade;' },
    fragment: {
      pars: 'varying vec3 vDF;',
      color: /* glsl */ `
{
  vec2 q = vec2(vDF.x / 0.62, vDF.y / 0.3);
  q.x += 0.5 * floor(q.y);
  vec2 cell = floor(q), f = fract(q);
  float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  float joint = min(min(f.x, 1.0 - f.x) * 0.62, min(f.y, 1.0 - f.y) * 0.3);
  float fade = clamp(1.0 - max(fwidth(vDF.y), fwidth(vDF.x) * 0.45) * 4.0, 0.0, 1.0);
  vec3 c = vec3(0.27, 0.25, 0.21) * mix(1.0, (0.8 + 0.34 * h) * mix(0.55, 1.0, smoothstep(0.0, 0.035, joint)), fade);
  float lich = smoothstep(0.55, 0.8, vnoise(vWPos.xz * 0.7 + vWPos.y * 1.3));
  c = mix(c, vec3(0.36, 0.36, 0.3), lich * 0.35 * fade);
  float up = abs(normalize(vWNrm).y);
  c = mix(c, vec3(0.07, 0.11, 0.035), (0.25 + 0.45 * smoothstep(0.5, 0.9, up)) * smoothstep(0.45, 0.75, vnoise(vWPos.xz * 0.21 + 3.0)));
  diffuseColor.rgb = c;
}`,
    },
  });
  return _stone;
}
