import { K, H, rect, circlePoly, groundRange, lerp2, centroid } from './cityKit.js';
import { lighthouse } from './civic.js';

// The harbour of an island city, built to the coast as it is drawn:
//   quay     a deck at the arrival datum (3.75 m, where the station footbridge lands) along the
//            shore either side of the landing, its sea wall on a line fitted to the coast a
//            little beyond the shallows, its back edge where the land rises to meet it
//   moles    two breakwaters from the quay's ends curving out to a mouth on the footbridge's
//            line (the footbridge passes through it), a round head and a lighthouse on each
//   bollards, lamps and a coping along the quay edge (near detail)
// Returns the quay geometry for the city to build its harbour front behind.

export const QUAY_Y = 3.75;

/** Shore points (H = 0.5) and the -depth line along the coast near the landing A0. */
function coastLine(A0, a, b, span, depth) {
  const P = (u, v) => [A0[0] + a[0] * u + b[0] * v, A0[1] + a[1] * u + b[1] * v];
  const pts = [];
  for (let v = -span; v <= span; v += 20) {
    let u = -700; while (u < 700 && H(...P(u, v)) < 0.5) u += 2;
    if (u >= 700) continue;
    let w = u; while (w > -900 && H(...P(w, v)) > -depth) w -= 2;
    pts.push({ v, u, w });
  }
  return { pts, P };
}

/**
 * opts: { A0 (landing, arrival square centre), a (unit inland along the footbridge line),
 *   span (half length of the quay along the coast), mouth (distance of the mole mouth from A0),
 *   width (quay depth), moleW, lightH, occ, place }
 */
export function buildHarbour(kit, opts) {
  const { A0, a, span = 360, mouth = 320, width = 46, moleW = 16, lightH = 38, place, mouthHalf = 44, heads = true } = opts;
  // the quay may reach further along the coast one way than the other (s in [-sNeg, sPos])
  const sNeg = opts.sNeg ?? span, sPos = opts.sPos ?? span, fitNeg = opts.fitNeg ?? sNeg, fitPos = opts.fitPos ?? sPos;
  const b = [-a[1], a[0]];
  const { pts, P } = coastLine(A0, a, b, Math.max(sNeg, sPos) + 200, 2.6);
  // fit the coast: u = c0 + c1 v through the shore points within the span
  const near = pts.filter((p) => p.v >= -fitNeg - 40 && p.v <= fitPos + 40);
  const n = near.length, sv = near.reduce((s, p) => s + p.v, 0), su = near.reduce((s, p) => s + p.u, 0), svv = near.reduce((s, p) => s + p.v * p.v, 0), suv = near.reduce((s, p) => s + p.u * p.v, 0);
  const c1 = (n * suv - sv * su) / (n * svv - sv * sv || 1), c0 = (su - c1 * sv) / n;
  // the coast frame: e along the coast (toward +v), s seaward (toward -u); the quay's sea wall
  // runs parallel to it through the seaward-most of the shallows' line near the landing
  const eu = c1, ev = 1, el = Math.hypot(eu, ev);
  const E = [(a[0] * eu + b[0] * ev) / el, (a[1] * eu + b[1] * ev) / el];
  let Sd = [E[1], -E[0]];
  if (Sd[0] * a[0] + Sd[1] * a[1] > 0) Sd = [-Sd[0], -Sd[1]];                      // seaward = against a
  const shoreAt = (t) => P(c0 + c1 * t, t);
  // quay front: the -2.6 m line offset, smoothed to a straight wall at its mean distance
  const offs = near.map((p) => { const s = P(p.u, p.v), w = P(p.w, p.v); return (w[0] - s[0]) * Sd[0] + (w[1] - s[1]) * Sd[1]; });
  const frontOff = Math.max(18, Math.min(70, offs.slice().sort((x, y) => x - y)[Math.floor(offs.length * 0.5)]));
  const O = shoreAt(0);                    // where the fitted coast crosses the axis
  const Q = (s, t) => [O[0] + E[0] * s + Sd[0] * t, O[1] + E[1] * s + Sd[1] * t];   // s along the coast, t seaward of the shore
  const sLand = (A0[0] - O[0]) * E[0] + (A0[1] - O[1]) * E[1];
  // the deck: sections every 12 m; its back edge where the land comes up to the deck (the
  // deck is level at the arrival datum, so it stops short of any ground above it)
  const yq = QUAY_Y;
  // the city's gate plaza opens the quay on the axis: the deck is two ribbons either side of
  // it, ending on straight sections the plaza abuts
  const proj = (p) => (p[0] - O[0]) * E[0] + (p[1] - O[1]) * E[1];
  const sc = proj(P(opts.gapU ?? 60, 0)), gh = opts.gapHalf ?? 0;
  const sA = sc - gh, sB = sc + gh;
  const sList = [];
  for (let s = -sNeg; s < sA - 3; s += 12) sList.push(s);
  if (gh > 0) sList.push(sA, null, sB); else sList.push(sA);
  for (let s = Math.ceil((sB + 3) / 12) * 12; s <= sPos + 0.01; s += 12) sList.push(s);
  const parts = [[]];
  for (const s of sList) { if (s === null) { parts.push([]); continue; } const f = Q(s, frontOff); let back = null; for (let t = frontOff - 4; t > -width * 2; t -= 2) { if (H(...Q(s, t)) > yq - 0.45) { back = t + 2; break; } } parts.at(-1).push({ s, t: Math.max(back ?? -width, frontOff - width), l: f }); }
  const allSecs = [];
  for (const secs of parts) {
    // the back line never runs over ground above the deck: pull it seaward where needed
    for (let pass = 0; pass < 12; pass++) {
      let moved = false;
      for (let k = 0; k < secs.length - 1; k++) {
        const q = [secs[k].l, secs[k + 1].l, Q(secs[k + 1].s, secs[k + 1].t), Q(secs[k].s, secs[k].t)];
        if (groundRange(q, 3).max > yq - 0.3) { secs[k].t += 3; secs[k + 1].t += 3; moved = true; }
      }
      if (!moved) break;
    }
    for (const s of secs) s.r = Q(s.s, Math.min(s.t, frontOff - 8));
    for (let k = 0; k < secs.length; k++) {
      const q0 = secs[Math.max(0, k - 1)], q1 = secs[Math.min(secs.length - 1, k + 1)];
      secs[k].y = yq; secs[k].yb = groundRange([q0.l, q1.l, q1.r, q0.r], 4).min - 1.5;
    }
    if (secs.length < 2) continue;
    const mid = secs[Math.floor(secs.length / 2)];
    kit.at(...lerp2(mid.l, mid.r, 0.5), 3).ribbon(secs.map((s) => ({ l: s.l, r: s.r, y: s.y, yb: s.yb })), { meta: { role: 'quay' } });
    for (let k = 0; k < secs.length - 1; k++) place?.([secs[k].l, secs[k + 1].l, secs[k + 1].r, secs[k].r], 'quay');
    allSecs.push(secs);
  }
  const secs = allSecs.flat();
  const gap = gh > 0 ? { A: allSecs[0].at(-1), B: allSecs[1]?.[0] } : null;
  // coping, bollards and lamps along the sea wall (none across the apron and the gap)
  for (const run of allSecs) for (let k = 0; k < run.length - 1; k++) {
    const A = run[k].l, B = run[k + 1].l;
    if (Math.abs((run[k].s + run[k + 1].s) / 2 - proj(A0)) < 44) continue;
    const secsK = run;
    const inA = lerp2(A, run[k].r, 0.9 / Math.hypot(run[k].r[0] - A[0], run[k].r[1] - A[1])), inB = lerp2(B, run[k + 1].r, 0.9 / Math.hypot(run[k + 1].r[0] - B[0], run[k + 1].r[1] - B[1]));
    kit.at(...lerp2(A, B, 0.5), 1).prism([A, B, inB, inA], yq - 0.02, yq + 0.28, { wall: K.STONE, top: K.STONE, meta: { role: 'quay coping', supported: true } });
    if (k % 2 === 0) {
      const p = lerp2(lerp2(A, B, 0.5), lerp2(run[k].r, run[k + 1].r, 0.5), 2.2 / Math.hypot(run[k].r[0] - A[0], run[k].r[1] - A[1]));
      kit.at(p[0], p[1], 0).lathe(p[0], p[1], [[0.32, yq - 0.05, K.METAL], [0.32, yq + 0.5, K.METAL], [0.42, yq + 0.62, K.METAL], [0, yq + 0.72, K.METAL]], 8, { meta: { role: 'bollard', supported: true } });
    }
    if (k % 3 === 1) { const p = lerp2(lerp2(A, B, 0.5), lerp2(run[k].r, run[k + 1].r, 0.5), 0.45); kit.at(p[0], p[1], 0).lamp(p[0], p[1], yq - 0.05, 6.5); }
  }
  // the arrival apron: from the sea wall out along the footbridge line past its landing, level
  // with the deck (its landward edge is the sea wall line, so the two meet face to face)
  const apronOut = opts.apronOut ?? 30;
  {
    const halfW = 38, tA = (s) => { const p = Q(s, frontOff); return p; };
    // apron corners: on the wall at s0, s1, and out along -a to the far line u = -apronOut
    const sAx = sLand;
    const w0 = tA(sAx - halfW), w1 = tA(sAx + halfW);
    const out = (p) => { const u = (p[0] - A0[0]) * a[0] + (p[1] - A0[1]) * a[1]; const d = u + apronOut; return [p[0] - a[0] * d, p[1] - a[1] * d]; };
    const q = [w0, w1, out(w1), out(w0)];
    const reach = (q[2][0] - w1[0]) * -a[0] + (q[2][1] - w1[1]) * -a[1];
    if (reach > 4) {
      const g = groundRange(q, 3);
      kit.at(...centroid(q), 3).prism(q, g.min - 1.5, yq, { top: K.PAVING, meta: { role: 'arrival apron' } });
      place?.(q, 'quay');
    }
  }
  // moles from the quay ends to the mouth on the footbridge line
  const M = [A0[0] - a[0] * mouth, A0[1] - a[1] * mouth];
  const moles = [];
  for (const sg of [-1, 1]) {
    const hw0 = moleW / 2 + 1.5;
    const root = Q(sg < 0 ? -(sNeg - hw0 - 4) : sPos - hw0 - 4, frontOff);
    if (opts.moles && !opts.moles.includes(sg)) continue;
    const tip = [M[0] + b[0] * sg * mouthHalf, M[1] + b[1] * sg * mouthHalf];
    // the root must lie on the same side of the axis as the tip
    const side = (root[0] - A0[0]) * b[0] + (root[1] - A0[1]) * b[1];
    if (Math.sign(side) !== sg) continue;
    const ctrl = [root[0] + Sd[0] * mouth * 0.75, root[1] + Sd[1] * mouth * 0.75];
    // a straight first stretch square to the wall, so the mole's end face lies on the wall
    const path = [root];
    const r1 = [root[0] + Sd[0] * 8, root[1] + Sd[1] * 8];
    for (let k = 0; k <= 28; k++) { const t = k / 28; path.push([(1 - t) ** 2 * r1[0] + 2 * (1 - t) * t * ctrl[0] + t * t * tip[0], (1 - t) ** 2 * r1[1] + 2 * (1 - t) * t * ctrl[1] + t * t * tip[1]]); }
    // (the mole leaves the sea wall square to it, so its end face lies on the wall)
    let bed = Infinity;
    for (let k = 0; k < path.length - 1; k++) { const L = Math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]); bed = Math.min(bed, groundRange(rect(...lerp2(path[k], path[k + 1], 0.5), L + 1, moleW + 6, Math.atan2(path[k + 1][1] - path[k][1], path[k + 1][0] - path[k][0])), 3).min); }
    bed = Math.min(bed, groundRange(circlePoly(tip[0], tip[1], moleW * 0.8, 20), 3).min) - 1.5;
    const hw = moleW / 2, top = yq + 0.45;
    kit.at(tip[0], tip[1], 3).sweep(path, () => [{ a: [hw + 1.5, bed], b: [hw, top], kind: K.STONE }, { a: [hw, top], b: [-hw, top], kind: K.PAVING }, { a: [-hw, top], b: [-hw - 1.5, bed], kind: K.STONE }], { meta: { role: 'mole' } });
    for (let k = 0; k < path.length - 1; k += 2) place?.(rect(...lerp2(path[k], path[k + 1], 0.5), Math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]) + 2, moleW + 4, Math.atan2(path[k + 1][1] - path[k][1], path[k + 1][0] - path[k][0])), 'mole');
    if (heads) {
      const e = path.at(-1), f = path.at(-2), dl = Math.hypot(e[0] - f[0], e[1] - f[1]), dir = [(e[0] - f[0]) / dl, (e[1] - f[1]) / dl], pp = [-dir[1], dir[0]], rh = hw + 1.5;
      const D = [];
      for (let k = 0; k <= 16; k++) { const t = -Math.PI / 2 + (Math.PI * k) / 16; D.push([e[0] + (Math.cos(t) * dir[0] + Math.sin(t) * pp[0]) * rh, e[1] + (Math.cos(t) * dir[1] + Math.sin(t) * pp[1]) * rh]); }
      kit.at(tip[0], tip[1], 3).prism(D, bed, top, { top: K.PAVING, meta: { role: 'mole head' } });
      lighthouse(kit, tip[0], tip[1], top, lightH, 4.2);
    }
    moles.push({ path, tip, top });
  }
  return { secs, runs: allSecs, yq, E, Sd, O, Q, frontOff, moles, sLand, gap, proj };
}

/**
 * Transit sheds along the quay (call after the harbour front, whose flights are in occ): long
 * halls of white stone with a glazed barrel vault, parallel to the sea wall, landward of the
 * line of the quay lamps so the working apron stays open, with a service way behind them clear
 * of the flights up to the esplanade. Each shed fills a stretch of quay `len` long where it
 * fits; stretches that do not fit are left open.
 */
export function quaySheds(kit, hb, occ, place, { len = 66, gap = 16, depths = [22, 20, 18, 16], h = 9.5, rise = 5, lead = 12 } = {}) {
  const { Q, frontOff, yq } = hb, ang = Math.atan2(hb.E[1], hb.E[0]);
  const tOf = (p) => (p[0] - hb.O[0]) * hb.Sd[0] + (p[1] - hb.O[1]) * hb.Sd[1];
  let built = 0;
  for (const run of hb.runs) {
    if (run.length < 4) continue;
    const a = run[0].s + lead, b = run.at(-1).s - lead;
    for (let s = a; s + len <= b; ) {
      const span = run.filter((q) => q.s >= s - 13 && q.s <= s + len + 13);
      const backs = span.map((q) => tOf(q.r)), dMax = frontOff - Math.min(...backs);
      // the shed's sea face stands 2 m landward of the lamps (at 45 % of the quay's depth)
      const tf = frontOff - (0.45 * dMax + 2.2), tLand = Math.max(...backs) + 3;
      let ok = false;
      for (const d of depths) {
        const tb = tf - d;
        if (tb < tLand) continue;
        const q = [Q(s, tf), Q(s + len, tf), Q(s + len, tb), Q(s, tb)];
        if (occ.query(q, 2, (it) => it.tag !== 'quay').length) continue;
        const c = centroid(q), W = d;
        kit.at(c[0], c[1], 3).prism(q, yq - 0.25, yq + h, { wall: K.PUNCHED, top: K.STONE, vBase: yq, meta: { role: 'transit shed', supported: true } });
        kit.at(c[0], c[1], 3).vault(c[0], c[1], len - 1.2, W - 1.2, ang, yq + h - 0.02, rise, { kind: K.GLASS, end: K.STONE, seg: 12, meta: { role: 'shed vault', supported: true } });
        // a cornice band where the vault springs (near detail)
        kit.at(c[0], c[1], 1).parapet(q, yq + h - 0.02, 0.7, 0.55, { meta: { role: 'shed cornice', supported: true } });
        if (place) place(q, 'shed'); else occ.add(q, 'shed');
        built++; ok = true;
        break;
      }
      s += ok ? len + gap : 12;
    }
  }
  return built;
}
