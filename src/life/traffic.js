import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchedMaterial } from '../world/materials.js';
import { ISLANDS, SKYPORT, TOWERS, CHORUS } from '../world/layout.js';
import { latticeRadius, AXIS } from '../world/axis.js';
import { mulberry32 } from '../world/noise.js';
import { U } from '../core/uniforms.js';
import { RouteBank, ROUTE_GLSL, SAMPLES, circlePath, beltPath, smoothClosed } from './routes.js';
import { Clearance } from './clearance.js';
import { PART, LIGHTS, airCarGeometry, ferryGeometry, cargoDroneGeometry, serviceGeometry, arkGeometry, linerGeometry } from './vehicles.js';

/**
 * Meridian's airspace. A hierarchy of engineered "motorways":
 *  - eight petal belts looping from stacked orbits around the Axis out to each district
 *  - the Grand Circle (r 2.35 km) and the Atoll Way (r 4.9 km), both two-way
 *  - four expressways streaming out past the rim to the horizon
 *  - the Skyport spur, with off/on ramps down to taxi pads on the harbour ring
 *  - sky-dock ramps branching off the petals to hovering docks beside the tallest towers
 *  - low cargo belts from the sea ports, a skimmer ring, crown maintenance, a Chorus circuit
 *  - starship lanes that lift off beside the Skyport and climb out of the atmosphere
 * Every lane is clearance-checked against the world and lifted where needed.
 * All motion is on the GPU (see routes.js); the CPU only updates a few uniforms.
 */
const TAU = Math.PI * 2;
const CLASSES = ['car', 'ferry', 'cargo', 'service', 'ark', 'liner'];
const CLS = Object.fromEntries(CLASSES.map((c, i) => [c, i]));
const MODEL_LEN = { car: 6.5, ferry: 65, cargo: 10, service: 9, ark: 1, liner: 1 };

// --------------------------------------------------------------- shaders ---
const VEH_VERT_PARS = /* glsl */ `
#define ROUTE_SAMPLES ${SAMPLES}.0
${ROUTE_GLSL}
attribute vec4 aRoute;   // row, phase0, rate (loops/s, signed), scale
attribute vec4 aLane;    // lateral, vertical, variant, seed
attribute float aPart;
uniform float uCull;     // cull distance in vehicle lengths
uniform float uModelLen;
varying float vPart; varying float vVariant; varying float vThrust; varying float vSeed;
varying vec3 vLocal;
mat3 vhRot; vec3 vhPos; float vhOn;
vec3 vhSpin(vec3 p) {
  if (abs(aPart - 11.0) < 0.5) { float a = uTime * 0.21 + aLane.w * 6.0; float c = cos(a), s = sin(a); p.xy = mat2(c, s, -s, c) * p.xy; }
  return p;
}
void vehicleSetup() {
  // cheap distance test first (one texel), full frame only for craft near enough to draw
  float ph = aRoute.y + uTime * aRoute.z;
  vec3 p0 = texelFetch(uRoutes, ivec2(int(fract(ph) * ROUTE_SAMPLES), int(aRoute.x + 0.5) * 3), 0).xyz;
  float lim = uCull * uModelLen * aRoute.w;
  if (distance(p0, cameraPosition) > lim + 300.0) { vhOn = 0.0; vhPos = p0; vhRot = mat3(1.0); vThrust = 0.0; vPart = aPart; vVariant = 0.0; vSeed = 0.0; return; }
  RouteFrame fr = routeAt(aRoute.x, ph);
  float dir = aRoute.z < 0.0 ? -1.0 : 1.0;
  vec3 side;
  vhRot = routeBasis(fr, dir, side);
  vhPos = fr.pos + side * aLane.x + vec3(0.0, aLane.y, 0.0);
  float d = distance(vhPos, cameraPosition);
  vhOn = step(0.02, fr.vis) * step(d, uCull * uModelLen * aRoute.w);
  vThrust = fr.thrust * fr.vis;
  vPart = aPart; vVariant = aLane.z; vSeed = aLane.w;
}
`;

const VEH_FRAG_PARS = /* glsl */ `
varying float vPart; varying float vVariant; varying float vThrust; varying float vSeed;
varying vec3 vLocal;
uniform float uClass;
uniform float uSeam;     // panel seam period in model units
int vhPartI; float vhSeam;
vec3 vhLivery() {
  int v = int(vVariant * 7.99);
  if (uClass < 0.5) {
    vec3 L[8] = vec3[8](vec3(0.9, 0.9, 0.88), vec3(0.8, 0.7, 0.52), vec3(0.09, 0.1, 0.12), vec3(0.2, 0.46, 0.47), vec3(0.08, 0.13, 0.26), vec3(0.64, 0.36, 0.3), vec3(0.72, 0.74, 0.77), vec3(0.93, 0.9, 0.82));
    return L[v];
  } else if (uClass < 1.5) {
    return vVariant < 0.5 ? vec3(0.92, 0.92, 0.9) : vec3(0.9, 0.86, 0.77);
  } else if (uClass < 2.5) {
    vec3 L[4] = vec3[4](vec3(0.85, 0.42, 0.1), vec3(0.88, 0.88, 0.86), vec3(0.3, 0.33, 0.36), vec3(0.16, 0.4, 0.42));
    return L[v % 4];
  } else if (uClass < 3.5) {
    return vVariant < 0.5 ? vec3(0.93, 0.93, 0.95) : vec3(0.9, 0.5, 0.12);
  } else if (uClass < 4.5) {
    return vec3(0.78, 0.6, 0.28);       // ark: gold-foil tankage
  }
  return vec3(0.9, 0.9, 0.9);
}
vec3 vhAccent() {
  if (uClass < 0.5) return vVariant > 0.62 ? vec3(0.85, 0.66, 0.38) : vec3(0.75, 0.77, 0.8);
  if (uClass < 1.5) return vVariant < 0.5 ? vec3(0.25, 0.62, 0.6) : vec3(0.78, 0.6, 0.32);
  if (uClass < 2.5) return vec3(0.05, 0.05, 0.05);
  if (uClass < 3.5) return vVariant < 0.5 ? vec3(0.1, 0.3, 0.85) : vec3(0.08, 0.08, 0.08);
  return vec3(0.8, 0.6, 0.3);
}
`;

const VEH_COLOR = /* glsl */ `
{
  vhPartI = int(vPart + 0.5);
  // panel seams: rings along the hull plus a waist line, anti-aliased
  vec3 q = vLocal / uSeam;
  float fz = fwidth(q.z) + 1e-4;
  float sz = 1.0 - smoothstep(0.0, fz * 1.5, abs(fract(q.z + 0.5) - 0.5) - 0.02);
  float fy = fwidth(q.y) + 1e-4;
  float sy = 1.0 - smoothstep(0.0, fy * 1.5, abs(q.y - 0.05) - 0.015);
  vhSeam = max(sz * step(0.2, abs(q.x) + abs(q.y)), sy) * (1.0 - smoothstep(0.3, 1.0, fz * 4.0));
  vec3 c = vec3(0.5);
  if (vhPartI == 0) c = vhLivery();
  else if (vhPartI == 1) c = vec3(0.015, 0.02, 0.028);
  else if (vhPartI == 2) c = vec3(0.07, 0.075, 0.085);
  else if (vhPartI == 3) c = vec3(0.9, 0.9, 0.85);
  else if (vhPartI == 4) c = vec3(0.5, 0.05, 0.03);
  else if (vhPartI == 5) c = vec3(0.3, 0.5, 0.6);
  else if (vhPartI == 6) c = vec3(0.04, 0.05, 0.06);
  else if (vhPartI == 7) c = vhAccent();
  else if (vhPartI == 8) c = vec3(0.2, 0.25, 0.3);
  else if (vhPartI == 9) c = vec3(0.3, 0.3, 0.35);
  else c = vec3(0.86, 0.86, 0.84);
  if (vhPartI == 0 || vhPartI == 10 || vhPartI == 11) c *= 1.0 - 0.45 * vhSeam;
  diffuseColor.rgb = c;
}`;

const VEH_SURFACE = /* glsl */ `
{
  float r = 0.32, m = 0.35;
  if (vhPartI == 0) { r = 0.22 + 0.08 * vhSeam; m = uClass > 3.5 && uClass < 4.5 ? 0.9 : 0.45; }
  else if (vhPartI == 1 || vhPartI == 6) { r = 0.04; m = 0.9; }
  else if (vhPartI == 2) { r = 0.45; m = 0.6; }
  else if (vhPartI == 10 || vhPartI == 11) { r = 0.38; m = 0.05; }
  else if (vhPartI == 7) { r = 0.25; m = 0.7; }
  roughnessFactor = r; metalnessFactor = m;
}`;

const VEH_EMISSIVE = /* glsl */ `
{
  float night = uCityLights;
  vec3 e = vec3(0.0);
  if (vhPartI == 3) e = vec3(1.0, 0.92, 0.8) * (2.2 + 1.5 * night);
  else if (vhPartI == 4) e = vec3(1.0, 0.08, 0.03) * (1.2 + 1.2 * night);
  else if (vhPartI == 5) e = vec3(0.35, 0.78, 1.0) * (0.25 + 1.1 * night) * (0.85 + 0.15 * sin(uTime * 13.0 + vSeed * 40.0));
  else if (vhPartI == 6) {
    // window cells along the hull; a few dark cabins
    float cell = floor(vLocal.z / (uSeam * 0.85));
    float lit = step(0.18, fract(sin(cell * 12.9898 + vSeed * 78.233) * 43758.5453));
    float frame = smoothstep(0.1, 0.2, abs(fract(vLocal.z / (uSeam * 0.85)) - 0.5));
    e = vec3(1.0, 0.74, 0.46) * (0.04 + 0.5 * night) * lit * frame;
  }
  else if (vhPartI == 8) e = vec3(0.55, 0.75, 1.0) * (2.0 + 60.0 * vThrust);
  else if (vhPartI == 9) {
    float ph = fract(uTime * 1.6 + vSeed * 7.0);
    float left = step(0.0, vLocal.x);
    vec3 a = vVariant < 0.5 ? vec3(0.15, 0.35, 1.0) : vec3(1.0, 0.55, 0.1);
    vec3 b = vVariant < 0.5 ? vec3(1.0, 0.1, 0.08) : vec3(1.0, 0.55, 0.1);
    float on = left > 0.5 ? step(ph, 0.5) : step(0.5, ph);
    e = mix(b, a, left) * on * (3.0 + 3.0 * night);
  }
  else if (vhPartI == 7 && uClass > 3.5) e = vec3(1.0, 0.8, 0.5) * 0.04 * night;
  totalEmissiveRadiance += e;
}`;

// Light sprites: every vehicle carries 6 emitters. Far away they merge into one
// point whose colour depends on whether you see the vehicle's nose or tail, so
// the two directions of a motorway read as a white river and a red river.
const LIGHT_VERT = /* glsl */ `
uniform float uTime;
uniform float uPx;          // pixels per radian-ish (viewport height / (2 tan(fov/2)))
uniform float uMinPx;
uniform vec2 uRes;          // viewport in pixels
uniform float uStreak;      // seconds of motion blur
uniform float uCityLights;
uniform vec4 uLP[36];       // xyz model offset, w = type
uniform vec4 uLC[36];       // size (model units), intensity, -, -
uniform float uModelLen[6];
${ROUTE_GLSL}
attribute vec2 aCorner;
attribute vec4 aRoute; attribute vec4 aLane; attribute float aKind;
varying vec3 vCol; varying vec2 vQ; varying float vLen; varying float vI;
vec3 extinction(vec3 p) {
  vec3 dv = p - cameraPosition; float dist = length(dv);
  float h0 = max(cameraPosition.y, 0.0), h1 = max(p.y, 0.0);
  float dh = h1 - h0;
  float rM = abs(dh) < 1.0 ? exp(-h0 / 1100.0) : 1100.0 * (exp(-h0 / 1100.0) - exp(-h1 / 1100.0)) / dh;
  float rR = abs(dh) < 1.0 ? exp(-h0 / 8000.0) : 8000.0 * (exp(-h0 / 8000.0) - exp(-h1 / 8000.0)) / dh;
  return exp(-dist * (vec3(5.8e-6, 13.6e-6, 33.1e-6) * rR + 1.6e-5 * rM));
}
void main() {
  int slot = gl_InstanceID % 6;
  int cls = int(aKind + 0.5);
  vec4 L = uLP[cls * 6 + slot];
  vec4 LC = uLC[cls * 6 + slot];
  RouteFrame fr = routeAt(aRoute.x, aRoute.y + uTime * aRoute.z);
  float dir = aRoute.z < 0.0 ? -1.0 : 1.0;
  vec3 side;
  mat3 R = routeBasis(fr, dir, side);
  vec3 base = fr.pos + side * aLane.x + vec3(0.0, aLane.y, 0.0);
  float scale = aRoute.w;
  float mlen = uModelLen[cls] * scale;
  float dBase = distance(base, cameraPosition);
  bool merged = dBase > mlen * 140.0 && cls < 4;
  vec3 p = base + R * (L.xyz * scale);
  if (merged) p = base;
  vec3 toCam = cameraPosition - p;
  float d = length(toCam);
  toCam /= max(d, 1e-3);
  vec3 fwd = R[2], left = R[0], up = R[1];
  float type = L.w;
  float I = LC.y;
  vec3 col = vec3(1.0);
  float cf = dot(fwd, toCam);
  float night = uCityLights;
  float blink = 1.0;
  float seed = aLane.w;
  if (merged) {
    if (slot != 0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float front = smoothstep(-0.18, 0.18, cf);
    col = mix(vec3(1.0, 0.2, 0.07), vec3(1.0, 0.88, 0.72), front);
    I = mix(uLC[cls * 6 + 1].y * 0.7, uLC[cls * 6].y, front) * 0.8;
    if (cls == 2) col = mix(col, vec3(1.0, 0.6, 0.2), 0.5);
    if (cls == 1) { col = mix(col, vec3(1.0, 0.8, 0.55), 0.4); I *= 1.6; }
    if (cls == 3) { float ph = fract(uTime * 1.6 + seed * 7.0); col = aLane.z < 0.5 ? (ph < 0.5 ? vec3(0.2, 0.4, 1.0) : vec3(1.0, 0.15, 0.1)) : vec3(1.0, 0.6, 0.15); I = 7.0; }
    LC.x = uLC[cls * 6].x * 1.4;
  } else if (type < 0.5) {            // head light
    col = vec3(1.0, 0.91, 0.78); I *= 0.06 + 0.94 * smoothstep(-0.1, 0.75, cf);
  } else if (type < 1.5) {            // tail light
    col = vec3(1.0, 0.1, 0.04); I *= 0.1 + 0.9 * smoothstep(0.0, -0.7, cf);
  } else if (type < 2.5) {            // port nav (red)
    col = vec3(1.0, 0.07, 0.04); I *= smoothstep(-0.35, 0.2, dot(left, toCam));
  } else if (type < 3.5) {            // starboard nav (green)
    col = vec3(0.1, 1.0, 0.35); I *= smoothstep(-0.35, 0.2, -dot(left, toCam));
  } else if (type < 4.5) {            // anti-collision strobe
    blink = step(0.955, fract(uTime * 0.85 + seed * 17.0));
  } else if (type < 5.5) {            // lift-fan glow, seen from below
    col = vec3(0.35, 0.75, 1.0); I *= (0.35 + 0.65 * smoothstep(0.2, -0.6, dot(up, toCam))) * (0.3 + night);
  } else if (type < 6.5) {            // pulse blue
    float ph = fract(uTime * 1.6 + seed * 7.0); col = aLane.z < 0.5 ? vec3(0.15, 0.35, 1.0) : vec3(1.0, 0.55, 0.1); blink = step(ph, 0.5);
  } else if (type < 7.5) {            // pulse red
    float ph = fract(uTime * 1.6 + seed * 7.0); col = aLane.z < 0.5 ? vec3(1.0, 0.1, 0.08) : vec3(1.0, 0.55, 0.1); blink = step(0.5, ph);
  } else if (type < 8.5) {            // starship engine
    col = vec3(0.6, 0.78, 1.0); I *= (0.1 + fr.thrust) * (0.25 + 0.75 * smoothstep(0.3, -0.5, cf));
  } else if (type < 9.5) {            // amber beacon (rotating)
    col = vec3(1.0, 0.55, 0.12); blink = 0.25 + 0.75 * pow(max(0.0, sin(uTime * 5.0 + seed * 30.0)), 6.0);
  } else {                             // passenger window glow
    col = vec3(1.0, 0.75, 0.45); I *= night;
  }
  I *= blink * fr.vis;
  // physical size vs pixel footprint: tiny lights conserve energy instead of staying bright
  float sizeW = LC.x * scale;
  float proj = sizeW * uPx / max(d, 1.0);
  float px = max(proj, uMinPx);
  // perceptual falloff: sub-pixel lights lose energy gently (^1.5) so distant motorways
  // still read as threads of light, while close lights stay at their nominal level
  float ratio = min(1.0, proj / uMinPx);
  I = min(I * 2.4 * ratio * sqrt(ratio), I * 1.1);
  I *= (0.5 + 0.5 * night);
  // distant traffic settles into a faint haze of light instead of a field of dashes
  I *= 1.0 - 0.8 * smoothstep(2500.0, 11000.0, d);
  I *= dot(extinction(p), vec3(0.3333));
  if (I < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // screen-space streak along the motion
  vec3 vel = fwd * fr.speed * dir;
  vec4 c0 = projectionMatrix * viewMatrix * vec4(p, 1.0);
  // long-exposure feel at distance: far craft draw threads, near craft only a hint of blur
  float streak = uStreak * mix(1.0, 5.0, smoothstep(300.0, 5500.0, d));
  vec4 c1 = projectionMatrix * viewMatrix * vec4(p - vel * streak, 1.0);
  if (c0.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 res = uRes;
  vec2 s0 = c0.xy / c0.w, s1 = c1.w > 0.0 ? c1.xy / c1.w : s0;
  vec2 dpx = (s1 - s0) * 0.5 * res;
  float len = length(dpx);
  vec2 ax = len > 0.5 ? dpx / len : vec2(1.0, 0.0);
  vec2 pe = vec2(-ax.y, ax.x);
  float halo = 2.4;
  vec2 offPx = ax * (aCorner.x > 0.0 ? len + px * halo : -px * halo) + pe * aCorner.y * px * halo;
  vec2 ndc = s0 + offPx / (0.5 * res);
  gl_Position = vec4(ndc * c0.w, c0.z, c0.w);
  vQ = vec2(aCorner.x > 0.0 ? (len + px * halo) / px : -halo, aCorner.y * halo);
  vLen = len / px;
  vI = I / (1.0 + vLen * 0.35);
  vCol = col;
}`;

const LIGHT_FRAG = /* glsl */ `
varying vec3 vCol; varying vec2 vQ; varying float vLen; varying float vI;
void main() {
  // distance (in footprint units) from the head->tail segment
  float t = clamp(vQ.x / max(vLen, 1e-3), 0.0, 1.0);
  float along = vQ.x - clamp(vQ.x, 0.0, vLen);
  float r2 = along * along + vQ.y * vQ.y;
  float core = exp(-r2 * 3.0);
  float glow = exp(-sqrt(r2) * 2.2) * 0.22;
  float tail = mix(1.0, 0.25, t);
  gl_FragColor = vec4(vCol * vI * (core + glow) * tail, 1.0);
}`;

// ------------------------------------------------------------------ build --
export class Traffic {
  constructor(scene, settings, world) {
    this.scene = scene;
    this.world = world;
    this.settings = settings;
    this.report = [];
    this.rnd = mulberry32(5026);
    this.bank = new RouteBank();
    this.fleet = Object.fromEntries(CLASSES.map((c) => [c, []]));
    this.hoops = [];
    this.beacons = [];
    this.pads = [];
    this.clear = world ? new Clearance(world) : null;
    this.promenades = world && world.infra ? world.infra.promenades || [] : [];
    this.buildNetwork();
    this.tex = this.bank.build();
    this.group = new THREE.Group();
    this.group.name = 'Traffic';
    scene.add(this.group);
    this.buildFleetMeshes();
    this.buildLights();
    this.buildHoops();
    this.buildBeacons();
    this.buildPads();
    this.buildShipFx();
    this.density = -1;
    this.applyQuality(settings);
  }

  // ------------------------------------------------------------ clearance --
  promenadeClear(p) {
    let c = 1e9;
    for (const path of this.promenades) {
      for (let k = 0; k < path.length; k += 2) {
        const q = path[k];
        const dh = Math.hypot(p.x - q.x, p.z - q.z);
        if (dh > 60) continue;
        c = Math.min(c, Math.max(dh - 26, p.y - (q.y + 10)));
      }
    }
    return c;
  }

  /** Lift + validate a dense lane polyline. */
  engineer(name, pts, need = 45, opts = {}) {
    if (!this.clear) return pts;
    const res = this.clear.liftPath(pts, need, opts);
    let worst = res.worst, at = res.at;
    for (const p of res.pts) { const c = this.promenadeClear(p); if (c < worst) { worst = c; at = p; } }
    this.report.push({ name, worst: Math.round(worst), at: at ? [Math.round(at.x), Math.round(at.y), Math.round(at.z)] : null });
    return res.pts;
  }

  // ------------------------------------------------------------- network --
  buildNetwork() {
    const rnd = this.rnd;
    const ease = (t) => t * t * (3 - 2 * t);
    this.lanesPetal = [
      { lat: 6, up: 0, mul: 1.12 }, { lat: 18, up: 0, mul: 1.0 }, { lat: 30, up: 0, mul: 0.9 },
      { lat: 6, up: 9, mul: 1.08 }, { lat: 18, up: 9, mul: 0.96 }, { lat: 30, up: 9, mul: 0.86 },
    ];
    // ---- petal belts: Axis orbit ⟷ district halo -----------------------
    // altitudes are staggered so crossing petals keep >= 45 m vertical separation
    const petalAlt = { aster: [700, 300], lumen: [930, 330], solace: [330, 250], verdant: [800, 280], cantor: [1020, 350], halcyon: [640, 320], oriel: [870, 300], thule: [1110, 360] };
    this.petals = [];
    for (const isl of ISLANDS) {
      const [yA, yB] = petalAlt[isl.id] || [700, 300];
      const rA = (yA > AXIS.latticeY0 + 20 ? latticeRadius(yA) + 210 : 760);
      const rB = isl.r + 100;
      let pts = beltPath(new THREE.Vector3(0, 0, 0), rA, new THREE.Vector3(isl.x, 0, isl.z), rB, (tag, t) => {
        if (tag === 'A') return yA;
        if (tag === 'B') return yB;
        if (tag === 'AB') return yA + (yB - yA) * ease(t);
        return yB + (yA - yB) * ease(t);
      });
      pts = smoothClosed(pts, 4, 6);
      pts = this.engineer(`petal-${isl.id}`, pts, 45);
      const route = this.bank.add({ polyline: pts, speed: 62, accel: 2.2, latAccel: 3.0 });
      route.name = `petal-${isl.id}`;
      this.petals.push({ isl, route, yA, yB, rA, rB });
      for (const ln of this.lanesPetal) this.spawnLane(route, 'car', { ...ln, perKm: 4.2 });
      this.hoopsAlong(route, { lat: 18, up: 4.5, r: 24, every: 520, color: 0, onlyStraight: true });
    }
    // ---- Grand Circle & Atoll Way (two-way) ---------------------------------
    const twoWay = (name, r, y, hoopEvery, ferries, perKm) => {
      let pts = circlePath(0, 0, r, y, { n: Math.ceil((TAU * r) / 8) });
      pts = this.engineer(name, pts, 45);
      const route = this.bank.add({ polyline: pts, speed: 70, accel: 2.5 });
      route.name = name;
      for (const dir of [1, -1]) {
        for (const [lat, up, mul] of [[7, 0, 1.1], [15, 0, 1.0], [7, 8, 1.05], [15, 8, 0.94]]) this.spawnLane(route, 'car', { lat, up, mul, dir, perKm });
        this.spawnLane(route, 'ferry', { lat: 25, up: 4, mul: 0.62, dir, perKm: ferries / (route.length / 1000) / 2, minGap: 40 });
      }
      this.hoopsAlong(route, { lat: 0, up: 5, r: 34, every: hoopEvery, color: 1 });
      this.beaconsAlong(route, { edges: [-30, 30], up: 4, every: 90, color: 1 });
      return route;
    };
    this.grand = twoWay('grand-circle', 2350, 330, 440, 8, 3.4);
    this.atoll = twoWay('atoll-way', 4900, 460, 620, 8, 2.2);
    // emergency lane down the median of the Grand Circle
    for (const dir of [1, -1]) this.spawnLane(this.grand, 'service', { lat: 0, up: 18, mul: 1.35, dir, perKm: 0.12, minGap: 60, variant: () => 0.2 });
    for (const dir of [1, -1]) this.spawnLane(this.atoll, 'service', { lat: 0, up: 18, mul: 1.3, dir, perKm: 0.06, minGap: 80, variant: () => (rnd() < 0.5 ? 0.2 : 0.8) });
    // ---- expressways to the horizon ------------------------------------------
    const expAngles = [0.05, 1.62, -2.95];
    expAngles.forEach((ang, k) => {
      const yA = 1480 + k * 80;
      const rA = latticeRadius(yA) + 230;
      const far = 17500;
      const B = new THREE.Vector3(Math.cos(ang) * far, 0, Math.sin(ang) * far);
      let pts = beltPath(new THREE.Vector3(), rA, B, 900, (tag, t) => {
        if (tag === 'A') return yA;
        if (tag === 'B') return 1350;
        if (tag === 'AB') return yA + (1350 - yA) * ease(t);
        return 1350 + (yA - 1350) * ease(t);
      }, 12);
      pts = smoothClosed(pts, 3, 12);
      pts = this.engineer(`express-${k}`, pts, 50);
      const route = this.bank.add({ polyline: pts, speed: 110, accel: 3.0, latAccel: 3.5 });
      route.name = `express-${k}`;
      for (const [lat, up, mul] of [[7, 0, 1.12], [19, 0, 1.0], [13, 9, 0.95]]) this.spawnLane(route, 'car', { lat, up, mul, perKm: 3.0 });
      this.hoopsAlong(route, { lat: 13, up: 5, r: 24, every: 700, color: 0, onlyStraight: true, maxR: 7000 });
      this.beaconsAlong(route, { edges: [-1, 27], up: 5, every: 110, color: 0, onlyStraight: true, maxR: 9000 });
    });
    // ---- Skyport spur with taxi ramps ------------------------------------------
    {
      const yA = 1900, yB = SKYPORT.y + 130;
      const rA = latticeRadius(yA) + 220, rB = SKYPORT.r + 260;
      const B = new THREE.Vector3(SKYPORT.x, 0, SKYPORT.z);
      let pts = beltPath(new THREE.Vector3(), rA, B, rB, (tag, t) => {
        if (tag === 'A') return yA;
        if (tag === 'B') return yB;
        if (tag === 'AB') return yA + (yB - yA) * ease(t);
        return yB + (yA - yB) * ease(t);
      });
      pts = smoothClosed(pts, 4, 6);
      pts = this.engineer('skyport-spur', pts, 45, { skyport: false });
      const route = this.bank.add({ polyline: pts, speed: 60, accel: 2.2 });
      route.name = 'skyport-spur';
      this.spur = route;
      for (const ln of this.lanesPetal) this.spawnLane(route, 'car', { ...ln, perKm: 3.2 });
      this.spawnLane(route, 'ferry', { lat: 18, up: 22, mul: 0.7, perKm: 0.25, minGap: 50 });
      this.hoopsAlong(route, { lat: 18, up: 4.5, r: 24, every: 520, color: 1, onlyStraight: true });
      this.beaconsAlong(route, { edges: [-1, 37], up: 4, every: 85, color: 1, onlyStraight: true });
      // taxi pads on the main ring, between berths
      const R = SKYPORT.r;
      for (const s of [1, 3.5, 6, 8.5]) {
        const a = 0.3 + ((s + 0.5) / 10) * TAU;
        const pad = new THREE.Vector3(SKYPORT.x + Math.cos(a) * R, SKYPORT.y + 12.6, SKYPORT.z + Math.sin(a) * R);
        const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        this.dockRamp(route, pad, out, { name: `skyport-pad-${s}`, cars: 3, dwell: 16, skyport: false });
      }
    }
    // ---- sky-docks beside the tallest towers (ramps off the petals) -------------
    if (this.world && this.world.towers) {
      for (const t of this.world.towers) {
        if (t.def.height < 900) continue;
        const petal = this.petals.find((pp) => Math.hypot(pp.isl.x - t.def.x, pp.isl.z - t.def.z) < pp.isl.r);
        if (!petal) continue;
        const hp = petal.yB + 70;
        // the dock faces the nearest stretch of its motorway so the ramps stay short and clear of the tower
        const near = new THREE.Vector3(), tmpT = new THREE.Vector3(), q = new THREE.Vector3();
        let bd = 1e18;
        for (let s = 0; s < petal.route.length; s += 15) { petal.route.at(s, q, tmpT); const dd = (q.x - t.def.x) ** 2 + (q.z - t.def.z) ** 2; if (dd < bd) { bd = dd; near.copy(q); } }
        const out = new THREE.Vector3(near.x - t.def.x, 0, near.z - t.def.z).normalize();
        const localY = hp - t.baseY;
        const rr = (t.collide ? t.collide(localY) : (t.def.radius || 60)) + 42;
        const pad = new THREE.Vector3(t.def.x + out.x * rr, hp, t.def.z + out.z * rr);
        this.pads.push({ p: pad.clone(), r: 15, out: out.clone(), name: t.def.name || `tower-${t.def.seed}` });
        this.dockRamp(petal.route, pad.clone().add(new THREE.Vector3(0, 1.2, 0)), out, { name: `skydock-${t.def.seed}`, cars: 3, dwell: 14 });
      }
    }
    // ---- cargo belts from the sea ports ------------------------------------------
    const ports = [
      { A: [5250, 320], isl: 'lumen' }, { A: [5250, 320], isl: 'solace', yo: 25 },
      { A: [-4650, -3850], isl: 'oriel' }, { A: [-4850, 3250], isl: 'cantor' }, { A: [-4650, -3850], isl: 'halcyon', yo: 25 },
    ];
    for (const pd of ports) {
      const isl = ISLANDS.find((i) => i.id === pd.isl);
      const yo = pd.yo || 0;
      let pts = beltPath(new THREE.Vector3(pd.A[0], 0, pd.A[1]), 230, new THREE.Vector3(isl.x, 0, isl.z), isl.r + 150, (tag) => (tag === 'A' ? 95 + yo : tag === 'B' ? 110 + yo : 102 + yo));
      pts = smoothClosed(pts, 4, 6);
      pts = this.engineer(`cargo-${pd.isl}`, pts, 32);
      const route = this.bank.add({ polyline: pts, speed: 34, accel: 1.4 });
      route.name = `cargo-${pd.isl}`;
      for (const [lat, up] of [[5, 0], [14, 0]]) this.spawnLane(route, 'cargo', { lat, up, mul: 1, perKm: 2.2, minGap: 5 });
    }
    // ---- skimmer ring low over the lagoon (two-way) --------------------------------
    {
      let pts = circlePath(0, 0, 1260, 72, { n: 1000 });
      pts = this.engineer('skimmer-ring', pts, 28);
      const route = this.bank.add({ polyline: pts, speed: 42, accel: 2 });
      route.name = 'skimmer-ring';
      for (const dir of [1, -1]) for (const [lat, mul] of [[6, 1.08], [13, 0.95]]) this.spawnLane(route, 'car', { lat, up: 0, mul, dir, perKm: 3.2 });
    }
    // ---- crown maintenance + Chorus circuit -------------------------------------
    {
      const route = this.bank.add({ polyline: circlePath(0, 0, 430, AXIS.crownY - 110, { n: 400 }), speed: 14, accel: 1 });
      route.name = 'crown-service';
      this.spawnLane(route, 'service', { lat: 0, up: 0, mul: 1, perKm: 1.2, minGap: 30, variant: () => 0.8 });
      let cp = circlePath(CHORUS.x, CHORUS.z, CHORUS.scale * 2.35, (u) => CHORUS.y - 90 + 40 * Math.sin(u * TAU * 2), { n: 500 });
      cp = this.engineer('chorus-circuit', cp, 30, { chorus: false });
      const r2 = this.bank.add({ polyline: cp, speed: 16, accel: 1 });
      r2.name = 'chorus-circuit';
      this.spawnLane(r2, 'ferry', { lat: 0, up: 0, mul: 1, perKm: 0.9, minGap: 45 });
    }
    // ---- starships -----------------------------------------------------------------
    this.buildShipRoutes();
  }

  /** Off-ramp from a motorway down to a pad (full stop, dwell) and back on. */
  dockRamp(main, pad, out, { name, cars = 3, dwell = 14, skyport = true }) {
    // nearest point on the main route
    const L = main.length;
    let best = 0, bd = 1e18;
    const tmp = new THREE.Vector3(), tt = new THREE.Vector3();
    for (let s = 0; s < L; s += 10) { main.at(s, tmp, tt); const d = tmp.distanceToSquared(pad); if (d < bd) { bd = d; best = s; } }
    const sExit = best - 520, sJoin = best + 520;
    const lat = 30;
    const at = (s) => {
      const r = main.at(s, new THREE.Vector3(), new THREE.Vector3());
      const side = new THREE.Vector3().crossVectors(r.t, new THREE.Vector3(0, 1, 0)).normalize();
      return { p: r.p.clone().addScaledVector(side, lat), t: r.t.clone() };
    };
    const pts = [];
    // ride the motorway from the on-ramp all the way round to the off-ramp
    for (let s = sJoin; s <= sExit + L; s += 40) pts.push(at(s).p);
    const e = at(sExit), j = at(sJoin);
    // approach: glide off the motorway, flare and settle onto the pad
    const tan = new THREE.Vector3().subVectors(j.p, e.p).setY(0).normalize();
    const padIn = pad.clone().addScaledVector(tan, -70).addScaledVector(out, 20).add(new THREE.Vector3(0, 22, 0));
    const padOut = pad.clone().addScaledVector(tan, 70).addScaledVector(out, 20).add(new THREE.Vector3(0, 22, 0));
    const midIn = e.p.clone().lerp(padIn, 0.55); midIn.y = e.p.y + (padIn.y - e.p.y) * 0.7;
    const midOut = padOut.clone().lerp(j.p, 0.45); midOut.y = padOut.y + (j.p.y - padOut.y) * 0.3;
    const hover = pad.clone().addScaledVector(tan, -18).add(new THREE.Vector3(0, 5, 0));
    const lift = pad.clone().addScaledVector(tan, 18).add(new THREE.Vector3(0, 5, 0));
    pts.push(e.p.clone().addScaledVector(e.t, 120), midIn, padIn, hover, pad.clone(), lift, padOut, midOut, j.p.clone().addScaledVector(j.t, -120));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    let dense = curve.getSpacedPoints(Math.ceil(curve.getLength() / 4));
    dense.pop();
    // validate everything except the final flare onto the pad
    const padIdx = dense.reduce((bi, p, i) => (p.distanceToSquared(pad) < dense[bi].distanceToSquared(pad) ? i : bi), 0);
    if (this.clear) {
      let worst = 1e9, wat = null;
      dense.forEach((p, i) => {
        const di = Math.min(Math.abs(i - padIdx), dense.length - Math.abs(i - padIdx));
        if (di * 4 < 160) return;
        const c = Math.min(this.clear.clearance(p, { skyport }), this.promenadeClear(p));
        if (c < worst) { worst = c; wat = p; }
      });
      this.report.push({ name, worst: Math.round(worst), at: wat ? [Math.round(wat.x), Math.round(wat.y), Math.round(wat.z)] : null });
    }
    const route = this.bank.add({ polyline: dense, speed: (s, Lr, p) => (p.distanceTo(pad) < 420 ? 22 : 58), accel: 2.2, decel: 2.0, stops: [{ s: this._arcAt(dense, padIdx), dwell }], pitchSpeeds: [6, 34] });
    route.name = name;
    const n = cars;
    for (let k = 0; k < n; k++) this.addVehicle('car', route, { phase: k / n + this.rnd() * 0.02, rate: 1 / route.period, lat: 0, up: 0 });
    return route;
  }

  _arcAt(pts, idx) { let s = 0; for (let i = 1; i <= idx; i++) s += pts[i].distanceTo(pts[i - 1]); return s; }

  buildShipRoutes() {
    const S = new THREE.Vector3(SKYPORT.x, SKYPORT.y, SKYPORT.z);
    const specs = [
      { cls: 'ark', scale: 290, slotA: 0.3 + (0.5 / 10) * TAU, heading: 0.35, n: 2 },
      { cls: 'liner', scale: 190, slotA: 0.3 + (5.5 / 10) * TAU, heading: -0.4, n: 2 },
      { cls: 'liner', scale: 160, slotA: 0.3 + (3 / 10) * TAU, heading: 0.9, n: 2 },
      { cls: 'ark', scale: 240, slotA: 0.3 + (7.5 / 10) * TAU, heading: 0.05, n: 1 },
    ];
    for (const sp of specs) {
      const slotR = SKYPORT.r + 230;
      const slot = new THREE.Vector3(S.x + Math.cos(sp.slotA) * slotR, S.y + 30, S.z + Math.sin(sp.slotA) * slotR);
      const h = new THREE.Vector3(Math.cos(sp.heading), 0, Math.sin(sp.heading));     // departure heading (roughly east = prograde)
      const hr = h.clone().multiplyScalar(-1);
      const P = (base, dx, dy) => base.clone().addScaledVector(h, dx).add(new THREE.Vector3(0, dy, 0));
      const back = (dx, dy) => slot.clone().addScaledVector(hr, dx).add(new THREE.Vector3(0, dy, 0));
      const pts = [
        slot.clone(),
        P(slot, 2, 60), P(slot, 20, 260), P(slot, 400, 900), P(slot, 2200, 2600), P(slot, 7000, 8000), P(slot, 17000, 19000), P(slot, 34000, 38000), P(slot, 52000, 60000),
        // hidden transfer back to the western approach
        P(slot, 30000, 90000), back(40000, 90000), back(52000, 60000),
        back(30000, 30000), back(14000, 12000), back(5500, 3800), back(1600, 900), back(420, 240), back(60, 60),
      ];
      const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
      let dense = curve.getSpacedPoints(Math.ceil(curve.getLength() / 20));
      dense.pop();
      // arc positions of the hidden stretch
      let s = 0, sHide0 = 0, sHide1 = 0;
      const arcs = [0];
      for (let i = 1; i < dense.length; i++) { s += dense[i].distanceTo(dense[i - 1]); arcs.push(s); }
      const Ltot = s + dense[0].distanceTo(dense[dense.length - 1]);
      // hide where altitude > 52 km
      let inHide = false;
      for (let i = 0; i < dense.length; i++) {
        const hi = dense[i].y - S.y > 52000;
        if (hi && !inHide) { sHide0 = arcs[i]; inHide = true; }
        if (!hi && inHide) { sHide1 = arcs[i]; inHide = false; }
      }
      const route = this.bank.add({
        polyline: dense,
        speed: (sa, L, p) => { const alt = Math.max(0, p.y - S.y); return Math.min(3200, 12 + alt * 0.07 + Math.pow(alt, 1.25) * 0.004); },
        accel: 14, decel: 9, latAccel: 20, bankMax: 0.25, pitchSpeeds: [40, 420],
        stops: [{ s: 0, dwell: 70 }],
        hidden: [[sHide0, sHide1]], hideFade: 6000,
        thrust: (sa, L, v, a, p) => {
          const alt = p.y - S.y;
          if (alt < 20) return 0.15;
          const climbing = sa < sHide0;
          return climbing ? Math.min(1, 0.35 + Math.max(0, a) * 0.06 + Math.min(alt, 6000) / 9000) : 0.22 + Math.max(0, -a) * 0.03;
        },
      });
      route.name = `ship-${sp.cls}`;
      void Ltot;
      for (let k = 0; k < sp.n; k++) this.addVehicle(sp.cls, route, { phase: k / sp.n + 0.13 * specs.indexOf(sp), rate: 1 / route.period, scale: sp.scale, lat: 0, up: 0 });
    }
  }

  // ------------------------------------------------------------- spawning --
  addVehicle(cls, route, { phase, rate, scale, lat = 0, up = 0, variant }) {
    const rnd = this.rnd;
    this.fleet[cls].push({
      cls, row: route.row, phase: ((phase % 1) + 1) % 1, rate,
      scale: scale ?? (cls === 'car' ? 0.92 + rnd() * 0.18 : cls === 'ferry' ? 0.9 + rnd() * 0.2 : 0.9 + rnd() * 0.2),
      lat, up, variant: variant ?? rnd(), seed: rnd(), rank: (cls === 'ark' || cls === 'liner') ? -1 : rnd(),
    });
  }

  spawnLane(route, cls, { lat = 0, up = 0, mul = 1, dir = 1, perKm = 3, minGap = 2.6, variant }) {
    const rnd = this.rnd;
    const period = route.period / mul;
    let n = Math.floor((route.length / 1000) * perKm);
    n = Math.min(n, Math.floor(period / minGap));
    if (n <= 0) return;
    const rate = (dir * mul) / route.period;
    for (let k = 0; k < n; k++) {
      if (rnd() < 0.12 && n > 6) continue;             // natural gaps between platoons
      const phase = (k + (rnd() - 0.5) * 0.5) / n;
      this.addVehicle(cls, route, { phase, rate, lat, up, variant: variant ? variant() : undefined });
    }
  }

  hoopsAlong(route, { lat = 0, up = 0, r = 24, every = 500, color = 0, onlyStraight = false, maxR = 1e9 }) {
    const L = route.length;
    const p = new THREE.Vector3(), t = new THREE.Vector3(), t2 = new THREE.Vector3();
    for (let s = every * 0.5; s < L; s += every) {
      route.at(s, p, t);
      if (Math.hypot(p.x, p.z) > maxR) continue;
      if (onlyStraight) {
        route.at(s + 120, new THREE.Vector3(), t2);
        if (t.dot(t2) < 0.995) continue;
      }
      const side = new THREE.Vector3().crossVectors(t, new THREE.Vector3(0, 1, 0)).normalize();
      const c = p.clone().addScaledVector(side, lat).add(new THREE.Vector3(0, up, 0));
      if (this.clear && this.clear.clearance(c, { skyport: false }) < r + 10) continue;
      this.hoops.push({ p: c, t: t.clone(), r, arc: s, color, dirSign: 1 });
    }
  }

  beaconsAlong(route, { edges = [0], up = 0, every = 90, color = 0, onlyStraight = false, maxR = 1e9 }) {
    const L = route.length;
    const p = new THREE.Vector3(), t = new THREE.Vector3(), t2 = new THREE.Vector3(), side = new THREE.Vector3();
    for (let s = 0; s < L; s += every) {
      route.at(s, p, t);
      if (Math.hypot(p.x, p.z) > maxR) continue;
      if (onlyStraight) { route.at(s + 150, new THREE.Vector3(), t2); if (t.dot(t2) < 0.995) continue; }
      side.crossVectors(t, new THREE.Vector3(0, 1, 0)).normalize();
      for (const e of edges) this.beacons.push({ p: p.clone().addScaledVector(side, e).add(new THREE.Vector3(0, up, 0)), arc: s, color });
    }
  }

  buildBeacons() {
    const n = this.beacons.length;
    if (!n) return;
    const pos = new Float32Array(n * 3), info = new Float32Array(n * 2);
    this.beacons.forEach((b, i) => { pos.set([b.p.x, b.p.y, b.p.z], i * 3); info.set([b.arc, b.color], i * 2); });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uCityLights: U.uCityLights, uPx: this.lightMat.uniforms.uPx },
      vertexShader: /* glsl */ `
uniform float uTime; uniform float uCityLights; uniform float uPx;
attribute vec2 aInfo;
varying vec3 vCol; varying float vI;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  float d = -mv.z;
  float proj = 0.5 * uPx / max(d, 1.0);
  float ratio = min(1.0, proj / 1.3);
  // a slow wave of light runs along each motorway in the direction of travel
  float chase = pow(fract(aInfo.x / 1800.0 - uTime * 0.06), 10.0);
  vI = uCityLights * (0.25 + 0.9 * chase) * 3.0 * ratio * sqrt(ratio) * (1.0 - smoothstep(6000.0, 11000.0, d));
  vCol = aInfo.y < 0.5 ? vec3(0.5, 0.95, 0.9) : vec3(1.0, 0.82, 0.55);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = vI > 0.003 ? max(proj, 1.3) * 3.0 : 0.0;
}`,
      fragmentShader: /* glsl */ `
varying vec3 vCol; varying float vI;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 9.0;
  gl_FragColor = vec4(vCol * vI * (exp(-r2 * 3.0) + 0.15 * exp(-sqrt(r2) * 2.0)), 1.0);
}`,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    pts.name = 'lane-beacons';
    this.group.add(pts);
  }

  // ------------------------------------------------------------- meshes ----
  vehicleMaterial(cls) {
    const ci = CLS[cls];
    const ship = ci >= 4;
    return patchedMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.4, envMapIntensity: 1.25, side: ship ? THREE.DoubleSide : THREE.FrontSide }, {
      key: `veh-${cls}`,
      uniforms: {
        uRoutes: { value: this.tex },
        uCull: { value: ship ? 1e6 : cls === 'ferry' ? 260 : 380 },
        uModelLen: { value: MODEL_LEN[cls] },
        uClass: { value: ci },
        uSeam: { value: ship ? 0.012 : cls === 'ferry' ? 2.4 : 1.15 },
      },
      vertex: {
        pars: VEH_VERT_PARS,
        preNormal: 'vehicleSetup(); objectNormal = vhRot * vhSpin(objectNormal);',
        transform: 'vLocal = transformed; transformed = vhOn > 0.5 ? vhRot * (vhSpin(transformed) * aRoute.w) + vhPos : vhPos;',
      },
      fragment: { pars: VEH_FRAG_PARS, color: VEH_COLOR, surface: VEH_SURFACE, emissive: VEH_EMISSIVE },
    });
  }

  buildFleetMeshes() {
    const geos = { car: airCarGeometry(), ferry: ferryGeometry(), cargo: cargoDroneGeometry(), service: serviceGeometry(), ark: arkGeometry(), liner: linerGeometry() };
    this.meshes = {};
    this.stats = { vehicles: 0, tris: 0 };
    for (const cls of CLASSES) {
      const list = this.fleet[cls].sort((a, b) => a.rank - b.rank);
      if (!list.length) continue;
      const geo = geos[cls];
      const ig = new THREE.InstancedBufferGeometry();
      ig.index = geo.index;
      for (const k of Object.keys(geo.attributes)) ig.setAttribute(k, geo.attributes[k]);
      const route = new Float32Array(list.length * 4), lane = new Float32Array(list.length * 4);
      list.forEach((v, i) => { route.set([v.row, v.phase, v.rate, v.scale], i * 4); lane.set([v.lat, v.up, v.variant, v.seed], i * 4); });
      ig.setAttribute('aRoute', new THREE.InstancedBufferAttribute(route, 4));
      ig.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 4));
      ig.instanceCount = list.length;
      const mesh = new THREE.Mesh(ig, this.vehicleMaterial(cls));
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.layers.set(1);
      mesh.name = `traffic-${cls}`;
      this.group.add(mesh);
      this.meshes[cls] = { mesh, geo: ig, list };
      this.stats.vehicles += list.length;
      this.stats.tris += list.length * geo.index.count / 3;
    }
  }

  buildLights() {
    const all = [];
    for (const cls of CLASSES) for (const v of this.fleet[cls]) all.push(v);
    all.sort((a, b) => a.rank - b.rank);
    this.lightList = all;
    const ig = new THREE.InstancedBufferGeometry();
    ig.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    ig.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    ig.setIndex([0, 1, 2, 0, 2, 3]);
    const route = new Float32Array(all.length * 4), lane = new Float32Array(all.length * 4), kind = new Float32Array(all.length);
    all.forEach((v, i) => { route.set([v.row, v.phase, v.rate, v.scale], i * 4); lane.set([v.lat, v.up, v.variant, v.seed], i * 4); kind[i] = CLS[v.cls]; });
    ig.setAttribute('aRoute', new THREE.InstancedBufferAttribute(route, 4, false, 6));
    ig.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 4, false, 6));
    ig.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1, false, 6));
    ig.instanceCount = all.length * 6;
    const LP = [], LC = [];
    for (const cls of CLASSES) {
      const set = LIGHTS[cls === 'ark' || cls === 'liner' ? 'ship' : cls];
      for (const l of set) { LP.push(new THREE.Vector4(l.p[0], l.p[1], l.p[2], l.type)); LC.push(new THREE.Vector4(l.size, l.i, 0, 0)); }
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: U.uTime, uCityLights: U.uCityLights, uRoutes: { value: this.tex },
        uPx: { value: 500 }, uMinPx: { value: 1.35 }, uStreak: { value: 0.09 }, uRes: { value: new THREE.Vector2(1920, 1080) },
        uLP: { value: LP }, uLC: { value: LC }, uModelLen: { value: CLASSES.map((c) => MODEL_LEN[c]) },
      },
      vertexShader: LIGHT_VERT, fragmentShader: LIGHT_FRAG,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.lightMat = mat;
    const mesh = new THREE.Mesh(ig, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.name = 'traffic-lights';
    this.group.add(mesh);
    this.lights = { mesh, geo: ig };
  }

  buildHoops() {
    if (!this.hoops.length) return;
    const ring = new THREE.TorusGeometry(1, 0.028, 6, 56);
    const parts = [ring];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + TAU / 8;
      parts.push(new THREE.CapsuleGeometry(0.045, 0.1, 2, 6).rotateX(Math.PI / 2).translate(Math.cos(a), Math.sin(a), 0));
    }
    const inner = new THREE.TorusGeometry(0.965, 0.008, 4, 56);
    parts.push(inner);
    for (const g of parts) { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); }
    const nPer = parts.map((g) => g.attributes.position.count);
    const geo = mergeGeometries(parts, false);
    // aGlow: 1 on the inner light ring, 0.5 on the beacon pods
    const glow = new Float32Array(geo.attributes.position.count);
    let o = 0;
    nPer.forEach((n, i) => { const v = i === 0 ? 0 : i === parts.length - 1 ? 1 : 0.5; glow.fill(v, o, o + n); o += n; });
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    const hp = new Float32Array(this.hoops.length * 2);
    this.hoops.forEach((h, i) => { hp[i * 2] = h.arc; hp[i * 2 + 1] = h.color; });
    geo.setAttribute('aHoop', new THREE.InstancedBufferAttribute(hp, 2));
    const mat = patchedMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.55, envMapIntensity: 1.2 }, {
      key: 'lane-hoops',
      vertex: { pars: 'attribute float aGlow; attribute vec2 aHoop; varying float vGlow; varying vec2 vHoop;', transform: 'vGlow = aGlow; vHoop = aHoop;\n#ifdef USE_INSTANCING\nif (distance(instanceMatrix[3].xyz, cameraPosition) > 2600.0) transformed *= 0.0;\n#endif' },
      fragment: {
        pars: 'varying float vGlow; varying vec2 vHoop;',
        color: 'diffuseColor.rgb = mix(vec3(0.9, 0.89, 0.86), vec3(0.08), step(0.25, vGlow));',
        emissive: /* glsl */ `
{
  vec3 col = vHoop.y < 0.5 ? vec3(0.45, 0.9, 0.86) : vec3(1.0, 0.8, 0.5);
  // a slow chase of light running along the corridor in the direction of travel
  float chase = pow(fract(vHoop.x / 2600.0 - uTime * 0.045), 16.0);
  float dist = distance(vWPos, cameraPosition);
  float far = 1.0 - smoothstep(700.0, 1800.0, dist);
  float ringFar = 1.0 - smoothstep(250.0, 700.0, dist);
  float ring = step(0.75, vGlow) * (0.02 + 0.45 * uCityLights * (0.3 + 0.7 * chase)) * ringFar;
  float pod = step(0.25, vGlow) * step(vGlow, 0.75) * (0.3 + 1.2 * uCityLights) * (0.6 + 0.4 * sin(uTime * 2.0 + vHoop.x * 0.01)) * far;
  totalEmissiveRadiance += col * (ring + pod);
}`,
      },
    });
    const mesh = new THREE.InstancedMesh(geo, mat, this.hoops.length);
    const m4 = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
    this.hoops.forEach((h, i) => {
      const z = h.t.clone().normalize();
      const x = new THREE.Vector3().crossVectors(up, z).normalize();
      const y = new THREE.Vector3().crossVectors(z, x);
      m4.makeBasis(x.multiplyScalar(h.r), y.multiplyScalar(h.r), z.multiplyScalar(h.r));
      m4.setPosition(h.p);
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.name = 'lane-hoops';
    this.group.add(mesh);
    this.hoopMesh = mesh;
  }

  buildPads() {
    if (!this.pads.length) return;
    const parts = [];
    for (const pd of this.pads) {
      const prof = [[0.2, -5.5], [4, -4.8], [11, -2.4], [pd.r, -0.4], [pd.r + 0.4, 0.2], [pd.r - 0.4, 0.7], [0.2, 0.7]].map(([r, y]) => new THREE.Vector2(r, y));
      const g = new THREE.LatheGeometry(prof, 40);
      const ringG = new THREE.TorusGeometry(pd.r * 0.72, 0.18, 4, 48).rotateX(Math.PI / 2).translate(0, 0.75, 0);
      const pylon = new THREE.CylinderGeometry(0.25, 0.25, 3.5, 6).translate(pd.r - 1.2, 2.4, 0);
      const beacon = new THREE.SphereGeometry(0.45, 8, 6).translate(pd.r - 1.2, 4.3, 0);
      const chev = new THREE.BoxGeometry(0.6, 0.05, 6).translate(0, 0.74, 0);
      const list = [[g, 0], [ringG, 1], [pylon, 0], [beacon, 2], [chev, 1]];
      const merged = mergeGeometries(list.map(([gg, id]) => {
        for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal') gg.deleteAttribute(k);
        const gi = gg.index ? gg : gg;
        gi.setAttribute('aPad', new THREE.BufferAttribute(new Float32Array(gi.attributes.position.count).fill(id), 1));
        return gi;
      }), false);
      merged.rotateY(Math.atan2(pd.out.x, pd.out.z));
      merged.translate(pd.p.x, pd.p.y, pd.p.z);
      parts.push(merged);
    }
    const geo = mergeGeometries(parts, false);
    const mat = patchedMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.3 }, {
      key: 'sky-docks',
      vertex: { pars: 'attribute float aPad; varying float vPad;', transform: 'vPad = aPad;' },
      fragment: {
        pars: 'varying float vPad;',
        color: 'diffuseColor.rgb = vPad < 0.5 ? vec3(0.88, 0.87, 0.84) : vec3(0.1);',
        emissive: /* glsl */ `
if (vPad > 0.5 && vPad < 1.5) totalEmissiveRadiance += vec3(0.45, 0.9, 0.86) * (0.25 + 1.4 * uCityLights) * (0.75 + 0.25 * sin(uTime * 1.5));
if (vPad > 1.5) totalEmissiveRadiance += vec3(1.0, 0.25, 0.1) * (1.0 + 3.0 * uCityLights) * step(0.5, fract(uTime * 0.7));`,
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = 'sky-docks';
    this.group.add(mesh);
  }

  // Starship engine plumes and climb-out trails
  buildShipFx() {
    const ships = [...this.fleet.ark, ...this.fleet.liner];
    if (!ships.length) return;
    const K = 96;
    // trail ribbon: K rings x 2 sides, instanced per ship
    const pos = [], idx = [];
    for (let k = 0; k <= K; k++) { pos.push(k / K, -1, 0, k / K, 1, 0); if (k < K) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    const tg = new THREE.InstancedBufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tg.setIndex(idx);
    const route = new Float32Array(ships.length * 4), lane = new Float32Array(ships.length * 4);
    ships.forEach((v, i) => { route.set([v.row, v.phase, v.rate, v.scale], i * 4); lane.set([v.lat, v.up, v.variant, v.seed], i * 4); });
    tg.setAttribute('aRoute', new THREE.InstancedBufferAttribute(route, 4));
    tg.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 4));
    tg.instanceCount = ships.length;
    const trailMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uRoutes: { value: this.tex }, uSunDir: U.uSunDir, uSunColor: U.uSunColor, uCityLights: U.uCityLights, uTrailSec: { value: 85 } },
      vertexShader: /* glsl */ `
uniform float uTime; uniform float uTrailSec; uniform vec3 uSunDir;
${ROUTE_GLSL}
attribute vec4 aRoute; attribute vec4 aLane;
varying float vAge; varying float vI; varying float vLit; varying float vAcross; varying float vHot;
void main() {
  float age = position.x;                         // 0 at the ship, 1 at the far end
  float ph = aRoute.y + uTime * aRoute.z - age * uTrailSec * aRoute.z;
  RouteFrame fr = routeAt(aRoute.x, ph);
  vec3 side; mat3 R = routeBasis(fr, 1.0, side);
  vec3 p = fr.pos + R * vec3(0.0, 0.0, -0.56 * aRoute.w);
  float t = age * uTrailSec;
  // exhaust spreads and drifts with the upper winds as it ages
  float w = aRoute.w * 0.03 + t * 1.5 + t * t * 0.018;
  p += vec3(0.6, 0.0, 0.25) * t * t * 0.35;
  vec3 toCam = normalize(cameraPosition - p);
  vec3 across = normalize(cross(fr.fwd, toCam) + 1e-5);
  p += across * position.y * w;
  float alt = max(p.y, 0.0);
  float dip = sqrt(2.0 * alt / 6.36e6);
  vLit = smoothstep(-dip - 0.015, -dip + 0.01, uSunDir.y);
  float climbing = smoothstep(2.0, 40.0, fr.climb);
  vI = fr.vis * climbing * smoothstep(0.0, 0.02, age) * (1.0 - smoothstep(0.55, 1.0, age)) * smoothstep(1700.0, 2800.0, alt);
  vHot = fr.thrust * exp(-t * 0.45);
  vAge = age;
  vAcross = position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform vec3 uSunColor; uniform float uCityLights;
varying float vAge; varying float vI; varying float vLit; varying float vAcross; varying float vHot;
void main() {
  float prof = exp(-vAcross * vAcross * 3.0);
  // turbulent puffs along the column
  float puff = 0.65 + 0.35 * sin(vAge * 173.0 + vAcross * 2.0) * sin(vAge * 61.0 - vAcross * 1.3);
  vec3 sunCol = uSunColor / max(max(uSunColor.r, max(uSunColor.g, uSunColor.b)), 1e-3);
  vec3 lit = mix(vec3(1.0, 0.62, 0.45), vec3(1.0, 0.95, 0.9), smoothstep(0.2, 0.9, sunCol.b)) * 0.55;
  vec3 vapour = mix(vec3(0.4, 0.5, 0.8) * 0.012, lit, vLit) * puff * pow(max(1.0 - vAge, 0.0), 1.5);
  vec3 hot = vec3(0.55, 0.72, 1.0) * vHot * 2.2;
  vec3 col = (vapour + hot) * prof * vI;
  gl_FragColor = vec4(col, 1.0);
}`,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, side: THREE.DoubleSide,
    });
    const trail = new THREE.Mesh(tg, trailMat);
    trail.frustumCulled = false;
    trail.renderOrder = 4;
    trail.name = 'ship-trails';
    this.group.add(trail);
    // plumes: a camera-facing flame along the engine axis
    const pg = new THREE.InstancedBufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    pg.setIndex([0, 1, 2, 0, 2, 3]);
    pg.setAttribute('aRoute', tg.attributes.aRoute);
    pg.setAttribute('aLane', tg.attributes.aLane);
    pg.instanceCount = ships.length;
    const plumeMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uRoutes: { value: this.tex } },
      vertexShader: /* glsl */ `
uniform float uTime;
${ROUTE_GLSL}
attribute vec4 aRoute; attribute vec4 aLane;
varying vec2 vUv; varying float vT;
void main() {
  RouteFrame fr = routeAt(aRoute.x, aRoute.y + uTime * aRoute.z);
  vec3 side; mat3 R = routeBasis(fr, 1.0, side);
  float s = aRoute.w;
  vec3 e = fr.pos + R * vec3(0.0, 0.0, -0.53 * s);
  float len = s * (0.15 + 1.1 * fr.thrust) * fr.vis;
  vec3 axis = -R[2];
  vec3 toCam = normalize(cameraPosition - e);
  vec3 across = normalize(cross(axis, toCam) + 1e-5);
  vec3 p = e + axis * position.x * len + across * position.y * s * 0.06 * (1.0 + position.x * 0.8);
  vUv = position.xy; vT = fr.thrust * fr.vis;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform float uTime;
varying vec2 vUv; varying float vT;
void main() {
  float x = vUv.x, y = abs(vUv.y);
  float w = mix(0.5, 1.0, x);
  float core = exp(-y * y / (w * w) * 9.0);
  float diamonds = 0.7 + 0.3 * cos(x * 38.0 - uTime * 60.0);
  float fade = pow(max(1.0 - x, 0.0), 1.6);
  vec3 col = mix(vec3(0.95, 0.97, 1.0), vec3(0.4, 0.55, 1.0), smoothstep(0.0, 0.5, x));
  col = mix(col, vec3(0.75, 0.45, 1.0), smoothstep(0.4, 1.0, x) * 0.6);
  gl_FragColor = vec4(col * core * diamonds * fade * vT * 14.0, 1.0);
}`,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, side: THREE.DoubleSide,
    });
    const plume = new THREE.Mesh(pg, plumeMat);
    plume.frustumCulled = false;
    plume.renderOrder = 5;
    plume.name = 'ship-plumes';
    this.group.add(plume);
  }

  // --------------------------------------------------------------- runtime --
  applyQuality(s) {
    this.settings = s;
    this.density = -1;
  }

  setSize(w, h) { this.viewH = h; this.lightMat.uniforms.uRes.value.set(w, h); }

  update(dt) {
    const app = this.world && this.world.app;
    const cam = app && app.camera;
    if (cam && this.viewH) {
      const px = this.viewH / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5));
      this.lightMat.uniforms.uPx.value = px;
    }
    // quieter skies in the small hours
    const h = app ? app.hours : 12;
    const lull = (h > 1.5 && h < 5) ? 0.55 : (h > 0.5 && h < 6) ? 0.75 : 1.0;
    const d = Math.round((this.settings.traffic ?? 1) * lull * 0.7 * 100) / 100;
    if (d !== this.density) {
      this.density = d;
      for (const cls of CLASSES) {
        const m = this.meshes[cls];
        if (!m) continue;
        m.geo.instanceCount = countBelow(m.list, d);
      }
      // lights follow the same ranking (ships rank -1, always present)
      this.lights.geo.instanceCount = countBelow(this.lightList, d) * 6;
    }
  }
}

function countBelow(list, d) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].rank < d) lo = m + 1; else hi = m; }
  return lo;
}
