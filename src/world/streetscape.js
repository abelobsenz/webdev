import * as THREE from 'three';
import { patchedMaterial } from './materials.js';
import { mulberry32 } from './noise.js';
import { ST } from './urban.js';
import { ISLANDS, promenadeAxis } from './layout.js';
import { wardRecords, wardHeight } from './metro.js';

// Street furniture: lamps on every verge, benches and litter bins along the streets, and
// the furnishing of the civic, village and landing squares (a centrepiece, a ring of
// benches and planters round it, drinking fountains, wayfinding steles, kiosks).
//
// Every model is closed from all sides (poles, caps and ends included) with analytic
// normals; each triangle's winding is checked against its normal as it is emitted. Every
// piece stands on what supports it: sunk to the lowest ground under its footprint, with a
// skirt below grade, and kept clear of the kerb hedges, the walkers' lanes and rings,
// lots, towers, stations, the promenade landings, the wards' landmarks and of each other.
// Near models are instanced per 300 m chunk and switched in by a THREE.LOD; one far
// massing mesh per kind carries every instance between the near and far distances.

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

// material codes read by the furniture shader
const B = 0, OPAL = 1, STONE = 2, WOOD = 3, WOOD_V = 4, GRAPH = 5, GLASS = 6, LEAF = 7, SOIL = 8, WATER = 9, PANEL = 10, COPPER = 11, GILT = 12, FLUTE = 13;

// near model to `near` m (chunked, casts shadows), far massing from `near` to `far` m
const LOD = {
  lamp: { near: 190, far: 1700 },
  bench: { near: 120, far: 650 },
  bin: { near: 90, far: 380 },
  planter: { near: 140, far: 800 },
  kiosk: { near: 260, far: 2200 },
  stele: { near: 110, far: 520 },
  tap: { near: 100, far: 420 },
};
const CHUNK = 300;

// ------------------------------------------------------------------ geometry kit --
const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4();

class Kit {
  constructor() { this.P = []; this.N = []; this.K = []; this.I = []; this.m = new THREE.Matrix4(); this.nm = new THREE.Matrix3(); }

  /** Placement (rotation + translation) for the parts added next. */
  at(m) { this.m.copy(m); this.nm.getNormalMatrix(m); return this; }

  v(x, y, z, nx, ny, nz, k) {
    _p.set(x, y, z).applyMatrix4(this.m);
    _n.set(nx, ny, nz).applyMatrix3(this.nm);
    const l = _n.length();
    if (l > 1e-9) _n.multiplyScalar(1 / l); else _n.set(0, 1, 0);
    this.P.push(_p.x, _p.y, _p.z); this.N.push(_n.x, _n.y, _n.z); this.K.push(k);
    return this.K.length - 1;
  }

  /** Triangle wound so its face normal agrees with its vertex normals; slivers are dropped. */
  t(a, b, c) {
    const P = this.P, N = this.N;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    if (fx * fx + fy * fy + fz * fz < 1e-14) return;
    const sx = N[a * 3] + N[b * 3] + N[c * 3], sy = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], sz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (fx * sx + fy * sy + fz * sz < 0) this.I.push(a, c, b); else this.I.push(a, b, c);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.K, 1));
    g.setIndex(this.K.length < 65536 ? new THREE.Uint16BufferAttribute(this.I, 1) : new THREE.Uint32BufferAttribute(this.I, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Solid of revolution about +y. prof = [[r, y, part, smooth], ...] from the bottom pole
 * round the outside to the top pole: the outside lies to the right of the direction of
 * travel in (r, y). `part` codes the segment starting at that point; `smooth` shares the
 * point's normal with the segment before (same part only). facet = flat facets round.
 */
function lathe(kit, prof, seg, { phase = 0, facet = false } = {}) {
  const n = prof.length;
  const sn = [];
  for (let i = 0; i < n - 1; i++) {
    const dr = prof[i + 1][0] - prof[i][0], dy = prof[i + 1][1] - prof[i][1], L = Math.hypot(dr, dy);
    sn.push(L > 1e-9 ? [dy / L, -dr / L] : null);
  }
  const avg = (a, b) => { const x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  const ang = (s) => phase + (s / seg) * TAU;
  let prev = null;
  for (let i = 0; i < n - 1; i++) {
    if (!sn[i]) { prev = null; continue; }
    const [r0, y0, k] = prof[i], [r1, y1] = prof[i + 1];
    const sm0 = !!prof[i][3] && i > 0 && !!sn[i - 1] && prof[i - 1][2] === k;
    const sm1 = !!prof[i + 1][3] && i + 1 < n - 1 && !!sn[i + 1] && prof[i + 1][2] === k;
    const nA = sm0 ? avg(sn[i - 1], sn[i]) : sn[i], nB = sm1 ? avg(sn[i], sn[i + 1]) : sn[i];
    if (facet) {
      for (let s = 0; s < seg; s++) {
        const a0 = ang(s), a1 = ang(s + 1), am = (a0 + a1) / 2;
        // flat facet: the chord plane's normal, tilted by the profile slope
        const cr = Math.cos(Math.PI / seg);
        const fn = (nn) => [nn[0] * Math.cos(am), nn[1] * cr, nn[0] * Math.sin(am)];
        const na = fn(sn[i]);
        const q = [[r0, y0, a0], [r0, y0, a1], [r1, y1, a0], [r1, y1, a1]].map(([r, y, a]) => kit.v(Math.cos(a) * r, y, Math.sin(a) * r, na[0], na[1], na[2], k));
        kit.t(q[0], q[2], q[1]); kit.t(q[1], q[2], q[3]);
      }
      prev = null;
      continue;
    }
    const ring = (r, y, nn) => {
      const out = [];
      for (let s = 0; s < seg; s++) { const a = ang(s), c = Math.cos(a), si = Math.sin(a); out.push(kit.v(c * r, y, si * r, nn[0] * c, nn[1], nn[0] * si, k)); }
      return out;
    };
    const A = sm0 && prev ? prev : ring(r0, y0, nA);
    const Bv = ring(r1, y1, nB);
    for (let s = 0; s < seg; s++) {
      const a = A[s], b = A[(s + 1) % seg], c = Bv[s], d = Bv[(s + 1) % seg];
      kit.t(a, c, b); kit.t(b, c, d);
    }
    prev = Bv;
  }
}

/** Prism along local x from x0 to x1 of a 2D section in (u = z, v = y), with holes. */
function prism(kit, outer, holes, x0, x1, k) {
  const area = (c) => { let s = 0; for (let i = 0; i < c.length; i++) { const j = (i + 1) % c.length; s += c[i][0] * c[j][1] - c[j][0] * c[i][1]; } return s / 2; };
  const O = area(outer) > 0 ? outer : [...outer].reverse();
  const H = holes.map((h) => (area(h) < 0 ? h : [...h].reverse()));
  for (const c of [O, ...H]) {
    for (let i = 0; i < c.length; i++) {
      const [u0, v0] = c[i], [u1, v1] = c[(i + 1) % c.length];
      const du = u1 - u0, dv = v1 - v0, L = Math.hypot(du, dv);
      if (L < 1e-9) continue;
      const nu = dv / L, nv = -du / L;         // material on the left: outward to the right
      const a = kit.v(x0, v0, u0, 0, nv, nu, k), b = kit.v(x1, v0, u0, 0, nv, nu, k);
      const cc = kit.v(x0, v1, u1, 0, nv, nu, k), d = kit.v(x1, v1, u1, 0, nv, nu, k);
      kit.t(a, b, cc); kit.t(b, d, cc);
    }
  }
  const tris = THREE.ShapeUtils.triangulateShape(O.map(([u, v]) => new THREE.Vector2(u, v)), H.map((h) => h.map(([u, v]) => new THREE.Vector2(u, v))));
  const pts = [...O, ...H.flat()];
  for (const [x, nx] of [[x0, -1], [x1, 1]]) {
    const base = pts.map(([u, v]) => kit.v(x, v, u, nx, 0, 0, k));
    for (const [a, b, c] of tris) kit.t(base[a], base[b], base[c]);
  }
}

/** Bar along local x (length len) with a chamfered w x h section, rounded by its normals. */
function bar(kit, len, w, h, ch, k) {
  const hw = w / 2, hh = h / 2;
  const sec = [[hw, -hh + ch], [hw, hh - ch], [hw - ch, hh], [-hw + ch, hh], [-hw, hh - ch], [-hw, -hh + ch], [-hw + ch, -hh], [hw - ch, -hh]];
  const nrm = sec.map(([u, v]) => { const x = u / (hw * hw), y = v / (hh * hh), l = Math.hypot(x, y); return [x / l, y / l]; });
  const x0 = -len / 2, x1 = len / 2;
  const A = sec.map(([u, v], i) => kit.v(x0, v, u, 0, nrm[i][1], nrm[i][0], k));
  const Bv = sec.map(([u, v], i) => kit.v(x1, v, u, 0, nrm[i][1], nrm[i][0], k));
  for (let i = 0; i < 8; i++) { const j = (i + 1) % 8; kit.t(A[i], Bv[i], A[j]); kit.t(Bv[i], Bv[j], A[j]); }
  for (const [x, nx] of [[x0, -1], [x1, 1]]) {
    const c = sec.map(([u, v]) => kit.v(x, v, u, nx, 0, 0, k));
    for (let i = 1; i < 7; i++) kit.t(c[0], c[i], c[i + 1]);
  }
}

/** Axis-aligned box, flat faces. */
function box(kit, x0, x1, y0, y1, z0, z1, k) {
  const f = (n, pts) => { const q = pts.map((p) => kit.v(p[0], p[1], p[2], n[0], n[1], n[2], k)); kit.t(q[0], q[1], q[2]); kit.t(q[0], q[2], q[3]); };
  f([1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]);
  f([-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
  f([0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]);
  f([0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
  f([0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  f([0, 0, -1], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]);
}

/** Ellipsoidal ball (icosphere) of radius r, vertical scale sy, centred at the origin. */
function ball(kit, r, sy, detail, k) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  const p = ico.attributes.position, map = new Map(), idx = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    if (!map.has(key)) map.set(key, kit.v(x * r, y * r * sy, z * r, x, y / sy, z, k));
    idx.push(map.get(key));
  }
  for (let i = 0; i < idx.length; i += 3) kit.t(idx[i], idx[i + 1], idx[i + 2]);
  ico.dispose();
}

/** Torus in the xz plane (major radius R, tube radius rt), analytic normals. */
function torus(kit, R, rt, segR, segT, k) {
  const rows = [];
  for (let i = 0; i < segR; i++) {
    const a = (i / segR) * TAU, ca = Math.cos(a), sa = Math.sin(a), row = [];
    for (let j = 0; j < segT; j++) {
      const b = (j / segT) * TAU, cb = Math.cos(b), sb = Math.sin(b);
      row.push(kit.v(ca * (R + rt * cb), rt * sb, sa * (R + rt * cb), ca * cb, sb, sa * cb, k));
    }
    rows.push(row);
  }
  for (let i = 0; i < segR; i++) for (let j = 0; j < segT; j++) {
    const a = rows[i][j], b = rows[(i + 1) % segR][j], c = rows[i][(j + 1) % segT], d = rows[(i + 1) % segR][(j + 1) % segT];
    kit.t(a, b, c); kit.t(b, d, c);
  }
}

// --------------------------------------------------------------------- models --
// Local frames: y up from the ground plane (every model reaches below it: a skirt, so small
// slopes never open a gap under it), benches and steles face +z.

// The lotus lamp: a cast bronze column on a moulded plinth (fluted drum, collars, a
// flaring stem) carrying a shallow bronze dish whose underside is an opal diffuser and
// whose rim carries a thin opal halo band, capped by a domed lid and a finial.
const LAMP_POST = [
  [0, -0.35, B], [0.2, -0.35, B], [0.2, 0.05, B], [0.182, 0.08, B], [0.155, 0.085, B],
  [0.155, 0.235, B], [0.138, 0.27, B, 1], [0.114, 0.31, B, 1], [0.104, 0.35, B],
  [0.113, 0.372, B, 1], [0.108, 0.398, B, 1], [0.094, 0.41, FLUTE], [0.087, 1.05, B],
  [0.101, 1.07, B, 1], [0.106, 1.1, B, 1], [0.1, 1.13, B, 1], [0.082, 1.15, B],
  [0.063, 4.56, B], [0.075, 4.58, B, 1], [0.078, 4.62, B, 1], [0.074, 4.66, B, 1], [0.059, 4.68, B],
  [0.057, 4.9, B, 1], [0.066, 5.05, B, 1], [0.092, 5.18, B, 1], [0.135, 5.27, B, 1], [0.15, 5.31, B], [0, 5.33, B],
];
const LAMP_HEAD = [
  [0, 5.285, B], [0.16, 5.285, OPAL], [0.47, 5.345, B], [0.55, 5.36, B, 1], [0.574, 5.382, OPAL],
  [0.58, 5.428, B], [0.566, 5.452, B, 1], [0.5, 5.49, B, 1], [0.4, 5.535, B, 1], [0.28, 5.58, B, 1],
  [0.17, 5.615, B, 1], [0.09, 5.638, B], [0.052, 5.655, B, 1], [0.042, 5.7, B, 1], [0.056, 5.735, B, 1],
  [0.05, 5.765, B, 1], [0.028, 5.8, B, 1], [0, 5.83, B],
];
function lampNear() {
  const kit = new Kit();
  lathe(kit, LAMP_POST, 10);
  lathe(kit, LAMP_HEAD, 16);
  return kit.geometry();
}
function lampFar() {
  const kit = new Kit();
  lathe(kit, [[0, -0.3, B], [0.14, -0.3, B], [0.14, 0.3, B], [0.08, 0.45, B], [0.062, 4.6, B], [0.12, 5.27, B], [0, 5.33, B]], 4, { phase: Math.PI / 4 });
  lathe(kit, [[0, 5.285, B], [0.16, 5.285, OPAL], [0.47, 5.345, B], [0.574, 5.382, OPAL], [0.58, 5.43, B], [0.3, 5.58, B], [0, 5.7, B]], 6);
  return kit.geometry();
}

// Bench: two cast bronze end frames (legs, seat rail and a reclined back support in one
// casting, joined below grade) carrying five timber seat slats and three back slats.
const BENCH_FRAME = [[0.235, -0.12], [0.235, 0.36], [0.265, 0.4], [0.265, 0.435], [-0.17, 0.435], [-0.235, 0.52], [-0.31, 0.88], [-0.36, 0.88], [-0.29, 0.5], [-0.235, 0.34], [-0.235, -0.12]];
const BENCH_GAP = [[0.17, -0.05], [0.17, 0.27], [0.13, 0.33], [-0.13, 0.33], [-0.17, 0.27], [-0.17, -0.05]];
const BENCH_BACK = { u0: -0.235, v0: 0.52, u1: -0.31, v1: 0.88 };
function benchNear() {
  const kit = new Kit();
  for (const x of [-0.8, 0.8]) prism(kit, BENCH_FRAME, [BENCH_GAP], x - 0.025, x + 0.025, B);
  for (const u of [0.215, 0.125, 0.035, -0.055, -0.145]) {
    kit.at(_m.makeTranslation(0, 0.449, u));
    bar(kit, 1.86, 0.078, 0.032, 0.009, WOOD);
  }
  // back slats in the reclined plane, their rear faces a few mm into the supports
  const { u0, v0, u1, v1 } = BENCH_BACK;
  const eu = u1 - u0, ev = v1 - v0, el = Math.hypot(eu, ev);
  const nu = ev / el, nv = -eu / el;                 // the support's front normal
  const alpha = -Math.atan2(ev, eu);
  for (const t of [0.2, 0.5, 0.8]) {
    const u = u0 + eu * t + nu * 0.012, v = v0 + ev * t + nv * 0.012;
    kit.at(new THREE.Matrix4().makeTranslation(0, v, u).multiply(new THREE.Matrix4().makeRotationX(alpha)));
    bar(kit, 1.86, 0.085, 0.03, 0.009, WOOD);
  }
  kit.at(_m.identity());
  return kit.geometry();
}
function benchFar() {
  const kit = new Kit();
  box(kit, -0.93, 0.93, 0.433, 0.466, -0.184, 0.254, WOOD);
  box(kit, -0.93, 0.93, 0.56, 0.84, -0.33, -0.27, WOOD);
  for (const x of [-0.8, 0.8]) box(kit, x - 0.025, x + 0.025, -0.1, 0.43, -0.235, 0.265, B);
  return kit.geometry();
}

// Litter bin: a graphite drum on a bronze foot ring, bronze collar and domed lid.
function binNear() {
  const kit = new Kit();
  lathe(kit, [[0, -0.15, B], [0.2, -0.15, B], [0.2, 0.05, B], [0.214, 0.07, GRAPH], [0.214, 0.64, B], [0.228, 0.66, B, 1], [0.228, 0.73, B], [0.206, 0.755, B], [0.206, 0.79, B], [0.224, 0.81, B, 1], [0.19, 0.87, B, 1], [0.1, 0.915, B, 1], [0, 0.925, B]], 12);
  return kit.geometry();
}
function binFar() {
  const kit = new Kit();
  lathe(kit, [[0, -0.1, B], [0.215, -0.1, B], [0.215, 0.07, GRAPH], [0.215, 0.64, B], [0.225, 0.81, B], [0.12, 0.905, B], [0, 0.925, B]], 6);
  return kit.geometry();
}

// Planter: a turned granite bowl filled with bark mulch and a clipped shrub.
function planterNear() {
  const kit = new Kit();
  lathe(kit, [[0, -0.2, STONE], [0.5, -0.2, STONE], [0.5, 0.06, STONE], [0.56, 0.1, STONE], [0.62, 0.52, STONE, 1], [0.68, 0.6, STONE, 1], [0.68, 0.66, STONE, 1], [0.64, 0.68, STONE], [0.615, 0.68, STONE], [0.61, 0.6, SOIL], [0, 0.6, SOIL]], 16);
  kit.at(_m.makeTranslation(0, 0.93, 0));
  ball(kit, 0.52, 0.86, 1, LEAF);
  kit.at(_m.identity());
  return kit.geometry();
}
function planterFar() {
  const kit = new Kit();
  lathe(kit, [[0, -0.2, STONE], [0.52, -0.2, STONE], [0.52, 0.08, STONE], [0.68, 0.64, STONE], [0.61, 0.66, SOIL], [0, 0.66, SOIL]], 8);
  kit.at(_m.makeTranslation(0, 0.93, 0));
  ball(kit, 0.52, 0.86, 0, LEAF);
  kit.at(_m.identity());
  return kit.geometry();
}

// Kiosk: a twelve-sided pavilion on a granite plinth, timber dado, glazed walls under a
// bronze frieze and a verdigris copper roof with a finial.
const KIOSK = [
  [0, -0.25, STONE], [1.75, -0.25, STONE], [1.75, 0.22, STONE], [1.56, 0.26, WOOD_V], [1.56, 1.02, GLASS], [1.56, 2.45, B],
  [1.56, 2.62, B], [1.98, 2.72, COPPER], [2.0, 2.8, COPPER], [1.2, 3.3, COPPER], [0.36, 3.62, B], [0.1, 3.7, B],
  [0.07, 3.9, B], [0.095, 3.96, B, 1], [0.05, 4.02, B, 1], [0, 4.1, B],
];
function kioskNear() {
  const kit = new Kit();
  lathe(kit, KIOSK, 12, { facet: true, phase: Math.PI / 12 });
  return kit.geometry();
}
function kioskFar() {
  const kit = new Kit();
  lathe(kit, [[0, -0.2, STONE], [1.75, -0.2, STONE], [1.75, 0.22, STONE], [1.56, 0.26, GLASS], [1.56, 2.62, B], [2.0, 2.8, COPPER], [0.2, 3.66, B], [0, 4.1, B]], 8, { facet: true, phase: Math.PI / 8 });
  return kit.geometry();
}

// Wayfinding stele: a granite slab with a bronze cap, a map panel set in each face.
function steleNear() {
  const kit = new Kit();
  const S = [[-0.27, -0.25], [0.27, -0.25], [0.27, 2.12], [0.2, 2.26], [-0.2, 2.26], [-0.27, 2.12]];
  kit.at(_m.makeRotationY(Math.PI / 2));          // section in (x, y) extruded along z
  prism(kit, S.map(([x, y]) => [x, y]), [], -0.09, 0.09, STONE);
  kit.at(_m.identity());
  box(kit, -0.215, 0.215, 2.24, 2.3, -0.075, 0.075, B);
  box(kit, -0.21, 0.21, 0.95, 1.9, -0.097, 0.097, PANEL);
  box(kit, -0.23, 0.23, 1.895, 1.94, -0.1, 0.1, B);
  return kit.geometry();
}
function steleFar() {
  const kit = new Kit();
  box(kit, -0.27, 0.27, -0.2, 2.26, -0.09, 0.09, STONE);
  return kit.geometry();
}

// Drinking fountain: a granite column with a bronze bowl and spout.
function tapNear() {
  const kit = new Kit();
  lathe(kit, [[0, -0.2, STONE], [0.21, -0.2, STONE], [0.21, 0.06, STONE], [0.165, 0.11, STONE, 1], [0.14, 0.2, STONE, 1], [0.13, 0.82, STONE], [0.26, 0.93, B, 1], [0.27, 0.99, B], [0.235, 1.0, B], [0.22, 0.95, B, 1], [0.1, 0.92, B], [0.035, 0.94, B], [0.022, 1.06, B, 1], [0.03, 1.09, B, 1], [0, 1.11, B]], 12);
  return kit.geometry();
}
function tapFar() {
  const kit = new Kit();
  lathe(kit, [[0, -0.2, STONE], [0.2, -0.2, STONE], [0.14, 0.2, STONE], [0.13, 0.82, STONE], [0.27, 0.97, B], [0, 1.0, B]], 5);
  return kit.geometry();
}

// Civic fountain: a granite basin (step, seat-height rim, a real depth of water), a turned
// pedestal with an upper bowl, and a bronze armillary sphere on its axis rod: three great
// circles, the tilted ecliptic band and an inclined ring round a gilded core.
function fountain(kit, R) {
  lathe(kit, [
    [0, -0.6, STONE], [R + 0.6, -0.6, STONE], [R + 0.6, 0.12, STONE], [R + 0.5, 0.16, STONE], [R + 0.08, 0.16, STONE],
    [R, 0.2, STONE], [R, 0.6, STONE, 1], [R - 0.08, 0.68, STONE, 1], [R - 0.42, 0.68, STONE, 1], [R - 0.5, 0.6, STONE],
    [R - 0.5, 0.46, WATER], [1.45, 0.46, STONE], [1.35, 0.55, STONE, 1], [1.2, 0.62, STONE, 1], [0.86, 1.4, STONE, 1],
    [0.76, 2.08, STONE, 1], [0.9, 2.2, STONE], [2.4, 2.38, STONE, 1], [2.62, 2.46, STONE, 1], [2.6, 2.56, STONE, 1],
    [2.46, 2.56, STONE], [2.43, 2.49, WATER], [0.62, 2.49, STONE], [0.55, 2.6, STONE, 1], [0.48, 3.6, STONE, 1],
    [0.5, 4.1, STONE, 1], [0.85, 4.3, STONE, 1], [0.8, 4.42, STONE, 1], [0.35, 4.5, STONE, 1], [0.12, 4.55, B],
    [0.075, 4.6, B], [0.075, 7.1, GILT], [0.35, 7.35, GILT, 1], [0.5, 7.8, GILT, 1], [0.35, 8.25, GILT, 1], [0.075, 8.5, B],
    [0.075, 11.3, B], [0.12, 11.42, B, 1], [0.1, 11.56, B, 1], [0, 11.7, B],
  ], 40);
  const base = kit.m.clone();
  const c = new THREE.Matrix4().makeTranslation(0, 7.8, 0);
  const ring = (rot, R0, rt, k) => { kit.at(base.clone().multiply(c).multiply(rot)); torus(kit, R0, rt, 56, 6, k); };
  const rx = (a) => new THREE.Matrix4().makeRotationX(a), ry = (a) => new THREE.Matrix4().makeRotationY(a);
  // every ring is carried: the colures pass through the rod, the equator and the ecliptic
  // cross the colures, the inner colure hangs on the rod
  ring(new THREE.Matrix4(), 3.4, 0.09, B);                                       // equator
  ring(rx(Math.PI / 2), 3.4, 0.09, B);                                            // colures
  ring(ry(Math.PI / 2).multiply(rx(Math.PI / 2)), 3.4, 0.09, B);
  ring(rx(0.41), 3.4, 0.15, GILT);                                                // the ecliptic band
  ring(ry(Math.PI / 4).multiply(rx(Math.PI / 2)), 2.72, 0.06, B);
  kit.at(base);
}

// Village obelisk: a granite pool with its drum, a four-sided shaft and a gilded pyramidion.
function obelisk(kit) {
  lathe(kit, [
    [0, -0.6, STONE], [3.5, -0.6, STONE], [3.5, 0.12, STONE], [3.42, 0.16, STONE], [3.2, 0.16, STONE], [3.12, 0.2, STONE],
    [3.12, 0.56, STONE, 1], [3.04, 0.64, STONE, 1], [2.74, 0.64, STONE, 1], [2.68, 0.58, STONE], [2.68, 0.44, WATER],
    [1.36, 0.44, STONE], [1.3, 0.5, STONE], [1.3, 1.28, STONE, 1], [1.36, 1.34, STONE, 1], [1.3, 1.4, STONE], [0, 1.4, STONE],
  ], 32);
  const base = kit.m.clone();
  lathe(kit, [[0, 1.36, STONE], [0.78, 1.36, STONE], [0.74, 1.46, STONE], [0.5, 9.5, GILT], [0, 10.45, GILT]], 4, { phase: Math.PI / 4, facet: true });
  kit.at(base);
}

// ------------------------------------------------------------------- material --
const _mats = new Map();
function furnitureMaterial(near, far) {
  const key = `${near}|${far}`;
  if (_mats.has(key)) return _mats.get(key);
  const mat = patchedMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.0, envMapIntensity: 0.9 }, {
    key: 'streetFurniture1',
    uniforms: { uLod: { value: new THREE.Vector2(near, far) } },
    vertex: {
      pars: /* glsl */ `
attribute float aPart;
attribute float aLit;
uniform vec2 uLod;
varying float vPart;
varying float vSeed;
varying float vLit;
varying vec3 vObjN;
varying vec2 vAx;`,
      transform: /* glsl */ `
vPart = aPart;
vLit = aLit;
vObjN = objectNormal;
{
#ifdef USE_INSTANCING
  // each instance is drawn only inside its distance band (near model, or far massing)
  vec3 ip = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  vec2 ax = instanceMatrix[0].xz;
  vAx = ax / max(length(ax), 1e-5);
  float dl = distance(ip, cameraPosition);
  if (dl < uLod.x || dl > uLod.y) transformed = vec3(0.0);
#else
  vec3 ip = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vAx = vec2(1.0, 0.0);
#endif
  vSeed = hash12(floor(ip.xz * 3.0) + 0.5);
}`,
    },
    fragment: {
      pars: /* glsl */ `
varying float vPart;
varying float vSeed;
varying float vLit;
varying vec3 vObjN;
varying vec2 vAx;
float sfRough; float sfMetal; vec3 sfN; vec3 sfEmit;
// object-space vector to world space (instances turn about y only)
vec3 sfWorld(vec3 v) { return vec3(vAx.x * v.x - vAx.y * v.z, v.y, vAx.y * v.x + vAx.x * v.z); }
vec3 sfGrad3(vec3 q) { return vec3(vnoise3(q), vnoise3(q + vec3(5.2, 1.3, 7.7)), vnoise3(q + vec3(9.1, 4.7, 2.3))) - 0.5; }`,
      color: /* glsl */ `
{
  float part = floor(vPart + 0.5);
  vec3 p = vObjPos;
  vec3 on = vObjN / max(length(vObjN), 1e-4);
  float fw = max(length(fwidth(p)), 1e-5);
  float dA = 1.0 - smoothstep(0.003, 0.018, fw);     // millimetre-to-centimetre detail resolvable
  float dB = 1.0 - smoothstep(0.02, 0.12, fw);       // centimetre-to-decimetre detail
  vec3 c = vec3(0.5);
  sfRough = 0.6; sfMetal = 0.0; sfN = vec3(0.0); sfEmit = vec3(0.0);
  if (part < 0.5 || part > 12.5) {
    // cast bronze: warm and dark, brushed where hands and weather polish it, a verdigris
    // bloom settling on the sheltered and lower parts; fine casting grain up close
    float g1 = vnoise3(p * 23.0 + vSeed * 17.0);
    float g2 = vnoise3(p * 2.7 + vSeed * 5.0);
    float shelter = 1.0 - smoothstep(-0.3, 0.7, on.y);
    float low = 1.0 - smoothstep(0.0, 1.4, p.y);
    float pat = smoothstep(0.52, 0.86, g2 * 0.72 + shelter * 0.22 + low * 0.3);
    vec3 bronze = vec3(0.3, 0.2, 0.11) * (0.86 + 0.28 * mix(0.5, g1, dA));
    vec3 verd = vec3(0.22, 0.35, 0.3) * (0.8 + 0.4 * mix(0.5, g1, dA));
    c = mix(bronze, verd, pat * 0.75);
    sfMetal = mix(0.88, 0.2, pat);
    sfRough = mix(0.34 + 0.12 * g2, 0.66, pat);
    sfN = sfGrad3(p * 61.0) * 0.12 * dA;
    if (part > 12.5) {
      // fluted drum: sixteen flutes round the column
      float a = atan(p.z, p.x + 1e-6);
      float fl = sin(a * 16.0);
      float dF = 1.0 - smoothstep(0.004, 0.012, fw);
      sfN += vec3(-sin(a), 0.0, cos(a)) * fl * 0.45 * dF;
      c *= 1.0 - 0.18 * (1.0 - abs(fl)) * dF;
    }
  } else if (part < 1.5) {
    // opal glass diffuser
    c = vec3(0.86, 0.85, 0.8);
    sfRough = 0.32;
    vec3 warm = mix(vec3(1.0, 0.72, 0.45), vec3(1.0, 0.8, 0.6), vSeed);
#ifdef USE_COLOR
    warm = mix(warm, vColor.rgb * 1.1, 0.8);      // a district's own light (the Outer Wards)
#endif
    float rq = (length(p.xz) - 0.32) / 0.12;
    float ring = 0.75 + 0.45 * exp(-rq * rq);       // brightest in a ring round the stem
    sfEmit = warm * uCityLights * 2.6 * ring;
  } else if (part < 2.5) {
    // pale granite: speckle at three scales, each fading to its average with distance
    float s1 = hash13(floor(p * 90.0 + vSeed * 31.0));
    float s2 = vnoise3(p * 9.0 + vSeed * 3.0);
    float s3 = vnoise3(p * 1.3 + 4.0);
    c = vec3(0.63, 0.61, 0.57) * (0.88 + 0.16 * s3) * (0.92 + 0.12 * mix(0.5, s2, dB));
    c *= mix(1.0, 0.78 + 0.44 * s1, dA * 0.55);
    sfRough = 0.74;
    sfN = sfGrad3(p * 9.0 + 2.0) * 0.08 * dB;
  } else if (part < 4.5) {
    // hardwood: long grain along the slat (or up the boards), its figure and pores
    vec3 q = part < 3.5 ? p : p.yxz;
    float fig = vnoise(vec2(q.x * 0.7, (q.y + q.z) * 9.0 + vSeed * 13.0));
    float gA = vnoise(vec2(q.x * 1.6, (q.y + q.z) * 58.0 + vSeed * 40.0));
    float gB = vnoise(vec2(q.x * 1.6, (q.y + q.z) * 58.0 + vSeed * 40.0 + 0.35));
    float lines = mix(0.5, gA, dA);
    c = mix(vec3(0.34, 0.2, 0.11), vec3(0.56, 0.37, 0.2), fig * 0.55 + lines * 0.45);
    c = mix(c, vec3(0.5, 0.47, 0.43), 0.22 * max(on.y, 0.0));          // sun-silvered tops
    sfRough = 0.64;
    vec3 gd = part < 3.5 ? vec3(0.0, 1.0, 1.0) : vec3(1.0, 0.0, 1.0);
    sfN = gd * (gB - gA) * 0.6 * dA;
  } else if (part < 5.5) {
    // graphite powder coat with a faint orange peel
    c = vec3(0.075, 0.08, 0.086) * (0.9 + 0.2 * vnoise3(p * 3.0 + vSeed * 7.0));
    sfRough = 0.46; sfMetal = 0.3;
    sfN = sfGrad3(p * 45.0) * 0.06 * dA;
  } else if (part < 6.5) {
    // kiosk glazing between bronze mullions and a transom; lit from within at night
    float r = max(length(p.xz), 0.1);
    float a = atan(p.z, p.x + 1e-6) / 6.2831853 * 12.0 - 0.5;
    float fa = abs(fract(a) - 0.5);
    float fwa = fw / (r * 0.5236);
    float mull = smoothstep(0.455 - fwa, 0.455 + fwa, fa);
    float tr = 1.0 - smoothstep(0.03 - fw, 0.03 + fw, abs(p.y - 1.98));
    float frame = max(mull, tr);
    c = mix(vec3(0.05, 0.065, 0.07), vec3(0.3, 0.2, 0.11), frame);
    sfRough = mix(0.08, 0.4, frame); sfMetal = mix(0.0, 0.85, frame);
    float shelf = 0.6 + 0.4 * smoothstep(0.3, 0.7, vnoise(vec2(a * 3.0, p.y * 6.0)));
    sfEmit = vec3(1.0, 0.76, 0.46) * uCityLights * 0.9 * shelf * (1.0 - frame);
  } else if (part < 7.5) {
    // clipped shrub: leaf clusters at two scales, darker underneath
    vec3 wq = vWPos * 6.0;
    float l1 = vnoise3(wq), l2 = vnoise3(wq * 2.7 + 3.0);
    c = mix(vec3(0.035, 0.08, 0.025), vec3(0.12, 0.2, 0.05), l1 * 0.6 + mix(0.5, l2, dB) * 0.4);
    c *= mix(0.55, 1.0, smoothstep(-0.4, 0.8, on.y));
    sfRough = 0.84;
    sfN = sfGrad3(wq * 2.7 + 11.0) * 1.1 * dB;
  } else if (part < 8.5) {
    // bark mulch
    float m1 = vnoise(p.xz * 38.0 + vSeed * 9.0);
    c = mix(vec3(0.07, 0.05, 0.035), vec3(0.17, 0.11, 0.065), mix(0.5, m1, dA));
    sfRough = 0.92;
  } else if (part < 9.5) {
    // still water: a dark clear pool, slow wind ripples as normal detail only (bounded
    // highlight: never glassy enough to flash)
    vec2 wp = vWPos.xz;
    vec3 r1 = vnoised(wp * 1.3 + vec2(uTime * 0.11, uTime * 0.07));
    vec3 r2 = vnoised(wp * 3.1 - vec2(uTime * 0.09, -uTime * 0.13));
    vec2 gr = r1.yz * 1.3 * 0.035 + r2.yz * 3.1 * 0.012;
    c = vec3(0.03, 0.07, 0.075);
    sfRough = 0.14;
    sfN = vec3(-gr.x, 0.0, -gr.y) * dB;
  } else if (part < 10.5) {
    // wayfinding panel: a backlit map (street lines, a few districts) on dark glass
    vec2 m = p.xy * vec2(9.0, 9.0);
    float gx = abs(fract(m.x + 0.3 * vnoise(m * 0.4)) - 0.5), gy = abs(fract(m.y + 0.3 * vnoise(m * 0.4 + 5.0)) - 0.5);
    float fm = fw * 9.0;
    float lines = max(1.0 - smoothstep(0.03, 0.03 + fm, gx), 1.0 - smoothstep(0.03, 0.03 + fm, gy));
    lines = mix(0.12, lines, 1.0 - smoothstep(0.02, 0.06, fw));
    float blob = smoothstep(0.55, 0.7, vnoise(p.xy * 5.0 + 3.0));
    c = vec3(0.03, 0.035, 0.04) + vec3(0.1, 0.12, 0.13) * lines + vec3(0.06, 0.1, 0.05) * blob;
    sfRough = 0.18;
    sfEmit = vec3(0.7, 0.82, 1.0) * uCityLights * (0.1 + 0.55 * lines + 0.2 * blob);
  } else if (part < 11.5) {
    // verdigris copper roof with standing seams at the facet edges
    float r = max(length(p.xz), 0.1);
    float a = atan(p.z, p.x + 1e-6) / 6.2831853 * 12.0 - 0.5;
    float fa = abs(fract(a) - 0.5);
    float seam = smoothstep(0.46 - fw / (r * 0.5236), 0.46 + fw / (r * 0.5236), fa);
    float v1 = vnoise3(p * 2.2 + vSeed * 3.0), v2 = vnoise3(p * 11.0);
    c = mix(vec3(0.25, 0.43, 0.37), vec3(0.15, 0.29, 0.25), v1 * 0.7 + mix(0.5, v2, dB) * 0.3);
    c = mix(c, vec3(0.13, 0.2, 0.17), seam * 0.6);
    sfRough = 0.6; sfMetal = 0.2;
  } else {
    // gilded bronze: bright by day, a warm glow at night
    c = vec3(0.78, 0.57, 0.26) * (0.9 + 0.2 * vnoise3(p * 4.0));
    sfMetal = 0.95; sfRough = 0.3;
    sfEmit = vec3(1.0, 0.72, 0.4) * uCityLights * 1.6;
  }
  diffuseColor.rgb = c;
}`,
      surface: 'roughnessFactor = sfRough; metalnessFactor = sfMetal;',
      normal: 'normal = normalize(normal + (viewMatrix * vec4(sfWorld(sfN), 0.0)).xyz);',
      emissive: /* glsl */ `
totalEmissiveRadiance += sfEmit;
// the street lamps' light on the furniture below them (the same pools the ground bakes)
totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.74, 0.48) * vLit * uCityLights * (0.35 + 0.55 * max(vWNrm.y, 0.0));`,
    },
  });
  _mats.set(key, mat);
  return mat;
}

// ---------------------------------------------------------------- instancing --
const _q = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1), _t = new THREE.Vector3(), _c = new THREE.Color();

function instanced(base, mat, list, ox, oy, oz) {
  const g = new THREE.BufferGeometry();
  g.setIndex(base.index);
  for (const k of ['position', 'normal', 'aPart']) g.setAttribute(k, base.attributes[k]);
  g.boundingSphere = base.boundingSphere.clone();
  const mesh = new THREE.InstancedMesh(g, mat, list.length);
  const lit = new Float32Array(list.length);
  list.forEach((it, i) => {
    _q.setFromAxisAngle(UP, it.yaw);
    _m.compose(_t.set(it.x - ox, it.y - oy, it.z - oz), _q, _one);
    mesh.setMatrixAt(i, _m);
    lit[i] = it.lit;
  });
  if (list.some((it) => it.tint)) list.forEach((it, i) => { const t = it.tint || [1, 0.78, 0.55]; mesh.setColorAt(i, _c.setRGB(t[0], t[1], t[2])); });
  g.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  mesh.layers.set(1);
  return mesh;
}

class FurnitureSet {
  constructor(kind, near, far, { shadow = true } = {}) { this.kind = kind; this.near = near; this.far = far; this.shadow = shadow; this.items = []; }

  add(x, y, z, yaw, lit = 0, tint = null) { this.items.push({ x, y, z, yaw, lit, tint }); }

  build(group) {
    if (!this.items.length) return;
    const L = LOD[this.kind];
    const nearMat = furnitureMaterial(-1, L.near), farMat = furnitureMaterial(L.near, L.far);
    const chunks = new Map();
    for (const it of this.items) {
      const k = `${Math.floor(it.x / CHUNK)},${Math.floor(it.z / CHUNK)}`;
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(it);
    }
    // the chunk switches its near models in while any of them can be inside `near`
    const reach = L.near + CHUNK * 0.71 + 60;
    for (const list of chunks.values()) {
      let cx = 0, cy = 0, cz = 0;
      for (const it of list) { cx += it.x; cy += it.y; cz += it.z; }
      cx /= list.length; cy /= list.length; cz /= list.length;
      const mesh = instanced(this.near, nearMat, list, cx, cy, cz);
      mesh.castShadow = this.shadow;
      const lod = new THREE.LOD();
      lod.position.set(cx, cy, cz);
      lod.addLevel(mesh, 0);
      lod.addLevel(new THREE.Object3D(), reach);
      lod.layers.set(1);
      lod.updateMatrix();
      lod.matrixAutoUpdate = false;
      mesh.matrixAutoUpdate = false;
      group.add(lod);
    }
    const far = instanced(this.far, farMat, this.items, 0, 0, 0);
    far.castShadow = false;
    far.matrixAutoUpdate = false;
    group.add(far);
  }
}

// ------------------------------------------------------------------ placement --
// Occupancy of everything placed so far (circles), so nothing lands in anything else.
class Occupancy {
  constructor() { this.g = new Map(); }
  _k(i, j) { return `${i},${j}`; }
  free(x, z, r) {
    const G = 8, i0 = Math.floor((x - r - 3) / G), i1 = Math.floor((x + r + 3) / G), j0 = Math.floor((z - r - 3) / G), j1 = Math.floor((z + r + 3) / G);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = this.g.get(this._k(i, j));
      if (l) for (const o of l) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
    }
    return true;
  }
  add(x, z, r) { const k = this._k(Math.floor(x / 8), Math.floor(z / 8)); if (!this.g.has(k)) this.g.set(k, []); this.g.get(k).push({ x, z, r }); }
}

/** World points of a local rectangle (x across [-hx, hx], z across [z0, z1]) at yaw. */
function footprint(x, z, yaw, hx, z0, z1) {
  const c = Math.cos(yaw), s = Math.sin(yaw), out = [];
  for (const lx of [-hx, 0, hx]) for (const lz of [z0, (z0 + z1) / 2, z1]) out.push([x + lx * c + lz * s, z - lx * s + lz * c]);
  return out;
}

// The clipped hedges groundCover.js grows on the kerb side of every verge bed (a street's
// kerb line + 0.66 m wherever the street field agrees), rebuilt as segments so the
// furniture can keep clear of them.
function hedgeLines(plan, ground) {
  const segs = [], f = plan.field;
  const stations = plan.squares.filter((q) => q.kind === 'station');
  plan.streets.forEach((st) => {
    if (st.cls === ST.LANE) return;
    const P = st.pts;
    for (const sgn of [-1, 1]) {
      let run = [], acc = 0;
      const flush = () => { if (run.length >= 3) for (let i = 1; i < run.length; i++) segs.push([run[i - 1][0], run[i - 1][1], run[i][0], run[i][1]]); run = []; };
      for (let i = 1; i < P.length; i++) {
        const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1], L = Math.hypot(dx, dz);
        if (L < 1e-6) continue;
        const nx = -dz / L, nz = dx / L;
        for (let s = acc; s < L; s += 2.0) {
          const t = s / L;
          const x = P[i - 1][0] + dx * t + nx * sgn * (st.hw + 0.66), z = P[i - 1][1] + dz * t + nz * sgn * (st.hw + 0.66);
          const e = f.edge(x, z);
          const ok = e > 0.45 && e < 0.9 && f.squareAt(x, z) < 0.05 && ground(x, z) > 1.8 && !stations.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 3);
          if (ok) run.push([x, z]); else flush();
          acc = s + 2.0 - L;
        }
      }
      flush();
    }
  });
  const G = 16, grid = new Map();
  for (const s of segs) {
    const i0 = Math.floor(Math.min(s[0], s[2]) / G), i1 = Math.floor(Math.max(s[0], s[2]) / G), j0 = Math.floor(Math.min(s[1], s[3]) / G), j1 = Math.floor(Math.max(s[1], s[3]) / G);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = `${i},${j}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s); }
  }
  /** Distance (m) from (x, z) to the nearest hedge centreline (capped at 20). */
  return (x, z) => {
    let best = 20;
    const i = Math.floor(x / G), j = Math.floor(z / G);
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
      const l = grid.get(`${a},${b}`);
      if (l) for (const [ax, az, bx, bz] of l) {
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2));
        best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
      }
    }
    return best;
  };
}

// The Outer Wards: which ward a point is on, its reserved sites (landmarks, stations) and
// designed trees. Read from the ward records metro.js builds before the streetscape.
function wardLookup() {
  let recs = null;
  try { recs = wardRecords(); } catch (e) { recs = null; }
  if (!recs) return null;
  const find = (x, z) => recs.find((r) => Math.abs(x - r.w.x) < r.half && Math.abs(z - r.w.z) < r.half) || null;
  return {
    find,
    /** 2 where a landmark site or a station is reserved (and so no furniture goes). */
    reserved(x, z) {
      const r = find(x, z);
      const P = r && r.plan;
      if (!P || !P.reserve || !P.field) return 2;
      const N = P.field.N, cell = P.field.cell;
      const i = Math.floor((x - r.w.x + P.half) / cell), j = Math.floor((z - r.w.z + P.half) / cell);
      if (i < 0 || j < 0 || i >= N || j >= N) return 2;
      return P.reserve[j * N + i];
    },
    trees(x, z) {
      const r = find(x, z);
      return (r && r.plan && r.plan.raw && r.plan.raw.trees ? r.plan.raw.trees : []).map((t) => [r.w.x + t.x, r.w.z + t.z]);
    },
  };
}

export function buildStreetscape(scene, plan, ground, extraLamps = []) {
  const rnd = mulberry32(777);
  const field = plan.field;
  const out = { meshes: [], colliders: [] };
  const group = new THREE.Group();
  group.name = 'Streetscape';
  scene.add(group);
  out.meshes.push(group);
  const occ = new Occupancy();
  // the lagoon's town plan carries its exclusions and lots; a ward's plan does not (its
  // towers stand in 'tower' squares, its landmark sites and stations in the reserve map)
  const inner = Array.isArray(plan.exclusions);
  const excl = inner ? plan.exclusions : plan.squares.filter((q) => q.kind === 'tower').map((q) => ({ x: q.x, z: q.z, r: q.r - 6 }));
  const lots = inner && plan.lots ? plan.lots : [];
  const lotGrid = new Map();
  for (const L of lots) { const k = `${Math.floor(L.x / 64)},${Math.floor(L.z / 64)}`; if (!lotGrid.has(k)) lotGrid.set(k, []); lotGrid.get(k).push(L); }
  const inLot = (x, z, pad) => {
    const i = Math.floor(x / 64), j = Math.floor(z / 64);
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
      const l = lotGrid.get(`${a},${b}`);
      if (l) for (const L of l) {
        const c = Math.cos(L.rot), s = Math.sin(L.rot), dx = x - L.x, dz = z - L.z;
        if (Math.abs(dx * c - dz * s) < L.w / 2 + pad && Math.abs(dx * s + dz * c) < L.d / 2 + pad) return true;
      }
    }
    return false;
  };
  const excluded = (x, z, pad) => excl.some((e) => Math.hypot(e.x - x, e.z - z) < e.r + pad);
  const hedge = inner && plan.streets.length ? hedgeLines(plan, ground) : () => 20;
  const ward = !inner && plan.streets.length ? wardLookup() : null;
  const wardTrees = new Map();
  const nearWardTree = (x, z, r) => {
    if (!ward) return false;
    const rec = ward.find(x, z);
    if (!rec) return false;
    if (!wardTrees.has(rec)) wardTrees.set(rec, ward.trees(x, z));
    return wardTrees.get(rec).some(([tx, tz]) => Math.hypot(tx - x, tz - z) < r);
  };
  // the ground under a footprint: lowest point (nothing floats) and the spread (nothing on
  // a slope steeper than its skirt can take)
  const groundOf = (pts) => {
    let lo = Infinity, hi = -Infinity;
    for (const [x, z] of pts) { const g = ground(x, z); lo = Math.min(lo, g); hi = Math.max(hi, g); }
    return { lo, hi };
  };
  const lampList = [];

  // ---- lamps
  // Plan lamps stand on the verge 0.9 m behind the kerb, where the verge's clipped hedge
  // grows (0.40-0.93 m): on the hedged streets they step back 0.45 m, into the bed behind
  // it. Any lamp still in a hedge, in a lot, on another lamp or in the water is dropped.
  const lampSet = new FurnitureSet('lamp', lampNear(), lampFar());
  const addLamp = (l, x, z, y) => {
    lampList.push({ ...l, x, y, z });
    lampSet.add(x, y, z, l.yaw || 0, 0, l.tint || null);
    occ.add(x, z, 0.3);
  };
  for (const l of plan.lamps) {
    let x = l.x, z = l.z;
    const fx = Math.sin(l.yaw || 0), fz = Math.cos(l.yaw || 0);        // toward the street
    if (inner && l.cls >= ST.STREET) {
      const x2 = x - fx * 0.45, z2 = z - fz * 0.45;
      const e2 = field.edge(x2, z2);
      if (e2 > 1.1 && e2 < 1.9 && field.squareAt(x2, z2) < 0.05 && !inLot(x2, z2, 0.5)) { x = x2; z = z2; }
    }
    if (inner && (hedge(x, z) < 0.55 || inLot(x, z, 0.3))) continue;
    if (!occ.free(x, z, 0.5)) continue;
    const pts = [[x, z], [x + 0.2, z], [x - 0.2, z], [x, z + 0.2], [x, z - 0.2]];
    let y;
    if (l.y !== undefined && l.y !== null) y = l.y;
    else {
      const g = groundOf(pts);
      if (g.lo < 0.6 || g.hi - g.lo > 0.25) continue;
      y = g.lo - 0.02;
    }
    addLamp(l, x, z, y);
  }
  for (const l of extraLamps) {
    if (!occ.free(l.x, l.z, 0.45)) continue;
    addLamp(l, l.x, l.z, l.y);
  }
  out.lamps = lampList;

  // ---- squares: a centrepiece, a ring of benches and planters round it, drinking
  // fountains and a wayfinding stele in the ring, kiosks on the civic squares, benches
  // between the rim lamps where the walkers leave room
  const benchSet = new FurnitureSet('bench', benchNear(), benchFar());
  const binSet = new FurnitureSet('bin', binNear(), binFar());
  const planterSet = new FurnitureSet('planter', planterNear(), planterFar());
  const kioskSet = new FurnitureSet('kiosk', kioskNear(), kioskFar());
  const steleSet = new FurnitureSet('stele', steleNear(), steleFar());
  const tapSet = new FurnitureSet('tap', tapNear(), tapFar());
  const benches = [];
  // street-lamp light on a piece of furniture at night: the pools the street field bakes
  // (urban.js StreetField.lamp: 235 * exp(-d^2 / 2 / 5.2^2) per lamp), squared as the terrain does
  const lampGrid = new Map();
  for (const l of lampList) { const k = `${Math.floor(l.x / 16)},${Math.floor(l.z / 16)}`; if (!lampGrid.has(k)) lampGrid.set(k, []); lampGrid.get(k).push(l); }
  const litAt = (x, z) => {
    let a = 0;
    const i = Math.floor(x / 16), j = Math.floor(z / 16);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const l = lampGrid.get(`${i + di},${j + dj}`);
      if (l) for (const q of l) { const d2 = (q.x - x) ** 2 + (q.z - z) ** 2; a += (235 * (q.cls === ST.LANE ? 0.75 : 1) * Math.exp(-d2 / (2 * 5.2 * 5.2))) / 255; }
    }
    a = Math.min(1, a);
    return a * a;
  };
  const centreKit = new Kit();
  const centreLit = [];

  const squareBand = (q) => {
    // the ring the square's walkers keep to (people.js), padded by a body's width
    if (inner) return [q.r * 0.52 - 0.45, q.r * 0.92 + 0.45];
    if (q.r < 16) return null;
    const rr = (q.kind === 'crown' ? 0.86 : 0.7) * q.r, half = Math.min(q.r * 0.12, 9);
    return [rr - half - 0.45, rr + half + 0.45];
  };
  for (const q of plan.squares) {
    const kind = q.kind;
    if (kind !== 'civic' && kind !== 'village' && kind !== 'landing' && kind !== 'rond') continue;
    const band = squareBand(q);
    // the promenade deck lands at an inner landing square's centre, from the Axis side
    let deck = null;
    if (inner && kind === 'landing') {
      const isl = ISLANDS.find((i) => i.id === q.district);
      if (isl) { const ax = promenadeAxis(isl); deck = { dx: ax.dir.x, dz: ax.dir.z }; }
      else continue;
    }
    const level = inner ? null : wardHeight(q.x, q.z);
    const okAt = (x, z) => {
      if (field.squareAt(x, z) < 0.5 || field.edge(x, z) < 0.5) return false;
      if (excluded(x, z, 2)) return false;
      if (deck) {
        const u = (x - q.x) * deck.dx + (z - q.z) * deck.dz, v = -(x - q.x) * deck.dz + (z - q.z) * deck.dx;
        if (u < 4 && Math.abs(v) < 17) return false;
      }
      if (inner) return ground(x, z) > 1.2;
      if (Math.abs(wardHeight(x, z) - level) > 0.05) return false;
      return ward ? ward.reserved(x, z) !== 2 : false;
    };
    const place = (set, x, z, yaw, r, pts, tol = 0.2) => {
      if (!pts.every(([px, pz]) => okAt(px, pz))) return false;
      if (!occ.free(x, z, r) || nearWardTree(x, z, r + 1.2)) return false;
      const g = groundOf(pts);
      if (g.hi - g.lo > tol) return false;
      set.add(x, g.lo - 0.02, z, yaw, litAt(x, z));
      occ.add(x, z, r);
      return true;
    };
    const ringPts = (x, z, r, n = 12) => { const o = [[x, z]]; for (let k = 0; k < n; k++) o.push([x + Math.cos((k / n) * TAU) * r, z + Math.sin((k / n) * TAU) * r]); return o; };
    const innerEdge = band ? band[0] : q.r - 3;
    // centrepiece
    let Rc = 0;
    if (!deck) {
      const civic = kind === 'civic';
      const R = civic ? Math.min(11, q.r * 0.3, innerEdge - 6.5) : 3.5;
      const Rout = civic ? R + 0.6 : 3.5;
      if ((civic ? R >= 3.5 : innerEdge >= 10) && occ.free(q.x, q.z, Rout)) {
        const pts = ringPts(q.x, q.z, Rout + 0.3, 16);
        const g = groundOf(pts);
        if (pts.every(([x, z]) => okAt(x, z)) && g.hi - g.lo < 0.5) {
          // on its plinth: the lowest point of the footprint, lifted by the fall across it
          const y = g.lo - 0.02 + (g.hi - g.lo);
          const rot = rnd() * TAU;
          centreKit.at(new THREE.Matrix4().makeTranslation(q.x, y, q.z).multiply(new THREE.Matrix4().makeRotationY(rot)));
          const v0 = centreKit.K.length;
          if (civic) fountain(centreKit, R); else obelisk(centreKit);
          centreLit.push([v0, centreKit.K.length, litAt(q.x, q.z)]);
          occ.add(q.x, q.z, Rout);
          Rc = Rout;
          out.colliders.push({ x: q.x, z: q.z, y0: y - 1, y1: y + (civic ? 11.7 : 10.45), radius: (yy) => (yy - y < 0.8 ? Rout : civic ? 3.5 : 1.3) });
        }
      }
    }
    // the ring round it (benches face the centre, their backs to the walkers)
    const rb = deck ? Math.min(9, innerEdge - 0.45) : Math.max(Rc + 3.4, Math.min(innerEdge - 0.45, Rc + 4.2));
    if (rb + 0.4 <= innerEdge && rb > 3) {
      const n = Math.max(4, Math.floor((TAU * rb) / 4.4));
      const a0 = rnd() * TAU;
      let benchK = 0;
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const x = q.x + ca * rb, z = q.z + sa * rb;
        const yaw = Math.atan2(-ca, -sa);
        if (k % 2 === 0) {
          const pts = footprint(x, z, yaw, 0.96, -0.37, 0.28);
          if (place(benchSet, x, z, yaw, 1.05, pts)) { benches.push({ x, z, yaw }); benchK++; }
        } else if (k === 1 && !deck) {
          place(tapSet, x, z, yaw, 0.35, ringPts(x, z, 0.3, 6));
        } else if (k === 3 || (deck && k === 1)) {
          // the stele faces out, toward the arrivals (or the deck end)
          place(steleSet, x, z, yaw + Math.PI, 0.4, footprint(x, z, yaw, 0.3, -0.12, 0.12));
        } else {
          place(planterSet, x, z, rnd() * TAU, 0.72, ringPts(x, z, 0.7, 8));
        }
      }
    }
    // kiosks on the civic squares, between the ring and the walkers
    if (kind === 'civic') {
      const rk = rb + 5.5;
      if (rk + 2.4 <= innerEdge) {
        const a0 = rnd() * TAU;
        for (let k = 0; k < 4; k++) {
          const a = a0 + (k / 4) * TAU + 0.35, x = q.x + Math.cos(a) * rk, z = q.z + Math.sin(a) * rk;
          if (place(kioskSet, x, z, rnd() * TAU, 2.2, ringPts(x, z, 2.1, 10), 0.3)) out.colliders.push({ x, z, y0: ground(x, z) - 1, y1: ground(x, z) + 4.1, radius: () => 2.1 });
        }
      }
    }
    // benches between the rim lamps, facing in, where the walkers leave a strip
    if (band && q.r - 2.9 - (band[1] + 0.4) >= 0) {
      const ro = (band[1] + 0.4 + q.r - 2.9) / 2;
      const n = Math.floor((TAU * ro) / 11);
      const a0 = rnd() * TAU;
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const x = q.x + ca * ro, z = q.z + sa * ro, yaw = Math.atan2(-ca, -sa);
        if (place(benchSet, x, z, yaw, 1.05, footprint(x, z, yaw, 0.96, -0.37, 0.28))) benches.push({ x, z, yaw });
      }
    }
  }

  // ---- benches (and a litter bin by every other one) along the streets
  // In the lagoon's towns the walk is the whole carriageway and a clipped hedge lines the
  // verge: benches stand on the kerb course with their backs to the hedge, clear of the
  // walkers (who keep a metre inside the kerb) and of the gutter grates (every 24 m). In the
  // wards they stand on the pavement between the lamps and the street trees.
  const streetSpots = (st) => {
    const every = st.cls === ST.STREET ? 64 : 36;
    const out2 = [];
    const P = st.pts;
    let acc = every * 0.4 + (st.hw * 7.3) % 11, s0 = 0, k = 0;
    for (let i = 1; i < P.length; i++) {
      const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1], L = Math.hypot(dx, dz);
      if (L < 1e-6) continue;
      acc += L;
      while (acc >= every) {
        acc -= every;
        const t = 1 - acc / L;
        out2.push({ x: P[i - 1][0] + dx * t, z: P[i - 1][1] + dz * t, nx: -dz / L, nz: dx / L, tx: dx / L, tz: dz / L, s: s0 + t * L, side: (k++ & 1) ? 1 : -1 });
      }
      s0 += L;
    }
    return out2;
  };
  for (const st of plan.streets) {
    if (st.cls === ST.LANE) continue;
    const eC = inner ? -0.3 : 1.36;                 // bench centre from the kerb
    const eLo = inner ? -0.72 : 0.75, eHi = inner ? 0.2 : 2.3;
    const level = inner ? null : st.y;
    for (const sp of streetSpots(st)) {
      if (inner && Math.abs((((sp.s % 24) + 24) % 24) - 12) < 1.5) continue;       // gutter grate
      for (const side of [sp.side, -sp.side]) {
        const ox = sp.nx * side, oz = sp.nz * side;
        const x = sp.x + ox * (st.hw + eC), z = sp.z + oz * (st.hw + eC);
        const yaw = Math.atan2(-ox, -oz);
        const pts = footprint(x, z, yaw, 0.96, -0.37, 0.28);
        const binSide = (sp.s * 0.37) % 2 < 1 ? 1 : -1;
        const bx = x + sp.tx * 1.42 * binSide, bz = z + sp.tz * 1.42 * binSide;
        const ok = (px, pz) => {
          const e = field.edge(px, pz);
          if (e < eLo || e > eHi || field.squareAt(px, pz) > 0.03) return false;
          if (Math.abs(Math.abs(field.centre(px, pz)) - (st.hw + e)) > 0.6) return false;   // a junction
          if (excluded(px, pz, 2)) return false;
          if (inner) return hedge(px, pz) > 0.45 && !inLot(px, pz, 0.3);
          if (Math.abs(wardHeight(px, pz) - level) > 0.05) return false;
          for (const [mx, mz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) if (Math.abs(wardHeight(px + mx, pz + mz) - level) > 0.05) return false;
          return ward ? ward.reserved(px, pz) !== 2 : false;
        };
        if (!pts.every(([px, pz]) => ok(px, pz))) continue;
        if (!occ.free(x, z, 1.1) || nearWardTree(x, z, 2.4)) continue;
        const g = groundOf(pts);
        if (g.hi - g.lo > 0.2 || (inner && g.lo < 1.2)) continue;
        benchSet.add(x, g.lo - 0.02, z, yaw, litAt(x, z));
        benches.push({ x, z, yaw });
        occ.add(x, z, 1.1);
        if (sp.side === side && ((sp.s / 36) | 0) % 2 === 0 && ok(bx, bz) && occ.free(bx, bz, 0.3) && !nearWardTree(bx, bz, 1.5)) {
          const gb = groundOf([[bx, bz], [bx + 0.22, bz], [bx - 0.22, bz], [bx, bz + 0.22], [bx, bz - 0.22]]);
          if (gb.hi - gb.lo < 0.15) { binSet.add(bx, gb.lo - 0.02, bz, rnd() * TAU, litAt(bx, bz)); occ.add(bx, bz, 0.3); }
        }
        break;
      }
    }
  }
  out.benches = benches;

  for (const s of [lampSet, benchSet, binSet, planterSet, kioskSet, steleSet, tapSet]) s.build(group);
  out.furniture = { lamps: lampSet.items.length, benches: benchSet.items.length, bins: binSet.items.length, planters: planterSet.items.length, kiosks: kioskSet.items.length, steles: steleSet.items.length, taps: tapSet.items.length };

  // ---- centrepieces: one merged mesh (few, large, cast shadows, seen in the reflections)
  if (centreKit.K.length) {
    const g = centreKit.geometry();
    const lit = new Float32Array(centreKit.K.length);
    for (const [a, b, v] of centreLit) lit.fill(v, a, b);
    g.setAttribute('aLit', new THREE.BufferAttribute(lit, 1));
    const mesh = new THREE.Mesh(g, furnitureMaterial(-1, 1e9));
    mesh.name = 'Square centrepieces';
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  return out;
}
