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
const K = { GLASS: 0, STONE: 1, LANTERN: 2, GARDEN: 3, CONDUIT: 4, PUNCHED: 5, POOL: 6, PV: 7, TIMBER: 8, PAVING: 9, METAL: 10 };

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
      // rail and planter lip every other floor
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
  const n = Math.max(6, Math.round((H - podium) / FH));
  const top = podium + n * FH;
  B.walls(plan, podium, top, K.GLASS);
  if (!lod) {
    for (let k = 1; k < n; k++) {
      const y = podium + k * FH;
      B.prism(plate, y - 0.28, y, K.STONE, K.PAVING, { bottom: true });
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

// ---------------------------------------------------------------- driver --
function chooseType(L, R) {
  const r = R();
  const big = L.w > 26 && L.d > 24;
  if (L.dk === 'rim') return r < 0.55 ? 'mews' : r < 0.75 ? 'terrace' : r < 0.87 && big ? 'cloister' : r < 0.94 ? 'stack' : 'pavilion';
  if (L.dk === 'islet') return r < 0.45 ? 'mews' : r < 0.65 ? 'terrace' : r < 0.85 ? 'ribbon' : 'stack';
  if (L.cls === ST.LANE) return r < 0.5 ? 'mews' : r < 0.8 ? 'stack' : 'terrace';
  if (L.dk === 'central') return r < 0.34 ? 'ribbon' : r < 0.62 ? 'terrace' : r < 0.82 && big ? 'cloister' : r < 0.9 ? 'stack' : 'pavilion';
  // island towns
  if (L.centre > 0.55 && big && r < 0.35) return 'tower';
  return r < 0.4 ? 'ribbon' : r < 0.62 ? 'terrace' : r < 0.8 && big ? 'cloister' : r < 0.9 ? 'stack' : r < 0.95 ? 'pavilion' : 'mews';
}

function heightFor(L, R, type) {
  const c = L.centre;
  let floors;
  switch (L.dk) {
    case 'rim': floors = 2 + Math.floor(R() * 2); break;
    case 'islet': floors = 2 + Math.floor(R() * 3); break;
    case 'central': floors = 3 + Math.floor(R() * 5); break;
    default: floors = 3 + Math.round(Math.pow(c, 1.5) * (3 + R() * 9)) + Math.floor(R() * 3);
  }
  if (type === 'tower') floors = Math.max(floors + 6, 13 + Math.floor(R() * 8));
  if (L.cls === ST.LANE) floors = Math.min(floors, 4);
  return floors * FH;
}

const TYPES = { ribbon, terrace, cloister, tower, pavilion, mews, stack };

/**
 * Build all lots into chunked meshes with a near (detail) and far (massing) version.
 * Returns an updater with LOD switching.
 */
export function buildBuildings(scene, plan, ground, settings) {
  const chunks = new Map();
  const chunkKey = (L) => {
    const d = plan.districts.find((q) => q.id === L.district);
    if (!d) return 'misc';
    if (d.kind === 'islet') return d.id;
    const a = Math.atan2(L.z - d.z, L.x - d.x);
    const sectors = d.kind === 'rim' ? 28 : d.kind === 'central' ? 8 : 4;
    return `${d.id}:${Math.floor(((a + Math.PI) / TAU) * sectors) % sectors}`;
  };
  const placements = [];
  for (const L of plan.lots) {
    const R = mulberry32(Math.floor(L.seed * 7919) + 11);
    const type = chooseType(L, R);
    const H = heightFor(L, R, type);
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

  const mat = createLowriseMaterial('pearl', { litFrac: 0.5, warmth: 0.75 });
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
    applyQuality(s) { this.nearDist = s.lowrise >= 1 ? 850 : s.lowrise >= 0.75 ? 600 : 380; },
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
