import * as THREE from 'three';
import { R_EARTH } from './sim.js';

// Meteors burning up over the night side, seen from above as short streaks far below: grains of
// comet dust meeting the air at 20 - 70 km/s, lighting at ~115 km and gone by 75 - 95 km, most
// a second or less; the fast ones green (magnesium and oxygen), the slow ones yellow-orange
// (sodium, iron); now and then a fireball that flares and breaks up at the end of its path.
// Spawned only where the camera can see them (inside its horizon, on the night side), at a rate
// matched to the sky's real flux, drawn as additive line segments against the planet's depth.

export const MET_SLOTS = 96;
export const H_START = 115;         // km
export const H_END_MIN = 72;        // km

const VERT = /* glsl */ `
attribute float aI;
attribute vec3 aCol;
varying float vI;
varying vec3 vCol;
void main() {
  vI = aI;
  vCol = aCol;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform float uGain;
varying float vI;
varying vec3 vCol;
void main() {
  gl_FragColor = vec4(vCol * max(vI, 0.0) * uGain, 0.0);
}
`;

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const _up = new THREE.Vector3(), _e = new THREE.Vector3(), _n = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Vector3();

export class Meteors {
  constructor(space, opts = {}) {
    this.space = space;
    this.rnd = mulberry(opts.seed ?? 5021);
    this.rate = opts.rate ?? 7;     // per second over the camera's night horizon at LEO heights
    this.slots = [];
    for (let i = 0; i < MET_SLOTS; i++) {
      this.slots.push({ live: false, t: 0, dur: 1, p0: new THREE.Vector3(), dir: new THREE.Vector3(), v: 40, trail: 12, peak: 1, fire: false, col: new THREE.Color() });
    }
    const pos = new Float32Array(MET_SLOTS * 2 * 3), inten = new Float32Array(MET_SLOTS * 2), col = new Float32Array(MET_SLOTS * 2 * 3);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.iAttr = new THREE.BufferAttribute(inten, 1).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aI', this.iAttr);
    g.setAttribute('aCol', this.colAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R_EARTH + 200);
    this.uniforms = { uGain: { value: 1 } };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthTest: true, depthWrite: false,
      blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    });
    this.lines = new THREE.LineSegments(g, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 8;
    this.spawned = 0;
    this._acc = 0;
    if (space && space.scene) space.scene.add(this.lines);
    if (space && space.addBody) space.addBody('meteors', [this.lines], (o) => o.set(0, 0, 0), R_EARTH + 200);
  }

  /** Start a meteor in a free slot somewhere the camera (at cam, km) can see on the night side. */
  spawn(cam, sunDir) {
    let s = null;
    for (let i = 0; i < MET_SLOTS; i++) if (!this.slots[i].live) { s = this.slots[i]; break; }
    if (!s) return false;
    const r = this.rnd;
    const d = cam.length();
    const R0 = R_EARTH + H_START;
    if (d < R_EARTH + 1) return false;
    // a point inside the camera's horizon: uniform over the visible cap
    const capCos = Math.min(R_EARTH / d, 0.9999);
    const cosA = 1 - r() * (1 - capCos);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    _up.copy(cam).normalize();
    _e.set(0, 1, 0).cross(_up);
    if (_e.lengthSq() < 1e-8) _e.set(1, 0, 0);
    _e.normalize();
    _n.crossVectors(_up, _e);
    const az = r() * Math.PI * 2;
    _p.copy(_up).multiplyScalar(cosA).addScaledVector(_e, sinA * Math.cos(az)).addScaledVector(_n, sinA * Math.sin(az)).normalize();
    // only against the night: the sunlit disc drowns them
    if (_p.dot(sunDir) > -0.12) return false;
    s.p0.copy(_p).multiplyScalar(R0);
    // entry: 15 - 65 degrees below the local horizontal, any heading
    const ent = (15 + 50 * r()) * Math.PI / 180, hd = r() * Math.PI * 2;
    _e.set(0, 1, 0).cross(_p);
    if (_e.lengthSq() < 1e-8) _e.set(1, 0, 0);
    _e.normalize();
    _n.crossVectors(_p, _e);
    _c.copy(_e).multiplyScalar(Math.cos(hd)).addScaledVector(_n, Math.sin(hd));
    s.dir.copy(_c).multiplyScalar(Math.cos(ent)).addScaledVector(_p, -Math.sin(ent)).normalize();
    s.v = 20 + 50 * r() * r();
    const hEnd = H_END_MIN + 23 * r();
    const len = (H_START - hEnd) / Math.sin(ent);
    s.dur = len / s.v;
    s.fire = r() < 0.04;
    s.peak = s.fire ? 12 + 20 * r() : 0.6 + 2.4 * r() * r();
    s.trail = Math.min(len, 6 + s.v * 0.35);
    // fast: green-white; slow: yellow-orange
    const fast = THREE.MathUtils.smoothstep(s.v, 30, 55);
    s.col.setRGB(1.0 - 0.45 * fast, 0.75 + 0.25 * fast, 0.35 + 0.35 * fast);
    s.t = 0;
    s.live = true;
    this.spawned++;
    return true;
  }

  update(sim, realTime, dt, space) {
    const cam = space && space.camera ? space.camera.position : null;
    const far = !cam || cam.length() > 60000;
    this.lines.visible = !far;
    const step = Math.min(Math.max(dt || 0, 0), 0.1);
    if (!far) {
      // Poisson arrivals at this rate
      this._acc += step * this.rate;
      let guard = 8;
      while (this._acc >= 1 && guard-- > 0) { this._acc -= 1; this.spawn(cam, sim.sunDir); }
    }
    const P = this.posAttr.array, I = this.iAttr.array, C = this.colAttr.array;
    for (let i = 0; i < MET_SLOTS; i++) {
      const s = this.slots[i];
      const k = i * 6;
      if (!s.live) { I[i * 2] = I[i * 2 + 1] = 0; continue; }
      s.t += step;
      if (s.t >= s.dur) { s.live = false; I[i * 2] = I[i * 2 + 1] = 0; continue; }
      const x = s.t / s.dur;
      const run = s.v * s.t;
      const tail = Math.min(run, s.trail);
      // light curve: a quick rise, a broad maximum late in the path, a fireball's terminal flare
      let L = s.peak * Math.min(1, x * 6) * Math.sin(Math.PI * Math.min(1, x * 0.95 + 0.05)) ** 0.6;
      if (s.fire && x > 0.8) { const z = (x - 0.9) / 0.05; L *= 1 + 3 * Math.exp(-z * z); }
      const hx = s.p0.x + s.dir.x * run, hy = s.p0.y + s.dir.y * run, hz = s.p0.z + s.dir.z * run;
      P[k] = hx; P[k + 1] = hy; P[k + 2] = hz;
      P[k + 3] = hx - s.dir.x * tail; P[k + 4] = hy - s.dir.y * tail; P[k + 5] = hz - s.dir.z * tail;
      I[i * 2] = L; I[i * 2 + 1] = 0;
      C[k] = C[k + 3] = s.col.r; C[k + 1] = C[k + 4] = s.col.g; C[k + 2] = C[k + 5] = s.col.b;
    }
    this.posAttr.needsUpdate = true;
    this.iAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
