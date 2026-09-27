import * as THREE from 'three';
import { ATMO_CONSTANTS, ATMO_SAMPLING } from '../shaders/atmosphere.glsl.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/uniforms.js';
import { SNOISE_GLSL, SPACE_UTIL_GLSL } from './glsl.js';
import { R_EARTH } from './sim.js';

// The planet, rendered in one pass on a proxy sphere at the top of the
// atmosphere. Each fragment ray-traces the ground and the cloud shell and
// ray-marches single scattering (Rayleigh, Mie, ozone; same constants and
// transmittance LUT as the city sky) plus the multiple-scattering LUT.

export const R_TOP = 6460;
export const R_CLOUD = R_EARTH + 8;

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform mat4 projectionMatrix;
uniform samplerCube uSurfA;
uniform samplerCube uSurfB;
uniform samplerCube uClouds;
uniform sampler2D uTransmittanceLUT;
uniform sampler2D uMultiScatLUT;
uniform mat3 uToBody;
uniform vec3 uSunDir;
uniform float uSunE;
uniform float uCloudPh;       // 0..1 flow phase
uniform float uCloudP;        // flow period (s)
uniform float uTime;          // real seconds
uniform float uSimDay;        // fraction of day for lightning seeds
uniform vec4 uRingN[4];       // ring axis (inertial) + radius
uniform vec4 uRingW[4];       // half width, opacity
uniform vec3 uMeridian;       // body frame
uniform vec3 uMoonDir;
uniform float uLightGain;
uniform float uPixAng;
uniform float uReady;
uniform float uAtmoGain;
varying vec3 vWorld;

${ATMO_CONSTANTS}
${ATMO_SAMPLING}
${NOISE_GLSL}
${SNOISE_GLSL}
${SPACE_UTIL_GLSL}

const float RC = ${R_CLOUD.toFixed(1)};
const float RTOP = ${R_TOP.toFixed(1)};

float earthShadow(vec3 p, vec3 s) {
  float b = dot(p, s);
  if (b > 0.0) return 1.0;
  float hMin = length(p - s * b) - Rg;
  return smoothstep(-8.0, 6.0, hMin);
}

// Shadows of the orbital rings (cylindrical bands around the planet)
float ringShadow(vec3 p, vec3 s) {
  float lit = 1.0;
  for (int k = 0; k < 4; k++) {
    vec3 n = uRingN[k].xyz;
    float R = uRingN[k].w;
    vec3 pp = p - n * dot(p, n);
    vec3 sp = s - n * dot(s, n);
    float a = dot(sp, sp);
    if (a < 1e-6) continue;
    float b = dot(pp, sp);
    float c = dot(pp, pp) - R * R;
    float disc = b * b - a * c;
    if (disc < 0.0) continue;
    float t = (-b + sqrt(disc)) / a;
    if (t <= 0.0) continue;
    float ax = dot(p + s * t, n);
    float hw = uRingW[k].x;
    float pen = 0.0047 * t + 0.3;           // penumbra from the Sun's disc
    float band = 1.0 - smoothstep(hw - pen, hw + pen, abs(ax));
    // gaps between the habitat deck and the rim accelerators
    float gap = smoothstep(0.30 * hw, 0.36 * hw, abs(ax)) * (1.0 - smoothstep(0.86 * hw, 0.9 * hw, abs(ax)));
    lit *= 1.0 - band * uRingW[k].y * (1.0 - 0.55 * gap);
  }
  return lit;
}

float zonalOmega(float lat) {
  float al = abs(lat);
  float u = -6.0 + 22.0 * smoothstep(0.26, 0.78, al) - 20.0 * smoothstep(0.96, 1.3, al);
  return u / (6.371e6 * max(cos(lat), 0.25));
}

// Cloud density in the body frame, flowing with the zonal winds
float cloudDensity(vec3 b, float lod, float fp) {
  float lat = asin(clamp(b.y, -1.0, 1.0));
  float w = zonalOmega(lat) * uCloudP;
  float ph0 = uCloudPh, ph1 = fract(uCloudPh + 0.5);
  vec4 c0 = textureLod(uClouds, rotY(b, -w * ph0), lod);
  vec4 c1 = textureLod(uClouds, rotY(b, -w * ph1), lod);
  float k = abs(2.0 * ph0 - 1.0);           // 1 at the ends of phase 0 -> use c1
  float pot = mix(c0.r, c1.g, k);
  float bias = mix(c0.b, c1.b, k) - 0.5;
  pot += bias;
#if QUALITY > 0
  if (fp < 18.0) {
    float det = snoise(b * 900.0 + vec3(uCloudPh * 3.0, 0.0, 0.0)) * 0.5 + snoise(b * 2300.0) * 0.25;
    pot += det * 0.06 * smoothstep(18.0, 4.0, fp);
  }
#endif
  float dens = smoothstep(0.47, 0.74, pot);
  float ci = mix(c0.a, c1.a, k);
  dens = max(dens, smoothstep(0.45, 0.85, ci) * 0.45);
  return dens;
}

vec3 integrateAtmo(vec3 ro, vec3 rd, float t0, float t1, bool ground, vec3 sun, out vec3 T) {
  vec3 L = vec3(0.0);
  T = vec3(1.0);
  float tMid = ground ? t1 : clamp(-dot(ro, rd), t0, t1);
  float cosT = dot(rd, sun);
  float pR = phaseRayleigh(cosT), pM = phaseMie(cosT);
  float jit = ign(gl_FragCoord.xy);
  for (int seg = 0; seg < 2; seg++) {
    float a = seg == 0 ? t0 : tMid;
    float b = seg == 0 ? tMid : t1;
    if (b - a < 0.01) continue;
    int n = ground ? STEPS * 2 : STEPS;
    for (int i = 0; i < 48; i++) {
      if (i >= n) break;
      float x0 = float(i) / float(n), x1 = float(i + 1) / float(n);
      float s0, s1;
      if (seg == 0) { s0 = a + (b - a) * (1.0 - (1.0 - x0) * (1.0 - x0)); s1 = a + (b - a) * (1.0 - (1.0 - x1) * (1.0 - x1)); }
      else { s0 = a + (b - a) * x0 * x0; s1 = a + (b - a) * x1 * x1; }
      float dt = s1 - s0;
      float t = mix(s0, s1, jit);
      vec3 p = ro + rd * t;
      float r = length(p);
      vec3 up = p / r;
      vec3 sR; float sM; vec3 ext;
      mediumAt(r - Rg, sR, sM, ext);
      float mu = dot(up, sun);
      vec3 Ts = sampleTransmittance(uTransmittanceLUT, r, mu) * earthShadow(p, sun);
      vec3 ms = sampleMultiScat(uMultiScatLUT, r, mu);
      vec3 S = ((sR * pR + sM * pM) * Ts + (sR + vec3(sM)) * ms) * uSunE;
      // green oxygen airglow near 95 km (only visible against the night)
      float h = r - Rg;
      S += vec3(0.25, 1.0, 0.45) * 2.2e-5 * exp(-pow(abs(h - 94.0) / 5.0, 2.0)) * (1.0 - smoothstep(-0.25, 0.05, mu));
      vec3 sT = exp(-ext * dt);
      L += T * (S - S * sT) / max(ext, vec3(1e-7));
      T *= sT;
    }
  }
  return L;
}

// district islands of the lagoon (km east, km north, radius) from src/world/layout.js
const vec3 ISLANDS[8] = vec3[8](vec3(2.5, 2.0, 0.56), vec3(3.75, -0.25, 0.7), vec3(2.35, -2.65, 0.52), vec3(-0.25, -3.65, 0.62),
  vec3(-2.65, -2.3, 0.64), vec3(-3.8, 0.15, 0.74), vec3(-2.35, 2.7, 0.58), vec3(0.35, 3.7, 0.66));
// Meridian's atoll, drawn procedurally at its true size (km, local east/north)
vec4 meridianSite(vec3 b, float fp, out float lightsOut) {
  lightsOut = 0.0;
  vec3 dv = b - uMeridian;
  float dk = length(dv) * 6371.0;
  if (dk > 40.0) return vec4(0.0);
  vec3 e = normalize(vec3(uMeridian.z, 0.0, -uMeridian.x));   // east
  vec3 nn = vec3(0.0, 1.0, 0.0);
  float x = dot(dv, e) * 6371.0, y = dot(dv, nn) * 6371.0;
  float r = length(vec2(x, y));
  float a = atan(y, x);
  float land = 0.0, lagoon = 0.0, city = 0.0;
  // rim of the atoll with channels (south = Gate)
  float rimR = 5.9 + 0.35 * snoise(vec3(cos(a) * 1.7, sin(a) * 1.7, 3.0));
  float rim = 1.0 - smoothstep(0.32, 0.46, abs(r - rimR));
  float ch = min(min(abs(a + 1.5708), abs(a + 0.05)), min(abs(a - 2.45), abs(a + 2.55)));
  rim *= smoothstep(0.05, 0.12, ch);
  land = max(land, rim);
  lagoon = smoothstep(rimR + 0.1, rimR - 0.4, r);
  // central island and eight district islands
  land = max(land, smoothstep(1.05, 0.85, r));
  for (int i = 0; i < 8; i++) {
    vec3 isl = ISLANDS[i];
    land = max(land, smoothstep(isl.z * 1.1, isl.z * 0.75, length(vec2(x, y) - isl.xy)));
  }
  city = land * smoothstep(rimR + 0.2, rimR - 0.3, r);
  city = max(city, rim * 0.5);
  // northern massif and Mount Anchor
  float massif = smoothstep(7.2, 9.0, y) * (1.0 - smoothstep(19.0, 22.0, y)) * (1.0 - smoothstep(12.0, 16.0, abs(x + 0.8)));
  massif *= smoothstep(-0.2, 0.3, snoise(vec3(x, y, 0.0) * 0.12));
  float anchor = smoothstep(4.5, 2.5, length(vec2(x + 18.8, y - 6.8)));
  land = max(land, max(massif, anchor));
  lightsOut = city * (1.2 + 0.8 * step(r, 1.2)) + smoothstep(0.35, 0.0, r) * 6.0;
  vec3 col = mix(vec3(0.02, 0.2, 0.2), vec3(0.03, 0.05, 0.02), land);
  col = mix(col, vec3(0.16, 0.15, 0.13), city * 0.6);
  float cover = max(lagoon, land) * smoothstep(40.0, 30.0, dk) * smoothstep(9.0, 2.0, fp);
  return vec4(col, cover);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  vec3 sun = uSunDir;
  vec2 tA = sphereHits(ro, rd, RTOP);
  if (tA.x > tA.y || tA.y < 0.0) discard;
  float t0 = max(tA.x, 0.0);
  vec2 tG = sphereHits(ro, rd, Rg);
  bool hitG = tG.x < tG.y && tG.x > 0.0;
  // ground point (clamped to the closest point on the sphere when missing, so derivatives stay defined)
  float tg = hitG ? tG.x : max(-dot(ro, rd), 0.0);
  vec3 pG = ro + rd * tg;
  pG = normalize(pG) * Rg;
  vec3 n = pG / Rg;
  vec3 b = uToBody * n;
  float fp = tg * uPixAng;                   // km per pixel
  vec4 A = texture(uSurfA, b);
  vec4 B = texture(uSurfB, b);
  float H = A.a * 2.0 - 1.0;
  vec3 alb = A.rgb * A.rgb;
  float Hd = H;
#if QUALITY > 0
  float coastW = exp(-abs(H) * 10.0) * smoothstep(14.0, 2.0, fp);
  if (coastW > 0.01) Hd += (snoise(b * 1500.0) * 0.6 + snoise(b * 4100.0) * 0.4) * 0.05 * coastW;
#endif
  float ew = max(fwidth(Hd), 1e-4);
  float landF = smoothstep(-ew, ew, Hd);
  float bakedLand = step(0.0, H);
  vec3 coastLand = mix(vec3(0.07, 0.075, 0.045), alb, bakedLand);
  vec3 coastSea = mix(alb, vec3(0.012, 0.05, 0.06), bakedLand);
  vec3 landAlb = bakedLand > 0.5 ? alb : coastLand;
  vec3 seaAlb = bakedLand > 0.5 ? coastSea : alb;
  float ice = B.g;

  // relief normal (land only)
  vec3 dpdx = dFdx(pG), dpdy = dFdy(pG);
  float hK = max(H, 0.0) * 6.0 * 3.5;        // km, exaggerated x3.5
  float dhx = dFdx(hK), dhy = dFdy(hK);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  vec3 nb = normalize(abs(det) * n - grad * landF);
  if (abs(det) < 1e-12) nb = n;

  float mu = dot(n, sun);
  vec3 sunT = sampleTransmittance(uTransmittanceLUT, Rg + 0.3, mu) * smoothstep(-0.03, 0.02, mu);
  float rsh = ringShadow(pG, sun);
  // cloud shadow: density where the sun ray leaves the cloud shell
  float csh = 1.0;
  {
    vec2 ts = sphereHits(pG, sun, RC);
    vec3 ps = pG + sun * max(ts.y, 0.0);
    float cs = cloudDensity(uToBody * normalize(ps), 2.5, 30.0);
    csh = 1.0 - 0.82 * cs;
  }
  float shadow = rsh * csh;
  vec3 skyAmb = uSunE * vec3(0.05, 0.085, 0.16) * smoothstep(-0.28, 0.35, mu) * (0.35 + 0.65 * clamp(mu + 0.3, 0.0, 1.0));
  vec3 V = -rd;
  // land
  float ndl = max(dot(nb, sun), 0.0);
  vec3 landCol = landAlb / S_PI * (uSunE * sunT * ndl * shadow + skyAmb * (0.6 + 0.4 * shadow));
  // ocean with sun glint
  vec3 seaCol;
  {
    float wind = snoise(b * 25.0 + vec3(0.0, uCloudPh * 2.0, 0.0)) * 0.5 + 0.5;
    float al = mix(0.12, 0.3, wind);
    al = mix(al, 0.5, ice);
    vec3 Hh = normalize(V + sun);
    float nh = max(dot(n, Hh), 0.0), nv = max(dot(n, V), 1e-3), nl = max(dot(n, sun), 0.0);
    float a2 = al * al;
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (S_PI * dd * dd);
    float k = al * 0.5;
    float G = (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k));
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, Hh), 0.0), 5.0);
    float Fv = 0.02 + 0.98 * pow(clamp(1.0 - nv, 0.0, 1.0), 5.0);
    vec3 spec = vec3(D * G * F / (4.0 * nv + 1e-4)) * uSunE * sunT * shadow;
    vec3 skyRefl = uSunE * vec3(0.03, 0.06, 0.13) * smoothstep(-0.2, 0.3, mu);
    vec3 body = seaAlb / S_PI * (uSunE * sunT * nl * shadow + skyAmb);
    seaCol = body * (1.0 - Fv) + Fv * skyRefl + spec * (1.0 - ice);
    seaCol = mix(seaCol, seaAlb / S_PI * (uSunE * sunT * nl * shadow + skyAmb), ice);
  }
  vec3 col = mix(seaCol, landCol, landF);

  // Meridian's atoll
  float mLights;
  vec4 site = meridianSite(b, fp, mLights);
  if (site.a > 0.0) {
    vec3 sc = site.rgb / S_PI * (uSunE * sunT * max(mu, 0.0) * shadow + skyAmb);
    col = mix(col, sc, site.a);
  }

  // night lights
  float night = 1.0 - smoothstep(-0.10, 0.06, mu);
  float dens = B.r * landF;
  float sparkle = 1.0;
#if QUALITY > 0
  {
    float fade = smoothstep(9.0, 1.5, fp);
    vec3 q = b * 6371.0 / 2.2;
    float h = hash13(floor(q));
    float grid = smoothstep(0.55, 0.95, h);
    float n2 = snoise(b * 700.0) * 0.5 + 0.5;
    sparkle = mix(0.6 + 0.8 * n2, 0.25 + 2.2 * grid * n2, fade);
  }
#endif
  float cityL = pow(dens, 1.25) * sparkle;
  vec3 lightCol = mix(vec3(1.0, 0.55, 0.26), vec3(1.0, 0.82, 0.62), smoothstep(0.2, 0.8, dens));
  vec3 emis = lightCol * cityL * 0.9 + vec3(1.0, 0.86, 0.66) * mLights * 1.5;

  // clouds
  vec2 tC = sphereHits(ro, rd, RC);
  vec3 pC = ro + rd * max(tC.x, 0.0);
  vec3 nC = normalize(pC);
  vec3 bC = uToBody * nC;
  float fpC = max(tC.x, 0.0) * uPixAng;
  float cA = tC.x < tC.y ? cloudDensity(bC, 0.0, fpC) : 0.0;
  vec3 cloudCol = vec3(0.0);
  {
    float muC = dot(nC, sun);
    vec3 sunTc = sampleTransmittance(uTransmittanceLUT, RC, muC) * earthShadow(pC * 1.0005, sun);
    // self shadowing: density a little toward the Sun
    vec3 st = normalize(sun - nC * muC + 1e-5);
    float cs = cloudDensity(uToBody * normalize(nC + st * 0.006), 1.0, 30.0);
    float shade = exp(-2.2 * max(cs - cA * 0.35, 0.0));
    float wrap = clamp((muC + 0.12) / 1.12, 0.0, 1.0);
    float rs = ringShadow(pC, sun);
    vec3 amb = uSunE * vec3(0.06, 0.09, 0.15) * smoothstep(-0.25, 0.3, muC);
    cloudCol = vec3(0.92) / S_PI * (uSunE * sunTc * wrap * (0.35 + 0.65 * shade) * rs + amb * (0.7 + 0.3 * shade));
    // city glow on cloud undersides, lightning in the deep convection
    float nightC = 1.0 - smoothstep(-0.10, 0.06, muC);
    float under = texture(uSurfB, bC).r;
    cloudCol += vec3(1.0, 0.6, 0.32) * under * 0.22 * nightC;
    vec3 cell = floor(bC * 260.0);
    float hsh = hash13(cell + floor(uTime * 1.7));
    float flash = step(0.9975, hsh) * smoothstep(0.55, 0.9, cA) * nightC;
    flash *= 0.5 + 0.5 * sin(uTime * 40.0 + hsh * 60.0);
    cloudCol += vec3(0.75, 0.82, 1.0) * flash * 3.0;
    // faint moonlight
    cloudCol += vec3(0.5, 0.6, 0.8) * 0.004 * max(dot(nC, uMoonDir), 0.0) * nightC;
  }
  emis *= 1.0 - cA * 0.8;
  col += emis * uLightGain * night;
  col = mix(col, cloudCol, cA);

  // atmosphere
  vec3 T;
  float tEnd = hitG ? tG.x : tA.y;
  vec3 L = integrateAtmo(ro, rd, t0, tEnd, hitG, sun, T);
  // artistic: thin the blue veil over the disc a little, keep the limb at full strength
  L *= mix(1.0, uAtmoGain, smoothstep(0.08, 0.6, dot(n, -rd)) * (hitG ? 1.0 : 0.0));
  if (hitG) {
    gl_FragColor = vec4(col * T + L, 1.0);
    vec4 clip = projectionMatrix * viewMatrix * vec4(pG, 1.0);
    gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  } else {
    // limb: clouds that poke above the horizon, then the glowing air
    float lc = cA * step(tC.x, tC.y);
    float a = max(lc, 1.0 - dot(T, vec3(1.0 / 3.0)));
    gl_FragColor = vec4(cloudCol * lc * T + L, a);
    gl_FragDepth = gl_FragCoord.z;
  }
  gl_FragColor.rgb *= uReady;
}
`;

export class Earth {
  constructor(bake, quality) {
    this.bake = bake;
    this.uniforms = {
      uSurfA: { value: bake.surfA.texture },
      uSurfB: { value: bake.surfB.texture },
      uClouds: { value: bake.clouds.texture },
      uTransmittanceLUT: U.uTransmittanceLUT,
      uMultiScatLUT: U.uMultiScatLUT,
      uToBody: { value: new THREE.Matrix3() },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunE: U.uSunIlluminance,
      uCloudPh: { value: 0 },
      uCloudP: { value: 3 * 86400 },
      uTime: { value: 0 },
      uSimDay: { value: 0 },
      uRingN: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 1, 0, 1)) },
      uRingW: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) },
      uMeridian: { value: new THREE.Vector3(1, 0, 0) },
      uMoonDir: { value: new THREE.Vector3(0, 0, 1) },
      uLightGain: { value: 1 },
      uPixAng: { value: 0.001 },
      uReady: { value: 0 },
      uAtmoGain: { value: 0.5 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      defines: { QUALITY: quality.earthQ, STEPS: quality.atmoSteps },
      transparent: true,
      depthWrite: true,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(R_TOP + 3, 192, 96), this.material);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
  }

  setQuality(q) {
    this.material.defines.QUALITY = q.earthQ;
    this.material.defines.STEPS = q.atmoSteps;
    this.material.needsUpdate = true;
  }

  update(sim, realTime) {
    const u = this.uniforms;
    u.uToBody.value.setFromMatrix4(sim.earthMat).transpose();
    u.uSunDir.value.copy(sim.sunDir);
    u.uCloudPh.value = ((sim.t / u.uCloudP.value) % 1 + 1) % 1;
    u.uTime.value = realTime;
    u.uMoonDir.value.copy(sim.moonPos).normalize();
    u.uReady.value = this.bake.ready ? 1 : 0;
  }
}
