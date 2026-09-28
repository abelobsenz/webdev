import * as THREE from 'three';
import { Builder } from '../buildings.js';
import { createLowriseMaterial } from '../facade.js';
import { ST } from '../urban.js';
import { Survey } from './survey.js';
import { planForecourts } from './forecourts.js';
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

export function planTowns(plan, { ground, towers = [], stations = [] }) {
  const S = new Survey(plan, ground, towers, stations);
  const out = { works: [], trees: [], furniture: [], sites: [] };
  const stats = {};
  // the islet villages first: they reshape their squares and move their lamps
  stats.islets = planIslets(S, out);
  stats.forecourts = planForecourts(S, out);
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
  const mat = createLowriseMaterial('pearl', { litFrac: 0.5, warmth: 0.75 });
  const list = [], meshes = [];
  let tris = 0;
  for (const [key, ch] of chunks) {
    if (!ch.near.ni) continue;
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
