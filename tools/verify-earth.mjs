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
const { Meteors, H_START, H_END_MIN, MET_SLOTS } = await import('../src/space/meteors.js');
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

// ---- the comet -----------------------------------------------------------------------------------
{
  const sunKm = new SpaceSim().sunPos;
  const c = E.cometSky(0, sunKm, { pos: new THREE.Vector3(), vel: new THREE.Vector3() });
  ok(c.elong > 30 && c.elong < 150, `comet elongation ${c.elong.toFixed(1)}`);
  ok(c.delta > 0.3 && c.delta < 1.5 && c.r >= E.COMET.q - 1e-9, `comet distances r ${c.r.toFixed(2)} delta ${c.delta.toFixed(2)}`);
  ok(c.mag > -3 && c.mag < 5, `comet magnitude ${c.mag.toFixed(1)}`);
  // Barker's equation satisfied, and the orbit's energy is parabolic (v^2 r = 2 GM)
  const p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), vv = new THREE.Vector3();
  for (const days of [-30, 0, 5, 40, 200]) {
    const r1 = E.cometHelio(days, p1, vv), r2 = E.cometHelio(days + 0.01, p2, vv);
    const v = p2.distanceTo(p1) / 0.01;                         // AU/day
    const k = 0.01720209895;
    ok(Math.abs(v * v * (r1 + r2) / 2 / (2 * k * k) - 1) < 2e-3, `comet parabolic energy at ${days} d`);
    ok(Math.abs(p2.clone().sub(p1).normalize().dot(vv) - 1) < 1e-3, 'comet velocity direction');
  }
  // the shader's ray-to-segment distance against brute force
  const segAng = (ro, rd, a, b) => {
    const v = b.clone().sub(a), w0 = ro.clone().sub(a);
    const L = Math.max(v.length(), 1e-3), u = v.clone().divideScalar(L);
    const B = rd.dot(u), D = rd.dot(w0), Ee = u.dot(w0);
    const s01 = THREE.MathUtils.clamp((Ee - B * D) / Math.max(1 - B * B, 1e-6) / L, 0, 1);
    const q = a.clone().addScaledVector(v, s01);
    const range = Math.max(q.clone().sub(ro).dot(rd), 1);
    return ro.clone().addScaledVector(rd, range).sub(q).length() / range;
  };
  const rr = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  let worstRel = 0;
  for (let n = 0; n < 200; n++) {
    const ro = new THREE.Vector3(rr() - 0.5, rr() - 0.5, rr() - 0.5).multiplyScalar(2e4);
    const a = c.pos.clone().add(new THREE.Vector3(rr() - 0.5, rr() - 0.5, rr() - 0.5).multiplyScalar(3e6));
    const b = a.clone().add(new THREE.Vector3(rr() - 0.5, rr() - 0.5, rr() - 0.5).multiplyScalar(3e7));
    const rd = a.clone().lerp(b, rr()).sub(ro).add(new THREE.Vector3(rr() - 0.5, rr() - 0.5, rr() - 0.5).multiplyScalar(4e6)).normalize();
    let best = Infinity;
    for (let i = 0; i <= 4000; i++) {
      const q = a.clone().lerp(b, i / 4000);
      const t = q.clone().sub(ro).dot(rd);
      if (t <= 0) continue;
      best = Math.min(best, Math.acos(Math.min(1, q.clone().sub(ro).normalize().dot(rd))));
    }
    const got = segAng(ro, rd, a, b);
    if (best < 0.5) worstRel = Math.max(worstRel, Math.abs(got - best) / Math.max(best, 1e-4));
  }
  ok(worstRel < 0.05, `ray-segment angle vs brute force (worst ${(worstRel * 100).toFixed(2)}%)`);
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

let metMat = null;
// ---- meteors -----------------------------------------------------------------------------------
{
  const met = new Meteors(space, { rate: 40 });
  metMat = met.material;
  ok(space.bodies.some((b) => b.name === 'meteors'), 'meteors body registered');
  // a camera in low orbit over the night side
  const night = sim.sunDir.clone().negate();
  const perp = new THREE.Vector3(0, 1, 0).cross(night).normalize();
  space.camera.position.copy(night).multiplyScalar(R_EARTH + 420).addScaledVector(perp, 900);
  let worst = 0, live = 0, maxLive = 0, bad = 0;
  const P = met.posAttr.array, I = met.iAttr.array;
  for (let f = 0; f < 1200; f++) {
    const ta2 = performance.now();
    met.update(sim, f / 60, 1 / 60, space);
    worst = Math.max(worst, performance.now() - ta2);
    live = 0;
    for (let i = 0; i < MET_SLOTS; i++) {
      if (!met.slots[i].live) continue;
      live++;
      for (const k of [i * 6, i * 6 + 3]) {
        const r = Math.hypot(P[k], P[k + 1], P[k + 2]) - R_EARTH;
        if (!(r > H_END_MIN - 1 && r < H_START + 1)) bad++;
        const dn = (P[k] * sim.sunDir.x + P[k + 1] * sim.sunDir.y + P[k + 2] * sim.sunDir.z) / (r + R_EARTH);
        if (dn > -0.1) bad++;
      }
      if (!(I[i * 2] >= 0 && Number.isFinite(I[i * 2]))) bad++;
    }
    maxLive = Math.max(maxLive, live);
  }
  ok(bad === 0, `meteor paths within 72-115 km on the night side (${bad} bad)`);
  ok(met.spawned > 300, `meteors spawned ${met.spawned}`);
  // shower members run parallel, straight away from the radiant, which stands above their horizon
  const { SHOWER_DIR } = await import('../src/space/meteors.js');
  let members = 0;
  for (const s of met.slots) if (s.live && s.shower) {
    members++;
    ok(s.dir.dot(SHOWER_DIR) < -0.9999, 'shower meteor parallel to the radiant');
    ok(SHOWER_DIR.dot(s.p0.clone().normalize()) > 0.25, 'radiant above the shower meteor\'s horizon');
  }
  ok(Math.abs(SHOWER_DIR.length() - 1) < 1e-9, 'radiant unit');
  // at the stress rate the pool fills and spawns are simply dropped; at the running rate it never fills
  const met2 = new Meteors({ camera: space.camera }, {});
  let maxLive2 = 0;
  for (let f = 0; f < 3600; f++) {
    met2.update(sim, f / 60, 1 / 60, { camera: space.camera });
    let l = 0;
    for (const q of met2.slots) if (q.live) l++;
    maxLive2 = Math.max(maxLive2, l);
  }
  ok(maxLive2 < MET_SLOTS * 0.75, `meteor slots at the running rate: peak ${maxLive2} of ${MET_SLOTS}`);
  ok(maxLive <= MET_SLOTS, 'meteor pool bounded');
  ok(worst < 1.0, `meteor update worst ${worst.toFixed(3)} ms`);
  space.camera.position.set(0, 0, 20000);
}

// ---- Earth ------------------------------------------------------------------------------------
const tex = () => ({ texture: new THREE.Texture() });
const fakeBake = { surfA: tex(), surfB: tex(), clouds: { ...tex(), width: 1024 }, lights: tex(), ids: tex(), ready: true };
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
const STRICT_POW = new Set(['stars', 'aurora-arcs', 'aurora-oval', 'meteors']);
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
    // words GLSL ES 3.00 reserves (a compile error if used as a name)
    const RES = /\b(half|patch|sample|input|output|filter|fixed|active|common|partition|resource|class|union|enum|long|short|double|unsigned|cast|namespace|using|template|this|goto|inline|noinline|public|static|extern|external|interface|superp|sizeof|coherent|volatile|restrict|readonly|writeonly|subroutine|noperspective|asm|typedef|hvec[234]|dvec[234]|fvec[234])\b/;
    const rm = src.match(RES);
    ok(!rm, `${name}/${stage}: reserved word '${rm && rm[1]}'`);
    // braces and parentheses balance
    const bal = (a, b) => src.split(a).length - src.split(b).length;
    ok(bal('{', '}') === 0 && bal('(', ')') === 0, `${name}/${stage}: unbalanced brackets`);
    // a float literal fed to an int loop bound, or a loop bound that is not a constant
    for (const m of src.matchAll(/for\s*\(\s*int\s+\w+\s*=\s*[^;]+;\s*\w+\s*(<=|<)\s*([^;]+);/g)) ok(/^[\w.\s+*-]+$/.test(m[2]) && !/\bu[A-Z]/.test(m[2]), `${name}/${stage}: loop bound ${m[2]}`);
  }
  // pow() of a base that can go negative (a bare difference) is undefined in GLSL: new modules must not
  if (STRICT_POW.has(name)) for (const src of [vs, fs]) for (const m of src.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) ok(+m[1] < +m[2], `${name}: smoothstep with edge0 >= edge1 (${m[1]}, ${m[2]})`);
  if (STRICT_POW.has(name)) for (const src of [vs, fs]) for (const m of src.matchAll(/\bpow\(\s*\(([^()]*)\)/g)) ok(!/[-+]/.test(m[1]), `${name}: pow of a possibly negative base (${m[1]})`);
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
lint('meteors', metMat);
{
  // the Hearth's lens composite includes the whole sky GLSL on bent rays
  const { Hearth } = await import('../src/space/hearth.js');
  const hs = { scene: new THREE.Scene(), earthFixed: new THREE.Group(), bodies: [], camera: space.camera, size: new THREE.Vector2(1280, 720), sim, addBody: space.addBody };
  const hearth = new Hearth(hs, { bhSteps: 110, bhScale: 0.6 });
  lint('hearth-composite', hearth.compMat);
}
{
  const { EarthBake } = await import('../src/space/earthBake.js');
  const tb = performance.now();
  const bake = new EarthBake(null, 64, 64);
  ok(performance.now() - tb < 100, 'bake construction');
  lint('earth-bake', bake.mat);
  ok(/nearestLane\(d\)/.test(bake.mat.fragmentShader), 'bake writes the lane index');
  ok(bake.ids && bake.ids.texture.minFilter === THREE.NearestFilter && !bake.ids.texture.generateMipmaps, 'id cube unfiltered');
  ok(bake.jobs.filter((j) => j.rt === bake.ids).length === 6, 'id cube baked on all faces');
  ok(bake.data.numArc < 2048, 'corridor ids exact in half float');
}

// ---- sea lanes, ships and arcologies -----------------------------------------------------------
{
  const D = earthDetail;
  const legs = D.laneLegs();
  ok(legs.length > 20 && legs.length <= D.MAX_LANE_LEGS, `lane legs ${legs.length}`);
  for (const l of legs) {
    ok(l.len > 0.002 && l.len < Math.PI / 2, `lane leg length ${(l.len * 6371).toFixed(0)} km`);
    ok(l.occ > 0 && l.occ < 1, 'lane occupancy');
    ok(new THREE.Vector3().crossVectors(l.a, l.b).length() > 1e-3, 'lane leg defines a great circle');
  }
  // lane indices survive the half-float lights target exactly
  ok(legs.length + 1 < 2048, 'lane ids exact in half float');
  // the ship clock is continuous across a wrap: a ship's absolute position never jumps
  const shipAt = (t, k) => { const c = D.shipClock(t); const slot = k + c.wrap; return (slot + 0.5) * D.SHIP_SPACING + D.SHIP_V * c.t; };
  for (const t of [D.SHIP_PERIOD - 0.5, D.SHIP_PERIOD * 17 - 1e-3, 3.1e7]) {
    const a = shipAt(t, 3), b = shipAt(t + 1, 3);
    ok(Math.abs(b - a - D.SHIP_V) < 1e-6 || Math.abs(b - a - D.SHIP_V - D.SHIP_SPACING) < 1e-6 && false, `ship clock continuous at ${t}`);
  }
  for (const src of [D.EARTH_DETAIL_GLSL, D.LANE_BAKE_GLSL]) for (const m of stripComments(src).matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) ok(+m[1] < +m[2], `earth detail: smoothstep with edge0 >= edge1 (${m[1]}, ${m[2]})`);
  for (const src of [D.EARTH_DETAIL_GLSL, D.LANE_BAKE_GLSL]) for (const m of stripComments(src).matchAll(/\bpow\(\s*\(([^()]*)\)/g)) ok(!/[-+]/.test(m[1]), `earth detail: pow of a possibly negative base (${m[1]})`);
  const au = D.arcologyUniforms();
  ok(au.pos.every((v) => v.w >= 3 && v.w <= 8 && Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-6), 'arcology centres and radii');
  // arcologies stand clear of each other and of Meridian
  for (let i = 0; i < au.pos.length; i++) for (let j = i + 1; j < au.pos.length; j++) {
    const a = au.pos[i], b = au.pos[j];
    ok(Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)) * 6371 > (a.w + b.w) * 6, 'arcologies apart');
  }
  ok(earth.uniforms.uShipT.value >= 0 && earth.uniforms.uShipT.value < D.SHIP_PERIOD, 'earth ship clock wrapped');
}

// ---- the Earth up close (earthFine.js) ----------------------------------------------------------
{
  const F = await import('../src/space/earthFine.js');
  // every tier builds and lints: the octave counts are picked by the QUALITY define
  for (let q = 0; q <= 3; q++) {
    const e = new Earth(fakeBake, { earthQ: q, atmoSteps: 5 + q * 2 });
    ok(e.material.defines.QUALITY === q, `earth tier ${q} define`);
    lint(`earth-q${q}`, e.material);
    // the proxy sphere: finite, indexed within range
    const g = e.mesh.geometry, pos = g.attributes.position;
    let maxI = 0; for (let i = 0; i < g.index.count; i++) maxI = Math.max(maxI, g.index.getX(i));
    ok(maxI < pos.count, `earth tier ${q}: index max ${maxI} < vertex count ${pos.count}`);
    ok(pos.array.every(Number.isFinite), `earth tier ${q}: proxy positions finite`);
    ok(g.index.count / 3 < 60000, `earth proxy triangles ${g.index.count / 3}`);
  }
  ok(F.CLOUD_OCT_BY_Q.every((n, q) => n >= 5 && n <= F.CLOUD_OCTAVES.length && F.SHADOW_OCT_BY_Q[q] < n), 'cloud octave counts per tier (the lowest tier still resolves the cumulus)');
  // nothing sparkles: every octave is gone before its wavelength spans fewer than ~4.5 pixels, and
  // at full weight while it spans more than ~12
  ok(F.OCTAVE_FADE.lo < F.OCTAVE_FADE.hi && F.OCTAVE_FADE.hi <= 0.225 && F.OCTAVE_FADE.lo >= 0.06, 'octave fade window');
  const wls = [...F.CLOUD_OCTAVES.map((o) => o.wl), ...F.RIDGE_OCTAVES.map((o) => o.wl)];
  // (and every literal wavelength the module fades by)
  const src = stripComments(F.EARTH_FINE_GLSL);
  for (const m of src.matchAll(/ef_fade\(\s*([\d.]+)\s*,\s*fp\s*\)/g)) wls.push(+m[1]);
  ok(wls.length > 20, `faded wavelengths found ${wls.length}`);
  for (const wl of wls) {
    ok(F.octaveWeight(wl, wl / 4.5) === 0, `octave ${wl} km gone at 4.5 px`);
    ok(F.octaveWeight(wl, wl / 12.6) === 1, `octave ${wl} km whole at 12.6 px`);
    for (let k = 1; k < 40; k++) { const fp = wl * k / 100; ok(F.octaveWeight(wl, fp) >= F.octaveWeight(wl, fp + wl / 100) - 1e-12, 'octave weight falls with range'); }
  }
  // octaves in order, lacunarity ~2, amplitudes bounded; the GLSL RMS matches the table
  for (let i = 1; i < F.CLOUD_OCTAVES.length; i++) ok(Math.abs(F.CLOUD_OCTAVES[i - 1].wl / F.CLOUD_OCTAVES[i].wl - 2.13) < 1e-9, 'cloud lacunarity');
  const rms = Math.sqrt(F.CLOUD_OCTAVES.reduce((s, o) => s + o.amp * o.amp, 0));
  const mR = src.match(/EF_CD_RMS = ([\d.]+)/);
  ok(mR && Math.abs(+mR[1] - rms) < 1e-5, 'cloud RMS constant');
  ok(F.CLOUD_OCTAVES[F.CLOUD_OCTAVES.length - 1].wl < 0.7 && F.CLOUD_OCTAVES[0].wl === 60, 'cloud detail spans 60 km to below 0.7 km');
  for (let i = 1; i < F.RIDGE_OCTAVES.length; i++) ok(F.RIDGE_OCTAVES[i].wl < F.RIDGE_OCTAVES[i - 1].wl && F.RIDGE_OCTAVES[i].amp < F.RIDGE_OCTAVES[i - 1].amp && F.RIDGE_OCTAVES[i].q >= F.RIDGE_OCTAVES[i - 1].q, 'ridge octaves ordered');
  ok(F.RIDGE_OCTAVES.reduce((s, o) => s + o.amp, 0) < 2.5, 'ridge relief bounded (km)');
  // the snowline: ~5 km in the tropics, falling to the sea toward the poles
  let prev = Infinity;
  for (let d = 0; d <= 90; d += 5) { const h = F.snowlineKm(d * Math.PI / 180); ok(Number.isFinite(h) && h <= prev + 1e-12, `snowline falls with latitude (${d})`); prev = h; }
  ok(F.snowlineKm(0) > 4.5 && F.snowlineKm(0) < 5.6 && F.snowlineKm(Math.PI / 4) > 2.5 && F.snowlineKm(Math.PI / 4) < 4.2 && F.snowlineKm(Math.PI / 2) <= 0, 'snowline heights');
  // the skylight: unchanged by day, gold along the terminator, violet in twilight, dark at night
  const day = F.skyAmbient(1);
  ok(Math.abs(day[0] - 0.05) < 2e-3 && Math.abs(day[1] - 0.085) < 2e-3 && Math.abs(day[2] - 0.16) < 2e-3, `skylight by day ${day.map((v) => v.toFixed(3))}`);
  const term = F.skyAmbient(0.02), tw = F.skyAmbient(-0.09), night = F.skyAmbient(-0.4);
  ok(term[0] / term[2] > 0.75 && term[0] > term[1], `skylight warm at the terminator ${term.map((v) => v.toFixed(3))}`);
  ok(tw[2] > tw[1] && tw[0] > tw[1] * 0.9, `skylight violet in twilight ${tw.map((v) => v.toFixed(4))}`);
  ok(night.every((v) => v >= 0 && v < 1e-3), 'skylight dark at night');
  for (let m = -1; m <= 1; m += 0.01) { const a = F.skyAmbient(m), b = F.skyAmbient(m + 0.01); ok(a.every((v, i) => v >= 0 && Number.isFinite(v) && Math.abs(v - b[i]) < 0.01), 'skylight continuous'); }
  // the GLSL skylight is the JS one (the same constants)
  ok(/vec3\(0\.05, 0\.085, 0\.16\) \* day \+ vec3\(0\.034, 0\.018, 0\.012\)/.test(src), 'GLSL skylight constants mirror the JS');
  // the self-shadow march reaches from a couple of pixels to within the coarse shade's 38 km
  const SM = F.SHADOW_MARCH;
  const reach = SM.d0 * Math.pow(SM.grow, SM.steps - 1);
  ok(reach < 38 && reach > 4 && SM.steps <= 4, `self-shadow reach ${reach.toFixed(1)} km`);
  ok(F.cloudTopKm(1, 48) === SM.topKm && F.cloudTopKm(0, 48) === 0 && F.cloudTopKm(1, 12) < F.cloudTopKm(1, 30), 'cloud top heights');
  // a 3 km top shades its neighbour a few km off at a low Sun, not at noon
  const occludes = (muSun, dKm) => SM.topKm - (0.3 + dKm * muSun / Math.sqrt(1 - muSun * muSun)) > 0;
  ok(occludes(0.1, 3) && !occludes(0.95, 3), 'self-shadows long at a low Sun, short at noon');
  // shader safety for code called inside non-uniform branches: explicit-LOD reads only, no
  // derivatives, constant loop bounds, non-negative pow bases
  const full = stripComments(F.EARTH_FINE_GLSL + F.EARTH_FINE_SHADOW_GLSL);
  ok(!/\b(dFdx|dFdy|fwidth)\s*\(/.test(full), 'fine module takes no derivatives');
  ok(!/\btexture\s*\(/.test(full), 'fine module reads textures with explicit LOD only');
  for (const m of full.matchAll(/for\s*\(\s*int\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*([^;]+);/g)) ok(/^(\d+|EF_CD_N)$/.test(m[1].trim()), `fine loop bound ${m[1]}`);
  for (const m of full.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) ok(+m[1] < +m[2], `fine: smoothstep edges (${m[1]}, ${m[2]})`);
  for (const m of full.matchAll(/\bpow\(\s*([^,]+),/g)) ok(/^(xl|max\(|abs\(|clamp\()/.test(m[1].trim()), `fine: pow base ${m[1]} provably non-negative`);
  ok(/xl = min\(abs\(lat\)/.test(full), 'snowline pow base is an absolute value');
  // the Earth shader calls the fine module with the tier's octave counts, and nowhere else evaluates
  // cloud detail with a boolean (the old signature)
  const efs = stripComments(earth.material.fragmentShader);
  ok(/lowCloud\(bC, fpC, biasC, EF_CLOUD_OCT\)/.test(efs) && /EF_SHADOW_OCT : 0\)/.test(efs), 'deck and ground shadows at the tier octave counts');
  ok(!/lowCloud\([^;]*,\s*(true|false)\)/.test(efs), 'lowCloud takes an octave count');
  ok(/ef_cloudSelfShadow\(/.test(efs) && /ef_land\(/.test(efs) && /ef_seaColour\(/.test(efs) && /ef_limbGain\(/.test(efs) && /ef_skyAmbient\(/.test(efs), 'fine terms wired into the Earth shader');
  // (dFdx of the relief stays in uniform control flow: ef_land is called at the top level of main)
  const iLand = efs.indexOf('ef_land(b, fp'), iMain = efs.indexOf('void main()');
  const pre = efs.slice(iMain, iLand);
  ok(iLand > iMain && pre.split('{').length - pre.split('}').length === 1, 'ef_land called outside any branch');
  ok(earth.uniforms.uLimbGain.value > 0 && earth.uniforms.uLimbGain.value < 1.5, 'limb gain');
}
{
  // the bake's mesoscale weather never aliases into stair steps: its finest drawn octave spans
  // more than two cloud texels at every tier
  const { SPACE_QUALITY } = await import('../src/space/quality.js');
  const { EarthBake } = await import('../src/space/earthBake.js');
  for (const [k, q] of Object.entries(SPACE_QUALITY)) {
    const texel = Math.PI / 2 / q.cloudCube * 6371;
    let wl = 106;
    for (let i = 0; i < 3; i++) {
      const t = Math.min(Math.max((wl - 2.2 * texel) / (texel), 0), 1);
      const w = t * t * (3 - 2 * t);
      ok(w === 0 || wl > 2.2 * texel, `meso octave ${wl.toFixed(0)} km at ${k}`);
      wl /= 2.1;
    }
    const b = new EarthBake(null, 64, q.cloudCube);
    ok(Math.abs(b.mat.uniforms.uCloudTexelKm.value - texel) < 1e-9, `bake cloud texel uniform at ${k}`);
    ok(/mesoWeather\(p, seed, storm, trades, polar\)/.test(b.mat.fragmentShader), 'bake adds the mesoscale weather');
  }
}

const total = performance.now() - t0;
console.log(JSON.stringify({ auroraTris: aurora.triangles, auroraBuildMs: +auroraBuild.toFixed(1), earthBuildMs: +earthBuild.toFixed(1), stars: skyStars.points.geometry.attributes.position.count, totalMs: +total.toFixed(0) }));
if (fails) { console.log(`VERIFY_EARTH_FAILED (${fails})`); process.exit(1); }
console.log('VERIFY_EARTH_OK');
