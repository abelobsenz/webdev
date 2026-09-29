// The port's civic finishes, as GLSL (spliced by portMaterial.js). Kinds 30..39 (the plain and
// dressed materials fall back to pearl plate for them).
// Every finish is balanced for the port's framing, 1 - 5 km off (2 - 10 m to a pixel): the
// albedos sit well below the pearl hulls' (a sunlit 0.45 deck read as blown white paper), and
// each has a rhythm at 12 - 40 m that survives at that range, with the fine work (joints,
// setts, panes) fading to its mean as it goes subpixel.
//   30 PAVING   a civic floor: 36 m bays of granite in three tones framed by 1.6 m basalt
//               bands, a 12 m inlay grid of darker setts, a lit brass strip along each band
//               (the concourse lines glow at night), worn paler along the walked lines
//   31 LAWN     mown grass in 8 m stripes, clover-dark where it is walked
//   32 WATER    a still reflecting pool: dark, glossy, faint ripples, lit from below at night
//   33 CANOPY   ETFE cushions in a 6 m diamond net on bronze, 24 m bays with gutters between,
//               glowing warm on the night side
//   34 STONE    ashlar cladding: 0.9 m courses, pilasters every 7.2 m, a string course every
//               7.2 m up, weathered streaks
//   35 BEDS     shrub beds and tree crowns: clumped foliage, a few flowering, soil between
//   36 GLASSHOUSE  garden vaults: clear panes on bronze glazing bars, ribs every 18 m that read
//               from far off, the glass mirroring a grey-blue sky over the dim planting seen
//               through it, vents open in some bays
//   37 HALL     concourse vaults and enclosed walks: the same glazing over a lit public floor,
//               warm and busy after dark, bright bands where the lamp rows run
//   38 GALLERY  the Harbour's arm galleries and trunks: plate families in three tones, ribbon
//               windows in pairs round the tube, frame bands, soot streaks along it
//   39 ROOF     pavilion and plinth roofs: dark standing-seam zinc in 6 m sheets, rooflights
//               in 12 m bays, a pale parapet line
// Non-port kinds on a port mesh (pearl hull, decks, bronze) are compressed toward uPortTrim at
// their bright end only, so white plate settles to a lit off-white and darks are left alone.
// No derivatives, texture reads, loops or pow() here; every literal a float.

export const PK = { PAVING: 30, LAWN: 31, WATER: 32, CANOPY: 33, STONE: 34, BEDS: 35, GLASSHOUSE: 36, HALL: 37, GALLERY: 38, ROOF: 39 };

export const PORT_GLSL = /* glsl */ `
uniform float uPortTrim;
void portKinds(float k, vec2 f, vec2 fw, float px, inout vec3 alb, inout float rough, inout float metal, inout vec3 em, inout vec2 bump) {
  if (k > 39.5) return;
  if (k < 29.5) {
    // pearl plate, decks and fittings on a port mesh: compress the whites only
    float lum = max(alb.r, max(alb.g, alb.b));
    alb *= mix(1.0, uPortTrim, smoothstep(0.3, 0.75, lum));
    return;
  }
  float det = 1.0 - smoothstep(0.25, 0.8, px);
  float detB = 1.0 - smoothstep(1.2, 4.0, px);
  float farK = 1.0 - smoothstep(6.0, 18.0, px);
  if (k < 30.5) {
    // setts: 1.2 x 0.6 m in running bond, each a shade apart (subpixel beyond a few hundred m)
    float row = floor(f.y / 0.6);
    vec2 sc = floor(vec2(f.x / 1.2 + 0.5 * mod(row, 2.0), row));
    float h = hash12(sc + 7.0);
    float joint = max(gridLine(f.x + 0.6 * mod(row, 2.0), 1.2, 0.02, fw.x), gridLine(f.y, 0.6, 0.02, fw.y)) * det;
    // 36 m bays, each laid in one of three granites (warm, grey, a darker blue-grey)
    vec2 bay = floor(f / 36.0);
    float hb = hash12(bay + 3.0);
    vec3 warm = vec3(0.34, 0.31, 0.27);
    vec3 grey = vec3(0.27, 0.27, 0.265);
    vec3 blue = vec3(0.2, 0.21, 0.225);
    vec3 base = hb < 0.45 ? warm : (hb < 0.8 ? grey : blue);
    base = mix(vec3(0.28, 0.27, 0.255), base, farK);
    base *= mix(1.0, 0.9 + 0.2 * h, det);
    base *= 1.0 - 0.28 * joint;
    // the 12 m inlay grid inside each bay: a darker course of setts 0.9 m wide
    float inlay = max(cLine(f.x, 12.0, 0.45, fw.x), cLine(f.y, 12.0, 0.45, fw.y));
    base = mix(base, base * 0.62, inlay * 0.8);
    // the basalt bands that frame each bay, 1.6 m wide, a 0.3 m brass strip down the middle
    float band = max(cLine(f.x, 36.0, 0.8, fw.x), cLine(f.y, 36.0, 0.8, fw.y));
    float strip = max(cLine(f.x, 36.0, 0.15, fw.x), cLine(f.y, 36.0, 0.15, fw.y));
    alb = mix(base, vec3(0.085, 0.085, 0.095), band * 0.9);
    alb = mix(alb, vec3(0.5, 0.38, 0.22), strip * 0.6);
    // wear and grime at the scale of a crowd: paler where it is walked, darker at the margins
    float wear = vnoise(f * 0.021 + 5.0) * 0.6 + vnoise(f * 0.09) * 0.4;
    alb *= 0.88 + 0.2 * wear;
    rough = 0.74 - 0.14 * band - 0.3 * strip;
    metal = 0.02 + 0.6 * strip;
    // the brass strips carry a lit line (the concourse's wayfinding), brighter at each crossing;
    // path lights at the 12 m inlay crossings, their mean kept when subpixel
    vec2 lc = (fract(f / 12.0 + 0.5) - 0.5) * 12.0;
    float lamp = 1.0 - smoothstep(0.35, 0.35 + max(fw.x, fw.y), length(lc));
    vec2 xc = (fract(f / 36.0 + 0.5) - 0.5) * 36.0;
    float node = 1.0 - smoothstep(1.2, 1.2 + max(fw.x, fw.y), length(xc));
    em = vec3(1.0, 0.8, 0.55) * (mix(0.0027, lamp, detB) * 1.2 + strip * 0.05 + node * 0.12);
  } else if (k < 31.5) {
    float stripe = mix(0.5, step(0.5, fract(f.x / 8.0)), detB);
    float g = mix(0.5, vnoise(f * 0.8) * 0.6 + vnoise(f * 3.1) * 0.4, det);
    float clump = vnoise(f * 0.05 + 11.0);
    alb = mix(vec3(0.05, 0.095, 0.032), vec3(0.1, 0.16, 0.052), 0.35 * stripe + 0.4 * g + 0.25 * clump);
    rough = 0.95; metal = 0.0;
    bump += (vec2(vnoise(f * 2.3), vnoise(f * 2.3 + 4.0)) - 0.5) * 0.4 * det;
  } else if (k < 32.5) {
    float t = uTime * 0.4;
    vec2 rip = vec2(sin(f.x * 0.7 + t) + 0.6 * sin(f.x * 0.23 - f.y * 0.31 + t * 0.7), sin(f.y * 0.55 - t * 0.8) + 0.5 * sin((f.x + f.y) * 0.19 + t));
    alb = vec3(0.012, 0.03, 0.04);
    rough = 0.04; metal = 0.75;
    bump += rip * 0.035 * detB;
    // coping lights along the pool's floor, a teal glow that reads only when the Sun is away
    em = vec3(0.12, 0.45, 0.5) * 0.025;
  } else if (k < 33.5) {
    // ETFE cushions on a diamond net, 24 m bays divided by bronze gutters
    vec2 d = vec2(f.x + f.y, f.x - f.y) * 0.7071;
    vec2 q = fract(d / 6.0) - 0.5;
    float net = max(gridLine(d.x, 6.0, 0.12, fw.x), gridLine(d.y, 6.0, 0.12, fw.y)) * mix(0.25, 1.0, det);
    float pillow = mix(0.6, 1.0 - 2.0 * max(abs(q.x), abs(q.y)), det);
    float gutter = max(cLine(f.x, 24.0, 0.7, fw.x), cLine(f.y, 24.0, 0.7, fw.y));
    float hb = hash12(floor(f / 24.0) + 5.0);
    vec3 film = mix(vec3(0.36, 0.38, 0.39), vec3(0.42, 0.41, 0.37), hb) * (0.82 + 0.18 * pillow);
    alb = mix(film, vec3(0.16, 0.16, 0.17), net);
    alb = mix(alb, vec3(0.42, 0.31, 0.18), gutter * 0.85);
    rough = mix(0.2, 0.45, max(net, gutter)); metal = mix(0.12, 0.65, max(net, gutter));
    bump += q * (1.0 - net) * 0.8 * det;
    em = vec3(1.0, 0.78, 0.52) * (0.05 + 0.03 * hb) * (1.0 - net) * (1.0 - gutter) * (0.7 + 0.3 * pillow);
  } else if (k < 34.5) {
    // ashlar: 0.9 m courses of 1.8 m blocks, pilasters every 7.2 m standing proud (lit edge,
    // shaded recess between), a string course every 7.2 m up, sun-streaked
    float row = floor(f.y / 0.9);
    float hr = hash12(vec2(row, 3.0));
    vec2 bc = vec2(floor(f.x / 1.8 + hr), row);
    float h = hash12(bc + 23.0);
    vec3 base = vec3(0.35, 0.325, 0.29) * mix(1.0, 0.9 + 0.18 * h, det);
    float joint = max(gridLine(f.x / 1.8 + hr, 1.0, 0.012, fw.x / 1.8), gridLine(f.y, 0.9, 0.015, fw.y)) * det;
    base *= 1.0 - 0.3 * joint;
    float pil = cLine(f.x, 7.2, 0.9, fw.x);
    float recess = cLine(f.x + 3.6, 7.2, 2.2, fw.x);
    base *= 1.0 + 0.14 * pil - 0.2 * recess;
    float course = cLine(f.y, 7.2, 0.35, fw.y);
    base *= 1.0 - 0.34 * course;
    float lot = hash12(floor(f / vec2(28.8, 14.4)) + 41.0);
    base *= mix(1.0, 0.9 + 0.18 * lot, farK);
    float streak = smoothstep(0.55, 0.9, vnoise(vec2(f.x * 0.25, f.y * 0.018) + 2.0));
    alb = base * (1.0 - 0.2 * streak * detB);
    rough = 0.7; metal = 0.02;
    bump.y += course * 0.4 * detB;
    bump.x += (cLine(f.x + 0.8, 7.2, 0.2, fw.x) - cLine(f.x - 0.8, 7.2, 0.2, fw.x)) * 0.5 * detB;
  } else if (k > 37.5 && k < 38.5) {
    // gallery plate: 40 x 24 m plates in three tones, paired ribbon windows every 60 m round
    // the tube (lit, a dark sill band beside each), frame bands every 120 m along it
    vec2 pc = floor(f / vec2(40.0, 24.0));
    float h = hash12(pc + 17.0);
    float fam = hash12(floor(f / vec2(120.0, 240.0)) + 9.0);
    vec3 base = mix(vec3(0.5, 0.505, 0.5), vec3(0.62, 0.6, 0.56), fam);
    base *= mix(0.94, 0.86 + 0.18 * h, farK);
    base *= 1.0 - 0.3 * max(gridLine(f.x, 40.0, 0.4, fw.x), gridLine(f.y, 24.0, 0.4, fw.y)) * detB;
    float win = max(cLine(f.x, 60.0, 2.6, fw.x), cLine(f.x + 9.0, 60.0, 2.6, fw.x));
    float sill = cLine(f.x - 5.5, 60.0, 1.4, fw.x);
    float frameB = cLine(f.y, 120.0, 4.0, fw.y);
    float soot = smoothstep(0.55, 0.88, vnoise(vec2(f.x * 0.02, f.y * 0.0025) + 4.0));
    alb = base * (1.0 - 0.22 * soot);
    alb = mix(alb, vec3(0.12, 0.12, 0.13), sill * 0.8);
    alb = mix(alb, vec3(0.44, 0.34, 0.22), frameB * 0.8);
    alb = mix(alb, vec3(0.03, 0.04, 0.05), win * (1.0 - frameB));
    float cell = hash12(vec2(floor(f.x / 30.0), floor(f.y / 18.0)) + 3.0);
    em = mix(vec3(1.0, 0.8, 0.56), vec3(0.85, 0.93, 1.0), step(0.8, cell)) * win * (1.0 - frameB) * (0.25 + 0.55 * step(1.0 - uLit, cell));
    rough = mix(0.46 + 0.14 * h, 0.08, win); metal = mix(0.12, 0.5, max(win, frameB));
  } else if (k > 38.5) {
    // zinc roof: 6 m standing-seam sheets, a rooflight in each 12 m bay, a pale parapet line
    float seam = gridLine(f.x, 0.6, 0.03, fw.x) * det;
    float sheet = hash12(floor(f / vec2(6.0, 12.0)) + 13.0);
    vec3 zinc = vec3(0.16, 0.17, 0.18) * mix(1.0, 0.85 + 0.3 * sheet, detB);
    vec2 rq = abs(fract(f / 12.0) - 0.5) * 12.0;
    float light = (1.0 - smoothstep(2.2, 2.2 + fw.x, rq.x)) * (1.0 - smoothstep(3.2, 3.2 + fw.y, rq.y));
    float parapet = max(cLine(f.x, 48.0, 0.8, fw.x), cLine(f.y, 48.0, 0.8, fw.y));
    alb = zinc * (1.0 - 0.3 * seam);
    alb = mix(alb, vec3(0.05, 0.06, 0.07), light * 0.9);
    alb = mix(alb, vec3(0.4, 0.37, 0.32), parapet * 0.7);
    rough = mix(0.4, 0.1, light); metal = mix(0.55, 0.3, light);
    em = vec3(1.0, 0.82, 0.6) * light * (0.2 + 0.2 * sheet);
  } else if (k > 35.5) {
    // glasshouse: 3 x 2.4 m panes on bronze bars, a heavier rib every 18 m that reads from
    // far off; the glass mirrors a grey-blue sky over the beds and paths of the garden, dim,
    // warm lamps among them after dark; open vents darken a bay here and there
    float bars = max(gridLine(f.x, 3.0, 0.08, fw.x), gridLine(f.y, 2.4, 0.08, fw.y)) * det;
    float rib = max(cLine(f.x, 18.0, 1.0, fw.x), cLine(f.y, 24.0, 0.8, fw.y));
    float frame = max(mix(0.1, bars, det), rib);
    float fol = mix(0.5, vnoise(f * 0.11) * 0.6 + vnoise(f * 0.6) * 0.4, detB);
    float walk = mix(0.15, max(cLine(f.x, 36.0, 1.6, fw.x), cLine(f.y, 30.0, 1.4, fw.y)), farK);
    float hallK = step(36.5, k);
    vec3 garden = mix(mix(vec3(0.02, 0.045, 0.018), vec3(0.06, 0.1, 0.035), fol), vec3(0.15, 0.14, 0.11), walk);
    vec3 floorC = mix(vec3(0.09, 0.085, 0.08), vec3(0.2, 0.18, 0.15), fol);
    vec3 inside = mix(garden, floorC, hallK);
    // the sky in the glass: a grey-blue sheen that varies bay to bay
    float hp = hash12(floor(f / vec2(18.0, 24.0)) + 29.0);
    inside = mix(inside, vec3(0.15, 0.18, 0.21) * (0.8 + 0.4 * hp), 0.42);
    float vent = step(0.86, hp) * (1.0 - hallK);
    inside *= 1.0 - 0.45 * vent;
    alb = mix(inside, vec3(0.46, 0.36, 0.23), frame);
    rough = mix(0.05, 0.35, frame); metal = mix(0.62, 0.85, frame);
    float hh = hash12(floor(f / vec2(6.0, 4.8)) + 29.0);
    // the hall's lamp rows every 12 m along it, pools of light and the crowd beneath
    float rows = mix(0.3, 1.0 - smoothstep(0.6, 2.0, abs(fract(f.x / 12.0 + 0.5) - 0.5) * 12.0), detB);
    float glow = mix(0.03 + 0.05 * walk + 0.05 * step(0.9, hh) * det, 0.09 + 0.18 * rows + 0.04 * hh, hallK);
    em = vec3(1.0, 0.76, 0.48) * glow * (1.0 - frame);
  } else {
    float c = vnoise(f * 0.45) * 0.55 + vnoise(f * 1.7) * 0.45 * det;
    vec3 leaf = mix(vec3(0.035, 0.07, 0.03), vec3(0.11, 0.17, 0.06), c);
    float bloom = step(0.93, hash12(floor(f / 0.9) + 31.0)) * det;
    vec3 flower = mix(vec3(0.6, 0.2, 0.18), vec3(0.75, 0.62, 0.25), hash12(floor(f / 0.9) + 2.0));
    alb = mix(leaf, flower, bloom * 0.7);
    alb = mix(alb, vec3(0.07, 0.055, 0.04), smoothstep(0.62, 0.8, 1.0 - c) * 0.6);
    // copper and autumn crowns among the green, about one tree in five (reads from the rim)
    float crown = hash12(floor(f / 7.0) + 51.0);
    alb = mix(alb, alb * vec3(1.9, 1.1, 0.6), step(0.8, crown) * 0.7);
    rough = 0.92; metal = 0.0;
    bump += (vec2(vnoise(f * 1.4 + 7.0), vnoise(f * 1.4 + 13.0)) - 0.5) * 0.9 * det;
  }
}
`;
