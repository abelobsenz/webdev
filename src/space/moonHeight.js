import * as THREE from 'three';

// The Moon's solid ground on the CPU, matching the GPU surface (moonSurface.js) so the ship can
// stand on it and the autopilot can land on it.
//
// moonGround(dir, out) - dir: unit vector from the Moon's centre in its BODY frame (the local frame
// of moon.group, which the surface shaders are drawn in). Fills out = { h, water, normal }:
//   h       ground elevation above R_MOON (km); where there is sea, the sea surface
//   water   true over open water
//   normal  unit surface normal (body frame)
// Starts flat (the sphere); the Moon surface work replaces it with the real relief.

export function moonGround(dir, out = {}) {
  out.h = 0;
  out.water = false;
  out.normal = (out.normal || new THREE.Vector3()).copy(dir);
  return out;
}
