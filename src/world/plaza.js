import * as THREE from 'three';
import { patchedMaterial, FACADE_GLSL } from './materials.js';
import { PLAZA_Y, PLAZA_R, ISLANDS, promenadeAxis } from './layout.js';

// The Commons: the plaza at the foot of the Axis, and its terrace.
//
// The stone disc (y = PLAZA_Y, radius PLAZA_R) is laid out in its own polar frame and painted
// by plazaMaterial() (courses, avenues, rills, pools, parterres, compass rose, the meridian).
// Everything that stands proud of it is real geometry that sits exactly on the paint of the
// same thing, so the paint alone carries it at a distance (the near sets collapse by LOD):
//   - two rings of reflecting pools: stone coping round every basin, water 15 cm below it
//   - two parterre rings: a granite kerb, a clipped box border, walk edgings and knots of box
//   - the rim: a stone parapet with a moulded coping, and at every avenue end a stair of
//     twenty steps between cheek walls down to the planted terrace
// Nothing stands where the walkers go (people.js lanes: 80-205, 262-298, 338-372, 424-456,
// 486-548 m and +-3.6 m about each avenue axis) or where the tree planner roots the garden
// trees (palms at r 226 / 246, jacarandas at 384 / 406: gravel allees keep them clear).
// None of these meshes carries aFacade, so clearance.js treats the plaza as designed ground.

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------- the plan --
const RIM = PLAZA_R;                       // outer face of the rim wall
const TERRACE_Y = PLAZA_Y - 3.5;           // the planted terrace (treePlanner plants it at PLAZA_Y - 3.5)
const TERRACE_R = PLAZA_R + 44;            // its outer edge; the ring town stands beyond
const AV_HALF = 9.0, AV_KERB = 9.8;        // travertine avenue, granite kerb either side
const RILL = 6.3, RILL_HALF = 0.25;        // twin rills, clear of the walkers (+-3.6 m)
const POOLS = [{ c: 318, h: 16 }, { c: 470, h: 9, roots: true }];   // centre radius, half-width (coping included)
const COPING = 0.7;                        // coping width
const COPING_Y = PLAZA_Y + 0.45, WATER_Y = PLAZA_Y + 0.3;
// parterres: centre radius, half-width, and the radii of the tree planner's rings in them
const GARDENS = [{ c: 235, h: 22, trees: [226, 246], n: [109, 118], clear: 15.6 }, { c: 396, h: 25, trees: [384, 406], n: [141, 150], clear: 16.5 }];
const G_KERB = 0.3, G_BORDER = 0.85, G_WALK = 1.6, G_EDGE = 1.9, G_ALLEE = 1.3, G_CLOSE = 0.3;
const ROOT_N = 8, ROOT_A0 = TAU / 16;      // the eight root arches of the Axis (axis.js)
const DECK_HALF = 14.5;                    // promenade deck, parapet to parapet (infrastructure.js)
const STAIR = { n: 20, rise: 0.175, tread: 0.36, half: 9.0, cheek: 0.5 };
const PARAPET_TOP = PLAZA_Y + 0.97;
const NEAR_LOD = 1500, HEDGE_LOD = 650;

const f4 = (x) => (Math.abs(x) < 1e-9 ? 0 : x).toFixed(5);
const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
const avAngle = (k) => (k * TAU) / 12;
const offA = (L, r) => Math.asin(Math.min(0.999, L / r));

// ----------------------------------------------------------------------- shared GLSL --
// Plan functions shared by the paint and the pool water (constants baked from the plan
// above, so paint and geometry cannot drift apart).
function planGLSL(cuts) {
  const G0 = GARDENS[0], G1 = GARDENS[1];
  const gv = (g) => `vec4(${f4(g.c)}, ${f4(g.h)}, ${f4(g.trees[0] - g.c)}, ${f4(g.trees[1] - g.c)})`;
  return /* glsl */ `
#define P_TAU 6.28318530718
const float P_Y = ${f4(PLAZA_Y)};
const float P_RIM = ${f4(RIM)};
const float P_AVH = ${f4(AV_HALF)};
const float P_KERB = ${f4(AV_KERB)};
const float P_RILL = ${f4(RILL)};
const float P_RILLW = ${f4(RILL_HALF)};
const float P_COPING = ${f4(COPING)};
const float P_ROOT0 = ${f4(ROOT_A0)};
const vec2 P_CUT[8] = vec2[8](${cuts.map((c) => `vec2(${f4(c[0])}, ${f4(c[1])})`).join(', ')});
// signed metres across the nearest avenue (tAv: its lateral unit vector)
float pAvenue(vec2 p, float a, out vec2 tAv) {
  float al = floor(a / P_TAU * 12.0 + 0.5) * P_TAU / 12.0;
  tAv = vec2(-sin(al), cos(al));
  return dot(p, tAv);
}
// metres inside a reflecting pool, coping included (negative outside). The avenues cross on
// causeways and the outer ring stops short of the Axis roots.
float pPool(float r, float a, float av) {
  float d1 = ${f4(POOLS[0].h)} - abs(r - ${f4(POOLS[0].c)});
  float d2 = ${f4(POOLS[1].h)} - abs(r - ${f4(POOLS[1].c)});
  float ri = floor((a - P_ROOT0) / (P_TAU / 8.0) + 0.5);
  float da = a - (P_ROOT0 + ri * P_TAU / 8.0);
  vec2 cut = P_CUT[clamp(int(mod(ri, 8.0)), 0, 7)];
  if (cut.x < cut.y) d2 = min(d2, max(sin(cut.x - da), sin(da - cut.y)) * r);
  return min(max(d1, d2), av - P_KERB);
}
// metres inside a parterre ring, kerb included (negative outside); G = (centre, half-width,
// inner allee, outer allee) in metres from the centre line
float pGarden(float r, float av, out vec4 G) {
  G = r < ${f4((G0.c + G1.c) / 2)} ? ${gv(G0)} : ${gv(G1)};
  return min(G.y - abs(r - G.x), av - P_KERB);
}
// box-filtered coverage of the band |d| < w by a footprint of half-width f
float pCov(float d, float w, float f) {
  float h = max(f, 1e-4);
  return clamp((min(d + h, w) - max(d - h, -w)) / (2.0 * h), 0.0, 1.0);
}
// box-filtered step (1 where d > 0)
float pStep(float d, float f) { return clamp(d / (2.0 * max(f, 1e-4)) + 0.5, 0.0, 1.0); }
`;
}

// ----------------------------------------------------------------------- the plaza paint --
// Pale limestone laid in concentric courses, dark granite bands with bronze inlays every 24 m,
// twelve travertine avenues each with twin rills (a real channel seen by parallax), slot drains
// with bronze gratings along the kerbs and the rim, the pools' coping and water, the parterres
// (kerb, box border, walk, knots, allees with tree pits, flower beds), a compass rose round the
// core and the bronze prime meridian running north-south across the whole plaza. Below the rim:
// a paved walk, paths from the stairs, lawn, a kerb; the walls in coursed ashlar. Everything is
// filtered by the pixel footprint (far = the near pattern averaged).
function plazaMaterial(cuts) {
  const G0 = GARDENS[0], G1 = GARDENS[1];
  return patchedMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.8 }, {
    key: 'plaza3',
    fragment: {
      pars: /* glsl */ `
${FACADE_GLSL}
${planGLSL(cuts)}
float pPool0; float pGarden0; float pRough; float pMetal; float pAO; vec2 pHg; float pTop; float pTerr; float pSeam; vec3 pEmit; vec4 pN; vec2 pWg;
vec3 plazaFlower(float k) {
  if (k < 0.3) return vec3(0.92, 0.9, 0.84);      // white
  if (k < 0.55) return vec3(0.9, 0.7, 0.16);      // gold
  if (k < 0.75) return vec3(0.86, 0.46, 0.58);    // rose
  if (k < 0.87) return vec3(0.44, 0.34, 0.7);     // lavender
  return vec3(0.76, 0.16, 0.08);                  // scarlet
}
float pBevel(float l, float L, float w) { return (1.0 - smoothstep(0.0, w, L - l)) - (1.0 - smoothstep(0.0, w, l)); }
`,
      color: /* glsl */ `
{
  vec2 p = vWPos.xz;
  float r = max(length(p), 1e-3);
  float a = atan(p.y, p.x);
  vec2 er = p / r, et = vec2(-er.y, er.x);                    // radial and tangential unit vectors
  float fw = max(length(fwidth(p)), 1e-3);                     // metres per pixel
  float pd = 1.0 - smoothstep(0.012, 0.07, fw);               // joints resolvable
  float pt = 1.0 - smoothstep(0.12, 0.5, fw);                 // slab-to-slab tone resolvable
  float pg = 1.0 - smoothstep(0.004, 0.025, fw);              // grain
  float pb = 1.0 - smoothstep(0.006, 0.024, fw);              // bevels
  vec3 Nw = normalize(vWNrm);
  pTop = step(0.5, Nw.y) * step(P_Y - 0.5, vWPos.y);
  pTerr = step(0.5, Nw.y) * (1.0 - pTop);
  pHg = vec2(0.0); pEmit = vec3(0.0); pAO = 1.0; pRough = 0.55; pMetal = 0.0; pSeam = 0.0; pPool0 = 0.0; pGarden0 = 0.0;
  pN = vec4(0.0, 1.0, 0.0, 0.0); pWg = vec2(0.0);
  vec2 tAv;
  float sa = pAvenue(p, a, tAv);
  float av = abs(sa);
  vec3 c;
  if (pTop > 0.5) {
    float avenue = pStep(P_AVH - av, fw);
    float kerbA = pStep(P_KERB - av, fw) - avenue;
    // ---- field: limestone in concentric courses, slabs ~1.8 m along the arc
    float ring = floor(r / 1.2);
    float nS = max(floor(P_TAU * (ring + 0.5) * 1.2 / 1.8), 3.0);
    float s = (a / P_TAU + 0.5) * nS + hash11(ring * 1.7);
    float sw = nS / (P_TAU * r);                                  // slabs per metre along the arc
    float jR = 1.0 - fPulse(r, 1.2, 0.012, 1.2, fw);
    float jT = 1.0 - fPulse(s, 1.0, 0.012 * sw, 1.0, fw * sw);
    float sid = hash12(vec2(floor(s), ring) + 3.0);
    vec3 lime = vec3(0.77, 0.75, 0.70);
    vec3 fieldC = lime * mix(1.0, 0.9 + 0.18 * sid, pt) * (1.0 + vec3(0.02, 0.0, -0.03) * (fract(sid * 9.1) - 0.5) * pt);
    fieldC *= mix(1.0, 0.93 + 0.14 * vnoise(p * 3.0 + sid * 17.0), pd);
    fieldC *= 1.0 - 0.1 * smoothstep(0.8, 0.93, vnoise(p * 23.0 + sid * 5.0)) * pg;          // shell fragments
    float jF = max(jR, jT);
    fieldC = mix(fieldC, vec3(0.36, 0.34, 0.31), jF);
    // bevelled arrises either side of every joint, and a whisper of lippage slab to slab
    pHg -= (er * pBevel(mod(r, 1.2) - 0.012, 1.188, 0.014) + et * pBevel(fract(s) / sw - 0.012, 1.0 / sw - 0.012, 0.014)) * 0.42 * pb;
    pHg += (hash22(vec2(sid * 71.0, ring)) - 0.5) * 0.02 * pd;
    pAO *= 1.0 - 0.35 * jF * pd;
    c = fieldC;
    // ---- dark granite rings every 24 m with bronze inlay at both edges
    float dB = abs(mod(r, 24.0) - 12.0);
    float band = pStep(0.6 - dB, fw);
    float bronzeB = pCov(dB - 0.62, 0.025, fw) * (1.0 - avenue);
    vec3 granite = vec3(0.19, 0.185, 0.18) * (0.9 + 0.2 * mix(0.5, vnoise(p * 9.0), pd));
    granite *= 1.0 + 0.25 * smoothstep(0.7, 0.9, vnoise(p * 40.0)) * pg;                     // feldspar glints
    c = mix(c, granite, band * (1.0 - avenue));
    pRough = mix(pRough, 0.22, band * (1.0 - avenue));
    // ---- avenues: travertine laid along the avenue, twin rills, slot drains at the kerbs
    if (avenue + kerbA > 0.0) {
      float arow = floor(r / 1.6);
      float ax = sa + mod(arow, 2.0) * 0.4;
      float aid = hash12(vec2(floor(ax / 0.8), arow) + 9.0);
      float jA = max(1.0 - fPulse(r, 1.6, 0.012, 1.6, fw), 1.0 - fPulse(ax, 0.8, 0.012, 0.8, fw));
      vec3 trav = vec3(0.86, 0.82, 0.74) * mix(1.0, 0.9 + 0.16 * aid, pt);
      trav *= 1.0 - 0.22 * smoothstep(0.72, 0.9, vnoise(vec2(r * 1.5, sa * 12.0) + aid * 11.0)) * pd;   // travertine pores
      trav = mix(trav, vec3(0.46, 0.43, 0.38), jA);
      pHg -= (er * pBevel(mod(r, 1.6) - 0.012, 1.588, 0.014) + tAv * pBevel(mod(ax, 0.8) - 0.012, 0.788, 0.014)) * 0.42 * pb * avenue;
      pAO *= 1.0 - 0.3 * jA * pd * avenue;
      // the rills: channels 0.5 m wide, the water 8 cm down. Seen through the opening the ray
      // meets the water, or the channel's far wall when it looks across it at a low angle.
      float onRill = pStep(r - 96.0, fw) * pStep(P_RIM - 4.0 - r, fw);
      float xr = sa - sign(sa) * P_RILL;                        // metres across the nearer rill
      vec3 V = normalize(cameraPosition - vWPos);
      float slope = dot(V.xz, tAv) / max(V.y, 0.06);
      float xw = xr - 0.08 * slope;                             // where the ray meets the water
      float inRill = pCov(xr, P_RILLW, fw) * onRill;
      float seeW = mix(pCov(xw, P_RILLW, fw), 0.7, smoothstep(0.08, 0.3, fw));
      float lip = pCov(abs(xr) - P_RILLW - 0.02, 0.02, fw) * onRill;   // bronze lips
      vec3 wallC = vec3(0.3, 0.29, 0.27) * (0.8 + 0.2 * vnoise(vec2(r * 4.0, xw * 9.0)));
      vec3 waterC = vec3(0.012, 0.04, 0.045);
      vec3 avC = mix(trav, mix(wallC, waterC, seeW), inRill);
      avC = mix(avC, vec3(0.55, 0.4, 0.22), lip);
      // slot drains between the travertine and the granite kerb: dark slot, bronze grating
      float drain = pCov(av - P_AVH - 0.03, 0.025, fw);
      float bars = mix(fPulse(r, 0.045, 0.0, 0.012, fw), 0.27, smoothstep(0.01, 0.03, fw));
      vec3 drainC = mix(vec3(0.02, 0.018, 0.016), vec3(0.42, 0.31, 0.18), bars);
      c = mix(c, avC, avenue);
      c = mix(c, granite * 1.3, kerbA);
      c = mix(c, drainC, drain);
      pRough = mix(pRough, 0.5, avenue);
      pRough = mix(pRough, mix(0.55, 0.03, seeW), inRill * avenue);
      pRough = mix(pRough, 0.3, max(lip, drain * bars));
      pMetal = mix(pMetal, 0.9, max(lip, drain * bars) * avenue);
      pAO *= 1.0 - 0.3 * drain * (1.0 - bars);
      // ripples run outward down the rill; the far wall faces back across the channel
      float fl = (1.0 - smoothstep(0.05, 0.3, fw)) * seeW * inRill;
      pHg += vnoised(vec2(r * 2.2 - uTime * 1.3, xw * 9.0)).yz * 0.05 * fl;
      float wallM = (1.0 - seeW) * inRill * (1.0 - smoothstep(0.05, 0.25, fw));
      pN = vec4(vec3(-tAv.x, 0.0, -tAv.y) * sign(xw), wallM);
      pAO *= 1.0 - 0.35 * inRill * (1.0 - seeW);
      pSeam += lip * 0.6;
      pEmit += vec3(0.25, 0.7, 0.8) * inRill * seeW * 0.025;
    }
    // ---- reflecting pools: the stone coping and the water (the near set stands on this paint)
    float dPool = pPool(r, a, av);
    float inPool = pStep(dPool, fw);
    float coping = inPool * pStep(P_COPING - dPool, fw);
    float waterM = inPool - coping;
    if (inPool > 0.0) {
      vec3 cop = vec3(0.8, 0.78, 0.73) * (0.95 + 0.1 * mix(0.5, vnoise(p * 4.0), pd));
      vec3 wat = vec3(0.012, 0.038, 0.045);
      c = mix(c, cop, coping);
      c = mix(c, wat, waterM);
      pRough = mix(pRough, 0.5, coping);
      pRough = mix(pRough, 0.02, waterM);
      pMetal *= 1.0 - inPool;
      pAO = mix(pAO, 1.0, inPool);                  // the paving's joints stop at the coping
      pHg *= 1.0 - inPool;
      pN.w *= 1.0 - inPool;
      vec3 w1 = vnoised(p * 0.9 + vec2(uTime * 0.35, uTime * 0.2));
      vec3 w2 = vnoised(p * 2.3 - vec2(uTime * 0.5, -uTime * 0.3));
      pHg += (w1.yz * 0.02 + w2.yz * 0.012) * waterM * (1.0 - smoothstep(0.2, 0.8, fw));
      pPool0 = waterM;
      pEmit += vec3(0.2, 0.62, 0.72) * waterM * 0.012;
    }
    // ---- parterres: granite kerb, clipped box border, gravel walk with box edging, knots of box
    //      in two bands, gravel allees for the tree rings (a mulch pit at every tree), flower beds
    vec4 G;
    float dGar = pGarden(r, av, G);
    float garden = pStep(dGar, fw);
    if (garden > 0.0) {
      float gd = 1.0 - smoothstep(0.1, 0.5, fw);
      float lr = r - G.x;
      float kerbG = pStep(${f4(G_KERB)} - dGar, fw);
      float border = pStep(${f4(G_BORDER)} - dGar, fw) - kerbG;
      float walk = pCov(lr, ${f4(G_WALK)}, fw);
      float edging = pCov(lr, ${f4(G_EDGE)}, fw) - walk;
      // knot bands between the walk edging and the allees; the closing hedge on the allee side
      float side = lr < 0.0 ? G.z : G.w;                          // the allee on this side
      float band0 = ${f4(G_EDGE)}, band1 = abs(side) - ${f4(G_ALLEE + G_CLOSE)};
      float v = abs(lr) - band0, W = band1 - band0;
      float inBand = pStep(v, fw) * pStep(W - v, fw);
      float closer = pCov(abs(lr) - (band1 + ${f4(G_CLOSE * 0.5)}), ${f4(G_CLOSE * 0.5)}, fw);
      float u = G.x * (a - (floor(a / (P_TAU / 12.0)) + 0.5) * (P_TAU / 12.0));
      float dP = abs(fract((u - v) / W + 0.5) - 0.5) * W * 0.7071;
      float dM = abs(fract((u + v) / W + 0.5) - 0.5) * W * 0.7071;
      float knot = max(pCov(dP, 0.15, fw), pCov(dM, 0.15, fw)) * inBand;
      vec2 cell = vec2(floor((u - v) / W), floor((u + v) / W));
      float allee = pCov(lr - side, ${f4(G_ALLEE)}, fw);
      // the trees of the ring on this side (where the tree planner keeps them: clear of the avenues)
      float nT = lr < 0.0 ? ${f4(G0.n[0])} : ${f4(G0.n[1])};
      if (G.x > 300.0) nT = lr < 0.0 ? ${f4(G1.n[0])} : ${f4(G1.n[1])};
      float at = floor(a / (P_TAU / nT) + 0.5) * (P_TAU / nT);
      float rt = G.x + side;
      float dAvT = abs(fract(at / P_TAU * 12.0 + 0.5) - 0.5) * rt * P_TAU / 12.0;
      float treeOk = step(${f4(G0.clear)}, dAvT);
      if (G.x > 300.0) treeOk = step(${f4(G1.clear)}, dAvT);
      float dT = length(p - rt * vec2(cos(at), sin(at)));
      float pit = pCov(dT, 0.85, fw) * treeOk * allee;
      float pitRim = pCov(dT - 0.9, 0.05, fw) * treeOk * allee;
      // colours
      vec3 boxC = vec3(0.03, 0.085, 0.022) * (0.8 + 0.4 * mix(0.5, vnoise(p * 7.0), gd));
      vec3 gravel = vec3(0.66, 0.6, 0.5) * (0.9 + 0.2 * mix(0.5, vnoise(p * 13.0), pd));
      gravel *= 1.0 - 0.12 * mix(0.5, smoothstep(0.55, 0.8, vnoise(p * 41.0)), pg);
      vec3 graniteK = vec3(0.2, 0.195, 0.19) * (0.9 + 0.2 * mix(0.5, vnoise(p * 9.0), pd));
      float bedId = hash12(vec2(floor(u / 6.0), sign(lr) + floor(G.x)));
      vec3 bloom = plazaFlower(fract(bedId * 7.31)) * 0.75;
      float clump = mix(0.5, vnoise(p * 3.3 + bedId * 30.0), gd);
      float heads = mix(0.45, smoothstep(0.5, 0.75, vnoise(p * 11.0 + bedId * 17.0)), pd);
      vec3 leaf = vec3(0.05, 0.11, 0.03) * (0.75 + 0.5 * clump);
      vec3 bed = mix(leaf, bloom * (0.8 + 0.3 * clump), heads);
      bed = mix(vec3(0.07, 0.05, 0.035), bed, mix(0.85, smoothstep(0.15, 0.4, clump), gd));   // soil between the plants
      float cellK = hash12(cell + floor(G.x));
      vec3 cellC = cellK < 0.5 ? vec3(0.58, 0.3, 0.2) * (0.9 + 0.2 * mix(0.5, vnoise(p * 17.0), pd))
                               : mix(vec3(0.3, 0.3, 0.5), vec3(0.42, 0.36, 0.62), mix(0.5, vnoise(p * 9.0), gd));    // brick-red gravel or lavender
      vec3 gC = bed;
      gC = mix(gC, cellC, inBand);
      gC = mix(gC, gravel, max(walk, allee));
      gC = mix(gC, vec3(0.1, 0.07, 0.045), pit);
      gC = mix(gC, vec3(0.45, 0.33, 0.19), pitRim);
      float hedge = max(max(edging, closer), max(knot, border));
      gC = mix(gC, boxC, hedge);
      gC = mix(gC, graniteK, kerbG);
      if (gd > 0.0) {
        pHg += vnoised(p * 5.0).yz * 0.16 * gd * (1.0 - max(walk, allee)) * (1.0 - kerbG);
        pAO *= mix(1.0, 0.8, gd * (1.0 - hedge) * (1.0 - max(walk, allee)) * (1.0 - clump));
      }
      c = mix(c, gC, garden);
      pRough = mix(pRough, mix(0.9, mix(0.8, 0.45, kerbG), max(max(walk, allee), kerbG)), garden);
      pMetal = mix(pMetal, 0.8, pitRim * garden);
      pMetal *= 1.0 - garden * (1.0 - pitRim);
      pAO = mix(pAO, 1.0, garden * 0.5);
      pHg *= 1.0 - garden * kerbG;
      pN.w *= 1.0 - garden;
      pGarden0 = garden;
    }
    // ---- compass rose round the core: sixteen points of dark and pale granite
    if (r > 80.0 && r < 160.0) {
      float k = a / P_TAU * 16.0;
      float kf = fract(k + 0.5) - 0.5;
      float card = step(0.5, fract(floor(k + 0.5) * 0.5));                  // alternate long / short points
      float len = mix(48.0, 72.0, 1.0 - card);
      float tri = 1.0 - abs(kf) * 2.0;
      float pr = (r - 84.0) / len;
      float inPt = (1.0 - smoothstep(tri - fw / len, tri + fw / len, pr)) * step(0.0, pr);
      float half1 = step(0.0, kf);
      vec3 rose = mix(vec3(0.2, 0.19, 0.19), vec3(0.88, 0.86, 0.8), half1);
      float edge = pCov(abs(kf) * r * P_TAU / 16.0, 0.04, fw) * inPt;
      rose = mix(rose, vec3(0.5, 0.36, 0.2), edge);
      c = mix(c, rose, inPt * (1.0 - avenue));
      pRough = mix(pRough, 0.25, inPt * (1.0 - avenue));
      pSeam += edge * 0.8;
      float hub = pCov(r - 84.0, 0.08, fw) + pCov(r - 158.0, 0.08, fw);
      c = mix(c, vec3(0.5, 0.36, 0.2), hub);
      pMetal = mix(pMetal, 0.9, max(edge, hub));
      pSeam += hub;
    }
    // ---- the rim: a granite border in front of the parapet, a slot drain along it
    {
      float rimB = pStep(r - 557.5, fw);
      float rdrain = pCov(r - 557.25, 0.025, fw);
      float rbars = mix(fPulse(a * r, 0.045, 0.0, 0.012, fw), 0.27, smoothstep(0.01, 0.03, fw));
      c = mix(c, granite * 1.15, rimB);
      pRough = mix(pRough, 0.3, rimB);
      c = mix(c, mix(vec3(0.02, 0.018, 0.016), vec3(0.42, 0.31, 0.18), rbars), rdrain);
      pMetal = mix(pMetal, 0.9, rdrain * rbars);
      pHg *= 1.0 - rdrain;
    }
    // ---- the prime meridian: a bronze strip north-south across the plaza, ticked every metre
    float mer = pCov(p.x, 0.12, fw) * (1.0 - waterM);
    float tick = pCov(abs(fract(p.y + 0.5) - 0.5), 0.012, fw) * pCov(p.x, 0.35, fw);
    float tick10 = pCov(abs(fract(p.y / 10.0 + 0.5) - 0.5) * 10.0, 0.025, fw) * pCov(p.x, 0.7, fw);
    float merM = max(mer, max(tick, tick10) * (1.0 - waterM) * pd) * step(r, 559.5);
    c = mix(c, vec3(0.62, 0.44, 0.24), merM);
    pRough = mix(pRough, 0.28, merM);
    pMetal = mix(pMetal, 0.95, merM);
    pSeam += bronzeB * 1.2 * (1.0 - inPool) + mer * 1.5;          // only the bronze lines glow
    c = mix(c, vec3(0.6, 0.43, 0.24), bronzeB);
    pMetal = mix(pMetal, 0.9, bronzeB);
    pRough = mix(pRough, 0.3, bronzeB);
    // ---- contact shade at the foot of everything that stands on the paving
    float cont = max(max(1.0 - smoothstep(0.0, 0.35, -dPool), 1.0 - smoothstep(0.0, 0.3, -dGar)), 1.0 - smoothstep(0.0, 0.4, 559.54 - r));
    pAO *= 1.0 - 0.28 * cont * (1.0 - inPool) * (1.0 - garden) * pt;
  } else if (pTerr > 0.5) {
    // ---- the terrace: a paved walk along the foot of the wall where the stairs land, paths
    //      from every stair out to the ring town, a lawn in between, a kerb at the edge
    float walkT = pStep(568.0 - r, fw);
    float pathT = pCov(sa, 4.0, fw) * pStep(r - 567.0, fw);
    float edgeT = pStep(r - 603.4, fw);
    float pave = max(walkT, pathT) * (1.0 - edgeT);
    float row = floor(r / 0.9);
    float us = (a / P_TAU + 0.5) * floor(P_TAU * r / 1.4);
    float pid = hash12(vec2(floor(us + hash11(row) ), row));
    float jP = max(1.0 - fPulse(r, 0.9, 0.012, 0.9, fw), 1.0 - fPulse(us + hash11(row), 1.0, 0.012 / 1.4, 1.0, fw / 1.4));
    vec3 paveC = vec3(0.74, 0.72, 0.67) * mix(1.0, 0.9 + 0.16 * pid, pt);
    paveC = mix(paveC, vec3(0.4, 0.38, 0.34), jP);
    float mow = 0.5 + 0.5 * sin(r * P_TAU / 3.0);
    vec3 grass = mix(vec3(0.07, 0.15, 0.035), vec3(0.14, 0.24, 0.06), vnoise(p * 0.2));
    grass *= 0.9 + 0.12 * mix(0.5, mow, pt);
    grass *= 0.85 + 0.3 * mix(0.5, vnoise(p * 2.3), 1.0 - smoothstep(0.1, 0.5, fw));
    grass *= 1.0 - 0.18 * mix(0.5, vnoise(p * 23.0), pd);               // blades and their shade
    grass = mix(grass, vec3(0.2, 0.26, 0.08), 0.35 * smoothstep(0.62, 0.8, vnoise(p * 0.7 + 3.0)));   // clover and dry patches
    vec3 kerbC = vec3(0.2, 0.195, 0.19) * (0.9 + 0.2 * mix(0.5, vnoise(p * 9.0), pd));
    c = mix(grass, paveC, pave);
    c = mix(c, kerbC, edgeT);
    pRough = mix(0.92, 0.6, max(pave, edgeT));
    pHg += vnoised(p * 7.0).yz * 0.1 * (1.0 - smoothstep(0.03, 0.2, fw)) * (1.0 - max(pave, edgeT));
    pHg -= er * pBevel(mod(r, 0.9) - 0.012, 0.888, 0.014) * 0.4 * pb * pave;
    pAO *= 1.0 - 0.3 * jP * pd * pave;
    pAO *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.5, r - 560.22)) * pt;   // at the foot of the wall
  } else {
    // ---- rim and retaining walls: coursed ashlar with drafted margins, a darker plinth course
    vec2 q = vec2(a * r, vWPos.y);
    float courseH = 0.58;
    float cy = (P_Y - 0.05 - q.y) / courseH;
    float course = floor(cy);
    float bx = q.x + mod(course, 2.0) * 0.7;
    float bid = hash12(vec2(floor(bx / 1.4), course));
    float fwq = max(fw, fwidth(q.y));
    float jc = 1.0 - fPulse(cy, 1.0, 0.0, 1.0 - 0.012 / courseH, fwq / courseH);
    float jb = 1.0 - fPulse(bx, 1.4, 0.012, 1.4, fwq);
    float j = max(jc, jb);
    c = vec3(0.74, 0.72, 0.67) * mix(1.0, 0.88 + 0.2 * bid, pt) * (1.0 - 0.45 * j);
    c *= mix(1.0, 0.94 + 0.1 * vnoise(q * vec2(2.0, 5.0) + bid * 13.0), pd);
    float plinth = 1.0 - step(P_Y - 3.05, vWPos.y);
    c = mix(c, vec3(0.5, 0.49, 0.46), plinth);
    c *= mix(vec3(0.82, 0.8, 0.74), vec3(1.0), smoothstep(P_Y - 4.0, P_Y - 3.2, vWPos.y));   // damp base
    c *= 1.0 - 0.1 * smoothstep(0.6, 0.9, vnoise(vec2(q.x * 0.9, q.y * 0.08))) * pt;          // faint rain streaks
    pWg = vec2(pBevel(mod(bx, 1.4) - 0.012, 1.388, 0.02), -pBevel(fract(cy) * courseH, courseH - 0.012, 0.02)) * 0.5 * pb;
    pAO *= 1.0 - 0.3 * j * pd;
    pRough = 0.6;
  }
  diffuseColor.rgb = c * pAO;
}
`,
      surface: /* glsl */ `
roughnessFactor = clamp(pRough, 0.02, 1.0);
metalnessFactor = clamp(pMetal, 0.0, 1.0);
`,
      normal: /* glsl */ `
{
  vec3 nw;
  if (pTop + pTerr > 0.5) {
    nw = normalize(vec3(-pHg.x, 1.0, -pHg.y));
    nw = normalize(mix(nw, pN.xyz, pN.w));
  } else {
    vec3 N = normalize(vWNrm);
    vec3 T = vec3(-vWPos.z, 0.0, vWPos.x) / max(length(vWPos.xz), 1.0);
    nw = normalize(N + T * pWg.x + vec3(0.0, 1.0, 0.0) * pWg.y);
  }
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
}
`,
      lights: /* glsl */ `
reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(mix(9.0, 0.35, uNight)));
reflectedLight.indirectDiffuse *= pAO;
`,
      emissive: /* glsl */ `
totalEmissiveRadiance += vec3(1.0, 0.8, 0.55) * pSeam * uCityLights * 0.14;
totalEmissiveRadiance += pEmit * (0.25 + 0.75 * uCityLights);
`,
    },
  });
}

// ------------------------------------------------------------------ stone of the works --
// Copings, kerbs, the parapet, treads, risers and cheek walls. aStone = (metres along the
// run, metres along the profile, kind): 0 pool coping, 1 granite kerb, 2 parapet, 3 tread,
// 4 riser, 5 cheek wall. Stones of each kind in their own lengths, bevelled joints (tilted
// normals along the run), tone and grain per stone, a damp line where copings meet the water.
function stoneMaterial() {
  return patchedMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.8 }, {
    key: 'plaza-stone',
    vertex: {
      pars: 'attribute vec3 aStone;\nvarying vec3 vStone;',
      transform: 'vStone = aStone;',
    },
    fragment: {
      pars: /* glsl */ `
${FACADE_GLSL}
varying vec3 vStone;
float sRough; float sGu; float sGv; float sAO;
float sBevel(float l, float L, float w) { return (1.0 - smoothstep(0.0, w, L - l)) - (1.0 - smoothstep(0.0, w, l)); }
`,
      color: /* glsl */ `
{
  float kind = floor(vStone.z + 0.5);
  float fw = max(length(fwidth(vWPos)), 1e-3);
  float fu = max(fwidth(vStone.x), 1e-4);
  float fv = max(fwidth(vStone.y), 1e-4);
  float pd = 1.0 - smoothstep(0.012, 0.07, fw);
  float pg = 1.0 - smoothstep(0.004, 0.025, fw);
  float pb = 1.0 - smoothstep(0.006, 0.03, fw);
  // stone length along the run, and the base tone
  float L = 1.5; vec3 base = vec3(0.8, 0.78, 0.73); sRough = 0.5;
  if (kind > 0.5 && kind < 1.5) { L = 1.2; base = vec3(0.2, 0.195, 0.19); sRough = 0.42; }
  else if (kind > 1.5 && kind < 2.5) { L = 1.6; base = vec3(0.76, 0.74, 0.69); sRough = 0.6; }
  else if (kind > 2.5 && kind < 4.5) { L = 1.2; base = vec3(0.84, 0.8, 0.72); sRough = 0.55; }
  else if (kind > 4.5) { L = 1.3; base = vec3(0.75, 0.73, 0.68); sRough = 0.6; }
  float u = vStone.x;
  float id = floor(u / L);
  float h = hash12(vec2(id, kind * 7.0 + floor(vWPos.x / 97.0) + floor(vWPos.z / 89.0) * 3.0));
  vec3 c = base * mix(1.0, 0.9 + 0.18 * h, 1.0 - smoothstep(0.1, 0.5, fw));
  c *= mix(1.0, 0.93 + 0.14 * vnoise(vec2(u * 2.3, vStone.y * 3.0 + vWPos.y * 2.0) + h * 17.0), pd);
  if (kind > 0.5 && kind < 1.5) c *= 1.0 + 0.3 * smoothstep(0.72, 0.9, vnoise(vWPos.xz * 37.0 + vWPos.y * 11.0)) * pg;   // granite glints
  else c *= 1.0 - 0.1 * smoothstep(0.78, 0.92, vnoise(vec2(u, vStone.y) * 23.0 + h * 5.0)) * pg;            // shell fragments
  // joints across the run
  float body = fPulse(u, L, 0.006, L - 0.006, fu);
  float j = 1.0 - body;
  // courses up the parapet and the cheek walls; the parapet's coping stone
  if (kind > 1.5 && kind < 2.5) {
    float cop = step(${f4(PLAZA_Y + 0.8)}, vWPos.y);
    float jc = 1.0 - fPulse(vWPos.y - ${f4(PLAZA_Y + 0.815)}, 10.0, 0.0, 9.988, max(fw, 1e-4));
    j = max(j * (1.0 - cop), jc);
    c = mix(c, c * 1.06, cop);
  } else if (kind > 4.5) {
    float cy = (vWPos.y - ${f4(TERRACE_Y)}) / 0.5;
    float jc = 1.0 - fPulse(cy, 1.0, 0.0, 1.0 - 0.012 / 0.5, fv / 0.5);
    float bx = u + mod(floor(cy), 2.0) * 0.65;
    j = max(1.0 - fPulse(bx, 1.3, 0.006, 1.294, fu), jc);
  }
  c = mix(c, c * 0.45, j);
  sAO = 1.0 - 0.35 * j * pd;
  // stair nosings: a honed strip with anti-slip grooves just behind each front edge
  if (kind > 2.5 && kind < 3.5) {
    float nose = pow(clamp(vStone.y / ${f4(STAIR.tread)}, 0.0, 1.0), 12.0);
    float groove = mix(fPulse(vStone.y, 0.025, 0.0, 0.008, fv), 0.32, smoothstep(0.006, 0.02, fv)) * step(${f4(STAIR.tread - 0.1)}, vStone.y);
    c = mix(c, c * 0.8, groove);
    c *= 1.0 + 0.06 * nose;
  }
  // damp foot at the water (inside of the pool coping) and at the ground
  float wet = 1.0 - smoothstep(${f4(WATER_Y)}, ${f4(WATER_Y + 0.05)}, vWPos.y);
  if (kind < 0.5) c = mix(c, c * vec3(0.55, 0.58, 0.58), wet);
  c *= mix(0.86, 1.0, smoothstep(${f4(PLAZA_Y)}, ${f4(PLAZA_Y + 0.12)}, vWPos.y) * step(${f4(PLAZA_Y - 0.5)}, vWPos.y) + step(vWPos.y, ${f4(PLAZA_Y - 0.5)}));
  // bevelled arrises either side of each joint (a tilt of the normal along the run)
  sGu = sBevel(mod(u, L) - 0.006, L - 0.012, 0.018) * 0.55 * pb;
  sGv = 0.0;
  sRough = mix(sRough, 0.9, j);
  diffuseColor.rgb = c * sAO;
}
`,
      surface: /* glsl */ `
roughnessFactor = clamp(sRough, 0.05, 1.0);
`,
      normal: /* glsl */ `
if (abs(sGu) > 1e-4) {
  // the run direction on the surface from the derivatives of u (world space), then tilt
  vec3 N = normalize(vWNrm);
  vec3 dpx = dFdx(vWPos), dpy = dFdy(vWPos);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 T = (r2 * dFdx(vStone.x) + r1 * dFdy(vStone.x)) * sign(det);
  float tl = dot(T, T);
  if (tl > 1e-12) {
    T *= inversesqrt(tl);
    vec3 nw = normalize(N + T * sGu);
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }
}
`,
      lights: /* glsl */ `
reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(mix(6.0, 0.3, uNight)));
reflectedLight.indirectDiffuse *= sAO;
`,
    },
  });
}

// ------------------------------------------------------------------------- pool water --
// Still, dark water over black granite: sky and towers in it, wind ripples (faded by the
// pixel footprint), a faint glow from lights along the coping after dark.
function waterMaterial(cuts) {
  return patchedMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.0, envMapIntensity: 1.0 }, {
    key: 'plaza-water',
    fragment: {
      pars: /* glsl */ `
${planGLSL(cuts)}
uniform vec2 uWind;
float wEdge;
`,
      color: /* glsl */ `
{
  vec2 p = vWPos.xz;
  float r = max(length(p), 1e-3);
  float a = atan(p.y, p.x);
  vec2 tAv;
  float av = abs(pAvenue(p, a, tAv));
  wEdge = max(pPool(r, a, av) - P_COPING, 0.0);          // metres from the coping's inner face
  vec3 deep = vec3(0.007, 0.024, 0.028), rim = vec3(0.018, 0.045, 0.048);
  diffuseColor.rgb = mix(rim, deep, smoothstep(0.0, 1.6, wEdge));
}
`,
      normal: /* glsl */ `
{
  float fw = max(length(fwidth(vWPos.xz)), 1e-3);
  vec2 q = vWPos.xz;
  vec2 drift = uWind * uTime;
  vec3 w1 = vnoised(q * 0.7 + drift * 0.25);
  vec3 w2 = vnoised(q * 1.9 - drift.yx * 0.4 + 7.0);
  vec3 w3 = vnoised(q * 5.3 + drift * 0.9 - 3.0);
  vec2 g = w1.yz * 0.022 * (1.0 - smoothstep(0.3, 1.2, fw)) + w2.yz * 0.012 * (1.0 - smoothstep(0.12, 0.5, fw)) + w3.yz * 0.006 * (1.0 - smoothstep(0.04, 0.16, fw));
  g *= smoothstep(0.0, 0.25, wEdge);                     // stiller in the lee of the coping
  vec3 nw = normalize(vec3(-g.x, 1.0, -g.y));
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
}
`,
      lights: /* glsl */ `
reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(mix(5.0, 0.3, uNight)));
`,
      emissive: /* glsl */ `
totalEmissiveRadiance += vec3(0.2, 0.62, 0.72) * (0.004 + 0.03 * uCityLights * (0.35 + 0.65 * (1.0 - smoothstep(0.0, 1.2, wEdge))));
`,
    },
  });
}

// ------------------------------------------------------------------------------ box --
function hedgeMaterial() {
  return patchedMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 }, {
    key: 'plaza-hedge',
    fragment: {
      color: /* glsl */ `
{
  // clipped box: leaf clusters at three scales, lighter new growth on the clipped top, darker
  // toward the foot; every scale fades to its average once it is smaller than a few pixels
  float fw = max(length(fwidth(vWPos)), 1e-3);
  float d1 = 1.0 - smoothstep(0.06, 0.25, fw), d2 = 1.0 - smoothstep(0.015, 0.06, fw);
  vec3 w = vWPos * vec3(1.0, 1.3, 1.0);
  float n1 = vnoise(w.xz * 1.3 + w.y * 2.0);
  float n2 = mix(0.5, vnoise(vec2(w.x + w.z, w.y) * 9.0 + w.xz * 6.0), d1);
  float n3 = mix(0.5, vnoise(vec2(w.x - w.z, w.y) * 31.0 + w.zx * 23.0), d2);
  vec3 dark = vec3(0.02, 0.055, 0.016), mid = vec3(0.055, 0.115, 0.03), light = vec3(0.12, 0.19, 0.05);
  vec3 c = mix(dark, mid, n1 * 0.6 + n2 * 0.4);
  float up = smoothstep(0.45, 0.9, normalize(vWNrm).y);
  c = mix(c, light, smoothstep(0.55, 0.85, n3) * 0.45 + up * 0.3);
  c *= 0.75 + 0.4 * n2 * n3 + 0.1;
  c *= mix(0.55, 1.0, smoothstep(${f4(PLAZA_Y)}, ${f4(PLAZA_Y + 0.25)}, vWPos.y));   // shade at the foot
  diffuseColor.rgb = c;
}
`,
      normal: /* glsl */ `
{
  float fw = max(length(fwidth(vWPos)), 1e-3);
  float d = 1.0 - smoothstep(0.04, 0.2, fw);
  vec3 g = vnoised(vec2(vWPos.x + vWPos.z * 0.7, vWPos.y * 1.4 + vWPos.z * 0.3) * 8.0);
  vec3 g2 = vnoised(vWPos.xz * 6.0 + vWPos.y * 3.0);
  vec3 nw = normalize(normalize(vWNrm) + vec3(g.y + g2.y * 0.6, 0.35 * g2.z, g.z + g2.z * 0.6) * 0.5 * d);
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
}
`,
    },
  });
}

// ------------------------------------------------------------------------ geometry --
/** Collects vertices (position, normal, aStone) and triangles; wound to face the normals. */
class Builder {
  constructor() { this.pos = []; this.nrm = []; this.st = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  v(x, y, z, nx, ny, nz, u = 0, w = 0, k = 0) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.st.push(u, w, k);
    return this.n - 1;
  }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  tri(a, b, c) { this.idx.push(a, b, c); }
  geometry(stone = true) {
    const P = this.pos, Nn = this.nrm, I = [];
    // wind every triangle to face its vertex normals; drop degenerate ones
    for (let t = 0; t < this.idx.length; t += 3) {
      const a = this.idx[t], b = this.idx[t + 1], c = this.idx[t + 2];
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const area = Math.hypot(cx, cy, cz);
      if (!(area > 1e-7)) continue;
      const sx = Nn[a * 3] + Nn[b * 3] + Nn[c * 3], sy = Nn[a * 3 + 1] + Nn[b * 3 + 1] + Nn[c * 3 + 1], sz = Nn[a * 3 + 2] + Nn[b * 3 + 2] + Nn[c * 3 + 2];
      if (cx * sx + cy * sy + cz * sz >= 0) I.push(a, b, c); else I.push(a, c, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    if (stone) g.setAttribute('aStone', new THREE.Float32BufferAttribute(this.st, 3));
    g.setIndex(I);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const norm2 = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

/**
 * Sweep a cross-section along a path in the xz-plane.
 *   path: [[x, z], ...] (a closed loop repeats no point); prof: [[d, y], ...], d along the
 *   path's outward side, y absolute, listed from the +d foot over the top to the -d foot (the
 *   foot is left open: it stands in the surface below). out(x, z, nx, nz) -> +1/-1 picks the
 *   outward side of the path (default: away from the loop's interior, or from the origin).
 *   smooth: shared normals across the profile (clipped hedges); else flat faces (stone).
 *   Sharp corners are mitred with separate normals either side; open paths get end caps.
 */
function sweep(B, path, closed, prof, { kind = 0, smooth = false, sharp = 0.5, u0 = 0, outward = null } = {}) {
  const n = path.length;
  if (n < 2) return;
  const E = closed ? n : n - 1;
  // edge directions and outward normals
  let area = 0;
  if (closed) for (let i = 0; i < n; i++) { const p = path[i], q = path[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
  const en = [], ed = [], el = [];
  for (let i = 0; i < E; i++) {
    const p = path[i], q = path[(i + 1) % n];
    const [tx, tz] = norm2(q[0] - p[0], q[1] - p[1]);
    let nx = tz, nz = -tx;                           // for area > 0 this points out of the loop
    if (closed) { if (area < 0) { nx = -nx; nz = -nz; } }
    else {
      const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
      const s = outward ? outward(mx, mz, nx, nz) : (nx * mx + nz * mz >= 0 ? 1 : -1);
      nx *= s; nz *= s;
    }
    ed.push([tx, tz]); en.push([nx, nz]); el.push(Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  // per vertex: mitre vector and, at sharp corners, the two edge normals
  const V = [];
  let u = u0;
  for (let i = 0; i < n; i++) {
    const eIn = closed ? (i - 1 + E) % E : i - 1, eOut = closed ? i % E : i;
    const hasIn = eIn >= 0 && (closed || i > 0), hasOut = closed || i < n - 1;
    const nIn = hasIn ? en[eIn] : en[eOut], nOut = hasOut ? en[eOut] : en[eIn];
    const [mx0, mz0] = norm2(nIn[0] + nOut[0], nIn[1] + nOut[1]);
    const cosH = Math.max(0.3, mx0 * nOut[0] + mz0 * nOut[1]);
    const miter = [mx0 / cosH, mz0 / cosH];
    const turn = Math.acos(Math.max(-1, Math.min(1, nIn[0] * nOut[0] + nIn[1] * nOut[1])));
    if (i > 0) u += el[i - 1];
    V.push({ p: path[i], miter, nIn, nOut, avg: [mx0, mz0], sharp: turn > sharp, u });
  }
  if (closed) V.push({ ...V[0], u: u + el[E - 1] });   // the loop closes on a copy of its first vertex
  // profile segments (flat) or vertices (smooth): 2D normals in (d, y)
  const m = prof.length;
  const sn = [];
  for (let j = 0; j < m - 1; j++) {
    const dd = prof[j + 1][0] - prof[j][0], dy = prof[j + 1][1] - prof[j][1];
    const l = Math.hypot(dd, dy) || 1;
    sn.push([dy / l, -dd / l]);
  }
  const pv = [0];
  for (let j = 1; j < m; j++) pv.push(pv[j - 1] + Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]));
  const vn = prof.map((_, j) => {
    if (j === 0) return sn[0];
    if (j === m - 1) return sn[m - 2];
    const [a, b] = norm2(sn[j - 1][0] + sn[j][0], sn[j - 1][1] + sn[j][1]);
    return [a, b];
  });
  // emit a ring of vertices at path vertex i with the horizontal normal hn
  const ring = (vi, hn) => {
    const { p, miter } = vi;
    const ids = [];
    if (smooth) {
      for (let j = 0; j < m; j++) {
        const [d, y] = prof[j];
        const [a, b] = vn[j];
        const nx = hn[0] * a, ny = b, nz = hn[1] * a;
        ids.push(B.v(p[0] + miter[0] * d, y, p[1] + miter[1] * d, nx, ny, nz, vi.u, pv[j], kind));
      }
    } else {
      for (let j = 0; j < m - 1; j++) {
        const [a, b] = sn[j];
        const nx = hn[0] * a, ny = b, nz = hn[1] * a;
        for (const jj of [j, j + 1]) {
          const [d, y] = prof[jj];
          ids.push(B.v(p[0] + miter[0] * d, y, p[1] + miter[1] * d, nx, ny, nz, vi.u, pv[jj], kind));
        }
      }
    }
    return ids;
  };
  const strip = (A, C) => {
    if (smooth) for (let j = 0; j < m - 1; j++) B.quad(A[j], C[j], C[j + 1], A[j + 1]);
    else for (let j = 0; j < m - 1; j++) B.quad(A[2 * j], C[2 * j], C[2 * j + 1], A[2 * j + 1]);
  };
  // walk the edges; at sharp corners start a new run with the next edge's normal
  let prev = null;
  for (let i = 0; i < E; i++) {
    const a = V[i], b = V[i + 1];
    const hnA = a.sharp || (!closed && i === 0) ? en[i] : a.avg;
    const hnB = b.sharp || (!closed && i === E - 1) ? en[i] : (closed && i === E - 1 ? V[0].avg : b.avg);
    const A = prev && !a.sharp ? prev : ring(a, hnA);
    const C = ring(b, hnB);
    strip(A, C);
    prev = C;
  }
  // end caps: the profile polygon, closed across its foot
  if (!closed) {
    const contour = prof.map(([d, y]) => new THREE.Vector2(d, y));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [vi, e, s] of [[V[0], 0, -1], [V[n - 1], E - 1, 1]]) {
      const [tx, tz] = ed[e];
      const ids = prof.map(([d, y], j) => B.v(vi.p[0] + vi.miter[0] * d, y, vi.p[1] + vi.miter[1] * d, tx * s, 0, tz * s, vi.u, pv[j], kind));
      for (const [a, b, c] of tris) B.tri(ids[a], ids[b], ids[c]);
    }
  }
}

/** Flat strip between two polylines of equal length at height y (normal up). */
function flatStrip(B, P0, P1, y, kind = 0) {
  let prev = null;
  for (let i = 0; i < P0.length; i++) {
    const a = B.v(P0[i][0], y, P0[i][1], 0, 1, 0, 0, 0, kind), b = B.v(P1[i][0], y, P1[i][1], 0, 1, 0, 0, 0, kind);
    if (prev) B.quad(prev[0], a, b, prev[1]);
    prev = [a, b];
  }
}

/** Lathe of a radial profile [[r, y], ...] listed outward/downward, flat normals per segment. */
function lathe(prof, seg) {
  const B = new Builder();
  const cs = [], sn = [];
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * TAU; cs.push([Math.cos(a), Math.sin(a)]); }
  for (let j = 0; j < prof.length - 1; j++) {
    const dr = prof[j + 1][0] - prof[j][0], dy = prof[j + 1][1] - prof[j][1];
    const l = Math.hypot(dr, dy);
    const nr = -dy / l, ny = dr / l;                  // outward / upward for a profile listed outward
    const r0 = [], r1 = [];
    for (let i = 0; i <= seg; i++) {
      const [c, s] = cs[i];
      r0.push(B.v(c * prof[j][0], prof[j][1], s * prof[j][0], c * nr, ny, s * nr));
      r1.push(B.v(c * prof[j + 1][0], prof[j + 1][1], s * prof[j + 1][0], c * nr, ny, s * nr));
    }
    for (let i = 0; i < seg; i++) B.quad(r0[i], r1[i], r1[i + 1], r0[i + 1]);
    sn.push([nr, ny]);
  }
  return B.geometry(false);
}

// ----------------------------------------------------------------- the plan in space --
// A ring piece between two end lines, each running parallel to the radius at angle `al` at
// lateral offset L (L = 0: the radius itself): start angle(r) = al0 + asin(L0 / r), end
// angle(r) = al1 - asin(L1 / r).
const pieceA = (pc, r) => [pc.al0 + offA(pc.L0, r), pc.al1 - offA(pc.L1, r)];
const insetPiece = (pc, c) => ({ r0: pc.r0 + c, r1: pc.r1 - c, al0: pc.al0, L0: pc.L0 + c, al1: pc.al1, L1: pc.L1 + c });
function arc(r, a0, a1, step = 3) {
  const k = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step));
  const out = [];
  for (let i = 0; i <= k; i++) out.push(polar(r, a0 + ((a1 - a0) * i) / k));
  return out;
}
/** Closed outline of a ring piece: outer arc, end line, inner arc back, start line. */
function pieceOutline(pc, step = 3) {
  const [s1, e1] = pieceA(pc, pc.r1), [s0, e0] = pieceA(pc, pc.r0);
  return [...arc(pc.r1, s1, e1, step), ...arc(pc.r0, e0, s0, step)];
}
/** The pieces of a ring between the avenues, less the cut spans (radians) round the roots. */
function ringPieces(r0, r1, cuts = null) {
  const out = [];
  const rm = (r0 + r1) / 2;
  for (let k = 0; k < 12; k++) {
    const a0 = avAngle(k), a1 = avAngle(k + 1);
    let spans = [{ al0: a0, L0: AV_KERB, al1: a1, L1: AV_KERB }];
    if (cuts) {
      for (let i = 0; i < ROOT_N; i++) {
        const c = cuts[i]; if (!(c[0] < c[1])) continue;
        let ra = ROOT_A0 + (i * TAU) / ROOT_N;
        while (ra < a0) ra += TAU;
        while (ra >= a0 + TAU) ra -= TAU;
        const lo = ra + c[0], hi = ra + c[1];
        const next = [];
        for (const s of spans) {
          const [sa, ea] = [s.al0 + offA(s.L0, rm), s.al1 - offA(s.L1, rm)];
          if (hi <= sa || lo >= ea) { next.push(s); continue; }
          if (lo > sa) next.push({ al0: s.al0, L0: s.L0, al1: lo, L1: 0 });
          if (hi < ea) next.push({ al0: hi, L0: 0, al1: s.al1, L1: s.L1 });
        }
        spans = next;
      }
    }
    for (const s of spans) {
      const [sa, ea] = [s.al0 + offA(s.L0, rm), s.al1 - offA(s.L1, rm)];
      if ((ea - sa) * rm < 15) continue;             // too short for a basin
      out.push({ r0, r1, ...s, k });
    }
  }
  return out;
}

/**
 * The Axis roots where they meet the pool ring: for each root, the span of angles (relative to
 * its centre line) its surface occupies between the pool ring's radii at the height of the
 * coping, read from the meshes standing in the group, widened by a margin and, where the
 * paving left toward the next avenue would be too short for a basin, run on to that avenue.
 */
function rootCuts(group) {
  const P = POOLS[1], R0 = P.c - P.h - 3, R1 = P.c + P.h + 3;
  const lo = new Array(ROOT_N).fill(Infinity), hi = new Array(ROOT_N).fill(-Infinity);
  const ys = [PLAZA_Y - 0.05, PLAZA_Y + 0.25, COPING_Y + 0.05];
  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), C = new THREE.Vector3();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh || o.userData.plaza || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const nt = idx ? idx.count / 3 : pos.count / 3;
    const M = o.matrixWorld;
    for (let t = 0; t < nt; t++) {
      const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      A.fromBufferAttribute(pos, ia).applyMatrix4(M); Bv.fromBufferAttribute(pos, ib).applyMatrix4(M); C.fromBufferAttribute(pos, ic).applyMatrix4(M);
      const ymin = Math.min(A.y, Bv.y, C.y), ymax = Math.max(A.y, Bv.y, C.y);
      if (ymax < ys[0] || ymin > ys[2]) continue;
      const rmax = Math.max(Math.hypot(A.x, A.z), Math.hypot(Bv.x, Bv.z), Math.hypot(C.x, C.z));
      if (rmax < R0 - 60 || Math.min(Math.hypot(A.x, A.z), Math.hypot(Bv.x, Bv.z), Math.hypot(C.x, C.z)) > R1 + 60) continue;
      for (const Y of ys) {
        const pts = [];
        for (const [p, q] of [[A, Bv], [Bv, C], [C, A]]) {
          if ((p.y - Y) * (q.y - Y) > 0 || p.y === q.y) continue;
          const s = (Y - p.y) / (q.y - p.y);
          pts.push([p.x + (q.x - p.x) * s, p.z + (q.z - p.z) * s]);
        }
        if (pts.length < 2) continue;
        const [p0, p1] = pts;
        const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const k = Math.max(1, Math.ceil(L / 0.5));
        for (let i = 0; i <= k; i++) {
          const x = p0[0] + ((p1[0] - p0[0]) * i) / k, z = p0[1] + ((p1[1] - p0[1]) * i) / k;
          const r = Math.hypot(x, z);
          if (r < R0 || r > R1) continue;
          const a = Math.atan2(z, x);
          const ri = Math.round((a - ROOT_A0) / (TAU / ROOT_N));
          const da = a - (ROOT_A0 + (ri * TAU) / ROOT_N);
          const id = ((ri % ROOT_N) + ROOT_N) % ROOT_N;
          lo[id] = Math.min(lo[id], da); hi[id] = Math.max(hi[id], da);
        }
      }
    }
  });
  const cuts = [];
  const rm = POOLS[1].c;
  for (let i = 0; i < ROOT_N; i++) {
    if (!(lo[i] <= hi[i])) { cuts.push([9, -9]); continue; }
    const margin = 2.5 / rm;
    let c0 = lo[i] - margin, c1 = hi[i] + margin;
    // run the cut on to the avenue when the paving left before it is too short for a basin
    const ra = ROOT_A0 + (i * TAU) / ROOT_N;
    const kLo = Math.floor(ra / (TAU / 12)), aLo = avAngle(kLo), aHi = avAngle(kLo + 1);
    const room = (x0, x1) => (x1 - x0) * rm;
    if (room(aLo + offA(AV_KERB, rm), ra + c0) < 15) c0 = aLo - ra;
    if (room(ra + c1, aHi - offA(AV_KERB, rm)) < 15) c1 = aHi - ra;
    cuts.push([c0, c1]);
  }
  return cuts;
}

// the promenade decks on the rim, and the maglev terminal beside each (on the deck's +side)
function deckSpans() {
  return ISLANDS.map((isl) => {
    const ax = promenadeAxis(isl);
    return { a: Math.atan2(ax.dir.z, ax.dir.x) };
  });
}

/** Stair half-widths at each avenue end: 9 m, less where a promenade deck or terminal is near. */
function stairWidths(decks) {
  const out = [];
  for (let k = 0; k < 12; k++) {
    const al = avAngle(k);
    let wm = STAIR.half, wp = STAIR.half;
    for (const d of decks) {
      const Ld = RIM * Math.sin(d.a - al);
      if (Math.abs(Ld) > 90 || Math.cos(d.a - al) < 0) continue;
      // deck [Ld - 14.5, Ld + 14.5], terminal [Ld + 12.8, Ld + 46.8]: keep 1 m clear of both
      for (const [x0, x1] of [[Ld - DECK_HALF, Ld + DECK_HALF], [Ld + 12.8, Ld + 46.8]]) {
        if (x0 > 0) wp = Math.min(wp, x0 - 1.0 - STAIR.cheek);
        else if (x1 < 0) wm = Math.min(wm, -x1 - 1.0 - STAIR.cheek);
        else { wp = -1; wm = -1; }
      }
    }
    out.push({ k, al, wm, wp, ok: wm >= 4 && wp >= 4 });
  }
  return out;
}

/** The twenty steps from the rim down to the terrace at one avenue end, between cheek walls. */
function stair(B, st) {
  const { al, wm, wp } = st;
  const ex = Math.cos(al), ez = Math.sin(al), tx = -Math.sin(al), tz = Math.cos(al);
  const at = (r, L) => { const rho = Math.sqrt(r * r - L * L); return [ex * rho + tx * L, ez * rho + tz * L]; };
  const { n, rise, tread } = STAIR;
  const NL = 6;
  const Ls = [];
  for (let j = 0; j <= NL; j++) Ls.push(-(wm + 0.02) + ((wm + wp + 0.04) * j) / NL);
  // treads 1..n-1 (the last riser lands on the terrace itself)
  for (let i = 1; i < n; i++) {
    const rb = RIM + (i - 1) * tread - (i === 1 ? 0.05 : 0), rf = RIM + i * tread, y = PLAZA_Y - i * rise;
    let prev = null;
    for (const L of Ls) {
      const [bx, bz] = at(rb, L), [fx, fz] = at(rf, L);
      const a = B.v(bx, y, bz, 0, 1, 0, L, rb - (RIM + (i - 1) * tread), 3), b = B.v(fx, y, fz, 0, 1, 0, L, tread, 3);
      if (prev) B.quad(prev[0], a, b, prev[1]);
      prev = [a, b];
    }
  }
  // risers 2..n
  for (let i = 2; i <= n; i++) {
    const r = RIM + (i - 1) * tread, y0 = PLAZA_Y - (i - 1) * rise, y1 = PLAZA_Y - i * rise - (i === n ? 0.05 : 0);
    let prev = null;
    for (const L of Ls) {
      const [x, z] = at(r, L);
      const [nx, nz] = norm2(x, z);
      const a = B.v(x, y0, z, nx, 0, nz, L, 0, 4), b = B.v(x, y1, z, nx, 0, nz, L, y0 - y1, 4);
      if (prev) B.quad(prev[0], a, b, prev[1]);
      prev = [a, b];
    }
  }
  // cheek walls: a sloping balustrade wall either side, parallel to the avenue axis
  const run = (n - 1) * tread;                     // nosing of the top tread to the last riser
  for (const [L0, L1] of [[wp, wp + STAIR.cheek], [-wm, -wm - STAIR.cheek]]) {
    const rho = (r) => Math.sqrt(r * r - L0 * L0);
    const poly = [
      [rho(RIM - 0.5), PLAZA_Y - 0.1], [rho(RIM) - 0.05, PLAZA_Y - 0.1], [rho(RIM) - 0.05, TERRACE_Y - 0.05],
      [rho(RIM + run + 0.86), TERRACE_Y - 0.05], [rho(RIM + run + 0.86), PARAPET_TOP - n * rise + rise],
      [rho(RIM + run), PARAPET_TOP - n * rise + rise], [rho(RIM), PARAPET_TOP], [rho(RIM - 0.5), PARAPET_TOP],
    ];
    const P3 = (q, L) => [ex * q[0] + tx * L, q[1], ez * q[0] + tz * L];
    const sgn = Math.sign(L1 - L0);                // +: the far face looks along +t
    // the two faces
    const contour = poly.map(([x, y]) => new THREE.Vector2(x, y));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [L, s] of [[L0, -sgn], [L1, sgn]]) {
      const ids = poly.map((q) => { const [x, y, z] = P3(q, L); return B.v(x, y, z, tx * s, 0, tz * s, q[0], q[1], 5); });
      for (const [a, b, c] of tris) B.tri(ids[a], ids[b], ids[c]);
    }
    // round the edge of the polygon (CCW in rho-y: outward normal = (dy, -drho))
    for (let i = 0; i < poly.length; i++) {
      const q0 = poly[i], q1 = poly[(i + 1) % poly.length];
      const [nr, ny] = norm2(q1[1] - q0[1], -(q1[0] - q0[0]));
      const nx = ex * nr, nz = ez * nr;
      const ids = [];
      for (const [q, L] of [[q0, L0], [q1, L0], [q1, L1], [q0, L1]]) {
        const [x, y, z] = P3(q, L);
        ids.push(B.v(x, y, z, nx, ny, nz, q[0] + q[1], L, 5));
      }
      B.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }
}

/** Merge angular intervals on the circle; return the complement as [a0, a1] runs. */
function freeRuns(gaps) {
  const norm = (a) => ((a % TAU) + TAU) % TAU;
  const iv = [];
  for (const [g0, g1] of gaps) {
    const a = norm(g0), b = a + (g1 - g0);
    if (b > TAU) { iv.push([a, TAU]); iv.push([0, b - TAU]); } else iv.push([a, b]);
  }
  iv.sort((p, q) => p[0] - q[0]);
  const merged = [];
  for (const g of iv) {
    if (merged.length && g[0] <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], g[1]);
    else merged.push([...g]);
  }
  if (!merged.length) return [[0, TAU]];
  const runs = [];
  for (let i = 0; i < merged.length; i++) {
    const a0 = merged[i][1], a1 = i + 1 < merged.length ? merged[i + 1][0] : merged[0][0] + TAU;
    if (a1 - a0 > 1e-4) runs.push([a0, a1]);
  }
  return runs;
}

// --------------------------------------------------------------------------- build --
export function buildPlaza(group) {
  const cuts = rootCuts(group);
  const mark = (o) => { o.userData.plaza = true; return o; };

  // the stone disc and its rim wall, then the terrace (its own draw so it can be offset in
  // depth: it lies only 20 cm above the island's berm, which would show through from afar)
  const plazaMat = plazaMaterial(cuts);
  const disc = lathe([
    [0.1, PLAZA_Y], [RIM - 0.1, PLAZA_Y], [RIM, PLAZA_Y - 0.05], [RIM, PLAZA_Y - 2.95], [RIM + 0.22, PLAZA_Y - 3.1], [RIM + 0.22, TERRACE_Y],
  ], 512);
  const plaza = mark(new THREE.Mesh(disc, plazaMat));
  plaza.name = 'Axis plaza';
  plaza.receiveShadow = true;
  group.add(plaza);
  const terraceMat = plazaMaterial(cuts);
  terraceMat.polygonOffset = true;
  terraceMat.polygonOffsetFactor = 0;
  terraceMat.polygonOffsetUnits = -2;
  const terrace = mark(new THREE.Mesh(lathe([
    [RIM + 0.22, TERRACE_Y], [TERRACE_R, TERRACE_Y], [TERRACE_R + 0.6, TERRACE_Y - 0.7], [TERRACE_R + 1, -6],
  ], 512), terraceMat));
  terrace.name = 'Axis plaza terrace';
  terrace.receiveShadow = true;
  group.add(terrace);

  const stoneMat = stoneMaterial();
  // ---- the rim: stairs at the avenue ends, the parapet between them (clear of the decks)
  {
    const B = new Builder();
    const decks = deckSpans();
    const stairs = stairWidths(decks);
    const gaps = [];
    for (const st of stairs) {
      if (!st.ok) continue;
      stair(B, st);
      gaps.push([st.al - offA(st.wm + STAIR.cheek - 0.02, RIM), st.al + offA(st.wp + STAIR.cheek - 0.02, RIM)]);
    }
    for (const d of decks) gaps.push([d.a - offA(DECK_HALF + 2.5, RIM), d.a + offA(50, RIM)]);
    const prof = [
      [0.06, PLAZA_Y - 0.1], [0.06, PLAZA_Y + 0.82], [0.12, PLAZA_Y + 0.82], [0.12, PLAZA_Y + 0.91], [0.08, PARAPET_TOP],
      [-0.42, PARAPET_TOP], [-0.46, PLAZA_Y + 0.91], [-0.46, PLAZA_Y + 0.82], [-0.4, PLAZA_Y + 0.82], [-0.4, PLAZA_Y - 0.1],
    ];
    for (const [a0, a1] of freeRuns(gaps)) sweep(B, arc(RIM, a0, a1, 2.5), false, prof, { kind: 2, u0: a0 * RIM });
    const m = mark(new THREE.Mesh(B.geometry(), stoneMat));
    m.name = 'Axis plaza rim';
    m.castShadow = true; m.receiveShadow = true;
    m.layers.set(1);
    group.add(m);
  }

  // ---- the near set: pool copings and water, parterre kerbs (the paint carries them far off)
  {
    const S = new Builder(), Wt = new Builder();
    const coping = [
      [0, PLAZA_Y - 0.05], [0, PLAZA_Y + 0.37], [-0.03, PLAZA_Y + 0.43], [-0.07, COPING_Y], [-0.63, COPING_Y],
      [-0.67, PLAZA_Y + 0.43], [-0.7, PLAZA_Y + 0.38], [-0.7, WATER_Y - 0.06],
    ];
    for (const P of POOLS) {
      for (const pc of ringPieces(P.c - P.h, P.c + P.h, P.roots ? cuts : null)) {
        sweep(S, pieceOutline(pc), true, coping, { kind: 0 });
        const w = insetPiece(pc, COPING - 0.01);
        const [s1, e1] = pieceA(w, w.r1), [s0, e0] = pieceA(w, w.r0);
        const k = Math.max(2, Math.ceil(((e1 - s1) * w.r1) / 3));
        const o = [], i = [];
        for (let q = 0; q <= k; q++) { o.push(polar(w.r1, s1 + ((e1 - s1) * q) / k)); i.push(polar(w.r0, s0 + ((e0 - s0) * q) / k)); }
        flatStrip(Wt, i, o, WATER_Y);
      }
    }
    const kerb = [[0, PLAZA_Y - 0.05], [0, PLAZA_Y + 0.26], [-0.03, PLAZA_Y + 0.3], [-0.27, PLAZA_Y + 0.3], [-0.3, PLAZA_Y + 0.26], [-0.3, PLAZA_Y - 0.05]];
    for (const g of GARDENS) for (const pc of ringPieces(g.c - g.h, g.c + g.h)) sweep(S, pieceOutline(pc), true, kerb, { kind: 1 });
    const near = new THREE.Group();
    const sm = mark(new THREE.Mesh(S.geometry(), stoneMat));
    sm.name = 'Axis plaza copings';
    sm.castShadow = true; sm.receiveShadow = true;
    const wm = mark(new THREE.Mesh(Wt.geometry(false), waterMaterial(cuts)));
    wm.name = 'Axis plaza pools';
    wm.receiveShadow = true;
    for (const o of [sm, wm]) { o.layers.set(1); near.add(o); }
    const lod = mark(new THREE.LOD());
    lod.name = 'Axis plaza near';
    lod.addLevel(near, 0, 0.05);
    lod.addLevel(new THREE.Object3D(), NEAR_LOD, 0.05);
    lod.layers.set(1);
    group.add(lod);
  }

  // ---- box: border hedges, walk edgings, the knot bands and their closing hedges, one draw per
  //      parterre piece that shows only near the camera
  {
    const hedgeMat = hedgeMaterial();
    const prof = (w, h) => [[w, PLAZA_Y - 0.05], [w, PLAZA_Y + h - 0.07], [w - 0.07, PLAZA_Y + h], [-w + 0.07, PLAZA_Y + h], [-w, PLAZA_Y + h - 0.07], [-w, PLAZA_Y - 0.05]];
    const tall = prof(0.275, 0.55), low = prof(0.15, 0.3);
    for (const g of GARDENS) {
      for (const pc of ringPieces(g.c - g.h, g.c + g.h)) {
        const B = new Builder();
        // the border, inside the kerb
        sweep(B, pieceOutline(insetPiece(pc, 0.575)), true, tall, { smooth: true });
        // the angular limits of the inner hedges: buried 15 cm in the border
        const Lh = AV_KERB + G_BORDER - 0.15;
        const lim = (r) => [pc.al0 + offA(Lh, r), pc.al1 - offA(Lh, r)];
        const along = (lr) => { const r = g.c + lr; const [a0, a1] = lim(r); return arc(r, a0, a1, 3); };
        const lrA = g.trees.map((t) => t - g.c);               // the allees, - side and + side
        const bands = [];
        for (const [sgn, t] of [[-1, lrA[0]], [1, lrA[1]]]) {
          sweep(B, along(sgn * (G_WALK + G_CLOSE / 2)), false, low, { smooth: true });              // walk edging
          const b1 = Math.abs(t) - G_ALLEE - G_CLOSE;
          sweep(B, along(sgn * (b1 + G_CLOSE / 2)), false, low, { smooth: true });                  // closing hedge
          bands.push({ sgn, W: b1 - G_EDGE });
        }
        // the knots: two families of diagonals at 45 degrees in (arc, radius) about the piece's
        // centre line, ends buried in the edging and the closing hedge
        const amid = avAngle(pc.k) + TAU / 24;
        for (const { sgn, W } of bands) {
          const world = (u, v) => { const r = g.c + sgn * (G_EDGE + v); return [r, amid + u / g.c]; };
          const inside = (u, v) => { const [r, a] = world(u, v); const [a0, a1] = lim(r); return a >= a0 && a <= a1; };
          const uMax = (TAU / 24) * g.c + W;
          for (const fam of [-1, 1]) {
            for (let mm = Math.floor(-uMax / W) - 1; mm <= Math.ceil(uMax / W) + 1; mm++) {
              // v from -0.15 to W + 0.15 along u = mm W + fam v
              const v0 = -G_CLOSE / 2, v1 = W + G_CLOSE / 2;
              const N = 6, samples = [];
              for (let q = 0; q <= N; q++) { const v = v0 + ((v1 - v0) * q) / N; samples.push([mm * W + fam * v, v]); }
              const ins = samples.map(([u, v]) => inside(u, v));
              if (!ins.some(Boolean)) continue;
              // clip at the ends by bisection
              const seg = [];
              for (let q = 0; q <= N; q++) {
                if (ins[q]) {
                  if (q > 0 && !ins[q - 1]) seg.push(bisect(samples[q - 1], samples[q], inside));
                  seg.push(samples[q]);
                  if (q < N && !ins[q + 1]) seg.push(bisect(samples[q + 1], samples[q], inside));
                }
              }
              if (seg.length < 2) continue;
              const pts = seg.map(([u, v]) => { const [r, a] = world(u, v); return polar(r, a); });
              let len = 0; for (let q = 1; q < pts.length; q++) len += Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]);
              if (len < 0.4) continue;
              sweep(B, pts, false, low, { smooth: true });
            }
          }
        }
        const geo = B.geometry(false);
        const cx = geo.boundingSphere.center;
        const m = mark(new THREE.Mesh(geo, hedgeMat));
        m.name = 'Axis plaza box';
        m.castShadow = true; m.receiveShadow = true;
        m.layers.set(1);
        m.position.set(-cx.x, -cx.y, -cx.z);
        const lod = mark(new THREE.LOD());
        lod.position.copy(cx);
        lod.addLevel(m, 0, 0.05);
        lod.addLevel(new THREE.Object3D(), HEDGE_LOD, 0.05);
        lod.layers.set(1);
        group.add(lod);
      }
    }
  }
  return { cuts };
}

// point on the segment p (outside) -> q (inside) where `inside` changes, to ~1 cm
function bisect(p, q, inside) {
  let a = p, b = q;
  for (let i = 0; i < 20; i++) {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (inside(m[0], m[1])) b = m; else a = m;
  }
  return b;
}
