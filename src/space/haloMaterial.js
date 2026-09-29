import * as THREE from 'three';
import { createCraftMaterial } from '../craft/craftMaterial.js';

// The Halo's own surface kinds, layered on the space craft material (same lighting, same
// camera-relative projection, same facade coordinates in metres). The craft palette was made
// for hulls: pearl plates, dark glass, bronze. Under the vault the districts need the city's
// language instead - stone and render facades in district colours with lit window grids and
// roofscapes, streets with lamp pools, roof gardens, tiled pitched roofs, living water, crops
// and trees of many kinds. Kinds start at 40 so they never meet the craft kinds.
//
// Every pattern settles to its exact mean while its cell still spans a few pixels (the same
// rule as the craft kinds), so a district seen from 40 km is a field of colour, not noise.
// The object-space normal's up component rides along as vUp: roofs and facades share kinds.
//
// Third pass: what reads at the targets' own framings (1-40 km), where every window is below
// a pixel and a facade is only its mean -
//
//  - each building carries its own draw in the fractional part of its kind (tintKind below;
//    `floor(k + 0.5)` still recovers the kind), so buildings differ from their neighbours in
//    stone, window order (punched, ribbon, double-height, loggias), lit fraction at night,
//    roof finish and glass colour, instead of all averaging to one grey;
//  - the height of every fragment over the deck under it (vH, from the deck's sag) darkens
//    the foot of every wall and gives each building a shopfront plinth; the vault's glass
//    scatters the Sun into the valley as a sky fill, stronger on faces turned up to it, so
//    walls in shade keep their colour instead of dropping to black (haloLight);
//  - towers wear tinted curtain walls with spandrels and sky-lobby bands (CURTAIN), parks
//    are lawns and meadows in drifts with mown stripes, tree shade and winding paths (LAWN),
//    woods are massed canopies rather than single cones (CANOPY).

export const HK = {
  FACADE: 40,          // 40..45: stone / render facades, one palette per district variant
  ROOFGARDEN: 46,
  TILE: 47,            // pitched tiled roofs
  WATER: 48,
  STREET: 50,
  STONE: 51,           // plazas, quays, terrace slabs, cliff piers
  CROPS: 52,
  AWNING: 53,
  CURTAIN: 54,         // tinted curtain-wall glass (towers)
  LAWN: 55,            // park ground: lawns, meadows, paths
  CANOPY: 56,          // massed woodland canopy
  TREE: 60,            // 60..64: canopy species
  NEON: 66,            // signage and shopfront light bands
};
export const facadeKind = (palette) => HK.FACADE + (((palette % 6) + 6) % 6);
export const treeKind = (species) => HK.TREE + (((species % 5) + 5) % 5);
/**
 * A kind carrying a per-building draw t in [0, 1): stored as k + (t - 0.5) * 0.8, so it stays
 * within 0.4 of k (the shaders' floor(k + 0.5) and the tools' Math.round recover k exactly).
 */
export const tintKind = (k, t) => Math.round(k) + (Math.min(Math.max(t, 0), 0.999) - 0.5) * 0.8;
/** The draw back out of a tinted kind (0.5 for a plain one). */
export const kindTint = (kt) => (kt - Math.round(kt)) / 0.8 + 0.5;
/** Default deck of the district frame (metres): sag at the centre line, half span. */
export const HALO_DECK = { sag: 128, half: 16384 };

const HALO_GLSL = /* glsl */ `
varying float vUp;
varying float vH;
uniform vec3 uDeck;          // deck sag (m), half span (m), 1 where the frame is a district tile's
// the building's own draw, carried in the kind's fraction (0.5 for untinted geometry)
float haloTint() { return clamp((vFac.z - floor(vFac.z + 0.5)) / 0.8 + 0.5, 0.0, 1.0); }
vec3 haloStone(float p, float t) {
  vec3 a = vec3(0.80, 0.74, 0.62), b = vec3(0.72, 0.60, 0.46), c = vec3(0.60, 0.52, 0.45), d = vec3(0.86, 0.83, 0.76);  // limestone, honey sandstone, warm grey, pale render
  if (p > 0.5 && p < 1.5) { a = vec3(0.70, 0.42, 0.28); b = vec3(0.80, 0.62, 0.40); c = vec3(0.60, 0.33, 0.25); d = vec3(0.86, 0.78, 0.62); }        // terracotta, ochre, red-brown, lime-wash
  else if (p > 1.5 && p < 2.5) { a = vec3(0.84, 0.83, 0.80); b = vec3(0.60, 0.65, 0.70); c = vec3(0.74, 0.72, 0.66); d = vec3(0.50, 0.53, 0.57); }   // white render, slate blue, pale stone, granite
  else if (p > 2.5 && p < 3.5) { a = vec3(0.52, 0.31, 0.23); b = vec3(0.58, 0.55, 0.50); c = vec3(0.36, 0.28, 0.25); d = vec3(0.68, 0.47, 0.32); }   // brick, concrete, dark brick, orange brick
  else if (p > 3.5 && p < 4.5) { a = vec3(0.56, 0.70, 0.61); b = vec3(0.85, 0.81, 0.68); c = vec3(0.44, 0.59, 0.63); d = vec3(0.72, 0.75, 0.58); }   // sage ceramic, cream, teal grey, celadon
  else if (p > 4.5) { a = vec3(0.80, 0.55, 0.49); b = vec3(0.58, 0.60, 0.76); c = vec3(0.87, 0.70, 0.52); d = vec3(0.64, 0.45, 0.52); }              // rose, lavender, apricot, plum
  float i = floor(t * 3.999);
  vec3 s = i < 0.5 ? a : i < 1.5 ? b : i < 2.5 ? c : d;
  return s * (0.9 + 0.2 * fract(t * 17.3));
}
vec3 haloPalette(float p, float h) { return haloStone(p, h); }
vec3 haloTree(float s) {
  if (s < 0.5) return vec3(0.045, 0.11, 0.035);          // oak and lime
  if (s < 1.5) return vec3(0.10, 0.17, 0.05);            // birch and willow
  if (s < 2.5) return vec3(0.20, 0.07, 0.05);            // copper beech
  if (s < 3.5) return vec3(0.52, 0.32, 0.40);            // blossom
  return vec3(0.30, 0.22, 0.05);                         // gold
}
// band coverage filtered to its mean below a pixel (window edges, mullions, lane marks)
float hBox(float x, float a, float b, float fw) {
  return clamp((min(x - a, b - x)) / max(fw, 1e-4) + 0.5, 0.0, 1.0);
}
// flat roofs: one finish per building (from its draw), details only while they resolve
void haloRoof(float t, vec2 f, vec2 fw, float det, float detB, vec3 stone, inout vec3 alb, inout float rough, inout float metal, inout vec3 em) {
  float h = hash12(floor(f / 11.0) + t * 37.0);
  float r = fract(t * 3.71);
  vec3 finish = r < 0.2 ? vec3(0.55, 0.53, 0.48) : r < 0.36 ? vec3(0.21, 0.23, 0.26) : r < 0.48 ? vec3(0.27, 0.49, 0.41) : r < 0.68 ? vec3(0.14, 0.25, 0.08) : r < 0.8 ? vec3(0.045, 0.06, 0.13) : mix(stone, vec3(0.6, 0.58, 0.54), 0.5);
  float solar = step(0.68, r) * step(r, 0.8);
  float green = step(0.48, r) * step(r, 0.68);
  alb = finish * (0.92 + 0.16 * mix(0.5, vnoise(f * 0.09 + t * 5.0), detB));
  // parapet line round each 11 m roof bay, plant rooms and skylights (lit from below at night)
  float plant = step(0.9, h) * detB * (1.0 - green);
  alb = mix(alb, vec3(0.3, 0.3, 0.31), plant);
  float sky = step(h, 0.08) * detB * (1.0 - solar);
  alb = mix(alb, vec3(0.06, 0.08, 0.1), sky);
  float sedum = step(0.7, h) * (1.0 - plant) * detB * (1.0 - solar);
  alb = mix(alb, vec3(0.13, 0.21, 0.07), sedum * 0.7);
  float cells = max(hBox(fract(f.x / 1.8) * 1.8, 0.0, 0.08, fw.x), hBox(fract(f.y / 1.1) * 1.1, 0.0, 0.08, fw.y)) * det * solar;
  alb += vec3(0.12) * cells;
  alb *= 1.0 - 0.22 * max(hBox(fract(f.x / 11.0) * 11.0, 0.0, 0.3, fw.x), hBox(fract(f.y / 11.0) * 11.0, 0.0, 0.3, fw.y)) * det;
  rough = mix(mix(0.78, 0.2, solar), 0.2, sky); metal = mix(0.04 + 0.6 * solar, 0.4, sky + plant * 0.5);
  em = vec3(1.0, 0.8, 0.55) * (mix(0.012, sky * 0.35, detB) + green * 0.004);
}
void haloKinds(float k, vec2 f, vec2 fw, float px, inout vec3 alb, inout float rough, inout float metal, inout vec3 em, inout vec2 bump) {
  if (k < 39.5) return;
  float det = 1.0 - smoothstep(0.35, 1.1, px);          // metre-scale detail
  float detB = 1.0 - smoothstep(2.0, 6.0, px);          // building-scale detail
  float detS = 1.0 - smoothstep(6.0, 18.0, px);         // storey-group scale (cornices, plinths)
  float up = vUp;
  float t = haloTint();
  if (k < 45.5) {
    float pal = k - 40.0;
    vec3 stone = haloStone(pal, t);
    if (up > 0.7) { haloRoof(t, f, fw, det, detB, stone, alb, rough, metal, em); return; }
    if (up < -0.7) { alb = vec3(0.16, 0.15, 0.14); rough = 0.8; em = vec3(1.0, 0.75, 0.5) * 0.05; return; }
    // facade: the building's window order - punched, wide ribbons, double-height, loggias -
    // each with its own share of glass, so neighbours differ in value from kilometres away
    float ty = fract(t * 5.71);
    vec2 bay = vec2(3.0, 3.6); vec4 wb = vec4(0.55, 2.45, 0.85, 3.1);
    if (ty > 0.4 && ty < 0.62) { bay = vec2(4.5, 3.6); wb = vec4(0.25, 4.25, 1.05, 2.95); }
    else if (ty > 0.62 && ty < 0.8) { bay = vec2(3.0, 7.2); wb = vec4(0.65, 2.35, 0.9, 6.5); }
    else if (ty > 0.8) { bay = vec2(6.0, 3.6); wb = vec4(0.45, 5.55, 0.35, 3.25); }
    float mean = (wb.y - wb.x) / bay.x * (wb.w - wb.z) / bay.y;
    vec2 wc = vec2(fract(f.x / bay.x) * bay.x, fract(f.y / bay.y) * bay.y);
    float wx = hBox(wc.x, wb.x, wb.y, fw.x), wy = hBox(wc.y, wb.z, wb.w, fw.y);
    float win = mix(mean, wx * wy, det);
    // a cornice every fourth storey, a pier every 42 m (both read while a storey group is a
    // pixel or two), and rain streaks under the sills
    float cornice = hBox(fract(f.y / 14.4) * 14.4, 0.0, 0.7, fw.y) * detB;
    float pier = hBox(fract(f.x / 42.0) * 42.0, 0.0, 1.6, fw.x) * detS * step(ty, 0.8);
    win *= (1.0 - cornice) * (1.0 - pier);
    stone *= 1.0 - 0.1 * smoothstep(0.5, 0.9, vnoise(vec2(f.x * 0.6, f.y * 0.04) + t * 17.0)) * detB;
    // the ground floor: shopfront glass under a stone fascia, on district tiles only
    float plinth = uDeck.z * (1.0 - smoothstep(6.4, 7.2, vH));
    float fascia = uDeck.z * hBox(vH, 7.2, 8.4, fw.y) * (1.0 - plinth);
    vec3 glass = mix(vec3(0.05, 0.07, 0.09), vec3(0.14, 0.16, 0.17), fract(t * 11.3));
    if (ty > 0.8) glass *= 0.55;                          // (loggias: deep and shaded)
    alb = mix(stone * (1.0 - 0.12 * cornice) * (1.0 + 0.1 * fascia), glass, max(win, plinth * 0.8));
    rough = mix(0.72, 0.08, win); metal = mix(0.02, 0.5, win);
    // relief: the reveal round each window (only while resolved)
    bump.x += (wc.x < bay.x * 0.5 ? -1.0 : 1.0) * (1.0 - wx) * wy * 0.5 * det;
    bump.y += (wc.y < bay.y * 0.55 ? -1.0 : 1.0) * (1.0 - wy) * wx * 0.4 * det;
    // lit rooms: warm or cool by household, the building's own share lit, whole floors dark
    // in some buildings; the mean kept once the rooms are gone
    vec2 room = floor(f / bay);
    float hr = hash12(room + 31.0 + t * 7.0);
    float share = 0.25 + 0.55 * fract(t * 3.31);
    float fl = 0.35 + 0.65 * hash12(vec2(floor(f.x / 42.0), room.y) + 5.0 + t);
    float lit = mix(share * 0.675, step(1.0 - share * fl, hr), det);
    vec3 lamp = mix(vec3(1.0, 0.72, 0.44), vec3(0.85, 0.9, 1.0), step(0.82, fract(hr * 9.1)));
    lamp = mix(lamp, vec3(1.0, 0.55, 0.35), step(0.95, fract(hr * 5.3)));
    em = lamp * lit * win * 0.6 + vec3(1.0, 0.76, 0.5) * plinth * 0.22;
    return;
  }
  if (k < 46.5) {
    // roof garden: lawns and beds, gravel walks, a pool, pergola lamps at dusk
    vec2 c = floor(f / 9.0);
    float h = hash12(c + 3.0);
    float g = mix(0.5, vnoise(f * 0.23) * 0.6 + vnoise(f * 1.1) * 0.4, det);
    alb = mix(vec3(0.06, 0.15, 0.04), vec3(0.19, 0.3, 0.08), g);
    alb *= 0.85 + 0.3 * mix(0.5, vnoise(f * 0.03 + t * 9.0), detS);
    float walk = max(hBox(fract(f.x / 18.0) * 18.0, 0.0, 1.6, fw.x), hBox(fract(f.y / 27.0) * 27.0, 0.0, 1.6, fw.y));
    alb = mix(alb, vec3(0.55, 0.5, 0.42), mix(0.14, walk, detB));
    float pool = step(0.94, h) * detB;
    alb = mix(alb, vec3(0.05, 0.22, 0.28), pool);
    float bed = step(0.8, h) * (1.0 - pool) * detB;
    alb = mix(alb, mix(vec3(0.5, 0.12, 0.2), vec3(0.62, 0.52, 0.12), fract(h * 13.0)), bed * 0.8);
    rough = mix(0.85, 0.05, pool);
    em = vec3(1.0, 0.78, 0.5) * mix(0.02, walk * step(0.7, fract(f.x * 0.17 + h)) * 0.35, det) + vec3(0.1, 0.5, 0.6) * pool * 0.25;
    return;
  }
  if (k < 47.5) {
    // tiled pitched roofs: courses, the roof's own tile (terracotta, brown, slate, glazed green,
    // ochre), moss in the valleys, solar slates on some
    vec2 rc = floor(f / 24.0);
    float h = hash12(rc + 9.0 + t * 13.0);
    vec3 tile = t < 0.45 ? mix(vec3(0.50, 0.21, 0.12), vec3(0.64, 0.36, 0.2), t / 0.45) : t < 0.62 ? vec3(0.36, 0.17, 0.11) : t < 0.8 ? vec3(0.23, 0.24, 0.27) : t < 0.9 ? vec3(0.17, 0.33, 0.25) : vec3(0.64, 0.49, 0.24);
    alb = tile * (0.9 + 0.2 * h);
    float course = hBox(fract(f.y / 0.45) * 0.45, 0.0, 0.08, fw.y) * det;
    alb *= 1.0 - 0.3 * course;
    alb *= 0.9 + 0.2 * mix(0.5, vnoise(f * 0.4), detB);
    alb = mix(alb, vec3(0.16, 0.2, 0.08), 0.25 * smoothstep(0.6, 0.9, vnoise(f * 0.13 + t * 3.0)) * detB);   // moss
    float solar = step(0.9, hash12(rc + 41.0)) * detB;
    alb = mix(alb, vec3(0.03, 0.05, 0.12), solar);
    rough = mix(0.7, 0.15, solar); metal = mix(0.0, 0.6, solar);
    return;
  }
  if (k < 48.5) {
    if (up > 0.5) {
      // open water: wind ripples running across it, deep teal, shimmering lamp reflections
      float tt = uTime;
      float r1 = sin(f.x * 0.31 + tt * 1.4 + vnoise(f * 0.02) * 6.0);
      float r2 = sin(f.y * 0.23 - tt * 1.1 + vnoise(f * 0.017 + 4.0) * 6.0);
      float dw = 1.0 - smoothstep(0.08, 0.5, px);
      bump += vec2(r1, r2) * 0.07 * dw + vec2(vnoise(f * 0.05 + tt * 0.2) - 0.5, vnoise(f * 0.05 - tt * 0.17 + 9.0) - 0.5) * 0.12 * detB;
      float depth = vnoise(f * 0.006);
      alb = mix(vec3(0.014, 0.045, 0.055), vec3(0.035, 0.1, 0.095), depth);
      rough = 0.03; metal = 0.0;
      float sparkle = step(0.992, hash12(floor(f / 2.5) + floor(tt * 3.0))) * det;
      em = vec3(0.012, 0.03, 0.034) + vec3(1.0, 0.74, 0.45) * mix(0.03, sparkle * 1.5, det) * smoothstep(0.3, 0.8, vnoise(f * 0.012 + 2.0));
    } else {
      // falling water: white streams sliding down, a cool glow so the cascades read at night
      float col = hash12(vec2(floor(f.x / 1.2), 3.0));
      float fall = fract(f.y * 0.035 + uTime * (0.6 + 0.5 * col) + col);
      float streak = mix(0.5, smoothstep(0.0, 0.4, fall) * (1.0 - smoothstep(0.55, 1.0, fall)), det);
      alb = mix(vec3(0.2, 0.3, 0.33), vec3(0.8, 0.86, 0.88), streak);
      rough = 0.25; metal = 0.0;
      em = vec3(0.35, 0.6, 0.7) * (0.04 + 0.1 * streak);
    }
    return;
  }
  if (k < 50.5) {
    // streets: granite setts and pavements, lane marks, tram grooves, pools of lamp light, and
    // after dark the head and tail lights of the traffic running both ways along the lanes
    float h = hash12(floor(f / 1.2));
    alb = vec3(0.2, 0.2, 0.21) * (0.9 + 0.2 * mix(0.5, h, det));
    alb *= 0.9 + 0.2 * mix(0.5, vnoise(f * 0.02), detS);
    float lane = hBox(fract(f.x / 25.0) * 25.0, 12.2, 12.8, fw.x) * hBox(fract(f.y / 6.0) * 6.0, 0.0, 3.0, fw.y);
    float lane2 = hBox(fract(f.y / 25.0) * 25.0, 12.2, 12.8, fw.y) * hBox(fract(f.x / 6.0) * 6.0, 0.0, 3.0, fw.x);
    alb = mix(alb, vec3(0.62, 0.6, 0.5), max(lane, lane2) * det + 0.03 * (1.0 - det));
    vec2 lp = (fract(f / 30.0) - 0.5) * 30.0;
    float pool = exp(-dot(lp, lp) * 0.012);
    float carA = step(0.86, hash12(vec2(floor(f.y / 9.0 + uTime * 1.6), floor(f.x / 25.0)))) * hBox(fract(f.x / 25.0) * 25.0, 9.5, 11.0, fw.x);
    float carB = step(0.86, hash12(vec2(floor(f.x / 9.0 - uTime * 1.6), floor(f.y / 25.0) + 7.0))) * hBox(fract(f.y / 25.0) * 25.0, 14.0, 15.5, fw.y);
    em = vec3(1.0, 0.7, 0.4) * mix(0.09, pool * 0.9, detB) * 0.25 + mix(vec3(0.02), vec3(1.0, 0.85, 0.7) * carA + vec3(1.0, 0.2, 0.12) * carB, det) * 0.4;
    rough = 0.55; metal = 0.02;
    return;
  }
  if (k < 51.5) {
    // dressed stone: plazas and quays, in courses with a laid pattern, weathered
    vec2 c = floor(f / vec2(2.4, 1.2));
    float h = hash12(c);
    alb = mix(vec3(0.6, 0.55, 0.47), vec3(0.7, 0.66, 0.58), mix(0.5, h, det));
    float joint = max(hBox(fract(f.x / 2.4) * 2.4, 0.0, 0.05, fw.x), hBox(fract(f.y / 1.2) * 1.2, 0.0, 0.05, fw.y)) * det;
    alb *= 1.0 - 0.25 * joint;
    float inlay = hBox(fract(f.x / 48.0) * 48.0, 0.0, 1.2, fw.x) + hBox(fract(f.y / 48.0) * 48.0, 0.0, 1.2, fw.y);
    alb = mix(alb, vec3(0.42, 0.34, 0.26), clamp(inlay, 0.0, 1.0) * mix(0.05, 1.0, detB));
    alb *= 1.0 - 0.1 * vnoise(f * 0.05) * detB;
    alb *= 0.92 + 0.16 * mix(0.5, vnoise(f * 0.008 + 5.0), detS);
    rough = 0.7; metal = 0.0;
    em = vec3(1.0, 0.76, 0.5) * 0.012;
    return;
  }
  if (k < 52.5) {
    // crops: fields of wheat, barley, greens, lavender and rape in rows, irrigation lines
    vec2 fc = floor(f / vec2(90.0, 240.0));
    float h = hash12(fc + 21.0);
    vec3 c = h < 0.25 ? vec3(0.42, 0.34, 0.12) : h < 0.5 ? vec3(0.1, 0.2, 0.05) : h < 0.65 ? vec3(0.3, 0.22, 0.4) : h < 0.8 ? vec3(0.55, 0.48, 0.08) : vec3(0.16, 0.24, 0.08);
    float row = hBox(fract(f.x / 1.6) * 1.6, 0.0, 0.7, fw.x);
    c *= mix(0.9, 0.75 + 0.4 * row, det);
    c *= 0.9 + 0.2 * mix(0.5, vnoise(f * 0.03 + h * 11.0), detB);
    float ditch = max(hBox(fract(f.x / 90.0) * 90.0, 0.0, 1.5, fw.x), hBox(fract(f.y / 240.0) * 240.0, 0.0, 1.5, fw.y));
    alb = mix(c, vec3(0.04, 0.08, 0.1), ditch * mix(0.03, 1.0, detB));
    rough = mix(0.9, 0.1, ditch * detB); metal = 0.0;
    return;
  }
  if (k < 53.5) {
    // market awnings: striped canvas, lit from under
    float h = hash12(vec2(floor(f.x / 14.0), floor(f.y / 14.0)));
    vec3 a = h < 0.33 ? vec3(0.7, 0.14, 0.12) : h < 0.66 ? vec3(0.08, 0.45, 0.45) : vec3(0.75, 0.52, 0.1);
    float st = hBox(fract(f.x / 1.6) * 1.6, 0.0, 0.8, fw.x);
    alb = mix(vec3(0.85, 0.8, 0.7), a, mix(0.5, st, det));
    rough = 0.85; metal = 0.0;
    em = alb * 0.05;
    return;
  }
  if (k < 54.5) {
    // curtain wall: the tower's own glass (teal, bronze, silver, deep blue, green, gold), a
    // spandrel every storey, mullions, a pale sky-lobby band every sixteen storeys; offices
    // lit floor by floor at night. Tops are dark membrane with plant.
    if (up > 0.7) { haloRoof(fract(t * 7.0 + 0.3) * 0.36 + 0.2, f, fw, det, detB, vec3(0.5), alb, rough, metal, em); return; }
    vec3 g = t < 0.18 ? vec3(0.09, 0.19, 0.22) : t < 0.36 ? vec3(0.19, 0.15, 0.10) : t < 0.54 ? vec3(0.22, 0.24, 0.26) : t < 0.72 ? vec3(0.05, 0.10, 0.21) : t < 0.88 ? vec3(0.11, 0.18, 0.12) : vec3(0.30, 0.24, 0.12);
    float sp = hBox(fract(f.y / 3.6) * 3.6, 0.0, 0.9, fw.y);
    float mul = hBox(fract(f.x / 1.5) * 1.5, 0.0, 0.12, fw.x);
    float frame = mix(0.3, max(sp, mul), det);
    float lobby = hBox(fract(f.y / 57.6) * 57.6, 0.0, 3.6, fw.y) * detS + 0.0625 * (1.0 - detS);
    vec3 spand = g * 1.6 + vec3(0.06);
    alb = mix(g, spand, frame);
    alb = mix(alb, vec3(0.66, 0.64, 0.6), lobby);
    rough = mix(mix(0.06, 0.35, frame), 0.6, lobby); metal = mix(mix(0.75, 0.3, frame), 0.05, lobby);
    float floorL = hash12(vec2(floor(f.y / 3.6), floor(f.x / 36.0)) + t * 19.0);
    float share = 0.3 + 0.5 * fract(t * 4.3);
    float lit = mix(share, step(1.0 - share, floorL), detB);
    vec3 lamp = mix(vec3(0.92, 0.95, 1.0), vec3(1.0, 0.8, 0.56), step(0.5, fract(t * 9.7)));
    em = lamp * lit * (1.0 - frame) * (1.0 - lobby) * 0.42 + vec3(1.0, 0.85, 0.6) * lobby * 0.25;
    return;
  }
  if (k < 55.5) {
    // park ground: lawns and meadows in drifts of a few hundred metres, mown stripes on the
    // lawns, wildflowers in the meadows, the shade of the woods, winding gravel paths lit at
    // night; the drifts are what still reads from 12-40 km
    float n1 = vnoise(f * 0.0045 + t * 13.0), n2 = vnoise(f * 0.019 + 3.0), n3 = vnoise(f * 0.08 + 7.0);
    vec3 lawn = mix(vec3(0.065, 0.15, 0.04), vec3(0.13, 0.22, 0.055), n2);
    vec3 meadow = mix(vec3(0.21, 0.22, 0.08), vec3(0.31, 0.27, 0.11), mix(0.5, n3, detB));
    float mead = smoothstep(0.5, 0.62, n1);
    alb = mix(lawn, meadow, mead);
    float stripe = mix(0.5, hBox(fract(f.x / 16.0) * 16.0, 0.0, 8.0, fw.x), detB);
    alb *= 1.0 + (stripe - 0.5) * 0.18 * (1.0 - mead);
    float fh = hash12(floor(f / 1.5));
    float flower = step(0.84, fh) * mead * det;
    alb = mix(alb, fh > 0.95 ? vec3(0.62, 0.14, 0.18) : fh > 0.9 ? vec3(0.7, 0.62, 0.16) : vec3(0.48, 0.36, 0.62), flower);
    float shade = smoothstep(0.55, 0.78, vnoise(f * 0.03 + 11.0));
    alb *= 1.0 - 0.38 * shade;
    float pn = vnoise(f * 0.0035 + 21.0) - 0.5;
    float pw = 0.0055, pp = max(px * 0.0055, 0.0001);
    float path = hBox(pn, -pw, pw, pp) * (1.0 - smoothstep(4.0, 14.0, px)) + 0.03 * smoothstep(4.0, 14.0, px);
    alb = mix(alb, vec3(0.56, 0.52, 0.44), path);
    rough = 0.92; metal = 0.0;
    float lampOn = step(0.8, fract(f.x * 0.031 + f.y * 0.027));
    em = vec3(1.0, 0.78, 0.5) * path * mix(0.2, lampOn * 0.9, det) * 0.35;
    return;
  }
  if (k < 56.5) {
    // massed canopy: clumped crowns with dark gaps between them, drifts of another species
    // through the wood (blossom, copper beech, gold), relief so the wood catches the light
    float sp = floor(fract(t * 4.9) * 4.99);
    float drift = hash12(floor(f / 45.0) + t * 5.0);
    float s2 = drift > 0.82 ? floor(fract(drift * 7.3) * 4.99) : sp;
    vec3 c = haloTree(s2);
    float n = mix(0.5, vnoise(f * 0.14) * 0.65 + vnoise(f * 0.5) * 0.35, detB);
    alb = c * (0.5 + 0.95 * n);
    alb *= 0.85 + 0.3 * mix(0.5, vnoise(f * 0.012 + t * 3.0), detS);
    bump += vec2(vnoise(f * 0.14 + 3.0) - 0.5, vnoise(f * 0.14 + 8.0) - 0.5) * 1.4 * detB;
    rough = 0.9; metal = 0.0;
    em = vec3(1.0, 0.8, 0.5) * 0.004;
    return;
  }
  if (k < 59.5) return;
  if (k < 64.5) {
    // tree canopy: clumped leaves, darker in the gaps, a few lamps shining up through them
    vec3 c = haloTree(k - 60.0);
    float n = mix(0.5, vnoise(f * 0.5) * 0.6 + vnoise(f * 2.3) * 0.4, det);
    alb = c * (0.6 + 0.8 * n) * (0.85 + 0.3 * t);
    // leaves turning in the vault's air currents: gusts running across the canopy
    alb *= 1.0 + 0.12 * det * sin(uTime * 1.7 + f.x * 0.9 + f.y * 0.6 + 6.0 * n);
    rough = 0.9; metal = 0.0;
    em = vec3(1.0, 0.8, 0.5) * 0.004;
    return;
  }
  if (k < 66.5) {
    // signage and shopfront bands: colours cycling slowly between neighbours
    float h = hash12(floor(f / 8.0));
    vec3 a = h < 0.3 ? vec3(1.0, 0.35, 0.55) : h < 0.6 ? vec3(0.3, 0.9, 1.0) : h < 0.85 ? vec3(1.0, 0.78, 0.4) : vec3(0.7, 0.5, 1.0);
    alb = vec3(0.1); rough = 0.3; metal = 0.0;
    em = a * (0.9 + 0.3 * sin(uTime * 0.9 + h * 30.0));
  }
}
// The valley's own light, after the kinds: contact darkening at the foot of every wall (the
// street's far side hides the sky), and the vault's glass scattering the Sun back down as a
// sky fill, strongest on faces turned up to it. The fill scales with the sunlight reaching
// the band (sunL carries the eclipse), so the night side stays dark. Self-lit kinds are left.
void haloLight(float k, vec3 sunL, inout vec3 alb, float metal, inout vec3 em) {
  if ((k > 1.5 && k < 2.5) || (k > 3.5 && k < 4.5) || k > 65.5) return;
  float wall = 1.0 - abs(vUp);
  float foot = mix(0.5, 1.0, smoothstep(0.0, 24.0, vH));
  float ao = mix(1.0, mix(1.0, foot, wall), uDeck.z);
  alb *= ao;
  float skyF = 0.5 + 0.5 * vUp;
  em += alb * (1.0 - 0.7 * metal) * sunL * (0.016 + 0.03 * skyF) * mix(1.0, ao, 0.5) * uDeck.z;
}
`;

/** The craft material with the Halo kinds woven in (it constructs without a renderer). */
export function createHaloMaterial(opts = {}) {
  const m = createCraftMaterial(opts);
  let vs = m.vertexShader, fs = m.fragmentShader;
  const deck = opts.deck || null;
  // tolerant anchors: fail soft (the plain craft material) if the craft shader moved on
  const vAnchor = /varying vec3 vN;/, vFacAnchor = /vFac\s*=\s*aFacade;/, fMain = /void\s+main\s*\(\s*\)\s*\{/;
  const kAnchor = /craftExtraKinds\s*\(\s*k\s*,\s*f\s*,\s*fw\s*,\s*px\s*,\s*alb\s*,\s*rough\s*,\s*metal\s*,\s*em\s*\)\s*;/;
  if (!vAnchor.test(vs) || !vFacAnchor.test(vs) || !fMain.test(fs) || !kAnchor.test(fs) || !/vec3\s+sunL\b/.test(fs) || !/varying vec3 vFac;/.test(fs)) {
    console.warn('haloMaterial: craft shader hooks not found; the Halo kinds fall back to the craft palette');
    m.userData.halo = false;
    return m;
  }
  vs = 'uniform vec3 uDeck;\n' + vs.replace(vAnchor, 'varying vec3 vN;\nvarying float vUp;\nvarying float vH;').replace(vFacAnchor, (s) => `${s}
  vUp = normal.y;
  // height over the deck under this point (its sag across the ring), for the valley's light
  float dT = clamp(position.x / max(2.0 * uDeck.y, 1.0), -0.5, 0.5);
  vH = position.y + uDeck.x * (1.0 - 4.0 * dT * dT);`);
  fs = fs.replace(fMain, (s) => HALO_GLSL + '\n' + s);
  fs = fs.replace(kAnchor, (s) => `${s}\n  haloKinds(k, f, fw, px, alb, rough, metal, em, bump);\n  haloLight(k, sunL, alb, metal, em);`);
  m.vertexShader = vs; m.fragmentShader = fs;
  m.uniforms.uDeck = { value: deck ? new THREE.Vector3(deck.sag, deck.half, 1) : new THREE.Vector3(0, 1, 0) };
  m.userData.halo = true;
  return m;
}
