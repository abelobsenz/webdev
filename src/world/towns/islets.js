import { KIND as K } from '../buildings.js';
import { ST, HALF_W } from '../urban.js';
import { LANDMARKS } from './landmarks.js';
import { rectPlinth, roundPlinth, jettyWork } from './kit.js';

// The islet villages. Each islet was laid out the same way: a ring street round a paved square
// 50-80 m across, four lanes out to the shore, houses on the frontages. Now each is a place of
// its own: the square is a village place at the crossing of the lanes (its obelisk, benches and
// lamps round it), the rest of the disc inside the ring a green quartered by the lanes, and on
// the green each islet's own public building - a chapel, a lighthouse, an observatory, a
// tempietto, a glasshouse, a school, a market hall, a lido, a reading room, an amphitheatre, a
// cloister, a town hall - set back from the place and facing it. Avenues of trees line the
// lanes across the green, a ring of them the place, benches face the lanes; at the end of the
// lane that reaches deep water soonest, a timber jetty with boats moored at its head.

const TAU = Math.PI * 2;
const PROGRAM = {
  islet0: ['chapel', 'flowering'], islet3: ['lighthouse', 'palm'], islet4: ['observatory', 'araucaria'], islet5: ['tempietto', 'flowering'],
  islet6: ['glasshouse', 'palm'], islet8: ['school', 'rainTree'], islet9: ['marketHall', 'flowering'], islet11: ['lido', 'palm'],
  islet13: ['library', 'araucaria'], islet14: ['amphitheatre', 'rainTree'], islet17: ['cloister', 'flowering'], islet19: ['townHall', 'araucaria'],
  islet20: ['chapel', 'rainTree'],
};
const TREE_S = { flowering: 7.4, palm: 11, araucaria: 13, rainTree: 8.5 };
const CROWN = { flowering: 1.35, palm: 0.6, araucaria: 0.38, rainTree: 1.55 };

/** Where each lane of a village runs: its pieces with their outward direction. */
function lanesOf(plan, d) {
  return plan.streets.filter((st) => st.district === d.id && st.cls === ST.LANE).map((st) => {
    const a = st.pts[0], b = st.pts[st.pts.length - 1];
    const out = Math.hypot(b[0] - d.x, b[1] - d.z) > Math.hypot(a[0] - d.x, a[1] - d.z);
    const P = out ? st.pts : [...st.pts].reverse();
    return { st, P, ang: Math.atan2(P[P.length - 1][1] - d.z, P[P.length - 1][0] - d.x) };
  });
}

export function planIslets(S, out) {
  const plan = S.plan;
  const stats = { villages: 0, landmarks: 0, trees: 0, benches: 0, jetties: 0, lamps: 0 };
  for (const d of plan.districts) {
    if (d.kind !== 'islet' || !PROGRAM[d.id]) continue;
    const q = plan.squares.find((s) => s.kind === 'village' && s.district === d.id);
    if (!q) continue;
    const [design, sp] = PROGRAM[d.id];
    const ring = plan.streets.find((st) => st.district === d.id && st.cls === ST.STREET);
    const ringR = ring ? ring.pts.reduce((a, p) => a + Math.hypot(p[0] - d.x, p[1] - d.z), 0) / ring.pts.length : q.r + 6.5;
    const lanes = lanesOf(plan, d);
    // ---- the village place: the crossing of the lanes, paved; its old ring of lamps goes
    const r0 = q.r, rp = Math.min(r0, Math.max(19, d.R * 0.12 + 5));
    S.removeLamps((l) => l.cls === 0 && Math.abs(Math.hypot(l.x - q.x, l.z - q.z) - (r0 - 2.5)) < 1.2);
    q.r = rp; q.r0 = r0;
    stats.villages++;
    // new lamps round the place, just inside its edge, clear of the lanes' carriageways
    {
      const rl = rp - 2.5, n = Math.max(6, Math.floor((TAU * rl) / 18));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + 0.2, x = q.x + Math.cos(a) * rl, z = q.z + Math.sin(a) * rl;
        if (S.edgeMin(x, z, 0.5) < 0.6 || S.lampNear(x, z, 4) || S.ground(x, z) < 1.8) continue;
        S.addLamp({ x, z, yaw: a + Math.PI, cls: 0 }); stats.lamps++;
      }
    }
    // lamps along the lanes across the green (they had none inside the old square)
    for (const { P, st } of lanes) {
      let acc = 12, k = 0;
      for (let i = 1; i < P.length; i++) {
        const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1], L = Math.hypot(dx, dz);
        acc += L;
        while (acc >= 28) {
          acc -= 28;
          const t = 1 - acc / L, px = P[i - 1][0] + dx * t, pz = P[i - 1][1] + dz * t;
          const rr = Math.hypot(px - q.x, pz - q.z);
          if (rr < rp + 3 || rr > r0 + 2) continue;
          const side = (k++ & 1) ? 1 : -1, nx = (-dz / L) * side, nz = (dx / L) * side;
          const x = px + nx * (st.hw + 0.95), z = pz + nz * (st.hw + 0.95);
          if (S.edgeMin(x, z, 0.3) < 0.6 || S.lampNear(x, z, 6) || S.inLot(x, z, 0.8) || S.squaresAt(x, z, 1).length) continue;
          S.addLamp({ x, z, yaw: Math.atan2(-nx, -nz), cls: ST.LANE }); stats.lamps++;
        }
      }
    }
    // ---- the landmark on the green: the quarter between two lanes with the most room, set
    // back from the place on its bisector, facing it
    const angs = lanes.map((l) => l.ang).sort((a, b) => a - b);
    const quarters = [];
    for (let i = 0; i < angs.length; i++) { const a0 = angs[i], a1 = angs[(i + 1) % angs.length] + (i === angs.length - 1 ? TAU : 0); quarters.push([a0, a1]); }
    if (!quarters.length) quarters.push([0, TAU]);
    const inner = ringR - HALF_W[ST.STREET] - 2.5;
    let site = null;
    for (const scale of [1.35, 1.2, 1.05, 0.92, 0.8, 0.68]) {
      const spec = LANDMARKS[design](scale);
      const R = spec.r !== undefined ? spec.r + 1.5 : Math.hypot(spec.hx, spec.hz + (spec.stepW ? 3.4 : 0));
      for (const [a0, a1] of quarters) {
        for (const da of [0.5, 0.42, 0.58, 0.34, 0.66]) {
          const a = a0 + (a1 - a0) * da;
          for (let rr = rp + R + 3; rr <= inner - R; rr += 2) {
            const x = q.x + Math.cos(a) * rr, z = q.z + Math.sin(a) * rr;
            const ok = siteOk(S, x, z, R);
            if (!ok) continue;
            const score = R * 4 - Math.abs(rr - (rp + inner) / 2) * 0.2 - Math.abs(da - 0.5) * 6 + (ok.lo > 2.6 ? 2 : 0);
            if (!site || score > site.score) site = { x, z, R, spec, score, g: ok };
            break;
          }
        }
      }
      if (site) break;
    }
    if (site) {
      const yaw = Math.atan2(q.x - site.x, q.z - site.z);
      out.works.push(placeLandmark(S, site.x, site.z, yaw, site.spec, d.id, design));
      S.claim(site.x, site.z, site.R + 1.5, 'landmark');
      out.sites.push({ x: site.x, z: site.z, r: site.R, color: [255, 140, 0] });
      stats.landmarks++;
    }
    // ---- avenues of trees along the lanes across the green, a ring round the place
    const s = TREE_S[sp], cr = CROWN[sp] * s * 0.5;
    const plant = (x, z) => {
      if (!S.free(x, z, Math.max(cr, 1.4))) return false;
      if (S.edgeMin(x, z, 0.6) < 1.2 || S.squaresAt(x, z, cr + 1).length || S.discInLot(x, z, cr, 0.6)) return false;
      if (S.lampNear(x, z, Math.max(2.2, cr + 0.6)) || !S.towerClear(x, z, cr, 2) || !S.stationClear(x, z, cr, 2)) return false;
      const g = S.groundRange(x, z, 0.8);
      if (g.lo < 1.8 || S.headroom(x, z, cr) < s + 2) return false;
      out.trees.push({ x, z, y: g.lo - 0.15, sp, s: s * (0.92 + hash(x, z) * 0.16) });
      S.claim(x, z, Math.max(cr * 0.9, 1.6), 'tree');
      stats.trees++;
      return true;
    };
    for (const { P, st } of lanes) {
      for (const side of [-1, 1]) {
        let acc = 5, i = 1;
        for (; i < P.length; i++) {
          const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1], L = Math.hypot(dx, dz);
          acc += L;
          while (acc >= 9) {
            acc -= 9;
            const t = 1 - acc / L, px = P[i - 1][0] + dx * t, pz = P[i - 1][1] + dz * t, rr = Math.hypot(px - q.x, pz - q.z);
            if (rr < rp + 4 || rr > inner) continue;
            const nx = (-dz / L) * side, nz = (dx / L) * side, o = st.hw + 2.6;
            plant(px + nx * o, pz + nz * o);
          }
        }
      }
    }
    {
      const rt = rp + 4.2, n = Math.floor((TAU * rt) / 8.5);
      for (let k = 0; k < n; k++) { const a = (k / n) * TAU; plant(q.x + Math.cos(a) * rt, q.z + Math.sin(a) * rt); }
    }
    // benches on the green facing the lanes, between the avenue trees
    for (const { P, st } of lanes) {
      for (const side of [-1, 1]) {
        let acc = 0;
        for (let i = 1; i < P.length; i++) {
          const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1], L = Math.hypot(dx, dz);
          acc += L;
          while (acc >= 18) {
            acc -= 18;
            const t = 1 - acc / L, px = P[i - 1][0] + dx * t, pz = P[i - 1][1] + dz * t, rr = Math.hypot(px - q.x, pz - q.z);
            if (rr < rp + 6 || rr > inner - 2) continue;
            const nx = (-dz / L) * side, nz = (dx / L) * side, o = st.hw + 1.35;
            const x = px + nx * o, z = pz + nz * o, yaw = Math.atan2(-nx, -nz);
            if (!S.free(x, z, 1.2) || S.edgeMin(x, z, 0.9) < 0.2 || S.lampNear(x, z, 1.8) || S.discInLot(x, z, 1.1, 0.4)) continue;
            const g = S.groundRect(x, z, yaw, 0.96, -0.37, 0.28);
            if (g.lo < 1.8 || g.hi - g.lo > 0.2) continue;
            out.furniture.push({ kind: 'bench', x, z, y: g.lo - 0.02, yaw, r: 1.05 });
            S.claim(x, z, 1.15, 'bench');
            stats.benches++;
          }
        }
      }
    }
    // ---- the jetty: off the end of the lane that reaches deep water soonest
    let best = null;
    for (const { P } of lanes) {
      const e = P[P.length - 1], f = P[Math.max(0, P.length - 3)];
      let ux = e[0] - f[0], uz = e[1] - f[1]; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      // over the strand from the lane's paved end to where the beach falls to the jetty's level
      let t0 = 1.5;
      while (t0 < 30 && S.ground(e[0] + ux * t0, e[1] + uz * t0) > 1.9) t0 += 1;
      if (t0 >= 30) continue;
      const x0 = e[0] + ux * t0, z0 = e[1] + uz * t0;
      let deep = 0;
      for (let t = 4; t < 110; t += 2) if (S.ground(x0 + ux * t, z0 + uz * t) < -1.6) { deep = t + 6; break; }
      if (!deep) continue;
      if (!best || deep < best.len) best = { x0, z0, ux, uz, len: deep };
    }
    if (best) {
      const { x0, z0, ux, uz, len } = best;
      const deckY = Math.max(S.ground(x0, z0) + 0.12, 1.5);
      // clear of the lots, lamps, streets and anything placed along its length
      let ok = true;
      for (let t = 0; t <= len + 3; t += 2) {
        const x = x0 + ux * t, z = z0 + uz * t, w = t > len - 1 ? 7 : 2.2;
        if (S.inLot(x, z, w) || S.lampNear(x, z, w + 0.5) || (t > 3 && S.edgeMin(x, z, w) < 0.5) || !S.free(x, z, w)) { ok = false; break; }
        if (t > 2 && S.groundRange(x, z, w).hi > deckY - 0.45) { ok = false; break; }
      }
      if (ok) {
        out.works.push({ district: d.id, x: x0 + ux * len * 0.5, z: z0 + uz * len * 0.5, r: len * 0.5 + 8, kind: 'jetty', shore: true, deckY,
          samples: sampleLine(x0, z0, ux, uz, len, 2.2, 7.5), build: jettyWork(x0, z0, ux, uz, len, deckY, S.ground, { boats: 2 }) });
        for (let t = 0; t <= len + 3; t += 4) S.claim(x0 + ux * t, z0 + uz * t, t > len - 1 ? 7 : 2.2, 'jetty');
        stats.jetties++;
      }
    }
  }
  return stats;
}

function sampleLine(x0, z0, ux, uz, len, w, wHead) {
  const s = [];
  // (the root, where it meets the lane's paved end, is left out)
  for (let t = 4; t <= len + 3; t += 2) s.push([x0 + ux * t, z0 + uz * t, t > len - 1 ? wHead : w]);
  return s;
}

const hash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };

/** A site for a building of circumradius R: dry, not too steep, clear of everything. */
export function siteOk(S, x, z, R) {
  if (!S.free(x, z, R + 1)) return false;
  if (S.edgeMin(x, z, R) < 1.5) return false;
  if (S.squaresAt(x, z, R + 1.5).length || S.discInLot(x, z, R, 1.2)) return false;
  if (S.lampNear(x, z, R + 1.2) || !S.towerClear(x, z, R, 6) || !S.stationClear(x, z, R, 4)) return false;
  const g = S.groundRange(x, z, R);
  if (g.lo < 2.0 || g.hi - g.lo > 1.3) return false;
  if (S.headroom(x, z, R) < 30) return false;
  return g;
}

/**
 * The work that draws a landmark: its plinth set on the highest ground of the footprint and
 * reaching a metre below the lowest, a flight of steps on its front where the ground falls there.
 */
export function placeLandmark(S, x, z, yaw, spec, district, kind) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const toW = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  let lo = Infinity, hi = -Infinity;
  const round = spec.r !== undefined;
  const ex = round ? spec.r : spec.hx, ez = round ? spec.r : spec.hz;
  for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
    const lx = (i / 6) * ex, lz = (j / 6) * ez;
    if (round && Math.hypot(lx, lz) > spec.r) continue;
    const g = S.ground(...toW(lx, lz));
    lo = Math.min(lo, g); hi = Math.max(hi, g);
  }
  const top = hi + 0.4, foot = lo - top - 1.0;
  // the ground just in front of the plinth (for the steps)
  let front = Infinity;
  if (!round && spec.stepW) for (const f of [-0.5, 0, 0.5]) front = Math.min(front, S.ground(...toW(f * spec.stepW, spec.hz + 0.4)));
  const drop = Number.isFinite(front) ? top - front : 0;
  const R = round ? spec.r + 1.5 : Math.hypot(spec.hx, spec.hz + (spec.stepW ? 3.4 : 0));
  return {
    district, x, z, r: R, kind: `landmark:${kind}`, top: top + spec.height,
    build(B, lod) {
      B.frame(x, top, z, yaw);
      if (round) roundPlinth(B, spec.r, foot, Math.max(1, Math.min(3, Math.round((top - lo) / 0.3))), 0.3, 0.5, lod ? 16 : 40);
      else rectPlinth(B, spec.hx, spec.hz, foot, drop, spec.stepW);
      B.frame(x, top, z, yaw);
      spec.build(B, lod);
    },
  };
}

export { K };
