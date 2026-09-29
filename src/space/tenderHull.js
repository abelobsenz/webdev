import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CB, CK, sectionEllipse } from '../craft/craftGeometry.js';
import { buildTenderSpine } from './linerSkin.js';
import { DK } from './craftMesh.js';

// THE RECLAMATION TENDERS, REDRAWN AT THEIR FRAMING. The builder's tender (src/craft/craftGeometry.js
// buildTender) stays the reference its fittings, drones and clearances are surveyed against; this
// draws the same ship on the same stations, but built rather than blocked out:
//
//   spine       the smooth 64 x 97 spine (src/space/linerSkin.js), works-yellow along its back
//               and weathered working plate below, dark frame hoops at the builder's girdles
//   pods        the eight cargo pods of reclaimed stock as smooth insulated drums (the builder's
//               six-sided lofts read as faceted yellow logs): white gores, a works-yellow girth
//               band between dark saddle lines, hazard-striped ends and a pair of clamp bands
//   command     the lens-shaped command pod at 64 segments with its window band and a lit crown
//   drive       five heat-tinted bells at 32 segments on a thrust ring
//   wings       each solar wing as three framed arrays on a trussed boom (the builder's single
//               blue board), a cross spar at the root
//   collar      the capture collar's rings at 96 segments with six coil housings
//
// The capture arms (animated) are the builder's. Returns the geometry in the builder's frame
// (tender metres at its scale), with userData { podTriangles, parts }.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;

/** The builder's pod stations: centres (x, y, z) in unscaled tender metres. */
export const POD_CENTRES = (() => {
  const out = [];
  for (let k = 0; k < 4; k++) for (const sd of [-1, 1]) out.push(V(sd * 25, -2, -70 + k * 42));
  return out;
})();
const podR = (u) => 11 * Math.pow(Math.sin(Math.PI * lerp(0.08, 0.92, u)), 0.35);

/** One smooth pod: superellipse sections (the builder's n = 2.2, 0.92 high), facade y signed from the girth. */
function pod(c, s, pos, nrm, fac, idx) {
  const NA = 48, NL = 24, base = pos.length / 3;
  const P = [];
  for (let j = 0; j <= NL; j++) {
    const u = j / NL, r = podR(u), z = lerp(-17, 17, u);
    const pts = sectionEllipse(r, r * 0.92, NA, 2.2, Math.PI / 6);
    let per = 0;
    for (let i = 0; i <= NA; i++) {
      const p = pts[i % NA];
      if (i) { const q = pts[i - 1]; per += Math.hypot(p[0] - q[0], p[1] - q[1]); }
      P.push([p[0], p[1], z, per]);
    }
  }
  const cols = NA + 1;
  for (let j = 0; j <= NL; j++) for (let i = 0; i <= NA; i++) {
    const [x, y, z, per] = P[j * cols + i];
    // normal from neighbours round the section and along the pod
    const a = P[j * cols + ((i + 1) % NA)], b = P[j * cols + ((i + NA - 1) % NA)];
    const cc = P[Math.min(j + 1, NL) * cols + i], d = P[Math.max(j - 1, 0) * cols + i];
    const tx = a[0] - b[0], ty = a[1] - b[1], tz = a[2] - b[2];
    const lx = cc[0] - d[0], ly = cc[1] - d[1], lz = cc[2] - d[2];
    let nx = ly * tz - lz * ty, ny = lz * tx - lx * tz, nz = lx * ty - ly * tx;
    if (nx * x + ny * y + nz * z * 0.05 < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const L = Math.hypot(nx, ny, nz) || 1;
    pos.push((c.x + x) * s, (c.y + y) * s, (c.z + z) * s);
    nrm.push(nx / L, ny / L, nz / L);
    const u = j / NL;
    const kind = u < 0.1 || u > 0.9 ? DK.HAZARD : DK.TANK;
    fac.push(per * s, z * s, kind);
  }
  for (let j = 0; j < NL; j++) for (let i = 0; i < NA; i++) {
    const a = base + j * cols + i, b = a + 1, cc = a + cols, d = cc + 1;
    idx.push(a, b, d, a, d, cc);
  }
  // end caps: hazard-striped bulkheads, facing out along the pod
  for (const [j, dir] of [[0, -1], [NL, 1]]) {
    const z = lerp(-17, 17, j / NL), cb = pos.length / 3;
    pos.push(c.x * s, c.y * s, (c.z + z) * s); nrm.push(0, 0, dir); fac.push(0, 0, DK.HAZARD);
    for (let i = 0; i < NA; i++) {
      const [x, y] = P[j * cols + i];
      pos.push((c.x + x) * s, (c.y + y) * s, (c.z + z) * s); nrm.push(0, 0, dir); fac.push(x * s, y * s, DK.HAZARD);
    }
    for (let i = 0; i < NA; i++) {
      const a = cb + 1 + i, b = cb + 1 + ((i + 1) % NA);
      // wound to face along dir (the section runs counter-clockwise seen from +z)
      if (dir > 0) idx.push(cb, a, b); else idx.push(cb, b, a);
    }
  }
}

/** The tender drawn (tender metres at the builder's scale). tender: buildTender's result. */
export function buildWorksTender(tender) {
  const s = (tender.length || 300) / 300;
  const parts = {};
  // ---- spine: smooth, painted works-yellow on its back, working plate below
  const spine = buildTenderSpine(s);
  {
    const Pp = spine.attributes.position, F = spine.attributes.aFacade.array;
    for (let i = 0; i < Pp.count; i++) {
      const k = F[i * 3 + 2];
      if (Math.abs(k - CK.HULL) > 0.01) continue;
      F[i * 3 + 2] = Pp.getY(i) > 7 * s ? DK.LIVERY : DK.GRIME;
    }
  }
  // ---- pods
  const pos = [], nrm = [], fac = [], idx = [];
  for (const c of POD_CENTRES) pod(c, s, pos, nrm, fac, idx);
  const pods = new THREE.BufferGeometry();
  pods.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pods.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  pods.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  pods.setIndex(idx);
  // ---- the fittings (builder API)
  const B = new CB();
  B.push(new THREE.Matrix4().makeScale(s, s, s));
  const mark = (name) => { parts[name] = B.idx.length / 3; };
  mark('clamps');
  for (const c of POD_CENTRES) {
    const sd = Math.sign(c.x);
    // the clamp arm from the spine and two clamp bands round the pod
    B.box(sd * 13, -2, c.z, 6, 3, 8, CK.DARK);
    for (const dz of [-9, 9]) {
      const r = podR((dz + 17) / 34);
      B.at(c.x, c.y, c.z + dz);
      B.push(new THREE.Matrix4().makeScale(1, 0.92, 1));
      B.torus(r + 0.35, 0.6, 48, 6, CK.DARK);
      B.pop(); B.pop();
      B.box(sd * 15.5, -2, c.z + dz, 3.2, 1.6, 1.6, CK.BRONZE);
    }
  }
  // spine frame hoops at the builder's girdles
  mark('hoops');
  for (let j = 1; j < 4; j++) {
    const z = lerp(-140, 118, j / 4), u = j / 4;
    const w = 9 + 4 * (1 - u) + 3 * Math.max(0, Math.min(1, (u - 0.85) / 0.15)), h = 8 + 5 * (1 - u);
    const pts = sectionEllipse(w + 0.5, h + 0.5, 64, 3.2).map(([x, y]) => V(x, y, z));
    pts.push(pts[0].clone());
    B.tube(pts, 0.7, 6, CK.DARK);
  }
  // ---- command pod: the builder's lens, smooth, with a lit crown and a dark sill
  mark('command');
  B.at(0, 15, -92);
  B.lathe([[0.1, -9, DK.GRIME], [6, -8.4, DK.GRIME], [9, -7, CK.HULL], [11.2, -4.6, CK.DARK], [12, -3, CK.GLASS], [12, 1, CK.GLASS], [11.4, 2.2, CK.DARK], [9, 5, CK.HULL], [4, 6.6, CK.HULL], [1.6, 6.9, CK.LANTERN], [0.1, 7, CK.LANTERN]], 64);
  B.pop();
  B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  B.at(0, 92, 12);
  B.lathe([[1.2, 0, CK.DARK], [0.5, 22, CK.DARK], [0.9, 23, CK.LANTERN], [0.05, 24, CK.LANTERN]], 12);
  B.pop();
  B.pop();
  // ---- drive: thrust ring and five heat-tinted bells
  mark('drive');
  B.at(0, 0, -140);
  B.torus(12.5, 1.6, 64, 8, CK.DARK);
  B.pop();
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + Math.PI / 2;
    const x = Math.cos(a) * 9, y = Math.sin(a) * 8;
    B.at(x, y, -140);
    const from = B.fac.length / 3;
    B.lathe([[3.4, -16, DK.NOZZLE], [4.4, -15, DK.NOZZLE], [3.8, -12.5, DK.NOZZLE], [3.2, -10, DK.NOZZLE], [2.2, -4, DK.NOZZLE], [3.0, 0, CK.BRONZE],
      [2.4, 0, CK.DARK], [1.6, -4, CK.DARK], [2.6, -10, CK.DARK], [3.1, -15, CK.DARK]], 32, 0, { closedProfile: true });
    for (let i = from; i < B.fac.length / 3; i++) B.fac[i * 3 + 1] = -B.fac[i * 3 + 1] * s;
    B.pop();
  }
  // ---- solar wings: a trussed boom and three framed arrays each side
  mark('wings');
  for (const sd of [-1, 1]) {
    const x0 = sd > 0 ? 64 : -124, x1 = sd > 0 ? 124 : -64;
    // boom: two chords and diagonals from the spine to the tip
    const r0 = 12, r1 = 126;
    for (const dy of [-0.9, 0.9]) B.tube([V(sd * r0, 13 + dy, -30), V(sd * r1, 13 + dy, -30)], 0.55, 6, CK.DARK);
    for (let i = 0; i < 12; i++) {
      const xa = sd * (r0 + (i / 12) * (r1 - r0)), xb = sd * (r0 + ((i + 1) / 12) * (r1 - r0));
      B.tube([V(xa, 12.1, -30), V(xb, 13.9, -30)], 0.3, 4, CK.BRONZE);
    }
    B.box(sd * 16, 13, -30, 8, 3, 4, CK.DARK);                    // root drive (the wing turns on it)
    // three arrays with 1.4 m gaps, each framed
    const L = (x1 - x0 - 2.8) / 3;
    for (let a = 0; a < 3; a++) {
      const xa = x0 + a * (L + 1.4), xb = xa + L;
      B.panel(xa, xb, -52, -8, 13, 0.5, CK.PANEL);
      B.box((xa + xb) / 2, 13, -52.3, L, 0.9, 0.6, CK.DARK);
      B.box((xa + xb) / 2, 13, -7.7, L, 0.9, 0.6, CK.DARK);
      B.box(xa - 0.3, 13, -30, 0.6, 0.9, 45.2, CK.DARK);
      B.box(xb + 0.3, 13, -30, 0.6, 0.9, 45.2, CK.DARK);
    }
    // cross spar at the root: the wing's stiffener
    B.box((x0 + x1) / 2, 13.6, -30, x1 - x0, 0.7, 1.2, CK.BRONZE);
  }
  // ---- capture collar at the bow: the field rings and six coil housings
  mark('collar');
  B.at(0, 0, 124);
  B.torus(15, 2.4, 96, 12, CK.HULL);
  B.torus(12.5, 0.9, 96, 8, CK.CONDUIT);
  B.torus(17.6, 0.6, 96, 6, CK.DARK);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + TAU / 12;
    B.at(Math.cos(a) * 15, Math.sin(a) * 15, 0, 0, 0, a);
    B.box(0, 0, 0, 4.4, 5.6, 5.6, CK.BRONZE);
    B.pop();
  }
  B.pop();
  mark('end');
  B.pop();
  const fit = B.geometry();
  const g = mergeGeometries([spine, pods, fit], false);
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.smoothSkin = true;
  g.userData.spineTriangles = spine.index.count / 3;
  g.userData.podTriangles = pods.index.count / 3;
  g.userData.parts = parts;
  return g;
}
