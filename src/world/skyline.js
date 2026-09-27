import * as THREE from 'three';
import { terrainHeight, FAR_ISLANDS, MASSIF } from './terrain.js';
import { createFacadeMaterial } from './facade.js';
import { latheFacade, mergeClean } from './geom.js';
import { mulberry32 } from './noise.js';

// The metropolitan horizon. Beyond the Outer Wards, Greater Meridian carries on: towns
// of towers on the coasts of the far islands and terraced up the lower slopes of the
// northern massif. From 20-40 km only silhouettes and lit windows read, so each tower is
// a faceted lathe of a few hundred triangles (the full facade shader draws its windows),
// set among blocks of lower building massing.

const TAU = Math.PI * 2;

function tower(rnd, x, y, z, H, R) {
  const seg = 8 + Math.floor(rnd() * 4);
  const style = rnd();
  const prof = [];
  const rows = 7;
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    let r = R;
    if (style < 0.35) r = R * (1 - 0.55 * Math.pow(v, 1.4));                  // tapering
    else if (style < 0.65) r = R * (0.85 + 0.25 * Math.sin(Math.PI * v)) * (1 - 0.35 * v);   // bulging
    else r = R * (1 - 0.18 * Math.floor(v * 4) / 4);                            // setbacks
    prof.push({ r, y: y + H * v, kind: j === rows ? 1 : 0 });
  }
  // crown and spire
  const top = y + H;
  const rt = prof[prof.length - 1].r;
  prof.push({ r: rt * 0.82, y: top + 4, kind: 2 }, { r: rt * 0.3, y: top + 10, kind: 1 }, { r: 0.6, y: top + H * (0.06 + 0.08 * rnd()), kind: 2 }, { r: 0.01, y: top + H * 0.15, kind: 1 });
  const g = latheFacade(prof, seg, { phase: rnd() * TAU });
  g.translate(x, 0, z);
  return g;
}

function block(rnd, x, y, z, H, w, d, rot) {
  const g = latheFacade([{ r: 1, y: y - 6, kind: 5 }, { r: 1, y: y + H, kind: 5 }, { r: 0.001, y: y + H, kind: 1 }], 4, { phase: Math.PI / 4 });
  g.scale(w * 0.707, 1, d * 0.707);
  g.rotateY(rot);
  g.translate(x, 0, z);
  return g;
}

/** Place a town of towers and blocks round (cx, cz) on buildable ground. */
function cluster(parts, rnd, cx, cz, rIn, rOut, nTowers, nBlocks, hMax, minH = 2.5, maxH = 160) {
  const placed = [];
  const ok = (x, z, r) => {
    const h = terrainHeight(x, z);
    if (h < minH || h > maxH) return null;
    // not on a steep slope
    const s = Math.abs(terrainHeight(x + 40, z) - h) + Math.abs(terrainHeight(x, z + 40) - h);
    if (s > 60) return null;
    for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < p.r + r + 20) return null;
    return h;
  };
  let tries = 0, made = 0;
  while (made < nTowers && tries++ < nTowers * 30) {
    const a = rnd() * TAU, rr = rIn + (rOut - rIn) * Math.sqrt(rnd());
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    const R = 22 + rnd() * 55;
    const h = ok(x, z, R);
    if (h === null) continue;
    // taller toward each town's heart
    const H = hMax * (0.25 + 0.75 * Math.pow(rnd(), 1.6)) * (1.15 - 0.5 * (rr - rIn) / Math.max(rOut - rIn, 1));
    parts.push(tower(rnd, x, h - 4, z, H, R));
    placed.push({ x, z, r: R });
    made++;
  }
  tries = 0; made = 0;
  while (made < nBlocks && tries++ < nBlocks * 20) {
    const a = rnd() * TAU, rr = rIn + (rOut - rIn) * Math.sqrt(rnd());
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    const w = 40 + rnd() * 90, d = 30 + rnd() * 60;
    const h = ok(x, z, Math.max(w, d) * 0.6);
    if (h === null) continue;
    parts.push(block(rnd, x, h, z, 14 + rnd() * 50, w, d, rnd() * TAU));
    placed.push({ x, z, r: Math.max(w, d) * 0.5 });
    made++;
  }
}

export function buildSkyline(scene) {
  const rnd = mulberry32(2026);
  const groups = [];
  const pals = ['silver', 'pearl', 'jade', 'bronze', 'rose', 'sand'];
  FAR_ISLANDS.forEach(([ix, iz, ir, ih], i) => {
    const parts = [];
    // a coastal city ringing the island, densest on the side facing Meridian
    const toward = Math.atan2(-iz, -ix);
    for (let k = 0; k < 5; k++) {
      const a = toward + (k - 2) * 0.55 + (rnd() - 0.5) * 0.2;
      const cx = ix + Math.cos(a) * ir * 1.05, cz = iz + Math.sin(a) * ir * 1.05;
      const main = k === 2;
      cluster(parts, rnd, cx, cz, 0, ir * (main ? 0.75 : 0.5), main ? 42 : 18, main ? 220 : 90, (main ? 1250 : 800) * (0.8 + ih / 1600));
    }
    groups.push({ parts, pal: pals[i % pals.length], seed: 900 + i });
  });
  // terraces on the lower slopes of the northern massif, facing the sea
  MASSIF.slice(0, 3).forEach((m, i) => {
    const parts = [];
    const toward = Math.atan2(-m.z, -m.x);
    for (let k = 0; k < 3; k++) {
      const a = toward + (k - 1) * 0.5;
      const cx = m.x + Math.cos(a) * m.r * 1.25, cz = m.z + Math.sin(a) * m.r * 1.25;
      cluster(parts, rnd, cx, cz, 0, m.r * 0.45, 14, 120, 700, 2.5, 420);
    }
    groups.push({ parts, pal: pals[(i + 3) % pals.length], seed: 950 + i });
  });
  const meshes = [];
  let tris = 0;
  for (const gdef of groups) {
    if (!gdef.parts.length) continue;
    const geo = mergeClean(gdef.parts);
    const mat = createFacadeMaterial(gdef.pal, gdef.seed, { litFrac: 0.55, band: 128 });
    const m = new THREE.Mesh(geo, mat);
    m.name = 'Metropolitan skyline';
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    scene.add(m);
    meshes.push(m);
    tris += geo.index.count / 3;
  }
  return { meshes, tris };
}
