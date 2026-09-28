// Land-use raster of the inner towns from the headless plan (no browser): water, streets,
// squares (by kind), lots, tower structure near the ground, lamps, civic sites, and whatever
// the towns layer (src/world/towns) plans. Usage:
//   node tools/inner-raster.mjs out.png cx cz half res
import fs from 'fs';
import { execFileSync } from 'child_process';
import * as THREE from 'three';
import { buildInnerPlan } from './inner-plan-harness.mjs';

export async function raster(regions, ctx) {
  const r = ctx || (await buildInnerPlan({ towns: true }));
  const { plan, raw, towers } = r;
  const F = plan.field;
  // tower triangles within 14 m of the ground, rasterised at 1 m
  const towerCells = new Map();
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const t of towers) {
    if (Math.hypot(t.def.x, t.def.z) > 7000) continue;
    const m = t.mesh; m.updateMatrixWorld(true);
    const g = m.geometry, p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let k = 0; k < n; k += 3) {
      for (let c = 0; c < 3; c++) v[c].fromBufferAttribute(p, idx ? idx.getX(k + c) : k + c).applyMatrix4(m.matrixWorld);
      const lo = Math.min(v[0].y, v[1].y, v[2].y);
      if (lo > raw(v[0].x, v[0].z) + 14) continue;
      const x0 = Math.floor(Math.min(v[0].x, v[1].x, v[2].x)), x1 = Math.floor(Math.max(v[0].x, v[1].x, v[2].x));
      const z0 = Math.floor(Math.min(v[0].z, v[1].z, v[2].z)), z1 = Math.floor(Math.max(v[0].z, v[1].z, v[2].z));
      if ((x1 - x0) * (z1 - z0) > 4000) continue;
      const e = (ax, az, bx, bz, px, pz) => (bx - ax) * (pz - az) - (bz - az) * (px - ax);
      const A = e(v[0].x, v[0].z, v[1].x, v[1].z, v[2].x, v[2].z);
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
        const px = i + 0.5, pz = j + 0.5;
        let inside = true;
        if (Math.abs(A) > 1e-6) {
          const w0 = e(v[1].x, v[1].z, v[2].x, v[2].z, px, pz) / A, w1 = e(v[2].x, v[2].z, v[0].x, v[0].z, px, pz) / A, w2 = 1 - w0 - w1;
          inside = w0 > -0.2 && w1 > -0.2 && w2 > -0.2;
        }
        if (inside) towerCells.set(i * 100003 + j, 1);
      }
    }
  }
  const outFiles = [];
  for (const { out, cx, cz, half, res } of regions) {
    const N = Math.round((2 * half) / res);
    const D = Buffer.alloc(N * N * 3);
    const X = (i) => cx - half + (i + 0.5) * res, Z = (j) => cz - half + (j + 0.5) * res;
    const set = (i, j, c) => { if (i < 0 || j < 0 || i >= N || j >= N) return; const k = (j * N + i) * 3; D[k] = c[0]; D[k + 1] = c[1]; D[k + 2] = c[2]; };
    const KC = { tower: [200, 190, 215], station: [170, 180, 215], civic: [225, 215, 170], landing: [200, 215, 200], village: [215, 200, 185] };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = X(i), z = Z(j), h = raw(x, z);
      let c;
      if (h < 0.3) c = [40, 70, 120];
      else if (F.edge(x, z) < 0) c = [70, 70, 70];
      else if (F.squareAt(x, z) > 0.5) {
        let best = null, bd = 1e9;
        for (const q of plan.squares) { const d = Math.hypot(q.x - x, q.z - z) - q.r; if (d < bd) { bd = d; best = q; } }
        c = (best && KC[best.kind]) || [185, 185, 175];
      } else if (h < 2.2) c = [225, 205, 150];
      else { const s = Math.min(1, h / 40); c = [110 + 50 * s, 160 + 30 * s, 95 + 30 * s]; }
      if (towerCells.has(Math.floor(x) * 100003 + Math.floor(z))) c = [120, 50, 150];
      set(i, j, c);
    }
    const P = (x, z) => [Math.floor((x - cx + half) / res), Math.floor((z - cz + half) / res)];
    const obb = (L, sx, sz, rot, c) => {
      const cs = Math.cos(rot), sn = Math.sin(rot), rr = Math.hypot(sx, sz) / 2;
      const [i0, j0] = P(L.x - rr, L.z - rr), [i1, j1] = P(L.x + rr, L.z + rr);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = X(i) - L.x, dz = Z(j) - L.z, u = dx * cs - dz * sn, w = dx * sn + dz * cs;
        if (Math.abs(u) < sx / 2 && Math.abs(w) < sz / 2) set(i, j, c);
      }
    };
    const disc = (x, z, rad, c, ring = false) => {
      const [i0, j0] = P(x - rad, z - rad), [i1, j1] = P(x + rad, z + rad);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = Math.hypot(X(i) - x, Z(j) - z); if (ring ? Math.abs(d - rad) < res * 0.7 : d < rad) set(i, j, c); }
    };
    for (const L of plan.lots) if (Math.abs(L.x - cx) < half + 50 && Math.abs(L.z - cz) < half + 50) obb(L, L.w, L.d, L.rot, [200, 60, 50]);
    for (const q of plan.squares) if (q.landmarkR) disc(q.x, q.z, q.landmarkR, [240, 190, 20]);
    for (const p of plan.civicParks || []) disc(p.x, p.z, p.landmarkR, [240, 190, 20]);
    // the towns layer: whatever it has planned (sites: {x, z, r} or footprints {poly})
    for (const s of plan.townSites || []) {
      if (s.poly) { for (let k = 0; k < s.poly.length; k++) { const a = s.poly[k], b = s.poly[(k + 1) % s.poly.length]; const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (res * 0.5)); for (let q = 0; q <= n; q++) { const [i, j] = P(a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n); set(i, j, s.color || [255, 140, 0]); } } }
      else disc(s.x, s.z, s.r, s.color || [255, 140, 0], !!s.ring);
    }
    for (const t of plan.trees || []) { const [i, j] = P(t.x, t.z); set(i, j, [20, 90, 30]); set(i + 1, j, [20, 90, 30]); set(i, j + 1, [20, 90, 30]); }
    for (const l of plan.lamps) { const [i, j] = P(l.x, l.z); set(i, j, [255, 255, 255]); }
    const tmp = out + '.rgb';
    fs.writeFileSync(tmp, D);
    execFileSync('/usr/local/bin/python3', ['-c', `import sys;from PIL import Image;d=open(sys.argv[1],'rb').read();Image.frombytes('RGB',(${N},${N}),d).save(sys.argv[2])`, tmp, out]);
    fs.unlinkSync(tmp);
    outFiles.push(out);
  }
  return outFiles;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, cx, cz, half, res] = process.argv.slice(2);
  await raster([{ out, cx: +cx, cz: +cz, half: +half, res: +res }]);
  console.log('wrote', out);
}
