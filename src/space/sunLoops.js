import * as THREE from 'three';
import { LAMP_UNIFORMS } from './lamps.js';

// Coronal loops over the Sun's active regions (km, the Sun's frame, radius 696,000 km).
//
// Each sunspot group carries an arcade of magnetic loops from its leader to its follower
// polarity: fourteen arches stepped across the group, the inner ones low and tight, the outer
// ones tall and splayed, each a little tilted. They are drawn as camera-facing ribbons whose
// width never falls below a pixel and a bit (their light then spread to keep its energy),
// glowing gold, brightest at the footpoints and along threads of plasma draining down both
// legs. Behind the limb the Sun's disc hides them; over the limb they stand against the dark.
// Now and then one region flares: its arcade brightens for a few seconds and fades.

export const R_SUN = 696000;
export const LOOPS = { perGroup: 14, seg: 28, flareEvery: 90, flareDecay: 9 };

const VERT = /* glsl */ `
attribute vec3 aT;        // centreline tangent (sun frame)
attribute vec4 aP;        // x: along 0..1, y: side -1..1, z: group + seed (fraction), w: half width (km)
uniform vec2 uRes;
varying vec2 vUv;
varying float vSeed;
varying float vI;
void main() {
  vec4 c = modelViewMatrix * vec4(position, 1.0);
  vec3 t = mat3(modelViewMatrix) * aT;
  vec3 side = cross(t, c.xyz);
  float sl = length(side);
  side = sl > 1e-12 ? side / sl : vec3(1.0, 0.0, 0.0);
  float s = length(modelViewMatrix[0].xyz);
  float dist = max(-c.z, 1e-3);
  float pxPerUnit = uRes.y * 0.5 * projectionMatrix[1][1] / dist;
  float w = aP.w * s;
  float ww = max(w, 1.2 / max(pxPerUnit, 1e-12));
  vI = clamp(w / ww, 0.0, 1.0);
  c.xyz += side * aP.y * ww;
  vUv = aP.xy;
  vSeed = aP.z;
  gl_Position = projectionMatrix * c;
}
`;
const FRAG = /* glsl */ `
uniform float uTime;
uniform float uDiscL;
uniform float uGain;
uniform float uFlarePeriod;
uniform float uFlareDecay;
varying vec2 vUv;
varying float vSeed;
varying float vI;
void main() {
  float y = vUv.y;
  float core = exp(-y * y * 5.0) * (1.0 - y * y);
  float u = vUv.x;
  float grp = floor(vSeed);
  float sd = vSeed - grp;
  // plasma draining down both legs from the apex, in threads
  float drain = fract(abs(u - 0.5) * 7.0 - uTime * 0.06 + sd * 3.0);
  float thread = 0.55 + 0.45 * smoothstep(0.0, 0.15, drain) * (1.0 - smoothstep(0.15, 0.6, drain));
  // footpoints glow; the legs fade into the chromosphere at the very ends
  float foot = 1.0 + 1.6 * exp(-min(u, 1.0 - u) * 18.0);
  float ends = smoothstep(0.0, 0.02, u) * (1.0 - smoothstep(0.98, 1.0, u));
  // a flare in one region at a time
  float cycle = uTime / uFlarePeriod;
  float which = mod(floor(cycle), 8.0);
  float age = fract(cycle) * uFlarePeriod;
  float flare = abs(grp - which) < 0.5 ? 2.5 * exp(-age / uFlareDecay) * smoothstep(0.0, 0.6, age) : 0.0;
  float twinkle = 0.9 + 0.1 * sin(uTime * 0.7 + sd * 40.0);
  vec3 col = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.9, 0.75), clamp(flare * 0.4, 0.0, 1.0));
  vec3 c = col * core * thread * foot * ends * twinkle * (1.0 + flare) * vI * uDiscL * uGain;
  if (c.r + c.g + c.b < 1e-6) discard;
  gl_FragColor = vec4(c, 0.0);
}
`;

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** Loop centrelines: [{ pts: [Vector3] (km), group, seed, w (half width, km) }] for spot groups (unit centre + angular size, unit axis). */
export function loopLines(spots, axes) {
  const r = rng(4242), out = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), f = new THREE.Vector3(), d = new THREE.Vector3();
  spots.forEach((sp, g) => {
    const c = new THREE.Vector3(sp.x, sp.y, sp.z).normalize(), s = sp.w;
    const e = new THREE.Vector3(axes[g].x, axes[g].y, axes[g].z).normalize();
    f.crossVectors(c, e).normalize();
    for (let j = 0; j < LOOPS.perGroup; j++) {
      const q = (j + 0.5) / LOOPS.perGroup - 0.5;                    // -0.5 .. 0.5 across the group
      const spread = 0.35 + 0.9 * Math.abs(q) + 0.15 * r();            // outer loops splay wider
      const across = q * s * 1.1;
      A.copy(c).addScaledVector(e, -spread * s * 0.9).addScaledVector(f, across + (r() - 0.5) * s * 0.08).normalize();
      B.copy(c).addScaledVector(e, spread * s * 0.95).addScaledVector(f, across * 1.2 + (r() - 0.5) * s * 0.08).normalize();
      const sep = A.angleTo(B);
      const h = sep * (0.35 + 0.25 * r() + 0.3 * Math.abs(q));        // apex height (in R) grows with the span
      const tilt = (r() - 0.5) * 0.5;
      const pts = [];
      for (let i = 0; i <= LOOPS.seg; i++) {
        const u = i / LOOPS.seg, a = Math.sin(Math.PI * u);
        d.copy(A).lerp(B, u).normalize().addScaledVector(f, tilt * h * a).normalize();
        pts.push(d.clone().multiplyScalar(R_SUN * (1 + h * a)));
      }
      out.push({ pts, group: g, seed: r() * 0.999, w: 700 + 600 * r() });
    }
  });
  return out;
}

/** The loops' ribbon mesh (sun frame, km); uniforms: the Sun's { uTime, uDiscL }. */
export function createSunLoops(spots, axes, uniforms) {
  const lines = loopLines(spots, axes);
  const vpl = (LOOPS.seg + 1) * 2, n = lines.length * vpl;
  const P = new Float32Array(n * 3), T = new Float32Array(n * 3), A = new Float32Array(n * 4), idx = [];
  const t = new THREE.Vector3();
  lines.forEach((ln, k) => {
    for (let i = 0; i <= LOOPS.seg; i++) {
      const a = ln.pts[Math.max(i - 1, 0)], b = ln.pts[Math.min(i + 1, LOOPS.seg)];
      t.subVectors(b, a).normalize();
      for (let sd = 0; sd < 2; sd++) {
        const v = k * vpl + i * 2 + sd, p = ln.pts[i];
        P.set([p.x, p.y, p.z], v * 3); T.set([t.x, t.y, t.z], v * 3);
        A.set([i / LOOPS.seg, sd ? 1 : -1, ln.group + ln.seed, ln.w], v * 4);
      }
    }
    for (let i = 0; i < LOOPS.seg; i++) { const v = k * vpl + i * 2; idx.push(v, v + 1, v + 3, v, v + 3, v + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(T, 3));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(A, 4));
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uRes: LAMP_UNIFORMS.uRes, uTime: uniforms.uTime, uDiscL: uniforms.uDiscL, uGain: { value: 0.05 },
      uFlarePeriod: { value: LOOPS.flareEvery }, uFlareDecay: { value: LOOPS.flareDecay },
    },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, premultipliedAlpha: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = 19;
  mesh.userData.lines = lines;
  return mesh;
}
