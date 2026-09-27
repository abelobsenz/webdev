import * as THREE from 'three';
import { WARDS, RIM, GATE } from './layout.js';
import { terrainHeight } from './terrain.js';
import { ST } from './urban.js';
import { patchedMaterial, FACADE_GLSL } from './materials.js';
import { createFacadeMaterial } from './facade.js';
import { mulberry32 } from './noise.js';
import { mergeClean } from './geom.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SDFGrid, SD, sweepLoop, capPolys, nestLoops, loopSpan, loopArea } from './platform.js';
import { buildWardPlan, landTexture, T } from './wardPlan.js';
import { DESIGNS, wardShape, angDiff, inArc } from './wards.js';
import { buildBuildings } from './buildings.js';
import { buildStreetscape } from './streetscape.js';
import { buildWardBridges } from './bridges.js';
import { buildWardLandmarks } from './wardLandmarks.js';

// Greater Meridian: the Outer Wards. Seven sea districts stand on built platforms in a
// ring 11-17 km out from the Axis, each designed as a city of its own (wards.js): its own
// plan, waterfront, typologies, landmarks, crown and light. The platforms are drawn from
// signed distance fields (platform.js): a battered sea wall and fender round every edge,
// a quay at +3 m, an arcaded (or glazed, or planted) terrace wall with a glass balustrade,
// and the streets at +9 m, with harbour basins, canals, a reef lagoon, raised terraces and
// moles cut and built into them. Beaches and bathing steps meet the sea where each design
// asks for them, and a shallow reef apron runs round every ward under the water. The
// street level is one surface per level, shaded from the ward's own street and land fields
// (no layered surfaces, so nothing z-fights from 15 km away).

const TAU = Math.PI * 2;
export const WARD_TOP = 9;          // street level
export const QUAY_Y = 3;            // quay level
const SEABED_Y = -7.5;
// where each ward's Great Ring station island lies (bearing from the ward centre)
export const RING_BEARING = { aurora: -0.487, sunward: -0.09, tidewater: 0.194, seraph: 1.83, southmarch: 2.27, coral: 2.25, westmere: 3.49 };
export const STATION_LAT = 32;      // maglev stations stand beside the bridge decks, on the tube side
const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
export { wardShape };

// rough base reach of each tower family (radius of its podium or splay), for the pads
function footEst(type, radius) {
  switch (type) {
    case 'helix': return radius * 2.6;
    case 'canopy': return radius * 2.45;
    case 'lens': return radius * 1.05;
    case 'lattice': return radius * 1.08;
    case 'shell': return radius * 1.35;
    case 'crystal': return radius * 1.2;
    case 'twin': return radius * 2.6;
    case 'receiver': return radius * 1.1;
    case 'seraph': return radius * 0.72;
    case 'mast': return radius * 1.6;
    case 'coral': return radius * 1.9;
    case 'deco': return radius * 1.1;
    default: return radius * 2;
  }
}

// ------------------------------------------------------------ ward records --
let RECS = null;

function rimStart(w) {
  // the rim bearing nearest the ward's that has land (the Gate channel is water)
  const b0 = Math.atan2(w.z, w.x);
  let best = null;
  for (let k = 0; k <= 40 && !best; k++) {
    for (const sgn of [1, -1]) {
      const b = b0 + sgn * k * 0.01;
      let rl = -1;
      for (let r = RIM.radius - 350; r < RIM.radius + 700; r += 10) if (terrainHeight(Math.cos(b) * r, Math.sin(b) * r) > 3.5) rl = r;
      const px = Math.cos(b) * rl, pz = Math.sin(b) * rl;
      const nearGate = [-1, 1].some((sx) => Math.hypot(px - (GATE.x + sx * GATE.span / 2), pz - GATE.z) < 450);
      if (rl > 0 && !nearGate) { best = { b, r: rl - 70 }; break; }
    }
  }
  if (!best) best = { b: b0, r: RIM.radius };
  return { x: Math.cos(best.b) * best.r, z: Math.sin(best.b) * best.r };
}

function ensureWards() {
  if (RECS) return RECS;
  RECS = WARDS.map((w) => {
    const design = DESIGNS[w.id];
    const R = (a) => w.r * wardShape(w, a);
    const towerDefs = w.towers.map(([type, a, f, height, radius, extra], i) => {
      const at = extra && extra.at;
      const lx = at ? at[0] : Math.cos(a) * R(a) * f, lz = at ? at[1] : Math.sin(a) * R(a) * f;
      return { i, type, lx, lz, height, radius, extra, pad: footEst(type, radius) + 16, level: WARD_TOP, crown: i === 0 };
    });
    const half = design.half || ({ aurora: 2120, southmarch: 1900, westmere: 2020 }[w.id] ?? w.r * 1.22 + 130);
    return { w, design, R, quayW: design.quayW, towerDefs, half };
  });
  // where each bridge comes from, and the bearing it lands on
  for (const rec of RECS) {
    const { w } = rec;
    if (w.id === 'sunward') {
      const tide = RECS.find((q) => q.w.id === 'tidewater');
      const a = Math.atan2(w.z - tide.w.z, w.x - tide.w.x);
      rec.linkFrom = tide;
      rec.b = Math.atan2(tide.w.z - w.z, tide.w.x - w.x);
      tide.linkBearing = a;
    } else {
      rec.rimStart = rimStart(w);
      rec.b = Math.atan2(rec.rimStart.z - w.z, rec.rimStart.x - w.x);
    }
  }
  for (const rec of RECS) buildFields(rec);
  return RECS;
}

function buildFields(rec) {
  const { w, R, design } = rec;
  const cell = 5;
  const sea = new SDFGrid(rec.half, cell), top = new SDFGrid(rec.half, cell);
  const extra = [];
  const rmax = w.r * 1.2;
  sea.apply('set', SD.radial(0, 0, R, rmax));
  top.apply('set', SD.radial(0, 0, (a) => R(a) - design.quayW(a), rmax));
  const features = { beaches: [], ghats: [], lighthouses: [], basins: [], docks: [] };
  const ctx = {
    w, R, quayW: design.quayW, sea, top, b: rec.b, features, towers: rec.towerDefs,
    rnd: mulberry32(9000 + w.seed * 131),
    addLevel(y, name) { const g = new SDFGrid(rec.half, cell); extra.push({ y, name, grid: g }); return g; },
  };
  rec.ctx = ctx;
  design.shape(ctx);
  extra.sort((a, b) => a.y - b.y);
  rec.levels = [{ y: WARD_TOP, name: 'street', grid: top }, ...extra];
  const levelGrid = (y) => (rec.levels.find((l) => Math.abs(l.y - y) < 0.1) || rec.levels[0]).grid;
  // landings: solid ground under each bridge end and its station
  rec.landings = [{ b: rec.b, own: true, kind: 'bridge' }];
  if (rec.linkBearing !== undefined) rec.landings.push({ b: rec.linkBearing, own: false, kind: 'link' });
  // the Great Ring: a footbridge out to the ward's station island
  rec.landings.push({ b: RING_BEARING[w.id], own: false, kind: 'ring' });
  for (const L of rec.landings) {
    const d = [Math.cos(L.b), Math.sin(L.b)];
    const r0 = R(L.b) - design.quayW(L.b);
    const c = [d[0] * (r0 - 40), d[1] * (r0 - 40)];
    top.union(SD.rbox(c[0], c[1], 58, 46, L.b, 8));
    sea.union(SD.rbox(c[0], c[1], 58 + design.quayW(L.b), 60, L.b, 8));
  }
  // every arcology stands on solid ground on its own level
  for (const t of rec.towerDefs) {
    const g = levelGrid(t.level);
    g.union(SD.circle(t.lx, t.lz, t.pad));
    for (const l of rec.levels) if (l.y < t.level - 0.1) l.grid.union(SD.circle(t.lx, t.lz, t.pad + 6));
    sea.union(SD.circle(t.lx, t.lz, t.pad + 14));
  }
  // nesting: at least a 3 m quay everywhere, and 3 m between terraces
  top.combine(sea, (t, s) => Math.max(t, s + 3));
  for (let k = 1; k < rec.levels.length; k++) {
    const below = rec.levels[k - 1].grid;
    rec.levels[k].grid.combine(below, (u, b) => Math.max(u, b + 3));
  }
  // keep every grid's border outside, so all contours close
  for (const g of [sea, ...rec.levels.map((l) => l.grid)]) {
    const n = g.n;
    for (let i = 0; i < n; i++) { g.d[i] = g.M; g.d[(n - 1) * n + i] = g.M; g.d[i * n] = g.M; g.d[i * n + n - 1] = g.M; }
  }
  rec.sea = sea;
  // the landing points: where each bridge meets the terrace wall
  for (const L of rec.landings) {
    const d = [Math.cos(L.b), Math.sin(L.b)];
    let r = R(L.b) * 0.5;
    while (r < R(L.b) * 1.2 && top.sample(d[0] * r, d[1] * r) < 0) r += 0.5;
    L.E = [d[0] * r, d[1] * r];                        // on the wall line (local)
    L.t = [-d[0], -d[1]];                              // pointing into the ward
    L.side = [-L.t[1], L.t[0]];                        // frameAt side: (-t.z, t.x)
    L.x = L.E[0] - d[0] * 2; L.z = L.E[1] - d[1] * 2;
    const lat = STATION_LAT;
    L.station = L.kind === 'ring' ? null : { x: L.E[0] + L.t[0] * 35 + L.side[0] * lat, z: L.E[1] + L.t[1] * 35 + L.side[1] * lat, rot: Math.atan2(L.t[1], L.t[0]) };
  }
  ctx.landing = rec.landings[0];
  ctx.landings = rec.landings;
}

/** Street level (or terrace) at local (x, z), at least m metres from its edge; else null. */
function levelAtRec(rec, x, z, m = 0) {
  const L = rec.levels;
  for (let k = L.length - 1; k >= 0; k--) {
    const d = L[k].grid.sample(x, z);
    if (d < -m) return L[k].y;
    if (d < m) return null;
  }
  return null;
}

function recAt(x, z) {
  const R = ensureWards();
  for (const rec of R) {
    const dx = x - rec.w.x, dz = z - rec.w.z;
    if (Math.abs(dx) < rec.half && Math.abs(dz) < rec.half) return rec;
  }
  return null;
}

/** Built ground of the wards (street level, terraces or quay) at (x, z), or -Infinity off them. */
export function wardHeight(x, z) {
  const rec = recAt(x, z);
  if (!rec) return -Infinity;
  const lx = x - rec.w.x, lz = z - rec.w.z;
  const L = rec.levels;
  for (let k = L.length - 1; k >= 0; k--) if (L[k].grid.sample(lx, lz) < 0) return L[k].y;
  if (rec.sea.sample(lx, lz) < 0) return QUAY_Y;
  return -Infinity;
}

export function wardAt(x, z) {
  for (const w of WARDS) if (Math.hypot(x - w.x, z - w.z) < w.r * 1.3) return w;
  return null;
}

export function wardRecords() { return ensureWards(); }

/** Arcology definitions for the wards (built with the lagoon's towers). */
export function wardTowerDefs() {
  const out = [];
  const pals = ['pearl', 'silver', 'jade', 'bronze', 'rose', 'sand'];
  for (const rec of ensureWards()) {
    const { w } = rec;
    for (const t of rec.towerDefs) {
      const { i, type, lx, lz, height, radius, extra } = t;
      const ex = { ...(extra || {}) };
      delete ex.at;
      out.push({
        type, x: w.x + lx, z: w.z + lz, height, radius,
        seed: 100 + w.seed * 10 + i, palette: i === 0 ? w.palette : pals[(w.seed + i) % pals.length],
        name: i === 0 ? `${w.name} Crown` : undefined, ward: w.id, level: t.level, ...ex,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- bridges --
/**
 * Bridge centrelines (Vector3[] at deck level) and their bridgeheads: from a podium on the
 * rim's land (or, for Sunward, from Tidewater's landing) arcing 46 m over the sea to the
 * ward's landing on its terrace wall. Computed before the lagoon's town plan so its lots
 * keep clear.
 */
export function wardBridgePaths(ground) {
  const paths = [];
  for (const rec of ensureWards()) {
    const { w } = rec;
    const L = rec.landings[0];
    const ex = w.x + L.E[0] + L.t[0] * 1.0, ez = w.z + L.E[1] + L.t[1] * 1.0, ey = WARD_TOP + 0.3;
    let sx, sz, sy, head = null;
    if (rec.linkFrom) {
      const T0 = rec.linkFrom, LL = T0.landings.find((q) => !q.own);
      sx = T0.w.x + LL.E[0] + LL.t[0] * 1.0; sz = T0.w.z + LL.E[1] + LL.t[1] * 1.0; sy = WARD_TOP + 0.3;
    } else {
      // a bridgehead podium on the rim: the deck and the maglev station stand on it
      const s = rec.rimStart;
      const u = [ex - s.x, ez - s.z];
      const ul = Math.hypot(u[0], u[1]);
      u[0] /= ul; u[1] /= ul;
      const side = [-u[1], u[0]];
      const hx = s.x - u[0] * 30 + side[0] * 14, hz = s.z - u[1] * 30 + side[1] * 14;
      let hi = -1e9, lo = 1e9;
      for (let a = -48; a <= 48; a += 6) for (let b = -44; b <= 44; b += 6) {
        const g = ground(hx + u[0] * a + side[0] * b, hz + u[1] * a + side[1] * b);
        hi = Math.max(hi, g); lo = Math.min(lo, g);
      }
      const top = Math.max(hi, 3.5) + 3.0;            // a raised bridgehead, well clear of the ground
      // the deck leaves from the podium's seaward edge, a step above its paving; the station's
      // portal ring meets the tube there
      sx = s.x + u[0] * 18; sz = s.z + u[1] * 18; sy = top + 0.6;
      head = { x: hx, z: hz, rot: Math.atan2(u[1], u[0]), hw: 48, hd: 44, y: top, lo: Math.min(lo, top - 3) - 2.5, u, side, s: [s.x, s.z],
        station: { x: s.x - u[0] * 14.5 + side[0] * STATION_LAT, z: s.z - u[1] * 14.5 + side[1] * STATION_LAT, rot: Math.atan2(-u[1], -u[0]) } };
    }
    const Lb = Math.hypot(ex - sx, ez - sz);
    const N = Math.max(40, Math.ceil(Lb / 25));
    const path = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const x = sx + (ex - sx) * t, z = sz + (ez - sz) * t;
      let y = sy + (ey - sy) * t + 46 * Math.sin(Math.PI * t) + 2 * ss(0, 0.05, t) * (1 - ss(0.95, 1, t));
      if (t < 0.5) y = Math.max(y, Math.max(terrainHeight(x, z), 0) + 6 * ss(0.0, 0.04, t) + 0.4);
      path.push(new THREE.Vector3(x, y, z));
    }
    paths.push({ ward: w.id, path, head, from: rec.linkFrom ? rec.linkFrom.w.id : 'rim' });
  }
  return paths;
}

// ---------------------------------------------------------------- platform --
function gapFn(gaps) {
  return (x, z) => {
    let g = 0;
    for (const p of gaps) {
      const d = Math.hypot(x - p.x, z - p.z) - p.hw;
      if (d < 2) g = Math.max(g, 1 - ss(0, 2, d));
    }
    return g;
  };
}

function seaSection(rec, gapAt) {
  const low = (rec.design.wall && rec.design.wall.lower) ?? 1;
  const band = (rec.design.wall && rec.design.wall.band) ?? 10;
  return (x, z) => {
    const g = gapAt(x, z);
    const kh = 0.45 * (1 - g), kw = 0.7 * (1 - g);
    return [
      { a: [2.4, -16], b: [0, QUAY_Y - 0.7], kind: low },
      { a: [0, QUAY_Y - 0.7], b: [0, QUAY_Y + kh], kind: band },
      { a: [0, QUAY_Y + kh], b: [-kw, QUAY_Y + kh], kind: 1 },
      { a: [-kw, QUAY_Y + kh], b: [-kw, QUAY_Y - 0.05], kind: 1 },
    ];
  };
}

function wallSection(y0, y1, kind, gapAt, { glass = true } = {}) {
  return (x, z) => {
    const g = gapAt(x, z);
    const ph = 0.45 * (1 - g), cw = 0.8 * (1 - g), gh = glass ? 0.95 * (1 - g) : 0.001;
    return [
      { a: [0, y0 - 0.1], b: [0, y1 + ph], kind },
      { a: [0, y1 + ph], b: [-cw, y1 + ph], kind: 1 },
      { a: [-cw, y1 + ph], b: [-cw, y1 - 0.05], kind: 1 },
      { a: [-0.34 * (1 - g), y1 + ph], b: [-0.34 * (1 - g), y1 + ph + gh], kind: 12 },
      { a: [-0.34 * (1 - g), y1 + ph + gh], b: [-0.46 * (1 - g), y1 + ph + gh], kind: 10 },
      { a: [-0.46 * (1 - g), y1 + ph + gh], b: [-0.46 * (1 - g), y1 + ph], kind: 12 },
    ];
  };
}

/** The longest run of loop vertices whose bearing (from the ward centre) lies in [a0, a1]. */
function spanOnLoop(loop, a0, a1) {
  const n = loop.length;
  const ok = loop.map((p) => inArc(Math.atan2(p[1], p[0]), a0, a1));
  let best = null;
  for (let k = 0; k < n; k++) {
    if (!ok[k] || ok[(k - 1 + n) % n]) continue;
    let m = 0;
    while (m < n && ok[(k + m) % n]) m++;
    if (!best || m > best.m) best = { k, m };
  }
  if (!best || best.m < 3) return null;
  const pts = [];
  for (let i = 0; i < best.m; i++) pts.push(loop[(best.k + i) % n]);
  return pts;
}

function boxAlong(parts, p, t, n, u0, u1, o0, o1, y0, y1, kind, ox, oz, topKind = kind) {
  // a box in the frame of a wall: u along t, o along the outward normal n
  const C = (u, o) => [ox + p[0] + t[0] * u + n[0] * o, oz + p[1] + t[1] * u + n[1] * o];
  const q = [C(u0, o0), C(u1, o0), C(u1, o1), C(u0, o1)];
  const pos = [], nor = [], fac = [], idx = [];
  const quad = (a, b, c, d, nx, ny, nz, k, fu = 0) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) { pos.push(v[0], v[1], v[2]); nor.push(nx, ny, nz); fac.push(fu + (v === a || v === d ? 0 : Math.hypot(b[0] - a[0], b[2] - a[2])), v[1], k); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const V = (i, y) => [q[i][0], y, q[i][1]];
  // top
  const tb = pos.length / 3;
  for (let i = 0; i < 4; i++) { pos.push(q[i][0], y1, q[i][1]); nor.push(0, 1, 0); fac.push(q[i][0], q[i][1], topKind); }
  idx.push(tb, tb + 1, tb + 2, tb, tb + 2, tb + 3);
  const sides = [[0, 1, [-n[0], -n[1]]], [1, 2, t], [2, 3, n], [3, 0, [-t[0], -t[1]]]];
  for (const [a, b, nn] of sides) quad(V(a, y0), V(b, y0), V(b, y1), V(a, y1), nn[0], 0, nn[1], kind);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(fixIdx(pos, nor, idx));
  parts.push(g);
}
function fixIdx(pos, nor, idx) {
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nor[a * 3] + ny * nor[a * 3 + 1] + nz * nor[a * 3 + 2] < 0) { idx[t + 1] = c; idx[t + 2] = b; }
  }
  return idx;
}

/** Open polyline frame: point, unit tangent and outward (right) normal at each vertex. */
function frames(pts) {
  return pts.map((p, i) => {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    return { p, t: [tx / l, tz / l], n: [tz / l, -tx / l] };
  });
}

function buildPlatform(rec, P) {
  const { w, sea, levels, design } = rec;
  const ox = w.x, oz = w.z;
  const walls = [], quay = [], grounds = [], sand = [], near = [], far = [];
  // gaps in the parapets: bridge landings, the heads of stairs, quay stairs
  const topGaps = [], levelGaps = levels.map(() => []), seaGaps = [];
  for (const L of rec.landings) topGaps.push({ x: L.E[0], z: L.E[1], hw: L.kind === 'ring' ? 7.5 : 14.5 });
  for (const s of P.stairs) {
    const k = levels.findIndex((l) => Math.abs(l.y - s.y1) < 0.1);
    if (k > 0) {
      // the wall crossing between the two street ends
      const g = levels[k].grid;
      let wp = s.hi;
      for (let t = 0; t <= 1; t += 0.02) { const x = s.lo[0] + (s.hi[0] - s.lo[0]) * t, z = s.lo[1] + (s.hi[1] - s.lo[1]) * t; if (g.sample(x, z) < 0) { wp = [x, z]; break; } }
      s.wall = wp;
      levelGaps[k].push({ x: wp[0], z: wp[1], hw: s.hw + 0.5 });
    }
  }
  // quay stairs every ~230 m along the outer terrace wall, away from landings and features
  const topLoops = levels[0].grid.contours(0, 0.2);
  const outerTop = topLoops.reduce((b, l) => (loopArea(l) > (b ? loopArea(b) : 0) ? l : b), null);
  const quayStairs = [];
  if (outerTop) {
    const fr = frames([...outerTop, outerTop[0]]);
    let acc = 90;
    for (let i = 1; i < fr.length; i++) {
      acc += Math.hypot(fr[i].p[0] - fr[i - 1].p[0], fr[i].p[1] - fr[i - 1].p[1]);
      if (acc < 230) continue;
      const f = fr[i];
      const test = [f.p[0] + f.n[0] * 9, f.p[1] + f.n[1] * 9];
      if (sea.sample(test[0], test[1]) > -2) continue;                         // quay too narrow here
      if (rec.landings.some((L) => Math.hypot(L.E[0] - f.p[0], L.E[1] - f.p[1]) < 110)) continue;
      acc = 0;
      quayStairs.push(f);
      topGaps.push({ x: f.p[0] + f.t[0] * 0.8, z: f.p[1] + f.t[1] * 0.8, hw: 1.9 });
    }
  }
  for (const L of P.landmarks) if (L.type === 'cascade') {
    // the Cascade crosses every terrace wall: no parapet across it
    for (let k = 0; k < levels.length; k++) {
      const g = levels[k].grid;
      for (let r = L.r0; r < L.r1; r += 1) {
        const x = Math.cos(L.a) * r, z = Math.sin(L.a) * r;
        if (g.sample(x, z) > 0) { (k === 0 ? topGaps : levelGaps[k]).push({ x, z, hw: L.w / 2 }); break; }
      }
    }
  }
  const topGapAt = gapFn(topGaps);
  const lowWall = (design.wall && design.wall.arcade) ?? 5;
  const terrKind = (design.wall && design.wall.terrace) ?? 1;
  // ---- sea walls round every edge
  const seaLoops = sea.contours(0, 0.2);
  // ghats and beaches remove the kerb where they meet the quay
  const spans = [];
  const outerSea = seaLoops.reduce((b, l) => (loopArea(l) > (b ? loopArea(b) : 0) ? l : b), null);
  const innerSea = seaLoops.filter((l) => loopArea(l) < 0).sort((a, b) => loopArea(a) - loopArea(b))[0];
  for (const f of [...rec.ctx.features.ghats.map((g) => ({ ...g, kind: 'ghat' })), ...rec.ctx.features.beaches.map((g) => ({ ...g, kind: 'beach' }))]) {
    const loop = f.inner ? innerSea : outerSea;
    if (!loop) continue;
    const pts = spanOnLoop(loop, f.a0, f.a1);
    if (!pts) continue;
    spans.push({ ...f, pts });
    if (f.kind === 'ghat') for (let i = 0; i < pts.length; i += 2) seaGaps.push({ x: pts[i][0], z: pts[i][1], hw: 3 });
  }
  const seaGapAt = gapFn(seaGaps);
  for (const loop of seaLoops) walls.push(sweepLoop(loop, seaSection(rec, seaGapAt), { ox, oz }));
  // holes in the ground under landmarks that stand on it (the Cascade, the cavea)
  const holes = [];
  for (const L of P.landmarks) {
    if (L.type === 'cascade') {
      const rm = (L.r0 + L.r1) / 2;
      holes.push(SD.rbox(Math.cos(L.a) * rm, Math.sin(L.a) * rm, (L.r1 - L.r0) / 2 + 0.5, L.w / 2 - 1.2, L.a, 0.5));
    } else if (L.type === 'amphitheatre') {
      const a0 = L.a + Math.PI / 2 + 0.14, a1 = L.a + 1.5 * Math.PI - 0.14, pts = [];
      for (let i = 0; i <= 40; i++) { const a = a0 + ((a1 - a0) * i) / 40; pts.push([L.x + Math.cos(a) * (L.r1 - 0.6), L.z + Math.sin(a) * (L.r1 - 0.6)]); }
      for (let i = 40; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / 40; pts.push([L.x + Math.cos(a) * (L.r0 + 0.6), L.z + Math.sin(a) * (L.r0 + 0.6)]); }
      holes.push(SD.polygon(pts));
    }
  }
  // ---- the quay between the sea wall and the terrace wall
  {
    const q = sea.clone().combine(levels[0].grid, (s, t) => Math.max(s, -t));
    for (const h of holes) q.sub(h);
    quay.push(capPolys(nestLoops(q.contours(0, 0.2)), QUAY_Y, 9, { ox, oz }));
  }
  // ---- terrace walls: quay to street, and each terrace to the next
  for (const loop of topLoops) walls.push(sweepLoop(loop, wallSection(QUAY_Y, WARD_TOP, lowWall, topGapAt), { ox, oz }));
  for (let k = 1; k < levels.length; k++) {
    const gAt = gapFn(levelGaps[k]);
    for (const loop of levels[k].grid.contours(0, 0.2)) walls.push(sweepLoop(loop, wallSection(levels[k - 1].y, levels[k].y, terrKind, gAt, { glass: true }), { ox, oz }));
  }
  // ---- the street level (and terraces): one surface per level, with holes where a station
  // plinth stands (its walls go down into the platform, so no surface lies on another)
  for (let k = 0; k < levels.length; k++) {
    let g = levels[k].grid;
    if (k < levels.length - 1) g = g.clone().combine(levels[k + 1].grid, (a, b) => Math.max(a, -b));
    if (k === 0) {
      g = g === levels[k].grid ? g.clone() : g;
      for (const L of rec.landings) if (L.station) g.sub(SD.rbox(L.station.x, L.station.z, 37, 15, L.station.rot, 10));
    }
    if (holes.length) { g = g === levels[k].grid ? g.clone() : g; for (const h of holes) g.sub(h); }
    grounds.push(capPolys(nestLoops(g.contours(0, 0.2)), levels[k].y, 0, { ox, oz, facade: false }));
  }
  // ---- beaches below the promenade, bathing steps, their groynes and cheeks
  for (const s of spans) {
    const fr = frames(s.pts);
    if (s.kind === 'beach') {
      const prof = [[0, QUAY_Y - 0.5], [8, 1.7], [22, 0.55], [40, -0.8], [60, -3.0], [86, SEABED_Y - 0.3]];
      const faces = [];
      for (let i = 0; i < prof.length - 1; i++) faces.push({ a: [prof[i + 1][0], prof[i + 1][1]], b: [prof[i][0], prof[i][1]], kind: 0 });
      sand.push(sweepLoop(s.pts, () => faces, { ox, oz, closed: false }));
      for (const f of [fr[0], fr[fr.length - 1]]) {
        const sgn = f === fr[0] ? -1 : 1;
        // groyne: a stone jetty along the normal, sloping to the sea
        const n = 12;
        for (let j = 0; j < n; j++) {
          const o0 = -0.6 + (j * 90) / n, o1 = -0.6 + ((j + 1) * 90) / n;
          const yt = QUAY_Y + 0.4 - (2.6 * (j + 0.5)) / n;
          boxAlong(walls, f.p, f.t, f.n, sgn * 3.2 - 2.6, sgn * 3.2 + 2.6, o0, o1, SEABED_Y - 0.5, yt, 1, ox, oz);
        }
      }
    } else {
      const steps = 9, tread = 1.3, rise = 0.5;
      const faces = [];
      for (let j = 0; j < steps; j++) {
        const o0 = j * tread, o1 = (j + 1) * tread;
        const y0 = QUAY_Y - j * rise, y1 = QUAY_Y - (j + 1) * rise;
        faces.push({ a: [o0, y0], b: [o0, y1], kind: 1 });            // riser (faces outward)
        faces.push({ a: [o1, y1], b: [o0, y1], kind: 9 });            // tread (faces up)
      }
      faces.push({ a: [steps * tread, QUAY_Y - steps * rise], b: [steps * tread, SEABED_Y - 0.5], kind: 1 });
      walls.push(sweepLoop(s.pts, () => faces, { ox, oz, closed: false }));
      for (const f of [fr[0], fr[fr.length - 1]]) {
        const sgn = f === fr[0] ? -1 : 1;
        boxAlong(walls, f.p, f.t, f.n, sgn * 1.2 - 1.2, sgn * 1.2 + 1.2, -0.7, steps * tread + 0.6, SEABED_Y - 0.5, QUAY_Y + 0.5, 1, ox, oz);
      }
    }
  }
  // ---- quay stairs up the terrace wall (near detail) and their far wedges
  for (const f of quayStairs) {
    const n = 20;
    for (let j = 0; j < n; j++) {
      const u0 = -11 + j * 0.5;
      boxAlong(near, f.p, f.t, f.n, u0, u0 + 0.5, 0.15, 3.3, QUAY_Y - 0.1, QUAY_Y + (j + 1) * 0.3, 1, ox, oz, 9);
    }
    boxAlong(near, f.p, f.t, f.n, -0.5, 1.6, 0.15, 3.3, QUAY_Y - 0.1, WARD_TOP - 0.02, 1, ox, oz, 9);
    boxAlong(far, f.p, f.t, f.n, -11, 1.6, 0.15, 3.3, QUAY_Y - 0.1, WARD_TOP - 0.02, 1, ox, oz, 1);
  }
  // ---- stairs between the terraces
  for (const s of P.stairs) {
    if (!s.wall) continue;
    const d = [s.wall[0] - s.lo[0], s.wall[1] - s.lo[1]];
    const dl = Math.hypot(d[0], d[1]) || 1;
    const t = [d[0] / dl, d[1] / dl];
    const side = [-t[1], t[0]];
    const rise = s.y1 - s.y0;
    const n = Math.max(4, Math.round(rise / 0.3));
    const run = n * 0.42;
    for (let j = 0; j < n; j++) {
      const u0 = -run - 1.2 + j * 0.42;
      boxAlong(near, s.wall, side, t, -s.hw, s.hw, u0, u0 + 0.42 + (j === n - 1 ? 1.25 : 0), s.y0 - 0.1, s.y0 + (j + 1) * (rise / n) - 0.02, 1, ox, oz, 9);
    }
    // cheek walls and their far massing
    for (const sg of [-1, 1]) boxAlong(near, s.wall, side, t, sg * s.hw - 0.5, sg * s.hw + 0.5, -run - 1.2, 0.1, s.y0 - 0.1, s.y1 + 0.45, 1, ox, oz);
    boxAlong(far, s.wall, side, t, -s.hw - 0.5, s.hw + 0.5, -run - 1.2, 0.1, s.y0 - 0.1, s.y0 + rise * 0.5, 1, ox, oz);
  }
  // ---- the reef apron under the water round the ward and its basins
  const seabed = [];
  {
    const n = 192;
    const pos = [], idx = [];
    const rings = [[0, SEABED_Y], [1.0, SEABED_Y], [1.06, SEABED_Y], [1.1, -26], [1.14, -60]];
    const extra = 90;
    for (let j = 0; j < rings.length; j++) {
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * TAU;
        const Rr = rec.R(a) * (j === 0 ? 0 : 1) * rings[j][0] + (j >= 2 ? extra * (j - 1) * 0.6 : 0) + (j === 1 ? 40 : 0);
        pos.push(ox + Math.cos(a) * Rr, rings[j][1], oz + Math.sin(a) * Rr);
      }
    }
    for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // make sure every face points up
    const nr = g.attributes.normal;
    if (nr.getY(n + 5) < 0) { for (let k = 0; k < idx.length; k += 3) { const tt = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tt; } g.setIndex(idx); g.computeVertexNormals(); }
    seabed.push(g);
  }
  // ---- quay lamps and walks
  const quayLamps = [], quayWalks = [];
  {
    const q = sea.clone().combine(levels[0].grid, (s, t) => Math.max(s, -t));
    for (const loop of q.contours(-4, 0.5)) {
      if (Math.abs(loopArea(loop)) < 2000) continue;
      quayWalks.push(loop);
    }
    for (const loop of seaLoops) {
      const fr = frames([...loop, loop[0]]);
      let acc = 0, k = 0;
      for (let i = 1; i < fr.length; i++) {
        acc += Math.hypot(fr[i].p[0] - fr[i - 1].p[0], fr[i].p[1] - fr[i - 1].p[1]);
        if (acc < 28) continue;
        acc = 0;
        const f = fr[i];
        const x = f.p[0] - f.n[0] * 2.2, z = f.p[1] - f.n[1] * 2.2;
        if (q.sample(x, z) > -1.2 || seaGapAt(f.p[0], f.p[1]) > 0.1) continue;
        quayLamps.push({ lx: x, lz: z, yaw: Math.atan2(f.n[0], f.n[1]), cls: 4, y: QUAY_Y });
        k++;
      }
    }
  }
  return { walls, quay, grounds, sand, seabed, near, far, quayLamps, quayWalks, spans, quayStairs, seaLoops, topLoops };
}

// ------------------------------------------------------------ ground material --
const GROUND_PARS = /* glsl */ `
uniform sampler2D uWField;
uniform sampler2D uWLand;
uniform sampler2D uWDetail;
uniform vec2 uWC;
uniform float uWHalf;
uniform vec3 uPave1;
uniform vec3 uPave2;
uniform float uPaveStyle;
uniform vec3 uZoneCol;
uniform vec3 uLampCol;
uniform vec3 uInlayCol;
uniform vec3 uInlayGlow;
${FACADE_GLSL}
vec2 wardUV(vec2 p) { return (p - uWC) / (2.0 * uWHalf) + 0.5; }
vec4 wardSample(sampler2D t, vec2 p, vec4 outside) {
  vec2 uv = wardUV(p);
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return outside;
  return texture2D(t, uv);
}
float wGrid(vec2 p, float period, float w, float fw) {
  vec2 d = abs(fract(p / period + 0.5) - 0.5) * period;
  return 1.0 - smoothstep(w, w + fw * 1.5, min(d.x, d.y));
}
float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// joint lines of a paving course: filtered so they fade to their average density
float joints(vec2 p, vec2 size, float jw, vec2 fw) {
  float jx = 1.0 - fPulse(p.x, size.x, 0.0, size.x - jw, fw.x);
  float jy = 1.0 - fPulse(p.y, size.y, 0.0, size.y - jw, fw.y);
  return max(jx, jy);
}
vec3 worleyG(vec2 p) {
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 r = o + hash22(ip + o) - fp;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash12(ip + o + 5.7); } else if (d < d2) d2 = d;
  }
  d1 = sqrt(d1);
  return vec3(d1, sqrt(d2) - d1, id);
}
vec3 wardPaving(vec2 p, vec2 fw, float det) {
  float style = uPaveStyle;
  vec3 c = uPave1;
  if (style < 0.5) {
    // granite slabs on a coordinate grid, darker bands every 7.2 m
    vec2 s = floor(p / 1.8);
    c = uPave1 * mix(1.0, 0.94 + 0.1 * h21(s), det);
    c *= 1.0 - 0.3 * joints(p, vec2(1.8), 0.02, fw) * det;
    float band = 1.0 - fPulse(p.x, 7.2, 0.0, 6.9, fw.x) * fPulse(p.y, 7.2, 0.0, 6.9, fw.y);
    c = mix(c, uPave2, band * 0.8);
  } else if (style < 1.5) {
    // herringbone brick
    vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p;
    float row = floor(q.y / 0.2);
    float par = mod(floor(q.x / 0.4) + row, 2.0);
    vec2 b = par < 0.5 ? vec2(q.x, q.y) : vec2(q.y, q.x);
    vec2 cellId = floor(b / vec2(0.4, 0.2));
    c = mix(uPave1, uPave2, mix(0.4, h21(cellId), det));
    c *= 1.0 - 0.35 * joints(b, vec2(0.4, 0.2), 0.012, fw * 1.41) * det;
  } else if (style < 2.5) {
    // sun-ray paving: rings every 2.4 m, radial joints, from the ward centre
    vec2 d = p - uWC;
    float r = length(d);
    float a = atan(d.y, d.x) * r;
    vec2 q = vec2(a, r);
    vec2 fq = vec2(max(fw.x, fw.y));
    vec2 s = floor(q / vec2(1.6, 2.4));
    c = mix(uPave1, uPave2, mix(0.3, h21(s) * 0.7, det));
    c *= 1.0 - 0.3 * joints(q, vec2(1.6, 2.4), 0.02, fq) * det;
  } else if (style < 3.5) {
    // rose opus incertum: irregular flags
    vec3 w = worleyG(p * 0.8);
    c = mix(uPave1, uPave2, mix(0.3, w.z, det));
    c *= 1.0 - 0.35 * (1.0 - smoothstep(0.02, 0.06 + fw.x * 0.8, w.y)) * det;
  } else if (style < 4.5) {
    // granite setts in rows, a border of long kerbstones every 6 m
    vec2 s = floor(p / vec2(0.2, 0.12));
    c = uPave1 * mix(1.0, 0.85 + 0.3 * h21(s), det * (1.0 - smoothstep(0.05, 0.15, fw.x)));
    c *= 1.0 - 0.25 * joints(p, vec2(0.2, 0.12), 0.012, fw) * det;
    float border = 1.0 - fPulse(p.x, 6.0, 0.0, 5.4, fw.x) * fPulse(p.y, 6.0, 0.0, 5.4, fw.y);
    c = mix(c, uPave2, border * 0.7);
  } else if (style < 5.5) {
    // shell terrazzo with wave joints
    float wv = p.y + 0.8 * sin(p.x * 0.35);
    c = uPave1 * (0.96 + 0.08 * vnoise(p * 0.7));
    c = mix(c, uPave2, smoothstep(0.7, 0.85, vnoise(p * 9.0)) * 0.5 * det);
    c *= 1.0 - 0.3 * (1.0 - fPulse(wv, 3.0, 0.0, 2.96, fw.y)) * det;
  } else {
    // marble checkerboard set on the diagonal
    vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p;
    float chk = fPulse(q.x, 3.0, 0.0, 1.5, fw.x * 1.41) * fPulse(q.y, 3.0, 0.0, 1.5, fw.y * 1.41);
    chk += (1.0 - fPulse(q.x, 3.0, 0.0, 1.5, fw.x * 1.41)) * (1.0 - fPulse(q.y, 3.0, 0.0, 1.5, fw.y * 1.41));
    c = mix(uPave2, uPave1, chk);
    c *= 0.97 + 0.06 * vnoise(p * 1.3) * det;
  }
  return c;
}
`;
const GROUND_COLOR = /* glsl */ `
{
  vec2 wp = vWPos.xz;
  vec4 ws = wardSample(uWField, wp, vec4(1.0, 1.0, 0.0, 0.0));
  vec4 wl = wardSample(uWLand, wp, vec4(1.0, 0.0, 0.0, 1.0));
  vec4 wd = wardSample(uWDetail, wp, vec4(1.0, 1.0, 0.0, 0.0));
  float wEdge = ws.r * 32.0 - 16.0;        // signed metres from the kerb (< 0 on the carriageway)
  float wCen = ws.g * 32.0 - 16.0;
  float wSq = smoothstep(0.3, 0.7, ws.b);
  float pathD = wl.r * 32.0 - 16.0;
  float zone = wl.g;
  float bed = smoothstep(0.35, 0.65, wl.b);
  float inlayD = wd.r * 8.0 - 4.0;
  float poolD = wd.g * 16.0 - 8.0;
  float parterre = smoothstep(0.4, 0.6, wd.b);
  vec2 fw2 = max(vec2(fwidth(wp.x), fwidth(wp.y)), vec2(1e-3));
  float fw = max(fw2.x, fw2.y);
  float aa = max(fw * 0.7, 0.08);
  float det = 1.0 - smoothstep(0.25, 1.4, fw);          // fine detail only while resolved
  float n1 = vnoise(wp * 0.045), n2 = vnoise(wp * 0.7);
  // lawns (a mown stripe close up) and planted beds of shrubs and flowers
  vec3 lawn = mix(vec3(0.085, 0.16, 0.05), vec3(0.19, 0.27, 0.09), n1 * 0.75 + n2 * 0.25 * det);
  lawn *= 1.0 + 0.05 * (fPulse(wp.x + wp.y * 0.3, 5.0, 0.0, 2.5, fw * 1.2) - 0.5) * det;
  vec3 wz = worleyG(wp * 0.9);
  vec3 shrub = mix(vec3(0.03, 0.08, 0.025), vec3(0.1, 0.18, 0.05), wz.z) * (0.8 + 0.4 * vnoise(wp * 5.0));
  vec3 flower = mix(vec3(0.72, 0.2, 0.3), vec3(0.85, 0.7, 0.2), step(0.5, fract(wz.z * 7.1)));
  flower = mix(flower, vec3(0.45, 0.35, 0.8), step(0.72, fract(wz.z * 3.3)));
  vec3 bedC = mix(shrub, flower * 0.7, smoothstep(0.55, 0.8, wz.z) * det + 0.25 * (1.0 - det));
  vec3 garden = mix(lawn, bedC, bed);
  // parterres: clipped box hedges drawing scrolls and diamonds over gravel
  if (parterre > 0.01) {
    vec2 q = mod(wp, 6.0) - 3.0;
    float dia = abs(abs(q.x) + abs(q.y) - 2.2);
    float ring = abs(length(q) - 1.4);
    float hedge = 1.0 - smoothstep(0.18, 0.18 + fw * 1.5, min(dia, ring));
    vec3 grav = uZoneCol * (0.9 + 0.1 * vnoise(wp * 3.0));
    vec3 pt = mix(grav, vec3(0.04, 0.1, 0.03) * (0.9 + 0.2 * n2), mix(0.4, hedge, det));
    garden = mix(garden, pt, parterre);
  }
  // special ground (the heliostat gravel, reef sand, ...)
  vec3 zoneC = uZoneCol * (0.9 + 0.12 * vnoise(wp * 1.7)) * mix(1.0, 0.92 + 0.12 * vnoise(wp * 13.0), det);
  garden = mix(garden, zoneC, smoothstep(0.35, 0.65, zone));
  // garden paths of fine gravel, edged
  float onPath = 1.0 - smoothstep(-aa, aa, pathD);
  vec3 pathC = mix(uPave2, uZoneCol, 0.5) * (0.9 + 0.12 * vnoise(wp * 4.0));
  pathC *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.25 + aa, abs(pathD + 0.12))) * det;
  garden = mix(garden, pathC, onPath);
  // pavements and squares
  vec2 slab = floor(wp / 1.2);
  float sh = h21(slab);
  vec3 walk = uPave1 * 0.95 * mix(1.0, 0.93 + 0.1 * sh, det);
  walk *= 1.0 - 0.28 * wGrid(wp, 1.2, 0.02, fw) * det;
  vec3 plaza = wardPaving(wp, fw2, det);
  // carriageway: smooth warm-grey composite, bronze centre inlay
  vec3 road = mix(vec3(0.30, 0.30, 0.31), vec3(0.34, 0.33, 0.33), n2 * det);
  float inlay = (1.0 - smoothstep(0.08, 0.08 + aa, abs(wCen))) * det;
  road = mix(road, vec3(0.62, 0.46, 0.26), inlay * 0.8);
  vec3 kerb = vec3(0.76, 0.74, 0.70);
  float onRoad = 1.0 - smoothstep(-aa, aa, wEdge);
  float onKerb = smoothstep(-aa, aa, wEdge) * (1.0 - smoothstep(0.32 - aa, 0.32 + aa, wEdge));
  float onWalk = smoothstep(0.32 - aa, 0.32 + aa, wEdge) * (1.0 - smoothstep(4.6 - aa, 4.6 + aa, wEdge));
  vec3 c = garden;
  c = mix(c, walk, onWalk);
  c = mix(c, plaza, wSq * (1.0 - onRoad));
  c = mix(c, kerb, onKerb);
  c = mix(c, road, onRoad);
  // inlaid bronze lines (meridians, orbits, hour lines)
  float onInlay = (1.0 - smoothstep(-aa * 0.5, aa * 0.5, inlayD)) * mix(0.5, 1.0, det);
  c = mix(c, uInlayCol, onInlay * (1.0 - onRoad));
  // ornamental pools: shaded here, in the ground itself (their kerbs are geometry)
  float pool = 1.0 - smoothstep(-aa, aa, poolD);
  vec3 water = mix(vec3(0.02, 0.12, 0.14), vec3(0.05, 0.2, 0.22), vnoise(wp * 0.3 + uTime * 0.05));
  c = mix(c, water, pool);
  diffuseColor.rgb = c;
  float paved = max(onWalk, wSq * (1.0 - onRoad));
  wRough = mix(mix(mix(0.95, 0.72, paved), 0.55, onRoad), 0.35, onInlay);
  wRough = mix(wRough, 0.04, pool);
  wMetal = onInlay * 0.8 * (1.0 - onRoad);
  wLamp = ws.a * ws.a;
  wInlay = inlay * onRoad;
  wGlowLine = onInlay * (1.0 - onRoad);
  wPool = pool;
}
`;

function groundMaterial(P, rec) {
  const g = rec.design.ground;
  const uniforms = {
    uWField: { value: P.field.texture() }, uWLand: { value: landTexture(P.land) }, uWDetail: { value: landTexture(P.detail, P.detailN) },
    uWC: { value: new THREE.Vector2(rec.w.x, rec.w.z) }, uWHalf: { value: P.half },
    uPave1: { value: new THREE.Color(...g.pave) }, uPave2: { value: new THREE.Color(...g.pave2) }, uPaveStyle: { value: g.style },
    uZoneCol: { value: new THREE.Color(...g.zone) }, uLampCol: { value: new THREE.Color(...g.lamp) },
    uInlayCol: { value: new THREE.Color(...g.inlay) }, uInlayGlow: { value: new THREE.Color(...g.inlayGlow) },
  };
  const m = patchedMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 }, {
    key: 'wardGround2',
    uniforms,
    fragment: {
      pars: GROUND_PARS + 'float wRough = 0.9; float wMetal = 0.0; float wLamp = 0.0; float wInlay = 0.0; float wGlowLine = 0.0; float wPool = 0.0;',
      color: GROUND_COLOR,
      surface: 'roughnessFactor = wRough; metalnessFactor = wMetal;',
      emissive: `if (uCityLights > 0.0) {
        totalEmissiveRadiance += diffuseColor.rgb * uLampCol * wLamp * uCityLights * 0.9;
        totalEmissiveRadiance += uLampCol * wInlay * uCityLights * 0.06;
        totalEmissiveRadiance += uInlayGlow * wGlowLine * uCityLights * 0.25;
        totalEmissiveRadiance += vec3(0.08, 0.3, 0.34) * wPool * uCityLights * 0.12;
      }`,
    },
  });
  m.userData.wardUniforms = uniforms;
  return m;
}

let _sandMat = null, _seabedMat = null;
function sandMaterial() {
  if (_sandMat) return _sandMat;
  _sandMat = patchedMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }, {
    key: 'wardSand',
    fragment: {
      color: /* glsl */ `
{
  vec2 p = vWPos.xz;
  float fw = max(fwidth(p.x), fwidth(p.y));
  float det = 1.0 - smoothstep(0.2, 1.2, fw);
  vec3 sand = vec3(0.80, 0.72, 0.56) * (0.92 + 0.1 * vnoise(p * 0.2) + 0.06 * vnoise(p * 3.0) * det);
  // wind ripples on the dry sand, wet and darker toward the water, shells along the tide line
  float rip = sin(p.x * 3.1 + p.y * 1.3 + vnoise(p * 0.5) * 3.0) * 0.5 + 0.5;
  sand *= 1.0 - 0.06 * rip * det * smoothstep(0.8, 2.0, vWPos.y);
  float wet = 1.0 - smoothstep(0.2, 1.1, vWPos.y);
  sand = mix(sand, sand * vec3(0.62, 0.58, 0.5), wet);
  float line = (1.0 - smoothstep(0.0, 0.25, abs(vWPos.y - 1.25))) * smoothstep(0.6, 0.8, vnoise(p * 2.0));
  sand = mix(sand, vec3(0.9, 0.88, 0.82), line * 0.5 * det);
  diffuseColor.rgb = sand;
}`,
      surface: 'roughnessFactor = mix(0.95, 0.45, 1.0 - smoothstep(0.2, 1.1, vWPos.y));',
    },
  });
  return _sandMat;
}
function seabedMaterial() {
  if (_seabedMat) return _seabedMat;
  _seabedMat = patchedMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 }, {
    key: 'wardSeabed',
    fragment: {
      color: /* glsl */ `
{
  vec2 p = vWPos.xz;
  float depth = max(-vWPos.y, 0.0);
  float fw = max(fwidth(p.x), fwidth(p.y));
  float det = 1.0 - smoothstep(0.5, 3.0, fw);
  // pale sand with patches of living reef, absorbed by the water above it
  vec3 sand = vec3(0.76, 0.70, 0.56) * (0.9 + 0.12 * vnoise(p * 0.05));
  float reef = smoothstep(0.55, 0.75, vnoise(p * 0.03 + 3.0)) * (0.6 + 0.4 * vnoise(p * 0.4) * det);
  vec3 coral = mix(vec3(0.42, 0.3, 0.26), vec3(0.3, 0.36, 0.24), vnoise(p * 0.2));
  vec3 c = mix(sand, coral, reef * 0.8);
  c *= exp(-vec3(0.30, 0.055, 0.030) * depth * 2.0);
  diffuseColor.rgb = c;
}`,
    },
  });
  return _seabedMat;
}

// ------------------------------------------------------------------- build --
/**
 * Build the Outer Wards. towers = the built ward arcologies (with a measured .footprint).
 * Returns the platforms, towns, landmarks and bridges, an updater for their LOD, and a
 * plan in world coordinates for the streetscape, trees and people.
 */
export function buildMetro(scene, towers, bridgePaths, ground, world = null) {
  const recs = ensureWards();
  const out = { meshes: [], wards: [], lod: [], towns: [], streetscapes: [] };
  const plan = { streets: [], squares: [], lots: [], lamps: [], districts: [], quayWalks: [], parks: [], trees: [], pools: [], bridges: [], stairs: [] };
  const sandMat = sandMaterial(), bedMat = seabedMaterial();
  const add = (m, name) => { m.name = name; m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m); out.meshes.push(m); return m; };
  const prof = {};
  let _t = performance.now();
  const lap = (k) => { const t = performance.now(); prof[k] = (prof[k] || 0) + (t - _t); _t = t; };
  out.profile = prof;
  for (const rec of recs) {
    _t = performance.now();
    const { w, design } = rec;
    const wt = towers.filter((t) => t.def.ward === w.id);
    const ctx = rec.ctx;
    ctx.prof = prof;
    ctx.half = rec.half;
    ctx.R = rec.R;
    ctx.levelAt = (x, z, m) => levelAtRec(rec, x, z, m);
    ctx.towersBuilt = wt.map((t) => ({ x: t.def.x - w.x, z: t.def.z - w.z, r: t.footprint, def: t.def, level: t.def.level }));
    ctx.blocked = (x, z, hw) => ctx.towersBuilt.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + hw + 5) || rec.landings.some((L) => { const s = L.station; if (!s) return false; const dx = x - s.x, dz = z - s.z; const c = Math.cos(s.rot), sn = Math.sin(s.rot); return Math.abs(dx * c + dz * sn) < 41 + hw && Math.abs(-dx * sn + dz * c) < 18 + hw * 0.4; });
    const planDesign = {
      plan: (c, Tk) => {
        const raw = design.plan(c, Tk);
        raw.squares = raw.squares || []; raw.plazas = raw.plazas || []; raw.sites = raw.sites || []; raw.exclusions = raw.exclusions || [];
        for (const t of ctx.towersBuilt) {
          raw.squares.push({ x: t.x, z: t.z, r: t.r + 16, kind: 'tower', noLamps: true });
          raw.exclusions.push({ x: t.x, z: t.z, r: t.r + 10 });
        }
        for (const L of rec.landings) {
          const s = L.station;
          if (s) raw.sites.push({ box: { x: s.x, z: s.z, hw: 41, hd: 18, rot: s.rot }, margin: 3 });
          if (!L.own) raw.plazas.push({ x: L.x + L.t[0] * (L.kind === 'ring' ? 26 : 40), z: L.z + L.t[1] * (L.kind === 'ring' ? 26 : 40), hw: L.kind === 'ring' ? 30 : 50, hd: L.kind === 'ring' ? 34 : 44, rot: L.b, kind: 'landing' });
        }
        return raw;
      },
    };
    const P = buildWardPlan(ctx, planDesign);
    rec.plan = P;
    lap('plan');
    // ---- the platform
    const G = buildPlatform(rec, P);
    lap('platform');
    const platMat = createFacadeMaterial(design.palette === 'marble' ? 'marble' : design.palette, 770 + w.seed, { litFrac: 0.62, band: 1e5, uplight: 1, warmth: design.lowrise.warmth });
    const plat = add(new THREE.Mesh(mergeClean([...G.walls, ...G.quay]), platMat), `${w.name} platform`);
    plat.castShadow = true; plat.receiveShadow = true;
    const gmat = groundMaterial(P, rec);
    const gnd = add(new THREE.Mesh(mergeGround(G.grounds), gmat), `${w.name} ground`);
    gnd.receiveShadow = true;
    if (G.sand.length) { const s = add(new THREE.Mesh(mergeClean(G.sand), sandMat), `${w.name} beaches`); s.receiveShadow = true; }
    const bed = add(new THREE.Mesh(mergeGround(G.seabed), bedMat), `${w.name} reef apron`);
    bed.receiveShadow = true;
    if (world && world.reflectionHide) world.reflectionHide.push(bed);
    if (G.near.length) {
      const nearM = add(new THREE.Mesh(mergeClean(G.near), platMat), `${w.name} stairs`);
      const farM = G.far.length ? add(new THREE.Mesh(mergeClean(G.far), platMat), `${w.name} stairs far`) : null;
      nearM.castShadow = true; nearM.receiveShadow = true;
      out.lod.push({ near: nearM, far: farM, center: new THREE.Vector3(w.x, 10, w.z), radius: rec.R(0) * 1.1 });
    }
    lap('platform meshes');
    // ---- signature buildings, canal bridges, harbour furniture
    const LM = buildWardLandmarks(scene, rec, P, G, { palette: design.palette, world });
    lap('landmarks');
    out.meshes.push(...LM.meshes);
    out.lod.push(...LM.lod);
    // ---- into world coordinates for the shared builders
    const wp = { streets: [], squares: [], lots: [], lamps: [], districts: [{ id: w.id, x: w.x, z: w.z, R: w.r, kind: 'ward' }] };
    for (const st of P.streets) wp.streets.push({ pts: st.pts.map(([x, z]) => [w.x + x, w.z + z]), cls: st.cls, hw: st.hw, district: w.id, y: st.y, name: st.name });
    for (const q of P.squares) wp.squares.push({ ...q, x: w.x + q.x, z: w.z + q.z, district: w.id });
    for (const l of [...P.lamps, ...G.quayLamps, ...(LM.lamps || [])]) wp.lamps.push({ x: w.x + l.lx, z: w.z + l.lz, yaw: l.yaw, cls: l.cls, y: l.y, tint: design.ground.lamp });
    for (const L of P.lots) {
      wp.lots.push({ x: w.x + L.lx, z: w.z + L.lz, w: L.w, d: L.d, rot: L.rot, cls: L.cls, district: w.id, dk: 'ward', ward: w.id, seed: L.seed, centre: L.centre ?? 0.3, lo: L.y, hi: L.y, type: L.type, floors: L.floors });
    }
    const town = buildBuildings(scene, wp, ground, world ? world.settings : { lowrise: 1 }, { palette: design.lowrise.palette, warmth: design.lowrise.warmth, litFrac: design.lowrise.litFrac, lampTint: design.lowrise.lampTint });
    out.towns.push(town);
    lap('towns');
    // lamps (in the ward's own light), benches and centrepieces, drawn only near the ward
    const fv = { edge: (x, z) => P.field.edge(x - w.x, z - w.z), centre: (x, z) => P.field.centre(x - w.x, z - w.z), squareAt: (x, z) => P.field.squareAt(x - w.x, z - w.z) };
    const SS = buildStreetscape(scene, { streets: wp.streets, squares: wp.squares, lamps: wp.lamps, field: fv }, ground);
    for (const m of SS.meshes) out.lod.push({ near: m, far: null, center: new THREE.Vector3(w.x, 10, w.z), radius: rec.R(0) * 1.15, nearDist: 1500 });
    out.streetscapes.push(SS);
    lap('streetscape');
    plan.districts.push(...wp.districts);
    plan.streets.push(...wp.streets);
    plan.squares.push(...wp.squares);
    plan.lamps.push(...wp.lamps);
    plan.lots.push(...wp.lots);
    for (const loop of G.quayWalks) plan.quayWalks.push({ pts: loop.map(([x, z]) => [w.x + x, w.z + z]), y: QUAY_Y, ward: w.id });
    for (const pk of P.parks) plan.parks.push({ ward: w.id, ox: w.x, oz: w.z, prim: pk.prim, trees: pk.trees ?? 1, reef: !!pk.reef, x: pk.x, z: pk.z, r: pk.r, box: pk.box, poly: pk.poly });
    for (const t of (P.raw.trees || [])) plan.trees.push({ ...t, x: w.x + t.x, z: w.z + t.z, y: levelAtRec(rec, t.x, t.z, 0) ?? WARD_TOP });
    for (const p of P.pools) plan.pools.push({ ...p, ward: w.id });
    for (const b of P.bridges) plan.bridges.push({ ...b, ward: w.id, a: [w.x + b.a[0], w.z + b.a[1]], b: [w.x + b.b[0], w.z + b.b[1]] });
    out.wards.push({ def: w, rec, field: P.field, half: P.half, ground: gnd, platform: plat, plan: P, geo: G, landmarks: LM });
  }
  // one field view in world coordinates over every ward (for the streetscape and trees)
  const fieldRec = (x, z) => out.wards.find((q) => Math.abs(x - q.def.x) < q.half && Math.abs(z - q.def.z) < q.half);
  plan.field = {
    edge: (x, z) => { const w = fieldRec(x, z); return w ? w.field.edge(x - w.def.x, z - w.def.z) : 16; },
    centre: (x, z) => { const w = fieldRec(x, z); return w ? w.field.centre(x - w.def.x, z - w.def.z) : 16; },
    squareAt: (x, z) => { const w = fieldRec(x, z); return w ? w.field.squareAt(x - w.def.x, z - w.def.z) : 0; },
  };
  /** 'lawn' | 'bed' | 'paved' | 'road' | 'water' | 'zone' | 'path' | null (off the street level). */
  plan.surfaceAt = (x, z) => {
    const w = fieldRec(x, z);
    if (!w) return null;
    const lx = x - w.def.x, lz = z - w.def.z;
    if (levelAtRec(w.rec, lx, lz, 0) === null) return null;
    const P = w.plan, N = P.field.N;
    const i = Math.floor((lx + P.half) / P.field.cell), j = Math.floor((lz + P.half) / P.field.cell);
    if (i < 0 || j < 0 || i >= N || j >= N) return null;
    const e = P.field.edge(lx, lz);
    if (e < 0) return 'road';
    if (e < 4.6 || P.field.squareAt(lx, lz) > 0.5) return 'paved';
    const k = (j * N + i) * 4;
    if (P.land[k] < 128) return 'path';
    if (P.land[k + 1] > 128) return 'zone';
    if (P.land[k + 2] > 128) return 'bed';
    return 'lawn';
  };
  /** 0 free, 1 park, 2 landmark site or station, 3 plaza. */
  plan.reservedAt = (x, z) => {
    const w = fieldRec(x, z);
    if (!w) return 0;
    const P = w.plan, N = P.field.N;
    const i = Math.floor((x - w.def.x + P.half) / P.field.cell), j = Math.floor((z - w.def.z + P.half) / P.field.cell);
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    return P.reserve[j * N + i];
  };
  out.plan = plan;
  // a spatial index of every ward building, for anything that must keep clear of them
  const GI = 60, gidx = new Map();
  for (const t of out.towns) for (const p of t.placements) {
    const k = `${Math.floor(p.x / GI)},${Math.floor(p.z / GI)}`;
    if (!gidx.has(k)) gidx.set(k, []);
    gidx.get(k).push(p);
  }
  out.isFree = (x, z, r) => {
    const gx = Math.floor(x / GI), gz = Math.floor(z / GI);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = gidx.get(`${gx + dx},${gz + dz}`);
      if (l) for (const p of l) if (Math.hypot(p.x - x, p.z - z) < r + Math.max(p.sx, p.sz) * 0.6) return false;
    }
    return true;
  };
  // bridges and their maglevs, stations at both ends
  const B = buildWardBridges(scene, bridgePaths, recs, ground, world);
  out.meshes.push(...B.meshes);
  out.lod.push(...(B.lod || []));
  out.bridges = B;
  out.stations = B.stations;
  // deck lamps, one group per bridge
  for (const bp of bridgePaths) {
    const list = B.lamps.filter((l) => l.bridge === bp.ward);
    if (!list.length) continue;
    const SS = buildStreetscape(scene, { streets: [], squares: [], lamps: [], field: { edge: () => 16, centre: () => 16, squareAt: () => 0 } }, ground, list);
    const mid = bp.path[Math.floor(bp.path.length / 2)];
    const half = bp.path[0].distanceTo(bp.path[bp.path.length - 1]) / 2;
    for (const m of SS.meshes) out.lod.push({ near: m, far: null, center: mid.clone(), radius: half, nearDist: 1500 });
  }
  // LOD: detail near the camera, massing beyond
  out.nearDist = 900;
  out.applyQuality = (s) => {
    out.nearDist = s.lowriseNear ?? (s.lowrise >= 1 ? 900 : s.lowrise >= 0.75 ? 650 : 420);
    for (const t of out.towns) t.applyQuality(s);
  };
  out.update = (dt, t, camera) => {
    for (const tw of out.towns) tw.update(dt, t, camera);
    if (!camera) return;
    const cp = camera.position;
    for (const c of out.lod) {
      const d = cp.distanceTo(c.center) - c.radius;
      const near = d < (c.nearDist ?? out.nearDist);
      if (c.near) { c.near.visible = near; c.near.layers.set(near ? 1 : 0); }
      if (c.far) c.far.layers.set(near ? 2 : 0);
    }
  };
  out.tris = () => out.meshes.reduce((a, m) => a + (m.geometry && m.geometry.index ? m.geometry.index.count / 3 : 0), 0);
  return out;
}

function mergeGround(list) {
  const clean = list.filter((g) => g.attributes.position.count > 0).map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); if (!g.attributes.normal) g.computeVertexNormals(); return g; });
  if (!clean.length) return new THREE.BufferGeometry();
  return clean.length === 1 ? clean[0] : mergeGeometriesSafe(clean);
}
function mergeGeometriesSafe(list) { return mergeGeometries(list, false); }

export { levelAtRec, QUAY_Y as WARD_QUAY };
