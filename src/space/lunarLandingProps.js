import * as THREE from 'three';
import { CB } from '../craft/craftGeometry.js';
import { LK, createLunarMaterial } from './lunarMaterial.js';
import { CellLod, LodGroup } from './lunarLod.js';
import { landingArchitecture } from './lunarLandingDetail.js';
import { landingPeople } from './lunarLandingPeople.js';

// Medii Landing's streets, gardens and harbour at walking range: the things a town is
// furnished with, instanced and sorted into distance tiers round the camera (lunarLod.js).
//
//   lamp standards  cast-iron column lanterns on the Boulevard and the sea wall (the lamps'
//                   lights are the town's own point lamps; these are their posts)
//   benches         timber slats on iron ends, along the Boulevard's walks, the Strand's
//                   promenade facing the sea and round the garden squares' pools
//   bollards        cast-iron mooring bollards along the sea wall, stone bollards at the
//                   Boulevard's crossings
//   quay stairs     flights down the sea wall's face to the water, with an iron handrail
//   boats           sailing yachts (mast, boom, furled sail, rigging) and motor launches
//                   moored along the three finger piers
//   gardens         clipped hedges round every courtyard lawn, shrubs, flowerbeds in the
//                   corners and meadow tufts in the grass, hedges down the Boulevard's median
//   landing fields  edge lights round each pad, approach lights down its road, the terminal's
//                   tugs and fuel bowsers parked beside it
//   townspeople     walkers on the plazas, courtyards and quays (lunarLandingPeople.js)
//
// Everything is seated on the town's ground (the terrace tops over the Moon's sphere).

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ROT = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
function lathe(B, prof, seg) { B.push(ROT); B.lathe(prof, seg); B.pop(); }

// ------------------------------------------------------------------ prototypes --

/** A cast-iron column lantern, 7.9 m to the lantern's centre, on its origin. */
function protoLampStandard() {
  const B = new CB(), I = LK.IRON;
  const prof = [[0, 0, I], [0.36, 0, I], [0.36, 0.25, I], [0.3, 0.3, I], [0.3, 0.7, I], [0.22, 0.8, I], [0.2, 1.4, I], [0.15, 1.55, I], [0.12, 1.7, I]];
  for (let j = 0; j <= 4; j++) prof.push([0.12 - 0.035 * (j / 4), 1.7 + 5.4 * (j / 4), I]);
  prof.push([0.13, 7.12, I], [0.16, 7.2, I], [0.08, 7.3, I], [0.08, 7.4, I], [0, 7.4, I]);
  lathe(B, prof, 12);
  // the lantern: a tapered glass body in its iron frame, a crown and a finial
  lathe(B, [[0, 7.4, I], [0.14, 7.42, I], [0.22, 7.55, LK.LIGHT], [0.3, 8.25, LK.LIGHT], [0.36, 8.3, I], [0.1, 8.62, I], [0.03, 8.9, I], [0, 8.95, I]], 8);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; B.tube([V(Math.cos(a) * 0.22, 7.55, Math.sin(a) * 0.22), V(Math.cos(a) * 0.31, 8.26, Math.sin(a) * 0.31)], 0.018, 4, I); }
  // a scroll bracket for the ladder bar, and a pair of hanging-basket arms
  B.tube([V(0, 6.6, 0), V(0.45, 6.75, 0), V(0.62, 6.95, 0)], 0.02, 4, I);
  B.tube([V(0, 6.6, 0), V(-0.45, 6.75, 0), V(-0.62, 6.95, 0)], 0.02, 4, I);
  return B.geometry();
}

function protoBench() {
  const B = new CB();
  for (const s of [-1, 1]) {
    // iron ends: legs, an arm rest
    B.box(s * 0.85, 0.22, 0.14, 0.05, 0.44, 0.05, LK.IRON);
    B.box(s * 0.85, 0.22, -0.18, 0.05, 0.44, 0.05, LK.IRON);
    B.box(s * 0.85, 0.44, -0.02, 0.05, 0.05, 0.5, LK.IRON);
    B.box(s * 0.85, 0.66, 0.1, 0.05, 0.05, 0.36, LK.IRON);
    B.box(s * 0.85, 0.56, 0.26, 0.05, 0.22, 0.04, LK.IRON);
    B.box(s * 0.85, 0.66, -0.26, 0.05, 0.46, 0.04, LK.IRON);
  }
  for (let i = 0; i < 4; i++) B.box(0, 0.46, 0.18 - i * 0.12, 1.8, 0.04, 0.09, LK.WOOD);                 // seat slats
  for (let i = 0; i < 3; i++) { B.at(0, 0.62 + i * 0.13, -0.29 - i * 0.02, -0.18, 0, 0); B.box(0, 0, 0, 1.8, 0.09, 0.035, LK.WOOD); B.pop(); }   // back
  return B.geometry();
}

function protoMooringBollard() {
  const B = new CB();
  lathe(B, [[0, 0, LK.IRON], [0.24, 0, LK.IRON], [0.24, 0.08, LK.IRON], [0.16, 0.14, LK.IRON], [0.13, 0.45, LK.IRON], [0.16, 0.56, LK.IRON], [0.24, 0.62, LK.IRON], [0.22, 0.7, LK.IRON], [0, 0.72, LK.IRON]], 12);
  return B.geometry();
}

function protoStoneBollard() {
  const B = new CB();
  lathe(B, [[0, 0, LK.KERB], [0.2, 0, LK.KERB], [0.18, 0.7, LK.KERB], [0.14, 0.86, LK.KERB], [0.06, 0.92, LK.KERB], [0, 0.93, LK.KERB]], 10);
  return B.geometry();
}

/** A flight down the sea wall's face (origin on the wall's top edge, +z out over the water). */
function protoQuayStair() {
  const B = new CB();
  const n = 12;
  for (let i = 0; i < n; i++) {
    const top = -0.25 * (i + 1) + 0.05, x0 = -6 + i * 0.5;
    B.box(x0 + 0.25, (top - 3.4) / 2, 0.85, 0.52, top + 3.4, 1.6, LK.WALL);
  }
  B.box(0, -1.6, 0.85, 13, 0.2, 0.2, LK.WALL);
  // handrail on iron stanchions along its open side
  const rail = [];
  for (let i = 0; i <= 6; i++) { const x = -6 + i * 2; rail.push(V(x, -0.25 * (x + 6) / 0.5 + 0.95, 1.6)); B.tube([V(x, -0.25 * (x + 6) / 0.5 - 0.3, 1.6), rail[i].clone()], 0.02, 4, LK.IRON); }
  B.tube(rail, 0.025, 5, LK.IRON);
  return B.geometry();
}

/** A sailing yacht, 11 m, along local z, waterline on the origin. */
function protoYacht() {
  const B = new CB(), L = 11, W = 3.4;
  const rings = [];
  for (let j = 0; j <= 12; j++) {
    const t = j / 12, z = (t - 0.5) * L;
    const bw = W * 0.5 * Math.pow(Math.max(0.02, Math.sin(Math.PI * Math.min(1, 0.22 + t * 0.86))), 0.7);
    const keel = -0.7 * Math.sin(Math.PI * t) - 0.05;
    rings.push({ z, pts: [[-bw, 0.95], [-bw * 0.97, 0.3], [-bw * 0.75, -0.25], [-bw * 0.3, keel * 0.9], [0, keel], [bw * 0.3, keel * 0.9], [bw * 0.75, -0.25], [bw * 0.97, 0.3], [bw, 0.95]] });
  }
  B.loft(rings, () => LK.PAINT);
  // teak deck laid over the hull, a coachroof with ports, the cockpit coaming
  B.box(0, 0.97, 0.3, W * 0.8, 0.05, L * 0.72, LK.WOOD);
  B.box(0, 1.3, 0.6, W * 0.5, 0.62, 3.6, LK.HULL);
  for (const s of [-1, 1]) B.box(s * W * 0.25, 1.35, 0.6, 0.02, 0.2, 2.4, LK.GLASS);
  B.box(0, 1.2, -3.1, W * 0.58, 0.4, 0.06, LK.WOOD);
  // keel fin and rudder under water
  B.box(0, -1.3, 0.3, 0.2, 1.4, 1.6, LK.DARK);
  B.box(0, -0.6, -4.9, 0.08, 1.0, 0.7, LK.DARK);
  // mast, boom with the furled mainsail, the forestay and backstay, a pulpit
  B.tube([V(0, 1.0, 1.4), V(0, 14.5, 1.4)], 0.08, 6, LK.HULL);
  B.tube([V(0, 2.4, 1.4), V(0, 2.5, -3.6)], 0.06, 5, LK.HULL);
  B.tube([V(0, 2.75, 1.2), V(0, 2.8, -3.4)], (t) => 0.2 - 0.08 * t, 6, LK.SAIL);
  B.tube([V(0, 14.3, 1.4), V(0, 1.0, 5.3)], 0.012, 3, LK.IRON);
  B.tube([V(0, 14.3, 1.4), V(0, 1.0, -5.3)], 0.012, 3, LK.IRON);
  for (const s of [-1, 1]) B.tube([V(s * 1.5, 1.0, 1.4), V(s * 0.1, 10, 1.4)], 0.01, 3, LK.IRON);
  B.tube([V(-0.8, 1.0, 4.6), V(-0.6, 1.6, 5.1), V(0.6, 1.6, 5.1), V(0.8, 1.0, 4.6)], 0.02, 4, LK.IRON);
  // fenders over the side
  for (let i = 0; i < 3; i++) B.tube([V(W * 0.52, 0.3, -2 + i * 2), V(W * 0.52, 0.8, -2 + i * 2)], 0.1, 6, LK.HULL);
  return B.geometry();
}

/** A motor launch, 9 m, with a wheelhouse. */
function protoLaunch() {
  const B = new CB(), L = 9, W = 3.0;
  const rings = [];
  for (let j = 0; j <= 10; j++) {
    const t = j / 10, z = (t - 0.5) * L;
    const bw = W * 0.5 * Math.pow(Math.max(0.03, Math.sin(Math.PI * Math.min(1, 0.35 + t * 0.7))), 0.6);
    rings.push({ z, pts: [[-bw, 1.1], [-bw * 0.95, 0.2], [-bw * 0.6, -0.45], [0, -0.7], [bw * 0.6, -0.45], [bw * 0.95, 0.2], [bw, 1.1]] });
  }
  B.loft(rings, () => LK.PAINT);
  B.box(0, 1.12, 0, W * 0.82, 0.05, L * 0.8, LK.WOOD);
  B.box(0, 1.9, -0.6, W * 0.66, 1.5, 2.8, LK.HULL);
  B.box(0, 2.1, 0.81, W * 0.62, 0.8, 0.02, LK.GLASS);
  for (const s of [-1, 1]) B.box(s * W * 0.335, 2.1, -0.6, 0.02, 0.7, 2.4, LK.GLASS);
  B.box(0, 2.7, -0.8, W * 0.74, 0.1, 3.4, LK.PAINT);
  B.tube([V(0, 2.75, -1.2), V(0, 4.2, -1.2)], 0.04, 4, LK.IRON);
  B.box(0, 4.1, -1.2, 0.6, 0.05, 0.05, LK.IRON);
  B.tube([V(-1.1, 1.15, -4), V(-1.1, 1.8, -4), V(1.1, 1.8, -4), V(1.1, 1.15, -4)], 0.025, 4, LK.IRON);
  for (let i = 0; i < 2; i++) B.tube([V(W * 0.5, 0.4, -1.5 + i * 3), V(W * 0.5, 0.9, -1.5 + i * 3)], 0.1, 6, LK.HULL);
  return B.geometry();
}

/** A clipped hedge, 1 m of it along x (scaled to its run), 1.1 m high, 0.8 m thick. */
function protoHedge() {
  const B = new CB();
  B.box(0, 0.5, 0, 1, 1.0, 0.8, LK.HEDGE);
  B.at(0, 1.0, 0, 0, 0, Math.PI / 2);
  B.tube([V(0, -0.5, 0), V(0, 0.5, 0)], 0.4, 8, LK.HEDGE);
  B.pop();
  return B.geometry();
}

/** A shrub: a lumpy mound of five clumps, 1.4 m across. */
function protoShrub() {
  const B = new CB(), r = rng(51);
  for (let i = 0; i < 6; i++) {
    const a = (i / 5) * Math.PI * 2, d = i === 5 ? 0 : 0.38;
    const R = i === 5 ? 0.62 : 0.45 + 0.1 * r();
    B.at(Math.cos(a) * d, 0, Math.sin(a) * d, 0, r() * 6, 0);
    lathe(B, [[0, 0.05, LK.HEDGE], [R * 0.8, 0.12, LK.HEDGE], [R, 0.4 + R * 0.3, LK.HEDGE], [R * 0.7, 0.62 + R * 0.6, LK.HEDGE], [0, 0.7 + R * 0.75, LK.HEDGE]], 8);
    B.pop();
  }
  return B.geometry();
}

/** A flowerbed: a stone-edged oval of blooms, 4 x 2 m. */
function protoFlowerbed() {
  const B = new CB(), r = rng(77);
  lathe(B, [[0, 0.0, LK.KERB], [1.0, 0.0, LK.KERB], [1.0, 0.22, LK.KERB], [0.92, 0.22, LK.KERB], [0.9, 0.15, LK.HEDGE], [0, 0.16, LK.HEDGE]], 18);
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.72, R = 0.12 + 0.08 * r();
    B.at(Math.cos(a) * d, 0.12, Math.sin(a) * d);
    lathe(B, [[0, 0, LK.BLOOM], [R, 0.08, LK.BLOOM], [R * 0.8, 0.22 + R, LK.BLOOM], [0, 0.3 + R, LK.BLOOM]], 6);
    B.pop();
  }
  return B.geometry();
}

/** A tuft of grass: a dozen blades, two-sided, 0.35 m. */
function protoTuft() {
  const B = new CB(), r = rng(19);
  for (let i = 0; i < 12; i++) {
    const a = r() * Math.PI * 2, lean = 0.15 + 0.25 * r(), h = 0.22 + 0.2 * r(), w = 0.018 + 0.01 * r();
    const c = Math.cos(a), s = Math.sin(a), ox = (r() - 0.5) * 0.12, oz = (r() - 0.5) * 0.12;
    const p0 = [ox - s * w, 0, oz + c * w], p1 = [ox + s * w, 0, oz - c * w], p2 = [ox + c * lean * h, h, oz + s * lean * h];
    const n = V(c, 0, s).cross(V(0, 1, 0));
    const ids = [p0, p1, p2].map((p, j) => B.v(p[0], p[1], p[2], j * 0.1, p[1], LK.GRASS));
    B.tri(ids[0], ids[1], ids[2], n);
    const ids2 = [p0, p1, p2].map((p, j) => B.v(p[0], p[1], p[2], j * 0.1, p[1], LK.GRASS));
    B.tri(ids2[0], ids2[1], ids2[2], n.clone().negate());
  }
  return B.geometry();
}

/** An airfield tug / fuel bowser: a cab-forward truck, 7 m, in its livery. */
function protoBowser() {
  const B = new CB();
  B.box(0, 0.9, 0, 2.4, 0.4, 7.0, LK.DARK);                                       // chassis
  B.box(0, 1.9, 2.6, 2.4, 1.9, 1.7, LK.PAINT);                                    // cab
  B.box(0, 2.25, 3.46, 2.2, 0.8, 0.02, LK.GLASS);
  for (const s of [-1, 1]) B.box(s * 1.21, 2.2, 2.7, 0.02, 0.7, 1.1, LK.GLASS);
  B.push(new THREE.Matrix4().makeTranslation(0, 2.2, -0.9));
  B.tube([V(0, 0, -2.4), V(0, 0, 1.4)], 1.05, 14, LK.PAINT);                     // the tank
  B.pop();
  B.box(0, 3.3, -0.9, 0.5, 0.12, 3.6, LK.IRON);                                   // catwalk
  B.box(0, 1.6, -3.45, 2.3, 0.3, 0.1, LK.HAZARD);
  B.box(0, 2.95, 2.6, 0.9, 0.12, 0.3, LK.LIGHT);                                 // beacon bar
  for (const z of [-2.4, -1.1, 2.4]) for (const s of [-1, 1]) {
    B.at(s * 1.05, 0.5, z, 0, 0, Math.PI / 2);
    lathe(B, [[0, -0.2, LK.DARK], [0.5, -0.2, LK.DARK], [0.5, 0.2, LK.DARK], [0, 0.2, LK.DARK]], 12);
    B.pop();
  }
  return B.geometry();
}

/** A pad edge light: a squat post with a lens (LIGHT glows), 0.5 m. */
function protoEdgeLight() {
  const B = new CB();
  lathe(B, [[0, 0, LK.IRON], [0.12, 0, LK.IRON], [0.06, 0.05, LK.IRON], [0.05, 0.32, LK.IRON], [0.1, 0.34, LK.LIGHT], [0.1, 0.5, LK.LIGHT], [0, 0.52, LK.IRON]], 8);
  return B.geometry();
}

// ------------------------------------------------------------------ the dress --

export class LandingDetail {
  /**
   * L: buildMediiLanding()'s result; mat: the town's lunar material (shared).
   */
  constructor(L, mat) {
    const S = L.S, r = rng(3301);
    this.lod = new LodGroup('Medii Landing street detail');
    this.group = this.lod.group;
    const add = (set) => this.lod.add(set);
    const g = (x, z) => S.gy(x, z);

    // --- the houses' architecture ---
    for (const set of landingArchitecture(S, mat, { near: 800 }).sets) add(set);

    // --- lamp standards ---
    const lampS = new CellLod('Lamp standards', [protoLampStandard()], [1600], mat, { cell: 200 });
    for (const p of S.props.lamps) lampS.add(p.x, p.y, p.z, p.ry, 1, p.kind === 'quay' ? 6.5 / 7.9 : 1, 1);
    add(lampS);

    // --- benches ---
    const bench = new CellLod('Benches', [protoBench()], [700], mat, { tint: true, cell: 160 });
    const WOOD = [0.95, 0.9, 0.85];
    // along the Boulevard's walks, facing the carriageway, halfway between the lamps
    for (let v = S.V.MID + 48; v < S.V.STRAND - 20; v += 36) {
      if (Math.abs(v - S.V.LOW) < 30) continue;
      const h = v < S.V.LOW ? S.T.MID : S.T.LOW;
      for (const s of [-1, 1]) {
        const [x, z] = S.UV(s * 29, v);
        bench.add(x, g(x, z) + h, z, S.ROT_UV + (s > 0 ? -Math.PI / 2 : Math.PI / 2), 1, 1, 1, WOOD);
      }
    }
    // the Strand's promenade: facing the sea between the lamps
    for (const q of S.props.quay) {
      if (!q.free || Math.abs(((q.u % 40) + 40) % 40 - 20) > 0.1) continue;
      const [x, z] = S.UV(q.u, q.v - 12);
      bench.add(x, g(x, z) + S.T.STRAND, z, q.ry, 1, 1, 1, WOOD);
    }

    // --- bollards on the sea wall; stairs down to the water every 240 m ---
    const moor = new CellLod('Mooring bollards', [protoMooringBollard()], [900], mat, { cell: 200 });
    const stair = new CellLod('Quay stairs', [protoQuayStair()], [1500], mat, { cell: 240 });
    for (const q of S.props.quay) {
      const [x, z] = S.UV(q.u, q.v + 0.5);
      if (q.free) moor.add(x, g(x, z) + S.T.STRAND, z, q.ry);
      if (q.free && Math.abs(((q.u + 120) % 240 + 240) % 240) < 0.1) {
        const [sx, sz] = S.UV(q.u, q.v + 1.2);
        stair.add(sx, g(sx, sz) + S.T.STRAND, sz, q.ry);
      }
    }
    add(moor); add(stair);

    // --- stone bollards where the cross streets meet the Boulevard ---
    const stoneB = new CellLod('Stone bollards', [protoStoneBollard()], [700], mat, { cell: 160 });
    for (let v = S.V.MID + 9; v < S.V.STRAND; v += 128) for (const s of [-1, 1]) for (let i = -2; i <= 2; i++) {
      const [x, z] = S.UV(s * 33, v + i * 1.6);
      stoneB.add(x, g(x, z) + (v < S.V.LOW ? S.T.MID : S.T.LOW), z);
    }
    add(stoneB);

    // --- boats moored along the piers ---
    const yacht = new CellLod('Moored yachts', [protoYacht()], [2500], mat, { tint: true, cell: 200 });
    const launch = new CellLod('Moored launches', [protoLaunch()], [2500], mat, { tint: true, cell: 200 });
    const HULLS = [[0.9, 0.9, 0.88], [0.14, 0.2, 0.36], [0.6, 0.12, 0.1], [0.92, 0.9, 0.82], [0.2, 0.34, 0.3], [0.86, 0.86, 0.9]];
    for (const p of S.props.piers) {
      for (const side of [-1, 1]) for (let dv = 26; dv < p.v1 - p.v0 - 12; dv += 13) {
        const v = p.v0 + dv;
        // clear of the big boats already moored along each pier (22 m off its axis)
        if (r() < 0.22) continue;
        const isY = r() < 0.62;
        const off = p.w / 2 + (isY ? 2.2 : 2.0);
        const [x, z] = S.UV(p.u + side * off, v);
        const col = HULLS[Math.floor(r() * HULLS.length)];
        (isY ? yacht : launch).add(x, g(x, z) - 0.05, z, S.ROT_UV + (r() < 0.5 ? 0 : Math.PI), 1, 1, 1, col, (r() - 0.5) * 0.02, (r() - 0.5) * 0.03);
      }
    }
    add(yacht); add(launch);

    // --- gardens: hedges round the lawns, shrubs, flowerbeds, grass tufts ---
    const hedge = new CellLod('Hedges', [protoHedge()], [1000], mat, { tint: true, cell: 180 });
    const shrub = new CellLod('Shrubs', [protoShrub()], [450], mat, { tint: true, cell: 140 });
    const bed = new CellLod('Flowerbeds', [protoFlowerbed()], [600], mat, { tint: true, cell: 140 });
    const tuft = new CellLod('Grass tufts', [protoTuft()], [260], mat, { tint: true, cell: 60 });
    const trees = L.treeInstances || [];
    const tgrid = new Map(), TC = 20;
    for (const t of trees) { const k = Math.floor(t.x / TC) * 65536 + Math.floor(t.z / TC); if (!tgrid.has(k)) tgrid.set(k, []); tgrid.get(k).push(t); }
    const nearTree = (x, z, d) => {
      const cx = Math.floor(x / TC), cz = Math.floor(z / TC);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const t of tgrid.get((cx + i) * 65536 + cz + j) || []) if (Math.hypot(t.x - x, t.z - z) < d + t.r * 0.25) return true;
      return false;
    };
    const GREEN = () => { const l = 0.8 + 0.4 * r(); return [l * (0.95 + 0.1 * r()), l, l * (0.9 + 0.1 * r())]; };
    const BLOOMS = [[0.8, 0.16, 0.2], [0.9, 0.66, 0.16], [0.56, 0.3, 0.7], [0.92, 0.9, 0.86], [0.92, 0.46, 0.56], [0.3, 0.4, 0.8]];
    const at = (u, v, top) => { const [x, z] = S.UV(u, v); return [x, g(x, z) + top, z]; };
    for (const c of S.courts) {
      if (c.hu < 6 || c.hv < 6) continue;
      const ins = 1.6;
      // hedges round the lawn, broken for a path in the middle of each side
      for (const [du, dv, len, alongU] of [[0, -(c.hv - ins), c.hu - ins, true], [0, c.hv - ins, c.hu - ins, true], [-(c.hu - ins), 0, c.hv - ins, false], [c.hu - ins, 0, c.hv - ins, false]]) {
        for (const half of [-1, 1]) {
          const seg = len - 2.2;
          if (seg < 2) continue;
          const mu = alongU ? du + half * (2.2 + seg / 2) : du, mv = alongU ? dv : dv + half * (2.2 + seg / 2);
          const [x, y, z] = at(c.uc + mu, c.vc + mv, c.top);
          hedge.add(x, y, z, S.ROT_UV + (alongU ? 0 : Math.PI / 2), seg, 0.8 + 0.4 * r(), 1, GREEN());
        }
      }
      // flowerbeds in the lawn's corners
      for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const u = c.uc + su * (c.hu - 5.5), v = c.vc + sv * (c.hv - 4.5);
        const [x, y, z] = at(u, v, c.top);
        if (nearTree(x, z, 2.5)) continue;
        bed.add(x, y, z, S.ROT_UV, 2, 1, 1, BLOOMS[Math.floor(r() * BLOOMS.length)]);
      }
      // shrubs and tufts scattered over the lawn, clear of the trunks
      const area = c.hu * c.hv * 4;
      const nS = Math.round(area / 180), nT = Math.round(area / 25);
      for (let i = 0; i < nS; i++) {
        const u = c.uc + (r() * 2 - 1) * (c.hu - 4), v = c.vc + (r() * 2 - 1) * (c.hv - 4);
        const [x, y, z] = at(u, v, c.top);
        if (c.garden && Math.abs(u - c.uc) < 20 && Math.abs(v - c.vc) < 20) continue;
        if (nearTree(x, z, 1.6)) continue;
        const sc = 0.7 + 0.8 * r();
        shrub.add(x, y, z, r() * 6.28, sc, sc * (0.8 + 0.5 * r()), sc, GREEN());
      }
      for (let i = 0; i < nT; i++) {
        const u = c.uc + (r() * 2 - 1) * (c.hu - 2.5), v = c.vc + (r() * 2 - 1) * (c.hv - 2.5);
        if (c.garden && Math.abs(u - c.uc) < 17.5 && Math.abs(v - c.vc) < 17.5) continue;
        const [x, y, z] = at(u, v, c.top);
        const sc = 0.7 + 0.9 * r();
        tuft.add(x, y, z, r() * 6.28, sc, sc, sc, GREEN());
      }
      // benches round a garden square's pool
      if (c.garden) for (let q = 0; q < 4; q++) for (const o of [-6, 6]) {
        const lu = q % 2 === 0 ? o : (q === 1 ? 19 : -19), lv = q % 2 === 0 ? (q === 0 ? -19 : 19) : o;
        const [x, y, z] = at(c.uc + lu, c.vc + lv, c.top);
        bench.add(x, y, z, S.ROT_UV + (q === 0 ? 0 : q === 2 ? Math.PI : q === 1 ? -Math.PI / 2 : Math.PI / 2), 1, 1, 1, WOOD);
      }
    }
    // the Boulevard's median: hedges along both edges, beds at the ends
    for (const [v0, v1, h] of [[S.V.MID + 20, S.V.LOW - 20, S.T.MID], [S.V.LOW + 20, S.V.STRAND - 20, S.T.LOW]]) {
      for (let v = v0 + 4; v < v1 - 14; v += 18) for (const s of [-1, 1]) {
        const [x, y, z] = at(s * 5.2, v + 7, h + 0.5);
        hedge.add(x, y, z, S.ROT_UV + Math.PI / 2, 12, 0.7, 0.7, GREEN());
      }
      for (const v of [v0 + 3, v1 - 3]) { const [x, y, z] = at(0, v, h + 0.5); bed.add(x, y, z, S.ROT_UV, 2.2, 1, 1.3, BLOOMS[Math.floor(r() * BLOOMS.length)]); }
    }
    add(hedge); add(shrub); add(bed); add(tuft); add(bench);

    // --- the landing fields: edge lights, approach lights down the road, parked bowsers ---
    const edge = new CellLod('Pad edge lights', [protoEdgeLight()], [2500], mat, { cell: 300 });
    const bowser = new CellLod('Airfield bowsers and tugs', [protoBowser()], [2000], mat, { tint: true, cell: 300 });
    const LIVERY = [[0.9, 0.6, 0.12], [0.85, 0.86, 0.88], [0.7, 0.14, 0.12]];
    S.PADS.forEach(([u, v]) => {
      const [cx, cz] = S.UV(u, v), y0 = g(cx, cz);
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        edge.add(cx + Math.cos(a) * 244, y0 + 1.2, cz + Math.sin(a) * 244);
      }
      for (let vv = v + 280; vv < v + 700; vv += 12) for (const s of [-1, 1]) {
        const [x, z] = S.UV(u + s * 14, vv);
        edge.add(x, g(x, z) + 0.5, z);
      }
      for (let i = 0; i < 4; i++) {
        const [x, z] = S.UV(u + 24 + i * 4.2, v + 300);
        bowser.add(x, g(x, z) + 0.5, z, S.ROT_UV + Math.PI, 1, 1, 1, LIVERY[i % 3]);
      }
    });
    add(edge); add(bowser);

    // --- townspeople ---
    const pmat = createLunarMaterial({ lit: 0.6, walk: true });
    for (const set of landingPeople(S, pmat, trees, mat)) add(set);
    this.peopleMaterial = pmat;
  }

  /** cam: the camera in the Landing's site frame (metres). */
  update(cam, force = false) { this.lod.update(cam, force); }
  triangles() { return this.lod.triangles(); }
}
