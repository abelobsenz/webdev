import * as THREE from 'three';
import { SNOISE_GLSL } from './glsl.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { SKY_UNIFORMS } from './sky.js';
import { U } from '../core/uniforms.js';

// The Sun (a real sphere once you are close enough to see its surface) and the Dyson swarm.
//
// Photosphere: limb darkening with its reddening, granulation and the mesogranular mottle
// (each scale fading to its mean before it can shimmer), sunspot groups in the active belts
// with umbra, filamentary penumbra and the bright faculae that show near the limb.
// Above the limb (a billboard through the centre, all features computed in 3D so they stay
// on the Sun as you circle it): the chromosphere's pink rim with its spicules, prominences
// as glowing sheets (hedgerows and loops) standing on the surface, and the corona's
// streamers and polar plumes.
// Close to the Sun the eye stops down: the disc is exposed so its centre sits just below
// white, and everything else is set relative to it.
// The swarm: collector mirrors on four inclined rings and the polar statite discs, each an
// instanced mirror panel turned to the Sun, glinting as it reflects the Sun toward you and
// never smaller than a pixel and a bit (its light then spread to keep its energy).

const R_SUN = 696000;
const AU = 1.496e8;

// active regions: [latitude, longitude (deg), size (deg), tilt (rad)]
const SPOTS = [
  [14, 20, 3.2, 0.2], [-11, 62, 2.4, -0.15], [22, 118, 2.0, 0.3], [-18, 170, 3.6, -0.25],
  [9, -140, 1.8, 0.1], [-24, -95, 2.6, -0.3], [17, -40, 2.2, 0.25], [-7, -10, 1.5, 0.05],
];
// prominences: [footpoint lat, lon, length (deg), height (R), azimuth of the sheet (rad), kind 0 hedgerow / 1 loop]
const PROMS = [
  [8, 95, 16, 0.15, 0.4, 0], [-30, -80, 22, 0.1, 1.2, 0], [40, -20, 10, 0.2, 2.1, 1],
  [-12, 150, 12, 0.24, 0.2, 1], [25, 200, 18, 0.13, 1.9, 0], [-45, 30, 14, 0.09, 0.9, 0],
  [3, -130, 9, 0.18, 2.8, 1], [55, 120, 20, 0.08, 0.3, 0], [-20, 250, 8, 0.14, 1.4, 1],
];

const SUN_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const SUN_FRAG = /* glsl */ `
uniform float uDiscL;         // radiance of the disc centre
uniform float uTime;
uniform vec4 uSpot[8];        // centre (unit, sun frame) + angular size (rad)
uniform vec4 uSpotE[8];       // group axis (unit, tangent) + tilt
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vWorld;
${NOISE_GLSL}
${SNOISE_GLSL}
// convection cells: bright interiors, dark lanes between them (0..1, mean ~0.62)
float cellsN(vec3 p) {
  vec3 i = floor(p);
  float f1 = 9.0, f2 = 9.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 c = i + vec3(float(x), float(y), float(z));
    vec3 o = c + hash33(c);
    float d = length(p - o);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return smoothstep(0.0, 0.3, f2 - f1);
}
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 n = normalize(vN);
  float mu = clamp(dot(n, V), 0.0, 1.0);
  vec3 p = normalize(vLocal);
  float px = max(length(fwidth(vLocal)) * ${R_SUN.toFixed(1)}, 1.0);     // km per pixel
  // limb darkening (quadratic law per channel), the limb warmer
  float m1 = 1.0 - mu;
  vec3 limb = vec3(1.0) - vec3(0.47, 0.58, 0.7) * m1 - vec3(0.2, 0.18, 0.12) * m1 * m1;
  float I = 1.0;
  // granulation (~1,400 km cells) and the mesogranular mottle (~7,000 km), each fading to
  // its mean while it still spans a few pixels; the pattern evolves slowly
  float fG = 1.0 - smoothstep(250.0, 700.0, px);
  if (fG > 0.0) I *= mix(1.0, 0.8 + 0.32 * cellsN(p * (${R_SUN.toFixed(1)} / 1400.0) + vec3(0.0, uTime * 0.02, 0.0)), fG);
  float fM = 1.0 - smoothstep(1200.0, 3500.0, px);
  if (fM > 0.0) I *= mix(1.0, 0.95 + 0.08 * cellsN(p * (${R_SUN.toFixed(1)} / 7000.0) + 5.0), fM);
  // a faint large-scale brightness texture that holds at any range
  I *= 0.985 + 0.03 * snoise(p * 9.0 + 2.0);
  // sunspot groups: a leader and a follower with pores between, umbra and filamentary
  // penumbra; faculae round each group, bright toward the limb
  float fac = 0.0;
  float aa = px / ${R_SUN.toFixed(1)};                                        // pixel, in radians
  for (int k = 0; k < 8; k++) {
    vec3 c = uSpot[k].xyz;
    float s = uSpot[k].w;
    float dc = acos(clamp(dot(p, c), -1.0, 1.0));
    if (dc > s * 4.0) continue;
    vec3 e = uSpotE[k].xyz;
    vec3 f = cross(c, e);
    // positions in the group's tangent frame (radians)
    vec2 q = vec2(dot(p - c, e), dot(p - c, f));
    fac += exp(-dot(q, q) / (s * s * 3.2)) * (0.6 + 0.4 * snoise(p * 260.0 + float(k)));
    for (int j = 0; j < 4; j++) {
      float fj = float(j);
      vec2 sc = j == 0 ? vec2(-0.45, 0.05) * s : j == 1 ? vec2(0.5, -0.08) * s : vec2(0.05 + 0.2 * fj - 0.4, 0.12 * (fj - 2.5)) * s;
      float ru = j == 0 ? 0.2 * s : j == 1 ? 0.14 * s : 0.05 * s;
      vec2 dq = q - sc;
      float d = length(dq);
      float rp = ru * (j < 2 ? 2.3 : 1.6);
      float wu = max(aa, ru * 0.12), wp = max(aa, rp * 0.08);
      float um = 1.0 - smoothstep(ru - wu, ru + wu, d);
      float pe = 1.0 - smoothstep(rp - wp, rp + wp, d);
      if (pe <= 0.0) continue;
      // radial penumbral filaments, resolved only when they span a few pixels
      float ang = atan(dq.y, dq.x);
      float fil = 0.5 + 0.5 * sin(ang * 46.0 + 3.0 * snoise(vec3(dq / max(rp, 1e-5) * 3.0, fj)));
      float filK = 1.0 - smoothstep(0.5, 1.5, aa * 46.0 / max(rp, 1e-5));
      float penI = 0.72 + 0.14 * mix(0.5, fil, filK);
      I *= mix(1.0, mix(penI, 0.2, um), pe);
    }
  }
  I += fac * 0.22 * pow(m1, 1.5);
  // the disc's own edge, a pixel wide
  vec3 col = vec3(1.0, 0.94, 0.84) * limb * I * uDiscL;
  gl_FragColor = vec4(col, 0.0);   // the Sun never occludes its own glare
}
`;

const CORONA_VERT = /* glsl */ `
varying vec3 vPos;        // fragment, view space (km)
varying vec3 vCen;        // the Sun's centre, view space (km)
void main() {
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vCen = mv.xyz;
  mv.xy += position.xy;
  vPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const CORONA_FRAG = /* glsl */ `
uniform float uDiscL;
uniform float uTime;
uniform float uPixAng;
uniform vec4 uProm[9];        // sheet normal (world) + kind
uniform vec4 uPromA[9];       // first footpoint (unit, world) + angular length (rad)
uniform vec4 uPromH[9];       // height (R) , seed, -, -
varying vec3 vPos;
varying vec3 vCen;
${NOISE_GLSL}
${SNOISE_GLSL}
#define RS ${R_SUN.toFixed(1)}
void main() {
  vec3 rd = normalize(vPos);
  float tc = dot(rd, vCen);
  vec3 ca = rd * tc - vCen;                     // closest approach, relative to the centre
  float b = length(ca) / RS;                    // impact parameter, solar radii
  if (b > 5.0 || tc < 0.0) discard;
  mat3 toW = transpose(mat3(viewMatrix));
  vec3 dirW = normalize(toW * ca);
  float px = uPixAng * max(tc, 1.0) / RS;       // pixel, in solar radii
  // the photosphere along this ray (prominences behind it are hidden)
  float disc2 = tc * tc - dot(vCen, vCen) + RS * RS;
  float tHit = disc2 > 0.0 ? tc - sqrt(disc2) : 1e30;
  float h = max(b - 1.0, 0.0);
  vec3 col = vec3(0.0);
  // corona: streamers fixed on the Sun, falling off steeply; polar plumes
  float st = sfbm(dirW * 2.5 + vec3(0.0, uTime * 0.002, 0.0), 3) * 0.5 + 0.5;
  float helmet = exp(-pow(dirW.y / 0.45, 2.0));
  float plume = pow(0.5 + 0.5 * snoise(dirW * vec3(26.0, 4.0, 26.0)), 3.0) * smoothstep(0.65, 0.92, abs(dirW.y)) * (1.0 - smoothstep(0.3, 1.2, px * 26.0));
  float cor = pow(max(b, 1.0), -3.3) * (0.35 + 0.9 * st * (0.5 + helmet)) + 0.4 * plume * pow(max(b, 1.0), -2.5);
  cor += 0.02 * pow(max(b, 1.0), -1.6);
  col += vec3(1.0, 0.94, 0.86) * cor * 0.07 * smoothstep(5.0, 3.0, b);
  // the chromosphere: a thin pink rim with spicules
  float rimW = max(0.006, px * 1.5);
  float spic = 0.6 + 0.4 * snoise(dirW * 700.0 + vec3(uTime * 0.05));
  float chrom = exp(-h / (0.0045 + 0.004 * spic)) * min(1.0, 0.006 / rimW);
  col += vec3(1.0, 0.36, 0.38) * chrom * 0.38;
  // prominences: sheets of glowing gas standing in vertical planes on the surface
  for (int k = 0; k < 9; k++) {
    vec3 nW = uProm[k].xyz;
    vec3 nV = mat3(viewMatrix) * nW;
    float dn = dot(rd, nV);
    if (abs(dn) < 1e-4) continue;
    float t = dot(vCen, nV) / dn;               // the sheet plane passes through the centre
    if (t <= 0.0 || t > tHit) continue;
    vec3 x = toW * (rd * t - vCen) / RS;        // sun-centred, world orientation, radii
    float r = length(x);
    float hh = r - 1.0;
    if (hh < -0.01 || hh > 0.45) continue;
    vec3 e1 = uPromA[k].xyz;
    vec3 e2 = cross(nW, e1);
    float th = atan(dot(x, e2), dot(x, e1));
    float L = uPromA[k].w;
    float u = th / L;
    if (u < -0.05 || u > 1.05) continue;
    float H = uPromH[k].x;
    float seed = uPromH[k].y;
    float uc = clamp(u, 0.0, 1.0);
    float arch = H * pow(sin(3.14159 * uc), 0.7);
    float ends = smoothstep(-0.05, 0.05, u) * (1.0 - smoothstep(0.95, 1.05, u));
    float dens;
    if (uProm[k].w < 0.5) {
      // hedgerow: a curtain of fine vertical threads under an irregular top
      float top = arch * (0.75 + 0.35 * snoise(vec3(u * 6.0, seed, uTime * 0.01)));
      float body = smoothstep(top + 0.01, top - 0.02, hh) * smoothstep(-0.01, 0.01, hh);
      float thr = 0.55 + 0.45 * snoise(vec3(u * 90.0, hh * 8.0, seed + uTime * 0.02));
      float thrK = 1.0 - smoothstep(0.3, 1.0, px * 90.0 / max(L, 1e-3));
      dens = body * mix(0.7, thr, thrK) * (0.5 + 0.5 * smoothstep(0.0, top + 1e-3, hh + 0.3 * top));
    } else {
      // loop: a bright arch of plasma, a little ragged
      float w = 0.012 + 0.006 * snoise(vec3(u * 10.0, seed, 1.0));
      float d = hh - arch;
      dens = exp(-d * d / (w * w)) * (0.8 + 0.4 * snoise(vec3(u * 40.0, seed, uTime * 0.03)));
      // the fainter arcade inside the loop
      dens += 0.25 * smoothstep(arch, arch * 0.4, hh) * smoothstep(-0.01, 0.02, hh);
    }
    // a thin sheet: brighter seen edge-on (longer path), capped
    float path = min(1.0 / max(abs(dn), 0.2), 3.0);
    col += vec3(1.0, 0.38, 0.32) * dens * ends * path * 0.42;
  }
  gl_FragColor = vec4(col * uDiscL, 0.0);
}
`;

// ------------------------------------------------------------------ swarm --
const SWARM_VERT = /* glsl */ `
attribute vec2 aCorner;   // quad corner, -1..1
attribute vec4 aS;        // x: ring id (0..3, 4 = statite), y: angle, z: radial jitter, w: axial jitter
uniform vec4 uRings[4];   // normal + radius
uniform vec3 uSunPos;
uniform float uT;         // sim seconds
uniform float uPixAng;
uniform float uFade;
uniform float uTime;
varying vec3 vCol;
varying vec2 vUv;
varying float vGlint;
varying float vSheen;
varying float vBody;
varying float vUnres;
varying float vFade;
${NOISE_GLSL}
void main() {
  int k = int(aS.x + 0.5);
  vec3 p;
  if (k < 4) {
    vec4 rg = uRings[k];
    vec3 n = rg.xyz;
    vec3 e1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(n, e1);
    float a = rg.w / ${AU.toFixed(1)};
    float period = 365.25 * 86400.0 * pow(a, 1.5);
    float th = aS.y + 6.2831853 * fract(uT / period);
    float R = rg.w * (1.0 + aS.z);
    p = (e1 * cos(th) + e2 * sin(th)) * R + n * aS.w * rg.w;
    vCol = vec3(1.0, 0.86, 0.58);
  } else {
    // statites: held above the poles by light pressure, in slowly turning discs
    float side = aS.w > 0.0 ? 1.0 : -1.0;
    float rr = aS.z * 0.035 * ${AU.toFixed(1)};
    float th = aS.y + uTime * 0.01;
    p = vec3(cos(th) * rr, side * (0.02 + 0.01 * abs(aS.w)) * ${AU.toFixed(1)}, sin(th) * rr);
    vCol = vec3(0.78, 0.88, 1.0);
  }
  vec3 w = uSunPos + p;
  vec3 toSun = -normalize(p);
  vec3 toCam = cameraPosition - w;
  float dist = length(toCam);
  toCam /= max(dist, 1.0);
  // each mirror faces the Sun, tilted toward its receiver, the tilt wandering slowly
  float h = hash11(aS.y * 91.7 + aS.x * 13.1);
  vec3 jit = vec3(h - 0.5, fract(h * 7.0) - 0.5, fract(h * 13.0) - 0.5);
  jit += 0.25 * vec3(sin(uTime * 0.07 + h * 40.0), sin(uTime * 0.05 + h * 70.0), cos(uTime * 0.06 + h * 23.0));
  vec3 nrm = normalize(toSun + jit * 0.55);
  // the Sun reflected: the mirror glints while its reflection of the disc (a few degrees
  // wide from here) covers the direction to the camera
  vec3 refl = reflect(-toSun, nrm);
  float ang = acos(clamp(dot(refl, toCam), -1.0, 1.0));
  float sunR = ${R_SUN.toFixed(1)} / length(p);
  vGlint = smoothstep(sunR * 2.2, sunR * 0.6, ang);
  vSheen = pow(max(dot(refl, toCam), 0.0), 16.0);
  // front (mirror) or back (dark radiator) toward us
  float facing = dot(nrm, toCam);
  vBody = facing > 0.0 ? 1.0 : 0.3;
  // size: 360 km panels, drawn at least 1.4 px across
  float S = 180.0;
  float minS = uPixAng * dist * 0.7;
  float sz = max(S, minS);
  vUnres = smoothstep(0.7, 1.4, minS / S);
  vec3 bt1 = normalize(cross(nrm, abs(nrm.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 bt2 = cross(nrm, bt1);
  // unresolved, the quad turns to face the camera so it never thins to a sliver
  vec3 ct1 = normalize(cross(toCam, abs(toCam.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 ct2 = cross(toCam, ct1);
  vec3 t1 = normalize(mix(bt1, ct1, vUnres)), t2 = normalize(mix(bt2 * 0.7, ct2, vUnres));
  vUv = aCorner;
  vec3 pos = w + (t1 * aCorner.x + t2 * aCorner.y) * sz;
  vFade = uFade;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;
const SWARM_FRAG = /* glsl */ `
uniform float uSunE;
uniform float uDiscL;
varying vec3 vCol;
varying vec2 vUv;
varying float vGlint;
varying float vSheen;
varying float vBody;
varying float vUnres;
varying float vFade;
void main() {
  // resolved: a hexagonal mirror, dark but for the Sun it reflects, its frame catching a
  // little light; unresolved: a steady point with a soft sheen and the sharp glint
  vec2 q = abs(vUv);
  float hex = max(q.x * 0.866 + q.y * 0.5, q.y);
  float mask = 1.0 - smoothstep(0.92, 1.0, hex);
  float g = exp(-dot(vUv, vUv) * 2.5);
  vec3 res = vCol * vGlint * uDiscL * 0.9 + vec3(0.5, 0.52, 0.55) * uSunE * 0.012 * vBody;
  vec3 pt = vCol * (0.2 + 1.3 * vSheen + 6.0 * vGlint) * 6.0;
  vec3 col = mix(res * mask, pt * g, vUnres) * vFade;
  float a = (1.0 - vUnres) * mask * 0.95 * vFade;
  if (max(max(col.r, col.g), a) < 1e-4) discard;
  gl_FragColor = vec4(col, a);
}
`;

export class SunSwarm {
  constructor(space, q) {
    this.space = space;
    this.group = new THREE.Group();
    const D2R = Math.PI / 180;
    const dir = (lat, lon) => new THREE.Vector3(Math.cos(lat * D2R) * Math.cos(lon * D2R), Math.sin(lat * D2R), -Math.cos(lat * D2R) * Math.sin(lon * D2R));
    const spot = SPOTS.map(([la, lo, s]) => { const c = dir(la, lo); return new THREE.Vector4(c.x, c.y, c.z, s * D2R); });
    const spotE = SPOTS.map(([la, lo, s, tilt]) => {
      const c = dir(la, lo);
      const east = new THREE.Vector3(0, 1, 0).cross(c).normalize();
      const north = c.clone().cross(east);
      const e = east.multiplyScalar(Math.cos(tilt)).addScaledVector(north, Math.sin(tilt)).normalize();
      return new THREE.Vector4(e.x, e.y, e.z, tilt);
    });
    const prom = [], promA = [], promH = [];
    PROMS.forEach(([la, lo, len, hgt, az, kind], i) => {
      const f = dir(la, lo);
      const east = new THREE.Vector3(0, 1, 0).cross(f).normalize();
      const north = f.clone().cross(east);
      const t = east.multiplyScalar(Math.cos(az)).addScaledVector(north, Math.sin(az)).normalize();   // the sheet runs along t
      const n = f.clone().cross(t).normalize();                                                        // plane normal
      prom.push(new THREE.Vector4(n.x, n.y, n.z, kind));
      promA.push(new THREE.Vector4(f.x, f.y, f.z, len * D2R));
      promH.push(new THREE.Vector4(hgt, i * 3.7 + 1.3, 0, 0));
    });
    this.uniforms = {
      uSunE: U.uSunIlluminance, uDim: { value: 1 }, uTime: { value: 0 }, uDiscL: { value: 1 },
      uSpot: { value: spot }, uSpotE: { value: spotE },
      uProm: { value: prom }, uPromA: { value: promA }, uPromH: { value: promH }, uPixAng: { value: 0.001 },
    };
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(R_SUN, 160, 80), new THREE.ShaderMaterial({ vertexShader: SUN_VERT, fragmentShader: SUN_FRAG, uniforms: this.uniforms }));
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(R_SUN * 10, R_SUN * 10), new THREE.ShaderMaterial({
      vertexShader: CORONA_VERT, fragmentShader: CORONA_FRAG, uniforms: this.uniforms, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.corona.renderOrder = 20;
    this.sunGroup = new THREE.Group();
    this.sunGroup.add(this.sphere, this.corona);
    this.group.add(this.sunGroup);
    // swarm mirrors: one instanced quad each
    const n = q.swarm;
    const aS = new Float32Array(n * 4);
    let s = 12345;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) {
      const stat = i < n * 0.08;
      const k = stat ? 4 : Math.floor(rnd() * 4);
      const g = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
      aS.set([k, rnd() * Math.PI * 2, stat ? Math.sqrt(rnd()) : g() * 0.035, stat ? (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd()) : g() * 0.01], i * 4);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 4));
    g.instanceCount = n;
    this.swarmU = {
      uRings: SKY_UNIFORMS.uSwarmN, uSunPos: { value: new THREE.Vector3() }, uT: { value: 0 }, uPixAng: { value: 0.001 }, uFade: { value: 0 },
      uTime: this.uniforms.uTime, uSunE: this.uniforms.uSunE, uDiscL: this.uniforms.uDiscL,
    };
    this.swarm = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: SWARM_VERT, fragmentShader: SWARM_FRAG, uniforms: this.swarmU, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, side: THREE.DoubleSide,
    }));
    this.swarm.renderOrder = 21;
    this.group.add(this.swarm);
    this.group.traverse((o) => { o.frustumCulled = false; });
    this.near = 0;
  }

  setSize(w, h) {}

  update(sim, realTime, dt, space) {
    const cam = space.camera;
    const d = cam.position.distanceTo(sim.sunPos);
    this.near = 1 - THREE.MathUtils.clamp((d - 5.0e7) / (9.5e7 - 5.0e7), 0, 1);
    this.near = this.near * this.near * (3 - 2 * this.near);
    this.sunGroup.position.copy(sim.sunPos);
    this.uniforms.uTime.value = realTime;
    // close to the Sun the eye stops down: the disc centre is exposed to sit just below white
    // (from the analytic exposure; the meter never lifts it), and the glare with it
    const E = U.uSunIlluminance.value;
    const closeDim = 1.15 / (E * 2600 * Math.max(space.exposure || 1, 0.2));
    const dim = THREE.MathUtils.lerp(1, closeDim, this.near);
    this.uniforms.uDim.value = dim;
    this.uniforms.uDiscL.value = E * 2600 * dim;
    space.skyDim = dim;
    const pa = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / Math.max(space.size.y, 1);
    this.uniforms.uPixAng.value = pa;
    this.swarmU.uPixAng.value = pa;
    this.swarmU.uSunPos.value.copy(sim.sunPos);
    this.swarmU.uT.value = sim.t % (365.25 * 86400 * 4);
    this.swarmU.uFade.value = this.near;
    this.swarm.visible = this.near > 0.001;
    SKY_UNIFORMS.uSwarmT.value = realTime;
  }

  exposureHint(cam, space) { return this.near * 0.55; }
}
