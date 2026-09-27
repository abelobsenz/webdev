// scratch probe (not committed): terrain heights & islets
import { terrainHeight, ISLETS } from '../src/world/terrain.js';
const args = process.argv.slice(2);
if (args[0] === 'islets') { console.log(JSON.stringify(ISLETS.map((i) => [Math.round(i.x), Math.round(i.z), Math.round(i.r)]))); process.exit(0); }
const [cx, cz, r, step] = args.map(Number);
for (let z = cz - r; z <= cz + r; z += step) {
  let row = '';
  for (let x = cx - r; x <= cx + r; x += step) row += String(Math.round(terrainHeight(x, z))).padStart(5);
  console.log(String(z).padStart(6), row);
}
