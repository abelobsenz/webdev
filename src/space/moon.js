import * as THREE from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/uniforms.js';
import { SNOISE_GLSL } from './glsl.js';
import { createRibbonMaterial, buildRibbonGeometry } from './lines.js';
import { R_MOON } from './sim.js';
import { buildLunarPort, buildLunarRingDistricts } from './lunarPort.js';
import { stationFrame } from './stations.js';
import { addLamps, pixelRadius } from './craftMesh.js';
import { buildLunarServiceCourt } from './interfaces.js';
import { MoonSurface } from './moonSurface.js';
import { buildMediiLanding } from './lunarLanding.js';
import { lunarMesh, LUNAR_FRAME, LK, createLunarMaterial } from './lunarMaterial.js';
import { CB } from '../craft/craftGeometry.js';
import { LunarTraffic } from './lunarTraffic.js';
import { buildMediiWorks } from './lunarWorks.js';
import { LunarOutposts, lampDayGain } from './lunarOutposts.js';
import { LunarHops } from './lunarHops.js';
import { LunarRingTrains, LunarRingHalls } from './lunarRing.js';
import { LunarOrbitals } from './lunarOrbitals.js';

// The terraformed Moon: seas in the old maria, green highlands softened craters,
// polar ice, clouds, city lights, a thin blue atmosphere and an equatorial ring.
// Moon frame: +X faces the Earth (near side), +Y ~ orbit normal.

// Thin atmosphere: analytic glow on a larger shell. Under a sixth of the Earth's gravity the
// air's scale height is ~40 km, so the limb carries a wide, soft blue haze (warm where the
// terminator crosses it, fading into the night), and the disc itself a faint aerial veil that
// thickens toward the edge.
const ATMO_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSunE;
uniform vec3 uCenter;
varying vec3 vWorld;
void main() {
  const float R = ${R_MOON.toFixed(1)};
  const float H = 40.0;
  vec3 ro = cameraPosition - uCenter;
  vec3 rd = normalize(vWorld - cameraPosition);
  float b = dot(ro, rd);
  float disc = b * b - dot(ro, ro) + R * R;
  float tHit = -b - sqrt(max(disc, 0.0));
  float chord = sqrt(6.2831853 * R * H);   // Chapman: grazing column through the shell
  vec3 up;
  float path;
  float rc = length(ro);
  if (rc < R + 229.0) {
    // inside the air (the shell is drawn from within): the column from the eye along the ray,
    // density falling as exp(-h / H). Toward the ground it ends at the surface; toward the sky
    // it is the one-way Chapman column, longest at the horizon, dipping below it from altitude
    vec3 upc = ro / max(rc, 1e-3);
    float muv = dot(upc, rd);
    float dc = exp(-max(rc - R, 0.0) / H);
    float halfC = 0.5 * chord;
    if (disc > 0.0 && tHit > 0.0) {
      up = normalize(ro + rd * tHit);
      path = min(H * (1.0 - dc) / max(-muv, 1e-4), tHit);
    } else {
      float rt = rc * sqrt(max(1.0 - muv * muv, 0.0));
      path = muv >= 0.0 ? dc * min(H / max(muv, 1e-3), halfC) : max(chord * exp(-max(rt - R, 0.0) / H) - halfC * dc, halfC * dc);
      up = upc;
    }
  } else if (disc > 0.0 && tHit > 0.0) {
    // looking down onto the surface: the column above the hit point
    up = normalize(ro + rd * tHit);
    path = min(H / max(dot(up, -rd), 1e-3), chord);
  } else {
    vec3 cp = ro + rd * max(-b, 0.0);
    float r = length(cp);
    up = cp / max(r, 1e-3);
    path = chord * exp(-max(r - R, 0.0) / H);
  }
  float mu = dot(up, uSunDir);
  float lit = smoothstep(-0.3, 0.15, mu);
  float cosT = dot(rd, uSunDir);
  vec3 ray = vec3(0.22, 0.46, 1.0) * (0.75 + 0.25 * cosT * cosT);
  vec3 sunset = vec3(1.0, 0.52, 0.28) * smoothstep(0.3, -0.05, mu) * lit;
  // single scattering saturates along the long grazing paths (a soft shoulder, not a hard rim)
  float pk = 1.0 - exp(-path / 520.0);
  vec3 col = (ray * lit + sunset * 0.8) * pk * uSunE * 0.011;
  col += vec3(1.0, 0.9, 0.8) * pow(max(cosT, 0.0), 12.0) * (path / chord) * uSunE * 0.008 * lit;
  gl_FragColor = vec4(col, 0.0);
}
`;
const ATMO_VERT = /* glsl */ `
varying vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0)); }
`;

const RING_VERT = /* glsl */ `
attribute vec3 aRing;
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vRing = aRing;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
}
`;
const RING_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSunE;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uAxis;          // the Moon's spin axis (the ring's across direction), world
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vN;
${NOISE_GLSL}
#define PI 3.14159265

// a band |x - c| < w, box-filtered over a pixel px: its total is kept as it shrinks below a pixel
float band1(float x, float c, float w, float px) {
  float s = max(w, 0.5 * px);
  return clamp((s - abs(x - c)) / max(px, 1e-6) + 0.5, 0.0, 1.0) * (w / s);
}
// the same band repeated every P, settling to its coverage 2w/P where the period is unresolved
float stripe(float x, float P, float w, float px) {
  float d = abs(fract(x / P + 0.5) - 0.5) * P;
  float s = max(w, 0.5 * px);
  float c = clamp((s - d) / max(px, 1e-6) + 0.5, 0.0, 1.0) * (w / s);
  return mix(c, 2.0 * w / P, smoothstep(0.25, 0.6, px / P));
}

// The deck's plan (km): u along the ring, a across it (|a| < 5.5). Returns the building
// height (km, 0 on open ground) of the terrace blocks lining the local streets, and the
// block's id in blk.
float blockH(float u, float a, out vec2 blk) {
  float s = abs(a);
  float row = step(2.2, s) * step(s, 2.78);
  float P = 0.24;
  float bi = floor(u / P);
  float bf = fract(u / P) * P;
  blk = vec2(bi, sign(a));
  float h = hash12(blk + 3.7);
  // lanes between the blocks, a courtyard light well inside the deeper ones, one plot in
  // eight a pocket square
  float inB = step(0.014, bf) * step(bf, P - 0.014);
  float court = step(0.07, bf) * step(bf, P - 0.07) * step(2.34, s) * step(s, 2.64) * step(0.5, h);
  float sq = step(h, 0.12);
  return row * inB * (1.0 - court) * (1.0 - sq) * (0.018 + 0.05 * hash12(blk + 9.1));
}

// garden tree crowns ~22 m apart in clumps; x: cover (0..1), y: crown shading (lit - shade)
vec2 crowns(vec2 q, float px, float dens, vec2 sunT) {
  float cell = 0.022;
  float res = 1.0 - smoothstep(0.15, 0.45, px / cell);
  if (res <= 0.0) return vec2(dens * 0.55, 0.0);
  vec2 g = q / cell;
  vec2 b = floor(g - 0.5);
  float cov = 0.0, shade = 0.0;
  for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) {
    vec2 c = b + vec2(float(i), float(j));
    vec2 h = hash22(c + 17.0);
    if (h.x > dens) continue;
    vec2 d = g - c - 0.2 - 0.6 * hash22(c + 4.1);
    float r = 0.38 + 0.2 * h.y;
    float x = length(d) / r;
    if (x >= 1.0) continue;
    float dome = sqrt(1.0 - x * x);
    cov = max(cov, smoothstep(0.0, 0.25, dome));
    shade += dot(d / r, sunT) * 0.8 * dome;
  }
  return vec2(mix(dens * 0.55, cov, res), shade * res);
}

void main() {
  // (derivatives first, in uniform control flow)
  float u = vRing.x, v = vRing.y;
  float across = v * 11.0;
  float fu = fwidth(u), fa = fwidth(across);
  float px = max(fu, fa);
  if (fwidth(v) > 0.45) discard;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 p = vWorld - uCenter;
  float rp = length(p);
  // Moon's shadow on the ring
  float b = dot(p, uSunDir);
  float sh = b > 0.0 ? 1.0 : smoothstep(${R_MOON.toFixed(1)} - 20.0, ${R_MOON.toFixed(1)} + 20.0, length(p - uSunDir * b));
  vec3 sunL = uSunE * sh * vec3(1.0, 0.97, 0.93);
  vec3 radial = normalize(p - uAxis * dot(p, uAxis));
  vec3 along = cross(radial, uAxis);
  vec2 sunT = vec2(dot(uSunDir, along), dot(uSunDir, uAxis));
  float sunZ = dot(uSunDir, radial);
  float top = step(0.5, vRing.z);
  float s = abs(across);
  float district = fract(u / 17.32 + 0.5);
  float dU = (district - 0.5) * 17.32;                 // km from the district's centre
  // ---- the deck's plan ----
  // central service boulevard (|a| < 0.9): two carriageways, a planted median, tree lines
  float boul = 1.0 - smoothstep(0.88, 0.9 + px, s);
  float skyl = band1(s, 1.12, 0.21, px);               // the keel galleries' skylights
  float bed = band1(s, 1.7, 0.33, px);                 // the transit bed
  float rowZone = band1(s, 2.49, 0.29, px);            // the terrace street and its blocks
  float garden = band1(s, 3.85, 1.05, px);             // garden terraces
  float yard = band1(s, 5.2, 0.3, px);                 // the shield galleries' service yards
  vec2 blk;
  float hb = blockH(u, across, blk);
  float bldg = step(0.001, hb) * (1.0 - smoothstep(0.35, 0.6, px / 0.24));
  float bldgMean = rowZone * 0.72;
  float bK = mix(bldgMean, bldg, 1.0 - smoothstep(0.35, 0.6, px / 0.24));
  // cross streets every 1.44 km, and the district plaza (1.4 km of paving at the centre)
  float xst = stripe(u, 1.44, 0.018, fu) * (1.0 - boul);
  float plaza = 1.0 - smoothstep(0.62, 0.7, abs(dU));
  // ---- albedo, piece by piece ----
  vec3 pave = vec3(0.3, 0.29, 0.27) * (0.92 + 0.12 * vnoise(vec2(u, across) * 3.0));
  vec3 alb = pave;
  float rough = 0.8, gloss = 0.0;
  // boulevard: dark asphalt carriageways either side of a 60 m planted median, pale kerbs,
  // lane dashes that settle to a faint grey line when unresolved
  float carr = band1(s, 0.46, 0.3, px);
  vec3 asph = vec3(0.07, 0.075, 0.08);
  float dash = stripe(u, 0.012, 0.004, fu) * band1(s, 0.46, 0.0015, fa);
  asph = mix(asph, vec3(0.6, 0.58, 0.5), dash);
  alb = mix(alb, asph, carr * boul);
  float median = band1(s, 0.0, 0.03, px) * boul;
  alb = mix(alb, vec3(0.06, 0.1, 0.04), median);
  // skylights over the keel galleries: dark glazing in 12 m bays on pale mullions
  vec3 glaze = mix(vec3(0.04, 0.06, 0.08), vec3(0.5, 0.5, 0.48), max(stripe(u, 0.012, 0.0012, fu), stripe(s, 0.07, 0.002, fa)));
  alb = mix(alb, glaze, skyl);
  gloss = max(gloss, skyl * 0.6);
  // the transit bed: ballast, sleepers under the rails, a fence line each side
  vec3 ball = vec3(0.12, 0.115, 0.11) * (0.85 + 0.3 * mix(0.5, vnoise(vec2(u * 40.0, across * 40.0)), 1.0 - smoothstep(0.008, 0.025, px)));
  ball = mix(ball, vec3(0.2, 0.18, 0.15), stripe(u, 0.0024, 0.0006, fu) * band1(s, 1.7, 0.06, fa));
  alb = mix(alb, ball, bed);
  alb = mix(alb, vec3(0.45, 0.44, 0.4), band1(s, 1.35, 0.004, fa) + band1(s, 2.05, 0.004, fa));
  // terrace blocks: roofs of terracotta, slate, green roofs and photovoltaics, a parapet line
  float rh = hash12(blk + 1.3);
  vec3 roof = rh < 0.3 ? vec3(0.3, 0.15, 0.1) : (rh < 0.55 ? vec3(0.14, 0.145, 0.16) : (rh < 0.78 ? vec3(0.07, 0.11, 0.045) : vec3(0.03, 0.045, 0.1)));
  roof *= mix(1.0, 0.9 + 0.2 * hash12(floor(vec2(u, across) / 0.03) + 2.0), 1.0 - smoothstep(0.01, 0.03, px));
  alb = mix(alb, mix(pave * 0.9, roof, clamp(bK / max(rowZone, 1e-3), 0.0, 1.0)), rowZone);
  gloss = max(gloss, bK * step(0.78, rh) * 0.4);
  // gardens: lawn and meadow, gravel walks (the long walk at 3 km, cross walks, a diagonal),
  // ponds in some districts, tree clumps; the plaza paved in rings round its fountain
  vec2 q = vec2(u, across);
  float fine = 1.0 - smoothstep(0.008, 0.025, px);
  float lawnN = vnoise(q * 9.0) * 0.6 + mix(0.5, vnoise(q * 41.0), fine) * 0.4;
  vec3 lawn = mix(vec3(0.07, 0.11, 0.045), vec3(0.11, 0.14, 0.06), lawnN);
  float walks = max(band1(s, 3.0, 0.012, fa), stripe(u, 0.36, 0.005, fu));
  float diag = stripe(u + s * sign(dU), 0.72, 0.004, px);
  walks = max(walks, diag * 0.8);
  float clump = smoothstep(0.35, 0.75, vnoise(q * 5.0 + 3.0));
  vec2 tr = crowns(q, px, mix(0.15, 0.9, clump), sunT);
  vec3 trees = vec3(0.035, 0.06, 0.028) * (1.0 + clamp(tr.y, -0.6, 0.6));
  float pondD = length(vec2(dU - 0.0, s - 4.25) / vec2(0.5, 0.22));
  float pond = (1.0 - smoothstep(1.0, 1.0 + px / 0.22, pondD)) * step(0.45, hash12(vec2(floor(u / 17.32 + 0.5), 5.0)));
  vec3 g = mix(lawn, vec3(0.34, 0.31, 0.26), walks);
  g = mix(g, trees, tr.x * (1.0 - walks));
  g = mix(g, vec3(0.012, 0.025, 0.03), pond);
  gloss = max(gloss, pond * garden);
  float ringsP = stripe(length(vec2(dU, s - 3.5)), 0.06, 0.006, px);
  vec3 plazaC = mix(vec3(0.42, 0.4, 0.36), vec3(0.3, 0.28, 0.25), ringsP);
  g = mix(g, plazaC, plaza * (1.0 - smoothstep(0.25, 0.3, abs(s - 3.5))));
  alb = mix(alb, g, garden);
  // service yards at the shields: hull plating in 50 m panels, a hazard margin
  vec3 plate = vec3(0.34, 0.345, 0.35) * mix(1.0, 0.9 + 0.12 * hash12(floor(q / 0.05)), 1.0 - smoothstep(0.02, 0.05, px));
  plate *= 1.0 - 0.25 * max(stripe(u, 0.05, 0.0006, fu), stripe(s, 0.05, 0.0006, fa));
  plate = mix(plate, vec3(0.6, 0.45, 0.08), band1(s, 4.93, 0.008, fa));
  alb = mix(alb, plate, yard);
  // cross streets cut every band but the transit bed
  alb = mix(alb, vec3(0.1, 0.1, 0.105), xst * (1.0 - bed) * (1.0 - skyl));
  // building shadows on the street and the gardens: the terrace blocks are 20-70 m tall; a
  // point is shaded when the block toward the Sun is taller than the Sun's ray over it
  float shadow = 0.0;
  if (sunZ > 0.02 && top > 0.5) {
    vec2 blk2;
    float hs = 0.04;
    vec2 off = sunT / max(sunZ, 0.12) * hs;
    float h2 = blockH(u + off.x, across + off.y, blk2);
    shadow = step(hs * 0.6, h2) * (1.0 - step(0.001, hb)) * (1.0 - smoothstep(0.3, 0.6, px / 0.24));
  }
  alb = mix(vec3(0.28, 0.29, 0.3) * (0.9 + 0.1 * stripe(u, 0.05, 0.002, fu)), alb, top);
  // ---- light ----
  // relief: the block roofs and the tree crowns tilt the normal a little toward the Sun's side
  vec3 Nt = N;
  float ndl = max(dot(Nt, uSunDir), 0.0);
  float treeLit = 1.0 + clamp(tr.y, -0.8, 0.8) * garden * top;
  // moonshine on the underside and sides: the lit Moon fills 67 % of the view below
  float mu = dot(radial, uSunDir);
  float Fm = ${(R_MOON * R_MOON).toFixed(1)} / max(rp * rp, 1.0);
  vec3 moonL = uSunE * vec3(0.105, 0.13, 0.115) * Fm * clamp(mu + 0.3 * (1.0 - Fm), 0.0, 1.0) * clamp(0.5 - 0.5 * dot(N, radial), 0.0, 1.0);
  vec3 col = alb / PI * (sunL * ndl * (1.0 - 0.75 * shadow) * treeLit + moonL);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(V + uSunDir);
  float spec = pow(max(dot(N, H), 0.0), mix(55.0, 400.0, gloss)) * mix(0.045, 1.2, gloss);
  col += sunL * spec * (1.0 - shadow) * max(sign(ndl), 0.0);
  // ---- lights by night (bounded; narrow lights settle to their coverage when unresolved) ----
  float night = 1.0 - smoothstep(0.0, 0.25, sh * max(mu + 0.1, 0.0) * 4.0);
  float rl = (s - 1.7) / max(0.028, px * 0.7);
  float railLamp = exp(-rl * rl) * min(1.0, 0.028 / max(px, 0.028));
  // street lamps every 30 m along the boulevard kerbs and the terrace streets
  float lampsL = (band1(s, 0.78, 0.003, fa) + band1(s, 2.2, 0.003, fa) + band1(s, 2.8, 0.003, fa)) * stripe(u, 0.03, 0.002, fu) / 0.133;
  // windows: rows of lit rooms on the terrace blocks' street faces (seen as a glow over the
  // block's roof edge from above), more in the evening districts
  float winK = bK * (0.25 + 0.75 * step(0.35, hash12(blk + 7.7))) * stripe(u, 0.008, 0.0025, fu) / 0.625;
  float plazaGlow = plaza * garden * (1.0 - smoothstep(0.25, 0.3, abs(s - 3.5))) * 0.4;
  float skyGlow = skyl * (0.3 + 0.7 * stripe(u, 0.012, 0.004, fu) / 0.667);
  vec3 lightsC = vec3(1.0, 0.7, 0.4) * (lampsL * 0.5 + plazaGlow * 0.12 + walks * garden * 0.05) + vec3(1.0, 0.8, 0.55) * (winK * 0.09 + skyGlow * 0.08) + vec3(0.45, 0.8, 1.0) * railLamp * 0.34;
  col += top * (lightsC * (0.2 + 0.8 * night) + alb * 0.02);
  // the underside, as the Moon sees it: the keel galleries' window bands 1.1 km either side of
  // the centreline (lit bays every 12 m where they resolve), and red obstruction lamps every
  // 2 km along the centre, flashing in a wave that runs round the ring once a minute
  float under = 1.0 - top;
  float kd = (s - 1.1) / max(0.04, px * 0.7);
  float keel = exp(-kd * kd) * min(1.0, 0.04 / max(px, 0.04));
  float bays = mix(0.55, step(0.45, fract(u / 0.012)), 1.0 - smoothstep(0.004, 0.012, px));
  float dl = (fract(u / 2.0 + 0.5) - 0.5) * 2.0;
  float ls = max(0.03, px * 0.7);
  float obst = exp(-(dl * dl + across * across) / (ls * ls)) * (0.03 / ls) * (0.03 / ls);
  float wave = step(0.6, 0.5 + 0.5 * sin(uTime * 6.2832 / 60.0 * 40.0 - u * 0.0189));
  col += under * (vec3(1.0, 0.8, 0.55) * keel * bays * 0.12 + vec3(1.0, 0.16, 0.06) * obst * wave * 1.4);
  gl_FragColor = vec4(col, 1.0);
}
`;
// The Lift's tether from Medii Landing up to the Exchange: a round cable in sunlight (cut by
// the Moon's shadow), a faint power sheath and marker lights every 20 km
const LIFT_FRAG = /* glsl */ `
uniform vec3 uCenter;
float aaBand(float x, float P, float w) {
  float d = abs(fract(x / P + 0.5) - 0.5) * P;
  float fw = max(fwidth(x), 1e-5);
  float W = max(w, fw);
  return clamp(1.0 - d / W, 0.0, 1.0) * min(1.0, w / fw);
}
void main() {
  vec3 p = vWorld - uCenter;
  float b = dot(p, uSunDir);
  float sh = b > 0.0 ? 1.0 : smoothstep(${(R_MOON - 5).toFixed(1)}, ${(R_MOON + 5).toFixed(1)}, length(p - uSunDir * b));
  float x = clamp(vAcross, -1.0, 1.0);
  float cyl = sqrt(max(1.0 - x * x, 0.0));
  vec3 col = vec3(0.62, 0.6, 0.56) * uSunE * sh * (0.03 + 0.05 * cyl) + vec3(0.03, 0.045, 0.07) * (0.4 + 0.6 * cyl);
  float alt = vData.x;
  col += vec3(1.0, 0.72, 0.4) * aaBand(alt, 20.0, 0.05) * 1.4;
  float pp = fract(alt / 60.0 - uTime * 0.05) - 0.5;
  float fa = max(fwidth(alt), 1e-3);
  col += vec3(0.45, 0.75, 1.0) * mix(0.06, exp(-pp * pp * 400.0) * 0.5, 1.0 - smoothstep(0.6, 3.0, fa));
  gl_FragColor = vec4(col * vCoverage, 0.0);
}
`;
const FAR_FRAG = /* glsl */ `
uniform vec3 uCenter;
void main() {
  vec3 p = vWorld - uCenter;
  float b = dot(p, uSunDir);
  float sh = b > 0.0 ? 1.0 : smoothstep(${(R_MOON - 20).toFixed(1)}, ${(R_MOON + 20).toFixed(1)}, length(p - uSunDir * b));
  vec3 col = vec3(0.42) * 0.3 * uSunE * sh * 0.5 + vec3(0.8, 0.88, 1.0) * (0.04 + 0.12 * (1.0 - sh));
  float fade = 1.0 - smoothstep(1.6, 3.2, vPx);
  gl_FragColor = vec4(col * vCoverage * fade, 0.0);
}
`;

export function buildBand(R, w, segs) {
  const pos = [], nor = [], ring = [], idx = [];
  const prof = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8 - 0.5; prof.push([t * w, 0, 0, 1, t]); }
  prof.push([w*.5,-.28,1,0,.5]);
  for(let i=7;i>=0;i--) {const t=i/8-.5;prof.push([t*w,-.28,0,-1,t]);}
  prof.push([-w*.5,0,-1,0,-.5]);
  const M = prof.length;
  for (let j = 0; j <= segs; j++) {
    const th = (j / segs) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    for (const [ax, dr, na, nr, v] of prof) {
      pos.push(c * (R + dr), ax, s * (R + dr));
      nor.push(c*nr, na, s*nr);
      ring.push(th * R, v, nr === 1 ? 1 : 0);
    }
  }
  for (let j = 0; j < segs; j++) for (let i = 0; i < M - 1; i++) {
    const a = j * M + i, b = a + M;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 3));
  g.setIndex(idx);
  return g;
}

const _lp = new THREE.Vector3();
const _lq = new THREE.Quaternion();
const _sunSite = new THREE.Vector3();
const _sunM = new THREE.Vector3();

export class Moon {
  constructor(space) {
    this.space = space;
    this.group = new THREE.Group();
    this.uniforms = { uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunE: U.uSunIlluminance, uTime: { value: 0 } };
    // the ground: ray-traced on a proxy sphere (moonSurface.js); the Node verifiers build the Moon
    // without a renderer, and get its structures without the baked ground
    this.surface = space.renderer ? new MoonSurface(space) : null;
    this.mesh = this.surface ? this.surface.mesh : new THREE.Group();
    this.group.add(this.mesh);
    this.atmoU = { uSunDir: this.uniforms.uSunDir, uSunE: U.uSunIlluminance, uCenter: { value: new THREE.Vector3() } };
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(R_MOON + 230, 128, 64), new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, uniforms: this.atmoU,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
    }));
    this.atmo.renderOrder = 6;
    this.group.add(this.atmo);
    // equatorial ring (Moon frame XZ plane)
    this.ringU = { uSunDir: this.uniforms.uSunDir, uSunE: U.uSunIlluminance, uTime: this.uniforms.uTime, uCenter: this.atmoU.uCenter, uAxis: { value: new THREE.Vector3(0, 1, 0) } };
    this.ring = new THREE.Mesh(buildBand(R_MOON + 380, 11, 1800), new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, uniforms: this.ringU, side: THREE.DoubleSide }));
    this.ring.renderOrder = 3;
    this.group.add(this.ring);
    const pts = [], along = [];
    for (let k = 0; k <= 720; k++) { const th = (k / 720) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(th) * (R_MOON + 380), 0, Math.sin(th) * (R_MOON + 380))); along.push(th); }
    this.farMat = createRibbonMaterial({ widthKm: 11, minPx: 1.0, frag: FAR_FRAG, uniforms: { uCenter: this.atmoU.uCenter } });
    this.far = new THREE.Mesh(buildRibbonGeometry([{ pts, along, id: 0 }]), this.farMat);
    this.far.renderOrder = 11;
    this.group.add(this.far);
    this.districtData=buildLunarRingDistricts();
    const districtMat=createLunarMaterial({accent:[.7,.85,1],lit:.5,side:THREE.DoubleSide});
    this.districts=lunarMesh(this.districtData.geo,{},districtMat);
    addLamps(this.districts,this.districtData.lamps,{minPx:1.1});   // lit halls, parapets and rails (src/space/lunarPort.js)
    this.group.add(this.districts);
    this.port = new THREE.Group();
    this.port.name='Tranquillity Exchange';
    this.port.position.set(R_MOON+380,0,0);
    stationFrame(new THREE.Vector3(1,0,0),this.port.quaternion);
    this.portData=buildLunarPort();
    // lunar material: sunlight stops at the Moon's horizon, the full Earth lights its nights
    const portMesh=lunarMesh(this.portData.geo,{accent:[.7,.85,1],lit:.6,side:THREE.DoubleSide});
    portMesh.name='Tranquillity terminal and receiving courts';
    addLamps(portMesh,this.portData.lamps,{minPx:1.2});
    this.port.add(portMesh);
    this.group.add(this.port);
    this.courtData=buildLunarServiceCourt();
    this.court=lunarMesh(this.courtData.geo,{accent:[.7,.85,1],lit:.6,side:THREE.DoubleSide});
    const courtAngle=8.35/(R_MOON+380),courtUp=new THREE.Vector3(Math.cos(courtAngle),0,Math.sin(courtAngle));
    this.court.position.copy(courtUp).multiplyScalar(R_MOON+380).setY(2.75);
    stationFrame(courtUp,this.court.quaternion);
    addLamps(this.court,this.courtData.lamps,{minPx:.65});
    this.group.add(this.court);
    // Medii Landing on the shore below the Exchange, and the Lift's tether between them
    this.landing = new THREE.Group();
    this.landing.name = 'Medii Landing';
    this.landing.position.set(R_MOON, 0, 0);
    stationFrame(new THREE.Vector3(1, 0, 0), this.landing.quaternion);
    this.landingData = buildMediiLanding();
    this.landingMesh = lunarMesh(this.landingData.geo, { lit: 0.6 });
    this.landingMesh.name = 'Medii Landing town, harbour, landing fields and mass driver';
    this.landingLamps = addLamps(this.landingMesh, this.landingData.lamps, { minPx: 1.0 });
    this.landing.add(this.landingMesh);
    {
      const top = this.landingData.liftTop.clone().multiplyScalar(0.001);
      const end = 380 - 0.9;
      const pts = [], along = [];
      for (let k = 0; k <= 96; k++) { const t = k / 96; const y = top.y + (end - top.y) * t * t; pts.push(new THREE.Vector3(top.x, y, top.z)); along.push(y); }
      this.liftMat = createRibbonMaterial({ widthKm: 0.006, minPx: 1.1, frag: LIFT_FRAG, uniforms: { uCenter: this.atmoU.uCenter } });
      this.lift = new THREE.Mesh(buildRibbonGeometry([{ pts, along, id: 0 }]), this.liftMat);
      this.lift.renderOrder = 12;
      this.landing.add(this.lift);
      // the collar that takes the tether under the Exchange's hub
      const C = new CB();
      C.at(0, -900, 0); C.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      C.lathe([[75, 3, 8], [75, -14, 8], [48, -40, 1], [20, -66, 8], [9, -74, 8], [0, -76, 8]], 32);
      C.pop(); C.pop();
      this.collar = lunarMesh(C.geometry(), { lit: 0.4 });
      this.port.add(this.collar);
      // lift cars riding the tether: six capsules with a lit band and glazed saloons, climbing
      // steadily (each enters the Exchange's collar as the next leaves the Crown)
      const K = new CB();
      K.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      K.lathe([[0, -16, LK.BRONZE], [4.2, -15, LK.HULL], [7, -11, LK.HULL], [7.2, -5, LK.GLASS], [7.2, 5, LK.GLASS], [7, 11, LK.HULL], [4.2, 15, LK.HULL], [0, 16, LK.BRONZE]], 16);
      K.lathe([[7.7, -0.7, LK.LANTERN], [7.7, 0.7, LK.LANTERN]], 16);
      K.lathe([[7.5, -12.2, LK.BRONZE], [7.5, -11.2, LK.BRONZE]], 16);
      K.lathe([[7.5, 11.2, LK.BRONZE], [7.5, 12.2, LK.BRONZE]], 16);
      K.pop();
      const carMat = createLunarMaterial({ lit: 0.85 });
      const carGeo = K.geometry();
      this.cars = [];
      this.carSpan = [top.y + 0.035, end - 0.06];
      this.carXZ = [top.x, top.z];
      for (let i = 0; i < 6; i++) {
        const m = lunarMesh(carGeo, {}, carMat);
        m.name = 'Lift car';
        this.landing.add(m);
        this.cars.push(m);
      }
    }
    this.group.add(this.landing);
    this.group.traverse((o) => { o.frustumCulled = false; });
    // the Works and the town's life (lunarTraffic.js) are built on first approach, the other
    // settlements (lunarOutposts.js) one at a time as the camera nears each
    this.life = null;
    this.outposts = new LunarOutposts(this.group);
    this.ringTrains = new LunarRingTrains(this.group);
    this.ringHalls = new LunarRingHalls(this.group, this.districtData, districtMat);   // the halls: far forms all round, full halls near (lunarRing.js)   // expresses on the ring's transit rails (lunarRing.js)
    this.hops = new LunarHops(this.group);           // hoppers between Medii and the outposts (lunarHops.js)
    this.orbitals = new LunarOrbitals(this.group);    // Endymion Wheel, Aitken Depot, relays and ferries in lunar orbit (lunarOrbitals.js)
  }

  /** Build Medii Works and the Landing's traffic now (normally done on approach). */
  ensureLife() {
    if (this.life) return this.life;
    this.life = new LunarTraffic(this.landingData, { works: this._works || null });
    this.landing.add(this.life.group);
    return this.life;
  }

  setSize(w, h) { this.farMat.uniforms.uResolution.value.set(w, h); this.liftMat.uniforms.uResolution.value.set(w, h); }

  exposureHint(cam, space) {
    const rel = space.sim.moonPos.clone().sub(cam.position);
    const d = rel.length();
    const ang = Math.asin(Math.min(1, R_MOON / d));
    const fov = THREE.MathUtils.degToRad(cam.fov) * 0.5;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const off = Math.acos(THREE.MathUtils.clamp(rel.dot(fwd) / d, -1, 1));
    if (off > ang + fov * 1.4) return 0;
    const cover = Math.min(1, (ang * ang) / (fov * fov * 1.6));
    const phase = 0.5 + 0.5 * space.sim.sunDir.dot(rel.clone().normalize().negate());
    return cover * phase * 1.2;
  }

  // Down among the sunlit terraces of Medii Landing the eye stops down a further ~0.8 EV: pale
  // stone and paving fill the view there, not the dark-and-bright mix of a whole planet.
  exposureScale(cam, space) {
    if (!this.landing || !this.landingData) return 1;
    this.landing.getWorldPosition(_lp);
    const d = _lp.distanceTo(cam.position);
    if (d > 80) return 1;
    const mu = _lp.sub(space.sim.moonPos).normalize().dot(space.sim.sunDir);
    const near = 1 - THREE.MathUtils.smoothstep(d, 8, 80);
    const sunUp = THREE.MathUtils.smoothstep(mu, 0.02, 0.2);
    return 1 - 0.42 * near * sunUp;
  }

  update(sim, realTime) {
    this.group.position.copy(sim.moonPos);
    this.group.quaternion.copy(sim.moonQuat);
    this.group.updateMatrixWorld(true);
    const u = this.uniforms;
    u.uSunDir.value.copy(sim.sunDir);
    u.uTime.value = realTime;
    if (this.surface) this.surface.update(sim, realTime);
    LUNAR_FRAME.sunDir.copy(sim.sunDir);
    LUNAR_FRAME.moonPos.copy(sim.moonPos);
    LUNAR_FRAME.time = realTime;
    if (this.surface) LUNAR_FRAME.earthLit.value = this.surface.uniforms.uEarthLit.value;
    const lu = this.liftMat.uniforms;
    lu.uSunDir.value.copy(sim.sunDir);
    lu.uTime.value = realTime;
    if (this.space.camera) {
      const cam = this.space.camera;
      this.landing.getWorldPosition(_lp);
      this.landingMesh.visible = pixelRadius(cam, _lp, this.landingData.radius, this.space.size.y) > 1.5;
      // the lift cars climb at ~0.4 km/s, a quarter of an hour from the Crown to the Exchange
      const [y0, y1] = this.carSpan;
      for (let i = 0; i < this.cars.length; i++) {
        const car = this.cars[i];
        const f = ((i / this.cars.length + realTime / 900) % 1 + 1) % 1;
        car.position.set(this.carXZ[0], y0 + (y1 - y0) * f, this.carXZ[1]);
        car.updateMatrixWorld();
        car.getWorldPosition(_lp);
        car.visible = pixelRadius(cam, _lp, 0.016, this.space.size.y) > 0.6;
      }
    }
    if (this.space.camera) {
      const cam = this.space.camera.position;
      this.landing.getWorldPosition(_lp);
      // (built over two frames on approach: the Works' geometry, then the traffic that uses it)
      if (!this.life && _lp.distanceTo(cam) < 2500) {
        if (!this._works) this._works = buildMediiWorks(this.landingData.plan, this.landingData.driver, this.landingData.S.PADS);
        else this.ensureLife();
      }
      if (this.life) {
        this.landing.getWorldQuaternion(_lq).invert();
        _sunSite.copy(sim.sunDir).applyQuaternion(_lq);
        this.life.update(realTime, cam, this.landing, _sunSite);
      }
      _sunM.copy(sim.sunDir).applyQuaternion(_lq.copy(sim.moonQuat).invert());
      // lamps by day: the Landing's streets dark, its beacons and quays dimmed (the Landing
      // stands at the Moon frame's +X)
      const muL = _sunM.x;
      if (this.landingLamps) this.landingLamps.material.uniforms.uGain.value = lampDayGain(muL, 0.3);
      if (this.life) {
        if (this.life.streetLamps) this.life.streetLamps.material.uniforms.uGain.value = lampDayGain(muL, 0.06);
        // (the Works' lamp set, found once)
        if (this._worksLamps === undefined) this._worksLamps = (this.life.worksMesh && this.life.worksMesh.children.find((c) => c.material && c.material.uniforms && c.material.uniforms.uGain)) || null;
        if (this._worksLamps) this._worksLamps.material.uniforms.uGain.value = lampDayGain(muL, 0.45);
      }
      this.outposts.sunM.copy(_sunM);
      this.outposts.update(realTime, cam, this.space.camera, this.space.size.y);
      this.hops.update(realTime);
      this.ringTrains.update(realTime, cam);
      this.ringHalls.update(cam);
      this.orbitals.update(realTime, _sunM, cam, this.space.camera, this.space.size.y);
    }
    this.atmoU.uCenter.value.copy(sim.moonPos);
    this.ringU.uAxis.value.set(0, 1, 0).applyQuaternion(sim.moonQuat);
    // the air shell is seen from within below 229 km: draw its inner face then (the sky over the
    // Landing and the haze toward every horizon), its outer face from space
    if (this.space.camera) this.atmo.material.side = this.space.camera.position.distanceTo(sim.moonPos) < R_MOON + 229 ? THREE.BackSide : THREE.FrontSide;
    const fu = this.farMat.uniforms;
    fu.uSunDir.value.copy(sim.sunDir);
    fu.uBandAxis.value.set(0, 1, 0).applyQuaternion(sim.moonQuat);
    if(this.space.camera)this.court.visible=pixelRadius(this.space.camera,this.court.getWorldPosition(new THREE.Vector3()),this.courtData.radius,this.space.size.y)>3;
  }
}
