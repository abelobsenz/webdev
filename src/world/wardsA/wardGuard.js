import { civicOccupancy } from '../../life/people.js';
import { GUARDED_WARDS } from './ids.js';

export { GUARDED_WARDS };

// Physical clearance for the things planted and set out on the Outer Wards after their
// fabric is built: a tree must not stand in a parapet, a quay stair, a pool kerb, a bridge
// abutment or a lighthouse plinth, and its lower crown must not grow through a terrace
// wall or a bridge deck. The test reads the actual built material (platform walls and
// balustrades, stairs, landmarks and monuments, the ward bridges and the transit network)
// through the same triangle-column occupancy the walkers use.

/**
 * world: the built World (metro, transitNet). Returns guard(x, y, z, trunkR, crownR, height)
 * -> true when a tree rooted at (x, y, z) is clear, or null when there is nothing to test.
 */
export function wardTreeGuard(world, ids = GUARDED_WARDS) {
  const M = world && world.metro;
  if (!M || !M.wards) return null;
  const wards = M.wards.filter((W) => ids.includes(W.def.id));
  if (!wards.length) return null;
  const shared = [...(M.bridges ? M.bridges.meshes : []), ...((world.transitNet && world.transitNet.meshes) || [])].filter((m) => m.isMesh && !m.isInstancedMesh && m.geometry && m.geometry.attributes.position);
  const per = wards.map((W) => {
    const far = new Set((W.landmarks.lod || []).map((l) => l.far).filter(Boolean));
    const own = [W.platform, ...M.meshes.filter((m) => m.name === `${W.def.name} stairs`), ...W.landmarks.meshes.filter((m) => !far.has(m) && m.isMesh && !m.isInstancedMesh)];
    return { W, occ: civicOccupancy([...own, ...shared]) };
  });
  return (x, y, z, trunkR, crownR, height) => {
    const q = per.find((p) => Math.abs(x - p.W.def.x) < p.W.half && Math.abs(z - p.W.def.z) < p.W.half);
    if (!q) return true;
    // the trunk and the lower crown: nothing solid in either column
    if (q.occ(x, y, z, Math.min(4, height * 0.45), trunkR + 0.25)) return false;
    if (q.occ(x, y + height * 0.4, z, height * 0.5, crownR * 0.5)) return false;
    return true;
  };
}
