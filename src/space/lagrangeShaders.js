import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { COL } from './lagrangeColony.js';

// The Lagrange colonies' two special surfaces.
//
// WINDOW: the glazing of an Island-Three cylinder. Each fragment casts the view ray on into
// the cylinder (rotor frame, metres) and shades what it meets: the far land strip (fields
// in a patchwork, woods, a river winding the length of the valley, lakes, towns on a street
// grid and a lit road), a cloud deck 1.5 km up, or an end cap's terraced city; the air
// between is hazed blue by day. Daylight is the mirrors' (uDay); at night the towns and the
// road glow. Over it all the glazing's panes and mullions, and a Fresnel glint of the Sun.
//
// MIRROR: aluminised film in gores on a sheet 32 km long; black-sky reflection with the Sun's
// glint and a broad sheen, a dark structural back.
//
// Both are opaque, lit in view space (no world-space km in the shader), and read only their
// own local coordinates, so they are exact at 400,000 km from the origin.

const WIN_VERT = /* glsl */ `
attribute vec3 aWin;
varying vec3 vLocal;
varying vec3 vWin;
varying vec3 vView;
varying vec3 vN;
void main() {
  vLocal = position;
  vWin = aWin;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

const WIN_FRAG = /* glsl */ `
uniform vec3 uCam;          // camera, rotor frame (m)
uniform vec3 uSunView;      // sun direction, view space
uniform float uSunE;
uniform float uDay;         // 0 night .. 1 full mirror day
uniform float uTime;
uniform float uSeed;
varying vec3 vLocal;
varying vec3 vWin;
varying vec3 vView;
varying vec3 vN;
${NOISE_GLSL}
const float R = ${COL.R.toFixed(1)};
const float HL = ${COL.HL.toFixed(1)};
const float CAPZ = ${(COL.HL + COL.CAP * 0.7).toFixed(1)};
const float SECT = 2.0943951;       // 120 degrees: one land strip and one window
const float HALF = 0.5235988;       // 30 degrees
float lineAA(float x, float p, float w, float fw) { float d = abs(fract(x / p + 0.5) - 0.5) * p; return clamp(1.0 - d / max(w, fw), 0.0, 1.0) * min(1.0, w / fw); }

// the valley floor at (u across the strip, v along it), metres; returns albedo, writes lights
vec3 landscape(vec2 q, float strip, float px, out vec3 lights) {
  float sd = strip * 17.3 + uSeed;
  float det = 1.0 - smoothstep(20.0, 80.0, px);
  // fields in a patchwork, rotated a little per parish
  vec2 cell = floor(q / vec2(170.0, 260.0));
  float h = hash12(cell + sd);
  vec3 field = mix(vec3(0.09, 0.16, 0.05), vec3(0.25, 0.24, 0.08), h);
  field = mix(field, vec3(0.2, 0.13, 0.07), step(0.82, h));                  // ploughed
  float hedge = max(lineAA(q.x, 170.0, 5.0, px), lineAA(q.y, 260.0, 5.0, px)) * det;
  vec3 alb = mix(mix(vec3(0.14, 0.18, 0.07), field, det), vec3(0.05, 0.09, 0.03), hedge * 0.7);
  // woods on the rising ground toward the windows, and in clumps
  float n = vnoise(q * 0.0022 + sd) * 0.65 + vnoise(q * 0.009 + sd * 3.0) * 0.35;
  float edge = smoothstep(1300.0, 1950.0, abs(q.x));
  float wood = smoothstep(0.58, 0.64, n + edge * 0.35);
  alb = mix(alb, vec3(0.03, 0.07, 0.025), wood);
  // the river, winding the length of the valley, and its lakes
  float rc = 520.0 * sin(q.y / 2300.0 + sd) + 210.0 * sin(q.y / 830.0 + sd * 2.0);
  float river = 1.0 - smoothstep(30.0, 30.0 + max(px, 8.0), abs(q.x - rc));
  float lake = smoothstep(0.72, 0.75, vnoise(q * 0.0011 + sd * 5.0)) * (1.0 - edge);
  float water = max(river, lake);
  alb = mix(alb, vec3(0.02, 0.05, 0.07), water);
  // towns every few kilometres, alternating banks: roofs on a street grid
  float tv = floor(q.y / 3600.0);
  float side = hash12(vec2(tv, sd)) > 0.5 ? 1.0 : -1.0;
  vec2 tc = vec2(rc + side * (380.0 + 260.0 * hash12(vec2(tv, sd + 3.0))), (tv + 0.5) * 3600.0);
  float tr = 380.0 + 300.0 * hash12(vec2(tv + 9.0, sd));
  float town = 1.0 - smoothstep(tr * 0.7, tr, length(q - tc));
  vec2 blk = floor(q / 45.0);
  float street = max(lineAA(q.x, 45.0, 4.0, px), lineAA(q.y, 45.0, 4.0, px)) * det;
  vec3 roofs = mix(vec3(0.42, 0.3, 0.24), vec3(0.62, 0.6, 0.55), hash12(blk + 1.7));
  alb = mix(alb, mix(mix(vec3(0.35, 0.32, 0.28), roofs, det), vec3(0.3, 0.29, 0.27), street), town * (1.0 - water));
  // the valley road and its lamps
  float road = 1.0 - smoothstep(9.0, 9.0 + max(px, 6.0), abs(q.x - rc * 0.4 - side * 900.0));
  alb = mix(alb, vec3(0.25, 0.24, 0.22), road * 0.8);
  // night: windows in the towns (a fraction lit, their mean kept at range), the road's lamps
  float win = mix(0.35, step(0.62, hash12(floor(q / 14.0) + sd)), det);
  lights = vec3(1.0, 0.72, 0.42) * town * win * (1.0 - street * 0.5) * 1.4;
  lights += vec3(1.0, 0.78, 0.5) * street * town * 0.8;
  lights += vec3(1.0, 0.66, 0.34) * road * mix(0.5, step(0.5, fract(q.y / 60.0)), det) * 0.9;
  float farm = step(0.985, hash12(floor(q / 90.0) + sd * 7.0)) * (1.0 - town) * (1.0 - water) * det;
  lights += vec3(1.0, 0.8, 0.55) * farm * 1.5 + vec3(1.0, 0.8, 0.55) * 0.012 * (1.0 - det);
  // sky-glint on the water by day
  lights += vec3(0.5, 0.62, 0.8) * water * uDay * 0.25;
  return alb;
}

void main() {
  vec3 P = vLocal;
  vec2 f = vWin.xy;
  vec2 fw = max(fwidth(f), vec2(1e-3));
  float px = max(fw.x, fw.y);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(-vView);
  vec3 D = normalize(P - uCam);
  float a2 = max(dot(D.xy, D.xy), 1e-6);
  float b = dot(P.xy, D.xy);
  // exit through the far wall of the cylinder
  float tWall = max(-2.0 * b / a2, 0.0);
  float tEnd = abs(D.z) > 1e-5 ? ((D.z > 0.0 ? HL : -HL) - P.z) / D.z : 1e9;
  float t = min(tWall, max(tEnd, 0.0));
  vec3 H = P + D * t;
  // ray footprint grows with distance: a coarse pixel size for the interior's filtering
  float pxIn = px * (1.0 + t / max(length(P - uCam), 1.0));
  vec3 lights = vec3(0.0);
  vec3 alb;
  float isLand = 0.0;
  if (tEnd < tWall) {
    // an end cap: terraced city in concentric rings
    float rr = length(H.xy);
    float ring = fract(rr / 420.0);
    alb = mix(vec3(0.34, 0.33, 0.3), vec3(0.12, 0.2, 0.08), step(0.6, ring));
    float lit = mix(0.4, step(0.55, hash12(floor(vec2(atan(H.y, H.x) * rr / 20.0, rr / 14.0)))), 1.0 - smoothstep(10.0, 40.0, pxIn));
    lights = vec3(1.0, 0.74, 0.46) * lit * (1.0 - step(0.6, ring)) * 1.3;
    isLand = 1.0;
  } else {
    float ang = atan(H.y, H.x);
    float m = mod(ang + HALF, SECT) - HALF;             // offset from the nearest land strip's centre
    float strip = floor((ang + HALF) / SECT);
    if (abs(m) < HALF - 0.018) {
      alb = landscape(vec2(m * R, H.z), strip, pxIn, lights);
      isLand = 1.0;
    } else {
      // looking out through the far glazing: black sky, the far mirror's grey back
      alb = vec3(0.0);
      lights = vec3(0.004, 0.005, 0.008);
    }
  }
  vec3 day = vec3(1.0, 0.96, 0.9) * uSunE * 0.11 * uDay;           // the mirrors' daylight, through glass
  vec3 col = alb * (day + vec3(0.004, 0.006, 0.012)) + lights * (1.0 - 0.85 * uDay) * isLand;
  // clouds on a deck 1.5 km over the far land
  float rc = R - 1500.0;
  float c2 = dot(P.xy, P.xy) - rc * rc;
  float disc = b * b - a2 * c2;
  if (disc > 0.0 && isLand > 0.5) {
    float tc = (-b + sqrt(disc)) / a2;
    if (tc > 0.0 && tc < t) {
      vec3 C = P + D * tc;
      vec2 cq = vec2(atan(C.y, C.x) * rc, C.z);
      float cn = vnoise(cq * 0.0013 + uSeed + uTime * 0.002) * 0.6 + vnoise(cq * 0.005 - uTime * 0.003) * 0.4;
      float cov = smoothstep(0.56, 0.72, cn) * 0.85;
      vec3 cc = vec3(0.95, 0.95, 0.97) * uSunE * 0.13 * uDay + vec3(0.04, 0.03, 0.025) * (1.0 - uDay);
      col = mix(col, cc, cov);
    }
  }
  // air: blue haze by day, a faint violet at night
  float haze = 1.0 - exp(-t / 16000.0);
  col = mix(col, mix(vec3(0.004, 0.005, 0.012), vec3(0.42, 0.58, 0.82) * uSunE * 0.05, uDay), haze * 0.8);
  // the glazing: panes 50 x 60 m, mullions, heavier frames each 400 m; mean kept at range
  float det = 1.0 - smoothstep(1.2, 4.0, px);
  float mull = max(lineAA(f.x, 50.0, 1.2, fw.x), lineAA(f.y, 60.0, 1.4, fw.y));
  float frame = max(lineAA(f.x, 400.0, 5.0, fw.x), lineAA(f.y, 400.0, 6.0, fw.y));
  float fr = max(mix(0.05, mull, det), frame);
  float cosV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
  vec3 R3 = reflect(-V, N);
  float sd = max(dot(R3, uSunView), 0.0);
  vec3 glint = vec3(1.0, 0.96, 0.9) * uSunE * (pow(sd, 1200.0) * 40.0 + pow(sd, 40.0) * 0.08) * F;
  vec3 frameCol = vec3(0.1, 0.09, 0.085) * (0.2 + 0.8 * uDay) + vec3(0.02);
  col = mix(col * (1.0 - F) * vec3(0.9, 0.95, 1.0), frameCol, fr) + glint * (1.0 - fr);
  gl_FragColor = vec4(col, 1.0);
}
`;

const MIR_VERT = /* glsl */ `
attribute vec2 aMir;
varying vec2 vMir;
varying vec3 vView;
varying vec3 vN;
void main() {
  vMir = aMir;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

const MIR_FRAG = /* glsl */ `
uniform vec3 uSunView;
uniform float uSunE;
uniform vec3 uCylC;         // the cylinder's centre, view space (km)
uniform vec3 uCylA;         // its axis, view space
uniform vec3 uCylX;         // its rotor frame's x, view space (the land strips' zero)
uniform float uCylR;        // radius (km)
uniform float uCylHL;       // half length (km)
uniform float uDay;
varying vec2 vMir;
varying vec3 vView;
varying vec3 vN;
${NOISE_GLSL}
float lineAA(float x, float p, float w, float fw) { float d = abs(fract(x / p + 0.5) - 0.5) * p; return clamp(1.0 - d / max(w, fw), 0.0, 1.0) * min(1.0, w / fw); }
void main() {
  vec2 f = vMir;
  vec2 fw = max(fwidth(f), vec2(1e-3));
  float px = max(fw.x, fw.y);
  vec3 N = normalize(vN);
  float front = gl_FrontFacing ? 1.0 : 0.0;
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(-vView);
  vec3 L = uSunView;
  float ndl = max(dot(N, L), 0.0);
  // film gores 140 m wide, seams every 400 m along, each gore a shade off flat
  float det = 1.0 - smoothstep(2.0, 8.0, px);
  float seam = max(lineAA(f.x, 140.0, 0.8, fw.x), lineAA(f.y, 400.0, 1.2, fw.y));
  float g = hash12(floor(f / vec2(140.0, 400.0)));
  vec3 R3 = reflect(-V, N);
  float sd = max(dot(R3, L), 0.0);
  float rough = mix(0.5, g, det);
  vec3 sun = vec3(1.0, 0.97, 0.92) * uSunE;
  vec3 spec = sun * (pow(sd, 2000.0) * 60.0 + pow(sd, 60.0 + 200.0 * rough) * 0.35 + pow(sd, 8.0) * 0.012);
  // what the film shows besides the Sun: its own cylinder. Cast the reflected ray at the
  // cylinder (view space, km): where it meets a window strip the valley's light comes back
  // (daylight thrown in by the mirrors, or the towns at night), where it meets a land strip
  // the dim shielding hull; elsewhere the black sky. Closed form, no loops or derivatives.
  vec3 P0 = vView - uCylC;
  vec3 dP = P0 - dot(P0, uCylA) * uCylA;
  vec3 dR = R3 - dot(R3, uCylA) * uCylA;
  float qa = max(dot(dR, dR), 1e-8), qb = dot(dP, dR), qc = dot(dP, dP) - uCylR * uCylR;
  float qd = qb * qb - qa * qc;
  vec3 seen = vec3(0.0);
  if (qd > 0.0) {
    float tHit = (-qb - sqrt(qd)) / qa;
    vec3 H = P0 + R3 * tHit;
    float ax = dot(H, uCylA);
    if (tHit > 0.0 && abs(ax) < uCylHL) {
      vec3 radial = H - ax * uCylA;
      vec3 Y = cross(uCylA, uCylX);
      float ang = atan(dot(radial, Y), dot(radial, uCylX));
      float m = mod(ang + 0.5235988, 2.0943951) - 0.5235988;          // from the nearest land strip's centre
      float win = smoothstep(0.50, 0.53, abs(m));
      vec3 valley = mix(vec3(0.020, 0.032, 0.016) * uSunE * 0.11, vec3(0.9, 0.62, 0.36) * 0.018, 1.0 - uDay);
      valley += vec3(0.30, 0.42, 0.56) * uSunE * 0.006 * uDay;     // the lit air over the land
      vec3 hull = vec3(0.012, 0.012, 0.013);
      seen = mix(hull, valley, win) * 0.88;
    }
  }
  vec3 film = vec3(0.012, 0.014, 0.02) + seen + spec * (1.0 - 0.6 * mix(0.05, seam, det)) + vec3(0.05) * sun * ndl * 0.003;
  vec3 back = vec3(0.07, 0.068, 0.065) * sun * ndl / 3.14159 + vec3(0.006);
  back *= 1.0 - 0.3 * mix(0.1, max(lineAA(f.x, 700.0, 6.0, fw.x), lineAA(f.y, 1600.0, 8.0, fw.y)), det);
  gl_FragColor = vec4(mix(back, film, front), 1.0);
}
`;

const _m = new THREE.Matrix4(), _mv = new THREE.Matrix4();

export function createWindowMaterial(seed = 0) {
  return new THREE.ShaderMaterial({
    vertexShader: WIN_VERT, fragmentShader: WIN_FRAG,
    uniforms: {
      uCam: { value: new THREE.Vector3() }, uSunView: { value: new THREE.Vector3(0, 0, 1) }, uSunE: U.uSunIlluminance,
      uDay: { value: 1 }, uTime: { value: 0 }, uSeed: { value: seed },
    },
    side: THREE.FrontSide,
  });
}

export function createMirrorMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: MIR_VERT, fragmentShader: MIR_FRAG,
    uniforms: {
      uSunView: { value: new THREE.Vector3(0, 0, 1) }, uSunE: U.uSunIlluminance,
      uCylC: { value: new THREE.Vector3() }, uCylA: { value: new THREE.Vector3(0, 0, 1) }, uCylX: { value: new THREE.Vector3(1, 0, 0) },
      uCylR: { value: COL.R * 0.001 }, uCylHL: { value: COL.HL * 0.001 }, uDay: { value: 1 },
    },
    side: THREE.DoubleSide,
  });
}

/**
 * Hook a window mesh so, as it draws, its material learns the camera in the mesh's own frame
 * (double precision on the CPU) and the Sun in view space. No allocation per frame.
 */
export function bindWindow(mesh, sunDir) {
  const u = mesh.material.uniforms;
  mesh.onBeforeRender = (r, s, cam) => {
    _m.copy(mesh.matrixWorld).invert();
    u.uCam.value.copy(cam.position).applyMatrix4(_m);
    u.uSunView.value.copy(sunDir).transformDirection(cam.matrixWorldInverse);
    mesh.material.uniformsNeedUpdate = true;
  };
}

/**
 * Hook a mirror sheet: the Sun in view space, and (when given the rotor it hangs from and the
 * pair's day uniform) the cylinder it faces, in view space, for the film's reflection of it.
 * The material is shared, so each sheet sets its own cylinder as it draws. No allocation.
 */
export function bindMirror(mesh, sunDir, rotor = null, day = null) {
  const u = mesh.material.uniforms;
  mesh.onBeforeRender = (r, s, cam) => {
    u.uSunView.value.copy(sunDir).transformDirection(cam.matrixWorldInverse);
    if (rotor) {
      _mv.multiplyMatrices(cam.matrixWorldInverse, rotor.matrixWorld);
      u.uCylC.value.setFromMatrixPosition(_mv);
      u.uCylA.value.set(0, 0, 1).transformDirection(_mv);
      u.uCylX.value.set(1, 0, 0).transformDirection(_mv);
      u.uCylR.value = COL.R * 0.001; u.uCylHL.value = COL.HL * 0.001;
      u.uDay.value = day ? day.value : 1;
    } else u.uCylR.value = 0;
    mesh.material.uniformsNeedUpdate = true;
  };
}

export const LAGRANGE_SHADERS = { WIN_VERT, WIN_FRAG, MIR_VERT, MIR_FRAG };
