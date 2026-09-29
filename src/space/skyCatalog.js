import * as THREE from 'three';

// The bright stars (to about magnitude 3.5, with the Pleiades), so the constellations are the
// real ones: J2000 right ascension (hours), declination (deg), visual magnitude V and colour
// index B-V. Colours come from each star's temperature through the Planck spectrum and the CIE
// observer; positions are precessed three thousand years to the sim's epoch, so the pole of
// 5021 lies in Cepheus, between Errai and Iota Cephei, and Polaris has wandered away from it.

// [RA h, Dec deg, V, B-V]
export const BRIGHT_STARS = [
  [6.752, -16.716, -1.46, 0.00], [6.399, -52.696, -0.74, 0.15], [14.660, -60.835, -0.27, 0.71], [14.261, 19.182, -0.05, 1.23],
  [18.616, 38.784, 0.03, 0.00], [5.278, 45.998, 0.08, 0.80], [5.242, -8.202, 0.13, -0.03], [7.655, 5.225, 0.34, 0.42],
  [1.629, -57.237, 0.46, -0.16], [5.919, 7.407, 0.50, 1.85], [14.064, -60.373, 0.61, -0.23], [19.846, 8.868, 0.76, 0.22],
  [12.443, -63.099, 0.76, -0.24], [4.599, 16.509, 0.86, 1.54], [16.490, -26.432, 0.96, 1.83], [13.420, -11.161, 0.97, -0.23],
  [7.755, 28.026, 1.14, 1.00], [22.961, -29.622, 1.16, 0.09], [20.690, 45.280, 1.25, 0.09], [12.795, -59.689, 1.25, -0.23],
  [10.140, 11.967, 1.40, -0.11], [6.977, -28.972, 1.50, -0.21], [7.577, 31.888, 1.58, 0.04], [12.519, -57.113, 1.63, 1.59],
  [17.560, -37.104, 1.62, -0.22], [5.419, 6.350, 1.64, -0.22], [5.438, 28.608, 1.65, -0.13], [9.220, -69.717, 1.67, 0.00],
  [5.604, -1.202, 1.69, -0.18], [22.137, -46.961, 1.74, -0.13], [5.679, -1.943, 1.77, -0.21], [12.900, 55.960, 1.77, -0.02],
  [11.062, 61.751, 1.79, 1.07], [3.405, 49.861, 1.79, 0.48], [7.140, -26.393, 1.83, 0.68], [8.159, -47.337, 1.83, -0.22],
  [18.403, -34.385, 1.85, -0.03], [8.375, -59.510, 1.86, 1.28], [13.792, 49.313, 1.86, -0.19], [17.622, -42.998, 1.87, 0.40],
  [5.992, 44.948, 1.90, 0.03], [16.811, -69.028, 1.91, 1.45], [6.629, 16.399, 1.93, 0.00], [20.427, -56.735, 1.94, -0.20],
  [8.745, -54.709, 1.95, 0.04], [6.378, -17.956, 1.98, -0.23], [9.460, -8.659, 1.98, 1.44], [2.530, 89.264, 1.98, 0.60],
  [2.120, 23.462, 2.00, 1.15], [10.333, 19.842, 2.01, 1.13], [0.727, -17.987, 2.04, 1.02], [18.921, -26.297, 2.05, -0.13],
  [14.111, -36.370, 2.06, 1.01], [1.162, 35.621, 2.05, 1.58], [0.140, 29.091, 2.06, -0.11], [17.582, 12.560, 2.07, 0.15],
  [14.845, 74.156, 2.08, 1.47], [5.796, -9.670, 2.09, -0.18], [11.818, 14.572, 2.14, 0.09], [3.136, 40.956, 2.12, -0.05],
  [22.711, -46.885, 2.07, 1.60], [12.692, -48.960, 2.20, -0.01], [8.060, -40.003, 2.21, -0.27], [9.285, -59.275, 2.21, 0.18],
  [15.578, 26.715, 2.22, -0.02], [9.133, -43.433, 2.23, 1.66], [13.399, 54.925, 2.23, 0.02], [20.370, 40.257, 2.23, 0.67],
  [0.675, 56.537, 2.24, 1.17], [17.943, 51.489, 2.24, 1.52], [5.533, -0.299, 2.25, -0.22], [0.153, 59.150, 2.28, 0.34],
  [16.006, -22.622, 2.29, -0.12], [16.836, -34.293, 2.29, 1.15], [14.699, -47.388, 2.30, -0.15], [14.592, -42.158, 2.31, -0.19],
  [11.031, 56.382, 2.37, -0.02], [14.750, 27.074, 2.37, 0.97], [21.736, 9.875, 2.38, 1.52], [17.708, -39.030, 2.39, -0.17],
  [0.438, -42.306, 2.40, 1.09], [11.897, 53.695, 2.41, 0.04], [17.173, -15.725, 2.43, 0.06], [23.063, 28.083, 2.42, 1.67],
  [7.401, -29.303, 2.45, -0.08], [9.368, -55.011, 2.47, -0.14], [0.945, 60.717, 2.47, -0.15], [23.079, 15.205, 2.49, -0.04],
  [3.038, 4.090, 2.54, 1.64], [16.619, -10.567, 2.56, 0.02], [11.235, 20.524, 2.56, 0.12], [16.091, -19.806, 2.62, -0.07],
  [5.546, -17.822, 2.58, 0.21], [12.263, -17.542, 2.59, -0.11], [15.738, 6.426, 2.63, 1.17], [1.911, 20.808, 2.64, 0.13],
  [23.656, 77.632, 3.21, 1.03], [21.310, 62.586, 2.45, 0.22], [21.478, 70.561, 3.23, -0.20], [22.828, 66.201, 3.52, 1.05],
  [1.430, 60.235, 2.68, 0.13], [1.907, 63.670, 3.37, -0.15], [19.512, 27.960, 3.05, 1.13], [20.770, 33.970, 2.48, 1.03],
  [19.750, 45.131, 2.87, -0.03], [19.771, 10.613, 2.72, 1.52], [13.036, 10.959, 2.83, 0.94], [12.252, -58.749, 2.79, -0.23],
  [12.357, -60.401, 3.59, 1.42], [3.791, 24.105, 2.87, -0.09], [3.819, 24.053, 3.62, -0.07], [3.747, 24.113, 3.70, -0.11],
  [3.764, 24.368, 3.87, -0.07], [3.772, 23.948, 4.18, -0.06], [3.754, 24.467, 4.30, -0.11], [18.350, -29.828, 2.70, 1.38],
  [18.466, -25.421, 2.81, 1.02], [19.043, -29.880, 2.60, 0.08], [18.761, -26.991, 3.17, -0.11], [19.116, -27.671, 3.32, 1.19],
  [17.513, -37.296, 2.70, -0.22], [17.793, -40.127, 3.03, 0.51], [16.864, -38.048, 3.08, -0.20], [16.598, -28.216, 2.82, -0.25],
  [16.353, -25.593, 2.89, 0.13], [5.585, 9.934, 3.39, -0.16], [12.257, 57.033, 3.31, 0.08], [15.345, 71.834, 3.00, 0.05],
  [6.338, -30.063, 3.02, -0.19], [15.919, -63.430, 2.85, 0.29], [15.315, -68.679, 2.87, 0.00], [19.922, 6.407, 3.71, 0.86],
  [18.835, 33.363, 3.52, 0.00], [18.982, 32.690, 3.25, -0.05], [16.504, 21.490, 2.78, 0.95], [12.573, -23.397, 2.65, 0.89],
  [12.498, -16.515, 2.95, -0.05], [2.065, 42.330, 2.26, 1.37], [0.221, 15.184, 2.83, -0.23], [5.131, -5.086, 2.79, 0.13],
  [2.971, -40.305, 2.88, 0.14], [10.716, -64.394, 2.76, -0.22], [5.661, -34.074, 2.65, -0.12], [17.507, 52.301, 2.79, 0.98],
  [14.073, 64.376, 3.65, -0.05],
];

/** Effective temperature (K) from B-V (Ballesteros 2012). */
export function bvToTemperature(bv) {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

// CIE 1931 colour matching functions, multi-lobe Gaussian fit (Wyman, Sloan and Shirley 2013)
function g(x, mu, s1, s2) { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }
function cieX(l) { return 1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2); }
function cieY(l) { return 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1); }
function cieZ(l) { return 1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8); }

/**
 * Linear-sRGB colour of a blackbody at temperature T (K), normalised so its brightest channel
 * is 1, then paled toward white by `pale` (a point of starlight reads less saturated to the eye
 * than a patch of the same spectrum).
 */
export function blackbodyRGB(T, pale = 0.3, out = new THREE.Color()) {
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const lm = l * 1e-9;
    const B = 1 / (Math.pow(lm, 5) * (Math.exp(0.0143877735 / (lm * T)) - 1));
    X += B * cieX(l); Y += B * cieY(l); Z += B * cieZ(l);
  }
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let gg = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  r = Math.max(r, 0); gg = Math.max(gg, 0); b = Math.max(b, 0);
  const m = Math.max(r, gg, b, 1e-30);
  r /= m; gg /= m; b /= m;
  return out.setRGB(r + (1 - r) * pale, gg + (1 - gg) * pale, b + (1 - b) * pale);
}

// The temperature stops of the shader's star palette (the faint procedural crowd)
export const STAR_PAL_T = [2800, 3600, 4500, 5400, 6500, 8200, 11000, 20000];
export function starPalette() { return STAR_PAL_T.map((T) => { const c = blackbodyRGB(T, 0.3); return new THREE.Vector3(c.r, c.g, c.b); }); }

// ---- precession of the equinoxes ------------------------------------------------------------
export const PRECESSION_EPOCH = 5021.47;
const EPS = 23.4 * Math.PI / 180;
/** General precession in longitude (radians) from J2000 to the given year (IAU 1976 series). */
export function precessionAngle(year) {
  const T = (year - 2000) / 100;
  return ((5028.796195 * T + 1.1054348 * T * T) / 3600) * Math.PI / 180;
}
/**
 * Matrix taking J2000 equatorial Cartesian (x to RA 0h, y to RA 6h, z north) to the equatorial
 * frame of date: into the ecliptic, turned about its pole by the precession, and back.
 */
export function precessionMatrix(year = PRECESSION_EPOCH) {
  const p = precessionAngle(year);
  const ce = Math.cos(EPS), se = Math.sin(EPS), cp = Math.cos(p), sp = Math.sin(p);
  const Rx = new THREE.Matrix3().set(1, 0, 0, 0, ce, se, 0, -se, ce);        // equatorial -> ecliptic
  const Rz = new THREE.Matrix3().set(cp, -sp, 0, sp, cp, 0, 0, 0, 1);        // longitude + p
  const RxT = Rx.clone().transpose();
  return RxT.multiply(Rz).multiply(Rx);
}
/** Unit equatorial vector (J2000) for RA (hours) and Dec (degrees). */
export function raDecToVector(raH, decD, out = new THREE.Vector3()) {
  const a = raH / 12 * Math.PI, d = decD * Math.PI / 180;
  return out.set(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
}
/** Sim inertial direction (+Y the pole) from an equatorial-of-date vector (x RA 0h, y RA 6h, z north). */
export function equatorialToInertial(c, out = new THREE.Vector3()) { return out.set(c.y, c.z, c.x); }

/** The catalogue in the sim's inertial frame of date: { dir, mag, color } per star. */
export function catalogStars(year = PRECESSION_EPOCH) {
  const M = precessionMatrix(year);
  const c = new THREE.Vector3();
  return BRIGHT_STARS.map(([ra, dec, V, bv]) => {
    raDecToVector(ra, dec, c).applyMatrix3(M);
    return { dir: equatorialToInertial(c).normalize(), mag: V, color: blackbodyRGB(bvToTemperature(bv), 0.3), bv };
  });
}
