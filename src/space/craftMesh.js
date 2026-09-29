import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createCraftMaterial, updateCraftMaterial } from '../craft/craftMaterial.js';
import { createEngine } from '../craft/plumes.js';
import { createLamps } from './lamps.js';

// Shared helpers for anything built with the craft builder (metres) and drawn in the
// kilometre-scale orbital scene: one merged mesh per object with the space craft
// material (view-space lighting, camera-relative projection), engines, lamps.

export const KM = 0.001;
const _v = new THREE.Vector3();

/** A craft-material mesh in metres, scaled into km. Per-frame uniforms are set before it draws. */
export function craftMesh(geo, opts = {}, mat = null) {
  const m = mat || createCraftMaterial(opts);
  const mesh = new THREE.Mesh(geo, m);
  mesh.scale.setScalar(opts.scale ?? KM);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.userData.world = new THREE.Vector3();
  mesh.onBeforeRender = (r, s, cam) => {
    mesh.getWorldPosition(mesh.userData.world);
    const sd = mesh.userData.sunDir || CRAFT_FRAME.sunDir;
    updateCraftMaterial(m, cam, sd, mesh.userData.world, CRAFT_FRAME.time);
    m.uniformsNeedUpdate = true;
  };
  return mesh;
}

/** A second mesh sharing a craft mesh's material and per-frame update (moving parts). */
export function craftPart(parent, geo) {
  const m = new THREE.Mesh(geo, parent.material);
  m.frustumCulled = false;
  m.renderOrder = 3;
  m.onBeforeRender = parent.onBeforeRender;
  return m;
}

/** Frame-wide values the craft meshes read (set once per frame by the space mode). */
export const CRAFT_FRAME = { sunDir: new THREE.Vector3(1, 0, 0), time: 0 };

/** Plasma-throat + exhaust-column engines at a craft's nozzles (metres, craft frame). */
export function addEngines(mesh, glows, { scale = 0.6, length = 14, color = 0x7fd8ff, core = 0xeefaff, throttle = 1 } = {}) {
  const list = [];
  glows.forEach((g, i) => {
    const r = g.r * scale;
    const e = createEngine({ radius: r, length: r * length, color, core, seed: i * 0.37 + 0.11 });
    e.position.copy(g.p);
    e.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), g.dir);
    e.setThrottle(throttle);
    mesh.add(e);
    list.push(e);
  });
  return list;
}

/** Lamps riding on a mesh (lamp positions in the mesh's own units). */
export function addLamps(mesh, lamps, opts) {
  if (!lamps || !lamps.length) return null;
  const l = createLamps(lamps, opts);
  mesh.add(l);
  return l;
}

/** Merge craft geometries placed by matrices: [{ geo, m: Matrix4 }]. */
export function placeMerge(list) {
  const out = [];
  for (const { geo, m } of list) {
    const g = geo.clone();
    g.applyMatrix4(m);
    out.push(g);
  }
  const g = mergeGeometries(out, false);
  g.computeBoundingSphere();
  return g;
}

/** Transform lamp records by a matrix (positions) and its rotation (facing). */
export function placeLamps(lamps, m, scale = 1) {
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  m.decompose(p, q, s);
  return lamps.map((l) => ({ ...l, p: l.p.clone().applyMatrix4(m), r: l.r * s.x * scale, dir: l.dir ? l.dir.clone().applyQuaternion(q) : undefined }));
}

/** Apparent radius in pixels of a sphere of radius rKm at world position p. */
export function pixelRadius(cam, p, rKm, viewH) {
  const d = Math.max(_v.copy(p).sub(cam.position).length(), 1e-6);
  return (rKm / d) * viewH * 0.5 / Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
}

// ------------------------------------------------------------ dressed hulls --
// The craft material with the geostationary belt's working finishes: painted liveries with
// registration marks, plated hulls pierced by rows of lit ports, gold insulation foil, hazard
// aprons with chasing edge lights, weathered industrial plate, lit concourse glazing and
// phased-array emitter tiles. Kinds 20..26 (above the base palette's 0..13; the plain craft
// material falls back to pearl plate for them, so a dressed hull still draws with it).

export const DK = { LIVERY: 20, PORTS: 21, FOIL: 22, HAZARD: 23, GRIME: 24, CONCOURSE: 25, ARRAY: 26 };

export const DRESS_GLSL = /* glsl */ `
uniform vec3 uLivery;
uniform vec3 uLivery2;
// stencilled registration marks: blocky 3 x 5 glyphs of 1.2 m cells, four to a mark
float beltGlyph(vec2 q, float seed) {
  vec2 c = floor(q / 1.2);
  float ch = floor(c.x / 4.0);
  float col = c.x - ch * 4.0;
  float inside = step(0.0, c.x) * step(c.x, 15.0) * step(0.0, c.y) * step(c.y, 4.0) * step(col, 2.5);
  return inside * step(0.42, hash12(vec2(ch * 3.0 + seed, col * 5.0 + c.y)));
}
void beltKinds(float k, vec2 f, vec2 fw, float px, inout vec3 alb, inout float rough, inout float metal, inout vec3 em, inout vec2 bump) {
  if (k < 19.5 || k > 26.5) return;
  float det = 1.0 - smoothstep(0.4, 1.2, px);
  float detP = 1.0 - smoothstep(0.8, 2.3, px);
  float farK = 1.0 - smoothstep(3.0, 9.0, px);
  if (k < 20.5) {
    // livery: painted plates in the owner's colour, a contrasting double band every 48 m,
    // registration marks beside it, grime streaks where the RCS exhaust has washed the paint
    vec2 pc = floor(f / vec2(10.0, 6.0));
    float h = hash12(pc + 41.0);
    vec3 base = uLivery * mix(1.0, 0.9 + 0.16 * h, detP);
    float yb = fract(f.y / 48.0);
    float e = clamp(fw.y / 48.0, 0.0005, 0.2);
    float band = smoothstep(0.62 - e, 0.62 + e, yb) * (1.0 - smoothstep(0.78 - e, 0.78 + e, yb));
    float pin = smoothstep(0.83 - e, 0.83 + e, yb) * (1.0 - smoothstep(0.86 - e, 0.86 + e, yb));
    band = mix(0.19, band, farK);
    pin = mix(0.03, pin, detP);
    alb = mix(base, uLivery2, band);
    alb = mix(alb, vec3(0.86, 0.85, 0.8), pin);
    float seam = max(gridLine(f.x, 10.0, 0.07, fw.x), gridLine(f.y, 6.0, 0.07, fw.y)) * detP;
    alb *= 1.0 - 0.3 * seam;
    vec2 gq = vec2(fract(f.x / 60.0) * 60.0 - 4.0, fract(f.y / 48.0) * 48.0 - 23.0);
    float mark = beltGlyph(gq, floor(f.x / 60.0) * 7.0 + floor(f.y / 48.0)) * det;
    alb = mix(alb, vec3(0.9, 0.88, 0.82), mark * 0.9);
    float streak = smoothstep(0.55, 0.92, vnoise(vec2(f.x * 0.09, f.y * 0.012) + h * 3.0));
    alb *= 1.0 - 0.22 * streak * detP;
    rough = 0.42 + 0.14 * h * detP + 0.1 * streak;
    metal = 0.05;
  } else if (k < 21.5) {
    // plated hull with rows of ports: 0.84 m lit portholes every 3 m on 3.4 m decks, a blind
    // frame bay every fifth, each cabin lit or dark; the mean glow kept once they are subpixel
    vec2 cs = vec2(3.0, 3.4);
    vec2 c = floor(f / cs);
    vec2 q = f - (c + 0.5) * cs;
    float rr = length(q);
    float solid = step(4.5, c.x - floor(c.x / 5.0) * 5.0 + 0.5);
    float port = (1.0 - smoothstep(0.42, 0.42 + fw.x, rr)) * (1.0 - solid);
    float rim = max((1.0 - smoothstep(0.58, 0.58 + fw.x, rr)) * (1.0 - solid) - port, 0.0);
    float pr = mix(0.043, port, det);
    vec2 pc = floor(f / vec2(15.0, 6.8));
    float h = hash12(pc + 5.0);
    alb = vec3(0.72, 0.71, 0.68) * mix(1.0, 0.93 + 0.1 * h, detP);
    alb *= 1.0 - 0.3 * max(gridLine(f.x, 15.0, 0.07, fw.x), gridLine(f.y, 6.8, 0.07, fw.y)) * detP;
    alb = mix(alb, vec3(0.5, 0.42, 0.3), rim * det * 0.7);
    alb = mix(alb, vec3(0.03, 0.04, 0.05), pr);
    float on = step(1.0 - uLit, hash12(c + 13.0));
    vec3 lamp = mix(vec3(1.0, 0.77, 0.5), vec3(0.86, 0.92, 1.0), step(0.82, hash12(c + 2.0)));
    em = lamp * pr * mix(uLit, on, det) * 2.2;
    rough = mix(0.36, 0.08, pr); metal = mix(0.1, 0.5, pr);
    bump += q * rim * 1.2 * det;
  } else if (k < 22.5) {
    // multi-layer insulation: crinkled gold foil quilted every 1.2 m, glinting
    float fine = 1.0 - smoothstep(0.1, 0.4, px);
    float cr = mix(0.5, vnoise(f * 1.7) * 0.6 + vnoise(f * 5.3) * 0.4, fine);
    alb = mix(uLivery2 * 0.2 + vec3(0.66, 0.47, 0.18), vec3(0.95, 0.78, 0.4), cr);
    float quilt = max(gridLine(f.x, 1.2, 0.03, fw.x), gridLine(f.y, 1.2, 0.03, fw.y)) * (1.0 - smoothstep(0.05, 0.2, px));
    alb *= 1.0 - 0.3 * quilt;
    rough = 0.16 + 0.3 * cr; metal = 1.0;
    bump += (vec2(vnoise(f * 2.1 + 3.0), vnoise(f * 2.1 + 9.0)) - 0.5) * 0.7 * fine;
  } else if (k < 23.5) {
    // hazard apron: yellow and black chevrons, edge lamps every 8 m chasing toward the port
    float d = fract((f.x + f.y) / 3.2);
    float e = clamp(px / 3.2, 0.002, 0.5);
    float stripe = mix(0.5, smoothstep(0.5 - e, 0.5 + e, d), 1.0 - smoothstep(0.6, 1.6, px));
    alb = mix(vec3(0.82, 0.6, 0.07), vec3(0.04, 0.04, 0.045), stripe);
    rough = 0.55; metal = 0.1;
    vec2 lc = (fract(f / 8.0) - 0.5) * 8.0;
    float lamp = 1.0 - smoothstep(0.28, 0.28 + fw.x, length(lc));
    float chase = 0.25 + 0.75 * step(0.72, fract(f.y / 64.0 - uTime * 0.45));
    em = vec3(0.3, 1.0, 0.55) * mix(0.004, lamp, det) * chase * 3.0;
  } else if (k < 24.5) {
    // working plate: blue-grey industrial panels, exhaust streaks, rust at the seams,
    // stencilled bay numbers
    vec2 pc = floor(f / vec2(8.0, 5.0));
    float h = hash12(pc + 5.0);
    alb = mix(vec3(0.3, 0.33, 0.36), vec3(0.44, 0.44, 0.41), h * detP + 0.5 * (1.0 - detP));
    alb *= 1.0 - 0.35 * max(gridLine(f.x, 8.0, 0.06, fw.x), gridLine(f.y, 5.0, 0.06, fw.y)) * detP;
    float s = vnoise(vec2(f.x * 0.15, f.y * 0.02) + h);
    alb *= 1.0 - 0.28 * smoothstep(0.5, 0.9, s) * detP;
    float rust = smoothstep(0.7, 0.9, vnoise(f * 0.05 + 17.0));
    alb = mix(alb, vec3(0.4, 0.24, 0.13), rust * 0.55);
    vec2 gq = vec2(fract(f.x / 40.0) * 40.0 - 3.0, fract(f.y / 30.0) * 30.0 - 12.0);
    alb = mix(alb, vec3(0.85, 0.8, 0.55), beltGlyph(gq, floor(f.x / 40.0) + 3.0) * det * 0.85);
    rough = 0.5 + 0.2 * h + 0.15 * rust; metal = 0.3 - 0.2 * rust;
  } else if (k < 25.5) {
    // concourse glazing: 6 x 8 m panes on two 4 m floors, bright public interiors with
    // people walking along them
    float mull = max(gridLine(f.x, 6.0, 0.18, fw.x), gridLine(f.y, 8.0, 0.25, fw.y)) * det;
    float slab = gridLine(f.y, 4.0, 0.22, fw.y) * det;
    float h = hash12(floor(f / vec2(24.0, 8.0)) + 3.0);
    float lane = floor(f.y / 4.0);
    vec2 pp = vec2(f.x + uTime * (hash12(vec2(lane, 1.0)) - 0.5) * 2.4, f.y);
    float fl = fract(f.y / 4.0);
    float person = step(0.9, hash12(floor(pp / vec2(0.8, 4.0)) + 11.0)) * step(0.05, fl) * step(fl, 0.47);
    person *= 1.0 - smoothstep(0.05, 0.14, px);
    alb = mix(vec3(0.05, 0.06, 0.07), vec3(0.62, 0.61, 0.58), max(mull, slab));
    rough = mix(0.05, 0.4, mull); metal = mix(0.5, 0.2, mull);
    vec3 lamp = mix(vec3(1.0, 0.82, 0.6), vec3(0.9, 0.95, 1.0), step(0.75, h));
    em = lamp * (0.7 + 0.5 * h) * (1.0 - max(mull, slab)) * (1.0 - 0.85 * person) * mix(0.7, 1.0, det);
  } else {
    // phased-array emitter: dark 2 m tiles, a faint beam-forming glow sweeping across them
    float t = max(gridLine(f.x, 2.0, 0.06, fw.x), gridLine(f.y, 2.0, 0.06, fw.y)) * det;
    alb = vec3(0.06, 0.065, 0.08) + 0.2 * t;
    rough = 0.3; metal = 0.5;
    float wave = 0.5 + 0.5 * sin(uTime * 1.3 - (f.x + f.y) * 0.03);
    em = mix(vec3(1.0, 0.35, 0.2), uLivery2, 0.25) * 0.14 * (0.35 + 0.65 * wave) * (1.0 - t);
  }
}
`;

let _dressedFrag = null;
/** Splice the dressed kinds into the craft fragment shader (after the base palette's extra kinds). */
export function dressFrag(src) {
  if (_dressedFrag && _dressedFrag.src === src) return _dressedFrag.out;
  const call = 'craftExtraKinds(k, f, fw, px, alb, rough, metal, em);';
  const main = 'void main() {';
  if (!src.includes(call) || src.lastIndexOf(main) < 0) throw new Error('craftMesh: craft fragment shader layout changed; cannot dress it');
  const at = src.lastIndexOf(main);
  const out = src.slice(0, at) + DRESS_GLSL + '\n' + src.slice(at).replace(call, `${call}\n  beltKinds(k, f, fw, px, alb, rough, metal, em, bump);`);
  _dressedFrag = { src, out };
  return out;
}

/** The craft material with the dressed kinds (livery colours: main plate, bands and trim). */
export function createDressedMaterial(opts = {}) {
  const m = createCraftMaterial(opts);
  m.fragmentShader = dressFrag(m.fragmentShader);
  m.uniforms.uLivery = { value: new THREE.Color(...(opts.livery || [0.62, 0.26, 0.16])) };
  m.uniforms.uLivery2 = { value: new THREE.Color(...(opts.livery2 || [0.85, 0.83, 0.78])) };
  m.userData.dressed = true;
  return m;
}

/** A craft mesh drawn with the dressed material. */
export function dressedMesh(geo, opts = {}) {
  return craftMesh(geo, opts, createDressedMaterial(opts));
}

/** Owner liveries of the belt: [plate, band]. */
export const LIVERIES = [
  [[0.58, 0.2, 0.12], [0.88, 0.84, 0.74]],   // Concord oxide red, cream bands
  [[0.14, 0.26, 0.46], [0.9, 0.72, 0.3]],    // Harbour blue, brass
  [[0.82, 0.8, 0.74], [0.16, 0.42, 0.52]],   // pearl, teal
  [[0.2, 0.36, 0.26], [0.86, 0.84, 0.78]],   // Selene green
  [[0.86, 0.56, 0.12], [0.1, 0.1, 0.11]],    // works yellow, black
  [[0.3, 0.3, 0.34], [0.86, 0.3, 0.16]],     // graphite, signal orange
  [[0.62, 0.64, 0.7], [0.45, 0.14, 0.2]],    // silver, claret
  [[0.12, 0.12, 0.14], [0.78, 0.66, 0.4]],   // black, gold
];
