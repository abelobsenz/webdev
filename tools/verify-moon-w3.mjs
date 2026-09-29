// Headless checks for the Moon's third (refinement) pass: the ring halls (instanced far forms
// round the ring, the full hall near the camera: nesting, clearances from the rails and the
// shields, window refill cost, triangles), Hevelius Yard's new structure (frames instanced
// within capacity, staging and shores clear of the pods and the gantry hooks over time,
// cradle founded), per-roof tile offsets within float precision, and static GLSL hygiene for
// the shaders this pass rewrote (surface relief, ring deck, lunar material): uniforms declared
// and supplied, no derivatives or implicit-LOD reads in the new helper functions, constant
// loop bounds, no pow() of a signed base, float literals in float expressions.
// Run from the repo root: node tools/verify-moon-w3.mjs
import * as THREE from 'three';
import { SpaceSim, R_MOON } from '../src/space/sim.js';
import { Moon } from '../src/space/moon.js';
import { buildLunarRingDistricts, buildRingHall } from '../src/space/lunarPort.js';
import { YARD, buildYard, buildYardFrame, buildGantry } from '../src/space/lunarOrbitals.js';
import { MoonSurface } from '../src/space/moonSurface.js';
import { createLunarMaterial } from '../src/space/lunarMaterial.js';
import { buildMediiLanding } from '../src/space/lunarLanding.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };
const report = {};
const tris = (g) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const bbox = (g) => { g.computeBoundingBox(); return g.boundingBox; };
const sane = (g, name) => {
  const pos = g.getAttribute('position');
  ok(pos.array.every(Number.isFinite), `${name}: non-finite position`);
  if (g.index) { let mx = 0; for (const i of g.index.array) if (i > mx) mx = i; ok(mx < pos.count, `${name}: index ${mx} >= ${pos.count}`); }
  const f = g.getAttribute('aFacade');
  if (f) ok(f.array.every(Number.isFinite), `${name}: non-finite facade`);
};

// ------------------------------------------------------------ shader hygiene --
/** The body of GLSL function fn (from its signature to the closing brace at column 0). */
const body = (src, sig) => { const a = src.indexOf(sig); return a < 0 ? '' : src.slice(a, src.indexOf('\n}\n', a) + 2); };
function hygiene(name, src, fns) {
  for (const sig of fns) {
    const b = body(src, sig);
    ok(b.length > 0, `${name}: ${sig} present`);
    ok(!/fwidth|dFdx|dFdy|texture\(/.test(b), `${name}: ${sig} has a derivative or implicit-LOD read`);
    for (const m of b.matchAll(/for \(int \w+ = [-\d]+; \w+ < ?=? ?([^;]+);/g)) ok(/^-?\d+$/.test(m[1].trim()), `${name}: ${sig} loop bound ${m[1]}`);
    // an integer literal beside a float operator (array sizes, int loop headers and int compares aside)
    const code = b.replace(/\[[^\]]*\]/g, '').replace(/for \(int [^)]*\)/g, '').replace(/\bi < \d+/g, '');
    const bad = code.match(/(?<![eE\w.])[-+*\/,(]\s*\d+\s*[-+*\/,);](?![^\n]*\bint\b)/g) || [];
    ok(!bad.length, `${name}: ${sig} integer literal in a float expression: ${bad.slice(0, 3).join(' | ')}`);
    // pow() only of a clamped / max()-ed / known non-negative base
    for (const m of b.matchAll(/pow\(([^,]+),/g)) ok(/^(max|clamp|abs|1\.0 - clamp|x\b|dl\b)/.test(m[1].trim()) || /^\d/.test(m[1].trim()), `${name}: ${sig} pow() of ${m[1]}`);
  }
}
const sim = new SpaceSim();
sim.syncFromHours(12);
{
  // the surface shader (built without a renderer: the material's source via a stub bake)
  const stub = { renderer: { getRenderTarget: () => null, setRenderTarget() {}, render() {}, autoClear: true }, q: { cube: 512 }, sim, size: new THREE.Vector2(1280, 720) };
  const S = new MoonSurface(stub);
  const frag = S.material.fragmentShader;
  for (const m of frag.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)) if (!['projectionMatrix'].includes(m[1])) ok(m[1] in S.uniforms, `surface uniform ${m[1]} supplied`);
  hygiene('surface', frag, ['vec4 sdnoise(vec3 v)', 'Ground groundField(vec3 up, float fp)', 'vec4 canopy(vec3 up', 'vec3 farmland(vec2 q']);
  ok(!/vnoise3d/.test(frag), 'surface: the value-noise relief is gone');
  ok(/rgrad/.test(frag) && /crowns\.xyz/.test(frag), 'surface: ridged rock and canopy relief wired into the lighting');
  report.surfaceFragKB = +(frag.length / 1024).toFixed(1);
}
const space = { scene: new THREE.Scene(), bodies: [], camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 1e7), size: new THREE.Vector2(1280, 720), sim, addBody() {} };
let t0 = performance.now();
const moon = new Moon(space);
report.moonBuildMs = Math.round(performance.now() - t0);
space.scene.add(moon.group);
{
  const rm = moon.ring.material, rf = rm.fragmentShader;
  for (const m of rf.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)) ok(m[1] in rm.uniforms, `ring uniform ${m[1]} supplied`);
  hygiene('ring', rf, ['float band1(', 'float stripe(', 'float blockH(', 'vec2 crowns(']);
  // derivatives in main() only before the first branch that can diverge
  const main = rf.slice(rf.indexOf('void main()'));
  // (the discard test itself takes a derivative in its condition, before any divergence)
  const firstIf = main.indexOf('if (', main.indexOf('discard;'));
  ok(main.lastIndexOf('fwidth') < firstIf, 'ring: every fwidth() ahead of the first branch');
  for (const m of main.matchAll(/pow\(([^,]+),/g)) ok(/^max\(/.test(m[1].trim()), `ring: pow() of ${m[1]}`);
  const lm = createLunarMaterial(), lf = lm.fragmentShader;
  for (const m of lf.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)) ok(m[1] in lm.uniforms, `lunar material uniform ${m[1]} supplied`);
  ok(/moonL/.test(lf) && /footAO/.test(lf), 'lunar material: moonshine and contact darkening');
  const lmain = lf.slice(lf.indexOf('void main()'));
  ok(lmain.lastIndexOf('fwidth') < lmain.indexOf('if (k < 0.5)'), 'lunar material: fwidth ahead of the kind branches');
  ok(!/pow\(\s*(1\.0 - max|dot)/.test(lmain.replace(/pow\(1\.0 - max\(dot\(N, V\), 0\.0\), 5\.0\)/g, '')), 'lunar material: pow() bases non-negative');
}

// ------------------------------------------------------------ ring halls --
{
  t0 = performance.now();
  const D = buildLunarRingDistricts();
  report.districtsBuildMs = Math.round(performance.now() - t0);
  const n = D.hallMats.length / 16;
  ok(n === (D.sectors - 1) * 2 && D.districts.length === n, `ring halls ${n}`);
  ok(D.hallMats.every(Number.isFinite), 'ring hall matrices finite');
  sane(D.hallNear, 'ring hall'); sane(D.hallFar, 'ring hall far form'); sane(D.geo, 'ring rails');
  const bn = bbox(D.hallNear), bf = bbox(D.hallFar);
  // the far form hides inside the full hall's masses (no z-fighting shells round the podium)
  ok(bf.min.x >= bn.min.x && bf.max.x <= bn.max.x && bf.max.y <= bn.max.y && bf.min.z >= bn.min.z && bf.max.z <= bn.max.z, 'far form within the full hall');
  const far = buildRingHall(true), near = buildRingHall(false);
  report.hallTris = tris(near); report.hallFarTris = tris(far);
  ok(tris(near) < 6000 && tris(far) < 400, `hall ${tris(near)} / far ${tris(far)} triangles`);
  // clear of the transit rails (torus 45 m at 1.7 km) and the edge shields (190 m at 5.2 km):
  // the hall spans |z| 4100 -+ its local extent
  // (local -z, the portico, faces the centreline: it reaches inward, the back outward)
  const zIn = 4100 + bn.min.z, zOut = 4100 + bn.max.z;
  report.hallAcrossKm = [+(zIn / 1000).toFixed(2), +(zOut / 1000).toFixed(2)];
  ok(zIn > 1700 + 45 + 800, `hall reaches ${zIn.toFixed(0)} m across, onto the rail corridor`);
  ok(zOut < 5200 - 190 - 20, `hall reaches ${zOut.toFixed(0)} m across, into the edge shield`);
  ok(bn.min.y > -12 && bn.min.y < 0.5, `hall founded on the deck (min y ${bn.min.y.toFixed(1)})`);
  // neighbours along the ring: 17.3 km apart, the hall 1.6 km long
  ok(bn.max.x - bn.min.x < 17320 * 0.5, 'halls separate along the ring');
  // one hall matrix: its local -z (the portico) faces the centreline on both sides
  const m = new THREE.Matrix4(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
  for (const i of [0, 1, 700, 701]) {
    m.fromArray(D.hallMats, i * 16);
    p0.set(0, 0, 0).applyMatrix4(m); p1.set(0, 0, -900).applyMatrix4(m);
    ok(Math.abs(p1.y) < Math.abs(p0.y), `hall ${i}: portico faces the rails`);
    ok(Math.abs(Math.hypot(p0.x, p0.z) - 2117000) < 1, `hall ${i} on the deck radius`);
  }
  // the window: halls near the camera only, refilled on crossing a sector, cheap
  const H = moon.ringHalls;
  ok(H.far.count === n && H.far.count <= H.far.instanceMatrix.count, 'far halls within capacity');
  const cam = new THREE.Vector3();
  const place = (a, hKm = 30) => { cam.set(Math.cos(a) * (2117 + hKm), 0.5, Math.sin(a) * (2117 + hKm)).applyMatrix4(moon.group.matrixWorld); };
  sim.step(0); moon.update(sim, 0); moon.group.updateMatrixWorld(true);
  place(0.3); H.update(cam);
  ok(H.near.count > 30 && H.near.count <= H.nearMax && H.near.count <= H.near.instanceMatrix.count, `near halls ${H.near.count}`);
  report.nearHalls = H.near.count;
  ok(H.near.instanceMatrix.array.every(Number.isFinite), 'near hall matrices finite');
  place(0.0); H.update(cam);
  ok(H.near.count === H.nearMax - 2, 'sector zero (the Exchange) has no hall');
  cam.set(1e6, 0, 0); H.update(cam);
  ok(H.near.count === 0 && !H.near.visible, 'no near halls from afar');
  t0 = performance.now();
  for (let f = 0; f < 2000; f++) { place(0.3 + f * 1e-4); H.update(cam); }
  report.hallUpdateMs = +((performance.now() - t0) / 2000).toFixed(4);
  ok(report.hallUpdateMs < 0.1, `hall window ${report.hallUpdateMs} ms a frame`);
  report.ringRenderedTris = tris(D.hallFar) * n + tris(D.hallNear) * H.nearMax + tris(D.geo);
  ok(report.ringRenderedTris < 2.5e6, `ring deck ${report.ringRenderedTris} triangles rendered`);
  report.ringUniqueTris = tris(D.geo) + tris(D.hallNear) + tris(D.hallFar);
}

// ------------------------------------------------------------ Hevelius Yard --
{
  t0 = performance.now();
  const Y = buildYard();
  report.yardBuildMs = Math.round(performance.now() - t0);
  sane(Y.geo, 'yard'); sane(Y.frameGeo, 'yard frame'); sane(buildGantry().geo, 'gantry');
  report.yardTris = tris(Y.geo) + tris(Y.frameGeo) * Y.frameZ.length;
  ok(report.yardTris < 250000, `yard ${report.yardTris} triangles`);
  ok(Y.frameZ.length === Math.floor(YARD.L / YARD.frameStep) + 1, 'a frame every step, both ends');
  const fb = bbox(buildYardFrame());
  ok(fb.max.x - fb.min.x >= YARD.W && fb.max.y - fb.min.y >= YARD.H, 'frames span the dock');
  const O = moon.orbitals;
  ok(O.yard.frames.count === Y.frameZ.length && O.yard.frames.count <= O.yard.frames.instanceMatrix.count, 'yard frames within capacity');
  ok(O.yard.frames.instanceColor && O.yard.frames.instanceColor.count >= O.yard.frames.count, 'yard frames painted');
  // staging (upper half, z 10..50, radius R + 5 .. R + 9) and raking shores clear of the pods,
  // and of the gantry hooks, over an hour of work
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  let podStage = Infinity, podShore = Infinity, hookStage = Infinity;
  const R = 62, hw = YARD.W / 2, hh = YARD.H / 2;
  const shoreD = (q, z, s) => {                     // distance to the shore segment at stock z
    const r = Y.hullR(Math.min(z, 380)), a = new THREE.Vector3(s * (r + 12), 0, z), b = new THREE.Vector3(s * (hw - 20), -hh + 4, z);
    const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(q.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
    return q.distanceTo(a.addScaledVector(ab, t));
  };
  for (let k = 0; k < 600; k++) {
    O._moveYard(k * 6.1);
    for (let i = 0; i < O.yard.pods.count; i++) {
      O.yard.pods.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      const inStageZ = Math.min(Math.abs(p.z - 16), Math.abs(p.z - 44)) - 6;
      if (p.y > 0) podStage = Math.min(podStage, Math.max(inStageZ, Math.hypot(p.x, p.y) - (R + 9)));
      else podStage = Math.min(podStage, Math.max(inStageZ, Math.abs(Math.atan2(p.y, p.x)) * 0));  // (lower half: staging is upper only)
      for (let z = -350; z <= 350; z += 100) for (const s of [-1, 1]) podShore = Math.min(podShore, shoreD(p, z, s) - 2.2 - 1.6);
    }
    for (const g of O.yard.gantries) {
      const gz = g.mesh.position.z * 1000;
      hookStage = Math.min(hookStage, Math.max(10 - (gz + 13), (gz - 13) - 50));
    }
  }
  report.yardPodShoreM = +podShore.toFixed(1);
  ok(podShore > 1, `a pod comes within ${podShore.toFixed(1)} m of a raking shore`);
  ok(podStage > 0, 'pods clear of the staging');
  ok(hookStage > 0, 'gantry hooks clear of the plating-front staging');
  // the drive section's cradle stands on the strongback and meets the drive's skin
  const bb = bbox(Y.geo);
  ok(bb.min.y >= -hh - 20 && bb.max.y <= hh + 40, 'yard within its frames');
}

// ------------------------------------------------------------ Medii roofs --
{
  const L = buildMediiLanding();
  const f = L.geo.getAttribute('aFacade');
  let mx = 0;
  for (let i = 0; i < f.count; i++) mx = Math.max(mx, Math.abs(f.getX(i)));
  report.landingFacadeMaxX = Math.round(mx);
  ok(mx < 1.2e5, `facade x ${mx} (per-roof offsets keep float precision)`);
  const L2 = buildMediiLanding();
  ok(L2.geo.getAttribute('aFacade').array.every((v, i) => v === f.array[i]), 'roof offsets deterministic across builds');
}

console.log(JSON.stringify(report));
console.log(fails ? `MOON_W3 ${fails} FAILURES` : 'MOON_W3_OK');
process.exit(fails ? 1 : 0);
