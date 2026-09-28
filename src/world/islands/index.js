import { Kit } from './cityKit.js';
import { createFacadeMaterial } from '../facade.js';
import { signalLights } from '../wardLandmarks.js';
import * as thalassa from './thalassa.js';
import * as anchorage from './anchorage.js';
import * as orison from './orison.js';

// The island cities that plan and build their own cores (see cityKit.js for the construction
// rules). skyline.js asks each for the ground it reserves (and the gate where the island's
// regional roads start) before the island plan is drawn, then lets it build.
const CITIES = { thalassa, anchorage, orison };

function builder(mod) {
  return (parts, c, rnd, lights) => {
    const kit = new Kit(c.name), placed = [], signals = [];
    mod.build({ kit, c, rnd, lights, placed, parts, signals });
    const geos = kit.finish();
    parts.push(...geos);
    return { placed, trees: kit.trees, keepout: kit.keepout, signals };
  };
}
export const ISLAND_CITY_BUILDERS = Object.fromEntries(Object.entries(CITIES).map(([id, mod]) => [id, builder(mod)]));
export function islandCityReserve(c) { return CITIES[c.id].reserve(c); }

/** Gilded work (crowns, finials): the facade material with gold glass and warm gilt ribs. */
export function createGiltMaterial(pal, seed) {
  const m = createFacadeMaterial(pal, seed + 101, { litFrac: 0.3, band: 1e5, uplight: 0.4 });
  const u = m.userData.facadeUniforms;
  u.uGlass.value.setRGB(0.95, 0.66, 0.22);
  u.uRib.value.setRGB(0.93, 0.74, 0.38);
  u.uLightCol.value.setRGB(1.0, 0.78, 0.45);
  m.metalness = 0.55; m.roughness = 0.28;
  return m;
}

/** The cities' night signals ({x, y, z, c, s}: harbour lights, beacons) as one point sprite set. */
export function islandCitySignals(list) {
  const pts = signalLights(list);
  if (pts) pts.name = 'island city signals';
  return pts;
}
