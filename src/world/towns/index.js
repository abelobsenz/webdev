import * as THREE from 'three';
import { Builder } from '../buildings.js';
import { createLowriseMaterial } from '../facade.js';
import { ST } from '../urban.js';
import { Survey } from './survey.js';
import { planForecourts, planSquareGroves } from './forecourts.js';
import { planIslets } from './islets.js';
import { planGardens } from './gardens.js';

// The towns layer of the inner islands: everything planned into the island towns on top of the
// town plan (urban.js) - the arcology and terminal forecourts, the islet villages' places and
// public buildings, the towns' block gardens, green-belt belvederes and hill terraces. Planned
// before the street field is baked for the GPU (so the plan knows every place, lamp and site),
// built after the civic buildings.
//   plan.trees      designed trees (treePlanner.js plants them first, in their soil)
//   plan.furniture  benches and small furniture (streetscape.js instances them)
//   plan.townWorks  structures: { district, x, z, r, build(B, lod), samples? } built into chunk meshes

// Each island town builds in its own stone and glass, the palette of its civic building
// (innerCivic.js): silver Aster and Thule, rose Solace, jade Verdant, marble Cantor, warm sand
// Oriel and the islet villages; the ring town, Lumen, Halcyon and the rim stay pearl.
const PALETTE = { aster: 'silver', solace: 'rose', verdant: 'jade', cantor: 'marble', oriel: 'sand', thule: 'silver' };
export function townPalette(district) {
  if (!district) return 'pearl';
  if (PALETTE[district]) return PALETTE[district];
  return district.startsWith('islet') ? 'sand' : 'pearl';
}

export function planTowns(plan, { ground, towers = [], stations = [] }) {
  const S = new Survey(plan, ground, towers, stations);
  const out = { works: [], trees: [], furniture: [], sites: [] };
  const stats = {};
  // a civic square that fell back to its island's heart where an arcology stands (its civic
  // building went to a park) lies inside the tower's base: its paving is the tower's forecourt
  // already, and its walkers' ring would run through the podium. It goes.
  for (let i = plan.squares.length - 1; i >= 0; i--) {
    const q = plan.squares[i];
    if (q.kind !== 'civic' || q.landmarkR) continue;
    if (S.towers.some((t) => Math.hypot(t.x - q.x, t.z - q.z) + q.r * 0.5 < t.base)) {
      plan.squares.splice(i, 1);
      S.removeLamps((l) => l.cls === 0 && Math.abs(Math.hypot(l.x - q.x, l.z - q.z) - (q.r - 2.5)) < 1.2);
      stats.civicInTower = (stats.civicInTower || 0) + 1;
    }
  }
  // the islet villages first: they reshape their squares and move their lamps
  stats.islets = planIslets(S, out);
  stats.forecourts = planForecourts(S, out);
  stats.groves = planSquareGroves(S, out);
  stats.gardens = planGardens(S, out);
  plan.trees = [...(plan.trees || []), ...out.trees];
  plan.furniture = [...(plan.furniture || []), ...out.furniture];
  plan.townWorks = out.works;
  plan.townSites = out.sites;
  rebakeField(plan);
  return { survey: S, stats };
}

/** The squares and lamp pools of the street field, baked again from the plan as it now stands
 *  (squares resized, lamps moved or added since planCity baked them). */
function rebakeField(plan) {
  const F = plan.field, D = F.data;
  for (let k = 0; k < F.N * F.N; k++) { D[k * 4 + 2] = 0; D[k * 4 + 3] = 0; }
  for (const q of plan.squares) F.square(q.x, q.z, q.r);
  if (F.frameData && F.bestA) F.frameSquares(plan.squares);
  for (const l of plan.lamps) F.lamp(l.x, l.z, l.cls === ST.LANE ? 0.75 : 1);
}

/** Build the towns layer: one near (detail) and one far (massing) mesh per district chunk. */
export function buildTowns(scene, plan, settings) {
  const chunks = new Map();
  for (const w of plan.townWorks || []) {
    const key = w.district || 'misc';
    if (!chunks.has(key)) chunks.set(key, { near: new Builder(1 << 14), far: new Builder(1 << 12) });
    const ch = chunks.get(key);
    for (const [B, lod] of [[ch.near, false], [ch.far, true]]) {
      B.seed = ((w.x * 0.37 + w.z * 0.11) % 97 + 97) % 97; B.roof = 0.5;
      w.build(B, lod);
      B.frame(0, 0, 0, 0);
    }
  }
  const mats = new Map();
  const list = [], meshes = [];
  let tris = 0;
  for (const [key, ch] of chunks) {
    if (!ch.near.ni) continue;
    const pal = townPalette(key);
    if (!mats.has(pal)) mats.set(pal, createLowriseMaterial(pal, { litFrac: 0.5, warmth: 0.75 }));
    const mat = mats.get(pal);
    const near = new THREE.Mesh(ch.near.geometry(), mat), far = new THREE.Mesh(ch.far.geometry(), mat);
    for (const m of [near, far]) { m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; scene.add(m); meshes.push(m); }
    near.name = `Towns ${key}`; far.name = `Towns ${key} far`;
    const bs = near.geometry.boundingSphere;
    list.push({ key, near, far, center: bs.center.clone(), radius: bs.radius });
    tris += near.geometry.index.count / 3;
  }
  const api = {
    meshes, chunks: list, tris, nearDist: 600,
    applyQuality(s) { this.nearDist = s.lowriseNear ?? (s.lowrise >= 1 ? 700 : s.lowrise >= 0.75 ? 520 : 360); },
    update(camera) {
      if (!camera) return;
      const cp = camera.position;
      for (const c of list) {
        const near = cp.distanceTo(c.center) - c.radius < this.nearDist;
        // near: the detail in the main view, the massing in the (cheaper) reflection pass
        c.near.visible = near;
        c.near.layers.set(near ? 1 : 0);
        c.far.layers.set(near ? 2 : 0);
      }
    },
  };
  api.applyQuality(settings || {});
  return api;
}
