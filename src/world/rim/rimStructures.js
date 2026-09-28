import * as THREE from 'three';
import { K } from './rimKit.js';
import { latheFacade } from '../geom.js';
import { mulberry32 } from '../noise.js';

// The Rim's structures, each built twice: a near model with its detail and a far massing with
// the same silhouette (posts, rails and tiers merged away). Everything stands on the ground it
// was surveyed on: a footing sunk below the lowest ground under it, its working level on or
// above the highest. Units are metres; frames are { x, y, z, yaw } (rimKit.js).

const TAU = Math.PI * 2;

/** Lowest and highest ground under a local rectangle of frame o. */
function under(ground, o, x0, x1, z0, z1, step = 2) {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  let lo = 1e9, hi = -1e9;
  const nx = Math.max(1, Math.ceil((x1 - x0) / step)), nz = Math.max(1, Math.ceil((z1 - z0) / step));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const lx = x0 + ((x1 - x0) * i) / nx, lz = z0 + ((z1 - z0) * j) / nz;
    const h = ground(o.x + lx * c - lz * s, o.z + lx * s + lz * c);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  return { lo, hi };
}
const localToWorld = (o, lx, lz) => { const c = Math.cos(o.yaw), s = Math.sin(o.yaw); return [o.x + lx * c - lz * s, o.z + lx * s + lz * c]; };

/** A house: walls x0..x1 z0..z1 (local) from its footing to base + wall, gabled roof on top. */
function house(Kn, Kf, ground, o, x0, x1, z0, z1, wall, roof, kWall, kRoof = K.TIMBER, { eave = 0.5 } = {}) {
  const u = under(ground, o, x0 - eave, x1 + eave, z0 - eave, z1 + eave);
  const base = u.hi + 0.18, foot = u.lo - 0.8;
  for (const Kt of [Kn, Kf]) {
    if (!Kt) continue;
    // plinth (stone), walls, roof
    Kt.box(o, x0 - 0.15, x1 + 0.15, foot, base, z0 - 0.15, z1 + 0.15, K.STONE, K.PAVING);
    Kt.box(o, x0, x1, base, base + wall, z0, z1, kWall, K.STONE);
    Kt.gable(o, x0 - eave, x1 + eave, z0 - eave, z1 + eave, base + wall - 0.02, base + wall + roof, kRoof, kWall === K.TIMBER ? K.TIMBER : K.STONE);
  }
  return { base, foot, top: base + wall + roof };
}

/** Append a lathe profile (latheFacade points { r, y, kind }) at (x, y, z). */
function lathe(Kt, x, y, z, prof, seg = 24) {
  // kinds interpolate across a segment: each segment keeps its starting point's kind, and a
  // coincident ring switches to the next kind where it changes
  const P = [];
  for (let i = 0; i < prof.length; i++) {
    const p = prof[i], prev = P[P.length - 1];
    if (prev && prev.kind !== p.kind && (prev.r !== p.r || prev.y !== p.y)) P.push({ r: p.r, y: p.y, kind: prev.kind });
    P.push(p);
  }
  const g = latheFacade(P, seg);
  Kt.geometry(g, new THREE.Matrix4().makeTranslation(x, y, z));
}

// ------------------------------------------------------------------ cultivation --
function vineyard(Kn, Kf, site, ground) {
  for (const row of site.rows) {
    Kn.strip(row, 0.34, (x, z) => ground(x, z) - 0.35, (x, z) => ground(x, z) + 1.45, K.GARDEN, K.GARDEN);
    // the far massing: every third point, the same hedge
    const R = row.filter((_, i) => i % 3 === 0 || i === row.length - 1);
    if (R.length >= 2) Kf.strip(R, 0.34, (x, z) => ground(x, z) - 0.35, (x, z) => ground(x, z) + 1.4, K.GARDEN, K.GARDEN);
    // end posts of the trellis
    for (const i of [0, row.length - 1]) {
      const [x, z] = row[i], g = ground(x, z);
      Kn.post(x, z, 0.07, g - 0.5, g + 1.8, K.TIMBER);
    }
  }
}

function marketGarden(Kn, Kf, site, ground) {
  // raised beds, timber-edged: crops, or dark fresh-tilled soil, field by field
  for (const { pts: row, soil } of site.rows) {
    const top = soil ? K.CERAMIC : K.GARDEN, h = soil ? 0.3 : 0.42;
    Kn.strip(row, 0.72, (x, z) => ground(x, z) - 0.3, (x, z) => ground(x, z) + h, K.TIMBER, top);
    const R = row.filter((_, i) => i % 3 === 0 || i === row.length - 1);
    if (R.length >= 2) Kf.strip(R, 0.72, (x, z) => ground(x, z) - 0.3, (x, z) => ground(x, z) + h - 0.02, top, top);
  }
}

function glasshouse(Kn, Kf, site, ground) {
  // a glass barrel vault on a low stone base course, a vent along its ridge
  const o = { x: site.x, z: site.z, yaw: site.yaw };
  const u = under(ground, o, -17.2, 17.2, -4.8, 4.8);
  const b = u.hi + 0.35;
  const sec = [[-4.6, b - 0.05], [4.6, b - 0.05], [4.6, b + 1.2]];
  for (let i = 1; i < 10; i++) { const t = (i / 10) * Math.PI; sec.push([4.6 * Math.cos(t), b + 1.2 + 3.0 * Math.sin(t)]); }
  sec.push([-4.6, b + 1.2]);
  for (const Kt of [Kn, Kf]) Kt.box(o, -17.2, 17.2, u.lo - 0.6, b, -4.8, 4.8, K.STONE, K.PAVING);
  Kn.extrudeX(o, sec, -17, 17, K.GLASS, K.GLASS);
  Kn.box(o, -16, 16, b + 4.1, b + 4.45, -0.35, 0.35, K.METAL);
  Kf.box(o, -17, 17, b - 0.05, b + 1.2, -4.6, 4.6, K.GLASS);
  Kf.gable(o, -17, 17, -4.6, 4.6, b + 1.18, b + 4.2, K.GLASS, K.GLASS);
}

function packhouse(Kn, Kf, site, ground) {
  house(Kn, Kf, ground, { x: site.x, z: site.z, yaw: site.yaw }, -8, 8, -5.5, 5.5, 5.2, 3.8, K.TIMBER, K.TIMBER, { eave: 0.6 });
}

function hedgerow(Kn, Kf, site, ground) {
  const h = site.h;
  for (const P of site.pieces) {
    Kn.strip(P, 0.45, (x, z) => ground(x, z) - 0.3, (x, z) => ground(x, z) + h, K.GARDEN, K.GARDEN);
    const R = P.filter((_, i) => i % 3 === 0 || i === P.length - 1);
    if (R.length >= 2) Kf.strip(R, 0.45, (x, z) => ground(x, z) - 0.3, (x, z) => ground(x, z) + h - 0.05, K.GARDEN, K.GARDEN);
  }
}

function allotments(Kn, Kf, site, ground) {
  for (const p of site.plots) {
    const o = { x: p.x, z: p.z, yaw: p.yaw };
    // two raised beds along the plot, a path between; a shed at the back of half the plots
    [-3.6, 0.6].forEach((zc, bi) => {
      const P = [localToWorld(o, -4.6, zc), localToWorld(o, 0, zc), localToWorld(o, 4.6, zc)];
      const top = p.soil && p.soil[bi] ? K.CERAMIC : K.GARDEN;
      Kn.strip(P, 1.1, (x, z) => ground(x, z) - 0.3, (x, z) => ground(x, z) + 0.38, K.TIMBER, top);
      Kf.strip([P[0], P[2]], 1.1, (x, z) => ground(x, z) - 0.3, (x, z) => ground(x, z) + 0.36, top, top);
    });
    // a low box hedge along the plot's path side
    const H = [localToWorld(o, -5.6, -6.2), localToWorld(o, 0, -6.2), localToWorld(o, 5.6, -6.2)];
    Kn.strip(H, 0.3, (x, z) => ground(x, z) - 0.3, (x, z) => ground(x, z) + 0.8, K.GARDEN, K.GARDEN);
    if (p.shed) house(Kn, Kf, ground, o, 2.2, 5.0, 4.1, 7.6, 2.1, 1.1, K.TIMBER, K.TIMBER, { eave: 0.25 });
  }
}

// ------------------------------------------------------------------ set pieces --
function sports(Kn, Kf, site, ground) {
  const o = { x: site.x, z: site.z, yaw: site.yaw };
  const W = (lx, lz) => localToWorld(o, lx, lz);
  // the running track: a 400 m stadium loop, six lanes (7.3 m), on the ground
  const loopPts = (rr, n = 96) => {
    const P = [], st = 84.39 / 2;
    const q = Math.ceil(n / 4);
    for (let i = 0; i <= q; i++) P.push(W(-st + (2 * st * i) / q, -rr));
    for (let i = 1; i < 2 * q; i++) { const t = -Math.PI / 2 + (Math.PI * i) / (2 * q); P.push(W(st + Math.cos(t) * rr, Math.sin(t) * rr)); }
    for (let i = 0; i <= q; i++) P.push(W(st - (2 * st * i) / q, rr));
    for (let i = 1; i < 2 * q; i++) { const t = Math.PI / 2 + (Math.PI * i) / (2 * q); P.push(W(-st + Math.cos(t) * rr, Math.sin(t) * rr)); }
    return P;
  };
  const trk = loopPts(36.5 + 3.65);
  const gB = (x, z) => ground(x, z) - 0.25, gT = (x, z) => ground(x, z) + 0.1;
  Kn.loop(trk, 3.65, gB, gT, K.STONE, K.PAVING);
  const trkF = loopPts(36.5 + 3.65, 40);
  Kf.loop(trkF, 3.65, gB, gT, K.STONE, K.PAVING);
  // pitch markings: touchlines, goal lines, halfway line, centre circle (white composite)
  const line = (P, closed) => {
    const yB = (x, z) => ground(x, z) - 0.12, yT = (x, z) => ground(x, z) + 0.07;
    if (closed) Kn.loop(P, 0.06, yB, yT, K.STONE, K.STONE); else Kn.strip(P, 0.06, yB, yT, K.STONE, K.STONE);
  };
  const seg = (ax, az, bx, bz) => { const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 3)); const P = []; for (let i = 0; i <= n; i++) P.push(W(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)); return P; };
  const hl = 50, hwp = 32;
  const outline = [...seg(-hl, -hwp, hl, -hwp).slice(0, -1), ...seg(hl, -hwp, hl, hwp).slice(0, -1), ...seg(hl, hwp, -hl, hwp).slice(0, -1), ...seg(-hl, hwp, -hl, -hwp).slice(0, -1)];
  line(outline, true);
  line(seg(0, -hwp + 0.2, 0, hwp - 0.2), false);
  { const P = []; for (let i = 0; i < 40; i++) { const t = (i / 40) * TAU; P.push(W(Math.cos(t) * 9.15, Math.sin(t) * 9.15)); } line(P, true); }
  // goals
  for (const sg of [-1, 1]) {
    const g0 = ground(...W(sg * hl, 0));
    const go = { x: W(sg * hl, 0)[0], z: W(sg * hl, 0)[1], yaw: site.yaw };
    Kn.box(go, -0.06, 0.06, g0 - 0.4, g0 + 2.5, -3.72, -3.6, K.STONE); Kn.box(go, -0.06, 0.06, g0 - 0.4, g0 + 2.5, 3.6, 3.72, K.STONE);
    Kn.box(go, -0.06, 0.06, g0 + 2.44, g0 + 2.56, -3.72, 3.72, K.STONE);
    Kf.box(go, -0.06, 0.06, g0 - 0.4, g0 + 2.56, -3.72, 3.72, K.STONE);
  }
  // the grandstand on the side nearer Rim Way (+z or -z by the site's side), and floodlights
  const zs = site.side < 0 ? 1 : -1;     // lagoon parcels: Rim Way lies outward (+r = -z? see frame)
  const z0 = zs * (43.8 + 4), z1 = zs * (43.8 + 4 + 11);
  const gs = under(ground, o, -34, 34, Math.min(z0, z1), Math.max(z0, z1));
  const base = gs.hi + 0.15, foot = gs.lo - 0.9;
  // the stepped section (z runs away from the pitch), in the stand's own frame
  const so = { x: W(0, z0)[0], z: W(0, z0)[1], yaw: site.yaw, y: 0 };
  const flip = zs < 0 ? Math.PI : 0;
  const sf = { ...so, yaw: site.yaw + flip };
  const steps = 9, tread = 10 / steps, topT = base + steps * 0.48;
  // the tiers (local z runs away from the pitch): each a block from the footing to its tread,
  // overlapping the next, and a parapet wall at the back
  for (const Kt of [Kn, Kf]) {
    Kt.box(sf, -33, 33, foot, base, 0, 0.14, K.STONE, K.PAVING);
    for (let i = 1; i <= steps; i++) Kt.box(sf, -33 + i * 0.001, 33 - i * 0.001, foot - i * 0.001, base + i * 0.48, (i - 1) * tread + 0.1, i * tread + 0.14, K.STONE, K.PAVING);
    Kt.box(sf, -33.05, 33.05, foot - 0.05, topT + 1.2, 10.1, 11, K.STONE, K.STONE);
  }
  // canopy on columns
  const cy = base + steps * 0.48 + 5.2;
  for (const Kt of [Kn, Kf]) Kt.box(sf, -35, 35, cy, cy + 0.45, -1.2, 12.2, K.STONE, K.STONE);
  for (let x = -32; x <= 32; x += 8) {
    Kn.box(sf, x - 0.22, x + 0.22, topT + 1.1, cy + 0.02, 10.33, 10.77, K.METAL);
    if (x % 32 === 0) Kf.box(sf, x - 0.22, x + 0.22, topT + 1.1, cy + 0.02, 10.33, 10.77, K.METAL);
  }
  // floodlight masts at the corners
  for (const [lx, lz] of [[-72, -50], [72, -50], [-72, 50], [72, 50]]) {
    const [x, z] = W(lx, lz), g = ground(x, z);
    for (const Kt of [Kn, Kf]) {
      Kt.post(x, z, 0.35, g - 1, g + 24, K.METAL);
      Kt.box({ x, z, yaw: site.yaw }, -1.8, 1.8, g + 24, g + 25.6, -0.5, 0.5, K.LANTERN, K.METAL, K.METAL);
    }
  }
  // the clubhouse beside the stand
  house(Kn, Kf, ground, { x: W(-58, zs * 52)[0], z: W(-58, zs * 52)[1], yaw: site.yaw }, -9, 9, -5, 5, 4.2, 2.6, K.PUNCHED, K.TIMBER);
}

function amphitheatre(Kn, Kf, site, ground) {
  // the bowl: tiers on a semicircle (plus a little) facing the stage at yaw (toward the lagoon)
  const cx = site.x, cz = site.z, R = site.R, r0 = 12;
  const a0 = site.yaw + Math.PI / 2 - 0.18, a1 = site.yaw + (3 * Math.PI) / 2 + 0.18;
  const orch = ground(cx, cz);
  let prev = orch + 0.1;
  // orchestra floor
  const orchLo = Math.min(...Array.from({ length: 16 }, (_, i) => ground(cx + Math.cos((i / 16) * TAU) * r0, cz + Math.sin((i / 16) * TAU) * r0)));
  const orchHi = Math.max(orch, ...Array.from({ length: 16 }, (_, i) => ground(cx + Math.cos((i / 16) * TAU) * r0, cz + Math.sin((i / 16) * TAU) * r0)));
  prev = orchHi + 0.2;
  for (const Kt of [Kn, Kf]) Kt.ringSector(cx, cz, 0, r0, 0, TAU, orchLo - 0.8, prev, K.STONE, K.PAVING, K.STONE, 32);
  const tiers = Math.floor((R - r0 - 2) / 1.8);
  let far0 = null;
  for (let i = 0; i < tiers; i++) {
    const ra = r0 + 2 + i * 1.8, rb = ra + 1.8;
    // the ground under this tier
    let lo = 1e9, hi = -1e9;
    for (let k = 0; k <= 24; k++) { const t = a0 + ((a1 - a0) * k) / 24; for (const rr of [ra, rb]) { const h = ground(cx + Math.cos(t) * rr, cz + Math.sin(t) * rr); lo = Math.min(lo, h); hi = Math.max(hi, h); } }
    const top = Math.max(prev + 0.45, hi + 0.25);
    Kn.ringSector(cx, cz, ra - (i ? 0.04 : 0), rb, a0, a1, lo - 0.8 - i * 0.01, top, K.STONE, K.PAVING, K.STONE);
    if (far0 === null) far0 = { ra, lo };
    if (i % 3 === 2 || i === tiers - 1) { Kf.ringSector(cx, cz, far0.ra, rb, a0, a1, Math.min(far0.lo, lo) - 0.8, top, K.STONE, K.PAVING, K.STONE, 24); far0 = null; }
    prev = top;
  }
  // a colonnade crowning the cavea
  const rc = r0 + 2 + tiers * 1.8 + 1.4;
  for (let k = 0; k <= 22; k++) {
    const t = a0 + ((a1 - a0) * k) / 22, x = cx + Math.cos(t) * rc, z = cz + Math.sin(t) * rc, g = ground(x, z);
    Kn.post(x, z, 0.32, g - 0.6, Math.max(prev, g) + 4.2, K.STONE);
  }
  // the stage and its scene building, across the lagoon side
  const o = { x: cx, z: cz, yaw: site.yaw };
  const st = under(ground, o, r0 - 1, r0 + 16, -16, 16);
  const sb = Math.max(st.hi, orch) + 1.1;
  for (const Kt of [Kn, Kf]) {
    Kt.box(o, r0 - 1, r0 + 7, st.lo - 0.8, sb, -15, 15, K.STONE, K.TIMBER);
    Kt.box(o, r0 + 7, r0 + 12, st.lo - 0.8, sb + 7.5, -16, 16, K.PUNCHED, K.STONE);
  }
  for (let z = -13.5; z <= 13.5; z += 4.5) Kn.box(o, r0 + 6.2, r0 + 6.8, sb - 0.02, sb + 6.2, z - 0.3, z + 0.3, K.STONE);
  Kn.box(o, r0 + 5.8, r0 + 12.2, sb + 6.2, sb + 7.0, -16.2, 16.2, K.STONE);
}

function observatory(Kn, Kf, site, ground) {
  const cx = site.x, cz = site.z, R = 22;
  let lo = 1e9, hi = -1e9;
  for (let k = 0; k < 24; k++) for (const f of [0, 0.5, 1]) { const h = ground(cx + Math.cos((k / 24) * TAU) * R * f, cz + Math.sin((k / 24) * TAU) * R * f); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  const top = hi + 0.9;
  for (const Kt of [Kn, Kf]) {
    Kt.ringSector(cx, cz, 0, R, 0, TAU, lo - 1, top, K.STONE, K.PAVING, K.STONE, 8);
    // the great dome on its drum, two small domes on the cross axis
    lathe(Kt, cx, top - 0.05, cz, [{ r: 8.2, y: 0, kind: 5 }, { r: 8.2, y: 7.5, kind: 5 }, { r: 8.8, y: 7.5, kind: 1 }, { r: 8.8, y: 8.2, kind: 1 }, { r: 8.3, y: 8.2, kind: 10 },
      ...Array.from({ length: 9 }, (_, i) => { const t = ((i + 1) / 10) * (Math.PI / 2); return { r: 8.3 * Math.cos(t), y: 8.2 + 8.3 * Math.sin(t), kind: 10 }; }), { r: 0, y: 16.5, kind: 10 }], Kt === Kn ? 32 : 16);
    for (const sg of [-1, 1]) {
      const x = cx + Math.cos(site.yaw) * 14 * sg, z = cz + Math.sin(site.yaw) * 14 * sg;
      lathe(Kt, x, top - 0.05, z, [{ r: 3.6, y: 0, kind: 5 }, { r: 3.6, y: 4, kind: 5 }, { r: 3.9, y: 4, kind: 1 }, { r: 3.9, y: 4.4, kind: 1 }, { r: 3.5, y: 4.4, kind: 10 },
        ...Array.from({ length: 5 }, (_, i) => { const t = ((i + 1) / 6) * (Math.PI / 2); return { r: 3.5 * Math.cos(t), y: 4.4 + 3.5 * Math.sin(t), kind: 10 }; }), { r: 0, y: 7.9, kind: 10 }], Kt === Kn ? 20 : 12);
    }
  }
  // the dome's shutter ribs, the meridian line across the terrace
  const o = { x: cx, z: cz, yaw: site.yaw + Math.PI / 2 };
  for (const sg of [-1, 1]) {
    const P = [];
    for (let i = 0; i <= 10; i++) { const t = (i / 10) * (Math.PI / 2) * 0.93; P.push([Math.cos(t) * 8.35, Math.sin(t) * 8.35]); }
    // a rib: a thin plate in the dome's meridian plane, offset either side of the slit
    for (let i = 0; i < P.length - 1; i++) {
      const [r1, y1] = P[i], [r2, y2] = P[i + 1];
      const lo2 = Math.min(y1, y2), hi2 = Math.max(y1, y2);
      Kn.box({ x: cx, z: cz, yaw: site.yaw + Math.PI / 2, y: top + 8.2 }, sg * 0.9 - 0.12, sg * 0.9 + 0.12, lo2 - 0.05, hi2 + 0.25, Math.min(r1, r2) - 0.1, Math.max(r1, r2) + 0.25, K.METAL);
    }
  }
  Kn.box(o, -0.2, 0.2, top - 0.1, top + 0.05, -R + 1.5, -9, K.METAL, K.METAL);
  Kn.box(o, -0.2, 0.2, top - 0.1, top + 0.05, 9, R - 1.5, K.METAL, K.METAL);
  // steps up to the terrace on the side toward the lane (outer rim)
  const so = { x: cx, z: cz, yaw: site.yaw };
  const rise = top - ground(cx + Math.cos(site.yaw) * (R + 2), cz + Math.sin(site.yaw) * (R + 2));
  const n = Math.max(1, Math.ceil(rise / 0.17));
  for (let i = 0; i < n; i++) Kn.box(so, R - 0.4 + i * 0.32, R + (i + 1) * 0.32, lo - 1, top - (i + 1) * (rise / n) + 0.001, -3, 3, K.STONE, K.PAVING);
}

function botanical(Kn, Kf, site, ground) {
  const cx = site.x, cz = site.z, R = site.R;
  // the palm house: a glass dome on a stone drum
  let lo = 1e9, hi = -1e9;
  for (let k = 0; k < 16; k++) for (const f of [0, 0.6, 1]) { const h = ground(cx + Math.cos((k / 16) * TAU) * 15 * f, cz + Math.sin((k / 16) * TAU) * 15 * f); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  const b = hi + 0.4;
  for (const Kt of [Kn, Kf]) {
    lathe(Kt, cx, 0, cz, [{ r: 0, y: lo - 0.8, kind: 1 }, { r: 15, y: lo - 0.8, kind: 1 }, { r: 15, y: b, kind: 1 }, { r: 14, y: b, kind: 1 }, { r: 14, y: b + 2.2, kind: 1 },
      ...Array.from({ length: 10 }, (_, i) => { const t = ((i + 1) / 11) * (Math.PI / 2); return { r: 14 * Math.cos(t), y: b + 2.2 + 13 * Math.sin(t), kind: 0 }; }),
      { r: 2.2, y: b + 15.2, kind: 2 }, { r: 2.0, y: b + 17.4, kind: 2 }, { r: 0, y: b + 18.2, kind: 10 }], Kt === Kn ? 40 : 16);
  }
  // a ring of barrel-vaulted glasshouses round it
  const n = 8;
  for (let k = 0; k < n; k++) {
    const t = (k / n) * TAU + site.yaw, rr = R * 0.8;
    const x = cx + Math.cos(t) * rr, z = cz + Math.sin(t) * rr;
    const o = { x, z, yaw: t + Math.PI / 2 };
    const u = under(ground, o, -9, 9, -4.2, 4.2);
    const bb = u.hi + 0.3;
    const sec = [[-4.2, u.lo - 0.7], [4.2, u.lo - 0.7], [4.2, bb + 1.0]];
    for (let i = 1; i < 12; i++) { const a = (i / 12) * Math.PI; sec.push([4.2 * Math.cos(a), bb + 1.0 + 4.0 * Math.sin(a)]); }
    sec.push([-4.2, bb + 1.0]);
    Kn.extrudeX(o, sec, -8.5, 8.5, K.GLASS, K.GLASS);
    Kn.box(o, -8.7, 8.7, u.lo - 0.7, bb + 1.0, -4.4, 4.4, K.STONE, K.STONE);
    Kf.box(o, -8.7, 8.7, u.lo - 0.7, bb + 1.0, -4.4, 4.4, K.STONE, K.STONE);
    Kf.gable(o, -8.5, 8.5, -4.2, 4.2, bb + 1.0, bb + 5.0, K.GLASS, K.GLASS);
  }
}

function memorial(Kn, Kf, site, ground) {
  const o = { x: site.x, z: site.z, yaw: site.yaw }, L = site.L;
  const W = (lx, lz) => localToWorld(o, lx, lz);
  // the pool: a stone kerb round a still water surface
  const pl = L / 2 - 18;
  const u = under(ground, o, -pl - 1, pl + 1, -5, 5);
  const wy = u.hi + 0.45;
  for (const Kt of [Kn, Kf]) {
    Kt.box(o, -pl - 1, pl + 1, u.lo - 0.8, wy + 0.25, -5, -4, K.STONE);
    Kt.box(o, -pl - 1, pl + 1, u.lo - 0.8, wy + 0.25, 4, 5, K.STONE);
    Kt.box(o, -pl - 1.05, -pl, u.lo - 0.85, wy + 0.3, -4.05, 4.05, K.STONE);
    Kt.box(o, pl, pl + 1.05, u.lo - 0.85, wy + 0.3, -4.05, 4.05, K.STONE);
    Kt.box(o, -pl + 0.02, pl - 0.02, u.lo - 0.8, wy, -3.98, 3.98, K.WATER, K.WATER, K.STONE);
  }
  // the stelae: two ranks either side of the pool
  for (const sg of [-1, 1]) for (let x = -pl + 4; x <= pl - 4; x += 7) {
    const [px, pz] = W(x, sg * 9.5), g = ground(px, pz);
    Kn.box({ x: px, z: pz, yaw: site.yaw }, -0.5, 0.5, g - 0.6, g + 2.6, -0.2, 0.2, K.STONE);
    Kf.box({ x: px, z: pz, yaw: site.yaw }, -0.5, 0.5, g - 0.6, g + 2.6, -0.2, 0.2, K.STONE);
  }
  // clipped hedges framing the garden, broken for the paths
  for (const sg of [-1, 1]) for (let x = -L / 2 + 4; x < L / 2 - 4; x += 22) {
    const x1 = Math.min(x + 18, L / 2 - 4);
    const P = []; for (let q = x; q <= x1 + 1e-6; q += 3) P.push(W(q, sg * 14));
    if (P.length < 2) continue;
    Kn.strip(P, 0.55, (a, b) => ground(a, b) - 0.3, (a, b) => ground(a, b) + 1.4, K.GARDEN, K.GARDEN);
    Kf.strip(P, 0.55, (a, b) => ground(a, b) - 0.3, (a, b) => ground(a, b) + 1.4, K.GARDEN, K.GARDEN);
  }
  // the cenotaph at the head of the pool: a stepped plinth, a pylon and an arch
  const co = { x: W(pl + 9, 0)[0], z: W(pl + 9, 0)[1], yaw: site.yaw };
  const cu = under(ground, co, -6, 6, -7, 7);
  const cb = cu.hi + 0.2;
  for (const Kt of [Kn, Kf]) {
    Kt.box(co, -6, 6, cu.lo - 0.8, cb + 0.3, -7, 7, K.STONE, K.PAVING);
    Kt.box(co, -4.8, 4.8, cb + 0.3, cb + 0.7, -5.8, 5.8, K.STONE, K.PAVING);
    Kt.box(co, -1.4, 1.4, cb + 0.7, cb + 9.5, -5.2, -2.4, K.STONE);
    Kt.box(co, -1.4, 1.4, cb + 0.7, cb + 9.5, 2.4, 5.2, K.STONE);
    Kt.box(co, -1.6, 1.6, cb + 9.5, cb + 11.8, -5.6, 5.6, K.STONE);
  }
  Kn.box(co, -0.9, 0.9, cb + 0.7, cb + 1.8, -1.0, 1.0, K.STONE, K.LANTERN);
}

function hamlet(Kn, Kf, site, ground) {
  const o = { x: site.x, z: site.z, yaw: site.yaw };
  const R = mulberry32(Math.floor(site.seed * 1e6) + 3);
  const at = (lx, lz, yaw = 0) => { const [x, z] = localToWorld(o, lx, lz); return { x, z, yaw: site.yaw + yaw }; };
  // the farmhouse, two barns and a granary round a yard; a silo
  house(Kn, Kf, ground, at(-20, -13), -8, 8, -5, 5, 7.2, 3.8, K.PUNCHED, K.TIMBER);
  house(Kn, Kf, ground, at(14, -14), -10, 10, -6, 6, 6.2, 4.8, K.TIMBER, K.TIMBER);
  house(Kn, Kf, ground, at(16, 14), -8, 8, -4.5, 4.5, 4.8, 3.2, K.TIMBER, K.TIMBER);
  house(Kn, Kf, ground, at(-20, 15), -5, 5, -4, 4, 4.2, 2.6, K.STONE, K.TIMBER);
  const s = at(30, 0), g = under(ground, s, -3.5, 3.5, -3.5, 3.5);
  for (const Kt of [Kn, Kf]) lathe(Kt, s.x, 0, s.z, [{ r: 0, y: g.lo - 0.8, kind: 1 }, { r: 3.2, y: g.lo - 0.8, kind: 1 }, { r: 3.2, y: g.hi + 13, kind: 1 }, { r: 3.4, y: g.hi + 13, kind: 10 }, { r: 2.2, y: g.hi + 14.6, kind: 10 }, { r: 0, y: g.hi + 15.4, kind: 10 }], Kt === Kn ? 20 : 10);
  void R;
}

// ------------------------------------------------------------------ the towns --
function marketHall(Kn, Kf, site, ground) {
  // an open octagonal hall on a stepped plinth: a ring of columns under an entablature and the
  // quarter's roof - shingled on the Harbour Coast, a copper dome on the Gate Coast, a glass
  // dome on the Garden Coast, a stepped stone pyramid in the uplands - a lantern on top; stalls
  // round a fountain inside
  const cx = site.x, cz = site.z, R = site.R;
  let lo = 1e9, hi = -1e9;
  for (let k = 0; k < 24; k++) for (const f of [0, 0.5, 0.8, 1]) { const h = ground(cx + Math.cos((k / 24) * TAU) * (R + 1.7) * f, cz + Math.sin((k / 24) * TAU) * (R + 1.7) * f); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  const top = hi + 0.5;
  const q = site.quarter;
  for (const Kt of [Kn, Kf]) {
    Kt.ringSector(cx, cz, 0, R + 1.6, 0, TAU, lo - 0.8, top - 0.25, K.STONE, K.PAVING, K.STONE, 8);
    Kt.ringSector(cx, cz, 0, R + 0.8, 0, TAU, lo - 0.85, top, K.STONE, K.PAVING, K.STONE, 8);
    Kt.ringSector(cx, cz, R - 1.7, R + 0.3, 0, TAU, top + 6.0, top + 7.3, K.STONE, K.STONE, K.STONE, Kt === Kn ? 32 : 16);
  }
  // the columns
  const nC = 16;
  for (let k = 0; k < nC; k++) {
    const t = (k / nC) * TAU + Math.PI / nC, x = cx + Math.cos(t) * (R - 0.7), z = cz + Math.sin(t) * (R - 0.7);
    lathe(Kn, x, top - 0.05, z, [{ r: 0.55, y: 0, kind: 1 }, { r: 0.55, y: 0.35, kind: 1 }, { r: 0.4, y: 0.45, kind: 1 }, { r: 0.34, y: 5.45, kind: 1 }, { r: 0.52, y: 5.75, kind: 1 }, { r: 0.52, y: 6.1, kind: 1 }], 10);
    if (k % 4 === 0) Kf.box({ x, z, yaw: t }, -0.4, 0.4, top - 0.05, top + 6.05, -0.4, 0.4, K.STONE);
  }
  // the roof (its underside the hall's ceiling), the lantern
  const y0 = top + 7.25, seg = (n) => n;
  let yTop;
  if (q === 'gate') {
    yTop = y0 + 1.6 + R * 0.72 + 3.4;
    for (const Kt of [Kn, Kf]) lathe(Kt, cx, 0, cz, [{ r: R + 0.9, y: y0, kind: 1 }, { r: R + 0.9, y: y0 + 0.5, kind: 1 }, { r: R - 0.4, y: y0 + 0.5, kind: 1 }, { r: R - 0.4, y: y0 + 1.6, kind: 1 },
      ...Array.from({ length: 8 }, (_, i) => { const a = ((i + 1) / 9) * (Math.PI / 2); return { r: (R - 0.4) * Math.cos(a), y: y0 + 1.6 + R * 0.72 * Math.sin(a), kind: 10 }; }),
      { r: 1.3, y: y0 + 1.6 + R * 0.72, kind: 2 }, { r: 1.3, y: yTop - 1.2, kind: 2 }, { r: 1.7, y: yTop - 1.2, kind: 10 }, { r: 0, y: yTop, kind: 10 }], Kt === Kn ? seg(32) : 12);
  } else if (q === 'garden') {
    yTop = y0 + 0.5 + R * 0.8 + 3.2;
    for (const Kt of [Kn, Kf]) lathe(Kt, cx, 0, cz, [{ r: R + 0.9, y: y0, kind: 1 }, { r: R + 0.9, y: y0 + 0.5, kind: 1 }, { r: R - 0.2, y: y0 + 0.5, kind: 1 },
      ...Array.from({ length: 8 }, (_, i) => { const a = ((i + 1) / 9) * (Math.PI / 2); return { r: (R - 0.2) * Math.cos(a), y: y0 + 0.5 + R * 0.8 * Math.sin(a), kind: 0 }; }),
      { r: 1.1, y: y0 + 0.5 + R * 0.8, kind: 2 }, { r: 1.1, y: yTop - 1.0, kind: 2 }, { r: 1.5, y: yTop - 1.0, kind: 10 }, { r: 0, y: yTop, kind: 10 }], Kt === Kn ? seg(32) : 12);
    // bronze ribs over the glass
    for (let k = 0; k < 8; k++) {
      const t = (k / 8) * TAU;
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 7) * (Math.PI / 2), a1 = ((i + 1) / 7) * (Math.PI / 2);
        const r0 = (R - 0.2) * Math.cos(a0), r1 = (R - 0.2) * Math.cos(a1), yA = y0 + 0.5 + R * 0.8 * Math.sin(a0), yB = y0 + 0.5 + R * 0.8 * Math.sin(a1);
        Kn.box({ x: cx, z: cz, yaw: t, y: 0 }, Math.min(r0, r1) - 0.15, Math.max(r0, r1) + 0.12, Math.min(yA, yB) - 0.1, Math.max(yA, yB) + 0.18, -0.09, 0.09, K.METAL);
      }
    }
  } else if (q === 'upland') {
    yTop = y0 + 7.4;
    for (const Kt of [Kn, Kf]) {
      Kt.ringSector(cx, cz, 0, R + 0.9, 0, TAU, y0, y0 + 1.2, K.STONE, K.STONE, K.STONE, 8);
      Kt.ringSector(cx, cz, 0, R * 0.7, 0, TAU, y0 + 1.15, y0 + 2.6, K.STONE, K.STONE, K.STONE, 8);
      Kt.ringSector(cx, cz, 0, R * 0.42, 0, TAU, y0 + 2.55, y0 + 4.0, K.STONE, K.STONE, K.STONE, 8);
      lathe(Kt, cx, 0, cz, [{ r: 1.5, y: y0 + 3.95, kind: 2 }, { r: 1.5, y: y0 + 6.0, kind: 2 }, { r: 1.9, y: y0 + 6.0, kind: 10 }, { r: 0, y: yTop, kind: 10 }], 8);
    }
  } else {
    yTop = y0 + 5.8 + 3.2;
    for (const Kt of [Kn, Kf]) lathe(Kt, cx, 0, cz, [{ r: R + 1.1, y: y0, kind: 8 }, { r: 1.6, y: y0 + 5.8, kind: 8 }, { r: 1.6, y: y0 + 5.8, kind: 2 }, { r: 1.3, y: y0 + 5.8, kind: 2 }, { r: 1.3, y: y0 + 7.8, kind: 2 }, { r: 1.7, y: y0 + 7.8, kind: 10 }, { r: 0, y: yTop, kind: 10 }], 8);
  }
  // inside: a fountain basin and four stalls
  Kn.ringSector(cx, cz, 0, 2.4, 0, TAU, lo - 0.9, top + 0.55, K.STONE, K.WATER, K.STONE, 16);
  for (let k = 0; k < 4; k++) {
    const t = (k / 4) * TAU + Math.PI / 4;
    Kn.box({ x: cx + Math.cos(t) * (R * 0.55), z: cz + Math.sin(t) * (R * 0.55), yaw: t + Math.PI / 2, y: top - 0.02 }, -1.6, 1.6, 0, 1.05, -0.5, 0.5, K.TIMBER);
  }
  void yTop;
}

// ------------------------------------------------------------------ the coasts --
function lighthouse(Kn, Kf, site, ground) {
  const cx = site.x, cz = site.z, H = site.h;
  const lo = site.g.lo, hi = site.g.hi, b = hi + 0.9;
  for (const Kt of [Kn, Kf]) {
    Kt.ringSector(cx, cz, 0, 9.5, 0, TAU, lo - 1.2, b, K.STONE, K.PAVING, K.STONE, 8);
    lathe(Kt, cx, b - 0.05, cz, [{ r: 4.6, y: 0, kind: 1 }, { r: 3.9, y: H * 0.5, kind: 5 }, { r: 3.2, y: H, kind: 1 }, { r: 4.3, y: H, kind: 1 }, { r: 4.3, y: H + 0.6, kind: 1 },
      { r: 2.4, y: H + 0.6, kind: 2 }, { r: 2.4, y: H + 3.8, kind: 2 }, { r: 2.9, y: H + 3.8, kind: 10 }, { r: 1.2, y: H + 5.6, kind: 10 }, { r: 0, y: H + 6.4, kind: 10 }], Kt === Kn ? 28 : 12);
  }
  // the gallery rail, the keeper's house at the tower's foot
  Kn.ringSector(cx, cz, 4.05, 4.25, 0, TAU, b - 0.05 + H + 0.57, b + H + 1.65, K.METAL, K.METAL, K.METAL, 28);
  const ha = site.houseA ?? site.yaw + 1.2;
  house(Kn, Kf, ground, { x: cx + Math.cos(ha) * 16, z: cz + Math.sin(ha) * 16, yaw: ha }, -5, 5, -3.5, 3.5, 3.6, 2.4, K.PUNCHED, K.TIMBER);
}

function seawall(Kn, Kf, site, ground) {
  const P = site.pts;
  // the parapet's coping follows the parade (its landward line); the seaward face runs down to the sand
  const top = P.map(([x, z]) => ground(x, z) + 0.95);
  Kn.strip(P, 0.36, (x, z) => ground(x, z) - 1.6, top, K.STONE, K.STONE);
  const idx = P.map((_, i) => i).filter((i) => i % 3 === 0 || i === P.length - 1);
  if (idx.length >= 2) Kf.strip(idx.map((i) => P[i]), 0.36, (x, z) => ground(x, z) - 1.6, idx.map((i) => top[i]), K.STONE, K.STONE);
}

function lookout(Kn, Kf, site, ground) {
  // a timber platform on four posts under a shingled roof, its stair along the side (+z)
  const o = { x: site.x, z: site.z, yaw: site.yaw };
  const deck = site.g.hi + 4.6;
  for (const [lx, lz] of [[-2.6, -2.6], [2.6, -2.6], [2.6, 2.6], [-2.6, 2.6]]) {
    const [x, z] = localToWorld(o, lx, lz), g = ground(x, z);
    for (const Kt of [Kn, Kf]) Kt.box({ x, z, yaw: site.yaw }, -0.14, 0.14, g - 0.8, deck + 3.22, -0.14, 0.14, K.TIMBER);
  }
  for (const Kt of [Kn, Kf]) {
    Kt.box(o, -3.1, 3.1, deck - 0.3, deck, -3.1, 3.1, K.TIMBER);
    Kt.gable(o, -3.4, 3.4, -3.4, 3.4, deck + 3.2, deck + 4.6, K.TIMBER);
  }
  // rails on the post lines, open where the stair arrives (+z, x < 1.3)
  Kn.box(o, -2.6, 2.6, deck + 0.95, deck + 1.07, -2.65, -2.55, K.TIMBER);
  Kn.box(o, -2.65, -2.55, deck + 0.95, deck + 1.07, -2.6, 2.6, K.TIMBER);
  Kn.box(o, 2.55, 2.65, deck + 0.95, deck + 1.07, -2.6, 2.6, K.TIMBER);
  Kn.box(o, 1.3, 2.6, deck + 0.95, deck + 1.07, 2.55, 2.65, K.TIMBER);
  // the stair: a flight of solid steps from the deck's +z edge down along +z to the ground
  const rs = 0.19, run = 0.27, z0 = 3.1;
  const gAt = (z) => Math.max(...[-1.2, 0, 1.2].map((lx) => ground(...localToWorld(o, lx, z))));
  const gLo = (z) => Math.min(...[-1.2, 0, 1.2].map((lx) => ground(...localToWorld(o, lx, z))));
  for (let n = 1; n < 60; n++) {
    const y = deck - n * rs, za = z0 + (n - 1) * run, zb = za + run;
    if (y < Math.max(gAt(za), gAt(zb)) + 0.06) break;
    const foot = Math.min(gLo(za), gLo(zb)) - 0.6;
    for (const Kt of [Kn, Kf]) Kt.box(o, -1.2 + n * 0.0007, 1.2 - n * 0.0007, foot, y, za - (n > 1 ? 0.02 : 0), zb, K.TIMBER, K.TIMBER);
  }
}

function beachHuts(Kn, Kf, site, ground) {
  const R = mulberry32(Math.floor(site.seed * 1e6) + 5);
  for (const h of site.huts) {
    const o = { x: h.x, z: h.z, yaw: site.yaw };
    const b = h.g.hi + 0.35;
    const kW = R() < 0.5 ? K.TIMBER : K.STONE;
    for (const Kt of [Kn, Kf]) {
      Kt.box(o, -1.3, 1.3, h.g.lo - 0.5, b, -1.2, 1.2, K.TIMBER);
      Kt.box(o, -1.15, 1.15, b, b + 2.1, -1.05, 1.05, kW, K.TIMBER);
      Kt.gable({ ...o, yaw: site.yaw + Math.PI / 2 }, -1.3, 1.3, -1.3, 1.3, b + 2.08, b + 3.0, K.TIMBER);
    }
  }
}

function boathouse(Kn, Kf, site, ground) {
  const o = { x: site.x, z: site.z, yaw: site.yaw };
  house(Kn, Kf, ground, o, -9, 9, -5.5, 5.5, 5.0, 3.6, K.TIMBER, K.TIMBER, { eave: 0.6 });
  // the slipway from its doors into the water
  const P = [];
  for (let t = 9.2; t <= 32; t += 2) P.push(localToWorld(o, t, 0));
  const yT = (x, z) => Math.max(ground(x, z) + 0.12, -0.6), yB = (x, z) => Math.min(ground(x, z), -0.6) - 0.6;
  Kn.strip(P, 2.4, yB, yT, K.STONE, K.PAVING);
  Kf.strip(P.filter((_, i) => i % 3 === 0 || i === P.length - 1), 2.4, yB, yT, K.STONE, K.PAVING);
}

function lido(Kn, Kf, site, ground) {
  const o = { x: site.x, z: site.z, yaw: site.yaw };
  const u = under(ground, o, -30, 30, -13, 13);
  const top = u.hi + 0.35, foot = Math.min(u.lo, 0) - 1.2;
  const ww = top - 0.22;
  for (const Kt of [Kn, Kf]) {
    // the deck round a pool hole (x -24..16, z -8..7)
    Kt.box(o, -30, 30, foot, top, -13, -8, K.STONE, K.PAVING);
    Kt.box(o, -30, 30, foot, top, 7, 13, K.STONE, K.PAVING);
    Kt.box(o, -30, -24, foot - 0.05, top, -8.05, 7.05, K.STONE, K.PAVING);
    Kt.box(o, 16, 30, foot - 0.05, top, -8.05, 7.05, K.STONE, K.PAVING);
    // two pools divided by a stone walk
    Kt.box(o, -3.5, -1.5, foot - 0.1, top, -8.1, 7.1, K.STONE, K.PAVING);
    Kt.box(o, -23.98, -3.52, foot, ww, -7.98, 6.98, K.WATER, K.WATER, K.STONE);
    Kt.box(o, -1.48, 15.98, foot, ww, -7.98, 6.98, K.WATER, K.WATER, K.STONE);
    // the pavilion at the end: a colonnaded hall under a flat roof
    Kt.box(o, 19, 29, top, top + 4.2, -11, 11, K.PUNCHED, K.STONE);
    Kt.box(o, 17.2, 29.6, top + 4.2, top + 4.8, -12.2, 12.2, K.STONE, K.GARDEN);
  }
  for (let z = -10.5; z <= 10.5; z += 3.5) Kn.box(o, 17.6, 18.2, top - 0.02, top + 4.22, z - 0.3, z + 0.3, K.STONE);
  // the diving stage at the deep end
  Kn.box(o, -28.6, -27.4, top - 0.02, top + 5.2, -3, -1.8, K.STONE); Kn.box(o, -28.6, -27.4, top - 0.02, top + 5.2, 1.8, 3, K.STONE);
  Kn.box(o, -29, -22.4, top + 2.9, top + 3.1, -3.1, 3.1, K.STONE, K.PAVING);
  Kn.box(o, -29, -24.6, top + 5.2, top + 5.4, -3.1, 3.1, K.STONE, K.PAVING);
}

function stop(Kn, Kf, site, ground) {
  const o = { x: site.x, z: site.z, yaw: site.yaw };
  const u = site.g, b = u.hi + 0.12;
  // the shelter's back toward the verge (-side), its canopy over the kerb side
  const back = site.side * 1.2;
  for (const Kt of [Kn, Kf]) {
    Kt.box(o, -4.2, 4.2, u.lo - 0.4, b, -1.5, 1.5, K.STONE, K.PAVING);
    Kt.box(o, -4.4, 4.4, b + 2.9, b + 3.12, -1.7, 1.7, K.STONE, K.STONE);
  }
  Kn.box(o, -3.9, 3.9, b - 0.02, b + 2.9, back - 0.06, back + 0.06, K.FRIT, K.METAL, K.METAL);
  Kf.box(o, -3.9, 3.9, b - 0.02, b + 2.95, back - 0.08, back + 0.08, K.METAL);
  for (const x of [-3.9, 0, 3.9]) Kn.box(o, x - 0.1, x + 0.1, b - 0.02, b + 2.92, back - 0.1 * Math.sign(back) - 0.1, back - 0.1 * Math.sign(back) + 0.1, K.METAL);
  Kn.box(o, -3, 3, b - 0.02, b + 0.46, back - Math.sign(back) * 0.75 - 0.25, back - Math.sign(back) * 0.75 + 0.25, K.TIMBER);
  // the stop's stele with its lantern
  Kn.box(o, 4.6, 4.9, u.lo - 0.4, b + 3.4, -0.15, 0.15, K.METAL);
  Kn.box(o, 4.5, 5.0, b + 3.4, b + 3.9, -0.25, 0.25, K.LANTERN, K.METAL, K.METAL);
}

export const STRUCTURES = { marketHall, vineyard, market: marketGarden, glasshouse, packhouse, hedgerow, allotments, sports, amphitheatre, observatory, botanical, memorial, hamlet, lighthouse, seawall, lookout, beachHuts, boathouse, lido, stop };
