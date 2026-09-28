import { SD } from '../platform.js';
import { T, ST } from '../wardPlan.js';

// Tidewater's secondary waterways. The Grand Canal and the Singel (the ring canal) are
// the city's arteries; the rii are its capillaries: the Crescent, a southern arc that
// leaves the Grand Canal and returns to it, and five radial rii that carry the Singel out
// through the outer canal belt to the sea. Each rio is a stone-walled channel (14 m of
// water between 4 m quays at +3 m, walls up to the streets at +9 m) with a fondamenta
// lane along both banks, canal houses fronting it, and hump-backed footbridges wherever
// a calle meets it square-on.
//
// All geometry is in the ward frame (metres from the ward centre, +x east, +z south).

export const RIO = { sea: 7, top: 11, lane: 3.5 };
/** Centreline offset of a fondamenta lane from its rio: 2 m of verge clear of the wall. */
export const FOND_OFF = RIO.top + 2 + RIO.lane;

const TAU = Math.PI * 2;

/**
 * The rii of Tidewater, as { name, pts } centrelines. Their ends run into the water they
 * join (the Singel, the Grand Canal or the open sea), so every channel is continuous.
 * ctx: { R(a), ringCanal }.
 */
export function tidewaterRii(ctx) {
  const { R } = ctx;
  const rc = ctx.ringCanal;
  const out = [];
  // the Crescent: an oxbow that leaves the Grand Canal's southern bank east of the Tidehall
  // and returns to it west of the House of the Tide Tables, crossing the Ruga dei Mercanti
  // and the south-western calle on bridges; both ends lie on the Grand Canal's centreline
  out.push({ name: 'Rio della Luna', kind: 'crescent', pts: T.curve([[230, 262], [290, 400], [200, 540], [-40, 612], [-270, 560], [-410, 440], [-440, 326]], 6) });
  // radial rii across the outer canal belt, each with a slight bend so the channel reads
  // as dug, not ruled; the landings, the helix arcology and the existing radial canals
  // (at -1.66 and 1.32) keep their clearances
  for (const [a, bend, name] of [[-2.52, 0.035, 'Rio dei Vetrai'], [-2.08, -0.03, 'Rio delle Maree'], [-1.18, 0.03, 'Rio del Faro'], [0.74, -0.035, 'Rio dei Mercati'], [1.84, 0.03, 'Rio delle Stelle']]) {
    const r0 = rc - 8, r1 = R(a) + 70, rm = (rc + R(a)) / 2;
    const P = (aa, r) => [Math.cos(aa) * r, Math.sin(aa) * r];
    out.push({ name, kind: 'radial', a, pts: T.curve([P(a, r0), P(a + bend * 0.4, r0 + (rm - r0) * 0.5), P(a + bend, rm), P(a + bend * 0.4, rm + (r1 - rm) * 0.55), P(a, r1)], 6) });
  }
  return out;
}

/** Carve the rii into the ward's sea (quay level) and street-level fields. */
export function carveRii(rii, sea, top) {
  for (const r of rii) {
    sea.sub(SD.polyline(r.pts, RIO.sea));
    top.sub(SD.polyline(r.pts, RIO.top));
  }
}

/** Distance from (x, z) to the nearest rio centreline. */
export function rioDistance(rii, x, z) {
  let best = Infinity;
  for (const r of rii) {
    const P = r.pts;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Fondamenta lanes along both banks of every rio. */
export function fondamente(rii) {
  const out = [];
  for (const r of rii) for (const s of [-1, 1]) out.push({ pts: T.offset(r.pts, s * FOND_OFF), cls: ST.LANE, hw: RIO.lane, name: 'fondamenta rio', noBridges: true, rio: r.name });
  return out;
}

/**
 * A marina basin at a canal mouth: the point on the canal `inset` metres inside the ward
 * outline, found by walking the canal inward from its seaward end (the canal curves, so
 * a chord between control points is not good enough). Returns { x, z, rot } or null.
 */
export function canalMouth(pts, R, fromEnd, inset) {
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const i = fromEnd ? n - 1 - k : k;
    const p = pts[i];
    const d = Math.hypot(p[0], p[1]) - R(Math.atan2(p[1], p[0]));
    if (d <= -inset) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (!fromEnd) rot += Math.PI;          // local +u points out to sea at both mouths
      return { x: p[0], z: p[1], rot: ((rot % TAU) + TAU) % TAU };
    }
  }
  return null;
}
