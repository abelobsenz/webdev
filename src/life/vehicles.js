import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Vehicle designs of 5026. All geometry is in metres, nose along +Z, up +Y,
 * port (left) side on +X. Each vertex carries `aPart`, which the vehicle
 * shader uses for livery, glass, trim and every emitter:
 */
export const PART = {
  BODY: 0,       // livery paint
  GLASS: 1,      // canopy / cockpit glass
  TRIM: 2,       // graphite structure, nacelles
  HEAD: 3,       // forward light emitter (white)
  TAIL: 4,       // rear light emitter (red)
  LIFT: 5,       // propulsion glow (cyan) under the fans
  WINDOW: 6,     // passenger window band (warm at night)
  ACCENT: 7,     // class accent stripe (gold / amber / blue)
  ENGINE: 8,     // starship engine throat (hot blue-white)
  LIGHTBAR: 9,   // service craft light bar (pulsing)
  HULL: 10,      // secondary hull (pale ceramic)
  RING: 11,      // rotating habitat ring (spins about local Z)
};

function tag(geo, part) {
  let g = geo.index ? geo : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.index) {
    const idx = [];
    for (let i = 0; i < g.attributes.position.count; i++) idx.push(i);
    g.setIndex(idx);
  }
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  return g;
}

/** Lathe around the Z axis (nose +Z). profile: [[r, z], ...] tail → nose. sy squashes height. */
function hull(profile, seg, { sx = 1, sy = 1 } = {}) {
  const pts = profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 0.0001), z));
  const g = new THREE.LatheGeometry(pts, seg);
  // LatheGeometry spins around +Y; map Y -> Z (nose forward)
  g.rotateX(Math.PI / 2);
  g.scale(sx, sy, 1);
  // after rotateX(+90°) y->z maps profile tail->nose to -Z..+Z? LatheGeometry points go along +Y; rotateX(90) sends +Y to +Z.
  g.computeVertexNormals();
  return g;
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const ring = (r, tube, rs, ts) => new THREE.TorusGeometry(r, tube, rs, ts);

/** Half-width of a hull() section at station z and height y (0 where the section does not reach y). */
function hullHalfWidth(profile, sy, z, y) {
  let r = 0;
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, z0] = profile[i], [r1, z1] = profile[i + 1];
    if (z >= z0 && z <= z1) { r = r0 + ((r1 - r0) * (z - z0)) / Math.max(z1 - z0, 1e-6); break; }
  }
  const e = y / Math.max(r * sy, 1e-6);
  return Math.abs(e) >= 1 ? 0 : r * Math.sqrt(1 - e * e);
}

/**
 * A flank band (window strip, rub rail) that follows the hull's taper as n short boxes per
 * side: each box's inner face sits inside the hull and its outer face stands just proud of it
 * over the whole segment, so the band never floats free of a narrowing nose or tail.
 */
function flankBand(profile, sy, y, h, z0, z1, n, t, part) {
  const out = [], L = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const zc = z0 + (i + 0.5) * L;
    let lo = 1e9, hi = 0;
    for (const z of [zc - L * 0.52, zc, zc + L * 0.52]) for (const yy of [y - h / 2, y, y + h / 2]) {
      const w = hullHalfWidth(profile, sy, z, yy);
      lo = Math.min(lo, w); hi = Math.max(hi, w);
    }
    if (lo < t * 2) continue;
    const inner = lo - t * 0.6, outer = hi + t * 0.25;
    for (const sx of [1, -1]) out.push(tag(box(outer - inner, h, L * 1.04, sx * (inner + outer) * 0.5, y, zc), part));
  }
  return out;
}

/** Ducted lift fan: the glowing underside disc, a dark upper fan disc and a closed hub, so the duct reads solid from above and below. */
function liftFan(parts, r, x, y, z) {
  parts.push(tag(new THREE.CircleGeometry(r, 12).rotateX(Math.PI / 2).translate(x, y - 0.04 * r, z), PART.LIFT));
  parts.push(tag(new THREE.CircleGeometry(r, 12).rotateX(-Math.PI / 2).translate(x, y + 0.04 * r, z), PART.TRIM));
  parts.push(tag(new THREE.CylinderGeometry(r * 0.22, r * 0.26, r * 0.3, 8).translate(x, y + 0.1 * r, z), PART.HULL));
  for (let k = 0; k < 3; k++) parts.push(tag(new THREE.BoxGeometry(r * 1.9, r * 0.04, r * 0.16).rotateY((k * Math.PI) / 3).translate(x, y + 0.08 * r, z), PART.TRIM));
}

function finish(list) {
  const g = mergeGeometries(list, false);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------- air car ----
/** Personal air car ("skimmer"): a pearl teardrop with a bubble canopy and twin ducted lift rings. ~6.4 m */
export function airCarGeometry() {
  const parts = [];
  const prof = [[0.0, -3.2], [0.62, -3.15], [0.98, -2.6], [1.16, -1.5], [1.2, -0.4], [1.08, 0.8], [0.8, 1.9], [0.42, 2.8], [0.1, 3.22], [0.0, 3.28]];
  parts.push(tag(hull(prof, 10, { sy: 0.46 }), PART.BODY));
  parts.push(...flankBand(prof, 0.46, -0.08, 0.1, -2.4, 2.2, 5, 0.05, PART.ACCENT));
  parts.push(tag(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.72, 0.62, 1.55).translate(0, 0.2, 0.55), PART.GLASS));
  for (const sx of [1, -1]) {
    const nac = ring(0.56, 0.16, 4, 12).rotateX(Math.PI / 2).translate(sx * 1.42, -0.12, -1.25);
    parts.push(tag(nac, PART.TRIM));
    liftFan(parts, 0.44, sx * 1.42, -0.14, -1.25);
    parts.push(tag(box(0.55, 0.08, 0.5, sx * 1.0, -0.1, -1.25), PART.TRIM));
  }
  parts.push(tag(box(1.5, 0.09, 0.14, 0, 0.02, 3.0), PART.HEAD));
  parts.push(tag(box(1.7, 0.12, 0.1, 0, 0.12, -3.1), PART.TAIL));
  parts.push(tag(box(0.07, 0.55, 0.95, 0, 0.55, -2.45), PART.ACCENT));
  return finish(parts);
}

// ------------------------------------------------------------- sky ferry ---
/** Long passenger ferry with a continuous window band, dorsal spine and four lift pods. ~64 m */
export function ferryGeometry() {
  const parts = [];
  const prof = [[0.0, -32], [1.4, -31.4], [2.6, -29], [3.3, -24], [3.45, -12], [3.45, 10], [3.2, 20], [2.6, 26.5], [1.6, 30.5], [0.5, 32.2], [0.0, 32.5]];
  parts.push(tag(hull(prof, 14, { sy: 0.86 }), PART.BODY));
  // window band and rub rail follow the hull's taper instead of running straight off the bow
  parts.push(...flankBand(prof, 0.86, 0.55, 1.05, -21.5, 23.5, 15, 0.12, PART.WINDOW));
  parts.push(...flankBand(prof, 0.86, -0.55, 0.18, -24, 26, 10, 0.14, PART.ACCENT));
  for (const sx of [1, -1]) {
    for (const z of [-19, 17]) {
      parts.push(tag(ring(1.9, 0.42, 4, 14).rotateX(Math.PI / 2).translate(sx * 5.4, -1.2, z), PART.TRIM));
      liftFan(parts, 1.5, sx * 5.4, -1.25, z);
      parts.push(tag(box(2.4, 0.35, 1.4, sx * 4.0, -1.0, z), PART.TRIM));
    }
  }
  parts.push(tag(box(1.1, 0.7, 34, 0, 3.0, -2), PART.TRIM));
  parts.push(tag(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(2.3, 1.5, 4.5).translate(0, 1.0, 25.5), PART.GLASS));
  parts.push(tag(box(3.4, 0.25, 0.3, 0, -0.2, 31.9), PART.HEAD));
  parts.push(tag(box(2.4, 0.3, 0.3, 0, 0.4, -31.7), PART.TAIL));
  parts.push(tag(box(0.12, 3.2, 5.5, 0, 3.6, -26), PART.ACCENT)); // fin root sunk into the tapering tail
  return finish(parts);
}

// ----------------------------------------------------------- cargo drone ---
/** Autonomous cargo lifter: a slung container under an X-frame with four ducted fans. ~10 m */
export function cargoDroneGeometry() {
  const parts = [];
  parts.push(tag(box(3.0, 2.6, 6.2, 0, -1.9, 0), PART.BODY));
  parts.push(tag(box(3.1, 0.18, 6.3, 0, -0.55, 0), PART.ACCENT));
  parts.push(tag(box(1.6, 0.7, 2.6, 0, 0.1, 0), PART.HULL));
  // slung container: a pylon joins it to the frame (no gap under the hull) and wrap ribs stiffen it
  parts.push(tag(box(1.0, 0.5, 1.8, 0, -0.42, 0), PART.TRIM));
  for (const z of [-2.2, 0, 2.2]) parts.push(tag(box(3.12, 2.4, 0.14, 0, -1.9, z), PART.TRIM));
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const arm = box(0.28, 0.22, 3.6, 0, 0.1, 0);
    arm.rotateY(Math.atan2(sx, sz));
    arm.translate(sx * 1.2, 0, sz * 1.2);
    parts.push(tag(arm, PART.TRIM));
    parts.push(tag(ring(1.25, 0.2, 4, 14).rotateX(Math.PI / 2).translate(sx * 2.5, 0.15, sz * 2.5), PART.TRIM));
    liftFan(parts, 1.02, sx * 2.5, 0.12, sz * 2.5);
  }
  parts.push(tag(box(0.9, 0.2, 0.15, 0, 0.0, 1.35), PART.HEAD));
  parts.push(tag(box(0.9, 0.2, 0.15, 0, 0.0, -1.35), PART.TAIL));
  return finish(parts);
}

// --------------------------------------------------------- service craft ---
/** Rescue / service craft: angular wedge with a roof light bar. ~9 m */
export function serviceGeometry() {
  const parts = [];
  const prof = [[0.0, -4.4], [0.9, -4.3], [1.35, -3.2], [1.45, -1.0], [1.35, 1.2], [0.95, 3.0], [0.4, 4.3], [0.0, 4.5]];
  parts.push(tag(hull(prof, 8, { sy: 0.62 }), PART.BODY));
  parts.push(...flankBand(prof, 0.62, -0.05, 0.28, -3.3, 3.3, 6, 0.08, PART.ACCENT));
  parts.push(tag(box(1.1, 0.25, 0.35, 0, 0.8, -0.4), PART.TRIM)); // light-bar mount, seated on the roof
  parts.push(tag(new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(0.95, 0.62, 1.8).translate(0, 0.35, 1.2), PART.GLASS));
  parts.push(tag(box(1.7, 0.2, 0.45, 0, 0.98, -0.4), PART.LIGHTBAR));
  for (const sx of [1, -1]) {
    parts.push(tag(ring(0.62, 0.17, 4, 12).rotateX(Math.PI / 2).translate(sx * 1.8, -0.2, -1.8), PART.TRIM));
    liftFan(parts, 0.48, sx * 1.8, -0.22, -1.8);
  }
  parts.push(tag(box(1.4, 0.1, 0.14, 0, 0.0, 4.25), PART.HEAD));
  parts.push(tag(box(1.6, 0.14, 0.1, 0, 0.12, -4.35), PART.TAIL));
  return finish(parts);
}

// ------------------------------------------------------------- starships ---
/**
 * Interstellar ark (~1 unit long, scaled to 240-320 m): a slender spine, a spinning
 * habitat ring with four spokes, radiator vanes, fuel tanks and a triple engine block.
 */
export function arkGeometry() {
  const parts = [];
  parts.push(tag(hull([[0.0, -0.5], [0.05, -0.49], [0.062, -0.44], [0.05, -0.4], [0.034, -0.36], [0.03, 0.3], [0.036, 0.36], [0.04, 0.42], [0.026, 0.48], [0.0, 0.52]], 16), PART.HULL));
  // command section band + windows
  parts.push(tag(hull([[0.041, 0.38], [0.043, 0.4], [0.043, 0.44], [0.041, 0.45]], 16), PART.WINDOW));
  // habitat ring (spins)
  const R = 0.17;
  parts.push(tag(ring(R, 0.018, 8, 56).translate(0, 0, 0.2), PART.RING));
  parts.push(tag(ring(R + 0.017, 0.004, 4, 56).translate(0, 0, 0.2), PART.RING));
  parts.push(tag(ring(R, 0.0192, 4, 56).scale(1, 1, 0.3).translate(0, 0, 0.2), PART.WINDOW));
  for (let k = 0; k < 4; k++) {
    const sp = new THREE.CylinderGeometry(0.006, 0.006, R, 5).translate(0, R / 2, 0);
    sp.rotateZ((k / 4) * Math.PI * 2 + Math.PI / 4);
    sp.translate(0, 0, 0.2);
    parts.push(tag(sp, PART.RING));
  }
  parts.push(tag(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16).rotateX(Math.PI / 2).translate(0, 0, 0.2), PART.TRIM));
  // fuel tanks
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const t = new THREE.CapsuleGeometry(0.02, 0.26, 3, 8).rotateX(Math.PI / 2).translate(Math.cos(a) * 0.052, Math.sin(a) * 0.052, -0.13);
    parts.push(tag(t, k % 2 ? PART.BODY : PART.HULL));
  }
  // radiator vanes (thin, both sides)
  for (const sx of [1, -1]) {
    parts.push(tag(box(0.2, 0.003, 0.16, sx * 0.14, 0, 0.05), PART.TRIM));
    parts.push(tag(box(0.2, 0.004, 0.008, sx * 0.14, 0, 0.13), PART.ACCENT));
  }
  // engine bells
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * 0.03, y = Math.sin(a) * 0.03;
    parts.push(tag(new THREE.CylinderGeometry(0.018, 0.03, 0.05, 12, 1, true).rotateX(-Math.PI / 2).translate(x, y, -0.52), PART.TRIM));
    parts.push(tag(new THREE.CircleGeometry(0.026, 12).rotateY(Math.PI).translate(x, y, -0.53), PART.ENGINE));
  }
  return finish(parts);
}

/** Mars liner (~1 unit, scaled 150-220 m): a pale lifting body with swept wings and a window band. */
export function linerGeometry() {
  const parts = [];
  parts.push(tag(hull([[0.0, -0.5], [0.06, -0.49], [0.085, -0.4], [0.095, -0.2], [0.09, 0.05], [0.075, 0.25], [0.05, 0.38], [0.022, 0.47], [0.0, 0.5]], 16, { sy: 0.5 }), PART.HULL));
  for (const sx of [1, -1]) {
    const wing = new THREE.BufferGeometry();
    const v = [0, 0, 0.1, sx * 0.3, 0, -0.32, sx * 0.3, 0, -0.42, 0, 0, -0.38];
    const pts = [];
    // thin wedge wing (top + bottom faces)
    const top = [[0, 0.012, 0.1], [sx * 0.3, 0.004, -0.32], [sx * 0.3, 0.004, -0.42], [0, 0.012, -0.38]];
    const bot = top.map(([x, y, z]) => [x, -y, z]);
    const quad = (a, b, c, d, flip) => { if (flip) pts.push(...a, ...c, ...b, ...a, ...d, ...c); else pts.push(...a, ...b, ...c, ...a, ...c, ...d); };
    quad(top[0], top[1], top[2], top[3], sx > 0);
    quad(bot[0], bot[1], bot[2], bot[3], sx < 0);
    quad(top[0], bot[0], bot[1], top[1], sx < 0);
    quad(top[1], bot[1], bot[2], top[2], sx < 0);
    wing.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    wing.computeVertexNormals();
    void v;
    parts.push(tag(wing, PART.BODY));
    parts.push(tag(box(0.004, 0.012, 0.52, sx * 0.089, 0.006, -0.02), PART.WINDOW));
    parts.push(tag(box(0.004, 0.004, 0.5, sx * 0.093, -0.01, -0.03), PART.ACCENT));
    parts.push(tag(box(0.004, 0.06, 0.08, sx * 0.3, 0.025, -0.38), PART.TRIM));
  }
  parts.push(tag(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(0.045, 0.03, 0.09).translate(0, 0.03, 0.34), PART.GLASS));
  parts.push(tag(box(0.004, 0.09, 0.12, 0, 0.07, -0.4), PART.BODY));
  for (let k = 0; k < 3; k++) {
    const x = (k - 1) * 0.045;
    parts.push(tag(new THREE.CylinderGeometry(0.02, 0.026, 0.04, 12, 1, true).rotateX(-Math.PI / 2).translate(x, 0, -0.5), PART.TRIM));
    parts.push(tag(new THREE.CircleGeometry(0.022, 12).rotateY(Math.PI).translate(x, 0, -0.515), PART.ENGINE));
  }
  return finish(parts);
}

/**
 * Light layout per vehicle class: 6 emitters each, positions in the class's
 * model units (multiplied by the instance scale). type: 0 head, 1 tail, 2 port nav,
 * 3 starboard nav, 4 strobe, 5 lift glow, 6 pulse (blue), 7 pulse (red), 8 engine,
 * 9 amber beacon, 10 window glow. size in model units, intensity in HDR.
 */
export const LIGHTS = {
  car: [
    { p: [0, 0.02, 3.3], type: 0, size: 0.55, i: 9 },
    { p: [0, 0.12, -3.2], type: 1, size: 0.55, i: 5 },
    { p: [1.62, -0.1, -1.25], type: 2, size: 0.3, i: 5 },
    { p: [-1.62, -0.1, -1.25], type: 3, size: 0.3, i: 5 },
    { p: [0, 0.85, -2.5], type: 4, size: 0.3, i: 10 },
    { p: [0, -0.6, -0.9], type: 5, size: 2.4, i: 0.45 },
  ],
  ferry: [
    { p: [0, -0.2, 32.6], type: 0, size: 2.2, i: 9 },
    { p: [0, 0.4, -32], type: 1, size: 1.8, i: 5 },
    { p: [7.4, -1.2, -19], type: 2, size: 0.9, i: 5 },
    { p: [-7.4, -1.2, -19], type: 3, size: 0.9, i: 5 },
    { p: [0, 5.8, -26], type: 4, size: 0.9, i: 10 },
    { p: [0, 0.4, 0], type: 10, size: 24, i: 0.22 },
  ],
  cargo: [
    { p: [0, 0, 1.5], type: 0, size: 0.5, i: 6 },
    { p: [0, 0, -1.5], type: 1, size: 0.5, i: 4 },
    { p: [3.8, 0.15, 2.5], type: 2, size: 0.35, i: 5 },
    { p: [-3.8, 0.15, -2.5], type: 3, size: 0.35, i: 5 },
    { p: [0, 0.55, 0], type: 9, size: 0.5, i: 8 },
    { p: [0, -3.3, 0], type: 9, size: 0.5, i: 5 },
  ],
  service: [
    { p: [0, 0.0, 4.5], type: 0, size: 0.55, i: 9 },
    { p: [0, 0.12, -4.4], type: 1, size: 0.55, i: 5 },
    { p: [0.7, 1.1, -0.4], type: 6, size: 0.55, i: 12 },
    { p: [-0.7, 1.1, -0.4], type: 7, size: 0.55, i: 12 },
    { p: [0, -0.4, 4.1], type: 4, size: 0.3, i: 10 },
    { p: [0, -0.7, -1.2], type: 5, size: 2.6, i: 0.5 },
  ],
  ship: [
    { p: [0, 0, -0.56], type: 8, size: 0.09, i: 40 },
    { p: [0.3, 0, 0.0], type: 2, size: 0.012, i: 8 },
    { p: [-0.3, 0, 0.0], type: 3, size: 0.012, i: 8 },
    { p: [0, 0.05, 0.3], type: 4, size: 0.012, i: 14 },
    { p: [0, 0.21, 0.2], type: 9, size: 0.012, i: 6 },
    { p: [0, 0, 0.53], type: 0, size: 0.02, i: 10 },
  ],
};
