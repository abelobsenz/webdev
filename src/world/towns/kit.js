import { KIND as K } from '../buildings.js';

// Shared pieces of the towns layer, built with the low-rise Builder (buildings.js) in a local
// frame: every one a closed solid (walls, caps, soffits), unit normals, no zero-area faces.

const TAU = Math.PI * 2;

/** A pyramid roof over the rectangle cx +- hx, cz +- hz from y0 to its apex at y1 (with a floor). */
export function pyramid(B, cx, cz, hx, hz, y0, y1, kind, floor = K.STONE) {
  B.reserve(17, 18);
  const c = [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz, ml = Math.hypot(mx, mz) || 1, h = y1 - y0;
    const L = Math.hypot(ml, h), nx = (mx / ml) * (h / L), nz = (mz / ml) * (h / L), ny = ml / L;
    const i0 = B.v(a[0], y0, a[1], nx, ny, nz, 0, 0, kind), i1 = B.v(b[0], y0, b[1], nx, ny, nz, 1, 0, kind), i2 = B.v(cx, y1, cz, nx, ny, nz, 0.5, 1, kind);
    B.tri(i0, i1, i2);
  }
  B.face(c.map(([x, z]) => [x, y0, z]), [0, -1, 0], floor);
}

/**
 * A gabled roof, ridge along local z from z0 to z1 over walls x = +-hw whose tops are at y:
 * the attic (a triangular prism of wall kind closing the gable ends) and the roof slab (a
 * chevron of thickness t overhanging e at the eaves and at the verges).
 */
export function gableRoof(B, hw, z0, z1, y, rise, e, t, kRoof, kWall) {
  const sl = rise / hw, ye = y - e * sl;
  B.vprism([[-hw, y], [hw, y], [0, y + rise]], z0, z1, kWall);
  B.vprism([[-hw - e, ye], [-hw - e, ye + t], [0, y + rise + t], [hw + e, ye + t], [hw + e, ye], [0, y + rise]], z0 - e, z1 + e, kRoof, K.STONE);
}

/** A classical column: square plinth, base, tapering shaft, capital, abacus. */
export function column(B, x, z, r, y0, y1, lod, kind = K.STONE) {
  if (lod) { B.box(x - r, x + r, z - r, z + r, y0, y1, kind, kind); return; }
  B.box(x - r * 1.5, x + r * 1.5, z - r * 1.5, z + r * 1.5, y0, y0 + r * 0.7, kind, kind);
  B.lathe(x, z, [[r * 1.3, y0 + r * 0.7, kind], [r * 1.3, y0 + r * 1.1, kind], [r, y0 + r * 1.5, kind], [r * 0.86, y1 - r * 1.4, kind], [r * 1.35, y1 - r * 0.6, kind], [r * 1.35, y1 - r * 0.45, kind]], 10);
  B.box(x - r * 1.5, x + r * 1.5, z - r * 1.5, z + r * 1.5, y1 - r * 0.45, y1, kind, kind);
}

/** A round stepped plinth: n steps of rise/run round a disc of radius r whose top is at 0. */
export function roundPlinth(B, r, foot, n, rise = 0.3, run = 0.5, seg = 32) {
  for (let s = n; s >= 0; s--) B.lathe(0, 0, [[r + s * run, foot, K.STONE], [r + s * run, -s * rise, K.STONE], [0, -s * rise, K.PAVING]], seg);
}

/**
 * A rectangular plinth (top at 0, foot below) of half extents hx, hz with a flight of steps on
 * its front (+z) face where the ground there lies lower: rise per step, flight width w.
 * frontDrop: metres from the plinth top down to the ground in front.
 */
export function rectPlinth(B, hx, hz, foot, frontDrop = 0, w = 0, run = 0.34) {
  B.box(-hx, hx, -hz, hz, foot, 0, K.STONE, K.PAVING);
  if (frontDrop <= 0.24 || w <= 0) return 0;
  const n = Math.min(10, Math.max(2, Math.round(frontDrop / 0.16))), rs = frontDrop / n;
  // step k (1..n-1): its tread at -k * rs, from hz + (k - 1) * run to hz + k * run (the last
  // rise, n, lands on the ground in front)
  for (let k = 1; k < n; k++) B.box(-w / 2, w / 2, hz + (k - 1) * run, hz + k * run, foot, -k * rs, K.STONE, K.PAVING);
  return (n - 1) * run;
}

/** A bench of stone and timber on two stone feet, seat facing +z (0.45 high, 1.8 long). */
export function stoneBench(B, x, z, yaw, y, lod) {
  B.frame(x, y, z, yaw);
  if (lod) { B.box(-0.9, 0.9, -0.25, 0.25, -0.1, 0.45, K.STONE, K.TIMBER); return; }
  for (const sx of [-0.7, 0.7]) B.box(sx - 0.12, sx + 0.12, -0.24, 0.24, -0.12, 0.38, K.STONE, K.STONE);
  B.box(-0.9, 0.9, -0.25, 0.25, 0.38, 0.46, K.TIMBER, K.TIMBER);
}

/**
 * A timber jetty from a shore point out to deep water: a deck on piles at deckY (world), a
 * T-head, posts and a rail along both sides, mooring bollards, boats moored at the head.
 * pts: along the jetty axis from (x0, z0) in direction (dx, dz) for len metres; ground: raw.
 * Returns the build function in world coordinates.
 */
export function jettyWork(x0, z0, dx, dz, len, deckY, ground, { hw = 1.5, head = 12, boats = 2 } = {}) {
  const yaw = Math.atan2(dx, dz);
  return (B, lod) => {
    B.frame(x0, deckY, z0, yaw);
    // the deck (local +z out to sea) and the T-head across its end
    B.box(-hw, hw, 0, len, -0.35, 0, K.TIMBER, K.TIMBER);
    B.box(-head / 2, head / 2, len, len + 3.2, -0.35, 0, K.TIMBER, K.TIMBER);
    // piles to the seabed every 4 m, pairs under the deck, four under the head
    const at = (lx, lz) => ground(x0 + lx * Math.cos(yaw) + lz * Math.sin(yaw), z0 - lx * Math.sin(yaw) + lz * Math.cos(yaw)) - deckY;
    const pile = (lx, lz) => { const g = at(lx, lz); if (g > -0.36) return; B.box(lx - 0.16, lx + 0.16, lz - 0.16, lz + 0.16, g - 0.8, -0.35, K.TIMBER, K.TIMBER); };
    for (let s = 3; s < len; s += 4) for (const sx of [-1, 1]) pile(sx * (hw - 0.25), s);
    for (const lx of [-head / 2 + 0.4, -hw + 0.25, hw - 0.25, head / 2 - 0.4]) for (const lz of [len + 0.4, len + 2.8]) pile(lx, lz);
    if (lod) return;
    // posts and a handrail along both sides of the deck (the head is left open for mooring)
    const posts = [];
    for (let s = 1.5; s < len - 0.5; s += 3) posts.push(s);
    for (const sx of [-1, 1]) {
      const x = sx * (hw - 0.08);
      for (const s of posts) B.box(x - 0.06, x + 0.06, s - 0.06, s + 0.06, 0, 1.0, K.TIMBER, K.TIMBER);
      if (posts.length > 1) B.box(x - 0.05, x + 0.05, posts[0] - 0.06, posts[posts.length - 1] + 0.06, 1.0, 1.08, K.TIMBER, K.TIMBER);
    }
    // bronze mooring bollards along the head's edge
    for (const lx of [-head / 2 + 1, -head / 4, head / 4, head / 2 - 1]) B.lathe(lx, len + 2.7, [[0.16, -0.02, K.METAL], [0.13, 0.42, K.METAL], [0.19, 0.5, K.METAL], [0.19, 0.58, K.METAL], [0, 0.6, K.METAL]], 8);
    // boats moored alongside the head, afloat (keel under the water, gunwale above it)
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let b = 0; b < boats; b++) {
      const sx = b ? 1 : -1, bl = 6.5 + (Math.abs(Math.round(x0 * 7 + b)) % 2);
      const lx = sx * (head / 2 - bl / 2 - 0.3), lz = len + 3.2 + 1.5;
      boat(B, x0 + lx * c + lz * s, z0 - lx * s + lz * c, yaw + Math.PI / 2, bl);
    }
  };
}

/** A small boat afloat at (x, z) (world), lying along its local x turned by rot: a closed
 *  lens-shaped hull from its keel under the water to the gunwale, a timber deck, a low cabin. */
export function boat(B, x, z, rot, len) {
  B.frame(x, 0, z, rot);
  const hw = len * 0.17, nSeg = 6;
  const top = [];
  for (let i = 0; i <= nSeg; i++) { const t = i / nSeg; top.push([-len / 2 + t * len, hw * Math.sin(Math.PI * t) ** 0.7]); }
  const outline = [...top, ...top.slice(1, -1).reverse().map(([u, w]) => [u, -w])];
  const inner = outline.map(([u, w]) => [u * 0.82, w * 0.5]);
  const keel = -0.35, gun = 0.45;
  B.loft(inner, keel, outline, gun, K.STONE);
  B.cap(inner, keel, K.STONE, false);
  B.cap(outline, gun, K.TIMBER, true);
  B.box(-len * 0.18, len * 0.12, -hw * 0.45, hw * 0.45, gun, gun + 0.7, K.GLASS, K.STONE);
}

export { TAU };
