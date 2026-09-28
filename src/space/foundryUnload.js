import * as THREE from 'three';
import { CB, CK, buildTender } from '../craft/craftGeometry.js';
import { craftMesh, addLamps, placeMerge } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { buildRelic } from './fleet.js';

// A TENDER UNLOADING AT THE NAURU WORKS (metres, the foundry's frame: x west, y up, z north;
// the three receiving halls open toward -z). The tender lies in the middle hall on its axis,
// cradle wide open; a hoist bridge slung beneath the two inspection gondolas lifts its relic
// clear of the petals toward the sorting line. Everything is hung from or seated on the hall's
// own rails and gondolas, inside the reserved receiving volume.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const UNLOAD = { bay: 0, y: -300, z: -1000, open: 0.4, relicLift: 260, bridgeY: 700, gondolaZ: -600 };

export function buildFoundryUnload() {
  const te = buildTender(620);
  const place = new THREE.Matrix4().makeTranslation(UNLOAD.bay, UNLOAD.y, UNLOAD.z);
  // the cradle's arms spread about their pivots (as the fleet's tenders draw them)
  const parts = [{ geo: te.geo, m: place }];
  for (const A of te.arms) {
    const m = place.clone().multiply(new THREE.Matrix4().makeTranslation(A.pivot.x, A.pivot.y, A.pivot.z))
      .multiply(new THREE.Matrix4().makeRotationAxis(A.axis, UNLOAD.open)).multiply(new THREE.Matrix4().makeTranslation(-A.pivot.x, -A.pivot.y, -A.pivot.z));
    parts.push({ geo: A.geo, m });
  }
  // the relic, level on its hoist, lifted clear of the petals
  const relicAt = V(UNLOAD.bay, UNLOAD.y + UNLOAD.relicLift, UNLOAD.gondolaZ);
  parts.push({ geo: buildRelic(), m: new THREE.Matrix4().makeTranslation(relicAt.x, relicAt.y, relicAt.z) });
  // the hoist: a bridge beneath the two gondolas' glazed floors, a trolley, the cable, a spreader
  const B = new CB();
  const bx = UNLOAD.bay, gz = UNLOAD.gondolaZ, glassBottom = 712;
  B.box(bx, glassBottom - 12, gz, 1440, 24, 60, CK.BRONZE);
  for (const dx of [-720, 720]) B.box(bx + dx, glassBottom - 12, gz, 160, 24, 160, CK.HULL);
  B.box(bx, glassBottom - 24 - 14, gz, 70, 28, 70, CK.DARK);
  const relicTop = relicAt.y + 3.4 + 0.8 / 2;
  const spreader = relicTop + 6;
  B.tube([V(bx, glassBottom - 52, gz), V(bx, spreader + 1.5, gz)], 2.2, 8, CK.DARK);
  B.box(bx, spreader, gz, 10, 3, 14, CK.BRONZE);
  for (const dz of [-5, 5]) B.tube([V(bx, spreader - 1.5, gz + dz), V(bx, relicTop, gz + dz * 0.5)], 0.5, 6, CK.DARK);
  parts.push({ geo: B.geometry(), m: new THREE.Matrix4() });
  const lamps = [];
  for (const dx of [-500, -200, 200, 500]) lamps.push({ p: V(bx + dx, glassBottom - 30, gz), r: 14, color: LAMP.WHITE, i: 2.2, dir: V(0, -1, 0) });
  lamps.push({ p: V(bx, glassBottom - 60, gz), r: 10, color: LAMP.AMBER, i: 2.6, breathe: 0.35 });
  return { geo: placeMerge(parts), lamps, relicAt, relicTop, spreader, bridge: { y: glassBottom - 12, half: 720 } };
}

export function addFoundryUnload(foundryGroup) {
  const d = buildFoundryUnload();
  const m = craftMesh(d.geo, { accent: [0.5, 1.0, 0.8], lit: 0.55 });
  addLamps(m, d.lamps, { minPx: 1.2 });
  foundryGroup.add(m);
  return { mesh: m, data: d };
}
