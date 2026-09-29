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

const BX0 = -29000, BX1 = 16000, BZ0 = -26000, BZ1 = -2400, GS = 80, CH = 4000;
const TAU = Math.PI * 2;
const NX = Math.round((BX1 - BX0) / GS) + 1, NZ = Math.round((BZ1 - BZ0) / GS) + 1;
const srgb = (r, g, b) => [r ** 2.2, g ** 2.2, b ** 2.2];
const FIELD_COL = {
  1: srgb(0.64, 0.56, 0.34), // ripe grain
  2: srgb(0.38, 0.48, 0.24), // green crop
  3: srgb(0.42, 0.40, 0.49), // lavender
  4: srgb(0.41, 0.33, 0.25), // ploughed
  5: srgb(0.45, 0.41, 0.29), // vineyard ground
  6: srgb(0.35, 0.46, 0.24), // orchard grass
  7: srgb(0.45, 0.53, 0.29), // hay meadow
};
const ROAD_COL = srgb(0.56, 0.53, 0.48);
// These seven surveyed summits are landmarks of the landscape. Their siting is
// independent of the farm random stream, so refining a barn cannot move a monastery.
const SUMMIT_SITES = [
  [4411.025186851621,-14494.070865958929,1.9630301625085438],
  [-2545.8673114329576,-18944.588391557336,1.7058519897996471],
  [9503.173861652613,-18450.008262321353,1.3455559364456877],
  [13708.88992242515,-19132.82586157322,1.0185044418953286],
  [-9057.685697898269,-19137.13637985289,.5531268395416373],
  [-7320.961469784379,-21365.199921950698,1.382479973405751],
  [11588.68195682764,-22957.956691756845,2.7828275652180987],
];

// -------------------------------------------------------------- builders --
class Solids {
  constructor(observe = null) {
    this.pos = []; this.nrm = []; this.fac = []; this.lathes = []; this.observe=observe;
    if(observe)this.lathes.push=(...gs)=>{for(const geometry of gs)observe({geometry,primitive:'lathe'});return Array.prototype.push.apply(this.lathes,gs);};
  }
  /** A convex solid: points [[x,y,z]], faces (index polygons); winding fixed outward. */
  solid(P, faces, kind, vBase = 0) {
    const start=this.pos.length;
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
        for (let w = 0; w < 3; w++) {
          const p = P[w === 0 ? order[0] : w === 1 ? order[k] : order[k + 1]];
          this.pos.push(p[0], p[1], p[2]); this.nrm.push(nx, ny, nz);
          this.fac.push(p[0] * tx + p[2] * tz, p[1] - vBase, kd);
        }
      }
    });
    if(this.observe){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(this.pos.slice(start),3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(this.nrm.slice(start),3));geometry.setAttribute('aFacade',new THREE.Float32BufferAttribute(this.fac.slice(start),3));this.observe({geometry,primitive:'solid',points:P});}
  }
  /** Eight corners (bottom ring then top ring) as a closed hexahedron. */
  // Abutting walls still have material bottoms and end caps. Culling nearby detail
  // must never turn a distant retaining wall into an open sheet.
  hexa(P, kind, vBase) { this.solid(P, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], kind, vBase); }
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
export function buildHillCountry(scene, { onComponent = null } = {}) {
  const rnd = mulberry32(51017);
  const buildingSites=[],fieldSites=[],allRoads=[],entrances=[],routes=[],villageCenters=[],orchardTrees=[];
  let activeSite=null,activeRoute=null,settlement=null;
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
  const blocked = (x, z, townR = 1450) => {
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
  for(const [x,z]of SUMMIT_SITES)occupy(x,z,35);

  // chunks
  const chunks = new Map();
  const chunk = (x, z) => {
    const ci = Math.floor((x - BX0) / CH), cj = Math.floor((z - BZ0) / CH), k = ci * 64 + cj;
    const observe=kind=>onComponent?(record)=>onComponent({...record,kind,site:activeSite,route:activeRoute}):null;
    if (!chunks.has(k)) chunks.set(k, { cx: BX0 + (ci + 0.5) * CH, cz: BZ0 + (cj + 0.5) * CH, arch: new Solids(observe('architecture')), stone: new Solids(observe('foundations')), detail: new Solids(observe('agriculture')), drape: new Drape() });
    return chunks.get(k);
  };

  // ------------------------------------------------------------ villages --
  const villages = [];
  const cands = [];
  for (let z = BZ0 + 300; z < BZ1 - 300; z += 360) for (let x = BX0 + 300; x < BX1 - 300; x += 360) {
    const px = x + (rnd() - 0.5) * 240, pz = z + (rnd() - 0.5) * 240;
    const h = renderedHeight(px, pz);
    if (h < 25 || h > 950 || blocked(px, pz, 1750)) continue;
    const [gx, gz] = slopeAt(px, pz), s = Math.hypot(gx, gz);
    if (s > 0.16) continue;
    // spurs and saddles: flat ground with a view; favour the kinder altitudes
    cands.push({ x: px, z: pz, h, score: (0.16 - s) * 6 + rnd() * 0.6 - Math.abs(h - 260) / 900 });
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands) {
    if (villages.length >= 48) break;
    if (villages.some((v) => Math.hypot(v.x - c.x, v.z - c.z) < 1500)) continue;
    villages.push({ ...c, r: 80 + rnd() * 110 });
  }

  // --------------------------------------------------------------- roads --
  // least-cost routes on the 80 m grid: steep grades are expensive, so the roads wind along
  // the contours and switch back up the slopes; shared cells become trunks (no doubled roads)
  const passable = new Uint8Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) passable[j * NX + i] = H[j * NX + i] > 12 && !blocked(BX0 + i * GS, BZ0 + j * GS, 1300) ? 1 : 0;
  // the summit terraces are reached by their own trails, never crossed: a trunk smoothed between
  // two grid cells cuts a corner by up to ~57 m, so the cells within 120 m of a summit stay closed
  // (a summit's own trail reopens them while it is routed: summitCells)
  const summitCells = new Map();
  for (const [x, z] of SUMMIT_SITES) {
    const ci = Math.round((x - BX0) / GS), cj = Math.round((z - BZ0) / GS), closed = [];
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = ci + di, j = cj + dj;
      if (i >= 0 && j >= 0 && i < NX && j < NZ && passable[j * NX + i] && Math.hypot(BX0 + i * GS - x, BZ0 + j * GS - z) < 120) { passable[j * NX + i] = 0; closed.push(j * NX + i); }
    }
    summitCells.set(`${x},${z}`, closed);
  }
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
    links.push([best.a, best.b]);
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
    if (o.length===1 || Math.hypot(last[0] - pl[0], last[1] - pl[1]) > step * 0.3) o.push(last); else o[o.length - 1] = last;
    return o;
  };
  let roadLen = 0;
  const roadDraws=[];let crossingSurface=null;
  const endPosts=[];
  const lamps = [];
  const road = (pts, hw, lift = 0, options = {}) => {
    let n = pts.length;
    if (n < 2) return;
    let S = pts.map((p, k) => {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const incoming=[p[0]-a[0],p[1]-a[1]],outgoing=[b[0]-p[0],b[1]-p[1]],li=Math.hypot(...incoming),lo=Math.hypot(...outgoing);
      let sx=-dz/l,sz=dx/l;
      if(li>1e-5&&lo>1e-5){const nx=-incoming[1]/li-outgoing[1]/lo,nz=incoming[0]/li+outgoing[0]/lo,ln=Math.hypot(nx,nz);if(ln>1e-5){sx=nx/ln;sz=nz/ln;const scale=Math.min(hw>1.5?2:1,1/Math.max(.05,sx*(-outgoing[1]/lo)+sz*outgoing[0]/lo));sx*=scale;sz*=scale;}}
      const g0 = renderedHeight(p[0], p[1]);
      const gl = renderedHeight(p[0] - sx * (hw + 0.4), p[1] - sz * (hw + 0.4)), gr = renderedHeight(p[0] + sx * (hw + 0.4), p[1] + sz * (hw + 0.4));
      return { x: p[0], z: p[1], sx, sz, g0, gl, gr, y: Math.max(g0, gl, gr) + 0.22 + lift };
    });
    // a gentle vertical profile: fill the dips (the embankment carries the road over gullies)
    const ys = S.map((s, k) => { let a = 0, c = 0; for (let q = Math.max(0, k - 3); q <= Math.min(n - 1, k + 3); q++) { a += S[q].y; c++; } return a / c; });
    S.forEach((s, k) => { s.y = Math.max(s.y, ys[k]); });
    if(options.heights)S.forEach((s,k)=>{s.y=options.heights[k];});
    if(options.normals)S.forEach((s,k)=>{[s.sx,s.sz]=options.normals[k];});
    if(options.ends)for(const [k,y]of [[0,options.ends[0]],[n-1,options.ends[1]]])if(Number.isFinite(y))S[k].y=y;
    const sourceS=S;
    // Fine sections follow the real polar terrain triangles between the coarse
    // routing samples. Keep source samples for deterministic farm siting.
    if(!options.heights||options.kind==='summit-trail'){
      const fine=[];
      for(let k=1;k<S.length;k++){const a=S[k-1],b=S[k],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/3));for(let j=0;j<steps;j++){const u=j/steps,p={};for(const key of ['x','z','sx','sz','g0','gl','gr','y'])p[key]=a[key]+(b[key]-a[key])*u;fine.push(p);}}
      fine.push({...S.at(-1)});S=fine;n=S.length;
      S.forEach((p,k)=>{if((k===0||k===n-1)&&options.ends)return;for(const lateral of [-1,0,1])p.y=Math.max(p.y,renderedHeight(p.x+p.sx*(hw+.1)*lateral,p.z+p.sz*(hw+.1)*lateral)+.2);});
    }
    const record={id:allRoads.length,points:S,halfWidth:hw,settlement,kind:options.kind||'trunk'},previousRoute=activeRoute;
    activeRoute=record;
    allRoads.push(record);
    for(const p of S)occupy(p.x,p.z,hw+4);
    roadDraws.push(()=>{const prior=activeRoute;activeRoute=record;n=S.length;
    for (let k = 0; k < n; k++) {
      const s = S[k];
      if (k === n - 1) break;
      const t = S[k + 1], C = chunk((s.x + t.x) / 2, (s.z + t.z) / 2);
      const segL = Math.hypot(t.x - s.x, t.z - s.z);
      // deck (draped, polygon-offset)
      const L0 = [s.x - s.sx * hw, s.y, s.z - s.sz * hw], R0 = [s.x + s.sx * hw, s.y, s.z + s.sz * hw];
      const L1 = [t.x - t.sx * hw, t.y, t.z - t.sz * hw], R1 = [t.x + t.sx * hw, t.y, t.z + t.sz * hw];
      const up = [0, 1, 0];
      // The road finish is an optical overlay on a complete, founded embankment.
      // Survey its actual width, including intermediate terrain mesh triangles.
      let floor=Math.min(s.y,t.y)-.6;
      const samples=Math.max(2,Math.ceil(segL/3));
      for(let q=0;q<=samples;q++)for(const lateral of [-1,0,1]){
        const u=q/samples,x=s.x+(t.x-s.x)*u+(s.sx+(t.sx-s.sx)*u)*hw*lateral,z=s.z+(t.z-s.z)*u+(s.sz+(t.sz-s.sz)*u)*hw*lateral;
        floor=Math.min(floor,renderedHeight(x,z)-.7);
      }
      const shared=(s.shared&&t.shared)&&options.kind!=='summit-court';
      const stair=options.kind&&options.kind!=='trunk'&&Math.abs(t.y-s.y)/segL>.22;
      // shared stairs keep an absolute 0.16 m tread grid so crossing lanes' treads coincide; rounding
      // to it (not up) with 0.15 m risers keeps every step, the first off the landing included, under 0.24 m
      const treadCount=stair?Math.ceil(Math.abs(t.y-s.y)/(shared?.15:.18)):1;
      for(let q=0;q<treadCount;q++){
        const u0=q/treadCount,u1=(q+1)/treadCount,blend=(a,b,u)=>a.map((v,j)=>v+(b[j]-v)*u);
        const A=blend(L0,L1,u0),B=blend(R0,R1,u0),D=blend(L0,L1,u1),E=blend(R0,R1,u1);
        if(stair){let y=s.y+(t.y-s.y)*(t.y>s.y?u1:u0);if(shared)y=Math.round(y/.16)*.16;for(const p of [A,B,D,E])p[1]=y;}
        // (a trunk deck stays level across its width: tilted to each corner's own pad blend, a kerb
        // side dropped by up to a metre below the carriageway where a pad was off its centreline)
        if(shared&&crossingSurface&&record.kind!=='trunk')for(const [p,blend,u]of [[A,s.padBlend??1,u0],[B,s.padBlend??1,u0],[D,t.padBlend??1,u1],[E,t.padBlend??1,u1]]){const original=(s.originalY??s.y)+((t.originalY??t.y)-(s.originalY??s.y))*u,center={x:s.x+(t.x-s.x)*u,z:s.z+(t.z-s.z)*u,y:original};p[1]+=(crossingSurface({x:p[0],z:p[2],y:original})-crossingSurface(center))*blend;}
        for(const [p,v]of [[A,-1],[B,1],[E,1],[A,-1],[E,1],[D,-1]])C.drape.vert(p[0],p[1],p[2],up,ROAD_COL,roadLen+segL*(p===D||p===E?u1:u0),v,0);
        C.stone.hexa([...[A,B,E,D].map(p=>[p[0],floor,p[2]]),...[A,B,E,D].map(p=>[p[0],p[1]-.015,p[2]])],1,floor);
      }
      // kerbs and embankment sides down into the ground: closed from every side
      if(options.kerbs!==false)for (const sgn of [-1, 1]) {
        const e0x = s.x + s.sx * sgn * (hw + 0.2), e0z = s.z + s.sz * sgn * (hw + 0.2), e1x = t.x + t.sx * sgn * (hw + 0.2), e1z = t.z + t.sz * sgn * (hw + 0.2);
        const b0 = Math.min(sgn < 0 ? s.gl : s.gr, renderedHeight(e0x, e0z)) - 0.6, b1 = Math.min(sgn < 0 ? t.gl : t.gr, renderedHeight(e1x, e1z)) - 0.6;
        // (low kerbs are near detail; tall embankments carry to the far view)
        const tall = Math.max(s.y - b0, t.y - b1) > 2.2;
        (tall ? C.stone : C.detail).wall(e0x, e0z, b0, s.y + 0.12, e1x, e1z, b1, t.y + 0.12, 0.4, 1);
        // a retaining wall where the road is cut into the hillside
        const ux0 = s.x + s.sx * sgn * (hw + 1.6), uz0 = s.z + s.sz * sgn * (hw + 1.6), ux1 = t.x + t.sx * sgn * (hw + 1.6), uz1 = t.z + t.sz * sgn * (hw + 1.6);
        const u0 = renderedHeight(ux0, uz0), u1 = renderedHeight(ux1, uz1);
        if (u0 > s.y + 0.9 && u1 > t.y + 0.9) C.stone.wall(ux0, uz0, s.y - 0.4, u0 + 0.5, ux1, uz1, t.y - 0.4, u1 + 0.5, 0.7, 1);
      }
      roadLen += segL;
    }
      activeRoute=prior;
    });
    // lamp posts at the ends, just off the kerb
    // (placed once every road exists: where trunks meet, one end's post stood on another's carriageway)
    if (hw > 2 && options.lamps!==false) for (const k of [0, n - 1]) {
      const s = S[k];
      endPosts.push({ x: s.x + s.sx * (hw + 0.9), z: s.z + s.sz * (hw + 0.9), route: record });
    }
    activeRoute=previousRoute;return sourceS;
  };
  const roadSamples = [];
  const junctionY=new Map();
  for(const c of chains)for(const p of [c[0],c[c.length-1]]){
    const id=p.join(',');let y=renderedHeight(...p);
    for(let k=0;k<16;k++){const a=k*Math.PI/8;y=Math.max(y,renderedHeight(p[0]+Math.cos(a)*3.2,p[1]+Math.sin(a)*3.2));}
    junctionY.set(id,y+.34);
  }
  chains.forEach((c, ci) => {
    const pts = resample(smooth(c, 3), 15);
    const S = road(pts, 2.6, .06,{ends:[junctionY.get(c[0].join(',')),junctionY.get(c[c.length-1].join(','))]});
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
    for(let u=-L/2-.6;u<=L/2+.61;u+=Math.max(1,(L+1.2)/12))for(let v=-W/2-.6;v<=W/2+.61;v+=Math.max(1,(W+1.2)/10)){const h=renderedHeight(x+ax*u+sx*v,z+az*u+sz*v);lo=Math.min(lo,h);hi=Math.max(hi,h);}
    occupy(x, z, r);
    const C = chunk(x, z), base = hi + 0.35;
    const previous=activeSite;
    activeSite={id:buildingSites.length,type:opts.wall===8?'barn':'house',settlement,x,z,ang,L,W,lo,base,wallH};buildingSites.push(activeSite);
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
    activeSite=previous;
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
    const previous=activeSite;
    activeSite={id:buildingSites.length,type:'belfry',settlement,x,z,ang,L:w,W:w,lo,base,wallH:h};buildingSites.push(activeSite);
    C.stone.box(x, z, ax, az, w / 2 + 0.6, w / 2 + 0.6, lo - 1.2, base, 1, lo - 1.2);
    C.arch.box(x, z, ax, az, w / 2, w / 2, base, base + h, 5, base);
    C.arch.box(x, z, ax, az, w / 2 - 0.3, w / 2 - 0.3, base + h, base + h + 2.4, 2, base + h);   // the lit belfry / lantern
    C.arch.solid([[x, base + h + 2.4 + w * 0.9, z], ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + (ax * a - az * b) * (w / 2 + 0.3), base + h + 2.4, z + (az * a + ax * b) * (w / 2 + 0.3)])],
      [[1, 2, 3, 4], [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]], 11, base + h);
    activeSite=previous;return true;
  };
  const contourAngle = (x, z) => { const [gx, gz] = slopeAt(x, z); return Math.hypot(gx, gz) > 0.01 ? Math.atan2(gx, -gz) : rnd() * Math.PI; };

  for (const v of villages) {
    settlement=`village-${villages.indexOf(v)}`;
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
    settlement=`farm-${farms.length}`;
    if (!house(x, z, ang, estate ? 22 : 12 + rnd() * 4, estate ? 11 : 7.5, estate ? 7.6 : 5.2, { chimney: true })) continue;
    const ax = Math.cos(ang), az = Math.sin(ang);
    // Reserve the farm approach before siting the barn. The complete local route
    // is constructed with the other thresholds after all buildings are known.
    const lane = resample([[s.x + s.sx * sg * 6, s.z + s.sz * sg * 6], [x - s.sx * sg * 15, z - s.sz * sg * 15]], 10);
    let ok = true;
    lane.forEach((p, k) => { if (renderedHeight(p[0], p[1]) < 6 || (k > 0 && k < lane.length - 2 && !free(p[0], p[1], 2))) ok = false; });
    if (ok)lane.forEach(p=>occupy(p[0],p[1],2));
    house(x + ax * 26 - az * 6, z + az * 26 + ax * 6, ang + Math.PI / 2, 18 + rnd() * 6, 9, 5.5, { wall: 8, pitch: 0.55 });   // the barn
    if (estate) tower(x - ax * 20 + az * 14, z - az * 20 - ax * 14, ang, 4.5, 9);
    farms.push({ x, z, r: 40 });
  }

  // ------------------------------------------------ monasteries & observatories on summits --
  const shrines = [];
  for (const [x,z,ang] of SUMMIT_SITES) {
    const C=chunk(x,z);
    const ax = Math.cos(ang), az = Math.sin(ang), sx = -az, sz = ax;
    // Survey the rotated footprint we actually build, not the axis-aligned
    // trial pad. On a summit the two sets of corners can differ by metres.
    let lo=Infinity,hi=-Infinity;
    for(let u=-23;u<=23;u+=4.6)for(let v=-23;v<=23;v+=4.6){const h=renderedHeight(x+ax*u+sx*v,z+az*u+sz*v);lo=Math.min(lo,h);hi=Math.max(hi,h);}
    const top=hi+.5;
    settlement=`summit-${shrines.length}`;
    activeSite={id:buildingSites.length,type:shrines.length%2===0?'observatory':'monastery',settlement,x,z,ang,L:46,W:46,lo,base:top};buildingSites.push(activeSite);
    occupy(x, z, 34);
    C.stone.box(x, z, ax, az, 23, 23, lo - 1.5, top, 1, lo - 1.5);            // the terrace, walled to the rock
    // parapet round the terrace edge
    for (let e = 0; e < 4; e++) {
      const c0 = [[-1, -1], [1, -1], [1, 1], [-1, 1]][e], c1 = [[-1, -1], [1, -1], [1, 1], [-1, 1]][(e + 1) % 4];
      const p0 = [x + (ax * c0[0] + sx * c0[1]) * 22.7, z + (az * c0[0] + sz * c0[1]) * 22.7], p1 = [x + (ax * c1[0] + sx * c1[1]) * 22.7, z + (az * c1[0] + sz * c1[1]) * 22.7];
      if(e===2){
        // A real four-metre entrance in the parapet, aligned with the gatehouse.
        for(const [u,v]of [[0,.455],[.545,1]])C.stone.wall(p0[0]+(p1[0]-p0[0])*u,p0[1]+(p1[1]-p0[1])*u,top-.1,top+1.1,p0[0]+(p1[0]-p0[0])*v,p0[1]+(p1[1]-p0[1])*v,top-.1,top+1.1,.5,1);
      }else C.stone.wall(p0[0], p0[1], top - 0.1, top + 1.1, p1[0], p1[1], top - 0.1, top + 1.1, 0.5, 1);
    }
    const observatory = shrines.length % 2 === 0;
    if (observatory) {
      // an observatory: drum, white dome with a dark slit band, and a low service wing
      // The closed drum is seated on the terrace; the dark door faces the walk.
      const dome = [{ r: 9, y: top, kind: 5 }, { r: 9, y: top + 7, kind: 5 }, { r: 9.6, y: top + 7, kind: 1 }, { r: 9.6, y: top + 7.6, kind: 1 }, { r: 9, y: top + 7.6, kind: 1 },
        { r: 8.3, y: top + 11, kind: 1 }, { r: 6.4, y: top + 14.2, kind: 1 }, { r: 3.6, y: top + 16.3, kind: 1 }, { r: 0, y: top + 17, kind: 1 }];
      C.arch.lathes.push(latheFacade(dome, 28).translate(x - ax * 6, 0, z - az * 6));
      const wing = { x: x + ax * 11 + sx * 6, z: z + az * 11 + sz * 6 };
      C.arch.box(wing.x, wing.z, sx, sz, 9, 3.5, top, top + 4.2, 5, top);
      C.arch.box(wing.x, wing.z, sx, sz, 9.3, 3.8, top + 4.2, top + 4.6, 1, top);
      C.arch.box(x-ax*6+sx*8.96,z-az*6+sz*8.96,ax,az,.95,.12,top,top+2.8,10,top);
    } else {
      // a monastery: four wings round a cloister garth, a church and a bell tower
      for (let e = 0; e < 4; e++) {
        const a2 = ang + (e * Math.PI) / 2, cx = x + Math.cos(a2 + Math.PI / 2) * 13, cz = z + Math.sin(a2 + Math.PI / 2) * 13;
        const wx = Math.cos(a2), wz = Math.sin(a2), wsx = -wz, wsz = wx;
        const W = 6.4, L = e % 2 ? 19.6 : 32.4, base = top, h = 6.5, rise = 2.4;
        const pt = (s, y, t) => [cx + wsx * s + wx * t, y, cz + wsz * s + wz * t];
        if(e===0)for(const sg of [-1,1])C.arch.box(cx+wx*sg*(L/4+1),cz+wz*sg*(L/4+1),wx,wz,L/4-1,W/2,base,base+3.2,5,base);
        const lower=e===0?base+3.2:base;
        const prof = [[-W / 2, lower], [W / 2, lower], [W / 2, base + h], [0, base + h + rise], [-W / 2, base + h]];
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
    activeSite.gate={x:x+sx*23,z:z+sz*23,dx:sx,dz:sz};
    activeSite.door=observatory?{x:x-ax*6+sx*10.2,z:z-az*6+sz*10.2}:{x:x+sx*7.5,z:z+sz*7.5};
    shrines.push({ x, z, y: top, observatory,ang,site:activeSite });activeSite=null;
  }

  // ---------------------------------------------------- inhabited local routes --
  // Each village gets lanes that grow from its existing road and turn around the
  // actual house plots. A shared shortest-path tree gives small irregular blocks
  // and courtyards, rather than drawing the same radial diagram on every hill.
  const siteBox=(s,x,z,pad=0)=>{
    const c=Math.cos(s.ang),a=Math.sin(s.ang),dx=x-s.x,dz=z-s.z;
    return Math.abs(dx*c+dz*a)<s.L/2+.6+pad&&Math.abs(-dx*a+dz*c)<s.W/2+.6+pad;
  };
  const RING_COS=[],RING_SIN=[];for(let k=0;k<8;k++){const a=k*Math.PI/4;RING_COS.push(Math.cos(a));RING_SIN.push(Math.sin(a));}
  const routeHeight=(x,z,hw=1)=>{
    let h=renderedHeight(x,z);
    for(let k=0;k<8;k++)h=Math.max(h,renderedHeight(x+RING_COS[k]*hw,z+RING_SIN[k]*hw));
    return h+.2;
  };
  // Segment buckets (numeric cell keys). Every query below returns exactly what a
  // scan over all segments in id order would: same hits, same order, same ties.
  const trunkSegments=[],segmentCells=new Map(),segmentCell=32,SK=1<<16;
  let segI0=Infinity,segI1=-Infinity,segJ0=Infinity,segJ1=-Infinity;
  const addRoadSegments=road=>{const S=road.points;for(let k=1;k<S.length;k++){
    const a=S[k-1],b=S[k],id=trunkSegments.push([a,b,road.halfWidth])-1;
    const i0=Math.floor(Math.min(a.x,b.x)/segmentCell),i1=Math.floor(Math.max(a.x,b.x)/segmentCell),j0=Math.floor(Math.min(a.z,b.z)/segmentCell),j1=Math.floor(Math.max(a.z,b.z)/segmentCell);
    segI0=Math.min(segI0,i0);segI1=Math.max(segI1,i1);segJ0=Math.min(segJ0,j0);segJ1=Math.max(segJ1,j1);
    for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const key=i*SK+j;let L=segmentCells.get(key);if(!L)segmentCells.set(key,L=[]);L.push(id);}
  }};
  for(const road of allRoads)addRoadSegments(road);
  const projectSegment=(x,z,segment)=>{const [a,b,hw]=segment,dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1))),px=a.x+dx*t,pz=a.z+dz*t;return{x:px,z:pz,y:a.y+(b.y-a.y)*t,d:Math.hypot(x-px,z-pz),hw};};
  // the same distance as projectSegment(...).d, without the allocation
  const segmentDistance=(x,z,segment)=>{const a=segment[0],b=segment[1],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-(a.x+dx*t),z-(a.z+dz*t));};
  const closeRoads=(x,z,r=12)=>{const out=[];const i0=Math.floor((x-r)/segmentCell),i1=Math.floor((x+r)/segmentCell),j0=Math.floor((z-r)/segmentCell),j1=Math.floor((z+r)/segmentCell);for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const L=segmentCells.get(i*SK+j);if(L)for(let q=0;q<L.length;q++){const segment=trunkSegments[L[q]];if(segmentDistance(x,z,segment)<r)out.push(projectSegment(x,z,segment));}}return out;};
  // closeRoads(x,z,r).some(p=>p.d<p.hw+pad+.5): is any carriageway that close?
  const roadWithin=(x,z,r,pad)=>{const i0=Math.floor((x-r)/segmentCell),i1=Math.floor((x+r)/segmentCell),j0=Math.floor((z-r)/segmentCell),j1=Math.floor((z+r)/segmentCell);for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const L=segmentCells.get(i*SK+j);if(L)for(let q=0;q<L.length;q++){const segment=trunkSegments[L[q]],d=segmentDistance(x,z,segment);if(d<r&&d<segment[2]+pad+.5)return true;}}return false;};
  // Nearest segment (lowest id on ties), by rings of buckets: once the best distance is
  // below the ring's inner reach, no unvisited segment can be as close.
  const nearestRoad=(x,z)=>{
    if(!trunkSegments.length)return null;
    const ci=Math.floor(x/segmentCell),cj=Math.floor(z/segmentCell);let bestD=Infinity,bestId=-1;
    for(let k=0;;k++){
      for(let i=ci-k;i<=ci+k;i++)for(let j=cj-k;j<=cj+k;j+=(i===ci-k||i===ci+k||k===0)?1:2*k){
        const L=segmentCells.get(i*SK+j);if(L)for(let q=0;q<L.length;q++){const id=L[q],d=segmentDistance(x,z,trunkSegments[id]);if(d<bestD||(d===bestD&&id<bestId)){bestD=d;bestId=id;}}
      }
      if(bestId>=0&&bestD<k*segmentCell)break;
      if(ci-k<=segI0&&ci+k>=segI1&&cj-k<=segJ0&&cj+k>=segJ1)break;
    }
    return projectSegment(x,z,trunkSegments[bestId]);
  };
  // New paving meets the old carriageway at its actual elevation. The shoulder
  // transition clears both its embankment and its low kerb before descending.
  const joiningHeight=(x,z,hw=1.25)=>{let y=routeHeight(x,z,hw);for(const p of closeRoads(x,z))y=Math.max(y,p.y+.14-Math.max(0,p.d-p.hw-hw-.4)*.25);return y;};
  // A summit trail joins an existing road sample exactly. It uses the same
  // coarse terrain cost as the trunk, followed by fine terrain-following paving.
  for(const sh of shrines){
    const s=sh.site,near=nearestRoad(s.x,s.z),g=s.gate;
    // Route from the approach outside the gate (the summit's other cells stay closed), so the
    // trail always comes in on the gate side instead of skirting the parapet round to it.
    const approach={x:g.x+g.dx*45,z:g.z+g.dz*45};
    const coarse=route(cellOf(approach.x,approach.z),cellOf(near.x,near.z));
    const path=coarse?coarse.map(n=>[BX0+(n%NX)*GS,BZ0+((n/NX)|0)*GS]):[[near.x,near.z],[approach.x,approach.z]];
    // route() returns destination first: road -> summit. Trim the part that
    // would cross the occupied summit terrace, then arrive on its gate side.
    while(path.length>1&&Math.hypot(path.at(-1)[0]-s.x,path.at(-1)[1]-s.z)<100)path.pop();
    path[0]=[near.x,near.z];path.push([approach.x,approach.z]);
    let pts=resample(smooth(path,2),3),join=near;
    // Join the first existing road met while walking back from the summit.
    // Coarse A* otherwise retraces an older road at a different fill height.
    for(let k=pts.length-2;k>=0;k--){const contacts=closeRoads(...pts[k]).filter(p=>p.d<p.hw+2.2).sort((a,b)=>a.d-b.d);if(contacts.length){join=contacts[0];pts=[[join.x,join.z],...pts.slice(k+1)];break;}}
    const heights=pts.map(p=>{const near=closeRoads(...p,8).filter(q=>q.d<q.hw+3.2).sort((a,b)=>a.d-b.d)[0];return near?near.y+.08:joiningHeight(...p,1.5);});heights[0]=join.y+.08;
    settlement=s.settlement;
    const S=road(pts,1.4,0,{heights,ends:[heights[0],heights.at(-1)],kerbs:false,kind:'summit-trail',lamps:false});
    if(S){const actual=allRoads.at(-1);roadSamples.push(actual.points);addRoadSegments(actual);}

  }
  const groups=new Map();
  for(const s of buildingSites){if(!groups.has(s.settlement))groups.set(s.settlement,[]);groups.get(s.settlement).push(s);}
  const stairs=(s,e)=>{
    const C=chunk(s.x,s.z),previous=activeSite;activeSite=s;
    const {dx,dz,face,foot,top,bottom,steps}=e,ax=-dz,az=dx;
    const rise=(top-bottom)/Math.max(steps,1),length=Math.hypot(face.x-foot.x,face.z-foot.z),landing=.72,runLength=Math.max(.2,length-landing);
    // Closed short treads, each founded to the actual terrain under its corners.
    for(let k=0;k<=steps;k++){
      const d0=k===steps?runLength:k/steps*runLength,d1=k===steps?length:(k+1)/steps*runLength,u0=d0/length,u1=d1/length,p0={x:foot.x+(face.x-foot.x)*u0,z:foot.z+(face.z-foot.z)*u0},p1={x:foot.x+(face.x-foot.x)*u1,z:foot.z+(face.z-foot.z)*u1};
      const y=bottom+rise*Math.min(k+1,steps),x=(p0.x+p1.x)/2,z=(p0.z+p1.z)/2;
      let low=Math.min(bottom,top)-.5;for(const a of [-1,1])for(const b of [-1,1])low=Math.min(low,renderedHeight(x+ax*a*.88+dx*b*(d1-d0)/2,z+az*a*.88+dz*b*(d1-d0)/2)-.65);
      C.stone.box(x,z,ax,az,.88,(d1-d0)/2+.008,low,y,1,low);
    }
    if(s.type==='house'||s.type==='barn'||s.type==='belfry'){
      C.arch.box(face.x-dx*.04,face.z-dz*.04,ax,az,s.type==='barn'?1.2:.72,.1,s.base+.02,s.base+(s.type==='barn'?3.2:2.25),10,s.base);
      // A simple pale lintel makes the inhabited threshold legible at Medium.
      C.arch.box(face.x-dx*.02,face.z-dz*.02,ax,az,s.type==='barn'?1.35:.86,.14,s.base+(s.type==='barn'?3.2:2.25),s.base+(s.type==='barn'?3.4:2.43),1,s.base);
    }
    activeSite=previous;
    entrances.push({...e,landing,site:s.id,settlement:s.settlement});s.entrance=entrances.at(-1);
  };
  const LC=16,lampCells=new Map();
  for(const p of lamps){const key=Math.floor(p[0]/LC)*SK+Math.floor(p[2]/LC);let L=lampCells.get(key);if(!L)lampCells.set(key,L=[]);L.push(p);}
  for(const [group,sites]of groups){
    settlement=group;
    const center={x:sites.reduce((a,s)=>a+s.x,0)/sites.length,z:sites.reduce((a,s)=>a+s.z,0)/sites.length};
    const nearest=nearestRoad(center.x,center.z),step=3.5,hw=.86;
    const xmin=Math.min(...sites.map(s=>s.x-s.L/2-s.W/2),nearest.x)-35,xmax=Math.max(...sites.map(s=>s.x+s.L/2+s.W/2),nearest.x)+35;
    const zmin=Math.min(...sites.map(s=>s.z-s.L/2-s.W/2),nearest.z)-35,zmax=Math.max(...sites.map(s=>s.z+s.L/2+s.W/2),nearest.z)+35;
    const nx=Math.ceil((xmax-xmin)/step)+1,nz=Math.ceil((zmax-zmin)/step)+1,N=nx*nz;
    const X=n=>xmin+(n%nx)*step,Z=n=>zmin+((n/nx)|0)*step,cell=(x,z)=>Math.round((z-zmin)/step)*nx+Math.round((x-xmin)/step);
    const obstacles=buildingSites.filter(s=>s.x+s.L+s.W>xmin&&s.x-s.L-s.W<xmax&&s.z+s.L+s.W>zmin&&s.z-s.L-s.W<zmax);
    const ports=[];
    // Buckets of the obstacles (each by the circle that bounds its padded footprint)
    // and of the lamps, so clear() tests only what could be hit; same answers.
    const OB=8,OBPAD=1.5,obCells=new Map(),obFast=[];
    for(const s of obstacles){
      const o={s,c:Math.cos(s.ang),a:Math.sin(s.ang),hl:s.L/2+.6,hw:s.W/2+.6};obFast.push(o);
      const R=Math.hypot(o.hl+OBPAD,o.hw+OBPAD)+.01;
      for(let i=Math.floor((s.x-R)/OB);i<=Math.floor((s.x+R)/OB);i++)for(let j=Math.floor((s.z-R)/OB);j<=Math.floor((s.z+R)/OB);j++){const key=i*SK+j;let L=obCells.get(key);if(!L)obCells.set(key,L=[]);L.push(o);}
    }
    const obHit=(o,x,z,pad)=>{const s=o.s,dx=x-s.x,dz=z-s.z;return Math.abs(dx*o.c+dz*o.a)<o.hl+pad&&Math.abs(-dx*o.a+dz*o.c)<o.hw+pad;};
    const obstacleAt=(x,z,pad,ignore)=>{
      if(pad>OBPAD){for(const o of obFast)if(o.s!==ignore&&obHit(o,x,z,pad))return true;return false;}
      const L=obCells.get(Math.floor(x/OB)*SK+Math.floor(z/OB));if(L)for(let q=0;q<L.length;q++){const o=L[q];if(o.s!==ignore&&obHit(o,x,z,pad))return true;}return false;
    };
    const lampAt=(x,z,r)=>{const i0=Math.floor((x-r)/LC),i1=Math.floor((x+r)/LC),j0=Math.floor((z-r)/LC),j1=Math.floor((z+r)/LC);for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const L=lampCells.get(i*SK+j);if(L)for(const p of L)if(Math.hypot(p[0]-x,p[2]-z)<r)return true;}return false;};
    // lamps near this settlement; inside the inner box no other lamp can be within reach
    const LM=60,groupLamps=lamps.filter(p=>p[0]>xmin-LM&&p[0]<xmax+LM&&p[2]>zmin-LM&&p[2]<zmax+LM);
    const lampNear=(x,z,r)=>{if(r<LM-2&&x>xmin-LM+r+1&&x<xmax+LM-r-1&&z>zmin-LM+r+1&&z<zmax+LM-r-1){for(const p of groupLamps)if(Math.hypot(p[0]-x,p[2]-z)<r)return true;return false;}return lampAt(x,z,r);};
    const clear=(x,z,pad=hw+.1,ignore=null)=>!lampNear(x,z,pad+.4)&&!obstacleAt(x,z,pad,ignore)&&!(roadWithin(x,z,6,pad)&&!ports.some(q=>Math.hypot(q.x-x,q.z-z)<9));
    const lineClear=(a,b,ignore=null)=>{const n=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/.65));for(let k=0;k<=n;k++)if(!clear(a.x+(b.x-a.x)*k/n,a.z+(b.z-a.z)*k/n,hw+.1,ignore))return false;return true;};
    const valid=new Uint8Array(N),height=new Float32Array(N),cost=new Float64Array(N).fill(Infinity),prev=new Int32Array(N).fill(-2),anchor=new Map();
    const heap=[];
    const push=(n,c)=>{let k=heap.length;heap.push([n,c]);while(k){const p=(k-1)>>1;if(heap[p][1]<=c)break;heap[k]=heap[p];k=p;heap[k]=[n,c];}};
    const pop=()=>{const result=heap[0],tail=heap.pop();if(heap.length){heap[0]=tail;let k=0;for(;;){let c=k,l=2*k+1,r=l+1;if(l<heap.length&&heap[l][1]<heap[c][1])c=l;if(r<heap.length&&heap[r][1]<heap[c][1])c=r;if(c===k)break;[heap[k],heap[c]]=[heap[c],heap[k]];k=c;}}return result;};
    let candidates=[];
    const nearIds=new Set();
    for(let i=Math.floor((xmin-8)/segmentCell);i<=Math.floor((xmax+8)/segmentCell);i++)for(let j=Math.floor((zmin-8)/segmentCell);j<=Math.floor((zmax+8)/segmentCell);j++){const L=segmentCells.get(i*SK+j);if(L)for(const id of L)nearIds.add(id);}
    for(const [a,b]of [...nearIds].sort((p,q)=>p-q).map(id=>trunkSegments[id])){if(Math.max(a.x,b.x)<xmin-8||Math.min(a.x,b.x)>xmax+8||Math.max(a.z,b.z)<zmin-8||Math.min(a.z,b.z)>zmax+8)continue;const count=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/step));for(let k=0;k<=count;k++)candidates.push({x:a.x+(b.x-a.x)*k/count,z:a.z+(b.z-a.z)*k/count,y:a.y+(b.y-a.y)*k/count});}
    const allCandidates=candidates;
    candidates.sort((a,b)=>Math.hypot(a.x-center.x,a.z-center.z)-Math.hypot(b.x-center.x,b.z-center.z));
    for(const p of candidates){if(ports.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<(group.startsWith('village-')?villages[Number(group.split('-')[1])].r*.7:30)))continue;ports.push(p);if(ports.length===(group.startsWith('village-')?3:1))break;}
    candidates=ports;
    for(let n=0;n<N;n++){const x=X(n),z=Z(n);if(clear(x,z)&&renderedHeight(x,z)>5){valid[n]=1;const contact=closeRoads(x,z,6).filter(p=>p.d<p.hw+3.2).sort((a,b)=>a.d-b.d)[0];if(contact)height[n]=Math.max(routeHeight(x,z,2.15),contact.y+.1);else height[n]=Math.max(joiningHeight(x,z,1.4),routeHeight(x,z,2.15));}}
    for(const p of candidates){const ni=Math.round((p.x-xmin)/step),nj=Math.round((p.z-zmin)/step);let best=null;for(let di=-2;di<=2;di++)for(let dj=-2;dj<=2;dj++){
      const i=ni+di,j=nj+dj,n=j*nx+i;if(i<0||j<0||i>=nx||j>=nz||!valid[n])continue;
      const q={x:X(n),z:Z(n)},d=Math.hypot(q.x-p.x,q.z-p.z);if((!best||d<best.d)&&lineClear(q,p))best={n,d};
    }if(best){cost[best.n]=best.d;prev[best.n]=-1;anchor.set(best.n,p);push(best.n,best.d);}}
    const spine=new Set();
    const solve=()=>{while(heap.length){const [n,c]=pop();if(c!==cost[n])continue;const i=n%nx,j=(n/nx)|0;for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){
      if(!di&&!dj)continue;const ii=i+di,jj=j+dj,m=jj*nx+ii;if(ii<0||jj<0||ii>=nx||jj>=nz||!valid[m])continue;
      if(di&&dj&&(!valid[j*nx+ii]||!valid[jj*nx+i]))continue;
      if(!clear((X(n)+X(m))/2,(Z(n)+Z(m))/2))continue;
      // Linear ascent cost discourages needless sawtooth switchbacks on steep
      // local plots; those short climbs receive real stone treads below.
      const distance=step*Math.hypot(di,dj),nc=c+(distance+Math.abs(height[m]-height[n])*3)*(spine.has(n)&&spine.has(m)?.12:1);
      if(nc<cost[m]){cost[m]=nc;prev[m]=n;push(m,nc);}
    }}};
    solve();
    if(group.startsWith('village-')){
      const index=Number(group.split('-')[1]),v=villages[index],[gx,gz]=slopeAt(v.x,v.z),angle=Math.atan2(gx,-gz),variant=index%3;
      const targets=variant===0?[0,Math.PI,Math.PI/2]:variant===1?[0,TAU/3,TAU*2/3]:[-.4,Math.PI-.4,Math.PI/2];
      for(const da of targets){const x=v.x+Math.cos(angle+da)*v.r*.75,z=v.z+Math.sin(angle+da)*v.r*.75;let best=-1,distance=Infinity;for(let n=0;n<N;n++)if(Number.isFinite(cost[n])){const d=Math.hypot(X(n)-x,Z(n)-z);if(d<distance){distance=d;best=n;}}for(let n=best;n>=0;n=prev[n])spine.add(n);}
      cost.fill(Infinity);prev.fill(-2);for(const [n,p]of anchor){const d=Math.hypot(X(n)-p.x,Z(n)-p.z);cost[n]=d;prev[n]=-1;push(n,d);}solve();
    }
    const used=new Map(),roots=new Set(),doorLinks=[];
    const addEdge=(a,b)=>{if(!used.has(a))used.set(a,new Set());if(!used.has(b))used.set(b,new Set());used.get(a).add(b);used.get(b).add(a);};
    for(const s of sites){
      const options=[];
      const directions=s.gate?[{dx:s.gate.dx,dz:s.gate.dz,face:{x:s.gate.x,z:s.gate.z}}]:[0,1,2,3].flatMap(k=>[-.24,0,.24].map(offset=>{const a=s.ang+k*Math.PI/2,dx=Math.cos(a),dz=Math.sin(a),half=k%2?s.W/2:s.L/2,along=(k%2?s.L:s.W)*offset;return{dx,dz,face:{x:s.x+dx*half-dz*along,z:s.z+dz*half+dx*along}};}));
      for(const d of directions){
        let length=2.1,bottom=0,steps=1,foot;
        for(let k=0;k<20;k++){foot={x:d.face.x+d.dx*length,z:d.face.z+d.dz*length};bottom=Math.max(joiningHeight(foot.x,foot.z,1.1),joiningHeight(foot.x+d.dx*2,foot.z+d.dz*2,1.25));steps=Math.max(1,Math.ceil(Math.max(0,s.base+.03-bottom)/.19));const next=Math.max(length,.72+steps*.3);if(next-length<.01)break;length=next;}
        foot={x:d.face.x+d.dx*length,z:d.face.z+d.dz*length};bottom=Math.max(joiningHeight(foot.x,foot.z,1.1),joiningHeight(foot.x+d.dx*2,foot.z+d.dz*2,1.25));
        if(bottom>s.base+.03||!lineClear(d.face,foot,s))continue;
        const ci=Math.round((foot.x-xmin)/step),cj=Math.round((foot.z-zmin)/step);
        for(let di=-3;di<=3;di++)for(let dj=-3;dj<=3;dj++){
          const i=ci+di,j=cj+dj,n=j*nx+i;if(i<0||j<0||i>=nx||j>=nz||!Number.isFinite(cost[n]))continue;
          const q={x:X(n),z:Z(n)},distance=Math.hypot(foot.x-q.x,foot.z-q.z);const approach={x:foot.x+d.dx*2,z:foot.z+d.dz*2};if(distance>10||Math.hypot(q.x-approach.x,q.z-approach.z)<1.5||(q.x-foot.x)*d.dx+(q.z-foot.z)*d.dz<2.05||!lineClear(foot,approach)||!lineClear(approach,q))continue;
          options.push({...d,approach,foot,bottom,top:s.base+.03,steps:Math.max(1,Math.ceil((s.base+.03-bottom)/.19)),node:n,score:cost[n]+distance+Math.hypot(q.x-approach.x,q.z-approach.z)*6+steps*8});
        }
      }
      options.sort((a,b)=>a.score-b.score);
      const e=options[0];if(!e){s.accessFailure='no clear founded threshold';continue;}
      doorLinks.push({s,e});   // (its stairs are built once the lanes exist: see below)
      let n=e.node;while(prev[n]>=0){addEdge(n,prev[n]);n=prev[n];}roots.add(n);
      routes.push({site:s.id,settlement:group,root:{...anchor.get(n)},nodes:[e.node],reachesRoad:true});
    }
    // Shared cells have one elevation, so every local junction meets physically.
    for(const n of roots){const p=anchor.get(n);if(p)height[n]=Math.max(height[n],p.y);}
    let publicCenter=null;
    if(group.startsWith('village-')){
      const index=Number(group.split('-')[1]),v=villages[index],nearNodes=[...used.keys()].sort((a,b)=>Math.hypot(X(a)-v.x,Z(a)-v.z)-Math.hypot(X(b)-v.x,Z(b)-v.z));
      let selected=null;
      for(const n of nearNodes){for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){const x=X(n)+dx*6,z=Z(n)+dz*6;if(obstacles.some(s=>siteBox(s,x,z,4)))continue;if([...used].some(([q,nb])=>[...nb].some(r=>{const ax=X(q),az=Z(q),dx=X(r)-ax,dz=Z(r)-az,u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));return Math.hypot(x-ax-dx*u,z-az-dz*u)<4.8;})))continue;if(allCandidates.some(p=>Math.hypot(p.x-x,p.z-z)<6))continue;selected={x,z,n,dx,dz};break;}if(selected)break;}
      if(selected)publicCenter={selected,index};
    }
    const junctionNodes=new Set([...roots,...doorLinks.map(({e})=>e.node),...(publicCenter?[publicCenter.selected.n]:[])]);
    const done=new Set(),edgeKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
    const draw=path=>{const p=[],h=[],main=path.every(n=>spine.has(n)&&clear(X(n),Z(n),1.4));
      for(let k=0;k<path.length;k++){const n=path[k];p.push([X(n),Z(n)]);h.push(height[n]);if(k===0||k===path.length-2){const m=path[k+1],dx=X(m)-X(n),dz=Z(m)-Z(n),len=Math.hypot(dx,dz),landing=Math.min(2.3,len*.46);if(k===0){p.push([X(n)+dx/len*landing,Z(n)+dz/len*landing]);h.push(height[n]);}if(k===path.length-2){p.push([X(m)-dx/len*landing,Z(m)-dz/len*landing]);h.push(height[m]);}}}
      road(p,main?1.18:hw,0,{heights:h,kerbs:false,kind:main?'village-lane':'local-lane',lamps:false});};
    for(const [n,nb]of used){if(nb.size===2&&!junctionNodes.has(n))continue;for(const m of nb){if(done.has(edgeKey(n,m)))continue;const path=[n];let a=n,b=m;for(;;){path.push(b);done.add(edgeKey(a,b));const next=used.get(b);if(next.size!==2||junctionNodes.has(b))break;const c=[...next].find(q=>q!==a);if(done.has(edgeKey(b,c)))break;a=b;b=c;}draw(path);}}
    for(const n of roots){const p=anchor.get(n);if(p&&Math.hypot(X(n)-p.x,Z(n)-p.z)>.05)road([[p.x,p.z],[X(n),Z(n)]],hw,0,{heights:[p.y,height[n]],kerbs:false,kind:'road-junction',lamps:false});}
    // An entrance's foot meets whatever lane of this settlement passes within reach of it at that
    // lane's own surface (the lanes are drawn now); founding it on the terrain beside a lane on
    // an embankment left the walk's last metre under the lane's paving. Then the stairs.
    const laneRecords=allRoads.filter(r=>r.settlement===group&&(r.kind==='local-lane'||r.kind==='village-lane'||r.kind==='road-junction'));
    const laneNear=(e)=>{let best=null;
      for(const r of laneRecords)for(let k=1;k<r.points.length;k++){const a=r.points[k-1],b=r.points[k],dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz||1;
        for(const q of [e.foot,e.approach]){const t=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.z-a.z)*dz)/L2)),d=Math.hypot(q.x-a.x-dx*t,q.z-a.z-dz*t);
          if(d<r.halfWidth+hw+.35&&(!best||d<best.d))best={d,y:a.y+(b.y-a.y)*t};}}
      return best;};
    for(const {s,e}of doorLinks){
      const best=laneNear(e);
      // (only ever raised: a lane above the walk is what buries its end; lowering would add treads to a fixed run)
      if(best&&best.y>e.bottom+.12&&best.y<e.top-.02){e.bottom=best.y;e.steps=Math.max(1,Math.ceil((e.top-e.bottom)/.19));}
      stairs(s,e);
    }
    for(const {s,e}of doorLinks){const node={x:X(e.node),z:Z(e.node)},dx=e.approach.x-node.x,dz=e.approach.z-node.z,len=Math.hypot(dx,dz),landing=Math.min(2.3,len*.46),first=[node.x+dx/(len||1)*landing,node.z+dz/(len||1)*landing],middle=resample([first,[e.approach.x,e.approach.z]],1),walk=[[node.x,node.z],...middle,[e.foot.x,e.foot.z]],heights=[height[e.node],...middle.map((p,k)=>Math.max(height[e.node]+(e.bottom-height[e.node])*k/(middle.length-1),joiningHeight(...p,hw))),e.bottom];heights[1]=height[e.node];heights[heights.length-2]=e.bottom;const n0=[-dz/(len||1),dx/(len||1)],n1=[e.dz,-e.dx],den=1+n0[0]*n1[0]+n0[1]*n1[1],miter=[(n0[0]+n1[0])/den,(n0[1]+n1[1])/den],normals=walk.map((p,k)=>{if(k===walk.length-1)return n1;const u=Math.min(1,Math.hypot(p[0]-node.x,p[1]-node.z)/(len||1));return n0.map((v,j)=>v+(miter[j]-v)*u);});road(walk,hw,0,{heights,normals,kerbs:false,kind:'door-walk',lamps:false});
      if(s.gate){const d=s.door;road([[e.face.x,e.face.z],[s.x+s.gate.dx*19,s.z+s.gate.dz*19],[d.x,d.z]],1.1,0,{heights:[s.base+.04,s.base+.04,s.base+.04],kerbs:false,kind:'summit-court',lamps:false});}
    }
    // A small public court off the shared village lane.
    if(publicCenter){const {selected,index}=publicCenter;
      if(selected){const {x,z,n,dx,dz}=selected,C=chunk(x,z),y=routeHeight(x,z,3),g=renderedHeight(x,z),variant=index%3;
        C.stone.box(x,z,1,0,3,2.5,g-1,y,1,g);occupy(x,z,5);
        const reach=dx?2.8:2.3;road([[X(n),Z(n)],[X(n)+dx*1.4,Z(n)+dz*1.4],[x-dx*reach,z-dz*reach]],hw,0,{heights:[height[n],height[n],y],kerbs:false,kind:'village-square',lamps:false});
        if(variant===0){for(const px of [-1.8,1.8])C.stone.box(x+px,z,1,0,.9,1.6,y-.04,y+.65,1,y);C.stone.box(x,z,1,0,.25,.25,y,y+2.3,1,y);C.arch.box(x,z,1,0,.37,.37,y+2.3,y+2.8,2,y);}
        else {for(const a of [-1,1])for(const b of [-1,1])C.arch.box(x+a*2.25,z+b*1.65,1,0,.13,.13,y,y+2.8,8,y);C.arch.box(x,z,1,0,2.6,2,y+2.8,y+3.04,11,y);if(variant===1)C.stone.box(x,z+1.4,1,0,1.6,.38,y,y+.65,1,y);else C.arch.box(x,z+1.3,1,0,1.8,.6,y+.05,y+.85,8,y);}
        villageCenters.push({x,z,y,variant,settlement:group});
      }
    }
  }
  settlement=null;

  // ----------------------------------------------- fields, terraces, vineyards, orchards --
  const accessCells=new Map(),accessCell=256;
  for(const r of allRoads)for(const p of r.points){const key=`${Math.floor(p.x/accessCell)},${Math.floor(p.z/accessCell)}`;if(!accessCells.has(key))accessCells.set(key,[]);accessCells.get(key).push(p);}
  const fieldAccess=(x,z)=>{let best=null;const i=Math.floor(x/accessCell),j=Math.floor(z/accessCell);for(let a=-3;a<=3;a++)for(let b=-3;b<=3;b++)for(const p of accessCells.get(`${i+a},${j+b}`)||[]){const d=Math.hypot(p.x-x,p.z-z);if(!best||d<best.d)best={...p,d};}return best;};
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
    const record={x,z,ax,az,hl,hw,kind,sl};fieldSites.push(record);
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
    const gates=[[-hl-.8,0,-ax,-az,sx,sz],[hl+.8,0,ax,az,sx,sz],[0,-hw-.8,-sx,-sz,ax,az],[0,hw+.8,sx,sz,ax,az]].map(([u,v,dx,dz,tx,tz])=>{const [px,pz]=P(u,v),road=fieldAccess(px,pz);return{x:px,z:pz,dx,dz,tx,tz,road,score:road?.d??1e9};}).sort((a,b)=>a.score-b.score);
    const gate=gates[0];record.gate=gate;record.gateWidth=4.2;
    const gateHeadland=(p0,p1,draw)=>{
      const local=p=>[(p[0]-gate.x)*gate.tx+(p[1]-gate.z)*gate.tz,-(p[0]-gate.x)*gate.dx-(p[1]-gate.z)*gate.dz],a=local(p0),b=local(p1);let lo=0,hi=1;
      for(let axis=0;axis<2;axis++){const d=b[axis]-a[axis],min=axis?-.5:-2.7,max=axis?8.5:2.7;if(Math.abs(d)<1e-8){if(a[axis]<min||a[axis]>max){draw(p0,p1);return;}}else{let l=(min-a[axis])/d,h=(max-a[axis])/d;if(l>h)[l,h]=[h,l];lo=Math.max(lo,l);hi=Math.min(hi,h);}}
      if(lo>=hi){draw(p0,p1);return;}
      for(const [u,v]of [[0,lo],[hi,1]])if(v-u>.001)draw([p0[0]+(p1[0]-p0[0])*u,p0[1]+(p1[1]-p0[1])*u],[p0[0]+(p1[0]-p0[0])*v,p0[1]+(p1[1]-p0[1])*v]);
    };
    const along = (v, fn) => { for (let a = 0; a < nu; a++) { const p0 = P(-hl + (2 * hl * a) / nu, v), p1 = P(-hl + (2 * hl * (a + 1)) / nu, v); fn(p0, p1, a); } };
    const acrs = (u, fn) => { for (let b = 0; b < nv; b++) { const p0 = P(u, -hw + (2 * hw * b) / nv), p1 = P(u, -hw + (2 * hw * (b + 1)) / nv); fn(p0, p1); } };
    const D = C.detail;
    // boundary: dry-stone walls on the terraced slopes, hedgerows on the gentle ground
    const hedge = sl < 0.12 && rnd() < 0.6;
    const closedBound = (p0, p1) => {
      const g0 = renderedHeight(p0[0], p0[1]), g1 = renderedHeight(p1[0], p1[1]);
      // corner segments keep their end caps; the runs between abut and bury their feet
      const mid = Math.hypot(p0[0] - x, p0[1] - z) < Math.hypot(hl, hw) - 6 && Math.hypot(p1[0] - x, p1[1] - z) < Math.hypot(hl, hw) - 6;
      if (hedge) D.wall(p0[0], p0[1], g0 - 0.4, g0 + 1.7, p1[0], p1[1], g1 - 0.4, g1 + 1.7, 1.1, 3, mid);
      else D.wall(p0[0], p0[1], g0 - 0.4, g0 + 1.0, p1[0], p1[1], g1 - 0.4, g1 + 1.0, 0.55, 1, mid);
    };
    const bound=(p0,p1)=>{const dx=p1[0]-p0[0],dz=p1[1]-p0[1],length=Math.hypot(dx,dz),u=((gate.x-p0[0])*dx+(gate.z-p0[1])*dz)/(length*length),distance=Math.abs((gate.x-p0[0])*dz-(gate.z-p0[1])*dx)/length;if(distance>.05||u+2.1/length<0||u-2.1/length>1){closedBound(p0,p1);return;}for(const [a,b]of [[0,Math.max(0,u-2.1/length)],[Math.min(1,u+2.1/length),1]])if(b-a>.001)closedBound([p0[0]+dx*a,p0[1]+dz*a],[p0[0]+dx*b,p0[1]+dz*b]);};
    along(-hw - 0.8, bound); along(hw + 0.8, bound); acrs(-hl - 0.8, bound); acrs(hl + 0.8, bound);
    // Open timber leaves stand back into the headland, leaving a real cart-width
    // gap. The field meets walkable meadow outside; it does not need a paved
    // road through every crop or a grid of tracks over the open hills.
    for(const sign of [-1,1]){
      const px=gate.x+gate.tx*sign*2.2,pz=gate.z+gate.tz*sign*2.2,g=renderedHeight(px,pz);
      D.box(px,pz,gate.tx,gate.tz,.18,.18,g-.6,g+1.5,1,g);
      const lx=-gate.dx*.985-gate.tx*sign*.174,lz=-gate.dz*.985-gate.tz*sign*.174;
      D.box(px+lx,pz+lz,lx,lz,1.0,.07,g+.35,g+1.18,8,g);
    }
    // terraces: retaining walls along the contour, one per ~1.6 m of fall
    if (sl > 0.1) {
      const step = Math.max(8, Math.min(22, 1.8 / sl));
      for (let v = -hw + step; v < hw - 2; v += step) along(v, (a,b) => gateHeadland(a,b,(p0, p1) => {
        const g0 = renderedHeight(p0[0], p0[1]), g1 = renderedHeight(p1[0], p1[1]);
        D.wall(p0[0], p0[1], g0 - 0.5, g0 + 0.8, p1[0], p1[1], g1 - 0.5, g1 + 0.8, 0.5, 1);
      }));
    }
    if (kind === 5) {
      // vine rows on the contour
      for (let v = -hw + 2; v < hw - 1; v += 3.2) along(v, (p0,p1) => gateHeadland(p0,p1,(p0, p1) => {
        const g0 = renderedHeight(p0[0], p0[1]), g1 = renderedHeight(p1[0], p1[1]);
        D.wall(p0[0], p0[1], g0 - 0.2, g0 + 1.4, p1[0], p1[1], g1 - 0.2, g1 + 1.4, 0.6, 3);
      }));
    } else if (kind === 6) {
      // orchard trees: trunk and clipped crown, in rows
      for (let v = -hw + 4; v < hw - 3; v += 8) for (let u = -hl + 4; u < hl - 3; u += 8) {
        const [px, pz] = P(u + (rnd() - 0.5) * 1.2, v), g = renderedHeight(px, pz);
        const gx=px-gate.x,gz=pz-gate.z;
        if(Math.abs(gx*gate.tx+gz*gate.tz)<3.8&&-(gx*gate.dx+gz*gate.dz)<8.5)continue;
        D.box(px, pz, ax, az, 0.22, 0.22, g - 0.4, g + 1.5, 8, g);
        D.box(px, pz, ax, az, 1.6, 1.6, g + 1.4, g + 3.8, 3, g);
        orchardTrees.push({x:px,z:pz,ang:Math.atan2(az,ax),halfWidth:1.6,bottom:g+1.4,top:g+3.8});
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
      // the rows stand proud: a bump across them (ridges and furrows), faded with the pixel footprint
      normal: /* glsl */ `
{
  float hk = floor(vHC.z + 0.5);
  float per = hk < 0.5 ? 0.0 : hk < 1.5 ? 1.1 : hk < 2.5 ? 0.9 : hk < 3.5 ? 1.8 : hk < 4.5 ? 0.8 : hk < 5.5 ? 2.6 : hk < 6.5 ? 7.0 : 0.0;
  if (per > 0.0) {
    float fw = max(fwidth(vHC.y), 1e-4);
    float amp = (hk > 2.5 && hk < 3.5 ? 0.45 : hk > 4.5 && hk < 5.5 ? 0.5 : 0.2) * clamp(1.0 - 2.0 * fw / per, 0.0, 1.0);
    float dh = -amp * 3.14159 / per * sin(6.2832 * vHC.y / per);
    vec3 dpx = dFdx(vWPos), dpy = dFdy(vWPos);
    float dvx = dFdx(vHC.y), dvy = dFdy(vHC.y);
    vec3 Nw = normalize(vWNrm);
    vec3 r1 = cross(dpy, Nw), r2 = cross(Nw, dpx);
    float det = dot(dpx, r1);
    if (abs(det) > 1e-10 && amp > 0.0) {
      vec3 gv = (dvx * r1 + dvy * r2) / det;
      vec3 nb = Nw - gv * dh;
      if (dot(nb, nb) > 1e-8) normal = normalize((viewMatrix * vec4(normalize(nb), 0.0)).xyz);
    }
  }
}`,
    },
  });
  // Surveyed crossing landings are shared by both the older carriageway and
  // its new lane. Raise and grade the two approaches together before emitting
  // either material bed; a later overlay must never become a wall in the road.
  const crossingPads=[];
  for(const r of allRoads)if(r.kind==='road-junction'||r.kind==='summit-trail'){
    const p=r.points[0];if(crossingPads.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<2))continue;
    let y=routeHeight(p.x,p.z,5.2);
    for(const near of closeRoads(p.x,p.z,6))y=Math.max(y,near.y+.14);
    crossingPads.push({x:p.x,z:p.z,y});
  }
  // Detect actual crossing alignments, including a private approach that
  // meets a different shared lane before its originally chosen graph node.
  // Unequal beds receive one common landing and graded approaches on both.
  const crossingSegments=[],crossingCells=new Map(),cellSize=24;
  for(const r of allRoads)if(r.kind!=='summit-court')for(let k=1;k<r.points.length;k++){
    const a=r.points[k-1],b=r.points[k],id=crossingSegments.length;
    crossingSegments.push({a,b,r,k});
    for(let i=Math.floor((Math.min(a.x,b.x)-r.halfWidth-.3)/cellSize);i<=Math.floor((Math.max(a.x,b.x)+r.halfWidth+.3)/cellSize);i++)for(let j=Math.floor((Math.min(a.z,b.z)-r.halfWidth-.3)/cellSize);j<=Math.floor((Math.max(a.z,b.z)+r.halfWidth+.3)/cellSize);j++){const key=`${i},${j}`;if(!crossingCells.has(key))crossingCells.set(key,[]);crossingCells.get(key).push(id);}
  }
  for(const [bucket,ids] of crossingCells)for(let u=0;u<ids.length;u++)for(let v=u+1;v<ids.length;v++){
    const ai=ids[u],bi=ids[v],A=crossingSegments[ai],B=crossingSegments[bi];const firstBucket=`${Math.max(Math.floor((Math.min(A.a.x,A.b.x)-A.r.halfWidth-.3)/cellSize),Math.floor((Math.min(B.a.x,B.b.x)-B.r.halfWidth-.3)/cellSize))},${Math.max(Math.floor((Math.min(A.a.z,A.b.z)-A.r.halfWidth-.3)/cellSize),Math.floor((Math.min(B.a.z,B.b.z)-B.r.halfWidth-.3)/cellSize))}`;if(bucket!==firstBucket)continue;
    if(A.r===B.r&&Math.abs(A.k-B.k)<10)continue;
    for(const [C,D]of [[A,B],[B,A]])for(const u of [0,.5,1]){
      const x=C.a.x+(C.b.x-C.a.x)*u,z=C.a.z+(C.b.z-C.a.z)*u,y=C.a.y+(C.b.y-C.a.y)*u,dx=D.b.x-D.a.x,dz=D.b.z-D.a.z,v=Math.max(0,Math.min(1,((x-D.a.x)*dx+(z-D.a.z)*dz)/(dx*dx+dz*dz||1))),px=D.a.x+dx*v,pz=D.a.z+dz*v,py=D.a.y+(D.b.y-D.a.y)*v;
      if(Math.hypot(x-px,z-pz)>C.r.halfWidth+D.r.halfWidth-.1||Math.abs(y-py)<.22)continue;
      const q={x:(x+px)/2,z:(z+pz)/2,y:Math.max(y,py)+.1},existing=crossingPads.find(p=>Math.hypot(q.x-p.x,q.z-p.z)<2);
      if(existing)existing.y=Math.max(existing.y,q.y);else crossingPads.push(q);
    }
  }
  for(const p of crossingPads)p.y=Math.max(p.y,routeHeight(p.x,p.z,4.6));
  const padCells=new Map();for(const p of crossingPads){const key=`${Math.floor(p.x/40)},${Math.floor(p.z/40)}`;if(!padCells.has(key))padCells.set(key,[]);padCells.get(key).push(p);}
  const padHeight=p=>{let y=p.y;const i=Math.floor(p.x/40),j=Math.floor(p.z/40);for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(const q of padCells.get(`${i+a},${j+b}`)||[]){const d=Math.hypot(p.x-q.x,p.z-q.z);if(d<8){const w=Math.max(0,Math.min(1,(8-d)/4.8)),blend=w*w*(3-2*w);y=Math.max(y,p.y+Math.max(0,q.y-p.y)*blend);}}return y;};
  const nearCrossing=(x,z)=>{const i=Math.floor(x/40),j=Math.floor(z/40);for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)if((padCells.get(`${i+a},${j+b}`)||[]).some(p=>Math.hypot(p.x-x,p.z-z)<8))return true;return false;};
  crossingSurface=padHeight;
  for(const r of allRoads){
    if(r.kind==='summit-court')continue;
    const fine=[];for(let k=1;k<r.points.length;k++){const a=r.points[k-1],b=r.points[k],touch=nearCrossing((a.x+b.x)/2,(a.z+b.z)/2),steps=touch?Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/.7)):1;for(let j=0;j<steps;j++){const u=j/steps,p={};for(const key of ['x','y','z','sx','sz','g0','gl','gr'])p[key]=a[key]+(b[key]-a[key])*u;p.originalY=p.y;p.shared=touch&&padHeight(p)>p.y+.01;fine.push(p);}}fine.push({...r.points.at(-1),originalY:r.points.at(-1).y,shared:fine.at(-1)?.shared});r.points.splice(0,r.points.length,...fine);
    if(r.kind==='door-walk'||r.kind==='village-square'){
      const S=r.points,delta=padHeight(S[0])-S[0].y,lengths=[0];for(let k=1;k<S.length;k++)lengths.push(lengths.at(-1)+Math.hypot(S[k].x-S[k-1].x,S[k].z-S[k-1].z));
      for(let k=0;k<S.length;k++){const endDistance=lengths.at(-1)-lengths[k],blend=Math.max(0,Math.min(1,endDistance/Math.max(.01,lengths.at(-1)-1.4)));S[k].padBlend=Math.min(1,endDistance/2);S[k].y=Math.max(S[k].y+delta*blend,S[k].y+(padHeight(S[k])-S[k].y)*S[k].padBlend);}
    }else for(const p of r.points)p.y=padHeight(p);
  }
  for(const draw of roadDraws)draw();
  // the end lamp posts, clear of every carriageway (crossingCells indexes all road segments)
  for(const lp of endPosts){
    let clear=true;const i0=Math.floor((lp.x-4)/cellSize),i1=Math.floor((lp.x+4)/cellSize),j0=Math.floor((lp.z-4)/cellSize),j1=Math.floor((lp.z+4)/cellSize);
    for(let i=i0;i<=i1&&clear;i++)for(let j=j0;j<=j1&&clear;j++)for(const id of crossingCells.get(`${i},${j}`)||[]){const {a,b,r}=crossingSegments[id],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((lp.x-a.x)*dx+(lp.z-a.z)*dz)/(dx*dx+dz*dz||1)));if(Math.hypot(lp.x-a.x-dx*t,lp.z-a.z-dz*t)<r.halfWidth+.5){clear=false;break;}}
    if(!clear)continue;
    const prior=activeRoute;activeRoute=lp.route;
    const g=renderedHeight(lp.x,lp.z);
    chunk(lp.x,lp.z).arch.box(lp.x,lp.z,1,0,0.14,0.14,g-0.4,g+4.2,10,g);
    chunk(lp.x,lp.z).arch.box(lp.x,lp.z,1,0,0.3,0.3,g+4.2,g+4.7,2,g);
    lamps.push([lp.x,g+4.45,lp.z]);
    activeRoute=prior;
  }
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
    // the lagoon's reflection pass draws the coarse land: the countryside is for the main view
    for (const m of [arch, stone, detail, drape]) if (m) m.layers.set(1);
    if (arch) tris += arch.geometry.index.count / 3;
    if (stone) tris += stone.geometry.index.count / 3;
    if (detail) detailTris += detail.geometry.index.count / 3;
    if (drape) tris += drape.geometry.attributes.position.count / 3;
    lod.push({ arch, stone, detail, drape, x: C.cx, z: C.cz });
    // the builders' plain-array vertex streams are copied into the meshes above; the returned
    // api's closures keep this scope alive, so drop them (they held over a gigabyte of heap)
    C.arch = C.stone = C.detail = C.drape = null;
  }
  chunks.clear();
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

  // Beyond a few kilometres a hill house's shadow is below a texel of the far cascade;
  // chunks past this (nearest edge) stay out of the shadow pass.
  let detailR = 5000, farR = 28000;
  const shadowR = 8000;
  const api = {
    lod, villages, shrines, farms, buildingSites, fieldSites, roads:allRoads, entrances, routes, villageCenters, orchardTrees, lamps, tris, detailTris, houses, fields, roadLen, isFree: (x, z, r) => free(x, z, r),
    applyQuality(s) { const q = Math.max(0.4, Math.min(1, s.lowrise ?? 1)); detailR = 5000 * q; farR = 28000 * (0.7 + 0.3 * q); },
    update(dt, t, camera) {
      if (!camera) return;
      const p = camera.position;
      for (const L of lod) {
        const d = Math.hypot(L.x - p.x, L.z - p.z) - CH * 0.71;
        if (L.arch) { L.arch.visible = d < farR; L.arch.castShadow = d < shadowR; }
        if (L.stone) { L.stone.visible = d < farR; L.stone.castShadow = d < shadowR; }
        if (L.drape) L.drape.visible = d < farR;
        if (L.detail) L.detail.visible = d < detailR;
      }
      // lamps come up at dusk, steadily
      lampMat.opacity = Math.min(1, Math.max(0, (U.uCityLights?.value ?? 0)));
    },
  };
  return api;
}
