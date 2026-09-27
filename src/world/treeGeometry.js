import * as THREE from 'three';
import { LEAF, BARK } from './natureTextures.js';

// Procedural tree species for MERIDIAN (geometry in metres at a reference height).
// Near geometry: real branching limbs (textured bark tubes with buttressed, slope-proof
// root flares that continue below ground) and crowns of leaf-cluster cards / fronds.
// Far geometry: one parametric "blob" and one "star" mesh shaped per instance.
//
// Vertex attributes: position, normal, uv, color, aTan (xyz tangent, w phase),
// aKind (x kind 0 bark / 1 leaf card / 2 frond / 3 flower card, y texture layer,
//        z wind sway weight 0..1, w baked ambient occlusion).

export const KIND = { BARK: 0, CARD: 1, FROND: 2, FLOWER: 3 };

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);

class GeoBuilder {
  constructor() { this.P = []; this.N = []; this.UV = []; this.C = []; this.T = []; this.K = []; this.I = []; this.n = 0; }
  v(p, n, u, v, c, t, ph, kind, layer, sway, ao) {
    this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.UV.push(u, v);
    this.C.push(c[0], c[1], c[2]); this.T.push(t.x, t.y, t.z, ph); this.K.push(kind, layer, sway, ao);
    return this.n++;
  }
  tri(a, b, c) { this.I.push(a, b, c); }
  /**
   * Tube along points with parallel-transported frames.
   * rad(t, theta, p) radius; opts: sides, layer, tileW, tileH (bark texture tile in m), col, sway(t,p), ao(t,p), v0
   */
  tube(pts, rad, opts = {}) {
    const { sides = 8, layer = BARK.FISSURED, tileW = 1.2, tileH = 2.0, col = [1, 1, 1], sway = () => 0, ao = () => 1, v0 = 0 } = opts;
    const n = pts.length;
    const T = [], Nf = [], Bf = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n - 1)];
      T.push(b.clone().sub(a).normalize());
    }
    let nrm = Math.abs(T[0].y) < 0.9 ? UP.clone().cross(T[0]).normalize() : V3(1, 0, 0).cross(T[0]).normalize();
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        const axis = T[i - 1].clone().cross(T[i]);
        const s = axis.length();
        if (s > 1e-6) nrm.applyAxisAngle(axis.normalize(), Math.asin(Math.min(1, s)));
      }
      nrm.sub(T[i].clone().multiplyScalar(nrm.dot(T[i]))).normalize();
      Nf.push(nrm.clone());
      Bf.push(T[i].clone().cross(nrm).normalize());
    }
    // circumference tiling: integer repeats so the seam matches
    const r0 = rad(0, 0, pts[0]);
    const rep = Math.max(1, Math.round((2 * Math.PI * r0) / tileW));
    let s = v0;
    const base = this.n;
    for (let i = 0; i < n; i++) {
      if (i > 0) s += pts[i].distanceTo(pts[i - 1]);
      const t = i / (n - 1);
      for (let k = 0; k <= sides; k++) {
        const th = (k / sides) * Math.PI * 2;
        const dir = Nf[i].clone().multiplyScalar(Math.cos(th)).addScaledVector(Bf[i], Math.sin(th));
        const r = rad(t, th, pts[i]);
        const p = pts[i].clone().addScaledVector(dir, r);
        this.v(p, dir, (k / sides) * rep, s / tileH, col, T[i], 0, KIND.BARK, layer, sway(t, pts[i]), ao(t, pts[i]));
      }
    }
    const cols = sides + 1;
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) {
      const a = base + i * cols + k, b = a + 1, c = a + cols, d = c + 1;
      this.tri(a, c, b); this.tri(b, c, d);
    }
    return s;
  }
  /** Leaf-cluster card centred at c, spanned by unit vectors ax, ay (size w x h). */
  card(c, ax, ay, w, h, softN, opts = {}) {
    const { kind = KIND.CARD, layer = LEAF.LEAFLETS, col = [1, 1, 1], sway = 1, ao = 1, ph = Math.random(), anchor = 0.5 } = opts;
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const idx = corners.map(([u, v]) => {
      const p = c.clone().addScaledVector(ax, (u - anchor) * w).addScaledVector(ay, (v - 0.5) * h);
      return this.v(p, softN, u, v, col, ax, ph, kind, layer, sway, ao);
    });
    this.tri(idx[0], idx[1], idx[2]); this.tri(idx[0], idx[2], idx[3]);
  }
  /** Frond: V-folded strip from base along dir; rise/droop shape; width w; texture v runs base->tip. */
  frond(base, dir, len, w, opts = {}) {
    const { rise = 0.3, droop = 0.9, fold = 0.18, segs = 7, layer = LEAF.PALM, col = [1, 1, 1], ao = 1, ph = Math.random(), twist = 0 } = opts;
    const d = dir.clone().setY(0).normalize();
    const side = V3(-d.z, 0, d.x);
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      pts.push(base.clone().addScaledVector(d, len * t * (1 - 0.15 * t)).add(V3(0, len * (rise * t - droop * t * t), 0)));
    }
    const rows = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const tg = pts[Math.min(i + 1, segs)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
      const sd = side.clone().applyAxisAngle(tg, twist * t);
      const upn = tg.clone().cross(sd).normalize().multiplyScalar(-1);
      if (upn.y < 0) upn.negate();
      const row = [];
      for (const [u, k] of [[0, -1], [0.5, 0], [1, 1]]) {
        const p = pts[i].clone().addScaledVector(sd, k * w * 0.5).addScaledVector(upn, -Math.abs(k) * fold * w * 0.5);
        const n = upn.clone().addScaledVector(sd, k * 0.35).normalize().lerp(UP, 0.35).normalize();
        row.push(this.v(p, n, u, t, col, sd, ph, KIND.FROND, layer, 0.4 + 0.6 * t, ao * (0.75 + 0.25 * t)));
      }
      rows.push(row);
    }
    for (let i = 0; i < segs; i++) for (let k = 0; k < 2; k++) {
      const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k], e = rows[i + 1][k + 1];
      this.tri(a, b, c); this.tri(b, e, c);
    }
    return pts;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aTan', new THREE.Float32BufferAttribute(this.T, 4));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.K, 4));
    g.setIndex(this.I);
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------- helpers --
function curve(p0, p1, bend, n, rnd, wob = 0) {
  // gently arching limb from p0 to p1 with the mid point lifted by `bend`
  const pts = [];
  const mid = p0.clone().lerp(p1, 0.5).add(V3(0, bend, 0));
  const a = new THREE.QuadraticBezierCurve3(p0, mid, p1);
  for (let i = 0; i <= n; i++) {
    const p = a.getPoint(i / n);
    if (wob && i > 0 && i < n) p.add(V3((rnd() - 0.5) * wob, (rnd() - 0.5) * wob * 0.5, (rnd() - 0.5) * wob));
    pts.push(p);
  }
  return pts;
}

function randomOnSphere(rnd) {
  const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return V3(Math.cos(a) * s, u, Math.sin(a) * s);
}

/** Scatter leaf-cluster cards around point p (outward = direction from crown centre). */
function clump(B, p, outward, n, size, rnd, { layer = LEAF.LEAFLETS, kind = KIND.CARD, crownC, crownR, spread = 1.6, col = [1, 1, 1], flowerFrac = 0, upBias = 0.35 }) {
  for (let i = 0; i < n; i++) {
    const off = randomOnSphere(rnd).multiplyScalar(spread * Math.cbrt(rnd()));
    const c = p.clone().add(off);
    let nd = randomOnSphere(rnd);
    nd.addScaledVector(outward, 1.2).addScaledVector(UP, upBias).normalize();
    const ax = Math.abs(nd.y) < 0.95 ? UP.clone().cross(nd).normalize() : V3(1, 0, 0);
    const ay = nd.clone().cross(ax).normalize();
    const rot = rnd() * Math.PI * 2;
    const ax2 = ax.clone().multiplyScalar(Math.cos(rot)).addScaledVector(ay, Math.sin(rot));
    const ay2 = nd.clone().cross(ax2).normalize();
    // soft normal: ellipsoidal crown normal, blended toward the card normal a little
    const rel = c.clone().sub(crownC);
    const en = V3(rel.x / (crownR.x * crownR.x), rel.y / (crownR.y * crownR.y), rel.z / (crownR.z * crownR.z)).normalize();
    const soft = en.clone().lerp(nd, 0.25).normalize();
    const rr = Math.min(1.2, Math.hypot(rel.x / crownR.x, rel.y / crownR.y, rel.z / crownR.z));
    const ao = THREE.MathUtils.clamp(0.35 + 0.55 * rr + 0.25 * (rel.y / crownR.y), 0.3, 1.0);
    const s = size * (0.8 + rnd() * 0.4);
    const isFlower = flowerFrac > 0 && rnd() < flowerFrac * THREE.MathUtils.clamp(0.4 + rel.y / crownR.y, 0, 1.4);
    B.card(c, ax2, ay2, s, s, soft, { kind: isFlower ? KIND.FLOWER : kind, layer: isFlower ? LEAF.FLOWERS : layer, col, sway: 1, ao, ph: rnd() });
  }
}

const trunkAO = (y) => THREE.MathUtils.clamp(0.55 + y * 0.12, 0.55, 1.0);

/** Trunk tube with a root flare and buttress fins that continues 2.5 m below ground (slope-proof). */
function trunk(B, rnd, { top, R0, taper = 0.55, lean = 0, buttress = 0, fins = 5, layer = BARK.FISSURED, sides = 14, tileW = 1.0, tileH = 2.0, col = [1, 1, 1], sway = 0.12 }) {
  const pts = [];
  const n = 14;
  const la = rnd() * Math.PI * 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = -2.5 + (top + 2.5) * t;
    const l = lean * Math.max(0, y / top) ** 2;
    pts.push(V3(Math.cos(la) * l + Math.sin(y * 0.4) * 0.05 * R0, y, Math.sin(la) * l + Math.cos(y * 0.33) * 0.05 * R0));
  }
  const ph = rnd() * 6.28;
  B.tube(pts, (t, th, p) => {
    const y = p.y;
    let r = R0 * (1 - taper * Math.max(0, y) / top);
    const flare = Math.exp(-Math.max(y + 0.3, 0) / (0.9 + buttress * 0.6));
    const fin = Math.pow(Math.abs(Math.cos(th * fins * 0.5 + ph)), 8);
    r *= 1 + flare * (0.45 + buttress * 2.4 * fin) + 0.05 * Math.sin(th * 3 + y);
    return r;
  }, { sides, layer, tileW, tileH, col, sway: (t, p) => sway * Math.max(0, p.y / top) ** 2, ao: (t, p) => trunkAO(p.y) });
  return pts[pts.length - 1];
}

/** A limb (and its sub-branches) from p0 to p1; returns the end points of the finest twigs. */
function limb(B, rnd, p0, p1, r0, r1, { layer = BARK.FISSURED, bend = 1, subs = 2, subLen = 0.45, sway0 = 0.2, col = [1, 1, 1], tileW = 0.9, tileH = 1.6, sides = 7 }) {
  const pts = curve(p0, p1, bend, 6, rnd, r0 * 1.2);
  B.tube(pts, (t) => r0 + (r1 - r0) * t, { sides, layer, tileW, tileH, col, sway: (t) => sway0 + (0.75 - sway0) * t, ao: () => 0.7 });
  const ends = [p1.clone()];
  const L = p0.distanceTo(p1);
  for (let k = 0; k < subs; k++) {
    const t = 0.45 + rnd() * 0.4;
    const i = Math.round(t * (pts.length - 1));
    const q0 = pts[i];
    const dir = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
    const side = randomOnSphere(rnd);
    side.y = Math.abs(side.y) * 0.8 + 0.2;
    const d = dir.clone().multiplyScalar(0.55).add(side.normalize()).normalize();
    const q1 = q0.clone().addScaledVector(d, L * subLen * (0.7 + rnd() * 0.5));
    const rr = (r0 + (r1 - r0) * t) * 0.6;
    const sp = curve(q0, q1, 0.4 * bend, 4, rnd, rr);
    B.tube(sp, (tt) => rr * (1 - 0.7 * tt), { sides: 5, layer, tileW, tileH, col, sway: (tt) => sway0 + 0.3 + 0.5 * tt, ao: () => 0.65 });
    ends.push(q1);
  }
  return ends;
}

// ---------------------------------------------------------------- species --
// Each returns { geo, H } where H is the reference height (instances scale by s / H).

function forestTree(rnd, variant) {
  const B = new GeoBuilder();
  const H = 26;
  const top = 14 + rnd() * 3;
  const tp = trunk(B, rnd, { top, R0: 0.62, buttress: 1, fins: 5, lean: 0.8, layer: variant ? BARK.SMOOTH : BARK.FISSURED, tileW: 1.1, tileH: 2.4 });
  const crownC = V3(tp.x, top + 5.2, tp.z), crownR = V3(7.5, 4.8, 7.5);
  const ends = [];
  const nL = 5;
  for (let k = 0; k < nL; k++) {
    const a = (k / nL) * Math.PI * 2 + rnd() * 0.7;
    const el = 0.35 + rnd() * 0.4;
    const start = V3(tp.x, top - 1.5 - rnd() * 2.5, tp.z);
    const len = 5.5 + rnd() * 2.5;
    const end = start.clone().add(V3(Math.cos(a) * Math.cos(el) * len, Math.sin(el) * len + 1.5, Math.sin(a) * Math.cos(el) * len));
    ends.push(...limb(B, rnd, start, end, 0.3, 0.1, { layer: variant ? BARK.SMOOTH : BARK.FISSURED, bend: 1.2, subs: 3 }));
  }
  // the crown top above the trunk
  ends.push(V3(tp.x, top + 7.5, tp.z));
  for (const e of ends) {
    const out = e.clone().sub(crownC).normalize();
    clump(B, e.clone().addScaledVector(out, 0.6), out, 7, variant ? 3.0 : 3.3, rnd, { layer: variant ? LEAF.BROAD : LEAF.LEAFLETS, crownC, crownR, spread: 2.0 });
  }
  // fill the upper shell so the crown reads as a mass from any side
  for (let i = 0; i < 26; i++) {
    const d = randomOnSphere(rnd); d.y = Math.abs(d.y) * 0.9 + 0.05;
    const p = crownC.clone().add(V3(d.x * crownR.x * 0.9, d.y * crownR.y * 0.9, d.z * crownR.z * 0.9));
    clump(B, p, d.clone().normalize(), 2, 3.2, rnd, { layer: variant ? LEAF.BROAD : LEAF.LEAFLETS, crownC, crownR, spread: 1.2 });
  }
  return { geo: B.build(), H };
}

function rainTree(rnd) {
  const B = new GeoBuilder();
  const H = 17;
  const top = 3.6;
  const tp = trunk(B, rnd, { top, R0: 0.85, buttress: 0.3, fins: 4, taper: 0.3, layer: BARK.FISSURED, tileW: 1.0, tileH: 1.8 });
  const crownC = V3(0, 11, 0), crownR = V3(13, 5.5, 13);
  const ends = [];
  const nL = 6;
  for (let k = 0; k < nL; k++) {
    const a = (k / nL) * Math.PI * 2 + rnd() * 0.5;
    const start = V3(tp.x * 0.5, top - 0.4 - rnd() * 0.6, tp.z * 0.5);
    const len = 9 + rnd() * 3;
    const el = 0.35 + rnd() * 0.25;
    const end = start.clone().add(V3(Math.cos(a) * len, Math.sin(el) * len + 2.5, Math.sin(a) * len));
    ends.push(...limb(B, rnd, start, end, 0.45, 0.12, { bend: 2.2, subs: 3, subLen: 0.5 }));
  }
  for (const e of ends) {
    const out = e.clone().sub(crownC).setY(0).normalize().add(V3(0, 0.6, 0)).normalize();
    clump(B, e.clone().add(V3(0, 1.0, 0)), out, 9, 4.0, rnd, { layer: LEAF.LEAFLETS, crownC, crownR, spread: 2.8, upBias: 0.8 });
  }
  for (let i = 0; i < 34; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.92;
    const x = Math.cos(a) * r * crownR.x, z = Math.sin(a) * r * crownR.z;
    const y = crownC.y + crownR.y * Math.sqrt(Math.max(0, 1 - r * r)) * 0.85 - 1;
    const p = V3(x, y, z);
    clump(B, p, p.clone().sub(crownC).normalize(), 2, 4.0, rnd, { layer: LEAF.LEAFLETS, crownC, crownR, spread: 1.5, upBias: 1.0 });
  }
  // epiphytes (bromeliads and nest ferns) on the big limbs
  for (let i = 0; i < 10; i++) {
    const e = ends[Math.floor(rnd() * ends.length)];
    const p = V3(e.x * (0.3 + rnd() * 0.3), top + 1.5 + rnd() * 2, e.z * (0.3 + rnd() * 0.3));
    const d = randomOnSphere(rnd); d.y = Math.abs(d.y) + 0.5; d.normalize();
    const ax = UP.clone().cross(d).normalize();
    if (ax.lengthSq() < 0.1) continue;
    B.card(p, ax, d.clone().cross(ax).normalize(), 1.4, 1.4, d, { layer: LEAF.BROAD, sway: 0.4, ao: 0.6, ph: rnd() });
  }
  return { geo: B.build(), H };
}

function flowering(rnd) {
  const B = new GeoBuilder();
  const H = 12;
  const top = 3.0;
  const tp = trunk(B, rnd, { top, R0: 0.42, buttress: 0.4, fins: 4, taper: 0.35, layer: BARK.SMOOTH, tileW: 0.9, tileH: 1.6 });
  const crownC = V3(0, 8, 0), crownR = V3(8, 3.6, 8);
  const ends = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rnd() * 0.6;
    const start = V3(tp.x, top - 0.3, tp.z);
    const len = 5.5 + rnd() * 2;
    const end = start.clone().add(V3(Math.cos(a) * len, 2.6 + rnd() * 1.4, Math.sin(a) * len));
    ends.push(...limb(B, rnd, start, end, 0.22, 0.07, { layer: BARK.SMOOTH, bend: 1.5, subs: 3, subLen: 0.5 }));
  }
  for (const e of ends) {
    const out = e.clone().sub(crownC).normalize().add(V3(0, 0.5, 0)).normalize();
    clump(B, e.clone().add(V3(0, 0.6, 0)), out, 7, 2.9, rnd, { layer: LEAF.LEAFLETS, crownC, crownR, spread: 1.9, flowerFrac: 0.55, upBias: 0.8 });
  }
  for (let i = 0; i < 18; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.9;
    const p = V3(Math.cos(a) * r * crownR.x, crownC.y + crownR.y * Math.sqrt(Math.max(0, 1 - r * r)) * 0.8 - 0.5, Math.sin(a) * r * crownR.z);
    clump(B, p, p.clone().sub(crownC).normalize(), 2, 2.9, rnd, { layer: LEAF.LEAFLETS, crownC, crownR, spread: 1.2, flowerFrac: 0.8, upBias: 1.0 });
  }
  return { geo: B.build(), H };
}

function palm(rnd) {
  const B = new GeoBuilder();
  const H = 19;
  const lean = 1.8 + rnd() * 1.6;
  const pts = [];
  const n = 18, top = 16.5;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = -2 + (top + 2) * t;
    const u = Math.max(0, y) / top;
    pts.push(V3(lean * (1.4 * u * u - 0.4 * u * u * u), y, 0.15 * Math.sin(u * 3)));
  }
  B.tube(pts, (t, th, p) => {
    const y = p.y;
    let r = 0.2 * (1 - 0.25 * Math.max(0, y) / top);
    r *= 1 + 0.9 * Math.exp(-Math.max(y + 0.2, 0) / 0.5);   // bulbous base
    return r;
  }, { sides: 10, layer: BARK.PALM, tileW: 1.2, tileH: 1.0, sway: (t, p) => 0.25 * Math.max(0, p.y / top) ** 2, ao: (t, p) => trunkAO(p.y) });
  const tip = pts[pts.length - 1];
  // crownshaft
  B.tube([tip.clone().add(V3(0, -0.8, 0)), tip.clone(), tip.clone().add(V3(0.05, 0.6, 0))], (t) => 0.2 - 0.08 * t, { sides: 8, layer: BARK.SMOOTH, col: [0.55, 0.6, 0.35], sway: () => 0.3 });
  const crownC = tip.clone(), crownR = V3(5, 3, 5);
  const fronds = 18;
  for (let f = 0; f < fronds; f++) {
    const a = f * 2.39996 + rnd() * 0.2;
    const tier = f % 3;
    const dir = V3(Math.cos(a), 0, Math.sin(a));
    const len = 5.2 + rnd() * 0.8 - tier * 0.3;
    const rise = tier === 0 ? 0.75 : tier === 1 ? 0.35 : 0.05;
    const droop = tier === 0 ? 0.75 : tier === 1 ? 0.8 : 0.95;
    B.frond(tip.clone().add(V3(0, 0.3, 0)), dir, len, 2.2, { rise, droop, fold: 0.3, segs: 8, layer: LEAF.PALM, ph: rnd(), twist: (rnd() - 0.5) * 0.6, ao: 0.9 });
  }
  // coconuts
  for (let k = 0; k < 9; k++) {
    const a = rnd() * Math.PI * 2;
    const c = tip.clone().add(V3(Math.cos(a) * 0.35, -0.5 - rnd() * 0.5, Math.sin(a) * 0.35));
    const sp = new THREE.SphereGeometry(0.2, 7, 5);
    const pa = sp.attributes.position, na = sp.attributes.normal;
    const base = B.n;
    const col = rnd() < 0.5 ? [0.55, 0.62, 0.3] : [0.5, 0.4, 0.25];
    for (let i = 0; i < pa.count; i++) {
      const p = V3(pa.getX(i), pa.getY(i) * 1.15, pa.getZ(i)).add(c);
      B.v(p, V3(na.getX(i), na.getY(i), na.getZ(i)), pa.getX(i) * 2, pa.getY(i) * 2, col, V3(1, 0, 0), 0, KIND.BARK, BARK.SMOOTH, 0.3, 0.7);
    }
    const ix = sp.index.array;
    for (let i = 0; i < ix.length; i += 3) B.tri(base + ix[i], base + ix[i + 1], base + ix[i + 2]);
  }
  return { geo: B.build(), H };
}

function treeFern(rnd) {
  const B = new GeoBuilder();
  const H = 7;
  const top = 5 + rnd();
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; const y = -1.5 + (top + 1.5) * t; pts.push(V3(0.4 * Math.sin(t * 2.2) * t, y, 0.25 * t * t)); }
  B.tube(pts, (t, th, p) => 0.16 * (1 + 0.6 * Math.exp(-Math.max(p.y, 0) / 0.8)) * (1 + 0.08 * Math.sin(th * 7)), { sides: 9, layer: BARK.FERN, tileW: 0.8, tileH: 1.0, sway: (t, p) => 0.3 * Math.max(0, p.y / top) ** 2, ao: (t, p) => trunkAO(p.y) });
  const tip = pts[pts.length - 1];
  for (let f = 0; f < 15; f++) {
    const a = f * 2.39996;
    const dir = V3(Math.cos(a), 0, Math.sin(a));
    B.frond(tip.clone().add(V3(0, 0.15, 0)), dir, 3.3 + rnd() * 0.5, 1.5, { rise: 0.7 - (f % 3) * 0.2, droop: 0.95, fold: 0.1, segs: 7, layer: LEAF.FERN, ph: rnd(), twist: (rnd() - 0.5) * 0.5 });
  }
  return { geo: B.build(), H };
}

function bamboo(rnd) {
  const B = new GeoBuilder();
  const H = 15;
  const culms = 22;
  const crownC = V3(0, 9, 0), crownR = V3(4, 7, 4);
  for (let c = 0; c < culms; c++) {
    const a = rnd() * Math.PI * 2, r0 = Math.sqrt(rnd()) * 1.4;
    const lean = 0.08 + rnd() * 0.14;
    const h = 10 + rnd() * 5;
    const base = V3(Math.cos(a) * r0, -1.5, Math.sin(a) * r0);
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const y = base.y + (h + 1.5) * t;
      const out = lean * y + 0.04 * y * y * t;
      pts.push(V3(base.x + Math.cos(a) * out, y - 0.02 * y * y * t * t, base.z + Math.sin(a) * out));
    }
    const R = 0.06 + rnd() * 0.03;
    B.tube(pts, (t) => R * (1 - 0.4 * t), { sides: 6, layer: BARK.BAMBOO, tileW: 0.6, tileH: 1.6, sway: (t) => 0.15 + 0.85 * t * t, ao: (t) => 0.6 + 0.4 * t });
    // leaf sprays along the upper culm
    for (let i = 4; i <= 8; i++) {
      const p = pts[i];
      for (let k = 0; k < 2; k++) {
        const d = randomOnSphere(rnd); d.y = Math.abs(d.y) * 0.6 + 0.3; d.normalize();
        const ax = UP.clone().cross(d).normalize();
        if (ax.lengthSq() < 0.1) continue;
        const rel = p.clone().sub(crownC);
        const soft = V3(rel.x / 16, rel.y / 49, rel.z / 16).normalize().lerp(d, 0.3).normalize();
        B.card(p.clone().addScaledVector(d, 0.6), ax, d.clone().cross(ax).normalize(), 1.8, 1.8, soft, { layer: LEAF.BAMBOO, sway: 0.5 + 0.5 * (i / 8), ao: 0.55 + 0.4 * (i / 8), ph: rnd() });
      }
    }
  }
  return { geo: B.build(), H };
}

function mangrove(rnd) {
  const B = new GeoBuilder();
  const H = 8;
  const top = 4.2;
  const tp = trunk(B, rnd, { top, R0: 0.22, buttress: 0, taper: 0.4, layer: BARK.FLAKY, tileW: 0.7, tileH: 1.2, lean: 0.4 });
  // arching prop roots from the trunk down into the water / mud
  for (let k = 0; k < 13; k++) {
    const a = (k / 13) * Math.PI * 2 + rnd() * 0.4;
    const y0 = 0.8 + rnd() * 2.2;
    const R = 1.8 + rnd() * 2.2 + y0 * 0.4;
    const p0 = V3(Math.cos(a) * 0.15, y0, Math.sin(a) * 0.15);
    const p2 = V3(Math.cos(a) * R, -1.6, Math.sin(a) * R);
    const p1 = V3(Math.cos(a) * R * 0.55, y0 + 0.8, Math.sin(a) * R * 0.55);
    const c = new THREE.QuadraticBezierCurve3(p0, p1, p2);
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push(c.getPoint(i / 8));
    B.tube(pts, (t) => 0.07 + 0.03 * t, { sides: 5, layer: BARK.FLAKY, tileW: 0.5, tileH: 1.0, ao: () => 0.6 });
  }
  const crownC = V3(tp.x, 5.6, tp.z), crownR = V3(4.2, 2.6, 4.2);
  const ends = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rnd();
    const s = V3(tp.x, top - 1, tp.z);
    const e = s.clone().add(V3(Math.cos(a) * 3, 1.8 + rnd(), Math.sin(a) * 3));
    ends.push(...limb(B, rnd, s, e, 0.12, 0.05, { layer: BARK.FLAKY, bend: 0.6, subs: 2 }));
  }
  for (const e of ends) clump(B, e, e.clone().sub(crownC).normalize(), 6, 2.2, rnd, { layer: LEAF.MANGROVE, crownC, crownR, spread: 1.4, upBias: 0.5 });
  for (let i = 0; i < 18; i++) {
    const d = randomOnSphere(rnd); d.y = d.y * 0.7 + 0.25;
    const p = crownC.clone().add(V3(d.x * crownR.x * 0.85, d.y * crownR.y * 0.85, d.z * crownR.z * 0.85));
    clump(B, p, d.normalize(), 2, 2.2, rnd, { layer: LEAF.MANGROVE, crownC, crownR, spread: 1.0 });
  }
  return { geo: B.build(), H };
}

function banyan(rnd) {
  const B = new GeoBuilder();
  const H = 24;
  const top = 8;
  // a trunk of fused stems
  for (let s = 0; s < 6; s++) {
    const a = (s / 6) * Math.PI * 2 + rnd() * 0.4;
    const r0 = 1.4 + rnd() * 0.5;
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const y = -2.5 + (top + 3) * t;
      const rr = r0 * (1 - 0.7 * t) + 0.2;
      pts.push(V3(Math.cos(a + t * 0.8) * rr, y, Math.sin(a + t * 0.8) * rr));
    }
    B.tube(pts, (t, th, p) => (0.75 + 0.2 * rnd()) * (1 - 0.35 * t) * (1 + 0.6 * Math.exp(-Math.max(p.y + 0.3, 0) / 1.2)), { sides: 9, layer: BARK.SMOOTH, tileW: 1.0, tileH: 2.0, sway: () => 0, ao: (t, p) => trunkAO(p.y) * 0.9 });
  }
  const crownC = V3(0, 16, 0), crownR = V3(19, 7, 19);
  const ends = [];
  const nL = 8;
  for (let k = 0; k < nL; k++) {
    const a = (k / nL) * Math.PI * 2 + rnd() * 0.4;
    const s = V3(Math.cos(a) * 0.8, top - 0.5 - rnd(), Math.sin(a) * 0.8);
    const len = 13 + rnd() * 5;
    const e = s.clone().add(V3(Math.cos(a) * len, 3 + rnd() * 3, Math.sin(a) * len));
    const lp = curve(s, e, 1.5, 8, rnd, 0.4);
    B.tube(lp, (t) => 0.75 - 0.5 * t, { sides: 8, layer: BARK.SMOOTH, tileW: 1.0, tileH: 1.8, sway: (t) => 0.1 + 0.4 * t, ao: () => 0.65 });
    ends.push(e);
    // secondary branches
    for (let j = 0; j < 3; j++) {
      const t = 0.4 + rnd() * 0.5;
      const q0 = lp[Math.round(t * 8)];
      const d = V3(Math.cos(a + (rnd() - 0.5) * 1.8), 0.4 + rnd() * 0.5, Math.sin(a + (rnd() - 0.5) * 1.8)).normalize();
      const q1 = q0.clone().addScaledVector(d, 5 + rnd() * 3);
      B.tube(curve(q0, q1, 0.8, 4, rnd, 0.2), (tt) => 0.3 * (1 - 0.7 * tt), { sides: 5, layer: BARK.SMOOTH, tileW: 0.8, tileH: 1.4, sway: (tt) => 0.4 + 0.4 * tt, ao: () => 0.6 });
      ends.push(q1);
    }
    // aerial roots hanging from the limb; the older ones reach the ground as pillars
    for (let j = 0; j < 7; j++) {
      const t = 0.2 + rnd() * 0.75;
      const q = lp[Math.round(t * 8)].clone().add(V3((rnd() - 0.5) * 0.4, -0.4, (rnd() - 0.5) * 0.4));
      const reach = rnd() < 0.35;
      const len = reach ? q.y + 2.5 : 2 + rnd() * 5;
      const rr = reach ? 0.12 + rnd() * 0.16 : 0.025 + rnd() * 0.03;
      const pts = [];
      for (let i = 0; i <= 6; i++) { const u = i / 6; pts.push(q.clone().add(V3(Math.sin(u * 5 + j) * 0.08, -len * u, Math.cos(u * 4 + j) * 0.08))); }
      B.tube(pts, (u) => rr * (reach ? 1 + 0.8 * u * u : 1 - 0.5 * u), { sides: reach ? 6 : 3, layer: BARK.ROOT, tileW: 0.5, tileH: 1.5, sway: (u) => (reach ? 0 : 0.2 + 0.6 * u), ao: () => 0.55 });
    }
  }
  for (const e of ends) {
    const out = e.clone().sub(crownC).setY(0).normalize().add(V3(0, 0.7, 0)).normalize();
    clump(B, e.clone().add(V3(0, 1.2, 0)), out, 8, 4.2, rnd, { layer: LEAF.BROAD, crownC, crownR, spread: 3.0, upBias: 0.8 });
  }
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.92;
    const p = V3(Math.cos(a) * r * crownR.x, crownC.y + crownR.y * Math.sqrt(Math.max(0, 1 - r * r)) * 0.8 - 1.5, Math.sin(a) * r * crownR.z);
    clump(B, p, p.clone().sub(crownC).normalize(), 2, 4.2, rnd, { layer: LEAF.BROAD, crownC, crownR, spread: 2.0, upBias: 1.0 });
  }
  return { geo: B.build(), H };
}

function araucaria(rnd) {
  const B = new GeoBuilder();
  const H = 30;
  const top = 29;
  const tp = trunk(B, rnd, { top, R0: 0.45, taper: 0.85, buttress: 0.2, fins: 5, layer: BARK.FLAKY, tileW: 0.9, tileH: 1.4, sides: 10, sway: 0.2 });
  let y = 4.5, w = 0;
  while (y < top - 0.8) {
    const u = y / top;
    const L = 6.2 * Math.pow(1 - u, 0.85) + 0.7;
    const n = 6;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + w * 2.39996 + (rnd() - 0.5) * 0.2;
      const d = V3(Math.cos(a), 0.08 + 0.1 * u, Math.sin(a)).normalize();
      const side = V3(-Math.sin(a), 0, Math.cos(a));
      const nrm = d.clone().cross(side).normalize().multiplyScalar(-1);
      if (nrm.y < 0) nrm.negate();
      const c = V3(0, y, 0).addScaledVector(d, 0.25);
      const soft = V3(d.x, 0.5, d.z).normalize();
      B.card(c, d, side, L, L * 0.75, soft, { layer: LEAF.ARAUCARIA, anchor: 0, sway: 0.3 + 0.7 * u, ao: 0.45 + 0.5 * u, ph: rnd() });
    }
    y += 1.35 + rnd() * 0.3;
    w++;
  }
  // leading shoot
  B.card(V3(0, top + 0.6, 0), V3(1, 0, 0), V3(0, 1, 0), 1.2, 2.2, UP, { layer: LEAF.ARAUCARIA, sway: 1, ao: 1 });
  B.card(V3(0, top + 0.6, 0), V3(0, 0, 1), V3(0, 1, 0), 1.2, 2.2, UP, { layer: LEAF.ARAUCARIA, sway: 1, ao: 1 });
  void tp;
  return { geo: B.build(), H };
}

function banana(rnd) {
  // understory clump: banana / heliconia pseudostems with huge paddle leaves
  const B = new GeoBuilder();
  const H = 5;
  for (let s = 0; s < 4; s++) {
    const a = rnd() * Math.PI * 2, r0 = rnd() * 0.8;
    const h = 2.4 + rnd() * 1.6;
    const base = V3(Math.cos(a) * r0, -0.8, Math.sin(a) * r0);
    const tip = base.clone().add(V3(0.1, h + 0.8, 0.05));
    B.tube([base, base.clone().lerp(tip, 0.5), tip], (t) => 0.13 * (1 - 0.4 * t), { sides: 7, layer: BARK.BAMBOO, tileW: 0.4, tileH: 3.0, col: [0.8, 0.9, 0.6], sway: (t) => 0.3 * t, ao: () => 0.7 });
    for (let f = 0; f < 6; f++) {
      const fa = f * 2.39996 + s;
      B.frond(tip.clone(), V3(Math.cos(fa), 0, Math.sin(fa)), 2.4 + rnd() * 0.6, 0.9, { rise: 1.0, droop: 1.1, fold: 0.1, segs: 6, layer: LEAF.BANANA, ph: rnd(), twist: (rnd() - 0.5) * 0.8, ao: 0.85 });
    }
  }
  return { geo: B.build(), H };
}

// --------------------------------------------------------------- far LOD --
/**
 * Parametric crown ("blob"): trunk verts tagged aPart = 0, crown verts aPart = 1 on a unit
 * sphere. Shaped per instance from aShape (see vegetation.js).
 */
function farBlob() {
  const parts = [];
  const trunkG = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
  const crownG = new THREE.IcosahedronGeometry(1, 2);
  const add = (g, part) => {
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part), 1));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aPart'].includes(k)) g.deleteAttribute(k);
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  add(trunkG, 0); add(crownG, 1);
  return mergeSimple(parts);
}

/** Palm / tree-fern far LOD: bent trunk plus a star of drooping frond blades (aPart 2). */
function farStar() {
  const parts = [];
  const trunkG = new THREE.CylinderGeometry(1, 1, 1, 5, 4, true).translate(0, 0.5, 0);
  const n = trunkG.attributes.position.count;
  trunkG.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(0), 1));
  parts.push(trunkG.toNonIndexed());
  const pos = [], nrm = [], part = [];
  const F = 9;
  for (let f = 0; f < F; f++) {
    const a = (f / F) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const pts = [];
    for (let i = 0; i <= 3; i++) { const t = i / 3; pts.push([c * t, 0.35 * t - 0.75 * t * t, s * t]); }
    const w = 0.13;
    for (let i = 0; i < 3; i++) {
      const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[i + 1];
      const w0 = w * Math.sin(Math.PI * (0.15 + i / 3 * 0.85)), w1 = w * Math.sin(Math.PI * (0.15 + (i + 1) / 3 * 0.85));
      const q = [[x0 - s * w0, y0, z0 + c * w0], [x0 + s * w0, y0, z0 - c * w0], [x1 - s * w1, y1, z1 + c * w1], [x1 + s * w1, y1, z1 - c * w1]];
      for (const k of [0, 2, 1, 1, 2, 3]) { pos.push(...q[k]); nrm.push(0, 1, 0); part.push(2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  parts.push(g);
  for (const p of parts) for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'aPart'].includes(k)) p.deleteAttribute(k);
  return mergeSimple(parts);
}

function mergeSimple(parts) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'aPart']) {
    const size = parts[0].attributes[name].itemSize;
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const p of parts) { arr.set(p.attributes[name].array, o); o += p.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

// --------------------------------------------------------------- catalogue --
/**
 * Species catalogue. far: 'blob' | 'star'. shape: far-LOD crown parameters
 *  [crownBase (fraction of height), crownHeight (fraction), crownWidth (fraction of height), profile]
 *  profile: 0 rounded, 1 umbrella, 2 conical, 3 tall clump, 4 palm star, 5 fern star
 *  farColor: average crown colour for the far LOD (linear).
 */
export const SPECIES = [
  { id: 'forest', make: (r) => forestTree(r, 0), far: 'blob', shape: [0.5, 0.52, 0.62, 0], farColor: [0.055, 0.11, 0.03] },
  { id: 'forestBroad', make: (r) => forestTree(r, 1), far: 'blob', shape: [0.5, 0.5, 0.58, 0], farColor: [0.04, 0.09, 0.028] },
  { id: 'rainTree', make: rainTree, far: 'blob', shape: [0.33, 0.55, 1.55, 1], farColor: [0.065, 0.12, 0.032] },
  { id: 'flowering', make: flowering, far: 'blob', shape: [0.32, 0.55, 1.35, 1], farColor: [0.06, 0.11, 0.03], bloom: true },
  { id: 'palm', make: palm, far: 'star', shape: [0.9, 0.12, 0.6, 4], farColor: [0.07, 0.12, 0.035] },
  { id: 'treeFern', make: treeFern, far: 'star', shape: [0.8, 0.2, 1.0, 5], farColor: [0.05, 0.11, 0.03] },
  { id: 'bamboo', make: bamboo, far: 'blob', shape: [0.12, 0.85, 0.5, 3], farColor: [0.09, 0.14, 0.04] },
  { id: 'mangrove', make: mangrove, far: 'blob', shape: [0.42, 0.5, 1.05, 0], farColor: [0.05, 0.1, 0.03] },
  { id: 'banyan', make: banyan, far: 'blob', shape: [0.4, 0.5, 1.6, 1], farColor: [0.035, 0.08, 0.025] },
  { id: 'araucaria', make: araucaria, far: 'blob', shape: [0.12, 0.88, 0.38, 2], farColor: [0.035, 0.075, 0.03] },
  { id: 'banana', make: banana, far: 'star', shape: [0.6, 0.4, 1.0, 5], farColor: [0.1, 0.16, 0.04] },
];
export const SP = Object.fromEntries(SPECIES.map((s, i) => [s.id, i]));

export function buildSpeciesGeometry(rnd) {
  return SPECIES.map((s) => s.make(rnd));
}
export function buildFarGeometry() {
  return { blob: farBlob(), star: farStar() };
}
