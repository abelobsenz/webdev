// Shared GLSL for the orbital view (src/space). Distances are kilometres unless noted.
import { NOISE_GLSL } from '../shaders/noise.glsl.js';

// Simplex noise 3D (Ashima Arts / Stefan Gustavson, MIT licence) + fractal helpers.
export const SNOISE_GLSL = /* glsl */ `
#ifndef SPACE_SNOISE
#define SPACE_SNOISE
vec3 sn_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 sn_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 sn_permute(vec4 x) { return sn_mod289(((x * 34.0) + 10.0) * x); }
vec4 sn_taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = sn_mod289(i);
  vec4 p = sn_permute(sn_permute(sn_permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = sn_taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
// fractal sums in [-1, 1]-ish
float sfbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= oct) break;
    s += a * snoise(p); n += a;
    p = p * 2.03 + vec3(1.7, 9.2, 4.1);
    a *= 0.5;
  }
  return s / n;
}
float sridged(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0, w = 1.0;
  for (int i = 0; i < 10; i++) {
    if (i >= oct) break;
    float r = 1.0 - abs(snoise(p));
    r *= r;
    s += a * r * w; n += a;
    w = clamp(r * 1.6, 0.0, 1.0);
    p = p * 2.07 + vec3(5.3, 1.3, 7.7);
    a *= 0.5;
  }
  return s / n;
}
#endif
`;

// Rotations / misc
export const SPACE_UTIL_GLSL = /* glsl */ `
#ifndef SPACE_UTIL
#define SPACE_UTIL
#define S_PI 3.14159265359
vec2 sphereHits(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e30, -1e30);
  float s = sqrt(d);
  return vec2(-b - s, -b + s);
}
vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
// Blackbody colour (linear sRGB, normalised to max 1) for 1000..40000 K
vec3 blackbody(float t) {
  t = clamp(t, 800.0, 40000.0) / 100.0;
  vec3 c;
  c.r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
  c.g = t <= 66.0 ? clamp(0.39008157876 * log(t) - 0.63184144378, 0.0, 1.0) : clamp(1.129890861 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  c.b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.54320678911 * log(t - 10.0) - 1.19625408914, 0.0, 1.0));
  return pow(c, vec3(2.2));
}
#endif
`;

/**
 * Deep-space background: stars, Milky Way, zodiacal light, the Sun and the
 * Dyson swarm rings. Direction-only, so the black-hole shader can call it on
 * bent rays. Same star algorithm and galactic frame as src/sky/skyDome.js.
 * Inertial frame: +Y = celestial north, the June-solstice Sun lies in the XY plane.
 * Equatorial (RA/Dec, z = north) = (d.z, d.x, d.y).
 */
export const SPACE_SKY_GLSL = /* glsl */ `
${NOISE_GLSL}
#ifndef SPACE_SKY
#define SPACE_SKY
uniform vec3 uSkySunDir;      // direction to the Sun from the origin (Earth)
uniform vec3 uSkySunPos;      // Sun position (km)
uniform float uSkyStars;      // star brightness multiplier
uniform vec4 uSwarmN[4];      // swarm ring plane normals (xyz) + radius (w, km)
uniform float uSwarmT;        // swarm animation phase
uniform float uSkyTime;

vec3 sk_starLayer(vec3 d, float scale, float density, float bright, float px) {
  vec3 p = d * scale;
  vec3 cell = floor(p);
  vec3 h = hash33(cell);
  if (h.x > density) return vec3(0.0);
  vec3 sp = cell + 0.25 + 0.5 * hash33(cell + 17.3);
  vec3 sd = normalize(sp);
  float c = clamp(dot(sd, d), -1.0, 1.0);
  float ang2 = 2.0 * (1.0 - c);
  float sigma = max(px * 0.55, 0.00008);
  float mag = pow(h.y, 7.0);
  float core = exp(-ang2 / (2.0 * sigma * sigma)) * (px * px) / (sigma * sigma) * 1.3;
  float t = h.z;
  vec3 col = t < 0.2 ? vec3(0.62, 0.72, 1.0) : t < 0.55 ? vec3(0.95, 0.96, 1.0) : t < 0.8 ? vec3(1.0, 0.93, 0.80) : vec3(1.0, 0.76, 0.52);
  return col * core * (0.006 + 0.35 * mag) * bright;
}

vec3 sk_milkyWay(vec3 c) {
  const vec3 gN = vec3(-0.8676, -0.1981, 0.4560);
  const vec3 gC = vec3(-0.0549, -0.8734, -0.4838);
  vec3 gY = cross(gN, gC);
  float b = dot(c, gN);
  float l = atan(dot(c, gY), dot(c, gC));
  float coreW = 0.12 + 0.10 * exp(-l * l * 1.2);
  float band = exp(-b * b / (coreW * coreW));
  float bulge = exp(-(l * l) * 3.0 - b * b * 40.0);
  vec2 q = vec2(l * 3.0, b * 9.0);
  float n = fbm2(q * 2.0 + 3.0);
  float dust = smoothstep(0.35, 0.75, fbm2(q * 3.1 + 11.0)) * exp(-b * b * 180.0);
  float fil = smoothstep(0.55, 0.8, fbm2(q * 6.3 + 5.0)) * exp(-b * b * 60.0);
  float clumps = 0.55 + 0.9 * n;
  vec3 col = mix(vec3(0.55, 0.65, 1.0), vec3(1.0, 0.82, 0.62), exp(-l * l * 0.8));
  float I = band * clumps * (1.0 - 0.85 * dust) + bulge * 1.4 + fil * 0.25 * band;
  // faint emission nebulae along the plane
  vec3 neb = vec3(1.0, 0.35, 0.45) * smoothstep(0.62, 0.9, fbm2(q * 1.7 + 21.0)) * band * 0.35;
  return (col * I + neb) * 0.006;
}

// Dyson swarm: four inclined collector rings around the Sun, drawn as glowing
// threads of constant angular width with sparkling collectors.
vec3 sk_swarm(vec3 ro, vec3 rd, float px) {
  vec3 acc = vec3(0.0);
  vec3 toS = uSkySunPos - ro;
  float dS = length(toS);
  for (int k = 0; k < 4; k++) {
    vec3 n = uSwarmN[k].xyz;
    float R = uSwarmN[k].w;
    float dn = dot(rd, n);
    float t = dot(toS, n) / (abs(dn) > 1e-5 ? dn : 1e-5);
    if (t <= 0.0) continue;
    vec3 p = ro + rd * t - uSkySunPos;
    float r = length(p);
    float dist = abs(r - R) / t;                         // angular distance to the ring
    float w0 = 18000.0 / t;                              // collector band ~18,000 km thick
    float w = max(w0, px * 0.8);
    float line = exp(-dist * dist / (w * w)) * (w0 / w);
    if (line < 1e-3) continue;
    vec3 e1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(n, e1);
    float phi = atan(dot(p, e2), dot(p, e1));
    float fk = float(k);
    float seg = floor(phi * 900.0 + uSwarmT * (1.0 + fk * 0.3));
    float spark = pow(hash11(seg + fk * 91.0), 24.0) * 10.0;
    float body = 0.04 * smoothstep(0.2, 0.9, hash11(floor(phi * 60.0) + fk * 13.0));
    // the far side of each ring is back-lit and dim; the near side catches sunlight
    float face = 0.35 + 0.65 * smoothstep(-0.2, 0.6, dot(normalize(p), -toS / dS));
    acc += line * (body + spark) * face * vec3(1.0, 0.86, 0.62);
  }
  return acc;
}

vec3 sk_background(vec3 d, float px) {
  vec3 c = vec3(d.z, d.x, d.y);
  vec3 col = vec3(0.0);
  col += sk_starLayer(c, 170.0, 0.012, 1.0, px);
  col += sk_starLayer(c, 380.0, 0.005, 0.3, px);
  col += sk_starLayer(c, 800.0, 0.003, 0.12, px);
  col += sk_milkyWay(c) * 1.35;
  // zodiacal light: a faint cone along the ecliptic toward the Sun
  vec3 eclN = normalize(cross(uSkySunDir, vec3(0.0, 0.0, 1.0)));
  float eb = dot(d, eclN);
  float cs = dot(d, uSkySunDir);
  col += vec3(1.0, 0.92, 0.8) * 0.0025 * exp(-eb * eb * 60.0) * pow(max(cs * 0.5 + 0.5, 0.0), 6.0);
  return col * uSkyStars;
}

// Sun disc + glare as seen from 'ro' along 'rd'
vec3 sk_sun(vec3 ro, vec3 rd, float px, float E) {
  vec3 toS = uSkySunPos - ro;
  float dS = length(toS);
  vec3 sd = toS / dS;
  float angR = 696000.0 / dS;
  float c = dot(rd, sd);
  float ang = sqrt(max(2.0 * (1.0 - c), 0.0));
  vec3 col = vec3(0.0);
  float edge = max(px, angR * 0.02);
  float disc = smoothstep(angR + edge, angR - edge, ang);
  if (disc > 0.0) {
    float x = clamp(ang / angR, 0.0, 1.0);
    float mu = sqrt(1.0 - x * x);
    vec3 limb = pow(vec3(max(mu, 0.02)), vec3(0.42, 0.56, 0.75));
    // radiance scaled so the disc integrates to E at 1 AU
    col += vec3(1.0, 0.96, 0.9) * limb * disc * E * 2600.0;
  }
  // glare: optical scatter in the lens, not in space
  float a = ang / max(angR, 1e-6);
  col += vec3(1.0, 0.9, 0.78) * E * (0.012 * exp(-a * 0.9) + 0.0022 * exp(-a * 0.12)) * min(1.0, angR / 0.00465);
  return col;
}
#endif
`;
