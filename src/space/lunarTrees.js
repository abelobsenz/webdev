import * as THREE from 'three';
import { CB } from '../craft/craftGeometry.js';
import { LK, lunarInstanced, createLunarMaterial } from './lunarMaterial.js';

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
    trunk(B, [[0.34, -0.5, LK.DARK], [0.28, 1.2, LK.DARK], [0.14, 3.0, LK.DARK], [0.02, 3.4, LK.DARK]], 7);
    for (let i = 0; i < 10; i++) {
      const u = i / 9, y = 1.4 + u * 7.9, R = 1.85 * (1 - 0.72 * u) + 0.25;
      const a = r() * Math.PI * 2, o = 0.25 * R;
      cluster(B, Math.cos(a) * o, y, Math.sin(a) * o, R, 1.05 + 0.25 * r(), ck, r, 10, 6);
    }
    return B.geometry();
  }
  if (kind === 2) {
    // a leaning trunk, forking twice below the umbrella
    trunk(B, [[0.46, -0.5, LK.DARK], [0.38, 1.0, LK.DARK], [0.3, 4.0, LK.DARK], [0.22, 6.2, LK.DARK], [0.02, 6.6, LK.DARK]], 8);
    const fork = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4 * r(), d = 1.6 + 1.4 * r();
      const tip = V(Math.cos(a) * d, 7.4 + 0.6 * r(), Math.sin(a) * d);
      B.tube([V(0, 5.8, 0), tip], 0.16, 6, LK.DARK);
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
  trunk(B, [[0.62, -0.5, LK.DARK], [0.44, 0.4, LK.DARK], [0.34, 2.2, LK.DARK], [0.26, th, LK.DARK], [0.02, th + 0.6, LK.DARK]], 9);
  const limbs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5 * r(), d = 1.6 + 0.8 * r();
    const tip = V(Math.cos(a) * d, th + 2.2 + 1.2 * r(), Math.sin(a) * d);
    B.tube([V(0, th - 0.4, 0), V(Math.cos(a) * d * 0.45, th + 0.9, Math.sin(a) * d * 0.45), tip], 0.17, 6, LK.DARK);
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
    trunk(B, [[0.3, -0.5, LK.DARK], [0.02, 2.5, LK.DARK]], 5);
    for (const [y, R] of [[3.8, 2.1], [6.2, 1.7], [8.4, 1.0]]) cluster(B, 0, y, 0, R, 2.0, ck, r, 7, 4);
  } else if (kind === 2) {
    trunk(B, [[0.4, -0.5, LK.DARK], [0.25, 6.6, LK.DARK], [0.02, 7.0, LK.DARK]], 6);
    cluster(B, 0, 8.2, 0, 4.4, 1.2, ck, r, 8, 4);
  } else {
    trunk(B, [[0.5, -0.5, LK.DARK], [0.28, 4.0, LK.DARK], [0.02, 4.6, LK.DARK]], 6);
    cluster(B, 0, 7.4, 0, 3.0, 2.2, ck, r, 8, 4);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.3; cluster(B, Math.cos(a) * 2.2, 6.0, Math.sin(a) * 2.2, 2.0, 1.6, ck, r, 7, 4); }
  }
  return B.geometry();
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

/**
 * The instanced trees of one settlement. `list` holds the placements { x, y, z, H, r, phase }
 * (metres, in the settlement's frame). Detailed prototypes near the camera, simple ones beyond.
 */
export class LandingTrees {
  constructor(list, material = null) {
    this.group = new THREE.Group();
    this.group.name = 'Medii Landing trees';
    const mat = material || createLunarMaterial({ lit: 0.6 });
    const by = SPECIES.map(() => []);
    for (const t of list) by[speciesOf(t.phase)].push(t);
    this.near = []; this.far = [];
    this.triangles = { near: 0, far: 0 };
    SPECIES.forEach((name, kind) => {
      const trees = by[kind];
      if (!trees.length) return;
      for (const [set, geo] of [[this.near, buildDetailed(kind)], [this.far, buildSimple(kind)]]) {
        const m = lunarInstanced(geo, trees.length, {}, mat, { tint: true });
        m.name = `Medii Landing trees: ${name} (${set === this.near ? 'near' : 'far'})`;
        const rr = rng(4001 + kind);
        trees.forEach((t, i) => {
          _q.setFromAxisAngle(_s.set(0, 1, 0), t.phase);
          _m.compose(_p.set(t.x, t.y, t.z), _q, _s.set(t.r / 4, t.H / 10, t.r / 4));
          m.setMatrixAt(i, _m);
          // each tree its own cast: lighter or darker, a little warmer or cooler
          const l = 0.82 + 0.34 * rr(), w = (rr() - 0.5) * 0.18;
          m.setColorAt(i, _c.setRGB(l * (1 + w), l, l * (1 - w)));
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        const tri = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        this.triangles[set === this.near ? 'near' : 'far'] += tri * trees.length;
        set.push(m);
        this.group.add(m);
      }
    });
    this.nearOn = null;
    this.setNear(false);
  }

  setNear(on) {
    if (this.nearOn === on) return;
    this.nearOn = on;
    for (const m of this.near) m.visible = on;
    for (const m of this.far) m.visible = !on;
  }

  /** dKm: the camera's distance from the town's centre. */
  update(dKm) { this.setNear(dKm < (this.nearOn ? 7 : 6)); }
}
