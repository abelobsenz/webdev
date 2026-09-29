import * as THREE from 'three';
import { CK } from '../craft/craftGeometry.js';
import { V, rng, rcsQuad } from './shipKit.js';
import { DK } from './craftMesh.js';

// Station-scale hull dressing for the low-orbit stations (metres, the builder's current frame,
// modules along local z). From a station's default framing a pixel is one to two metres, and a
// smooth lathed module read as a white rod: what gives a pressurised hull its structure at that
// scale is the plating's relief and the kit bolted to it. This lays, on a cylinder of radius r
// between z0 and z1:
//
//   frames     raised circumferential frames every `pitch` metres, a bronze cap on each, and
//              the plating between them split into curved shield panels of two tones, a few
//              stood proud (debris shields) and a few replaced in foil or livery
//   stringers  longitudinal ribs between the frames on a regular count round the hull
//   windows    lit window bays set into the plating (glazing with a dark reveal and a hood)
//   kit        RCS quads, antenna stubs, handrail runs, stowed floodlights, grapple fixtures,
//              service hatches, small radiator pods; every piece faces out along the normal
//
// Everything is placed by radial frames (x tangential, y out, z along), so the dressing follows
// any module the caller has pushed a frame for. Deterministic per seed.

const TAU = Math.PI * 2;
const _m = new THREE.Matrix4();

/** Push a frame on the cylinder at angle a, radius r, axial z: x tangential, y outward, z along. */
export function onHull(B, a, r, z) {
  const c = Math.cos(a), s = Math.sin(a);
  return B.push(_m.set(-s, c, 0, c * r, c, s, 0, s * r, 0, 0, 1, z, 0, 0, 0, 1).clone());
}

/** A curved plate of the hull: radius r (outer face), angles a0..a1, z0..z1, thickness t. */
export function hullPlate(B, r, a0, a1, z0, z1, t, k, na = 4) {
  const base = B.pos.length / 3;
  const ring = (rr) => {
    for (let j = 0; j <= 1; j++) for (let i = 0; i <= na; i++) {
      const a = a0 + ((a1 - a0) * i) / na, z = j ? z1 : z0;
      B.v(Math.cos(a) * rr, Math.sin(a) * rr, z, a * rr, z, k);
    }
  };
  ring(r); ring(r - t);
  const h = new THREE.Vector3();
  const W = na + 1;
  for (let i = 0; i < na; i++) {
    const am = a0 + ((a1 - a0) * (i + 0.5)) / na;
    // outer face
    h.set(Math.cos(am), Math.sin(am), 0);
    const a = base + i, b = a + 1, c = a + W, d = c + 1;
    B.tri(a, b, d, h); B.tri(a, d, c, h);
  }
  // the plate's four edges (its thickness catches the light and the shadow)
  const o = base, n = base + 2 * W;
  const edge = (p0, p1, q0, q1, hx, hy, hz) => { h.set(hx, hy, hz); B.tri(p0, p1, q1, h); B.tri(p0, q1, q0, h); };
  for (let i = 0; i < na; i++) {
    edge(o + i, o + i + 1, n + i, n + i + 1, 0, 0, -1);
    edge(o + W + i, o + W + i + 1, n + W + i, n + W + i + 1, 0, 0, 1);
  }
  edge(o, o + W, n, n + W, Math.sin(a0), -Math.cos(a0), 0);
  edge(o + na, o + W + na, n + na, n + W + na, -Math.sin(a1), Math.cos(a1), 0);
}

/**
 * Dress a cylindrical module (radius r, z0..z1, local z) in the current frame.
 * opts: pitch (frame spacing), stringers (count round), windows (0..1 share of bays with a lit
 * window bay), kit (pieces per 1,000 m2), shield (share of panels stood proud), foil (share
 * replaced in foil), skip (fn(a, z) true where the hull must stay clear: docks, spokes),
 * lamps (array for the floodlights), seed.
 */
export function moduleDressing(B, r, z0, z1, opts = {}) {
  const {
    pitch = Math.max(4, r * 0.55), stringers = Math.max(8, Math.round((TAU * r) / 7)), windows = 0.25, kit = 5,
    shield = 0.18, foil = 0.08, skip = null, lamps = null, seed = 1, frameK = CK.BRONZE, plateK = DK.GRIME,
  } = opts;
  const rnd = rng(seed);
  const len = z1 - z0;
  if (len <= pitch * 0.8 || r < 2) return;
  const nz = Math.max(1, Math.round(len / pitch)), dz = len / nz;
  const na = stringers, da = TAU / na;
  const t = Math.max(0.08, r * 0.012);
  const fw = Math.max(0.5, r * 0.04), fh = Math.max(0.25, r * 0.02);
  const segF = Math.min(96, Math.max(16, Math.round(na * 1.5)));
  // frames: a raised band at every station along the module, capped in bronze
  for (let j = 0; j <= nz; j++) {
    const z = z0 + j * dz;
    B.push(new THREE.Matrix4().makeTranslation(0, 0, z));
    B.lathe([[r - 0.02, -fw, frameK], [r + fh, -fw * 0.7, frameK], [r + fh, fw * 0.7, frameK], [r - 0.02, fw, frameK]], segF, 0, { closedProfile: true });
    B.pop();
  }
  // panels between frames and stringers: most flush (the lathed hull shows), some proud
  for (let j = 0; j < nz; j++) for (let i = 0; i < na; i++) {
    const a0 = i * da, a1 = a0 + da, zA = z0 + j * dz, zB = zA + dz;
    const am = (a0 + a1) / 2, zm = (zA + zB) / 2;
    if (skip && skip(am, zm)) continue;
    const h = rnd();
    if (h < shield) hullPlate(B, r + t * 2.2, a0 + da * 0.06, a1 - da * 0.06, zA + dz * 0.08, zB - dz * 0.08, t * 1.6, h < shield * 0.5 ? plateK : DK.LIVERY, 3);
    else if (h < shield + foil) hullPlate(B, r + t * 1.2, a0 + da * 0.1, a1 - da * 0.1, zA + dz * 0.12, zB - dz * 0.12, t, DK.FOIL, 3);
    else if (h < shield + foil + windows) {
      // a window bay: glazing set in a dark reveal under a small hood
      onHull(B, am, r, zm);
      const w = Math.min(TAU * r / na * 0.62, 14), hgt = Math.min(dz * 0.5, 9);
      B.box(0, 0.05, 0, w + 0.8, 0.3, hgt + 0.8, CK.DARK);
      B.box(0, 0.22, 0, w, 0.12, hgt, CK.GLASS);
      B.box(0, 0.5, hgt / 2 + 0.5, w + 1.2, 0.5, 0.8, frameK);
      B.pop();
    }
  }
  // stringers: longitudinal ribs over the plating
  for (let i = 0; i < na; i += 2) {
    const a = i * da;
    if (skip && skip(a, (z0 + z1) / 2)) continue;
    onHull(B, a, r, (z0 + z1) / 2);
    B.box(0, t * 1.2, 0, t * 3, t * 2.4, len, CK.DARK);
    B.pop();
  }
  // kit, scattered by area
  const area = TAU * r * len;
  const n = Math.max(2, Math.round((area / 1000) * kit));
  for (let q = 0; q < n; q++) {
    const a = rnd() * TAU, z = z0 + dz * 0.3 + rnd() * (len - dz * 0.6), type = rnd();
    if (skip && skip(a, z)) continue;
    onHull(B, a, r + t * 2.4, z);
    const s = Math.max(0.8, Math.min(r * 0.06, 2.4));
    if (type < 0.18) {
      rcsQuad(B, V(0, 0, 0), V(0, 1, 0), V(0, 0, 1), s);
    } else if (type < 0.34) {
      // antenna stub or whip on a base
      B.box(0, 0.2 * s, 0, 1.4 * s, 0.4 * s, 1.4 * s, CK.DARK);
      B.tube([V(0, 0.4 * s, 0), V(0, (2.5 + 3 * rnd()) * s, 0)], 0.08 * s, 4, CK.BRONZE);
    } else if (type < 0.5) {
      // handrail run along the hull on stand-offs
      const L = (3 + rnd() * 6) * s;
      B.box(0, 0.5 * s, 0, 0.1 * s, 0.1 * s, L, CK.BRONZE);
      for (let e = -1; e <= 1; e += 2) B.box(0, 0.25 * s, e * L / 2, 0.08 * s, 0.5 * s, 0.08 * s, CK.BRONZE);
    } else if (type < 0.64) {
      // service hatch: a framed door, proud of the plate
      B.box(0, 0.1 * s, 0, 2.4 * s, 0.2 * s, 2.0 * s, frameK);
      B.box(0, 0.18 * s, 0, 1.9 * s, 0.14 * s, 1.5 * s, CK.DARK);
    } else if (type < 0.76) {
      // grapple fixture: a squat drum with a pin
      B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      B.lathe([[0.9 * s, 0, CK.DARK], [0.9 * s, 0.6 * s, CK.BRONZE], [0.3 * s, 0.7 * s, CK.BRONZE], [0.3 * s, 1.4 * s, CK.DARK]], 10, 0);
      B.pop();
    } else if (type < 0.88) {
      // floodlight on a bracket, aimed along the hull
      B.box(0, 0.4 * s, 0, 0.5 * s, 0.8 * s, 0.5 * s, CK.DARK);
      B.box(0, 0.9 * s, 0.25 * s, 0.9 * s, 0.5 * s, 0.4 * s, CK.LANTERN);
      if (lamps) { const p = V(0, 1.0 * s, 0.5 * s).applyMatrix4(B.M); lamps.push({ p, r: 0.5 * s, color: [1.0, 0.88, 0.7], i: 1.8 }); }
    } else {
      // a small radiator pod: fins standing off the hull, edge-on along it
      for (let f = -1; f <= 1; f++) B.box(f * 0.8 * s, 1.4 * s, 0, 0.14 * s, 2.4 * s, 4 * s, CK.DARK);         // (dark fins: the big radiator wings keep the radiator finish)
      B.box(0, 0.2 * s, 0, 2.2 * s, 0.4 * s, 4.4 * s, CK.DARK);
    }
    B.pop();
  }
}

/**
 * Dress a sphere or dome (radius r, the current frame, poles on z) with latitude frames and
 * meridian ribs, and shield panels on the lower latitudes: the geodesic look of a glazed or
 * plated sphere from a kilometre. lat0..lat1 in radians (-PI/2..PI/2).
 */
export function sphereDressing(B, r, { lat0 = -1.2, lat1 = 1.2, rings = 6, ribs = 16, k = CK.BRONZE, t = 0.6 } = {}) {
  for (let i = 0; i <= rings; i++) {
    const la = lat0 + ((lat1 - lat0) * i) / rings;
    const rr = Math.cos(la) * (r + t), z = Math.sin(la) * (r + t);
    B.push(new THREE.Matrix4().makeTranslation(0, 0, z));
    B.torus(rr, t, Math.max(24, ribs * 3), 4, k);
    B.pop();
  }
  for (let j = 0; j < ribs; j++) {
    const a = (j / ribs) * TAU, pts = [];
    for (let i = 0; i <= 12; i++) {
      const la = lat0 + ((lat1 - lat0) * i) / 12;
      pts.push(V(Math.cos(a) * Math.cos(la) * (r + t), Math.sin(a) * Math.cos(la) * (r + t), Math.sin(la) * (r + t)));
    }
    B.tube(pts, t * 0.8, 4, k);
  }
}

/**
 * A torus about local z (ring radius R, tube r) with the facade kind chosen per quad by the ring
 * angle a and the tube angle b (0 outward, PI/2 toward +z): segmented habitat rings, a module
 * of plated decks with a glazed band, a bronze frame between modules, instead of one glass tube.
 */
export function torusKinds(B, R, r, segR, segT, kindFn) {
  const h = new THREE.Vector3();
  for (let i = 0; i < segR; i++) {
    const a0 = (i / segR) * TAU, a1 = ((i + 1) / segR) * TAU, am = (a0 + a1) / 2;
    for (let j = 0; j < segT; j++) {
      const b0 = (j / segT) * TAU, b1 = ((j + 1) / segT) * TAU, bm = (b0 + b1) / 2;
      const k = kindFn(am, bm);
      const P = (a, b) => { const rr = R + r * Math.cos(b); return B.v(Math.cos(a) * rr, Math.sin(a) * rr, r * Math.sin(b), a * R, b * r, k); };
      const p00 = P(a0, b0), p10 = P(a1, b0), p01 = P(a0, b1), p11 = P(a1, b1);
      h.set(Math.cos(am) * Math.cos(bm), Math.sin(am) * Math.cos(bm), Math.sin(bm));
      B.tri(p00, p10, p11, h); B.tri(p00, p11, p01, h);
    }
  }
}

/** The kinds of a segmented habitat ring of n modules: frames, a glazed band on one face, plated decks. */
export function ringModuleKinds(n, { glassAt = 0, glassW = 0.55, frame = 0.07 } = {}) {
  return (a, b) => {
    const u = (a / TAU) * n, f = u - Math.floor(u);
    if (f < frame) return CK.BRONZE;
    const d = Math.abs(((b - glassAt + Math.PI) % TAU + TAU) % TAU - Math.PI);
    if (d < glassW) return CK.GLASS;
    return Math.floor(u) % 3 === 1 ? DK.LIVERY : DK.PORTS;
  };
}
