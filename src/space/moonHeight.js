import * as THREE from 'three';
import { R_MOON } from './sim.js';
import { reliefH, GMASK } from './moonTerrain.js';

// The Moon's solid ground on the CPU, matching the GPU surface (moonSurface.js) so the ship can
// stand on it and the autopilot can land on it.
//
// moonGround(dir, out) - dir: unit vector from the Moon's centre in its BODY frame (the local frame
// of moon.group, which the surface shaders are drawn in). Fills out = { h, water, normal }:
//   h       ground elevation above R_MOON (km); where there is sea, the sea surface
//   water   true over open water
//   normal  unit surface normal (body frame)
//
// The relief is moonTerrain.js reliefH(): the same function, constant for constant, that the
// terrain mesh round the camera is displaced by (every octave within ~1 km of the camera; farther
// out the mesh drops the octaves finer than its vertex spacing, and the ship is not there). Before
// the bake has been read back (the first second or so) the ground is the bare sphere on both sides.
// Extra fields: land (0..1, 0 at and near the coasts), wood (woodland density), hi (highland share).

const _info = { land: 0, water: 0, wood: 0, hi: 0, valley: 0, mask: 0 };
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _p = new THREE.Vector3();
const EPS = 0.003 / R_MOON;                  // 3 m, as an angle: the normal's finite difference

export function moonGround(dir, out = {}) {
  const x = dir.x, y = dir.y, z = dir.z;
  const h0 = reliefH(x, y, z, 0, _info);
  out.water = GMASK.n > 0 && _info.water > 0.5 && h0 <= 0.0005;
  out.h = out.water ? 0 : h0;
  out.land = _info.land; out.wood = _info.wood; out.hi = _info.hi;
  const n = (out.normal || (out.normal = new THREE.Vector3()));
  if (out.water || _info.mask <= 0) { n.set(x, y, z).normalize(); return out; }
  // tangent basis, then the slope by forward differences 3 m either way
  _e1.set(x, y, z).cross(Math.abs(y) < 0.9 ? _p.set(0, 1, 0) : _p.set(1, 0, 0)).normalize();
  _e2.set(x, y, z).cross(_e1);
  _p.set(x, y, z).addScaledVector(_e1, EPS).normalize();
  const hx = reliefH(_p.x, _p.y, _p.z, 0);
  _p.set(x, y, z).addScaledVector(_e2, EPS).normalize();
  const hy = reliefH(_p.x, _p.y, _p.z, 0);
  const gx = (hx - h0) / (EPS * R_MOON), gy = (hy - h0) / (EPS * R_MOON);
  n.set(x, y, z).addScaledVector(_e1, -gx).addScaledVector(_e2, -gy).normalize();
  return out;
}
