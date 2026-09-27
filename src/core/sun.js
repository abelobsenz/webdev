import * as THREE from 'three';

// Local frame: +X east, +Y up, +Z south (north = -Z). Latitude 0 (equator —
// the space elevator must stand on it). June solstice: declination +23.4°,
// which puts the Galactic Centre high in the southern sky at midnight.
const DECL = THREE.MathUtils.degToRad(23.4);
const LAT = 0;
const P = new THREE.Vector3(0, Math.sin(LAT), -Math.cos(LAT));   // celestial north pole
const M = new THREE.Vector3(0, Math.cos(LAT), Math.sin(LAT));    // equator ∩ meridian
const W = new THREE.Vector3(-1, 0, 0);                           // west point
const SUN_RA = THREE.MathUtils.degToRad(90);

function dirFromHourAngle(H, dec, out) {
  const cd = Math.cos(dec);
  out.set(0, 0, 0)
    .addScaledVector(M, cd * Math.cos(H))
    .addScaledVector(W, cd * Math.sin(H))
    .addScaledVector(P, Math.sin(dec));
  return out.normalize();
}

/** hours → sun & moon directions and the celestial rotation for the star field. */
export function computeSky(hours, out) {
  const H = ((hours - 12) / 24) * Math.PI * 2;
  dirFromHourAngle(H, DECL, out.sunDir);
  // Waxing gibbous moon ~140° east of the sun
  const Hm = H - THREE.MathUtils.degToRad(140);
  dirFromHourAngle(Hm, DECL - THREE.MathUtils.degToRad(12), out.moonDir);
  // Local sidereal time: RA on the meridian
  const lst = SUN_RA + H;
  // local dir -> equatorial inertial: inertial = Rz(lst) * diag(1,-1,1) * [M W P]^T * dir
  const c = Math.cos(lst), s = Math.sin(lst);
  // rows of [M; -W; P]
  const r0 = [M.x, M.y, M.z], r1 = [-W.x, -W.y, -W.z], r2 = [P.x, P.y, P.z];
  const m = [
    c * r0[0] - s * r1[0], c * r0[1] - s * r1[1], c * r0[2] - s * r1[2],
    s * r0[0] + c * r1[0], s * r0[1] + c * r1[1], s * r0[2] + c * r1[2],
    r2[0], r2[1], r2[2],
  ];
  // Matrix3.set takes row-major arguments
  out.celestial.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
  return out;
}

export function formatClock(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
