import * as THREE from 'three';
import { CB, CK, sectionEllipse } from '../craft/craftGeometry.js';
import { LAMP } from './lamps.js';

// THE SHIPWRIGHT'S KIT: people-scale fittings for MERIDIAN's working ships, drawn with the
// craft builder (metres, +Z forward, +Y up, port +X) so every part carries its facade kind and
// merges into one geometry per hull.
//
// A capital's ships are lived in and worked on: reaction-control quads at the corners (their
// nozzles are recorded so the puffs come out of the right holes), docking collars with hatches
// and approach lights, glazed bridges with a deck of rooms behind them, catwalks with
// railings along spines and tanks, radiator wings on manifolds, dishes and whip antennas,
// cargo in ribbed containers held by bronze clamps, floodlights on the cargo, and the
// navigation set every hull must show (port red, starboard green, white stern, a masthead).
//
// Every helper appends to the builder at its current transform and, where it matters,
// returns records in the ship frame (lamps, thruster nozzles) that the caller keeps.

const TAU = Math.PI * 2;
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Seeded deterministic generator (mulberry32): r() in [0, 1). */
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a0, b0) => a0 + (b0 - a0) * r();
  r.int = (a0, b0) => Math.floor(a0 + (b0 - a0 + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  return r;
}

/** Point in the builder's current frame -> ship frame (the stack's top matrix). */
export function here(B, x, y, z) { return V(x, y, z).applyMatrix4(B.M); }
/** Direction in the builder's current frame -> ship frame. */
export function hereDir(B, x, y, z) { return V(x, y, z).transformDirection(B.M); }

/** Rotation that takes local +Z to dir (used to aim lathed parts). */
export function aimZ(dir) {
  return new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir.clone().normalize()));
}

/** Push a frame at p with local +Z along dir. */
export function atAim(B, p, dir) {
  const m = aimZ(dir);
  m.setPosition(p);
  return B.push(m);
}

/** Capsule tank along local z: radius r, overall length len, bands of kind band every `pitch` m. */
export function tank(B, r, len, k = CK.HULL, band = CK.BRONZE, seg = 18) {
  const h = Math.max(len / 2 - r, 0);
  const prof = [];
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * (Math.PI / 2);
    prof.push([Math.max(Math.cos(a) * r, 0.02), -h + Math.sin(a) * r, k]);
  }
  // girth bands: raised rings of the band kind
  const nb = Math.max(1, Math.round((2 * h) / (r * 1.2)));
  for (let b = 0; b <= nb; b++) {
    const z = -h + (2 * h * b) / nb;
    if (b > 0) prof.push([r, z - r * 0.08, k]);
    prof.push([r * 1.04, z - r * 0.04, band], [r * 1.04, z + r * 0.04, band]);
    if (b < nb) prof.push([r, z + r * 0.08, band]);
  }
  for (let i = 1; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    prof.push([Math.max(Math.cos(a) * r, 0.02), h + Math.sin(a) * r, k]);
  }
  B.lathe(prof, seg);
}

/** Sphere tank (lathe) with an equatorial bronze girth and a walkway ring. */
export function sphereTank(B, r, k = CK.HULL, seg = 20) {
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI;
    const kk = Math.abs(a) < 0.12 ? CK.BRONZE : k;
    prof.push([Math.max(Math.cos(a) * r, 0.02), Math.sin(a) * r, kk]);
  }
  B.lathe(prof, seg);
  B.torus(r * 1.03, r * 0.035, seg * 2, 5, CK.DECK);
}

/**
 * Reaction-control quad on a hull face: a housing block with four nozzles, one along the face
 * normal and three at right angles (fore, aft and one lateral). p: position, n: outward normal,
 * fwd: the ship's +Z projected on the face. Returns nozzle records { p, dir } in the ship frame.
 */
export function rcsQuad(B, p, n, fwd = V(0, 0, 1), size = 1) {
  const N = n.clone().normalize();
  const F = fwd.clone().addScaledVector(N, -fwd.dot(N));
  if (F.lengthSq() < 1e-6) F.set(1, 0, 0).addScaledVector(N, -N.x);
  F.normalize();
  const S = V().crossVectors(N, F);
  const m = new THREE.Matrix4().makeBasis(S, N, F).setPosition(p);
  B.push(m);
  const s = size;
  B.box(0, 0.35 * s, 0, 1.3 * s, 0.7 * s, 1.3 * s, CK.DARK);
  B.box(0, 0.74 * s, 0, 1.0 * s, 0.1 * s, 1.0 * s, CK.BRONZE);
  const noz = [];
  const nozzle = (x, y, z, dir) => {
    atAim(B, V(x, y, z), dir);
    B.lathe([[0.16 * s, 0, CK.DARK], [0.2 * s, 0.22 * s, CK.DARK], [0.3 * s, 0.5 * s, CK.BRONZE], [0.26 * s, 0.52 * s, CK.DARK], [0.08 * s, 0.3 * s, CK.DARK]], 8, 0, { closedProfile: false });
    B.pop();
    noz.push({ p: here(B, x + dir.x * 0.52 * s, y + dir.y * 0.52 * s, z + dir.z * 0.52 * s), dir: hereDir(B, dir.x, dir.y, dir.z) });
  };
  nozzle(0, 0.7 * s, 0, V(0, 1, 0));
  nozzle(0, 0.35 * s, 0.65 * s, V(0, 0, 1));
  nozzle(0, 0.35 * s, -0.65 * s, V(0, 0, -1));
  nozzle(0.65 * s, 0.35 * s, 0, V(1, 0, 0));
  B.pop();
  return noz;
}

/**
 * Docking collar along local +Z at the current frame: an androgynous ring with guide petals,
 * a hatch in its face and a berth light pair. Returns lamps (ship frame) and the face point.
 */
export function dockingCollar(B, r = 2.2) {
  B.lathe([[r * 0.9, -r * 0.6, CK.HULL], [r * 1.05, -r * 0.2, CK.BRONZE], [r * 1.05, r * 0.25, CK.BRONZE], [r * 0.95, r * 0.35, CK.DARK],
    [r * 0.6, r * 0.35, CK.DARK], [r * 0.55, r * 0.3, CK.HULL], [0.02, r * 0.3, CK.HULL]], 20);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2;
    B.push(new THREE.Matrix4().makeRotationZ(a));
    B.box(r * 0.8, 0, r * 0.45, r * 0.12, r * 0.45, r * 0.3, CK.BRONZE);
    B.pop();
  }
  // the hatch: a dark door in a bronze frame across the collar's face
  B.box(0, 0, r * 0.32, r * 0.9, r * 0.9, 0.08, CK.DARK);
  B.box(0, 0, r * 0.34, r * 1.0, 0.08 * r, 0.06, CK.BRONZE);
  const lamps = [
    { p: here(B, r * 1.15, 0, r * 0.2), r: 0.18 * r, color: LAMP.AMBER, i: 2.6, breathe: 0.35 },
    { p: here(B, -r * 1.15, 0, r * 0.2), r: 0.18 * r, color: LAMP.AMBER, i: 2.6, breathe: 0.35, phase: 0.5 },
  ];
  return { lamps, face: here(B, 0, 0, r * 0.35) };
}

/** Square truss between a and b (ship frame), width w, bay length ~bay; longerons, frames and diagonals. */
export function truss(B, a, b, w = 3, bay = 6, r = 0.18, k = CK.DARK) {
  const d = V().subVectors(b, a);
  const L = d.length();
  if (L < 1e-6) return;
  atAim(B, a, d);
  const h = w / 2;
  const n = Math.max(1, Math.round(L / bay));
  for (const x of [-h, h]) for (const y of [-h, h]) B.tube([V(x, y, 0), V(x, y, L)], r * 1.4, 5, k);
  for (let i = 0; i <= n; i++) {
    const z = (L * i) / n;
    B.box(0, h, z, w, r * 1.6, r * 1.6, k); B.box(0, -h, z, w, r * 1.6, r * 1.6, k);
    B.box(h, 0, z, r * 1.6, w, r * 1.6, k); B.box(-h, 0, z, r * 1.6, w, r * 1.6, k);
    if (i < n) {
      const z1 = (L * (i + 1)) / n;
      const s = i % 2 ? 1 : -1;
      B.tube([V(-h, s * h, z), V(h, s * h, z1)], r, 4, k);
      B.tube([V(s * h, -h, z), V(s * h, h, z1)], r, 4, k);
    }
  }
  B.pop();
}

/** Catwalk: a deck plank from a to b (ship frame) on the side `up`, with posts and a handrail each side. */
export function catwalk(B, a, b, up = V(0, 1, 0), w = 1.2, rail = 1.1) {
  const d = V().subVectors(b, a);
  const L = d.length();
  if (L < 1e-6) return;
  const z = d.clone().normalize();
  const x = V().crossVectors(up, z).normalize();
  const y = V().crossVectors(z, x);
  B.push(new THREE.Matrix4().makeBasis(x, y, z).setPosition(a));
  B.box(0, 0, L / 2, w, 0.12, L, CK.DECK);
  const posts = Math.max(1, Math.round(L / 2.4));
  for (const s of [-1, 1]) {
    const xr = s * (w / 2 - 0.04);
    B.tube([V(xr, rail, 0), V(xr, rail, L)], 0.045, 4, CK.BRONZE);
    B.tube([V(xr, rail * 0.5, 0), V(xr, rail * 0.5, L)], 0.03, 4, CK.DARK);
    for (let i = 0; i <= posts; i++) B.box(xr, rail / 2, (L * i) / posts, 0.06, rail, 0.06, CK.DARK);
  }
  B.pop();
}

/** Radiator wing on a boom: root at p, spanning along `out`, broad side normal `n`; manifold, ribs, tip light. */
export function radiatorWing(B, p, out, n, span, chord, lamps, color = null) {
  const X = out.clone().normalize();
  const Y = n.clone().addScaledVector(X, -n.dot(X)).normalize();
  const Z = V().crossVectors(X, Y);
  B.push(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(p));
  const boom = Math.min(span * 0.12, chord * 0.4);
  B.tube([V(0, 0, 0), V(boom, 0, 0)], chord * 0.035 + 0.2, 8, CK.BRONZE);
  B.box(boom + span / 2, 0, 0, span, chord * 0.012 + 0.08, chord, CK.RADIATOR);
  B.box(boom + span / 2, 0, chord / 2, span + 0.4, chord * 0.03 + 0.2, chord * 0.03 + 0.2, CK.BRONZE);   // hot manifold
  B.box(boom + span / 2, 0, -chord / 2, span + 0.4, chord * 0.025 + 0.15, chord * 0.025 + 0.15, CK.BRONZE);   // return
  const ribs = Math.max(2, Math.round(span / (chord * 0.5)));
  for (let i = 0; i <= ribs; i++) B.box(boom + (span * i) / ribs, 0, 0, chord * 0.02 + 0.12, chord * 0.03 + 0.12, chord, CK.DARK);
  if (lamps && color) lamps.push({ p: here(B, boom + span + 0.4, 0, 0), r: chord * 0.02 + 0.25, color, i: 3.2, dir: hereDir(B, 1, 0, 0) });
  B.pop();
}

/** Parabolic dish at p, looking along dir, radius r, on a short yoke. */
export function dish(B, p, dir, r) {
  atAim(B, p, dir);
  B.tube([V(0, 0, -r * 0.8), V(0, 0, 0)], r * 0.08, 6, CK.DARK);
  const prof = [];
  for (let i = 0; i <= 6; i++) { const u = i / 6; prof.push([Math.max(u * r, 0.02), u * u * r * 0.35, i === 6 ? CK.BRONZE : CK.HULL]); }
  prof.push([r * 0.97, r * 0.33, CK.HULL], [0.02, r * 0.02, CK.HULL]);
  B.lathe(prof, 16);
  B.tube([V(0, 0, r * 0.05), V(0, 0, r * 0.55)], r * 0.03, 4, CK.DARK);
  B.box(0, 0, r * 0.56, r * 0.1, r * 0.1, r * 0.08, CK.BRONZE);
  B.pop();
}

/** Whip antenna with a lantern tip: returns the tip (ship frame) for a masthead lamp. */
export function mast(B, p, dir, h, r = 0.2) {
  atAim(B, p, dir);
  B.lathe([[r * 3, 0, CK.DARK], [r * 2.2, h * 0.08, CK.BRONZE], [r, h * 0.12, CK.DARK], [r * 0.6, h, CK.DARK], [r * 1.8, h * 1.01, CK.LANTERN], [0.02, h * 1.05, CK.LANTERN]], 6);
  for (const t of [0.35, 0.65]) B.box(0, 0, h * t, r * 9, r * 0.6, r * 0.6, CK.DARK);    // crossarms
  const tip = here(B, 0, 0, h * 1.06);
  B.pop();
  return tip;
}

/** A shipping container (w x h x l), ribbed sides, corner posts, a door end; kind k. */
export function container(B, x, y, z, w, h, l, k) {
  B.box(x, y, z, w, h, l, k);
  const ribs = Math.max(2, Math.round(l / 1.6));
  for (let i = 1; i < ribs; i++) {
    const zz = z - l / 2 + (l * i) / ribs;
    B.box(x, y, zz, w * 1.02, h * 1.02, 0.08, k === CK.DARK ? CK.HULL : CK.DARK);
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) B.box(x + sx * w / 2, y + sy * h / 2, z, 0.3, 0.3, l + 0.1, CK.BRONZE);
  B.box(x, y, z + l / 2 + 0.03, w * 0.85, h * 0.85, 0.06, CK.DARK);
}

/** Glazed bridge: a faceted wheelhouse at the current frame, windows forward and round the sides. */
export function bridge(B, w, h, l, lamps) {
  const pts = (a, b) => [[-a, -b], [a, -b], [a * 1.02, b * 0.55], [a * 0.8, b], [-a * 0.8, b], [-a * 1.02, b * 0.55]];
  const rings = [];
  const N = 6;
  for (let j = 0; j <= N; j++) {
    const u = j / N;
    const sh = u < 0.7 ? 1 : 1 - 0.45 * (u - 0.7) / 0.3;
    rings.push({ z: lerp(-l / 2, l / 2, u), pts: pts(w / 2 * sh, h / 2 * (u < 0.7 ? 1 : 1 - 0.25 * (u - 0.7) / 0.3)) });
  }
  // the top band and the forward faces are glass; a bronze sill under the windows
  B.loft(rings, (i, j) => (i >= 2 && i <= 5 && j >= 1 ? (j === N ? CK.GLASS : (i === 2 || i === 5 ? CK.GLASS : CK.HULL)) : i === 1 ? CK.BRONZE : CK.HULL), { capStart: CK.HULL, capEnd: CK.GLASS });
  // window hoods over the glass, a sun visor forward
  B.box(0, h / 2 + 0.1, l * 0.36, w * 0.82, 0.18, l * 0.3, CK.DARK);
  // cabin lights: a warm pair at the forward corners
  if (lamps) {
    lamps.push({ p: here(B, w * 0.42, h * 0.1, l / 2 + 0.2), r: 0.12 * w, color: [1.0, 0.8, 0.55], i: 1.4 });
    lamps.push({ p: here(B, -w * 0.42, h * 0.1, l / 2 + 0.2), r: 0.12 * w, color: [1.0, 0.8, 0.55], i: 1.4 });
  }
}

/** Engine bell opening toward -z at the current frame's (x, y, z); pushes the glow record. */
export function bell(B, x, y, z, r, len, glows, k = CK.BRONZE) {
  B.at(x, y, z);
  B.lathe([[r * 0.55, 0, CK.HULL], [r * 0.5, -len * 0.2, CK.DARK], [r * 0.72, -len * 0.55, k], [r, -len, CK.DARK], [r * 0.93, -len * 1.02, CK.CONDUIT],
    [r * 0.87, -len, CK.DARK], [r * 0.62, -len * 0.55, CK.DARK], [r * 0.4, -len * 0.2, CK.DARK], [r * 0.43, 0, CK.HULL]], 18, 0, { closedProfile: true });
  glows.push({ p: here(B, 0, 0, -len), r: r * 0.9, dir: hereDir(B, 0, 0, -1) });
  // gimbal actuators: two bronze struts from the thrust frame to the bell's throat
  for (const s of [-1, 1]) B.tube([V(s * r * 0.9, 0, len * 0.15), V(s * r * 0.6, 0, -len * 0.3)], r * 0.06 + 0.05, 5, CK.BRONZE);
  B.pop();
}

/** Floodlight on a small bracket at p looking along dir; returns the lamp record. */
export function flood(B, p, dir, size = 0.5, color = LAMP.WHITE, i = 2.2) {
  atAim(B, p, dir);
  B.lathe([[size * 0.5, -size, CK.DARK], [size * 0.9, 0, CK.DARK], [size * 0.8, 0.05, CK.LANTERN], [0.02, 0.05, CK.LANTERN]], 8);
  const tip = here(B, 0, 0, size * 0.3);
  B.pop();
  return { p: tip, r: size * 0.7, color, i, dir: dir.clone().normalize() };
}

/** Navigation set on a hull of half-width hw at station z (plus stern light and masthead). */
export function navSet(lamps, { hw, y = 0, z = 0, stern, mastTip, r = 0.6 }) {
  lamps.push({ p: V(hw, y, z), r, color: LAMP.RED, i: 3.2, dir: V(1, 0, 0.25) });
  lamps.push({ p: V(-hw, y, z), r, color: LAMP.GREEN, i: 3.2, dir: V(-1, 0, 0.25) });
  if (stern) lamps.push({ p: stern, r: r * 0.9, color: LAMP.WHITE, i: 2.4, dir: V(0, 0, -1) });
  if (mastTip) lamps.push({ p: mastTip, r: r * 0.8, color: LAMP.WHITE, i: 2.2, breathe: 0.25 });
}

/** A lofted hull from a half-width/half-height profile (u 0 stern .. 1 bow); kinds from kindFn(i, j, u, a). */
export function hull(B, z0, z1, prof, { K = 28, N = 24, n = 2.6, belly = 0.85, kind = () => CK.HULL, capStart = CK.DARK, capEnd = CK.HULL } = {}) {
  const rings = [];
  for (let j = 0; j <= N; j++) {
    const u = j / N;
    const [w, h, lift = 0] = prof(u);
    rings.push({ z: lerp(z0, z1, u), pts: sectionEllipse(Math.max(w, 0.05), Math.max(h, 0.05), K, n, 0, belly).map(([x, y]) => [x, y + lift]) });
  }
  B.loft(rings, (i, j) => kind(i, j, j / N, (i / K) * TAU), { capStart, capEnd });
}

/** Half-width of a superellipse hull section (exponent n) at angle a. */
export function sectionAt(w, h, a, n = 2.6, belly = 0.85) {
  const c = Math.cos(a), s = Math.sin(a);
  const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * w;
  let y = Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * h;
  if (y < 0) y *= belly;
  return V(x, y, 0);
}

export { CB, CK, TAU };
