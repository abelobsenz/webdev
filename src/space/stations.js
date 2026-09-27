import * as THREE from 'three';

// Station frames and builders shared by the elevator, the rings and the fleet.

const _n = new THREE.Vector3(0, 1, 0);

/**
 * Local frame for a station on the tether or the Halo, in the Earth-fixed (body) frame:
 * +Y up (radial), +Z north (the Earth's axis), +X west. Orbital motion is toward -X.
 */
export function stationFrame(up, out = new THREE.Quaternion()) {
  const west = new THREE.Vector3().crossVectors(up, _n).normalize();
  const north = new THREE.Vector3().crossVectors(west, up).normalize();
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(west, up, north));
}

/**
 * The Harbour's traffic corridors, as directions in its local frame (x west, y up, z north).
 * Arrivals come in from high and west (warm lane lights); departures leave eastward and
 * outward, prograde, the way a ship bound for Mars or the outer system would burn.
 */
export const CORRIDORS = {
  dA: new THREE.Vector3(0.78, 0.42, -0.46).normalize(),
  dD: new THREE.Vector3(-0.86, 0.3, 0.41).normalize(),
};
