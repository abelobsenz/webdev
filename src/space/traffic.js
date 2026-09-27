import * as THREE from 'three';
import { R_EARTH, GEO_ALT, MERIDIAN_LON, bodyDir } from './sim.js';
import { HALO_PORTS } from './earthData.js';

// Orbital traffic: thousands of ships as motion streaks, all positioned on the
// GPU from the simulation clock, so time warp drives them consistently.
//   0 lanes along each ring      1 transfers between rings
//   2 shuttles between the ground ports and the Halo
//   3 the Earth-Moon lane from the Geostationary Harbour
//   4 ships manoeuvring around the Harbour

const VERT = /* glsl */ `
attribute vec4 iA;
attribute vec4 iB;
attribute vec3 iC;
uniform float uT;
uniform float uStreak;
uniform vec3 uRA[4];
uniform vec3 uRB[4];
uniform float uRR[4];
uniform vec3 uRN[4];
uniform mat3 uEarthRot;
uniform vec3 uGeo;
uniform vec3 uGeoUp;
uniform vec3 uMoon;
uniform vec2 uRes;
uniform float uPx;
varying float vAlong;
varying float vAcross;
varying vec3 vCol;
varying float vFade;

vec3 ringPoint(int k, float th, float dr, float ax) {
  vec3 a = uRA[0], b = uRB[0], n = uRN[0]; float R = uRR[0];
  if (k == 1) { a = uRA[1]; b = uRB[1]; n = uRN[1]; R = uRR[1]; }
  else if (k == 2) { a = uRA[2]; b = uRB[2]; n = uRN[2]; R = uRR[2]; }
  else if (k == 3) { a = uRA[3]; b = uRB[3]; n = uRN[3]; R = uRR[3]; }
  return (a * cos(th) + b * sin(th)) * (R + dr) + n * ax;
}

vec3 shipPos(float t, out float vis) {
  float type = iA.x;
  vis = 1.0;
  if (type < 0.5) {
    int k = int(iA.y + 0.5);
    float R = uRR[k];
    float th = iA.z + iA.w * t / R;
    return ringPoint(k, th, iB.x, iB.y);
  } else if (type < 1.5) {
    int ka = int(iA.y + 0.5), kb = int(iA.z + 0.5);
    float P = iB.z;
    float ph = fract(t / P + iB.w);
    float s = ph / 0.6;
    if (s > 1.0) { vis = 0.0; s = 1.0; }
    float e = s * s * (3.0 - 2.0 * s);
    vec3 pa = ringPoint(ka, iA.w, 4.0, 0.0);
    vec3 pb = ringPoint(kb, iB.x, 4.0, 0.0);
    float ra = length(pa), rb = length(pb);
    vec3 d = normalize(mix(pa / ra, pb / rb, e));
    return d * (mix(ra, rb, e) + sin(3.14159 * e) * iB.y);
  } else if (type < 2.5) {
    float lon = iA.y;
    vec3 dir = uEarthRot * vec3(cos(lon), 0.0, -sin(lon));
    vec3 east = uEarthRot * vec3(-sin(lon), 0.0, -cos(lon));
    float ph = fract(t / iA.w + iB.x);
    float s = iB.y > 0.0 ? ph : 1.0 - ph;
    float h = 8.0 + s * 604.0;
    return dir * (${R_EARTH.toFixed(1)} + h) + east * iA.z;
  } else if (type < 3.5) {
    float ph = fract(t / (3.2 * 86400.0) + iA.y);
    float s = iA.w > 0.0 ? ph : 1.0 - ph;
    vec3 a = uGeo, b = uMoon;
    vec3 m = (a + b) * 0.5;
    vec3 side = normalize(cross(b - a, vec3(0.0, 1.0, 0.0)));
    vec3 c = m + side * length(b - a) * 0.22 + vec3(0.0, 1.0, 0.0) * iA.z;
    vec3 p = mix(mix(a, c, s), mix(c, b, s), s);
    return p + side * iA.z * 0.1 * sin(s * 3.14159);
  } else {
    float R = iA.y;
    float th = iA.z + iA.w * t;
    vec3 up = uGeoUp;
    vec3 e1 = normalize(cross(up, vec3(0.0, 1.0, 0.0) + 1e-4));
    vec3 e2 = cross(up, e1);
    float tl = iB.x;
    return uGeo + (e1 * cos(th) + (e2 * cos(tl) + up * sin(tl)) * sin(th)) * R;
  }
}

void main() {
  vCol = iC;
  float vis0, vis1;
  vec3 head = shipPos(uT, vis0);
  vec3 tail = shipPos(uT - uStreak, vis1);
  vec4 ch = projectionMatrix * viewMatrix * vec4(head, 1.0);
  vec4 ct = projectionMatrix * viewMatrix * vec4(tail, 1.0);
  // cull anything the quad could not honestly draw: heads behind the camera or outside
  // this depth slice (each streak is drawn once, by the slice holding its head),
  // off-screen heads (a streak never reaches further than 48 px from its head) and
  // non-finite positions. A ship passing within metres of the camera otherwise produced
  // a quad spanning the whole screen for a frame.
  vec2 sh = ch.xy / max(ch.w, 1e-6) * uRes * 0.5;
  bool bad = !(ch.w > 1e-3) || ch.z < -ch.w || ch.z > ch.w || any(isnan(sh)) || any(isinf(sh))
          || any(greaterThan(abs(sh), uRes * 0.5 + 64.0));
  if (bad) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (!(ct.w > 1e-3)) ct = ch;
  vec2 st = ct.xy / ct.w * uRes * 0.5;
  if (any(isnan(st)) || any(isinf(st))) st = sh;
  vec2 dv = sh - st;
  float len = length(dv);
  if (len > 48.0) { st = sh - dv / len * 48.0; len = 48.0; }
  vec2 dir = len > 0.5 ? dv / len : vec2(1.0, 0.0);
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
  vFade = vis0 * clamp(2.5e5 / max(dist, 1.0), 0.15, 1.0) * clamp(30.0 / max(len, 1.0) + 0.35, 0.35, 1.0);
  // ships closer than a few km are real hulls, not specks: fade the streak out
  vFade *= smoothstep(0.4, 4.0, dist);
}
`;

const FRAG = /* glsl */ `
varying float vAlong;
varying float vAcross;
varying vec3 vCol;
varying float vFade;
void main() {
  float a = exp(-vAcross * vAcross * 3.0) * (0.2 + 0.8 * vAlong * vAlong);
  gl_FragColor = vec4(vCol * a * vFade * 0.9, 0.0);
}
`;

function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class Traffic {
  constructor(space, rings, q) {
    this.space = space;
    this.rings = rings;
    const N = q.traffic;
    const r = rnd(4242);
    const A = [], B = [], C = [];
    const cols = [[1.0, 0.86, 0.66], [0.66, 0.85, 1.0], [1.0, 0.55, 0.35], [0.9, 0.95, 1.0]];
    const push = (a, b, c) => { A.push(...a); B.push(...b); C.push(...c); };
    // the Harbour keeps a modest local swarm (a denser one read as confetti around the station)
    const nRing = Math.floor(N * 0.62), nXfer = Math.floor(N * 0.14), nPort = Math.floor(N * 0.1), nMoon = Math.floor(N * 0.1);
    const nGeo = N - nRing - nXfer - nPort - nMoon;
    const widths = rings.defs.map((d) => d.width);
    for (let i = 0; i < nRing; i++) {
      const k = r() < 0.4 ? 0 : 1 + Math.floor(r() * 3);
      const dir = r() < 0.5 ? 1 : -1;
      const fast = r() < 0.3;
      const v = dir * (fast ? 5 + r() * 3 : 0.8 + r() * 2.2);
      const lane = Math.floor(r() * 4);
      const dr = [-4, 6, 18, 40][lane] + (r() - 0.5) * 2;
      const ax = (r() < 0.5 ? -1 : 1) * widths[k] * (0.55 + r() * 0.3) * (lane < 2 ? 1 : 0.4);
      const c = fast ? cols[1] : cols[r() < 0.7 ? 0 : 3];
      push([0, k, r() * Math.PI * 2, v], [dr, ax, 0, 0], c);
    }
    for (let i = 0; i < nXfer; i++) {
      const ka = 0, kb = 1 + Math.floor(r() * 3);
      const swap = r() < 0.5;
      push([1, swap ? kb : ka, swap ? ka : kb, r() * Math.PI * 2], [r() * Math.PI * 2, 150 + r() * 500, 4000 + r() * 6000, r()], cols[r() < 0.5 ? 0 : 2]);
    }
    const ports = HALO_PORTS;
    for (let i = 0; i < nPort; i++) {
      const p = ports[Math.floor(r() * ports.length)];
      push([2, THREE.MathUtils.degToRad(p.lon), (r() - 0.5) * 40, 1800 + r() * 2400], [r(), r() < 0.5 ? 1 : -1, 0, 0], cols[r() < 0.6 ? 0 : 1]);
    }
    for (let i = 0; i < nMoon; i++) push([3, r(), (r() - 0.5) * 3000, r() < 0.5 ? 1 : -1], [0, 0, 0, 0], cols[r() < 0.5 ? 0 : 3]);
    for (let i = 0; i < nGeo; i++) push([4, 30 + Math.pow(r(), 2) * 400, r() * Math.PI * 2, (r() < 0.5 ? 1 : -1) * (0.0004 + r() * 0.002)], [(r() - 0.5) * 1.2, 0, 0, 0], cols[Math.floor(r() * 4)]);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(A), 4));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(B), 4));
    g.setAttribute('iC', new THREE.InstancedBufferAttribute(new Float32Array(C), 3));
    g.instanceCount = N;
    this.uniforms = {
      uT: { value: 0 }, uStreak: { value: 1 },
      uRA: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, uRB: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
      uRN: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, uRR: { value: rings.bases.map((b) => b.R) },
      uEarthRot: { value: new THREE.Matrix3() }, uGeo: { value: new THREE.Vector3() }, uGeoUp: { value: new THREE.Vector3() }, uMoon: { value: new THREE.Vector3() },
      uRes: { value: new THREE.Vector2(1920, 1080) }, uPx: { value: 1.4 },
    };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.geoDir = bodyDir(0, MERIDIAN_LON);
  }

  setSize(w, h) { this.uniforms.uRes.value.set(w, h); this.uniforms.uPx.value = Math.max(1.5, h / 700); }

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
    u.uGeoUp.value.copy(this.geoDir).applyQuaternion(q);
    u.uGeo.value.copy(u.uGeoUp.value).multiplyScalar(R_EARTH + GEO_ALT);
    u.uMoon.value.copy(sim.moonPos);
  }
}
