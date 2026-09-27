import * as THREE from 'three';
import { U } from '../core/uniforms.js';

// Engine exhaust for every craft in MERIDIAN, ported from the asset bundle's engine
// glow and plume-trail modules (Hyperspace Arrival, engineglow.js / plume_trail.js):
//   aperture  - the plasma throat seen looking into a nozzle: converging 1/r tunnel,
//               swirling gas layers, stator vanes, incandescent lip, shock rings
//   streak    - the exhaust column: five crossed ribbon planes shaped like a pressure
//               barrel, a white-hot collimated spine, Mach-diamond train, torn shear
//               filaments, blackbody cooling down the tail, footprint LOD
//   trail     - exhaust released into world space that hangs where it was emitted, so
//               the plume bends when the craft turns: a ring buffer of advected parcels
//               lofted as eight transported ribbons
// Changes from the originals: every Gaussian is written as exp(-x*x) (pow of a negative
// base is NaN on Apple GPUs), noise functions are prefixed so they can share a program
// with the sim's own, output is premultiplied (blend ONE, ONE) so the same materials work
// in the city and in the orbital renderer, and the streak has an instanced variant.

export const PL_NOISE = /* glsl */ `
#ifndef PL_NOISE
#define PL_NOISE
vec4 pl_mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec3 pl_mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 pl_permute(vec4 x){return pl_mod289(((x*34.0)+1.0)*x);}
vec4 pl_tis(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float pl_snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=pl_mod289(i);
  vec4 p=pl_permute(pl_permute(pl_permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=pl_tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float pl_fbm(vec3 p, int oct, float lac, float gain){
  float a=0.5, f=1.0, s=0.0, norm=0.0;
  for(int i=0;i<8;i++){ if(i>=oct) break; s+=a*pl_snoise(p*f); norm+=a; a*=gain; f*=lac; }
  return s/max(norm,1e-4);
}
float pl_g(float x){ return exp(-x*x); }
float pl_p(float x, float k){ return pow(max(x, 0.0), k); }
vec3 pl_blackbody(float t){
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(1.00, 0.34, 0.12), c1 = vec3(1.00, 0.62, 0.32), c2 = vec3(1.00, 0.95, 0.90), c3 = vec3(0.80, 0.90, 1.00);
  float u = t * 3.0;
  vec3 col = mix(c0, c1, clamp(u, 0.0, 1.0));
  col = mix(col, c2, clamp(u - 1.0, 0.0, 1.0));
  return mix(col, c3, clamp(u - 2.0, 0.0, 1.0));
}
#endif
`;

// ------------------------------------------------------------ streak plume --
/** The exhaust column. uv.x across the plane, uv.y along (0 mouth .. 1 tail). Returns premultiplied rgb. */
export const PL_STREAK = /* glsl */ `
vec3 plStreak(vec2 vUv, float uTime, float uIntensity, float uSeed, vec3 uColor, vec3 uCore) {
  float along = clamp(vUv.y, 0.0, 1.0);
  float sx = vUv.x * 2.0 - 1.0;
  float ph = uSeed * 6.2831853;
  float thrN = clamp(uIntensity * 0.5882353, 0.0, 1.5);
  float reach = mix(0.40, 1.0, clamp(thrN, 0.0, 1.0)) + max(thrN - 1.0, 0.0) * 0.22;
  float shearN = pl_fbm(vec3(sx * 1.4 + ph, along * 5.6 - uTime * 1.35, ph * 0.37), 3, 2.0, 0.55);
  float shear = (shearN - 0.5) * 0.22 * smoothstep(0.08, 0.82, along);
  float wsx = sx + shear;
  float ax = abs(wsx);
  float cellPhase = along * 10.5 - uTime * 3.4 + ph;
  float cellEnv = exp(-along * along * 7.0 / max(reach * reach, 1e-3));
  float cellA = 0.5 + 0.5 * cos(cellPhase);
  float cellB = 0.5 + 0.5 * cos(along * 16.5 - uTime * 3.4 + ph);
  float cell = pl_p(cellA * cellB, 4.0) * cellEnv + pl_p(cellA, 5.0) * (1.0 - cellEnv) * 0.35;
  cell *= 0.55 + 0.45 * thrN;
  float neck = 0.72 + 0.38 * cell;
  float spine = exp(-wsx * wsx * (34.0 + 20.0 * cell)) * neck;
  float halo = exp(-wsx * wsx * (4.5 + 1.2 * cell));
  float sideA = pl_g((wsx - (0.31 + shear * 0.8)) * 8.0);
  float sideB = pl_g((wsx + (0.28 - shear * 0.7)) * 9.0);
  float flow = 0.72 + 0.28 * sin(along * 58.0 - uTime * 18.0 + ph);
  float rib = pl_p(0.5 + 0.5 * sin(along * 34.0 + wsx * 8.0 - uTime * 11.0 + ph), 3.0);
  float corrugation = 0.82 + 0.18 * sin(wsx * 22.0 + along * 31.0 - uTime * 7.0 + ph);
  float emitter = exp(-along * along * 30.0);
  float tail = 1.0 - smoothstep(0.68 * reach, 1.0 * reach, along);
  float broken = 0.74 + 0.26 * sin(along * 91.0 - uTime * 23.0 + wsx * 4.0 + ph);
  float aw = fwidth(vUv.y);
  float fine = 1.0 - smoothstep(0.012, 0.030, aw);
  float flecks = 0.0, pmFans = 0.0, vortices = 0.0, shockTrough = 0.0, recircVoid = 0.0, knots = 0.0,
        recompressCollar = 0.0, detachedShock = 0.0, ionSkin = 0.0, recomb = 0.0, fans = 0.0;
  if (fine > 0.003) {
    float sheathEdge = 0.54 + 0.08 * sin(along * 17.0 - uTime * 2.2 + ph);
    float outerShock = pl_g((ax - sheathEdge) * 7.2) * smoothstep(0.05, 0.22, along) * (1.0 - smoothstep(0.82, 1.0, along));
    float recombN = pl_fbm(vec3(wsx * 9.0 + ph, along * 17.0 - uTime * 2.8, ph + 47.0), 3, 2.1, 0.5);
    recomb = outerShock * (0.45 + 0.55 * smoothstep(0.38, 0.86, recombN)) * fine;
    float fanA = pl_p(0.5 + 0.5 * cos(along * 24.0 + ax * 15.0 - uTime * 5.2 + ph), 9.0);
    float fanB = pl_p(0.5 + 0.5 * cos(along * 24.0 - ax * 13.0 - uTime * 4.6 + ph * 0.73), 9.0);
    float fanEnv = smoothstep(0.05, 0.20, along) * (1.0 - smoothstep(0.64 * reach, 0.96 * reach, along))
                 * smoothstep(0.06, 0.52, ax) * (1.0 - smoothstep(0.76, 1.04, ax));
    fans = (fanA + fanB) * fanEnv * (0.45 + 0.55 * thrN) * fine;
    float fleckN = pl_fbm(vec3(wsx * 18.0 + ph, along * 38.0 - uTime * 16.0, ph + 19.0), 2, 2.4, 0.5);
    flecks = smoothstep(0.76, 0.96, fleckN) * smoothstep(0.04, 0.18, along) * tail * fine;
    float pmA = pl_p(0.5 + 0.5 * sin(along * 52.0 + ax * 25.0 - uTime * (7.6 + thrN * 4.0) + ph), 12.0);
    float pmB = pl_p(0.5 + 0.5 * sin(along * 48.0 - ax * 22.0 - uTime * (6.8 + thrN * 3.4) + ph * 1.4), 12.0);
    float pmEnv = smoothstep(0.015, 0.13, along) * (1.0 - smoothstep(0.34 * reach, 0.66 * reach, along)) * smoothstep(0.18, 0.78, ax);
    pmFans = (pmA + pmB) * pmEnv * fine;
    float vortPhase = along * 32.0 - uTime * (4.4 + 3.2 * thrN) + ph;
    float vortA = pl_g((wsx - (0.34 + 0.08 * sin(vortPhase))) * 7.4);
    float vortB = pl_g((wsx + (0.32 + 0.07 * cos(vortPhase * 0.83))) * 7.0);
    float vortEnv = smoothstep(0.10, 0.30, along) * (1.0 - smoothstep(0.74 * reach, 1.02 * reach, along));
    vortices = (vortA + vortB) * vortEnv * (0.35 + 0.65 * rib) * fine;
    shockTrough = (pl_p(0.5 + 0.5 * sin(along * 36.0 + ax * 17.0 - uTime * 4.1 + ph), 7.0)
                + pl_p(0.5 + 0.5 * sin(along * 45.0 - ax * 13.0 - uTime * 5.0 + ph), 9.0)) * fanEnv * smoothstep(0.12, 0.78, ax) * fine;
    recircVoid = smoothstep(0.58, 0.96, ax) * smoothstep(0.05, 0.20, along) * (1.0 - smoothstep(0.58 * reach, 0.92 * reach, along))
               * (0.55 + 0.45 * sin(along * 19.0 - uTime * 1.9 + ph + shearN * 4.0)) * fine;
    float knotN = pl_fbm(vec3(wsx * 14.0 + ph * 0.3, along * 28.0 - uTime * 10.0, ph + 73.0), 3, 2.2, 0.5);
    knots = smoothstep(0.78, 0.96, knotN) * smoothstep(0.12, 0.50, along) * (1.0 - smoothstep(0.72, 1.0, along))
          * pl_g((ax - 0.22 - shear * 0.4) * 5.8) * fine;
    recompressCollar = pl_g((ax - (0.46 + 0.05 * sin(along * 12.0 + ph))) * 8.4)
      * pl_p(0.5 + 0.5 * cos(along * 38.0 - uTime * (5.6 + thrN * 2.0) + ph), 9.0)
      * smoothstep(0.08, 0.24, along) * (1.0 - smoothstep(0.66 * reach, 0.98 * reach, along)) * fine;
    detachedShock = pl_p(0.5 + 0.5 * cos(along * 64.0 + ax * 10.0 - uTime * 7.2 + ph), 11.0) * pl_g(ax * 2.1)
      * smoothstep(0.10, 0.28, along) * (1.0 - smoothstep(0.58 * reach, 0.92 * reach, along)) * fine;
    ionSkin = smoothstep(0.50, 0.94, ax) * smoothstep(0.12, 0.34, along) * (1.0 - smoothstep(0.78 * reach, 1.05 * reach, along))
      * pl_p(0.5 + 0.5 * sin(along * 44.0 - ax * 18.0 - uTime * 6.6 + ph), 8.0) * fine;
  }
  float a = (spine * 0.82 + halo * 0.16 + (sideA + sideB) * 0.18 * rib + flecks * 0.18) * tail * flow * broken * corrugation;
  a += recomb * (0.10 + 0.08 * rib) * flow;
  a += fans * 0.11 + pmFans * 0.075 + vortices * 0.08 + knots * 0.16 + recompressCollar * 0.075 + detachedShock * 0.065 + ionSkin * 0.052;
  a *= 1.0 - shockTrough * 0.085 - recircVoid * 0.075 - detachedShock * 0.030;
  if (a < 0.01) return vec3(0.0);
  float temp = 1.0 - smoothstep(0.12, 0.62, along);
  vec3 cool = mix(uColor * vec3(0.72, 0.34, 0.26), uColor, temp);
  vec3 c = mix(cool, uCore, clamp(spine + emitter * 0.8, 0.0, 1.0));
  c += vec3(1.05, 1.0, 0.82) * spine * (0.35 + 0.55 * emitter);
  c += uColor * (rib + cell * 0.45) * (0.18 + 0.18 * (1.0 - ax)) * tail;
  c += uCore * flecks * 0.55;
  c += mix(uColor, vec3(0.55, 0.78, 1.0), 0.35) * recomb * (0.42 + 0.28 * temp);
  c += mix(uColor, uCore, 0.45) * fans * 0.42;
  c += mix(uColor, uCore, 0.55) * pmFans * 0.30;
  c += mix(uColor, uCore, 0.34) * vortices * 0.32;
  c = mix(c, c * vec3(0.64, 0.74, 0.88), shockTrough * 0.18);
  c = mix(c, c * vec3(0.48, 0.56, 0.66), recircVoid * 0.22);
  c += mix(uColor, uCore, 0.70) * knots * 0.65;
  c += mix(uColor, uCore, 0.46) * recompressCollar * 0.34;
  c += mix(uColor, uCore, 0.62) * detachedShock * 0.28;
  c += mix(uColor, vec3(0.50, 0.78, 1.0), 0.44) * ionSkin * 0.25;
  return max(c * uIntensity * a, vec3(0.0));
}
`;

let _streakGeo = null;
/** Shared five-plane pressure-barrel geometry: mouth at z = 0, tail at z = -1, radius ~1. */
export function streakGeometry() {
  if (_streakGeo) return _streakGeo;
  const pos = [], uv = [], idx = [];
  const stations = [{ z: 0, y: 0, w: 0.58 }, { z: -0.18, y: 0.18, w: 0.96 }, { z: -0.42, y: 0.42, w: 1.08 }, { z: -0.72, y: 0.72, w: 0.82 }, { z: -1, y: 1, w: 0.36 }];
  for (let p = 0; p < 5; p++) {
    const a = (p / 5) * Math.PI;
    const dx = Math.cos(a), dy = Math.sin(a);
    const base = pos.length / 3;
    for (const s of stations) { pos.push(-dx * s.w, -dy * s.w, s.z, dx * s.w, dy * s.w, s.z); uv.push(0, s.y, 1, s.y); }
    for (let s = 0; s < stations.length - 1; s++) { const a0 = base + s * 2; idx.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  _streakGeo = g;
  return g;
}

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true, side: THREE.DoubleSide };

/**
 * A single exhaust column. The mesh's local -Z is the exhaust direction; scale it with
 * (radius, radius, length). intensity ~1.7 nominal (0 = off, >1.7 = hard burn).
 */
export function createStreakPlume({ color = 0x7fe7ff, core = 0xeafcff, intensity = 1.7, seed = Math.random(), gain = 1 } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uColor: { value: new THREE.Color(color) }, uCore: { value: new THREE.Color(core) }, uIntensity: { value: intensity }, uSeed: { value: seed }, uGain: { value: gain } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
uniform float uTime; uniform vec3 uColor; uniform vec3 uCore; uniform float uIntensity; uniform float uSeed; uniform float uGain;
varying vec2 vUv;
${PL_NOISE}
${PL_STREAK}
void main() {
  vec3 c = plStreak(vUv, uTime, uIntensity, uSeed, uColor, uCore);
  if (c.r + c.g + c.b < 1e-4) discard;
  gl_FragColor = vec4(c * uGain, 0.0);
}`,
    ...additive,
  });
  const mesh = new THREE.Mesh(streakGeometry(), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 14;
  return mesh;
}

// ---------------------------------------------------------------- aperture --
const APERTURE_FRAG = /* glsl */ `
uniform float uTime; uniform vec3 uColor; uniform vec3 uCore; uniform float uHot; uniform float uIntensity; uniform float uSeed; uniform float uThrust;
varying vec2 vUv;
${PL_NOISE}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = atan(p.y, p.x);
  float ph = uSeed * 6.2831853;
  float t = uTime * (0.85 + 0.65 * uHot);
  float thr = clamp(uThrust, 0.05, 2.5);
  float thrK = 1.0 + 0.40 * (thr - 1.0);
  float thrA = clamp(0.35 + 0.65 * thr, 0.0, 1.7);
  float thrI = 1.0 + 0.55 * (thr - 1.0);
  float thrS = (thr - 1.0) * 1.6;
  float coreTint = clamp(abs(thr - 1.0) * 0.9, 0.0, 0.85);
  vec3 coreCol = mix(uCore, pl_blackbody(clamp(0.5 + (thr - 1.0) * 0.42, 0.0, 1.0)), coreTint);
  float depth = 1.0 / (r * 1.35 + 0.16);
  float spin = ang + r * 1.6 + t * 0.55;
  vec3 qa = vec3(spin * 1.4, depth - t * 1.15, t * 0.35 + ph);
  float warp = pl_fbm(qa * 0.9 + 4.0, 4, 2.0, 0.5);
  vec3 qb = vec3(spin * 2.6 + warp * 1.1, depth * 1.7 - t * 1.9, ph + 7.0);
  float turb = pl_fbm(qb, 5, 2.0, 0.55) * 0.5 + 0.5;
  float deep = pl_fbm(vec3(spin * 0.8, depth * 0.6 - t * 0.6, ph + 13.0) * 1.2, 3, 2.0, 0.5) * 0.5 + 0.5;
  float gas = mix(deep, turb, 0.6);
  float vanes = 0.82 + 0.18 * cos(ang * 9.0 - t * 1.4 + warp * 2.0);
  gas *= vanes;
  float vaneCut = pl_p(0.5 + 0.5 * cos(ang * 18.0 - t * 0.72 + warp * 4.0 + ph), 10.0) * smoothstep(0.34, 0.92, r);
  float wallOcclusion = smoothstep(0.54, 0.96, r) * (0.36 + 0.64 * pl_p(0.5 + 0.5 * sin(ang * 7.0 + depth * 2.2 + ph), 3.0));
  float injectorBand = pl_p(0.5 + 0.5 * sin(ang * 24.0 + depth * 1.7 - t * 0.45 + ph), 9.0) * smoothstep(0.46, 0.93, r);
  float recircShadow = smoothstep(0.62, 0.96, r) * (0.5 + 0.5 * sin(ang * 10.0 - depth * 3.1 + warp * 3.0 + ph));
  gas *= 1.0 - vaneCut * 0.13 - wallOcclusion * 0.10 - injectorBand * 0.065 - recircShadow * 0.055;
  float rh = r + 0.022 * sin(ang * 7.0 + t * 3.1 + warp * 4.0) * smoothstep(0.4, 0.85, r);
  float coreK = mix(3.0, 8.0, uHot) * clamp(thrK, 0.6, 1.85);
  float coreP = exp(-r * r * coreK);
  float halo = exp(-r * r * (coreK * 0.30));
  float edge = 1.0 - smoothstep(0.55, 1.0, rh);
  float lip = pl_g((rh - 0.82) * 7.5) * (0.55 + 0.45 * vanes);
  float hotLiner = pl_g((rh - 0.68) * 10.0) * max(0.0, 0.45 + 0.55 * sin(ang * 12.0 - t * 1.1 + ph) * sin(depth * 3.0 + warp));
  float erodedLip = pl_g((rh - 0.87) * 10.5) * 0.55;
  float rphase = r * 22.0 - t * 5.2 + warp * 6.0 + depth * 1.5;
  vec3 ringRGB = 0.6 + 0.4 * sin(rphase - vec3(0.0, 0.5, 1.0));
  float diamondTrain = pl_p(0.5 + 0.5 * cos(depth * (9.0 + thrS) - t * 5.0 + ph + warp * 3.0), 8.0);
  float diamondMask = smoothstep(0.08, 0.46, r) * (1.0 - smoothstep(0.68, 0.98, r)) * (0.35 + 0.65 * uHot);
  float diamonds = diamondTrain * diamondMask * (0.45 + 0.55 * turb) * thrA;
  float machStem = pl_p(1.0 - abs(sin(depth * (5.4 + thrS * 0.6) - t * 2.35 + ph)) * 1.75, 3.1) * exp(-r * r * 10.5) * (0.35 + 0.65 * uHot) * edge * thrA;
  float schlieren = pl_p(0.5 + 0.5 * sin(depth * 14.0 + ang * 6.0 - t * 3.2 + warp * 2.6), 7.0) * smoothstep(0.18, 0.72, r) * (1.0 - smoothstep(0.78, 0.99, r)) * thrA;
  float body = (coreP * 1.30 + halo * 0.80 * gas) * edge + lip * 0.55 * edge + diamonds * 0.24 * edge + machStem * 0.22
             + hotLiner * 0.10 * edge + schlieren * 0.065 * edge + erodedLip * 0.070 * edge;
  float hotMix = clamp(coreP * 1.4 + depth * 0.04, 0.0, 1.0);
  vec3 outer = uColor * (0.75 + 0.45 * turb);
  vec3 col = mix(mix(outer, uColor.bgr, smoothstep(0.6, 1.0, r) * 0.35), coreCol, hotMix);
  col *= mix(vec3(1.0), ringRGB, 0.5);
  col = mix(col, coreCol, clamp(lip * 0.8 + diamonds * 0.28 + machStem * 0.46, 0.0, 1.0));
  col = mix(col, col * vec3(0.55, 0.62, 0.72), wallOcclusion * 0.22);
  col += coreCol * (hotLiner * 0.16 + erodedLip * 0.11 + schlieren * 0.10);
  if (body <= 0.0035) discard;
  gl_FragColor = vec4(max(col * uIntensity * body * thrI, vec3(0.0)), 0.0);
}
`;

/** The plasma throat: a disc of radius 1 in the local XY plane, facing -Z (aft). */
export function createAperture({ color = 0x7fe7ff, core = 0xf4fbff, hot = 0.7, intensity = 2.4, seed = Math.random() } = {}) {
  const g = new THREE.CircleGeometry(1, 40).rotateY(Math.PI);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uColor: { value: new THREE.Color(color) }, uCore: { value: new THREE.Color(core) }, uHot: { value: hot }, uIntensity: { value: intensity }, uSeed: { value: seed }, uThrust: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: APERTURE_FRAG,
    ...additive,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 15;
  return mesh;
}

/**
 * An engine: aperture disc + streak column, as one group at the nozzle mouth.
 * The group's local -Z is the exhaust direction. radius = nozzle radius, length = column.
 */
export function createEngine({ radius, length, color, core, intensity = 1.7, apertureIntensity = 2.4, seed = Math.random() }) {
  const g = new THREE.Group();
  const ap = createAperture({ color, core, intensity: apertureIntensity, seed });
  ap.scale.setScalar(radius);
  const st = createStreakPlume({ color, core, intensity, seed });
  st.scale.set(radius * 1.05, radius * 1.05, length);
  g.add(ap, st);
  g.userData = { aperture: ap, streak: st, baseLength: length, radius };
  /** throttle 0..1.5: shortens/lengthens the column and drives both shaders */
  g.setThrottle = (t) => {
    st.material.uniforms.uIntensity.value = 1.7 * t;
    st.scale.z = length * (0.35 + 0.65 * Math.min(t, 1.2));
    st.visible = t > 0.02;
    ap.material.uniforms.uThrust.value = Math.max(0.3, t);
  };
  return g;
}

// ------------------------------------------------------------------ trail --
const TRAIL_VERT = /* glsl */ `
attribute float aSide; attribute float aBright; attribute float aAlong; attribute float aAge; attribute float aHeat; attribute float aThrust; attribute float aCurve; attribute float aBend;
uniform float uFarNear; uniform float uFarFar;
varying float vSide; varying float vBright; varying float vAlong; varying float vAge; varying float vHeat; varying float vThrust; varying float vCurve; varying float vBend; varying float vFar;
void main() {
  vSide = aSide; vBright = aBright; vAlong = aAlong; vAge = aAge; vHeat = aHeat; vThrust = aThrust; vCurve = aCurve; vBend = aBend;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFar = smoothstep(uFarNear, uFarFar, max(-mv.z, 0.0));
  gl_Position = projectionMatrix * mv;
}
`;
const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor; uniform vec3 uCore; uniform float uTime; uniform float uSeed; uniform float uGain;
varying float vSide; varying float vBright; varying float vAlong; varying float vAge; varying float vHeat; varying float vThrust; varying float vCurve; varying float vBend; varying float vFar;
vec3 thermalSpectrum(float h) {
  float x = clamp(h, 0.0, 1.25);
  vec3 warm = vec3(1.24, 0.34, 0.075), whiteHot = vec3(1.08, 0.96, 0.78), blueHot = vec3(0.82, 0.96, 1.22);
  return x < 0.72 ? mix(warm, whiteHot, smoothstep(0.08, 0.72, x)) : mix(whiteHot, blueHot, smoothstep(0.72, 1.25, x));
}
float tg(float x) { return exp(-x * x); }
float tp(float x, float k) { return pow(max(x, 0.0), k); }
void main() {
  float across = 1.0 - clamp(abs(vSide), 0.0, 1.0);
  float chord = sqrt(max(0.0, 1.0 - vSide * vSide));
  float sheath = tp(across, 1.35) * (0.58 + 0.42 * chord);
  float core = tp(across, 7.0);
  float b = clamp(vBright, 0.0, 2.0);
  float thermal = clamp(vHeat, 0.0, 1.25);
  float chamber = clamp(vThrust, 0.0, 1.5);
  if (vFar > 0.82) {
    float farBright = sheath * b * (0.88 - 0.22 * vAlong) + core * b * 0.16;
    if (farBright <= 0.004) discard;
    vec3 farThermal = thermalSpectrum(thermal * (0.72 + chamber * 0.28));
    vec3 farCooled = uColor * mix(vec3(0.46, 0.58, 0.78), vec3(1.0), thermal);
    vec3 farCol = mix(farCooled, uCore * farThermal, (core + clamp(b - 0.3, 0.0, 0.7) * 0.4) * thermal);
    gl_FragColor = vec4(max(farCol * (1.0 + 1.6 * core + 0.7 * b) * farBright * uGain, vec3(0.0)), 0.0);
    return;
  }
  float parcelPhase = vAge * (4.2 + chamber * 2.8) + uSeed;
  float outerBend = max(vBend, 0.0), innerBend = max(-vBend, 0.0);
  float footprint = fwidth(vAlong) + fwidth(vSide);
  float detail = 1.0 - smoothstep(0.055, 0.18, footprint);
  float w1 = sin(vAlong * 34.0 - parcelPhase * 2.7 + uSeed);
  float w2 = sin(vAlong * 57.0 - parcelPhase * 4.1 + uSeed * 2.7 + vSide * 2.2);
  float w3 = sin(vAlong * 13.0 - parcelPhase * 1.3 + uSeed * 4.9);
  float clump = (0.55 + 0.45 * w1) * (0.62 + 0.38 * w2) * (0.78 + 0.22 * w3);
  float breakup = mix(1.0, 0.55 + 0.75 * clump, smoothstep(0.10, 0.72, vAlong));
  breakup = mix(1.0, breakup, detail);
  float fleck = smoothstep(0.55, 0.95, w1 * w2) * smoothstep(0.06, 0.30, vAlong);
  float cellFreq = mix(31.0, 51.0, clamp(chamber, 0.0, 1.0));
  float diamond = tp(0.5 + 0.5 * cos(vAlong * cellFreq - parcelPhase * (1.5 + chamber) + uSeed), 8.0) * smoothstep(0.02, 0.18, vAlong) * (1.0 - smoothstep(0.52, 0.86, vAlong));
  float edgeShear = tg(abs(abs(vSide) - 0.56) * 4.6) * smoothstep(0.08, 0.78, vAlong);
  float vortex = tg(abs(abs(vSide) - 0.34) * 4.2) * tp(0.5 + 0.5 * sin(vAlong * 72.0 + vSide * 5.4 - parcelPhase * 3.1 + uSeed * 1.7), 7.0) * smoothstep(0.10, 0.82, vAlong);
  float coolCell = tp(0.5 + 0.5 * sin(vAlong * 25.0 - uTime * 3.0 + uSeed * 0.6), 5.0) * smoothstep(0.36, 0.86, vAlong);
  float ageN = clamp(vAge * 0.55, 0.0, 1.0);
  float barrelShadow = tp(0.5 + 0.5 * sin(vAlong * 37.0 - uTime * 6.8 + uSeed * 0.9), 6.0) * tg(abs(vSide) * 2.6) * smoothstep(0.18, 0.78, vAlong);
  float entrain = tg(abs(abs(vSide) - 0.78) * 3.2) * smoothstep(0.20, 0.94, vAlong) * (0.58 + 0.42 * sin(vAlong * 43.0 + vAge * 5.0 - uTime * 4.1 + uSeed));
  float recirc = smoothstep(0.48, 1.0, ageN) * tg(abs(vSide) * 2.1) * tp(0.5 + 0.5 * sin(vAlong * 21.0 + vSide * 4.0 + uTime * 2.6 + uSeed * 2.2), 5.0);
  float recombFog = smoothstep(0.14, 0.88, ageN) * edgeShear * tp(0.5 + 0.5 * sin(vAlong * 31.0 + vSide * 3.7 - uTime * 4.4 + uSeed * 1.3), 4.0);
  float sootWake = smoothstep(0.38, 1.0, ageN) * (1.0 - core) * sheath * smoothstep(0.30, 0.92, vAlong) * smoothstep(0.42, 0.90, 0.5 + 0.5 * sin(vAlong * 18.0 - uTime * 2.2 + uSeed));
  float shearRib = tp(0.5 + 0.5 * sin(vAlong * 92.0 + vSide * 6.0 - uTime * 15.0 + uSeed * 2.0), 9.0) * tg(abs(abs(vSide) - 0.44) * 4.0) * smoothstep(0.08, 0.74, vAlong);
  float pressureGap = tp(0.5 + 0.5 * sin(vAlong * 48.0 - uTime * 7.6 + uSeed * 0.4), 8.0) * tg(abs(vSide) * 2.9) * smoothstep(0.16, 0.82, vAlong);
  float detachedCollar = tp(0.5 + 0.5 * cos(vAlong * 68.0 - uTime * 8.2 + uSeed * 1.1), 9.0) * tg(abs(abs(vSide) - 0.48) * 4.6) * smoothstep(0.08, 0.30, vAlong) * (1.0 - smoothstep(0.70, 0.96, vAlong));
  float recombSkin = tg(abs(abs(vSide) - 0.86) * 3.8) * smoothstep(0.18, 0.95, vAlong) * tp(0.5 + 0.5 * sin(vAlong * 52.0 + vAge * 4.8 - uTime * 5.0 + uSeed * 2.4), 7.0);
  float wakeVoid = tp(0.5 + 0.5 * sin(vAlong * 29.0 - uTime * 2.7 + uSeed * 0.8), 6.0) * tg(abs(vSide) * 2.2) * smoothstep(0.34, 0.98, vAlong) * ageN;
  float bendShear = clamp(vCurve, 0.0, 1.0) * smoothstep(0.10, 0.90, vAlong);
  float curveSkin = bendShear * tg(abs(abs(vSide) - 0.72) * 4.4);
  float outerShear = outerBend * tg(abs(vSide - 0.62) * 3.8);
  float innerLane = innerBend * tg(abs(vSide + 0.28) * 3.1);
  float expansionCell = tp(0.5 + 0.5 * sin(vAlong * (18.0 + chamber * 8.0) - vAge * 3.2 + uSeed), 6.0) * smoothstep(0.12, 0.82, vAlong) * (0.35 + 0.65 * thermal);
  fleck *= detail; diamond *= detail; vortex *= detail; shearRib *= detail; detachedCollar *= detail; expansionCell *= detail;
  float a = sheath * b * breakup + diamond * core * b * 0.22 + edgeShear * b * 0.08 + vortex * b * 0.12 + coolCell * edgeShear * b * 0.055
    + recombFog * b * 0.07 + entrain * b * 0.045 + recirc * b * 0.040 + shearRib * b * 0.060 + detachedCollar * b * 0.058
    + recombSkin * b * 0.050 + curveSkin * b * 0.070 + expansionCell * edgeShear * b * 0.050 + outerShear * b * 0.12;
  a *= mix(1.0, 0.78, sootWake * 0.45);
  a *= mix(1.0, 0.84, barrelShadow * (0.25 + 0.45 * ageN) + pressureGap * 0.22 + wakeVoid * 0.18);
  a *= 1.0 - innerLane * 0.24;
  if (a <= 0.004) discard;
  vec3 cooled = uColor * mix(vec3(0.46, 0.58, 0.78), vec3(1.0), thermal);
  vec3 thermalCol = thermalSpectrum(thermal * (0.72 + chamber * 0.28));
  vec3 col = mix(cooled, uCore * thermalCol, (core + clamp(b - 0.3, 0.0, 0.7) * 0.4) * thermal);
  col += uCore * fleck * 0.45 * b;
  col += uCore * diamond * 0.38 * b + uColor * vec3(0.65, 0.82, 1.15) * edgeShear * 0.16 * b;
  col += mix(uColor, uCore, 0.28) * vortex * 0.28 * b;
  col = mix(col, col * vec3(1.10, 0.82, 0.64), coolCell * 0.15);
  col = mix(col, uColor * vec3(0.58, 0.70, 0.88), ageN * sootWake * 0.34);
  col += uColor * vec3(0.62, 0.86, 1.18) * recombFog * 0.20 * b;
  col += uColor * vec3(0.38, 0.58, 0.78) * entrain * 0.16 * b;
  col += uColor * vec3(0.58, 0.90, 1.30) * shearRib * 0.18 * b;
  col += mix(uColor, uCore, 0.38) * detachedCollar * 0.18 * b;
  col += uColor * vec3(0.46, 0.78, 1.12) * recombSkin * 0.16 * b;
  col += mix(uColor, uCore, 0.22) * curveSkin * 0.19 * b;
  col += mix(uColor, thermalCol, 0.62) * outerShear * 0.24 * b;
  col *= 1.0 - innerLane * vec3(0.08, 0.12, 0.18);
  col += uCore * expansionCell * edgeShear * thermal * 0.12 * b;
  col = mix(col, col * vec3(0.50, 0.58, 0.72), barrelShadow * 0.24 + pressureGap * 0.18 + wakeVoid * 0.14);
  col += mix(uColor, uCore, 0.18) * recirc * 0.12 * b;
  gl_FragColor = vec4(max(col * (1.0 + 1.6 * core + 0.7 * b) * a * uGain, vec3(0.0)), 0.0);
}
`;

/**
 * Exhaust that hangs in world space and bends as the craft turns. Add `mesh` to the
 * scene (world space), then call update(nozzleWorldPos, intensity, dt) every frame.
 */
export function createPlumeTrail({ color = 0x4d9eff, coreColor = 0xdfeeff, segments = 16, spacing = 1.5, width = 0.8, decay = 1.9, seed = 0, gain = 1, farNear = 560, farFar = 1200 } = {}) {
  const N = Math.min(64, Math.max(4, Math.trunc(segments)));
  const RUNGS = N + 1, RIBS = 8;
  const SP = Math.max(1e-3, spacing), SP2 = SP * SP, W = Math.max(1e-3, width), DECAY = Math.max(0, decay);
  const pos = [], velocity = [], frameSide = [], frameUp = [];
  const energy = new Float32Array(RUNGS), age = new Float32Array(RUNGS), heat = new Float32Array(RUNGS), thrust = new Float32Array(RUNGS), roll = new Float32Array(RUNGS);
  for (let i = 0; i < RUNGS; i++) { pos.push(new THREE.Vector3()); velocity.push(new THREE.Vector3()); frameSide.push(new THREE.Vector3(1, 0, 0)); frameUp.push(new THREE.Vector3(0, 1, 0)); }
  let seeded = false, commit = (seed * 97) | 0, reachS = 0, thrustS = 0;
  const VERTS = 2 * RIBS * RUNGS;
  const position = new Float32Array(VERTS * 3);
  const A = {};
  for (const k of ['aSide', 'aBright', 'aAlong', 'aAge', 'aHeat', 'aThrust', 'aCurve', 'aBend']) A[k] = new Float32Array(VERTS);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  const attrs = {};
  for (const k of Object.keys(A)) { attrs[k] = new THREE.BufferAttribute(A[k], 1); if (k !== 'aSide' && k !== 'aAlong') attrs[k].setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, attrs[k]); }
  const frac = new Float32Array(RUNGS), ribC = new Float32Array(RIBS), ribS = new Float32Array(RIBS);
  for (let i = 0; i < RUNGS; i++) frac[i] = i / (RUNGS - 1);
  for (let r = 0; r < RIBS; r++) {
    const ra = (r / RIBS) * Math.PI; ribC[r] = Math.cos(ra); ribS[r] = Math.sin(ra);
    const base = r * 2 * RUNGS;
    for (let i = 0; i < RUNGS; i++) { A.aAlong[base + i * 2] = A.aAlong[base + i * 2 + 1] = frac[i]; A.aSide[base + i * 2] = 1; A.aSide[base + i * 2 + 1] = -1; }
  }
  const idx = [];
  for (let r = 0; r < RIBS; r++) { const base = r * 2 * RUNGS; for (let i = 0; i < RUNGS - 1; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uCore: { value: new THREE.Color(coreColor) }, uTime: { value: 0 }, uSeed: { value: seed * 6.2831853 }, uGain: { value: gain }, uFarNear: { value: farNear }, uFarFar: { value: farFar } },
    vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, ...additive,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 14;
  mesh.visible = false;
  const V = () => new THREE.Vector3();
  const _tan = V(), _side = V(), _up = V(), _diag = V(), _up0 = new THREE.Vector3(0, 1, 0), _tw1 = V(), _tw2 = V(), _dir = V(), _newp = V(), _raw = V(), _nVel = V(), _emit = V(), _cand = V(), _prevTan = new THREE.Vector3(0, 0, 1), _axis = V(), _curve = V(), _start = V(), _stepN = V();
  const write = (vi, c, ox, oy, oz, bright, i, curvature, bend) => {
    position[vi * 3] = c.x + ox; position[vi * 3 + 1] = c.y + oy; position[vi * 3 + 2] = c.z + oz;
    A.aBright[vi] = bright; A.aAge[vi] = age[i]; A.aHeat[vi] = heat[i]; A.aThrust[vi] = thrust[i]; A.aCurve[vi] = curvature; A.aBend[vi] = bend;
  };
  function rebuild() {
    for (let i = 0; i < RUNGS; i++) {
      const c = pos[i], a = pos[Math.max(0, i - 1)], b = pos[Math.min(RUNGS - 1, i + 1)];
      _tan.subVectors(a, b);
      if (_tan.lengthSq() < 1e-8) _tan.set(0, 0, 1); else _tan.normalize();
      if (i === 0) _prevTan.copy(_tan);
      _side.copy(i === 0 ? frameSide[0] : frameSide[i - 1]);
      _side.addScaledVector(_tan, -_side.dot(_tan));
      if (_side.lengthSq() < 1e-6) { _side.crossVectors(_tan, i === 0 ? _up0 : frameUp[i - 1]); if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0); }
      _side.normalize();
      _up.crossVectors(_side, _tan); if (_up.lengthSq() > 1e-8) _up.normalize(); else _up.set(0, 1, 0);
      frameSide[i].copy(_side); frameUp[i].copy(_up);
      _axis.crossVectors(_prevTan, _tan);
      const curvature = i === 0 ? 0 : Math.min(1, _axis.length() * 2.8);
      _curve.subVectors(_tan, _prevTan); _curve.addScaledVector(_tan, -_curve.dot(_tan));
      if (_curve.lengthSq() > 1e-8) _curve.normalize(); else _curve.set(0, 0, 0);
      _prevTan.copy(_tan);
      const swirl = roll[i] + age[i] * (0.34 + thrust[i] * 0.22);
      const cs = Math.cos(swirl), sn = Math.sin(swirl);
      _tw1.copy(_side).multiplyScalar(cs).addScaledVector(_up, sn);
      _tw2.copy(_up).multiplyScalar(cs).addScaledVector(_side, -sn);
      _side.copy(_tw1).normalize(); _up.copy(_tw2).normalize();
      const lenGate = 1 - Math.min(Math.max((frac[i] - (reachS - 0.14)) / 0.14, 0), 1);
      const open = 0.24 + 0.96 * (1 - Math.exp(-frac[i] * (4.2 + thrust[i] * 2.4)));
      const spread = 1 + Math.min(age[i] * (0.30 + thrust[i] * 0.20), 0.95);
      const w = W * open * (0.35 + 0.65 * lenGate) * spread * (1 + curvature * 0.12);
      const bright = energy[i] * (0.82 - 0.28 * frac[i]) * lenGate / Math.max(0.62, open * spread) * (4 / RIBS);
      for (let r = 0; r < RIBS; r++) {
        _diag.copy(_side).multiplyScalar(ribC[r]).addScaledVector(_up, ribS[r]);
        const bend = curvature * _diag.dot(_curve);
        const bw = 1 + Math.max(bend, 0) * 0.18 - Math.max(-bend, 0) * 0.08;
        const base = r * 2 * RUNGS + i * 2;
        write(base, c, _diag.x * w * bw, _diag.y * w * bw, _diag.z * w * bw, bright, i, curvature, bend);
        write(base + 1, c, -_diag.x * w / bw, -_diag.y * w / bw, -_diag.z * w / bw, bright, i, curvature, -bend);
      }
    }
    posAttr.needsUpdate = true;
    for (const k of Object.keys(attrs)) attrs[k].needsUpdate = true;
  }
  function reset(n) {
    for (let i = 0; i < RUNGS; i++) { pos[i].copy(n); energy[i] = age[i] = heat[i] = thrust[i] = roll[i] = 0; velocity[i].set(0, 0, 0); frameSide[i].set(1, 0, 0); frameUp[i].set(0, 1, 0); }
    _nVel.set(0, 0, 0); thrustS = 0; reachS = 0; seeded = true; mesh.visible = false;
  }
  function advance(step, nozzle, tThrust, tReach) {
    reachS += (tReach - reachS) * (1 - Math.exp(-7 * step));
    thrustS += (tThrust - thrustS) * (1 - Math.exp(-(tThrust > thrustS ? 13 : 7) * step));
    if (step > 1e-5) _raw.subVectors(nozzle, pos[0]).multiplyScalar(1 / step); else _raw.set(0, 0, 0);
    _nVel.lerp(_raw, 1 - Math.exp(-10 * step));
    const k = Math.exp(-DECAY * step);
    for (let i = 0; i < RUNGS; i++) energy[i] *= k;
    for (let i = 1; i < RUNGS; i++) {
      age[i] += step;
      pos[i].addScaledVector(velocity[i], step);
      heat[i] *= Math.exp(-(0.48 + (0.30 + thrust[i] * 0.20) * (0.70 + age[i] * 0.24)) * step);
    }
    pos[0].copy(nozzle); energy[0] = thrustS; heat[0] = Math.min(1.25, 0.35 + thrustS * 0.82); thrust[0] = thrustS;
    let guard = 0;
    while (guard++ < RUNGS * 3) {
      _dir.subVectors(pos[0], pos[1]);
      const d2 = _dir.lengthSq();
      if (d2 < SP2) break;
      _dir.multiplyScalar(SP / Math.max(Math.sqrt(d2), 1e-4));
      _newp.addVectors(pos[1], _dir);
      for (let i = RUNGS - 1; i > 1; i--) {
        pos[i].copy(pos[i - 1]); energy[i] = energy[i - 1]; age[i] = age[i - 1]; heat[i] = heat[i - 1]; thrust[i] = thrust[i - 1]; roll[i] = roll[i - 1];
        velocity[i].copy(velocity[i - 1]); frameSide[i].copy(frameSide[i - 1]); frameUp[i].copy(frameUp[i - 1]);
      }
      pos[1].copy(_newp); energy[1] = thrustS; age[1] = 0; heat[1] = Math.min(1.25, 0.35 + thrustS * 0.82); thrust[1] = thrustS;
      commit = (commit + 1) | 0;
      const az = commit * 0.35 + seed * 1.7;
      const mag = W * (0.018 + 0.014 * (0.5 + 0.5 * Math.sin(commit * 0.73)));
      _emit.copy(_dir).normalize();
      velocity[1].copy(_nVel).addScaledVector(_emit, -SP * (6 + Math.min(thrustS, 1.5) * 8));
      _cand.copy(frameSide[0]).multiplyScalar(Math.cos(az) * mag).addScaledVector(frameUp[0], Math.sin(az) * mag);
      velocity[1].add(_cand);
      roll[1] = commit * 0.08 + seed * 0.35;
      frameSide[1].copy(frameSide[0]); frameUp[1].copy(frameUp[0]);
    }
  }
  function update(nozzle, intensity, dt, reach = 1) {
    if (!Number.isFinite(nozzle.x) || !Number.isFinite(nozzle.y) || !Number.isFinite(nozzle.z)) return;
    const total = Math.min(0.25, Math.max(0, dt || 0));
    if (!seeded) reset(nozzle);
    else { _dir.subVectors(pos[0], nozzle); if (_dir.lengthSq() > SP2 * RUNGS * RUNGS * 9) reset(nozzle); }
    _start.copy(pos[0]);
    const tr = Math.min(1, Math.max(0, reach)), tt = Math.min(4, Math.max(0, intensity || 0));
    const steps = total > 0 ? Math.min(8, Math.max(1, Math.ceil(total / (1 / 60)))) : 0;
    if (steps) {
      const step = total / steps;
      for (let s = 0; s < steps; s++) { _stepN.copy(_start).lerp(nozzle, (s + 1) / steps); advance(step, _stepN, tt, tr); }
      mat.uniforms.uTime.value += total;
    } else pos[0].copy(nozzle);
    let maxE = 0;
    for (let i = 0; i < RUNGS; i++) if (energy[i] > maxE) maxE = energy[i];
    mesh.visible = maxE > 0.02 && reachS > 0.02;
    if (mesh.visible) rebuild();
  }
  return { mesh, update, reset, material: mat, dispose() { geo.dispose(); mat.dispose(); } };
}
