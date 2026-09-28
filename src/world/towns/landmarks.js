import { KIND as K } from '../buildings.js';
import { pyramid, gableRoof, column, roundPlinth } from './kit.js';

// The islet villages' public buildings, one to each islet: each a small building of the
// lagoon's civic family in pale stone, glass, timber and dark bronze, drawn in a local frame
// with its plinth top at y = 0 and its front toward +z (the village place). Every design
// returns its plinth's half extents (hx, hz, or a radius r), the width of a flight of steps on
// its front, and build(B, lod) that draws everything above the plinth (lod: the massing only,
// the same silhouette). The placement (islets.js) sets the frame and draws the plinth.

const TAU = Math.PI * 2;
const dome = (r, y0, h, k, top = 0, n = 8) => {
  const p = [];
  for (let i = 1; i <= n; i++) { const t = (i / n) * (Math.PI / 2); p.push([i === n ? top : Math.max(top, r * Math.cos(t)), y0 + h * Math.sin(t), k]); }
  return p;
};

/** The chapel: a nave under a pitched roof, an apse, a porch and a campanile with its spire. */
function chapel(s) {
  const hw = 4.2 * s, z0 = -8 * s, z1 = 6 * s, H = 7 * s, tx = hw + 2.4 * s, tz = 3.4 * s, ts = 1.7 * s;
  return {
    hx: tx + ts + 1.4, hz: 9 * s + hw * 0.5 + 1.2, stepW: 4 * s, height: 23 * s,
    build(B, lod) {
      B.box(-hw, hw, z0, z1, 0, H, K.PUNCHED, K.STONE);
      gableRoof(B, hw, z0, z1, H, 3.6 * s, 0.5, 0.25, K.STONE, K.STONE);
      // the apse: a half-drum and semi-dome at the east end
      B.lathe(0, z0, [[hw * 0.85, 0, K.PUNCHED], [hw * 0.85, H * 0.8, K.PUNCHED], [hw * 0.95, H * 0.8, K.STONE], [hw * 0.95, H * 0.8 + 0.4, K.STONE], [hw * 0.85, H * 0.8 + 0.4, K.STONE], ...dome(hw * 0.85, H * 0.8 + 0.4, hw * 0.7, K.STONE, 0, lod ? 4 : 8)], lod ? 12 : 24);
      // the campanile: shaft, cornice, open belfry on four piers, bronze spire
      const T = H + 6 * s;
      B.box(tx - ts, tx + ts, tz - ts, tz + ts, 0, T, K.PUNCHED, K.STONE);
      B.box(tx - ts - 0.25, tx + ts + 0.25, tz - ts - 0.25, tz + ts + 0.25, T, T + 0.45, K.STONE, K.STONE);
      const bT = T + 0.45 + 3.2 * s;
      if (lod) B.box(tx - ts, tx + ts, tz - ts, tz + ts, T + 0.45, bT, K.STONE, K.STONE);
      else {
        for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box(tx + px * ts - (px > 0 ? 0.55 : 0) , tx + px * ts + (px < 0 ? 0.55 : 0), tz + pz * ts - (pz > 0 ? 0.55 : 0), tz + pz * ts + (pz < 0 ? 0.55 : 0), T + 0.45, bT, K.STONE, K.STONE);
        B.lathe(tx, tz, [[0.75 * s, bT - 2.4 * s, K.METAL], [0.55 * s, bT - 1.9 * s, K.METAL], [0.2, bT - 0.6, K.METAL], [0.1, bT - 0.45, K.METAL], [0.1, bT + 0.1, K.METAL]], 10);
      }
      B.box(tx - ts - 0.3, tx + ts + 0.3, tz - ts - 0.3, tz + ts + 0.3, bT, bT + 0.5, K.STONE, K.STONE);
      pyramid(B, tx, tz, ts + 0.1, ts + 0.1, bT + 0.5, bT + 0.5 + 6.5 * s, K.METAL);
      // the porch: two columns and a pediment over the west door; a tall window above it
      const pz = z1 + 2.6 * s;
      for (const sx of [-1, 1]) column(B, sx * 1.9 * s, pz - 0.4, 0.3 * s, 0, 4.2 * s, lod);
      B.box(-2.5 * s, 2.5 * s, z1, pz, 4.2 * s, 4.7 * s, K.STONE, K.STONE);
      gableRoof(B, 2.5 * s, z1, pz, 4.7 * s, 1.2 * s, 0.2, 0.18, K.STONE, K.STONE);
      if (!lod) {
        B.box(-0.8 * s, 0.8 * s, z1 - 0.02, z1 + 0.08, 0, 3.4 * s, K.METAL, K.METAL);
        B.box(-0.9 * s, 0.9 * s, z1 - 0.02, z1 + 0.06, 5.2 * s, H + 1.4 * s, K.GLASS, K.STONE);
        // buttresses along the nave
        for (let i = 1; i < 4; i++) { const z = z0 + ((z1 - z0) * i) / 4; for (const sx of [-1, 1]) B.box(sx > 0 ? hw : -hw - 0.6, sx > 0 ? hw + 0.6 : -hw, z - 0.35, z + 0.35, 0, H - 1.2, K.STONE, K.STONE); }
      }
    },
  };
}

/** The lighthouse: a tapering round tower, its gallery and railing, the glowing lantern under a
 *  bronze cupola; the keeper's house beside it under a pitched roof. */
function lighthouse(s) {
  const r0 = 3.4 * s, r1 = 2.5 * s, H = 21 * s, hx = 4.2 * s, kx = r0 + 1.2 + hx;
  return {
    hx: kx + hx + 1.2, hz: Math.max(r0, 3.4 * s) + 2.2, stepW: 3.2, height: H + 6.5 * s,
    build(B, lod) {
      B.lathe(0, 0, [[r0 + 0.35, 0, K.STONE], [r0 + 0.35, 1.2, K.STONE], [r0, 1.2, K.STONE], [r1, H, K.PUNCHED], [r1 + 0.9, H + 0.1, K.STONE], [r1 + 0.9, H + 0.5, K.STONE], [0, H + 0.5, K.PAVING]], lod ? 12 : 28);
      // the lantern room: a glass drum that glows, its cupola and finial
      const lr = r1 * 0.7;
      B.lathe(0, 0, [[lr, H + 0.5, K.LANTERN], [lr, H + 3.2 * s, K.LANTERN], [lr + 0.3, H + 3.2 * s, K.METAL], [lr + 0.3, H + 3.5 * s, K.METAL], ...dome(lr + 0.1, H + 3.5 * s, 1.6 * s, K.METAL, 0.12, 5), [0.12, H + 5.8 * s, K.METAL], [0, H + 6.3 * s, K.METAL]], lod ? 10 : 20);
      if (!lod) {
        // gallery railing: posts round the gallery and a ring rail on them
        const rr = r1 + 0.75, n = 16;
        for (let k = 0; k < n; k++) { const a = (k / n) * TAU; B.box(Math.cos(a) * rr - 0.05, Math.cos(a) * rr + 0.05, Math.sin(a) * rr - 0.05, Math.sin(a) * rr + 0.05, H + 0.5, H + 1.5, K.METAL, K.METAL); }
        B.lathe(0, 0, [[rr - 0.05, H + 1.5, K.METAL], [rr + 0.05, H + 1.5, K.METAL], [rr + 0.05, H + 1.6, K.METAL], [rr - 0.05, H + 1.6, K.METAL], [rr - 0.05, H + 1.5, K.METAL]], 24);
        B.box(-0.7, 0.7, r0 - 0.2, r0 + 0.45, 0, 2.6, K.METAL, K.METAL);
      }
      // the keeper's house
      B.box(kx - hx, kx + hx, -3 * s, 3 * s, 0, 3.4 * s, K.PUNCHED, K.STONE);
      const { ox, oy, oz, c, s: sn } = B, rot = Math.atan2(sn, c);
      B.frame(ox, oy, oz, rot + Math.PI / 2);
      gableRoof(B, 3 * s, kx - hx, kx + hx, 3.4 * s, 2.0 * s, 0.4, 0.2, K.TIMBER, K.PUNCHED);
      B.frame(ox, oy, oz, rot);
    },
  };
}

/** The observatory: a round drum under a bronze dome split by its shutter, on a terrace, with a
 *  study wing behind. */
function observatory(s) {
  const r = 5.2 * s, H = 6.2 * s;
  return {
    hx: 7.5 * s + 1, hz: 11 * s, stepW: 3.4, height: H + r + 1,
    build(B, lod) {
      B.lathe(0, 0, [[r, 0, K.PUNCHED], [r, H, K.PUNCHED], [r + 0.4, H, K.STONE], [r + 0.4, H + 0.6, K.STONE], [r, H + 0.6, K.STONE], ...dome(r, H + 0.6, r * 0.95, K.METAL, 0, lod ? 5 : 9)], lod ? 14 : 32);
      if (!lod) B.box(-0.6, 0.6, -r * 0.2, r * 0.75, H + 0.8, H + 0.6 + r * 0.95 + 0.25, K.GLASS, K.METAL);
      // the study wing behind, a flat roof behind a parapet, a garden on it
      B.box(-6 * s, 6 * s, -10 * s, -r + 0.6, 0, 4.2 * s, K.PUNCHED, K.GARDEN);
      if (!lod) B.parapet([[-6 * s, -10 * s], [6 * s, -10 * s], [6 * s, -r + 0.6], [-6 * s, -r + 0.6]], 4.2 * s, 0.8, 0.25);
      // a porch on the front
      B.box(-1.8, 1.8, r - 0.8, r + 1.6, 3.2, 3.6, K.STONE, K.STONE);
      for (const sx of [-1, 1]) column(B, sx * 1.5, r + 1.3, 0.2, 0, 3.2, lod);
    },
  };
}

/** The tempietto: a round temple of columns under a dome and lantern, on a stepped drum, a
 *  belvedere looking out over the lagoon. */
function tempietto(s) {
  const r = 5.4 * s, H = 5.4 * s, n = 10;
  return {
    r: r + 1.6, stepW: 0, height: H + r + 2.5, round: true,
    build(B, lod) {
      B.lathe(0, 0, [[r + 0.9, 0, K.STONE], [r + 0.9, 0.35, K.STONE], [0, 0.35, K.PAVING]], lod ? 16 : 32);
      for (let k = 0; k < n; k++) { const a = (k / n) * TAU + TAU / (2 * n); column(B, Math.cos(a) * r, Math.sin(a) * r, 0.3 * s, 0.35, H, lod); }
      B.lathe(0, 0, [[r - 0.8, H, K.STONE], [r + 0.55, H, K.STONE], [r + 0.55, H + 0.8, K.STONE], [r + 0.25, H + 1.1, K.STONE], [r - 0.3, H + 1.1, K.STONE], ...dome(r - 0.3, H + 1.1, r * 0.7, K.STONE, 0.9, lod ? 4 : 8), [0.9, H + 1.1 + r * 0.7 + 1.2, K.LANTERN], [0.2, H + 1.4 + r * 0.7 + 1.2, K.METAL], [0, H + 2.2 + r * 0.7 + 1.2, K.METAL]], lod ? 14 : 32);
      if (!lod) B.lathe(0, 0, [[0.6, 0.35, K.STONE], [0.5, 1.2, K.STONE], [0.65, 1.3, K.STONE], [0.3, 2.4, K.METAL], [0, 2.9, K.METAL]], 12);
    },
  };
}

/** The glasshouse of the garden island: a domed palm house between two barrel-vaulted wings,
 *  on stone bases, a parterre of raised beds before it. */
function glasshouse(s) {
  const r = 6.5 * s, wl = 10 * s, ww = 3.4 * s;
  return {
    hx: r + wl + 1.6, hz: r + 5.5 * s, stepW: 4, height: 1.6 + r * 1.25 + 1.5,
    build(B, lod) {
      B.lathe(0, 0, [[r + 0.3, 0, K.STONE], [r + 0.3, 1.6, K.STONE], [r, 1.6, K.STONE], ...dome(r, 1.6, r * 1.2, K.GLASS, 1.1, lod ? 5 : 10), [1.1, 1.6 + r * 1.2 + 1.2, K.LANTERN], [0, 1.6 + r * 1.25 + 1.5, K.METAL]], lod ? 14 : 32);
      for (const sx of [-1, 1]) {
        const x0 = sx > 0 ? r - 1 : -(r - 1 + wl), x1 = x0 + wl;
        B.box(x0, x1, -ww - 0.3, ww + 0.3, 0, 1.2, K.STONE, K.STONE);
        B.vault(x0, x1, -ww, ww, 1.2, ww * 0.95, K.GLASS, lod ? 5 : 10);
        // end walls of the wings: a stone frame round the glass end
        const xe = sx > 0 ? x1 : x0;
        B.box(xe - 0.25, xe + 0.25, -ww - 0.3, ww + 0.3, 1.2, 1.55, K.STONE, K.STONE);
      }
      // the parterre: four raised beds with stone kerbs either side of the path in
      for (const sx of [-1, 1]) for (const k of [0, 1]) {
        const x0 = sx * (2 + k * 5.4 * s), x1 = x0 + sx * 4.6 * s;
        B.box(Math.min(x0, x1), Math.max(x0, x1), r + 0.8, r + 4.6 * s, 0, 0.5, K.STONE, K.GARDEN);
      }
    },
  };
}

/** The school: two storeys round three sides of a playground court, open to the front, with a
 *  pergola along the court and a climbing frame; roof gardens behind parapets. */
function school(s) {
  const hx = 13 * s, hz = 9 * s, d = 5.4 * s, H = 7.2;
  return {
    hx: hx + 1.2, hz: hz + 1.2, stepW: 5, height: H + 1,
    build(B, lod) {
      const wings = [[-hx, hx, -hz, -hz + d], [-hx, -hx + d, -hz + d, hz], [hx - d, hx, -hz + d, hz]];
      for (const [x0, x1, z0, z1] of wings) {
        B.box(x0, x1, z0, z1, 0, H, K.PUNCHED, K.GARDEN);
        if (!lod) B.parapet([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], H, 0.8, 0.22);
        else B.box(x0, x1, z0, z0 + 0.25, H, H + 0.8, K.STONE, K.STONE);
      }
      // the pergola along the back of the court: posts, beams, rafters
      const zc = -hz + d + 2.4, xa = -hx + d + 1.2, xb = hx - d - 1.2;
      if (!lod) {
        for (let x = xa; x <= xb + 1e-6; x += (xb - xa) / 4) B.box(x - 0.12, x + 0.12, zc - 0.12, zc + 0.12, 0, 2.8, K.TIMBER, K.TIMBER);
        B.box(xa - 0.3, xb + 0.3, zc - 0.13, zc + 0.13, 2.8, 3.05, K.TIMBER, K.TIMBER);
        for (let x = xa; x <= xb + 1e-6; x += 1.2) B.box(x - 0.06, x + 0.06, -hz + d, zc + 0.4, 3.05, 3.22, K.TIMBER, K.TIMBER);
        // a climbing frame in the court: bronze bars on four legs, a timber deck
        const cx = 0, cz = hz * 0.35;
        for (const [px, pz] of [[-1.4, -1], [1.4, -1], [1.4, 1], [-1.4, 1]]) B.box(cx + px - 0.06, cx + px + 0.06, cz + pz - 0.06, cz + pz + 0.06, 0, 2.6, K.METAL, K.METAL);
        B.box(cx - 1.5, cx + 1.5, cz - 1.1, cz + 1.1, 1.3, 1.42, K.TIMBER, K.TIMBER);
        for (const pz of [-1, 1]) B.box(cx - 1.46, cx + 1.46, cz + pz - 0.05, cz + pz + 0.05, 2.5, 2.6, K.METAL, K.METAL);
      }
      // entrance canopies on the two wing ends toward the place
      for (const sx of [-1, 1]) B.box(sx > 0 ? hx - d - 0.2 : -hx - 0.2, sx > 0 ? hx + 0.2 : -hx + d + 0.2, hz, hz + 1.4, 3.0, 3.25, K.STONE, K.STONE);
    },
  };
}

/** The market hall: an open hall of stone columns under a great timber roof, stalls inside. */
function marketHall(s) {
  const hx = 11 * s, hz = 5.6 * s, H = 4.6;
  return {
    hx: hx + 1.6, hz: hz + 1.6, stepW: 0, height: H + 0.5 + hz * 0.62 + 0.5,
    build(B, lod) {
      const nx = Math.max(4, Math.round((2 * hx) / 3.6));
      for (let i = 0; i <= nx; i++) for (const sz of [-1, 1]) column(B, -hx + (2 * hx * i) / nx, sz * hz, 0.32, 0, H, lod);
      for (const sz of [-1, 1]) B.box(-hx - 0.4, hx + 0.4, sz * hz - 0.4, sz * hz + 0.4, H, H + 0.5, K.STONE, K.STONE);
      for (const sx of [-1, 1]) B.box(sx * hx - 0.4, sx * hx + 0.4, -hz + 0.4, hz - 0.4, H, H + 0.5, K.STONE, K.STONE);
      // the roof, ridge along x: turn the frame so the roof helper's z runs along x
      const { ox, oy, oz, c, s: sn } = B, rot = Math.atan2(sn, c);
      B.frame(ox, oy, oz, rot + Math.PI / 2);
      gableRoof(B, hz + 0.4, -hx - 0.4, hx + 0.4, H + 0.5, hz * 0.62, 0.9, 0.28, K.TIMBER, K.STONE);
      B.frame(ox, oy, oz, rot);
      if (!lod) {
        // stalls: timber counters with bronze-framed awnings down both sides of the hall
        for (let i = 0; i < nx; i++) for (const sz of [-1, 1]) {
          const x = -hx + (2 * hx * (i + 0.5)) / nx, z = sz * (hz - 1.6);
          B.box(x - 1.2, x + 1.2, z - 0.45, z + 0.45, 0, 0.9, K.TIMBER, K.TIMBER);
          for (const px of [-1.1, 1.1]) B.box(x + px - 0.04, x + px + 0.04, z - sz * 0.4 - 0.04, z - sz * 0.4 + 0.04, 0.9, 2.3, K.METAL, K.METAL);
          B.box(x - 1.25, x + 1.25, z - 0.6, z + 0.6, 2.3, 2.38, K.STONE, K.STONE);
        }
      }
    },
  };
}

/** The lido: a bathing pool in a paved terrace, its coping and steps; a colonnaded bath house
 *  with a vaulted roof along the back. */
function lido(s) {
  const px = 9 * s, pz = 4.5 * s, bz = -pz - 2.2 - 5 * s;
  return {
    hx: px + 3.6, hz: -bz + 1.2, stepW: 0, height: 7.5,
    build(B, lod) {
      // the pool: a raised basin on the terrace, its water just under the coping
      B.box(-px, px, -pz, pz, 0, 0.3, K.POOL, K.POOL);
      for (const [x0, x1, z0, z1] of [[-px - 1, px + 1, -pz - 1, -pz], [-px - 1, px + 1, pz, pz + 1], [-px - 1, -px, -pz, pz], [px, px + 1, -pz, pz]]) B.box(x0, x1, z0, z1, 0, 0.5, K.STONE, K.PAVING);
      // the bath house: a long vaulted hall behind a colonnade
      const z0 = bz, z1 = -pz - 2.2;
      B.box(-px - 2, px + 2, z0, z1 - 1.8, 0, 4.2, K.PUNCHED, K.STONE);
      B.vault(-px - 2, px + 2, z0, z1 - 1.8, 4.2, 1.6, K.STONE, lod ? 4 : 8);
      const n = Math.max(5, Math.round((2 * px + 4) / 3));
      for (let i = 0; i <= n; i++) column(B, -px - 1.7 + ((2 * px + 3.4) * i) / n, z1 - 0.4, 0.26, 0, 3.6, lod);
      B.box(-px - 2, px + 2, z1 - 1.8, z1, 3.6, 4.1, K.STONE, K.STONE);
      // loungers along the pool's long side and a diving stage on the coping at its end
      if (!lod) {
        for (let i = 0; i < 5; i++) { const x = -px + 1 + i * ((2 * px - 2) / 4); B.box(x - 0.35, x + 0.35, pz + 1.6, pz + 3.4, 0, 0.35, K.TIMBER, K.TIMBER); }
        B.box(px + 0.1, px + 0.95, -1, 1, 0.5, 1.2, K.STONE, K.PAVING);
      }
    },
  };
}

/** The reading room: a small rotunda under a coffered dome with a portico of four columns. */
function library(s) {
  const r = 6 * s, H = 6.8 * s;
  return {
    hx: r + 1.4, hz: r + 5.2, stepW: 4.2, height: H + r * 0.8 + 3.5,
    build(B, lod) {
      B.lathe(0, 0, [[r, 0, K.PUNCHED], [r, H, K.PUNCHED], [r + 0.5, H, K.STONE], [r + 0.5, H + 0.8, K.STONE], [r, H + 0.8, K.STONE], ...dome(r, H + 0.8, r * 0.75, K.STONE, 1.3, lod ? 4 : 8), [1.3, H + 0.8 + r * 0.75 + 1.6, K.LANTERN], [0.2, H + 0.8 + r * 0.75 + 1.8, K.METAL], [0, H + 0.8 + r * 0.75 + 2.6, K.METAL]], lod ? 14 : 32);
      const zc = r + 3.2;
      for (let i = 0; i < 4; i++) column(B, -3.3 + i * 2.2, zc, 0.3, 0, H - 0.8, lod);
      B.box(-4, 4, r - 1, zc + 0.6, H - 0.8, H - 0.2, K.STONE, K.STONE);
      gableRoof(B, 4, r - 1, zc + 0.6, H - 0.2, 1.4, 0.2, 0.2, K.STONE, K.STONE);
    },
  };
}

/** The amphitheatre: tiers of stone seats in a half-round round a stage, the audience facing
 *  the front (+z); a timber canopy on four columns over the stage. */
function amphitheatre(s) {
  const R = 16 * s, n = 6, sr = 5.5 * s, zc = R * 0.3;
  const half = (r0, r1, m, front) => {
    // a half-annulus about (0, zc): the back half (z < zc) or, front, the half toward +z
    const p = [];
    for (let i = 0; i <= m; i++) { const a = (i / m) * Math.PI; p.push([Math.cos(a) * r1, zc + (front ? 1 : -1) * Math.sin(a) * r1]); }
    if (r0 < 0.05) return p;
    for (let i = m; i >= 0; i--) { const a = (i / m) * Math.PI; p.push([Math.cos(a) * r0, zc + (front ? 1 : -1) * Math.sin(a) * r0]); }
    return p;
  };
  return {
    hx: R + 1.2, hz: Math.max(R - zc, zc + sr) + 1.2, stepW: 0, height: 7, low: true,
    build(B, lod) {
      const m = lod ? 10 : 24, r = (k) => sr + 2 + k * ((R - sr - 2) / n);
      // each tier a ring of its own, rising outward, so no two solids share a face
      for (let k = 0; k < n; k++) B.prism(half(r(k), r(k + 1), m, false), 0, 0.45 * (k + 1), K.STONE, K.PAVING);
      // the stage: a half-round dais before the tiers, a canopy on four columns over it
      B.prism(half(0, sr, m, true), 0, 0.9, K.STONE, K.TIMBER);
      const cols = [[-sr * 0.75, zc + 0.8], [sr * 0.75, zc + 0.8], [-sr * 0.45, zc + sr * 0.75], [sr * 0.45, zc + sr * 0.75]];
      for (const [x, z] of cols) column(B, x, z, 0.24, 0.9, 5.4, lod);
      B.box(-sr * 0.9, sr * 0.9, zc + 0.3, zc + sr * 0.85, 5.4, 5.7, K.TIMBER, K.PV);
    },
  };
}

/** The cloister: a square garden court with a fountain inside a roofed arcade walk. */
function cloister(s) {
  const h = 11 * s, w = 3.2, H = 4.2;
  return {
    hx: h + 1.2, hz: h + 1.2, stepW: 0, height: H + 2.4,
    build(B, lod) {
      // the walk: back walls, a roof slab and pitched cover on the four sides, columns on the court side
      for (const [x0, x1, z0, z1, ax] of [[-h, h, -h, -h + w, 'x'], [-h, h, h - w, h, 'x'], [-h, -h + w, -h + w, h - w, 'z'], [h - w, h, -h + w, h - w, 'z']]) {
        const inner = ax === 'x' ? (z0 < 0 ? [x0, x1, z0, z0 + 0.5] : [x0, x1, z1 - 0.5, z1]) : (x0 < 0 ? [x0, x0 + 0.5, z0, z1] : [x1 - 0.5, x1, z0, z1]);
        B.box(inner[0], inner[1], inner[2], inner[3], 0, H, K.PUNCHED, K.STONE);
        B.box(x0, x1, z0, z1, H, H + 0.45, K.STONE, K.GARDEN);
      }
      // the gate in the front walk: a taller arch-bay
      B.box(-2.2, 2.2, h - w - 0.3, h + 0.3, H + 0.45, H + 2.2, K.STONE, K.STONE);
      const e = h - w, n = Math.max(4, Math.round((2 * e) / 3));
      for (let i = 0; i <= n; i++) {
        const t = -e + (2 * e * i) / n;
        column(B, t, -e, 0.24, 0, H, lod);
        column(B, t, e, 0.24, 0, H, lod);
        if (i > 0 && i < n) { column(B, -e, t, 0.24, 0, H, lod); column(B, e, t, 0.24, 0, H, lod); }
      }
      if (!lod) B.box(-1.2, 1.2, h - 0.1, h + 0.08, 0, 3.4, K.METAL, K.METAL);
      // the garth: four beds and a fountain at the crossing
      const g = h - w - 1.6;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(Math.min(sx * 1.4, sx * g), Math.max(sx * 1.4, sx * g), Math.min(sz * 1.4, sz * g), Math.max(sz * 1.4, sz * g), 0, 0.35, K.STONE, K.GARDEN);
      B.lathe(0, 0, [[1.2, 0, K.STONE], [1.2, 0.5, K.STONE], [1.0, 0.5, K.STONE], [1.0, 0.35, K.POOL], [0.3, 0.35, K.POOL], [0.25, 1.2, K.STONE], [0.55, 1.3, K.STONE], [0, 1.45, K.STONE]], lod ? 10 : 20);
    },
  };
}

/** The town hall: a hall under a pitched roof, a clock tower rising from its front with glowing
 *  clock faces, a belfry and a bronze pyramid roof. */
function townHall(s) {
  const hx = 9 * s, hz = 5.5 * s, H = 7.4, ts = 2.4 * s, T = 17 * s;
  return {
    hx: hx + 1.4, hz: hz + ts + 2.2, stepW: 4.6, height: T + 7,
    build(B, lod) {
      B.box(-hx, hx, -hz, hz, 0, H, K.PUNCHED, K.STONE);
      const { ox, oy, oz, c, s: sn } = B, rot = Math.atan2(sn, c);
      B.frame(ox, oy, oz, rot + Math.PI / 2);
      gableRoof(B, hz, -hx, hx, H, 3.2 * s, 0.5, 0.25, K.STONE, K.STONE);
      B.frame(ox, oy, oz, rot);
      const tz = hz + ts - 0.6;
      B.box(-ts, ts, tz - ts, tz + ts, 0, T, K.PUNCHED, K.STONE);
      B.box(-ts - 0.3, ts + 0.3, tz - ts - 0.3, tz + ts + 0.3, T, T + 0.5, K.STONE, K.STONE);
      // the clock stage and its four faces
      B.box(-ts, ts, tz - ts, tz + ts, T + 0.5, T + 3.4, K.STONE, K.STONE);
      if (!lod) for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const cx = nx * (ts + 0.05), cz = tz + nz * (ts + 0.05), f = 1.0 * s;
        if (nx) B.box(cx - 0.08, cx + 0.08, cz - f, cz + f, T + 0.95, T + 0.95 + 2 * f, K.LANTERN, K.LANTERN);
        else B.box(cx - f, cx + f, cz - 0.08, cz + 0.08, T + 0.95, T + 0.95 + 2 * f, K.LANTERN, K.LANTERN);
      }
      B.box(-ts - 0.35, ts + 0.35, tz - ts - 0.35, tz + ts + 0.35, T + 3.4, T + 3.9, K.STONE, K.STONE);
      pyramid(B, 0, tz, ts + 0.2, ts + 0.2, T + 3.9, T + 3.9 + 3.6 * s, K.METAL);
      // the door under the tower
      if (!lod) B.box(-1.1, 1.1, tz + ts - 0.02, tz + ts + 0.08, 0, 3.2, K.METAL, K.METAL);
    },
  };
}

export const LANDMARKS = { chapel, lighthouse, observatory, tempietto, glasshouse, school, marketHall, lido, library, amphitheatre, cloister, townHall };
