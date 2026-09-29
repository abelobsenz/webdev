import * as THREE from 'three';
import { SPACE_SKY_GLSL, SPACE_UTIL_GLSL, SNOISE_GLSL } from './glsl.js';
import { R_EARTH, R_MOON } from './sim.js';

// THE HEARTH'S IMAGE: a Kerr black hole (a = 0.7) and its accretion disc, ray traced.
//
// Every pixel of a reduced-resolution pass follows its photon backwards through Kerr
// spacetime. The null geodesics are integrated exactly: in Mino time, with rho = 1/r, the
// radial and polar motions separate into two one-dimensional oscillators with polynomial
// forces (P'(rho)/2 and U'(u)/2, u = cos theta), and the azimuth follows from the conserved
// angular momentum. A symplectic leapfrog keeps the photon on its constants of motion, so
// the shadow (5.1 M across on average, D-shaped by the spin), the lensed far side of the
// disc over the top and under the bottom of the hole and the thin photon ring of the
// higher-order images all come out of the equations rather than being drawn.
//
// The disc is a Novikov-Thorne-like thin disc from the ISCO (3.39 M for a = 0.7, where its
// inner edge is hottest) to 30 M, on Keplerian Kerr orbits. Each crossing of the equator
// takes the exact redshift of the gas for that photon, g = 1 / (u^t (1 - Omega L)), so the
// approaching side is Doppler brightened (g^4) and blueshifted in colour (a black body at
// gT) while the receding side and everything deep in the well is dim and red. The gas is
// turbulent: sheared filaments advected at the local orbital speed (two phases cross-faded
// so the shear never winds up without limit), a slow two-armed density wave, and the hot
// spot where the feeder's stream strikes the rim, trailing downstream.
//
// The pass writes two targets: the disc's light and opacity (the shadow is opaque), and the
// bending of each ray as a change of direction. The composite, drawn at full resolution in
// the backdrop scene, looks the sky up along the interpolated bent ray, so the stars stay
// sharp and round while their images still bend and stretch round the hole.
//
// Units: gravitational radii M (G = c = 1). The Hearth's Schwarzschild radius 2M is RS km.

export const RS = 30;                                   // 2GM/c^2 (km)
export const M_KM = RS / 2;
export const SPIN = 0.7;
export const R_HORIZON = 1 + Math.sqrt(1 - SPIN * SPIN);
export const R_ISCO = (() => {
  const a = SPIN, z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a)), z2 = Math.sqrt(3 * a * a + z1 * z1);
  return 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
})();
export const R_DISC = 30;                                // outer edge (M): 15 RS, 450 km
const R_INT = 120;                                       // integrate inside this sphere (M)
export const T_EDGE = 9500;                              // disc temperature at the ISCO (K)
export const VIS_OMEGA = 2.2;                            // film speed: Omega (1/M) -> rad/s
const FLOW_P = 11.0;                                     // turbulence cross-fade period (s)
const f = (x, d = 5) => x.toFixed(d);

/** Kerr circular-orbit kinematics (M = 1), for the Node checks. */
export function keplerKerr(r, a = SPIN) {
  const s = Math.sqrt(r), r15 = r * s;
  return { omega: 1 / (r15 + a), ut: (r15 + a) / (s * Math.sqrt(s) * Math.sqrt(r15 - 3 * s + 2 * a)) };
}

/**
 * The same geodesic step as the shader, in JavaScript (M units, Boyer-Lindquist with the spin
 * along +Z). Used by tools/verify-hearth.mjs to check the constants of motion, the shadow's
 * size and the redshift, so the shader's physics has an independent test.
 */
export function traceKerr(pos, dir, { a = SPIN, steps = 600, dpsi = 0.05, rOut = R_INT } = {}) {
  const [x, y, z] = pos, a2 = a * a, q2 = x * x + y * y + z * z - a2;
  const r = Math.sqrt(0.5 * q2 + Math.sqrt(0.25 * q2 * q2 + a2 * z * z));
  let u = z / r, ph = Math.atan2(y, x);
  const st = Math.sqrt(1 - u * u), cp = Math.cos(ph), sp = Math.sin(ph);
  const vr = dir[0] * st * cp + dir[1] * st * sp + dir[2] * u, vt = dir[0] * u * cp + dir[1] * u * sp - dir[2] * st, vp = -dir[0] * sp + dir[1] * cp;
  const S = r * r + a2 * u * u, De = r * r - 2 * r + a2, A = (r * r + a2) ** 2 - a2 * De * st * st;
  const om = 2 * a * r / A, al = Math.sqrt(S * De / A), vw = Math.sqrt(A / S) * st;
  const L = -vw * vp / (al - om * vw * vp), Eloc = (1 - om * L) / al;
  const prv = Math.sqrt(S / De) * Eloc * vr, ptv = Math.sqrt(S) * Eloc * vt;
  const Q = ptv * ptv + u * u * (L * L / (st * st) - a2);
  const K = Q + (L - a) ** 2, C = a2 - Q - L * L, B = a2 - a * L;
  const Pp = (p) => (1 + B * p * p) ** 2 - (p * p - 2 * p ** 3 + a2 * p ** 4) * K;
  const Fp = (p) => 2 * B * p + 2 * B * B * p ** 3 - K * p + 3 * K * p * p - 2 * a2 * K * p ** 3;
  const Uu = (u) => (1 - u * u) * (Q + a2 * u * u) - L * L * u * u;
  let p = 1 / r, vpr = -p * p * De * prv, vu = -st * ptv;
  const bEff = Math.sqrt(Math.max(Q + L * L, 1e-3)), pH = 1 / (1 + Math.sqrt(1 - a2)) / 1.02;
  const hits = [];
  let err = 0, n = 0;
  for (; n < steps; n++) {
    if (p > pH) return { captured: true, hits, L, Q, Eloc, steps: n, err };
    let dt = dpsi / bEff * (p > 0.22 ? 0.5 : 1);
    if (vpr < 0) dt = Math.min(dt, 0.5 * p / -vpr + 1e-4);
    const p0 = p, u0 = u, ph0 = ph;
    vpr += 0.5 * dt * Fp(p); vu += 0.5 * dt * (C * u - 2 * a2 * u ** 3);
    p += dt * vpr; u += dt * vu;
    const pm = 0.5 * (p + p0), um = 0.5 * (u + u0);
    ph -= dt * (a * (1 + B * pm * pm) / (1 - 2 * pm + a2 * pm * pm) - a + L / Math.max(1 - um * um, 1e-4));
    vpr += 0.5 * dt * Fp(p); vu += 0.5 * dt * (C * u - 2 * a2 * u ** 3);
    err = Math.max(err, Math.abs(vpr * vpr - Pp(p)) / Math.max(1, Math.abs(Pp(p))), Math.abs(vu * vu - Uu(u)) / Math.max(1, Q + L * L));
    if (u0 * u < 0) { const k = u0 / (u0 - u); hits.push({ r: 1 / (p0 + (p - p0) * k), phi: ph0 + (ph - ph0) * k }); }
    if (p < 1 / rOut && vpr < 0) break;
  }
  return { captured: false, hits, L, Q, Eloc, steps: n, err, p, u, ph, vpr, vu };
}

export const BH_FRAG = /* glsl */ `
precision highp float;
uniform mat4 uInvProj;
uniform mat3 uCamRot;          // camera -> world rotation
uniform mat3 uToBH;            // world -> Hearth frame
uniform vec3 uCamBH;           // camera position, Hearth frame, gravitational radii
uniform float uTime;
uniform float uLensR;          // far mode: radius of the lensed region (M); 0 = full screen
uniform float uDiscGain;
uniform float uGObs;           // the static observer's own blueshift, 1 / sqrt(1 - 2M/r)
uniform float uPixAng;         // radians per pixel of this pass
uniform vec3 uFeed;            // the stream's impact: radius (M), BL azimuth, strength
uniform float uJet;
varying vec2 vUv;
layout(location = 0) out highp vec4 oDisc;
layout(location = 1) out highp vec4 oLens;
${SPACE_UTIL_GLSL}
${SNOISE_GLSL}
#define A_SPIN ${f(SPIN)}
#define R_H ${f(R_HORIZON)}
#define R_ISCO ${f(R_ISCO)}
#define R_DISC ${f(R_DISC, 1)}
#define R_INT ${f(R_INT, 1)}
#define T_EDGE ${f(T_EDGE, 1)}
#define VIS_OMEGA ${f(VIS_OMEGA)}
#define FLOW_P ${f(FLOW_P, 2)}
#define TWO_PI 6.28318530718

vec3 bendToward(vec3 d, vec3 pos, float ang) {
  // rotate d toward the centre (-pos) by 'ang' radians, in the plane of d and pos
  vec3 axis = cross(d, -pos);
  float l = length(axis);
  if (l < 1e-6 || ang <= 0.0) return d;
  axis /= l;
  float c = cos(ang), s = sin(ang);
  return d * c + cross(axis, d) * s + axis * dot(axis, d) * (1.0 - c);
}

// ---- Kerr circular orbits (prograde, M = 1)
float kOmega(float r) { return 1.0 / (r * sqrt(r) + A_SPIN); }
float kUt(float r) {
  float s = sqrt(r), r15 = r * s;
  return (r15 + A_SPIN) / (s * sqrt(s) * sqrt(max(r15 - 3.0 * s + 2.0 * A_SPIN, 1e-3)));
}

// ---- the gas: sheared turbulence in co-rotating coordinates (fp: pixel footprint in ln r)
float discNoise(vec2 cs, float lr, float seed, float fp) {
  float n = snoise(vec3(cs * 2.3, lr * 8.0 + seed));
  float w2 = 1.0 - smoothstep(0.08, 0.3, fp * 19.0);
  float w3 = 1.0 - smoothstep(0.08, 0.3, fp * 43.0);
  n += 0.5 * w2 * snoise(vec3(cs * 5.2, lr * 19.0 + seed + 3.1));
  n += 0.25 * w3 * snoise(vec3(cs * 11.5, lr * 43.0 + seed + 7.7));
  return n / (1.0 + 0.5 * w2 + 0.25 * w3) * (1.0 + 0.35 * (1.0 - w3));
}
float discTex(float r, float phi, float fp) {
  float lr = log(r);
  float om = VIS_OMEGA * kOmega(max(r, R_ISCO * 0.9));
  float t1 = mod(uTime, FLOW_P), t2 = mod(uTime + 0.5 * FLOW_P, FLOW_P);
  float w1 = 1.0 - abs(2.0 * t1 / FLOW_P - 1.0), w2 = 1.0 - w1;
  float a1 = phi - om * t1, a2 = phi - om * t2;
  float n1 = discNoise(vec2(cos(a1), sin(a1)), lr, 0.0, fp);
  float n2 = discNoise(vec2(cos(a2), sin(a2)), lr, 23.0, fp);
  // equal-power cross-fade: the mix of two independent fields keeps the same contrast
  float n = (w1 * n1 + w2 * n2) * inversesqrt(max(w1 * w1 + w2 * w2, 1e-4));
  // a slow two-armed trailing density wave (pitch ~14 degrees), strongest mid-disc
  float arm = 0.5 + 0.5 * cos(2.0 * (phi - VIS_OMEGA * 0.042 * uTime) + 8.0 * lr);
  float armW = smoothstep(1.6, 2.1, lr) * (1.0 - smoothstep(2.9, 3.4, lr));
  return exp(0.62 * n) * (1.0 + 0.5 * armW * (arm * arm - 0.33));
}

// light and opacity of the disc where the photon crosses the equator (r in M, phi BL azimuth,
// Lz the photon's axial angular momentum, cc the cosine of its angle to the disc's normal)
vec4 discEmit(float r, float phi, float Lz, float cc, float fp) {
  if (r > R_DISC || r < R_H * 1.04) return vec4(0.0);
  float rk = max(r, R_ISCO);
  float g = uGObs / (kUt(rk) * (1.0 - kOmega(rk) * Lz));
  // inside the ISCO the gas plunges: it thins within a fraction of M and falls deeper in the well
  float inner = 1.0;
  if (r < R_ISCO) { inner = exp(-(R_ISCO - r) / 0.28); g *= sqrt(max((r - R_H) / (R_ISCO - R_H), 0.0)); }
  float x = R_ISCO / rk;
  // viscous heating with a small stress at the inner edge (hottest right at the ISCO), and the
  // flared outer disc warmed by the inner disc's light (F ~ r^-2)
  float F = x * x * x * max(1.0 - 0.75 * sqrt(x), 0.0) * 4.0 + 0.1 * x * x;
  // the feeder's stream strikes the rim: a hot spot, its heat sheared out downstream
  float dS = mod(phi - uFeed.y, TWO_PI);
  float dr = r - uFeed.x;
  float dA = min(dS, TWO_PI - dS);
  float spot = exp(-dr * dr / 0.7 - dA * dA / 0.01);
  float tail = exp(-dS / 1.5) * exp(-dr * dr / ((0.8 + 1.1 * dS) * (0.8 + 1.1 * dS)));
  F += uFeed.z * (0.22 * spot + 0.018 * tail);
  float tex = discTex(r, phi, fp);
  float outer = 1.0 - smoothstep(R_DISC * 0.7, R_DISC, r);
  float T = T_EDGE * pow(max(F * inner, 1e-6), 0.25) * mix(1.0, pow(tex, 0.18), 0.8);
  float g2 = g * g;
  vec3 col = blackbody(g * T) * (F * inner * tex * g2 * g2 * uDiscGain);
  float tau = (0.35 + 2.4 * tex) * inner * outer * (0.3 + 0.7 * smoothstep(0.0, 0.25, F + 0.2 * x)) / max(cc, 0.04);
  float al = 1.0 - exp(-tau);
  return vec4(col * al, al);
}

void main() {
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dirW = normalize(uCamRot * (v.xyz / v.w));
  vec3 rd = uToBH * dirW;
  vec3 ro = uCamBH;
  float rCam = length(ro);
  float b = length(cross(ro, rd));
  oDisc = vec4(0.0);
  oLens = vec4(0.0);
  if (uLensR > 0.0 && b > uLensR) return;
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  bool captured = false;
  vec3 outDir;
  float tStar = -dot(ro, rd);
  if (b > R_INT || (rCam > R_INT && tStar < 0.0)) {
    // weak field: straight-line deflection, 4M/b in all, part of it behind us
    float k = sqrt(max(1.0 - b * b / (rCam * rCam), 0.0));
    outDir = bendToward(rd, ro, (2.0 / max(b, 1e-3)) * (tStar > 0.0 ? 1.0 + k : 1.0 - k));
  } else {
    vec3 pos = ro, dir = rd;
    if (rCam > R_INT) {
      vec2 hs = sphereHits(ro, rd, R_INT);
      pos = ro + rd * hs.x;
      float k = sqrt(max(1.0 - b * b / (rCam * rCam), 0.0));
      float kR = sqrt(max(1.0 - b * b / (R_INT * R_INT), 0.0));
      dir = bendToward(rd, pos, (2.0 / max(b, 1e-3)) * (k - kR));
    }
    // Boyer-Lindquist, spin along the Hearth's +y: (X, Y, Z)_BL = (z, x, y)_Hearth
    vec3 X = vec3(pos.z, pos.x, pos.y), Dv = normalize(vec3(dir.z, dir.x, dir.y));
    const float a = A_SPIN;
    const float a2 = A_SPIN * A_SPIN;
    float q2 = dot(X, X) - a2;
    float r = sqrt(0.5 * q2 + sqrt(0.25 * q2 * q2 + a2 * X.z * X.z));
    float u = clamp(X.z / r, -0.9995, 0.9995);
    float ph = atan(X.y, X.x);
    float st = sqrt(1.0 - u * u);
    float cph = cos(ph), sph = sin(ph);
    float vr = dot(Dv, vec3(st * cph, st * sph, u)), vt = dot(Dv, vec3(u * cph, u * sph, -st)), vp = dot(Dv, vec3(-sph, cph, 0.0));
    // conserved quantities of the photon arriving along -Dv, from the locally non-rotating frame
    float S = r * r + a2 * u * u, De = r * r - 2.0 * r + a2, A = (r * r + a2) * (r * r + a2) - a2 * De * st * st;
    float om = 2.0 * a * r / A, al = sqrt(S * De / A), vw = sqrt(A / S) * st;
    float Lz = -vw * vp / (al - om * vw * vp);
    float Eloc = (1.0 - om * Lz) / al;
    float prv = sqrt(S / De) * Eloc * vr, ptv = sqrt(S) * Eloc * vt;
    float Qc = ptv * ptv + u * u * (Lz * Lz / (st * st) - a2);
    float K = Qc + (Lz - a) * (Lz - a), C = a2 - Qc - Lz * Lz, B = a2 - a * Lz;
    float p = 1.0 / r, vpr = -p * p * De * prv, vu = -st * ptv;
    float dt0 = 0.05 / sqrt(max(Qc + Lz * Lz, 1e-3));
    float pH = 1.0 / (R_H * 1.02);
    // a pixel's footprint at the disc (M), for the turbulence's level of detail
    float fpM = uPixAng * rCam;
    bool out_ = false;
    for (int i = 0; i < STEPS; i++) {
      if (p > pH) { captured = true; break; }
      float dt = dt0 * (p > 0.22 ? 0.5 : 1.0);
      if (vpr < 0.0) dt = min(dt, 0.5 * p / -vpr + 1e-4);
      float p0 = p, u0 = u, ph0 = ph;
      vpr += 0.5 * dt * (2.0 * B * p + 2.0 * B * B * p * p * p - K * p + 3.0 * K * p * p - 2.0 * a2 * K * p * p * p);
      vu += 0.5 * dt * (C * u - 2.0 * a2 * u * u * u);
      p += dt * vpr;
      u += dt * vu;
      float pm = 0.5 * (p + p0), um = 0.5 * (u + u0);
      ph -= dt * (a * (1.0 + B * pm * pm) / max(1.0 - 2.0 * pm + a2 * pm * pm, 1e-4) - a + Lz / max(1.0 - um * um, 1e-4));
      vpr += 0.5 * dt * (2.0 * B * p + 2.0 * B * B * p * p * p - K * p + 3.0 * K * p * p - 2.0 * a2 * K * p * p * p);
      vu += 0.5 * dt * (C * u - 2.0 * a2 * u * u * u);
      if (u0 * u < 0.0) {
        float k = u0 / (u0 - u);
        float rh = 1.0 / mix(p0, p, k);
        float pc = 1.0 / rh;
        float cc = clamp(abs(vu) * pc * sqrt(max(1.0 - 2.0 * pc, 0.05)), 0.0, 1.0);
        vec4 d = discEmit(rh, mix(ph0, ph, k), Lz, cc, fpM / (rh * max(cc, 0.12)));
        col += (1.0 - alpha) * d.rgb;
        alpha += (1.0 - alpha) * d.a;
        if (alpha > 0.985) break;
      }
      if (p < 1.0 / R_INT && vpr < 0.0) { out_ = true; break; }
    }
    // rays still circling deep in the well when the steps run out lie on the photon ring
    if (!captured && !out_ && p > 1.0 / 7.0) captured = true;
    if (!captured) {
      float s2 = max(1.0 - u * u, 1e-6), stE = sqrt(s2);
      float phd = -(a * (1.0 + B * p * p) / max(1.0 - 2.0 * p + a2 * p * p, 1e-4) - a + Lz / s2);
      float c2 = cos(ph), s2p = sin(ph);
      vec3 er = vec3(stE * c2, stE * s2p, u), et = vec3(u * c2, u * s2p, -stE), ep = vec3(-s2p, c2, 0.0);
      // velocity (scaled by rho^2) and position, back in the Hearth frame
      vec3 vB = -vpr * er + (p * (-vu / stE)) * et + (p * stE * phd) * ep;
      vec3 dH = normalize(vec3(vB.y, vB.z, vB.x));
      vec3 pH3 = vec3(er.y, er.z, er.x) / max(p, 1e-4);
      float bb = length(cross(pH3, dH));
      float kR = sqrt(max(1.0 - bb * bb / dot(pH3, pH3), 0.0));
      outDir = bendToward(dH, pH3, (2.0 / max(bb, 1e-3)) * (1.0 - kR));
    }
  }
  float edge = uLensR > 0.0 ? smoothstep(uLensR, uLensR * 0.55, b) : 1.0;
  vec3 delta = captured ? vec3(0.0) : (transpose(uToBH) * outDir - dirW) * edge;
  oDisc = vec4(col, captured ? 1.0 : alpha);
  oLens = vec4(delta, 1.0);
}
`;

// The sky as seen along a bent ray: stars, Milky Way, swarm, the Sun, and the Earth and Moon
// as small analytic spheres (they are 1.5 million km away).
const BACKGROUND_GLSL = /* glsl */ `
vec4 farBody(vec3 ro, vec3 rd, vec3 c, float R, float isEarth) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float cc = dot(oc, oc) - R * R;
  float h = b * b - cc;
  float rAtm = R + (isEarth > 0.5 ? 100.0 : 30.0);
  float ha = b * b - (dot(oc, oc) - rAtm * rAtm);
  vec4 res = vec4(0.0);
  if (ha > 0.0 && -b > 0.0) {
    float miss = sqrt(max(dot(oc, oc) - b * b, 0.0)) - R;
    vec3 tp = normalize(oc - rd * b);
    float lit = smoothstep(-0.3, 0.25, dot(tp, uSunDir));
    float fwd = pow(max(dot(rd, uSunDir), 0.0), 8.0);
    vec3 glow = mix(vec3(1.0, 0.45, 0.2), vec3(0.3, 0.55, 1.0), lit) * (lit * 0.4 + fwd * 3.0);
    res.rgb += glow * exp(-max(miss, 0.0) / (isEarth > 0.5 ? 18.0 : 10.0)) * uSunE * 0.05 * (isEarth > 0.5 ? 1.0 : 0.3);
  }
  if (h > 0.0 && -b > 0.0) {
    vec3 p = oc + rd * (-b - sqrt(h));
    vec3 n = normalize(p);
    float ndl = dot(n, uSunDir);
    float cl = smoothstep(0.1, 0.6, snoise(n * 6.0 + 2.0) * 0.5 + snoise(n * 17.0) * 0.25 + 0.3);
    vec3 alb = isEarth > 0.5 ? mix(vec3(0.02, 0.05, 0.12), vec3(0.8), cl) : mix(vec3(0.08, 0.12, 0.06), vec3(0.02, 0.05, 0.1), smoothstep(0.0, 0.2, snoise(n * 4.0)));
    vec3 col = alb / 3.14159 * uSunE * max(ndl, 0.0);
    float night = 1.0 - smoothstep(-0.1, 0.05, ndl);
    col += vec3(1.0, 0.65, 0.35) * night * smoothstep(0.55, 0.8, snoise(n * 30.0) * 0.5 + 0.5) * 0.25 * isEarth;
    res = vec4(res.rgb + col, 1.0);
  }
  return res;
}
vec3 background(vec3 dirW, float px) {
  vec3 col = sk_background(dirW, px);
  col += sk_swarm(uCamW, dirW, px) * uSunE * 0.06;
  vec4 e = farBody(uCamW, dirW, uEarthPos, ${R_EARTH.toFixed(1)}, 1.0);
  vec4 m = farBody(uCamW, dirW, uMoonPos, ${R_MOON.toFixed(1)}, 0.0);
  vec3 sun = sk_sun(uCamW, dirW, px, uSunE);
  col += sun * (1.0 - e.a) * (1.0 - m.a);
  col = mix(col, e.rgb, e.a) + e.rgb * (1.0 - e.a);
  col = mix(col, m.rgb, m.a) + m.rgb * (1.0 - m.a);
  return col;
}
`;

export const COMP_FRAG = /* glsl */ `
uniform sampler2D tDisc;
uniform sampler2D tLens;
uniform mat4 uInvProj;
uniform mat3 uCamRot;
uniform vec3 uCamW;
uniform vec3 uSunDir;
uniform float uSunE;
uniform vec3 uEarthPos;
uniform vec3 uMoonPos;
varying vec2 vUv;
${SPACE_UTIL_GLSL}
${SNOISE_GLSL}
${SPACE_SKY_GLSL}
${BACKGROUND_GLSL}
void main() {
  vec4 L = texture2D(tLens, vUv);
  if (L.w < 0.002) discard;
  vec4 D = texture2D(tDisc, vUv);
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dirW = normalize(uCamRot * (v.xyz / v.w));
  // the sky along the bent ray, at full resolution: sharp round stars, lensed
  vec3 dir = normalize(dirW + L.xyz);
  float px = max(length(fwidth(dir)), 1e-5);
  vec3 bg = D.a > 0.998 ? vec3(0.0) : background(dir, min(px, 0.02));
  gl_FragColor = vec4((D.rgb + (1.0 - D.a) * bg) * L.w, L.w);
}
`;

/** The render target pair for the lens pass: disc light + opacity, and ray bending. */
export function createLensTarget() {
  return new THREE.WebGLRenderTarget(1, 1, { count: 2, type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
}
