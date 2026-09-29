import * as THREE from 'three';
import { TOWNS, MARIA, CRATERS } from './moonBake.js';

// The Moon's settled geography beyond Medii Landing's own bay: the far-side and polar towns
// the second wave of settlement put where the near side has none, the road and rail network
// that ties every town together, and a CPU copy of the bake's sea mask (moonBake.js) so that
// nothing built on the ground stands in the water.
//
// The network is drawn by the surface shader (moonSurface.js) as lit lines on the night side
// (sodium highways, the cool white of the rail corridors with their trains running, villages
// strung along them) and as pale graded lines by day. It is data only: great-circle arcs
// between town directions, chosen by a spanning tree over the towns plus the near side's
// denser links and the trunk rail lines out of Medii.

const D2R = Math.PI / 180;

/**
 * Far-side and polar settlements: [lat, lon, weight, name]. Each stands clear of the seas
 * (seaClearance below, asserted by tools/verify-moon-w2.mjs) and gets its own outpost.
 */
export const FAR_TOWNS = [
  [88.4, 33, 0.5, 'Peary Rim'],             // north pole: the eternal-light rim over the ice
  [-89.2, -4, 0.55, 'Shackleton Crown'],   // south pole: on the rim of the dark crater, above the ice fields
  [85.6, -95, 0.35, 'Hermite Station'],
  [-6.0, 178.83, 0.45, 'Daedalus'],          // the far-side observatory town, shielded from the Earth's noise
  [-20.4, 136.4, 0.5, 'Tsiolkovskiy Shore'],
  [21.0, 150.0, 0.45, 'Moscoviense Gate'],
  [-26.58, -151.05, 0.4, 'Apollo Downs'],
  [-8.0, -104.0, 0.4, 'Orientale Rook'],
  [3.0, -128.0, 0.35, 'Hertzsprung'],
  [47.78, 119.63, 0.35, 'Campbell'],
];
export const ALL_TOWNS = TOWNS.concat(FAR_TOWNS.map(([la, lo, w]) => [la, lo, w]));

/** Moon-frame unit vector of [lat, lon] (degrees). */
export function latLonDir(lat, lon, out = new THREE.Vector3()) {
  const a = lat * D2R, o = lon * D2R;
  return out.set(Math.cos(a) * Math.cos(o), Math.sin(a), -Math.cos(a) * Math.sin(o));
}
const ang = (a, b) => Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));

// ------------------------------------------------------------------------- sea mask --
// The bake (moonBake.js BAKE_FRAG) makes water where a mare basin's blend exceeds 0.4 below
// the datum, in the named crater lakes, and in a few of the random highland craters. The
// maria are warped by up to ~0.03 rad of noise; the clearance allows for it.

const fr = Math.fround;
const fract = (x) => fr(x - Math.floor(x));
/** hash33 of src/shaders/noise.glsl.js, in float32 like the GPU. */
function hash33(x, y, z) {
  let a = fract(fr(x * fr(0.1031))), b = fract(fr(y * fr(0.103))), c = fract(fr(z * fr(0.0973)));
  const d = fr(fr(a * fr(b + 33.33)) + fr(fr(b * fr(a + 33.33)) + fr(c * fr(c + 33.33))));
  a = fr(a + d); b = fr(b + d); c = fr(c + d);
  return [fract(fr(fr(a + b) * c)), fract(fr(fr(a + a) * b)), fract(fr(fr(b + a) * a))];
}

// simplex noise 3D (the Ashima / Gustavson snoise of glsl.js), in doubles
const m289 = (x) => x - Math.floor(x / 289) * 289;
const perm = (x) => m289((x * 34 + 10) * x);
const _X = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
export function snoise(vx, vy, vz) {
  const s = (vx + vy + vz) / 3;
  const ix = Math.floor(vx + s), iy = Math.floor(vy + s), iz = Math.floor(vz + s);
  const t = (ix + iy + iz) / 6;
  const x0 = vx - ix + t, y0 = vy - iy + t, z0 = vz - iz + t;
  const gx = y0 <= x0 ? 1 : 0, gy = z0 <= y0 ? 1 : 0, gz = x0 <= z0 ? 1 : 0;
  const i1 = [Math.min(gx, 1 - gz), Math.min(gy, 1 - gx), Math.min(gz, 1 - gy)];
  const i2 = [Math.max(gx, 1 - gz), Math.max(gy, 1 - gx), Math.max(gz, 1 - gy)];
  const X = _X;
  X[0][0] = x0; X[0][1] = y0; X[0][2] = z0;
  for (let k = 0; k < 3; k++) { X[1][k] = X[0][k] - i1[k] + 1 / 6; X[2][k] = X[0][k] - i2[k] + 1 / 3; X[3][k] = X[0][k] - 0.5; }
  const jx = m289(ix), jy = m289(iy), jz = m289(iz);
  const OX = [0, i1[0], i2[0], 1], OY = [0, i1[1], i2[1], 1], OZ = [0, i1[2], i2[2], 1];
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const P = perm(perm(perm(jz + OZ[k]) + jy + OY[k]) + jx + OX[k]);
    const j = P - 49 * Math.floor(P * (1 / 49));
    const xx = Math.floor(j / 7), yy = Math.floor(j - 7 * xx);
    const a = xx * (2 / 7) + (0.5 / 7 - 1), b = yy * (2 / 7) + (0.5 / 7 - 1);
    const h = 1 - Math.abs(a) - Math.abs(b);
    const sh = h <= 0 ? -1 : 0;
    const qx = a + (Math.floor(a) * 2 + 1) * sh, qy = b + (Math.floor(b) * 2 + 1) * sh;
    const nrm = 1.79284291400159 - 0.85373472095314 * (qx * qx + qy * qy + h * h);
    const x = X[k];
    const m = Math.max(0.6 - (x[0] * x[0] + x[1] * x[1] + x[2] * x[2]), 0);
    sum += m * m * m * m * nrm * (qx * x[0] + qy * x[1] + h * x[2]);
  }
  return 42 * sum;
}

const MARIA_D = MARIA.map((m) => ({ c: latLonDir(m[0], m[1]), r: m[2] * D2R }));
const LAKES = CRATERS.filter((c) => c[5] > 0.5 && c[2] > 0).map((c) => ({ c: latLonDir(c[0], c[1]), r: (c[2] / 2) / 1737 }));
const E40 = 0.0501;                      // a basin's blend reaches 0.4 (water possible) at d = 1.0501 r
const _w = new THREE.Vector3();

/** The bake's warped direction for the maria (pw in BAKE_FRAG). */
export function mariaWarp(p, out = _w) {
  const qx = p.x * 3.1, qy = p.y * 3.1, qz = p.z * 3.1;
  return out.set(p.x + 0.03 * snoise(qx + 5, qy + 5, qz + 5), p.y + 0.03 * snoise(qx + 11, qy + 11, qz + 11), p.z + 0.03 * snoise(qx + 23, qy + 23, qz + 23)).normalize();
}

/**
 * Clearance (km) from a direction to the nearest place the bake can make water: where a mare
 * basin's blend passes 0.4 (the shore itself lies beyond, where the drowned land meets the
 * datum), the named crater lakes, the Bay of the Middle, and the random crater lakes of the
 * highlands. Negative: water is possible there.
 */
export function seaClearance(p) {
  let best = Infinity;
  const pw = mariaWarp(p);
  // (the warp's gradient stretches distances by up to ~1.25)
  for (const m of MARIA_D) best = Math.min(best, (ang(pw, m.c) - (1 + E40) * m.r) * 1737 / 1.25);
  for (const l of LAKES) best = Math.min(best, (ang(p, l.c) - 1.0 * l.r) * 1737);
  // the Bay of the Middle (site ortho coordinates; its blend starts 16 km outside the shore)
  if (p.x > 0.5) {
    const BO = (136 + 3.1) / Math.SQRT2;
    best = Math.min(best, Math.hypot(p.z * 1737 + BO, p.y * 1737 - BO) - 136 - 16);
  }
  // random highland crater lakes (octaves 0..3 of the bake's population)
  for (let o = 0; o < 4; o++) {
    const sc = 6 * 2 ** o, dens = 0.3 + 0.05 * o;
    const qx = p.x * sc, qy = p.y * sc, qz = p.z * sc;
    const bx = Math.floor(qx), by = Math.floor(qy), bz = Math.floor(qz);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const cx = bx + i, cy = by + j, cz = bz + k;
      const hh = hash33(cx + o * 17.13, cy + o * 17.13, cz + o * 17.13);
      if (hh[0] > dens) continue;
      const h2 = hash33(cx * 1.37 + o * 5.1 + 3.3, cy * 1.37 + o * 5.1 + 3.3, cz * 1.37 + o * 5.1 + 3.3);
      if (h2[0] <= 0.9 || hh[2] <= 0.25) continue;   // (the bake: > 0.92 and age > 0.3; a margin for float drift)
      const cen = new THREE.Vector3(cx + 0.15 + 0.7 * h2[0], cy + 0.15 + 0.7 * h2[1], cz + 0.15 + 0.7 * h2[2]).normalize();
      const R = (0.1 + 0.3 * hh[1] * hh[1]) / sc;
      best = Math.min(best, (ang(p, cen) - R) * 1737);
    }
  }
  return best;
}

/** Nearest [lat, lon] (a spiral search in 5 km steps) with at least `need` km of clearance. */
export function nearestDry(lat, lon, need = 8) {
  if (seaClearance(latLonDir(lat, lon)) >= need) return [lat, lon];
  for (let r = 5; r < 900; r += 5) {
    const n = Math.max(8, Math.round(2 * Math.PI * r / 5));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const la = lat + (r / 1737) / D2R * Math.sin(a), lo = lon + (r / 1737) / D2R * Math.cos(a) / Math.max(Math.cos(la * D2R), 0.05);
      if (Math.abs(la) > 89.9) continue;
      if (seaClearance(latLonDir(la, lo)) >= need) return [+la.toFixed(2), +lo.toFixed(2)];
    }
  }
  return null;
}

// -------------------------------------------------------------------------- network --

/** Great-circle arcs [i, j, kind] between ALL_TOWNS (kind 0 highway, 1 rail corridor). */
function buildNetwork() {
  const D = ALL_TOWNS.map(([la, lo]) => latLonDir(la, lo));
  const n = D.length;
  const d = (i, j) => ang(D[i], D[j]);
  const key = (i, j) => (i < j ? `${i}:${j}` : `${j}:${i}`);
  const roads = [], rails = [];
  const have = new Set();
  const add = (list, i, j, kind) => { const k = key(i, j) + kind; if (i === j || have.has(k) || d(i, j) > 2.2) return; have.add(k); list.push([i, j, kind]); };
  // highways: a minimum spanning tree over every town (Prim)
  const inT = new Array(n).fill(false);
  inT[0] = true;
  for (let s = 1; s < n; s++) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < n; i++) if (inT[i]) for (let j = 0; j < n; j++) if (!inT[j] && d(i, j) < bd) { bd = d(i, j); bi = i; bj = j; }
    inT[bj] = true;
    add(roads, bi, bj, 0);
  }
  // the near side's denser web: each settled town also joined to its second-nearest neighbour
  for (let i = 0; i < TOWNS.length; i++) {
    const order = [...Array(TOWNS.length).keys()].filter((j) => j !== i).sort((a, b) => d(i, a) - d(i, b));
    if (d(i, order[1]) < 24 * D2R) add(roads, i, order[1], 0);
  }
  // rail corridors: trunk lines from Medii to the larger towns, the far side's ring line, and
  // the pole lines
  for (let i = 1; i < TOWNS.length; i++) if (TOWNS[i][2] >= 0.5) add(rails, 0, i, 1);
  const far = FAR_TOWNS.map((t, k) => ({ i: TOWNS.length + k, lat: t[0], lon: t[1] })).filter((t) => Math.abs(t.lat) < 60).sort((a, b) => a.lon - b.lon);
  for (let k = 0; k + 1 < far.length; k++) add(rails, far[k].i, far[k + 1].i, 1);
  const nearestNear = (i) => [...Array(TOWNS.length).keys()].sort((a, b) => d(i, a) - d(i, b))[0];
  for (const t of far) if (Math.abs(t.lon) < 135) add(rails, t.i, nearestNear(t.i), 1);
  for (let k = 0; k < FAR_TOWNS.length; k++) {
    if (Math.abs(FAR_TOWNS[k][0]) < 60) continue;
    const i = TOWNS.length + k;
    const cand = [...Array(n).keys()].filter((j) => j !== i && Math.abs(ALL_TOWNS[j][0]) < 60).sort((a, b) => d(i, a) - d(i, b));
    add(rails, i, cand[0], 1);
  }
  return roads.slice(0, 34).concat(rails.slice(0, 18));
}
export const ARCS = buildNetwork();

/** Uniform arrays for the surface shader: endpoints (xyz) with lit half-width km (w), and kind. */
export function arcUniforms() {
  const A = [], B = [];
  for (const [i, j, kind] of ARCS) {
    const a = latLonDir(ALL_TOWNS[i][0], ALL_TOWNS[i][1]), b = latLonDir(ALL_TOWNS[j][0], ALL_TOWNS[j][1]);
    A.push(new THREE.Vector4(a.x, a.y, a.z, kind ? 0.018 : 0.024));
    B.push(new THREE.Vector4(b.x, b.y, b.z, kind));
  }
  return { A, B };
}

/** Town uniforms (direction and weight) for the surface shader. */
export function townUniforms() {
  return ALL_TOWNS.map(([la, lo, w]) => { const v = latLonDir(la, lo); return new THREE.Vector4(v.x, v.y, v.z, w); });
}
