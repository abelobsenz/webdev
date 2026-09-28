import * as THREE from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/uniforms.js';
import { SNOISE_GLSL } from './glsl.js';
import { R_MOON } from './sim.js';
import { MoonBake, TOWNS } from './moonBake.js';
import { SITE_GLSL, SITE_UP } from './lunarSite.js';

// The terraformed Moon's surface, ray-traced on a proxy sphere so the ground is the exact
// sphere everything on it is seated on (Medii Landing's quays, terraces and pylons).
// All ray maths run camera-relative in the Moon's frame from double-precision uniforms:
// the Moon is 384,000 km from the origin, where float32 world positions carry 30 m of
// error, and a harbour seen from a few kilometres must not swim.
//
// Shading: baked albedo, height and normals (moonBake.js), relief exaggerated a little,
// self-shadowing near the terminator by marching the height field toward the Sun, finer
// crater octaves as you come closer, shallow seas with depth colour and sun glint, a
// drifting cloud deck that casts shadows, earthshine, and settlement lights that resolve
// into towns and villages without ever sparkling.

export const MOON_CLOUD_H = 6.0;          // km
const PROXY = R_MOON + MOON_CLOUD_H + 3.5;

const VERT = /* glsl */ `
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform mat4 projectionMatrix;
uniform samplerCube uMoonA;
uniform samplerCube uMoonN;
uniform samplerCube uMoonC;
uniform mat3 uViewToM;      // view-space direction -> Moon frame
uniform vec3 uCamM;         // camera relative to the Moon's centre, Moon frame (km)
uniform float uC0;          // |cam|^2 - R^2 (from doubles)
uniform float uC1;          // |cam|^2 - (R + HC)^2
uniform vec3 uCamS;         // camera relative to the Lift, site frame (km)
uniform vec3 uSunM;         // toward the Sun, Moon frame
uniform vec3 uEarthM;       // toward the Earth, Moon frame
uniform float uEarthLit;    // lit fraction of the Earth's disc seen from the Moon
uniform float uSunE;
uniform float uPixAng;      // radians per pixel
uniform float uCloudRot;    // cloud drift (rad about the axis)
uniform float uCloudPh;     // 0..1 cross-fade phase
uniform float uTime;
uniform vec4 uTown[${TOWNS.length}];
varying vec3 vView;
${NOISE_GLSL}
${SNOISE_GLSL}
${SITE_GLSL}
#define RM ${R_MOON.toFixed(1)}
#define HC ${MOON_CLOUD_H.toFixed(1)}
#define PI 3.14159265

float decodeH(float a) { float s = a * 2.0 - 1.0; return sign(s) * s * s * 9.0; }
vec3 rotYm(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }

// site frame (x west, y up, z north) from the Moon frame
vec3 toSite(vec3 m) { return vec3(m.z, m.x, m.y); }

float cloudAt(vec3 d, float lod, float fp) {
  vec3 q = rotYm(d, uCloudRot);
  vec4 c = textureLod(uMoonC, q, lod);
  float k = abs(2.0 * uCloudPh - 1.0);
  float pot = mix(c.r, c.g, k);
  if (fp < 6.0) pot += (snoise(q * 700.0 + uCloudPh) * 0.6 + snoise(q * 1900.0) * 0.4) * 0.05 * (1.0 - smoothstep(1.5, 6.0, fp));
  // a thin atmosphere: scattered decks, most over the seas and the terminator's cool side
  float dens = smoothstep(0.64, 0.8, pot);
  dens = max(dens, smoothstep(0.7, 0.95, c.b) * 0.25);
  // the Landing keeps fair weather over its harbour
  float sd = acos(clamp(dot(d, SITE_UP), -1.0, 1.0)) * RM;
  dens *= smoothstep(12.0, 70.0, sd + 30.0 * pot);
  return dens;
}

// crater octave relief (slope vector in the tangent plane) for close views
vec3 craterDetail(vec3 p, float sc, float fpCells, float quiet, float seed) {
  vec3 q = p * sc + seed;
  vec3 base = floor(q - 0.5);
  vec3 slope = vec3(0.0);
  for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) for (int k = 0; k < 2; k++) {
    vec3 cell = base + vec3(float(i), float(j), float(k));
    vec3 h = hash33(cell);
    if (h.x > 0.55) continue;
    vec3 c = cell + 0.3 + 0.4 * hash33(cell + 7.1);
    float rr = 0.08 + 0.2 * h.y * h.y;
    vec3 dv = q - c;
    dv -= p * dot(dv, p);
    float dl = length(dv);
    float x = dl / rr;
    if (x > 2.2) continue;
    // bowl (depth 0.2 D) with a raised rim and a thinning ejecta skirt
    float g = exp(-pow((x - 1.0) * 4.5, 2.0));
    float dh = (x < 1.0 ? 0.8 * x : 0.0) - 9.0 * (x - 1.0) * g * 0.16 - (x > 1.0 ? 0.3 * pow(x, -4.0) : 0.0);
    slope += dh * dv / max(dl, 1e-5) * (1.0 - 0.7 * h.z);
  }
  return slope * quiet * (1.0 - smoothstep(0.12, 0.3, fpCells));
}

// settlement lights at one lattice scale: clusters that fall to their mean while unresolved
float lightLattice(vec3 p, float cellKm, float r0, float fp, float seed) {
  vec3 q = p * (RM / cellKm) + seed;
  float fc = fp / cellKm;
  float res = 1.0 - smoothstep(0.12, 0.35, fc);
  if (res <= 0.0) return 1.0;
  vec3 base = floor(q - 0.5);
  float acc = 0.0;
  float rr = max(r0, fc * 0.8);
  for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) for (int k = 0; k < 2; k++) {
    vec3 cell = base + vec3(float(i), float(j), float(k));
    vec3 h = hash33(cell + 41.0);
    vec3 c = cell + 0.2 + 0.6 * hash33(cell + 13.7);
    vec3 dv = q - c;
    dv -= p * dot(dv, p);
    acc += step(h.x, 0.62) * (0.4 + 1.2 * h.y) * exp(-dot(dv, dv) / (rr * rr)) * (r0 * r0) / (rr * rr);
  }
  // mean of the pattern: 0.62 x 1.0 x pi r0^2 per cell, on about 1.2 cells per unit area
  float mean = 0.62 * 1.0 * PI * r0 * r0 * 1.2;
  return mix(1.0, acc / mean, res);
}

// fields, hedgerows and orchards around the Landing (site ortho coordinates, km): estates of
// a few kilometres, each with its own field pattern and orientation, woods between them
vec3 farmland(vec2 q, vec3 base, float fp) {
  // estates: jittered cells ~2.6 km across
  vec2 eg = q / 2.6;
  vec2 ei = floor(eg);
  float best = 9.0; vec2 eid = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = ei + vec2(float(i), float(j));
    vec2 o = c + 0.2 + 0.6 * vec2(hash12(c + 3.1), hash12(c + 7.7));
    float d = length(eg - o);
    if (d < best) { best = d; eid = c; }
  }
  float he = hash12(eid + 1.3);
  float ang = he * 3.14159;
  mat2 R2 = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 sz = vec2(0.16 + 0.22 * hash12(eid + 5.0), 0.09 + 0.12 * hash12(eid + 9.0));
  vec2 g = R2 * q / sz;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash12(id + eid * 17.0);
  vec3 crop = h < 0.3 ? vec3(0.05, 0.075, 0.028) : h < 0.55 ? vec3(0.075, 0.085, 0.04) : h < 0.8 ? vec3(0.1, 0.095, 0.055) : vec3(0.04, 0.06, 0.024);
  crop *= 0.92 + 0.16 * hash12(id + 9.0);
  // hedgerows: a pixel-filtered dark line at the field edges
  vec2 fwv = vec2(fp) / sz;
  vec2 e2 = min(f, 1.0 - f);
  float hedge = max(1.0 - smoothstep(0.03, 0.03 + fwv.x, e2.x), 1.0 - smoothstep(0.03, 0.03 + fwv.y, e2.y)) * min(1.0, 0.03 / max(fwv.x, 0.03));
  vec3 c = mix(crop, vec3(0.022, 0.04, 0.018), hedge * 0.7);
  // woods where the estates meet, and whole wooded estates
  float wood = smoothstep(0.55, 0.75, snoise(vec3(q * 0.9, 3.0)) * 0.5 + 0.5) + step(0.82, he);
  c = mix(c, vec3(0.02, 0.038, 0.016), clamp(wood, 0.0, 1.0));
  float res = 1.0 - smoothstep(0.06, 0.2, fp);
  vec3 mean = mix(vec3(0.065, 0.08, 0.036), vec3(0.02, 0.038, 0.016), clamp(wood, 0.0, 1.0) * 0.8);
  return mix(mean, c, res);
}

float horizonShadow(vec3 up, float h0, vec3 sun, float sinE) {
  if (sinE > 0.2 || sinE < -0.02) return 1.0;
  vec3 ts = normalize(sun - up * sinE + 1e-6);
  float tanE = sinE / max(sqrt(1.0 - sinE * sinE), 1e-3);
  float vis = 1.0;
  float dist = 1.5;
  for (int i = 0; i < 8; i++) {
    vec3 q = normalize(up + ts * (dist / RM));
    float lod = max(log2(dist / 2.7), 0.0);
    float hq = max(decodeH(textureLod(uMoonA, q, lod).a), 0.0);
    float rise = hq - h0 - dist * dist / (2.0 * RM);
    vis = min(vis, clamp((dist * tanE - rise) / (dist * 0.035) + 0.5, 0.0, 1.0));
    dist *= 1.85;
  }
  return vis;
}

void main() {
  vec3 rdV = normalize(vView);
  vec3 rd = normalize(uViewToM * rdV);
  float b = dot(uCamM, rd);
  float dC = b * b - uC1;
  if (dC < 0.0) discard;
  float dG = b * b - uC0;
  bool hitG = dG >= 0.0 && b < 0.0 && uC0 > 0.0;
  float tG = hitG ? uC0 / (-b + sqrt(dG)) : 0.0;
  // the cloud deck along the ray: entering it from above, or leaving it from below
  float sC = sqrt(dC);
  float tC = uC1 > 0.0 ? (b < 0.0 ? uC1 / (-b + sC) : -1.0) : (-b + sC);
  bool cloudFirst = tC > 0.0 && (!hitG || tC < tG);
  if (!hitG && !cloudFirst) discard;

  vec3 sun = uSunM;
  vec3 col = vec3(0.0);
  float alpha = 1.0;
  if (hitG) {
    vec3 pG = uCamM + rd * tG;
    vec3 up = normalize(pG);
    float fp = max(tG * uPixAng, 1e-4);           // km per pixel
    vec4 A = texture(uMoonA, up);
    vec4 Nt = texture(uMoonN, up);
    float h = decodeH(A.a);
    vec3 alb = A.rgb * A.rgb;                       // land, or the sea bed under water
    vec3 nB = normalize(Nt.rgb * 2.0 - 1.0);
    // coastline from the filtered water mask, a pixel wide wherever it is drawn
    float aw = max(fwidth(Nt.a) * 0.75, 0.02);
    float waterF = smoothstep(0.5 - aw, 0.5 + aw, Nt.a);
    // near the Landing: the exact coast of the Bay and the farmland (site ortho coordinates)
    vec3 loc = uCamS + toSite(rd) * tG;
    float siteD = length(loc.xz);
    float nearSite = 1.0 - smoothstep(24.0, 32.0, siteD);
    vec3 bed = alb;
    if (nearSite > 0.0) {
      float bd = bayDist(loc.xz);
      float aa = max(fp * 0.7, 0.001);
      waterF = mix(waterF, smoothstep(-aa, aa, bd), nearSite);
      float hs = bd > 0.0 ? -min(0.3, 0.0015 + bd * 0.03) : 0.012 + 0.004 * min(-bd, 8.0);
      h = mix(h, hs, nearSite);
      bed = mix(bed, mix(vec3(0.3, 0.27, 0.2), vec3(0.05, 0.06, 0.05), smoothstep(0.005, 0.12, -hs)), nearSite);
      vec3 fa = farmland(loc.xz, alb, fp);
      alb = mix(alb, fa, (1.0 - smoothstep(9.0, 18.0, siteD)) * smoothstep(2.6, 4.0, siteD));
      // the shore: a strip of pale shingle
      alb = mix(alb, vec3(0.3, 0.28, 0.22), (1.0 - smoothstep(0.01, 0.05 + fp, -bd)) * nearSite);
    }
    float depth = max(-h, 0.0015);
    float hl = max(h, 0.0);
    float mu = dot(up, sun);
    float lit = smoothstep(-0.012, 0.012, mu);
    // sunlight through the thin air: warmer as the Sun sinks
    vec3 sunCol = mix(vec3(1.0, 0.62, 0.36), vec3(1.0, 0.975, 0.94), smoothstep(-0.01, 0.14, mu));
    float vis = horizonShadow(up, hl, sun, mu);
    // cloud shadow where the sun ray crosses the deck
    float csh = 1.0;
    if (mu > -0.05) {
      vec3 ps = normalize(up + sun * (HC / RM) / max(mu, 0.07));
      csh = 1.0 - 0.75 * cloudAt(ps, 1.0, 10.0);
    }
    vec3 E = uSunE * sunCol * lit * vis * csh;
    vec3 sky = uSunE * vec3(0.03, 0.05, 0.1) * smoothstep(-0.1, 0.3, mu);
    // earthshine: the Earth fills 2 degrees of the sky; lit fraction and elevation
    float eEl = dot(up, uEarthM);
    vec3 earth = uSunE * vec3(0.55, 0.7, 1.0) * 9.0e-4 * uEarthLit * smoothstep(-0.02, 0.2, eEl);
    vec3 V = -rd;
    vec3 landCol = vec3(0.0), seaCol = vec3(0.0);
    if (waterF < 0.999) {
      // relief: baked normals (exaggerated a little) plus finer craters when close
      float nu = max(dot(nB, up), 0.2);
      vec3 grad = (nB - up * dot(nB, up)) / nu;
      float quiet = smoothstep(9.0, 26.0, acos(clamp(dot(up, SITE_UP), -1.0, 1.0)) * RM);
      if (fp < 2.0) grad -= craterDetail(up, RM / 5.0, fp / 5.0, quiet, 0.0) * 0.55;
      if (fp < 0.6) grad -= craterDetail(up, RM / 1.4, fp / 1.4, quiet, 37.0) * 0.5;
      if (fp < 0.25) {
        vec3 e = up * RM / 0.35;
        vec3 gn = vec3(snoise(e), snoise(e + 5.2), snoise(e + 9.7)) * 0.08 * (1.0 - smoothstep(0.03, 0.1, fp / 0.35));
        grad += gn - up * dot(gn, up);
      }
      grad *= 1.0 - nearSite * (1.0 - smoothstep(3.0, 9.0, siteD));
      vec3 n = normalize(up - grad * 1.5);
      float ndl = max(dot(n, sun), 0.0);
      landCol = alb / PI * (E * ndl + sky * (0.6 + 0.4 * dot(n, up)) + earth * max(dot(n, uEarthM), 0.0));
      // settlement lights at night: coasts and lowlands, most of all facing home; towns and
      // villages where they are resolved, their mean where they are not
      float night = 1.0 - smoothstep(-0.06, 0.03, mu);
      if (night > 0.0) {
        float wn = textureLod(uMoonN, up, 3.5).a;          // water within ~20 km
        float band = smoothstep(0.03, 0.14, wn) * (1.0 - smoothstep(0.6, 0.9, wn));
        float suit = (1.0 - smoothstep(0.35, 1.6, hl)) * (1.0 - smoothstep(0.78, 0.88, abs(up.y)));
        float side = 0.2 + 0.8 * smoothstep(-0.3, 0.6, up.x);
        // towns cluster: a low-frequency pattern breaks the lit coasts into strings of places
        float clus = smoothstep(0.42, 0.8, snoise(up * 38.0) * 0.5 + 0.5 + 0.25 * snoise(up * 110.0));
        float dens = suit * side * (band * 0.9 * clus + 0.03);
        for (int i = 0; i < ${TOWNS.length}; i++) {
          float dk = acos(clamp(dot(up, uTown[i].xyz), -1.0, 1.0)) * RM;
          dens += uTown[i].w * (exp(-dk * dk / 60.0) * 1.2 + exp(-dk * dk / 1500.0) * 0.25) * (i == 0 ? 0.35 : 1.0);
        }
        float pat = 0.55 * lightLattice(up, 3.0, 0.12, fp, 0.0) + 0.45 * lightLattice(up, 0.9, 0.035, fp, 17.0);
        // the Landing draws its own lamps and windows close up
        float own = nearSite > 0.0 ? smoothstep(2.0, 4.5, siteD) : 1.0;
        landCol += vec3(1.0, 0.7, 0.42) * dens * pat * night * 0.12 * own;
      }
    }
    if (waterF > 0.001) {
      // shallow seas: the sea bed seen through clear water, the sky and the Sun mirrored
      vec3 nw = up;
      if (fp < 0.3) {
        vec3 w = (up * RM + vec3(uTime * 0.004, 0.0, uTime * 0.003)) / 0.06;
        vec3 gw = vec3(snoise(w), snoise(w + 3.3), snoise(w + 7.1)) * 0.035 * (1.0 - smoothstep(0.05, 0.3, fp));
        nw = normalize(up + gw - up * dot(gw, up));
      }
      float wind = snoise(up * 40.0 + vec3(0.0, uCloudPh, 0.0)) * 0.5 + 0.5;
      float al = mix(0.08, 0.14, wind);
      vec3 Hh = normalize(V + sun);
      float nh = max(dot(nw, Hh), 0.0), nv = max(dot(nw, V), 1e-3), nl = max(dot(nw, sun), 0.0);
      float a2 = al * al;
      float dd = nh * nh * (a2 - 1.0) + 1.0;
      float D = a2 / (PI * dd * dd);
      float kk = al * 0.5;
      float G = (nv / (nv * (1.0 - kk) + kk)) * (nl / (nl * (1.0 - kk) + kk));
      float F = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, Hh), 0.0, 1.0), 5.0);
      float Fv = 0.02 + 0.98 * pow(clamp(1.0 - nv, 0.0, 1.0), 5.0);
      vec3 spec = vec3(D * G * F / (4.0 * nv + 1e-4)) * E;
      float tr = exp(-depth / 0.02);
      vec3 deep = vec3(0.003, 0.014, 0.026);
      vec3 shallowTint = vec3(0.4, 0.85, 0.8);
      vec3 body = mix(deep, bed * shallowTint, tr) / PI * (E * max(mu, 0.0) + sky + earth);
      vec3 skyR = uSunE * vec3(0.02, 0.04, 0.09) * smoothstep(-0.1, 0.3, mu);
      seaCol = body * (1.0 - Fv) + Fv * skyR + spec;
    }
    col = mix(landCol, seaCol, waterF);
    gl_FragColor = vec4(col, 1.0);
    vec4 clip = projectionMatrix * vec4(rdV * tG, 1.0);
    gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  } else {
    gl_FragColor = vec4(0.0);
    gl_FragDepth = gl_FragCoord.z;
    alpha = 0.0;
  }
  // the cloud deck
  if (cloudFirst) {
    vec3 pC = uCamM + rd * tC;
    vec3 nC = normalize(pC);
    float fpC = max(tC * uPixAng, 1e-4);
    float cA = cloudAt(nC, 0.0, fpC);
    // a deck seen edge-on from beneath thins to a haze, not a painted band
    if (uC1 < 0.0) cA *= smoothstep(0.03, 0.2, abs(dot(rd, nC)));
    float muC = dot(nC, sun);
    vec3 st = normalize(sun - nC * muC + 1e-5);
    float cs = cloudAt(normalize(nC + st * 0.004), 1.0, 30.0);
    float shade = exp(-2.0 * max(cs - cA * 0.35, 0.0));
    float wrap = clamp((muC + 0.1) / 1.1, 0.0, 1.0);
    vec3 sunCol = mix(vec3(1.0, 0.6, 0.35), vec3(1.0), smoothstep(-0.02, 0.15, muC));
    vec3 cloudCol = vec3(0.9) / PI * uSunE * (sunCol * wrap * smoothstep(-0.03, 0.02, muC) * (0.4 + 0.6 * shade) + vec3(0.04, 0.06, 0.1) * smoothstep(-0.1, 0.3, muC));
    float eEl = dot(nC, uEarthM);
    cloudCol += vec3(0.55, 0.7, 1.0) * uSunE * 2.5e-4 * uEarthLit * max(eEl, 0.0);
    if (hitG) {
      gl_FragColor.rgb = mix(gl_FragColor.rgb, cloudCol, cA);
    } else {
      gl_FragColor = vec4(cloudCol * cA, cA);
      vec4 clip = projectionMatrix * vec4(rdV * tC, 1.0);
      gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
      if (cA < 0.004) discard;
    }
  }
}
`;

const _m4 = new THREE.Matrix4(), _m4b = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class MoonSurface {
  constructor(space) {
    this.space = space;
    const size = space.q.cube >= 1024 ? 1024 : space.q.cube >= 768 ? 768 : 512;
    this.bake = new MoonBake(space.renderer, size);
    this.bake.step(18);
    this.uniforms = {
      uMoonA: { value: this.bake.moonA.texture },
      uMoonN: { value: this.bake.moonN.texture },
      uMoonC: { value: this.bake.moonC.texture },
      uViewToM: { value: new THREE.Matrix3() },
      uCamM: { value: new THREE.Vector3() },
      uC0: { value: 1 }, uC1: { value: 1 },
      uCamS: { value: new THREE.Vector3() },
      uSunM: { value: new THREE.Vector3(1, 0, 0) },
      uEarthM: { value: new THREE.Vector3(1, 0, 0) },
      uEarthLit: { value: 0.5 },
      uSunE: U.uSunIlluminance,
      uPixAng: { value: 0.001 },
      uCloudRot: { value: 0 }, uCloudPh: { value: 0 },
      uTime: { value: 0 },
      uTown: { value: TOWNS.map(([la, lo, w]) => { const a = la * Math.PI / 180, o = lo * Math.PI / 180; return new THREE.Vector4(Math.cos(a) * Math.cos(o), Math.sin(a), -Math.cos(a) * Math.sin(o), w); }) },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: true, depthTest: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(PROXY, 160, 80), this.material);
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = (r, s, cam) => this._perView(cam);
  }

  _perView(cam) {
    const u = this.uniforms;
    const sim = this.space.sim;
    // camera relative to the Moon, in the Moon frame (doubles until the upload)
    _q.copy(sim.moonQuat).invert();
    const camM = _v.copy(cam.position).sub(sim.moonPos).applyQuaternion(_q);
    u.uCamM.value.copy(camM);
    const d2 = camM.lengthSq();
    u.uC0.value = d2 - R_MOON * R_MOON;
    u.uC1.value = d2 - (R_MOON + MOON_CLOUD_H) * (R_MOON + MOON_CLOUD_H);
    // site frame: x west (+Z), y up (+X), z north (+Y); relative to the Lift
    u.uCamS.value.set(camM.z, camM.x - R_MOON, camM.y);
    _m4.makeRotationFromQuaternion(_q).multiply(_m4b.extractRotation(cam.matrixWorld));
    u.uViewToM.value.setFromMatrix4(_m4);
    u.uPixAng.value = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / Math.max(this.space.size.y, 1);
    this.material.side = Math.sqrt(d2) < PROXY + 1.5 ? THREE.BackSide : THREE.FrontSide;
  }

  update(sim, realTime) {
    const u = this.uniforms;
    _q.copy(sim.moonQuat).invert();
    u.uSunM.value.copy(sim.sunDir).applyQuaternion(_q);
    const toE = _v2.copy(sim.moonPos).negate().normalize();
    u.uEarthM.value.copy(toE).applyQuaternion(_q);
    // lit fraction of the Earth seen from the Moon
    u.uEarthLit.value = 0.5 + 0.5 * sim.sunDir.dot(_v.copy(sim.moonPos).normalize());
    u.uTime.value = realTime;
    const days = sim.t / 86400;
    u.uCloudRot.value = (days * 0.35) % (Math.PI * 2);
    u.uCloudPh.value = ((days / 4) % 1 + 1) % 1;
    if (!this.bake.ready) this.bake.step(6);
  }
}
