import { patchedMaterial } from './materials.js';
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
float tUrban; float tRock; float tWet; float tRough; float tAO;
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
  float cover = smoothstep(9.0, 2.5, depth) * (0.45 + 0.55 * smoothstep(0.3, 0.62, vnoise(p * 0.028)));
  vec3 wb = worley2(p / 17.0);
  float bommie = step(0.58, wb.z) * (1.0 - smoothstep(0.22, 0.42 * (0.7 + 0.5 * fract(wb.z * 7.1)), wb.x));
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
      float polyp = vnoise(p * 3.1 + k * 40.0);
      pal *= 0.72 + 0.4 * polyp;
      pal *= 0.5 + 0.5 * smoothstep(0.0, 0.22, cw.y);          // dark crevices between colonies
      coral = mix(avg, pal, cf);
      vec3 bd = vnoised(p * 0.9 + k * 13.0);
      hg += bd.yz * 0.9 * 0.5 * cf * cover;
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
  float m3 = vnoise(wp.xz * 0.11);
  float nearF = 1.0 - smoothstep(0.3, 1.1, fw);
  float midF = 1.0 - smoothstep(2.0, 9.0, fw);
  float expo = nat.y;
  float mountainZone = smoothstep(80.0, 420.0, h);
  float cloudF = smoothstep(700.0, 1200.0, h + m2 * 150.0) * (1.0 - smoothstep(1750.0, 2050.0, h));

  // forest density: the surveyed mask inside the city grid, wild forest beyond it
  float forestD;
  if (info.z >= 0.0) forestD = info.z;
  else {
    forestD = max(smoothstep(0.3, 0.55, m1 + 0.2), smoothstep(30.0, 160.0, h));
    forestD *= smoothstep(2.0, 12.0, h) * (1.0 - smoothstep(1600.0, 1950.0, h + m2 * 260.0));
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
  if (nearF > 0.0) {
    // footprint-scale sand texture and a few shells / coral fragments
    float sp = hash12(floor(wp.xz * 5.0));
    sand *= 0.93 + 0.1 * vnoise(wp.xz * 2.7);
    sand = mix(sand, vec3(0.95, 0.9, 0.84), step(0.985, sp) * nearF * (1.0 - wetB));
    vec3 sn = vnoised(wp.xz * 0.6);
    hg += sn.yz * 0.6 * 0.12 * nearF;
  }
  rough = mix(rough, 0.28, wetB);

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
    float strand = 1.0 - smoothstep(beachTop + 1.0, beachTop + 6.0, h);
    grass = mix(grass, vec3(0.2, 0.22, 0.08), strand * 0.55);
    grass = mix(grass, vec3(0.16, 0.17, 0.08), smoothstep(1700.0, 2000.0, h));    // montane heath
    vec3 floorC = mix(vec3(0.055, 0.08, 0.03), vec3(0.13, 0.10, 0.055), vnoise(wp.xz * 0.33));
    floorC = mix(floorC, vec3(0.09, 0.14, 0.05), smoothstep(0.55, 0.75, vnoise(wp.xz * 0.08)));  // fern patches
    float canopyW = forestD * smoothstep(110.0, 360.0, dist);
    vec3 veg = mix(grass, floorC, forestD * (1.0 - canopyW) * 0.9);
    if (canopyW > 0.01) {
      float S = mix(10.0, 7.5, mountainZone);
      vec4 cr = crownField(wp.xz, S);
      float res = 1.0 - smoothstep(0.22, 0.55, fw / S);
      float id = cr.w;
      vec3 base = mix(vec3(0.045, 0.12, 0.03), vec3(0.11, 0.21, 0.05), fract(id * 7.31));
      base = mix(base, vec3(0.17, 0.25, 0.07), step(0.87, id));                        // pale emergents
      base = mix(base, vec3(0.15, 0.18, 0.13), step(0.955, fract(id * 13.1)) * 0.85);  // silvery cecropia
      float bloomSel = step(0.935, fract(id * 31.7)) * uBloom * (1.0 - 0.6 * mountainZone);
      base = mix(base, flowerPalette(fract(id * 53.9)) * 0.8, bloomSel);
      base = mix(base, base * vec3(0.75, 0.93, 1.08) + vec3(0.0, 0.008, 0.014), cloudF);
      vec3 crownC = base * (0.3 + 0.7 * cr.z) * (0.85 + 0.3 * vnoise(wp.xz * 0.9) * res);
      float grp = vnoise(wp.xz / 31.0);
      vec3 avg = mix(vec3(0.05, 0.115, 0.03), vec3(0.085, 0.165, 0.042), m2) * mix(vec3(1.0), vec3(0.8, 0.95, 1.06), cloudF);
      vec3 canC = mix(avg, crownC, res) * (0.8 + 0.4 * grp);
      hg += cr.xy * res;
      ao *= mix(1.0, 0.55 + 0.45 * cr.z, res * canopyW);
      ao *= mix(1.0, 0.8, canopyW * (1.0 - res));                                   // unresolved canopy self-shadowing
      veg = mix(veg, canC, canopyW);
    }
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
    float mossM = smoothstep(0.45, 0.75, vnoise(vec2(hc * 0.045, wp.y * 0.05)) + 0.35 * cloudF + 0.25 * (1.0 - slope));
    rockC = mix(rockC, vec3(0.08, 0.14, 0.05), mossM * 0.65 * (1.0 - smoothstep(1900.0, 2250.0, h)));
    vec3 upT = normalize(vec3(0.0, 1.0, 0.0) - Ng * Ng.y + vec3(1e-4));
    float db = vnoise(vec2((sy + 0.7) * 0.42, 3.1)) - vnoise(vec2((sy - 0.7) * 0.42, 3.1));
    float db2 = vnoise(vec2((sy + 2.0) * 0.085, 0.5)) - vnoise(vec2((sy - 2.0) * 0.085, 0.5));
    nAdd += upT * (db * 1.6 * midF + db2 * 1.2) * wRock;
    vec3 sideT = normalize(cross(Ng, upT));
    float ds = vnoise(vec2((hc + 0.6) * 0.3, wp.y * 0.011)) - vnoise(vec2((hc - 0.6) * 0.3, wp.y * 0.011));
    nAdd += sideT * ds * 1.2 * midF * wRock;
    c = mix(c, rockC, wRock);
    rough = mix(rough, 0.8, wRock);
  }

  // ---------------- the garden city: lawns, beds, walks, plazas ----------------
  if (urban > 0.05 && wVeg > 0.001) {
    float paved = pavedMask(wp.xz, urban, fw);
    vec3 stone = mix(vec3(0.44, 0.42, 0.38), vec3(0.54, 0.51, 0.46), m3);
    if (nearF > 0.0) {
      // flagstones with dark joints, worn and weathered
      vec3 fl = worley2(wp.xz * 0.75);
      stone *= mix(1.0, (0.86 + 0.2 * fl.z) * (0.62 + 0.38 * smoothstep(0.0, 0.07, fl.y)) * (0.9 + 0.2 * vnoise(wp.xz * 6.0)), nearF);
      stone = mix(stone, vec3(0.12, 0.16, 0.06), (1.0 - smoothstep(0.0, 0.05, fl.y)) * 0.5 * nearF);   // moss in the joints
    }
    vec3 lawn = mix(vec3(0.075, 0.15, 0.03), vec3(0.12, 0.21, 0.045), m3);
    lawn = mix(lawn, vec3(0.16, 0.19, 0.07), smoothstep(0.6, 0.85, m2) * 0.4);
    lawn *= mix(1.0, 0.8 + 0.4 * vnoise(wp.xz * 1.9), nearF);
    // herbaceous borders along the walks: dark foliage with flower heads
    float wd = walkDist(wp.xz, urban);
    float border = smoothstep(2.9, 3.4, wd) * (1.0 - smoothstep(4.8, 5.6, wd)) * smoothstep(0.35, 0.55, vnoise(wp.xz * 0.045 + 5.0));
    border *= midF * smoothstep(0.2, 0.45, urban);
    vec3 foliage = vec3(0.05, 0.10, 0.03) * (0.8 + 0.4 * vnoise(wp.xz * 1.1));
    float fk = hash12(floor(wp.xz * 0.06 + 9.0));
    vec3 fc = flowerPalette(fk);
    float dots = smoothstep(0.55, 0.75, vnoise(wp.xz * 4.5 + fk * 30.0));
    vec3 bedC = mix(foliage, fc * 0.8, mix(0.28, dots * 0.9, nearF));
    lawn = mix(lawn, bedC, border);
    ao *= 1.0 - border * 0.25;
    vec3 urbanC = mix(lawn, stone, paved);
    float uw = smoothstep(0.08, 0.4, urban) * wVeg * (1.0 - wRock * 0.7);
    c = mix(c, urbanC, uw);
    rough = mix(rough, mix(0.9, 0.55, paved), uw);
    ao = mix(ao, 1.0, uw * paved);
    tUrban = urban * uw;
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
  // lamp-lit walks in the garden city at night
  float u = tUrban;
  if (u > 0.05 && uCityLights > 0.0) {
    vec2 p = vWPos.xz;
    vec2 q = p / 14.0;
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    float lamp = step(0.55, hash12(cell)) * smoothstep(0.22, 0.0, length(f - (hash22(cell) - 0.5) * 0.5));
    float dist = length(vWPos - cameraPosition);
    float fwp = max(length(fwidth(p)), 1e-3);
    float walk = pavedMask(p, u, fwp);
    float far = smoothstep(900.0, 5000.0, dist);
    float L = mix(lamp * 1.6 * (0.3 + 0.7 * walk) + walk * 0.22, 0.08, far);
    vec3 tint = mix(vec3(1.0, 0.68, 0.38), vec3(0.75, 0.85, 1.0), step(0.8, hash12(cell + 3.0)));
    totalEmissiveRadiance += tint * L * u * uCityLights * 0.12;
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
  const uniforms = { uInfo: { value: infoTex }, uNature: { value: natureTex }, uInfoHalf: { value: half }, uBloom: NATURE_U.uBloom };
  return patchedMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0, envMapIntensity: 0.6 }, {
    key: 'terrain2',
    uniforms,
    fragment: { pars: PARS, color: COLOR, surface: SURFACE, normal: NORMAL, lights: LIGHTS, emissive: EMISSIVE, preAerial: PRE_AERIAL },
  });
}
