import { patchedMaterial, FACADE_GLSL } from './materials.js';
import { NATURE_GLSL, NATURE_U } from './natureGlsl.js';

// The ground of MERIDIAN: coral sand and reef, strand, meadow, rainforest canopy,
// cloud forest, stratified basalt cliffs and the garden city's walks and lawns.
// Everything is procedural and filtered by the pixel footprint so it holds up
// from a beach walk to the stratosphere.

const PARS = /* glsl */ `
uniform sampler2D uInfo;
uniform sampler2D uNature;
uniform float uInfoHalf;
uniform float uBloom;
${NATURE_GLSL}
${FACADE_GLSL}
vec4 infoAt(vec2 xz) {
  vec2 uv = (xz + uInfoHalf) / (2.0 * uInfoHalf);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(-100.0, 0.0, -1.0, 0.0);
  return texture(uInfo, uv);
}
vec4 natureAt(vec2 xz, float h) {
  vec2 uv = (xz + uInfoHalf) / (2.0 * uInfoHalf);
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(h * 12.0, 1.0, 0.0, 0.0);
  return texture(uNature, uv);
}
float tUrban; float tPaved; float tRock; float tWet; float tRough; float tAO;
vec3 tN;

// Lagoon floor: coral sand, seagrass, bommies, reef flats and seaward spur-and-groove.
vec3 lagoonFloorColor(vec2 p, float depth, float expo, float crest, float fw, inout vec2 hg, inout float ao) {
  float nearF = 1.0 - smoothstep(0.25, 0.9, fw);
  vec3 sandC = mix(vec3(0.80, 0.76, 0.64), vec3(0.90, 0.86, 0.74), vnoise(p * 0.021));
  if (nearF > 0.0) {
    // wave-formed sand ripples
    float ph = dot(p, vec2(0.83, 0.55)) * 2.4 + vnoise(p * 0.25) * 5.0;
    hg += vec2(0.83, 0.55) * cos(ph) * 0.22 * nearF;
    sandC *= 0.94 + 0.06 * sin(ph);
  }
  // seagrass meadows in calm, moderately deep water
  float sg = smoothstep(0.54, 0.64, fbm2_3(p * 0.0042 + 11.0)) * smoothstep(1.8, 4.5, depth) * (1.0 - smoothstep(13.0, 19.0, depth)) * (1.0 - expo);
  vec3 c = mix(sandC, vec3(0.10, 0.17, 0.07) * (0.8 + 0.4 * vnoise(p * 0.5)), sg * 0.85);
  // coral cover
  // coral cover: patchy (sand channels between the patches) and none on the beach face, where
  // the swash keeps the bottom clean sand; the exposed reef crest keeps its cover (below)
  float cover = smoothstep(9.0, 2.5, depth) * smoothstep(0.38, 0.68, vnoise(p * 0.028) + 0.25 * vnoise(p * 0.11 + 4.0) - 0.1)
              * smoothstep(0.5, 2.2, depth);
  // patch reefs (bommies): clustered, irregular, of every size, each ringed by a pale grazing halo
  // (sparse over open sand, crowded where the field says so; the odd big knoll 40-60 m across).
  // Each scale hands over to its expected cover while its cells still span a few pixels.
  vec2 pw = p + vec2(vnoise(p * 0.045), vnoise(p * 0.045 + 7.3)) * 14.0;
  float field = smoothstep(0.3, 0.75, vnoise(p * 0.0035 + 2.0));
  float thr = 0.93 - 0.6 * field;
  float lobe = (vnoise(p * 0.35) - 0.5) * 0.12;
  float bdS = 1.0 - smoothstep(1.5, 5.0, fw), bdL = 1.0 - smoothstep(6.0, 20.0, fw);
  float bommie = (1.0 - thr) * 0.14, halo = (1.0 - thr) * 0.3;
  if (bdS > 0.0) {
    vec3 wb = worley2(pw / 17.0);
    float br = 0.1 + 0.34 * fract(wb.z * 7.1) * (0.5 + 0.5 * vnoise(p * 0.21));
    float on = step(thr, wb.z), dd = wb.x + lobe;
    float bS = on * (1.0 - smoothstep(br * 0.55, br, dd));
    float hS = on * (1.0 - smoothstep(br, br * 2.1, dd)) * (1.0 - bS);
    bommie = mix(bommie, bS, bdS); halo = mix(halo, hS, bdS);
  }
  float onMean = 0.1 + 0.2 * field;
  float bL = onMean * 0.3, hL = onMean * 0.5;
  if (bdL > 0.0) {
    vec3 wl = worley2(pw / 70.0 + 3.1);
    float onL = step(0.9 - 0.2 * field, wl.z), dl = wl.x + lobe * 0.6;
    float kb = onL * (1.0 - smoothstep(0.2, 0.36, dl));
    bL = mix(bL, kb, bdL);
    hL = mix(hL, onL * (1.0 - smoothstep(0.36, 0.6, dl)) * (1.0 - kb), bdL);
  }
  bommie = max(bommie, bL);
  halo = max(halo * (1.0 - bL), hL);
  c = mix(c, c * 1.12 + vec3(0.03), halo * 0.8 * (1.0 - sg));
  cover = max(cover, bommie * (1.0 - smoothstep(17.0, 25.0, depth)));
  if (expo > 0.25) {
    // spur-and-groove: coral ridges running seaward, sand chutes between them
    float along = atan(p.y, p.x) * 6100.0;
    float sgv = sin(along * N_TAU / 24.0 + vnoise(p * 0.018) * 7.0);
    float spur = smoothstep(-0.25, 0.35, sgv) * smoothstep(1.2, 3.5, depth);
    cover = mix(cover, max(cover, spur), smoothstep(0.25, 0.7, expo));
    cover = max(cover, crest);
  }
  cover *= 1.0 - smoothstep(24.0, 40.0, depth);
  if (cover > 0.01) {
    float cf = 1.0 - smoothstep(0.8, 3.5, fw);
    vec3 avg = vec3(0.50, 0.42, 0.34);
    vec3 coral = avg;
    if (cf > 0.0) {
      vec3 cw = worley2(p / 2.1);
      float k = cw.z;
      vec3 pal = k < 0.16 ? vec3(0.42, 0.30, 0.18) : k < 0.32 ? vec3(0.62, 0.48, 0.24) : k < 0.46 ? vec3(0.36, 0.42, 0.22)
               : k < 0.58 ? vec3(0.46, 0.26, 0.44) : k < 0.70 ? vec3(0.74, 0.42, 0.46) : k < 0.84 ? vec3(0.22, 0.46, 0.48) : vec3(0.78, 0.72, 0.58);
      // colonies as rounded heads of muted colour (no stained-glass cells): each head is lit on
      // its crown, darker toward its rim, with polyp texture and dark crevices between heads
      pal = mix(avg, pal, 0.3);
      float polyp = vnoise(p * 3.1 + k * 40.0) * 0.6 + vnoise(p * 9.0 + k * 17.0) * 0.4;
      pal *= 0.72 + 0.4 * polyp;
      float dome = 1.0 - smoothstep(0.1, 0.75, cw.x);
      pal *= 0.7 + 0.4 * dome;
      pal *= 0.78 + 0.22 * smoothstep(0.0, 0.2, cw.y);         // dark crevices between colonies
      coral = mix(avg, pal, cf);
      vec3 bd = vnoised(p * 0.9 + k * 13.0);
      vec3 pd = vnoised(p * 6.0 + k * 9.0);
      hg += (bd.yz * 0.9 * 0.5 + pd.yz * 6.0 * 0.02 * (1.0 - smoothstep(0.1, 0.4, fw))) * cf * cover;
    }
    c = mix(c, coral, cover);
    ao *= mix(1.0, 0.72, cover);
  }
  // deep water: pale silt
  c = mix(c, vec3(0.44, 0.47, 0.42), smoothstep(22.0, 50.0, depth));
  return c;
}
`;

const COLOR = /* glsl */ `
{
  vec3 wp = vWPos;
  tPaved = 0.0;
  vec3 Ng = normalize(vWNrm);
  float slope = 1.0 - Ng.y;
  float dist = length(wp - cameraPosition);
  float fw = max(length(fwidth(wp.xz)), 1e-3);                // world metres per pixel
  vec4 info = infoAt(wp.xz);
  vec4 nat = natureAt(wp.xz, wp.y);
  float h = wp.y;
  float urban = max(info.y, 0.0);
  vec3 nAdd = vec3(0.0);
  vec2 hg = vec2(0.0);
  float ao = 1.0;
  float rough = 0.93;
  float m1 = fbm2(wp.xz * 0.0017);
  float m2 = vnoise(wp.xz * 0.013);
  float m3 = mix(0.5, vnoise(wp.xz * 0.11), 1.0 - smoothstep(1.5, 4.5, fw));   // 9 m mottling, averaged once under ~3 px
  float nearF = 1.0 - smoothstep(0.3, 1.1, fw);
  float midF = 1.0 - smoothstep(2.0, 9.0, fw);
  float expo = nat.y;
  float mountainZone = smoothstep(80.0, 420.0, h);
  float cloudF = smoothstep(700.0, 1200.0, h + m2 * 150.0) * (1.0 - smoothstep(1750.0, 2050.0, h));

  // the town plan: streets, squares and lamp light (urban.js)
  vec4 stS = streetAt(wp.xz);
  float stE = streetEdge(stS), stC = streetCentre(stS);
  float stHW = abs(stC) - stE;                       // half-width of the street we are on or beside
  float nearStreet = max(1.0 - smoothstep(3.0, 9.0, stE), smoothstep(0.1, 0.5, stS.b));
  // forest density: the surveyed mask inside the city grid, wild forest beyond it
  float forestD;
  if (info.z >= 0.0) forestD = info.z;
  else {
    forestD = max(smoothstep(0.3, 0.55, m1 + 0.2), smoothstep(30.0, 160.0, h));
    forestD *= smoothstep(2.0, 12.0, h) * (1.0 - smoothstep(1600.0, 1950.0, h + m2 * 260.0));
  }
  forestD *= 1.0 - nearStreet;
  if (info.z < 0.0) {
    float clear = smoothstep(0.52, 0.68, fbm2_3(wp.xz * 0.0011 + 17.0) + 0.35 * slope - 0.15 * m2);
    forestD *= 1.0 - clear * (0.35 + 0.55 * mountainZone) * (1.0 - cloudF * 0.7);
  }

  // zone weights
  float beachTop = 1.5 + 1.3 * m2 + 1.4 * expo;
  float wSub = 1.0 - smoothstep(-0.5, 0.12, h);
  float wVeg = smoothstep(beachTop - 0.5, beachTop + 0.9, h);
  float rockT = slope + (m2 - 0.5) * 0.2 + (m3 - 0.5) * 0.08 * midF;
  float wRock = smoothstep(mix(0.30, 0.48, mountainZone), mix(0.44, 0.64, mountainZone), rockT) * smoothstep(0.3, 3.0, h);
  wRock = max(wRock, smoothstep(1850.0, 2250.0, h + m1 * 320.0) * 0.8);

  // ---------------- sand, wet sand and wrack line ----------------
  vec3 sandDry = mix(vec3(0.68, 0.62, 0.50), vec3(0.78, 0.72, 0.61), m2) * mix(1.0, 0.9 + 0.2 * m3, midF);
  sandDry = mix(sandDry, vec3(0.66, 0.64, 0.60), expo * 0.4);
  float wetB = 1.0 - smoothstep(0.02, 0.5 + 0.3 * m3, h);
  vec3 sand = sandDry * mix(1.0, 0.6, wetB);
  float wrackH = 0.95 + 0.3 * vnoise(wp.xz * 0.018);
  float wrack = (1.0 - smoothstep(0.04, 0.22, abs(h - wrackH))) * smoothstep(0.3, 0.62, vnoise(wp.xz * 0.21 + 3.0));
  sand = mix(sand, vec3(0.24, 0.19, 0.13), wrack * mix(0.25, 0.8, midF) * (1.0 - 0.5 * expo));
  {
    float sd1 = 1.0 - smoothstep(0.04, 0.25, fw);        // ripples resolvable
    float sd2 = 1.0 - smoothstep(0.004, 0.03, fw);       // grains
    // wind ripples on the dry sand: crests ~12 cm apart, meandering, gone where the swash smooths it
    vec2 wdir = vec2(0.834, 0.552);
    float rph = dot(wp.xz, wdir) * 52.0 + vnoise(wp.xz * 0.9) * 6.0 + vnoise(wp.xz * 3.1) * 1.5;
    float ripA = sd1 * (1.0 - wetB) * (1.0 - smoothstep(0.08, 0.25, slope));
    hg += wdir * cos(rph) * 0.22 * ripA;
    sand *= 1.0 + 0.045 * sin(rph) * ripA;
    // grains, then shells and coral fragments
    sand *= mix(1.0, 0.9 + 0.2 * vnoise(wp.xz * 41.0), sd2);
    float sp = hash12(floor(wp.xz * 5.0));
    sand = mix(sand, vec3(0.95, 0.9, 0.84), step(0.985, sp) * (1.0 - smoothstep(0.03, 0.1, fw)) * (1.0 - wetB));
    sand *= 0.95 + 0.1 * mix(0.5, vnoise(wp.xz * 2.7), nearF);
    vec3 sn = vnoised(wp.xz * 0.6);
    hg += sn.yz * 0.6 * 0.12 * nearF;
    // megaripples (~1.2 m) and wind-scoured hummocks (~12 m): the relief that still reads from
    // the promenades, faded to flat once a crest spans under ~3 px
    float sdM = 1.0 - smoothstep(0.12, 0.45, fw);
    float mph = dot(wp.xz, vec2(0.62, 0.785)) * 5.2 + vnoise(wp.xz * 0.21) * 7.0;
    float megA = sdM * (1.0 - wetB) * (1.0 - smoothstep(0.1, 0.3, slope)) * (0.5 + 0.5 * vnoise(wp.xz * 0.05 + 9.0));
    hg += vec2(0.62, 0.785) * cos(mph) * 0.16 * megA;
    sand *= 1.0 + 0.05 * sin(mph) * megA;
    float sdH = 1.0 - smoothstep(1.5, 5.0, fw);
    vec3 hum = vnoised(wp.xz * 0.085 + 4.0);
    hg += hum.yz * 0.085 * 2.2 * sdH * (1.0 - wetB);
    sand *= mix(1.0, 0.94 + 0.12 * hum.x, sdH);
    // the swash: pale lines of foam residue parallel to the water's edge, a glossy film at the edge;
    // lines fade to their mean brightening once their 2.3 m spacing falls under a few pixels
    float sdist = nat.x;
    float sl = fract((sdist + vnoise(wp.xz * 0.12) * 3.0) / 2.3);
    float swR = 1.0 - smoothstep(0.35, 1.1, fw);
    float swash = mix(0.08, (1.0 - smoothstep(0.0, 0.05 + fw / 2.3, sl)), swR) * smoothstep(0.3, 1.2, sdist) * wetB;
    sand = mix(sand, sand * 1.3 + 0.04, swash * 0.55);
    // damp band above the waterline with a ragged, cusped upper edge, and the dark high-tide line
    float dampEdge = 5.0 + 3.5 * vnoise(wp.xz * 0.045) + 1.5 * sin(dot(wp.xz, vec2(0.21, -0.14)) + vnoise(wp.xz * 0.02) * 6.0);
    float damp = (1.0 - smoothstep(dampEdge - 1.0 - fw, dampEdge + 1.0 + fw, sdist)) * (1.0 - wetB) * smoothstep(-0.2, 0.3, h) * (1.0 - smoothstep(beachTop - 0.2, beachTop + 0.6, h));
    sand *= 1.0 - 0.18 * damp;
    float tideW = 0.35 + fw;
    float tideL = (1.0 - smoothstep(0.0, tideW, abs(sdist - dampEdge - 1.4))) * (0.35 / tideW + 0.65 * min(1.0, 0.35 / tideW)) * smoothstep(0.35, 0.6, vnoise(wp.xz * 0.09 + 13.0));
    sand = mix(sand, vec3(0.30, 0.25, 0.18), clamp(tideL, 0.0, 1.0) * 0.45 * (1.0 - wetB) * (1.0 - smoothstep(beachTop - 0.2, beachTop + 0.6, h)));
    rough = mix(rough, mix(0.3, 0.1, 1.0 - smoothstep(0.0, 1.2, sdist)), wetB);
    rough = mix(rough, 0.72, damp);
  }

  // ---------------- lagoon floor ----------------
  vec3 c = sand;
  if (wSub > 0.001) {
    vec3 reef = lagoonFloorColor(wp.xz, max(-h, 0.0), expo, nat.z, fw, hg, ao);
    c = mix(c, reef, wSub);
  }

  // ---------------- vegetation ----------------
  if (wVeg > 0.001) {
    vec3 grass = mix(vec3(0.07, 0.145, 0.028), vec3(0.15, 0.22, 0.05), clamp(m1 * 0.9 + m3 * 0.35 - 0.1, 0.0, 1.0));
    grass = mix(grass, vec3(0.22, 0.21, 0.09), smoothstep(0.58, 0.82, m2) * 0.35 * (1.0 - forestD));
    grass *= mix(1.0, 0.78 + 0.44 * vnoise(wp.xz * 1.4), nearF);
    grass = mix(grass, grass * vec3(1.3, 1.12, 0.78), mix(0.25, smoothstep(0.55, 0.8, vnoise(wp.xz * 0.05 + 21.0)), 1.0 - smoothstep(4.0, 12.0, fw)) * 0.45);
    {
      float gb = 1.0 - smoothstep(0.004, 0.03, fw);
      float blade = vnoise(wp.xz * vec2(31.0, 7.0)) * 0.5 + vnoise(wp.xz * vec2(9.0, 37.0)) * 0.5;
      grass *= mix(1.0, 0.8 + 0.4 * blade, gb);
      // (no painted flower cells: the wildflowers are real, in the ground cover)
      hg += vnoised(wp.xz * 5.0).yz * 0.05 * nearF;
      // tussocks and hummocks (~1.5 m and ~6 m): lumpy turf that reads in relief at mid range
      float tuF = 1.0 - smoothstep(0.4, 1.6, fw);
      vec3 tu = vnoised(wp.xz * 0.65 + 3.3);
      hg += tu.yz * 0.65 * 0.11 * tuF;
      grass *= mix(1.0, 0.9 + 0.2 * tu.x, tuF);
      vec3 hm = vnoised(wp.xz * 0.16 - 8.1);
      hg += hm.yz * 0.16 * 0.45 * (1.0 - smoothstep(2.0, 6.0, fw));
    }
    float strand = 1.0 - smoothstep(beachTop + 1.0, beachTop + 6.0, h);
    grass = mix(grass, vec3(0.2, 0.22, 0.08), strand * 0.55);
    grass = mix(grass, vec3(0.16, 0.17, 0.08), smoothstep(1700.0, 2000.0, h));    // montane heath
    {
      float mz = smoothstep(20.0, 160.0, h);
      float pa = fbm2_3(wp.xz * 0.0021 + 31.0);
      float pb = vnoise(wp.xz * 0.0063 - 17.0);
      grass = mix(grass, vec3(0.2, 0.2, 0.07), smoothstep(0.55, 0.7, pa) * 0.55 * mz);             // dry grassland
      grass = mix(grass, vec3(0.07, 0.11, 0.035), smoothstep(0.6, 0.75, pb) * 0.5 * mz);           // scrub
    }
    vec3 floorC = mix(vec3(0.055, 0.08, 0.03), vec3(0.13, 0.10, 0.055), vnoise(wp.xz * 0.33));
    floorC = mix(floorC, vec3(0.09, 0.14, 0.05), smoothstep(0.55, 0.75, vnoise(wp.xz * 0.08)));  // fern patches
    {
      float ld = 1.0 - smoothstep(0.01, 0.06, fw);
      if (ld > 0.0) {
        vec3 lw = worley2(wp.xz * 7.0);
        vec3 leafC = lw.z < 0.3 ? vec3(0.2, 0.12, 0.06) : lw.z < 0.6 ? vec3(0.28, 0.18, 0.08) : lw.z < 0.85 ? vec3(0.12, 0.09, 0.05) : vec3(0.3, 0.26, 0.1);
        leafC *= 0.7 + 0.5 * smoothstep(0.0, 0.15, lw.y);
        vec3 avgL = vec3(0.2, 0.135, 0.065) * 0.9;
        floorC = mix(floorC, floorC * (leafC / avgL), ld * 0.6);
      }
    }
    // Inside the surveyed grid the forest floor lies under real trees. Beyond it there is no
    // painted canopy (it read as flat cells of colour up close): woodland is deeper, shaded,
    // lusher grass with a little litter in it, continuous at every range, the same grassland
    // as the city's and carpeted with the same 3D grass near the viewer.
    float outerL = info.z >= 0.0 ? 0.0 : 1.0;
    vec3 veg = mix(grass, floorC, forestD * 0.9 * (1.0 - outerL));
    vec3 wood = mix(grass * vec3(0.7, 0.84, 0.72), floorC, 0.18) * (0.9 + 0.2 * mix(0.5, vnoise(wp.xz / 23.0), 1.0 - smoothstep(4.0, 12.0, fw)));
    veg = mix(veg, wood, forestD * outerL * 0.8);
    ao *= 1.0 - 0.12 * forestD * outerL;
    c = mix(c, veg, wVeg);
  }

  // ---------------- erosion rills and macro relief ----------------
  if (slope > 0.05 && h > 2.0) {
    vec2 down = normalize(Ng.xz + 1e-5);
    vec2 dir = vec2(down.y, -down.x);
    float amp = smoothstep(0.05, 0.28, slope);
    float S1 = mix(55.0, 150.0, mountainZone);
    float r1 = 1.0 - smoothstep(0.15, 0.4, fw / S1);
    vec3 e1 = erosionN(wp.xz / S1, dir);
    float A1 = 0.075 * amp * r1;
    hg += e1.yz * A1;
    float e2v = 0.0;
    float r2 = 1.0 - smoothstep(0.15, 0.4, fw / (S1 * 0.35));
    if (r2 > 0.0) {
      vec3 e2 = erosionN(wp.xz / (S1 * 0.35) + 7.1, dir);
      hg += e2.yz * 0.06 * amp * r2;
      e2v = e2.x * r2;
    }
    float ridge = (e1.x * r1 + 0.5 * e2v) * amp;
    c *= 1.0 + 0.16 * ridge;                       // lit ridges, darker damp gullies
    ao *= 1.0 - 0.18 * max(-ridge, 0.0);
    wRock = clamp(wRock + 0.12 * ridge * mountainZone, 0.0, 1.0);
    if (mountainZone > 0.0) {
      float scree = smoothstep(0.35, 0.8, ridge) * smoothstep(0.2, 0.45, slope) * mountainZone;
      c = mix(c, vec3(0.3, 0.28, 0.24), scree * 0.55);
      float along = dot(wp.xz, down), across = dot(wp.xz, dir);
      float scar = smoothstep(0.72, 0.82, vnoise(vec2(across * 0.012, along * 0.0022) + 5.0)) * smoothstep(0.28, 0.5, slope) * mountainZone;
      c = mix(c, vec3(0.34, 0.22, 0.13) * (0.85 + 0.3 * vnoise(vec2(across * 0.05, along * 0.01))), scar * 0.7);
      wRock = clamp(wRock + 0.3 * scar, 0.0, 1.0);
    }
  }
  if (mountainZone > 0.0) {
    // relief below the mesh resolution of the far highlands
    vec3 d1 = vnoised(wp.xz * 0.0031 + 3.0);
    vec3 d2 = vnoised(wp.xz * 0.0093 - 5.0);
    vec3 d3 = vnoised(wp.xz * 0.027 + 9.0);
    hg += (d1.yz * 0.0031 * 60.0 + d2.yz * 0.0093 * 18.0 * midF + d3.yz * 0.027 * 5.0 * midF) * mountainZone;
  }

  // ---------------- basalt cliffs with strata ----------------
  if (wRock > 0.01) {
    float warp = fbm2_3(wp.xz * 0.004) * 34.0 + vnoise(wp.xz * 0.031) * 7.0;
    float sy = wp.y + warp;
    float band = vnoise(vec2(sy * 0.085, 0.5));
    float band2 = vnoise(vec2(sy * 0.42, 3.1));
    vec3 basalt = mix(vec3(0.15, 0.14, 0.13), vec3(0.27, 0.25, 0.22), band);
    vec3 rockC = mix(basalt, vec3(0.42, 0.30, 0.20), smoothstep(0.64, 0.82, band) * 0.75);   // oxidised tuff
    rockC *= 0.84 + 0.32 * band2 * midF;
    vec2 an = abs(Ng.xz);
    float hc = an.x > an.y ? wp.z : wp.x;
    float streak = vnoise(vec2(hc * 0.3, wp.y * 0.011));
    rockC *= 0.78 + 0.36 * streak;
    {
      float rd = 1.0 - smoothstep(0.1, 0.6, fw);
      if (rd > 0.0) {
        vec3 fr = worley2(vec2(hc, wp.y + warp * 0.2) * vec2(0.45, 0.8));
        float crack = 1.0 - smoothstep(0.0, 0.04 + fw * 0.6, fr.y);
        rockC *= mix(1.0, (1.0 - 0.45 * crack) * (0.88 + 0.24 * fr.z), rd);
        rockC *= mix(1.0, 0.88 + 0.24 * vnoise(vec2(hc, wp.y) * 7.0), 1.0 - smoothstep(0.02, 0.1, fw));
        rockC = mix(rockC, vec3(0.55, 0.56, 0.48), smoothstep(0.74, 0.86, vnoise(vec2(hc, wp.y) * 0.6 + 4.0)) * 0.35 * rd);   // lichen
      }
    }
    float mossM = smoothstep(0.45, 0.75, vnoise(vec2(hc * 0.045, wp.y * 0.05)) + 0.35 * cloudF + 0.25 * (1.0 - slope));
    rockC = mix(rockC, vec3(0.08, 0.14, 0.05), mossM * 0.65 * (1.0 - smoothstep(1900.0, 2250.0, h)));
    vec3 upT = normalize(vec3(0.0, 1.0, 0.0) - Ng * Ng.y + vec3(1e-4));
    float db = vnoise(vec2((sy + 0.7) * 0.42, 3.1)) - vnoise(vec2((sy - 0.7) * 0.42, 3.1));
    float db2 = vnoise(vec2((sy + 2.0) * 0.085, 0.5)) - vnoise(vec2((sy - 2.0) * 0.085, 0.5));
    nAdd += upT * (db * 1.6 * midF + db2 * 1.2) * wRock;
    vec3 sideT = normalize(cross(Ng, upT));
    float ds = vnoise(vec2((hc + 0.6) * 0.3, wp.y * 0.011)) - vnoise(vec2((hc - 0.6) * 0.3, wp.y * 0.011));
    nAdd += sideT * ds * 1.2 * midF * wRock;
    {
      // joint blocks (~3 m): each block face tilts its own way and the joints between them are
      // shadowed, so the cliff reads as faceted stone rather than painted bands; the facets
      // average out (no tilt, mean joint shade) once a block spans only a few pixels
      float bf = 1.0 - smoothstep(0.35, 1.4, fw);
      if (bf > 0.0) {
        vec3 jb = worley2(vec2(hc, sy) * vec2(0.3, 0.42) + 11.0);
        float joint = 1.0 - smoothstep(0.0, 0.06 + fw * 0.35, jb.y);
        rockC *= mix(0.9, 1.0 - 0.4 * joint, bf);
        nAdd += (sideT * (fract(jb.z * 7.31) - 0.5) + upT * (fract(jb.z * 3.17) - 0.5)) * 0.55 * bf * (1.0 - joint) * wRock;
        ao *= mix(1.0, 1.0 - 0.35 * joint, bf * wRock);
      } else {
        rockC *= 0.9;
      }
    }
    c = mix(c, rockC, wRock);
    rough = mix(rough, 0.8, wRock);
  }

  // ---------------- the garden city: streets, verges, lawns, squares ----------------
  if ((urban > 0.05 || nearStreet > 0.01) && wVeg > 0.001) {
    float aa = max(fw, 0.08);
    float onStreet = 1.0 - smoothstep(-aa, aa, stE);
    float square = smoothstep(0.3, 0.7, stS.b);
    float isAve = smoothstep(6.5, 7.5, stHW);
    float isLane = 1.0 - smoothstep(3.6, 4.4, stHW);
    float pd = 1.0 - smoothstep(0.012, 0.07, fw);        // joints and arrises resolvable
    float pt = 1.0 - smoothstep(0.1, 0.45, fw);          // stone-to-stone tone resolvable
    float pg = 1.0 - smoothstep(0.004, 0.025, fw);       // grain within a stone
    // the street frame: metres along / across the owning street (urban.js), and the kerb
    // line from it wherever it agrees with the coarse field
    vec2 gAl = vec2(0.0), gAc = vec2(0.0);
    vec2 sf = (pt > 0.0 || nearF > 0.0) ? streetFrameG(wp.xz, gAl, gAc) : vec2(0.0, stC);
    float al = sf.x, ac = sf.y;
    float hwS = stHW < 4.0 ? 3.0 : stHW < 5.75 ? 5.0 : stHW < 7.75 ? 6.5 : 9.0;
    float eP = abs(ac) - hwS;
    float e = abs(eP - stE) < 0.6 ? eP : stE;
    vec2 gE = (ac < 0.0 ? -1.0 : 1.0) * gAc;             // world direction out toward the kerb
    // field paving (what it reads as from afar: stone tone with its joints mixed in):
    // pale granite setts on streets, warm granite slabs on avenues, clay pavers on lanes
    vec3 settC = vec3(0.54, 0.52, 0.48), slabC = vec3(0.57, 0.53, 0.47), brickC = vec3(0.56, 0.41, 0.31);
    vec3 jointC = mix(vec3(0.25, 0.23, 0.2), vec3(0.15, 0.19, 0.09), 0.4 * (1.0 - isAve));  // sand, a little moss
    vec3 base = mix(mix(settC, slabC, isAve), brickC, isLane) * (0.94 + 0.12 * m3);
    float jf = mix(mix(0.13, 0.025, isAve), 0.09, isLane);
    vec3 stone = mix(base, jointC, jf);
    float roughS = 0.62;
    if (pt > 0.0) {
      float joint, sid;
      if (isLane > 0.5) {
        // lanes: clay pavers laid in basketweave
        vec2 q = vec2(al, ac) * 10.0;
        float fq = fw * 10.0;
        vec2 cb = floor(q * 0.5);
        float hz = mod(cb.x + cb.y, 2.0);
        vec2 lq = q - cb * 2.0;
        float jc = max(1.0 - filteredPulse(q.x, 2.0, 1.9, fq), 1.0 - filteredPulse(q.y, 2.0, 1.9, fq));
        float jm = mix(1.0 - filteredPulse(q.x - 1.0, 2.0, 1.9, fq), 1.0 - filteredPulse(q.y - 1.0, 2.0, 1.9, fq), hz);
        joint = max(jc, jm);
        sid = hash12(cb * 2.0 + (hz > 0.5 ? vec2(0.0, step(1.0, lq.y)) : vec2(step(1.0, lq.x), 0.0)) + 7.0);
        vec3 clay = mix(vec3(0.48, 0.32, 0.23), vec3(0.66, 0.49, 0.35), sid);
        clay = mix(clay, vec3(0.36, 0.3, 0.27), step(0.9, fract(sid * 11.3)));        // a few clinkers
        base = mix(base, clay * (0.94 + 0.12 * m3), pt);
        hg -= (gAl * nBevel(mod(q.x, 1.0) - 0.1, 0.9, 0.12) + gAc * nBevel(mod(q.y, 1.0) - 0.1, 0.9, 0.12)) * 0.03 * (1.0 - smoothstep(0.006, 0.024, fw));
      } else if (isAve > 0.5) {
        // avenues: 0.6 x 1.2 m granite slabs in running bond across the street
        float row = floor(al / 0.6);
        float x = ac + mod(row, 2.0) * 0.6;
        sid = hash12(vec2(floor(x / 1.2), row) + 3.0);
        joint = max(1.0 - filteredPulse(al, 0.6, 0.592, fw), 1.0 - filteredPulse(x, 1.2, 1.192, fw));
        base *= mix(1.0, 0.86 + 0.28 * sid, pt);
        hg -= (gAl * nBevel(mod(al, 0.6) - 0.008, 0.592, 0.012) + gAc * nBevel(mod(x, 1.2) - 0.008, 1.192, 0.012)) * 0.4 * (1.0 - smoothstep(0.006, 0.024, fw));
      } else {
        // streets: granite setts in courses across the street
        float course = floor(al / 0.15);
        float sl = 0.17 + 0.08 * hash11(course * 1.37 + 0.3);
        float x = ac + hash11(course * 2.71) * sl;
        sid = hash12(vec2(floor(x / sl), course) + 11.0);
        joint = max(1.0 - filteredPulse(al, 0.15, 0.138, fw), 1.0 - filteredPulse(x, sl, sl - 0.012, fw));
        base *= mix(1.0, 0.8 + 0.4 * sid, pt);
        base *= 1.0 + vec3(0.03, 0.0, -0.04) * (fract(sid * 7.7) - 0.5) * pt;            // warm and grey setts
        hg -= (gAl * nBevel(mod(al, 0.15) - 0.012, 0.138, 0.02) + gAc * nBevel(mod(x, sl) - 0.012, sl - 0.012, 0.02)) * 0.5 * (1.0 - smoothstep(0.01, 0.04, fw));
      }
      base *= mix(1.0, 0.9 + 0.2 * vnoise(wp.xz * 11.0 + sid * 17.0), pd);                  // grain
      base *= 1.0 - 0.12 * smoothstep(0.78, 0.94, vnoise(wp.xz * 43.0)) * pg;                // mica and feldspar flecks
      hg += (hash22(vec2(sid * 91.0, 3.0)) - 0.5) * 0.045 * pd;                             // each stone a touch uneven
      ao *= 1.0 - 0.35 * joint * pd;
      stone = mix(stone, mix(base, jointC, joint), pt);
    }
    // squares: limestone flags in running bond with a basalt border course
    if (square > 0.01) {
      vec3 flag = vec3(0.64, 0.62, 0.58) * (0.95 + 0.1 * m3);
      float border = smoothstep(0.3, 0.36, stS.b) * (1.0 - smoothstep(0.5, 0.56, stS.b));
      vec3 flagFar = mix(mix(flag, jointC, 0.03), vec3(0.24, 0.24, 0.25), border * 0.8);
      vec3 flagC = flagFar;
      if (pt > 0.0) {
        float row = floor(wp.z / 0.8);
        float x = wp.x + mod(row, 2.0) * 0.4;
        float fid = hash12(vec2(floor(x / 0.8), row) + 5.0);
        float j = max(1.0 - filteredPulse(wp.z, 0.8, 0.79, fw), 1.0 - filteredPulse(x, 0.8, 0.79, fw));
        vec3 f1 = flag * (0.88 + 0.24 * fid) * (0.92 + 0.16 * mix(0.5, vnoise(wp.xz * 7.0 + fid * 13.0), pd));
        f1 = mix(f1, vec3(0.24, 0.24, 0.25) * (0.85 + 0.3 * fid), border * 0.8);
        hg += (hash22(vec2(fid * 57.0, 1.0)) - 0.5) * 0.03 * pd;
        hg -= (vec2(0.0, 1.0) * nBevel(mod(wp.z, 0.8) - 0.01, 0.79, 0.01) + vec2(1.0, 0.0) * nBevel(mod(x, 0.8) - 0.01, 0.79, 0.01)) * 0.35 * (1.0 - smoothstep(0.005, 0.02, fw));
        ao *= 1.0 - 0.3 * j * pd;
        flagC = mix(flagFar, mix(f1, jointC, j), pt);
      }
      stone = mix(stone, flagC, square);
    }
    if (nearF > 0.0 || pt > 0.0) {
      float kd = max(nearF, pt);
      // kerbs: pale granite in 1 m lengths with a rounded arris; the upstand shades a thin line
      float kerb = (1.0 - smoothstep(-aa * 0.5, aa * 0.5, e)) * smoothstep(-0.42 - aa * 0.5, -0.42 + aa * 0.5, e) * (1.0 - square);
      float kj = 1.0 - filteredPulse(al, 1.0, 0.992, fw);
      vec3 kerbC = vec3(0.70, 0.68, 0.64) * (0.92 + 0.1 * vnoise(wp.xz * 3.0)) * (0.94 + 0.12 * hash11(floor(al) + 3.0) * pt);
      kerbC = mix(kerbC, jointC, kj * pd);
      stone = mix(stone, kerbC, kerb * kd);
      hg += gE * (1.0 - smoothstep(-0.42, -0.33, e)) * kerb * 0.9 * pd;
      ao *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.03 + fw, abs(e + 0.43))) * (1.0 - square) * onStreet * kd;
      // gutter: two courses of dark basalt setts along the kerb, a cast grate every 24 m
      float gut = smoothstep(-0.98 - aa * 0.5, -0.98 + aa * 0.5, e) * (1.0 - smoothstep(-0.42 - aa * 0.5, -0.42 + aa * 0.5, e)) * (1.0 - isLane) * (1.0 - square);
      float gj = max(1.0 - filteredPulse(al, 0.14, 0.128, fw), 1.0 - filteredPulse(e + 0.98, 0.28, 0.268, fw));
      vec3 gutC = mix(vec3(0.27, 0.27, 0.28) * (0.85 + 0.3 * hash12(vec2(floor(al / 0.14), floor((e + 0.98) / 0.28))) * pt), jointC * 0.8, gj);
      float grate = fBoxT(vec2(mod(al, 24.0) - 12.0, e + 0.7), vec2(-0.3, -0.22), vec2(0.3, 0.22), fw) * gut;
      float slots = 1.0 - filteredPulse(al, 0.05, 0.03, fw);
      gutC = mix(gutC, vec3(0.06, 0.06, 0.065) * (0.6 + 0.4 * slots), grate);
      stone = mix(stone, gutC, gut * kd);
      roughS = mix(roughS, 0.42, gut * kd);
      ao *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.3, abs(e + 0.5))) * (1.0 - square) * onStreet;
      // bronze inlay down the middle of the streets and esplanades (it glows at night)
      float inlay = (1.0 - smoothstep(0.06, 0.06 + aa, abs(ac))) * (1.0 - isAve) * (1.0 - isLane) * onStreet * (1.0 - square);
      stone = mix(stone, vec3(0.55, 0.38, 0.2), inlay * kd);
      roughS = mix(roughS, 0.3, inlay * kd);
    }
    // avenue median: a planted strip with its own kerbs
    float median = isAve * (1.0 - smoothstep(2.1, 2.1 + aa, abs(ac))) * onStreet * (1.0 - square);
    // lawns: close up the blades, clover drifts and the odd daisy
    vec3 lawn = mix(vec3(0.075, 0.15, 0.03), vec3(0.12, 0.21, 0.045), m3);
    lawn = mix(lawn, vec3(0.16, 0.19, 0.07), smoothstep(0.6, 0.85, m2) * 0.4);
    lawn *= mix(1.0, 0.8 + 0.4 * vnoise(wp.xz * 1.9), nearF);
    {
      // mown and drier patches a dozen metres across
      float dry = mix(0.25, smoothstep(0.55, 0.8, vnoise(wp.xz * 0.07 + 13.0)), 1.0 - smoothstep(3.0, 8.0, fw));
      lawn = mix(lawn, lawn * vec3(1.35, 1.14, 0.76), dry * 0.6);
      lawn *= 0.9 + 0.2 * mix(0.5, vnoise(wp.xz * 0.21 + 4.0), 1.0 - smoothstep(1.0, 3.0, fw));
      // the larger lawns are left unmown in places: longer, tawnier grass with drifts of
      // wildflowers (one colour to a drift) inside a crisp mown edge
      float mw = smoothstep(0.58, 0.62, fbm2_3(wp.xz * 0.009 + 21.0));
      vec3 meadowC = lawn * vec3(1.22, 1.08, 0.72) * (0.86 + 0.28 * mix(0.5, vnoise(wp.xz * 0.6 + 2.0), 1.0 - smoothstep(0.5, 1.5, fw)));
      float flw = mix(0.016, smoothstep(0.78, 0.9, vnoise(wp.xz * 3.7)) * smoothstep(0.4, 0.7, vnoise(wp.xz * 0.3 + 8.0)), 1.0 - smoothstep(0.08, 0.3, fw));
      meadowC = mix(meadowC, flowerPalette(vnoise(wp.xz * 0.05 + 3.0)) * 0.8, flw * 0.8);
      lawn = mix(lawn, meadowC, mw);
      // desire lines worn across the mown grass (energy-conserving, so they thin to their
      // average rather than breaking up at range)
      vec3 dl = vnoised(wp.xz * 0.02 + 40.0);
      float dfw = max((abs(dl.y) + abs(dl.z)) * fw * 0.02, 1e-5);
      float wl = clamp(1.0 - abs(dl.x - 0.5) / max(0.012, dfw), 0.0, 1.0) * min(1.0, 0.012 / dfw) * (1.0 - mw);
      lawn = mix(lawn, vec3(0.28, 0.25, 0.17), wl * 0.65);
    }
    if (pd > 0.0) {
      float blade = vnoise(wp.xz * vec2(31.0, 7.0)) * 0.5 + vnoise(wp.xz * vec2(9.0, 37.0)) * 0.5;
      float clover = smoothstep(0.62, 0.78, vnoise(wp.xz * 0.9 + 3.0));
      lawn *= mix(1.0, 0.82 + 0.36 * blade, pg);
      lawn = mix(lawn, lawn * vec3(0.8, 1.05, 0.9), clover * pd * 0.6);
      lawn = mix(lawn, vec3(0.85, 0.84, 0.76), step(0.93, hash12(floor(wp.xz * 9.0))) * clover * pg);
      hg += vnoised(wp.xz * 5.0).yz * 0.06 * pd;
    }
    // verge beds between the kerb and the building line: a clipped hedge on the kerb side,
    // then drifts of perennials over dark mulch
    float border = smoothstep(0.35, 0.8, e) * (1.0 - smoothstep(2.6, 3.2, e)) * (1.0 - isLane) * (1.0 - square);
    border = max(border, median * (1.0 - smoothstep(1.5, 1.9, abs(ac))));
    border *= midF;
    float bd = 1.0 - smoothstep(0.12, 0.5, fw);
    vec3 bedC = vec3(0.07, 0.095, 0.04);
    if (bd > 0.0 && border > 0.0) {
      vec3 wv = worley2(wp.xz * 0.9);
      vec3 fc = flowerPalette(fract(wv.z * 7.3));
      float plant = 1.0 - smoothstep(0.3, 0.66, wv.x);
      float bloom = smoothstep(0.5, 0.75, vnoise(wp.xz * 6.0 + wv.z * 20.0)) * step(0.55, fract(wv.z * 3.7));
      vec3 foliage = mix(vec3(0.03, 0.07, 0.02), vec3(0.1, 0.16, 0.045), fract(wv.z * 3.1)) * (0.75 + 0.5 * vnoise(wp.xz * 4.0));
      vec3 bedN = mix(vec3(0.09, 0.065, 0.045), mix(foliage, fc * 0.7, bloom * 0.7), plant);
      float hedge = smoothstep(0.35, 0.42, e) * (1.0 - smoothstep(0.88, 0.95, e)) * (1.0 - median);
      bedN = mix(bedN, vec3(0.035, 0.085, 0.022) * (0.8 + 0.4 * vnoise(wp.xz * 7.0)), hedge);
      hg += vnoised(wp.xz * 4.0 + wv.z * 5.0).yz * 0.25 * bd * max(plant, hedge);
      ao *= mix(1.0, 0.7 + 0.3 * plant, bd * (1.0 - hedge));
      bedC = mix(bedC, bedN, bd);
    }
    lawn = mix(lawn, bedC, border);
    ao *= 1.0 - border * 0.2;
    float paved = max(onStreet * (1.0 - median), square);
    vec3 urbanC = mix(lawn, stone, paved);
    float uw = max(smoothstep(0.08, 0.4, urban), nearStreet) * wVeg * (1.0 - wRock * 0.7);
    c = mix(c, urbanC, uw);
    rough = mix(rough, mix(0.9, roughS, paved), uw);
    ao = mix(ao, 1.0, uw * paved * 0.3);
    tUrban = max(urban, nearStreet) * uw;
    tPaved = paved * uw;
  } else {
    tUrban = 0.0;
  }

  tRock = wRock;
  tWet = wetB * (1.0 - wVeg);
  tRough = rough;
  tAO = ao;
  vec3 gN = vec3(-hg.x, 0.0, -hg.y);
  gN -= Ng * dot(gN, Ng);
  tN = normalize(Ng + gN + nAdd);
  diffuseColor.rgb = c;
}
`;

const SURFACE = /* glsl */ `roughnessFactor = tRough;`;

const NORMAL = /* glsl */ `normal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);`;

const LIGHTS = /* glsl */ `
reflectedLight.indirectDiffuse *= tAO;
reflectedLight.indirectSpecular *= tAO;
reflectedLight.directDiffuse *= mix(1.0, tAO, 0.5);
`;

const EMISSIVE = /* glsl */ `
{
  // street lamps pool warm light on the paving and verges (baked from the real lamp posts)
  if (tUrban > 0.02 && uCityLights > 0.0) {
    vec4 st = streetAt(vWPos.xz);
    float pool = st.a * st.a;
    vec3 warm = vec3(1.0, 0.74, 0.48);
    totalEmissiveRadiance += diffuseColor.rgb * warm * pool * uCityLights * 0.9;
    // the bronze inlays glow faintly, a guide line home
    float inl = (1.0 - smoothstep(0.05, 0.2, abs(streetCentre(st)))) * (1.0 - smoothstep(-0.2, 0.2, streetEdge(st))) * smoothstep(4.4, 5.0, abs(streetCentre(st)) - streetEdge(st)) * (1.0 - smoothstep(6.5, 7.5, abs(streetCentre(st)) - streetEdge(st)));
    totalEmissiveRadiance += vec3(1.0, 0.62, 0.3) * inl * uCityLights * 0.06;
  }
}
`;

const PRE_AERIAL = /* glsl */ `
{
  // seen through the lagoon: red light is absorbed on the way down and back up,
  // sunlight is focused into dancing caustics on the sand
  float depthW = -vWPos.y;
  if (depthW > 0.0) {
    vec3 V = normalize(cameraPosition - vWPos);
    float path = depthW + depthW / max(V.y, 0.2);
    vec3 Tw = exp(-vec3(0.30, 0.055, 0.030) * path);
    vec2 cp = vWPos.xz * 0.32;
    vec3 w1 = worley2(cp + vec2(uTime * 0.21, uTime * 0.13));
    vec3 w2 = worley2(cp * 1.37 - vec2(uTime * 0.17, -uTime * 0.19) + 5.0);
    float caus = pow(1.0 - smoothstep(0.0, 0.16, w1.y), 2.0) * 0.6 + pow(1.0 - smoothstep(0.0, 0.14, w2.y), 2.0) * 0.5;
    float fwc = length(fwidth(cp));
    caus = mix(caus, 0.25, smoothstep(0.3, 1.2, fwc));
    caus *= 1.8 * exp(-depthW * 0.1) * smoothstep(0.0, 0.6, depthW);
    gl_FragColor.rgb = gl_FragColor.rgb * Tw * (1.0 + caus * max(uSunDir.y, 0.0) * (1.0 - uNight));
  }
}
`;

export function createTerrainShaderMaterial(infoTex, natureTex, half) {
  const uniforms = { uInfo: { value: infoTex }, uNature: { value: natureTex }, uInfoHalf: { value: half }, uBloom: NATURE_U.uBloom, uStreets: NATURE_U.uStreets, uStreetFrame: NATURE_U.uStreetFrame, uStreetHalf: NATURE_U.uStreetHalf };
  return patchedMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0, envMapIntensity: 0.6 }, {
    key: 'terrain2',
    uniforms,
    fragment: { pars: PARS, color: COLOR, surface: SURFACE, normal: NORMAL, lights: LIGHTS, emissive: EMISSIVE, preAerial: PRE_AERIAL },
  });
}
