// The Hearth's ray tracer, headless: the JS twin of the shader's integrator against a fine
// reference (the adaptive sweep keeps the disc crossings where they belong), the step budget of
// every quality level (strongly bent rays reach the sky instead of running out mid-orbit, the
// old cause of black stair-steps in the photon ring), the shadow's size, the constants of
// motion, and static checks on the two shaders. Run: node tools/verify-hearth-lens.mjs
import assert from 'node:assert/strict';
import { traceKerr, SWEEP, sweepStep, hermite, hermiteRoot, BH_FRAG, COMP_FRAG, R_ISCO, R_HORIZON, keplerKerr } from '../src/space/hearthLens.js';
import { SPACE_QUALITY as QUALITY } from '../src/space/quality.js';

const out = {};
const nrm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Hermite crossing: exact for cubics, and the root lies in [0, 1]
{
  const f = (s) => 0.3 - 1.1 * s + 0.2 * s * s * s, df = (s) => -1.1 + 0.6 * s * s;
  const s = hermiteRoot(f(0), df(0), f(1), df(1));
  assert.ok(Math.abs(f(s)) < 1e-6, `Hermite root misses: f=${f(s)}`);
  assert.ok(Math.abs(hermite(f(0), df(0), f(1), df(1), 0.37) - f(0.37)) < 1e-12);
  for (let i = 0; i < 200; i++) {
    const y0 = Math.random() * 2 - 1, y1 = -Math.sign(y0) * Math.random();
    const r = hermiteRoot(y0, (Math.random() - 0.5) * 4, y1, (Math.random() - 0.5) * 4);
    assert.ok(r >= 0 && r <= 1 && Number.isFinite(r));
  }
}
// the sweep grows outward and is bounded
assert.ok(sweepStep(1 / 2) === SWEEP.min && sweepStep(1 / 200) === SWEEP.max);
for (let p = 0.005; p < 0.45; p += 0.01) assert.ok(sweepStep(p) >= sweepStep(p + 0.01));

// a camera 110 M out at three inclinations, rays across the hole and the inner disc
const qualities = Object.entries(QUALITY).map(([k, q]) => [k, q.bhSteps]);
for (const incDeg of [60, 80, 88]) {
  const inc = incDeg * Math.PI / 180, R = 110;
  const cam = [R * Math.sin(inc), 0, R * Math.cos(inc)];
  const f = cam.map((v) => -v / R), rt = nrm(cross(f, [0, 0, 1])), up = cross(rt, f);
  let n = 0, mismatch = 0, sum = 0, sumRef = 0, maxErr = 0, worstConst = 0;
  const exhausted = Object.fromEntries(qualities.map(([k]) => [k, 0]));
  const errs = [];
  for (let i = -30; i <= 30; i++) for (let j = -30; j <= 30; j++) {
    const d = nrm([0, 1, 2].map((k) => f[k] + (i / 30) * 0.18 * rt[k] + (j / 30) * 0.18 * up[k]));
    const a = traceKerr(cam, d, { steps: 4000 });
    const ref = traceKerr(cam, d, { steps: 60000, dpsi: 0.004 });
    n++; sum += a.steps; sumRef += ref.steps;
    if (a.captured !== ref.captured) mismatch++;
    if (!a.captured) worstConst = Math.max(worstConst, a.err);
    for (const [k, s] of qualities) if (!a.captured && a.steps >= s) exhausted[k]++;
    if (a.hits.length && ref.hits.length && ref.hits[0].r < 30) {
      const e = Math.abs(a.hits[0].r - ref.hits[0].r) / ref.hits[0].r;
      errs.push(e); maxErr = Math.max(maxErr, e);
      assert.ok(Number.isFinite(a.hits[0].r) && Number.isFinite(a.hits[0].phi));
    }
  }
  errs.sort((x, y) => x - y);
  const frac = Object.fromEntries(Object.entries(exhausted).map(([k, v]) => [k, +(v / n).toFixed(4)]));
  out[`inc${incDeg}`] = { rays: n, meanSteps: +(sum / n).toFixed(1), refSteps: +(sumRef / n).toFixed(0), captureMismatch: mismatch, crossingErrMedian: +errs[errs.length >> 1].toFixed(5), crossingErrMax: +maxErr.toFixed(5), exhausted: frac, constErr: +worstConst.toExponential(2) };
  assert.ok(mismatch <= n * 0.002, `capture disagrees with the reference on ${mismatch} rays`);
  assert.ok(maxErr < 0.01, `disc crossing off by ${(maxErr * 100).toFixed(2)}% of r`);
  assert.ok(frac.low < 0.03, `low quality leaves ${(frac.low * 100).toFixed(1)}% of rays unfinished`);
  assert.ok(frac.medium < 0.01 && frac.high < 0.005, 'step budget too short');
  assert.ok(sum / n < 60, 'mean step count above the old fixed-sweep cost');
  assert.ok(worstConst < 5e-3, `constants of motion drift ${worstConst}`);
}
// the shadow: seen from 45 degrees, rays within ~4 M of the centre are captured and rays 7 M out
// escape, at the adaptive sweep exactly as at the fine reference (Kerr a = 0.7: radius ~5 M)
{
  const inc = Math.PI / 4, cam = [110 * Math.sin(inc), 0, 110 * Math.cos(inc)];
  const f = cam.map((v) => -v / 110), rt = nrm(cross(f, [0, 0, 1])), up = cross(rt, f);
  const ray = (b, e) => nrm([0, 1, 2].map((k) => f[k] + (b / 110) * e[k]));
  for (const e of [rt, up, rt.map((v) => -v), up.map((v) => -v)]) {
    for (const b of [0, 1, 3.5]) assert.ok(traceKerr(cam, ray(b, e), { steps: 4000 }).captured, `captured at b=${b}`);
    for (const b of [7, 9]) assert.ok(!traceKerr(cam, ray(b, e), { steps: 4000 }).captured, `escapes at b=${b}`);
  }
}
// Kerr orbits used by the shader: ISCO inside 6 M, finite kinematics down to it
assert.ok(R_ISCO > R_HORIZON && R_ISCO < 6);
for (let r = R_ISCO; r < 30; r += 0.5) { const k = keplerKerr(r); assert.ok(Number.isFinite(k.omega) && Number.isFinite(k.ut) && k.ut > 1); }

// static shader checks (the lead validates compilation; these catch the known traps)
const loopBody = BH_FRAG.slice(BH_FRAG.indexOf('for (int i = 0; i < STEPS'));
assert.ok(!/fwidth|dFdx|dFdy/.test(BH_FRAG), 'derivatives in the lens pass');
assert.ok(!/texture\(|texture2D\(/.test(loopBody), 'texture reads in the ray loop');
for (const src of [BH_FRAG, COMP_FRAG]) {
  let d = 0; for (const c of src) { if (c === '{') d++; if (c === '}') d--; assert.ok(d >= 0); } assert.equal(d, 0, 'unbalanced braces');
  let pd = 0; for (const c of src) { if (c === '(') pd++; if (c === ')') pd--; } assert.equal(pd, 0, 'unbalanced parentheses');
  assert.ok(!src.includes('${'), 'unexpanded template');
}
for (const def of ['SWEEP_K', 'SWEEP_MIN', 'SWEEP_MAX']) assert.ok(new RegExp(`#define ${def} [0-9.]+`).test(BH_FRAG), def);
assert.ok(/uniform vec2 uDiscRes;/.test(COMP_FRAG) && /discCR\(vUv\)/.test(COMP_FRAG), 'Catmull-Rom composite');
const d2 = COMP_FRAG.slice(COMP_FRAG.indexOf('vec4 discCR')); assert.equal((d2.match(/textureLod\(tDisc/g) || []).length, 9);
{
  const m = COMP_FRAG.slice(COMP_FRAG.indexOf('void main()'));
  assert.ok(m.indexOf('fwidth(') < m.indexOf('discard;'), 'composite derivatives taken before the discard');
  assert.ok(!/texture2D\(|texture\(/.test(m), 'composite reads with explicit LOD');
}
out.meanStepsOldFixedSweep = (() => {   // the pre-wave-3 fixed 0.05 rad sweep, same camera, for comparison
  const inc = 80 * Math.PI / 180, R = 110, cam = [R * Math.sin(inc), 0, R * Math.cos(inc)];
  const f = cam.map((v) => -v / R), rt = nrm(cross(f, [0, 0, 1])), up = cross(rt, f);
  let sum = 0, n = 0, lowOut = 0;
  for (let i = -30; i <= 30; i += 2) for (let j = -30; j <= 30; j += 2) {
    const d = nrm([0, 1, 2].map((k) => f[k] + (i / 30) * 0.18 * rt[k] + (j / 30) * 0.18 * up[k]));
    const a = traceKerr(cam, d, { steps: 4000, dpsi: 0.05 }); sum += a.steps; n++; if (!a.captured && a.steps >= 70) lowOut++;
  }
  return { meanSteps: +(sum / n).toFixed(1), lowUnfinished: +(lowOut / n).toFixed(3) };
})();
console.log(JSON.stringify(out, null, 1));
console.log('HEARTH_LENS_VERIFIED');
