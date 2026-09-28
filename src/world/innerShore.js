import * as THREE from 'three';
import { createFacadeMaterial } from './facade.js';
import { mergeClean, latheFacade } from './geom.js';
import { ISLANDS } from './layout.js';
import { ST } from './urban.js';

// The shore promenades of the inner islands. The towns stop at their outer ring roads and the
// land falls away through meadow and beach to the lagoon; the wards meet the water with quays
// and seaside walks, so here a promenade follows each island's shore along the contour a few
// metres above the beach. It is laid as an esplanade in the town plan before the street field is
// baked, so it is paved and kerbed like any street, walked by the island's people, planted with
// its palms (treePlanner.js) and hedged (groundCover.js); its lamps stand on the landward verge.
// It breaks wherever it would touch a lot, a square, a station, an arcology's base, a civic
// park or ground too steep for a walk, and pieces too short to be worth walking are dropped.

const TAU = Math.PI * 2;
const LEVEL = 3.4;          // the contour it follows (m above the lagoon)
const HW = 4.2;             // half-width of the walk
const STEP = 6;             // resampling step along the walk (m)

export function planShorePromenades(plan, ground, towers = [], exclusions = []) {
  const F = plan.field, lots = plan.lots, out = [];
  const lotGrid = new Map(), G = 40;
  for (const L of lots) { const k = Math.floor(L.x / G) * 100003 + Math.floor(L.z / G); if (!lotGrid.has(k)) lotGrid.set(k, []); lotGrid.get(k).push(L); }
  const nearLot = (x, z, r) => {
    for (let i = Math.floor((x - r - 30) / G); i <= Math.floor((x + r + 30) / G); i++) for (let j = Math.floor((z - r - 30) / G); j <= Math.floor((z + r + 30) / G); j++)
      for (const L of lotGrid.get(i * 100003 + j) || []) if (Math.hypot(L.x - x, L.z - z) < Math.hypot(L.w, L.d) * 0.5 + r) return true;
    return false;
  };
  const lampGrid = new Map();
  for (const l of plan.lamps) { const k = Math.floor(l.x / 16) * 100003 + Math.floor(l.z / 16); if (!lampGrid.has(k)) lampGrid.set(k, []); lampGrid.get(k).push(l); }
  const nearLamp = (x, z, r) => {
    for (let i = Math.floor((x - r) / 16); i <= Math.floor((x + r) / 16); i++) for (let j = Math.floor((z - r) / 16); j <= Math.floor((z + r) / 16); j++)
      for (const l of lampGrid.get(i * 100003 + j) || []) if (Math.hypot(l.x - x, l.z - z) < r) return true;
    return false;
  };
  const blocked = (x, z) => {
    if (F.squareAt(x, z) > 0.01 || F.edge(x, z) < HW + 1.5 || nearLamp(x, z, HW + 1)) return true;
    if (nearLot(x, z, HW + 2.5)) return true;
    for (const t of towers) if (Math.hypot(t.def.x - x, t.def.z - z) < (t.collide ? t.collide(1) : 80) + HW + 6) return true;
    for (const e of exclusions) if (Math.hypot(e.x - x, e.z - z) < e.r + HW + 4) return true;
    for (const p of plan.civicParks || []) if (Math.hypot(p.x - x, p.z - z) < p.landmarkR + 14) return true;
    return false;
  };
  for (const isl of ISLANDS) {
    const loop = shoreLoop(isl, ground);
    if (!loop) continue;
    // cut into runs of walkable points
    let run = [];
    const flush = () => {
      if (run.length * STEP >= 60) {
        const st = { pts: run, cls: ST.ESPLANADE, hw: HW, district: isl.id, name: `${isl.name} Shore Walk` };
        plan.streets.push(st);
        F.polyline(run, HW);
        out.push(st);
        // lamps on the landward verge every ~24 m (the side toward the island's centre)
        for (let i = 2; i < run.length - 2; i += 4) {
          const [x, z] = run[i], [x0, z0] = run[i - 1], [x1, z1] = run[i + 1];
          let nx = -(z1 - z0), nz = x1 - x0; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
          if ((isl.x - x) * nx + (isl.z - z) * nz < 0) { nx = -nx; nz = -nz; }
          const lx = x + nx * (HW + 1.3), lz = z + nz * (HW + 1.3);
          if (!nearLot(lx, lz, 1.5) && ground(lx, lz) > 2.0 && F.edge(lx, lz) > 0.6 && F.squareAt(lx, lz) < 0.01) plan.lamps.push({ x: lx, z: lz, yaw: Math.atan2(-nx, -nz), cls: ST.ESPLANADE });
        }
      }
      run = [];
    };
    for (let i = 0; i < loop.length; i++) {
      const [x, z] = loop[i];
      const prev = loop[(i - 1 + loop.length) % loop.length];
      const grade = Math.abs(ground(x, z) - ground(prev[0], prev[1])) / STEP;
      if (blocked(x, z) || grade > 0.09 || ground(x, z) < 2.2) flush(); else run.push([x, z]);
    }
    flush();
  }
  // last word on the verges: no lamp may be left standing in a carriageway (the walks
  // and civic lanes laid over the finished plan can cover one)
  for (let i = plan.lamps.length - 1; i >= 0; i--) { const l = plan.lamps[i]; if (F.edge(l.x, l.z) < -0.2) plan.lamps.splice(i, 1); }
  return out;
}

/** The island's shore contour at LEVEL: the longest closed loop round its centre, resampled. */
function shoreLoop(isl, ground) {
  const S = 8, R = isl.r * 1.9, n = Math.ceil((2 * R) / S) + 1, x0 = isl.x - R, z0 = isl.z - R;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = ground(x0 + i * S, z0 + j * S) - LEVEL;
  // marching squares: one segment per crossed cell edge pair, chained by shared edge points
  const key = (i, j, e) => `${i},${j},${e}`;          // e: 0 = horizontal edge from (i,j), 1 = vertical
  const pt = (i, j, e) => {
    const a = h[j * n + i], b = e ? h[(j + 1) * n + i] : h[j * n + i + 1], t = a / (a - b);
    return e ? [x0 + i * S, z0 + (j + t) * S] : [x0 + (i + t) * S, z0 + j * S];
  };
  const adj = new Map();
  const link = (p, q) => { (adj.get(p) || adj.set(p, []).get(p)).push(q); (adj.get(q) || adj.set(q, []).get(q)).push(p); };
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const c = [h[j * n + i] > 0, h[j * n + i + 1] > 0, h[(j + 1) * n + i + 1] > 0, h[(j + 1) * n + i] > 0];
    const edges = [];
    if (c[0] !== c[1]) edges.push(key(i, j, 0));
    if (c[1] !== c[2]) edges.push(key(i + 1, j, 1));
    if (c[3] !== c[2]) edges.push(key(i, j + 1, 0));
    if (c[0] !== c[3]) edges.push(key(i, j, 1));
    if (edges.length === 2) link(edges[0], edges[1]);
    else if (edges.length === 4) { link(edges[0], edges[1]); link(edges[2], edges[3]); }
  }
  // chain loops; keep the longest one that encloses the island's centre
  const seen = new Set();
  let best = null;
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const chain = [start]; seen.add(start);
    let cur = start, prev = null;
    for (;;) {
      const nb = (adj.get(cur) || []).filter((q) => q !== prev && !seen.has(q));
      if (!nb.length) break;
      prev = cur; cur = nb[0]; seen.add(cur); chain.push(cur);
    }
    if (chain.length < 40) continue;
    const pts = chain.map((k) => { const [i, j, e] = k.split(',').map(Number); return pt(i, j, e); });
    let wind = 0;
    for (let k = 0; k < pts.length; k++) { const a = pts[k], b = pts[(k + 1) % pts.length]; wind += Math.atan2((a[0] - isl.x) * (b[1] - isl.z) - (a[1] - isl.z) * (b[0] - isl.x), (a[0] - isl.x) * (b[0] - isl.x) + (a[1] - isl.z) * (b[1] - isl.z)); }
    if (Math.abs(wind) > Math.PI && (!best || pts.length > best.length)) best = pts;
  }
  if (!best) return null;
  // smooth and resample at STEP
  let pts = best;
  for (let it = 0; it < 3; it++) pts = pts.map((p, k) => { const a = pts[(k - 1 + pts.length) % pts.length], b = pts[(k + 1) % pts.length]; return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4]; });
  const outP = [pts[0]]; let acc = 0;
  for (let k = 1; k <= pts.length; k++) {
    const a = pts[k - 1], b = pts[k % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    acc += L;
    while (acc >= STEP) { acc -= STEP; const t = 1 - acc / L; outP.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return outP;
}

// ------------------------------------------------------------------ jetties --
// Timber jetties off the shore walks: every few hundred metres where the beach shelves into
// boat-draught water within reach, a stair drops from the walk's seaward verge to a deck on
// piles that runs straight out to a T-head, with boats moored alongside. Everything is closed
// and stands on the seabed; the deck clears the water by 1.3 m.

const DECK_Y = 1.3, DECK_HW = 1.6;

function boxAt(parts, cx, cy, cz, w, h, d, yaw, kWall, kTop = kWall) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position, n = g.attributes.normal, f = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const ny = n.getY(i);
    f[i * 3] = Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i);
    f[i * 3 + 1] = Math.abs(ny) > 0.5 ? p.getZ(i) : p.getY(i) + h / 2;
    f[i * 3 + 2] = ny > 0.5 ? kTop : kWall;
  }
  g.setAttribute('aFacade', new THREE.BufferAttribute(f, 3));
  g.deleteAttribute('uv');
  g.rotateY(yaw).translate(cx, cy, cz);
  parts.push(g);
}

function boat(parts, x, z, yaw, len) {
  const hull = latheFacade([{ r: 0.02, y: -0.5, kind: 1 }, { r: 0.42, y: -0.42, kind: 1 }, { r: 0.5, y: -0.1, kind: 1 }, { r: 0.46, y: 0.35, kind: 1 }, { r: 0.02, y: 0.5, kind: 1 }], 10, { sz: 0.34 });
  hull.rotateZ(Math.PI / 2).scale(len, len * 0.12, len).rotateY(yaw).translate(x, 0.12, z);
  parts.push(hull);
  boxAt(parts, x - Math.cos(yaw) * len * 0.05, 0.12 + len * 0.1, z + Math.sin(yaw) * len * 0.05, len * 0.3, len * 0.1, len * 0.2, yaw, 0, 1);
}

export function buildShoreJetties(scene, walks, ground) {
  const parts = [], near = [], out = { meshes: [], jetties: [] };
  for (const st of walks) {
    const P = st.pts;
    for (let i = 20; i < P.length - 20; i += 55) {
      const [x, z] = P[i], [x0, z0] = P[i - 2], [x1, z1] = P[i + 2];
      let nx = -(z1 - z0), nz = x1 - x0; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      // seaward: the side where the ground falls
      if (ground(x + nx * 20, z + nz * 20) > ground(x - nx * 20, z - nz * 20)) { nx = -nx; nz = -nz; }
      // find where the water is deep enough (seabed below -1.4) within 110 m
      let end = 0;
      for (let t = st.hw + 2; t < 110; t += 2) { if (ground(x + nx * t, z + nz * t) < -1.4) { end = t + 8; break; } }
      if (!end || end < 18) continue;
      const yaw = Math.atan2(-nz, nx), s0 = st.hw + 1.2;
      // the stair from the walk (ground level at the verge) down to the deck
      const gTop = ground(x + nx * s0, z + nz * s0);
      let t = s0, y = gTop;
      while (y - 0.25 > DECK_Y + 0.02 && t < s0 + 16) { const cx = x + nx * (t + 0.2), cz = z + nz * (t + 0.2); boxAt(parts, cx, (y - 0.25 + Math.min(ground(cx, cz), DECK_Y) - 1) / 2, cz, 0.4, y - 0.25 - Math.min(ground(cx, cz), DECK_Y) + 1, DECK_HW * 2, yaw, 1, 9); y -= 0.25; t += 0.4; }
      const d0 = t;
      // the deck and its piles; a T-head at the end
      const len = end - d0;
      if (len < 10) continue;
      const mx = x + nx * (d0 + len / 2), mz = z + nz * (d0 + len / 2);
      boxAt(parts, mx, DECK_Y - 0.2, mz, len, 0.4, DECK_HW * 2, yaw, 8, 8);
      const hx = x + nx * (end + 2), hz = z + nz * (end + 2);
      boxAt(parts, hx, DECK_Y - 0.2, hz, 4, 0.4, 14, yaw, 8, 8);
      for (let u = d0 + 2; u <= end + 3; u += 5) for (const sgn of [-1, 1]) {
        const w = u > end ? 6.4 : DECK_HW - 0.2, px = x + nx * u - nz * sgn * w, pz = z + nz * u + nx * sgn * w, g = ground(px, pz);
        boxAt(near, px, (DECK_Y - 0.4 + g - 0.6) / 2, pz, 0.32, DECK_Y - 0.4 - g + 0.6, 0.32, yaw, 8);
      }
      // rails along the deck, bollards at the head, two boats moored on its lee
      for (const sgn of [-1, 1]) boxAt(near, x + nx * (d0 + len / 2) - nz * sgn * (DECK_HW - 0.1), DECK_Y + 0.5, z + nz * (d0 + len / 2) + nx * sgn * (DECK_HW - 0.1), len, 0.08, 0.08, yaw, 10);
      // the rails' posts, from the deck up under them (the rails no longer float over it)
      for (let u = d0 + 0.3; u <= d0 + len - 0.3 + 1e-6; u += Math.max(1, (len - 0.6) / Math.max(1, Math.round((len - 0.6) / 3)))) for (const sgn of [-1, 1]) {
        boxAt(near, x + nx * u - nz * sgn * (DECK_HW - 0.1), DECK_Y + 0.25, z + nz * u + nx * sgn * (DECK_HW - 0.1), 0.08, 0.5, 0.08, yaw, 10);
      }
      for (const sgn of [-1, 1]) boat(parts, hx + nx * 1 - nz * sgn * 9.5, hz + nz * 1 + nx * sgn * 9.5, yaw + Math.PI / 2, 7 + (i % 3));
      out.jetties.push({ x: hx, z: hz, district: st.district });
    }
  }
  const mat = createFacadeMaterial('sand', 811, { litFrac: 0.4, band: 1e5, uplight: 0 });
  for (const [list, name, layer] of [[parts, 'Shore jetties', 0], [near, 'Shore jetty piles and rails', 1]]) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeClean(list), mat);
    m.name = name; m.castShadow = true; m.receiveShadow = true;
    if (layer) m.layers.set(layer);
    m.matrixAutoUpdate = false; m.updateMatrix();
    scene.add(m); out.meshes.push(m);
  }
  return out;
}
