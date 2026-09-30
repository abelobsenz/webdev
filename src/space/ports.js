import * as THREE from 'three';
import { R_EARTH, R_MOON } from './sim.js';

// Docking ports and landing pads: the exact places the Lodestar's autopilot takes it to at each
// destination in the orbital view.
//
// A port is { id, target, label, kind, clear, approach, pose(space, out) }:
//   id        unique, 'target:name'
//   target    the key in space.targets it belongs to
//   label     shown on the HUD ('Endymion Wheel - hub dock')
//   kind      'dock': the ship mates its dorsal docking ring (LODESTAR_DOCK in starship.js) to the
//                     port face: ship +Y (dorsal) = -n, nose (-Z) along fwd
//             'pad':  the ship sets down on its legs (LODESTAR_FEET) at pos: ship +Y = n, nose
//                     along fwd
//   clear     radius (km) of the free space round the mating point
//   approach  length (km) of the straight final corridor along n that is free of structure
//   pose(space, out) fills out = { pos, n, fwd } in WORLD space (km) at the current instant:
//             pos  the mating point (dock face centre / pad surface centre)
//             n    unit axis out of the structure along the approach (a pad: its local up)
//             fwd  unit, perpendicular to n: the direction the ship's nose points when mated
// Poses follow the structure (spinning wheels, orbiting stations, the rotating Earth and Moon);
// the autopilot differences successive poses for the port's velocity.
//
// This file starts as a generic fallback (a point above each target); the ports registry replaces
// it with every station's real docks and every settlement's real pads.

const V = () => new THREE.Vector3();
const _p = V();

function fallback(space, name) {
  const t = space.targets[name];
  return {
    id: `${name}:approach`, target: name, label: `${(t && t.name) || name} - approach point`, kind: 'dock',
    clear: 0.05, approach: 0.5,
    pose(sp, out) {
      const P = sp.targets[name].position(_p), sim = sp.sim;
      out.pos = (out.pos || V()).copy(P);
      const d = P.length() < R_EARTH * 3 ? V().copy(P) : P.distanceTo(sim.moonPos) < R_MOON * 3 ? V().copy(P).sub(sim.moonPos) : V().set(0, 1, 0);
      out.n = (out.n || V()).copy(d.normalize());
      out.pos.addScaledVector(out.n, Math.max(sp.targets[name].minDist || 0.1, 0.1));
      out.fwd = (out.fwd || V()).set(0, 0, 1).cross(out.n);
      if (out.fwd.lengthSq() < 1e-6) out.fwd.set(1, 0, 0);
      out.fwd.normalize();
      return out;
    },
  };
}

const SKIP = new Set(['earth', 'moon', 'sun', 'lodestar']);

/** Every port and pad in the scene. */
export function getPorts(space) {
  if (space._ports) return space._ports;
  space._ports = Object.keys(space.targets).filter((k) => !SKIP.has(k)).map((k) => fallback(space, k));
  return space._ports;
}

/** The ports of one target (possibly empty). */
export function portsFor(space, target) { return getPorts(space).filter((p) => p.target === target); }
