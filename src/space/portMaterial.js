import * as THREE from 'three';
import { createDressedMaterial } from './craftMesh.js';

// The dressed craft material with the geostationary port's civic finishes, and baked contact
// occlusion. Kinds 30..37 (the plain and dressed materials fall back to pearl plate for them):
//   30 PAVING   granite setts in running bond, 12 m bays inlaid with basalt, path lights at
//               the bay corners, worn paler along the busy lines
//   31 LAWN     mown grass in 4 m stripes, clover-dark where it is walked
//   32 WATER    a still reflecting pool: dark, glossy, faint ripples, lit from below at night
//   33 CANOPY   ETFE cushions in a 6 m diamond net on steel, glowing warm on the night side
//   34 STONE    ashlar cladding: 0.9 m courses, weathered, a string course every 7.2 m
//   35 BEDS     shrub beds and tree crowns: clumped foliage, a few flowering, soil between
//   36 GLASSHOUSE  garden vaults: clear panes on bronze glazing bars, ribs every 18 m, the
//               planting and its paths seen dimly through glass that mirrors the sky
//   37 HALL     concourse vaults and enclosed walks: the same glazing over a lit public
//               floor, warm and busy after dark, bright bands where the lamp rows run
// A per-vertex aOcc (0 open .. 1 buried) darkens the lit terms only, so walls go dusky toward
// the deck they stand on and the deck darkens round every footing; lamps and windows keep their
// glow. A geometry without aOcc reads the attribute default 0 and draws unoccluded.

export const PK = { PAVING: 30, LAWN: 31, WATER: 32, CANOPY: 33, STONE: 34, BEDS: 35, GLASSHOUSE: 36, HALL: 37 };

export const PORT_GLSL = /* glsl */ `
void portKinds(float k, vec2 f, vec2 fw, float px, inout vec3 alb, inout float rough, inout float metal, inout vec3 em, inout vec2 bump) {
  if (k < 29.5 || k > 37.5) return;
  float det = 1.0 - smoothstep(0.25, 0.8, px);
  float detB = 1.0 - smoothstep(1.2, 4.0, px);
  float farK = 1.0 - smoothstep(6.0, 18.0, px);
  if (k < 30.5) {
    // setts: 1.2 x 0.6 m in running bond, each a shade apart
    float row = floor(f.y / 0.6);
    vec2 sc = floor(vec2(f.x / 1.2 + 0.5 * mod(row, 2.0), row));
    float h = hash12(sc + 7.0);
    vec3 lime = vec3(0.43, 0.405, 0.37);
    vec3 grey = vec3(0.35, 0.35, 0.345);
    vec3 base = mix(lime, grey, 0.3 + 0.4 * mix(0.5, h, det));
    float joint = max(gridLine(f.x + 0.6 * mod(row, 2.0), 1.2, 0.02, fw.x), gridLine(f.y, 0.6, 0.02, fw.y)) * det;
    base *= 1.0 - 0.25 * joint;
    // 12 m bays bordered by 0.6 m basalt bands, a 48 m order of paler and darker fields
    float band = max(cLine(f.x, 12.0, 0.3, fw.x), cLine(f.y, 12.0, 0.3, fw.y));
    float field = hash12(floor(f / 48.0) + 3.0);
    base *= mix(1.0, 0.92 + 0.14 * field, farK);
    base *= mix(1.0, 0.94 + 0.1 * hash12(floor(f / 12.0) + 19.0), detB);
    alb = mix(base, vec3(0.13, 0.13, 0.14), band * 0.85);
    // wear and grime at the scale of a crowd: paler where it is walked, darker at the edges
    float wear = vnoise(f * 0.021 + 5.0) * 0.6 + vnoise(f * 0.09) * 0.4;
    alb *= 0.9 + 0.18 * wear;
    rough = 0.72 - 0.12 * band;
    metal = 0.02;
    // path lights at each bay corner: 0.35 m warm discs, their mean kept when subpixel
    vec2 lc = (fract(f / 12.0 + 0.5) - 0.5) * 12.0;
    float lamp = 1.0 - smoothstep(0.35, 0.35 + max(fw.x, fw.y), length(lc));
    em = vec3(1.0, 0.8, 0.55) * mix(0.0027, lamp, detB) * 1.6;
  } else if (k < 31.5) {
    float stripe = mix(0.5, step(0.5, fract(f.x / 8.0)), detB);
    float g = mix(0.5, vnoise(f * 0.8) * 0.6 + vnoise(f * 3.1) * 0.4, det);
    float clump = vnoise(f * 0.05 + 11.0);
    alb = mix(vec3(0.055, 0.105, 0.035), vec3(0.1, 0.165, 0.055), 0.35 * stripe + 0.4 * g + 0.25 * clump);
    rough = 0.95; metal = 0.0;
    bump += (vec2(vnoise(f * 2.3), vnoise(f * 2.3 + 4.0)) - 0.5) * 0.4 * det;
  } else if (k < 32.5) {
    float t = uTime * 0.4;
    vec2 rip = vec2(sin(f.x * 0.7 + t) + 0.6 * sin(f.x * 0.23 - f.y * 0.31 + t * 0.7), sin(f.y * 0.55 - t * 0.8) + 0.5 * sin((f.x + f.y) * 0.19 + t));
    alb = vec3(0.012, 0.03, 0.04);
    rough = 0.04; metal = 0.75;
    bump += rip * 0.035 * detB;
    // coping lights along the pool's floor, a teal glow that reads only when the Sun is away
    em = vec3(0.12, 0.45, 0.5) * 0.02;
  } else if (k < 33.5) {
    vec2 d = vec2(f.x + f.y, f.x - f.y) * 0.7071;
    vec2 q = fract(d / 6.0) - 0.5;
    float net = max(gridLine(d.x, 6.0, 0.12, fw.x), gridLine(d.y, 6.0, 0.12, fw.y)) * mix(0.25, 1.0, det);
    float pillow = mix(0.6, 1.0 - 2.0 * max(abs(q.x), abs(q.y)), det);
    alb = mix(vec3(0.5, 0.52, 0.52) * (0.85 + 0.15 * pillow), vec3(0.2, 0.2, 0.21), net);
    rough = mix(0.18, 0.45, net); metal = mix(0.12, 0.6, net);
    bump += q * (1.0 - net) * 0.8 * det;
    em = vec3(1.0, 0.78, 0.52) * 0.05 * (1.0 - net) * (0.7 + 0.3 * pillow);
  } else if (k < 34.5) {
    float row = floor(f.y / 0.9);
    float hr = hash12(vec2(row, 3.0));
    vec2 bc = vec2(floor(f.x / 1.8 + hr), row);
    float h = hash12(bc + 23.0);
    vec3 base = vec3(0.45, 0.42, 0.38) * mix(1.0, 0.9 + 0.18 * h, det);
    float joint = max(gridLine(f.x / 1.8 + hr, 1.0, 0.012, fw.x / 1.8), gridLine(f.y, 0.9, 0.015, fw.y)) * det;
    base *= 1.0 - 0.3 * joint;
    float course = cLine(f.y, 7.2, 0.25, fw.y);
    base *= 1.0 - 0.28 * course;
    float streak = smoothstep(0.55, 0.9, vnoise(vec2(f.x * 0.25, f.y * 0.018) + 2.0));
    alb = base * (1.0 - 0.18 * streak * detB);
    rough = 0.68; metal = 0.02;
    bump.y += course * 0.4 * detB;
  } else if (k > 35.5) {
    // glasshouse: 3 x 2.4 m panes on bronze bars, a heavier rib every 18 m; beneath the glass
    // the beds and gravel paths of the garden, dim, and warm lamps among them after dark
    float bars = max(gridLine(f.x, 3.0, 0.08, fw.x), gridLine(f.y, 2.4, 0.08, fw.y)) * det;
    float rib = max(cLine(f.x, 18.0, 0.45, fw.x), cLine(f.y, 24.0, 0.35, fw.y));
    float frame = max(mix(0.07, bars, det), rib);
    float fol = mix(0.5, vnoise(f * 0.11) * 0.6 + vnoise(f * 0.6) * 0.4, detB);
    float walk = mix(0.15, max(cLine(f.x, 36.0, 1.6, fw.x), cLine(f.y, 30.0, 1.4, fw.y)), farK);
    float hallK = step(36.5, k);
    vec3 garden = mix(mix(vec3(0.02, 0.05, 0.018), vec3(0.07, 0.12, 0.04), fol), vec3(0.16, 0.15, 0.12), walk);
    vec3 floorC = mix(vec3(0.09, 0.085, 0.08), vec3(0.2, 0.18, 0.15), fol);
    vec3 inside = mix(garden, floorC, hallK);
    alb = mix(inside, vec3(0.5, 0.4, 0.26), frame);
    rough = mix(0.05, 0.35, frame); metal = mix(0.55, 0.85, frame);
    float hh = hash12(floor(f / vec2(6.0, 4.8)) + 29.0);
    // the hall's lamp rows every 12 m along it, pools of light and the crowd beneath
    float rows = mix(0.3, 1.0 - smoothstep(0.6, 2.0, abs(fract(f.x / 12.0 + 0.5) - 0.5) * 12.0), detB);
    float glow = mix(0.02 + 0.05 * walk + 0.05 * step(0.9, hh) * det, 0.07 + 0.16 * rows + 0.04 * hh, hallK);
    em = vec3(1.0, 0.76, 0.48) * glow * (1.0 - frame);
  } else {
    float c = vnoise(f * 0.45) * 0.55 + vnoise(f * 1.7) * 0.45 * det;
    vec3 leaf = mix(vec3(0.035, 0.07, 0.03), vec3(0.11, 0.17, 0.06), c);
    float bloom = step(0.93, hash12(floor(f / 0.9) + 31.0)) * det;
    vec3 flower = mix(vec3(0.6, 0.2, 0.18), vec3(0.75, 0.62, 0.25), hash12(floor(f / 0.9) + 2.0));
    alb = mix(leaf, flower, bloom * 0.7);
    alb = mix(alb, vec3(0.07, 0.055, 0.04), smoothstep(0.62, 0.8, 1.0 - c) * 0.6);
    rough = 0.92; metal = 0.0;
    bump += (vec2(vnoise(f * 1.4 + 7.0), vnoise(f * 1.4 + 13.0)) - 0.5) * 0.9 * det;
  }
}
`;

let _cache = null;
/** Splice the port kinds and the occlusion into a dressed craft material's shaders. */
export function portShaders(vs, fs) {
  if (_cache && _cache.vs === vs && _cache.fs === fs) return _cache.out;
  const call = 'beltKinds(k, f, fw, px, alb, rough, metal, em, bump);';
  const main = 'void main() {';
  // the craft material's last lighting line (with or without the refined cavity occlusion)
  const lit = fs.includes('col += alb * 0.004 * occ + em;') ? 'col += alb * 0.004 * occ + em;' : 'col += alb * 0.004 + em;';
  const vmain = 'vFac = aFacade;';
  if (!fs.includes(call) || !fs.includes(lit) || fs.lastIndexOf(main) < 0 || !vs.includes(vmain)) {
    throw new Error('portMaterial: craft shader layout changed; cannot splice the port kinds');
  }
  const at = fs.lastIndexOf(main);
  const fOut = 'varying float vOcc;\n' + fs.slice(0, at) + PORT_GLSL + '\n' + fs.slice(at)
    .replace(call, `${call}\n  portKinds(k, f, fw, px, alb, rough, metal, em, bump);`)
    .replace(lit, `col = col * (1.0 - 0.82 * clamp(vOcc, 0.0, 1.0)) + ${lit.slice(7)}`);
  const vOut = 'attribute float aOcc;\nvarying float vOcc;\n' + vs.replace(vmain, `${vmain}\n  vOcc = aOcc;`);
  _cache = { vs, fs, out: { vs: vOut, fs: fOut } };
  return _cache.out;
}

/** The dressed material with the port kinds and baked contact occlusion. */
export function createPortMaterial(opts = {}) {
  const m = createDressedMaterial(opts);
  const s = portShaders(m.vertexShader, m.fragmentShader);
  m.vertexShader = s.vs;
  m.fragmentShader = s.fs;
  // meshes sharing the material without a baked aOcc (instanced fittings, lift cars) read an
  // explicit 0 rather than whatever generic attribute value the context last held
  m.defaultAttributeValues = { ...(m.defaultAttributeValues || {}), aOcc: [0] };
  m.userData.port = true;
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
