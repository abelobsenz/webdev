import { at, polar, kOf, aOf } from './rimFrame.js';
import { mulberry32 } from '../noise.js';
import { RIM_HW } from './rimPlan.js';

// Where everything the Rim's country, shores and avenue hold stands (plain data; rimBuild.js
// builds it). Every site is laid in the rim's frame (bearing, radius) inside its parcel or
// beside its walk, on ground surveyed at its footprint, and kept clear of the plan: off every
// carriageway and verge (the street field), out of the squares, the lots (podium and apron),
// the lamps, the forecourts and bridgeheads, and of every other site.
//
// Kinds: vineyard rows, market-garden beds and glasshouses, allotment plots and sheds, orchards
// and palm groves (trees), sports grounds, an amphitheatre, the observatory, the botanical
// ring, memorial gardens, farm hamlets, lighthouses at the channel mouths, sea walls along the
// town parades, lookouts on the dunes, beach huts and boathouses on the strand, lidos, and the
// stops along Rim Way.

const TAU = Math.PI * 2;
const R_MEAN = 5900;

/** Polygon helpers (world xz). */
const rectPoly = (x, z, yaw, hx, hz) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([u, v]) => [x + u * c - v * s, z + u * s + v * c]); };
function inPoly(P, x, z) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function polyDistOut(P, x, z) {
  if (inPoly(P, x, z)) return 0;
  let d = 1e9;
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length];
    const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1e-12;
    let t = ((x - ax) * ex + (z - az) * ez) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    d = Math.min(d, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return d;
}
/** Sample points over a polygon: its outline every `step` m and an interior grid. */
function polySamples(P, step = 4) {
  const out = [];
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length];
    x0 = Math.min(x0, ax); x1 = Math.max(x1, ax); z0 = Math.min(z0, az); z1 = Math.max(z1, az);
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) if (inPoly(P, x, z)) out.push([x, z]);
  return out;
}

export class Occupancy {
  /** plan: the city plan (field, lots, lamps, squares); rim: rimPlan's output. */
  constructor(plan, rim, ground) {
    this.plan = plan; this.rim = rim; this.ground = ground;
    this.G = 48; this.lotGrid = new Map(); this.lampGrid = new Map(); this.siteGrid = new Map();
    const put = (grid, x, z, r, o) => {
      for (let i = Math.floor((x - r) / this.G); i <= Math.floor((x + r) / this.G); i++) for (let j = Math.floor((z - r) / this.G); j <= Math.floor((z + r) / this.G); j++) {
        const k = i * 100003 + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o);
      }
    };
    this.put = put;
    for (const L of plan.lots) { L._poly = rectPoly(L.x, L.z, -L.rot + Math.PI / 2, 0, 0); put(this.lotGrid, L.x, L.z, Math.hypot(L.w, L.d) / 2 + 6, L); }
    for (const l of plan.lamps) put(this.lampGrid, l.x, l.z, 1, l);
  }
  _near(grid, x, z, r) {
    const out = new Set();
    for (let i = Math.floor((x - r) / this.G); i <= Math.floor((x + r) / this.G); i++) for (let j = Math.floor((z - r) / this.G); j <= Math.floor((z + r) / this.G); j++) for (const o of grid.get(i * 100003 + j) || []) out.add(o);
    return out;
  }
  /** Metres from (x, z) to the nearest lot (its podium and apron: the lot grown by 4.5 m). */
  lotDist(x, z, reach = 30) {
    let d = reach;
    for (const L of this._near(this.lotGrid, x, z, reach)) {
      // the lot's own frame: +z toward its street (urban.js lotRect)
      const c = Math.cos(L.rot), s = Math.sin(L.rot), dx = x - L.x, dz = z - L.z;
      const u = dx * c - dz * s, v = dx * s + dz * c;
      const qx = Math.abs(u) - (L.w / 2 + 0.6), qz = Math.abs(v - 1.9) - (L.d / 2 + 3.2);
      d = Math.min(d, Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0));
    }
    return d;
  }
  lampDist(x, z, reach = 8) {
    let d = reach;
    for (const l of this._near(this.lampGrid, x, z, reach)) d = Math.min(d, Math.hypot(l.x - x, l.z - z));
    return d;
  }
  siteDist(x, z, reach = 30) {
    let d = reach;
    for (const s of this._near(this.siteGrid, x, z, reach)) d = Math.min(d, polyDistOut(s.fp, x, z));
    return d;
  }
  /** Is a footprint polygon clear of the plan (streets by `street` m of kerb, squares, lots,
   *  lamps, keep-outs, other sites by `pad`) and on dry ground (>= minH)? */
  clear(P, { street = 3, pad = 2, minH = 2.4, maxH = 60, water = false } = {}) {
    const F = this.plan.field;
    for (const [x, z] of polySamples(P, 3)) {
      const h = this.ground(x, z);
      if (!water && (h < minH || h > maxH)) return false;
      if (F.edge(x, z) < street) return false;
      if (F.squareAt(x, z) > 0.01) return false;
      if (this.rim.block(x, z) < pad + 2) return false;
      if (this.lotDist(x, z, pad + 2) < pad) return false;
      if (this.lampDist(x, z, pad + 2) < pad + 0.6) return false;
      if (this.siteDist(x, z, pad + 2) < pad) return false;
    }
    return true;
  }
  occupy(fp, site) { let cx = 0, cz = 0, r = 0; for (const [x, z] of fp) { cx += x / fp.length; cz += z / fp.length; } for (const [x, z] of fp) r = Math.max(r, Math.hypot(x - cx, z - cz)); this.put(this.siteGrid, cx, cz, r, { fp, site }); }
}

/** Ground statistics over a polygon. */
export function groundStats(ground, P, step = 3) {
  let lo = 1e9, hi = -1e9, s = 0, n = 0;
  for (const [x, z] of polySamples(P, step)) { const h = ground(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); s += h; n++; }
  return { lo, hi, mean: s / Math.max(1, n) };
}

/** The frame of a bearing: position at radius r, tangent (increasing bearing) and outward normal. */
const frameAt = (a, r) => { const c = Math.cos(a), s = Math.sin(a); return { x: c * r, z: s * r, t: [-s, c], n: [c, s] }; };

/** A parcel's radial bounds at bearing a (null outside its bearings). */
function parcelSpan(p, a) {
  let b = a;
  while (b < p.a0 - Math.PI) b += TAU;
  while (b > p.a0 + Math.PI) b -= TAU;
  if (b < p.a0 || b > p.a1) return null;
  const f = ((b - p.a0) / (p.a1 - p.a0)) * p.nb, i = Math.min(p.nb - 1, Math.floor(f)), t = f - i;
  return [p.lo[i] + (p.lo[i + 1] - p.lo[i]) * t, p.hi[i] + (p.hi[i + 1] - p.hi[i]) * t, b];
}

/**
 * Place every site. Returns { sites, trees } where trees are the designed plantings
 * ({ x, z, sp, s, row }) and sites the structures ({ kind, fp, ... }).
 */
export function placeRimSites(plan, rim, ground) {
  const occ = new Occupancy(plan, rim, ground);
  const rnd = mulberry32(6310);
  const sites = [], trees = [];
  const add = (site) => { sites.push(site); occ.occupy(site.fp, site); return site; };
  const F = plan.field;
  const treeOk = (x, z, r) => ground(x, z) > 2.6 && F.edge(x, z) > r + 1.5 && F.squareAt(x, z) < 0.01 && rim.block(x, z) > r + 2 && occ.lotDist(x, z, r + 3) > r + 1.5 && occ.lampDist(x, z) > 2.5 && occ.siteDist(x, z, r + 3) > r + 1;

  // ---------------------------------------------------------------- big set pieces first --
  const byKind = (k) => rim.parcels.filter((p) => p.kind === k);
  /** The best rectangle (length L along the rim, width W across) in parcel p: flattest ground. */
  const fitRect = (p, L, W, { street = 6, pad = 3, face = 0 } = {}) => {
    let best = null;
    const n = 9;
    for (let i = 1; i < n; i++) {
      const a = p.a0 + ((p.a1 - p.a0) * i) / n, sp = parcelSpan(p, a);
      if (!sp) continue;
      for (let f = 0.2; f <= 0.8; f += 0.1) {
        const r = sp[0] + (sp[1] - sp[0]) * f, fr = frameAt(a, r);
        const yaw = Math.atan2(fr.t[1], fr.t[0]);
        const P = rectPoly(fr.x, fr.z, yaw, L / 2, W / 2);
        if (!P.every(([x, z]) => p.inside(x, z, 2))) continue;
        const g = groundStats(ground, P, 6);
        const score = -(g.hi - g.lo) - Math.abs(f - 0.5) * 4 + face * (ground(...at(a, r + W / 2)) - ground(...at(a, r - W / 2)));
        if (!best || score > best.score) best = { score, x: fr.x, z: fr.z, yaw, P, g, a, r, fr };
      }
    }
    if (best && occ.clear(best.P, { street, pad })) return best;
    return null;
  };

  // sports grounds: a pitch inside a running track, a grandstand and a clubhouse
  for (const p of byKind('sports')) {
    const s = fitRect(p, 190, 112, { street: 6 });
    if (!s) { p.kind = 'orchard'; continue; }
    add({ kind: 'sports', x: s.x, z: s.z, yaw: s.yaw, L: 190, W: 112, fp: s.P, g: s.g, side: p.side });
  }
  // the amphitheatre: its bowl in the slope, the stage toward the lagoon
  for (const p of byKind('amphitheatre')) {
    let best = null;
    for (let i = 2; i <= 8; i++) {
      const a = p.a0 + ((p.a1 - p.a0) * i) / 10, sp = parcelSpan(p, a);
      if (!sp) continue;
      const R = Math.min(46, (sp[1] - sp[0]) / 2 - 8);
      if (R < 30) continue;
      const r = sp[0] + R + 6, fr = frameAt(a, r);
      // the bowl faces the lagoon (-n): stage on the lagoon side
      const yaw = Math.atan2(-fr.n[1], -fr.n[0]);
      const P = [];
      for (let k = 0; k <= 16; k++) { const t = -Math.PI / 2 - 0.2 + ((Math.PI + 0.4) * k) / 16; P.push([fr.x - Math.cos(yaw + t) * (R + 3) * 1, fr.z - Math.sin(yaw + t) * (R + 3)]); }
      P.push([fr.x + Math.cos(yaw) * 20 - Math.sin(yaw) * (R + 3), fr.z + Math.sin(yaw) * 20 + Math.cos(yaw) * (R + 3)], [fr.x + Math.cos(yaw) * 20 + Math.sin(yaw) * (R + 3), fr.z + Math.sin(yaw) * 20 - Math.cos(yaw) * (R + 3)]);
      if (!P.every(([x, z]) => p.inside(x, z, 1))) continue;
      const rise = ground(...at(a, r + R)) - ground(...at(a, r));
      const score = rise - Math.abs(i - 5);
      if (!best || score > best.score) best = { score, x: fr.x, z: fr.z, yaw, R, P };
    }
    if (best && occ.clear(best.P, { street: 6, pad: 3 })) add({ kind: 'amphitheatre', x: best.x, z: best.z, yaw: best.yaw, R: best.R, fp: best.P });
    else p.kind = 'orchard';
  }
  // the observatory on the parcel's highest ground
  for (const p of byKind('observatory')) {
    let best = null;
    for (let i = 1; i < 12; i++) {
      const a = p.a0 + ((p.a1 - p.a0) * i) / 12, sp = parcelSpan(p, a);
      if (!sp) continue;
      for (let f = 0.2; f <= 0.8; f += 0.1) {
        const r = sp[0] + (sp[1] - sp[0]) * f, [x, z] = at(a, r), h = ground(x, z);
        const P = rectPoly(x, z, 0, 0, 0); void P;
        const disc = []; for (let k = 0; k < 20; k++) disc.push([x + Math.cos((k / 20) * TAU) * 30, z + Math.sin((k / 20) * TAU) * 30]);
        if (!disc.every(([qx, qz]) => p.inside(qx, qz, 1))) continue;
        if (!best || h > best.h) best = { x, z, h, disc, a };
      }
    }
    if (best && occ.clear(best.disc, { street: 6, pad: 3 })) add({ kind: 'observatory', x: best.x, z: best.z, R: 30, yaw: best.a, fp: best.disc });
    else p.kind = 'orchard';
  }
  // the botanical ring: a circular garden ringed by glasshouses round a palm house
  for (const p of byKind('botanical')) {
    const mid = (p.a0 + p.a1) / 2, sp = parcelSpan(p, mid);
    let placed = false;
    if (sp) for (const R of [64, 58, 52, 46]) {
      for (const f of [0.5, 0.42, 0.58]) {
        const r = sp[0] + (sp[1] - sp[0]) * f, [x, z] = at(mid, r);
        const disc = []; for (let k = 0; k < 24; k++) disc.push([x + Math.cos((k / 24) * TAU) * (R + 4), z + Math.sin((k / 24) * TAU) * (R + 4)]);
        if (!disc.every(([qx, qz]) => p.inside(qx, qz, 1)) || !occ.clear(disc, { street: 6, pad: 3 })) continue;
        add({ kind: 'botanical', x, z, R, yaw: mid, fp: disc });
        for (let k = 0; k < 10; k++) { const t = (k / 10) * TAU + 0.31; trees.push({ x: x + Math.cos(t) * R * 0.52, z: z + Math.sin(t) * R * 0.52, sp: k % 2 ? 'palm' : 'flowering', s: k % 2 ? 13 : 7.5, site: true }); }
        placed = true; break;
      }
      if (placed) break;
    }
    if (!placed) p.kind = 'market';
  }
  // memorial gardens: an axial garden - a long pool between avenues of stelae, a cenotaph
  for (const p of byKind('memorial')) {
    const L = Math.min(150, p.len - 40), s = L > 80 ? fitRect(p, L, 46, { street: 6 }) : null;
    if (!s) { p.kind = 'orchard'; continue; }
    add({ kind: 'memorial', x: s.x, z: s.z, yaw: s.yaw, L, W: 46, fp: s.P, g: s.g });
    for (const side of [-1, 1]) for (let u = -L / 2 + 8; u <= L / 2 - 8; u += 11) {
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), v = side * 20;
      trees.push({ x: s.x + u * c - v * sn, z: s.z + u * sn + v * c, sp: 'araucaria', s: 15, site: true });
    }
  }
  // farm hamlets: a farmhouse, barns and a silo round a yard by the lane
  for (const p of byKind('hamlet')) {
    const s = fitRect(p, 70, 54, { street: 5 });
    if (!s) { p.kind = 'orchard'; continue; }
    add({ kind: 'hamlet', x: s.x, z: s.z, yaw: s.yaw, L: 70, W: 54, fp: s.P, g: s.g, seed: rnd() });
    p.kind = 'orchard';        // the rest of the parcel is its orchard
    p.hamlet = true;
  }

  // ---------------------------------------------------------------- cultivated parcels --
  for (const p of rim.parcels) {
    if (p.kind === 'vineyard' || p.kind === 'market' || p.kind === 'allotments') {
      const rows = [];
      const spacing = p.kind === 'vineyard' ? 2.8 : p.kind === 'market' ? 3.2 : 0;
      if (spacing) {
        const span0 = parcelSpan(p, (p.a0 + p.a1) / 2);
        if (!span0) continue;
        let rMin = 1e9, rMax = -1e9;
        for (let i = 0; i <= p.nb; i++) { rMin = Math.min(rMin, p.lo[i]); rMax = Math.max(rMax, p.hi[i]); }
        let ri = 0;
        for (let r = rMin + 5; r < rMax - 5; r += spacing, ri++) {
          // headlands: a cart track every 14 rows
          if (ri % 15 === 14) continue;
          const step = 5 / r, pts = [];
          const flush = () => { if (pts.length >= 3) rows.push(pts.slice()); pts.length = 0; };
          let seg = 0;
          for (let a = p.a0 + 6 / r; a < p.a1 - 6 / r; a += step) {
            const [x, z] = at(a, r);
            // cross tracks every ~70 m of arc
            const arc = (a - p.a0) * r;
            const inTrack = arc % 72 > 67;
            const ok = !inTrack && p.inside(x, z, 3) && ground(x, z) > 2.6 && F.edge(x, z) > 3.5 && F.squareAt(x, z) < 0.01 && occ.lotDist(x, z, 6) > 3 && occ.lampDist(x, z) > 2 && occ.siteDist(x, z, 6) > 3 && rim.block(x, z) > 6;
            if (ok) pts.push([x, z]); else flush();
            if (arc > seg) seg = arc;
          }
          flush();
        }
      }
      if (p.kind === 'vineyard' && rows.length) {
        const fp = [];
        add({ kind: 'vineyard', rows, fp: parcelPoly(p), parcel: p });
      } else if (p.kind === 'market' && rows.length) {
        add({ kind: 'market', rows, fp: parcelPoly(p), parcel: p });
      } else if (p.kind === 'allotments') {
        // plots 12 m along x 17 m across, paths of 3 m, a hedge round the whole
        const plots = [];
        let rMin = 1e9, rMax = -1e9;
        for (let i = 0; i <= p.nb; i++) { rMin = Math.min(rMin, p.lo[i]); rMax = Math.max(rMax, p.hi[i]); }
        for (let r = rMin + 12; r + 9 < rMax; r += 20) {
          for (let a = p.a0 + 10 / r; a < p.a1 - 10 / r; a += 15 / r) {
            const fr = frameAt(a + 6 / r, r + 8.5), yaw = Math.atan2(fr.t[1], fr.t[0]);
            const P = rectPoly(fr.x, fr.z, yaw, 6, 8.5);
            if (!P.every(([x, z]) => p.inside(x, z, 3))) continue;
            if (!occ.clear(P, { street: 4, pad: 1.5 })) continue;
            const g = groundStats(ground, P, 3);
            if (g.hi - g.lo > 2.2) continue;
            plots.push({ x: fr.x, z: fr.z, yaw, g, shed: rnd() < 0.55, seed: rnd() });
          }
        }
        if (plots.length) {
          const site = { kind: 'allotments', plots, fp: parcelPoly(p), parcel: p };
          sites.push(site);
          for (const q of plots) occ.occupy(rectPoly(q.x, q.z, q.yaw, 6, 8.5), site);
        }
      }
    }
  }

  // ---------------------------------------------------------------- the channel mouths --
  // a lighthouse on the seaward tip of the land at each end of every run
  const F0 = rim.frame, N = F0.N;
  for (const w of rim.runWays) {
    const run = F0.runs[w.run];
    for (const end of [0, 1]) {
      let best = null;
      for (let d = 2; d <= 70; d += 1) {
        const k = end ? run.k1 - d : run.k0 + d, q = ((k % N) + N) % N, a = aOf(k);
        for (const back of [26, 34, 44]) {
          const r = F0.rOut[q] - back, [x, z] = at(a, r);
          const disc = []; for (let i = 0; i < 12; i++) disc.push([x + Math.cos((i / 12) * TAU) * 11, z + Math.sin((i / 12) * TAU) * 11]);
          const g = groundStats(ground, disc, 3);
          if (g.lo < 2.6 || g.hi - g.lo > 4) continue;
          const score = F0.rOut[q] - d * 1.2 - back;
          if (best && score <= best.score) continue;
          if (!occ.clear(disc, { street: 4, pad: 2 })) continue;
          // the keeper's house beside the tower, on whichever side is clear
          for (const da of [1.2, -1.2, 2.1, -2.1, Math.PI]) {
            const t = a + da, hx = x + Math.cos(t) * 16, hz = z + Math.sin(t) * 16;
            const house = rectPoly(hx, hz, t, 5.8, 4.3);
            const hg = groundStats(ground, house, 2);
            if (hg.lo < 2.2 || hg.hi - hg.lo > 3 || !occ.clear(house, { street: 3, pad: 1.5 })) continue;
            best = { score, x, z, a, disc, g, houseA: t, house };
            break;
          }
        }
      }
      if (best) {
        const site = add({ kind: 'lighthouse', x: best.x, z: best.z, yaw: best.a, houseA: best.houseA, fp: best.disc, g: best.g, h: 30 + rnd() * 8 });
        occ.occupy(best.house, site);
      }
    }
  }

  // ---------------------------------------------------------------- the sea walls --
  // along every town parade: a battered ashlar wall on its seaward side, a parapet on top
  for (const st of plan.streets) {
    if (st.district !== 'rim' || st.role !== 'parade') continue;
    const P = st.pts, off = st.hw + 2.4;
    const line = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let nx = -(b[1] - a[1]), nz = b[0] - a[0];
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      // seaward: away from the lagoon's centre
      if (nx * P[i][0] + nz * P[i][1] < 0) { nx = -nx; nz = -nz; }
      line.push([P[i][0] + nx * off, P[i][1] + nz * off]);
    }
    let cur = [];
    const pieces = [];
    for (let i = 0; i < line.length; i++) {
      const [x, z] = line[i];
      const ok = ground(x, z) > 1.2 && F.edge(x, z) > 1.3 && F.squareAt(x, z) < 0.01 && occ.lotDist(x, z, 4) > 1 && occ.lampDist(x, z) > 0.9 && rim.block(x, z) > 4 && occ.siteDist(x, z, 3) > 1;
      if (ok) cur.push(line[i]); else { if (cur.length > 4) pieces.push(cur); cur = []; }
    }
    if (cur.length > 4) pieces.push(cur);
    for (const pc of pieces) {
      const fp = [];
      for (const q of pc) fp.push(q);
      add({ kind: 'seawall', pts: pc, fp: stripPoly(pc, 0.5) });
    }
  }

  // ---------------------------------------------------------------- lookouts on the dunes --
  for (const st of plan.streets) {
    if (st.district !== 'rim' || st.role !== 'dune') continue;
    const P = st.pts;
    let acc = 400;
    for (let i = 2; i < P.length - 2; i++) {
      acc += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      if (acc < 900) continue;
      const a = P[i - 2], b = P[i + 2];
      let nx = -(b[1] - a[1]), nz = b[0] - a[0];
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      if (nx * P[i][0] + nz * P[i][1] < 0) { nx = -nx; nz = -nz; }
      const x = P[i][0] + nx * (st.hw + 6.5), z = P[i][1] + nz * (st.hw + 6.5);
      const yaw = Math.atan2(nz, nx);
      // the platform and the stair that runs along its +z side
      const fp = rectPoly(x - Math.sin(yaw) * 3.5, z + Math.cos(yaw) * 3.5, yaw, 3.5, 7.2);
      if (!occ.clear(fp, { street: 1.5, pad: 1.5, minH: 1.2 })) continue;
      add({ kind: 'lookout', x, z, yaw, fp, g: groundStats(ground, fp, 1.5) });
      acc = 0;
    }
  }

  // ---------------------------------------------------------------- the strand --
  // beach huts in rows on the sand below the strand, near the towns; boathouses by the
  // harbour squares
  for (const st of plan.streets) {
    if (st.district !== 'rim' || st.role !== 'strand') continue;
    const P = st.pts, town = !!st.town;
    let acc = 60;
    for (let i = 2; i < P.length - 2; i++) {
      acc += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      if (acc < (town ? 260 : 520)) continue;
      const a = P[i - 2], b = P[i + 2];
      let nx = -(b[1] - a[1]), nz = b[0] - a[0];
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      // toward the lagoon (the centre)
      if (nx * P[i][0] + nz * P[i][1] > 0) { nx = -nx; nz = -nz; }
      const tx = (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]), tz = (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
      // the row stands on the sand, a few metres down from the walk's verge
      let placed = 0;
      for (let dOut = st.hw + 7; dOut < st.hw + 30 && !placed; dOut += 2) {
        const cx = P[i][0] + nx * dOut, cz = P[i][1] + nz * dOut;
        const n = 7, huts = [];
        for (let k = 0; k < n; k++) {
          const u = (k - (n - 1) / 2) * 3.6, x = cx + tx * u, z = cz + tz * u;
          const fp = rectPoly(x, z, Math.atan2(nz, nx), 1.3, 1.2);
          const g = groundStats(ground, fp, 0.8);
          if (g.lo < 0.7 || g.hi > 3.2 || g.hi - g.lo > 0.8) { huts.length = 0; break; }
          if (!occ.clear(fp, { street: 2, pad: 1, minH: 0.7 })) { huts.length = 0; break; }
          huts.push({ x, z, g });
        }
        if (huts.length === n) {
          const fp = rectPoly(cx, cz, Math.atan2(tz, tx), n * 1.8 + 0.5, 1.6);
          add({ kind: 'beachHuts', huts, yaw: Math.atan2(nz, nx), fp, seed: rnd() });
          placed = 1;
        }
      }
      if (placed) acc = 0;
    }
  }
  for (const q of plan.squares) {
    if (q.district !== 'rim' || q.role !== 'harbour') continue;
    // the lagoon lies toward the centre: a slipway and boathouse either side of the square's axis
    const nx = -q.x / Math.hypot(q.x, q.z), nz = -q.z / Math.hypot(q.x, q.z), tx = -nz, tz = nx;
    for (const side of [-1, 1]) {
      let done = false;
      for (let dOut = q.r + 16; dOut < q.r + 70 && !done; dOut += 2) {
        const x = q.x + nx * dOut + tx * side * 18, z = q.z + nz * dOut + tz * side * 18;
        // the house stands on the beach with its doors to the water
        const fp = rectPoly(x, z, Math.atan2(nz, nx), 9, 5.5);
        const g = groundStats(ground, fp, 1);
        if (g.lo < 0.5 || g.hi > 3.4) continue;
        const wet = ground(x + nx * 22, z + nz * 22) < -0.8;
        if (!wet) continue;
        if (!occ.clear(fp, { street: 2, pad: 1.5, minH: 0.5 })) continue;
        add({ kind: 'boathouse', x, z, yaw: Math.atan2(nz, nx), fp, g });
        done = true;
      }
    }
  }
  // lidos: a pool terrace on the beach, its pavilion on the walk's lagoon verge
  for (const L of rim.lidos) {
    let best = null;
    for (let d = -40; d <= 40; d += 4) {
      const a = L.a + d / R_MEAN, s = (() => { const f = kOf(a), i = Math.floor(f) % N, v = rim.rS[i]; return v; })();
      if (!(s > 0)) continue;
      for (let back = 10; back <= 40; back += 3) {
        const fr = frameAt(a, s - back), yaw = Math.atan2(fr.t[1], fr.t[0]);
        const fp = rectPoly(fr.x, fr.z, yaw, 30, 13);
        const g = groundStats(ground, fp, 2);
        if (g.lo < 0.6 || g.hi > 4.5) continue;
        if (!occ.clear(fp, { street: 2, pad: 2, minH: 0.6 })) continue;
        const score = -Math.abs(d) * 0.1 - (g.hi - g.lo);
        if (!best || score > best.score) best = { score, x: fr.x, z: fr.z, yaw, fp, g };
      }
    }
    if (best) add({ kind: 'lido', x: best.x, z: best.z, yaw: best.yaw, fp: best.fp, g: best.g });
  }

  // ---------------------------------------------------------------- Rim Way --
  // a stop every ~650 m, its shelter on the verge facing the avenue; avenue trees in the
  // country: a row on each verge
  for (const st of plan.streets) {
    if (st.district !== 'rim' || st.role !== 'rimWay') continue;
    const P = st.pts;
    let acc = 320;
    for (let i = 2; i < P.length - 2; i++) {
      const L = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      acc += L;
      if (acc < 650) continue;
      const a = P[i - 1], b = P[i + 1];
      const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / tl, tz = (b[1] - a[1]) / tl;
      for (const side of [-1, 1]) {
        const nx = -tz * side, nz = tx * side;
        const x = P[i][0] + nx * (st.hw + 3.6), z = P[i][1] + nz * (st.hw + 3.6);
        const fp = rectPoly(x, z, Math.atan2(tz, tx), 4.2, 1.5);
        if (!occ.clear(fp, { street: 0.9, pad: 0.8 })) continue;
        add({ kind: 'stop', x, z, yaw: Math.atan2(tz, tx), side, nx, nz, fp, g: groundStats(ground, fp, 1) });
        acc = 0;
        break;
      }
    }
  }

  // ---------------------------------------------------------------- the planting --
  // (last, so every tree keeps clear of every structure)
  // ---------------------------------------------------------------- orchards and groves --
  for (const p of rim.parcels) {
    if (p.kind !== 'orchard' && p.kind !== 'palmGrove') continue;
    const palm = p.kind === 'palmGrove';
    const rowS = palm ? 10 : 8.4, treeS = palm ? 9.5 : 7.6;
    // one blossom to an orchard: cream (citrus), pink (almond) or white-gold; every sixth row a
    // shelter row of rain trees
    const bloom = [0.78, 0.62, 0.8, 0.66][Math.floor(rnd() * 4)];
    let rMin = 1e9, rMax = -1e9;
    for (let i = 0; i <= p.nb; i++) { rMin = Math.min(rMin, p.lo[i]); rMax = Math.max(rMax, p.hi[i]); }
    let row = 0;
    for (let r = rMin + 6; r < rMax - 6; r += rowS, row++) {
      const off = (row % 2) * 0.5;
      for (let a = p.a0 + ((5 + off * treeS) / r); a < p.a1 - 5 / r; a += treeS / r) {
        const [x, z] = at(a, r);
        const cr = palm ? 3.5 : 4.2;
        if (!p.inside(x, z, 3) || !treeOk(x, z, cr)) continue;
        const s = palm ? 12 + rnd() * 5 : 5.8 + rnd() * 1.3;
        trees.push({ x, z, sp: palm ? 'palm' : (row % 6 === 5 ? 'rainTree' : 'flowering'), s: palm ? s : (row % 6 === 5 ? s * 1.3 : s), row: true, bloom });
      }
    }
  }

  for (const st of plan.streets) {
    if (st.district !== 'rim' || st.role !== 'rimWay') continue;
    const P = st.pts;
    if (st.town) continue;
    // verge trees in the country
    const sp = { harbour: 'palm', gate: 'flowering', garden: 'rainTree', upland: 'araucaria' }[st.quarter] || 'rainTree';
    const spacing = sp === 'rainTree' ? 16 : sp === 'araucaria' ? 13 : 12;
    let s0 = spacing / 2;
    for (let i = 1; i < P.length; i++) {
      const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1], L = Math.hypot(dx, dz);
      s0 += L;
      while (s0 >= spacing) {
        s0 -= spacing;
        const t = 1 - s0 / L, x0 = P[i - 1][0] + dx * t, z0 = P[i - 1][1] + dz * t;
        for (const side of [-1, 1]) {
          const x = x0 - (dz / L) * side * (st.hw + 6.2), z = z0 + (dx / L) * side * (st.hw + 6.2);
          if (!treeOk(x, z, 2.2)) continue;
          trees.push({ x, z, sp, s: sp === 'palm' ? 13 : sp === 'rainTree' ? 10 : sp === 'araucaria' ? 17 : 8.5, avenue: true });
        }
      }
    }
  }
  return { sites, trees, occ };
}

/** A parcel's outline (world xz). */
export function parcelPoly(p) {
  const out = [];
  for (let i = 0; i <= p.nb; i++) out.push(at(p.a0 + ((p.a1 - p.a0) * i) / p.nb, p.lo[i]));
  for (let i = p.nb; i >= 0; i--) out.push(at(p.a0 + ((p.a1 - p.a0) * i) / p.nb, p.hi[i]));
  return out;
}

/** The outline of a strip of half-width hw along P. */
function stripPoly(P, hw) {
  const L = [], R = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    L.push([P[i][0] - tz * hw, P[i][1] + tx * hw]); R.push([P[i][0] + tz * hw, P[i][1] - tx * hw]);
  }
  return [...L, ...R.reverse()];
}

export { rectPoly, inPoly, polySamples, frameAt, parcelSpan };
void kOf; void polar; void RIM_HW;
