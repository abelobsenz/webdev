import * as THREE from 'three';
import { R_MOON } from './sim.js';

// Medii Landing: the surface port directly beneath the Tranquillity Exchange (Moon
// frame +X, selenographic 0 N 0 E), on the south-west shore of the Bay of the Middle.
//
// One description of the site is shared by the Moon's bake, the Moon's surface shader
// and the settlement's geometry, so the coast the quays are built on is the coast the
// planet draws. Site frame (stationFrame(+X)): x west, y up (radial), z north; the
// "ortho" coordinates of a surface point are its x and z in this frame (km), which is
// exactly the projection of the point onto the site's tangent plane.

export const SITE_UP = new THREE.Vector3(1, 0, 0);
export const SITE_WEST = new THREE.Vector3(0, 0, 1);
export const SITE_NORTH = new THREE.Vector3(0, 1, 0);

// The Bay of the Middle (Sinus Medii) as a circle in ortho coordinates (km). Its shore
// passes 3.1 km north-east of the Lift, and it opens toward Mare Vaporum and
// Tranquillitatis beyond the horizon.
export const BAY_R = 136.0;
const BAY_OFF = (BAY_R + 3.1) / Math.SQRT2;
export const BAY = { x: -BAY_OFF, z: BAY_OFF, r: BAY_R };

/** Signed distance to the shore (km): positive over the water. x west, z north (km). */
export function bayDepthCoord(x, z) { return BAY.r - Math.hypot(x - BAY.x, z - BAY.z); }

/** Height (metres) of the Moon's drawn sphere below the site's tangent plane at x, z (metres). */
export function surfaceY(x, z) {
  const R = R_MOON * 1000;
  const q = x * x + z * z;
  return -q / (R + Math.sqrt(Math.max(R * R - q, 0)));
}

/** Local up (site frame) at x, z (metres): the radial direction of the sphere there. */
export function surfaceUp(x, z, out = new THREE.Vector3()) {
  const R = R_MOON * 1000;
  return out.set(x, R + surfaceY(x, z), z).normalize();
}

// GLSL twin of the definitions above (km). Used by the bake and the surface shader.
export const SITE_GLSL = /* glsl */ `
const vec3 SITE_UP = vec3(1.0, 0.0, 0.0);
const vec3 SITE_WEST = vec3(0.0, 0.0, 1.0);
const vec3 SITE_NORTH = vec3(0.0, 1.0, 0.0);
const vec3 BAY = vec3(${BAY.x.toFixed(4)}, ${BAY.z.toFixed(4)}, ${BAY.r.toFixed(4)});
// signed distance to the Bay's shore (km, + over water) at ortho coordinates q (x west, z north)
float bayDist(vec2 q) { return BAY.z - length(q - BAY.xy); }
`;
