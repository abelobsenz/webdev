import * as THREE from 'three';
import { StreetField, ST, HALF_W, SB, SETBACK, obbOverlap } from './urban.js';
import { SD } from './platform.js';

// The planning toolkit for the Outer Wards. Each ward's design (wards.js) draws its own
// streets, squares, plazas, parks, water and landmark sites with these helpers; the
// toolkit then clips every street to the level it runs on (a street that crosses a canal
// gets a bridge, one that climbs a terrace wall gets a stair), lays lots along every
// frontage with the ward's own typologies, and bakes two ground textures: the street field
// (kerbs, carriageways, squares, lamp pools) and the land field (garden paths, special
// ground, planting beds, inlaid lines) that the ward's ground shader reads.

const TAU = Math.PI * 2;
const CUM = new WeakMap();
export const FIELD_N = 1024;
const E2 = 16;                      // land field distance range (m)
const enc = (d, R = E2) => Math.max(0, Math.min(255, Math.round((d + R) * (255 / (2 * R)))));

// ----------------------------------------------------------- polylines --
export const T = {
  line(x0, z0, x1, z1, step = 8) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    const out = [];
    for (let k = 0; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
    return out;
  },
  arc(cx, cz, r, a0, a1, step = 7) {
    const rf = typeof r === 'function' ? r : () => r;
    const n = Math.max(4, Math.ceil((Math.abs(a1 - a0) * rf((a0 + a1) / 2)) / step));
    const out = [];
    for (let k = 0; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; const rr = rf(a); out.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]); }
    return out;
  },
  ring(cx, cz, r, step = 7) { return T.arc(cx, cz, r, 0, TAU, step); },
  radial(cx, cz, a, r0, r1, step = 8) { return T.line(cx + Math.cos(a) * r0, cz + Math.sin(a) * r0, cx + Math.cos(a) * r1, cz + Math.sin(a) * r1, step); },
  /** Smooth curve through control points (centripetal Catmull-Rom). */
  curve(ctrl, step = 6, closed = false) {
    const c = new THREE.CatmullRomCurve3(ctrl.map((p) => new THREE.Vector3(p[0], 0, p[1])), closed, 'centripetal');
    const n = Math.max(4, Math.ceil(c.getLength() / step));
    return c.getSpacedPoints(n).map((v) => [v.x, v.z]);
  },
  /** Parallel polyline at signed offset d (left positive). */
  offset(pts, d) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
      const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
      out.push([pts[i][0] - (tz / l) * d, pts[i][1] + (tx / l) * d]);
    }
    return out;
  },
  length(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; },
  /** Point and unit tangent at arc length s (binary search over a cached arc table). */
  at(pts, s) {
    let cum = CUM.get(pts);
    if (!cum) {
      cum = new Float64Array(pts.length);
      for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      CUM.set(pts, cum);
    }
    const n = pts.length;
    if (n < 2) return { x: pts[0][0], z: pts[0][1], tx: 1, tz: 0 };
    let lo = 0, hi = n - 1;
    s = Math.min(Math.max(s, 0), cum[n - 1]);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi];
    const l = cum[hi] - cum[lo];
    const t = l > 0 ? (s - cum[lo]) / l : 0;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx: (b[0] - a[0]) / L, tz: (b[1] - a[1]) / L };
  },
  rot(x, z, a) { const c = Math.cos(a), s = Math.sin(a); return [x * c - z * s, x * s + z * c]; },
  /** Split a polyline into the runs where keep(p) holds (densified first). */
  split(pts, keep, step = 4) {
    const P = densify(pts, step);
    const out = [];
    let cur = [];
    for (const p of P) { if (keep(p)) cur.push(p); else { if (cur.length > 1) out.push(cur); cur = []; } }
    if (cur.length > 1) out.push(cur);
    return out;
  },
  densify(pts, step = 4) { return densify(pts, step); },
};

// ------------------------------------------------------------ the plan --
/**
 * ctx: { w, half, levelAt(x, z) -> level height or null, top(x, z) -> signed distance to the
 * street-level edge (lowest level), rnd }. design.plan(ctx, T) returns the raw plan.
 */
export function buildWardPlan(ctx, design) {
  const { w, half, rnd } = ctx;
  const N = FIELD_N;
  const field = new StreetField(N, half, { frame: false });
  const cell = field.cell;
  const land = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) { land[k * 4] = 255; land[k * 4 + 3] = 255; }
  const reserve = new Uint8Array(N * N);          // 1 park, 2 landmark site, 3 plaza
  const texRange = (bb, pad) => [
    Math.max(0, Math.floor((bb[0] - pad + half) / cell - 0.5)), Math.min(N - 1, Math.ceil((bb[2] + pad + half) / cell - 0.5)),
    Math.max(0, Math.floor((bb[1] - pad + half) / cell - 0.5)), Math.min(N - 1, Math.ceil((bb[3] + pad + half) / cell - 0.5)),
  ];
  const raster = (prim, pad, fn) => {
    if (prim.segs && prim.rf) {
      // polylines segment by segment (callers combine with min/max, so this is exact)
      for (const [a, b, s0, l] of prim.segs) {
        const r = prim.rf(s0 / (prim.length || 1));
        const [i0, i1, j0, j1] = texRange([Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r], pad);
        const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9;
        for (let j = j0; j <= j1; j++) {
          const z = -half + (j + 0.5) * cell;
          for (let i = i0; i <= i1; i++) {
            const x = -half + (i + 0.5) * cell;
            let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            fn(j * N + i, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) - r);
          }
        }
      }
      return;
    }
    const [i0, i1, j0, j1] = texRange(prim.bbox, pad);
    for (let j = j0; j <= j1; j++) {
      const z = -half + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) fn(j * N + i, prim.d(-half + (i + 0.5) * cell, z));
    }
  };
  const prof = ctx.prof || {};
  let _t = performance.now();
  const lap = (k) => { const t = performance.now(); prof[k] = (prof[k] || 0) + (t - _t); _t = t; };
  const raw = design.plan(ctx, T);
  lap('design');
  const out = { field, land, reserve, half, streets: [], squares: [], lots: [], lamps: [], bridges: [], stairs: [], parks: raw.parks || [], landmarks: raw.landmarks || [], quayWalks: [], extras: raw.extras || {} };

  // ---- streets, clipped to the level they run on
  for (const st of raw.streets) {
    const hw = st.hw ?? HALF_W[st.cls];
    // runs of consecutive points on one level (null = water, quay or a wall's margin)
    const P = densify(st.pts, 4);
    const runs = [];
    let cur = null, blockedGap = false;
    for (const p of P) {
      const blk = ctx.blocked ? ctx.blocked(p[0], p[1], hw) : false;
      const y = blk ? null : ctx.levelAt(p[0], p[1], st.margin ?? 2.0);
      if (y === null) { cur = null; if (blk) blockedGap = true; continue; }
      if (!cur || Math.abs(cur.y - y) > 0.1) { cur = { pts: [], y, blockedBefore: blockedGap }; runs.push(cur); blockedGap = false; }
      cur.pts.push(p);
    }
    const keep = runs.filter((r) => r.pts.length > 1 && T.length(r.pts) >= 10);
    for (let k = 1; k < keep.length; k++) {
      const A = keep[k - 1], B = keep[k];
      const a = A.pts[A.pts.length - 1], b = B.pts[0];
      const gl = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (B.blockedBefore || st.noBridges) continue;
      if (Math.abs(A.y - B.y) < 0.1) {
        // the same level on both sides of water: a bridge carries the street across
        if (gl > 3 && gl < (st.bridgeMax ?? 125)) out.bridges.push({ a, b, hw: Math.min(hw + 1.2, st.cls === ST.LANE ? 3.6 : 10), y: A.y, cls: st.cls, style: st.bridge });
      } else if (gl < 40) {
        // a terrace wall between the two levels: a stair climbs it (built on the lower level)
        const lo = A.y < B.y ? A : B, hi = A.y < B.y ? B : A;
        const pl = lo === A ? a : b, ph = lo === A ? b : a;
        out.stairs.push({ lo: pl, hi: ph, y0: lo.y, y1: hi.y, hw: Math.min(hw + 0.5, 7) });
      }
    }
    for (const r of keep) out.streets.push({ pts: r.pts, cls: st.cls, hw, y: r.y, name: st.name, noLots: !!st.noLots, lotSide: st.lotSide ?? 0 });
  }
  lap('clip');
  // stairs found between runs of streets crossing terrace walls: dedupe by position
  out.stairs = dedupe(out.stairs, (s) => [(s.lo[0] + s.hi[0]) / 2, (s.lo[1] + s.hi[1]) / 2], 20);
  out.bridges = dedupe(out.bridges, (b) => [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2], 12);
  for (const b of raw.bridges || []) out.bridges.push(b);
  for (const st of out.streets) field.polyline(st.pts, st.hw);

  lap('streets');
  // ---- squares (circles) and plazas (rounded boxes), parks, beds, zones, inlays
  for (const q of raw.squares || []) { field.square(q.x, q.z, q.r); out.squares.push(q); }
  const plazaB = (prim) => raster(prim, 3, (k, d) => {
    const v = Math.round(255 * Math.min(Math.max((1.8 - d) / 3.6, 0), 1));
    if (v > field.data[k * 4 + 2]) field.data[k * 4 + 2] = v;
    if (d < 0) reserve[k] = Math.max(reserve[k], 3);
  });
  for (const p of raw.plazas || []) {
    const prim = p.poly ? SD.polygon(p.poly) : SD.rbox(p.x, p.z, p.hw, p.hd, p.rot || 0, p.round ?? 6);
    plazaB(prim);
    out.squares.push({ x: p.x ?? prim.bbox[0], z: p.z ?? prim.bbox[1], r: p.hw ? Math.min(p.hw, p.hd) : 20, kind: p.kind || 'plaza', rect: p });
  }
  for (const q of raw.squares || []) raster(SD.circle(q.x, q.z, q.r), 2, (k, d) => { if (d < 0) reserve[k] = Math.max(reserve[k], 3); });
  for (const pk of out.parks) {
    const prim = pk.poly ? SD.polygon(pk.poly) : pk.box ? SD.rbox(pk.box.x, pk.box.z, pk.box.hw, pk.box.hd, pk.box.rot || 0, pk.box.round ?? 10) : SD.circle(pk.x, pk.z, pk.r);
    pk.prim = prim;
    raster(prim, 2, (k, d) => { if (d < -1) reserve[k] = Math.max(reserve[k], 1); });
    for (const path of pk.paths || []) {
      const pp = SD.polyline(path, pk.pathW ?? 1.6);
      raster(pp, E2, (k, d) => { const e = enc(d); if (e < land[k * 4]) land[k * 4] = e; });
    }
  }
  for (const path of raw.paths || []) {
    const pp = SD.polyline(path.pts || path, path.w ?? 1.6);
    raster(pp, E2, (k, d) => { const e = enc(d); if (e < land[k * 4]) land[k * 4] = e; });
  }
  for (const z of raw.zones || []) {
    const prim = z.prim || (z.poly ? SD.polygon(z.poly) : z.box ? SD.rbox(z.box.x, z.box.z, z.box.hw, z.box.hd, z.box.rot || 0, z.box.round ?? 6) : SD.circle(z.x, z.z, z.r));
    raster(prim, 4, (k, d) => { const v = Math.round(255 * Math.min(Math.max((2 - d) / 4, 0), 1) * (z.v ?? 1)); if (v > land[k * 4 + 1]) land[k * 4 + 1] = v; if (z.reserve && d < 0) reserve[k] = Math.max(reserve[k], 1); });
  }
  for (const b of raw.beds || []) {
    const prim = b.prim || (b.poly ? SD.polygon(b.poly) : b.box ? SD.rbox(b.box.x, b.box.z, b.box.hw, b.box.hd, b.box.rot || 0, b.box.round ?? 1.5) : b.pts ? SD.polyline(b.pts, b.w ?? 1.5) : SD.circle(b.x, b.z, b.r));
    raster(prim, 3, (k, d) => { const v = Math.round(255 * Math.min(Math.max((1 - d) / 2, 0), 1)); if (v > land[k * 4 + 2]) land[k * 4 + 2] = v; });
  }
  // detail field (half resolution): R inlaid lines, G ornamental pools, B parterres
  const DN = FIELD_N >> 1, dcell = (2 * half) / DN;
  const detail = new Uint8Array(DN * DN * 4);
  for (let k = 0; k < DN * DN; k++) { detail[k * 4] = 255; detail[k * 4 + 1] = 255; }
  const rasterD = (prim, pad, fn) => {
    if (prim.segs && prim.rf) {
      for (const [a, b, s0, l] of prim.segs) {
        const r = prim.rf(s0 / (prim.length || 1));
        const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - r - pad + half) / dcell - 0.5)), i1 = Math.min(DN - 1, Math.ceil((Math.max(a[0], b[0]) + r + pad + half) / dcell - 0.5));
        const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - r - pad + half) / dcell - 0.5)), j1 = Math.min(DN - 1, Math.ceil((Math.max(a[1], b[1]) + r + pad + half) / dcell - 0.5));
        const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9;
        for (let j = j0; j <= j1; j++) {
          const z = -half + (j + 0.5) * dcell;
          for (let i = i0; i <= i1; i++) {
            const x = -half + (i + 0.5) * dcell;
            let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            fn(j * DN + i, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) - r);
          }
        }
      }
      return;
    }
    const bb = prim.bbox;
    const i0 = Math.max(0, Math.floor((bb[0] - pad + half) / dcell - 0.5)), i1 = Math.min(DN - 1, Math.ceil((bb[2] + pad + half) / dcell - 0.5));
    const j0 = Math.max(0, Math.floor((bb[1] - pad + half) / dcell - 0.5)), j1 = Math.min(DN - 1, Math.ceil((bb[3] + pad + half) / dcell - 0.5));
    for (let j = j0; j <= j1; j++) {
      const z = -half + (j + 0.5) * dcell;
      for (let i = i0; i <= i1; i++) fn(j * DN + i, prim.d(-half + (i + 0.5) * dcell, z));
    }
  };
  for (const l of raw.inlays || []) {
    const prim = l.prim || SD.polyline(l.pts, l.w ?? 0.15);
    rasterD(prim, 4, (k, d) => { const e = enc(d, 4); if (e < detail[k * 4]) detail[k * 4] = e; });
  }
  out.pools = [];
  for (const p of raw.pools || []) {
    const prim = p.poly ? SD.polygon(p.poly) : p.box ? SD.rbox(p.box.x, p.box.z, p.box.hw, p.box.hd, p.box.rot || 0, p.box.round ?? 1) : SD.circle(p.x, p.z, p.r);
    p.prim = prim;
    out.pools.push(p);
    rasterD(prim, 8, (k, d) => { const e = enc(d, 8); if (e < detail[k * 4 + 1]) detail[k * 4 + 1] = e; });
    raster(prim, 2, (k, d) => { if (d < 1.5) reserve[k] = Math.max(reserve[k], 1); });
  }
  for (const p of raw.parterres || []) {
    const prim = p.poly ? SD.polygon(p.poly) : SD.rbox(p.box.x, p.box.z, p.box.hw, p.box.hd, p.box.rot || 0, p.box.round ?? 2);
    rasterD(prim, 2, (k, d) => { const v = Math.round(255 * Math.min(Math.max((1 - d) / 2, 0), 1)); if (v > detail[k * 4 + 2]) detail[k * 4 + 2] = v; });
    raster(prim, 1, (k, d) => { if (d < 0) reserve[k] = Math.max(reserve[k], 1); });
  }
  out.detail = detail;
  out.detailN = DN;
  for (const s of raw.sites || []) {
    const prim = s.prim || (s.poly ? SD.polygon(s.poly) : s.box ? SD.rbox(s.box.x, s.box.z, s.box.hw, s.box.hd, s.box.rot || 0, s.box.round ?? 4) : SD.circle(s.x, s.z, s.r));
    raster(prim, 2, (k, d) => { if (d < (s.margin ?? 4)) reserve[k] = Math.max(reserve[k], 2); });
  }

  lap('fields');
  // ---- lots along every frontage
  const G = 60;
  const grid = new Map();
  const gkey = (x, z) => `${Math.floor(x / G)},${Math.floor(z / G)}`;
  const resAt = (x, z) => {
    const i = Math.floor((x + half) / cell), j = Math.floor((z + half) / cell);
    if (i < 0 || j < 0 || i >= N || j >= N) return 255;
    return reserve[j * N + i];
  };
  const excl = raw.exclusions || [];
  const lotOk = (L) => {
    const c = Math.cos(L.rot), s = Math.sin(L.rot);
    let y0 = null;
    for (let iu = -1; iu <= 1; iu += 0.5) for (let iv = -1; iv <= 1; iv += 0.5) {
      const lx = iu * L.w * 0.5, lz = iv * L.d * 0.5;
      const x = L.lx + lx * c + lz * s, z = L.lz - lx * s + lz * c;
      const y = ctx.levelAt(x, z, 5);
      if (y === null || (y0 !== null && Math.abs(y - y0) > 0.1)) return false;
      y0 = y;
      if (field.edge(x, z) < SETBACK - 0.6) return false;
      if (field.squareAt(x, z) > 0.02) return false;
      if (resAt(x, z)) return false;
      if (land[(Math.min(N - 1, Math.max(0, Math.floor((z + half) / cell))) * N + Math.min(N - 1, Math.max(0, Math.floor((x + half) / cell)))) * 4] < enc(1.5)) return false;
    }
    L.y = y0;
    const rad = Math.hypot(L.w, L.d) * 0.5;
    for (const e of excl) {
      if (e.r !== undefined) { if (Math.hypot(e.x - L.lx, e.z - L.lz) < e.r + rad) return false; }
      else if (Math.hypot(e.x - L.lx, e.z - L.lz) < Math.hypot(e.w, e.d) * 0.5 + rad && obbOverlap({ x: e.x, z: e.z, w: e.w, d: e.d, rot: e.rot || 0 }, { x: L.lx, z: L.lz, w: L.w, d: L.d, rot: L.rot }, 3)) return false;
    }
    const gx = Math.floor(L.lx / G), gz = Math.floor(L.lz / G);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(`${gx + dx},${gz + dz}`);
      if (list) for (const o of list) if (Math.hypot(o.lx - L.lx, o.lz - L.lz) < rad + Math.hypot(o.w, o.d) * 0.5 + 3 && obbOverlap({ x: o.lx, z: o.lz, w: o.w, d: o.d, rot: o.rot }, { x: L.lx, z: L.lz, w: L.w, d: L.d, rot: L.rot }, L.gap ?? 3.2)) return false;
    }
    return true;
  };
  const addLot = (L) => {
    out.lots.push(L);
    const k = gkey(L.lx, L.lz);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(L);
  };
  // explicit lots first (canal house rows, warehouses, colleges...)
  for (const L0 of raw.lots || []) {
    const L = { ...L0, lx: L0.x, lz: L0.z };
    if (lotOk(L)) { L.seed = L.seed ?? rnd() * 1000; addLot(L); }
  }
  const rule = raw.lotRule || {};
  const size = rule.size || ((cls, R) => (cls === ST.LANE ? [12 + R() * 12, 13 + R() * 8] : [18 + R() * 24, 20 + R() * 18]));
  const Rmax = w.r;
  for (const cls of [ST.AVENUE, ST.ESPLANADE, ST.STREET, ST.LANE]) {
    for (const st of out.streets) {
      if (st.cls !== cls || st.noLots) continue;
      const P = st.pts;
      const total = T.length(P);
      for (const side of st.lotSide ? [st.lotSide] : [-1, 1]) {
        let sv = 6 + rnd() * 8;
        while (sv < total - 8) {
          let [wd, dep] = size(cls, rnd, st);
          let placed = false;
          for (let tryW = 0; tryW < 3 && !placed; tryW++) {
            const p = T.at(P, sv + wd / 2);
            const nx = -p.tz * side, nz = p.tx * side;
            const off = st.hw + (rule.setback ? rule.setback(cls) : SB[cls]) + dep / 2;
            const L = { lx: p.x + nx * off, lz: p.z + nz * off, w: wd, d: dep, rot: Math.atan2(-nx, -nz), cls, street: st };
            if (lotOk(L)) {
              L.seed = rnd() * 1000;
              L.centre = Math.max(0, 1 - Math.hypot(L.lx, L.lz) / Rmax);
              addLot(L);
              placed = true;
            } else { wd *= 0.72; dep *= 0.9; if (wd < (rule.minW ?? 9)) break; }
          }
          sv += wd + (rule.gap ? rule.gap(cls, rnd) : 3.0 + rnd() * 3.5);
        }
      }
    }
  }
  for (const L of out.lots) {
    if (!L.type && rule.type) L.type = rule.type(L, rnd, ctx);
    if (!L.floors && rule.floors) L.floors = rule.floors(L, rnd, ctx);
  }

  lap('lots');
  // ---- lamps along the verges and round the squares
  const lampOk = (x, z) => ctx.levelAt(x, z, 1.2) !== null && field.edge(x, z) > 0.3 && field.squareAt(x, z) < 0.05;
  for (const st of out.streets) {
    const P = st.pts;
    const spacing = st.cls === ST.AVENUE ? 26 : st.cls === ST.ESPLANADE ? 22 : st.cls === ST.STREET ? 30 : 34;
    const both = st.cls === ST.AVENUE || st.cls === ST.ESPLANADE;
    let acc = spacing * 0.5, k = 0;
    for (let i = 1; i < P.length; i++) {
      const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1];
      const L = Math.hypot(dx, dz) || 1;
      acc += L;
      while (acc >= spacing) {
        acc -= spacing;
        const t = 1 - acc / L;
        const x = P[i - 1][0] + dx * t, z = P[i - 1][1] + dz * t;
        const nx = -dz / L, nz = dx / L;
        for (const sd of both ? [-1, 1] : [(k & 1) ? 1 : -1]) {
          const lx = x + nx * sd * (st.hw + 1.0), lz = z + nz * sd * (st.hw + 1.0);
          if (lampOk(lx, lz)) out.lamps.push({ lx, lz, yaw: Math.atan2(-nx * sd, -nz * sd), cls: st.cls });
        }
        k++;
      }
    }
  }
  for (const q of out.squares) {
    if (q.rect || q.noLamps) continue;
    const n = Math.max(6, Math.floor((TAU * q.r) / 24));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const x = q.x + Math.cos(a) * (q.r - 2), z = q.z + Math.sin(a) * (q.r - 2);
      if (ctx.levelAt(x, z, 1) !== null) out.lamps.push({ lx: x, lz: z, yaw: a + Math.PI, cls: 0 });
    }
  }
  for (const l of raw.lamps || []) out.lamps.push(l);
  for (const l of out.lamps) field.lamp(l.lx, l.lz, l.cls === ST.LANE ? 0.75 : 1);
  lap('lamps');
  out.raw = raw;
  return out;
}

function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

function dedupe(list, keyPt, r) {
  const out = [];
  for (const it of list) {
    const p = keyPt(it);
    if (!out.some((o) => { const q = keyPt(o); return Math.hypot(q[0] - p[0], q[1] - p[1]) < r; })) out.push(it);
  }
  return out;
}

/** Land field texture (RGBA8, linear, mipmapped). */
export function landTexture(data, N = FIELD_N) {
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export { TAU, ST, HALF_W };
