import * as THREE from 'three';
import { createFacadeMaterial } from './facade.js';
import { patchedMaterial } from './materials.js';
import { latheFacade, mergeClean } from './geom.js';
import { mulberry32 } from './noise.js';
import { outerCities, renderedHeight } from './outerCities.js';
import { FAR_ISLANDS, INNER } from './terrain.js';
import { U } from '../core/uniforms.js';

// Civilisation across the outer hills north of the atoll: villages and hamlets on the gentle
// spurs and saddles, farmsteads along the lanes, terraced fields, vineyards and orchards on
// the contours, stone walls and hedgerows, roads that wind along the contours on embankments
// and cuttings with retaining walls, and monasteries / observatories on the summits.
// Everything is seated with renderedHeight() (the mesh actually drawn): buildings stand on
// stone plinths down to their lowest ground, roads and fields are draped a hand's breadth
// above it with a polygon offset (depth-space, so it holds at any range), and all solids are
// closed convex pieces with outward winding. Chunked (4 km) for culling; the fine detail
// (walls, vines, orchard trees) drops out beyond a few kilometres, the fields keep the read.

const BX0 = -24000, BX1 = 16000, BZ0 = -26000, BZ1 = -7700, GS = 80, CH = 4000;
const NX = Math.round((BX1 - BX0) / GS) + 1, NZ = Math.round((BZ1 - BZ0) / GS) + 1;
const srgb = (r, g, b) => [r ** 2.2, g ** 2.2, b ** 2.2];
const FIELD_COL = {
  1: srgb(0.64, 0.56, 0.34), // ripe grain
  2: srgb(0.38, 0.48, 0.24), // green crop
  3: srgb(0.48, 0.43, 0.58), // lavender
  4: srgb(0.41, 0.33, 0.25), // ploughed
  5: srgb(0.45, 0.41, 0.29), // vineyard ground
  6: srgb(0.35, 0.46, 0.24), // orchard grass
  7: srgb(0.45, 0.53, 0.29), // hay meadow
};
const ROAD_COL = srgb(0.56, 0.53, 0.48);

// -------------------------------------------------------------- builders --
class Solids {
  constructor() { this.pos = []; this.nrm = []; this.fac = []; this.lathes = []; }
  /** A convex solid: points [[x,y,z]], faces (index polygons); winding fixed outward. */
  solid(P, faces, kind, vBase = 0) {
    let cx = 0, cy = 0, cz = 0;
    for (const p of P) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= P.length; cy /= P.length; cz /= P.length;
    faces.forEach((f, fi) => {
      let nx = 0, ny = 0, nz = 0, fx = 0, fy = 0, fz = 0;
      for (let k = 0; k < f.length; k++) {
        const a = P[f[k]], b = P[f[(k + 1) % f.length]];
        nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
        fx += a[0]; fy += a[1]; fz += a[2];
      }
      const l = Math.hypot(nx, ny, nz);
      if (!(l > 1e-6)) return;                     // degenerate face: nothing to draw
      nx /= l; ny /= l; nz /= l;
      fx /= f.length; fy /= f.length; fz /= f.length;
      let order = f;
      if (nx * (fx - cx) + ny * (fy - cy) + nz * (fz - cz) < 0) { order = f.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
      const h = Math.hypot(nx, nz), kd = Array.isArray(kind) ? kind[fi] : kind;
      const tx = h > 0.3 ? -nz / h : 1, tz = h > 0.3 ? nx / h : 0;
      for (let k = 1; k < order.length - 1; k++) {
        for (const vi of [order[0], order[k], order[k + 1]]) {
          const p = P[vi];
          this.pos.push(p[0], p[1], p[2]); this.nrm.push(nx, ny, nz);
          this.fac.push(p[0] * tx + p[2] * tz, p[1] - vBase, kd);
        }
      }
    });
  }
  /** Eight corners (bottom ring then top ring) as a closed hexahedron. */
  // open: a run of abutting segments whose bottoms are buried (top and both sides only)
  hexa(P, kind, vBase, open = false) { this.solid(P, open ? [[4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6]] : [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], kind, vBase); }
  /** Oriented box: centre (x,z), axis angle, half sizes, y0..y1. */
  box(x, z, ax, az, hl, hw, y0, y1, kind, vBase = y0) {
    const sx = -az, sz = ax, P = [];
    for (const y of [y0, y1]) for (const [a, s] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.push([x + ax * a * hl + sx * s * hw, y, z + az * a * hl + sz * s * hw]);
    this.hexa(P, kind, vBase);
  }
  /** A wall segment between two ground points, following the ground: closed, thick t. */
  wall(x0, z0, b0, t0, x1, z1, b1, t1, t, kind, open = false) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, sx = (-dz / l) * t * 0.5, sz = (dx / l) * t * 0.5;
    this.hexa([[x0 - sx, b0, z0 - sz], [x1 - sx, b1, z1 - sz], [x1 + sx, b1, z1 + sz], [x0 + sx, b0, z0 + sz],
      [x0 - sx, t0, z0 - sz], [x1 - sx, t1, z1 - sz], [x1 + sx, t1, z1 + sz], [x0 + sx, t0, z0 + sz]], kind, Math.min(b0, b1), open);
  }
  geometry() {
    const parts = this.lathes.slice();
    if (this.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
      g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fac, 3));
      parts.push(g);
    }
    return parts.length ? mergeClean(parts) : null;
  }
}

class Drape {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.hc = []; }
  vert(x, y, z, n, c, u, v, k) { this.pos.push(x, y, z); this.nrm.push(n[0], n[1], n[2]); this.col.push(c[0], c[1], c[2]); this.hc.push(u, v, k); }
  geometry() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aHC', new THREE.Float32BufferAttribute(this.hc, 3));
    return g;
  }
}

const groundNormal = (x, z) => {
  const dx = renderedHeight(x + 4, z) - renderedHeight(x - 4, z), dz = renderedHeight(x, z + 4) - renderedHeight(x, z - 4);
  const l = Math.hypot(dx, 8, dz);
  return [-dx / l, 8 / l, -dz / l];
};

// --------------------------------------------------------------- the build --
export function buildHillCountry(scene) {
  const rnd = mulberry32(51017);
  const oc = outerCities();
  // coarse height grid for siting and routing (exact heights for everything built)
  const H = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) H[j * NX + i] = renderedHeight(BX0 + i * GS, BZ0 + j * GS);
  const hAt = (i, j) => H[Math.min(NZ - 1, Math.max(0, j)) * NX + Math.min(NX - 1, Math.max(0, i))];
  const slopeAt = (x, z) => {
    const i = Math.round((x - BX0) / GS), j = Math.round((z - BZ0) / GS);
    return [(hAt(i + 1, j) - hAt(i - 1, j)) / (2 * GS), (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * GS)];
  };

  // keep clear of the massif towns and their gondolas, the far islands and the inner atoll
  const segDist = (x, z, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - ax - dx * t, z - az - dz * t);
  };
  const blocked = (x, z, townR = 2200) => {
    if (Math.max(Math.abs(x), Math.abs(z)) < INNER.half + 300) return true;
    for (const f of FAR_ISLANDS) if (Math.hypot(x - f[0], z - f[1]) < f[2] * 1.8) return true;
    for (const m of oc.massif) {
      if (Math.hypot(x - m.town.x, z - m.town.z) < townR) return true;
      if (segDist(x, z, m.coast.x, m.coast.z - 400, m.town.x, m.town.z) < 260) return true;
    }
    return false;
  };

  // occupancy (circles in a hash) so nothing overlaps anything else
  const occ = new Map();
  const OC = 60;
  const key = (i, j) => i * 100003 + j;
  const free = (x, z, r) => {
    const i0 = Math.floor((x - r - 30) / OC), i1 = Math.floor((x + r + 30) / OC), j0 = Math.floor((z - r - 30) / OC), j1 = Math.floor((z + r + 30) / OC);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const L = occ.get(key(i, j));
      if (L) for (const c of L) if (Math.hypot(c[0] - x, c[1] - z) < c[2] + r) return false;
    }
    return true;
  };
  const occupy = (x, z, r) => {
    const k = key(Math.floor(x / OC), Math.floor(z / OC));
    if (!occ.has(k)) occ.set(k, []);
    occ.get(k).push([x, z, Math.min(r, 30)]);
    if (r > 30) for (let a = 0; a < 6; a++) occupy(x + Math.cos(a) * (r - 30), z + Math.sin(a) * (r - 30), 30);
  };

  // chunks
  const chunks = new Map();
  const chunk = (x, z) => {
    const ci = Math.floor((x - BX0) / CH), cj = Math.floor((z - BZ0) / CH), k = ci * 64 + cj;
    if (!chunks.has(k)) chunks.set(k, { cx: BX0 + (ci + 0.5) * CH, cz: BZ0 + (cj + 0.5) * CH, arch: new Solids(), stone: new Solids(), detail: new Solids(), drape: new Drape() });
    return chunks.get(k);
  };

  // ------------------------------------------------------------ villages --
  const villages = [];
  const cands = [];
  for (let z = BZ0 + 300; z < BZ1 - 300; z += 360) for (let x = BX0 + 300; x < BX1 - 300; x += 360) {
    const px = x + (rnd() - 0.5) * 240, pz = z + (rnd() - 0.5) * 240;
    const h = renderedHeight(px, pz);
    if (h < 25 || h > 950 || blocked(px, pz, 2500)) continue;
    const [gx, gz] = slopeAt(px, pz), s = Math.hypot(gx, gz);
    if (s > 0.16) continue;
    // spurs and saddles: flat ground with a view; favour the kinder altitudes
    cands.push({ x: px, z: pz, h, score: (0.16 - s) * 6 + rnd() * 0.6 - Math.abs(h - 260) / 900 });
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands) {
    if (villages.length >= 34) break;
    if (villages.some((v) => Math.hypot(v.x - c.x, v.z - c.z) < 1500)) continue;
    villages.push({ ...c, r: 80 + rnd() * 110 });
  }

  // --------------------------------------------------------------- roads --
  // least-cost routes on the 80 m grid: steep grades are expensive, so the roads wind along
  // the contours and switch back up the slopes; shared cells become trunks (no doubled roads)
  const passable = new Uint8Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) passable[j * NX + i] = H[j * NX + i] > 12 && !blocked(BX0 + i * GS, BZ0 + j * GS, 1900) ? 1 : 0;
  const onRoad = new Uint8Array(NX * NZ);
  const cellOf = (x, z) => Math.round((z - BZ0) / GS) * NX + Math.round((x - BX0) / GS);
  const gCost = new Float32Array(NX * NZ), from = new Int32Array(NX * NZ), stamp = new Int32Array(NX * NZ);
  let run = 0;
  const route = (s, t) => {
    run++;
    const heap = [], hk = [];
    const push = (n, k) => { heap.push(n); hk.push(k); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (hk[p] <= hk[c]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; [hk[p], hk[c]] = [hk[c], hk[p]]; c = p; } };
    const pop = () => {
      const top = heap[0], ln = heap.length - 1;
      heap[0] = heap[ln]; hk[0] = hk[ln]; heap.pop(); hk.pop();
      let c = 0;
      for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && hk[l] < hk[m]) m = l; if (r < heap.length && hk[r] < hk[m]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; [hk[m], hk[c]] = [hk[c], hk[m]]; c = m; }
      return top;
    };
    const ti = t % NX, tj = (t / NX) | 0;
    stamp[s] = run; gCost[s] = 0; from[s] = -1; push(s, 0);
    let steps = 0;
    while (heap.length && steps++ < 120000) {
      const n = pop();
      if (n === t) break;
      const i = n % NX, j = (n / NX) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
        const m = jj * NX + ii;
        if (!passable[m] && m !== t) continue;
        const d = GS * (di && dj ? 1.4142 : 1), g = Math.abs(H[m] - H[n]) / d;
        let c = d * (1 + 40 * g * g) + (g > 0.11 ? d * (g - 0.11) * 600 : 0);
        if (onRoad[m]) c *= 0.55;
        const nc = gCost[n] + c;
        if (stamp[m] !== run || nc < gCost[m]) {
          stamp[m] = run; gCost[m] = nc; from[m] = n;
          push(m, nc + Math.hypot(ii - ti, jj - tj) * GS * 0.9);
        }
      }
    }
    if (stamp[t] !== run) return null;
    const path = [];
    for (let n = t; n >= 0; n = from[n]) path.push(n);
    return path;
  };
  // links: a spanning tree of the villages plus a few loops
  const links = [];
  const inTree = [0];
  while (inTree.length < villages.length) {
    let best = null;
    for (const a of inTree) villages.forEach((v, b) => {
      if (inTree.includes(b)) return;
      const d = Math.hypot(v.x - villages[a].x, v.z - villages[a].z);
      if (!best || d < best.d) best = { a, b, d };
    });
    if (!best) break;
    inTree.push(best.b);
    if (best.d < 9000) links.push([best.a, best.b]);
  }
  villages.forEach((v, a) => {
    let bd = 1e9, bb = -1;
    villages.forEach((w, b) => { const d = Math.hypot(v.x - w.x, v.z - w.z); if (b !== a && d < bd && !links.some((l) => (l[0] === a && l[1] === b) || (l[0] === b && l[1] === a))) { bd = d; bb = b; } });
    if (bb >= 0 && bd < 3200 && rnd() < 0.45) links.push([a, bb]);
  });
  const adj = new Map();
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set()); adj.get(a).add(b); adj.get(b).add(a); };
  for (const [a, b] of links) {
    const p = route(cellOf(villages[a].x, villages[a].z), cellOf(villages[b].x, villages[b].z));
    if (!p) continue;
    for (let k = 0; k < p.length; k++) { onRoad[p[k]] = 1; if (k) link(p[k - 1], p[k]); }
  }
  // chains between junctions / ends
  const chains = [], seen = new Set();
  const ek = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const [n, nb] of adj) {
    if (nb.size === 2) continue;
    for (const m of nb) {
      if (seen.has(ek(n, m))) continue;
      const ch = [n];
      let prev = n, cur = m;
      seen.add(ek(prev, cur));
      for (;;) {
        ch.push(cur);
        const nx = adj.get(cur);
        if (nx.size !== 2) break;
        const nxt = [...nx].find((q) => q !== prev);
        if (seen.has(ek(cur, nxt))) break;
        seen.add(ek(cur, nxt));
        prev = cur; cur = nxt;
      }
      chains.push(ch.map((c) => [BX0 + (c % NX) * GS, BZ0 + ((c / NX) | 0) * GS]));
    }
  }

  // smooth (Chaikin, ends fixed), resample, and drape each chain as a road on an embankment
  const smooth = (pts, it) => {
    for (let r = 0; r < it; r++) {
      const o = [pts[0]];
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      o.push(pts[pts.length - 1]);
      pts = o;
    }
    return pts;
  };
  const resample = (pts, step) => {
    const o = [pts[0]];
    let acc = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let s = step - acc;
      while (s <= L) { o.push([a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L]); s += step; }
      acc = L - (s - step);
    }
    const last = pts[pts.length - 1], pl = o[o.length - 1];
    if (Math.hypot(last[0] - pl[0], last[1] - pl[1]) > step * 0.3) o.push(last); else o[o.length - 1] = last;
    return o;
  };
  let roadLen = 0;
  const lamps = [];
  const road = (pts, hw, lift) => {
    const n = pts.length;
    if (n < 2) return;
    const S = pts.map((p, k) => {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const sx = -dz / l, sz = dx / l;
      const g0 = renderedHeight(p[0], p[1]);
      const gl = renderedHeight(p[0] - sx * (hw + 0.4), p[1] - sz * (hw + 0.4)), gr = renderedHeight(p[0] + sx * (hw + 0.4), p[1] + sz * (hw + 0.4));
      return { x: p[0], z: p[1], sx, sz, g0, gl, gr, y: Math.max(g0, gl, gr) + 0.22 + lift };
    });
    // a gentle vertical profile: fill the dips (the embankment carries the road over gullies)
    const ys = S.map((s, k) => { let a = 0, c = 0; for (let q = Math.max(0, k - 3); q <= Math.min(n - 1, k + 3); q++) { a += S[q].y; c++; } return a / c; });
    S.forEach((s, k) => { s.y = Math.max(s.y, ys[k]); });
    for (let k = 0; k < n; k++) {
      const s = S[k];
      occupy(s.x, s.z, hw + 4);
      if (k === n - 1) break;
      const t = S[k + 1], C = chunk((s.x + t.x) / 2, (s.z + t.z) / 2);
      const segL = Math.hypot(t.x - s.x, t.z - s.z);
      // deck (draped, polygon-offset)
      const L0 = [s.x - s.sx * hw, s.y, s.z - s.sz * hw], R0 = [s.x + s.sx * hw, s.y, s.z + s.sz * hw];
      const L1 = [t.x - t.sx * hw, t.y, t.z - t.sz * hw], R1 = [t.x + t.sx * hw, t.y, t.z + t.sz * hw];
      const up = [0, 1, 0];
      for (const [p, v] of [[L0, -1], [R0, 1], [R1, 1], [L0, -1], [R1, 1], [L1, -1]]) C.drape.vert(p[0], p[1], p[2], up, ROAD_COL, roadLen + (p === R1 || p === L1 ? segL : 0), v, 0);
      // kerbs and embankment sides down into the ground: closed from every side
      for (const sgn of [-1, 1]) {
        const e0x = s.x + s.sx * sgn * (hw + 0.2), e0z = s.z + s.sz * sgn * (hw + 0.2), e1x = t.x + t.sx * sgn * (hw + 0.2), e1z = t.z + t.sz * sgn * (hw + 0.2);
        const b0 = Math.min(sgn < 0 ? s.gl : s.gr, renderedHeight(e0x, e0z)) - 0.6, b1 = Math.min(sgn < 0 ? t.gl : t.gr, renderedHeight(e1x, e1z)) - 0.6;
        // (low kerbs are near detail; tall embankments carry to the far view)
        const tall = Math.max(s.y - b0, t.y - b1) > 2.2;
        (tall ? C.stone : C.detail).wall(e0x, e0z, b0, s.y + 0.18, e1x, e1z, b1, t.y + 0.18, 0.4, 1, k > 0 && k < n - 2);
        // a retaining wall where the road is cut into the hillside
        const ux0 = s.x + s.sx * sgn * (hw + 1.6), uz0 = s.z + s.sz * sgn * (hw + 1.6), ux1 = t.x + t.sx * sgn * (hw + 1.6), uz1 = t.z + t.sz * sgn * (hw + 1.6);
        const u0 = renderedHeight(ux0, uz0), u1 = renderedHeight(ux1, uz1);
        if (u0 > s.y + 0.9 && u1 > t.y + 0.9) C.stone.wall(ux0, uz0, s.y - 0.4, u0 + 0.5, ux1, uz1, t.y - 0.4, u1 + 0.5, 0.7, 1);
      }
      roadLen += segL;
    }
    // lamp posts at the ends, just off the kerb
    if (hw > 2) for (const k of [0, n - 1]) {
      const s = S[k], px = s.x + s.sx * (hw + 0.9), pz = s.z + s.sz * (hw + 0.9), g = renderedHeight(px, pz);
      chunk(px, pz).arch.box(px, pz, 1, 0, 0.14, 0.14, g - 0.4, g + 4.2, 10, g);
      chunk(px, pz).arch.box(px, pz, 1, 0, 0.3, 0.3, g + 4.2, g + 4.7, 2, g);
      lamps.push([px, g + 4.45, pz]);
    }
    return S;
  };
  const roadSamples = [];
  chains.forEach((c, ci) => {
    const pts = resample(smooth(c, 3), 15);
    const S = road(pts, 2.6, (ci % 5) * 0.03);
    if (S) roadSamples.push(S);
  });

  // ------------------------------------------------------------ buildings --
  let houses = 0;
  /** A gabled house on a stone plinth; returns false when the site is not free or too steep. */
  const house = (x, z, ang, L, W, wallH, opts = {}) => {
    const r = Math.hypot(L, W) * 0.5 + 1.2;
    if (!free(x, z, r) || blocked(x, z)) return false;
    const ax = Math.cos(ang), az = Math.sin(ang), sx = -az, sz = ax;
    let lo = 1e9, hi = -1e9;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
      const g = renderedHeight(x + ax * a * (L / 2 + 0.6) + sx * b * (W / 2 + 0.6), z + az * a * (L / 2 + 0.6) + sz * b * (W / 2 + 0.6));
      lo = Math.min(lo, g); hi = Math.max(hi, g);
    }
    if (lo < 6 || hi - lo > (opts.maxStep ?? 4.5)) return false;
    occupy(x, z, r);
    const C = chunk(x, z), base = hi + 0.35;
    C.stone.box(x, z, ax, az, L / 2 + 0.5, W / 2 + 0.5, lo - 1.2, base, 1, lo - 1.2);   // plinth to the lowest ground
    const rise = (W / 2) * (opts.pitch ?? 0.7), top = base + wallH;
    const pt = (s, y, t) => [x + sx * s + ax * t, y, z + sz * s + az * t];
    // body: a pentagonal prism (the gables close the ends)
    const prof = [[-W / 2, base], [W / 2, base], [W / 2, top], [0, top + rise - 0.06], [-W / 2, top]];
    const Pb = [...prof.map(([s, y]) => pt(s, y, -L / 2)), ...prof.map(([s, y]) => pt(s, y, L / 2))];
    C.arch.solid(Pb, [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [0, 1, 6, 5], [1, 2, 7, 6], [2, 3, 8, 7], [3, 4, 9, 8], [4, 0, 5, 9]],
      [opts.wall ?? 5, opts.wall ?? 5, opts.wall ?? 5, opts.wall ?? 5, 1, 1, opts.wall ?? 5], base);
    // roof: two closed slabs, eaves and verges overhanging, soffits underneath
    const o = 0.45, th = 0.28, k = rise / (W / 2);
    for (const sg of [-1, 1]) {
      const e = [sg * (W / 2 + o), top - o * k], rg = [0, top + rise];
      const P = [];
      for (const t of [-L / 2 - o, L / 2 + o]) P.push(pt(rg[0], rg[1] - 0.02, t), pt(e[0], e[1], t));
      for (const t of [-L / 2 - o, L / 2 + o]) P.push(pt(rg[0] - sg * 0.02, rg[1] + th, t), pt(e[0], e[1] + th, t));
      C.arch.solid(P, [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [1, 3, 7, 5], [0, 2, 6, 4]], 11, top);
    }
    if (opts.chimney) C.arch.box(x + ax * L * 0.3 + sx * W * 0.2, z + az * L * 0.3 + sz * W * 0.2, ax, az, 0.5, 0.5, top, top + rise + 1.4, 1, top);
    houses++;
    return { base, top, rise };
  };
  const tower = (x, z, ang, w, h) => {
    const r = w * 0.8 + 1;
    if (!free(x, z, r)) return false;
    const ax = Math.cos(ang), az = Math.sin(ang);
    let lo = 1e9, hi = -1e9;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const g = renderedHeight(x + (ax * a - az * b) * w * 0.6, z + (az * a + ax * b) * w * 0.6); lo = Math.min(lo, g); hi = Math.max(hi, g); }
    if (hi - lo > 5) return false;
    occupy(x, z, r);
    const C = chunk(x, z), base = hi + 0.4;
    C.stone.box(x, z, ax, az, w / 2 + 0.6, w / 2 + 0.6, lo - 1.2, base, 1, lo - 1.2);
    C.arch.box(x, z, ax, az, w / 2, w / 2, base, base + h, 5, base);
    C.arch.box(x, z, ax, az, w / 2 - 0.3, w / 2 - 0.3, base + h, base + h + 2.4, 2, base + h);   // the lit belfry / lantern
    C.arch.solid([[x, base + h + 2.4 + w * 0.9, z], ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + (ax * a - az * b) * (w / 2 + 0.3), base + h + 2.4, z + (az * a + ax * b) * (w / 2 + 0.3)])],
      [[1, 2, 3, 4], [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]], 11, base + h);
    return true;
  };
  const contourAngle = (x, z) => { const [gx, gz] = slopeAt(x, z); return Math.hypot(gx, gz) > 0.01 ? Math.atan2(gx, -gz) : rnd() * Math.PI; };

  for (const v of villages) {
    tower(v.x + 14, v.z - 10, contourAngle(v.x, v.z), 5 + rnd() * 1.5, 13 + rnd() * 8);
    const n = Math.round(v.r * 0.45);
    for (let q = 0; q < n * 3 && v.built !== n; q++) {
      const a = rnd() * Math.PI * 2, rr = 20 + Math.sqrt(rnd()) * v.r;
      const x = v.x + Math.cos(a) * rr, z = v.z + Math.sin(a) * rr;
      const big = rnd() < 0.2;
      if (house(x, z, contourAngle(x, z) + (rnd() - 0.5) * 0.25, big ? 16 + rnd() * 6 : 8 + rnd() * 5, big ? 8 + rnd() * 2 : 6 + rnd() * 2, big ? 6.8 : 4.4 + rnd() * 2.6, { chimney: rnd() < 0.6 })) v.built = (v.built || 0) + 1;
    }
  }
  // farmsteads and estates along the lanes
  const farms = [];
  for (const S of roadSamples) for (let k = 20; k < S.length - 20; k += 30 + Math.floor(rnd() * 30)) {
    if (rnd() < 0.35) continue;
    const s = S[k], sg = rnd() < 0.5 ? -1 : 1, off = 50 + rnd() * 40;
    const x = s.x + s.sx * sg * off, z = s.z + s.sz * sg * off;
    if (villages.some((v) => Math.hypot(v.x - x, v.z - z) < v.r + 160) || farms.some((f) => Math.hypot(f.x - x, f.z - z) < 380)) continue;
    const ang = contourAngle(x, z);
    const estate = rnd() < 0.15;
    if (!house(x, z, ang, estate ? 22 : 12 + rnd() * 4, estate ? 11 : 7.5, estate ? 7.6 : 5.2, { chimney: true })) continue;
    const ax = Math.cos(ang), az = Math.sin(ang);
    // the farm lane back to the road (built first, so the barn keeps off it)
    const lane = resample([[s.x + s.sx * sg * 6, s.z + s.sz * sg * 6], [x - s.sx * sg * 15, z - s.sz * sg * 15]], 10);
    let ok = true;
    lane.forEach((p, k) => { if (renderedHeight(p[0], p[1]) < 6 || (k > 0 && k < lane.length - 2 && !free(p[0], p[1], 2))) ok = false; });
    if (ok) road(lane, 1.6, 0.05);
    house(x + ax * 26 - az * 6, z + az * 26 + ax * 6, ang + Math.PI / 2, 18 + rnd() * 6, 9, 5.5, { wall: 8, pitch: 0.55 });   // the barn
    if (estate) tower(x - ax * 20 + az * 14, z - az * 20 - ax * 14, ang, 4.5, 9);
    farms.push({ x, z, r: 40 });
  }

  // ------------------------------------------------ monasteries & observatories on summits --
  const summits = [];
  for (let j = 6; j < NZ - 6; j += 2) for (let i = 6; i < NX - 6; i += 2) {
    const h = hAt(i, j);
    if (h < 220) continue;
    let top = true;
    for (let dj = -6; dj <= 6 && top; dj++) for (let di = -6; di <= 6; di++) if (hAt(i + di, j + dj) > h) { top = false; break; }
    if (top) summits.push({ x: BX0 + i * GS, z: BZ0 + j * GS, h });
  }
  summits.sort((a, b) => b.h - a.h);
  const shrines = [];
  for (const sm of summits) {
    if (shrines.length >= 8) break;
    if (blocked(sm.x, sm.z, 2400) || shrines.some((q) => Math.hypot(q.x - sm.x, q.z - sm.z) < 2500)) continue;
    // the flattest 44 m pad near the summit
    let best = null;
    for (let q = 0; q < 90; q++) {
      const x = sm.x + (rnd() - 0.5) * 320, z = sm.z + (rnd() - 0.5) * 320;
      if (renderedHeight(x, z) < sm.h - 60) continue;
      let lo = 1e9, hi = -1e9;
      for (let a = -1; a <= 1; a += 0.5) for (let b = -1; b <= 1; b += 0.5) { const g = renderedHeight(x + a * 23, z + b * 23); lo = Math.min(lo, g); hi = Math.max(hi, g); }
      if (!best || hi - lo < best.hi - best.lo) best = { x, z, lo, hi };
    }
    if (!best || best.hi - best.lo > 12 || !free(best.x, best.z, 34)) continue;
    const { x, z, lo, hi } = best, C = chunk(x, z), top = hi + 0.5, ang = rnd() * Math.PI;
    const ax = Math.cos(ang), az = Math.sin(ang), sx = -az, sz = ax;
    occupy(x, z, 34);
    C.stone.box(x, z, ax, az, 23, 23, lo - 1.5, top, 1, lo - 1.5);            // the terrace, walled to the rock
    // parapet round the terrace edge
    for (let e = 0; e < 4; e++) {
      const c0 = [[-1, -1], [1, -1], [1, 1], [-1, 1]][e], c1 = [[-1, -1], [1, -1], [1, 1], [-1, 1]][(e + 1) % 4];
      const p0 = [x + (ax * c0[0] + sx * c0[1]) * 22.7, z + (az * c0[0] + sz * c0[1]) * 22.7], p1 = [x + (ax * c1[0] + sx * c1[1]) * 22.7, z + (az * c1[0] + sz * c1[1]) * 22.7];
      C.stone.wall(p0[0], p0[1], top - 0.1, top + 1.1, p1[0], p1[1], top - 0.1, top + 1.1, 0.5, 1);
    }
    const observatory = shrines.length % 2 === 0;
    if (observatory) {
      // an observatory: drum, white dome with a dark slit band, and a low service wing
      // (open at the foot: it stands on the terrace, so no cap coplanar with the paving)
      const dome = [{ r: 9, y: top, kind: 5 }, { r: 9, y: top + 7, kind: 5 }, { r: 9.6, y: top + 7, kind: 1 }, { r: 9.6, y: top + 7.6, kind: 1 }, { r: 9, y: top + 7.6, kind: 1 },
        { r: 8.3, y: top + 11, kind: 1 }, { r: 6.4, y: top + 14.2, kind: 1 }, { r: 3.6, y: top + 16.3, kind: 1 }, { r: 0, y: top + 17, kind: 1 }];
      C.arch.lathes.push(latheFacade(dome, 28).translate(x - ax * 6, 0, z - az * 6));
      const wing = { x: x + ax * 11 + sx * 6, z: z + az * 11 + sz * 6 };
      C.arch.box(wing.x, wing.z, sx, sz, 9, 3.5, top, top + 4.2, 5, top);
      C.arch.box(wing.x, wing.z, sx, sz, 9.3, 3.8, top + 4.2, top + 4.6, 1, top);
    } else {
      // a monastery: four wings round a cloister garth, a church and a bell tower
      for (let e = 0; e < 4; e++) {
        const a2 = ang + (e * Math.PI) / 2, cx = x + Math.cos(a2 + Math.PI / 2) * 13, cz = z + Math.sin(a2 + Math.PI / 2) * 13;
        const wx = Math.cos(a2), wz = Math.sin(a2), wsx = -wz, wsz = wx;
        const W = 6.4, L = e % 2 ? 19.6 : 32.4, base = top, h = 6.5, rise = 2.4;
        const pt = (s, y, t) => [cx + wsx * s + wx * t, y, cz + wsz * s + wz * t];
        const prof = [[-W / 2, base], [W / 2, base], [W / 2, base + h], [0, base + h + rise], [-W / 2, base + h]];
        C.arch.solid([...prof.map(([s, y]) => pt(s, y, -L / 2)), ...prof.map(([s, y]) => pt(s, y, L / 2))],
          [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [0, 1, 6, 5], [1, 2, 7, 6], [2, 3, 8, 7], [3, 4, 9, 8], [4, 0, 5, 9]], [5, 5, 1, 5, 11, 11, 5], base);
      }
      C.arch.box(x, z, ax, az, 6.5, 6.5, top, top + 0.25, 3, top);                    // the garth
      const tx = x + ax * 19 - sx * 19, tz = z + az * 19 - sz * 19;
      C.arch.box(tx, tz, ax, az, 2.6, 2.6, top, top + 20, 5, top);
      C.arch.box(tx, tz, ax, az, 2.3, 2.3, top + 20, top + 23, 2, top + 20);
      C.arch.solid([[tx, top + 29, tz], ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [tx + (ax * a + sx * b) * 2.9, top + 23, tz + (az * a + sz * b) * 2.9])],
        [[1, 2, 3, 4], [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]], 11, top + 20);
    }
    shrines.push({ x, z, y: top, observatory });
  }

  // ----------------------------------------------- fields, terraces, vineyards, orchards --
  const fieldAround = (cx, cz, r0, r1, tries) => {
    for (let q = 0; q < tries; q++) {
      const a = rnd() * Math.PI * 2, rr = r0 + rnd() * (r1 - r0);
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      const h = renderedHeight(x, z);
      if (h < 10 || h > 1100 || blocked(x, z)) continue;
      const [gx, gz] = slopeAt(x, z), sl = Math.hypot(gx, gz);
      if (sl > 0.42) continue;
      const ang = sl > 0.01 ? Math.atan2(gx, -gz) : rnd() * Math.PI;
      const ax = Math.cos(ang), az = Math.sin(ang), sx = -az, sz = ax;
      const hl = 30 + rnd() * 45, hw = 16 + rnd() * 16;
      // footprint must be free and dry
      let ok = true;
      for (let a2 = -1; a2 <= 1 && ok; a2 += 0.25) for (let b2 = -1; b2 <= 1; b2 += 1) {
        const px = x + ax * a2 * hl + sx * b2 * hw, pz = z + az * a2 * hl + sz * b2 * hw;
        if (!free(px, pz, Math.max(hw * 0.5, 12)) || renderedHeight(px, pz) < 8) { ok = false; break; }
      }
      if (!ok) continue;
      for (let a2 = -1; a2 <= 1; a2 += 0.25) for (let b2 = -1; b2 <= 1; b2 += 1) occupy(x + ax * a2 * hl + sx * b2 * hw, z + az * a2 * hl + sz * b2 * hw, Math.max(hw * 0.5, 12));
      const southFacing = gz < -0.04;
      let kind;
      if (sl > 0.1 && southFacing && rnd() < 0.45) kind = 5;
      else if (rnd() < 0.12) kind = 6;
      else kind = [1, 1, 2, 2, 3, 4, 7][Math.floor(rnd() * 7)];
      field(x, z, ax, az, hl, hw, kind, sl);
    }
  };
  let fields = 0;
  const field = (x, z, ax, az, hl, hw, kind, sl) => {
    fields++;
    const C = chunk(x, z), sx = -az, sz = ax;
    const tint = 0.9 + rnd() * 0.2, col = FIELD_COL[kind].map((c) => c * tint);
    const nu = Math.ceil((2 * hl) / 12), nv = Math.ceil((2 * hw) / 12);
    const V = [];
    for (let b = 0; b <= nv; b++) for (let a = 0; a <= nu; a++) {
      const u = -hl + (2 * hl * a) / nu, v = -hw + (2 * hw * b) / nv, px = x + ax * u + sx * v, pz = z + az * u + sz * v;
      V.push([px, renderedHeight(px, pz) + 0.14, pz, groundNormal(px, pz), u, v]);
    }
    for (let b = 0; b < nv; b++) for (let a = 0; a < nu; a++) {
      const i0 = b * (nu + 1) + a, q = [V[i0], V[i0 + 1], V[i0 + nu + 1], V[i0 + nu + 2]];
      // wind up (the grid runs u along the contour, v across; sx,sz = rotate(ax,az) by +90 deg)
      for (const p of [q[0], q[2], q[1], q[1], q[2], q[3]]) C.drape.vert(p[0], p[1], p[2], p[3], col, p[4], p[5], kind);
    }
    const P = (u, v) => [x + ax * u + sx * v, z + az * u + sz * v];
    const along = (v, fn) => { for (let a = 0; a < nu; a++) { const p0 = P(-hl + (2 * hl * a) / nu, v), p1 = P(-hl + (2 * hl * (a + 1)) / nu, v); fn(p0, p1, a); } };
    const acrs = (u, fn) => { for (let b = 0; b < nv; b++) { const p0 = P(u, -hw + (2 * hw * b) / nv), p1 = P(u, -hw + (2 * hw * (b + 1)) / nv); fn(p0, p1); } };
    const D = C.detail;
    // boundary: dry-stone walls on the terraced slopes, hedgerows on the gentle ground
    const hedge = sl < 0.12 && rnd() < 0.6;
    const bound = (p0, p1) => {
      const g0 = renderedHeight(p0[0], p0[1]), g1 = renderedHeight(p1[0], p1[1]);
      // corner segments keep their end caps; the runs between abut and bury their feet
      const mid = Math.hypot(p0[0] - x, p0[1] - z) < Math.hypot(hl, hw) - 6 && Math.hypot(p1[0] - x, p1[1] - z) < Math.hypot(hl, hw) - 6;
      if (hedge) D.wall(p0[0], p0[1], g0 - 0.4, g0 + 1.7, p1[0], p1[1], g1 - 0.4, g1 + 1.7, 1.1, 3, mid);
      else D.wall(p0[0], p0[1], g0 - 0.4, g0 + 1.0, p1[0], p1[1], g1 - 0.4, g1 + 1.0, 0.55, 1, mid);
    };
    along(-hw - 0.8, bound); along(hw + 0.8, bound); acrs(-hl - 0.8, bound); acrs(hl + 0.8, bound);
    // terraces: retaining walls along the contour, one per ~1.6 m of fall
    if (sl > 0.1) {
      const step = Math.max(8, Math.min(22, 1.8 / sl));
      for (let v = -hw + step; v < hw - 2; v += step) along(v, (p0, p1) => {
        const g0 = renderedHeight(p0[0], p0[1]), g1 = renderedHeight(p1[0], p1[1]);
        D.wall(p0[0], p0[1], g0 - 0.5, g0 + 0.8, p1[0], p1[1], g1 - 0.5, g1 + 0.8, 0.5, 1);
      });
    }
    if (kind === 5) {
      // vine rows on the contour
      for (let v = -hw + 2; v < hw - 1; v += 3.2) along(v, (p0, p1, a) => {
        const g0 = renderedHeight(p0[0], p0[1]), g1 = renderedHeight(p1[0], p1[1]);
        D.wall(p0[0], p0[1], g0 - 0.2, g0 + 1.4, p1[0], p1[1], g1 - 0.2, g1 + 1.4, 0.6, 3, a > 0 && a < nu - 1);
      });
    } else if (kind === 6) {
      // orchard trees: trunk and clipped crown, in rows
      for (let v = -hw + 4; v < hw - 3; v += 8) for (let u = -hl + 4; u < hl - 3; u += 8) {
        const [px, pz] = P(u + (rnd() - 0.5) * 1.2, v), g = renderedHeight(px, pz);
        D.box(px, pz, ax, az, 0.22, 0.22, g - 0.4, g + 1.5, 8, g);
        D.box(px, pz, ax, az, 1.6, 1.6, g + 1.4, g + 3.8, 3, g);
      }
    }
  };
  for (const v of villages) fieldAround(v.x, v.z, v.r + 40, v.r + 520, 26);
  for (const f of farms) fieldAround(f.x, f.z, 45, 300, 12);

  // ---------------------------------------------------------------- meshes --
  const archMat = createFacadeMaterial('sand', 1307, { litFrac: 0.42, colW: 2.8, floorH: 3.2, band: 1e5, uplight: 0, warmth: 0.8 });
  // dry stone, hedges, vines and bark: coloured by the aFacade kind, coursed stone and broken
  // foliage that fade to their average with the pixel footprint
  const detailMat = patchedMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }, {
    key: 'hillDetail1',
    vertex: { pars: 'attribute vec3 aFacade; varying vec3 vDF;', transform: 'vDF = aFacade;' },
    fragment: {
      pars: 'varying vec3 vDF;',
      color: /* glsl */ `
{
  float dk = floor(vDF.z + 0.5);
  vec3 c;
  if (dk > 2.5 && dk < 3.5) {
    float n = 0.5 + 0.25 * sin(vWPos.x * 1.9 + sin(vWPos.z * 1.3) * 2.0) + 0.25 * sin(vWPos.z * 2.3 + vWPos.y * 3.1);
    n = mix(n, 0.5, clamp(length(fwidth(vWPos)) * 1.5, 0.0, 1.0));
    c = mix(vec3(0.045, 0.10, 0.03), vec3(0.13, 0.22, 0.055), n);
  } else if (dk > 7.5 && dk < 8.5) {
    c = vec3(0.12, 0.08, 0.05);
  } else if (dk > 9.5 && dk < 10.5) {
    c = vec3(0.05, 0.05, 0.055);
  } else {
    vec2 q = vec2(vDF.x / 0.7, vDF.y / 0.32);
    q.x += 0.5 * floor(q.y);
    vec2 cell = floor(q), f = fract(q);
    float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    float joint = min(min(f.x, 1.0 - f.x) * 0.7, min(f.y, 1.0 - f.y) * 0.32);
    float fade = clamp(1.0 - max(fwidth(vDF.y), fwidth(vDF.x) * 0.45) * 4.0, 0.0, 1.0);
    c = vec3(0.34, 0.31, 0.26) * mix(1.0, (0.8 + 0.3 * h) * mix(0.6, 1.0, smoothstep(0.0, 0.035, joint)), fade);
  }
  diffuseColor.rgb = c;
}`,
    },
  });
  const drapeMat = patchedMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }, {
    key: 'hillDrape1',
    vertex: { pars: 'attribute vec3 aHC; varying vec3 vHC;', transform: 'vHC = aHC;' },
    fragment: {
      pars: 'varying vec3 vHC;',
      // rows run along the contour (u); the pattern varies across it (v, metres) and fades to
      // its average once a period shrinks toward a pixel
      color: /* glsl */ `
{
  float hk = floor(vHC.z + 0.5);
  float fw = max(fwidth(vHC.y), 1e-4);
  if (hk < 0.5) {
    float a = abs(vHC.y);
    float d = (a - 0.45) / 0.16;
    float fade = clamp(1.0 - fw * 6.0, 0.0, 1.0);
    float kerb = smoothstep(0.82, 1.0, a);
    float grit = 0.94 + 0.06 * sin(vHC.x * 1.7 + sin(vHC.x * 0.23) * 3.0);
    diffuseColor.rgb *= mix(1.0, (1.0 - 0.22 * exp(-d * d)) * (1.0 - 0.3 * kerb) * grit, fade);
  } else {
    float per = hk < 1.5 ? 1.1 : hk < 2.5 ? 0.9 : hk < 3.5 ? 1.8 : hk < 4.5 ? 0.8 : hk < 5.5 ? 2.6 : hk < 6.5 ? 7.0 : 0.0;
    if (per > 0.0) {
      float s = 0.5 + 0.5 * cos(6.2832 * vHC.y / per);
      float fade = clamp(1.0 - 2.0 * fw / per, 0.0, 1.0);
      float amp = hk > 2.5 && hk < 3.5 ? 0.6 : hk > 6.5 ? 0.0 : 0.45;
      diffuseColor.rgb *= mix(1.0, 1.0 - amp * 0.5 + amp * s, fade);
    }
    diffuseColor.rgb *= 0.93 + 0.07 * sin(vHC.x * 0.05 + vHC.y * 0.11);
  }
}`,
    },
  });
  const lod = [];
  let tris = 0, detailTris = 0;
  for (const C of chunks.values()) {
    const mk = (geo, mat, name, cast) => {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat);
      m.name = name; m.matrixAutoUpdate = false; m.updateMatrix();
      m.castShadow = cast; m.receiveShadow = true;
      geo.computeBoundingSphere();
      scene.add(m);
      return m;
    };
    const arch = mk(C.arch.geometry(), archMat, 'Hill country: buildings', true);
    const stone = mk(C.stone.geometry(), detailMat, 'Hill country: plinths, terraces and retaining walls', true);
    const detail = mk(C.detail.geometry(), detailMat, 'Hill country: walls, vines and orchards', false);
    const drape = mk(C.drape.geometry(), drapeMat, 'Hill country: roads and fields', false);
    if (arch) tris += arch.geometry.index.count / 3;
    if (stone) tris += stone.geometry.index.count / 3;
    if (detail) detailTris += detail.geometry.index.count / 3;
    if (drape) tris += drape.geometry.attributes.position.count / 3;
    lod.push({ arch, stone, detail, drape, x: C.cx, z: C.cz });
  }
  // warm lamps at the village gates, towers and monasteries (one Points draw)
  const lp = new Float32Array(lamps.length * 3);
  lamps.forEach((p, k) => { lp[k * 3] = p[0]; lp[k * 3 + 1] = p[1]; lp[k * 3 + 2] = p[2]; });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  const lampMat = new THREE.PointsMaterial({ color: 0xffc27a, size: 3.5, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const lampPts = new THREE.Points(lg, lampMat);
  lampPts.name = 'Hill country: lamps';
  lampPts.frustumCulled = false;
  scene.add(lampPts);

  let detailR = 5000, farR = 28000;
  const api = {
    lod, villages, shrines, tris, detailTris, houses, fields, roadLen, isFree: (x, z, r) => free(x, z, r),
    applyQuality(s) { const q = Math.max(0.4, Math.min(1, s.lowrise ?? 1)); detailR = 5000 * q; farR = 28000 * (0.7 + 0.3 * q); },
    update(dt, t, camera) {
      if (!camera) return;
      const p = camera.position;
      for (const L of lod) {
        const d = Math.hypot(L.x - p.x, L.z - p.z) - CH * 0.71;
        if (L.arch) L.arch.visible = d < farR;
        if (L.stone) L.stone.visible = d < farR;
        if (L.drape) L.drape.visible = d < farR;
        if (L.detail) L.detail.visible = d < detailR;
      }
      // lamps come up at dusk, steadily
      lampMat.opacity = Math.min(1, Math.max(0, (U.uCityLights?.value ?? 0)));
    },
  };
  return api;
}
