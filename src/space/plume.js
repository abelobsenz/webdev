import * as THREE from 'three';
import { U } from '../core/uniforms.js';

// Volumetric exhaust for the Lodestar (metres; the parent carries the km scale). Each plume is a
// cone proxy whose fragments march a ray through an analytic Gaussian density field in the jet's
// own frame (axis +Z, exit plane at z = 0):
//
//   core   rho = (R0 / Rc(s))^2 exp(-r^2 / 2(0.42 Rc)^2) exp(-s / Lc)   Rc = R0 + s tan(theta)
//          mass conservation thins the jet as it spreads; a Gaussian radial profile
//   halo   the under-expanded fringe: the same law with a wider angle and a longer fade
//   lip    the shear layer at the nozzle lip, bright for the first diameter
//   flow   three octaves of noise advected downstream (so the turbulence visibly streams away),
//          a slow swirl, and a faint combustion shimmer
//
// Main engines EMIT (hot, excited gas: white-blue at the exit cooling to violet downstream).
// RCS thrusters are cold gas: their puffs only SCATTER sunlight (condensed propellant), white,
// dark in the Earth's shadow. Ignition grows the jet out of the nozzle; cut-off detaches its tail,
// which drifts away downstream.

const VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uCam;                  // camera, object space (metres)
uniform float uR0, uLen, uTan, uTanO, uRb, uLc, uLo;
uniform float uThrust, uStart, uGrow, uTime, uFlow, uSunE, uGain, uEmit, uSteps;
uniform vec3 uCoreCol, uFarCol, uHaloCol;
varying vec3 vPos;

float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { return 0.55 * vnoise3(p) + 0.3 * vnoise3(p * 2.03 + 7.1) + 0.15 * vnoise3(p * 4.1 + 13.7); }

// ray against the bounding cylinder (axis z, radius uRb, 0 <= z <= uLen): entry and exit distances
vec2 cylinder(vec3 ro, vec3 rd) {
  float a = dot(rd.xy, rd.xy), b = dot(ro.xy, rd.xy), c = dot(ro.xy, ro.xy) - uRb * uRb;
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

void main() {
  vec3 ro = uCam, rd = normalize(vPos - uCam);
  vec2 tt = cylinder(ro, rd);
  float t0 = max(tt.x, 0.0), t1 = tt.y;
  if (t1 <= t0 || uThrust < 1e-3) discard;
  int N = int(uSteps);
  float dt = (t1 - t0) / uSteps;
  float jit = h13(vec3(gl_FragCoord.xy, fract(uTime * 13.7) * 91.0));
  vec3 acc = vec3(0.0);
  float shimmer = 0.96 + 0.04 * sin(uTime * 31.0) * sin(uTime * 17.3 + 1.7);
  for (int i = 0; i < 64; i++) {
    if (i >= N) break;
    float t = t0 + (float(i) + jit) * dt;
    vec3 p = ro + rd * t;
    float s = p.z;
    if (s < uStart || s > uGrow) continue;                         // cut-off tail / ignition front
    float r2 = dot(p.xy, p.xy);
    float Rc = uR0 + s * uTan, Ro = uR0 * 1.08 + s * uTanO;
    float core = (uR0 * uR0) / (Rc * Rc) * exp(-r2 / (2.0 * 0.1764 * Rc * Rc)) * exp(-s / uLc);
    float halo = 0.2 * (uR0 * uR0) / (Ro * Ro) * exp(-r2 / (2.0 * 0.64 * Ro * Ro)) * exp(-s / uLo);
    // turbulence streaming downstream, with a slow swirl
    float ang = atan(p.y, p.x) + s * 0.08 / uR0 - uTime * 0.6;
    vec3 q = vec3(cos(ang) * sqrt(r2) / Rc * 1.7, sin(ang) * sqrt(r2) / Rc * 1.7, s / uR0 * 0.85 - uTime * uFlow);
    float n = fbm3(q);
    float turb = mix(1.0, 0.3 + 1.4 * n, smoothstep(0.0, uR0 * 1.6, s));
    // the shear layer at the lip
    float dr = (sqrt(r2) - Rc * 0.92) / (0.14 * Rc);
    float lip = exp(-dr * dr) * exp(-s / (uR0 * 1.1)) * 0.55;
    vec3 c = mix(uCoreCol, uFarCol, smoothstep(0.0, uLen * 0.45, s));
    // soft edges where the jet starts (after a cut-off) and ends (while it grows)
    float edge = smoothstep(uStart, uStart + uR0 * 1.5, s) * (1.0 - smoothstep(uGrow - uR0 * 2.0, uGrow, s));
    acc += (c * (core * turb + lip * (0.7 + 0.6 * n)) + uHaloCol * halo * (0.5 + n)) * edge * dt;
  }
  acc *= uThrust * uGain * uSunE * shimmer / uR0;
  gl_FragColor = vec4(acc, 0.0);
}`;

const _v = new THREE.Vector3();

/**
 * A volumetric jet. Options (metres): r0 exit radius, len visible length, angle (core half-angle),
 * halo angle, colours, gain, emit (true: glowing exhaust; false: sunlit cold gas), flow (noise
 * units per second streaming downstream), steps.
 */
export function createPlume({ r0, len, angle = 0.26, halo = 0.62, core = [0.82, 0.9, 1.0], far = [0.42, 0.45, 1.0], haloCol = [0.5, 0.38, 0.95], gain = 0.9, emit = true, flow = 1.2, steps = 40 }) {
  const Rb = r0 * 1.08 + len * Math.tan(halo);
  // a cone proxy round the jet (the ray segment is the analytic cylinder, so the cone only saves fill)
  const g = new THREE.CylinderGeometry(Rb, r0 * 1.4, len, 40, 1, false);
  g.rotateX(Math.PI / 2);                                             // cylinder axis -> +Z (radiusTop at +Z)
  g.translate(0, 0, len / 2);
  const u = {
    uCam: { value: new THREE.Vector3() }, uR0: { value: r0 }, uLen: { value: len }, uTan: { value: Math.tan(angle) }, uTanO: { value: Math.tan(halo) },
    uRb: { value: Rb }, uLc: { value: len * 0.34 }, uLo: { value: len * 0.6 }, uThrust: { value: 0 }, uStart: { value: 0 }, uGrow: { value: len },
    uTime: U.uTime, uFlow: { value: flow }, uSunE: U.uSunIlluminance, uGain: { value: gain }, uEmit: { value: emit ? 1 : 0 }, uSteps: { value: steps },
    uCoreCol: { value: new THREE.Color(...core) }, uFarCol: { value: new THREE.Color(...far) }, uHaloCol: { value: new THREE.Color(...haloCol) },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true, side: THREE.FrontSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 18;
  mesh.onBeforeRender = (r, s, cam) => {
    // the camera in the jet's own frame (double precision on the CPU, then small numbers)
    mesh.updateMatrixWorld();
    u.uCam.value.copy(mesh.worldToLocal(_v.copy(cam.position)));
    const c = u.uCam.value, inside = c.z > -0.01 && c.z < len && Math.hypot(c.x, c.y) < Rb * 1.02;
    mat.side = inside ? THREE.BackSide : THREE.FrontSide;
  };
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
  const m = createPlume({ r0: 0.07, len: 2.6, angle: 0.3, halo: 0.75, core: [0.95, 0.96, 1.0], far: [0.85, 0.88, 0.95], haloCol: [0.8, 0.83, 0.9], gain: 0.2, emit: false, flow: 3.5, steps: 20 });
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
