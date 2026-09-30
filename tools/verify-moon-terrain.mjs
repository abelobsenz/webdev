// Headless checks for the Moon's relief (moonTerrain.js), the ground contract (moonHeight.js) and
// the terrain patch round the camera (moonSurface.js): the GLSL and the JavaScript height
// functions carry the same constants, the ground is finite, flat where the Landing, the mass
// driver and the towns stand, at sea level on the water, continuous across the mask's cube seams,
// with smooth unit normals; the mesh, displaced as the vertex shader displaces it, meets the CPU
// ground within a metre round the camera; the patch's vertex budget; and shader hygiene.
// Run from the repo root: node tools/verify-moon-terrain.mjs
import * as THREE from 'three';
import { SpaceSim, R_MOON } from '../src/space/sim.js';
import { MoonSurface, patchRings, PATCH_NA, PATCH_R } from '../src/space/moonSurface.js';
import { RELIEF, RELIEF_GLSL, GMASK_BAKE_FRAG, reliefH, setGroundMask, tNoise, faceUV, gmask } from '../src/space/moonTerrain.js';
import { moonGround } from '../src/space/moonHeight.js';
import { ALL_TOWNS, latLonDir } from '../src/space/lunarNetwork.js';
let WaterWaves = null, MoonForest = null;
try { ({ WaterWaves } = await import('../src/space/moonWater.js')); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
try { ({ MoonForest } = await import('../src/space/moonForest.js')); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };
const report = {};
const R = R_MOON;

const instOk = (m) => {
  ok(m.count <= m.instanceMatrix.count, `${m.name}: count ${m.count} > capacity`);
  const a = m.instanceMatrix.array;
  for (let i = 0; i < m.count * 16; i++) if (!Number.isFinite(a[i])) { ok(false, `${m.name}: non-finite matrix`); break; }
  // offsets from the anchor stay small (float32-safe): a few kilometres at most (the relief's height)
  for (let i = 0; i < m.count; i++) ok(Math.hypot(a[i * 16 + 12], a[i * 16 + 13], a[i * 16 + 14]) < 3.0, `${m.name}: instance offset small`);
};
// ------------------------------------------------------------ shader hygiene --
const body = (src, sig) => { const a = src.indexOf(sig); return a < 0 ? '' : src.slice(a, src.indexOf('\n}\n', a) + 2); };
const RESERVED = ['cast', 'input', 'output', 'filter', 'sample', 'active', 'common', 'partition', 'packed', 'union', 'template', 'external', 'interface', 'long', 'short', 'half', 'fixed', 'unsigned', 'superp', 'namespace', 'using', 'goto', 'inline', 'noinline', 'volatile', 'public', 'static', 'extern', 'row_major', 'resource'];
function hygiene(name, src, fns) {
  for (const w of RESERVED) ok(!new RegExp(`\\b(float|int|uint|vec[234]|ivec[234]|uvec[234]|mat[34]|bool)\\s+${w}\\b`).test(src), `${name}: reserved word ${w} used as an identifier`);
  for (const sig of fns) {
    const b = body(src, sig);
    ok(b.length > 0, `${name}: ${sig} present`);
    ok(!/fwidth|dFdx|dFdy|\btexture\(/.test(b), `${name}: ${sig} has a derivative or implicit-LOD read`);
    for (const m of b.matchAll(/for \(int \w+ = [-\d]+; \w+ < ?=? ?([^;]+);/g)) ok(/^-?\d+$/.test(m[1].trim()), `${name}: ${sig} loop bound ${m[1]}`);
    // float contexts with integer literals (ivec/uint/int lines and array sizes excepted)
    const lines = b.split('\n').map((l) => l.replace(/\/\/.*$/, '')).filter((l) => !/\bint\b|ivec|uint|uvec|u\b|\[|gmTexel\(/.test(l));
    const code = lines.join('\n').replace(/for \(int [^)]*\)/g, '');
    const bad = code.match(/(?<![eE\w.])[-+*\/,(]\s*\d+\s*[-+*\/,);](?![^\n]*\bint\b)/g) || [];
    if (bad.length) console.log(code.split('\n').filter((l) => bad.some((b) => l.includes(b.trim()))).slice(0, 3).join('\n'));
    ok(!bad.length, `${name}: ${sig} integer literal in a float expression: ${bad.slice(0, 3).join(' | ')}`);
    for (const m of b.matchAll(/pow\(([^,]+),/g)) ok(/^(max|clamp|abs)/.test(m[1].trim()), `${name}: ${sig} pow() of ${m[1]}`);
    // every identifier used before it is declared? (the functions called must be defined earlier)
    for (const m of b.matchAll(/\b(tNoise|gmask|reliefMask|reliefHG|tGrad|tHash|gmTexel)\(/g)) {
      const def = src.indexOf(new RegExp(`\\b(vec4|vec3|float|uint)\\s+${m[1]}\\(`).exec(src)?.[0] ?? '@@');
      ok(def >= 0 && def <= src.indexOf(sig), `${name}: ${m[1]} defined before ${sig}`);
    }
  }
  // balanced braces and parentheses
  const cnt = (c) => src.split(c).length - 1;
  ok(cnt('{') === cnt('}'), `${name}: braces balanced`);
  ok(cnt('(') === cnt(')'), `${name}: parentheses balanced`);
}
hygiene('relief', RELIEF_GLSL, ['uint tHash(ivec3 c)', 'vec3 tGrad(ivec3 c)', 'vec4 tNoise(vec3 x)', 'vec4 gmask(vec3 d)', 'float reliefMask(vec3 up', 'float craterRelief(vec3 P', 'float reliefHG(vec3 up']);
for (const [cell, seed, dens, ho] of RELIEF.craters) ok(RELIEF_GLSL.includes(`craterRelief(P, ${cell.toFixed(1)}, ${Number.isInteger(seed) ? seed.toFixed(1) : seed}, ${dens}, ${ho}, fade, grad)`), `crater octave ${cell} km in the GLSL`);
ok(RELIEF_GLSL.includes(`${RELIEF.crDepth} * rk`) && RELIEF_GLSL.includes(`${RELIEF.crRim} * rk`) && RELIEF_GLSL.includes(`/ ${RELIEF.crRimW}`), 'crater profile constants in the GLSL');
hygiene('mask bake', GMASK_BAKE_FRAG, ['vec3 faceDirG(int f', 'void main() {']);
// uint literals: every hash constant carries its u suffix and fits 32 bits
for (const m of RELIEF_GLSL.matchAll(/(?<![.\d])(\d{6,})(u?)/g)) { ok(m[2] === 'u', `relief: literal ${m[1]} lacks its u suffix`); ok(+m[1] < 2 ** 32, `relief: literal ${m[1]} exceeds 32 bits`); }

// ------------------------------------------------ GLSL and JS: same constants --
{
  const blocks = RELIEF_GLSL.match(/vec4 n = tNoise\(mat3\(([^)]*)\) \* \(Pw \/ ([\d.]+)\) \+ vec3\(([^)]*)\)\);/g) || [];
  ok(blocks.length === RELIEF.oct.length, `relief: ${blocks.length} octave blocks for ${RELIEF.oct.length} octaves`);
  blocks.forEach((b, i) => {
    const m = /mat3\(([^)]*)\) \* \(Pw \/ ([\d.]+)\) \+ vec3\(([^)]*)\)/.exec(b);
    const mat = m[1].split(',').map(Number), lam = +m[2], off = m[3].split(',').map(Number);
    const o = RELIEF.oct[i];
    ok(Math.abs(lam - o.lam) < 1e-9, `octave ${i}: wavelength ${lam} vs ${o.lam}`);
    const colMajor = [o.rot[0], o.rot[3], o.rot[6], o.rot[1], o.rot[4], o.rot[7], o.rot[2], o.rot[5], o.rot[8]];
    ok(mat.every((v, k) => Math.abs(v - colMajor[k]) < 1e-12), `octave ${i}: rotation matches`);
    ok(off.every((v, k) => Math.abs(v - o.off[k]) < 1e-12), `octave ${i}: offset matches`);
    ok(new RegExp(`float a = ${String(o.amp).replace('.', '\\.')}\\b`).test(RELIEF_GLSL), `octave ${i}: amplitude ${o.amp} in the GLSL`);
    // rotations are orthonormal (the gradient maps back through the transpose)
    const Rm = new THREE.Matrix3().set(...o.rot);
    ok(Math.abs(Rm.determinant() - 1) < 1e-5, `octave ${i}: rotation determinant ${Rm.determinant()}`);
  });
  for (const k of ['warp', 'region', 'valley', 'mesa']) ok(RELIEF_GLSL.includes(`/ ${Number.isInteger(RELIEF[k].lam) ? RELIEF[k].lam.toFixed(1) : RELIEF[k].lam})`), `${k}: wavelength in the GLSL`);
  ok(RELIEF_GLSL.includes(`${RELIEF.valley.depth} * S`) && RELIEF_GLSL.includes(`${RELIEF.lift} * S`), 'valley depth and lift in the GLSL');
  ok(RELIEF_GLSL.includes(`mix(${RELIEF.ampLow}, 1.0, hi)`), 'plains scale in the GLSL');
  ok(RELIEF_GLSL.includes(`1.0 + ${RELIEF.erosion.toFixed(1)} * dot(grad, grad)`), 'erosion in the GLSL');
  const towns = /TOWN_D\[(\d+)\]/.exec(RELIEF_GLSL);
  ok(towns && +towns[1] === ALL_TOWNS.length, 'every town flattened on both sides');
}

// ------------------------------------------------------- the noise itself --
{
  const o = new Float64Array(4), a = new Float64Array(4), b = new Float64Array(4);
  let mx = 0, gErr = 0, cont = 0;
  for (let i = 0; i < 4000; i++) {
    const x = (Math.random() - 0.5) * 2e4, y = (Math.random() - 0.5) * 2e4, z = (Math.random() - 0.5) * 2e4;
    tNoise(x, y, z, o);
    mx = Math.max(mx, Math.abs(o[0]));
    const e = 1e-5;
    tNoise(x + e, y, z, a); tNoise(x - e, y, z, b);
    gErr = Math.max(gErr, Math.abs((a[0] - b[0]) / (2 * e) - o[1]));
    // across a lattice plane: continuous
    const X = Math.floor(x) + 1;
    tNoise(X - 1e-9, y, z, a); tNoise(X + 1e-9, y, z, b);
    cont = Math.max(cont, Math.abs(a[0] - b[0]));
  }
  ok(mx < 1.6, `noise range ${mx}`);
  ok(gErr < 1e-4, `noise analytic gradient error ${gErr}`);
  ok(cont < 1e-6, `noise continuous across cells (${cont})`);
  report.noiseMax = +mx.toFixed(3);
}

// ------------------------------------------------------------ the ground --
// a synthetic mask: land everywhere with a highland band, one ocean face (-Z), woods in patches
const N = 96;
const mask = new Uint8Array(N * N * 6 * 4);
const faceDir = (f, u, v) => [[1, v, u], [-1, v, u], [u, 1, v], [u, -1, v], [u, v, 1], [u, v, -1]][f];
for (let f = 0; f < 6; f++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const o = ((f * N + j) * N + i) * 4;
  const d = new THREE.Vector3(...faceDir(f, -1 + 2 * i / (N - 1), -1 + 2 * j / (N - 1))).normalize();
  const sea = d.z < -0.75;
  const coast = Math.min(Math.max((-0.6 - d.z) / 0.15, 0), 1);
  mask[o] = Math.round(255 * (1 - coast));
  mask[o + 1] = Math.round(255 * (0.5 + 0.5 * Math.sin(d.x * 9 + d.y * 5)) * 0.8);
  mask[o + 2] = sea ? 255 : 0;
  mask[o + 3] = sea ? 0 : (Math.sin(d.x * 40) * Math.sin(d.y * 40) > 0 ? 200 : 0);
}
setGroundMask(mask, N);
const rnd = () => { const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); return v.lengthSq() > 1e-4 ? v.normalize() : rnd(); };
{
  const g = {};
  let hMax = 0, hMin = 1e9, nonFinite = 0, waterBad = 0, n = 0, t0 = performance.now();
  for (let i = 0; i < 6000; i++) {
    const d = rnd();
    moonGround(d, g);
    n++;
    if (![g.h, g.normal.x, g.normal.y, g.normal.z].every(Number.isFinite)) nonFinite++;
    hMax = Math.max(hMax, g.h); hMin = Math.min(hMin, g.h);
    ok(Math.abs(g.normal.length() - 1) < 1e-9, 'normal is unit');
    if (g.water && g.h !== 0) waterBad++;
    ok(g.normal.dot(d) > 0.2, `normal within 78 degrees of the vertical (${g.normal.dot(d).toFixed(3)})`);
  }
  const us = (performance.now() - t0) * 1000 / n;
  ok(nonFinite === 0, `non-finite ground ${nonFinite}`);
  ok(hMin >= 0 && hMax < 2.2, `ground range ${hMin}..${hMax} km`);
  ok(hMax > 0.25, `the highlands stand up (max ${hMax.toFixed(3)} km)`);
  ok(waterBad === 0, 'water is at sea level');
  report.groundKm = [+hMin.toFixed(4), +hMax.toFixed(3)];
  report.moonGroundUs = +us.toFixed(1);
  // the ocean face
  const s = moonGround(new THREE.Vector3(0.1, -0.05, -1).normalize(), {});
  ok(!moonGround(new THREE.Vector3(0.3, 0.2, 0.9).normalize(), {}).water, 'land is not water');
  ok(s.water && s.h === 0, 'the ocean is water at sea level');
  // the Landing's town site, its farm plain and the mass driver: flat
  const site = new THREE.Vector3(1, 0, 0);
  let flatMax = 0;
  for (let i = 0; i < 400; i++) {
    const r = Math.random() * 9.5, a = Math.random() * Math.PI * 2;
    const d = new THREE.Vector3(R, Math.sin(a) * r, Math.cos(a) * r).normalize();
    flatMax = Math.max(flatMax, moonGround(d, g).h);
  }
  ok(flatMax * 1000 < 0.5, `the Landing flat (${(flatMax * 1000).toFixed(3)} m)`);
  let drv = 0;
  for (let t = 0; t <= 36; t += 0.5) {
    const x = 2.192 + 0.9701 * t, z = 1.061 + 0.2425 * t;       // site km (west, north)
    const d = new THREE.Vector3(R, z, x).normalize();
    drv = Math.max(drv, moonGround(d, g).h);
  }
  ok(drv * 1000 < 0.5, `the mass driver's line flat (${(drv * 1000).toFixed(3)} m)`);
  let townMax = 0;
  for (const [la, lo] of ALL_TOWNS) {
    const c = latLonDir(la, lo);
    for (let i = 0; i < 20; i++) {
      const a = i * 0.314, r = 1.4 * Math.sqrt(Math.random());
      const e1 = new THREE.Vector3(0, 1, 0).cross(c).normalize(), e2 = c.clone().cross(e1);
      const d = c.clone().multiplyScalar(R).addScaledVector(e1, Math.cos(a) * r).addScaledVector(e2, Math.sin(a) * r).normalize();
      townMax = Math.max(townMax, moonGround(d, g).h);
    }
  }
  ok(townMax * 1000 < 0.5, `the towns flat (${(townMax * 1000).toFixed(3)} m)`);
  // smooth normals: neighbours 5 m apart turn little almost everywhere (the mesas' scarps and the
  // ridged crests are real creases, so the check is on the distribution, not the extreme)
  const turns = [];
  let steep = 0, landN = 0;
  const a = {}, b = {};
  for (let i = 0; i < 3000; i++) {
    const d = rnd();
    if (d.z < -0.5) continue;
    const e = new THREE.Vector3(0, 1, 0).cross(d).normalize();
    moonGround(d, a);
    moonGround(d.clone().addScaledVector(e, 0.005 / R).normalize(), b);
    turns.push(a.normal.angleTo(b.normal));
    if (a.h > 0) { landN++; if (a.normal.dot(d) < Math.cos(35 / 57.3)) steep++; }
  }
  turns.sort((x, y) => x - y);
  const p99 = turns[Math.floor(turns.length * 0.99)] * 57.3, p50 = turns[Math.floor(turns.length * 0.5)] * 57.3;
  ok(p99 < 25, `normal turn over 5 m, 99th percentile ${p99.toFixed(1)} deg`);
  ok(turns[turns.length - 1] * 57.3 < 85, `normal turn over 5 m, worst ${(turns[turns.length - 1] * 57.3).toFixed(1)} deg`);
  ok(steep / Math.max(landN, 1) < 0.08, `land steeper than 35 degrees: ${(100 * steep / landN).toFixed(1)}%`);
  report.normalTurn5mDeg = { p50: +p50.toFixed(2), p99: +p99.toFixed(1), max: +(turns[turns.length - 1] * 57.3).toFixed(1) };
  report.steepLandPct = +(100 * steep / Math.max(landN, 1)).toFixed(2);
  // seams of the mask's cube faces: the ground continuous across them
  let seam = 0;
  const fuv = [0, 0, 0];
  for (let i = 0; i < 400; i++) {
    const u = Math.random() * 1.6 - 0.8;
    const d0 = new THREE.Vector3(1, u, 1 + 2e-7).normalize(), d1 = new THREE.Vector3(1 + 2e-7, u, 1).normalize();
    ok(faceUV(d0.x, d0.y, d0.z, fuv)[0] !== faceUV(d1.x, d1.y, d1.z, [0, 0, 0])[0], 'seam probes on two faces');
    seam = Math.max(seam, Math.abs(reliefH(d0.x, d0.y, d0.z) - reliefH(d1.x, d1.y, d1.z)));
  }
  ok(seam * 1000 < 1, `ground continuous across the mask's seams (${(seam * 1000).toFixed(3)} m)`);
  // float32 inputs (the GPU's precision): the ground moves by well under a metre
  let f32 = 0;
  for (let i = 0; i < 1500; i++) {
    const d = rnd();
    const df = [Math.fround(d.x), Math.fround(d.y), Math.fround(d.z)];
    f32 = Math.max(f32, Math.abs(reliefH(d.x, d.y, d.z) - reliefH(df[0], df[1], df[2])));
  }
  ok(f32 * 1000 < 0.5, `float32 directions shift the ground ${(f32 * 1000).toFixed(3)} m`);
  report.float32ShiftM = +(f32 * 1000).toFixed(3);
}

// ---------------------------------- the mesh as the vertex shader displaces it --
{
  const rings = patchRings();
  const NA = PATCH_NA;
  const verts = (rings.length) * (NA + 1);
  ok(verts <= 2.0e6, `patch vertices ${verts}`);
  ok(rings.every((r, i) => i === 0 || r > rings[i - 1]), 'rings increase');
  ok(Math.abs(rings[rings.length - 1] - PATCH_R) < 1e-9, 'the last ring is the rim');
  report.patchVertices = verts;
  report.patchTriangles = (rings.length - 1) * NA * 2;
  // spacing under 1 km out: a few metres
  const sp = (r) => r * 2 * Math.PI / NA;
  ok(sp(1) < 0.015, `ring spacing at 1 km: ${(sp(1) * 1000).toFixed(1)} m`);
  report.spacingAt1kmM = +(sp(1) * 1000).toFixed(1);
  // a patch centred somewhere hilly: the triangles vs the CPU ground, within 1 km of the centre
  let worst = 0, tested = 0;
  const errs = [];
  for (let trial = 0; trial < 6 && tested < 1500; trial++) {
    const C = rnd();
    if (C.z < -0.5) continue;
    if (reliefH(C.x, C.y, C.z) < 0.05) continue;
    const E1 = new THREE.Vector3(0, 1, 0).cross(C).normalize(), E2 = C.clone().cross(E1);
    const vtx = (ia, jr) => {
      const a = (ia / NA) * Math.PI * 2, r = rings[jr];
      const up = C.clone().multiplyScalar(R).addScaledVector(E1, Math.cos(a) * r).addScaledVector(E2, Math.sin(a) * r).normalize();
      const fade = Math.max(Math.max(r, 0.004) * (2 * Math.PI / NA) * 1.3, 0);   // camera above the centre: the spacing rules
      const h = reliefH(up.x, up.y, up.z, fade);
      return up.multiplyScalar(R + h);
    };
    for (let k = 0; k < 300; k++) {
      const r = 1.0 * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
      // the ring pair and angle pair holding this point
      let j = 0; while (rings[j + 1] < r) j++;
      const ai = Math.floor((a / (Math.PI * 2)) * NA);
      const tA = (a / (Math.PI * 2)) * NA - ai, tR = (r - rings[j]) / (rings[j + 1] - rings[j]);
      // bilinear over the quad (the two triangles differ from it by far less than the tolerance)
      const p00 = vtx(ai, j), p10 = vtx(ai + 1, j), p01 = vtx(ai, j + 1), p11 = vtx(ai + 1, j + 1);
      const p = p00.multiplyScalar((1 - tA) * (1 - tR)).addScaledVector(p10, tA * (1 - tR)).addScaledVector(p01, (1 - tA) * tR).addScaledVector(p11, tA * tR);
      const d = p.clone().normalize();
      const gd = moonGround(d, {});
      const hMesh = p.length() - R, hCpu = gd.h;
      // the gap measured across the surface (on a scarp a height error is a sideways sliver)
      const e = Math.abs(hMesh - hCpu) * Math.max(gd.normal.dot(d), 0);
      worst = Math.max(worst, e);
      errs.push(e);
      tested++;
    }
  }
  ok(tested > 300, `mesh probes ${tested}`);
  errs.sort((x, y) => x - y);
  const p99 = errs[Math.floor(errs.length * 0.99)] * 1000;
  ok(p99 < 0.5, `mesh vs moonGround (across the surface) within 1 km of the centre, 99th percentile: ${p99.toFixed(3)} m`);
  ok(worst * 1000 < 1.5, `mesh vs moonGround within 1 km of the centre, worst: ${(worst * 1000).toFixed(3)} m`);
  report.meshVsGroundM = { p50: +(errs[errs.length >> 1] * 1000).toFixed(3), p99: +p99.toFixed(3), max: +(worst * 1000).toFixed(3) };
}

// ------------------------------------------------------ the surface itself --
{
  const sim = new SpaceSim();
  sim.syncFromHours(12);
  const stub = { renderer: { getRenderTarget: () => null, setRenderTarget() {}, render() {}, readRenderTargetPixels() {}, autoClear: true }, q: { cube: 512 }, sim, size: new THREE.Vector2(1280, 720), camera: null };
  const S = new MoonSurface(stub);
  for (const [nm, mat] of [['sphere', S.material], ['patch', S.patchMaterial]]) {
    for (const src of [mat.vertexShader, mat.fragmentShader]) {
      for (const m of src.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)) if (!['projectionMatrix', 'modelViewMatrix'].includes(m[1])) ok(m[1] in S.uniforms, `${nm}: uniform ${m[1]} supplied`);
    }
  }
  const vs = S.patchMaterial.vertexShader;
  hygiene('patch vertex', vs, ['void main() {']);
  hygiene('surface', S.material.fragmentShader, ['float reliefHG(vec3 up', 'vec2 faceQ(vec3 d)', 'vec4 seaWaves(vec3 rel', 'float reliefShadow(vec3 up']);
  ok(S.material.fragmentShader.indexOf('vec2 faceQ(') < S.material.fragmentShader.indexOf('faceQ(up)'), 'faceQ defined before use');
  ok(S.material.fragmentShader.indexOf('float riverF') < S.material.fragmentShader.indexOf('(1.0 - riverF)'), 'riverF declared before use');
  ok(!/hillHeight|geoMask|vPosM/.test(S.material.fragmentShader + vs), 'the old Landing-only patch is gone');
  ok(/if \(uPatchOn > 0\.5 && dot\(up, uPC\) > uPCos\) discard;/.test(S.material.fragmentShader), 'the sphere steps aside inside the patch');
  const idx = S.patch.geometry.index.array;
  let mx = 0; for (const i of idx) if (i > mx) mx = i;
  ok(mx < S.patch.geometry.getAttribute('position').count, 'patch indices in range');
  // water and trees
  if (S.water) ok(S.water.mesh || S.water.group, 'water present');
  report.surfaceFragKB = +(S.material.fragmentShader.length / 1024).toFixed(1);
  report.patchVertKB = +(vs.length / 1024).toFixed(1);
}
if (WaterWaves) {
  const W = new WaterWaves();
  const src = W.glsl;
  hygiene('waves', src, ['vec4 seaWaves(vec3 rel, vec3 up, float fade)']);
  // the CPU waves and the table agree; displacement small enough for the ground contract
  let amp = 0;
  for (let i = 0; i < 500; i++) amp = Math.max(amp, Math.abs(W.height(Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100)));
  ok(amp < 0.0012, `wave height ${(amp * 1000).toFixed(2)} m under the contract's metre`);
  report.waveMaxM = +(amp * 1000).toFixed(2);
}
if (MoonForest) {
  const F = new MoonForest();
  let c = rnd();
  const gmc = [0, 0, 0, 0];
  for (let k = 0; k < 500 && (gmask(c.x, c.y, c.z, gmc)[3] < 0.7 || gmc[0] < 0.98); k++) c = rnd();
  const t0 = performance.now();
  const n = F.scatter(c, 0.45);
  report.forestScatterMs = +(performance.now() - t0).toFixed(1);
  const ids = new Set(F.positions.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`));
  ok(ids.size === F.positions.length, 'no two trees on one site');
  for (const m of F.meshes) instOk(m);
  ok(n <= F.capacity, `forest ${n} trees within capacity ${F.capacity}`);
  ok(n > 0, 'trees stand in the woods');
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const p = F.positions[i];
    const d = p.clone().normalize();
    worst = Math.max(worst, Math.abs(p.length() - R - moonGround(d, {}).h));
  }
  ok(worst * 1000 < 0.05, `trees seated on the ground (${(worst * 1000).toFixed(3)} m)`);
  report.trees = n;
  report.treeCounts = F.counts;
  report.treeTris = F.meshes.reduce((t, m) => t + m.count * m.geometry.getAttribute('position').count / 3, 0);
  for (const [nm, src] of [['tree vertex', F.material.vertexShader], ['tree fragment', F.material.fragmentShader]]) {
    hygiene(nm, src, ['void main() {']);
    for (const m of src.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)) ok(m[1] in F.uniforms, `${nm}: uniform ${m[1]} supplied`);
  }
}

console.log(JSON.stringify(report));
console.log(fails ? `${fails} FAIL` : 'ALL OK');
process.exit(fails ? 1 : 0);
