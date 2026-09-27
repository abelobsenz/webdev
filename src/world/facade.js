import * as THREE from 'three';
import { patchedMaterial, FACADE_GLSL } from './materials.js';

/**
 * Facade material for megastructures and buildings. Geometry must carry
 * aFacade = (u metres along the surface, v metres up, kind) where kind:
 *  0 = curtain-wall glass       1 = solid structure (bone-white composite / stone)
 *  2 = lantern / crown (glows)  3 = garden deck (planted)      4 = energy conduit
 *  5 = punched windows in stone 6 = water (pools)              7 = solar glass
 *  8 = timber (pergolas, fins)  9 = paved deck / terrace       10 = dark metal (frames, rails)
 *
 * Windows are not a flat checkerboard: each pane sits in a frame of real depth
 * (parallax offset of the mullions), and behind lit panes the shader ray-traces a
 * small room (interior mapping) with walls, floor, a ceiling light, furniture
 * silhouettes and sometimes blinds or curtains. Occupancy is clustered per floor,
 * colour temperature varies per room, and everything blends to a filtered average
 * with distance so it stays anti-aliased.
 */
// glass colours double as the specular (F0) tint of the coated curtain wall
export const PALETTES = {
  pearl: { glass: [0.52, 0.60, 0.66], rib: [0.93, 0.92, 0.89], light: [1.0, 0.78, 0.52], vein: [0.55, 0.85, 1.0] },
  bronze: { glass: [0.62, 0.50, 0.38], rib: [0.90, 0.85, 0.76], light: [1.0, 0.72, 0.45], vein: [1.0, 0.72, 0.4] },
  jade: { glass: [0.38, 0.58, 0.56], rib: [0.90, 0.94, 0.91], light: [0.95, 0.86, 0.66], vein: [0.45, 1.0, 0.8] },
  silver: { glass: [0.62, 0.66, 0.72], rib: [0.96, 0.96, 0.97], light: [0.92, 0.9, 1.0], vein: [0.7, 0.75, 1.0] },
  rose: { glass: [0.66, 0.52, 0.52], rib: [0.95, 0.91, 0.88], light: [1.0, 0.76, 0.62], vein: [1.0, 0.6, 0.75] },
  sand: { glass: [0.50, 0.56, 0.60], rib: [0.88, 0.82, 0.72], light: [1.0, 0.70, 0.44], vein: [1.0, 0.78, 0.5] },
};

const FACADE_PARS = /* glsl */ `
#ifndef FSEED
#define FSEED uSeed
#endif
varying vec3 vFacade;
uniform float uSeed;
uniform vec3 uGlass;
uniform vec3 uRib;
uniform vec3 uLightCol;
uniform vec3 uVein;
uniform float uLitFrac;
uniform float uColW;
uniform float uFloorH;
uniform float uBandPeriod;
uniform float uWarmth;
uniform float uUplight;
${FACADE_GLSL}
float fGlass; float fRib; float fBand; float fKind; float fVein; vec2 fCell; float fPx;
float fRough; float fMetal; float fAO; float fDetail; float fSeam; float fFres;
vec3 fEmit; vec3 fT; vec3 fB; vec2 fTilt;

vec3 fLampColor(float h, float warmth) {
  if (h < 0.1 + 0.45 * warmth) return vec3(1.0, 0.62, 0.34);   // 2700 K homes
  if (h < 0.74) return vec3(1.0, 0.78, 0.55);                  // 3200 K
  if (h < 0.93) return vec3(1.0, 0.9, 0.78);                   // 4000 K
  return vec3(0.74, 0.85, 1.0);                                // cool studio / lab
}

// Stone / composite skin: coursed panels, grain, joints, gentle weathering.
vec3 fStone(vec2 f, vec2 fw, vec3 base, float seed, float courseH, float jointW) {
  float fade = 1.0 - smoothstep(0.08, 0.5, max(fw.x, fw.y));
  float course = floor(f.y / courseH);
  float jx = f.x + courseH * 1.1 * mod(course, 2.0);
  float jl = courseH * 2.2;
  float seamH = 1.0 - filteredPulse(f.y, courseH, courseH - jointW, fw.y);
  float seamV = 1.0 - filteredPulse(jx, jl, jl - jointW, fw.x);
  fSeam = max(seamH, seamV);
  float blockT = hash12(vec2(floor(jx / jl), course) + seed);
  float grain = vnoise(f * vec2(2.3, 4.1) + seed * 7.0) * 0.6 + vnoise(f * 9.0 + 3.0) * 0.4;
  vec3 c = base * mix(1.0, 0.92 + 0.12 * blockT, fade * 0.8 + 0.2);
  c *= 1.0 - fade * 0.07 * (grain - 0.5) * 2.0;
  c *= 1.0 - 0.28 * fSeam * (0.3 + 0.7 * fade);
  // weathering: faint vertical rain streaks, heavier low down
  float streak = vnoise(vec2(f.x * 0.9 + seed, f.y * 0.04));
  c *= 1.0 - 0.1 * smoothstep(0.58, 0.92, streak) * (0.4 + 0.6 * exp(-max(f.y, 0.0) * 0.05));
  return c;
}

// One room behind a window. o = point on the glass (x in [0,W], y in [0,H], z = 0),
// rd = ray into the room (z < 0). Returns the albedo seen, the lamp falloff and the fixture glow.
vec3 fRoom(vec3 o, vec3 rd, float W, float H, float D, vec3 s, out float lamp, out float spot) {
  rd.x = abs(rd.x) < 1e-4 ? 1e-4 : rd.x;
  rd.y = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
  rd.z = min(rd.z, -1e-3);
  vec3 inv = 1.0 / rd;
  float tx = ((rd.x > 0.0 ? W : 0.0) - o.x) * inv.x;
  float ty = ((rd.y > 0.0 ? H : 0.0) - o.y) * inv.y;
  float tz = (-D - o.z) * inv.z;
  float t = min(min(tx, ty), tz);
  vec3 p = o + rd * t;
  vec3 wallC = mix(vec3(0.70, 0.64, 0.56), vec3(0.86, 0.84, 0.80), s.x);
  wallC = mix(wallC, vec3(0.52, 0.60, 0.64), step(0.82, s.y));
  wallC = mix(wallC, vec3(0.50, 0.36, 0.26), step(0.9, s.z));      // panelled study
  vec3 c;
  spot = 0.0;
  if (t == tz) {
    c = wallC;
    vec2 q = vec2(p.x / W, p.y / H);
    float art = step(abs(q.x - (0.3 + 0.4 * s.z)), 0.15) * step(abs(q.y - 0.6), 0.12);
    c = mix(c, mix(vec3(0.5, 0.36, 0.26), vec3(0.3, 0.36, 0.42), s.y), art * step(0.4, s.z) * 0.7);
    float shelf = step(abs(q.x - (0.8 - 0.6 * step(0.5, s.x))), 0.12) * step(0.15, q.y) * step(q.y, 0.85);
    c = mix(c, vec3(0.3, 0.22, 0.16) * (0.8 + 0.4 * step(0.5, fract(q.y * 6.0))), shelf * step(0.6, s.y));
  } else if (t == ty) {
    if (rd.y > 0.0) {
      c = vec3(0.86, 0.85, 0.82);
      vec2 cp = vec2(p.x - W * 0.5, p.z + D * 0.45);
      spot = exp(-dot(cp, cp) * 2.2);
    } else {
      c = mix(vec3(0.34, 0.23, 0.15), vec3(0.58, 0.54, 0.48), s.z);
    }
  } else {
    c = wallC * 0.86;
  }
  // furniture silhouettes on a plane part-way into the room
  float tf = (-D * (0.42 + 0.22 * s.x) - o.z) * inv.z;
  if (tf > 0.0 && tf < t) {
    vec3 q = o + rd * tf;
    float sofa = step(q.y, H * (0.2 + 0.1 * s.y)) * step(abs(q.x - W * (0.3 + 0.4 * s.z)), W * 0.26);
    float lampPost = step(q.y, H * 0.55) * step(abs(q.x - W * (0.12 + 0.76 * step(0.5, s.y))), 0.12) * step(0.45, s.x);
    float plant = step(length(vec2(q.x - W * (0.88 - 0.76 * step(0.5, s.z)), (q.y - H * 0.38) * 0.8)), H * 0.14) * step(0.55, s.y);
    float fr = max(max(sofa, lampPost), plant);
    if (fr > 0.5) { c = mix(vec3(0.14, 0.12, 0.10), vec3(0.08, 0.15, 0.06), plant); p = q; }
  }
  vec3 dl = p - vec3(W * 0.5, H - 0.4, -D * 0.45);
  lamp = 1.0 / (1.0 + dot(dl, dl) * 0.1);
  return c;
}
`;

const FACADE_COLOR = /* glsl */ `
{
  fKind = floor(vFacade.z + 0.5);
  vec2 f = vFacade.xy;
  vec2 fw = max(fwidth(f), vec2(1e-4));
  float colW = uColW, floorH = uFloorH;
  fCell = floor(vec2(f.x / colW, f.y / floorH));
  fPx = max(fw.x / colW, fw.y / floorH);
  fDetail = 1.0 - smoothstep(0.3, 0.8, fPx);
  fEmit = vec3(0.0); fAO = 1.0; fTilt = vec2(0.0); fSeam = 0.0;
  fGlass = 0.0; fRib = 0.0; fBand = 0.0; fRough = 0.5; fMetal = 0.0; fFres = 0.0;
  float ribP = colW * 5.0;
  fVein = 1.0 - filteredPulse(f.x + colW * 0.5 - 1.0, ribP, ribP - 0.4, fw.x);
  float lights = uCityLights;
  float dayL = (1.0 - uNight) * (0.05 + 0.22 * max(uSunDir.y, 0.0));
  // tangent frame of the facade parameterisation (world space, from derivatives)
  vec3 N = vWNrm / max(length(vWNrm), 1e-6);
  vec3 dp1 = dFdx(vWPos), dp2 = dFdy(vWPos);
  vec2 dq1 = dFdx(f), dq2 = dFdy(f);
  vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
  fT = dp2p * dq1.x + dp1p * dq2.x;
  fB = dp2p * dq1.y + dp1p * dq2.y;
  fT /= max(length(fT), 1e-8); fB /= max(length(fB), 1e-8);
  vec3 V = normalize(cameraPosition - vWPos);
  vec3 vt = vec3(dot(V, fT), dot(V, fB), max(dot(V, N), 0.06));
  vec3 c;
  if (fKind < 0.5 || (fKind > 4.5 && fKind < 5.5)) {
    bool punched = fKind > 4.5;
    float cw = colW, ch = floorH;
    vec2 pMin = punched ? vec2(0.2, 0.22) : vec2(0.05, 0.08);
    vec2 pMax = punched ? vec2(0.8, 0.86) : vec2(0.95, 0.92);
    float recess = punched ? 0.34 : 0.12;
    if (!punched) {
      fRib = 1.0 - filteredPulse(f.x + cw * 0.5, ribP, ribP - 2.4, fw.x);
      fBand = 1.0 - filteredPulse(f.y, uBandPeriod, uBandPeriod - 9.0, fw.y);
    }
    // pane mask at the frame plane and at the recessed glass (parallax)
    float mx = filteredPulse(f.x - pMin.x * cw, cw, (pMax.x - pMin.x) * cw, fw.x);
    float my = filteredPulse(f.y - pMin.y * ch, ch, (pMax.y - pMin.y) * ch, fw.y);
    float paneS = mx * my;
    vec3 rd = -vt;
    vec2 g = f + rd.xy / max(-rd.z, 0.1) * recess * fDetail;
    float gx = filteredPulse(g.x - pMin.x * cw, cw, (pMax.x - pMin.x) * cw, fw.x);
    float gy = filteredPulse(g.y - pMin.y * ch, ch, (pMax.y - pMin.y) * ch, fw.y);
    float paneG = gx * gy;
    float glassM = paneS * mix(1.0, paneG, fDetail);
    float reveal = paneS * (1.0 - paneG) * fDetail;
    fGlass = glassM * (1.0 - fRib) * (1.0 - fBand);
    vec2 pc = floor(g / vec2(cw, ch));
    float ph = hash13(vec3(pc, FSEED + 17.0));
    fTilt = (hash22(pc + FSEED * 3.1) - 0.5) * 0.045 * fDetail;
    fRough = mix(0.45, 0.035 + 0.07 * ph * ph, fGlass);
    fMetal = mix(0.0, 0.5 + 0.22 * ph, fGlass);
    // frame / wall
    vec3 frame;
    if (punched) frame = fStone(f, fw, uRib, FSEED, 0.62, 0.02);
    else frame = mix(uRib * 0.92, vec3(0.28, 0.29, 0.3), 0.3);
    c = mix(frame, frame * 0.5, reveal);
    // sill shadow under punched windows
    if (punched) c *= 1.0 - 0.18 * fDetail * smoothstep(0.1, 0.0, abs(fract(f.y / ch) - pMin.y + 0.03)) * mx;
    // ---- interior mapping
    float floorId = floor(g.y / ch);
    float rc = 1.0 + floor(hash12(vec2(floorId, FSEED)) * 2.99);
    float roomX = floor(g.x / (cw * rc));
    vec3 rs = hash33(vec3(roomX, floorId, FSEED));
    float clusterP = hash13(vec3(floor(g.x / (cw * 7.0)), floorId, FSEED + 11.0));
    float meanFrac = uLitFrac * 0.52 * (0.25 + 0.75 * lights);
    float frac = mix(meanFrac * (0.3 + 1.4 * clusterP), meanFrac, smoothstep(1.2, 4.0, fPx));
    float lit = step(1.0 - frac, rs.x) * step(0.02, lights);
    vec3 lampC = fLampColor(rs.y, uWarmth) * (0.5 + 0.9 * rs.z);
    vec3 avgLamp = mix(vec3(1.0, 0.82, 0.62), vec3(1.0, 0.7, 0.45), uWarmth);
    vec3 interiorFar = avgLamp * 0.11 * frac * step(0.02, lights) + vec3(0.42, 0.4, 0.38) * dayL * (1.0 + frac);
    vec3 interior = interiorFar;
    if (fDetail > 0.01 && glassM > 0.01) {
      vec3 o = vec3(g.x - roomX * cw * rc, g.y - floorId * ch, 0.0);
      float lampT, spot;
      vec3 alb = fRoom(o, rd, cw * rc, ch, 5.0 + 3.0 * rs.y, rs.zxy, lampT, spot);
      vec3 iNight = (alb * (0.12 + 0.55 * lampT) + spot * 1.4) * lampC * 0.42;
      vec3 iDay = alb * dayL;
      vec3 room = iNight * lit + iDay;
      // blinds and curtains
      float cover = hash13(vec3(roomX, floorId, FSEED + 5.0));
      vec2 rl = vec2(o.x / (cw * rc), o.y / ch);
      if (cover < 0.2) {
        float drop = step(1.0 - (0.3 + 0.7 * hash11(roomX * 1.7 + floorId)), rl.y);
        float slat = mix(0.82, 0.8 + 0.2 * filteredPulse(g.y, 0.1, 0.07, fw.y), fDetail);
        vec3 blind = vec3(0.85, 0.82, 0.75) * slat;
        room = mix(room, blind * (lampC * 0.2 * lit + dayL * 1.3), drop);
      } else if (cover < 0.36) {
        float open = 0.25 + 0.6 * hash11(roomX * 3.3 + floorId * 1.3);
        float cur = step(open * 0.5, abs(rl.x - 0.5));
        vec3 fabric = mix(vec3(0.85, 0.78, 0.66), mix(vec3(0.62, 0.22, 0.16), vec3(0.2, 0.42, 0.44), step(0.5, rs.x)), step(0.6, rs.z));
        float fold = 0.8 + 0.2 * cos(g.x * 9.0);
        room = mix(room, fabric * fold * (lampC * 0.24 * lit + dayL * 1.2), cur);
      }
      interior = mix(interiorFar, room, fDetail);
    }
    fFres = 0.12 + 0.88 * pow(clamp(1.0 - vt.z, 0.0, 1.0), 5.0);
    fEmit = interior * fGlass * (1.0 - fFres);
    c = mix(c, uGlass * 0.4 * (0.85 + 0.3 * ph), fGlass);
    if (!punched) {
      float leaf = vnoise(f * vec2(0.35, 0.8)) * 0.5 + 0.5;
      c = mix(c, mix(vec3(0.07, 0.17, 0.05), vec3(0.2, 0.3, 0.1), leaf), fBand * 0.85);
      c = mix(c, uRib, fRib);
      fRough = mix(fRough, 0.85, fBand);
      fRough = mix(fRough, 0.35, fRib);
    }
    fAO = 1.0 - 0.3 * exp(-max(f.y, 0.0) * 0.35);
  } else if (fKind < 1.5) {
    c = fStone(f, fw, uRib, FSEED, 3.0, 0.06);
    float panel = filteredPulse(f.y, 6.0, 5.7, fw.y) * filteredPulse(f.x, 8.0, 7.7, fw.x);
    c *= 0.9 + 0.1 * panel;
    fRough = 0.52;
    fAO = 1.0 - 0.3 * exp(-max(f.y, 0.0) * 0.35);
  } else if (fKind < 2.5) {
    fGlass = 0.7;
    c = mix(uGlass * 1.4, uRib, 0.25);
    fRough = 0.2; fMetal = 0.4;
  } else if (fKind < 3.5) {
    fBand = 1.0;
    float leaf = fbm2_3(vWPos.xz * 0.12);
    float clump = vnoise(vWPos.xz * 0.9 + 4.0);
    c = mix(vec3(0.05, 0.13, 0.035), vec3(0.2, 0.3, 0.09), leaf) * (0.75 + 0.5 * clump);
    c = mix(c, vec3(0.34, 0.3, 0.2), smoothstep(0.78, 0.9, vnoise(vWPos.xz * 0.35)) * 0.6);  // paths
    fRough = 0.9;
  } else if (fKind < 4.5) {
    fGlass = 0.4;
    c = uGlass * 0.6;
    fRough = 0.25; fMetal = 0.5;
  } else if (fKind < 6.5) {
    // pool water
    float ca = vnoise(vWPos.xz * 1.3 + uTime * 0.4) * vnoise(vWPos.xz * 1.7 - uTime * 0.3);
    c = mix(vec3(0.03, 0.2, 0.24), vec3(0.1, 0.36, 0.4), ca);
    fRough = 0.03; fGlass = 0.0;
  } else if (fKind < 7.5) {
    // photovoltaic glass: cells with fine silver busbars
    float cx = filteredPulse(f.x, 0.62, 0.58, fw.x) * filteredPulse(f.y, 0.62, 0.58, fw.y);
    c = mix(vec3(0.5, 0.52, 0.55), vec3(0.03, 0.05, 0.12), cx);
    fRough = 0.12; fMetal = 0.35;
  } else if (fKind < 8.5) {
    float gr = vnoise(vec2(f.x * 1.5, f.y * 18.0)) * 0.6 + vnoise(vec2(f.x * 4.0, f.y * 60.0)) * 0.4;
    c = mix(vec3(0.36, 0.23, 0.13), vec3(0.52, 0.36, 0.22), gr);
    fRough = 0.7;
  } else if (fKind < 9.5) {
    c = fStone(f, fw, uRib * vec3(0.95, 0.93, 0.88), FSEED + 3.0, 0.6, 0.025);
    fRough = 0.72;
  } else {
    c = vec3(0.11, 0.12, 0.13);
    fRough = 0.32; fMetal = 0.8;
  }
  diffuseColor.rgb = c * fAO;
  #ifdef FDEBUG
  if (any(isnan(fEmit)) || any(isinf(fEmit))) { fEmit = vec3(0.0); diffuseColor.rgb = vec3(1.0, 0.0, 1.0); }
  if (any(isnan(c))) diffuseColor.rgb = vec3(0.0, 1.0, 1.0);
  if (isnan(fRough) || isnan(fMetal)) diffuseColor.rgb = vec3(1.0, 1.0, 0.0);
  #endif
}
`;

const FACADE_SURFACE = /* glsl */ `
roughnessFactor = fRough;
metalnessFactor = fMetal;
`;

const FACADE_NORMAL = /* glsl */ `
{
  vec3 wn = (fT * fTilt.x + fB * fTilt.y) * fGlass;
  normal = normalize(normal + (viewMatrix * vec4(wn, 0.0)).xyz);
}
`;

// Sun and moon glints off near-mirror glass can exceed the half-float range and
// blow up the bloom; keep them bright but bounded (much lower at night).
const FACADE_LIGHTS = /* glsl */ `
reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(mix(9.0, 0.35, uNight)));
`;

const FACADE_EMISSIVE = /* glsl */ `
{
  float lights = uCityLights;
  totalEmissiveRadiance += fEmit;
  totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * fBand * 0.025 * lights * step(fKind, 0.5);
  // energy veins climbing the ribs: slow pulses
  float column = floor((vFacade.x + uColW * 0.5) / (uColW * 5.0));
  float ph = hash11(column + FSEED * 13.0);
  float pulse = pow(fract(vFacade.y / 340.0 - uTime * (0.05 + 0.04 * ph) + ph), 22.0);
  float veinOn = step(0.45, ph) * step(fKind, 4.5);
  totalEmissiveRadiance += uVein * fVein * veinOn * (0.015 + 0.5 * pulse) * (0.1 + 0.9 * lights);
  // warm uplight grazing the base of the building at night
  totalEmissiveRadiance += uLightCol * uUplight * lights * 0.05 * exp(-max(vFacade.y, 0.0) * 0.03) * (1.0 - fGlass) * step(fKind, 1.5);
  if (fKind > 1.5 && fKind < 2.5) {
    float breathe = 0.8 + 0.2 * sin(uTime * 0.6 + FSEED);
    totalEmissiveRadiance += uLightCol * (0.03 + 0.22 * lights) * breathe;
  }
  if (fKind > 3.5 && fKind < 4.5) {
    float flow = pow(fract(vFacade.y / 180.0 - uTime * 0.12), 10.0);
    totalEmissiveRadiance += uVein * (0.04 + 0.6 * flow) * (0.25 + 0.75 * lights);
  }
  if (fKind > 5.5 && fKind < 6.5) totalEmissiveRadiance += vec3(0.2, 0.75, 0.85) * 0.05 * lights;
}
`;

export const FACADE_HOOKS = {
  key: 'facade2',
  vertex: {
    pars: 'attribute vec3 aFacade; varying vec3 vFacade;',
    transform: 'vFacade = aFacade;',
  },
  fragment: {
    pars: FACADE_PARS,
    color: FACADE_COLOR,
    surface: FACADE_SURFACE,
    normal: FACADE_NORMAL,
    emissive: FACADE_EMISSIVE,
    lights: FACADE_LIGHTS,
  },
};

function facadeUniforms(p, seed, { litFrac, colW, floorH, band, warmth, uplight }) {
  return {
    uSeed: { value: seed },
    uGlass: { value: new THREE.Color(...p.glass) },
    uRib: { value: new THREE.Color(...p.rib) },
    uLightCol: { value: new THREE.Color(...p.light) },
    uVein: { value: new THREE.Color(...p.vein) },
    uLitFrac: { value: litFrac },
    uColW: { value: colW },
    uFloorH: { value: floorH },
    uBandPeriod: { value: band },
    uWarmth: { value: warmth },
    uUplight: { value: uplight },
  };
}

/**
 * Instanced low-rise buildings. Geometry carries object-space aFacade (so windows
 * line up with real floors); each instance carries aInst = (seed, variant).
 * `lod`: 0 none, 1 far set (collapsed near the viewer), -1 near set (collapsed far away).
 */
export function createLowriseMaterial(palette = 'pearl', { litFrac = 0.42, lod = 0, nearR = null, warmth = 0.7 } = {}) {
  const p = PALETTES[palette] || PALETTES.pearl;
  const uniforms = facadeUniforms(p, 0, { litFrac, colW: 3.3, floorH: 3.6, band: 1e5, warmth, uplight: 0 });
  if (nearR) uniforms.uNearR = nearR;
  const hooks = {
    key: `lowrise2_${lod}`,
    uniforms,
    defines: Object.assign({ FSEED: '(uSeed + vSeed)' }, lod ? { LR_LOD: lod.toFixed(1) } : {}),
    vertex: {
      pars: 'attribute vec3 aFacade; attribute vec2 aInst; varying vec3 vFacade; varying float vSeed; uniform float uNearR;',
      transform: /* glsl */ `
vFacade = aFacade;
vSeed = aInst.x;
#ifdef LR_LOD
{
  vec3 ip = instanceMatrix[3].xyz;
  float dd = distance(ip, cameraPosition);
  if ((LR_LOD > 0.0 && dd < uNearR) || (LR_LOD < 0.0 && dd >= uNearR)) transformed *= 0.0;
}
#endif
`,
    },
    fragment: {
      ...FACADE_HOOKS.fragment,
      pars: 'varying float vSeed;\n' + FACADE_PARS,
      color: FACADE_COLOR + /* glsl */ `
{
  // each building has its own stone: chalk, sandstone, cool limestone, terracotta, sage, travertine
  vec3 tints[6] = vec3[6](vec3(1.0), vec3(1.0, 0.92, 0.78), vec3(0.88, 0.92, 0.96), vec3(1.0, 0.8, 0.68), vec3(0.84, 0.9, 0.82), vec3(0.97, 0.9, 0.82));
  vec3 tint = tints[int(fract(vSeed * 0.137) * 5.99)];
  float stoneLike = step(0.5, fKind) * step(fKind, 1.5) + step(4.5, fKind) * step(fKind, 5.5) * (1.0 - fGlass) + step(8.5, fKind) * step(fKind, 9.5);
  diffuseColor.rgb *= mix(vec3(1.0), tint, stoneLike);
}`,
    },
  };
  const m = patchedMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.9 }, hooks);
  m.userData.facadeUniforms = uniforms;
  return m;
}

export function createFacadeMaterial(palette = 'pearl', seed = 1, { litFrac = 0.55, colW = 3.2, floorH = 4.2, band = 112, side = THREE.FrontSide, warmth = 0.55, uplight = 1 } = {}) {
  const p = PALETTES[palette] || PALETTES.pearl;
  const uniforms = facadeUniforms(p, seed, { litFrac, colW, floorH, band, warmth, uplight });
  const m = patchedMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.0, envMapIntensity: 1.0, side }, { ...FACADE_HOOKS, uniforms });
  m.userData.facadeUniforms = uniforms;
  return m;
}
