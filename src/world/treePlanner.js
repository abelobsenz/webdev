import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { coreRadius, latticeRadius } from './axis.js';
import { INNER } from './terrain.js';
import { PLAZA_R, PLAZA_Y } from './layout.js';
import { SPECIES, SP } from './treeGeometry.js';
import { wardHeight, WARD_TOP } from './metro.js';
import { wardTreeGuard } from './wardsA/wardGuard.js';

// A civic approach is public paving even where it crosses a street verge.
// Include the root flare, rather than testing only the trunk centre.
export function wardTreePathClear(surfaceAt, x, z, radius = 1.2) {
  if (surfaceAt(x, z) === 'path') return false;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    if (surfaceAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius) === 'path') return false;
  }
  return true;
}

// Where every tree in MERIDIAN grows, and why:
//  - lagoon shores: mangrove stands in the shallows, coconut palms leaning seaward on the strand
//  - forest: layered rainforest (canopy trees, emergent banyans, bamboo in the gullies,
//    tree ferns and bananas in the understory)
//  - meadows: scattered rain trees, flowering trees and Norfolk pines near the coast
//  - the garden city: avenue trees lining the walks, park giants on the lawns
//  - designed places: the Axis plaza garden rings and terraces, tower sky gardens and the
//    Axis Garden Deck
// Every candidate is checked against the clearance field (no crowns in walls, decks or piers),
// kept off walks and plazas, and rooted at the lowest ground under its root flare.

// JS twins of the GLSL garden-city functions (natureGlsl.js) so trees respect the same walks.
const fract = (x) => x - Math.floor(x);
function hash12(px, py) {
  let x = fract(px * 0.1031), y = fract(py * 0.1031), z = fract(px * 0.1031);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}
function vnoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy), b = hash12(ix + 1, iy), c = hash12(ix, iy + 1), d = hash12(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const sstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
export function walkDistNoise(x, z, urban) {
  const d1 = Math.abs(vnoise(x * 0.0105 + 3.7, z * 0.0105 + 3.7) - 0.5) / (0.0105 * 1.25);
  let d2 = Math.abs(vnoise(x * 0.023 - 8.1, z * 0.023 - 8.1) - 0.5) / (0.023 * 1.25);
  const w = sstep(0.45, 0.7, urban);
  d2 = 99 + (d2 * 2 - 99) * w;
  return Math.min(d1, d2 + 1.3);
}
export function plazaMaskNoise(x, z, urban) {
  return sstep(0.662, 0.672, vnoise(x * 0.0068 + 21, z * 0.0068 + 21)) * sstep(0.5, 0.85, urban);
}

export const crownRadius = (sp, s) => SPECIES[sp].shape[2] * s * 0.5;

export function planTrees(world) {
  const rnd = mulberry32(2024);
  const { info, sampler } = world;
  const C = world.clearance;
  const plan = world.plan;
  const stations = (world.infra && world.infra.stations) || [];
  // the town plan's street field replaces the old procedural walks
  const walkDist = plan ? (x, z) => plan.field.edge(x, z) + 2.6 : walkDistNoise;
  const plazaMask = plan ? (x, z) => plan.field.squareAt(x, z) : plazaMaskNoise;
  const N = info.N, half = INNER.half, cell = (2 * half) / N;
  const trees = [];
  const G = 12;
  const occ = new Map();
  const key = (x, z) => `${Math.floor(x / G)},${Math.floor(z / G)}`;
  const clear = (x, z, r, layer) => {
    const cx = Math.floor(x / G), cz = Math.floor(z / G);
    const span = Math.ceil((r + 14) / G);
    for (let dx = -span; dx <= span; dx++) for (let dz = -span; dz <= span; dz++) {
      const l = occ.get(`${cx + dx},${cz + dz}`);
      if (l) for (const o of l) { const d = Math.hypot(o.x - x, o.z - z); if (d < 2.2 || (o.layer === layer && d < Math.max(o.r, r))) return false; }
    }
    return true;
  };
  const occupy = (x, z, r, layer) => { const k = key(x, z); if (!occ.has(k)) occ.set(k, []); occ.get(k).push({ x, z, r, layer }); };
  const tint = (sp) => {
    const v = 0.85 + rnd() * 0.3;
    return [v * (0.92 + rnd() * 0.16), v * (0.92 + rnd() * 0.18), v * (0.9 + rnd() * 0.15)];
  };
  const rootY = (x, z, r) => {
    let m = sampler.get(x, z);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; m = Math.min(m, sampler.get(x + Math.cos(a) * r, z + Math.sin(a) * r)); }
    return m - 0.15;
  };
  /** Does a tree of species sp and height s fit at x,z? */
  const fits = (x, z, sp, s, urban) => {
    const cr = crownRadius(sp, s);
    if (C) {
      if (C.groundAt(x, z) < cr * 0.92 + 0.8) return false;
      if (C.overAt(x, z) < cr + 1.5) return false;
    }
    if (urban > 0.1 || plan) {
      if (walkDist(x, z, urban) < 2.6 + Math.max(1.4, s * 0.05) + 0.6) return false;
      if (plazaMask(x, z, urban) > 0.2) return false;
    }
    return true;
  };
  const push = (x, z, sp, s, { lean = 0, rot = rnd() * Math.PI * 2, y, bloom, layer = 0, spacing } = {}) => {
    const trunkR = sp === SP.banyan ? 3.5 : sp === SP.mangrove ? 3 : Math.max(0.6, s * 0.035);
    const yy = y ?? rootY(x, z, trunkR);
    if (y === undefined && yy < 0.25) return;           // no tree stands in the water
    trees.push({ x, y: yy, z, s, sp, rot, lean, tint: tint(sp), bloom });
    occupy(x, z, spacing ?? crownRadius(sp, s) * 0.45, layer);
  };
  const seaward = (i, j) => {
    const at = (a, b) => info.shore[Math.min(N - 1, Math.max(0, b)) * N + Math.min(N - 1, Math.max(0, a))];
    const gx = at(i + 1, j) - at(i - 1, j), gz = at(i, j + 1) - at(i, j - 1);
    return Math.atan2(gz, -gx);   // yaw that points the local +x (the palm's lean) toward the sea
  };

  // ------------------------------------------------ natural placement --
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      const x = -half + (i + rnd()) * cell, z = -half + (j + rnd()) * cell;
      if (x * x + z * z < (PLAZA_R + 230) ** 2) continue;
      const h = sampler.get(x, z);
      if (h < -1.0) continue;
      const u = info.urban[k], f = info.forest[k], sd = info.shore[k], ex = info.exposure[k], cv = info.curv[k];
      const r = rnd();
      // mangrove stands along calm lagoon shores, rooted on the dry fringe above the waterline
      if (h < 1.0) {
        if (h > 0.55 && ex < 0.4 && u < 0.3 && sd > -32 && vnoise(x * 0.006 + 40, z * 0.006) > 0.45 && r < 0.6) {
          const s = 6 + rnd() * 3;
          if (fits(x, z, SP.mangrove, s, u) && clear(x, z, 3.5, 0)) push(x, z, SP.mangrove, s, { spacing: 3.5 });
        }
        continue;
      }
      // the strand: coconut palms leaning toward the sea
      if (h < 4.5) {
        if (r < (u > 0.3 ? 0.1 : 0.22)) {
          const s = 13 + rnd() * 9;
          if (fits(x, z, SP.palm, s, u) && clear(x, z, 5, 0)) push(x, z, SP.palm, s, { rot: seaward(i, j) + (rnd() - 0.5) * 0.9, lean: 0.03 + rnd() * 0.08, spacing: 5 });
        }
        continue;
      }
      if (f > 0.22) {
        // rainforest
        if (r < f * 0.82) {
          let sp, s;
          const q = rnd();
          if (cv > 0.22 && q < 0.4) { sp = SP.bamboo; s = 11 + rnd() * 5; }
          else if (q < 0.025) { sp = SP.banyan; s = 20 + rnd() * 6; }
          else if (q < 0.11) { sp = SP.flowering; s = 9 + rnd() * 5; }
          else if (q < 0.22) { sp = SP.rainTree; s = 13 + rnd() * 5; }
          else if (h < 9 && q < 0.34) { sp = SP.palm; s = 14 + rnd() * 7; }
          else { sp = rnd() < 0.55 ? SP.forest : SP.forestBroad; s = 18 + rnd() * 12; }
          if (fits(x, z, sp, s, u) && clear(x, z, crownRadius(sp, s) * 0.4, 0)) push(x, z, sp, s, { lean: rnd() * 0.05 });
        }
        // understory
        const q2 = rnd();
        if (q2 < f * 0.3) {
          const x2 = x + (rnd() - 0.5) * cell, z2 = z + (rnd() - 0.5) * cell;
          const sp = rnd() < 0.72 ? SP.treeFern : SP.banana;
          const s = sp === SP.treeFern ? 4 + rnd() * 4 : 3.5 + rnd() * 1.5;
          if (fits(x2, z2, sp, s, u) && clear(x2, z2, 2.2, 1)) push(x2, z2, sp, s, { layer: 1, spacing: 2.2, lean: rnd() * 0.1 });
        }
        continue;
      }
      if (u < 0.15) {
        // open meadow: scattered specimen trees
        if (r < 0.05) {
          const q = rnd();
          let sp, s;
          if (q < 0.45) { sp = SP.rainTree; s = 13 + rnd() * 5; }
          else if (q < 0.75) { sp = SP.flowering; s = 9 + rnd() * 4; }
          else if (q < 0.87 && h < 12) { sp = SP.palm; s = 14 + rnd() * 6; }
          else { sp = SP.araucaria; s = 24 + rnd() * 10; }
          if (fits(x, z, sp, s, u) && clear(x, z, crownRadius(sp, s) * 0.8, 0)) push(x, z, sp, s, { spacing: crownRadius(sp, s) * 0.8 });
        }
        continue;
      }
      // the garden city: park trees on the lawns and in the block courtyards
      // (street trees are planted along the plan's streets below)
      for (let m = 0; m < 3; m++) {
        const ax = -half + (i + rnd()) * cell, az = -half + (j + rnd()) * cell;
        const wd = walkDist(ax, az, u);
        if (wd > 14 && rnd() < 0.016) {
          const q = rnd();
          const sp = q < 0.2 ? SP.banyan : q < 0.6 ? SP.rainTree : SP.flowering;
          const s = sp === SP.banyan ? 18 + rnd() * 5 : sp === SP.rainTree ? 12 + rnd() * 4 : 9 + rnd() * 3;
          if (fits(ax, az, sp, s, u) && clear(ax, az, crownRadius(sp, s) * 0.9, 0)) push(ax, az, sp, s, { spacing: crownRadius(sp, s) * 0.9 });
        }
      }
    }
  }

  // ------------------------------------------------ street trees --
  // Every street gets one species, planted at an even rhythm: palms down the avenue
  // medians, flowering trees or rain trees on the street verges, palms on the esplanades.
  if (plan) {
    for (const l of plan.lamps) occupy(l.x, l.z, 2.2, 6);
    // benches and the streetscape's own lamps share the verge with the trees
    const ss = world.streetscape || {};
    for (const l of ss.lamps || []) occupy(l.x, l.z, 2.2, 6);
    for (const b of ss.benches || []) occupy(b.x, b.z, 2.4, 6);
    const verge = [SP.flowering, SP.rainTree, SP.flowering, SP.araucaria];
    plan.streets.forEach((st, si) => {
      if (st.cls === 1) return;                          // lanes are too narrow
      const P = st.pts;
      const avenue = st.cls === 3, esplanade = st.cls === 4;
      const sp = avenue ? SP.palm : esplanade ? SP.palm : verge[si % verge.length];
      const spacing = avenue ? 12 : sp === SP.rainTree ? 17 : sp === SP.araucaria ? 15 : 13;
      const offs = avenue ? [0] : [-(st.hw + 2.7), st.hw + 2.7];
      const baseS = sp === SP.palm ? 12 : sp === SP.rainTree ? 9.5 : sp === SP.araucaria ? 16 : 8;
      let acc = spacing * 0.5;
      for (let i2 = 1; i2 < P.length; i2++) {
        const dx = P[i2][0] - P[i2 - 1][0], dz = P[i2][1] - P[i2 - 1][1];
        const L = Math.hypot(dx, dz);
        acc += L;
        while (acc >= spacing) {
          acc -= spacing;
          const t = 1 - acc / L;
          const x0 = P[i2 - 1][0] + dx * t, z0 = P[i2 - 1][1] + dz * t;
          const nx = -dz / L, nz = dx / L;
          for (const o of offs) {
            const x = x0 + nx * o, z = z0 + nz * o;
            const s = baseS * (0.92 + rnd() * 0.16);
            if (sampler.get(x, z) < 1.5) continue;
            if (plan.field.squareAt(x, z) > 0.05) continue;
            if (!avenue && plan.field.edge(x, z) < 2.0) continue;          // a cross street, not a verge
            const cr = crownRadius(sp, s);
            if (C && (C.groundAt(x, z) < Math.min(cr, 3.2) + 0.8 || C.overAt(x, z) < cr + 1.0)) continue;
            if (!clear(x, z, 2.5, 6)) continue;
            push(x, z, sp, s, { layer: 6, spacing: 2.5, lean: sp === SP.palm ? rnd() * 0.04 : 0, rot: rnd() * Math.PI * 2 });
          }
        }
      }
    });
  }

  // ------------------------------------------------ the Outer Wards --
  // street planting on every level of the ward platforms, the designed allees and rings,
  // groves in the parks, specimen trees on the garden lawns and shade trees along the quays
  // (their ground is built, not terrain: every tree is rooted at its level explicitly)
  const mp = world.metro && world.metro.plan;
  if (mp) {
    // built-fabric clearance (parapets, stairs, kerbs, bridges, landmarks) where measured;
    // a rejected tree still claims its spot, so every later choice is exactly as before
    const guard = wardTreeGuard(world);
    const fabricClear = (x, z, y, sp, s) => !guard || guard(x, y, z, Math.max(0.6, s * 0.035), crownRadius(sp, s), s);
    for (const l of mp.lamps) occupy(l.x, l.z, 2.2, 6);
    for (const S of world.metro.streetscapes || []) for (const b of S.benches || []) occupy(b.x, b.z, 2.4, 6);
    const towns = world.wardTowns;
    // clear of every ward building (trunk plus the lower crown)
    const bldgFree = (x, z, r) => wardTreePathClear(surf, x, z) && (!towns || towns.isFree(x, z, r));
    const surf = (x, z) => (mp.surfaceAt ? mp.surfaceAt(x, z) : 'lawn');
    const towerHit = (x, z, r) => (world.wardTowers || []).some((t) => Math.hypot(t.def.x - x, t.def.z - z) < (t.footprint || 60) + r + 4);
    const reserved = (x, z) => (mp.reservedAt ? mp.reservedAt(x, z) : 0);
    const levelOk = (x, z, y) => Math.abs(wardHeight(x, z) - y) < 0.1;
    const verge = [SP.rainTree, SP.flowering, SP.araucaria, SP.flowering];
    mp.streets.forEach((st, si) => {
      if (st.cls === 1) return;
      const P = st.pts;
      const y0 = st.y ?? WARD_TOP;
      const avenue = st.cls === 3, esplanade = st.cls === 4;
      const sp = avenue || esplanade ? SP.palm : verge[si % verge.length];
      const spacing = avenue ? 13 : sp === SP.rainTree ? 18 : sp === SP.araucaria ? 16 : 14;
      // ward avenues have no planted median (the carriageway is one paved deck): both verges
      const offs = [-(st.hw + 2.7), st.hw + 2.7];
      const baseS = sp === SP.palm ? 12 : sp === SP.rainTree ? 9.5 : sp === SP.araucaria ? 16 : 8;
      let acc = spacing * 0.5;
      for (let i2 = 1; i2 < P.length; i2++) {
        const dx = P[i2][0] - P[i2 - 1][0], dz = P[i2][1] - P[i2 - 1][1];
        const L = Math.hypot(dx, dz);
        if (L < 1e-6) continue;
        acc += L;
        while (acc >= spacing) {
          acc -= spacing;
          const t = 1 - acc / L;
          const x0 = P[i2 - 1][0] + dx * t, z0 = P[i2 - 1][1] + dz * t;
          const nx = -dz / L, nz = dx / L;
          for (const o of offs) {
            const x = x0 + nx * o, z = z0 + nz * o;
            if (!levelOk(x, z, y0)) continue;
            if (mp.field.squareAt(x, z) > 0.05) continue;
            if (mp.field.edge(x, z) < 2.0) continue;                       // a cross street, not a verge
            const sf = surf(x, z);
            if (!sf || sf === 'road' || sf === 'water') continue;
            if (reserved(x, z) === 2 || towerHit(x, z, 3)) continue;
            const s2 = baseS * (0.92 + rnd() * 0.16);
            if (!bldgFree(x, z, Math.min(crownRadius(sp, s2), 4) + 0.5)) continue;
            if (!clear(x, z, 2.5, 6)) continue;
            // draw the tree's randomness before the fabric test, so a rejected tree leaves
            // the planner's sequence (and every later district's trees) exactly as it was
            const lean = sp === SP.palm ? rnd() * 0.04 : 0, rot = rnd() * Math.PI * 2;
            if (!fabricClear(x, z, y0, sp, s2)) { occupy(x, z, 2.5, 6); continue; }
            push(x, z, sp, s2, { y: y0 - 0.15, layer: 6, spacing: 2.5, lean, rot });
          }
        }
      }
    });
    // designed rows and rings (the Circus of the Planets, the Mall's araucarias, ...)
    for (const t of mp.trees || []) {
      const sp = SP[t.sp] ?? SP.flowering;
      // t.root: a tree planted in a raised bed is rooted in the bed's soil, not the paving
      const y = t.root !== undefined ? t.root + 0.15 : wardHeight(t.x, t.z);
      if (!(y > 2)) continue;                              // rooted on the platform, never over water
      if (reserved(t.x, t.z) === 2 || surf(t.x, t.z) === 'water' || surf(t.x, t.z) === 'road') continue;
      if (!clear(t.x, t.z, 2.0, 6) || towerHit(t.x, t.z, 2) || !bldgFree(t.x, t.z, 1.5)) continue;
      const s2 = t.s * (0.94 + rnd() * 0.12), rot = rnd() * Math.PI * 2;
      if (!fabricClear(t.x, t.z, y, sp, s2)) { occupy(t.x, t.z, 2.2, 6); continue; }
      push(t.x, t.z, sp, s2, { y: y - 0.15, layer: 6, spacing: 2.2, rot });
    }
    // groves in the parks, each ward with its own trees
    const grove = {
      aurora: [SP.araucaria, SP.flowering, SP.rainTree], tidewater: [SP.rainTree, SP.flowering, SP.banyan], sunward: [SP.palm, SP.flowering, SP.palm],
      seraph: [SP.flowering, SP.palm, SP.flowering], southmarch: [SP.rainTree, SP.araucaria, SP.flowering], coral: [SP.palm, SP.treeFern, SP.banana, SP.palm], westmere: [SP.rainTree, SP.araucaria, SP.flowering],
    };
    for (const pk of mp.parks || []) {
      const prim = pk.prim;
      if (!prim) continue;
      const [x0, z0, x1, z1] = prim.bbox;
      const area = (x1 - x0) * (z1 - z0);
      const n = Math.floor(area * 0.0022 * (pk.trees ?? 1));
      const list = grove[pk.ward] || grove.tidewater;
      for (let k = 0; k < n; k++) {
        const lx = x0 + rnd() * (x1 - x0), lz = z0 + rnd() * (z1 - z0);
        if (prim.d(lx, lz) > -4) continue;
        const x = pk.ox + lx, z = pk.oz + lz;
        const s0 = surf(x, z);
        if (s0 !== 'lawn' && s0 !== 'bed' && s0 !== 'zone') continue;
        const sp = list[Math.floor(rnd() * list.length)];
        const s2 = sp === SP.palm ? 11 + rnd() * 5 : sp === SP.araucaria ? 14 + rnd() * 6 : sp === SP.banyan ? 15 + rnd() * 4 : sp === SP.treeFern ? 4 + rnd() * 3 : sp === SP.banana ? 3.5 + rnd() * 1.5 : 8 + rnd() * 5;
        const cr = crownRadius(sp, s2);
        if (reserved(x, z) === 2 || !bldgFree(x, z, Math.min(cr, 4) + 0.5)) continue;
        if (!clear(x, z, cr * 0.7, 7) || towerHit(x, z, cr)) continue;
        const y = wardHeight(x, z);
        if (!(y > 2)) continue;
        const lean = sp === SP.palm ? rnd() * 0.06 : 0, rot = rnd() * Math.PI * 2;
        if (!fabricClear(x, z, y, sp, s2)) { occupy(x, z, cr * 0.7, 7); continue; }
        push(x, z, sp, s2, { y: y - 0.15, layer: 7, spacing: cr * 0.7, lean, rot });
      }
    }
    // specimen trees on the lawns of the garden blocks, clear of every building
    for (const d of mp.districts || []) {
      const R = d.R * 1.05;
      const n = Math.floor(R * R * 0.0016);
      const list = grove[d.id] || grove.tidewater;
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R;
        const x = d.x + Math.cos(a) * r, z = d.z + Math.sin(a) * r;
        if (surf(x, z) !== 'lawn' || !wardTreePathClear(surf, x, z)) continue;
        if (mp.field.edge(x, z) < 6) continue;
        if (reserved(x, z)) continue;
        const sp = list[Math.floor(rnd() * list.length)];
        const s2 = sp === SP.palm ? 11 + rnd() * 4 : sp === SP.araucaria ? 13 + rnd() * 6 : sp === SP.treeFern ? 4 + rnd() * 3 : sp === SP.banana ? 3.5 + rnd() : 8 + rnd() * 5;
        const cr = crownRadius(sp, s2);
        if (towns && !towns.isFree(x, z, cr + 2)) continue;
        if (towerHit(x, z, cr) || !clear(x, z, cr * 0.8, 7)) continue;
        const y = wardHeight(x, z);
        if (!(y > 2)) continue;
        const rot = rnd() * Math.PI * 2;
        if (!fabricClear(x, z, y, sp, s2)) { occupy(x, z, cr * 0.8, 7); continue; }
        push(x, z, sp, s2, { y: y - 0.15, layer: 7, spacing: cr * 0.8, rot });
      }
    }
    // shade trees along the quays
    for (const qw of mp.quayWalks || []) {
      const P = qw.pts;
      let acc = 9;
      for (let i2 = 1; i2 < P.length; i2++) {
        acc += Math.hypot(P[i2][0] - P[i2 - 1][0], P[i2][1] - P[i2 - 1][1]);
        if (acc < 17) continue;
        acc = 0;
        const [x, z] = P[i2];
        if (Math.abs(wardHeight(x, z) - qw.y) > 0.1) continue;
        const sp = (qw.ward === 'coral' || qw.ward === 'sunward' || qw.ward === 'seraph') ? SP.palm : SP.flowering;
        const s2 = sp === SP.palm ? 11 + rnd() * 3 : 7.5 + rnd() * 2;
        if (!clear(x, z, 3.2, 6) || towerHit(x, z, 4) || !bldgFree(x, z, 3) || reserved(x, z) === 2) continue;
        const lean = sp === SP.palm ? rnd() * 0.05 : 0, rot = rnd() * Math.PI * 2;
        if (!fabricClear(x, z, qw.y, sp, s2)) { occupy(x, z, 3.2, 6); continue; }
        push(x, z, sp, s2, { y: qw.y - 0.15, layer: 6, spacing: 3.2, lean, rot });
      }
    }
  }

  // ------------------------------------------------ the Axis plaza --
  const avenueClear = (a, r, cr) => {
    const d = Math.abs(fract((a / (Math.PI * 2)) * 12 + 0.5) - 0.5) * r * (Math.PI * 2) / 12;
    return d > 9 + cr + 1.5;
  };
  const ring = (r, spacing, sp, sMin, sMax, y, bloom) => {
    const n = Math.floor((2 * Math.PI * r) / spacing);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const s = sMin + rnd() * (sMax - sMin);
      if (!avenueClear(a, r, Math.min(crownRadius(sp, s), 6))) continue;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // keep clear of the maglev terminals and the promenade decks landing on the plaza
      if (stations.some((st) => Math.hypot(st.x - x, st.z - z) < st.r + Math.min(crownRadius(sp, s), 5))) continue;
      if (C && C.overAt(x, z) < Math.min(crownRadius(sp, s), 5) && r > PLAZA_R - 10) continue;
      push(x, z, sp, s, { y, bloom, layer: 3, spacing: 1 });
    }
  };
  // garden rings on the plaza: royal palms in the inner ring, jacarandas in the outer
  ring(226, 13, SP.palm, 16, 18, PLAZA_Y - 0.2);
  ring(246, 13, SP.palm, 16, 18, PLAZA_Y - 0.2);
  ring(384, 17, SP.flowering, 9, 10.5, PLAZA_Y - 0.2, 0.3);
  ring(406, 17, SP.flowering, 9, 10.5, PLAZA_Y - 0.2, 0.3);
  // terraces stepping down from the plaza edge
  // (the lower terraces lie under the ring town's ground; the town plan plants those streets)
  const terr = [[PLAZA_R + 23, PLAZA_Y - 3.5, SP.flowering, 0.1]];
  for (const [r, y, sp, bloom] of terr) {
    const s = sp === SP.rainTree ? 11 : 8.5;
    ring(r, sp === SP.rainTree ? 24 : 16, sp, s, s + 2, y - 0.1, bloom);
  }

  // ------------------------------------------------ sky gardens --
  const skySp = [SP.flowering, SP.rainTree, SP.forestBroad, SP.treeFern, SP.palm];
  for (const t of world.towers || []) {
    const m = t.mesh; m.updateMatrixWorld();
    const spots = [...(t.discs || []), ...(t.plates || []).map((p) => ({ x: 0, y: p.y, z: 0, r: p.r, hole: (t.def.radius || 60) * 0.3 }))];
    for (const d of spots) {
      const n = Math.floor(d.r * d.r * 0.006) + 3;
      for (let k = 0; k < n; k++) {
        const sp = skySp[Math.floor(rnd() * skySp.length)];
        const s = sp === SP.treeFern ? 4 + rnd() * 2 : sp === SP.palm ? 9 + rnd() * 3 : 6 + rnd() * 4;
        const cr = crownRadius(sp, s);
        const maxR = d.r * 0.92 - cr;
        if (maxR < 1) continue;
        const rr = Math.sqrt(rnd()) * maxR, a = rnd() * Math.PI * 2;
        if (d.hole && rr < d.hole + cr) continue;
        const lx = d.x + Math.cos(a) * rr, lz = d.z + Math.sin(a) * rr;
        const lp = { x: lx, y: d.y, z: lz };
        const v = m.localToWorld(new THREE.Vector3(lp.x, lp.y, lp.z));
        if (!clear(v.x, v.z, cr * 0.7, 4)) continue;
        push(v.x, v.z, sp, s, { y: v.y - 0.2, layer: 4, spacing: cr * 0.7 });
      }
    }
  }
  // the Axis Garden Deck: a ring forest 1.27 km above the lagoon
  const deck = world.axis && world.axis.decks && world.axis.decks.find((d) => d.name === 'Garden Deck');
  if (deck) {
    const core = coreRadius(deck.y), lattice = latticeRadius(deck.y);
    const y = deck.y + deck.t * 0.25;
    const r0 = core + 14, r1 = lattice - 12;
    for (let k = 0; k < 520; k++) {
      const q = rnd();
      const sp = q < 0.35 ? SP.rainTree : q < 0.6 ? SP.flowering : q < 0.8 ? SP.forestBroad : q < 0.92 ? SP.treeFern : SP.banyan;
      const s = sp === SP.banyan ? 16 + rnd() * 3 : sp === SP.treeFern ? 4 + rnd() * 3 : sp === SP.rainTree ? 10 + rnd() * 3 : 8 + rnd() * 5;
      const cr = crownRadius(sp, s);
      const rr = r0 + cr + rnd() * Math.max(0, r1 - r0 - 2 * cr), a = rnd() * Math.PI * 2;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (!clear(x, z, cr * 0.75, 5)) continue;
      push(x, z, sp, s, { y: y - 0.2, layer: 5, spacing: cr * 0.75 });
    }
  }
  return trees;
}
