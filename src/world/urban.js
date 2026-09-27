import * as THREE from 'three';
import { CENTRAL_ISLAND, ISLANDS, PLAZA_R, GATE, promenadeAxis } from './layout.js';
import { ISLETS, INNER } from './terrain.js';
import { mulberry32, createNoise2D, smoothstep } from './noise.js';

// The town plan of MERIDIAN.
//
// Every island is laid out the same way a real planned town would be: a civic square at
// its heart, concentric ring streets, radial streets (the main one points back at the
// Axis and carries the promenade landing), and pedestrian lanes cutting the long blocks.
// Buildings are placed on lots that front those streets, set back behind a verge, with
// garden courtyards left inside each block. Streets, squares and street lamps are baked
// into one texture (the "street field") that the terrain, the tree planner and the
// ground lighting all read, so everything agrees on where the walks are.

const TAU = Math.PI * 2;
const nW = createNoise2D(919);
const nPark = createNoise2D(313);

export const ST = { LANE: 1, STREET: 2, AVENUE: 3, ESPLANADE: 4 };
export const HALF_W = [0, 3.0, 5.0, 9.0, 6.5];
// building line behind the kerb, by street class (lanes are tight; streets leave room
// for a planted verge with street trees; avenues plant their median instead)
export const SB = [0, 3.5, 7.0, 6.0, 7.0];
export const SETBACK = 4.0;

// ------------------------------------------------------------ street field --
const E_RANGE = 16;                 // signed metres stored around each street
const enc = (d) => Math.max(0, Math.min(255, Math.round((d + E_RANGE) * (255 / (2 * E_RANGE)))));

export class StreetField {
  constructor(N = 4096) {
    this.N = N;
    this.half = INNER.half;
    this.cell = (2 * this.half) / N;
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { data[i * 4] = 255; data[i * 4 + 1] = 255; }
    this.data = data;
    this.bestC = new Float32Array(N * N).fill(1e9);   // |centre distance| of the street owning G
    // street frame at half resolution, full float precision: R = metres along the owning
    // street (arc length), G = signed metres across it (from its centreline). The terrain
    // lays its paving courses, kerb joints and lawn stripes in this frame.
    this.AN = N >> 1;
    this.acell = (2 * this.half) / this.AN;
    this.frameData = new Float32Array(this.AN * this.AN * 2);
    this.bestA = new Float32Array(this.AN * this.AN).fill(1e9);
  }

  _range(x0, z0, x1, z1) {
    const { half, cell, N } = this;
    return [
      Math.max(0, Math.floor((x0 + half) / cell - 0.5)), Math.min(N - 1, Math.ceil((x1 + half) / cell - 0.5)),
      Math.max(0, Math.floor((z0 + half) / cell - 0.5)), Math.min(N - 1, Math.ceil((z1 + half) / cell - 0.5)),
    ];
  }

  segment(ax, az, bx, bz, hw, s0 = 0) {
    this._frameSegment(ax, az, bx, bz, hw, s0);
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

  polyline(pts, hw) {
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      this.segment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hw, s);
      s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
  }

  _frameSegment(ax, az, bx, bz, hw, s0) {
    const { half, acell, AN, frameData, bestA } = this;
    const pad = hw + 8;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad + half) / acell - 0.5)), i1 = Math.min(AN - 1, Math.ceil((Math.max(ax, bx) + pad + half) / acell - 0.5));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - pad + half) / acell - 0.5)), j1 = Math.min(AN - 1, Math.ceil((Math.max(az, bz) + pad + half) / acell - 0.5));
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz || 1e-9;
    const L = Math.sqrt(L2);
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
          frameData[k * 2] = s0 + tr * L;
          frameData[k * 2 + 1] = ((px - ax) * dz - (pz - az) * dx) / L;
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

  /** Street frame texture (RG32F, nearest: the shader filters it itself, at full precision). */
  frameTexture() {
    const t = new THREE.DataTexture(this.frameData, this.AN, this.AN, THREE.RGFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    this.bestA = null;
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

function polyLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }

/** Oriented rectangle overlap (separating axes), with a gap. */
function obbOverlap(a, b, gap) {
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
function towerFootprint(t, band) {
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

/**
 * Build the plan. ground(x,z) = raw terrain height, towers = built arcologies,
 * promenades = deck polylines (Vector3[]), urbanMask(x,z,h) for the rim towns.
 */
export function planCity({ ground, towers, promenades, urbanMask, stations = [] }) {
  const rnd = mulberry32(8080);
  const streets = [];
  const squares = [];
  const exclusions = [];      // circles nothing may be built in
  const districts = [];
  const add = (pts, cls, d, name) => { for (const seg of clipByGround(pts, ground)) streets.push({ pts: seg, cls, hw: HALF_W[cls], district: d.id, name }); };

  for (const t of towers) {
    // the tower's real footprint where town buildings stand: the widest horizontal reach
    // of its geometry up to 100 m above its base (lean, flare, podium, plates, lattice).
    // collide() is only the camera-collision core and let low-rises grow into the towers
    const base = Math.max(towerFootprint(t, 100), t.collide ? t.collide(0) : (t.def.radius || 60) * 1.4);
    exclusions.push({ x: t.def.x, z: t.def.z, r: base + 12 });
    squares.push({ x: t.def.x, z: t.def.z, r: base + 18, kind: 'tower' });
  }
  for (const sx of [-1, 1]) exclusions.push({ x: GATE.x + sx * GATE.span / 2, z: GATE.z, r: 130 });
  // maglev terminals: nothing built on them; the island ones stand in a paved forecourt
  for (const st of stations) {
    exclusions.push({ x: st.x, z: st.z, r: st.r + 4 });
    if (st.end === 'island') squares.push({ x: st.x, z: st.z, r: st.r, kind: 'station' });
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
    squares.push({ x: isl.x, z: isl.z, r: rings[0] - HALF_W[ST.STREET] - 1, kind: 'civic', district: d.id });
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
    squares.push({ x: ax.landing.x, z: ax.landing.z, r: 30, kind: 'landing', district: d.id });
  }

  // ---- islet villages
  for (const [k, isl] of ISLETS.entries()) {
    if (isl.r <= 150) continue;
    const d = { id: `islet${k}`, x: isl.x, z: isl.z, R: isl.r, tall: 0.35, kind: 'islet' };
    districts.push(d);
    add(ringPts(isl.x, isl.z, isl.r * 0.45, k * 2.7, 0, TAU, 6, 0.05), ST.STREET, d);
    const a0 = rnd() * TAU;
    for (let q = 0; q < 4; q++) add(radialPts(isl.x, isl.z, a0 + (q / 4) * TAU, isl.r * 0.12, isl.r * 0.88, k + q, 6, 0.05), ST.LANE, d);
    squares.push({ x: isl.x, z: isl.z, r: isl.r * 0.45 - HALF_W[ST.STREET] - 1.5, kind: 'village', district: d.id });
  }

  // ---- the rim: Rim Way all the way round, towns strung along it
  {
    const d = { id: 'rim', x: 0, z: 0, R: 6200, tall: 0.3, kind: 'rim' };
    districts.push(d);
    add(ringPts(0, 0, 5870, 7.7, 0, TAU, 8, 0.012), ST.AVENUE, d, 'Rim Way');
    const town = (a) => {
      const x = Math.cos(a) * 5900, z = Math.sin(a) * 5900;
      return urbanMask(x, z, Math.max(ground(x, z), 2)) > 0.45;
    };
    // runs of angles inside towns
    const runs = [];
    let cur = null;
    const steps = 1600;
    for (let s = 0; s <= steps; s++) {
      const a = (s / steps) * TAU;
      if (town(a)) { if (!cur) cur = [a, a]; else cur[1] = a; } else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    for (const [a0, a1] of runs) {
      if ((a1 - a0) * 5900 < 180) continue;
      add(ringPts(0, 0, 5710, 8.1, a0, a1, 7, 0.01), ST.ESPLANADE, d);
      add(ringPts(0, 0, 6040, 8.9, a0, a1, 7, 0.01), ST.STREET, d);
      const m = Math.floor(((a1 - a0) * 5900) / 115);
      for (let q = 1; q < m; q++) {
        const a = a0 + ((a1 - a0) * q) / m;
        add(radialPts(0, 0, a, 5710, 6040, q * 3.3 + a0, 6, 0.002), ST.LANE, d);
      }
      const am = (a0 + a1) / 2;
      squares.push({ x: Math.cos(am) * 5955, z: Math.sin(am) * 5955, r: 24, kind: 'village', district: d.id });
    }
  }

  // ---- bake the streets and squares
  const field = new StreetField(4096);
  for (const s of streets) field.polyline(s.pts, s.hw);
  for (const q of squares) field.square(q.x, q.z, q.r);

  // ---- lots along the frontages
  const lots = [];
  const G = 64;
  const grid = new Map();
  const gkey = (x, z) => `${Math.floor(x / G)},${Math.floor(z / G)}`;
  const promPts = [];
  for (const path of promenades || []) for (let k = 0; k < path.length; k += 2) promPts.push(path[k]);
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
      if (st.cls !== cls) continue;
      const d = districtOf.get(st.district);
      const P = st.pts;
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
      for (const side of [-1, 1]) {
        let s = 6 + rnd() * 8;
        while (s < total - 8) {
          const small = d.kind === 'rim' || d.kind === 'islet' || cls === ST.LANE;
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

  // ---- street lamps on the verges, squares ringed with lamps
  const lamps = [];
  const lampOk = (x, z) => field.edge(x, z) > 0.3 && field.squareAt(x, z) < 0.05 && !exclusions.some((e) => Math.hypot(e.x - x, e.z - z) < e.r - 6) && ground(x, z) > 1.2;
  for (const st of streets) {
    const P = st.pts;
    const spacing = st.cls === ST.AVENUE ? 24 : st.cls === ST.ESPLANADE ? 20 : st.cls === ST.STREET ? 27 : 30;
    const bothSides = st.cls === ST.AVENUE || st.cls === ST.ESPLANADE;
    let acc = 0, k = 0;
    for (let i = 1; i < P.length; i++) {
      const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1];
      const L = Math.hypot(dx, dz);
      acc += L;
      while (acc >= spacing) {
        acc -= spacing;
        const t = 1 - acc / L;
        const x = P[i - 1][0] + dx * t, z = P[i - 1][1] + dz * t;
        const nx = -dz / L, nz = dx / L;
        for (const side of bothSides ? [-1, 1] : [(k & 1) ? 1 : -1]) {
          const off = st.hw + 0.9;
          const lx = x + nx * off * side, lz = z + nz * off * side;
          if (lampOk(lx, lz)) lamps.push({ x: lx, z: lz, yaw: Math.atan2(-nx * side, -nz * side), cls: st.cls });
        }
        k++;
      }
    }
  }
  for (const q of squares) {
    const n = Math.max(6, Math.floor((TAU * q.r) / 22));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const x = q.x + Math.cos(a) * (q.r - 2), z = q.z + Math.sin(a) * (q.r - 2);
      if (ground(x, z) > 1.2 && !exclusions.some((e) => Math.hypot(e.x - x, e.z - z) < e.r - 8)) lamps.push({ x, z, yaw: a + Math.PI, cls: 0 });
    }
  }
  for (const l of lamps) field.lamp(l.x, l.z, l.cls === ST.LANE ? 0.75 : 1);

  return { streets, squares, lots, lamps, districts, exclusions, field, walkDist: (x, z) => field.edge(x, z) + 2.6 };
}
