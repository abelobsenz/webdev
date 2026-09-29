import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CK } from '../craft/craftGeometry.js';

// The Concord liner's skin, re-tessellated. The builder (src/craft/craftGeometry.js buildLiner)
// lofts the 2.4 km spindle from 61 sections of 64 points: 17 m facets round a 340 m hull and
// 40 m steps down the prow's taper, which read as a faceted tube in the Liner view. This
// replaces exactly that loft (and its two caps) with the same analytic surface at 192 x 241,
// with analytic normals (no shading bands at the facets), the same finishes placed by position
// rather than by vertex index (girdles as 12 m bronze bands, the window galleries and the
// lantern galleries amidships), and the same facade coordinates. Everything else the builder
// made (atrium, bridge, masts, scoop ring, engines, radiators, collars) is kept as it was, and
// the builder's own geometry stays the reference the fittings and clearances are seated on.

const TAU = Math.PI * 2;
const A = 170, BH = 118, N_EXP = 2.3, BELLY = 0.8, Z0 = -1150, Z1 = 1250;
const NR0 = 64, NJ0 = 60;                    // the builder's loft
const NR = 192, NJ = 240;                    // the refined skin

/** The builder's spindle profile (fraction of the full section) at u = 0 stern .. 1 prow. */
export function linerProf(u) {
  return u < 0.4 ? 0.62 + 0.38 * Math.sin((Math.PI / 2) * (u / 0.4)) : Math.pow(Math.max(Math.cos((Math.PI / 2) * ((u - 0.4) / 0.6)), 0), 0.8);
}

/** Superellipse section point (the builder's sectionEllipse) at parameter t, half-widths a, b. */
function sect(t, a, b, out) {
  const c = Math.cos(t), s = Math.sin(t);
  out[0] = Math.sign(c) * Math.pow(Math.abs(c), 2 / N_EXP) * a;
  let y = Math.sign(s) * Math.pow(Math.abs(s), 2 / N_EXP) * b;
  if (y < 0) y *= BELLY;
  out[1] = y;
  return out;
}

/** The finish at section parameter t (0 starboard, 0.25 turn top) and station z (metres). */
function skinKind(t, z) {
  const side = Math.abs(Math.cos(t)), up = Math.abs(Math.sin(t));
  // girdles: where the builder's every tenth section ring sat, a 12 m band
  const zg = (z - Z0) / ((Z1 - Z0) / NJ0);
  const g = Math.round(zg / 10) * 10;
  if (g > 0 && g <= NJ0 && Math.abs(zg - g) * ((Z1 - Z0) / NJ0) < 6) return CK.BRONZE;
  const j = zg;
  if (j > 18 && j < 44 && side > 0.9 && up < 0.22) return CK.LANTERN;
  if (side > 0.55 && side < 0.8) return CK.GLASS;
  return CK.HULL;
}

/**
 * Checks that the first triangles of the builder's liner are its spindle loft and caps (so they
 * can be replaced); returns the number of index entries they span, or 0 if the layout differs.
 */
function loftSpan(geo) {
  const loftVerts = (NJ0 + 1) * (NR0 + 1) + 2 * (NR0 + 1);
  const tris = NJ0 * NR0 * 2 + 2 * NR0;
  const ix = geo.index.array;
  if (ix.length < tris * 3 + 3) return 0;
  for (let i = 0; i < tris * 3; i++) if (ix[i] >= loftVerts) return 0;
  for (let i = tris * 3; i < tris * 3 + 3; i++) if (ix[i] < loftVerts) return 0;
  const p = geo.attributes.position;
  if (Math.abs(p.getZ(0) - Z0 * (geo.userData.linerScale || 1)) > 1e-3) return 0;
  return tris * 3;
}

/** The refined skin: { geo } with position, normal, aFacade and index (liner metres, scale s). */
export function buildLinerSkin(s = 1) {
  const cols = NR + 1;
  const n = (NJ + 1) * cols;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), fac = new Float32Array(n * 3);
  const P = [0, 0], Q = [0, 0];
  const zs = new Float64Array(NJ + 1), fs = new Float64Array(NJ + 1);
  for (let j = 0; j <= NJ; j++) { zs[j] = Z0 + (Z1 - Z0) * (j / NJ); fs[j] = Math.max(linerProf(j / NJ), 0.02); }
  let along = 0;
  for (let j = 0; j <= NJ; j++) {
    if (j) along += zs[j] - zs[j - 1];
    const z = zs[j], f = fs[j];
    // the profile's slope along z (for the normals): central differences on the analytic profile
    const dz = 0.5;
    const fa = Math.max(linerProf(Math.max((z - dz - Z0) / (Z1 - Z0), 0)), 0.02), fb = Math.max(linerProf(Math.min((z + dz - Z0) / (Z1 - Z0), 1)), 0.02);
    const df = (fb - fa) / (2 * dz);
    let per = 0;
    for (let i = 0; i <= NR; i++) {
      const t = ((i % NR) / NR) * TAU;
      sect(t, A * f, BH * f, P);
      if (i) { sect((((i - 1) % NR) / NR) * TAU, A * f, BH * f, Q); per += Math.hypot(P[0] - Q[0], P[1] - Q[1]); }
      const o = (j * cols + i) * 3;
      pos[o] = P[0] * s; pos[o + 1] = P[1] * s; pos[o + 2] = z * s;
      // tangents: around (dP/dt) and along (dP/dz = section * f'/f + z)
      const e = 1e-4;
      sect(t + e, A * f, BH * f, Q);
      let tx = Q[0] - P[0], ty = Q[1] - P[1];
      if (Math.abs(tx) + Math.abs(ty) < 1e-9) { sect(t - e, A * f, BH * f, Q); tx = P[0] - Q[0]; ty = P[1] - Q[1]; }
      const lx = P[0] * df / f, ly = P[1] * df / f;          // along: (lx, ly, 1)
      // normal = along x around, oriented outward (the section is convex, so outward is along P)
      let nx = ly * 0 - 1 * ty, ny = 1 * tx - lx * 0, nz = lx * ty - ly * tx;
      if (nx * P[0] + ny * P[1] < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const L = Math.hypot(nx, ny, nz) || 1;
      nrm[o] = nx / L; nrm[o + 1] = ny / L; nrm[o + 2] = nz / L;
      fac[o] = per; fac[o + 1] = along; fac[o + 2] = skinKind(t, z);
    }
  }
  const idx = new Uint32Array(NJ * NR * 6);
  let q = 0;
  for (let j = 0; j < NJ; j++) for (let i = 0; i < NR; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    idx[q++] = a; idx[q++] = b; idx[q++] = d; idx[q++] = a; idx[q++] = d; idx[q++] = c;
  }
  const skin = new THREE.BufferGeometry();
  skin.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  skin.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  skin.setAttribute('aFacade', new THREE.BufferAttribute(fac, 3));
  skin.setIndex(new THREE.BufferAttribute(idx, 1));
  // the stern bulkhead (dark, facing aft) and the prow's pin-point cap
  const caps = [];
  for (const [j, dir, kind] of [[0, -1, CK.DARK], [NJ, 1, CK.HULL]]) {
    const f = fs[j], z = zs[j], cp = [], cn = [], cf = [], ci = [];
    cp.push(0, 0, z * s); cn.push(0, 0, dir); cf.push(0, 0, kind);
    for (let i = 0; i < NR; i++) {
      sect((i / NR) * TAU, A * f, BH * f, P);
      cp.push(P[0] * s, P[1] * s, z * s); cn.push(0, 0, dir); cf.push(P[0], P[1], kind);
    }
    for (let i = 0; i < NR; i++) { const a = 1 + i, b = 1 + ((i + 1) % NR); if (dir > 0) ci.push(0, a, b); else ci.push(0, b, a); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(cf, 3));
    g.setIndex(ci);
    caps.push(g);
  }
  return mergeGeometries([skin, ...caps], false);
}

/**
 * The liner's geometry with the refined skin in place of the builder's loft. Falls back to the
 * builder's geometry (unchanged) if its layout is not the one this was written against.
 */
export function smoothLiner(liner) {
  const geo = liner.geo, s = (liner.length || 2400) / 2400;
  geo.userData.linerScale = s;
  const span = loftSpan(geo);
  if (!span) return geo;
  const rest = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'aFacade']) rest.setAttribute(k, geo.attributes[k]);
  rest.setIndex(new THREE.BufferAttribute(new Uint32Array(geo.index.array.subarray ? geo.index.array.subarray(span) : geo.index.array.slice(span)), 1));
  const g = mergeGeometries([buildLinerSkin(s), rest], false);
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.smoothSkin = true;
  return g;
}

// ---------------------------------------------------------------- tender spine ----
// The same treatment for the reclamation tenders' spine (buildTender: a rounded beam lofted
// from 25 sections of 20 points, n = 3.2, the girdles on every sixth section): 64 x 97 on the
// builder's surface, normals from the surface itself, girdles as 3 m bands. The pods, pod
// clamps, command pod, mast and engines are the builder's.

const TS = { z0: -140, z1: 118, n: 3.2, NR0: 20, NJ0: 24, NR: 64, NJ: 96 };
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
function spineSection(u) { return [9 + 4 * (1 - u) + 3 * ss(0.85, 1, u), 8 + 5 * (1 - u)]; }
function superPt(t, a, b, n, out) {
  const c = Math.cos(t), s = Math.sin(t);
  out[0] = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * a;
  out[1] = Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * b;
  return out;
}

/** The tender's smooth spine (tender metres at scale s), with caps: position, normal, aFacade, index. */
export function buildTenderSpine(s = 1) {
  const { z0, z1, n, NR, NJ } = TS, cols = NR + 1;
  const grid = [], P = [0, 0];
  for (let j = 0; j <= NJ; j++) {
    const u = j / NJ, z = lerp(z0, z1, u), [w, h] = spineSection(u), row = [];
    for (let i = 0; i <= NR; i++) { superPt(((i % NR) / NR) * TAU, w, h, n, P); row.push([P[0], P[1], z]); }
    grid.push(row);
  }
  const pos = [], nrm = [], fac = [], idx = [];
  const girdleStep = (z1 - z0) / 4;                     // the builder's j % 6 on 24 sections
  let along = 0;
  for (let j = 0; j <= NJ; j++) {
    if (j) along += grid[j][0][2] - grid[j - 1][0][2];
    let per = 0;
    for (let i = 0; i <= NR; i++) {
      const p = grid[j][i];
      if (i) per += Math.hypot(p[0] - grid[j][i - 1][0], p[1] - grid[j][i - 1][1]);
      const a = grid[j][(i + 1) % NR], b = grid[j][(i + NR - 1) % NR];
      const c = grid[Math.min(j + 1, NJ)][i], d = grid[Math.max(j - 1, 0)][i];
      const tx = a[0] - b[0], ty = a[1] - b[1], tz = a[2] - b[2];
      const lx = c[0] - d[0], ly = c[1] - d[1], lz = c[2] - d[2];
      let nx = ly * tz - lz * ty, ny = lz * tx - lx * tz, nz = lx * ty - ly * tx;
      if (nx * p[0] + ny * p[1] < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const L = Math.hypot(nx, ny, nz) || 1;
      pos.push(p[0] * s, p[1] * s, p[2] * s); nrm.push(nx / L, ny / L, nz / L);
      const zr = (p[2] - z0) / girdleStep, g = Math.round(zr);
      fac.push(per, along, g > 0 && Math.abs(zr - g) * girdleStep < 1.5 ? CK.BRONZE : CK.HULL);
    }
  }
  for (let j = 0; j < NJ; j++) for (let i = 0; i < NR; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  for (const [j, dir, kind] of [[0, -1, CK.DARK], [NJ, 1, CK.HULL]]) {
    const base = pos.length / 3, z = grid[j][0][2];
    pos.push(0, 0, z * s); nrm.push(0, 0, dir); fac.push(0, 0, kind);
    for (let i = 0; i < NR; i++) { const p = grid[j][i]; pos.push(p[0] * s, p[1] * s, z * s); nrm.push(0, 0, dir); fac.push(p[0], p[1], kind); }
    for (let i = 0; i < NR; i++) { const a = base + 1 + i, b = base + 1 + ((i + 1) % NR); if (dir > 0) idx.push(base, a, b); else idx.push(base, b, a); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  return g;
}

/** The tender's geometry with the smooth spine in place of the builder's loft (or the builder's, unchanged, if its layout differs). */
export function smoothTender(tender) {
  const geo = tender.geo, s = (tender.length || 300) / 300;
  const { NR0, NJ0 } = TS;
  const verts = (NJ0 + 1) * (NR0 + 1) + 2 * (NR0 + 1), tris = NJ0 * NR0 * 2 + 2 * NR0;
  const ix = geo.index.array;
  let ok = ix.length > tris * 3 + 3 && Math.abs(geo.attributes.position.getZ(0) - TS.z0 * s) < 1e-3;
  for (let i = 0; ok && i < tris * 3; i++) if (ix[i] >= verts) ok = false;
  for (let i = tris * 3; ok && i < tris * 3 + 3; i++) if (ix[i] < verts) ok = false;
  if (!ok) return geo;
  const rest = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'aFacade']) rest.setAttribute(k, geo.attributes[k]);
  rest.setIndex(new THREE.BufferAttribute(new Uint32Array(ix.slice(tris * 3)), 1));
  const g = mergeGeometries([buildTenderSpine(s), rest], false);
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.smoothSkin = true;
  return g;
}
