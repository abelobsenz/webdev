import { outerCities, renderedHeight } from '../outerCities.js';
import { hillSurvey, setHabitatVillages, buildCoverTexture, surveyBuilt, OCC, HILL } from './cover.js';
import { planHillPlanting } from './planting.js';
import { planTownGardens } from './townGardens.js';
import { buildHillWoods } from './woods.js';
import { buildHillTerraces } from './terraces.js';

// The living landscape of the northern mainland, planted after all the architecture: the
// land cover (for the terrain's forest floor, alpine meadow and bare rock), the survey of
// everything built on the land, the planted trees of the countryside and the woods.
export function buildHills(world) {
  const t0 = performance.now();
  const hc = world.hillCountry;
  setHabitatVillages(hc.villages.map((v) => ({ x: v.x, z: v.z, r: v.r })));
  hillSurvey();
  const occ = surveyBuilt(world.scene);
  // the gondola lines: a cleared ride under every cable
  const towns = outerCities().massif;
  for (const m of towns) occ.segment(m.station.x, m.station.z, m.town.x, m.town.z, 24, OCC.CLEAR);
  // the terraces of the lagoon face (they claim their ground before the woods are planted)
  const terraces = buildHillTerraces(world.scene, occ, towns, hc.villages, hc.farms);
  buildCoverTexture();
  // the countryside's planted trees, and the terrace towns' gardens
  const planted = [...planHillPlanting(hc, occ), ...planTownGardens()];
  const woods = buildHillWoods(world.scene, world.trees, occ, planted, world.settings);
  const api = {
    occ, planted, woods, terraces, ms: performance.now() - t0,
    // for in-page audits: the drawn ground and the mainland box
    ground: renderedHeight, box: { x0: HILL.x0, x1: HILL.x1, z0: HILL.z0, z1: HILL.z1 },
    applyQuality: (s) => woods.applyQuality(s),
    update: (dt, t, camera) => woods.update(dt, t, camera),
  };
  return api;
}
