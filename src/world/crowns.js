import * as THREE from 'three';
import { loftSections, latheFacade, sweepTube, mergeClean } from './geom.js';

// The crowns of the Outer Wards: seven new arcology families, one to each ward, so every
// ward reads by its silhouette from across the sea.
//   crystal   Aurora      a cluster of faceted crystal shafts with lit edges
//   twin      Tidewater   two towers leaning together into a pointed arch, bridged
//   receiver  Sunward     a fluted shaft carrying the glowing solar receiver and its rays
//   seraph    Seraph      a slender shaft wrapped by three pairs of wings
//   mast      Southmarch  the tallest crown: a tripod mast with the sky-ships' mooring halo
//   coral     Coral Reach a branching staghorn with lit polyps
//   deco      Westmere    a civic tower of setbacks, fins and an arched lantern
// All built in the tower's local frame (y = 0 at the base, 2 m below the ground).

const TAU = Math.PI * 2;

/** Loft with flat facets: each side between consecutive section points is its own strip. */
function facetLoft(sections, { capTop = false, kindTop = 1, edgeKind = null } = {}) {
  const n = sections[0].pts.length;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const pos = [], fac = [], idx = [];
    let u0 = 0;
    for (let j = 0; j < sections.length; j++) {
      const s = sections[j];
      const a = s.pts[i], b = s.pts[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      pos.push(a[0], s.y, a[1], b[0], s.y, b[1]);
      const k = s.kinds ? s.kinds[i] : s.kind ?? 0;
      fac.push(u0 + i * 1000, s.y, k, u0 + i * 1000 + L, s.y, k);
    }
    for (let j = 0; j < sections.length - 1; j++) {
      const a = j * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    orientOut(g);
    parts.push(g);
  }
  if (capTop) {
    const s = sections[sections.length - 1];
    parts.push(capGeo(s.pts, s.y, kindTop));
  }
  void edgeKind;
  return mergeClean(parts);
}

/** Flip a strip if its normals point toward the axis. */
function orientOut(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  let dot = 0;
  for (let i = 0; i < p.count; i++) dot += p.getX(i) * n.getX(i) + p.getZ(i) * n.getZ(i);
  if (dot < 0) {
    const idx = g.index.array;
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
}

function capGeo(pts, y, kind, down = false) {
  const pos = [], fac = [], idx = [];
  const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
  for (const p of pts) { pos.push(p[0], y, p[1]); fac.push(p[0], p[1], kind); }
  for (const [a, b, c] of tris) {
    const pa = pts[a], pb = pts[b], pc = pts[c];
    const cross = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
    if ((cross < 0) !== down) idx.push(a, b, c); else idx.push(a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Axis-aligned box with facade coordinates (u around, v up). */
function boxGeo(x0, x1, y0, y1, z0, z1, kind, topKind = kind) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const p = g.attributes.position, nrm = g.attributes.normal;
  const fac = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const up = Math.abs(nrm.getY(i)) > 0.5;
    fac[i * 3] = up ? p.getX(i) : p.getX(i) + p.getZ(i);
    fac[i * 3 + 1] = up ? p.getZ(i) : p.getY(i);
    fac[i * 3 + 2] = up ? topKind : kind;
  }
  g.setAttribute('aFacade', new THREE.BufferAttribute(fac, 3));
  return g;
}

/** A double-sided curved surface (wings, petals): fn(u, v) -> Vector3, thickness t. */
function bladeGeo(nu, nv, fn, t, kindFront, kindBack) {
  const parts = [];
  for (const side of [1, -1]) {
    const pos = [], fac = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      const p = fn(u, v);
      const du = fn(Math.min(u + 0.01, 1), v).sub(fn(Math.max(u - 0.01, 0), v));
      const dv = fn(u, Math.min(v + 0.01, 1)).sub(fn(u, Math.max(v - 0.01, 0)));
      const n = new THREE.Vector3().crossVectors(du, dv).normalize().multiplyScalar(side * t * 0.5);
      pos.push(p.x + n.x, p.y + n.y, p.z + n.z);
      fac.push(u * 120, v * 40 + p.y * 0.0, side > 0 ? kindFront : kindBack);
    }
    const cols = nu + 1;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * cols + i;
      if (side > 0) idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
      else idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  }
  return mergeClean(parts);
}

const polyN = (n, r, ph = 0, sx = 1, sz = 1) => { const o = []; for (let i = 0; i < n; i++) { const a = ph + (i / n) * TAU; o.push([Math.cos(a) * r * sx, Math.sin(a) * r * sz]); } return o; };

// ------------------------------------------------------------------ crystal --
function crystalTower(t, rnd) {
  const H = t.height, R = t.radius;
  const parts = [];
  const shaft = (cx, cz, h, r0, lean, leanA, ph, glowFrom) => {
    const secs = [];
    const levels = 26;
    for (let j = 0; j <= levels; j++) {
      const v = j / levels;
      const y = v * h * 0.84;
      const r = r0 * (1 + 0.12 * Math.sin(Math.PI * Math.min(v / 0.6, 1))) * (1 - 0.3 * Math.pow(v, 2));
      const tw = ph + v * 0.35;
      const off = lean * y;
      const pts = polyN(6, r, tw).map(([x, z]) => [cx + x + Math.cos(leanA) * off, cz + z + Math.sin(leanA) * off]);
      secs.push({ y, pts, kind: v > glowFrom ? 0 : 0 });
    }
    parts.push(facetLoft(secs));
    // the termination: six facets closing to a point
    const last = secs[secs.length - 1];
    const tipY = h, tipOff = lean * tipY;
    const tip = [cx + Math.cos(leanA) * tipOff, cz + Math.sin(leanA) * tipOff];
    const tsecs = [last, { y: last.y + (tipY - last.y) * 0.55, pts: last.pts.map(([x, z]) => [tip[0] + (x - tip[0]) * 0.5, tip[1] + (z - tip[1]) * 0.5]), kind: 2 }, { y: tipY, pts: last.pts.map(() => [tip[0], tip[1]]), kind: 2 }];
    tsecs[0] = { ...last, kind: 2 };
    parts.push(facetLoft(tsecs));
    // lit edges up the upper shaft (the aurora glow), structural edges below
    for (let i = 0; i < 6; i++) {
      const pts = [];
      for (let j = 0; j <= levels; j++) {
        const s = secs[j];
        pts.push(new THREE.Vector3(s.pts[i][0], s.y, s.pts[i][1]));
      }
      const split = Math.floor(levels * glowFrom);
      parts.push(sweepTube(pts.slice(0, split + 1), () => Math.max(1.2, r0 * 0.035), 5, { kind: 1 }));
      parts.push(sweepTube(pts.slice(split), () => Math.max(1.0, r0 * 0.028), 5, { kind: 2 }));
    }
    return secs;
  };
  const main = shaft(0, 0, H, R * 0.42, 0, 0, rnd() * TAU, 0.55);
  const sats = 4 + Math.floor(rnd() * 2);
  for (let k = 0; k < sats; k++) {
    const a = (k / sats) * TAU + rnd() * 0.4;
    const d = R * (0.66 + rnd() * 0.12);
    shaft(Math.cos(a) * d, Math.sin(a) * d, H * (0.34 + rnd() * 0.34), R * (0.14 + rnd() * 0.07), 0.06 + rnd() * 0.05, a, rnd() * TAU, 0.45);
  }
  // hexagonal stepped plinth with a garden top
  for (let s = 0; s < 3; s++) {
    const r = R * (1.18 - s * 0.1), y0 = -6 + s * 5, y1 = y0 + 5;
    const hex = polyN(6, r, Math.PI / 6);
    parts.push(facetLoft([{ y: y0, pts: hex, kind: 1 }, { y: y1, pts: hex, kind: 1 }], { capTop: true, kindTop: s === 2 ? 3 : 9 }));
  }
  void main;
  return { geo: mergeClean(parts), top: H, collide: (y) => (y < H * 0.8 ? R * 0.48 * (1 - 0.3 * Math.pow(y / H, 2)) : R * 0.2) };
}

// --------------------------------------------------------------------- twin --
function twinTower(t, rnd) {
  const H = t.height, R = t.radius;
  const parts = [];
  const d0 = R * 1.6, rx = R * 0.6, rz = R * 0.44;
  const around = 48, levels = 60;
  const spine = (v, s) => s * d0 * (1 - Math.pow(v, 1.5));
  for (const s of [-1, 1]) {
    const secs = [];
    for (let j = 0; j <= levels; j++) {
      const v = j / levels;
      const y = v * H * 0.9;
      const k = (1 - 0.55 * v) * (1 + 0.25 * Math.exp(-v * 12));
      const cx = spine(v, s);
      const pts = [];
      for (let i = 0; i < around; i++) {
        const a = (i / around) * TAU;
        // a gentle wave in the plan, rolling round as the tower rises (the tide)
        const wv = 1 + 0.035 * Math.sin(4 * a + v * 9 + (s > 0 ? 1.5 : 0));
        pts.push([cx + Math.cos(a) * rx * k * wv, Math.sin(a) * rz * k * wv]);
      }
      secs.push({ y, pts, kind: v > 0.82 ? 2 : 0 });
    }
    parts.push(loftSections(secs, { capTop: false }));
    // tide lines: lit rings every 72 m
    for (let y = 60; y < H * 0.84; y += 72) {
      const v = y / (H * 0.9);
      const k = (1 - 0.55 * v) * (1 + 0.25 * Math.exp(-v * 12));
      const ring = [];
      for (let i = 0; i <= 64; i++) { const a = (i / 64) * TAU; ring.push(new THREE.Vector3(spine(v, s) + Math.cos(a) * (rx * k + 1.4), y, Math.sin(a) * (rz * k + 1.4))); }
      parts.push(sweepTube(ring, () => 1.1, 5, { kind: 2 }));
    }
  }
  // sky bridges at a third, a half and two thirds
  for (const v of [0.3, 0.5, 0.68]) {
    const y = v * H * 0.9;
    const k = (1 - 0.55 * v);
    const x0 = spine(v, -1) + rx * k * 0.8, x1 = spine(v, 1) - rx * k * 0.8;
    if (x1 - x0 < 8) continue;
    parts.push(sweepTube([new THREE.Vector3(x0, y, 0), new THREE.Vector3((x0 + x1) / 2, y + 6, 0), new THREE.Vector3(x1, y, 0)], () => 7, 12, { kind: 0 }));
  }
  // the apex: a pointed arch closing into a spire
  parts.push(latheFacade([{ r: R * 0.34, y: H * 0.86, kind: 2 }, { r: R * 0.2, y: H * 0.93, kind: 2 }, { r: R * 0.06, y: H * 0.98, kind: 1 }, { r: 0.4, y: H * 1.06, kind: 1 }], 24));
  // the plinth: a stadium of water between the two feet
  const plinth = [];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * TAU; const c = Math.cos(a); plinth.push([Math.sign(c) * d0 + Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95]); }
  parts.push(loftSections([{ y: -4, pts: plinth, kind: 5 }, { y: 10, pts: plinth, kind: 5 }, { y: 10.8, pts: plinth.map(([x, z]) => [x * 1.01, z * 1.02]), kind: 1 }], { capTop: false }));
  parts.push(capGeo(plinth.map(([x, z]) => [x * 1.01, z * 1.02]), 10.8, 1));
  const pool = [];
  for (let i = 0; i < 32; i++) { const a = (i / 32) * TAU; pool.push([Math.cos(a) * d0 * 0.55, Math.sin(a) * R * 0.5]); }
  parts.push(loftSections([{ y: 10.8, pts: pool, kind: 1 }, { y: 11.3, pts: pool, kind: 1 }], { capTop: false }));
  parts.push(capGeo(pool, 11.1, 6));
  return { geo: mergeClean(parts), top: H * 1.06, collide: (y) => (y < H * 0.85 ? d0 * (1 - Math.pow(y / (H * 0.9), 1.5)) + rx : R * 0.4) };
}

// ----------------------------------------------------------------- receiver --
function receiverTower(t, rnd) {
  const H = t.height, R = t.radius;
  const parts = [];
  const secs = [];
  const around = 72, levels = 50;
  const shaftTop = H * 0.72;
  for (let j = 0; j <= levels; j++) {
    const v = j / levels;
    const y = v * shaftTop;
    const r = R * (0.3 + 0.32 * (1 - v) + 0.45 * Math.exp(-v * 9));
    const pts = [];
    for (let i = 0; i < around; i++) { const a = (i / around) * TAU; const fl = 1 + 0.045 * Math.cos(24 * a); pts.push([Math.cos(a) * r * fl, Math.sin(a) * r * fl]); }
    secs.push({ y, pts, kind: j % 10 === 0 ? 1 : 0 });
  }
  parts.push(loftSections(secs, { capTop: false }));
  // the receiver: a glowing drum banded in dark metal
  const rr = R * 0.5, y0 = shaftTop, y1 = shaftTop + H * 0.08;
  parts.push(latheFacade([{ r: R * 0.34, y: y0 - 2, kind: 10 }, { r: rr, y: y0 + 4, kind: 10 }, { r: rr, y: y1 - 4, kind: 2 }, { r: R * 0.36, y: y1 + 3, kind: 10 }], 48));
  for (let k = 1; k < 6; k++) {
    const y = y0 + 4 + ((y1 - y0 - 8) * k) / 6;
    const ring = [];
    for (let i = 0; i <= 64; i++) { const a = (i / 64) * TAU; ring.push(new THREE.Vector3(Math.cos(a) * (rr + 0.6), y, Math.sin(a) * (rr + 0.6))); }
    parts.push(sweepTube(ring, () => 0.9, 4, { kind: 10 }));
  }
  // the rays: sixteen blades of solar glass fanning out above the receiver
  const yr = y1 + 6;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    parts.push(bladeGeo(8, 2, (u, v) => {
      const L = R * 0.62;
      const p = dir.clone().multiplyScalar(R * 0.3 + L * u).add(new THREE.Vector3(0, yr + L * 0.55 * u * u + 8 * u, 0));
      return p.addScaledVector(side, (v - 0.5) * 9 * (1 - 0.6 * u));
    }, 1.2, 7, 1));
  }
  parts.push(latheFacade([{ r: R * 0.36, y: y1 + 3, kind: 1 }, { r: R * 0.16, y: yr + 40, kind: 1 }, { r: R * 0.05, y: H * 0.96, kind: 1 }, { r: 0.4, y: H * 1.04, kind: 2 }], 24));
  // sky gardens round the shaft
  for (const v of [0.24, 0.42, 0.58]) {
    const y = v * shaftTop;
    const r = R * (0.3 + 0.32 * (1 - v) + 0.45 * Math.exp(-v * 9));
    parts.push(latheFacade([{ r: 0.1, y: y - 5, kind: 1 }, { r: r + 2, y: y - 5, kind: 1 }, { r: r + 22, y: y - 1, kind: 0 }, { r: r + 22, y: y + 1.5, kind: 1 }, { r: r + 20, y: y + 2, kind: 3 }, { r: 0.1, y: y + 2.2, kind: 3 }], 48));
  }
  // stepped podium
  parts.push(latheFacade([{ r: R * 1.1, y: -6, kind: 1 }, { r: R * 1.1, y: 3, kind: 1 }, { r: R * 1.0, y: 3.2, kind: 9 }, { r: R * 0.98, y: 7, kind: 5 }, { r: R * 0.9, y: 7.2, kind: 3 }, { r: 0.2, y: 7.4, kind: 3 }], 64));
  return { geo: mergeClean(parts), top: H * 1.04, receiver: { y: (y0 + y1) / 2, r: rr }, collide: (y) => (y < shaftTop ? R * (0.62 - 0.32 * y / shaftTop) : R * 0.5) };
}

// ------------------------------------------------------------------- seraph --
function seraphTower(t, rnd) {
  const H = t.height, R = t.radius;
  const parts = [];
  const prof = [];
  for (let j = 0; j <= 40; j++) {
    const v = j / 40;
    prof.push({ r: R * (0.3 - 0.18 * v) * (1 + 0.25 * Math.exp(-v * 14)), y: v * H * 0.94, kind: j % 8 === 0 ? 1 : 0 });
  }
  prof.push({ r: R * 0.1, y: H * 0.96, kind: 2 }, { r: 0.5, y: H * 1.04, kind: 1 });
  parts.push(latheFacade(prof, 48));
  // three pairs of wings: the lowest fold down, the middle spread, the highest rise
  const pairs = [[0.3, -0.35, 0.95, 0], [0.55, 0.05, 1.1, TAU / 6], [0.78, 0.55, 0.85, TAU / 3]];
  for (const [hv, lift, reach, rot] of pairs) {
    for (const sgn of [1, -1]) {
      const a = rot + (sgn > 0 ? 0 : Math.PI);
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const y0 = hv * H;
      const r0 = R * (0.3 - 0.18 * hv) * 0.9;
      const L = R * reach;
      parts.push(bladeGeo(16, 5, (u, v) => {
        const along = r0 + L * Math.sin(u * Math.PI * 0.5);
        const up = L * (lift * u + 0.45 * u * u * Math.sign(lift + 0.2)) + (1 - u) * 0;
        const W = R * 0.55 * Math.pow(Math.sin(Math.PI * Math.min(u * 1.1, 1)), 0.6) + 4;
        const camber = Math.sin(Math.PI * v) * 5 * (1 - u);
        const p = dir.clone().multiplyScalar(along).add(new THREE.Vector3(0, y0 + up + (v - 0.5) * W * 0.9, 0));
        return p.addScaledVector(side, (v - 0.5) * W * 0.25 + camber);
      }, 3.2, 0, 1));
      // a lit feather edge along each wing's leading edge
      const edge = [];
      for (let i = 0; i <= 16; i++) {
        const u = i / 16;
        const along = r0 + L * Math.sin(u * Math.PI * 0.5);
        const up = L * (lift * u + 0.45 * u * u * Math.sign(lift + 0.2));
        const W = R * 0.55 * Math.pow(Math.sin(Math.PI * Math.min(u * 1.1, 1)), 0.6) + 4;
        edge.push(dir.clone().multiplyScalar(along).add(new THREE.Vector3(0, y0 + up + 0.5 * W * 0.9, 0)).addScaledVector(side, 0.5 * W * 0.25));
      }
      parts.push(sweepTube(edge, () => 1.3, 5, { kind: 2 }));
    }
  }
  // a lotus plinth on the crown terrace
  parts.push(latheFacade([{ r: R * 0.62, y: -4, kind: 1 }, { r: R * 0.62, y: 4, kind: 1 }, { r: R * 0.7, y: 6, kind: 3 }, { r: R * 0.55, y: 7, kind: 3 }, { r: 0.1, y: 7.4, kind: 3 }], 48));
  return { geo: mergeClean(parts), top: H * 1.04, collide: (y) => R * (0.32 - 0.18 * y / H) };
}

// --------------------------------------------------------------------- mast --
function mastTower(t, rnd) {
  const H = t.height, R = t.radius;
  const parts = [];
  const secs = [];
  const around = 60, levels = 90;
  for (let j = 0; j <= levels; j++) {
    const v = j / levels;
    const y = v * H * 0.93;
    const r = R * (0.7 - 0.5 * Math.pow(v, 0.8));
    const pts = [];
    for (let i = 0; i < around; i++) { const a = (i / around) * TAU + v * 0.6; const lobe = 1 + 0.12 * Math.cos(3 * a); pts.push([Math.cos(a) * r * lobe, Math.sin(a) * r * lobe]); }
    secs.push({ y, pts, kind: v > 0.9 ? 2 : 0 });
  }
  parts.push(loftSections(secs, { capTop: true, kindTop: 2 }));
  // tripod legs splaying to the podium
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + 0.3;
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const u = i / 16;
      const y = u * H * 0.13;
      const r = R * (1.45 - 0.9 * Math.pow(u, 0.7));
      pts.push(new THREE.Vector3(Math.cos(a) * r, y - 4, Math.sin(a) * r));
    }
    parts.push(sweepTube(pts, (u) => R * (0.16 - 0.08 * u), 14, { kind: 1 }));
  }
  // observation rings
  for (const v of [0.3, 0.5, 0.65, 0.76]) {
    const y = v * H * 0.93;
    const r = R * (0.7 - 0.5 * Math.pow(v, 0.8));
    parts.push(latheFacade([{ r: 0.1, y: y - 7, kind: 1 }, { r: r * 1.1, y: y - 7, kind: 1 }, { r: r * 1.5, y: y - 2, kind: 0 }, { r: r * 1.5, y: y + 1, kind: 2 }, { r: r * 1.35, y: y + 2, kind: 3 }, { r: 0.1, y: y + 2.4, kind: 3 }], 48));
  }
  // the mooring halo, its spokes and docking arms
  const yh = H * 0.86, rh = R * 1.4;
  const halo = [];
  for (let i = 0; i <= 128; i++) { const a = (i / 128) * TAU; halo.push(new THREE.Vector3(Math.cos(a) * rh, yh, Math.sin(a) * rh)); }
  parts.push(sweepTube(halo, () => 7, 12, { kind: 0, ellipse: 0.6 }));
  parts.push(sweepTube(halo.map((p) => p.clone().add(new THREE.Vector3(0, -5.2, 0))), () => 1.2, 6, { kind: 2 }));
  const rAt = (y) => R * (0.7 - 0.5 * Math.pow(y / (H * 0.93), 0.8));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    parts.push(sweepTube([new THREE.Vector3(Math.cos(a) * rAt(yh) * 0.9, yh - 12, Math.sin(a) * rAt(yh) * 0.9), new THREE.Vector3(Math.cos(a) * rh, yh, Math.sin(a) * rh)], () => 2.4, 6, { kind: 1 }));
  }
  const berths = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 6;
    const p0 = new THREE.Vector3(Math.cos(a) * rh, yh, Math.sin(a) * rh), p1 = new THREE.Vector3(Math.cos(a) * (rh + 26), yh + 2, Math.sin(a) * (rh + 26));
    parts.push(sweepTube([p0, p1], () => 3, 8, { kind: 1 }));
    parts.push(latheFacade([{ r: 5, y: -2, kind: 1 }, { r: 5.5, y: 0, kind: 2 }, { r: 4, y: 2, kind: 1 }], 12).translate(p1.x, p1.y, p1.z));
    berths.push({ a, r: rh + 26, y: yh + 2 });
  }
  parts.push(latheFacade([{ r: R * 0.2, y: H * 0.92, kind: 1 }, { r: R * 0.06, y: H * 0.98, kind: 1 }, { r: 0.4, y: H * 1.05, kind: 2 }], 16));
  // podium
  parts.push(latheFacade([{ r: R * 1.6, y: -6, kind: 1 }, { r: R * 1.6, y: 2, kind: 1 }, { r: R * 1.5, y: 2.3, kind: 9 }, { r: R * 1.2, y: 2.4, kind: 9 }, { r: R * 1.18, y: 9, kind: 5 }, { r: R * 1.1, y: 9.3, kind: 3 }, { r: 0.2, y: 9.5, kind: 3 }], 72));
  return { geo: mergeClean(parts), top: H * 1.05, berths, collide: (y) => (y < H * 0.9 ? rAt(y) * 1.1 : R * 0.2) };
}

// -------------------------------------------------------------------- coral --
function coralTower(t, rnd) {
  const H = t.height, R = t.radius;
  const parts = [];
  const trunkTop = H * 0.36;
  const prof = [];
  for (let j = 0; j <= 30; j++) {
    const v = j / 30;
    const r = R * (0.85 + 1.1 * Math.exp(-v * 6) + 0.06 * Math.sin(v * 17 + 1.3));
    prof.push({ r, y: v * trunkTop, kind: j % 6 === 0 ? 1 : 5 });
  }
  prof.push({ r: R * 0.5, y: trunkTop + 30, kind: 5 }, { r: 0.4, y: trunkTop + 34, kind: 1 });
  parts.push(latheFacade(prof, 40));
  const tips = [];
  const branch = (p0, dir, len, r0, depth) => {
    const pts = [p0.clone()];
    const d = dir.clone();
    let p = p0.clone();
    const n = 18;
    for (let i = 1; i <= n; i++) {
      d.add(new THREE.Vector3((rnd() - 0.5) * 0.08, 0.06, (rnd() - 0.5) * 0.08)).normalize();
      p = p.clone().addScaledVector(d, len / n);
      pts.push(p);
    }
    parts.push(sweepTube(pts, (u) => r0 * (1 - 0.45 * u), 12, { kind: 5 }));
    // lit polyp at the tip, habitation pods along the way
    const tip = pts[pts.length - 1];
    parts.push(latheFacade([{ r: 0.2, y: -r0 * 0.9, kind: 1 }, { r: r0 * 0.95, y: -r0 * 0.3, kind: 0 }, { r: r0 * 1.0, y: r0 * 0.4, kind: 2 }, { r: r0 * 0.4, y: r0 * 1.1, kind: 2 }, { r: 0.1, y: r0 * 1.3, kind: 2 }], 16).translate(tip.x, tip.y, tip.z));
    tips.push(tip);
    if (depth < 1 && rnd() < 0.7) {
      const k = Math.floor(n * (0.45 + rnd() * 0.2));
      const nd = d.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (rnd() - 0.5) * 2.2).add(new THREE.Vector3(0, 0.5, 0)).normalize();
      branch(pts[k], nd, len * 0.5, r0 * 0.62, depth + 1);
    }
    for (const u of [0.35, 0.65]) {
      const q = pts[Math.floor(u * n)];
      parts.push(latheFacade([{ r: 0.1, y: -r0 * 0.7, kind: 1 }, { r: r0 * 1.25, y: -r0 * 0.2, kind: 0 }, { r: r0 * 1.2, y: r0 * 0.5, kind: 0 }, { r: 0.1, y: r0 * 1.0, kind: 1 }], 14).translate(q.x, q.y, q.z));
    }
  };
  const nb = 6 + Math.floor(rnd() * 2);
  for (let k = 0; k < nb; k++) {
    const a = (k / nb) * TAU + rnd() * 0.4;
    const y = trunkTop * (0.72 + rnd() * 0.3);
    const out = 0.35 + rnd() * 0.3;
    const dir = new THREE.Vector3(Math.cos(a) * out, 1, Math.sin(a) * out).normalize();
    const r0 = R * (0.42 + rnd() * 0.12);
    const p0 = new THREE.Vector3(Math.cos(a) * R * 0.6, y, Math.sin(a) * R * 0.6);
    branch(p0, dir, (H - y) * (0.7 + rnd() * 0.3), r0, 0);
  }
  // root flare podium
  parts.push(latheFacade([{ r: R * 1.95, y: -6, kind: 1 }, { r: R * 1.95, y: 1, kind: 1 }, { r: R * 1.85, y: 1.3, kind: 3 }, { r: 0.2, y: 1.6, kind: 3 }], 56));
  return { geo: mergeClean(parts), top: H * 1.02, tips, collide: (y) => (y < trunkTop ? R * 1.0 : R * 0.6) };
}

// --------------------------------------------------------------------- deco --
function decoTower(t, rnd) {
  const H = t.height, R = t.radius;
  const parts = [];
  const oct = (hw, ch) => [[hw - ch, -hw], [hw, -hw + ch], [hw, hw - ch], [hw - ch, hw], [-hw + ch, hw], [-hw, hw - ch], [-hw, -hw + ch], [-hw + ch, -hw]];
  const tiers = [[0, 0.32, 0.55], [0.32, 0.56, 0.46], [0.56, 0.74, 0.38], [0.74, 0.86, 0.3]];
  let lastHw = 0;
  for (const [v0, v1, f] of tiers) {
    const hw = R * f, ch = hw * 0.28;
    const y0 = v0 * H, y1 = v1 * H;
    const o = oct(hw, ch);
    parts.push(facetLoft([{ y: y0 - (v0 === 0 ? 6 : 0), pts: o, kind: 0 }, { y: y1, pts: o, kind: 0 }], { capTop: true, kindTop: 3 }));
    // ledge and parapet at every setback
    const ol = oct(hw + 1.6, ch + 0.6);
    parts.push(facetLoft([{ y: y1 - 3, pts: ol, kind: 1 }, { y: y1 + 1.2, pts: ol, kind: 1 }]));
    // fins: five per face, up the whole tier
    for (let fce = 0; fce < 4; fce++) {
      const a = (fce / 4) * TAU;
      const nx = Math.cos(a), nz = Math.sin(a);
      for (let k = -2; k <= 2; k++) {
        const along = (k / 2.5) * (hw - ch);
        const x = nx * (hw + 1.4) - nz * along, z = nz * (hw + 1.4) + nx * along;
        const g = boxGeo(-1.1, 1.1, y0 + 4, y1 - 3, -1.4, 1.4, 1);
        g.rotateY(-a);
        g.translate(x, 0, z);
        parts.push(g);
      }
    }
    lastHw = hw;
  }
  // the lantern: an arcade of tall arches round a lit core
  const y0 = H * 0.86, y1 = H * 0.94;
  const lhw = lastHw * 0.78;
  parts.push(facetLoft([{ y: y0, pts: oct(lhw * 0.7, lhw * 0.2), kind: 2 }, { y: y1, pts: oct(lhw * 0.62, lhw * 0.18), kind: 2 }], { capTop: true, kindTop: 2 }));
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    const arc = [];
    for (let i = 0; i <= 10; i++) {
      const s = i / 10;
      const y = y0 + (y1 - y0) * (s < 0.5 ? s * 1.6 : 0.8 + (s - 0.5) * 0.4);
      arc.push(new THREE.Vector3(Math.cos(a) * lhw, s < 0.5 ? y : y0 + (y1 - y0) * (1.6 - s * 1.2), Math.sin(a) * lhw));
    }
    parts.push(sweepTube([new THREE.Vector3(Math.cos(a) * lhw, y0, Math.sin(a) * lhw), new THREE.Vector3(Math.cos(a) * lhw * 0.9, y1 + 6, Math.sin(a) * lhw * 0.9)], () => 1.6, 6, { kind: 1 }));
    void arc;
  }
  parts.push(latheFacade([{ r: lhw * 1.05, y: y1 + 4, kind: 1 }, { r: lhw * 1.05, y: y1 + 8, kind: 1 }, { r: lhw * 0.5, y: y1 + 20, kind: 1 }, { r: R * 0.05, y: H * 0.99, kind: 1 }, { r: 0.4, y: H * 1.05, kind: 2 }], 16));
  // podium with grand stairs
  parts.push(latheFacade([{ r: R * 1.1, y: -6, kind: 1 }, { r: R * 1.1, y: 1.5, kind: 1 }, { r: R * 1.05, y: 1.7, kind: 9 }, { r: R * 0.95, y: 1.8, kind: 9 }, { r: R * 0.93, y: 10, kind: 5 }, { r: R * 0.85, y: 10.3, kind: 3 }, { r: 0.2, y: 10.5, kind: 3 }], 8, { phase: Math.PI / 8 }));
  return { geo: mergeClean(parts), top: H * 1.05, collide: (y) => (y < H * 0.86 ? R * 0.62 : R * 0.3) };
}

export const CROWN_BUILDERS = { crystal: crystalTower, twin: twinTower, receiver: receiverTower, seraph: seraphTower, mast: mastTower, coral: coralTower, deco: decoTower };
