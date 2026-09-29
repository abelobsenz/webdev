// The Earth up close: every scale the cube bakes cannot hold (their texels are 10 - 20 km), drawn
// procedurally in the Earth shader so that from low orbit (a pixel ~0.3 - 2 km) the planet stays
// crisp at every quality tier, and from far away each term falls smoothly to its mean.
//
//   clouds   fractal detail from 60 km down to ~0.6 km (the octave table below), sheared by a
//            slow swirl so streets and puffs curve and fray; cumulus octaves pulled into lines of
//            convergence; a height field marched toward the Sun for self-shadowing; valley
//            occlusion between the tops; forward-scattering silver edges
//   land     ridged relief (40 km - 1.8 km) with drainage valleys, rock on the crests, snow above
//            a latitude-dependent snowline, vegetation mottling, field patchwork in the farmed
//            lowlands, linear dunes, desert varnish and salt pans in the deserts
//   sea      phytoplankton blooms drawn out into filaments by the eddies, sediment on the shelves,
//            wind rows in the glint, and a sky reflection that brightens toward grazing
//   air      a skylight whose colour follows the Sun through the terminator (blue by day, warm
//            along the terminator, violet through twilight), and the limb's glow
//
// Every octave's weight is a smooth function of the pixel footprint fp (km per pixel) that is
// zero before its wavelength spans fewer than ~4.5 pixels, so nothing sparkles as the planet
// turns; the verify script checks the tables against that rule.

// ---- tables (shared with tools/verify-earth.mjs) -----------------------------------------------
/** Moments of snoise() over space (the verify script measures them with snoiseJS): E|n|, E(1-|n|)^2,
 *  E(1-|n|)^3. Every shaped octave subtracts its mean, so a field keeps its mean as octaves fade in
 *  and out with range (no shift in cover, height or colour at the LOD handover). */
export const NOISE_MOMENTS = { abs: 0.308, ridge2: 0.522, ridge3: 0.417 };
const LACUNARITY = 2.13;
const CLOUD_AMPS = [0.75, 0.8, 0.8, 0.8, 0.7, 0.55, 0.4];
/** The cloud detail octaves: wavelength (km) and amplitude, coarse to fine. */
export const CLOUD_OCTAVES = CLOUD_AMPS.map((amp, i) => ({ wl: 60 / Math.pow(LACUNARITY, i), amp }));
/** Octave fade window as fractions of the wavelength: full weight while wl/fp > 1/lo, gone once wl/fp < 1/hi. */
export const OCTAVE_FADE = { lo: 0.08, hi: 0.22 };
/** How many cloud octaves each quality tier evaluates on the deck, and in its shadows. */
export const CLOUD_OCT_BY_Q = [5, 6, 7, 7];
export const SHADOW_OCT_BY_Q = [3, 4, 5, 5];
/** The relief octaves of the land: wavelength (km), amplitude (km of true height), first quality tier. */
export const RIDGE_OCTAVES = [
  { wl: 40, amp: 1.1, q: 0 },
  { wl: 14, amp: 0.55, q: 0 },
  { wl: 5, amp: 0.26, q: 0 },
  { wl: 1.8, amp: 0.11, q: 1 },
];
/** The relief march: steps through the tops' layer, the view slant below which it runs, and the footprint (km) above which it fades out. */
export const RELIEF = { steps: 4, stepsByQ: [3, 4, 4, 4], muLo: 0.3, muHi: 0.45, fpLo: 2.0, fpHi: 4.0 };
/** Lee-wave clouds: wavelength (km) and amplitude in the cloud potential. */
export const LEE = { wl: 11, amp: 0.13 };
/** The terrain-shadow march for a low Sun: first step (km), growth per step, steps, height exaggeration. */
export const TERRAIN_MARCH = { d0: 4, grow: 2.3, steps: 5, exag: 2.5 };
/** The self-shadow march: first step (km, at least this many pixels), growth per step, steps. */
export const SHADOW_MARCH = { d0: 1.2, px: 2.0, grow: 2.2, steps: 3, topKm: 3.2 };
/** Height of cloud tops above the deck (km) for a cover c and optical depth tau. */
export function cloudTopKm(cover, tau) { return SHADOW_MARCH.topKm * cover * Math.sqrt(Math.min(Math.max(tau / 48, 0), 1)); }
/** Weight of an octave of wavelength wl at footprint fp (the GLSL's fade, mirrored). */
export function octaveWeight(wl, fp) {
  const a = wl * OCTAVE_FADE.lo, b = wl * OCTAVE_FADE.hi;
  const t = Math.min(Math.max((fp - a) / (b - a), 0), 1);
  return 1 - t * t * (3 - 2 * t);
}
/** Snowline (km of true height) at latitude lat (rad): ~5 km in the tropics, sea level near the poles. */
export function snowlineKm(lat) { const x = Math.min(Math.abs(lat) / (Math.PI / 2), 1); return 5.3 - 5.6 * Math.pow(x, 1.6); }
/** The skylight's colour and strength on the ground for a Sun at cos(zenith) mu (per unit illuminance). */
export function skyAmbient(mu) {
  const day = smooth(-0.28, 0.35, mu) * (0.35 + 0.65 * Math.min(Math.max(mu + 0.3, 0), 1));
  const zt = (mu - 0.02) / 0.07;
  const warm = Math.exp(-zt * zt);
  const zv = (mu + 0.08) / 0.07;
  const violet = Math.exp(-zv * zv);
  return [
    0.05 * day + 0.034 * warm + 0.006 * violet,
    0.085 * day + 0.018 * warm + 0.004 * violet,
    0.16 * day + 0.012 * warm + 0.011 * violet,
  ];
}
function smooth(a, b, x) { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(+v.toFixed(6)));
const arr = (name, vals) => `const float ${name}[${vals.length}] = float[${vals.length}](${vals.map(f).join(', ')});`;

// ---- GLSL, part 1: needs rotY, snoise, hash13 and the noise library, nothing of the Earth's ----
export const EARTH_FINE_GLSL = /* glsl */ `
#if QUALITY >= 2
#define EF_CLOUD_OCT ${CLOUD_OCT_BY_Q[2]}
#define EF_SHADOW_OCT ${SHADOW_OCT_BY_Q[2]}
#define EF_RELIEF_N ${RELIEF.stepsByQ[2]}
#elif QUALITY == 1
#define EF_CLOUD_OCT ${CLOUD_OCT_BY_Q[1]}
#define EF_SHADOW_OCT ${SHADOW_OCT_BY_Q[1]}
#define EF_RELIEF_N ${RELIEF.stepsByQ[1]}
#else
#define EF_CLOUD_OCT ${CLOUD_OCT_BY_Q[0]}
#define EF_SHADOW_OCT ${SHADOW_OCT_BY_Q[0]}
#define EF_RELIEF_N ${RELIEF.stepsByQ[0]}
#endif
#define EF_CD_N ${CLOUD_OCTAVES.length}
${arr('EF_CD_A', CLOUD_OCTAVES.map((o) => o.amp))}
${arr('EF_CD_WL', CLOUD_OCTAVES.map((o) => o.wl))}
const float EF_CD_RMS = ${f(Math.sqrt(CLOUD_OCTAVES.reduce((s, o) => s + o.amp * o.amp, 0)))};
const float EF_FADE_LO = ${f(OCTAVE_FADE.lo)};
const float EF_FADE_HI = ${f(OCTAVE_FADE.hi)};
const float EF_TOP_KM = ${f(SHADOW_MARCH.topKm)};
const float EF_ABS_MEAN = ${f(NOISE_MOMENTS.abs)};
const float EF_RIDGE2_MEAN = ${f(NOISE_MOMENTS.ridge2)};
const float EF_RIDGE3_MEAN = ${f(NOISE_MOMENTS.ridge3)};

float ef_fade(float wl, float fp) { return 1.0 - smoothstep(wl * EF_FADE_LO, wl * EF_FADE_HI, fp); }

// Cloud detail at weather-frame direction q: x = the resolved fractal sum, y = the RMS amplitude
// of the octaves not drawn (below a few pixels, or beyond this tier's count), z = the resolved
// share of the cumulus octaves (how much of the puffs' own relief the pixel sees).
// cumu: 1 cumuliform (puffs, streets along the zonal wind), 0 stratiform (soft sheets).
vec3 ef_cloudDetail(vec3 q, float fp, float cumu, int oct) {
  float s = 0.0, u = 0.0, res = 0.0;
  float st = 1.0 + 1.4 * cumu;
  vec3 x = q * (6371.0 / 60.0) * vec3(1.0, st, 1.0);
  // a slow swirl shears the mesoscale field, so streets curve and clusters fray instead of
  // sitting on a straight lattice (one octave of warp, only where it can be seen)
  float wres = ef_fade(140.0, fp);
  if (wres > 0.0 && oct > 1) {
    vec3 wq = q * (6371.0 / 150.0);
    vec2 wv = vec2(snoise(wq + 5.3), snoise(wq + 11.9));
    x += vec3(wv.x, 0.35 * wv.y, wv.y) * 0.85 * wres;
  }
  for (int i = 0; i < EF_CD_N; i++) {
    float a = EF_CD_A[i];
    // (the street octaves are filtered by their short, north-south wavelength)
    float wf = i <= 2 ? EF_CD_WL[i] / st : EF_CD_WL[i];
    float w = i < oct ? ef_fade(wf, fp) : 0.0;
    if (w > 0.0) {
      float n = snoise(x);
      // cumulus: the 6 - 13 km octaves gather into lines of convergence (cloud along the
      // zero crossings: a network of cloud round clear gaps); finer octaves round into domes
      if (i == 3 || i == 4) n = mix(n, (EF_ABS_MEAN - abs(n)) * 1.55, 0.4 * cumu);
      else if (i >= 5) n = mix(n, sign(n) * sqrt(abs(n)) * 0.8, 0.5 * cumu);
      s += a * w * n;
      if (i >= 3) res += w * a;
    }
    u += a * a * (1.0 - w) * (1.0 - w);
    x = x * 2.13 + vec3(3.1, 7.7, 1.3);
    if (i == 2) x.y /= st;
  }
  return vec3(s, sqrt(u), res / 2.45);
}

// Lee waves: downwind of a range the westerlies set the air oscillating, and where it is moist
// enough a train of parallel wave clouds (~11 km apart) stands in the lee across the wind, fixed
// to the ground while the weather drifts through. b: body direction, P: the cloud potential.
// Returns the change to the potential (bands of cloud and clear between them).
float ef_leeWave(vec3 b, float fp, float P) {
  float w = ef_fade(${f(LEE.wl)}, fp) * smoothstep(0.38, 0.55, abs(b.y));
  float moist = exp(-((P - 0.46) / 0.13) * ((P - 0.46) / 0.13));
  if (w * moist < 0.01) return 0.0;
  vec3 east = normalize(vec3(b.z, 0.0, -b.x) + 1e-6);
  // the range upwind (west): the bake's heights ~20 and ~45 km off, against the ground here
  float hU = max(textureLod(uSurfA, normalize(b - east * (20.0 / 6371.0)), 2.0).a, textureLod(uSurfA, normalize(b - east * (45.0 / 6371.0)), 2.0).a) * 2.0 - 1.0;
  float hH = textureLod(uSurfA, b, 2.0).a * 2.0 - 1.0;
  float lee = smoothstep(0.1, 0.3, hU) * smoothstep(0.0, 0.08, hU - hH);
  if (lee < 0.01) return 0.0;
  vec3 p = b * 6371.0;
  float ph = atan(-b.z, b.x) * sqrt(max(1.0 - b.y * b.y, 0.0)) * (6371.0 / ${f(LEE.wl)}) + 1.2 * snoise(p / 70.0 + 13.0);
  // (the train reaches as far downwind as the upwind samples still see the range: a few waves)
  return ${f(LEE.amp)} * lee * w * moist * cos(ph * 6.2832);
}

// ---- the land ---------------------------------------------------------------------------------
float ef_ridge(vec3 p) { float r = 1.0 - abs(snoise(p)); return r * r; }

// Land detail at body direction b: adds true relief (km) to hK and returns it, adjusts the linear
// albedo alb, and writes the valley share (0 crest .. 1 valley floor) for the skylight's occlusion.
// H: the bake's height (-1..1, 0 = sea level; 1 ~ 6 km), arid 0..1, ice 0..1.
float ef_land(vec3 b, float fp, float H, float arid, float ice, inout vec3 alb, out float valley) {
  float lat = asin(clamp(b.y, -1.0, 1.0));
  float hTrue = max(H, 0.0) * 6.0;
  float mtn = smoothstep(0.02, 0.25, H);
  float hills = 0.25 + 0.75 * mtn;
  vec3 p = b * 6371.0;
  // relief: ridged octaves, each fading to flat while it still spans a few pixels
  float dh = 0.0, crest = 0.0, wsum = 0.0;
  ${RIDGE_OCTAVES.map((o, i) => `{
    float w = ef_fade(${f(o.wl)}, fp)${o.q > 0 ? ` * (QUALITY >= ${o.q} ? 1.0 : 0.0)` : ''};
    if (w > 0.0) {
      float r = ef_ridge(p / ${f(o.wl)} + ${f(i * 7.31 + 1.7)});
      dh += w * ${f(o.amp)} * (r - EF_RIDGE2_MEAN);
      crest += w * ${f(o.amp)} * r;
      wsum += w * ${f(o.amp)};
    }
  }`).join('\n  ')}
  dh *= hills;
  float cr = wsum > 0.0 ? crest / wsum : EF_RIDGE2_MEAN;
  valley = (1.0 - smoothstep(0.08, 0.5, cr)) * step(1e-4, wsum);
  float hNow = hTrue + dh;
  // mottling of the ground cover (forest and clearings, 9 km and 2.6 km), faded to its mean
  float m9 = ef_fade(9.0, fp), m3 = ef_fade(2.6, fp);
  float mot = (m9 > 0.0 ? 0.2 * m9 * snoise(p / 9.0 + 40.0) : 0.0) + (m3 > 0.0 ? 0.14 * m3 * snoise(p / 2.6 + 80.0) : 0.0);
  float veg = (1.0 - arid) * (1.0 - ice) * (1.0 - mtn * 0.5);
  alb *= 1.0 + mot * (0.4 + 0.6 * veg);
  // valleys: the green runs down the drainage; crests: bare rock
  alb = mix(alb, alb * vec3(0.78, 0.92, 0.76), valley * veg * 0.8);
  float rock = mtn * smoothstep(0.55, 0.9, cr) * (1.0 - ice);
  alb = mix(alb, mix(vec3(0.075, 0.07, 0.062), vec3(0.2, 0.17, 0.13), arid), rock * 0.65);
  // snow above a latitude-dependent snowline, deepest on the high crests and shaded gullies
  float xl = min(abs(lat) / 1.5708, 1.0);
  float line = 5.3 - 5.6 * pow(xl, 1.6);
  float snow = smoothstep(line - 0.35, line + 0.35, hNow + 0.5 * (cr - EF_RIDGE2_MEAN)) * (1.0 - 0.8 * arid) * step(0.0, H);
  alb = mix(alb, vec3(0.7, 0.72, 0.76), snow * (1.0 - ice));
  // fields: a patchwork of plots in the farmed lowlands (1.4 km, each its own crop), grouped in
  // districts (6 km) of different practice; never on the mountains, deserts or ice
  float farm = (1.0 - mtn) * (1.0 - smoothstep(0.35, 0.65, arid)) * (1.0 - ice) * smoothstep(-0.1, 0.35, snoise(p / 70.0 + 3.0));
  float wF = ef_fade(1.4, fp), wD = ef_fade(6.0, fp);
  if (farm * wD > 0.01) {
    float hd = hash13(floor(p / 6.0 + 0.5) + 11.0);
    float hp = wF > 0.0 ? hash13(floor(p / 1.4) + 5.0) : 0.5;
    vec3 crop = mix(vec3(0.95, 1.0, 0.85), vec3(1.35, 1.2, 0.85), hp);        // green crop .. stubble
    crop = mix(crop, vec3(0.8, 0.72, 0.62), step(0.8, hp) * wF);              // ploughed
    vec3 tint = mix(vec3(1.0), mix(vec3(1.0), crop, wF), wD) * (0.9 + 0.2 * hd * wD);
    alb *= mix(vec3(1.0), tint, farm);
  }
  // deserts: linear dunes (~2.4 km, crests running north-south, wandering), dark varnished rock
  // on the uplands, bright salt pans in the low basins
  if (arid > 0.2) {
    float wd = ef_fade(2.4, fp) * smoothstep(0.35, 0.8, arid) * (1.0 - mtn);
    if (wd > 0.0) {
      float ph = atan(-b.z, b.x) * sqrt(max(1.0 - b.y * b.y, 0.0)) * (6371.0 / 2.4) + 3.0 * snoise(p / 30.0);
      alb *= 1.0 + 0.1 * wd * sin(ph * 6.2832);
    }
    float wv = ef_fade(25.0, fp);
    float varn = smoothstep(0.25, 0.65, snoise(p / 22.0 + 9.0)) * mtn * arid * wv;
    alb = mix(alb, alb * vec3(0.55, 0.5, 0.48), varn);
    float pan = smoothstep(0.5, 0.75, snoise(p / 35.0 + 21.0)) * (1.0 - smoothstep(0.02, 0.08, H)) * smoothstep(0.5, 0.85, arid) * wv;
    alb = mix(alb, vec3(0.55, 0.53, 0.5), pan * 0.8);
  }
  return dh;
}

// Sub-texel coastline wobble (headlands, coves, barrier islands) at every tier
float ef_coast(vec3 b, float H, float fp) {
  float cw = exp(-abs(H) * 10.0) * (1.0 - smoothstep(2.0, 14.0, fp));
  if (cw <= 0.01) return 0.0;
  float c = snoise(b * 1500.0) * 0.6 * ef_fade(4.2, fp);
#if QUALITY > 0
  c += snoise(b * 4100.0) * 0.4 * ef_fade(1.5, fp);
#endif
  return c * 0.05 * cw;
}

// Terrain shadows for a low Sun: the bake's height field (x TERRAIN_EXAG, as the relief shading
// is exaggerated) marched toward the Sun in growing steps out to ~110 km, so along the terminator
// the ranges throw long shadows across the plains and valleys. The caller runs it only on land,
// for a low Sun; each read is an explicit LOD matched to its step.
float ef_terrainShadow(vec3 b, vec3 sB, float mu, float fp, float h0) {
  vec3 st = sB - b * mu;
  float sl = length(st);
  if (sl < 1e-4) return 1.0;
  st /= sl;
  float tanE = max(mu, 0.0) / sl;
  float occ = 0.0;
  float d = max(${f(TERRAIN_MARCH.d0)}, fp * 2.0);
  for (int k = 0; k < ${TERRAIN_MARCH.steps}; k++) {
    vec3 bk = normalize(b + st * (d / 6371.0));
    float lod = max(log2(max(d * 0.3, fp) / uSurfTexel), 0.0);
    float hk = max(textureLod(uSurfA, bk, lod).a * 2.0 - 1.0, 0.0) * 6.0 * ${f(TERRAIN_MARCH.exag)};
    occ = max(occ, smoothstep(0.0, 0.5, hk - h0 - d * tanE));
    d *= ${f(TERRAIN_MARCH.grow)};
  }
  return 1.0 - 0.85 * occ;
}

// ---- the sea ----------------------------------------------------------------------------------
// Pack ice below the bake's texels: a ragged ice edge of floes and tongues where the pack thins,
// dark leads (open cracks, ~8 km apart and a few hundred metres wide) through the close pack.
// Returns the new ice share.
float ef_seaIce(vec3 b, float fp, float ice) {
  if (ice < 0.01) return ice;
  vec3 p = b * 6371.0;
  float edgeZ = clamp(ice * (1.0 - ice) * 4.0, 0.0, 1.0);
  float w40 = ef_fade(40.0, fp), w10 = ef_fade(10.0, fp);
  float n = (w40 > 0.0 ? w40 * snoise(p / 40.0 + 70.0) : 0.0) + (w10 > 0.0 ? 0.5 * w10 * snoise(p / 10.0 + 90.0) : 0.0);
  float e = 0.03 + 0.25 * (1.0 - w10);
  float iceE = mix(ice, smoothstep(0.5 - e, 0.5 + e, ice + 0.4 * n), edgeZ);
  float w8 = ef_fade(8.0, fp);
  if (w8 > 0.0 && ice > 0.5) {
    float r = 1.0 - abs(snoise(p / 8.0 + vec3(0.0, 4.0, 0.0)));
    float lead = smoothstep(0.9, 0.975, r) * w8 * smoothstep(0.5, 0.8, ice);
    iceE *= 1.0 - 0.75 * lead;
  }
  return iceE;
}

// The water's own colour (linear albedo), refined below the bake's texels. The bake already
// paints the blooms (milky turquoise coccolithophores, green diatoms), the river plumes and the
// shelves as smooth patches ~20 km a texel; here each coloured patch is drawn out into the
// filaments of the eddies that stir it (~40 km and ~12 km across), keeping its mean, and the
// open ocean gets a faint swirl of the mesoscale eddies (~100 km). Ice and bergs are left alone.
const vec3 EF_DEEP = vec3(0.004, 0.011, 0.028);      // the bake's open-ocean albedo
vec3 ef_seaColour(vec3 b, float fp, float shelf, float H, vec3 seaAlb) {
  vec3 wq = b * 45.0;
  vec3 wv = vec3(snoise(wq + 7.0), snoise(wq + 19.0), snoise(wq + 31.0));
  float ed = snoise(b * 70.0 + wv * 1.8) * ef_fade(260.0, fp);
  vec3 dv = seaAlb - EF_DEEP;
  float colored = clamp(length(dv) / 0.03, 0.0, 1.0) * (1.0 - smoothstep(0.15, 0.3, seaAlb.r));
  float s = 1.0;
  if (colored > 0.02) {
    float w1 = ef_fade(80.0, fp), w2 = ef_fade(22.0, fp);
    if (w1 > 0.0) {
      float f1 = 1.0 - abs(snoise(b * 160.0 + wv * 2.6));
      s += 1.3 * w1 * (f1 * f1 * f1 - EF_RIDGE3_MEAN);
    }
    if (w2 > 0.0) {
      float f2 = 1.0 - abs(snoise(b * 520.0 + wv * 5.0 + 3.0));
      s += 0.8 * w2 * (f2 * f2 * f2 - EF_RIDGE3_MEAN);
    }
    // (the shelves' own colour is the sea floor's, stirred less than a bloom)
    s = mix(1.0, clamp(s, 0.2, 2.0), colored * (1.0 - 0.5 * shelf * exp(-abs(H) * 20.0)));
  }
  return (EF_DEEP + dv * s) * (1.0 + 0.08 * ed);
}

// The glint's texture from the wind: rows of rougher water along the wind (~3 km apart) and
// cat's-paw patches (~12 km), a roughness factor about 1 that fades to 1 below a few pixels.
float ef_windRows(vec3 b, float fp) {
  float r = 1.0;
  float w12 = ef_fade(12.0, fp);
  if (w12 > 0.0) r += 0.16 * w12 * snoise(b * (6371.0 / 12.0) + 44.0);
  float w3 = ef_fade(3.0, fp);
  if (w3 > 0.0) r += 0.12 * w3 * snoise(b * vec3(6371.0 / 9.0, 6371.0 / 2.4, 6371.0 / 9.0) + 61.0);
  return r;
}

// ---- the air ----------------------------------------------------------------------------------
// Skylight on a horizontal surface for a Sun at cos(zenith) mu, per unit of solar illuminance:
// blue by day, a warm lobe along the terminator (the low Sun seen through the long air path
// lights the ground and the cloud from a sky gone gold), a faint violet through twilight.
vec3 ef_skyAmbient(float mu) {
  float day = smoothstep(-0.28, 0.35, mu) * (0.35 + 0.65 * clamp(mu + 0.3, 0.0, 1.0));
  float zt = (mu - 0.02) / 0.07;
  float zv = (mu + 0.08) / 0.07;
  return vec3(0.05, 0.085, 0.16) * day + vec3(0.034, 0.018, 0.012) * exp(-zt * zt) + vec3(0.006, 0.004, 0.011) * exp(-zv * zv);
}

// The limb's glow: rays that graze the air (hMin: the ray's lowest altitude, km) gather more
// than the thin sampling gives them back, the lowest kilometres whiter (haze), the upper bluer.
vec3 ef_limbGain(float hMin, bool ground, float cosV, float gain) {
  if (ground) {
    // just inside the horizon the haze thickens into the limb
    float g = 1.0 - smoothstep(0.0, 0.14, cosV);
    return vec3(1.0 + 0.45 * gain * g * g);
  }
  float h = max(hMin, 0.0);
  float band = exp(-h / 18.0);
  float haze = exp(-h / 5.0);
  return vec3(1.0) + gain * (band * vec3(0.8, 0.95, 1.15) + haze * vec3(0.35, 0.3, 0.2));
}
`;

/** Mean light lost to the unresolved self-shadowing of a cloud field (0..1) at cos(sun zenith) mu, stratiform share S. */
export function meanSelfShadow(mu, S) { return MEAN_SELF_K * (1 - S) * (1 - smooth(0.08, 0.85, mu)); }
const MEAN_SELF_K = 0.32;

// ---- GLSL, part 2: after the Earth's lowCloud(); needs uToBody ----------------------------------
export const EARTH_FINE_SHADOW_GLSL = /* glsl */ `
// The mean of the self-shadowing once it falls below the pixels (see meanSelfShadow in JS)
float ef_meanSelfShadow(float mu, float S) { return ${f(MEAN_SELF_K)} * (1.0 - S) * (1.0 - smoothstep(0.08, 0.85, mu)); }

// Self-shadowing of the cloud tops: the height field (tops up to ~3 km above the deck, read from
// the optical depth) marched toward the Sun in ${SHADOW_MARCH.steps} growing steps; each neighbour that stands
// above the ray to the Sun takes a share of the light. A low Sun gives long shadows (the relief
// of a cloud field at the terminator); a high one, the dark flanks of the towers.
float ef_cloudSelfShadow(vec3 nC, vec3 sun, float muC, float fpC, float bias, float h0) {
  vec3 st = sun - nC * muC;
  float sl = length(st);
  if (sl < 1e-4 || muC < -0.05) return 1.0;
  st /= sl;
  float tanE = clamp(muC / max(sl, 0.05), 0.0, 4.0);
  float occ = 0.0;
  float d = max(${f(SHADOW_MARCH.d0)}, fpC * ${f(SHADOW_MARCH.px)});
  for (int k = 0; k < ${SHADOW_MARCH.steps}; k++) {
    vec3 bk = uToBody * normalize(nC + st * (d / 6371.0));
    vec2 c = lowCloud(bk, max(fpC, d * 0.25), bias, EF_SHADOW_OCT);
    float hk = EF_TOP_KM * c.x * sqrt(clamp(c.y / 48.0, 0.0, 1.0));
    float ray = h0 + d * tanE;
    occ += smoothstep(0.0, 0.6, hk - ray) * (1.0 - 0.22 * float(k));
    d *= ${f(SHADOW_MARCH.grow)};
  }
  return exp(-1.5 * occ);
}
`;

// ---- GLSL, part 3: the deck's relief at a slant (after lowCloud and landBias; needs RC) ---------
export const EARTH_FINE_RELIEF_GLSL = /* glsl */ `
// The deck seen at a slant: march the ray down through the layer of the tops (RC .. RC + the
// tops' height) and stop where it first meets a top, so toward the horizon the towers stand up,
// hide what lies behind them and show their sides, and at the limb they break the skyline.
// Seen from above the layer is thin next to a pixel and the flat shell is kept (the relief
// scale falls smoothly to zero, so nothing jumps between the two). Returns whether the deck is
// met, and there: the cloud (cover, tau), the ray distance and the land's bias.
bool ef_deck(vec3 ro, vec3 rd, vec2 tC, out vec2 lcl, out float tHit, out float bias) {
  bool hitBase = tC.x < tC.y && tC.y > 0.0;
  float tBase = hitBase ? max(tC.x, 0.0) : max(-dot(ro, rd), 0.0);
  vec3 nB = normalize(ro + rd * tBase);
  vec3 bB = uToBody * nB;
  bias = landBias(bB);
  float fpB = max(tBase * uPixAng, 1e-3);
  float muV = abs(dot(rd, nB));
  float relK = (1.0 - smoothstep(${f(RELIEF.muLo)}, ${f(RELIEF.muHi)}, muV)) * (1.0 - smoothstep(${f(RELIEF.fpLo)}, ${f(RELIEF.fpHi)}, fpB));
  lcl = vec2(0.0);
  tHit = tBase;
  if (relK > 0.01) {
    float top = EF_TOP_KM * relK;
    vec2 tT = sphereHits(ro, rd, RC + top);
    if (tT.x < tT.y && tT.y > 0.0) {
      float t0 = max(tT.x, 0.0);
      float tPrev = t0;
      float gPrev = length(ro + rd * t0) - RC;
      for (int k = 1; k <= EF_RELIEF_N; k++) {
        float t = mix(t0, tBase, float(k) / float(EF_RELIEF_N));
        vec3 p = ro + rd * t;
        vec2 c = lowCloud(uToBody * normalize(p), max(t * uPixAng, 1e-3), bias, EF_CLOUD_OCT);
        float g = length(p) - RC - top * c.x * sqrt(clamp(c.y / 48.0, 0.0, 1.0));
        if (g <= 0.0) {
          tHit = mix(tPrev, t, clamp(gPrev / max(gPrev - g, 1e-4), 0.0, 1.0));
          lcl = c;
          return true;
        }
        if (k == EF_RELIEF_N) {
          // the ray reached the base (or, at the limb, its lowest point) over clear air
          lcl = hitBase ? c : vec2(0.0);
          return hitBase;
        }
        tPrev = t;
        gPrev = g;
      }
    }
  }
  if (hitBase) lcl = lowCloud(bB, fpB, bias, EF_CLOUD_OCT);
  return hitBase;
}
`;

// ---- the GLSL snoise() in JS, for the verify script's statistics of the shaped octaves ----------
const m289 = (x) => x - Math.floor(x / 289) * 289;
const perm = (x) => m289((x * 34 + 10) * x);
/** 3D simplex noise, the same arithmetic as SNOISE_GLSL's snoise() (glsl.js). */
export function snoiseJS(vx, vy, vz) {
  const C1 = 1 / 6, C2 = 1 / 3;
  const s = (vx + vy + vz) * C2;
  let ix = Math.floor(vx + s), iy = Math.floor(vy + s), iz = Math.floor(vz + s);
  const t = (ix + iy + iz) * C1;
  const x0 = [vx - ix + t, vy - iy + t, vz - iz + t];
  const g = [x0[1] <= x0[0] ? 1 : 0, x0[2] <= x0[1] ? 1 : 0, x0[0] <= x0[2] ? 1 : 0];
  const l = g.map((v) => 1 - v);
  const i1 = [Math.min(g[0], l[2]), Math.min(g[1], l[0]), Math.min(g[2], l[1])];
  const i2 = [Math.max(g[0], l[2]), Math.max(g[1], l[0]), Math.max(g[2], l[1])];
  const x1 = [0, 1, 2].map((k) => x0[k] - i1[k] + C1);
  const x2 = [0, 1, 2].map((k) => x0[k] - i2[k] + C2);
  const x3 = [0, 1, 2].map((k) => x0[k] - 0.5);
  ix = m289(ix); iy = m289(iy); iz = m289(iz);
  const pz = [0, i1[2], i2[2], 1].map((o) => perm(iz + o));
  const py = pz.map((v, k) => perm(v + iy + [0, i1[1], i2[1], 1][k]));
  const p = py.map((v, k) => perm(v + ix + [0, i1[0], i2[0], 1][k]));
  const nsx = 2 / 7, nsy = 0.5 / 7 - 1, nsz = 1 / 7;
  let sum = 0;
  const xs = [x0, x1, x2, x3];
  for (let k = 0; k < 4; k++) {
    const j = p[k] - 49 * Math.floor(p[k] * nsz * nsz);
    const x_ = Math.floor(j * nsz), y_ = Math.floor(j - 7 * x_);
    const x = x_ * nsx + nsy, y = y_ * nsx + nsy;
    const h = 1 - Math.abs(x) - Math.abs(y);
    const sx = Math.floor(x) * 2 + 1, sy = Math.floor(y) * 2 + 1;
    const sh = h <= 0 ? -1 : 0;
    const ax = x + sx * sh, ay = y + sy * sh;
    const nrm = 1.79284291400159 - 0.85373472095314 * (ax * ax + ay * ay + h * h);
    const q = xs[k];
    const m = Math.max(0.6 - (q[0] * q[0] + q[1] * q[1] + q[2] * q[2]), 0);
    sum += m * m * m * m * nrm * (ax * q[0] + ay * q[1] + h * q[2]);
  }
  return 42 * sum;
}
