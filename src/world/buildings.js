import * as THREE from 'three';
import { createLowriseMaterial } from './facade.js';
import { mulberry32 } from './noise.js';
import { ST } from './urban.js';

// Low- and mid-rise MERIDIAN, generated lot by lot.
//
// Every building is built in metres in its lot's frame (+z faces the street) so the facade
// shader's window grid lands on real floors (3.6 m) and bays (3.3 m). Typologies:
//   ribbon   - glass core wrapped in continuous balcony slabs, rails, timber fins, PV roof
//   terrace  - stepped garden terraces falling toward the street, pergola on top
//   cloister - stone perimeter block round a courtyard with a pool, loggia, corner campanile
//   tower    - podium + rounded tower ringed by floor plates, crown garden
//   pavilion - civic dome hall on a stepped plinth with a portico
//   mews     - terraces of narrow houses with gables, vaults or roof gardens
//   stack    - cantilevered boxes turned against each other
// Each building has a detailed version and a massing version (same volumes, no balconies,
// rails, fins, columns or roof kit) used beyond a few hundred metres.

const FH = 3.6;
const TAU = Math.PI * 2;
const K = { GLASS: 0, STONE: 1, LANTERN: 2, GARDEN: 3, CONDUIT: 4, PUNCHED: 5, POOL: 6, PV: 7, TIMBER: 8, PAVING: 9, METAL: 10, FRIT: 12 };

// ------------------------------------------------------------ mesh builder --
class Builder {
  constructor(cap = 1 << 15) {
    this.nv = 0; this.ni = 0;
    this._alloc(cap, cap * 2);
    this.seed = 0; this.roof = 0;
    this.ox = 0; this.oy = 0; this.oz = 0; this.c = 1; this.s = 0;
  }
  _alloc(vc, ic) {
    const grow = (a, n) => { const b = new a.constructor(n); b.set(a.subarray(0, Math.min(a.length, n))); return b; };
    this.pos = this.pos ? grow(this.pos, vc * 3) : new Float32Array(vc * 3);
    this.nrm = this.nrm ? grow(this.nrm, vc * 3) : new Float32Array(vc * 3);
    this.fac = this.fac ? grow(this.fac, vc * 3) : new Float32Array(vc * 3);
    this.inst = this.inst ? grow(this.inst, vc * 2) : new Float32Array(vc * 2);
    this.idx = this.idx ? grow(this.idx, ic) : new Uint32Array(ic);
    this.vcap = vc; this.icap = ic;
  }
  reserve(nv, ni) {
    if (this.nv + nv > this.vcap || this.ni + ni > this.icap) this._alloc(Math.max(this.vcap * 2, this.nv + nv + 1024), Math.max(this.icap * 2, this.ni + ni + 2048));
  }
  frame(x, y, z, rot) { this.ox = x; this.oy = y; this.oz = z; this.c = Math.cos(rot); this.s = Math.sin(rot); }
  v(lx, ly, lz, nx, ny, nz, fu, fv, kind) {
    const i = this.nv++;
    const { c, s } = this;
    this.pos[i * 3] = this.ox + lx * c + lz * s; this.pos[i * 3 + 1] = this.oy + ly; this.pos[i * 3 + 2] = this.oz - lx * s + lz * c;
    this.nrm[i * 3] = nx * c + nz * s; this.nrm[i * 3 + 1] = ny; this.nrm[i * 3 + 2] = -nx * s + nz * c;
    this.fac[i * 3] = fu; this.fac[i * 3 + 1] = fv; this.fac[i * 3 + 2] = kind;
    this.inst[i * 2] = this.seed; this.inst[i * 2 + 1] = this.roof;
    return i;
  }
  /** Triangle; winding fixed up so the face points along the first vertex normal. */
  tri(a, b, c) {
    const P = this.pos, N = this.nrm;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const i = this.ni;
    this.ni += 3;
    if (nx * N[a * 3] + ny * N[a * 3 + 1] + nz * N[a * 3 + 2] >= 0) { this.idx[i] = a; this.idx[i + 1] = b; this.idx[i + 2] = c; }
    else { this.idx[i] = a; this.idx[i + 1] = c; this.idx[i + 2] = b; }
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }

  /**
   * Vertical walls along a closed (or open) polygon from y0 to y1. Corners sharper than
   * ~35 degrees get split normals; gentle ones are smoothed. v runs from vBase.
   */
  walls(poly, y0, y1, kind, { closed = true, vBase = 0, u0 = 0, flip = false } = {}) {
    const n = poly.length;
    const m = closed ? n : n - 1;
    this.reserve(m * 4, m * 6);
    const area = polyArea(poly) * (flip ? -1 : 1);
    const sgn = area >= 0 ? 1 : -1;
    const en = [];
    for (let i = 0; i < m; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L = Math.hypot(dx, dz) || 1;
      en.push([(dz / L) * sgn, (-dx / L) * sgn, L]);
    }
    const vn = (i, e) => {
      // normal at polygon vertex i for edge e
      const prev = closed ? en[(i - 1 + m) % m] : en[Math.max(i - 1, 0)];
      const next = closed ? en[i % m] : en[Math.min(i, m - 1)];
      const dot = prev[0] * next[0] + prev[1] * next[1];
      if (dot > 0.82) { const x = prev[0] + next[0], z = prev[1] + next[1]; const l = Math.hypot(x, z) || 1; return [x / l, z / l]; }
      return [e[0], e[1]];
    };
    let u = u0;
    for (let i = 0; i < m; i++) {
      const a = poly[i], b = poly[(i + 1) % n], e = en[i];
      const na = vn(i, e), nb = vn((i + 1) % n, e);
      const i0 = this.v(a[0], y0, a[1], na[0], 0, na[1], u, y0 - vBase, kind);
      const i1 = this.v(b[0], y0, b[1], nb[0], 0, nb[1], u + e[2], y0 - vBase, kind);
      const i2 = this.v(b[0], y1, b[1], nb[0], 0, nb[1], u + e[2], y1 - vBase, kind);
      const i3 = this.v(a[0], y1, a[1], na[0], 0, na[1], u, y1 - vBase, kind);
      this.quad(i0, i1, i2, i3);
      u += e[2];
    }
  }

  cap(poly, y, kind, up = true) {
    const n = poly.length;
    this.reserve(n, n * 3);
    const base = this.nv;
    for (const p of poly) this.v(p[0], y, p[1], 0, up ? 1 : -1, 0, p[0], p[1], kind);
    const tris = THREE.ShapeUtils.triangulateShape(poly.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const [a, b, c] of tris) this.tri(base + a, base + b, base + c);
  }

  prism(poly, y0, y1, side, top = K.STONE, { bottom = false, vBase = 0, noTop = false } = {}) {
    this.walls(poly, y0, y1, side, { vBase });
    if (!noTop) this.cap(poly, y1, top, true);
    if (bottom) this.cap(poly, y0, K.STONE, false);
  }

  box(x0, x1, z0, z1, y0, y1, side, top = K.STONE, opts) {
    this.prism([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y0, y1, side, top, opts);
  }

  /** Lathe around a local centre. prof: [[r, y, kind], ...] bottom -> top. */
  lathe(cx, cz, prof, seg = 16, vBase = 0) {
    this.reserve((seg + 1) * prof.length * 2, seg * prof.length * 6);
    for (let j = 0; j < prof.length - 1; j++) {
      const [r0, y0, k0] = prof[j], [r1, y1, k1] = prof[j + 1];
      const dr = r1 - r0, dy = y1 - y0;
      const L = Math.hypot(dr, dy) || 1;
      const ny = -dr / L, nr = dy / L;
      const ring0 = [], ring1 = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        ring0.push(this.v(cx + ca * r0, y0, cz + sa * r0, ca * nr, ny, sa * nr, a * Math.max(r0, 1), y0 - vBase, k1 ?? k0));
        ring1.push(this.v(cx + ca * r1, y1, cz + sa * r1, ca * nr, ny, sa * nr, a * Math.max(r0, 1), y1 - vBase, k1 ?? k0));
      }
      for (let i = 0; i < seg; i++) this.quad(ring0[i], ring0[i + 1], ring1[i + 1], ring1[i]);
    }
  }

  /** Gabled roof over a rect, ridge along local x. */
  gable(x0, x1, z0, z1, y, rise, kindRoof, kindEnd) {
    this.reserve(16, 24);
    const zm = (z0 + z1) / 2, hd = (z1 - z0) / 2;
    const L = Math.hypot(hd, rise);
    const ny = hd / L, nz = rise / L;
    // two roof planes
    let a = this.v(x0, y, z1, 0, ny, nz, x0, 0, kindRoof), b = this.v(x1, y, z1, 0, ny, nz, x1, 0, kindRoof);
    let c = this.v(x1, y + rise, zm, 0, ny, nz, x1, L, kindRoof), d = this.v(x0, y + rise, zm, 0, ny, nz, x0, L, kindRoof);
    this.quad(a, b, c, d);
    a = this.v(x0, y, z0, 0, ny, -nz, x0, 0, kindRoof); b = this.v(x1, y, z0, 0, ny, -nz, x1, 0, kindRoof);
    c = this.v(x1, y + rise, zm, 0, ny, -nz, x1, L, kindRoof); d = this.v(x0, y + rise, zm, 0, ny, -nz, x0, L, kindRoof);
    this.quad(a, b, c, d);
    // gable ends
    for (const [x, nx] of [[x0, -1], [x1, 1]]) {
      const p = this.v(x, y, z0, nx, 0, 0, z0, y, kindEnd), q = this.v(x, y, z1, nx, 0, 0, z1, y, kindEnd), r = this.v(x, y + rise, zm, nx, 0, 0, zm, y + rise, kindEnd);
      this.tri(p, q, r);
    }
  }

  /** Barrel vault over a rect, axis along local x. */
  vault(x0, x1, z0, z1, y, rise, kind, seg = 8) {
    const zm = (z0 + z1) / 2, hd = (z1 - z0) / 2;
    this.reserve((seg + 1) * 2 + seg * 4, seg * 12);
    const top = [], bot = [];
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI;
      const z = zm + Math.cos(t) * hd, yy = y + Math.sin(t) * rise;
      const nz = Math.cos(t) / hd, ny = Math.sin(t) / rise;
      const l = Math.hypot(nz, ny);
      bot.push(this.v(x0, yy, z, 0, ny / l, nz / l, t * hd, x0, kind));
      top.push(this.v(x1, yy, z, 0, ny / l, nz / l, t * hd, x1, kind));
    }
    for (let i = 0; i < seg; i++) this.quad(bot[i], bot[i + 1], top[i + 1], top[i]);
    for (const [x, nx, row] of [[x0, -1, bot], [x1, 1, top]]) {
      const c = this.v(x, y, zm, nx, 0, 0, zm, y, K.STONE);
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * Math.PI, t1 = ((i + 1) / seg) * Math.PI;
        const p = this.v(x, y + Math.sin(t0) * rise, zm + Math.cos(t0) * hd, nx, 0, 0, zm + Math.cos(t0) * hd, y + Math.sin(t0) * rise, K.STONE);
        const q = this.v(x, y + Math.sin(t1) * rise, zm + Math.cos(t1) * hd, nx, 0, 0, zm + Math.cos(t1) * hd, y + Math.sin(t1) * rise, K.STONE);
        this.tri(c, p, q);
      }
      void row;
    }
  }

  /** Polygon in the (x, y) plane extruded along z from z0 to z1 (gables, pediments, arches). */
  vprism(poly, z0, z1, kind, capKind = kind) {
    const n = poly.length;
    this.reserve(n * 4 + n * 2, n * 6 + n * 6);
    const area = polyArea(poly);
    const sgn = area >= 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const nx = (dy / L) * sgn, ny = (-dx / L) * sgn;
      const i0 = this.v(a[0], a[1], z0, nx, ny, 0, a[0] + a[1], z0, kind), i1 = this.v(b[0], b[1], z0, nx, ny, 0, b[0] + b[1], z0, kind);
      const i2 = this.v(b[0], b[1], z1, nx, ny, 0, b[0] + b[1], z1, kind), i3 = this.v(a[0], a[1], z1, nx, ny, 0, a[0] + a[1], z1, kind);
      this.quad(i0, i1, i2, i3);
    }
    const tris = THREE.ShapeUtils.triangulateShape(poly.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const [z, nz] of [[z1, 1], [z0, -1]]) {
      const base = this.nv;
      for (const p of poly) this.v(p[0], p[1], z, 0, 0, nz, p[0], p[1], capKind);
      for (const [a, b, c] of tris) this.tri(base + a, base + b, base + c);
    }
  }

  /** Rectangular frustum: w0 x d0 at y0 up to w1 x d1 at y1 (mansards, battered plinths). */
  frustum(w0, d0, w1, d1, y0, y1, kind, topKind = kind, cx = 0, cz = 0) {
    this.reserve(24, 36);
    const b = [[-w0 / 2, -d0 / 2], [w0 / 2, -d0 / 2], [w0 / 2, d0 / 2], [-w0 / 2, d0 / 2]];
    const t = [[-w1 / 2, -d1 / 2], [w1 / 2, -d1 / 2], [w1 / 2, d1 / 2], [-w1 / 2, d1 / 2]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const ex = b[j][0] - b[i][0], ez = b[j][1] - b[i][1], L = Math.hypot(ex, ez) || 1;
      // outward normal, tilted by the batter
      let nx = ez / L, nz = -ex / L;
      const mx = (b[i][0] + b[j][0]) / 2, mz = (b[i][1] + b[j][1]) / 2;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      const inset = Math.abs(nx) > 0.5 ? (w0 - w1) / 2 : (d0 - d1) / 2;
      const h = y1 - y0, l = Math.hypot(inset, h) || 1;
      const ny = inset / l, k = h / l;
      const i0 = this.v(cx + b[i][0], y0, cz + b[i][1], nx * k, ny, nz * k, 0, 0, kind), i1 = this.v(cx + b[j][0], y0, cz + b[j][1], nx * k, ny, nz * k, L, 0, kind);
      const i2 = this.v(cx + t[j][0], y1, cz + t[j][1], nx * k, ny, nz * k, L, l, kind), i3 = this.v(cx + t[i][0], y1, cz + t[i][1], nx * k, ny, nz * k, 0, l, kind);
      this.quad(i0, i1, i2, i3);
    }
    if (topKind !== null) this.cap(t.map(([x, z]) => [cx + x, cz + z]), y1, topKind);
  }

  /** Loft between two closed rings of equal count (flat-shaded facets). */
  loft(r0, y0, r1, y1, kind, u0 = 0) {
    const n = r0.length;
    this.reserve(n * 4, n * 6);
    let u = u0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = [r0[i][0], y0, r0[i][1]], b = [r0[j][0], y0, r0[j][1]], c = [r1[j][0], y1, r1[j][1]], d = [r1[i][0], y1, r1[i][1]];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2;
      if (nx * mx + nz * mz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const L = Math.hypot(ux, uz);
      const i0 = this.v(a[0], a[1], a[2], nx, ny, nz, u, y0, kind), i1 = this.v(b[0], b[1], b[2], nx, ny, nz, u + L, y0, kind);
      const i2 = this.v(c[0], c[1], c[2], nx, ny, nz, u + L, y1, kind), i3 = this.v(d[0], d[1], d[2], nx, ny, nz, u, y1, kind);
      this.quad(i0, i1, i2, i3);
      u += L;
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, this.nv * 3), 3));
    g.setAttribute('aFacade', new THREE.BufferAttribute(this.fac.slice(0, this.nv * 3), 3));
    g.setAttribute('aInst', new THREE.BufferAttribute(this.inst.slice(0, this.nv * 2), 2));
    g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.ni), 1));
    g.computeBoundingSphere();
    return g;
  }
}

function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }

/** Rounded rectangle centred at (cx, cz). */
export function rrect(w, d, r, cx = 0, cz = 0, seg = 3) {
  r = Math.max(0, Math.min(r, w / 2 - 0.01, d / 2 - 0.01));
  if (r < 0.05) return [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];
  const pts = [];
  const cs = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, 1], [-w / 2 + r, -d / 2 + r, 2], [w / 2 - r, -d / 2 + r, 3]];
  for (const [x, z, q] of cs) for (let i = 0; i <= seg; i++) { const a = (q + i / seg) * (Math.PI / 2); pts.push([cx + x + Math.cos(a) * r, cz + z + Math.sin(a) * r]); }
  return pts;
}
function ellipse(rx, rz, n, cx = 0, cz = 0) { const p = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU; p.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]); } return p; }

// ------------------------------------------------------------- typologies --
// Local frame: x across the frontage, z toward the street (+D/2 is the street face),
// y = 0 at the ground floor. `lod` true = massing only.

function roofKit(B, R, poly, y, w, d, lod, { garden = 0.5 } = {}) {
  // parapet
  if (!lod) B.walls(poly, y, y + 0.9, K.STONE);
  if (lod) return;
  if (R() < garden) {
    // roof garden with a glass pavilion and pergola
    const pw = Math.min(w * 0.35, 9), pd = Math.min(d * 0.35, 7);
    const px = (R() - 0.5) * (w - pw) * 0.5, pz = (R() - 0.5) * (d - pd) * 0.5;
    B.box(px - pw / 2, px + pw / 2, pz - pd / 2, pz + pd / 2, y, y + 3.2, K.GLASS, K.PV);
    for (let i = 0; i <= 4; i++) {
      const x = px - pw / 2 - 3 + i * ((pw + 6) / 4);
      B.box(x - 0.12, x + 0.12, pz - pd / 2 - 3, pz + pd / 2 + 3, y + 3.0, y + 3.25, K.TIMBER, K.TIMBER);
    }
  } else {
    // PV rows tilted to the sun
    const rows = Math.floor((d - 3) / 2.6);
    const x0 = -w / 2 + 1.6, x1 = w / 2 - 1.6;
    for (let i = 0; i < rows; i++) {
      const z = -d / 2 + 2 + i * 2.6;
      const a = B.v(x0, y + 0.3, z, 0, 0.8, -0.6, x0, 0, K.PV), b = B.v(x1, y + 0.3, z, 0, 0.8, -0.6, x1, 0, K.PV);
      const c = B.v(x1, y + 1.2, z + 1.4, 0, 0.8, -0.6, x1, 1.66, K.PV), e = B.v(x0, y + 1.2, z + 1.4, 0, 0.8, -0.6, x0, 1.66, K.PV);
      B.reserve(8, 12);
      B.quad(a, b, c, e);
      const f = B.v(x0, y + 0.3, z + 1.4, 0, 0, 1, x0, 0, K.METAL), g = B.v(x1, y + 0.3, z + 1.4, 0, 0, 1, x1, 0, K.METAL);
      const h = B.v(x1, y + 1.2, z + 1.4, 0, 0, 1, x1, 0.9, K.METAL), k = B.v(x0, y + 1.2, z + 1.4, 0, 0, 1, x0, 0.9, K.METAL);
      B.quad(f, g, h, k);
    }
  }
}

function ribbon(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const n = Math.max(2, Math.round(H / FH));
  const top = n * FH;
  const inset = 1.7;
  const core = rrect(w - 2 * inset, d - 2 * inset, 2.4);
  const slab = rrect(w, d, 3.8);
  if (lod) { B.prism(slab, 0, top, K.GLASS, K.GARDEN); return top; }
  // ground floor recessed shopfronts, then the glazed core
  B.walls(rrect(w - 2 * inset - 1.2, d - 2 * inset - 1.2, 2.0), 0, FH, K.GLASS);
  B.walls(core, FH, top, K.GLASS);
  for (let k = 1; k <= n; k++) {
    const y = k * FH;
    B.prism(slab, y - 0.35, y, K.STONE, k === n ? K.GARDEN : K.PAVING, { bottom: true });
    if (k < n) {
      // fritted-glass balustrade under the handrail, planter lip every other floor
      B.walls(rrect(w - 0.12, d - 0.12, 3.74), y, y + 0.98, K.FRIT);
      B.walls(slab, y + 0.98, y + 1.08, K.METAL);
      if (k % 2 === 0) B.walls(rrect(w - 0.3, d - 0.3, 3.6), y, y + 0.55, K.GARDEN);
    }
  }
  // timber fins on the end walls
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - inset + 0.25);
    const m = Math.floor((d - 2 * inset - 4) / 1.35);
    for (let i = 0; i <= m; i++) {
      const z = -d / 2 + inset + 2 + i * 1.35;
      B.box(x - 0.09, x + 0.09, z - 0.3, z + 0.3, FH, top - 0.35, K.TIMBER, K.TIMBER);
    }
  }
  roofKit(B, R, slab, top, w - 2, d - 2, lod, { garden: 0.45 });
  return top;
}

function terrace(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const tiers = Math.max(2, Math.min(4, Math.round(H / 8)));
  const per = Math.max(1, Math.round(H / FH / tiers));
  const stepZ = Math.min(5.5, (d - 8) / tiers), stepX = 1.4;
  let y = 0;
  for (let t = 0; t < tiers; t++) {
    const x0 = -w / 2 + t * stepX, x1 = w / 2 - t * stepX;
    const z1 = d / 2 - t * stepZ, z0 = -d / 2;
    const h = per * FH;
    const poly = rrect(x1 - x0, z1 - z0, 1.6, (x0 + x1) / 2, (z0 + z1) / 2);
    B.walls(poly, y, y + h, t === 0 ? K.GLASS : (t % 2 ? K.GLASS : K.PUNCHED));
    B.cap(poly, y + h, K.GARDEN);
    if (!lod) {
      // floor lines, a planter wall along the terrace edge
      for (let f = 1; f < per; f++) B.walls(rrect(x1 - x0 + 0.5, z1 - z0 + 0.5, 1.8, (x0 + x1) / 2, (z0 + z1) / 2), y + f * FH - 0.3, y + f * FH, K.STONE);
      B.walls(rrect(x1 - x0 - 0.4, z1 - z0 - 0.4, 1.4, (x0 + x1) / 2, (z0 + z1) / 2), y + h, y + h + 0.75, K.STONE);
    }
    y += h;
  }
  if (!lod) {
    // pergola over the top terrace
    const t = tiers - 1;
    const x0 = -w / 2 + t * stepX + 1.5, x1 = w / 2 - t * stepX - 1.5;
    const zf = d / 2 - t * stepZ - 1.5, zb = zf - Math.min(9, (d - t * stepZ) * 0.6);
    for (const x of [x0, x1]) for (const z of [zb, zf]) B.box(x - 0.15, x + 0.15, z - 0.15, z + 0.15, y, y + 2.8, K.TIMBER, K.TIMBER);
    for (let i = 0; i <= Math.floor((x1 - x0) / 1.1); i++) { const x = x0 + i * 1.1; B.box(x - 0.07, x + 0.07, zb, zf, y + 2.8, y + 3.0, K.TIMBER, K.TIMBER); }
  }
  return y;
}

function cloister(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const n = Math.max(2, Math.round(H / FH));
  const top = n * FH;
  const b = Math.min(10, Math.min(w, d) * 0.3);
  const loggia = 2.6;
  // four wings
  const wings = [
    [-w / 2, w / 2, d / 2 - b, d / 2], [-w / 2, w / 2, -d / 2, -d / 2 + b],
    [-w / 2, -w / 2 + b, -d / 2 + b, d / 2 - b], [w / 2 - b, w / 2, -d / 2 + b, d / 2 - b],
  ];
  wings.forEach(([x0, x1, z0, z1], i) => {
    if (i === 0 && !lod) {
      // street wing: open loggia on the ground floor
      B.box(x0 + 0.4, x1 - 0.4, z0, z1 - loggia, 0, FH, K.GLASS, K.STONE, { noTop: true });
      B.box(x0, x1, z0, z1, FH, top, K.PUNCHED, K.GARDEN, { bottom: true });
      const m = Math.floor((x1 - x0 - 2) / 3.8);
      for (let k = 0; k <= m; k++) {
        const x = x0 + 1 + (k * (x1 - x0 - 2)) / m;
        B.lathe(x, z1 - 0.6, [[0.42, 0, K.STONE], [0.34, FH - 0.5, K.STONE], [0.55, FH, K.STONE]], 8);
      }
    } else B.box(x0, x1, z0, z1, 0, top, K.PUNCHED, K.GARDEN);
  });
  if (lod) return top;
  // cornice + parapet
  B.walls(rrect(w + 0.9, d + 0.9, 0.2), top - 0.5, top, K.STONE);
  B.walls(rrect(w, d, 0.05), top, top + 0.9, K.STONE);
  // courtyard: paving, a pool and its fountain
  B.cap(rrect(w - 2 * b, d - 2 * b, 0.05), 0.05, K.PAVING);
  const pr = Math.min(w, d) * 0.5 - b - 3;
  if (pr > 1.2) {
    B.prism(ellipse(pr, pr, 20), 0.05, 0.55, K.STONE, K.STONE, { noTop: true });
    B.cap(ellipse(pr - 0.35, pr - 0.35, 20), 0.35, K.POOL);
    B.lathe(0, 0, [[0.6, 0.3, K.STONE], [0.35, 1.3, K.STONE], [1.1, 1.5, K.STONE], [0.2, 1.8, K.STONE]], 10);
  }
  // campanile on a back corner
  if (R() < 0.6) {
    const cx = (R() < 0.5 ? -1 : 1) * (w / 2 - b / 2), cz = -d / 2 + b / 2, s = b * 0.4;
    B.box(cx - s, cx + s, cz - s, cz + s, top, top + 9, K.PUNCHED, K.STONE);
    B.box(cx - s + 0.4, cx + s - 0.4, cz - s + 0.4, cz + s - 0.4, top + 9, top + 12, K.LANTERN, K.STONE);
    B.lathe(cx, cz, [[s * 1.1, top + 12, K.STONE], [s * 0.2, top + 16, K.STONE], [0.05, top + 16.5, K.STONE]], 8);
  }
  return top;
}

function tower(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const podium = 2 * FH;
  B.prism(rrect(w, d, 2.5), 0, podium, K.PUNCHED, K.GARDEN);
  if (!lod) B.walls(rrect(w - 0.2, d - 0.2, 2.4), podium, podium + 0.9, K.STONE);
  const tw = w * 0.62, td = d * 0.62;
  const oval = R() < 0.5;
  const plan = oval ? ellipse(tw / 2, td / 2, 24, 0, -d * 0.06) : rrect(tw, td, Math.min(tw, td) * 0.3, 0, -d * 0.06, 4);
  const plate = oval ? ellipse(tw / 2 + 1.1, td / 2 + 1.1, 24, 0, -d * 0.06) : rrect(tw + 2.2, td + 2.2, Math.min(tw, td) * 0.3 + 1.1, 0, -d * 0.06, 4);
  const frit = oval ? ellipse(tw / 2 + 1.04, td / 2 + 1.04, 24, 0, -d * 0.06) : rrect(tw + 2.08, td + 2.08, Math.min(tw, td) * 0.3 + 1.04, 0, -d * 0.06, 4);
  const n = Math.max(6, Math.round((H - podium) / FH));
  const top = podium + n * FH;
  B.walls(plan, podium, top, K.GLASS);
  if (!lod) {
    for (let k = 1; k < n; k++) {
      const y = podium + k * FH;
      B.prism(plate, y - 0.28, y, K.STONE, K.PAVING, { bottom: true });
      B.walls(frit, y, y + 1.0, K.FRIT);
      B.walls(plate, y + 1.0, y + 1.08, K.METAL);
    }
  }
  // crown garden: wider plate, planted, with a lantern ring
  const crown = oval ? ellipse(tw / 2 + 2.5, td / 2 + 2.5, 24, 0, -d * 0.06) : rrect(tw + 5, td + 5, Math.min(tw, td) * 0.3 + 2.5, 0, -d * 0.06, 4);
  B.prism(crown, top - 0.6, top, K.STONE, K.GARDEN, { bottom: true });
  if (!lod) {
    B.walls(crown, top, top + 0.9, K.GLASS);
    B.walls(oval ? ellipse(tw * 0.22, td * 0.22, 16, 0, -d * 0.06) : rrect(tw * 0.44, td * 0.44, 2, 0, -d * 0.06), top, top + 4, K.LANTERN);
  }
  return top + 4;
}

function pavilion(B, L, R, H, lod) {
  const r = Math.min(L.w, L.d) * 0.36;
  const h = 6 + R() * 4;
  // stepped plinth
  B.prism(ellipse(r + 3.2, r + 3.2, 32), 0, 0.5, K.STONE, K.PAVING);
  B.prism(ellipse(r + 2.2, r + 2.2, 32), 0.5, 1.0, K.STONE, K.PAVING);
  B.walls(ellipse(r, r, 32), 1.0, 1.0 + h, K.PUNCHED);
  const prof = [];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2) * 0.93; prof.push([r * 1.02 * Math.cos(a), 1 + h + r * 0.85 * Math.sin(a), K.GLASS]); }
  B.lathe(0, 0, [[r * 1.08, 1 + h - 0.6, K.STONE], [r * 1.08, 1 + h, K.STONE], ...prof], 32);
  const tr = r * 1.02 * Math.cos((Math.PI / 2) * 0.93);
  B.lathe(0, 0, [[tr + 0.2, 1 + h + r * 0.85 * 0.99, K.LANTERN], [tr * 0.9, 1 + h + r * 0.85 + 2.2, K.LANTERN], [0.1, 1 + h + r * 0.85 + 3.0, K.STONE]], 12);
  if (!lod) {
    // portico toward the street
    const cols = 6, span = r * 1.3;
    for (let k = 0; k < cols; k++) {
      const x = -span / 2 + (k * span) / (cols - 1);
      B.lathe(x, r + 1.6, [[0.45, 1.0, K.STONE], [0.36, 1 + h - 0.8, K.STONE], [0.6, 1 + h - 0.6, K.STONE]], 10);
    }
    B.box(-span / 2 - 1, span / 2 + 1, r - 1, r + 2.6, 1 + h - 0.6, 1 + h + 0.4, K.STONE, K.STONE, { bottom: true });
  }
  return 1 + h + r * 0.85 + 3;
}

function mews(B, L, R, H, lod, seed) {
  const w = L.w, d = Math.min(L.d, 14);
  const m = Math.max(1, Math.round(w / (6 + R() * 2.5)));
  const hw = w / m;
  const roofType = Math.floor(R() * 3);
  let maxY = 0;
  for (let i = 0; i < m; i++) {
    B.seed = seed + i * 17.3;
    const x0 = -w / 2 + i * hw, x1 = x0 + hw;
    const fl = 2 + (R() < 0.4 ? 1 : 0);
    const y1 = fl * FH;
    const zf = d / 2 - (R() < 0.3 ? 0.8 : 0), z0 = zf - d;
    B.box(x0, x1, z0, zf, 0, y1, K.PUNCHED, K.GARDEN, { noTop: roofType !== 2 });
    if (roofType === 0) B.gable(x0, x1, z0, zf, y1, d * 0.28, R() < 0.5 ? K.PV : K.TIMBER, K.PUNCHED);
    else if (roofType === 1) B.vault(x0, x1, z0, zf, y1, d * 0.22, R() < 0.5 ? K.GARDEN : K.PV, lod ? 4 : 8);
    else if (!lod) B.walls(rrect(hw - 0.1, d - 0.1, 0.05, (x0 + x1) / 2, (z0 + zf) / 2), y1, y1 + 0.8, K.STONE);
    const rDoor = R(), rPlanter = R();   // drawn in both passes so the massing matches
    if (!lod) {
      // door, its canopy, and a planter
      const dx = (x0 + x1) / 2 + (rDoor - 0.5) * hw * 0.3;
      B.box(dx - 0.65, dx + 0.65, zf - 0.02, zf + 0.06, 0, 2.5, K.METAL, K.METAL);
      B.box(dx - 1.2, dx + 1.2, zf, zf + 1.1, 2.7, 2.85, K.STONE, K.STONE, { bottom: true });
      if (rPlanter < 0.6) B.box(x0 + 0.4, x0 + 1.6, zf + 0.2, zf + 0.9, 0, 0.7, K.STONE, K.GARDEN);
    }
    maxY = Math.max(maxY, y1 + d * 0.3);
  }
  B.seed = seed;
  return maxY;
}

function stack(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const n = Math.max(2, Math.min(4, Math.round(H / 7)));
  let y = 0;
  let prev = null;
  for (let i = 0; i < n; i++) {
    const fl = 1 + (R() < 0.6 ? 1 : 0);
    const h = fl * FH;
    const bw = w * (0.62 + R() * 0.3), bd = d * (0.6 + R() * 0.3);
    const cx = (R() - 0.5) * (w - bw), cz = (R() - 0.5) * (d - bd);
    const a = (R() - 0.5) * 0.3;
    const c = Math.cos(a), s = Math.sin(a);
    const poly = [[-bw / 2, -bd / 2], [bw / 2, -bd / 2], [bw / 2, bd / 2], [-bw / 2, bd / 2]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
    const kind = i % 2 ? K.TIMBER : K.GLASS;
    B.prism(poly, y, y + h, kind, K.GARDEN, { bottom: i > 0 });
    if (!lod && kind === K.TIMBER) {
      // glazed ribbon window cut into the timber box
      const inner = poly.map(([x, z]) => [cx + (x - cx) * 1.012, cz + (z - cz) * 1.012]);
      B.walls(inner, y + 1.0, y + h - 0.9, K.GLASS);
    }
    if (!lod) B.walls(poly, y + h, y + h + 0.9, K.METAL);
    prev = poly;
    y += h;
  }
  void prev;
  return y;
}

// ------------------------------------------------------- ward typologies --
// The Outer Wards build in their own vernaculars (see wards.js). Same local frame and LOD
// rules as above: `lod` true = massing only.

// Aurora: a research laboratory cut like a crystal - faceted glass volumes that swell, turn
// and close into a lit prism, on a stone plinth
function crystal(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const n = 6;
  const rx = w * 0.46, rz = d * 0.46;
  const ph = R() * TAU;
  const jit = [];
  for (let i = 0; i < n; i++) jit.push(0.86 + R() * 0.2);
  const ring = (s, twist) => { const out = []; for (let i = 0; i < n; i++) { const a = ph + twist + (i / n) * TAU; out.push([Math.cos(a) * rx * s * jit[i], Math.sin(a) * rz * s * jit[i]]); } return out; };
  const top = Math.max(2, Math.round(H / FH)) * FH;
  const r0 = ring(1, 0), r1 = ring(1.08, 0.08), r2 = ring(0.7, 0.3);
  B.prism(rrect(w - 1, d - 1, 1.2), 0, 1.2, K.STONE, K.PAVING);
  B.loft(r0.map(([x, z]) => [x * 0.94, z * 0.94]), 1.2, r1, top * 0.58, K.GLASS);
  B.loft(r1, top * 0.58, r2, top, K.GLASS);
  // the prism crown: glass closing to a lit ridge
  const tipR = r2.map(([x, z]) => [x * 0.25, z * 0.25]);
  B.loft(r2, top, tipR, top + Math.min(w, d) * 0.28, K.LANTERN);
  B.cap(tipR, top + Math.min(w, d) * 0.28, K.LANTERN);
  if (lod) return top + Math.min(w, d) * 0.28;
  // fins at every facet edge on the lower body, a spectral mast on the ridge
  for (let i = 0; i < n; i++) {
    const [x, z] = r1[i];
    B.box(x - 0.18, x + 0.18, z - 0.18, z + 0.18, top * 0.58 - 0.4, top * 0.58 + 0.6, K.METAL, K.METAL);
  }
  B.lathe(0, 0, [[0.25, top + Math.min(w, d) * 0.26, K.METAL], [0.12, top + Math.min(w, d) * 0.28 + 7, K.METAL], [0.02, top + Math.min(w, d) * 0.28 + 8, K.LANTERN]], 6);
  return top + Math.min(w, d) * 0.28 + 8;
}

// Aurora: a college round its quad - a cloister with a gate tower on the street and turrets
function college(B, L, R, H, lod) {
  const top = cloister(B, L, R, H, lod);
  const w = L.w, d = L.d;
  const gw = Math.min(14, w * 0.18);
  const zf = d / 2 - 5;
  B.box(-gw / 2, gw / 2, zf - 5, zf + 5.6, 0, top + 12, K.PUNCHED, K.STONE);
  B.box(-gw / 2 + 0.8, gw / 2 - 0.8, zf - 4.2, zf + 4.8, top + 12, top + 17, K.LANTERN, K.STONE);
  B.lathe(0, zf + 0.3, [[gw * 0.42, top + 17, K.STONE], [gw * 0.1, top + 25, K.STONE], [0.05, top + 26, K.STONE]], 8);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * (w / 2 - 3), cz = sz * (d / 2 - 3);
    B.lathe(cx, cz, [[3.4, 0, K.STONE], [3.2, top + 4, K.PUNCHED], [3.8, top + 4.2, K.STONE], [0.05, top + 10, K.STONE]], lod ? 6 : 12);
  }
  if (!lod) {
    // the gate: an arched passage through the street wing
    B.box(-gw / 2 - 0.5, gw / 2 + 0.5, zf + 5.6, zf + 6.2, 0, 1.2, K.STONE, K.STONE);
    B.vprism([[-3, 0], [3, 0], [3, 4.2], [2.1, 5.4], [0, 6], [-2.1, 5.4], [-3, 4.2]], zf + 5.61, zf + 5.7, K.METAL);
  }
  return top + 26;
}

// A closed band between two polygons of equal vertex count (outer and inner): the flat ring
// at height y, facing up or down - tops of planters and parapets, soffits of overhangs
function ringBand(B, outer, inner, y, kind, up = true) {
  const n = outer.length;
  B.reserve(n * 4, n * 6);
  const ny = up ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = B.v(outer[i][0], y, outer[i][1], 0, ny, 0, outer[i][0], outer[i][1], kind), b = B.v(outer[j][0], y, outer[j][1], 0, ny, 0, outer[j][0], outer[j][1], kind);
    const c = B.v(inner[j][0], y, inner[j][1], 0, ny, 0, inner[j][0], inner[j][1], kind), d = B.v(inner[i][0], y, inner[i][1], 0, ny, 0, inner[i][0], inner[i][1], kind);
    B.quad(a, b, c, d);
  }
}

// A solid parapet or planter wall: outer and inner faces and a coping on top, so it reads
// from inside the roof as well as from the street
function ringWall(B, outer, inner, y0, y1, kind, topKind = kind) {
  B.walls(outer, y0, y1, kind);
  B.walls(inner, y0, y1, kind, { flip: true });
  ringBand(B, outer, inner, y1, topKind);
}

// Tidewater: a narrow canal house - brick front, tall windows, a shopfront at the quay, and
// one of four gables (step, bell, neck, cornice) with a hoist beam under the apex
function canal(B, L, R, H, lod) {
  const w = Math.min(L.w, 11), d = L.d;
  const fl = Math.max(3, Math.round(H / FH));
  const top = fl * FH;
  const zf = d / 2;
  // shopfront, then brick above
  B.box(-w / 2 + 0.25, w / 2 - 0.25, -d / 2, zf - 0.3, 0, FH, K.GLASS, K.STONE, { noTop: true });
  B.box(-w / 2, w / 2, -d / 2, zf, FH, top, K.PUNCHED, K.STONE, { bottom: true });
  const g = Math.floor(R() * 4);
  // the cornice house hides a low roof behind its attic; the others show a steep gable
  const rise = g === 3 ? 1.2 : Math.min(w * 0.75, 7);
  // pitched roof, ridge front to back (build in a frame turned a quarter)
  const c0 = B.c, s0 = B.s;
  B.c = Math.cos(L.rot + Math.PI / 2); B.s = Math.sin(L.rot + Math.PI / 2);
  B.gable(-(zf - 0.6), d / 2, -w / 2, w / 2, top, rise, R() < 0.5 ? K.METAL : K.TIMBER, K.PUNCHED);
  B.c = c0; B.s = s0;
  // the gable front
  const zg0 = zf - 0.6, zg1 = zf + 0.05;
  if (g === 0) {
    // stepped
    const steps = 4;
    for (let k = 0; k < steps; k++) {
      const ww = w * (1 - k / steps) * 0.98;
      B.box(-ww / 2, ww / 2, zg0, zg1, top + (k * rise) / steps, top + ((k + 1) * rise) / steps, K.PUNCHED, K.STONE);
    }
  } else if (g === 1) {
    // bell gable with scrolls
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; const x = -w / 2 + w * t; const y = rise * Math.pow(Math.sin(Math.PI * t), 0.6) * (1 - 0.15 * Math.cos(TAU * t)); pts.push([x, top + y]); }
    B.vprism(pts.reverse().concat([]), zg0, zg1, K.PUNCHED, K.STONE);
    B.vprism([[-w * 0.1, top + rise * 0.98], [w * 0.1, top + rise * 0.98], [0, top + rise * 1.12]], zg0, zg1, K.STONE);
  } else if (g === 2) {
    // neck gable: a tall narrow neck on shoulders
    B.vprism([[-w / 2, top], [w / 2, top], [w / 2, top + rise * 0.3], [w * 0.22, top + rise * 0.62], [w * 0.22, top + rise * 1.05], [-w * 0.22, top + rise * 1.05], [-w * 0.22, top + rise * 0.62], [-w / 2, top + rise * 0.3]], zg0, zg1, K.PUNCHED, K.STONE);
  } else {
    // flat cornice, attic storey
    B.box(-w / 2 - 0.2, w / 2 + 0.2, zf - 1.2, zf + 0.35, top, top + 0.6, K.STONE, K.STONE, { bottom: true });
    B.box(-w / 2, w / 2, zg0, zg1, top + 0.6, top + 1.6, K.PUNCHED, K.STONE);
  }
  if (!lod) {
    // string courses at every floor line and a plinth band over the shopfront
    for (let k = 1; k < fl; k++) B.box(-w / 2 - 0.06, w / 2 + 0.06, zf, zf + 0.14, k * FH - 0.22, k * FH, K.STONE, K.STONE, { bottom: true });
    // hoist beam, stoop and a door
    const ya = top + rise * (g === 3 ? 0.2 : 0.78);
    B.box(-0.12, 0.12, zf - 0.1, zf + 1.1, ya, ya + 0.24, K.TIMBER, K.TIMBER);
    B.box(-1.1, 1.1, zf - 0.02, zf + 1.4, 0, 0.45, K.STONE, K.PAVING);
    B.box(-0.6, 0.6, zf - 0.28, zf - 0.22, 0.45, 2.6, K.METAL, K.METAL);
  }
  return top + rise * 1.12;
}

// Tidewater and the harbours: a block over a street arcade - round columns carrying the
// upper floors, a vaulted loggia behind them, a cornice and a roof garden
function arcade(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const fl = Math.max(3, Math.round(H / FH));
  const top = fl * FH;
  const depth = 3.6;
  const zf = d / 2;
  B.box(-w / 2 + 0.3, w / 2 - 0.3, -d / 2, zf - depth, 0, FH + 0.9, K.GLASS, K.STONE, { noTop: true });
  B.box(-w / 2, w / 2, -d / 2, zf, FH + 0.9, top, K.PUNCHED, K.GARDEN, { bottom: true });
  // cornice
  B.box(-w / 2 - 0.35, w / 2 + 0.35, -d / 2 - 0.35, zf + 0.45, top - 0.6, top, K.STONE, K.GARDEN, { bottom: true });
  const n = Math.max(2, Math.round(w / 4.2));
  if (!lod) {
    for (let k = 0; k <= n; k++) {
      const x = -w / 2 + 0.6 + (k * (w - 1.2)) / n;
      B.lathe(x, zf - 0.55, [[0.5, 0, K.STONE], [0.52, 0.4, K.STONE], [0.38, 0.5, K.STONE], [0.34, FH - 0.2, K.STONE], [0.55, FH + 0.05, K.STONE], [0.55, FH + 0.25, K.STONE]], 10);
    }
    // arches between the columns
    for (let k = 0; k < n; k++) {
      const x0 = -w / 2 + 0.6 + (k * (w - 1.2)) / n, x1 = -w / 2 + 0.6 + ((k + 1) * (w - 1.2)) / n;
      const sp = x1 - x0 - 1.0, cx = (x0 + x1) / 2;
      const pts = [[cx - sp / 2 - 0.5, FH + 0.25], [cx + sp / 2 + 0.5, FH + 0.25], [cx + sp / 2 + 0.5, FH + 0.9], [cx - sp / 2 - 0.5, FH + 0.9]];
      const arch = [];
      for (let i = 0; i <= 8; i++) { const a = Math.PI * (i / 8); arch.push([cx + Math.cos(a) * sp / 2, FH + 0.25 - 0.9 + Math.sin(a) * 0.9]); }
      B.vprism(pts, zf - 1.0, zf - 0.1, K.STONE);
      void arch;
    }
    B.vault(-w / 2 + 0.3, w / 2 - 0.3, zf - depth, zf - 0.2, FH + 0.9 - 1.3, 1.2, K.STONE, 6);
  } else B.box(-w / 2, w / 2, zf - 1.0, zf - 0.1, 0, FH + 0.9, K.STONE, K.STONE);
  roofKit(B, R, rrect(w, d, 0.2), top, w - 2, d - 2, lod, { garden: 0.7 });
  return top + 3.4;
}

// Sunward: a solar terrace - golden stone, deep brise-soleil on the street face, a sawtooth
// of steep photovoltaic roofs, and a set-back top floor
function solar(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const fl = Math.max(2, Math.round(H / FH));
  const top = fl * FH;
  B.box(-w / 2, w / 2, -d / 2, d / 2 - 1.2, 0, top, K.PUNCHED, K.PAVING);
  B.box(-w / 2 + 0.4, w / 2 - 0.4, d / 2 - 1.2, d / 2 - 0.9, 0, FH, K.GLASS, K.STONE, { noTop: true });
  // set-back top floor with a sawtooth roof of steep PV
  const sw = w - 6, sd = d - 8;
  B.box(-sw / 2, sw / 2, -sd / 2 - 1, sd / 2 - 1, top, top + FH, K.GLASS, K.STONE, { noTop: true });
  const rows = Math.max(2, Math.floor(sd / 4.5));
  for (let i = 0; i < rows; i++) {
    const z0 = -sd / 2 - 1 + (i * sd) / rows, z1 = z0 + sd / rows;
    B.vprism([[-sw / 2, top + FH], [sw / 2, top + FH], [sw / 2, top + FH + 2.6], [-sw / 2, top + FH + 2.6]].map(([x, y]) => [x, y]), z0, z0 + 0.3, K.METAL);
    // the sloped panel from the low edge (z1) up to the ridge (z0)
    const run = Math.max(0.1, z1 - z0 - 0.3), sl = Math.hypot(run, 2.6), pny = run / sl, pnz = 2.6 / sl;
    B.reserve(10, 12);
    const a = B.v(-sw / 2, top + FH, z1, 0, pny, pnz, -sw / 2, 0, K.PV), b = B.v(sw / 2, top + FH, z1, 0, pny, pnz, sw / 2, 0, K.PV);
    const c = B.v(sw / 2, top + FH + 2.6, z0 + 0.3, 0, pny, pnz, sw / 2, sl, K.PV), e = B.v(-sw / 2, top + FH + 2.6, z0 + 0.3, 0, pny, pnz, -sw / 2, sl, K.PV);
    B.quad(a, b, c, e);
    // triangular cheeks close each tooth at both ends
    for (const sx of [-1, 1]) {
      const x = (sx * sw) / 2;
      B.tri(B.v(x, top + FH, z1, sx, 0, 0, z1, top + FH, K.STONE), B.v(x, top + FH, z0 + 0.3, sx, 0, 0, z0, top + FH, K.STONE), B.v(x, top + FH + 2.6, z0 + 0.3, sx, 0, 0, z0, top + FH + 2.6, K.STONE));
    }
  }
  if (lod) return top + FH + 2.6;
  // brise-soleil: horizontal golden fins on every floor of the street face, vertical blades between
  for (let k = 1; k <= fl; k++) {
    const y = k * FH - 0.3;
    B.box(-w / 2 - 0.2, w / 2 + 0.2, d / 2 - 1.2, d / 2 + 0.9, y - 0.12, y, K.TIMBER, K.TIMBER, { bottom: true });
  }
  const nb = Math.floor(w / 3.3);
  for (let i = 0; i <= nb; i++) { const x = -w / 2 + (i * w) / nb; B.box(x - 0.08, x + 0.08, d / 2 - 0.2, d / 2 + 0.8, FH, top - 0.3, K.METAL, K.METAL); }
  ringWall(B, rrect(w, d - 1.2, 0, 0, -0.6), rrect(w - 0.5, d - 1.7, 0, 0, -0.6), top, top + 0.9, K.STONE);
  return top + FH + 2.6;
}

// Seraph: a hanging-garden ziggurat - planted terraces stepping in on all four sides, vines
// spilling over every lip, a pergola on the summit
function ziggurat(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const fl = Math.max(4, Math.round(H / FH));
  const tiers = Math.max(3, Math.min(6, Math.round(fl / 2)));
  const per = Math.max(1, Math.round(fl / tiers));
  const step = Math.min(3.6, Math.min(w, d) / (tiers * 2 + 1.5));
  let y = 0;
  for (let t = 0; t < tiers; t++) {
    const tw = w - 2 * step * t, td = d - 2 * step * t;
    const h = per * FH;
    const poly = rrect(tw, td, 1.2);
    B.walls(poly, y, y + h, t % 2 ? K.PUNCHED : K.GLASS);
    B.cap(poly, y + h, K.GARDEN);
    // a closed planter box round the lip, its planting hanging over the wall below: outer
    // face, soffit, inner face and a planted top, so no view finds a gap into it
    const po = rrect(tw + 0.5, td + 0.5, 1.45), pi = rrect(tw - 0.7, td - 0.7, 0.85);
    B.walls(po, y + h - 1.7, y + h + 0.6, K.GARDEN);
    ringBand(B, po, poly, y + h - 1.7, K.GARDEN, false);
    B.walls(pi, y + h, y + h + 0.6, K.STONE, { flip: true });
    ringBand(B, po, pi, y + h + 0.6, K.GARDEN);
    y += h;
  }
  if (!lod) {
    const tw = w - 2 * step * (tiers - 1) - 3, td = d - 2 * step * (tiers - 1) - 3;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(sx * tw / 2 - 0.15, sx * tw / 2 + 0.15, sz * td / 2 - 0.15, sz * td / 2 + 0.15, y, y + 2.75, K.TIMBER, K.TIMBER);
    // two beams on the posts carry the rafters
    for (const sz of [-1, 1]) B.box(-tw / 2 - 0.3, tw / 2 + 0.3, sz * td / 2 - 0.18, sz * td / 2 + 0.18, y + 2.75, y + 2.9, K.TIMBER, K.TIMBER, { bottom: true });
    const m = Math.floor(tw / 1.2);
    for (let i = 0; i <= m; i++) { const x = -tw / 2 + (i * tw) / m; B.box(x - 0.07, x + 0.07, -td / 2, td / 2, y + 2.9, y + 3.1, K.TIMBER, K.TIMBER); }
  }
  return y + 3.1;
}

// Southmarch: a harbour warehouse, now lofts - brick hall with a triple vaulted roof,
// stepped parapet gables, loading doors and a canopy along the quay street
function warehouse(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const fl = Math.max(2, Math.round(H / FH));
  const top = fl * FH;
  B.box(-w / 2, w / 2, -d / 2, d / 2, 0, top, K.PUNCHED, K.STONE);
  const nv = 3;
  for (let i = 0; i < nv; i++) {
    const z0 = -d / 2 + (i * d) / nv, z1 = z0 + d / nv;
    B.vault(-w / 2 + 0.3, w / 2 - 0.3, z0 + 0.15, z1 - 0.15, top, (d / nv) * 0.34, i === 1 ? K.PV : K.METAL, lod ? 4 : 8);
  }
  // stepped parapet gables at both ends
  for (const sx of [-1, 1]) {
    const x0 = sx * (w / 2) - (sx > 0 ? 0.6 : 0), x1 = x0 + 0.6;
    B.box(x0, x1, -d / 2, d / 2, top, top + 1.6, K.PUNCHED, K.STONE);
    B.box(x0, x1, -d * 0.22, d * 0.22, top + 1.6, top + 3.4, K.PUNCHED, K.STONE);
  }
  if (lod) return top + 3.4;
  // loading doors and a steel canopy on brackets along the street face
  const nd = Math.max(2, Math.floor(w / 9));
  for (let i = 0; i < nd; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / nd;
    B.box(x - 1.8, x + 1.8, d / 2 - 0.05, d / 2 + 0.05, 0, 3.9, K.METAL, K.METAL);
  }
  B.box(-w / 2, w / 2, d / 2, d / 2 + 2.8, 4.6, 4.85, K.METAL, K.METAL, { bottom: true });
  for (let i = 0; i <= nd; i++) { const x = -w / 2 + (i * w) / nd; B.box(x - 0.1, x + 0.1, d / 2, d / 2 + 2.6, 4.2, 4.6, K.METAL, K.METAL); }
  return top + 3.4;
}

// Coral Reach: a reef house - a cluster of domes grown together, shell ribs and glass,
// each with a lit oculus, on a plinth of pale stone
function reef(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const fl = Math.max(2, Math.round(H / FH));
  const hMax = fl * FH;
  B.prism(rrect(w - 0.6, d - 0.6, Math.min(w, d) * 0.3), 0, 0.9, K.STONE, K.PAVING);
  const domes = [];
  const nD = 2 + Math.floor(R() * 3);
  for (let i = 0; i < nD && domes.length < 5; i++) {
    const r = Math.min(w, d) * (0.22 + R() * 0.18);
    const cx = (R() - 0.5) * (w - 2 * r - 1), cz = (R() - 0.5) * (d - 2 * r - 1);
    domes.push({ cx, cz, r });
  }
  domes.sort((a, b) => b.r - a.r);
  let top = 0;
  domes.forEach((dm, i) => {
    const h = Math.max(4, hMax * (i === 0 ? 1 : 0.55 + R() * 0.35)) - dm.r * 0.6;
    const prof = [[dm.r * 1.02, 0.9, K.STONE], [dm.r, 0.9, K.PUNCHED], [dm.r * 0.98, h, K.PUNCHED]];
    for (let k = 1; k <= 7; k++) { const a = (k / 7) * (Math.PI / 2) * 0.9; prof.push([dm.r * Math.cos(a), h + dm.r * 0.75 * Math.sin(a), k % 2 ? K.GLASS : K.STONE]); }
    const tr = dm.r * Math.cos((Math.PI / 2) * 0.9);
    prof.push([tr * 0.8, h + dm.r * 0.75 * 0.99 + 0.3, K.LANTERN], [0.05, h + dm.r * 0.75 + 0.8, K.LANTERN]);
    B.lathe(dm.cx, dm.cz, prof, lod ? 8 : 18);
    top = Math.max(top, h + dm.r * 0.8);
  });
  if (!lod) {
    // a shell canopy over the door toward the street
    B.lathe(0, d / 2 - 1.2, [[2.6, 2.8, K.STONE], [2.4, 3.2, K.STONE], [0.05, 3.5, K.STONE]], 10);
  }
  return top;
}

// Westmere: a mansion block - rusticated base, balconies on the second and fifth floors, a
// deep cornice, a zinc mansard with dormers
function mansion(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const fl = Math.max(4, Math.round(H / FH));
  const top = fl * FH;
  B.box(-w / 2, w / 2, -d / 2, d / 2, 0, FH * 1.2, K.STONE, K.STONE, { noTop: true });
  B.box(-w / 2 + 0.25, w / 2 - 0.25, d / 2 - 0.3, d / 2 - 0.2, 0.3, FH, K.GLASS, K.GLASS);
  B.box(-w / 2, w / 2, -d / 2, d / 2, FH * 1.2, top, K.PUNCHED, K.STONE, { noTop: true });
  // cornice and mansard
  B.box(-w / 2 - 0.5, w / 2 + 0.5, -d / 2 - 0.5, d / 2 + 0.6, top, top + 0.7, K.STONE, K.STONE, { bottom: true });
  B.frustum(w, d, w - 3.2, d - 3.2, top + 0.7, top + 4.4, K.METAL, K.METAL);
  B.frustum(w - 3.2, d - 3.2, w - 5, d - 5, top + 4.4, top + 5.6, K.METAL, K.METAL);
  if (lod) return top + 5.6;
  for (const k of [2, fl - 1]) {
    if (k < 2) continue;
    const y = k * FH;
    B.box(-w / 2, w / 2, d / 2, d / 2 + 1.1, y - 0.18, y, K.STONE, K.PAVING, { bottom: true });
    B.box(-w / 2, w / 2, d / 2 + 1.0, d / 2 + 1.1, y, y + 1.0, K.METAL, K.METAL);
  }
  // dormers in the mansard
  const n = Math.max(2, Math.floor(w / 4.4));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 2.2 + (i * (w - 4.4)) / Math.max(1, n - 1);
    B.box(x - 0.8, x + 0.8, d / 2 - 1.9, d / 2 - 0.9, top + 1.1, top + 3.3, K.PUNCHED, K.METAL);
  }
  // chimney stacks along the ridge
  for (const sx of [-0.3, 0.3]) B.box(sx * w - 0.6, sx * w + 0.6, -0.8, 0.8, top + 5.6, top + 7.2, K.STONE, K.STONE);
  return top + 7.2;
}

// Westmere: a gallery palazzo - rusticated base, a piano nobile of giant pilasters,
// a heavy cornice and an attic with a balustrade
function gallery(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const fl = Math.max(3, Math.round(H / FH));
  const top = fl * FH;
  B.box(-w / 2, w / 2, -d / 2, d / 2, 0, FH * 1.4, K.STONE, K.STONE, { noTop: true });
  B.box(-w / 2, w / 2, -d / 2, d / 2, FH * 1.4, top, K.PUNCHED, K.STONE, { noTop: true });
  B.box(-w / 2 - 0.7, w / 2 + 0.7, -d / 2 - 0.7, d / 2 + 0.8, top, top + 1.1, K.STONE, K.STONE, { bottom: true });
  B.box(-w / 2 + 0.6, w / 2 - 0.6, -d / 2 + 0.6, d / 2 - 0.6, top + 1.1, top + 3.2, K.PUNCHED, K.STONE);
  if (lod) return top + 3.2;
  const n = Math.max(3, Math.round(w / 4.8));
  for (let i = 0; i <= n; i++) {
    const x = -w / 2 + 0.4 + (i * (w - 0.8)) / n;
    B.box(x - 0.42, x + 0.42, d / 2, d / 2 + 0.45, FH * 1.4, top - 0.2, K.STONE, K.STONE);
  }
  for (let i = 0; i <= Math.floor(w / 0.9); i++) { const x = -w / 2 + 0.8 + i * 0.9; if (x > w / 2 - 0.8) break; B.lathe(x, d / 2 + 0.2, [[0.14, top + 1.1, K.STONE], [0.08, top + 1.5, K.STONE], [0.14, top + 1.9, K.STONE]], 6); }
  B.box(-w / 2 + 0.4, w / 2 - 0.4, d / 2 - 0.1, d / 2 + 0.4, top + 1.9, top + 2.1, K.STONE, K.STONE, { bottom: true });
  return top + 3.2;
}

// Westmere, Museum Mile: a museum - wings either side of a pedimented portico, a drum and
// dome over the central hall
function museum(B, L, R, H, lod) {
  const w = L.w, d = L.d;
  const h = 15;
  B.prism(rrect(w + 2, d + 2, 0.5), 0, 1.4, K.STONE, K.PAVING);
  B.box(-w / 2, w / 2, -d / 2, d / 2 - 8, 1.4, h, K.PUNCHED, K.STONE);
  B.box(-w / 2 - 0.6, w / 2 + 0.6, -d / 2 - 0.6, d / 2 - 7.4, h, h + 1.2, K.STONE, K.STONE, { bottom: true });
  // central drum and dome
  const r = Math.min(d * 0.32, 14);
  B.lathe(0, -2, [[r + 0.6, h + 1.2, K.STONE], [r, h + 1.2, K.PUNCHED], [r, h + 8, K.PUNCHED], [r + 0.6, h + 8.4, K.STONE]], lod ? 12 : 28);
  const prof = [];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2) * 0.94; prof.push([r * Math.cos(a), h + 8.4 + r * 0.9 * Math.sin(a), K.GLASS]); }
  B.lathe(0, -2, prof, lod ? 12 : 28);
  B.lathe(0, -2, [[r * 0.2, h + 8.4 + r * 0.9, K.LANTERN], [r * 0.14, h + 11 + r * 0.9, K.LANTERN], [0.05, h + 12 + r * 0.9, K.STONE]], 10);
  // portico: columns, entablature, pediment
  const pw = Math.min(34, w * 0.4);
  B.box(-pw / 2 - 1, pw / 2 + 1, d / 2 - 8, d / 2 - 0.5, h - 1.6, h, K.STONE, K.STONE, { bottom: true });
  B.vprism([[-pw / 2 - 1, h], [pw / 2 + 1, h], [0, h + 5.2]], d / 2 - 8, d / 2 - 0.6, K.STONE);
  if (!lod) {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const x = -pw / 2 + (i * pw) / (n - 1);
      B.lathe(x, d / 2 - 1.6, [[0.85, 1.4, K.STONE], [0.75, 2.0, K.STONE], [0.62, h - 2.2, K.STONE], [0.9, h - 1.6, K.STONE]], 12);
    }
    // the steps up to the portico
    for (let k = 0; k < 4; k++) B.box(-pw / 2 - 2, pw / 2 + 2, d / 2 - 0.5 + k * 0.45, d / 2 + 0.2 + k * 0.45, 0, 1.4 - k * 0.35, K.STONE, K.PAVING);
  }
  return h + 12 + r * 0.9;
}

// ---------------------------------------------------------------- driver --
function chooseType(L, R) {
  const r = R();
  const big = L.w > 26 && L.d > 24;
  // the rim towns: arcades along their waterfront esplanades, terraces and mews behind
  if (L.dk === 'rim' && L.cls === ST.ESPLANADE && r < 0.5) return 'arcade';
  if (L.dk === 'rim') return r < 0.55 ? 'mews' : r < 0.75 ? 'terrace' : r < 0.87 && big ? 'cloister' : r < 0.94 ? 'stack' : 'pavilion';
  if (L.dk === 'islet') return r < 0.45 ? 'mews' : r < 0.65 ? 'terrace' : r < 0.85 ? 'ribbon' : 'stack';
  if (L.cls === ST.LANE) return r < 0.5 ? 'mews' : r < 0.8 ? 'stack' : 'terrace';
  // the Outer Wards: denser and taller, towers gathering toward each ward's heart
  if (L.dk === 'ward') {
    if (L.centre > 0.35 && big && r < 0.5) return 'tower';
    return r < 0.34 ? 'ribbon' : r < 0.56 ? 'terrace' : r < 0.8 && big ? 'cloister' : r < 0.92 ? 'stack' : 'pavilion';
  }
  if (L.dk === 'central') return r < 0.34 ? 'ribbon' : r < 0.62 ? 'terrace' : r < 0.82 && big ? 'cloister' : r < 0.9 ? 'stack' : 'pavilion';
  // island towns
  if (L.centre > 0.55 && big && r < 0.35) return 'tower';
  return r < 0.4 ? 'ribbon' : r < 0.62 ? 'terrace' : r < 0.8 && big ? 'cloister' : r < 0.9 ? 'stack' : r < 0.95 ? 'pavilion' : 'mews';
}

function heightFor(L, R, type) {
  const c = L.centre;
  let floors;
  switch (L.dk) {
    case 'rim': floors = 3 + Math.floor(R() * 4); break;
    case 'islet': floors = 2 + Math.floor(R() * 3); break;
    case 'central': floors = 3 + Math.floor(R() * 5); break;
    case 'ward': floors = 4 + Math.round(Math.pow(c, 1.2) * (5 + R() * 12)) + Math.floor(R() * 3); break;
    default: floors = 3 + Math.round(Math.pow(c, 1.5) * (3 + R() * 9)) + Math.floor(R() * 3);
  }
  if (type === 'tower') floors = Math.max(floors + 6, 13 + Math.floor(R() * 8));
  if (L.cls === ST.LANE) floors = Math.min(floors, 4);
  return floors * FH;
}

const TYPES = { ribbon, terrace, cloister, tower, pavilion, mews, stack, crystal, college, canal, arcade, solar, ziggurat, warehouse, reef, mansion, gallery, museum };

/**
 * Build all lots into chunked meshes with a near (detail) and far (massing) version.
 * Returns an updater with LOD switching.
 */
export function buildBuildings(scene, plan, ground, settings, opts = {}) {
  const chunks = new Map();
  const chunkKey = (L) => {
    const d = plan.districts.find((q) => q.id === L.district);
    if (!d) return 'misc';
    if (d.kind === 'islet') return d.id;
    const a = Math.atan2(L.z - d.z, L.x - d.x);
    const sectors = d.kind === 'rim' ? 28 : d.kind === 'central' ? 8 : d.kind === 'ward' ? 12 : 4;
    return `${d.id}:${Math.floor(((a + Math.PI) / TAU) * sectors) % sectors}`;
  };
  const placements = [];
  for (const L of plan.lots) {
    const R = mulberry32(Math.floor(L.seed * 7919) + 11);
    // ward lots arrive with their typology and storeys chosen by their ward's design
    const type = L.type && TYPES[L.type] ? L.type : chooseType(L, R);
    const H = L.floors ? L.floors * FH : heightFor(L, R, type);
    L.type = type;
    // sit on a podium at the top of the ground under the footprint
    L.baseY = L.hi + 0.25;
    const key = chunkKey(L);
    if (!chunks.has(key)) chunks.set(key, { lots: [], near: new Builder(1 << 16), far: new Builder(1 << 13) });
    const ch = chunks.get(key);
    ch.lots.push(L);
    let top = 0;
    for (const [B, lod] of [[ch.near, false], [ch.far, true]]) {
      const Rb = mulberry32(Math.floor(L.seed * 7919) + 29);
      B.seed = L.seed; B.roof = Rb();
      B.frame(L.x, L.baseY, L.z, L.rot);
      // podium down into the ground, with a paved apron toward the street
      const podium = rrect(L.w + 1.2, L.d + 1.2, 1.0);
      B.prism(podium, L.lo - L.baseY - 1.2, 0, K.STONE, K.PAVING, { vBase: 0 });
      if (!lod) {
        B.prism(rrect(L.w - 2, 2.6, 0.6, 0, L.d / 2 + 1.9), L.lo - L.baseY - 0.8, -0.02, K.STONE, K.PAVING);
      }
      const h = TYPES[type](B, L, Rb, H, lod, L.seed);
      top = Math.max(top, h);
    }
    placements.push({ x: L.x, z: L.z, sx: L.w, sz: L.d, y: L.baseY, sy: top, rot: L.rot, type });
  }

  const mat = createLowriseMaterial(opts.palette || 'pearl', { litFrac: opts.litFrac ?? 0.5, warmth: opts.warmth ?? 0.75, lampTint: opts.lampTint });
  const meshes = [];
  const list = [];
  let tris = 0;
  for (const [key, ch] of chunks) {
    const near = new THREE.Mesh(ch.near.geometry(), mat);
    const far = new THREE.Mesh(ch.far.geometry(), mat);
    for (const m of [near, far]) { m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; scene.add(m); meshes.push(m); }
    near.name = far.name = `Town ${key}`;
    const bs = far.geometry.boundingSphere;
    list.push({ key, near, far, center: bs.center.clone(), radius: bs.radius });
    tris += near.geometry.index.count / 3;
  }
  const api = {
    meshes, placements, chunks: list, tris,
    isFree: (x, z, r) => !placements.some((p) => Math.hypot(p.x - x, p.z - z) < r + Math.max(p.sx, p.sz) * 0.6),
    nearDist: 750,
    applyQuality(s) { this.nearDist = s.lowriseNear ?? (s.lowrise >= 1 ? 850 : s.lowrise >= 0.75 ? 600 : 380); },
    update(dt, t, camera) {
      if (!camera) return;
      const cp = camera.position;
      for (const c of list) {
        const d = cp.distanceTo(c.center) - c.radius;
        const near = d < this.nearDist;
        // near: detail in the main view, massing in the (cheaper) reflection pass
        c.near.visible = near;
        c.near.layers.set(near ? 1 : 0);
        c.far.layers.set(near ? 2 : 0);
      }
    },
  };
  api.applyQuality(settings);
  return api;
}

export { Builder, K as KIND, FH };
