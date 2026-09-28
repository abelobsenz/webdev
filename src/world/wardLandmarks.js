import * as THREE from 'three';
import { Builder, KIND as K, rrect } from './buildings.js';
import { latheFacade, sweepTube, mergeClean } from './geom.js';
import { createFacadeMaterial, createLowriseMaterial } from './facade.js';
import { patchedMaterial } from './materials.js';
import { sweepLoop } from './platform.js';
import { inArc } from './wards.js';
import { U } from '../core/uniforms.js';
import { marinersLantern, voyageHall } from './wardLandmarksB.js';

// The signature places of the Outer Wards and the furniture of their waterfronts: the Great
// Observatory, the Tidehall, the heliostat field and the Heliodrome, the Cascade, the harbour
// with its ships, cranes, terminal and lighthouses, the half-drowned domes of the reef lagoon,
// the Opera Shell, the amphitheatre and the triumphal arch; bridges over every canal, kerbs
// round every pool, pontoons and moored boats in every marina.
// Buildings are built twice (near: full detail; far: massing) like the towns.

const TAU = Math.PI * 2;
const QY = 3, TOP = 9;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Two offset skins joined on every boundary: a genuinely closed architectural shell. */
export function closedWardSurface(nu, nv, fn, thickness, front = K.STONE, back = front) {
  const pos = [], fac = [], idx = [], cols = nu + 1, count = cols * (nv + 1);
  for (const side of [1, -1]) for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv, p = fn(u, v);
    const du = fn(Math.min(1, u + 0.001), v).sub(fn(Math.max(0, u - 0.001), v));
    const dv = fn(u, Math.min(1, v + 0.001)).sub(fn(u, Math.max(0, v - 0.001)));
    const n = du.cross(dv);
    if (n.lengthSq() < 1e-16) n.set(0, 1, 0); else n.normalize();
    p.addScaledVector(n, side * thickness / 2);
    pos.push(p.x, p.y, p.z); fac.push(u * 100, v * 100, side > 0 ? front : back);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, b, c, b, d, c, a + count, c + count, b + count, b + count, c + count, d + count);
  }
  const rim = (a, b) => idx.push(a, b, a + count, b, b + count, a + count);
  for (let i = 0; i < nu; i++) { rim(i + 1, i); rim(nv * cols + i, nv * cols + i + 1); }
  for (let j = 0; j < nv; j++) { rim(j * cols, (j + 1) * cols); rim((j + 1) * cols + nu, j * cols + nu); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function wardCourt(B, parts, L, lod) {
  const { x, z, y, rot, theme, r } = L;
  B.frame(x, y, z, rot);
  const W = (u, yy, v) => V(x + u * Math.cos(rot) + v * Math.sin(rot), y + yy, z - u * Math.sin(rot) + v * Math.cos(rot));
  B.lathe(0, 0, [[r - 4, -0.4, K.STONE], [r - 4, 0.3, K.STONE], [r - 5, 0.65, K.PAVING], [0, 0.65, K.PAVING]], lod ? 24 : 48);
  for (let k = 0; k < 4; k++) B.box(-4.5, 4.5, r - 8 + k * 1.1, r - 6.8 + k * 1.1, -0.35, 0.65 - k * 0.16, K.STONE, K.PAVING);
  const column = (cx, cz, h = 7, scale = 1) => B.lathe(cx, cz, [[0.85 * scale, 0.65, K.STONE], [0.85 * scale, 1, K.STONE], [0.58 * scale, 1.3, K.STONE], [0.48 * scale, h, K.STONE], [0.85 * scale, h + 0.45, K.STONE]], lod ? 6 : 10);
  if (theme === 'astronomy') {
    for (const s of [-1, 1]) {
      B.box(s * 17 - 6.5, s * 17 + 6.5, -20, 7, 0.65, 7, K.PUNCHED, K.STONE);
      B.vault(s * 17 - 7, s * 17 + 7, -20.5, 7.5, 7, 4.5, K.FRIT, lod ? 6 : 12);
      B.box(s * 17 - 3, s * 17 + 3, 7, 10, 0.65, 4.5, K.GLASS, K.METAL);
    }
    const p = W(0, 0.65, 4);
    if (!lod) armillary(parts, p.x, p.y, p.z, 9);
    else B.lathe(0, 4, [[3, 0.65, K.STONE], [2, 3.5, K.STONE], [0.2, 20, K.METAL]], 8);
    for (const s of [-1, 1]) B.box(s * 12 - 3.5, s * 12 + 3.5, 17, 18.5, 0.65, 1.6, K.STONE, K.METAL);
  } else if (theme === 'tidal') {
    for (const cx of [-18, 0, 18]) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) column(cx + sx * 8.3, sz * 11, 7.5, 0.7);
      B.vaultZ(cx - 8.3, cx + 8.3, -13, 13, 7.95, 4.6, K.STONE, lod ? 6 : 12);
      B.box(cx - 6, cx + 6, -10.5, -8.5, 0.65, 5.5, K.FRIT, K.STONE);
    }
    for (const sx of [-1, 1]) {
      B.lathe(sx * 23, 20, [[2.4, 0.65, K.STONE], [2.4, 1.2, K.METAL], [1.8, 1.2, K.POOL], [1.8, 1.35, K.POOL], [0, 1.35, K.POOL]], 20);
      B.lathe(sx * 23, 20, [[0.45, 1.35, K.METAL], [0.3, 6.5, K.METAL], [0.5, 6.8, K.LANTERN]], 8);
    }
  } else if (theme === 'solar') {
    B.box(-24, 24, -17, 7, 0.65, 7.2, K.PUNCHED, K.STONE);
    for (let i = 0; i < 6; i++) {
      const xx = -24 + i * 8;
      B.vprism([[xx, 7.2], [xx + 8, 7.2], [xx + 8, 7.8], [xx + 1, 11.5], [xx, 11.5]], -17.5, 7.5, K.PV, K.METAL);
    }
    for (const sx of [-1, 1]) for (const zz of [12, 20]) {
      column(sx * 19, zz, 3.6);
      B.box(sx * 19 - 4, sx * 19 + 4, zz - 2.6, zz + 2.6, 4.04, 4.45, K.METAL, K.PV);
    }
    B.box(-7, 7, 7, 12, 0.65, 5.4, K.GLASS, K.STONE);
  } else if (theme === 'garden') {
    for (let k = 0; k < 8; k++) { const a = (k + 0.5) * TAU / 8; column(Math.cos(a) * 20.5, Math.sin(a) * 20.5, 7); }
    B.lathe(0, 0, [[22, 7.4, K.STONE], [22, 8.2, K.GARDEN], [18.8, 8.2, K.GARDEN], [18.8, 7.4, K.STONE]], lod ? 24 : 48, 0, { closedProfile: true });
    if (!lod) for (let k = -4; k <= 4; k++) {
      const xx = k * 3.4, reach = Math.sqrt(18.5 * 18.5 - xx * xx);
      B.box(xx - 0.14, xx + 0.14, -reach, reach, 7.8, 8.12, K.TIMBER, K.TIMBER);
    }
    B.lathe(0, 0, [[6.5, 0.65, K.STONE], [6.5, 1.2, K.STONE], [5.8, 1.2, K.POOL], [5.8, 0.9, K.POOL], [0, 0.9, K.POOL]], 32);
    for (const sx of [-1, 1]) B.box(sx * 13 - 3, sx * 13 + 3, -2, 2, 0.65, 1.65, K.STONE, K.GARDEN);
  } else if (theme === 'harbour') {
    B.box(-29, 29, -20, 9, 0.65, 10.5, K.PUNCHED, K.STONE);
    for (const sx of [-1, 1]) B.vault(sx * 14.5 - 14.5, sx * 14.5 + 14.5, -20.6, 9.6, 10.5, 5, K.METAL, lod ? 6 : 12);
    for (const cx of [-22, -13.2, -4.4, 4.4, 13.2, 22]) column(cx, 21, 6.6);
    B.box(-27, 27, 9, 22, 7.05, 7.65, K.STONE, K.GARDEN);
    B.box(-4, 4, -7, 1, 14, 20, K.LANTERN, K.METAL);
    for (const sx of [-1, 1]) B.box(sx * 33 - 2, sx * 33 + 2, -5, 7, 0.65, 1.25, K.STONE, K.PAVING);
  } else if (theme === 'reef') {
    for (const [cx, cz, rr, h] of [[0, -8, 13, 16], [-19, 5, 8, 10], [19, 5, 8, 10]]) {
      const prof = [[rr + 1.1, 0.65, K.STONE], [rr + 1.1, 1.2, K.STONE], [rr, 1.2, K.GLASS], [rr, 4.5, K.GLASS]];
      for (let i = 1; i <= 10; i++) { const a = i * Math.PI / 20; prof.push([Math.max(0, Math.cos(a) * rr), 4.5 + Math.sin(a) * h, K.FRIT]); }
      B.lathe(cx, cz, prof, lod ? 16 : 32);
      if (!lod) for (let k = 0; k < 8; k++) {
        const a = k * TAU / 8, rib = [];
        for (let i = 0; i <= 12; i++) { const t = i * Math.PI / 24; rib.push(W(cx + Math.cos(a) * (Math.cos(t) * rr + 0.25), 4.5 + Math.sin(t) * h + 0.15, cz + Math.sin(a) * (Math.cos(t) * rr + 0.25))); }
        parts.push(sweepTube(rib, () => 0.3, 6, { kind: K.STONE }));
      }
    }
    B.box(-6, 6, 5, 18, 0.65, 5, K.GLASS, K.STONE);
  } else {
    // The sculptors' loggia: an open colonnade embracing a civic bronze, with
    // low exhibition walls that preserve views of the larger Civic Crown.
    for (const sx of [-1, 1]) {
      for (const zz of [-18, -9, 0, 9]) column(sx * 22, zz, 8);
      B.box(sx * 22 - 3, sx * 22 + 3, -21, 12, 8.45, 9.3, K.STONE, K.STONE);
      B.box(sx * 29 - 1, sx * 29 + 1, -19, 8, 0.65, 3, K.STONE, K.STONE);
    }
    B.box(-25, 25, -21, -16, 8.45, 9.3, K.STONE, K.STONE);
    B.lathe(0, 0, [[5, 0.65, K.STONE], [5, 1.7, K.STONE], [3.5, 1.7, K.STONE], [3.5, 2.7, K.STONE]], 24);
    if (!lod) {
      const p = W(0, 10.8, 0), ring = [];
      for (let k = 0; k <= 48; k++) { const a = k * TAU / 48; ring.push(W(Math.cos(a) * 8, 10.8 + Math.sin(a) * 8, Math.sin(a) * 2)); }
      parts.push(sweepTube(ring, () => 0.8, 8, { kind: K.METAL }));
      parts.push(sweepTube([W(0, 2.7, 0), p], () => 0.7, 8, { kind: K.METAL }));
    } else B.lathe(0, 0, [[1, 2.7, K.METAL], [1, 19, K.METAL]], 8);
  }
  B.frame(0, 0, 0, 0);
}

/** Longest run of loop vertices with bearing in [a0, a1] (from the ward centre). */
function span(loop, a0, a1) {
  const n = loop.length;
  const ok = loop.map((p) => inArc(Math.atan2(p[1], p[0]), a0, a1));
  let best = null;
  for (let k = 0; k < n; k++) {
    if (!ok[k] || ok[(k - 1 + n) % n]) continue;
    let m = 0;
    while (m < n && ok[(k + m) % n]) m++;
    if (!best || m > best.m) best = { k, m };
  }
  if (!best) return null;
  const pts = [];
  for (let i = 0; i < best.m; i++) pts.push(loop[(best.k + i) % n]);
  return pts;
}
const largest = (loops) => loops.reduce((b, l) => { let a = 0; for (let i = 0; i < l.length; i++) { const q = l[(i + 1) % l.length]; a += l[i][0] * q[1] - q[0] * l[i][1]; } return a > (b ? b.a : -1e18) ? { l, a } : b; }, null)?.l;

// ------------------------------------------------------------------ ships --
/** A moored sea-ship (or research vessel): a lofted hull, decks, a superstructure, a mast. */
export function shipHullGeometry(len, beam, big = false) {
  const n = 18, m = 10, cols = m + 1;
  const deckY = big ? 9 : 5, keel = big ? -6 : -3.5;
  const pos = [], fac = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, lx = -len / 2 + len * u;
    const bow = Math.max(0, (u - 0.72) / 0.28), stern = Math.max(0, (0.1 - u) / 0.1);
    const half = (beam / 2) * Math.sqrt(Math.max(0.02, 1 - bow * bow)) * (1 - 0.25 * stern);
    const sheer = deckY + 1.6 * bow * bow + 0.6 * stern;
    for (let j = 0; j <= m; j++) {
      const a = Math.PI * j / m, lz = -Math.cos(a) * half;
      const y = sheer + (keel - sheer) * Math.pow(Math.sin(a), 0.6) * (1 - 0.4 * bow);
      pos.push(lx, y, lz); fac.push(lx, y, y > 0.4 ? K.STONE : K.METAL);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) { const a = i * cols + j, b = a + 1, c = a + cols; idx.push(a, c, b, b, c, c + 1); }
    // The deck follows both the sheer and the actual beam, closing the entire hull.
    const p = i * cols, q = p + cols;
    idx.push(p, p + m, q + m, p, q + m, q);
  }
  for (const i of [0, n]) {
    const start = i * cols, center = pos.length / 3, want = i === 0 ? -1 : 1;
    let yy = 0, zz = 0;
    for (let j = 0; j <= m; j++) { yy += pos[(start + j) * 3 + 1]; zz += pos[(start + j) * 3 + 2]; }
    pos.push(pos[start * 3], yy / cols, zz / cols); fac.push(0, yy / cols, K.STONE);
    for (let j = 0; j <= m; j++) {
      const a = start + j, b = start + (j + 1) % cols;
      const ay = pos[a * 3 + 1] - pos[center * 3 + 1], az = pos[a * 3 + 2] - pos[center * 3 + 2];
      const by = pos[b * 3 + 1] - pos[center * 3 + 1], bz = pos[b * 3 + 2] - pos[center * 3 + 2];
      if ((ay * bz - az * by) * want >= 0) idx.push(center, a, b); else idx.push(center, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function ship(B, parts, x, z, rot, len, beam, rnd, big) {
  if (parts) parts.push(shipHullGeometry(len, beam, big).rotateY(-rot).translate(x, 0, z));
  shipTop(B, x, z, rot, len, beam, big ? 9 : 5, big);
  void rnd;
}
function shipTop(B, x, z, rot, len, beam, deckY, big) {
  // deck, superstructure aft of midships, a funnel and a mast
  B.frame(x, 0, z, -rot + Math.PI / 2);
  const dw = beam * 0.92;
  B.box(-dw / 2, dw / 2, -len * 0.4, len * 0.34, deckY - 0.25, deckY + 0.08, K.METAL, K.PAVING);
  const sl = len * (big ? 0.28 : 0.34);
  const s0 = -len * 0.26;
  const tiers = big ? 4 : 2;
  for (let k = 0; k < tiers; k++) {
    const ww = dw * (0.86 - k * 0.1), ll = sl * (1 - k * 0.14);
    B.box(-ww / 2, ww / 2, s0 - ll / 2, s0 + ll / 2, deckY + k * 3, deckY + (k + 1) * 3, K.GLASS, K.STONE);
  }
  B.lathe(0, s0 - sl * 0.1, [[2.6, deckY + tiers * 3, K.STONE], [2.2, deckY + tiers * 3 + 7, K.STONE], [2.5, deckY + tiers * 3 + 7.5, K.METAL]], 10);
  B.lathe(0, s0 + sl * 0.4, [[0.4, deckY + tiers * 3, K.METAL], [0.25, deckY + tiers * 3 + 16, K.METAL], [0.4, deckY + tiers * 3 + 16.6, K.LANTERN]], 6);
}

// ---------------------------------------------------------------- builders --
function observatory(B, parts, L, oy) {
  const { x, z, r } = L;
  B.frame(x, oy, z, 0);
  // a stepped circular terrace, the drum, the great dome with its slit and shutter rails
  B.lathe(0, 0, [[r + 16, -0.5, K.STONE], [r + 16, 0.6, K.STONE], [r + 12, 0.6, K.PAVING], [r + 12, 1.4, K.STONE], [r + 8, 1.4, K.PAVING], [r + 8, 2.2, K.STONE], [r + 4, 2.2, K.PAVING]], 64);
  B.lathe(0, 0, [[r + 1.2, 2.2, K.STONE], [r + 1.2, 3.4, K.STONE], [r, 3.4, K.PUNCHED], [r, 20, K.PUNCHED], [r + 1.5, 20.6, K.STONE], [r + 1.5, 22, K.STONE]], 64);
  // Twin public flights flank the meridian arch's southern footing. Their
  // 20 cm risers cross every podium ledge and meet the drum threshold.
  for (const sx of [-1, 1]) for (let i = 0; i < 17; i++) {
    const z0 = r + 1.2 + i * 18.8 / 17, z1 = r + 1.2 + (i + 1) * 18.8 / 17;
    B.box(sx * 5.5 - 2.3, sx * 5.5 + 2.3, i === 0 ? r - .8 : z0, z1, -.5, 3.4 - i * .2, K.STONE, K.PAVING);
  }
  const prof = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * (Math.PI / 2); prof.push([(r + 0.8) * Math.cos(a) + 0.05, 22 + (r + 0.8) * Math.sin(a), K.STONE]); }
  B.lathe(0, 0, prof, 64);
  const w = new THREE.Vector3(x, oy, z);
  for (const off of [-2.6, 2.6]) {
    const arc = [];
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI; arc.push(w.clone().add(V(Math.cos(a) * (r + 1.4), 22 + Math.sin(a) * (r + 1.4), off))); }
    parts.push(sweepTube(arc, () => 0.55, 6, { kind: 10 }));
  }
  // the slit: a dark band of shutters between the rails
  const slit = [];
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 0.5 + Math.PI * 0.25; slit.push(w.clone().add(V(Math.cos(a) * (r + 1.0), 22 + Math.sin(a) * (r + 1.0), 0))); }
  parts.push(sweepTube(slit, () => 2.0, 6, { kind: 10, ellipse: 0.25 }));
  // four smaller domes on towers round the terrace, and a meridian arc over the entrance
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    const cx = Math.cos(a) * (r + 30), cz = Math.sin(a) * (r + 30);
    B.lathe(cx, cz, [[6.5, -0.5, K.STONE], [6.5, 12, K.PUNCHED], [7.2, 12.4, K.STONE], [7.2, 13, K.STONE], [6.6, 13, K.STONE], [5.2, 17.5, K.STONE], [2.8, 19.5, K.STONE], [0.1, 20, K.STONE]], 24);
  }
  const arc = [];
  for (let i = 0; i <= 32; i++) { const a = (i / 32) * Math.PI; arc.push(w.clone().add(V(0, 2 + Math.sin(a) * (r + 22), Math.cos(a) * (r + 22)))); }
  parts.push(sweepTube(arc, () => 0.9, 8, { kind: 10 }));
  for (const side of [-1, 1]) B.lathe(0, side * (r + 22), [[1.6, -.5, K.STONE], [1.6, .25, K.STONE], [1.1, .25, K.STONE], [1.1, 2.1, K.STONE]], 12);
  B.frame(0, 0, 0, 0);
}

function planetarium(B, parts, L, y) {
  const { x, z, r } = L;
  B.frame(x, y, z, 0);
  B.lathe(0, 0, [[r + 10, -0.6, K.STONE], [r + 10, 0.6, K.STONE], [r + 7, 0.6, K.PAVING], [r + 6.5, 1.2, K.STONE]], 48);
  const c = r + 7;
  const prof = [];
  for (let i = 0; i <= 18; i++) { const a = -Math.PI / 2 + (i / 18) * Math.PI; prof.push([Math.max(0.05, r * Math.cos(a)), c + r * Math.sin(a), i > 9 ? K.GLASS : K.FRIT]); }
  B.lathe(0, 0, prof, 48);
  // eight arched legs carrying the sphere
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    const foot = V(x + Math.cos(a) * (r + 5), y + 0.6, z + Math.sin(a) * (r + 5));
    const top = V(x + Math.cos(a) * r * 0.72, y + c - r * 0.55, z + Math.sin(a) * r * 0.72);
    parts.push(sweepTube([foot, foot.clone().lerp(top, 0.5).add(V(Math.cos(a) * 3, 0, Math.sin(a) * 3)), top], () => 1.1, 8, { kind: 1 }));
  }
  // an equator of light
  const eq = [];
  for (let i = 0; i <= 64; i++) { const a = (i / 64) * TAU; eq.push(V(x + Math.cos(a) * (r + 0.4), y + c, z + Math.sin(a) * (r + 0.4))); }
  parts.push(sweepTube(eq, () => 0.5, 5, { kind: 2 }));
  B.frame(0, 0, 0, 0);
}

function armillary(parts, x, y, z, r) {
  const c = V(x, y + r + 4, z);
  const ring = (ax, tilt, rr, t) => {
    const pts = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * TAU;
      pts.push(V(Math.cos(a) * rr, Math.sin(a) * rr, 0).applyAxisAngle(V(0, 1, 0), ax).applyAxisAngle(V(1, 0, 0), tilt).add(c));
    }
    parts.push(sweepTube(pts, () => t, 6, { kind: 10 }));
  };
  ring(0, 0, r, 0.35); ring(Math.PI / 2, 0, r, 0.35); ring(0, Math.PI / 2, r, 0.35);
  ring(0, Math.PI / 2 - 0.41, r * 0.93, 0.8); ring(Math.PI / 4, 0.3, r * 0.8, 0.25);
  parts.push(sweepTube([c.clone().add(V(0, -r - 4, 0)), c.clone().add(V(0, r + 3, 0))], () => 0.3, 6, { kind: 10 }));
  parts.push(latheFacade([{ r: 5, y: 0, kind: 1 }, { r: 5, y: 1.2, kind: 1 }, { r: 2.4, y: 1.2, kind: 1 }, { r: 1.2, y: 3.5, kind: 1 }], 24).translate(x, y, z));
  parts.push(latheFacade([{ r: 0.01, y: -1.6, kind: 2 }, { r: 1.6, y: 0, kind: 2 }, { r: 0.01, y: 1.6, kind: 2 }], 12).translate(c.x, c.y, c.z));
}

function library(B, L, y, lod) {
  const { x, z, w, d } = L;
  B.frame(x, y, z, Math.PI);          // its colonnade faces north, onto the forecourt
  B.prism(rrect(w + 4, d + 4, 0.5), -0.5, 1.4, K.STONE, K.PAVING);
  B.box(-w / 2, w / 2, -d / 2, d / 2 - 6, 1.4, 17, K.PUNCHED, K.STONE);
  B.box(-w / 2 - 0.6, w / 2 + 0.6, -d / 2 - 0.6, d / 2 - 5.4, 17, 18.2, K.STONE, K.STONE, { bottom: true });
  // clerestory along the ridge and a central drum and dome
  B.box(-w / 2 + 6, w / 2 - 6, -d / 4, d / 4 - 3, 18.2, 22, K.GLASS, K.STONE);
  B.lathe(0, -3, [[15, 18.2, K.STONE], [14, 18.2, K.PUNCHED], [14, 25, K.PUNCHED], [15, 25.4, K.STONE]], lod ? 16 : 32);
  const prof = [];
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2) * 0.94; prof.push([14.4 * Math.cos(a), 25.4 + 13 * Math.sin(a), K.GLASS]); }
  B.lathe(0, -3, prof, lod ? 16 : 32);
  B.lathe(0, -3, [[1.6, 38.3, K.LANTERN], [1.1, 41, K.LANTERN], [0.05, 42, K.STONE]], 10);
  for (let k = 0; k < 7; k++) B.box(-18, 18, d / 2 + 2 + k * .4, d / 2 + 2 + (k + 1) * .4, -.5, 1.4 - k * .2, K.STONE, K.PAVING);
  if (lod) {
    B.box(-w / 2, -3.5, d / 2 - 6, d / 2, 1.4, 17, K.STONE, K.STONE);
    B.box(3.5, w / 2, d / 2 - 6, d / 2, 1.4, 17, K.STONE, K.STONE);
    return;
  }
  // the colonnade and its entablature
  const n = Math.floor(w / 5);
  for (let i = 0; i <= n; i++) {
    const cx = -w / 2 + 1 + (i * (w - 2)) / n;
    if (Math.abs(cx) < 3.5) continue;
    B.lathe(cx, d / 2 - 1.5, [[0.8, 1.4, K.STONE], [0.68, 2.0, K.STONE], [0.56, 15, K.STONE], [0.85, 15.6, K.STONE]], 12);
  }
  B.box(-w / 2, w / 2, d / 2 - 2.6, d / 2 - 0.4, 15.6, 17, K.STONE, K.STONE, { bottom: true });
}

function campanile(B, L, y, lod) {
  const { x, z, h, s } = L;
  B.frame(x, y, z, 0.3);
  B.box(-s / 2 - 0.8, s / 2 + 0.8, -s / 2 - 0.8, s / 2 + 0.8, -0.5, 3, K.STONE, K.PAVING);
  B.box(-s / 2, s / 2, -s / 2, s / 2, 3, h * 0.72, K.PUNCHED, K.STONE);
  B.box(-s / 2 - 0.5, s / 2 + 0.5, -s / 2 - 0.5, s / 2 + 0.5, h * 0.72, h * 0.72 + 1, K.STONE, K.STONE, { bottom: true });
  B.box(-s / 2 + 0.4, s / 2 - 0.4, -s / 2 + 0.4, s / 2 - 0.4, h * 0.72 + 1, h * 0.84, K.LANTERN, K.STONE);
  if (!lod) for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box(cx * (s / 2 - 0.3) - 0.5, cx * (s / 2 - 0.3) + 0.5, cz * (s / 2 - 0.3) - 0.5, cz * (s / 2 - 0.3) + 0.5, h * 0.72 + 1, h * 0.84, K.STONE, K.STONE);
  B.box(-s / 2 - 0.4, s / 2 + 0.4, -s / 2 - 0.4, s / 2 + 0.4, h * 0.84, h * 0.86, K.STONE, K.STONE, { bottom: true });
  B.frustum(s * 0.9, s * 0.9, 0.3, 0.3, h * 0.86, h, K.METAL);
  B.lathe(0, 0, [[0.4, h, K.LANTERN], [0.2, h + 3, K.LANTERN], [0.05, h + 3.4, K.LANTERN]], 6);
}

function heliodrome(B, parts, L, y, lod) {
  const { x, z, rot, s } = L;
  B.frame(x, y, z, -rot + Math.PI / 2);
  // five tiers of golden stone with a stair up every face; each tier carries a moulded
  // cornice and a rhythm of pilasters so the faces read as masonry, not as slabs
  const tiers = 5, th = 7, sw = 7;
  for (let k = 0; k < tiers; k++) {
    const w = s - k * 16, t = (k + 1) * th;
    B.prism(rrect(w, w, 1.5), -0.5 + k * th, t, K.STONE, K.PAVING);
    if (lod) continue;
    // The four public stairs pass through every tier's rail. Keep real gaps
    // instead of running a continuous parapet through the climbing route.
    for (let f = 0; f < 4; f++) {
      B.frame(x, y, z, -rot + Math.PI / 2 + f * Math.PI / 2);
      for (const side of [-1, 1]) {
        const a = side < 0 ? -w / 2 + .6 : sw + 1.4, b = side < 0 ? -sw - 1.4 : w / 2 - .6;
        if (b > a) B.box(a, b, w / 2 - .9, w / 2 - .62, t, t + .9, K.STONE, K.STONE);
      }
    }
    B.frame(x, y, z, -rot + Math.PI / 2);
    B.prism(rrect(w + 1.0, w + 1.0, 2.0), t - 1.3, t - 0.35, K.STONE, K.STONE, { bottom: true });
    const y0 = k === 0 ? -0.5 : k * th;
    for (let f = 0; f < 4; f++) {
      B.frame(x, y, z, -rot + Math.PI / 2 + (f * Math.PI) / 2);
      for (let u = -w / 2 + 5; u <= w / 2 - 5 + 1e-6; u += 8) {
        if (Math.abs(u) < sw + 3) continue;
        B.box(u - 0.7, u + 0.7, w / 2 - 0.2, w / 2 + 0.5, y0, t - 1.3, K.STONE, K.STONE);
      }
    }
    B.frame(x, y, z, -rot + Math.PI / 2);
  }
  const rTop = (s - (tiers - 1) * 16) / 2;
  for (let f = 0; f < 4; f++) {
    const a = (f / 4) * TAU;
    const c = Math.cos(a), sn = Math.sin(a);
    const P = (u, v) => [u * sn + v * c, -u * c + v * sn];
    // the stair: a ramp of steps from the plaza to the summit, between stepped cheek walls
    const n = 140; // 25 cm rise and 31 cm tread, retained in both LODs.
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const r0 = s / 2 + 12 - t0 * (s / 2 + 12 - rTop), r1 = s / 2 + 12 - t1 * (s / 2 + 12 - rTop);
      const y1 = t1 * tiers * th;
      B.prism([P(-sw, r0), P(sw, r0), P(sw, r1), P(-sw, r1)], -0.5, y1, K.STONE, K.PAVING);
      if (!lod) for (const e of [-1, 1]) B.prism([P(e * sw, r0), P(e * (sw + 1.2), r0), P(e * (sw + 1.2), r1), P(e * sw, r1)], -0.5, y1 + 1.0, K.STONE, K.STONE);
    }
  }
  // the golden sun on a ring of columns, the ring kept inside the summit terrace
  const top = tiers * th;
  const sr = s * 0.16, rr = rTop - 2.5, er = rr + 1.6, cH = sr * 0.9, eTop = top + sr * 1.2;
  const n = 12;
  B.lathe(0, 0, [[rTop - .1, top - .3, K.STONE], [rTop - .1, top + .2, K.STONE], [er + .5, top + .2, K.PAVING], [er + .5, top + .4, K.STONE], [er, top + .4, K.PAVING], [er, top + .6, K.STONE], [.1, top + .6, K.PAVING]], 32);
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n) * TAU;
    B.lathe(Math.cos(a) * rr, Math.sin(a) * rr, [[1.1, top + 0.6, K.STONE], [0.9, top + 1.4, K.STONE], [0.7, top + cH, K.STONE], [1.0, top + sr, K.STONE]], 8);
  }
  B.lathe(0, 0, [[er, top + sr, K.STONE], [er, eTop, K.STONE], [0.1, eTop, K.STONE]], 32);
  if (!lod) B.lathe(0, 0, [[er - 0.2, top + sr - 0.6, K.STONE], [er - 0.2, top + sr, K.STONE], [0.1, top + sr, K.STONE]], 32);
  const R = rr * 0.9, cy = eTop + R * 0.97;
  const prof = [];
  for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + (i / 16) * Math.PI; prof.push([Math.max(0.05, R * Math.cos(a)), cy + R * Math.sin(a), K.LANTERN]); }
  B.lathe(0, 0, prof, lod ? 16 : 36);
  void parts;
}

function gnomon(B, L, y) {
  const { x, z, h } = L;
  B.frame(x, y, z, 0);
  B.lathe(0, 0, [[4.2, -0.5, K.STONE], [4.2, 0.6, K.STONE], [3.2, 0.6, K.PAVING], [3.2, 1.3, K.STONE], [2.2, 1.3, K.STONE]], 24);
  B.frustum(2.4, 2.4, 0.9, 0.9, 1.3, h, K.STONE);
  B.frustum(0.9, 0.9, 0.02, 0.02, h, h + 2.2, K.LANTERN);
}

function cascade(B, parts, L, rec, lod) {
  // a water staircase down the axis: chutes on each terrace, falls at every wall, a pool at
  // the foot of each fall, balustraded side walls, fountains
  const { a, r0, r1, w } = L;
  const dir = [Math.cos(a), Math.sin(a)];
  const levels = rec.levels;
  const yAt = (r) => {
    const x = dir[0] * r, z = dir[1] * r;
    for (let k = levels.length - 1; k >= 0; k--) if (levels[k].grid.sample(x, z) < 0) return levels[k].y;
    return rec.sea.sample(x, z) < 0 ? QY : null;
  };
  B.frame(rec.w.x, 0, rec.w.z, -a + Math.PI / 2);      // local +z along the axis (outward)
  const step = 6;
  let prev = null;
  for (let r = r0; r < r1; r += step) {
    const y = yAt(r + step / 2);
    if (y === null) break;
    const drop = prev !== null && prev - y > 0.5;
    // the chute: stepped water between low weirs
    B.box(-w / 2 + 2.4, w / 2 - 2.4, r, r + step, y - 0.6, y + 0.35, K.STONE, K.POOL);
    if (!lod) B.box(-w / 2 + 2.4, w / 2 - 2.4, r + step - 0.35, r + step, y + 0.35, y + 0.6, K.STONE, K.STONE);
    // side walls with balustrades
    B.box(-w / 2, -w / 2 + 2.4, r, r + step, y - 0.6, y + 1.3, K.STONE, K.STONE);
    B.box(w / 2 - 2.4, w / 2, r, r + step, y - 0.6, y + 1.3, K.STONE, K.STONE);
    if (drop) {
      // the fall from the terrace above into a round pool
      const hi = prev;
      B.box(-w / 2 + 3, w / 2 - 3, r - 1.4, r - 0.9, y + 0.35, hi + 0.3, K.POOL, K.POOL);
      if (!lod) for (let k = -2; k <= 2; k++) B.lathe(k * (w / 6), r + 2.6, [[0.35, y + 0.35, K.STONE], [0.18, y + 3.5 + Math.abs(k) * 0.4, K.POOL], [0.02, y + 4 + Math.abs(k) * 0.4, K.POOL]], 6);
    }
    prev = y;
  }
  void parts;
  B.frame(0, 0, 0, 0);
}

function lighthouse(B, parts, L, y, lod, lights) {
  const { x, z, h } = L;
  B.frame(x, y, z, 0);
  B.lathe(0, 0, [[7, -0.5, K.STONE], [7, 1.5, K.STONE], [4.6, 1.5, K.STONE], [3.4, h * 0.82, L.style === 'crystal' ? K.FRIT : K.STONE], [4.4, h * 0.84, K.STONE], [4.4, h * 0.86, K.METAL], [3.0, h * 0.86, K.LANTERN], [3.0, h * 0.96, K.LANTERN], [3.4, h * 0.97, K.METAL], [0.05, h + 2.5, K.METAL]], lod ? 10 : 20);
  if (!lod) B.parapet(rrect(9.2, 9.2, 4.5), h * 0.86, 1.0, 0.16, K.METAL);
  lights.push({ x, y: y + h * 0.91, z, c: L.light || [1.0, 0.92, 0.75], s: 3.2 });
}

function crane(B, c, lod) {
  B.frame(c.x, QY, c.z, c.rot);
  const span = 18, H = 32, boom = 44;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(sx * span / 2 - 0.7, sx * span / 2 + 0.7, sz * 4 - 0.7, sz * 4 + 0.7, 0, H, K.STONE, K.STONE);
  B.box(-span / 2 - 1, span / 2 + 1, -5, 5, H, H + 3, K.STONE, K.STONE, { bottom: true });
  B.box(-span / 2 - 12, span / 2 + boom, -1.6, 1.6, H + 3, H + 5.5, K.STONE, K.STONE, { bottom: true });
  B.box(-3, 3, -3.4, 3.4, H + 5.5, H + 9, K.GLASS, K.METAL);
  if (!lod) {
    B.box(span / 2 + 8, span / 2 + 10, -1.2, 1.2, H - 6, H + 3, K.METAL, K.METAL);
    for (const sx of [-1, 1]) B.box(sx * span / 2 - 0.3, sx * span / 2 + 0.3, -4, 4, 8, 9, K.STONE, K.STONE);
    B.box(-span / 2 - 12, -span / 2 - 4, -2.5, 2.5, H + 5.5, H + 8, K.STONE, K.STONE);
  }
}

function gardenBelvedere(B, L, y, lod) {
  B.frame(L.x, y, L.z, L.rot);
  B.prism(rrect(12, 18, 1), -.45, .04, K.STONE, K.PAVING);
  for (const x of [-4, 4]) for (const z of [-6, 6]) {
    B.lathe(x, z, [[.65, -.25, K.STONE], [.65, .45, K.STONE], [.24, .45, K.TIMBER], [.24, 4.9, K.TIMBER]], 8);
  }
  for (const x of [-4, 4]) B.box(x - .2, x + .2, -7.2, 7.2, 4.8, 5.05, K.TIMBER, K.TIMBER);
  for (let z = -7; z <= 7; z += lod ? 2 : 1) B.box(-4.9, 4.9, z - .075, z + .075, 5.05, 5.23, K.TIMBER, K.TIMBER);
  // Four low bench bays frame the central through-route and its sea view.
  for (const x of [-5.1, 5.1]) for (const z of [-3.9, 3.9]) {
    B.box(x - .32, x + .32, z - 1.55, z + 1.55, .04, .52, K.STONE, K.TIMBER);
    if (!lod) B.box(x - .36, x + .36, z - 1.6, z + 1.6, .52, .62, K.TIMBER, K.TIMBER);
  }
}

function passengerShelter(B, L, y, lod) {
  B.frame(L.x, y, L.z, L.rot);
  B.prism(rrect(26, 12, 1.2), -.45, .04, K.STONE, K.PAVING);
  for (const x of [-10, 10]) for (const z of [-4.5, 4.5]) B.lathe(x, z, [[.5, -.25, K.STONE], [.5, .35, K.STONE], [.18, .35, K.METAL], [.18, 5.95, K.METAL]], 8);
  for (const x of [-10, 10]) B.box(x - .2, x + .2, -5, 5, 5.65, 5.95, K.METAL, K.METAL);
  // A folded roof echoes the terminal's ship forms; every edge has thickness.
  B.vprism([[-12, 6], [0, 5], [12, 6], [12, 6.3], [0, 5.3], [-12, 6.3]], -5, 5, K.METAL);
  for (const z of [-3.2, 3.2]) for (const x of [-6, 6]) B.box(x - 2, x + 2, z - .32, z + .32, .04, .56, K.STONE, K.TIMBER);
  void lod;
}

function terminal(B, L, y, lod) {
  const { x, z, rot, w, d } = L;
  B.frame(x, y, z, rot);
  B.box(-w / 2, w / 2, -d / 2, d / 2, -0.4, 12, K.GLASS, K.STONE);
  // a roof of five waves (glass vaults) over the hall
  const n = 5;
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + (i * w) / n, x1 = x0 + w / n;
    B.c = Math.cos(rot + Math.PI / 2); B.s = Math.sin(rot + Math.PI / 2);
    B.vault(-d / 2 - 2, d / 2 + 2, -x1, -x0, 12, 7 + (i % 2) * 2.5, i % 2 ? K.GLASS : K.STONE, lod ? 4 : 10);
    B.c = Math.cos(rot); B.s = Math.sin(rot);
  }
  // glazed boarding bridges reaching out over the quay to the basin
  for (const bx of [-w * 0.32, 0, w * 0.32]) {
    B.box(bx - 2, bx + 2, d / 2, d / 2 + 85, 7.5, 10.5, K.GLASS, K.STONE, { bottom: true });
    // A glazed quay lift closes the transfer route down to +3 m and gives the
    // gallery a founded endpoint. The street passes safely beneath its span.
    B.box(bx - 3.5, bx + 3.5, d / 2 + 81, d / 2 + 87, QY - y - 0.3, 11.5, K.GLASS, K.STONE);
    B.box(bx - 4, bx + 4, d / 2 + 80, d / 2 + 88, QY - y - 0.4, QY - y + 0.3, K.STONE, K.PAVING);
  }
}

function triumphalArch(B, L, y, lod) {
  const { x, z, w, h } = L;
  B.frame(x, y, z, Math.PI / 2);       // the passage runs along the Museum Mile (east-west)
  const dp = 24, ow = w * 0.36, top = h * 0.72, spring = h * 0.5, rise = ow / 2;
  const crown = Math.min(spring + rise, top - 1.2);
  const ry = crown - spring;
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? ow / 2 : -w / 2, x1 = s > 0 ? w / 2 : -ow / 2;
    B.box(x0, x1, -dp / 2, dp / 2, -0.5, top, K.STONE, K.STONE);
    if (!lod) {
      // stepped plinth round each pier (flush with the passage walls)
      const o0 = s > 0 ? 0 : 2.6, o1 = s > 0 ? 2.6 : 0;
      B.box(x0 - o0, x1 + o1, -dp / 2 - 2.6, dp / 2 + 2.6, -0.5, 0.6, K.STONE, K.PAVING);
      B.box(x0 - o0 * 0.6, x1 + o1 * 0.6, -dp / 2 - 1.9, dp / 2 + 1.9, 0.6, 1.4, K.STONE, K.STONE);
      // impost band at the springing, on both faces and inside the passage
      B.box(x0 - (s < 0 ? 0 : 0.35), x1 + (s > 0 ? 0 : 0.35), -dp / 2 - 0.35, dp / 2 + 0.35, spring - 1.0, spring, K.STONE, K.STONE, { bottom: true });
    }
  }
  // the arch: a solid spandrel block whose semicircular soffit closes the passage head
  const seg = lod ? 8 : 20, arc = [];
  for (let i = 0; i <= seg; i++) { const t = (i / seg) * Math.PI; arc.push([(ow / 2) * Math.cos(t), spring + ry * Math.sin(t)]); }
  B.vprism([[ow / 2, top], [-ow / 2, top], ...arc.slice().reverse()], -dp / 2, dp / 2, K.STONE);
  B.box(-w / 2 - 0.8, w / 2 + 0.8, -dp / 2 - 2.2, dp / 2 + 2.2, top, top + 1.6, K.STONE, K.STONE, { bottom: true });
  B.box(-w / 2, w / 2, -dp / 2, dp / 2, top + 1.6, h, K.STONE, K.STONE);
  B.box(-w / 2 - 0.6, w / 2 + 0.6, -dp / 2 - 0.6, dp / 2 + 0.6, h, h + 1.2, K.STONE, K.STONE, { bottom: true });
  if (!lod) {
    // archivolt and keystone on both faces
    const ring = [];
    for (let i = 0; i <= seg; i++) { const t = (i / seg) * Math.PI; ring.push([(ow / 2 + 1.1) * Math.cos(t), spring + (ry + 1.1) * Math.sin(t)]); }
    for (let i = seg; i >= 0; i--) ring.push([arc[i][0], arc[i][1]]);
    for (const fz of [-1, 1]) {
      const z0 = fz > 0 ? dp / 2 : -dp / 2 - 0.35, z1 = fz > 0 ? dp / 2 + 0.35 : -dp / 2;
      B.vprism(ring, z0, z1, K.STONE);
      B.vprism([[-1.1, crown - 0.4], [1.1, crown - 0.4], [1.6, top], [-1.6, top]], fz > 0 ? dp / 2 : -dp / 2 - 0.6, fz > 0 ? dp / 2 + 0.6 : -dp / 2, K.STONE);
      // relief panels on the piers and the inscription tablet of the attic
      for (const s of [-1, 1]) {
        const u0 = s > 0 ? ow / 2 + 3.4 : -w / 2 + 3.4, u1 = s > 0 ? w / 2 - 3.4 : -ow / 2 - 3.4;
        const zz0 = fz > 0 ? dp / 2 : -dp / 2 - 0.3, zz1 = fz > 0 ? dp / 2 + 0.3 : -dp / 2;
        B.box(u0, u1, zz0, zz1, h * 0.26, spring - 2.2, K.STONE, K.STONE, { bottom: true });
        B.box(u0 + 0.6, u1 - 0.6, fz > 0 ? dp / 2 + 0.3 : -dp / 2 - 0.5, fz > 0 ? dp / 2 + 0.5 : -dp / 2 - 0.3, spring - 7.5, spring - 3.2, K.STONE, K.STONE, { bottom: true });
      }
      B.box(-w * 0.3, w * 0.3, fz > 0 ? dp / 2 : -dp / 2 - 0.4, fz > 0 ? dp / 2 + 0.4 : -dp / 2, top + 3, h - 1.6, K.METAL, K.STONE, { bottom: true });
      // engaged columns on stepped pedestals
      for (const cx of [-w / 2 + 2, -ow / 2 - 2, ow / 2 + 2, w / 2 - 2]) {
        const cz = fz * (dp / 2 + 0.8);
        B.box(cx - 1.4, cx + 1.4, cz - 1.4, cz + 1.4, 0.6, 5, K.STONE, K.STONE);
        B.lathe(cx, cz, [[1.0, 5, K.STONE], [0.85, 5.8, K.STONE], [0.75, top - 1.2, K.STONE], [1.15, top, K.STONE]], 12);
      }
    }
    // a quadriga of light on the attic
    B.box(-7, 7, -3.5, 3.5, h + 1.2, h + 2.4, K.STONE, K.STONE);
    B.box(-6, 6, -3, 3, h + 2.4, h + 7, K.LANTERN, K.STONE);
  }
}

function opera(B, parts, L, y, lod) {
  // the Opera Shell: a stepped podium and interlocking sails of white tile, their mouths glazed
  const { x, z, rot, s } = L;
  B.frame(x, y, z, -rot + Math.PI / 2);
  B.prism(rrect(s * 1.5, s * 0.95, 12), -0.5, 6, K.STONE, K.PAVING);
  for (let k = 0; k < 12 && !lod; k++) B.prism(rrect(s * 0.5 - k * 0.6, 10, 1, 0, s * 0.475 + 5 + k * 0.5 - 4), -0.5, 6 - k * 0.5, K.STONE, K.PAVING);
  const sails = [[-0.36, 0.0, 0.62, 1.0], [-0.12, 0.08, 0.5, 0.82], [0.08, 0.14, 0.4, 0.66], [0.26, 0.18, 0.3, 0.5], [-0.3, -0.34, 0.38, 0.56], [-0.06, -0.3, 0.3, 0.44]];
  const c = Math.cos(-rot + Math.PI / 2), sn = Math.sin(-rot + Math.PI / 2);
  const W = (lx, yy, lz) => V(x + lx * c + lz * sn, y + yy, z - lx * sn + lz * c);
  for (const [ox, oz, rw, rh] of sails) {
    const R = s * rw, H = s * rh;
    const sail = (u, v) => {
      // a spherical lune leaning toward +x: u across the mouth, v from the foot to the crest
      const th = (u - 0.5) * 1.6, ph = v * 1.35;
      const lx = ox * s + Math.sin(ph) * R * 0.55 + (1 - Math.cos(ph)) * R * 0.1;
      const yy = 6 + Math.sin(ph) * H * 0.9;
      const lz = oz * s + Math.sin(th) * R * Math.cos(ph * 0.8) * 0.9;
      return W(lx - R * 0.3 * (1 - v), yy, lz);
    };
    parts.push(closedWardSurface(lod ? 6 : 14, lod ? 5 : 12, sail, 0.8, K.STONE));
    // Glazed mouths and tiled side returns enclose each auditorium. A narrow
    // clerestory follows the sail, preserving the white shell silhouette.
    const glass = (u, v) => { const p = sail(u, 1); return p.clone().lerp(p.clone().setY(y + 5.7), 1 - v); };
    parts.push(closedWardSurface(12, 1, glass, 0.22, K.GLASS));
    for (const edge of [0, 1]) {
      const cheek = (u, v) => { const p = sail(edge, 0.015 + u * 0.985); return p.clone().lerp(p.clone().setY(y + 5.7), 1 - v); };
      parts.push(closedWardSurface(lod ? 5 : 12, 1, (u, v) => cheek(u, v * 0.82), 0.45, K.STONE));
      parts.push(closedWardSurface(lod ? 5 : 12, 1, (u, v) => cheek(u, 0.82 + v * 0.18), 0.22, K.GLASS));
    }
  }
}

function amphitheatre(B, parts, L, lod) {
  // the cavea: twenty tiers of seats climbing from the orchestra (quay level) to the street,
  // on the landward half; a floating stage under a shell beyond the quay
  const { x, z, a, r0, r1 } = L;
  const tiers = 20;
  const a0 = a + Math.PI / 2 + 0.12, a1 = a + 1.5 * Math.PI - 0.12;
  const seg = lod ? 24 : 64;
  const arc = [];
  for (let i = 0; i <= seg; i++) { const t = a0 + (a1 - a0) * i / seg; arc.push([x + Math.cos(t) * r0, z + Math.sin(t) * r0]); }
  for (let k = 0; k < tiers; k++) {
    const da = (r1 - r0) * k / tiers, db = (r1 - r0) * (k + 1) / tiers;
    const yy = QY + (TOP - QY) * (k + 1) / tiers;
    // Individual founded annular blocks avoid long, almost collinear triangles
    // in the end caps of one forty-corner stepped profile.
    parts.push(sweepLoop(arc, () => [
      { a: [db, QY - 0.3], b: [db, yy], kind: K.STONE },
      { a: [db, yy], b: [da, yy], kind: K.PAVING },
      { a: [da, yy], b: [da, QY - 0.3], kind: K.STONE },
    ], { closed: false, closeSection: true, capEnds: true }));
  }
  // the end walls of the cavea
  for (const t of [a0, a1]) {
    B.frame(x + Math.cos(t) * (r0 + r1) / 2, 0, z + Math.sin(t) * (r0 + r1) / 2, Math.PI / 2 - t);
    B.box(-1, 1, -(r1 - r0) / 2 - 1, (r1 - r0) / 2 + 1, QY - 0.2, TOP + 1.2, K.STONE, K.STONE);
  }
  // the floating stage and its shell
  const sx = x + Math.cos(a) * (r0 + 70), sz = z + Math.sin(a) * (r0 + 70);
  B.frame(sx, 0, sz, 0);
  B.lathe(0, 0, [[26, -3, K.STONE], [26, 1.6, K.STONE], [25, 1.6, K.TIMBER], [0.1, 1.6, K.TIMBER]], 40);
  const shell = [];
  for (let j = 0; j <= 10; j++) shell.push(j);
  const W = (u, v) => {
    const th = a + Math.PI + (u - 0.5) * 2.2, ph = v * Math.PI * 0.5;
    const r = 24;
    return V(sx - Math.cos(th) * r * Math.cos(ph) * 0.9 + Math.cos(a) * 8, 1.6 + Math.sin(ph) * r * 0.75, sz - Math.sin(th) * r * Math.cos(ph) * 0.9 + Math.sin(a) * 8);
  };
  // Stop just short of the polar singularity; the narrow crest is sealed by the
  // joined shell rim, avoiding a row of zero-area triangles at a collapsed pole.
  parts.push(closedWardSurface(14, 8, (u, v) => W(u, v * 0.988), 0.6, K.STONE, K.LANTERN));
  // A hinged timber gangway links the orchestra's quay to the floating stage.
  B.frame(x, 0, z, Math.PI / 2 - a);
  for (let k = 0; k < 12; k++) {
    const z0 = 32 + k * 57 / 12, z1 = 32 + (k + 1) * 57 / 12, yy = QY + (1.6 - QY) * (k + 0.5) / 12;
    B.box(-2.6, 2.6, z0, z1 + 0.03, yy - 0.45, yy, K.METAL, K.TIMBER);
    for (const sx of [-1, 1]) B.box(sx * 2.5 - 0.1, sx * 2.5 + 0.1, z0, z1 + 0.03, yy + 0.9, yy + 1.0, K.METAL, K.METAL);
    if (k % 2 === 0) for (const sx of [-1, 1]) B.box(sx * 2.5 - 0.1, sx * 2.5 + 0.1, z0, z0 + 0.2, yy, yy + 1.0, K.METAL, K.METAL);
  }
  B.frame(0, 0, 0, 0);
  void shell; void lod;
}

function domes(parts, list, lights) {
  // glass domes rising from the lagoon, ribbed, lit from within, each on a round foundation
  for (const d of list) {
    const { x, z, r } = d;
    const prof = [{ r: r * 1.08, y: -7.6, kind: 1 }, { r: r * 1.05, y: -0.6, kind: 1 }, { r: r, y: -0.3, kind: 10 }];
    for (let i = 1; i <= 10; i++) { const a = (i / 10) * Math.PI / 2; prof.push({ r: Math.max(0.05, r * Math.cos(a)), y: -0.3 + r * 0.82 * Math.sin(a), kind: i < 10 ? 0 : 2 }); }
    parts.push(latheFacade(prof, 36).translate(x, 0, z));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const rib = [];
      for (let i = 0; i <= 10; i++) { const t = (i / 10) * Math.PI / 2; rib.push(V(x + Math.cos(a) * (r * Math.cos(t) + 0.3), -0.3 + r * 0.82 * Math.sin(t) + 0.2, z + Math.sin(a) * (r * Math.cos(t) + 0.3))); }
      parts.push(sweepTube(rib, () => 0.35, 5, { kind: 1 }));
    }
    lights.push({ x, y: r * 0.82 + 0.5, z, c: [0.4, 0.95, 1.0], s: 1.8 });
  }
}

export function wardBridgeLayout(br) {
  const length = Math.hypot(br.b[0] - br.a[0], br.b[1] - br.a[1]);
  const halfLength = length / 2 + 2;
  return { length, halfLength, rotation: Math.atan2(br.b[1] - br.a[1], br.b[0] - br.a[0]),
    halfWidth: br.hw + (br.style === 'tidehall' ? 4 : 0.4),
    endExtent: halfLength + (br.style === 'tidehall' ? 6 : 0) };
}

function canalBridge(B, parts, br, rec, lod) {
  // an arched bridge over a canal (or the reef lagoon): deck, parapets, an arch over the water
  // and piers at the water's edge; the Tidehall is a glazed galleria on the same bones
  const { a, b, hw, y } = br;
  const w = rec.w;
  const ax = w.x + a[0], az = w.z + a[1], bx = w.x + b[0], bz = w.z + b[1];
  const layout = wardBridgeLayout(br), L = layout.length, rot = layout.rotation;
  const cx = (ax + bx) / 2, cz = (az + bz) / 2;
  // where the water is under the bridge
  let w0 = null, w1 = null;
  for (let s = 0; s <= L; s += 1) {
    const x = a[0] + ((b[0] - a[0]) * s) / L, z = a[1] + ((b[1] - a[1]) * s) / L;
    if (rec.sea.sample(x, z) > 0) { if (w0 === null) w0 = s; w1 = s; }
  }
  if (w0 === null) { w0 = L * 0.3; w1 = L * 0.7; }
  const lx0 = -layout.halfLength, lx1 = layout.halfLength;
  // frame: local x along the bridge (the Builder's +x maps to (cos, -sin) of rot, so turn it)
  B.frame(cx, 0, cz, -rot);
  const hump = br.style === 'causeway' ? 1.2 : Math.min(3.2, (w1 - w0) * 0.06 + 0.8);
  const deckY = (lx) => y + 0.025 + hump * Math.cos(Math.PI * Math.min(Math.abs(lx) / layout.halfLength, 1) * 0.5) ** 2;
  const n = lod ? 4 : 12;
  for (let i = 0; i < n; i++) {
    const x0 = lx0 + ((lx1 - lx0) * i) / n, x1 = lx0 + ((lx1 - lx0) * (i + 1)) / n;
    const y0 = deckY(x0), y1 = deckY(x1);
    B.vprism([[x0, y0 - 1.4], [x1, y1 - 1.4], [x1, y1], [x0, y0]], -hw, hw, K.STONE);
    for (const s of [-1, 1]) B.vprism([[x0, y0], [x1, y1], [x1, y1 + 1.1], [x0, y0 + 1.1]], s * hw - (s > 0 ? 0.5 : 0), s * hw + (s > 0 ? 0 : 0.5), K.STONE);
  }
  if (br.style === 'causeway') {
    for (let s = lx0 + 18; s < lx1 - 10; s += 22) {
      const t = s + L / 2 + 2;
      if (t < w0 - 2 || t > w1 + 2) continue;
      B.lathe(s, 0, [[2.2, -7.6, K.STONE], [1.8, deckY(s) - 1.4, K.STONE], [2.6, deckY(s) - 1.0, K.STONE]], 10);
    }
  } else {
    // piers at the water's edges and the arch between them
    const p0 = -L / 2 + w0 - 1.5, p1 = -L / 2 + w1 + 1.5;
    for (const px of [p0, p1]) B.box(px - 1.8, px + 1.8, -hw - 0.4, hw + 0.4, -7.6, deckY(px) - 1.4, K.STONE, K.STONE);
    const sp = p1 - p0;
    const top = deckY(0) - 1.4;
    const rise = Math.min(top - 0.8, sp * 0.3);
    if (sp > 6 && rise > 1) {
      B.vaultZ(p0 + 1.8, p1 - 1.8, -hw, hw, top - rise, rise * 0.98, K.STONE, lod ? 6 : 12, { thickness: 0.5 });
      // spandrel walls over the arch
      const m = lod ? 3 : 8;
      for (let i = 0; i < m; i++) {
        const x0 = p0 + 1.8 + ((sp - 3.6) * i) / m, x1 = p0 + 1.8 + ((sp - 3.6) * (i + 1)) / m;
        const u = ((x0 + x1) / 2 - (p0 + p1) / 2) / ((sp - 3.6) / 2);
        const ya = top - rise + rise * Math.sqrt(Math.max(0, 1 - u * u));
        const yb = deckY((x0 + x1) / 2) - 1.4;
        if (yb - ya > 0.3) for (const s of [-1, 1]) B.box(x0, x1, s * hw - (s > 0 ? 0.6 : 0), s * hw + (s > 0 ? 0 : 0.6), ya, yb, K.STONE, K.STONE);
      }
    }
  }
  if (br.style === 'tidehall') {
    // the Tidehall: shops both sides, a glass barrel vault, a lantern dome, end towers
    const hl = layout.halfLength, sw = layout.halfWidth;
    for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
      const x0 = -hl + 2 * hl * i / n, x1 = -hl + 2 * hl * (i + 1) / n;
      B.box(x0, x1, s > 0 ? hw - 0.2 : -sw, s > 0 ? sw : -hw + 0.2, Math.min(deckY(x0), deckY(x1)) - 0.25, deckY(0) + 7.2, K.PUNCHED, K.GARDEN);
    }
    B.vault(-hl, hl, -sw, sw, deckY(0) + 7.2, sw * 0.55, K.GLASS, lod ? 6 : 14);
    B.lathe(0, 0, [[6, deckY(0) + 7.2 + sw * 0.5, K.STONE], [5.5, deckY(0) + 12 + sw * 0.5, K.LANTERN], [3, deckY(0) + 16 + sw * 0.5, K.GLASS], [0.1, deckY(0) + 18 + sw * 0.5, K.STONE]], 16);
    for (const ex of [-hl - 3, hl + 3]) {
      B.box(ex - 3, ex + 3, -sw, -sw + 6, y - 0.5, deckY(0) + 16, K.PUNCHED, K.STONE);
      B.box(ex - 3, ex + 3, sw - 6, sw, y - 0.5, deckY(0) + 16, K.PUNCHED, K.STONE);
    }
  }
  B.frame(0, 0, 0, 0);
  void parts;
}

function poolKerb(parts, pool, rec) {
  const w = rec.w;
  let pts;
  if (pool.box) pts = rrect(pool.box.hw * 2, pool.box.hd * 2, pool.box.round ?? 1, 0, 0, 3).map(([x, z]) => { const c = Math.cos(pool.box.rot || 0), s = Math.sin(pool.box.rot || 0); return [pool.box.x + x * c - z * s, pool.box.z + x * s + z * c]; });
  else if (pool.poly) pts = pool.poly;
  else { pts = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU; pts.push([pool.x + Math.cos(a) * pool.r, pool.z + Math.sin(a) * pool.r]); } }
  // orient anticlockwise (inside on the left), then sweep a kerb straddling the water's edge
  let A = 0; for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; A += pts[i][0] * q[1] - q[0] * pts[i][1]; }
  if (A < 0) pts = pts.slice().reverse();
  const center = pool.box ? [pool.box.x, pool.box.z] : pool.poly ? pool.poly[0] : [pool.x, pool.z];
  const y = rec.levels.slice().reverse().find((l) => l.grid.sample(center[0], center[1]) < 0)?.y ?? TOP;
  parts.push(sweepLoop(pts, () => [
    { a: [0.35, y - 0.1], b: [0.35, y + 0.45], kind: 1 },
    { a: [0.35, y + 0.45], b: [-0.3, y + 0.45], kind: 1 },
    { a: [-0.3, y + 0.45], b: [-0.3, y - 0.3], kind: 1 },
  ], { ox: w.x, oz: w.z, closeSection: true }));
}

function arcadeAlong(B, pts, rec, lod) {
  // a colonnade on the quay in front of the terrace wall: columns 4.8 m out, a loggia roof
  const w = rec.w;
  const fr = pts.map((p, i) => {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    return { p, t: [tx / l, tz / l], n: [tz / l, -tx / l] };
  });
  let acc = 0;
  for (let i = 1; i < fr.length; i++) {
    acc += Math.hypot(fr[i].p[0] - fr[i - 1].p[0], fr[i].p[1] - fr[i - 1].p[1]);
    if (acc < 4.2) continue;
    acc = 0;
    const f = fr[i];
    const cx = w.x + f.p[0] + f.n[0] * 4.8, cz = w.z + f.p[1] + f.n[1] * 4.8;
    B.frame(cx, QY, cz, 0);
    if (!lod) B.lathe(0, 0, [[0.5, -0.1, K.STONE], [0.4, 0.5, K.STONE], [0.33, 4.6, K.STONE], [0.55, 5.0, K.STONE]], 10);
    // the roof over this bay, from the wall to the colonnade
    const rot = Math.atan2(-f.n[0], -f.n[1]);
    B.frame(w.x + f.p[0] + f.n[0] * 2.6, QY, w.z + f.p[1] + f.n[1] * 2.6, rot);
    B.box(-2.08, 2.08, -2.8, 2.9, 5.0, 5.6, K.STONE, K.GARDEN, { bottom: true });
  }
  B.frame(0, 0, 0, 0);
}

function mirrorTerraces(parts, pts, rec, quayStairs = []) {
  // Six supported solar-glass steps. Each row is a closed wedge, including its
  // underside and ends; rows stop where the widening quay no longer supports them.
  const w = rec.w, n = 6, run = 8.5, drop = (TOP - QY) / n;
  // Keep each original sweep station's miter geometry. A conservative adjacent
  // bay clearance prevents a long edge from bridging over the stair opening.
  const frames = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const dx = b[0] - a[0], dz = b[1] - a[1], ll = Math.hypot(dx, dz) || 1; return { p, nx: dz / ll, nz: -dx / ll, reach: Math.max(Math.hypot(p[0] - a[0], p[1] - a[1]), Math.hypot(b[0] - p[0], b[1] - p[1])) }; });
  for (let k = 0; k < n; k++) {
    const o0 = 1.2 + k * run, o1 = o0 + run - 0.4;
    const y0 = TOP - k * drop + 0.35, y1 = TOP - (k + 1) * drop + 0.35 + drop * 0.55;
    const section = [
      { a: [o1, QY - 0.2], b: [o1, y1], kind: K.METAL },
      { a: [o1, y1], b: [o0, y0], kind: K.PV },
      { a: [o0, y0], b: [o0, QY - 0.2], kind: K.STONE },
    ];
    let cur = [];
    const flush = () => { if (cur.length > 1) parts.push(sweepLoop(cur, () => section, { ox: w.x, oz: w.z, closed: false, closeSection: true, capEnds: true, capKind: K.STONE })); cur = []; };
    for (const f of frames) {
      const stairGap = quayStairs.some(stair => {
        const uv = [o0, o1].map(o => {
          const dx = f.p[0] + f.nx * o - stair.p[0], dz = f.p[1] + f.nz * o - stair.p[1];
          return [dx * stair.t[0] + dz * stair.t[1], dx * stair.n[0] + dz * stair.n[1]];
        });
        return Math.min(...uv.map(p => p[0])) < 4.3 + f.reach && Math.max(...uv.map(p => p[0])) > -12.1 - f.reach
          && Math.min(...uv.map(p => p[1])) < (stair.offset || 0) + 4.4 && Math.max(...uv.map(p => p[1])) > -1.8;
      });
      if (!stairGap && rec.sea.sample(f.p[0] + f.nx * (o1 + 1), f.p[1] + f.nz * (o1 + 1)) < -1) cur.push(f.p); else flush();
    }
    flush();
  }
}

function marina(B, parts, bs, rec, rnd, boats) {
  // pontoons: a spine down the basin with fingers either side, gangways up to the quay, and
  // boats berthed between the fingers
  const w = rec.w;
  const c = Math.cos(bs.rot || 0), s = Math.sin(bs.rot || 0);
  const Wp = (u, v) => [w.x + bs.x + u * c - v * s, w.z + bs.z + u * s + v * c];
  const hw = bs.hw - 10, hd = bs.hd - 10;
  const box = (u0, u1, v0, v1, y0, y1, kind) => {
    const q = [Wp(u0, v0), Wp(u1, v0), Wp(u1, v1), Wp(u0, v1)];
    const cxp = (q[0][0] + q[2][0]) / 2, czp = (q[0][1] + q[2][1]) / 2;
    const rot = Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]);
    B.frame(cxp, 0, czp, -rot);
    B.box(-(u1 - u0) / 2, (u1 - u0) / 2, -(v1 - v0) / 2, (v1 - v0) / 2, y0, y1, kind, K.TIMBER);
  };
  box(-hw, hw, -1.4, 1.4, -0.4, 0.8, K.STONE);
  for (let u = -hw + 6; u < hw - 4; u += 9) {
    for (const sv of [-1, 1]) {
      box(u - 0.7, u + 0.7, sv > 0 ? 1.4 : -hd * 0.8, sv > 0 ? hd * 0.8 : -1.4, -0.4, 0.75, K.STONE);
      if (rnd() < 0.82) boats.push({ p: Wp(u + 4.5, sv * (hd * 0.42 + 1)), rot: (bs.rot || 0) + (sv > 0 ? Math.PI / 2 : -Math.PI / 2), len: 9 + rnd() * 7, seed: rnd() });
    }
  }
  // a gangway at each end of the spine up to the quay
  for (const su of [-1, 1]) {
    const u0 = su * hw, u1 = su * (hw + 11);
    const n = 8;
    for (let k = 0; k < n; k++) {
      const a = u0 + ((u1 - u0) * k) / n, b = u0 + ((u1 - u0) * (k + 1)) / n;
      box(Math.min(a, b), Math.max(a, b), -1.1, 1.1, 0.0, 0.8 + ((QY - 0.8) * (k + 1)) / n, K.METAL);
    }
  }
  B.frame(0, 0, 0, 0);
  void parts;
}

// ------------------------------------------------------------ heliostats --
function heliostatMesh(L, rec, world) {
  const w = rec.w;
  const crown = world && world.wardTowers ? world.wardTowers.find((t) => t.def.ward === w.id && t.def.name) : null;
  let rx = w.x, ry = 1100, rz = w.z;
  if (crown && crown.receiver) {
    crown.mesh.updateMatrixWorld(true);
    const v = crown.mesh.localToWorld(V(0, crown.receiver.y, 0));
    rx = v.x; ry = v.y; rz = v.z;
  }
  const inst = [];
  const pathD = (x, z) => {
    let d = 1e9;
    for (const p of L.paths) {
      const pts = p.pts;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9;
        let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        d = Math.min(d, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) - (p.w || 1.5));
      }
    }
    return d;
  };
  for (let r = L.r0; r < 1200; r += L.rowStep) {
    const n = Math.floor(((L.a1 - L.a0) * r) / L.colStep);
    const off = (Math.round(r / L.rowStep) % 2) * 0.5;
    for (let k = 0; k < n; k++) {
      const a = L.a0 + ((k + off) / n) * (L.a1 - L.a0);
      if (r > L.r1(a)) continue;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (rec.levels[0].grid.sample(x, z) > -6) continue;
      if (pathD(x, z) < 3.2) continue;
      inst.push(w.x + x, w.z + z);
    }
  }
  // geometry: a post (part 0) and a 5 x 3.4 m mirror on a frame (part 1)
  const post = latheFacade([{ r: 0.25, y: 0, kind: 10 }, { r: 0.18, y: 2.6, kind: 10 }, { r: 0.3, y: 2.9, kind: 10 }], 6);
  const mirror = new THREE.BoxGeometry(5, 3.4, 0.12);
  const parts = [[post, 0], [mirror, 1]];
  const pos = [], nor = [], part = [], idx = [];
  for (const [g0, k] of parts) {
    const g = g0.index ? g0 : g0;
    const base = pos.length / 3;
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); part.push(k === 1 ? (N.getZ(i) > 0.5 ? 1 : 2) : 0); }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  geo.setIndex(idx);
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(inst), 2));
  geo.instanceCount = inst.length / 2;
  const uniforms = { uRecv: { value: V(rx, ry, rz) }, uBaseY: { value: TOP }, uSunDirH: U.uSunDir };
  const mat = patchedMaterial({ color: 0xffffff, roughness: 0.08, metalness: 1.0, envMapIntensity: 1.2 }, {
    key: 'heliostats',
    uniforms,
    vertex: {
      pars: 'attribute float aPart; attribute vec2 aPos; uniform vec3 uRecv; uniform float uBaseY; uniform vec3 uSunDirH; varying float vPart; varying float vHF;',
      preNormal: /* glsl */ `
vec3 hsBase = vec3(aPos.x, uBaseY, aPos.y);
vec3 hsPivot = hsBase + vec3(0.0, 3.0, 0.0);
vec3 toR = normalize(uRecv - hsPivot);
vec3 sd = normalize(uSunDirH + vec3(0.0, 1e-4, 0.0));
// track the sun: the mirror's normal halves the angle between the sun and the receiver;
// after sunset they stow face-up
float day = smoothstep(-0.05, 0.08, sd.y);
vec3 nm = normalize(mix(vec3(0.0, 1.0, 0.0), normalize(sd + toR + vec3(0.0, 1e-3, 0.0)), day));
vec3 hx = normalize(cross(vec3(0.0, 1.0, 0.0), nm) + vec3(1e-4, 0.0, 0.0));
vec3 hy = cross(nm, hx);
mat3 hsRot = mat3(hx, hy, nm);
if (aPart > 0.5) objectNormal = hsRot * objectNormal;
float hsFar = distance(hsBase, cameraPosition);
vHF = hsFar;`,
      transform: /* glsl */ `
vPart = aPart;
if (aPart > 0.5) transformed = hsRot * transformed + vec3(0.0, 3.0, 0.0);
transformed += hsBase;
if (hsFar > 14000.0) transformed = hsBase;`,
    },
    fragment: {
      pars: 'varying float vPart; varying float vHF;',
      color: 'diffuseColor.rgb = vPart < 0.5 ? vec3(0.2, 0.2, 0.22) : (vPart < 1.5 ? vec3(0.9, 0.93, 0.97) : vec3(0.35, 0.36, 0.38));',
      surface: 'roughnessFactor = vPart > 0.5 && vPart < 1.5 ? mix(0.04, 0.2, smoothstep(2000.0, 9000.0, vHF)) : 0.5; metalnessFactor = vPart > 0.5 && vPart < 1.5 ? 1.0 : 0.6;',
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.name = `${w.name} heliostats`;
  return { mesh, count: inst.length / 2 };
}

// ----------------------------------------------------------------- boats --
let _boatGeo = null;
function boatGeometry() {
  if (_boatGeo) return _boatGeo;
  // a small motor yacht: hull (kind 1 white, 10 below the boot line), a cabin (glass), a mast
  const parts = [];
  const hull = latheFacade([{ r: 0.02, y: -0.5, kind: 1 }, { r: 0.42, y: -0.42, kind: 1 }, { r: 0.5, y: -0.1, kind: 1 }, { r: 0.46, y: 0.35, kind: 1 }, { r: 0.02, y: 0.5, kind: 1 }], 10, { sx: 1, sz: 0.34 });
  hull.rotateZ(Math.PI / 2);
  hull.scale(1, 0.12, 1);
  parts.push(hull);
  const cab = new THREE.BoxGeometry(0.32, 0.1, 0.2).translate(-0.05, 0.1, 0);
  parts.push(withKind(cab, 0));
  parts.push(withKind(new THREE.CylinderGeometry(0.006, 0.008, 0.5, 5).translate(0.02, 0.35, 0), 10));
  _boatGeo = mergeClean(parts);
  return _boatGeo;
}
function withKind(g, kind) {
  const p = g.attributes.position;
  const fac = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { fac[i * 3] = p.getX(i) * 10; fac[i * 3 + 1] = p.getY(i) * 10; fac[i * 3 + 2] = kind; }
  g.setAttribute('aFacade', new THREE.BufferAttribute(fac, 3));
  return g;
}

// ------------------------------------------------------------------ lights --
export function signalLights(list) {
  if (!list.length) return null;
  const pos = new Float32Array(list.length * 3), col = new Float32Array(list.length * 3), size = new Float32Array(list.length);
  list.forEach((l, i) => { pos.set([l.x, l.y, l.z], i * 3); col.set(l.c, i * 3); size[i] = l.s || 2; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uCityLights: U.uCityLights, uNight: U.uNight },
    vertexShader: /* glsl */ `
attribute vec3 aCol; attribute float aSize; uniform float uCityLights; varying vec3 vCol; varying float vI;
void main() {
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 1.0);
  float px = aSize * 900.0 / d;
  // steady lanterns: sub-pixel lights keep their energy instead of shrinking to a flicker
  float ratio = min(1.0, px / 2.0);
  vI = (0.15 + 0.85 * uCityLights) * (0.35 + 0.65 * ratio) * (1.0 - smoothstep(9000.0, 26000.0, d));
  vCol = aCol;
  gl_PointSize = clamp(px, 2.0, 22.0);
}`,
    fragmentShader: /* glsl */ `
varying vec3 vCol; varying float vI;
void main() {
  vec2 c = gl_PointCoord - 0.5; float r2 = dot(c, c) * 4.0; if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * vI * (exp(-r2 * 5.0) * 2.2 + 0.2 * (1.0 - r2)), 1.0);
}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  pts.name = 'harbour lights';
  return pts;
}

// ------------------------------------------------------------------ build --
export function buildWardLandmarks(scene, rec, P, G, { palette, world } = {}) {
  const w = rec.w;
  const rnd = (() => { let s = 7777 + w.seed * 101; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const near = new Builder(1 << 14), far = new Builder(1 << 12);
  const partsNear = [], partsFar = [], partsAll = [];
  const lights = [];
  const boats = [];
  const lamps = [];
  const out = { meshes: [], lod: [], lamps };
  const levelY = (lx, lz) => {
    for (let k = rec.levels.length - 1; k >= 0; k--) if (rec.levels[k].grid.sample(lx, lz) < 0) return rec.levels[k].y;
    return rec.sea.sample(lx, lz) < 0 ? QY : 0;
  };
  const both = (fn) => { fn(near, partsNear, false); fn(far, partsFar, true); };
  for (const L of P.landmarks) {
    const y = L.y ?? (L.x !== undefined ? levelY(L.x, L.z) : TOP);
    const W = (o) => ({ ...o, x: w.x + (o.x ?? 0), z: w.z + (o.z ?? 0) });
    switch (L.type) {
      case 'wardCourt': both((B, pp, lod) => wardCourt(B, pp, { ...W(L), y }, lod)); break;
      case 'gardenBelvedere': both((B, pp, lod) => gardenBelvedere(B, W(L), y, lod)); break;
      case 'passengerShelter': both((B, pp, lod) => passengerShelter(B, W(L), y, lod)); break;
      case 'observatory': both((B, pp, lod) => observatory(B, lod ? [] : partsAll, W(L), y)); break;
      case 'planetarium': both((B, pp, lod) => { if (!lod) planetarium(B, partsAll, W(L), y); else { B.frame(w.x + L.x, y, w.z + L.z, 0); B.lathe(0, 0, [[L.r * 0.9, 0, K.STONE], [L.r, L.r + 7, K.GLASS], [0.1, 2 * L.r + 7, K.GLASS]], 12); } }); break;
      case 'armillary': armillary(partsAll, w.x + L.x, y, w.z + L.z, L.r); break;
      case 'planets':
        for (const p of L.list) {
          const px = w.x + p.x, pz = w.z + p.z;
          near.frame(px, TOP, pz, 0);
          near.lathe(0, 0, [[2.2, -0.3, K.STONE], [2.2, 1.0, K.STONE], [0.6, 1.0, K.STONE], [0.4, 2.2, K.STONE]], 12);
          const prof = [];
          for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI; prof.push([Math.max(0.03, p.s * Math.cos(a)), 2.2 + p.s + p.s * Math.sin(a), K.STONE]); }
          near.lathe(0, 0, prof, 16);
          if (p.i === 4) partsAll.push(latheFacade([{ r: p.s * 1.3, y: 0, kind: 10 }, { r: p.s * 2.1, y: 0, kind: 10 }, { r: p.s * 2.1, y: 0.2, kind: 10 }, { r: p.s * 1.3, y: 0.2, kind: 10 }], 32, { closedProfile: true }).rotateZ(0.4).translate(px, TOP + 2.2 + p.s, pz));
        }
        break;
      case 'library': both((B, pp, lod) => library(B, W(L), y, lod)); break;
      case 'campanile': both((B, pp, lod) => campanile(B, W(L), y, lod)); break;
      case 'heliodrome': both((B, pp, lod) => heliodrome(B, pp, W(L), y, lod)); break;
      case 'gnomon': both((B) => gnomon(B, W(L), y)); break;
      case 'cascade': both((B, pp, lod) => cascade(B, pp, L, rec, lod)); break;
      case 'terminal': both((B, pp, lod) => terminal(B, W(L), y, lod)); break;
      case 'marinersLantern': both((B, pp, lod) => marinersLantern(B, pp, W(L), y, lod, lod ? null : lights)); break;
      case 'voyageHall': both((B, pp, lod) => voyageHall(B, pp, W(L), y, lod)); break;
      case 'cranes': for (const c of L.list) both((B, pp, lod) => crane(B, { ...c, x: w.x + c.x, z: w.z + c.z }, lod)); break;
      case 'arch': both((B, pp, lod) => triumphalArch(B, W(L), y, lod)); break;
      case 'opera': both((B, pp, lod) => opera(B, lod ? [] : partsAll, W(L), y, lod)); break;
      case 'amphitheatre': amphitheatre(near, partsAll, W(L), false); break;
      case 'domes': domes(partsAll, L.list.map((d) => ({ ...d, x: w.x + d.x, z: w.z + d.z })), lights); break;
      case 'monuments':
        for (const m of L.list) {
          const mx = w.x + m.x, mz = w.z + m.z, my = levelY(m.x, m.z);
          // the raised island inside a rond-point's ring road, kerbed and paved
          if (m.island) partsAll.push(latheFacade([{ r: m.island, y: my - 0.4, kind: 1 }, { r: m.island, y: my + 0.2, kind: 1 }, { r: m.island - 0.5, y: my + 0.2, kind: 9 }, { r: 0, y: my + 0.2, kind: 9 }], 48));
          if (m.kind === 'obelisk') {
            partsAll.push(latheFacade([{ r: 4.2, y: 0, kind: 1 }, { r: 4.2, y: 0.6, kind: 1 }, { r: 3.8, y: 0.6, kind: 6 }, { r: 1.6, y: 0.6, kind: 6 }, { r: 1.6, y: 1.8, kind: 1 }, { r: 1.2, y: 1.8, kind: 1 }], 32).translate(mx, my - 0.2, mz));
            partsAll.push(latheFacade([{ r: 0.95, y: 1.8, kind: 1 }, { r: 0.55, y: 18, kind: 1 }, { r: 0.001, y: 19.4, kind: 2 }], 4, { phase: Math.PI / 4 }).translate(mx, my - 0.2, mz));
          } else {
            partsAll.push(latheFacade([{ r: 11, y: 0, kind: 1 }, { r: 11, y: 0.7, kind: 1 }, { r: 10.4, y: 0.7, kind: 1 }, { r: 10.4, y: 0.45, kind: 6 }, { r: 2, y: 0.45, kind: 6 }, { r: 1.6, y: 0.5, kind: 1 }, { r: 1.1, y: 3.2, kind: 1 }, { r: 4.2, y: 3.5, kind: 1 }, { r: 3.9, y: 3.7, kind: 6 }, { r: 0.8, y: 3.7, kind: 6 }, { r: 0.6, y: 6.2, kind: 1 }, { r: 1.0, y: 6.5, kind: 1 }, { r: 0.05, y: 7.6, kind: 2 }], 40).translate(mx, my - 0.2, mz));
          }
        }
        break;
      case 'arcade': {
        const outer = largest(G.topLoops);
        const pts = outer && span(outer, L.a0, L.a1);
        if (pts) { arcadeAlong(near, pts, rec, false); arcadeAlong(far, pts, rec, true); }
        break;
      }
      case 'heliostats': {
        const hs = heliostatMesh(L, rec, world);
        scene.add(hs.mesh);
        out.meshes.push(hs.mesh);
        break;
      }
      default: break;
    }
  }
  // the ward's waterfront furniture
  for (const lh of rec.ctx.features.lighthouses) both((B, pp, lod) => lighthouse(B, pp, { ...lh, x: w.x + lh.x, z: w.z + lh.z }, QY, lod, lod ? [] : lights));
  for (const d of rec.ctx.features.docks) { ship(near, partsAll, w.x + d.x, w.z + d.z, d.rot, d.len, d.beam, rnd, !!d.ship); ship(far, null, w.x + d.x, w.z + d.z, d.rot, d.len, d.beam, rnd, !!d.ship); }
  for (const bs of rec.ctx.features.basins) if (bs.kind === 'marina') marina(near, partsAll, bs, rec, rnd, boats);
  if (rec.ctx.features.mirrorTerraces) {
    const outer = largest(G.topLoops);
    const pts = outer && span(outer, rec.ctx.features.mirrorTerraces.a0, rec.ctx.features.mirrorTerraces.a1);
    if (pts) mirrorTerraces(partsAll, pts, rec, G.quayStairs);
  }
  for (const br of P.bridges) both((B, pp, lod) => canalBridge(B, pp, br, rec, lod));
  for (const pool of P.pools || []) poolKerb(partsAll, pool, rec);
  // harbour mouth lights: steady red and green on the channel ends
  for (const bs of rec.ctx.features.basins) if (bs.kind === 'harbour' || bs.kind === 'marina') {
    const c = Math.cos(bs.rot || 0), s = Math.sin(bs.rot || 0);
    lights.push({ x: w.x + bs.x + bs.hw * c, y: QY + 4, z: w.z + bs.z + bs.hw * s, c: [0.25, 1.0, 0.45], s: 1.6 });
    lights.push({ x: w.x + bs.x - bs.hw * c, y: QY + 4, z: w.z + bs.z - bs.hw * s, c: [1.0, 0.22, 0.12], s: 1.6 });
  }
  // meshes
  const lmat = createLowriseMaterial(rec.design.lowrise.palette, { litFrac: 0.6, warmth: rec.design.lowrise.warmth, lampTint: rec.design.lowrise.lampTint });
  const fmat = createFacadeMaterial(palette, 880 + w.seed, { litFrac: 0.6, band: 1e5, warmth: rec.design.lowrise.warmth, lampTint: rec.design.lowrise.lampTint });
  const add = (geo, mat, name) => { const m = new THREE.Mesh(geo, mat); m.name = `${w.name} ${name}`; m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m); out.meshes.push(m); return m; };
  const nm = near.nv ? add(near.geometry(), lmat, 'landmarks') : null;
  const fm = far.nv ? add(far.geometry(), lmat, 'landmarks far') : null;
  const R = rec.R(0) * 1.25;
  if (nm || fm) out.lod.push({ near: nm, far: fm, center: V(w.x, 20, w.z), radius: R, nearDist: 1200 });
  const cleanList = (list) => list.filter((g) => g && g.attributes && g.attributes.position && g.attributes.position.count);
  const pa = cleanList(partsAll);
  if (pa.length) add(mergeClean(pa), fmat, 'monuments');
  const pf = cleanList(partsFar);
  if (pf.length) { const m = add(mergeClean(pf), fmat, 'monuments far'); out.lod.push({ near: null, far: m, center: V(w.x, 20, w.z), radius: R, nearDist: 1200 }); }
  const pn = cleanList(partsNear);
  if (pn.length) { const m = add(mergeClean(pn), fmat, 'monuments near'); out.lod.push({ near: m, far: null, center: V(w.x, 20, w.z), radius: R, nearDist: 1200 }); }
  // moored boats (instanced)
  if (boats.length) {
    const bm = new THREE.InstancedMesh(boatGeometry(), createFacadeMaterial('pearl', 891, { litFrac: 0.7, band: 1e5, colW: 2.6, floorH: 3.2, uplight: 0 }), boats.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    boats.forEach((b, i) => { q.setFromAxisAngle(V(0, 1, 0), -b.rot); m4.compose(V(b.p[0], 0.25, b.p[1]), q, V(b.len, b.len, b.len)); bm.setMatrixAt(i, m4); });
    bm.instanceMatrix.needsUpdate = true;
    bm.name = `${w.name} moored boats`;
    bm.castShadow = true;
    scene.add(bm);
    out.meshes.push(bm);
  }
  const sl = signalLights(lights);
  if (sl) { scene.add(sl); out.meshes.push(sl); }
  out.boats = boats;
  return out;
}
