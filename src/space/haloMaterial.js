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

export const HK = {
  FACADE: 40,          // 40..45: stone / render facades, one palette per district variant
  ROOFGARDEN: 46,
  TILE: 47,            // pitched tiled roofs
  WATER: 48,
  STREET: 50,
  STONE: 51,           // plazas, quays, terrace slabs, cliff piers
  CROPS: 52,
  AWNING: 53,
  TREE: 60,            // 60..64: canopy species
  NEON: 66,            // signage and shopfront light bands
};
export const facadeKind = (palette) => HK.FACADE + (((palette % 6) + 6) % 6);
export const treeKind = (species) => HK.TREE + (((species % 5) + 5) % 5);

const HALO_GLSL = /* glsl */ `
varying float vUp;
vec3 haloPalette(float p, float h) {
  vec3 a = vec3(0.78, 0.72, 0.62), b = vec3(0.70, 0.57, 0.44);             // limestone, sandstone
  if (p > 0.5 && p < 1.5) { a = vec3(0.66, 0.42, 0.30); b = vec3(0.76, 0.58, 0.40); }   // terracotta, ochre
  else if (p > 1.5 && p < 2.5) { a = vec3(0.86, 0.85, 0.82); b = vec3(0.60, 0.65, 0.70); }  // white render, slate blue
  else if (p > 2.5 && p < 3.5) { a = vec3(0.45, 0.33, 0.27); b = vec3(0.56, 0.52, 0.47); }  // brick, concrete
  else if (p > 3.5 && p < 4.5) { a = vec3(0.60, 0.70, 0.62); b = vec3(0.82, 0.79, 0.68); }  // sage ceramic, cream
  else if (p > 4.5) { a = vec3(0.82, 0.62, 0.54); b = vec3(0.55, 0.60, 0.73); }             // rose, lavender grey
  return mix(a, b, h);
}
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
void haloKinds(float k, vec2 f, vec2 fw, float px, inout vec3 alb, inout float rough, inout float metal, inout vec3 em, inout vec2 bump) {
  if (k < 39.5) return;
  float det = 1.0 - smoothstep(0.35, 1.1, px);          // metre-scale detail
  float detB = 1.0 - smoothstep(2.0, 6.0, px);          // building-scale detail
  float up = vUp;
  if (k < 45.5) {
    float pal = k - 40.0;
    if (up > 0.7) {
      // roofscape: warm membrane, plant rooms, sedum patches, skylights lit from below
      vec2 rc = floor(f / 11.0);
      float h = hash12(rc + pal * 7.0);
      alb = mix(vec3(0.40, 0.39, 0.36), vec3(0.50, 0.47, 0.42), mix(0.5, vnoise(f * 0.09), detB));
      float sedum = step(0.62, h) * detB;
      alb = mix(alb, vec3(0.12, 0.2, 0.07), sedum * 0.85);
      float plant = step(0.9, h) * detB;
      alb = mix(alb, vec3(0.24, 0.24, 0.25), plant);
      float sky = step(h, 0.1) * detB;
      alb = mix(alb, vec3(0.06, 0.08, 0.1), sky);
      em = vec3(1.0, 0.8, 0.55) * mix(0.012, sky * 0.35 + sedum * 0.02, detB);
      rough = mix(0.75, 0.2, sky); metal = mix(0.05, 0.4, sky + plant * 0.5);
      alb *= 1.0 - 0.25 * max(hBox(fract(f.x / 11.0) * 11.0, 0.0, 0.25, fw.x), hBox(fract(f.y / 11.0) * 11.0, 0.0, 0.25, fw.y)) * det;
      return;
    }
    if (up < -0.7) { alb = vec3(0.16, 0.15, 0.14); rough = 0.8; em = vec3(1.0, 0.75, 0.5) * 0.05; return; }
    // facade: 3 m bays and 3.6 m storeys; stone piers and spandrels, deep-set windows with
    // rooms lit behind them; a cornice every fourth storey; each building a shade of its palette
    vec2 bc = floor(f / vec2(42.0, 28.8));
    float hb = hash12(bc + pal * 13.0);
    vec3 stone = haloPalette(pal, hb);
    stone *= 1.0 - 0.1 * smoothstep(0.5, 0.9, vnoise(vec2(f.x * 0.6, f.y * 0.04) + hb * 17.0)) * detB;     // rain-streak weathering
    vec2 wc = vec2(fract(f.x / 3.0) * 3.0, fract(f.y / 3.6) * 3.6);
    float wx = hBox(wc.x, 0.55, 2.45, fw.x), wy = hBox(wc.y, 0.85, 3.1, fw.y);
    float win = mix(0.4, wx * wy, det);                   // (0.4: the windows' mean coverage)
    float cornice = min(1.0, hBox(fract(f.y / 14.4) * 14.4, 0.0, 0.7, fw.y) * 1.0) * detB;
    win *= 1.0 - cornice;
    vec3 glass = mix(vec3(0.05, 0.07, 0.09), vec3(0.14, 0.16, 0.17), hb);
    alb = mix(stone * (1.0 - 0.12 * cornice), glass, win);
    rough = mix(0.72, 0.08, win); metal = mix(0.02, 0.5, win);
    // relief: the reveal round each window (only while resolved)
    bump.x += (wc.x < 1.5 ? -1.0 : 1.0) * (1.0 - wx) * wy * 0.5 * det;
    bump.y += (wc.y < 2.0 ? -1.0 : 1.0) * (1.0 - wy) * wx * 0.4 * det;
    // lit rooms: warm or cool by household, whole floors dark in some buildings, the mean kept
    vec2 room = floor(f / vec2(3.0, 3.6));
    float hr = hash12(room + 31.0);
    float fl = 0.35 + 0.65 * hash12(vec2(bc.x, room.y) + 5.0);
    float lit = mix(0.42, step(1.0 - 0.62 * fl, hr), det);   // (0.42: 0.62 x the mean floor factor)
    vec3 lamp = mix(vec3(1.0, 0.72, 0.44), vec3(0.85, 0.9, 1.0), step(0.82, fract(hr * 9.1)));
    lamp = mix(lamp, vec3(1.0, 0.55, 0.35), step(0.95, fract(hr * 5.3)));
    em = lamp * lit * win * 0.6;
    return;
  }
  if (k < 46.5) {
    // roof garden: lawns and beds, gravel walks, a pool, pergola lamps at dusk
    vec2 c = floor(f / 9.0);
    float h = hash12(c + 3.0);
    float g = mix(0.5, vnoise(f * 0.23) * 0.6 + vnoise(f * 1.1) * 0.4, det);
    alb = mix(vec3(0.06, 0.15, 0.04), vec3(0.19, 0.3, 0.08), g);
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
    // tiled pitched roofs: courses, a hue per roof, moss in the valleys, solar slates on some
    vec2 rc = floor(f / 24.0);
    float h = hash12(rc + 9.0);
    alb = mix(vec3(0.46, 0.2, 0.12), vec3(0.62, 0.36, 0.2), h);
    alb = mix(alb, vec3(0.3, 0.3, 0.32), step(0.8, h));
    float course = hBox(fract(f.y / 0.45) * 0.45, 0.0, 0.08, fw.y) * det;
    alb *= 1.0 - 0.3 * course;
    alb *= 0.9 + 0.2 * mix(0.5, vnoise(f * 0.4), detB);
    float solar = step(0.88, hash12(rc + 41.0)) * detB;
    alb = mix(alb, vec3(0.03, 0.05, 0.12), solar);
    rough = mix(0.7, 0.15, solar); metal = mix(0.0, 0.6, solar);
    return;
  }
  if (k < 48.5) {
    if (up > 0.5) {
      // open water: wind ripples running across it, deep teal, shimmering lamp reflections
      float t = uTime;
      float r1 = sin(f.x * 0.31 + t * 1.4 + vnoise(f * 0.02) * 6.0);
      float r2 = sin(f.y * 0.23 - t * 1.1 + vnoise(f * 0.017 + 4.0) * 6.0);
      float dw = 1.0 - smoothstep(0.08, 0.5, px);
      bump += vec2(r1, r2) * 0.07 * dw + vec2(vnoise(f * 0.05 + t * 0.2) - 0.5, vnoise(f * 0.05 - t * 0.17 + 9.0) - 0.5) * 0.12 * detB;
      float depth = vnoise(f * 0.006);
      alb = mix(vec3(0.012, 0.04, 0.05), vec3(0.03, 0.09, 0.085), depth);
      rough = 0.03; metal = 0.0;
      float sparkle = step(0.992, hash12(floor(f / 2.5) + floor(t * 3.0))) * det;
      em = vec3(0.01, 0.028, 0.03) + vec3(1.0, 0.74, 0.45) * mix(0.03, sparkle * 1.5, det) * smoothstep(0.3, 0.8, vnoise(f * 0.012 + 2.0));
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
    // streets: granite setts and pavements, lane marks, tram grooves, pools of lamp light
    float h = hash12(floor(f / 1.2));
    alb = vec3(0.2, 0.2, 0.21) * (0.9 + 0.2 * mix(0.5, h, det));
    float lane = hBox(fract(f.x / 25.0) * 25.0, 12.2, 12.8, fw.x) * hBox(fract(f.y / 6.0) * 6.0, 0.0, 3.0, fw.y);
    float lane2 = hBox(fract(f.y / 25.0) * 25.0, 12.2, 12.8, fw.y) * hBox(fract(f.x / 6.0) * 6.0, 0.0, 3.0, fw.x);
    alb = mix(alb, vec3(0.62, 0.6, 0.5), max(lane, lane2) * mix(0.0, 1.0, det) + 0.03 * (1.0 - det));
    vec2 lp = (fract(f / 30.0) - 0.5) * 30.0;
    float pool = exp(-dot(lp, lp) * 0.012);
    em = vec3(1.0, 0.7, 0.4) * mix(0.09, pool * 0.9, detB) * 0.25;
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
    alb *= 1.0 - 0.08 * vnoise(f * 0.05) * detB;
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
  if (k < 59.5) return;
  if (k < 64.5) {
    // tree canopy: clumped leaves, darker in the gaps, a few lamps shining up through them
    vec3 c = haloTree(k - 60.0);
    float n = mix(0.5, vnoise(f * 0.5) * 0.6 + vnoise(f * 2.3) * 0.4, det);
    alb = c * (0.6 + 0.8 * n);
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
`;

/** The craft material with the Halo kinds woven in (it constructs without a renderer). */
export function createHaloMaterial(opts) {
  const m = createCraftMaterial(opts);
  let vs = m.vertexShader, fs = m.fragmentShader;
  vs = vs.replace('varying vec3 vN;', 'varying vec3 vN;\nvarying float vUp;').replace('vFac = aFacade;', 'vFac = aFacade;\n  vUp = normal.y;');
  fs = fs.replace('void main() {', HALO_GLSL + '\nvoid main() {');
  fs = fs.replace('craftExtraKinds(k, f, fw, px, alb, rough, metal, em);', 'craftExtraKinds(k, f, fw, px, alb, rough, metal, em);\n  haloKinds(k, f, fw, px, alb, rough, metal, em, bump);');
  if (!vs.includes('vUp = normal.y') || !fs.includes('haloKinds(k, f, fw')) throw new Error('haloMaterial: craft shader hooks not found');
  m.vertexShader = vs; m.fragmentShader = fs;
  m.userData.halo = true;
  return m;
}
