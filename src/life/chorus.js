import * as THREE from 'three';
import { mulberry32, createNoise2D } from '../world/noise.js';
import { aerialShaderMaterial } from '../world/materials.js';
import { CHORUS } from '../world/layout.js';

/**
 * The Chorus: a monument of programmable matter — tens of thousands of
 * hovering motes that tell humanity's story by morphing between forms.
 */
const TAU = Math.PI * 2;
const n2 = createNoise2D(4040);

function gauss(rnd) { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }

const SHAPES = [
  {
    name: 'Stardust', caption: 'Origins. The atoms in every living thing were forged in dying stars.',
    gen(i, n, rnd, out, col) {
      // a supernova: a bright shell of ejecta streaming out along radial filaments
      const u = rnd() * 2 - 1, a = rnd() * TAU;
      const s = Math.sqrt(1 - u * u);
      const dir = new THREE.Vector3(Math.cos(a) * s, u, Math.sin(a) * s);
      const k = rnd();
      let r;
      if (k < 0.12) { r = Math.abs(gauss(rnd)) * 0.06; col.setRGB(1.0, 0.95, 0.85); }
      else if (k < 0.62) { r = 0.78 + gauss(rnd) * 0.03; col.setRGB(0.55, 0.7, 1.0); }
      else {
        // filaments: quantise direction so streaks form
        const fu = Math.round(u * 14) / 14, fa = Math.round(a * 9) / 9;
        const fs = Math.sqrt(Math.max(0, 1 - fu * fu));
        dir.set(Math.cos(fa) * fs, fu, Math.sin(fa) * fs);
        r = 0.1 + rnd() * 0.9;
        col.setRGB(1.0, 0.55 + 0.3 * (1 - r), 0.35 + 0.2 * r);
      }
      out.copy(dir).multiplyScalar(r);
    },
  },
  {
    name: 'Helix', caption: 'Life. Four letters, written and rewritten for four billion years.',
    gen(i, n, rnd, out, col) {
      const t = rnd();
      const y = (t - 0.5) * 2.0;
      const a = t * TAU * 3.2;
      const k = rnd();
      if (k < 0.72) {
        const strand = k < 0.36 ? 0 : Math.PI;
        const rr = 0.36 + gauss(rnd) * 0.015;
        out.set(Math.cos(a + strand) * rr, y, Math.sin(a + strand) * rr);
        col.setRGB(0.5, 0.8, 1.0);
      } else {
        // base-pair rungs
        const rung = Math.floor(t * 64) / 64;
        const ar = rung * TAU * 3.2;
        const s = rnd() * 2 - 1;
        out.set(Math.cos(ar) * 0.36 * s, (rung - 0.5) * 2.0, Math.sin(ar) * 0.36 * s);
        const pal = [[1, 0.55, 0.35], [0.4, 1, 0.6], [1, 0.85, 0.4], [0.8, 0.5, 1]][Math.floor(rung * 64) % 4];
        col.setRGB(pal[0], pal[1], pal[2]);
      }
    },
  },
  {
    name: 'Tree of Life', caption: 'Evolution. One lineage branching into every form that ever lived.',
    init(rnd) {
      const branches = [];
      const grow = (p, dir, len, depth) => {
        const end = p.clone().addScaledVector(dir, len);
        branches.push({ a: p, b: end, depth });
        if (depth >= 6) return;
        const nb = depth < 2 ? 3 : 2;
        for (let k = 0; k < nb; k++) {
          const nd = dir.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.3, 0.35 + rnd() * 0.4, (rnd() - 0.5) * 1.3)).normalize();
          grow(end, nd, len * (0.62 + rnd() * 0.12), depth + 1);
        }
      };
      grow(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0), 0.55, 0);
      return { branches };
    },
    gen(i, n, rnd, out, col, ctx) {
      const b = ctx.branches[Math.floor(Math.pow(rnd(), 0.8) * ctx.branches.length)];
      const t = rnd();
      out.copy(b.a).lerp(b.b, t);
      const th = 0.05 * Math.pow(0.7, b.depth);
      out.x += gauss(rnd) * th; out.y += gauss(rnd) * th; out.z += gauss(rnd) * th;
      if (b.depth >= 5 && rnd() < 0.5) { out.x += gauss(rnd) * 0.05; out.y += gauss(rnd) * 0.05; out.z += gauss(rnd) * 0.05; col.setRGB(0.4, 1.0, 0.45); }
      else col.setRGB(0.9, 0.75, 0.45);
    },
  },
  {
    name: 'Fire', caption: 'Fire. The first technology, and the first gathering around a light.',
    gen(i, n, rnd, out, col) {
      const t = rnd();
      const y = -0.9 + t * 1.8;
      const w = 0.55 * Math.pow(1 - t, 0.9) * (0.6 + 0.4 * Math.sin(t * 9 + rnd()));
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * w;
      const flick = n2(a * 2, t * 4) * 0.12 * t;
      out.set(Math.cos(a) * r + flick, y, Math.sin(a) * r);
      col.setRGB(1.0, 0.35 + 0.55 * (1 - t) * (1 - r / (w + 1e-3)), 0.08 + 0.3 * (1 - t) * 0.5);
    },
  },
  {
    name: 'Home', caption: 'Home. One world, seen whole for the first time.',
    gen(i, n, rnd, out, col) {
      if (rnd() < 0.9) {
        const u = rnd() * 2 - 1, a = rnd() * TAU;
        const s = Math.sqrt(1 - u * u);
        out.set(Math.cos(a) * s, u, Math.sin(a) * s).multiplyScalar(0.72);
        const land = n2(Math.cos(a) * s * 2.2 + 3, u * 2.2 + Math.sin(a) * s * 1.7);
        if (Math.abs(u) > 0.88) col.setRGB(0.95, 0.97, 1.0);
        else if (land > 0.18) col.setRGB(0.35, 0.75, 0.3);
        else col.setRGB(0.15, 0.4, 1.0);
      } else {
        // orbital ring of lights around the little world
        const a = rnd() * TAU;
        out.set(Math.cos(a) * 0.95, Math.sin(a) * 0.95 * 0.12, Math.sin(a) * 0.95);
        col.setRGB(1.0, 0.85, 0.55);
      }
    },
  },
  {
    name: 'Atom', caption: 'Knowledge. The smallest things, understood and gently mastered.',
    gen(i, n, rnd, out, col) {
      const k = rnd();
      if (k < 0.18) {
        out.set(gauss(rnd), gauss(rnd), gauss(rnd)).multiplyScalar(0.09);
        col.setRGB(1.0, 0.6, 0.3);
      } else {
        const orbit = Math.floor(rnd() * 3);
        const a = rnd() * TAU;
        const p = new THREE.Vector3(Math.cos(a) * 0.95, 0, Math.sin(a) * 0.36);
        p.applyAxisAngle(new THREE.Vector3(0, 0, 1), orbit * TAU / 3);
        p.applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
        out.copy(p).add(new THREE.Vector3(gauss(rnd), gauss(rnd), gauss(rnd)).multiplyScalar(0.012));
        col.setRGB(0.5, 0.8, 1.0);
      }
    },
  },
  {
    name: 'Ascent', caption: 'Ascent. The Axis, and the rings we raised around the world.',
    gen(i, n, rnd, out, col) {
      const k = rnd();
      if (k < 0.3) {
        const t = rnd();
        const r = 0.06 * (1 - t * 0.5) + 0.12 * Math.exp(-t * 6);
        const a = rnd() * TAU;
        out.set(Math.cos(a) * r, -1 + t * 2.0, Math.sin(a) * r);
        col.setRGB(1, 0.9, 0.75);
      } else {
        const ring = Math.floor(rnd() * 3);
        const a = rnd() * TAU;
        const R = [0.8, 0.95, 0.95][ring];
        const p = new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0);
        if (ring === 1) p.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
        if (ring === 2) p.applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.5);
        p.y -= 0.25;
        out.copy(p);
        col.setRGB(ring === 0 ? 1.0 : 0.6, ring === 0 ? 0.75 : 0.8, ring === 0 ? 0.45 : 1.0);
      }
    },
  },
  {
    name: 'Horizon', caption: 'Horizon. A hundred billion suns, and the long voyage ahead.',
    gen(i, n, rnd, out, col) {
      const k = rnd();
      if (k < 0.15) {
        out.set(gauss(rnd) * 0.12, gauss(rnd) * 0.06, gauss(rnd) * 0.12);
        col.setRGB(1.0, 0.85, 0.6);
      } else {
        const arm = Math.floor(rnd() * 2);
        const t = Math.pow(rnd(), 0.7);
        const a = arm * Math.PI + t * 4.2;
        const r = 0.08 + t * 0.9;
        out.set(Math.cos(a) * r + gauss(rnd) * 0.05 * (1 + t), gauss(rnd) * 0.025, Math.sin(a) * r + gauss(rnd) * 0.05 * (1 + t));
        const young = rnd() < 0.2;
        col.setRGB(young ? 0.6 : 0.9, young ? 0.75 : 0.85, young ? 1.0 : 0.8);
      }
      // tilt the galaxy toward the viewer
      out.applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.55);
    },
  },
];

const VERT = /* glsl */ `
uniform float uTime;
uniform float uMorph;
uniform float uScale;
uniform vec3 uCenter;
uniform float uPx;
attribute vec3 posA; attribute vec3 posB; attribute vec3 colA; attribute vec3 colB; attribute float aSeed;
varying vec3 vCol; varying vec3 vW; varying float vGlow; varying float vSeed; varying float vPs;
vec3 swirl(vec3 p, float s) {
  return vec3(sin(p.y * 3.1 + s * 6.0 + uTime * 0.7), sin(p.z * 2.7 + s * 5.0 - uTime * 0.6), sin(p.x * 3.3 + s * 4.0 + uTime * 0.5));
}
void main() {
  // staggered morph: a wave sweeps up through the form
  float delay = (posB.y * 0.5 + 0.5) * 0.35 + aSeed * 0.25;
  float m = smoothstep(delay, delay + 0.4, uMorph);
  vec3 p = mix(posA, posB, m);
  float mid = sin(m * 3.14159);
  p += swirl(p, aSeed) * 0.18 * mid;
  // perpetual gentle shimmer
  p += swirl(p * 2.0, aSeed + 3.0) * 0.006;
  vec3 w = uCenter + p * uScale;
  vW = w;
  vCol = mix(colA, colB, m);
  // depth cue: motes on the far side of the form are dimmer
  vec3 toCam = normalize(cameraPosition - uCenter);
  float facing = smoothstep(-0.35, 0.35, dot(normalize(p + 1e-4), toCam));
  vGlow = (1.0 + mid * 1.5) * (0.4 + 0.6 * facing);
  vSeed = aSeed;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uPx * 2.1 / -mv.z, 1.0, 14.0);
  vPs = uPx * 2.1 / -mv.z;
}`;

const FRAG = /* glsl */ `
varying vec3 vCol; varying vec3 vW; varying float vGlow; varying float vSeed; varying float vPs;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  vec3 nrm = normalize(vec3(c.x * 2.0, -c.y * 2.0, sqrt(max(1.0 - d, 0.0))));
  // mote lit by the sun (programmable matter is mirror-bright) + its own light
  // by day the motes read as polished metal: a pale body with a sharp sun glint
  vec3 V = normalize(cameraPosition - vW);
  vec3 H = normalize(V + uSunDir);
  float spec = pow(max(dot(nrm, uSunDir), 0.0), 2.0);
  // each mote turns its facet to the sun now and then: a slow, smooth swell, never an on/off
  // flicker, and dimmed to its share of the pixel once the mote is smaller than a few pixels
  float gp = fract(vSeed * 91.7 + uTime * 0.05) - 0.95;
  float glint = pow(max(dot(H, nrm), 0.0), 40.0) * exp(-gp * gp * 1600.0) * smoothstep(1.0, 4.0, vPs);
  vec3 metal = mix(vec3(0.82, 0.84, 0.88), vCol, 0.3);
  // polished rim: the sky it faces, brighter at grazing angles
  float rimF = pow(1.0 - max(dot(nrm, vec3(0.0, 0.0, 1.0)), 0.0), 3.0) * smoothstep(2.0, 6.0, vPs);
  metal *= 0.9 + 0.35 * rimF;
  vec3 base = metal * (uSunColor * uSunIlluminance * (0.06 + 0.1 * spec) + aerialInscatter(vec3(0.0, 1.0, 0.0)) * 0.25) * (0.55 + 0.45 * vGlow) + uSunColor * uSunIlluminance * glint * 0.8;
  vec3 emit = vCol * (0.02 + 0.13 * uCityLights) * vGlow * (1.0 - d * 0.6);
  vec3 col = applyAerial(base + emit, vW);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Chorus {
  constructor(scene, settings) {
    this.count = 100000;
    const rnd = mulberry32(31337);
    this.rnd = rnd;
    this.targets = SHAPES.map((s) => {
      const ctx = s.init ? s.init(rnd) : null;
      const pos = new Float32Array(this.count * 3);
      const col = new Float32Array(this.count * 3);
      const v = new THREE.Vector3(), c = new THREE.Color();
      for (let i = 0; i < this.count; i++) {
        s.gen(i, this.count, rnd, v, c, ctx);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      return { pos, col };
    });
    const g = new THREE.BufferGeometry();
    const seeds = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) seeds[i] = rnd();
    this.posA = new THREE.BufferAttribute(this.targets[0].pos.slice(), 3);
    this.posB = new THREE.BufferAttribute(this.targets[1].pos.slice(), 3);
    this.colA = new THREE.BufferAttribute(this.targets[0].col.slice(), 3);
    this.colB = new THREE.BufferAttribute(this.targets[1].col.slice(), 3);
    g.setAttribute('position', this.posA);
    g.setAttribute('posA', this.posA);
    g.setAttribute('posB', this.posB);
    g.setAttribute('colA', this.colA);
    g.setAttribute('colB', this.colB);
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.material = aerialShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uMorph: { value: 0 }, uScale: { value: CHORUS.scale }, uCenter: { value: new THREE.Vector3(CHORUS.x, CHORUS.y, CHORUS.z) }, uPx: { value: 1000 },
      },
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.index = 0;
    this.phase = 0;
    this._show(4);
    this.hold = 11;
    this.morph = 5;
    this.applyQuality(settings);
  }

  _show(i) {
    this.index = i;
    const a = this.targets[i], b = this.targets[(i + 1) % SHAPES.length];
    this.posA.array.set(a.pos); this.colA.array.set(a.col);
    this.posB.array.set(b.pos); this.colB.array.set(b.col);
    this.posA.needsUpdate = this.colA.needsUpdate = this.posB.needsUpdate = this.colB.needsUpdate = true;
  }

  get current() { return SHAPES[this.index % SHAPES.length]; }
  get next() { return SHAPES[(this.index + 1) % SHAPES.length]; }

  setSize(w, h) {
    // pixels per world unit at distance 1 for a 60° vertical fov
    this.material.uniforms.uPx.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(30)));
  }

  applyQuality(s) {
    this.points.geometry.setDrawRange(0, Math.floor(this.count * s.particles));
  }

  update(dt) {
    this.phase += dt;
    const total = this.hold + this.morph;
    if (this.phase >= total) {
      this.phase -= total;
      this._show((this.index + 1) % SHAPES.length);
    }
    const m = Math.max(0, (this.phase - this.hold) / this.morph);
    this.material.uniforms.uMorph.value = m;
  }

  get morphing() { return this.phase > this.hold; }

  /** Name of the form currently displayed (or forming). */
  get label() { return this.phase > this.hold ? `${this.current.name} → ${this.next.name}` : this.current.name; }
  get caption() { return this.phase > this.hold + this.morph * 0.5 ? this.next.caption : this.current.caption; }
}
