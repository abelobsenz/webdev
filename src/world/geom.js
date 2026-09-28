import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export { mergeGeometries };

/**
 * Extrude a sequence of closed 2D cross-sections (same point count) stacked
 * at given heights. Adds aFacade = (perimeter metres, height metres, kind).
 * sections: [{ y, pts: [[x,z], ...], kind }]
 */
export function loftSections(sections, { capTop = true, capBottom = true, kindTop = 1 } = {}) {
  const n = sections[0].pts.length;
  const outline = sections[0].pts;
  const clockwise = outline.reduce((sum, p, i) => { const q = outline[(i + 1) % n]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) < 0;
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
      if (clockwise) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
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

/**
 * Lathe around Y with facade coordinates. Structural profiles close to the axis
 * at both ends. Use closedProfile for a ring's cross-section: its inner wall
 * joins the last profile point back to the first, preserving the central hole.
 * Planar profiles remain surface inlays; they have no enclosed volume to cap.
 */
export function latheFacade(profile, segments = 64, { phase = 0, sx = 1, sz = 1, capTop = true, capBottom = true, closedProfile = false } = {}) {
  if (closedProfile && (profile[0].r !== profile.at(-1).r || profile[0].y !== profile.at(-1).y)) profile = [...profile, profile[0]];
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
    // Coincident rings mark a hard normal/material boundary. Keep both sets
    // of vertices but do not manufacture zero-area faces between them.
    if (profile[j].r === profile[j + 1].r && profile[j].y === profile[j + 1].y) continue;
    for (let i = 0; i < segments; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      // A profile may terminate on the axis. Emit its fan once, without the
      // collapsed companion triangles that otherwise create zero normals.
      if (profile[j].r !== 0) idx.push(a, c, b);
      if (profile[j + 1].r !== 0) idx.push(b, c, d);
    }
  }
  const first = profile[0], last = profile.at(-1);
  const isClosed = first.r === last.r && first.y === last.y;
  const planar = profile.every(p => p.y === first.y);
  const cap = (p, top) => {
    if (p.r === 0) return;
    const base = pos.length / 3;
    pos.push(0, p.y, 0); fac.push(0, 0, 1);
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2 + phase;
      const x = Math.cos(a) * p.r * sx, z = Math.sin(a) * p.r * sz;
      pos.push(x, p.y, z); fac.push(x, z, 1);
    }
    for (let i = 0; i < segments; i++) {
      if (top) idx.push(base, base + i + 2, base + i + 1);
      else idx.push(base, base + i + 1, base + i + 2);
    }
  };
  if (!isClosed && !planar) {
    if (capBottom) cap(first, false);
    if (capTop) cap(last, true);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nr = g.attributes.normal;
  for (let j = 0; j < profile.length; j++) {
    const a = j * cols, b = a + segments;
    if (profile[j].r === 0) {
      const sign = j === 0 ? -1 : 1;
      for (let i = a; i <= b; i++) nr.setXYZ(i, 0, sign, 0);
    } else {
      const seam = new THREE.Vector3().fromBufferAttribute(nr, a).add(new THREE.Vector3().fromBufferAttribute(nr, b)).normalize();
      nr.setXYZ(a, seam.x, seam.y, seam.z); nr.setXYZ(b, seam.x, seam.y, seam.z);
    }
  }
  // Callers can supply an explicit material boundary beside another duplicated
  // ring. The middle copy then has no faces and no definable normal. Remove
  // only unreferenced vertices, retaining both visible sides of every crease.
  const used = new Uint8Array(g.attributes.position.count);
  for (const i of idx) used[i] = 1;
  const live = used.reduce((sum, n) => sum + n, 0);
  if (live < used.length) {
    const remap = new Uint32Array(used.length);
    for (let i = 0, next = 0; i < used.length; i++) if (used[i]) remap[i] = next++;
    for (const [name, attribute] of Object.entries(g.attributes)) {
      const data = new Float32Array(live * attribute.itemSize);
      for (let i = 0; i < used.length; i++) if (used[i]) for (let k = 0; k < attribute.itemSize; k++) data[remap[i] * attribute.itemSize + k] = attribute.array[i * attribute.itemSize + k];
      g.setAttribute(name, new THREE.BufferAttribute(data, attribute.itemSize));
    }
    g.setIndex(idx.map(i => remap[i]));
  }
  return g;
}

/**
 * Tube swept along a polyline/curve with a varying radius (parallel-transport frames).
 * points: Vector3[], radius: (t) => r
 */
export function sweepTube(points, radius, radial = 16, { kind = 1, ellipse = 1, closeEnds = true } = {}) {
  const N = points.length;
  const closed = N > 3 && points[0].distanceToSquared(points[N - 1]) < 1e-12 && Math.abs(radius(0) - radius(1)) < 1e-8;
  const tangents = [], normals = [], binormals = [];
  for (let i = 0; i < N; i++) {
    const a = points[closed && (i === 0 || i === N - 1) ? N - 2 : Math.max(i - 1, 0)];
    const b = points[closed && (i === 0 || i === N - 1) ? 1 : Math.min(i + 1, N - 1)];
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
  if (closed) {
    // Remove accumulated transport twist smoothly, so nonplanar closed loops
    // meet with identical frames instead of leaving a slit at their seam.
    const turn = Math.atan2(tangents[0].dot(new THREE.Vector3().crossVectors(normals[N - 1], normals[0])), normals[N - 1].dot(normals[0]));
    for (let i = 1; i < N; i++) {
      normals[i].applyAxisAngle(tangents[i], turn * i / (N - 1));
      binormals[i].crossVectors(tangents[i], normals[i]).normalize();
    }
    normals[N - 1].copy(normals[0]);
    binormals[N - 1].copy(binormals[0]);
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
  if (closeEnds && !closed) {
    for (const j of [0, N - 1]) {
      if (radius(j / (N - 1)) === 0) continue;
      const base = pos.length / 3, p = points[j];
      pos.push(p.x, p.y, p.z); fac.push(0, 0, kind);
      for (let i = 0; i <= radial; i++) {
        const source = (j * cols + i) * 3;
        pos.push(pos[source], pos[source + 1], pos[source + 2]);
        fac.push(Math.cos(i / radial * Math.PI * 2) * radius(j / (N - 1)), Math.sin(i / radial * Math.PI * 2) * radius(j / (N - 1)) * ellipse, kind);
      }
      for (let i = 0; i < radial; i++) {
        if (j === 0) idx.push(base, base + i + 2, base + i + 1);
        else idx.push(base, base + i + 1, base + i + 2);
      }
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
  // a zero or non-finite normal normalizes to NaN in the shader and renders black
  const nr = g.attributes.normal;
  for (let i = 0; i < nr.count; i++) {
    const x = nr.getX(i), y = nr.getY(i), z = nr.getZ(i), l = Math.hypot(x, y, z);
    if (!(l > 1e-6)) nr.setXYZ(i, 0, 1, 0);
  }
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
