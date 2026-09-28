import * as THREE from 'three';
import { latheFacade, sweepTube } from '../geom.js';
import { renderedHeight } from '../outerCities.js';
import { islandPrism, footprintGround } from '../islandPlan.js';
import { TAU } from './kit.js';

// Austral: the southern arcology city under one great spire.
//
// Round the spire's garden podium stand five Petals, one opposite each of its five lobes:
// terraced arcologies on an arc of the ring between the five avenues, each rising in six tiers
// from its outer rim to a 100 m crest that faces the spire. Every tier's roof is a planted
// terrace and every riser is glass, so the city climbs toward the spire as a green, inhabited
// hill; a sky bridge runs from each crest into the spire's flank at the crest's height. Beyond
// the Petals a ring of fourteen tower-gardens stands at 720 m, carrying the Sky Ring, a glazed
// promenade tube 50 m above the city that joins them in one circuit round the spire.
// Everything is seated on the drawn ground: each Petal slice is founded below the lowest ground
// under it and levelled on its highest; the towers on their own footing; the ring on the towers.

const TIER = 17, TIERS = 6;

/** The spire's radius at height y above its base g (the lofted section in buildAustral). */
export function spireRadiusAt(g, y, H = 1400, R = 110) {
  const v = Math.max(0, Math.min(1, (y - (g - 4)) / (H * 0.93)));
  let s = (1 + 0.5 * Math.exp(-v * 12)) * (1 - 0.55 * Math.pow(v, 1.5));
  if (v > 0.88) s *= Math.pow(1 - (v - 0.88) / 0.12, 0.5) * 0.9 + 0.1;
  return (R * s * 0.8) / 1.2;          // the inner (waisted) radius of the five-lobed section
}

export function australArcology(parts, c, rnd, lights, placed, S, g, tower) {
  const out = { petals: [], bridges: [], towers: [], ring: null };
  const isFree = (x, z, r) => !c.plan || c.plan.isRoadFree(x, z, r);
  // ---- the five Petals
  const r0 = 330, r1 = 525, half = (23 * Math.PI) / 180, SL = 9;
  for (let k = 0; k < 5; k++) {
    const mid = k * TAU / 5 + c.toward + TAU / 10;
    const petal = { mid, slices: [] };
    for (let j = 0; j < SL; j++) {
      const a0 = mid - half + (2 * half * j) / SL, a1 = a0 + (2 * half) / SL * 0.985;
      const P = (a, r) => [S[0] + Math.cos(a) * r, S[1] + Math.sin(a) * r];
      const foot = [P(a0, r0), P(a1, r0), P(a1, r1), P(a0, r1)];
      const cx = (foot[0][0] + foot[2][0]) / 2, cz = (foot[0][1] + foot[2][1]) / 2;
      // a slice the island's roads pass through stays open: a canyon street through the Petal
      if (!isFree(cx, cz, Math.hypot(foot[2][0] - foot[0][0], foot[2][1] - foot[0][1]) / 2 + 4)) continue;
      const ground = footprintGround(foot, 10);
      if (ground.min < 2) continue;
      const base = ground.max + 0.5;
      for (let t = 0; t < TIERS; t++) {
        const ro = r1 - (t * (r1 - r0 - 40)) / (TIERS - 1);
        const q = [P(a0, r0), P(a1, r0), P(a1, ro), P(a0, ro)];
        const y0 = t === 0 ? ground.min - 2.5 : base + t * TIER - 0.4, y1 = base + (t + 1) * TIER;
        const g0 = islandPrism(q, y0, y1, t === 0 ? 5 : 0, 3);
        parts.push(g0);
        // a stone band at every terrace edge (the parapet line)
        const qe = [P(a0, ro - 1.4), P(a1, ro - 1.4), P(a1, ro + 0.3), P(a0, ro + 0.3)];
        parts.push(islandPrism(qe, y1 - 0.2, y1 + 1.1, 1, 1));
      }
      petal.slices.push({ a0, a1, base, ground, foot });
      placed.push({ x: cx, z: cz, r: Math.hypot(foot[2][0] - foot[0][0], foot[2][1] - foot[0][1]) / 2 + 6 });
    }
    // the crest's sky bridge into the spire, from the middle slice
    const mids = petal.slices.filter((s) => Math.abs((s.a0 + s.a1) / 2 - mid) < half * 0.5);
    if (mids.length) {
      const top = Math.min(...mids.map((s) => s.base)) + TIERS * TIER - 6;
      const rs = spireRadiusAt(g, top) - 6;
      const A = new THREE.Vector3(S[0] + Math.cos(mid) * (r0 + 6), top, S[1] + Math.sin(mid) * (r0 + 6));
      const B = new THREE.Vector3(S[0] + Math.cos(mid) * rs, top, S[1] + Math.sin(mid) * rs);
      const pts = []; for (let i = 0; i <= 24; i++) { const p = A.clone().lerp(B, i / 24); p.y += 6 * Math.sin(Math.PI * i / 24); pts.push(p); }
      parts.push(sweepTube(pts, () => 4.2, 12, { kind: 0 }));
      parts.push(sweepTube(pts.map((p) => p.clone().add(new THREE.Vector3(0, -4.6, 0))), () => 0.9, 6, { kind: 10 }));
      out.bridges.push({ from: [A.x, A.y, A.z], to: [B.x, B.y, B.z] });
      lights.push({ x: (A.x + B.x) / 2, y: top + 6, z: (A.z + B.z) / 2, c: c.light, s: 1.8 });
    }
    out.petals.push(petal);
  }
  // ---- the ring of tower-gardens and the Sky Ring
  const RR = 720, N = 14, ringTowers = [];
  for (let k = 0; k < N; k++) {
    const a = c.toward + (k + 0.5) * TAU / N, x = S[0] + Math.cos(a) * RR, z = S[1] + Math.sin(a) * RR;
    const Rt = 22;
    let lo = Infinity; for (let q = 0; q < 12; q++) lo = Math.min(lo, renderedHeight(x + Math.cos(q * TAU / 12) * Rt * 1.3, z + Math.sin(q * TAU / 12) * Rt * 1.3));
    if (lo < 3 || !isFree(x, z, Rt * 1.3)) continue;
    ringTowers.push({ a, x, z, lo, Rt });
  }
  const ringY = Math.max(...ringTowers.map((t) => t.lo)) + 52;
  for (const t of ringTowers) {
    const H = ringY - t.lo + 90 + ((t.a * 97) % 1) * 80;
    parts.push(tower(rnd, t.x, t.lo - 4, t.z, H, t.Rt, 0.3 + ((t.a * 13) % 1) * 0.2));
    placed.push({ x: t.x, z: t.z, r: t.Rt * 1.3 });
    out.towers.push({ x: t.x, z: t.z, lo: t.lo, H });
  }
  if (ringTowers.length >= 10) {
    const pts = []; for (let i = 0; i <= 168; i++) { const a = c.toward + (i / 168) * TAU; pts.push(new THREE.Vector3(S[0] + Math.cos(a) * RR, ringY, S[1] + Math.sin(a) * RR)); }
    pts[pts.length - 1].copy(pts[0]);
    parts.push(sweepTube(pts, () => 5.2, 14, { kind: 0 }));
    parts.push(sweepTube(pts.map((p) => p.clone().add(new THREE.Vector3(0, -5.8, 0))), () => 1.2, 6, { kind: 10 }));
    parts.push(sweepTube(pts.map((p) => p.clone().add(new THREE.Vector3(0, 5.6, 0))), () => 0.7, 6, { kind: 2 }));
    out.ring = { R: RR, y: ringY };
    for (const t of ringTowers) lights.push({ x: t.x, y: ringY + 8, z: t.z, c: c.light, s: 1.6 });
  }
  return out;
}
