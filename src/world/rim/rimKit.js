import * as THREE from 'three';

// A small kit of closed solids for the rim's structures, emitted with explicit (flat) normals
// and facade coordinates (u, v, kind) for the shared facade material (facade.js kinds: 1 stone,
// 2 lantern, 3 planted, 5 punched stone, 6 pool water, 8 timber, 9 paving, 10 dark metal, 0 glass).
// Every face is wound so its geometric normal agrees with the normal it is given; every solid
// is closed (caps, soffits, undersides and ends included).

export const K = { GLASS: 0, STONE: 1, LANTERN: 2, GARDEN: 3, PUNCHED: 5, WATER: 6, SOLAR: 7, TIMBER: 8, PAVING: 9, METAL: 10, CERAMIC: 11, FRIT: 12 };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export class Kit {
  constructor() { this.pos = []; this.nrm = []; this.fac = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  get tris() { return this.idx.length / 3; }

  /**
   * A planar convex polygon P = [[x, y, z], ...] facing n (outward). uv: [[u, v], ...] or null
   * (vertical faces: metres along the face and height; horizontal faces: world x, z).
   */
  face(P, n, k, uv = null) {
    const l = Math.hypot(n[0], n[1], n[2]);
    if (!(l > 1e-9)) return;
    const nx = n[0] / l, ny = n[1] / l, nz = n[2] / l;
    // drop degenerate polygons
    _a.set(P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]);
    let area = 0;
    for (let i = 2; i < P.length; i++) {
      _b.set(P[i][0] - P[0][0], P[i][1] - P[0][1], P[i][2] - P[0][2]);
      _c.crossVectors(_a, _b);
      area += _c.x * nx + _c.y * ny + _c.z * nz;
      _a.copy(_b);
    }
    if (Math.abs(area) < 1e-7) return;
    const flip = area < 0;
    const base = this.count;
    let U = uv;
    if (!U) {
      if (Math.abs(ny) > 0.7) U = P.map((p) => [p[0], p[2]]);
      else {
        // horizontal direction along the face
        const hx = -nz, hz = nx, hl = Math.hypot(hx, hz) || 1;
        U = P.map((p) => [(p[0] * hx + p[2] * hz) / hl, p[1]]);
      }
    }
    for (let i = 0; i < P.length; i++) {
      this.pos.push(P[i][0], P[i][1], P[i][2]);
      this.nrm.push(nx, ny, nz);
      this.fac.push(U[i][0], U[i][1], k);
    }
    for (let i = 1; i < P.length - 1; i++) {
      if (flip) this.idx.push(base, base + i + 1, base + i);
      else this.idx.push(base, base + i, base + i + 1);
    }
  }

  /** Face with its normal from its own geometry, oriented to agree with the hint direction. */
  faceAuto(P, hint, k, uv = null) {
    _a.set(P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]);
    _b.set(P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]);
    _c.crossVectors(_a, _b);
    if (_c.x * hint[0] + _c.y * hint[1] + _c.z * hint[2] < 0) _c.negate();
    this.face(P, [_c.x, _c.y, _c.z], k, uv);
  }

  /**
   * An oriented box. o = { x, y, z, yaw }: local x runs along (cos yaw, sin yaw), local z along
   * (-sin yaw, cos yaw). Extents in local metres; kinds for sides, top and bottom.
   */
  box(o, x0, x1, y0, y1, z0, z1, kS, kT = kS, kB = kS) {
    if (!(x1 - x0 > 1e-4 && y1 - y0 > 1e-4 && z1 - z0 > 1e-4)) return;
    const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0);
    const W = (lx, ly, lz) => [o.x + lx * c - lz * s, (o.y || 0) + ly, o.z + lx * s + lz * c];
    const N = (lx, lz) => [lx * c - lz * s, 0, lx * s + lz * c];
    const p = [W(x0, y0, z0), W(x1, y0, z0), W(x1, y0, z1), W(x0, y0, z1), W(x0, y1, z0), W(x1, y1, z0), W(x1, y1, z1), W(x0, y1, z1)];
    this.face([p[4], p[5], p[6], p[7]], [0, 1, 0], kT);
    this.face([p[0], p[1], p[2], p[3]], [0, -1, 0], kB);
    this.face([p[0], p[1], p[5], p[4]], N(0, -1), kS, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    this.face([p[3], p[2], p[6], p[7]], N(0, 1), kS, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    this.face([p[0], p[3], p[7], p[4]], N(-1, 0), kS, [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
    this.face([p[1], p[2], p[6], p[5]], N(1, 0), kS, [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
  }

  /** A post (square section) from y0 to y1 at (x, z). */
  post(x, z, hw, y0, y1, k) { this.box({ x, z, yaw: 0 }, -hw, hw, y0, y1, -hw, hw, k, k, k); }

  /**
   * A vertical prism over a simple polygon (local xz, either winding), from y0 to y1 in frame o.
   * Sides, top and bottom caps.
   */
  prism(o, poly, y0, y1, kS, kT = kS, kB = kS) {
    const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0);
    const W = (lx, ly, lz) => [o.x + lx * c - lz * s, (o.y || 0) + ly, o.z + lx * s + lz * c];
    let ar = 0;
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; ar += p[0] * q[1] - q[0] * p[1]; }
    const P = ar < 0 ? poly.slice().reverse() : poly;       // counter-clockwise in (x, z)
    let per = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < 1e-6) continue;
      // outward normal of a counter-clockwise (x, z) polygon edge
      const nx = (q[1] - p[1]) / L, nz = -(q[0] - p[0]) / L;
      this.face([W(p[0], y0, p[1]), W(q[0], y0, q[1]), W(q[0], y1, q[1]), W(p[0], y1, p[1])], [nx * c - nz * s, 0, nx * s + nz * c], kS, [[per, y0], [per + L, y0], [per + L, y1], [per, y1]]);
      per += L;
    }
    const tris = THREE.ShapeUtils.triangulateShape(P.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const [a, b, d] of tris) {
      this.face([W(P[a][0], y1, P[a][1]), W(P[b][0], y1, P[b][1]), W(P[d][0], y1, P[d][1])], [0, 1, 0], kT);
      this.face([W(P[a][0], y0, P[a][1]), W(P[b][0], y0, P[b][1]), W(P[d][0], y0, P[d][1])], [0, -1, 0], kB);
    }
  }

  /**
   * A gabled roof: a closed triangular prism over the rectangle x0..x1, z0..z1 (local), ridge
   * along local x at height y1, eaves at y0.
   */
  gable(o, x0, x1, z0, z1, y0, y1, kRoof, kEnd = kRoof, kSoffit = kRoof) {
    const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0);
    const W = (lx, ly, lz) => [o.x + lx * c - lz * s, (o.y || 0) + ly, o.z + lx * s + lz * c];
    const zm = (z0 + z1) / 2;
    const A = [W(x0, y0, z0), W(x1, y0, z0), W(x1, y0, z1), W(x0, y0, z1), W(x0, y1, zm), W(x1, y1, zm)];
    const up = (dz) => { const l = Math.hypot(y1 - y0, dz); return [(-s * dz * (y1 - y0) / l) / Math.abs(dz), 0, 0]; };
    void up;
    const slopeN = (sgn) => { const h = y1 - y0, run = (z1 - z0) / 2, l = Math.hypot(h, run); const lz = sgn * h / l, ly = run / l; return [-lz * s, ly, lz * c]; };
    const Lr = Math.hypot(y1 - y0, (z1 - z0) / 2);
    this.face([A[0], A[1], A[5], A[4]], slopeN(-1), kRoof, [[x0, 0], [x1, 0], [x1, Lr], [x0, Lr]]);
    this.face([A[3], A[2], A[5], A[4]], slopeN(1), kRoof, [[x0, 0], [x1, 0], [x1, Lr], [x0, Lr]]);
    this.face([A[0], A[1], A[2], A[3]], [0, -1, 0], kSoffit);
    this.face([A[0], A[3], A[4]], [-c, 0, -s], kEnd, [[z0, y0], [z1, y0], [zm, y1]]);
    this.face([A[1], A[2], A[5]], [c, 0, s], kEnd, [[z0, y0], [z1, y0], [zm, y1]]);
  }

  /**
   * A strip along a world polyline P = [[x, z], ...]: half-width hw each side, bottom yB[i] and
   * top yT[i] at every point (following the ground), closed with its ends. Top kind kT, sides kS.
   */
  strip(P, hw, yB, yT, kS, kT = kS, kB = kS) {
    const n = P.length;
    if (n < 2) return;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      L.push([P[i][0] - tz * hw, P[i][1] + tx * hw]);
      R.push([P[i][0] + tz * hw, P[i][1] - tx * hw]);
    }
    // heights: arrays per centre point, or functions of (x, z) evaluated at each edge point
    const hL = (f, i) => (typeof f === 'function' ? f(L[i][0], L[i][1]) : f[i]), hR = (f, i) => (typeof f === 'function' ? f(R[i][0], R[i][1]) : f[i]);
    const ylB = P.map((_, i) => hL(yB, i)), yrB = P.map((_, i) => hR(yB, i)), ylT = P.map((_, i) => hL(yT, i)), yrT = P.map((_, i) => hR(yT, i));
    let s = 0;
    for (let i = 0; i < n - 1; i++) {
      const d = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
      const tx = (P[i + 1][0] - P[i][0]) / (d || 1), tz = (P[i + 1][1] - P[i][1]) / (d || 1);
      const lT0 = [L[i][0], ylT[i], L[i][1]], lT1 = [L[i + 1][0], ylT[i + 1], L[i + 1][1]], rT0 = [R[i][0], yrT[i], R[i][1]], rT1 = [R[i + 1][0], yrT[i + 1], R[i + 1][1]];
      const lB0 = [L[i][0], ylB[i], L[i][1]], lB1 = [L[i + 1][0], ylB[i + 1], L[i + 1][1]], rB0 = [R[i][0], yrB[i], R[i][1]], rB1 = [R[i + 1][0], yrB[i + 1], R[i + 1][1]];
      // top and bottom as two triangles each (the four corners need not be coplanar)
      this.faceAuto([lT0, rT0, rT1], [0, 1, 0], kT); this.faceAuto([lT0, rT1, lT1], [0, 1, 0], kT);
      this.faceAuto([lB0, rB1, rB0], [0, -1, 0], kB); this.faceAuto([lB0, lB1, rB1], [0, -1, 0], kB);
      const uvL = [[s, ylB[i]], [s + d, ylB[i + 1]], [s + d, ylT[i + 1]], [s, ylT[i]]], uvR = [[s, yrB[i]], [s + d, yrB[i + 1]], [s + d, yrT[i + 1]], [s, yrT[i]]];
      this.faceAuto([lB0, lB1, lT1], [-tz, 0, tx], kS, [uvL[0], uvL[1], uvL[2]]); this.faceAuto([lB0, lT1, lT0], [-tz, 0, tx], kS, [uvL[0], uvL[2], uvL[3]]);
      this.faceAuto([rB0, rB1, rT1], [tz, 0, -tx], kS, [uvR[0], uvR[1], uvR[2]]); this.faceAuto([rB0, rT1, rT0], [tz, 0, -tx], kS, [uvR[0], uvR[2], uvR[3]]);
      s += d;
    }
    for (const [i, j] of [[0, 1], [n - 1, n - 2]]) {
      const tx = P[j][0] - P[i][0], tz = P[j][1] - P[i][1];
      this.faceAuto([[L[i][0], ylB[i], L[i][1]], [R[i][0], yrB[i], R[i][1]], [R[i][0], yrT[i], R[i][1]]], [-tx, 0, -tz], kS);
      this.faceAuto([[L[i][0], ylB[i], L[i][1]], [R[i][0], yrT[i], R[i][1]], [L[i][0], ylT[i], L[i][1]]], [-tx, 0, -tz], kS);
    }
  }

  /**
   * A cross-section polygon Q = [[z, y], ...] (local, simple) extruded along local x from x0 to x1
   * in frame o: grandstands, vaults, parapets. Side faces from each edge, both end caps.
   */
  extrudeX(o, Q, x0, x1, kS, kEnd = kS) {
    const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0);
    const W = (lx, ly, lz) => [o.x + lx * c - lz * s, (o.y || 0) + ly, o.z + lx * s + lz * c];
    let ar = 0;
    for (let i = 0; i < Q.length; i++) { const p = Q[i], q = Q[(i + 1) % Q.length]; ar += p[0] * q[1] - q[0] * p[1]; }
    const P = ar < 0 ? Q.slice().reverse() : Q;        // counter-clockwise in (z, y)
    let per = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < 1e-6) continue;
      // outward normal of a counter-clockwise (z, y) edge: (dy, -dz)
      const nz = (q[1] - p[1]) / L, ny = -(q[0] - p[0]) / L;
      this.face([W(x0, p[1], p[0]), W(x1, p[1], p[0]), W(x1, q[1], q[0]), W(x0, q[1], q[0])], [-nz * s, ny, nz * c], kS, [[x0, per], [x1, per], [x1, per + L], [x0, per + L]]);
      per += L;
    }
    const tris = THREE.ShapeUtils.triangulateShape(P.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const [a, b, d] of tris) {
      this.face([W(x0, P[a][1], P[a][0]), W(x0, P[b][1], P[b][0]), W(x0, P[d][1], P[d][0])], [-c, 0, -s], kEnd, [[P[a][0], P[a][1]], [P[b][0], P[b][1]], [P[d][0], P[d][1]]]);
      this.face([W(x1, P[a][1], P[a][0]), W(x1, P[b][1], P[b][0]), W(x1, P[d][1], P[d][0])], [c, 0, s], kEnd, [[P[a][0], P[a][1]], [P[b][0], P[b][1]], [P[d][0], P[d][1]]]);
    }
  }

  /**
   * A ring sector round (cx, cz): radii r0 < r1, angles a0 < a1 (world bearings), bottom yB and
   * top yT (numbers). Outer and inner walls, top, bottom and (for a partial ring) end walls.
   */
  ringSector(cx, cz, r0, r1, a0, a1, yB, yT, kS, kT = kS, kB = kS, seg = 0) {
    const full = a1 - a0 >= Math.PI * 2 - 1e-6;
    const n = seg || Math.max(3, Math.ceil(((a1 - a0) * r1) / 2.5));
    const pt = (r, a, y) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    for (let i = 0; i < n; i++) {
      const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n, tm = (t0 + t1) / 2;
      const nOut = [Math.cos(tm), 0, Math.sin(tm)];
      this.face([pt(r1, t0, yB), pt(r1, t1, yB), pt(r1, t1, yT), pt(r1, t0, yT)], nOut, kS, [[t0 * r1, yB], [t1 * r1, yB], [t1 * r1, yT], [t0 * r1, yT]]);
      if (r0 > 1e-6) this.face([pt(r0, t0, yB), pt(r0, t1, yB), pt(r0, t1, yT), pt(r0, t0, yT)], [-nOut[0], 0, -nOut[2]], kS, [[t0 * r0, yB], [t1 * r0, yB], [t1 * r0, yT], [t0 * r0, yT]]);
      if (r0 > 1e-6) {
        this.face([pt(r0, t0, yT), pt(r1, t0, yT), pt(r1, t1, yT), pt(r0, t1, yT)], [0, 1, 0], kT);
        this.face([pt(r0, t0, yB), pt(r1, t0, yB), pt(r1, t1, yB), pt(r0, t1, yB)], [0, -1, 0], kB);
      } else {
        this.face([[cx, yT, cz], pt(r1, t0, yT), pt(r1, t1, yT)], [0, 1, 0], kT);
        this.face([[cx, yB, cz], pt(r1, t0, yB), pt(r1, t1, yB)], [0, -1, 0], kB);
      }
    }
    if (!full) for (const [t, sg] of [[a0, -1], [a1, 1]]) {
      const nx = -Math.sin(t) * sg, nz = Math.cos(t) * sg;
      if (r0 > 1e-6) this.face([pt(r0, t, yB), pt(r1, t, yB), pt(r1, t, yT), pt(r0, t, yT)], [nx, 0, nz], kS);
      else this.face([[cx, yB, cz], pt(r1, t, yB), pt(r1, t, yT), [cx, yT, cz]], [nx, 0, nz], kS);
    }
  }

  /** A closed loop strip (P[0] != P[n-1]; the loop closes itself): no end caps. */
  loop(P, hw, yB, yT, kS, kT = kS, kB = kS) {
    const n = P.length;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      L.push([P[i][0] - tz * hw, P[i][1] + tx * hw]); R.push([P[i][0] + tz * hw, P[i][1] - tx * hw]);
    }
    const hL = (f, i) => (typeof f === 'function' ? f(L[i][0], L[i][1]) : f[i]), hR = (f, i) => (typeof f === 'function' ? f(R[i][0], R[i][1]) : f[i]);
    const ylB = P.map((_, i) => hL(yB, i)), yrB = P.map((_, i) => hR(yB, i)), ylT = P.map((_, i) => hL(yT, i)), yrT = P.map((_, i) => hR(yT, i));
    let s = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const d = Math.hypot(P[j][0] - P[i][0], P[j][1] - P[i][1]);
      const tx = (P[j][0] - P[i][0]) / (d || 1), tz = (P[j][1] - P[i][1]) / (d || 1);
      const lT0 = [L[i][0], ylT[i], L[i][1]], lT1 = [L[j][0], ylT[j], L[j][1]], rT0 = [R[i][0], yrT[i], R[i][1]], rT1 = [R[j][0], yrT[j], R[j][1]];
      const lB0 = [L[i][0], ylB[i], L[i][1]], lB1 = [L[j][0], ylB[j], L[j][1]], rB0 = [R[i][0], yrB[i], R[i][1]], rB1 = [R[j][0], yrB[j], R[j][1]];
      this.faceAuto([lT0, rT0, rT1], [0, 1, 0], kT); this.faceAuto([lT0, rT1, lT1], [0, 1, 0], kT);
      this.faceAuto([lB0, rB1, rB0], [0, -1, 0], kB); this.faceAuto([lB0, lB1, rB1], [0, -1, 0], kB);
      const uv = [[s, ylB[i]], [s + d, ylB[j]], [s + d, ylT[j]], [s, ylT[i]]];
      this.faceAuto([lB0, lB1, lT1], [-tz, 0, tx], kS, [uv[0], uv[1], uv[2]]); this.faceAuto([lB0, lT1, lT0], [-tz, 0, tx], kS, [uv[0], uv[2], uv[3]]);
      this.faceAuto([rB0, rB1, rT1], [tz, 0, -tx], kS, [uv[0], uv[1], uv[2]]); this.faceAuto([rB0, rT1, rT0], [tz, 0, -tx], kS, [uv[0], uv[2], uv[3]]);
      s += d;
    }
  }

  /** Append another kit. */
  append(o) {
    const base = this.count;
    for (const v of o.pos) this.pos.push(v);
    for (const v of o.nrm) this.nrm.push(v);
    for (const v of o.fac) this.fac.push(v);
    for (const i of o.idx) this.idx.push(base + i);
  }

  /** Append a BufferGeometry (with aFacade; normals computed if absent), transformed by m. */
  geometry(g, m = null) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, f = g.attributes.aFacade;
    const nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null;
    const base = this.count, v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); if (m) v.applyMatrix4(m);
      w.fromBufferAttribute(n, i); if (nm) w.applyMatrix3(nm);
      const l = w.length();
      if (l > 1e-9) w.multiplyScalar(1 / l); else w.set(0, 1, 0);
      this.pos.push(v.x, v.y, v.z); this.nrm.push(w.x, w.y, w.z);
      this.fac.push(f ? f.getX(i) : 0, f ? f.getY(i) : v.y, f ? f.getZ(i) : 1);
    }
    const idx = g.index ? g.index.array : null;
    const nI = idx ? idx.length : p.count;
    for (let i = 0; i < nI; i++) this.idx.push(base + (idx ? idx[i] : i));
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fac, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
