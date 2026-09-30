import * as THREE from 'three';
import { lunarInstanced } from './lunarMaterial.js';

// Distance tiers for Medii Landing's instanced detail. The town carries a great many small
// repeated things (window surrounds, cornices, doorways, trees, shrubs, benches, boats, people)
// that only matter near the eye. Each set is filed once, at build, into square cells of the
// site plan; as the camera moves the cells are re-sorted into tiers by their distance from it,
// and each tier's instanced mesh gets the matrices of its cells copied in contiguously (one
// typed-array copy per cell). A set with one tier draws only within its radius; a set with
// several (trees: hero, detailed, simple) swaps prototypes with distance. Metres, in the
// Landing's site frame (x west, y up, z north); the meshes are scaled into km by lunarInstanced.

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();

/** Compose a placement matrix (metres) into `out` (a 16-array at offset o). */
export function place(out, o, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  for (let i = 0; i < 16; i++) out[o + i] = _m.elements[i];
}

/**
 * Collects placements for one prototype set, then builds its tiered instanced meshes.
 *   geos:   one geometry per tier, nearest first (null in a tier draws nothing there)
 *   radii:  the outer radius of each tier (metres from the camera, same length as geos)
 *   cell:   the plan cell size used for the re-sorting
 */
export class CellLod {
  constructor(name, geos, radii, mat, { cell = 160, tint = false, extra = null } = {}) {
    this.name = name; this.geos = geos; this.radii = radii; this.mat = mat; this.cell = cell; this.tint = tint;
    this.extra = extra;           // name of a per-instance vec3 attribute (the walkers' aWalk)
    this.mats = []; this.cols = []; this.exs = []; this.n = 0;
    this._buf = new Float32Array(16);
    this.meshes = [];
    this.last = null;
  }

  /**
   * Add one placement (x, y, z metres; ry about up; scales; optional tint r, g, b). Kept
   * compact (position, the turn's cosine and sine, the scales: 8 floats, half a matrix) and
   * expanded into the instance matrix only when its cell is drawn: the town files ~650,000.
   */
  add(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, col = null, rx = 0, rz = 0, ex = null) {
    if (![x, y, z, ry, sx, sy, sz].every(Number.isFinite)) return;
    void rx; void rz;
    this.mats.push(x, y, z, Math.cos(ry), Math.sin(ry), sx, sy, sz);
    if (this.tint) this.cols.push(col ? col[0] : 1, col ? col[1] : 1, col ? col[2] : 1);
    if (this.extra) this.exs.push(ex ? ex[0] : 0, ex ? ex[1] : 0, ex ? ex[2] : 0);
    this.n++;
  }


  /** File the placements into cells and make the tier meshes. Returns the THREE.Group. */
  build() {
    const group = new THREE.Group();
    group.name = this.name;
    const n = this.n, C = this.cell;
    const M = new Float32Array(this.mats), Cl = this.tint ? new Float32Array(this.cols) : null;
    const Ex = this.extra ? new Float32Array(this.exs) : null;
    this.mats = null; this.cols = null; this.exs = null;
    const cells = new Map();
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(M[i * 8] / C), cz = Math.floor(M[i * 8 + 2] / C);
      const key = cx * 65536 + cz;
      let c = cells.get(key);
      if (!c) { c = { cx: (cx + 0.5) * C, cz: (cz + 0.5) * C, idx: [] }; cells.set(key, c); }
      c.idx.push(i);
    }
    // each cell's matrices (and colours) contiguous, so a tier is filled by block copies
    this.cells = [...cells.values()].map((c) => {
      const m = new Float32Array(c.idx.length * 8), col = Cl ? new Float32Array(c.idx.length * 3) : null;
      const ex = Ex ? new Float32Array(c.idx.length * 3) : null;
      c.idx.forEach((i, j) => {
        m.set(M.subarray(i * 8, i * 8 + 8), j * 8);
        if (col) col.set(Cl.subarray(i * 3, i * 3 + 3), j * 3);
        if (ex) ex.set(Ex.subarray(i * 3, i * 3 + 3), j * 3);
      });
      // the cell's own vertical centre, for the 3-D distance to the camera
      let y = 0; for (let j = 0; j < c.idx.length; j++) y += m[j * 8 + 1];
      return { cx: c.cx, cy: y / c.idx.length, cz: c.cz, n: c.idx.length, m, col, ex };
    });
    // each tier's capacity: the most placements any camera on the ground could gather within
    // its radius (cell centres as the candidate cameras, a cell's slack added), not all of them
    const caps = this.radii.map((Rt) => {
      if (Rt >= 1e8) return n;
      const reach = Rt + C * 1.5;
      let best = 0;
      for (const a of this.cells) {
        let s = 0;
        for (const b of this.cells) if (Math.abs(a.cx - b.cx) < reach && Math.abs(a.cz - b.cz) < reach && Math.hypot(a.cx - b.cx, a.cz - b.cz) < reach) s += b.n;
        if (s > best) best = s;
      }
      return Math.min(n, Math.ceil(best * 1.05) + 16);
    });
    this.caps = caps;
    this.meshes = this.geos.map((g, t) => {
      if (!g) return null;
      const mesh = lunarInstanced(g, caps[t], {}, this.mat, { tint: this.tint });
      mesh.name = `${this.name} (tier ${t})`;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (this.extra) {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, caps[t]) * 3), 3);
        a.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute(this.extra, a);
      }
      group.add(mesh);
      return mesh;
    });
    this.tris = this.geos.map((g) => (g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0));
    this.group = group;
    return group;
  }

  /** Re-sort the cells round the camera (metres, site frame); cheap when it has hardly moved. */
  update(cam, force = false) {
    if (!this.cells) return;
    const slack = this.cell * 0.25;
    if (!force && this.last && Math.abs(cam.x - this.last.x) < slack && Math.abs(cam.y - this.last.y) < slack && Math.abs(cam.z - this.last.z) < slack) return;
    this.last = { x: cam.x, y: cam.y, z: cam.z };
    const counts = this.meshes.map(() => 0);
    const R = this.radii, half = this.cell * 0.72;
    for (const c of this.cells) {
      const d = Math.max(0, Math.hypot(c.cx - cam.x, c.cy - cam.y, c.cz - cam.z) - half);
      let t = 0;
      while (t < R.length && d > R[t]) t++;
      if (t >= R.length) continue;
      const mesh = this.meshes[t];
      if (!mesh || counts[t] + c.n > this.caps[t]) continue;
      // expand the compact placements into matrices (a turn about up, then the scales)
      const A = mesh.instanceMatrix.array, m = c.m;
      for (let j = 0, o = counts[t] * 16; j < c.n; j++, o += 16) {
        const q = j * 8, co = m[q + 3], si = m[q + 4], sx = m[q + 5], sy = m[q + 6], sz = m[q + 7];
        A[o] = co * sx; A[o + 1] = 0; A[o + 2] = -si * sx; A[o + 3] = 0;
        A[o + 4] = 0; A[o + 5] = sy; A[o + 6] = 0; A[o + 7] = 0;
        A[o + 8] = si * sz; A[o + 9] = 0; A[o + 10] = co * sz; A[o + 11] = 0;
        A[o + 12] = m[q]; A[o + 13] = m[q + 1]; A[o + 14] = m[q + 2]; A[o + 15] = 1;
      }
      if (c.col && mesh.instanceColor) mesh.instanceColor.array.set(c.col, counts[t] * 3);
      if (c.ex) mesh.geometry.getAttribute(this.extra).array.set(c.ex, counts[t] * 3);
      counts[t] += c.n;
    }
    this.meshes.forEach((mesh, t) => {
      if (!mesh) return;
      mesh.count = counts[t];
      mesh.visible = counts[t] > 0;
      mesh.instanceMatrix.clearUpdateRanges?.();
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (this.extra) mesh.geometry.getAttribute(this.extra).needsUpdate = true;
    });
  }

  /** Triangles drawn by the current sort. */
  triangles() { return this.meshes.reduce((s, m, t) => s + (m ? m.count * this.tris[t] : 0), 0); }

  /** All placements (for the checks). */
  get total() { return this.cells ? this.cells.reduce((s, c) => s + c.n, 0) : this.n; }

  /** Every placement, for the checks: fn(compact8, offset) (x, y, z, cos, sin, sx, sy, sz). */
  each(fn) { for (const c of this.cells || []) for (let j = 0; j < c.n; j++) fn(c.m, j * 8); }
}

/** A set of CellLods sharing one camera; update() takes the camera in site metres. */
export class LodGroup {
  constructor(name) { this.group = new THREE.Group(); this.group.name = name; this.sets = []; }
  add(set) { this.sets.push(set); this.group.add(set.build()); return set; }
  update(cam, force = false) { for (const s of this.sets) s.update(cam, force); }
  triangles() { return this.sets.reduce((s, x) => s + x.triangles(), 0); }
  dispose() { for (const s of this.sets) for (const m of s.meshes) if (m) { m.geometry.dispose(); m.dispose?.(); } }
}
