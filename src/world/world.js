import * as THREE from 'three';
import { terrainHeight, buildTerrainData, buildInnerGeometry, buildOuterGeometry, buildInfoTexture, createTerrainMaterial, HeightSampler, ISLETS } from './terrain.js';
import { Water } from './water.js';
import { CENTRAL_ISLAND, ISLANDS, PLAZA_R, PLAZA_Y, TOWERS, FLOATING_ISLANDS } from './layout.js';
import { smoothstep, createNoise2D, mulberry32 } from './noise.js';
import { buildAxis } from './axis.js';
import { buildTowers } from './towers.js';
import { buildLowrise } from './lowrise.js';
import { TreeField } from './vegetation.js';
import { buildFloatingIslands } from './floating.js';
import { INNER } from './terrain.js';
import { buildInfrastructure, createBeacons } from './infrastructure.js';
import { Traffic } from '../life/traffic.js';
import { Chorus } from '../life/chorus.js';
import { Clouds } from '../life/clouds.js';
import { People } from '../life/people.js';

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
    this.scene.add(this.outer);

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
    for (const t of this.towers) {
      const c = t.collide;
      this.colliders.push({ x: t.def.x, z: t.def.z, y0: t.baseY - 10, y1: t.top, radius: (y) => c(y - t.baseY) + 4 });
    }
    progress(0.35); await tick();
    // Low-rise districts
    this.lowrise = buildLowrise(this.scene, gh, this.towers, this.settings);
    this.updaters.push(this.lowrise);
    progress(0.55); await tick();
    // Vegetation
    this.trees = new TreeField(this.scene, this.settings);
    this.trees.build(this.placeTrees());
    this.updaters.push({ applyQuality: (s) => this.trees.applyQuality(s), update: (dt, t) => this.trees.update(dt, t, this.app.camera) });
    progress(0.75); await tick();
    // Floating gardens
    this.floating = buildFloatingIslands(FLOATING_ISLANDS, this.scene, this.trees);
    for (const tl of this.floating.treeLists) this.trees.buildLocal(tl.trees, tl.group);
    this.updaters.push(this.floating);
    progress(0.82); await tick();
    // Promenades, the Gate, lotus pads, skyport
    this.infra = buildInfrastructure(this.scene, gh, (x, z) => this.sampler.get(x, z));
    this.colliders.push(...this.infra.colliders);
    // City life
    this.traffic = new Traffic(this.scene, this.settings);
    this.updaters.push(this.traffic);
    this.chorus = new Chorus(this.scene, this.settings);
    this.updaters.push(this.chorus);
    this.clouds = new Clouds(this.scene);
    this.updaters.push({ update: (dt) => this.clouds.update(dt, this.app.camera) });
    this.people = new People(this.scene, this.settings);
    this.updaters.push({ applyQuality: (s) => this.people.applyQuality(s), update: (dt, t) => this.people.update(dt, t, this.app.camera) });
    // aircraft beacons on every summit
    const beacons = [...this.axis.beacons, ...this.infra.beacons];
    for (const t of this.towers) beacons.push(t.def.x, t.top + 2, t.def.z);
    this.beacons = createBeacons(beacons);
    this.scene.add(this.beacons);
    progress(1);
  }

  placeTrees() {
    const rnd = mulberry32(2024);
    const trees = [];
    const { N } = this.info;
    const half = INNER.half;
    const cell = (2 * half) / N;
    const free = (x, z, r) => this.lowrise.isFree(x, z, r);
    const nearTower = (x, z) => this.towers.some((t) => Math.hypot(t.def.x - x, t.def.z - z) < (t.def.radius || 60) * 2.2 + 10);
    const tint = () => [0.85 + rnd() * 0.3, 0.85 + rnd() * 0.35, 0.8 + rnd() * 0.3];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const f = this.info.forest[k];
        const u = this.info.urban[k];
        const x = -half + (i + rnd()) * cell, z = -half + (j + rnd()) * cell;
        const rC = Math.hypot(x, z);
        if (rC < PLAZA_R + 225) continue;
        const h = this.sampler.get(x, z);
        if (h < 1.3) continue;
        let type = -1, s = 0;
        if (h < 5.5 && rnd() < 0.16) { type = 1; s = 13 + rnd() * 9; }
        else if (rnd() < f * 0.85) { type = 0; s = 11 + rnd() * 12; }
        else if (u > 0.3 && rnd() < 0.06) { type = rnd() < 0.5 ? 2 : 0; s = 9 + rnd() * 8; }
        if (type < 0) continue;
        if (u > 0.2 && !free(x, z, 4)) continue;
        if (nearTower(x, z)) continue;
        trees.push({ x, y: h - 0.5, z, s, type, rot: rnd() * Math.PI * 2, tint: tint() });
      }
    }
    // planted rings on the Axis plaza
    for (const [rr, n, type] of [[235, 120, 2], [395, 190, 0], [250, 60, 0]]) {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        if (Math.abs(((a * 12) / (Math.PI * 2)) % 1 - 0.5) < 0.12) continue; // keep avenues clear
        const jr = rr + (rnd() - 0.5) * 30;
        trees.push({ x: Math.cos(a) * jr, y: PLAZA_Y - 0.3, z: Math.sin(a) * jr, s: type === 2 ? 14 + rnd() * 5 : 12 + rnd() * 6, type, rot: rnd() * 6.28, tint: tint() });
      }
    }
    // terraces descending from the plaza
    for (let k = 0; k < 520; k++) {
      const a = rnd() * Math.PI * 2, rr = PLAZA_R + 20 + rnd() * 180;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const y = rr < PLAZA_R + 45 ? PLAZA_Y - 3.5 : rr < PLAZA_R + 92 ? PLAZA_Y - 7 : rr < PLAZA_R + 145 ? PLAZA_Y - 10.5 : PLAZA_Y - 14;
      trees.push({ x, y, z, s: 9 + rnd() * 9, type: rnd() < 0.3 ? 1 : 0, rot: rnd() * 6.28, tint: tint() });
    }
    // gardens on tower canopies and sky plates
    for (const t of this.towers) {
      const m = t.mesh; m.updateMatrixWorld();
      const spots = [...(t.discs || []), ...(t.plates || []).map((p) => ({ x: 0, y: p.y, z: 0, r: p.r }))];
      for (const d of spots) {
        const n = Math.floor(d.r * d.r * 0.004) + 2;
        for (let k = 0; k < n; k++) {
          const rr = Math.sqrt(rnd()) * d.r * 0.85, a = rnd() * 6.28;
          const lp = new THREE.Vector3(d.x + Math.cos(a) * rr, d.y, d.z + Math.sin(a) * rr).applyMatrix4(m.matrixWorld);
          if (t.plates && Math.hypot(lp.x - t.def.x, lp.z - t.def.z) < (t.def.radius || 60) * 0.3) continue;
          trees.push({ x: lp.x, y: lp.y, z: lp.z, s: 6 + rnd() * 6, type: 0, rot: rnd() * 6.28, tint: tint() });
        }
      }
    }
    return trees;
  }

  groundHeight(x, z) {
    const h = this.sampler.get(x, z);
    return Math.max(h, 0);
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
