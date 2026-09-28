import * as THREE from 'three';
import { createFacadeMaterial } from './facade.js';
import { latheFacade, loftSections, sweepTube, mergeClean } from './geom.js';
import { sweepLoop } from './platform.js';
import { mulberry32 } from './noise.js';
import { outerCities, renderedHeight } from './outerCities.js';
import { terrainHeight } from './terrain.js';
import { buildMassifTowns } from './massifTowns.js';

// The outer cities of Greater Meridian, seen from the lagoon and the wards at 20-40 km.
//   Thalassa   a white city in terraces following the contours of its island, a temple of
//              the sea on the summit
//   Anchorage  the western port: a dense skyline, twin towers joined by a sky arch over the
//              harbour head, long moles with cranes
//   Orison     needle towers with gold crowns that catch the first light
//   Vesper     low white town of domes round its harbour, a cathedral spire, a tall lighthouse
//   Austral    one great spire among a ring of towers
//   Ridgeholm, Highgate, Cloudmere: terrace towns stepping up the massif's southern slopes
//              (built in massifTowns.js)
// Every island city has a harbour built out to the 3.5 m isobath on the coast facing the
// capital: a quay with its sea wall, moles with lighthouses, a ferry pier, a waterfront row.
// Everything stands on the terrain exactly as it is drawn (renderedHeight), and is massing
// under the full facade shader, so windows light the cities at night.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------ primitives --
function tower(rnd, x, y, z, H, R, style = rnd()) {
  const seg = 8 + Math.floor(rnd() * 5);
  const prof = [];
  const rows = 8;
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    let r = R;
    if (style < 0.3) r = R * (1 - 0.5 * Math.pow(v, 1.4));
    else if (style < 0.55) r = R * (0.86 + 0.24 * Math.sin(Math.PI * v)) * (1 - 0.3 * v);
    else r = R * (1 - 0.2 * Math.floor(v * 4) / 4);
    prof.push({ r, y: y + H * v, kind: j === rows ? 1 : 0 });
  }
  const top = y + H;
  const rt = prof[prof.length - 1].r;
  prof.push({ r: rt * 0.84, y: top + 4, kind: 2 }, { r: rt * 0.32, y: top + 11, kind: 1 }, { r: 0.6, y: top + H * (0.05 + 0.07 * rnd()), kind: 2 }, { r: 0.01, y: top + H * 0.13, kind: 1 });
  const g = latheFacade([{ r: R * 1.25, y: y - 6, kind: 1 }, { r: R * 1.25, y: y + 8, kind: 5 }, ...prof], seg, { phase: rnd() * TAU });
  return g.translate(x, 0, z);
}

function needle(rnd, x, y, z, H, R) {
  const prof = [{ r: R * 1.6, y: y - 6, kind: 1 }, { r: R * 1.6, y: y + 10, kind: 5 }];
  for (let j = 0; j <= 6; j++) { const v = j / 6; prof.push({ r: R * (1 - 0.72 * Math.pow(v, 1.2)), y: y + H * 0.86 * v, kind: 0 }); }
  prof.push({ r: R * 0.34, y: y + H * 0.88, kind: 2 }, { r: R * 0.2, y: y + H * 0.96, kind: 2 }, { r: 0.4, y: y + H, kind: 2 });
  return latheFacade(prof, 6, { phase: rnd() * TAU }).translate(x, 0, z);
}

function block(x, y, z, H, w, d, rot, wall = 5, top = 1) {
  const g = latheFacade([{ r: 1, y: y - 7, kind: wall }, { r: 1, y: y + H, kind: wall }, { r: 0.001, y: y + H, kind: top }], 4, { phase: Math.PI / 4 });
  g.scale(w * 0.7071, 1, d * 0.7071);
  g.rotateY(rot);
  return g.translate(x, 0, z);
}

function prism4(q, y0, y1, wall = 5, topK = 3) {
  // a prism over four corner points (x, z), walls outward, a planted top
  const pos = [], fac = [], idx = [];
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cz = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  let u = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const base = pos.length / 3;
    pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
    fac.push(u, y0, wall, u + L, y0, wall, u + L, y1, wall, u, y1, wall);
    const nx = b[1] - a[1], nz = -(b[0] - a[0]);
    const out = nx * ((a[0] + b[0]) / 2 - cx) + nz * ((a[1] + b[1]) / 2 - cz) > 0;
    if (out) idx.push(base, base + 2, base + 1, base, base + 3, base + 2); else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    u += L;
  }
  const t = pos.length / 3;
  for (const p of q) { pos.push(p[0], y1, p[1]); fac.push(p[0], p[1], topK); }
  // top faces up
  const cr = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]);
  if (cr < 0) idx.push(t, t + 1, t + 2, t, t + 2, t + 3); else idx.push(t, t + 2, t + 1, t, t + 3, t + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The lowest rendered ground under a footprint. */
function groundMin(x, z, r) {
  let m = renderedHeight(x, z);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; m = Math.min(m, renderedHeight(x + Math.cos(a) * r, z + Math.sin(a) * r)); }
  return m;
}

/** Where a ray from the island centre meets rendered height h. */
function contourPt(cx, cz, a, h, maxR) {
  const d = [Math.cos(a), Math.sin(a)];
  let last = -1;
  for (let s = 0; s < maxR; s += 20) if (renderedHeight(cx + d[0] * s, cz + d[1] * s) > h) last = s;
  if (last < 0) return null;
  let lo = last, hi = last + 20;
  for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (renderedHeight(cx + d[0] * m, cz + d[1] * m) > h) lo = m; else hi = m; }
  return [cx + d[0] * lo, cz + d[1] * lo];
}

// --------------------------------------------------------------- harbour --
function harbour(parts, c, rnd, lights, { moleReach = 340, cranes = 0, lighthouseH = 34 } = {}) {
  const Q = c.quayLine;
  // quay: sea wall and fender facing the sea, a 70 m quay top, its back wall into the land
  parts.push(sweepLoop(Q, () => [
    { a: [2.6, -16], b: [0, 2.5], kind: 1 },
    { a: [0, 2.5], b: [0, 3.45], kind: 10 },
    { a: [0, 3.45], b: [-0.8, 3.45], kind: 1 },
    { a: [-0.8, 3.45], b: [-0.8, 3.0], kind: 1 },
    { a: [-0.8, 3.0], b: [-70, 3.0], kind: 9 },
    { a: [-70, 3.0], b: [-70, -9], kind: 1 },
  ], { closed: false }));
  const d = c.d, sd = c.side;
  // moles from both quay ends, curving in to leave a mouth on the axis
  const ends = [Q[0], Q[Q.length - 1]];
  const mouth = [c.deep.x + d[0] * moleReach, c.deep.z + d[1] * moleReach];
  ends.forEach((e, i) => {
    const s = i === 0 ? -1 : 1;             // the first quay end lies on the -side of the axis
    const tip = [mouth[0] + sd[0] * s * 62, mouth[1] + sd[1] * s * 62];
    const ctrl = [[e[0], e[1]], [e[0] + d[0] * moleReach * 0.55, e[1] + d[1] * moleReach * 0.55], tip];
    const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => V(x, 0, z)), false, 'centripetal');
    const pts = curve.getSpacedPoints(24).map((v) => [v.x, v.z]);
    parts.push(sweepLoop(pts, () => [
      { a: [9, -16], b: [8, 4.2], kind: 1 },
      { a: [8, 4.2], b: [-8, 4.2], kind: 9 },
      { a: [-8, 4.2], b: [-9, -16], kind: 1 },
    ], { closed: false }));
    parts.push(latheFacade([{ r: 11, y: -16, kind: 1 }, { r: 10, y: 4.2, kind: 1 }, { r: 0.1, y: 4.2, kind: 9 }], 20).translate(tip[0], 0, tip[1]));
    const h = lighthouseH;
    parts.push(latheFacade([{ r: 4.2, y: 4, kind: 1 }, { r: 3.0, y: 4 + h * 0.82, kind: 1 }, { r: 3.9, y: 4 + h * 0.84, kind: 10 }, { r: 2.6, y: 4 + h * 0.85, kind: 2 }, { r: 2.6, y: 4 + h * 0.95, kind: 2 }, { r: 0.05, y: 4 + h + 2, kind: 10 }], 12).translate(tip[0], 0, tip[1]));
    lights.push({ x: tip[0], y: 4 + h * 0.9, z: tip[1], c: i === 0 ? [1.0, 0.22, 0.12] : [0.25, 1.0, 0.45], s: 2.6 });
    if (cranes) for (let k = 0; k < cranes; k++) {
      const p = pts[6 + k * 4];
      if (!p) continue;
      parts.push(block(p[0], 4.2, p[1], 32, 16, 9, Math.atan2(d[0], d[1])));
      parts.push(block(p[0] + d[0] * 18, 36, p[1] + d[1] * 18, 3, 52, 3, Math.atan2(d[0], d[1]), 1, 1));
    }
  });
  // the ferry pier and its terminal
  const m0 = Q[Math.floor(Q.length / 2)];
  const pier = [[m0[0] - d[0] * 20, m0[1] - d[1] * 20], [m0[0] + d[0] * 95, m0[1] + d[1] * 95]];
  parts.push(sweepLoop(pier, () => [{ a: [6, -12], b: [6, 3.7], kind: 1 }, { a: [6, 3.7], b: [-6, 3.7], kind: 9 }, { a: [-6, 3.7], b: [-6, -12], kind: 1 }], { closed: false }));
  const tb = [m0[0] - d[0] * 40, m0[1] - d[1] * 40];
  parts.push(block(tb[0], 3.0, tb[1], 13, 60, 24, Math.atan2(d[0], d[1]), 0, 3));
  // the waterfront row along the back of the quay
  for (let i = 0; i < Q.length - 1; i++) {
    const a = Q[i], b = Q[i + 1];
    const tx = b[0] - a[0], tz = b[1] - a[1], L = Math.hypot(tx, tz) || 1;
    const n = [-tz / L, tx / L];         // inland (left of travel)
    const segs = Math.max(1, Math.floor(L / 46));
    for (let k = 0; k < segs; k++) {
      const t0 = (k + 0.08) / segs, t1 = (k + 0.92) / segs;
      const p0 = [a[0] + tx * t0, a[1] + tz * t0], p1 = [a[0] + tx * t1, a[1] + tz * t1];
      const dep = 18 + rnd() * 10;
      const q = [[p0[0] + n[0] * 74, p0[1] + n[1] * 74], [p1[0] + n[0] * 74, p1[1] + n[1] * 74], [p1[0] + n[0] * (74 + dep), p1[1] + n[1] * (74 + dep)], [p0[0] + n[0] * (74 + dep), p0[1] + n[1] * (74 + dep)]];
      const g0 = Math.min(3, ...q.map(([x, z]) => renderedHeight(x, z)));
      parts.push(prism4(q, g0 - 5, Math.max(g0, 3) + 14 + rnd() * 20, 5, 3));
    }
  }
  return mouth;
}

// ---------------------------------------------------------------- styles --
function placeRandom(c, rnd, n, rMin, rMax, spread, minH, maxH, fn, placed) {
  let made = 0, tries = 0;
  while (made < n && tries++ < n * 40) {
    const a = c.toward + (rnd() * 2 - 1) * spread;
    const r = c.coast.s - rMin - rnd() * (rMax - rMin);
    const x = c.ix + Math.cos(a) * r, z = c.iz + Math.sin(a) * r;
    const h = terrainHeight(x, z);
    if (h < minH || h > maxH) continue;
    const s = Math.abs(terrainHeight(x + 30, z) - h) + Math.abs(terrainHeight(x, z + 30) - h);
    if (s > 26) continue;
    const res = fn(x, z, h, r, a);
    if (!res) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + res + 12)) continue;
    placed.push({ x, z, r: res });
    made++;
  }
}

function terraces(parts, c, rnd, heights, spread, depth, hMin, hMax) {
  for (const h of heights) {
    const pts = [];
    const n = 44;
    for (let k = 0; k <= n; k++) {
      const a = c.toward + ((k / n) * 2 - 1) * spread;
      const p = contourPt(c.ix, c.iz, a, h, c.ir * 3);
      pts.push(p);
    }
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[k + 1];
      if (!a || !b || rnd() < 0.18) continue;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > 260 || L < 20) continue;
      const toC = (p) => { const dx = c.ix - p[0], dz = c.iz - p[1], l = Math.hypot(dx, dz); return [dx / l, dz / l]; };
      const na = toC(a), nb = toC(b);
      const q = [[a[0] + na[0] * 4, a[1] + na[1] * 4], [b[0] + nb[0] * 4, b[1] + nb[1] * 4], [b[0] + nb[0] * (4 + depth), b[1] + nb[1] * (4 + depth)], [a[0] + na[0] * (4 + depth), a[1] + na[1] * (4 + depth)]];
      const g0 = Math.min(...q.map(([x, z]) => renderedHeight(x, z)));
      parts.push(prism4(q, g0 - 6, h + hMin + rnd() * (hMax - hMin), 5, 3));
    }
  }
}

function summit(c) {
  let best = { h: -1e9 };
  for (let r = 0; r < c.ir * 0.9; r += 120) for (let a = 0; a < TAU; a += 0.35) {
    const x = c.ix + Math.cos(a) * r, z = c.iz + Math.sin(a) * r;
    const h = renderedHeight(x, z);
    if (h > best.h) best = { x, z, h };
  }
  return best;
}

function buildThalassa(parts, c, rnd, lights) {
  harbour(parts, c, rnd, lights, { moleReach: 320 });
  terraces(parts, c, rnd, [10, 26, 46, 70, 98, 130, 166, 206, 250, 298, 348], 1.2, 22, 10, 22);
  const s = summit(c);
  // the temple of the sea: four tiers, a colonnade, a dome and a lantern
  for (let k = 0; k < 4; k++) parts.push(block(s.x, s.h - 6 + k * 9, s.z, 9 + (k === 0 ? 6 : 0), 150 - k * 28, 150 - k * 28, 0.3, 1, 9));
  for (let k = 0; k < 18; k++) { const a = (k / 18) * TAU; parts.push(latheFacade([{ r: 2.2, y: 0, kind: 1 }, { r: 1.8, y: 24, kind: 1 }, { r: 2.6, y: 25, kind: 1 }], 8).translate(s.x + Math.cos(a) * 36, s.h + 30, s.z + Math.sin(a) * 36)); }
  parts.push(latheFacade([{ r: 40, y: s.h + 55, kind: 1 }, { r: 40, y: s.h + 58, kind: 1 }, { r: 34, y: s.h + 58, kind: 0 }, { r: 26, y: s.h + 76, kind: 0 }, { r: 12, y: s.h + 86, kind: 0 }, { r: 5, y: s.h + 88, kind: 2 }, { r: 3, y: s.h + 100, kind: 2 }, { r: 0.1, y: s.h + 106, kind: 1 }], 32));
  lights.push({ x: s.x, y: s.h + 100, z: s.z, c: [1.0, 0.85, 0.6], s: 4 });
  const placed = [];
  placeRandom(c, rnd, 8, 900, 2200, 0.9, 60, 300, (x, z, h) => { const H = 220 + rnd() * 200; parts.push(tower(rnd, x, groundMin(x, z, 26) - 4, z, H, 20 + rnd() * 12, 0.2)); return 36; }, placed);
}

function buildAnchorage(parts, c, rnd, lights) {
  harbour(parts, c, rnd, lights, { moleReach: 480, cranes: 3, lighthouseH: 40 });
  const placed = [];
  // the twin towers at the harbour head, joined by a sky arch
  const hx = c.coast.x - c.d[0] * 420, hz = c.coast.z - c.d[1] * 420;
  const tw = [];
  for (const s of [-1, 1]) {
    const x = hx + c.side[0] * s * 95, z = hz + c.side[1] * s * 95;
    const g = groundMin(x, z, 40);
    parts.push(tower(rnd, x, g - 4, z, 680, 38, 0.6));
    tw.push(V(x, g + 520, z));
    placed.push({ x, z, r: 50 });
    lights.push({ x, y: g + 680 + 8, z, c: [0.9, 0.95, 1.0], s: 3 });
  }
  const arc = [];
  for (let i = 0; i <= 20; i++) { const t = i / 20; const p = tw[0].clone().lerp(tw[1], t); p.y += 34 * Math.sin(Math.PI * t); arc.push(p); }
  parts.push(sweepTube(arc, () => 7, 10, { kind: 0 }));
  parts.push(sweepTube(arc.map((p) => p.clone().add(V(0, -7.5, 0))), () => 1.0, 5, { kind: 2 }));
  placeRandom(c, rnd, 64, 250, 1700, 0.55, 3, 120, (x, z, h, r) => {
    const inland = c.coast.s - r;
    const H = (120 + rnd() * 320) * (1.1 - Math.min(inland, 1700) / 2600);
    const R = 16 + rnd() * 20;
    parts.push(tower(rnd, x, groundMin(x, z, R) - 4, z, H, R, 0.55 + rnd() * 0.45));
    return R * 1.3;
  }, placed);
  placeRandom(c, rnd, 420, 120, 2400, 0.8, 3, 200, (x, z) => { const w = 30 + rnd() * 60, d = 24 + rnd() * 40; parts.push(block(x, groundMin(x, z, Math.max(w, d) * 0.5), z, 14 + rnd() * 40, w, d, c.toward + (rnd() - 0.5) * 0.3)); return Math.max(w, d) * 0.55; }, placed);
}

function buildOrison(parts, c, rnd, lights) {
  harbour(parts, c, rnd, lights, { moleReach: 300 });
  const placed = [];
  placeRandom(c, rnd, 56, 500, 1900, 0.6, 3, 220, (x, z, h, r) => {
    const H = 220 + rnd() * 500;
    const R = 10 + rnd() * 12;
    parts.push(needle(rnd, x, groundMin(x, z, R * 1.6) - 3, z, H, R));
    return R * 2.4;
  }, placed);
  placeRandom(c, rnd, 300, 120, 2200, 0.8, 3, 220, (x, z) => { const w = 26 + rnd() * 40, d = 22 + rnd() * 30; parts.push(block(x, groundMin(x, z, Math.max(w, d) * 0.5), z, 10 + rnd() * 26, w, d, c.toward + (rnd() - 0.5) * 0.4, 5, 7)); return Math.max(w, d) * 0.55; }, placed);
}

function buildVesper(parts, c, rnd, lights) {
  harbour(parts, c, rnd, lights, { moleReach: 280, lighthouseH: 62 });
  const placed = [];
  // the cathedral: a long nave, a crossing dome and a spire
  const cx = c.coast.x - c.d[0] * 520, cz = c.coast.z - c.d[1] * 520;
  const g = groundMin(cx, cz, 70);
  parts.push(block(cx, g, cz, 34, 130, 42, Math.atan2(c.d[0], c.d[1])));
  parts.push(latheFacade([{ r: 16, y: g + 34, kind: 5 }, { r: 16, y: g + 44, kind: 5 }, { r: 15, y: g + 52, kind: 1 }, { r: 8, y: g + 64, kind: 1 }, { r: 2, y: g + 68, kind: 2 }, { r: 0.1, y: g + 74, kind: 1 }], 24).translate(cx, 0, cz));
  const sx = cx + c.d[0] * 70, sz = cz + c.d[1] * 70;
  parts.push(latheFacade([{ r: 9, y: g - 4, kind: 5 }, { r: 9, y: g + 70, kind: 5 }, { r: 7, y: g + 74, kind: 2 }, { r: 6, y: g + 90, kind: 2 }, { r: 5, y: g + 92, kind: 1 }, { r: 0.1, y: g + 260, kind: 1 }], 8).translate(sx, 0, sz));
  lights.push({ x: sx, y: g + 92, z: sz, c: [1.0, 0.8, 0.55], s: 3 });
  placed.push({ x: cx, z: cz, r: 90 });
  placeRandom(c, rnd, 50, 150, 1500, 0.8, 3, 160, (x, z) => {
    const r = 6 + rnd() * 20;
    const gg = groundMin(x, z, r);
    parts.push(latheFacade([{ r: r * 1.05, y: gg - 5, kind: 5 }, { r: r * 1.05, y: gg + r * 0.8, kind: 5 }, { r: r * 1.1, y: gg + r * 0.85, kind: 1 }, { r: r * 0.9, y: gg + r * 1.3, kind: rnd() < 0.3 ? 7 : 1 }, { r: r * 0.5, y: gg + r * 1.65, kind: 1 }, { r: 0.1, y: gg + r * 1.8, kind: 2 }], 16).translate(x, 0, z));
    return r * 1.2;
  }, placed);
  placeRandom(c, rnd, 320, 90, 1900, 0.9, 3, 200, (x, z) => { const w = 16 + rnd() * 26, d = 14 + rnd() * 20; parts.push(block(x, groundMin(x, z, Math.max(w, d) * 0.5), z, 8 + rnd() * 14, w, d, c.toward + (rnd() - 0.5) * 0.6, 5, 9)); return Math.max(w, d) * 0.55; }, placed);
}

function buildAustral(parts, c, rnd, lights) {
  harbour(parts, c, rnd, lights, { moleReach: 360 });
  const placed = [];
  // the great spire: a five-lobed section turning as it rises
  const sx = c.coast.x - c.d[0] * 950, sz = c.coast.z - c.d[1] * 950;
  const g = groundMin(sx, sz, 120);
  const H = 1400, R = 110;
  const secs = [];
  for (let j = 0; j <= 60; j++) {
    const v = j / 60, y = g - 4 + v * H * 0.93;
    let s = (1 + 0.5 * Math.exp(-v * 12)) * (1 - 0.55 * Math.pow(v, 1.5));
    if (v > 0.88) s *= Math.pow(1 - (v - 0.88) / 0.12, 0.5) * 0.9 + 0.1;
    const pts = [];
    for (let i = 0; i < 60; i++) { const th = (i / 60) * TAU; const r = R * s * (1 + 0.2 * Math.cos(5 * (th - v * 3.8))) / 1.2; pts.push([sx + Math.cos(th) * r, sz + Math.sin(th) * r]); }
    secs.push({ y, pts, kind: v > 0.86 ? 2 : 0 });
  }
  parts.push(loftSections(secs, { capTop: true, kindTop: 2 }));
  parts.push(latheFacade([{ r: R * 0.1, y: g + H * 0.9, kind: 1 }, { r: 0.6, y: g + H * 1.06, kind: 2 }], 10).translate(sx, 0, sz));
  parts.push(latheFacade([{ r: R * 2.4, y: g - 6, kind: 1 }, { r: R * 2.4, y: g + 6, kind: 5 }, { r: R * 2.1, y: g + 8, kind: 3 }, { r: 0.1, y: g + 8.5, kind: 3 }], 48).translate(sx, 0, sz));
  lights.push({ x: sx, y: g + H * 1.06, z: sz, c: [0.8, 1.0, 0.9], s: 4 });
  placed.push({ x: sx, z: sz, r: R * 2.6 });
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * TAU + rnd() * 0.2, r = 520 + rnd() * 300;
    const x = sx + Math.cos(a) * r, z = sz + Math.sin(a) * r;
    const h = renderedHeight(x, z);
    if (h < 3 || h > 300) continue;
    const Rt = 20 + rnd() * 16;
    parts.push(tower(rnd, x, groundMin(x, z, Rt) - 4, z, 150 + rnd() * 170, Rt, rnd()));
    placed.push({ x, z, r: Rt * 1.3 });
  }
  placeRandom(c, rnd, 320, 120, 2200, 0.85, 3, 240, (x, z) => { const w = 26 + rnd() * 50, d = 22 + rnd() * 34; parts.push(block(x, groundMin(x, z, Math.max(w, d) * 0.5), z, 12 + rnd() * 34, w, d, c.toward + (rnd() - 0.5) * 0.4)); return Math.max(w, d) * 0.55; }, placed);
}

// ------------------------------------------------------------------ build --
export function buildSkyline(scene) {
  const oc = outerCities();
  const meshes = [];
  const lights = [];
  let tris = 0;
  const builders = { terraced: buildThalassa, port: buildAnchorage, needles: buildOrison, domes: buildVesper, spire: buildAustral };
  const add = (parts, pal, seed, name, light) => {
    const geo = mergeClean(parts.filter((g) => g && g.attributes.position.count));
    const mat = createFacadeMaterial(pal, seed, { litFrac: 0.62, band: 128, lampTint: light ? light.map((v) => v / Math.max(...light)) : undefined });
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    meshes.push(m);
    tris += geo.index.count / 3;
  };
  oc.islands.forEach((c, i) => {
    const parts = [];
    builders[c.style](parts, c, mulberry32(2026 + i * 17), lights);
    add(parts, c.palette, 900 + i, `${c.name} (island city)`, c.light);
  });
  // the massif terrace towns live in massifTowns.js
  const mt = buildMassifTowns(scene, oc.massif, lights);
  meshes.push(...mt.meshes);
  tris += mt.tris;
  return { meshes, tris, lights, cities: oc };
}
