import * as THREE from 'three';
import { RINGS } from '../sky/celestial.js';
import { U } from '../core/uniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { SUNLIGHT_GLSL, createRibbonMaterial, buildRibbonGeometry } from './lines.js';
import { R_EARTH, MERIDIAN_LON, bodyDir, cityToBody } from './sim.js';
import { FACADE_GLSL } from '../world/materials.js';
import { HALO_PORTS } from './earthData.js';

// The four orbital rings at planetary scale, with the same radii, widths and
// orientations as RINGS in src/sky/celestial.js (defined there in Meridian's
// local frame; converted here to the Earth-fixed frame). Each ring is a trough:
// a habitat floor facing space, retaining walls, and two rotor tubes beneath.

/** Ring basis in the body frame: a = direction of u = 0, b = direction of increasing u, n = axis. */
export function ringBasis(def) {
  const m = cityToBody();
  const q = new THREE.Quaternion();
  if (def.polar) {
    const lon = THREE.MathUtils.degToRad(def.lon);
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(lon), Math.sin(lon), 0));
  } else {
    q.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(def.inclination), 0, 0));
  }
  const a = new THREE.Vector3(0, 1, 0).applyQuaternion(q).transformDirection(m);
  const b = new THREE.Vector3(1, 0, 0).applyQuaternion(q).transformDirection(m);
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q).transformDirection(m);
  return { a, b, n, R: R_EARTH + def.altitude };
}

const VERT = /* glsl */ `
attribute vec3 aRing;
uniform vec2 uResolution;
uniform vec3 uAxisBody;
uniform float uWidth;
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vRad;
varying float vWpx;
void main() {
  vRing = aRing;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  // the band's width on screen, per vertex (the same estimate as the far-field ribbon), so the
  // hand-over between the two is a clean edge rather than a per-pixel fwidth threshold
  float dist = max(length(w.xyz - cameraPosition), 1e-3);
  float pxPerKm = uResolution.y * 0.5 * projectionMatrix[1][1] / dist;
  float ca = dot((w.xyz - cameraPosition) / dist, normalize(mat3(modelMatrix) * uAxisBody));
  vWpx = uWidth * pxPerKm * (sqrt(max(1.0 - ca * ca, 0.0)) + 0.06);
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uTransmittanceLUT;
uniform vec3 uSunDir;
uniform float uSunE;
uniform float uTime;
uniform float uSimT;
uniform vec3 uAlbedo;
uniform vec3 uHabitatColor;
uniform vec3 uStreamColor;
uniform float uHub;
uniform float uSpeed;
uniform float uSeed;
uniform float uWidth;
uniform float uLen;
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vN;
varying float vWpx;
${SUNLIGHT_GLSL}
${NOISE_GLSL}
${FACADE_GLSL}

float aaStep(float e, float x, float w) { return smoothstep(e - w, e + w, x); }
// lamps every P km, w km long, filtered so a sub-pixel lamp keeps its energy spread over
// the pixel instead of popping on and off as the view moves
float aaLamp(float x, float P, float w) {
  float d = abs(fract(x / P + 0.5) - 0.5) * P;
  float fw = max(fwidth(x), 1e-5);
  return clamp(1.0 - d / max(w, fw), 0.0, 1.0) * min(1.0, w / fw);
}

void main() {
  float u = vRing.x, v = vRing.y, part = vRing.z;
  // below ~2 px across, the far-field ribbon takes over (no aliased dotted lines)
  if (vWpx < ((part > 1.5 && part < 2.5) ? 33.0 : 2.2)) discard;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 p = vWorld;
  vec3 rhat = normalize(p);
  vec3 V = normalize(cameraPosition - p);
  vec3 sunL = spaceSunlight(uTransmittanceLUT, p, uSunDir) * uSunE;
  float ndl = max(dot(N, uSunDir), 0.0);
  float dayBelow = max(dot(rhat, uSunDir), 0.0);
  vec3 earthshine = vec3(0.35, 0.5, 0.8) * dayBelow * uSunE * 0.09 * max(dot(N, -rhat), 0.0);
  float fu = max(fwidth(u), 1e-4);                 // km per pixel along the ring
  float fv = fwidth(v);                             // (derivatives taken here, in uniform flow)
  float fk = max(fu, fv * uWidth);                  // km per pixel, either way
  // every pattern reaches its exact average while its cell still spans ~3 px
  #define RDET(c) (1.0 - smoothstep((c) / 9.0, (c) / 3.0, fk))
  float detail = RDET(0.8);
  float hubPh = fract(u / uHub);
  float hub = 1.0 - smoothstep(0.012, 0.03 + fu / uHub, abs(hubPh - 0.5));
  float nightSide = 1.0 - smoothstep(-0.05, 0.1, dot(rhat, uSunDir));
  vec3 col = vec3(0.0), em = vec3(0.0);
  float topSide = dot(N, rhat);
  vec3 H = normalize(V + uSunDir);
  float av = abs(v);

#ifdef ROOF
  // ---- glass vault over the habitat: arched ribs every 2 km, mullions 1 km apart across it,
  //      clear glass that turns to a Fresnel sheen at grazing angles, a bounded sun glint ----
  float rib = 1.0 - fPulse(u, 2.0, 0.0, 1.93, fk);
  float mull = 1.0 - fPulse(v * uWidth + 1.0, 2.0, 0.0, 1.95, fk);
  float frame = max(rib, mull * 0.55);
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float Fg = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  float nh = max(dot(N, H), 0.0);
  vec3 glint = min(sunL * (pow(nh, 400.0) * 1.6 + pow(nh, 40.0) * 0.05) * Fg, sunL * 0.5);
  vec3 sky = vec3(0.02, 0.03, 0.05) * uSunE * 0.05 * Fg + earthshine * 0.3 * Fg;
  vec3 frameC = uAlbedo * 0.9 / 3.14159 * (sunL * ndl + earthshine * 2.0) + min(sunL * pow(nh, 60.0) * 0.3, sunL * 0.4);
  frameC += uHabitatColor * (0.02 + 0.06 * nightSide) * rib;      // the ribs' own faint lamps
  float glassA = 0.05 + 0.5 * Fg;
  // premultiplied: frame opaque, glass a thin tint that reflects the sky and the Sun
  gl_FragColor = vec4(mix(glint + sky, frameC, frame), mix(glassA, 1.0, frame));
  return;
#endif

  if (part < 0.5) {
    if (topSide > 0.0) {
      // ---- habitat floor seen from space: parks, forests, towns, lakes, a patchwork of farms
      //      under a glass roof on ribs every 2 km ----
      float zi = floor(u / 48.0);
      float zone = hash11(zi * 1.37 + uSeed);
      float zoneN = hash11((zi + 1.0) * 1.37 + uSeed);
      float blend = smoothstep(0.8, 1.0, fract(u / 48.0));
      float z = mix(zone, zoneN, blend);
      float dF = RDET(1.2), dS = RDET(0.12), dB = RDET(0.5), dL = RDET(0.35);
      vec3 park = vec3(0.05, 0.1, 0.035) * (0.8 + 0.4 * vnoise(vec2(u * 0.4, v * 20.0)));
      park = mix(park, vec3(0.025, 0.06, 0.02), smoothstep(0.55, 0.7, vnoise(vec2(u * 0.15, v * 7.0) + 3.0)) * 0.8);   // forest
      // farms: fields of different crops, ploughed in stripes
      vec2 fc = vec2(floor(u / 1.2), floor((v + 0.5) * 8.0));
      float crop = hash12(fc + uSeed);
      vec3 cropC = crop < 0.3 ? vec3(0.17, 0.16, 0.07) : crop < 0.55 ? vec3(0.09, 0.14, 0.05) : crop < 0.75 ? vec3(0.21, 0.18, 0.1) : vec3(0.12, 0.12, 0.06);
      vec3 farmAvg = vec3(0.145, 0.15, 0.07);
      float plough = fPulse(u + v * 3.0, 0.12, 0.0, 0.06, fk);
      vec3 farm = mix(farmAvg, cropC * (0.9 + 0.2 * mix(0.5, plough, dS)), dF);
      farm *= 1.0 - 0.2 * (1.0 - fPulse(u, 1.2, 0.0, 1.17, fk)) * dF;               // hedgerows between fields
      // towns: blocks between a grid of streets, a shade apart
      float blk = hash12(floor(vec2(u / 0.5, v * uWidth / 0.5)));
      float streets = 1.0 - fPulse(u, 0.5, 0.0, 0.44, fk) * fPulse(v * uWidth, 0.5, 0.0, 0.44, fk);
      vec3 town = mix(vec3(0.19, 0.18, 0.165), mix(vec3(0.14, 0.135, 0.13), vec3(0.24, 0.22, 0.2), blk), dB);
      town = mix(town, vec3(0.1, 0.1, 0.11), streets * 0.6);
      town = mix(town, park, 0.3 * mix(0.5, vnoise(vec2(u * 2.0, v * uWidth * 2.0)), dB));   // street trees and yards
      // the land use changes gradually from zone to zone (no hard-edged blocks)
      float wPark = 1.0 - smoothstep(0.34, 0.44, z), wTown = smoothstep(0.7, 0.8, z);
      vec3 alb = mix(mix(farm, park, wPark), town, wTown);
      float urban = mix(0.25, 1.0, wTown);
      // towns always line the walls, a river runs down the middle, lakes here and there
      float edge = smoothstep(0.34, 0.38, av);
      alb = mix(alb, town, edge);
      urban = max(urban, edge);
      float river = 1.0 - smoothstep(0.018, 0.028 + fv, abs(v + 0.02 * sin(u * 0.05)));
      float lake = smoothstep(0.72, 0.76, vnoise(vec2(u * 0.08, v * 6.0) + 11.0)) * (1.0 - edge) * (1.0 - wTown);
      float water = max(river, lake);
      alb = mix(alb, vec3(0.02, 0.04, 0.06), water);
      alb = mix(alb, uAlbedo * 1.25, hub);
      vec3 diff = alb / 3.14159 * sunL * ndl;
      // water: a bounded glint (the glass roof carries its own)
      float spec = pow(max(dot(N, H), 0.0), 80.0) * 0.45 + pow(max(dot(N, H), 0.0), 20.0) * 0.06;
      float F = 0.04 + 0.96 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
      col = diff + min(sunL * spec * F * (0.1 + 0.9 * water), sunL * 0.6);
      col += vec3(0.02, 0.03, 0.05) * F * uSunE * 0.05;
      // lights
      float cell = hash12(floor(vec2(u / 0.35, v * uWidth / 0.35)));
      float lit = mix(0.24, step(0.55, cell) * (0.5 + cell), dL);
      em += uHabitatColor * urban * lit * (0.08 + 0.22 * nightSide) * (1.0 - water);
      em += uHabitatColor * hub * 0.35;
    } else {
      // ---- underside, facing the Earth: structure, radiators, lights ----
      float dP = RDET(2.4), dR = RDET(6.0), dL = RDET(0.8);
      float panel = hash12(floor(vec2(u / 2.4, v * 8.0)));
      vec3 alb = uAlbedo * (0.7 + 0.35 * mix(0.5, panel, dP));
      float rib = 1.0 - fPulse(u, 6.0, 0.0, 5.6, fk);
      alb *= 1.0 - 0.3 * rib;
      float trus = 1.0 - smoothstep(0.02, 0.05 + fv, abs(av - 0.25));
      alb *= 1.0 - 0.25 * trus;
      col = alb / 3.14159 * (sunL * ndl + earthshine * 3.0);
      col += min(sunL * pow(max(dot(N, H), 0.0), 60.0) * 0.3, sunL * 0.5);
      float cell = hash12(floor(vec2(u / 0.8, v * 24.0)));
      float lit = mix(0.24, step(0.62, cell) * (0.6 + cell), dL);
      float band = 1.0 - smoothstep(0.3, 0.34, av);
      em += uHabitatColor * band * lit * (0.05 + 0.2 * nightSide);
      em += uHabitatColor * hub * 0.5;
      // soft pulses drifting along the keel (their mean once they are under a few pixels)
      float keel = 1.0 - smoothstep(0.004, 0.012 + fv, av);
      float kp = fract(u / 90.0 - uTime * 0.04 * uSpeed) - 0.5;
      float kpulse = mix(0.1, exp(-kp * kp * 300.0), 1.0 - smoothstep(0.6, 1.8, fu));
      em += uStreamColor * keel * (0.08 + 1.2 * kpulse);
    }
  } else if (part < 1.5) {
    // ---- retaining walls ----
    vec3 alb = uAlbedo * 1.1;
    float rib = 1.0 - fPulse(u, 3.0, 0.0, 2.76, fk);
    alb *= 1.0 - 0.3 * rib;
    col = alb / 3.14159 * (sunL * ndl + earthshine * 2.0);
    col += min(sunL * pow(max(dot(N, H), 0.0), 70.0) * 0.5, sunL * 0.6);
    float stripe = 1.0 - smoothstep(0.0, 0.06, abs(v - 0.9));
    em += uHabitatColor * stripe * 0.25;
    // small marker lamps every 25 km, filtered so they never shrink below their energy
    float md = abs(fract(u / 25.0 + 0.5) - 0.5) * 25.0;
    float mw = 0.12;
    float marker = clamp(1.0 - md / max(mw, fu), 0.0, 1.0) * min(1.0, mw / fu);
    em += vec3(1.0, 0.45, 0.3) * marker * stripe * (0.75 + 0.25 * sin(uTime * 0.8 + floor(u / 25.0) * 1.7)) * 1.4;
  } else {
    // ---- rotor tubes: the mass stream that holds the ring up ----
    vec3 alb = uAlbedo * 0.6;
    col = alb / 3.14159 * (sunL * ndl + earthshine * 2.0);
    float rp = fract(u / 37.0 - uTime * 0.25 * uSpeed * sign(v)) - 0.5;
    float pulse = mix(0.13, exp(-rp * rp * 180.0), 1.0 - smoothstep(0.5, 1.5, fu));
    float rim = pow(max(1.0 - abs(dot(N, V)), 0.0), 2.0);
    em += uStreamColor * (0.12 + 1.2 * pulse + 0.3 * rim);
  }
  gl_FragColor = vec4(col + em, 1.0);
}
`;

export function buildRing(def, basis, segs, roof = false) {
  const { a, b, n, R } = basis;
  const w = def.width;
  const hw = w / 2;
  const wall = Math.max(1.2, w * 0.07);
  const tubeR = w * 0.035;
  const wt = Math.max(0.15, w * 0.012);
  // profile: [s (axial km), dr (radial km), ns, nr (normal in s/r plane), v, part]
  const floor = [];
  const NF = 16;
  for (let i = 0; i <= NF; i++) {
    const t = i / NF - 0.5;
    floor.push([t * (w + 2 * wt), -0.004 * w * (1 - 4 * t * t), 0, 1, t, 0]);
  }
  const floorBack = floor.map(([s,dr,,,v,part]) => [s,dr-0.4,0,-1,v,part]);
  const floorEdges = [-1,1].map(sd => [[sd*(hw+wt),0,sd,0,sd*.5,0],[sd*(hw+wt),-0.4,sd,0,sd*.5,0]]);
  // retaining walls as solid slabs: inner face, top, outer face and foot (each its own strip
  // so the corners stay sharp); a single sheet showed the walls paper-thin edge-on
  const wallL = [[-hw, -0.06, 1, 0, 0.0, 1], [-hw, wall, 1, 0, 1.0, 1]];
  const wallR = [[hw, wall, -1, 0, 1.0, 1], [hw, -0.06, -1, 0, 0.0, 1]];
  const slabs = [];
  for (const sd of [-1, 1]) {
    const si = sd * hw, so = sd * (hw + wt);
    slabs.push([[si, wall, 0, 1, 1.0, 1], [so, wall, 0, 1, 1.0, 1]]);
    slabs.push([[so, wall, sd, 0, 1.0, 1], [so, -0.06, sd, 0, 0.0, 1]]);
    slabs.push([[so, -0.06, 0, -1, 0.0, 1], [si, -0.06, 0, -1, 0.0, 1]]);
  }
  // glass roof: a flat-topped vault from wall top to wall top (clear of the port stations'
  // masts), normals from the section's own tangent
  const roofP = [];
  const NR = 24, rise = w * 0.085;
  const rf = (t) => wall + rise * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(2 * t), 4)));
  for (let i = 0; i <= NR; i++) {
    const t = i / NR - 0.5;
    const e = 0.5 / NR;
    const ta = Math.max(-0.5, t - e), tb = Math.min(0.5, t + e);
    let ds = (tb - ta) * w, dd = rf(tb) - rf(ta);
    const l = Math.hypot(ds, dd) || 1;
    roofP.push([t * w, rf(t), -dd / l, ds / l, t, 3]);
  }
  const tubes = [];
  for (const side of [-1, 1]) {
    const tube = [];
    for (let k = 0; k <= 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const sx = side * (hw + tubeR * 0.6) + Math.cos(ang) * tubeR;
      tube.push([sx, -tubeR * 1.4 + Math.sin(ang) * tubeR, Math.cos(ang), Math.sin(ang), sx / w, 2]);
    }
    tubes.push(tube);
  }
  const profiles = roof ? [roofP] : [floor, floorBack, ...floorEdges, wallL, wallR, ...slabs, ...tubes];
  const angles = Array.from({length:segs+1},(_,i)=>i/segs*Math.PI*2);
  const jDir = bodyDir(0,MERIDIAN_LON);
  const junctionAngle = ((Math.atan2(jDir.dot(b),jDir.dot(a)) % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
  if (roof && def.name === 'Halo') {
    for (const x of [-2.52,2.52]) angles.push(junctionAngle+x/R);
    angles.sort((x,y)=>x-y); segs=angles.length-1;
  }
  const pos = [], nor = [], ring = [], idx = [];
  const P = new THREE.Vector3(), rad = new THREE.Vector3(), tan = new THREE.Vector3();
  for (const prof of profiles) {
    const base = pos.length / 3;
    const M = prof.length;
    for (let j = 0; j <= segs; j++) {
      const th = angles[j];
      rad.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th));
      for (const [s, dr, ns, nr, v, part] of prof) {
        P.copy(rad).multiplyScalar(R + dr).addScaledVector(n, s);
        pos.push(P.x, P.y, P.z);
        tan.copy(rad).multiplyScalar(nr).addScaledVector(n, ns).normalize();
        nor.push(tan.x, tan.y, tan.z);
        ring.push(th * R, v, part);
      }
    }
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < M - 1; i++) {
        if (roof && def.name === 'Halo' && Math.abs(((angles[j]+angles[j+1])/2-junctionAngle)*R)<2.52 && Math.abs((prof[i][0]+prof[i+1][0])/2)<2.67) continue;
        const i0 = base + j * M + i, i1 = i0 + M, i2 = i0 + 1, i3 = i1 + 1;
        idx.push(i0, i1, i2, i2, i1, i3);
      }
    }
  }
  // make every triangle wind counter-clockwise when seen from its normal side
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let k = 0; k < idx.length; k += 3) {
    const [i0, i1, i2] = [idx[k], idx[k + 1], idx[k + 2]];
    vA.fromArray(pos, i0 * 3); vB.fromArray(pos, i1 * 3); vC.fromArray(pos, i2 * 3);
    vB.sub(vA); vC.sub(vA);
    nn.crossVectors(vB, vC);
    const dn = nn.x * (nor[i0 * 3] + nor[i1 * 3]) + nn.y * (nor[i0 * 3 + 1] + nor[i1 * 3 + 1]) + nn.z * (nor[i0 * 3 + 2] + nor[i1 * 3 + 2]);
    if (dn < 0) { idx[k + 1] = i2; idx[k + 2] = i1; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R + wall + rise + 5);
  return g;
}

const FAR_FRAG = /* glsl */ `
uniform vec3 uAlb;
uniform vec3 uHab;
uniform vec3 uStream;
void main() {
  vec3 sunL = spaceSunlight(uTransmittanceLUT, vWorld, uSunDir) * uSunE;
  vec3 rhat = normalize(vWorld);
  float night = 1.0 - smoothstep(-0.05, 0.1, dot(rhat, uSunDir));
  vec3 V = normalize(cameraPosition - vWorld);
  float face = 0.3 + 0.5 * abs(dot(V, rhat));
  vec3 col = uAlb * 0.3 * sunL * face + uHab * (0.05 + 0.2 * night) + uStream * 0.06;
  float fade = 1.0 - smoothstep(1.6, 3.2, vPx);
  gl_FragColor = vec4(col * vCoverage * fade, 0.0);
}
`;

const TETHER_FRAG = /* glsl */ `
uniform vec3 uColor;
float aaBand(float x, float P, float w) {
  // lamps every P km, w km long: a filtered band whose energy stays constant once it is
  // thinner than a pixel, so beacons never pop in and out as the view moves
  float d = abs(fract(x / P + 0.5) - 0.5) * P;
  float fw = max(fwidth(x), 1e-5);
  float W = max(w, fw);
  return clamp(1.0 - d / W, 0.0, 1.0) * min(1.0, w / fw);
}
void main() {
  vec3 sunL = spaceSunlight(uTransmittanceLUT, vWorld, uSunDir) * uSunE;
  float alt = vData.x;
  float x = clamp(vAcross, -1.0, 1.0);
  float cyl = sqrt(max(1.0 - x * x, 0.0));
  float spec = exp(-((x - 0.35) * 5.0) * ((x - 0.35) * 5.0));
  vec3 col = vec3(0.55, 0.58, 0.62) * sunL * (0.03 + 0.04 * cyl + 0.035 * spec) + vec3(0.02, 0.03, 0.05) * (0.5 + 0.5 * cyl);
  float beacon = aaBand(alt, 40.0, 0.12) * (0.75 + 0.25 * sin(uTime * 1.5 + alt));
  // climber pulses run on real time (in sim time they raced up the cable at warp)
  float climb = aaBand(alt + uTime * 0.6 - vData.y * 28.0, 90.0, 0.4);
  col += uColor * beacon * 1.2 + vec3(0.8, 0.9, 1.0) * climb * 3.0 * cyl;
  float fade = smoothstep(0.0, 12.0, alt) * (1.0 - smoothstep(560.0, 618.0, alt) * 0.5);
  gl_FragColor = vec4(col * vCoverage * fade, 0.0);
}
`;

export class Rings {
  constructor(space, q) {
    this.space = space;
    this.group = new THREE.Group();
    this.meshes = [];
    this.roofs = [];
    this.far = [];
    this.defs = RINGS;
    this.bases = RINGS.map(ringBasis);
    RINGS.forEach((def, i) => {
      const basis = this.bases[i];
      const segs = Math.round((def.name === 'Halo' ? 4096 : 2560) * q.ringSegs);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          uTransmittanceLUT: U.uTransmittanceLUT, uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunE: U.uSunIlluminance,
          uTime: { value: 0 }, uSimT: { value: 0 },
          uAlbedo: { value: new THREE.Color(...def.albedo) },
          uHabitatColor: { value: new THREE.Color(...def.habitat) },
          uStreamColor: { value: new THREE.Color(...def.stream) },
          uHub: { value: def.hub }, uSpeed: { value: def.speed }, uSeed: { value: i * 17.3 + 3.1 },
          uWidth: { value: def.width }, uLen: { value: basis.R * Math.PI * 2 },
          uResolution: { value: new THREE.Vector2(1920, 1080) }, uAxisBody: { value: basis.n.clone() },
        },
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(buildRing(def, basis, segs), mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.userData.def = def;
      this.meshes.push(mesh);
      this.group.add(mesh);
      // the glass vault: its own premultiplied, depth-tested (not depth-writing) mesh
      // (uniform objects shared with the deck, so update() and setSize() drive both)
      const roofMat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...mat.uniforms }, defines: { ROOF: 1 },
        side: THREE.DoubleSide, transparent: true, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const roofMesh = new THREE.Mesh(buildRing(def, basis, Math.round(segs / 2), true), roofMat);
      roofMesh.frustumCulled = false;
      roofMesh.renderOrder = 3;
      this.roofs.push(roofMesh);
      this.group.add(roofMesh);
      // far-field ribbon (smooth line when the band is thinner than a couple of pixels)
      const pts = [], along = [];
      const NP = 1440;
      for (let k = 0; k <= NP; k++) {
        const th = (k / NP) * Math.PI * 2;
        pts.push(basis.a.clone().multiplyScalar(Math.cos(th)).addScaledVector(basis.b, Math.sin(th)).multiplyScalar(basis.R));
        along.push(th * basis.R);
      }
      const fm = createRibbonMaterial({ widthKm: def.width, minPx: 1.0, frag: FAR_FRAG, uniforms: {
        uAlb: { value: new THREE.Color(...def.albedo) }, uHab: { value: new THREE.Color(...def.habitat) }, uStream: { value: new THREE.Color(...def.stream) },
      } });
      const far = new THREE.Mesh(buildRibbonGeometry([{ pts, along, id: i }]), fm);
      far.frustumCulled = false;
      far.renderOrder = 11;
      far.userData.axis = basis.n.clone();
      this.far.push(far);
      this.group.add(far);
    });
    // tethers hanging from the Halo to the equatorial ports (Meridian's main tether is separate)
    const lines = [];
    const halo = this.bases[0];
    let id = 0;
    for (const port of HALO_PORTS) {
      if (port.name === 'Meridian') continue;
      const lon = THREE.MathUtils.degToRad(port.lon);
      for (const off of [-9, 0, 9]) {
        const dir = bodyDir(0, lon + off / (R_EARTH + 620));
        const pts = [], along = [];
        for (let h = 0; h <= 620; h += 10) { pts.push(dir.clone().multiplyScalar(R_EARTH + h)); along.push(h); }
        lines.push({ pts, along, id: id++ });
      }
    }
    this.tetherMat = createRibbonMaterial({ widthKm: 0.02, minPx: 1.1, frag: TETHER_FRAG, uniforms: { uColor: { value: new THREE.Color(1.0, 0.75, 0.45) } } });
    this.tethers = new THREE.Mesh(buildRibbonGeometry(lines), this.tetherMat);
    this.tethers.frustumCulled = false;
    this.tethers.renderOrder = 12;
    this.group.add(this.tethers);
  }

  setSize(w, h) {
    this.tetherMat.uniforms.uResolution.value.set(w, h);
    for (const m of this.meshes) m.material.uniforms.uResolution.value.set(w, h);
    for (const f of this.far) f.material.uniforms.uResolution.value.set(w, h);
  }

  update(sim, realTime) {
    for (const m of this.meshes) {
      const u = m.material.uniforms;
      u.uSunDir.value.copy(sim.sunDir);
      u.uTime.value = realTime;
      u.uSimT.value = sim.t % 1e6;
    }
    const tu = this.tetherMat.uniforms;
    tu.uSunDir.value.copy(sim.sunDir); tu.uTime.value = realTime; tu.uSimT.value = sim.t % 1e6;
    for (const f of this.far) {
      const fu = f.material.uniforms;
      fu.uSunDir.value.copy(sim.sunDir); fu.uTime.value = realTime;
      fu.uBandAxis.value.copy(f.userData.axis).applyQuaternion(sim.earthQuat);
    }
  }

  /** Uniform data for the Earth shader's ring shadows (inertial axes). */
  shadowUniforms(sim, outN, outW) {
    this.bases.forEach((b, i) => {
      const n = b.n.clone().applyQuaternion(sim.earthQuat);
      outN[i].set(n.x, n.y, n.z, b.R);
      outW[i].set(this.defs[i].width / 2, 0.92, 0, 0);
    });
  }
}
