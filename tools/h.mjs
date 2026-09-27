// Samples terrainHeight at x,z pairs:  node tools/h.mjs 0,-5900 100,200
// With --seam, checks the inner/outer terrain seam (|x| or |z| = 7200) stays below sea level.
import { terrainHeight } from '../src/world/terrain.js';
const args = process.argv.slice(2);
if (args[0] === '--seam') {
  let worst = -1e9, at = null;
  for (let t = -7200; t <= 7200; t += 10) {
    for (const [x, z] of [[t, -7200], [t, 7200], [-7200, t], [7200, t]]) {
      for (const off of [-40, -20, 0, 20, 40]) {
        const xx = Math.abs(x) === 7200 ? x + Math.sign(x) * off : x;
        const zz = Math.abs(z) === 7200 ? z + Math.sign(z) * off : z;
        const h = terrainHeight(xx, zz);
        if (h > worst) { worst = h; at = [xx, zz]; }
      }
    }
  }
  console.log('seam max height', worst.toFixed(2), 'at', at);
  process.exit(worst < -0.5 ? 0 : 1);
}
for (const s of args) { const [x, z] = s.split(',').map(Number); console.log(x, z, terrainHeight(x, z).toFixed(2)); }
