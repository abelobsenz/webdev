import * as THREE from 'three';
import { Builder, KIND as K } from '../buildings.js';
import { mergeClean } from '../geom.js';

// Life on Tidewater's water: the slender lantern boats moored along every canal quay, the
// pontoons of the two marinas at the Grand Canal's mouths (laid either side of the
// navigation channel that runs through each basin), and the lantern posts that mark the
// channel where it meets the sea. Everything here is a closed solid seated on the water
// (hulls float at their waterline) or on the quay at +3 m.

const TAU = Math.PI * 2;
const QY = 3;
export const BOAT_LEN = 11;

// ------------------------------------------------------------------ the boat --
let _boat = null;
/**
 * A Tidewater lantern boat, 11 m long along +x (bow at +x), waterline at y = 0: a slender
 * lofted hull with upswept ends, a timber deck, a glazed canopy aft of midships under a
 * bronze roof, a bronze blade at the bow and a lantern at the stern. Closed manifold hull
 * (tip vertices at stem and stern); the fittings are closed Builder solids.
 */
export function canalBoatGeometry() {
  if (_boat) return _boat;
  const L = BOAT_LEN, n = 18;
  const pos = [], fac = [], idx = [];
  const halfBeam = (u) => 0.95 * Math.pow(Math.sin(Math.PI * u), 0.62);
  const sheer = (u) => 0.62 + 0.95 * Math.pow(Math.abs(2 * u - 1), 5);
  const keel = (u) => -0.42 * Math.pow(Math.sin(Math.PI * u), 0.5);
  // section, anticlockwise seen from the bow: deck crown, deck edge, waterline, bilge, keel ...
  const section = (u) => {
    const b = halfBeam(u), s = sheer(u), k = keel(u);
    return [[s + 0.04, 0, K.TIMBER], [s, b, K.TIMBER], [0.05, b * 1.02, K.STONE], [k * 0.72, b * 0.62, K.STONE], [k, 0, K.STONE], [k * 0.72, -b * 0.62, K.STONE], [0.05, -b * 1.02, K.STONE], [s, -b, K.TIMBER]];
  };
  const m = 8;
  for (let i = 1; i < n; i++) {
    const u = i / n, x = -L / 2 + L * u;
    for (const [y, z, kind] of section(u)) { pos.push(x, y, z); fac.push(x, y, kind); }
  }
  const ring = (i) => (i - 1) * m;
  for (let i = 1; i < n - 1; i++) for (let j = 0; j < m; j++) {
    const a = ring(i) + j, b = ring(i) + (j + 1) % m, c = ring(i + 1) + j, d = ring(i + 1) + (j + 1) % m;
    idx.push(a, c, b, b, c, d);
  }
  // stem and stern tips, each closing its end ring with a fan
  for (const [u, first] of [[0, true], [1, false]]) {
    const t = pos.length / 3;
    pos.push(-L / 2 + L * u, sheer(u) * 0.96, 0); fac.push(0, 0, K.STONE);
    const r = first ? ring(1) : ring(n - 1);
    for (let j = 0; j < m; j++) { const a = r + j, b = r + (j + 1) % m; if (first) idx.push(t, a, b); else idx.push(t, b, a); }
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  hull.setIndex(idx);
  // The quads and both tip fans share one winding by construction; turn the whole shell
  // outward if its signed volume says it was built inside out.
  {
    const P = hull.attributes.position, I = hull.index.array;
    let vol = 0;
    const A = new THREE.Vector3(), Bv = new THREE.Vector3(), C = new THREE.Vector3();
    for (let f = 0; f < I.length; f += 3) {
      A.fromBufferAttribute(P, I[f]); Bv.fromBufferAttribute(P, I[f + 1]); C.fromBufferAttribute(P, I[f + 2]);
      vol += A.dot(Bv.clone().cross(C)) / 6;
    }
    if (vol < 0) for (let f = 0; f < I.length; f += 3) { const tmp = I[f + 1]; I[f + 1] = I[f + 2]; I[f + 2] = tmp; }
  }
  hull.computeVertexNormals();
  // fittings (closed solids): canopy, roof, bow blade, stern lantern
  const B = new Builder(1 << 10);
  B.frame(0, 0, 0, 0);
  const deck = sheer(0.5);
  B.box(-2.6, 0.4, -0.62, 0.62, deck - 0.02, deck + 1.05, K.GLASS, K.METAL);
  B.vault(-2.75, 0.55, -0.72, 0.72, deck + 1.05, 0.34, K.METAL, 6);
  B.box(L / 2 - 0.55, L / 2 - 0.25, -0.05, 0.05, sheer(0.975) - 0.05, sheer(1) + 0.55, K.METAL, K.METAL);
  B.box(-L / 2 + 0.55, -L / 2 + 0.85, -0.05, 0.05, sheer(0.05) - 0.05, sheer(0.05) + 0.7, K.METAL, K.METAL);
  B.box(-L / 2 + 0.5, -L / 2 + 0.9, -0.2, 0.2, sheer(0.05) + 0.7, sheer(0.05) + 1.1, K.LANTERN, K.METAL);
  _boat = mergeClean([hull, B.geometry()]);
  return _boat;
}

// ---------------------------------------------------------- mooring the boats --
/**
 * Berths along the canal quays of a ward: boats lie 2.6 m off the quay kerb, parallel to
 * it, in water at least 12 m wide, never under or beside a bridge, in a marina, near the
 * sea mouths or within 15 m of another boat (so a narrow rio keeps one bank for moorings
 * and the other for passage). Returns [{ x, z, rot, len }] in world coordinates.
 */
export function canalBerths(rec, P, G, rnd) {
  const w = rec.w, sea = rec.sea, out = [];
  const bridges = P.bridges.map((b) => ({ a: b.a, b: b.b, r: b.hw + 9 }));
  const segDist = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9; let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); };
  const basins = rec.ctx.features.basins || [];
  const inBasin = (x, z) => basins.some((bs) => { const c = Math.cos(bs.rot || 0), s = Math.sin(bs.rot || 0), dx = x - bs.x, dz = z - bs.z; return Math.abs(dx * c + dz * s) < (bs.hw ?? bs.r) + 30 && Math.abs(-dx * s + dz * c) < (bs.hd ?? bs.r) + 30; });
  const stairs = (G.quayStairs || []).map((f) => f.p);
  const grid = new Map(), GS = 20;
  const near = (x, z, r) => { for (let i = Math.floor((x - r) / GS); i <= Math.floor((x + r) / GS); i++) for (let j = Math.floor((z - r) / GS); j <= Math.floor((z + r) / GS); j++) for (const q of grid.get(`${i},${j}`) || []) if (Math.hypot(q.x - x, q.z - z) < r) return true; return false; };
  for (const loop of G.seaLoops || []) {
    const n = loop.length;
    let gap = 8 + rnd() * 20;
    for (let k = 0; k < n; k++) {
      const p = loop[k], q = loop[(k + 1) % n];
      const seg = Math.hypot(q[0] - p[0], q[1] - p[1]);
      gap -= seg;
      if (gap > 0) continue;
      // local frame from a wider chord (the contour is jagged at the 5 m grid scale)
      const a = loop[(k - 3 + n) % n], b = loop[(k + 3) % n];
      const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1;
      const t = [tx / tl, tz / tl];
      let nx = t[1], nz = -t[0];
      if (sea.sample(p[0] + nx * 4, p[1] + nz * 4) < sea.sample(p[0] - nx * 4, p[1] - nz * 4)) { nx = -nx; nz = -nz; }
      const x = p[0] + nx * 2.6, z = p[1] + nz * 2.6, len = 9.5 + rnd() * 3;
      const ok = Math.hypot(x, z) < rec.R(Math.atan2(z, x)) - 70
        && [-len / 2, 0, len / 2].every((u) => sea.sample(x + t[0] * u, z + t[1] * u) > 1.6)
        && sea.sample(x + nx * 9.5, z + nz * 9.5) > 0.5
        && !inBasin(x, z)
        && !bridges.some((br) => segDist(x, z, br.a, br.b) < br.r + len / 2)
        && !stairs.some((s) => Math.hypot(s[0] - x, s[1] - z) < 18)
        && !near(x, z, 15 + len / 2);
      if (!ok) { gap = 3; continue; }
      const key = `${Math.floor(x / GS)},${Math.floor(z / GS)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push({ x, z });
      out.push({ x: w.x + x, z: w.z + z, rot: Math.atan2(t[1], t[0]), len });
      // berths come in small groups with open water between them
      gap = rnd() < 0.62 ? len + 3 + rnd() * 5 : len + 30 + rnd() * 70;
    }
  }
  return out;
}

/** Instanced boats (world coordinates), scaled from the 11 m master hull. */
export function boatInstances(list, material, name) {
  const mesh = new THREE.InstancedMesh(canalBoatGeometry(), material, list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((b, i) => {
    q.setFromAxisAngle(up, -b.rot);
    const s = b.len / BOAT_LEN;
    m4.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(i, m4);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// -------------------------------------------------------------- the marinas --
/**
 * Pontoons for a basin crossed by a navigation channel (the Grand Canal runs through
 * Tidewater's marinas): a spine along each side of the channel with fingers reaching
 * toward the basin's long quays, boats berthed between the fingers, and a gangway from each
 * spine's inner end up to the quay. The channel itself stays clear from end to end.
 */
export function channelMarina(B, bs, rec, rnd, boats) {
  const w = rec.w;
  const c = Math.cos(bs.rot || 0), s = Math.sin(bs.rot || 0);
  const Wp = (u, v) => [w.x + bs.x + u * c - v * s, w.z + bs.z + u * s + v * c];
  const Lp = (u, v) => [bs.x + u * c - v * s, bs.z + u * s + v * c];
  const ch = bs.channel + 9, hw = bs.hw - 14, reach = bs.hd - 12;
  const box = (u0, u1, v0, v1, y0, y1, kind, top = K.TIMBER) => {
    const q = [Wp(u0, v0), Wp(u1, v0), Wp(u1, v1), Wp(u0, v1)];
    const cxp = (q[0][0] + q[2][0]) / 2, czp = (q[0][1] + q[2][1]) / 2;
    const rot = Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]);
    B.frame(cxp, 0, czp, -rot);
    B.box(-(u1 - u0) / 2, (u1 - u0) / 2, -(v1 - v0) / 2, (v1 - v0) / 2, y0, y1, kind, top);
  };
  const water = (u, v) => rec.sea.sample(...Lp(u, v)) > 1.2;
  for (const sv of [-1, 1]) {
    // the spine: only where the whole run lies in the basin's water
    let u0 = -hw, u1 = hw;
    while (u0 < u1 && !(water(u0, sv * ch) && water(u0, sv * (ch + 2)))) u0 += 2;
    while (u1 > u0 && !(water(u1, sv * ch) && water(u1, sv * (ch + 2)))) u1 -= 2;
    if (u1 - u0 < 30) continue;
    box(u0, u1, sv > 0 ? ch - 1.3 : -ch - 1.3, sv > 0 ? ch + 1.3 : -ch + 1.3, -0.4, 0.8, K.STONE);
    for (let u = u0 + 5; u < u1 - 4; u += 10) {
      const v0 = sv * (ch + 1.3), v1 = sv * reach;
      if (!water(u, v1) || !water(u + 0.7, v1)) continue;
      box(u - 0.7, u + 0.7, Math.min(v0, v1), Math.max(v0, v1), -0.4, 0.75, K.STONE);
      if (u + 5 < u1 - 4 && rnd() < 0.85) {
        const len = 9 + rnd() * 3.5;
        const p = Wp(u + 5, sv * (ch + 1.3 + (reach - ch - 1.3) * 0.5));
        boats.push({ x: p[0], z: p[1], rot: (bs.rot || 0) + Math.PI / 2 * sv, len: Math.min(len, reach - ch - 4) });
      }
    }
    // a gangway at the spine's inner end, climbing to the quay beside the basin wall
    const g0 = u0 - 1, g1 = u0 - 13;
    if (!water(g0, sv * ch)) continue;
    let end = g0;
    while (end > g1 && water(end, sv * ch)) end -= 0.5;
    const quayU = end - 1.0;                       // 1 m onto the quay beyond the wall line
    const steps = 8;
    for (let k = 0; k < steps; k++) {
      const a = g0 + ((quayU - g0) * k) / steps, b = g0 + ((quayU - g0) * (k + 1)) / steps;
      box(Math.min(a, b), Math.max(a, b), sv * ch - 1.1, sv * ch + 1.1, -0.1, 0.8 + ((QY + 0.02 - 0.8) * (k + 1)) / steps, K.METAL, K.TIMBER);
    }
  }
  B.frame(0, 0, 0, 0);
}

/**
 * Channel lanterns: a bronze post with a lantern on each quay corner where the channel
 * leaves the basin for the sea (green to starboard, red to port on the way in), founded
 * on the quay; returns the light points for the ward's signal lights.
 */
export function channelLanterns(B, bs, rec) {
  const w = rec.w, c = Math.cos(bs.rot || 0), s = Math.sin(bs.rot || 0);
  const Lp = (u, v) => [bs.x + u * c - v * s, bs.z + u * s + v * c];
  const lights = [];
  for (const sv of [-1, 1]) {
    // walk out along the channel edge until the quay beside it ends at the sea
    let best = null;
    for (let u = bs.hw - 10; u < bs.hw + 160; u += 2) {
      const v = sv * (bs.channel + 3.5);
      const p = Lp(u, v);
      const onQuay = rec.sea.sample(p[0], p[1]) < -1.2 && rec.levels[0].grid.sample(p[0], p[1]) > 1.2;
      if (onQuay) best = p; else if (best) break;
    }
    if (!best) continue;
    B.frame(w.x + best[0], QY, w.z + best[1], 0);
    B.lathe(0, 0, [[0.9, -0.2, K.STONE], [0.9, 0.5, K.STONE], [0.35, 0.5, K.METAL], [0.22, 5.2, K.METAL], [0.42, 5.4, K.METAL], [0.42, 6.3, K.LANTERN], [0.05, 6.8, K.METAL]], 10);
    lights.push({ x: w.x + best[0], y: QY + 5.85, z: w.z + best[1], c: sv > 0 ? [0.25, 1.0, 0.45] : [1.0, 0.22, 0.12], s: 1.6 });
  }
  B.frame(0, 0, 0, 0);
  return lights;
}
