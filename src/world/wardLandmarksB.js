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
  // the sheer: the keel sweeps up toward the bow; the section rises from vertical sides
  // at the gunwale to a pointed keel ridge (an upturned hull, not a barrel vault)
  const keel = (s) => 10 + 9 * Math.pow(s, 2.2);
  const sect = (t) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 1.35)), 0.8);
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
    return W(-half + len * s, H0 + 0.1 + keel(s) * sect(t), t * w);
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
    for (let i = 0; i <= 16; i++) { const t = -1 + (2 * i) / 16; arch.push([-t * w0, H0 + 0.1 + keel(0) * sect(t)]); }
    B.frame(x, y, z, rot + Math.PI / 2);
    B.vprism(arch, -half + 0.25, -half + 0.55, K.GLASS, K.GLASS);
    // and a stone bow-piece closing the narrow arch at the prow
    const bow = [], w1 = width(1);
    for (let i = 0; i <= 10; i++) { const t = -1 + (2 * i) / 10; bow.push([-t * w1, H0 + 0.1 + keel(1) * sect(t)]); }
    B.vprism(bow, half - 0.6, half - 0.25, K.STONE, K.STONE);
  }
  if (!lod) {
    // bone-white ribs over the shell every 10 m, standing just proud of it
    for (let lx = -half + 5; lx < half - 4; lx += 10) {
      const s = (lx + half) / len, w = width(s), rib = [];
      for (let i = 0; i <= 18; i++) { const t = -1 + (2 * i) / 18; rib.push(W(lx, H0 + 0.1 + keel(s) * sect(t) + 0.42, t * (w + 0.05))); }
      parts.push(sweepTube(rib, () => 0.36, 6, { kind: K.STONE }));
    }
  }
  B.frame(0, 0, 0, 0);
}

// ----------------------------------------------------------- Westmere --
/**
 * The Theatre of the Western Sea. A keyhole is cut from the street level to the quay: a
 * round orchestra and, seaward, a channel open to the ghat steps and the sea. The lower
 * cavea descends the cut (fifteen rows, quay to street); the upper cavea climbs above
 * the street on a solid substructure (thirty rows) to a colonnaded portico; its arcaded
 * outer wall faces the city. A Roman stage along the orchestra's diameter carries an open
 * scaenae frons, so the sea itself is the scenery. L: { x, z, a (bearing of the sea),
 * r0 (orchestra), r1 (the cut), rOuter }.
 */
export function seaTheatre(B, parts, L, lod, lights, sweepLoop) {
  const QY = 3, TOP = 9;
  const { x, z, a, r0, r1, rOuter } = L;
  const a0 = a + Math.PI / 2 + 0.1, a1 = a + 1.5 * Math.PI - 0.1;
  const seg = lod ? 20 : 72;
  const arcAt = (r) => { const pts = []; for (let i = 0; i <= seg; i++) { const t = a0 + ((a1 - a0) * i) / seg; pts.push([x + Math.cos(t) * r, z + Math.sin(t) * r]); } return pts; };
  const block = (rIn, rA, rB, yB, yT, kTop, kFace, kOut = K.STONE) => parts.push(sweepLoop(arcAt(rIn), () => [
    { a: [rB - rIn, yB], b: [rB - rIn, yT], kind: kOut },
    { a: [rB - rIn, yT], b: [rA - rIn, yT], kind: kTop },
    { a: [rA - rIn, yT], b: [rA - rIn, yB], kind: kFace },
  ], { closed: false, closeSection: true, capEnds: true }));
  // the lower cavea: fifteen rows from the orchestra up to the street
  const nLo = 15, dLo = (r1 - r0) / nLo;
  if (lod) { for (let k = 0; k < nLo; k += 5) block(r0, r0 + k * dLo, r0 + (k + 5) * dLo, QY - 0.3, QY + ((TOP - QY) * (k + 3)) / nLo, K.PAVING, K.STONE); }
  else for (let k = 0; k < nLo; k++) block(r0, r0 + k * dLo, r0 + (k + 1) * dLo, QY - 0.3, QY + ((TOP - QY) * (k + 1)) / nLo, K.PAVING, K.STONE);
  // the upper cavea on its substructure: thirty rows above the street, 0.9 m by 0.4 m
  const u0 = r1 + 1.0, nUp = 30, dUp = 0.9, rise = 0.4, rTop = u0 + nUp * dUp, yTop = TOP + nUp * rise;
  if (lod) { for (let k = 0; k < nUp; k += 6) block(u0, u0 + k * dUp, u0 + (k + 6) * dUp, TOP - 0.3, TOP + (k + 4) * rise, K.PAVING, K.STONE); }
  else for (let k = 0; k < nUp; k++) block(u0, u0 + k * dUp, u0 + (k + 1) * dUp, TOP - 0.3, TOP + (k + 1) * rise, K.PAVING, K.STONE);
  // the crowning walk, the arcaded outer wall, and the portico over the walk
  const rWall = rOuter - 1.2;
  block(rTop, rTop, rWall, TOP - 0.3, yTop, K.PAVING, K.STONE);
  const colH = 6.2;
  block(rWall, rWall, rOuter, TOP - 0.3, yTop + colH + 0.02, K.STONE, K.STONE, K.PUNCHED);
  block(rTop - 0.4, rTop - 0.4, rOuter + 0.4, yTop + colH, yTop + colH + 0.9, K.STONE, K.STONE);
  if (!lod) {
    const n = Math.floor(((a1 - a0) * (rTop + 1.4)) / 5.6);
    for (let i = 0; i <= n; i++) {
      const t = a0 + ((a1 - a0) * i) / n, cx = x + Math.cos(t) * (rTop + 1.4), cz = z + Math.sin(t) * (rTop + 1.4);
      B.frame(cx, 0, cz, 0);
      B.lathe(0, 0, [[0.62, yTop - 0.05, K.STONE], [0.62, yTop + 0.35, K.STONE], [0.44, yTop + 0.55, K.STONE], [0.38, yTop + colH - 0.5, K.STONE], [0.62, yTop + colH + 0.02, K.STONE]], 10);
    }
    // warm lamps under the portico (steady)
    if (lights) for (let i = 1; i < 8; i++) { const t = a0 + ((a1 - a0) * i) / 8; lights.push({ x: x + Math.cos(t) * (rTop + 2.6), y: yTop + colH - 0.6, z: z + Math.sin(t) * (rTop + 2.6), c: [1.0, 0.82, 0.6], s: 1.3 }); }
  }
  // the analemmata: stepped retaining walls that close both ends of the cavea
  for (const t of [a0, a1]) {
    const px = x + Math.cos(t) * ((r0 + rOuter) / 2), pz = z + Math.sin(t) * ((r0 + rOuter) / 2);
    B.frame(px, 0, pz, -t);
    const m = (r0 + rOuter) / 2, R = (r) => r - m;
    B.vprism([[R(r0 - 0.4), QY - 0.3], [R(r1), QY - 0.3], [R(r1), TOP - 0.3], [R(rOuter), TOP - 0.3], [R(rOuter), yTop + 1.1], [R(rTop), yTop + 1.1], [R(u0), TOP + 1.0], [R(r1), TOP + 0.9], [R(r0 - 0.4), QY + 0.9]], -0.8, 0.8, K.STONE);
  }
  // the orchestra: the thymele (a low round dais) at its centre
  B.frame(x, 0, z, 0);
  B.lathe(0, 0, [[4.2, QY - 0.2, K.STONE], [4.2, QY + 0.32, K.STONE], [3.7, QY + 0.32, K.PAVING], [0, QY + 0.32, K.PAVING]], lod ? 12 : 32);
  // the stage along the orchestra's diameter, and its open scaenae frons
  const c = Math.cos(a), s = Math.sin(a);
  B.frame(x, 0, z, -a);                 // local x toward the sea, local z along the stage
  const hw = r0 + 5, s0 = 3, s1 = 15;
  B.box(s0, s1, -hw, hw, QY - 0.3, QY + 1.4, K.STONE, K.TIMBER);
  if (!lod) for (let k = 0; k < 3; k++) B.box(s0 - 0.45 * (k + 1), s0 - 0.45 * k + 0.02, -8, 8, QY - 0.3, QY + 1.4 - 0.35 * (k + 1), K.STONE, K.STONE);
  const nCol = 11, colTop = QY + 1.4 + 9.5;
  for (let i = 0; i < nCol; i++) {
    const zz = -hw + 2.5 + ((2 * hw - 5) * i) / (nCol - 1);
    if (!lod) B.lathe(s1 - 1.6, zz, [[0.95, QY + 1.35, K.STONE], [0.95, QY + 1.9, K.STONE], [0.72, QY + 2.2, K.STONE], [0.62, colTop - 0.6, K.STONE], [0.95, colTop + 0.02, K.STONE]], 12);
    else B.box(s1 - 2.2, s1 - 1.0, zz - 0.6, zz + 0.6, QY + 1.35, colTop, K.STONE, K.STONE);
  }
  B.box(s1 - 2.7, s1 - 0.5, -hw, hw, colTop, colTop + 1.5, K.STONE, K.STONE);
  B.box(s1 - 2.9, s1 - 0.3, -hw - 0.3, hw + 0.3, colTop + 1.5, colTop + 1.9, K.STONE, K.STONE);
  // the pediment over the royal door, facing the cavea and the sea
  B.frame(x + c * (s1 - 1.6), 0, z + s * (s1 - 1.6), -a + Math.PI / 2);
  B.vprism([[-9, colTop + 1.9], [9, colTop + 1.9], [0, colTop + 5.2]], -1.1, 1.1, K.STONE);
  B.frame(0, 0, 0, 0);
  if (lights) lights.push({ x: x + c * (s1 - 1.6), y: colTop + 5.8, z: z + s * (s1 - 1.6), c: [1.0, 0.86, 0.62], s: 1.8 });
}

// -------------------------------------------------------- Coral Reach --
/**
 * A reef-garden pavilion: a scallop shell of bone-white composite, fluted, rising from a
 * hinge at its back and opening toward the garden, on five slender coral-white posts over
 * a round paved dais. rot turns its mouth (local +z) toward the garden's centre.
 */
export function shellPavilion(B, parts, L, y, lod, lights) {
  const { x, z, rot } = L;
  const c = Math.cos(rot), s = Math.sin(rot);
  const W = (lx, ly, lz) => V(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
  B.frame(x, y, z, rot);
  B.lathe(0, 0, [[8.6, -0.35, K.STONE], [8.6, 0.3, K.STONE], [8.1, 0.3, K.PAVING], [0, 0.3, K.PAVING]], lod ? 16 : 40);
  const hinge = [0, 5.4, -5.6];
  const mid = (u, v) => {
    const th = (u - 0.5) * 2.2, rho = 1 + v * 11.4, t = 2 * u - 1;
    const h = 0.2 + 3.2 * Math.sin(v * Math.PI) - 1.2 * v - 1.4 * t * t * t * t * v + (lod ? 0 : 0.26 * Math.sin(u * Math.PI * 9) * Math.pow(v, 0.8));
    return [hinge[0] + Math.sin(th) * rho, hinge[1] + h, hinge[2] + Math.cos(th) * rho];
  };
  parts.push(closedWardSurface(lod ? 10 : 36, lod ? 5 : 12, (u, v) => W(...mid(u, v)), 0.34, K.STONE, K.STONE));
  const posts = [[0.5, 0.0], [0.16, 0.62], [0.84, 0.62], [0.36, 0.9], [0.64, 0.9]];
  for (const [u, v] of posts) {
    const [px, py, pz] = mid(u, v);
    const r = v === 0 ? 0.55 : 0.2;
    if (lod) B.box(px - r, px + r, pz - r, pz + r, 0.25, py, K.STONE, K.STONE);
    else B.lathe(px, pz, [[r * 1.8, 0.25, K.STONE], [r * 1.8, 0.45, K.STONE], [r, 0.6, K.STONE], [r * 0.85, py - 0.4, K.STONE], [r * 1.25, py, K.STONE]], 10);
  }
  B.frame(0, 0, 0, 0);
  if (lights) { const p = W(0, 4.2, -1.0); lights.push({ x: p.x, y: p.y, z: p.z, c: [0.35, 0.95, 1.0], s: 1.2 }); }
}

/**
 * Transit sheds along Southmarch's finger piers: a long fritted-glass barrel on slender
 * bronze columns down the middle of each pier, where passengers wait for the sea-ships
 * out of the rain; the pier's edges stay open for mooring and for walking.
 * L.list: [{ x, z0, z1 }] in world coordinates; y is the quay level.
 */
export function pierSheds(B, L, y, lod) {
  for (const p of L.list) {
    const len = p.z1 - p.z0, zc = (p.z0 + p.z1) / 2;
    B.frame(p.x, y, zc, -Math.PI / 2);          // local x runs down the pier (+z world)
    const half = len / 2, H = 7.4;
    B.vault(-half, half, -5.2, 5.2, H, 2.3, K.FRIT, lod ? 6 : 12);
    // a bronze eaves beam along both sides carries the barrel
    for (const sg of [-1, 1]) B.box(-half, half, sg * 4.9 - 0.3, sg * 4.9 + 0.3, H - 0.55, H + 0.02, K.METAL, K.METAL);
    const step = lod ? 28 : 14, n = Math.round(len / step);
    for (let i = 0; i <= n; i++) {
      const lx = -half + 1.5 + ((len - 3) * i) / n;
      for (const sg of [-1, 1]) {
        if (lod) B.box(lx - 0.35, lx + 0.35, sg * 4.9 - 0.35, sg * 4.9 + 0.35, -0.2, H - 0.5, K.METAL, K.METAL);
        else B.lathe(lx, sg * 4.9, [[0.5, -0.2, K.STONE], [0.5, 0.35, K.STONE], [0.26, 0.5, K.METAL], [0.2, H - 0.8, K.METAL], [0.34, H - 0.5, K.METAL]], 8);
      }
      // benches between the columns, facing the ships
      if (!lod && i < n) for (const sg of [-1, 1]) B.box(lx + 4, lx + 9, sg * 2.2 - 0.3, sg * 2.2 + 0.3, 0, 0.48, K.STONE, K.TIMBER);
    }
  }
  B.frame(0, 0, 0, 0);
}
