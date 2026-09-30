import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { CK, V3, TAU, smooth, lerp, rng, finish, stock, tube, rod, box, bbox, revolve } from './lodestarKit.js';

// The Lodestar's flight deck: a glazed bubble on a streamlined pedestal amidships, where the
// bridge camera sits (BRIDGE_EYE, the pilot's eye). The canopy is real glass (a transparent,
// Fresnel-weighted skin that mirrors the sky and throws the Sun's glint) held by bronze frame
// struts, and through it the deck is furnished: a curved main console with its screens, side
// stations, three seats, a rear bulkhead with its hatch, floor lighting. Nothing is built within
// NEAR_CLEAR of the eye ahead of it (the orbital camera's near plane sits ~1.35 m out).

export const BRIDGE_EYE = V3(0, 4.3, -1.5);
export const NEAR_CLEAR = 1.42;
const BELT = 3.6, FLOOR = 2.85, Z_FRONT = -4.45, Z_AFT = 4.4, Z_GLASS = -0.05;

/** The pod's section at z: centre (widest) height, rise above it, drop below it, half-width. */
export function podSec(z) {
  let e = 1;
  if (z < -1.2) e = Math.sqrt(Math.max(1 - ((z + 1.2) / (-1.2 - Z_FRONT)) ** 2, 0));
  const s = smooth(0.6, Z_AFT, z);
  const yc = lerp(BELT, 1.95, s), up = lerp(2.3, 0.18, s) * e, W = lerp(2.0, 0.4, s) * e;
  return { yc, up, dn: yc - 1.15, W };
}
/** Point on the pod at z and section angle th (0 starboard belt, pi/2 top, -pi/2 bottom). */
export function podPt(z, th, off = 0) {
  const S = podSec(z), c = Math.cos(th), s = Math.sin(th);
  const x = S.W * Math.sign(c) * Math.pow(Math.abs(c), s > 0 ? 0.82 : 0.2);
  const y = s > 0 ? S.yc + S.up * s : S.yc - S.dn * Math.pow(Math.abs(s), 0.33);
  const p = V3(x, y, z);
  if (off) {
    const q = podPt(z, th + 1e-3), tx = q.x - p.x, ty = q.y - p.y, L = Math.hypot(tx, ty) || 1;
    p.x += (ty / L) * off; p.y += (-tx / L) * off;
  }
  return p;
}

/** Parametric surface over z in [z0, z1] and th in [th0, th1]; keep(z, th) selects quads. */
function podSurface(z0, z1, th0, th1, nz, nt, kind, keep = () => true, off = 0) {
  const pos = [], fac = [], idx = [], W = nt + 1;
  for (let j = 0; j <= nz; j++) {
    const z = lerp(z0, z1, j / nz);
    for (let i = 0; i <= nt; i++) {
      const th = lerp(th0, th1, i / nt), p = podPt(z, th, off);
      pos.push(p.x, p.y, p.z);
      fac.push(th * 3.0, z * 2.0, typeof kind === 'function' ? kind(z, th) : kind);
    }
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nt; i++) {
    const zm = lerp(z0, z1, (j + 0.5) / nz), tm = lerp(th0, th1, (i + 0.5) / nt);
    if (!keep(zm, tm)) continue;
    const a = j * W + i, b = a + 1, c = a + W + 1, d = a + W;
    idx.push(a, b, c, a, c, d);                                   // outward: round (+th) x along (+z)
  }
  const g = finish(pos, fac, idx, { noOrient: true, noWeld: false });
  return g;
}
const glazed = (z, th) => z < Z_GLASS && th > 0.035 && th < Math.PI - 0.035;

// ----------------------------------------------------------------- glass --
const GLASS_VERT = /* glsl */ `
varying vec3 vView; varying vec3 vN;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz; vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;
const GLASS_FRAG = /* glsl */ `
uniform vec3 uSunView; uniform float uSunE; uniform vec3 uUpView;
varying vec3 vView; varying vec3 vN;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(-vView);
  if (dot(N, V) < 0.0) N = -N;
  float cosT = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
  vec3 R = reflect(-V, N);
  // the mirrored sky: black space, a faint blue limb glow from below (the Earth), a warm haze toward the Sun
  float up = dot(R, uUpView);
  vec3 sky = vec3(0.004, 0.006, 0.01) + vec3(0.03, 0.05, 0.09) * smoothstep(0.2, -0.6, up);
  float sd = max(dot(R, uSunView), 0.0);
  vec3 glint = vec3(1.0, 0.96, 0.9) * (pow(sd, 900.0) * 60.0 + pow(sd, 40.0) * 0.25);
  vec3 col = (sky + glint) * uSunE * F + vec3(0.01, 0.014, 0.018) * uSunE * 0.02;
  float a = clamp(0.1 + F * 0.85 + length(glint) * 0.02, 0.0, 0.95);
  gl_FragColor = vec4(col, a);
}`;

// --------------------------------------------------------------- screens --
const SCREEN_VERT = /* glsl */ `
attribute float aSeed;
varying vec2 vUv; varying float vSeed;
void main() {
  vUv = uv; vSeed = aSeed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SCREEN_FRAG = /* glsl */ `
uniform float uTime; uniform float uOn; uniform float uGain;
varying vec2 vUv; varying float vSeed;
float hsh(float x) { return fract(sin(x * 91.7 + 3.1) * 43758.5453); }
void main() {
  vec2 q = vUv;
  float h = hsh(vSeed), h2 = hsh(vSeed + 7.3);
  vec3 ink = h2 < 0.55 ? vec3(0.35, 0.85, 1.0) : (h2 < 0.85 ? vec3(1.0, 0.72, 0.3) : vec3(0.5, 1.0, 0.6));
  float inset = step(0.035, q.x) * step(q.x, 0.965) * step(0.05, q.y) * step(q.y, 0.95);
  vec3 col = vec3(0.004, 0.01, 0.016);
  float grid = max(step(0.97, fract(q.x * 8.0)), step(0.96, fract(q.y * 6.0))) * 0.12;
  float mode = floor(h * 4.0);
  float fx = 0.0;
  if (mode < 0.5) {
    // a scrolling trace
    float y = 0.5 + 0.28 * sin(q.x * 9.0 + uTime * 1.3 + h * 20.0) * sin(q.x * 3.1 - uTime * 0.4);
    fx = 1.0 - smoothstep(0.0, 0.03, abs(q.y - y));
  } else if (mode < 1.5) {
    // bars
    float b = floor(q.x * 10.0);
    float v = 0.2 + 0.7 * fract(sin(b * 12.9 + floor(uTime * 1.5 + h * 9.0) * 3.7) * 43758.5);
    fx = step(q.y, v) * step(0.15, fract(q.x * 10.0)) * 0.7;
  } else if (mode < 2.5) {
    // a situation plot: rings about a centre, a sweep
    vec2 c = q - 0.5; c.x *= 1.6;
    float r = length(c), an = atan(c.y, c.x);
    fx = max(step(0.985, fract(r * 6.0)) * 0.5, (1.0 - smoothstep(0.0, 0.25, fract((an / 6.2832) - uTime * 0.25))) * step(r, 0.48) * 0.6);
    fx = max(fx, step(r, 0.02));
  } else {
    // text lines
    float line = floor(q.y * 12.0), ch = floor(q.x * 28.0);
    float on = step(0.35, fract(sin(line * 7.1 + ch * 1.7 + h * 40.0) * 4375.5)) * step(fract(q.y * 12.0), 0.6) * step(0.2, fract(q.x * 28.0));
    fx = on * step(ch, 10.0 + 17.0 * fract(sin(line * 3.3 + h) * 999.0)) * 0.55;
  }
  col += ink * (fx + grid) * inset;
  col += ink * 0.05 * inset;
  gl_FragColor = vec4(col * uOn * uGain, 1.0);
}`;

/** Screen quad (w x h), facing +Z, with a seed. */
function screenQuad(w, h, seed) {
  const g = new THREE.PlaneGeometry(w, h);
  const n = g.attributes.position.count;
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Array(n).fill(seed), 1));
  g.deleteAttribute('normal');
  return g;
}

/** A seat: pedestal, cushion, back and headrest, armrests; built facing -Z at the origin (floor). */
function seat() {
  const g = [];
  g.push(revolve([[0.0, 0.0, CK.DARK], [0.2, 0.0, CK.DARK], [0.12, 0.08, CK.DARK], [0.08, 0.38, CK.BRONZE], [0.0, 0.38, CK.BRONZE]], 12).rotateX(-Math.PI / 2));
  g.push(bbox(0.56, 0.12, 0.54, 0.04, CK.DARK, V3(0, 0.46, -0.02)));
  g.push(bbox(0.54, 0.72, 0.1, 0.04, CK.DARK, V3(0, 0.86, 0.26), new THREE.Euler(-0.18, 0, 0)));
  g.push(bbox(0.3, 0.2, 0.1, 0.04, CK.DARK, V3(0, 1.32, 0.36), new THREE.Euler(-0.18, 0, 0)));
  for (const s of [1, -1]) g.push(bbox(0.07, 0.07, 0.42, 0.02, CK.BRONZE, V3(s * 0.31, 0.64, 0.0)));
  return g;
}

/**
 * Build the flight deck. Returns { base: [geo] (the pod shell and canopy frame), detail: [geo]
 * (the interior, close-up only), glass: Mesh, screens: Mesh, lampsAt: [...] }.
 */
export function buildBridge() {
  const base = [], detail = [];
  // ---- the pod: opaque skin everywhere but the glazing
  base.push(podSurface(Z_FRONT, Z_AFT, -Math.PI / 2, Math.PI * 1.5, 64, 72, (z, th) => (Math.abs(th - Math.PI / 2) < 0.02 && z > 0 ? CK.DARK : CK.HULL), (z, th) => !glazed(z, th)));
  // the glass
  const gGlass = podSurface(Z_FRONT, Z_GLASS, 0.035, Math.PI - 0.035, 40, 48, CK.GLASS);
  gGlass.deleteAttribute('aFacade');

  // ---- canopy frame: the belt rails, hoops, three longitudinal struts, the aft frame
  const along = (th, zA, zB, r, k, off = 0.02) => { const pts = []; for (let j = 0; j <= 16; j++) pts.push(podPt(lerp(zA, zB, j / 16), th, off)); return tube(pts, r, k, 8, 2); };
  const hoop = (z, r, k, off = 0.02) => { const pts = []; for (let j = 0; j <= 20; j++) pts.push(podPt(z, lerp(0.02, Math.PI - 0.02, j / 20), off)); return tube(pts, r, k, 8, 2); };
  for (const th of [0.03, Math.PI - 0.03]) base.push(along(th, Z_FRONT + 0.05, Z_GLASS + 0.05, 0.075, CK.BRONZE, 0.03));
  for (const th of [Math.PI / 2, Math.PI / 2 + 0.62, Math.PI / 2 - 0.62]) base.push(along(th, Z_FRONT + (th === Math.PI / 2 ? 0.25 : 0.6), Z_GLASS, 0.055, CK.BRONZE));
  for (const z of [-3.45, -2.25, -1.0]) base.push(hoop(z, 0.05, CK.BRONZE));
  base.push(hoop(Z_GLASS + 0.02, 0.09, CK.DARK, 0.03));
  // a sill trim and the pod's belt light bar below the glazing
  for (const th of [-0.06, Math.PI + 0.06]) base.push(along(th, Z_FRONT + 0.2, Z_AFT - 1.2, 0.035, CK.CONDUIT, 0.02));
  // wipers of the dust age: a sun visor rail across the top, sensor pods and a mast on the roof
  base.push(bbox(0.5, 0.14, 1.4, 0.05, CK.DARK, podPt(1.1, Math.PI / 2, 0.07)));
  {
    const m = podPt(1.4, Math.PI / 2);
    base.push(stock(new THREE.CylinderGeometry(0.06, 0.09, 1.3, 10), CK.DARK).translate(m.x, m.y + 0.62, m.z));
    base.push(revolve([[0.0, -0.18, CK.DARK], [0.16, -0.14, CK.HULL], [0.18, 0.0, CK.HULL], [0.16, 0.14, CK.HULL], [0.0, 0.18, CK.DARK]], 14).rotateX(Math.PI / 2).translate(m.x, m.y + 1.35, m.z));
    for (const s of [1, -1]) {
      base.push(rod(V3(m.x, m.y + 1.0, m.z), V3(m.x + s * 0.55, m.y + 1.05, m.z + 0.1), 0.025, CK.DARK, 6));
      base.push(bbox(0.16, 0.16, 0.3, 0.04, CK.BRONZE, V3(m.x + s * 0.6, m.y + 1.05, m.z + 0.1)));
    }
    // whip antennas and a star tracker aft on the roof
    for (const [x, z, h] of [[0.6, 2.2, 1.2], [-0.6, 2.4, 0.9]]) { const p = podPt(z, Math.PI / 2); detail.push(stock(new THREE.CylinderGeometry(0.012, 0.03, h, 6), CK.DARK).translate(x * podSec(z).W / 2, p.y + h / 2 - 0.05, z)); }
    // the comms dish on a gimballed mast over the pod's tail: a yoke, the reflector with its ribs,
    // a feed on three struts
    {
      const b = podPt(2.5, Math.PI / 2), top = V3(0, b.y + 0.95, b.z);
      base.push(stock(new THREE.CylinderGeometry(0.09, 0.14, 1.0, 12), CK.DARK).translate(0, b.y + 0.45, b.z));
      base.push(stock(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 16), CK.BRONZE).translate(0, b.y + 0.9, b.z));
      for (const sx of [1, -1]) base.push(box(0.06, 0.5, 0.12, CK.DARK, V3(sx * 0.62, top.y + 0.2, top.z)));
      base.push(box(1.3, 0.08, 0.14, CK.DARK, V3(0, top.y, top.z)));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.75, 0.4, 0));
      const at = top.clone().add(V3(0, 0.4, 0));
      const M = new THREE.Matrix4().compose(at, q, V3(1, 1, 1));
      base.push(revolve([[0.0, 0.0, CK.HULL], [0.3, 0.02, CK.HULL], [0.62, 0.1, CK.HULL], [0.9, 0.24, CK.HULL], [0.95, 0.27, CK.BRONZE], [0.9, 0.3, CK.DARK], [0.45, 0.14, CK.DARK], [0.0, 0.1, CK.DARK]], 36).applyMatrix4(M));
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; base.push(rod(V3(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.08), V3(Math.cos(a) * 0.88, Math.sin(a) * 0.88, 0.28), 0.018, CK.DARK, 5).applyMatrix4(M)); }
      const feed = V3(0, 0, 0.75);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; base.push(rod(V3(Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0.26), feed, 0.015, CK.DARK, 5).applyMatrix4(M)); }
      base.push(revolve([[0.0, 0.6, CK.DARK], [0.08, 0.62, CK.BRONZE], [0.07, 0.8, CK.BRONZE], [0.0, 0.82, CK.DARK]], 12).applyMatrix4(M));
    }
    const st = podPt(3.7, Math.PI / 2);
    base.push(bbox(0.34, 0.26, 0.34, 0.05, CK.DARK, V3(0, st.y + 0.12, st.z)));
    base.push(revolve([[0.08, 0.0, CK.DARK], [0.1, 0.12, CK.BRONZE], [0.12, 0.26, CK.BRONZE], [0.0, 0.26, CK.DARK]], 12).rotateX(-Math.PI / 2 + 0.5).translate(0, st.y + 0.25, st.z));
  }

  // ---- interior (close-up only): floor, consoles, seats, bulkhead, floor lights
  const E = BRIDGE_EYE;
  {
    // floor: a slab following the pod's width at floor height
    const rings = [];
    for (let j = 0; j <= 20; j++) {
      const z = lerp(-4.15, 0.95, j / 20), S = podSec(z), w = Math.max(S.W - 0.08, 0.05);
      rings.push([V3(w, FLOOR, z), V3(-w, FLOOR, z), V3(-w, FLOOR - 0.08, z), V3(w, FLOOR - 0.08, z)]);
    }
    const fl = [];
    for (const r of rings) fl.push(r);
    detail.push(finishLoft(fl, CK.DECK));
    // floor lights along both edges
    for (const s of [1, -1]) {
      const pts = []; for (let j = 0; j <= 10; j++) { const z = lerp(-3.6, 0.7, j / 10); pts.push(V3(s * (podSec(z).W - 0.16), FLOOR + 0.02, z)); }
      detail.push(tube(pts, 0.018, CK.LANTERN, 6, 2));
    }
  }
  // main console: an arc of stations ahead of the eye
  const screens = [];
  let seed = 1;
  const addScreen = (w, h, m) => { const g = screenQuad(w, h, seed++); g.applyMatrix4(m); screens.push(g); };
  {
    const R0 = 1.55, n = 5;
    for (let i = 0; i < n; i++) {
      const ang = (i - (n - 1) / 2) * 0.33;                  // bearing from dead ahead
      const dir = V3(Math.sin(ang), 0, -Math.cos(ang));
      const c = V3(E.x, FLOOR, E.z).addScaledVector(dir, R0 + 0.3);
      const q = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), -ang);
      const M = (x, y, z, rx = 0) => new THREE.Matrix4().compose(c.clone().add(V3(x, y, z).applyQuaternion(q)), q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), rx)), V3(1, 1, 1));
      // body: a plinth, a sloped desk, an instrument hood
      detail.push(bbox(0.6, 0.62, 0.58, 0.04, CK.DARK).applyMatrix4(M(0, 0.31, 0)));
      detail.push(bbox(0.62, 0.07, 0.62, 0.025, CK.HULL).applyMatrix4(M(0, 0.7, 0.02, 0.42)));
      detail.push(bbox(0.62, 0.46, 0.14, 0.03, CK.DARK).applyMatrix4(M(0, 0.98, -0.28, -0.25)));
      detail.push(bbox(0.64, 0.05, 0.3, 0.02, CK.BRONZE).applyMatrix4(M(0, 1.22, -0.26, 0.0)));
      addScreen(0.5, 0.4, M(0, 0.745, 0.02, -1.15));
      addScreen(0.5, 0.34, M(0, 0.985, -0.197, -0.25));
      // a key strip and two small knobs on the desk edge
      detail.push(box(0.46, 0.02, 0.06, CK.BRONZE).applyMatrix4(M(0, 0.63, 0.3, 0.42)));
      for (const s of [-0.22, 0.22]) detail.push(stock(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 10), CK.BRONZE).applyMatrix4(M(s, 0.66, 0.26)));
    }
    // side stations along the walls, facing inboard
    for (const s of [1, -1]) {
      for (const z of [-2.0, -1.2]) {
        const w = podSec(z).W, x = s * (w - 0.35);
        const q = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), -s * Math.PI / 2);
        const M = (xx, y, zz, rx = 0) => new THREE.Matrix4().compose(V3(x, FLOOR, z).add(V3(xx, y, zz).applyQuaternion(q)), q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), rx)), V3(1, 1, 1));
        detail.push(bbox(0.7, 0.8, 0.4, 0.04, CK.DARK).applyMatrix4(M(0, 0.4, 0)));
        detail.push(bbox(0.72, 0.06, 0.46, 0.02, CK.HULL).applyMatrix4(M(0, 0.84, 0.03, 0.3)));
        addScreen(0.6, 0.36, M(0, 0.88, 0.03, -1.27));
      }
    }
    // three seats: the pilot's (under the eye, behind it) and two stations aft of the console wings
    for (const [x, z, yaw] of [[0, -0.95, 0], [1.2, -0.3, -0.3], [-1.2, -0.3, 0.3]]) {
      const m = new THREE.Matrix4().compose(V3(x, FLOOR, z), new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), yaw), V3(1, 1, 1));
      for (const g of seat()) detail.push(g.applyMatrix4(m));
    }
    // the rear bulkhead with its hatch and a frame round it
    {
      const z = 0.95, S = podSec(z), rings = [];
      const w = S.W - 0.05, top = S.yc + S.up * 0.97;
      detail.push(box(w * 2, top - FLOOR, 0.08, CK.HULL, V3(0, (top + FLOOR) / 2, z)));
      detail.push(bbox(0.95, 1.9, 0.08, 0.2, CK.DARK, V3(0, FLOOR + 1.0, z - 0.06)));
      detail.push(bbox(0.8, 1.75, 0.06, 0.18, CK.HULL, V3(0, FLOOR + 0.98, z - 0.1)));
      detail.push(stock(new THREE.TorusGeometry(0.16, 0.025, 6, 16), CK.BRONZE).translate(0, FLOOR + 1.0, z - 0.15));
      for (const s of [1, -1]) detail.push(bbox(0.5, 0.9, 0.12, 0.04, CK.DARK, V3(s * (w - 0.45), FLOOR + 0.8, z - 0.08)));
      void rings;
    }
  }

  // screens mesh (emissive)
  const sg = mergePlain(screens);
  const sU = { uTime: { value: 0 }, uOn: { value: 1 }, uGain: { value: 1.1 } };
  const screenMesh = new THREE.Mesh(sg, new THREE.ShaderMaterial({ vertexShader: SCREEN_VERT, fragmentShader: SCREEN_FRAG, uniforms: sU, side: THREE.DoubleSide }));
  screenMesh.frustumCulled = false; screenMesh.renderOrder = 3; screenMesh.name = 'Lodestar screens';

  const gU = { uSunView: { value: new THREE.Vector3(1, 0, 0) }, uSunE: U.uSunIlluminance, uUpView: { value: new THREE.Vector3(0, 1, 0) } };
  const glass = new THREE.Mesh(gGlass, new THREE.ShaderMaterial({ vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG, uniforms: gU, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  glass.frustumCulled = false; glass.renderOrder = 6; glass.name = 'Lodestar canopy';
  return { base, detail, glass, glassU: gU, screens: screenMesh, screenU: sU };
}

function finishLoft(rings, k) {
  const pos = [], fac = [], idx = [], n = rings[0].length, W = n + 1;
  rings.forEach((r, j) => { for (let i = 0; i <= n; i++) { const p = r[i % n]; pos.push(p.x, p.y, p.z); fac.push(p.x * 2, p.z * 2, k); } });
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < n; i++) { const a = j * W + i, b = a + 1, c = a + W + 1, d = a + W; idx.push(a, b, c, a, c, d); }
  return finish(pos, fac, idx);
}
function mergePlain(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), sd = new Float32Array(n), idx = [];
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3); uv.set(g.attributes.uv.array, o * 2); sd.set(g.attributes.aSeed.array, o);
    for (const i of g.index.array) idx.push(i + o);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  g.setIndex(idx);
  return g;
}
void TAU; void rng;
