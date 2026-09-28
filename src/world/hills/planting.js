import { renderedHeight } from '../outerCities.js';
import { OCC, flareGround, hash2, inHills, onPlatform, SPC, habitat } from './cover.js';
import { crownR } from './woods.js';

// The planted trees of the hill country: a shade tree or two in every house garden, a Norfolk
// pine by each village belfry, avenues along the country roads as they approach the villages
// and farms (plane-like broadleaves inland, palms on the coast, rain trees arching over the
// lanes), and groves round the summit monasteries and observatories.
//
// Every planted tree is checked exactly against what the hill country built: its trunk stands
// clear of every carriageway and lane (their half width + the kerb, the cut wall and a verge),
// of every building and its door stair, of every field and its boundary, of the lamps and the
// village monuments; its crown stays clear of every building; it is rooted at the lowest drawn
// ground under its root flare, and nothing is planted on a cliff or in the water.

export function planHillPlanting(hc, occ, { extraKeepouts = [] } = {}) {
  const out = [];
  // ---- exact obstacle indexes
  const SEG = 24, segs = new Map();
  const addSeg = (a, b, hw) => {
    const x0 = Math.min(a.x, b.x) - hw - 12, x1 = Math.max(a.x, b.x) + hw + 12, z0 = Math.min(a.z, b.z) - hw - 12, z1 = Math.max(a.z, b.z) + hw + 12;
    const s = [a.x, a.z, b.x, b.z, hw];
    for (let i = Math.floor(x0 / SEG); i <= Math.floor(x1 / SEG); i++) for (let j = Math.floor(z0 / SEG); j <= Math.floor(z1 / SEG); j++) {
      const k = i * 65536 + j; let L = segs.get(k); if (!L) segs.set(k, (L = [])); L.push(s);
    }
  };
  for (const r of hc.roads) for (let k = 1; k < r.points.length; k++) addSeg(r.points[k - 1], r.points[k], r.halfWidth);
  const roadClear = (x, z, pad) => {
    const L = segs.get(Math.floor(x / SEG) * 65536 + Math.floor(z / SEG));
    if (L) for (const [ax, az, bx, bz, hw] of L) {
      const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < hw + pad) return false;
    }
    return true;
  };
  const RB = 48, rects = new Map();
  const addRect = (x, z, ang, hl, hw, kind) => {
    const r = { x, z, c: Math.cos(ang), s: Math.sin(ang), hl, hw, kind }, R = Math.hypot(hl, hw) + 16;
    for (let i = Math.floor((x - R) / RB); i <= Math.floor((x + R) / RB); i++) for (let j = Math.floor((z - R) / RB); j <= Math.floor((z + R) / RB); j++) {
      const k = i * 65536 + j; let L = rects.get(k); if (!L) rects.set(k, (L = [])); L.push(r);
    }
  };
  // distance from (x, z) to a rectangle (0 inside)
  const rectDist = (r, x, z) => {
    const dx = x - r.x, dz = z - r.z, u = Math.abs(dx * r.c + dz * r.s) - r.hl, v = Math.abs(-dx * r.s + dz * r.c) - r.hw;
    return Math.hypot(Math.max(u, 0), Math.max(v, 0)) + Math.min(Math.max(u, v), 0);
  };
  // buildings (grown by the door stair's reach), fields (grown by their boundary and gate)
  for (const s of hc.buildingSites) addRect(s.x, s.z, s.ang, s.L / 2 + 0.6, s.W / 2 + 0.6, s.type === 'observatory' || s.type === 'monastery' ? 'summit' : 'building');
  for (const f of hc.fieldSites) addRect(f.x, f.z, Math.atan2(f.az, f.ax), f.hl + 1.4, f.hw + 1.4, 'field');
  const points = [];
  for (const p of hc.lamps || []) points.push([p[0], p[2], 1.2]);
  for (const c of hc.villageCenters || []) points.push([c.x, c.z, 8]);
  for (const e of hc.entrances || []) { points.push([e.foot.x, e.foot.z, 2.2]); points.push([e.face.x, e.face.z, 2.2]); if (e.approach) points.push([e.approach.x, e.approach.z, 2]); }
  for (const t of hc.orchardTrees || []) points.push([t.x, t.z, 3]);
  for (const k of extraKeepouts) points.push([k.x, k.z, k.r]);
  const PB = 32, pts = new Map();
  for (const p of points) { const k = Math.floor(p[0] / PB) * 65536 + Math.floor(p[1] / PB); let L = pts.get(k); if (!L) pts.set(k, (L = [])); L.push(p); }
  const pointClear = (x, z, pad) => {
    for (let i = Math.floor((x - 12) / PB); i <= Math.floor((x + 12) / PB); i++) for (let j = Math.floor((z - 12) / PB); j <= Math.floor((z + 12) / PB); j++)
      for (const p of pts.get(i * 65536 + j) || []) if (Math.hypot(p[0] - x, p[1] - z) < p[2] + pad) return false;
    return true;
  };
  const rectClear = (x, z, trunk, crown) => {
    const L = rects.get(Math.floor(x / RB) * 65536 + Math.floor(z / RB));
    if (L) for (const r of L) {
      const d = rectDist(r, x, z);
      if (r.kind === 'field') { if (d < trunk) return false; }
      else if (d < Math.max(trunk + (r.kind === 'building' ? 3.2 : 1), crown)) return false;
    }
    return true;
  };
  // planted trees keep their distance from each other
  const TB = 24, mine = new Map();
  const treeClear = (x, z, r) => {
    for (let i = Math.floor((x - 20) / TB); i <= Math.floor((x + 20) / TB); i++) for (let j = Math.floor((z - 20) / TB); j <= Math.floor((z + 20) / TB); j++)
      for (const t of mine.get(i * 65536 + j) || []) if (Math.hypot(t.x - x, t.z - z) < (t.cr + r) * 0.62 + 1.5) return false;
    return true;
  };
  const plant = (x, z, sp, s, why) => {
    if (!inHills(x, z) || onPlatform(x, z)) return false;
    const cr = crownR(sp, s);
    if (!roadClear(x, z, 3.0) || !pointClear(x, z, 1.2) || !rectClear(x, z, 1.4, cr * 0.95) || !treeClear(x, z, cr)) return false;
    // the built survey: clear of every other building, terrace, pylon and station
    if (occ.any(x, z, cr * 0.9, OCC.TALL | OCC.CLEAR) || occ.any(x, z, 0.6, OCC.TALL) || occ.any(x, z, 1.2, OCC.CROP)) return false;
    const fr = Math.max(0.9, Math.min(2.2, s * 0.06));
    const [lo, hi] = flareGround(x, z, fr);
    if (lo < 3 || (hi - lo) / (2 * fr) > 0.8) return false;
    const n = out.length + 1;
    const v = 0.88 + 0.24 * hash2(n, 7, 1);
    const t = { x, y: lo - 0.15, z, sp, s, rot: hash2(n, 3, 2) * Math.PI * 2, t0: v * (0.92 + 0.14 * hash2(n, 1, 3)), t1: v * (0.94 + 0.12 * hash2(n, 2, 3)), t2: v * (0.9 + 0.12 * hash2(n, 3, 3)), bloom: hash2(n, 4, 4), why, cr };
    out.push(t);
    const k = Math.floor(x / TB) * 65536 + Math.floor(z / TB); let L = mine.get(k); if (!L) mine.set(k, (L = [])); L.push(t);
    return true;
  };

  // ---- gardens: the houses, farms and belfries of every settlement
  let n = 0;
  for (const s of hc.buildingSites) {
    n++;
    const h = renderedHeight(s.x, s.z);
    if (s.type === 'observatory' || s.type === 'monastery') continue;
    if (s.type === 'belfry') {
      // the village's landmark pine beside its belfry
      for (let a = 0; a < 12; a++) { const ang = a * 0.52 + hash2(n, 1, 9) * 6, d = 11 + a * 0.8; if (plant(s.x + Math.cos(ang) * d, s.z + Math.sin(ang) * d, SPC.araucaria, 20 + 7 * hash2(n, 2, 9), 'belfry pine')) break; }
      continue;
    }
    const want = s.type === 'barn' ? 1 : hash2(n, 3, 9) < 0.55 ? 2 : 1;
    let got = 0;
    for (let a = 0; a < 14 && got < want; a++) {
      const ang = hash2(n, a, 10) * Math.PI * 2, d = Math.max(s.L, s.W) / 2 + 5 + hash2(n, a, 11) * 8;
      const q = hash2(n, a, 12);
      const sp = h < 45 && q < 0.35 ? SPC.palm : q < 0.5 ? SPC.flowering : q < 0.85 ? SPC.rainTree : SPC.forestBroad;
      const size = sp === SPC.palm ? 12 + 5 * hash2(n, a, 13) : sp === SPC.flowering ? 7.5 + 3 * hash2(n, a, 13) : sp === SPC.rainTree ? 10 + 4 * hash2(n, a, 13) : 13 + 4 * hash2(n, a, 13);
      if (plant(s.x + Math.cos(ang) * d, s.z + Math.sin(ang) * d, sp, size, 'garden')) got++;
    }
  }
  // ---- avenues: the country roads where they approach the villages and farms
  const settle = [...hc.villages.map((v) => [v.x, v.z, v.r + 700]), ...hc.farms.map((f) => [f.x, f.z, 420])];
  const nearSettlement = (x, z) => settle.some(([sx, sz, r]) => Math.hypot(x - sx, z - sz) < r);
  hc.roads.forEach((r, ri) => {
    if (r.kind !== 'trunk' || r.points.length < 4) return;
    const q = hash2(ri, 5, 20);
    let acc = 0, side = 0, run = 0;
    for (let k = 1; k < r.points.length; k++) {
      const a = r.points[k - 1], b = r.points[k];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      acc += L; run += L;
      if (acc < 15) continue;
      acc = 0;
      // avenues in stretches of a few hundred metres, not along every approach
      if (hash2(ri, Math.floor(run / 320), 22) > 0.62) continue;
      if (!nearSettlement(b.x, b.z)) continue;
      const coast = b.y < 40;
      const sp = coast ? SPC.palm : q < 0.45 ? SPC.forestBroad : q < 0.75 ? SPC.rainTree : q < 0.9 ? SPC.flowering : SPC.araucaria;
      const size = sp === SPC.palm ? 13 + 4 * hash2(ri, k, 21) : sp === SPC.forestBroad ? 13 + 4 * hash2(ri, k, 21) : sp === SPC.rainTree ? 10 + 3 * hash2(ri, k, 21) : sp === SPC.flowering ? 8 + 2.5 * hash2(ri, k, 21) : 17 + 6 * hash2(ri, k, 21);
      const len = Math.hypot(b.sx, b.sz) || 1, nx = b.sx / len, nz = b.sz / len;
      for (const sg of [-1, 1]) {
        const off = r.halfWidth + 4.2 + (sp === SPC.rainTree ? 1.2 : 0);
        plant(b.x + nx * sg * off, b.z + nz * sg * off, sp, size, 'avenue');
      }
      side++;
    }
  });
  // ---- groves round the summit monasteries and observatories
  for (const sh of hc.shrines) {
    for (let a = 0; a < 26; a++) {
      const ang = a * 0.2417 * Math.PI * 2 + 0.3, d = 44 + (a % 5) * 9 + hash2(a, 1, 30) * 6;
      const hb = habitat(sh.x + Math.cos(ang) * d, sh.z + Math.sin(ang) * d);
      const sp = hb.h > 1300 || a % 3 === 0 ? SPC.araucaria : SPC.forest;
      plant(sh.x + Math.cos(ang) * d, sh.z + Math.sin(ang) * d, sp, sp === SPC.araucaria ? 16 + 8 * hash2(a, 2, 30) : 12 + 5 * hash2(a, 2, 30), 'summit grove');
    }
  }
  return out;
}
