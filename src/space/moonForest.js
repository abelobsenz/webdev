import * as THREE from 'three';
import { R_MOON } from './sim.js';
import { reliefH, gmask } from './moonTerrain.js';
import { U } from '../core/uniforms.js';

// Real trees on the terraformed Moon's woods, round the terrain patch's centre (the camera or the
// ship): three species built from a handful of primitives (a round-crowned broadleaf, a tiered
// conifer, a narrow poplar), instanced, each seated on the exact ground (moonTerrain.js reliefH,
// the function the terrain mesh is displaced by) wherever the read-back bake has woodland. The
// stands thin toward their margins, conifers take over up the slopes and the highlands, and the
// scatter fades out toward its rim (trees shrink into the ground, no hard edge). The crowns are lit
// with a wrapped diffuse (light through the leaves), darkened toward the trunk and the ground
// (the canopy's self-shadow), in the same units as the ground shader so they sit in its light.

const CELL = 0.016;          // km: one tree site per cell at full density
const CAP = 5200;            // per species

function lumpy(geo, amt, seed) {
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 1.7 + seed) * Math.sin(y * 2.3 + seed * 1.3) * Math.sin(z * 1.9 + seed * 0.7);
    const k = 1 + amt * n;
    p.setXYZ(i, x * k, y * (1 + amt * 0.5 * n), z * k);
  }
  geo.computeVertexNormals();
  return geo;
}
function tint(geo, r, g, b, aoBase = 1) {
  const p = geo.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    // darker low in the crown and toward the trunk: the canopy's own shade
    const ao = aoBase < 1 ? Math.min(1, aoBase + (1 - aoBase) * Math.max(0, Math.min(1, (p.getY(i) - 1) / 9))) : 1;
    c[i * 3] = r * ao; c[i * 3 + 1] = g * ao; c[i * 3 + 2] = b * ao;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
function merge(parts) {
  const geos = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of geos) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.getAttribute('position').array, o * 3);
    nor.set(g.getAttribute('normal').array, o * 3);
    col.set(g.getAttribute('color').array, o * 3);
    o += g.getAttribute('position').count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return m;
}
const TRUNK = [0.05, 0.035, 0.022];
// metres; +Y up, the foot at the origin
export function treeSpecies() {
  const broad = merge([
    tint(new THREE.CylinderGeometry(0.18, 0.3, 4.2, 6).translate(0, 2.1, 0), ...TRUNK),
    tint(lumpy(new THREE.IcosahedronGeometry(3.6, 2).scale(1, 0.82, 1).translate(0, 6.6, 0), 0.16, 1.3), 0.075, 0.12, 0.045, 0.45),
    tint(lumpy(new THREE.IcosahedronGeometry(2.2, 1).translate(1.6, 8.2, 0.7), 0.2, 4.1), 0.085, 0.13, 0.05, 0.55),
  ]);
  const tiers = [];
  for (let k = 0; k < 4; k++) {
    const r = 2.9 - k * 0.62, h = 4.2 - k * 0.55, y = 2.6 + k * 2.9;
    tiers.push(tint(new THREE.ConeGeometry(r, h, 9, 1, true).translate(0, y + h / 2, 0), 0.03, 0.06, 0.035, 0.5));
  }
  const conifer = merge([tint(new THREE.CylinderGeometry(0.14, 0.26, 4, 5).translate(0, 2, 0), ...TRUNK), ...tiers]);
  const poplar = merge([
    tint(new THREE.CylinderGeometry(0.12, 0.22, 3, 5).translate(0, 1.5, 0), ...TRUNK),
    tint(lumpy(new THREE.IcosahedronGeometry(1.5, 2).scale(1, 3.6, 1).translate(0, 7.8, 0), 0.14, 2.7), 0.06, 0.1, 0.04, 0.5),
  ]);
  // boulders and outcrop blocks: a squat, faceted lump half sunk into the ground
  const rock = merge([
    tint(lumpy(new THREE.IcosahedronGeometry(1.0, 1).scale(1.3, 0.75, 1.0).translate(0, 0.25, 0), 0.28, 5.3), 0.2, 0.19, 0.175),
    tint(lumpy(new THREE.IcosahedronGeometry(0.55, 1).scale(1.0, 0.8, 1.2).translate(1.1, 0.1, 0.5), 0.3, 8.7), 0.17, 0.165, 0.15),
  ]);
  return { broad, conifer, poplar, rock };
}

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vC;
varying vec3 vUpV;
void main() {
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  mat3 im = mat3(instanceMatrix);
  vN = normalize(normalMatrix * (im * normal));
  vUpV = normalize(normalMatrix * (im * vec3(0.0, 1.0, 0.0)));
  vC = color * instanceColor;
  gl_Position = projectionMatrix * mv;
}
`;
const FRAG = /* glsl */ `
uniform vec3 uSunV;          // toward the Sun, view space
uniform float uSunE;
uniform float uLit;          // the Sun's height at the patch (0 night .. 1 day)
uniform vec3 uSunCol;
varying vec3 vN;
varying vec3 vC;
varying vec3 vUpV;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float ndl = dot(n, uSunV);
  // wrapped diffuse: light comes through the leaves on the shaded side
  float wrap = max(ndl * 0.75 + 0.25, 0.0);
  vec3 E = uSunE * uSunCol * uLit * wrap;
  vec3 sky = uSunE * vec3(0.03, 0.05, 0.1) * (0.6 + 0.4 * dot(n, normalize(vUpV))) * max(uLit, 0.08);
  vec3 col = vC / 3.14159265 * (E + sky);
  gl_FragColor = vec4(col, 1.0);
}
`;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _up = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0), _yaw = new THREE.Quaternion(), _c = new THREE.Color();
const _gm = [0, 0, 0, 0];
const hash = (i, j, k) => { let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(k | 0, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export class MoonForest {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Moon: trees round the camera';
    this.anchor = new THREE.Vector3(1, 0, 0);
    this.uniforms = {
      uSunV: { value: new THREE.Vector3(0, 1, 0) }, uSunE: U.uSunIlluminance ?? { value: 1 },
      uLit: { value: 1 }, uSunCol: { value: new THREE.Vector3(1, 0.975, 0.94) },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, vertexColors: true, side: THREE.DoubleSide });
    const sp = treeSpecies();
    this.meshes = ['broad', 'conifer', 'poplar', 'rock'].map((k) => {
      const m = new THREE.InstancedMesh(sp[k], this.material, CAP);
      m.count = 0;
      m.frustumCulled = false;
      m.name = `Moon trees: ${k}`;
      for (let i = 0; i < CAP; i++) m.setColorAt(i, _c.setRGB(1, 1, 1));
      this.group.add(m);
      return m;
    });
    this.capacity = CAP * 4;
    this.positions = [];           // body-frame positions of the last scatter (km), for checks
    this.centre = new THREE.Vector3(0, 0, 0);
  }

  /** Scatter the trees within radius (km) of the unit direction c (Moon body frame). Returns the count. */
  scatter(c, radius = 0.45) {
    this.centre.copy(c);
    const R = R_MOON;
    const e1 = new THREE.Vector3(0, 1, 0).cross(c);
    if (e1.lengthSq() < 1e-8) e1.set(1, 0, 0).cross(c);
    e1.normalize();
    const e2 = c.clone().cross(e1);
    // the anchor: the patch centre on the sphere, so instance offsets stay small (float32-safe)
    this.group.position.copy(c).multiplyScalar(R);
    this.group.updateMatrix();
    // cells on a fixed grid of the tangent plane at the direction snapped to ~1 km, so trees stay
    // put as the centre moves a little
    const n = Math.ceil(radius / CELL);
    const cnt = [0, 0, 0, 0];
    this.positions.length = 0;
    const seen = new Set();
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const x = i * CELL, y = j * CELL;
      if (x * x + y * y > radius * radius) continue;
      // the world-fixed site id: the cell's own point rounded on a global 16 m lattice
      const px = c.x * R + e1.x * x + e2.x * y, py = c.y * R + e1.y * x + e2.y * y, pz = c.z * R + e1.z * x + e2.z * y;
      const gi = Math.round(px / CELL), gj = Math.round(py / CELL), gk = Math.round(pz / CELL);
      const key = `${gi},${gj},${gk}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const h0 = hash(gi, gj, gk), h1 = hash(gj + 7, gk - 3, gi + 11), h2 = hash(gk + 5, gi - 9, gj + 2);
      _p.set(gi * CELL + (h1 - 0.5) * CELL, gj * CELL + (h2 - 0.5) * CELL, gk * CELL + (h0 - 0.5) * CELL * 0.5).normalize();
      gmask(_p.x, _p.y, _p.z, _gm);
      const wood = _gm[3] * (_gm[2] < 0.3 ? 1 : 0);
      // boulders on the open, high and bare ground (the highland share from the bake's height)
      const rocky = _gm[0] > 0.9 && wood < 0.2 ? Math.max(0, (_gm[1] * 5 - 1.2) / 2.5) * 0.18 + 0.015 : 0;
      const isRock = h0 > wood * 0.95;
      if (isRock && h1 > rocky) continue;
      const info = {};
      const h = reliefH(_p.x, _p.y, _p.z, 0, info);
      if (info.mask <= 0) continue;              // not on the Landing's levelled ground or the towns
      // conifers up the slopes and on the highlands, poplars along the valley floors
      const hs = hash(gi + 3, gj + 5, gk + 7);
      const sp = isRock ? 3 : hs < 0.15 + 0.7 * Math.min(1, info.hi * 1.2 + h * 1.5) ? 1 : (info.valley > 0.5 && hs > 0.8 ? 2 : 0);
      const mesh = this.meshes[sp];
      if (cnt[sp] >= CAP) continue;
      const d = Math.hypot(x, y);
      const edge = 1 - Math.max(0, Math.min(1, (d - radius * 0.75) / (radius * 0.25)));
      const hz = hash(gk + 1, gj + 2, gi + 3);
      const s = (isRock ? 0.6 + 3.2 * hz * hz * hz : 0.7 + 0.6 * hz) * (0.35 + 0.65 * edge) * 0.001;
      const pos = _p.clone().multiplyScalar(R + h);
      this.positions.push(pos);
      _up.copy(_p);
      _q.setFromUnitVectors(_Y, _up);
      _yaw.setFromAxisAngle(_Y, hs * Math.PI * 2);
      _q.multiply(_yaw);
      _m.compose(_s.copy(pos).sub(this.group.position), _q, _p.set(s, s, s));
      mesh.setMatrixAt(cnt[sp], _m);
      const v = 0.8 + 0.4 * hash(gi - 1, gj - 2, gk - 3);
      if (isRock) mesh.setColorAt(cnt[sp], _c.setRGB(v * (0.97 + 0.08 * h2), v, v * 0.95));
      else mesh.setColorAt(cnt[sp], _c.setRGB(v * (0.95 + 0.1 * h2), v, v * (0.9 + 0.2 * h1)));
      cnt[sp]++;
    }
    this.meshes.forEach((m, k) => { m.count = cnt[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    this.counts = cnt.slice();
    return cnt[0] + cnt[1] + cnt[2] + cnt[3];
  }

  /** Light: the Sun's direction in view space, and its height at the centre (Moon-frame sun, unit). */
  light(sunView, sunM) {
    this.uniforms.uSunV.value.copy(sunView);
    const mu = this.centre.dot(sunM);
    this.uniforms.uLit.value = THREE.MathUtils.smoothstep(mu, -0.012, 0.012);
    const k = THREE.MathUtils.smoothstep(mu, -0.01, 0.14);
    this.uniforms.uSunCol.value.set(1, 0.62 + 0.355 * k, 0.36 + 0.58 * k);
  }
}
