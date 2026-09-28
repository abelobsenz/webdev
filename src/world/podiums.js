// Podium drums of the helix and canopy arcologies. The plain stone ring round each tower's foot
// becomes a piece of architecture wherever it stands clear of the ground: a colonnade of pilasters
// all round; between them, where the wall is a storey or more, glazed shopfronts under a fascia
// (with canopies over the doors, and a storey of windows above where the wall is taller still);
// a dark base course where it is lower; a parapet round the terrace walk on its top; and, on the
// inner city's arcologies, straight flights of steps up the wall to that walk.
// Everything is built bay by bay against the real ground, in world axes about the tower's base,
// and handed back for the tower's near-detail set, so the massing (and every plan made round
// the tower's footprint) is unchanged.
import * as THREE from 'three';
import { mergeClean } from './geom.js';

const TAU = Math.PI * 2;
const BAY = 8.2;            // target bay width along the wall (m)
const SHOP = 3.1;           // shopfront glazing height above the ground
const RISE = 0.17, TREAD = 0.3, STAIR_W = 3.4;

function kinds(g, kWall, kTop = kWall) {
  const p = g.attributes.position, n = g.attributes.normal, f = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = n.getY(i);
    if (Math.abs(ny) > 0.6) { f[i * 3] = x; f[i * 3 + 1] = z; f[i * 3 + 2] = kTop; }
    else { f[i * 3] = Math.abs(n.getX(i)) > Math.abs(n.getZ(i)) ? z : x; f[i * 3 + 1] = y; f[i * 3 + 2] = kWall; }
  }
  g.setAttribute('aFacade', new THREE.BufferAttribute(f, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aFacade'].includes(k)) g.deleteAttribute(k);
  return g;
}
/** closed box by extents in the bay frame (x along the wall, z out from its face) */
function slab(x0, x1, y0, y1, z0, z1, kWall, kTop = kWall) {
  if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return null;
  return kinds(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), kWall, kTop).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/**
 * @param drums  [{ r, top, bottom, walk }] wall radius, top and foot (local y above the tower's base);
 *               walk: its top is a terrace walk (parapet, and steps up to it)
 * @param ground (dx, dz) => ground height above the tower's base, at world offsets from its axis
 * @param opts   { stairs: max flights per drum, seed, sea: sea level above the tower's base }
 * @returns BufferGeometry in world axes about the tower's base, or null
 */
export function podiumDetail(drums, ground, { stairs = 0, seed = 1, sea = -1e9 } = {}) {
  const parts = [];
  for (const D of drums) {
    const n = Math.max(24, Math.round((TAU * D.r) / BAY));
    const w = (TAU * D.r) / n;
    // the ground at each bay just outside the wall: low and high across the bay (never below the drum's foot)
    const bays = [];
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * TAU;
      let lo = Infinity, hi = -Infinity;
      for (const f of [-0.45, 0, 0.45]) for (const o of [0.8, 2.6]) {
        const aa = a + (f * w) / D.r, g = Math.max(ground(Math.cos(aa) * (D.r + o), Math.sin(aa) * (D.r + o)), D.bottom);
        lo = Math.min(lo, g); hi = Math.max(hi, g);
      }
      // in the water: the drum is a quay wall there, its face starting under the tide
      const wet = lo < sea + 0.4;
      if (wet) { lo = Math.max(lo, sea - 1.2); hi = Math.max(hi, sea + 1.4); }
      bays.push({ a, lo, hi, hv: D.top - hi, wet, stair: false });
    }
    // flights of steps: on level ground where the wall is between a storey and a half and two
    // storeys high, spread round the drum
    if (D.walk && stairs) {
      const cand = [];
      for (let i = 0; i < n; i++) {
        const hv = D.top - bays[i].lo;
        if (hv < 1.4 || hv > 8.5) continue;
        const run = Math.ceil(hv / RISE) * TREAD, span = Math.ceil((run + 2) / w);
        let lo = Infinity, hi = -Infinity;
        let wet = false;
        for (let k = -1; k <= span; k++) { const b = bays[(i + k + n) % n]; lo = Math.min(lo, b.lo); hi = Math.max(hi, b.hi); wet ||= b.wet; }
        if (wet || hi - lo > 0.9) continue;
        cand.push({ i, span, run, flat: hi - lo, score: hi - lo + ((i * 7919 + seed * 104729) % 97) / 400 });
      }
      cand.sort((p, q) => p.score - q.score);
      const chosen = [];
      for (const c of cand) {
        if (chosen.length >= stairs) break;
        if (chosen.some((o) => { const d = Math.abs(o.i - c.i); return Math.min(d, n - d) < n / (stairs + 1); })) continue;
        chosen.push(c);
      }
      for (const c of chosen) {
        for (let k = -1; k <= c.span; k++) bays[(c.i + k + n) % n].stair = true;
        const b = bays[c.i];
        // the flight climbs along the wall from bay i; built in bay i's frame (x along the wall)
        const g0 = b.lo, hv = D.top - g0, N = Math.ceil(hv / RISE), rise = hv / N;
        const x0 = -w / 2 + 0.6, run = N * TREAD;
        const zIn = -((x0 + run + 1.6) ** 2) / (2 * D.r) - 0.25;     // into the curved wall behind
        const foot = g0 - 0.6;
        for (let s = 0; s < N; s++) {
          const xa = x0 + s * TREAD;
          parts.push(place(slab(xa, xa + TREAD, foot, g0 + (s + 1) * rise, zIn, STAIR_W, 1, 9), b.a, D.r));
          // the open side's cheek wall, stepped with the flight
          parts.push(place(slab(xa, xa + TREAD, foot, g0 + (s + 1) * rise + 0.95, STAIR_W, STAIR_W + 0.3, 1), b.a, D.r));
        }
        // landing onto the walk
        parts.push(place(slab(x0 + run, x0 + run + 1.6, foot, D.top, zIn, STAIR_W, 1, 9), b.a, D.r));
        parts.push(place(slab(x0 + run, x0 + run + 1.6, foot, D.top + 0.95, STAIR_W, STAIR_W + 0.3, 1), b.a, D.r));
        parts.push(place(slab(x0 + run + 1.6, x0 + run + 1.9, foot, D.top + 0.95, zIn, STAIR_W + 0.3, 1), b.a, D.r));
      }
    }
    // bay by bay
    for (let i = 0; i < n; i++) {
      const b = bays[i], hv = D.top - b.hi, bottom = b.lo - 0.4;
      if (hv < 0.9) continue;
      const P = [];
      // pilaster at the bay's start (the next bay draws the next one)
      P.push(slab(-w / 2 - 0.45, -w / 2 + 0.45, bottom, D.top - 0.55, -0.3, 0.42, 1));
      if (!b.stair && b.wet) {
        // quay face: a dark waterline course, a storey of windows above the tide where it is tall
        P.push(slab(-w / 2 + 0.45, w / 2 - 0.45, bottom, sea + 1.3, -0.2, 0.2, 10));
        if (D.top - (sea + 2.4) > 2.6) P.push(slab(-w / 2 + 0.45, w / 2 - 0.45, sea + 2.4, D.top - 0.9, -0.2, 0.06, 5));
        if (D.walk) P.push(slab(-w / 2, w / 2, D.top, D.top + 1.05, -0.62, -0.3, 1));
      } else if (!b.stair) {
        if (hv >= 3.9) {
          // shopfront: glazing on a kerb, mullions, fascia; windows above where the wall is taller
          const gTop = Math.min(b.hi + SHOP, D.top - 1.05);
          P.push(slab(-w / 2 + 0.45, w / 2 - 0.45, bottom, b.lo + 0.3, -0.2, 0.22, 10));
          P.push(slab(-w / 2 + 0.45, w / 2 - 0.45, b.lo + 0.3, gTop, -0.2, 0.08, 14));
          for (const f of [-1 / 6, 1 / 6]) P.push(slab(f * w - 0.06, f * w + 0.06, b.lo + 0.3, gTop, -0.2, 0.16, 10));
          P.push(slab(-w / 2 + 0.45, w / 2 - 0.45, gTop, gTop + 0.5, -0.2, 0.3, 1));
          if (D.top - (gTop + 0.5) > 2.6) P.push(slab(-w / 2 + 0.45, w / 2 - 0.45, gTop + 0.9, D.top - 0.9, -0.2, 0.06, 5));
          // a canopy over every third bay's door
          if (i % 3 === 1) P.push(slab(-w * 0.3, w * 0.3, gTop - 0.35, gTop - 0.2, 0.3, 2.0, 10));
        } else {
          // lower wall: a dark base course and a string course under the cornice
          P.push(slab(-w / 2 + 0.45, w / 2 - 0.45, bottom, b.lo + 0.55, -0.2, 0.16, 10));
          if (hv > 2.0) P.push(slab(-w / 2 + 0.45, w / 2 - 0.45, D.top - 1.0, D.top - 0.75, -0.2, 0.12, 1));
        }
        // parapet on the wall's crown round the terrace walk
        if (D.walk) P.push(slab(-w / 2, w / 2, D.top, D.top + 1.05, -0.62, -0.3, 1));
      }
      for (const g of P) if (g) parts.push(place(g, b.a, D.r));
    }
  }
  const list = parts.filter(Boolean);
  return list.length ? mergeClean(list) : null;
}

/** bay frame -> world axes: x along the wall, z out of it, at angle a on a drum of radius r */
function place(g, a, r) {
  if (!g) return null;
  return g.rotateY(Math.PI / 2 - a).translate(Math.cos(a) * r, 0, Math.sin(a) * r);
}
