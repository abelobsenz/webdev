// The terraformed Moon's seas: a swell of directional waves, written once as a table and emitted
// as GLSL (the terrain patch displaces its water vertices by it near the camera; the surface
// shader takes its normals from it at every range where a wave spans a few pixels) beside a
// JavaScript twin (sea surface height for anything that floats or lands on the water).
//
// Each wave is a sine along a FIXED direction of the Moon frame (so the pattern is one field over
// the whole globe, never re-oriented under the camera), its share of the local tangent plane
// scaling its height (a wave running along the local vertical has no surface expression there).
// Wavelengths are spread irrationally from a 220 m swell to 9 m ripples (no two in step, so the
// surface never tiles), each travelling at its deep-water speed under lunar gravity,
// omega = sqrt(g k), with g = 1.62 m/s^2. The chop is steeper than the swell and rides a gust
// field; the heights stay well under a metre (the ground contract's tolerance).

const G_KM = 1.62e-3;                        // km / s^2

function unit(x, y, z) { const l = Math.hypot(x, y, z); return [+(x / l).toFixed(6), +(y / l).toFixed(6), +(z / l).toFixed(6)]; }
// [direction (Moon frame), wavelength km, amplitude km]
export const SEA_WAVES = [
  [unit(0.62, 0.18, 0.76), 0.221, 0.00034],
  [unit(-0.35, 0.51, 0.78), 0.157, 0.00026],
  [unit(0.81, -0.44, 0.38), 0.113, 0.00019],
  [unit(0.12, 0.93, -0.35), 0.0797, 0.00013],
  [unit(-0.71, -0.2, 0.67), 0.0561, 0.000092],
  [unit(0.44, 0.61, -0.66), 0.0389, 0.000066],
  [unit(-0.23, -0.83, -0.51), 0.0271, 0.000045],
  [unit(0.93, 0.27, -0.25), 0.0187, 0.000031],
  [unit(-0.52, 0.34, -0.78), 0.0131, 0.000022],
  [unit(0.3, -0.6, 0.74), 0.0092, 0.000015],
].map(([d, lam, amp]) => ({ d, lam, amp, omega: +Math.sqrt(G_KM * 2 * Math.PI / lam).toFixed(6), k: +(2 * Math.PI / lam).toFixed(6) }));

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

export const SEA_GLSL = /* glsl */ `
// ---- the sea's waves (moonWater.js) ----
// rel: the point relative to the camera (km, Moon frame; the phases at the camera come in from
// doubles, uSeaPh, so the ripples do not sparkle 1700 km from the Moon's centre), up its unit
// vertical, fade: the size under which a wave drops out (a pixel footprint or a vertex spacing).
// Returns the tangent-plane slope of the surface (xyz) and its height (w, km).
uniform float uSeaPh[${SEA_WAVES.length}];
vec4 seaWaves(vec3 rel, vec3 up, float fade) {
  vec3 sl = vec3(0.0);
  float hgt = 0.0;
${SEA_WAVES.map((w, i) => `  {
    float wf = 1.0 - smoothstep(${f(+(w.lam * 0.15).toFixed(6))}, ${f(+(w.lam * 0.4).toFixed(6))}, fade);
    if (wf > 0.0) {
      vec3 D = vec3(${w.d.map(f).join(', ')});
      vec3 Dt = D - up * dot(D, up);
      float ph = uSeaPh[${i}] + dot(rel, D) * ${f(w.k)};
      float a = ${f(w.amp)} * length(Dt) * wf;
      hgt += a * sin(ph);
      sl += Dt * (a * ${f(w.k)} * cos(ph));
    }
  }`).join('\n')}
  return vec4(sl, hgt);
}
`;

/** The waves' phases at the camera (camM: camera, Moon frame km; t seconds), into out[]. */
export function seaPhases(camM, t, out) {
  SEA_WAVES.forEach((w, i) => {
    const ph = (camM.x * w.d[0] + camM.y * w.d[1] + camM.z * w.d[2]) * w.k - w.omega * t;
    out[i] = ph - 2 * Math.PI * Math.floor(ph / (2 * Math.PI));
  });
  return out;
}

export class WaterWaves {
  constructor() { this.waves = SEA_WAVES; this.glsl = SEA_GLSL; }
  /** Sea surface height (km above the sphere) at the point P (km, Moon frame) at time t (s). */
  height(px, py, pz, t) {
    const l = Math.hypot(px, py, pz) || 1;
    const ux = px / l, uy = py / l, uz = pz / l;
    let h = 0;
    for (const w of this.waves) {
      const [dx, dy, dz] = w.d;
      const du = dx * ux + dy * uy + dz * uz;
      const share = Math.hypot(dx - ux * du, dy - uy * du, dz - uz * du);
      const ph = (px * dx + py * dy + pz * dz) * w.k - w.omega * t;
      h += w.amp * share * Math.sin(ph);
    }
    return h;
  }
}
export const seaHeight = (() => { const W = new WaterWaves(); return (dir, t, R) => W.height(dir.x * R, dir.y * R, dir.z * R, t); })();
