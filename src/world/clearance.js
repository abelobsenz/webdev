import * as THREE from 'three';
import { INNER, edt2d } from './terrain.js';
import { PLAZA_R } from './layout.js';

/**
 * Clearance field over the inner grid: how far (m) each point is from built structure.
 * Every architectural mesh (anything carrying an aFacade attribute: towers, low-rise,
 * promenades, piers, the Gate...) is rasterized from its actual triangles:
 *   ground: triangles touching the ground (within 2.5 m) -> walls, piers, pillars, podiums
 *   over:   anything within 42 m above the ground -> decks, canopies, low plates
 * Used by the tree planner (CPU) and the ground cover (GPU texture of `ground`).
 */
export function buildClearance(scene, groundAt, { N = 2048 } = {}) {
  const half = INNER.half;
  const cell = (2 * half) / N;
  const G = new Uint8Array(N * N), O = new Uint8Array(N * N);
  const toCell = (x) => (x + half) / cell;
  const mark = (arr, i, j) => { if (i >= 0 && j >= 0 && i < N && j < N) arr[j * N + i] = 1; };
  const v = new THREE.Vector3();
  const M = new THREE.Matrix4(), IM = new THREE.Matrix4();
  let tris = 0;

  const rasterTri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const minY = Math.min(ay, by, cy);
    const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
    if (Math.abs(mx) > half + 50 || Math.abs(mz) > half + 50) return;
    const g = Math.max(groundAt(mx, mz), 0);
    if (minY > g + 42) return;
    const target = minY < g + 2.5 ? 2 : 1;
    const x0 = Math.floor(toCell(Math.min(ax, bx, cx))), x1 = Math.floor(toCell(Math.max(ax, bx, cx)));
    const z0 = Math.floor(toCell(Math.min(az, bz, cz))), z1 = Math.floor(toCell(Math.max(az, bz, cz)));
    tris++;
    if ((x1 - x0) <= 1 && (z1 - z0) <= 1) {
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) { mark(O, i, j); if (target === 2) mark(G, i, j); }
      return;
    }
    // point-in-triangle for cell centres (plus the vertex cells)
    const e = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
    const area = e(ax, az, bx, bz, cx, cz);
    if (Math.abs(area) < 1e-6) return;
    for (let j = Math.max(z0, 0); j <= Math.min(z1, N - 1); j++) {
      const pz = -half + (j + 0.5) * cell;
      for (let i = Math.max(x0, 0); i <= Math.min(x1, N - 1); i++) {
        const px = -half + (i + 0.5) * cell;
        const w0 = e(bx, bz, cx, cz, px, pz) / area, w1 = e(cx, cz, ax, az, px, pz) / area, w2 = e(ax, az, bx, bz, px, pz) / area;
        const pad = -0.35;   // conservative by ~a third of a cell
        if (w0 >= pad && w1 >= pad && w2 >= pad) { O[j * N + i] = 1; if (target === 2) G[j * N + i] = 1; }
      }
    }
    for (const [x, z] of [[ax, az], [bx, bz], [cx, cz]]) { const i = Math.floor(toCell(x)), j = Math.floor(toCell(z)); mark(O, i, j); if (target === 2) mark(G, i, j); }
  };

  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.aFacade) return;
    const key = o.material && o.material.userData && o.material.userData.hooks && o.material.userData.hooks.key;
    if (key === 'plaza') return;              // the Axis plaza is ground, handled as a designed area
    meshes.push(o);
  });
  for (const o of meshes) {
    const g = o.geometry;
    const pos = g.attributes.position;
    const idx = g.index ? g.index.array : null;
    const nInst = o.isInstancedMesh ? (o.userData.fullCount || o.count) : 1;
    const W = new Float32Array(pos.count * 3);
    for (let k = 0; k < nInst; k++) {
      M.copy(o.matrixWorld);
      if (o.isInstancedMesh) { o.getMatrixAt(k, IM); M.multiply(IM); }
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(M);
        W[i * 3] = v.x; W[i * 3 + 1] = v.y; W[i * 3 + 2] = v.z;
      }
      const nt = idx ? idx.length / 3 : pos.count / 3;
      for (let t = 0; t < nt; t++) {
        const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
        rasterTri(W[a * 3], W[a * 3 + 1], W[a * 3 + 2], W[b * 3], W[b * 3 + 1], W[b * 3 + 2], W[c * 3], W[c * 3 + 1], W[c * 3 + 2]);
      }
    }
  }
  // the Axis plaza and its terraces are designed spaces: keep the generic planting off them
  const pr = PLAZA_R + 216;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell;
    if (x * x + z * z < pr * pr) G[j * N + i] = 1;
  }
  const dG = edt2d(G, N), dO = edt2d(O, N);
  const ground = new Float32Array(N * N), over = new Float32Array(N * N);
  const tex8 = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) {
    ground[k] = Math.sqrt(dG[k]) * cell - (G[k] ? cell * 0.5 : cell * 0.5);
    over[k] = Math.sqrt(dO[k]) * cell - cell * 0.5;
    tex8[k] = Math.max(0, Math.min(255, Math.round(ground[k] * 4)));
  }
  const tex = new THREE.DataTexture(tex8, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  const sample = (arr, x, z) => {
    const u = toCell(x) - 0.5, w = toCell(z) - 0.5;
    const i = Math.max(0, Math.min(N - 2, Math.floor(u))), j = Math.max(0, Math.min(N - 2, Math.floor(w)));
    const fu = Math.min(Math.max(u - i, 0), 1), fw = Math.min(Math.max(w - j, 0), 1);
    const a = arr[j * N + i], b = arr[j * N + i + 1], c = arr[(j + 1) * N + i], d = arr[(j + 1) * N + i + 1];
    return (a * (1 - fu) + b * fu) * (1 - fw) + (c * (1 - fu) + d * fu) * fw;
  };
  return {
    N, cell, half, ground, over, tex, meshes: meshes.length, tris,
    groundAt: (x, z) => (Math.abs(x) >= half || Math.abs(z) >= half ? 999 : sample(ground, x, z)),
    overAt: (x, z) => (Math.abs(x) >= half || Math.abs(z) >= half ? 999 : sample(over, x, z)),
  };
}
