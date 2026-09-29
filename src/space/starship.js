import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CK } from '../craft/craftGeometry.js';
import { craftMesh, craftPart, addLamps } from './craftMesh.js';
import { createEngine, ENGINE_FRAME } from './exhaust.js';
import { createRcsJet } from './plume.js';

// The Concord starcourier "Lodestar": the ship the visitor flies in the orbital view. A 36 m
// lifting-body cutter drawn in metres with the craft material (view-space sunlight, the Earth's
// shadow, earthshine, the Earth mirrored in its glazing) like every other hull out here:
//   hull      a manta-lens section: broad and flat with sharp chines trimmed in bronze, a raised
//             crew deck under a glazed canopy, window rows along the upper flanks, a glowing
//             conduit down the spine, a docking ring behind the canopy
//   radiators swept radiator wings from the chines and twin canted radiator fins at the stern
//             (the only way a ship this size sheds its drive heat)
//   drive     one main engine and two smaller ones on a thrust frame, physically based nozzles
//             that glow with their own heat and a faint vacuum plume (space/exhaust.js)
//   legs      a landing tripod that folds into the belly
//   details   RCS quads fore and aft, a comms dish, antennas, running lights, strobes, beacons
// Nose toward -Z, up +Y, starboard +X.

const TAU = Math.PI * 2;
const FS = 2;                                  // facade scale: plates and bays read at ship size
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------- builder --
/**
 * Surface through rings (arrays of Vector3, open: the seam is duplicated here) with facade
 * coordinates u = arc length round the ring, v = distance along the rings (metres x FS),
 * one kind per ring (repeat a ring where the kind changes). Returns an indexed geometry.
 */
function loft(rings, kinds, { closeRings = false, capStart = false, capEnd = false, capKind } = {}) {
  const n = rings[0].length, m = rings.length, pos = [], fac = [], idx = [];
  let along = 0;
  const cen = rings.map((r) => r.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(n));
  for (let j = 0; j < m; j++) {
    if (j > 0) along += cen[j].distanceTo(cen[j - 1]);
    let round = 0;
    const r = rings[j], k = typeof kinds === 'function' ? kinds(j) : kinds;
    for (let i = 0; i <= n; i++) {
      const p = r[i % n];
      if (i > 0) round += p.distanceTo(r[i - 1]);
      pos.push(p.x, p.y, p.z);
      fac.push(round * FS, along * FS, k);
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
    const c = cen[j], ci = pos.length / 3, k = capKind ?? (typeof kinds === 'function' ? kinds(j) : kinds);
    pos.push(c.x, c.y, c.z); fac.push(0, 0, k);
    // cap vertices get their own copies with planar facade coordinates
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) { const p = rings[j][i]; pos.push(p.x, p.y, p.z); fac.push((p.x - c.x) * FS, (p.y - c.y) * FS, k); }
    for (let i = 0; i < n; i++) { const a = base + i, b = base + ((i + 1) % n); if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(m - 1, true);
  return finish(pos, fac, idx);
}

function finish(pos, fac, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  orient(g);
  g.computeVertexNormals();
  weld(g);
  return g;
}

/** Wind a closed surface outward. */
function orient(g) {
  const p = g.attributes.position.array, idx = g.index.array;
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  if (vol < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
}

/** Average normals of coincident vertices (seams, kind rings) within 50 degrees of each other. */
function weld(g) {
  const p = g.attributes.position, n = g.attributes.normal, map = new Map();
  const key = (i) => `${Math.round(p.getX(i) * 1000)},${Math.round(p.getY(i) * 1000)},${Math.round(p.getZ(i) * 1000)}`;
  for (let i = 0; i < p.count; i++) { const k = key(i); if (!map.has(k)) map.set(k, []); map.get(k).push(i); }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), s = new THREE.Vector3();
  for (const list of map.values()) {
    if (list.length < 2) continue;
    for (const i of list) {
      a.fromBufferAttribute(n, i); s.set(0, 0, 0);
      for (const j of list) { b.fromBufferAttribute(n, j); if (a.dot(b) > 0.64) s.add(b); }
      if (s.lengthSq() > 1e-12) { s.normalize(); n.setXYZ(i, s.x, s.y, s.z); }
    }
  }
  n.needsUpdate = true;
}

/** Stock geometry -> facade geometry of one kind (planar facade from its own uv, metres). */
function stock(g, k, uvScale = 1) {
  g = g.index ? g : g.toNonIndexed();
  if (!g.index) { const a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(i); g.setIndex(a); }
  const uv = g.attributes.uv, c = g.attributes.position.count, f = new Float32Array(c * 3);
  for (let i = 0; i < c; i++) { f[i * 3] = uv ? uv.getX(i) * uvScale * FS : 0; f[i * 3 + 1] = uv ? uv.getY(i) * uvScale * FS : 0; f[i * 3 + 2] = k; }
  g.setAttribute('aFacade', new THREE.BufferAttribute(f, 3));
  for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'aFacade'].includes(key)) g.deleteAttribute(key);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
const merge = (list) => { const g = mergeGeometries(list, false); g.computeBoundingSphere(); return g; };

const circle = (r, z, n, cx = 0, cy = 0, a0 = 0) => { const o = []; for (let i = 0; i < n; i++) { const t = a0 + (i / n) * TAU; o.push(V3(cx + Math.cos(t) * r, cy + Math.sin(t) * r, z)); } return o; };
/** Solid of revolution about +Z: profile [[r, z, kind], ...]; kinds change at repeated points. */
function revolve(profile, n = 40, { closed = false, cx = 0, cy = 0 } = {}) {
  const rings = profile.map(([r, z]) => circle(Math.max(r, 1e-4), z, n, cx, cy));
  return loft(rings, (j) => profile[j][2] ?? CK.HULL, { closeRings: closed, capStart: !closed && profile[0][0] > 1e-3, capEnd: !closed && profile[profile.length - 1][0] > 1e-3 });
}
/** Tube along points (closed ends). */
function tube(pts, r, k, n = 12) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const frames = curve.computeFrenetFrames(pts.length * 4, false);
  const rings = [];
  const N = pts.length * 4;
  for (let j = 0; j <= N; j++) {
    const c = curve.getPointAt(j / N), nn = frames.normals[j], bb = frames.binormals[j], ring = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; ring.push(c.clone().addScaledVector(nn, Math.cos(a) * r).addScaledVector(bb, Math.sin(a) * r)); }
    rings.push(ring);
  }
  return loft(rings, k, { capStart: true, capEnd: true });
}

// ------------------------------------------------------------------ the hull --
export const SHIP = { Z0: -20, L: 36 };
const zOf = (t) => SHIP.Z0 + SHIP.L * t, tOf = (z) => (z - SHIP.Z0) / SHIP.L;
const C = (t) => Math.min(Math.max(t, 0), 1);
/** Section of the hull at station t: half-width, top and bottom heights, exponents. */
function sec(t) {
  const w = 5.2 * Math.pow(Math.sin((Math.min(t / 0.6, 1) * Math.PI) / 2), 0.8) * (1 - 0.18 * smooth(0.8, 1, t));
  const hump = 0.85 * Math.exp(-(((t - 0.3) / 0.13) ** 2));
  const ht = 1.9 * Math.pow(Math.sin((Math.min(t / 0.45, 1) * Math.PI) / 2), 0.75) * (1 - 0.25 * smooth(0.75, 1, t)) + hump * smooth(0.05, 0.2, t);
  const hb = 1.5 * Math.pow(Math.sin((Math.min(t / 0.4, 1) * Math.PI) / 2), 0.75) * (1 - 0.15 * smooth(0.75, 1, t));
  return { w, ht, hb, nx: 3.0, ny: 1.35 };
}
const sgnPow = (c, e) => Math.sign(c) * Math.pow(Math.abs(c), e);
/** Point on the hull at station t and section angle a (0 = starboard chine, pi/2 = top). */
function hullPt(t, a, off = 0) {
  const S = sec(C(t)), c = Math.cos(a), s = Math.sin(a);
  const p = V3(S.w * sgnPow(c, 2 / S.nx), (s > 0 ? S.ht : S.hb) * sgnPow(s, 2 / S.ny), zOf(C(t)));
  if (off) {
    // offset along the section's outward normal (from the tangent round the section)
    const e = 1e-3, c2 = Math.cos(a + e), s2 = Math.sin(a + e);
    const q = V3(S.w * sgnPow(c2, 2 / S.nx), (s2 > 0 ? S.ht : S.hb) * sgnPow(s2, 2 / S.ny), 0);
    const tx = q.x - p.x, ty = q.y - p.y, L = Math.hypot(tx, ty) || 1;
    p.x += (ty / L) * off; p.y += (-tx / L) * off;
  }
  return p;
}
function hullRing(t, n = 72) { const o = []; for (let i = 0; i < n; i++) o.push(hullPt(t, (i / n) * TAU)); return o; }
/** A shell strip on the hull over t0..t1 and section angles a0..a1 (proud by o, sunk by i). */
function hullStrip(t0, t1, a0, a1, k, { o = 0.06, i = 0.12, nt = 16, na = 16 } = {}) {
  const rings = [];
  for (let j = 0; j <= nt; j++) {
    const t = lerp(t0, t1, j / nt), out = [], inn = [];
    for (let q = 0; q <= na; q++) { const a = lerp(a0, a1, q / na); out.push(hullPt(t, a, o)); inn.push(hullPt(t, a, -i)); }
    rings.push([...out, ...inn.reverse()]);
  }
  return loft(rings, k, { capStart: true, capEnd: true });
}
/** A flat, tapered plate (radiator) given its planform corners and thickness. */
function plate(root0, root1, tip1, tip0, th, k) {
  const q = [root0, root1, tip1, tip0], up = V3(0, th / 2, 0);
  const rings = [];
  // loft across the span: rings are the two chords (closed as thin boxes)
  for (const [a, b] of [[root0, root1], [tip0, tip1]]) rings.push([a.clone().add(up), b.clone().add(up), b.clone().sub(up), a.clone().sub(up)]);
  void q;
  return loft(rings, k, { capStart: true, capEnd: true });
}

export class Starship {
  constructor() {
    this.root = new THREE.Group();            // km units: position and orientation of the ship
    this.root.name = 'Lodestar';
    this.movers = {};
    this.state = { throttle: 0, aux: 0, boost: 0, legs: 0, rcs: 0, reverse: 0 };
    this._build();
  }

  _build() {
    const S = [];

    // ---- hull (a lens section, chines at a = 0 and pi), the stern closed by the thrust frame
    const rings = [];
    const K = 88;
    for (let k = 0; k <= K; k++) {
      const t = 0.5 - 0.5 * Math.cos((Math.PI * k) / K);
      rings.push(t < 1e-4 ? hullRing(1e-4).map(() => V3(0, 0, SHIP.Z0)) : hullRing(t));
    }
    S.push(loft(rings, CK.HULL, { capEnd: true, capKind: CK.DARK }));

    // ---- canopy over the crew deck, window rows along the upper flanks
    {
      const cr = [], N = 22;
      for (let j = 0; j <= N; j++) {
        const u = j / N, t = lerp(0.13, 0.33, u), S0 = sec(t);
        const w = 1.25 * Math.pow(Math.sin(Math.PI * u), 0.4), h = 0.62 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.6);
        const base = S0.ht - 0.28, ring = [];
        for (let q = 0; q <= 16; q++) { const a = (q / 16) * Math.PI; ring.push(V3(Math.cos(a) * Math.max(w, 0.01), base + Math.sin(a) * Math.max(h + 0.28, 0.01), zOf(t))); }
        ring.push(V3(-Math.max(w, 0.01) * 0.8, base - 0.4, zOf(t)), V3(Math.max(w, 0.01) * 0.8, base - 0.4, zOf(t)));
        cr.push(ring);
      }
      S.push(loft(cr, CK.GLASS, { capStart: true, capEnd: true }));
      for (const sg of [1, -1]) {
        const pts = [];
        for (let j = 1; j < N; j++) { const u = j / N, t = lerp(0.13, 0.33, u); pts.push(V3(sg * (1.25 * Math.pow(Math.sin(Math.PI * u), 0.4) + 0.04), sec(t).ht - 0.22, zOf(t))); }
        S.push(tube(pts, 0.07, CK.BRONZE, 8));
      }
    }
    for (const a of [0.42, Math.PI - 0.42]) S.push(hullStrip(0.34, 0.62, a - 0.08, a + 0.08, CK.GLASS, { nt: 20, na: 4 }));

    // ---- chines trimmed in bronze, a spine conduit, a docking ring behind the canopy
    for (const a of [0, Math.PI]) {
      const pts = []; for (let t = 0.08; t <= 0.97; t += 0.03) pts.push(hullPt(t, a, 0.02));
      S.push(tube(pts, 0.1, CK.BRONZE, 8));
    }
    {
      const pts = []; for (let t = 0.4; t <= 0.93; t += 0.035) pts.push(hullPt(t, Math.PI / 2, 0.16));
      S.push(tube(pts, 0.22, CK.CONDUIT, 10));
      const d = hullPt(0.38, Math.PI / 2);
      S.push(revolve([[0.0, 0.0, CK.DARK], [0.75, 0.0, CK.DARK], [0.75, 0.0, CK.BRONZE], [0.95, 0.12, CK.BRONZE], [0.95, 0.42, CK.BRONZE], [0.6, 0.5, CK.BRONZE], [0.0, 0.5, CK.BRONZE]], 32).applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2)).translate(d.x, d.y - 0.1, d.z));
    }

    // ---- radiator wings from the chines (swept, slight anhedral) and stern fins
    this.navTips = [];
    for (const sg of [1, -1]) {
      const r0 = hullPt(0.55, sg > 0 ? 0 : Math.PI), r1 = hullPt(0.93, sg > 0 ? 0 : Math.PI);
      r0.x -= sg * 0.3; r1.x -= sg * 0.3;
      const span = 6.8, drop = -0.7;
      const t0 = V3(r0.x + sg * span, r0.y + drop, r0.z + 7.2), t1 = V3(r0.x + sg * span, r0.y + drop, r0.z + 11.0);
      S.push(plate(r0, r1, t1, t0, 0.24, CK.RADIATOR));
      S.push(tube([r0.clone().add(V3(0, 0, -0.1)), t0.clone().add(V3(sg * 0.05, 0, -0.1))], 0.14, CK.BRONZE, 8));
      S.push(tube([t0.clone().add(V3(sg * 0.02, 0, -0.1)), t1.clone().add(V3(sg * 0.02, 0, 0.1))], 0.12, CK.BRONZE, 8));
      this.navTips.push(t0.clone().add(V3(sg * 0.15, 0, -0.15)));
    }
    for (const sg of [1, -1]) {
      const b0 = hullPt(0.76, Math.PI / 2 - sg * 0.55, -0.05), b1 = hullPt(0.97, Math.PI / 2 - sg * 0.55, -0.05);
      const dir = V3(sg * Math.sin(0.42), Math.cos(0.42), 0);
      const t0 = b0.clone().addScaledVector(dir, 3.2).add(V3(0, 0, 3.6)), t1 = b1.clone().addScaledVector(dir, 3.2).add(V3(0, 0, 0.9));
      // a fin: the plate helper takes a planform in its own plane; build it along the canted direction
      const up = V3(0, 0, 0).add(new THREE.Vector3().crossVectors(dir, V3(0, 0, 1)).normalize().multiplyScalar(0.11));
      const ring = (a, b) => [a.clone().add(up), b.clone().add(up), b.clone().sub(up), a.clone().sub(up)];
      S.push(loft([ring(b0, b1), ring(t0, t1)], CK.RADIATOR, { capStart: true, capEnd: true }));
      S.push(tube([b0.clone(), t0.clone()], 0.1, CK.BRONZE, 8));
    }

    // ---- thrust frame, engine housings and nozzles
    const zs = zOf(1);
    this.engineMounts = [
      { p: V3(0, 0.05, zs), rt: 0.55, re: 1.65, len: 3.2, main: true },
      { p: V3(2.9, -0.15, zs), rt: 0.3, re: 0.82, len: 1.8 },
      { p: V3(-2.9, -0.15, zs), rt: 0.3, re: 0.82, len: 1.8 },
    ];
    for (const e of this.engineMounts) {
      const R = e.main ? 1.15 : 0.62;
      S.push(revolve([[R + 0.25, 0, CK.DARK], [R + 0.25, 0.55, CK.DARK], [R + 0.25, 0.55, CK.BRONZE], [R + 0.3, 0.75, CK.BRONZE], [R, 1.25, CK.BRONZE], [R, 1.25, CK.DARK], [e.rt + 0.1, 1.5, CK.DARK], [0, 1.5, CK.DARK]], 32, { cx: e.p.x, cy: e.p.y }).translate(0, 0, zs));
    }

    // ---- reverse thrusters: a pod on each flank in the forward third, its nozzle facing forward and
    // canted outboard so the plume clears the bow; they fire to brake (S), not the RCS
    this.reverseMounts = [];
    for (const side of [1, -1]) {
      const c = hullPt(0.36, side > 0 ? -0.18 : Math.PI + 0.18, 0.55), z0 = c.z - 1.1;
      S.push(revolve([[0, 0, CK.DARK], [0.3, 0.06, CK.DARK], [0.46, 0.3, CK.BRONZE], [0.5, 0.55, CK.HULL], [0.5, 1.9, CK.HULL], [0.44, 2.3, CK.BRONZE], [0.2, 2.5, CK.DARK], [0, 2.5, CK.DARK]], 28, { cx: c.x, cy: c.y }).translate(0, 0, z0));
      // the pylon onto the hull
      S.push(stock(new THREE.BoxGeometry(0.5, 0.18, 1.6), CK.DARK).translate(c.x - side * 0.35, c.y, z0 + 1.2));
      this.reverseMounts.push({ p: V3(c.x, c.y, z0), side });
    }

    // ---- RCS quads (fore on the chines, aft on the wing roots)
    this.rcs = [];
    for (const [t, a] of [[0.2, 0], [0.2, Math.PI], [0.88, 0.25], [0.88, Math.PI - 0.25]]) {
      const c = hullPt(t, a, 0.25), sx = Math.sign(c.x);
      const box = stock(new THREE.BoxGeometry(0.55, 0.55, 0.8), CK.DARK).translate(c.x, c.y, c.z);
      S.push(box);
      for (const d of [V3(0, 1, 0), V3(0, -1, 0), V3(sx, 0, 0), V3(0, 0, t < 0.5 ? -1 : 1)]) {
        const nz = stock(new THREE.CylinderGeometry(0.06, 0.13, 0.24, 10), CK.BRONZE);
        nz.applyMatrix4(new THREE.Matrix4().compose(c.clone().addScaledVector(d, 0.38), new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d), V3(1, 1, 1)));
        S.push(nz);
        this.rcs.push({ p: c.clone().addScaledVector(d, 0.55), r: 0.3, dir: d.clone() });
      }
    }

    // ---- comms dish and antennas on the spine
    {
      const b = hullPt(0.66, Math.PI / 2);
      S.push(stock(new THREE.CylinderGeometry(0.1, 0.14, 1.2, 10), CK.DARK).translate(b.x, b.y + 0.55, b.z));
      const dish = revolve([[0.0, 0.0, CK.DECK], [0.5, 0.06, CK.DECK], [0.95, 0.24, CK.DECK], [1.0, 0.27, CK.BRONZE], [0.93, 0.3, CK.DARK], [0.45, 0.13, CK.DARK], [0.0, 0.1, CK.DARK]], 32);
      dish.applyMatrix4(new THREE.Matrix4().compose(V3(b.x, b.y + 1.2, b.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.7, 0, 0)), V3(1, 1, 1)));
      S.push(dish);
      for (const [t, x, h] of [[0.5, 0.6, 1.4], [0.5, -0.6, 1.1], [0.82, 0, 0.9]]) { const q = hullPt(t, Math.PI / 2); S.push(stock(new THREE.CylinderGeometry(0.025, 0.04, h, 6), CK.DARK).translate(x, q.y + h / 2 - 0.05, q.z)); }
    }

    const hull = craftMesh(merge(S), { accent: [0.5, 0.82, 1.0], lit: 0.75, fill: 0.03, flood: 1 });
    hull.name = 'Lodestar hull';
    this.root.add(hull);
    this.hull = hull;

    // ---- landing tripod (folds flat into the belly)
    this.movers.legs = [];
    for (const [x, z] of [[0, -8.5], [2.6, 8.5], [-2.6, 8.5]]) {
      const t = tOf(z), a = -Math.PI / 2 + Math.atan2(x, 3) * 0.6;
      const at = hullPt(t, -Math.PI / 2 + (x ? Math.sign(x) * 0.45 : 0), -0.05);
      const hinge = new THREE.Group();
      hinge.position.copy(at);
      hinge.rotation.order = 'ZYX';
      hinge.rotation.z = x ? -Math.sign(x) * 0.22 : 0;
      void a;
      const leg = [];
      leg.push(stock(new THREE.CylinderGeometry(0.2, 0.26, 4.6, 12), CK.DARK).translate(0, -2.3, 0));
      leg.push(stock(new THREE.CylinderGeometry(0.14, 0.14, 2.2, 10), CK.BRONZE).translate(0, -4.3, 0));
      leg.push(revolve([[0, -0.15, CK.DARK], [0.8, -0.15, CK.DARK], [0.8, 0.1, CK.DARK], [0.4, 0.28, CK.DARK], [0, 0.32, CK.DARK]], 20).applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2)).translate(0, -5.45, 0));
      const m = craftPart(hull, merge(leg));
      hinge.add(m);
      hull.add(hinge);
      this.movers.legs.push({ g: hinge, out: x ? -0.34 : -0.42 });
    }

    // ---- engines (metres, in the hull's frame: their axis +Z, exhaust aft)
    this.engines = [];
    for (const e of this.engineMounts) {
      const eng = createEngine({ rt: e.rt, re: e.re, len: e.len, plumeLen: e.re * (e.main ? 19 : 16) });
      eng.position.set(e.p.x, e.p.y, zs + 1.45);
      hull.add(eng);
      this.engines.push({ g: eng, main: !!e.main });
    }
    // reverse engines: their axis +Z turned to face forward, canted 0.3 rad outboard
    this.reverse = this.reverseMounts.map((m) => {
      const eng = createEngine({ rt: 0.2, re: 0.5, len: 1.1, plumeLen: 0.5 * 15 });
      eng.position.copy(m.p);
      eng.rotation.y = Math.PI - m.side * 0.3;
      hull.add(eng);
      return eng;
    });
    // RCS: a cold-gas jet at every nozzle, with the force and torque it gives the ship (for thruster
    // selection: each manoeuvre fires the nozzles that push the right way)
    this.jets = this.rcs.map((n) => {
      const jet = createRcsJet(n.p, n.dir);
      hull.add(jet);
      const F = n.dir.clone().negate();                                   // the push on the ship
      const tau = new THREE.Vector3().crossVectors(n.p, F);
      return { jet, F, tau: tau.lengthSq() > 1e-8 ? tau.normalize() : tau };
    });
    const lamps = [
      { p: this.navTips[1], r: 0.3, color: [1.0, 0.12, 0.08], i: 2.2 },                                          // port
      { p: this.navTips[0], r: 0.3, color: [0.12, 1.0, 0.35], i: 2.2 },                                          // starboard
      { p: V3(0, 0.6, zs + 0.2), r: 0.28, color: [1.0, 1.0, 1.0], i: 1.8 },                                      // stern
      { p: hullPt(0.5, Math.PI / 2, 0.3), r: 0.34, color: [1.0, 0.1, 0.05], i: 2.4, breathe: 1 },               // beacon, top
      { p: hullPt(0.5, -Math.PI / 2, 0.3), r: 0.34, color: [1.0, 0.1, 0.05], i: 2.4, breathe: 1, phase: 0.5 },   // beacon, belly
      { p: hullPt(0.1, -Math.PI / 2, 0.15), r: 0.26, color: [1.0, 0.92, 0.8], i: 1.6 },                         // landing light
    ];
    addLamps(hull, lamps, { minPx: 1.2, gain: 1 });
  }

  /**
   * Animate: throttle 0..1 (main), aux 0..1 (small engines), boost 0/1, legs 0..1; ang / lin: the
   * angular and linear acceleration the thrusters are asked for (ship frame, in units of their
   * capacity); sunlit 0..1 (the cold-gas puffs only show in sunlight); time (s).
   */
  update(dt, s) {
    const st = this.state, k = (r) => 1 - Math.exp(-dt * r);
    st.throttle += (s.throttle - st.throttle) * k(6);
    st.aux += ((s.aux ?? s.throttle) - st.aux) * k(6);
    st.boost += (s.boost - st.boost) * k(3);
    st.legs += (s.legs - st.legs) * k(1.2);
    st.rcs += (s.rcs - st.rcs) * k(12);
    for (const l of this.movers.legs) l.g.rotation.x = lerp(-1.52, l.out, st.legs);
    for (const e of this.engines) e.g.setThrust(e.main ? Math.min(1, st.throttle) : st.aux, dt, st.boost);
    st.reverse += ((s.reverse || 0) - st.reverse) * k(8);
    if (this.reverse) for (const e of this.reverse) e.setThrust(st.reverse, dt, s.reverseBoost || 0);
    const ang = s.ang, lin = s.lin, sun = s.sunlit ?? 1, time = s.time ?? 0;
    for (const j of this.jets) {
      let d = 0;
      if (ang) d += Math.max(0, j.tau.dot(ang));
      if (lin) d += Math.max(0, j.F.dot(lin));
      j.jet.setDemand(d, dt, sun, time);
    }
  }
}

export { ENGINE_FRAME };
