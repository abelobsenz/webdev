import * as THREE from 'three';
import { CB } from '../craft/craftGeometry.js';
import { LK } from './lunarMaterial.js';
import { LAMP } from './lamps.js';
import { BAY, surfaceY, surfaceUp } from './lunarSite.js';
import { buildLandingLife, marketHall } from './lunarLandingLife.js';
import { TREE_SINK } from './lunarTrees.js';

// Medii Landing: the Moon's surface port beneath the Tranquillity Exchange. Metres, site
// frame (x west, y up, z north), origin at the foot of the Lift.
//
// Planning axes: u runs along the shore of the Bay (toward the north-west), v runs down
// to the water (north-east). The town steps down to the harbour on four terraces: the
// Lift terrace with its plaza and pools (+7 m), the middle and lower towns of courtyard
// blocks (+5.5, +4 m) on a street grid either side of the Boulevard, and the Strand (+2.5
// m) whose sea wall is built on the drawn coast. Behind the Lift stand the five glass
// domes of the old settlement, linked by glazed arcades; beyond them three landing
// fields with blast walls; and to the west the mass driver climbs away over the plain on
// a colonnade of pylons, 36 km to its launch gate. Every solid is closed and seated on
// the sphere the Moon is drawn as: terrace tops follow its curvature, walls and pylons
// reach below it, and the moles and piers stand in the Bay with their feet under water.

const S2 = Math.SQRT1_2;
const UV = (u, v) => [(u - v) * S2, (u + v) * S2];
const V_C = Math.hypot(BAY.x, BAY.z) * 1000, R_B = BAY.r * 1000;
/** v of the Bay's shore at u (metres). */
export const shoreV = (u) => V_C - Math.sqrt(R_B * R_B - u * u);
const gy = (x, z) => surfaceY(x, z);
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const ROT_UV = -Math.PI / 4;       // local x -> u, local z -> v

/** The three landing fields' centres (u, v metres); pad top 1.2 m, radius 248, blast walls to 276. */
export const PADS = [[-1350, -2500], [-500, -2900], [350, -2500]];

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------------ builders --

/**
 * A closed terrace slab over the u/v rectangle [u0,u1] x [v0, v1(u)], its top `top` metres
 * above the sphere everywhere (tessellated so the curvature is followed), its foot `bot`
 * metres below it.
 */
function slabUV(B, u0, u1, v0, v1, top, { bot = -4, kTop = LK.PAVE, kSide = LK.WALL, step = 110 } = {}) {
  const v1f = typeof v1 === 'function' ? v1 : () => v1;
  const nu = Math.max(1, Math.ceil((u1 - u0) / step));
  const nv = Math.max(1, Math.ceil((Math.max(v1f(u0), v1f(u1), v1f((u0 + u1) / 2)) - v0) / step));
  const pt = (i, j) => { const u = u0 + (u1 - u0) * i / nu; const v = v0 + (v1f(u) - v0) * j / nv; return [u, v, ...UV(u, v)]; };
  const grid = (h, k, hint) => {
    const ids = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const [u, v, x, z] = pt(i, j); ids.push(B.v(x, gy(x, z) + h, z, u, v, k)); }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = ids[j * (nu + 1) + i], b = a + 1, c = ids[(j + 1) * (nu + 1) + i], d = c + 1;
      B.tri(a, b, d, hint); B.tri(a, d, c, hint);
    }
  };
  grid(top, kTop, UP);
  grid(bot, kSide, DOWN);
  // four walls, each vertical from the foot to the top, subdivided along its length
  const wall = (pts, outward) => {
    let L = 0;
    for (let s = 0; s < pts.length - 1; s++) {
      const [ua, va, xa, za] = pts[s], [ub, vb, xb, zb] = pts[s + 1];
      const len = Math.hypot(xb - xa, zb - za);
      const a0 = B.v(xa, gy(xa, za) + bot, za, L, 0, kSide), a1 = B.v(xa, gy(xa, za) + top, za, L, top - bot, kSide);
      const b0 = B.v(xb, gy(xb, zb) + bot, zb, L + len, 0, kSide), b1 = B.v(xb, gy(xb, zb) + top, zb, L + len, top - bot, kSide);
      const n = outward(ua, va);
      B.tri(a0, b0, b1, n); B.tri(a0, b1, a1, n);
      L += len;
    }
  };
  const eu = (su) => new THREE.Vector3(su * S2, 0, su * S2), ev = (sv) => new THREE.Vector3(-sv * S2, 0, sv * S2);
  const edge = (fn, n) => { const a = []; for (let t = 0; t <= n; t++) a.push(fn(t)); return a; };
  wall(edge((j) => pt(0, j), nv), () => eu(-1));
  wall(edge((j) => pt(nu, j), nv), () => eu(1));
  wall(edge((i) => pt(i, 0), nu), () => ev(-1));
  wall(edge((i) => pt(i, nv), nu), (u) => {
    // the far edge may follow the shore: its normal turns with it
    const d = 1;
    const t = (v1f(u + d) - v1f(u - d)) / (2 * d);
    return new THREE.Vector3(-S2 - t * S2, 0, S2 - t * S2).normalize();
  });
}

/** Closed prism over a small convex or simple polygon (x, z metres), top/foot relative to the sphere. */
function prism(B, poly, top, bot, kTop, kSide) {
  const tris = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
  const T = poly.map(([x, z]) => B.v(x, gy(x, z) + top, z, x, z, kTop));
  const Bt = poly.map(([x, z]) => B.v(x, gy(x, z) + bot, z, x, z, kSide));
  for (const [a, b, c] of tris) { B.tri(T[a], T[b], T[c], UP); B.tri(Bt[a], Bt[b], Bt[c], DOWN); }
  let L = 0;
  const n = poly.length;
  // signed area for outward normals
  let area = 0;
  for (let i = 0; i < n; i++) { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n]; area += x0 * z1 - x1 * z0; }
  const sgn = Math.sign(area) || 1;
  for (let i = 0; i < n; i++) {
    const [xa, za] = poly[i], [xb, zb] = poly[(i + 1) % n];
    const len = Math.hypot(xb - xa, zb - za);
    const nrm = new THREE.Vector3(zb - za, 0, -(xb - xa)).multiplyScalar(sgn).normalize();
    const a0 = B.v(xa, gy(xa, za) + bot, za, L, 0, kSide), a1 = B.v(xa, gy(xa, za) + top, za, L, top - bot, kSide);
    const b0 = B.v(xb, gy(xb, zb) + bot, zb, L + len, 0, kSide), b1 = B.v(xb, gy(xb, zb) + top, zb, L + len, top - bot, kSide);
    B.tri(a0, b0, b1, nrm); B.tri(a0, b1, a1, nrm);
    L += len;
  }
}

/** Gabled roof prism on a w x d footprint (local x along the ridge), ridge h above y0. */
// (each roof takes the next 1000 m of facade x: the material gives every roof its own tiles)
let roofN = 0;
function gable(B, y0, w, d, h, k) {
  const hx = w / 2, hz = d / 2, off = 1000 * (roofN++ % 97);
  const p = [[-hx, y0, -hz], [hx, y0, -hz], [hx, y0, hz], [-hx, y0, hz], [-hx, y0 + h, 0], [hx, y0 + h, 0]];
  const slope = Math.hypot(hz, h);
  const id = (i, fu, fv) => B.v(p[i][0], p[i][1], p[i][2], fu + off, fv, k);
  // slopes (facade: along the ridge, up the slope)
  { const a = id(0, -hx, 0), b = id(1, hx, 0), c = id(5, hx, slope), e = id(4, -hx, slope); const n = new THREE.Vector3(0, hz, -h); B.tri(a, b, c, n); B.tri(a, c, e, n); }
  { const a = id(3, -hx, 0), b = id(2, hx, 0), c = id(5, hx, slope), e = id(4, -hx, slope); const n = new THREE.Vector3(0, hz, h); B.tri(a, b, c, n); B.tri(a, c, e, n); }
  { const a = id(0, -hz, 0), b = id(3, hz, 0), c = id(4, 0, h); B.tri(a, b, c, new THREE.Vector3(-1, 0, 0)); }
  { const a = id(1, -hz, 0), b = id(2, hz, 0), c = id(5, 0, h); B.tri(a, b, c, new THREE.Vector3(1, 0, 0)); }
  { const a = id(0, -hx, -hz), b = id(1, hx, -hz), c = id(2, hx, hz), e = id(3, -hx, hz); B.tri(a, b, c, DOWN); B.tri(a, c, e, DOWN); }
}

/** A closed curved wall: ring sector between radii r0, r1, angles a0..a1 (local XZ), y0..y1. */
function arcWall(B, r0, r1, a0, a1, y0, y1, k, seg = 24) {
  const ids = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + (a1 - a0) * i / seg, c = Math.cos(a), s = Math.sin(a), L = a * r1;
    ids.push([B.v(c * r0, y0, s * r0, L, 0, k), B.v(c * r1, y0, s * r1, L, 0, k), B.v(c * r1, y1, s * r1, L, y1 - y0, k), B.v(c * r0, y1, s * r0, L, y1 - y0, k)]);
  }
  for (let i = 0; i < seg; i++) {
    const A = ids[i], Bq = ids[i + 1];
    const am = a0 + (a1 - a0) * (i + 0.5) / seg, out = new THREE.Vector3(Math.cos(am), 0, Math.sin(am));
    B.tri(A[1], Bq[1], Bq[2], out); B.tri(A[1], Bq[2], A[2], out);                 // outer
    B.tri(A[0], Bq[0], Bq[3], out.clone().negate()); B.tri(A[0], Bq[3], A[3], out.clone().negate());   // inner
    B.tri(A[3], Bq[3], Bq[2], UP); B.tri(A[3], Bq[2], A[2], UP);                   // top
    B.tri(A[0], Bq[0], Bq[1], DOWN); B.tri(A[0], Bq[1], A[1], DOWN);               // foot
  }
  for (const [Q, sgn] of [[ids[0], -1], [ids[seg], 1]]) {
    const a = sgn < 0 ? a0 : a1;
    const n = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(sgn);
    B.tri(Q[0], Q[1], Q[2], n); B.tri(Q[0], Q[2], Q[3], n);
  }
}

/** Flat disc (radius r) at y with planar facade coordinates (for the pad markings). */
function disc(B, r, y, k, hint, seg = 48, rings = 4) {
  const c = B.v(0, y, 0, 0, 0, k);
  let prev = null;
  for (let j = 1; j <= rings; j++) {
    const rr = r * j / rings, cur = [];
    for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2; cur.push(B.v(Math.cos(a) * rr, y, Math.sin(a) * rr, Math.cos(a) * rr, Math.sin(a) * rr, k)); }
    for (let i = 0; i < seg; i++) {
      const i1 = (i + 1) % seg;
      if (!prev) B.tri(c, cur[i], cur[i1], hint);
      else { B.tri(prev[i], cur[i], cur[i1], hint); B.tri(prev[i], cur[i1], prev[i1], hint); }
    }
    prev = cur;
  }
}

/** A tapered column between two points along a direction (closed loft of squares). */
function column(B, a, b, w0, w1, k) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  d.normalize();
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), d, Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP);
  m.setPosition(a);
  B.push(m);
  const sq = (w) => [[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]];
  B.loft([{ z: 0, pts: sq(w0) }, { z: -L, pts: sq(w1) }], k);
  B.pop();
}

// ------------------------------------------------------------------ the town --

export function buildMediiLanding() {
  roofN = 0;
  const B = new CB();
  // round things turned to ~3 m facets (up to 96 sides): at the builder's default 16 the domes,
  // halls, pads and towers read as polygons from the street
  const lathe0 = B.lathe.bind(B);
  B.lathe = (prof, seg = 16, ...rest) => { let R = 0; for (const p of prof) R = Math.max(R, Math.abs(p[0])); return lathe0(prof, Math.max(seg, Math.min(96, Math.ceil((Math.PI * 2 * R) / 3))), ...rest); };
  const lamps = [];
  const plan = [];                  // footprints (u, v rectangles, metres) for the overlap checks
  const courts = [];                // courtyard interiors (for their trees)
  // what the instanced detail dresses (lunarLandingDetail.js, lunarLandingProps.js): every house
  // with its frame and fronts, the lamp standards, quay edges, piers, the pads' rims
  const houses = [], props = { lamps: [], quay: [], piers: [], boats: [], stairs: [], terraceEdges: [] };
  const foot = (kind, u, v, w, d, alongU = true) => plan.push(alongU ? { kind, u0: u - w / 2, u1: u + w / 2, v0: v - d / 2, v1: v + d / 2 } : { kind, u0: u - d / 2, u1: u + d / 2, v0: v - w / 2, v1: v + w / 2 });
  const rnd = mulberry(4270);
  const at = (u, v, h) => { const [x, z] = UV(u, v); return new THREE.Vector3(x, gy(x, z) + h, z); };
  const lamp = (u, v, h, color, i = 1.2, r = 1.6, extra = {}) => lamps.push({ p: at(u, v, h), r, color, i, ...extra });

  const T_LIFT = 7.0, T_MID = 5.5, T_LOW = 4.0, T_STRAND = 2.5;
  const V_LOW = 1550, V_STRAND = 2900, V_MID = 550, U_TOWN = 1700;
  const DOMES = [[-650, -1150, 210], [-1250, -1000, 150], [-150, -1050, 130], [-1250, -1450, 110], [-300, -1470, 95]];
  const S = {
    B, UV, gy, at, lamp, lamps, plan, foot, courts, shoreV, rnd, prism, gable, ROT_UV, DOMES, PADS, U_TOWN, houses, props,
    T: { LIFT: T_LIFT, MID: T_MID, LOW: T_LOW, STRAND: T_STRAND }, V: { MID: V_MID, LOW: V_LOW, STRAND: V_STRAND },
  };
  // --- terraces ---
  slabUV(B, -U_TOWN, U_TOWN, V_STRAND, (u) => shoreV(u), T_STRAND, { bot: -6 });       // the Strand: its sea wall on the coast
  slabUV(B, -U_TOWN, U_TOWN, V_LOW, V_STRAND, T_LOW);
  slabUV(B, -U_TOWN, U_TOWN, V_MID, V_LOW, T_MID);
  slabUV(B, -750, 750, -650, V_MID, T_LIFT);                                          // the Lift terrace
  slabUV(B, -U_TOWN, -750, -250, V_MID, T_MID);                                       // wings of the middle town
  slabUV(B, 750, U_TOWN, -250, V_MID, T_MID);
  slabUV(B, -1600, 450, -1700, -650, T_LIFT, { kTop: LK.COURT });                     // the domes quarter: gardens round the domes

  // --- stairs where the Boulevard steps down between terraces (flights of 0.25 m risers) ---
  const flight = (vEdge, hHigh, hLow) => {
    const n = Math.round((hHigh - hLow) / 0.25);
    for (let s = 0; s < n; s++) {
      const topH = hHigh - 0.25 * (s + 1) + 0.25;         // tread height of this step
      const v0 = vEdge + s * 0.45, v1 = vEdge + (s + 1) * 0.45 + 0.02;
      const [x, z] = UV(0, (v0 + v1) / 2);
      B.at(x, gy(x, z), z, 0, ROT_UV, 0);
      const hgt = topH - hLow + 0.3;
      B.box(0, hLow - 0.3 + hgt / 2, 0, 58, hgt, v1 - v0, LK.PAVE);
      B.pop();
    }
  };
  flight(V_LOW, T_MID, T_LOW);
  flight(V_STRAND, T_LOW, T_STRAND);
  flight(V_MID, T_LIFT, T_MID);

  // --- the Boulevard: a planted median with lamps on both kerbs ---
  {
    const med = (v0, v1, h) => {
      const [x, z] = UV(0, (v0 + v1) / 2);
      B.at(x, gy(x, z) + h, z, 0, ROT_UV, 0);
      B.box(0, 0.15, 0, 12, 0.7, v1 - v0, LK.COURT);
      B.pop();
    };
    med(V_MID + 20, V_LOW - 20, T_MID);
    med(V_LOW + 20, V_STRAND - 20, T_LOW);
    for (let v = V_MID + 30; v < V_STRAND - 10; v += 36) {
      if (Math.abs(v - V_LOW) < 12) continue;
      const h = v < V_LOW ? T_MID : T_LOW;
      for (const s of [-1, 1]) {
        const [x, z] = UV(s * 26, v);
        props.lamps.push({ x, y: gy(x, z) + h, z, ry: ROT_UV + (s > 0 ? Math.PI : 0), kind: 'boulevard' });
        lamp(s * 26, v, h + 7.9, LAMP.AMBER, 1.1, 1.3);
      }
    }
  }

  // --- courtyard blocks either side of the Boulevard ---
  const house = (u, v, h0, w, d, storeys, alongU, roofKind) => {
    foot('house', u, v, w, d, alongU);
    const [x, z] = UV(u, v);
    B.at(x, gy(x, z) + h0, z, 0, ROT_UV + (alongU ? 0 : Math.PI / 2), 0);
    const H = storeys * 3.6 + 1.2, pal = Math.floor(rnd() * 4);
    const rec = { x, y: gy(x, z) + h0, z, ry: ROT_UV + (alongU ? 0 : Math.PI / 2), w, d, H, storeys, pal, roof: roofKind, rh: 0, balc: [] };
    houses.push(rec);
    B.box(0, H / 2 - 0.4, 0, w, H + 0.8, d, LK.HOUSE + pal);
    // balconies on the long fronts: a slab on brackets and a bronze rail, on a window bay
    for (const face of [-1, 1]) for (let s = 1; s < storeys; s++) {
      if (rnd() > 0.28) continue;
      const bays = Math.floor(w / 3), bay = Math.floor(rnd() * bays) - Math.floor(bays / 2), bxp = bay * 3, bw = rnd() < 0.3 ? 5.6 : 2.6;
      if (Math.abs(bxp) + bw / 2 > w / 2 - 0.5) continue;
      const y = s * 3.6 + 0.05, z = face * (d / 2 + 0.55);
      rec.balc.push([face, s, bxp, bw]);
      B.box(bxp, y, z, bw, 0.18, 1.1, LK.WALL);
      B.box(bxp, y + 0.95, face * (d / 2 + 1.07), bw, 0.06, 0.06, LK.BRONZE);
      for (let q = 0; q <= Math.round(bw / 0.8); q++) B.box(bxp - bw / 2 + q * (bw / Math.round(bw / 0.8)), y + 0.5, face * (d / 2 + 1.07), 0.04, 0.9, 0.04, LK.BRONZE);
      for (const e of [-1, 1]) B.box(bxp + e * bw / 2, y + 0.5, z + face * 0.05, 0.04, 0.9, 1.0, LK.BRONZE);
    }
    if (roofKind === 0) {
      B.box(0, H + 0.35, 0, w - 1.2, 0.7, d - 1.2, LK.ROOFG);          // roof garden inside a parapet
      B.box(0, H + 0.6, -d / 2 + 0.3, w, 1.2, 0.6, LK.WALL);
      B.box(0, H + 0.6, d / 2 - 0.3, w, 1.2, 0.6, LK.WALL);
      B.box(-w / 2 + 0.3, H + 0.6, 0, 0.6, 1.2, d - 1.2, LK.WALL);
      B.box(w / 2 - 0.3, H + 0.6, 0, 0.6, 1.2, d - 1.2, LK.WALL);
    } else {
      // eaves over the long fronts only (row houses meet at their gables), a ridge cap and chimneys
      const rh = Math.min(d * 0.42, 6.5);
      rec.rh = rh;
      gable(B, H, w, d + 1.1, rh, LK.TILE);
      B.box(0, H + rh + 0.08, 0, w, 0.24, 0.42, LK.TILE);
      for (let c = 0; c < (w > 20 ? 2 : 1); c++) {
        const cx = (c === 0 ? -1 : 1) * w * (0.18 + 0.12 * rnd()), cz = (rnd() - 0.5) * d * 0.3, ch = rh * (0.55 + 0.25 * rnd());
        B.box(cx, H + ch / 2 + 0.6, cz, 0.8, ch + 1.6, 0.8, LK.HOUSE + pal);
        B.box(cx, H + ch + 1.45, cz, 1.0, 0.14, 1.0, LK.DARK);
      }
    }
    B.pop();
    return H;
  };
  const block = (uc, vc, bw, bd, h0, tall, market = false) => {
    // kerbed plinth with the courtyard garden on top
    const [x, z] = UV(uc, vc);
    B.at(x, gy(x, z) + h0, z, 0, ROT_UV, 0);
    B.box(0, 0.1, 0, bw, 0.8, bd, LK.COURT);
    B.pop();
    const k0 = h0 + 0.5;
    if (market) { marketHall(S, uc, vc, bw, bd, k0); return; }
    if (rnd() < 0.12) {
      courts.push({ uc, vc, hu: bw / 2, hv: bd / 2, top: k0, garden: true });
      // a garden square: a pavilion and a pool among the trees
      const [px, pz] = UV(uc, vc);
      B.at(px, gy(px, pz) + k0, pz, 0, ROT_UV, 0);
      B.box(0, 0.2, 0, 30, 0.4, 30, LK.POOL);
      B.box(0, 0.12, 0, 34, 0.24, 34, LK.WALL);
      B.pop();
      return;
    }
    const depth = 13 + Math.round(rnd() * 3);
    courts.push({ uc, vc, hu: bw / 2 - depth, hv: bd / 2 - depth, top: k0, garden: false });
    const baseSt = tall ? 4 : 3;
    // front and back rows along u, full width; the two ends between them
    for (const side of [-1, 1]) {
      let u = uc - bw / 2;
      while (u < uc + bw / 2 - 1) {
        let w = 16 + Math.floor(rnd() * 14);
        if (uc + bw / 2 - (u + w) < 12) w = uc + bw / 2 - u;
        const st = baseSt + Math.floor(rnd() * 2.6) - (rnd() < 0.15 ? 1 : 0);
        house(u + w / 2, vc + side * (bd / 2 - depth / 2), k0, w, depth, Math.max(2, st), true, rnd() < 0.45 ? 1 : 0);
        u += w;
      }
      let v = vc - bd / 2 + depth;
      while (v < vc + bd / 2 - depth - 1) {
        let w = 14 + Math.floor(rnd() * 12);
        if (vc + bd / 2 - depth - (v + w) < 10) w = vc + bd / 2 - depth - v;
        const st = baseSt - 1 + Math.floor(rnd() * 2.4);
        house(uc + side * (bw / 2 - depth / 2), v + w / 2, k0, w, depth, Math.max(2, st), false, rnd() < 0.5 ? 1 : 0);
        v += w;
      }
    }
  };
  const rowBlocks = (v0, v1, h0, uMin, uMax, tallNear, marketRow = false) => {
    for (let v = v0 + 9; v + 110 <= v1 - 9; v += 128) {
      // the covered markets face the Strand either side of the Boulevard
      const mRow = marketRow && v + 128 + 110 > v1 - 9;
      for (const sgn of [-1, 1]) {
        for (let u = uMin; u + 150 <= uMax; u += 170) {
          const uc = sgn * (u + 75);
          block(uc, v + 55, 150, 110, h0, Math.abs(uc) < tallNear, mRow && u === uMin);
        }
      }
    }
  };
  rowBlocks(V_MID, V_LOW, T_MID, 40, U_TOWN - 10, 700);
  rowBlocks(V_LOW, V_STRAND, T_LOW, 40, U_TOWN - 10, 500, true);
  // wings beside the Lift terrace
  for (let v = -250 + 9; v + 110 <= V_MID - 9; v += 128) for (const sgn of [-1, 1]) for (let u = 760; u + 150 <= U_TOWN - 10; u += 170) block(sgn * (u + 75), v + 55, 150, 110, T_MID, false);

  // --- the Strand: seafront halls, the promenade, the sea wall's lamps ---
  for (let u = -1660; u < 1660; u += 170) {
    if (Math.abs(u + 60) < 60) continue;                   // keep the Boulevard's axis open to the sea
    const w = 120;
    house(u + 60, V_STRAND + 40, T_STRAND + 0.1, w, 48, 4 + (Math.abs(u) < 600 ? 1 : 0), true, 0);
  }
  const quayFree = (u) => !(Math.abs(Math.abs(u) - 620) < 36) && ![-330, 0, 330].some((q) => Math.abs(u - q) < 14);
  for (let u = -1680; u <= 1680; u += 40) if (quayFree(u)) lamp(u, shoreV(u) - 8, T_STRAND + 6.5, LAMP.AMBER, 1.0, 1.2);
  for (let u = -1680; u <= 1680; u += 40) {
    if (!quayFree(u)) continue;
    const [x, z] = UV(u, shoreV(u) - 8);
    props.lamps.push({ x, y: gy(x, z) + T_STRAND, z, ry: ROT_UV + Math.PI, kind: 'quay' });
  }
  // the sea wall's edge, for its bollards, rings and stairs down to the water
  for (let u = -1690; u <= 1690; u += 10) {
    const v = shoreV(u) - 1.2, [x, z] = UV(u, v);
    const t = (shoreV(u + 1) - shoreV(u - 1)) / 2;
    props.quay.push({ u, v, x, y: gy(x, z) + T_STRAND, z, ry: ROT_UV - Math.atan(t), free: quayFree(u) });
  }

  // --- the harbour: two moles enclosing a basin, lighthouses, piers and boats ---
  {
    const s0 = shoreV(620) - 30, s1 = shoreV(0) + 420;
    for (const sgn of [-1, 1]) {
      const P = [[sgn * 640, s0], [sgn * 640, s1 + 20], [sgn * 80, s1 + 20], [sgn * 80, s1 - 20], [sgn * 600, s1 - 20], [sgn * 600, s0]];
      prism(B, P.map(([u, v]) => UV(u, v)), 3.2, -8, LK.PAVE, LK.WALL);
      // lighthouse at the head
      const [x, z] = UV(sgn * 100, s1);
      B.at(x, gy(x, z) + 3.2, z);
      B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      B.lathe([[9, -0.5, LK.WALL], [8, 16, LK.WALL], [6.5, 26, LK.STONE], [7.5, 26.5, LK.BRONZE], [5, 27, LK.LANTERN], [5, 31, LK.LANTERN], [5.8, 31.5, LK.BRONZE], [0, 35, LK.BRONZE]], 20);
      B.pop(); B.pop();
      lamps.push({ p: new THREE.Vector3(x, gy(x, z) + 3.2 + 29, z), r: 3.2, color: sgn < 0 ? LAMP.RED : LAMP.GREEN, i: 3.0, breathe: 0.35 });
      for (let v = s0 + 60; v < s1; v += 60) lamp(sgn * 620, v, 3.2 + 5, LAMP.WHITE, 0.6, 1.0);
    }
    // finger piers
    for (const u of [-330, 0, 330]) {
      const v0 = shoreV(u) - 12, v1 = shoreV(u) + 230;
      const [x, z] = UV(u, (v0 + v1) / 2);
      B.at(x, gy(x, z), z, 0, ROT_UV, 0);
      B.box(0, (2.2 - 8) / 2, 0, 16, 2.2 + 8, v1 - v0, LK.DECK);
      B.pop();
      props.piers.push({ u, v0, v1, top: 2.2, w: 16 });
      for (let v = v0 + 30; v < v1; v += 40) lamp(u, v, 2.2 + 4.5, LAMP.WHITE, 0.5, 0.9);
    }
    // boats moored along the piers (hulls sit in the water, decks above it)
    for (const [u, dv, L] of [[-330 + 22, 80, 34], [-330 - 20, 150, 26], [22, 60, 44], [-22, 170, 30], [330 + 20, 110, 38], [330 - 22, 60, 24]]) {
      const v = shoreV(u) + dv;
      const [x, z] = UV(u, v);
      B.at(x, gy(x, z), z, 0, ROT_UV + Math.PI / 2, 0);
      const W = L * 0.24, rings = [];
      for (let j = 0; j <= 10; j++) {
        const t = j / 10, zz = (t - 0.5) * L, wz = W * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)), 0.6) * 0.5 + 0.2;
        rings.push({ z: zz, pts: [[-wz, 1.6], [-wz * 0.9, -0.2], [-wz * 0.5, -1.4], [0, -1.7], [wz * 0.5, -1.4], [wz * 0.9, -0.2], [wz, 1.6]] });
      }
      B.loft(rings, (i) => (i === 0 || i === 6 ? LK.HULL : LK.HULL));
      B.box(0, 3.2, -L * 0.1, W * 0.5, 3.2, L * 0.3, LK.GLASS);
      B.pop();
    }
  }

  // --- the Lift: a hyperboloid of straight struts, the Crown where the tether lands ---
  const liftTop = (() => {
    const base = at(0, 0, T_LIFT);
    B.at(base.x, base.y, base.z);
    const H = 420, Rb = 150, Rt = 92, twist = 1.9, N = 28;
    // plaza ring of pools and paving around the tower
    for (let q = 0; q < 4; q++) {
      const a = q * Math.PI / 2 + Math.PI / 4;
      B.at(Math.cos(a) * 225, 0, Math.sin(a) * 225, 0, -a, 0);
      B.box(0, 0.1, 0, 56, 0.9, 116, LK.POOL);                   // water 0.55 m up, in a stone kerb
      B.box(0, 0.25, -59, 60, 1.2, 2, LK.WALL); B.box(0, 0.25, 59, 60, 1.2, 2, LK.WALL);
      B.box(-29, 0.25, 0, 2, 1.2, 116, LK.WALL); B.box(29, 0.25, 0, 2, 1.2, 116, LK.WALL);
      B.pop();
    }
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    B.push(new THREE.Matrix4().makeTranslation(0, 0, 6));
    B.torus(Rb, 7, 64, 10, LK.WALL);                           // ring beam the struts stand on
    B.pop();
    B.pop();
    for (let fam = -1; fam <= 1; fam += 2) for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2;
      const p0 = new THREE.Vector3(Math.cos(a) * Rb, 6, Math.sin(a) * Rb);
      const p1 = new THREE.Vector3(Math.cos(a + fam * twist) * Rt, H, Math.sin(a + fam * twist) * Rt);
      B.tube([p0, p1], 2.6, 6, i % 7 === 0 ? LK.BRONZE : LK.HULL);
    }
    // waist of the hyperboloid: the closest approach of a strut to the axis
    const pa = new THREE.Vector2(Rb, 0), pb = new THREE.Vector2(Math.cos(twist) * Rt, Math.sin(twist) * Rt);
    const ab = pb.clone().sub(pa), t = THREE.MathUtils.clamp(-pa.dot(ab) / ab.dot(ab), 0, 1), waist = pa.clone().addScaledVector(ab, t).length();
    // rings binding the struts every 70 m (at the hyperboloid's radius there)
    for (let y = 70; y < H - 20; y += 70) {
      const tt = y / H;
      const r = Math.sqrt(((1 - tt) * Rb + tt * Rt * Math.cos(twist)) ** 2 + (tt * Rt * Math.sin(twist)) ** 2);
      B.at(0, y, 0, -Math.PI / 2, 0, 0);
      B.torus(r, 2.2, 56, 6, LK.BRONZE);
      B.pop();
    }
    // the glass core with its lift shafts, and the Crown
    const rc = waist - 10;
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    B.lathe([[rc + 16, -0.5, LK.WALL], [rc + 16, 14, LK.WALL], [rc, 16, LK.BRONZE], [rc, H - 16, LK.GLASS], [rc + 4, H - 14, LK.BRONZE], [Rt + 6, H - 4, LK.HULL], [Rt + 8, H + 4, LK.BRONZE], [Rt - 10, H + 10, LK.LANTERN], [40, H + 22, LK.BRONZE], [12, H + 30, LK.BRONZE], [0, H + 32, LK.BRONZE]], 40);
    B.pop();
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      lamps.push({ p: new THREE.Vector3(base.x + Math.cos(a) * (Rt + 8.5), base.y + H + 4.5, base.z + Math.sin(a) * (Rt + 8.5)), r: 2.4, color: LAMP.WHITE, i: 1.6 });
    }
    B.pop();
    return new THREE.Vector3(base.x, base.y + H + 32, base.z);
  })();
  // civic halls at the corners of the Lift terrace: stone halls under glazed roofs
  for (const [u, v] of [[-500, -420], [500, -420], [-500, 330], [500, 330]]) {
    foot('hall', u, v, 150, 112);
    const [x, z] = UV(u, v);
    B.at(x, gy(x, z) + T_LIFT, z, 0, ROT_UV, 0);
    B.box(0, 9, 0, 150, 19, 96, LK.STONE);
    // a stepped podium and, over the colonnade on each long front (lunarLandingDetail.js), an
    // entablature: architrave, frieze and a dentilled cornice returning to the wall
    for (const s of [-1, 1]) {
      B.box(0, 0.15, s * 51.5, 146, 0.9, 7.0, LK.WALL);
      B.box(0, 0.05, s * 51.5, 148, 0.7, 8.2, LK.WALL);
      B.box(0, 18.1, s * 51.8, 144, 1.0, 6.0, LK.WALL);
      B.box(0, 19.0, s * 51.9, 145, 0.8, 6.4, LK.STONE);
      B.box(0, 19.65, s * 52.2, 147, 0.5, 7.4, LK.WALL);
      for (let i = -70; i <= 70; i += 1.4) B.box(i, 19.3, s * 55.05, 0.5, 0.26, 0.3, LK.WALL);
    }
    B.push(new THREE.Matrix4().makeTranslation(0, 18.5, 0));
    B.loft([{ z: -48, pts: [[-75, 0], [75, 0], [58, 16], [-58, 16]] }, { z: 48, pts: [[-75, 0], [75, 0], [58, 16], [-58, 16]] }], LK.ROOF);
    B.pop();
    B.pop();
  }

  // --- the domes of the old settlement, linked by glazed arcades ---
  for (const [u, v, R] of DOMES) {
    foot('dome', u, v, 2 * R + 12, 2 * R + 12);
    const [x, z] = UV(u, v);
    B.at(x, gy(x, z) + T_LIFT, z);
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const prof = [[R + 6, -0.5, LK.WALL], [R + 6, 13, LK.WALL], [R + 2, 14, LK.BRONZE]];
    for (let j = 0; j <= 10; j++) { const a = j / 10 * Math.PI / 2 * 0.94; prof.push([R * Math.cos(a), 14 + R * 0.72 * Math.sin(a), LK.CONSERVATORY]); }
    prof.push([R * 0.17 + 3, 14 + R * 0.72 * Math.sin(Math.PI / 2 * 0.94) + 2, LK.BRONZE], [R * 0.1, 14 + R * 0.72 + 14, LK.LANTERN], [0, 14 + R * 0.72 + 18, LK.BRONZE]);
    B.lathe(prof, 48);
    B.pop();
    // meridian ribs lying on the glass
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, pts = [];
      for (let j = 0; j <= 10; j++) { const b = j / 10 * Math.PI / 2 * 0.94; pts.push(new THREE.Vector3(Math.cos(a) * R * Math.cos(b), 14 + R * 0.72 * Math.sin(b), Math.sin(a) * R * Math.cos(b))); }
      B.tube(pts, 1.1, 5, LK.BRONZE);
    }
    B.pop();
    lamps.push({ p: at(u, v, T_LIFT + 14 + R * 0.72 + 16), r: 2.2, color: LAMP.AMBER, i: 1.4 });
  }
  const arcade = (i, j) => {
    const [ua, va, Ra] = DOMES[i], [ub, vb, Rb2] = DOMES[j];
    const d = new THREE.Vector2(ub - ua, vb - va), L = d.length();
    d.divideScalar(L);
    const p0 = [ua + d.x * (Ra + 1), va + d.y * (Ra + 1)], p1 = [ub - d.x * (Rb2 + 1), vb - d.y * (Rb2 + 1)];
    const A = at(p0[0], p0[1], T_LIFT + 3), Bp = at(p1[0], p1[1], T_LIFT + 3);
    const mid = A.clone().add(Bp).multiplyScalar(0.5);
    const n = Math.max(2, Math.ceil(A.distanceTo(Bp) / 60));
    const pts = [];
    for (let s = 0; s <= n; s++) {
      const p = A.clone().lerp(Bp, s / n);
      p.y = gy(p.x, p.z) + T_LIFT + 3;
      pts.push(p);
    }
    B.tube(pts, 8, 12, LK.CONSERVATORY);
    return mid;
  };
  arcade(0, 1); arcade(0, 2); arcade(0, 4); arcade(1, 3); arcade(2, 4);

  // --- landing fields: plinths, blast walls open toward their roads, service roads ---
  PADS.forEach(([u, v], idx) => {
    foot('pad', u, v, 552, 552);
    const [x, z] = UV(u, v);
    const y0 = gy(x, z);
    B.at(x, y0, z, 0, ROT_UV, 0);
    // plinth: a closed drum, the pad disc on top
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    B.lathe([[250, -3, LK.WALL], [250, 1.2, LK.WALL], [248, 1.2, LK.WALL], [248, 0.6, LK.WALL]], 72);
    B.pop();
    // the pad: a closed puck filling the drum's recess, its top the marked surface
    disc(B, 248, 1.2, LK.PAD, UP, 72, 6);
    disc(B, 248, 0.6, LK.WALL, DOWN, 72, 2);
    for (let i = 0; i < 72; i++) {
      const a0 = i / 72 * Math.PI * 2, a1 = (i + 1) / 72 * Math.PI * 2, am = (a0 + a1) / 2;
      const q = [[a0, 0.6], [a1, 0.6], [a1, 1.2], [a0, 1.2]].map(([a, y]) => B.v(Math.cos(a) * 248, y, Math.sin(a) * 248, a * 248, y, LK.WALL));
      const n = new THREE.Vector3(Math.cos(am), 0, Math.sin(am));
      B.tri(q[0], q[1], q[2], n); B.tri(q[0], q[2], q[3], n);
    }
    // blast walls: three quarters of a ring, open to the road (local +z = toward the town)
    arcWall(B, 268, 276, Math.PI * 0.5 + 0.2, Math.PI * 2.5 - 0.2, -2, 9, LK.WALL, 48);
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      lamps.push({ p: new THREE.Vector3(Math.cos(a) * 246, 2.2, Math.sin(a) * 246).applyAxisAngle(UP, ROT_UV).add(new THREE.Vector3(x, y0, z)), r: 1.6, color: LAMP.AMBER, i: 1.2 });
    }
    // a lunar hopper standing on two of the pads
    if (idx !== 1) {
      B.at(idx ? 40 : -30, 1.2, idx ? -20 : 30, 0, idx * 1.3, 0);
      B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      B.lathe([[0, 9, LK.DARK], [13, 9, LK.BRONZE], [15, 15, LK.HULL], [14, 38, LK.HULL], [11, 50, LK.GLASS], [7, 58, LK.HULL], [0, 62, LK.BRONZE]], 28);
      B.pop();
      for (let l = 0; l < 4; l++) {
        const a = l * Math.PI / 2 + 0.4;
        const top = new THREE.Vector3(Math.cos(a) * 12, 16, Math.sin(a) * 12), foot = new THREE.Vector3(Math.cos(a) * 24, 1.2, Math.sin(a) * 24);
        B.tube([top, foot], 1.3, 6, LK.BRONZE);
        B.at(foot.x, 0, foot.z);
        B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        B.lathe([[4, 0, LK.DARK], [4, 0.8, LK.DARK], [2.5, 1.4, LK.BRONZE]], 12);
        B.pop(); B.pop();
      }
      B.pop();
    }
    B.pop();
    // road to the domes quarter (its top a little above the ground, its foot below)
    const vEnd = -1700 + 20;
    slabUV(B, u - 15, u + 15, v + 262, vEnd, 0.5, { bot: -2, step: 150 });
    for (let vv = v + 300; vv < vEnd; vv += 50) for (const s of [-1, 1]) lamp(u + s * 17, vv, 0.5 + 5, LAMP.AMBER, 0.6, 1.0);
    // ramp from the road up onto the pad plinth, and from the road up the quarter's wall
    const ramp = (vA, vB, hA, hB) => {
      const n = 8;
      for (let s = 0; s < n; s++) {
        const t0 = s / n, t1 = (s + 1) / n;
        const vv = vA + (vB - vA) * (t0 + t1) / 2, h = hA + (hB - hA) * t1;
        const [rx, rz] = UV(u, vv);
        B.at(rx, gy(rx, rz), rz, 0, ROT_UV, 0);
        B.box(0, (h - 1) / 2, 0, 26, h + 1, Math.abs(vB - vA) / n + 0.05, LK.PAVE);
        B.pop();
      }
    };
    ramp(v + 262, v + 250.5, 0.5, 1.2);
    ramp(vEnd - 60, vEnd + 6, 0.5, T_LIFT);
  });

  // --- the mass driver: 36 km of guideway, straight, rising over the plain ---
  {
    const [sx, sz] = UV(2300, -800);
    const dir = new THREE.Vector3(1, 0.0105, 0.25).normalize();
    const P0 = new THREE.Vector3(sx, gy(sx, sz) + 16, sz);
    const L = 36000;
    const P = (s) => P0.clone().addScaledVector(dir, s);
    // the guideway: one straight beam, with its conduit on top
    const beam = (a, b, w, h, k) => {
      const m = new THREE.Matrix4().lookAt(a, b, UP).setPosition(a.clone().add(b).multiplyScalar(0.5));
      B.push(m);
      B.box(0, 0, 0, w, h, a.distanceTo(b), k);
      B.pop();
    };
    beam(P(0), P(L), 16, 8, LK.HULL);
    const up4 = new THREE.Vector3(0, 4.6, 0);
    beam(P(0).add(up4), P(L).add(up4), 5, 1.2, LK.CONDUIT);
    // coil collars: square frames closing round the beam
    // (the coils glow in a slow wave that runs out along the guideway, and a launch pulse
    // follows it now and then: their facade coordinate carries the distance along the beam)
    for (let s = 1500; s < L - 200; s += 150) {
      const c = P(s);
      const m = new THREE.Matrix4().lookAt(c, P(s + 10), UP).setPosition(c);
      B.push(m);
      const i0 = B.pos.length / 3;
      // tall enough for a loaded sled to run through: opening 20 m wide, 18.8 m over the beam
      B.box(0, 24, 0, 24, 2, 2.2, LK.COIL); B.box(0, -5, 0, 24, 2, 2.2, LK.COIL);
      B.box(-11, 9.5, 0, 2, 31, 2.2, LK.COIL); B.box(11, 9.5, 0, 2, 31, 2.2, LK.COIL);
      for (let i = i0; i < B.pos.length / 3; i++) { B.fac[i * 3] = s; B.fac[i * 3 + 1] = s; }
      B.pop();
    }
    // pylons: from below the ground to the beam's underside, standing radially
    for (let s = 600; s < L; s += 400) {
      const c = P(s);
      const g = new THREE.Vector3(c.x, gy(c.x, c.z), c.z);
      const hgt = c.y - g.y;
      const upL = surfaceUp(c.x, c.z);
      const foot = g.clone().addScaledVector(upL, -3);
      const top = c.clone().addScaledVector(UP, -3.4);
      const w0 = 10 + hgt * 0.04, w1 = 9;
      column(B, foot, top, w0, w1, LK.WALL);
      if (s % 4000 === 600) lamps.push({ p: c.clone().addScaledVector(UP, 27), r: 3, color: LAMP.RED, i: 2.2, breathe: 0.3 });
    }
    // launch gate: a ring round the beam's end on its own frame
    {
      const c = P(L - 60);
      const m = new THREE.Matrix4().lookAt(c, P(L), UP).setPosition(c);
      B.push(m);
      B.torus(46, 5, 48, 10, LK.BRONZE);
      B.torus(41.5, 1.5, 48, 8, LK.CONDUIT);                                      // inlaid in the ring's inner face
      for (const sgn of [-1, 1]) B.box(sgn * 25, 0, 0, 34, 3, 4, LK.HULL);        // spokes from the beam's sides into the ring
      B.pop();
      const g = new THREE.Vector3(c.x, gy(c.x, c.z), c.z);
      column(B, g.clone().addScaledVector(surfaceUp(c.x, c.z), -3), c.clone().addScaledVector(UP, -44), 30, 9, LK.WALL);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        lamps.push({ p: new THREE.Vector3(Math.cos(a) * 46, Math.sin(a) * 46, 0).applyMatrix4(m), r: 3.5, color: LAMP.TEAL, i: 2.0, breathe: 0.2 });
      }
    }
    // the loading yard: a hall over the beam's head and stacks of cargo capsules
    {
      const Y = P0.clone().addScaledVector(dir, -200);
      B.at(Y.x, gy(Y.x, Y.z), Y.z, 0, Math.atan2(-dir.z, dir.x), 0);
      B.box(0, -0.5, 0, 700, 3, 260, LK.PAVE);
      B.box(120, 14, 0, 380, 27, 70, LK.STONE);
      B.push(new THREE.Matrix4().makeTranslation(120, 27.5, 0));
      B.loft([{ z: -35, pts: [[-190, 0], [190, 0], [160, 18], [-160, 18]] }, { z: 35, pts: [[-190, 0], [190, 0], [160, 18], [-160, 18]] }].map((r) => ({ z: r.z, pts: r.pts })), LK.ROOF);
      B.pop();
      for (let i = 0; i < 18; i++) {
        const cx = -300 + (i % 9) * 34, cz = (i < 9 ? -1 : 1) * 80;
        B.at(cx, 1, cz);
        B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        B.lathe([[11, 0, LK.HULL], [12, 2, LK.BRONZE], [12, 26, LK.HULL], [9, 30, LK.HULL], [0, 32, LK.BRONZE]], 16);
        B.pop(); B.pop();
      }
      B.pop();
    }
  }

  // trees, the colonnade, roads and hamlets, the ferry (lunarLandingLife.js)
  TREE_SINK.list = [];
  const life = buildLandingLife(S);
  const treeInstances = TREE_SINK.list; TREE_SINK.list = null;

  const geo = B.geometry();
  // the mass driver's line, for the sleds that run on it (lunarTraffic.js)
  const [dx0, dz0] = UV(2300, -800);
  const driver = { P0: new THREE.Vector3(dx0, gy(dx0, dz0) + 16, dz0), dir: new THREE.Vector3(1, 0.0105, 0.25).normalize(), L: 36000, coilFrom: 1500 };
  return { geo, lamps, liftTop, radius: 38, gateKm: 36, plan, trees: life.trees, treeInstances, driver, S };
}
