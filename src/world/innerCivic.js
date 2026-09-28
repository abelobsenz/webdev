import * as THREE from 'three';
import { createFacadeMaterial } from './facade.js';
import { latheFacade, mergeClean } from './geom.js';
import { ISLANDS } from './layout.js';
import { ST, HALF_W } from './urban.js';

// The civic buildings of the inner islands. Every island's town is planned round a civic
// square beside its arcology (urban.js); the wards have observatories, museums and harbours,
// and the lagoon islands now have a public building of their own at the heart of that square:
//   Aster    the Star Conservatory - a glass dome on an eight-pointed star terrace
//   Lumen    the Lantern Library   - a round reading hall under a lantern, in a colonnade
//   Solace   the Thermae           - public baths: a peristyle court round a long pool, domed halls
//   Verdant  the Palm Houses       - a great glasshouse and two wings in a parterre
//   Cantor   the Music Rotunda     - a columned rotunda with a shallow dome, a stage within
//   Halcyon  the Still Pavilion    - a pavilion on a square reflecting pool, stepping stones
//   Oriel    the Oriel Gallery     - a long gallery of bay windows and an observatory tower
//   Thule    the Archive           - three stepped stacks of reading rooms behind a portico
// Where a civic square is the forecourt of an arcology (no room clear of its base), the building
// takes the island's largest open lawn instead (findSite), a public building in a park.
// Each stands on a stepped plinth set on the highest ground of its footprint and reaching a
// metre and a half below the lowest, inside half the square's radius, so the square's walkers
// (people.js), benches and kiosks (streetscape.js) ring it. The massing is one mesh on layer 0
// (seen in the water too); columns, ribs, oriels and other small parts are a detail mesh on
// layer 1 shown within DETAIL_DIST. Everything is a closed solid under the facade shader.

const TAU = Math.PI * 2;
const DETAIL_DIST = 1600;

/** Space each civic square leaves its building: inside the walkers' ring, clear of the benches. */
export function civicRadius(q) { return q.r * 0.5 - 6; }

const DESIGNS = { aster: star, lumen: library, solace: thermae, verdant: palmHouses, cantor: rotunda, halcyon: stillPavilion, oriel: gallery, thule: archive };
const PALETTE = { aster: 'silver', lumen: 'pearl', solace: 'rose', verdant: 'jade', cantor: 'marble', halcyon: 'pearl', oriel: 'sand', thule: 'silver' };

/** Mark the civic squares that get a building (before streetscape.js furnishes them). */
export function planInnerCivic(plan, towers = [], ground = null) {
  const done = new Set();
  const clearOfTowers = (x, z, R) => { for (const t of towers) R = Math.min(R, Math.hypot(t.def.x - x, t.def.z - z) - (t.collide ? t.collide(1) : (t.def.radius || 60) * 1.4) - 8); return R; };
  for (const q of plan.squares) {
    if (q.kind !== 'civic' || !DESIGNS[q.district]) continue;
    const R = clearOfTowers(q.x, q.z, civicRadius(q));
    if (R >= 10) { q.landmarkR = R; done.add(q.district); }
  }
  // the others take the island's largest open lawn, clear of streets, lots, squares, towers, shore
  plan.civicParks = [];
  if (!ground) return;
  const F = plan.field;
  const lotGrid = new Map(), G = 40;
  for (const L of plan.lots) { const k = Math.floor(L.x / G) * 100003 + Math.floor(L.z / G); if (!lotGrid.has(k)) lotGrid.set(k, []); lotGrid.get(k).push(L); }
  const lotClear = (x, z, cap) => {
    let d = cap;
    for (let i = Math.floor((x - cap) / G); i <= Math.floor((x + cap) / G); i++) for (let j = Math.floor((z - cap) / G); j <= Math.floor((z + cap) / G); j++)
      for (const L of lotGrid.get(i * 100003 + j) || []) d = Math.min(d, Math.hypot(L.x - x, L.z - z) - Math.hypot(L.w, L.d) * 0.5 - 4);
    return d;
  };
  for (const isl of ISLANDS) {
    if (done.has(isl.id) || !DESIGNS[isl.id]) continue;
    let best = null;
    for (let x = isl.x - isl.r; x <= isl.x + isl.r; x += 10) for (let z = isl.z - isl.r; z <= isl.z + isl.r; z += 10) {
      if (Math.hypot(x - isl.x, z - isl.z) > isl.r * 0.92 || F.squareAt(x, z) > 0.01) continue;
      let R = Math.min(F.edge(x, z) - 3, 46);
      if (R < 12) continue;
      R = Math.min(R, lotClear(x, z, R), clearOfTowers(x, z, R));
      if (R < 12) continue;
      // dry, and not too steep across the footprint
      let lo = 1e9, hi = -1e9;
      for (let k = 0; k < 16; k++) for (const f of [0.5, 1]) { const g = ground(x + Math.cos((k / 16) * TAU) * R * f, z + Math.sin((k / 16) * TAU) * R * f); lo = Math.min(lo, g); hi = Math.max(hi, g); }
      if (lo < 3.5) continue;
      const score = R - (hi - lo) * 2.2;
      if (!best || score > best.score) best = { x, z, R, score };
    }
    if (!best || best.R < 12) continue;
    const site = { x: best.x, z: best.z, r: best.R * 2 + 12, landmarkR: best.R - 2, district: isl.id, kind: 'park' };
    // a lane in from the nearest street: the shortest ray that crosses no lot and no square
    let lane = null;
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * TAU, dx = Math.cos(a), dz = Math.sin(a), pts = [];
      let ok = false;
      for (let t = best.R - 1; t < best.R + 160; t += 2) {
        const x = best.x + dx * t, z = best.z + dz * t;
        if (F.squareAt(x, z) > 0.01 || ground(x, z) < 2.5 || lotClear(x, z, 8) < 1.5) break;
        pts.push([x, z]);
        if (F.edge(x, z) < -0.5) { ok = true; break; }
      }
      if (ok && pts.length >= 2 && (!lane || pts.length < lane.pts.length)) lane = { pts, a };
    }
    if (lane) {
      const st = { pts: lane.pts, cls: ST.LANE, hw: HALF_W[ST.LANE], district: isl.id, name: `${isl.name} Civic Walk` };
      plan.streets.push(st);
      F.polyline(st.pts, st.hw);
      // the front faces the walk
      site.yaw = Math.atan2(Math.cos(lane.a), Math.sin(lane.a));
    }
    plan.civicParks.push(site);
  }
}

// ------------------------------------------------------------------ helpers --
// facade coordinates from the normals: walls take (u along the wall, v up), tops their plan
function withKinds(g, kWall, kTop = kWall, kBottom = kWall) {
  g = g.index ? g : g;
  const p = g.attributes.position, n = g.attributes.normal, f = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = n.getY(i);
    if (ny > 0.6) { f[i * 3] = x; f[i * 3 + 1] = z; f[i * 3 + 2] = kTop; }
    else if (ny < -0.6) { f[i * 3] = x; f[i * 3 + 1] = z; f[i * 3 + 2] = kBottom; }
    else { f[i * 3] = Math.abs(n.getX(i)) > Math.abs(n.getZ(i)) ? z : x; f[i * 3 + 1] = y; f[i * 3 + 2] = kWall; }
  }
  g.setAttribute('aFacade', new THREE.BufferAttribute(f, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aFacade'].includes(k)) g.deleteAttribute(k);
  return g;
}
const box = (w, h, d, kWall, kTop = kWall) => withKinds(new THREE.BoxGeometry(w, h, d), kWall, kTop);
/** a closed box by its extents in the site frame */
function slab(x0, x1, y0, y1, z0, z1, kWall, kTop = kWall) {
  return box(x1 - x0, y1 - y0, z1 - z0, kWall, kTop).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}
/** a closed vertical prism over a plan polygon ([x, z] counter-clockwise) */
function prism(poly, y0, y1, kWall, kTop = kWall) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2).translate(0, y0, 0);
  return withKinds(g, kWall, kTop);
}
const lathe = (profile, seg, opts) => latheFacade(profile, seg, opts);
/** A lathe profile where each point's k is the kind of the segment arriving at it: coincident
 *  rings are inserted wherever the kind changes, so no wall blends between two kinds. */
function prof(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], k = i === 0 ? pts[1].k : p.k;
    const last = out[out.length - 1];
    if (last && last.kind !== k) out.push({ r: last.r, y: last.y, kind: k });
    out.push({ r: p.r, y: p.y, kind: k });
  }
  return out;
}
const L = (pts, seg, opts) => latheFacade(prof(pts), seg, opts);

/** a closed ring (annulus) between radii r0 < r1 */
const ring = (r0, r1, y0, y1, k, seg = 48) => latheFacade([{ r: r0, y: y0, kind: k }, { r: r1, y: y0, kind: k }, { r: r1, y: y1, kind: k }, { r: r0, y: y1, kind: k }], seg, { closedProfile: true, capTop: false, capBottom: false });
/** a classical column: base, shaft, capital (closed) */
function column(r, y0, y1, seg = 10) {
  return latheFacade([{ r: r * 1.45, y: y0, kind: 1 }, { r: r * 1.45, y: y0 + r * 0.9, kind: 1 }, { r: r * 1.05, y: y0 + r * 1.3, kind: 1 },
    { r: r * 0.9, y: y1 - r * 1.3, kind: 1 }, { r: r * 1.4, y: y1 - r * 0.6, kind: 1 }, { r: r * 1.5, y: y1, kind: 1 }], seg);
}
/** a dome from radius r at y0, rising h, with an optional oculus/lantern radius at the top */
function dome(r, y0, h, k, top = 0, steps = 10) {
  const prof = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2), rr = Math.max(top, r * Math.cos(t));
    prof.push({ r: i === steps ? top : rr, y: y0 + h * Math.sin(t), k });
  }
  return prof;
}
/** a stepped plinth under a plan polygon or circle: steps outward, top at `top` */
function plinth(parts, shape, top, lo, steps = 2, rise = 0.45, run = 1.6) {
  for (let s = steps; s >= 0; s--) {
    const e = s * run, y1 = top - s * rise;
    if (shape.r !== undefined) parts.push(latheFacade([{ r: shape.r + e, y: lo, kind: 1 }, { r: shape.r + e, y: y1, kind: 1 }], 48));
    else parts.push(prism(offsetPoly(shape.poly, e), lo, y1, 1, 9));
  }
}
function offsetPoly(poly, e) {
  if (!e) return poly;
  const n = poly.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], c = poly[(i + 1) % n];
    const n1 = norm([b[1] - a[1], -(b[0] - a[0])]), n2 = norm([c[1] - b[1], -(c[0] - b[0])]);
    const m = norm([n1[0] + n2[0], n1[1] + n2[1]]), k = e / Math.max(0.35, m[0] * n1[0] + m[1] * n1[1]);
    out.push([b[0] + m[0] * k, b[1] + m[1] * k]);
  }
  return out;
}
const norm = ([x, z]) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
const rect = (hx, hz) => [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];

// ------------------------------------------------------------------ designs --
// Each design builds in a local frame (origin at the square's centre on the plinth top,
// +z toward the facing direction) into { mass: [], detail: [], collide: radius, height }.

function star(R, M, D, F) {
  const pts = [];
  for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU + TAU / 32, r = k % 2 ? R * 0.74 : R; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  const S = { poly: pts.reverse() };
  const r = R * 0.6;
  M.push(L([{ r: r + 0.4, y: 0, k: 1 }, { r: r + 0.4, y: 0.6, k: 1 }, { r, y: 0.6, k: 1 }, { r, y: 2.6, k: 5 }, { r: r + 0.3, y: 2.6, k: 1 }, { r: r + 0.3, y: 3.0, k: 1 }, { r, y: 3.0, k: 1 },
    ...dome(r, 3.0, r * 0.95, 14, r * 0.18).slice(1), { r: r * 0.18, y: 3.0 + r * 0.95, k: 2 }, { r: r * 0.18, y: 3.9 + r * 0.95, k: 2 }, { r: 0, y: 4.4 + r * 0.95, k: 1 }], 40));
  // ribs over the glass, and a star finial
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    for (let i = 0; i < 8; i++) {
      const t0 = (i / 8) * (Math.PI / 2), t1 = ((i + 1) / 8) * (Math.PI / 2), tm = (t0 + t1) / 2;
      const rr = r * Math.cos(tm) + 0.06, y = 3.0 + r * 0.95 * Math.sin(tm), len = r * (t1 - t0) * 1.05;
      D.push(box(0.22, len, 0.3, 10).rotateZ(tm).translate(rr, y, 0).rotateY(-a));
    }
  }
  const fy = 4.4 + r * 0.95;
  D.push(L([{ r: 0.001, y: fy - 0.2, k: 2 }, { r: 0.55, y: fy + 0.5, k: 2 }, { r: 0.001, y: fy + 1.6, k: 2 }], 8));
  // eight lamp obelisks on the star's points
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + TAU / 32; D.push(L([{ r: 0.35, y: 0, k: 1 }, { r: 0.3, y: 2.4, k: 1 }, { r: 0.22, y: 2.4, k: 2 }, { r: 0.001, y: 3.0, k: 2 }], 6).translate(Math.cos(a) * R * 0.86, 0, Math.sin(a) * R * 0.86)); }
  return { plinth: S, collide: r + 0.5, height: fy + 1.6, halfX: R, halfZ: R };
}

function library(R, M, D, F) {
  const r = Math.min(22, R * 0.6), rc = Math.min(R - 3, r + 7);
  M.push(L([{ r: r + 0.6, y: 0, k: 1 }, { r: r + 0.6, y: 2.4, k: 1 }, { r, y: 2.4, k: 1 }, { r, y: 14, k: 5 }, { r, y: 14, k: 0 }, { r, y: 17, k: 0 },
    { r: r + 1.1, y: 17, k: 1 }, { r: r + 1.1, y: 18.2, k: 1 }, { r, y: 18.2, k: 1 }, ...dome(r, 18.2, 6.5, 1, 6).slice(1),
    { r: 6, y: 24.7, k: 2 }, { r: 6, y: 30.5, k: 2 }, { r: 6.8, y: 30.5, k: 1 }, { r: 6.8, y: 31.3, k: 1 }, { r: 0, y: 34, k: 1 }], 56));
  // the colonnade: a ring of columns under an entablature, on a stylobate
  M.push(ring(rc - 2.2, rc + 1.2, 9.2, 10.6, 1, 64));
  const n = Math.max(20, Math.round((TAU * rc) / 4.2));
  for (let k = 0; k < n; k++) { const a = (k / n) * TAU; D.push(column(0.42, 0, 9.2).translate(Math.cos(a) * rc, 0, Math.sin(a) * rc)); }
  // columns stand in for the far massing as a thin ring wall seen from a distance
  F.push(ring(rc - 0.25, rc + 0.25, 0, 9.2, 1, 64));
  D.push(L([{ r: 0.001, y: 34, k: 2 }, { r: 0.35, y: 34.3, k: 2 }, { r: 0.001, y: 37.5, k: 2 }], 8));
  return { plinth: { r: rc + 2 }, collide: rc + 1.3, height: 37.5 };
}

function thermae(R, M, D, F) {
  const hr0 = Math.min(9, R * 0.2), hx = Math.min(34, R - 2 * hr0), hz = Math.min(24, R * 0.56), ix = hx - 6, iz = hz - 6;
  // the peristyle: a roofed walk round the court, columns on both faces; halls at the ends
  const roofY = 7.2, T = 0.9;
  for (const [x0, x1, z0, z1] of [[-hx, hx, -hz, -iz], [-hx, hx, iz, hz], [-hx, -ix, -iz, iz], [ix, hx, -iz, iz]]) M.push(slab(x0, x1, roofY, roofY + T, z0, z1, 1, 3));
  const cols = [];
  for (const edge of [[-hx + 0.8, hx - 0.8, 'x', -hz + 0.8], [-hx + 0.8, hx - 0.8, 'x', hz - 0.8], [-hx + 0.8, hx - 0.8, 'x', -iz - 0.2], [-hx + 0.8, hx - 0.8, 'x', iz + 0.2],
    [-iz + 3, iz - 3, 'z', -hx + 0.8], [-iz + 3, iz - 3, 'z', hx - 0.8], [-iz + 3, iz - 3, 'z', -ix - 0.2], [-iz + 3, iz - 3, 'z', ix + 0.2]]) {
    const [a0, a1, ax, c] = edge, n = Math.max(2, Math.round((a1 - a0) / 3.6));
    for (let i = 0; i <= n; i++) { const t = a0 + ((a1 - a0) * i) / n; cols.push(ax === 'x' ? [t, c] : [c, t]); }
  }
  for (const [x, z] of cols) D.push(column(0.36, 0, roofY, 8).translate(x, 0, z));
  // far massing: the walk's back wall stands in for the columns
  for (const [x0, x1, z0, z1] of [[-hx, hx, -hz, -hz + 0.5], [-hx, hx, hz - 0.5, hz], [-hx, -hx + 0.5, -hz, hz], [hx - 0.5, hx, -hz, hz]]) F.push(slab(x0, x1, 0, roofY, z0, z1, 1));
  // the long pool in the court, with its coping and steps
  const px = ix - 5, pz = iz - 4;
  M.push(slab(-px, px, -0.35, -0.1, -pz, pz, 1, 6));
  for (const [x0, x1, z0, z1] of [[-px - 0.8, px + 0.8, -pz - 0.8, -pz], [-px - 0.8, px + 0.8, pz, pz + 0.8], [-px - 0.8, -px, -pz, pz], [px, px + 0.8, -pz, pz]]) M.push(slab(x0, x1, -0.1, 0.35, z0, z1, 1, 9));
  // the domed halls at the two ends (caldarium and frigidarium), with oculus lanterns
  const hr = Math.min(hr0, hz - 7);
  for (const sx of [-1, 1]) {
    M.push(L([{ r: hr, y: 0, k: 5 }, { r: hr, y: 8.5, k: 5 }, { r: hr + 0.6, y: 8.5, k: 1 }, { r: hr + 0.6, y: 9.4, k: 1 }, { r: hr, y: 9.4, k: 1 }, ...dome(hr, 9.4, hr * 0.8, 1, 1.6).slice(1), { r: 1.6, y: 9.4 + hr * 0.8 + 1.4, k: 2 }, { r: 0, y: 9.4 + hr * 0.8 + 2.4, k: 1 }], 40).translate(sx * (hx + hr - 2), 0, 0));
  }
  return { plinth: { poly: rect(hx + 2 * hr - 2, hz) }, collide: Math.hypot(hx + hr, hz), height: 9.4 + hr * 0.8 + 2.4, halfX: hx + 2 * hr - 2, halfZ: hz, far: true };
}

function palmHouses(R, M, D, F) {
  const r = Math.min(15, R * 0.4), len = Math.min(R - 4, r * 1.8 + 10);
  // the great house: an elongated glass dome on a stone base; the two wings on the long axis
  M.push(L([{ r: r + 0.5, y: 0, k: 1 }, { r: r + 0.5, y: 2.2, k: 1 }, { r, y: 2.2, k: 1 }, ...dome(r, 2.2, r * 1.05, 14, 1.8).slice(1), { r: 1.8, y: 2.2 + r * 1.05 + 1.6, k: 2 }, { r: 0, y: 2.2 + r * 1.05 + 2.4, k: 1 }], 48, { sx: 1.35 }));
  const wr = r * 0.55;
  for (const s of [-1, 1]) {
    M.push(L([{ r: wr + 0.4, y: 0, k: 1 }, { r: wr + 0.4, y: 1.8, k: 1 }, { r: wr, y: 1.8, k: 1 }, ...dome(wr, 1.8, wr * 0.95, 14, 0.9).slice(1), { r: 0.9, y: 1.8 + wr * 0.95 + 0.8, k: 2 }, { r: 0, y: 1.8 + wr * 0.95 + 1.3, k: 1 }], 36, { sx: 1.25 })
      .translate(s * (len - wr * 1.25), 0, 0));
    // glazed links between the wings and the great house
    const x0 = s > 0 ? r * 1.35 - 0.5 : -(len - wr * 2.5 + 0.5), x1 = s > 0 ? len - wr * 2.5 + 0.5 : -(r * 1.35 - 0.5);
    M.push(slab(x0, x1, 0, 3.6, -2.4, 2.4, 14, 1));
  }
  // the parterre: four planted beds with low stone kerbs on the cross axis
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const x0 = sx * 2, x1 = sx * (len - 2), z0 = sz * (r + 2), z1 = sz * Math.min(R - 3, r + 11);
    M.push(slab(Math.min(x0, x1), Math.max(x0, x1), 0, 0.55, Math.min(z0, z1), Math.max(z0, z1), 1, 3));
  }
  return { plinth: { poly: rect(len + 1, Math.min(R - 1, r + 13)) }, collide: len, height: 2.2 + r * 1.05 + 2.4, halfX: len + 1, halfZ: Math.min(R - 1, r + 13) };
}

function rotunda(R, M, D, F) {
  const r = Math.min(R - 2.5, 10.5), n = 12;
  M.push(L([{ r: r + 0.4, y: 7.4, k: 1 }, { r: r + 0.4, y: 8.4, k: 1 }, { r, y: 8.4, k: 1 }, ...dome(r, 8.4, r * 0.5, 1, 1.2).slice(1), { r: 1.2, y: 8.4 + r * 0.5 + 1.2, k: 2 }, { r: 0, y: 8.4 + r * 0.5 + 2.0, k: 1 }], 40));
  M.push(ring(r - 1.2, r + 0.4, 6.6, 7.4, 1, 40));
  for (let k = 0; k < n; k++) { const a = (k / n) * TAU; D.push(column(0.34, 0, 6.6, 8).translate(Math.cos(a) * (r - 0.5), 0, Math.sin(a) * (r - 0.5))); }
  F.push(ring(r - 0.7, r - 0.3, 0, 6.6, 1, 40));
  // the stage: a round dais under the dome, a bronze screen behind the players
  M.push(L([{ r: r * 0.55, y: 0, k: 1 }, { r: r * 0.55, y: 0.9, k: 1 }, { r: 0, y: 0.9, k: 9 }], 32));
  D.push(slab(-2.6, 2.6, 0.9, 4.2, -r * 0.45, -r * 0.45 + 0.25, 10));
  return { plinth: { r: r + 1.5 }, collide: r + 0.5, height: 8.4 + r * 0.5 + 2.0 };
}

function stillPavilion(R, M, D, F) {
  const P = Math.min(R - 1.5, 12), p = P - 1.4, s = Math.min(5, P * 0.42);
  // the pool, sunk into the plinth, and its coping
  M.push(slab(-p, p, -0.45, -0.12, -p, p, 1, 6));
  for (const [x0, x1, z0, z1] of [[-P, P, -P, -p], [-P, P, p, P], [-P, -p, -p, p], [p, P, -p, p]]) M.push(slab(x0, x1, -0.12, 0.3, z0, z1, 1, 9));
  // the pavilion on its island: a dais, four piers, a thin roof with a lantern
  M.push(slab(-s - 0.8, s + 0.8, -0.12, 0.4, -s - 0.8, s + 0.8, 1, 9));
  for (const [x, z] of [[-s, -s], [s, -s], [s, s], [-s, s]]) M.push(slab(x - 0.35, x + 0.35, 0.4, 4.6, z - 0.35, z + 0.35, 1));
  M.push(slab(-s - 1.4, s + 1.4, 4.6, 5.1, -s - 1.4, s + 1.4, 1, 3));
  M.push(slab(-1.2, 1.2, 5.1, 6.0, -1.2, 1.2, 2));
  // stepping stones across the water from the four sides
  for (let k = 0; k < 4; k++) for (let i = 0; i < 3; i++) {
    const t = s + 1.6 + i * ((p - s - 1.8) / 3) + 0.5, a = (k * Math.PI) / 2;
    D.push(slab(-0.55, 0.55, -0.2, 0.18, -0.55, 0.55, 9).translate(Math.cos(a) * t, 0, Math.sin(a) * t));
  }
  return { plinth: { poly: rect(P, P) }, collide: s + 1.5, height: 6, halfX: P, halfZ: P };
}

function gallery(R, M, D, F) {
  const tr = 4.6, hx = Math.max(9, Math.min(17, R - 2 * tr - 3)), hz = 6.5, H = 11, tx = hx + tr + 1;
  M.push(slab(-hx, hx, 0, H, -hz, hz, 5, 1));
  // a parapet round the roof
  for (const [x0, x1, z0, z1] of [[-hx, hx, -hz, -hz + 0.35], [-hx, hx, hz - 0.35, hz], [-hx, -hx + 0.35, -hz, hz], [hx - 0.35, hx, -hz, hz]]) M.push(slab(x0, x1, H, H + 1.0, z0, z1, 1));
  // the oriels: glazed bays standing out from the long front at the first floor
  const n = 5;
  for (let i = 0; i < n; i++) {
    const x = -hx + ((i + 0.5) / n) * 2 * hx;
    D.push(slab(x - 1.8, x + 1.8, 3.6, 8.4, hz, hz + 1.5, 0, 1));
    D.push(slab(x - 2.0, x + 2.0, 3.2, 3.6, hz - 0.1, hz + 1.7, 1));
    D.push(slab(x - 2.0, x + 2.0, 8.4, 8.8, hz - 0.1, hz + 1.7, 1));
  }
  // the observatory tower at the east end and its dome
  M.push(L([{ r: tr + 0.5, y: 0, k: 1 }, { r: tr + 0.5, y: 1.2, k: 1 }, { r: tr, y: 1.2, k: 1 }, { r: tr, y: 26, k: 5 }, { r: tr + 0.6, y: 26, k: 1 }, { r: tr + 0.6, y: 27, k: 1 },
    { r: tr * 0.95, y: 27, k: 1 }, ...dome(tr * 0.95, 27, tr * 0.9, 14, 0).slice(1)], 32).translate(tx, 0, 0));
  D.push(slab(tx - 0.3, tx + 0.3, 27 + tr * 0.55, 27 + tr * 0.95, -tr * 0.9, tr * 0.9, 10));
  return { plinth: { poly: rect(tx + tr + 1, hz + 2) }, collide: Math.hypot(tx + tr, hz), height: 27 + tr, halfX: tx + tr + 1, halfZ: hz + 2 };
}


function archive(R, M, D, F) {
  const hx = Math.min(22, R * 0.75), hz = Math.min(15, R * 0.55);
  // three stepped tiers of reading rooms, each with a planted roof terrace
  const tiers = [[hx, hz, 0, 7.5], [hx * 0.74, hz * 0.7, 7.5, 14], [hx * 0.48, hz * 0.42, 14, 19.5]];
  for (const [ax, az, y0, y1] of tiers) {
    M.push(slab(-ax, ax, y0, y1, -az, az, 5, 3));
    for (const [x0, x1, z0, z1] of [[-ax, ax, -az, -az + 0.3], [-ax, ax, az - 0.3, az], [-ax, -ax + 0.3, -az, az], [ax - 0.3, ax, -az, az]]) M.push(slab(x0, x1, y1, y1 + 0.9, z0, z1, 1));
  }
  // a lantern of glass on the top tier
  M.push(slab(-hx * 0.2, hx * 0.2, 19.5, 23, -hz * 0.18, hz * 0.18, 2, 1));
  // the portico: a row of columns under a pediment-less entablature on the long front
  const n = 8, fz = hz + 4.2;
  M.push(slab(-hx * 0.62, hx * 0.62, 7.4, 8.4, hz, fz + 0.6, 1, 3));
  for (let i = 0; i < n; i++) D.push(column(0.42, 0, 7.4, 10).translate(-hx * 0.55 + (i / (n - 1)) * hx * 1.1, 0, fz));
  F.push(slab(-hx * 0.58, hx * 0.58, 0, 7.4, fz - 0.25, fz + 0.25, 1));
  return { plinth: { poly: rect(hx + 1, fz + 1.6) }, collide: Math.hypot(hx, fz), height: 23, halfX: hx + 1, halfZ: fz + 1.6 };
}

// ------------------------------------------------------------------- build --
export function buildInnerCivic(scene, plan, ground, colliders = []) {
  const out = { meshes: [], detail: [], far: [], sites: [] };
  for (const q of [...plan.squares, ...(plan.civicParks || [])]) {
    if (!q.landmarkR || !DESIGNS[q.district]) continue;
    const R = q.landmarkR, M = [], D = [], F = [];
    const spec = DESIGNS[q.district](R, M, D, F);
    // facing: the front toward the lagoon side of the island
    const yaw = q.yaw ?? Math.atan2(q.z, q.x) + Math.PI / 2;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const toW = (x, z) => [q.x + x * c + z * s, q.z - x * s + z * c];
    // the plinth's outline in the site frame, and the ground round it
    const edge = [];
    if (spec.plinth.r !== undefined) { const r = spec.plinth.r + 3.2; for (let k = 0; k < 32; k++) edge.push([Math.cos((k / 32) * TAU) * r, Math.sin((k / 32) * TAU) * r]); }
    else { const hx = spec.halfX + 3.2, hz = spec.halfZ + 3.2; for (let i = 0; i < 12; i++) { const t = -1 + (2 * i) / 12; edge.push([hx * t, -hz], [hx, hz * t], [-hx * t, hz], [-hx, -hz * t]); } }
    const inner = []; for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) inner.push([(i / 3 - 1) * (spec.halfX || spec.plinth.r), (j / 3 - 1) * (spec.halfZ || spec.plinth.r)]);
    let lo = 1e9, hi = -1e9, low = null;
    for (const [x, z] of [...edge, ...inner]) { const [wx, wz] = toW(x, z), g = ground(wx, wz); if (g < lo) { lo = g; low = [x, z]; } hi = Math.max(hi, g); }
    const top = hi + 0.35, drop = top - lo;
    const P = [];
    plinth(P, spec.plinth, 0, lo - top - 1.5);
    // a sloping site: a grand stair down to the low side, and a parapet along the terrace edge
    if (drop > 1.2) {
      const dir = norm(low), ang = Math.atan2(dir[1], dir[0]);
      const reach = spec.plinth.r !== undefined ? spec.plinth.r + 3.2 : Math.min(Math.abs((spec.halfX + 3.2) / (dir[0] || 1e-6)), Math.abs((spec.halfZ + 3.2) / (dir[1] || 1e-6)));
      const W = Math.min(10, reach * 0.9), rise = 0.3, run = 0.42;
      let y = 0, k = 0;
      while (y > -(drop - 0.05) && k < 60) {
        const y1 = y - rise, x0 = reach + k * run - 0.02, gx = Math.cos(ang), gz = Math.sin(ang);
        const [wx, wz] = toW(gx * (x0 + run), gz * (x0 + run)), g = ground(wx, wz) - top;
        if (g > y1 + 0.02) break;                       // the ground has come up to meet the flight
        P.push(slab(x0, x0 + run, lo - top - 1.5, y1 + rise, -W / 2, W / 2, 1, 9).rotateY(-ang));
        y = y1; k++;
      }
      for (const sgn of [-1, 1]) P.push(slab(reach - 0.4, reach + k * run + 0.4, lo - top - 1.5, 0.9, sgn * W / 2 - 0.35 * (sgn < 0 ? 1 : 0), sgn * W / 2 + 0.35 * (sgn > 0 ? 1 : 0), 1).rotateY(-ang));
      // parapet: segments along the outline where the ground falls away, leaving the stair open
      const pts = spec.plinth.r !== undefined ? edge.map(([x, z]) => [x * (spec.plinth.r + 3.1) / (spec.plinth.r + 3.2), z * (spec.plinth.r + 3.1) / (spec.plinth.r + 3.2)]) : edge;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const [wx, wz] = toW(m[0], m[1]); if (top - ground(wx, wz) < 0.9) continue;
        const along = Math.abs(Math.atan2(m[1], m[0]) - ang); if (Math.min(along, TAU - along) < Math.atan2(W / 2 + 0.5, reach)) continue;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
        P.push(slab(-len / 2, len / 2, 0, 1.0, -0.22, 0.22, 1).rotateY(-rot).translate(m[0], 0, m[1]));
      }
    }
    const mass = mergeClean([...P, ...M]), det = D.length ? mergeClean(D) : null, far = F.length ? mergeClean(F) : null;
    const mat = createFacadeMaterial(PALETTE[q.district] || 'pearl', 700 + (q.district.charCodeAt(0) * 7) % 97, { litFrac: 0.7, band: 1e5, uplight: 1 });
    const place = (g) => { g.rotateY(yaw); g.translate(q.x, top, q.z); g.computeBoundingSphere(); return g; };
    const add = (g, name, layer, list) => {
      const m = new THREE.Mesh(place(g), mat);
      m.name = name; m.castShadow = true; m.receiveShadow = true;
      if (layer) m.layers.set(layer);
      m.matrixAutoUpdate = false; m.updateMatrix();
      scene.add(m); list.push(m);
    };
    add(mass, `Civic building: ${q.district}`, 0, out.meshes);
    if (det) add(det, `Civic building detail: ${q.district}`, 1, out.detail);
    if (far) add(far, `Civic building far: ${q.district}`, 0, out.far);
    colliders.push({ x: q.x, z: q.z, y0: lo - 2, y1: top + spec.height, radius: () => spec.collide });
    out.sites.push({ district: q.district, x: q.x, z: q.z, top, height: spec.height, R, drop });
  }
  // detail within DETAIL_DIST; the far stand-ins (walls behind colonnades) only beyond it
  const _v = new THREE.Vector3();
  out.update = (camera) => {
    for (const d of out.detail) d.visible = camera.position.distanceTo(_v.copy(d.geometry.boundingSphere.center)) < DETAIL_DIST + d.geometry.boundingSphere.radius;
    for (const f of out.far) f.visible = camera.position.distanceTo(_v.copy(f.geometry.boundingSphere.center)) >= DETAIL_DIST + f.geometry.boundingSphere.radius;
  };
  return out;
}
