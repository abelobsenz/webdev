import * as THREE from 'three';
import { CB } from '../craft/craftGeometry.js';
import { LK, createLunarMaterial } from './lunarMaterial.js';
import { CellLod } from './lunarLod.js';

// Medii Landing's trees, instanced. The town plants ~3,000 of them (lunarLandingLife.js); each is
// one of four species built once in detail (a flared trunk, limbs, and a crown of many leaf
// clusters, 1,300-2,000 triangles) and once simply for the far view, then placed, turned, scaled
// and tinted per tree. Units are metres; a prototype stands 10 m tall with a 4 m crown radius.
//
//   broadleaf   a forked trunk, four limbs and a dome of sixteen clusters
//   cypress     a slim column of ten clusters from near the ground
//   stone pine  a bare leaning trunk under a flat umbrella of twelve clusters
//   flowering   a broadleaf of eighteen smaller clusters, blossom in its canopy kind

export const SPECIES = ['broadleaf', 'cypress', 'pine', 'flowering'];

/** Where tree() records placements instead of building geometry (set while the town is built). */
export const TREE_SINK = { list: null };

/** The species a planting gets (the same rule the merged trees used, so the town's mix is kept). */
export function speciesOf(phase) {
  const sp = Math.floor(((((phase * 0.6180339) % 1) + 1) % 1) * 100);
  return sp < 58 ? 0 : sp < 76 ? 1 : sp < 90 ? 2 : 3;
}

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const ROT = new THREE.Matrix4().makeRotationX(-Math.PI / 2);   // CB lathes turn about z: stand them up

/** A leaf cluster: a jittered ellipsoid of `seg` sides and `bands` bands centred at (x, y, z). */
function cluster(B, x, y, z, rx, ry, k, r, seg = 9, bands = 5) {
  const prof = [];
  for (let i = 0; i <= bands; i++) {
    const t = -Math.PI / 2 + (Math.PI * i) / bands, j = 1 + 0.16 * (r() - 0.5) * 2;
    prof.push([i === 0 || i === bands ? 0 : Math.cos(t) * rx * j, y + Math.sin(t) * ry, k]);
  }
  B.at(x, 0, z, 0, r() * Math.PI * 2, 0); B.push(ROT); B.lathe(prof, seg, r() * 6.28); B.pop(); B.pop();
}

function trunk(B, prof, seg = 8) { B.push(ROT); B.lathe(prof, seg); B.pop(); }
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function buildDetailed(kind) {
  const B = new CB(), r = rng(911 + kind * 37), ck = LK.CANOPY + kind;
  if (kind === 1) {
    trunk(B, [[0.34, -0.5, LK.BARK], [0.28, 1.2, LK.BARK], [0.14, 3.0, LK.BARK], [0.02, 3.4, LK.BARK]], 7);
    for (let i = 0; i < 10; i++) {
      const u = i / 9, y = 1.4 + u * 7.9, R = 1.85 * (1 - 0.72 * u) + 0.25;
      const a = r() * Math.PI * 2, o = 0.25 * R;
      cluster(B, Math.cos(a) * o, y, Math.sin(a) * o, R, 1.05 + 0.25 * r(), ck, r, 10, 6);
    }
    return B.geometry();
  }
  if (kind === 2) {
    // a leaning trunk, forking twice below the umbrella
    trunk(B, [[0.46, -0.5, LK.BARK], [0.38, 1.0, LK.BARK], [0.3, 4.0, LK.BARK], [0.22, 6.2, LK.BARK], [0.02, 6.6, LK.BARK]], 8);
    const fork = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4 * r(), d = 1.6 + 1.4 * r();
      const tip = V(Math.cos(a) * d, 7.4 + 0.6 * r(), Math.sin(a) * d);
      B.tube([V(0, 5.8, 0), tip], 0.16, 6, LK.BARK);
      fork.push(tip);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.3 * r(), d = i < 3 ? 0.8 * r() : 1.8 + 2.2 * r();
      cluster(B, Math.cos(a) * d, 8.3 + 0.5 * r(), Math.sin(a) * d, 1.45 + 0.6 * r(), 0.55 + 0.25 * r(), ck, r, 10, 4);
    }
    return B.geometry();
  }
  // broadleaf (0) and flowering (3): a trunk forking at ~40% into limbs under a dome of clusters
  const th = 4.0, n = kind === 3 ? 18 : 16, cr = kind === 3 ? 1.35 : 1.6;
  trunk(B, [[0.62, -0.5, LK.BARK], [0.44, 0.4, LK.BARK], [0.34, 2.2, LK.BARK], [0.26, th, LK.BARK], [0.02, th + 0.6, LK.BARK]], 9);
  const limbs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5 * r(), d = 1.6 + 0.8 * r();
    const tip = V(Math.cos(a) * d, th + 2.2 + 1.2 * r(), Math.sin(a) * d);
    B.tube([V(0, th - 0.4, 0), V(Math.cos(a) * d * 0.45, th + 0.9, Math.sin(a) * d * 0.45), tip], 0.17, 6, LK.BARK);
    limbs.push(tip);
  }
  for (let i = 0; i < n; i++) {
    // a golden-angle spiral over a dome (higher clusters nearer the axis), jittered
    const u = (i + 0.5) / n, a = i * 2.39996 + r() * 0.5;
    const el = Math.asin(Math.min(1, 0.15 + 0.85 * u)), d = 3.0 * Math.cos(el) + 0.3 * r();
    const y = th + 1.4 + 4.0 * Math.sin(el) + 0.4 * (r() - 0.5);
    cluster(B, Math.cos(a) * d, y, Math.sin(a) * d, cr * (0.85 + 0.35 * r()), cr * (0.7 + 0.25 * r()), ck, r, 9, 5);
  }
  return B.geometry();
}

function buildSimple(kind) {
  const B = new CB(), r = rng(97 + kind), ck = LK.CANOPY + kind;
  if (kind === 1) {
    trunk(B, [[0.3, -0.5, LK.BARK], [0.02, 2.5, LK.BARK]], 5);
    for (const [y, R] of [[3.8, 2.1], [6.2, 1.7], [8.4, 1.0]]) cluster(B, 0, y, 0, R, 2.0, ck, r, 7, 4);
  } else if (kind === 2) {
    trunk(B, [[0.4, -0.5, LK.BARK], [0.25, 6.6, LK.BARK], [0.02, 7.0, LK.BARK]], 6);
    cluster(B, 0, 8.2, 0, 4.4, 1.2, ck, r, 8, 4);
  } else {
    trunk(B, [[0.5, -0.5, LK.BARK], [0.28, 4.0, LK.BARK], [0.02, 4.6, LK.BARK]], 6);
    cluster(B, 0, 7.4, 0, 3.0, 2.2, ck, r, 8, 4);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.3; cluster(B, Math.cos(a) * 2.2, 6.0, Math.sin(a) * 2.2, 2.0, 1.6, ck, r, 7, 4); }
  }
  return B.geometry();
}

// ------------------------------------------------------------------ hero trees --
// Within a few hundred metres the trees are drawn as trees: a flared, buttressed trunk in
// furrowed bark, primary limbs that curve up and out, secondary branches off each limb and
// twigs off those, and the foliage carried where the wood carries it (clusters at every twig's
// end and along the limbs), 7,000-10,000 triangles a tree.

const taper = (r0, r1) => (t) => r0 + (r1 - r0) * t;

/** A limb from p0 in direction (a, el) of length len, bending up by `lift`: its points. */
function limbPts(p0, a, el, len, lift, n = 4) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, h = Math.cos(el) * len * t, v = Math.sin(el) * len * t + lift * t * t;
    pts.push(V(p0.x + Math.cos(a) * h, p0.y + v, p0.z + Math.sin(a) * h));
  }
  return pts;
}

function buildHero(kind) {
  const B = new CB(), r = rng(1301 + kind * 53), ck = LK.CANOPY + kind, BK = LK.BARK;
  if (kind === 1) {
    // cypress: a straight trunk nearly to the top, whorls of short up-swept branches, and a
    // dense flame of foliage in many overlapping clusters
    trunk(B, [[0.42, -0.5, BK], [0.36, 0.3, BK], [0.27, 1.5, BK], [0.18, 4.5, BK], [0.08, 8.0, BK], [0.02, 9.2, BK]], 12);
    for (let w = 0; w < 9; w++) for (let i = 0; i < 3; i++) {
      const y = 1.4 + w * 0.85, a = w * 1.1 + i * 2.09, len = 1.3 * (1 - w / 11);
      B.tube(limbPts(V(0, y, 0), a, 0.9, len, 0.2, 2), taper(0.06, 0.02), 4, BK);
    }
    for (let i = 0; i < 44; i++) {
      const u = i / 43, y = 1.3 + u * 8.3, R = 1.75 * (1 - 0.74 * u) + 0.22;
      const a = i * 2.39996 + r() * 0.4, o = (0.3 + 0.35 * r()) * R;
      cluster(B, Math.cos(a) * o, y, Math.sin(a) * o, R * (0.62 + 0.2 * r()), 0.75 + 0.25 * r(), ck, r, 11, 6);
    }
    return B.geometry();
  }
  if (kind === 2) {
    // stone pine: a bare leaning trunk forking into four limbs, each forking again under a
    // flat, layered umbrella
    const lean = V(0.5, 0, 0.2);
    trunk(B, [[0.55, -0.5, BK], [0.46, 0.6, BK], [0.4, 2.0, BK], [0.34, 4.0, BK], [0.28, 5.6, BK], [0.02, 6.2, BK]], 12);
    const tips = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5 * r(), p0 = V(lean.x * 0.3, 5.3, lean.z * 0.3);
      const pts = limbPts(p0, a, 0.75, 2.2 + 0.8 * r(), 0.4, 3);
      B.tube(pts, taper(0.2, 0.1), 7, BK);
      const end = pts[pts.length - 1];
      for (let j = 0; j < 3; j++) {
        const b = a + (j - 1) * 0.7 + 0.2 * (r() - 0.5);
        const q = limbPts(end, b, 0.35, 1.3 + 0.8 * r(), 0.3, 2);
        B.tube(q, taper(0.09, 0.04), 5, BK);
        tips.push(q[q.length - 1]);
      }
    }
    for (const t of tips) for (let j = 0; j < 3; j++) {
      const a = r() * Math.PI * 2, d = 0.6 * r();
      cluster(B, t.x + Math.cos(a) * d, t.y + 0.5 + 0.3 * r(), t.z + Math.sin(a) * d, 1.2 + 0.4 * r(), 0.45 + 0.15 * r(), ck, r, 12, 5);
    }
    for (let i = 0; i < 8; i++) {
      const a = r() * Math.PI * 2, d = 1.2 * r();
      cluster(B, Math.cos(a) * d, 8.6 + 0.4 * r(), Math.sin(a) * d, 1.5 + 0.4 * r(), 0.5, ck, r, 12, 5);
    }
    return B.geometry();
  }
  // broadleaf (0) and flowering (3): a buttressed trunk forking into six limbs, three branches
  // off each, twigs off those, foliage on every twig's end and along the outer limbs
  const th = kind === 3 ? 3.2 : 3.8;
  trunk(B, [[0.78, -0.5, BK], [0.62, 0.1, BK], [0.46, 0.6, BK], [0.38, 1.8, BK], [0.32, th - 0.4, BK], [0.24, th + 0.4, BK], [0.02, th + 1.0, BK]], 14);
  // buttress roots
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    B.tube([V(Math.cos(a) * 0.2, 0.9, Math.sin(a) * 0.2), V(Math.cos(a) * 0.6, 0.15, Math.sin(a) * 0.6), V(Math.cos(a) * 0.95, -0.25, Math.sin(a) * 0.95)], taper(0.16, 0.05), 5, BK);
  }
  const nL = 6, cR = kind === 3 ? 0.95 : 1.1;
  for (let i = 0; i < nL; i++) {
    const a = (i / nL) * Math.PI * 2 + 0.4 * r(), el = 0.62 + 0.3 * r();
    const p0 = V(0, th - 0.5 + 0.35 * (i % 3), 0);
    const L1 = 2.6 + 0.8 * r();
    const pts = limbPts(p0, a, el, L1, 0.6, 4);
    B.tube(pts, taper(0.22, 0.1), 8, BK);
    const end = pts[pts.length - 1];
    for (let j = 0; j < 3; j++) {
      const from = j === 2 ? end : pts[2 + j];
      const b = a + (j - 1) * 0.65 + 0.3 * (r() - 0.5), e2 = 0.45 + 0.4 * r();
      const q = limbPts(from, b, e2, 1.6 + 0.7 * r(), 0.35, 3);
      B.tube(q, taper(0.1, 0.045), 5, BK);
      const tip = q[q.length - 1];
      // twigs: two short sprays off each branch end
      for (let k = 0; k < 2; k++) {
        const c = b + (k ? 0.5 : -0.5), tw = limbPts(tip, c, 0.6, 0.9, 0.15, 1);
        B.tube(tw, taper(0.04, 0.02), 3, BK);
        const tt = tw[1];
        cluster(B, tt.x, tt.y + 0.2, tt.z, cR * (0.8 + 0.3 * r()), cR * (0.65 + 0.2 * r()), ck, r, 11, 6);
      }
      cluster(B, tip.x, tip.y + 0.35, tip.z, cR * (0.9 + 0.3 * r()), cR * (0.7 + 0.2 * r()), ck, r, 11, 6);
    }
    // foliage along the outer limb
    const m = pts[3];
    cluster(B, m.x, m.y + 0.5, m.z, cR * 1.1, cR * 0.8, ck, r, 11, 6);
  }
  // the crown's top and heart filled in
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996, d = 0.6 + 1.2 * r();
    cluster(B, Math.cos(a) * d, th + 4.2 + 1.4 * r(), Math.sin(a) * d, cR * 1.2, cR * 0.9, ck, r, 11, 6);
  }
  return B.geometry();
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

/**
 * The instanced trees of one settlement. `list` holds the placements { x, y, z, H, r, phase }
 * (metres, in the settlement's frame). Three tiers per species, sorted round the camera by
 * plan cell (lunarLod.js): hero trees within HERO_R, the detailed prototypes to DETAIL_R, the
 * simple ones beyond. Without a camera position (update(dKm) alone) the whole town switches
 * between the detailed and simple sets on its distance, as before.
 */
export const HERO_R = 480, DETAIL_R = 2600;

export class LandingTrees {
  constructor(list, material = null) {
    this.group = new THREE.Group();
    this.group.name = 'Medii Landing trees';
    const mat = material || createLunarMaterial({ lit: 0.6 });
    const by = SPECIES.map(() => []);
    for (const t of list) by[speciesOf(t.phase)].push(t);
    this.sets = [];
    this.triangles = { near: 0, far: 0, hero: 0, now: 0 };
    SPECIES.forEach((name, kind) => {
      const trees = by[kind];
      if (!trees.length) return;
      const geos = [buildHero(kind), buildDetailed(kind), buildSimple(kind)];
      const set = new CellLod(`Medii Landing trees: ${name}`, geos, [HERO_R, DETAIL_R, 1e9], mat, { tint: true, cell: 150 });
      const rr = rng(4001 + kind);
      for (const t of trees) {
        _q.setFromAxisAngle(_s.set(0, 1, 0), t.phase);
        _m.compose(_p.set(t.x, t.y, t.z), _q, _s.set(t.r / 4, t.H / 10, t.r / 4));
        // each tree its own cast: lighter or darker, a little warmer or cooler
        const l = 0.82 + 0.34 * rr(), w = (rr() - 0.5) * 0.18;
        set.addMatrix(_m, [l * (1 + w), l, l * (1 - w)]);
      }
      this.group.add(set.build());
      const tr = set.tris;
      this.triangles.hero += tr[0] * trees.length;
      this.triangles.near += tr[1] * trees.length;
      this.triangles.far += tr[2] * trees.length;
      this.sets.push(set);
    });
    this._far = null;
    this.update(1e9, new THREE.Vector3(0, 1e9, 0));
  }

  /** dKm: the camera's distance from the town's centre; cam: the camera in site metres. */
  update(dKm, cam = null) {
    if (!cam) {
      // no position: the old whole-town switch, by distance alone
      const far = dKm > 6.5;
      if (far === this._far) return;
      this._far = far;
      _p.set(0, far ? 1e9 : 0, 0);
      for (const s of this.sets) s.update(_p, true);
    } else {
      this._far = null;
      for (const s of this.sets) s.update(cam);
    }
    this.triangles.now = this.sets.reduce((a, s) => a + s.triangles(), 0);
  }
}
