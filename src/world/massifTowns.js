import * as THREE from 'three';
import { createFacadeMaterial } from './facade.js';
import { latheFacade, mergeClean } from './geom.js';
import { mulberry32 } from './noise.js';
import { renderedHeight } from './outerCities.js';

// The massif terrace towns: Ridgeholm, Highgate, Cloudmere. Each is a hill town on the lower
// southern slope of its massif, within ~0.9 km of its gondola top station:
//   terraces    level streets and garden terraces cut along the contours every 10 m of height,
//               each a closed solid whose back edge meets the slope and whose front is a
//               retaining wall reaching down past the ground below
//   houses      rows seated on the terraces against the hillside, following the contour,
//               gabled or with roof gardens, a few chapels with bell towers among them
//   stairs      flights climbing between terrace levels through gaps in the rows
//   the square  a civic podium in front of the gondola top station: town hall with its dome
//               and clock tower, a chapel, a fountain, a grand stair down to the slope
//   funicular   an inclined track from the square up through the upper town
//   towers      three slim towers on their own plinths
// Everything is sampled on the terrain exactly as it is drawn (renderedHeight). The massing
// (terraces, houses, square, towers) is one mesh seen from the lagoon; stairs, parapets,
// chimneys and the funicular furniture are a near set dropped beyond 4.5 km.

const TAU = Math.PI * 2;
const DH = 10;                       // height between terrace levels (m)
const NEAR_DIST = 4500;

// ------------------------------------------------------------ solid builder --
// Triangles are wound to face a given outward direction, so every closed part is correct
// from all sides; degenerate triangles are dropped (no zero normals).
class Solid {
  constructor() { this.pos = []; this.fac = []; }
  tri(a, b, c, fa, fb, fc, out) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-5) return;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { [b, c] = [c, b]; [fb, fc] = [fc, fb]; }
    this.pos.push(...a, ...b, ...c);
    this.fac.push(...fa, ...fb, ...fc);
  }
  quad(a, b, c, e, fa, fb, fc, fe, out) { this.tri(a, b, c, fa, fb, fc, out); this.tri(a, c, e, fa, fc, fe, out); }
  /** A vertical wall from (a, ya0..ya1) to (b, yb0..yb1). */
  wall(a, b, ya0, yb0, ya1, yb1, kind, out, u0 = 0) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    this.quad([a[0], ya0, a[1]], [b[0], yb0, b[1]], [b[0], yb1, b[1]], [a[0], ya1, a[1]],
      [u0, ya0, kind], [u0 + L, yb0, kind], [u0 + L, yb1, kind], [u0, ya1, kind], out);
    return u0 + L;
  }
  /** A horizontal-ish face over four corners (x, y, z); facade coords are plan x, z. */
  face(p, kind, out) { const f = p.map((q) => [q[0], q[2], kind]); this.quad(p[0], p[1], p[2], p[3], f[0], f[1], f[2], f[3], out); }
  /** A prism over a four-corner footprint q[i] = [x, z], from y0 to y1 (numbers or per-corner arrays). */
  prism(q, y0, y1, wallK, topK) {
    const Y0 = Array.isArray(y0) ? y0 : [y0, y0, y0, y0], Y1 = Array.isArray(y1) ? y1 : [y1, y1, y1, y1];
    const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cz = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    let u = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, a = q[i], b = q[j];
      u = this.wall(a, b, Y0[i], Y0[j], Y1[i], Y1[j], wallK, [(a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz], u);
    }
    this.face(q.map((p, i) => [p[0], Y1[i], p[1]]), topK, [0, 1, 0]);
  }
  geometry() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fac, 3));
    g.computeVertexNormals();
    return g;
  }
}

// --------------------------------------------------------------- one town --
function buildTown(m, rnd, lights) {
  const C = m.town, y0 = renderedHeight(C.x, C.z);
  // downhill: the mean slope over the town centre, leaning toward the lagoon
  let gx = 0, gz = 0;
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU, r = k ? 180 : 0, x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
    gx += renderedHeight(x + 40, z) - renderedHeight(x - 40, z);
    gz += renderedHeight(x, z + 40) - renderedHeight(x, z - 40);
  }
  let dx = -gx, dz = -gz;
  const gl = Math.hypot(dx, dz);
  if (gl < 1e-6) { dx = 0; dz = 1; } else { dx /= gl; dz /= gl; }
  dx = dx * 0.7; dz = dz * 0.7 + 0.3;
  const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  const d = [dx, dz], s = [-dz, dx];
  const W = (u, t) => [C.x + s[0] * u + d[0] * t, C.z + s[1] * u + d[1] * t];
  const H = (p) => renderedHeight(p[0], p[1]);
  const base = new Solid(), near = new Solid(), lathes = [], nearLathes = [];
  const rotY = Math.atan2(-s[1], s[0]);                     // local x -> s

  // keep-outs: the gondola corridor (down toward the station), the station, the square,
  // the funicular and the towers
  const segD = (p, a, b) => {
    const vx = b[0] - a[0], vz = b[1] - a[1], L2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / L2));
    return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vz * t);
  };
  const gondA = [C.x, C.z], gondB = [m.station.x, m.station.z];
  const SQ = { u0: -52, u1: 52, t0: -2, t1: 64 };
  const funA = W(-78, 30), funB = W(-78, -470);
  const blocked = [];
  const local = (p) => { const x = p[0] - C.x, z = p[1] - C.z; return [x * s[0] + z * s[1], x * d[0] + z * d[1]]; };
  const free = (p, pad = 0) => {
    const [u, t] = local(p);
    if (u > SQ.u0 - 8 - pad && u < SQ.u1 + 8 + pad && t > SQ.t0 - 8 - pad && t < SQ.t1 + 8 + pad) return false;
    if (Math.hypot(p[0] - C.x, p[1] - C.z) < 30 + pad) return false;
    if (segD(p, gondA, gondB) < 13 + pad) return false;
    if (segD(p, funA, funB) < 6 + pad) return false;
    for (const b of blocked) if (Math.hypot(p[0] - b.x, p[1] - b.z) < b.r + pad) return false;
    return true;
  };
  const ph = rnd() * TAU;
  const Rt = (p) => { const [u, t] = local(p); const a = Math.atan2(t, u); return 880 + 150 * Math.sin(3 * a + ph) + 90 * Math.sin(5 * a); };
  const inTown = (p) => Math.hypot(p[0] - C.x, p[1] - C.z) < Rt(p);

  // ---- the square: a level podium in front of the top station, the civic centre on it
  const yp = y0 - 0.6;
  const sq = [W(SQ.u0, SQ.t0), W(SQ.u1, SQ.t0), W(SQ.u1, SQ.t1), W(SQ.u0, SQ.t1)];
  base.prism(sq, sq.map((p) => Math.min(H(p), yp) - 3), yp, 1, 9);
  // grand stair from the front edge down the slope
  {
    const pts = [];
    let t = SQ.t1, y = yp;
    pts.push([t, y]);
    for (let k = 0; k < 80; k++) {
      const tn = t + 1.1, g = H(W(0, tn));
      if (y - 0.45 < g + 0.2) break;
      pts.push([tn, y]); y -= 0.45; pts.push([tn, y]); t = tn;
    }
    stairSolid(base, pts.map(([tt, yy]) => [...W(0, tt), yy]), [d[0], d[1]], 14, H);
  }
  // town hall on the west side, a domed roof and a clock tower
  {
    const q = [W(-50, 8), W(-26, 8), W(-26, 58), W(-50, 58)];
    base.prism(q, yp - 1, yp + 17, 5, 1);
    const hc = W(-38, 33);
    lathes.push(latheFacade([{ r: 9, y: yp + 16.5, kind: 1 }, { r: 9, y: yp + 19, kind: 0 }, { r: 8.6, y: yp + 21, kind: 1 },
      { r: 7.4, y: yp + 25, kind: 7 }, { r: 4.4, y: yp + 28.5, kind: 7 }, { r: 1.2, y: yp + 30, kind: 2 }, { r: 0.01, y: yp + 33, kind: 2 }], 20).translate(hc[0], 0, hc[1]));
    const tc = W(-38, 55);
    lathes.push(latheFacade([{ r: 4.6, y: yp - 1, kind: 1 }, { r: 4.6, y: yp + 30, kind: 5 }, { r: 5.2, y: yp + 30, kind: 1 }, { r: 5.2, y: yp + 31.2, kind: 1 },
      { r: 4.2, y: yp + 31.2, kind: 2 }, { r: 4.2, y: yp + 36, kind: 2 }, { r: 5, y: yp + 36, kind: 1 }, { r: 0.05, y: yp + 46, kind: 11 }], 4, { phase: Math.PI / 4 }).rotateY(rotY).translate(tc[0], 0, tc[1]));
    lights.push({ x: tc[0], y: yp + 34, z: tc[1], c: [1.0, 0.85, 0.6], s: 2.2 });
  }
  // the square's chapel on the east side
  chapel(base, lathes, W, 38, 22, 16, 30, yp, rotY, s, d, lights);
  // fountain in the middle of the square, a colonnade of lamps along its sides
  {
    const f = W(18, 36);
    nearLathes.push(latheFacade([{ r: 7, y: yp - 0.3, kind: 1 }, { r: 7, y: yp + 0.8, kind: 1 }, { r: 6.4, y: yp + 0.8, kind: 1 },
      { r: 6.4, y: yp + 0.5, kind: 6 }, { r: 1.2, y: yp + 0.5, kind: 1 }, { r: 1.2, y: yp + 2.6, kind: 1 }, { r: 2.2, y: yp + 2.8, kind: 1 }, { r: 0.01, y: yp + 3.1, kind: 6 }], 24).translate(f[0], 0, f[1]));
    for (let k = 0; k < 6; k++) for (const u of [-20, 27]) {
      const p = W(u, 10 + k * 10);
      nearLathes.push(latheFacade([{ r: 0.14, y: yp - 0.2, kind: 10 }, { r: 0.1, y: yp + 4.2, kind: 10 }, { r: 0.4, y: yp + 4.3, kind: 2 }, { r: 0.01, y: yp + 4.9, kind: 2 }], 5).translate(p[0], 0, p[1]));
    }
  }

  // ---- slim towers on their own plinths, round the upper town
  for (let k = 0, tries = 0; k < 3 && tries < 40; tries++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.4, r = 260 + rnd() * 380;
    const p = W(Math.cos(a) * r, Math.sin(a) * r * 0.8);
    const R = 11 + rnd() * 5;
    if (!free(p, R + 10)) continue;
    let gmin = Infinity, gmax = -Infinity;
    for (let i = 0; i < 8; i++) { const g = H([p[0] + Math.cos(i * TAU / 8) * R * 1.6, p[1] + Math.sin(i * TAU / 8) * R * 1.6]); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
    if (gmax - gmin > 22) continue;
    const Ht = 80 + rnd() * 70, yb = gmax + 0.8;
    const prof = [{ r: R * 1.6, y: gmin - 3, kind: 1 }, { r: R * 1.6, y: yb, kind: 5 }, { r: R, y: yb, kind: 9 }];
    for (let j = 0; j <= 5; j++) { const v = j / 5; prof.push({ r: R * (1 - 0.28 * v), y: yb + Ht * v, kind: j === 5 ? 1 : 5 }); }
    prof.push({ r: R * 0.8, y: yb + Ht + 1.5, kind: 1 }, { r: R * 0.55, y: yb + Ht + 1.5, kind: 2 }, { r: R * 0.5, y: yb + Ht + 9, kind: 2 }, { r: 0.4, y: yb + Ht + 12, kind: 1 }, { r: 0.01, y: yb + Ht + 24, kind: 2 });
    lathes.push(latheFacade(prof, 12, { phase: rnd() * TAU }).translate(p[0], 0, p[1]));
    lights.push({ x: p[0], y: yb + Ht + 12, z: p[1], c: [1.0, 0.82, 0.6], s: 2 });
    blocked.push({ x: p[0], z: p[1], r: R * 1.6 + 6 });
    k++;
  }

  // ---- funicular: an inclined track on its embankment from the square up the town
  {
    const N = 50, sec = [];
    for (let i = 0; i <= N; i++) {
      const f = i / N, p = [funA[0] + (funB[0] - funA[0]) * f, funA[1] + (funB[1] - funA[1]) * f];
      sec.push([p[0], p[1], H(p) + 1.4]);
    }
    for (let i = 1; i < N; i++) sec[i][2] = (sec[i - 1][2] + sec[i][2] * 2 + H([sec[i + 1][0], sec[i + 1][1]]) + 1.4) / 4;
    for (const q of sec) q[2] = Math.max(q[2], H([q[0], q[1]]) + 0.6);
    const fd = [funB[0] - funA[0], funB[1] - funA[1]], fl = Math.hypot(fd[0], fd[1]);
    fd[0] /= fl; fd[1] /= fl;
    trackSolid(base, sec, fd, 5, 9, H, 0);
    for (const off of [-0.8, 0.8]) trackSolid(near, sec.map((q) => [q[0] - fd[1] * off, q[1] + fd[0] * off, q[2] + 0.18]), fd, 0.16, 10, null, 0.25);
    // stations at both ends and a car on the way
    for (const [p, y] of [[funA, sec[0][2]], [funB, sec[N][2]]]) {
      const q = [[-4.5, -5], [4.5, -5], [4.5, 5], [-4.5, 5]].map(([a, b]) => [p[0] - fd[1] * a + fd[0] * b, p[1] + fd[0] * a + fd[1] * b]);
      base.prism(q, Math.min(...q.map(H)) - 2, y + 5, 0, 1);
    }
    const i0 = 20, c0 = sec[i0], c1 = sec[i0 + 1];
    const cq = [[c0[0] - fd[1] * 1.6, c0[1] + fd[0] * 1.6], [c0[0] + fd[1] * 1.6, c0[1] - fd[0] * 1.6], [c1[0] + fd[1] * 1.6, c1[1] - fd[0] * 1.6], [c1[0] - fd[1] * 1.6, c1[1] + fd[0] * 1.6]];
    near.prism(cq, [c0[2] + 0.18, c0[2] + 0.18, c1[2] + 0.18, c1[2] + 0.18], [c0[2] + 3.4, c0[2] + 3.4, c1[2] + 3.4, c1[2] + 3.4], 0, 2);
  }

  // ---- contours: marching squares on a 12 m grid round the town, chained into polylines,
  // one terrace level every DH metres, worked from the top down so each level's stairs
  // land on the terrace below and the houses there keep clear of the landings
  const G = 12, NG = 161, X0 = C.x - 960, Z0 = C.z - 960;
  const hg = new Float32Array(NG * NG);
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) hg[j * NG + i] = renderedHeight(X0 + i * G, Z0 + j * G);
  const grad = (p) => {
    const e = 8;
    return [(H([p[0] + e, p[1]]) - H([p[0] - e, p[1]])) / (2 * e), (H([p[0], p[1] + e]) - H([p[0], p[1] - e])) / (2 * e)];
  };
  const levels = [];
  for (let L = Math.floor((y0 + 110) / DH) * DH; L >= y0 - 130; L -= DH) if (L > 12) levels.push(L);
  const landings = [];
  for (const L of levels) {
    const garden = rnd() < 0.3;
    for (const line of contourLines(hg, NG, G, X0, Z0, L)) {
      const pts = resample(line, 12);
      if (pts.length < 4) continue;
      // downhill normals, smoothed along the line
      const raw = pts.map((P) => { const g = grad(P), l = Math.hypot(g[0], g[1]); return { g: l, n: l > 1e-6 ? [-g[0] / l, -g[1] / l] : null }; });
      const secs = [];
      let arc = 0, nextGap = 50 + rnd() * 90;
      const gapsHere = [];
      for (let k = 0; k < pts.length; k++) {
        if (k) arc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        let nx = 0, nz = 0;
        for (let q = Math.max(0, k - 1); q <= Math.min(pts.length - 1, k + 1); q++) if (raw[q].n) { nx += raw[q].n[0]; nz += raw[q].n[1]; }
        const nl = Math.hypot(nx, nz), sl = raw[k].g;
        const P = pts[k];
        if (arc > nextGap) { gapsHere.push({ P, n: nl > 1e-6 ? [nx / nl, nz / nl] : null }); nextGap = arc + 110 + rnd() * 70; secs.push(null); continue; }
        if (nl < 1e-6 || sl < 0.06 || sl > 1.4) { secs.push(null); continue; }
        const n = [nx / nl, nz / nl], D = Math.max(7, Math.min(22, 0.5 * DH / sl));
        const F = [P[0] + n[0] * D, P[1] + n[1] * D], gF = H(F);
        const ok = gF < L - 1.2 && L - gF < 16 && inTown(P) && free(P) && free(F) && free([P[0] + n[0] * D * 0.5, P[1] + n[1] * D * 0.5]);
        secs.push(ok ? { u: arc, P, F, gF, D, n } : null);
      }
      // runs of continuous sections (broken where the front edge would fold over)
      let run = [];
      const flush = () => { if (run.length >= 3) terraceRun(base, near, run, L, garden, rnd, landings, lights); run = []; };
      for (const q of secs) {
        if (q && run.length) {
          const a = run[run.length - 1], px = q.P[0] - a.P[0], pz = q.P[1] - a.P[1];
          if ((q.F[0] - a.F[0]) * px + (q.F[1] - a.F[1]) * pz < 0.3 * (px * px + pz * pz)) flush();
        }
        if (q) run.push(q); else flush();
      }
      flush();
      // stairs down from this level through its gaps, to the contour one level below
      for (const { P, n } of gapsHere) {
        if (!n || !inTown(P) || !free(P, 3)) continue;
        let B = null;
        for (let r = 4; r < 70; r += 2) { const p = [P[0] + n[0] * r, P[1] + n[1] * r]; if (!free(p, 2)) break; if (H(p) <= L - DH) { B = { p, r }; break; } }
        if (!B || B.r < 8) continue;
        const nst = Math.ceil(DH / 0.55), sp = [[...P, L]];
        for (let k = 1; k <= nst; k++) {
          const f = k / nst, p = [P[0] + n[0] * B.r * f, P[1] + n[1] * B.r * f];
          sp.push([...p, L - DH * (k - 1) / nst], [...p, L - DH * f]);
        }
        stairSolid(near, sp, n, 3.2, H);
        landings.push(B.p);
      }
    }
  }

  const baseGeo = mergeClean([base.geometry(), ...lathes].filter(Boolean));
  const nearGeo = mergeClean([near.geometry(), ...nearLathes].filter(Boolean));
  return { baseGeo, nearGeo, center: new THREE.Vector3(C.x, y0, C.z) };
}

/** Marching squares: the polylines where the height grid crosses level L. */
function contourLines(hg, N, G, X0, Z0, L) {
  const pt = new Map(), adj = new Map();
  const ept = (id) => {
    let p = pt.get(id);
    if (p) return p;
    const e = id >> 1, i = e % N, j = (e - i) / N, hz = id & 1;
    const a = hg[j * N + i], b = hz ? hg[(j + 1) * N + i] : hg[j * N + i + 1];
    const f = Math.max(0.001, Math.min(0.999, (L - a) / (b - a || 1e-6)));
    p = hz ? [X0 + i * G, Z0 + (j + f) * G] : [X0 + (i + f) * G, Z0 + j * G];
    pt.set(id, p);
    return p;
  };
  const link = (a, b) => { for (const [x, y] of [[a, b], [b, a]]) { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); } };
  const up = (i, j) => hg[j * N + i] >= L;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const c = [];
    if (up(i, j) !== up(i + 1, j)) c.push((j * N + i) * 2);             // bottom
    if (up(i + 1, j) !== up(i + 1, j + 1)) c.push((j * N + i + 1) * 2 + 1); // right
    if (up(i, j + 1) !== up(i + 1, j + 1)) c.push(((j + 1) * N + i) * 2);   // top
    if (up(i, j) !== up(i, j + 1)) c.push((j * N + i) * 2 + 1);           // left
    if (c.length === 2) link(c[0], c[1]);
    else if (c.length === 4) { link(c[0], c[1]); link(c[2], c[3]); }
  }
  const seen = new Set(), lines = [];
  const walk = (s) => {
    const line = [];
    let prev = -1, cur = s;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      line.push(ept(cur));
      const nb = adj.get(cur).filter((x) => x !== prev && !seen.has(x));
      prev = cur; cur = nb[0];
    }
    return line;
  };
  for (const [id, nb] of adj) if (nb.length === 1 && !seen.has(id)) lines.push(walk(id));
  for (const id of adj.keys()) if (!seen.has(id)) lines.push(walk(id));
  return lines;
}

/** Points every `step` metres along a polyline. */
function resample(line, step) {
  const out = [line[0]];
  let acc = 0;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = step - acc;
    while (s <= l) { out.push([a[0] + (b[0] - a[0]) * s / l, a[1] + (b[1] - a[1]) * s / l]); s += step; }
    acc = l - (s - step);
  }
  return out;
}

/** A terrace along a contour: level top, retaining wall in front, houses against the slope. */
function terraceRun(base, near, run, L, garden, rnd, landings, lights) {
  const topK = garden ? 3 : 9;
  let uf = 0;
  for (let i = 0; i < run.length - 1; i++) {
    const a = run[i], b = run[i + 1];
    const n = [(a.n[0] + b.n[0]) / 2, 0, (a.n[1] + b.n[1]) / 2];
    base.face([[a.P[0], L, a.P[1]], [b.P[0], L, b.P[1]], [b.F[0], L, b.F[1]], [a.F[0], L, a.F[1]]], topK, [0, 1, 0]);
    uf = base.wall(a.F, b.F, a.gF - 2.5, b.gF - 2.5, L, L, 1, n, uf);
    base.wall(a.P, b.P, L - 3, L - 3, L, L, 1, [-n[0], 0, -n[2]]);
    // parapet on the retaining wall
    const ai = [a.F[0] - a.n[0] * 0.45, a.F[1] - a.n[1] * 0.45], bi = [b.F[0] - b.n[0] * 0.45, b.F[1] - b.n[1] * 0.45];
    near.wall(a.F, b.F, L - 0.1, L - 0.1, L + 1.05, L + 1.05, 1, n);
    near.wall(ai, bi, L - 0.1, L - 0.1, L + 1.05, L + 1.05, 1, [-n[0], 0, -n[2]]);
    near.face([[a.F[0], L + 1.05, a.F[1]], [b.F[0], L + 1.05, b.F[1]], [bi[0], L + 1.05, bi[1]], [ai[0], L + 1.05, ai[1]]], 1, [0, 1, 0]);
  }
  const tan = (i, j) => { const x = run[j].P[0] - run[i].P[0], z = run[j].P[1] - run[i].P[1]; return [x, 0, z]; };
  for (const [q, o] of [[run[0], tan(1, 0)], [run[run.length - 1], tan(run.length - 2, run.length - 1)]]) {
    base.quad([q.P[0], L - 3, q.P[1]], [q.F[0], q.gF - 2.5, q.F[1]], [q.F[0], L, q.F[1]], [q.P[0], L, q.P[1]],
      [0, L - 3, 1], [q.D, q.gF - 2.5, 1], [q.D, L, 1], [0, L, 1], o);
  }
  // houses: packed along the run, seated on the terrace top against the slope
  const at = (u) => {
    // contour point, downhill normal and depth at arc length u, interpolated along the run
    for (let i = 0; i < run.length - 1; i++) if (u >= run[i].u && u <= run[i + 1].u) {
      const f = (u - run[i].u) / (run[i + 1].u - run[i].u || 1), a = run[i], b = run[i + 1];
      const nx = a.n[0] + (b.n[0] - a.n[0]) * f, nz = a.n[1] + (b.n[1] - a.n[1]) * f, nl = Math.hypot(nx, nz) || 1;
      return { P: [a.P[0] + (b.P[0] - a.P[0]) * f, a.P[1] + (b.P[1] - a.P[1]) * f], n: [nx / nl, nz / nl], D: Math.min(a.D, b.D) };
    }
    return null;
  };
  let u = run[0].u + 2 + rnd() * 6;
  const uEnd = run[run.length - 1].u - 2;
  let chapelDone = rnd() > 0.12;
  while (u < uEnd) {
    const w = 9 + rnd() * 8;
    if (u + w > uEnd) break;
    const A = at(u), B = at(u + w), M = at(u + w / 2);
    if (!A || !B || !M || rnd() < (garden ? 0.55 : 0.15) || landings.some((p) => Math.hypot(p[0] - M.P[0], p[1] - M.P[1]) < w / 2 + 6)) { u += w * 0.6 + 2; continue; }
    const Dm = Math.min(A.D, B.D, M.D), dep = Math.min(Dm - 4.5, 7 + rnd() * 6);
    if (dep < 5) { u += w + 2; continue; }
    // set the back off the contour so the whole footprint stays on the terrace
    const A0 = [A.P[0] + A.n[0] * 1.2, A.P[1] + A.n[1] * 1.2], B0 = [B.P[0] + B.n[0] * 1.2, B.P[1] + B.n[1] * 1.2];
    const q = [A0, B0, [B0[0] + B.n[0] * dep, B0[1] + B.n[1] * dep], [A0[0] + A.n[0] * dep, A0[1] + A.n[1] * dep]];
    const d = M.n, tg = [B.P[0] - A.P[0], B.P[1] - A.P[1]], tl = Math.hypot(tg[0], tg[1]) || 1;
    if (!chapelDone && dep > 8 && w > 13) {
      chapelDone = true;
      chapelAt(base, near, q, null, L, d, [tg[0] / tl, tg[1] / tl], lights);
      u += w + 3;
      continue;
    }
    const floors = 1 + Math.floor(rnd() * rnd() * 3.2), Hh = floors * 3.6 + 0.6;
    base.prism(q, L - 1, L + Hh, 5, rnd() < 0.35 ? 3 : 1);
    if (rnd() < 0.68) gable(base, q, L + Hh, 2.2 + dep * 0.22, 11, d);
    else {
      // a glazed roof pavilion on the roof garden (near)
      near.prism(shrink(q, 2.6), L + Hh - 0.2, L + Hh + 2.6, 0, 1);
    }
    if (rnd() < 0.5) {
      const c = [q[0][0] * 0.7 + q[2][0] * 0.3, q[0][1] * 0.7 + q[2][1] * 0.3];
      near.prism([[c[0] - 0.6, c[1] - 0.6], [c[0] + 0.6, c[1] - 0.6], [c[0] + 0.6, c[1] + 0.6], [c[0] - 0.6, c[1] + 0.6]], L + Hh, L + Hh + 3.6 + dep * 0.2, 1, 11);
    }
    u += w + (rnd() < 0.3 ? 4 + rnd() * 5 : 0.6);
  }
}

/** A gable roof over q (q[0..1] back along the contour, q[2..3] front), ridge along the contour. */
function gable(S, q, y, rh, k, d) {
  const mA = [(q[0][0] + q[3][0]) / 2, (q[0][1] + q[3][1]) / 2], mB = [(q[1][0] + q[2][0]) / 2, (q[1][1] + q[2][1]) / 2];
  const P = (p, yy) => [p[0], yy, p[1]], F = (p, yy) => [p[0], p[1], k];
  const rA = P(mA, y + rh), rB = P(mB, y + rh);
  const qa = q.map((p) => P(p, y)), fa = q.map((p) => F(p));
  S.quad(qa[0], qa[1], rB, rA, fa[0], fa[1], F(mB), F(mA), [-d[0], 1, -d[1]]);
  S.quad(qa[3], qa[2], rB, rA, fa[3], fa[2], F(mB), F(mA), [d[0], 1, d[1]]);
  const sx = q[1][0] - q[0][0], sz = q[1][1] - q[0][1];
  // gable ends in the wall stone
  S.tri(qa[0], qa[3], rA, [0, y, 5], [1, y, 5], [0.5, y + rh, 5], [-sx, 0, -sz]);
  S.tri(qa[1], qa[2], rB, [0, y, 5], [1, y, 5], [0.5, y + rh, 5], [sx, 0, sz]);
}

function shrink(q, e) {
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cz = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  return q.map(([x, z]) => { const l = Math.hypot(x - cx, z - cz) || 1; return [x - (x - cx) / l * e, z - (z - cz) / l * e]; });
}

/** A chapel on a terrace footprint: tall nave, steep roof, a square bell tower at one end. */
function chapelAt(S, near, q, c, L, d, s, lights) {
  S.prism(q, L - 1, L + 9, 5, 1);
  gable(S, q, L + 9, 6, 11, d);
  const t = [q[0][0] * 0.8 + q[2][0] * 0.2, q[0][1] * 0.8 + q[2][1] * 0.2];
  const tq = [[-2.6, -2.6], [2.6, -2.6], [2.6, 2.6], [-2.6, 2.6]].map(([a, b]) => [t[0] + s[0] * a + d[0] * b, t[1] + s[1] * a + d[1] * b]);
  S.prism(tq, L - 1, L + 19, 5, 1);
  S.prism(shrink(tq, 0.3), L + 19, L + 22, 2, 1);
  const top = [(tq[0][0] + tq[2][0]) / 2, (tq[0][1] + tq[2][1]) / 2];
  // pyramid spire
  const Y = L + 22, apex = [top[0], Y + 9, top[1]];
  S.face(tq.map((p) => [p[0], Y, p[1]]), 1, [0, -1, 0]);
  for (let i = 0; i < 4; i++) {
    const a = tq[i], b = tq[(i + 1) % 4];
    S.tri([a[0], Y, a[1]], [b[0], Y, b[1]], apex, [0, Y, 11], [5, Y, 11], [2.5, Y + 9, 11], [(a[0] + b[0]) / 2 - top[0], 0.6, (a[1] + b[1]) / 2 - top[1]]);
  }
  lights.push({ x: top[0], y: L + 20.5, z: top[1], c: [1.0, 0.8, 0.55], s: 1.6 });
}

/** The square's chapel: a nave across the east side with a round bell tower. */
function chapel(S, lathes, W, u, t, w, dp, yp, rotY, s, d, lights) {
  const q = [W(u - w / 2, t), W(u + w / 2, t), W(u + w / 2, t + dp), W(u - w / 2, t + dp)];
  S.prism(q, yp - 1, yp + 12, 5, 1);
  // ridge down the nave (toward the slope): roof built on the rotated footprint
  gable(S, [q[1], q[2], q[3], q[0]], yp + 12, 7, 11, [-s[0], -s[1]]);
  const tc = W(u + w / 2 - 3, t + 1);
  lathes.push(latheFacade([{ r: 3.8, y: yp - 1, kind: 1 }, { r: 3.8, y: yp + 24, kind: 5 }, { r: 4.3, y: yp + 24, kind: 1 }, { r: 4.3, y: yp + 25, kind: 1 },
    { r: 3.4, y: yp + 25, kind: 2 }, { r: 3.4, y: yp + 29, kind: 2 }, { r: 3.9, y: yp + 29, kind: 1 }, { r: 0.05, y: yp + 40, kind: 11 }], 8).translate(tc[0], 0, tc[1]));
  lights.push({ x: tc[0], y: yp + 27, z: tc[1], c: [1.0, 0.8, 0.55], s: 1.8 });
}

/** A straight stair or track: sections [x, z, yTop] along dir, a solid down into the ground. */
function stairSolid(S, pts, dir, w, H) { trackSolid(S, pts, dir, w, 9, H, 0); }

function trackSolid(S, pts, dir, w, topK, H, depth) {
  if (pts.length < 3) return;
  const px = -dir[1] * w / 2, pz = dir[0] * w / 2;
  const bot = (p) => (H ? Math.min(H([p[0], p[1]]), p[2]) - 1.5 : p[2] - depth);
  const out = [dir[0] * 0.7, 1, dir[1] * 0.7];
  let u = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const la = [a[0] + px, a[2], a[1] + pz], ra = [a[0] - px, a[2], a[1] - pz], lb = [b[0] + px, b[2], b[1] + pz], rb = [b[0] - px, b[2], b[1] - pz];
    S.face([la, lb, rb, ra], topK, out);
    const ba = bot(a), bb = bot(b), du = Math.hypot(b[0] - a[0], b[1] - a[1]);
    S.wall([la[0], la[2]], [lb[0], lb[2]], ba, bb, a[2], b[2], 1, [px, 0, pz], u);
    S.wall([ra[0], ra[2]], [rb[0], rb[2]], ba, bb, a[2], b[2], 1, [-px, 0, -pz], u);
    u += du;
  }
  for (const [p, sg] of [[pts[0], -1], [pts[pts.length - 1], 1]]) {
    S.wall([p[0] + px, p[1] + pz], [p[0] - px, p[1] - pz], bot(p), bot(p), p[2], p[2], 1, [dir[0] * sg, 0, dir[1] * sg]);
  }
}

// ------------------------------------------------------------------ build --
export function buildMassifTowns(scene, towns, lights) {
  const meshes = [];
  let tris = 0;
  towns.forEach((m, i) => {
    const { baseGeo, nearGeo, center } = buildTown(m, mulberry32(3030 + i * 19), lights);
    const mat = createFacadeMaterial('fieldstone', 950 + i, { litFrac: 0.62, band: 128 });
    const mk = (geo, name) => {
      const me = new THREE.Mesh(geo, mat);
      me.name = name;
      me.castShadow = true;
      me.receiveShadow = true;
      tris += geo.index.count / 3;
      return me;
    };
    const b = mk(baseGeo, `${m.name} (massif town)`);
    b.matrixAutoUpdate = false;
    b.updateMatrix();
    scene.add(b);
    meshes.push(b);
    // the near set: stairs, parapets, chimneys, funicular furniture — dropped with distance
    const lod = new THREE.LOD();
    lod.name = `${m.name} (near detail)`;
    lod.position.copy(center);
    const n = mk(nearGeo, `${m.name} (near detail mesh)`);
    n.position.copy(center).negate();
    lod.addLevel(n, 0);
    lod.addLevel(new THREE.Object3D(), NEAR_DIST);
    lod.updateMatrixWorld(true);
    scene.add(lod);
    meshes.push(n);
  });
  return { meshes, tris };
}
