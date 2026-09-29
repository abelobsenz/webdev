import * as THREE from 'three';
import { createDressedMaterial } from './craftMesh.js';

// The dressed craft material with the geostationary port's civic finishes, and baked contact
// occlusion. Kinds 30..36 (the plain and dressed materials fall back to pearl plate for them):
//   30 PAVING   granite setts in running bond, 12 m bays inlaid with basalt, path lights at
//               the bay corners, worn paler along the busy lines
//   31 LAWN     mown grass in 4 m stripes, clover-dark where it is walked
//   32 WATER    a still reflecting pool: dark, glossy, faint ripples, lit from below at night
//   33 CANOPY   ETFE cushions in a 6 m diamond net on steel, glowing warm on the night side
//   34 STONE    ashlar cladding: 0.9 m courses, weathered, a string course every 7.2 m
//   35 BEDS     shrub beds and tree crowns: clumped foliage, a few flowering, soil between
//   36 GLASSHOUSE  garden vaults: clear panes on bronze glazing bars, ribs every 18 m, the
//               planting and its paths seen dimly through glass that mirrors the sky
// A per-vertex aOcc (0 open .. 1 buried) darkens the lit terms only, so walls go dusky toward
// the deck they stand on and the deck darkens round every footing; lamps and windows keep their
// glow. A geometry without aOcc reads the attribute default 0 and draws unoccluded.

export const PK = { PAVING: 30, LAWN: 31, WATER: 32, CANOPY: 33, STONE: 34, BEDS: 35, GLASSHOUSE: 36 };

export const PORT_GLSL = /* glsl */ `
void portKinds(float k, vec2 f, vec2 fw, float px, inout vec3 alb, inout float rough, inout float metal, inout vec3 em, inout vec2 bump) {
  if (k < 29.5 || k > 36.5) return;
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
    vec3 inside = mix(mix(vec3(0.02, 0.05, 0.018), vec3(0.07, 0.12, 0.04), fol), vec3(0.16, 0.15, 0.12), walk);
    alb = mix(inside, vec3(0.5, 0.4, 0.26), frame);
    rough = mix(0.05, 0.35, frame); metal = mix(0.55, 0.85, frame);
    float hh = hash12(floor(f / vec2(6.0, 4.8)) + 29.0);
    em = vec3(1.0, 0.76, 0.48) * (0.02 + 0.05 * walk + 0.05 * step(0.9, hh) * det) * (1.0 - frame);
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
  const lit = 'col += alb * 0.004 + em;';
  const vmain = 'vFac = aFacade;';
  if (!fs.includes(call) || !fs.includes(lit) || fs.lastIndexOf(main) < 0 || !vs.includes(vmain)) {
    throw new Error('portMaterial: craft shader layout changed; cannot splice the port kinds');
  }
  const at = fs.lastIndexOf(main);
  const fOut = 'varying float vOcc;\n' + fs.slice(0, at) + PORT_GLSL + '\n' + fs.slice(at)
    .replace(call, `${call}\n  portKinds(k, f, fw, px, alb, rough, metal, em, bump);`)
    .replace(lit, 'col = col * (1.0 - 0.82 * clamp(vOcc, 0.0, 1.0)) + alb * 0.004 + em;');
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

/** Distance (>= 0) from (x, z) to an axis-aligned plan rectangle { x, z, w, d } (0 inside). */
export function rectDist(r, x, z) {
  const dx = Math.max(Math.abs(x - r.x) - r.w / 2, 0), dz = Math.max(Math.abs(z - r.z) - r.d / 2, 0);
  return Math.hypot(dx, dz);
}
