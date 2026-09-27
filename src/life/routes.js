import * as THREE from 'three';

/**
 * Route engine for everything that flies, sails or rides in Meridian.
 *
 * A route is a closed path sampled *uniformly in time* rather than in distance:
 * the CPU integrates a speed profile (cruise speed, curvature limits, gentle
 * acceleration, full stops with a dwell at docks, hidden stretches) once at load,
 * and bakes position / heading / bank / thrust into a float texture. On the GPU a
 * vehicle only needs `phase = offset + time * rate` to know exactly where it is,
 * so thousands of craft decelerate into docks, hover, bank through turns and
 * climb away without any per-frame CPU work.
 *
 * Texture layout: width = SAMPLES, 3 rows per route:
 *   row 3r+0: position.xyz, speed (m/s)
 *   row 3r+1: forward.xyz (unit), bank (rad, + = right turn)
 *   row 3r+2: visibility 0..1, thrust 0..1, arc fraction s/L, climb rate (m/s)
 */
export const SAMPLES = 2048;
const G = 9.81;
const UP = new THREE.Vector3(0, 1, 0);

export const ROUTE_GLSL = /* glsl */ `
uniform sampler2D uRoutes;
struct RouteFrame { vec3 pos; vec3 fwd; float bank; float speed; float vis; float thrust; float arc; float climb; };
RouteFrame routeAt(float route, float phase) {
  float x = fract(phase) * ${SAMPLES}.0;
  int i0 = int(floor(x));
  int i1 = (i0 + 1) % ${SAMPLES};
  float f = fract(x);
  int r = int(route + 0.5) * 3;
  vec4 a0 = texelFetch(uRoutes, ivec2(i0, r), 0), b0 = texelFetch(uRoutes, ivec2(i1, r), 0);
  vec4 a1 = texelFetch(uRoutes, ivec2(i0, r + 1), 0), b1 = texelFetch(uRoutes, ivec2(i1, r + 1), 0);
  vec4 a2 = texelFetch(uRoutes, ivec2(i0, r + 2), 0), b2 = texelFetch(uRoutes, ivec2(i1, r + 2), 0);
  RouteFrame o;
  o.pos = mix(a0.xyz, b0.xyz, f);
  o.speed = mix(a0.w, b0.w, f);
  o.fwd = normalize(mix(a1.xyz, b1.xyz, f) + vec3(1e-5, 0.0, 0.0));
  o.bank = mix(a1.w, b1.w, f);
  o.vis = mix(a2.x, b2.x, f);
  o.thrust = mix(a2.y, b2.y, f);
  o.arc = a2.z;
  o.climb = mix(a2.w, b2.w, f);
  return o;
}
// Orthonormal vehicle basis. Travelling in reverse (rate < 0) flips heading and bank.
// Columns map model space (+X left, +Y up, +Z forward) to world space.
mat3 routeBasis(RouteFrame fr, float dir, out vec3 side) {
  vec3 fwd = fr.fwd * dir;
  side = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)) + vec3(0.0, 0.0, 1e-5));   // right-hand side
  vec3 up = cross(side, fwd);
  float b = fr.bank * dir;
  vec3 s2 = side * cos(b) - up * sin(b);
  vec3 u2 = cross(s2, fwd);
  return mat3(-s2, u2, fwd);
}
`;

/**
 * Speed-profiled closed route.
 * spec: {
 *   points: Vector3[] control points (closed centripetal Catmull-Rom), or pts: prebuilt dense polyline
 *   speed: m/s number or (s, L, p) => m/s
 *   accel: comfortable longitudinal acceleration (m/s²), latAccel: lateral limit (m/s²)
 *   stops: [{ s (metres) | u (0..1), dwell (s) }]
 *   hidden: [[s0, s1]] arc ranges (metres) where the craft is invisible
 *   thrust: optional (s, L, v, a) => 0..1 engine output
 *   bankMax (rad), bankGain
 * }
 */
export class Route {
  constructor(spec) {
    this.spec = spec;
    const closed = spec.closed !== false;
    let dense;
    if (spec.polyline) {
      dense = spec.polyline;
    } else {
      const curve = new THREE.CatmullRomCurve3(spec.points, closed, 'centripetal');
      const L0 = curve.getLength();
      const M = Math.min(20000, Math.max(800, Math.ceil(L0 / (spec.step || 4))));
      dense = curve.getSpacedPoints(M);
      if (closed) dense.pop();
    }
    const M = dense.length;
    const P = dense;
    const S = new Float64Array(M + 1);
    for (let j = 1; j <= M; j++) S[j] = S[j - 1] + P[j % M].distanceTo(P[j - 1]);
    const L = S[M];
    this.length = L;
    this.P = P; this.S = S; this.M = M;
    // tangents & signed horizontal curvature
    const T = [], K = new Float64Array(M);
    for (let j = 0; j < M; j++) {
      const a = P[(j - 1 + M) % M], b = P[(j + 1) % M];
      T.push(new THREE.Vector3().subVectors(b, a).normalize());
    }
    const side = new THREE.Vector3();
    for (let j = 0; j < M; j++) {
      const ta = T[(j - 1 + M) % M], tb = T[(j + 1) % M];
      const ds = Math.max((S[j + 1] - S[Math.max(j - 1, 0)]) || 1, 1e-3);
      side.crossVectors(T[j], UP);
      const hl = side.length();
      if (hl < 1e-4) { K[j] = 0; continue; }
      side.divideScalar(hl);
      K[j] = new THREE.Vector3().subVectors(tb, ta).dot(side) / ds;
    }
    this.T = T;
    // --- speed profile -------------------------------------------------------
    const V = new Float64Array(M + 1);
    const accel = spec.accel ?? 2.5;
    const decel = spec.decel ?? accel;
    const latA = spec.latAccel ?? 3.5;
    const sp = typeof spec.speed === 'function' ? spec.speed : () => spec.speed ?? 60;
    for (let j = 0; j < M; j++) {
      let v = sp(S[j], L, P[j]);
      const k = Math.abs(K[j]);
      if (k > 1e-6) v = Math.min(v, Math.sqrt(latA / k));
      V[j] = Math.max(v, 0.5);
    }
    const stops = (spec.stops || []).map((st) => ({ s: st.s ?? st.u * L, dwell: st.dwell ?? 0 }));
    const stopIdx = [];
    for (const st of stops) {
      let j = 0;
      while (j < M - 1 && S[j] < st.s) j++;
      st.j = j; st.s = S[j];
      stopIdx.push(j);
      V[j] = 0;
    }
    // acceleration limits (two passes each way around the loop)
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 1; j <= M; j++) {
        const jj = j % M, jp = j - 1;
        const ds = S[j] - S[jp];
        V[jj] = Math.min(V[jj], Math.sqrt(V[jp] * V[jp] + 2 * accel * ds));
      }
      for (let j = M - 1; j >= 0; j--) {
        const jn = (j + 1) % M;
        const ds = S[j + 1] - S[j];
        V[j] = Math.min(V[j], Math.sqrt(V[jn] * V[jn] + 2 * decel * ds));
      }
    }
    for (const j of stopIdx) V[j] = 0;
    V[M] = V[0];
    // --- time integration ----------------------------------------------------
    const tArr = new Float64Array(M + 1);
    const dwellAt = new Map(stops.map((s) => [s.j, s.dwell]));
    for (let j = 1; j <= M; j++) {
      const ds = S[j] - S[j - 1];
      const vAvg = Math.max((V[j - 1] + V[j % M]) * 0.5, 0.25);
      tArr[j] = tArr[j - 1] + ds / vAvg + (dwellAt.get(j - 1) || 0);
    }
    // arrive-at-stop time is tArr[j] (dwell added when leaving)
    this.period = tArr[M];
    this.V = V; this.tArr = tArr; this.K = K;
    this.stops = stops;
    this.hidden = spec.hidden || [];
  }

  /** Position + tangent at arc length s (metres). */
  at(s, outP = new THREE.Vector3(), outT = new THREE.Vector3()) {
    const { S, M, P, T, length: L } = this;
    s = ((s % L) + L) % L;
    let lo = 0, hi = M;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid] <= s) lo = mid; else hi = mid; }
    const f = (s - S[lo]) / Math.max(S[lo + 1] - S[lo], 1e-6);
    outP.copy(P[lo]).lerp(P[(lo + 1) % M], f);
    outT.copy(T[lo]).lerp(T[(lo + 1) % M], f).normalize();
    return { p: outP, t: outT };
  }

  /** Bake SAMPLES time steps into 3 texture rows. */
  bake(data, row) {
    const { S, M, P, T, V, tArr, K, period, length: L } = this;
    const bankMax = this.spec.bankMax ?? 0.55;
    const bankGain = this.spec.bankGain ?? 1;
    const thrustFn = this.spec.thrust;
    const W = SAMPLES;
    // smoothed bank along the arc
    const bank = new Float64Array(M);
    for (let j = 0; j < M; j++) bank[j] = Math.max(-bankMax, Math.min(bankMax, Math.atan((V[j] * V[j] * K[j]) / G) * bankGain));
    const win = Math.max(2, Math.round(M / 400));
    const bs = new Float64Array(M);
    for (let j = 0; j < M; j++) { let a = 0; for (let k = -win; k <= win; k++) a += bank[(j + k + M) % M]; bs[j] = a / (2 * win + 1); }
    const hiddenAt = (s) => {
      let vis = 1;
      for (const [a, b] of this.hidden) {
        const fade = this.spec.hideFade ?? 60;
        if (s >= a && s <= b) return 0;
        if (s < a && s > a - fade) vis = Math.min(vis, (a - s) / fade);
        if (s > b && s < b + fade) vis = Math.min(vis, (s - b) / fade);
      }
      return vis;
    };
    let j = 0;
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    // at low speed craft hold a level attitude (hovering lift-off, flare onto a pad);
    // the nose follows the flight path only once they are moving
    const [pv0, pv1] = this.spec.pitchSpeeds || [4, 30];
    const hPrev = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < W; i++) {
      const time = (i / W) * period;
      while (j < M - 1 && tArr[j + 1] <= time) j++;
      // inside [tArr[j], tArr[j+1]]: may include a dwell at the start of the interval
      const ds = S[j + 1] - S[j];
      const v0 = V[j], v1 = V[(j + 1) % M];
      const vAvg = Math.max((v0 + v1) * 0.5, 0.25);
      const travel = ds / vAvg;
      const tStart = tArr[j + 1] - travel;          // after any dwell
      const f = time < tStart ? 0 : Math.min(1, (time - tStart) / travel);
      p.copy(P[j]).lerp(P[(j + 1) % M], f);
      t.copy(T[j]).lerp(T[(j + 1) % M], f).normalize();
      const s = S[j] + ds * f;
      const v = time < tStart ? 0 : v0 + (v1 - v0) * f;
      {
        const hx = t.x, hz = t.z, hl = Math.hypot(hx, hz);
        if (hl > 0.05) hPrev.set(hx / hl, 0, hz / hl);
        const vv = Math.max(v, (v0 + v1) * 0.5);
        const k = THREE.MathUtils.smoothstep(vv, pv0, pv1);
        const hor = Math.max(hl, 1e-4);
        t.set(hPrev.x * hor, t.y * k, hPrev.z * hor).normalize();
      }
      const b = bs[j] + (bs[(j + 1) % M] - bs[j]) * f;
      const a = (v1 * v1 - v0 * v0) / (2 * Math.max(ds, 1e-3));
      const thrust = thrustFn ? thrustFn(s, L, v, a, p) : Math.min(1, 0.3 + Math.max(0, a) * 0.2);
      const k0 = ((row * 3) * W + i) * 4, k1 = ((row * 3 + 1) * W + i) * 4, k2 = ((row * 3 + 2) * W + i) * 4;
      data[k0] = p.x; data[k0 + 1] = p.y; data[k0 + 2] = p.z; data[k0 + 3] = v;
      data[k1] = t.x; data[k1 + 1] = t.y; data[k1 + 2] = t.z; data[k1 + 3] = b;
      data[k2] = hiddenAt(s); data[k2 + 1] = thrust; data[k2 + 2] = s / L; data[k2 + 3] = v * t.y;
    }
  }
}

export class RouteBank {
  constructor() { this.routes = []; this.tex = null; }
  add(spec) {
    const r = new Route(spec);
    r.row = this.routes.length;
    this.routes.push(r);
    return r;
  }
  build() {
    const rows = this.routes.length * 3;
    const data = new Float32Array(SAMPLES * rows * 4);
    this.routes.forEach((r, i) => r.bake(data, i));
    const tex = new THREE.DataTexture(data, SAMPLES, rows, THREE.RGBAFormat, THREE.FloatType);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.tex = tex;
    return tex;
  }
}

// ------------------------------------------------------------- path shapes --
/** Dense polyline of a level circle. */
export function circlePath(cx, cz, r, y, { dir = 1, start = 0, n = 0 } = {}) {
  const N = n || Math.max(64, Math.ceil((Math.PI * 2 * r) / 6));
  const out = [];
  for (let i = 0; i < N; i++) {
    const a = start + dir * (i / N) * Math.PI * 2;
    out.push(new THREE.Vector3(cx + Math.cos(a) * r, typeof y === 'function' ? y(i / N, a) : y, cz + Math.sin(a) * r));
  }
  return out;
}

/**
 * Belt around two pulleys (external tangents), travelling clockwise seen from
 * above (+Y). Returns a dense polyline in the XZ plane with a height function
 * y(u, which) where u is the running fraction and which = 'A' | 'B' | 'AB' | 'BA'.
 */
export function beltPath(A, rA, B, rB, heightFn, step = 6) {
  // work in 2D (x, z); angles measured with atan2(z, x)
  const dx = B.x - A.x, dz = B.z - A.z;
  const d = Math.hypot(dx, dz);
  const base = Math.atan2(dz, dx);
  const phi = Math.acos(THREE.MathUtils.clamp((rA - rB) / d, -1, 1));
  // tangent points: on A at base ± phi, on B at base ± phi
  const segs = [];
  const arc = (c, r, a0, a1, tag) => {
    // clockwise in screen terms == decreasing atan2(z,x) angle? Use increasing angle (x→z) consistently.
    let da = a1 - a0;
    while (da <= 0) da += Math.PI * 2;
    const n = Math.max(8, Math.ceil((da * r) / step));
    for (let i = 0; i < n; i++) { const a = a0 + (da * i) / n; segs.push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, tag }); }
  };
  const line = (x0, z0, x1, z1, tag) => {
    const n = Math.max(4, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let i = 0; i < n; i++) { const t = i / n; segs.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, tag, t }); }
  };
  // angles increase from +X toward +Z. Going around A from (base+phi) to (base-phi) the long way (far side).
  const aA1 = base + phi, aA0 = base - phi + Math.PI * 2;
  const pA = (a) => ({ x: A.x + Math.cos(a) * rA, z: A.z + Math.sin(a) * rA });
  const pB = (a) => ({ x: B.x + Math.cos(a) * rB, z: B.z + Math.sin(a) * rB });
  // A far arc: from base+phi to base-phi+2π (sweeps the side facing away from B)
  arc(A, rA, aA1, aA0, 'A');
  // tangent A→B on the (base - phi) side
  const a0 = pA(base - phi), b0 = pB(base - phi);
  line(a0.x, a0.z, b0.x, b0.z, 'AB');
  // B far arc: from base-phi to base+phi (the side facing away from A)
  arc(B, rB, base - phi, base + phi, 'B');
  const b1 = pB(base + phi), a1 = pA(base + phi);
  line(b1.x, b1.z, a1.x, a1.z, 'BA');
  const pts = [];
  const n = segs.length;
  for (let i = 0; i < n; i++) {
    const s = segs[i];
    pts.push(new THREE.Vector3(s.x, heightFn(s.tag, s.t ?? 0, i / n), s.z));
  }
  return pts;
}

/** Resample + smooth a closed polyline (removes corners so speed/bank stay graceful). */
export function smoothClosed(pts, iterations = 3, step = 5) {
  let p = pts.map((v) => v.clone());
  for (let it = 0; it < iterations; it++) {
    const n = p.length;
    const q = [];
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
      q.push(new THREE.Vector3((a.x + 2 * b.x + c.x) / 4, (a.y + 2 * b.y + c.y) / 4, (a.z + 2 * b.z + c.z) / 4));
    }
    p = q;
  }
  // uniform resample
  const curve = new THREE.CatmullRomCurve3(p, true, 'centripetal');
  const L = curve.getLength();
  const out = curve.getSpacedPoints(Math.max(64, Math.ceil(L / step)));
  out.pop();
  return out;
}
