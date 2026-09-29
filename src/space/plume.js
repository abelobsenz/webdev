import * as THREE from 'three';
import { U } from '../core/uniforms.js';

// Volumetric exhaust for the Lodestar (metres; the parent carries the km scale), drawn as rocket
// exhaust looks when filmed in vacuum. Each plume is a wide cone proxy whose fragments march rays
// through an analytic emission field in the jet's own frame (axis +Z, exit plane at z = 0). Every
// term is a Gaussian in radius whose width grows with distance and whose strength falls smoothly to
// zero well inside the proxy (at least 3.5 sigma from every wall, and a taper before the far end),
// so no edge of the proxy can ever show:
//
//   exit     the white-hot flow leaving the throat: a narrow, intense Gaussian that dies within a
//            nozzle radius or so - it is what blooms
//   jet      the coherent core: it spreads only a few degrees and stays luminous for several nozzle
//            lengths, thinning as (R0/Rc)^2 (mass conservation)
//   envelope the under-expanded fringe: in vacuum the flow keeps turning outward at the lip, so a
//            vast, faint envelope opens at ~25 degrees and fades organically with distance
//   flow     domain-warped noise advected downstream (the turbulence visibly streams away), a slow
//            swirl, and a slight flicker of the whole jet
//
// Two marches per fragment: one through a narrow cylinder round the core (so the bright, thin parts
// are sampled finely from any angle) and one through the wide envelope. Main engines EMIT (hydrogen
// plasma: a white core, pale blue jet, faint violet-rose Balmer glow in the envelope). RCS
// thrusters are cold gas: their puffs only SCATTER sunlight and go dark in the Earth's shadow.
// Ignition grows the jet out of the nozzle; cut-off detaches its tail, which drifts downstream.

const VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uCam;                  // camera, object space (metres)
uniform float uR0, uLen, uTanC, uTanE, uRbC, uRbE, uLc, uLe, uAx, uAc, uAe;
uniform float uThrust, uStart, uGrow, uTime, uFlow, uSunE, uGain, uStepsC, uStepsE;
uniform vec3 uExitCol, uCoreCol, uFarCol, uEnvCol;
varying vec3 vPos;

float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// ray against a cylinder (axis z, radius R, 0 <= z <= uLen): entry and exit distances
vec2 cylinder(vec3 ro, vec3 rd, float R) {
  float a = dot(rd.xy, rd.xy), b = dot(ro.xy, rd.xy), c = dot(ro.xy, ro.xy) - R * R;
  vec2 t = vec2(-1e9, 1e9);
  if (a > 1e-9) {
    float d = b * b - a * c;
    if (d < 0.0) return vec2(1.0, 0.0);
    float s = sqrt(d);
    t = vec2((-b - s) / a, (-b + s) / a);
  } else if (c > 0.0) return vec2(1.0, 0.0);
  if (abs(rd.z) > 1e-9) {
    float z0 = (0.0 - ro.z) / rd.z, z1 = (uLen - ro.z) / rd.z;
    t = vec2(max(t.x, min(z0, z1)), min(t.y, max(z0, z1)));
  } else if (ro.z < 0.0 || ro.z > uLen) return vec2(1.0, 0.0);
  return t;
}

// soft ignition front and detached tail
float front(float s) { return smoothstep(uStart, uStart + uR0 * 2.0, s) * (1.0 - smoothstep(uGrow - uR0 * 3.0, uGrow, s)); }

// turbulence carried downstream with the flow (domain-warped), 0..1 around 0.5
float turb(vec3 p, float s, float R) {
  float ang = atan(p.y, p.x + 1e-6) + s * 0.05 / uR0 - uTime * 0.5;
  float rr = length(p.xy) / max(R, 1e-4);
  vec3 q = vec3(cos(ang) * rr * 1.6, sin(ang) * rr * 1.6, s / uR0 * 0.32 - uTime * uFlow);
  vec3 w = vec3(vnoise3(q * 0.6 + 3.1), vnoise3(q * 0.6 + 17.3), 0.0) * 1.3;
  return 0.6 * vnoise3(q * 1.3 + w) + 0.4 * vnoise3(q * 2.9 + w * 1.7 + 5.3);
}

void main() {
  if (uThrust < 1e-3) discard;
  vec3 ro = uCam, rd = normalize(vPos - uCam);
  float jit = h13(vec3(gl_FragCoord.xy, fract(uTime * 13.7) * 91.0));
  vec3 acc = vec3(0.0);
  // ---- the core: exit flow and the coherent jet, sampled finely inside a narrow cylinder
  vec2 tc = cylinder(ro, rd, uRbC);
  float c0 = max(tc.x, 0.0), c1 = tc.y;
  if (c1 > c0) {
    float dt = (c1 - c0) / uStepsC;
    for (int i = 0; i < 48; i++) {
      if (float(i) >= uStepsC) break;
      vec3 p = ro + rd * (c0 + (float(i) + jit) * dt);
      float s = p.z, r2 = dot(p.xy, p.xy);
      float Rc = uR0 * 0.8 + s * uTanC, sc = 0.42 * Rc, sx = 0.33 * uR0;
      float ex = uAx * exp(-r2 / (2.0 * sx * sx)) * exp(-s / (0.8 * uR0));
      float jet = uAc * (uR0 * uR0) / (Rc * Rc) * exp(-r2 / (2.0 * sc * sc)) * exp(-s / uLc);
      float n = turb(p, s, Rc);
      jet *= mix(1.0, 0.45 + 1.1 * n, smoothstep(uR0, uR0 * 6.0, s));
      float tail = 1.0 - smoothstep(uLen * 0.55, uLen * 0.97, s);
      vec3 cj = mix(uCoreCol, uFarCol, smoothstep(0.0, uLc * 1.6, s));
      acc += (uExitCol * ex + cj * jet) * front(s) * tail * dt;
    }
  }
  // ---- the envelope: wide and faint, fading long before the proxy's walls and end
  vec2 te = cylinder(ro, rd, uRbE);
  float e0 = max(te.x, 0.0), e1 = te.y;
  if (e1 > e0) {
    float dt = (e1 - e0) / uStepsE;
    for (int i = 0; i < 40; i++) {
      if (float(i) >= uStepsE) break;
      vec3 p = ro + rd * (e0 + (float(i) + fract(jit + 0.37)) * dt);
      float s = p.z, r2 = dot(p.xy, p.xy);
      float Re = uR0 * 0.95 + s * uTanE, se = 0.55 * Re;
      float env = uAe * (uR0 * uR0) / (Re * Re) * exp(-r2 / (2.0 * se * se)) * exp(-s / uLe);
      env *= smoothstep(0.0, uR0 * 2.5, s) * (1.0 - smoothstep(uLen * 0.4, uLen * 0.95, s));
      float n = turb(p * vec3(1.0, 1.0, 0.7), s, Re);
      env *= 0.25 + 1.5 * n * n;
      acc += uEnvCol * env * front(s) * dt;
    }
  }
  float flick = 0.965 + 0.035 * sin(uTime * 37.0) * sin(uTime * 23.3 + 1.7);
  acc *= uThrust * uGain * uSunE * flick / uR0;
  gl_FragColor = vec4(acc, 0.0);
}`;

const _v = new THREE.Vector3();

/**
 * A volumetric jet. Options (metres): r0 exit radius, len visible length, coreAngle / envAngle
 * (half-angles, rad), lc / le decay lengths (metres), ax / ac / ae strengths of the exit, jet and
 * envelope, colours, gain, flow (noise units per second streaming downstream), step counts.
 */
export function createPlume({ r0, len, coreAngle = 0.07, envAngle = 0.44, lc = null, le = null, ax = 5, ac = 1.2, ae = 0.2,
  exit = [1.0, 0.98, 1.0], core = [0.8, 0.88, 1.0], far = [0.45, 0.55, 1.0], env = [0.62, 0.42, 1.0], gain = 1, flow = 1.1, stepsC = 32, stepsE = 24 }) {
  const tanC = Math.tan(coreAngle), tanE = Math.tan(envAngle);
  // walls 3.5 sigma out from the widest Gaussian they hold (core cylinder); the envelope wall
  // 3.5 sigma out where the envelope still shows and 2.8 sigma where it has tapered away
  const RbC = 3.5 * Math.max(0.42 * (r0 * 0.8 + len * tanC), 0.33 * r0);
  const RbE = Math.max(3.5 * 0.55 * (r0 * 0.95 + len * 0.6 * tanE), 2.8 * 0.55 * (r0 * 0.95 + len * tanE), RbC);
  const near = Math.max(3.5 * 0.55 * r0 * 1.4, RbC);
  const g = new THREE.CylinderGeometry(RbE, near, len, 48, 8, false);
  g.rotateX(Math.PI / 2);                                             // cylinder axis -> +Z (radiusTop at +Z)
  g.translate(0, 0, len / 2);
  const u = {
    uCam: { value: new THREE.Vector3() }, uR0: { value: r0 }, uLen: { value: len }, uTanC: { value: tanC }, uTanE: { value: tanE },
    uRbC: { value: RbC }, uRbE: { value: RbE }, uLc: { value: lc ?? r0 * 7 }, uLe: { value: le ?? len * 0.3 },
    uAx: { value: ax }, uAc: { value: ac }, uAe: { value: ae },
    uThrust: { value: 0 }, uStart: { value: 0 }, uGrow: { value: len },
    uTime: U.uTime, uFlow: { value: flow }, uSunE: U.uSunIlluminance, uGain: { value: gain }, uStepsC: { value: stepsC }, uStepsE: { value: stepsE },
    uExitCol: { value: new THREE.Color(...exit) }, uCoreCol: { value: new THREE.Color(...core) }, uFarCol: { value: new THREE.Color(...far) }, uEnvCol: { value: new THREE.Color(...env) },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true, side: THREE.FrontSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 18;
  // a camera inside the proxy draws its back faces
  mesh.onBeforeRender = (r, s, cam) => {
    mesh.updateMatrixWorld();
    u.uCam.value.copy(mesh.worldToLocal(_v.copy(cam.position)));
    const c = u.uCam.value, rr = near + (RbE - near) * Math.min(Math.max(c.z / len, 0), 1);
    const inside = c.z > -0.01 && c.z < len && Math.hypot(c.x, c.y) < rr * 1.02;
    mat.side = inside ? THREE.BackSide : THREE.FrontSide;
  };
  // the torch regime whitens the core toward the far colour (0..1)
  const core0 = u.uCoreCol.value.clone(), far0 = u.uFarCol.value.clone(), white = new THREE.Color(1, 0.97, 0.92);
  mesh.setCore = (b) => { u.uCoreCol.value.copy(core0).lerp(white, 0.6 * b); u.uFarCol.value.copy(far0).lerp(core0, 0.45 * b); };
  // state: thrust with ignition growth and a detaching tail at cut-off
  let thrust = 0, grow = len, start = 0, lit = false;
  const speed = len * 1.6;                                            // how fast the front and tail travel (m/s)
  mesh.visible = false;
  mesh.setThrust = (t, dt, light = 1) => {
    if (t > 0.02 && !lit) { lit = true; grow = 0; start = 0; }
    if (t <= 0.02 && lit) { lit = false; start = 0; }
    if (lit) { grow = Math.min(len, grow + speed * dt); start = 0; thrust += (t - thrust) * (1 - Math.exp(-dt * 12)); }
    else { start += speed * dt * 0.8; thrust *= Math.exp(-dt * 1.5); }
    u.uThrust.value = thrust * light;
    u.uGrow.value = grow; u.uStart.value = start;
    mesh.visible = (lit || start < len) && thrust > 2e-3 && light > 1e-3;
  };
  return mesh;
}

/**
 * A cold-gas RCS jet: a small sunlit Gaussian puff along dir from p (metres, hull frame),
 * pulsed like real thrusters (pulse-width modulated at ~12 Hz below full demand).
 */
export function createRcsJet(p, dir) {
  const m = createPlume({ r0: 0.07, len: 2.6, coreAngle: 0.18, envAngle: 0.6, lc: 0.9, le: 0.9, ax: 0.8, ac: 0.9, ae: 0.5,
    exit: [1, 1, 1], core: [0.95, 0.96, 1.0], far: [0.85, 0.88, 0.95], env: [0.8, 0.83, 0.9], gain: 0.2, flow: 3.5, stepsC: 14, stepsE: 10 });
  m.position.copy(p);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  let level = 0, phase = Math.random();
  m.setDemand = (d, dt, sunlit, time) => {
    // pulse-width modulation: fully open at full demand, short pulses at partial demand
    const duty = Math.min(Math.max(d, 0), 1);
    const on = duty > 0.98 || (duty > 0.03 && ((time * 12 + phase) % 1) < duty) ? 1 : 0;
    level += (on - level) * (1 - Math.exp(-dt * (on ? 60 : 18)));
    m.setThrust(level, dt, sunlit);
  };
  return m;
}
