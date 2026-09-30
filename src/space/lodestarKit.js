import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CK } from '../craft/craftGeometry.js';

// Geometry kit for the Lodestar (space/starship.js and its lodestar*.js parts). Everything is in
// metres, nose -Z, up +Y, starboard +X, and carries the craft material's aFacade attribute
// (u, v in facade units, kind). Parts are merged per material; the few moving parts are their
// own meshes sharing the hull's material (craftPart).

export const TAU = Math.PI * 2;
export const FS = 2;                                  // facade scale: plates and bays read at ship size
export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (t) => Math.min(Math.max(t, 0), 1);
export { CK };

/** Small deterministic generator (greeble placement must not change between builds). */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/**
 * Surface through rings (arrays of Vector3, open: the seam is duplicated here) with facade
 * coordinates u = arc length round the ring, v = distance along the rings (metres x fs),
 * one kind per ring or per vertex (kinds(j, i)). Returns an indexed geometry.
 */
export function loft(rings, kinds, { closeRings = false, capStart = false, capEnd = false, capKind, fs = FS, noOrient = false, noWeld = false } = {}) {
  const n = rings[0].length, m = rings.length, pos = [], fac = [], idx = [];
  let along = 0;
  const cen = rings.map((r) => r.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(n));
  const kf = typeof kinds === 'function' ? kinds : () => kinds;
  for (let j = 0; j < m; j++) {
    if (j > 0) along += cen[j].distanceTo(cen[j - 1]);
    let round = 0;
    const r = rings[j];
    for (let i = 0; i <= n; i++) {
      const p = r[i % n];
      if (i > 0) round += p.distanceTo(r[i - 1]);
      pos.push(p.x, p.y, p.z);
      fac.push(round * fs, along * fs, kf(j, i % n));
    }
  }
  const W = n + 1, segJ = closeRings ? m : m - 1;
  for (let j = 0; j < segJ; j++) {
    const j1 = (j + 1) % m;
    for (let i = 0; i < n; i++) {
      const a = j * W + i, b = a + 1, c = j1 * W + i + 1, d = j1 * W + i;
      idx.push(a, b, c, a, c, d);
    }
  }
  const cap = (j, flip) => {
    const c = cen[j], ci = pos.length / 3, k = capKind ?? kf(j, 0);
    pos.push(c.x, c.y, c.z); fac.push(0, 0, k);
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) { const p = rings[j][i]; pos.push(p.x, p.y, p.z); fac.push((p.x - c.x) * fs, (p.y - c.y + p.z - c.z) * fs, k); }
    for (let i = 0; i < n; i++) { const a = base + i, b = base + ((i + 1) % n); if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(m - 1, true);
  return finish(pos, fac, idx, { noOrient, noWeld });
}

export function finish(pos, fac, idx, { noOrient = false, noWeld = false } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  if (!noOrient) orient(g);
  g.computeVertexNormals();
  if (!noWeld) weld(g);
  return g;
}

/** Wind a closed surface outward. */
export function orient(g) {
  const p = g.attributes.position.array, idx = g.index.array;
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  if (vol < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
}

/** Average normals of coincident vertices (seams, kind rings) within 50 degrees of each other. */
export function weld(g) {
  const p = g.attributes.position, n = g.attributes.normal, map = new Map();
  const key = (i) => `${Math.round(p.getX(i) * 1000)},${Math.round(p.getY(i) * 1000)},${Math.round(p.getZ(i) * 1000)}`;
  for (let i = 0; i < p.count; i++) { const k = key(i); let l = map.get(k); if (!l) map.set(k, (l = [])); l.push(i); }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), s = new THREE.Vector3(), out = new Float32Array(n.array.length);
  out.set(n.array);
  for (const list of map.values()) {
    if (list.length < 2) continue;
    for (const i of list) {
      a.fromBufferAttribute(n, i); s.set(0, 0, 0);
      for (const j of list) { b.fromBufferAttribute(n, j); if (a.dot(b) > 0.64) s.add(b); }
      if (s.lengthSq() > 1e-12) { s.normalize(); out[i * 3] = s.x; out[i * 3 + 1] = s.y; out[i * 3 + 2] = s.z; }
    }
  }
  n.array.set(out);
  n.needsUpdate = true;
}

/** Stock geometry -> facade geometry of one kind (planar facade from its own uv, metres). */
export function stock(g, k, uvScale = 1) {
  g = g.index ? g : g.toNonIndexed();
  if (!g.index) { const a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(i); g.setIndex(a); }
  const uv = g.attributes.uv, c = g.attributes.position.count, f = new Float32Array(c * 3);
  for (let i = 0; i < c; i++) { f[i * 3] = uv ? uv.getX(i) * uvScale * FS : 0; f[i * 3 + 1] = uv ? uv.getY(i) * uvScale * FS : 0; f[i * 3 + 2] = k; }
  g.setAttribute('aFacade', new THREE.BufferAttribute(f, 3));
  for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'aFacade'].includes(key)) g.deleteAttribute(key);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

/** Merge facade geometries (non-empty) into one. */
export function merge(list) {
  const ok = list.filter((g) => g && g.attributes.position.count > 0);
  const g = mergeGeometries(ok, false);
  g.computeBoundingSphere();
  return g;
}

export const circle = (r, z, n, cx = 0, cy = 0, a0 = 0) => { const o = []; for (let i = 0; i < n; i++) { const t = a0 + (i / n) * TAU; o.push(V3(cx + Math.cos(t) * r, cy + Math.sin(t) * r, z)); } return o; };

/** Solid of revolution about +Z: profile [[r, z, kind], ...]; kinds change at repeated points. */
export function revolve(profile, n = 40, { closed = false, cx = 0, cy = 0 } = {}) {
  const rings = profile.map(([r, z]) => circle(Math.max(r, 1e-4), z, n, cx, cy));
  return loft(rings, (j) => profile[j][2] ?? CK.HULL, { closeRings: closed, capStart: !closed && profile[0][0] > 1e-3, capEnd: !closed && profile[profile.length - 1][0] > 1e-3 });
}

/** Tube along points (closed ends). */
export function tube(pts, r, k, n = 12, per = 4) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const N = Math.max(2, (pts.length - 1) * per);
  const frames = curve.computeFrenetFrames(N, false);
  const rings = [];
  for (let j = 0; j <= N; j++) {
    const c = curve.getPointAt(j / N), nn = frames.normals[j], bb = frames.binormals[j], ring = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; ring.push(c.clone().addScaledVector(nn, Math.cos(a) * r).addScaledVector(bb, Math.sin(a) * r)); }
    rings.push(ring);
  }
  return loft(rings, k, { capStart: true, capEnd: true });
}

/** Straight rod between two points (a cylinder, capped). */
export function rod(a, b, r, k, n = 10) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const g = stock(new THREE.CylinderGeometry(r, r, L, n, 1), k);
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()), V3(1, 1, 1)));
  return g;
}

/** A box of kind k at centre c (sizes w, h, d), optionally rotated (Euler or Quaternion). */
export function box(w, h, d, k, c = V3(0, 0, 0), rot = null) {
  const g = stock(new THREE.BoxGeometry(w, h, d), k, Math.max(w, h, d));
  const q = rot ? (rot.isQuaternion ? rot : new THREE.Quaternion().setFromEuler(rot)) : new THREE.Quaternion();
  return g.applyMatrix4(new THREE.Matrix4().compose(c, q, V3(1, 1, 1)));
}

/** A bevelled box (chamfered edges): a loft of chamfered rectangles. */
export function bbox(w, h, d, bev, k, c = V3(0, 0, 0), rot = null) {
  const hw = w / 2, hh = h / 2, hd = d / 2, b = Math.min(bev, hw * 0.4, hh * 0.4, hd * 0.4);
  const rect = (z, s) => {
    const x = hw - s, y = hh - s, c = b;
    return [V3(x, -y + c, z), V3(x, y - c, z), V3(x - c, y, z), V3(-x + c, y, z), V3(-x, y - c, z), V3(-x, -y + c, z), V3(-x + c, -y, z), V3(x - c, -y, z)];
  };
  const g = loft([rect(-hd, b), rect(-hd + b, 0), rect(hd - b, 0), rect(hd, b)], k, { capStart: true, capEnd: true });
  const q = rot ? (rot.isQuaternion ? rot : new THREE.Quaternion().setFromEuler(rot)) : new THREE.Quaternion();
  return g.applyMatrix4(new THREE.Matrix4().compose(c, q, V3(1, 1, 1)));
}

/** Place a geometry built about the origin with its +Y along dir at p (optionally spun about it). */
export function placeY(g, p, dir, spin = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir.clone().normalize());
  if (spin) q.multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), spin));
  return g.applyMatrix4(new THREE.Matrix4().compose(p, q, V3(1, 1, 1)));
}
/** Place a geometry built about the origin with its +Z along dir at p. */
export function placeZ(g, p, dir, spin = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), dir.clone().normalize());
  if (spin) q.multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), spin));
  return g.applyMatrix4(new THREE.Matrix4().compose(p, q, V3(1, 1, 1)));
}

/** A small bell nozzle (+Z out of the exit), throat at the origin; kinds for the skin and lip. */
export function bell(rt, re, len, k = CK.DARK, kLip = CK.BRONZE, n = 18) {
  const prof = [];
  for (let j = 0; j <= 6; j++) { const x = j / 6; prof.push([rt + (re - rt) * (1 - Math.pow(1 - x, 1.7)) + 0.02 * re, x * len, j === 6 ? kLip : k]); }
  prof.push([re * 0.93, len * 0.985, kLip]);
  prof.push([rt * 0.9, len * 0.2, CK.DARK]);
  const g = revolve(prof, n, { closed: false });
  return g;
}

/** Count triangles of a geometry. */
export const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
