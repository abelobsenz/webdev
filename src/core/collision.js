import { GATE, SKYPORT } from '../world/layout.js';
import { INNER } from '../world/terrain.js';
import { latticeRadius } from '../world/axis.js';

/**
 * Collision model shared by free flight and the cinematic path planner.
 *
 *  - `world.colliders`: vertical cylinders {x, z, y0, y1, radius | radius(y)} from the world build
 *    (towers, the Axis core, the skyport hub). Optional sphere colliders {x, y, z, r, sphere:true}.
 *  - extra cylinders for structures the world build does not register (Gate arches, the skyport
 *    disc, floating gardens).
 *  - a coarse "structure grid" over the inner caldera holding the top (and underside) of low-rise
 *    blocks and promenade decks, so the camera can neither sink into roofs nor fly through blocks.
 *  - planner-only obstacles (the Axis lattice) that free flight may enter but tours should avoid.
 */
export class CollisionModel {
  constructor(world) {
    this.world = world;
    this.ground = (x, z) => world.groundHeight(x, z);
    this.extra = [];
    this.plannerOnly = [];
    this.cell = 16;
    this.half = INNER.half;
    this.n = Math.ceil((2 * this.half) / this.cell);
    this.top = new Float32Array(this.n * this.n).fill(-1e4);
    this.bottom = new Float32Array(this.n * this.n).fill(-1e4);
    try { this._buildExtra(); } catch (e) { /* optional structures missing */ }
    try { this._buildGrid(); } catch (e) { /* optional structures missing */ }
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

  _mark(x, z, r, top, bottom) {
    const { cell, half, n } = this;
    const i0 = Math.max(0, Math.floor((x - r + half) / cell)), i1 = Math.min(n - 1, Math.floor((x + r + half) / cell));
    const j0 = Math.max(0, Math.floor((z - r + half) / cell)), j1 = Math.min(n - 1, Math.floor((z + r + half) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * n + i;
        if (top > this.top[k]) this.top[k] = top;
        if (this.bottom[k] < -9000 || bottom < this.bottom[k]) this.bottom[k] = bottom;
      }
    }
  }

  _buildGrid() {
    const w = this.world;
    const lr = w.lowrise;
    if (lr && lr.placements) {
      for (const list of lr.placements) {
        for (const p of list) {
          const r = Math.max(p.sx, p.sz) * 0.62;
          this._mark(p.x, p.z, r, p.y + p.sy + 1.5, -1e3);
        }
      }
    }
    const prom = w.infra && w.infra.promenades;
    if (prom) {
      for (const path of prom) {
        for (let k = 0; k < path.length; k++) {
          const p = path[k];
          const q = path[Math.min(k + 1, path.length - 1)];
          for (let s = 0; s < 3; s++) {
            const t = s / 3;
            const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t, z = p.z + (q.z - p.z) * t;
            const g = this.ground(x, z);
            this._mark(x, z, 17, y + 4, y - g > 12 ? y - 5 : -1e3);
          }
        }
      }
    }
  }

  /** Top of structures in the grid cell containing (x, z), or -1e4. */
  structureTop(x, z) {
    const { cell, half, n } = this;
    const i = Math.floor((x + half) / cell), j = Math.floor((z + half) / cell);
    if (i < 0 || j < 0 || i >= n || j >= n) return -1e4;
    return this.top[j * n + i];
  }

  structureBottom(x, z) {
    const { cell, half, n } = this;
    const i = Math.floor((x + half) / cell), j = Math.floor((z + half) / cell);
    if (i < 0 || j < 0 || i >= n || j >= n) return -1e4;
    return this.bottom[j * n + i];
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

  /**
   * Deepest penetration of (x, y, z) into any cylinder (with `pad`), as
   * { depth, nx, nz, c } or null. `planner` includes planner-only shells.
   */
  penetration(x, y, z, pad = 0, planner = false) {
    let best = null;
    const lists = planner ? [this.world.colliders, this.extra, this.plannerOnly] : [this.world.colliders, this.extra];
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
