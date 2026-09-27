import * as THREE from 'three';
import { latheFacade, sweepTube, mergeClean } from './geom.js';
import { createFacadeMaterial } from './facade.js';
import { patchedMaterial, aerialShaderMaterial, FACADE_GLSL } from './materials.js';
import { PLAZA_Y, PLAZA_R } from './layout.js';
import { U } from '../core/uniforms.js';

const TAU = Math.PI * 2;

// Hyperboloid lattice parameters (straight rulings between two circles)
export const AXIS = {
  latticeBase: 330, latticeTop: 132, latticeY0: 560, latticeY1: 2820, twist: THREE.MathUtils.degToRad(104),
  coreBase: 74, coreTop: 46, crownY: 3060, anchorY: 3140, height: 3200,
};

/** Radius of the hyperboloid lattice at height y. */
export function latticeRadius(y) {
  const { latticeBase: rb, latticeTop: rt, latticeY0: y0, latticeY1: y1, twist } = AXIS;
  const v = THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1);
  const ax = rb + (Math.cos(twist) * rt - rb) * v, az = Math.sin(twist) * rt * v;
  return Math.hypot(ax, az);
}

export function coreRadius(y) {
  const v = THREE.MathUtils.clamp(y / AXIS.crownY, 0, 1);
  return AXIS.coreBase + (AXIS.coreTop - AXIS.coreBase) * Math.pow(v, 0.8);
}

// Plaza of the Axis: pale limestone laid in concentric courses, dark granite bands with bronze
// inlays every 24 m, twelve travertine avenues each with a water rill, two reflecting pools with
// stone coping, two parterre gardens of clipped box, a compass rose round the core and the bronze
// prime meridian itself running north-south across the whole plaza. Everything is laid out in
// the plaza's polar frame and filtered by the pixel footprint (far = the near pattern averaged).
function plazaMaterial() {
  const Y = PLAZA_Y.toFixed(1);
  return patchedMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.8 }, {
    key: 'plaza2',
    fragment: {
      pars: /* glsl */ `
${FACADE_GLSL}
float pPool; float pSeam; float pGarden; float pRough; float pMetal; float pAO; vec2 pHg; float pTop; vec3 pEmit;
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
  pTop = step(0.5, vWNrm.y) * step(${Y} - 0.5, vWPos.y);
  pHg = vec2(0.0); pEmit = vec3(0.0); pAO = 1.0; pRough = 0.55; pMetal = 0.0; pSeam = 0.0; pPool = 0.0; pGarden = 0.0;
  vec3 c;
  if (pTop > 0.5) {
    // ---- twelve avenues: signed metres across the nearest one
    float sa = (fract(a / TAU * 12.0 + 0.5) - 0.5) * r * TAU / 12.0;
    float av = abs(sa);
    float avenue = 1.0 - smoothstep(9.0 - fw, 9.0 + fw, av);
    float kerbA = (1.0 - smoothstep(9.8 - fw, 9.8 + fw, av)) - avenue;          // granite kerb line 9.0 .. 9.8
    // ---- field: limestone in concentric courses, slabs ~1.8 m along the arc
    float ring = floor(r / 1.2);
    float nS = max(floor(TAU * (ring + 0.5) * 1.2 / 1.8), 3.0);
    float s = (a / TAU + 0.5) * nS + hash11(ring * 1.7);
    float sw = nS / (TAU * r);                                  // slabs per metre along the arc
    float jR = 1.0 - fPulse(r, 1.2, 0.01, 1.2, fw);
    float jT = 1.0 - fPulse(s, 1.0, 0.01 * sw, 1.0, fw * sw);
    float sid = hash12(vec2(floor(s), ring) + 3.0);
    vec3 lime = vec3(0.77, 0.75, 0.70);
    vec3 fieldC = lime * mix(1.0, 0.9 + 0.18 * sid, pt) * (1.0 + vec3(0.02, 0.0, -0.03) * (fract(sid * 9.1) - 0.5) * pt);
    fieldC *= mix(1.0, 0.93 + 0.14 * vnoise(p * 3.0 + sid * 17.0), pd);
    fieldC *= 1.0 - 0.1 * smoothstep(0.8, 0.93, vnoise(p * 23.0 + sid * 5.0)) * pg;          // shell fragments
    float jF = max(jR, jT);
    fieldC = mix(fieldC, vec3(0.42, 0.4, 0.37), jF);
    pHg -= (er * pBevel(mod(r, 1.2) - 0.01, 1.19, 0.012) + et * pBevel(fract(s) / sw - 0.01, 1.0 / sw - 0.01, 0.012)) * 0.35 * (1.0 - smoothstep(0.006, 0.024, fw));
    pHg += (hash22(vec2(sid * 71.0, ring)) - 0.5) * 0.02 * pd;
    pAO *= 1.0 - 0.3 * jF * pd;
    c = fieldC;
    // ---- dark granite rings every 24 m with bronze inlay at both edges
    float dB = abs(mod(r, 24.0) - 12.0);
    float band = 1.0 - smoothstep(0.6 - fw, 0.6 + fw, dB);
    float bronzeB = (1.0 - smoothstep(0.025 - fw, 0.025 + fw, abs(dB - 0.62))) * (1.0 - avenue);
    vec3 granite = vec3(0.19, 0.185, 0.18) * (0.9 + 0.2 * mix(0.5, vnoise(p * 9.0), pd));
    granite *= 1.0 + 0.25 * smoothstep(0.7, 0.9, vnoise(p * 40.0)) * pg;                     // feldspar glints
    c = mix(c, granite, band * (1.0 - avenue));
    pRough = mix(pRough, 0.22, band * (1.0 - avenue));
    // ---- avenues: travertine laid along the avenue, a water rill down the middle
    if (avenue + kerbA > 0.0) {
      float arow = floor(r / 1.6);
      float ax = sa + mod(arow, 2.0) * 0.4;
      float aid = hash12(vec2(floor(ax / 0.8), arow) + 9.0);
      float jA = max(1.0 - fPulse(r, 1.6, 0.01, 1.6, fw), 1.0 - fPulse(ax, 0.8, 0.01, 0.8, fw));
      vec3 trav = vec3(0.86, 0.82, 0.74) * mix(1.0, 0.9 + 0.16 * aid, pt);
      trav *= 1.0 - 0.22 * smoothstep(0.72, 0.9, vnoise(vec2(r * 1.5, sa * 12.0) + aid * 11.0)) * pd;   // travertine pores
      trav = mix(trav, vec3(0.5, 0.47, 0.42), jA);
      pHg -= (er * pBevel(mod(r, 1.6) - 0.01, 1.59, 0.012) + et * pBevel(mod(ax, 0.8) - 0.01, 0.79, 0.012)) * 0.35 * (1.0 - smoothstep(0.006, 0.024, fw)) * avenue;
      float rill = 1.0 - smoothstep(0.3 - fw, 0.3 + fw, av);
      float rillEdge = (1.0 - smoothstep(0.4 - fw, 0.4 + fw, av)) - rill;
      vec3 water = vec3(0.012, 0.04, 0.045);
      vec3 avC = mix(trav, water, rill);
      avC = mix(avC, vec3(0.5, 0.36, 0.2), rillEdge);
      c = mix(c, avC, avenue);
      c = mix(c, granite * 1.3, kerbA);
      pRough = mix(pRough, 0.5, avenue);
      pRough = mix(pRough, 0.03, rill * avenue);
      pRough = mix(pRough, 0.3, rillEdge * avenue);
      pMetal = mix(pMetal, 0.9, rillEdge * avenue);
      pHg += vnoised(vec2(r * 2.0 - uTime * 1.2, sa * 9.0)).yz * 0.04 * rill * avenue * pd;
      pHg += et * sign(sa) * (1.0 - smoothstep(9.0, 9.15, av)) * kerbA * 0.8 * pd;
      pSeam += rillEdge * avenue * 0.6;
      pEmit += vec3(0.25, 0.7, 0.8) * rill * avenue * 0.025;
    }
    // ---- reflecting pools with stone coping (the avenues cross them as causeways)
    float dRing = max(16.0 - abs(r - 318.0), 9.0 - abs(r - 470.0));
    float dPool = min(dRing, av - 9.8);
    float inPool = smoothstep(-fw, fw, dPool);
    float coping = inPool * (1.0 - smoothstep(0.7 - fw, 0.7 + fw, dPool));
    float waterM = inPool - coping;
    if (inPool > 0.0) {
      vec3 cop = vec3(0.8, 0.78, 0.73) * (0.95 + 0.1 * mix(0.5, vnoise(p * 4.0), pd));
      vec3 wat = vec3(0.012, 0.038, 0.045);
      c = mix(c, cop, coping);
      c = mix(c, wat, waterM);
      pRough = mix(pRough, 0.5, coping);
      pRough = mix(pRough, 0.02, waterM);
      pMetal *= 1.0 - inPool;
      // coping rounded toward the water; wind ripples on the water
      vec2 dn = dRing < av - 9.8 ? er * sign(r - (abs(r - 318.0) < 40.0 ? 318.0 : 470.0)) : et * sign(sa);
      pHg -= dn * (1.0 - smoothstep(0.45, 0.7, dPool)) * coping * 0.6 * pd;
      pAO = mix(pAO, 1.0, waterM);                  // the paving's joints stop at the water
      pHg *= 1.0 - waterM;
      vec3 w1 = vnoised(p * 0.9 + vec2(uTime * 0.35, uTime * 0.2));
      vec3 w2 = vnoised(p * 2.3 - vec2(uTime * 0.5, -uTime * 0.3));
      pHg += (w1.yz * 0.02 + w2.yz * 0.012) * waterM;
      pPool = waterM;
      pEmit += vec3(0.2, 0.62, 0.72) * waterM * 0.012;
    }
    // ---- parterre gardens: clipped box hedges in a woven knot, beds of flowers and lawn, gravel walk
    float gc = abs(r - 395.0) < 60.0 ? 395.0 : 235.0;
    float gh = gc > 300.0 ? 26.0 : 22.0;
    float dGar = min(gh - abs(r - gc), av - 9.8);
    float garden = smoothstep(-fw, fw, dGar);
    if (garden > 0.0) {
      float gd = 1.0 - smoothstep(0.1, 0.5, fw);
      float lr = r - gc;
      float knot1 = abs(lr - (gh - 5.0) * 0.55 * sin(a * 48.0));
      float knot2 = abs(lr + (gh - 5.0) * 0.55 * sin(a * 48.0));
      float radial = abs(fract(a / TAU * 96.0 + 0.5) - 0.5) * r * TAU / 96.0;
      float hedgeD = min(min(knot1, knot2), min(radial, abs(dGar - 0.6)));
      float hedge = 1.0 - smoothstep(0.32 - fw, 0.32 + fw, hedgeD);
      float walk = (1.0 - smoothstep(1.6 - fw, 1.6 + fw, abs(lr))) * (1.0 - hedge);
      float bedId = hash12(vec2(floor(a / TAU * 96.0), sign(lr) + step(knot1, knot2) * 2.0));
      vec3 bloom = plazaFlower(fract(bedId * 7.31)) * 0.75 * (0.8 + 0.4 * mix(0.5, vnoise(p * 5.0), gd));
      vec3 lawnG = vec3(0.1, 0.2, 0.05) * (0.85 + 0.3 * mix(0.5, vnoise(p * 2.0), gd));
      vec3 bed = mix(lawnG, mix(vec3(0.05, 0.1, 0.03), bloom, mix(0.4, smoothstep(0.4, 0.62, vnoise(p * 6.0 + bedId * 30.0)), gd)), step(0.62, bedId));
      vec3 boxC = vec3(0.03, 0.085, 0.022) * (0.8 + 0.4 * mix(0.5, vnoise(p * 7.0), gd));
      vec3 gravel = vec3(0.66, 0.6, 0.5) * (0.9 + 0.2 * mix(0.5, vnoise(p * 13.0), pd));
      vec3 gC = mix(mix(bed, boxC, hedge), gravel, walk);
      if (gd > 0.0) { pHg += vnoised(p * 5.0).yz * 0.18 * gd * hedge; pAO *= mix(1.0, 0.75, gd * hedge * (1.0 - smoothstep(0.1, 0.32, hedgeD))); }
      c = mix(c, gC, garden);
      pRough = mix(pRough, mix(0.9, 0.8, walk), garden);
      pMetal *= 1.0 - garden;
      pGarden = garden;
    }
    // ---- compass rose round the core: sixteen points of dark and pale granite
    if (r > 80.0 && r < 160.0) {
      float k = a / TAU * 16.0;
      float kf = fract(k + 0.5) - 0.5;
      float card = step(0.5, fract(floor(k + 0.5) * 0.5));                  // alternate long / short points
      float len = mix(48.0, 72.0, 1.0 - card);
      float tri = 1.0 - abs(kf) * 2.0;
      float pr = (r - 84.0) / len;
      float inPt = (1.0 - smoothstep(tri - fw / len, tri + fw / len, pr)) * step(0.0, pr);
      float half1 = step(0.0, kf);
      vec3 rose = mix(vec3(0.2, 0.19, 0.19), vec3(0.88, 0.86, 0.8), half1);
      float edge = (1.0 - smoothstep(0.04 - fw, 0.04 + fw, abs(kf) * r * TAU / 16.0)) * inPt;
      rose = mix(rose, vec3(0.5, 0.36, 0.2), edge);
      c = mix(c, rose, inPt * (1.0 - avenue));
      pRough = mix(pRough, 0.25, inPt * (1.0 - avenue));
      pSeam += edge * 0.8;
      float hub = (1.0 - smoothstep(0.08 - fw, 0.08 + fw, abs(r - 84.0))) + (1.0 - smoothstep(0.08 - fw, 0.08 + fw, abs(r - 160.0 + 2.0)));
      c = mix(c, vec3(0.5, 0.36, 0.2), hub);
      pMetal = mix(pMetal, 0.9, max(edge, hub));
      pSeam += hub;
    }
    // ---- the prime meridian: a bronze strip north-south across the plaza, ticked every metre
    float mer = (1.0 - smoothstep(0.12 - fw, 0.12 + fw, abs(p.x))) * (1.0 - waterM);
    float tick = (1.0 - smoothstep(0.012 - fw, 0.012 + fw, abs(fract(p.y + 0.5) - 0.5))) * (1.0 - smoothstep(0.35 - fw, 0.35 + fw, abs(p.x)));
    float tick10 = (1.0 - smoothstep(0.025 - fw, 0.025 + fw, abs(fract(p.y / 10.0 + 0.5) - 0.5) * 10.0)) * (1.0 - smoothstep(0.7 - fw, 0.7 + fw, abs(p.x)));
    float merM = max(mer, max(tick, tick10) * (1.0 - waterM) * pd);
    c = mix(c, vec3(0.62, 0.44, 0.24), merM);
    pRough = mix(pRough, 0.28, merM);
    pMetal = mix(pMetal, 0.95, merM);
    pSeam += bronzeB * 1.2 * (1.0 - inPool) + mer * 1.5;          // only the bronze lines glow
    c = mix(c, vec3(0.6, 0.43, 0.24), bronzeB);
    pMetal = mix(pMetal, 0.9, bronzeB);
    pRough = mix(pRough, 0.3, bronzeB);
  } else if (vWNrm.y > 0.5) {
    // the planted terrace below the plaza rim
    vec3 grass = mix(vec3(0.08, 0.17, 0.04), vec3(0.16, 0.26, 0.07), vnoise(p * 0.2));
    grass *= 0.85 + 0.3 * mix(0.5, vnoise(p * 2.3), 1.0 - smoothstep(0.1, 0.5, fw));
    c = grass;
    pRough = 0.9;
  } else {
    // rim and retaining walls: coursed ashlar
    vec2 q = vec2(a * r, vWPos.y);
    float course = floor(q.y / 0.6);
    float bx = q.x + mod(course, 2.0) * 0.6;
    float bid = hash12(vec2(floor(bx / 1.2), course));
    float j = max(1.0 - fPulse(q.y, 0.6, 0.012, 0.6, fw), 1.0 - fPulse(bx, 1.2, 0.012, 1.2, fw));
    c = vec3(0.74, 0.72, 0.67) * mix(1.0, 0.88 + 0.2 * bid, pt) * (1.0 - 0.35 * j);
    c *= mix(vec3(0.82, 0.8, 0.74), vec3(1.0), smoothstep(${Y} - 5.0, ${Y} - 3.0, vWPos.y));   // damp base
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
if (pTop > 0.5) {
  vec3 nw = normalize(vec3(-pHg.x, 1.0, -pHg.y));
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
    onShader: (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n#define TAU 6.28318530718'); },
  });
}

// Additive glow shell (tether halo, crown aura)
function glowMaterial(color, strength, { fresnelPow = 2.0, nightOnly = 0.7 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uCityLights: U.uCityLights, uTime: U.uTime, uNightOnly: { value: nightOnly }, uPow: { value: fresnelPow } },
    vertexShader: /* glsl */ `
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  vY = w.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor; uniform float uStrength; uniform float uCityLights; uniform float uTime; uniform float uNightOnly; uniform float uPow;
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  float f = pow(abs(dot(normalize(vN), normalize(vV))), uPow);
  float pulse = 0.85 + 0.15 * sin(vY * 0.004 - uTime * 1.5);
  float k = mix(1.0, uCityLights, uNightOnly);
  gl_FragColor = vec4(uColor * f * uStrength * k * pulse, 1.0);
}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}

export function buildAxis(scene, updaters) {
  const group = new THREE.Group();
  group.name = 'The Axis';
  scene.add(group);

  // ---------------------------------------------------------- plaza --------
  const plazaProfile = [
    { r: 0.1, y: PLAZA_Y }, { r: PLAZA_R, y: PLAZA_Y }, { r: PLAZA_R + 0.5, y: PLAZA_Y - 0.6 },
    { r: PLAZA_R + 2, y: PLAZA_Y - 3.5 }, { r: PLAZA_R + 44, y: PLAZA_Y - 3.5 },
    // one planted terrace, then a clean retaining wall down into the ground: the ring town
    // around it is built on the island itself (the old lower terraces surfaced wherever the
    // ground falls away to the east beach)
    { r: PLAZA_R + 44.6, y: PLAZA_Y - 4.2 }, { r: PLAZA_R + 45, y: -6 },
  ].reverse();
  const plazaGeo = latheFacade(plazaProfile, 256);
  const plaza = new THREE.Mesh(plazaGeo, plazaMaterial());
  plaza.receiveShadow = true;
  plaza.castShadow = false;
  group.add(plaza);

  // ------------------------------------------------ structure material ------
  const boneMat = createFacadeMaterial('pearl', 101, { litFrac: 0.6 });
  const coreMat = createFacadeMaterial('silver', 102, { litFrac: 0.7, band: 128 });
  const parts = [];

  // --------------------------------------------------------- root arches ----
  const legs = 8;
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * TAU + TAU / 16;
    const pts = [];
    const topR = latticeRadius(AXIS.latticeY0) * 0.98;
    for (let k = 0; k <= 40; k++) {
      const u = k / 40;
      // outward-bowing root: starts wide on the plaza, sweeps up and in to the lattice base
      const r = THREE.MathUtils.lerp(505, topR, Math.pow(u, 0.8)) + 120 * Math.sin(Math.PI * u) * (1 - u);
      const y = PLAZA_Y - 4 + (AXIS.latticeY0 + 20 - PLAZA_Y) * (1 - Math.pow(1 - u, 1.7));
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    parts.push(sweepTube(pts, (u) => 36 - 16 * u + 12 * Math.exp(-u * 14), 20, { kind: 1, ellipse: 0.72 }));
    // secondary tendrils
    for (const off of [-0.09, 0.09]) {
      const p2 = [];
      for (let k = 0; k <= 30; k++) {
        const u = k / 30;
        const aa = a + off * (1 - u);
        const r = THREE.MathUtils.lerp(535, topR * 1.02, Math.pow(u, 0.9)) + 60 * Math.sin(Math.PI * u) * (1 - u);
        const y = PLAZA_Y - 2 + (AXIS.latticeY0 * 0.7 - PLAZA_Y) * (1 - Math.pow(1 - u, 2.0));
        p2.push(new THREE.Vector3(Math.cos(aa) * r, y, Math.sin(aa) * r));
      }
      parts.push(sweepTube(p2, (u) => 9 - 4 * u, 10, { kind: 1 }));
    }
  }

  // ------------------------------------------------------ lattice struts ----
  const N = 52;
  const { latticeBase: rb, latticeTop: rt, latticeY0: y0, latticeY1: y1, twist } = AXIS;
  for (let fam = -1; fam <= 1; fam += 2) {
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU;
      const a1 = a0 + fam * twist;
      const p0 = new THREE.Vector3(Math.cos(a0) * rb, y0, Math.sin(a0) * rb);
      const p1 = new THREE.Vector3(Math.cos(a1) * rt, y1, Math.sin(a1) * rt);
      const pts = [];
      for (let k = 0; k <= 16; k++) pts.push(p0.clone().lerp(p1, k / 16));
      parts.push(sweepTube(pts, (u) => 5.4 - 1.8 * u, 8, { kind: 1 }));
    }
  }
  // three luminous helices wind up the lattice: the elevator's power conduits
  for (let h = 0; h < 3; h++) {
    const pts = [];
    for (let k = 0; k <= 400; k++) {
      const u = k / 400;
      const y = y0 + 40 + u * (y1 - y0 - 60);
      const a = (h / 3) * TAU + u * TAU * 2.25;
      const r = latticeRadius(y) + 16;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    parts.push(sweepTube(pts, () => 3.4, 8, { kind: 4 }));
  }
  // hoops
  const hoopHeights = [];
  for (let y = y0 + 200; y < y1; y += 250) hoopHeights.push(y);
  for (const y of hoopHeights) {
    const r = latticeRadius(y);
    const pts = [];
    for (let k = 0; k <= 160; k++) { const a = (k / 160) * TAU; pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); }
    parts.push(sweepTube(pts, () => 3.2, 8, { kind: 2 }));
  }

  // --------------------------------------------------------- sky decks ------
  const deck = (y, rOuter, thick, kindRim = 2) => latheFacade([
    { r: coreRadius(y) * 0.9, y: y - thick * 0.9, kind: 1 },
    { r: rOuter * 0.72, y: y - thick * 0.75, kind: 1 },
    { r: rOuter * 0.96, y: y - thick * 0.28, kind: 0 },
    { r: rOuter, y: y, kind: kindRim },
    { r: rOuter * 0.985, y: y + thick * 0.18, kind: 0 },
    { r: rOuter * 0.93, y: y + thick * 0.24, kind: 3 },
    { r: coreRadius(y) * 0.9, y: y + thick * 0.26, kind: 3 },
  ], 128);
  const decks = [
    { y: AXIS.latticeY0 + 20, r: latticeRadius(AXIS.latticeY0 + 20) + 26, t: 46, name: 'Root Deck' },
    { y: 1260, r: latticeRadius(1260) + 16, t: 34, name: 'Garden Deck' },
    { y: 2180, r: latticeRadius(2180) + 38, t: 30, name: 'The Collar' },
    { y: AXIS.latticeY1 + 10, r: latticeRadius(AXIS.latticeY1) + 22, t: 40, name: 'Coronet' },
  ];
  for (const d of decks) parts.push(deck(d.y, d.r, d.t));

  const structure = new THREE.Mesh(mergeClean(parts), boneMat);
  structure.castShadow = true;
  structure.receiveShadow = true;
  group.add(structure);

  // --------------------------------------------------------------- core -----
  const coreProf = [];
  for (let j = 0; j <= 120; j++) {
    const y = PLAZA_Y - 2 + (j / 120) * (AXIS.crownY - PLAZA_Y);
    let r = coreRadius(y);
    // bulges where decks attach
    for (const d of decks) r += 8 * Math.exp(-Math.pow((y - d.y) / 30, 2));
    coreProf.push({ r, y, kind: j % 12 === 0 ? 4 : 0 });
  }
  coreProf.push({ r: AXIS.coreTop * 0.8, y: AXIS.crownY + 20, kind: 1 });
  coreProf.push({ r: 12, y: AXIS.crownY + 60, kind: 4 });
  coreProf.push({ r: 8, y: AXIS.anchorY, kind: 4 });
  const core = new THREE.Mesh(latheFacade(coreProf, 96), coreMat);
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  // ------------------------------------------------------------ crown -------
  const crown = new THREE.Group();
  crown.position.y = AXIS.crownY + 60;
  group.add(crown);
  const gyroMat = createFacadeMaterial('pearl', 103, { litFrac: 0.8 });
  const gyros = [];
  const ringDefs = [{ r: 250, tube: 11, tilt: 0.0 }, { r: 205, tube: 8, tilt: 0.42 }, { r: 165, tube: 7, tilt: -0.55 }];
  for (const rd of ringDefs) {
    const pts = [];
    for (let k = 0; k <= 200; k++) { const a = (k / 200) * TAU; pts.push(new THREE.Vector3(Math.cos(a) * rd.r, 0, Math.sin(a) * rd.r)); }
    const g = mergeClean([
      sweepTube(pts, () => rd.tube, 12, { kind: 1 }),
      sweepTube(pts.map((p) => p.clone().multiplyScalar(1 - (rd.tube * 1.1) / rd.r)), () => rd.tube * 0.35, 8, { kind: 2 }),
    ]);
    const m = new THREE.Mesh(g, gyroMat);
    m.castShadow = true;
    const holder = new THREE.Group();
    holder.rotation.x = rd.tilt;
    holder.add(m);
    crown.add(holder);
    gyros.push({ holder, mesh: m, speed: 0.02 + Math.abs(rd.tilt) * 0.05, tilt: rd.tilt });
  }
  // anchor node where the tether meets the tower
  const node = new THREE.Mesh(latheFacade([
    { r: 0.1, y: -40, kind: 1 }, { r: 42, y: -18, kind: 1 }, { r: 58, y: 0, kind: 2 }, { r: 42, y: 22, kind: 0 }, { r: 10, y: 60, kind: 4 }, { r: 6, y: 95, kind: 4 },
  ], 48), gyroMat);
  node.position.y = AXIS.anchorY - crown.position.y;
  crown.add(node);

  // --------------------------------------------------- tether & climbers ---
  const tetherTop = 45000;
  const tetherGeo = new THREE.CylinderGeometry(3.5, 6, tetherTop - AXIS.anchorY, 12, 1, true);
  tetherGeo.translate(0, (tetherTop + AXIS.anchorY) / 2, 0);
  // The tether seen from the city: a dark braided nanotube ribbon with four polished climber
  // tracks, white collars every 400 m, guide lights racing up the tracks at night, red and
  // white beacons, lit by the real sun and hazed by the same aerial perspective as the city.
  const tetherMat = aerialShaderMaterial({
    vertexShader: /* glsl */ `
varying float vY; varying vec3 vN; varying vec3 vW; varying float vA;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vY = w.y; vA = atan(position.z, position.x); vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
varying float vY; varying vec3 vN; varying vec3 vW; varying float vA;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float fw = max(length(fwidth(vW)), 1e-3);            // metres per pixel
  float rad = mix(6.0, 3.5, clamp((vY - 3140.0) / 41860.0, 0.0, 1.0));
  float q = fract(vA / 6.28318 * 4.0 + 0.5);
  float dq = abs(q - 0.5) * 6.28318 * rad / 4.0;         // metres from the nearest track's centre
  float track = 1.0 - smoothstep(0.9 - fw, 0.9 + fw, dq);
  float led = 1.0 - smoothstep(0.07, 0.07 + fw, dq);
  float cy = abs(mod(vY + 200.0, 400.0) - 200.0);
  float collar = 1.0 - smoothstep(1.2, 1.2 + fw, cy);
  float sd = 1.0 - smoothstep(0.03, 0.2, fw);
  float strand = vnoise(vec2(vA * rad * 5.0 + vY * 0.3, vY * 0.015)) * 0.6 + vnoise(vec2(vA * rad * 17.0 - vY * 0.8, vY * 0.05)) * 0.4;
  vec3 alb = vec3(0.1, 0.105, 0.115) * mix(1.0, 0.75 + 0.5 * strand, sd);
  alb = mix(alb, vec3(0.55, 0.57, 0.6), track);
  alb = mix(alb, vec3(0.82, 0.82, 0.8), collar);
  float metal = track * (1.0 - collar);
  vec3 sunC = uSunColor * uSunIlluminance;
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 H = normalize(V + uSunDir);
  float spec = pow(max(dot(N, H), 0.0), mix(30.0, 220.0, metal)) * mix(0.25, 3.0, metal);
  vec3 F0 = mix(vec3(0.04), alb, metal);
  vec3 col = alb * (1.0 - 0.8 * metal) / 3.14159 * (sunC * ndl + aerialInscatter(vec3(0.0, 1.0, 0.0)) * 1.2);
  col += F0 * spec * sunC * ndl;
  col += F0 * aerialInscatter(reflect(-V, N)) * (0.3 + 0.7 * metal);
  // guide lights race up the tracks; beacons every 120 m
  float lights = uCityLights;
  float pulse = pow(fract(vY / 2400.0 - uTime * 0.12), 14.0);
  col += vec3(0.55, 0.85, 1.0) * led * (0.04 + 0.5 * lights) * (0.3 + 3.0 * pulse);
  float beacon = step(0.985, fract(vY / 120.0)) * (0.6 + 0.4 * sin(uTime * 4.0));
  col += mix(vec3(1.0, 0.18, 0.1), vec3(1.0, 0.85, 0.6), step(0.5, fract(vY / 240.0))) * beacon * (1.0 + 3.0 * lights) * (1.0 - track);
  col = applyAerial(col, vW);
  float fade = 1.0 - smoothstep(34000.0, 44000.0, vY);
  gl_FragColor = vec4(col * fade, fade);
}`,
    transparent: true,
  });
  const tether = new THREE.Mesh(tetherGeo, tetherMat);
  tether.frustumCulled = false;
  group.add(tether);
  const halo = new THREE.Mesh(new THREE.CylinderGeometry(40, 60, tetherTop - AXIS.anchorY, 16, 1, true).translate(0, (tetherTop + AXIS.anchorY) / 2, 0), glowMaterial(0x6fb4ff, 0.07, { fresnelPow: 3.0, nightOnly: 0.97 }));
  halo.frustumCulled = false;
  group.add(halo);

  // climber pods: capsules riding the tether
  const podGeo = mergeClean([
    latheFacade([{ r: 0.1, y: -34, kind: 1 }, { r: 10, y: -26, kind: 1 }, { r: 14, y: -8, kind: 0 }, { r: 14, y: 8, kind: 2 }, { r: 10, y: 26, kind: 0 }, { r: 0.1, y: 34, kind: 1 }], 24),
  ]);
  const pods = [];
  const podMat = createFacadeMaterial('silver', 104, { litFrac: 0.9, band: 1e5, colW: 2.6, floorH: 3.4 });
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(podGeo, podMat);
    m.castShadow = true;
    group.add(m);
    const light = new THREE.Mesh(new THREE.SphereGeometry(22, 12, 8), glowMaterial(i % 2 ? 0xffc890 : 0x9fd4ff, 1.2, { fresnelPow: 1.5, nightOnly: 0.3 }));
    m.add(light);
    pods.push({ mesh: m, phase: i / 7, dir: i % 2 ? -1 : 1, speed: 0.012 + (i % 3) * 0.002 });
  }

  // ----------------------------------------------------------- beacons ----
  const beaconPts = [];
  for (const d of decks) for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; beaconPts.push(Math.cos(a) * d.r, d.y + 2, Math.sin(a) * d.r); }
  for (const rd of ringDefs) { /* crown lights handled by lantern kind */ }
  beaconPts.push(0, AXIS.anchorY + 100, 0);

  updaters.push({
    update(dt, t) {
      for (const g of gyros) {
        g.holder.rotation.y += dt * g.speed;
        g.mesh.rotation.y -= dt * g.speed * 0.6;
      }
      for (const p of pods) {
        // travel up/down between the anchor and 40 km with smooth easing near the ends
        const s = (p.phase + t * p.speed * p.dir) % 1;
        const u = s < 0 ? s + 1 : s;
        const y = AXIS.anchorY + 120 + Math.pow(u, 2.2) * 38000;
        p.mesh.position.set(0, y, 0);
      }
    },
  });

  const colliders = [
    { x: 0, z: 0, y0: 0, y1: AXIS.crownY + 100, radius: (y) => coreRadius(y) + 10 },
    { x: 0, z: 0, y0: AXIS.crownY - 60, y1: AXIS.crownY + 200, radius: 70 },
  ];
  return { group, decks, colliders, beacons: beaconPts, reflectHide: [halo, tether] };
}
