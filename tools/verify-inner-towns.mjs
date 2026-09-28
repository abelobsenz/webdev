// Checks for the inner towns layer (src/world/towns): every structure is a closed, consistently
// wound solid with finite normals, seated on the drawn ground (its foot below the lowest ground
// of its footprint, never buried), clear of the carriageways, lots, lamps, arcologies, stations
// and of each other; every designed tree rooted in its soil, clear of lamps, lots and towers;
// every bench on the paving it was surveyed for. Usage: node tools/verify-inner-towns.mjs
import * as THREE from 'three';
import { Builder } from '../src/world/buildings.js';
import { planTowns } from '../src/world/towns/index.js';
import { buildInnerPlan } from './inner-plan-harness.mjs';
import { auditGeometry } from './geometry-audit.mjs';
import { SPECIES, SP } from '../src/world/treeGeometry.js';

const ctx = await buildInnerPlan();
const { plan, raw, towers, infra } = ctx;
const t0 = Date.now();
const res = planTowns(plan, { ground: raw, towers, stations: infra.stations });
console.log('towns planned in', Date.now() - t0, 'ms', JSON.stringify(res.stats));
const issues = new Map();
const bad = (cat, ex) => { const l = issues.get(cat) || []; l.push(ex); issues.set(cat, l); };
const R = (v) => Math.round(v * 10) / 10;
const F = plan.field;

// ---- every structure: closed, finite, seated
let tris = 0;
const boxes = [];
for (const w of plan.townWorks) {
  for (const lod of [false, true]) {
    const B = new Builder(1 << 10);
    w.build(B, lod);
    const g = B.geometry();
    const a = auditGeometry(g, { tolerance: 1e-4 });
    if (a.boundaryEdges || a.inconsistentEdges || a.nonFinite || a.invalidNormals || a.degenerates) bad(`open or invalid solid (${lod ? 'far' : 'near'})`, { kind: w.kind, at: [R(w.x), R(w.z)], ...a });
    if (!lod) tris += a.triangles;
    if (!lod) {
      g.computeBoundingBox();
      const bb = g.boundingBox;
      // seated: sample the ground under the footprint (its disc r) - the foot is below the lowest
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < 24; k++) for (const f of [0, 0.5, 1]) { const aa = (k / 24) * Math.PI * 2, gg = raw(w.x + Math.cos(aa) * w.r * f, w.z + Math.sin(aa) * w.r * f); lo = Math.min(lo, gg); hi = Math.max(hi, gg); }
      if (w.shore) {
        // a jetty: its deck clear of the ground along its axis beyond the root, its piles on the bed
        const axis = w.samples.slice(2);
        let gHi = -Infinity, gLo = Infinity;
        for (const [sx, sz] of axis) { const gg = raw(sx, sz); gHi = Math.max(gHi, gg); gLo = Math.min(gLo, gg); }
        if (w.deckY - 0.35 < gHi + 0.05) bad('buried', { kind: w.kind, at: [R(w.x), R(w.z)], deck: R(w.deckY), hi: R(gHi) });
        if (bb.min.y > gLo - 0.3) bad('floats (foot above the lowest ground)', { kind: w.kind, at: [R(w.x), R(w.z)], foot: R(bb.min.y), lo: R(gLo) });
      } else {
        if (bb.min.y > lo - 0.05) bad('floats (foot above the lowest ground)', { kind: w.kind, at: [R(w.x), R(w.z)], foot: R(bb.min.y), lo: R(lo) });
        if (w.top !== undefined ? w.top < hi : bb.max.y < hi + 0.1) bad('buried', { kind: w.kind, at: [R(w.x), R(w.z)], top: R(bb.max.y), hi: R(hi) });
      }
      boxes.push({ w, bb });
    }
  }
}
// ---- clear of carriageways, lots, lamps, towers, stations; of each other
const lotHit = (x, z, pad) => plan.lots.some((L) => { const c = Math.cos(L.rot), s = Math.sin(L.rot), dx = x - L.x, dz = z - L.z; const u = dx * c - dz * s, v = dx * s + dz * c; return Math.abs(u) < L.w / 2 + 0.6 + pad && Math.abs(v) < L.d / 2 + 0.6 + pad; });
const innerTowers = towers.filter((t) => Math.hypot(t.def.x, t.def.z) < 7000 && !t.def.ward);
const baseOf = (t) => { const q = plan.squares.find((s) => s.kind === 'tower' && s.x === t.def.x && s.z === t.def.z); return q ? q.base : 0; };
for (const { w } of boxes) {
  // the footprint: the work's disc, or the discs it lists along a long structure (a jetty)
  const discs = w.samples || [[w.x, w.z, w.r]];
  let hitSt = false, hitLot = false, hitLamp = false;
  for (const [sx, sz, sr] of discs) for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI * 2, f = k === 16 ? 0 : 1, x = sx + Math.cos(a) * sr * f, z = sz + Math.sin(a) * sr * f;
    if (!hitSt && F.edge(x, z) < 0.2 && !w.onStreet) { bad('structure on a carriageway', { kind: w.kind, at: [R(sx), R(sz)] }); hitSt = true; }
    if (!hitLot && lotHit(x, z, 0.2)) { bad('structure in a lot', { kind: w.kind, at: [R(sx), R(sz)] }); hitLot = true; }
  }
  for (const [sx, sz, sr] of discs) for (const l of plan.lamps) if (!hitLamp && Math.hypot(l.x - sx, l.z - sz) < sr + 0.4) { bad('lamp in a structure', { kind: w.kind, at: [R(w.x), R(w.z)] }); hitLamp = true; }
  // nothing but a jetty stands in the water: the whole disc dry
  if (!w.shore) for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; if (raw(w.x + Math.cos(a) * w.r, w.z + Math.sin(a) * w.r) < 0.6) { bad('structure in the water', { kind: w.kind, at: [R(w.x), R(w.z)] }); break; } }
  for (const t of innerTowers) if (Math.hypot(t.def.x - w.x, t.def.z - w.z) < baseOf(t) + w.r + (w.nearTower ?? 4)) bad('structure at an arcology podium', { kind: w.kind, at: [R(w.x), R(w.z)] });
  for (const s of infra.stations) if (Math.hypot(s.x - w.x, s.z - w.z) < s.r + w.r - 5 && plan.room.min(w.x, w.z, w.r) < 3) bad('structure on a station', { kind: w.kind, at: [R(w.x), R(w.z)] });
}
const discsOf = (w) => w.samples || [[w.x, w.z, w.r]];
for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
  const a = boxes[i], b = boxes[j];
  if (Math.hypot(a.w.x - b.w.x, a.w.z - b.w.z) > a.w.r + b.w.r || !a.bb.intersectsBox(b.bb) || (a.w.group && a.w.group === b.w.group)) continue;
  if (discsOf(a.w).some(([ax, az, ar]) => discsOf(b.w).some(([bx, bz, br]) => Math.hypot(ax - bx, az - bz) < ar + br))) bad('structures overlap', { a: a.w.kind, b: b.w.kind, at: [R(a.w.x), R(a.w.z)] });
}
// ---- designed trees
for (const t of plan.trees) {
  const sp = SP[t.sp], cr = SPECIES[sp].shape[2] * t.s * 0.5;
  if (!(t.y > 0.3) || t.y > raw(t.x, t.z) + 0.6) bad('tree floats or stands in water', { at: [R(t.x), R(t.z)], y: R(t.y), g: R(raw(t.x, t.z)) });
  if (F.edge(t.x, t.z) < 0.5) bad('tree in a carriageway', { at: [R(t.x), R(t.z)] });
  if (lotHit(t.x, t.z, Math.min(cr, 3))) bad('tree crown in a lot', { at: [R(t.x), R(t.z)] });
  for (const l of plan.lamps) if (Math.hypot(l.x - t.x, l.z - t.z) < Math.max(1.6, cr * 0.8)) { bad('tree on a lamp', { at: [R(t.x), R(t.z)] }); break; }
  for (const tw of innerTowers) if (Math.hypot(tw.def.x - t.x, tw.def.z - t.z) < baseOf(tw) + cr + 1) bad('tree crown in an arcology', { at: [R(t.x), R(t.z)] });
  if (plan.room.min(t.x, t.z, cr) < t.s + 1) bad('tree under a structure', { at: [R(t.x), R(t.z)] });
}
// ---- benches
for (const f of plan.furniture) {
  if (F.edge(f.x, f.z) < 0.3) bad('furniture on a carriageway', { kind: f.kind, at: [R(f.x), R(f.z)] });
  if (lotHit(f.x, f.z, 0.3)) bad('furniture in a lot', { kind: f.kind, at: [R(f.x), R(f.z)] });
  const g = raw(f.x, f.z);
  if (f.y > g + 0.05 || f.y < g - 0.4) bad('furniture off its ground', { kind: f.kind, at: [R(f.x), R(f.z)], y: R(f.y), g: R(g) });
}
// ---- the squares' walkers (people.js walk a ring at 0.8 r, half-width qh): nothing of ours in it
for (const q of plan.squares) {
  if (q.kind === 'tower' || q.kind === 'station') continue;
  const rr = q.r * 0.8, qh = Math.max(0.4, Math.min(q.r * 0.15 - 0.45, q.r * 0.2 - 1.85));
  const inRing = (x, z, r) => { const d = Math.hypot(x - q.x, z - q.z); return d + r > rr - qh - 0.2 && d - r < rr + qh + 0.2; };
  for (const w of plan.townWorks) for (const [sx, sz, sr] of w.samples || [[w.x, w.z, w.r]]) if (Math.hypot(sx - q.x, sz - q.z) < q.r + sr && inRing(sx, sz, sr)) { bad('structure in a square\'s walkers\' ring', { kind: w.kind, at: [R(sx), R(sz)], sq: q.kind }); break; }
  for (const t of plan.trees) if (inRing(t.x, t.z, 1.0) && Math.hypot(t.x - q.x, t.z - q.z) < q.r) bad('tree in a square\'s walkers\' ring', { at: [R(t.x), R(t.z)], sq: q.kind });
  for (const f of plan.furniture) if (inRing(f.x, f.z, f.r) && Math.hypot(f.x - q.x, f.z - q.z) < q.r) bad('furniture in a square\'s walkers\' ring', { at: [R(f.x), R(f.z)], sq: q.kind });
  if (q.kind === 'village' && String(q.district).startsWith('islet')) for (const l of plan.lamps) if (inRing(l.x, l.z, 0.3) && Math.hypot(l.x - q.x, l.z - q.z) < q.r) bad('lamp in a village place\'s walkers\' ring', { at: [R(l.x), R(l.z)] });
}
console.log(`works ${plan.townWorks.length}, near triangles ${tris}, trees ${plan.trees.length}, furniture ${plan.furniture.length}`);
if (!issues.size) console.log('inner towns: all checks passed');
for (const [k, v] of issues) console.log(`FAIL ${k}: ${v.length}`, JSON.stringify(v.slice(0, 4)));
process.exitCode = issues.size ? 1 : 0;
