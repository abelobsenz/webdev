import * as THREE from 'three';
import { patchedMaterial } from '../materials.js';
import { latheFacade, mergeClean } from '../geom.js';
import { renderedHeight } from '../outerCities.js';

// The construction kit of the island countryside (farms, villas, fields, lanes, shrines,
// small harbours). Everything is either
//  * a closed convex solid (Solids.solid / hexa / box / prism / gable / vault), emitted with
//    per-face normals, outward winding and aFacade = (metres along, metres up, kind), or
//  * a closed lathe (latheFacade), or
//  * a drape: a surface finish (field, lane, yard) laid a hand's breadth over the drawn
//    ground (renderedHeight) with a depth offset, never a solid.
// Audit mode records every solid as its own geometry so closure can be proven per piece.

export const TAU = Math.PI * 2;
export const srgb = (r, g, b) => [r ** 2.2, g ** 2.2, b ** 2.2];

export class Solids {
  constructor(audit = null, label = 'solid') {
    this.pos = []; this.nrm = []; this.fac = []; this.lathes = []; this.audit = audit; this.label = label;
  }
  /** A convex solid: points [[x,y,z]], faces (index polygons); winding fixed outward. */
  solid(P, faces, kind, vBase = 0) {
    const start = this.pos.length;
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
      if (!(l > 1e-7)) return;
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
    if (this.audit) this.audit.push({ name: this.label, geometry: sheet(this.pos.slice(start), this.nrm.slice(start), this.fac.slice(start)), points: P });
  }
  /** Eight corners (bottom ring then top ring) as a closed hexahedron. */
  hexa(P, kind, vBase) { this.solid(P, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], kind, vBase); }
  /** Oriented box: centre (x,z), axis (ax,az), half length/width, y0..y1. */
  box(x, z, ax, az, hl, hw, y0, y1, kind, vBase = y0) {
    const sx = -az, sz = ax, P = [];
    for (const y of [y0, y1]) for (const [a, s] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.push([x + ax * a * hl + sx * s * hw, y, z + az * a * hl + sz * s * hw]);
    this.hexa(P, kind, vBase);
  }
  /** Convex polygon q ([[x,z]]) extruded from y0 to y1 (numbers or per-vertex arrays). */
  prism(q, y0, y1, wall = 1, top = 9, vBase) {
    const n = q.length, Y0 = Array.isArray(y0) ? y0 : q.map(() => y0), Y1 = Array.isArray(y1) ? y1 : q.map(() => y1);
    const P = [...q.map((p, i) => [p[0], Y0[i], p[1]]), ...q.map((p, i) => [p[0], Y1[i], p[1]])];
    const faces = [q.map((_, i) => i), q.map((_, i) => n + i)], kinds = [wall, top];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push([i, j, n + j, n + i]); kinds.push(wall); }
    this.solid(P, faces, kinds, vBase ?? Math.min(...Y0));
  }
  /** A wall between two points with bottoms b0/b1 and tops t0/t1, thickness t. */
  wall(x0, z0, b0, t0, x1, z1, b1, t1, t, kind) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, sx = (-dz / l) * t * 0.5, sz = (dx / l) * t * 0.5;
    this.hexa([[x0 - sx, b0, z0 - sz], [x1 - sx, b1, z1 - sz], [x1 + sx, b1, z1 + sz], [x0 + sx, b0, z0 + sz],
      [x0 - sx, t0, z0 - sz], [x1 - sx, t1, z1 - sz], [x1 + sx, t1, z1 + sz], [x0 + sx, t0, z0 + sz]], kind, Math.min(b0, b1));
  }
  /**
   * A gabled range: a pentagonal body (gables close the ends) and two roof slabs that
   * overhang eaves and verges, closed underneath (soffits). Axis ang runs along the ridge.
   */
  gable(x, z, ang, L, W, base, wallH, { pitch = 0.62, wall = 5, roof = 11, overhang = 0.5, thick = 0.26, gableKind = 1 } = {}) {
    const ax = Math.cos(ang), az = Math.sin(ang), sx = -az, sz = ax;
    const rise = (W / 2) * pitch, top = base + wallH;
    const pt = (s, y, t) => [x + sx * s + ax * t, y, z + sz * s + az * t];
    const prof = [[-W / 2, base], [W / 2, base], [W / 2, top], [0, top + rise - 0.04], [-W / 2, top]];
    const Pb = [...prof.map(([s, y]) => pt(s, y, -L / 2)), ...prof.map(([s, y]) => pt(s, y, L / 2))];
    this.solid(Pb, [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [0, 1, 6, 5], [1, 2, 7, 6], [2, 3, 8, 7], [3, 4, 9, 8], [4, 0, 5, 9]],
      [gableKind, gableKind, wall, wall, wall, wall, wall], base);
    const k = rise / (W / 2);
    for (const sg of [-1, 1]) {
      const e = [sg * (W / 2 + overhang), top - overhang * k], rg = [0, top + rise];
      const P = [];
      for (const t of [-L / 2 - overhang, L / 2 + overhang]) P.push(pt(rg[0], rg[1] - 0.02, t), pt(e[0], e[1], t));
      for (const t of [-L / 2 - overhang, L / 2 + overhang]) P.push(pt(rg[0] - sg * 0.02, rg[1] + thick, t), pt(e[0], e[1] + thick, t));
      this.solid(P, [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [1, 3, 7, 5], [0, 2, 6, 4]], roof, top);
    }
    return { top, ridge: top + rise + thick };
  }
  /**
   * A barrel-vaulted range (the island barns and glasshouses): a closed box body and a
   * half-round vault over it, the vault one convex solid (a half-cylinder prism).
   */
  vault(x, z, ang, L, W, base, wallH, { wall = 5, roof = 1, seg = 8, overhang = 0.35 } = {}) {
    const ax = Math.cos(ang), az = Math.sin(ang), sx = -az, sz = ax, top = base + wallH;
    this.box(x, z, ax, az, L / 2, W / 2, base, top, wall, base);
    const R = W / 2 + overhang, P = [];
    const ring = [];
    for (let i = 0; i <= seg; i++) { const a = Math.PI * i / seg; ring.push([Math.cos(a) * R, Math.sin(a) * R * 0.8]); }
    for (const t of [-L / 2 - overhang, L / 2 + overhang]) for (const [s, y] of ring) P.push([x + sx * s + ax * t, top - 0.02 + y, z + sz * s + az * t]);
    const m = ring.length, faces = [[...Array(m).keys()], [...Array(m).keys()].map((i) => m + i), [0, m - 1, 2 * m - 1, m]];
    for (let i = 0; i < m - 1; i++) faces.push([i, i + 1, m + i + 1, m + i]);
    this.solid(P, faces, faces.map((_, i) => (i < 2 ? 1 : roof)), top);
    return top + R * 0.8;
  }
  lathe(profile, seg, x, z, opts) {
    const g = latheFacade(profile, seg, opts).translate(x, 0, z);
    this.lathes.push(g);
    if (this.audit) this.audit.push({ name: this.label, geometry: g, lathe: true });
  }
  geometry() {
    const parts = this.lathes.slice();
    if (this.pos.length) parts.push(sheet(this.pos, this.nrm, this.fac));
    return parts.length ? mergeClean(parts) : null;
  }
  get empty() { return !this.pos.length && !this.lathes.length; }
}

function sheet(pos, nrm, fac) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  return g;
}

/** Surface finishes laid on the drawn ground: vertex colour + (u, v, pattern kind), indexed. */
export class Drape {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.hc = []; this.dim = []; this.idx = []; this.hl = 0; this.hw = 0; }
  /** The half extents (u, v) of the finish being laid (a field's headland is measured from them). */
  extent(hl = 0, hw = 0) { this.hl = hl; this.hw = hw; return this; }
  /** Adds a vertex and returns its index. */
  vert(x, y, z, n, c, u, v, k) { this.pos.push(x, y, z); this.nrm.push(n[0], n[1], n[2]); this.col.push(c[0], c[1], c[2]); this.hc.push(u, v, k); this.dim.push(this.hl, this.hw); return this.pos.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  /**
   * A grid of (nu + 1) x (nv + 1) vertices laid row by row (u fastest), wound to face up
   * (u along the contour, v = u rotated by +90 degrees in plan).
   */
  grid(first, nu, nv) {
    for (let b = 0; b < nv; b++) for (let a = 0; a < nu; a++) {
      const i0 = first + b * (nu + 1) + a, i1 = i0 + 1, i2 = i0 + nu + 1, i3 = i2 + 1;
      this.idx.push(i0, i2, i1, i1, i2, i3);
    }
  }
  get empty() { return !this.pos.length; }
  geometry() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aHC', new THREE.Float32BufferAttribute(this.hc, 3));
    g.setAttribute('aDim', new THREE.Float32BufferAttribute(this.dim, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    return g;
  }
}

// ------------------------------------------------------------------ instanced detail --
// Repeated small solids (wall and hedge runs, vine rows, fruit and olive trees, cypresses)
// are instances of closed unit prototypes. A run is a sheared unit box: its bottom edge
// follows the lowest ground under each end, its height is constant, so it is founded at
// both ends and its top clears the highest ground under it.
export class Instances {
  constructor() { this.m = []; this.k = []; }
  get count() { return this.k.length; }
  /** A wall/hedge/vine run from a to b: bottoms ya, yb, constant height H, thickness t. */
  run(a, ya, b, yb, H, t, kind) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L * t, nz = dx / L * t;
    // column-major 4x4: x axis = the run, y = up (H), z = across (t)
    this.m.push(dx, yb - ya, dz, 0, 0, H, 0, 0, nx, 0, nz, 0, a[0], ya, a[1], 1);
    this.k.push(kind);
  }
  /** A tree at (x, y, z): horizontal radius scale r, height h, a yaw. */
  tree(x, y, z, r, h, yaw, kind) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.m.push(c * r, 0, -s * r, 0, 0, h, 0, 0, s * r, 0, c * r, 0, x, y, z, 1);
    this.k.push(kind);
  }
}
const faceted = (P, faces, kinds) => {
  const s = new Solids();
  s.solid(P, faces, kinds, 0);
  return s.geometry();
};
let _protos = null;
/** Closed unit prototypes: box run, fruit/olive tree, cypress. */
export function prototypes() {
  if (_protos) return _protos;
  const box = faceted([[0, 0, -0.5], [1, 0, -0.5], [1, 0, 0.5], [0, 0, 0.5], [0, 1, -0.5], [1, 1, -0.5], [1, 1, 0.5], [0, 1, 0.5]],
    [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], 0);
  // a fruit tree of unit height and unit crown radius: trunk (kind 8) and two frusta (kind 0:
  // the instance's own kind)
  const t = new Solids();
  const ring = (r, y, n = 8) => Array.from({ length: n }, (_, i) => [Math.cos(i * TAU / n + 0.2) * r, y, Math.sin(i * TAU / n + 0.2) * r]);
  const oct = [[0, 1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14, 15]];
  for (let i = 0; i < 8; i++) oct.push([i, (i + 1) % 8, 8 + ((i + 1) % 8), 8 + i]);
  const quad = [[0, 1, 2, 3], [4, 5, 6, 7]];
  for (let i = 0; i < 4; i++) quad.push([i, (i + 1) % 4, 4 + ((i + 1) % 4), 4 + i]);
  t.solid([...ring(0.085, -0.12, 4), ...ring(0.07, 0.44, 4)], quad, 8, 0);
  // the crown: a closed, smooth-shaded lathe (round, not faceted) over the trunk
  const crown = latheFacade([{ r: 0.34, y: 0.36, kind: 0 }, { r: 0.8, y: 0.45, kind: 0 }, { r: 1.0, y: 0.6, kind: 0 }, { r: 0.92, y: 0.76, kind: 0 }, { r: 0.62, y: 0.92, kind: 0 }, { r: 0, y: 1.0, kind: 0 }], 9, { phase: 0.3 });
  const tree = mergeClean([t.geometry(), crown]);
  const cy = latheFacade([{ r: 0.55, y: -0.02, kind: 0 }, { r: 0.95, y: 0.18, kind: 0 }, { r: 1, y: 0.4, kind: 0 }, { r: 0.72, y: 0.72, kind: 0 }, { r: 0, y: 1, kind: 0 }], 6);
  _protos = { box, tree, cypress: cy };
  return _protos;
}
let _instMat = null;
/**
 * The instanced detail: dry stone coursed in world space (the prototypes are unit shapes),
 * foliage broken by world-space noise, timber. Kind comes from the instance (aKind) unless
 * the prototype vertex carries its own (the trunks).
 */
export function instancedDetailMaterial() {
  if (_instMat) return _instMat;
  _instMat = patchedMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }, {
    key: 'islandInstDetail1',
    vertex: { pars: 'attribute vec3 aFacade; attribute float aKind; varying float vKind;', transform: 'vKind = aFacade.z > 0.5 ? aFacade.z : aKind;' },
    fragment: {
      pars: 'varying float vKind;',
      color: /* glsl */ `
{
  float dk = floor(vKind + 0.5);
  vec3 c;
  if ((dk > 2.5 && dk < 3.5) || dk > 11.5) {
    float n = 0.5 + 0.25 * sin(vWPos.x * 1.9 + sin(vWPos.z * 1.3) * 2.0) + 0.25 * sin(vWPos.z * 2.3 + vWPos.y * 3.1);
    n = mix(n, 0.5, clamp(length(fwidth(vWPos)) * 1.5, 0.0, 1.0));
    vec3 lo = vec3(0.045, 0.10, 0.03), hi = vec3(0.13, 0.22, 0.055);
    if (dk > 13.5) { lo = vec3(0.07, 0.09, 0.05); hi = vec3(0.19, 0.22, 0.13); }
    else if (dk > 12.5) { lo = vec3(0.05, 0.11, 0.03); hi = vec3(0.16, 0.25, 0.06); }
    else if (dk > 11.5) { lo = vec3(0.02, 0.05, 0.03); hi = vec3(0.05, 0.10, 0.05); }
    c = mix(lo, hi, n);
  } else if (dk > 7.5 && dk < 8.5) {
    c = vec3(0.13, 0.085, 0.05);
  } else {
    // coursed dry stone in world space, along whichever horizontal axis the face spans
    vec3 an = abs(normalize(vWNrm));
    float along = an.x > an.z ? vWPos.z : vWPos.x;
    vec2 q = vec2(along / 0.7, vWPos.y / 0.32);
    q.x += 0.5 * floor(q.y);
    vec2 cell = floor(q), f = fract(q);
    float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    float joint = min(min(f.x, 1.0 - f.x) * 0.7, min(f.y, 1.0 - f.y) * 0.32);
    float fade = clamp(1.0 - max(fwidth(q.y), fwidth(q.x)) * 1.2, 0.0, 1.0) * (1.0 - smoothstep(0.6, 0.8, an.y));
    c = vec3(0.35, 0.33, 0.29) * mix(1.0, (0.8 + 0.3 * h) * mix(0.62, 1.0, smoothstep(0.0, 0.035, joint)), fade);
  }
  diffuseColor.rgb = c;
}`,
    },
  });
  return _instMat;
}
/** An InstancedMesh over a prototype from an Instances collector (matrices in its frame). */
export function instancedMesh(proto, inst, material) {
  const g = proto.clone();
  g.setAttribute('aKind', new THREE.InstancedBufferAttribute(new Float32Array(inst.k), 1));
  const m = new THREE.InstancedMesh(g, material, inst.count);
  m.instanceMatrix.array.set(inst.m);
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingBox(); m.computeBoundingSphere();
  return m;
}

export const groundNormal = (x, z) => {
  const dx = renderedHeight(x + 3, z) - renderedHeight(x - 3, z), dz = renderedHeight(x, z + 3) - renderedHeight(x, z - 3);
  const l = Math.hypot(dx, 6, dz);
  return [-dx / l, 6 / l, -dz / l];
};

// Field and lane finishes (pattern kind in aHC.z): 0 lane (gravel with wheel ruts and a
// grass crown), 1 ripe grain, 2 green crop, 3 lavender, 4 ploughed, 5 vineyard ground,
// 6 orchard grass, 7 hay meadow, 8 paved yard (setts), 9 market garden (beds).
export const FIELD_COL = {
  1: srgb(0.72, 0.62, 0.35), 2: srgb(0.31, 0.44, 0.19), 3: srgb(0.50, 0.42, 0.62), 4: srgb(0.49, 0.37, 0.26),
  5: srgb(0.52, 0.45, 0.32), 6: srgb(0.38, 0.48, 0.24), 7: srgb(0.56, 0.58, 0.33), 8: srgb(0.64, 0.60, 0.53), 9: srgb(0.33, 0.37, 0.21),
};
export const LANE_COL = srgb(0.60, 0.56, 0.48);

let _drapeMat = null, _detailMat = null;
/** Draped finishes: rows along the contour (u), pattern across (v, metres), faded by fwidth. */
export function drapeMaterial() {
  if (_drapeMat) return _drapeMat;
  _drapeMat = patchedMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -5 }, {
    key: 'islandDrape2',
    vertex: { pars: 'attribute vec3 aHC; attribute vec2 aDim; varying vec3 vHC; varying vec2 vDim;', transform: 'vHC = aHC; vDim = aDim;' },
    fragment: {
      pars: 'varying vec3 vHC;\nvarying vec2 vDim;\nfloat idPer(float hk){ return hk < 0.5 ? 0.0 : hk < 1.5 ? 1.1 : hk < 2.5 ? 0.9 : hk < 3.5 ? 1.8 : hk < 4.5 ? 0.8 : hk < 5.5 ? 3.2 : hk < 6.5 ? 0.0 : hk < 7.5 ? 7.0 : hk < 8.5 ? 0.0 : 1.6; }',
      color: /* glsl */ `
{
  float hk = floor(vHC.z + 0.5);
  float fwv = max(fwidth(vHC.y), 1e-4), fwu = max(fwidth(vHC.x), 1e-4);
  if (hk < 0.5) {
    // gravel lane: two wheel ruts, a grass crown and soft verges (v in -1..1 across)
    float a = abs(vHC.y);
    float fade = clamp(1.0 - fwv * 5.0, 0.0, 1.0);
    float rut = exp(-pow((a - 0.52) / 0.14, 2.0));
    float crown = 1.0 - smoothstep(0.08, 0.22, a);
    float verge = smoothstep(0.8, 1.0, a);
    float grit = 0.93 + 0.07 * sin(vHC.x * 1.9 + sin(vHC.x * 0.27) * 3.0);
    vec3 grass = vec3(0.16, 0.24, 0.07);
    vec3 c = diffuseColor.rgb * mix(1.0, (1.0 - 0.2 * rut) * grit, fade);
    c = mix(c, grass, (0.55 * crown + 0.6 * verge) * fade);
    diffuseColor.rgb = c;
  } else if (hk > 7.5 && hk < 8.5) {
    // paved yard: setts in running bond, faded to their average
    vec2 q = vec2(vHC.x / 0.9, vHC.y / 0.6);
    q.x += 0.5 * floor(q.y);
    vec2 f = fract(q);
    float joint = min(min(f.x, 1.0 - f.x) * 0.9, min(f.y, 1.0 - f.y) * 0.6);
    float fade = clamp(1.0 - max(fwu, fwv) * 3.0, 0.0, 1.0);
    float h = fract(sin(dot(floor(q), vec2(12.9898, 78.233))) * 43758.5453);
    diffuseColor.rgb *= mix(1.0, (0.86 + 0.2 * h) * mix(0.7, 1.0, smoothstep(0.0, 0.05, joint)), fade);
  } else {
    // soil and crop vary across a field (two scales of mottling, faded with the footprint)
    float m1 = vnoise(vWPos.xz / 9.0), m2 = vnoise(vWPos.xz / 33.0 + 7.1);
    diffuseColor.rgb *= 0.9 + 0.12 * m1 + 0.14 * (m2 - 0.5);
    float per = idPer(hk);
    if (per > 0.0) {
      float s = 0.5 + 0.5 * cos(6.2832 * vHC.y / per);
      float fade = clamp(1.0 - 2.0 * fwv / per, 0.0, 1.0);
      float amp = hk > 2.5 && hk < 3.5 ? 0.62 : hk > 6.5 && hk < 7.5 ? 0.22 : hk > 8.5 ? 0.5 : 0.45;
      diffuseColor.rgb *= mix(1.0, 1.0 - amp * 0.5 + amp * s, fade);
    }
    // the headland: an uncropped grassy margin round every field, so no field is a cut sheet
    if (vDim.x > 0.0) {
      float edge = min(vDim.x - abs(vHC.x), vDim.y - abs(vHC.y));
      float head = 1.0 - smoothstep(0.8, 2.6, edge);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.105, 0.17, 0.05) * (0.85 + 0.3 * m1), head);
    }
  }
}`,
      normal: /* glsl */ `
{
  float hk = floor(vHC.z + 0.5);
  float per = idPer(hk);
  if (per > 0.0) {
    float fw = max(fwidth(vHC.y), 1e-4);
    float amp = (hk > 2.5 && hk < 3.5 ? 0.45 : hk > 4.5 && hk < 5.5 ? 0.5 : hk > 6.5 && hk < 7.5 ? 0.05 : 0.2) * clamp(1.0 - 2.0 * fw / per, 0.0, 1.0);
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
  return _drapeMat;
}

/**
 * Field walls, terrace walls, hedges, vines, orchard and cypress crowns, timber and iron,
 * coloured by aFacade kind: 1 dry stone (coursed, fading to its average), 3 foliage,
 * 8 timber, 10 dark iron, 12 cypress (a darker, bluer green), 13 fruit-tree foliage.
 */
export function detailMaterial() {
  if (_detailMat) return _detailMat;
  _detailMat = patchedMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }, {
    key: 'islandDetail1',
    vertex: { pars: 'attribute vec3 aFacade; varying vec3 vDF;', transform: 'vDF = aFacade;' },
    fragment: {
      pars: 'varying vec3 vDF;',
      color: /* glsl */ `
{
  float dk = floor(vDF.z + 0.5);
  vec3 c;
  if ((dk > 2.5 && dk < 3.5) || dk > 11.5) {
    float n = 0.5 + 0.25 * sin(vWPos.x * 1.9 + sin(vWPos.z * 1.3) * 2.0) + 0.25 * sin(vWPos.z * 2.3 + vWPos.y * 3.1);
    n = mix(n, 0.5, clamp(length(fwidth(vWPos)) * 1.5, 0.0, 1.0));
    vec3 lo = dk > 12.5 ? vec3(0.05, 0.11, 0.03) : dk > 11.5 ? vec3(0.025, 0.06, 0.035) : vec3(0.045, 0.10, 0.03);
    vec3 hi = dk > 12.5 ? vec3(0.15, 0.24, 0.06) : dk > 11.5 ? vec3(0.06, 0.12, 0.06) : vec3(0.13, 0.22, 0.055);
    c = mix(lo, hi, n);
  } else if (dk > 7.5 && dk < 8.5) {
    c = vec3(0.13, 0.085, 0.05);
  } else if (dk > 9.5 && dk < 10.5) {
    c = vec3(0.05, 0.05, 0.055);
  } else {
    vec2 q = vec2(vDF.x / 0.7, vDF.y / 0.32);
    q.x += 0.5 * floor(q.y);
    vec2 cell = floor(q), f = fract(q);
    float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    float joint = min(min(f.x, 1.0 - f.x) * 0.7, min(f.y, 1.0 - f.y) * 0.32);
    float fade = clamp(1.0 - max(fwidth(vDF.y), fwidth(vDF.x) * 0.45) * 4.0, 0.0, 1.0);
    c = vec3(0.46, 0.43, 0.37) * mix(1.0, (0.8 + 0.3 * h) * mix(0.62, 1.0, smoothstep(0.0, 0.035, joint)), fade);
  }
  diffuseColor.rgb = c;
}`,
    },
  });
  return _detailMat;
}

/**
 * Distance LOD over square cells: every cell is a THREE.LOD whose levels draw the layers
 * named in `levels[i].layers`; the last level (usually empty) hides the cell far away.
 * layers: { name: BufferGeometry } per cell. Only near levels cast shadows.
 */
export function buildLayerLOD(scene, cells, materials, levels, name) {
  const meshes = [];
  let tris = 0, instances = 0;
  const c = new THREE.Vector3(), box = new THREE.Box3(), pbox = new THREE.Box3(), m4 = new THREE.Matrix4();
  for (const cell of cells) {
    const geos = {};
    box.makeEmpty();
    for (const [layer, g] of Object.entries(cell.layers)) {
      if (!g) continue;
      if (g.inst) {
        if (!g.inst.count) continue;
        geos[layer] = g;
        // the instances' world box: the prototype's box under every matrix
        if (!g.proto.boundingBox) g.proto.computeBoundingBox();
        for (let i = 0; i < g.inst.count; i++) box.union(pbox.copy(g.proto.boundingBox).applyMatrix4(m4.fromArray(g.inst.m, i * 16)));
        const pc = g.proto.index ? g.proto.index.count / 3 : g.proto.attributes.position.count / 3;
        tris += pc * g.inst.count; instances += g.inst.count;
        continue;
      }
      if (!g.attributes.position.count) continue;
      g.computeBoundingBox(); g.computeBoundingSphere();
      box.union(g.boundingBox);
      geos[layer] = g;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
    if (box.isEmpty()) continue;
    box.getCenter(c);
    const lod = new THREE.LOD();
    lod.name = `${name} (lod cell)`;
    lod.position.copy(c);
    lod.matrixAutoUpdate = false; lod.updateMatrix();
    const shared = {};
    for (const lv of levels) {
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      for (const layer of lv.layers) {
        const g = geos[layer];
        if (!g) continue;
        let m;
        if (g.inst) {
          // one InstancedMesh per layer in the cell's frame; further levels share its buffers
          if (!shared[layer]) {
            const local = { m: g.inst.m.slice(), k: g.inst.k, count: g.inst.count };
            for (let i = 0; i < local.count; i++) { local.m[i * 16 + 12] -= c.x; local.m[i * 16 + 13] -= c.y; local.m[i * 16 + 14] -= c.z; }
            shared[layer] = instancedMesh(g.proto, local, materials[layer]);
            m = shared[layer];
          } else {
            const s = shared[layer];
            m = new THREE.InstancedMesh(s.geometry, s.material, s.count);
            m.instanceMatrix = s.instanceMatrix;
            m.boundingBox = s.boundingBox; m.boundingSphere = s.boundingSphere;
          }
        } else {
          m = new THREE.Mesh(g, materials[layer]);
          m.position.copy(c).negate();
        }
        m.name = `${name}: ${layer}`;
        m.matrixAutoUpdate = false; m.updateMatrix();
        m.castShadow = !!(lv.cast && lv.cast.includes(layer));
        m.receiveShadow = true;
        group.add(m);
        meshes.push(m);
      }
      lod.addLevel(group, lv.dist);
    }
    lod.updateMatrixWorld(true);
    scene.add(lod);
  }
  return { meshes, tris, instances };
}
