import * as THREE from 'three';
import { LK } from './lunarMaterial.js';
import { TREE_SINK, speciesOf } from './lunarTrees.js';
import { LAMP } from './lamps.js';

// Medii Landing, lived in (metres, site frame: x west, y up, z north; u along the shore, v
// down to the water). Added to the town's one merged geometry by buildMediiLanding:
//   - trees: avenues on the Boulevard, a grove ring round the Lift plaza, courtyard trees,
//     the parkland round the old domes, a row along the Strand, orchards by the hamlets
//   - the Strand colonnade: a stoa along the sea wall, broken at the moles, piers and the
//     Boulevard's water stair
//   - covered markets either side of the Boulevard where it meets the Strand
//   - roads out through the farmland to five hamlets round their greens
//   - the Selene ferry at the east mole
// Everything is a closed solid seated on the sphere the Moon is drawn as (tops relative to
// it, feet below it), and every footprint is recorded in the plan the overlap check reads.

const S2 = Math.SQRT1_2;
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);

/**
 * A tree: a trunk rising from below the ground, forking into limbs that carry a crown of
 * clustered lobes (H tall, crown radius r). The species follows the phase: broadleaf domes of
 * five lobes, columnar cypresses, flat-topped stone pines and a flowering kind, each shaded by
 * its own canopy kind (lunarMaterial.js LK.CANOPY + species) - leaf clumps, darker hollows and
 * undersides, light through the leaves when the Sun is behind.
 */
export function tree(B, x, y, z, H, r, phase = 0) {
  // the town's trees are instanced in detail (lunarTrees.js): while the town is built, record them
  if (TREE_SINK.list) { TREE_SINK.list.push({ x, y, z, H, r, phase }); return; }
  const kind = speciesOf(phase), ck = LK.CANOPY + kind, tw = Math.max(0.3, r * 0.1);
  B.at(x, y, z, 0, phase, 0);
  B.box(0, H * 0.2, 0, tw, H * 0.4 + 0.5, tw, LK.DARK);
  B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  const th = H * 0.42, c = H - th;
  B.lathe([[0, th - 0.3, ck], [r * 0.72, th + c * 0.12, ck], [r, th + c * 0.42, ck], [r * 0.78, th + c * 0.76, ck], [r * 0.3, th + c * 0.96, ck], [0, H, ck]], 7, phase);
  B.pop(); B.pop();
}

/**
 * A road: a closed paved strip along a polyline of (u, v) points (metres), its top `top`
 * above the sphere, its foot `bot` below it, w wide.
 */
export function roadStrip(S, pts, w, top = 0.3, bot = -1.0, k = LK.PAVE) {
  const { B, UV, gy } = S;
  // resample every <= 40 m
  const P = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ua, va] = pts[i], [ub, vb] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(ub - ua, vb - va) / 40));
    for (let j = 0; j < n; j++) P.push([ua + (ub - ua) * j / n, va + (vb - va) * j / n]);
  }
  P.push(pts[pts.length - 1]);
  const L = [], R = [];
  let along = 0;
  const ids = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, P.length - 1)];
    const du = b[0] - a[0], dv = b[1] - a[1], dl = Math.hypot(du, dv) || 1;
    const nu = -dv / dl, nv = du / dl;                           // left normal in (u, v)
    if (i) along += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    const row = [];
    for (const [s, h, kk] of [[-1, top, k], [1, top, k], [1, bot, LK.WALL], [-1, bot, LK.WALL]]) {
      const u = P[i][0] + nu * s * w / 2, v = P[i][1] + nv * s * w / 2;
      const [x, z] = UV(u, v);
      row.push(B.v(x, gy(x, z) + h, z, s * w / 2, along, kk));
    }
    ids.push(row);
    L.push(P[i]);
  }
  for (let i = 0; i < ids.length - 1; i++) {
    const a = ids[i], b = ids[i + 1];
    const [ua, va] = P[i], [ub, vb] = P[i + 1];
    const du = ub - ua, dv = vb - va, dl = Math.hypot(du, dv) || 1;
    // side normals in site coordinates (u -> (S2, S2), v -> (-S2, S2) in x, z)
    const nu = -dv / dl, nv = du / dl;
    const left = new THREE.Vector3((nu - nv) * S2, 0, (nu + nv) * S2);
    B.tri(a[0], b[0], b[1], UP); B.tri(a[0], b[1], a[1], UP);           // top
    B.tri(a[3], b[3], b[2], DOWN); B.tri(a[3], b[2], a[2], DOWN);       // foot
    // (row[0] and row[3] lie on the -normal side, row[1] and row[2] on the +normal side)
    const right = left.clone().negate();
    B.tri(a[0], b[0], b[3], right); B.tri(a[0], b[3], a[3], right);
    B.tri(a[1], b[1], b[2], left); B.tri(a[1], b[2], a[2], left);
  }
  // end caps
  for (const [row, i0, i1] of [[ids[0], 0, 1], [ids[ids.length - 1], P.length - 1, P.length - 2]]) {
    const du = P[i0][0] - P[i1][0], dv = P[i0][1] - P[i1][1], dl = Math.hypot(du, dv) || 1;
    const out = new THREE.Vector3((du / dl - dv / dl) * S2, 0, (du / dl + dv / dl) * S2);
    B.tri(row[0], row[1], row[2], out); B.tri(row[0], row[2], row[3], out);
  }
  return P;
}

/** Distance from (u, v) to a polyline. */
function distPoly(u, v, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ua, va] = pts[i], [ub, vb] = pts[i + 1];
    const du = ub - ua, dv = vb - va, L2 = du * du + dv * dv || 1;
    const t = Math.max(0, Math.min(1, ((u - ua) * du + (v - va) * dv) / L2));
    best = Math.min(best, Math.hypot(u - ua - du * t, v - va - dv * t));
  }
  return best;
}

/** Distance from (u, v) to an axis-aligned rectangle in (u, v) (0 inside). */
export function distRect(u, v, r) {
  const du = Math.max(r.u0 - u, 0, u - r.u1), dv = Math.max(r.v0 - v, 0, v - r.v1);
  return Math.hypot(du, dv);
}

/**
 * A covered market on a block's plinth (uc, vc, bw x bd, its floor at k0 above the sphere):
 * a stone base, arcades of piers on all four sides under a continuous architrave, a tiled
 * roof with a glazed lantern along its ridge.
 */
export function marketHall(S, uc, vc, bw, bd, k0) {
  const { B, UV, gy, ROT_UV, foot, lamps } = S;
  const W = bw - 8, D = bd - 8;                          // along u, along v
  foot('market', uc, vc, W, D);
  const [x, z] = UV(uc, vc);
  const H = 9.0, pierW = 1.6, aY = 1.05 + H, aH = 1.4, rY = aY + aH;
  const rh = Math.min(D * 0.28, 13);
  B.at(x, gy(x, z) + k0, z, 0, ROT_UV, 0);               // local x along u, z along v
  B.box(0, 0.35, 0, W, 1.4, D, LK.WALL);                 // base, 1 m above the plinth
  // arcades: piers every ~8 m round the perimeter, standing into the base and the architrave
  const nu = Math.round((W - pierW) / 8), nv = Math.round((D - pierW) / 8);
  const piers = [];
  for (let i = 0; i <= nu; i++) { const u = -W / 2 + pierW / 2 + i * (W - pierW) / nu; piers.push([u, -D / 2 + pierW / 2], [u, D / 2 - pierW / 2]); }
  for (let j = 1; j < nv; j++) { const v = -D / 2 + pierW / 2 + j * (D - pierW) / nv; piers.push([-W / 2 + pierW / 2, v], [W / 2 - pierW / 2, v]); }
  for (const [pu, pv] of piers) B.box(pu, 1.05 + H / 2, pv, pierW, H + 0.4, pierW, LK.STONE);
  // architrave round all four sides, and the ceiling that closes the arcade's top
  B.box(0, aY + aH / 2, -D / 2 + 1.1, W, aH, 2.2, LK.WALL);
  B.box(0, aY + aH / 2, D / 2 - 1.1, W, aH, 2.2, LK.WALL);
  B.box(-W / 2 + 1.1, aY + aH / 2, 0, 2.2, aH, D - 4.4, LK.WALL);
  B.box(W / 2 - 1.1, aY + aH / 2, 0, 2.2, aH, D - 4.4, LK.WALL);
  B.box(0, aY + aH - 0.35, 0, W - 4.4, 0.7, D - 4.4, LK.WALL);
  B.pop();
  // roof: a tiled gable with its ridge along u, a glazed lantern along the ridge
  B.at(x, gy(x, z) + k0, z, 0, ROT_UV + Math.PI / 2, 0);  // local z along u, x across
  B.push(new THREE.Matrix4().makeTranslation(0, rY - 0.2, 0));
  const sec = [[-D / 2 - 0.6, 0], [D / 2 + 0.6, 0], [0, rh]];
  B.loft([{ z: -W / 2, pts: sec }, { z: W / 2, pts: sec }], LK.TILE);
  B.pop();
  B.box(0, rY + rh - 1.0, 0, 4.2, 3.2, W * 0.8, LK.GLASS);
  B.box(0, rY + rh + 0.75, 0, 5.0, 0.5, W * 0.8 + 0.6, LK.BRONZE);
  B.pop();
  // lamps under the long arcades
  for (const [pu, pv] of piers) if (Math.abs(pv) > D / 2 - 2) {
    const [lx, lz] = UV(uc + pu, vc + (pv > 0 ? pv - 2.6 : pv + 2.6));
    lamps.push({ p: new THREE.Vector3(lx, gy(lx, lz) + k0 + 7.5, lz), r: 0.9, color: LAMP.AMBER, i: 0.9 });
  }
}

/** Steps up from a road's end (ground) to a terrace (h above the sphere) over L metres. */
export function roadRamp(S, u0, v0, du, dv, h, L = 44, w = 10) {
  const { B, UV, gy } = S;
  const n = 12;
  const dl = Math.hypot(du, dv);
  du /= dl; dv /= dl;
  const dx = (du - dv) * Math.SQRT1_2, dz = (du + dv) * Math.SQRT1_2;
  const ry = Math.atan2(dx, dz);
  for (let s = 0; s < n; s++) {
    // step s at distance (s + 0.5) L / n from the terrace, falling toward the road
    const t = (s + 0.5) / n;
    const hh = h * (1 - s / n);
    const [x, z] = UV(u0 + du * t * L, v0 + dv * t * L);
    B.at(x, gy(x, z), z, 0, ry, 0);
    B.box(0, (hh - 1.2) / 2, 0, w, hh + 1.2, L / n + 0.05, LK.PAVE);
    B.pop();
  }
}

/**
 * The rest of the town's life: trees, the colonnade, roads and hamlets, the ferry.
 * S: { B, UV, gy, at, lamp, lamps, plan, foot, courts, shoreV, rnd, prism, gable, T, V, U_TOWN, ROT_UV, PADS, DOMES }
 */
export function buildLandingLife(S) {
  const { B, UV, gy, lamp, plan, courts, shoreV, rnd, prism, gable, T, V, U_TOWN, ROT_UV, PADS, DOMES } = S;
  const trees = [];                                         // (u, v, crown radius) for the checks
  const blocked = (u, v, r) => {
    for (const p of plan) if (p.u0 !== undefined && distRect(u, v, p) < r + 1.5) return true;
    return false;
  };
  // a tree goes in only where its crown is clear of every footprint (but a green), of the
  // crowns already planted, and its trunk clear of the roads
  const addTree = (u, v, h, H, r) => {
    for (const p of plan) {
      if (p.kind === 'road') { if (distPoly(u, v, p.pts) < p.w / 2 + 1.5) return; }
      else if (p.u0 !== undefined && p.kind !== 'green' && distRect(u, v, p) < r + 0.5) return;
    }
    for (const t of trees) if (Math.abs(t.u - u) < 14 && Math.abs(t.v - v) < 14 && Math.hypot(t.u - u, t.v - v) < 0.9 * (t.r + r)) return;
    const [x, z] = UV(u, v);
    tree(B, x, gy(x, z) + h, z, H, r, rnd() * 6.28);
    trees.push({ u, v, r });
  };

  // --- the Boulevard's avenues: two rows each side, between the lamps ---
  for (let v = V.MID + 48; v < V.STRAND - 20; v += 36) {
    if ([V.LOW, V.STRAND].some((e) => Math.abs(v - e) < 22)) continue;
    const h = v < V.LOW ? T.MID : T.LOW;
    for (const s of [-1, 1]) for (const uu of [14, 34]) addTree(s * uu, v, h, 9 + rnd() * 2, 3.4);
  }
  // --- a grove ring round the Lift plaza ---
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2 + 0.04;
    const u = Math.cos(a) * 318, v = Math.sin(a) * 318;
    if (Math.abs(u) < 26 && v > 0) continue;                 // the Boulevard's axis
    addTree(u, v, T.LIFT, 11 + rnd() * 3, 4.5);
  }
  // --- three avenues round the plaza beyond the grove, the Boulevard's and the cross axis kept open ---
  for (const R of [380, 440, 500]) {
    const n = Math.round((Math.PI * 2 * R) / 22);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (R / 440) * 0.05;
      const u = Math.cos(a) * R, v = Math.sin(a) * R;
      if (Math.abs(u) < 30 || Math.abs(v) < 30 || Math.abs(u) > 730 || v < -630 || v > 530) continue;
      addTree(u, v, T.LIFT, 10 + rnd() * 3, 4.0);
    }
  }
  // --- courtyard trees ---
  for (const c of courts) {
    if (c.garden) {
      // round the pavilion pool
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2;
        addTree(c.uc + Math.cos(a) * 42, c.vc + Math.sin(a) * 30, c.top, 9 + rnd() * 3, 4.2);
      }
      continue;
    }
    const n = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const r = 3.6 + rnd() * 1.2;
      const u = c.uc + (rnd() * 2 - 1) * Math.max(c.hu - r - 2.5, 0);
      const v = c.vc + (rnd() * 2 - 1) * Math.max(c.hv - r - 2.5, 0);
      if (trees.some((t) => Math.hypot(t.u - u, t.v - v) < t.r + r + 1)) continue;
      addTree(u, v, c.top, 8 + rnd() * 3, r);
    }
  }
  // --- the parkland round the old domes: groves and lawns ---
  const arcs = [[0, 1], [0, 2], [0, 4], [1, 3], [2, 4]];
  for (let v = -1685; v <= -670; v += 26) for (let u = -1585; u <= 435; u += 26) {
    const uu = u + (rnd() - 0.5) * 14, vv = v + (rnd() - 0.5) * 14;
    const grove = Math.sin(uu * 0.006 + 1.3) * Math.sin(vv * 0.008 + 0.4) + 0.3 * Math.sin(uu * 0.017 - vv * 0.013);
    if (grove < 0.05 + rnd() * 0.3) continue;
    const r = 3.8 + rnd() * 2;
    if (uu < -1600 + r + 3 || uu > 450 - r - 3 || vv < -1700 + r + 3 || vv > -650 - r - 3) continue;
    if (DOMES.some(([du, dv, R]) => Math.hypot(uu - du, vv - dv) < R + 6 + r + 4)) continue;
    if (arcs.some(([i, j]) => distPoly(uu, vv, [[DOMES[i][0], DOMES[i][1]], [DOMES[j][0], DOMES[j][1]]]) < 8 + r + 3)) continue;
    if (PADS.some(([pu]) => Math.abs(uu - pu) < 16 + r && vv < -1600)) continue;       // the ramps up from the pad roads
    addTree(uu, vv, T.LIFT, 9 + rnd() * 5, r);
  }
  // --- a row of trees along the Strand, between the seafront halls and the colonnade ---
  for (let u = -1680; u <= 1680; u += 22) {
    if (Math.abs(u) < 36) continue;
    const v = V.STRAND + 90;
    if (blocked(u, v, 4)) continue;
    addTree(u, v, T.STRAND, 9 + rnd() * 2, 3.8);
  }

  // --- the Strand colonnade: a stoa along the sea wall ---
  {
    const free = (u) => !(Math.abs(Math.abs(u) - 620) < 32) && ![-330, 0, 330].some((q) => Math.abs(u - q) < 20) && Math.abs(u) <= U_TOWN - 12;
    const runs = [];
    let cur = null;
    for (let u = -U_TOWN + 12; u <= U_TOWN - 12; u += 6) {
      if (free(u) && free(u + 6)) { if (!cur) { cur = [u]; runs.push(cur); } cur[1] = u + 6; }
      else cur = null;
    }
    const F0 = 20, F1 = 32;                                   // front and back of the stoa, metres in from the shore
    const TS = T.STRAND;
    for (const [ua, ub] of runs) {
      if (ub - ua < 20) continue;
      S.foot('colonnade', (ua + ub) / 2, shoreV((ua + ub) / 2) - (F0 + F1) / 2, ub - ua, F1 - F0 + 8);
      const n = Math.max(2, Math.round((ub - ua) / 6));
      const front = [], back = [];
      for (let i = 0; i <= n; i++) { const u = ua + (ub - ua) * i / n; front.push(UV(u, shoreV(u) - F0 + 1.4)); back.push(UV(u, shoreV(u) - F1 - 0.9)); }
      // the roof, a metre thick, over the open front and the back wall
      prism(B, front.concat(back.slice().reverse()), TS + 8.8, TS + 7.8, LK.PAVE, LK.WALL);
      // stylobate: a low step the stoa stands on
      const fs = [], bs = [];
      for (let i = 0; i <= n; i++) { const u = ua + (ub - ua) * i / n; fs.push(UV(u, shoreV(u) - F0 + 1.4)); bs.push(UV(u, shoreV(u) - F1 - 1.4)); }
      prism(B, fs.concat(bs.slice().reverse()), TS + 0.45, TS - 0.3, LK.PAVE, LK.WALL);
      // the back wall, toward the town, from the step into the roof
      const wf = [], wb = [];
      for (let i = 0; i <= n; i++) { const u = ua + (ub - ua) * i / n; wf.push(UV(u, shoreV(u) - F1 + 0.5)); wb.push(UV(u, shoreV(u) - F1 - 0.5)); }
      prism(B, wf.concat(wb.slice().reverse()), TS + 8.0, TS + 0.2, LK.WALL, LK.WALL);
      // the open front: columns every 6 m, standing on the step, into the roof
      for (let i = 0; i <= n; i++) {
        const u = ua + (ub - ua) * i / n;
        const [x, z] = UV(u, shoreV(u) - F0);
        B.at(x, gy(x, z) + TS + 0.3, z);
        B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        B.lathe([[0.95, 0, LK.STONE], [0.78, 0.6, LK.STONE], [0.68, 7.0, LK.STONE], [0.95, 7.45, LK.STONE], [0.95, 7.65, LK.STONE]], 10);
        B.pop(); B.pop();
        if (i % 3 === 1) { const [lx, lz] = UV(u, shoreV(u) - (F0 + F1) / 2); lamps(S).push({ p: new THREE.Vector3(lx, gy(lx, lz) + TS + 7.2, lz), r: 0.8, color: LAMP.AMBER, i: 0.9 }); }
      }
    }
  }

  // --- roads out to the hamlets ---
  const HAMLETS = [
    { c: [-5600, 1350], road: [[-U_TOWN - 2, 3000], [-3200, 2420], [-4600, 1820], [-5600, 1350]], h: T.STRAND },
    { c: [-8300, -700], road: [[-5600, 1350], [-6800, 600], [-8300, -700]] },
    { c: [-4700, -3700], road: [[-U_TOWN - 2, 120], [-3000, -1150], [-4700, -3700]], h: T.MID },
    { c: [5300, 1500], road: [[U_TOWN + 2, 3000], [3500, 2380], [5300, 1500]], h: T.STRAND },
    { c: [8400, 2000], road: [[5300, 1500], [6900, 1850], [8400, 2000]] },
  ];
  const GREEN_R = 26, RING = 50;
  const roadsDone = [];
  for (const h of HAMLETS) {
    // the road stops at the green's edge
    const pts = h.road.map((p) => p.slice());
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const dl = Math.hypot(last[0] - prev[0], last[1] - prev[1]);
    pts[pts.length - 1] = [last[0] - (last[0] - prev[0]) / dl * (GREEN_R - 1), last[1] - (last[1] - prev[1]) / dl * (GREEN_R - 1)];
    // and starts at the first hamlet's green when it leaves from one
    const first = pts[0];
    const fromHamlet = HAMLETS.some((o) => o !== h && Math.hypot(o.c[0] - first[0], o.c[1] - first[1]) < 1);
    if (fromHamlet) { const nx = pts[1]; const d0 = Math.hypot(nx[0] - first[0], nx[1] - first[1]); pts[0] = [first[0] + (nx[0] - first[0]) / d0 * (GREEN_R - 1), first[1] + (nx[1] - first[1]) / d0 * (GREEN_R - 1)]; }
    const P = roadStrip(S, pts, 8);
    if (h.h) roadRamp(S, pts[0][0], pts[0][1], pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], h.h);
    roadsDone.push(pts);
    plan.push({ kind: 'road', pts, w: 8 });
    // lamps along it, and an avenue of trees on its first kilometre
    let acc = 0;
    for (let i = 1; i < P.length; i++) {
      acc += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      const du = P[i][0] - P[i - 1][0], dv = P[i][1] - P[i - 1][1], dd = Math.hypot(du, dv) || 1;
      const nu = -dv / dd, nv = du / dd;
      if (i % 4 === 0) lamp(P[i][0] + nu * 6, P[i][1] + nv * 6, 5.5, LAMP.AMBER, 0.6, 1.0);
      if (!fromHamlet && acc < 1100 && i % 2 === 1) for (const s of [-1, 1]) addTree(P[i][0] + nu * s * 10, P[i][1] + nv * s * 10, 0, 10 + rnd() * 3, 4);
    }
    // the hamlet: a green with its tree, houses round it facing in, an orchard behind
    const [cu, cv] = h.c;
    const green = [];
    for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; green.push(UV(cu + Math.cos(a) * GREEN_R, cv + Math.sin(a) * GREEN_R)); }
    prism(B, green, 0.3, -0.8, LK.COURT, LK.WALL);
    S.foot('green', cu, cv, GREEN_R * 2, GREEN_R * 2);
    addTree(cu, cv, 0.3, 13, 5.5);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.5; lamp(cu + Math.cos(a) * (GREEN_R - 3), cv + Math.sin(a) * (GREEN_R - 3), 4.8, LAMP.AMBER, 0.8, 1.1); }
    // directions the roads arrive from
    const inDirs = roadsDone.filter((r) => Math.hypot(r[r.length - 1][0] - cu, r[r.length - 1][1] - cv) < GREEN_R + 2 || Math.hypot(r[0][0] - cu, r[0][1] - cv) < GREEN_R + 2)
      .map((r) => { const e = Math.hypot(r[r.length - 1][0] - cu, r[r.length - 1][1] - cv) < GREEN_R + 2 ? r[r.length - 2] : r[1]; return Math.atan2(e[1] - cv, e[0] - cu); });
    const outDirs = HAMLETS.filter((o) => o.road[0][0] === cu && o.road[0][1] === cv).map((o) => Math.atan2(o.road[1][1] - cv, o.road[1][0] - cu));
    const gaps = inDirs.concat(outDirs);
    const nH = 8;
    for (let i = 0; i < nH; i++) {
      const a = i / nH * Math.PI * 2 + 0.2;
      if (gaps.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.5)) continue;
      const hu = cu + Math.cos(a) * RING, hv = cv + Math.sin(a) * RING;
      const w = 12 + Math.floor(rnd() * 3), d = 9;
      // footprint: the house turned to face the green; record its bounding square
      S.foot('hamlet', hu, hv, Math.max(w, d) + 2, Math.max(w, d) + 2);
      const [x, z] = UV(hu, hv);
      B.at(x, gy(x, z), z, 0, ROT_UV - a + Math.PI / 2, 0);
      const Hh = 2 * 3.4 + 0.8;
      B.box(0, Hh / 2 - 0.5, 0, w, Hh + 1.0, d, LK.STONE);
      gable(B, Hh, w, d, 3.6, LK.TILE);
      B.pop();
    }
    // orchard: rows of fruit trees on the side away from the roads
    let best = 0, bestGap = -1;
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2;
      const g = gaps.length ? Math.min(...gaps.map((q) => Math.abs(Math.atan2(Math.sin(a - q), Math.cos(a - q))))) : Math.PI;
      if (g > bestGap) { bestGap = g; best = a; }
    }
    const ou = cu + Math.cos(best) * 118, ov = cv + Math.sin(best) * 118;
    const ea = [Math.cos(best), Math.sin(best)], eb = [-Math.sin(best), Math.cos(best)];
    for (let i = -2; i <= 2; i++) for (let j = -3; j <= 3; j++) {
      const u = ou + ea[0] * i * 10 + eb[0] * j * 10, v = ov + ea[1] * i * 10 + eb[1] * j * 10;
      addTree(u, v, 0, 5.5 + rnd(), 2.6);
    }
  }

  // --- the Selene ferry, alongside the east mole's inner face ---
  {
    const u = 600 - 14, v = shoreV(600) + 150;
    const [x, z] = UV(u, v);
    B.at(x, gy(x, z), z, 0, ROT_UV, 0);                       // local z along v (bow out to the Bay)
    const L = 104, W = 19;
    const rings = [];
    for (let j = 0; j <= 16; j++) {
      const t = j / 16, zz = (t - 0.5) * L;
      // a fine bow, a full stern
      const bw = t > 0.7 ? Math.pow(Math.max(1 - (t - 0.7) / 0.3, 0), 0.8) : t < 0.06 ? 0.86 + t * 2.3 : 1;
      const hw = Math.max(W / 2 * bw, 0.4);
      const sheer = 4.2 + 1.8 * Math.pow(Math.max(t - 0.6, 0) / 0.4, 2);
      rings.push({ z: zz, pts: [[-hw, sheer], [-hw * 0.98, 0.2], [-hw * 0.8, -2.2], [-hw * 0.4, -3.2], [0, -3.4], [hw * 0.4, -3.2], [hw * 0.8, -2.2], [hw * 0.98, 0.2], [hw, sheer]] });
    }
    B.loft(rings, LK.HULL);
    // two decks of saloons with a glazed band, the wheelhouse, a mast
    B.box(0, 5.9, -6, W * 0.78, 4.0, L * 0.5, LK.GLASS);
    B.box(0, 8.05, -6, W * 0.82, 0.5, L * 0.52, LK.HULL);
    B.box(0, 9.7, -10, W * 0.62, 3.0, L * 0.32, LK.GLASS);
    B.box(0, 11.35, -10, W * 0.66, 0.5, L * 0.34, LK.HULL);
    B.box(0, 12.8, 4 - 10, W * 0.5, 2.6, 7, LK.GLASS);
    B.box(0, 14.22, 4 - 10, W * 0.56, 0.45, 8, LK.BRONZE);
    B.tube([new THREE.Vector3(0, 14.2, 1 - 10), new THREE.Vector3(0, 22, 1 - 10)], 0.35, 6, LK.BRONZE);
    B.pop();
    S.foot('ferry', u, v, W + 2, L + 2);
    const lampAt = (lu, lv, hh, c, i) => { const [lx, lz] = UV(lu, lv); S.lamps.push({ p: new THREE.Vector3(lx, gy(lx, lz) + hh, lz), r: 0.8, color: c, i }); };
    lampAt(u, v + L / 2 - 6, 7.2, LAMP.WHITE, 1.4);
    lampAt(u, v - L / 2 + 2, 6.5, LAMP.WHITE, 1.0);
    lampAt(u - W * 0.25 - 0.4, v - 6, 13.6, LAMP.RED, 1.2);
    lampAt(u + W * 0.25 + 0.4, v - 6, 13.6, LAMP.GREEN, 1.2);
    lampAt(u, v - 9, 22.6, LAMP.AMBER, 1.3);
  }
  return { trees };
}

function lamps(S) { return S.lamps; }
