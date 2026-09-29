import * as THREE from 'three';
import { R_EARTH } from './sim.js';

// Real orbits for the low and middle shell (km, s, radians), in the orbital view's inertial
// frame: +Y is the Earth's axis (north), the equator is the XZ plane and longitude grows from
// +X toward -Z (prograde, the way sim.earthQuat turns the planet). An orbit is the classical
// element set; the node and perigee drift under the Earth's oblateness (J2) so sun-synchronous
// planes hold their angle to the Sun and the rest slowly wheel round the pole. Everything is
// evaluated in double precision on the CPU from the sim clock; nothing integrates, so any
// instant (a warp jump, a saved view) lands exactly on the orbit.

export const MU = 398600.4418;            // km^3 s^-2
export const J2 = 1.08263e-3;
const R_J2 = 6378.137;                    // J2 reference radius (km)
const YEAR = 365.2422 * 86400;
const TAU = Math.PI * 2;

/** Circular speed (km/s) at radius r. */
export const circularSpeed = (r) => Math.sqrt(MU / r);
/** Period (s) of an orbit with semi-major axis a. */
export const periodOf = (a) => TAU * Math.sqrt((a * a * a) / MU);

/** Inclination (rad) that makes a circular orbit of radius a precess once a year (sun-synchronous). */
export function sunSyncInclination(a) {
  const want = TAU / YEAR;
  const n = Math.sqrt(MU / (a * a * a));
  const c = -want / (1.5 * n * J2 * (R_J2 / a) ** 2);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

/** Node direction (unit, equatorial) for a right ascension Omega. */
export function nodeDir(W, out = new THREE.Vector3()) { return out.set(Math.cos(W), 0, -Math.sin(W)); }

/** Unit angular-momentum vector of a plane with inclination i and node W. */
export function planeNormal(i, W, out = new THREE.Vector3()) {
  const s = Math.sin(i);
  return out.set(Math.sin(W) * s, Math.cos(i), Math.cos(W) * s);
}

/** Node that puts a plane's normal as close as it can get to direction d (a dawn-dusk plane faces the Sun). */
export function nodeFacing(d, i) {
  // normal = (sin W sin i, cos i, cos W sin i): maximise d.x sin W + d.z cos W
  return Math.atan2(d.x, d.z) + (Math.sin(i) < 0 ? Math.PI : 0);
}

export class Orbit {
  /**
   * { alt | a, e = 0, inc, node, argp = 0, M0 = 0, j2 = true }
   * alt: circular altitude above the scene's Earth radius (km). M0: mean anomaly at t = 0.
   */
  constructor({ alt, a, e = 0, inc = 0, node = 0, argp = 0, M0 = 0, j2 = true } = {}) {
    this.a = a ?? R_EARTH + alt;
    this.e = e; this.inc = inc; this.node0 = node; this.argp0 = argp; this.M0 = M0;
    this.n = Math.sqrt(MU / (this.a ** 3));
    this.period = TAU / this.n;
    const p = this.a * (1 - e * e);
    const k = j2 ? 1.5 * this.n * J2 * (R_J2 / p) ** 2 : 0;
    this.nodeRate = -k * Math.cos(inc);
    this.argpRate = k * (2 - 2.5 * Math.sin(inc) ** 2);
    this._N = new THREE.Vector3(); this._M = new THREE.Vector3();
    this._h = new THREE.Vector3();
    this._t = NaN;
    this._r = 0; this._nu = 0; this._rdot = 0; this._rnudot = 0;
  }

  /** Solve the anomaly for time t and cache the plane basis (N toward perigee, M ahead of it). */
  _solve(t) {
    if (t === this._t) return;
    this._t = t;
    const W = this.node0 + this.nodeRate * t;
    const w = this.argp0 + this.argpRate * t;
    let M = (this.M0 + this.n * t) % TAU;
    if (M < 0) M += TAU;
    const e = this.e;
    let E = M;
    if (e > 0) for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const cE = Math.cos(E), sE = Math.sin(E);
    const sq = Math.sqrt(1 - e * e);
    this._nu = Math.atan2(sq * sE, cE - e);
    this._r = this.a * (1 - e * cE);
    const pp = this.a * (1 - e * e);
    const h = Math.sqrt(MU * pp);
    this._rdot = (MU / h) * e * Math.sin(this._nu);
    this._rnudot = h / this._r;
    // perifocal basis: node line rotated by the argument of perigee inside the tilted plane
    const cW = Math.cos(W), sW = Math.sin(W), ci = Math.cos(this.inc), si = Math.sin(this.inc);
    const nx = cW, nz = -sW;                       // node
    const ex = -sW * ci, ey = si, ez = -cW * ci;   // 90 deg ahead of the node in the plane
    const cw = Math.cos(w), sw = Math.sin(w);
    this._N.set(nx * cw + ex * sw, ey * sw, nz * cw + ez * sw);
    this._M.set(-nx * sw + ex * cw, ey * cw, -nz * sw + ez * cw);
    this._h.set(sW * si, ci, cW * si);
  }

  /** Inertial position (km) at sim time t. */
  pos(t, out = new THREE.Vector3()) {
    this._solve(t);
    const c = Math.cos(this._nu), s = Math.sin(this._nu), r = this._r;
    return out.set(0, 0, 0).addScaledVector(this._N, r * c).addScaledVector(this._M, r * s);
  }

  /** Inertial velocity (km/s) at sim time t. */
  vel(t, out = new THREE.Vector3()) {
    this._solve(t);
    const c = Math.cos(this._nu), s = Math.sin(this._nu);
    const vr = this._rdot, vt = this._rnudot;
    return out.set(0, 0, 0).addScaledVector(this._N, vr * c - vt * s).addScaledVector(this._M, vr * s + vt * c);
  }

  /** Orbit normal (unit) at sim time t. */
  normal(t, out = new THREE.Vector3()) { this._solve(t); return out.copy(this._h); }

  /** Argument of latitude (angle from the ascending node) at t: where in its lap the craft is. */
  lap(t) { this._solve(t); return this.argp0 + this.argpRate * t + this._nu; }

  /**
   * Local-vertical local-horizontal attitude: +y radial (away from the Earth), +z along the
   * velocity, +x = y cross z (the orbit normal). Returns the quaternion.
   */
  lvlh(t, out = new THREE.Quaternion()) {
    this.pos(t, _y).normalize();
    _z.copy(this._h).cross(_y).normalize();          // horizontal, prograde
    _x.crossVectors(_y, _z);
    return out.setFromRotationMatrix(_mb.makeBasis(_x, _y, _z));
  }

  /** Sample the path as a closed polyline (inertial km) at time t, n points. */
  path(t, n = 256) {
    this._solve(t);
    const pts = [], e = this.e, pp = this.a * (1 - e * e);
    for (let k = 0; k <= n; k++) {
      const nu = (k / n) * TAU, r = pp / (1 + e * Math.cos(nu));
      pts.push(new THREE.Vector3().addScaledVector(this._N, r * Math.cos(nu)).addScaledVector(this._M, r * Math.sin(nu)));
    }
    return pts;
  }
}
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _mb = new THREE.Matrix4();

/** Fraction of the Sun visible from inertial point p (cylindrical umbra, a thin soft penumbra). */
export function sunlitFraction(p, sunDir) {
  const d = p.x * sunDir.x + p.y * sunDir.y + p.z * sunDir.z;
  if (d > 0) return 1;
  const q2 = p.lengthSq() - d * d;
  const q = Math.sqrt(Math.max(q2, 0));
  const t = (q - (R_EARTH - 40)) / 80;
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/**
 * Cubic Hermite between two states (positions p0, p1 in km, velocities v0, v1 in km/s) over a
 * leg of D seconds: a smooth transfer that leaves and arrives matched to both ends. u in 0..1.
 * Writes position into out and (if given) the velocity direction into outV.
 */
export function hermite(p0, v0, p1, v1, D, u, out, outV) {
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  out.set(
    h00 * p0.x + h10 * D * v0.x + h01 * p1.x + h11 * D * v1.x,
    h00 * p0.y + h10 * D * v0.y + h01 * p1.y + h11 * D * v1.y,
    h00 * p0.z + h10 * D * v0.z + h01 * p1.z + h11 * D * v1.z,
  );
  if (outV) {
    const d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = -6 * u2 + 6 * u, d11 = 3 * u2 - 2 * u;
    outV.set(
      (d00 * p0.x + d01 * p1.x) / D + d10 * v0.x + d11 * v1.x,
      (d00 * p0.y + d01 * p1.y) / D + d10 * v0.y + d11 * v1.y,
      (d00 * p0.z + d01 * p1.z) / D + d10 * v0.z + d11 * v1.z,
    );
  }
  return out;
}
