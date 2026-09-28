import * as THREE from 'three';
import { GATE, SKYPORT } from '../world/layout.js';
import { latticeRadius } from '../world/axis.js';

const CELL = 8;              // structure grid cell (m)
const CH = 64;               // cells per chunk side (512 m chunks, allocated only where something stands)
const BUCKET = 400;          // collider bucket size (m)
const BUCKET_PAD = 64;       // largest pad a bucketed query may use; larger pads scan every collider
const EMPTY = -1e4;
const NONE = [];

/**
 * Collision model shared by free flight and the cinematic path planner.
 *
 *  - `world.colliders`: vertical cylinders {x, z, y0, y1, radius | radius(y)} from the world build
 *    (towers and ward crowns, the Axis core, bridge pylons, transit islands and portals).
 *    Optional sphere colliders {x, y, z, r, sphere:true}. Bucketed on a 400 m grid so a query
 *    only tests the cylinders near it.
 *  - extra cylinders for structures that move or are open-framed (Gate arches, the skyport
 *    disc, floating gardens).
 *  - a sparse "structure grid" (8 m cells, 512 m chunks) over the whole metropolis, rasterized
 *    from the triangles of every static architectural mesh (low-rises of the inner towns and the
 *    Outer Wards, ward landmarks and platforms, bridges and stations, transit, rim forecourts,
 *    promenades, the outer cities and massif towns): per cell the highest and lowest surface,
 *    so the camera can neither sink into roofs nor fly through blocks, yet still pass under decks.
 *  - planner-only obstacles (the Axis lattice) that free flight may enter but tours should avoid.
 */
export class CollisionModel {
  constructor(world) {
    this.world = world;
    this.ground = (x, z) => world.groundHeight(x, z);
    this.extra = [];
    this.plannerOnly = [];
    this.cell = CELL;
    this.chunks = new Map();     // key -> Float32Array(CH*CH*2): [top, low] per cell
    this._buckets = null;
    this._nCol = -1;
    try { this._buildExtra(); } catch (e) { /* optional structures missing */ }
    this._pi = this._pj = 1e9; this._pc = null;
    // the grid rasterizes millions of triangles: build it in ~8 ms slices between frames
    this.ready = false;
    const job = this._buildGrid();
    const step = () => {
      const t = performance.now();
      try {
        while (performance.now() - t < 8) if (job.next().done) { this.ready = true; break; }
      } catch (e) { console.error('collision grid', e); return; }
      this.workMs = (this.workMs || 0) + performance.now() - t;
      if (this.ready) return;
      setTimeout(step, 0);
    };
    step();
  }

  get colliders() { return this.world.colliders; }

  _buildExtra() {
    const E = this.extra;
    // Gate of Concord: two leaning catenary arches, sampled as short cylinders
    {
      const { span, height } = GATE;
      const half = span / 2, k = 2.2;
      for (const lean of [-0.2, 0.2]) {
        for (let i = 0; i <= 96; i++) {
          const u = i / 96;
          const x = -half + span * u;
          const y = height * (Math.cosh(k) - Math.cosh(k * (x / half))) / (Math.cosh(k) - 1);
          const r = 16 + 26 * Math.pow(Math.abs(u - 0.5) * 2, 1.6);
          const yy = y * Math.cos(lean) - 8;
          E.push({ x: GATE.x + x, z: GATE.z + Math.sin(lean) * y, y0: yy - r - 14, y1: yy + r + 14, radius: r + 6 });
        }
      }
      for (const sx of [-1, 1]) E.push({ x: GATE.x + sx * half, z: GATE.z, y0: -20, y1: 40, radius: 100 });
    }
    // Skyport: treat the landing disc as solid
    E.push({ x: SKYPORT.x, z: SKYPORT.z, y0: SKYPORT.y - 45, y1: SKYPORT.y + 90, radius: SKYPORT.r + 40 });
    // floating gardens (their positions bob slightly; the margin covers it)
    const fl = this.world.floating;
    if (fl && fl.islands) {
      for (const i of fl.islands) {
        const d = i.def;
        E.push({ x: d.x, z: d.z, y0: d.y - (i.depth || d.r * 2) - 12, y1: d.y + 45, radius: d.r * 1.02 + 8 });
      }
    }
    // Axis lattice shell: tours keep clear of the struts
    this.plannerOnly.push({ x: 0, z: 0, y0: 520, y1: 2900, radius: (y) => latticeRadius(y) + 45 });
    this.plannerOnly.push({ x: 0, z: 0, y0: 2900, y1: 3300, radius: 330 });
  }

  _chunk(ci, cj, make) {
    const key = (ci + 4096) * 8192 + (cj + 4096);
    let c = this.chunks.get(key);
    if (!c && make) {
      c = new Int16Array(CH * CH * 2);     // heights in quarter metres (+-8 km), 16 KB a chunk
      for (let k = 0; k < c.length; k += 2) { c[k] = -32768; c[k + 1] = 32767; }
      this.chunks.set(key, c);
    }
    return c;
  }

  /** Record a surface at height y in cell (i, j). */
  _put(i, j, y) {
    const ci = Math.floor(i / CH), cj = Math.floor(j / CH);
    let c = this._pc;
    if (ci !== this._pi || cj !== this._pj) { c = this._pc = this._chunk(ci, cj, true); this._pi = ci; this._pj = cj; }
    const k = ((j - cj * CH) * CH + (i - ci * CH)) * 2;
    const hi = Math.min(Math.ceil(y * 4), 32766), lo = Math.max(Math.floor(y * 4), -32767);
    if (hi > c[k]) c[k] = hi;
    if (lo < c[k + 1]) c[k + 1] = lo;
  }

  /** Top and lowest surface of the cell containing (x, z), or null. */
  _cell(x, z) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    const ci = Math.floor(i / CH), cj = Math.floor(j / CH);
    const c = this._chunk(ci, cj, false);
    if (!c) return -1;
    const k = ((j - cj * CH) * CH + (i - ci * CH)) * 2;
    if (c[k] === -32768) return -1;
    this._c = c;
    return k;
  }

  /** Rasterize one world-space triangle: its edges (walls) and, when it has plan area, its interior. */
  _tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
    // most triangles are small: all three corners in one cell
    const ia = Math.floor(ax / CELL), ja = Math.floor(az / CELL);
    if (Math.floor(bx / CELL) === ia && Math.floor(cx / CELL) === ia && Math.floor(bz / CELL) === ja && Math.floor(cz / CELL) === ja) {
      this._put(ia, ja, Math.max(ay, by, cy));
      this._put(ia, ja, Math.min(ay, by, cy));
      return;
    }
    const edge = (px, py, pz, qx, qy, qz) => {
      const n = Math.ceil(Math.hypot(qx - px, qz - pz) / (CELL * 0.5));
      for (let s = 0; s <= n; s++) {
        const t = n ? s / n : 0;
        this._put(Math.floor((px + (qx - px) * t) / CELL), Math.floor((pz + (qz - pz) * t) / CELL), py + (qy - py) * t);
      }
      if (!n) this._put(Math.floor(qx / CELL), Math.floor(qz / CELL), qy);
    };
    edge(ax, ay, az, bx, by, bz);
    edge(bx, by, bz, cx, cy, cz);
    edge(cx, cy, cz, ax, ay, az);
    const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    const i0 = Math.floor(Math.min(ax, bx, cx) / CELL), i1 = Math.floor(Math.max(ax, bx, cx) / CELL);
    const j0 = Math.floor(Math.min(az, bz, cz) / CELL), j1 = Math.floor(Math.max(az, bz, cz) / CELL);
    if (i1 - i0 < 2 || j1 - j0 < 2 || Math.abs(area) < CELL * CELL) return;   // the edges covered it
    const inv = 1 / area;
    for (let j = j0 + 1; j < j1; j++) {
      const pz = (j + 0.5) * CELL;
      for (let i = i0 + 1; i < i1; i++) {
        const px = (i + 0.5) * CELL;
        const w0 = ((cx - bx) * (pz - bz) - (cz - bz) * (px - bx)) * inv;
        const w1 = ((ax - cx) * (pz - cz) - (az - cz) * (px - cx)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) this._put(i, j, w0 * ay + w1 * by + w2 * cy);
      }
    }
  }

  *_buildGrid() {
    const w = this.world;
    const solids = (w.clearance && w.clearance.solids) || [];
    // cylinders already stand for these (towers, crowns, the Axis) or they are open frames (the Gate)
    const skip = new Set();
    for (const t of w.towers || []) if (t.mesh) skip.add(t.mesh);
    if (w.axis && w.axis.group) w.axis.group.traverse((o) => skip.add(o));
    const M = new THREE.Matrix4(), IM = new THREE.Matrix4(), v = new THREE.Vector3();
    const t0 = performance.now();
    let tris = 0;
    yield;
    for (const o of solids) {
      if (skip.has(o) || o.userData.noCollide || o.name === 'Gate of Concord') continue;
      const g = o.geometry, pos = g.attributes.position;
      const idx = g.index ? g.index.array : null;
      const nInst = o.isInstancedMesh ? (o.userData.fullCount || o.count) : 1;
      const W = new Float32Array(pos.count * 3);
      const nt = idx ? idx.length / 3 : pos.count / 3;
      for (let k = 0; k < nInst; k++) {
        M.copy(o.matrixWorld);
        if (o.isInstancedMesh) { o.getMatrixAt(k, IM); M.multiply(IM); }
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(M);
          W[i * 3] = v.x; W[i * 3 + 1] = v.y; W[i * 3 + 2] = v.z;
        }
        tris += nt;
        for (let t = 0; t < nt; t++) {
          const a = (idx ? idx[t * 3] : t * 3) * 3, b = (idx ? idx[t * 3 + 1] : t * 3 + 1) * 3, c = (idx ? idx[t * 3 + 2] : t * 3 + 2) * 3;
          if (!(W[a] === W[a] && W[b] === W[b] && W[c] === W[c])) continue;   // NaN guard
          this._tri(W[a], W[a + 1], W[a + 2], W[b], W[b + 1], W[b + 2], W[c], W[c + 1], W[c + 2]);
          if ((t & 4095) === 4095) yield;
        }
        yield;
      }
    }
    this.stats = { tris, chunks: this.chunks.size, wallMs: Math.round(performance.now() - t0) };
  }

  /** Top of structures in the grid cell containing (x, z), or -1e4. */
  structureTop(x, z) {
    const k = this._cell(x, z);
    return k < 0 ? EMPTY : this._c[k] * 0.25 + 1;
  }

  /** Underside of an elevated structure (deck, bridge, canopy) in the cell, or -1e4 when it stands on the ground. */
  structureBottom(x, z) {
    const k = this._cell(x, z);
    if (k < 0) return EMPTY;
    const low = this._c[k + 1] * 0.25;
    return low > Math.max(this.ground(x, z), 0) + 6 ? low - 1 : -1e3;
  }

  /** True if a point at height y is inside a grid structure. */
  inStructure(x, z, y, pad = 1.5) {
    const t = this.structureTop(x, z);
    if (t < -9000 || y > t + pad) return false;
    const b = this.structureBottom(x, z);
    return !(b > -900 && y < b - pad);
  }

  /** Height of the surface below (terrain, water, or a roof the point is above). */
  floor(x, z, y = 1e9) {
    const g = Math.max(this.ground(x, z), 0);
    const t = this.structureTop(x, z);
    if (t > g && y >= t - 3) return t;
    return g;
  }

  /** Conservative floor for planning: the highest surface in the cell. */
  planFloor(x, z) {
    return Math.max(this.ground(x, z), 0, this.structureTop(x, z));
  }

  static radiusOf(c, y) { return typeof c.radius === 'function' ? c.radius(y) : c.radius; }

  /** Bucket the world's cylinders (rebuilt whenever the list grows). */
  _index() {
    const list = this.world.colliders;
    const B = new Map(), wide = [];
    for (const c of list) {
      if (c.sphere) { wide.push(c); continue; }
      if (c.y0 === undefined) continue;
      let r = 0;
      for (let s = 0; s <= 16; s++) { const q = CollisionModel.radiusOf(c, c.y0 + (c.y1 - c.y0) * s / 16); if (q > r) r = q; }
      r = (r > 0 ? r : 0) * 1.1 + 4 + BUCKET_PAD;   // radius(y) is smooth: 17 samples plus a margin
      const i0 = Math.floor((c.x - r) / BUCKET), i1 = Math.floor((c.x + r) / BUCKET);
      const j0 = Math.floor((c.z - r) / BUCKET), j1 = Math.floor((c.z + r) / BUCKET);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 36) { wide.push(c); continue; }
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const key = (i + 4096) * 8192 + (j + 4096);
        let l = B.get(key);
        if (!l) B.set(key, (l = []));
        l.push(c);
      }
    }
    this._buckets = B; this._wide = wide; this._nCol = list.length;
  }

  /**
   * Deepest penetration of (x, y, z) into any cylinder (with `pad`), as
   * { depth, nx, nz, c } or null. `planner` includes planner-only shells.
   */
  penetration(x, y, z, pad = 0, planner = false) {
    let best = null;
    if (this._nCol !== this.world.colliders.length) this._index();
    let near = this.world.colliders;
    if (pad <= BUCKET_PAD) near = this._buckets.get((Math.floor(x / BUCKET) + 4096) * 8192 + (Math.floor(z / BUCKET) + 4096)) || NONE;
    const lists = planner ? [near, this._wide, this.extra, this.plannerOnly] : [near, this._wide, this.extra];
    if (near === this.world.colliders) lists.splice(1, 1);
    for (const list of lists) {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.sphere) {
          const dx = x - c.x, dy = y - c.y, dz = z - c.z;
          const d = Math.hypot(dx, dy, dz), m = c.r + pad;
          if (d < m) { const depth = m - d; if (!best || depth > best.depth) best = { depth, nx: d > 1e-3 ? dx / d : 1, nz: d > 1e-3 ? dz / d : 0, ny: d > 1e-3 ? dy / d : 0, c }; }
          continue;
        }
        if (c.y0 === undefined || y < c.y0 - pad || y > c.y1 + pad) continue;
        const dx = x - c.x, dz = z - c.z;
        if (Math.abs(dx) > 2500 || Math.abs(dz) > 2500) continue;
        const rad = CollisionModel.radiusOf(c, y);
        if (!(rad > 0)) continue;
        const d = Math.hypot(dx, dz), m = rad + pad;
        if (d < m) {
          const depth = m - d;
          if (!best || depth > best.depth) best = { depth, nx: d > 1e-3 ? dx / d : 1, nz: d > 1e-3 ? dz / d : 0, ny: 0, c };
        }
      }
    }
    return best;
  }
}
