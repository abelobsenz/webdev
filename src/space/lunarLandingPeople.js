import * as THREE from 'three';
import { CB } from '../craft/craftGeometry.js';
import { LK } from './lunarMaterial.js';
import { CellLod } from './lunarLod.js';

// Medii Landing's townspeople at walking range, instanced. Each walker paces a beat of its own
// (out and back along a straight stretch of pavement, promenade, pier or path, turning at each
// end) entirely in the vertex shader: the lunar material's WALK variant moves the figure along
// its local z by the time, swings its legs and arms with the stride and bobs it a little, from
// a per-instance aWalk = (phase, speed m/s, half the beat's length). Nothing is updated per
// frame on the CPU; the figures only exist within a few hundred metres of the eye. Others
// stand about in twos and threes on the plazas and quays, talking, in the plain material.
//
// The figure: 1.75 m, proportioned (legs 0.9 m, a torso with shoulders, arms hanging to
// mid-thigh, a head with hair), facing +z on its origin, clothes in the instance colour.

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ROT = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

const CLOTHES = [[0.16, 0.2, 0.32], [0.55, 0.14, 0.12], [0.8, 0.76, 0.66], [0.2, 0.3, 0.22], [0.12, 0.12, 0.13], [0.62, 0.48, 0.3], [0.38, 0.44, 0.58], [0.72, 0.6, 0.2], [0.45, 0.2, 0.4], [0.86, 0.86, 0.84]];

function protoPerson(skirt) {
  const B = new CB(), P = LK.PAINT;
  // legs (tapered, with shoes) or a skirt over slimmer legs
  for (const s of [-1, 1]) {
    B.tube([V(s * 0.1, 0.9, 0), V(s * 0.095, 0.48, 0.01), V(s * 0.09, 0.08, 0)], (t) => 0.085 - 0.035 * t, 6, skirt ? LK.SKIN : P);
    B.box(s * 0.1, 0.05, 0.05, 0.1, 0.1, 0.26, LK.DARK);
  }
  if (skirt) { B.push(ROT); B.lathe([[0.17, 0.95, P], [0.27, 0.5, P], [0.0, 0.5, P]], 10); B.pop(); }
  // hips, torso and shoulders
  B.push(ROT);
  B.lathe([[0.0, 0.86, P], [0.17, 0.88, P], [0.18, 1.0, P], [0.16, 1.18, P], [0.2, 1.38, P], [0.17, 1.46, P], [0.06, 1.5, P], [0.0, 1.5, P]], 10);
  B.pop();
  // arms hanging a little forward, hands
  for (const s of [-1, 1]) {
    B.tube([V(s * 0.25, 1.42, 0), V(s * 0.27, 1.14, 0.02), V(s * 0.26, 0.86, 0.05)], (t) => 0.055 - 0.015 * t, 5, P);
    B.box(s * 0.26, 0.8, 0.05, 0.06, 0.1, 0.08, LK.SKIN);
  }
  // neck, head and hair
  B.push(ROT);
  B.lathe([[0, 1.48, LK.SKIN], [0.05, 1.5, LK.SKIN], [0.05, 1.56, LK.SKIN], [0.09, 1.6, LK.SKIN], [0.105, 1.66, LK.SKIN], [0.095, 1.73, LK.SKIN], [0, 1.76, LK.SKIN]], 8);
  B.pop();
  B.at(0, 0, -0.015);
  B.push(ROT);
  B.lathe([[0, 1.64, LK.DARK], [0.108, 1.66, LK.DARK], [0.1, 1.73, LK.DARK], [0.06, 1.77, LK.DARK], [0, 1.78, LK.DARK]], 8);
  B.pop(); B.pop();
  return B.geometry();
}

/** A tiny stand-in for the middle distance: a tapered block of the clothes' colour. */
function protoFigure() {
  const B = new CB();
  B.box(0, 0.45, 0, 0.3, 0.9, 0.2, LK.PAINT);
  B.box(0, 1.2, 0, 0.42, 0.6, 0.24, LK.PAINT);
  B.box(0, 1.62, 0, 0.18, 0.24, 0.2, LK.SKIN);
  return B.geometry();
}

/**
 * The townspeople's sets. S: the town's records; walkMat: a lunar material made with
 * { walk: true }; trees: the tree placements (the beats keep clear of the trunks).
 */
export function landingPeople(S, walkMat, trees, mat = null) {
  const r = rng(9191);
  const walkers = new CellLod('Townspeople walking', [protoPerson(false)], [420], walkMat, { tint: true, cell: 100, extra: 'aWalk' });
  const walkersB = new CellLod('Townspeople walking (skirts)', [protoPerson(true)], [420], walkMat, { tint: true, cell: 100, extra: 'aWalk' });
  const standers = new CellLod('Townspeople standing', [protoPerson(false), protoFigure()], [300, 900], mat, { tint: true, cell: 120 });
  const standersB = new CellLod('Townspeople standing (skirts)', [protoPerson(true), protoFigure()], [300, 900], mat, { tint: true, cell: 120 });
  const TC = 16, tgrid = new Map();
  for (const t of trees) { const k = Math.floor(t.x / TC) * 65536 + Math.floor(t.z / TC); if (!tgrid.has(k)) tgrid.set(k, []); tgrid.get(k).push(t); }
  const clear = (x, z, d) => {
    const cx = Math.floor(x / TC), cz = Math.floor(z / TC);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const t of tgrid.get((cx + i) * 65536 + cz + j) || []) if (Math.hypot(t.x - x, t.z - z) < d + 0.8) return false;
    return true;
  };
  const cloth = () => CLOTHES[Math.floor(r() * CLOTHES.length)];
  // a beat from (u, v) along the direction a (radians in the u/v plane from +v), half-length hl
  const beat = (u, v, top, a, hl) => {
    const [x, z] = S.UV(u, v);
    const du = Math.sin(a) * hl, dv = Math.cos(a) * hl;
    for (const f of [-1, -0.5, 0, 0.5, 1]) { const [px, pz] = S.UV(u + du * f, v + dv * f); if (!clear(px, pz, 0.6)) return; }
    const set = r() < 0.4 ? walkersB : walkers;
    set.add(x, S.gy(x, z) + top, z, S.ROT_UV + a, 1, 0.94 + 0.12 * r(), 1, cloth(), 0, 0, [r(), 1.1 + 0.5 * r(), hl]);
  };
  const group = (u, v, top) => {
    const n = 2 + Math.floor(r() * 3), a0 = r() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2, pu = u + Math.sin(a) * 0.7, pv = v + Math.cos(a) * 0.7;
      const [x, z] = S.UV(pu, pv);
      if (!clear(x, z, 0.4)) continue;
      // each faces the middle of the group
      (r() < 0.4 ? standersB : standers).add(x, S.gy(x, z) + top, z, S.ROT_UV + a + Math.PI, 1, 0.94 + 0.12 * r(), 1, cloth());
    }
  };
  const { T, V: VV, U_TOWN } = S;

  // the Boulevard's walks, both sides, each terrace
  for (const [v0, v1, top] of [[VV.MID + 20, VV.LOW - 20, T.MID], [VV.LOW + 20, VV.STRAND - 20, T.LOW]]) {
    for (const s of [-1, 1]) for (let v = v0; v < v1; v += 9 + 10 * r()) {
      const hl = 8 + 14 * r();
      beat(s * (31 + 5 * r()), v, top, r() < 0.5 ? 0 : Math.PI, hl);
      if (r() < 0.12) group(s * (35 + 2 * r()), v, top);
    }
  }
  // the cross streets' pavements (18 m streets between the blocks), 4 m out from the fronts
  for (const [v0, v1, top] of [[VV.MID, VV.LOW, T.MID], [VV.LOW, VV.STRAND, T.LOW]]) {
    for (let v = v0 + 9 + 110; v < v1 - 9; v += 128) for (const side of [-1, 1]) {
      const vv = v + 9 + side * 5;
      for (let u = 44; u < U_TOWN - 20; u += 14 + 16 * r()) for (const sg of [-1, 1]) {
        const hl = 6 + 12 * r();
        if (u - hl < 42) continue;
        beat(sg * u, vv, top, Math.PI / 2, hl);
      }
    }
    // and the streets running down the slope between the blocks (20 m wide)
    for (let u = 40 + 150; u + 20 < U_TOWN; u += 170) for (const sg of [-1, 1]) for (const side of [-1, 1]) {
      const uu = sg * (u + 10 + side * 5.5);
      for (let v = v0 + 20; v < v1 - 20; v += 16 + 18 * r()) beat(uu, v, top, 0, 6 + 10 * r());
    }
  }
  // the Strand's promenade along the sea wall
  for (let u = -1650; u < 1650; u += 12 + 14 * r()) {
    const lane = r() < 0.5 ? 4.5 : 11;
    const v = S.shoreV(u) - lane;
    const t = (S.shoreV(u + 1) - S.shoreV(u - 1)) / 2;
    beat(u, v, T.STRAND, Math.PI / 2 - Math.atan(t), 7 + 12 * r());
    if (r() < 0.18) group(u + 3, S.shoreV(u) - 17, T.STRAND);
  }
  // the plaza round the Lift: between its ring beam and the pools, and beyond the pools
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2, rad = r() < 0.45 ? 166 + 19 * r() : 262 + 90 * r();
    const [x, z] = [Math.cos(a) * rad, Math.sin(a) * rad];
    const u = (x + z) * Math.SQRT1_2, v = (z - x) * Math.SQRT1_2;
    // the pools stand on the axes at 225 m: keep off them
    if (rad > 200 && (Math.abs(Math.abs(u) - 225) < 34 && Math.abs(v) < 64 || Math.abs(Math.abs(v) - 225) < 34 && Math.abs(u) < 64)) continue;
    if (rad > 200 && Math.abs(u) > 700) continue;
    if (r() < 0.25) group(u, v, T.LIFT);
    else beat(u, v, T.LIFT, Math.atan2(u, v) + Math.PI / 2 + (r() - 0.5) * 0.8, 6 + 10 * r());
  }
  // the courtyards' lawns, and round the garden squares' pools
  for (const c of S.courts) {
    if (c.hu < 8 || c.hv < 8) continue;
    const n = c.garden ? 10 : 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      if (c.garden) {
        const q = Math.floor(r() * 4), o = (r() - 0.5) * 30;
        const [u, v] = q % 2 ? [c.uc + (q === 1 ? 22 : -22), c.vc + o] : [c.uc + o, c.vc + (q === 0 ? -22 : 22)];
        beat(u, v, c.top, q % 2 ? 0 : Math.PI / 2, 5 + 5 * r());
      } else {
        const u = c.uc + (r() - 0.5) * (c.hu - 6), v = c.vc + (r() - 0.5) * (c.hv - 6);
        if (r() < 0.3) group(u, v, c.top); else beat(u, v, c.top, r() < 0.5 ? 0 : Math.PI / 2, Math.min(c.hu, c.hv) * 0.3);
      }
    }
  }
  // the piers
  for (const p of S.props.piers) for (let dv = 20; dv < p.v1 - p.v0 - 20; dv += 14 + 14 * r()) {
    beat(p.u + (r() < 0.5 ? -1 : 1) * (2.5 + 1.5 * r()), p.v0 + dv, p.top, 0, 5 + 10 * r());
  }
  return [walkers, walkersB, standers, standersB];
}
