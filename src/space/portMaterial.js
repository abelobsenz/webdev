import * as THREE from 'three';
import { createDressedMaterial } from './craftMesh.js';
import { PK, PORT_GLSL } from './portKinds.glsl.js';

// The dressed craft material with the geostationary port's civic finishes (portKinds.glsl.js:
// paving, lawns, pools, canopies, stone, beds, glasshouses, halls, gallery plate, zinc roofs)
// and baked contact occlusion.
// A per-vertex aOcc (0 open .. 1 buried) darkens the lit terms only, so walls go dusky toward
// the deck they stand on and the deck darkens round every footing; lamps and windows keep their
// glow. A geometry without aOcc reads the attribute default 0 and draws unoccluded.
export { PK, PORT_GLSL };

let _cache = null;
/**
 * Splice the port kinds and the occlusion into a dressed craft material's shaders. Anchored
 * tolerantly and failing soft: the kinds go after the dressed kinds' call (or, failing that,
 * just before the bump is applied); the occlusion scales the lit sum just before the emissive
 * term is added (any form of the craft shader's last lighting line), or failing that the whole
 * colour before it is written. Anything that cannot be placed is left out (the port kinds then
 * draw as pearl plate), never a broken program. Returns { vs, fs, kinds, occ }.
 */
export function portShaders(vs, fs) {
  if (_cache && _cache.vs === vs && _cache.fs === fs) return _cache.out;
  const at = fs.lastIndexOf('void main() {');
  const vmain = 'vFac = aFacade;';
  const head = at >= 0 ? fs.slice(0, at) : fs;
  let body = at >= 0 ? fs.slice(at) : '';
  let kinds = false, occ = false;
  if (at >= 0) {
    const call = 'beltKinds(k, f, fw, px, alb, rough, metal, em, bump);';
    const bumpRe = /\n(\s*)N = normalize\(N \+ T \* bump\.x/;
    if (body.includes(call)) { body = body.replace(call, `${call}\n  portKinds(k, f, fw, px, alb, rough, metal, em, bump);`); kinds = true; }
    else if (bumpRe.test(body) && /\bfloat k\b/.test(body)) { body = body.replace(bumpRe, (m0, ind) => `\n${ind}portKinds(k, f, fw, px, alb, rough, metal, em, bump);${m0}`); kinds = true; }
  }
  if (kinds && vs.includes(vmain)) {
    // the last lighting line: col += alb * 0.004 [* occ] + em;
    const litRe = /col \+= (alb \* 0\.004[^;\n]*?)\+ em;/;
    const m = body.match(litRe);
    if (m) { body = body.replace(litRe, `col = col * (1.0 - 0.82 * clamp(vOcc, 0.0, 1.0)) + ${m[1]}+ em;`); occ = true; }
    else {
      const fc = body.lastIndexOf('gl_FragColor = vec4(col');
      if (fc > 0) { body = body.slice(0, fc) + 'col *= 1.0 - 0.82 * clamp(vOcc, 0.0, 1.0);\n  ' + body.slice(fc); occ = true; }
    }
  }
  let out;
  if (!kinds) {
    if (typeof console !== 'undefined') console.warn('portMaterial: craft shader layout changed; the port kinds draw as plain plate');
    out = { vs, fs, kinds: false, occ: false };
  } else {
    const fOut = (occ ? 'varying float vOcc;\n' : '') + head + PORT_GLSL + '\n' + body;
    const vOut = occ ? 'attribute float aOcc;\nvarying float vOcc;\n' + vs.replace(vmain, `${vmain}\n  vOcc = aOcc;`) : vs;
    out = { vs: vOut, fs: fOut, kinds, occ };
  }
  _cache = { vs, fs, out };
  return out;
}

/**
 * The dressed material with the port kinds and baked contact occlusion. opts.trim (default
 * 0.82) is where the brightest non-port plate settles (uPortTrim).
 */
export function createPortMaterial(opts = {}) {
  const m = createDressedMaterial(opts);
  const s = portShaders(m.vertexShader, m.fragmentShader);
  m.vertexShader = s.vs;
  m.fragmentShader = s.fs;
  m.uniforms.uPortTrim = { value: opts.trim ?? 0.82 };
  // meshes sharing the material without a baked aOcc (instanced fittings, lift cars) read an
  // explicit 0 rather than whatever generic attribute value the context last held
  if (s.occ) m.defaultAttributeValues = { ...(m.defaultAttributeValues || {}), aOcc: [0] };
  m.userData.port = s.kinds;
  return m;
}

/**
 * Bake aOcc into a craft geometry: fn(x, y, z, nx, ny, nz) -> occlusion 0..1 for each vertex
 * (positions and normals in the geometry's own units). Returns the geometry.
 */
export function bakeOcclusion(geo, fn) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const p = geo.attributes.position.array, n = geo.attributes.normal.array, cnt = geo.attributes.position.count;
  const occ = new Float32Array(cnt);
  for (let i = 0; i < cnt; i++) {
    const v = fn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
    occ[i] = v > 1 ? 1 : v > 0 ? v : 0;
  }
  geo.setAttribute('aOcc', new THREE.BufferAttribute(occ, 1));
  return geo;
}

/**
 * Bake cavity occlusion into aOcc for a free-standing structure (no deck to measure from): the
 * geometry's surface area is binned into a coarse voxel grid (cells ~1/48 of its size, never
 * under `minCell` m), and each vertex looks out along its normal at one, two and three cells:
 * surface found there is something close in front of it (the root of a boom on a hull, the
 * inside of a truss, a can between its neighbours) and darkens it. Open faces stay clean.
 * Keeps any stronger value already baked. Returns the geometry.
 */
export function bakeCavity(geo, { minCell = 4, strength = 0.75 } = {}) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox, p = geo.attributes.position.array, n = geo.attributes.normal.array;
  const cnt = geo.attributes.position.count, idx = geo.index ? geo.index.array : null;
  const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
  const cs = Math.max(Math.max(sx, sy, sz) / 48, minCell);
  const nx = Math.ceil(sx / cs) + 1, ny = Math.ceil(sy / cs) + 1, nz = Math.ceil(sz / cs) + 1;
  const grid = new Float32Array(nx * ny * nz);
  const cell = (x, y, z) => {
    const i = Math.floor((x - bb.min.x) / cs), j = Math.floor((y - bb.min.y) / cs), k = Math.floor((z - bb.min.z) / cs);
    return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : (k * ny + j) * nx + i;
  };
  const tris = idx ? idx.length / 3 : cnt / 3;
  for (let t = 0; t < tris; t++) {
    const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const g = cell((p[a * 3] + p[b * 3] + p[c * 3]) / 3, (p[a * 3 + 1] + p[b * 3 + 1] + p[c * 3 + 1]) / 3, (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3);
    if (g >= 0) grid[g] += area;
  }
  const full = 1 / (cs * cs * 1.2);        // about one wall's worth of surface through a cell
  const old = geo.attributes.aOcc ? geo.attributes.aOcc.array : null;
  const occ = new Float32Array(cnt);
  for (let v = 0; v < cnt; v++) {
    let o = 0;
    for (let s = 1; s <= 3; s++) {
      const d = cs * (s + 0.1);
      const g = cell(p[v * 3] + n[v * 3] * d, p[v * 3 + 1] + n[v * 3 + 1] * d, p[v * 3 + 2] + n[v * 3 + 2] * d);
      if (g >= 0) o += Math.min(grid[g] * full, 1) * (s === 1 ? 0.5 : s === 2 ? 0.32 : 0.18);
    }
    o = Math.min(o * strength, 0.8);
    occ[v] = old && old[v] > o ? old[v] : o;
  }
  geo.setAttribute('aOcc', new THREE.BufferAttribute(occ, 1));
  return geo;
}

/** Distance (>= 0) from (x, z) to an axis-aligned plan rectangle { x, z, w, d } (0 inside). */
export function rectDist(r, x, z) {
  const dx = Math.max(Math.abs(x - r.x) - r.w / 2, 0), dz = Math.max(Math.abs(z - r.z) - r.d / 2, 0);
  return Math.hypot(dx, dz);
}

/**
 * A loft of closed rings along z (as CB.loft) whose facade kind is chosen per QUAD, not per
 * vertex: every quad owns its four vertices, so a panel's kind ends at its seam instead of
 * the fragment shader interpolating through every kind number in between (a glazing (0)
 * vertex beside a livery (20) one used to draw thin bands of all nineteen kinds between).
 * kindFn(i, j) picks quad i round, j along. Returns the skin's [first, end) vertex range.
 */
export function quadLoft(B, rings, kindFn, { capStart = 10, capEnd = 10 } = {}) {
  const n = rings[0].pts.length, first = B.pos.length / 3, hint = new THREE.Vector3();
  const per = rings.map((R) => { const s = [0]; for (let i = 1; i <= n; i++) { const p = R.pts[i % n], q = R.pts[i - 1]; s.push(s[i - 1] + Math.hypot(p[0] - q[0], p[1] - q[1])); } return s; });
  let along = 0;
  for (let j = 0; j < rings.length - 1; j++) {
    const R0 = rings[j], R1 = rings[j + 1], a1 = along + Math.abs(R1.z - R0.z);
    let area = 0;
    for (let i = 0; i < n; i++) { const a = R0.pts[i], b = R0.pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const o = Math.sign(area) || 1;
    for (let i = 0; i < n; i++) {
      const k = kindFn(i, j), i1 = (i + 1) % n;
      const a = B.v(R0.pts[i][0], R0.pts[i][1], R0.z, per[j][i], along, k), b = B.v(R0.pts[i1][0], R0.pts[i1][1], R0.z, per[j][i + 1], along, k);
      const c = B.v(R1.pts[i][0], R1.pts[i][1], R1.z, per[j + 1][i], a1, k), d = B.v(R1.pts[i1][0], R1.pts[i1][1], R1.z, per[j + 1][i + 1], a1, k);
      const p = R0.pts[i], q = R0.pts[i1];
      hint.set((q[1] - p[1]) * o, (p[0] - q[0]) * o, 0);
      if (hint.lengthSq() < 1e-8) hint.set(0, 1, 0);
      B.tri(a, b, d, hint); B.tri(a, d, c, hint);
    }
    along = a1;
  }
  const skin = B.pos.length / 3;
  const cap = (R, dir, k) => {
    const cx = R.pts.reduce((s, p) => s + p[0], 0) / n, cy = R.pts.reduce((s, p) => s + p[1], 0) / n;
    const c = B.v(cx, cy, R.z, cx, cy, k), f0 = B.pos.length / 3;
    for (let i = 0; i < n; i++) B.v(R.pts[i][0], R.pts[i][1], R.z, R.pts[i][0], R.pts[i][1], k);
    for (let i = 0; i < n; i++) B.tri(c, f0 + i, f0 + ((i + 1) % n), new THREE.Vector3(0, 0, dir));
  };
  const dir = Math.sign(rings[rings.length - 1].z - rings[0].z) || 1;
  if (capStart !== false) cap(rings[0], -dir, capStart);
  if (capEnd !== false) cap(rings[rings.length - 1], dir, capEnd);
  return [first, skin];
}

/**
 * Append a copy of builder S's triangles to builder B under matrix m (then B's own frame): a
 * repeated assembly (one side of a truss ring) is built once and stamped, rather than every
 * member rebuilt through the tube generator. m must keep handedness (rotations, translations).
 */
export function stamp(B, S, m) {
  const base = B.pos.length / 3, v = new THREE.Vector3(), M = new THREE.Matrix4().multiplyMatrices(B.M, m), P = S.pos;
  for (let i = 0; i < P.length; i += 3) { v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M); B.pos.push(v.x, v.y, v.z); }
  for (let i = 0; i < S.fac.length; i++) B.fac.push(S.fac[i]);
  for (let i = 0; i < S.idx.length; i++) B.idx.push(base + S.idx[i]);
}

/**
 * Smooth the normals of a vertex range across its split seams: every vertex in [first, end)
 * takes the mean of the face normals meeting at its position within that range (the geometry's
 * other parts, box corners and all, keep their own).
 */
export function smoothRange(geo, first, end) {
  const p = geo.attributes.position.array, nrm = geo.attributes.normal.array, idx = geo.index.array;
  // weld the range once: every vertex to the first vertex at its position (to 1 cm)
  const weld = new Map(), rep = new Int32Array(end - first);
  for (let v = first; v < end; v++) {
    const k = `${Math.round(p[v * 3] * 100)},${Math.round(p[v * 3 + 1] * 100)},${Math.round(p[v * 3 + 2] * 100)}`;
    let r = weld.get(k);
    if (r === undefined) { r = v - first; weld.set(k, r); }
    rep[v - first] = r;
  }
  const acc = new Float64Array((end - first) * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (a < first || a >= end || b < first || b >= end || c < first || c >= end) continue;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { const r = rep[v - first] * 3; acc[r] += nx; acc[r + 1] += ny; acc[r + 2] += nz; }
  }
  for (let v = first; v < end; v++) {
    const r = rep[v - first] * 3, x = acc[r], y = acc[r + 1], z = acc[r + 2];
    const l = Math.hypot(x, y, z);
    if (l < 1e-12) continue;
    nrm[v * 3] = x / l; nrm[v * 3 + 1] = y / l; nrm[v * 3 + 2] = z / l;
  }
  geo.attributes.normal.needsUpdate = true;
  return geo;
}
