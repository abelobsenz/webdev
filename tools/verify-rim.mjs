// The Rim's rigor checks (node tools/verify-rim.mjs [--kinds a,b] [--quick]):
//  - every structure's near model and far massing is closed (welded edges used exactly twice with
//    opposite directions, no degenerate or non-finite triangles, outward winding)
//  - every connected solid reaches the drawn ground or rests on a solid that does (actual
//    triangle contact), and shows above the ground
//  - nothing of it stands over a carriageway, in a square, on a lot (podium + apron), on a lamp,
//    in a forecourt terrace, a bridgehead or the Gate's feet, or in another site
//  - the plan: rim lots clear of each other and of every street; lamps off the carriageways
//  - designed trees: rooted on dry land, trunks clear of every structure, street and lot
import * as THREE from 'three';
import { buildTerrainData, HeightSampler } from '../src/world/terrain.js';
import { TOWERS } from '../src/world/layout.js';
import { buildTowers } from '../src/world/towers.js';
import { buildInfrastructure } from '../src/world/infrastructure.js';
import { wardBridgePaths, wardHeight } from '../src/world/metro.js';
import { planCity, obbOverlap } from '../src/world/urban.js';
import { urbanMask } from '../src/world/world.js';
import { buildRim } from '../src/world/rim/rimBuild.js';
import { planInnerCivic } from '../src/world/innerCivic.js';
import { planShorePromenades } from '../src/world/innerShore.js';
import { STRUCTURES } from '../src/world/rim/rimStructures.js';
import { Kit } from '../src/world/rim/rimKit.js';
import { auditGeometry, solidComponents, materialContact } from './geometry-audit.mjs';

const args = process.argv.slice(2);
const onlyKinds = args.includes('--kinds') ? args[args.indexOf('--kinds') + 1].split(',') : null;
const errors = [], counts = {}, examples = {};
const check = (ok, kind, detail) => { if (ok) return; counts[kind] = (counts[kind] || 0) + 1; if (!examples[kind]) examples[kind] = detail; if (errors.length < 40) errors.push(`${kind}: ${JSON.stringify(detail)}`); };
const R1 = (v) => Math.round(v * 10) / 10;

const t0 = Date.now();
const sampler = new HeightSampler(await buildTerrainData()), raw = (x, z) => sampler.get(x, z), ground = (x, z) => Math.max(0, raw(x, z), wardHeight(x, z));
const scene = new THREE.Scene();
const towers = buildTowers(TOWERS, ground, scene), infra = buildInfrastructure(scene, ground, raw), paths = wardBridgePaths(ground);
const heads = paths.filter((b) => b.head).map((b) => ({ x: b.head.x, z: b.head.z, r: Math.hypot(b.head.hw, b.head.hd) + 6, end: 'rim', head: b.head }));
const plan = planCity({ ground: raw, towers, promenades: [...infra.promenades, ...paths.map((b) => b.path)], urbanMask, stations: [...infra.stations, ...heads] });
// as world.js: the inner islands' civic lanes and shore walks are laid over the finished plan
planInnerCivic(plan, towers, raw);
planShorePromenades(plan, raw, towers, [...infra.stations, ...heads].map((s) => ({ x: s.x, z: s.z, r: s.r || 40 })));
const world = { plan, info: null };
const built = buildRim(new THREE.Scene(), world, raw);
const rim = plan.districts.find((d) => d.id === 'rim').rim;
const F = plan.field;
console.log('built in', Date.now() - t0, 'ms; sites', built.sites.length, 'trees', built.trees.length);

// ---- the plan (rim part)
const rimLots = plan.lots.filter((l) => l.district === 'rim');
{
  const G = 48, grid = new Map();
  for (const L of rimLots) { const k = Math.floor(L.x / G) * 100003 + Math.floor(L.z / G); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(L); }
  for (const L of rimLots) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of grid.get((Math.floor(L.x / G) + i) * 100003 + Math.floor(L.z / G) + j) || []) if (o !== L && o.x < L.x && obbOverlap(o, L, 0.5)) check(false, 'rim lot overlaps lot', { a: [R1(L.x), R1(L.z)] });
    const c = Math.cos(L.rot), s = Math.sin(L.rot);
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
      const lx = (u * L.w) / 2 * 0.95, lz = (v * L.d) / 2 * 0.95, x = L.x + lx * c + lz * s, z = L.z - lx * s + lz * c;
      check(F.edge(x, z) > 0, 'rim lot on a carriageway', { at: [R1(L.x), R1(L.z)], street: L.street && L.street.name });
      check(F.squareAt(x, z) < 0.5, 'rim lot in a square', { at: [R1(L.x), R1(L.z)] });
      check(raw(x, z) > 1.5, 'rim lot in the water', { at: [R1(L.x), R1(L.z)] });
      check(rim.block(x, z) > 0, 'rim lot in a keep-out', { at: [R1(L.x), R1(L.z)] });
    }
  }
  for (const l of plan.lamps) if (Math.hypot(l.x, l.z) > 4800) check(F.edge(l.x, l.z) > -0.2, 'rim lamp on a carriageway', { at: [R1(l.x), R1(l.z)] });
}

// ---- the structures
const lotGrid = new Map(), LG = 48;
for (const L of plan.lots) { const r = Math.hypot(L.w, L.d) / 2 + 5; for (let i = Math.floor((L.x - r) / LG); i <= Math.floor((L.x + r) / LG); i++) for (let j = Math.floor((L.z - r) / LG); j <= Math.floor((L.z + r) / LG); j++) { const k = i * 100003 + j; if (!lotGrid.has(k)) lotGrid.set(k, []); lotGrid.get(k).push(L); } }
const inLot = (x, z) => { for (const L of lotGrid.get(Math.floor(x / LG) * 100003 + Math.floor(z / LG)) || []) { const c = Math.cos(L.rot), s = Math.sin(L.rot), dx = x - L.x, dz = z - L.z, u = dx * c - dz * s, v = dx * s + dz * c; if (Math.abs(u) < L.w / 2 + 0.6 && v > -L.d / 2 - 0.6 && v < L.d / 2 + 3.2) return true; } return false; };
const lampGrid = new Map();
for (const l of plan.lamps) { const k = Math.floor(l.x / 16) * 100003 + Math.floor(l.z / 16); if (!lampGrid.has(k)) lampGrid.set(k, []); lampGrid.get(k).push(l); }
const nearLamp = (x, z, r) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const l of lampGrid.get((Math.floor(x / 16) + i) * 100003 + Math.floor(z / 16) + j) || []) if (Math.hypot(l.x - x, l.z - z) < r) return true; return false; };
const siteComps = [];
let tris = { near: 0, far: 0 }, comps = 0;
const byKind = {};
for (const [si, s] of built.sites.entries()) {
  if (onlyKinds && !onlyKinds.includes(s.kind)) continue;
  byKind[s.kind] = (byKind[s.kind] || 0) + 1;
  const kn = new Kit(), kf = new Kit();
  STRUCTURES[s.kind](kn, kf, s, raw);
  for (const [kit, lod] of [[kn, 'near'], [kf, 'far']]) {
    if (!kit.tris) { check(lod === 'far' && s.kind === 'nothing', 'site with no geometry', { kind: s.kind, lod }); continue; }
    const g = kit.build();
    tris[lod] += kit.tris;
    const a = auditGeometry(g, { tolerance: 1e-4 });
    check(a.boundaryEdges + a.nonManifoldEdges + a.inconsistentEdges + a.degenerates + a.nonFinite + a.invalidNormals === 0, `${s.kind} topology`, { lod, site: si, ...a });
    check(a.signedVolume > 0, `${s.kind} winding`, { lod, site: si, volume: a.signedVolume });
    const cs = solidComponents(g);
    comps += cs.length;
    // support: a solid reaches the ground, or rests on one that does
    const grounded = cs.map((c) => c.vertices.some((v) => v.y <= raw(v.x, v.z) + 0.02));
    const supported = grounded.slice();
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (let i = 0; i < cs.length; i++) {
        if (supported[i]) continue;
        for (let j = 0; j < cs.length; j++) if (supported[j] && materialContact(cs[i], cs[j], 0.01)) { supported[i] = true; changed = true; break; }
      }
      if (!changed) break;
    }
    cs.forEach((c, i) => {
      const b = c.bounds;
      check(supported[i], `${s.kind} floating solid`, { lod, site: si, min: [R1(b.min.x), R1(b.min.y), R1(b.min.z)], max: [R1(b.max.x), R1(b.max.y), R1(b.max.z)] });
      const top = c.vertices.reduce((m, v) => (v.y > m.y ? v : m), c.vertices[0]);
      check(top.y > raw(top.x, top.z) + 0.03, `${s.kind} buried solid`, { lod, site: si, at: [R1(top.x), R1(top.y), R1(top.z)] });
    });
    if (lod === 'near') {
      siteComps.push(...cs.map((c) => ({ c, si })));
      // clear of the plan: every vertex that stands above the ground
      let bad = 0;
      for (const c of cs) for (const v of c.vertices) {
        const gy = raw(v.x, v.z);
        if (v.y < gy + 0.05) continue;
        const wet = s.kind === 'boathouse' || s.kind === 'lido' || s.kind === 'beachHuts';
        if (F.edge(v.x, v.z) < -0.05) { check(false, `${s.kind} over a carriageway`, { site: si, at: [R1(v.x), R1(v.y), R1(v.z)] }); bad++; }
        if (F.squareAt(v.x, v.z) > 0.5) { check(false, `${s.kind} in a square`, { site: si, at: [R1(v.x), R1(v.z)] }); bad++; }
        if (inLot(v.x, v.z)) { check(false, `${s.kind} on a lot`, { site: si, at: [R1(v.x), R1(v.z)] }); bad++; }
        if (v.y < gy + 6.8 && nearLamp(v.x, v.z, 0.35)) { check(false, `${s.kind} on a lamp`, { site: si, at: [R1(v.x), R1(v.z)] }); bad++; }
        if (rim.block(v.x, v.z) < 0) { check(false, `${s.kind} in a keep-out`, { site: si, at: [R1(v.x), R1(v.z)] }); bad++; }
        if (!wet && gy < 0.2 && s.kind !== 'lighthouse') { check(false, `${s.kind} over water`, { site: si, at: [R1(v.x), R1(v.z)] }); bad++; }
        if (bad > 3) break;
      }
    }
  }
}
// sites vs each other (actual material)
{
  const G = 64, grid = new Map();
  siteComps.forEach((e, i) => { const b = e.c.bounds; for (let x = Math.floor(b.min.x / G); x <= Math.floor(b.max.x / G); x++) for (let z = Math.floor(b.min.z / G); z <= Math.floor(b.max.z / G); z++) { const k = x * 100003 + z; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); } });
  const seen = new Set();
  for (const list of grid.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const i = list[a], j = list[b];
    if (siteComps[i].si === siteComps[j].si) continue;
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    if (seen.has(key)) continue; seen.add(key);
    if (materialContact(siteComps[i].c, siteComps[j].c, 0.001)) check(false, 'sites intersect', { a: built.sites[siteComps[i].si].kind, b: built.sites[siteComps[j].si].kind, at: siteComps[i].c.bounds.min.toArray().map(R1) });
  }
  // designed trees: rooted on land, trunks clear of structures, streets and lots
  let nt = 0;
  for (const t of built.trees) {
    nt++;
    const g = raw(t.x, t.z);
    check(g > 1.0, 'rim tree in the water', { at: [R1(t.x), R1(t.z)] });
    check(F.edge(t.x, t.z) > 0.3, 'rim tree on a carriageway', { at: [R1(t.x), R1(t.z)], sp: t.sp });
    check(!inLot(t.x, t.z), 'rim tree on a lot', { at: [R1(t.x), R1(t.z)] });
    const trunk = { vertices: [new THREE.Vector3(t.x, g + 1, t.z)], bounds: new THREE.Box3(new THREE.Vector3(t.x - 0.3, g, t.z - 0.3), new THREE.Vector3(t.x + 0.3, g + 3, t.z + 0.3)) };
    for (const k of grid.get(Math.floor(t.x / G) * 100003 + Math.floor(t.z / G)) || []) {
      const c = siteComps[k].c;
      if (!c.bounds.intersectsBox(trunk.bounds)) continue;
      const box = new THREE.BoxGeometry(0.6, 3, 0.6).translate(t.x, g + 1.5, t.z);
      const [tc] = solidComponents(box);
      if (materialContact(tc, c, 0.001)) { check(false, 'rim tree trunk in a structure', { at: [R1(t.x), R1(t.z)], kind: built.sites[siteComps[k].si].kind }); break; }
    }
  }
  console.log('trees checked', nt);
}
console.log('RIM_SURVEY ' + JSON.stringify({ sites: built.sites.length, byKind, components: comps, tris, rimLots: rimLots.length, lamps: plan.lamps.length, ms: Date.now() - t0 }));
console.log('RIM_ERRORS ' + JSON.stringify({ counts, examples }, null, 1));
if (!errors.length) console.log('RIM_VERIFIED'); else { console.log(errors.slice(0, 20).join('\n')); process.exitCode = 1; }
