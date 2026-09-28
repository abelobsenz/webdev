// Headless build of the inner city plan (terrain, arcologies, promenades, stations, the town
// plan and everything planned on it) for the Node checks of the inner towns.
import * as THREE from 'three';
import { buildTerrainData, HeightSampler } from '../src/world/terrain.js';
import { TOWERS } from '../src/world/layout.js';
import { buildTowers } from '../src/world/towers.js';
import { buildInfrastructure } from '../src/world/infrastructure.js';
import { wardTowerDefs, wardBridgePaths, wardHeight } from '../src/world/metro.js';
import { planCity, towerFootprint } from '../src/world/urban.js';
import { urbanMask } from '../src/world/world.js';
import { planInnerCivic } from '../src/world/innerCivic.js';
import { planShorePromenades } from '../src/world/innerShore.js';
import { planTowns } from '../src/world/towns/index.js';

export async function buildInnerPlan({ extra, towns = false } = {}) {
  const t0 = Date.now();
  const heights = await buildTerrainData(() => {});
  const sampler = new HeightSampler(heights);
  const raw = (x, z) => sampler.get(x, z);
  const gh = (x, z) => Math.max(sampler.get(x, z), 0, wardHeight(x, z));
  const scene = new THREE.Scene();
  const towers = buildTowers(TOWERS, gh, scene);
  const wardTowers = buildTowers(wardTowerDefs(), gh, scene);
  for (const t of wardTowers) t.footprint = towerFootprint(t, 100);
  towers.push(...wardTowers);
  const infra = buildInfrastructure(scene, gh, raw);
  const bridges = wardBridgePaths(gh);
  const heads = bridges.filter((b) => b.head).map((b) => ({ x: b.head.x, z: b.head.z, r: Math.hypot(b.head.hw, b.head.hd) + 6, end: 'rim', head: b.head }));
  const plan = planCity({ ground: raw, towers, promenades: [...infra.promenades, ...bridges.map((b) => b.path)], urbanMask, stations: [...infra.stations, ...heads] });
  planInnerCivic(plan, towers, raw);
  const stationDiscs = [...infra.stations, ...heads].map((s) => ({ x: s.x, z: s.z, r: s.r || 40 }));
  const shore = planShorePromenades(plan, raw, towers, stationDiscs);
  const townsPlan = towns ? planTowns(plan, { ground: raw, towers, stations: infra.stations }) : null;
  if (extra) extra({ plan, raw, towers, infra, scene, stationDiscs });
  return { plan, raw, sampler, towers, infra, bridges, heads, shore, scene, stationDiscs, townsPlan, ms: Date.now() - t0 };
}
