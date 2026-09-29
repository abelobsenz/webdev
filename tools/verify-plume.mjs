// The Lodestar's exhaust and jump visuals: no proxy edge can show, and the warp field has no rings.
//   node tools/verify-plume.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPlume, createRcsJet } from '../src/space/plume.js';

// JS twin of the emission terms in plume.js (per unit length, before the global gain)
function emission(u, s, r) {
  const R0 = u.uR0.value, r2 = r * r;
  const Rc = R0 * 0.8 + s * u.uTanC.value, sc = 0.42 * Rc, sx = 0.33 * R0;
  const ex = u.uAx.value * Math.exp(-r2 / (2 * sx * sx)) * Math.exp(-s / (0.8 * R0));
  const tail = 1 - smooth(u.uLen.value * 0.55, u.uLen.value * 0.97, s);
  const jet = u.uAc.value * (R0 * R0) / (Rc * Rc) * Math.exp(-r2 / (2 * sc * sc)) * Math.exp(-s / u.uLc.value) * tail;
  const Re = R0 * 0.95 + s * u.uTanE.value, se = 0.55 * Re;
  const env = u.uAe.value * (R0 * R0) / (Re * Re) * Math.exp(-r2 / (2 * se * se)) * Math.exp(-s / u.uLe.value)
    * smooth(0, R0 * 2.5, s) * (1 - smooth(u.uLen.value * 0.4, u.uLen.value * 0.95, s)) * 1.75;   // noise peak 0.25 + 1.5
  return { core: (s >= 0 && r <= u.uRbC.value) ? ex + jet * 1.55 : 0, env };
}
function smooth(a, b, x) { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }

const report = {};
for (const [name, p] of [['main', createPlume({ r0: 1.65 * 0.95, len: 1.65 * 19 })], ['aux', createPlume({ r0: 0.82 * 0.95, len: 0.82 * 16 })], ['rcs', createRcsJet(new THREE.Vector3(), new THREE.Vector3(0, 0, 1))]]) {
  const u = p.material.uniforms, len = u.uLen.value;
  const pos = p.geometry.attributes.position;
  // the proxy's drawn radius at each station s (a cone from the exit plane to the end)
  let rNear = 0, rFar = 0;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i), r = Math.hypot(pos.getX(i), pos.getY(i));
    if (Math.abs(z) < 1e-6) rNear = Math.max(rNear, r);
    if (Math.abs(z - len) < 1e-6) rFar = Math.max(rFar, r);
  }
  assert.ok(rNear > 0 && rFar >= rNear, `${name}: proxy is a cone opening downstream`);
  let peak = 0, worstWall = 0, worstEnd = 0, worstCore = 0;
  for (let k = 0; k <= 400; k++) {
    const s = (k / 400) * len;
    const axis = emission(u, s, 0);
    peak = Math.max(peak, axis.core + axis.env);
    const rw = rNear + (rFar - rNear) * (s / len) * 0.999;
    const wall = emission(u, s, rw);
    worstWall = Math.max(worstWall, wall.core + wall.env);
    // the core cylinder's own wall (the narrow march) must also be dark
    const cw = emission(u, s, u.uRbC.value * 0.999);
    const Rc = u.uR0.value * 0.8 + s * u.uTanC.value, sc = 0.42 * Rc;
    worstCore = Math.max(worstCore, Math.exp(-(u.uRbC.value ** 2) / (2 * sc * sc)));
    void cw;
  }
  for (let q = 0; q <= 50; q++) { const r = (q / 50) * rFar; const e = emission(u, len * 0.999, r); worstEnd = Math.max(worstEnd, e.core + e.env); }
  // the envelope's own cylinder wall at every station
  let worstEnv = 0;
  for (let k = 0; k <= 400; k++) { const s = (k / 400) * len; worstEnv = Math.max(worstEnv, emission(u, s, u.uRbE.value * 0.999).env); }
  assert.ok(worstWall / peak < 0.004, `${name}: emission at the proxy's side wall ${(worstWall / peak).toExponential(2)} of the peak (edge would show)`);
  assert.ok(worstEnd / peak < 0.004, `${name}: emission at the proxy's far end ${(worstEnd / peak).toExponential(2)} of the peak`);
  assert.ok(worstEnv / peak < 0.004, `${name}: envelope at its march cylinder ${(worstEnv / peak).toExponential(2)} of the peak`);
  assert.ok(worstCore < 0.005, `${name}: jet Gaussian at the core cylinder wall ${worstCore.toExponential(2)}`);
  report[name] = { rNear: +rNear.toFixed(2), rFar: +rFar.toFixed(2), wallRatio: worstWall / peak, endRatio: worstEnd / peak, envWallRatio: worstEnv / peak };
}
// positive control: the previous plume (halo sigma 0.8 Ro, bounded by a cylinder at Ro(len)) kept
// 46% of its axial halo density at that wall - a visible cone edge the test must catch
{
  const R0 = 1.57, len = 31, tH = Math.tan(0.6), Ro = R0 * 1.08 + len * tH, Rb = Ro;
  const old = (r) => 0.2 * (R0 / Ro) ** 2 * Math.exp(-(r * r) / (2 * 0.64 * Ro * Ro));
  assert.ok(old(Rb) / old(0) > 0.004, 'Positive control: the old proxy wall cut visible emission');
}
// the warp field draws no rings or emitter nodes: it is a lens pass over the rendered frame
const warpSrc = (await import('node:fs')).readFileSync(new URL('../src/space/warp.js', import.meta.url), 'utf8');
assert.ok(!/TorusGeometry|Sprite/.test(warpSrc), 'The warp field has no rings or emitter sprites');
assert.ok(/doppler/.test(warpSrc) && /aberrat/.test(warpSrc), 'The warp pass Doppler-shifts and aberrates the background');
console.log(JSON.stringify(report));
console.log('PLUME_VERIFIED');
