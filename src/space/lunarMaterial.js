import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { R_MOON } from './sim.js';

// Material for everything built on and around the Moon (Medii Landing, the Tranquillity
// Exchange and the ring districts), in metres, drawn in the km-scale orbital scene with a
// camera-relative modelViewMatrix. Unlike the generic craft material it knows where the
// Moon is: sunlight is cut at the local horizon (the terminator sweeps across the town,
// reddening as it goes), the full Earth overhead lights the night side, and the thin
// lunar air adds a faint blue sky light. It also carries the town's own surfaces: pale
// stone with windows, roof gardens, paving, courtyards, landing pads and pools.
//
// Facade kinds (aFacade.z): the craft kinds (0 glass, 1 pearl hull, 2 lantern, 3 garden,
// 4 conduit, 7 panel, 8 bronze, 9 deck, 10 dark, 11 radiator, 12 glazed roof, 13
// conservatory) plus 20 stone facade, 21 roof garden, 22 paving, 23 landing pad, 24
// courtyard, 25 tiled roof, 26 reflecting pool, 27 dressed stone wall, 28 mass-driver coil
// (facade x = metres along the guideway).

export const LK = { GLASS: 0, HULL: 1, LANTERN: 2, GARDEN: 3, CONDUIT: 4, PANEL: 7, BRONZE: 8, DECK: 9, DARK: 10, RADIATOR: 11, ROOF: 12, CONSERVATORY: 13, STONE: 20, ROOFG: 21, PAVE: 22, PAD: 23, COURT: 24, TILE: 25, POOL: 26, WALL: 27, COIL: 28,
  REGOLITH: 29, SOLAR: 30, HAZARD: 31, SIGN: 32, PAINT: 33, GROUND: 34, LIGHT: 35, FOIL: 36 };
// 29 sintered regolith (berms, bagged shielding, spoil, boulders), 30 photovoltaic cells,
// 31 hazard chevrons, 32 lit signage and concourse bands, 33 livery paint (the instance
// colour: suits, clothes, rover and tram liveries), 34 packed regolith with tyre tracks
// (aprons and haul roads), 35 lamp lenses and lit cab windows (always glowing), 36 gold
// multi-layer insulation over cryogenic tanks (crinkled facets, taped seams, beta-cloth patches).

const VERT = /* glsl */ `
attribute vec3 aFacade;
varying vec3 vFac;
varying vec3 vView;
varying vec3 vN;
varying vec3 vTint;
void main() {
  vFac = aFacade;
  vec4 lp = vec4(position, 1.0);
  vec3 ln = normal;
#ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  ln = mat3(instanceMatrix) * ln;
#endif
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
#else
  vTint = vec3(1.0);
#endif
  vec4 mv = modelViewMatrix * lp;
  vN = normalize(normalMatrix * ln);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunView;
uniform vec3 uMoonView;      // Moon centre, view space (km)
uniform vec3 uEarthView;     // Earth centre, view space (km)
uniform float uEarthLit;     // lit fraction of the Earth's disc seen from the Moon
uniform float uSunE;
uniform float uTime;
uniform vec3 uAccent;
uniform float uLit;
uniform float uScale;        // view units per facade metre (1e-3: the meshes are metres in a km scene)
varying vec3 vFac;
varying vec3 vView;
varying vec3 vN;
varying vec3 vTint;
${NOISE_GLSL}
float gridLine(float x, float p, float w, float fw) { float d = abs(fract(x / p + 0.5) - 0.5) * p; return 1.0 - smoothstep(w, w + fw, d); }
float cLine(float x, float p, float w, float fw) { float d = abs(fract(x / p + 0.5) - 0.5) * p; return clamp(1.0 - d / max(w, fw), 0.0, 1.0) * min(1.0, w / fw); }

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(-vView);
  float k = floor(vFac.z + 0.5);
  vec2 f = vFac.xy;
  vec2 fw = max(fwidth(f), vec2(1e-3));
  float px = max(fw.x, fw.y);
  float det = 1.0 - smoothstep(0.4, 1.2, px);
  float detP = 1.0 - smoothstep(0.8, 2.3, px);
  // the Moon's horizon, and the Sun reddened by the thin air as it sinks
  // the Sun's elevation above this point's own horizon: on the ground the local horizontal,
  // on the ring 380 km up a horizon depressed by 35 degrees
  vec3 pRel = vView - uMoonView;
  float rr = length(pRel);
  vec3 upV = pRel / max(rr, 1e-3);
  float mu = dot(upV, uSunView);
  float hh = rr - ${R_MOON.toFixed(1)};
  float dip = hh > 1.0 ? acos(clamp(${R_MOON.toFixed(1)} / rr, 0.0, 1.0)) : sqrt(max(2.0 * hh / ${R_MOON.toFixed(1)}, 0.0));
  float elev = asin(clamp(mu, -1.0, 1.0)) + dip;
  float sunVis = smoothstep(-0.006, 0.006, elev);
  vec3 sunCol = mix(vec3(1.0, 0.6, 0.34), vec3(1.0, 0.975, 0.94), smoothstep(0.0, 0.14, elev));
  vec3 sunL = uSunE * sunCol * sunVis;
  float night = 1.0 - smoothstep(-0.05, 0.04, elev);
  vec3 alb = vec3(0.72, 0.71, 0.68);
  float rough = 0.45, metal = 0.05;
  vec3 em = vec3(0.0);
  if (k < 0.5) {
    // glazing: 4 m bays, 3.6 m decks, rooms lit behind
    vec2 cell = floor(f / vec2(4.0, 3.6));
    float h = hash12(cell);
    float frame = max(gridLine(f.x, 4.0, 0.18, fw.x), gridLine(f.y, 3.6, 0.2, fw.y)) * det;
    alb = mix(vec3(0.05, 0.07, 0.09), vec3(0.6, 0.6, 0.58), frame);
    rough = mix(0.05, 0.4, frame); metal = mix(0.6, 0.2, frame);
    float lit = step(1.0 - uLit, h);
    vec3 lamp = mix(vec3(1.0, 0.74, 0.48), vec3(0.9, 0.92, 1.0), step(0.85, fract(h * 7.3)));
    em = lamp * mix(uLit * 0.8, lit, det) * (1.0 - frame) * 0.55 * (0.35 + 0.65 * night);
  } else if (k < 1.5) {
    // (a pearl-grey hull, not paper white: 0.72 read as blank white boxes against the deck)
    alb = vec3(0.6, 0.595, 0.575);
    vec2 pc = floor(f / vec2(12.0, 7.0));
    float h = hash12(pc + 3.0);
    alb *= mix(1.0, 0.93 + 0.1 * h, detP);
    alb *= 1.0 - 0.3 * max(gridLine(f.x, 12.0, 0.08, fw.x), gridLine(f.y, 7.0, 0.08, fw.y)) * detP;
    alb *= 1.0 - 0.14 * max(cLine(f.y, 42.0, 0.5, fw.y), cLine(f.x, 36.0, 0.4, fw.x));
    rough = 0.36 + 0.1 * h * detP;
    // a working hull: the odd panel replaced in a cooler or warmer alloy, grime streaking
    // down from the seams, stencilled bands, and portholes lit from within along some rows
    vec3 alloy = h > 0.86 ? vec3(0.84, 0.89, 1.0) : (h < 0.1 ? vec3(1.0, 0.93, 0.82) : vec3(1.0));
    alb *= mix(vec3(1.0), alloy, detP);
    float streak = vnoise(vec2(f.x * 0.45, f.y * 0.03 + h * 7.0));
    alb *= 1.0 - 0.16 * smoothstep(0.45, 0.95, streak) * detP;
    float stencil = cLine(f.y + 3.5, 42.0, 0.35, fw.y) * step(0.5, fract(f.x / 9.0)) * step(0.55, hash12(floor(f / vec2(9.0, 42.0)) + 8.0));
    alb = mix(alb, uAccent * 0.55, stencil * 0.7 * detP);
    vec2 pr = floor(f / vec2(2.4, 7.0));
    float rowLit = step(0.72, hash12(vec2(0.0, pr.y) + 21.0));
    vec2 pl = (fract(f / vec2(2.4, 7.0)) - vec2(0.5, 0.5)) * vec2(2.4, 7.0);
    float port = (1.0 - smoothstep(0.32, 0.32 + max(fw.x, fw.y), length(pl))) * rowLit;
    float portV = mix(rowLit * 0.055, port, det);
    alb = mix(alb, vec3(0.05, 0.06, 0.08), portV * 0.8);
    em += vec3(1.0, 0.8, 0.55) * portV * (0.25 + 0.75 * night) * 0.6 * step(0.3, hash12(pr + 4.0));
  } else if (k < 2.5) {
    float fin = max(gridLine(f.x, 3.0, 0.12, fw.x), gridLine(f.y, 5.0, 0.15, fw.y)) * det;
    alb = mix(vec3(0.9, 0.85, 0.75), vec3(0.5), fin);
    em = vec3(1.0, 0.8, 0.56) * (0.5 + 0.8 * night) * (1.0 - 0.7 * fin);
  } else if (k < 3.5) {
    float g = vnoise(f * 0.21) * 0.6 + vnoise(f * 1.3) * 0.4 * det;
    alb = mix(vec3(0.04, 0.1, 0.03), vec3(0.14, 0.22, 0.07), g);
    rough = 0.9;
  } else if (k < 4.5) {
    float fp = fract(f.y / 90.0 - uTime * 0.06) - 0.5;
    float flow = mix(0.3, exp(-fp * fp * 40.0), 1.0 - smoothstep(4.0, 12.0, fw.y));
    alb = vec3(0.08);
    em = uAccent * (0.5 + 1.4 * flow);
  } else if (k < 7.5) {
    alb = vec3(0.025, 0.04, 0.1); rough = 0.12; metal = 0.7;
    alb += vec3(0.2) * max(gridLine(f.x, 1.4, 0.04, fw.x), gridLine(f.y, 1.4, 0.04, fw.y)) * det;
  } else if (k < 8.5) {
    float br = vnoise(vec2(f.x * 0.2, f.y * 30.0));
    alb = vec3(0.72, 0.52, 0.3) * (0.9 + 0.2 * br * det); rough = 0.28; metal = 1.0;
  } else if (k < 9.5) {
    // deck plating: 2.4 m plates each a shade apart, tie-down points on a 3.6 m grid, painted
    // walkway margins every 24 m, and the traffic's scuffing worn darker down the middle of
    // each lane, all settling to their mean as they shrink below a pixel
    float pl = max(gridLine(f.x, 2.4, 0.03, fw.x), gridLine(f.y, 2.4, 0.03, fw.y)) * det;
    float ph = hash12(floor(f / 2.4) + 41.0);
    alb = vec3(0.5, 0.495, 0.47) * (1.0 - 0.3 * pl) * mix(1.0, 0.92 + 0.14 * ph, detP);
    vec2 td = (fract(f / 3.6) - 0.5) * 3.6;
    float tie = (1.0 - smoothstep(0.12, 0.12 + px, length(td))) * det;
    alb *= 1.0 - 0.45 * tie;
    float lane = cLine(f.x, 24.0, 0.18, fw.x);
    alb = mix(alb, vec3(0.78, 0.6, 0.12), lane * 0.75);
    float scuff = 1.0 - smoothstep(2.0, 7.0, abs(fract(f.x / 24.0) - 0.5) * 24.0);
    alb *= 1.0 - 0.12 * scuff * mix(0.6, vnoise(f * vec2(0.8, 0.12)), detP);
    rough = 0.62;
  } else if (k < 10.5) {
    // dark service metal: a 0.3 m grating or ribbing, access plates, worn bright at the edges
    float grate = max(gridLine(f.x, 0.3, 0.03, fw.x), gridLine(f.y, 0.3, 0.03, fw.y)) * (1.0 - smoothstep(0.02, 0.08, px));
    float plate = hash12(floor(f / vec2(3.0, 2.0)) + 17.0);
    alb = vec3(0.13, 0.13, 0.14) * (0.85 + 0.3 * plate * detP) * (1.0 - 0.35 * grate);
    alb += vec3(0.1, 0.09, 0.08) * max(gridLine(f.x, 3.0, 0.05, fw.x), gridLine(f.y, 2.0, 0.05, fw.y)) * det;
    rough = 0.5 - 0.15 * plate; metal = 0.5;
  } else if (k < 11.5) {
    alb = vec3(0.1, 0.09, 0.085); rough = 0.7;
    float ch = mix(0.17, gridLine(f.y, 24.0, 2.0, fw.y), 1.0 - smoothstep(4.0, 9.0, fw.y));
    em = vec3(1.0, 0.36, 0.12) * (0.1 + 0.4 * ch);
  } else if (k < 12.5) {
    // glazed roof over parkland and lit lanes
    float g = vnoise(f * 0.011) * 0.55 + vnoise(f * 0.09) * 0.45;
    vec3 under = mix(vec3(0.03, 0.075, 0.028), vec3(0.11, 0.16, 0.055), g);
    float mull = mix(0.1, max(cLine(f.x, 9.0, 0.35, fw.x), cLine(f.y, 9.0, 0.35, fw.y)), 1.0 - smoothstep(2.0, 3.6, px));
    alb = mix(under * 0.85, vec3(0.62, 0.61, 0.58), mull);
    rough = mix(0.08, 0.4, mull); metal = mix(0.45, 0.15, mull);
    em = vec3(1.0, 0.76, 0.5) * (0.03 + 0.2 * night * smoothstep(0.6, 0.9, hash12(floor(f / 22.0)))) * (1.0 - mull);
  } else if (k < 13.5) {
    float resolved = 1.0 - smoothstep(2.5, 7.0, px);
    float paths = max(cLine(f.x, 18.0, 1.1, fw.x), cLine(f.y, 24.0, 1.2, fw.y));
    float fol = mix(0.5, vnoise(f * 0.13) * 0.6 + vnoise(f * 0.65) * 0.4, 1.0 - smoothstep(0.7, 2.0, px));
    vec3 planted = mix(vec3(0.035, 0.09, 0.025), vec3(0.13, 0.22, 0.065), fol);
    vec3 under = mix(planted, vec3(0.29, 0.27, 0.21), mix(0.18, paths, resolved));
    float mull = mix(0.1, max(cLine(f.x, 6.0, 0.15, fw.x), cLine(f.y, 6.0, 0.15, fw.y)), 1.0 - smoothstep(1.4, 3.2, px));
    alb = mix(under, vec3(0.6, 0.6, 0.55), mull);
    rough = mix(0.2, 0.42, mull); metal = mix(0.2, 0.12, mull);
    em = vec3(1.0, 0.76, 0.46) * (0.02 + 0.12 * night * mix(0.18, paths, resolved)) * (1.0 - mull);
  } else if (k < 20.5) {
    // pale stone: 4 m window bays on 3.6 m storeys, a plinth course, lit rooms at night
    vec2 cell = floor(f / vec2(4.0, 3.6));
    float h = hash12(cell + 11.0);
    vec2 lc = fract(f / vec2(4.0, 3.6));
    float win = (1.0 - smoothstep(0.3, 0.3 + fw.x / 4.0, abs(lc.x - 0.5))) * (1.0 - smoothstep(0.28, 0.28 + fw.y / 3.6, abs(lc.y - 0.55)));
    // (a plinth only at a footing: walls whose facade y runs negative, up in a station's frame,
    // are storeys all the way down)
    float plinth = step(-1.5, f.y) * (1.0 - step(3.6, f.y));
    win *= 1.0 - plinth;
    float meanWin = 0.36 * (1.0 - plinth);
    float wv = mix(meanWin, win, det);
    // each 48 m of frontage its own stone: pale limestone, honey sandstone, rose granite,
    // blue-grey slate render; a darker string course every fourth storey, a cornice line
    // under the roof of each block, soot under the sills
    float bh = hash12(floor(f.x / 48.0) + vec2(3.7, floor(f.y / 57.6)));
    // (real building stone: limestone ~0.45, sandstone and granite darker; the old values near
    // 0.65 burned the town out to white speckle under a high Sun)
    vec3 stoneC = bh < 0.35 ? vec3(0.47, 0.45, 0.405) : (bh < 0.6 ? vec3(0.5, 0.415, 0.29) : (bh < 0.8 ? vec3(0.45, 0.35, 0.32) : vec3(0.37, 0.4, 0.43)));
    alb = stoneC * (0.94 + 0.08 * mix(0.5, hash12(floor(f / vec2(16.0, 14.4)) + 2.0), detP));
    float course = cLine(f.y - 0.3, 14.4, 0.28, fw.y) * (1.0 - plinth);
    alb *= 1.0 - 0.22 * course * detP;
    float soot = (1.0 - smoothstep(0.0, 0.1, lc.y)) * (1.0 - smoothstep(0.3, 0.34, abs(lc.x - 0.5))) * (1.0 - plinth);
    alb *= 1.0 - 0.18 * soot * det;
    // weathering under the thin new air: rain streaks trailing from the sills and cornices
    float streak = vnoise(vec2(f.x * 1.3, f.y * 0.08 + bh * 11.0));
    alb *= 1.0 - 0.12 * smoothstep(0.55, 0.9, streak) * detP * (1.0 - plinth);
    alb = mix(alb, vec3(0.06, 0.07, 0.08), wv * 0.9);
    alb *= 1.0 - 0.12 * plinth;
    rough = mix(0.7, 0.1, wv); metal = 0.0;
    float lit = mix(uLit, step(1.0 - uLit, h), det);
    // the rooms behind: warm lamps mostly, some cool, a few coloured by their curtains; a
    // drawn blind lights only the top of its window
    float hc = fract(h * 5.3);
    vec3 lamp = hc < 0.55 ? vec3(1.0, 0.72, 0.45) : (hc < 0.8 ? vec3(1.0, 0.86, 0.66) : (hc < 0.9 ? vec3(0.75, 0.88, 1.0) : vec3(1.0, 0.55, 0.45)));
    float blind = mix(1.0, step(0.5, lc.y) * 0.7 + 0.3, step(0.8, fract(h * 13.1)) * det);
    em = lamp * wv * lit * blind * 0.5 * (0.15 + 0.85 * night);
  } else if (k < 21.5) {
    float g = vnoise(f * 0.18) * 0.6 + vnoise(f * 0.9) * 0.4 * det;
    alb = mix(vec3(0.035, 0.085, 0.025), vec3(0.11, 0.17, 0.05), g);
    alb = mix(alb, vec3(0.5, 0.47, 0.4), max(cLine(f.x, 11.0, 0.5, fw.x), cLine(f.y, 13.0, 0.5, fw.y)) * 0.6);
    rough = 0.9;
  } else if (k < 22.5) {
    // paving: pale setts in a running bond, a darker gutter band every 20 m
    float sett = max(gridLine(f.x, 1.2, 0.03, fw.x), gridLine(f.y + 0.6 * step(0.5, fract(f.x / 2.4)), 0.8, 0.03, fw.y)) * (1.0 - smoothstep(0.02, 0.06, px));
    alb = vec3(0.3, 0.285, 0.255) * (1.0 - 0.18 * sett) * mix(1.0, 0.94 + 0.1 * vnoise(f * 0.05), 1.0 - smoothstep(3.0, 9.0, px));
    rough = 0.75;
  } else if (k < 23.5) {
    // landing pad: dark composite, a painted ring every 50 m, the central target
    float r = length(f);
    float ring = cLine(r, 50.0, 1.2, px);
    float centre = 1.0 - smoothstep(18.0, 18.0 + px, abs(r - 40.0));
    alb = vec3(0.2, 0.2, 0.21) * (0.92 + 0.08 * vnoise(f * 0.02));
    alb = mix(alb, vec3(0.75, 0.72, 0.6), max(ring * 0.7, centre * 0.6));
    rough = 0.6;
    em = vec3(1.0, 0.8, 0.5) * ring * 0.05 * night;
  } else if (k < 24.5) {
    // courtyard: lawn, a gravel walk, trees as dark crowns
    float g = vnoise(f * 0.12);
    alb = mix(vec3(0.04, 0.09, 0.03), vec3(0.08, 0.14, 0.045), g);
    vec2 tc = fract(f / 9.0) - 0.5;
    float tree = (1.0 - smoothstep(0.28, 0.28 + fw.x / 9.0, length(tc))) * step(0.45, hash12(floor(f / 9.0))) * det;
    alb = mix(alb, vec3(0.02, 0.05, 0.018), mix(0.25, tree, det));
    rough = 0.9;
  } else if (k < 25.5) {
    // tiled roof, each roof its own (the builder offsets facade x by 1000 m a roof): terracotta,
    // slate, bronze-grey shingle or verdigris copper, in courses, each tile a shade apart, the
    // lower courses darkened by run-off and lichen toward the eaves
    float rid = hash12(vec2(floor((f.x + 500.0) / 1000.0), 3.0));
    vec3 tileC = rid < 0.4 ? vec3(0.34, 0.16, 0.1) : (rid < 0.65 ? vec3(0.14, 0.15, 0.17) : (rid < 0.85 ? vec3(0.3, 0.25, 0.2) : vec3(0.16, 0.29, 0.25)));
    float course = gridLine(f.y, 0.9, 0.05, fw.y) * det;
    float tileJ = hash12(floor(f / vec2(0.45, 0.9)) + 5.0);
    alb = tileC * (0.9 + 0.12 * mix(0.5, hash12(floor(f / vec2(6.0, 0.9))), detP)) * (1.0 - 0.3 * course) * mix(1.0, 0.88 + 0.24 * tileJ, det);
    alb *= 1.0 - 0.16 * (1.0 - smoothstep(0.0, 2.8, f.y));
    rough = rid < 0.4 ? 0.7 : (rid < 0.65 ? 0.42 : 0.5); metal = rid > 0.85 ? 0.35 : 0.05;
  } else if (k < 26.5) {
    // reflecting pool: dark water mirroring the sky
    alb = vec3(0.01, 0.02, 0.025); rough = 0.05; metal = 0.0;
  } else if (k < 27.5) {
    // dressed stone: ashlar courses of 0.6 m, blocks 1.4 m, weathered a shade apart
    float crs = gridLine(f.y, 0.6, 0.03, fw.y) * det;
    float jnt = gridLine(f.x + 0.7 * step(0.5, fract(f.y / 1.2)), 1.4, 0.03, fw.x) * det;
    alb = vec3(0.5, 0.48, 0.43) * (0.93 + 0.1 * mix(0.5, hash12(floor(f / vec2(1.4, 0.6))), det)) * (1.0 - 0.2 * max(crs, jnt));
    alb *= mix(1.0, 0.95 + 0.08 * vnoise(f * 0.03), 1.0 - smoothstep(6.0, 20.0, px));
    rough = 0.8;
  } else if (k < 28.5) {
    // mass-driver coil: bronze windings glowing in a slow wave that runs out along the
    // guideway (2.4 km long, every 5 s), and a brighter launch pulse that rides with the sled:
    // a minute's cycle, ten seconds loading at the breech, then 40 m/s^2 (4 g) down the 36 km
    // to 1.7 km/s at the gate (lunarTraffic.js driverS is the same law); smooth in time
    float s = vFac.x;
    float wave = 0.5 + 0.5 * sin(s / 380.0 - uTime * 1.25);
    float tau = mod(uTime, 60.0) - 10.0;
    float front = tau > 0.0 ? 20.0 * tau * tau : -1.0e5;
    float dxl = (s - front) / 700.0;
    float launch = exp(-dxl * dxl);
    alb = vec3(0.5, 0.36, 0.22); rough = 0.35; metal = 0.9;
    em = uAccent * (0.3 + 1.5 * wave * wave + 5.0 * launch);
  } else if (k < 29.5) {
    // sintered regolith: bagged courses 0.5 m high, blocks 1.1 m, a grey-brown mottle that
    // carries on as broad patches when the courses no longer resolve
    float crs = gridLine(f.y, 0.5, 0.03, fw.y) * det;
    float jnt = gridLine(f.x + 0.55 * step(0.5, fract(f.y)), 1.1, 0.04, fw.x) * det;
    float m = vnoise(f * 0.07) * 0.6 + vnoise(f * 0.9) * 0.4 * detP;
    alb = mix(vec3(0.3, 0.285, 0.26), vec3(0.42, 0.4, 0.36), m) * (1.0 - 0.22 * max(crs, jnt)) * vTint;
    rough = 0.95;
  } else if (k < 30.5) {
    // photovoltaic cells: 0.16 m cells in 1 x 2 m modules on a silver frame, deep blue glass
    float cell = max(gridLine(f.x, 0.16, 0.006, fw.x), gridLine(f.y, 0.16, 0.006, fw.y)) * (1.0 - smoothstep(0.004, 0.012, px));
    float mod1 = max(gridLine(f.x, 1.0, 0.025, fw.x), gridLine(f.y, 2.0, 0.025, fw.y)) * (1.0 - smoothstep(0.02, 0.06, px));
    alb = mix(vec3(0.02, 0.035, 0.09), vec3(0.08, 0.1, 0.16), cell * 0.7);
    alb = mix(alb, vec3(0.7, 0.72, 0.74), mod1 * 0.85 + smoothstep(0.02, 0.2, px) * 0.12);
    rough = mix(0.08, 0.4, mod1); metal = mix(0.35, 0.8, mod1);
  } else if (k < 31.5) {
    // hazard chevrons: yellow and near-black bands at 45 degrees, 0.6 m apart
    float t = fract((f.x + f.y) / 1.2);
    float band = smoothstep(0.5 - fw.x, 0.5 + fw.x, t) * (1.0 - smoothstep(1.0 - fw.x, 1.0, t));
    band = mix(0.5, band, 1.0 - smoothstep(0.15, 0.4, px));
    alb = mix(vec3(0.85, 0.62, 0.08), vec3(0.05, 0.05, 0.05), band); rough = 0.5;
  } else if (k < 32.5) {
    // lit signage and concourse bands: blocks of glyphs 0.6 x 0.8 m on a dark panel,
    // steady, brighter by night; the colour alternates between the accent and warm white
    vec2 gc = floor(f / vec2(0.6, 0.8));
    float g = step(0.42, hash12(gc + 5.0)) * (1.0 - step(0.9, fract(f.y / 0.8)));
    float word = step(0.25, hash12(floor(f / vec2(4.2, 0.8)) + 1.0));
    float glyph = mix(0.45, g * word, 1.0 - smoothstep(0.2, 0.5, px));
    vec3 tone = mix(uAccent, vec3(1.0, 0.82, 0.55), step(0.5, hash12(floor(f / vec2(12.0, 2.4)))));
    alb = vec3(0.05); rough = 0.3;
    em = tone * glyph * (0.35 + 0.65 * night) * 1.3;
  } else if (k < 33.5) {
    // livery paint: the instance colour, panel seams every 1.5 m, a lighter trim band
    float seam = max(gridLine(f.x, 1.5, 0.02, fw.x), gridLine(f.y, 1.5, 0.02, fw.y)) * (1.0 - smoothstep(0.02, 0.08, px));
    alb = vTint * (1.0 - 0.25 * seam);
    rough = 0.42; metal = 0.1;
  } else if (k < 34.5) {
    // packed regolith: tyre tracks 3.2 m apart along the facade x axis, ruts and grit
    float ruts = cLine(f.y, 3.2, 0.35, fw.y) * (1.0 - smoothstep(0.3, 1.2, px));
    float grit = vnoise(f * 0.35) * 0.5 + vnoise(f * 3.0) * 0.5 * detP;
    alb = mix(vec3(0.24, 0.23, 0.21), vec3(0.34, 0.325, 0.3), grit) * (1.0 - 0.3 * ruts);
    rough = 0.97;
  } else if (k > 35.5) {
    // multi-layer insulation: gold-coated film in blankets ~2 x 3 m, crinkled into facets that
    // each catch the Sun at their own angle (the normal tilted by a smooth noise of the
    // blanket, settling to a rougher, flatter gold where the facets no longer resolve), dark
    // taped seams, and the odd white beta-cloth patch over a fitting
    vec2 bl = floor(f / vec2(2.0, 3.0));
    float hb = hash12(bl + 31.0);
    float cr = detP;
    vec3 tilt = vec3(vnoise(f * 1.7 + hb * 9.0), vnoise(f * 1.7 + 17.0), vnoise(f * 4.3 + 5.0)) - 0.5;
    N = normalize(N + tilt * 0.7 * cr);
    float seam = max(gridLine(f.x, 2.0, 0.04, fw.x), gridLine(f.y, 3.0, 0.04, fw.y)) * det;
    alb = mix(vec3(0.78, 0.56, 0.2), vec3(0.62, 0.44, 0.16), hb) * (1.0 - 0.45 * seam);
    float patchW = step(0.93, hb);
    alb = mix(alb, vec3(0.8, 0.79, 0.75), patchW);
    rough = mix(mix(0.36, 0.18, cr), 0.8, patchW); metal = mix(1.0, 0.0, patchW);
  } else {
    // lamp lenses and lit cab glazing: a steady warm glow, stronger by night
    alb = vec3(0.3); rough = 0.2;
    em = vTint * vec3(1.0, 0.86, 0.66) * (0.5 + 1.1 * night);
  }
  // light: the Sun (to the Moon's horizon), the Earth, the lunar sky
  vec3 toE = uEarthView - vView;
  float dE = length(toE);
  vec3 eDir = toE / max(dE, 1.0);
  vec3 earthL = uSunE * vec3(0.55, 0.7, 1.0) * 2.4e-3 * uEarthLit * smoothstep(-0.05, 0.1, dot(upV, eDir));
  vec3 skyL = uSunE * vec3(0.03, 0.05, 0.1) * smoothstep(-0.1, 0.3, mu) * (1.0 - smoothstep(20.0, 80.0, hh));
  // moonshine: the lit Moon below fills the undersides and the shade (albedo ~0.13, the disc
  // filling (R/r)^2 of the view straight down; from the ground this is the bounce off the
  // sunlit land round a building). The lit share of the disc under an orbiter follows the Sun's
  // height over the point beneath it, softened by how much of the globe it sees.
  float Fm = ${R_MOON.toFixed(1)} * ${R_MOON.toFixed(1)} / max(rr * rr, 1.0);
  float litDisc = clamp(mu + 0.3 * (1.0 - Fm), 0.0, 1.0);
  float faceDown = clamp(0.5 - 0.5 * dot(N, upV), 0.0, 1.0);
  vec3 moonL = uSunE * vec3(0.105, 0.13, 0.115) * Fm * litDisc * mix(faceDown, faceDown * faceDown, 1.0 - Fm) * 0.9;
  // contact darkening: a wall darkens toward its foot (facade y is height above the footing
  // for stone, dressed stone and sintered regolith), where the ground hides half the sky
  float wallK = 1.0 - abs(dot(N, upV));
  float footAO = (k > 19.5 && k < 20.5) || (k > 26.5 && k < 27.5) || (k > 28.5 && k < 29.5) ? 1.0 - 0.32 * step(-1.5, f.y) * exp(-max(f.y, 0.0) / 1.6) * wallK : 1.0;
  alb *= footAO;
  float ndl = max(dot(N, uSunView), 0.0);
  vec3 H = normalize(V + uSunView);
  float sp = pow(max(dot(N, H), 0.0), mix(80.0, 8.0, rough)) * mix(0.6, 0.15, rough);
  vec3 F0 = mix(vec3(0.04), alb, metal);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = alb * (1.0 - metal * 0.8) / 3.14159 * (sunL * ndl + earthL * max(dot(N, eDir), 0.0) + skyL * (0.55 + 0.45 * max(dot(N, upV), 0.0)) + moonL * footAO);
  col += min((F0 + (1.0 - F0) * fres * 0.3) * sp * sunL * ndl, sunL * 0.5);
  // glossy surfaces mirror the sky: dark blue by day, black at night
  col += (F0 + (1.0 - F0) * fres) * (1.0 - rough) * skyL * 0.6;
  col += alb * 0.002 + em;
  gl_FragColor = vec4(col, 1.0);
}
`;

const _m = new THREE.Matrix4();

export function createLunarMaterial({ accent = [0.6, 0.85, 1.0], lit = 0.55, side = THREE.FrontSide } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uSunE: U.uSunIlluminance,
      uSunView: { value: new THREE.Vector3(1, 0, 0) },
      uMoonView: { value: new THREE.Vector3() },
      uEarthView: { value: new THREE.Vector3() },
      uEarthLit: LUNAR_FRAME.earthLit,
      uTime: { value: 0 }, uAccent: { value: new THREE.Color(...accent) }, uLit: { value: lit },
      uScale: { value: 1e-3 },
    },
    side,
  });
}

/** Frame-wide values set once per frame by the Moon (sun direction, Moon centre, time). */
export const LUNAR_FRAME = { sunDir: new THREE.Vector3(1, 0, 0), moonPos: new THREE.Vector3(), time: 0, earthLit: { value: 0.5 } };

/** A lunar-material mesh in metres, scaled into km. */
export function lunarMesh(geo, opts = {}, mat = null) {
  const m = mat || createLunarMaterial(opts);
  return bindLunar(new THREE.Mesh(geo, m), m);
}

/**
 * An instanced lunar-material mesh (instance matrices in metres, in the parent's frame; the
 * mesh itself scaled into km). `tint` gives it an instance colour attribute (livery paint,
 * regolith tone, lamp colour), white until set.
 */
export function lunarInstanced(geo, count, opts = {}, mat = null, { tint = false } = {}) {
  const m = mat || createLunarMaterial(opts);
  const mesh = new THREE.InstancedMesh(geo, m, Math.max(1, count));
  mesh.count = count;
  if (tint) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 3).fill(1), 3);
  }
  return bindLunar(mesh, m);
}

function bindLunar(mesh, m) {
  mesh.scale.setScalar(0.001);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.onBeforeRender = (r, s, cam) => {
    const u = m.uniforms;
    _m.copy(cam.matrixWorldInverse);
    u.uSunView.value.copy(LUNAR_FRAME.sunDir).transformDirection(_m);
    u.uMoonView.value.copy(LUNAR_FRAME.moonPos).applyMatrix4(_m);
    u.uEarthView.value.set(0, 0, 0).applyMatrix4(_m);
    u.uTime.value = LUNAR_FRAME.time;
    m.uniformsNeedUpdate = true;
  };
  return mesh;
}
