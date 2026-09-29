// Invariants of the Earth-from-orbit and sky domain, checked headless (no renderer, no browser):
//   ephemeris (Kepler solver, elongation limits, magnitudes), the star catalogue (precession,
//   colours, energies), the aurora (geometry within its shell, frames, timings), and a GLSL lint
//   of every material in the domain (uniforms declared vs supplied, varyings matched, functions
//   called vs defined, unsafe constructs). Run from the repo root: node tools/verify-earth.mjs
import * as THREE from 'three';

globalThis.Image = globalThis.Image || class { set src(v) { this._src = v; } };
const { SpaceSim, R_EARTH } = await import('../src/space/sim.js');
const E = await import('../src/space/ephemeris.js');
const C = await import('../src/space/skyCatalog.js');
const { createSpaceSky, SKY_UNIFORMS } = await import('../src/space/sky.js');
const { SkyLife, starEnergy } = await import('../src/space/skyStars.js');
const { Aurora, H_TOP_MAX, H_BOTTOM } = await import('../src/space/aurora.js');
const { Earth } = await import('../src/space/earth.js');
const earthDetail = await import('../src/space/earthDetail.js').catch(() => null);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };
const t0 = performance.now();

// ---- ephemeris ---------------------------------------------------------------------------------
for (const e of [0, 0.05, 0.2]) for (let M = -3; M <= 3; M += 0.37) {
  const Ea = E.solveKepler(M, e);
  ok(Math.abs(Ea - e * Math.sin(Ea) - M) < 1e-10, `kepler residual e=${e} M=${M}`);
}
let maxMerc = 0, maxVen = 0;
const rows = [];
for (let k = 0; k < 400; k++) {
  const sec = (k / 400) * 30 * 365.25 * 86400;
  E.planetSky(sec, rows);
  maxMerc = Math.max(maxMerc, rows[0].elong); maxVen = Math.max(maxVen, rows[1].elong);
  for (const r of rows) ok(Number.isFinite(r.mag) && Math.abs(r.dir.length() - 1) < 1e-6, 'planet row finite');
  ok(rows[1].mag < -3.5 && rows[1].mag > -5.0, `Venus magnitude ${rows[1].mag.toFixed(2)}`);
  ok(rows[3].mag < -1.5 && rows[3].mag > -3.0, `Jupiter magnitude ${rows[3].mag.toFixed(2)}`);
  ok(rows[2].mag < 2.0 && rows[2].mag > -3.0, `Mars magnitude ${rows[2].mag.toFixed(2)}`);
}
ok(maxMerc < 28.5 && maxMerc > 17, `Mercury max elongation ${maxMerc.toFixed(1)}`);
ok(maxVen < 48 && maxVen > 44, `Venus max elongation ${maxVen.toFixed(1)}`);
// the planets lie near the ecliptic (the sim's Sun is at ecliptic longitude 90 in the XY plane)
{
  const eps = 23.4 * Math.PI / 180;
  const eclN = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(eps), Math.sin(eps), 0)).normalize();
  E.planetSky(0, rows);
  for (let i = 0; i < rows.length; i++) ok(Math.abs(Math.asin(rows[i].dir.dot(eclN))) < 8.5 * Math.PI / 180, `${E.SKY_PLANETS[i].name} near the ecliptic`);
  // elongation reproduced by the inertial directions against the Sun's
  const sim = new SpaceSim();
  for (let i = 0; i < rows.length; i++) {
    const el = Math.acos(THREE.MathUtils.clamp(rows[i].dir.dot(sim.sunDir), -1, 1)) * 180 / Math.PI;
    ok(Math.abs(el - rows[i].elong) < 1.0, `${E.SKY_PLANETS[i].name} elongation frame ${el.toFixed(2)} vs ${rows[i].elong.toFixed(2)}`);
  }
  ok(rows[1].elong > 30, 'Venus stands clear of the Sun at the epoch');
}

// ---- star catalogue and precession ------------------------------------------------------------
{
  const P = C.precessionMatrix();
  const I = P.clone().multiply(P.clone().transpose()).elements;
  ok(I.every((v, i) => Math.abs(v - ([0, 4, 8].includes(i) ? 1 : 0)) < 1e-9), 'precession matrix orthonormal');
  ok(Math.abs(P.determinant() - 1) < 1e-9, 'precession matrix proper');
  const deg = C.precessionAngle(C.PRECESSION_EPOCH) * 180 / Math.PI;
  ok(deg > 41 && deg < 43, `general precession ${deg.toFixed(2)} deg`);
  const stars = C.catalogStars();
  ok(stars.length >= 140, `catalogue size ${stars.length}`);
  for (const s of stars) {
    ok(Math.abs(s.dir.length() - 1) < 1e-6, 'star unit direction');
    ok([s.color.r, s.color.g, s.color.b].every((v) => v >= 0 && v <= 1.0001) && Math.max(s.color.r, s.color.g, s.color.b) > 0.999, 'star colour normalised');
  }
  // the pole of the epoch lies in Cepheus: the nearest catalogue star is Errai, Alfirk or Iota Cep
  const byPole = stars.map((s, i) => [i, s.dir.y]).sort((a, b) => b[1] - a[1]);
  const top = C.BRIGHT_STARS[byPole[0][0]];
  ok(top[0] > 21 && top[1] > 60, `pole star of the epoch in Cepheus (RA ${top[0]}h)`);
  ok(Math.asin(byPole[0][1]) * 180 / Math.PI > 80, 'a bright star within 10 deg of the pole');
  const polaris = stars[C.BRIGHT_STARS.findIndex((r) => r[1] > 89)];
  ok(Math.asin(polaris.dir.y) * 180 / Math.PI < 78, 'Polaris no longer the pole star');
  // Sirius the brightest, blue-white; Antares and Betelgeuse red
  const sirius = stars[0], betel = stars[9];
  ok(sirius.color.b >= sirius.color.r, 'Sirius blue-white');
  ok(betel.color.r > betel.color.b * 1.5, 'Betelgeuse red');
  ok(starEnergy(-1.46) > starEnergy(0) && starEnergy(0) / starEnergy(2.5) > 9.9 && starEnergy(0) / starEnergy(2.5) < 10.1, 'Pogson energies');
  // angular separations survive precession (rigid rotation): Betelgeuse - Rigel ~18.6 deg
  const sep = Math.acos(stars[9].dir.dot(stars[6].dir)) * 180 / Math.PI;
  ok(Math.abs(sep - 18.6) < 0.4, `Betelgeuse-Rigel separation ${sep.toFixed(2)}`);
  const pal = C.starPalette();
  ok(pal.length === 8 && pal[0].x > pal[0].z && pal[7].z > pal[7].x, 'star palette runs red to blue');
}

// ---- sky materials and life -------------------------------------------------------------------
const sky = createSpaceSky();
const skyStars = sky.userData.stars;
ok(skyStars && skyStars.points.geometry.attributes.position.count >= 140, 'star points built');
const life = new SkyLife({ sim: new SpaceSim() }, SKY_UNIFORMS);
ok(SKY_UNIFORMS.uPlanets.value.length === 7 && SKY_UNIFORMS.uPlanets.value.every((v) => [v.x, v.y, v.z, v.w].every(Number.isFinite)), 'planet uniforms');
{
  const sim = new SpaceSim();
  const n = 2000, ta = performance.now();
  for (let i = 0; i < n; i++) { sim.t = i * 700; life.update(sim); }
  const ms = (performance.now() - ta) / n;
  ok(ms < 0.05, `SkyLife update ${ms.toFixed(4)} ms`);
}

// ---- aurora -----------------------------------------------------------------------------------
const sim = new SpaceSim();
sim.syncFromHours(0);
sim.step?.(0);
const scene = new THREE.Scene();
const space = { scene, sim, camera: new THREE.PerspectiveCamera(50, 1.6, 1, 1e7), bodies: [], addBody(name, o, c, r, opts) { const b = { name, objects: o, center: c, radius: r, ...opts }; this.bodies.push(b); return b; } };
space.camera.position.set(0, 0, 20000);
let ta = performance.now();
const aurora = new Aurora(space, { earthQ: 3 });
const auroraBuild = performance.now() - ta;
ok(auroraBuild < 250, `aurora build ${auroraBuild.toFixed(1)} ms`);
ok(aurora.triangles > 100000 && aurora.triangles < 1500000, `aurora triangles ${aurora.triangles}`);
ok(space.bodies.some((b) => b.name === 'aurora'), 'aurora body registered');
{
  // replicate the curtain's vertex placement (worst-case folds and surge) and check the shell
  let hMin = Infinity, hMax = -Infinity, colMin = Infinity, colMax = -Infinity;
  for (const h of aurora.hemis) {
    const g = h.arcs.geometry, A = g.attributes.aArc, H = g.attributes.aH, SV = g.attributes.aSV;
    for (let i = 0; i < A.count; i += 7) {
      const phi = A.getX(i) + SV.getX(i) * A.getY(i);
      const fold = 0.012 + 0.0065 + 0.0028 + 0.0011;
      for (const sgn of [-1, 1]) {
        const th = 0.314 + 0.087 * Math.cos(phi) + A.getZ(i) + sgn * fold - (sgn < 0 ? 0.03 : 0) - 0.0035 * SV.getY(i);
        colMin = Math.min(colMin, th); colMax = Math.max(colMax, th);
      }
      const hh = H.getX(i) + (H.getY(i) - H.getX(i)) * SV.getY(i);
      hMin = Math.min(hMin, hh); hMax = Math.max(hMax, hh);
      ok(H.getY(i) > H.getX(i), 'curtain top above its border');
    }
  }
  ok(hMin >= H_BOTTOM - 1e-6 && hMax <= H_TOP_MAX + 1e-6, `aurora heights ${hMin.toFixed(0)}-${hMax.toFixed(0)} km`);
  // the ovals stay in the auroral zone (magnetic colatitude 8 - 32 deg) and clear of the
  // lowest orbital structures (620 km stations): the tallest ray tops out below them
  ok(colMin > 8 * Math.PI / 180 && colMax < 32 * Math.PI / 180, `oval colatitudes ${(colMin * 57.3).toFixed(1)}-${(colMax * 57.3).toFixed(1)}`);
  ok(H_TOP_MAX < 600, 'aurora clears the 620 km stations');
}
{
  const n = 600; let worst = 0;
  for (let i = 0; i < n; i++) {
    sim.t = i * 37;
    ta = performance.now();
    aurora.update(sim, i * 0.5, 0.016, space);
    worst += performance.now() - ta;
  }
  const ms = worst / n;
  ok(ms < 0.05, `aurora update ${ms.toFixed(4)} ms`);
  scene.updateMatrixWorld(true);
  for (const h of aurora.hemis) {
    const m = h.frame.matrix.elements;
    const x = new THREE.Vector3(m[0], m[1], m[2]), y = new THREE.Vector3(m[4], m[5], m[6]), z = new THREE.Vector3(m[8], m[9], m[10]);
    ok(Math.abs(x.length() - 1) < 1e-6 && Math.abs(y.length() - 1) < 1e-6 && Math.abs(x.dot(z)) < 1e-6 && Math.abs(y.dot(z)) < 1e-6, 'aurora frame orthonormal');
    ok(x.dot(sim.sunDir) <= 1e-6, 'aurora +x faces magnetic midnight');
    ok(m.every(Number.isFinite), 'aurora frame finite');
  }
  for (const t of [0, 100, 231, 240, 300, 419]) {
    const a = Aurora.activity(t);
    ok(a.act >= 0 && a.act <= 1.0001 && Number.isFinite(a.surge) && a.surge <= 0, `activity at ${t}`);
  }
}

// ---- Earth ------------------------------------------------------------------------------------
const tex = () => ({ texture: new THREE.Texture() });
const fakeBake = { surfA: tex(), surfB: tex(), clouds: { ...tex(), width: 1024 }, lights: tex(), ready: true };
ta = performance.now();
const earth = new Earth(fakeBake, { earthQ: 2, atmoSteps: 9 });
const earthBuild = performance.now() - ta;
ok(earthBuild < 150, `earth build ${earthBuild.toFixed(1)} ms`);
{
  ta = performance.now();
  for (let i = 0; i < 500; i++) { sim.t = i * 11; earth.update(sim, i * 0.1, space); }
  const ms = (performance.now() - ta) / 500;
  ok(ms < 0.05, `earth update ${ms.toFixed(4)} ms`);
}

// ---- GLSL lint ----------------------------------------------------------------------------------
const BUILTIN_UNIFORMS = new Set(['modelMatrix', 'viewMatrix', 'projectionMatrix', 'modelViewMatrix', 'normalMatrix', 'cameraPosition', 'isOrthographic']);
const GLSL_FUNCS = new Set(('radians degrees sin cos tan asin acos atan sinh cosh tanh pow exp log exp2 log2 sqrt inversesqrt abs sign floor trunc round roundEven ceil fract mod modf min max clamp mix step smoothstep isnan isinf length distance dot cross normalize faceforward reflect refract matrixCompMult outerProduct transpose determinant inverse lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not texture textureLod textureGrad texelFetch textureSize dFdx dFdy fwidth floatBitsToInt intBitsToFloat packHalf2x16 unpackHalf2x16 ' +
  'float int uint bool vec2 vec3 vec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 bvec2 bvec3 bvec4 mat2 mat3 mat4 if for while return switch texture2D textureCube').split(/\s+/));
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); }
function lint(name, mat) {
  const vs = stripComments(mat.vertexShader), fs = stripComments(mat.fragmentShader);
  for (const [stage, src] of [['vert', vs], ['frag', fs]]) {
    // uniforms declared must be supplied
    for (const m of src.matchAll(/\buniform\s+\w+\s+(\w+)\s*(\[[^\]]*\])?\s*;/g)) {
      if (BUILTIN_UNIFORMS.has(m[1])) continue;
      const u = mat.uniforms[m[1]];
      ok(u && 'value' in u, `${name}/${stage}: uniform ${m[1]} not supplied`);
      if (u && m[2]) {
        const n = parseInt(m[2].slice(1), 10);
        ok(Array.isArray(u.value) && (Number.isNaN(n) || u.value.length === n), `${name}/${stage}: uniform array ${m[1]} length`);
      }
    }
    // functions called must be defined or built in
    const defined = new Set([...src.matchAll(/\b(?:float|int|bool|void|vec[234]|ivec[234]|mat[234])\s+(\w+)\s*\(/g)].map((m) => m[1]));
    for (const m of src.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      const f = m[1];
      if (GLSL_FUNCS.has(f) || defined.has(f) || /^(gl_|precision)/.test(f)) continue;
      ok(false, `${name}/${stage}: call to undefined ${f}()`);
      break;
    }
    // braces and parentheses balance
    const bal = (a, b) => src.split(a).length - src.split(b).length;
    ok(bal('{', '}') === 0 && bal('(', ')') === 0, `${name}/${stage}: unbalanced brackets`);
    // a float literal fed to an int loop bound, or a loop bound that is not a constant
    for (const m of src.matchAll(/for\s*\(\s*int\s+\w+\s*=\s*[^;]+;\s*\w+\s*(<=|<)\s*([^;]+);/g)) ok(/^[\w.\s+*-]+$/.test(m[2]) && !/\bu[A-Z]/.test(m[2]), `${name}/${stage}: loop bound ${m[2]}`);
  }
  // varyings read by the fragment stage are written by the vertex stage
  const vv = new Set([...vs.matchAll(/\bvarying\s+\w+\s+(\w+)/g)].map((m) => m[1]));
  for (const m of fs.matchAll(/\bvarying\s+\w+\s+(\w+)/g)) ok(vv.has(m[1]), `${name}: varying ${m[1]} missing in vertex`);
  // additive materials write light, not coverage
  if (mat.blending === THREE.AdditiveBlending) ok(mat.premultipliedAlpha === true && /gl_FragColor\s*=\s*vec4\([^;]*,\s*0\.0\)\s*;/.test(fs), `${name}: additive with premultiplied alpha and alpha 0`);
}
lint('sky', sky.material);
lint('stars', skyStars.material);
lint('aurora-arcs', aurora.arcMat);
lint('aurora-oval', aurora.ovalMat);
lint('earth', earth.material);
if (earthDetail && earthDetail.lintTargets) for (const [n, m] of earthDetail.lintTargets()) lint(n, m);

const total = performance.now() - t0;
console.log(JSON.stringify({ auroraTris: aurora.triangles, auroraBuildMs: +auroraBuild.toFixed(1), earthBuildMs: +earthBuild.toFixed(1), stars: skyStars.points.geometry.attributes.position.count, totalMs: +total.toFixed(0) }));
if (fails) { console.log(`VERIFY_EARTH_FAILED (${fails})`); process.exit(1); }
console.log('VERIFY_EARTH_OK');
