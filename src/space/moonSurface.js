import * as THREE from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/uniforms.js';
import { SNOISE_GLSL } from './glsl.js';
import { R_MOON } from './sim.js';
import { MoonBake } from './moonBake.js';
import { ALL_TOWNS, ARCS, arcUniforms, townUniforms } from './lunarNetwork.js';
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
uniform float uCubeN;       // bake cube face size (texels)
uniform float uTexKm;       // one bake texel on the ground (km)
uniform vec4 uTown[${ALL_TOWNS.length}];
uniform vec4 uArcA[${ARCS.length}];
uniform vec4 uArcB[${ARCS.length}];
uniform float uPatchOn;
varying vec3 vView;
#ifdef PATCH
varying vec3 vPosM;
#endif
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

// ---- close-range ground: the bake is 2.7 km a texel, so below a few kilometres a pixel the
// maps are read with a cubic B-spline (no bilinear diamonds in the relief) and a filtered
// procedural layer carries the ground from kilometre hills down to ten-metre hummocks ----

// cubic B-spline read of both bake maps at one direction: per face, four bilinear taps at
// offset positions (a tap past the face edge lands on the neighbouring face, which is right)
void cubeBSpline(vec3 d, out vec4 A, out vec4 Nm) {
  vec3 a = abs(d);
  float ma = max(a.x, max(a.y, a.z));
  vec3 q = d / ma;
  vec3 isMaj = step(vec3(ma), a);
  // the two minor axes as texel coordinates (each axis on its own, the major one ignored)
  vec3 x = (q * 0.5 + 0.5) * uCubeN - 0.5;
  vec3 i = floor(x), f = x - i;
  vec3 f2 = f * f, f3 = f2 * f;
  vec3 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec3 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec3 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec3 w3 = f3 / 6.0;
  vec3 g0 = w0 + w1, g1 = w2 + w3;
  vec3 h0 = ((i - 1.0 + w1 / g0 + 0.5) / uCubeN) * 2.0 - 1.0;
  vec3 h1 = ((i + 1.0 + w3 / g1 + 0.5) / uCubeN) * 2.0 - 1.0;
  // pick the two minor axes (u, v) in a fixed order
  vec3 ax = isMaj.x > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 ay = isMaj.z > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
  if (isMaj.y > 0.5) { ax = vec3(1.0, 0.0, 0.0); ay = vec3(0.0, 0.0, 1.0); }
  vec3 major = q * isMaj;
  float u0 = dot(h0, ax), u1 = dot(h1, ax), v0 = dot(h0, ay), v1 = dot(h1, ay);
  float gu0 = dot(g0, ax), gu1 = dot(g1, ax), gv0 = dot(g0, ay), gv1 = dot(g1, ay);
  vec3 d00 = major + ax * u0 + ay * v0, d10 = major + ax * u1 + ay * v0;
  vec3 d01 = major + ax * u0 + ay * v1, d11 = major + ax * u1 + ay * v1;
  A = (textureLod(uMoonA, d00, 0.0) * gu0 + textureLod(uMoonA, d10, 0.0) * gu1) * gv0
    + (textureLod(uMoonA, d01, 0.0) * gu0 + textureLod(uMoonA, d11, 0.0) * gu1) * gv1;
  Nm = (textureLod(uMoonN, d00, 0.0) * gu0 + textureLod(uMoonN, d10, 0.0) * gu1) * gv0
     + (textureLod(uMoonN, d01, 0.0) * gu0 + textureLod(uMoonN, d11, 0.0) * gu1) * gv1;
}

// 3D simplex noise with its analytic gradient (x: value about -1..1, yzw: d/dp). Gradient noise
// on a skewed simplex lattice: isotropic, so the relief it shades has no grid in it (the value
// noise it replaces lit up as square "blocks" under a low Sun at orbital range)
vec4 sdnoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - 0.5;
  i = sn_mod289(i);
  vec4 p = sn_permute(sn_permute(sn_permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  vec4 j = p - 49.0 * floor(p / 49.0);
  vec4 x_ = floor(j / 7.0);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = (x_ * 2.0 + 0.5) / 7.0 - 1.0;
  vec4 y = (y_ * 2.0 + 0.5) / 7.0 - 1.0;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 g0 = vec3(a0.xy, h.x), g1 = vec3(a0.zw, h.y), g2 = vec3(a1.xy, h.z), g3 = vec3(a1.zw, h.w);
  vec4 nrm = inversesqrt(vec4(dot(g0, g0), dot(g1, g1), dot(g2, g2), dot(g3, g3)));
  g0 *= nrm.x; g1 *= nrm.y; g2 *= nrm.z; g3 *= nrm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m3 = m2 * m;
  vec4 m4 = m2 * m2;
  vec4 pdx = vec4(dot(g0, x0), dot(g1, x1), dot(g2, x2), dot(g3, x3));
  vec3 gr = -8.0 * (m3.x * pdx.x * x0 + m3.y * pdx.y * x1 + m3.z * pdx.z * x2 + m3.w * pdx.w * x3)
          + m4.x * g0 + m4.y * g1 + m4.z * g2 + m4.w * g3;
  return vec4(dot(m4, pdx), gr) * 105.0;
}

const mat3 GROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

struct Ground {
  vec3 grad;      // slope of the rolling relief (tangent plane): hummocks, swales, turf
  vec3 rgrad;     // slope of the same relief ridged: crags, aretes and gullies for bare rock
  float h;        // the procedural relief's height (km), for strata
  float broad;    // hill-scale field (1.6 km .. 150 m), about -1..1, 0 where unresolved
  float fine;     // hummock-scale field (70 m .. 7 m), about -1..1, 0 where unresolved
  float dw;       // how much of the procedural layer is resolved at all (0 from orbit)
};

// eight octaves from 1.6 km down to 7 m on a domain-warped simplex lattice; each fades to its
// mean (zero) as it shrinks below two pixels, so the ground never sparkles and never pops.
// Erosion-like damping: an octave's amplitude falls where the octaves above it are already
// steep, so slopes stay clean and the detail gathers in the hollows and on the flats.
Ground groundField(vec3 up, float fp) {
  Ground g;
  g.grad = vec3(0.0); g.rgrad = vec3(0.0); g.h = 0.0; g.broad = 0.0; g.fine = 0.0;
  float lam = 1.6;
  g.dw = 1.0 - smoothstep(0.12 * lam, 0.45 * lam, fp);
  if (g.dw <= 0.0) return g;
  vec3 p = up * (RM / lam);
  // the warp: a gentle low-frequency flow bends every octave's lattice into sweeping lines
  vec4 wn = sdnoise(p * 0.31 + 23.0);
  p += wn.yzw * 0.22;
  float amp = 1.0;
  vec3 acc = vec3(0.0);
  mat3 back = mat3(1.0);          // d(p)/d(position), transposed: gradients map through it
  for (int i = 0; i < 8; i++) {
    float w = 1.0 - smoothstep(0.12 * lam, 0.45 * lam, fp);
    if (w <= 0.0) break;
    vec4 n = sdnoise(p);
    vec3 gp = back * n.yzw;                       // this octave's gradient, Moon frame
    acc += gp * (amp * 0.45);
    float ero = 1.0 / (1.0 + 0.9 * dot(acc, acc));
    float a = amp * w * (i < 2 ? 1.0 : ero);
    g.grad += gp * (a * 0.45);
    // ridged: 1 - |n|, a crest wherever the noise crosses zero
    g.rgrad -= gp * (a * 0.55 * sign(n.x));
    g.h += n.x * a * lam * 0.1;
    if (i < 3) g.broad += n.x * a * 0.8; else if (i < 7) g.fine += n.x * a * 1.1;
    p = GROT * p * 2.2;
    back = back * transpose(GROT);
    lam /= 2.2;
    amp *= 0.55;
  }
  g.grad -= up * dot(g.grad, up);
  g.rgrad -= up * dot(g.rgrad, up);
  return g;
}

// tree crowns in woodland, ~cellKm apart: each a dome over a dark gap; returns the crowns'
// slope for the lighting (xyz) and the fraction of ground in shade between them (w), falling
// to the mean (no slope, the average gap) as the crowns shrink below a few pixels
vec4 canopy(vec3 up, float cellKm, float fp, float seed) {
  float res = 1.0 - smoothstep(0.12, 0.4, fp / cellKm);
  if (res <= 0.0) return vec4(0.0, 0.0, 0.0, 0.3);
  vec3 q = up * (RM / cellKm) + seed;
  vec3 base = floor(q - 0.5);
  vec3 sl = vec3(0.0);
  float cover = 0.0;
  for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) for (int k = 0; k < 2; k++) {
    vec3 cell = base + vec3(float(i), float(j), float(k));
    vec3 h = hash33(cell + 5.3);
    vec3 c = cell + 0.15 + 0.7 * hash33(cell + 19.1);
    float rr = 0.42 + 0.3 * h.x;
    vec3 dv = q - c;
    dv -= up * dot(dv, up);
    float x = length(dv) / rr;
    if (x >= 1.0) continue;
    float dome = sqrt(1.0 - x * x);
    cover = max(cover, dome);
    // a dome's slope, dz/dr = -x / sqrt(1 - x^2), capped at the crown's edge
    sl -= dv / rr * min(1.0 / max(dome, 0.25), 4.0) * 0.5 * step(0.2, h.y);
  }
  float gap = 1.0 - smoothstep(0.0, 0.35, cover);
  return vec4(sl * res, mix(0.3, gap, res));
}

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

// ---- close-range crater fields and ridges ----
// A crater population, not a lattice of identical dimples: each octave scatters craters with a
// steep power-law of sizes (most small, a few large), and each crater has an age. A fresh one
// is a deep bowl with a sharp raised rim, a bright ejecta blanket and rays; an old one is worn
// shallow, its rim rounded, its floor filled with fines and (on this Moon) grassed over. The
// larger ones in the coarse octaves are complex: a flat floor, slumped terraces down the
// walls and a central peak. The density itself varies over the globe (saturated highland
// fields beside smoother plains), so the ground never reads as a uniform bumpy noise.
// Heights are in units of each crater's radius (they are self-similar), so the slopes are
// dimensionless and add straight into the relief gradient (+grad h, downhill is -grad).
struct Craters {
  vec3 grad;      // height gradient (tangent plane)
  float alb;      // albedo factor: fresh ejecta and rays brighter, old floors darker
  float rock;     // exposed rock: fresh walls, rims and blocky ejecta
  float veg;      // filled old floors: meadow and water-loving scrub
};

void craterOctave(inout Craters C, vec3 p, float cellKm, float fp, float quiet, float seed, float dens, float cplx) {
  float fc = fp / cellKm;
  float res = 1.0 - smoothstep(0.1, 0.3, fc);
  if (res <= 0.0) return;
  // rays and rim albedo sharpen only once the crater spans a good many pixels
  float resA = 1.0 - smoothstep(0.04, 0.16, fc);
  vec3 q = p * (RM / cellKm) + seed;
  vec3 base = floor(q - 0.5);
  vec3 e1 = normalize(cross(p, abs(p.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(p, e1);
  for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) for (int k = 0; k < 2; k++) {
    vec3 cell = base + vec3(float(i), float(j), float(k));
    vec3 h = hash33(cell + seed * 0.173);
    if (h.x > dens) continue;
    vec3 h2 = hash33(cell + 7.1);
    vec3 c = cell + 0.25 + 0.5 * h2;
    // sizes: a steep power law (radius 0.05 .. 0.42 cell), the largest rare
    float s3 = h.y * h.y * h.y;
    float rr = 0.05 + 0.37 * s3 * h.y;
    vec3 dv = q - c;
    dv -= p * dot(dv, p);
    float dl = length(dv);
    float x = dl / rr;
    if (x > 3.2) continue;
    vec3 dir = dv / max(dl, 1e-5);
    // age 0 fresh .. 1 degraded; fresh craters are the rarer
    float age = sqrt(h.z);
    float fresh = 1.0 - smoothstep(0.0, 0.45, age);
    float keep = 1.0 - 0.72 * age;                          // relief left after degradation
    float depth = 0.42 * keep;
    // complex: flat floor, terraced walls and a central peak for the big ones of coarse octaves
    float big = cplx * smoothstep(0.18, 0.34, rr);
    float fl = mix(0.0, 0.55, big);
    // the bowl, h = -depth (1.0 - smoothstep(fl, 1.0, x)): its slope on the walls
    float t = clamp((x - fl) / (1.0 - fl), 0.0, 1.0);
    float dhdx = x < 1.0 ? depth * 6.0 * t * (1.0 - t) / (1.0 - fl) : 0.0;
    // slumped terraces: the wall slope broken into steps (steep scarps, level benches)
    dhdx *= 1.0 + big * 0.9 * sin(t * 18.85) * step(0.05, t) * resA;
    // the rim: a raised lip, sharp when fresh, rounded when old
    float w = 0.14 + 0.22 * age;
    float rimH = 0.09 * keep;
    float gr = (x - 1.0) / w;
    float rim = exp(-gr * gr);
    dhdx += rimH * rim * (-2.0 * gr / w);
    // the ejecta blanket falling away outside the rim (hummocky close to it)
    if (x > 1.0) {
      float xi = 1.0 / x;
      dhdx -= 3.0 * 0.05 * keep * xi * xi * xi * xi;
    }
    // the central peak
    float pk = x / 0.16;
    dhdx += big * 0.3 * keep * exp(-pk * pk) * (-2.0 * pk / 0.16);
    C.grad += dhdx * dir * quiet * res;
    // albedo: fresh ejecta bright out to ~2.2 radii with rays past it; old floors darker and
    // grassed; the walls and rim of the fresh ones bare rock
    float blanket = (1.0 - smoothstep(1.0, 2.2, x)) * step(1.0, x);
    float ang = atan(dot(dir, e2), dot(dir, e1));
    float nr = 7.0 + floor(h2.z * 6.0);
    float ray = max(0.0, sin(ang * nr + h2.x * 30.0)) * max(0.0, sin(ang * (nr * 2.0 + 3.0) + h2.y * 20.0));
    ray *= smoothstep(1.0, 1.3, x) * (1.0 - smoothstep(1.6, 3.2, x));
    float bright = fresh * (0.55 * blanket + mix(0.12, 0.9 * ray, resA) * (1.0 - blanket) + 0.25 * (1.0 - step(1.0, x)));
    float floorF = (1.0 - smoothstep(fl * 0.9 + 0.35, 0.92, x)) * smoothstep(0.35, 0.8, age);
    C.alb *= 1.0 + (0.62 * bright - 0.2 * floorF) * res * quiet;
    float wall = smoothstep(0.45, 0.8, x) * (1.0 - smoothstep(1.0, 1.25, x));
    C.rock = max(C.rock, (fresh * (wall + 0.5 * blanket) + (1.0 - fresh) * rim * 0.45) * res * quiet);
    C.veg = max(C.veg, floorF * res * quiet);
  }
}

// wrinkle ridges and scarps: sinuous ridged crests tens of kilometres long (the crest where
// a warped simplex field crosses zero), steep on one flank, strongest on the old plains
vec3 ridgeField(vec3 up, float fp, float amt) {
  vec3 g = vec3(0.0);
  float lam = 26.0;
  float a = 1.0;
  for (int i = 0; i < 2; i++) {
    float res = 1.0 - smoothstep(0.12 * lam, 0.4 * lam, fp);
    if (res > 0.0) {
      vec3 pp = up * (RM / lam) + float(i) * 13.1;
      vec4 wv = sdnoise(pp * 0.37 + 5.0);
      vec4 n = sdnoise(pp + wv.yzw * 0.3);
      // ridge: 1 - |n| sharpened; its gradient -sign(n) grad n, steeper on the side of n > 0
      float cr = 1.0 - smoothstep(0.0, 0.35, abs(n.x));
      float flank = n.x > 0.0 ? 1.0 : 0.45;
      g -= sign(n.x) * n.yzw * cr * flank * a * res * 0.05;
    }
    lam /= 3.2;
    a *= 0.6;
  }
  g -= up * dot(g, up);
  return g * amt;
}

Craters craterField(vec3 up, float fp, float quiet, float worked, float hl) {
  Craters C;
  C.grad = vec3(0.0); C.alb = 1.0; C.rock = 0.0; C.veg = 0.0;
  // the regional crater density: saturated fields on the old highlands, sparse on the young
  // plains, patchy in between (two scales, so fields have edges, not a uniform scatter)
  float reg = snoise(up * 5.3) * 0.6 + snoise(up * 19.0) * 0.4;
  float high = smoothstep(0.1, 1.2, hl);
  float d0 = clamp(0.22 + 0.38 * reg + 0.25 * high, 0.05, 0.8);
  float q = quiet;
  craterOctave(C, up, 24.0, fp, q, 3.0, d0 * 0.8, 1.0);
  craterOctave(C, up, 6.5, fp, q, 11.0, d0, 1.0);
  craterOctave(C, up, 1.7, fp, q, 37.0, d0 * 1.1, 0.5);
  float qw = max(q, worked * 0.7);
  if (fp < 0.1) craterOctave(C, up, 0.34, fp, qw, 71.0, clamp(d0 * 1.2 + 0.15, 0.0, 0.85), 0.0);
  if (fp < 0.025) craterOctave(C, up, 0.075, fp, qw, 97.0, 0.7, 0.0);
  return C;
}

// settlement lights at one lattice scale: clusters that fall to their mean while unresolved
float lightLattice(vec3 p, float cellKm, float r0, float fp, float seed) {
  vec3 q = p * (RM / cellKm) + seed;
  float fc = fp / cellKm;
  float res = 1.0 - smoothstep(0.12, 0.35, fc);
  if (res <= 0.0) return 1.0;
  vec3 base = floor(q - 0.5);
  float acc = 0.0;
  r0 /= cellKm;                                  // light radius in cell units
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

// ---- the settled Moon seen from above (lunarNetwork.js): towns with their street plans, the
// highways and rail corridors between them, harbours on the coasts, ships in the roads ----

// a lit line of half-width w (km) seen at footprint fp (km per pixel): its light spreads over
// at least a pixel but keeps its total, so a 40 m highway still reads from orbit as a faint
// thread instead of vanishing or shimmering, and sharpens to a lamp-lit strip up close
float litLine(float d, float w, float fp) {
  float s = max(w, fp * 0.75);
  float x = d / s;
  return exp(-x * x) * (w / s);
}

struct City {
  vec3 land;      // lights drawn on land: street grids, avenues, rings, highways, villages, quays
  vec3 rail;      // rail corridors and their trains (on land, and on the causeways over the sea)
  float near;     // how deep in a town's metropolitan area (harbour traffic, sea glow)
  float urb;      // built-up fraction (daytime albedo)
  float road;     // paved-line coverage (daytime albedo)
  float own;      // 0 where an outpost or the Landing draws its own lamps
};

City cityAt(vec3 up, float fp, float shore, float t, float siteD) {
  City c;
  c.land = vec3(0.0); c.rail = vec3(0.0);
  c.near = 0.0; c.urb = 0.0; c.road = 0.0; c.own = smoothstep(22.0, 30.0, siteD);
  float resolvedGrid = 1.0 - smoothstep(0.05, 0.14, fp);
  for (int i = 0; i < ${ALL_TOWNS.length}; i++) {
    vec4 T = uTown[i];
    float w = T.w;
    float Rc = 4.0 + 14.0 * w;                          // core radius (km)
    if (dot(up, T.xyz) < cos(Rc * 3.4 / RM)) continue;
    vec3 e1 = normalize(cross(T.xyz, abs(T.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(T.xyz, e1);
    float rot = float(i) * 0.71;
    vec2 q0 = vec2(dot(up, e1), dot(up, e2)) * RM;
    vec2 q = vec2(cos(rot) * q0.x - sin(rot) * q0.y, sin(rot) * q0.x + cos(rot) * q0.y);
    float r = length(q);
    if (i > 0) c.own = min(c.own, smoothstep(2.6, 4.2, r));
    // the Landing (town 0) is modelled out to ~25 km: only its outer metropolis is drawn here
    float keep = i == 0 ? smoothstep(24.0, 34.0, r) : 1.0;
    float core = exp(-r * r / (Rc * Rc)) * keep;
    float metro = exp(-r * r / (Rc * Rc * 5.0)) * keep;
    c.near = max(c.near, metro);
    // boulevards out of the centre, and ring roads round it
    float nav = 6.0 + floor(w * 8.0);
    float sect = 6.2831853 / nav;
    float th = atan(q.y, q.x + 1e-5);                  // (defined at the very centre too)
    float dA = abs(fract(th / sect + 0.5) - 0.5) * sect * r;
    float av = litLine(dA, 0.03, fp) * smoothstep(0.3, 1.2, r) * metro;
    float rp = Rc * 0.42;
    float dR = abs(fract(r / rp + 0.5) - 0.5) * rp;
    float rings = litLine(dR, 0.025, fp) * (1.0 - smoothstep(Rc * 1.6, Rc * 2.0, r)) * smoothstep(0.4, 1.2, r) * keep;
    // the blocks' street grid (350 m), normalised to a mean of one; each 1.4 km district its
    // own brightness (dark parks and yards, bright centres)
    vec2 gq = abs(fract(q / 0.35 + 0.5) - 0.5) * 0.35;
    float grid = mix(1.0, (litLine(gq.x, 0.008, fp) + litLine(gq.y, 0.008, fp)) / 0.081, resolvedGrid);
    float blk = hash12(floor(q / 1.4) + float(i) * 7.0);
    float dist = step(0.16, blk) * mix(0.35, 1.35, blk);
    c.urb = max(c.urb, (core * 0.8 + metro * 0.2) * mix(1.0, dist, 0.5));
    c.road = max(c.road, (av + rings) * 2.0);
    c.land += w * (vec3(1.0, 0.71, 0.42) * core * dist * min(grid, 3.0) * 1.3
                 + vec3(1.0, 0.85, 0.64) * (av * 3.0 + rings * 2.2)
                 + vec3(1.0, 0.72, 0.45) * metro * 0.06);
    // harbour: the quays along the shore within the town, cool floodlights on the cranes and
    // the container stacks, a red beacon on each crane jib
    float quay = shore * metro * w;
    float cranes = mix(0.25, step(0.93, hash12(floor(q / 0.3) + 13.0)) * 3.0, resolvedGrid);
    c.land += quay * (vec3(0.8, 0.9, 1.0) * 2.4 + vec3(1.0, 0.2, 0.08) * cranes);
  }
  // highways and rail corridors: great-circle arcs between the towns
  for (int i = 0; i < ${ARCS.length}; i++) {
    vec3 a = uArcA[i].xyz, b = uArcB[i].xyz;
    vec3 n = normalize(cross(a, b));
    float dn = abs(dot(up, n)) * RM;
    float wk = uArcA[i].w;
    if (dn > max(0.5, fp * 3.0)) continue;
    if (dot(cross(a, up), n) < 0.0 || dot(cross(up, b), n) < 0.0) continue;
    float s = acos(clamp(dot(up, a), -1.0, 1.0)) * RM;
    float L = acos(clamp(dot(a, b), -1.0, 1.0)) * RM;
    float ends = smoothstep(3.0, 14.0, s) * smoothstep(3.0, 14.0, L - s);
    float line = litLine(dn, wk, fp) * ends;
    if (uArcB[i].w < 0.5) {
      // a highway: sodium lamps every 50 m where they resolve, a corridor of roadside plots,
      // and a village every ~28 km of it
      float lp = abs(fract(s / 0.05) - 0.5) * 0.05;
      float lamps = mix(1.0, litLine(lp, 0.004, fp) / 0.142, 1.0 - smoothstep(0.004, 0.02, fp));
      float plots = litLine(dn, 0.35, fp) * mix(0.45, step(0.55, hash12(vec2(floor(s / 0.6), float(i) + 0.5 * sign(dot(up, n))))), 1.0 - smoothstep(0.2, 0.6, fp));
      float vc = (floor(s / 28.0) + 0.5) * 28.0;
      float hv = hash12(vec2(floor(s / 28.0), float(i) * 3.1));
      float ds = s - vc - (hv - 0.5) * 10.0;
      float vs = max(1.26, fp * 0.75);          // (a village keeps its light as it shrinks below a pixel)
      float vil = exp(-(ds * ds + dn * dn) / (vs * vs)) * (1.6 / (vs * vs)) * step(0.35, hv) * ends;
      c.land += vec3(1.0, 0.6, 0.28) * line * lamps * 1.6 + vec3(1.0, 0.72, 0.45) * (plots * 0.9 + vil * 0.9) * ends;
      c.road = max(c.road, line);
    } else {
      // a rail corridor: cool white line lighting, a station every 45 km, and the trains,
      // 400 m of lit carriages at 140 m/s each way, a train every 36 km
      float st = s - (floor(s / 45.0) + 0.5) * 45.0;
      float ss = max(0.6, fp * 0.75);
      float sta = exp(-(st * st + dn * dn) / (ss * ss)) * (0.36 / (ss * ss));
      float sp = max(0.4, fp);
      float d1 = (fract((s - t * 0.14) / 36.0 + 0.5) - 0.5) * 36.0;
      float d2 = (fract((s + t * 0.14) / 36.0) - 0.5) * 36.0;
      float trains = (exp(-d1 * d1 / (sp * sp)) + exp(-d2 * d2 / (sp * sp))) * (0.4 / sp) * litLine(dn, 0.02, fp) / max(litLine(0.0, 0.02, fp), 1e-4);
      c.rail += (vec3(0.7, 0.86, 1.0) * line * 1.3 + vec3(0.8, 0.92, 1.0) * sta * 1.2 + vec3(1.0, 0.95, 0.85) * trains * 2.5) * ends;
      c.road = max(c.road, line);
    }
  }
  return c;
}

// ships in the roads off the towns: running lights moving slowly on the water, one in some
// cells of a 3 km lattice, falling to their mean where they no longer resolve
float shipLights(vec3 p, float fp, float t) {
  vec3 q = p * (RM / 3.0);
  float fc = fp / 3.0;
  float res = 1.0 - smoothstep(0.1, 0.3, fc);
  if (res <= 0.0) return 0.3;
  vec3 base = floor(q - 0.5);
  float acc = 0.0;
  float r0 = 0.012, rr = max(r0, fc * 0.8);
  for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) for (int k = 0; k < 2; k++) {
    vec3 cell = base + vec3(float(i), float(j), float(k));
    vec3 h = hash33(cell + 71.0);
    float ph = t * (0.0015 + 0.002 * h.z) + h.y * 6.2831853;
    vec3 c = cell + 0.5 + 0.3 * vec3(cos(ph), sin(ph * 0.7), sin(ph));
    vec3 dv = q - c;
    dv -= p * dot(dv, p);
    acc += step(h.x, 0.3) * exp(-dot(dv, dv) / (rr * rr)) * (r0 * r0) / (rr * rr);
  }
  return mix(0.3, acc / (0.3 * PI * r0 * r0 * 1.2), res);
}

// fields, hedgerows and orchards around the Landing (site ortho coordinates, km): estates of
// a few kilometres, each with its own field pattern and orientation, woods between them
vec3 farmland(vec2 q, vec3 base, float fp, float gap, out float woodF) {
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
  // each row of fields set off from the last (strips and closes, not a chessboard)
  g.x += hash12(vec2(floor(g.y), eid.x * 3.1 + eid.y)) * 0.9;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash12(id + eid * 17.0);
  // crops a season apart: young and full green, ripening gold, fresh tilth, pasture, orchard,
  // close in brightness so the pattern reads by hue
  vec3 crop = h < 0.24 ? vec3(0.055, 0.08, 0.03) : h < 0.42 ? vec3(0.07, 0.086, 0.036) : h < 0.6 ? vec3(0.092, 0.088, 0.046)
            : h < 0.72 ? vec3(0.074, 0.064, 0.042) : h < 0.88 ? vec3(0.062, 0.078, 0.036) : vec3(0.046, 0.066, 0.03);
  crop *= 0.94 + 0.12 * hash12(id + 9.0);
  // drill rows 8 m apart along each field, while they span three pixels or more
  float rowsK = 1.0 - smoothstep(0.0013, 0.0027, fp);
  if (rowsK > 0.0) crop *= 1.0 - rowsK * 0.08 * (0.5 + 0.5 * sin(f.y * sz.y * 785.0));
  // hedgerows: a pixel-filtered dark line at the field edges
  vec2 fwv = vec2(fp) / sz;
  vec2 e2 = min(f, 1.0 - f);
  float hedge = max(1.0 - smoothstep(0.03, 0.03 + fwv.x, e2.x), 1.0 - smoothstep(0.03, 0.03 + fwv.y, e2.y)) * min(1.0, 0.03 / max(fwv.x, 0.03));
  vec3 c = mix(crop, vec3(0.022, 0.04, 0.018), hedge * 0.7);
  // woods where the estates meet, and whole wooded estates
  // (their margins frayed into spurs and clearings where they resolve, not smooth blobs)
  float fray = snoise(vec3(q * 4.5, 7.0)) * 0.1 * (1.0 - smoothstep(0.05, 0.15, fp)) + snoise(vec3(q * 15.0, 1.0)) * 0.05 * (1.0 - smoothstep(0.015, 0.05, fp));
  float wood = clamp(smoothstep(0.55, 0.75, snoise(vec3(q * 0.9, 3.0)) * 0.5 + 0.5 + fray) + step(0.82, he), 0.0, 1.0);
  // the stands within a wood: darker conifer, brighter broadleaf and birch, and the crowns
  float stand = snoise(vec3(q * 2.3, 9.0)) * 0.5 + 0.5;
  vec3 woodC = mix(vec3(0.016, 0.032, 0.015), vec3(0.03, 0.05, 0.02), stand) * (1.0 - 0.5 * gap);
  // the hedges are tree lines: their crowns show too
  c = mix(c, c * (1.0 - 0.4 * gap), hedge * 0.6);
  c = mix(c, woodC, wood);
  woodF = max(wood, hedge * 0.6);
  float res = 1.0 - smoothstep(0.06, 0.2, fp);
  vec3 mean = mix(vec3(0.065, 0.08, 0.036), vec3(0.02, 0.038, 0.016), wood * 0.8);
  return mix(mean, c, res);
}

float horizonShadow(vec3 up, float h0, vec3 sun, float sinE) {
  if (sinE > 0.2 || sinE < -0.02) return 1.0;
  vec3 ts = normalize(sun - up * sinE + 1e-6);
  float tanE = sinE / max(sqrt(1.0 - sinE * sinE), 1e-3);
  float vis = 1.0;
  // (the first step a good fraction of a bake texel out, and the occluder read a level blurrier:
  // stepping through bilinear texels cast square-edged shadow blocks under a low Sun)
  float dist = max(1.5, 0.45 * uTexKm);
  for (int i = 0; i < 8; i++) {
    vec3 q = normalize(up + ts * (dist / RM));
    // one level blurrier than the march step: the occluder is a smooth ridge, not texels
    float lod = max(log2(dist / uTexKm), 0.0) + 1.1;
    float hq = max(decodeH(textureLod(uMoonA, q, lod).a), 0.0);
    float rise = hq - h0 - dist * dist / (2.0 * RM);
    // penumbra: the Sun's half-degree disc over the distance, and never sharper than 40 m
    vis = min(vis, clamp((dist * tanE - rise) / (dist * 0.0093 + 0.04 + dist * 0.02) + 0.5, 0.0, 1.0));
    dist *= 1.85;
  }
  return vis;
}


// ---- the hills round the Landing: shared by the ray-traced sphere (as shading) and the terrain
// patch (as geometry), so the two agree wherever both are drawn
const vec2 DRV_P0 = vec2(2.192, 1.061);          // the mass driver's breech (site km) and heading
const vec2 DRV_D = vec2(0.9701, 0.2425);
float hillMaskCore(vec3 up, vec3 loc, float coastM) {
  float siteD = length(loc.xz);
  float nearS = 1.0 - smoothstep(24.0, 32.0, siteD);
  // the shore: near the Landing the Bay's exact coast; elsewhere the bake's coast mask
  float shoreK = mix(1.0 - smoothstep(0.34, 0.48, coastM), smoothstep(0.08, 0.4, -bayDist(loc.xz)), nearS);
  float mask = smoothstep(2.0, 3.2, siteD) * shoreK;
  for (int i = 0; i < ${ALL_TOWNS.length}; i++) {
    float dk = acos(clamp(dot(up, uTown[i].xyz), -1.0, 1.0)) * RM;
    mask *= smoothstep(1.5, 3.0, dk);
  }
  return mask;
}
// where the hills stand as real relief: beyond the farm plain (the hamlets, roads, pads and the
// Works stand on the sphere within 10 km), clear of the mass driver's 36 km line
float geoMask(vec3 up, vec3 loc, float coastM) {
  float siteD = length(loc.xz);
  vec2 q = loc.xz - DRV_P0;
  float t = clamp(dot(q, DRV_D), 0.0, 36.0);
  float dp = length(q - DRV_D * t);
  return hillMaskCore(up, loc, coastM) * smoothstep(10.0, 14.0, siteD) * (1.0 - smoothstep(28.0, 32.0, siteD)) * smoothstep(0.6, 1.4, dp);
}
float hillHeight(vec3 up) {
  vec3 P = up * RM;
  float h = 0.0, wl = 5.0, amp = 0.2;
  for (int o = 0; o < 4; o++) { h += sdnoise(P / wl + float(o) * 7.31).x * amp; wl *= 0.36; amp *= 0.35; }
  return h;
}

void main() {
  vec3 rdV = normalize(vView);
#ifdef PATCH
  // the terrain patch: the ground point is the mesh's own, displaced (the ray ends there)
  vec3 dM = vPosM - uCamM;
  float tG = length(dM);
  vec3 rd = dM / max(tG, 1e-6);
  float b = dot(uCamM, rd);
  float dC = b * b - uC1;
  bool hitG = true;
  float sC = sqrt(max(dC, 0.0));
  float tC = dC < 0.0 ? -1.0 : (uC1 > 0.0 ? (b < 0.0 ? uC1 / (-b + sC) : -1.0) : (-b + sC));
  bool cloudFirst = tC > 0.0 && tC < tG;
#else
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
#endif

  vec3 sun = uSunM;
  vec3 col = vec3(0.0);
  float alpha = 1.0;
  if (hitG) {
    vec3 pG = uCamM + rd * tG;
    vec3 up = normalize(pG);
    float fp = max(tG * uPixAng, 1e-4);           // km per pixel
    vec4 A = texture(uMoonA, up);
    vec4 Nt = texture(uMoonN, up);
    // magnified (a texel spans several pixels): the B-spline read instead of bilinear
    float magK = 1.0 - smoothstep(0.25, 0.8, fp / uTexKm);
    if (magK > 0.0) {
      vec4 Ab, Nb;
      cubeBSpline(up, Ab, Nb);
      A = mix(A, Ab, magK);
      Nt = mix(Nt, Nb, magK);
    }
    float h = decodeH(A.a);
    float hBake = h;
    vec3 alb = A.rgb * A.rgb;                       // land, or the sea bed under water
    vec3 nB = normalize(Nt.rgb * 2.0 - 1.0);
    Ground gf = groundField(up, fp);
    // tree crowns ~14 m apart wherever there are woods (resolved only close in)
    vec4 crowns = canopy(up, 0.014, fp, 3.0);
    float vegF = 0.0;
    // coastline from the filtered water mask (which changes across about a texel), a pixel
    // wide wherever it is drawn; close in, the hill-scale field frays it into coves and spits
    // instead of the bake's smooth bilinear lobes
    float aw = clamp(0.6 * fp / uTexKm, 0.02, 0.5);
    float coastM = Nt.a + gf.broad * 0.16 * gf.dw * smoothstep(0.02, 0.2, Nt.a) * (1.0 - smoothstep(0.8, 0.98, Nt.a));
    float waterF = smoothstep(0.5 - aw, 0.5 + aw, coastM);
    // near the Landing: the exact coast of the Bay and the farmland (site ortho coordinates)
    vec3 loc = uCamS + toSite(rd) * tG;
    float siteD = length(loc.xz);
    float nearSite = 1.0 - smoothstep(24.0, 32.0, siteD);
    // the bake lays snow where its heights (plus a noise) top ~4.6 km; round the Landing, whose
    // ground is levelled far below that, and on any low ground it left soft white blotches that
    // read as snow on farmland. There it is meadow; the high massifs and the poles keep theirs
    {
      float snowTone = smoothstep(0.3, 0.5, dot(alb, vec3(0.3, 0.5, 0.2))) * (1.0 - smoothstep(0.1, 0.3, abs(alb.r - alb.b)));
      float polar = smoothstep(0.82, 0.92, abs(up.y));
      float deSnow = snowTone * max(nearSite, 1.0 - smoothstep(3.6, 4.4, hBake)) * (1.0 - polar);
      vec3 meadow = vec3(0.075, 0.12, 0.045) * (0.85 + 0.3 * gf.fine * gf.dw);
      alb = mix(alb, meadow, deSnow);
      // and the bake's bare grey patches in the green lowlands (little green excess, middling
      // brightness) read from the air as fog or snow on the farmland: dry grass, heath and bare
      // earth instead, still a shade apart from the fields round them
      float bright0 = dot(alb, vec3(0.3, 0.5, 0.2));
      float gex0 = (alb.g - 0.5 * (alb.r + alb.b)) / max(bright0, 1e-3);
      float grey = (1.0 - smoothstep(0.04, 0.18, gex0)) * smoothstep(0.08, 0.2, bright0) * (1.0 - polar);
      float lowland = max(nearSite, 1.0 - smoothstep(2.0, 3.5, hBake));
      vec3 heath = mix(vec3(0.12, 0.12, 0.065), vec3(0.16, 0.145, 0.085), 0.5 + 0.5 * gf.fine * gf.dw);
      alb = mix(alb, heath, grey * lowland * 0.85);
    }
#ifndef PATCH
    // the terrain patch draws the ground here in relief (uPatchOn: it is in view this frame)
    if (uPatchOn > 0.5 && geoMask(up, loc, coastM) > 0.0005) discard;
#endif
    vec3 bed = alb;
    float wk = 0.0;                                 // Medii Works' worked ground (0..1)
    if (nearSite > 0.0) {
      float bd = bayDist(loc.xz);
      float aa = max(fp * 0.7, 0.001);
      waterF = mix(waterF, smoothstep(-aa, aa, bd), nearSite);
      float hs = bd > 0.0 ? -min(0.3, 0.0015 + bd * 0.03) : 0.012 + 0.004 * min(-bd, 8.0);
      h = mix(h, hs, nearSite);
      bed = mix(bed, mix(vec3(0.3, 0.27, 0.2), vec3(0.05, 0.06, 0.05), smoothstep(0.005, 0.12, -hs)), nearSite);
      float farmWood;
      vec3 fa = farmland(loc.xz, alb, fp, crowns.w, farmWood);
      float farmK = (1.0 - smoothstep(9.0, 18.0, siteD)) * smoothstep(2.6, 4.0, siteD);
      alb = mix(alb, fa, farmK);
      vegF = farmWood * farmK;
      // inside the farmland: the town's own parkland and commons, lawn and meadow round the
      // terraces and the domes (not the bare ground of the bake, a pale halo round the town)
      vec3 park = mix(vec3(0.05, 0.078, 0.03), vec3(0.075, 0.088, 0.042), snoise(vec3(loc.xz * 2.2, 5.0)) * 0.5 + 0.5);
      alb = mix(alb, park, 1.0 - smoothstep(2.6, 4.0, siteD));
      // the shore: a strip of pale shingle
      alb = mix(alb, vec3(0.3, 0.28, 0.22), (1.0 - smoothstep(0.01, 0.05 + fp, -bd)) * nearSite);
      // Medii Works (lunarWorks.js): the mine, the plant and the array stand on worked regolith,
      // not farmland: a grey-brown mottle of disturbed ground under the boulders and craters
      vec2 wuv = vec2(loc.x + loc.z, loc.z - loc.x) * 0.70710678;          // (u, v) planning axes, km
      float wbox = max(max(0.3 - wuv.x, wuv.x - 6.3), max(-7.6 - wuv.y, wuv.y + 2.3));
      wk = (1.0 - smoothstep(0.0, 0.35, wbox)) * nearSite;
      if (wk > 0.0) {
        float gn = snoise(vec3(wuv * 1.7, 11.0)) * 0.5 + 0.5;
        vec3 reg = mix(vec3(0.15, 0.143, 0.13), vec3(0.24, 0.228, 0.205), gn);
        // haul tracks and spoil: darker ruts in bands along the planning axes, where resolved
        float trk = (1.0 - smoothstep(0.012, 0.03, fp)) * smoothstep(0.55, 0.9, snoise(vec3(wuv.x * 0.6, wuv.y * 9.0, 4.0)) * 0.5 + 0.5);
        reg *= 1.0 - 0.18 * trk;
        // the array (lunarWorks.js ARRAY, 1.5 x 1.75 km) stands in meadow, not bare regolith:
        // grass between the tracker rows, the rows' shade in strips 16 m apart where they
        // resolve, the service roads every 18 rows and 36 columns pale gravel
        vec2 arr = vec2(max(0.8 - wuv.x, wuv.x - 2.3), max(-4.9 - wuv.y, wuv.y + 3.15));
        float inArr = 1.0 - smoothstep(0.0, 0.03, max(arr.x, arr.y));
        if (inArr > 0.0) {
          vec3 meadow = mix(vec3(0.05, 0.075, 0.03), vec3(0.075, 0.09, 0.04), snoise(vec3(wuv * 7.0, 2.0)) * 0.5 + 0.5);
          float rowsR = 1.0 - smoothstep(0.004, 0.012, fp);
          float rowSh = mix(0.35, 1.0 - smoothstep(0.0, 0.3, abs(fract((wuv.y + 4.9) / 0.016) - 0.5)), rowsR);
          meadow *= 1.0 - 0.35 * rowSh;
          float rdv = abs(fract((wuv.y + 4.9) / (0.016 * 18.0) - 0.5) - 0.5) * 0.288;
          float rdu = abs(fract((wuv.x - 0.8) / (0.014 * 36.0) - 0.5) - 0.5) * 0.504;
          float road = max(1.0 - smoothstep(0.005, 0.005 + fp, rdv), 1.0 - smoothstep(0.005, 0.005 + fp, rdu)) * min(1.0, 0.01 / max(fp, 0.01));
          meadow = mix(meadow, vec3(0.2, 0.19, 0.17), road);
          reg = mix(reg, meadow, inArr);
        }
        alb = mix(alb, reg, wk);
      }
    }
    // regolith grain close up: two octaves of mottle, 45 m and 12 m, where they resolve
    if (fp < 0.05) {
      vec3 e2 = up * (RM / 0.045);
      float mn = snoise(e2) * 0.6 + snoise(e2 * 3.7) * 0.4;
      alb *= 1.0 + 0.16 * mn * (1.0 - smoothstep(0.012, 0.05, fp)) * (1.0 - waterF) * (1.0 - nearSite * (1.0 - wk));
    }
    float depth = max(-h, 0.0015);
    float hl = max(h, 0.0);
    // ---- slope-, altitude- and shore-aware ground at close range ----
    // the bake's biome is read back from its colour (vegetation is the green excess over the
    // grey of rock and sand); within it the procedural field lays woods and glades, scree on
    // the steep, bare heights above the tree line, a beach and a wet margin along the coast
    float roughK = 0.0;
    float rockF = 0.0;
    if (gf.dw > 0.0) {
      float bright = dot(alb, vec3(0.3, 0.5, 0.2));
      float gex = (alb.g - 0.5 * (alb.r + alb.b)) / max(bright, 1e-3);
      float snowF = smoothstep(0.35, 0.5, bright);
      float veg = smoothstep(0.16, 0.48, gex) * (1.0 - snowF);
      float siteK = 1.0 - nearSite * (1.0 - wk);                 // the Landing's own ground stays as drawn
      // tree line: woods thin above 2 km, the field pushing it up the valleys and down the spurs
      veg *= 1.0 - smoothstep(1.9, 3.1, hl + 0.45 * gf.broad + 3.0 * gf.h);
      // steepness: the bake's slope and the procedural relief together
      float nuB = max(dot(nB, up), 0.2);
      float slope0 = length(nB - up * nuB) / nuB;
      float slope = slope0 + length(gf.grad) * mix(0.12, 0.26, 1.0 - veg);
      float steep = smoothstep(0.26, 0.5, slope + 0.08 * gf.fine);
      rockF = clamp(max(steep, 1.0 - veg - snowF - 0.2), 0.0, 1.0) * (1.0 - snowF);
      roughK = mix(0.1, 0.34, rockF) * (1.0 - 0.5 * snowF);
      vec3 g = alb;
      // vegetation: woods where the field is low and in the hollows, glades and meadow on the
      // rises; mean kept near the bake's own colour
      float woods = smoothstep(-0.25, 0.25, -gf.broad - 0.35 * gf.fine + 0.6 * (0.045 - bright) / 0.03);
      // close in, the woods are trees: crowns ~14 m apart catching the light, dark gaps between
      vec3 turf = alb * vec3(1.22, 1.16, 1.02) + vec3(0.006, 0.004, 0.0);
      turf *= 1.0 + 0.22 * gf.fine;
      // meadow flowers and dry grass patches on the open rises, where they resolve
      turf = mix(turf, turf * vec3(1.25, 1.12, 0.8), smoothstep(0.35, 0.8, gf.fine) * 0.5);
      vec3 wood = alb * vec3(0.66, 0.74, 0.62) * (1.0 - 0.55 * crowns.w);
      vec3 vegC = mix(turf, wood, woods);
      g = mix(g, vegC, veg);
      vegF = max(vegF, veg * woods);
      // rock and regolith: grey anorthosite mottled by the field, dark boulder-strewn hollows,
      // pale scree on the steep faces, and on the steepest the strata of the old lava flows
      // (bands ~7 m thick in height, drawn where a band spans a few pixels on the slope)
      vec3 rockC = vec3(0.2, 0.193, 0.18) * (0.84 + 0.2 * gf.broad) * (1.0 + 0.3 * gf.fine);
      rockC = mix(rockC, vec3(0.27, 0.262, 0.245), steep * 0.5 * smoothstep(0.0, 0.6, gf.fine));
      float bandPx = 0.007 / max(slope, 0.05) / fp;
      float strataK = steep * smoothstep(2.0, 4.5, bandPx);
      float layer = sin((hl + gf.h) * 6.2832 / 0.007);
      float layerH = hash12(vec2(floor((hl + gf.h) / 0.007), 7.0));
      rockC *= 1.0 + strataK * (0.12 * layer + 0.14 * (layerH - 0.5));
      // hollows collect the finer, darker fines; crests are scoured pale
      rockC *= 1.0 - 0.18 * smoothstep(0.1, 0.6, -gf.fine) * (1.0 - steep);
      g = mix(g, mix(alb * (0.86 + 0.2 * gf.broad + 0.24 * gf.fine), rockC, steep), rockF * (1.0 - veg));
      g = mix(g, rockC, steep * veg);                         // cliffs break through the woods
      // snow: drifts in the hollows, scoured from the crests, wind-bared rock where it is steep
      g = mix(g, g * (0.94 + 0.08 * gf.fine), snowF);
      g = mix(g, rockC * 0.8, snowF * clamp(steep * 0.7 + smoothstep(0.3, 0.8, gf.fine) * 0.3, 0.0, 1.0));
      // the shore: dry sand above the swash, a darker wet band at it, wrack along the tideline
      float shoreF = smoothstep(0.1, 0.36, coastM + 0.05 * gf.fine) * (1.0 - waterF);
      vec3 sand = vec3(0.34, 0.31, 0.24) * (0.9 + 0.12 * gf.fine);
      sand = mix(sand, sand * vec3(0.72, 0.76, 0.8), steep);       // shingle and rock where it is steep
      g = mix(g, sand, shoreF * (1.0 - snowF) * 0.9);
      float wet = smoothstep(0.34, 0.48, coastM) * (1.0 - waterF);
      g *= 1.0 - 0.38 * wet;
      float wd = (coastM - 0.3) / max(0.02, aw);
      float wrack = exp(-wd * wd) * smoothstep(0.3, 0.8, gf.fine + 0.3) * (1.0 - waterF);
      g = mix(g, vec3(0.06, 0.07, 0.04), wrack * 0.4);
      alb = mix(alb, g, gf.dw * siteK * (1.0 - nearSite * (1.0 - smoothstep(9.0, 16.0, siteD)) * (1.0 - wk)));
      vegF *= gf.dw;
    }
    float mu = dot(up, sun);
    // the settled Moon (lunarNetwork.js): towns with their street plans, highways and rail
    // corridors, harbours along the coasts; grey built-up ground and pale roads by day
    float wsh = textureLod(uMoonN, up, 1.5).a;
    float shore = smoothstep(0.05, 0.22, wsh) * (1.0 - smoothstep(0.55, 0.9, wsh)) * (1.0 - waterF);
    City city = cityAt(up, fp, shore, uTime, siteD);
    alb = mix(alb, vec3(0.15, 0.145, 0.14), clamp(city.urb, 0.0, 1.0) * 0.45 * (1.0 - nearSite));
    alb = mix(alb, vec3(0.3, 0.29, 0.27), clamp(city.road, 0.0, 1.0) * 0.55 * (1.0 - nearSite));
    float nightC = (1.0 - smoothstep(-0.06, 0.03, mu)) * city.own;
    float lit = smoothstep(-0.012, 0.012, mu);
    // sunlight through the thin air: warmer as the Sun sinks
    vec3 sunCol = mix(vec3(1.0, 0.62, 0.36), vec3(1.0, 0.975, 0.94), smoothstep(-0.01, 0.14, mu));
    // the receiver carries the procedural relief: crests stand up out of the bake's shadow
    // line and hollows fill with shade first, so the terminator breaks along the hills
    float vis = horizonShadow(up, hl + 0.5 * gf.h, sun, mu);
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
    vec3 earth = uSunE * vec3(0.55, 0.7, 1.0) * 2.4e-3 * uEarthLit * smoothstep(-0.02, 0.2, eEl);
    vec3 V = -rd;
    vec3 landCol = vec3(0.0), seaCol = vec3(0.0);
    if (waterF < 0.999) {
      // relief, as the height gradient (+grad h: the normal leans away from it). The bake's
      // normal carries -grad h in its tangent part. (Until wave 4 the baked relief and the
      // crater octaves were added with the opposite sign to the procedural field, so hills and
      // bowls were lit inside out under the true shadows: the "bumpy" ground from orbit.)
      float nu = max(dot(nB, up), 0.2);
      vec3 grad = -(nB - up * dot(nB, up)) / nu;
      float quiet = smoothstep(9.0, 26.0, acos(clamp(dot(up, SITE_UP), -1.0, 1.0)) * RM);
      // crater populations from 24 km cells down to 75 m ones, with rims, ejecta, rays, terraces
      // and central peaks; wrinkle ridges across the plains
      Craters cf = craterField(up, fp, quiet, wk, hl);
      grad += cf.grad * 0.6;
      if (fp < 9.0) grad += ridgeField(up, fp, quiet * (1.0 - 0.6 * smoothstep(0.3, 1.5, hl)));
      if (fp < 0.25) {
        vec3 e = up * RM / 0.35;
        vec3 gn = vec3(snoise(e), snoise(e + 5.2), snoise(e + 9.7)) * 0.08 * (1.0 - smoothstep(0.03, 0.1, fp / 0.35));
        grad += gn - up * dot(gn, up);
      }
      // the finest relief a lander or a low pass sees: rubble and hummocks ridged on bare rock
      // (slope-aware: the rock of crater walls and rims is rougher than the grassed floors)
      float rockAll = clamp(max(rockF, cf.rock), 0.0, 1.0);
      grad += mix(gf.grad, gf.rgrad, rockAll * rockAll) * max(roughK, 0.3 * cf.rock) * gf.dw * quiet;
      grad += crowns.xyz * 0.55 * vegF * quiet;
      grad *= 1.0 - nearSite * (1.0 - smoothstep(3.0, 9.0, siteD));
      // rolling country: the land near the settlements was levelled for kilometres round them
      // and read as a flat sheet. Four octaves of hills (5 km swells 200 m high down to 230 m
      // knolls), each dropping out once it is under a few pixels; level only where a town
      // stands and easing off toward the shore
      float hillH = 0.0, hillS = 0.0;
      {
        // (shading only - nothing seated on the sphere meets it - so it can come right up to a town's
        // edge; its slabs cover what lies under them)
        float mask = hillMaskCore(up, loc, coastM);
        if (mask > 0.001) {
          vec3 P = up * RM;
          vec3 hg = vec3(0.0);
          float wl = 5.0, amp = 0.2;
          for (int o = 0; o < 4; o++) {
            float fade = 1.0 - smoothstep(wl * 0.12, wl * 0.4, fp);
            vec4 sn = sdnoise(P / wl + float(o) * 7.31);
            hg += sn.yzw / wl * amp * fade;
            hillH += sn.x * amp;
            wl *= 0.36; amp *= 0.35;
          }
          hg = (hg - up * dot(hg, up)) * mask;
          grad += hg;
          hillH *= mask;
          hillS = length(hg);
        }
      }
      // the craters' own ground: fresh ejecta and rays pale, walls and rims bare grey rock,
      // old filled floors a deeper, damper green (and grey where the country is bare)
      // (fresh ejecta and rays are pale on bare regolith; under grass and woods they read as snow,
      // so on green ground the crater tint only darkens, never bleaches)
      float gexA = (alb.g - 0.5 * (alb.r + alb.b)) / max(dot(alb, vec3(0.3, 0.5, 0.2)), 1e-3);
      float cfA = mix(cf.alb, min(cf.alb, 1.04), smoothstep(0.05, 0.3, gexA));
      vec3 albC = alb * cfA;
      float bareRock = cf.rock * (1.0 - nearSite);
      albC = mix(albC, vec3(0.2, 0.194, 0.182) * (0.9 + 0.25 * gf.fine * gf.dw) * cf.alb, bareRock * 0.55);
      float gex0 = (alb.g - 0.5 * (alb.r + alb.b)) / max(dot(alb, vec3(0.3, 0.5, 0.2)), 1e-3);
      vec3 floorC = mix(alb * vec3(0.78, 0.8, 0.8), alb * vec3(0.72, 0.98, 0.66), smoothstep(0.1, 0.4, gex0));
      albC = mix(albC, floorC, cf.veg * 0.7 * (1.0 - nearSite));
      // the lie of the land: hollows collect the darker fines, crests and rims are scoured
      float conc = dot(cf.grad, cf.grad);
      albC *= 1.0 - 0.06 * smoothstep(0.02, 0.2, conc) * (1.0 - cf.rock);
      // the hills' own ground: drier, sun-bleached crests, lusher hollows, bare rock on the steep
      albC *= mix(vec3(1.0), vec3(1.06, 1.03, 0.92), smoothstep(0.05, 0.22, hillH)) * mix(vec3(1.0), vec3(0.88, 0.96, 0.86), smoothstep(-0.04, -0.2, hillH));
      // bare rock only where the ground is really steep (the knolls' gentle slopes stayed pale
      // grey: the "blotches" on the farmland), and a natural grey-brown, not a pale grey
      albC = mix(albC, vec3(0.15, 0.14, 0.12) * (0.9 + 0.2 * gf.fine), smoothstep(0.45, 0.8, hillS) * 0.5);
      vec3 n = normalize(up - grad * 1.5);
      float ndl = max(dot(n, sun), 0.0);
      landCol = albC / PI * (E * ndl + sky * (0.6 + 0.4 * dot(n, up)) + earth * max(dot(n, uEarthM), 0.0));
      // settlement lights at night: coasts and lowlands, most of all facing home; towns and
      // villages where they are resolved, their mean where they are not
      float night = 1.0 - smoothstep(-0.06, 0.03, mu);
      if (night > 0.0) {
        float wn = textureLod(uMoonN, up, 3.5).a;          // water within ~20 km
        float band = smoothstep(0.03, 0.14, wn) * (1.0 - smoothstep(0.6, 0.9, wn));
        float suit = (1.0 - smoothstep(0.35, 1.6, hl)) * (1.0 - smoothstep(0.78, 0.88, abs(up.y)));
        float side = 0.2 + 0.8 * smoothstep(-0.3, 0.6, up.x);
        // towns cluster: a low-frequency pattern breaks the lit coasts into strings of places
        float clus = smoothstep(0.6, 0.9, snoise(up * 30.0) * 0.5 + 0.5 + 0.22 * snoise(up * 95.0));
        float dens = suit * side * (band * 0.5 * clus + 0.02);
        float ownT = 1.0;
        for (int i = 0; i < ${ALL_TOWNS.length}; i++) {
          float dk = acos(clamp(dot(up, uTown[i].xyz), -1.0, 1.0)) * RM;
          dens += uTown[i].w * (exp(-dk * dk / 60.0) * 0.5 + exp(-dk * dk / 1500.0) * 0.12) * (i == 0 ? 0.12 : 1.0);
          // the outposts (lunarOutposts.js) draw their own lamps within a few kilometres
          if (i > 0) ownT = min(ownT, smoothstep(1.8, 3.8, dk));
        }
        float pat = 0.55 * lightLattice(up, 3.0, 0.03, fp, 0.0) + 0.45 * lightLattice(up, 0.9, 0.012, fp, 17.0);
        // the Landing draws its own lamps and windows close up
        float own = (nearSite > 0.0 ? smoothstep(2.0, 4.5, siteD) : 1.0) * ownT;
        landCol += vec3(1.0, 0.7, 0.42) * dens * pat * night * 0.12 * own;
      }
      landCol += (city.land + city.rail) * 0.12 * nightC;
    }
    if (waterF > 0.001) {
      // shallow seas: the sea bed seen through clear water, the sky and the Sun mirrored
      // wind waves: four octaves from a 150 m swell to 4 m chop, each travelling at its deep-water
      // speed under the Moon's gravity (c = sqrt(g L / 2 pi), 6 m/s for the swell) and fading out
      // once its wavelength is under a few pixels; the chop runs across the swell
      float wind = snoise(up * 40.0 + vec3(0.0, uCloudPh, 0.0)) * 0.5 + 0.5;
      vec3 nw = up;
      float crest = 0.0;
      {
        vec3 P = up * RM;
        vec3 gsum = vec3(0.0);
        float wl = 0.15, amp = 0.055 * (0.6 + 0.8 * wind);
        for (int o = 0; o < 4; o++) {
          float fade = 1.0 - smoothstep(wl * 0.12, wl * 0.5, fp);
          if (fade > 0.0) {
            float c = sqrt(1.62e-3 * wl / 6.2831853);
            vec3 dir = o % 2 == 0 ? vec3(0.8, 0.0, 0.6) : vec3(-0.45, 0.0, 0.89);
            vec3 w = (P - dir * c * uTime) / wl;
            vec3 gw = vec3(snoise(w), snoise(w + 3.3), snoise(w + 7.1));
            gsum += gw * amp * fade;
            if (o == 1) crest = snoise(w * 1.7 + 11.0) * fade;
          }
          wl *= 0.33; amp *= 0.72;
        }
        // wind slicks: calm lanes kilometres long where the chop dies and the water turns glassy
        // (they read from far off as the sea's moving texture)
        float slick = smoothstep(0.58, 0.82, snoise(vec3(P.x * 0.35, P.y * 0.35 + uTime * 0.0008, P.z * 1.3)) * 0.5 + 0.5);
        gsum *= mix(1.0, 0.3, slick);
        wind *= mix(1.0, 0.35, slick);
        nw = normalize(up + gsum - up * dot(gsum, up));
      }
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
      // surf: a broken white line just off the beach where the swell breaks, resolved close in
      float surfW = max(0.03, aw);
      float surfD = (coastM - 0.5 - surfW * 0.6) / surfW;
      float surf = exp(-surfD * surfD) * (0.55 + 0.45 * sin(uTime * 0.7 + gf.fine * 3.0 + gf.broad * 5.0)) * gf.dw * (1.0 - nearSite);
      body += vec3(0.6, 0.62, 0.62) / PI * (E * max(mu, 0.0) + sky) * surf * 0.35;
      // the sky mirrored: pale toward the horizon, deepening to the zenith, as seen along the
      // reflected ray; whitecaps where the chop breaks on a windy sea
      vec3 Rr = reflect(-V, nw);
      float rel = clamp(dot(Rr, up), 0.0, 1.0);
      vec3 skyR = uSunE * mix(vec3(0.055, 0.075, 0.105), vec3(0.012, 0.03, 0.085), smoothstep(0.0, 0.55, rel)) * smoothstep(-0.1, 0.3, mu);
      float cap = smoothstep(0.62, 0.9, crest) * smoothstep(0.55, 0.95, wind);
      // at the Landing the Bay breaks along its own shore: a foam line a few tens of metres wide,
      // pulsing with the sets, and a paler wash of shallow water behind it
      if (nearSite > 0.0) {
        float bdS = bayDist(loc.xz);
        float fx = (bdS - 0.018) / 0.014;
        float sets = 0.55 + 0.45 * sin(uTime * 0.45 - bdS * 90.0 + snoise(vec3(loc.xz * 0.6, 0.0)) * 2.0);
        float foam = exp(-fx * fx) * sets * (0.6 + 0.4 * snoise(vec3(loc.xz * 40.0, uTime * 0.3)));
        cap = max(cap, foam * nearSite * (1.0 - smoothstep(0.02, 0.08, fp)));
        body += vec3(0.02, 0.05, 0.045) * (E * max(mu, 0.0) + sky) / PI * exp(-bdS / 0.06) * nearSite;
      }
      body += vec3(0.7, 0.72, 0.72) / PI * (E * max(mu, 0.0) + sky) * cap * 0.25;
      seaCol = body * (1.0 - Fv) + Fv * skyR + spec;
      // at night: ships riding in the roads off the towns, the harbour lights mirrored near the
      // quays, and the rail causeways' lamps across the shallows
      if (nightC > 0.0) {
        float ships = shipLights(up, fp, uTime) * (city.near * 1.2 + 0.03);
        float sheen = city.near * (1.0 - smoothstep(0.55, 1.0, wsh));
        seaCol += (vec3(1.0, 0.88, 0.7) * ships * 0.9 + vec3(1.0, 0.7, 0.4) * sheen * 0.18 + city.rail * 0.8) * 0.12 * nightC;
      }
    }
    col = mix(landCol, seaCol, waterF);
    // aerial perspective from within the air (from space the air shell's own glow veils the
    // disc): the column between the eye and the ground, density falling as exp(-h / 40 km),
    // dims and reddens what lies far off and adds the blue of the lit air along the way, so
    // a horizon from the Landing's terraces or a low pass over the highlands recedes into haze
    float rcam = length(uCamM);
    float inAir = 1.0 - smoothstep(RM + 224.0, RM + 229.0, rcam);
    if (inAir > 0.0) {
      float dcam = exp(-max(rcam - RM, 0.0) / 40.0);
      float muv = dot(uCamM / max(rcam, 1e-3), rd);
      float path = min(40.0 * (1.0 - dcam) / max(-muv, 1e-4), tG) * inAir;
      vec3 ext = exp(-path * vec3(0.22, 0.46, 1.0) / 520.0);
      float pk = 1.0 - exp(-path / 520.0);
      float litA = smoothstep(-0.3, 0.15, mu);
      float cosT = dot(rd, sun);
      vec3 rayC = vec3(0.22, 0.46, 1.0) * (0.75 + 0.25 * cosT * cosT);
      vec3 dusk = vec3(1.0, 0.52, 0.28) * smoothstep(0.3, -0.05, mu) * litA;
      col = col * ext + (rayC * litA + dusk * 0.8) * pk * uSunE * 0.011;
    }
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


// ---- the terrain patch round the Landing: a polar grid (8-32 km, denser inward) displaced by the
// same hills the sphere shades, drawn with the sphere's own shader (PATCH) so ground, water, fields,
// light and air match exactly; the sphere steps aside where it stands in relief
const SDNOISE_SRC = (() => { const a = FRAG.indexOf('vec4 sdnoise(vec3 v) {'); return FRAG.slice(a, FRAG.indexOf('\n}\n', a) + 3); })();
const PATCH_FN_SRC = (() => { const a = FRAG.indexOf('// ---- the hills round the Landing'); return FRAG.slice(a, FRAG.indexOf('void main() {', a)); })();
const VERT_PATCH = /* glsl */ `
#define RM ${R_MOON.toFixed(1)}
uniform vec3 uCamM;
uniform mat3 uMToView;
uniform samplerCube uMoonN;
uniform vec4 uTown[${ALL_TOWNS.length}];
varying vec3 vView;
varying vec3 vPosM;
${SNOISE_GLSL}
${SITE_GLSL}
${SDNOISE_SRC}
${PATCH_FN_SRC}
void main() {
  float a = position.x, r = position.y;                       // polar: angle, radius (km)
  vec3 loc0 = vec3(cos(a) * r, 0.0, sin(a) * r);               // site frame: x west, z north
  vec3 up = normalize(SITE_UP * RM + SITE_WEST * loc0.x + SITE_NORTH * loc0.z);
  vec3 loc = vec3(up.z * RM, up.x * RM - RM, up.y * RM);
  float coastM = textureLod(uMoonN, up, 0.0).a;
  float h = hillHeight(up) * geoMask(up, loc, coastM);
  vec3 pM = up * (RM + h);
  vPosM = pM;
  vView = uMToView * (pM - uCamM);
  gl_Position = projectionMatrix * vec4(vView, 1.0);
}
`;

function patchGeometry(NA = 900, NR = 170) {
  const pos = new Float32Array((NA + 1) * (NR + 1) * 3), idx = [];
  let k = 0;
  for (let j = 0; j <= NR; j++) {
    const r = 8 + 24 * Math.pow(j / NR, 1.3);
    for (let i = 0; i <= NA; i++) { pos[k++] = (i / NA) * Math.PI * 2; pos[k++] = r; pos[k++] = 0; }
  }
  const W = NA + 1;
  for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) { const a = j * W + i, b = a + 1, c = a + W, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

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
      uCubeN: { value: size },
      uTexKm: { value: (Math.PI / 2) / size * R_MOON },
      uTown: { value: townUniforms() },
      uArcA: { value: arcUniforms().A }, uArcB: { value: arcUniforms().B },
      uPatchOn: { value: 0 }, uMToView: { value: new THREE.Matrix3() },
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
    // the terrain patch round the Landing (drawn first, with real depth; see VERT_PATCH)
    this.patchMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT_PATCH, fragmentShader: '#define PATCH\n' + FRAG, uniforms: this.uniforms,
      depthWrite: true, depthTest: true, side: THREE.DoubleSide,
    });
    this.patch = new THREE.Mesh(patchGeometry(), this.patchMaterial);
    this.patch.name = 'Moon: terrain round the Landing';
    this.patch.renderOrder = 3;
    this.patch.frustumCulled = false;
    this.patch.visible = false;
    this.patch.onBeforeRender = (r, s, cam) => this._perView(cam);
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
    u.uMToView.value.copy(u.uViewToM.value).transpose();
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
    // the patch is in view when the camera is low (under the proxy shell) and within reach of the Landing
    const cam = this.space.camera;
    let on = false;
    if (cam) {
      const camM = _v.copy(cam.position).sub(sim.moonPos).applyQuaternion(_q.copy(sim.moonQuat).invert());
      const alt = camM.length() - R_MOON, siteKm = Math.acos(Math.max(-1, Math.min(1, camM.x / camM.length()))) * R_MOON;
      on = alt < PROXY - R_MOON - 0.5 && siteKm < 70;
    }
    this.patch.visible = on;
    u.uPatchOn.value = on ? 1 : 0;
  }
}
