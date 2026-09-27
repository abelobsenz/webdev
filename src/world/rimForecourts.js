import * as THREE from 'three';
import { latheFacade, sweepTube, mergeClean } from './geom.js';
import { createFacadeMaterial } from './facade.js';
import { towerFootprint } from './urban.js';

// Forecourts for the arcologies on the atoll rim: each stands in its paved square behind a
// ring colonnade (columns on the ground wherever it falls, a lintel ring carried level
// above them), with a fountain on the side facing the lagoon and marker obelisks on the
// cross axes. Lamps ring the colonnade.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildRimForecourts(scene, towers, ground, avoid = () => false) {
  const parts = [];
  const lamps = [];
  for (const t of towers) {
    const r0 = Math.hypot(t.def.x, t.def.z);
    if (r0 < 4700 || r0 > 7000 || t.def.ward) continue;
    const base = t.footprint || Math.max(towerFootprint(t, 100), t.collide ? t.collide(0) : (t.def.radius || 60) * 1.4);
    if (avoid(t.def.x, t.def.z, base + 40)) continue;
    const R = base + 7;
    const n = Math.max(24, Math.floor((TAU * R) / 8.5));
    let hi = -1e9;
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const x = t.def.x + Math.cos(a) * R, z = t.def.z + Math.sin(a) * R;
      const g = ground(x, z);
      pts.push([x, z, g]);
      hi = Math.max(hi, g);
    }
    if (hi < 1.5) continue;
    // a colonnade only where the whole ring stands on dry ground
    if (pts.filter((q) => q[2] < 1.2).length > n * 0.04) continue;
    const top = hi + 7.5;
    for (const [x, z, g] of pts) {
      if (g < 1.2 || avoid(x, z, 4)) continue;          // no columns in the water or on a bridgehead
      parts.push(latheFacade([{ r: 0.75, y: g - 1.5, kind: 1 }, { r: 0.75, y: g + 0.6, kind: 1 }, { r: 0.52, y: g + 0.8, kind: 1 }, { r: 0.44, y: top - 0.7, kind: 1 }, { r: 0.7, y: top - 0.3, kind: 1 }, { r: 0.7, y: top, kind: 1 }], 10).translate(x, 0, z));
    }
    const ring = [];
    for (let k = 0; k <= 96; k++) { const a = (k / 96) * TAU; ring.push(V(t.def.x + Math.cos(a) * R, top + 0.45, t.def.z + Math.sin(a) * R)); }
    parts.push(sweepTube(ring, () => 0.6, 6, { kind: 1, ellipse: 0.7 }));
    parts.push(sweepTube(ring.map((p) => p.clone().add(V(0, -0.85, 0))), () => 0.14, 4, { kind: 2 }));
    // the fountain toward the lagoon, obelisks on the cross axes
    const toL = Math.atan2(-t.def.z, -t.def.x);
    const fx = t.def.x + Math.cos(toL) * (R + 16), fz = t.def.z + Math.sin(toL) * (R + 16);
    const fg = ground(fx, fz);
    if (fg > 1.5) parts.push(latheFacade([{ r: 7, y: fg - 1, kind: 1 }, { r: 7, y: fg + 0.7, kind: 1 }, { r: 6.4, y: fg + 0.7, kind: 1 }, { r: 6.4, y: fg + 0.45, kind: 6 }, { r: 1.2, y: fg + 0.45, kind: 6 }, { r: 0.9, y: fg + 3.2, kind: 1 }, { r: 2.8, y: fg + 3.4, kind: 1 }, { r: 2.5, y: fg + 3.6, kind: 6 }, { r: 0.4, y: fg + 3.6, kind: 6 }, { r: 0.3, y: fg + 5.8, kind: 1 }, { r: 0.05, y: fg + 6.4, kind: 2 }], 28).translate(fx, 0, fz));
    for (const da of [Math.PI / 2, -Math.PI / 2]) {
      const a = toL + da;
      const ox = t.def.x + Math.cos(a) * (R + 12), oz = t.def.z + Math.sin(a) * (R + 12);
      const og = ground(ox, oz);
      if (og < 1.5) continue;
      parts.push(latheFacade([{ r: 2.2, y: og - 1, kind: 1 }, { r: 2.2, y: og + 0.8, kind: 1 }, { r: 0.8, y: og + 0.8, kind: 1 }, { r: 0.45, y: og + 12, kind: 1 }, { r: 0.001, y: og + 13, kind: 2 }], 4, { phase: Math.PI / 4 }).translate(ox, 0, oz));
    }
    for (let k = 0; k < 12; k++) {
      const a = ((k + 0.5) / 12) * TAU;
      const x = t.def.x + Math.cos(a) * (R + 3.5), z = t.def.z + Math.sin(a) * (R + 3.5);
      const g = ground(x, z);
      if (g > 1.5) lamps.push({ x, y: g - 0.1, z, yaw: a + Math.PI, cls: 0 });
    }
  }
  if (!parts.length) return { meshes: [], lamps };
  const mesh = new THREE.Mesh(mergeClean(parts), createFacadeMaterial('pearl', 4321, { litFrac: 0.5, band: 1e5 }));
  mesh.name = 'Rim forecourts';
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  scene.add(mesh);
  return { meshes: [mesh], lamps };
}
