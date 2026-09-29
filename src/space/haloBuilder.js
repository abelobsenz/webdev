import * as THREE from 'three';
import { CB } from '../craft/craftGeometry.js';

// The district builder: the craft builder (src/craft/craftGeometry.js) with its two hot paths
// rewritten for the Halo's scale. A district tile is ~180,000 boxes and a million vertices;
// the general builder transforms every vertex through a matrix, clones a vector per triangle
// to pick its winding, and hands the arrays to three's computeVertexNormals, which together
// took ~60% of the district build. Here:
//
//   box()       writes its 24 vertices straight into the arrays (the matrix only when the
//               stack is not the identity), with the winding fixed by the sign of the stack's
//               determinant, which is what the per-triangle hint test resolves to for a box;
//   geometry()  builds typed arrays once and computes area-weighted vertex normals in a tight
//               loop (the same result as computeVertexNormals: faces accumulate their
//               unnormalised cross products, then each vertex normal is normalised).
//
// Output is identical in layout to CB's (position, aFacade, normal, index), so every consumer
// of the district geometry (the materials, the verify scripts) is unchanged.

const FACES = [
  // normal, then four corners as signs of (hx, hy, hz), wound outward for a proper frame
  [1, 0, 0, 1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1],
  [-1, 0, 0, -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1],
  [0, 1, 0, -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1],
  [0, -1, 0, -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1],
  [0, 0, 1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1],
  [0, 0, -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1],
];

export class HB extends CB {
  box(cx, cy, cz, sx, sy, sz, k = 1) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const P = this.pos, Fc = this.fac, I = this.idx;
    const stackTop = this.stack.length === 1 ? null : this.M.elements;
    let flip = false;
    if (stackTop) {
      const e = stackTop;
      const det = e[0] * (e[5] * e[10] - e[9] * e[6]) - e[4] * (e[1] * e[10] - e[9] * e[2]) + e[8] * (e[1] * e[6] - e[5] * e[2]);
      if (det < 0) flip = !flip;
    }
    for (let f = 0; f < 6; f++) {
      const F = FACES[f], nx = F[0], ny = F[1];
      const base = P.length / 3;
      for (let c = 0; c < 4; c++) {
        const lx = cx + F[3 + c * 3] * hx, ly = cy + F[4 + c * 3] * hy, lz = cz + F[5 + c * 3] * hz;
        if (stackTop) {
          const e = stackTop;
          P.push(e[0] * lx + e[4] * ly + e[8] * lz + e[12], e[1] * lx + e[5] * ly + e[9] * lz + e[13], e[2] * lx + e[6] * ly + e[10] * lz + e[14]);
        } else P.push(lx, ly, lz);
        // facade coordinates in the face's own plane (as CB.box)
        Fc.push(nx ? lz : lx, ny ? lz : ly, k);
      }
      const inv = f < 2 ? sy * sz < 0 : f < 4 ? sx * sz < 0 : sx * sy < 0;
      if (flip !== inv) I.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  geometry() {
    const pos = new Float32Array(this.pos), n = pos.length / 3;
    const idx = n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
    const nor = new Float32Array(pos.length);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
      nor[a] += x; nor[a + 1] += y; nor[a + 2] += z;
      nor[b] += x; nor[b + 1] += y; nor[b + 2] += z;
      nor[c] += x; nor[c + 1] += y; nor[c + 2] += z;
    }
    for (let i = 0; i < nor.length; i += 3) {
      const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]);
      if (l > 0) { nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aFacade', new THREE.BufferAttribute(new Float32Array(this.fac), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
