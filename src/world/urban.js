import * as THREE from 'three';
import { CENTRAL_ISLAND, ISLANDS, PLAZA_R, GATE, promenadeAxis } from './layout.js';
import { ISLETS, INNER, edt2d } from './terrain.js';
import { mulberry32, createNoise2D, smoothstep } from './noise.js';
import { planRim } from './rim/rimPlan.js';

// The town plan of MERIDIAN.
//
// Every island is laid out the same way a real planned town would be: a civic square at
// its heart, concentric ring streets, radial streets (the main one points back at the
// Axis and carries the promenade landing), and pedestrian lanes cutting the long blocks.
// Buildings are placed on lots that front those streets, set back behind a verge, with
// garden courtyards left inside each block. Streets, squares and street lamps are baked
// into one texture (the "street field") that the terrain, the tree planner and the
// ground lighting all read, so everything agrees on where the walks are.
//
// The plan is laid round what already stands: tower bases, the promenade decks and their
// maglev tubes where they come down to the ground, the station plinths and the rim
// bridgeheads. No street runs into them, no square is built over them, no lot or lamp
// stands in them; nothing is planned on ground the sea covers.

const TAU = Math.PI * 2;
const nW = createNoise2D(919);
const nPark = createNoise2D(313);

export const ST = { LANE: 1, STREET: 2, AVENUE: 3, ESPLANADE: 4 };
export const HALF_W = [0, 3.0, 5.0, 9.0, 6.5];
// building line behind the kerb, by street class (lanes are tight; streets leave room
// for a planted verge with street trees; avenues plant their median instead)
export const SB = [0, 3.5, 7.0, 6.0, 7.0];
export const SETBACK = 4.0;
// The kerb: a granite upstand along the carriageway's edge, the outer KERB.width metres of the
// street (the terrain draws it in relief), with the gutter's two courses of setts inside it.
export const KERB = { width: 0.3, height: 0.12, laneWidth: 0.22, laneHeight: 0.08, gutter: 0.56 };
// Street lamps stand in the verge behind the clipped hedge (the hedge runs 0.40-0.93 m behind the
// kerb on every street but the lanes): the post centre this many metres behind the kerb.
export const LAMP_E = [0, 0.95, 1.4, 1.4, 1.4];
const LAMP_R = 0.26;              // the post's foot (streetscape.js lampGeometry)
const LAMP_TOP = 6.6;             // headroom a lamp needs
// Square kinds as the terrain shader reads them (street frame, extra row).
export const SQUARE_KIND = { tower: 1, station: 2, civic: 3, landing: 4, village: 5 };
// The promenade deck (infrastructure.js / bridges.js): 29 m across, its soffit 3.2 m under the path.
const DECK_HW = 14.6, DECK_SOFFIT = 3.3;

// ------------------------------------------------------------ street field --
const E_RANGE = 16;                 // signed metres stored around each street
const enc = (d) => Math.max(0, Math.min(255, Math.round((d + E_RANGE) * (255 / (2 * E_RANGE)))));
const NO_SQUARE = 4095, MAJOR = 4096;

export class StreetField {
  /** N texels over [-half, half]² (local coordinates); frame = also keep the paving frame. */
  constructor(N = 4096, half = INNER.half, { frame = true } = {}) {
    this.N = N;
    this.half = half;
    this.cell = (2 * this.half) / N;
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { data[i * 4] = 255; data[i * 4 + 1] = 255; }
    this.data = data;
    this.bestC = new Float32Array(N * N).fill(1e9);   // |centre distance| of the street owning G
    // street frame at half resolution, full float precision: R = metres along the owning
    // street (arc length), G = signed metres across it (from its centreline), B = metres along
    // it to the nearest junction's edge (negative inside the junction), A = the square whose
    // edge is nearest (an index into the extra top row, which holds each square's x, z, r and
    // kind) + 4096 where that junction takes a crossing. The terrain lays its paving courses,
    // kerbs, crossings and squares in this frame.
    this.AN = N >> 1;
    this.acell = (2 * this.half) / this.AN;
    const AN = this.AN;
    this.frameData = frame ? new Float32Array(AN * (AN + 1) * 4) : null;
    if (frame) for (let k = 0; k < AN * AN; k++) this.frameData[k * 4 + 2] = 1e4;
    this.bestA = frame ? new Float32Array(AN * AN).fill(1e9) : null;
    this.fMajor = frame ? new Uint8Array(AN * AN) : null;
    this.fSquare = null;
  }

  _range(x0, z0, x1, z1) {
    const { half, cell, N } = this;
    return [
      Math.max(0, Math.floor((x0 + half) / cell - 0.5)), Math.min(N - 1, Math.ceil((x1 + half) / cell - 0.5)),
      Math.max(0, Math.floor((z0 + half) / cell - 0.5)), Math.min(N - 1, Math.ceil((z1 + half) / cell - 0.5)),
    ];
  }

  segment(ax, az, bx, bz, hw, s0 = 0, st = null) {
    if (this.frameData) this._frameSegment(ax, az, bx, bz, hw, s0, st);
    const { half, cell, N, data, bestC } = this;
    const pad = hw + E_RANGE;
    const [i0, i1, j0, j1] = this._range(Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad);
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz || 1e-9;
    const L = Math.sqrt(L2);
    for (let j = j0; j <= j1; j++) {
      const pz = -half + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const px = -half + (i + 0.5) * cell;
        let t = ((px - ax) * dx + (pz - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + dx * t - px, qz = az + dz * t - pz;
        const d = Math.sqrt(qx * qx + qz * qz);
        const k = j * N + i;
        const e = enc(d - hw);
        if (e < data[k * 4]) data[k * 4] = e;
        if (d < bestC[k]) {
          bestC[k] = d;
          const side = ((px - ax) * dz - (pz - az) * dx) / L;   // signed distance to the infinite line
          data[k * 4 + 1] = enc(Math.max(-E_RANGE, Math.min(E_RANGE, t > 0 && t < 1 ? side : Math.sign(side || 1) * d)));
        }
      }
    }
  }

  /** A street's centreline; st (optional) = the street, whose junctions the frame records. */
  polyline(pts, hw, st = null) {
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      this.segment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hw, s, st);
      s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
  }

  _frameSegment(ax, az, bx, bz, hw, s0, st) {
    const { half, acell, AN, frameData, bestA, fMajor } = this;
    const pad = hw + 8;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad + half) / acell - 0.5)), i1 = Math.min(AN - 1, Math.ceil((Math.max(ax, bx) + pad + half) / acell - 0.5));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - pad + half) / acell - 0.5)), j1 = Math.min(AN - 1, Math.ceil((Math.max(az, bz) + pad + half) / acell - 0.5));
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz || 1e-9;
    const L = Math.sqrt(L2);
    const junc = st && st.junc && st.junc.length ? st.junc : null;
    for (let j = j0; j <= j1; j++) {
      const pz = -half + (j + 0.5) * acell;
      for (let i = i0; i <= i1; i++) {
        const px = -half + (i + 0.5) * acell;
        const tr = ((px - ax) * dx + (pz - az) * dz) / L2;
        const t = tr < 0 ? 0 : tr > 1 ? 1 : tr;
        const qx = ax + dx * t - px, qz = az + dz * t - pz;
        const d = Math.sqrt(qx * qx + qz * qz);
        const k = j * AN + i;
        if (d < bestA[k]) {
          bestA[k] = d;
          // unclamped along/across stay linear past the segment ends, so the frame
          // continues smoothly round bends and interpolates exactly
          const al = s0 + tr * L;
          frameData[k * 4] = al;
          frameData[k * 4 + 1] = ((px - ax) * dz - (pz - az) * dx) / L;
          // metres along the street to the edge of the nearest junction (linear too)
          let jd = 1e4, maj = 0;
          if (junc) for (const J of junc) {
            let u = Math.abs(al - J.s);
            if (st.loop) u = Math.min(u, Math.abs(st.len - u));
            if (u - J.hw < jd) { jd = u - J.hw; maj = J.major ? 1 : 0; }
          }
          frameData[k * 4 + 2] = jd;
          fMajor[k] = maj;
        }
      }
    }
  }

  square(x, z, r) {
    const { half, cell, N, data } = this;
    const [i0, i1, j0, j1] = this._range(x - r - 3, z - r - 3, x + r + 3, z + r + 3);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(-half + (i + 0.5) * cell - x, -half + (j + 0.5) * cell - z);
      const v = Math.round(255 * smoothstep(r + 1.8, r - 1.8, d));
      const k = (j * N + i) * 4 + 2;
      if (v > data[k]) data[k] = v;
    }
  }

  /** The squares, exactly, for the terrain's paving: every frame texel keeps the square whose
   *  edge is nearest (within 14 m); the extra top row holds each square's x, z, r and kind. */
  frameSquares(squares) {
    if (!this.frameData) return;
    const { half, acell, AN, frameData } = this;
    const best = new Float32Array(AN * AN).fill(1e9);
    const idx = this.fSquare = new Int16Array(AN * AN).fill(-1);
    const n = Math.min(squares.length, AN, NO_SQUARE - 1);
    for (let q = 0; q < n; q++) {
      const s = squares[q];
      const R = s.r + 14;
      const i0 = Math.max(0, Math.floor((s.x - R + half) / acell - 0.5)), i1 = Math.min(AN - 1, Math.ceil((s.x + R + half) / acell - 0.5));
      const j0 = Math.max(0, Math.floor((s.z - R + half) / acell - 0.5)), j1 = Math.min(AN - 1, Math.ceil((s.z + R + half) / acell - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(-half + (i + 0.5) * acell - s.x, -half + (j + 0.5) * acell - s.z) - s.r;
        const k = j * AN + i;
        if (d < 14 && d < best[k]) { best[k] = d; idx[k] = q; }
      }
      const k = AN * AN + q;
      frameData[k * 4] = s.x; frameData[k * 4 + 1] = s.z; frameData[k * 4 + 2] = s.r; frameData[k * 4 + 3] = SQUARE_KIND[s.kind] || 0;
    }
  }

  lamp(x, z, strength = 1) {
    const { half, cell, N, data } = this;
    const R = 16;
    const [i0, i1, j0, j1] = this._range(x - R, z - R, x + R, z + R);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = -half + (i + 0.5) * cell - x, dz = -half + (j + 0.5) * cell - z;
      const v = 235 * strength * Math.exp(-(dx * dx + dz * dz) / (2 * 5.2 * 5.2));
      const k = (j * N + i) * 4 + 3;
      data[k] = Math.min(255, data[k] + Math.round(v));
    }
  }

  _bilinear(x, z, c) {
    const { half, cell, N, data } = this;
    const fx = (x + half) / cell - 0.5, fz = (z + half) / cell - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return c < 2 ? 255 : 0;
    const tx = fx - i, tz = fz - j;
    const k = (j * N + i) * 4 + c;
    const a = data[k], b = data[k + 4], d = data[k + N * 4], e = data[k + N * 4 + 4];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (d * (1 - tx) + e * tx) * tz;
  }

  /** Signed distance (m) to the nearest kerb: negative on the carriageway. */
  edge(x, z) { return this._bilinear(x, z, 0) * (2 * E_RANGE / 255) - E_RANGE; }
  /** Signed distance to the nearest street centreline. */
  centre(x, z) { return this._bilinear(x, z, 1) * (2 * E_RANGE / 255) - E_RANGE; }
  /** 0..1 inside paved squares. */
  squareAt(x, z) { return this._bilinear(x, z, 2) / 255; }

  /** Street frame texture (RGBA32F, nearest: the shader filters it itself, at full precision).
   *  AN x (AN + 1): the top row holds the squares. */
  frameTexture() {
    const { AN, frameData, fMajor, fSquare } = this;
    for (let k = 0; k < AN * AN; k++) frameData[k * 4 + 3] = (fSquare && fSquare[k] >= 0 ? fSquare[k] : NO_SQUARE) + (fMajor[k] ? MAJOR : 0);
    // the ground shader reads along / across only: upload those two (RG32F, AN x AN) and keep
    // the junction and square channels on the CPU side, so the frame costs no more GPU memory
    const rg = new Float32Array(AN * AN * 2);
    for (let k = 0; k < AN * AN; k++) { rg[k * 2] = frameData[k * 4]; rg[k * 2 + 1] = frameData[k * 4 + 1]; }
    const t = new THREE.DataTexture(rg, AN, AN, THREE.RGFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    this.bestA = null; this.fMajor = null; this.fSquare = null;
    return t;
  }

  texture() {
    const t = new THREE.DataTexture(this.data, this.N, this.N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }
}

// --------------------------------------------------------------- headroom --
/**
 * What already stands on the ground, as a sparse metre grid of headroom: the metres of clear
 * air between the ground and the lowest structure over each cell (tower bases, promenade and
 * bridge decks and their maglev tubes where they come down, station plinths, the rim
 * bridgeheads). Negative = solid down into the ground; cells nothing stands over are open sky.
 */
class Headroom {
  constructor(ground) { this.ground = ground; this.tiles = new Map(); }

  _tile(i, j, make) {
    const k = ((i >> 6) + 1024) * 4096 + ((j >> 6) + 1024);
    let t = this.tiles.get(k);
    if (!t && make) { t = new Float32Array(4096).fill(Infinity); this.tiles.set(k, t); }
    return t;
  }

  put(i, j, h) {
    const t = this._tile(i, j, true), k = ((j & 63) << 6) | (i & 63);
    if (h < t[k]) t[k] = h;
  }

  at(i, j) { const t = this._tile(i, j, false); return t ? t[((j & 63) << 6) | (i & 63)] : Infinity; }

  /** Lowest headroom over the disc (x, z, r). */
  min(x, z, r) {
    const i0 = Math.floor(x - r), i1 = Math.floor(x + r), j0 = Math.floor(z - r), j1 = Math.floor(z + r);
    let any = false;
    for (let tj = j0 >> 6; tj <= j1 >> 6 && !any; tj++) for (let ti = i0 >> 6; ti <= i1 >> 6; ti++) if (this._tile(ti << 6, tj << 6, false)) { any = true; break; }
    if (!any) return Infinity;
    const rr = (r + 0.71) * (r + 0.71);
    let m = Infinity;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const h = this.at(i, j);
      if (h < m && (i + 0.5 - x) * (i + 0.5 - x) + (j + 0.5 - z) * (j + 0.5 - z) <= rr) m = h;
    }
    return m;
  }

  /** Lowest headroom over a convex polygon [[x, z], ...] grown by pad. */
  minPoly(P, pad = 0) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (!Number.isFinite(this.min((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + pad))) return Infinity;
    let m = Infinity;
    for (let j = Math.floor(z0 - pad); j <= Math.floor(z1 + pad); j++) for (let i = Math.floor(x0 - pad); i <= Math.floor(x1 + pad); i++) {
      const h = this.at(i, j);
      if (h < m && polyDist(P, i + 0.5, j + 0.5) <= pad + 0.71) m = h;
    }
    return m;
  }

  /** Rasterize a triangle (world xyz): its lowest point over every cell it covers. */
  _tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const y = Math.min(ay, by, cy);
    const x0 = Math.floor(Math.min(ax, bx, cx) - 0.5), x1 = Math.floor(Math.max(ax, bx, cx) + 0.5);
    const z0 = Math.floor(Math.min(az, bz, cz) - 0.5), z1 = Math.floor(Math.max(az, bz, cz) + 0.5);
    const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    const s = area < 0 ? -1 : 1;
    const e = [[ax, az, bx, bz], [bx, bz, cx, cz], [cx, cz, ax, az]].map(([x1, z1, x2, z2]) => {
      const l = Math.hypot(x2 - x1, z2 - z1) || 1e-9;
      return [x1, z1, (x2 - x1) / l, (z2 - z1) / l];
    });
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      const px = i + 0.5, pz = j + 0.5;
      let inside = true;
      // within half a cell of the triangle (slivers and edge-on walls still register)
      for (const [x1, z1, ux, uz] of e) if (s * (ux * (pz - z1) - uz * (px - x1)) < -0.72) { inside = false; break; }
      if (inside) this.put(i, j, y - this.ground(px, pz));
    }
  }

  /** A tower's base: every triangle within reach of the ground. */
  addTower(t) {
    const m = t.mesh, g = m && m.geometry;
    if (!g || !g.attributes.position) return;
    if (Math.abs(t.def.x) > INNER.half || Math.abs(t.def.z) > INNER.half) return;
    m.updateMatrixWorld(true);
    const p = g.attributes.position.array, idx = g.index ? g.index.array : null, e = m.matrixWorld.elements;
    const n = idx ? idx.length : p.length / 3;
    const g0 = this.ground(t.def.x, t.def.z);
    const top = Math.max(g0, t.baseY) + 12, bottom = Math.min(g0, t.baseY + 2) - 4;
    const w = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k + 2 < n; k += 3) {
      let lo = Infinity, hi = -Infinity;
      for (let c = 0; c < 3; c++) {
        const v = (idx ? idx[k + c] : k + c) * 3, x = p[v], y = p[v + 1], z = p[v + 2];
        const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
        w[c * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; w[c * 3 + 1] = wy; w[c * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        lo = Math.min(lo, wy); hi = Math.max(hi, wy);
      }
      if (lo > top || hi < bottom) continue;
      this._tri(...w);
    }
  }

  /** Everything within r of the segment a-b, at height y (world). */
  _band(ax, az, bx, bz, r, y) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    for (let j = Math.floor(Math.min(az, bz) - r); j <= Math.floor(Math.max(az, bz) + r); j++) {
      for (let i = Math.floor(Math.min(ax, bx) - r); i <= Math.floor(Math.max(ax, bx) + r); i++) {
        const px = i + 0.5, pz = j + 0.5;
        let t = ((px - ax) * dx + (pz - az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(ax + dx * t - px, az + dz * t - pz) <= r + 0.71) this.put(i, j, y - this.ground(px, pz));
      }
    }
  }

  /** A deck (promenade or bridge path, Vector3[]) where it comes within 10 m of the ground; the
   *  lagoon promenades also carry their maglev tube 17-30 m off the axis and a gateway at each end. */
  addDeck(P) {
    const N = P.length - 1;
    if (N < 2) return;
    const low = (x, z, y) => y - Math.max(this.ground(x, z), 0) < 10;
    for (let i = 0; i < N; i++) {
      const a = P[i], b = P[i + 1];
      const y = Math.min(a.y, b.y) - DECK_SOFFIT;
      if (low(a.x, a.z, y) || low(b.x, b.z, y)) this._band(a.x, a.z, b.x, b.z, DECK_HW, y);
    }
    if (Math.hypot(P[0].x, P[0].z) > PLAZA_R + 30) return;
    // infrastructure.js buildPromenades(): tube = path + side * (17 + 13 * ends) + 2.5 m up, radius 3
    const ss = (a, b, x) => smoothstep(a, b, x);
    const tube = P.map((p, i) => {
      const q0 = P[Math.max(i - 1, 0)], q1 = P[Math.min(i + 1, N)];
      const tx = q1.x - q0.x, tz = q1.z - q0.z, tl = Math.hypot(tx, tz) || 1;
      const t = i / N, lat = 17 + 13 * (ss(0.1, 0.0, t) + ss(0.9, 1.0, t));
      return { x: p.x - (tz / tl) * lat, y: p.y + 2.5, z: p.z + (tx / tl) * lat };
    });
    for (let i = 0; i < N; i++) {
      const a = tube[i], b = tube[i + 1], y = Math.min(a.y, b.y) - 3.2;
      if (low(a.x, a.z, y) || low(b.x, b.z, y)) this._band(a.x, a.z, b.x, b.z, 3.4, y);
    }
    // the gateways' pylons (15.8 m either side of the deck, near each end)
    for (const k of [3, N - 1]) {
      const q0 = P[k - 1], q1 = P[k + 1], tx = q1.x - q0.x, tz = q1.z - q0.z, tl = Math.hypot(tx, tz) || 1;
      for (const s of [-1, 1]) {
        const x = P[k].x - (tz / tl) * 15.8 * s, z = P[k].z + (tx / tl) * 15.8 * s;
        this._band(x, z, x, z, 2.4, this.ground(x, z) - 2);
      }
    }
  }

  /** A maglev terminal's plinth (a superellipse 2 x 39 m along the line, 2 x 17 m across, on the
   *  promenade end it serves), or a rim bridgehead's podium. */
  addStation(st, paths) {
    if (st.end === 'rim') { this._band(st.x, st.z, st.x, st.z, Math.max(10, st.r - 6), -2 + this.ground(st.x, st.z) - 2); return; }
    let ux = 1, uz = 0, bd = 1e9;
    for (const P of paths) for (const k of [0, P.length - 1]) {
      const d = Math.hypot(P[k].x - st.x, P[k].z - st.z);
      if (d < bd && d < 180) {
        bd = d;
        const a = P[Math.max(k - 2, 0)], b = P[Math.min(k + 2, P.length - 1)];
        ux = b.x - a.x; uz = b.z - a.z;
        const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
      }
    }
    const A = 39 + 0.8, B = 17 + 0.8;
    for (let j = Math.floor(st.z - A); j <= Math.floor(st.z + A); j++) for (let i = Math.floor(st.x - A); i <= Math.floor(st.x + A); i++) {
      const dx = i + 0.5 - st.x, dz = j + 0.5 - st.z;
      const u = (dx * ux + dz * uz) / A, v = (dz * ux - dx * uz) / B;
      if (u * u * u * u + v * v * v * v <= 1) this.put(i, j, -2);
    }
  }

  /** Split a street's centreline where a structure stands in its way (less than 2.6 m of
   *  headroom over the carriageway): the pieces left, each of at least four points. */
  clipStreet(pts, hw) {
    const blocked = pts.map(() => false);
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      if (this.min(x, z, hw + 1.0) < 2.6) blocked[i] = true;
      if (i > 0) {
        const [px, pz] = pts[i - 1], L = Math.hypot(x - px, z - pz), n = Math.ceil(L / 2.5);
        for (let q = 1; q < n; q++) if (this.min(px + ((x - px) * q) / n, pz + ((z - pz) * q) / n, hw + 1.0) < 2.6) { blocked[i] = blocked[i - 1] = true; break; }
      }
    }
    const out = [];
    let cur = [];
    for (let i = 0; i < pts.length; i++) {
      if (blocked[i]) { if (cur.length > 3) out.push(cur); cur = []; } else cur.push(pts[i]);
    }
    if (cur.length > 3) out.push(cur);
    return out;
  }
}

/** Distance from (x, z) to a convex polygon [[x, z], ...] (0 inside). */
function polyDist(P, x, z) {
  let inside = true, d = Infinity;
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length];
    const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1e-12;
    if (ex * (z - az) - ez * (x - ax) < 0) inside = false;
    let t = ((x - ax) * ex + (z - az) * ez) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    d = Math.min(d, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  // counter-clockwise polygons test inside with the cross product above; accept either winding
  if (!inside) {
    inside = true;
    for (let i = 0; i < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length];
      if ((bx - ax) * (z - az) - (bz - az) * (x - ax) > 0) { inside = false; break; }
    }
  }
  return inside ? 0 : d;
}

// ------------------------------------------------------------ kerb index --
/** Exact distances to the streets' kerbs (a grid of their centreline segments). */
class KerbIndex {
  constructor(streets) {
    this.G = 32;
    this.cells = new Map();
    for (const st of streets) {
      const P = st.pts;
      for (let i = 1; i < P.length; i++) {
        const s = { ax: P[i - 1][0], az: P[i - 1][1], bx: P[i][0], bz: P[i][1], hw: st.hw, cls: st.cls };
        const r = st.hw + 1;
        for (let gj = Math.floor((Math.min(s.az, s.bz) - r) / this.G); gj <= Math.floor((Math.max(s.az, s.bz) + r) / this.G); gj++) {
          for (let gi = Math.floor((Math.min(s.ax, s.bx) - r) / this.G); gi <= Math.floor((Math.max(s.ax, s.bx) + r) / this.G); gi++) {
            const k = gi * 100003 + gj;
            if (!this.cells.has(k)) this.cells.set(k, []);
            this.cells.get(k).push(s);
          }
        }
      }
    }
  }

  _near(x0, z0, x1, z1) {
    const out = new Set();
    for (let gj = Math.floor(z0 / this.G); gj <= Math.floor(z1 / this.G); gj++) for (let gi = Math.floor(x0 / this.G); gi <= Math.floor(x1 / this.G); gi++) {
      const l = this.cells.get(gi * 100003 + gj);
      if (l) for (const s of l) out.add(s);
    }
    return out;
  }

  /** Signed metres from (x, z) to the nearest kerb within reach (negative on a carriageway),
   *  and that street's class. */
  at(x, z, reach = 12) {
    let best = reach, cls = 0;
    for (const s of this._near(x - reach - 9, z - reach - 9, x + reach + 9, z + reach + 9)) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1e-12;
      let t = ((x - s.ax) * dx + (z - s.az) * dz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(s.ax + dx * t - x, s.az + dz * t - z) - s.hw;
      if (d < best) { best = d; cls = s.cls; }
    }
    return [best, cls];
  }

  /** Metres from a convex polygon to the nearest kerb within reach (negative = overlapping a
   *  carriageway), and that street's class. */
  poly(P, reach = 12) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    let best = reach, cls = 0;
    for (const s of this._near(x0 - reach - 9, z0 - reach - 9, x1 + reach + 9, z1 + reach + 9)) {
      const d = segPolyDist(s.ax, s.az, s.bx, s.bz, P) - s.hw;
      if (d < best) { best = d; cls = s.cls; }
    }
    return [best, cls];
  }
}

function segSegDist(ax, az, bx, bz, cx, cz, dx, dz) {
  const cr = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = cr(cx, cz, dx, dz, ax, az), d2 = cr(cx, cz, dx, dz, bx, bz), d3 = cr(ax, az, bx, bz, cx, cz), d4 = cr(ax, az, bx, bz, dx, dz);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  const ps = (px, pz, qx, qz, rx, rz) => {
    const ex = rx - qx, ez = rz - qz, L2 = ex * ex + ez * ez || 1e-12;
    let t = ((px - qx) * ex + (pz - qz) * ez) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(qx + ex * t - px, qz + ez * t - pz);
  };
  return Math.min(ps(ax, az, cx, cz, dx, dz), ps(bx, bz, cx, cz, dx, dz), ps(cx, cz, ax, az, bx, bz), ps(dx, dz, ax, az, bx, bz));
}

function segPolyDist(ax, az, bx, bz, P) {
  if (polyDist(P, ax, az) === 0 || polyDist(P, bx, bz) === 0) return 0;
  let d = Infinity;
  for (let i = 0; i < P.length; i++) {
    const [cx, cz] = P[i], [dx, dz] = P[(i + 1) % P.length];
    d = Math.min(d, segSegDist(ax, az, bx, bz, cx, cz, dx, dz));
  }
  return d;
}

// ------------------------------------------------------------ junctions --
/**
 * Where the streets meet: every junction along every street, st.junc = [{ s, hw, major }]
 * sorted by s (metres along st; hw = the other street's half-width; major = it is at least as
 * wide as st, so st takes a crossing there). Crossings, end-on meetings (a lane ending on a
 * ring, a radial starting from one) and streets ending on others all count; the continuation
 * of a street cut in two does not. Also st.len, st.loop (a closed ring).
 */
function findJunctions(streets) {
  const G = 48;
  const grid = new Map();
  const segs = [];
  streets.forEach((st, si) => {
    const P = st.pts;
    let s = 0;
    st.junc = [];
    for (let i = 1; i < P.length; i++) {
      const L = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      segs.push({ si, ax: P[i - 1][0], az: P[i - 1][1], bx: P[i][0], bz: P[i][1], s0: s, L });
      s += L;
    }
    st.len = s;
    st.loop = P.length > 8 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1;
  });
  for (const g of segs) {
    for (let gj = Math.floor((Math.min(g.az, g.bz) - 12) / G); gj <= Math.floor((Math.max(g.az, g.bz) + 12) / G); gj++) {
      for (let gi = Math.floor((Math.min(g.ax, g.bx) - 12) / G); gi <= Math.floor((Math.max(g.ax, g.bx) + 12) / G); gi++) {
        const k = gi * 100003 + gj;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(g);
      }
    }
  }
  const near = (x, z, r) => {
    const out = new Set();
    for (let gj = Math.floor((z - r) / G); gj <= Math.floor((z + r) / G); gj++) for (let gi = Math.floor((x - r) / G); gi <= Math.floor((x + r) / G); gi++) {
      const l = grid.get(gi * 100003 + gj);
      if (l) for (const s of l) out.add(s);
    }
    return out;
  };
  const addJ = (si, s, other) => {
    const st = streets[si];
    st.junc.push({ s: Math.max(0, Math.min(st.len, s)), hw: other.hw, major: other.hw >= st.hw - 0.1 });
  };
  const dir = (st, end) => {
    const P = st.pts, n = P.length;
    const [a, b] = end ? [P[n - 2], P[n - 1]] : [P[1], P[0]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  // crossings
  for (const A of segs) {
    for (const B of near((A.ax + A.bx) / 2, (A.az + A.bz) / 2, A.L / 2 + 2)) {
      if (B.si === A.si) continue;
      const rx = A.bx - A.ax, rz = A.bz - A.az, sx = B.bx - B.ax, sz = B.bz - B.az;
      const den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const qx = B.ax - A.ax, qz = B.az - A.az;
      const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) addJ(A.si, A.s0 + t * A.L, streets[B.si]);
    }
  }
  // end-on: a street ending on (or just short of) another's centreline
  streets.forEach((T, ti) => {
    if (T.loop) return;
    for (const end of [0, 1]) {
      const [ex, ez] = T.pts[end ? T.pts.length - 1 : 0];
      const [tx, tz] = dir(T, end);
      for (const B of near(ex, ez, 14)) {
        if (B.si === ti) continue;
        const S = streets[B.si];
        const dx = B.bx - B.ax, dz = B.bz - B.az, L2 = dx * dx + dz * dz || 1e-12;
        let t = ((ex - B.ax) * dx + (ez - B.az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(B.ax + dx * t - ex, B.az + dz * t - ez);
        if (d > S.hw + 2) continue;
        // a street cut in two (by the ground or a structure) continues itself: not a junction
        const sl = Math.hypot(dx, dz) || 1;
        if (S.cls === T.cls && Math.abs((tx * dx + tz * dz) / sl) > 0.9) continue;
        addJ(B.si, B.s0 + t * B.L, T);
        addJ(ti, end ? T.len : 0, S);
      }
    }
  });
  for (const st of streets) {
    st.junc.sort((a, b) => a.s - b.s);
    const m = [];
    for (const J of st.junc) {
      const l = m[m.length - 1];
      if (l && J.s - l.s < 3) { if (J.hw > l.hw) { l.hw = J.hw; } l.major = l.major || J.major; } else m.push({ ...J });
    }
    st.junc = m;
  }
}

// ------------------------------------------------------------------ plan --
function ringPts(cx, cz, r, seed, a0 = 0, a1 = TAU, step = 7, wob = 0.03) {
  const pts = [];
  const n = Math.max(8, Math.ceil(((a1 - a0) * r) / step));
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    const rr = r * (1 + wob * nW(Math.cos(a) * 1.4 + seed, Math.sin(a) * 1.4 - seed));
    pts.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
  }
  return pts;
}
function radialPts(cx, cz, a, r0, r1, seed, step = 7, bend = 0.025) {
  const pts = [];
  const n = Math.max(2, Math.ceil((r1 - r0) / step));
  for (let k = 0; k <= n; k++) {
    const r = r0 + ((r1 - r0) * k) / n;
    const aa = a + bend * nW(r * 0.004 + seed, seed * 1.7) * (k > 0 && k < n ? 1 : 0.6);
    pts.push([cx + Math.cos(aa) * r, cz + Math.sin(aa) * r]);
  }
  return pts;
}

/** Split a polyline wherever the ground is not buildable. */
function clipByGround(pts, ground, minH = 1.6, maxH = 60) {
  const out = [];
  let cur = [];
  for (const p of pts) {
    const h = ground(p[0], p[1]);
    if (h >= minH && h <= maxH) cur.push(p);
    else { if (cur.length > 3) out.push(cur); cur = []; }
  }
  if (cur.length > 3) out.push(cur);
  return out;
}

/** A stable seed for a street (its ends and class), whatever else the plan holds. */
function streetSeed(st) {
  const P = st.pts, a = P[0], b = P[P.length - 1];
  let h = 2166136261;
  for (const v of [Math.round(a[0] * 4), Math.round(a[1] * 4), Math.round(b[0] * 4), Math.round(b[1] * 4), st.cls]) {
    h = Math.imul(h ^ (v & 0xffff), 16777619);
    h = Math.imul(h ^ ((v >>> 16) & 0xffff), 16777619);
  }
  return h >>> 0;
}

function polyLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }

/** How far a rim arcology's forecourt terrace reaches beyond its town core (towerBase). */
export const RIM_TERRACE = 17;

/** The arcologies on the atoll rim: each stands on a forecourt terrace (rimForecourts.js). */
export function rimArcologies(towers) {
  return towers.filter((t) => { const r0 = Math.hypot(t.def.x, t.def.z); return r0 >= 4700 && r0 <= 7000 && !t.def.ward; });
}

/** A tower's town core: the widest reach of its geometry near the base (as planCity excludes it). */
export function towerBase(t) {
  return Math.max(towerFootprint(t, 100), t.collide ? t.collide(0) : (t.def.radius || 60) * 1.4);
}

// Rim streets stop at the rim arcologies' terraces and at the raised bridgeheads of the ward
// bridges instead of running on under them: a street of half-width hw is cut back to r + hw
// from a tower stop (its paving ends a metre outside the terrace) and to hw + 0.5 m outside a
// bridgehead podium. The cut ends all lie inside the tower squares and the stations'
// exclusions, where no lot stands, so the lots laid along the whole streets are unchanged.
// Returns the kept pieces, or null when nothing is cut.
function clipAtStops(pts, hw, stops) {
  const inside = (x, z) => stops.some((q) => {
    if (q.r !== undefined) return Math.hypot(x - q.x, z - q.z) < q.r + hw;
    const dx = x - q.x, dz = z - q.z;
    return Math.abs(dx * q.u[0] + dz * q.u[1]) < q.hw + hw + 0.5 && Math.abs(dx * q.side[0] + dz * q.side[1]) < q.hd + hw + 0.5;
  });
  const bad = pts.map((p) => inside(p[0], p[1]));
  if (!bad.some(Boolean)) return null;
  // the exact crossing on a segment from an outside point a to an inside point b
  const edge = (a, b) => {
    let lo = 0, hi = 1;
    for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (inside(a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m)) hi = m; else lo = m; }
    return [a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo];
  };
  const out = [];
  let cur = [];
  for (let i = 0; i < pts.length; i++) {
    if (!bad[i]) {
      if (!cur.length && i > 0) cur.push(edge(pts[i], pts[i - 1]));
      cur.push(pts[i]);
    } else if (cur.length) {
      cur.push(edge(pts[i - 1], pts[i]));
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out.filter((seg) => seg.length >= 2 && polyLength(seg) > 8);
}

/** Oriented rectangle overlap (separating axes), with a gap. */
export function obbOverlap(a, b, gap) {
  const axes = [[Math.cos(a.rot), -Math.sin(a.rot)], [Math.sin(a.rot), Math.cos(a.rot)], [Math.cos(b.rot), -Math.sin(b.rot)], [Math.sin(b.rot), Math.cos(b.rot)]];
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [ax, az] of axes) {
    const proj = (o) => {
      const ux = Math.cos(o.rot), uz = -Math.sin(o.rot), vx = Math.sin(o.rot), vz = Math.cos(o.rot);
      return Math.abs((ux * ax + uz * az) * o.w * 0.5) + Math.abs((vx * ax + vz * az) * o.d * 0.5);
    };
    if (Math.abs(dx * ax + dz * az) > proj(a) + proj(b) + gap) return false;
  }
  return true;
}

/** Widest horizontal reach of a built tower's geometry within `band` metres of its base. */
export function towerFootprint(t, band) {
  const m = t.mesh, g = m && m.geometry;
  if (!g || !g.attributes.position) return 0;
  m.updateMatrixWorld(true);
  const p = g.attributes.position, v = new THREE.Vector3();
  let r = 0;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
    if (v.y - t.baseY > band) continue;
    r = Math.max(r, Math.hypot(v.x - t.def.x, v.z - t.def.z));
  }
  return r;
}

/** A lot's footprint rectangle in world xz: half sizes hu (across the frontage) and hv (toward
 *  the street), shifted oz toward the street. Local +z points at the street. */
function lotRect(L, hu, hv, oz = 0) {
  const c = Math.cos(L.rot), s = Math.sin(L.rot);
  return [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]].map(([lx, lz]) => { lz += oz; return [L.x + lx * c + lz * s, L.z - lx * s + lz * c]; });
}
// what buildings.js puts on a lot: a podium 0.6 m proud of it, and (near) a paved apron
// L.w - 2 wide from its front to 3.2 m ahead of it
const podiumOf = (L) => lotRect(L, L.w / 2 + 0.6, L.d / 2 + 0.6);
const apronOf = (L) => lotRect(L, (L.w - 2) / 2, 1.3, L.d / 2 + 1.9);

/**
 * An islet's land: the coastline warp moves each islet's dome off its nominal centre (by up to
 * 260 m), so its village is laid out on the land itself. Returns the centroid of the connected
 * land nearest the nominal centre and the radius of a disc of the same area.
 */
function isletLand(isl, ground) {
  const S = 8, R = isl.r * 2.3, n = Math.ceil((2 * R) / S);
  const land = new Uint8Array(n * n), comp = new Int32Array(n * n).fill(-1);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) land[j * n + i] = ground(isl.x - R + (i + 0.5) * S, isl.z - R + (j + 0.5) * S) > 1.6 ? 1 : 0;
  let best = null;
  for (let k0 = 0; k0 < n * n; k0++) {
    if (!land[k0] || comp[k0] >= 0) continue;
    const stack = [k0];
    comp[k0] = k0;
    let a = 0, sx = 0, sz = 0, near = 0;
    while (stack.length) {
      const k = stack.pop(), i = k % n, j = (k / n) | 0;
      const x = isl.x - R + (i + 0.5) * S, z = isl.z - R + (j + 0.5) * S;
      a++; sx += x; sz += z;
      if (Math.hypot(x - isl.x, z - isl.z) < isl.r * 1.6) near++;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const q = jj * n + ii;
        if (land[q] && comp[q] < 0) { comp[q] = k0; stack.push(q); }
      }
    }
    if (!best || near > best.near) best = { near, a, x: sx / a, z: sz / a };
  }
  if (!best || best.near < 20) return null;
  return { x: best.x, z: best.z, r: Math.sqrt((best.a * S * S) / Math.PI) };
}

/** The largest disc (at least minR) inside the circle (cx, cz, r) that nothing stands in. */
function freeDisc(cx, cz, r, room, minR) {
  if (room.min(cx, cz, r + 1) >= 8) return { x: cx, z: cz, r };
  const S = 2, n = Math.ceil((2 * r + 8) / S), x0 = cx - r - 4, z0 = cz - r - 4;
  const sites = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * S, z = z0 + (j + 0.5) * S;
    sites[j * n + i] = room.min(x, z, 1.2) < 8 ? 1 : 0;
  }
  const d2 = edt2d(sites, n);
  let best = null;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * S, z = z0 + (j + 0.5) * S;
    const dc = Math.hypot(x - cx, z - cz);
    const m = Math.min(r - dc, Math.sqrt(d2[j * n + i]) * S - 3);
    if (m >= minR && (!best || m > best.r + 0.5 || (m > best.r - 0.5 && dc < best.dc))) best = { x, z, r: m, dc };
  }
  return best ? { x: best.x, z: best.z, r: Math.floor(best.r) } : null;
}

/**
 * Build the plan. ground(x,z) = raw terrain height, towers = built arcologies,
 * promenades = deck polylines (Vector3[]), urbanMask(x,z,h) for the rim towns,
 * stations = maglev terminals ({x, z, r, end}) and rim bridgeheads (end 'rim').
 */
export function planCity({ ground, towers, promenades, urbanMask, stations = [] }) {
  const rnd = mulberry32(8080);
  const streets = [];
  const extra = [];           // further pieces of streets cut by a structure, appended last
  const squares = [];
  const exclusions = [];      // circles nothing may be built in
  const districts = [];
  const decks = promenades || [];
  // what already stands on the ground
  const room = new Headroom(ground);
  for (const t of towers) room.addTower(t);
  for (const P of decks) room.addDeck(P);
  for (const st of stations) room.addStation(st, decks);
  const add = (pts, cls, d, name) => {
    for (const seg of clipByGround(pts, ground)) {
      room.clipStreet(seg, HALF_W[cls]).forEach((piece, k) => (k ? extra : streets).push({ pts: piece, cls, hw: HALF_W[cls], district: d.id, name }));
    }
  };

  for (const t of towers) {
    // the tower's real footprint where town buildings stand: the widest horizontal reach
    // of its geometry up to 100 m above its base (lean, flare, podium, plates, lattice).
    // collide() is only the camera-collision core and let low-rises grow into the towers
    const base = Math.max(towerFootprint(t, 100), t.collide ? t.collide(0) : (t.def.radius || 60) * 1.4);
    // an arcology on the rim stands in a forecourt (rimForecourts.js): colonnade at base + 7,
    // obelisks to base + 21 and a fountain to base + 30 on the lagoon side; its square takes them in
    const r0 = Math.hypot(t.def.x, t.def.z);
    const court = r0 > 4700 && r0 < 7000 && !t.def.ward;
    exclusions.push({ x: t.def.x, z: t.def.z, r: base + (court ? 32 : 12) });
    squares.push({ x: t.def.x, z: t.def.z, r: base + (court ? 33 : 18), kind: 'tower', base, court });
  }
  for (const sx of [-1, 1]) exclusions.push({ x: GATE.x + sx * GATE.span / 2, z: GATE.z, r: 130 });
  // maglev terminals: nothing built on them; the island ones stand in a paved forecourt
  // that rings their plinth (39 m from the centre at its ends)
  for (const st of stations) {
    exclusions.push({ x: st.x, z: st.z, r: st.r + 4 });
    if (st.end === 'island') squares.push({ x: st.x, z: st.z, r: st.r + 5, kind: 'station' });
  }

  // ---- the central ring town between the plaza terraces and the shore
  {
    const d = { id: 'central', x: 0, z: 0, R: 880, tall: 0.5, kind: 'central' };
    districts.push(d);
    add(ringPts(0, 0, 632, 1.1, 0, TAU, 7, 0.0), ST.ESPLANADE, d, 'Meridian Circle');
    add(ringPts(0, 0, 752, 2.3, 0, TAU, 7, 0.012), ST.STREET, d, 'Second Circle');
    add(ringPts(0, 0, 858, 3.7, 0, TAU, 7, 0.015), ST.ESPLANADE, d, 'Harbour Walk');
    const promA = ISLANDS.map((isl) => Math.atan2(isl.z, isl.x)).sort((a, b) => a - b);
    for (let k = 0; k < promA.length; k++) {
      const a = promA[k], b = promA[(k + 1) % promA.length] + (k === promA.length - 1 ? TAU : 0);
      add(radialPts(0, 0, a, 604, 905, 5 + k, 7, 0), ST.AVENUE, d);
      add(radialPts(0, 0, (a + b) / 2, 632, 900, 9 + k, 7, 0.01), ST.STREET, d);
    }
  }

  // ---- the eight island towns
  for (const isl of ISLANDS) {
    const ax = promenadeAxis(isl);
    const d = { id: isl.id, x: isl.x, z: isl.z, R: isl.r, tall: 1, kind: 'island', landing: ax.landing, mainAngle: ax.angleOnIsland };
    districts.push(d);
    const seed = isl.x * 0.001 + isl.z * 0.0007;
    const rings = [0.2, 0.4, 0.58, 0.8].map((f) => f * isl.r);
    const cls = [ST.STREET, ST.STREET, ST.AVENUE, ST.ESPLANADE];
    rings.forEach((r, i) => add(ringPts(isl.x, isl.z, r, seed + i * 3.1, 0, TAU, 7, i === 0 ? 0.0 : 0.03), cls[i], d));
    // the civic square inside the first ring; where an arcology's base takes the heart of the
    // island, the square is the largest open disc left beside it
    const r0 = rings[0] - HALF_W[ST.STREET] - 1;
    const civ = freeDisc(isl.x, isl.z, r0, room, 24) || { x: isl.x, z: isl.z, r: r0 };
    squares.push({ x: civ.x, z: civ.z, r: civ.r, kind: 'civic', district: d.id });
    // radials, the first one pointing home to the Axis
    const n = Math.max(6, Math.min(10, Math.round((TAU * 0.5 * isl.r) / 150)));
    const angles = [];
    for (let k = 0; k < n; k++) angles.push(ax.angleOnIsland + (k / n) * TAU + (k ? (rnd() - 0.5) * 0.16 : 0));
    angles.forEach((a, k) => add(radialPts(isl.x, isl.z, a, rings[0], isl.r * 0.92, seed + k * 1.9, 7, k ? 0.03 : 0), k ? ST.STREET : ST.AVENUE, d));
    // pedestrian lanes through the long outer blocks
    for (let i = 1; i < rings.length - 1; i++) {
      const rm = (rings[i] + rings[i + 1]) / 2;
      for (let k = 0; k < n; k++) {
        const a0 = angles[k], a1 = angles[(k + 1) % n] + (k === n - 1 ? TAU : 0);
        const arc = (a1 - a0) * rm;
        const m = Math.floor(arc / 125);
        for (let q = 1; q <= m; q++) {
          const a = a0 + ((a1 - a0) * q) / (m + 1);
          add(radialPts(isl.x, isl.z, a, rings[i], rings[i + 1], seed + k * 7 + q, 6, 0.02), ST.LANE, d);
        }
      }
    }
    // the landing square on the main avenue, just ahead of where the promenade's deck comes
    // down (and clear of the terminal beside it)
    squares.push({ ...landingSquare(ax, room), kind: 'landing', district: d.id });
  }

  // ---- islet villages (on the islet's land, which the coastline warp moves off its nominal centre)
  for (const [k, isl] of ISLETS.entries()) {
    if (isl.r <= 150) continue;
    const a0 = rnd() * TAU;
    const L = isletLand(isl, ground);
    if (!L || L.r < 60) continue;
    const d = { id: `islet${k}`, x: L.x, z: L.z, R: L.r, tall: 0.35, kind: 'islet' };
    districts.push(d);
    add(ringPts(L.x, L.z, L.r * 0.45, k * 2.7, 0, TAU, 6, 0.05), ST.STREET, d);
    for (let q = 0; q < 4; q++) add(radialPts(L.x, L.z, a0 + (q / 4) * TAU, L.r * 0.12, L.r * 0.88, k + q, 6, 0.05), ST.LANE, d);
    squares.push({ x: L.x, z: L.z, r: L.r * 0.45 - HALF_W[ST.STREET] - 1.5, kind: 'village', district: d.id });
  }

  // ---- the rim: Rim Way all the way round each run of land, ten planned towns strung along it,
  // the strand and the sea walks, the country's lanes, parcels and squares (rim/rimPlan.js lays
  // them out in the rim's own frame; they are clipped here like every other street)
  {
    const d = { id: 'rim', x: 0, z: 0, R: 6200, tall: 0.3, kind: 'rim' };
    districts.push(d);
    const rimTowers = rimArcologies(towers).map((t) => ({ x: t.def.x, z: t.def.z, base: towerBase(t) }));
    const rimHeads = stations.filter((st) => st.head).map((st) => st.head);
    const gateFeet = [-1, 1].map((sx) => ({ x: GATE.x + (sx * GATE.span) / 2, z: GATE.z, r: 130 }));
    d.rim = planRim({ ground, towers: rimTowers, heads: rimHeads, gateFeet });
    for (const s of d.rim.streets) {
      for (const seg of clipByGround(s.pts, ground)) room.clipStreet(seg, s.hw).forEach((piece, k) => (k ? extra : streets).push({ ...s, pts: piece, district: d.id }));
    }
    for (const q of d.rim.squares) squares.push(q);
    // the rim's streets end at the arcologies' terraces and at the bridgeheads (clipAtStops):
    // lots are still laid along the whole streets, the field, lamps and plan get the kept ends
    const rimT = rimArcologies(towers);
    const stops = rimT.map((t) => ({ x: t.def.x, z: t.def.z, r: towerBase(t) + RIM_TERRACE + 1 }));
    for (const q of squares) if (q.kind === 'tower' && rimT.some((t) => t.def.x === q.x && t.def.z === q.z)) q.rimCourt = true;
    for (const st of stations) if (st.head) stops.push(st.head);
    for (const st of streets) {
      if (st.district !== d.id) continue;
      const keep = clipAtStops(st.pts, st.hw, stops);
      if (keep) st.keep = keep;
    }
  }
  streets.push(...extra);

  // ---- squares stand on dry land, clear of every structure (a station's square rings its
  // plinth, a tower's its base: those keep their size and are only paved on dry ground)
  for (let i = squares.length - 1; i >= 0; i--) {
    const q = squares[i];
    if (q.kind === 'tower' || q.kind === 'station') continue;
    const dry = (r) => {
      if (ground(q.x, q.z) < 1.6) return false;
      for (let a = 0; a < 48; a++) for (const f of [1, 0.66, 0.33]) if (ground(q.x + Math.cos((a / 48) * TAU) * r * f, q.z + Math.sin((a / 48) * TAU) * r * f) < 1.6) return false;
      return true;
    };
    while (q.r >= 14 && !dry(q.r)) q.r -= 2;
    if (q.r < 14) squares.splice(i, 1);
  }

  // ---- bake the streets and squares
  findJunctions(streets);
  const field = new StreetField(4096);
  // clipped rim streets (rimForecourts terraces, bridgeheads) bake their kept pieces; their junction
  // records are keyed to the unclipped arc length, so the pieces go without them
  for (const s of streets) {
    if (s.keep) for (const seg of s.keep) field.polyline(seg, s.hw);
    else field.polyline(s.pts, s.hw, s);
  }
  for (const q of squares) field.square(q.x, q.z, q.r);
  field.frameSquares(squares);
  const kerbs = new KerbIndex(streets);
  const inSquare = (x, z, pad = 0) => squares.some((q) => Math.abs(q.x - x) < q.r + pad && Math.hypot(q.x - x, q.z - z) < q.r + pad);
  const rectSquareClear = (P, pad) => squares.every((q) => polyDist(P, q.x, q.z) >= q.r + pad);

  // ---- lots along the frontages
  const lots = [];
  const G = 64;
  const grid = new Map();
  const gkey = (x, z) => `${Math.floor(x / G)},${Math.floor(z / G)}`;
  const promPts = [];
  for (const path of decks) for (let k = 0; k < path.length; k += 2) promPts.push(path[k]);
  const promClear = (x, z, r) => { for (const p of promPts) if (Math.abs(p.x - x) < r + 24 && Math.hypot(p.x - x, p.z - z) < r + 22) return false; return true; };
  const districtOf = new Map(districts.map((d) => [d.id, d]));
  const lotOk = (L) => {
    const c = Math.cos(L.rot), s = Math.sin(L.rot);
    let lo = 1e9, hi = -1e9;
    // footprint samples: corners, edge midpoints, centre
    for (let iu = -1; iu <= 1; iu += 0.5) for (let iv = -1; iv <= 1; iv += 0.5) {
      const lx = iu * L.w * 0.5, lz = iv * L.d * 0.5;
      const x = L.x + lx * c + lz * s, z = L.z - lx * s + lz * c;
      const h = ground(x, z);
      if (h < 2.0) return false;
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      if (field.edge(x, z) < SETBACK - 0.6) return false;
      if (field.squareAt(x, z) > 0.02) return false;
    }
    if (hi - lo > 10) return false;
    const rad = Math.hypot(L.w, L.d) * 0.5;
    for (const e of exclusions) if (Math.hypot(e.x - L.x, e.z - L.z) < e.r + rad) return false;
    if (!promClear(L.x, L.z, rad)) return false;
    // exactly: the lot clear of every carriageway, its podium and apron of every kerb (and of
    // the hedges on the streets that have them), all of it clear of the squares and of anything
    // standing on the ground
    const pod = podiumOf(L), apr = apronOf(L);
    if (kerbs.poly(lotRect(L, L.w / 2, L.d / 2))[0] < SETBACK - 0.7) return false;
    const [ka, kc] = kerbs.poly(apr);
    if (ka < (kc === ST.LANE ? 0.25 : 1.05)) return false;
    if (!rectSquareClear(pod, 1) || !rectSquareClear(apr, 1)) return false;
    if (room.minPoly(pod, 1) < 45 || room.minPoly(apr, 1) < 45) return false;
    const gx = Math.floor(L.x / G), gz = Math.floor(L.z / G);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(`${gx + dx},${gz + dz}`);
      if (list) for (const o of list) if (Math.hypot(o.x - L.x, o.z - L.z) < rad + Math.hypot(o.w, o.d) * 0.5 + 3 && obbOverlap(o, L, 3.2)) return false;
    }
    L.lo = lo; L.hi = hi;
    return true;
  };
  const order = [ST.AVENUE, ST.ESPLANADE, ST.STREET, ST.LANE];
  for (const cls of order) {
    for (const st of streets) {
      if (st.cls !== cls || st.noLots) continue;
      const d = districtOf.get(st.district);
      const P = st.pts;
      // each street draws its lots from its own stream, so a change to one frontage leaves
      // every other town as it was
      const rnd = mulberry32(streetSeed(st));
      // cumulative length
      const cum = [0];
      for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      const total = cum[cum.length - 1];
      const at = (s) => {
        let i = 1;
        while (i < P.length - 1 && cum[i] < s) i++;
        const t = (s - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-6);
        const x = P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, z = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t;
        const tx = P[i][0] - P[i - 1][0], tz = P[i][1] - P[i - 1][1];
        const tl = Math.hypot(tx, tz) || 1;
        return { x, z, tx: tx / tl, tz: tz / tl };
      };
      for (const side of st.lotSides || [-1, 1]) {
        let s = 6 + rnd() * 8;
        while (s < total - 8) {
          const small = st.lotSize ? st.lotSize === 'small' : d.kind === 'rim' || d.kind === 'islet' || cls === ST.LANE;
          let w = small ? 11 + rnd() * 14 : 16 + rnd() * 22;
          let dep = small ? 12 + rnd() * 9 : 18 + rnd() * 16;
          let placed = false;
          for (let tryW = 0; tryW < 3 && !placed; tryW++) {
            const p = at(s + w / 2);
            // outward normal on this side; the building faces back toward the street
            const nx = -p.tz * side, nz = p.tx * side;
            const off = st.hw + SB[cls] + dep / 2;
            const L = { x: p.x + nx * off, z: p.z + nz * off, w, d: dep, rot: Math.atan2(-nx, -nz), cls, district: d.id, dk: d.kind, street: st };
            // local +z of the lot points at the street: rot is the yaw of that direction
            if (lotOk(L)) {
              const park = nPark(L.x * 0.0035, L.z * 0.0035);
              if (park > 0.55 && d.kind !== 'central') { placed = true; break; }   // leave a park here
              L.seed = rnd() * 1000;
              const dc = Math.hypot(L.x - d.x, L.z - d.z) / Math.max(d.R, 1);
              L.centre = d.kind === 'rim' ? 0.2 : Math.max(0, 1 - dc);
              lots.push(L);
              const k = gkey(L.x, L.z);
              if (!grid.has(k)) grid.set(k, []);
              grid.get(k).push(L);
              placed = true;
            } else { w *= 0.72; dep *= 0.9; if (w < 9) break; }
          }
          s += w + 3.5 + rnd() * 4;
        }
      }
    }
  }

  // the clipped rim streets take their kept pieces from here on (extra pieces go to the end)
  for (let i = streets.length - 1; i >= 0; i--) {
    const st = streets[i];
    if (!st.keep) continue;
    const [first, ...rest] = st.keep;
    delete st.keep;
    for (const seg of rest) streets.push({ ...st, pts: seg, junc: null });
    if (first) { st.pts = first; st.junc = null; } else streets.splice(i, 1);
  }

  // ---- street lamps in the verges (behind the hedge), squares ringed with lamps
  const lamps = [];
  const LG = 24, lampGrid = new Map();
  const nearLamp = (x, z, r) => {
    for (let gj = Math.floor((z - r) / LG); gj <= Math.floor((z + r) / LG); gj++) for (let gi = Math.floor((x - r) / LG); gi <= Math.floor((x + r) / LG); gi++) {
      const l = lampGrid.get(gi * 100003 + gj);
      if (l) for (const o of l) if (Math.hypot(o.x - x, o.z - z) < r) return true;
    }
    return false;
  };
  const pushLamp = (l) => {
    lamps.push(l);
    const k = Math.floor(l.x / LG) * 100003 + Math.floor(l.z / LG);
    if (!lampGrid.has(k)) lampGrid.set(k, []);
    lampGrid.get(k).push(l);
  };
  const inLot = (x, z, pad) => {
    const gx = Math.floor(x / G), gz = Math.floor(z / G);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(`${gx + dx},${gz + dz}`);
      if (list) for (const L of list) if (Math.hypot(L.x - x, L.z - z) < Math.hypot(L.w, L.d) * 0.5 + 4.5 && (polyDist(podiumOf(L), x, z) < pad || polyDist(apronOf(L), x, z) < pad)) return true;
    }
    return false;
  };
  // on dry ground, in the clear (headroom for its 5.8 m), off every carriageway and kerb, out
  // of the hedges, the lots and the other lamps
  const lampClear = (x, z, minKerb) => {
    if (ground(x, z) < 1.6) return false;
    const [e, cls] = kerbs.at(x, z);
    if (e < minKerb) return false;
    if (cls !== ST.LANE && cls !== 0 && e < 0.93 + LAMP_R + 0.1) return false;
    if (exclusions.some((q) => Math.hypot(q.x - x, q.z - z) < q.r - 6)) return false;
    if (room.min(x, z, LAMP_R + 0.4) < LAMP_TOP) return false;
    if (inLot(x, z, LAMP_R + 0.4)) return false;
    return !nearLamp(x, z, 3);
  };
  for (const st of streets) {
    const P = st.pts;
    const spacing = st.lampSpacing || (st.cls === ST.AVENUE ? 24 : st.cls === ST.ESPLANADE ? 20 : st.cls === ST.STREET ? 27 : 30);
    const bothSides = st.lampBoth ?? (st.cls === ST.AVENUE || st.cls === ST.ESPLANADE);
    const eL = LAMP_E[st.cls];
    let acc = 0, k = 0;
    for (let i = 1; i < P.length; i++) {
      const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1];
      const L = Math.hypot(dx, dz);
      acc += L;
      while (acc >= spacing) {
        acc -= spacing;
        const nx = -dz / L, nz = dx / L;
        for (const side of bothSides ? [-1, 1] : [(k & 1) ? 1 : -1]) {
          // lanes have no verge to speak of: their lamps find the gaps between the lots
          for (const slide of st.cls === ST.LANE ? [0, 2.5, -2.5, 5, -5, 7.5, -7.5] : [0]) {
            const t = 1 - (acc + slide) / L;
            if (t < 0 || t > 1) continue;
            const x = P[i - 1][0] + dx * t + nx * (st.hw + eL) * side, z = P[i - 1][1] + dz * t + nz * (st.hw + eL) * side;
            if (inSquare(x, z, 1) || !lampClear(x, z, eL - 0.3)) continue;
            pushLamp({ x, z, yaw: Math.atan2(-nx * side, -nz * side), cls: st.cls });
            break;
          }
        }
        k++;
      }
    }
  }
  for (const q of squares) {
    if (q.rimCourt) continue;            // the rim terraces light themselves (rimForecourts.js)
    // round the square just inside its edge (round a tower, 16 m out from its base)
    const rl = q.kind === 'tower' ? Math.min(q.r - 2.5, (q.base || 0) + 16) : q.r - 2.5;
    const n = Math.max(6, Math.floor((TAU * rl) / 22));
    // the rim forecourt's fountain (lagoon side) and obelisks (cross axes) stand in the ring
    const toL = Math.atan2(-q.z, -q.x), R = (q.base || 0) + 7;
    const court = q.court ? [[toL, R + 16, 7], [toL + Math.PI / 2, R + 12, 2.2], [toL - Math.PI / 2, R + 12, 2.2]].map(([a, r, rr]) => [q.x + Math.cos(a) * r, q.z + Math.sin(a) * r, rr]) : [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const x = q.x + Math.cos(a) * rl, z = q.z + Math.sin(a) * rl;
      if (court.some(([cx, cz, rr]) => Math.hypot(cx - x, cz - z) < rr + 1.5)) continue;
      if (lampClear(x, z, 0.6)) pushLamp({ x, z, yaw: a + Math.PI, cls: 0 });
    }
  }
  for (const l of lamps) field.lamp(l.x, l.z, l.cls === ST.LANE ? 0.75 : 1);

  return { streets, squares, lots, lamps, districts, exclusions, field, walkDist: (x, z) => field.edge(x, z) + 2.6 };
}

/** The landing square: on the main avenue just ahead of the deck's foot (the deck comes down
 *  onto the avenue), shifted off the axis if the terminal beside it is in the way. */
function landingSquare(ax, room) {
  const dx = ax.dir.x, dz = ax.dir.z, px = -dz, pz = dx;
  for (const r of [30, 26, 22, 18]) {
    for (let a = r + 3; a <= r + 40; a += 3) {
      for (const l of [0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15, 18, -18, 21, -21, 24, -24, 27, -27]) {
        const x = ax.landing.x + dx * a + px * l, z = ax.landing.z + dz * a + pz * l;
        if (room.min(x, z, r + 2) >= 4) return { x, z, r };
      }
    }
  }
  return { x: ax.landing.x, z: ax.landing.z, r: 18 };
}
