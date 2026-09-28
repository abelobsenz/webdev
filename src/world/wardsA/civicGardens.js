import * as THREE from 'three';
import { KIND as K } from '../buildings.js';
import { latheFacade, sweepTube } from '../geom.js';
import { SD } from '../platform.js';

// The crown precincts of three Outer Wards, each round the foot of its arcology:
//
//   Aurora   the Circus of the Planets: an orrery at city scale. The crown arcology is the
//            Sun; the eight planets stand on their own inlaid bronze orbits, the inner four
//            on the paved floor, the giants in a garden ring of parterres, each a sculpture
//            on a stepped plinth (Saturn's and Uranus's rings at their true tilts, the Earth
//            with its Moon on a bronze arm).
//   Seraph   the Summit Garden: the highest of the Hanging Gardens. Six garden rooms of
//            raised planting beds between the grand stairs and the Cascade, a fountain in
//            each room, flowering trees along the balustrade.
//   Sunward  the Sun Dial: the receiver arcology is the gnomon of a dial laid in the Sun
//            Circle: bronze hour lines, thirteen hour stones and the noon obelisk, and the
//            analemma inlaid on the southern side.
//
// Plans are in the ward frame; geometry is built by the ward's landmark Builder (near and
// far LODs) in world coordinates. Every solid is closed and founded on its level.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const polar = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
/** Closed annular sector polygon (ward frame). */
function sector(r0, r1, a0, a1, step = 6) {
  const n = Math.max(3, Math.ceil((Math.abs(a1 - a0) * r1) / step));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(polar(a0 + ((a1 - a0) * i) / n, r1));
  for (let i = n; i >= 0; i--) pts.push(polar(a0 + ((a1 - a0) * i) / n, r0));
  return pts;
}

// ======================================================================= AURORA ==
export const ORRERY = [
  { name: 'Mercury', orbit: 199, a: 0.20, s: 1.7, look: 'bronze' },
  { name: 'Venus', orbit: 207, a: 1.22, s: 2.5, look: 'pearl' },
  { name: 'Earth', orbit: 216, a: 2.12, s: 2.6, look: 'earth', moon: true },
  { name: 'Mars', orbit: 225, a: -1.08, s: 2.0, look: 'bronze' },
  { name: 'Jupiter', orbit: 245, a: -2.05, s: 6.4, look: 'banded' },
  { name: 'Saturn', orbit: 254, a: 1.95, s: 5.2, look: 'banded', ring: { r0: 1.45, r1: 2.3, tilt: 0.47 } },
  { name: 'Uranus', orbit: 262, a: -0.04, s: 3.8, look: 'pearl', ring: { r0: 1.55, r1: 1.85, tilt: 1.43 } },
  { name: 'Neptune', orbit: 270, a: 0.95, s: 3.4, look: 'glass' },
];
const plinthR = (p) => p.s + 3;
/** Plan radius a planet's sculpture occupies: its plinth, or a ring that reaches beyond it. */
export const orreryReach = (p) => Math.max(plinthR(p), p.ring ? p.s * p.ring.r1 * Math.cos(p.ring.tilt) + 0.3 : 0, p.moon ? p.s * 2.6 + 0.8 : 0);
export const ORRERY_FLOOR = 234;

/**
 * The Circus plan: the paved orrery floor (the crown square, now 234 m) carrying the inner
 * planets on bronze orbits, and the garden ring between the floor and the Circus street
 * (reserved against parcels) where the giants' orbits are drawn in clipped box hedges.
 * axes: bearings of the avenues entering the Circus (their walks cross the ring).
 * keepClear(x, z, m): true near the Circus's other monuments.
 */
export function auroraCircus(T, { axes, keepClear }) {
  const floorR = ORRERY_FLOOR, bandR = 279;
  const out = { squares: [], inlays: [], sites: [], landmarks: [], parks: [], paths: [], lamps: [] };
  out.squares.push({ x: 0, z: 0, r: floorR, kind: 'crown', noLamps: true });
  out.parks.push({ x: 0, z: 0, r: bandR, trees: 0, paths: [] });
  const list = ORRERY.map((p, i) => ({ ...p, i, x: Math.cos(p.a) * p.orbit, z: Math.sin(p.a) * p.orbit }));
  for (const p of list) {
    if (p.orbit < floorR) out.inlays.push({ pts: T.ring(0, 0, p.orbit, 5), w: 0.14 });
    out.sites.push({ x: p.x, z: p.z, r: orreryReach(p) + 1.5, margin: 1, name: `orrery ${p.name}` });
  }
  const clearOf = (a, r, m) => axes.every((q) => Math.abs(angDiff(a, q)) * r > m) && !keepClear(...polar(a, r), m);
  // hedged orbits: runs of clipped box along each giant's orbit, opened for the avenue
  // walks, the spur to every outer planet and the monuments
  const spurs = list.filter((p) => p.orbit > floorR);
  const hedges = [];
  for (const p of spurs) {
    const R = p.orbit, step = 3.5 / R, n = Math.ceil(TAU / step);
    let run = null;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const [x, z] = polar(a, R);
      const open = !clearOf(a, R, 9) || list.some((q) => Math.hypot(x - q.x, z - q.z) < orreryReach(q) + 2.2)
        || spurs.some((q) => q.orbit > R && Math.abs(angDiff(a, q.a)) * R < 3.2);
      if (!open) { if (!run) { run = { r: R, a0: a, a1: a }; hedges.push(run); } run.a1 = a; } else run = null;
    }
  }
  // the runs that met across the zero bearing are one hedge
  for (const p of spurs) {
    const runs = hedges.filter((h) => h.r === p.orbit);
    const first = runs.find((h) => h.a0 === 0), last = runs.find((h) => Math.abs(h.a1 - TAU) < 1e-9);
    if (first && last && first !== last) { last.a1 = TAU + first.a1; hedges.splice(hedges.indexOf(first), 1); }
  }
  out.landmarks.push({ type: 'orrery', list, hedges: hedges.filter((h) => (h.a1 - h.a0) * h.r > 6) });
  out.paths.push({ pts: T.ring(0, 0, floorR + 3.5, 5), w: 2.0 });
  for (const q of axes) out.paths.push({ pts: [polar(q, floorR - 2), polar(q, bandR + 1)], w: 6 });
  for (const p of spurs) out.paths.push({ pts: [polar(p.a, floorR - 1), polar(p.a, p.orbit - plinthR(p) + 0.5)], w: 3 });
  // lamps round the orrery floor, clear of the avenues and the monuments
  for (let k = 0; k < 40; k++) {
    const a = ((k + 0.5) / 40) * TAU;
    if (!clearOf(a, floorR - 3, 9) || list.some((q) => Math.hypot(Math.cos(a) * (floorR - 3) - q.x, Math.sin(a) * (floorR - 3) - q.z) < orreryReach(q) + 3)) continue;
    const [lx, lz] = polar(a, floorR - 3);
    out.lamps.push({ lx, lz, yaw: a + Math.PI, cls: 0 });
  }
  return out;
}

/** The hedged orbits: closed curved prisms of clipped box 0.9 m wide and 0.85 m high. */
export function orbitHedges(B, hedges, wx, y, wz, lod) {
  B.frame(wx, y, wz, 0);
  for (const h of hedges) B.prism(sector(h.r - 0.45, h.r + 0.45, h.a0, h.a1, lod ? 14 : 3.5), -0.25, 0.85, K.GARDEN, K.GARDEN);
  B.frame(0, 0, 0, 0);
}

/** One planet of the orrery on its plinth; far LOD keeps the plinth, stem and sphere. */
export function orreryPlanet(B, parts, p, x0, y, z0, lod) {
  const s = p.s, R = plinthR(p), seg = lod ? 12 : 32;
  B.frame(x0, y, z0, -p.a);
  // plinth: stepped stone drum, a bronze band carrying the planet's orbit round it
  B.lathe(0, 0, [[R, -0.45, K.STONE], [R, 0.35, K.STONE], [R - 0.9, 0.35, K.PAVING], [R - 0.9, 0.8, K.STONE], [R - 1.8, 0.8, K.PAVING], [R - 1.8, 1.3, K.STONE], [0.9, 1.3, K.PAVING]], seg);
  if (!lod) B.lathe(0, 0, [[R - 1.74, 1.28, K.METAL], [R - 1.74, 1.42, K.METAL], [R - 1.86, 1.42, K.METAL], [R - 1.86, 1.28, K.METAL]], seg, 0, { closedProfile: true });
  const stemTop = 1.3 + 1.2 + s * 0.25;
  B.lathe(0, 0, [[0.9, 1.3, K.STONE], [0.55, 1.9, K.METAL], [0.32, stemTop + s * 0.2, K.METAL]], lod ? 6 : 12);
  // the sphere, banded for the giants
  const cy = stemTop + s;
  const prof = [];
  const nb = lod ? 8 : 20;
  const kindAt = (t) => {
    // the giants in bands of pale composite and warm timber; the Earth a garden world
    // (ice caps, green temperate belts, blue water between); Neptune glazed
    if (p.look === 'banded') return Math.floor((t + 1) * 5.5) % 2 ? K.STONE : K.TIMBER;
    if (p.look === 'bronze') return K.METAL;
    if (p.look === 'glass') return t > 0.2 ? K.GLASS : K.FRIT;
    if (p.look === 'earth') return Math.abs(t) > 0.82 ? K.STONE : Math.abs(t) > 0.3 && Math.abs(t) < 0.62 ? K.GARDEN : K.POOL;
    return K.STONE;
  };
  for (let i = 0; i <= nb; i++) {
    const a = -Math.PI / 2 + (i / nb) * Math.PI, t = Math.sin(a);
    prof.push([Math.max(0.04, s * Math.cos(a)), cy + s * t, kindAt(t)]);
  }
  B.lathe(0, 0, prof, seg);
  B.frame(0, 0, 0, 0);
  if (lod || !parts) return;
  // rings at their true tilts (a closed annulus of bronze), the Moon on its arm
  if (p.ring) {
    const g = latheFacade([{ r: s * p.ring.r0, y: -0.14, kind: 1 }, { r: s * p.ring.r1, y: -0.14, kind: 1 }, { r: s * p.ring.r1, y: 0.14, kind: 1 }, { r: s * p.ring.r0, y: 0.14, kind: 1 }], 48, { closedProfile: true });
    g.rotateZ(p.ring.tilt).rotateY(p.a + 0.6).translate(x0, y + cy, z0);
    parts.push(g);
  }
  if (p.moon) {
    const c = V(x0, y + cy, z0), dir = V(Math.cos(p.a + 1.9), 0, Math.sin(p.a + 1.9));
    const moon = c.clone().addScaledVector(dir, s * 2.6).add(V(0, s * 0.5, 0));
    parts.push(sweepTube([c.clone().addScaledVector(dir, s * 0.7), c.clone().addScaledVector(dir, s * 1.7).add(V(0, s * 0.35, 0)), moon.clone().addScaledVector(dir, -0.62)], () => 0.12, 6, { kind: 10 }));
    parts.push(latheFacade(Array.from({ length: 9 }, (_, i) => { const a = -Math.PI / 2 + (i / 8) * Math.PI; return { r: Math.max(0.03, 0.7 * Math.cos(a)), y: 0.7 * Math.sin(a), kind: 1 }; }), 16).translate(moon.x, moon.y, moon.z));
  }
}

// ======================================================================= SERAPH ==
/**
 * The Summit Garden plan on Seraph's crown terrace (y 30, the level's edge at 212 m):
 * the paved tower plaza shrinks to 150 m, and six garden rooms fill the ring between the
 * grand stairs and the Cascade: raised planting beds, a fountain pool in each room, gravel
 * walks, flowering trees along the balustrade and lamps round the plaza.
 * axes: [{ a, clear }] the stair avenues and the Cascade with the half-width kept open.
 */
export function seraphSummit(T, { axes, levelY = 30, edge = 212 }) {
  const plazaR = 150, r0 = 160, r1 = 197;
  const out = { squares: [], parks: [], pools: [], paths: [], trees: [], lamps: [], landmarks: [], sites: [] };
  out.squares.push({ x: 0, z: 0, r: plazaR, kind: 'crown', noLamps: true });
  out.parks.push({ x: 0, z: 0, r: edge - 4, trees: 0, paths: [] });
  const sorted = [...axes].sort((p, q) => p.a - q.a);
  const beds = [];
  for (let k = 0; k < sorted.length; k++) {
    const A = sorted[k], Bx = sorted[(k + 1) % sorted.length];
    const a0 = A.a, a1 = Bx.a + (k + 1 === sorted.length ? TAU : 0);
    const mid = (a0 + a1) / 2;
    const s0 = a0 + (A.clear + 5) / r0, s1 = a1 - (Bx.clear + 5) / r0, gap = 9 / r0;
    if (s1 - s0 < 3 * gap) continue;
    for (const [b0, b1] of [[s0, mid - gap], [mid + gap, s1]]) beds.push({ r0, r1, a0: b0, a1: b1 });
    // the room's fountain between its two beds
    const [px, pz] = polar(mid, (r0 + r1) / 2);
    out.pools.push({ x: px, z: pz, r: 6.5 });
    out.paths.push({ pts: [polar(mid, plazaR - 2), polar(mid, r1 + 4)], w: 4 });
    // flowering trees along the balustrade, spaced wide so the view over the city stays open
    const n = Math.floor(((s1 - s0) * 203) / 24);
    for (let i = 0; i <= n; i++) {
      const a = s0 + ((s1 - s0) * i) / Math.max(1, n);
      if (Math.abs(angDiff(a, mid)) * 203 < 10) continue;
      out.trees.push({ x: Math.cos(a) * 203, z: Math.sin(a) * 203, sp: 'flowering', s: 7 });
    }
  }
  // an avenue of blossom down the middle of every bed, rooted in the bed's soil (the beds
  // lie in the crown's garden reservation, which keeps parcels and furniture off them)
  for (const b of beds) {
    const rm = (b.r0 + b.r1) / 2, span = (b.a1 - b.a0) * rm - 12;
    const n = Math.max(1, Math.round(span / 13));
    for (let i = 0; i <= n; i++) {
      const a = b.a0 + (6 + (span * i) / n) / rm;
      out.trees.push({ x: Math.cos(a) * rm, z: Math.sin(a) * rm, sp: 'flowering', s: 6.5, root: levelY + BED_TOP - 0.25 });
    }
  }
  out.landmarks.push({ type: 'summitGarden', beds, y: levelY, fountains: out.pools.map((q) => [q.x, q.z]) });
  out.paths.push({ pts: T.ring(0, 0, plazaR + 4, 5), w: 3 });
  out.paths.push({ pts: T.ring(0, 0, r1 + 3.5, 5), w: 2.4 });
  for (let k = 0; k < 36; k++) {
    const a = ((k + 0.5) / 36) * TAU;
    if (axes.some((q) => Math.abs(angDiff(a, q.a)) * plazaR < q.clear + 4)) continue;
    const [lx, lz] = polar(a, plazaR + 1.5);
    out.lamps.push({ lx, lz, yaw: a + Math.PI, cls: 0 });
  }
  return out;
}

/**
 * Raised beds: a stone plinth, then planting spilling over the bed's sides up to its planted
 * top; each an overlapping pair of closed annular prisms.
 */
export const BED_TOP = 1.25;
export function summitBeds(B, L, wx, wz, lod) {
  // with rot 0 the Builder frame keeps the plan's (x, z) as they are
  B.frame(wx, L.y, wz, 0);
  for (const b of L.beds) {
    const e = 0.2;
    B.prism(sector(b.r0 - e, b.r1 + e, b.a0 - e / b.r0, b.a1 + e / b.r0, lod ? 12 : 4), -0.3, 0.5, K.STONE, K.STONE);
    B.prism(sector(b.r0, b.r1, b.a0, b.a1, lod ? 12 : 4), 0.35, BED_TOP, K.GARDEN, K.GARDEN);
  }
  B.frame(0, 0, 0, 0);
}

/** A bronze fountain jet standing in a pool (the pool's kerb is the ward's pool kerb). */
export function fountainJet(B, x, y, z, lod) {
  B.frame(x, y, z, 0);
  B.lathe(0, 0, [[1.6, -0.3, K.STONE], [1.6, 0.55, K.STONE], [0.9, 0.55, K.STONE], [0.5, 1.6, K.METAL], [1.4, 2.0, K.METAL], [1.4, 2.2, K.POOL], [0.3, 2.2, K.METAL], [0.18, 3.6, K.METAL]], lod ? 8 : 20);
  B.frame(0, 0, 0, 0);
}

// ====================================================================== SUNWARD ==
/**
 * The Sun Dial in the Sun Circle: hour lines fanning north of the receiver (the gnomon),
 * thirteen hour stones on a ring, the noon obelisk on the meridian, the analemma inlaid
 * to the south, and a grove of flowering trees in the western half.
 * rays: bearings of the town's rays that reach the Sun Circle (kept open).
 */
export function sunwardDial(T, { floorR = 240, towerR = 150, rays = [], keepClear = () => false }) {
  const out = { inlays: [], sites: [], landmarks: [], trees: [] };
  const stoneR = 228, stones = [];
  for (let h = 0; h <= 12; h++) {
    const a = -Math.PI + (h / 12) * Math.PI;             // 06:00 in the west to 18:00 in the east
    out.inlays.push({ pts: [polar(a, towerR + 6), polar(a, stoneR - 4)], w: h % 3 === 0 ? 0.22 : 0.12 });
    const [x, z] = polar(a, stoneR);
    stones.push({ x, z, a, h, noon: h === 6 });
    out.sites.push({ x, z, r: h === 6 ? 5.5 : 3.2, margin: 1, name: 'hour stone' });
  }
  out.inlays.push({ pts: T.arc(0, 0, stoneR - 4, -Math.PI, 0, 4), w: 0.14 });
  // the analemma: the sun's figure-of-eight over a year, inlaid south of the receiver
  const ana = [];
  for (let i = 0; i <= 96; i++) {
    const t = (i / 96) * TAU;
    ana.push([Math.sin(2 * t) * 9 - 3 * Math.sin(t), 196 + Math.cos(t) * 30]);
  }
  out.inlays.push({ pts: ana, w: 0.16 });
  out.landmarks.push({ type: 'sunDial', stones });
  // a grove in the western half of the Circle, between the rays
  // (inside the ring the crowds walk, which runs at 206 m): a grove in quincunx, three rows
  // round the southern half of the Circle, opened for the analemma and the town's rays
  for (const [row, r] of [[0, 162], [1, 174], [2, 186]]) {
    const n = Math.floor((Math.PI * r) / 12);
    for (let k = 0; k < n; k++) {
      const a = ((k + (row % 2 ? 0.5 : 0) + 0.25) / n) * Math.PI;
      const [x, z] = polar(a, r);
      if (rays.some((q) => Math.abs(angDiff(a, q)) * r < 10) || keepClear(x, z, 8) || Math.hypot(x, z - 196) < 40) continue;
      out.trees.push({ x, z, sp: 'flowering', s: 6.5 + (k % 3) * 0.6 });
    }
  }
  void floorR;
  return out;
}

/** An hour stone: a stone stele on a plinth with a bronze disc; the noon stone is an obelisk. */
export function hourStone(B, st, x, y, z, lod) {
  B.frame(x, y, z, -st.a);
  if (st.noon) {
    B.box(-3.2, 3.2, -3.2, 3.2, -0.4, 0.6, K.STONE, K.PAVING);
    B.box(-2.2, 2.2, -2.2, 2.2, 0.6, 1.4, K.STONE, K.STONE);
    B.frustum(2.4, 2.4, 1.2, 1.2, 1.4, 14.5, K.STONE);
    B.frustum(1.2, 1.2, 0.05, 0.05, 14.5, 16.4, K.METAL);
    if (!lod) B.lathe(0, 0, [[1.9, 12.2, K.METAL], [1.9, 12.5, K.METAL], [1.3, 12.5, K.METAL], [1.3, 12.2, K.METAL]], 20, 0, { closedProfile: true });
  } else {
    B.box(-1.4, 1.4, -1.4, 1.4, -0.35, 0.5, K.STONE, K.PAVING);
    B.frustum(1.3, 0.9, 0.95, 0.65, 0.5, 4.2, K.STONE);
    // the bronze hour plaque on the stele's face toward the receiver (local -x), let into it
    if (!lod) B.box(-0.6, -0.5, -0.3, 0.3, 2.35, 3.15, K.METAL, K.METAL);
    B.lathe(0, 0, [[0.5, 4.2, K.METAL], [0.5, 4.35, K.METAL], [0.05, 4.7, K.METAL]], lod ? 6 : 12);
  }
  B.frame(0, 0, 0, 0);
}
