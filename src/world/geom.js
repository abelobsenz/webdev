import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export { mergeGeometries };

/**
 * Extrude a sequence of closed 2D cross-sections (same point count) stacked
 * at given heights. Adds aFacade = (perimeter metres, height metres, kind).
 * sections: [{ y, pts: [[x,z], ...], kind }]
 */
export function loftSections(sections, { capTop = true, capBottom = false, kindTop = 1 } = {}) {
  const n = sections[0].pts.length;
  const pos = [], fac = [], idx = [];
  const rows = sections.length;
  for (let j = 0; j < rows; j++) {
    const s = sections[j];
    let per = 0;
    for (let i = 0; i <= n; i++) {
      const p = s.pts[i % n];
      if (i > 0) { const q = s.pts[i - 1]; per += Math.hypot(p[0] - q[0], p[1] - q[1]); }
      pos.push(p[0], s.y, p[1]);
      fac.push(per, s.y, s.kind ?? 0);
    }
  }
  const cols = n + 1;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const addCap = (s, top, kind) => {
    const base = pos.length / 3;
    const contour = s.pts.map((p) => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (let i = 0; i < n; i++) { const p = s.pts[i]; pos.push(p[0], s.y, p[1]); fac.push(p[0], p[1], kind); }
    // triangulateShape returns CW/CCW consistent with the contour; orient to face up/down
    for (const t of tris) {
      const [a, b, c] = t;
      const pa = s.pts[a], pb = s.pts[b], pc = s.pts[c];
      const cross = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      // in (x,z) with y up, cross > 0 means the triangle normal points down (-y)
      const up = cross < 0;
      if (up === top) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b);
    }
  };
  if (capTop) addCap(sections[rows - 1], true, kindTop);
  if (capBottom) addCap(sections[0], false, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Lathe around Y with facade coordinates. profile: [{ r, y, kind }] bottom → top. */
export function latheFacade(profile, segments = 64, { phase = 0, sx = 1, sz = 1 } = {}) {
  const pos = [], fac = [], idx = [];
  const cols = segments + 1;
  for (let j = 0; j < profile.length; j++) {
    const p = profile[j];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2 + phase;
      pos.push(Math.cos(a) * p.r * sx, p.y, Math.sin(a) * p.r * sz);
      fac.push((i / segments) * Math.PI * 2 * Math.max(p.r, 1), p.y, p.kind ?? 0);
    }
  }
  for (let j = 0; j < profile.length - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Tube swept along a polyline/curve with a varying radius (parallel-transport frames).
 * points: Vector3[], radius: (t) => r
 */
export function sweepTube(points, radius, radial = 16, { kind = 1, ellipse = 1, closeEnds = true } = {}) {
  const N = points.length;
  const tangents = [], normals = [], binormals = [];
  for (let i = 0; i < N; i++) {
    const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, N - 1)];
    tangents.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  // initial normal
  const t0 = tangents[0];
  let n0 = Math.abs(t0.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  n0 = new THREE.Vector3().crossVectors(t0, n0).normalize();
  normals.push(n0);
  binormals.push(new THREE.Vector3().crossVectors(t0, n0).normalize());
  for (let i = 1; i < N; i++) {
    const axis = new THREE.Vector3().crossVectors(tangents[i - 1], tangents[i]);
    const n = normals[i - 1].clone();
    if (axis.length() > 1e-6) {
      axis.normalize();
      const ang = Math.acos(THREE.MathUtils.clamp(tangents[i - 1].dot(tangents[i]), -1, 1));
      n.applyAxisAngle(axis, ang);
    }
    normals.push(n);
    binormals.push(new THREE.Vector3().crossVectors(tangents[i], n).normalize());
  }
  const pos = [], fac = [], idx = [];
  let len = 0;
  const cols = radial + 1;
  for (let j = 0; j < N; j++) {
    if (j > 0) len += points[j].distanceTo(points[j - 1]);
    const r = radius(j / (N - 1));
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a) * ellipse;
      const p = points[j];
      pos.push(p.x + (normals[j].x * c + binormals[j].x * s) * r, p.y + (normals[j].y * c + binormals[j].y * s) * r, p.z + (normals[j].z * c + binormals[j].z * s) * r);
      fac.push((i / radial) * Math.PI * 2 * r, len, kind);
    }
  }
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Add an aFacade attribute (constant kind) to a stock geometry so it can be merged. */
export function withFacade(geo, kind = 1, scaleU = 1) {
  const g = geo.index ? geo : geo;
  const p = g.attributes.position;
  const fac = new Float32Array(p.count * 3);
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    fac[i * 3] = uv ? uv.getX(i) * scaleU : 0;
    fac[i * 3 + 1] = p.getY(i);
    fac[i * 3 + 2] = kind;
  }
  g.setAttribute('aFacade', new THREE.BufferAttribute(fac, 3));
  return g;
}

/** Keep only position/normal/aFacade (+index) so geometries can be merged together. */
export function clean(geo) {
  const g = geo.index ? geo : geo;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aFacade'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.index) {
    const idx = [];
    for (let i = 0; i < g.attributes.position.count; i++) idx.push(i);
    g.setIndex(idx);
  }
  return g;
}

export function mergeClean(list) {
  return mergeGeometries(list.map(clean), false);
}
