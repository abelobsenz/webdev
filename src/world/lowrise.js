import * as THREE from 'three';
import { loftSections, latheFacade, mergeClean } from './geom.js';
import { createLowriseMaterial } from './facade.js';
import { mulberry32, smoothstep, createNoise2D } from './noise.js';
import { CENTRAL_ISLAND, ISLANDS, PLAZA_R } from './layout.js';
import { ISLETS } from './terrain.js';

const TAU = Math.PI * 2;
const nP = createNoise2D(313);

function roundedRect(w, d, r, seg = 4) {
  const pts = [];
  const corners = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, 1], [-w / 2 + r, -d / 2 + r, 2], [w / 2 - r, -d / 2 + r, 3]];
  for (const [cx, cz, q] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = (q * Math.PI) / 2 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  }
  return pts;
}
const scalePts = (pts, s, sz = s) => pts.map(([x, z]) => [x * s, z * sz]);

// Archetypes at unit scale (footprint ~1 x 1, height 1)
function archetypes() {
  const A = [];
  // 0. terraced slab: three setbacks with planted roofs
  {
    const base = roundedRect(1, 0.7, 0.18);
    const secs = [];
    const tiers = [[0, 0.58, 1], [0.58, 0.82, 0.8], [0.82, 1.0, 0.58]];
    for (const [y0, y1, s] of tiers) {
      secs.push({ y: y0, pts: scalePts(base, s) });
      secs.push({ y: y1, pts: scalePts(base, s) });
    }
    // build each tier separately so roofs cap
    const parts = [];
    for (const [y0, y1, s] of tiers) parts.push(loftSections([{ y: y0, pts: scalePts(base, s) }, { y: y1, pts: scalePts(base, s) }], { capTop: true, kindTop: 3 }));
    A.push(mergeClean(parts));
  }
  // 1. oval tower with a softly tapering crown
  {
    const secs = [];
    for (let j = 0; j <= 8; j++) {
      const v = j / 8;
      const s = 1 - 0.18 * v * v;
      const pts = [];
      for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; pts.push([Math.cos(a) * 0.5 * s, Math.sin(a) * 0.36 * s]); }
      secs.push({ y: v, pts });
    }
    A.push(mergeClean([loftSections(secs, { capTop: true, kindTop: 3 })]));
  }
  // 2. dome pavilion on a drum
  {
    const prof = [{ r: 0.5, y: 0 }, { r: 0.5, y: 0.34 }, { r: 0.47, y: 0.36 }];
    for (let i = 1; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); prof.push({ r: 0.46 * Math.cos(a) + 0.001, y: 0.36 + 0.64 * Math.sin(a) }); }
    A.push(mergeClean([latheFacade(prof, 20)]));
  }
  // 3. courtyard ring house
  {
    const prof = [{ r: 0.5, y: 0 }, { r: 0.5, y: 1 }, { r: 0.3, y: 1 }, { r: 0.3, y: 0.08 }, { r: 0.001, y: 0.08 }];
    A.push(mergeClean([latheFacade(prof, 24)]));
  }
  // 4. vesica "leaf" block with a twist
  {
    const secs = [];
    for (let j = 0; j <= 6; j++) {
      const v = j / 6;
      const rot = v * 0.5;
      const pts = [];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU;
        const x = Math.cos(a) * 0.5, z = Math.sin(a) * 0.22 * (1 - 0.3 * Math.cos(a) * Math.cos(a));
        pts.push([x * Math.cos(rot) - z * Math.sin(rot), x * Math.sin(rot) + z * Math.cos(rot)]);
      }
      secs.push({ y: v, pts });
    }
    A.push(mergeClean([loftSections(secs, { capTop: true, kindTop: 3 })]));
  }
  return A;
}

export function buildLowrise(scene, groundHeight, towers, settings) {
  const rnd = mulberry32(4242);
  const geos = archetypes();
  const placements = geos.map(() => []);
  const occupied = new Map();
  const cellKey = (x, z) => `${Math.floor(x / 40)},${Math.floor(z / 40)}`;
  const free = (x, z, r) => {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const k = `${Math.floor(x / 40) + dx},${Math.floor(z / 40) + dz}`;
      const list = occupied.get(k);
      if (list) for (const o of list) if (Math.hypot(o.x - x, o.z - z) < o.r + r + 6) return false;
    }
    return true;
  };
  const occupy = (x, z, r) => { const k = cellKey(x, z); if (!occupied.has(k)) occupied.set(k, []); occupied.get(k).push({ x, z, r }); };
  for (const t of towers) occupy(t.def.x, t.def.z, (t.def.radius || 60) * 2.4 + 20);

  const districts = [
    { x: CENTRAL_ISLAND.x, z: CENTRAL_ISLAND.z, r: CENTRAL_ISLAND.r * 0.92, inner: PLAZA_R + 240, tall: 0.5 },
    ...ISLANDS.map((i) => ({ x: i.x, z: i.z, r: i.r * 0.95, inner: 0, tall: 1 })),
    ...ISLETS.filter((i) => i.r > 150).map((i) => ({ x: i.x, z: i.z, r: i.r * 0.85, inner: 0, tall: 0.35 })),
  ];

  const tryPlace = (x, z, d, distNorm) => {
    const h = groundHeight(x, z);
    if (h < 2.2) return;
    // leave parks and green corridors
    const park = nP(x * 0.0035, z * 0.0035);
    if (park > 0.5) return;
    const foot = 16 + rnd() * 30;
    if (!free(x, z, foot * 0.55)) return;
    // slope check
    const hx = groundHeight(x + foot * 0.5, z), hz = groundHeight(x, z + foot * 0.5), hx2 = groundHeight(x - foot * 0.5, z), hz2 = groundHeight(x, z - foot * 0.5);
    const lo = Math.min(h, hx, hz, hx2, hz2), hi = Math.max(h, hx, hz, hx2, hz2);
    if (hi - lo > 9 || lo < 1.2) return;
    occupy(x, z, foot * 0.55);
    const centre = 1 - distNorm;
    const height = (10 + rnd() * 20 + Math.pow(centre, 1.6) * (40 + rnd() * 70)) * (0.5 + 0.5 * d.tall) + 6;
    let type;
    const r = rnd();
    if (height > 60 && r < 0.55) type = 1;
    else if (r < 0.42) type = 0;
    else if (r < 0.58) type = 2;
    else if (r < 0.74) type = 3;
    else type = 4;
    const ang = Math.atan2(z - d.z, x - d.x) + Math.PI / 2 + (rnd() - 0.5) * 0.3;
    const sy = type === 2 ? Math.min(height, foot * 0.9) : height;
    placements[type].push({ x, y: lo - 1.5, z, sx: foot, sy, sz: foot * (0.8 + rnd() * 0.5), rot: ang, seed: rnd() * 100, roof: rnd() });
  };

  for (const d of districts) {
    // concentric streets: place along rings with radial avenues left open
    for (let rr = Math.max(d.inner, 40); rr < d.r; rr += 40 + rnd() * 8) {
      const circ = TAU * rr;
      const n = Math.floor(circ / (42 + rnd() * 10));
      const off = rnd() * TAU;
      for (let k = 0; k < n; k++) {
        const a = off + (k / n) * TAU;
        // avenues
        if (Math.abs(((a * 6) / TAU) % 1 - 0.5) < 0.04) continue;
        const jr = rr + (rnd() - 0.5) * 12;
        const x = d.x + Math.cos(a) * jr, z = d.z + Math.sin(a) * jr;
        tryPlace(x, z, d, rr / d.r);
      }
    }
  }
  // rim towns: scattered villages along the atoll
  for (let k = 0; k < 2600; k++) {
    const a = rnd() * TAU, r = 5250 + rnd() * 1500;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const town = nP(Math.cos(a) * 2.2 + 50, Math.sin(a) * 2.2) * 0.5 + 0.5;
    if (town < 0.52) continue;
    tryPlace(x, z, { x: 0, z: 0, tall: 0.3 }, 0.9);
  }

  const mat = createLowriseMaterial('pearl', { litFrac: 0.5 });
  const meshes = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let total = 0;
  for (let t = 0; t < geos.length; t++) {
    const list = placements[t];
    if (!list.length) continue;
    const geo = geos[t];
    const inst = new Float32Array(list.length * 2);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx, p.sy + 1.5, p.sz));
      mesh.setMatrixAt(i, m4);
      inst[i * 2] = p.seed; inst[i * 2 + 1] = p.roof;
    });
    geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 2));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.userData.fullCount = list.length;
    scene.add(mesh);
    meshes.push(mesh);
    total += list.length;
  }
  const api = {
    meshes, total, placements, isFree: (x, z, r) => free(x, z, r),
    applyQuality(s) { for (const m of meshes) m.count = Math.floor(m.userData.fullCount * s.lowrise); },
  };
  api.applyQuality(settings);
  return api;
}
