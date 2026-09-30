import * as THREE from 'three';
import { CK, V3, TAU, lerp, merge, stock, tube, rod, box, bbox, revolve, bell, placeZ } from './lodestarKit.js';
import { hullPt, zOf } from './lodestarHull.js';

// The Lodestar's propulsion hardware (the glowing bells and plumes are space/exhaust.js): a
// thrust structure of ring frames and struts on the stern bulkhead, and for each engine its
// combustion chamber and injector dome, a gimbal ring on two trunnions with its pair of
// actuators, turbopumps with their volutes and the feed lines that run to the injector; the
// reverse-thrust pods on the bow flanks; the RCS quads, each nozzle its own little bell.

export const ZS = zOf(1);                              // the stern bulkhead

/** Engine mounts: position of the throat plane, bell radii and length, main or auxiliary. */
export const ENGINE_MOUNTS = [
  { p: V3(0, 0.05, ZS), rt: 0.55, re: 1.65, len: 3.2, main: true },
  { p: V3(2.9, -0.15, ZS), rt: 0.3, re: 0.82, len: 1.8 },
  { p: V3(-2.9, -0.15, ZS), rt: 0.3, re: 0.82, len: 1.8 },
];
export const THROAT_DZ = 1.45;                         // throat aft of the bulkhead

function engineHardware(e) {
  const g = [], s = e.main ? 1 : 0.55, c = e.p, z0 = ZS, zt = ZS + THROAT_DZ;
  // chamber and injector dome, from the bulkhead to the throat
  g.push(revolve([[0.0, z0 + 0.1, CK.DARK], [0.55 * s, z0 + 0.14, CK.BRONZE], [0.78 * s, z0 + 0.35, CK.BRONZE], [0.8 * s, z0 + 0.55, CK.DARK], [0.8 * s, zt - 0.55 * s, CK.DARK], [0.62 * s, zt - 0.2 * s, CK.DARK], [e.rt + 0.04, zt, CK.DARK], [0.0, zt, CK.DARK]], 28, { cx: c.x, cy: c.y }));
  // cooling-jacket bands on the chamber
  for (let k = 0; k < 4; k++) { const z = lerp(z0 + 0.62, zt - 0.55 * s, k / 3); g.push(revolve([[0.82 * s, z - 0.04, CK.BRONZE], [0.84 * s, z, CK.BRONZE], [0.82 * s, z + 0.04, CK.BRONZE]], 24, { closed: true, cx: c.x, cy: c.y })); }
  // gimbal ring on two trunnions (horizontal axis), a yoke to the bulkhead, and two actuators
  const zg = zt - 0.35 * s, Rg = e.re * 0.62 + 0.15;
  g.push(stock(new THREE.TorusGeometry(Rg, 0.07 * s + 0.03, 8, 36), CK.BRONZE).translate(c.x, c.y, zg));
  for (const sx of [1, -1]) {
    g.push(stock(new THREE.CylinderGeometry(0.09 * s + 0.03, 0.09 * s + 0.03, 0.3, 10), CK.DARK).rotateZ(Math.PI / 2).translate(c.x + sx * (Rg + 0.12), c.y, zg));
    g.push(rod(V3(c.x + sx * (Rg + 0.2), c.y, zg), V3(c.x + sx * (Rg + 0.35), c.y + 0.1, z0 + 0.1), 0.06 * s + 0.02, CK.DARK, 8));
  }
  for (const [ax, ay] of [[0.7, 0.7], [-0.7, -0.7]]) {
    const pA = V3(c.x + ax * (Rg + 0.5 * s), c.y + ay * (Rg + 0.5 * s), z0 + 0.12), pB = V3(c.x + ax * Rg * 0.72, c.y + ay * Rg * 0.72, zg);
    const mid = pA.clone().lerp(pB, 0.55);
    g.push(rod(pA, mid, 0.08 * s + 0.02, CK.DARK, 10), rod(mid, pB, 0.04 * s + 0.015, CK.BRONZE, 8));
    g.push(bbox(0.2 * s + 0.08, 0.2 * s + 0.08, 0.12, 0.02, CK.DARK, pA.clone().add(V3(0, 0, -0.04))));
  }
  // turbopumps: a body with a volute and a turbine exhaust stub, feed lines to the injector
  const pumps = e.main ? [[1, 1], [-1, 1]] : [[Math.sign(c.x), 1]];
  for (const [px, py] of pumps) {
    const P = V3(c.x + px * (1.25 * s + 0.2), c.y + py * 0.55 * s, z0 + 0.55);
    g.push(revolve([[0.0, -0.3 * s, CK.DARK], [0.22 * s, -0.3 * s, CK.DARK], [0.26 * s, -0.1 * s, CK.BRONZE], [0.26 * s, 0.25 * s, CK.DARK], [0.16 * s, 0.4 * s, CK.DARK], [0.0, 0.42 * s, CK.DARK]], 16, { cx: P.x, cy: P.y }).translate(0, 0, P.z));
    g.push(stock(new THREE.TorusGeometry(0.28 * s, 0.09 * s, 8, 20), CK.BRONZE).translate(P.x, P.y, P.z - 0.08 * s));
    g.push(tube([P.clone().add(V3(0, 0.25 * s, 0)), P.clone().add(V3(-px * 0.2 * s, 0.6 * s, 0.1)), V3(c.x + px * 0.35 * s, c.y + 0.5 * s, z0 + 0.2)], 0.07 * s + 0.02, CK.BRONZE, 8, 3));
    g.push(tube([P.clone().add(V3(0, -0.25 * s, 0.1)), P.clone().add(V3(px * 0.1, -0.5 * s, 0.4)), V3(c.x + px * 0.5 * s, c.y - 0.5 * s, zt - 0.7 * s)], 0.05 * s + 0.02, CK.DARK, 8, 3));
    g.push(rod(P.clone().add(V3(0, 0, 0.3 * s)), P.clone().add(V3(px * 0.1, 0, 0.9 * s)), 0.06 * s + 0.02, CK.DARK, 8));
    // propellant feed from the bulkhead
    g.push(tube([V3(P.x, P.y + 0.1, z0 - 0.05), V3(P.x, P.y + 0.1, z0 + 0.2), P.clone().add(V3(0, 0.1, -0.2))], 0.06 * s + 0.03, CK.BRONZE, 8, 3));
  }
  return g;
}

/** Stern bulkhead thrust structure: a ring frame per engine, beams between them, a shroud. */
function thrustStructure() {
  const g = [];
  // an aft skirt over the bulkhead edge
  const ring = [];
  for (let i = 0; i < 64; i++) ring.push(hullPt(0.999, Math.PI / 2 + (i / 64) * TAU, 0.02));
  const inner = ring.map((p) => V3(p.x * 0.93, p.y * 0.9, p.z + 0.35));
  const outer = ring.map((p) => V3(p.x, p.y, p.z + 0.35));
  const rings = [ring, outer, inner, ring.map((p) => V3(p.x * 0.93, p.y * 0.9, p.z))];
  g.push(...rings.slice(0, 1).map(() => loftSkirt(rings)));
  for (const e of ENGINE_MOUNTS) {
    const R = (e.main ? 1.15 : 0.62) + 0.25;
    g.push(revolve([[R + 0.12, ZS, CK.DARK], [R + 0.12, ZS + 0.28, CK.DARK], [R - 0.1, ZS + 0.28, CK.DARK], [R - 0.1, ZS, CK.DARK]], 36, { closed: true, cx: e.p.x, cy: e.p.y }));
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.push(bbox(0.08, 0.2, 0.25, 0.02, CK.BRONZE, V3(e.p.x + Math.cos(a) * (R + 0.14), e.p.y + Math.sin(a) * (R + 0.14), ZS + 0.14), new THREE.Euler(0, 0, a))); }
  }
  // cross beams between the engine frames
  for (const sx of [1, -1]) {
    g.push(bbox(1.3, 0.22, 0.26, 0.04, CK.DARK, V3(sx * 1.85, -0.05, ZS + 0.14)));
    g.push(rod(V3(sx * 1.2, 1.1, ZS + 0.05), V3(sx * 2.7, 0.45, ZS + 0.05), 0.07, CK.DARK, 8));
    g.push(rod(V3(sx * 1.2, -0.9, ZS + 0.05), V3(sx * 2.7, -0.75, ZS + 0.05), 0.07, CK.DARK, 8));
  }
  // service panels and a stern lamp housing
  for (const [x, y] of [[0, 1.35], [4.0, 0.1], [-4.0, 0.1]]) g.push(bbox(0.8, 0.4, 0.12, 0.04, CK.HULL, V3(x, y, ZS + 0.06)));
  return g;
}
function loftSkirt(rings) {
  // four rings: bulkhead edge -> skirt lip -> inner lip -> bulkhead inner: a hollow collar
  const pos = [], fac = [], idx = [], n = rings[0].length, W = n + 1;
  rings.forEach((r, j) => { for (let i = 0; i <= n; i++) { const p = r[i % n]; pos.push(p.x, p.y, p.z); fac.push(i * 0.3, j * 0.6, j === 0 || j === 3 ? CK.DARK : CK.BRONZE); } });
  for (let j = 0; j < 3; j++) for (let i = 0; i < n; i++) { const a = j * W + i, b = a + 1, c = a + W + 1, d = a + W; idx.push(a, b, c, a, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Reverse pods on the bow flanks: returns geometry and the mounts (nozzle exit, side). */
function reversePods() {
  const g = [], mounts = [];
  for (const side of [1, -1]) {
    const c = hullPt(0.36, side > 0 ? -0.18 : Math.PI + 0.18, 0.55), z0 = c.z - 1.1;
    g.push(revolve([[0, 0, CK.DARK], [0.3, 0.06, CK.DARK], [0.46, 0.3, CK.BRONZE], [0.5, 0.5, CK.BRONZE], [0.5, 0.55, CK.HULL], [0.5, 1.15, CK.HULL], [0.52, 1.15, CK.DARK], [0.52, 1.25, CK.DARK], [0.5, 1.25, CK.HULL],
      [0.5, 1.9, CK.HULL], [0.44, 2.3, CK.BRONZE], [0.3, 2.45, CK.DARK], [0.2, 2.5, CK.DARK], [0, 2.5, CK.DARK]], 28, { cx: c.x, cy: c.y }).translate(0, 0, z0));
    // the pylon onto the hull with a fairing, a feed line, access panel and a small intake grille
    g.push(bbox(0.55, 0.2, 1.7, 0.06, CK.DARK, V3(c.x - side * 0.36, c.y, z0 + 1.2)));
    g.push(tube([V3(c.x - side * 0.6, c.y + 0.08, z0 + 2.4), V3(c.x - side * 0.2, c.y + 0.28, z0 + 2.2), V3(c.x, c.y + 0.4, z0 + 1.6)], 0.05, CK.BRONZE, 8, 3));
    for (let k = 0; k < 5; k++) g.push(box(0.04, 0.16, 0.34, CK.DARK, V3(c.x + side * 0.5, c.y + 0.02, z0 + 0.7 + k * 0.09)));
    g.push(bbox(0.02, 0.3, 0.5, 0.01, CK.HULL, V3(c.x + side * 0.5, c.y - 0.18, z0 + 1.6), new THREE.Euler(0, 0, 0)));
    mounts.push({ p: V3(c.x, c.y, z0), side });
  }
  return { g, mounts };
}

/** RCS quads: a housing with four nozzles; returns geometry and the nozzle list (exit points, directions). */
function rcsQuads() {
  const g = [], nozzles = [];
  for (const [t, a] of [[0.2, 0], [0.2, Math.PI], [0.88, 0.25], [0.88, Math.PI - 0.25]]) {
    const c = hullPt(t, a, 0.25), sx = Math.sign(c.x);
    g.push(bbox(0.6, 0.6, 0.85, 0.08, CK.DARK, c.clone()));
    g.push(bbox(0.64, 0.12, 0.89, 0.03, CK.BRONZE, c.clone().add(V3(0, 0.0, 0))));
    // a heat-blackened collar and a bell for each nozzle
    for (const d of [V3(0, 1, 0), V3(0, -1, 0), V3(sx, 0, 0), V3(0, 0, t < 0.5 ? -1 : 1)]) {
      const base = c.clone().addScaledVector(d, d.z ? 0.42 : 0.3);
      g.push(placeZ(stock(new THREE.CylinderGeometry(0.13, 0.15, 0.06, 12), CK.BRONZE).rotateX(Math.PI / 2), base, d));
      g.push(placeZ(bell(0.045, 0.12, 0.22, CK.DARK, CK.BRONZE, 14), base.clone().addScaledVector(d, 0.02), d));
      nozzles.push({ p: c.clone().addScaledVector(d, (d.z ? 0.42 : 0.3) + 0.25), r: 0.3, dir: d.clone() });
    }
  }
  return { g, nozzles };
}

/** Everything: { geo: [..], reverseMounts, rcs } */
export function buildDrive() {
  const geo = [];
  geo.push(...thrustStructure());
  for (const e of ENGINE_MOUNTS) geo.push(...engineHardware(e));
  const rp = reversePods(); geo.push(...rp.g);
  const rq = rcsQuads(); geo.push(...rq.g);
  return { geo, reverseMounts: rp.mounts, rcs: rq.nozzles };
}
void merge;
