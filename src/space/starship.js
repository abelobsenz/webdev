import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CK } from '../craft/craftGeometry.js';
import { craftMesh, craftPart, addEngines, addLamps, KM } from './craftMesh.js';
import { createGlowMesh } from '../craft/craftMaterial.js';

// The Concord starcourier "Lodestar": the ship the visitor flies in the orbital view. 48 m long,
// drawn in metres with the craft material (view-space sunlight, the Earth's shadow, earthshine,
// the Earth mirrored in its glazing) like every other hull out here:
//   hull      a round spindle, pearl plating; a panoramic glazed band round the nose, a bridge
//             crown (glazed dome) on the forward back, window rows along both flanks
//   trim      bronze bands, a docking collar at the nose, a glowing conduit along the spine
//   ring      a habitat ring (glazed outer rim) on four spokes, turning on a bearing collar
//   drive     three bronze bells with plasma plumes, a thrust frame, RCS quads fore and aft
//   radiators two wings that swing out from the flanks when the drive is quiet
//   legs      three landing legs that fold flat along the aft hull
//   details   comms dish on a mast, whip antennas, running lights, strobes and a beacon
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

// --------------------------------------------------------------- the spindle --
export const SHIP = { L: 46, Z0: -24, len: 48 };
const hullR = (t) => 4.6 * Math.pow(Math.sin((Math.min(t / 0.42, 1) * Math.PI) / 2), 0.62) * (1 - 0.22 * smooth(0.55, 1, t));
const zOf = (t) => SHIP.Z0 + SHIP.L * t, tOf = (z) => (z - SHIP.Z0) / SHIP.L;
export const shipHullR = (z) => hullR(Math.min(Math.max(tOf(z), 0), 1));

/** A shell strip laid on the hull (outer +o, inner -i) over t0..t1 and angles a0..a1 (0 = +X, pi/2 = top). */
function hullStrip(t0, t1, a0, a1, k, { o = 0.07, i = 0.12, nt = 16, na = 24, taper = 0 } = {}) {
  const rings = [];
  for (let j = 0; j <= nt; j++) {
    const u = j / nt, t = lerp(t0, t1, u), z = zOf(t), R = hullR(t);
    const sq = taper ? Math.pow(Math.sin(Math.PI * u), taper) : 1;
    const am = (a0 + a1) / 2, ah = ((a1 - a0) / 2) * Math.max(sq, 0.02);
    const out = [], inn = [];
    for (let q = 0; q <= na; q++) { const a = am - ah + (2 * ah * q) / na; out.push(V3(Math.cos(a) * (R + o), Math.sin(a) * (R + o), z)); inn.push(V3(Math.cos(a) * (R - i), Math.sin(a) * (R - i), z)); }
    rings.push([...out, ...inn.reverse()]);
  }
  return loft(rings, k, { capStart: true, capEnd: true });
}
/** A band round the hull at station z (width w, proud by h). */
function hullBand(z, w, h, k, n = 64) {
  const r = (zz, o) => circle(shipHullR(zz) + o, zz, n);
  return loft([r(z - w / 2, -0.1), r(z - w / 2, h), r(z + w / 2, h), r(z + w / 2, -0.1)], k, { closeRings: true });
}

export class Starship {
  constructor() {
    this.root = new THREE.Group();            // km units: position and orientation of the ship
    this.root.name = 'Lodestar';
    this.movers = {};
    this.state = { throttle: 0, boost: 0, legs: 0, radiators: 1, rcs: 0, ringRate: 0.45 };
    this._build();
  }

  _build() {
    const S = [];                               // static hull parts (metres)

    // ---- hull: nose dock, spindle, thrust frame at the stern
    const hr = [];
    const K = 80;
    for (let k = 0; k <= K; k++) {
      const t = 0.5 - 0.5 * Math.cos((Math.PI * k) / K);
      hr.push(circle(Math.max(hullR(t), 0.0015), zOf(t), 64));
    }
    S.push(loft(hr, CK.HULL, { capEnd: true, capKind: CK.DARK }));
    // docking collar and port at the nose
    S.push(revolve([[0.0, -24.9, CK.DARK], [0.55, -24.9, CK.DARK], [0.62, -24.6, CK.DARK], [0.62, -24.6, CK.BRONZE], [1.0, -24.45, CK.BRONZE], [1.05, -23.9, CK.BRONZE], [0.8, -23.2, CK.BRONZE]], 40));
    // glazing: the panoramic band round the nose, the bridge crown, the flank decks
    S.push(hullStrip(0.085, 0.13, -Math.PI / 2 + 0.22, Math.PI * 1.5 - 0.22, CK.GLASS, { nt: 8, na: 48 }));
    {
      // bridge crown: a glazed blister over the forward back (a dome lofted along the hull)
      const rings = [];
      for (let j = 0; j <= 20; j++) {
        const u = j / 20, t = lerp(0.16, 0.34, u), z = zOf(t), R = hullR(t);
        const w = 2.2 * Math.pow(Math.sin(Math.PI * u), 0.45), hgt = 1.55 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.6);
        const ring = [];
        for (let q = 0; q <= 16; q++) { const a = (q / 16) * Math.PI; ring.push(V3(Math.cos(a) * Math.max(w, 0.01), R - 0.35 + Math.sin(a) * Math.max(hgt + 0.35, 0.01), z)); }
        ring.push(V3(-Math.max(w, 0.01) * 0.8, R - 0.8, z), V3(Math.max(w, 0.01) * 0.8, R - 0.8, z));
        rings.push(ring);
      }
      S.push(loft(rings, CK.GLASS, { capStart: true, capEnd: true }));
      // its bronze coaming
      const edge = (sgn) => { const o = []; for (let j = 1; j < 20; j++) { const u = j / 20, t = lerp(0.16, 0.34, u), w = 2.2 * Math.pow(Math.sin(Math.PI * u), 0.45); o.push(V3(sgn * (w + 0.05), hullR(t) - 0.28, zOf(t))); } return o; };
      S.push(tube(edge(1), 0.09, CK.BRONZE, 8), tube(edge(-1), 0.09, CK.BRONZE, 8));
    }
    for (const s of [1, -1]) {
      const a = s > 0 ? 0 : Math.PI;
      S.push(hullStrip(0.3, 0.52, a - 0.2, a + 0.2, CK.GLASS, { nt: 18, na: 6 }));
      S.push(hullStrip(0.56, 0.7, a + s * 0.36 - 0.1, a + s * 0.36 + 0.1, CK.GLASS, { nt: 10, na: 4 }));
    }
    // bronze bands and the spine conduit
    for (const z of [-13.2, -2.4, 10.5, 18.6]) S.push(hullBand(z, 0.7, 0.12, CK.BRONZE));
    {
      const pts = [];
      for (let z = -11; z <= 16; z += 3) pts.push(V3(0, shipHullR(z) + 0.28, z));
      S.push(tube(pts, 0.3, CK.CONDUIT, 12));
      for (let z = -9.5; z <= 15; z += 4.5) S.push(revolve([[0, -0.25, CK.BRONZE], [0.42, -0.25, CK.BRONZE], [0.42, 0.25, CK.BRONZE], [0, 0.25, CK.BRONZE]], 16, { cx: 0, cy: 0 }).translate(0, 0, 0).applyMatrix4(new THREE.Matrix4().makeTranslation(0, shipHullR(z) + 0.28, z)));
    }
    // bearing race for the ring
    S.push(hullBand(1.0, 2.4, 0.35, CK.DARK));

    // ---- stern: thrust frame and three bells
    const zs = zOf(1);
    S.push(revolve([[hullR(1) - 0.05, zs, CK.DARK], [hullR(1) + 0.15, zs + 0.2, CK.DARK], [hullR(1) - 0.2, zs + 1.1, CK.DARK], [2.6, zs + 1.4, CK.DARK], [0, zs + 1.4, CK.DARK]], 48));
    const bells = [];
    this.nozzles = [];
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 2 + (k / 3) * TAU, cx = Math.cos(a) * 2.05, cy = Math.sin(a) * 2.05;
      const prof = [[0.62, zs + 1.2, CK.DARK], [0.7, zs + 1.9, CK.DARK], [0.7, zs + 1.9, CK.BRONZE], [0.98, zs + 2.9, CK.BRONZE], [1.32, zs + 4.1, CK.BRONZE], [1.42, zs + 4.55, CK.BRONZE],
        [1.34, zs + 4.6, CK.DARK], [1.2, zs + 4.1, CK.DARK], [0.86, zs + 2.9, CK.DARK], [0.55, zs + 2.0, CK.DARK], [0.42, zs + 1.6, CK.DARK]];
      bells.push(revolve(prof, 32, { closed: true, cx, cy }));
      this.nozzles.push({ p: V3(cx, cy, zs + 4.3), r: 1.25, dir: V3(0, 0, 1) });
    }
    S.push(...bells);

    // ---- RCS quads, fore and aft
    this.rcs = [];
    for (const z of [-15.5, 15.2]) for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k / 4) * TAU, R = shipHullR(z) + 0.25, c = V3(Math.cos(a) * R, Math.sin(a) * R, z);
      const box = stock(new THREE.BoxGeometry(0.8, 0.8, 1.0), CK.DARK);
      box.applyMatrix4(new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, a)), V3(1, 1, 1)));
      S.push(box);
      for (const d of [V3(0, 0, 1), V3(0, 0, -1), V3(-Math.sin(a), Math.cos(a), 0), V3(Math.sin(a), -Math.cos(a), 0)]) {
        const nz = stock(new THREE.CylinderGeometry(0.08, 0.16, 0.3, 10), CK.BRONZE);
        nz.applyMatrix4(new THREE.Matrix4().compose(c.clone().addScaledVector(d, 0.52), new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d), V3(1, 1, 1)));
        S.push(nz);
        this.rcs.push({ p: c.clone().addScaledVector(d, 0.72), r: 0.35, dir: d.clone() });
      }
    }

    // ---- comms mast and dish, whip antennas
    {
      const z = 7.5, y0 = shipHullR(z) - 0.1;
      S.push(stock(new THREE.CylinderGeometry(0.16, 0.22, 3.2, 12), CK.DARK).translate(0, y0 + 1.6, z));
      const dish = revolve([[0.0, 0.0, CK.DECK], [0.6, 0.08, CK.DECK], [1.2, 0.3, CK.DECK], [1.7, 0.62, CK.DECK], [1.72, 0.66, CK.BRONZE], [1.62, 0.7, CK.BRONZE], [1.1, 0.42, CK.DARK], [0.5, 0.2, CK.DARK], [0.0, 0.14, CK.DARK]], 36);
      dish.applyMatrix4(new THREE.Matrix4().compose(V3(0, y0 + 3.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.55, 0, 0)), V3(1, 1, 1)));
      S.push(dish);
      for (const [x, zz, h] of [[0.9, -6, 2.6], [-0.9, -6, 2.2], [0, 13.5, 1.8]]) S.push(stock(new THREE.CylinderGeometry(0.03, 0.05, h, 6), CK.DARK).translate(x, shipHullR(zz) + h / 2 - 0.05, zz));
    }

    // the merged hull, in metres, scaled into km by the craft mesh
    const hull = craftMesh(merge(S), { accent: [0.5, 0.82, 1.0], lit: 0.7, fill: 0.03, flood: 1 });
    hull.name = 'Lodestar hull';
    this.root.add(hull);
    this.hull = hull;

    // ---- habitat ring (turns): rim with glazed outer face, four spokes, the hub collar
    {
      const R = 12.2, parts = [];
      const sec = (a) => { const o = []; for (let i = 0; i < 20; i++) { const t = (i / 20) * TAU, c = Math.cos(t), s = Math.sin(t); o.push([R + 1.5 * Math.sign(c) * Math.pow(Math.abs(c), 0.7), 1.7 * Math.sign(s) * Math.pow(Math.abs(s), 0.7)]); } return o; };
      const rings = [];
      for (let k = 0; k < 96; k++) { const a = (k / 96) * TAU; rings.push(sec(a).map(([r, zz]) => V3(Math.cos(a) * r, Math.sin(a) * r, 1.0 + zz))); }
      parts.push(loft(rings, CK.HULL, { closeRings: true }));
      // glazed outer rim (a shell just proud of the outer face)
      const gl = [];
      for (let k = 0; k < 96; k++) { const a = (k / 96) * TAU, rr = [R + 1.56, R + 1.56, R + 1.3, R + 1.3], zz = [-1.0, 1.0, 1.0, -1.0]; gl.push(rr.map((r, i) => V3(Math.cos(a) * r, Math.sin(a) * r, 1.0 + zz[i]))); }
      parts.push(loft(gl, CK.GLASS, { closeRings: true }));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + Math.PI / 4;
        const d = V3(Math.cos(a), Math.sin(a), 0);
        parts.push(tube([d.clone().multiplyScalar(5.5).setZ(1.0), d.clone().multiplyScalar(8.5).setZ(1.0), d.clone().multiplyScalar(11.2).setZ(1.0)], 0.55, CK.HULL, 12));
        // a lantern-lit lift car halfway up each spoke
        parts.push(revolve([[0, -0.7, CK.LANTERN], [0.75, -0.7, CK.LANTERN], [0.75, 0.7, CK.LANTERN], [0, 0.7, CK.LANTERN]], 12).applyMatrix4(new THREE.Matrix4().compose(d.clone().multiplyScalar(8.3).setZ(1.0), new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), d), V3(1, 1, 1))));
      }
      parts.push(revolve([[5.05, 0.1, CK.BRONZE], [5.8, 0.1, CK.BRONZE], [5.8, 1.9, CK.BRONZE], [5.05, 1.9, CK.BRONZE]], 64, { closed: true }));
      const ring = craftPart(hull, merge(parts));
      ring.name = 'Lodestar ring';
      hull.add(ring);
      this.movers.ring = ring;
      this.ringLamps = [];
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; this.ringLamps.push({ p: V3(Math.cos(a) * (R + 1.7), Math.sin(a) * (R + 1.7), 1.0), r: 0.28, color: [1.0, 0.82, 0.56], i: 1.6, phase: k / 8 }); }
      addLamps(ring, this.ringLamps, { minPx: 1.2, gain: 0.8 });
    }

    // ---- radiator wings (swing out from the flanks)
    this.movers.radiators = [];
    for (const s of [1, -1]) {
      const hinge = new THREE.Group();
      hinge.position.set(s * (shipHullR(9) + 0.2), 0, 9.2);
      const rad = [];
      const panel = stock(new THREE.BoxGeometry(12, 0.22, 4.4), CK.RADIATOR, 1);
      panel.translate(s * 6.3, 0, -2.6);
      rad.push(panel);
      const boom = stock(new THREE.BoxGeometry(12.6, 0.36, 0.4), CK.BRONZE).translate(s * 6.3, 0, -0.3);
      rad.push(boom);
      const knuckle = revolve([[0, -0.6, CK.DARK], [0.45, -0.6, CK.DARK], [0.45, 0.6, CK.DARK], [0, 0.6, CK.DARK]], 16);
      knuckle.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      rad.push(knuckle);
      const m = craftPart(hull, merge(rad));
      hinge.add(m);
      hull.add(hinge);
      this.movers.radiators.push({ g: hinge, s });
    }

    // ---- landing legs (fold flat along the aft hull)
    this.movers.legs = [];
    for (const [x, z] of [[0, -9], [2.7, 11.6], [-2.7, 11.6]]) {
      const R = shipHullR(z), y = -Math.sqrt(Math.max(R * R - x * x, 0)) + 0.1;
      const hinge = new THREE.Group();
      hinge.position.set(x, y, z);
      hinge.rotation.order = 'ZYX';                  // fold about the leg's own hinge (local X)
      hinge.rotation.z = x ? -Math.sign(x) * 0.28 : 0; // the aft pair splays a little outboard
      const leg = [];
      leg.push(stock(new THREE.CylinderGeometry(0.28, 0.34, 7.2, 12), CK.DARK).translate(0, -3.6, 0));
      leg.push(stock(new THREE.CylinderGeometry(0.2, 0.2, 3.6, 10), CK.BRONZE).translate(0, -6.4, 0));
      leg.push(revolve([[0, -0.2, CK.DARK], [1.05, -0.2, CK.DARK], [1.05, 0.12, CK.DARK], [0.5, 0.35, CK.DARK], [0, 0.4, CK.DARK]], 20).applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2)).translate(0, -8.3, 0));
      const m = craftPart(hull, merge(leg));
      hinge.add(m);
      hull.add(hinge);
      this.movers.legs.push({ g: hinge, out: x ? -0.3 : -0.62 });   // the forward leg stands a little shorter: the ship sits level
    }

    // ---- engines and lights
    this.engines = addEngines(hull, this.nozzles, { scale: 0.95, length: 16, color: 0x86d6ff, core: 0xf2fbff, throttle: 0 });
    this.rcsGlow = createGlowMesh(this.rcs, { color: [0.85, 0.92, 1.0], strength: 0, scale: KM });
    hull.add(this.rcsGlow);
    const lamps = [
      { p: V3(-(shipHullR(-4) + 0.3), 0, -4), r: 0.35, color: [1.0, 0.12, 0.08], i: 2.2 },                     // port
      { p: V3(shipHullR(-4) + 0.3, 0, -4), r: 0.35, color: [0.12, 1.0, 0.35], i: 2.2 },                        // starboard
      { p: V3(0, shipHullR(19) + 0.5, 19.2), r: 0.32, color: [1.0, 1.0, 1.0], i: 1.8 },                         // stern
      { p: V3(0, shipHullR(3) + 0.35, 3), r: 0.4, color: [1.0, 0.1, 0.05], i: 2.4, breathe: 1 },               // beacon, top
      { p: V3(0, -(shipHullR(3) + 0.35), 3), r: 0.4, color: [1.0, 0.1, 0.05], i: 2.4, breathe: 1, phase: 0.5 },// beacon, belly
      { p: V3(0, 0, -25.0), r: 0.3, color: [1.0, 0.86, 0.6], i: 2.0 },                                           // dock light
    ];
    addLamps(hull, lamps, { minPx: 1.3, gain: 1 });
  }

  /** Animate: throttle 0..1, boost 0/1, legs 0..1, rcs activity 0..1, dt seconds. */
  update(dt, s) {
    const st = this.state, k = (r) => 1 - Math.exp(-dt * r);
    st.throttle += (s.throttle - st.throttle) * k(3);
    st.boost += (s.boost - st.boost) * k(2);
    st.legs += (s.legs - st.legs) * k(1.2);
    st.rcs += (s.rcs - st.rcs) * k(10);
    // radiators swing in under hard thrust, out when the drive is quiet
    const radT = 1 - smooth(0.35, 0.8, st.throttle + st.boost * 0.5);
    st.radiators += (radT - st.radiators) * k(0.8);
    for (const r of this.movers.radiators) r.g.rotation.y = -r.s * lerp(1.35, 0.12, st.radiators) + (r.s > 0 ? 0 : 0);
    for (const l of this.movers.legs) l.g.rotation.x = lerp(-1.5, l.out, st.legs);
    this.movers.ring.rotation.z += st.ringRate * dt;
    for (const e of this.engines) e.setThrottle(st.throttle * (1 + 0.5 * st.boost));
    this.rcsGlow.material.uniforms.uStrength.value = st.rcs * 5;
  }
}
