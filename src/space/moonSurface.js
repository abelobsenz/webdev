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
uniform vec4 uTown[${ALL_TOWNS.length}];
uniform vec4 uArcA[${ARCS.length}];
uniform vec4 uArcB[${ARCS.length}];
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
    float gx = (x - 1.0) * 4.5;
    float g = exp(-gx * gx);
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
    float th = atan(q.y, q.x);
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
      float plots = litLine(dn, 0.35, fp) * step(0.55, hash12(vec2(floor(s / 0.6), float(i) + 0.5 * sign(dot(up, n)))));
      float vc = (floor(s / 28.0) + 0.5) * 28.0;
      float hv = hash12(vec2(floor(s / 28.0), float(i) * 3.1));
      float ds = s - vc - (hv - 0.5) * 10.0;
      float vil = exp(-(ds * ds + dn * dn) / 1.6) * step(0.35, hv) * ends;
      c.land += vec3(1.0, 0.6, 0.28) * line * lamps * 1.6 + vec3(1.0, 0.72, 0.45) * (plots * 0.5 + vil * 0.9) * ends;
      c.road = max(c.road, line);
    } else {
      // a rail corridor: cool white line lighting, a station every 45 km, and the trains,
      // 400 m of lit carriages at 140 m/s each way, a train every 36 km
      float st = s - (floor(s / 45.0) + 0.5) * 45.0;
      float sta = exp(-(st * st + dn * dn) / 0.36);
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
    float wk = 0.0;                                 // Medii Works' worked ground (0..1)
    if (nearSite > 0.0) {
      float bd = bayDist(loc.xz);
      float aa = max(fp * 0.7, 0.001);
      waterF = mix(waterF, smoothstep(-aa, aa, bd), nearSite);
      float hs = bd > 0.0 ? -min(0.3, 0.0015 + bd * 0.03) : 0.012 + 0.004 * min(-bd, 8.0);
      h = mix(h, hs, nearSite);
      bed = mix(bed, mix(vec3(0.3, 0.27, 0.2), vec3(0.05, 0.06, 0.05), smoothstep(0.005, 0.12, -hs)), nearSite);
      vec3 fa = farmland(loc.xz, alb, fp);
      alb = mix(alb, fa, (1.0 - smoothstep(9.0, 18.0, siteD)) * smoothstep(2.6, 4.0, siteD));
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
        vec3 reg = mix(vec3(0.19, 0.18, 0.165), vec3(0.3, 0.285, 0.26), gn);
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
    vec3 earth = uSunE * vec3(0.55, 0.7, 1.0) * 2.4e-3 * uEarthLit * smoothstep(-0.02, 0.2, eEl);
    vec3 V = -rd;
    vec3 landCol = vec3(0.0), seaCol = vec3(0.0);
    if (waterF < 0.999) {
      // relief: baked normals (exaggerated a little) plus finer craters when close
      float nu = max(dot(nB, up), 0.2);
      vec3 grad = (nB - up * dot(nB, up)) / nu;
      float quiet = smoothstep(9.0, 26.0, acos(clamp(dot(up, SITE_UP), -1.0, 1.0)) * RM);
      if (fp < 2.0) grad -= craterDetail(up, RM / 5.0, fp / 5.0, quiet, 0.0) * 0.55;
      if (fp < 0.6) grad -= craterDetail(up, RM / 1.4, fp / 1.4, quiet, 37.0) * 0.5;
      // a third octave of small fresh craters (tens of metres) for the ground a lander sees,
      // on the worked ground of the Works too
      if (fp < 0.08) grad -= craterDetail(up, RM / 0.25, fp / 0.25, max(quiet, wk * 0.7), 71.0) * 0.42;
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
      uTown: { value: townUniforms() },
      uArcA: { value: arcUniforms().A }, uArcB: { value: arcUniforms().B },
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
