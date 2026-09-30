import * as THREE from 'three';
import { CB } from '../craft/craftGeometry.js';
import { LK } from './lunarMaterial.js';
import { CellLod } from './lunarLod.js';

// The architecture of Medii Landing's houses at street range, instanced. The merged town
// (lunarLanding.js) gives every house its walls, roof, balconies and chimneys, and the
// material paints the windows, doors and shopfronts on the walls. Within a kilometre or so of
// the eye this dresses those painted openings in real stonework, placed on the same 3 m bays
// and 3.6 m storeys the material paints:
//
//   windows      a stone sill on corbels, moulded architraves and a lintel with its keystone,
//                a painted mullion and transom; on the ochre and cream houses louvred
//                shutters folded back instead of the architraves
//   window boxes flowers on a fifth of the upper windows
//   ground floor shopfronts (pilasters, a stall riser, a lit fascia and a striped awning on
//                its irons) and front doors (panelled leaf, fanlight, a hood on brackets, two
//                steps down to the street), bay by bay
//   mouldings    a corbelled cornice under every eave and parapet, a string course at each
//                floor, quoins up the corners of the stone houses
//   dormers      lead-clad dormers with casements on the tiled roofs
//   civic halls  a stepped podium and a colonnade of fluted columns along each long front
//
// Each house's wall colour tints its mouldings (a shade lighter than its render), its joinery
// is white or dark green by palette, and its shutters and awnings take a colour of their own.

const WALL_C = [[0.74, 0.69, 0.6], [0.8, 0.62, 0.44], [0.62, 0.64, 0.63], [0.84, 0.78, 0.68]];
const JOIN_C = [[0.9, 0.88, 0.82], [0.2, 0.3, 0.25], [0.88, 0.87, 0.84], [0.22, 0.28, 0.34]];
const SHUT_C = [[0.2, 0.34, 0.28], [0.18, 0.3, 0.44], [0.46, 0.22, 0.16], [0.44, 0.4, 0.2], [0.3, 0.3, 0.32]];
const AWN_C = [[0.62, 0.16, 0.12], [0.14, 0.32, 0.5], [0.2, 0.4, 0.26], [0.7, 0.52, 0.16], [0.5, 0.2, 0.34], [0.3, 0.3, 0.3]];
const BLOOM_C = [[0.75, 0.18, 0.2], [0.85, 0.6, 0.15], [0.62, 0.3, 0.62], [0.9, 0.85, 0.8], [0.9, 0.4, 0.5]];

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const lighter = (c, f = 1.08) => [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)];

// ------------------------------------------------------------------ prototypes --
// Each has its origin on the wall's face at the storey's floor (or the eave), +z out of the
// wall, +y up, metres.

function protoWindow(shutters) {
  const B = new CB(), M = LK.MOULD, F = LK.FRAME;
  // sill on two small corbels, its drip edge proud of the wall
  B.box(0, 0.86, 0.1, 1.66, 0.1, 0.2, M);
  B.box(0, 0.93, 0.05, 1.5, 0.05, 0.1, M);
  for (const s of [-1, 1]) B.box(s * 0.6, 0.73, 0.06, 0.16, 0.18, 0.12, M);
  // lintel with a keystone
  B.box(0, 3.0, 0.06, 1.74, 0.26, 0.12, M);
  B.box(0, 3.14, 0.07, 1.9, 0.06, 0.14, M);
  B.box(0, 2.97, 0.11, 0.3, 0.36, 0.08, M);
  if (!shutters) {
    // moulded architraves: an outer band and an inner bead
    for (const s of [-1, 1]) { B.box(s * 0.75, 1.9, 0.035, 0.14, 1.94, 0.07, M); B.box(s * 0.67, 1.9, 0.02, 0.04, 1.9, 0.04, M); }
  } else {
    // louvred shutters folded back against the wall, on pintles
    for (const s of [-1, 1]) {
      B.box(s * 0.94, 1.9, 0.045, 0.56, 1.88, 0.05, LK.SHUTTER);
      for (const y of [1.3, 2.5]) B.box(s * 0.68, y, 0.03, 0.05, 0.05, 0.06, LK.IRON);
    }
  }
  // the casement: a frame round the glass, a mullion and a transom (paint)
  B.box(0, 1.9, 0.015, 0.07, 1.86, 0.03, F);
  B.box(0, 2.35, 0.015, 1.26, 0.07, 0.03, F);
  for (const s of [-1, 1]) B.box(s * 0.6, 1.9, 0.012, 0.06, 1.86, 0.024, F);
  B.box(0, 2.81, 0.012, 1.26, 0.06, 0.024, F);
  B.box(0, 0.99, 0.012, 1.26, 0.06, 0.024, F);
  return B.geometry();
}

/** The middle distance's window: its sill, lintel and keystone (and shutters), no joinery. */
function protoWindowFar(shutters) {
  const B = new CB(), M = LK.MOULD;
  B.box(0, 0.86, 0.1, 1.66, 0.1, 0.2, M);
  B.box(0, 3.0, 0.06, 1.74, 0.26, 0.12, M);
  B.box(0, 2.97, 0.11, 0.3, 0.36, 0.08, M);
  if (shutters) for (const s of [-1, 1]) B.box(s * 0.94, 1.9, 0.045, 0.56, 1.88, 0.05, LK.SHUTTER);
  return B.geometry();
}

function protoWindowBox() {
  const B = new CB();
  B.box(0, 0.74, 0.3, 1.34, 0.26, 0.3, LK.FRAME);
  for (const s of [-1, 1]) B.box(s * 0.5, 0.58, 0.18, 0.04, 0.2, 0.3, LK.IRON);
  // the flowers: a lumpy mound of blooms and leaves spilling over the front
  for (let i = 0; i < 6; i++) {
    const x = -0.52 + i * 0.21;
    B.at(x, 0.9, 0.3, 0, i * 0.7, 0);
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    B.lathe([[0, -0.05, LK.BLOOM], [0.13, 0.02, LK.BLOOM], [0.12, 0.1, LK.BLOOM], [0, 0.16, LK.BLOOM]], 6);
    B.pop(); B.pop();
  }
  B.box(0, 0.83, 0.46, 1.3, 0.12, 0.06, LK.HEDGE);
  return B.geometry();
}

function protoShop() {
  const B = new CB(), M = LK.MOULD;
  for (const s of [-1, 1]) {
    B.box(s * 1.42, 1.5, 0.08, 0.22, 3.0, 0.16, M);                // pilasters
    B.box(s * 1.42, 0.12, 0.1, 0.3, 0.24, 0.2, M);                  // their bases
    B.box(s * 1.42, 2.66, 0.11, 0.3, 0.18, 0.22, M);                // capitals
  }
  B.box(0, 0.18, 0.06, 2.62, 0.36, 0.12, M);                        // stall riser
  B.box(0, 0.38, 0.1, 2.62, 0.05, 0.2, M);                          // display sill
  B.box(0, 3.02, 0.1, 3.1, 0.46, 0.2, LK.SIGN);                     // the lit fascia
  B.box(0, 3.3, 0.14, 3.2, 0.1, 0.28, M);                           // its cornice
  for (const x of [-0.44, 0.44]) B.box(x, 1.45, 0.02, 0.06, 2.1, 0.04, LK.FRAME);   // glazing bars
  B.box(0, 2.3, 0.02, 2.62, 0.06, 0.04, LK.FRAME);
  // a striped canvas awning on its irons, with a scalloped valance
  B.at(0, 2.72, 0.62, 0.42, 0, 0);
  B.box(0, 0, 0, 2.9, 0.04, 1.26, LK.AWNING);
  B.pop();
  B.box(0, 2.34, 1.19, 2.9, 0.22, 0.03, LK.AWNING);
  for (const s of [-1, 1]) B.tube([new THREE.Vector3(s * 1.4, 2.82, 0.05), new THREE.Vector3(s * 1.4, 2.42, 1.18)], 0.018, 4, LK.IRON);
  return B.geometry();
}

function protoDoor() {
  const B = new CB(), M = LK.MOULD;
  // two steps down to the street (the house stands on its block's kerb, 0.5 m up)
  B.box(0, -0.335, 0.2, 1.9, 0.33, 0.4, LK.WALL);
  B.box(0, -0.42, 0.6, 2.1, 0.16, 0.4, LK.WALL);
  // door case: pilasters, a fanlight over the panelled leaf, a hood on scrolled brackets
  for (const s of [-1, 1]) { B.box(s * 0.72, 1.45, 0.05, 0.2, 2.9, 0.1, M); B.box(s * 0.78, 2.72, 0.25, 0.1, 0.36, 0.42, M); }
  B.box(0, 2.95, 0.32, 1.9, 0.12, 0.66, M);
  B.box(0, 3.04, 0.3, 1.7, 0.08, 0.56, M);
  B.box(0, 2.35, 0.012, 1.1, 0.5, 0.024, LK.GLASS);
  B.box(0, 2.08, 0.03, 1.2, 0.06, 0.06, LK.FRAME);
  B.box(0, 1.03, 0.03, 1.06, 2.06, 0.06, LK.FRAME);                  // the leaf
  for (const y of [0.55, 1.45]) for (const s of [-1, 1]) B.box(s * 0.25, y, 0.065, 0.38, 0.62, 0.02, LK.FRAME);   // its panels
  B.box(0.38, 1.05, 0.08, 0.05, 0.05, 0.05, LK.BRONZE);             // knob
  B.box(0, 1.35, 0.075, 0.2, 0.04, 0.02, LK.BRONZE);                // letter plate
  // a lamp bracket beside the door
  B.box(0.95, 2.3, 0.12, 0.05, 0.05, 0.24, LK.IRON);
  B.box(0.95, 2.18, 0.26, 0.16, 0.24, 0.16, LK.LIGHT);
  return B.geometry();
}

/** Unit-length mouldings (scaled along x to the frontage). */
function protoCornice() {
  const B = new CB(), M = LK.MOULD;
  B.box(0, 0.0, 0.08, 1, 0.16, 0.16, M);
  B.box(0, 0.14, 0.16, 1, 0.12, 0.32, M);
  B.box(0, 0.26, 0.26, 1, 0.12, 0.52, M);
  B.box(0, 0.38, 0.36, 1, 0.12, 0.72, M);
  B.box(0, -0.2, 0.03, 1, 0.24, 0.06, M);                            // frieze band
  return B.geometry();
}
function protoCourse() {
  const B = new CB();
  B.box(0, 0.0, 0.05, 1, 0.14, 0.1, LK.MOULD);
  B.box(0, 0.09, 0.07, 1, 0.05, 0.14, LK.MOULD);
  return B.geometry();
}
/** One storey of quoins at a corner (the corner on the origin, the house in -x, -z). */
function protoQuoins() {
  const B = new CB();
  for (let i = 0; i < 6; i++) {
    const long = i % 2 === 0, y = 0.3 + i * 0.6;
    B.box(long ? -0.32 : -0.2, y, 0.03, long ? 0.7 : 0.46, 0.54, 0.06, LK.MOULD);
    B.box(0.03, y, long ? -0.2 : -0.32, 0.06, 0.54, long ? 0.46 : 0.7, LK.MOULD);
  }
  return B.geometry();
}

function protoDormer() {
  const B = new CB();
  // cheeks and face, lead-clad; the front stands on the roof, the body runs back into it
  B.box(0, 1.0, -1.4, 2.0, 2.0, 2.8, LK.DARK);
  B.box(0, 1.1, 0.01, 1.2, 1.3, 0.02, LK.GLASS);
  B.box(0, 1.1, 0.03, 0.06, 1.3, 0.04, LK.FRAME);
  B.box(0, 1.25, 0.03, 1.2, 0.06, 0.04, LK.FRAME);
  for (const s of [-1, 1]) B.box(s * 0.63, 1.1, 0.03, 0.08, 1.42, 0.06, LK.FRAME);
  B.box(0, 0.42, 0.05, 1.36, 0.08, 0.12, LK.FRAME);
  // its own little pitched roof
  const ring = [[-1.2, 1.95], [1.2, 1.95], [0, 2.75]];
  B.loft([{ z: 0.25, pts: ring }, { z: -3.0, pts: ring }], () => LK.DARK);
  B.box(0, 2.78, -1.4, 0.12, 0.08, 3.3, LK.DARK);
  return B.geometry();
}

function protoColumn() {
  const B = new CB();
  B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  const prof = [[0, 0, LK.WALL], [1.05, 0, LK.WALL], [1.05, 0.4, LK.WALL], [0.92, 0.55, LK.MOULD], [0.92, 0.75, LK.MOULD], [0.8, 0.9, LK.MOULD]];
  for (let j = 0; j <= 8; j++) { const t = j / 8; prof.push([0.8 - 0.1 * t * t, 0.9 + t * 14.6, LK.MOULD]); }
  prof.push([0.8, 15.6, LK.MOULD], [1.0, 15.9, LK.MOULD], [1.12, 16.3, LK.MOULD], [1.12, 16.9, LK.MOULD], [0, 16.9, LK.MOULD]);
  B.lathe(prof, 20);
  B.pop();
  // fluting: twenty shallow arrises down the shaft
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    B.tube([new THREE.Vector3(Math.cos(a) * 0.8, 1.0, Math.sin(a) * 0.8), new THREE.Vector3(Math.cos(a) * 0.71, 15.4, Math.sin(a) * 0.71)], 0.045, 3, LK.MOULD);
  }
  B.box(0, 17.1, 0, 2.4, 0.4, 2.4, LK.MOULD);                        // abacus
  return B.geometry();
}

// ------------------------------------------------------------------ the sets --

/**
 * Build the house detail of Medii Landing from the town's records (buildMediiLanding().S).
 * Returns { sets: [CellLod] } ready for a LodGroup; nothing is drawn beyond `near` metres.
 */
export function landingArchitecture(S, mat, { near = 800 } = {}) {
  const r = rng(7713);
  // (the town is dense: ~80,000 windows within 800 m of the Boulevard. Full joinery to 300 m,
  // sills and lintels to 650 m, the mouldings farther, the material's painted openings beyond)
  const RW = [near * 0.375, near * 0.81], R = [near * 0.56];
  const win = new CellLod('Landing windows', [protoWindow(false), protoWindowFar(false)], RW, mat, { tint: true, cell: 100 });
  const winS = new CellLod('Landing shuttered windows', [protoWindow(true), protoWindowFar(true)], RW, mat, { tint: true, cell: 100 });
  const boxes = new CellLod('Landing window boxes', [protoWindowBox()], [near * 0.375], mat, { tint: true, cell: 100 });
  const shop = new CellLod('Landing shopfronts', [protoShop()], R, mat, { tint: true, cell: 120 });
  const door = new CellLod('Landing doors', [protoDoor()], R, mat, { tint: true, cell: 120 });
  const corn = new CellLod('Landing cornices', [protoCornice()], [near * 1.4], mat, { tint: true, cell: 180 });
  const course = new CellLod('Landing string courses', [protoCourse()], [near], mat, { tint: true, cell: 160 });
  const quoin = new CellLod('Landing quoins', [protoQuoins()], [near * 0.5], mat, { tint: true, cell: 120 });
  const dorm = new CellLod('Landing dormers', [protoDormer()], [near * 1.2], mat, { tint: true, cell: 160 });
  const cols = new CellLod('Landing civic colonnades', [protoColumn()], [near * 1.6], mat, { tint: true, cell: 200 });

  for (const h of S.houses) {
    const c = Math.cos(h.ry), s = Math.sin(h.ry);
    const P = (lx, lz) => [h.x + c * lx + s * lz, h.z - s * lx + c * lz];
    const wallC = WALL_C[h.pal], mould = lighter(wallC, 1.1), join = JOIN_C[h.pal];
    const shut = SHUT_C[Math.floor(r() * SHUT_C.length)];
    const shutters = h.pal % 2 === 1;
    const nb = Math.floor((h.w / 2 - 1.7) / 3);
    const balc = new Set(h.balc.map(([f, st, bx]) => `${f}:${st}:${Math.round(bx / 3)}`));
    for (const face of [-1, 1]) {
      const ry = h.ry + (face > 0 ? 0 : Math.PI), zf = face * h.d / 2;
      // the face's x runs the other way when turned about: facade x is local x on both fronts
      const X = (bx) => face > 0 ? bx : -bx;
      for (let b = -nb; b <= nb; b++) {
        const bx = b * 3;
        const [px, pz] = P(bx, zf);
        for (let st = 1; st < h.storeys; st++) {
          const y = h.y + st * 3.6;
          (shutters ? winS : win).add(px, y, pz, ry, 1, 1, 1, shutters ? shut : join);
          if (!balc.has(`${face}:${st}:${b}`) && r() < 0.2) boxes.add(px, y, pz, ry, 1, 1, 1, BLOOM_C[Math.floor(r() * BLOOM_C.length)]);
        }
        // ground floor: a door every third or fourth bay, shopfronts between them on the busy
        // fronts (the Strand's halls and the blocks' outer faces), plain doors elsewhere
        if (Math.abs(bx) + 1.6 < h.w / 2) {
          if (r() < 0.3) door.add(px, h.y, pz, ry, 1, 1, 1, join);
          else if (r() < 0.75) shop.add(px, h.y, pz, ry, 1, 1, 1, AWN_C[Math.floor(r() * AWN_C.length)]);
        }
      }
      void X;
      // cornice under the eaves or the parapet, string courses at each floor
      const [cx, cz] = P(0, zf);
      corn.add(cx, h.y + h.H - (h.roof ? 0.42 : 0.55), cz, ry, h.w, 1, 1, mould);
      for (let st = 1; st < h.storeys; st++) course.add(cx, h.y + st * 3.6 - 0.07, cz, ry, h.w - 0.02, 1, 1, mould);
    }
    // quoins up the corners of the stone-coloured houses
    if (h.pal === 0 || h.pal === 2) {
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const [qx, qz] = P(sx * h.w / 2, sz * h.d / 2);
        // turn the prototype so its two legs run back along this corner's two faces
        const qry = h.ry + (sx > 0 && sz > 0 ? 0 : sx < 0 && sz > 0 ? -Math.PI / 2 : sx < 0 && sz < 0 ? Math.PI : Math.PI / 2);
        for (let st = 0; st < h.storeys; st++) quoin.add(qx, h.y + st * 3.6, qz, qry, 1, 1, 1, mould);
      }
    }
    // dormers on the tiled roofs, one every other bay, on both slopes
    if (h.roof && h.rh > 2.4 && h.w >= 10) {
      const hz = (h.d + 1.1) / 2, t = 0.3;
      for (let b = -nb + 1; b <= nb - 1; b += 2) {
        if (r() < 0.35) continue;
        for (const face of [-1, 1]) {
          const zf = face * hz * (1 - t), yf = h.y + h.H + h.rh * t - 0.35;
          const [dx, dz] = P(b * 3, zf);
          dorm.add(dx, yf, dz, h.ry + (face > 0 ? 0 : Math.PI), 1, 1, 1, join);
        }
      }
    }
  }

  // the civic halls at the corners of the Lift terrace: a colonnade on each long front
  for (const [u, v] of [[-500, -420], [500, -420], [-500, 330], [500, 330]]) {
    for (const side of [-1, 1]) for (let i = -8; i <= 8; i++) {
      const [x, z] = S.UV(u + i * 8.6, v + side * 51.5);
      cols.add(x, S.gy(x, z) + S.T.LIFT + 0.6, z, S.ROT_UV, 1, 1, 1, [0.62, 0.6, 0.55]);
    }
  }
  return { sets: [win, winS, boxes, shop, door, corn, course, quoin, dorm, cols] };
}
