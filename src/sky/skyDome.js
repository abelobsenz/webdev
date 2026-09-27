import * as THREE from 'three';
import { ATMO_CONSTANTS, ATMO_SAMPLING } from '../shaders/atmosphere.glsl.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/uniforms.js';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';

/**
 * Full-screen sky: atmosphere (LUT), sun disc, Dyson swarm, stars, Milky Way,
 * zodiacal glow and the distant ocean all the way to the true horizon.
 * Lives in the km-scale "sky scene".
 */
const VERT = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
varying vec3 vRay;
void main() {
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  vRay = (uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uSkyViewLUT;
uniform sampler2D uTransmittanceLUT;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uSunIlluminance;
uniform float uNight;
uniform float uTime;
uniform vec3 uCamKm;
uniform mat3 uCelestial;
uniform float uStarBoost;
uniform float uEnvMode;
uniform sampler2D uGalaxy;
uniform float uTwilight;
varying vec3 vRay;

${ATMO_CONSTANTS}
${ATMO_SAMPLING}
${NOISE_GLSL}

// Flux-conserving stars: each star keeps its brightness whatever the pixel footprint.
vec3 starLayer(vec3 d, float scale, float density, float bright) {
  vec3 p = d * scale;
  vec3 cell = floor(p);
  vec3 h = hash33(cell);
  if (h.x > density) return vec3(0.0);
  vec3 sp = cell + 0.25 + 0.5 * hash33(cell + 17.3);
  vec3 sd = normalize(sp);
  float ang = acos(clamp(dot(sd, d), -1.0, 1.0));
  float px = max(length(fwidth(d)), 1e-5);
  float sigma = max(px * 0.55, 0.00008);
  float mag = pow(h.y, 7.0);
  float core = exp(-ang * ang / (2.0 * sigma * sigma)) * (px * px) / (sigma * sigma) * 1.3;
  float tw = 0.8 + 0.2 * sin(uTime * (2.0 + 6.0 * h.z) + h.x * 40.0);
  // colour temperature: blue-white to orange
  float t = h.z;
  vec3 col = t < 0.2 ? vec3(0.62, 0.72, 1.0) : t < 0.55 ? vec3(0.95, 0.96, 1.0) : t < 0.8 ? vec3(1.0, 0.93, 0.80) : vec3(1.0, 0.76, 0.52);
  return col * core * (0.006 + 0.35 * mag) * bright * tw;
}

// Milky Way: baked once into an equirectangular texture in equatorial coordinates
vec3 milkyWay(vec3 c) {
  vec2 uv = vec2(atan(c.y, c.x) * 0.15915494 + 0.5, asin(clamp(c.z, -1.0, 1.0)) * 0.31830989 + 0.5);
  float px = length(fwidth(c)) * 325.95;   // texels per pixel (2048 texels span 2 pi)
  return textureLod(uGalaxy, uv, log2(max(px, 1.0))).rgb;
}

// Zodiacal light: sunlight scattered by interplanetary dust along the ecliptic,
// a tilted cone above the western horizon after dusk (and the faint gegenschein).
vec3 zodiacal(vec3 c, vec3 sunE) {
  const vec3 eN = vec3(0.0, -0.3978, 0.9175);          // ecliptic north pole (equatorial)
  float sb = dot(c, eN);
  vec3 cp = normalize(c - eN * sb + 1e-6);
  vec3 sp = normalize(sunE - eN * dot(sunE, eN) + 1e-6);
  float lam = acos(clamp(dot(cp, sp), -1.0, 1.0));      // elongation along the ecliptic
  float beta = asin(clamp(sb, -1.0, 1.0));
  float width = 0.10 + 0.32 * lam / 3.14159;
  float I = exp(-abs(beta) / width) * (0.9 / (0.06 + lam * lam * 1.4));
  I += 0.06 * exp(-((3.14159 - lam) * (3.14159 - lam) + beta * beta) / 0.03);
  return vec3(1.0, 0.9, 0.76) * I * 0.00075;
}

// Airglow: green (557.7 nm, ~95 km) and red (630 nm, ~250 km) emission shells,
// brightest a few degrees above the horizon, rippled by gravity waves.
vec3 airglow(vec3 dir, float mu) {
  float m = max(mu, 0.0);
  float vrG = inversesqrt(max(1.0 - 0.9705 * (1.0 - m * m), 1e-3));
  float vrR = inversesqrt(max(1.0 - 0.9245 * (1.0 - m * m), 1e-3));
  vec2 q = dir.xz / max(m + 0.12, 0.12);
  float waves = 0.72 + 0.28 * sin(q.x * 9.0 + q.y * 4.0 + uTime * 0.05) * (0.6 + 0.4 * vnoise(q * 3.0 + uTime * 0.01));
  return (vec3(0.30, 1.0, 0.42) * 0.00055 * waves * vrG + vec3(1.0, 0.22, 0.12) * 0.00022 * vrR) * smoothstep(-0.02, 0.06, mu);
}

// The Veil: faint auroral curtains hung beneath the Halo, where the ring's mass
// streams bleed charge into the upper atmosphere (100 - 260 km).
vec3 veil(vec3 ro, vec3 dir) {
  vec2 h0 = vec2(raySphere(ro, dir, Rg + 100.0), raySphere(ro, dir, Rg + 260.0));
  if (h0.x < 0.0 || h0.y < 0.0) return vec3(0.0);
  vec3 acc = vec3(0.0);
  const int N = 10;
  float dt = (h0.y - h0.x) / float(N);
  for (int i = 0; i < N; i++) {
    vec3 p = ro + dir * (h0.x + (float(i) + 0.5) * dt);
    float h = length(p) - Rg;
    float x = p.x, z = p.z;
    // two wavy ribbons running east-west, south and north of the zenith
    float zA = 150.0 + 28.0 * sin(x * 0.006 + uTime * 0.03) + 9.0 * sin(x * 0.021 - uTime * 0.07);
    float zB = -230.0 + 36.0 * sin(x * 0.004 - uTime * 0.02 + 1.7) + 12.0 * sin(x * 0.017 + uTime * 0.05);
    float wA = exp(-pow((z - zA) / 7.0, 2.0)), wB = exp(-pow((z - zB) / 10.0, 2.0)) * 0.7;
    float rays = 0.45 + 0.55 * vnoise(vec2(x * 0.09 + uTime * 0.12, 0.5)) * vnoise(vec2(x * 0.023 - uTime * 0.04, 3.0));
    float vert = smoothstep(98.0, 112.0, h) * exp(-(h - 110.0) / 55.0);
    vec3 colH = mix(vec3(0.25, 1.0, 0.55), vec3(0.75, 0.3, 0.95), smoothstep(125.0, 230.0, h));
    acc += colH * (wA + wB) * rays * vert * dt;
  }
  return acc * 0.00016;
}

// Noctilucent clouds (~83 km): silver-blue ripples still in sunlight in deep twilight.
vec3 noctilucent(vec3 ro, vec3 dir) {
  float t = raySphere(ro, dir, Rg + 83.0);
  if (t < 0.0) return vec3(0.0);
  vec3 p = ro + dir * t;
  float b = dot(p, uSunDir);
  vec3 cl = p - uSunDir * b;
  float hMin = length(cl) - Rg;
  float lit = b > 0.0 ? 1.0 : smoothstep(12.0, 30.0, hMin);
  if (lit <= 0.0) return vec3(0.0);
  vec2 q = p.xz * 0.018;
  q = mat2(0.87, -0.5, 0.5, 0.87) * q;
  float band = fbm2(q * vec2(1.0, 3.5) + vec2(uTime * 0.004, 0.0));
  float ripple = 0.6 + 0.4 * sin(q.x * 22.0 + fbm2(q * 2.0) * 6.0);
  float d = smoothstep(0.52, 0.8, band) * ripple * smoothstep(0.35, 0.6, fbm2(q * 0.35 + 7.0));
  float fwd = 0.6 + 1.4 * pow(max(dot(dir, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0);
  return vec3(0.72, 0.86, 1.0) * d * lit * fwd * uSunIlluminance * 0.0009;
}

// Meteors: a light shower from a radiant low in the north-east.
vec3 meteors(vec3 dir, float mu) {
  if (mu < 0.05) return vec3(0.0);
  vec3 acc = vec3(0.0);
  const vec3 radiant = vec3(0.57, 0.36, -0.74);
  for (int k = 0; k < 3; k++) {
    float tt = uTime * 0.23 + float(k) * 0.371;
    float id = floor(tt) + float(k) * 101.0;
    float f = fract(tt);
    vec3 h = hash33(vec3(id, id * 1.7 + 3.0, 5.0));
    if (h.x > 0.55 || f > 0.16) continue;
    float az = h.y * 6.2831853, el = mix(0.35, 1.25, h.z);
    vec3 s0 = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
    vec3 mv = normalize(s0 - radiant * dot(s0, radiant));    // away from the radiant
    mv = normalize(mv - s0 * dot(mv, s0));
    float prog = f / 0.16;
    float len = mix(0.08, 0.25, hash11(id * 3.1));
    // tangent-plane coordinates around s0
    vec3 e2 = cross(s0, mv);
    vec2 pd = vec2(dot(dir - s0, mv), dot(dir - s0, e2));
    if (dot(dir, s0) < 0.9) continue;
    float head = prog * len;
    float along = clamp(pd.x, head - len * 0.5, head);
    float dd = length(vec2(pd.x - along, pd.y));
    float px = max(length(fwidth(dir)), 1e-4);
    float core = exp(-dd * dd / (px * px * 1.2));
    float tail = smoothstep(head - len * 0.5, head, along);
    float fade = smoothstep(0.0, 0.1, prog) * (1.0 - smoothstep(0.75, 1.0, prog));
    acc += mix(vec3(0.6, 1.0, 0.75), vec3(1.0, 0.95, 0.85), tail) * core * tail * tail * fade * (0.02 + 0.06 * h.z);
  }
  return acc;
}

// Dyson swarm: several inclined collector rings around the sun (gnomonic projection)
vec3 dysonSwarm(vec3 d, vec3 s) {
  float cs = dot(d, s);
  if (cs < 0.93) return vec3(0.0);
  vec3 e1 = normalize(cross(s, vec3(0.0, 0.0, 1.0)));
  vec3 e2 = cross(e1, s);
  vec2 p = vec2(dot(d, e1), dot(d, e2)) / cs;
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    float a = 0.045 + 0.028 * fk;
    float inc = 0.35 + 0.33 * fk;
    float b = a * abs(cos(inc)) + 0.002;
    float psi = 0.6 + 1.3 * fk + uTime * 0.0004 * (fk + 1.0);
    float c = cos(psi), sn = sin(psi);
    vec2 q = vec2(c * p.x + sn * p.y, -sn * p.x + c * p.y);
    vec2 ab = vec2(a, b);
    vec2 qa = q / ab;
    float f = dot(qa, qa) - 1.0;
    vec2 g = 2.0 * q / (ab * ab);
    float dist = abs(f) / max(length(g), 1e-4);
    float phi = atan(qa.y, qa.x);
    float w = 0.00018 + 0.00006 * fk;
    float line = exp(-dist * dist / (w * w));
    float seg = floor(phi * 520.0 + uTime * (0.02 + 0.01 * fk));
    float spark = pow(hash11(seg + fk * 91.0), 30.0) * 14.0;
    float body = 0.03 * smoothstep(0.2, 0.9, hash11(floor(phi * 40.0) + fk * 13.0));
    acc += line * (body + spark) * vec3(1.0, 0.86, 0.62);
  }
  // faint diffuse lens of the swarm
  float r = length(p);
  acc += vec3(1.0, 0.85, 0.65) * 0.05 * exp(-r * 18.0);
  return acc;
}

void main() {
  vec3 dir = normalize(vRay);
  vec3 camPlanet = uCamKm + vec3(0.0, Rg, 0.0);
  float vh = max(length(camPlanet), Rg + 0.002);
  vec3 up = camPlanet / length(camPlanet);
  vec3 ro = up * vh;
  vec3 col = skyRadiance(uSkyViewLUT, vh, up, dir, uSunDir) * uSunIlluminance;
  float tG = raySphere(ro, dir, Rg);
  float muView = dot(up, dir);
  if (tG > 0.0 && muView < 0.0) {
    // ---- distant ocean surface to the true horizon ----
    vec3 pg = ro + dir * tG;
    vec3 n = normalize(pg);
    vec2 wp = pg.xz * 40.0;
    vec3 wn = normalize(n + 0.012 * vec3(vnoise(wp + uTime * 0.05) - 0.5, 0.0, vnoise(wp.yx * 1.3 - uTime * 0.04) - 0.5));
    vec3 Tv = sampleTransmittance(uTransmittanceLUT, Rg, clamp(dot(n, -dir), 0.0, 1.0)) /
              max(sampleTransmittance(uTransmittanceLUT, vh, clamp(-muView, 0.0, 1.0)), vec3(1e-4));
    Tv = clamp(Tv, 0.0, 1.0);
    vec3 rdir = reflect(dir, wn);
    rdir.y = abs(rdir.y);
    vec3 skyR = skyRadiance(uSkyViewLUT, Rg + 0.002, n, normalize(rdir), uSunDir) * uSunIlluminance;
    float cosI = clamp(dot(-dir, wn), 0.0, 1.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
    float sunMu = dot(n, uSunDir);
    vec3 sunT = sampleTransmittance(uTransmittanceLUT, Rg, sunMu) * smoothstep(-0.02, 0.02, sunMu);
    float spec = pow(max(dot(normalize(rdir), uSunDir), 0.0), 900.0) * 60.0;
    vec3 body = vec3(0.004, 0.018, 0.03) * (sunT * max(sunMu, 0.0) * uSunIlluminance * 0.6 + 0.15 * skyR);
    vec3 surf = F * skyR + (1.0 - F) * body + spec * sunT * uSunIlluminance;
    col += surf * Tv;
  } else {
    vec3 Tview = sampleTransmittance(uTransmittanceLUT, vh, muView);
    // ---- sun disc with limb darkening ----
    float cs = dot(dir, uSunDir);
    const float sunCos = 0.99998;   // ~0.36 deg radius
    if (cs > sunCos && uEnvMode < 0.5) {
      float x = clamp((1.0 - cs) / (1.0 - sunCos), 0.0, 1.0);
      float mu = sqrt(1.0 - x);
      vec3 limb = pow(vec3(mu), vec3(0.48, 0.60, 0.78));
      col += vec3(1.0, 0.97, 0.92) * 1400.0 * limb * Tview;
    }
    // ---- night sky ----
    vec3 c = uCelestial * dir;
    vec3 night = vec3(0.0);
    if (uStarBoost > 0.001) {
    night += starLayer(c, 170.0, 0.014, 1.0);
    night += starLayer(c, 380.0, 0.006, 0.3);
    night += starLayer(c, 800.0, 0.003, 0.12);
    night += milkyWay(c);
    night += zodiacal(c, uCelestial * uSunDir);
    night += airglow(dir, muView);
    if (uEnvMode < 0.5) {
      night += veil(ro, dir);
      night += meteors(dir, muView);
    }
    col += night * Tview * uStarBoost;
    }
    // noctilucent clouds glow in deep twilight
    if (uTwilight > 0.001 && uEnvMode < 0.5) col += noctilucent(ro, dir) * Tview * uTwilight;
    col += dysonSwarm(dir, uSunDir) * Tview * 1.2;
  }
  // Moonlit sky: simple single-scatter approximation (moon illuminance ~ 1/400000 sun, boosted for readability)
  float mUp = dot(uMoonDir, up);
  if (mUp > -0.1) {
    float cm = dot(dir, uMoonDir);
    float mh = smoothstep(-0.1, 0.2, mUp);
    vec3 moonSky = vec3(0.0022, 0.0042, 0.0105) * (0.35 + 0.65 * exp(-max(muView, 0.0) * 2.5)) * mh;
    moonSky += vec3(0.02, 0.022, 0.025) * pow(max(cm, 0.0), 80.0) * mh;
    col += moonSky * uNight;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------ galaxy bake --
// The Milky Way in equatorial coordinates (x: RA 0h, y: RA 6h, z: north pole),
// rendered once at startup into a 2048x1024 equirectangular HDR texture:
// star clouds, the bulge, the Great Rift and filamentary dust, HII knots.
const GALAXY_FRAG = /* glsl */ `
${NOISE_GLSL}
varying vec2 vUv;
float fbm6(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 7; i++) { s += a * vnoise3(p); p = p * 2.02 + vec3(1.7, 9.2, 4.1); a *= 0.5; } return s; }
void main() {
  float ra = (vUv.x - 0.5) * 6.2831853, dec = (vUv.y - 0.5) * 3.14159265;
  vec3 c = vec3(cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec));
  const vec3 gN = vec3(-0.8676, -0.1981, 0.4560);
  const vec3 gC = vec3(-0.0549, -0.8734, -0.4838);
  vec3 gY = cross(gN, gC);
  float b = dot(c, gN);
  float l = atan(dot(c, gY), dot(c, gC));
  float cl = cos(l);
  float w = 0.085 + 0.075 * smoothstep(-0.3, 1.0, cl);
  float band = exp(-b * b / (w * w));
  float wide = exp(-b * b / 0.12) * 0.22;
  float bulge = exp(-(1.0 - cl) * 10.0 - b * b * 26.0);
  float n1 = fbm6(c * 5.0 + 3.1);
  float n2 = fbm6(c * 16.0 - 1.7);
  float starClouds = 0.3 + 1.5 * smoothstep(0.32, 0.78, n1 * 0.65 + n2 * 0.5);
  // dust: a dark rift splitting the band from Cygnus to Sagittarius + filaments
  float dn = fbm6(c * 9.0 + vec3(7.0, 1.0, 3.0)) * 0.6 + fbm6(c * 31.0) * 0.4;
  float riftB = b - 0.02 * sin(l * 2.3) - 0.012;
  float rift = exp(-riftB * riftB / (0.028 * 0.028)) * smoothstep(-0.5, 0.4, sin(l + 0.25)) * smoothstep(-0.9, 0.2, cl);
  float lanes = smoothstep(0.42, 0.62, dn) * exp(-b * b / (0.07 * 0.07));
  float dust = clamp(lanes * 0.9 + rift * smoothstep(0.25, 0.5, dn) * 1.1, 0.0, 0.94);
  vec3 armCol = vec3(0.60, 0.70, 1.0);
  vec3 coreCol = vec3(1.0, 0.78, 0.55);
  vec3 col = mix(armCol, coreCol, clamp(smoothstep(0.1, 1.0, cl) * 0.75 + bulge * 0.6, 0.0, 1.0));
  // dust reddens what it does not block
  col = mix(col, col * vec3(1.1, 0.85, 0.7), dust * 0.6);
  float I = (band * starClouds + wide) * (1.0 - dust) + bulge * 2.0 * (1.0 - dust * 0.75);
  // unresolved faint stars in the band
  I *= 0.85 + 0.3 * vnoise3(c * 400.0);
  float h2 = pow(max(fbm6(c * 38.0 + 5.0) - 0.35, 0.0) * 2.6, 5.0) * band;
  vec3 res = col * I * 0.0068 + vec3(1.0, 0.32, 0.42) * h2 * 0.004;
  gl_FragColor = vec4(res, 1.0);
}
`;

function bakeGalaxy(renderer, target) {
  const pass = new FullscreenPass(new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: GALAXY_FRAG, depthTest: false, depthWrite: false }));
  const prev = renderer.getRenderTarget();
  pass.render(renderer, target);
  renderer.setRenderTarget(prev);
  pass.material.dispose();
}

export function createSkyDome() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uSkyViewLUT: U.uSkyViewLUT,
      uTransmittanceLUT: U.uTransmittanceLUT,
      uSunDir: U.uSunDir,
      uMoonDir: U.uMoonDir,
      uSunIlluminance: U.uSunIlluminance,
      uNight: U.uNight,
      uTime: U.uTime,
      uCamKm: { value: new THREE.Vector3() },
      uCelestial: { value: new THREE.Matrix3() },
      uStarBoost: { value: 1.0 },
      uEnvMode: { value: 0 },
      uGalaxy: { value: null },
      uTwilight: { value: 0 },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
    },
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  const galaxyRT = new THREE.WebGLRenderTarget(2048, 1024, {
    type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
  });
  let baked = false;
  mat.uniforms.uGalaxy.value = galaxyRT.texture;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    if (!baked) { baked = true; bakeGalaxy(renderer, galaxyRT); }
    // noctilucent clouds: only in nautical / astronomical twilight
    const sy = U.uSunDir.value.y;
    const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
    mat.uniforms.uTwilight.value = ss(-0.03, -0.1, sy) * ss(-0.3, -0.22, sy);
    mat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    mat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
    mat.uniforms.uCamKm.value.setFromMatrixPosition(camera.matrixWorld);
    // uniforms changed after program bind — force upload
    mat.uniformsNeedUpdate = true;
  };
  return mesh;
}
