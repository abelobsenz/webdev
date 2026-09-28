import * as THREE from 'three';
import { latheFacade, mergeClean } from './geom.js';
import { createFacadeMaterial } from './facade.js';
import { patchedMaterial, applyPatch, aerialShaderMaterial, FACADE_GLSL } from './materials.js';
import { PLAZA_Y, PLAZA_R } from './layout.js';
import { buildPlaza } from './plaza.js';
import { U } from '../core/uniforms.js';

const TAU = Math.PI * 2;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Hyperboloid lattice parameters (straight rulings between two circles)
export const AXIS = {
  latticeBase: 330, latticeTop: 132, latticeY0: 560, latticeY1: 2820, twist: THREE.MathUtils.degToRad(104),
  coreBase: 74, coreTop: 46, crownY: 3060, anchorY: 3140, height: 3200,
};

/** Radius of the hyperboloid lattice at height y. */
export function latticeRadius(y) {
  const { latticeBase: rb, latticeTop: rt, latticeY0: y0, latticeY1: y1, twist } = AXIS;
  const v = THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1);
  const ax = rb + (Math.cos(twist) * rt - rb) * v, az = Math.sin(twist) * rt * v;
  return Math.hypot(ax, az);
}

export function coreRadius(y) {
  const v = THREE.MathUtils.clamp(y / AXIS.crownY, 0, 1);
  return AXIS.coreBase + (AXIS.coreTop - AXIS.coreBase) * Math.pow(v, 0.8);
}

// ------------------------------------------------------------------ geometry kit --
// Every part of the Axis is a closed solid: lathes are walked round their whole section, tubes
// are capped, loops close on themselves without a seam, and each surface carries exactly one
// facade kind (kinds never interpolate between rows, which painted stray garden and lantern
// bands wherever two kinds met). Normals are analytic, so tubes have no shading seam.

function geo(pos, nrm, fac, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Lathe round Y from runs of profile points [{ r, y }], walked with the solid on the left
 * (underside outwards, up the outside, top inwards) so every face points out. Each run is one
 * facade kind with its own vertices (a crisp edge where runs meet). run.u: 'arc' (metres round)
 * or a fixed circumference, so the pattern tiles exactly round (no seam, ribs at fixed angles
 * however the radius changes); run.v: 'y' (height), 'r' (radius, for flat rings) or 's' (metres
 * along the profile from run.s0), less run.vOff. A point at r = 0 closes the lathe with a fan.
 */
function lathe(runs, segments, { phase = 0, fs = 1 } = {}) {
  const pos = [], nrm = [], fac = [], idx = [];
  const cols = segments + 1;
  for (const run of runs) {
    const P = run.pts, n = P.length, base = pos.length / 3;
    let s = run.s0 || 0;
    for (let j = 0; j < n; j++) {
      const p = P[j], a = P[Math.max(j - 1, 0)], b = P[Math.min(j + 1, n - 1)];
      const tr = b.r - a.r, ty = b.y - a.y, tl = Math.hypot(tr, ty) || 1;
      const nr = ty / tl, ny = -tr / tl;                        // right of the direction of travel
      if (j > 0) s += Math.hypot(p.r - P[j - 1].r, p.y - P[j - 1].y);
      const v = (run.v === 'r' ? p.r : run.v === 's' ? s : p.y) - (run.vOff || 0);
      for (let i = 0; i <= segments; i++) {
        const t = i / segments, ang = t * TAU + phase, c = Math.cos(ang), sn = Math.sin(ang);
        pos.push(c * p.r, p.y, sn * p.r);
        nrm.push(c * nr, ny, sn * nr);
        fac.push((typeof run.u === 'number' ? t * run.u : t * TAU * p.r) * fs, v * fs, run.kind);
      }
    }
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < segments; i++) {
        const a = base + j * cols + i, b = a + 1, c = a + cols, d = c + 1;
        if (P[j].r > 1e-6) idx.push(a, c, b);
        if (P[j + 1].r > 1e-6) idx.push(b, c, d);
      }
    }
  }
  return geo(pos, nrm, fac, idx);
}

/** Carry a frame normal from tangent t0 to t1 (rotation-minimising step). */
function carry(n, t0, t1) {
  const ax = new THREE.Vector3().crossVectors(t0, t1), s = ax.length();
  const m = n.clone();
  if (s > 1e-12) m.applyAxisAngle(ax.divideScalar(s), Math.atan2(s, t0.dot(t1)));
  return m.addScaledVector(t1, -m.dot(t1)).normalize();
}

const _o = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();

/**
 * Tube along points, radius(t) with t = 0..1 along them. Frames are rotation-minimising from the
 * reference `up` (the frame normal; sections are ellipses, `ellipse` times the radius along the
 * binormal). Open tubes get end caps ('flat' or 'round'); a closed loop spreads its holonomy so
 * frames, positions and the facade pattern all meet the first section exactly (its facade length
 * is rounded to whole multiples of vLen, so panel courses stay regular across the join).
 */
function tube(pts, radius, radial, { kind = 1, ellipse = 1, up = null, closed = false, caps = 'flat', capKind = kind, vLen = 12, v0 = 0 } = {}) {
  const N = pts.length;
  const T = [], F = [];
  for (let i = 0; i < N; i++) {
    const a = closed ? pts[(i - 1 + N) % N] : pts[Math.max(i - 1, 0)];
    const b = closed ? pts[(i + 1) % N] : pts[Math.min(i + 1, N - 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  const ref = (up || V3(0, 1, 0)).clone().normalize();
  if (_n.crossVectors(ref, T[0]).lengthSq() < 1e-4) ref.set(Math.abs(T[0].x) < 0.9 ? 1 : 0, 0, Math.abs(T[0].x) < 0.9 ? 0 : 1);
  F.push(ref.addScaledVector(T[0], -ref.dot(T[0])).normalize());
  for (let i = 1; i < N; i++) F.push(carry(F[i - 1], T[i - 1], T[i]));
  if (closed) {
    const back = carry(F[N - 1], T[N - 1], T[0]);
    const tw = Math.atan2(_n.crossVectors(back, F[0]).dot(T[0]), back.dot(F[0]));
    for (let i = 1; i < N; i++) F[i].applyAxisAngle(T[i], (tw * i) / N).normalize();
  }
  const rows = closed ? N + 1 : N;
  const L = [0];
  for (let j = 1; j < rows; j++) L.push(L[j - 1] + pts[j % N].distanceTo(pts[j - 1]));
  const vs = closed ? (Math.max(1, Math.round(L[rows - 1] / vLen)) * vLen) / L[rows - 1] : 1;
  const pos = [], nrm = [], fac = [], idx = [];
  const cols = radial + 1;
  for (let j = 0; j < rows; j++) {
    const k = j % N, p = pts[k], n = F[k];
    _b.crossVectors(T[k], n);
    const r = radius(closed ? k / N : j / (N - 1));
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * TAU, c = Math.cos(a), s = Math.sin(a);
      _o.copy(n).multiplyScalar(c * r).addScaledVector(_b, s * r * ellipse);
      pos.push(p.x + _o.x, p.y + _o.y, p.z + _o.z);
      _n.copy(n).multiplyScalar(c * ellipse).addScaledVector(_b, s).normalize();
      nrm.push(_n.x, _n.y, _n.z);
      fac.push(a * r, v0 + L[j] * vs, kind);
    }
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (!closed && caps) {
    // end caps: rings from the rim to the apex (a flat disc, or a low dome of 0.55 r)
    const K = caps === 'round' ? 3 : 1;
    for (const end of [0, 1]) {
      const j = end ? N - 1 : 0, p = pts[j], n = F[j];
      _t.copy(T[j]).multiplyScalar(end ? 1 : -1);
      _b.crossVectors(T[j], n);
      const r = radius(end ? 1 : 0), h = caps === 'round' ? 0.55 * r : 0;
      const base = pos.length / 3;
      for (let k = 0; k < K; k++) {
        const phi = (k / K) * Math.PI * 0.5, cp = Math.cos(phi), sp = Math.sin(phi);
        for (let i = 0; i <= radial; i++) {
          const a = (i / radial) * TAU, c = Math.cos(a), s = Math.sin(a);
          _o.copy(n).multiplyScalar(c * r * cp).addScaledVector(_b, s * r * ellipse * cp).addScaledVector(_t, h * sp);
          pos.push(p.x + _o.x, p.y + _o.y, p.z + _o.z);
          if (h > 0) _n.copy(n).multiplyScalar(c * cp).addScaledVector(_b, (s * cp) / ellipse).addScaledVector(_t, (r * sp) / h).normalize();
          else _n.copy(_t);
          nrm.push(_n.x, _n.y, _n.z);
          fac.push(c * r * cp, s * r * ellipse * cp, capKind);
        }
      }
      const apex = pos.length / 3;
      pos.push(p.x + _t.x * h, p.y + _t.y * h, p.z + _t.z * h);
      nrm.push(_t.x, _t.y, _t.z);
      fac.push(0, 0, capKind);
      for (let k = 0; k < K; k++) {
        for (let i = 0; i < radial; i++) {
          const a = base + k * cols + i, b = a + 1;
          if (k === K - 1) {
            if (end) idx.push(a, b, apex); else idx.push(a, apex, b);
          } else {
            const c = a + cols, d = c + 1;
            if (end) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
          }
        }
      }
    }
  }
  return geo(pos, nrm, fac, idx);
}

/**
 * A closed prism through stations of four corners each (corner k to k + 1 is side k). Every side
 * is its own strip (crisp edges), both ends are capped, and each face is turned to face away
 * from the section centre. vMode 'y': facade v is world height (courses line up with the core);
 * 'len': metres along the prism. u0 offsets each side's facade u (energy veins run down u 1.4-1.8
 * of each 16 m rib period).
 */
function prism(rows, { kinds = [1, 1, 1, 1], capKind = 1, vMode = 'len', u0 = [0, 0, 0, 0] } = {}) {
  const pos = [], nrm = [], fac = [], idx = [];
  const n = rows.length;
  const C = rows.map((q) => new THREE.Vector3().add(q[0]).add(q[1]).add(q[2]).add(q[3]).multiplyScalar(0.25));
  const L = [0];
  for (let j = 1; j < n; j++) L.push(L[j - 1] + C[j].distanceTo(C[j - 1]));
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3(), m = new THREE.Vector3();
  for (let k = 0; k < 4; k++) {
    const k1 = (k + 1) % 4, base = pos.length / 3, qn = [];
    let flip = false;
    for (let j = 0; j < n - 1; j++) {
      const A = rows[j][k], B = rows[j][k1], D = rows[j + 1][k];
      fn.crossVectors(e1.subVectors(B, A), e2.subVectors(D, A));
      if (j === 0) {
        m.copy(A).add(B).add(D).add(rows[1][k1]).multiplyScalar(0.25).addScaledVector(C[0], -0.5).addScaledVector(C[1], -0.5);
        flip = fn.dot(m) < 0;
      }
      qn.push(fn.clone().normalize().multiplyScalar(flip ? -1 : 1));
    }
    for (let j = 0; j < n; j++) {
      const A = rows[j][k], B = rows[j][k1];
      const nv = j === 0 ? qn[0] : j === n - 1 ? qn[n - 2] : qn[j - 1].clone().add(qn[j]).normalize();
      pos.push(A.x, A.y, A.z, B.x, B.y, B.z);
      nrm.push(nv.x, nv.y, nv.z, nv.x, nv.y, nv.z);
      fac.push(u0[k], vMode === 'y' ? A.y : L[j], kinds[k], u0[k] + A.distanceTo(B), vMode === 'y' ? B.y : L[j], kinds[k]);
    }
    for (let j = 0; j < n - 1; j++) {
      const a = base + 2 * j, b = a + 1, c = a + 2, d = a + 3;
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  for (const [j, jn] of [[0, 1], [n - 1, n - 2]]) {
    const q = rows[j];
    fn.crossVectors(e1.subVectors(q[1], q[0]), e2.subVectors(q[2], q[0]));
    const f = fn.dot(m.subVectors(C[j], C[jn])) < 0;
    fn.normalize();
    if (f) fn.negate();
    const base = pos.length / 3;
    e1.subVectors(q[1], q[0]).normalize();
    e2.crossVectors(fn, e1);
    for (let k = 0; k < 4; k++) {
      pos.push(q[k].x, q[k].y, q[k].z);
      nrm.push(fn.x, fn.y, fn.z);
      m.subVectors(q[k], q[0]);
      fac.push(m.dot(e1), m.dot(e2), capKind);
    }
    if (f) idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return geo(pos, nrm, fac, idx);
}

// ------------------------------------------------------------------- the lattice --
// Two families of 52 straight rulings between the base and top circles. Ruling i of one family
// crosses ruling i + k of the other at level k (k = 1..30), where both lie on the hyperboloid.
const NSTRUT = 52;

/** Point at parameter v (0 on the base circle, 1 on the top circle) of ruling i of family fam (+1 / -1). */
function ruling(i, fam, v, out = new THREE.Vector3()) {
  const { latticeBase: rb, latticeTop: rt, latticeY0: y0, latticeY1: y1, twist } = AXIS;
  const a0 = (i / NSTRUT) * TAU, a1 = a0 + fam * twist;
  return out.set(Math.cos(a0) * rb * (1 - v) + Math.cos(a1) * rt * v, y0 + (y1 - y0) * v, Math.sin(a0) * rb * (1 - v) + Math.sin(a1) * rt * v);
}
const strutRadius = (v) => 5.4 - 1.8 * v;
const latticeV = (y) => (y - AXIS.latticeY0) / (AXIS.latticeY1 - AXIS.latticeY0);
const latticeY = (v) => AXIS.latticeY0 + (AXIS.latticeY1 - AXIS.latticeY0) * v;

/** Parameter of crossing level k (ruling i of one family meets ruling i + k of the other). */
function nodeV(k) {
  const { latticeBase: rb, latticeTop: rt, twist } = AXIS;
  const phi = (k * Math.PI) / NSTRUT;
  return (rb * Math.sin(phi)) / (rb * Math.sin(phi) + rt * Math.sin(twist - phi));
}

/** Outward surface normal of the lattice at the crossing of ruling i (+) and ruling i + k (-). */
function nodeFrame(i, k) {
  const v = nodeV(k);
  const p = ruling(i, 1, v);
  const dp = ruling(i, 1, 1).sub(ruling(i, 1, 0)).normalize();
  const dm = ruling(i + k, -1, 1).sub(ruling(i + k, -1, 0)).normalize();
  const n = new THREE.Vector3().crossVectors(dp, dm).normalize();
  if (n.x * p.x + n.z * p.z < 0) n.negate();
  const x = dp.clone().sub(dm).normalize();
  return { p, v, n, x, z: new THREE.Vector3().crossVectors(x, n) };
}

/** How far a crossing node (radius 1.3 rs, half-height 1.08 rs round the surface normal) reaches out past the lattice radius. */
function nodeReach(y) {
  const v = THREE.MathUtils.clamp(latticeV(y), 0, 1);
  const slope = Math.abs(latticeRadius(y + 2) - latticeRadius(y - 2)) / 4;
  const b = Math.atan(slope);
  return strutRadius(v) * (1.08 * Math.cos(b) + 1.3 * Math.sin(b));
}

// Additive glow shell (tether halo, crown aura)
function glowMaterial(color, strength, { fresnelPow = 2.0, nightOnly = 0.7 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uCityLights: U.uCityLights, uTime: U.uTime, uNightOnly: { value: nightOnly }, uPow: { value: fresnelPow } },
    vertexShader: /* glsl */ `
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  vY = w.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor; uniform float uStrength; uniform float uCityLights; uniform float uTime; uniform float uNightOnly; uniform float uPow;
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  float f = pow(abs(dot(normalize(vN), normalize(vV))), uPow);
  float pulse = 0.85 + 0.15 * sin(vY * 0.004 - uTime * 1.5);
  float k = mix(1.0, uCityLights, uNightOnly);
  gl_FragColor = vec4(uColor * f * uStrength * k * pulse, 1.0);
}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}

export function buildAxis(scene, updaters) {
  const group = new THREE.Group();
  group.name = 'The Axis';
  scene.add(group);

  // ------------------------------------------------ structure material ------
  const boneMat = createFacadeMaterial('pearl', 101, { litFrac: 0.6 });
  const coreMat = createFacadeMaterial('silver', 102, { litFrac: 0.7, band: 128 });
  const parts = [];
  const beaconPts = [];
  const { latticeY0: y0, latticeY1: y1 } = AXIS;
  const P = (r, y) => ({ r, y });

  // --------------------------------------------------------- sky decks ------
  // Four decks cantilever from the core and are threaded by the lattice: a coffered soffit,
  // deepest at the core, with radial girders under it; a rounded nose with a lantern strip; a
  // gallery of glazing between mullion fins; a glass balustrade with a handrail; a paved
  // promenade inside it and the planted (or paved) deck itself, flat at y + t / 4.
  const decks = [
    { y: y0 + 20, r: latticeRadius(y0 + 20) + 26, t: 46, name: 'Root Deck', floor: 3 },
    { y: 1260, r: latticeRadius(1260) + 20, t: 34, name: 'Garden Deck', floor: 3 },
    { y: 2180, r: latticeRadius(2180) + 38, t: 30, name: 'The Collar', floor: 9 },
    { y: y1 + 10, r: latticeRadius(y1) + 22, t: 40, name: 'Coronet', floor: 3 },
  ];
  for (const d of decks) {
    const { y, r: R, t } = d;
    const yT = y + 0.25 * t, e = Math.max(8, 0.3 * t), yE = yT - e;
    const rIn = coreRadius(y) - 3, rK = 0.72 * R, yK = y - 0.75 * t, yC = y - 0.9 * t, rE = R - 5;
    d.yTop = yT;
    // height of the underside at radius r
    d.under = (r) => (r <= rK ? yC + ((yK - yC) * (r - rIn)) / (rK - rIn)
      : r <= rE ? yK + ((yE - yK) * (r - rK)) / (rE - rK)
        : r <= R - 1.2 ? yE + (0.8 * (r - rE)) / (R - 1.2 - rE)
          : yE + 0.8 + (1.4 * (r - R + 1.2)) / 1.2);
    // circumferences that tile each pattern exactly round: coffers 7.2 m, rib bays 16 m,
    // lantern fins 1.6 m, balustrade joints 1.25 m
    const Cs1 = Math.round((Math.PI * (rIn + rK)) / 7.2) * 7.2, Cs2 = Math.round((Math.PI * (rK + rE)) / 7.2) * 7.2;
    const Cf = Math.round((TAU * R) / 16) * 16, Cl = Math.round((TAU * R) / 1.6) * 1.6, Cb = Math.round((TAU * R) / 1.25) * 1.25;
    parts.push(lathe([
      { kind: 1, v: 's', u: Cs1, pts: [P(rIn, yC), P(rK, yK)] },                                        // soffit
      { kind: 1, v: 's', u: Cs2, s0: Math.hypot(rK - rIn, yK - yC), pts: [P(rK, yK), P(rE, yE)] },
      { kind: 1, v: 'y', u: Cf, pts: [P(rE, yE), P(R - 1.2, yE + 0.8), P(R, yE + 2.2)] },              // rounded nose
      { kind: 2, v: 'y', u: Cl, pts: [P(R, yE + 2.2), P(R, yE + 3.4)] },                                // lantern strip
      { kind: 0, v: 'y', u: Cf, vOff: yE + 3.4 - 21, pts: [P(R, yE + 3.4), P(R, yT - 1)] },             // gallery glazing
      { kind: 1, v: 'y', u: Cf, pts: [P(R, yT - 1), P(R, yT + 0.35)] },                                  // cornice and curb
      { kind: 12, v: 'y', u: Cb, vOff: yT + 0.35, pts: [P(R, yT + 0.35), P(R, yT + 1.2)] },              // glass balustrade
      { kind: 10, v: 's', u: Cl, pts: [P(R, yT + 1.2), P(R - 0.06, yT + 1.3), P(R - 0.44, yT + 1.3), P(R - 0.5, yT + 1.2)] }, // handrail
      { kind: 12, v: 'y', u: Cb, vOff: yT + 0.35, pts: [P(R - 0.5, yT + 1.2), P(R - 0.5, yT + 0.35)] },
      { kind: 1, v: 'y', u: Cl, pts: [P(R - 0.5, yT + 0.35), P(R - 0.5, yT)] },
      { kind: 9, v: 'r', pts: [P(R - 0.5, yT), P(R - 9, yT)] },                                          // promenade
      { kind: d.floor, v: 'r', pts: [P(R - 9, yT), P(rIn, yT)] },                                        // the deck
    ], R > 300 ? 192 : 144));
    // mullion fins over the gallery's solid ribs (every fifth 3.2 m bay), veins down their faces
    for (let k = 0; k < Cf / 16; k++) {
      const aL = ((16 * k) / Cf) * TAU, aR = ((16 * k + 3.2) / Cf) * TAU;
      const at = (a, r, yy) => V3(Math.cos(a) * r, yy, Math.sin(a) * r);
      const row = (yy) => [at(aL, R - 0.3, yy), at(aL, R + 0.9, yy), at(aR, R + 0.9, yy), at(aR, R - 0.3, yy)];
      parts.push(prism([row(yE + 3.4), row(yT - 1)], { vMode: 'y', u0: [16 * k + 8, 16 * k, 16 * k + 8, 16 * k + 8] }));
    }
    // radial girders under the soffit: between the struts that thread the deck (or, under the
    // Root Deck, on the core's pilasters and between them, clear of the root arches)
    const beamAt = [];
    if (d === decks[0]) {
      for (let k = 0; k < 48; k++) {
        const deg = 15 * Math.floor(k / 2) + (k % 2 ? 9 : 1.5);
        const off = ((((deg - 22.5) % 45) + 45) % 45);
        if (Math.min(off, 45 - off) > 5) beamAt.push(THREE.MathUtils.degToRad(deg));
      }
    } else {
      const v = latticeV(d.under(latticeRadius(y)));
      const angs = [];
      for (let i = 0; i < NSTRUT; i++) for (const fam of [1, -1]) { const p = ruling(i, fam, v); angs.push((Math.atan2(p.z, p.x) + TAU) % TAU); }
      angs.sort((a, b) => a - b);
      const gaps = angs.map((a, i) => ({ m: a + (((angs[(i + 1) % angs.length] - a + TAU) % TAU) / 2), g: (angs[(i + 1) % angs.length] - a + TAU) % TAU }));
      gaps.sort((p, q) => q.g - p.g);
      const mids = gaps.slice(0, NSTRUT).map((q) => q.m % TAU).sort((a, b) => a - b);
      mids.forEach((m, i) => { if (i % 2 === 0) beamAt.push(m); });
    }
    const bw = d === decks[0] ? 1.4 : 1.1, dep0 = d === decks[0] ? 6 : 4.2, rEnd = R - 9;
    for (const a of beamAt) {
      const ca = Math.cos(a), sa = Math.sin(a), tx = -sa * bw, tz = ca * bw;
      const st = [rIn, (rIn + rK) / 2, rK, (rK + rEnd) / 2, rEnd].map((r) => {
        const yu = d.under(r), dep = THREE.MathUtils.lerp(dep0, 0.8, (r - rIn) / (rEnd - rIn));
        const cx = ca * r, cz = sa * r;
        return [V3(cx + tx, yu + 0.6, cz + tz), V3(cx + tx, yu - dep, cz + tz), V3(cx - tx, yu - dep, cz - tz), V3(cx - tx, yu + 0.6, cz - tz)];
      });
      parts.push(prism(st));
    }
    // aircraft beacons on lamp posts along the handrail
    for (let k = 0; k < 16; k++) {
      const a = ((k + 0.5) / 16) * TAU, rr = R - 0.25, ca = Math.cos(a), sa = Math.sin(a);
      parts.push(tube([V3(ca * rr, yT + 1.2, sa * rr), V3(ca * rr, yT + 2.0, sa * rr)], () => 0.26, 8, { kind: 10, caps: 'round', up: V3(ca, 0, sa) }));
      beaconPts.push(ca * rr, yT + 2.35, sa * rr);
    }
  }
  const inDeck = (r, yy, pad) => decks.some((d) => Math.abs(yy - d.y) < d.t + 30 && r < d.r + pad && yy > d.under(Math.min(r, d.r)) - pad && yy < d.yTop + pad);

  // --------------------------------------------------------------- core -----
  // A glazed shaft on a stone plinth: 24 pilasters stand proud of the glass (over the facade's
  // solid ribs, so the energy veins run down them), service floors ring it where the maintenance
  // gantries land, and it swells where the decks attach. At the top a lantern band, a cornice and
  // a taper to the neck that carries the crown.
  const coreR = (y) => coreRadius(y) + decks.reduce((s, d) => s + 8 * Math.exp(-(((y - d.y) / 30) ** 2)), 0);
  const gantryK = [2, 8, 22];
  const serviceY = [320, ...gantryK.map((k) => latticeY(nodeV(k)))].sort((a, b) => a - b);
  const yGlass = AXIS.crownY - 12;
  const C = 384;                                   // 24 bays of 16 m round the core at every height
  const ys = [];
  for (let y = 23; y < yGlass; y += 30) ys.push(y);
  for (const d of decks) for (let y = d.y - 52.5; y <= d.y + 52.5; y += 7.5) ys.push(y);
  const rowsY = [];
  for (const y of [...ys.filter((q) => q >= 23 && q < yGlass - 1.5 && serviceY.every((s) => Math.abs(q - s) > 5)).sort((a, b) => a - b), yGlass]) {
    if (!rowsY.length || y - rowsY[rowsY.length - 1] > 1.5) rowsY.push(y);
  }
  const R0 = coreR(14);
  const coreRuns = [
    { kind: 1, v: 'r', u: C, pts: [P(0, 14), P(R0 + 1.2, 14)] },                                         // foot (buried)
    { kind: 1, v: 'y', u: C, pts: [P(R0 + 1.2, 14), P(R0 + 1.2, 22.3), P(R0 + 0.8, 22.8)] },              // plinth
    { kind: 1, v: 'r', u: C, pts: [P(R0 + 0.8, 22.8), P(coreR(23), 23)] },
  ];
  {
    let glass = [];
    const flush = () => { if (glass.length > 1) coreRuns.push({ kind: 0, v: 'y', u: C, pts: glass }); glass = []; };
    const left = [...serviceY];
    for (const y of rowsY) {
      while (left.length && left[0] < y) {
        const s = left.shift(), r = coreR(s);
        glass.push(P(coreR(s - 3.5), s - 3.5));
        flush();
        coreRuns.push(
          { kind: 1, v: 'y', u: C, pts: [P(coreR(s - 3.5), s - 3.5), P(r + 1.4, s - 3.2), P(r + 1.4, s - 1.5)] },
          { kind: 4, v: 'y', u: C, pts: [P(r + 1.4, s - 1.5), P(r + 0.8, s - 1.2), P(r + 0.8, s + 1.2), P(r + 1.4, s + 1.5)] },
          { kind: 1, v: 'y', u: C, pts: [P(r + 1.4, s + 1.5), P(r + 1.4, s + 3.2), P(coreR(s + 3.5), s + 3.5)] },
        );
        glass.push(P(coreR(s + 3.5), s + 3.5));
      }
      glass.push(P(coreR(y), y));
    }
    flush();
  }
  const rt = coreR(yGlass), cY = AXIS.crownY + 60;
  coreRuns.push(
    { kind: 2, v: 'y', u: Math.round((TAU * rt) / 1.6) * 1.6, pts: [P(rt, yGlass), P(rt + 0.6, yGlass + 1), P(rt + 1, yGlass + 7)] },         // lantern band
    { kind: 1, v: 'y', u: C, pts: [P(rt + 1, yGlass + 7), P(rt + 2.4, yGlass + 8.2), P(rt + 2.4, yGlass + 13), P(rt + 1.2, yGlass + 14.5)] }, // cornice
    { kind: 1, v: 's', u: C, pts: [P(rt + 1.2, yGlass + 14.5), P(36, yGlass + 18), P(24, yGlass + 32), P(15.5, yGlass + 46), P(14, yGlass + 52)] },
    { kind: 4, v: 'y', pts: [P(14, yGlass + 52), P(14, cY + 12)] },                                     // the neck
    { kind: 10, v: 'r', pts: [P(14, cY + 12), P(0, cY + 12)] },                                         // capped inside the anchor node
  );
  const coreParts = [lathe(coreRuns, 96)];
  {
    const pyAll = [...new Set([14, ...rowsY, ...serviceY.flatMap((s) => [s - 3.5, s + 3.5]), yGlass + 8.6])].sort((a, b) => a - b);
    for (let k = 0; k < 24; k++) {
      const aL = (k / 24) * TAU, aR = ((16 * k + 3.2) / C) * TAU;
      const at = (a, r, yy) => V3(Math.cos(a) * r, yy, Math.sin(a) * r);
      const rows = pyAll.map((yy) => {
        const r = coreR(Math.min(Math.max(yy, 23), yGlass));
        return [at(aL, r - 0.6, yy), at(aL, r + 2.2, yy), at(aR, r + 2.2, yy), at(aR, r - 0.6, yy)];
      });
      coreParts.push(prism(rows, { vMode: 'y', u0: [16 * k + 8, 16 * k, 16 * k + 8, 16 * k + 8] }));
    }
  }
  const core = new THREE.Mesh(mergeClean(coreParts), coreMat);
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  // ------------------------------------------------------ lattice struts ----
  // The rulings spring from inside the Root Deck and die into the Coronet, both ends capped.
  const vStart = latticeV(578);
  for (const fam of [1, -1]) {
    for (let i = 0; i < NSTRUT; i++) {
      const pts = [];
      for (let k = 0; k <= 12; k++) pts.push(ruling(i, fam, vStart + ((1 - vStart) * k) / 12));
      const a = (i / NSTRUT) * TAU;
      parts.push(tube(pts, (t) => strutRadius(vStart + (1 - vStart) * t), 10, { kind: 1, up: V3(-Math.cos(a), 0, -Math.sin(a)) }));
    }
  }
  // ring girders at crossing levels: each passes through the nodes of its level
  for (const k of [1, 2, 5, 8, 11, 18, 22, 26, 29]) {
    const yk = latticeY(nodeV(k)), lr = latticeRadius(yk);
    const pts = [];
    for (let s = 0; s < 256; s++) { const a = (s / 256) * TAU; pts.push(V3(Math.cos(a) * lr, yk, Math.sin(a) * lr)); }
    parts.push(tube(pts, () => 3, 8, { kind: 2, closed: true, up: V3(0, -1, 0) }));
  }
  // three power conduits climb the lattice just clear of the nodes, clamped to the struts they
  // cross, from inside the Root Deck to inside the Coronet
  const helixR = (y) => latticeRadius(y) + nodeReach(y) + 0.8 + 3.2;
  const hy0 = 583, hy1 = 2830, HS = 480;
  const theta = (y) => { const p = ruling(0, 1, THREE.MathUtils.clamp(latticeV(y), 0, 1)); return Math.atan2(p.z, p.x); };
  for (let h = 0; h < 3; h++) {
    const at = (u) => ({ y: hy0 + u * (hy1 - hy0), a: (h / 3) * TAU + u * TAU * 2.25 });
    const pts = [];
    for (let s = 0; s <= HS; s++) { const { y, a } = at(s / HS), r = helixR(y); pts.push(V3(Math.cos(a) * r, y, Math.sin(a) * r)); }
    parts.push(tube(pts, () => 3.2, 10, { kind: 4, up: V3(0, 1, 0) }));
    let run = 0, last = -1e9, prev = null;
    for (let s = 0; s <= HS; s++) {
      const { y, a } = at(s / HS), th = theta(y);
      const f = [((a - th) * NSTRUT) / TAU, ((a + th) * NSTRUT) / TAU];
      if (prev) {
        run += pts[s].distanceTo(pts[s - 1]);
        for (let q = 0; q < 2; q++) {
          if (Math.floor(f[q]) === Math.floor(prev[q]) || run - last < 38) continue;
          const w = (Math.floor(f[q]) - prev[q]) / (f[q] - prev[q]);
          const c = at((s - 1 + w) / HS), lr = latticeRadius(c.y);
          if (inDeck(lr, c.y, 8)) continue;
          const er = V3(Math.cos(c.a), 0, Math.sin(c.a)), et = V3(-Math.sin(c.a), 0, Math.cos(c.a));
          const r0 = lr + strutRadius(latticeV(c.y)) - 0.5, r1 = helixR(c.y) - 3.2 + 0.5;
          const pt = (r, tt, dy) => er.clone().multiplyScalar(r).addScaledVector(et, tt).add(V3(0, c.y + dy, 0));
          parts.push(prism([r0, r1].map((r) => [pt(r, -0.6, -0.8), pt(r, -0.6, 0.8), pt(r, 0.6, 0.8), pt(r, 0.6, -0.8)]), { kinds: [10, 10, 10, 10], capKind: 10 }));
          last = run;
        }
      }
      prev = f;
    }
  }
  // maintenance gantries: box girders from the core's service floors out to lattice nodes,
  // with parapets along the walkway
  gantryK.forEach((k, gi) => {
    const v = nodeV(k), yk = latticeY(v), rs = strutRadius(v);
    for (let q = 0; q < 4; q++) {
      const f = nodeFrame(q * 13 + [0, 4, 9][gi], k);
      const a = Math.atan2(f.p.z, f.p.x);
      const er = V3(Math.cos(a), 0, Math.sin(a)), et = V3(-Math.sin(a), 0, Math.cos(a));
      const rA = coreR(yk) - 1, rB = latticeRadius(yk) - 1.08 * rs + 1.2;
      const pt = (r, tt, yy) => er.clone().multiplyScalar(r).addScaledVector(et, tt).setY(yy);
      const box = (t0, t1, ya, yb) => [rA, rB].map((r) => [pt(r, t0, ya), pt(r, t0, yb), pt(r, t1, yb), pt(r, t1, ya)]);
      parts.push(prism(box(-1.7, 1.7, yk - 1.6, yk + 1.4), { kinds: [1, 9, 1, 1] }));
      parts.push(prism(box(-1.7, -1.4, yk + 1.3, yk + 2.5)), prism(box(1.4, 1.7, yk + 1.3, yk + 2.5)));
    }
  });

  // --------------------------------------------------------- root arches ----
  // Eight tusks from the plaza carry the Root Deck: each lands inside it (a horizontal head
  // among its girders), with an elliptical section deeper in the arch's own plane. Two tendrils
  // rise beside each one and merge into its flank.
  const archAt = (u) => V3(
    THREE.MathUtils.lerp(505, 318, Math.pow(u, 0.8)) + 120 * Math.sin(Math.PI * u) * (1 - u), PLAZA_Y - 4 + (584 - PLAZA_Y) * (1 - Math.pow(1 - u, 1.7)), 0);
  const archPts = [];
  for (let k = 0; k <= 48; k++) archPts.push(archAt(k / 48));
  const tendril = (side) => {
    const pts = [];
    for (let k = 0; k <= 32; k++) {
      const s = k / 32, p = archAt(s * 0.5);
      const r = p.x + 30 * (1 - smooth(0, 1, s)), d = side * 0.09 * (1 - smooth(0.35, 1, s));
      pts.push(V3(r * Math.cos(d), p.y, r * Math.sin(d)));
    }
    return tube(pts, (s) => 9 - 3.5 * s, 12, { kind: 1, up: V3(-1, 0, 0) });
  };
  const rootGeo = mergeClean([
    tube(archPts, (u) => 36 - 16 * u + 12 * Math.exp(-u * 14) - 11.5 * smooth(0.55, 1, u), 24, { kind: 1, ellipse: 0.72, up: V3(-1, 0, 0) }),
    tendril(1), tendril(-1),
  ]);
  for (let i = 0; i < 8; i++) parts.push(rootGeo.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(-((i / 8) * TAU + TAU / 16))));

  const structure = new THREE.Mesh(mergeClean(parts), boneMat);
  structure.castShadow = true;
  structure.receiveShadow = true;
  group.add(structure);

  // ---------------------------------------------------------- plaza --------
  // the Commons (plaza.js): built after the roots, whose footprints it cuts the pools around
  buildPlaza(group);

  // ----------------------------------------------- crossing nodes (instanced) --
  // A bossed node where every pair of rulings crosses (skipped where a deck swallows it), with
  // a lens that glows at night. They sink into the struts with distance and are gone beyond
  // 2.6 km, where they would be sub-pixel.
  const spots = [];
  for (let k = 1; k <= 30; k++) {
    const v = nodeV(k), yk = latticeY(v), rs = strutRadius(v), lr = latticeRadius(yk);
    if (inDeck(lr, yk - 1.4 * rs, 2) || inDeck(lr, yk + 1.4 * rs, 2) || inDeck(lr, yk, 2)) continue;
    for (let i = 0; i < NSTRUT; i++) spots.push(nodeFrame(i, k));
  }
  const nodeGeo = lathe([
    { kind: 1, v: 'r', pts: [P(0, -1.08), P(0.94, -1.08)] },
    { kind: 1, v: 's', pts: [P(0.94, -1.08), P(1.3, -0.6), P(1.3, 0.6), P(0.94, 1.08)] },
    { kind: 1, v: 'r', pts: [P(0.94, 1.08), P(0.52, 1.08)] },
    { kind: 2, v: 'r', pts: [P(0.52, 1.08), P(0.47, 1.14), P(0, 1.17)] },
  ], 12, { fs: 4.5 });
  const nodeMat = createFacadeMaterial('pearl', 105, { litFrac: 0.6 });
  {
    const h = nodeMat.userData.hooks;
    applyPatch(nodeMat, {
      ...h,
      key: 'facade3-axisnode',
      uniforms: { ...h.uniforms, uNodeNear: { value: 2600 } },
      vertex: {
        ...h.vertex,
        pars: `${h.vertex.pars}\nuniform float uNodeNear;`,
        transform: `${h.vertex.transform}
#ifdef USE_INSTANCING
{
  float dN = distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition);
  transformed *= mix(1.0, 0.6, smoothstep(uNodeNear * 0.72, uNodeNear, dN)) * step(dN, uNodeNear);
}
#endif`,
      },
    });
  }
  const nodes = new THREE.InstancedMesh(nodeGeo, nodeMat, spots.length);
  {
    const m4 = new THREE.Matrix4(), sc = new THREE.Vector3();
    spots.forEach((s, i) => nodes.setMatrixAt(i, m4.makeBasis(s.x, s.n, s.z).scale(sc.setScalar(strutRadius(s.v))).setPosition(s.p)));
  }
  nodes.castShadow = false;
  nodes.receiveShadow = true;
  group.add(nodes);

  // ------------------------------------------------------------ crown -------
  // Three counter-rotating stabiliser rings round the tether anchor. Each spins in its own
  // plane through carriages on a fixed frame: eight spokes from a hub on the neck carry the
  // outer ring's carriages, and the two spokes on the x axis also carry those of the tilted
  // rings, which cross the hub's plane exactly there. A lantern rail runs along each crest.
  const crown = new THREE.Group();
  crown.position.y = cY;
  group.add(crown);
  const gyroMat = createFacadeMaterial('pearl', 103, { litFrac: 0.8 });
  const gyros = [];
  const frame = [];
  const ringDefs = [
    { r: 250, tube: 11, tilt: 0.0, speed: 0.022, rail: 3.3 },
    { r: 205, tube: 8, tilt: 0.42, speed: -0.03, rail: 2.4 },
    { r: 165, tube: 7, tilt: -0.55, speed: 0.038, rail: 2.1 },
  ];
  for (const rd of ringDefs) {
    const ring = [], rail = [];
    for (let s = 0; s < 288; s++) {
      const a = (s / 288) * TAU;
      ring.push(V3(Math.cos(a) * rd.r, 0, Math.sin(a) * rd.r));
      rail.push(V3(Math.cos(a) * rd.r, rd.tube, Math.sin(a) * rd.r));
    }
    const m = new THREE.Mesh(mergeClean([
      tube(ring, () => rd.tube, 16, { kind: 1, closed: true, up: V3(0, -1, 0) }),
      tube(rail, () => rd.rail, 8, { kind: 2, closed: true, up: V3(0, -1, 0) }),
    ]), gyroMat);
    m.castShadow = true;
    m.receiveShadow = true;
    const holder = new THREE.Group();
    holder.rotation.x = rd.tilt;
    holder.add(m);
    crown.add(holder);
    gyros.push({ mesh: m, speed: rd.speed });
    // carriages (sleeves the ring runs through), fixed in the ring's plane
    const tilt = new THREE.Matrix4().makeRotationX(rd.tilt);
    for (const c of rd.tilt === 0 ? [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k / 8) * TAU) : [0, Math.PI]) {
      const arc = [], da = 9 / rd.r;
      for (let s = 0; s <= 6; s++) { const a = c - da + (2 * da * s) / 6; arc.push(V3(Math.cos(a) * rd.r, 0, Math.sin(a) * rd.r)); }
      frame.push(tube(arc, () => rd.tube + rd.rail + 1, 16, { kind: 1, up: V3(0, -1, 0) }).applyMatrix4(tilt));
    }
  }
  // spokes from the hub to the outer carriages (the x-axis pair through the tilted rings' ones)
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const pts = [];
    for (let s = 0; s <= 8; s++) { const r = 26 + ((250 - 26) * s) / 8; pts.push(V3(ca * r, 0, sa * r)); }
    frame.push(tube(pts, (t) => 4.2 - 1.6 * t, 12, { kind: 1, ellipse: 0.55, up: V3(0, 1, 0) }));
  }
  // the hub, fixed to the neck, with a lantern round its rim
  frame.push(lathe([
    { kind: 1, v: 'r', pts: [P(13, -7), P(27, -7)] },
    { kind: 2, v: 'y', pts: [P(27, -7), P(31, -4.8), P(31, 4.8), P(27, 7)] },
    { kind: 1, v: 'r', pts: [P(27, 7), P(13, 7)] },
    { kind: 1, v: 'y', pts: [P(13, 7), P(13, -7)] },
  ], 64));
  // the anchor node: coffered underside, lantern rim, observation gallery, cornice, upper cone
  // and the anchor collar that closes on the tether
  frame.push(lathe([
    { kind: 1, v: 's', pts: [P(13.5, 10), P(26, 12), P(44, 17), P(54, 21.5)] },
    { kind: 2, v: 'y', pts: [P(54, 21.5), P(57.5, 23.5), P(58.5, 26), P(58, 28)] },
    { kind: 0, v: 'y', vOff: 7, pts: [P(58, 28), P(56.5, 40)] },
    { kind: 1, v: 'y', pts: [P(56.5, 40), P(57, 41.2), P(55.5, 43), P(50, 46)] },
    { kind: 1, v: 's', pts: [P(50, 46), P(32, 60), P(20, 72)] },
    { kind: 10, v: 'y', pts: [P(20, 72), P(16, 78), P(12.5, 90), P(11, 118), P(9, 121)] },
    { kind: 10, v: 'r', pts: [P(9, 121), P(5.5, 121.6)] },
  ], 96));
  // the climber dock: four guide rails on the tether's tracks, braced by lit rings; a climber
  // waits inside it between runs, beacons on the rail heads
  const cageR = 18.5, cage0 = 70, cage1 = 216;
  for (let q = 0; q < 4; q++) {
    const a = (q / 4) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    frame.push(tube([V3(ca * cageR, cage0, sa * cageR), V3(ca * cageR, cage1, sa * cageR)], () => 1.4, 10, { kind: 10, caps: 'round', up: V3(ca, 0, sa) }));
    beaconPts.push(ca * cageR, cY + cage1 + 1.2, sa * cageR);
  }
  for (const yy of [130, 173, cage1 - 1]) {
    const pts = [];
    for (let s = 0; s < 64; s++) { const a = (s / 64) * TAU; pts.push(V3(Math.cos(a) * cageR, yy, Math.sin(a) * cageR)); }
    frame.push(tube(pts, () => 0.9, 8, { kind: 2, closed: true, up: V3(0, -1, 0) }));
  }
  const crownFrame = new THREE.Mesh(mergeClean(frame), gyroMat);
  crownFrame.castShadow = true;
  crownFrame.receiveShadow = true;
  crown.add(crownFrame);

  // --------------------------------------------------- tether & climbers ---
  const tetherTop = 45000;
  const tetherGeo = new THREE.CylinderGeometry(3.5, 6, tetherTop - AXIS.anchorY, 12, 1, true);
  tetherGeo.translate(0, (tetherTop + AXIS.anchorY) / 2, 0);
  // The tether seen from the city: a dark braided nanotube ribbon with four polished climber
  // tracks, white collars every 400 m, guide lights racing up the tracks at night, red and
  // white beacons, lit by the real sun and hazed by the same aerial perspective as the city.
  const tetherMat = aerialShaderMaterial({
    vertexShader: /* glsl */ `
varying float vY; varying vec3 vN; varying vec3 vW; varying float vA;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vY = w.y; vA = atan(position.z, position.x); vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
varying float vY; varying vec3 vN; varying vec3 vW; varying float vA;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float fw = max(length(fwidth(vW)), 1e-3);            // metres per pixel
  float rad = mix(6.0, 3.5, clamp((vY - 3140.0) / 41860.0, 0.0, 1.0));
  float q = fract(vA / 6.28318 * 4.0 + 0.5);
  float dq = abs(q - 0.5) * 6.28318 * rad / 4.0;         // metres from the nearest track's centre
  float track = 1.0 - smoothstep(0.9 - fw, 0.9 + fw, dq);
  float led = 1.0 - smoothstep(0.07, 0.07 + fw, dq);
  float cy = abs(mod(vY + 200.0, 400.0) - 200.0);
  float collar = 1.0 - smoothstep(1.2, 1.2 + fw, cy);
  float sd = 1.0 - smoothstep(0.03, 0.2, fw);
  float strand = vnoise(vec2(vA * rad * 5.0 + vY * 0.3, vY * 0.015)) * 0.6 + vnoise(vec2(vA * rad * 17.0 - vY * 0.8, vY * 0.05)) * 0.4;
  vec3 alb = vec3(0.1, 0.105, 0.115) * mix(1.0, 0.75 + 0.5 * strand, sd);
  alb = mix(alb, vec3(0.55, 0.57, 0.6), track);
  alb = mix(alb, vec3(0.82, 0.82, 0.8), collar);
  float metal = track * (1.0 - collar);
  vec3 sunC = uSunColor * uSunIlluminance;
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 H = normalize(V + uSunDir);
  float spec = pow(max(dot(N, H), 0.0), mix(30.0, 220.0, metal)) * mix(0.25, 3.0, metal);
  vec3 F0 = mix(vec3(0.04), alb, metal);
  vec3 col = alb * (1.0 - 0.8 * metal) / 3.14159 * (sunC * ndl + aerialInscatter(vec3(0.0, 1.0, 0.0)) * 1.2);
  col += F0 * spec * sunC * ndl;
  col += F0 * aerialInscatter(reflect(-V, N)) * (0.3 + 0.7 * metal);
  // guide lights race up the tracks; beacons every 120 m
  float lights = uCityLights;
  float pulse = pow(fract(vY / 2400.0 - uTime * 0.12), 14.0);
  col += vec3(0.55, 0.85, 1.0) * led * (0.04 + 0.5 * lights) * (0.3 + 3.0 * pulse);
  float beacon = step(0.985, fract(vY / 120.0)) * (0.6 + 0.4 * sin(uTime * 4.0));
  col += mix(vec3(1.0, 0.18, 0.1), vec3(1.0, 0.85, 0.6), step(0.5, fract(vY / 240.0))) * beacon * (1.0 + 3.0 * lights) * (1.0 - track);
  col = applyAerial(col, vW);
  float fade = 1.0 - smoothstep(34000.0, 44000.0, vY);
  gl_FragColor = vec4(col * fade, fade);
}`,
    transparent: true,
  });
  const tether = new THREE.Mesh(tetherGeo, tetherMat);
  tether.frustumCulled = false;
  group.add(tether);
  // the halo glows round the tether above the climber dock
  const haloY = cY + cage1 + 4;
  const halo = new THREE.Mesh(new THREE.CylinderGeometry(40, 60, tetherTop - haloY, 16, 1, true).translate(0, (tetherTop + haloY) / 2, 0), glowMaterial(0x6fb4ff, 0.07, { fresnelPow: 3.0, nightOnly: 0.97 }));
  halo.frustumCulled = false;
  group.add(halo);

  // climber pods: capsules riding the tether, from a berth inside the dock cage
  const podGeo = mergeClean([
    latheFacade([{ r: 0.1, y: -34, kind: 1 }, { r: 10, y: -26, kind: 1 }, { r: 14, y: -8, kind: 0 }, { r: 14, y: 8, kind: 2 }, { r: 10, y: 26, kind: 0 }, { r: 0.1, y: 34, kind: 1 }], 24),
  ]);
  const pods = [];
  const podMat = createFacadeMaterial('silver', 104, { litFrac: 0.9, band: 1e5, colW: 2.6, floorH: 3.4 });
  const podBase = cY + 160;
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(podGeo, podMat);
    m.castShadow = true;
    group.add(m);
    const light = new THREE.Mesh(new THREE.SphereGeometry(22, 12, 8), glowMaterial(i % 2 ? 0xffc890 : 0x9fd4ff, 1.2, { fresnelPow: 1.5, nightOnly: 0.3 }));
    m.add(light);
    pods.push({ mesh: m, phase: i / 7, dir: i % 2 ? -1 : 1, speed: 0.012 + (i % 3) * 0.002 });
  }

  updaters.push({
    update(dt, t) {
      // the rings counter-rotate in their own planes (through the fixed carriages)
      for (const g of gyros) g.mesh.rotation.y = g.speed * t;
      for (const p of pods) {
        // travel up/down between the dock and 40 km with smooth easing near the ends
        const s = (p.phase + t * p.speed * p.dir) % 1;
        const u = s < 0 ? s + 1 : s;
        p.mesh.position.set(0, podBase + Math.pow(u, 2.2) * 38000, 0);
      }
    },
  });

  const colliders = [
    { x: 0, z: 0, y0: 0, y1: AXIS.crownY + 100, radius: (y) => coreRadius(y) + 10 },
    { x: 0, z: 0, y0: AXIS.crownY - 60, y1: cY + cage1 + 10, radius: 70 },
  ];
  return { group, decks, colliders, beacons: beaconPts, reflectHide: [halo, tether] };
}
