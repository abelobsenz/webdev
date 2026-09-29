import * as THREE from 'three';

// The planets on their real orbits. Keplerian mean elements at J2000 with their secular rates
// per Julian century (Standish's approximate elements, JPL): a (AU), e, I, L, long. perihelion,
// long. node (deg). Propagated to the June solstice of 5021, solved for the true anomaly, and
// seen from the Earth. The sim keeps the Sun still at ecliptic longitude 90 of the date (the
// solstice), so every direction is measured from the Sun's: that folds three millennia of
// precession of the equinoxes into the frame, as it should be.
//
// Apparent magnitudes from the heliocentric and geocentric distances and the phase angle (the
// Explanatory Supplement's phase curves), so Venus is a -4 evening star when it stands far from
// the Sun and fades at inferior conjunction; Mars brightens at opposition; Mercury never strays
// more than ~28 degrees from the Sun, Venus ~47.

export const EPOCH_YEAR = 5021.47;            // the June solstice the sim is held at (Venus high in the evening, Mars and Jupiter up all night)
const JD2000 = 2451545.0;
const D2R = Math.PI / 180;

//            a            da          e           de          I            dI           L              dL               peri          dperi        node          dnode
const ELEMENTS = {
  mercury: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.25032350, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
  venus: [0.72333566, 0.00000390, 0.00677672, -0.00004107, 3.39467605, -0.00078890, 181.97909950, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
  earth: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0.0, 0.0],
  mars: [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
  jupiter: [5.20288700, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
  saturn: [9.53667594, -0.00125060, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
  uranus: [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451, 428.48202785, 170.95427630, 0.40805281, 74.01692503, 0.04240589],
  neptune: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664],
};

// The sky's planets, in the order of the shader's uPlanets[] array, with their visual colours
// (reflectance spectra, lifted a little so they read as tints on a point).
export const SKY_PLANETS = [
  { name: 'Mercury', key: 'mercury', col: [0.95, 0.88, 0.8], mag: (a) => -0.42 + 0.038 * a - 0.000273 * a * a + 0.000002 * a * a * a },
  { name: 'Venus', key: 'venus', col: [1.0, 0.97, 0.88], mag: (a) => -4.40 + 0.0009 * a + 0.000239 * a * a - 0.00000065 * a * a * a },
  { name: 'Mars', key: 'mars', col: [1.0, 0.56, 0.36], mag: (a) => -1.52 + 0.016 * a },
  { name: 'Jupiter', key: 'jupiter', col: [1.0, 0.93, 0.8], mag: (a) => -9.40 + 0.005 * a },
  { name: 'Saturn', key: 'saturn', col: [1.0, 0.89, 0.66], mag: (a) => -8.88 + 0.044 * a },
  { name: 'Uranus', key: 'uranus', col: [0.72, 0.92, 1.0], mag: () => -7.19 },
  { name: 'Neptune', key: 'neptune', col: [0.55, 0.68, 1.0], mag: () => -6.87 },
];
export const N_SKY_PLANETS = SKY_PLANETS.length;

/** Kepler's equation by Newton iteration (e < 0.25 for every planet here). */
export function solveKepler(M, e) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/** Heliocentric ecliptic position (AU, J2000 ecliptic axes) of a planet at T Julian centuries from J2000. */
export function heliocentric(key, T, out) {
  const el = ELEMENTS[key];
  const a = el[0] + el[1] * T, e = el[2] + el[3] * T, I = (el[4] + el[5] * T) * D2R;
  const L = el[6] + el[7] * T, peri = el[8] + el[9] * T, node = el[10] + el[11] * T;
  const w = (peri - node) * D2R;
  let M = ((L - peri) % 360) * D2R;
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(node * D2R), sO = Math.sin(node * D2R), cI = Math.cos(I), sI = Math.sin(I);
  const x1 = cw * xp - sw * yp, y1 = sw * xp + cw * yp;
  return out.set(cO * x1 - sO * cI * y1, sO * x1 + cO * cI * y1, sI * y1);
}

/** Julian centuries from J2000 for a (decimal) year plus seconds of sim time. */
export function centuriesAt(year, seconds = 0) {
  const jd = JD2000 + (year - 2000) * 365.25 + seconds / 86400;
  return (jd - JD2000) / 36525;
}

// The sim's inertial frame: +Y the celestial pole of date, the equinox of date along +Z, the
// Sun at ecliptic longitude 90 in the XY plane (see skyGlsl.js / sim.js).
const EPS = 23.4 * D2R;
const E1 = new THREE.Vector3(0, 0, 1);
const E2 = new THREE.Vector3(Math.cos(EPS), Math.sin(EPS), 0);
const EN = new THREE.Vector3().crossVectors(E1, E2);
/** Inertial direction for an ecliptic longitude / latitude (radians) of date. */
export function eclipticToInertial(lon, lat, out) {
  const cb = Math.cos(lat);
  return out.set(0, 0, 0).addScaledVector(E1, Math.cos(lon) * cb).addScaledVector(E2, Math.sin(lon) * cb).addScaledVector(EN, Math.sin(lat)).normalize();
}

/** Visual brightness weight for the sky shader from an apparent magnitude (1 at magnitude +0.5;
 *  compressed for the bright end so Venus does not bloom into a flare, steep for the faint). */
export function magWeight(m) {
  return m < 0.5 ? Math.pow(10, -0.16 * (m - 0.5)) : Math.pow(10, -0.3 * (m - 0.5));
}

const _E = new THREE.Vector3(), _P = new THREE.Vector3(), _G = new THREE.Vector3(), _S = new THREE.Vector3();
/**
 * Fill `rows` (one per SKY_PLANETS entry) with { dir (inertial unit vector), mag, elong (deg),
 * phase (deg), r, delta (AU) } for sim time `seconds` after the epoch.
 */
export function planetSky(seconds, rows) {
  const T = centuriesAt(EPOCH_YEAR, seconds);
  heliocentric('earth', T, _E);
  // the Sun seen from the Earth, in J2000 ecliptic axes
  _S.copy(_E).negate();
  const lonSun = Math.atan2(_S.y, _S.x);
  for (let i = 0; i < SKY_PLANETS.length; i++) {
    const p = SKY_PLANETS[i];
    heliocentric(p.key, T, _P);
    _G.copy(_P).sub(_E);
    const delta = _G.length(), r = _P.length(), R = _E.length();
    const lon = Math.atan2(_G.y, _G.x) - lonSun + Math.PI / 2;     // measured from the Sun's 90
    const lat = Math.asin(THREE.MathUtils.clamp(_G.z / delta, -1, 1));
    // phase angle (Sun - planet - Earth) and elongation (Sun - Earth - planet)
    const cosA = THREE.MathUtils.clamp((r * r + delta * delta - R * R) / (2 * r * delta), -1, 1);
    const alpha = Math.acos(cosA) / D2R;
    const elong = Math.acos(THREE.MathUtils.clamp(_G.dot(_S) / (delta * R), -1, 1)) / D2R;
    const row = rows[i] || (rows[i] = { dir: new THREE.Vector3() });
    eclipticToInertial(lon, lat, row.dir);
    row.mag = p.mag(alpha) + 5 * Math.log10(r * delta);
    row.phase = alpha;
    row.elong = elong;
    row.r = r;
    row.delta = delta;
  }
  return rows;
}
