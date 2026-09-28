import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { U } from '../core/uniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { SUNLIGHT_GLSL } from './lines.js';
import { FACADE_GLSL } from '../world/materials.js';

// Shared material for stations and ships (km units). Surface kind per vertex:
// 0 plating, 1 habitat with windows, 2 solar / radiator panels, 3 dark truss,
// 4 emissive accent, 5 gold foil, 6 mirror (collector dishes), 7 rock, 8 enclosed garden

export const KIND = { PLATE: 0, HAB: 1, PANEL: 2, TRUSS: 3, GLOW: 4, GOLD: 5, MIRROR: 6, ROCK: 7, GARDEN: 8 };
// The 2.5 km garden pods carry an integer number of panes and courts around their longitude.
export const GARDEN_SURFACE = { circumference:7920, meridian:3280, pane:20, courtU:120, courtV:80 };

const VERT = /* glsl */ `
attribute float aKind;
attribute vec2 aSurface;
varying vec2 vSurface;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vLN;
varying float vKind;
void main() {
  vKind = aKind;
  vSurface = aSurface;
  vLocal = position;
  vLN = normal;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  // camera-relative projection (modelViewMatrix is composed in double precision on the
  // CPU): world coordinates 42,000 km out, in float32, jittered vertices by metres each
  // frame and made coincident parts z-fight as the Harbour turned
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uTransmittanceLUT;
uniform vec3 uSunDir;
uniform float uSunE;
uniform float uTime;
uniform vec3 uEarthPos;
uniform vec3 uPointPos;        // extra light (e.g. the Hearth's disc)
uniform vec3 uPointColor;
uniform float uPattern;        // km per window cell
uniform vec3 uAccent;
uniform float uBehindMask;     // 1: fade where the Hearth's image says the disc is in front
uniform sampler2D uHearthTex;
uniform vec2 uHearthRes;
uniform float uHearthDepth;
varying vec2 vSurface;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vLN;
varying float vKind;
${SUNLIGHT_GLSL}
${NOISE_GLSL}
${FACADE_GLSL}
// The Earth mirrored in glossy hulls (world space, km): lit where the Sun is up, a blue limb.
vec3 hullEnv(vec3 P, vec3 R, float rough) {
  vec3 oc = P - uEarthPos;
  float dist = length(oc);
  float ang = asin(clamp(6371.0 / dist, 0.0, 1.0));
  float cosToC = dot(R, -oc / dist);
  float edge = clamp(rough * 1.6 + 0.004, 0.004, 1.0);
  float disc = smoothstep(cos(ang + edge), cos(max(ang - edge, 0.0)), cosToC);
  if (disc <= 0.0) return vec3(0.0);
  float b = dot(oc, R), h = b * b - (dist * dist - 6371.0 * 6371.0);
  vec3 hit = P + R * max(-b - sqrt(max(h, 0.0)), 0.0);
  vec3 nE = normalize(h > 0.0 ? hit - uEarthPos : P + R * dot(-oc, R) - uEarthPos);
  float mu = dot(nE, uSunDir);
  vec3 ground = vec3(0.16, 0.22, 0.32) * 0.3 * uSunE / 3.14159 * max(mu, 0.0);
  float limb = pow(clamp(1.0 - abs(dot(nE, -R)), 0.0, 1.0), 3.0);
  return (ground + vec3(0.25, 0.45, 1.0) * limb * uSunE * 0.05 * smoothstep(-0.08, 0.2, mu)) * disc;
}
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 sunL = spaceSunlight(uTransmittanceLUT, vWorld, uSunDir) * uSunE;
  float k = floor(vKind + 0.5);
  vec3 toE = uEarthPos - vWorld;
  float dE = length(toE);
  vec3 eDir = toE / dE;
  float eSize = clamp(6400.0 / dE, 0.0, 1.0);
  vec3 earthshine = vec3(0.35, 0.5, 0.85) * uSunE * 0.3 * eSize * eSize * max(dot(N, eDir), 0.0) * max(dot(-eDir, uSunDir) * 0.5 + 0.5, 0.0);
  vec3 toP = uPointPos - vWorld;
  float dP = length(toP);
  vec3 pDir = toP / max(dP, 1e-3);
  vec3 pointL = uPointColor * max(dot(N, pDir), 0.0);
  vec3 cellP = vLocal / uPattern;
  float fw = max(max(fwidth(cellP.x), fwidth(cellP.y)), fwidth(cellP.z));
  // fine cell patterns fade to their average well before they reach a pixel, so lit
  // windows on moving or spinning hulls never sparkle frame to frame
  float detail = 1.0 - smoothstep(0.07, 0.3, fw * 4.0);
  float n = hash13(floor(cellP * vec3(1.0, 1.0, 1.0)));
  // surface coordinates in metres: round the station's axis on walls, its plan on end faces
  vec3 ln = normalize(vLN);
  float rr = length(vLocal.xz);
  vec2 sq = (abs(ln.y) > 0.7 ? vLocal.xz : vec2(atan(vLocal.z, vLocal.x) * rr, vLocal.y)) * 1000.0;
  float fwm = max(length(fwidth(vLocal)) * 1000.0, 1e-3);          // metres per pixel
  float dm = 1.0 - smoothstep(0.9, 2.7, fwm);                        // 8-12 m plates, >= 3 px
  vec3 alb = vec3(0.55, 0.56, 0.58);
  float rough = 0.35, metal = 0.4;
  vec3 em = vec3(0.0);
  if (k == 1.0) {
    // habitat: decks of windows (4 m decks, 3 m bays) in lit and dark neighbourhoods
    float row = fPulse(sq.y, 4.0, 1.3, 2.9, fwm), col = fPulse(sq.x, 3.0, 0.35, 2.65, fwm);
    float win = row * col;
    float plate = 1.0 - fPulse(sq.x, 18.0, 0.0, 17.85, fwm) * fPulse(sq.y, 12.0, 0.0, 11.85, fwm);
    float nb = mix(0.65, hash12(floor(sq / vec2(24.0, 12.0)) + 3.0), 1.0 - smoothstep(1.4, 4.0, fwm));
    float lit = step(0.3, nb) * step(0.28, hash12(floor(sq / vec2(3.0, 4.0))));
    float wd = 1.0 - smoothstep(0.35, 1.0, fwm);                     // 3 m bays, >= 3 px
    alb = vec3(0.64, 0.64, 0.62) * (0.86 + 0.14 * mix(0.5, hash12(floor(sq / vec2(18.0, 12.0))), dm)) * (1.0 - 0.3 * plate * dm);
    alb = mix(alb, vec3(0.05, 0.06, 0.07), win * 0.85);
    rough = mix(0.34, 0.06, win); metal = mix(0.15, 0.6, win);
    vec3 lamp = mix(vec3(1.0, 0.8, 0.55), vec3(0.85, 0.9, 1.0), step(0.8, nb));
    em = lamp * win * mix(0.72 * (0.3 + 0.7 * step(0.3, nb)), lit, wd) * 0.5;
    // districts 240 x 64 m: about one in five is terraced gardens instead of glazing, so the
    // rings read as lived-in from far off (each scale falls to its mean below ~3 px)
    float dD = 1.0 - smoothstep(20.0, 60.0, fwm);
    float gdn = mix(0.22, step(0.78, hash12(floor(sq / vec2(240.0, 64.0)) + 41.0)), dD);
    vec3 green = vec3(0.2, 0.28, 0.12) * (0.85 + 0.3 * mix(0.5, vnoise(sq * 0.07), dm));
    float rowM = mix(0.4, row, wd);
    alb = mix(alb, green, gdn * rowM * 0.5);
    rough = mix(rough, 0.85, gdn * rowM * 0.5); metal = mix(metal, 0.0, gdn * rowM * 0.5);
    em *= 1.0 - 0.5 * gdn;
  } else if (k == 2.0) {
    alb = vec3(0.03, 0.05, 0.1);
    rough = 0.08; metal = 0.9;
    float grid = 1.0 - smoothstep(0.0, 0.08 + fw, min(abs(fract(cellP.x * 0.5) - 0.5), abs(fract(cellP.z * 0.5) - 0.5)));
    alb = mix(alb, vec3(0.3), grid * 0.4 * detail);
    alb *= 1.0 + 0.15 * (hash13(floor(cellP * 0.5)) - 0.5) * detail;
  } else if (k == 3.0) {
    // truss: dark struts with bright bolted nodes every 6 m
    float node = fPulse(sq.y + sq.x, 6.0, 0.0, 0.5, fwm);
    alb = mix(vec3(0.16, 0.16, 0.17), vec3(0.42, 0.42, 0.44), node * dm); rough = 0.6;
  } else if (k == 4.0) {
    em = uAccent * (1.2 + 0.3 * sin(uTime * 0.5 + vLocal.x * 0.3));
    alb = vec3(0.1);
  } else if (k == 5.0) {
    // multilayer insulation: crinkled gold foil in quilted blankets
    float cr = mix(0.5, vnoise(sq * 0.8), 1.0 - smoothstep(0.1, 0.4, fwm)) * 0.55 + mix(0.5, vnoise(sq * 3.1), 1.0 - smoothstep(0.03, 0.1, fwm)) * 0.45;
    float quilt = 1.0 - fPulse(sq.x, 1.6, 0.0, 1.55, fwm) * fPulse(sq.y, 1.6, 0.0, 1.55, fwm);
    alb = vec3(0.85, 0.62, 0.25) * mix(1.0, 0.72 + 0.56 * cr, 1.0 - smoothstep(0.3, 1.5, fwm)) * (1.0 - 0.3 * quilt);
    rough = 0.22 + 0.25 * cr; metal = 1.0;
  } else if (k == 6.0) {
    alb = vec3(0.9, 0.92, 0.95); rough = 0.06; metal = 1.0;
    float facet = hash13(floor(cellP * 0.5));
    alb *= 0.85 + 0.15 * mix(0.5, facet, detail);
  } else if (k == 7.0) {
    float grain = vnoise(sq * 0.004) * 0.55 + vnoise(sq * 0.023 + 71.0) * 0.25;
    alb = mix(vec3(0.065, 0.057, 0.05), vec3(0.16, 0.145, 0.12), grain);
    rough = 0.98; metal = 0.0;
  } else if (k == 8.0) {
    // Native pod longitude/latitude stays continuous across the whole dome; the
    // station's cylindrical/planar projection has an abrupt turn on this rounded shell.
    vec2 garden = vSurface * vec2(${GARDEN_SURFACE.circumference.toFixed(1)},${GARDEN_SURFACE.meridian.toFixed(1)});
    vec2 footprint = max(fwidth(garden),vec2(1e-3));
    float gardenPx = max(footprint.x,footprint.y);
    float panes = fPulse(garden.x,${GARDEN_SURFACE.pane.toFixed(1)},.35,${(GARDEN_SURFACE.pane-.35).toFixed(2)},footprint.x) * fPulse(garden.y,${GARDEN_SURFACE.pane.toFixed(1)},.35,${(GARDEN_SURFACE.pane-.35).toFixed(2)},footprint.y);
    float planted = fPulse(garden.x,${GARDEN_SURFACE.courtU.toFixed(1)},4.0,${(GARDEN_SURFACE.courtU-4).toFixed(1)},footprint.x) * fPulse(garden.y,${GARDEN_SURFACE.courtV.toFixed(1)},4.0,${(GARDEN_SURFACE.courtV-4).toFixed(1)},footprint.y);
    float resolved = 1.0-smoothstep(3.0,15.0,gardenPx);
    // Both noise samples are periodic in longitude too, including the u=0/1 seam.
    float angle = vSurface.x*6.28318530718;
    float foliage = mix(.5,vnoise(vec2(sin(angle)*19.0,garden.y*.015))*.65+vnoise(vec2(cos(angle)*95.0,garden.y*.075+19.0))*.35,resolved);
    vec3 green = mix(vec3(.045,.105,.025),vec3(.16,.24,.065),foliage);
    vec3 under = mix(vec3(.27,.25,.19),green,planted);
    alb = mix(vec3(.57,.58,.52),under,panes);
    rough = mix(.4,.23,panes);metal=mix(.12,.22,panes);
    em = vec3(1.0,.78,.5) * (.022+.065*(1.0-planted)) * panes;
  } else {
    // plating: 12 x 8 m plates a shade apart, recessed seams, a few dark service hatches
    vec2 pc = floor(sq / vec2(12.0, 8.0));
    float ph = hash12(pc + 5.0);
    float seam = 1.0 - fPulse(sq.x, 12.0, 0.0, 11.88, fwm) * fPulse(sq.y, 8.0, 0.0, 7.88, fwm);
    float hatch = step(0.85, hash12(pc + 19.0)) * fPulse(sq.x, 12.0, 3.0, 6.0, fwm) * fPulse(sq.y, 8.0, 2.5, 5.5, fwm);
    alb *= mix(0.8 + 0.2 * mix(0.5, n, detail), 0.9 + 0.14 * ph, dm);
    alb *= 1.0 - 0.3 * seam * dm;
    alb = mix(alb, vec3(0.26, 0.26, 0.27), hatch * dm);
    alb *= 1.0 - 0.06 * smoothstep(0.55, 0.9, vnoise(vec2(sq.x * 0.02, sq.y * 0.3) + ph * 7.0)) * dm;   // scouring streaks
    // frames every 48 m and super-panels (four plates by three) a shade apart, down to ~3 px
    float frm = max(fPulse(sq.x, 48.0, 0.0, 1.2, fwm), fPulse(sq.y, 48.0, 0.0, 1.2, fwm));
    alb *= 1.0 - 0.18 * frm;
    alb *= mix(1.0, 0.94 + 0.12 * hash12(floor(sq / vec2(48.0, 24.0)) + 13.0), 1.0 - smoothstep(8.0, 24.0, fwm));
    rough = 0.32 + 0.1 * ph;
  }
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 H = normalize(V + uSunDir);
  // glints stay physically shaped but bounded: flat kilometre-scale panels used to flare
  // the whole screen white for an instant as the view swept through the mirror angle
  float sp = pow(max(dot(N, H), 0.0), mix(70.0, 10.0, rough)) * mix(0.55, 0.25, rough);
  vec3 spec = mix(vec3(0.04), alb, metal) * sp;
  vec3 Hp = normalize(V + pDir);
  float spp = pow(max(dot(N, Hp), 0.0), mix(70.0, 10.0, rough)) * mix(0.55, 0.25, rough);
  float diffK = k == 6.0 ? 0.03 : (1.0 - metal * 0.7);
  vec3 col = alb * diffK / 3.14159 * (sunL * ndl + earthshine + pointL) + min(spec * sunL * ndl, sunL * 0.6) + min(mix(vec3(0.04), alb, metal) * spp * pointL, pointL * 0.6);
  vec3 F0 = mix(vec3(0.04), alb, metal);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  col += (F0 + (1.0 - F0) * fres * (1.0 - rough)) * hullEnv(vWorld, reflect(-V, N), max(rough, 0.12)) * 0.8;
  col += alb * 0.004;
  col += em;
  // (no random blinking hull cells: they read as flashing white quads once bloomed;
  //  the stations carry explicit beacon lamps instead)
  float a = 1.0;
  if (uBehindMask > 0.5) {
    vec4 hb = texture(uHearthTex, gl_FragCoord.xy / uHearthRes);
    float viewD = length(vWorld - cameraPosition);
    if (viewD > uHearthDepth) a = 1.0 - hb.a;
  }
  if (a < 0.02) discard;
  gl_FragColor = vec4(col * a, 1.0);
}
`;

export function createHullMaterial({ pattern = 0.06, accent = [0.5, 0.85, 1.0], behindMask = false } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTransmittanceLUT: U.uTransmittanceLUT, uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunE: U.uSunIlluminance,
      uTime: { value: 0 }, uEarthPos: { value: new THREE.Vector3() },
      uPointPos: { value: new THREE.Vector3(1e9, 0, 0) }, uPointColor: { value: new THREE.Color(0, 0, 0) },
      uPattern: { value: pattern }, uAccent: { value: new THREE.Color(...accent) },
      uBehindMask: { value: behindMask ? 1 : 0 }, uHearthTex: { value: null }, uHearthRes: { value: new THREE.Vector2(1, 1) }, uHearthDepth: { value: 1e12 },
    },
    side: THREE.DoubleSide,
  });
}

export function tag(geo, kind) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(new Float32Array(n).fill(kind), 1));
  g.setAttribute('aSurface', g.getAttribute('uv') || new THREE.Float32BufferAttribute(new Float32Array(n*2),2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aKind', 'aSurface'].includes(k)) g.deleteAttribute(k);
  return g;
}

export function merge(list) {
  const g = mergeGeometries(list, false);
  g.computeBoundingSphere();
  return g;
}

/** Compatibility name: all CB tubes now have closed ends and periodic loop frames. */
export function ctube(B, pts, r, seg = 8, k) {
  B.tube(pts, r, seg, k);
}

/** A cylinder between two points (for trusses, spokes). */
export function beam(a, b, r, kind, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a);
  const L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1, false);
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return tag(g, kind);
}
