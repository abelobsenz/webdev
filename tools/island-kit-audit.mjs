import * as THREE from 'three';
import { auditGeometry } from './geometry-audit.mjs';

// Per-solid topology for geometries built with src/world/islands/cityKit.js: every recorded
// index range is extracted as its own geometry and must be watertight, consistently wound,
// outward (positive volume), finite, with unit normals and no degenerate triangles.
export function solidGeometry(g, [i0, i1]) {
  const idx = g.index, P = g.attributes.position, N = g.attributes.normal, F = g.attributes.aFacade;
  const map = new Map(), pos = [], nrm = [], fac = [], out = [];
  for (let i = i0; i < i1; i++) {
    const v = idx.getX(i);
    let k = map.get(v);
    if (k === undefined) { k = pos.length / 3; map.set(v, k); pos.push(P.getX(v), P.getY(v), P.getZ(v)); nrm.push(N.getX(v), N.getY(v), N.getZ(v)); fac.push(F.getX(v), F.getY(v), F.getZ(v)); }
    out.push(k);
  }
  const s = new THREE.BufferGeometry();
  s.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  s.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  s.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  s.setIndex(out);
  return s;
}
export function auditSolids(g, { tolerance = 1e-4, limit = 20 } = {}) {
  const failures = [];
  let solids = 0, triangles = 0;
  for (const range of g.userData.islandSolids || []) {
    const s = solidGeometry(g, range), a = auditGeometry(s, { tolerance });
    solids++; triangles += a.triangles;
    const ok = a.boundaryEdges === 0 && a.nonManifoldEdges === 0 && a.inconsistentEdges === 0 && a.degenerates === 0 && a.nonFinite === 0 && a.invalidNormals === 0 && a.signedVolume > 0;
    if (!ok && failures.length < limit) failures.push({ meta: range[2], ...a });
  }
  return { solids, triangles, failures };
}
