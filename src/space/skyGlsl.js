// The deep sky of the orbital view: stars coloured by magnitude and crowded toward the
// galactic plane, the Milky Way (its bulge, star clouds, the Great Rift and the other dark
// lanes, a few emission nebulae), the Magellanic Clouds, Andromeda, the zodiacal light
// with its gegenschein, the bright planets on the ecliptic, the Dyson swarm's far rings
// and the Sun's disc. Direction-only (the Hearth's lens calls it on bent rays).
//
// Frames: inertial +Y = celestial north, the June-solstice Sun in the XY plane.
// Equatorial Cartesian (x to RA 0h, y to RA 6h, z north) = (d.z, d.x, d.y).
import { NOISE_GLSL } from '../shaders/noise.glsl.js';

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
uniform vec4 uPlanets[7];     // planet directions (inertial, from the ephemeris) + brightness
uniform vec3 uPlanetCol[7];
uniform mat3 uSkyPrec;        // equatorial of date -> J2000 (three millennia of precession)
uniform vec3 uStarPal[8];     // blackbody colours at 2800 ... 20000 K (skyCatalog.js)

// galactic frame (equatorial): north galactic pole, galactic centre, l = 90 deg
const vec3 SK_GN = vec3(-0.8676, -0.1981, 0.4560);
const vec3 SK_GC = vec3(-0.0549, -0.8734, -0.4838);

// 3D value-noise fbm on the unit sphere (no seams, no pole pinching)
float sk_fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * vnoise3(p); n += a;
    p = p * 2.13 + vec3(3.1, 1.7, 5.3);
    a *= 0.5;
  }
  return s / n;
}

// Star colour from a spectral draw through the blackbody palette. The bright stars we see are
// mostly luminous: hot blue-white B and A stars seen from far off, and orange K and M giants;
// the faint crowd is mostly yellow-white F, G and K dwarfs.
vec3 sk_pal(float x) {
  x = clamp(x, 0.0, 6.999);
  int i = int(floor(x));
  return mix(uStarPal[i], uStarPal[i + 1], fract(x));
}
vec3 sk_starColor(float t, float bright) {
  // bright: a two-humped draw (giants cool, main-sequence hot); faint: centred on G
  float hot = 5.2 + 1.8 * t;
  float giant = 0.6 + 1.9 * t;
  float xb = t < 0.55 ? mix(hot, 7.0, t * 0.3) : giant + (t - 0.55) * 2.0;
  float xf = 2.2 + (t - 0.5) * 3.4;
  return sk_pal(mix(xf, xb, bright));
}

vec3 sk_starLayer(vec3 d, float scale, float density, float bright, float px, float crowd) {
  vec3 p = d * scale;
  vec3 cell = floor(p);
  vec3 h = hash33(cell);
  if (h.x > density * crowd) return vec3(0.0);
  vec3 sp = cell + 0.25 + 0.5 * hash33(cell + 17.3);
  vec3 sd = normalize(sp);
  float c = clamp(dot(sd, d), -1.0, 1.0);
  float ang2 = 2.0 * (1.0 - c);
  float sigma = max(px * 0.55, 0.00008);
  float mag = pow(h.y, 7.0);
  float core = exp(-ang2 / (2.0 * sigma * sigma)) * (px * px) / (sigma * sigma) * 1.3;
  vec3 col = sk_starColor(h.z, smoothstep(0.02, 0.4, mag * bright));
  return col * core * (0.006 + 0.35 * mag) * bright;
}

// Milky Way surface brightness in galactic coordinates (l, b radians), linear, ~1 in the band
vec3 sk_milkyWay(vec3 c, float px) {
  vec3 gY = cross(SK_GN, SK_GC);
  float gz = dot(c, SK_GN);
  float b = asin(clamp(gz, -1.0, 1.0));
  float l = atan(dot(c, gY), dot(c, SK_GC));
  float al = abs(l);
  // the disc: a bright thin layer in a broad glow, both thicker and brighter toward the centre,
  // with the Cygnus and Carina arms seen end-on
  float A = 0.32 + 0.68 * exp(-l * l / 0.8) + 0.3 * exp(-pow((l - 1.34) / 0.3, 2.0)) + 0.3 * exp(-pow((l + 1.3) / 0.28, 2.0));
  float h1 = 0.045 + 0.05 * exp(-l * l / 0.35);
  float h2 = 0.16 + 0.1 * exp(-l * l / 0.5);
  float warp = 0.02 * sin(l * 2.0 + 0.6);                   // the disc's gentle warp
  float bb = b - warp;
  float disc = A * (exp(-bb * bb / (h1 * h1)) * 0.75 + exp(-bb * bb / (h2 * h2)) * 0.35);
  // the bulge, flattened, rising out of the disc round Sagittarius
  float bulge = exp(-(l * l / 0.07 + b * b / 0.03)) * 1.9 + exp(-(l * l / 0.3 + b * b / 0.1)) * 0.5;
  // star clouds: Sagittarius, Scutum, Cygnus, Carina, Norma, Perseus
  float clouds = 0.0;
  clouds += 1.1 * exp(-(pow(l - 0.03, 2.0) + pow(b + 0.07, 2.0) * 2.5) / 0.004);
  clouds += 0.8 * exp(-(pow(l - 0.47, 2.0) + pow(b + 0.03, 2.0) * 3.0) / 0.0025);
  clouds += 0.7 * exp(-(pow(l - 1.33, 2.0) + pow(b - 0.01, 2.0) * 3.0) / 0.006);
  clouds += 0.65 * exp(-(pow(l + 1.28, 2.0) + pow(b + 0.02, 2.0) * 3.0) / 0.004);
  clouds += 0.4 * exp(-(pow(l + 0.55, 2.0) + pow(b + 0.01, 2.0) * 3.0) / 0.006);
  // clumpy texture: star clouds and gaps at several scales, finer grain fading with the pixel
  vec3 q = c * 7.0;
  float n1 = sk_fbm(q, 4);
  float n2 = sk_fbm(c * 26.0 + 4.0, 3);
  float fineK = 1.0 - smoothstep(0.004, 0.012, px);
  float grain = mix(0.5, sk_fbm(c * 110.0 + 9.0, 3), fineK);
  float clump = 0.45 + 0.9 * n1 * (0.7 + 0.6 * n2) + 0.35 * (grain - 0.5);
  float I = (disc * clump + clouds * (0.6 + 0.8 * n2)) + bulge;
  // dust: the Great Rift from Cygnus through Aquila to Ophiuchus, the dark lanes along the
  // midplane everywhere, the Ophiuchus clouds north of the bulge, the Coalsack
  float lane = exp(-pow((bb + 0.005) / (0.018 + 0.02 * exp(-l * l / 0.4)), 2.0));
  float rift = exp(-pow((b - 0.02 - 0.02 * sin(l * 4.0)) / 0.045, 2.0)) * smoothstep(-0.35, -0.1, l) * (1.0 - smoothstep(1.35, 1.6, l));
  float oph = exp(-(pow(l + 0.04, 2.0) / 0.02 + pow(b - 0.14, 2.0) / 0.006));
  float coal = exp(-(pow(l + 1.0, 2.0) + pow(b + 0.017, 2.0)) / 0.0012);
  // (the dust drawn out along the plane: its noise squeezed across it, so the lanes run as
  // filaments rather than a chain of blots)
  vec3 cq = c + SK_GN * gz * 1.1;
  float fil = sk_fbm(cq * 15.0 + 13.0, 4) * 0.65 + mix(0.5, sk_fbm(cq * 52.0 + 3.0, 3), fineK * 0.8 + 0.2) * 0.35;
  float filF = smoothstep(0.3, 0.78, fil);
  float tau = (lane * 0.8 + rift * 1.3 + oph * 1.1) * (0.2 + 1.3 * filF) + coal * 1.8;
  tau *= (1.0 - 0.6 * exp(-pow(al - 3.14159, 2.0) / 0.4));   // little dust toward the anticentre
  float ext = exp(-tau);
  // colour: a pearly blue-white disc, the old bulge a pale gold, dust reddening a little of
  // what it does not hide (kept light: dim warm light reads as brown smoke)
  vec3 col = mix(vec3(0.8, 0.86, 1.0), vec3(1.0, 0.93, 0.83), clamp(exp(-l * l / 0.15) * 0.6 + bulge * 0.35, 0.0, 1.0));
  col = mix(col, col * vec3(1.0, 0.9, 0.8), (1.0 - ext) * ext * 1.2);
  vec3 L = col * I * ext;
  // emission nebulae along the plane (Lagoon, Eta Carinae, North America, Orion) and the
  // faint hydrogen glow of the arms
  float neb = 0.0;
  neb += exp(-(pow(l - 0.105, 2.0) + pow(b + 0.021, 2.0)) / 0.00012);
  neb += exp(-(pow(l + 1.26, 2.0) + pow(b + 0.01, 2.0)) / 0.00025);
  neb += 0.8 * exp(-(pow(l - 1.494, 2.0) + pow(b + 0.012, 2.0)) / 0.0002);
  neb += 0.6 * exp(-(pow(l + 2.63, 2.0) + pow(b + 0.34, 2.0)) / 0.0003);
  float hII = smoothstep(0.62, 0.85, sk_fbm(c * 14.0 + 21.0, 3)) * exp(-bb * bb / 0.004) * A;
  L += vec3(1.0, 0.36, 0.42) * (neb * 0.8 + hII * 0.18) * ext;
  // the Rho Ophiuchi cloud's blue and gold reflection nebulae
  L += vec3(0.5, 0.65, 1.0) * 0.25 * exp(-(pow(l + 0.1, 2.0) + pow(b - 0.29, 2.0)) / 0.0008);
  // a gentle tone curve: the faint arms lifted, the bulge held back
  float li = max(dot(L, vec3(0.3, 0.5, 0.2)), 1e-5);
  return L * pow(li, -0.3) * 1.6;
}

// A galaxy as an inclined exponential disc with a bright core (major axis ax, minor mi, radians)
float sk_galaxy(vec3 c, vec3 pos, vec3 ax, float ra, float rb) {
  vec3 mi = normalize(cross(pos, ax));
  vec3 dv = c - pos;
  float x = dot(dv, ax) / ra, y = dot(dv, mi) / rb;
  float r = sqrt(x * x + y * y);
  return exp(-r * 2.4) + 1.5 * exp(-r * r / 0.006);
}

vec3 sk_extragalactic(vec3 c, float px) {
  vec3 L = vec3(0.0);
  // Andromeda (M31): RA 0h43m, Dec +41.3, 3 x 1 degrees at position angle 38
  {
    vec3 pos = normalize(vec3(0.7303, 0.1377, 0.6596));
    if (dot(c, pos) > 0.995) {
      vec3 E = normalize(cross(vec3(0.0, 0.0, 1.0), pos));
      vec3 N = cross(pos, E);
      vec3 ax = normalize(0.788 * N + 0.616 * E);
      float g = sk_galaxy(c, pos, ax, 0.034, 0.011);
      // its dust lanes, on the near side of the nucleus
      vec3 mi = normalize(cross(pos, ax));
      float y = dot(c - pos, mi) / 0.011;
      float x = dot(c - pos, ax) / 0.034;
      float dl = exp(-pow((y - 0.35 - 0.05 * x) / 0.12, 2.0)) * smoothstep(0.1, 0.4, abs(x)) * exp(-abs(x) * 0.8);
      L += vec3(1.0, 0.9, 0.78) * g * 2.2 * (1.0 - 0.5 * dl);
      // M32 and M110, its companions
      L += vec3(1.0, 0.92, 0.8) * 0.5 * exp(-dot(c - pos - mi * 0.0085 + ax * 0.002, c - pos - mi * 0.0085 + ax * 0.002) / 0.000003);
      L += vec3(1.0, 0.92, 0.8) * 0.25 * exp(-dot(c - pos + mi * 0.02 + ax * 0.004, c - pos + mi * 0.02 + ax * 0.004) / 0.00002);
    }
  }
  // Triangulum (M33): RA 1h34m, Dec +30.7, face-on and faint
  {
    vec3 pos = normalize(vec3(0.7891, 0.3424, 0.5099));
    float r2 = dot(c - pos, c - pos);
    if (r2 < 0.002) L += vec3(0.85, 0.9, 1.0) * 0.18 * exp(-sqrt(r2) / 0.006) * (0.7 + 0.6 * sk_fbm(c * 900.0, 2));
  }
  // the Large Magellanic Cloud (RA 5h23m, Dec -69.8): a bar in a ragged disc, the Tarantula
  {
    vec3 pos = normalize(vec3(0.0547, 0.3416, -0.9383));
    float r2 = dot(c - pos, c - pos);
    if (r2 < 0.06) {
      vec3 E = normalize(cross(vec3(0.0, 0.0, 1.0), pos));
      vec3 N = cross(pos, E);
      vec3 dv = c - pos;
      float x = dot(dv, E), y = dot(dv, N);
      float disc = exp(-sqrt(x * x + y * y * 1.3) / 0.05);
      float bar = exp(-(pow((x * 0.94 + y * 0.34 + 0.01) / 0.045, 2.0) + pow((y * 0.94 - x * 0.34) / 0.016, 2.0)));
      float n = sk_fbm(c * 45.0 + 3.0, 4);
      float I = disc * smoothstep(0.25, 0.75, n) * 2.2 + disc * 0.5 + bar * 1.3;
      L += vec3(0.86, 0.9, 1.0) * I;
      vec3 tar = pos + E * 0.018 + N * 0.012;
      L += vec3(1.0, 0.4, 0.5) * 0.9 * exp(-dot(c - tar, c - tar) / 0.00002);
    }
  }
  // the Small Magellanic Cloud (RA 0h53m, Dec -72.8)
  {
    vec3 pos = normalize(vec3(0.2874, 0.0674, -0.9554));
    float r2 = dot(c - pos, c - pos);
    if (r2 < 0.02) {
      vec3 E = normalize(cross(vec3(0.0, 0.0, 1.0), pos));
      vec3 N = cross(pos, E);
      vec3 dv = c - pos;
      float x = dot(dv, E), y = dot(dv, N);
      float I = exp(-sqrt(pow(x * 0.8 + y * 0.6, 2.0) / 0.0016 + pow(y * 0.8 - x * 0.6, 2.0) / 0.0006) * 2.0);
      L += vec3(0.88, 0.92, 1.0) * I * 1.8 * (0.6 + 0.8 * sk_fbm(c * 70.0 + 8.0, 3));
    }
  }
  return L;
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
    // glints drift slowly along the ring and breathe (no hard on/off)
    float sx = phi * 900.0 + uSwarmT * (1.0 + fk * 0.3);
    float seg = floor(sx);
    float sw = smoothstep(0.0, 0.5, fract(sx)) * smoothstep(1.0, 0.5, fract(sx));
    float spark = pow(hash11(seg + fk * 91.0), 24.0) * 10.0 * sw;
    float body = 0.04 * smoothstep(0.2, 0.9, hash11(floor(phi * 60.0) + fk * 13.0));
    // the far side of each ring is back-lit and dim; the near side catches sunlight
    float face = 0.35 + 0.65 * smoothstep(-0.2, 0.6, dot(normalize(p), -toS / dS));
    acc += line * (body + spark) * face * vec3(1.0, 0.86, 0.62);
  }
  return acc;
}

// the bright planets: points of steady light on the ecliptic with a soft optical halo
vec3 sk_planets(vec3 d, float px) {
  vec3 acc = vec3(0.0);
  float sigma = max(px * 0.6, 0.00008);
  for (int i = 0; i < 7; i++) {
    float c = dot(d, uPlanets[i].xyz);
    if (c < 0.9995) continue;
    float a2 = 2.0 * (1.0 - c);
    float core = exp(-a2 / (2.0 * sigma * sigma)) * (px * px) / (sigma * sigma) * 1.3;
    float halo = exp(-sqrt(a2) / (px * 2.5)) * 0.04;
    acc += uPlanetCol[i] * uPlanets[i].w * (core + halo);
  }
  return acc;
}

vec3 sk_background(vec3 d, float px) {
  // J2000 equatorial: the catalogues' frame (the pole of 5021 lies ~42 degrees round the ecliptic
  // pole from Polaris)
  vec3 c = uSkyPrec * vec3(d.z, d.x, d.y);
  // galactic latitude: the faint stars crowd toward the plane and the bulge
  float gz = dot(c, SK_GN);
  float gcos = dot(c, SK_GC);
  float crowd = 0.45 + 1.3 * exp(-gz * gz / 0.04) + 1.2 * exp(-(gz * gz + pow(1.0 - gcos, 2.0) * 4.0) / 0.05);
  vec3 col = vec3(0.0);
  col += sk_starLayer(c, 170.0, 0.012, 1.0, px, 1.0);
  col += sk_starLayer(c, 380.0, 0.005, 0.3, px, crowd * 0.8);
  col += sk_starLayer(c, 800.0, 0.003, 0.12, px, crowd);
  col += sk_starLayer(c, 1500.0, 0.0022, 0.05, px, crowd * 1.3) * (1.0 - smoothstep(0.0012, 0.003, px));
  col += sk_milkyWay(c, px) * 0.025;
  col += sk_extragalactic(c, px) * 0.04;
  col += sk_planets(d, px);
  // zodiacal light: dust along the ecliptic, brightening and widening toward the Sun, and
  // the faint gegenschein opposite it
  vec3 eclN = normalize(cross(uSkySunDir, vec3(0.0, 0.0, 1.0)));
  float eb = dot(d, eclN);
  float cs = dot(d, uSkySunDir);
  float el = acos(clamp(cs, -1.0, 1.0));
  float wz = 0.1 + 0.3 * exp(-el / 0.5);
  float zod = exp(-eb * eb / (wz * wz)) * (0.08 + 0.3 / max(el * el, 0.06)) + 0.1 * exp(-(pow(3.14159 - el, 2.0) + eb * eb) / 0.02);
  col += vec3(1.0, 0.93, 0.82) * 0.0016 * zod;
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
