import * as THREE from 'three';
import { U } from '../core/uniforms.js';

// Air effects around the piloted aerodyne (world metres):
//   Trail      a wingtip vortex: a camera-facing ribbon that condenses behind the duct rims in
//              hard, fast manoeuvres, widening and thinning as it ages
//   Downwash   the fans' wash on what is under them: a ring of spray over water, of dust over land,
//              thrown outward from under the craft when it hovers low
//   Heat       a faint shimmering glow in each duct's exhaust, brighter with thrust

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// ------------------------------------------------------------------ vortex trail --
const TRAIL_VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSide;
varying float vAlpha;
varying float vSide;
void main() {
  vAlpha = aAlpha; vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
varying float vSide;
void main() {
  float edge = 1.0 - vSide * vSide;             // soft across the ribbon
  gl_FragColor = vec4(uColor, vAlpha * edge * edge);
}`;

export class Trail {
  constructor(n = 96) {
    this.n = n;
    this.pts = [];                                // { p, age, s }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n * 2), 1).setUsage(THREE.DynamicDrawUsage));
    const side = new Float32Array(n * 2); for (let i = 0; i < n; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; }
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({ vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, uniforms: { uColor: { value: new THREE.Color(1, 1, 1) } }, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** Feed the tip's world position and the strength of the vortex (0..1). */
  update(dt, tip, strength, camPos, light) {
    for (const q of this.pts) q.age += dt;
    while (this.pts.length && this.pts[0].age > 2.2) this.pts.shift();
    const last = this.pts[this.pts.length - 1];
    if (strength > 0.01 && (!last || last.p.distanceToSquared(tip) > 0.8)) this.pts.push({ p: tip.clone(), age: 0, s: strength });
    else if (strength <= 0.01 && last) last.s *= Math.exp(-dt * 4);
    while (this.pts.length > this.n) this.pts.shift();
    const m = this.pts.length, pos = this.mesh.geometry.attributes.position, al = this.mesh.geometry.attributes.aAlpha;
    for (let i = 0; i < m; i++) {
      const q = this.pts[i], p = q.p;
      const nx = this.pts[Math.min(i + 1, m - 1)].p, pv = this.pts[Math.max(i - 1, 0)].p;
      _a.copy(nx).sub(pv); if (_a.lengthSq() < 1e-8) _a.set(0, 0, 1);
      _b.copy(camPos).sub(p);
      _c.crossVectors(_a, _b).normalize();
      const w = 0.12 + q.age * 0.9;
      pos.setXYZ(i * 2, p.x - _c.x * w, p.y - _c.y * w, p.z - _c.z * w);
      pos.setXYZ(i * 2 + 1, p.x + _c.x * w, p.y + _c.y * w, p.z + _c.z * w);
      const fade = Math.exp(-q.age * 1.6) * Math.min(1, (m - 1 - i) * 0.5 + 0.2);
      const a = 0.32 * q.s * fade;
      al.setX(i * 2, a); al.setX(i * 2 + 1, a);
    }
    pos.needsUpdate = true; al.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, Math.max(0, (m - 1) * 6));
    this.mat.uniforms.uColor.value.setRGB(0.95, 0.97, 1.0).multiplyScalar(light);
  }
}

// ------------------------------------------------------------------ downwash --
function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Downwash {
  constructor(n = 320) {
    this.n = n;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    this.col = new Float32Array(n * 4);
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.PointsMaterial({ size: 2.4, map: softDot(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.spawn = 0;
    this.k = 0;
  }

  /** centre: ground point under the craft; rate 0..1; water: spray (true) or dust. */
  update(dt, centre, groundY, rate, water, light) {
    this.spawn += rate * 260 * dt;
    while (this.spawn >= 1) {
      this.spawn -= 1;
      const i = this.k; this.k = (this.k + 1) % this.n;
      const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 3.5;
      this.p[i * 3] = centre.x + Math.cos(a) * r; this.p[i * 3 + 1] = groundY + 0.3; this.p[i * 3 + 2] = centre.z + Math.sin(a) * r;
      const sp = 9 + Math.random() * 10;
      this.v[i * 3] = Math.cos(a) * sp; this.v[i * 3 + 1] = (water ? 2.5 : 1.2) + Math.random() * 2.5; this.v[i * 3 + 2] = Math.sin(a) * sp;
      this.max[i] = this.life[i] = 1.1 + Math.random() * 1.4;
    }
    const c = water ? [0.92, 0.95, 1.0] : [0.62, 0.55, 0.44];
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const drag = Math.exp(-dt * 1.4);
      this.v[i * 3] *= drag; this.v[i * 3 + 2] *= drag; this.v[i * 3 + 1] = this.v[i * 3 + 1] * drag - 3.2 * dt;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] = Math.max(this.p[i * 3 + 1] + this.v[i * 3 + 1] * dt, groundY + 0.1); this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const f = Math.max(this.life[i], 0) / this.max[i];
      this.col[i * 4] = c[0] * light; this.col[i * 4 + 1] = c[1] * light; this.col[i * 4 + 2] = c[2] * light;
      this.col[i * 4 + 3] = 0.38 * f * (1 - f) * 4 * (water ? 1 : 0.8);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ exhaust heat --
const HEAT_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  vY = position.z;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const HEAT_FRAG = /* glsl */ `
uniform float uThrust; uniform float uTime; uniform vec3 uColor; uniform float uZ0;
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  float along = clamp((vY - uZ0) / 3.0, 0.0, 1.0);          // 0 at the duct exit, 1 at the far end
  float rim = pow(1.0 - abs(dot(normalize(vN), vV)), 1.5);
  float flicker = 0.85 + 0.15 * sin(uTime * 23.0 + vY * 6.0);
  float a = uThrust * (1.0 - along) * (1.0 - along) * (0.25 + 0.75 * rim) * flicker;
  gl_FragColor = vec4(uColor * a, 0.0);
}`;

/** A faint additive plume cone fixed in a duct's exhaust (duct frame: axis +Z, exit at +0.6 s). */
export function heatPlume(scale) {
  const g = new THREE.CylinderGeometry(1.2 * scale, 0.9 * scale, 3, 32, 1, true);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.62 * scale + 1.5);
  const m = new THREE.ShaderMaterial({
    vertexShader: HEAT_VERT, fragmentShader: HEAT_FRAG,
    uniforms: { uThrust: { value: 0 }, uTime: U.uTime, uColor: { value: new THREE.Color(0.55, 0.8, 1.0) }, uZ0: { value: 0.62 * scale } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 6;
  return mesh;
}
