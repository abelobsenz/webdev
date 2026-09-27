import * as THREE from 'three';
import { ATMO_CONSTANTS, ATMO_SAMPLING } from '../shaders/atmosphere.glsl.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/uniforms.js';

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

vec3 milkyWay(vec3 c) {
  // galactic frame: north pole (RA 192.86, Dec 27.13), centre (RA 266.4, Dec -28.94)
  const vec3 gN = vec3(-0.8676, -0.1981, 0.4560);
  const vec3 gC = vec3(-0.0549, -0.8734, -0.4838);
  vec3 gY = cross(gN, gC);
  float b = dot(c, gN);                  // sin(galactic latitude)
  float l = atan(dot(c, gY), dot(c, gC)); // galactic longitude
  float coreW = 0.12 + 0.10 * exp(-l * l * 1.2);
  float band = exp(-b * b / (coreW * coreW));
  float bulge = exp(-(l * l) * 3.0 - b * b * 40.0);
  vec2 q = vec2(l * 3.0, b * 9.0);
  float n = fbm2(q * 2.0 + 3.0);
  float dust = smoothstep(0.35, 0.75, fbm2(q * 3.1 + 11.0)) * exp(-b * b * 180.0);
  float clumps = 0.55 + 0.9 * n;
  vec3 col = mix(vec3(0.55, 0.65, 1.0), vec3(1.0, 0.82, 0.62), exp(-l * l * 0.8));
  float I = band * clumps * (1.0 - 0.85 * dust) + bulge * 1.4;
  return col * I * 0.006;
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
    // airglow near horizon
    night += vec3(0.0010, 0.0016, 0.0012) * exp(-max(muView, 0.0) * 8.0);
    col += night * Tview * uStarBoost;
    }
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
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
    },
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  mesh.onBeforeRender = (renderer, scene, camera) => {
    mat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    mat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
    mat.uniforms.uCamKm.value.setFromMatrixPosition(camera.matrixWorld);
    // uniforms changed after program bind — force upload
    mat.uniformsNeedUpdate = true;
  };
  return mesh;
}
