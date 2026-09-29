import * as THREE from 'three';
import { renderedHeight } from '../outerCities.js';
import { SPECIES } from '../treeGeometry.js';
import { flowerColor } from '../vegetation.js';
import { HILL, habitat, hash2, OCC, flareGround, inHills, onPlatform, sstep, SPC, surveyAt, standDensity } from './cover.js';
import { SHAPE_OF, widthScale, midPrototypes, farPrototypes, crownMaterial } from './crowns.js';

// The woods of the northern mainland: closed broadleaf woods on the slopes too steep to farm and
// in every gully, woodlots and copses on the farmed ground, the cloud forest belt with its tree
// ferns, Norfolk pines on the crests and up to the tree line, bamboo in the wet ravines; and the
// planted trees of the countryside (village and farm gardens, avenues along the country roads,
// groves by the summit monasteries) given to it by the builders.
//
// One deterministic stream of trees, three representations:
//  * near (inside the tree system's near radius): the detailed species of the city's own trees
//    (TreeField's geometry and material), so a walk in the hills meets the same trees;
//  * mid (to MID_R): closed lathe crowns of about a hundred triangles, casting shadows;
//  * far (to FAR_MAX): a quarter of the trees as closed 6-sided crowns grown to keep the cover,
//    thinning further (and growing) with distance.
// Near and mid are generated tile by tile round the camera (the woods hold a couple of million
// trees; only the ones in reach exist at a time); the far quarter is generated once at load.
// Every tree is a candidate in an 11 m jittered grid, accepted by the habitat's woods density,
// kept off everything built (the occupancy survey: trunks off every road, field, wall and
// building, crowns clear of every building, terrace, pylon and reserved clearing), never in the
// water or on a cliff, and rooted at the lowest drawn ground under its root flare.

const CELL = 8, TILE = 16, TS = CELL * TILE;
const FAR_FRAC = 0.2;
export const WOODS = { MID_R: 820, MID_BAND: 100, FAR_MAX: 14000, CAST_R: 380 };
const TAU = Math.PI * 2;
const TRUNK_R = 1.6;

// species sizes (height, m): [min, max]
const SIZE = { 0: [15, 24], 1: [15, 23], 2: [12, 17], 3: [8, 12], 4: [12, 18], 5: [5, 8], 6: [10, 14], 8: [17, 23], 9: [18, 30] };
export const crownR = (sp, s) => SPECIES[sp].shape[2] * s * 0.5;

/** The woods' species for a site (deterministic from the two hashes). */
function pickSpecies(hb, r) {
  const h = hb.h;
  if (hb.zone === 3) return r < 0.6 ? SPC.araucaria : r < 0.9 ? SPC.forest : SPC.treeFern;
  if (hb.zone === 2) return r < 0.12 + 0.3 * hb.crest ? SPC.araucaria : r < 0.55 ? SPC.forestBroad : r < 0.83 ? SPC.forest : SPC.treeFern;
  if (hb.gully > 0.5 && h < 540) { if (r < 0.1) return SPC.bamboo; if (r < 0.26) return SPC.treeFern; }
  if (hb.crest > 0.45 && r < 0.4) return SPC.araucaria;
  if (hb.wood < 0.5) {
    // copses and the margins of the woods: shade trees, flowering trees, the odd giant fig
    if (r < 0.3) return SPC.rainTree;
    if (r < 0.42) return SPC.flowering;
    if (r < 0.45 && h < 220) return SPC.banyan;
  }
  return r < 0.46 ? SPC.forest : r < 0.86 ? SPC.forestBroad : r < 0.93 ? SPC.rainTree : r < 0.97 ? SPC.araucaria : SPC.flowering;
}

/**
 * The procedural candidate of cell (i, j), or null. out receives x, z, sp, s, rot, far, rank
 * and the tint (3). Deterministic: the same cell always answers the same, at load or later.
 */
function candidate(i, j, occ, out) {
  const x = (i + 0.12 + 0.76 * hash2(i, j, 2)) * CELL, z = (j + 0.12 + 0.76 * hash2(i, j, 3)) * CELL;
  if (!inHills(x, z)) return false;
  const hb = habitat(x, z);
  if (hb.wood <= 0 || hash2(i, j, 1) >= standDensity(hb.wood) || hb.s > 1.25 || hb.h < 4) return false;
  const sp = pickSpecies(hb, hash2(i, j, 5));
  const [a, b] = SIZE[sp];
  let s = a + (b - a) * hash2(i, j, 6);
  // stunted toward the tree line and on the crests
  s *= 1 - 0.38 * sstep(1250, 1750, hb.h) - 0.12 * hb.crest;
  const cr = crownR(sp, s);
  if (occ.any(x, z, TRUNK_R, OCC.FLAT | OCC.LOW | OCC.TALL | OCC.CLEAR | OCC.TREE | OCC.HOME)) return false;
  if (occ.any(x, z, cr * 0.85, OCC.TALL | OCC.CLEAR | OCC.HOME)) return false;
  if (onPlatform(x, z)) return false;
  out.x = x; out.z = z; out.sp = sp; out.s = s; out.rot = hash2(i, j, 7) * TAU;
  out.rank = hash2(i, j, 4);
  out.far = out.rank < FAR_FRAC;
  const v = 0.85 + 0.3 * hash2(i, j, 8);
  out.t0 = v * (0.9 + 0.16 * hash2(i, j, 9)); out.t1 = v * (0.92 + 0.16 * hash2(i, j, 10)); out.t2 = v * (0.88 + 0.14 * hash2(i, j, 11));
  out.bloom = hash2(i, j, 12);
  return true;
}

// a tile's records, packed: x y z s rot | sp | tint rgb | bloom | flags(1 = far, 2 = planted)
const REC = 11;
function packTile(list) {
  const a = new Float32Array(list.length * REC);
  list.forEach((t, k) => { a.set([t.x, t.y, t.z, t.s, t.rot, t.sp, t.t0, t.t1, t.t2, t.bloom, (t.far ? 1 : 0) | (t.planted ? 2 : 0)], k * REC); });
  return a;
}

/**
 * @param scene   the scene
 * @param trees   the TreeField (its species geometry, near material and LOD radius are shared)
 * @param occ     the built occupancy (cover.surveyBuilt), planted trees are marked into it
 * @param planted planted tree records {x, z, sp, s} (gardens, avenues, groves), already checked
 */
export function buildHillWoods(scene, trees, occ, planted = [], settings = {}) {
  const t0 = performance.now();
  const nearU = trees.nearMat.userData.hooks.uniforms;
  const U = {
    uNearR: nearU.uNearR, uBand: nearU.uBand,
    uMidR: { value: WOODS.MID_R }, uMidBand: { value: WOODS.MID_BAND },
    uThin0: { value: 4000 }, uThin1: { value: 12000 }, uKeep1: { value: 0.3 },
  };
  // ---- planted trees: bucketed by tile, marked so the woods keep their distance
  const plantedByTile = new Map();
  for (const p of planted) {
    const ti = Math.floor(p.x / TS), tj = Math.floor(p.z / TS), k = ti * 65536 + tj;
    if (!plantedByTile.has(k)) plantedByTile.set(k, []);
    plantedByTile.get(k).push(p);
    occ.circle(p.x, p.z, Math.max(2.5, crownR(p.sp, p.s) * 0.45), OCC.TREE);
  }
  const seat = (x, z, s) => {
    const fr = Math.max(1.0, Math.min(2.2, s * 0.06));
    const [lo, hi] = flareGround(x, z, fr);
    return { y: lo - 0.15, ok: lo > 3 && (hi - lo) / (2 * fr) < 0.9 };
  };
  const cand = { x: 0, z: 0, sp: 0, s: 0, rot: 0, far: false, rank: 0, t0: 1, t1: 1, t2: 1, bloom: 0 };
  const genTile = (ti, tj) => {
    const list = [];
    for (const p of plantedByTile.get(ti * 65536 + tj) || []) list.push({ ...p, planted: true, far: true });
    const i0 = ti * TILE, j0 = tj * TILE;
    for (let j = j0; j < j0 + TILE; j++) for (let i = i0; i < i0 + TILE; i++) {
      if (!candidate(i, j, occ, cand)) continue;
      const st = seat(cand.x, cand.z, cand.s);
      if (!st.ok) continue;
      list.push({ ...cand, y: st.y, planted: false });
    }
    return packTile(list);
  };

  // ---- the far quarter, generated once: every far-ranked candidate of the whole mainland
  const FC = 3600, farChunks = new Map();
  const farAdd = (x, y, z, sp, s, rot, tint, rank, grow) => {
    const k = Math.floor(x / FC) * 65536 + Math.floor(z / FC);
    let c = farChunks.get(k);
    if (!c) farChunks.set(k, (c = { x: (Math.floor(x / FC) + 0.5) * FC, z: (Math.floor(z / FC) + 0.5) * FC, byShape: [[], [], [], [], []] }));
    c.byShape[SHAPE_OF[sp]].push({ x, y, z, sp, s, rot, tint, rank, grow });
  };
  {
    const I0 = Math.floor(HILL.x0 / CELL), I1 = Math.ceil(HILL.x1 / CELL), J0 = Math.floor(HILL.z0 / CELL), J1 = Math.ceil(HILL.z1 / CELL);
    for (let j = J0; j < J1; j++) for (let i = I0; i < I1; i++) {
      if (hash2(i, j, 4) >= FAR_FRAC) continue;
      // quick rejections before the habitat: the sea and the inner grid
      const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
      if (surveyAt(x, z)[0] < 2) continue;
      if (!candidate(i, j, occ, cand)) continue;
      const y = renderedHeight(cand.x, cand.z);
      if (y < 3) continue;
      farAdd(cand.x, y - 0.3, cand.z, cand.sp, cand.s, cand.rot, [cand.t0, cand.t1, cand.t2], cand.rank / FAR_FRAC, 1.7);
    }
    for (const p of planted) farAdd(p.x, p.y, p.z, p.sp, p.s, p.rot, p.tint || [1, 1, 1], hash2(Math.round(p.x), Math.round(p.z), 4), 1);
  }
  const farProtos = farPrototypes(), farMat = crownMaterial('far', U);
  const farMeshes = [];
  const col = new THREE.Color(), m4 = new THREE.Matrix4();
  const colorOf = (sp, t0, t1, t2, bloom, out) => {
    const f = SPECIES[sp].farColor;
    out.setRGB(f[0] * t0, f[1] * t1, f[2] * t2);
    if (SPECIES[sp].bloom) { const c = flowerColor(bloom); out.r = out.r * 0.6 + c[0] * 0.14; out.g = out.g * 0.6 + c[1] * 0.14; out.b = out.b * 0.6 + c[2] * 0.14; }
    return out;
  };
  const compose = (e, o, x, y, z, rot, sw, sh) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    e[o] = c * sw; e[o + 1] = 0; e[o + 2] = -s * sw; e[o + 3] = 0;
    e[o + 4] = 0; e[o + 5] = sh; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = s * sw; e[o + 9] = 0; e[o + 10] = c * sw; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
  };
  let farCount = 0;
  for (const c of farChunks.values()) c.byShape.forEach((list, shape) => {
    if (!list.length) return;
    list.sort((a, b) => a.rank - b.rank);
    const g = farProtos[shape].clone();
    const rank = new Float32Array(list.length);
    const mesh = new THREE.InstancedMesh(g, farMat, list.length);
    const e = mesh.instanceMatrix.array;
    list.forEach((t, k) => {
      const ws = widthScale(t.sp) * t.grow, hs = t.grow > 1 ? 1.12 : 1;
      compose(e, k * 16, t.x, t.y, t.z, t.rot, t.s * ws, t.s * hs);
      mesh.setColorAt(k, colorOf(t.sp, t.tint[0], t.tint[1], t.tint[2], 0.5, col));
      rank[k] = k / list.length;
    });
    g.setAttribute('aRank', new THREE.InstancedBufferAttribute(rank, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = 'Hill woods: far crowns';
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.layers.set(1);
    mesh.userData = { cx: c.x, cz: c.z, full: list.length };
    scene.add(mesh);
    farMeshes.push(mesh);
    farCount += list.length;
  });
  farChunks.clear();   // the per-tree records are baked into the instances; the api's closures keep this scope alive

  // ---- the mid crowns and the near trees: dynamic instanced meshes round the camera
  const midProtos = midPrototypes(), midMat = crownMaterial('mid', U);
  // two sets: the crowns near the camera cast the woods' shadows (inside the near radius they
  // are the shadow proxies of the detailed trees, which do not cast); the rest do not
  const MID_CAP = [[16000, 4000, 6000, 4000, 2000], [36000, 9000, 12000, 9000, 4500]];
  const midSet = (cast) => midProtos.map((g, shape) => {
    const m = new THREE.InstancedMesh(g, midMat, MID_CAP[cast ? 0 : 1][shape]);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, col.setRGB(1, 1, 1));
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false;
    m.castShadow = cast; m.receiveShadow = true;
    m.layers.set(1);
    m.name = 'Hill woods: mid crowns';
    scene.add(m);
    return m;
  });
  const mid = [midSet(true), midSet(false)];
  const NEAR_CAP = 7000;
  const near = trees.species.map((s, sp) => {
    const g = s.geo.clone();
    const bl = new THREE.InstancedBufferAttribute(new Float32Array(NEAR_CAP * 4), 4);
    bl.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aBloom', bl);
    const m = new THREE.InstancedMesh(g, trees.nearMat, NEAR_CAP);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, col.setRGB(1, 1, 1));
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false; m.visible = false;
    m.castShadow = false; m.receiveShadow = true;
    m.layers.set(1);
    m.name = 'Hill woods: near trees';
    m.userData.H = s.H;
    scene.add(m);
    return m;
  });

  const tiles = new Map();
  let tileGen = 0;
  const getTile = (ti, tj, allowGen) => {
    const k = ti * 65536 + tj;
    let t = tiles.get(k);
    if (t) { t.used = tileGen; return t.data; }
    if (!allowGen) return null;
    t = { data: genTile(ti, tj), used: tileGen };
    tiles.set(k, t);
    return t.data;
  };
  const last = new THREE.Vector3(1e9, 0, 0);
  let lastNearR = 0, thin = settings.trees ?? 1, pending = false;
  const counts = [new Int32Array(5), new Int32Array(5)], ncounts = new Int32Array(trees.species.length);
  // the view: tiles wholly outside it (with a margin for the shadows they cast into it) are skipped
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere(), lastDir = new THREE.Vector3(), dir = new THREE.Vector3();
  const fill = (cp, budget, camera) => {
    tileGen++;
    const R = WOODS.MID_R + 40, nearR = U.uNearR.value + 30, castR2 = WOODS.CAST_R * WOODS.CAST_R;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const ti0 = Math.floor((cp.x - R) / TS), ti1 = Math.floor((cp.x + R) / TS), tj0 = Math.floor((cp.z - R) / TS), tj1 = Math.floor((cp.z + R) / TS);
    counts[0].fill(0); counts[1].fill(0); ncounts.fill(0);
    let missing = 0;
    // nearest tiles first when generating under a budget
    const order = [];
    for (let tj = tj0; tj <= tj1; tj++) for (let ti = ti0; ti <= ti1; ti++) {
      const x0 = ti * TS, z0 = tj * TS, dx = Math.max(x0 - cp.x, 0, cp.x - x0 - TS), dz = Math.max(z0 - cp.z, 0, cp.z - z0 - TS);
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      if (x0 + TS < HILL.x0 || x0 > HILL.x1 || z0 + TS < HILL.z0 || z0 > HILL.z1) continue;
      sph.center.set(x0 + TS / 2, surveyAt(x0 + TS / 2, z0 + TS / 2)[0] + 12, z0 + TS / 2); sph.radius = TS * 0.75 + 70;
      if (!frustum.intersectsSphere(sph)) continue;
      order.push([d, ti, tj]);
    }
    order.sort((a, b) => a[0] - b[0]);
    for (const [, ti, tj] of order) {
      let data = getTile(ti, tj, false);
      if (!data) { if (budget > 0) { data = getTile(ti, tj, true); budget--; } else { missing++; continue; } }
      for (let o = 0; o < data.length; o += REC) {
        const x = data[o], y = data[o + 1], z = data[o + 2];
        const dx = x - cp.x, dy = y - cp.y, dz = z - cp.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R * R) continue;
        const sp = data[o + 5];
        if (thin < 1 && !(data[o + 10] & 2) && ((Math.imul(Math.round(x * 7), 2654435761) >>> 0) % 1000) / 1000 > thin) continue;
        const s = data[o + 3], rot = data[o + 4], shape = SHAPE_OF[sp], set = d2 < castR2 ? 0 : 1;
        const M = mid[set][shape];
        if (counts[set][shape] < MID_CAP[set][shape]) {
          const k = counts[set][shape]++;
          const ws = widthScale(sp);
          compose(M.instanceMatrix.array, k * 16, x, y, z, rot, s * ws, s);
          colorOf(sp, data[o + 6], data[o + 7], data[o + 8], data[o + 9], col);
          M.instanceColor.array[k * 3] = col.r; M.instanceColor.array[k * 3 + 1] = col.g; M.instanceColor.array[k * 3 + 2] = col.b;
        }
        if (d2 < nearR * nearR) {
          const N = near[sp];
          if (ncounts[sp] < NEAR_CAP) {
            const k = ncounts[sp]++, sc = s / N.userData.H;
            compose(N.instanceMatrix.array, k * 16, x, y, z, rot, sc, sc);
            N.instanceColor.array[k * 3] = data[o + 6]; N.instanceColor.array[k * 3 + 1] = data[o + 7]; N.instanceColor.array[k * 3 + 2] = data[o + 8];
            const bl = N.geometry.attributes.aBloom.array;
            if (SPECIES[sp].bloom) { const c = flowerColor(data[o + 9]); bl[k * 4] = c[0]; bl[k * 4 + 1] = c[1]; bl[k * 4 + 2] = c[2]; bl[k * 4 + 3] = 1; }
            else { bl[k * 4] = bl[k * 4 + 1] = bl[k * 4 + 2] = bl[k * 4 + 3] = 0; }
          }
        }
      }
    }
    const upd = (attr, n, size) => { attr.clearUpdateRanges(); attr.addUpdateRange(0, Math.max(1, n) * size); attr.needsUpdate = true; };
    mid.forEach((ms, set) => ms.forEach((m, sh) => { const c = counts[set][sh]; m.count = c; m.visible = c > 0; upd(m.instanceMatrix, c, 16); upd(m.instanceColor, c, 3); }));
    near.forEach((m, sp) => { m.count = ncounts[sp]; m.visible = ncounts[sp] > 0; upd(m.instanceMatrix, ncounts[sp], 16); upd(m.instanceColor, ncounts[sp], 3); upd(m.geometry.attributes.aBloom, ncounts[sp], 4); });
    // forget the tiles long out of reach
    if (tiles.size > 900) for (const [k, t] of tiles) if (tileGen - t.used > 40) tiles.delete(k);
    return missing;
  };

  const api = {
    farMeshes, mid, near, farCount, tiles, genTile, U, REC, TS, crownR,
    buildMs: performance.now() - t0,
    applyQuality(s) {
      thin = s.trees ?? 1;
      for (const m of farMeshes) m.userData.thin = thin;
      last.set(1e9, 0, 0);
    },
    update(dt, t, camera) {
      if (!camera) return;
      const cp = camera.position;
      // far crowns: per chunk, drawn (and thinned) by distance
      const keepAt = (d) => 1 - (1 - U.uKeep1.value) * sstep(U.uThin0.value, U.uThin1.value, d);
      for (const m of farMeshes) {
        const d = Math.max(0, Math.hypot(m.userData.cx - cp.x, m.userData.cz - cp.z) - FC * 0.72);
        const vis = d < WOODS.FAR_MAX + cp.y * 0.5 && d + FC * 1.44 > WOODS.MID_R - WOODS.MID_BAND;
        m.visible = vis;
        if (vis) m.count = Math.max(1, Math.ceil(m.userData.full * Math.min(1, keepAt(d) * thin + 0.02)));
      }
      // mid and near: refill when the camera has moved, or tiles are still being generated
      const moved = last.distanceTo(cp);
      camera.getWorldDirection(dir);
      if (moved < 14 && dir.dot(lastDir) > 0.994 && lastNearR === U.uNearR.value && !pending) return;
      const teleport = moved > 300;
      const missing = fill(cp, teleport ? 1e9 : 10, camera);
      pending = missing > 0;
      last.copy(cp); lastDir.copy(dir); lastNearR = U.uNearR.value;
    },
  };
  api.applyQuality(settings);
  return api;
}
