import * as THREE from 'three';
import { terrainHeight, buildTerrainData, buildInnerGeometry, buildOuterGeometry, buildInfoTexture, createTerrainMaterial, HeightSampler, ISLETS } from './terrain.js';
import { Water } from './water.js';
import { CENTRAL_ISLAND, ISLANDS, PLAZA_R, PLAZA_Y, TOWERS, FLOATING_ISLANDS } from './layout.js';
import { smoothstep, createNoise2D, mulberry32 } from './noise.js';
import { buildAxis } from './axis.js';
import { buildTowers } from './towers.js';
import { planCity, towerFootprint } from './urban.js';
import { wardTowerDefs, wardBridgePaths, buildMetro, wardHeight } from './metro.js';
import { buildSkyline } from './skyline.js';
import { buildHillCountry } from './hillCountry.js';
import { buildHills } from './hills/index.js';
import { buildTransit } from './transit.js';
import { buildRimForecourts } from './rimForecourts.js';
import { signalLights } from './wardLandmarks.js';
import { Transit } from '../life/transit.js';
import { buildBuildings } from './buildings.js';
import { buildStreetscape } from './streetscape.js';
import { NATURE_U } from './natureGlsl.js';
import { TreeField } from './vegetation.js';
import { planTrees } from './treePlanner.js';
import { planIslandTrees } from './islandTrees.js';
import { buildClearance } from './clearance.js';
import { buildNature } from './nature.js';
import { GroundCover, buildHedges } from './groundCover.js';
import { buildFloatingIslands } from './floating.js';
import { INNER } from './terrain.js';
import { renderedHeight } from './outerCities.js';
import { planInnerCivic, buildInnerCivic } from './innerCivic.js';
import { planShorePromenades, buildShoreJetties } from './innerShore.js';
import { planTowns, buildTowns, townPalette } from './towns/index.js';
import { buildRim } from './rim/rimBuild.js';

import { buildInfrastructure, createBeacons } from './infrastructure.js';
import { Traffic } from '../life/traffic.js';
import { Chorus, CHORUS_STEM_COLLIDERS } from '../life/chorus.js';
import { Clouds } from '../life/clouds.js';
import { People } from '../life/people.js';
import { Skiffs } from '../life/skiffs.js';

const nU = createNoise2D(71);

/** Urban density (0..1) at a point — districts on the islands and towns on the rim. */
export function urbanMask(x, z, h) {
  if (h < 1.2) return 0;
  let u = 0;
  const dc = Math.hypot(x - CENTRAL_ISLAND.x, z - CENTRAL_ISLAND.z);
  u = Math.max(u, smoothstep(CENTRAL_ISLAND.r * 0.92, PLAZA_R + 60, dc));
  for (const i of ISLANDS) {
    const d = Math.hypot(x - i.x, z - i.z);
    u = Math.max(u, smoothstep(i.r * 0.95, i.r * 0.45, d));
  }
  for (const i of ISLETS) {
    const d = Math.hypot(x - i.x, z - i.z);
    if (i.r > 150) u = Math.max(u, smoothstep(i.r * 0.9, i.r * 0.4, d) * 0.8);
  }
  // rim towns
  const r = Math.hypot(x, z);
  if (r > 5000 && r < 6900) {
    const a = Math.atan2(z, x);
    const town = smoothstep(0.25, 0.6, nU(Math.cos(a) * 2.2, Math.sin(a) * 2.2) * 0.5 + 0.5);
    u = Math.max(u, town * smoothstep(1.5, 5, h) * (1 - smoothstep(35, 60, h)));
  }
  return u;
}

export function forestMask(x, z, h, urban) {
  if (h < 1.5) return 0;
  const n = nU(x * 0.0012 + 40, z * 0.0012) * 0.5 + 0.5;
  const n2 = nU(x * 0.006, z * 0.006 - 20) * 0.5 + 0.5;
  return Math.max(0, Math.min(1, (smoothstep(0.35, 0.62, n * 0.8 + n2 * 0.3) * 0.9 + smoothstep(20, 90, h) * 0.4) * (1 - urban * 0.9)));
}

export class World {
  constructor(app) {
    this.app = app;
    this.scene = app.scene;
    this.settings = app.settings;
    this.colliders = [];
    this.updaters = [];
    this.reflectionHide = [];
  }

  async build(progress) {
    const P = (a, b, msg) => (t) => progress(a + (b - a) * t, msg);
    progress(0.02, 'Surveying the caldera');
    const heights = await buildTerrainData(P(0.02, 0.35, 'Raising the islands'));
    this.heights = heights;
    this.sampler = new HeightSampler(heights);
    progress(0.36, 'Weaving the terrain mesh');
    await new Promise((r) => setTimeout(r, 0));
    const innerGeo = buildInnerGeometry(heights);
    const outerGeo = await buildOuterGeometry(P(0.38, 0.5, 'Carving the northern massif'));
    progress(0.52, 'Mapping districts and forests');
    await new Promise((r) => setTimeout(r, 0));
    this.info = buildInfoTexture(heights, urbanMask, forestMask);

    this.terrainMat = createTerrainMaterial(this.info.tex);
    this.terrain = new THREE.Mesh(innerGeo, this.terrainMat);
    this.terrain.receiveShadow = true;
    this.terrain.castShadow = false;
    this.terrain.layers.set(1);           // full-detail terrain: main view only
    this.scene.add(this.terrain);
    this.terrainCoarse = new THREE.Mesh(buildCoarseGeometry(heights, 4), this.terrainMat);
    this.terrainCoarse.layers.set(2);     // decimated copy for the water reflection pass
    this.scene.add(this.terrainCoarse);
    this.outer = new THREE.Mesh(outerGeo, this.terrainMat);
    this.outer.receiveShadow = true;
    this.outer.frustumCulled = false;
    this.outer.layers.set(1);             // near-detail outer land (chunked LOD): main view only
    this.scene.add(this.outer);
    this.outerCoarse = new THREE.Mesh(outerGeo.userData.coarse, this.terrainMat);
    this.outerCoarse.frustumCulled = false;
    this.outerCoarse.layers.set(2);       // plain coarse ring for the water reflection pass
    this.scene.add(this.outerCoarse);
    this.updaters.push({ update: () => outerGeo.userData.lod.update(this.app.camera) });

    this.water = new Water(this.info.tex, this.settings);
    this.scene.add(this.water.mesh);
    this.reflectionHide.push(this.water.mesh, this.app.pipeline.backdrop);

    progress(0.56, 'Raising the Axis');
    await this.buildArchitecture(P(0.56, 0.9, 'Growing the arcologies'));
    progress(0.92, 'Waking the city');
  }

  async buildArchitecture(progress) {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const gh = (x, z) => this.groundHeight(x, z);
    // The Axis
    this.axis = buildAxis(this.scene, this.updaters);
    this.colliders.push(...this.axis.colliders);
    this.reflectionHide.push(...this.axis.reflectHide);
    progress(0.15); await tick();
    // Arcologies
    this.towers = buildTowers(TOWERS, gh, this.scene);
    // the Outer Wards' arcologies stand on their platforms (groundHeight knows the wards)
    this.wardTowers = buildTowers(wardTowerDefs(), gh, this.scene);
    for (const t of this.wardTowers) t.footprint = towerFootprint(t, 100);
    this.towers.push(...this.wardTowers);
    for (const t of this.towers) {
      const c = t.collide;
      this.colliders.push({ x: t.def.x, z: t.def.z, y0: t.baseY - 10, y1: t.top, radius: (y) => c(y - t.baseY) + 4 });
    }
    progress(0.35); await tick();
    // Promenades, the Gate, lotus pads, skyport
    this.infra = buildInfrastructure(this.scene, gh, (x, z) => this.sampler.get(x, z));
    this.colliders.push(...this.infra.colliders);
    this.colliders.push(...CHORUS_STEM_COLLIDERS);   // the Chorus stem stands in the lagoon
    progress(0.45); await tick();
    // The town plan (streets, squares, lots, lamps) and the towns built on it
    const raw = (x, z) => this.sampler.get(x, z);
    // bridges to the Outer Wards leave from the rim: the rim towns keep clear of them
    this.wardBridgePaths = wardBridgePaths(gh);
    // the rim bridgeheads (podium, deck start and maglev station) keep the rim towns clear
    const heads = this.wardBridgePaths.filter((b) => b.head).map((b) => ({ x: b.head.x, z: b.head.z, r: Math.hypot(b.head.hw, b.head.hd) + 6, end: 'rim', head: b.head }));
    this.plan = planCity({ ground: raw, towers: this.towers, promenades: [...this.infra.promenades, ...this.wardBridgePaths.map((b) => b.path)], urbanMask, stations: [...this.infra.stations, ...heads] });
    // the inner islands' civic buildings: their squares (and the lanes to any in a park) are
    // planned before the street field is baked and the streetscape furnishes the squares
    planInnerCivic(this.plan, this.towers, raw);
    this.shoreWalks = planShorePromenades(this.plan, raw, this.towers, [...this.infra.stations, ...heads].map((s) => ({ x: s.x, z: s.z, r: s.r || 40 })));
    // the towns layer (src/world/towns): forecourts, islet places, gardens - planned into the plan
    this.townsPlan = planTowns(this.plan, { ground: raw, towers: this.towers, stations: this.infra.stations });
    NATURE_U.uStreets.value = this.plan.field.texture();
    NATURE_U.uStreetFrame.value = this.plan.field.frameTexture();
    progress(0.55); await tick();
    this.lowrise = buildBuildings(this.scene, this.plan, raw, this.settings, { paletteOf: townPalette });
    this.updaters.push({ applyQuality: (s) => this.lowrise.applyQuality(s), update: (dt, t) => this.lowrise.update(dt, t, this.app.camera) });
    // the rim arcologies' forecourts: ring colonnades, fountains, obelisks, their lamps
    const bridgeAvoid = (x, z, r) => this.wardBridgePaths.some((b) => (b.head && Math.hypot(b.head.x - x, b.head.z - z) < r + 75) || b.path.slice(0, 30).some((p) => Math.hypot(p.x - x, p.z - z) < r + 22));
    this.rimCourts = buildRimForecourts(this.scene, this.towers, raw, bridgeAvoid, { streets: this.plan.streets, lots: this.plan.lots });
    this.updaters.push({ update: () => this.app.camera && this.rimCourts.update(this.app.camera) });
    // the inner islands' civic buildings stand at the heart of their civic squares (the square's
    // benches ring them, so they are marked before the streetscape furnishes the squares)
    this.civic = buildInnerCivic(this.scene, this.plan, raw, this.colliders);
    this.jetties = buildShoreJetties(this.scene, this.shoreWalks, raw);
    this.towns = buildTowns(this.scene, this.plan, this.settings);
    this.updaters.push({ applyQuality: (s) => this.towns.applyQuality(s), update: () => this.app.camera && this.towns.update(this.app.camera) });
    // the Rim's country, shores and avenue (rim/rimBuild.js): vineyards and gardens, the set
    // pieces, lighthouses at the channel mouths, sea walls, lidos, jetties, stops on Rim Way
    this.rim = buildRim(this.scene, this, raw, { quality: this.settings });
    this.updaters.push({ applyQuality: (s) => this.rim.applyQuality(s), update: () => this.app.camera && this.rim.update(this.app.camera) });
    this.updaters.push({ update: () => this.app.camera && this.civic.update(this.app.camera) });
    this.streetscape = buildStreetscape(this.scene, this.plan, raw, [...this.infra.promLamps, ...this.rimCourts.lamps]);
    this.colliders.push(...(this.streetscape.colliders || []));   // square fountains, obelisks, kiosks
    // Greater Meridian: the Outer Wards (platforms, their towns, landmarks, bridges, stations)
    this.metro = buildMetro(this.scene, this.wardTowers, this.wardBridgePaths.map((b) => b), gh, this);
    this.wardTowns = { placements: this.metro.towns.flatMap((t) => t.placements), isFree: (x, z, r) => this.metro.isFree(x, z, r) };
    this.updaters.push({ applyQuality: (s) => this.metro.applyQuality(s), update: (dt, t) => this.metro.update(dt, t, this.app.camera) });
    this.wardStreets = { lamps: this.metro.plan.lamps };
    // the metropolitan transit network: the Great Ring, far lines, gondolas, the canal line
    this.transitNet = buildTransit(this.scene, this);
    {
      const T = this.transitNet;
      const SS = buildStreetscape(this.scene, { streets: [], squares: [], lamps: [], field: { edge: () => 16, centre: () => 16, squareAt: () => 0 } }, gh, T.lamps);
      for (const m of SS.meshes) this.metro.lod.push({ near: m, far: null, center: new THREE.Vector3(0, 0, 0), radius: 60000, nearDist: 1e9 });
      const sl = signalLights(T.lights);
      if (sl) this.scene.add(sl);
    }
    // and the metropolitan horizon beyond: towns of towers on the far islands and massif
    this.skyline = buildSkyline(this.scene);
    // civilisation across the outer hills: villages, farms, fields, roads, summit monasteries
    this.hillCountry = buildHillCountry(this.scene);
    this.updaters.push({ applyQuality: (s) => this.hillCountry.applyQuality(s), update: (dt, t) => this.hillCountry.update(dt, t, this.app.camera) });
    progress(0.7); await tick();
    // --- nature (vegetation after all architecture, so it can keep clear of it) ---
    this.clearance = buildClearance(this.scene, (x, z) => this.sampler.get(x, z));
    this.trees = new TreeField(this.scene, this.settings);
    this.trees.build([...this.placeTrees(), ...planIslandTrees(this.skyline.isFree)]);   // + woods on the far islands' heights
    this.updaters.push({ applyQuality: (s) => this.trees.applyQuality(s), update: (dt, t) => this.trees.update(dt, t, this.app.camera) });
    // the northern mainland's land cover, planted countryside and woods (hills/)
    this.hills = buildHills(this);
    this.updaters.push({ applyQuality: (s) => this.hills.applyQuality(s), update: (dt, t) => this.hills.update(dt, t, this.app.camera) });
    progress(0.78); await tick();
    // Floating gardens
    this.floating = buildFloatingIslands(FLOATING_ISLANDS, this.scene, this.trees);
    for (const tl of this.floating.treeLists || []) this.trees.buildLocal(tl.trees, tl.group);
    this.updaters.push(this.floating);
    progress(0.82); await tick();
    this.nature = buildNature(this);
    // living ground cover: 3D grass on the lawns and grassland, flowers in the beds and
    // drifts, leafy perennials in the verge beds, and clipped hedges along the kerbs
    this.groundCover = new GroundCover(this, this.settings);
    this.updaters.push({ applyQuality: (s) => this.groundCover.applyQuality(s), update: (dt, t) => this.groundCover.update(dt, t, this.app.camera) });
    this.hedges = buildHedges(this);
    this.updaters.push({ update: () => this.app.camera && this.hedges.update(this.app.camera) });
    // --- end nature ---
    // City life
    this.traffic = new Traffic(this.scene, this.settings, this);   // citylife: world passed for lane clearance + docks
    this.updaters.push(this.traffic);
    // courier skiffs with bending exhaust trails
    this.skiffs = new Skiffs(this.scene, this);
    this.updaters.push({ applyQuality: (s) => this.skiffs.applyQuality(s), update: (dt, t) => this.skiffs.update(dt, t, this.app.camera) });
    this.chorus = new Chorus(this.scene, this.settings);
    this.updaters.push(this.chorus);
    this.clouds = new Clouds(this.scene);
    this.updaters.push({ update: (dt) => this.clouds.update(dt, this.app.camera) });
    // trains, ferries, launches, gondolas and sky-ships on the metropolitan network
    this.transit = new Transit(this.scene, this, this.transitNet);
    this.people = new People(this.scene, this.settings, this);
    this.updaters.push({ applyQuality: (s) => this.people.applyQuality(s), update: (dt, t) => this.people.update(dt, t, this.app.camera) });
    // aircraft beacons on every summit
    const beacons = [...this.axis.beacons, ...this.infra.beacons];
    for (const t of this.towers) beacons.push(t.def.x, t.top + 2, t.def.z);
    this.beacons = createBeacons(beacons);
    this.scene.add(this.beacons);
    progress(1);
  }

  placeTrees() {
    // species, habitats and clearance rules live in treePlanner.js
    return planTrees(this);
  }

  groundHeight(x, z) {
    const h = this.sampler.get(x, z);
    return Math.max(h, 0, wardHeight(x, z));
  }

  /** The surface as drawn everywhere (inner grid, ward platforms, and the outer land's mesh beyond
   *  it): for the camera and tools. groundHeight keeps its inner-grid meaning for placement code. */
  surfaceHeight(x, z) {
    const inner = Math.max(Math.abs(x), Math.abs(z)) < INNER.half - 60;
    return Math.max(inner ? this.sampler.get(x, z) : renderedHeight(x, z), 0, wardHeight(x, z));
  }

  applyQuality(settings) {
    this.settings = settings;
    this.water.setSettings(settings);
    for (const u of this.updaters) if (u.applyQuality) u.applyQuality(settings);
  }

  setSize(w, h) {
    this.water.setSize(w, h);
    for (const u of this.updaters) if (u.setSize) u.setSize(w, h);
  }

  update(dt, t) {
    for (const u of this.updaters) if (u.update) u.update(dt, t);
  }

  renderReflections(renderer, camera, skyScene, skyCamera) {
    this.water.renderReflection(renderer, camera, this.scene, skyScene, skyCamera, this.reflectionHide, this.app.skyDome.material);
  }
}

/** Decimated copy of the inner terrain grid (for reflections). */
function buildCoarseGeometry(heights, step) {
  const { half, n } = INNER;
  const s = n + 1;
  const m = Math.floor(n / step);
  const cs = m + 1;
  const pos = new Float32Array(cs * cs * 3);
  const d = (2 * half) / m;
  for (let j = 0; j < cs; j++) for (let i = 0; i < cs; i++) {
    const k = (j * cs + i) * 3;
    pos[k] = -half + i * d; pos[k + 1] = heights[(j * step) * s + i * step]; pos[k + 2] = -half + j * d;
  }
  const idx = new Uint32Array(m * m * 6);
  let p = 0;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const a = j * cs + i, b = a + 1, c = a + cs, e = c + 1;
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = e;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), half * 1.5);
  return g;
}

export { terrainHeight };
