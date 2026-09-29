import * as THREE from 'three';
import { CB } from '../craft/craftGeometry.js';
import { LK } from './lunarMaterial.js';
import { LAMP } from './lamps.js';
import { surfaceY } from './lunarSite.js';
import { seat, mulberry, KIT_R } from './lunarKit.js';

// Medii Works: the working half of Medii Landing, inland of the landing fields (metres, site
// frame; planning coordinates u along the shore, v toward the Bay, as in lunarLanding.js).
//
//   the Fields Line   an elevated maglev, 11 m up on T-pylons, from the domes quarter past
//                     the three landing fields, round to the Works and the minehead; five
//                     stations with canopied platforms, stair towers and a plaza below each
//   the plant         regolith processing: the smelter hall and its tower, the electrolysis
//                     sheds, the oxygen and metal silos, a receiving hopper, a conveyor
//                     gallery from the mine, pipe racks, the radiator farm that dumps the heat
//   the mine          an open working: a packed-regolith apron, the working face (a stepped
//                     bench of fresh regolith the excavators dig into), spoil terraces, a
//                     haul loop to the hopper, floodlight masts
//   the quarter       the works' homes: rows of regolith-shielded vaults round a paved square,
//                     two pressure domes of gardens, masts and lit signage
//   the array         twelve thousand dual-axis solar trackers on a service-road grid
//   the ground        boulders and small fresh craters around it all
//
// Everything unique is merged into one geometry; repeated parts are returned as instance
// placements for the kit (lunarKit.js), and the moving things' routes (rail, haul loop,
// service roads) as polylines for lunarTraffic.js.

const S2 = Math.SQRT1_2;
const UV = (u, v) => [(u - v) * S2, (u + v) * S2];
const ROT_UV = -Math.PI / 4;
const UP = new THREE.Vector3(0, 1, 0);
const gy = (x, z) => surfaceY(x, z);
const _m = new THREE.Matrix4();

export const RAIL_H = 11;                         // guideway top above the ground (m)
export const TRACK_X = 2.4;                       // the two tracks either side of the line's axis
export const RAIL_CORNERS = [[-2300, -2080], [2500, -2080], [3100, -2680], [3100, -5700]];
export const RAIL_STATIONS = [['Domes West', -1900, -2080], ['Fields', -930, -2080], ['Array', 1600, -2080], ['Works', 3100, -4180], ['Minehead', 3100, -5560]];
export const ARRAY = { u0: 800, u1: 2300, v0: -4900, v1: -3150, du: 14, dv: 16 };
export const MINE = { u0: 3500, u1: 5100, v0: -6300, v1: -5200 };
export const PLANT = { u0: 3350, u1: 4300, v0: -4950, v1: -3900 };
export const QUARTER = { u0: 3300, u1: 4350, v0: -3780, v1: -3050 };
export const RADS = { u0: 4420, u1: 4940, v0: -4900, v1: -3950 };

/** Round a (u, v) polyline's corners with arcs of radius r and resample it every `step` m. */
export function filletPath(corners, r, step) {
  const pts = [corners[0]];
  for (let i = 1; i < corners.length - 1; i++) {
    const [a, b, c] = [corners[i - 1], corners[i], corners[i + 1]];
    const d1 = [b[0] - a[0], b[1] - a[1]], d2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    d1[0] /= l1; d1[1] /= l1; d2[0] /= l2; d2[1] /= l2;
    const th = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
    const t = Math.min(r * Math.tan(th / 2), l1 * 0.45, l2 * 0.45);
    const p0 = [b[0] - d1[0] * t, b[1] - d1[1] * t], p1 = [b[0] + d2[0] * t, b[1] + d2[1] * t];
    for (let k = 0; k <= 12; k++) {
      const s = k / 12, a0 = (1 - s) * (1 - s), a1 = 2 * s * (1 - s), a2 = s * s;
      pts.push([a0 * p0[0] + a1 * b[0] + a2 * p1[0], a0 * p0[1] + a1 * b[1] + a2 * p1[1]]);
    }
  }
  pts.push(corners[corners.length - 1]);
  // resample evenly
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = step - carry;
    while (s <= L) { out.push([a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L]); s += step; }
    carry = L - (s - step);
  }
  const last = pts[pts.length - 1], tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last);
  return out;
}

/** landingPlan: the town's footprints (lunarLanding.js), kept clear of craters and boulders. */
export function buildMediiWorks(landingPlan = [], driver = null) {
  const B = new CB();
  const lamps = [];
  const plan = [];
  const inst = {};                          // part -> [{ m: Matrix4, tint?: [r, g, b] }]
  const put = (part, m, tint) => (inst[part] ||= []).push({ m: m.clone(), tint });
  const rnd = mulberry(8123);
  const at = (u, v, h = 0) => { const [x, z] = UV(u, v); return new THREE.Vector3(x, gy(x, z) + h, z); };
  const lamp = (u, v, h, color, i = 1.0, r = 1.4, extra = {}) => lamps.push({ p: at(u, v, h), r, color, i, ...extra });
  const foot = (kind, u0, u1, v0, v1) => plan.push({ kind, u0, u1, v0, v1 });
  /** Push a frame seated on the sphere at (u, v), local x along u, z along v, turned by yaw. */
  const pushAt = (u, v, yaw = 0, h = 0) => { const [x, z] = UV(u, v); B.push(seat(_m, x, z, ROT_UV + yaw, h)); };
  const placeAt = (part, u, v, yaw = 0, h = 0, s = 1, tint) => { const [x, z] = UV(u, v); put(part, seat(_m, x, z, ROT_UV + yaw, h, s), tint); };
  /** A slab of packed ground or paving over a u/v rectangle, tessellated to follow the sphere. */
  const pad = (u0, u1, v0, v1, top, k, stepM = 120) => {
    const nu = Math.max(1, Math.ceil((u1 - u0) / stepM)), nv = Math.max(1, Math.ceil((v1 - v0) / stepM));
    const grid = (h, kind, hint) => {
      const ids = [];
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const u = u0 + (u1 - u0) * i / nu, v = v0 + (v1 - v0) * j / nv; const [x, z] = UV(u, v);
        ids.push(B.v(x, gy(x, z) + h, z, v, u, kind));
      }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = ids[j * (nu + 1) + i], b = a + 1, c = ids[(j + 1) * (nu + 1) + i], d = c + 1; B.tri(a, b, d, hint); B.tri(a, d, c, hint); }
    };
    grid(top, k, UP);
    grid(-1.5, LK.WALL, UP.clone().negate());
    const edge = (pa, pb, n) => {
      const segs = Math.max(1, Math.ceil(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / stepM));
      for (let s = 0; s < segs; s++) {
        const q = [s / segs, (s + 1) / segs].map((t) => { const u = pa[0] + (pb[0] - pa[0]) * t, v = pa[1] + (pb[1] - pa[1]) * t; const [x, z] = UV(u, v); return [x, gy(x, z), z, u + v]; });
        const ids = [[q[0], -1.5], [q[1], -1.5], [q[1], top], [q[0], top]].map(([p, h]) => B.v(p[0], p[1] + h, p[2], p[3], h, LK.WALL));
        const [nx, nz] = UV(n[0], n[1]);
        const hint = new THREE.Vector3(nx, 0, nz);
        B.tri(ids[0], ids[1], ids[2], hint); B.tri(ids[0], ids[2], ids[3], hint);
      }
    };
    edge([u0, v0], [u1, v0], [0, -1]); edge([u1, v0], [u1, v1], [1, 0]); edge([u1, v1], [u0, v1], [0, 1]); edge([u0, v1], [u0, v0], [-1, 0]);
  };

  // ------------------------------------------------------------ the Fields Line --
  const railUV = filletPath(RAIL_CORNERS, 320, 12);
  const railPts = railUV.map(([u, v]) => at(u, v, RAIL_H));
  const railS = [0];
  for (let i = 1; i < railPts.length; i++) railS.push(railS[i - 1] + railPts[i].distanceTo(railPts[i - 1]));
  const stationS = RAIL_STATIONS.map(([, u, v]) => { let bi = 0, bd = 1e9; railUV.forEach(([a, b], i) => { const d = Math.hypot(a - u, b - v); if (d < bd) { bd = d; bi = i; } }); return railS[bi]; });
  // the guideway: a box girder per sample, its top RAIL_H over the ground, a lit conduit strip
  // on each flank, and a pylon every fourth sample (48 m)
  const pylons = [];
  for (let i = 0; i < railPts.length - 1; i++) {
    const a = railPts[i], b = railPts[i + 1];
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const m = new THREE.Matrix4().lookAt(a, b, UP).setPosition(mid);
    B.push(m);
    const L = a.distanceTo(b) + 0.06;
    for (const tx of [-TRACK_X, TRACK_X]) {
      B.box(tx, -0.7, 0, 3.4, 1.4, L, LK.HULL);
      B.box(tx, -1.55, 0, 2.2, 0.3, L, LK.DARK);
      B.box(tx + Math.sign(tx) * 1.75, -0.35, 0, 0.1, 0.3, L, LK.CONDUIT);
    }
    B.pop();
    if (i % 4 === 0) {
      const [u, v] = railUV[i];
      const [x, z] = UV(u, v);
      pylons.push([u, v]);
      const dir = Math.atan2(b.x - a.x, b.z - a.z);
      B.push(seat(_m, x, z, dir, 0));
      B.box(0, -1.0, 0, 3.4, 2.0, 3.4, LK.WALL);                       // footing
      B.box(0, (RAIL_H - 1.6) / 2, 0, 2.2, RAIL_H - 1.6, 2.2, LK.STONE);
      B.box(0, RAIL_H - 2.1, 0, 9.8, 1.0, 2.0, LK.HULL);                // cap under both tracks
      B.pop();
      if (i % 16 === 0) lamps.push({ p: a.clone().add(new THREE.Vector3(0, 0.6, 0)), r: 0.9, color: LAMP.TEAL, i: 0.8 });
    }
  }
  // stations: platforms either side, canopies, a stair tower each end, a plaza below
  RAIL_STATIONS.forEach(([name, su, sv], k) => {
    const s = stationS[k];
    let i = railS.findIndex((x) => x >= s); i = Math.max(1, Math.min(railPts.length - 1, i));
    const a = railPts[i - 1], b = railPts[i];
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const [x, z] = UV(su, sv);
    B.push(seat(_m, x, z, yaw, 0));
    const PL = 140;
    // side platforms outboard of the two tracks (edges 0.1 m from the cars' flanks)
    const E = TRACK_X + 1.8;
    for (const sx of [-1, 1]) {
      B.box(sx * (E + 2.1), RAIL_H + 0.45, 0, 4.2, 0.5, PL, LK.DECK);   // platform deck, flush with the car floors
      B.box(sx * (E + 0.15), RAIL_H + 0.72, 0, 0.3, 0.06, PL, LK.HAZARD);  // edge line
      B.box(sx * (E + 4.1), RAIL_H + 1.25, 0, 0.1, 1.1, PL, LK.GLASS);  // screen
      for (let zz = -60; zz <= 60; zz += 20) B.box(sx * (E + 3.2), (RAIL_H + 0.5) / 2 - 0.3, zz, 0.9, RAIL_H + 0.5, 0.9, LK.HULL);   // platform columns
      for (let zz = -60; zz <= 60; zz += 20) B.box(sx * (E + 3.7), RAIL_H + 3.0, zz, 0.3, 4.6, 0.3, LK.HULL);    // canopy posts
      B.box(sx * (E + 2.9), RAIL_H + 2.6, -40, 0.2, 0.8, 6, LK.SIGN);  // name boards
      B.box(sx * (E + 2.9), RAIL_H + 2.6, 40, 0.2, 0.8, 6, LK.SIGN);
    }
    // canopy: a shallow glazed vault over both platforms and tracks
    const CW = E + 4.6;
    B.loft([{ z: -PL / 2 - 2, pts: [[-CW, RAIL_H + 5.2], [CW, RAIL_H + 5.2], [CW - 2.6, RAIL_H + 7.0], [-CW + 2.6, RAIL_H + 7.0]] }, { z: PL / 2 + 2, pts: [[-CW, RAIL_H + 5.2], [CW, RAIL_H + 5.2], [CW - 2.6, RAIL_H + 7.0], [-CW + 2.6, RAIL_H + 7.0]] }], LK.ROOF);
    // stair and lift towers at both ends, outboard
    const TX = E + 7.7;
    for (const zz of [-PL / 2 - 6, PL / 2 + 6]) {
      B.box(TX, (RAIL_H + 4) / 2, zz, 7, RAIL_H + 4, 9, LK.STONE);
      B.box(TX, RAIL_H + 4.3, zz, 7.6, 0.6, 9.6, LK.HULL);
      B.box(E + 4.15, RAIL_H + 1.1, zz, 1.2, 2.4, 3, LK.GLASS);
      B.box(TX + 3.55, 2.0, zz, 0.1, 3.2, 2.4, LK.DARK);
      B.box(TX + 3.6, 4.0, zz, 0.12, 0.7, 4.0, LK.SIGN);
    }
    B.pop();
    // the plaza beneath, beside the line (east of the south leg, south of the main line)
    const iu = Math.max(1, railUV.findIndex(([a, b]) => Math.hypot(a - su, b - sv) < 13));
    const nU = Math.abs(railUV[iu][1] - railUV[iu - 1][1]) > Math.abs(railUV[iu][0] - railUV[iu - 1][0]);   // the line runs along v
    const off = 34;
    if (nU) pad(su + off - 20, su + off + 20, sv - 80, sv + 80, 0.35, LK.PAVE, 60);
    else pad(su - 80, su + 80, sv - off - 20, sv - off + 20, 0.35, LK.PAVE, 60);
    for (const d of [-60, 0, 60]) lamp(su + (nU ? off : d), sv + (nU ? d : -off), 6, LAMP.AMBER, 0.9, 1.2);
    lamps.push({ p: at(su, sv, RAIL_H + 7.3), r: 1.4, color: LAMP.TEAL, i: 1.4 });
    lamps.push({ p: at(su, sv, RAIL_H + 4.8), r: 1.8, color: LAMP.WHITE, i: 1.2 });
    const fp = PL / 2 + 12;
    if (nU) foot('station', su - 22, su + off + 22, sv - fp, sv + fp); else foot('station', su - fp, su + fp, sv - off - 22, sv + 22);
  });

  // ------------------------------------------------------------ the plant --
  {
    const { u0, u1, v0, v1 } = PLANT;
    pad(u0 - 20, u1 + 20, v0 - 20, v1 + 20, 0.3, LK.GROUND, 110);
    foot('plant', u0 - 20, u1 + 20, v0 - 20, v1 + 20);
    // the smelter hall: 360 x 70 m, a clerestory, a lit window band and loading doors
    const hall = (uc, vc, L, W, H, roofK, yaw = 0) => {
      pushAt(uc, vc, yaw);
      B.box(0, H / 2 - 1, 0, L, H + 2, W, LK.STONE);
      B.box(0, H * 0.55, W / 2 + 0.05, L - 8, 2.2, 0.1, LK.GLASS);
      B.box(0, H * 0.55, -W / 2 - 0.05, L - 8, 2.2, 0.1, LK.GLASS);
      // a low-pitched roof, its ridge along the hall
      B.push(new THREE.Matrix4().makeTranslation(0, H, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
      const sec = [[-W / 2 - 0.6, 0], [W / 2 + 0.6, 0], [0, W * 0.1]];
      B.loft([{ z: -L / 2 - 0.6, pts: sec }, { z: L / 2 + 0.6, pts: sec }], roofK);
      B.pop();
      B.box(0, H + 3.2, 0, L - 20, 6.4, W * 0.36, LK.HULL);               // clerestory
      B.box(0, H + 3.6, W * 0.18 + 0.05, L - 24, 2.4, 0.1, LK.GLASS);
      B.box(0, H + 3.6, -W * 0.18 - 0.05, L - 24, 2.4, 0.1, LK.GLASS);
      B.box(0, H + 6.6, 0, L - 18, 0.4, W * 0.4, LK.ROOF);
      for (let x = -L / 2 + 30; x < L / 2 - 20; x += 60) {
        B.box(x, 5.5, W / 2 + 0.2, 12, 11, 0.3, LK.HAZARD);
        B.box(x, 5.2, W / 2 + 0.4, 10, 10, 0.2, LK.DARK);
        B.box(x, 12.4, W / 2 + 0.6, 2, 0.6, 0.8, LK.LIGHT);
      }
      B.box(-L / 2 + 30, H - 3, W / 2 + 0.3, 30, 3, 0.2, LK.SIGN);
      B.pop();
    };
    hall(3800, -4700, 360, 70, 24, LK.ROOF);
    hall(3560, -4300, 240, 50, 16, LK.PANEL);                                  // electrolysis sheds (roofs of cells)
    hall(4020, -4300, 240, 50, 16, LK.PANEL);
    hall(3800, -4040, 520, 40, 12, LK.ROOF);                                   // stores and workshops
    // the smelter tower
    pushAt(3480, -4640);
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    B.lathe([[14, -1, LK.WALL], [14, 24, LK.HULL], [12, 60, LK.HULL], [9, 64, LK.BRONZE], [9, 92, LK.HULL], [7, 96, LK.DARK], [6, 96, LK.DARK], [6, 92, LK.DARK]], 20);
    B.lathe([[12.6, 40, LK.DECK], [15.5, 40, LK.DECK], [15.5, 41, LK.DECK], [12.4, 41, LK.DECK]], 20);
    B.lathe([[9.4, 78, LK.RADIATOR], [9.4, 86, LK.RADIATOR]], 20);
    B.pop(); B.pop();
    lamps.push({ p: at(3480, -4640, 99), r: 2.4, color: LAMP.RED, i: 2.4, breathe: 0.4 });
    lamps.push({ p: at(3480, -4640, 41.6), r: 1.4, color: LAMP.AMBER, i: 1.2 });
    // silos: two ranks
    for (let i = 0; i < 6; i++) placeAt('silo', 4180 + (i % 3) * 22, -4540 - Math.floor(i / 3) * 24, 0);
    // receiving hopper: a funnel on legs over the haul loop's head
    pushAt(4300, -4960);
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    B.lathe([[3, 14, LK.HULL], [16, 26, LK.HULL], [16, 32, LK.PAINT], [15, 32.5, LK.DARK], [0, 30, LK.DARK]], 16);
    B.pop();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; B.box(Math.cos(a) * 12, 13, Math.sin(a) * 12, 1.4, 26, 1.4, LK.HULL); }
    B.box(0, 7, 0, 6, 1, 26, LK.HAZARD);
    B.pop();
    // conveyor gallery: from the hopper up into the smelter hall
    {
      const A = at(4300, -4960, 28), C2 = at(3990, -4740, 30);
      const m = new THREE.Matrix4().lookAt(A, C2, UP).setPosition(A.clone().add(C2).multiplyScalar(0.5));
      B.push(m);
      const L = A.distanceTo(C2);
      B.box(0, 0, 0, 4.4, 3.6, L, LK.HULL);
      B.box(0, 0.3, 0, 4.5, 1.2, L - 2, LK.GLASS);
      B.box(0, 2.0, 0, 3.4, 0.4, L, LK.CONDUIT);
      B.pop();
      for (let t = 0.15; t < 0.95; t += 0.2) {
        const p = A.clone().lerp(C2, t);
        const [u, v] = [4300 + (3990 - 4300) * t, -4960 + (-4740 + 4960) * t];
        pushAt(u, v);
        B.box(0, (p.y - at(u, v).y - 1.8) / 2, 0, 1.6, p.y - at(u, v).y - 1.8, 1.6, LK.HULL);
        B.pop();
      }
    }
    // pipe racks from the sheds to the silos and the radiators
    for (const [ua, va, ub, vb] of [[3680, -4300, 3900, -4300], [4140, -4300, 4430, -4300], [4150, -4590, 4430, -4590], [3560, -4330, 3560, -4640]]) {
      const pa = at(ua, va, 9), pb = at(ub, vb, 9);
      for (const off of [-0.8, 0, 0.8]) B.tube([pa.clone().add(new THREE.Vector3(0, off, 0)), pb.clone().add(new THREE.Vector3(0, off, 0))], 0.35, 6, off === 0 ? LK.CONDUIT : LK.BRONZE);
      const n = Math.max(1, Math.round(Math.hypot(ub - ua, vb - va) / 30));
      for (let k = 0; k <= n; k++) { const u = ua + (ub - ua) * k / n, v = va + (vb - va) * k / n; pushAt(u, v); B.box(0, 4.3, 0, 0.6, 8.6, 0.6, LK.HULL); B.box(0, 8.6, 0, 3.2, 0.4, 0.6, LK.HULL); B.pop(); }
    }
    // floodlights round the yard
    for (let u = u0; u <= u1; u += 190) for (const v of [v0 + 20, v1 + 20]) {
      if (v < v0 + 30 && Math.abs(u - 4300) < 50) continue;             // clear of the hopper
      placeAt('mast', u, v, 0); lamp(u, v, 17.6, LAMP.WHITE, 1.3, 1.8);
    }
  }
  // the silos' second rank, by the stores
  for (let i = 0; i < 4; i++) placeAt('silo', 3420 + i * 22, -3960, 0);

  // ------------------------------------------------------------ the radiator farm --
  {
    const { u0, u1, v0, v1 } = RADS;
    pad(u0, u1, v0, v1, 0.25, LK.GROUND, 120);
    foot('radiators', u0, u1, v0, v1);
    for (let v = v0 + 30; v < v1 - 20; v += 26) {
      for (let u = u0 + 20; u < u1 - 10; u += 4.6) placeAt('radiator', u, v, 0, 0.25);
      const pa = at(u0 + 14, v, 15.8), pb = at(u1 - 8, v, 15.8);
      B.tube([pa, pb], 0.5, 6, LK.CONDUIT);
    }
    lamp(u0, v0, 18, LAMP.RED, 1.4, 1.6, { breathe: 0.3 });
    lamp(u1, v1, 18, LAMP.RED, 1.4, 1.6, { breathe: 0.3 });
  }

  // ------------------------------------------------------------ the quarter --
  {
    const { u0, u1, v0, v1 } = QUARTER;
    foot('quarter', u0, u1, v0, v1);
    // the square and its walks
    pad(3600, 4050, -3520, -3300, 0.35, LK.PAVE, 90);
    placeAt('dome', 3700, -3160, 0);
    placeAt('dome', 3960, -3160, 0.4);
    for (const [u, v] of [[3700, -3160], [3960, -3160]]) lamps.push({ p: at(u, v, 8.8 + 30 * 0.78 + 6.2), r: 1.6, color: LAMP.AMBER, i: 1.3 });
    // rows of vaults, doors to the square
    const rows = [[-3600, 0], [-3700, Math.PI]];
    for (let u = 3360; u <= 4300; u += 34) {
      if (u > 3585 && u < 4065) {
        for (const [v, yaw] of rows) placeAt('vault', u, v, yaw);
      } else {
        for (const v of [-3380, -3470, -3600, -3700]) placeAt('vault', u, v, v > -3500 ? Math.PI : 0);
      }
    }
    // the vaults' door lamps
    for (let u = 3360; u <= 4300; u += 68) lamp(u, -3600 + 18.6, 5.4, LAMP.AMBER, 0.7, 1.0);
    for (let u = 3620; u <= 4040; u += 60) for (const v of [-3500, -3320]) lamp(u, v, 5.2, LAMP.AMBER, 0.9, 1.1);
    for (const [u, v] of [[3600, -3300], [4050, -3300], [3600, -3520], [4050, -3520]]) placeAt('mast', u, v, 0);
    // a sign pylon on the square
    pushAt(3825, -3410);
    B.box(0, 6, 0, 2.4, 12, 2.4, LK.STONE);
    for (const r of [0, Math.PI / 2]) { B.push(new THREE.Matrix4().makeRotationY(r)); B.box(0, 9, 0, 1.6, 4, 2.6, LK.SIGN); B.pop(); }
    B.pop();
  }

  // ------------------------------------------------------------ the mine --
  const haul = [];
  {
    const { u0, u1, v0, v1 } = MINE;
    pad(u0, u1, v0, v1, 0.25, LK.GROUND, 110);
    foot('mine', u0, u1, v0, v1 + 225);                    // (the haul loop runs on into the plant's yard, to the hopper)
    // the working face: three benches stepping up to the undisturbed plain beyond (v < v0)
    const bench = (vA, h, depth) => {
      const n = 24;
      for (let i = 0; i < n; i++) {
        const ua = u0 + (u1 - u0) * i / n, ub = u0 + (u1 - u0) * (i + 1) / n;
        const wob = (u) => 8 * Math.sin(u * 0.011) + 4 * Math.sin(u * 0.037 + 1.3);
        const P0 = [ua, vA + wob(ua)], P1 = [ub, vA + wob(ub)];
        const ids = [];
        for (const [u, v] of [P0, P1]) {
          const [x, z] = UV(u, v), [x2, z2] = UV(u, v - depth), [x3, z3] = UV(u, v - depth - 6);
          ids.push([B.v(x, gy(x, z) - 0.5, z, u, 0, LK.REGOLITH), B.v(x2, gy(x2, z2) + h, z2, u, h * 1.5, LK.REGOLITH), B.v(x3, gy(x3, z3) + h, z3, u, h * 1.5 + 6, LK.REGOLITH), B.v(x3, gy(x3, z3) - 0.5, z3, u, 0, LK.REGOLITH)]);
        }
        const [a, b] = ids;
        const out = (() => { const [x, z] = UV(0, 1); return new THREE.Vector3(x, 0.3, z); })();
        B.tri(a[0], b[0], b[1], out); B.tri(a[0], b[1], a[1], out);            // the sloped face
        B.tri(a[1], b[1], b[2], UP); B.tri(a[1], b[2], a[2], UP);              // the bench top
        const back = out.clone().negate();
        B.tri(a[3], b[3], b[2], back); B.tri(a[3], b[2], a[2], back);
        if (i === 0) { const n0 = (() => { const [x, z] = UV(-1, 0); return new THREE.Vector3(x, 0, z); })(); B.tri(a[0], a[1], a[2], n0); B.tri(a[0], a[2], a[3], n0); }
        if (i === n - 1) { const n1 = (() => { const [x, z] = UV(1, 0); return new THREE.Vector3(x, 0, z); })(); B.tri(b[0], b[1], b[2], n1); B.tri(b[0], b[2], b[3], n1); }
      }
    };
    bench(v0 + 40, 7, 18);
    bench(v0 + 14, 14, 18);
    // spoil terraces: stepped mounds of tailings east of the working
    for (const [u, v, R, H] of [[5360, -5500, 150, 26], [5420, -5900, 120, 20], [5300, -6200, 90, 14]]) {
      pushAt(u, v);
      B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      const prof = [[R, -1, LK.REGOLITH], [R, 0, LK.REGOLITH]];
      const steps = 3;
      for (let s = 0; s < steps; s++) {
        const r0 = R * (1 - s / steps * 0.8), r1 = r0 - R * 0.12, h0 = H * s / steps, h1 = H * (s + 1) / steps;
        prof.push([r1, h1, LK.REGOLITH], [r1 - R * 0.14, h1, LK.REGOLITH]);
        void r0; void h0;
      }
      prof.push([0, H + 0.5, LK.REGOLITH]);
      B.lathe(prof, 28, rnd() * 3);
      B.pop(); B.pop();
      foot('spoil', u - R, u + R, v - R, v + R);
    }
    // the haul loop: face to the hopper and back (packed regolith road, 14 m)
    const loop = [[3900, -6040], [4700, -6040], [4760, -5700], [4700, -5160], [4460, -4990], [4300, -4960], [4140, -4990], [3900, -5160], [3840, -5700], [3900, -6040]];
    const hp = filletPath(loop, 90, 10);
    for (let i = 0; i < hp.length - 1; i++) {
      const a = at(hp[i][0], hp[i][1], 0.4), b = at(hp[i + 1][0], hp[i + 1][1], 0.4);
      const m = new THREE.Matrix4().lookAt(a, b, UP).setPosition(a.clone().add(b).multiplyScalar(0.5));
      B.push(m); B.box(0, -0.4, 0, 14, 1.2, a.distanceTo(b) + 0.4, LK.GROUND); B.pop();
    }
    for (const p of hp) haul.push(at(p[0], p[1], 0.8));
    // floodlight masts round the working
    for (let u = u0 + 100; u < u1; u += 260) { placeAt('mast', u, v1 - 10, Math.PI); lamp(u, v1 - 10, 17.6, LAMP.WHITE, 1.5, 2.0); }
    for (const u of [u0 + 60, u1 - 60]) { placeAt('mast', u, v0 + 90, 0); lamp(u, v0 + 90, 17.6, LAMP.WHITE, 1.5, 2.0); }
  }
  // excavators at the face (their wheels turn in lunarTraffic.js)
  const excavators = [];
  for (const [u, yaw] of [[3700, Math.PI], [4050, Math.PI], [4520, Math.PI], [4890, Math.PI]]) {
    const v = MINE.v0 + 40 + 8 * Math.sin(u * 0.011) + 4 * Math.sin(u * 0.037 + 1.3) + 24;
    const [x, z] = UV(u, v);
    excavators.push({ x, z, yaw: ROT_UV + yaw, u, v });
    put('excavator', seat(_m, x, z, ROT_UV + yaw, 0.25), [0.86, 0.62, 0.12]);
  }

  // ------------------------------------------------------------ the array --
  const trackers = [];
  {
    const { u0, u1, v0, v1, du, dv } = ARRAY;
    foot('array', u0 - 8, u1 + 8, v0 - 8, v1 + 8);
    // service roads every 18 rows and every 36 columns
    let rows = 0;
    for (let v = v0; v <= v1; v += dv, rows++) {
      if (rows % 18 === 9) continue;
      let col = 0;
      for (let u = u0; u <= u1; u += du, col++) {
        if (col % 36 === 18) continue;
        const [x, z] = UV(u, v);
        trackers.push([x, z]);
      }
    }
    for (let r = 9; r * dv < v1 - v0; r += 18) { const v = v0 + r * dv; pad(u0, u1, v - 5, v + 5, 0.25, LK.GROUND, 150); }
    for (let c = 18; c * du < u1 - u0; c += 36) { const u = u0 + c * du; pad(u - 5, u + 5, v0, v1, 0.26, LK.GROUND, 150); }
    // inverter kiosks at the road crossings
    for (let r = 9; r * dv < v1 - v0; r += 18) for (let c = 18; c * du < u1 - u0; c += 36) {
      pushAt(u0 + c * du + 9, v0 + r * dv + 9);
      B.box(0, 1.4, 0, 4, 2.8, 2.6, LK.HULL); B.box(0, 2.9, 0, 4.4, 0.3, 3.0, LK.DARK); B.box(0, 1.4, 1.32, 1.0, 2.0, 0.06, LK.HAZARD);
      B.pop();
    }
  }

  // ------------------------------------------------------------ the service road --
  // beside the Line's south leg, from the Array station's plaza down to the minehead
  const service = [[1600, -2140], [2440, -2140], [3040, -2700], [3040, -5640]].map(([u, v]) => [u, v]);
  const svc = filletPath(service, 260, 14);
  for (let i = 0; i < svc.length - 1; i++) {
    const a = at(svc[i][0], svc[i][1], 0.3), b = at(svc[i + 1][0], svc[i + 1][1], 0.3);
    const m = new THREE.Matrix4().lookAt(a, b, UP).setPosition(a.clone().add(b).multiplyScalar(0.5));
    B.push(m); B.box(0, -0.45, 0, 12, 1.5, a.distanceTo(b) + 0.3, LK.GROUND); B.pop();
  }
  const servicePts = svc.map(([u, v]) => at(u, v, 0.6));

  // ------------------------------------------------------------ the ground --
  // small fresh craters: a raised rim of regolith round a dark floor, and boulders
  const blocked = (u, v, pad0 = 0) => plan.some((p) => u > p.u0 - pad0 && u < p.u1 + pad0 && v > p.v0 - pad0 && v < p.v1 + pad0)
    || pylons.some(([a, b]) => Math.hypot(a - u, b - v) < 12 + pad0)
    || landingPlan.some((p) => p.u0 !== undefined && u > p.u0 - pad0 && u < p.u1 + pad0 && v > p.v0 - pad0 && v < p.v1 + pad0)
    || Math.hypot(u, v) < 3000 || nearDriver(u, v) < 40 + pad0;
  // the mass driver's line in (u, v): its pylons and beam stand on it
  const dP = driver ? [(driver.P0.x + driver.P0.z) * S2, (driver.P0.z - driver.P0.x) * S2] : null;
  const dD = driver ? (() => { const a = (driver.dir.x + driver.dir.z) * S2, b = (driver.dir.z - driver.dir.x) * S2, l = Math.hypot(a, b); return [a / l, b / l]; })() : null;
  const nearDriver = (u, v) => {
    if (!dP) return 1e9;
    const px = u - dP[0], pz = v - dP[1], t = px * dD[0] + pz * dD[1];
    return t < -300 ? 1e9 : Math.abs(px * dD[1] - pz * dD[0]);
  };
  const craters = [];
  for (let n = 0; n < 400 && craters.length < 48; n++) {
    const u = 400 + rnd() * 5600, v = -7200 + rnd() * 4800;
    const R = 8 + 70 * rnd() ** 3;
    if (blocked(u, v, R * 1.6 + 20) || craters.some((c) => Math.hypot(c[0] - u, c[1] - v) < (c[2] + R) * 1.8)) continue;
    if (Math.abs(v - (-2080)) < R * 1.6 + 20 || servicePts.some((p) => { const [x, z] = UV(u, v); return Math.hypot(p.x - x, p.z - z) < R * 1.6 + 16; })) continue;
    craters.push([u, v, R]);
    pushAt(u, v, rnd() * 6);
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const h = R * 0.09;
    B.lathe([[R * 0.72, 0.12, LK.GROUND], [R * 0.95, h, LK.REGOLITH], [R * 1.08, h * 0.95, LK.REGOLITH], [R * 1.5, 0.05, LK.REGOLITH], [R * 1.5, -0.8, LK.REGOLITH], [R * 0.72, -0.8, LK.REGOLITH], [R * 0.72, 0.12, LK.GROUND]], Math.max(16, Math.round(R * 0.8)), 0, { closedProfile: true });
    B.lathe([[0, 0.14, LK.GROUND], [R * 0.74, 0.14, LK.GROUND], [R * 0.74, -0.6, LK.GROUND], [0, -0.6, LK.GROUND]], Math.max(16, Math.round(R * 0.8)));
    B.pop(); B.pop();
    plan.push({ kind: 'crater', u0: u - R * 1.5, u1: u + R * 1.5, v0: v - R * 1.5, v1: v + R * 1.5 });
  }
  // boulders: ejecta round the craters and the mine, a thin scatter elsewhere
  const boulders = [];
  const addBoulder = (u, v, s) => {
    if (blocked(u, v, s + 2)) return;
    const [x, z] = UV(u, v);
    boulders.push({ part: 'boulder' + (boulders.length % 3), x, z, s, yaw: rnd() * 6.283, tone: 0.8 + rnd() * 0.35 });
  };
  for (const [cu, cv, R] of craters) for (let k = 0; k < Math.round(R * 1.2); k++) {
    const a = rnd() * 6.283, d = R * (1.55 + rnd() * rnd() * 2.5);
    addBoulder(cu + Math.cos(a) * d, cv + Math.sin(a) * d, 0.3 + R * 0.03 * rnd() + rnd() * rnd() * 1.5);
  }
  for (let k = 0; k < 900; k++) {
    const u = MINE.u0 - 200 + rnd() * (MINE.u1 - MINE.u0 + 700), v = MINE.v0 - 900 + rnd() * 900;
    addBoulder(u, v, 0.4 + 4 * rnd() ** 4);
  }
  for (let k = 0; k < 1600; k++) addBoulder(300 + rnd() * 6000, -7400 + rnd() * 5000, 0.3 + 2.8 * rnd() ** 5);
  for (const b of boulders) put(b.part, seat(_m, b.x, b.z, b.yaw, -0.1 * b.s, b.s), [b.tone, b.tone * 0.97, b.tone * 0.93]);

  const geo = B.geometry();
  return {
    geo, lamps, plan, inst, trackers, excavators, craters, boulders,
    rail: { pts: railPts, s: railS, stations: stationS, names: RAIL_STATIONS.map((r) => r[0]) },
    haul, service: servicePts,
  };
}

export { KIT_R };
