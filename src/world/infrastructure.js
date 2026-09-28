import * as THREE from 'three';
import { latheFacade, sweepTube, mergeClean } from './geom.js';
import { createFacadeMaterial } from './facade.js';
import { ISLANDS, GATE, SKYPORT, PLAZA_Y, promenadeAxis } from './layout.js';
import { mulberry32 } from './noise.js';
import { U } from '../core/uniforms.js';

const TAU = Math.PI * 2;

/** Extrude a 2D cross-section (in side/up coordinates) along a path with a world-up frame. */
export function extrudeAlong(path, section, kindFn) {
  const pos = [], fac = [], idx = [];
  const n = section.length;
  let len = 0;
  const up = new THREE.Vector3(0, 1, 0);
  for (let j = 0; j < path.length; j++) {
    const a = path[Math.max(j - 1, 0)], b = path[Math.min(j + 1, path.length - 1)];
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    const side = new THREE.Vector3().crossVectors(t, up).normalize();
    const u2 = new THREE.Vector3().crossVectors(side, t).normalize();
    if (j > 0) len += path[j].distanceTo(path[j - 1]);
    let per = 0;
    for (let i = 0; i <= n; i++) {
      const s = section[i % n];
      if (i > 0) { const q = section[i - 1]; per += Math.hypot(s[0] - q[0], s[1] - q[1]); }
      const p = path[j];
      pos.push(p.x + side.x * s[0] + u2.x * s[1], p.y + side.y * s[0] + u2.y * s[1], p.z + side.z * s[0] + u2.z * s[1]);
      const kind = kindFn ? kindFn(i % n) : 1;
      fac.push(len, kind === 15 ? s[0] : per, kind);
    }
  }
  const cols = n + 1;
  for (let j = 0; j < path.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------ promenades --
export function frameAt(path, k) {
  const a = path[Math.max(k - 1, 0)], b = path[Math.min(k + 1, path.length - 1)];
  const t = new THREE.Vector3().subVectors(b, a).normalize();
  const side = new THREE.Vector3(-t.z, 0, t.x).normalize();
  return { t, side };
}

/** A gateway astride the deck: two tapered pylons joined by a shallow arch with a lantern. */
function portal(parts, p, side, base) {
  const h = 13.5, half = 15.8;
  for (const s of [-1, 1]) {
    const c = p.clone().addScaledVector(side, s * half);
    const pyl = latheFacade([
      { r: 1.9, y: base - 1, kind: 1 }, { r: 1.7, y: base + 1.2, kind: 1 }, { r: 1.2, y: base + h * 0.72, kind: 1 },
      { r: 1.35, y: base + h * 0.74, kind: 2 }, { r: 1.2, y: base + h * 0.8, kind: 1 }, { r: 0.35, y: base + h, kind: 1 }, { r: 0.05, y: base + h + 1.5, kind: 1 },
    ], 12);
    pyl.translate(c.x, 0, c.z);
    parts.push(pyl);
  }
  const arc = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    const x = -half + 2 * half * u;
    arc.push(p.clone().addScaledVector(side, x).add(new THREE.Vector3(0, base + h * 0.78 + 3.2 * Math.sin(Math.PI * u), 0)));
  }
  parts.push(sweepTube(arc, () => 0.55, 8, { kind: 1 }));
  parts.push(sweepTube(arc.map((q) => q.clone().add(new THREE.Vector3(0, -0.75, 0))), () => 0.2, 6, { kind: 2 }));
}

/** Build a grid surface from a function (u, v) -> [x, y, z] with a constant facade kind. */
function gridSurface(nu, nv, fn, kind, facScale = [1, 1]) {
  const pos = [], fac = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const p = fn(i / nu, j / nv);
    pos.push(p[0], p[1], p[2]);
    fac.push((i / nu) * facScale[0], (j / nv) * facScale[1], kind);
  }
  const cols = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * cols + i;
    idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A maglev terminal: a luminous glass seed-pod wrapped in bone-white ribs, two
 * cantilevered garden "petals" sheltering the platforms, a glowing portal ring where
 * the line enters, all on a paved plinth. c = centre at platform level, t = track
 * direction (unit, horizontal), side = horizontal normal, entry = +1/-1 (which end the
 * line comes in), groundLo = lowest ground under it.
 */
function station(parts, c, t, side, base, entry, groundLo) {
  const L = 66, W = 11.5, H = 12.5;
  const up = new THREE.Vector3(0, 1, 0);
  const P = (u, x, y) => c.clone().addScaledVector(t, u).addScaledVector(side, x).setY(base + y);
  const pod = (s) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), 2.4)), 0.42);
  // plinth: a rounded-rectangle (superellipse) platform
  const plinth = latheFacade([{ r: 1, y: groundLo - base - 1.5, kind: 1 }, { r: 1, y: 0.0, kind: 1 }, { r: 0.97, y: 0.0, kind: 9 }, { r: 0.001, y: 0.0, kind: 9 }], 32);
  {
    const pp = plinth.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      const r = Math.hypot(x, z);
      const a = Math.atan2(z, x);
      const ca = Math.cos(a), sa = Math.sin(a);
      const k = Math.pow(Math.pow(Math.abs(ca), 4) + Math.pow(Math.abs(sa), 4), -0.25);
      const lu = ca * k * (L / 2 + 6) * r, lx = sa * k * 17 * r;
      const q = P(lu, lx, y);
      pp.setXYZ(i, q.x, q.y, q.z);
    }
    plinth.computeVertexNormals();
    parts.push(plinth);
  }
  // the glass pod (kind 2 glows softly at night)
  parts.push(gridSurface(40, 16, (iu, iv) => {
    const s = iu * 2 - 1, a = iv * Math.PI;
    const f = pod(s);
    return P(s * L / 2, Math.cos(a) * W * f, 0.4 + Math.pow(Math.sin(a), 0.85) * H * f).toArray();
  }, 14, [L, 30]));
  // ribs: bone-white arches, fanning slightly toward the nose
  for (let k = -7; k <= 7; k++) {
    const s = k / 7.6;
    const f = pod(s) * 1.07 + 0.02;
    const arc = [];
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI;
      arc.push(P(s * L / 2 + Math.cos(a) * 1.2 * s, Math.cos(a) * (W * f + 0.5), 0.2 + Math.pow(Math.sin(a), 0.85) * (H * f + 0.5)));
    }
    parts.push(sweepTube(arc, (u) => 0.42 + 0.25 * Math.abs(u - 0.5), 8, { kind: 1 }));
  }
  // spine and ground beams
  const spine = [], beamL = [], beamR = [];
  for (let i = 0; i <= 30; i++) {
    const s = (i / 30) * 2 - 1;
    const f = pod(s) * 1.07 + 0.02;
    spine.push(P(s * L / 2 * 1.02, 0, 0.2 + H * f + 0.6));
    beamL.push(P(s * L / 2 * 0.96, -(W * f + 0.5), 0.5));
    beamR.push(P(s * L / 2 * 0.96, W * f + 0.5, 0.5));
  }
  parts.push(sweepTube(spine, (u) => 0.55 * Math.sin(Math.PI * u) + 0.1, 8, { kind: 1 }));
  parts.push(sweepTube(beamL, () => 0.5, 6, { kind: 1 }), sweepTube(beamR, () => 0.5, 6, { kind: 1 }));
  // petals: leaf-shaped cantilever canopies, planted on top, curling up at the tips
  for (const sd of [-1, 1]) {
    const len = L * 0.62, reach = 12;
    const leaf = (iu, iv, y0) => {
      const s = iu * 2 - 1;
      const wv = Math.pow(Math.max(0, 1 - s * s), 0.7) * reach;
      const v = iv * wv;
      const x = sd * (W * pod(s * 0.62) * 0.95 + v);
      return P(s * len / 2 + sd * 2, x, y0 + 1.6 * Math.pow(v / reach, 2) + 0.6 * Math.sin(Math.PI * iv) * (1 - s * s)).toArray();
    };
    parts.push(gridSurface(24, 6, (iu, iv) => leaf(iu, iv, 7.2), 3, [len, reach]));
    parts.push(gridSurface(24, 6, (iu, iv) => leaf(1 - iu, iv, 6.7), 1, [len, reach]));
    // slender struts under each petal
    for (const s of [-0.55, 0, 0.55]) {
      const wv = Math.pow(1 - s * s, 0.7) * reach * 0.7;
      const top = P(s * len / 2 + sd * 2, sd * (W * pod(s * 0.62) * 0.95 + wv), 6.8 + 1.6 * 0.49);
      const foot = P(s * len / 2, sd * (W * pod(s * 0.62) * 0.95 + 1.5), 0.0);
      parts.push(sweepTube([foot, foot.clone().lerp(top, 0.5).add(new THREE.Vector3(0, 0.6, 0)), top], (u) => 0.28 - 0.1 * u, 6, { kind: 1 }));
    }
  }
  // portal ring where the line enters the pod
  const ring = [];
  const rc = P(entry * L / 2 * 0.99, 0, 2.6);
  const ax2 = side.clone(), ay2 = up.clone();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * TAU;
    ring.push(rc.clone().addScaledVector(ax2, Math.cos(a) * 4.6).addScaledVector(ay2, Math.sin(a) * 4.6));
  }
  parts.push(sweepTube(ring, () => 0.45, 8, { kind: 2 }));
  // light column at the far nose: a beacon to walk toward
  const nose = P(-entry * (L / 2 + 3.5), 0, 0);
  const lc = latheFacade([{ r: 1.1, y: 0, kind: 1 }, { r: 0.8, y: 1.2, kind: 1 }, { r: 0.45, y: 9, kind: 4 }, { r: 0.7, y: 9.6, kind: 2 }, { r: 0.05, y: 10.4, kind: 1 }], 12);
  lc.translate(nose.x, base, nose.z);
  parts.push(lc);
}

function buildPromenades(groundHeight) {
  const parts = [];
  const paths = [];
  const lamps = [];
  const stations = [];
  // Deck cross-section [side, up, facade kind], wound so its faces point outward: sculpted
  // parapets with a glowing crest, a clipped hedge along each side (the lamps stand in it) and
  // a paved walkway between (kind 15: its facade v is the lateral offset from the deck's axis).
  // Points repeat where the kind changes so every face has one kind.
  const deckSection = [
    [-14.0, 0.0, 1], [-14.5, 1.2, 1], [-14.5, 1.2, 2], [-13.6, 1.4, 2], [-13.6, 1.4, 1], [-13.0, 0.75, 1],
    [-13.0, 0.75, 3], [-12.8, 1.45, 3], [-11.8, 1.62, 3], [-10.85, 1.45, 3], [-10.6, 0.75, 3], [-10.6, 0.75, 1], [-10.4, 0.2, 1],
    [-10.4, 0.2, 15], [10.4, 0.2, 15],
    [10.4, 0.2, 1], [10.6, 0.75, 1], [10.6, 0.75, 3], [10.85, 1.45, 3], [11.8, 1.62, 3], [12.8, 1.45, 3], [13.0, 0.75, 3],
    [13.0, 0.75, 1], [13.6, 1.4, 1], [13.6, 1.4, 2], [14.5, 1.2, 2], [14.5, 1.2, 1], [14.0, 0.0, 1],
    [11.0, -3.2, 1], [-11.0, -3.2, 1],
  ];
  const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  for (const isl of ISLANDS) {
    const ax = promenadeAxis(isl);
    const dir = new THREE.Vector2(ax.dir.x, ax.dir.z);
    const perp = new THREE.Vector2(-dir.y, dir.x);
    const { start, end } = ax;
    const gL = groundHeight(ax.landing.x, ax.landing.z);
    const path = [];
    const N = 150;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const d = start + (end - start) * t;
      // lateral S-curve with zero offset and zero slope at both ends, so the deck meets
      // the plaza radially and lands square on the island's main avenue
      const sway = 70 * Math.sin(2 * Math.PI * t) * Math.sin(Math.PI * t);
      const x = dir.x * d + perp.x * sway, z = dir.y * d + perp.y * sway;
      const g0 = groundHeight(x, z);
      // the walking surface (path + 0.2) starts 35 cm proud of the plaza, a raised
      // promenade with its own kerb step: starting flush, it rose so gently that deck and
      // plaza stayed coplanar for tens of metres and z-fought
      let y = (PLAZA_Y + 0.15) * (1 - t) + (gL + 0.05) * t + 28 * Math.sin(Math.PI * t) + 5 * ss(0, 0.06, t) * (1 - ss(0.78, 1, t));
      if (t < 0.9) y = Math.max(y, g0 + 6);
      else y = Math.max(y, g0 + 0.2 + 5.8 * ss(1, 0.9, t));
      path.push(new THREE.Vector3(x, y, z));
    }
    paths.push(path);
    parts.push(extrudeAlong(path, deckSection, (i) => deckSection[i][2]));
    // maglev tube along the outer edge
    // (it swings out from 17 m to 30 m off the deck axis near each end, into its terminal)
    const tube = path.map((p, i) => {
      const t = i / N;
      const lat = 17 + 13 * (ss(0.1, 0.0, t) + ss(0.9, 1.0, t));
      return p.clone().addScaledVector(frameAt(path, i).side, lat).add(new THREE.Vector3(0, 2.5, 0));
    });
    parts.push(sweepTube(tube, () => 3.0, 12, { kind: 13 }));
    // piers with lotus capitals where the deck flies
    for (let k = 6; k < N - 3; k += 10) {
      const p = path[k];
      const base = groundHeight(p.x, p.z);
      if (base > p.y - 8) continue;
      const pier = latheFacade([
        { r: 7, y: -14, kind: 1 }, { r: 5.5, y: base + 0, kind: 1 }, { r: 3.6, y: p.y * 0.6, kind: 1 },
        { r: 5, y: p.y - 7, kind: 1 }, { r: 12, y: p.y - 3.4, kind: 1 },
      ].map((q) => ({ ...q, y: Math.max(q.y, -14) })), 16);
      pier.translate(p.x, 0, p.z);
      parts.push(pier);
    }
    // gateways at both ends, stations where the tube comes down
    const f0 = frameAt(path, 3), f1 = frameAt(path, N - 2);
    portal(parts, path[3], f0.side, path[3].y + 0.2);
    portal(parts, path[N - 1], f1.side, path[N - 1].y + 0.2);
    // terminals: the line runs into the pod through its portal ring. On the plaza the
    // pod sits on the paving beside the deck; on the island it sits on the landing
    // square's platform, with the pod reaching on into town.
    {
      const e0 = tube[1].clone().setY(0), c0 = e0.clone().addScaledVector(f0.t, -(33 - 5));
      // on a 30 cm plinth, never flush with the plaza paving (coplanar tops z-fought)
      station(parts, c0, f0.t, f0.side, PLAZA_Y + 0.3, 1, PLAZA_Y - 4);
      stations.push({ x: c0.x, z: c0.z, r: 42, y: PLAZA_Y + 0.3, end: 'plaza', island: isl.id });
      const e1 = tube[N - 1].clone().setY(0), c1 = e1.clone().addScaledVector(f1.t, 33 - 5);
      let lo = 1e9, hi = -1e9;
      for (let u = -40; u <= 40; u += 8) for (let v = -18; v <= 18; v += 6) {
        const g = groundHeight(c1.x + f1.t.x * u + f1.side.x * v, c1.z + f1.t.z * u + f1.side.z * v);
        lo = Math.min(lo, g); hi = Math.max(hi, g);
      }
      const base1 = Math.max(hi, path[N].y) + 0.6;
      station(parts, c1, f1.t, f1.side, base1, -1, lo);
      stations.push({ x: c1.x, z: c1.z, r: 42, y: base1, end: 'island', island: isl.id });
    }
    // deck lamps, staggered along both parapets
    let acc = 0;
    for (let k = 1; k <= N; k++) {
      acc += path[k].distanceTo(path[k - 1]);
      if (acc < 26) continue;
      acc = 0;
      const { side } = frameAt(path, k);
      const s = (k & 1) ? 1 : -1;
      const p = path[k].clone().addScaledVector(side, s * 12.3);
      lamps.push({ x: p.x, y: path[k].y + 0.2, z: p.z, yaw: Math.atan2(-side.x * s, -side.z * s), cls: 4 });
    }
  }
  return { geo: mergeClean(parts), paths, lamps, stations };
}

// ------------------------------------------------------- closed solids --
// The Gate and the skyport are built of closed solids: sections swept along a path, lathes and
// six-faced slabs, with crisp creases, seam-free normals, capped ends and facade coordinates in
// metres.

function solidGeo(pos, nor, fac, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Sweep a closed cross-section along a path. frame(j) -> { p, t, s, n } (unit vectors, s x n = t)
 * places station j; outline(j) -> its section as a CCW polygon [[s, n, kind], ...] (the kind is
 * that of the edge leaving the point; the same point count at every station). Corners sharper
 * than `crease` are crisp, the rest smooth, and the normals come from the swept surface itself
 * (taper included), so no seam shows anywhere. The facade runs round the section (`sec` may remap
 * it) and along the path (`v`: per-station values, default metres); `swap` exchanges the two.
 * Open paths are capped at both ends (kind capKind); `loop` closes the path on itself.
 */
function sweepSolid(count, frame, outline, { loop = false, crease = 0.6, capKind = 1, v = null, sec = null, swap = false } = {}) {
  const F = [], O = [];
  for (let j = 0; j < count; j++) { F.push(frame(j)); O.push(outline(j)); }
  const m = O[0].length, mid = O[count >> 1];
  // strips: the outline splits at crisp corners (judged at the middle station) and at kind changes
  const hard = new Uint8Array(m), cut = new Uint8Array(m);
  for (let i = 0; i < m; i++) {
    const p = mid[(i + m - 1) % m], q = mid[i], r = mid[(i + 1) % m];
    const d = Math.atan2(r[1] - q[1], r[0] - q[0]) - Math.atan2(q[1] - p[1], q[0] - p[0]);
    hard[i] = cut[i] = Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) > crease ? 1 : 0;
    for (let j = 0; j < count && !cut[i]; j++) if (O[j][i][2] !== O[j][(i + m - 1) % m][2]) cut[i] = 1;
  }
  if (!cut.includes(1)) cut[0] = 1;
  const starts = [];
  for (let i = 0; i < m; i++) if (cut[i]) starts.push(i);
  const rows = loop ? count + 1 : count;
  const V = v ? v.slice() : [0];
  if (!v) for (let r = 1; r < rows; r++) V.push(V[r - 1] + F[r % count].p.distanceTo(F[r - 1].p));
  const X = O.map((o, j) => o.map(([s, n]) => F[j].p.clone().addScaledVector(F[j].s, s).addScaledVector(F[j].n, n)));
  const P = O.map((o) => { const c = [0]; for (let i = 1; i <= m; i++) c.push(c[i - 1] + Math.hypot(o[i % m][0] - o[i - 1][0], o[i % m][1] - o[i - 1][1])); return c; });
  const edgeN = (o, i) => { const a = o[i], b = o[(i + 1) % m], ds = b[0] - a[0], dn = b[1] - a[1], l = Math.hypot(ds, dn) || 1; return [dn / l, -ds / l]; };
  const pos = [], nor = [], fac = [], idx = [];
  const ts = new THREE.Vector3(), dp = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let k = 0; k < starts.length; k++) {
    const i0 = starts[k], i1 = k + 1 < starts.length ? starts[k + 1] : starts[0] + m;
    const cols = i1 - i0 + 1, base = pos.length / 3;
    for (let r = 0; r < rows; r++) {
      const j = r % count, o = O[j], f = F[j], kind = o[i0][2];
      const jp = loop ? (j + 1) % count : Math.min(j + 1, count - 1), jm = loop ? (j + count - 1) % count : Math.max(j - 1, 0);
      const cum = (ii) => (ii < m ? P[j][ii] : P[j][m] + P[j][ii - m]);
      const ua = cum(i0), ub = cum(i1);
      for (let c = 0; c < cols; c++) {
        const i = (i0 + c) % m;
        const eP = edgeN(o, (i + m - 1) % m), eN = edgeN(o, i);
        let n2;
        if (c === 0 && hard[i]) n2 = eN;
        else if (c === cols - 1 && hard[i]) n2 = eP;
        else { const x = eP[0] + eN[0], y = eP[1] + eN[1], l = Math.hypot(x, y) || 1; n2 = [x / l, y / l]; }
        // normal = (section tangent) x (path direction at this vertex)
        ts.copy(f.s).multiplyScalar(-n2[1]).addScaledVector(f.n, n2[0]);
        nn.crossVectors(ts, dp.subVectors(X[jp][i], X[jm][i]));
        if (!(nn.lengthSq() > 1e-18)) nn.copy(f.s).multiplyScalar(n2[0]).addScaledVector(f.n, n2[1]);
        nn.normalize();
        const q = X[j][i];
        pos.push(q.x, q.y, q.z);
        nor.push(nn.x, nn.y, nn.z);
        const u = sec ? sec({ s: o[i][0], n: o[i][1], kind, cum: cum(i0 + c), a: ua, b: ub, i0 }) : cum(i0 + c);
        if (swap) fac.push(V[r], u, kind); else fac.push(u, V[r], kind);
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const A = base + r * cols + c, B = A + 1, C = A + cols, D = C + 1;
        idx.push(A, B, C, B, D, C);
      }
    }
  }
  if (!loop) {
    for (const end of [false, true]) {
      const j = end ? count - 1 : 0, o = O[j], t = F[j].t, sg = end ? 1 : -1, b = pos.length / 3;
      for (let i = 0; i < m; i++) { const q = X[j][i]; pos.push(q.x, q.y, q.z); nor.push(t.x * sg, t.y * sg, t.z * sg); fac.push(o[i][0], o[i][1], capKind); }
      for (const [p0, p1, p2] of THREE.ShapeUtils.triangulateShape(o.map((q) => new THREE.Vector2(q[0], q[1])), [])) {
        const ar = (o[p1][0] - o[p0][0]) * (o[p2][1] - o[p0][1]) - (o[p1][1] - o[p0][1]) * (o[p2][0] - o[p0][0]);
        if ((ar > 0) === end) idx.push(b + p0, b + p1, b + p2); else idx.push(b + p0, b + p2, b + p1);
      }
    }
  }
  return solidGeo(pos, nor, fac, idx);
}

/**
 * Closed lathe: `profile` [{ r, y, kind }] runs from the axis round the outside and back with
 * the solid on its left (out along the bottom, up the wall, in over the top); each point's kind
 * is that of the segment leaving it. Corners sharper than `crease` are crisp, zero radii close as
 * fans, and the normals are analytic (no seam); sx/sz stretch the plan into an ellipse. u runs
 * round (metres, snapped so the facade's 16 m rhythm closes), v up a wall or out across a flat.
 */
function latheSolid(profile, seg = 48, { sx = 1, sz = 1, crease = 0.6, phase = 0 } = {}) {
  const n = profile.length, SN = [];
  for (let j = 0; j < n - 1; j++) {
    const p = profile[j], q = profile[j + 1], dr = q.r - p.r, dy = q.y - p.y, l = Math.hypot(dr, dy) || 1;
    SN.push([dy / l, -dr / l]);
  }
  const vN = (j, k) => {       // normal of segment j at its profile point k (j or j + 1)
    const o = k === j ? j - 1 : j + 1;
    if (o < 0 || o >= n - 1) return SN[j];
    const a = SN[j], b = SN[o];
    if (Math.acos(THREE.MathUtils.clamp(a[0] * b[0] + a[1] * b[1], -1, 1)) > crease) return a;
    const x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };
  const pos = [], nor = [], fac = [], idx = [];
  const cols = seg + 1;
  for (let j = 0; j < n - 1; j++) {
    const p = profile[j], q = profile[j + 1], kind = p.kind ?? 1;
    if (Math.hypot(q.r - p.r, q.y - p.y) < 1e-9) continue;
    const rm = (p.r + q.r) / 2, steep = Math.abs(q.y - p.y) >= Math.abs(q.r - p.r);
    const rU = rm > 4 ? (Math.round((TAU * rm) / 16) * 16) / TAU : Math.max(rm, 1);
    const base = pos.length / 3;
    for (const [pt, k] of [[p, j], [q, j + 1]]) {
      const [nr, ny] = vN(j, k);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU + phase, c = Math.cos(a), s = Math.sin(a);
        pos.push(c * pt.r * sx, pt.y, s * pt.r * sz);
        const x = (nr * c) / sx, z = (nr * s) / sz, l = Math.hypot(x, ny, z) || 1;
        nor.push(x / l, ny / l, z / l);
        fac.push((i / seg) * TAU * rU, steep ? pt.y : pt.r, kind);
      }
    }
    for (let i = 0; i < seg; i++) {
      const A = base + i, B = A + 1, C = A + cols, D = C + 1;
      if (p.r > 1e-9) idx.push(A, C, B);
      if (q.r > 1e-9) idx.push(B, C, D);
    }
  }
  return solidGeo(pos, nor, fac, idx);
}

/** Closed six-faced slab from eight corners (c[0..3] one face, c[4..7] the opposite one in the same order), flat-shaded. */
function slab(c, kind, scale = 1) {
  const pos = [], nor = [], fac = [], idx = [];
  const ctr = new THREE.Vector3();
  for (const p of c) ctr.addScaledVector(p, 1 / 8);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3(), fc = new THREE.Vector3();
  for (const q of [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]) {
    let [a, b, cc, d] = q.map((i) => c[i]);
    nn.crossVectors(e1.subVectors(cc, a), e2.subVectors(d, b));
    fc.copy(a).add(b).add(cc).add(d).multiplyScalar(0.25).sub(ctr);
    if (nn.dot(fc) < 0) { nn.negate(); [b, d] = [d, b]; }
    if (!(nn.lengthSq() > 1e-24)) continue;
    nn.normalize();
    const u = e1.subVectors(b, a).normalize(), w = e2.crossVectors(nn, u);
    const base = pos.length / 3;
    for (const p of [a, b, cc, d]) { pos.push(p.x, p.y, p.z); nor.push(nn.x, nn.y, nn.z); fac.push(p.dot(u) * scale, p.dot(w) * scale, kind); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return solidGeo(pos, nor, fac, idx);
}

/** Straight closed beam from p0 to p1 with an elliptical section: dims(u) -> [half-width, half-height], u 0..1. */
function beam(p0, p1, dims, kind = 1, { stations = 2, points = 20, up = new THREE.Vector3(0, 1, 0) } = {}) {
  const t = new THREE.Vector3().subVectors(p1, p0).normalize();
  const ref = Math.abs(t.dot(up)) > 0.95 ? new THREE.Vector3(1, 0, 0) : up;
  const n = ref.clone().addScaledVector(t, -ref.dot(t)).normalize(), s = new THREE.Vector3().crossVectors(n, t);
  return sweepSolid(stations, (j) => ({ p: p0.clone().lerp(p1, j / (stations - 1)), t, s, n }), (j) => {
    const [w, h] = dims(j / (stations - 1)), o = [];
    for (let i = 0; i < points; i++) { const a = -Math.PI / 2 + (i / points) * TAU; o.push([w * Math.cos(a), h * Math.sin(a), kind]); }
    return o;
  }, { capKind: kind });
}

// ----------------------------------------------------------------- Gate --
// Two catenary arches lean apart over the Gate channel from shared feet. Each is one closed swept
// section, tapering from 84 m at the feet to 32 m at the crown: glazed flanks between rails (the
// upper rails lit), a light slot recessed along the intrados, a crest fin along the extrados and a
// frame ring every 44 m. The legs spring from sculpted collars on stepped caisson plinths founded
// in the channel floor, and a tie between the two crowns carries the keystone ring.
// core/collision.js samples the same centreline and radius law for the camera.
const GATE_K = 2.2, GATE_LEAN = 0.2, GATE_DROP = 8, GATE_TERRACE = 9.6, GATE_COLLAR = 24.6;

/** One arch: its frames (p, t, s across, n to the extrados, r) at any arc length, and its length. */
function gateArch(lean) {
  const { span, height } = GATE, half = span / 2, k = GATE_K, ch = Math.cosh(k) - 1;
  const cl = Math.cos(lean), sl = Math.sin(lean);
  const at = (x) => { const y = (height * (Math.cosh(k) - Math.cosh((k * x) / half))) / ch; return new THREE.Vector3(x, y * cl - GATE_DROP, y * sl); };
  const nP = new THREE.Vector3(0, -sl, cl);      // normal of the arch's leaning plane
  const frameX = (x) => {
    const d = (-height * k * Math.sinh((k * x) / half)) / (half * ch);
    const t = new THREE.Vector3(1, d * cl, d * sl).normalize(), n = new THREE.Vector3().crossVectors(nP, t).normalize();
    return { p: at(x), t, n, s: new THREE.Vector3().crossVectors(n, t), r: 16 + 26 * Math.pow(Math.min(Math.abs(x) / half, 1), 1.6), x };
  };
  // arc length from the west foot
  const N = Math.round(span / 0.5), XS = [], SS = [];
  let acc = 0, prev = at(-half);
  for (let i = 0; i <= N; i++) { const x = -half + (span * i) / N, p = at(x); acc += p.distanceTo(prev); prev = p; XS.push(x); SS.push(acc); }
  const L = SS[N];
  const xAt = (s) => {
    s = THREE.MathUtils.clamp(s, 0, L);
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (SS[m] < s) lo = m; else hi = m; }
    return XS[lo] + ((XS[hi] - XS[lo]) * (s - SS[lo])) / Math.max(SS[hi] - SS[lo], 1e-9);
  };
  return { L, frame: (s) => frameX(xAt(s)) };
}

/** Section of an arch of radius r (s across, n toward the extrados), CCW from the slot floor. */
function gateSection(r) {
  const a = r, b = 0.8 * r, o = [];
  const E = (t) => [a * Math.cos(t), b * Math.sin(t)];
  const sp = (t) => Math.hypot(a * Math.sin(t), b * Math.cos(t));
  const raise = (t, h) => { const x = b * Math.cos(t), y = a * Math.sin(t), l = Math.hypot(x, y); return [a * Math.cos(t) + (x / l) * h, b * Math.sin(t) + (y / l) * h]; };
  const pt = (q, kind) => o.push([q[0], q[1], kind]);
  const arc = (t0, t1, kind, k) => { for (let i = 0; i < k; i++) pt(E(t0 + ((t1 - t0) * i) / k), kind); };
  // a rail 2 m wide standing 0.8 m proud; returns where the surface resumes
  const rail = (t, top) => { const d = 1 / sp(t); pt(E(t - d), 1); pt(raise(t - d, 0.8), top); pt(raise(t + d, 0.8), 1); return t + d; };
  const ws = THREE.MathUtils.clamp(0.17 * a, 3.4, 6.2);                    // half-width of the light slot
  const tL = -Math.PI / 2 + Math.asin(ws / a), nF = b * Math.sin(tL) + 1.6;  // its lips, and its floor 1.6 m up
  const t1 = -0.62, t2 = 0.72, tF = Math.acos(1.5 / a), hF = 2.6 + 0.05 * a;
  pt([-ws, nF], 2);                                  // slot floor (lit)
  pt([ws, nF], 1);                                   // its right wall
  arc(tL, t1 - 1 / sp(t1), 1, 6);                    // lower shoulder
  let t = rail(t1, 1);
  arc(t, t2 - 1 / sp(t2), 0, 12);                    // glazed flank
  t = rail(t2, 2);                                   // upper rail, lit along its top
  arc(t, tF, 1, 7);                                  // upper shoulder
  pt(E(tF), 1); pt([1, b + hF], 1); pt([-1, b + hF], 1);   // crest fin
  arc(Math.PI - tF, Math.PI - t2 - 1 / sp(t2), 1, 7);
  t = rail(Math.PI - t2, 2);
  arc(t, Math.PI - t1 - 1 / sp(t1), 0, 12);
  t = rail(Math.PI - t1, 1);
  arc(t, Math.PI - tL, 1, 6);
  pt([-ws, b * Math.sin(tL)], 1);                    // left wall of the slot, back up to its floor
  return o;
}

function ellipseSection(a, b, kind, k = 40) {
  const o = [];
  for (let i = 0; i < k; i++) { const t = -Math.PI / 2 + (i / k) * TAU; o.push([a * Math.cos(t), b * Math.sin(t), kind]); }
  return o;
}

function buildGate() {
  const parts = [], beacons = [];
  const half = GATE.span / 2;
  const arches = [-GATE_LEAN, GATE_LEAN].map(gateArch);
  const archV = (A, s) => Math.min(s, A.L - s) + 30;     // facade v: metres up from either foot
  for (const A of arches) {
    // stations out from the crown, at most 20 m and 1.6 degrees apart
    const off = [];
    let last = 0, lt = A.frame(A.L / 2).t;
    for (let d = 1; d < A.L / 2; d += 1) {
      const tt = A.frame(A.L / 2 + d).t;
      if (d - last >= 20 || tt.angleTo(lt) >= 0.028) { off.push(d); last = d; lt = tt; }
    }
    if (A.L / 2 - last > 3) off.push(A.L / 2); else off[off.length - 1] = A.L / 2;
    const S = [...off.slice().reverse().map((d) => A.L / 2 - d), A.L / 2, ...off.map((d) => A.L / 2 + d)];
    const F = S.map((s) => A.frame(s));
    parts.push(sweepSolid(S.length, (j) => F[j], (j) => gateSection(F[j].r), {
      v: S.map((s) => archV(A, s)),
      sec: ({ kind, cum, a, b }) => (kind === 0 ? cum - (a + b) / 2 : cum),     // glazing columns centred on each flank
    }));
    // frame rings every 44 m, clear of the collars
    for (let k = 0; ; k++) {
      const d = (k + 0.5) * 44;
      if (d > A.L / 2) break;
      for (const s of [A.L / 2 - d, A.L / 2 + d]) {
        const f0 = A.frame(s - 1.3), f1 = A.frame(s + 1.3);
        const sec = (f) => ellipseSection(f.r + 1.1, 0.8 * f.r + 1.1, 1);
        let low = 1e9;
        for (const f of [f0, f1]) for (const [ps, pn] of sec(f)) low = Math.min(low, f.p.y + f.s.y * ps + f.n.y * pn);
        if (low < GATE_COLLAR + 3) continue;
        parts.push(sweepSolid(2, (j) => (j ? f1 : f0), (j) => sec(j ? f1 : f0), { v: [archV(A, s - 1.3), archV(A, s + 1.3)] }));
      }
    }
    // an aircraft beacon on the crest fin at the crown
    const c = A.frame(A.L / 2), top = c.p.clone().addScaledVector(c.n, 0.8 * c.r + 2.6 + 0.05 * c.r + 0.9);
    beacons.push(top.x, top.y, top.z);
  }
  // Feet: a caisson founded 40 m down in the channel floor, a battered wall through the waves, a
  // quay 2.4 m above the sea, the upper wall with its coping and parapet round a garden terrace,
  // and on it a collar (lit band under its cornice) from which both legs spring.
  const plinth = [
    { r: 0, y: -40, kind: 1 }, { r: 106, y: -40, kind: 1 }, { r: 100, y: -1.2, kind: 1 }, { r: 99.4, y: 2.4, kind: 9 },
    { r: 93, y: 2.4, kind: 1 }, { r: 91.2, y: 9.4, kind: 1 }, { r: 91.6, y: 10.6, kind: 1 }, { r: 90.2, y: 10.6, kind: 1 },
    { r: 90.2, y: GATE_TERRACE, kind: 3 }, { r: 0, y: GATE_TERRACE },
  ];
  // the collar hugs both legs where they pass its cornice (east foot; the west one mirrors it)
  const foot = [];
  for (const A of arches) {
    for (let s = A.L - 60; s <= A.L; s += 0.5) {
      const f = A.frame(s);
      for (const [ps, pn] of gateSection(f.r)) {
        const q = f.p.clone().addScaledVector(f.s, ps).addScaledVector(f.n, pn);
        if (q.y > GATE_TERRACE && q.y < GATE_COLLAR + 0.5) foot.push(q);
      }
    }
  }
  let x0 = 1e9, x1 = -1e9, zm = 0;
  for (const q of foot) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); zm = Math.max(zm, Math.abs(q.z)); }
  const xc = (x0 + x1) / 2, ax = (x1 - x0) / 2;
  let kk = 0;
  for (const q of foot) kk = Math.max(kk, Math.hypot((q.x - xc) / ax, q.z / zm));
  const cA = ax * kk + 3, cB = zm * kk + 3;
  const collar = [
    { r: 0, y: GATE_TERRACE - 0.8, kind: 1 }, { r: 1.1, y: GATE_TERRACE - 0.8, kind: 1 }, { r: 1.1, y: 11.2, kind: 1 }, { r: 1.05, y: 11.2, kind: 1 },
    { r: 1.0, y: 22.2, kind: 2 }, { r: 1.0, y: 23.6, kind: 1 }, { r: 1.035, y: GATE_COLLAR, kind: 9 }, { r: 0, y: GATE_COLLAR },
  ];
  for (const sx of [-1, 1]) {
    const p = latheSolid(plinth, 64);
    p.translate(sx * half, 0, 0);
    parts.push(p);
    const c = latheSolid(collar, 64, { sx: cA, sz: cB });
    c.translate(sx * xc, 0, 0);
    parts.push(c);
  }
  // Crown tie and keystone ring: a beam between the crowns, 7.5 m below their centrelines, ends
  // buried in both arches; the ring hangs on it (the beam runs through the ring, its rim resting
  // in a dark metal clasp on the beam).
  const cA0 = arches[0].frame(arches[0].L / 2).p, cB0 = arches[1].frame(arches[1].L / 2).p;
  const yb = (cA0.y + cB0.y) / 2 - 7.5;
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const along = (z0, z1, sec) => sweepSolid(2, (j) => ({ p: new THREE.Vector3(0, yb, j ? z1 : z0), t: Z, s: X, n: Y }), () => sec);
  parts.push(along(cA0.z, cB0.z, ellipseSection(4.2, 3.2, 1, 24)));
  parts.push(along(-7, 7, ellipseSection(5.4, 4.2, 10, 24)));
  const yr = yb + 3.2 - 0.4 - 65, ring = [];
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * TAU, c = Math.cos(a), s = Math.sin(a);
    ring.push({ p: new THREE.Vector3(70 * c, yr + 70 * s, 0), t: new THREE.Vector3(-s, c, 0), n: new THREE.Vector3(c, s, 0), s: Z });
  }
  parts.push(sweepSolid(128, (j) => ring[j], () => ellipseSection(5, 5, 2, 24), { loop: true }));
  const g = mergeClean(parts);
  g.translate(GATE.x, 0, GATE.z);
  for (let i = 0; i < beacons.length; i += 3) { beacons[i] += GATE.x; beacons[i + 2] += GATE.z; }
  return { geo: g, beacons };
}

// -------------------------------------------------------- lotus platforms --
function buildLotusPads(groundHeight, promenadePaths) {
  const rnd = mulberry32(555);
  const parts = [];
  const pads = [];
  let tries = 0;
  while (pads.length < 34 && tries < 3000) {
    tries++;
    const a = rnd() * TAU, r = 1200 + rnd() * 3800;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const pr = 36 + rnd() * 70;
    if (groundHeight(x, z) > -3) continue;
    let ok = true;
    for (const p of pads) if (Math.hypot(p.x - x, p.z - z) < p.r + pr + 60) ok = false;
    for (const path of promenadePaths) for (let k = 0; k < path.length; k += 3) if (Math.hypot(path[k].x - x, path[k].z - z) < pr + 40) { ok = false; break; }
    if (!ok) continue;
    pads.push({ x, z, r: pr });
    const petals = 8 + Math.floor(rnd() * 6);
    const prof = [
      { r: pr * 0.95, y: -2, kind: 1 }, { r: pr * 1.02, y: 1.8, kind: 1 }, { r: pr, y: 2.6, kind: 2 }, { r: pr * 0.94, y: 3.0, kind: 1 },
      { r: pr * 0.9, y: 3.2, kind: 3 }, { r: 0.1, y: 3.4, kind: 3 },
    ];
    const pad = latheFacade(prof, 64);
    // scalloped rim: petals
    const pp = pad.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const px = pp.getX(i), pz = pp.getZ(i);
      const ang = Math.atan2(pz, px);
      const k = 1 + 0.06 * Math.cos(ang * petals);
      pp.setXYZ(i, px * k, pp.getY(i), pz * k);
    }
    pad.computeVertexNormals();
    pad.translate(x, 0, z);
    parts.push(pad);
    // pavilion: dome or pagoda-like spire
    if (rnd() < 0.6) {
      const h = 12 + rnd() * 16;
      const dome = latheFacade([
        { r: pr * 0.32, y: 3, kind: 0 }, { r: pr * 0.32, y: h * 0.5, kind: 0 }, { r: pr * 0.36, y: h * 0.55, kind: 2 },
        { r: pr * 0.3, y: h * 0.75, kind: 0 }, { r: pr * 0.18, y: h * 0.95, kind: 0 }, { r: 0.3, y: h * 1.05, kind: 1 },
      ], 32);
      dome.translate(x + (rnd() - 0.5) * pr * 0.3, 0, z + (rnd() - 0.5) * pr * 0.3);
      parts.push(dome);
    }
  }
  return { geo: mergeClean(parts), pads };
}

// ------------------------------------------------------------- skyport ----
// A hovering harbour of closed solids: the landing ring (keel, berth ledge, concourse glazing, a
// paved landing deck with planted strips between parapets, the lantern band round its inner face)
// with frames under it; six spokes to the tiered hub and its docking spire; the upper halo on six
// clamps; and ten berths, where each ship lies alongside the ring touching a gangway from the
// ledge (into its flank) and a cradle under its keel carried by a strut from the ring's hull.
// The taxi pads of life/traffic.js sit on the deck's centre line at +12.6 m.
const SHIP_R = 0.11, SHIP_FLAT = 0.55, BERTH_GAP = 32;   // unit ship's midship radius, its flattening; ring axis to hull

function ringSection() {
  const o = [];
  const pt = (s, n, k) => o.push([s, n, k]);
  const quarter = (cx, t0, t1) => { for (let i = 0; i < 8; i++) { const t = t0 + ((t1 - t0) * i) / 8; pt(cx + 12 * Math.cos(t), -2 + 9.5 * Math.sin(t), 1); } };
  pt(-14, -11.5, 1);                                                  // keel
  quarter(14, -Math.PI / 2, 0);                                       // outer lower hull
  pt(26, -2, 1); pt(27.4, -2, 1); pt(27.4, 0.6, 1);                  // berth ledge
  pt(26, 0.6, 0);                                                     // concourse glazing
  pt(19.6, 11.9, 1); pt(19.6, 13.1, 1); pt(18.8, 13.1, 1);           // outer parapet
  pt(18.8, 11.9, 9); pt(12.5, 11.9, 3); pt(8.5, 11.9, 9); pt(-8.5, 11.9, 3); pt(-12.5, 11.9, 9);   // deck: planted strips beside the landing lane
  pt(-18.8, 11.9, 1); pt(-18.8, 13.1, 1); pt(-19.6, 13.1, 1);        // inner parapet
  pt(-19.6, 11.9, 0);                                                 // inner glazing
  pt(-26, 2, 2);                                                      // lantern band
  quarter(-14, Math.PI, Math.PI * 1.5);                               // inner lower hull
  return o;
}

// a frame under the ring: the lower hull's outline 0.7 m proud, from the lantern band round the
// keel into the berth ledge (its inner face buried 0.4 m in the hull)
function ringFrameSection() {
  const o = [];
  const quarter = (cx, e, t0, t1, incl) => { for (let i = 0; i < 8 + (incl ? 1 : 0); i++) { const t = t0 + ((t1 - t0) * i) / 8; o.push([cx + (12 + e) * Math.cos(t), -2 + (9.5 + e) * Math.sin(t), 1]); } };
  quarter(-14, 0.7, Math.PI, Math.PI * 1.5, false);
  quarter(14, 0.7, -Math.PI / 2, 0.06, true);
  quarter(14, -0.4, 0.06, -Math.PI / 2, false);
  quarter(-14, -0.4, Math.PI * 1.5, Math.PI, true);
  return o;
}

// gangway tube: rounded rectangle 3.6 x 3.2 m, fritted glass sides
function gangwaySection() {
  const o = [], w = 1.8, h = 1.6, c = 0.55;
  for (const [cx, cy, t0, next] of [[w - c, -h + c, -Math.PI / 2, 12], [w - c, h - c, 0, 1], [-w + c, h - c, Math.PI / 2, 12], [-w + c, -h + c, Math.PI, 1]]) {
    for (let i = 0; i < 3; i++) { const t = t0 + (Math.PI / 6) * i; o.push([cx + c * Math.cos(t), cy + c * Math.sin(t), 1]); }
    o.push([cx + c * Math.cos(t0 + Math.PI / 2), cy + c * Math.sin(t0 + Math.PI / 2), next]);
  }
  return o;
}

// cradle under a hull of half-width hw and half-height hh: its inner face 1.5 % inside the hull
function cradleSection(hw, hh) {
  const o = [], t0 = (-5 * Math.PI) / 6, t1 = -Math.PI / 6;
  for (let i = 0; i <= 10; i++) { const t = t0 + ((t1 - t0) * i) / 10; o.push([(hw + 1.3) * Math.cos(t), (hh + 1.3) * Math.sin(t), 10]); }
  for (let i = 0; i <= 10; i++) { const t = t1 + ((t0 - t1) * i) / 10; o.push([0.985 * hw * Math.cos(t), 0.985 * hh * Math.sin(t), 10]); }
  return o;
}

/** A closed ring of section `sec` round the vertical axis at radius rr and height y; facade u along the ring (snapped to 16 m), v from `vOf`. */
function hoop(rr, y, sec, count, vOf) {
  const U16 = Math.round((TAU * rr) / 16) * 16, V = [];
  for (let j = 0; j <= count; j++) V.push((j / count) * U16);
  const up = new THREE.Vector3(0, 1, 0);
  return sweepSolid(count, (j) => {
    const a = (j / count) * TAU, c = Math.cos(a), s = Math.sin(a);
    return { p: new THREE.Vector3(rr * c, y, rr * s), t: new THREE.Vector3(-s, 0, c), s: new THREE.Vector3(c, 0, s), n: up };
  }, () => sec, { loop: true, v: V, swap: true, sec: vOf });
}

function buildSkyport() {
  const parts = [], beacons = [];
  const R = SKYPORT.r, up = new THREE.Vector3(0, 1, 0);
  const radial = (a, r, y) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  // landing ring: storey lines follow the height, the deck is laid out across
  parts.push(hoop(R, 0, ringSection(), 288, ({ s, n, kind }) => (kind === 9 || kind === 3 ? s : n)));
  // frames under it every 5 degrees
  for (let k = 0; k < 72; k++) {
    const a0 = ((k + 0.5) / 72) * TAU, da = 0.6 / R;
    parts.push(sweepSolid(2, (j) => {
      const a = a0 + (j ? da : -da), c = Math.cos(a), s = Math.sin(a);
      return { p: new THREE.Vector3(R * c, 0, R * s), t: new THREE.Vector3(-s, 0, c), s: new THREE.Vector3(c, 0, s), n: up };
    }, () => ringFrameSection(), { v: [0, 1.2] }));
  }
  // six spokes from the hub's belly to the ring's axis (both ends buried)
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    parts.push(beam(radial(a, 52, -9), radial(a, R, -1.5), (u) => [6.5 - 2 * u, 4.6 - 1.2 * u], 1));
  }
  // hub: a keel cone, four glazed tiers under ledges, the rim with its lantern band, the upper
  // concourse, a garden terrace behind a parapet, the drum and its roof garden, and the docking
  // spire ringed with lanterns
  parts.push(latheSolid([
    { r: 0, y: -152, kind: 1 }, { r: 6, y: -142, kind: 1 }, { r: 20, y: -114, kind: 10 },
    { r: 23, y: -108, kind: 0 }, { r: 43, y: -82, kind: 1 }, { r: 47, y: -82, kind: 1 }, { r: 47, y: -80, kind: 1 },
    { r: 45, y: -80, kind: 0 }, { r: 64, y: -56, kind: 1 }, { r: 68, y: -56, kind: 1 }, { r: 68, y: -54, kind: 1 },
    { r: 66, y: -54, kind: 0 }, { r: 82, y: -30, kind: 1 }, { r: 86, y: -30, kind: 1 }, { r: 86, y: -28, kind: 1 },
    { r: 84, y: -28, kind: 0 }, { r: 93, y: -8, kind: 1 }, { r: 97, y: -8, kind: 1 }, { r: 97, y: -3, kind: 2 },
    { r: 97, y: 3, kind: 1 }, { r: 97, y: 5, kind: 1 }, { r: 93, y: 5, kind: 0 }, { r: 84, y: 14, kind: 1 },
    { r: 84, y: 15.2, kind: 1 }, { r: 82.8, y: 15.2, kind: 1 }, { r: 82.8, y: 14.2, kind: 3 }, { r: 58, y: 14.2, kind: 1 },
    { r: 55, y: 28, kind: 3 }, { r: 30, y: 28, kind: 1 }, { r: 22, y: 42, kind: 1 },
    { r: 14, y: 72, kind: 2 }, { r: 14, y: 76, kind: 1 }, { r: 12, y: 108, kind: 2 }, { r: 12, y: 112, kind: 1 },
    { r: 10, y: 140, kind: 2 }, { r: 10, y: 146, kind: 1 }, { r: 4, y: 176, kind: 1 }, { r: 0.8, y: 189, kind: 1 }, { r: 0, y: 190 },
  ], 64));
  beacons.push(0, 191.2, 0);
  // upper halo (glazed outboard) on six clamps down to the ring's axis
  const Rh = R * 0.62, halo = [];
  for (let i = 0; i < 32; i++) { const t = (i / 32) * TAU; halo.push([12 * Math.cos(t), 6 * Math.sin(t), Math.cos(t + TAU / 64) > 0.64 ? 0 : 1]); }
  parts.push(hoop(Rh, 70, halo, 192, ({ n }) => n));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + TAU / 12;
    parts.push(beam(radial(a, Rh, 70), radial(a, R, 0), () => [4, 3.2], 1));
  }
  // berths
  const berths = [];
  for (let s = 0; s < 10; s++) {
    const a = (s / 10) * TAU + 0.3, len = 90 + (s % 3) * 45;
    const hw = SHIP_R * len, hh = SHIP_FLAT * SHIP_R * len, ys = -0.7;
    const er = radial(a, 1, 0), et = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), nt = et.clone().negate();
    const C = radial(a, R + BERTH_GAP + hw, ys);
    // gangway from inside the ring, through the ledge, 0.8 m into the ship's flank
    const g0 = radial(a, R + 22, ys), g1 = radial(a, R + BERTH_GAP + 0.8, ys);
    parts.push(sweepSolid(2, (j) => ({ p: j ? g1 : g0, t: er, s: nt, n: up }), () => gangwaySection()));
    // cradle under the keel, 12 m long, and the strut that carries it from the ring's lower hull
    parts.push(sweepSolid(2, (j) => ({ p: C.clone().addScaledVector(et, j ? 6 : -6), t: et, s: er, n: up }), () => cradleSection(hw, hh), { capKind: 10 }));
    parts.push(beam(radial(a, R + 16, -9), C.clone().add(new THREE.Vector3(0, -hh - 0.65, 0)), (u) => [1.6 + 0.2 * u, 1.2 - 0.65 * u], 10));
    berths.push({ p: C, a, len, flip: s % 2 === 1 });
  }
  for (let k = 0; k < 12; k++) { const q = radial(((k + 0.5) / 12) * TAU, R + 19.2, 13.7); beacons.push(q.x, q.y, q.z); }
  return { geo: mergeClean(parts), berths, beacons };
}

// Sky-ship hull for the berths, built at unit length along +Z (nose forward) with its facade
// laid out in metres for a ship of `facadeLen`, so the plating, the window bands along both
// flanks and the bridge canopy keep real proportions whatever the instance scale: a closed swept
// hull of flattened elliptical section, a Y tail of three fins and two engine bells in the stern.
function shipRadius(t) {
  if (t < 0.3) return 0.075 + (SHIP_R - 0.075) * Math.sin(((t / 0.3) * Math.PI) / 2);
  if (t < 0.68) return SHIP_R;
  const u = (t - 0.68) / 0.32;
  return Math.max(SHIP_R * Math.sqrt(Math.max(0, 1 - u * u)), 0.0015);
}

export function shipGeometry(len = 1, facadeLen = 130) {
  const parts = [];
  const T = [0, 0.012, 0.05, 0.1, 0.16, 0.2, 0.3, 0.45, 0.55, 0.68, 0.74, 0.76, 0.8, 0.84, 0.88, 0.91, 0.94, 0.97, 0.99, 0.998, 1];
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  // 24 edges round: window bands on both flanks (edges 22-1 and 10-13) along the midship, the
  // bridge canopy over the top (edges 2-9) behind the nose
  parts.push(sweepSolid(T.length, (j) => ({ p: new THREE.Vector3(0, 0, T[j] - 0.5), t: Z, s: X, n: Y }), (j) => {
    const t = T[j], r = shipRadius(t), o = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      const flank = (i >= 22 || i <= 1 || (i >= 10 && i <= 13)) && t >= 0.2 && t <= 0.68;
      const canopy = i >= 2 && i <= 9 && t >= 0.76 && t <= 0.88;
      o.push([r * Math.cos(a), SHIP_FLAT * r * Math.sin(a), flank ? 0 : canopy ? 2 : 1]);
    }
    return o;
  }, { capKind: 10, v: T.map((t) => (t - 0.5) * facadeLen), sec: ({ cum, a, i0 }) => (i0 === 22 || i0 === 10 ? cum - a + 0.0215 : cum) * facadeLen }));
  // Y tail: a dorsal fin and two ventral fins 60 degrees below the beam, roots buried in the hull
  const fin = (dx, dy, span) => {
    const hullR = (t) => { const r = shipRadius(t); return 1 / Math.hypot(dx / r, dy / (SHIP_FLAT * r)); };
    const c = [];
    for (const side of [-1, 1]) {
      for (const [t, d, th] of [[0.04, 0.75 * hullR(0.04), 0.009], [0.3, 0.75 * hullR(0.3), 0.009], [0.15, hullR(0.15) + span, 0.004], [0.015, hullR(0.015) + span, 0.004]]) {
        c.push(new THREE.Vector3(dx * d - dy * th * 0.5 * side, dy * d + dx * th * 0.5 * side, t - 0.5));
      }
    }
    return slab(c, 1, facadeLen);
  };
  parts.push(fin(0, 1, 0.075), fin(0.5, -0.866, 0.07), fin(-0.5, -0.866, 0.07));
  // engine bells, dark and cold at the berth
  for (const sx of [-1, 1]) {
    const b = latheSolid([
      { r: 0, y: -0.012, kind: 10 }, { r: 0.016, y: -0.012, kind: 10 }, { r: 0.016, y: 0.004, kind: 10 },
      { r: 0.021, y: 0.032, kind: 11 }, { r: 0.018, y: 0.032, kind: 11 }, { r: 0.007, y: 0.012, kind: 11 }, { r: 0, y: 0.012 },
    ], 20);
    const F = b.attributes.aFacade;
    for (let k = 0; k < F.count; k++) F.setXY(k, F.getX(k) * facadeLen, F.getY(k) * facadeLen);
    b.rotateX(-Math.PI / 2);
    b.translate(sx * 0.03, 0, -0.5);
    parts.push(b);
  }
  const m = mergeClean(parts);
  m.scale(len, len, len);
  return m;
}

// ------------------------------------------------------------- beacons ----
// Aircraft beacons on every summit: a slow, smooth swell of light (no hard blink).
export function createBeacons(points) {
  const n = points.length / 3;
  const seeds = new Float32Array(n);
  const rnd = mulberry32(8123);
  for (let i = 0; i < n; i++) seeds[i] = rnd();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uCityLights: U.uCityLights, uNight: U.uNight },
    vertexShader: /* glsl */ `
attribute float aSeed; uniform float uTime; varying float vI; varying float vRed;
void main() {
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // breathing between 35 % and full over 3-4 s, each beacon on its own phase
  float b = 0.5 - 0.5 * cos(6.28318 * (uTime * (0.24 + 0.08 * aSeed) + aSeed));
  vI = 0.35 + 0.65 * b * b;
  vRed = step(0.35, aSeed);
  gl_PointSize = clamp(9000.0 / max(-mv.z, 1.0), 2.0, 14.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uCityLights; uniform float uNight; varying float vI; varying float vRed;
void main() {
  vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard;
  float core = exp(-d * 6.0);
  vec3 col = mix(vec3(1.0, 0.95, 0.9), vec3(1.0, 0.15, 0.08), vRed);
  gl_FragColor = vec4(col * core * vI * (0.6 + 3.0 * uNight), 1.0);
}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

export function buildInfrastructure(scene, groundHeight, rawHeight) {
  const mat = createFacadeMaterial('pearl', 400, { litFrac: 0.6 });
  const prom = buildPromenades(groundHeight);
  const promMesh = new THREE.Mesh(prom.geo, mat);
  promMesh.castShadow = true; promMesh.receiveShadow = true;
  scene.add(promMesh);

  // the Gate's rhythm comes from its frame rings, so no hanging-garden bands on the glazing
  const gateMat = createFacadeMaterial('silver', 401, { litFrac: 0.5, band: 1e5 });
  const gateBuilt = buildGate();
  const gate = new THREE.Mesh(gateBuilt.geo, gateMat);
  gate.castShadow = true; gate.receiveShadow = true;
  gate.name = 'Gate of Concord';
  scene.add(gate);

  const lotus = buildLotusPads(rawHeight, prom.paths);
  const lotusMesh = new THREE.Mesh(lotus.geo, createFacadeMaterial('jade', 402, { litFrac: 0.7 }));
  lotusMesh.castShadow = true; lotusMesh.receiveShadow = true;
  scene.add(lotusMesh);

  const sp = buildSkyport();
  const skyport = new THREE.Mesh(sp.geo, createFacadeMaterial('silver', 403, { litFrac: 0.75, band: 1e5 }));
  skyport.position.set(SKYPORT.x, SKYPORT.y, SKYPORT.z);
  skyport.castShadow = true; skyport.receiveShadow = true;
  skyport.name = 'Skyport Meridian';
  scene.add(skyport);
  // docked ships, alongside the ring (+Z along the ring, bows alternating), each resting in its
  // cradle and touching its gangway
  const shipMat = createFacadeMaterial('pearl', 404, { litFrac: 0.8, band: 1e5, colW: 2.6, floorH: 3.2, uplight: 0 });
  const docked = new THREE.InstancedMesh(shipGeometry(1), shipMat, sp.berths.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), P = new THREE.Vector3();
  sp.berths.forEach((b, i) => {
    q.setFromAxisAngle(Y, -b.a + (b.flip ? Math.PI : 0));
    m4.compose(P.copy(b.p).add(skyport.position), q, new THREE.Vector3(b.len, b.len, b.len));
    docked.setMatrixAt(i, m4);
  });
  docked.castShadow = true; docked.receiveShadow = true;
  docked.computeBoundingSphere();
  scene.add(docked);

  const colliders = [
    { x: SKYPORT.x, z: SKYPORT.z, y0: SKYPORT.y - 150, y1: SKYPORT.y + 200, radius: 100 },
  ];
  // beacons on the Gate's crowns, the skyport's spire and round its deck parapet
  const beacons = [...gateBuilt.beacons];
  for (let i = 0; i < sp.beacons.length; i += 3) beacons.push(sp.beacons[i] + SKYPORT.x, sp.beacons[i + 1] + SKYPORT.y, sp.beacons[i + 2] + SKYPORT.z);
  return { promenades: prom.paths, promLamps: prom.lamps, stations: prom.stations, pads: lotus.pads, colliders, beacons, berths: sp.berths };
}

// the seed-pod maglev terminal, reused by the Outer Wards and the transit network
export { station as maglevStation, portal as deckPortal };
