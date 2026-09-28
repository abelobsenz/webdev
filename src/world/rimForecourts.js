import * as THREE from 'three';
import { latheFacade, mergeClean } from './geom.js';
import { createFacadeMaterial } from './facade.js';
import { rimArcologies, towerBase, RIM_TERRACE } from './urban.js';

// Forecourts for the arcologies on the atoll rim. The rim is steep, so each arcology stands on
// a level terrace at the height of its own base: an ashlar retaining wall (down into the ground
// all round, into the lagoon floor where the terrace reaches the water) with a parapet and a
// coping, a paved top. On it: a ring colonnade on a stepped stylobate carrying an entablature
// (architrave, frieze, a cornice planted on top), open at four gates; a fountain with water in
// its basins on the side facing the lagoon; obelisks on stepped plinths on the cross axes;
// lamps round the terrace. Wherever the hill rises above the terrace the parts buried in it are
// left out. The rim streets stop at the terrace (urban.js clipAtStops).
// Each terrace has a detailed set and a massing set (same volumes: the columns turn square, the
// fountain loses its bowl) swapped by distance.

const TAU = Math.PI * 2;
const K = { STONE: 1, LANTERN: 2, GARDEN: 3, POOL: 6, PAVING: 9, METAL: 10 };

/** Mesh parts with facade coordinates (u, v, kind) and explicit normals. */
class Parts {
  constructor() { this.pos = []; this.nrm = []; this.fac = []; this.idx = []; }
  v(x, y, z, nx, ny, nz, u, w, k) { this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.fac.push(u, w, k); return this.pos.length / 3 - 1; }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fac, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * Closed annular sector round (cx, cz): radii r0 < r1, heights y0(a) < y1, angles a0 < a1.
 * Outer face out, inner face in, top up, bottom down (optional), end caps on a partial ring.
 * y0 may be a function of the angle (retaining walls that follow the ground).
 */
function ringBand(P, cx, cz, r0, r1, y0, y1, a0, a1, { kind = K.STONE, top = kind, bottom = true, inner = true, seg } = {}) {
  const full = a1 - a0 >= TAU - 1e-6;
  const n = seg || Math.max(3, Math.ceil(((a1 - a0) * r1) / 3));
  const Y0 = typeof y0 === 'function' ? y0 : () => y0;
  const ring = (r, face) => {
    // face: +1 outer, -1 inner
    for (let i = 0; i < n; i++) {
      const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      const b0 = Y0(t0), b1 = Y0(t1);
      const p = P.v(cx + c0 * r, b0, cz + s0 * r, c0 * face, 0, s0 * face, t0 * r, b0, kind);
      const q = P.v(cx + c1 * r, b1, cz + s1 * r, c1 * face, 0, s1 * face, t1 * r, b1, kind);
      const e = P.v(cx + c1 * r, y1, cz + s1 * r, c1 * face, 0, s1 * face, t1 * r, y1, kind);
      const f = P.v(cx + c0 * r, y1, cz + s0 * r, c0 * face, 0, s0 * face, t0 * r, y1, kind);
      // counter-clockwise seen from outside
      if (face > 0) P.quad(p, f, e, q); else P.quad(p, q, e, f);
    }
  };
  const flat = (y, up, k) => {
    for (let i = 0; i < n; i++) {
      const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
      const pts = [[r0, t0], [r1, t0], [r1, t1], [r0, t1]].map(([r, t]) => [cx + Math.cos(t) * r, cz + Math.sin(t) * r]);
      const yy = typeof y === 'function' ? (t) => y(t) : () => y;
      const ids = pts.map(([x, z], j) => P.v(x, yy(j < 2 ? t0 : t1), z, 0, up ? 1 : -1, 0, x, z, k));
      if (up) P.quad(ids[0], ids[3], ids[2], ids[1]); else P.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  };
  ring(r1, 1);
  if (inner) ring(r0, -1);
  flat(y1, true, top);
  if (bottom) flat(Y0, false, kind);
  if (!full) {
    for (const [t, sgn] of [[a0, -1], [a1, 1]]) {
      const c = Math.cos(t), s = Math.sin(t);
      const nx = -s * sgn, nz = c * sgn;          // along the tangent, out of the sector
      const b = Y0(t);
      const ids = [[r0, b], [r1, b], [r1, y1], [r0, y1]].map(([r, y]) => P.v(cx + c * r, y, cz + s * r, nx, 0, nz, r, y, kind));
      if (sgn > 0) P.quad(ids[0], ids[1], ids[2], ids[3]); else P.quad(ids[0], ids[3], ids[2], ids[1]);
    }
  }
}

/** Closed box (plan rotated by rot) from y0 to y1; bottom face optional. */
function boxF(P, cx, cz, hx, hz, y0, y1, rot, { kind = K.STONE, top = kind, bottom = false } = {}) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const W = (x, z) => [cx + x * c - z * s, cz + x * s + z * c];
  const cs = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, z]) => W(x, z));
  let u = 0;
  for (let i = 0; i < 4; i++) {
    const a = cs[i], b = cs[(i + 1) % 4];
    const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    const nx = ez / L, nz = -ex / L;                 // outward: the corners run counter-clockwise in (x, z)
    const ids = [[a, y0, u], [b, y0, u + L], [b, y1, u + L], [a, y1, u]].map(([p, y, uu]) => P.v(p[0], y, p[1], nx, 0, nz, uu, y, kind));
    P.quad(ids[0], ids[3], ids[2], ids[1]);
    u += L;
  }
  const capF = (y, up, k) => {
    const ids = cs.map(([x, z]) => P.v(x, y, z, 0, up ? 1 : -1, 0, x, z, k));
    if (up) P.quad(ids[0], ids[3], ids[2], ids[1]); else P.quad(ids[0], ids[1], ids[2], ids[3]);
  };
  capF(y1, true, top);
  if (bottom) capF(y0, false, kind);
}

/** Lathe with per-segment kinds (a duplicated ring at every change of kind) at (x, y, z). */
function lathe(list, x, y, z, prof, seg, opts) {
  const out = [];
  for (let i = 0; i < prof.length; i++) {
    const [r, h, k] = prof[i];
    if (i > 0 && prof[i - 1][2] !== k) out.push({ r: prof[i - 1][0], y: prof[i - 1][1], kind: k });
    out.push({ r, y: h, kind: k });
  }
  list.push(latheFacade(out, seg, opts).translate(x, y, z));
}

// the column: square plinth, torus, a shaft with entasis, necking, echinus and abacus
function column(list, x, y, z, h, lod) {
  if (lod) { lathe(list, x, y, z, [[0.7, -0.1, K.STONE], [0.6, h * 0.5, K.STONE], [0.52, h + 0.1, K.STONE]], 4, { phase: Math.PI / 4 }); return; }
  lathe(list, x, y, z, [
    [0.82, -0.1, K.STONE], [0.82, 0.28, K.STONE], [0.74, 0.34, K.STONE], [0.72, 0.46, K.STONE], [0.6, 0.56, K.STONE],
    [0.58, 1.2, K.STONE], [0.56, h * 0.45, K.STONE], [0.48, h - 0.72, K.STONE], [0.53, h - 0.66, K.STONE], [0.53, h - 0.58, K.STONE],
    [0.49, h - 0.52, K.STONE], [0.78, h - 0.22, K.STONE], [0.8, h + 0.1, K.STONE],
  ], 14);
}

export function buildRimForecourts(scene, towers, ground, avoid = () => false) {
  const lamps = [];
  const sets = [];
  const mat = createFacadeMaterial('pearl', 4321, { litFrac: 0.5, band: 1e5 });
  for (const t of rimArcologies(towers)) {
    const cx = t.def.x, cz = t.def.z;
    const base = t.footprint || towerBase(t);
    const RT = base + RIM_TERRACE;                  // the terrace edge (outer face of the wall)
    if (avoid(cx, cz, RT + 10)) continue;
    const Y0 = Math.max(t.baseY + 2, 1.8);           // paved top: the tower's own ground level
    const RC = base + 6;                             // colonnade axis
    const hC = 7.2;                                  // column height
    // highest and lowest ground in a small disc (the bilinear sampler can differ from the
    // rendered grid by a little: the margins below cover it)
    const gMax = (x, z, r) => { let m = ground(x, z); for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; m = Math.max(m, ground(x + Math.cos(a) * r, z + Math.sin(a) * r)); } return m; };
    const buried = (x, z, r, lift = 0) => gMax(x, z, r) > Y0 + lift;
    // the retaining wall's foot follows the lowest ground under each stretch, well sunk
    const nW = Math.max(96, Math.ceil((TAU * RT) / 4));
    const foot = new Float32Array(nW + 1);
    for (let i = 0; i <= nW; i++) {
      let m = 1e9;
      for (let k = -2; k <= 2; k++) {
        const a = ((i + k * 0.25) / nW) * TAU;
        for (const rr of [RT - 1.5, RT, RT + 1]) m = Math.min(m, ground(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr));
      }
      foot[i] = Math.max(Math.min(m - 3, Y0 - 1.5), -60);
    }
    const footAt = (a) => { const f = (((a / TAU) % 1) + 1) % 1 * nW; const i = Math.floor(f); return foot[Math.min(i, nW)] + (foot[Math.min(i + 1, nW)] - foot[Math.min(i, nW)]) * (f - i); };
    const toL = Math.atan2(-cz, -cx);                // toward the lagoon

    const build = (lod) => {
      const P = new Parts();
      const list = [];
      // ---- the terrace: retaining wall (ashlar) with its parapet, the coping, the paved top
      ringBand(P, cx, cz, RT - 0.5, RT, footAt, Y0 + 1.0, 0, TAU, { kind: K.PAVING, bottom: false, inner: false, seg: nW });
      ringBand(P, cx, cz, RT - 0.5, RT, Y0 - 0.05, Y0 + 1.0, 0, TAU, { kind: K.PAVING, bottom: false, seg: nW });
      ringBand(P, cx, cz, RT - 0.62, RT + 0.22, Y0 + 1.0, Y0 + 1.22, 0, TAU, { kind: K.STONE, seg: nW });
      if (!lod) ringBand(P, cx, cz, RT, RT + 0.12, (a) => footAt(a), Y0 - 0.55, 0, TAU, { kind: K.STONE, bottom: false, inner: false, seg: nW });   // a string course under the parapet
      {
        const nD = lod ? 64 : nW;
        const c0 = P.v(cx, Y0, cz, 0, 1, 0, cx, cz, K.PAVING);
        const ring = [];
        for (let i = 0; i <= nD; i++) { const a = (i / nD) * TAU; const x = cx + Math.cos(a) * (RT - 0.5), z = cz + Math.sin(a) * (RT - 0.5); ring.push(P.v(x, Y0, z, 0, 1, 0, x, z, K.PAVING)); }
        for (let i = 0; i < nD; i++) P.idx.push(c0, ring[i + 1], ring[i]);
      }
      // ---- the colonnade: columns wherever the terrace is clear of the hill, gates on four axes
      const nCol = Math.max(24, Math.round((TAU * RC) / 6.5));
      const gate = (a) => [0, Math.PI / 2, Math.PI, -Math.PI / 2].some((g) => { let d = Math.abs(a - toL - g) % TAU; d = Math.min(d, TAU - d); return d * RC < 7; });
      const has = [];
      for (let k = 0; k < nCol; k++) {
        const a = (k / nCol) * TAU;
        const x = cx + Math.cos(a) * RC, z = cz + Math.sin(a) * RC;
        has.push(!gate(a) && !buried(x, z, 1.8, -0.05) && !avoid(x, z, 4));
      }
      // runs of consecutive columns (a run may wrap round past k = 0)
      const runs = [];
      const start = has.indexOf(false);
      if (start >= 0) {
        let cur = null;
        for (let j = 1; j <= nCol; j++) {
          const k = (start + j) % nCol;
          if (has[k]) { if (!cur) cur = [start + j, start + j]; else cur[1] = start + j; } else if (cur) { runs.push(cur); cur = null; }
        }
        if (cur) runs.push(cur);
      }
      for (const [k0, k1] of runs) {
        if (k1 - k0 < 2) continue;                   // a lone pair of columns carries nothing
        const a0 = (k0 / nCol) * TAU - 1.2 / RC, a1 = (k1 / nCol) * TAU + 1.2 / RC;
        // stylobate: two steps, sunk a little into the paving
        ringBand(P, cx, cz, RC - 1.7, RC + 1.7, Y0 - 0.05, Y0 + 0.2, a0 - 0.6 / RC, a1 + 0.6 / RC, { kind: K.PAVING, bottom: false });
        ringBand(P, cx, cz, RC - 1.25, RC + 1.25, Y0 + 0.2, Y0 + 0.42, a0 - 0.2 / RC, a1 + 0.2 / RC, { kind: K.PAVING, bottom: false });
        for (let k = k0; k <= k1; k++) {
          const a = (k / nCol) * TAU;
          column(list, cx + Math.cos(a) * RC, Y0 + 0.42, cz + Math.sin(a) * RC, hC, lod);
        }
        // entablature: architrave, frieze, and a cornice with a planted top
        const yE = Y0 + 0.42 + hC;
        ringBand(P, cx, cz, RC - 0.85, RC + 0.85, yE, yE + 0.85, a0, a1, { kind: K.STONE });
        ringBand(P, cx, cz, RC - 0.7, RC + 0.7, yE + 0.85, yE + 1.7, a0 + 0.1 / RC, a1 - 0.1 / RC, { kind: lod ? K.STONE : K.METAL, bottom: false });
        ringBand(P, cx, cz, RC - 1.2, RC + 1.2, yE + 1.7, yE + 2.15, a0 - 0.3 / RC, a1 + 0.3 / RC, { kind: K.STONE, top: K.GARDEN });
        if (!lod) {
          // dentils under the cornice, a guttae band over the architrave
          const nd = Math.floor(((a1 - a0) * (RC + 0.72)) / 0.9);
          for (let i = 0; i < nd; i++) {
            const a = a0 + ((i + 0.5) / nd) * (a1 - a0);
            for (const [rr, sg] of [[RC + 0.78, 1], [RC - 0.78, -1]]) boxF(P, cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, 0.16, 0.09, yE + 1.52, yE + 1.7, a + Math.PI / 2, { bottom: true });
          }
        }
      }
      // ---- the fountain, toward the lagoon, on the terrace between the colonnade and the parapet
      const rF = base + 11.6;
      const fx = cx + Math.cos(toL) * rF, fz = cz + Math.sin(toL) * rF;
      if (!buried(fx, fz, 4.2, -0.05) && !avoid(fx, fz, 5)) {
        const basin = [
          [4.0, -0.05, K.STONE], [4.0, 0.62, K.STONE], [4.12, 0.64, K.STONE], [4.12, 0.78, K.STONE], [3.5, 0.78, K.STONE], [3.5, 0.52, K.STONE],
          [0.95, 0.52, K.POOL], [0.95, 0.52, K.STONE], [0.9, 0.9, K.STONE], [0.6, 1.3, K.STONE], [0.42, 1.6, K.STONE],
        ];
        const top = lod ? [[0.4, 2.7, K.STONE], [0.05, 3.1, K.STONE]] : [
          [0.38, 2.1, K.STONE], [0.55, 2.2, K.STONE], [1.9, 2.55, K.STONE], [2.0, 2.78, K.STONE], [1.78, 2.8, K.STONE], [1.74, 2.64, K.STONE],
          [0.34, 2.64, K.POOL], [0.34, 2.64, K.STONE], [0.26, 3.5, K.STONE], [0.42, 3.62, K.STONE], [0.3, 3.85, K.STONE], [0.06, 4.35, K.LANTERN],
        ];
        lathe(list, fx, Y0, fz, [...basin, ...top], lod ? 16 : 48);
      }
      // ---- obelisks on stepped plinths on the cross axes
      for (const da of [Math.PI / 2, -Math.PI / 2]) {
        const a = toL + da;
        const ox = cx + Math.cos(a) * rF, oz = cz + Math.sin(a) * rF;
        if (buried(ox, oz, 2.4, -0.05) || avoid(ox, oz, 4)) continue;
        boxF(P, ox, oz, 2.1, 2.1, Y0 - 0.05, Y0 + 0.4, a, { kind: K.PAVING });
        boxF(P, ox, oz, 1.6, 1.6, Y0 + 0.4, Y0 + 0.85, a, { kind: K.PAVING });
        boxF(P, ox, oz, 1.1, 1.1, Y0 + 0.85, Y0 + 2.0, a, { kind: K.STONE });
        lathe(list, ox, Y0, oz, [[1.05, 1.95, K.STONE], [0.95, 2.2, K.STONE], [0.6, 12.2, K.STONE], [0.02, 13.2, K.LANTERN]], 4, { phase: Math.PI / 4 + a });
      }
      list.push(P.geometry());
      return mergeClean(list);
    };
    const near = new THREE.Mesh(build(false), mat), far = new THREE.Mesh(build(true), mat);
    for (const m of [near, far]) {
      m.name = 'Rim forecourts';
      m.castShadow = true; m.receiveShadow = true;
      m.matrixAutoUpdate = false; m.updateMatrix();
      scene.add(m);
    }
    near.geometry.computeBoundingSphere(); far.geometry.computeBoundingSphere();
    sets.push({ near, far, center: new THREE.Vector3(cx, Y0, cz), radius: RT });
    // lamps just inside the parapet, clear of the fountain, the obelisks and the gates' axes
    const nL = Math.max(12, Math.round((TAU * RT) / 26));
    for (let k = 0; k < nL; k++) {
      const a = ((k + 0.5) / nL) * TAU;
      const rl = RT - 1.4;
      const x = cx + Math.cos(a) * rl, z = cz + Math.sin(a) * rl;
      const clearOf = [0, Math.PI / 2, -Math.PI / 2].every((g) => { const ga = toL + g; return Math.hypot(x - (cx + Math.cos(ga) * (base + 11.6)), z - (cz + Math.sin(ga) * (base + 11.6))) > 6; });
      if (!clearOf || buried(x, z, 0.6, -0.05) || avoid(x, z, 2)) continue;
      lamps.push({ x, y: Y0 - 0.05, z, yaw: a + Math.PI, cls: 0 });
    }
  }
  const api = {
    meshes: sets.flatMap((s) => [s.near, s.far]), lamps, sets,
    nearDist: 1100,
    update(camera) {
      if (!camera) return;
      const cp = camera.position;
      for (const s of sets) {
        const near = cp.distanceTo(s.center) - s.radius < this.nearDist;
        // near: detail in the main view, massing in the (cheaper) reflection pass
        s.near.visible = near;
        s.near.layers.set(near ? 1 : 0);
        s.far.layers.set(near ? 2 : 0);
      }
    },
  };
  return api;
}
