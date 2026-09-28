import * as THREE from 'three';
import { latheFacade } from '../geom.js';
import { sweepLoop } from '../platform.js';
import { renderedHeight } from '../outerCities.js';
import { islandPrism, islandFoundation, rectangle, footprintGround } from '../islandPlan.js';
import { Solids, TAU } from './kit.js';

// Vesper: a low white town of domes round a lagoon harbour.
//
// The Lagoon is a round basin 430 m across, built out over the shallows in front of the town
// and closed by one continuous crescent quay: its south arc is the town's waterfront (where the
// Great Ring footbridge lands), its east arm runs over the sand spit, its west arm stands in
// deep water, and the two arms end in round bastions either side of a 180 m mouth on the
// harbour axis, through which the footbridge and the ferries pass. The crescent carries a
// continuous arcade along the water and, behind it, a ring of three-storey white houses, each
// under its own dome (the larger harbour hall by the landing), so that from the sea the lagoon
// is ringed by domes. The tall lighthouse stands on the east bastion, the harbour light on the
// west; timber pontoons with moored boats reach into the basin from the south quay.
//
// Everything stands on the drawn seabed or ground (renderedHeight): the quay's walls are founded
// 3 m below the lowest seabed under each section; houses, domes, columns and lights sit on the
// quay deck; the pontoons stand on piles taken to the seabed; boats float in the water.

const DECK = 3.75;       // the harbour level: the footbridge landing and arrival datum

export function vesperLagoon(parts, c, rnd, lights, placed) {
  const U = (u, v) => [c.deep.x + c.d[0] * u + c.side[0] * v, c.deep.z + c.d[1] * u + c.side[1] * v];
  const O = [200, 0], Ri = 215, Ro = 261, gap = (22 * Math.PI) / 180;
  const at = (th, r) => U(O[0] + Math.cos(th) * r, O[1] + Math.sin(th) * r);
  const record = { ring: [], houses: [], bastions: [], pontoons: [], boats: [], O: U(...O), Ri, Ro };

  // ---- the crescent quay: one closed sweep from the west bastion round to the east one
  const th0 = gap, th1 = TAU - gap, n = Math.ceil(((th1 - th0) * ((Ri + Ro) / 2)) / 7);
  let loop = [];
  for (let k = 0; k <= n; k++) { const th = th0 + ((th1 - th0) * k) / n; loop.push({ th, p: at(th, Ri) }); }
  // sweepLoop offsets positively to the right of travel: orient the loop so the right side is
  // the lagoon (the quay face is the path, the deck extends away from the water)
  const p0 = loop[0].p, p1 = loop[1].p, rx = p1[1] - p0[1], rz = -(p1[0] - p0[0]), oc = record.O;
  if (rx * (oc[0] - p0[0]) + rz * (oc[1] - p0[1]) < 0) loop.reverse();
  const W = Ro - Ri;
  const bottoms = loop.map(({ th }) => { let lo = Infinity; for (let r = Ri - 3; r <= Ro + 1; r += 4) lo = Math.min(lo, renderedHeight(...at(th, r))); return Math.min(lo, -1) - 3; });
  const quay = sweepLoop(loop.map((q) => q.p), (x, z, k) => [
    { a: [1.6, bottoms[k]], b: [0, 1.6], kind: 1 },
    { a: [0, 1.6], b: [0, 3.2], kind: 10 },
    { a: [0, 3.2], b: [0, DECK + 0.45], kind: 1 },
    { a: [0, DECK + 0.45], b: [-0.9, DECK + 0.45], kind: 1 },
    { a: [-0.9, DECK + 0.45], b: [-0.9, DECK], kind: 1 },
    { a: [-0.9, DECK], b: [-W, DECK], kind: 9 },
    { a: [-W, DECK], b: [-W - 0.4, DECK], kind: 1 },
    { a: [-W - 0.4, DECK], b: [-W - 0.4, bottoms[k]], kind: 1 },
  ], { closed: false, closeSection: true, capEnds: true, capKind: 1 });
  quay.userData.islandPublicFloor = true;
  quay.userData.vesperLagoon = { Ri, Ro, deck: DECK };
  parts.push(quay);
  record.ring = loop.map((q, k) => ({ p: q.p, th: q.th, bottom: bottoms[k] }));

  // ---- the round bastions at the mouth, the lighthouse and the harbour light
  for (const [th, tall] of [[th0, false], [th1, true]]) {
    const b = at(th, (Ri + Ro) / 2), R = 27;
    let lo = Infinity; for (let a = 0; a < TAU; a += TAU / 16) for (const r of [0, R * 0.5, R]) lo = Math.min(lo, renderedHeight(b[0] + Math.cos(a) * r, b[1] + Math.sin(a) * r));
    parts.push(latheFacade([{ r: R + 2.2, y: Math.min(lo, -1) - 3, kind: 1 }, { r: R, y: 1.6, kind: 1 }, { r: R, y: 3.2, kind: 10 }, { r: R, y: DECK + 0.45, kind: 1 }, { r: R, y: DECK + 0.45, kind: 9 }, { r: 0, y: DECK + 0.45, kind: 9 }], 40).translate(b[0], 0, b[1]));
    const y = DECK + 0.45;
    if (tall) {
      const h = 64;
      parts.push(latheFacade([{ r: 9, y: y - 0.1, kind: 1 }, { r: 9, y: y + 3, kind: 1 }, { r: 9, y: y + 3, kind: 9 }, { r: 5.4, y: y + 3, kind: 9 }, { r: 5.4, y: y + 3, kind: 5 },
        { r: 4.0, y: y + h * 0.8, kind: 5 }, { r: 4.0, y: y + h * 0.8, kind: 1 }, { r: 5.6, y: y + h * 0.8 + 0.4, kind: 1 }, { r: 5.6, y: y + h * 0.8 + 1.2, kind: 1 }, { r: 3.1, y: y + h * 0.8 + 1.2, kind: 10 },
        { r: 3.1, y: y + h * 0.8 + 1.4, kind: 2 }, { r: 3.1, y: y + h * 0.93, kind: 2 }, { r: 3.6, y: y + h * 0.93, kind: 10 }, { r: 2.4, y: y + h * 0.97, kind: 10 }, { r: 0.8, y: y + h, kind: 10 }, { r: 0, y: y + h + 3, kind: 2 }], 20).translate(b[0], 0, b[1]));
      lights.push({ x: b[0], y: y + h * 0.88, z: b[1], c: [1.0, 0.9, 0.7], s: 3.2 });
    } else {
      const h = 22;
      parts.push(latheFacade([{ r: 4.2, y: y - 0.1, kind: 1 }, { r: 3.2, y: y + h * 0.78, kind: 1 }, { r: 3.9, y: y + h * 0.8, kind: 1 }, { r: 3.9, y: y + h * 0.83, kind: 1 }, { r: 2.4, y: y + h * 0.83, kind: 10 },
        { r: 2.4, y: y + h * 0.85, kind: 2 }, { r: 2.4, y: y + h * 0.95, kind: 2 }, { r: 2.8, y: y + h * 0.95, kind: 10 }, { r: 0, y: y + h + 1.5, kind: 10 }], 16).translate(b[0], 0, b[1]));
      lights.push({ x: b[0], y: y + h * 0.9, z: b[1], c: [1.0, 0.25, 0.15], s: 2.4 });
    }
    record.bastions.push({ x: b[0], z: b[1], r: R, lo });
    placed.push({ x: b[0], z: b[1], r: R + 3 });
  }

  // ---- the crescent houses: each under its own dome, an arcade along the water in front
  const landing = U(-22, 0);
  const s = new Solids();
  const houseR0 = Ri + 20.5, houseR1 = Ro - 1.5, arcR0 = Ri + 12.5, arcR1 = Ri + 20.9;
  const span = (th1 - th0) * ((houseR0 + houseR1) / 2);
  const nH = Math.floor(span / 29);
  for (let k = 0; k < nH; k++) {
    const tA = th0 + ((th1 - th0) * (k + 0.1)) / nH, tB = th0 + ((th1 - th0) * (k + 0.9)) / nH, tm = (tA + tB) / 2;
    const mid = at(tm, (houseR0 + houseR1) / 2);
    // keep the landing square open, and the bastions' approaches
    if (Math.hypot(mid[0] - landing[0], mid[1] - landing[1]) < 62) continue;
    if (tA - th0 < 0.1 || th1 - tB < 0.1) continue;
    const hall = Math.hypot(mid[0] - U(-40, 95)[0], mid[1] - U(-40, 95)[1]) < 30;
    const H = hall ? 13 : 9 + ((k * 7) % 4);
    // a house: the trapezoid between the two arcs (convex), windows in stone, a roof terrace
    const q = [at(tA, houseR0), at(tB, houseR0), at(tB, houseR1), at(tA, houseR1)];
    parts.push(islandPrism(q, DECK - 0.3, DECK + H, 5, 9));
    // parapet coping and the drum and dome over the middle of the house
    const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cz = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    const depth = houseR1 - houseR0, len = (tB - tA) * houseR0;
    const r = hall ? 11.5 : Math.min(depth, len) * 0.34;
    const y = DECK + H, drum = hall ? 4.5 : 2.2;
    const dome = [{ r: r * 1.12, y: y - 0.05, kind: 1 }, { r: r * 1.12, y: y + 0.5, kind: 1 }, { r: r * 1.12, y: y + 0.5, kind: 9 }, { r, y: y + 0.5, kind: 9 }, { r, y: y + 0.5, kind: 5 }, { r, y: y + drum, kind: 5 }, { r, y: y + drum, kind: 1 }, { r: r * 1.05, y: y + drum, kind: 1 }, { r: r * 1.05, y: y + drum + 0.35, kind: 1 }];
    const solar = !hall && (k * 5) % 7 === 3;
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; dome.push({ r: i === 8 ? 0 : r * Math.cos(a), y: y + drum + 0.35 + Math.sin(a) * r * 0.92, kind: solar ? 7 : 1 }); }
    parts.push(latheFacade(dome, hall ? 36 : 24).translate(cx, 0, cz));
    if (hall) {
      // the harbour hall's lantern
      const ly = y + drum + 0.35 + r * 0.92;
      parts.push(latheFacade([{ r: 2.2, y: ly - 0.4, kind: 1 }, { r: 2.2, y: ly + 2.4, kind: 2 }, { r: 2.6, y: ly + 2.4, kind: 1 }, { r: 0, y: ly + 4.4, kind: 1 }], 12).translate(cx, 0, cz));
      lights.push({ x: cx, y: ly + 1.5, z: cz, c: c.light, s: 2.2 });
    }
    // the arcade bay in front: columns on the quay and a slab from them into the facade
    const aq = [at(tA - 0.004, arcR0), at(tB + 0.004, arcR0), at(tB + 0.004, arcR1), at(tA - 0.004, arcR1)];
    parts.push(islandPrism(aq, DECK + 5.3, DECK + 6.1, 1, 9));
    const cols = Math.max(2, Math.round(((tB - tA) * arcR0) / 6.5));
    for (let i = 0; i <= cols; i++) {
      const p = at(tA + ((tB - tA) * i) / cols, arcR0 + 1.1);
      parts.push(latheFacade([{ r: 0.62, y: DECK - 0.05, kind: 1 }, { r: 0.62, y: DECK + 0.4, kind: 1 }, { r: 0.42, y: DECK + 0.4, kind: 1 }, { r: 0.36, y: DECK + 4.9, kind: 1 }, { r: 0.6, y: DECK + 5.1, kind: 1 }, { r: 0.6, y: DECK + 5.35, kind: 1 }, { r: 0, y: DECK + 5.35, kind: 1 }], 8).translate(p[0], 0, p[1]));
    }
    record.houses.push({ q, H, dome: r, hall, arcade: aq });
  }

  // ---- pontoons and moored boats in the basin
  const pontoonAt = [[150, 44], [205, 50], [236, 40], [118, 38]];
  for (const [deg, len] of pontoonAt) {
    const th = (deg * Math.PI) / 180;
    const a = at(th, Ri + 0.5), b = at(th, Ri - len), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const deckQ = rectangle(mid[0], mid[1], L, 3.2, ang);
    parts.push(islandPrism(deckQ, 1.05, 1.45, 8, 8));
    // piles to the seabed every 6 m along both edges
    for (let t = 1.5; t < L; t += 6) for (const sg of [-1, 1]) {
      const p = [a[0] + Math.cos(ang) * t - Math.sin(ang) * sg * 1.3, a[1] + Math.sin(ang) * t + Math.cos(ang) * sg * 1.3];
      parts.push(latheFacade([{ r: 0.22, y: renderedHeight(...p) - 1.2, kind: 8 }, { r: 0.22, y: 1.08, kind: 8 }, { r: 0, y: 1.08, kind: 8 }], 6).translate(p[0], 0, p[1]));
    }
    // steps from the quay deck down to the pontoon, inside the quay's face line
    record.pontoons.push({ a, b, q: deckQ });
    // boats alongside
    for (let t = 10; t < L - 4; t += 13) for (const sg of [-1, 1]) {
      if (((t * 7 + deg) | 0) % 3 === 0) continue;
      const bl = 8 + ((deg + t) % 5), bw = 2.6;
      const px = a[0] + Math.cos(ang) * t - Math.sin(ang) * sg * (1.6 + bw / 2 + 0.4), pz = a[1] + Math.sin(ang) * t + Math.cos(ang) * sg * (1.6 + bw / 2 + 0.4);
      if (renderedHeight(px, pz) > -1.2) continue;
      boat(parts, px, pz, ang, bl, bw, (deg + t) % 2);
      record.boats.push({ x: px, z: pz, ang, L: bl, W: bw });
    }
  }
  for (const p of record.ring) if (record.ring.indexOf(p) % 4 === 0) placed.push({ x: p.p[0], z: p.p[1], r: 30 });
  placed.push({ x: record.O[0], z: record.O[1], r: Ri - 20 });
  return record;
}

/** A small moored boat: a pointed hull (closed, convex), a deckhouse, afloat at the waterline. */
function boat(parts, x, z, ang, L, W, kind) {
  const ca = Math.cos(ang), sa = Math.sin(ang), P = (u, v) => [x + ca * u - sa * v, z + sa * u + ca * v];
  const hull = [P(-L / 2, -W * 0.42), P(L * 0.22, -W / 2), P(L / 2, 0), P(L * 0.22, W / 2), P(-L / 2, W * 0.42)];
  parts.push(islandPrism(hull, -0.7, 0.75, 1, 8));
  const cab = kind ? [P(-L * 0.25, -W * 0.3), P(L * 0.05, -W * 0.3), P(L * 0.05, W * 0.3), P(-L * 0.25, W * 0.3)] : [P(-L * 0.4, -W * 0.28), P(-L * 0.12, -W * 0.28), P(-L * 0.12, W * 0.28), P(-L * 0.4, W * 0.28)];
  parts.push(islandPrism(cab, 0.7, 2.0, 0, 1));
}

// ---------------------------------------------------------------------------------------
// The cathedral of Vesper: a basilica on a stepped stylobate, its nave, aisles and transept
// under stone vaults, a drum and dome over the crossing, a round apse, and a west front whose
// campanile rises in a square tower, an open belfry and an octagonal spire to 128 m. The
// front faces the harbour (the sea); the forecourt steps down to the street.
export function vesperCathedral(parts, c, lights, P0) {
  const ang = Math.atan2(c.d[1], c.d[0]);          // the long axis runs toward the sea
  const ax = c.d[0], az = c.d[1], sx = c.side[0], sz = c.side[1];
  const T = (u, v) => [P0[0] + ax * u + sx * v, P0[1] + az * u + sz * v];
  // the stylobate: one measured foundation for the whole church and its forecourt
  const baseQ = [T(-104, -58), T(104, -58), T(104, 58), T(-104, 58)];
  const top = islandFoundation(parts, baseQ, { kind: 9, name: 'Vesper cathedral stylobate' });
  const s = new Solids();
  const y = top;
  const box = (u, v, L, W, y0, y1, wall = 5, roof = 9) => { const p = T(u, v); s.box(p[0], p[1], ax, az, L / 2, W / 2, y0, y1, wall, y0); if (roof !== wall) s.box(p[0], p[1], ax, az, L / 2 + 0.4, W / 2 + 0.4, y1, y1 + 0.6, 1, y1); };
  // the nave with its clerestory and vault, the aisles
  const nave = T(-8, 0);
  s.vault(nave[0], nave[1], ang, 104, 26, y - 0.1, 24, { wall: 5, roof: 1, seg: 10, overhang: 0.6 });
  for (const sg of [-1, 1]) { const p = T(-8, sg * 18.5); s.box(p[0], p[1], ax, az, 51, 5.5, y - 0.1, y + 12, 5, y); s.box(p[0], p[1], ax, az, 51.6, 6.1, y + 12, y + 12.6, 1, y); }
  // the transept crossing the nave toward the apse end
  const tr = T(-34, 0);
  s.vault(tr[0], tr[1], ang + Math.PI / 2, 76, 26, y - 0.1, 24, { wall: 5, roof: 1, seg: 10, overhang: 0.6 });
  parts.push(s.geometry());
  // the apse: a half-round end (a drum embedded in the nave) under a semi-dome
  const ap = T(-60, 0);
  const apse = [{ r: 13, y: y - 0.1, kind: 5 }, { r: 13, y: y + 20, kind: 5 }, { r: 13.4, y: y + 20, kind: 1 }, { r: 13.4, y: y + 20.8, kind: 1 }];
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; apse.push({ r: i === 6 ? 0 : 13 * Math.cos(a), y: y + 20.8 + Math.sin(a) * 11, kind: 1 }); }
  parts.push(latheFacade(apse, 32).translate(ap[0], 0, ap[1]));
  // the crossing: a drum of windows and a ribbed dome with its lantern
  const cr = T(-34, 0), dy = y + 24 + 6;
  const dome = [{ r: 12, y: y + 22, kind: 1 }, { r: 12, y: dy, kind: 1 }, { r: 12, y: dy, kind: 5 }, { r: 12, y: dy + 11, kind: 5 }, { r: 12, y: dy + 11, kind: 1 }, { r: 13, y: dy + 11, kind: 1 }, { r: 13, y: dy + 12.2, kind: 1 }];
  for (let i = 0; i <= 9; i++) { const a = (i / 9) * Math.PI / 2; dome.push({ r: Math.max(2.2, 12.6 * Math.cos(a)), y: dy + 12.2 + Math.sin(a) * 12.6, kind: i < 3 ? 1 : 7 }); }
  const ly = dy + 12.2 + 12.6;
  dome.push({ r: 2.2, y: ly + 3.2, kind: 2 }, { r: 2.9, y: ly + 3.2, kind: 1 }, { r: 2.9, y: ly + 3.8, kind: 1 }, { r: 0, y: ly + 8, kind: 2 });
  parts.push(latheFacade(dome, 40).translate(cr[0], 0, cr[1]));
  lights.push({ x: cr[0], y: ly + 2, z: cr[1], c: [1.0, 0.82, 0.55], s: 2.6 });
  // the west front and its campanile: square tower, belfry, octagonal spire to 128 m
  const tw = T(49, 0);
  const t2 = new Solids();
  t2.box(tw[0], tw[1], ax, az, 9, 9, y - 0.1, y + 52, 5, y);
  t2.box(tw[0], tw[1], ax, az, 9.8, 9.8, y + 52, y + 53.2, 1, y);
  t2.box(tw[0], tw[1], ax, az, 8.2, 8.2, y + 53.2, y + 62, 0, y);
  t2.box(tw[0], tw[1], ax, az, 9.0, 9.0, y + 62, y + 63.2, 1, y);
  // the porch before the doors, and the facade gable block
  const fr = T(43, 0);
  t2.box(fr[0], fr[1], ax, az, 3.2, 20, y - 0.1, y + 30, 5, y);
  parts.push(t2.geometry());
  parts.push(latheFacade([{ r: 7.6, y: y + 63.1, kind: 1 }, { r: 7.2, y: y + 66, kind: 1 }, { r: 5.4, y: y + 80, kind: 1 }, { r: 3.4, y: y + 100, kind: 1 }, { r: 1.6, y: y + 118, kind: 1 }, { r: 0.9, y: y + 121, kind: 2 }, { r: 1.3, y: y + 122, kind: 2 }, { r: 0, y: y + 128, kind: 2 }], 8, { phase: Math.PI / 8 }).translate(tw[0], 0, tw[1]));
  lights.push({ x: tw[0], y: y + 58, z: tw[1], c: [1.0, 0.8, 0.55], s: 2.8 });
  // a colonnade across the forecourt front
  for (let i = -5; i <= 5; i++) {
    if (Math.abs(i) < 1) continue;
    const p = T(64, i * 7.5);
    parts.push(latheFacade([{ r: 1.0, y: y - 0.05, kind: 1 }, { r: 1.0, y: y + 0.6, kind: 1 }, { r: 0.72, y: y + 0.6, kind: 1 }, { r: 0.62, y: y + 10.4, kind: 1 }, { r: 1.0, y: y + 10.8, kind: 1 }, { r: 1.0, y: y + 11.3, kind: 1 }, { r: 0, y: y + 11.3, kind: 1 }], 10).translate(p[0], 0, p[1]));
  }
  const ent = T(64, 0);
  parts.push(islandPrism(rectangle(ent[0], ent[1], 3.2, 82, ang), y + 11.3, y + 12.6, 1, 9));
  return { top, door: T(104, 0), q: baseQ, spire: tw, P0 };
}
