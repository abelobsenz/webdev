import * as THREE from 'three';
import { patchedMaterial, FACADE_GLSL } from './materials.js';

/**
 * Facade material for megastructures and buildings. Geometry must carry
 * aFacade = (u metres along the surface, v metres up, kind) where kind:
 *  0 = curtain-wall glass       1 = solid structure (bone-white composite / stone)
 *  2 = lantern / crown (glows)  3 = garden deck (planted)      4 = energy conduit
 *  5 = punched windows in stone 6 = water (pools)              7 = solar glass
 *  8 = timber (pergolas, fins)  9 = paved deck / terrace       10 = dark metal (frames, rails)
 *  11 = radiator / dark ceramic 12 = fritted-glass balustrade
 *
 * Windows are not a flat checkerboard: each opening has a frame of real depth
 * (parallax offset of the reveal), a painted or anodised window frame with glazing
 * bars, and behind clear panes the shader ray-traces a small room (interior mapping)
 * with walls, floor, a ceiling light, furniture silhouettes and sometimes blinds or
 * curtains. Punched openings get stone sills, lintels, rain streaks, shutters and
 * window boxes; curtain walls get shadow-box spandrels. Glass reflects a procedural
 * skyline of the surrounding city (and its lights at night) on top of the sky.
 * Every detail fades to its own filtered average with distance.
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
float fRough; float fMetal; float fAO; float fDetail; float fSeam; float fFres; float fVert;
vec3 fEmit; vec3 fT; vec3 fB; vec2 fTilt; vec2 fBump; vec3 fSty; vec3 fDbg; vec2 fwW;

// anti-aliased rectangle [a, b] (roughly area-preserving when the footprint exceeds it)
float fBox(vec2 p, vec2 a, vec2 b, vec2 fw) {
  vec2 i0 = smoothstep(a - fw, a + fw, p);
  vec2 i1 = 1.0 - smoothstep(b - fw, b + fw, p);
  return i0.x * i0.y * i1.x * i1.y;
}
// thin line of half-width w centred on d = 0
float fLine(float d, float w, float fw) { return 1.0 - smoothstep(w - fw, w + fw, abs(d)); }
// normal tilt across a bevelled panel edge at l in [0, L]: -1 at the start, +1 at the end
float fBevel(float l, float L, float w) { return (1.0 - smoothstep(0.0, w, L - l)) - (1.0 - smoothstep(0.0, w, l)); }
// dot of radius r at distance d from its centre on a grid of the given cell area: sharp up close,
// its exact coverage once the pixel footprint is larger than the dot
float fDot(float d, float r, float fwm, float area) {
  float sharp = 1.0 - smoothstep(r - fwm, r + fwm, d);
  return mix(sharp, 3.14159 * r * r / area, smoothstep(r * 0.5, r * 2.0, fwm));
}

vec3 fLampColor(float h, float warmth) {
  if (h < 0.1 + 0.45 * warmth) return vec3(1.0, 0.62, 0.34);   // 2700 K homes
  if (h < 0.74) return vec3(1.0, 0.78, 0.55);                  // 3200 K
  if (h < 0.93) return vec3(1.0, 0.9, 0.78);                   // 4000 K
  return vec3(0.74, 0.85, 1.0);                                // cool studio / lab
}

// window-frame finishes: graphite, dark bronze, warm white, champagne, verdigris
vec3 fFrameCol(float h) {
  if (h < 0.3) return vec3(0.055, 0.058, 0.062);
  if (h < 0.52) return vec3(0.15, 0.10, 0.065);
  if (h < 0.78) return vec3(0.80, 0.79, 0.76);
  if (h < 0.9) return vec3(0.40, 0.34, 0.25);
  return vec3(0.16, 0.24, 0.21);
}

// Stone / composite skin: coursed ashlar with bevelled arrises, block-to-block tone, grain,
// aggregate flecks and gentle weathering. Writes fSeam and adds to fBump.
vec3 fStone(vec2 f, vec2 fw, vec3 base, float seed, float courseH, float jointW) {
  float fwm = max(fw.x, fw.y);
  float fade = 1.0 - smoothstep(0.08, 0.5, fwm);
  float fine = 1.0 - smoothstep(0.012, 0.08, fwm);
  float course = floor(f.y / courseH);
  float jl = courseH * (1.7 + 0.9 * hash11(course * 0.73 + seed));
  float jx = f.x + jl * hash11(course * 1.37 + seed * 3.1);
  float seamH = 1.0 - filteredPulse(f.y, courseH, courseH - jointW, fw.y);
  float seamV = 1.0 - filteredPulse(jx, jl, jl - jointW, fw.x);
  fSeam = max(seamH, seamV);
  vec2 blk = vec2(floor(jx / jl), course);
  vec3 bh = hash33(vec3(blk, seed));
  float g1 = vnoise(f * vec2(1.7, 3.3) + bh.xy * 17.0);
  float g2 = vnoise(f * 9.0 + bh.yz * 23.0);
  float grain = mix(0.5, g1, fade) * 0.55 + mix(0.5, g2, fine) * 0.45;
  vec3 c = base * mix(1.0, 0.9 + 0.17 * bh.x, 0.25 + 0.75 * fade);
  c *= 1.0 + vec3(0.03, 0.0, -0.05) * (bh.y - 0.5) * fade;          // warm and cool blocks
  c *= 1.0 - 0.1 * (grain - 0.5) * 2.0;
  c *= 1.0 - 0.1 * smoothstep(0.78, 0.92, vnoise(f * 31.0 + bh.xz * 9.0)) * fine;   // shell / aggregate flecks
  c *= 1.0 - 0.32 * fSeam * (0.35 + 0.65 * fade);
  // bevelled arrises catch the light along every joint
  float bf = 1.0 - smoothstep(0.012, 0.05, fwm);
  if (bf > 0.0) {
    vec2 bv = vec2(fBevel(mod(jx, jl) - jointW, jl - jointW, 0.02), fBevel(mod(f.y, courseH) - jointW, courseH - jointW, 0.02));
    fBump += bv * 0.55 * bf * (1.0 - fSeam);
    vec3 nd = vnoised(f * 7.0 + bh.xy * 13.0);
    fBump += nd.yz * 0.05 * bf;
  }
  // weathering on walls: faint rain streaks, heavier low down, and a splash line at the foot
  float streak = vnoise(vec2(f.x * 0.9 + seed, f.y * 0.04));
  c *= 1.0 - fVert * 0.1 * smoothstep(0.58, 0.92, streak) * (0.4 + 0.6 * exp(-max(f.y, 0.0) * 0.05));
  c *= mix(vec3(1.0), vec3(0.8, 0.78, 0.72), fVert * (1.0 - smoothstep(0.0, 0.7, f.y)) * step(-0.8, f.y));
  return c;
}

// One room behind a window. o = point on the glass (x in [0,W], y in [0,H], z = 0),
// rd = ray into the room (z < 0). Returns the albedo seen, the lamp falloff, the fixture glow
// and how deep into the room the ray landed (0 at the glass, 1 at the back wall).
vec3 fRoom(vec3 o, vec3 rd, float W, float H, float D, vec3 s, out float lamp, out float spot, out float dep) {
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
      // floor: oak boards or pale stone, a rug in some rooms
      c = mix(vec3(0.34, 0.23, 0.15), vec3(0.58, 0.54, 0.48), s.z);
      c *= 0.9 + 0.1 * step(0.5, fract(p.x * 5.0 + s.y * 3.0));
      vec2 rq = vec2(p.x - W * 0.5, p.z + D * 0.5);
      float rug = step(abs(rq.x), W * 0.3) * step(abs(rq.y), D * 0.25) * step(0.45, s.x);
      c = mix(c, mix(vec3(0.42, 0.14, 0.1), vec3(0.2, 0.26, 0.34), s.y), rug * 0.8);
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
  dep = clamp(-p.z / D, 0.0, 1.0);
  return c;
}
`;

const FACADE_COLOR = /* glsl */ `
{
  fKind = floor(vFacade.z + 0.5);
  vec2 f = vFacade.xy;
  vec2 fw = max(fwidth(f), vec2(1e-4));
  fwW = max(fwidth(vWPos.xz), vec2(1e-4));             // world footprint (derivatives only in uniform flow)
  float fwm = max(fw.x, fw.y);
  float colW = uColW, floorH = uFloorH;
  fCell = floor(vec2(f.x / colW, f.y / floorH));
  fPx = max(fw.x / colW, fw.y / floorH);
  fDetail = 1.0 - smoothstep(0.3, 0.8, fPx);
  fEmit = vec3(0.0); fAO = 1.0; fTilt = vec2(0.0); fBump = vec2(0.0); fSeam = 0.0;
  fGlass = 0.0; fRib = 0.0; fBand = 0.0; fRough = 0.5; fMetal = 0.0; fFres = 0.0;
  fSty = hash33(vec3(FSEED * 0.731 + 0.17, 5.3, 1.9));        // per-building style choices
  fDbg = vec3(0.0);
  float ribP = colW * 5.0;
  fVein = fPulse(f.x, ribP, colW * 0.5 - 0.2, colW * 0.5 + 0.2, fw.x);     // down the middle of each rib
  float lights = uCityLights;
  float dayL = (1.0 - uNight) * (0.07 + 0.3 * max(uSunDir.y, 0.0));
  // tangent frame of the facade parameterisation (world space, from derivatives)
  vec3 N = vWNrm / max(length(vWNrm), 1e-6);
  fVert = 1.0 - smoothstep(0.5, 0.8, abs(N.y));
  vec3 dp1 = dFdx(vWPos), dp2 = dFdy(vWPos);
  vec2 dq1 = dFdx(f), dq2 = dFdy(f);
  vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
  fT = dp2p * dq1.x + dp1p * dq2.x;
  fB = dp2p * dq1.y + dp1p * dq2.y;
  fT /= max(length(fT), 1e-8); fB /= max(length(fB), 1e-8);
  vec3 V = normalize(cameraPosition - vWPos);
  vec3 vt = vec3(dot(V, fT), dot(V, fB), max(dot(V, N), 0.06));
  vec3 stoneBase = uRib;
  vec3 frameC = mix(uRib * 0.9, vec3(0.3), 0.25);
  #ifdef LOWRISE
  {
    // each building has its own stone (chalk, sandstone, cool limestone, terracotta, sage,
    // travertine) and its own window-frame finish
    vec3 tints[6] = vec3[6](vec3(1.0), vec3(1.0, 0.92, 0.78), vec3(0.88, 0.92, 0.96), vec3(1.0, 0.8, 0.68), vec3(0.84, 0.9, 0.82), vec3(0.97, 0.9, 0.82));
    stoneBase *= tints[int(fract(vSeed * 0.137) * 5.99)];
    frameC = fFrameCol(fSty.x);
  }
  #endif
  vec3 c;
  if (fKind < 0.5 || (fKind > 4.5 && fKind < 5.5)) {
    bool punched = fKind > 4.5;
    float cw = colW, ch = floorH;
    vec2 cell = vec2(cw, ch);
    float shut = punched ? step(fSty.y, 0.24) : 0.0;
    vec2 pMin = punched ? vec2(mix(0.2, 0.3, shut), 0.22) : vec2(0.05, 0.08);
    vec2 pMax = punched ? vec2(mix(0.8, 0.7, shut), 0.86) : vec2(0.95, 0.92);
    float recess = punched ? 0.34 : 0.12;
    if (!punched) {
      fRib = fPulse(f.x, ribP, 0.0, cw, fw.x);                  // every fifth bay is a solid fin
      fBand = uBandPeriod > 1e4 ? 0.0 : fPulse(f.y, uBandPeriod, 0.0, 9.0, fw.y);
    }
    vec2 bay = floor(f / cell);
    vec2 lf = f - bay * cell;                                  // position in the bay (wall plane)
    // opening at the wall plane and seen at the recessed glass (parallax)
    float mx = fPulse(f.x, cw, pMin.x * cw, pMax.x * cw, fw.x);
    float my = fPulse(f.y, ch, pMin.y * ch, pMax.y * ch, fw.y);
    float paneS = mx * my;
    vec3 rd = -vt;
    vec2 g = f + rd.xy / max(-rd.z, 0.1) * recess * fDetail;
    float gx = fPulse(g.x, cw, pMin.x * cw, pMax.x * cw, fw.x);
    float gy = fPulse(g.y, ch, pMin.y * ch, pMax.y * ch, fw.y);
    float paneG = gx * gy;
    vec2 pc = floor(g / cell);
    vec2 lg = g - pc * cell;                                   // position in the bay (glass plane)
    float ph = hash13(vec3(pc, FSEED + 17.0));
    // window frame, glazing bars and, on curtain walls, the shadow-box spandrel at the ceiling
    float fr = punched ? 0.07 : 0.05;
    vec2 o0 = pMin * cell + fr, sz = (pMax - pMin) * cell - 2.0 * fr;
    float clearM = fPulse(g.x, cw, o0.x, o0.x + sz.x, fw.x) * fPulse(g.y, ch, o0.y, o0.y + sz.y, fw.y);
    float mullOn = punched ? step(0.4, fSty.z) : step(0.75, fSty.z);
    float transOn = punched ? step(0.25, fSty.y) : 1.0;
    float mull = fLine(lg.x - (pMin.x + pMax.x) * 0.5 * cw, 0.03, fw.x) * mullOn;
    float tY = punched ? o0.y + sz.y * 0.74 : pMax.y * ch - fr - 0.6;
    float trans = fLine(lg.y - tY, 0.028, fw.y) * transOn;
    float spandM = punched ? 0.0 : clearM * smoothstep(tY - fw.y, tY + fw.y, lg.y);
    clearM = max(clearM * (1.0 - max(mull, trans)) - spandM, 0.0);
    // the same fractions averaged over the opening, for bays below a pixel
    float openA = (pMax.x - pMin.x) * cw * (pMax.y - pMin.y) * ch;
    float spandA = punched ? 0.0 : max(pMax.y * ch - fr - tY - 0.028, 0.0) * sz.x;
    float clearA = max(sz.x * sz.y - mullOn * 0.06 * sz.y - transOn * 0.056 * sz.x - spandA, 0.0);
    float wC = paneS * mix(clearA / openA, clearM, fDetail);   // clear glass (rooms behind)
    float wS = paneS * mix(spandA / openA, spandM, fDetail);   // opaque spandrel glass
    float wR = paneS * (1.0 - paneG) * fDetail;                // reveal
    float wF = max(paneS - wC - wS - wR, 0.0);                 // window frame and bars
    float wW = 1.0 - paneS;                                    // wall (or mullion caps)
    // ---- punched openings: shutters, window boxes
    float shutM = 0.0, boxM = 0.0, plantM = 0.0;
    vec3 shutC = vec3(0.0), plantC = vec3(0.0);
    if (punched) {
      float ww = (pMax.x - pMin.x) * cw;
      float sy0 = pMin.y * ch, sy1 = pMax.y * ch;
      if (shut > 0.5) {
        float closed = step(hash13(vec3(bay, FSEED + 3.0)), 0.18);
        float leafL = fBox(lf, vec2(pMin.x * cw - ww * 0.5 - 0.03, sy0), vec2(pMin.x * cw - 0.03, sy1), fw);
        float leafR = fBox(lf, vec2(pMax.x * cw + 0.03, sy0), vec2(pMax.x * cw + ww * 0.5 + 0.03, sy1), fw);
        shutM = mix(leafL + leafR, paneS, closed);
        // sage, slate blue, dove grey, oxblood, ochre, bottle green
        float sk = fract(fSty.z * 5.37);
        vec3 sp = sk < 0.2 ? vec3(0.34, 0.43, 0.33) : sk < 0.4 ? vec3(0.24, 0.33, 0.44) : sk < 0.52 ? vec3(0.6, 0.6, 0.58)
                : sk < 0.72 ? vec3(0.40, 0.15, 0.11) : sk < 0.84 ? vec3(0.66, 0.49, 0.24) : vec3(0.12, 0.25, 0.17);
        float lv = filteredPulse(lf.y, 0.075, 0.055, fw.y);
        shutC = sp * mix(0.86, 0.72 + 0.28 * lv, fDetail);
        fBump.y += (lv - 0.5) * 0.6 * shutM * (1.0 - smoothstep(0.02, 0.06, fw.y));
      } else if (hash13(vec3(bay, FSEED + 8.0)) < 0.2) {
        // window box of flowers on the sill
        boxM = fBox(lf, vec2(pMin.x * cw + 0.04, sy0 - 0.02), vec2(pMax.x * cw - 0.04, sy0 + 0.2), fw);
        float fx = lf.x - pMin.x * cw;
        float top = sy0 + 0.22 + 0.22 * vnoise(vec2(fx * 6.0, bay.x + FSEED)) * fDetail;
        plantM = fBox(lf, vec2(pMin.x * cw + 0.02, sy0 + 0.15), vec2(pMax.x * cw - 0.02, top), fw) * (1.0 - boxM);
        vec3 fl = flowerPaletteF(hash13(vec3(bay, FSEED + 9.0)));
        float bloom = smoothstep(0.55, 0.8, vnoise(lf * 14.0 + bay * 7.0));
        plantC = mix(vec3(0.07, 0.14, 0.04) * (0.7 + 0.6 * vnoise(lf * 9.0)), fl, mix(0.35, bloom, fDetail));
      }
    }
    float hide = max(shutM, max(boxM, plantM));
    wC *= 1.0 - hide; wS *= 1.0 - hide; wR *= 1.0 - hide; wF *= 1.0 - hide;
    // ---- colours
    vec2 bump0 = fBump;
    vec3 wall = punched ? fStone(f, fw, stoneBase, FSEED, 0.62, 0.012) : frameC * 0.95;
    fBump = bump0 + (fBump - bump0) * wW;          // stone relief only where the stone shows
    float revShade = 0.7;
    {
      float head = step(pMax.y * ch, lg.y), foot = step(lg.y, pMin.y * ch);
      revShade = mix(mix(0.66, 0.42, head), 0.9, foot);
    }
    vec3 revealC = (punched ? wall : frameC) * revShade;
    vec3 glassC = uGlass * 0.18 * (0.85 + 0.3 * ph);
    vec3 spandC = uGlass * 0.09;
    c = wall * wW + frameC * wF + revealC * wR + glassC * wC + spandC * wS;
    float wallR = punched ? 0.62 : 0.34, wallM = punched ? 0.0 : 0.75;
    fRough = (wW + wR) * wallR + wF * 0.34 + wC * (0.03 + 0.06 * ph * ph) + wS * 0.05;
    fMetal = (wW + wR) * wallM + wF * 0.75 + (wC + wS) * 0.92;
    c = mix(c, shutC, shutM); fRough = mix(fRough, 0.55, shutM); fMetal *= 1.0 - shutM;
    c = mix(c, vec3(0.42, 0.22, 0.14), boxM); fRough = mix(fRough, 0.8, boxM + plantM); fMetal *= 1.0 - boxM - plantM;
    c = mix(c, plantC, plantM);
    fBump.x += sign(lg.x - (pMin.x + pMax.x) * 0.5 * cw) * mull * 0.5 * paneS;
    if (punched) {
      // stone sill with a drip, a lintel stone over the opening, streaks of rain below the sill ends
      float sx0 = pMin.x * cw - 0.1, sx1 = pMax.x * cw + 0.1;
      float sy1 = pMin.y * ch, sy0 = sy1 - 0.09;
      float sill = fBox(lf, vec2(sx0, sy0), vec2(sx1, sy1), fw);
      float lint = fBox(lf, vec2(sx0 + 0.04, pMax.y * ch), vec2(sx1 - 0.04, pMax.y * ch + 0.24), fw);
      float below = sy0 - lf.y;
      float sillSh = fBox(lf, vec2(sx0, sy0 - 0.12), vec2(sx1, sy0), fw) * clamp(1.0 - below / 0.12, 0.0, 1.0);
      float dxs = min(abs(lf.x - sx0 - 0.06), abs(lf.x - sx1 + 0.06));
      float drip = (1.0 - smoothstep(0.02, 0.1 + 0.05 * max(below, 0.0), dxs)) * step(0.0, below) * exp(-max(below, 0.0) * 1.4)
                 * (0.6 + 0.4 * vnoise(vec2(f.x * 7.0, f.y * 0.8)));
      vec3 sillC = stoneBase * 1.05 * (0.95 + 0.1 * vnoise(f * 6.0));
      c = mix(c, sillC, sill);
      c = mix(c, stoneBase * (0.96 + 0.08 * hash13(vec3(bay, FSEED + 4.0))), lint * 0.85);
      c *= 1.0 - 0.35 * lint * (fLine(lf.y - pMax.y * ch - 0.24, 0.006, fw.y) + fLine(lf.x - sx0 - 0.04, 0.006, fw.x) + fLine(lf.x - sx1 + 0.04, 0.006, fw.x));
      c *= 1.0 - 0.28 * sillSh - 0.12 * drip;
      fBump.y += sill * (fLine(lf.y - sy1, 0.012, fw.y) * 0.7 - fLine(lf.y - sy0, 0.012, fw.y) * 0.5);
      fRough = mix(fRough, 0.6, sill + lint);
      fMetal *= 1.0 - sill - lint;
    }
    fGlass = wC + wS;
    fDbg = vec3(wC, wF, wR);
    fTilt = (hash22(pc + FSEED * 3.1) - 0.5) * 0.045 * fDetail;
    // ---- interior mapping
    float floorId = floor(g.y / ch);
    float rc = 1.0 + floor(hash12(vec2(floorId, FSEED)) * 2.99);
    float roomX = floor(g.x / (cw * rc));
    vec3 rs = hash33(vec3(roomX, floorId, FSEED));
    float shop = 0.0;
    #ifdef LOWRISE
    if (!punched) shop = 1.0 - step(0.5, abs(floorId));     // ground-floor shops and lobbies
    #endif
    float clusterP = hash13(vec3(floor(g.x / (cw * 7.0)), floorId, FSEED + 11.0));
    #ifdef LOWRISE
    float meanFrac = uLitFrac * 0.95 * (0.2 + 0.8 * lights);       // homes: most rooms lit in the evening
    #else
    float meanFrac = uLitFrac * 0.52 * (0.25 + 0.75 * lights);
    #endif
    meanFrac = mix(meanFrac, 0.8, shop);
    float frac = mix(meanFrac * (0.3 + 1.4 * clusterP), meanFrac, smoothstep(1.2, 4.0, fPx));
    float lit = step(1.0 - frac, rs.x) * step(0.02, lights + shop);
    vec3 lampC = fLampColor(rs.y, uWarmth) * (0.5 + 0.9 * rs.z);
    float shopLamp = mix(0.25, 1.0, lights);
    lampC = mix(lampC, vec3(1.0, 0.9, 0.78) * 1.4 * shopLamp, shop);
    // a few rooms are lit by a screen
    float tv = step(0.93, fract(rs.y * 7.7)) * (1.0 - shop);
    float flick = 0.65 + 0.35 * sin(uTime * 9.0 + rs.x * 60.0) * sin(uTime * 2.3 + rs.z * 20.0);
    lampC = mix(lampC, vec3(0.45, 0.62, 1.0) * flick, tv * 0.85);
    vec3 avgLamp = mix(vec3(1.0, 0.82, 0.62), vec3(1.0, 0.7, 0.45), uWarmth);
    vec3 interiorFar = avgLamp * 0.11 * frac * step(0.02, lights + shop) * mix(1.0, 1.6 * shopLamp, shop) + vec3(0.42, 0.4, 0.38) * dayL * (1.0 + frac);
    vec3 interior = interiorFar;
    if (fDetail > 0.01 && wC > 0.01) {
      vec3 o = vec3(g.x - roomX * cw * rc, g.y - floorId * ch, 0.0);
      float lampT, spot, dep;
      vec3 alb = fRoom(o, rd, cw * rc, ch, 5.0 + 3.0 * rs.y, rs.zxy, lampT, spot, dep);
      vec3 iNight = (alb * (0.12 + 0.55 * lampT) + spot * 1.4) * lampC * 0.42;
      vec3 iDay = alb * dayL * (0.55 + 0.9 * (1.0 - dep));
      vec3 room = iNight * lit + iDay;
      // blinds and curtains
      float cover = mix(hash13(vec3(roomX, floorId, FSEED + 5.0)), 1.0, shop);
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
    fFres = 0.1 + 0.9 * pow(clamp(1.0 - vt.z, 0.0, 1.0), 5.0);
    fEmit = interior * wC * (1.0 - fFres);
    if (!punched) {
      // ribs: composite fins with bevelled edges and panel joints; bands: hanging gardens
      float rl2 = mod(f.x + cw * 0.5, ribP);
      float ribJ = 1.0 - filteredPulse(f.y, ch * 2.0, ch * 2.0 - 0.025, fw.y);
      vec3 ribC = uRib * (1.0 - 0.3 * ribJ) * (0.97 + 0.03 * vnoise(f * vec2(0.5, 0.1)));
      fBump.x += fBevel(clamp(rl2, 0.0, cw), cw, 0.18) * 0.5 * fRib * (1.0 - smoothstep(0.1, 0.4, fw.x));
      float bl = mod(f.y, uBandPeriod);                         // 0..9 m up the garden band
      float bd = 1.0 - smoothstep(0.15, 0.8, fwm);
      float lip = 1.0 - smoothstep(0.9 - fw.y, 0.9 + fw.y, bl);
      float clump = vnoise(f * vec2(0.55, 0.9)) * 0.6 + vnoise(f * vec2(2.3, 3.1)) * 0.4 * bd;
      vec3 leafC = mix(vec3(0.05, 0.13, 0.035), vec3(0.2, 0.3, 0.09), clump);
      leafC = mix(leafC, flowerPaletteF(hash12(floor(f / 6.0) + FSEED)) * 0.8, smoothstep(0.72, 0.85, vnoise(f * 1.3 + 7.0)) * 0.6);
      leafC *= 0.6 + 0.5 * smoothstep(0.9, 3.0, bl);          // shade deep in the planting
      vec3 bandC = mix(leafC, stoneBase * 0.85, lip);
      if (bd > 0.0) { vec3 ln = vnoised(f * vec2(2.3, 3.1)); fBump += ln.yz * 0.35 * bd * fBand * (1.0 - lip); }
      c = mix(c, bandC, fBand);
      c = mix(c, ribC, fRib);
      fRough = mix(fRough, 0.85, fBand);
      fRough = mix(fRough, 0.35, fRib);
      fMetal *= (1.0 - fBand) * (1.0 - fRib);
      float keep = (1.0 - fRib) * (1.0 - fBand);
      fGlass *= keep; fEmit *= keep;
    }
    fAO = 1.0 - 0.3 * exp(-max(f.y, 0.0) * 0.35);
  } else if (fKind < 1.5) {
    if (N.y < -0.55) {
      // soffits (slab undersides, canopies, overhangs): timber slats or plaster, recessed downlights
      vec3 sc;
      if (fSty.z < 0.5) {
        float sl = filteredPulse(f.x, 0.11, 0.085, fw.x);
        vec3 wood = mix(vec3(0.46, 0.3, 0.17), vec3(0.6, 0.42, 0.26), mix(0.5, hash11(floor(f.x / 0.11) + FSEED), fDetail));
        sc = mix(vec3(0.12, 0.08, 0.05), wood, sl);
      } else sc = vec3(0.84, 0.82, 0.78) * (0.95 + 0.05 * vnoise(f * 2.0));
      vec2 dq = mod(f, 2.4) - 1.2;
      float dd = length(dq);
      float disc = fDot(dd, 0.07, fwm, 5.76);
      float bezel = max(fDot(dd, 0.1, fwm, 5.76) - disc, 0.0);
      c = mix(sc, vec3(0.7), bezel * 0.6);
      c = mix(c, vec3(0.95), disc);
      float dlOn = step(0.25, hash12(floor(f / 2.4) + FSEED));
      fEmit += vec3(1.0, 0.8, 0.58) * lights * dlOn * (disc * 3.0 + sc * exp(-dd * dd * 3.0) * 0.1);
      fRough = 0.72;
    } else {
      c = fStone(f, fw, stoneBase, FSEED, 3.0, 0.03);
      float panel = filteredPulse(f.y, 6.0, 5.7, fw.y) * filteredPulse(f.x, 8.0, 7.7, fw.x);
      c *= 0.9 + 0.1 * panel;
      fRough = 0.52;
      fAO = 1.0 - 0.3 * exp(-max(f.y, 0.0) * 0.35) * fVert;
    }
  } else if (fKind < 2.5) {
    // lantern glass: faceted by slender fins and rings
    float fin = 1.0 - filteredPulse(f.x, 1.6, 1.46, fw.x);
    float ringL = 1.0 - filteredPulse(f.y, 4.0, 3.82, fw.y);
    fSeam = max(fin, ringL);
    c = mix(mix(uGlass * 1.4, uRib, 0.25), uRib * 0.75, fSeam);
    fRough = mix(0.2, 0.38, fSeam); fMetal = mix(0.4, 0.6, fSeam);
    fGlass = 0.7 * (1.0 - fSeam);
  } else if (fKind < 3.5) {
    fBand = 1.0;
    vec2 gp = vWPos.xz;
    float gfw = max(length(fwW), 1e-3);
    float gd = 1.0 - smoothstep(0.12, 0.7, gfw);
    if (abs(N.y) > 0.5) {
      // planted deck: lawn, clipped shrubs, flower beds and gravel paths
      float leaf = fbm2_3(gp * 0.12);
      vec3 lawn = mix(vec3(0.06, 0.14, 0.035), vec3(0.17, 0.26, 0.075), leaf) * (0.85 + 0.3 * mix(0.5, vnoise(gp * 2.1), gd));
      vec3 w = worley2(gp * 0.75);
      float clump = (1.0 - smoothstep(0.18, 0.6, w.x)) * step(0.35, w.z);
      vec3 shrub = mix(vec3(0.03, 0.075, 0.022), vec3(0.09, 0.17, 0.045), fract(w.z * 7.3)) * (0.75 + 0.5 * vnoise(gp * 7.0));
      shrub = mix(shrub, flowerPaletteF(fract(w.z * 13.7)) * 0.75, step(0.86, w.z) * smoothstep(0.45, 0.7, vnoise(gp * 11.0)));
      vec3 gNear = mix(lawn, shrub, clump);
      vec3 avgG = mix(lawn, vec3(0.055, 0.11, 0.03), 0.4);
      c = mix(avgG, gNear, gd);
      if (gd > 0.0) { vec3 bn = vnoised(gp * 3.0 + w.z * 9.0); fBump += bn.yz * 0.25 * gd * clump; fAO *= mix(1.0, 0.75 + 0.25 * (1.0 - smoothstep(0.3, 0.7, w.x)), gd * step(0.35, w.z)); }
      c = mix(c, vec3(0.42, 0.38, 0.3) * (0.9 + 0.2 * mix(0.5, vnoise(gp * 9.0), gd)), smoothstep(0.78, 0.86, vnoise(gp * 0.35)) * 0.8);  // gravel paths
    } else {
      // vertical planting: trailing foliage spilling over planter lips and garden walls
      float strand = vnoise(vec2(f.x * 3.1, f.y * 0.6 + FSEED));
      float cl = vnoise(f * vec2(4.0, 5.0)) * 0.55 + vnoise(f * vec2(11.0, 13.0)) * 0.45 * gd;
      c = mix(vec3(0.035, 0.09, 0.025), vec3(0.16, 0.26, 0.07), cl * (0.6 + 0.4 * strand));
      c = mix(c, flowerPaletteF(hash12(floor(f / 1.7) + FSEED)) * 0.8, smoothstep(0.75, 0.88, vnoise(f * 3.3 + 5.0)) * 0.5);
      if (gd > 0.0) { vec3 bn = vnoised(f * vec2(4.0, 5.0)); fBump += bn.yz * 0.3 * gd; }
    }
    fRough = 0.9;
  } else if (fKind < 4.5) {
    // energy conduit: glazed channel held by metal collars
    float collar = 1.0 - filteredPulse(f.y, 6.0, 5.55, fw.y);
    fSeam = collar;
    fGlass = 0.4 * (1.0 - collar);
    c = mix(uGlass * 0.6, vec3(0.1, 0.11, 0.12), collar);
    fRough = mix(0.25, 0.35, collar); fMetal = mix(0.5, 0.8, collar);
  } else if (fKind < 6.5) {
    // pool water over a tiled basin
    float ca = vnoise(vWPos.xz * 1.3 + uTime * 0.4) * vnoise(vWPos.xz * 1.7 - uTime * 0.3);
    vec2 pw = fwW;
    float tile = filteredPulse(vWPos.x, 0.3, 0.28, pw.x) * filteredPulse(vWPos.z, 0.3, 0.28, pw.y);
    c = mix(vec3(0.03, 0.2, 0.24), vec3(0.1, 0.36, 0.4), ca) * mix(1.0, 0.85 + 0.15 * tile, fDetail);
    fRough = 0.03; fGlass = 0.0;
  } else if (fKind < 7.5) {
    // photovoltaic modules: monocrystalline cells with silver fingers in anodised frames
    float modF = 1.0 - filteredPulse(f.x, 1.06, 1.02, fw.x) * filteredPulse(f.y, 1.76, 1.72, fw.y);
    float cellM = filteredPulse(f.x, 0.17, 0.164, fw.x) * filteredPulse(f.y, 0.17, 0.164, fw.y);
    float finger = 1.0 - filteredPulse(f.x, 0.057, 0.055, fw.x);
    vec3 cellC = vec3(0.018, 0.028, 0.06) * (0.9 + 0.2 * mix(0.5, hash12(floor(f / 1.06) + FSEED), fDetail));
    c = mix(vec3(0.62, 0.64, 0.66), cellC, cellM);
    c = mix(c, vec3(0.3, 0.32, 0.35), finger * 0.35 * cellM);
    c = mix(c, vec3(0.5, 0.52, 0.55), modF);
    fRough = mix(0.08, 0.35, modF); fMetal = mix(0.3, 0.8, modF);
  } else if (fKind < 8.5) {
    // timber: boards with open joints, grain along each board, cedar weathering to silver
    bool horiz = abs(N.y) > 0.5;
    float across = horiz ? f.y : f.x, along = horiz ? f.x : f.y;
    float fa = horiz ? fw.y : fw.x;
    float bw = 0.145;
    float bi = floor(across / bw);
    float bh = hash11(bi * 1.7 + FSEED);
    float gap = 1.0 - filteredPulse(across, bw, bw - 0.008, fa);
    float td = 1.0 - smoothstep(0.004, 0.03, fwm);
    float gr = vnoise(vec2(across * 55.0, along * 1.4 + bh * 30.0)) * 0.6 + vnoise(vec2(across * 140.0, along * 4.0 + bh * 9.0)) * 0.4;
    vec3 cedar = mix(vec3(0.40, 0.24, 0.13), vec3(0.58, 0.38, 0.21), mix(0.5, bh, fDetail));
    vec3 silver = mix(vec3(0.44, 0.42, 0.38), vec3(0.58, 0.56, 0.52), mix(0.5, bh, fDetail));
    c = mix(cedar, silver, smoothstep(0.55, 0.85, fSty.y));
    c *= mix(1.0, 0.8 + 0.4 * gr, td);
    if (N.y > 0.4 && N.y < 0.97) {
      // pitched roofs: cedar shingles in staggered courses, each butt casting a thin shadow
      float cr = 0.19;
      float row = floor(f.y / cr);
      float sw = 0.16 + 0.14 * hash11(row * 3.1 + FSEED);
      float sx = f.x + hash11(row * 1.9 + FSEED) * sw;
      float sh = hash12(vec2(floor(sx / sw), row) + FSEED);
      float ly = f.y - row * cr;
      float butt = 1.0 - filteredPulse(f.y, cr, cr - 0.025, fw.y);
      float joint = 1.0 - filteredPulse(sx, sw, sw - 0.01, fw.x);
      c *= mix(1.0, 0.82 + 0.3 * sh, fDetail) * (1.0 - 0.45 * butt) * (1.0 - 0.35 * joint);
      c *= mix(1.0, 0.8 + 0.2 * smoothstep(0.0, cr, ly), fDetail);
      fBump += vec2(sh - 0.5, 0.35) * 0.2 * fDetail;
    } else {
      c *= 1.0 - 0.55 * gap;
      fBump += (horiz ? vec2(0.0, 1.0) : vec2(1.0, 0.0)) * fBevel(mod(across, bw) - 0.008, bw - 0.008, 0.006) * 0.5 * td;
    }
    fRough = 0.72;
  } else if (fKind < 9.5) {
    c = fStone(f, fw, stoneBase * vec3(0.95, 0.93, 0.88), FSEED + 3.0, 0.6, 0.01);
    fRough = 0.7;
  } else if (fKind < 10.5) {
    // dark metal: anodised, finely brushed along its length
    float br = vnoise(vec2(f.x * 0.7, f.y * 90.0));
    vec3 m = vec3(0.11, 0.12, 0.13);
    #ifdef LOWRISE
    m = mix(m, fFrameCol(fSty.x) * 0.8, step(fSty.x, 0.52));
    #endif
    c = m * (0.92 + 0.16 * mix(0.5, br, fDetail));
    fRough = 0.3 + 0.1 * mix(0.5, br, fDetail); fMetal = 0.85;
  } else if (fKind < 11.5) {
    // radiator / dark ceramic
    c = vec3(0.1, 0.09, 0.085) * (0.9 + 0.2 * vnoise(f * 0.5));
    fRough = 0.7;
  } else {
    // fritted-glass balustrade: dense frit at the foot fading to clear glass, fin joints
    float fp = 0.022;
    vec2 fq = mod(f, fp) - fp * 0.5;
    float dens = 1.0 - smoothstep(0.1, 0.9, clamp((f.y - floor(f.y / 3.6) * 3.6) / 1.0, 0.0, 1.0));
    float dotR = fp * 0.5 * sqrt(clamp(dens * 0.9 + 0.1, 0.0, 1.0));
    float frit = fDot(length(fq), dotR, fwm, fp * fp);
    float joint = 1.0 - filteredPulse(f.x, 1.25, 1.235, fw.x);
    c = mix(uGlass * 0.12, vec3(0.8, 0.8, 0.78), clamp(frit, 0.0, 1.0));
    c = mix(c, vec3(0.3), joint);
    fRough = mix(0.08, 0.5, frit); fMetal = mix(0.85, 0.0, frit);
    fGlass = (1.0 - frit) * (1.0 - joint) * 0.8;
    fEmit += vec3(1.0, 0.8, 0.6) * frit * lights * 0.012 * step(0.6, hash12(floor(f / 4.0) + FSEED));
  }
  #ifdef LOWRISE
  // wall-washer sconces between the ground-floor openings of stone houses
  if (lights > 0.01 && fVert > 0.5 && ((fKind > 0.5 && fKind < 1.5) || (fKind > 4.5 && fKind < 5.5)) && f.y > -0.5 && f.y < 4.6) {
    float dxl = mod(f.x + colW, 2.0 * colW) - colW;
    float dyl = f.y - 2.75;
    float spread = 0.06 + 0.24 * abs(dyl);
    float wash = exp(-dxl * dxl / (spread * spread)) * exp(-abs(dyl) * (dyl > 0.0 ? 1.3 : 0.75));
    float sconce = fBox(vec2(dxl, dyl), vec2(-0.06, -0.11), vec2(0.06, 0.11), fw);
    float sconceOn = step(0.3, hash12(vec2(floor((f.x + colW) / (2.0 * colW)), FSEED)));
    fEmit += (c * wash * 0.55 + vec3(1.2) * sconce) * vec3(1.0, 0.76, 0.5) * lights * sconceOn * (1.0 - fGlass);
  }
  #endif
  diffuseColor.rgb = c * fAO;
  #ifdef FDEBUG
  if (any(isnan(fEmit)) || any(isinf(fEmit))) { fEmit = vec3(0.0); diffuseColor.rgb = vec3(1.0, 0.0, 1.0); }
  if (any(isnan(c))) diffuseColor.rgb = vec3(0.0, 1.0, 1.0);
  if (isnan(fRough) || isnan(fMetal)) diffuseColor.rgb = vec3(1.0, 1.0, 0.0);
  #endif
}
`;

const FACADE_SURFACE = /* glsl */ `
roughnessFactor = clamp(fRough, 0.02, 1.0);
metalnessFactor = clamp(fMetal, 0.0, 1.0);
`;

const FACADE_NORMAL = /* glsl */ `
{
  vec3 wn = fT * (fTilt.x * fGlass + fBump.x) + fB * (fTilt.y * fGlass + fBump.y);
  normal = normalize(normal + (viewMatrix * vec4(wn, 0.0)).xyz);
}
`;

// Sun and moon glints off near-mirror glass can exceed the half-float range and
// blow up the bloom; keep them bright but bounded (much lower at night).
// Glass also reflects a procedural skyline of the surrounding city (the environment map
// only holds the sky), lower as the facade point rises, and the city's lights at night.
const FACADE_LIGHTS = /* glsl */ `
reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(mix(9.0, 0.35, uNight)));
#ifdef FDEBUG_L
fDbg = FDEBUG_L == 1 ? reflectedLight.directDiffuse : FDEBUG_L == 2 ? reflectedLight.directSpecular : FDEBUG_L == 3 ? reflectedLight.indirectDiffuse : FDEBUG_L == 4 ? reflectedLight.indirectSpecular : vec3(fRough, fMetal, fGlass);
#endif
vec3 fRw = reflect(-normalize(cameraPosition - vWPos), normalize((vec4(normal, 0.0) * viewMatrix).xyz));
float fRfw = length(fwidth(fRw)), fRyw = fwidth(fRw.y);         // derivatives outside the branch
if (fGlass > 0.01) {
  vec3 Rw = fRw;
  vec2 hd = Rw.xz / max(length(Rw.xz), 1e-4);
  float rfw = fRfw;
  float sd = 1.0 - smoothstep(0.02, 0.12, rfw);
  vec2 q = hd * 7.0 + vWPos.xz * 0.0011;
  float bh = hash12(floor(q * 1.7) + 13.0);
  float sky = 0.025 + 0.2 * bh * bh * step(0.2, bh) + 0.035 * vnoise(q * 3.0);
  sky = mix(0.075, sky, sd);
  sky *= clamp(1.25 - vWPos.y / 320.0, 0.1, 1.0);
  float ew = max(fRyw * 1.5, 0.003);
  float city = (1.0 - smoothstep(sky - ew, sky + ew, Rw.y)) * min(fGlass, 1.0);
  reflectedLight.indirectSpecular *= mix(vec3(1.0), vec3(0.4, 0.42, 0.45), city);
  if (uCityLights > 0.01) {
    float az = atan(hd.y, hd.x);
    vec2 wc = vec2(az * 90.0, Rw.y * 160.0);
    vec2 wf = fract(wc);
    float win = step(0.86, hash12(floor(wc) + FSEED)) * step(0.15, wf.x) * step(wf.x, 0.75) * step(0.2, wf.y) * step(wf.y, 0.8);
    win *= 1.0 - smoothstep(sky * 0.4, sky, Rw.y);    // lit windows cluster low in the mirrored city
    float sd2 = 1.0 - smoothstep(0.002, 0.01, rfw);
    reflectedLight.indirectSpecular += vec3(1.0, 0.72, 0.45) * mix(0.04, win, sd2) * city * uCityLights * 0.35 * fFres;
  }
}
`;

const FACADE_EMISSIVE = /* glsl */ `
{
  float lights = uCityLights;
  #ifdef FDEBUG_NOEMIT
  fEmit = vec3(0.0);
  #endif
  totalEmissiveRadiance += fEmit;
  totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * fBand * 0.025 * lights * step(fKind, 0.5);
  // energy veins climbing the ribs: slow pulses
  float column = floor(vFacade.x / (uColW * 5.0));
  float ph = hash11(column + FSEED * 13.0);
  float pulse = pow(fract(vFacade.y / 340.0 - uTime * (0.05 + 0.04 * ph) + ph), 22.0);
  float veinOn = step(0.45, ph) * step(fKind, 4.5);
  #ifdef LOWRISE
  veinOn = 0.0;                     // houses have no energy veins
  #endif
  totalEmissiveRadiance += uVein * fVein * veinOn * (0.015 + 0.5 * pulse) * (0.1 + 0.9 * lights);
  // warm uplight grazing the base of the building at night
  totalEmissiveRadiance += uLightCol * uUplight * lights * 0.05 * exp(-max(vFacade.y, 0.0) * 0.03) * (1.0 - fGlass) * step(fKind, 1.5);
  if (fKind > 1.5 && fKind < 2.5) {
    float breathe = 0.8 + 0.2 * sin(uTime * 0.6 + FSEED);
    totalEmissiveRadiance += uLightCol * (0.03 + 0.22 * lights) * breathe * (1.0 - 0.75 * fSeam);
  }
  if (fKind > 3.5 && fKind < 4.5) {
    float flow = pow(fract(vFacade.y / 180.0 - uTime * 0.12), 10.0);
    totalEmissiveRadiance += uVein * (0.04 + 0.6 * flow) * (0.25 + 0.75 * lights) * (1.0 - 0.85 * fSeam);
  }
  if (fKind > 5.5 && fKind < 6.5) totalEmissiveRadiance += vec3(0.2, 0.75, 0.85) * 0.05 * lights;
}
`;

// flower accents shared by window boxes, planted decks and garden bands
const FLOWERS = /* glsl */ `
vec3 flowerPaletteF(float k) {
  if (k < 0.20) return vec3(0.78, 0.13, 0.05);
  if (k < 0.37) return vec3(0.36, 0.26, 0.72);
  if (k < 0.54) return vec3(0.88, 0.64, 0.08);
  if (k < 0.70) return vec3(0.88, 0.40, 0.58);
  if (k < 0.85) return vec3(0.92, 0.88, 0.74);
  return vec3(0.72, 0.10, 0.40);
}
`;

// Worley cells (x = F1, y = F2 - F1, z = cell hash); named apart from the nature copy
const WORLEY = /* glsl */ `
vec3 worley2(vec2 p) {
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 r = o + hash22(ip + o) - fp;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash12(ip + o + 5.7); } else if (d < d2) d2 = d;
  }
  d1 = sqrt(d1);
  return vec3(d1, sqrt(d2) - d1, id);
}
`;

const PARS_ALL = FLOWERS + WORLEY + FACADE_PARS;

export const FACADE_HOOKS = {
  key: 'facade3',
  vertex: {
    pars: 'attribute vec3 aFacade; varying vec3 vFacade;',
    transform: 'vFacade = aFacade;',
  },
  fragment: {
    pars: PARS_ALL,
    color: FACADE_COLOR,
    surface: FACADE_SURFACE,
    normal: FACADE_NORMAL,
    emissive: FACADE_EMISSIVE,
    lights: FACADE_LIGHTS,
    end: '#if defined(FDEBUG_W) || defined(FDEBUG_L)\ngl_FragColor = vec4(fDbg, 1.0);\n#endif',
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
    key: `lowrise3_${lod}`,
    uniforms,
    defines: Object.assign({ FSEED: '(uSeed + vSeed)', LOWRISE: 1 }, lod ? { LR_LOD: lod.toFixed(1) } : {}),
    vertex: {
      pars: 'attribute vec3 aFacade; attribute vec2 aInst; varying vec3 vFacade; flat varying float vSeed; uniform float uNearR;',
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
      pars: 'flat varying float vSeed;   // flat: interpolation error would scramble the hashes\n' + PARS_ALL,
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
