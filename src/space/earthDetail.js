import * as THREE from 'three';
import { SEA_LANES, ARCOLOGIES } from './earthData.js';
import { bodyDir } from './sim.js';
import { MAG_POLE_LAT, MAG_POLE_LON } from './aurora.js';

// Detail the orbital Earth draws on top of its bakes, each scale resolved only while it spans a
// few pixels and otherwise replaced by its mean (so nothing sparkles as the planet turns):
//   - ships on the sea lanes of the Concord, moving on the sim clock: the white water at the bow,
//     the Kelvin wake's two arms (rougher water, bright off the glint's core) and the long
//     turbulent wake (a calm slick streak through the glint), their lights at night
//   - the sea's own texture in the sunglint: mesoscale eddies and the fronts between them, slicks
//     drawn out along the currents, internal-wave packets running in from the shelf breaks
//   - lightning in deep convection: cells that flash every few seconds to a minute in bursts of
//     return strokes, lighting the cloud from within over ten kilometres or so
//   - the arcologies: pale platforms with their rings and spokes by day, the brightest lights of
//     their regions at night
//   - noctilucent clouds: ice at the summer mesopause over the high north, lit long after dusk

export const SHIP_V = 0.012;          // km/s (~23 knots)
export const SHIP_SPACING = 70;       // km between ship slots on each side of a lane
export const SHIP_PERIOD = SHIP_SPACING / SHIP_V;
export const LANE_WINDOW = 30;        // km: the bake marks a lane this far either side
export const TRAIN_V = 0.15;          // km/s (540 km/h)
export const TRAIN_SPACING = 45;      // km between train slots on each track
export const TRAIN_PERIOD = TRAIN_SPACING / TRAIN_V;
export const MAX_LANE_LEGS = 64;
const D2R = Math.PI / 180;

/** The lanes as great-circle legs: [{ a, b (body-frame unit vectors), occ (slot occupancy), len (rad) }]. */
export function laneLegs() {
  const legs = [];
  for (const L of SEA_LANES) {
    for (let i = 0; i < L.pts.length - 1; i++) {
      const a = bodyDir(L.pts[i][0] * D2R, L.pts[i][1] * D2R, new THREE.Vector3());
      const b = bodyDir(L.pts[i + 1][0] * D2R, L.pts[i + 1][1] * D2R, new THREE.Vector3());
      legs.push({ a, b, occ: Math.min(0.95, 0.35 + 0.5 * L.w), len: Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) });
    }
  }
  return legs.slice(0, MAX_LANE_LEGS);
}

/** Lane legs as a float texture (row 0: A.xyz, occupancy; row 1: B.xyz, length in radians). */
export function buildLaneTexture(legs = laneLegs()) {
  const W = Math.max(legs.length, 1);
  const data = new Float32Array(W * 2 * 4);
  legs.forEach((l, i) => {
    data.set([l.a.x, l.a.y, l.a.z, l.occ], i * 4);
    data.set([l.b.x, l.b.y, l.b.z, l.len], (W + i) * 4);
  });
  const tex = new THREE.DataTexture(data, W, 2, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { tex, count: legs.length };
}

/** Arcology uniforms: centre (body frame) + radius km; kind, seed, 0, 0. */
export function arcologyUniforms() {
  return {
    pos: ARCOLOGIES.map(([la, lo, r]) => { const v = bodyDir(la * D2R, lo * D2R, new THREE.Vector3()); return new THREE.Vector4(v.x, v.y, v.z, r); }),
    kind: ARCOLOGIES.map(([, , , k], i) => new THREE.Vector4(k, (i * 0.618034) % 1, 0, 0)),
  };
}

/** The ship clock: time within one slot period and the periods elapsed (so a wrap never reshuffles a slot). */
export function shipClock(t, out = { t: 0, wrap: 0 }) {
  const w = Math.floor(t / SHIP_PERIOD);
  out.t = t - w * SHIP_PERIOD;
  out.wrap = ((w % 4096) + 4096) % 4096;
  return out;
}

/** Maglev corridors as a float texture (row 0: normal; row 1: A, traffic; row 2: B). */
export function buildArcTexture(arcs) {
  const W = Math.max(arcs.length, 1);
  const data = new Float32Array(W * 3 * 4);
  arcs.forEach((a, i) => {
    data.set([a.n.x, a.n.y, a.n.z, a.w], i * 4);
    data.set([a.a.x, a.a.y, a.a.z, a.s], (W + i) * 4);
    data.set([a.b.x, a.b.y, a.b.z, 0], (2 * W + i) * 4);
  });
  const tex = new THREE.DataTexture(data, W, 3, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { tex, count: arcs.length };
}

/** The train clock (as the ship clock: wrapped per slot period so a slot never reshuffles). */
export function trainClock(t, out = { t: 0, wrap: 0 }) {
  const w = Math.floor(t / TRAIN_PERIOD);
  out.t = t - w * TRAIN_PERIOD;
  out.wrap = ((w % 4096) + 4096) % 4096;
  return out;
}

/** Bake GLSL: the index + 1 of the nearest lane leg within LANE_WINDOW km of d, else 0. */
export const LANE_BAKE_GLSL = /* glsl */ `
uniform sampler2D uLanes;
uniform int uNumLane;
float nearestLane(vec3 d) {
  float best = ${LANE_WINDOW.toFixed(1)}, id = 0.0;
  for (int i = 0; i < ${MAX_LANE_LEGS}; i++) {
    if (i >= uNumLane) break;
    vec4 A = texelFetch(uLanes, ivec2(i, 0), 0);
    vec4 B = texelFetch(uLanes, ivec2(i, 1), 0);
    vec3 N = normalize(cross(A.xyz, B.xyz));
    float off = abs(dot(d, N)) * 6371.0;
    if (off >= best) continue;
    vec3 pp = normalize(d - N * dot(d, N));
    float along = atan(dot(cross(A.xyz, pp), N), dot(A.xyz, pp));
    if (along < -0.004 || along > B.w + 0.004) continue;
    best = off;
    id = float(i + 1);
  }
  return id;
}
`;

export const EARTH_DETAIL_GLSL = /* glsl */ `
uniform sampler2D uLaneTex;
uniform samplerCube uIds;      // r: sea-lane leg + 1, g: maglev corridor + 1 (nearest-filtered)
uniform sampler2D uArcTex;     // maglev corridors: row 0 normal, row 1 A (+ traffic), row 2 B
uniform float uTrainT;
uniform float uTrainWrap;
uniform float uShipT;
uniform float uShipWrap;
uniform vec4 uArco[${ARCOLOGIES.length}];
uniform vec4 uArcoK[${ARCOLOGIES.length}];
uniform float uNlcGain;
uniform float uAuroraAct;
const vec3 MAG_POLE = vec3(${bodyDir(MAG_POLE_LAT, MAG_POLE_LON, new THREE.Vector3()).toArray().map((v) => v.toFixed(5)).join(', ')});
const vec3 KILAUEA = vec3(${bodyDir(19.41 * D2R, -155.28 * D2R, new THREE.Vector3()).toArray().map((v) => v.toFixed(6)).join(', ')});
vec4 weatherAt(vec3 b, float fp);      // (earth.js: the baked weather, drifted)
const float SHIP_V = ${SHIP_V.toFixed(4)};
const float SHIP_SP = ${SHIP_SPACING.toFixed(1)};
const float TRAIN_V = ${TRAIN_V.toFixed(3)};
const float TRAIN_SP = ${TRAIN_SPACING.toFixed(1)};

// An elongated light or mark (sx, sy km) drawn no smaller than the pixel: its peak falls as its
// drawn area grows, so what it adds to a pixel is kept as it shrinks below one.
float od_blob(float x, float y, float sx, float sy, float fp) {
  float X = max(sx, fp * 0.6), Y = max(sy, fp * 0.6);
  return exp(-(x * x) / (X * X) - (y * y) / (Y * Y)) * (sx * sy) / (X * Y);
}
float od_line(float dist, float w, float fp) {
  float W = max(w, fp * 0.6);
  return exp(-dist * dist / (W * W)) * w / W;
}

// Ships on the lane leg the bake found near b (laneA: the id cube's red, an exact integer
// where a lane is near). rough: extra roughness (Kelvin arms), slick: calmer water (turbulent
// wake), foam: white water, light: the ship's lights.
void od_ships(vec3 b, float laneA, float fp, out float rough, out float slick, out float foam, out vec3 light) {
  rough = 0.0; slick = 0.0; foam = 0.0; light = vec3(0.0);
  float id = floor(laneA + 0.5);
  if (id < 0.5 || abs(laneA - id) > 0.02 || fp > 40.0) return;
  int i = int(id) - 1;
  vec4 A = texelFetch(uLaneTex, ivec2(i, 0), 0);
  vec4 B = texelFetch(uLaneTex, ivec2(i, 1), 0);
  vec3 N = normalize(cross(A.xyz, B.xyz));
  float y = dot(b, N) * 6371.0;
  if (abs(y) > 14.0 + fp) return;
  vec3 pp = normalize(b - N * dot(b, N));
  float along = atan(dot(cross(A.xyz, pp), N), dot(A.xyz, pp)) * 6371.0;
  float lenK = B.w * 6371.0;
  if (along < -3.0 || along > lenK + 3.0) return;
  // the ends of a leg ease out so ships do not stop dead at a waypoint
  float ends = smoothstep(-3.0, 6.0, along) * smoothstep(-3.0, 6.0, lenK - along);
  float dayK = 1.0 - smoothstep(4.0, 9.0, fp);
  for (int k = 0; k < 2; k++) {
    // two-way traffic: outbound keeps to one side of the lane, inbound to the other
    float dir = k == 0 ? 1.0 : -1.0;
    float yl = y - dir * 2.6;
    float u = along * dir - SHIP_V * uShipT;
    float slotF = u / SHIP_SP;
    float slot = floor(slotF);
    vec3 hh = hash33(vec3(slot - uShipWrap, id * 7.0 + float(k), 3.7));
    if (hh.x > A.w) continue;
    // km ahead of this slot's ship (each ship a little off its slot's centre)
    float x = (slotF - slot - 0.5 - 0.35 * (hh.y - 0.5)) * SHIP_SP;
    float yo = yl - 0.8 * (hh.z - 0.5);
    float Ls = 0.22 + 0.25 * hh.z;                    // hull length (km)
    // lights at night: a warm deck and white masthead, the big liners brighter
    light += mix(vec3(1.0, 0.82, 0.6), vec3(0.9, 0.95, 1.0), hh.y) * od_blob(x, yo, Ls * 0.6, 0.06, fp) * (4.0 + 10.0 * hh.z) * ends;
    if (dayK <= 0.0) continue;
    // the hull and the bow wave
    foam += od_blob(x, yo, Ls * 0.5, 0.035, fp) * 0.9 * dayK * ends;
    float d = -x;                                     // km astern
    if (d > 0.0 && d < 30.0) {
      float spread = 0.354 * d;                       // the Kelvin half-angle, 19.5 deg
      float wa = 0.03 + 0.012 * d;
      float arm = od_line(abs(yo) - spread, wa, fp) * exp(-d / 7.0) * smoothstep(0.0, 0.3, d);
      float turb = od_line(yo, 0.05 + 0.018 * d, fp) * exp(-d / 16.0);
      rough += arm * 0.9 * dayK * ends;
      slick += turb * 0.9 * dayK * ends;
      foam += od_line(yo, 0.03 + 0.012 * d, fp) * exp(-d / 0.9) * 0.45 * dayK * ends;
    }
  }
}

// Trains on the maglev corridor the bake found near b: lit consists ~400 m long running at
// ~540 km/h both ways on the two tracks, each corridor's traffic by its size; drawn at their true
// size and so, far off, as the faint moving beads the corridor's glow is made of.
vec3 od_trains(vec3 b, float arcA, float fp) {
  float id = floor(arcA + 0.5);
  if (id < 0.5 || fp > 12.0) return vec3(0.0);
  int i = int(id) - 1;
  vec4 N = texelFetch(uArcTex, ivec2(i, 0), 0);
  vec4 A = texelFetch(uArcTex, ivec2(i, 1), 0);
  float y = dot(b, N.xyz) * 6371.0;
  if (abs(y) > 1.5 + fp) return vec3(0.0);
  vec3 pp = normalize(b - N.xyz * dot(b, N.xyz));
  float along = atan(dot(cross(A.xyz, pp), N.xyz), dot(A.xyz, pp)) * 6371.0;
  vec3 L = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float dir = k == 0 ? 1.0 : -1.0;
    float yl = y - dir * 0.012;
    float u = along * dir - TRAIN_V * uTrainT;
    float slotF = u / TRAIN_SP;
    float slot = floor(slotF);
    vec3 hh = hash33(vec3(slot - uTrainWrap, id * 3.0 + float(k), 9.1));
    if (hh.x > 0.35 + 0.6 * A.w) continue;
    float x = (slotF - slot - 0.5 - 0.3 * (hh.y - 0.5)) * TRAIN_SP;
    L += mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.85, 0.6), hh.z) * od_blob(x, yl, 0.2, 0.02, fp) * 40.0;
  }
  return L;
}

// The sea's texture in the glint: a roughness factor (1 = the mean) from the eddies and fronts,
// slicks along the currents and internal waves over the shelf breaks (shelf: the bake's 0 deep
// .. 1 on the shelf). Every term fades to its mean below a few pixels.
float od_seaTexture(vec3 b, float fp, float shelf) {
  vec3 q = b * 60.0;                                  // 1 unit ~ 106 km
  vec3 w = vec3(snoise(q * 0.5 + 11.0), snoise(q * 0.5 + 23.0), snoise(q * 0.5 + 37.0));
  float e = snoise(q + w * 1.6);
  // fronts: sharp lines of convergence (rough, foam-streaked) where eddies meet
  float fr = od_line(e, 0.012, fp / 53.0) * (1.0 - smoothstep(8.0, 20.0, fp));
  // eddies: broad swirls of calmer and rougher water
  float ed = 0.12 * e * (1.0 - smoothstep(60.0, 150.0, fp));
  // slicks: calm streaks drawn out along the swirl
  float sl = smoothstep(0.62, 0.9, snoise(q * 6.0 + w * 5.0) * 0.5 + 0.5) * (1.0 - smoothstep(2.0, 7.0, fp));
  // internal waves: packets of crests ~1.5 km apart running in from the shelf break
  float iw = 0.0;
  float brk = clamp(shelf * (1.0 - shelf) * 4.0, 0.0, 1.0);
  if (brk > 0.05 && fp < 1.2) {
    vec3 p = b * 160.0;                               // 40 km cells
    vec3 c = floor(p);
    vec3 h = hash33(c + 5.3);
    vec3 o = c + 0.5 + 0.2 * (h - 0.5);               // (the packet stays inside its cell)
    float r = length(p - o) * 40.0;                   // km from the packet's origin
    vec3 dirv = normalize(h - 0.5 + 1e-4);
    float cone = smoothstep(0.2, 0.7, dot(normalize(p - o + 1e-5), dirv));
    float zr = (r - 10.0) / 3.5;
    float env = exp(-zr * zr) * cone;
    iw = cos(r * 6.2832 / (1.3 + 0.5 * h.x)) * env * brk * (1.0 - smoothstep(0.35, 1.2, fp));
  }
  return clamp(1.0 + 0.9 * fr + ed - 0.3 * sl + 0.35 * iw, 0.5, 2.2);
}

// Swell and wind sea, resolved only close in (the Meridian approach, a low pass): six trains of
// deep-water waves, 40 - 240 m long, running on their own dispersion (omega^2 = g k). Returns the
// surface slope (body frame); resVar is the slope variance the pixel now resolves, which the
// glint's microfacet roughness gives back (Toksvig), so the mean glint is kept as it sharpens
// into sparkle.
vec3 od_swell(vec3 b, float fp, float t, out float resVar) {
  resVar = 0.0;
  vec3 sl = vec3(0.0);
  if (fp > 0.35) return sl;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float lam = 0.24 * pow(0.7, fi);                  // km
    float K = 6.2832 * 6371.0 / lam;                  // rad per unit of b
    // directions spread round the trade-wind swell's heading
    float az = 0.5 + 0.55 * sin(fi * 2.4) + 0.2 * fi;
    vec3 D = normalize(vec3(cos(az), 0.35 * sin(fi * 1.7), sin(az)));
    D = normalize(D - b * dot(D, b) + 1e-5);
    float omega = sqrt(9.81 * 6.2832 / (lam * 1000.0));
    float s = 0.07 * pow(0.85, fi);                   // slope amplitude A k
    float f = 1.0 - smoothstep(lam * 0.12, lam * 0.4, fp);
    if (f <= 0.0) continue;
    sl += D * (s * f * cos(dot(b, D) * K - omega * t + fi * 1.7));
    resVar += 0.5 * s * s * f * f;
  }
  return sl;
}

// Lightning in deep convection (conv: 0..1, the deck's convective share at this point).
float od_lightning(vec3 bC, float fpC, float conv, float t) {
  if (conv <= 0.0) return 0.0;
  vec3 p = bC * 255.0;                                // ~25 km cells
  vec3 base = floor(p - 0.5);
  float L = 0.0;
  for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) for (int k = 0; k < 2; k++) {
    vec3 c = base + vec3(float(i), float(j), float(k));
    vec3 h = hash33(c + 19.1);
    // each cell its own rhythm: a flash every few seconds in the strongest, a minute in the weakest
    float period = 3.0 + 45.0 * h.x * h.x;
    float ph = t / period + h.y * 13.0;
    float n = floor(ph);
    float hk = hash13(c + n * 1.37);
    if (hk > 0.65) continue;                          // not every cycle flashes
    float tf = (ph - n) * period;                     // seconds since the flash began
    // two to four return strokes over ~0.3 s, then the fading glow of the in-cloud discharge
    float t1 = 0.06 + 0.05 * hk, t2 = 0.17 + 0.08 * h.z;
    float s = exp(-tf / 0.025) + 0.8 * exp(-max(tf - t1, 0.0) / 0.025) * step(t1, tf) + 0.6 * exp(-max(tf - t2, 0.0) / 0.03) * step(t2, tf) * step(0.3, h.z);
    s += 0.3 * exp(-tf / 0.3);
    vec3 o = c + 0.2 + 0.6 * hash33(c + n);           // this flash's place in the cell
    float d2 = dot(p - o, p - o) * 625.0;             // km^2
    float R = 5.0 + 9.0 * hk;                         // the lit patch, spread by scattering
    float Rp = max(R, fpC * 0.7);
    L += s * exp(-d2 / (Rp * Rp)) * (R * R) / (Rp * Rp);
  }
  return L * conv;
}

// Sunglint off glass: a microfacet (GGX) lobe of roughness a, Schlick's Fresnel for glass.
float od_glint(vec3 n, vec3 V, vec3 L, float a) {
  vec3 H = normalize(V + L);
  float nh = max(dot(n, H), 0.0), nv = max(dot(n, V), 1e-3), nl = max(dot(n, L), 0.0);
  float a2 = a * a;
  float dd = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (S_PI * dd * dd);
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  return D * F * step(0.0, nl) / (4.0 * nv);
}

// Arcologies: day = (albedo rgb, cover); night emission out; glass: the share of glazed roof
// (the lenses are all glass; the rings and stars glazed between their spokes).
vec4 od_arcology(vec3 b, float fp, out vec3 night, out float glass) {
  night = vec3(0.0);
  glass = 0.0;
  vec4 day = vec4(0.0);
  vec3 gold = vec3(1.0, 0.8, 0.5), white = vec3(0.95, 0.97, 1.0);
  for (int i = 0; i < ${ARCOLOGIES.length}; i++) {
    vec4 A = uArco[i];
    vec3 dv = b - A.xyz;
    float dk = length(dv) * 6371.0;
    float R = A.w;
    if (dk > R * 5.0 + fp * 4.0) continue;
    vec3 e = normalize(cross(vec3(0.0, 1.0, 0.0), A.xyz));
    vec3 nn = cross(A.xyz, e);
    vec2 P = vec2(dot(dv, e), dot(dv, nn)) * 6371.0;
    float kind = uArcoK[i].x, seed = uArcoK[i].y;
    // the lens is an ellipse; the others round
    vec2 Pq = kind > 1.5 ? vec2(P.x, P.y / 0.55) : P;
    float r = length(Pq);
    float ang = atan(P.y, P.x) + seed * 6.28;
    float w = max(fp * 0.6, 0.15);
    // the structure's lines: the outer ring, an inner ring, six spokes (a star's run past the rim)
    float ring = od_line(r - R, 0.25, fp) + 0.7 * od_line(r - R * 0.55, 0.18, fp);
    float spokeA = abs(sin(ang * 3.0)) * r;           // distance to the nearest of six spokes
    float spokeR = kind > 0.5 && kind < 1.5 ? R * 1.35 : R;
    float spokes = od_line(spokeA, 0.14, fp) * (1.0 - smoothstep(spokeR - 0.3, spokeR + 0.3, r));
    float core = od_blob(P.x, P.y, R * 0.18, R * 0.18, fp);
    float districts = exp(-r * r / (R * R * 5.0)) * (0.6 + 0.4 * snoise(vec3(P * 0.8, seed * 10.0)));
    // unresolved, the whole city is one glow that keeps its energy
    float rg = max(R, fp * 1.2);
    float far = exp(-dk * dk / (rg * rg)) * pow(R / rg, 1.9) * smoothstep(R * 0.5, R * 2.0, fp);
    night += gold * (ring * 5.0 + spokes * 4.0 + districts * 0.35) + white * core * 30.0 + mix(gold, white, 0.5) * far * 6.0;
    // by day: a pale platform with darker lines, fading to its mean with range
    float plat = 1.0 - smoothstep(R * 1.08 - w, R * 1.08 + w, r);
    float lines = clamp(ring + spokes, 0.0, 1.0);
    vec3 alb = mix(vec3(0.42, 0.41, 0.38), vec3(0.16, 0.17, 0.18), lines * 0.8);
    alb = mix(alb, vec3(0.5, 0.52, 0.5), core);
    float cov = plat * (1.0 - smoothstep(R * 2.5, R * 6.0, fp));
    day = mix(day, vec4(alb, 1.0), cov);
    glass = max(glass, plat * (1.0 - lines) * (kind > 1.5 ? 0.85 : 0.3) * cov);
  }
  return day;
}

// City districts switch their lights on at their own moment of dusk (each ~9 km district its own
// threshold), so the terminator crossing a resolved city is a ragged wave of lights, not a line.
float od_switchOn(vec3 b, float mu, float fp) {
  float lat = asin(clamp(b.y, -1.0, 1.0));
  float lon = atan(-b.z, b.x);
  vec2 q = vec2(lon * cos(lat), lat) * (6371.0 / 9.0);
  float h = hash12(floor(q) + 71.0);
  float off = (h - 0.5) * 0.07 * (1.0 - smoothstep(4.0, 12.0, fp));
  return 1.0 - smoothstep(-0.12 + off, 0.05 + off, mu);
}

// The aurora's light on the cloud tops and snow beneath the ovals (sB: the Sun in the body
// frame); the same oval as aurora.js: 18 deg from the magnetic pole, 5 deg further at midnight.
float od_auroraGround(vec3 b, vec3 sB) {
  float g = 0.0;
  for (int k = 0; k < 2; k++) {
    vec3 z = MAG_POLE * (k == 0 ? 1.0 : -1.0);
    float cz = dot(b, z);
    if (cz < 0.75) continue;
    float th = acos(clamp(cz, -1.0, 1.0));
    vec3 xm = normalize(-sB + z * dot(sB, z) + 1e-5);
    vec3 ym = cross(z, xm);
    float phi = atan(dot(b, ym), dot(b, xm));
    float zz = (th - (0.314 + 0.087 * cos(phi) + 0.02)) / 0.045;
    g += exp(-zz * zz) * (0.35 + 0.65 * exp(-phi * phi / 1.2));
  }
  return g * (0.3 + 0.7 * uAuroraAct);
}

// Kilauea, Meridian's volcanic neighbour: a lava lake and a flow channel to the sea glowing at
// night, the sulphurous haze (vog) trailing downwind by day. day: (tint rgb, amount).
vec4 od_volcano(vec3 b, float fp, out vec3 night) {
  night = vec3(0.0);
  vec3 dv = b - KILAUEA;
  float dk = length(dv) * 6371.0;
  if (dk > 260.0) return vec4(0.0);
  vec3 e = normalize(cross(vec3(0.0, 1.0, 0.0), KILAUEA));
  vec3 nn = cross(KILAUEA, e);
  vec2 P = vec2(dot(dv, e), dot(dv, nn)) * 6371.0;
  vec3 lava = vec3(1.0, 0.32, 0.06);
  night += lava * od_blob(P.x, P.y, 0.6, 0.45, fp) * 60.0;
  // the flow: a channel of crusted lava breaking out in glowing tongues down to the coast (SE)
  vec2 a = vec2(0.0), bb = vec2(9.0, -14.0);
  vec2 ab = bb - a;
  float t = clamp(dot(P - a, ab) / dot(ab, ab), 0.0, 1.0);
  float dl = length(P - a - ab * t);
  float tongues = 0.5 + 0.5 * sin(t * 40.0 + 3.0 * snoise(vec3(P * 0.4, 1.0)));
  night += lava * od_line(dl, 0.12, fp) * (0.4 + 0.6 * tongues) * 6.0 * (0.4 + 0.6 * t);
  // vog: blown south-west by the trades, widening and thinning
  vec2 w = normalize(vec2(-0.7, -0.7));
  float x = dot(P, w), y = w.x * P.y - w.y * P.x;
  float yw = y / (4.0 + 0.3 * max(x, 0.0));
  float vog = exp(-yw * yw) * smoothstep(-2.0, 4.0, x) * exp(-max(x, 0.0) / 120.0) * (0.6 + 0.4 * snoise(vec3(P * 0.05, 7.0)));
  return vec4(0.34, 0.35, 0.36, clamp(vog, 0.0, 1.0) * 0.35);
}

// Red sprites over the storms, seen edge-on above the night limb: when a strong positive
// stroke drains a storm's charge, the mesosphere above it lights for a few milliseconds to a
// tenth of a second: a diffuse red crown at 70 - 85 km, and below it blue-violet tendrils
// reaching down toward the cloud tops. Drawn for rays grazing the limb (tangent height 30 -
// 100 km) above deep convection, in columns along the limb each with its own rare flash.
vec3 od_sprites(vec3 ro, vec3 rd, vec3 sun, float t) {
  float tt = -dot(ro, rd);
  if (tt <= 0.0) return vec3(0.0);
  vec3 pt = ro + rd * tt;
  float r = length(pt);
  float h = r - Rg;
  if (h < 30.0 || h > 100.0) return vec3(0.0);
  vec3 up = pt / r;
  if (dot(up, sun) > -0.15) return vec3(0.0);               // only over the night
  // along-limb coordinate (km) round the camera's axis
  vec3 ax = normalize(ro);
  vec3 e1 = normalize(cross(ax, abs(ax.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(ax, e1);
  float s = atan(dot(up, e2), dot(up, e1)) * Rg;
  float colW = 60.0;
  float cid = floor(s / colW);
  vec3 hh = hash33(vec3(cid, 7.3, 1.1));
  // is there a storm beneath this stretch of limb? (the weather's convective potential)
  vec4 w = weatherAt(uToBody * up, 30.0);
  float storm = smoothstep(0.7, 0.85, w.r) * (1.0 - smoothstep(0.3, 0.6, w.g));
  if (storm <= 0.0) return vec3(0.0);
  float period = 6.0 + 20.0 * hh.x;
  float ph = t / period + hh.y * 17.0;
  float n = floor(ph);
  float age = (ph - n) * period;
  if (hash11(cid * 3.1 + n) > 0.5 || age > 0.25) return vec3(0.0);
  float I = exp(-age / 0.04) * storm;
  float x = s - (cid + 0.2 + 0.6 * hash11(cid + n * 1.7)) * colW;  // km from the sprite's axis
  float wd = 6.0 + 8.0 * hh.z;
  // the crown: a red dome with a darker hollow, 70 - 88 km
  float zc = (h - 78.0) / 7.0, xc = x / wd;
  float crown = exp(-zc * zc - xc * xc);
  // the tendrils: narrow streamers hanging from the crown to ~45 km
  float tend = pow(0.5 + 0.5 * cos(x * 1.4 + 3.0 * hash11(cid + n)), 8.0) * exp(-xc * xc * 0.5) * smoothstep(42.0, 55.0, h) * (1.0 - smoothstep(70.0, 76.0, h));
  vec3 col = vec3(1.0, 0.16, 0.22) * crown + mix(vec3(0.45, 0.2, 0.9), vec3(0.9, 0.2, 0.35), smoothstep(50.0, 72.0, h)) * tend * 0.8;
  return col * I * 0.35;
}

// Polar stratospheric (nacreous) clouds: in the Antarctic winter (June) the stratosphere over
// the pole is cold enough for ice and nitric-acid-trihydrate clouds at ~22 km. Lenticular sheets
// in the lee of the mountains, lit from below the horizon at twilight, iridescent (the tiny
// uniform droplets diffract sunlight into mother-of-pearl bands that shift with the angle).
vec3 od_psc(vec3 ro, vec3 rd, vec3 sun, float tMax) {
  vec2 tN = sphereHits(ro, rd, Rg + 22.0);
  if (tN.x > tN.y) return vec3(0.0);
  float t = tN.x > 0.0 ? tN.x : tN.y;
  if (t <= 0.0 || t > tMax) return vec3(0.0);
  vec3 p = ro + rd * t;
  vec3 n = normalize(p);
  vec3 bb = uToBody * n;
  float band = 1.0 - smoothstep(-0.9, -0.84, bb.y);                     // poleward of ~60 S
  if (band <= 0.0) return vec3(0.0);
  float muS = dot(n, sun);
  float dark = (1.0 - smoothstep(-0.02, 0.1, muS)) * smoothstep(-0.2, -0.06, muS);   // twilight only
  float lit = earthShadow(p, sun);
  if (lit * dark <= 0.0) return vec3(0.0);
  // lenticular sheets drawn out along the circumpolar wind (zonal: east-west)
  vec3 q = bb * (6371.0 / 60.0);
  vec3 qz = vec3(q.x * 0.35 + q.z * 0.94, q.y * 3.0, q.z * 0.35 - q.x * 0.94);
  float sheet = smoothstep(0.55, 0.8, snoise(qz * 0.5 + 11.0) * 0.5 + 0.5 + 0.2 * snoise(q * 0.15 + 4.0));
  float thick = 0.5 + 0.5 * snoise(q * 1.7 + 2.0);
  // iridescence: interference colours shifting with the scattering angle and the sheet's thickness
  float ang = acos(clamp(dot(rd, sun), -1.0, 1.0));
  vec3 iri = 0.55 + 0.45 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + ang * 2.4 + thick * 0.8));
  float mu = max(abs(dot(rd, n)), 0.03);
  return iri * band * sheet * min(1.0 / mu, 30.0) * lit * dark * uSunE * 3.5e-4 * uNlcGain;
}

// Noctilucent clouds (added in front of the planet and its limb).
vec3 od_nlc(vec3 ro, vec3 rd, vec3 sun, float tMax) {
  vec2 tN = sphereHits(ro, rd, Rg + 83.0);
  if (tN.x > tN.y) return vec3(0.0);
  float t = tN.x > 0.0 ? tN.x : tN.y;
  if (t <= 0.0 || t > tMax) return vec3(0.0);
  vec3 p = ro + rd * t;
  vec3 n = normalize(p);
  vec3 bb = uToBody * n;
  // the summer (northern, in June) polar mesosphere, ~52 - 76 N
  float band = smoothstep(0.78, 0.86, bb.y) * (1.0 - smoothstep(0.965, 0.99, bb.y));
  if (band <= 0.0) return vec3(0.0);
  float muS = dot(n, sun);
  float dark = 1.0 - smoothstep(-0.06, 0.06, muS);
  float lit = earthShadow(p, sun);
  if (lit * dark <= 0.0) return vec3(0.0);
  vec3 q = bb * (6371.0 / 40.0);
  float pch = smoothstep(0.35, 0.75, snoise(q * 0.3 + 3.0) * 0.5 + 0.5 + 0.25 * snoise(q * 0.08 + 7.0));
  float fpN = t * uPixAng;
  float bill = mix(1.0, 0.55 + 0.45 * sin(dot(q, vec3(0.8, 0.1, 0.6)) * 24.0 + 3.0 * snoise(q * 0.6)), 1.0 - smoothstep(2.0, 6.0, fpN));
  float dens = band * pch * bill;
  float mu = max(abs(dot(rd, n)), 0.025);
  float fwd = phaseMie(dot(rd, sun));
  return vec3(0.35, 0.62, 1.0) * dens * min(1.0 / mu, 40.0) * lit * dark * uSunE * 2.5e-4 * (0.3 + fwd) * uNlcGain;
}
`;
