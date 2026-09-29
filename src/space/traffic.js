import * as THREE from 'three';
import { R_EARTH, GEO_ALT, MERIDIAN_LON, bodyDir } from './sim.js';
import { HALO_PORTS } from './earthData.js';
import { CORRIDORS, stationFrame } from './stations.js';
import { createCraftMaterial, updateCraftMaterial } from '../craft/craftMaterial.js';
import { buildCourier, buildShuttle, buildTug } from '../craft/craftClasses.js';
import { CRAFT_FRAME } from './craftMesh.js';
import { design } from './shipDesigns.js';

// Orbital traffic as designed corridors, positioned on the GPU from the simulation clock
// (so time warp drives it consistently) and drawn as short motion streaks.
//
//   0 ring lanes      four fixed lanes per ring: slow local lanes just above the deck,
//                     fast express lanes higher up; prograde warm, retrograde cool;
//                     ships evenly spaced along each lane so they read as a flow
//   1 transfers       short hops between the Halo and the high rings at their nodes
//                     (climbing cool, descending warm)
//   2 port columns    at each Halo port: up the east column (cool), down the west (warm)
//   3 Earth-Moon      two lanes a few thousand km apart: outbound cool, inbound warm
//   4 Harbour         the arrival corridor (warm, braking inward) and the departure
//                     corridor (cool, accelerating out; some bound for Mars and beyond)
//
// Colour code throughout: warm = inbound / prograde, cool = outbound / retrograde.
// A CPU mirror of the same paths (shipPosJS) lets the nearest few be drawn as hulls.

export const TRAFFIC_GLSL = /* glsl */ `
uniform float uT;
uniform vec3 uRA[4];
uniform vec3 uRB[4];
uniform float uRR[4];
uniform vec3 uRN[4];
uniform mat3 uEarthRot;
uniform vec3 uGeo;
uniform vec3 uHX;
uniform vec3 uHY;
uniform vec3 uHZ;
uniform vec3 uCorrA;
uniform vec3 uCorrD;
uniform vec3 uMoon;

vec3 ringPoint(int k, float th, float dr, float ax) {
  vec3 a = uRA[0], b = uRB[0], n = uRN[0]; float R = uRR[0];
  if (k == 1) { a = uRA[1]; b = uRB[1]; n = uRN[1]; R = uRR[1]; }
  else if (k == 2) { a = uRA[2]; b = uRB[2]; n = uRN[2]; R = uRR[2]; }
  else if (k == 3) { a = uRA[3]; b = uRB[3]; n = uRN[3]; R = uRR[3]; }
  return (a * cos(th) + b * sin(th)) * (R + dr) + n * ax;
}
float ringR(int k) { return k == 0 ? uRR[0] : (k == 1 ? uRR[1] : (k == 2 ? uRR[2] : uRR[3])); }
float endFade(float ph, float a, float b) { return smoothstep(0.0, a, ph) * (1.0 - smoothstep(1.0 - b, 1.0, ph)); }

vec3 shipPos(vec4 A, vec4 B, float t, out float vis) {
  float type = A.x;
  vis = 1.0;
  if (type < 0.5) {
    int k = int(A.y + 0.5);
    float th = A.z + A.w * t / ringR(k);
    return ringPoint(k, th, B.x, B.y);
  } else if (type < 1.5) {
    int ka = int(A.y + 0.5), kb = int(A.z + 0.5);
    float ph = fract(t / B.z + B.w);
    float s = ph / 0.6;
    vis = s > 1.0 ? 0.0 : endFade(s, 0.06, 0.06);
    s = min(s, 1.0);
    float e = s * s * (3.0 - 2.0 * s);
    vec3 pa = ringPoint(ka, A.w, 6.0, 0.0);
    vec3 pb = ringPoint(kb, B.x, 6.0, 0.0);
    float ra = length(pa), rb = length(pb);
    vec3 d = normalize(mix(pa / ra, pb / rb, e));
    return d * (mix(ra, rb, e) + sin(3.14159 * e) * B.y);
  } else if (type < 2.5) {
    float lon = A.y;
    vec3 dir = uEarthRot * vec3(cos(lon), 0.0, -sin(lon));
    vec3 east = uEarthRot * vec3(-sin(lon), 0.0, -cos(lon));
    float ph = fract(t / A.w + B.x);
    float e = ph * ph * (3.0 - 2.0 * ph);
    float s = B.y > 0.0 ? e : 1.0 - e;
    vis = endFade(ph, 0.05, 0.05);
    return dir * (${R_EARTH.toFixed(1)} + 8.0 + s * 602.0) + east * A.z;
  } else if (type < 3.5) {
    float ph = fract(t / (3.2 * 86400.0) + A.y);
    float s = A.w > 0.0 ? ph : 1.0 - ph;
    vis = endFade(ph, 0.02, 0.02);
    vec3 a = uGeo, b = uMoon;
    vec3 m = (a + b) * 0.5;
    vec3 side = normalize(cross(b - a, vec3(0.0, 1.0, 0.0)));
    vec3 c = m + side * length(b - a) * 0.22 + vec3(0.0, 1.0, 0.0) * B.x;
    b += normalize(c - b) * 2300.0;   // arrive in lunar orbit, never through the Moon's centre
    vec3 p = mix(mix(a, c, s), mix(c, b, s), s);
    return p + side * A.z * sin(3.14159 * s);
  } else {
    // Harbour corridors, in the Harbour's frame
    bool arr = A.y < 0.5;
    vec3 dl = arr ? uCorrA : uCorrD;
    vec3 dW = uHX * dl.x + uHY * dl.y + uHZ * dl.z;
    vec3 e1 = normalize(cross(dW, uHY));
    vec3 e2 = cross(e1, dW);
    float ph = fract(t / A.w + A.z);
    float s = arr ? (1.0 - ph) * (1.0 - ph) : ph * ph;
    vis = arr ? endFade(ph, 0.03, 0.08) : endFade(ph, 0.06, 0.03);
    return uGeo + dW * (B.w + s * B.z) + e1 * B.x + e2 * B.y;
  }
}
`;

const VERT = /* glsl */ `
attribute vec4 iA;
attribute vec4 iB;
attribute vec3 iC;
uniform float uStreak;
uniform vec2 uRes;
uniform float uPx;
varying float vAlong;
varying float vAcross;
varying vec3 vCol;
varying float vFade;
${TRAFFIC_GLSL}

void main() {
  vCol = iC;
  float vis0, vis1;
  vec3 head = shipPos(iA, iB, uT, vis0);
  // the tail follows the ship's instantaneous velocity (a tiny step back, extrapolated),
  // never a second sample a whole streak-time earlier: across a cycle wrap that sample lay
  // on the far side of the planet and the "streak" joined two unrelated points
  float hs = max(uStreak * 0.02, 0.05);
  vec3 prev = shipPos(iA, iB, uT - hs, vis1);
  vec3 vel = (head - prev) / hs;
  float jump = length(head - prev);
  vec3 tail = head - vel * uStreak;
  if (vis1 < 0.02 || jump > 60.0 * hs + 5.0) tail = head;   // the step itself crossed a wrap
  vec4 ch = projectionMatrix * viewMatrix * vec4(head, 1.0);
  vec4 ct = projectionMatrix * viewMatrix * vec4(tail, 1.0);
  // cull anything the quad could not honestly draw: heads behind the camera or outside
  // this depth slice (each streak is drawn once, by the slice holding its head),
  // off-screen heads (a streak never reaches further than 40 px from its head), invisible
  // ships and non-finite positions
  vec2 sh = ch.xy / max(ch.w, 1e-6) * uRes * 0.5;
  bool bad = !(ch.w > 1e-3) || ch.z < -ch.w || ch.z > ch.w || any(isnan(sh)) || any(isinf(sh))
          || any(greaterThan(abs(sh), uRes * 0.5 + 64.0)) || vis0 < 0.004;
  if (bad) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (!(ct.w > 1e-3)) ct = ch;
  vec2 st = ct.xy / ct.w * uRes * 0.5;
  if (any(isnan(st)) || any(isinf(st))) st = sh;
  vec2 dv = sh - st;
  float len = length(dv);
  // unit direction from the full offset, BEFORE capping the length (dividing the uncapped
  // offset by the capped length produced a giant quad: the tan rectangle seen in orbit)
  vec2 dir = len > 0.5 ? dv / len : vec2(1.0, 0.0);
  if (len > 40.0) { st = sh - dir * 40.0; len = 40.0; }
  vec2 perp = vec2(-dir.y, dir.x);
  float w = uPx;
  // quad: x = 0 tail .. 1 head (extended by a pixel for a round head), y = -1..1
  vec2 base = mix(st - dir * w, sh + dir * w, position.x);
  vec2 sp = base + perp * position.y * w;
  float zw = mix(ct.z / ct.w, ch.z / ch.w, position.x);
  gl_Position = vec4(sp / (uRes * 0.5), zw, 1.0);
  vAlong = position.x;
  vAcross = position.y;
  float dist = -(viewMatrix * vec4(head, 1.0)).z;
  // distant ships fade (a calm planet, not confetti); long streaks spread their light
  vFade = vis0 * clamp(1.6e5 / max(dist, 1.0), 0.08, 1.0) * clamp(24.0 / max(len, 1.0) + 0.3, 0.3, 1.0);
  // ships closer than a few km are real hulls, not specks: fade the streak out
  vFade *= smoothstep(1.5, 6.0, dist);
}
`;

const FRAG = /* glsl */ `
varying float vAlong;
varying float vAcross;
varying vec3 vCol;
varying float vFade;
void main() {
  float a = exp(-vAcross * vAcross * 3.0) * (0.2 + 0.8 * vAlong * vAlong);
  gl_FragColor = vec4(vCol * a * vFade * 0.8, 0.0);
}
`;

const HULL_MAX = 8;          // hulls per class
const HULL_D = 8.0;          // km: hulls drawn inside this range (the streak has faded by 1.5 km)
const KM_HULL = 0.001;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const fract = (x) => x - Math.floor(x);
const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

function ringPoint(u, k, th, dr, ax, v) {
  const R = u.uRR.value[k] + dr;
  return v.copy(u.uRA.value[k]).multiplyScalar(Math.cos(th) * R).addScaledVector(u.uRB.value[k], Math.sin(th) * R).addScaledVector(u.uRN.value[k], ax);
}
const endFade = (ph, a, b) => ss(0, a, ph) * (1 - ss(1 - b, 1, ph));

function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/**
 * Hull design for streak ship i of path type t: 0 courier, 1 shuttle, 2 tug, 3 packet,
 * 4 lighter, 5 hauler, 6 tanker (the order of Traffic.hullSets).
 */
export function hullClassOf(t, i) {
  if (t < 0.5) return [0, 3, 4][i % 3];         // ring lanes: couriers, packets, lighters
  if (t < 1.5) return 3;                         // transfers between the rings: packets
  if (t < 2.5) return 1;                         // the port columns: shuttles
  if (t < 3.5) return i % 2 ? 5 : 6;             // the Earth-Moon run: haulers and tankers
  return i % 3 === 0 ? 5 : 2;                    // the Harbour's corridors: haulers and tugs
}

export const TCOL = {
  WARM: [1.0, 0.7, 0.42],
  COOL: [0.52, 0.78, 1.0],
  WARMW: [1.0, 0.9, 0.76],
  COOLW: [0.82, 0.9, 1.0],
};

export class Traffic {
  constructor(space, rings, q) {
    this.space = space;
    this.rings = rings;
    const N = Math.round(q.traffic * 0.5);
    const r = rnd(4242);
    const A = [], B = [], C = [];
    const push = (a, b, c) => { A.push(...a); B.push(...b); C.push(...c); };
    const nRing = Math.floor(N * 0.6), nXfer = Math.floor(N * 0.06), nPort = Math.floor(N * 0.16), nMoon = Math.floor(N * 0.06);
    const nGeo = N - nRing - nXfer - nPort - nMoon;
    const defs = rings.defs;
    // ---- ring lanes: per ring, four lanes, ships evenly spaced (a little jitter)
    const share = [0.42, 0.2, 0.2, 0.18];
    const lanes = [
      { dr: 3.0, ax: -0.62, v: [1.6, 2.4], dir: 1, c: TCOL.WARM },
      { dr: 3.0, ax: 0.62, v: [1.6, 2.4], dir: -1, c: TCOL.COOL },
      { dr: 8.5, ax: -0.3, v: [5.6, 6.4], dir: 1, c: TCOL.WARMW },
      { dr: 8.5, ax: 0.3, v: [5.6, 6.4], dir: -1, c: TCOL.COOLW },
    ];
    for (let k = 0; k < 4; k++) {
      const nk = Math.floor(nRing * share[k]);
      const w = defs[k].width;
      for (let L = 0; L < 4; L++) {
        const ln = lanes[L];
        const n = Math.floor(nk / 4);
        for (let i = 0; i < n; i++) {
          const th0 = ((i + 0.35 * (r() - 0.5)) / n) * Math.PI * 2;
          const v = ln.dir * (ln.v[0] + (ln.v[1] - ln.v[0]) * r());
          push([0, k, th0, v], [ln.dr + (r() - 0.5) * 0.8, ln.ax * w + (r() - 0.5) * 0.5, 0, 0], ln.c);
        }
      }
    }
    // ---- transfers at the ring nodes
    const nodes = [];
    const b0 = rings.bases[0];
    for (let k = 1; k < 4; k++) {
      const bk = rings.bases[k];
      const m = new THREE.Vector3().crossVectors(b0.n, bk.n).normalize();
      for (const sgn of [1, -1]) {
        const mm = m.clone().multiplyScalar(sgn);
        nodes.push({ k, th0: Math.atan2(mm.dot(b0.b), mm.dot(b0.a)), thk: Math.atan2(mm.dot(bk.b), mm.dot(bk.a)) });
      }
    }
    for (let i = 0; i < nXfer; i++) {
      const nd = nodes[i % nodes.length];
      const up = r() < 0.5;
      const j0 = nd.th0 + (r() - 0.5) * 0.05, jk = nd.thk + (r() - 0.5) * 0.05;
      push([1, up ? 0 : nd.k, up ? nd.k : 0, up ? j0 : jk], [up ? jk : j0, 50 + r() * 70, 3000 + r() * 3000, r()], up ? TCOL.COOL : TCOL.WARM);
    }
    // ---- port columns: up the east column, down the west
    const perCol = Math.max(1, Math.floor(nPort / (HALO_PORTS.length * 2)));
    for (const p of HALO_PORTS) {
      const lon = THREE.MathUtils.degToRad(p.lon);
      for (const up of [1, -1]) {
        for (let i = 0; i < perCol; i++) {
          push([2, lon, (up > 0 ? 12 : -12) + (r() - 0.5) * 0.8, 1800 + r() * 200], [(i + 0.3 * r()) / perCol, up, 0, 0], up > 0 ? TCOL.COOL : TCOL.WARM);
        }
      }
    }
    // ---- the Earth-Moon run: two lanes
    for (let i = 0; i < nMoon; i++) {
      const out = i % 2 === 0;
      push([3, (Math.floor(i / 2) + 0.3 * r()) / Math.ceil(nMoon / 2), (out ? 1500 : -1500) + (r() - 0.5) * 300, out ? 1 : -1], [(r() - 0.5) * 2000, 0, 0, 0], out ? TCOL.COOL : TCOL.WARM);
    }
    // ---- the Harbour's corridors: three lanes each, some departures bound far out
    const latX = [-1.3, 0, 1.3], latY = [-0.7, 0.7];
    for (let i = 0; i < nGeo; i++) {
      const arr = i % 2 === 0;
      const far = r() < (arr ? 0.3 : 0.4);
      const S = far ? (arr ? 12000 : 20000) : 3000;
      const P = far ? (arr ? 20000 : 24000) : (arr ? 5400 : 6000);
      const lane = i % 6;
      push([4, arr ? 0 : 1, r(), P], [latX[lane % 3] + (r() - 0.5) * 0.3, latY[lane % 2] + (r() - 0.5) * 0.3, S, arr ? 22 : 20], arr ? TCOL.WARM : (far ? TCOL.COOLW : TCOL.COOL));
    }
    const count = A.length / 4;
    this.count = count;
    this.iA = new Float32Array(A); this.iB = new Float32Array(B); this.iC = new Float32Array(C);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(this.iA, 4));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(this.iB, 4));
    g.setAttribute('iC', new THREE.InstancedBufferAttribute(this.iC, 3));
    g.instanceCount = count;
    this.uniforms = {
      uT: { value: 0 }, uStreak: { value: 1 },
      uRA: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, uRB: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
      uRN: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, uRR: { value: rings.bases.map((b) => b.R) },
      uEarthRot: { value: new THREE.Matrix3() }, uGeo: { value: new THREE.Vector3() },
      uHX: { value: new THREE.Vector3() }, uHY: { value: new THREE.Vector3() }, uHZ: { value: new THREE.Vector3() },
      uCorrA: { value: CORRIDORS.dA.clone() }, uCorrD: { value: CORRIDORS.dD.clone() },
      uMoon: { value: new THREE.Vector3() },
      uRes: { value: new THREE.Vector2(1920, 1080) }, uPx: { value: 1.4 },
    };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.geoDir = bodyDir(0, MERIDIAN_LON);
    this.geoQ = stationFrame(this.geoDir);
    this._q = new THREE.Quaternion();
    this.buildHulls(space);
  }

  // ---- hull LOD: the streaks fade out inside ~6 km, so the nearest ships become real closed
  // hulls there (couriers on the ring lanes, shuttles on the port columns, transfers and the
  // Moon run, tugs in the Harbour corridors), placed from shipPosJS, the CPU mirror of the
  // shader paths. One instanced mesh per class, instance matrices relative to a local origin
  // at the nearest hull so they stay exact in float32; nothing is drawn when none are near.
  buildHulls(space) {
    this.hullGroup = new THREE.Group();
    this.hullGroup.userData.world = new THREE.Vector3();
    // the working fleet's designs join the three classic hulls: packets and lighters on the
    // ring lanes, haulers and tankers on the Moon run and in the Harbour's corridors
    const classes = [buildCourier(44), buildShuttle(110), buildTug(80), design('packet', 4), design('lighter', 1), design('hauler', 3), design('tanker', 5)];
    const accents = [[0.55, 0.85, 1.0], [0.55, 0.9, 1.0], [1.0, 0.72, 0.42], [0.55, 0.88, 1.0], [0.5, 1.0, 0.8], [1.0, 0.72, 0.45], [1.0, 0.62, 0.35]];
    this.hullSets = classes.map((c, i) => {
      const mat = createCraftMaterial({ accent: accents[i], lit: 0.5 });
      const im = new THREE.InstancedMesh(c.geo, mat, HULL_MAX);
      im.count = 0;
      im.frustumCulled = false;
      im.renderOrder = 3;
      im.onBeforeRender = (r, sc, cam) => {
        updateCraftMaterial(mat, cam, CRAFT_FRAME.sunDir, this.hullGroup.userData.world, CRAFT_FRAME.time);
        mat.uniformsNeedUpdate = true;
      };
      this.hullGroup.add(im);
      return im;
    });
    // hull class per ship, from its path type (and a Harbour tug for every corridor ship)
    this.hullClass = new Uint8Array(this.count);
    for (let i = 0; i < this.count; i++) this.hullClass[i] = hullClassOf(this.iA[i * 4], i);
    space.scene.add(this.hullGroup);
    // placed while the slices are planned, from the camera as it will render this frame (the
    // rig moves after the modules update: a stale camera missed ships under time warp)
    this.hullBody = space.addBody('trafficHulls', [this.hullGroup], null, 0, {
      solid: true,
      interval: (camPos) => {
        const r = this.updateHulls(this.uniforms.uT.value, camPos);
        if (!r) return [1, 0];                      // nothing near: no slice
        const d = this.hullGroup.position.distanceTo(camPos);
        return [d - r, d + r];
      },
    });
    this._near = [];
    this._pos = new THREE.Vector3(); this._prev = new THREE.Vector3();
    this._m = new THREE.Matrix4(); this._s = new THREE.Vector3(KM_HULL, KM_HULL, KM_HULL);
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
  }

  /** CPU mirror of shipPos (TRAFFIC_GLSL): world km into out, returns the visibility. */
  shipPosJS(i, t, out) {
    const A = this.iA, B = this.iB, u = this.uniforms, o = i * 4;
    const type = A[o];
    if (type < 0.5) {
      const k = Math.round(A[o + 1]);
      ringPoint(u, k, A[o + 2] + A[o + 3] * t / u.uRR.value[k], B[o], B[o + 1], out);
      return 1;
    } else if (type < 1.5) {
      const ph = fract(t / B[o + 2] + B[o + 3]);
      let s = ph / 0.6;
      const vis = s > 1 ? 0 : endFade(s, 0.06, 0.06);
      s = Math.min(s, 1);
      const e = s * s * (3 - 2 * s);
      const pa = ringPoint(u, Math.round(A[o + 1]), A[o + 3], 6, 0, _a);
      const pb = ringPoint(u, Math.round(A[o + 2]), B[o], 6, 0, _b);
      const ra = pa.length(), rb = pb.length();
      out.copy(pa).multiplyScalar((1 - e) / ra).addScaledVector(pb, e / rb).normalize();
      out.multiplyScalar(ra + (rb - ra) * e + Math.sin(Math.PI * e) * B[o + 1]);
      return vis;
    } else if (type < 2.5) {
      const lon = A[o + 1];
      const ph = fract(t / A[o + 3] + B[o]);
      const e = ph * ph * (3 - 2 * ph);
      const s = B[o + 1] > 0 ? e : 1 - e;
      _a.set(Math.cos(lon), 0, -Math.sin(lon)).applyMatrix3(u.uEarthRot.value);
      _b.set(-Math.sin(lon), 0, -Math.cos(lon)).applyMatrix3(u.uEarthRot.value);
      out.copy(_a).multiplyScalar(R_EARTH + 8 + s * 602).addScaledVector(_b, A[o + 2]);
      return endFade(ph, 0.05, 0.05);
    } else if (type < 3.5) {
      const ph = fract(t / (3.2 * 86400) + A[o + 1]);
      const s = A[o + 3] > 0 ? ph : 1 - ph;
      const a = u.uGeo.value, b = _b.copy(u.uMoon.value);
      const side = _d.subVectors(b, a).cross(_up);
      const L = _c.subVectors(b, a).length();
      side.normalize();
      const c = _c.addVectors(a, b).multiplyScalar(0.5).addScaledVector(side, L * 0.22).addScaledVector(_up, B[o]);
      b.addScaledVector(_a.subVectors(c, b).normalize(), 2300);
      // quadratic Bezier a -> c -> b
      out.copy(a).multiplyScalar((1 - s) * (1 - s)).addScaledVector(c, 2 * s * (1 - s)).addScaledVector(b, s * s);
      out.addScaledVector(side, A[o + 2] * Math.sin(Math.PI * s));
      return endFade(ph, 0.02, 0.02);
    }
    const arr = A[o + 1] < 0.5;
    const dl = arr ? u.uCorrA.value : u.uCorrD.value;
    const dW = _a.copy(u.uHX.value).multiplyScalar(dl.x).addScaledVector(u.uHY.value, dl.y).addScaledVector(u.uHZ.value, dl.z);
    const e1 = _b.crossVectors(dW, u.uHY.value).normalize();
    const e2 = _c.crossVectors(e1, dW);
    const ph = fract(t / A[o + 3] + A[o + 2]);
    const s = arr ? (1 - ph) * (1 - ph) : ph * ph;
    out.copy(u.uGeo.value).addScaledVector(dW, B[o + 3] + s * B[o + 2]).addScaledVector(e1, B[o]).addScaledVector(e2, B[o + 1]);
    return arr ? endFade(ph, 0.03, 0.08) : endFade(ph, 0.06, 0.03);
  }

  /** Picks the ships within HULL_D of the camera and places their hulls; returns the radius
   *  of the hull cluster round its origin, 0 when none are near. */
  updateHulls(t, cp) {
    const near = this._near;
    near.length = 0;
    {
      const p = this._pos;
      for (let i = 0; i < this.count; i++) {
        const vis = this.shipPosJS(i, t, p);
        if (vis < 0.5) continue;
        const d2 = p.distanceToSquared(cp);
        if (d2 > HULL_D * HULL_D) continue;
        near.push(i);
        if (near.length >= HULL_MAX * 3) break;
      }
    }
    const sets = this.hullSets;
    for (const im of sets) im.count = 0;
    if (!near.length) return 0;
    const O = this.hullGroup.position;
    this.shipPosJS(near[0], t, O);
    this.hullGroup.userData.world.copy(O);
    let rad = 0.2;
    const hs = 0.5;
    for (const i of near) {
      const im = sets[this.hullClass[i]];
      if (im.count >= HULL_MAX) continue;
      const p = this._pos, q = this._prev;
      this.shipPosJS(i, t, p);
      this.shipPosJS(i, t - hs, q);
      // heading along the velocity (a step across a path wrap keeps the radial-up fallback)
      const z = this._z.subVectors(p, q);
      if (!(z.lengthSq() > 1e-12) || z.length() > 60 * hs + 5) z.set(0, 1, 0).cross(p);
      if (!(z.lengthSq() > 1e-12)) z.set(0, 0, 1);
      z.normalize();
      const y = this._y.copy(p).normalize();
      const x = this._x.crossVectors(y, z);
      if (x.lengthSq() < 1e-8) x.set(1, 0, 0).cross(z);
      if (x.lengthSq() < 1e-8) x.set(0, 0, 1).cross(z);
      x.normalize();
      y.crossVectors(z, x);
      this._m.makeBasis(x, y, z).scale(this._s).setPosition(p.x - O.x, p.y - O.y, p.z - O.z);
      im.setMatrixAt(im.count++, this._m);
      rad = Math.max(rad, p.distanceTo(O) + 0.6);
    }
    for (const im of sets) if (im.count) im.instanceMatrix.needsUpdate = true;
    return rad;
  }

  setSize(w, h) { this.uniforms.uRes.value.set(w, h); this.uniforms.uPx.value = Math.max(1.3, h / 760); }

  update(sim, realTime, dt, space) {
    const u = this.uniforms;
    u.uT.value = sim.t % (86400 * 30);
    // streak = distance covered in ~1/15 s of screen time
    const warp = sim.paused ? 0 : sim.warp;
    u.uStreak.value = THREE.MathUtils.clamp(warp * 0.07, 0.4, 3000);
    const q = sim.earthQuat;
    this.rings.bases.forEach((b, i) => {
      u.uRA.value[i].copy(b.a).applyQuaternion(q);
      u.uRB.value[i].copy(b.b).applyQuaternion(q);
      u.uRN.value[i].copy(b.n).applyQuaternion(q);
    });
    u.uEarthRot.value.setFromMatrix4(sim.earthMat);
    u.uGeo.value.copy(this.geoDir).applyQuaternion(q).multiplyScalar(R_EARTH + GEO_ALT);
    const hq = this._q.copy(q).multiply(this.geoQ);
    u.uHX.value.set(1, 0, 0).applyQuaternion(hq);
    u.uHY.value.set(0, 1, 0).applyQuaternion(hq);
    u.uHZ.value.set(0, 0, 1).applyQuaternion(hq);
    u.uMoon.value.copy(sim.moonPos);
  }
}
