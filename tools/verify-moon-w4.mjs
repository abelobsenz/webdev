// Headless checks for the Moon's fourth (refinement) pass: the surface's crater populations and
// wrinkle ridges (GLSL hygiene, the relief's sign convention), the lunar material's floodlights
// (uniforms declared and supplied, a constant loop, packing), Hevelius Yard's rebuilt dock
// (bounds, floods, the plate carriers clear of the frames, the crew block and the pods over an
// hour of work), and the ring deck stood up round the camera (lunarRingDeck.js: buffer sanity,
// instance capacity, clearances from the Exchange, the Service Court, the halls and the rails,
// the blocks on the shader's plots, refill and per-frame cost, triangle budget).
// Run from the repo root: node tools/verify-moon-w4.mjs
import * as THREE from 'three';
import { SpaceSim } from '../src/space/sim.js';
import { MoonSurface } from '../src/space/moonSurface.js';
import { createLunarMaterial, lunarMesh, setFloods, FLOODS } from '../src/space/lunarMaterial.js';
import { YARD, buildYard, buildYardFrame, buildGantry, buildCarrier, LunarOrbitals } from '../src/space/lunarOrbitals.js';
import { LunarRingDeck, DECK, plot, plotHash, deckClear, deckTop, hash12, buildTerraceBlock, buildTree, buildVaults, buildPortal, buildShieldGallery } from '../src/space/lunarRingDeck.js';
import { buildLunarRingDistricts } from '../src/space/lunarPort.js';

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
  if (f) { ok(f.array.every(Number.isFinite), `${name}: non-finite facade`); ok(f.count === pos.count, `${name}: facade count`); }
};
/** Instanced mesh sanity: count within capacity, colours large enough, matrices finite. */
const instSane = (m, name) => {
  ok(m.count <= m.instanceMatrix.count, `${name}: count ${m.count} > capacity ${m.instanceMatrix.count}`);
  if (m.instanceColor) ok(m.instanceColor.count >= m.instanceMatrix.count, `${name}: instance colours too few`);
  const a = m.instanceMatrix.array;
  for (let i = 0; i < m.count * 16; i++) if (!Number.isFinite(a[i])) { ok(false, `${name}: non-finite matrix`); break; }
  sane(m.geometry, name);
};

// ------------------------------------------------------------ shader hygiene --
const body = (src, sig) => { const a = src.indexOf(sig); return a < 0 ? '' : src.slice(a, src.indexOf('\n}\n', a) + 2); };
function hygiene(name, src, fns) {
  for (const sig of fns) {
    const b = body(src, sig);
    ok(b.length > 0, `${name}: ${sig} present`);
    ok(!/fwidth|dFdx|dFdy|texture\(/.test(b), `${name}: ${sig} has a derivative or implicit-LOD read`);
    for (const m of b.matchAll(/for \(int \w+ = [-\d]+; \w+ < ?=? ?([^;]+);/g)) ok(/^-?\d+$/.test(m[1].trim()), `${name}: ${sig} loop bound ${m[1]}`);
    const code = b.replace(/\[[^\]]*\]/g, '').replace(/for \(int [^)]*\)/g, '').replace(/\bi < \d+/g, '');
    const bad = code.match(/(?<![eE\w.])[-+*\/,(]\s*\d+\s*[-+*\/,);](?![^\n]*\bint\b)/g) || [];
    ok(!bad.length, `${name}: ${sig} integer literal in a float expression: ${bad.slice(0, 3).join(' | ')}`);
    for (const m of b.matchAll(/pow\(([^,]+),/g)) ok(/^(max|clamp|abs)/.test(m[1].trim()), `${name}: ${sig} pow() of ${m[1]}`);
  }
}
const sim = new SpaceSim();
sim.syncFromHours(12);
{
  const stub = { renderer: { getRenderTarget: () => null, setRenderTarget() {}, render() {}, autoClear: true }, q: { cube: 512 }, sim, size: new THREE.Vector2(1280, 720) };
  const S = new MoonSurface(stub);
  const frag = S.material.fragmentShader;
  for (const m of frag.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)) if (!['projectionMatrix'].includes(m[1])) ok(m[1] in S.uniforms, `surface uniform ${m[1]} supplied`);
  hygiene('surface', frag, ['void craterOctave(inout Craters C', 'vec3 ridgeField(vec3 up', 'Craters craterField(vec3 up']);
  ok(!/craterDetail/.test(frag), 'surface: the old crater lattice is gone');
  // the relief is +grad h throughout: the bake's normal enters negated, the craters added
  ok(/vec3 grad = -\(nB - up \* dot\(nB, up\)\) \/ nu;/.test(frag), 'surface: baked relief enters as +grad h');
  ok(/grad \+= cf\.grad/.test(frag) && !/\bgrad -= c/.test(frag), 'surface: every relief term added with one sign');
  ok(/normalize\(up - grad \* 1\.5\)/.test(frag), 'surface: normal leans away from the gradient');
  report.surfaceFragKB = +(frag.length / 1024).toFixed(1);
}
{
  const M = createLunarMaterial({ fill: 1 });
  const f = M.fragmentShader;
  for (const m of f.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)) ok(m[1] in M.uniforms, `lunar uniform ${m[1]} supplied`);
  ok(M.uniforms.uFloodP.value.length === FLOODS && M.uniforms.uFloodC.value.length === FLOODS, 'flood arrays sized');
  ok(new RegExp(`for \\(int i = 0; i < ${FLOODS}; i\\+\\+\\)`).test(f), 'flood loop has a constant bound');
  ok(/uniform int uFloodN;/.test(f) && /if \(i >= uFloodN\) break;/.test(f), 'flood count is an int compare');
  for (const m of f.matchAll(/pow\(([^,]+),/g)) ok(/^(max|clamp|abs|1\.0 - max)/.test(m[1].trim()), `lunar pow() of ${m[1]}`);
  // packing and the per-render upload: positions into view space, reach scaled into km
  const mesh = lunarMesh(new THREE.BoxGeometry(1, 1, 1), {}, M);
  setFloods(mesh, Array.from({ length: FLOODS + 3 }, (_, i) => ({ p: [i * 10, 0, 0], reach: 100, color: [1, 1, 1], i: 1 })));
  ok(mesh.userData.floods.n === FLOODS && mesh.userData.floods.data.length === FLOODS * 7, 'floods clamp to FLOODS');
  const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 0, 5); cam.updateMatrixWorld(); mesh.updateMatrixWorld();
  mesh.onBeforeRender(null, null, cam);
  ok(M.uniforms.uFloodN.value === FLOODS, 'flood count uploaded');
  const P = M.uniforms.uFloodP.value[3];
  ok(Math.abs(P.x - 0.03) < 1e-6 && Math.abs(P.z + 5) < 1e-6 && Math.abs(P.w - 0.1) < 1e-6, `flood 3 in view space km (${P.x}, ${P.z}, ${P.w})`);
  const bare = lunarMesh(new THREE.BoxGeometry(1, 1, 1), {}, M);
  bare.updateMatrixWorld(); bare.onBeforeRender(null, null, cam);
  ok(M.uniforms.uFloodN.value === 0, 'a mesh without floods clears the count');
}

// ------------------------------------------------------------ Hevelius Yard --
{
  const t0 = performance.now();
  const Y = buildYard();
  report.yardBuildMs = Math.round(performance.now() - t0);
  sane(Y.geo, 'yard'); sane(Y.frameGeo, 'yard frame'); sane(buildGantry().geo, 'gantry'); sane(buildCarrier(), 'carrier');
  report.yardTris = tris(Y.geo) + tris(Y.frameGeo) * Y.frameZ.length;
  ok(report.yardTris < 400000, `yard ${report.yardTris} triangles`);
  ok(Y.floods.length <= FLOODS, 'yard floods within the material');
  for (const f of Y.floods) ok(f.p.every(Number.isFinite) && f.reach > 0, 'yard flood finite');
  const hw = YARD.W / 2, hh = YARD.H / 2;
  const fb = bbox(buildYardFrame());
  ok(fb.max.x - fb.min.x >= YARD.W && fb.max.y - fb.min.y >= YARD.H, 'frames span the dock');
  ok(fb.max.x < hw + 12 && fb.max.y < hh + 12, 'frames within their rails');
  const bb = bbox(Y.geo);
  ok(bb.min.y >= -hh - 20 && bb.max.y <= hh + 40, 'yard within its frames');
  ok(bb.max.z <= YARD.shopZ[1] + 10, 'the plate shop ends the dock');
  const space = new THREE.Group();
  const O = new LunarOrbitals(space);
  instSane(O.yard.frames, 'yard frames'); instSane(O.yard.pods, 'yard pods'); instSane(O.yard.carriers, 'yard carriers');
  ok(O.yard.frames.userData.floods === O.yard.dock.userData.floods, 'frames share the dock floods');
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Vector3();
  let carFrame = Infinity, carCrew = Infinity, carPod = Infinity, carCar = Infinity;
  let t1 = performance.now();
  for (let k = 0; k < 600; k++) {
    const t = k * 6.1;
    O._moveYard(t);
    // the trolley floods ride with the gantries
    for (let i = 0; i < O.yard.gantries.length; i++) ok(Math.abs(O.yard.dock.userData.floods.data[(6 + i) * 7 + 2] - O.yard.gantries[i].mesh.position.z * 1000) < 1e-3, 'trolley flood rides its gantry');
    const cp = [];
    for (let i = 0; i < O.yard.carriers.count; i++) {
      O.yard.carriers.getMatrixAt(i, m); p.setFromMatrixPosition(m); cp.push(p.clone());
      // outside the frames' columns and their cable trays (x = hw + 8), plate 9 m either side
      carFrame = Math.min(carFrame, Math.abs(p.x) - 9 - (hw + 8));
      // the crew block: x hw + 25 .. hw + 115, z -230 .. -70
      const dz = Math.max(-230 - p.z, p.z + 70, 0), dx = Math.max(hw + 25 - Math.abs(p.x), 0);
      carCrew = Math.min(carCrew, Math.hypot(dx, dz) - 14);
      for (let j = 0; j < O.yard.pods.count; j++) { O.yard.pods.getMatrixAt(j, m); q.setFromMatrixPosition(m); carPod = Math.min(carPod, p.distanceTo(q) - 16); }
    }
    for (let i = 0; i < cp.length; i++) for (let j = i + 1; j < cp.length; j++) carCar = Math.min(carCar, cp[i].distanceTo(cp[j]) - 30);
  }
  report.yardMoveMs = +((performance.now() - t1) / 600).toFixed(4);
  report.carrierClearM = { frames: +carFrame.toFixed(1), crew: +carCrew.toFixed(1), pods: +carPod.toFixed(1), each: +carCar.toFixed(1) };
  ok(carFrame > 2, `a carrier within ${carFrame.toFixed(1)} m of the frames`);
  ok(carCrew > 0, 'carriers clear of the crew block');
  ok(carPod > 0, 'carriers clear of the pods');
  ok(carCar > 0, `carriers within ${carCar.toFixed(1)} m of each other`);
  ok(report.yardMoveMs < 0.1, 'yard motion cheap');
}

// ------------------------------------------------------------ the ring deck --
{
  // the plot hash: the PCG reference values (as the GLSL computes them in uint), a spread of
  // outcomes, and the shader text using the same constants
  const pcgRef = (v) => { let st = BigInt.asUintN(32, BigInt(v) * 747796405n + 2891336453n); let w = BigInt.asUintN(32, ((st >> ((st >> 28n) + 4n)) ^ st) * 277803737n); return Number((w >> 22n) ^ w) / 4294967295; };
  let agree = 0, pockets = 0;
  for (let i = 0; i < 2000; i++) {
    const bi = i * 27 + 11, sd = i % 2 ? 1 : -1, salt = 1 + (i % 3);
    const v = BigInt.asUintN(32, BigInt(bi + 1048576) * 2n + (sd > 0 ? 1n : 0n) + BigInt(salt) * 2654435761n);
    if (Math.abs(plotHash(bi, sd, salt) - pcgRef(v)) < 1e-12) agree++;
    if (!plot(bi, sd)) pockets++;
  }
  ok(agree === 2000, `plot hash matches the uint reference ${agree}/2000`);
  ok(pockets > 150 && pockets < 330, `pocket squares ${pockets}/2000 (12 %)`);
  ok(Number.isFinite(hash12(1, 2)), 'hash12 twin');
  for (const [name, g] of [['block solid', buildTerraceBlock(40, false)], ['block court', buildTerraceBlock(40, true)], ['tree', buildTree()], ['vaults', buildVaults()], ['portal', buildPortal()], ['shield gallery', buildShieldGallery()]]) {
    sane(g, name);
    const b = bbox(g);
    if (name.startsWith('block')) ok(b.max.x - b.min.x <= 214 && b.max.z <= 297 && b.min.z >= -297 && b.min.y >= -0.01, `${name} on its plot`);
  }
  // the deck under everything: the chord radius at a vertex is R, 3 m in at a chord's middle
  const seg = 2 * Math.PI / DECK.segs;
  ok(Math.abs(deckTop(0) - DECK.R) < 1e-3 && Math.abs(deckTop(seg * 7) - DECK.R) < 1e-3, 'deck top at the band vertices');
  ok(DECK.R - deckTop(seg * 7.5) > 3 && DECK.R - deckTop(seg * 7.5) < 3.5, 'deck top sags at a chord middle');
  const group = new THREE.Group();
  group.updateMatrixWorld();
  const D = new LunarRingDeck(group);
  const data = buildLunarRingDistricts();
  // the halls' footprint (full form), in their own frame: along x, across z about the hall
  const hb = bbox(data.hallNear);
  report.hallHalfAlongM = Math.round(Math.max(-hb.min.x, hb.max.x));
  const cam = new THREE.Vector3(), m = new THREE.Matrix4(), p = new THREE.Vector3();
  let maxFill = 0, maxTris = 0, frameMs = 0, frames = 0, worst = { exch: Infinity, court: Infinity, hall: Infinity };
  const Rk = DECK.R / 1000;
  for (const u of [-150, -40, -9, 0, 8.35, 12, 55, 300, 6650]) {
    const th = u / Rk;
    cam.set(Math.cos(th) * (Rk + 3), 1.5, Math.sin(th) * (Rk + 3));
    D.key = undefined;
    const t0 = performance.now();
    D.update(10, cam);
    maxFill = Math.max(maxFill, performance.now() - t0);
    for (const x of D.all) instSane(x, x.name);
    maxTris = Math.max(maxTris, D.triangles());
    // clearances: every static instance off the Exchange and the Court, the shield galleries off the halls
    for (const x of [...D.statics, D.trams]) for (let i = 0; i < x.count; i++) {
      x.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      const a = p.y / 1000, uu = Math.atan2(p.z, p.x) * Rk;
      ok(Number.isFinite(uu), 'finite placement');
      worst.exch = Math.min(worst.exch, Math.abs(uu) - DECK.exch);
      const C = DECK.court;
      if (a > C.a0 && a < C.a1) worst.court = Math.min(worst.court, Math.max(C.u0 - uu, uu - C.u1));
      if (x === D.shield) {
        const dU = uu - Math.round(uu / DECK.sector) * DECK.sector;
        worst.hall = Math.min(worst.hall, Math.abs(dU) * 1000 - 100 - report.hallHalfAlongM);
      }
      // standing on the deck (the base within a metre of the chord)
      if (x !== D.trams) { const r = Math.hypot(p.x, p.z); ok(Math.abs(r - deckTop(Math.atan2(p.z, p.x))) < 1.5, `${x.name} off the deck by ${(r - deckTop(Math.atan2(p.z, p.x))).toFixed(2)} m`); }
    }
    // the blocks on the shader's own plots: centre in the terrace row, mid-plot along the ring
    for (const b of D.blocks) for (let i = 0; i < b.mesh.count; i++) {
      b.mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      const a = Math.abs(p.y / 1000);
      ok(Math.abs(a - (DECK.rowIn + DECK.rowOut) / 2) < 1e-3, 'block across its row');
      let us = Math.atan2(p.z, p.x) * Rk; if (us < 0) us += 2 * Math.PI * Rk;
      const f = (us / DECK.P) % 1;
      ok(Math.abs(f - 0.5) < 0.01, `block mid-plot (${f.toFixed(3)})`);
      const pl = plot(Math.floor(us / DECK.P), Math.sign(p.y));
      ok(pl && ((pl.H < 32 ? 0 : pl.H < 50 ? 1 : 2) === Math.round((b.H - 24) / 18) || b.H === 60 && pl.H >= 50), 'block in its height class');
    }
    // per-frame cost: the trams only, while the camera stays within its anchor
    for (let k = 0; k < 50; k++) { const t1 = performance.now(); D.update(10 + k * 0.1, cam); frameMs += performance.now() - t1; frames++; }
  }
  report.deckFillMs = +maxFill.toFixed(2);
  report.deckFrameMs = +(frameMs / frames).toFixed(4);
  report.deckTris = maxTris;
  report.deckClearKm = { exchange: +worst.exch.toFixed(3), court: +worst.court.toFixed(3) };
  report.deckHallClearM = +worst.hall.toFixed(0);
  ok(worst.exch > 0, 'deck clear of the Exchange');
  ok(worst.court > 0, 'deck clear of the Service Court');
  ok(worst.hall > 0, `shield galleries within ${worst.hall.toFixed(0)} m of a hall`);
  ok(maxFill < 25, `deck refill ${maxFill.toFixed(1)} ms`);
  ok(report.deckFrameMs < 0.3, `deck per-frame ${report.deckFrameMs} ms`);
  ok(maxTris < 4e6, `deck ${maxTris} triangles`);
  ok(D.blocks.reduce((n, b) => n + b.mesh.count, 0) > 200, 'terraces stand round the camera');
  ok(D.trams.count > 20, 'trams run on the boulevard');
  // far from the ring: nothing drawn
  cam.set(0, 0, 9000); D.update(10, cam);
  ok(D.all.every((x) => x.count === 0 && !x.visible), 'deck hidden far off');
}

console.log(JSON.stringify(report));
if (fails) { console.log(`MOON_W4_FAIL (${fails})`); process.exit(1); }
console.log('MOON_W4_OK');
