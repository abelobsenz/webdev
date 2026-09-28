import * as THREE from 'three';
import { KIND as K } from './buildings.js';
import { sweepTube } from './geom.js';
import { closedWardSurface } from './wardLandmarks.js';

// New civic places of the southern and western Outer Wards (Southmarch, Coral Reach,
// Westmere). Builders follow wardLandmarks.js: B is a Builder (near or far LOD), parts
// collects closed geometry for the monument material, lod = the massing pass.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Local frame helper matching Builder.frame: local x along (cos rot, -sin rot). */
function framer(x, y, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return (lx, ly, lz) => V(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
}

// --------------------------------------------------------- Southmarch --
/**
 * The Mariners' Lantern: a memorial to all who went to sea, at the heart of the Lantern
 * Circus. A raised island of paving, a stepped plinth, a fluted column and a glazed lantern
 * that burns every night; eight bronze bollards ring the island.
 */
export function marinersLantern(B, parts, L, y, lod, lights) {
  const { x, z, r } = L;
  B.frame(x, y, z, 0);
  const seg = lod ? 12 : 32;
  B.lathe(0, 0, [[r, -0.4, K.STONE], [r, 0.22, K.STONE], [r - 0.6, 0.22, K.PAVING], [0, 0.22, K.PAVING]], lod ? 20 : 48);
  B.lathe(0, 0, [[7.2, 0.1, K.STONE], [7.2, 0.62, K.STONE], [6.4, 0.62, K.PAVING], [6.4, 1.02, K.STONE], [5.2, 1.02, K.PAVING], [5.2, 1.42, K.STONE], [4.0, 1.42, K.PAVING], [0, 1.42, K.PAVING]], seg);
  // the drum carries the names of the ships; a bronze band at its head
  B.lathe(0, 0, [[3.3, 1.3, K.STONE], [3.3, 4.6, K.STONE], [3.5, 4.8, K.METAL], [3.5, 5.3, K.METAL], [2.1, 5.3, K.STONE]], seg);
  B.lathe(0, 0, [[2.0, 5.2, K.STONE], [1.85, 6.0, K.STONE], [1.35, 25.2, K.STONE], [2.6, 26.0, K.STONE], [3.1, 26.4, K.STONE], [3.1, 26.9, K.METAL], [2.1, 26.9, K.METAL]], lod ? 8 : 20);
  B.lathe(0, 0, [[2.05, 26.8, K.LANTERN], [2.05, 30.2, K.LANTERN], [2.7, 30.4, K.METAL], [2.7, 30.9, K.METAL], [1.6, 32.4, K.METAL], [0.5, 33.2, K.METAL], [0.18, 36.2, K.METAL]], lod ? 8 : 16);
  if (!lod) {
    // glazing bars round the lantern, fluting on the shaft
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      B.frame(x + Math.cos(a) * 2.08, y, z + Math.sin(a) * 2.08, -a);
      B.box(-0.07, 0.07, -0.07, 0.07, 26.85, 30.25, K.METAL, K.METAL);
    }
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * TAU, rr = r - 2.4;
      B.frame(x, y, z, 0);
      B.lathe(Math.cos(a) * rr, Math.sin(a) * rr, [[0.42, 0.1, K.METAL], [0.42, 0.3, K.METAL], [0.3, 0.42, K.METAL], [0.28, 0.9, K.METAL], [0.4, 1.0, K.METAL], [0.36, 1.12, K.METAL]], 10);
    }
  }
  B.frame(0, 0, 0, 0);
  if (lights) lights.push({ x, y: y + 28.5, z, c: [1.0, 0.84, 0.58], s: 2.8 });
}

/**
 * The Hall of the Seven Seas: a museum of voyages under an upturned hull. The plan is a
 * ship's waterline (a square transom on the Navigators' Walk, a bow to the western sea); the
 * glazed hall stands on a stone podium; the roof is the hull itself, a closed shell rising
 * to a keel that sweeps up with the sheer and glows at night, with bone-white ribs and a
 * bronze stem at the prow. rot: the bow's bearing.
 */
export function voyageHall(B, parts, L, y, lod) {
  const { x, z, rot, len, beam } = L;
  const H0 = 9.2, half = len / 2;
  const W = framer(x, y, z, rot);
  const width = (s) => {
    const b = beam / 2;
    if (s <= 0.58) return b;
    const q = (s - 0.58) / 0.42;
    return Math.max(2.4, b * Math.sqrt(Math.max(0, 1 - q * q)));
  };
  const keel = (s) => 11 + 6 * s * s;
  // plan outline (local lx along the axis, lz across), transom at lx = -half
  const n = lod ? 14 : 36, outline = [];
  for (let i = 0; i <= n; i++) { const s = i / n; outline.push([-half + len * s, width(s)]); }
  for (let i = n; i >= 0; i--) { const s = i / n; outline.push([-half + len * s, -width(s)]); }
  B.frame(x, y, z, rot);
  // the podium: 4 m beyond the hull's waterline all round, 6 m beyond the bow, with
  // two steps down to the forecourt paving at the transom
  const pn = lod ? 10 : 24, pod = [];
  for (let i = 0; i <= pn; i++) { const s = i / pn; pod.push([-half + len * s + (i === pn ? 6 : 0) - (i === 0 ? 4 : 0), width(s) + 4]); }
  for (let i = pn; i >= 0; i--) { const s = i / pn; pod.push([-half + len * s + (i === pn ? 6 : 0) - (i === 0 ? 4 : 0), -(width(s) + 4)]); }
  B.prism(pod, -0.5, 0.9, K.STONE, K.PAVING);
  for (let k = 0; k < 2; k++) B.box(-half - 4 - 0.9 * (k + 1), -half - 4 - 0.9 * k + 0.02, -15, 15, -0.5, 0.9 - 0.3 * (k + 1), K.STONE, K.PAVING);
  // the glazed hall, with a stone base course
  B.prism(outline.map(([a, b]) => [a, b]), 0.85, 1.6, K.STONE, K.STONE, { noTop: true });
  B.prism(outline.map(([a, b]) => [a, b]), 1.6, H0 + 0.4, K.GLASS, K.STONE, { bottom: false });
  if (!lod) {
    // stone mullions (piers) along both flanks, every 6 m
    for (let lx = -half + 3; lx < half * 0.9; lx += 6) {
      const s = (lx + half) / len, w = width(s);
      for (const sg of [-1, 1]) B.box(lx - 0.45, lx + 0.45, sg * w - 0.35, sg * w + 0.35, 0.85, H0 + 0.35, K.STONE, K.STONE);
    }
  }
  // the hull roof: a closed shell from gunwale to gunwale
  const hull = (u, v) => {
    const s = u, w = width(s), t = 2 * v - 1;
    return W(-half + len * s, H0 + 0.1 + keel(s) * Math.pow(Math.max(0, 1 - t * t), 0.72), t * w);
  };
  parts.push(closedWardSurface(lod ? 12 : 30, lod ? 6 : 14, hull, 0.55, K.STONE, K.STONE));
  // the keel: a glowing line along the crown, and the bronze stem down the bow
  const keelLine = [];
  for (let i = 0; i <= (lod ? 8 : 24); i++) { const s = i / (lod ? 8 : 24); keelLine.push(W(-half + len * s, H0 + 0.1 + keel(s) + 0.28, 0)); }
  parts.push(sweepTube(keelLine, () => 0.42, 6, { kind: K.LANTERN }));
  const bowTop = W(half + 0.2, H0 + 0.1 + keel(1) + 0.2, 0);
  parts.push(sweepTube([bowTop, W(half + 1.6, H0 * 0.55, 0), W(half + 2.2, 0.95, 0)], (u) => 0.75 + 0.35 * u, 8, { kind: K.METAL }));
  // the glazed transom under the stern arch (a slab in the arch's plane)
  {
    const arch = [];
    const w0 = width(0);
    for (let i = 0; i <= 16; i++) { const t = -1 + (2 * i) / 16; arch.push([-t * w0, H0 + 0.1 + keel(0) * Math.pow(Math.max(0, 1 - t * t), 0.72)]); }
    B.frame(x, y, z, rot + Math.PI / 2);
    B.vprism(arch, -half + 0.25, -half + 0.55, K.GLASS, K.GLASS);
    // and a stone bow-piece closing the narrow arch at the prow
    const bow = [], w1 = width(1);
    for (let i = 0; i <= 10; i++) { const t = -1 + (2 * i) / 10; bow.push([-t * w1, H0 + 0.1 + keel(1) * Math.pow(Math.max(0, 1 - t * t), 0.72)]); }
    B.vprism(bow, half - 0.6, half - 0.25, K.STONE, K.STONE);
  }
  if (!lod) {
    // bone-white ribs over the shell every 10 m, standing just proud of it
    for (let lx = -half + 5; lx < half - 4; lx += 10) {
      const s = (lx + half) / len, w = width(s), rib = [];
      for (let i = 0; i <= 18; i++) { const t = -1 + (2 * i) / 18; rib.push(W(lx, H0 + 0.1 + keel(s) * Math.pow(Math.max(0, 1 - t * t), 0.72) + 0.42, t * (w + 0.05))); }
      parts.push(sweepTube(rib, () => 0.36, 6, { kind: K.STONE }));
    }
  }
  B.frame(0, 0, 0, 0);
}
