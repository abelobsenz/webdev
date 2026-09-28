import * as THREE from 'three';
import { latheFacade, sweepTube, mergeClean } from './geom.js';
import { extrudeAlong, frameAt, maglevStation, deckPortal } from './infrastructure.js';
import { createFacadeMaterial } from './facade.js';
import { terrainHeight } from './terrain.js';

// The bridges of Greater Meridian: a promenade deck and a maglev from the atoll rim to each
// ward (and from Tidewater on to Sunward), each bridge its own structure:
//   Aurora      cable-stayed from two faceted crystal pylons
//   Tidewater   a viaduct of stone arches, the Aqueduct of Tides
//   Sunward     a suspension span between towers crowned with golden sun rings
//   Seraph      three tied arches rising over a garden deck
//   Southmarch  the Grand Crossing: three towers of a continuous suspension bridge
//   Coral Reach a deck carried on branching coral piers
//   Westmere    extradosed: a colonnade of low twin pylons with harp stays
// Every bridge lands on a bridgehead podium on the rim (or on a ward's landing), with the
// lagoon's seed-pod maglev station at both ends, lamps along its hedges, and the maglev
// tube held beside the deck on brackets, swinging out on columns into the stations.

const TAU = Math.PI * 2;
const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const STYLE = { aurora: 'stayed', tidewater: 'arches', sunward: 'suspension', seraph: 'tiedArch', southmarch: 'grand', coral: 'lotus', westmere: 'extradosed' };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// the promenade deck (the lagoon's section): sculpted parapets with a glowing crest, hedges,
// and the paved walkway (kind 15, facade v = metres across)
const DECK = [
  [-14.0, 0.0, 1], [-14.5, 1.2, 1], [-14.5, 1.2, 2], [-13.6, 1.4, 2], [-13.6, 1.4, 1], [-13.0, 0.75, 1],
  [-13.0, 0.75, 3], [-12.8, 1.45, 3], [-11.8, 1.62, 3], [-10.85, 1.45, 3], [-10.6, 0.75, 3], [-10.6, 0.75, 1], [-10.4, 0.2, 1],
  [-10.4, 0.2, 15], [10.4, 0.2, 15],
  [10.4, 0.2, 1], [10.6, 0.75, 1], [10.6, 0.75, 3], [10.85, 1.45, 3], [11.8, 1.62, 3], [12.8, 1.45, 3], [13.0, 0.75, 3],
  [13.0, 0.75, 1], [13.6, 1.4, 1], [13.6, 1.4, 2], [14.5, 1.2, 2], [14.5, 1.2, 1], [14.0, 0.0, 1],
  [11.0, -3.2, 1], [-11.0, -3.2, 1],
];

/** Closed cap of the deck section at a path end (so no hollow end shows). */
function deckCap(path, i, flip) {
  const p = path[i];
  const { side } = frameAt(path, i);
  const up = V(0, 1, 0);
  const pts = DECK.map(([s, u]) => [s, u]);
  const uniq = [];
  for (const q of pts) { const l = uniq[uniq.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-3) uniq.push(q); }
  const tris = THREE.ShapeUtils.triangulateShape(uniq.map((q) => new THREE.Vector2(q[0], q[1])), []);
  const pos = [], fac = [], idx = [];
  for (const [s, u] of uniq) { const w = p.clone().addScaledVector(side, s).addScaledVector(up, u); pos.push(w.x, w.y, w.z); fac.push(s, u, 1); }
  for (const [a, b, c] of tris) idx.push(a, flip ? c : b, flip ? b : c);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // face away from the deck
  const n = g.attributes.normal;
  const t = frameAt(path, i).t;
  const out = flip ? 1 : -1;
  if ((n.getX(0) * t.x + n.getZ(0) * t.z) * out < 0) { for (let k = 0; k < idx.length; k += 3) { const q = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = q; } g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

/** Path sampler by arc fraction. */
function sampler(path) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1]));
  const L = cum[cum.length - 1];
  return {
    L,
    at(u) {
      const s = Math.min(Math.max(u, 0), 1) * L;
      let i = 1;
      while (i < path.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-6);
      const p = path[i - 1].clone().lerp(path[i], t);
      const tan = path[i].clone().sub(path[i - 1]).setY(0).normalize();
      const side = V(-tan.z, 0, tan.x);
      return { p, t: tan, side };
    },
  };
}

/** A lathe profile closed with a flat top (a duplicated rim ring keeps the edge crisp). */
const capTop = (prof) => { const l = prof[prof.length - 1]; return [...prof, { r: l.r, y: l.y, kind: l.kind }, { r: 0, y: l.y, kind: l.kind }]; };

const seaFloor = (x, z) => Math.max(terrainHeight(x, z), -30);
const waterOrGround = (x, z, ground) => Math.max(ground(x, z), 0);

// ------------------------------------------------------------------- parts --
function pierLotus(parts, p, base) {
  parts.push(latheFacade([
    { r: 7.5, y: base - 18, kind: 1 }, { r: 6.2, y: base + 0.5, kind: 1 }, { r: 4.2, y: base + (p.y - base) * 0.55, kind: 1 },
    { r: 5.6, y: p.y - 7.5, kind: 1 }, { r: 12.5, y: p.y - 3.4, kind: 1 }, { r: 12.5, y: p.y - 2.9, kind: 5 },
  ].flatMap((q, i, a) => (i === a.length - 1 ? capTop([q]) : [q])), 16).translate(p.x, 0, p.z));
}
function pierStone(parts, p, base, t) {
  // a pier with pointed cutwaters, battered, with a string course under the deck
  const g = latheFacade([
    { r: 9.5, y: base - 18, kind: 1 }, { r: 8.5, y: base + 2, kind: 1 }, { r: 6.4, y: p.y - 9, kind: 5 }, { r: 7.2, y: p.y - 8, kind: 1 }, { r: 7.2, y: p.y - 2.9, kind: 1 },
  ].flatMap((q, i, a) => (i === a.length - 1 ? capTop([q]) : [q])), 12, { sx: 1.75, sz: 0.62 });
  g.rotateY(-Math.atan2(t.x, -t.z));
  parts.push(g.translate(p.x, 0, p.z));
}
function pierCoral(parts, p, base, t, side, rnd) {
  const trunkTop = base + (p.y - base) * 0.45;
  parts.push(latheFacade([{ r: 8, y: base - 16, kind: 1 }, { r: 6.5, y: base + 0.5, kind: 1 }, { r: 4.5, y: trunkTop, kind: 1 }], 14).translate(p.x, 0, p.z));
  for (const [ls, la] of [[-9, -8], [0, 9], [9, -6]]) {
    const top = p.clone().addScaledVector(side, ls).addScaledVector(t, la).add(V(0, -3.3, 0));
    const mid = V(p.x, trunkTop, p.z).lerp(top, 0.5).add(V(0, 4, 0));
    parts.push(sweepTube([V(p.x, trunkTop - 2, p.z), mid, top], (u) => 3.4 - 1.6 * u, 10, { kind: 1 }));
    parts.push(latheFacade([{ r: 0.2, y: -2.2, kind: 1 }, { r: 3.6, y: -0.6, kind: 1 }, { r: 3.0, y: 0.3, kind: 2 }, { r: 0.1, y: 0.8, kind: 2 }], 10).translate(top.x, top.y - 0.4, top.z));
  }
  void rnd;
}

function stays(parts, from, to, r = 0.32) { parts.push(sweepTube([from, to], () => r, 6, { kind: 10 })); }

function catenary(parts, a, b, sag, lat, side, n = 60, r = 0.9) {
  // cable from a to b (Vector3), sagging `sag` metres, at lateral offset along side
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p.addScaledVector(side, 0));
  }
  parts.push(sweepTube(pts, () => r, 8, { kind: 10 }));
  void lat;
  return pts;
}

// ---------------------------------------------------------------- styles --
function styleStayed(parts, S, ground, colliders) {
  const towers = [0.3, 0.7];
  for (const u of towers) {
    const { p, t, side } = S.at(u);
    const base = seaFloor(p.x, p.z);
    const H = 150;
    // inverted Y: two legs outside the deck merging above it, a faceted spire above
    const apex = p.clone().add(V(0, 62, 0));
    for (const s of [-1, 1]) {
      const foot = p.clone().addScaledVector(side, s * 19).setY(base - 4);
      const knee = p.clone().addScaledVector(side, s * 17.5).setY(p.y - 4);
      parts.push(sweepTube([foot, knee, apex], (q) => 4.2 - 1.6 * q, 6, { kind: 1 }));
    }
    const spire = latheFacade([{ r: 5.8, y: 0, kind: 1 }, { r: 4.6, y: H * 0.45, kind: 0 }, { r: 3.4, y: H * 0.8, kind: 2 }, { r: 0.4, y: H - 62 + 12, kind: 2 }], 6);
    spire.rotateY(-Math.atan2(t.z, t.x));
    parts.push(spire.translate(apex.x, apex.y, apex.z));
    parts.push(latheFacade(capTop([{ r: 12, y: base - 20, kind: 1 }, { r: 10, y: base + 3, kind: 1 }, { r: 10, y: base + 4, kind: 1 }]), 12, { sx: 1.9, sz: 0.8 }).rotateY(-Math.atan2(side.z, side.x)).translate(p.x, 0, p.z));
    colliders.push({ x: p.x, z: p.z, y0: base, y1: p.y + H + 12, radius: 26 });
    // fans of stays to both deck edges, fore and aft
    for (let k = 1; k <= 12; k++) {
      const hy = apex.y + 18 + k * 5.2;
      const head = apex.clone().setY(hy);
      for (const dir of [-1, 1]) {
        const du = (dir * (40 + k * 24)) / S.L;
        const q = S.at(u + du);
        for (const s of [-1, 1]) stays(parts, head.clone().addScaledVector(side, s * 1.5), q.p.clone().addScaledVector(q.side, s * 13.8).add(V(0, 0.6, 0)));
      }
    }
  }
  return { free: [[0.3 - 330 / S.L, 0.3 + 330 / S.L], [0.7 - 330 / S.L, 0.7 + 330 / S.L], [0.3, 0.7]], pier: pierLotus, towers };
}

function styleArches(parts, S, ground) {
  const span = 150;
  const n = Math.floor(S.L / span);
  const piers = [];
  for (let k = 1; k < n; k++) piers.push(k / n);
  for (let k = 0; k < piers.length - 1; k++) {
    const u0 = piers[k], u1 = piers[k + 1];
    const a = S.at(u0), b = S.at(u1);
    const g0 = seaFloor(a.p.x, a.p.z), g1 = seaFloor(b.p.x, b.p.z);
    if (a.p.y - Math.max(g0, 0) < 16 || b.p.y - Math.max(g1, 0) < 16) continue;
    for (const s of [-1, 1]) {
      const rib = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const q = S.at(u0 + (u1 - u0) * t);
        const spring = Math.max(0, 1.5);
        const yDeck = q.p.y - 3.6;
        const y = spring + (yDeck - spring) * Math.sin(Math.PI * t);
        rib.push(q.p.clone().addScaledVector(q.side, s * 9.5).setY(y));
      }
      parts.push(sweepTube(rib, () => 1.6, 8, { kind: 1 }));
      // spandrel columns from the rib to the deck
      for (let i = 2; i <= 18; i += 2) {
        const r = rib[i];
        const q = S.at(u0 + ((u1 - u0) * i) / 20);
        if (q.p.y - 3.4 - r.y < 1.5) continue;
        parts.push(sweepTube([r, r.clone().setY(q.p.y - 3.3)], () => 0.8, 6, { kind: 1 }));
      }
    }
  }
  return { free: [], pierAt: piers, pier: (pp, p, base, t) => pierStone(pp, p, base, t) };
}

function suspensionTower(parts, S, u, H, colliders, ring) {
  const { p, t, side } = S.at(u);
  const base = seaFloor(p.x, p.z);
  for (const s of [-1, 1]) {
    const foot = p.clone().addScaledVector(side, s * 17).setY(base - 4);
    const top = p.clone().addScaledVector(side, s * 15.5).setY(p.y + H);
    parts.push(sweepTube([foot, top], (q) => 3.8 - 1.4 * q, 8, { kind: 1 }));
  }
  for (const f of [-0.35, 0.3, 0.72, 0.97]) {
    const y = p.y + H * f;
    if (y < p.y + 6 && y > p.y - 6) continue;
    const a = p.clone().addScaledVector(side, -15.8).setY(y), b = p.clone().addScaledVector(side, 15.8).setY(y);
    parts.push(sweepTube([a, b], () => 1.9, 8, { kind: f > 0.9 && !ring ? 2 : 1 }));
  }
  if (ring) {
    // a golden sun ring spanning between the tower heads
    const c = p.clone().setY(p.y + H + 12);
    const pts = [];
    for (let i = 0; i <= 64; i++) { const a = (i / 64) * TAU; pts.push(c.clone().addScaledVector(side, Math.cos(a) * 15.5).add(V(0, Math.sin(a) * 15.5, 0))); }
    parts.push(sweepTube(pts, () => 1.6, 8, { kind: 2 }));
    const disc = latheFacade([{ r: 0.1, y: -0.5, kind: 7 }, { r: 9, y: -0.5, kind: 7 }, { r: 9, y: 0.5, kind: 2 }, { r: 0.1, y: 0.5, kind: 7 }], 32);
    disc.rotateZ(Math.PI / 2);
    disc.rotateY(-Math.atan2(t.z, t.x));
    parts.push(disc.translate(c.x, c.y, c.z));
  }
  parts.push(latheFacade(capTop([{ r: 13, y: base - 20, kind: 1 }, { r: 11, y: base + 3.5, kind: 1 }, { r: 11, y: base + 4.5, kind: 1 }]), 12, { sx: 2.0, sz: 0.8 }).rotateY(-Math.atan2(side.z, side.x)).translate(p.x, 0, p.z));
  colliders.push({ x: p.x, z: p.z, y0: base, y1: p.y + H + 30, radius: 26 });
  return { p, side, top: p.y + H };
}

function cables(parts, S, towers, anchorU, sagMid) {
  // main cables: anchorage - tower - ... - tower - anchorage, hangers to the deck edges
  const knots = [{ u: anchorU[0], y: null }, ...towers.map((tw) => ({ u: tw.u, y: tw.top - 1 })), { u: anchorU[1], y: null }];
  for (const s of [-1, 1]) {
    for (let k = 0; k < knots.length - 1; k++) {
      const A = knots[k], B = knots[k + 1];
      const a = S.at(A.u), b = S.at(B.u);
      const pa = a.p.clone().addScaledVector(a.side, s * 15.5).setY(A.y ?? a.p.y + 1.5);
      const pb = b.p.clone().addScaledVector(b.side, s * 15.5).setY(B.y ?? b.p.y + 1.5);
      const main = A.y !== null && B.y !== null;
      const n = 48;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const q = S.at(A.u + (B.u - A.u) * t);
        const y0 = pa.y + (pb.y - pa.y) * t;
        const sag = main ? (Math.min(pa.y, pb.y) - (q.p.y + sagMid)) * 4 * t * (1 - t) : 0;
        const y = main ? y0 - sag : y0 - Math.max(0, (y0 - q.p.y - 2) * 0.4 * Math.sin(Math.PI * t));
        pts.push(q.p.clone().addScaledVector(q.side, s * 15.5).setY(Math.max(y, q.p.y + 2)));
      }
      parts.push(sweepTube(pts, () => 0.85, 8, { kind: 10 }));
      // anchorage blocks where a back-stay meets the deck: from under the deck web up past the cable end
      for (const E of [A, B]) {
        if (E.y !== null) continue;
        const e = S.at(E.u);
        const Q = (a, l) => { const w = e.p.clone().addScaledVector(e.t, a).addScaledVector(e.side, s * l); return [w.x, w.z]; };
        parts.push(prismGeo([Q(-7, 13.9), Q(7, 13.9), Q(7, 17.4), Q(-7, 17.4)], e.p.y - 3.4, e.p.y + 2.9, 1, 5, true));
        parts.push(prismGeo([Q(-4.5, 14.4), Q(4.5, 14.4), Q(4.5, 16.9), Q(-4.5, 16.9)], e.p.y + 2.9, e.p.y + 3.5, 2, 2));
      }
      // hangers every ~18 m
      const len = (B.u - A.u) * S.L;
      const m = Math.floor(len / 18);
      for (let i = 1; i < m; i++) {
        const t = i / m;
        const c = pts[Math.round(t * n)];
        const q = S.at(A.u + (B.u - A.u) * t);
        const deck = q.p.clone().addScaledVector(q.side, s * 14.2).setY(q.p.y + 1.3);
        if (c.y - deck.y > 2) parts.push(sweepTube([c, deck], () => 0.12, 4, { kind: 10 }));
      }
    }
  }
}

function styleSuspension(parts, S, ground, colliders) {
  const tw = [0.28, 0.72].map((u) => ({ u, ...suspensionTower(parts, S, u, 165, colliders, true) }));
  cables(parts, S, tw, [0.12, 0.88], 7);
  return { free: [[0.2, 0.8]], pier: pierLotus, towers: tw.map((t) => t.u) };
}

function styleGrand(parts, S, ground, colliders) {
  const tw = [0.22, 0.5, 0.78].map((u) => ({ u, ...suspensionTower(parts, S, u, 205, colliders, false) }));
  // lanterns on the tower heads
  for (const t of tw) {
    const { p, side } = S.at(t.u);
    parts.push(latheFacade([{ r: 5.5, y: 0, kind: 1 }, { r: 5, y: 10, kind: 2 }, { r: 3.4, y: 16, kind: 2 }, { r: 0.4, y: 26, kind: 1 }], 12).translate(p.x, p.y + 205 + 2, p.z));
    void side;
  }
  cables(parts, S, tw, [0.1, 0.9], 8);
  return { free: [[0.15, 0.85]], pier: pierLotus, towers: tw.map((t) => t.u) };
}

function styleTiedArch(parts, S, ground, colliders) {
  const arches = [[0.2, 0.33], [0.435, 0.565], [0.67, 0.8]];
  for (const [u0, u1] of arches) {
    const rise = 88;
    const ribs = [];
    for (const s of [-1, 1]) {
      const rib = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const q = S.at(u0 + (u1 - u0) * t);
        const lat = s * (15.2 - 5.5 * Math.sin(Math.PI * t));
        rib.push(q.p.clone().addScaledVector(q.side, lat).setY(q.p.y + 1.2 + rise * Math.sin(Math.PI * t)));
      }
      parts.push(sweepTube(rib, (t) => 2.6 - 0.9 * Math.sin(Math.PI * t), 10, { kind: 1 }));
      ribs.push(rib);
      for (let i = 2; i < 40; i += 2) {
        const q = S.at(u0 + ((u1 - u0) * i) / 40);
        const deck = q.p.clone().addScaledVector(q.side, s * 14.2).setY(q.p.y + 1.3);
        parts.push(sweepTube([ribs[ribs.length - 1][i], deck], () => 0.16, 4, { kind: 10 }));
      }
    }
    for (let i = 12; i <= 28; i += 4) parts.push(sweepTube([ribs[0][i], ribs[1][i]], () => 0.9, 6, { kind: i === 20 ? 2 : 1 }));
    for (const u of [u0, u1]) {
      const { p, side } = S.at(u);
      const base = seaFloor(p.x, p.z);
      parts.push(latheFacade(capTop([{ r: 13, y: base - 20, kind: 1 }, { r: 11, y: base + 2, kind: 1 }, { r: 9.5, y: p.y - 3.4, kind: 1 }, { r: 16, y: p.y - 0.8, kind: 1 }, { r: 16, y: p.y - 0.2, kind: 5 }]), 14, { sx: 1.6, sz: 0.9 }).rotateY(-Math.atan2(side.z, side.x)).translate(p.x, 0, p.z));
      colliders.push({ x: p.x, z: p.z, y0: base, y1: p.y + rise + 6, radius: 22 });
    }
  }
  return { free: arches, pier: pierLotus };
}

function styleExtradosed(parts, S, ground, colliders) {
  const n = 7;
  const us = [];
  for (let k = 0; k < n; k++) us.push(0.14 + (0.72 * k) / (n - 1));
  for (const u of us) {
    const { p, t, side } = S.at(u);
    for (const s of [-1, 1]) {
      const b = p.clone().addScaledVector(side, s * 15.2);
      const mast = latheFacade([{ r: 1.9, y: -4, kind: 1 }, { r: 1.5, y: 30, kind: 1 }, { r: 1.2, y: 40, kind: 2 }, { r: 0.3, y: 48, kind: 1 }], 8);
      parts.push(mast.translate(b.x, p.y, b.z));
      // harp stays: parallel, fore and aft
      for (let k = 1; k <= 7; k++) {
        const hy = p.y + 12 + k * 4;
        for (const dir of [-1, 1]) {
          const q = S.at(u + (dir * (18 + k * 16)) / S.L);
          stays(parts, b.clone().setY(hy), q.p.clone().addScaledVector(q.side, s * 14.2).add(V(0, 1.2, 0)), 0.26);
        }
      }
    }
    const base = seaFloor(p.x, p.z);
    parts.push(latheFacade(capTop([{ r: 10, y: base - 18, kind: 1 }, { r: 8.5, y: base + 2, kind: 1 }, { r: 6.5, y: p.y - 6, kind: 1 }, { r: 16.5, y: p.y - 3.6, kind: 1 }, { r: 16.5, y: p.y - 2.9, kind: 5 }]), 14, { sx: 1.1, sz: 0.6 }).rotateY(-Math.atan2(side.z, side.x)).translate(p.x, 0, p.z));
    colliders.push({ x: p.x, z: p.z, y0: base, y1: p.y + 50, radius: 22 });
    void t;
  }
  return { free: [], pierAt: us, pier: pierLotus, skipPierNear: us };
}

function styleLotus(parts, S) {
  return { free: [], pier: pierCoral, spacing: 190 };
}

// ---------------------------------------------------------------- build --
function bridgehead(parts, head) {
  // a raised podium on the rim: arcaded retaining walls, a paved top, stairs down to the land
  const { x, z, rot, hw, hd, y, lo } = head;
  const c = Math.cos(rot), s = Math.sin(rot);
  const W = (a, b) => [x + a * c - b * s, z + a * s + b * c];
  const rr = (w0, d0, r, n = 6) => {
    const pts = [];
    const cs = [[w0 - r, d0 - r, 0], [-w0 + r, d0 - r, 1], [-w0 + r, -d0 + r, 2], [w0 - r, -d0 + r, 3]];
    for (const [cx, cz, q] of cs) for (let i = 0; i <= n; i++) { const a = (q + i / n) * (Math.PI / 2); pts.push(W(cx + Math.cos(a) * r, cz + Math.sin(a) * r)); }
    return pts;
  };
  const ring = rr(hw, hd, 10);
  const pos = [], fac = [], idx = [];
  let u = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const base = pos.length / 3;
    for (const [pp, yy, uu, kk] of [[a, lo, u, 1], [b, lo, u + L, 1], [b, y - 1.2, u + L, 5], [a, y - 1.2, u, 5]]) { pos.push(pp[0], yy, pp[1]); fac.push(uu, yy, kk); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    const b2 = pos.length / 3;
    for (const [pp, yy, uu] of [[a, y - 1.2, u], [b, y - 1.2, u + L], [b, y + 0.9, u + L], [a, y + 0.9, u]]) { pos.push(pp[0], yy, pp[1]); fac.push(uu, yy, 1); }
    idx.push(b2, b2 + 1, b2 + 2, b2, b2 + 2, b2 + 3);
    u += L;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // walls face outward
  const n = g.attributes.normal;
  if ((n.getX(0) * (pos[0] - x) + n.getZ(0) * (pos[2] - z)) < 0) { for (let k = 0; k < idx.length; k += 3) { const q = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = q; } g.setIndex(idx); g.computeVertexNormals(); }
  parts.push(g);
  // the top: paving inside a parapet (the parapet ring is 0.9 m above the paving)
  const inner = rr(hw - 0.8, hd - 0.8, 9.2);
  // a hole where the station's plinth stands (its walls go down into the podium)
  const st = head.station;
  const sc = Math.cos(st.rot), sn = Math.sin(st.rot);
  const hole = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    const k = Math.pow(Math.pow(Math.abs(ca), 4) + Math.pow(Math.abs(sa), 4), -0.25);
    const lu = ca * k * 36.5, lx = sa * k * 14.8;
    hole.push([st.x + lu * sc - lx * sn, st.z + lu * sn + lx * sc]);
  }
  const all = [...inner, ...hole];
  const tris = THREE.ShapeUtils.triangulateShape(inner.map((p) => new THREE.Vector2(p[0], p[1])), [hole.map((p) => new THREE.Vector2(p[0], p[1]))]);
  const tp = [], tf = [], ti = [];
  for (const p of all) { tp.push(p[0], y, p[1]); tf.push(p[0], p[1], 9); }
  for (const [a, b, cc] of tris) {
    const pa = all[a], pb = all[b], pc = all[cc];
    const cr = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
    if (cr < 0) ti.push(a, b, cc); else ti.push(a, cc, b);
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  top.setAttribute('aFacade', new THREE.Float32BufferAttribute(tf, 3));
  top.setIndex(ti);
  top.computeVertexNormals();
  parts.push(top);
  // inner parapet face
  const ip = [], ifc = [], ii = [];
  u = 0;
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i], b = inner[(i + 1) % inner.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const base = ip.length / 3;
    for (const [pp, yy, uu] of [[a, y - 0.05, u], [b, y - 0.05, u + L], [b, y + 0.9, u + L], [a, y + 0.9, u]]) { ip.push(pp[0], yy, pp[1]); ifc.push(uu, yy, 1); }
    ii.push(base, base + 2, base + 1, base, base + 3, base + 2);
    u += L;
  }
  const ig = new THREE.BufferGeometry();
  ig.setAttribute('position', new THREE.Float32BufferAttribute(ip, 3));
  ig.setAttribute('aFacade', new THREE.Float32BufferAttribute(ifc, 3));
  ig.setIndex(ii);
  ig.computeVertexNormals();
  const n2 = ig.attributes.normal;
  if ((n2.getX(0) * (ip[0] - x) + n2.getZ(0) * (ip[2] - z)) > 0) { for (let k = 0; k < ii.length; k += 3) { const q = ii[k + 1]; ii[k + 1] = ii[k + 2]; ii[k + 2] = q; } ig.setIndex(ii); ig.computeVertexNormals(); }
  parts.push(ig);
  // the parapet top, joining the outer wall to the inner face
  const cp = [], cf = [], ci = [];
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const base = cp.length / 3;
    for (const p of [ring[i], ring[j], inner[j], inner[i]]) { cp.push(p[0], y + 0.9, p[1]); cf.push(p[0], p[1], 5); }
    ci.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  cg.setAttribute('aFacade', new THREE.Float32BufferAttribute(cf, 3));
  cg.setIndex(ci);
  cg.computeVertexNormals();
  if (cg.attributes.normal.getY(0) < 0) { for (let k = 0; k < ci.length; k += 3) { const q = ci[k + 1]; ci[k + 1] = ci[k + 2]; ci[k + 2] = q; } cg.setIndex(ci); cg.computeVertexNormals(); }
  parts.push(cg);
  // the grand stair down the landward end, across most of the width
  const steps = Math.max(4, Math.ceil((y - lo - 2) / 0.32));
  for (let k = 0; k < Math.min(steps, 24); k++) {
    const a0 = -hw - 0.5 - k * 0.45, a1 = a0 + 0.45 + (k === 0 ? 0.5 : 0);
    const yt = y - (k + 1) * 0.32;
    const q = [W(a0, -hd * 0.6), W(a1, -hd * 0.6), W(a1, hd * 0.6), W(a0, hd * 0.6)];
    parts.push(prismGeo(q, lo, yt, 1, 9));
  }
}

function prismGeo(q, y0, y1, kind, topKind, bottom = false) {
  const pos = [], fac = [], idx = [];
  const add = (a, b, c, d, k) => { const base = pos.length / 3; for (const p of [a, b, c, d]) { pos.push(p[0], p[1], p[2]); fac.push(p[0] + p[2], p[1], k); } idx.push(base, base + 1, base + 2, base, base + 2, base + 3); };
  const cx = (q[0][0] + q[2][0]) / 2, cz = (q[0][1] + q[2][1]) / 2;
  for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; add([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], kind); }
  add([q[0][0], y1, q[0][1]], [q[1][0], y1, q[1][1]], [q[2][0], y1, q[2][1]], [q[3][0], y1, q[3][1]], topKind);
  if (bottom) add([q[0][0], y0, q[0][1]], [q[1][0], y0, q[1][1]], [q[2][0], y0, q[2][1]], [q[3][0], y0, q[3][1]], kind);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // orient: sides away from the centre, top up
  const n = g.attributes.normal, P = g.attributes.position;
  for (let f = 0; f < (bottom ? 6 : 5); f++) {
    const i0 = f * 4;
    const out = f < 4 ? (n.getX(i0) * (P.getX(i0) - cx) + n.getZ(i0) * (P.getZ(i0) - cz)) : f === 4 ? n.getY(i0) : -n.getY(i0);
    if (out < 0) { const ix = g.index.array; for (let k = f * 6; k < f * 6 + 6; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } }
  }
  g.computeVertexNormals();
  return g;
}

export function buildWardBridges(scene, bridgePaths, recs, ground, world) {
  const parts = [];
  const colliders = [];
  const lamps = [];
  const stations = [];
  const lod = [];
  const meshes = [];
  const decks = [];
  for (const bp of bridgePaths) {
    const { path, head } = bp;
    const S = sampler(path);
    const style = STYLE[bp.ward];
    const N = path.length - 1;
    decks.push({ ward: bp.ward, path, style });
    parts.push(extrudeAlong(path, DECK, (i) => DECK[i][2]));
    parts.push(deckCap(path, 0, false), deckCap(path, N, true));
    // the structure of this bridge
    const res = { stayed: styleStayed, arches: styleArches, suspension: styleSuspension, grand: styleGrand, tiedArch: styleTiedArch, extradosed: styleExtradosed, lotus: styleLotus }[style](parts, S, ground, colliders);
    // piers wherever the deck flies, outside the free (cable-carried) spans
    const inFree = (u) => (res.free || []).some(([a, b]) => u > a && u < b);
    const pierUs = [];
    if (res.pierAt) pierUs.push(...res.pierAt);
    else {
      const sp = res.spacing || 230;
      for (let s = sp; s < S.L - 40; s += sp) pierUs.push(s / S.L);
    }
    for (const u of pierUs) {
      if (inFree(u)) continue;
      if (res.skipPierNear && style !== 'extradosed' && res.skipPierNear.some((q) => Math.abs(q - u) * S.L < 60)) continue;
      const { p, t, side } = S.at(u);
      const base = seaFloor(p.x, p.z);
      if (p.y - Math.max(ground(p.x, p.z), 0) < 12) continue;
      if (style === 'extradosed') continue;       // its pylons carry their own piers
      res.pier(parts, p, base, t, side);
    }
    // the maglev: held on brackets beside the deck, swinging out on columns into the stations
    // (it swings out to 27 m past the pylon legs, which stand 13-21.5 m out at deck level)
    const uArc = [0];
    for (let i = 1; i <= N; i++) uArc.push(uArc[i - 1] + path[i].distanceTo(path[i - 1]));
    const towerBump = (i) => (res.towers || []).reduce((m, u) => Math.max(m, ss(95, 45, Math.abs(uArc[i] - u * S.L))), 0);
    const latAt = (t, i) => 21 + 11 * (ss(0.07, 0.0, t) + ss(0.93, 1.0, t)) + 6 * towerBump(i);
    const tube = path.map((p, i) => {
      const t = i / N;
      return p.clone().addScaledVector(frameAt(path, i).side, latAt(t, i)).add(V(0, 2.8, 0));
    });
    // the ends of the tube: run straight into each station's portal ring
    parts.push(sweepTube(tube, () => 3.0, 12, { kind: 13 }));
    let acc = 0;
    for (let i = 1; i < N; i++) {
      acc += path[i].distanceTo(path[i - 1]);
      if (acc < 24) continue;
      acc = 0;
      const t = i / N;
      const { side } = frameAt(path, i);
      const lat = latAt(t, i);
      const tp = tube[i];
      if (lat < 22.5) {
        const a = path[i].clone().addScaledVector(side, 12.2).add(V(0, -1.6, 0));   // inside the deck's sloped web
        parts.push(sweepTube([a, a.clone().lerp(tp, 0.5).add(V(0, -1.6, 0)), tp.clone().add(V(0, -2.6, 0))], () => 0.55, 6, { kind: 1 }));
      } else {
        const g = Math.max(ground(tp.x, tp.z), -24);
        if (tp.y - 3 - g > 1.5) parts.push(latheFacade(capTop([{ r: 1.6, y: g - 6, kind: 1 }, { r: 1.2, y: tp.y - 4.6, kind: 1 }, { r: 2.4, y: tp.y - 2.4, kind: 1 }]), 8).translate(tp.x, 0, tp.z));
      }
    }
    // gateways astride the deck at both ends
    const f0 = frameAt(path, 2), f1 = frameAt(path, N - 2);
    deckPortal(parts, path[2], f0.side, path[2].y + 0.2);
    deckPortal(parts, path[N - 2], f1.side, path[N - 2].y + 0.2);
    // stations at both ends
    const ends = [];
    const rec = recs.find((r) => r.w.id === bp.ward);
    const L = rec.landings[0];
    ends.push({ x: rec.w.x + L.station.x, z: rec.w.z + L.station.z, rot: L.station.rot, base: path[N].y, lo: path[N].y - 1.6, ward: bp.ward, end: 'ward' });
    if (head) {
      bridgehead(parts, head);
      ends.push({ x: head.station.x, z: head.station.z, rot: head.station.rot, base: path[0].y, lo: head.y - 1.5, ward: bp.ward, end: 'rim' });
    } else if (bp.from) {
      const r0 = recs.find((r) => r.w.id === bp.from);
      const L2 = r0.landings.find((q) => !q.own);
      ends.push({ x: r0.w.x + L2.station.x, z: r0.w.z + L2.station.z, rot: L2.station.rot, base: path[0].y, lo: path[0].y - 1.6, ward: bp.from, end: 'link' });
    }
    for (const e of ends) {
      const t = V(Math.cos(e.rot), 0, Math.sin(e.rot));
      const side = V(-t.z, 0, t.x);
      maglevStation(parts, V(e.x, 0, e.z), t, side, e.base, -1, e.lo);
      stations.push({ x: e.x, z: e.z, r: 42, y: e.base, rot: e.rot, ward: e.ward, end: e.end, line: `spoke-${bp.ward}` });
    }
    // deck lamps, staggered along the hedges
    acc = 0;
    for (let k = 1; k <= N; k++) {
      acc += path[k].distanceTo(path[k - 1]);
      if (acc < 26) continue;
      acc = 0;
      const { side } = frameAt(path, k);
      const s = (k & 1) ? 1 : -1;
      const p = path[k].clone().addScaledVector(side, s * 12.3);
      lamps.push({ x: p.x, y: path[k].y + 0.2, z: p.z, yaw: Math.atan2(-side.x * s, -side.z * s), cls: 4, bridge: bp.ward });
    }
  }
  const mat = createFacadeMaterial('pearl', 778, { litFrac: 0.6, band: 1e5 });
  const mesh = new THREE.Mesh(mergeClean(parts), mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.name = 'Ward bridges';
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  scene.add(mesh);
  meshes.push(mesh);
  if (world && world.colliders) world.colliders.push(...colliders);
  return { meshes, lod, stations, lamps, decks, colliders };
}
