import * as THREE from 'three';
import { latheFacade, sweepTube, mergeClean } from './geom.js';
import { extrudeAlong, frameAt } from './infrastructure.js';
import { createFacadeMaterial } from './facade.js';
import { patchedMaterial } from './materials.js';
import { terrainHeight } from './terrain.js';
import { sweepLoop, capPolys } from './platform.js';
import { outerCities, renderedHeight } from './outerCities.js';
import { wardHeight, WARD_TOP, RING_BEARING } from './metro.js';
import { U } from '../core/uniforms.js';

// The metropolitan transit network of Greater Meridian.
//
//  The Great Ring   a vacuum-tube maglev under the sea joining the seven wards and the three
//                   massif towns. At every stop the line surfaces through a sculpted portal in
//                   the sea, rides an open guideway into a glass rotunda on its own station
//                   island, and dives again on the other side. A footbridge joins each island
//                   to its ward (or to the massif shore). Soft lines of light in the water and
//                   a chain of buoys mark the tube's course between the portals.
//  Far lines        the same tubes out to the five island cities, each surfacing at a station
//                   island off the city's harbour.
//  Gondolas         cable cars from the massif stations up to the terrace towns.
//  The canal line   a light guideway over Tidewater's Grand Canal.
//  Sea lanes        hydrofoil ferries between the ward harbours and the island cities.
//  Sky-ships        airships from the mooring halo of Southmarch's crown.
// This module builds the structures and returns every route for src/life/transit.js.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

export const RING_ORDER = ['aurora', 'sunward', 'tidewater', 'seraph', 'southmarch', 'coral', 'westmere', 'ridgeholm', 'highgate', 'cloudmere'];
export const FAR_LINES = [['sunward', 'orison'], ['seraph', 'thalassa'], ['southmarch', 'austral'], ['southmarch', 'vesper'], ['coral', 'anchorage']];

const ISLAND_R = 78, TERRACE_R = 62, ROT_R = 24, GUIDE_Y = 11.5, PORTAL_D = 340;

// -------------------------------------------------------------- geometry --
const circle = (cx, cz, r, n = 72) => { const p = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU; p.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } return p; };
const gapAt = (gaps) => (x, z) => { let g = 0; for (const q of gaps) { const d = Math.hypot(x - q.x, z - q.z) - q.hw; if (d < 2) g = Math.max(g, 1 - ss(0, 2, d)); } return g; };

/** A round station island: sea wall, quay, terrace wall, a garden top round the rotunda. */
function stationIsland(parts, n, gaps) {
  const { x, z } = n;
  const gA = gapAt(gaps);
  parts.push(sweepLoop(circle(0, 0, ISLAND_R), () => [
    { a: [3.0, -14], b: [0, 2.3], kind: 1 },
    { a: [0, 2.3], b: [0, 3.45], kind: 10 },
    { a: [0, 3.45], b: [-0.7, 3.45], kind: 1 },
    { a: [-0.7, 3.45], b: [-0.7, 2.95], kind: 1 },
  ], { ox: x, oz: z }));
  parts.push(capPolys([{ outer: circle(0, 0, ISLAND_R), holes: [circle(0, 0, TERRACE_R).reverse()] }], 3.0, 9, { ox: x, oz: z }));
  parts.push(sweepLoop(circle(0, 0, TERRACE_R), (lx, lz) => {
    const g = gA(x + lx, z + lz);
    const ph = 0.45 * (1 - g), cw = 0.8 * (1 - g);
    return [
      { a: [0, 2.9], b: [0, 9 + ph], kind: 5 },
      { a: [0, 9 + ph], b: [-cw, 9 + ph], kind: 1 },
      { a: [-cw, 9 + ph], b: [-cw, 8.95], kind: 1 },
    ];
  }, { ox: x, oz: z }));
  parts.push(capPolys([{ outer: circle(0, 0, TERRACE_R), holes: [circle(0, 0, ROT_R - 0.6).reverse()] }], 9.0, 3, { ox: x, oz: z }));
}

/** The rotunda: a drum of glass under a glowing lens roof and a lantern spire. */
function rotunda(parts, n) {
  const g = latheFacade([
    { r: ROT_R + 0.8, y: 8.4, kind: 1 }, { r: ROT_R + 0.8, y: 9.6, kind: 1 }, { r: ROT_R, y: 9.6, kind: 1 },
    { r: ROT_R, y: 9.8, kind: 0 }, { r: ROT_R, y: 21, kind: 0 }, { r: ROT_R + 1.6, y: 21.4, kind: 1 }, { r: ROT_R + 1.6, y: 22.6, kind: 1 },
    { r: ROT_R + 1.0, y: 22.6, kind: 2 }, { r: ROT_R * 0.7, y: 26.5, kind: 2 }, { r: ROT_R * 0.3, y: 28.5, kind: 2 }, { r: 2.2, y: 29, kind: 1 },
    { r: 1.4, y: 34, kind: 1 }, { r: 0.9, y: 34.4, kind: 2 }, { r: 0.05, y: 38, kind: 1 },
  ], 48);
  parts.push(g.translate(n.x, 0, n.z));
  // ribs up the drum
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    const p0 = V(n.x + Math.cos(a) * (ROT_R + 0.3), 9.6, n.z + Math.sin(a) * (ROT_R + 0.3));
    parts.push(sweepTube([p0, p0.clone().setY(21.4)], () => 0.32, 5, { kind: 1 }));
  }
}

/** Open guideway: a box beam with a lit coil line, on piers. */
function guideway(parts, pts, ground, { pierEvery = 36, beam = [3.2, 2.4], avoid = null } = {}) {
  const hw = beam[0] / 2, d = beam[1];
  const sec = [[-hw, 0.0], [-hw * 0.45, 0.35], [hw * 0.45, 0.35], [hw, 0.0], [hw * 0.8, -d], [-hw * 0.8, -d]].reverse();
  const kinds = (i) => (i === 3 ? 10 : 1);
  parts.push(extrudeAlong(pts, sec, kinds));
  // the coil line along the top
  parts.push(sweepTube(pts.map((p) => p.clone().add(V(0, 0.42, 0))), () => 0.14, 4, { kind: 2 }));
  let acc = pierEvery * 0.5;
  for (let i = 1; i < pts.length; i++) {
    acc += pts[i].distanceTo(pts[i - 1]);
    if (acc < pierEvery) continue;
    acc = 0;
    const p = pts[i];
    if (p.y < 2.5) continue;
    if (avoid && avoid(p.x, p.z)) continue;
    const g = ground(p.x, p.z);
    if (p.y - d - g < 1) continue;
    parts.push(latheFacade([{ r: 1.3, y: g - 8, kind: 1 }, { r: 1.0, y: p.y - d - 1.6, kind: 1 }, { r: hw * 0.95, y: p.y - d - 0.2, kind: 1 }, { r: hw * 0.95, y: p.y - d + 0.05, kind: 1 }], 8).translate(p.x, 0, p.z));
  }
}

/** The portal: ribs of a sculpted shell closing over the guideway where it dives. */
function portal(parts, p, dir, lights, glowCol) {
  const side = V(-dir.z, 0, dir.x);
  const ribs = 7;
  for (let k = 0; k < ribs; k++) {
    const t = k / (ribs - 1);
    const c = p.clone().addScaledVector(dir, -6 + t * 42);
    const w = 17 - 8 * t, h = 20 - 13 * t;
    const arc = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI;
      arc.push(c.clone().addScaledVector(side, Math.cos(a) * w).add(V(0, -1.5 + Math.sin(a) * h, 0)).addScaledVector(dir, Math.sin(a) * 4 * (1 - t)));
    }
    parts.push(sweepTube(arc, (u) => (1.4 - 0.7 * t) * (0.7 + 0.5 * Math.sin(Math.PI * u)), 8, { kind: k === 0 ? 2 : 1 }));
  }
  // spine ridge and the foundation in the sea
  const spine = [];
  for (let k = 0; k <= 12; k++) { const t = k / 12; spine.push(p.clone().addScaledVector(dir, -6 + t * 42).add(V(0, -1.5 + 20 - 13 * t + 0.8, 0))); }
  parts.push(sweepTube(spine, (u) => 1.6 - 0.9 * u, 8, { kind: 1 }));
  const found = latheFacade([{ r: 22, y: -14, kind: 1 }, { r: 20, y: -0.6, kind: 1 }, { r: 19.6, y: 0.8, kind: 10 }, { r: 18.8, y: 0.8, kind: 1 }], 32, { sx: 1.0, sz: 1.35 });
  found.rotateY(-Math.atan2(dir.z, dir.x) + Math.PI / 2);
  const fc = p.clone().addScaledVector(dir, 16);
  parts.push(found.translate(fc.x, 0, fc.z));
  const fin = p.clone().addScaledVector(dir, -6).add(V(0, 20.5, 0));
  parts.push(latheFacade([{ r: 1.2, y: 0, kind: 1 }, { r: 0.8, y: 3.5, kind: 2 }, { r: 0.05, y: 6, kind: 1 }], 10).translate(fin.x, fin.y, fin.z));
  lights.push({ x: fin.x, y: fin.y + 4.5, z: fin.z, c: glowCol, s: 2.2 });
}

/** A footbridge deck (12 m) from a to b (Vector3 at deck level), arching, on slender piers. */
function footbridge(parts, a, b, ground, lamps) {
  const L = a.distanceTo(b);
  const n = Math.max(8, Math.ceil(L / 15));
  const path = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const p = a.clone().lerp(b, t);
    p.y = a.y + (b.y - a.y) * t + Math.min(12, L * 0.025) * Math.sin(Math.PI * t);
    path.push(p);
  }
  const sec = [[-6.2, 0.0], [-6.5, 1.1], [-6.5, 1.1], [-5.8, 1.25], [-5.8, 1.25], [-5.4, 0.2], [-5.4, 0.2], [5.4, 0.2], [5.4, 0.2], [5.8, 1.25], [5.8, 1.25], [6.5, 1.1], [6.5, 1.1], [6.2, 0.0], [4.5, -2.0], [-4.5, -2.0]];
  const kinds = [1, 2, 1, 2, 1, 1, 1, 15, 1, 1, 1, 2, 1, 2, 1, 1, 1];
  parts.push(extrudeAlong(path, sec, (i) => kinds[i]));
  let acc = 0;
  for (let k = 1; k < path.length - 1; k++) {
    acc += path[k].distanceTo(path[k - 1]);
    const p = path[k];
    if (acc >= 60) {
      acc = 0;
      const g = ground(p.x, p.z);
      if (p.y - 2 - g > 3) parts.push(latheFacade([{ r: 2.2, y: g - 10, kind: 1 }, { r: 1.6, y: p.y - 3.4, kind: 1 }, { r: 4.6, y: p.y - 2.0, kind: 1 }], 10).translate(p.x, 0, p.z));
    }
    if (k % 2 === 0) {
      const { side } = frameAt(path, k);
      const s = (k & 2) ? 1 : -1;
      const q = p.clone().addScaledVector(side, s * 5.0);
      lamps.push({ x: q.x, y: p.y + 0.2, z: q.z, yaw: Math.atan2(-side.x * s, -side.z * s), cls: 4 });
    }
  }
  return path;
}

/** A bridgehead podium on natural ground (massif shore, island harbours). */
function shorePodium(parts, cx, cz, rot, hw, hd, ground) {
  let hi = -1e9, lo = 1e9;
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let a = -hw; a <= hw; a += 8) for (let b = -hd; b <= hd; b += 8) { const g = ground(cx + a * c - b * s, cz + a * s + b * c); hi = Math.max(hi, g); lo = Math.min(lo, g); }
  const top = Math.max(hi, 3) + 2.5;
  const ring = [];
  const rr = 8;
  const cs = [[hw - rr, hd - rr, 0], [-hw + rr, hd - rr, 1], [-hw + rr, -hd + rr, 2], [hw - rr, -hd + rr, 3]];
  for (const [px, pz, q] of cs) for (let i = 0; i <= 5; i++) { const a = (q + i / 5) * (Math.PI / 2); const lx = px + Math.cos(a) * rr, lz = pz + Math.sin(a) * rr; ring.push([lx * c - lz * s, lx * s + lz * c]); }
  parts.push(sweepLoop(ring, () => [
    { a: [0, Math.min(lo, top - 3) - 3], b: [0, top - 1.2], kind: 5 },
    { a: [0, top - 1.2], b: [0, top + 0.9], kind: 1 },
    { a: [0, top + 0.9], b: [-0.8, top + 0.9], kind: 1 },
    { a: [-0.8, top + 0.9], b: [-0.8, top - 0.05], kind: 1 },
  ], { ox: cx, oz: cz }));
  parts.push(capPolys([{ outer: ring, holes: [] }], top, 9, { ox: cx, oz: cz }));
  return top;
}

/** Tapered lattice pylon for the gondolas: four legs, cross-bracing, a head with two sheaves. */
function gondolaPylon(parts, p, dir, h, g) {
  const side = V(-dir.z, 0, dir.x);
  const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const top = V(p.x, g + h, p.z);
  for (const [a, b] of legs) {
    const foot = V(p.x, g - 2, p.z).addScaledVector(side, a * 4.5).addScaledVector(dir, b * 3.5);
    const head = top.clone().addScaledVector(side, a * 1.2).addScaledVector(dir, b * 1.0);
    parts.push(sweepTube([foot, head], () => 0.45, 5, { kind: 1 }));
  }
  for (let k = 1; k < 5; k++) {
    const y = g + (h * k) / 5;
    const w = 4.5 - 3.3 * (k / 5), dd = 3.5 - 2.5 * (k / 5);
    const q = legs.map(([a, b]) => V(p.x, y, p.z).addScaledVector(side, a * w).addScaledVector(dir, b * dd));
    for (let i = 0; i < 4; i++) parts.push(sweepTube([q[i], q[(i + 1) % 4]], () => 0.2, 4, { kind: 1 }));
  }
  const arm = [top.clone().addScaledVector(side, -7), top.clone().addScaledVector(side, 7)];
  parts.push(sweepTube(arm, () => 0.7, 6, { kind: 1 }));
  for (const s of [-1, 1]) parts.push(latheFacade([{ r: 0.2, y: -0.5, kind: 10 }, { r: 1.4, y: -0.5, kind: 10 }, { r: 1.4, y: 0.5, kind: 2 }, { r: 0.2, y: 0.5, kind: 10 }], 12).rotateX(Math.PI / 2).rotateY(-Math.atan2(dir.z, dir.x) + Math.PI / 2).translate(top.x + side.x * s * 5, top.y - 0.9, top.z + side.z * s * 5));
  return top;
}

// ------------------------------------------------------------------ build --
export function buildTransit(scene, world) {
  const recs = world.metro.wards.map((w) => w.rec);
  const ground = (x, z) => Math.max(renderedHeight(x, z), wardHeight(x, z), -30);
  const oc = outerCities();
  const parts = [];                // always visible structures
  const nearParts = [];            // small detail
  const lights = [];
  const lamps = [];
  const stations = [];
  const colliders = [];
  const nodes = new Map();
  // ---- nodes: a station island for every ward, massif town and island city
  for (const rec of recs) {
    const w = rec.w;
    const L = rec.landings.find((q) => q.kind === 'ring');
    const d = [Math.cos(L.b), Math.sin(L.b)];
    const E = [w.x + L.E[0], w.z + L.E[1]];
    const off = rec.quayW(L.b) + 430;
    nodes.set(w.id, { id: w.id, name: w.name, kind: 'ward', x: E[0] + d[0] * off, z: E[1] + d[1] * off, land: V(E[0] + L.t[0] * 1.0, WARD_TOP + 0.3, E[1] + L.t[1] * 1.0), toLand: [-d[0], -d[1]] });
  }
  for (const m of oc.massif) nodes.set(m.id, { id: m.id, name: m.name, kind: 'massif', x: m.station.x, z: m.station.z, city: m, toLand: [0, -1] });
  for (const f of oc.islands) nodes.set(f.id, { id: f.id, name: f.name, kind: 'far', x: f.station.x, z: f.station.z, city: f, toLand: [-f.d[0], -f.d[1]] });
  // ---- the lines through each node, and the ports where they leave it
  const lineDefs = [];
  for (let i = 0; i < RING_ORDER.length; i++) lineDefs.push({ line: 'ring', a: RING_ORDER[i], b: RING_ORDER[(i + 1) % RING_ORDER.length] });
  for (const [a, b] of FAR_LINES) lineDefs.push({ line: `far-${b}`, a, b });
  const ports = new Map();
  const portOf = (id) => { if (!ports.has(id)) ports.set(id, []); return ports.get(id); };
  const openWater = (x, z, r = 70) => {
    for (let a = 0; a < TAU; a += Math.PI / 4) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (terrainHeight(px, pz) > -4 || wardHeight(px, pz) > -1e9) return false; }
    return terrainHeight(x, z) < -4 && wardHeight(x, z) === -Infinity;
  };
  for (const ld of lineDefs) {
    const A = nodes.get(ld.a), B = nodes.get(ld.b);
    for (const [N, O] of [[A, B], [B, A]]) {
      let ang = Math.atan2(O.z - N.z, O.x - N.x);
      const landAng = Math.atan2(N.toLand[1], N.toLand[0]);
      // keep clear of the footbridge and of the other ports, and dive in open water
      const taken = portOf(N.id).map((p) => p.ang);
      let best = null;
      for (let k = 0; k <= 36 && !best; k++) for (const sg of [1, -1]) {
        const a = ang + sg * k * 0.07;
        const dl = Math.abs(Math.atan2(Math.sin(a - landAng), Math.cos(a - landAng)));
        if (dl < 0.62) continue;
        if (taken.some((t) => Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t))) < 0.5)) continue;
        const px = N.x + Math.cos(a) * PORTAL_D, pz = N.z + Math.sin(a) * PORTAL_D;
        if (!openWater(px, pz)) continue;
        let clearRun = true;
        for (let r = ISLAND_R + 10; r < PORTAL_D + 60; r += 30) if (!openWater(N.x + Math.cos(a) * r, N.z + Math.sin(a) * r, 24)) { clearRun = false; break; }
        if (!clearRun) continue;
        best = a; break;
      }
      if (best === null) best = ang;
      const port = { ang: best, line: ld.line, to: O.id };
      portOf(N.id).push(port);
      if (N === A) ld.portA = port; else ld.portB = port;
    }
  }
  // ---- build every node
  const glowRing = [0.35, 0.95, 1.0], glowFar = [1.0, 0.78, 0.45];
  const portPath = new Map();          // `${node}|${to}|${line}` -> Vector3[] from the rotunda out to below the sea
  for (const N of nodes.values()) {
    const landDir = V(N.toLand[0], 0, N.toLand[1]);
    const gaps = [{ x: N.x + landDir.x * TERRACE_R, z: N.z + landDir.z * TERRACE_R, hw: 6.5 }];
    stationIsland(parts, N, gaps);
    rotunda(parts, N);
    colliders.push({ x: N.x, z: N.z, y0: -10, y1: 40, radius: ISLAND_R });
    // the footbridge to the land
    const a = V(N.x + landDir.x * (TERRACE_R - 1), 9.3, N.z + landDir.z * (TERRACE_R - 1));
    let b;
    if (N.kind === 'ward') b = N.land.clone();
    else if (N.kind === 'far') {
      // onto the city's harbour quay (built out to the 3.5 m isobath, see skyline.js)
      const c = N.city;
      b = V(c.deep.x - c.d[0] * 22, 3.75, c.deep.z - c.d[1] * 22);
    } else {
      // a podium on the massif shore where the footbridge lands and the gondola begins
      const shore = N.city.coast;
      const rot = Math.atan2(-landDir.z, -landDir.x);
      const cx = shore.x + landDir.x * 30, cz = shore.z + landDir.z * 30;
      const top = shorePodium(parts, cx, cz, rot, 42, 34, renderedHeight);
      N.podium = { x: cx, z: cz, top, rot };
      b = V(cx - landDir.x * 40, top + 0.3, cz - landDir.z * 40);
    }
    const fb = footbridge(parts, a, b, ground, lamps);
    N.footbridge = fb;
    // guideways out to the portals
    for (const p of portOf(N.id)) {
      const d = V(Math.cos(p.ang), 0, Math.sin(p.ang));
      const pts = [];
      for (let r = ROT_R - 2; r <= PORTAL_D + 120; r += 6) {
        let y;
        if (r <= ISLAND_R + 8) y = GUIDE_Y;
        else if (r <= PORTAL_D) y = GUIDE_Y + (1.2 - GUIDE_Y) * ss(ISLAND_R + 8, PORTAL_D, r);
        else y = 1.2 - (r - PORTAL_D) * 0.22;
        pts.push(V(N.x + d.x * r, y, N.z + d.z * r));
      }
      const visible = pts.filter((q) => q.y > -3);
      guideway(parts, visible, ground);
      portal(parts, V(N.x + d.x * PORTAL_D, 0, N.z + d.z * PORTAL_D), d, lights, p.line === 'ring' ? glowRing : glowFar);
      portPath.set(`${N.id}|${p.to}|${p.line}`, pts);
      colliders.push({ x: N.x + d.x * PORTAL_D, z: N.z + d.z * PORTAL_D, y0: -10, y1: 24, radius: 24 });
    }
    lights.push({ x: N.x, y: 38.5, z: N.z, c: [1.0, 0.9, 0.75], s: 2.5 });
    stations.push({ x: N.x, z: N.z, r: ISLAND_R, y: 9.3, name: N.name, kind: 'ring-island', node: N.id });
  }
  // ---- the lines: routes through the portals, hidden below the sea, lit in the water
  const routes = [];
  const glowPaths = [];
  const buoys = [];
  const seg = (N, to, line, reverse) => { const p = portPath.get(`${N}|${to}|${line}`); return reverse ? p.slice().reverse() : p; };
  const underwater = (a, b) => {
    // the tube between two portals: dives to 30 m and runs straight
    const pts = [];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(2, Math.ceil(L / 400));
    for (let k = 1; k < n; k++) { const t = k / n; pts.push(V(a.x + (b.x - a.x) * t, -30, a.z + (b.z - a.z) * t)); }
    return pts;
  };
  const buildLine = (ids, line, closed, glow = true) => {
    // ids: node ids in order; closed: a ring (else a shuttle out and back)
    const pts = [], stops = [];
    const order = closed ? ids : [...ids, ...ids.slice(0, -1).reverse()];
    const hops = closed ? order.length : order.length - 1;
    for (let i = 0; i < hops; i++) {
      const A = order[i], B = order[(i + 1) % order.length];
      const lineId = line;
      const out = seg(A, B, lineId, false);
      const inn = seg(B, A, lineId, true);
      if (!out || !inn) continue;
      // leave A: from the rotunda out through its portal
      if (i === 0 || !closed) { stops.push(pts.length); }
      for (const p of out) pts.push(p.clone());
      const u = underwater(out[out.length - 1], inn[0]);
      for (const p of u) pts.push(p);
      for (const p of inn) pts.push(p.clone());
      stops.push(pts.length - 1);
      if (glow && (closed || i < ids.length - 1)) glowPaths.push({ a: out[out.length - 1], b: inn[0], col: line === 'ring' ? glowRing : glowFar });
    }
    // stops sit at the rotunda centres: the last point of each inbound run
    const uniq = [];
    for (const p of pts) { const l = uniq[uniq.length - 1]; if (!l || l.distanceTo(p) > 0.5) uniq.push(p); }
    const S = [];
    let acc = 0;
    const cum = [0];
    for (let i = 1; i < uniq.length; i++) { acc += uniq[i].distanceTo(uniq[i - 1]); cum.push(acc); }
    // find rotunda passes: points within 3 m of a node centre at guideway height
    for (let i = 0; i < uniq.length; i++) {
      const p = uniq[i];
      for (const N of nodes.values()) if (Math.hypot(p.x - N.x, p.z - N.z) < ROT_R - 1 && Math.abs(p.y - GUIDE_Y) < 0.5) {
        if (!S.length || cum[i] - S[S.length - 1].s > 200) S.push({ s: cum[i], node: N.id });
      }
    }
    routes.push({ line, pts: uniq, stops: S, closed: true, kind: 'maglev' });
  };
  buildLine(RING_ORDER, 'ring', true);
  buildLine([...RING_ORDER].reverse(), 'ring', true, false);
  for (const [a, b] of FAR_LINES) buildLine([a, b], `far-${b}`, false);
  // glows in the water and a chain of buoys between the portals
  for (const g of glowPaths) {
    const L = Math.hypot(g.b.x - g.a.x, g.b.z - g.a.z);
    for (let s = 300; s < L - 300; s += 520) {
      const t = s / L;
      buoys.push({ x: g.a.x + (g.b.x - g.a.x) * t, z: g.a.z + (g.b.z - g.a.z) * t, c: g.col });
    }
  }
  for (const b of buoys) lights.push({ x: b.x, y: 3.2, z: b.z, c: b.c, s: 1.1 });
  // ---- gondolas: from each massif station up to its terrace town
  const gondolas = [];
  for (const m of oc.massif) {
    const N = nodes.get(m.id);
    const P0 = N.podium;
    const base = V(P0.x + Math.cos(P0.rot) * 8, P0.top, P0.z + Math.sin(P0.rot) * 8);
    const topG = renderedHeight(m.town.x, m.town.z);
    const top = V(m.town.x, topG + 2, m.town.z);
    const dir = V(top.x - base.x, 0, top.z - base.z).normalize();
    const side = V(-dir.z, 0, dir.x);
    const Lh = Math.hypot(top.x - base.x, top.z - base.z);
    const heads = [base.clone().add(V(0, 12, 0))];
    const nP = Math.max(3, Math.round(Lh / 330));
    for (let k = 1; k < nP; k++) {
      const t = k / nP;
      const p = base.clone().lerp(top, t);
      const g = renderedHeight(p.x, p.z);
      heads.push(gondolaPylon(parts, p, dir, 38 + 10 * Math.sin(Math.PI * t), g).clone().add(V(0, -0.9, 0)));
      colliders.push({ x: p.x, z: p.z, y0: g, y1: g + 50, radius: 10 });
    }
    heads.push(top.clone().add(V(0, 12, 0)));
    // stations: a glazed hall at each end over the bullwheels
    for (const [c, sgn] of [[base, 1], [top, -1]]) {
      const hall = latheFacade([{ r: 12, y: c.y - 3, kind: 1 }, { r: 12, y: c.y + 0.6, kind: 1 }, { r: 11, y: c.y + 0.6, kind: 0 }, { r: 11, y: c.y + 9, kind: 0 }, { r: 12.5, y: c.y + 9.4, kind: 1 }, { r: 12.5, y: c.y + 10.2, kind: 1 }, { r: 8, y: c.y + 13.5, kind: 2 }, { r: 0.2, y: c.y + 14.5, kind: 1 }], 32, { sx: 1.4, sz: 1 });
      hall.rotateY(-Math.atan2(dir.z, dir.x));
      parts.push(hall.translate(c.x + dir.x * 4 * sgn, 0, c.z + dir.z * 4 * sgn));
      if (sgn < 0) {
        // the top station stands on its own terrace podium
        parts.push(latheFacade([{ r: 20, y: c.y - 14, kind: 5 }, { r: 20, y: c.y - 3, kind: 5 }, { r: 20.8, y: c.y - 2.6, kind: 1 }, { r: 20.8, y: c.y - 2.2, kind: 1 }, { r: 0.2, y: c.y - 2.2, kind: 9 }], 40).translate(c.x, 0, c.z));
      }
    }
    // cables: an up line and a down line 10 m apart, sagging between the heads
    const cable = (s) => {
      const pts = [];
      for (let k = 0; k < heads.length - 1; k++) {
        const a = heads[k].clone().addScaledVector(side, s * 5), b = heads[k + 1].clone().addScaledVector(side, s * 5);
        const span = a.distanceTo(b);
        for (let i = 0; i <= 16; i++) { if (k > 0 && i === 0) continue; const t = i / 16; const p = a.clone().lerp(b, t); p.y -= span * 0.018 * 4 * t * (1 - t); pts.push(p); }
      }
      return pts;
    };
    const up = cable(1), down = cable(-1);
    parts.push(sweepTube(up, () => 0.22, 4, { kind: 10 }), sweepTube(down, () => 0.22, 4, { kind: 10 }));
    gondolas.push({ id: m.id, up, down, base, top, dir, side });
  }
  // ---- the canal line: a light guideway looping over Tidewater's ring canal, with stops
  // above the canal bridges (a stair tower rises from each bridge deck to the platform)
  const canalLines = [];
  {
    const tw = recs.find((r) => r.w.id === 'tidewater');
    if (tw && tw.ctx.ringCanal) {
      const Rc = tw.ctx.ringCanal, Y = 23;
      const cx = tw.w.x, cz = tw.w.z;
      const n = Math.ceil((TAU * Rc) / 6);
      const loop = [];
      for (let i = 0; i <= n; i++) { const a = (i / n) * TAU; loop.push(V(cx + Math.cos(a) * Rc, Y, cz + Math.sin(a) * Rc)); }
      const bridges = (tw.plan ? tw.plan.bridges : []).map((b) => ({ x: cx + (b.a[0] + b.b[0]) / 2, z: cz + (b.a[1] + b.b[1]) / 2, b })).filter((q) => Math.abs(Math.hypot(q.x - cx, q.z - cz) - Rc) < 30);
      guideway(parts, loop, (x, z) => -7.5, { pierEvery: 44, beam: [2.4, 1.8], avoid: (x, z) => bridges.some((q) => Math.hypot(q.x - x, q.z - z) < 16) });
      const stops = [];
      for (const q of bridges.slice(0, 6)) {
        const a = Math.atan2(q.z - cz, q.x - cx);
        const i = Math.round((((a % TAU) + TAU) % TAU) / TAU * n) % n;
        const p = loop[i];
        const t = V(-Math.sin(a), 0, Math.cos(a));
        const shelter = latheFacade([{ r: 3.0, y: 0.4, kind: 1 }, { r: 3.0, y: 0.8, kind: 0 }, { r: 3.0, y: 3.6, kind: 0 }, { r: 3.4, y: 3.8, kind: 1 }, { r: 0.2, y: 4.4, kind: 2 }], 16, { sx: 4.4, sz: 1 });
        shelter.rotateY(-Math.atan2(t.z, t.x));
        const sp = p.clone().add(V(Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2));
        parts.push(shelter.translate(sp.x, Y, sp.z));
        // the stair tower on the bridge deck, 9 m along the canal from the platform
        const tp = p.clone().addScaledVector(t, 9);
        const deck = 9 + 0.35 + Math.min(3.2, 22 * 0.06 + 0.8);
        parts.push(latheFacade([{ r: 2.8, y: deck - 0.3, kind: 1 }, { r: 2.8, y: deck + 0.5, kind: 1 }, { r: 2.4, y: deck + 0.5, kind: 0 }, { r: 2.4, y: Y + 3.4, kind: 0 }, { r: 2.9, y: Y + 3.8, kind: 1 }, { r: 0.2, y: Y + 4.5, kind: 2 }], 16).translate(tp.x, 0, tp.z));
        parts.push(sweepTube([tp.clone().setY(Y + 1.2).addScaledVector(t, -2.2), sp.clone().setY(Y + 1.2).addScaledVector(t, 3.2)], () => 1.3, 8, { kind: 0 }));
        stops.push(i);
      }
      canalLines.push({ pts: loop.slice(0, n), stops, closed: true });
    }
  }
  // ---- meshes
  const mat = createFacadeMaterial('pearl', 1234, { litFrac: 0.7, band: 1e5, warmth: 0.6 });
  const mesh = new THREE.Mesh(mergeClean(parts), mat);
  mesh.name = 'Transit network';
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  scene.add(mesh);
  const meshes = [mesh];
  // glows in the water: soft ribbons along the tube for the first 1.4 km from every portal
  const gpos = [], gcol = [], gidx = [];
  for (const g of glowPaths) {
    const L = Math.hypot(g.b.x - g.a.x, g.b.z - g.a.z);
    const d = [(g.b.x - g.a.x) / L, (g.b.z - g.a.z) / L], sd = [-d[1], d[0]];
    for (const [from, sign] of [[g.a, 1], [g.b, -1]]) {
      const n = 28;
      const base = gpos.length / 3;
      for (let i = 0; i <= n; i++) {
        const s = (i / n) * Math.min(1400, L / 2);
        const f = Math.pow(1 - i / n, 1.5);
        const cx = from.x + d[0] * s * sign, cz = from.z + d[1] * s * sign;
        for (const q of [-1, 1]) { gpos.push(cx + sd[0] * q * 1.6, -2.6, cz + sd[1] * q * 1.6); gcol.push(g.col[0] * f, g.col[1] * f, g.col[2] * f); }
      }
      for (let i = 0; i < n; i++) { const a = base + i * 2; gidx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  }
  if (gpos.length) {
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
    gg.setAttribute('color', new THREE.Float32BufferAttribute(gcol, 3));
    gg.setIndex(gidx);
    const gm = new THREE.ShaderMaterial({
      uniforms: { uCityLights: U.uCityLights, uTime: U.uTime },
      vertexShader: 'attribute vec3 color; varying vec3 vCol; varying float vD; void main() { vCol = color; vec4 mv = viewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uCityLights; varying vec3 vCol; varying float vD; void main() { float fade = 1.0 - smoothstep(6000.0, 16000.0, vD); gl_FragColor = vec4(vCol * (0.05 + 0.55 * uCityLights) * fade, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const glow = new THREE.Mesh(gg, gm);
    glow.name = 'Great Ring glows';
    glow.frustumCulled = false;
    glow.renderOrder = 8;
    scene.add(glow);
    meshes.push(glow);
    if (world.reflectionHide) world.reflectionHide.push(glow);
  }
  // buoys (instanced) and every station, portal and buoy light
  if (buoys.length) {
    const bg = mergeClean([latheFacade([{ r: 0.05, y: -1.2, kind: 10 }, { r: 1.1, y: -0.6, kind: 10 }, { r: 1.2, y: 0.6, kind: 1 }, { r: 0.4, y: 1.2, kind: 1 }, { r: 0.25, y: 2.8, kind: 1 }, { r: 0.4, y: 3.0, kind: 2 }, { r: 0.05, y: 3.4, kind: 1 }], 10)]);
    const bm = new THREE.InstancedMesh(bg, mat, buoys.length);
    const m4 = new THREE.Matrix4();
    buoys.forEach((b, i) => { m4.makeTranslation(b.x, 0, b.z); bm.setMatrixAt(i, m4); });
    bm.instanceMatrix.needsUpdate = true;
    bm.name = 'Great Ring buoys';
    scene.add(bm);
    meshes.push(bm);
  }
  if (world.colliders) world.colliders.push(...colliders);
  return { meshes, nodes, routes, gondolas, canalLines, lights, lamps, stations, glowPaths, buoys, ports };
}
