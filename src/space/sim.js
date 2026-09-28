import * as THREE from 'three';

// Orbital-view clock and reference frames. Units: km, seconds.
//
// Inertial frame: +Y = Earth's rotation axis (north). The date is held at the
// June solstice (as in src/core/sun.js), so the Sun sits still at declination
// +23.4 deg in the XY plane and the Earth turns beneath it. Body (Earth-fixed)
// frame: longitude phi, latitude beta -> (cos b cos p, sin b, -cos b sin p).
// City frame at Meridian (x east, y up, z south) maps to body via cityToBody().

export const R_EARTH = 6360;                 // matches Rg in src/shaders/atmosphere.glsl.js
export const R_MOON = 1737;
export const MOON_DIST = 384400;
export const GEO_ALT = 35786;
export const COUNTERWEIGHT_ALT = 100000;
export const MERIDIAN_LON = THREE.MathUtils.degToRad(-157.4);
export const SUN_DIST = 1.496e8;
export const DECL = THREE.MathUtils.degToRad(23.4);
const DAY = 86400;
const SYNODIC = 29.530589 * DAY;

export const SUN_DIR = new THREE.Vector3(Math.cos(DECL), Math.sin(DECL), 0);

/** Body-frame unit vector for a latitude/longitude in radians. */
export function bodyDir(lat, lon, out = new THREE.Vector3()) {
  const cb = Math.cos(lat);
  return out.set(cb * Math.cos(lon), Math.sin(lat), -cb * Math.sin(lon));
}

/** Rotation matrix taking city-local axes (x east, y up, z south) into the body frame. */
export function cityToBody() {
  const up = bodyDir(0, MERIDIAN_LON);
  const east = new THREE.Vector3(-Math.sin(MERIDIAN_LON), 0, -Math.cos(MERIDIAN_LON));
  const south = new THREE.Vector3(0, -1, 0);
  return new THREE.Matrix4().makeBasis(east, up, south);
}

export class SpaceSim {
  constructor() {
    this.t = 0;                   // simulated seconds since the epoch of this session
    this.warp = 60;
    this.paused = false;
    this.theta0 = 0;              // Earth rotation angle at t = 0
    this.earthQuat = new THREE.Quaternion();
    this.earthMat = new THREE.Matrix4();
    this.sunDir = SUN_DIR.clone();
    this.sunPos = SUN_DIR.clone().multiplyScalar(SUN_DIST);
    this.moonPos = new THREE.Vector3();
    this.moonQuat = new THREE.Quaternion();
    this.moon0 = new THREE.Vector3();
    this.moonT = new THREE.Vector3();
    this.hearthPos = new THREE.Vector3();
    this._lastHours = null;
    this._axis = new THREE.Vector3(0, 1, 0);
    // The Hearth: on a wide halo orbit around the Sun-Earth L2 point, so it stays
    // out of the Earth's shadow. Offset from L2 fixed in the inertial frame.
    const l2 = SUN_DIR.clone().multiplyScalar(-1.5e6);
    const side = new THREE.Vector3().crossVectors(SUN_DIR, new THREE.Vector3(0, 0, 1)).normalize();
    this.hearthPos.copy(l2).addScaledVector(side, -260000).addScaledVector(new THREE.Vector3(0, 0, 1), 180000);
  }

  get theta() { return this.theta0 + (this.t / DAY) * Math.PI * 2; }

  /** Local solar time at Meridian for the current rotation. */
  get hours() {
    const psi = this.theta + MERIDIAN_LON;
    return (((psi / (Math.PI * 2)) * 24 + 12) % 24 + 24) % 24;
  }

  /** Set the Earth's rotation (and a matching Moon) from the city clock. */
  syncFromHours(h, moonDirLocal) {
    const H = ((h - 12) / 24) * Math.PI * 2;
    this.theta0 = H - MERIDIAN_LON - (this.t / DAY) * Math.PI * 2;
    if (moonDirLocal) this._initMoon(moonDirLocal);
    this.update();
    this._lastHours = this.hours;
  }

  _initMoon(moonLocal) {
    // city-local -> inertial at this instant: x*E + y*U - z*N
    const psi = this.theta + MERIDIAN_LON;
    const U = new THREE.Vector3(Math.cos(psi), 0, -Math.sin(psi));
    const E = new THREE.Vector3(-Math.sin(psi), 0, -Math.cos(psi));
    const N = new THREE.Vector3(0, 1, 0);
    const d = new THREE.Vector3().addScaledVector(E, moonLocal.x).addScaledVector(U, moonLocal.y).addScaledVector(N, -moonLocal.z).normalize();
    // orbit plane: through d, prograde (eastward), tilted ~18 deg to the equator
    const east = new THREE.Vector3().crossVectors(N, d);
    if (east.lengthSq() < 1e-12) east.crossVectors(new THREE.Vector3(0,0,1), d);
    east.normalize();
    const north = new THREE.Vector3().crossVectors(d, east).normalize();
    const tilt = THREE.MathUtils.degToRad(-14);
    this.moonT.copy(east).multiplyScalar(Math.cos(tilt)).addScaledVector(north, Math.sin(tilt)).normalize();
    this.moon0.copy(d);
    this.moonTime0 = this.t;
  }

  step(dt) {
    if (!this.paused) this.t += dt * this.warp;
    this.update();
  }

  update() {
    const th = this.theta;
    this.earthQuat.setFromAxisAngle(this._axis, th);
    this.earthMat.makeRotationFromQuaternion(this.earthQuat);
    if (this.moonTime0 === undefined) this._initMoon(new THREE.Vector3(-0.6, 0.35, -0.2));
    const a = ((this.t - this.moonTime0) / SYNODIC) * Math.PI * 2;
    const dir = this.moon0.clone().multiplyScalar(Math.cos(a)).addScaledVector(this.moonT, Math.sin(a));
    this.moonPos.copy(dir).multiplyScalar(MOON_DIST);
    // tidally locked: Moon-frame +X faces the Earth, +Y ~ orbit normal
    const nrm = new THREE.Vector3().crossVectors(this.moon0, this.moonT).normalize();
    const x = dir.clone().negate();
    const z = new THREE.Vector3().crossVectors(x, nrm).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    this.moonQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }

  /** Inertial position of a body-frame point. */
  toInertial(v, out = new THREE.Vector3()) { return out.copy(v).applyQuaternion(this.earthQuat); }
}
