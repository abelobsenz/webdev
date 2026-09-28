import * as THREE from 'three';
import { createFacadeMaterial } from '../facade.js';
import { Kit } from './rimKit.js';
import { STRUCTURES } from './rimStructures.js';
import { placeRimSites, inPoly, parcelPoly } from './rimSites.js';
import { buildShoreJetties } from '../innerShore.js';
import { INNER } from '../terrain.js';
import { smoothstep } from '../noise.js';

// Builds the Rim's country, shores and avenue furniture (rimSites.js places them): every site's
// near model and far massing go into 700 m chunks, the near ones shown (with their shadows)
// within 900 m, the massing beyond it to 5 km (main view only); the lighthouses are their own
// chunks, their massing seen from anywhere and in the water. The lagoon strand gets its timber jetties (innerShore.js).
// The terrain's district channels are brought into line with the plan: the towns read as town,
// the designed parcels as tended ground (no wild forest floor under an orchard).

const CHUNK = 700;

export function buildRim(scene, world, ground, { quality = null } = {}) {
  const plan = world.plan;
  const rimD = plan && plan.districts.find((d) => d.id === 'rim');
  const rim = rimD && rimD.rim;
  const out = { meshes: [], sites: [], trees: [], chunks: [], designed: () => false, update() {}, applyQuality() {} };
  if (!rim) return out;
  const { sites, trees } = placeRimSites(plan, rim, ground);
  out.sites = sites; out.trees = trees;

  // ---- geometry: 700 m chunks (a lighthouse is its own, seen from far off)
  const chunks = new Map();
  const centre = (s) => { if (s.x !== undefined) return [s.x, s.z]; let x = 0, z = 0; for (const p of s.fp) { x += p[0]; z += p[1]; } return [x / s.fp.length, z / s.fp.length]; };
  for (const [i, s] of sites.entries()) {
    const fn = STRUCTURES[s.kind];
    if (!fn) continue;
    const [cx, cz] = centre(s);
    const landmark = s.kind === 'lighthouse';
    const key = landmark ? `lighthouse ${i}` : `${Math.floor(cx / CHUNK)},${Math.floor(cz / CHUNK)}`;
    if (!chunks.has(key)) chunks.set(key, { near: new Kit(), far: new Kit(), landmark });
    const ch = chunks.get(key);
    fn(ch.near, ch.far, s, ground);
  }
  const mat = createFacadeMaterial('pearl', 5490, { litFrac: 0.35, band: 1e5, uplight: 0 });
  for (const [key, ch] of chunks) {
    if (!ch.near.tris) continue;
    const near = new THREE.Mesh(ch.near.build(), mat), far = new THREE.Mesh(ch.far.build(), mat);
    near.name = `Rim ${key}`; far.name = `Rim ${key} (massing)`;
    for (const m of [near, far]) { m.matrixAutoUpdate = false; m.updateMatrix(); m.receiveShadow = true; scene.add(m); out.meshes.push(m); }
    near.castShadow = true; far.castShadow = false;
    // the country's detail is for the main view only; a lighthouse shows in the water too
    near.layers.set(1); far.layers.set(ch.landmark ? 0 : 1);
    const bs = far.geometry.boundingSphere || near.geometry.boundingSphere;
    out.chunks.push({ key, near, far, landmark: ch.landmark, center: bs.center.clone(), radius: bs.radius });
  }
  out.nearDist = 900;
  out.farDist = 5200;
  out.applyQuality = (s) => { out.nearDist = s && s.lowrise >= 1 ? 1000 : s && s.lowrise >= 0.75 ? 800 : 600; };
  if (quality) out.applyQuality(quality);
  out.update = (camera) => {
    if (!camera) return;
    const cp = camera.position;
    for (const c of out.chunks) {
      const d = cp.distanceTo(c.center) - c.radius;
      const near = d < out.nearDist;
      c.near.visible = near;
      // beyond a few kilometres the fields and gardens are below a pixel a row: the land shows
      c.far.visible = !near && (c.landmark || d < out.farDist + cp.y);
    }
  };

  // ---- the strand's jetties
  const strands = plan.streets.filter((st) => st.district === 'rim' && st.role === 'strand');
  out.jetties = buildShoreJetties(scene, strands, ground);
  for (const m of out.jetties.meshes) out.meshes.push(m);

  // ---- the designed ground: no natural planting in a cultivated parcel or a set piece
  const designedParcels = rim.parcels.filter((p) => p.kind && p.kind !== 'meadow' && p.kind !== 'wood');
  const polys = designedParcels.map((p) => ({ p, poly: parcelPoly(p) }));
  const PG = 96, pgrid = new Map();
  for (const e of polys) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [x, z] of e.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = Math.floor(x0 / PG); i <= Math.floor(x1 / PG); i++) for (let j = Math.floor(z0 / PG); j <= Math.floor(z1 / PG); j++) { const k = i * 100003 + j; if (!pgrid.has(k)) pgrid.set(k, []); pgrid.get(k).push(e); }
  }
  const parcelAt = (x, z) => { for (const e of pgrid.get(Math.floor(x / PG) * 100003 + Math.floor(z / PG)) || []) if (inPoly(e.poly, x, z)) return e.p; return null; };
  out.parcelAt = parcelAt;
  out.designed = (x, z) => !!parcelAt(x, z);

  // ---- the terrain's district channels on the rim: town where the towns are, tended ground in
  // the designed parcels, the wild left to the meadows and woods
  const info = world.info;
  if (info && info.tex && info.urban) {
    const N = info.N, half = INNER.half, cell = (2 * half) / N;
    const data = info.tex.image.data, toHalf = THREE.DataUtils.toHalfFloat;
    const townAt = rim.townAt;
    const F = plan.field;
    for (let j = 0; j < N; j++) {
      const z = -half + (j + 0.5) * cell;
      for (let i = 0; i < N; i++) {
        const x = -half + (i + 0.5) * cell, r = Math.hypot(x, z);
        if (r < 4900 || r > 7000) continue;
        const k = j * N + i;
        if (info.hgt && info.hgt[k] < 0.5) continue;
        const a = Math.atan2(z, x);
        const t = townAt(a);
        let u = info.urban[k], f = info.forest[k];
        if (t) {
          // the town's own fabric: full town inside its streets, easing out past its last block
          const e = F.edge(x, z);
          u = Math.max(u * 0.3, smoothstep(40, 8, e));
          f = Math.min(f, 0.05);
        } else {
          const p = parcelAt(x, z);
          if (p) { u = 0.32; f = 0; } else u = Math.min(u, 0.12);
        }
        if (u !== info.urban[k] || f !== info.forest[k]) {
          info.urban[k] = u; info.forest[k] = f;
          data[k * 4 + 1] = toHalf(u); data[k * 4 + 2] = toHalf(f);
        }
      }
    }
    info.tex.needsUpdate = true;
  }
  return out;
}
