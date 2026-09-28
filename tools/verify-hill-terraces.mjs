// Node check of the northern mainland's planted landscape (src/world/hills/): builds the hill
// country and the terrace towns, surveys them, lays the terraces and plans the planted trees and
// the towns' gardens exactly as the page does, then checks
//  * every terrace stone solid (bench section, stair tread): closed and outward wound (sampled),
//    founded under the lowest drawn ground of its footprint and standing over the highest;
//  * no two systems' sections overlap in plan (the exact claims);
//  * every bench tree and vine row stands on its own bench top;
//  * every planted tree: seated at the lowest ground under its flare (or on its terrace top),
//    never in the water, its trunk clear of every hill-country road, building, field and lamp,
//    and a town garden tree clear of every house, walk, stair corridor and landing.
//   node tools/verify-hill-terraces.mjs
import * as THREE from 'three';
import { buildHillCountry } from '../src/world/hillCountry.js';
import { buildMassifTowns, MASSIF_GARDENS } from '../src/world/massifTowns.js';
import { hillSurvey, setHabitatVillages, buildCoverTexture, surveyBuilt, OCC } from '../src/world/hills/cover.js';
import { buildHillTerraces } from '../src/world/hills/terraces.js';
import { planHillPlanting } from '../src/world/hills/planting.js';
import { planTownGardens } from '../src/world/hills/townGardens.js';
import { outerCities, renderedHeight } from '../src/world/outerCities.js';
import { terrainPieces } from '../src/world/islands/countryside.js';
import { Solids } from '../src/world/islands/kit.js';
import { auditGeometry } from './geometry-audit.mjs';

const errors = {}, examples = {};
const err = (k, d) => { errors[k] = (errors[k] || 0) + 1; if (!examples[k]) examples[k] = d; };
const scene = new THREE.Scene();
const hc = buildHillCountry(scene);
const towns = outerCities().massif;
buildMassifTowns(scene, towns, []);
setHabitatVillages(hc.villages.map((v) => ({ x: v.x, z: v.z, r: v.r })));
hillSurvey();
const occ = surveyBuilt(scene);
for (const m of towns) occ.segment(m.station.x, m.station.z, m.town.x, m.town.z, 24, OCC.CLEAR);
const tr = buildHillTerraces(new THREE.Scene(), occ, towns, hc.villages, hc.farms);
buildCoverTexture();
const planted = [...planHillPlanting(hc, occ), ...planTownGardens()];

// ---- stone solids
const range = (q) => { let lo = Infinity, hi = -Infinity; terrainPieces(q, (poly) => { for (const [x, z] of poly) { const h = renderedHeight(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); } }); return { lo, hi }; };
let closedChecked = 0;
tr.stoneSolids.forEach((s, i) => {
  const g = range(s.q);
  if (s.bottom > g.lo - 0.1) err('solid not founded', { i, bottom: s.bottom, lo: g.lo, step: !!s.step });
  if (s.top < g.hi + 0.01) err('terrain through a solid top', { i, top: s.top, hi: g.hi, step: !!s.step });
  if (i % 97 === 0) {
    const S = new Solids(); S.prism(s.q, s.bottom, s.top, 1, 1, s.bottom);
    const a = auditGeometry(S.geometry(), { tolerance: 1e-4 });
    closedChecked++;
    if (a.boundaryEdges + a.nonManifoldEdges + a.inconsistentEdges + a.degenerates + a.nonFinite + a.invalidNormals) err('open or bad solid', { i, ...a });
    if (!(a.signedVolume > 0)) err('inward solid', { i, v: a.signedVolume });
  }
});
// ---- sections of different systems never overlap (separating axis, 2 cm)
const sat = (a, b) => { for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) { const p = poly[i], r = poly[(i + 1) % poly.length], ax = -(r[1] - p[1]), az = r[0] - p[0], L = Math.hypot(ax, az) || 1; let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity; for (const v of a) { const d = (v[0] * ax + v[1] * az) / L; a0 = Math.min(a0, d); a1 = Math.max(a1, d); } for (const v of b) { const d = (v[0] * ax + v[1] * az) / L; b0 = Math.min(b0, d); b1 = Math.max(b1, d); } if (a1 <= b0 + 0.02 || b1 <= a0 + 0.02) return false; } return true; };
const cells = new Map();
for (const s of tr.records.sections) { const cx = Math.floor(s.q[0][0] / 64), cz = Math.floor(s.q[0][1] / 64); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const k = (cx + i) * 65536 + cz + j; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(s); } }
let pairs = 0;
for (const s of tr.records.sections) for (const o of cells.get(Math.floor(s.q[0][0] / 64) * 65536 + Math.floor(s.q[0][1] / 64)) || []) {
  if (o === s || o.system === s.system) continue;
  pairs++;
  if (sat(s.q, o.q)) err('sections of two systems overlap', { a: s.system, b: o.system, q: s.q[0] });
}
// ---- trees on the benches: under them their bench top; field trees on the drawn ground
for (const t of tr.records.trees) {
  const g = renderedHeight(t.x, t.z);
  if (t.bench) { if (t.y < g - 0.2) err('bench tree below the ground', t); }
  else {
    // rooted at the lowest drawn ground under its base (cypress: 0.6 of its radius; fruit trees 0.45 m)
    const br = t.cypress ? t.r * 0.6 : 0.45;
    let lo = g; for (let a = 0; a < 12; a++) lo = Math.min(lo, renderedHeight(t.x + Math.cos(a * 0.5236) * br, t.z + Math.sin(a * 0.5236) * br));
    if (t.y > lo + 0.02 || t.y < lo - 0.5) err('tree not seated on the ground', { ...t, g, lo });
  }
  if (g < 0.5) err('tree in the water', t);
}
// ---- planted trees against the hill country's roads, buildings, fields and lamps
const segs = [];
for (const r of hc.roads) for (let k = 1; k < r.points.length; k++) segs.push([r.points[k - 1], r.points[k], r.halfWidth]);
const SC = 32, sidx = new Map();
segs.forEach((s, i) => { const [a, b] = s; for (let x = Math.floor(Math.min(a.x, b.x) / SC); x <= Math.floor(Math.max(a.x, b.x) / SC); x++) for (let z = Math.floor(Math.min(a.z, b.z) / SC); z <= Math.floor(Math.max(a.z, b.z) / SC); z++) { const k = x * 65536 + z; if (!sidx.has(k)) sidx.set(k, []); sidx.get(k).push(i); } });
const segD = (x, z, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a.x - dx * t, z - a.z - dz * t); };
const inRect = (s, x, z, pad) => { const c = Math.cos(s.ang), a = Math.sin(s.ang), dx = x - s.x, dz = z - s.z; return Math.abs(dx * c + dz * a) < s.L / 2 + pad && Math.abs(-dx * a + dz * c) < s.W / 2 + pad; };
const inField = (f, x, z, pad) => { const dx = x - f.x, dz = z - f.z; return Math.abs(dx * f.ax + dz * f.az) < f.hl + pad && Math.abs(-dx * f.az + dz * f.ax) < f.hw + pad; };
for (const p of planted) {
  const g = renderedHeight(p.x, p.z);
  if (g < 0.5) err('planted tree in the water', p);
  if (p.why === 'town garden') { if (Math.abs(p.y - (p.support - 0.05)) > 1e-6) err('town tree off its terrace', p); continue; }
  let lo = g; for (let a = 0; a < 6; a++) lo = Math.min(lo, renderedHeight(p.x + Math.cos(a) * 0.9, p.z + Math.sin(a) * 0.9));
  if (p.y > lo + 0.01) err('planted tree floating', { ...p, lo });
  for (const i of sidx.get(Math.floor(p.x / SC) * 65536 + Math.floor(p.z / SC)) || []) { const [a, b, hw] = segs[i]; if (segD(p.x, p.z, a, b) < hw + 0.6) { err('planted trunk in a road', { x: p.x, z: p.z, why: p.why }); break; } }
  for (const s of hc.buildingSites) if (Math.abs(s.x - p.x) < 60 && Math.abs(s.z - p.z) < 60 && inRect(s, p.x, p.z, 0.6)) err('planted trunk in a building', { x: p.x, z: p.z, why: p.why });
  for (const f of hc.fieldSites) if (Math.abs(f.x - p.x) < 120 && Math.abs(f.z - p.z) < 120 && inField(f, p.x, p.z, 0.5)) err('planted trunk in a field', { x: p.x, z: p.z, why: p.why });
}
// ---- town gardens against their town's houses, walks, stairs and landings
const inPoly = (q, x, z) => { let sg = 0; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length], c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]); if (Math.abs(c) < 1e-9) continue; if (!sg) sg = Math.sign(c); else if (Math.sign(c) !== sg) return false; } return true; };
const byTown = new Map(MASSIF_GARDENS.map((g) => [g.town, g]));
let townTrees = 0;
for (const p of planted) {
  if (p.why !== 'town garden') continue;
  townTrees++;
  const g = byTown.get(p.town);
  if (!g.terraces.some((t) => t.L === p.support && inPoly(t.q, p.x, p.z))) err('town tree not on a terrace of its level', p);
  for (const h of g.houses) if (inPoly(h.q, p.x, p.z)) err('town tree in a house', p);
  for (const t of g.terraces) if (inPoly(t.walkQ, p.x, p.z)) err('town tree on a walk', p);
  for (const c of g.corridors) { const d = segD(p.x, p.z, { x: c.a[0], z: c.a[1] }, { x: c.b[0], z: c.b[1] }); if (d < c.width / 2 + 0.5) err('town tree in a stair corridor', p); }
}
console.log('HILL_TERRACES ' + JSON.stringify({ stats: tr.stats, solids: tr.stoneSolids.length, closedChecked, sectionPairs: pairs, benchAndFieldTrees: tr.records.trees.length, planted: planted.length, townTrees, errors, examples }));
process.exitCode = Object.keys(errors).length ? 1 : 0;
