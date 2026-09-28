import * as THREE from 'three';
import { latheFacade, sweepTube as tubeGeometry, loftSections, mergeClean } from './geom.js';
import { extrudeAlong, frameAt, maglevStation, deckPortal } from './infrastructure.js';
import { createFacadeMaterial } from './facade.js';
import { terrainHeight } from './terrain.js';
import { sweepLoop } from './platform.js';
import { signalLights } from './wardLandmarks.js';

// steady red aviation lights on everything that stands 100 m and more over the sea
const AVIATION = [1.0, 0.16, 0.1], MAST_LANTERN = [1.0, 0.82, 0.58];

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

// Expose the authored connection intent alongside the real material geometry
// for independent endpoint-contact checks; rendering uses the same geometry.
function sweepTube(points, radius, radial, options) {
  const g=tubeGeometry(points,radius,radial,options);
  if(points[0].distanceTo(points.at(-1))>1e-5)g.userData.bridgeEnds=[{point:points[0].toArray(),radius:radius(0)},{point:points.at(-1).toArray(),radius:radius(1)}];
  return g;
}

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

/** Path sampler by arc fraction. */
function sampler(path) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1]));
  const L = cum[cum.length - 1];
  return {
    L,
    lights: [],
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

/** A lathe profile closed with a flat top and no redundant zero-area rim strip. */
const capTop = (prof) => { const l = prof[prof.length - 1]; return [...prof, { r: 0, y: l.y, kind: l.kind }]; };

// The ocean floor is as deep as 260 m here. A nominal -30 m footing leaves
// whole bridge piers suspended underwater; survey beneath the actual caisson.
const seaFloor = (x, z, radius = 35) => {
  let y=terrainHeight(x,z);
  for(let i=0;i<16;i++){const a=i/16*TAU;y=Math.min(y,terrainHeight(x+Math.cos(a)*radius,z+Math.sin(a)*radius));}
  return y;
};
const waterOrGround = (x, z, ground) => Math.max(ground(x, z), 0);

// ------------------------------------------------------------------- parts --
/**
 * A dark bronze fender collar at the waterline, let into a rising lathe profile: the pier
 * reads as founded in the sea (a tide band), and boats have something to rub against.
 */
function waterCollar(profile) {
  const rAt = (y) => {
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1], b = profile[i];
      if (y >= a.y && y <= b.y) return a.r + (b.r - a.r) * ((y - a.y) / Math.max(b.y - a.y, 1e-6));
    }
    return null;
  };
  const r0 = rAt(-1.6), r1 = rAt(1.9);
  if (r0 === null || r1 === null) return profile;
  return [
    ...profile.filter((q) => q.y < -1.6),
    { r: r0, y: -1.6, kind: 1 }, { r: r0 + 0.45, y: -1.45, kind: 10 }, { r: r1 + 0.45, y: 1.75, kind: 10 }, { r: r1, y: 1.9, kind: 1 },
    ...profile.filter((q) => q.y > 1.9),
  ];
}
function pierLotus(parts, p, base) {
  const visibleBase = Math.max(base, -30);
  let last = -Infinity;
  parts.push(latheFacade(waterCollar([
    { r: 7.5, y: base - 18, kind: 1 }, { r: 6.2, y: base + 0.5, kind: 1 },
    ...(base < visibleBase ? [{ r: 6.2, y: visibleBase + 0.5, kind: 1 }] : []),
    { r: 4.2, y: visibleBase + (p.y - visibleBase) * 0.55, kind: 1 },
    { r: 5.6, y: p.y - 7.5, kind: 1 }, { r: 12.5, y: p.y - 3.4, kind: 1 }, { r: 12.5, y: p.y - 2.9, kind: 5 },
  ].filter(q => q.y >= last ? ((last=q.y),true) : false)).flatMap((q, i, a) => (i === a.length - 1 ? capTop([q]) : [q])), 16).translate(p.x, 0, p.z));
}
function pierStone(parts, p, base, t) {
  // a pier with pointed cutwaters, battered, with a string course under the deck
  const visibleBase = Math.max(base, -30);
  const g = latheFacade(waterCollar([
    { r: 9.5, y: base - 18, kind: 1 }, { r: 8.5, y: base + 2, kind: 1 },
    ...(base < visibleBase ? [{ r: 8.5, y: visibleBase + 2, kind: 1 }] : []),
    { r: 6.4, y: p.y - 9, kind: 5 }, { r: 7.2, y: p.y - 8, kind: 1 }, { r: 7.2, y: p.y - 2.9, kind: 1 },
  ]).flatMap((q, i, a) => (i === a.length - 1 ? capTop([q]) : [q])), 12, { sx: 1.75, sz: 0.62 });
  g.rotateY(-Math.atan2(t.x, -t.z));
  parts.push(g.translate(p.x, 0, p.z));
}
/**
 * A trestle where the deck runs low over the rim's shore: two founded columns under the
 * deck's web, joined by a cap beam that meets the web's underside.
 */
function trestle(parts, p, side, ground) {
  const top = p.y - 3.2;
  for (const s of [-1, 1]) {
    const c = p.clone().addScaledVector(side, s * 7.2);
    let g = ground(c.x, c.z);
    for (let i = 0; i < 8; i++) g = Math.min(g, ground(c.x + Math.cos(i / 8 * TAU) * 1.6, c.z + Math.sin(i / 8 * TAU) * 1.6));
    parts.push(latheFacade(capTop([{ r: 1.7, y: g - 2.5, kind: 1 }, { r: 1.7, y: g + 0.35, kind: 1 }, { r: 1.25, y: g + 0.6, kind: 1 }, { r: 1.05, y: top - 1.0, kind: 1 }]), 12).translate(c.x, 0, c.z));
  }
  const t = V(side.z, 0, -side.x);
  const Q = (u, v) => [p.x + t.x * u + side.x * v, p.z + t.z * u + side.z * v];
  parts.push(prismGeo([Q(-1.3, -9.4), Q(1.3, -9.4), Q(1.3, 9.4), Q(-1.3, 9.4)], top - 1.05, top + 0.02, 1, 1));
}
function pierCoral(parts, p, base, t, side, rnd) {
  // The branching crown belongs to the visible water/deck composition. Only
  // the buried trunk follows deep seabed relief, so the coral silhouette stays.
  const visibleBase = Math.max(base, -30);
  const trunkTop = visibleBase + (p.y - visibleBase) * 0.45;
  parts.push(latheFacade(waterCollar([{ r: 8, y: base - 16, kind: 1 }, { r: 6.5, y: base + 0.5, kind: 1 }, { r: 4.5, y: trunkTop, kind: 1 }]), 14).translate(p.x, 0, p.z));
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
/** Structure that must stand clear of the deck and its parapets (checked by the span audit). */
const clearOfDeck = (g) => { g.userData.clearOfDeck = true; return g; };

/** A beam under the deck between a pylon's two legs: the deck's bearing at the pylon. */
function deckBearingBeam(parts, p, side, halfSpan, r = 1.3) {
  const y = p.y - 3.2 - r + 0.05;
  parts.push(sweepTube([p.clone().addScaledVector(side, -halfSpan).setY(y), p.clone().addScaledVector(side, halfSpan).setY(y)], () => r, 10, { kind: 1 }));
}

function styleStayed(parts, S, ground, colliders) {
  // Two faceted crystal pylons, 0.28 L apart, each carrying the deck on fans of sixteen
  // stays a side that meet at mid-span: the main span is hung throughout, never a girder.
  const half = 0.14, towers = [0.5 - half, 0.5 + half];
  const reach = half * S.L - 8, first = 34, nStay = 16, pitch = (reach - first) / nStay;
  for (const u of towers) {
    const { p, t, side } = S.at(u);
    const base = seaFloor(p.x, p.z);
    const H = 196;
    // inverted Y: two legs outside the deck (clear of its parapets) merging above it,
    // a faceted spire above carrying the stay anchorages
    const apex = p.clone().add(V(0, 64, 0));
    const foot = (s) => p.clone().addScaledVector(side, s * 21.5).setY(base - 4), knee = (s) => p.clone().addScaledVector(side, s * 19.6).setY(p.y + 2.4);
    for (const s of [-1, 1]) parts.push(clearOfDeck(sweepTube([foot(s), knee(s), apex], (q) => 4.2 - 1.6 * q, 8, { kind: 1 })));
    // the deck's bearing between the legs (leg centre at deck-web depth ~19.6 m out)
    deckBearingBeam(parts, p, side, 19.4, 1.4);
    const sp = H - 64;
    const spire = latheFacade([{ r: 5.8, y: 0, kind: 1 }, { r: 4.9, y: sp * 0.42, kind: 0 }, { r: 4.1, y: sp * 0.78, kind: 0 }, { r: 3.2, y: sp * 0.86, kind: 2 }, { r: 2.2, y: sp * 0.95, kind: 2 }, { r: 0.4, y: sp + 10, kind: 2 }], 6);
    spire.rotateY(-Math.atan2(t.z, t.x));
    parts.push(spire.translate(apex.x, apex.y, apex.z));
    parts.push(latheFacade(capTop([{ r: 12, y: base - 20, kind: 1 }, { r: 10, y: base + 3, kind: 1 }, { r: 10, y: base + 4, kind: 1 }]), 12, { sx: 2.1, sz: 0.8 }).rotateY(-Math.atan2(side.z, side.x)).translate(p.x, 0, p.z));
    colliders.push({ x: p.x, z: p.z, y0: base, y1: p.y + H + 12, radius: 28 });
    S.lights.push({ x: apex.x, y: apex.y + sp + 10.8, z: apex.z, c: AVIATION, s: 2.6 }, { x: apex.x, y: apex.y + sp * 0.62, z: apex.z, c: AVIATION, s: 1.8 });
    // fans of stays to both deck edges, fore and aft; the anchorages climb the spire
    for (let k = 1; k <= nStay; k++) {
      const hy = apex.y + 14 + k * 5.8;
      const head = apex.clone().setY(hy);
      for (const dir of [-1, 1]) {
        const q = S.at(u + (dir * (first + k * pitch)) / S.L);
        for (const s of [-1, 1]) stays(parts, head.clone().addScaledVector(side, s * 1.5), q.p.clone().addScaledVector(q.side, s * 13.8).add(V(0, 0.6, 0)), 0.34);
      }
    }
  }
  const r = reach / S.L;
  return { carried: [[towers[0] - r, towers[1] + r]], points: towers, pier: pierLotus, towers };
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
  return { pierAt: piers, pier: (pp, p, base, t) => pierStone(pp, p, base, t), spacing: span };
}

function suspensionTower(parts, S, u, H, colliders, ring) {
  const { p, t, side } = S.at(u);
  const base = seaFloor(p.x, p.z);
  // The legs splay to 23.5 m at the sea floor so that, where the deck passes between
  // them, their faces stand clear of its parapets; they close to the cable planes at
  // 15.5 m, where the saddles take the main cables.
  const fy = base - 4, ty = p.y + H, legAt = (y) => 23.5 - 8 * (y - fy) / (ty - fy);
  for (const s of [-1, 1]) {
    const foot = p.clone().addScaledVector(side, s * 23.5).setY(fy);
    const top = p.clone().addScaledVector(side, s * 15.5).setY(ty);
    parts.push(clearOfDeck(sweepTube([foot, top], (q) => 3.8 - 1.4 * q, 10, { kind: 1 })));
  }
  deckBearingBeam(parts, p, side, legAt(p.y - 4.5) - 0.4, 1.3);
  for (const f of [-0.35, 0.3, 0.72, 0.97]) {
    const y = p.y + H * f;
    if (y < p.y + 6 && y > p.y - 6) continue;
    const hl = legAt(y) + 0.3;
    const a = p.clone().addScaledVector(side, -hl).setY(y), b = p.clone().addScaledVector(side, hl).setY(y);
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
    // Four solar spokes physically connect the medallion to its outer ring.
    for (let i = 0; i < 4; i++) {
      const a=i*Math.PI/2, direction=side.clone().multiplyScalar(Math.cos(a)).add(V(0,Math.sin(a),0));
      parts.push(sweepTube([c.clone().addScaledVector(direction,8.7),c.clone().addScaledVector(direction,15.5)],()=>.5,8,{kind:2}));
    }
  }
  parts.push(latheFacade(capTop([{ r: 13, y: base - 20, kind: 1 }, { r: 11, y: base + 3.5, kind: 1 }, { r: 11, y: base + 4.5, kind: 1 }]), 12, { sx: 2.0, sz: 0.8 }).rotateY(-Math.atan2(side.z, side.x)).translate(p.x, 0, p.z));
  colliders.push({ x: p.x, z: p.z, y0: base, y1: p.y + H + 30, radius: 26 });
  for (const s of [-1, 1]) { const q = p.clone().addScaledVector(side, s * 15.5); S.lights.push({ x: q.x, y: p.y + H + 3.2, z: q.z, c: AVIATION, s: 2.2 }, { x: q.x + side.x * s * 2.6, y: p.y + H * 0.5, z: q.z + side.z * s * 2.6, c: AVIATION, s: 1.5 }); }
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
  // hangers every 18 m carry the whole deck between the anchorages
  return { carried: [[0.12, 0.88]], points: tw.map((t) => t.u), pier: pierLotus, towers: tw.map((t) => t.u) };
}

function styleGrand(parts, S, ground, colliders) {
  const tw = [0.22, 0.5, 0.78].map((u) => ({ u, ...suspensionTower(parts, S, u, 205, colliders, false) }));
  // lanterns on the tower heads
  for (const t of tw) {
    const { p, side } = S.at(t.u);
    parts.push(latheFacade([{r:5.8,y:p.y+205*.97-1,kind:1},{r:5.4,y:p.y+207.2,kind:2}],12).translate(p.x,0,p.z));
    parts.push(latheFacade([{ r: 5.5, y: 0, kind: 1 }, { r: 5, y: 10, kind: 2 }, { r: 3.4, y: 16, kind: 2 }, { r: 0.4, y: 26, kind: 1 }], 12).translate(p.x, p.y + 205 + 2, p.z));
    S.lights.push({ x: p.x, y: p.y + 205 + 28.8, z: p.z, c: AVIATION, s: 2.8 });
    void side;
  }
  cables(parts, S, tw, [0.1, 0.9], 8);
  return { carried: [[0.1, 0.9]], points: tw.map((t) => t.u), pier: pierLotus, towers: tw.map((t) => t.u) };
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
        // springing 17.2 m out (clear of the parapets), leaning in to 9.7 m at the crown
        const lat = s * (17.2 - 7.5 * Math.sin(Math.PI * t));
        rib.push(q.p.clone().addScaledVector(q.side, lat).setY(q.p.y + 1.2 + rise * Math.sin(Math.PI * t)));
      }
      parts.push(clearOfDeck(sweepTube(rib, (t) => 2.6 - 0.9 * Math.sin(Math.PI * t), 10, { kind: 1 })));
      ribs.push(rib);
      for (let i = 2; i < 40; i += 2) {
        const q = S.at(u0 + ((u1 - u0) * i) / 40);
        const deck = q.p.clone().addScaledVector(q.side, s * 14.2).setY(q.p.y + 1.3);
        parts.push(sweepTube([ribs[ribs.length - 1][i], deck], () => 0.16, 4, { kind: 10 }));
      }
    }
    for (let i = 12; i <= 28; i += 4) parts.push(sweepTube([ribs[0][i], ribs[1][i]], () => 0.9, 6, { kind: i === 20 ? 2 : 1 }));
    for (const rib of ribs) S.lights.push({ x: rib[20].x, y: rib[20].y + 2.2, z: rib[20].z, c: AVIATION, s: 2.0 });
    for (const u of [u0, u1]) {
      const { p, side } = S.at(u);
      const base = seaFloor(p.x, p.z);
      parts.push(latheFacade(capTop([{ r: 13, y: base - 20, kind: 1 }, { r: 11, y: base + 2, kind: 1 }, { r: 9.5, y: p.y - 3.4, kind: 1 }, { r: 16, y: p.y - 1.05, kind: 1 }, { r: 16, y: p.y - 0.45, kind: 5 }]), 14, { sx: 1.6, sz: 0.9 }).rotateY(-Math.atan2(side.z, side.x)).translate(p.x, 0, p.z));
      colliders.push({ x: p.x, z: p.z, y0: base, y1: p.y + rise + 6, radius: 22 });
    }
  }
  return { carried: arches, points: arches.flat(), pier: pierLotus, tubeLat: 24 };
}

function styleExtradosed(parts, S, ground, colliders, clear) {
  // A colonnade of low twin masts on every pier, ~215 m apart the whole way: each span
  // carried by the stiff box of the deck at its piers and mid-span, and on short harp
  // stays in between, so the stays of neighbouring masts never cross.
  const s0 = 140, spans = Math.max(2, Math.round((S.L - 2 * s0) / 215)), pitch = (S.L - 2 * s0) / spans;
  const us = [];
  for (let k = 0; k <= spans; k++) {
    const u = (s0 + k * pitch) / S.L, { p } = S.at(u);
    if (clear(p) < 14) continue;
    us.push(u);
  }
  const reach = Math.min(100, pitch / 2 - 10), nStay = 7, first = 26, step = (reach - first) / (nStay - 1);
  const carried = [];
  for (const u of us) {
    const { p, t, side } = S.at(u);
    for (const s of [-1, 1]) {
      // masts stand on the pier head, their shafts clear of the deck's parapet
      const b = p.clone().addScaledVector(side, s * 16.9);
      const mast = latheFacade([{ r: 1.9, y: -3.4, kind: 1 }, { r: 1.5, y: 30, kind: 1 }, { r: 1.25, y: 38.5, kind: 1 }, { r: 1.25, y: 40, kind: 2 }, { r: 1.05, y: 43.5, kind: 2 }, { r: 0.3, y: 48, kind: 1 }], 8);
      parts.push(clearOfDeck(mast.translate(b.x, p.y, b.z)));
      S.lights.push({ x: b.x, y: p.y + 48.6, z: b.z, c: MAST_LANTERN, s: 1.1 });
      // harp stays: parallel, fore and aft
      for (let k = 0; k < nStay; k++) {
        const hy = p.y + 14 + k * 3.6;
        for (const dir of [-1, 1]) {
          const q = S.at(u + (dir * (first + k * step)) / S.L);
          stays(parts, b.clone().setY(hy), q.p.clone().addScaledVector(q.side, s * 14.2).add(V(0, 1.2, 0)), 0.26);
        }
      }
    }
    const base = seaFloor(p.x, p.z);
    parts.push(latheFacade(capTop(waterCollar([{ r: 10, y: base - 18, kind: 1 }, { r: 8.5, y: base + 2, kind: 1 }, { r: 6.5, y: p.y - 6, kind: 1 }, { r: 16.5, y: p.y - 3.6, kind: 1 }, { r: 16.5, y: p.y - 2.9, kind: 5 }])), 14, { sx: 1.22, sz: 0.6 }).rotateY(-Math.atan2(side.z, side.x)).translate(p.x, 0, p.z));
    colliders.push({ x: p.x, z: p.z, y0: base, y1: p.y + 50, radius: 22 });
    carried.push([u - reach / S.L, u + reach / S.L]);
    void t;
  }
  return { carried, points: us, pier: pierLotus, tubeLat: 24 };
}

function styleLotus(parts, S) {
  return { pier: pierCoral, spacing: 190 };
}

// ---------------------------------------------------------------- build --
function bridgehead(parts, head, ground) {
  const { x, z, rot, hw, hd, y } = head;
  const c = Math.cos(rot), s = Math.sin(rot);
  const W = (u, v) => [x + u * c - v * s, z + u * s + v * c];
  // The station plinth extends 6.5 m beyond the old seaward podium edge.
  // A small asymmetric arrival bay supports it without enlarging the landward end.
  const forward = hw + 10, centre = 5, half = hw + 5;
  const local = [], radius = 10;
  for (const [cx, cz, q] of [[centre+half-radius,hd-radius,0],[centre-half+radius,hd-radius,1],[centre-half+radius,-hd+radius,2],[centre+half-radius,-hd+radius,3]])
    for (let i=0;i<=6;i++){const a=(q+i/6)*Math.PI/2;local.push([cx+Math.cos(a)*radius,cz+Math.sin(a)*radius]);}
  const ring = local.map(p=>W(...p));
  let base = head.lo;
  for (const p of ring) base = Math.min(base, ground(...p)-0.6);
  parts.push(loftSections([{y:base,pts:ring},{y,pts:ring}],{capTop:true,capBottom:true,kind:1,kindTop:9}));
  // Split the closed parapet material at the grand stair and the promenade.
  // Dense straight-edge samples make the openings independent of corner vertices.
  const edge = [];
  for(let i=0;i<local.length;i++){const a=local[i],b=local[(i+1)%local.length],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/1.5));for(let k=0;k<n;k++)edge.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]);}
  const gap = ([u,v]) => (u < -hw+1 && Math.abs(v) < hd*.6+1.2) || (u > forward-1 && Math.abs(v+14)<16.2);
  const first=edge.findIndex(gap),n=edge.length;let run=[];
  const flush=()=>{if(run.length>1)parts.push(sweepLoop(run.map(p=>W(...p)),()=>[
    {a:[0,y-.06],b:[0,y+.95],kind:1},{a:[0,y+.95],b:[-.8,y+.95],kind:5},{a:[-.8,y+.95],b:[-.8,y-.06],kind:1},
  ],{closed:false,closeSection:true,capEnds:true}));run=[];};
  for(let k=1;k<=n;k++){const p=edge[(first+k)%n];if(gap(p))flush();else run.push(p);}flush();
  // Survey the actual stair foot, not the buried foundation level. Iteration
  // accounts for terrain changing as a longer flight reaches farther inland.
  const tread=.5;let steps=20,foot=0;
  for(let i=0;i<6;i++){foot=ground(...W(-hw-steps*tread,0))+.08;steps=Math.max(4,Math.ceil((y-foot)/.3));}
  foot=ground(...W(-hw-steps*tread,0))+.08;
  const rise=(y-foot)/steps, stairHalf=hd*.6;
  for(let k=0;k<steps;k++){
    const u1=-hw-k*tread+.015,u0=u1-tread-.03,yt=y-(k+1)*rise;
    const q=[W(u0,-stairHalf),W(u1,-stairHalf),W(u1,stairHalf),W(u0,stairHalf)];
    const low=Math.min(...q.map(p=>ground(...p)))-.5;
    parts.push(prismGeo(q,Math.min(low,yt-.2),yt,1,9));
    for(const sg of [-1,1]){const v=sg*(stairHalf+.45),p=[W(u0,v-.4),W(u1,v-.4),W(u1,v+.4),W(u0,v+.4)];parts.push(prismGeo(p,Math.min(low,yt-.2),yt+.9,1,5));}
  }
  return {base,stairs:{top:V(W(-hw,0)[0],y,W(-hw,0)[1]),foot:V(W(-hw-steps*tread,0)[0],foot,W(-hw-steps*tread,0)[1]),steps,rise,halfWidth:stairHalf}, forward};
}

function prismGeo(q, y0, y1, kind, topKind, bottom = true) {
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

function stationPortal(e) {
  return V(e.x-Math.cos(e.rot)*32.67,e.base+2.6,e.z-Math.sin(e.rot)*32.67);
}

export function buildWardBridges(scene, bridgePaths, recs, ground, world, { onComponent = null } = {}) {
  const parts = [];
  let componentWard = null, componentKind = null;
  if (onComponent) parts.push = (...geometries) => {
    for (const [i,geometry] of geometries.entries()) onComponent({ ward: componentWard, kind: componentKind, geometry, index: parts.length+i });
    return Array.prototype.push.apply(parts, geometries);
  };
  const colliders = [];
  const lamps = [];
  const lights = [];
  const stations = [];
  const lod = [];
  const meshes = [];
  const decks = [];
  const interfaces = [];
  for (const bp of bridgePaths) {
    componentWard = bp.ward;
    const { path, head } = bp;
    const S = sampler(path);
    S.lights = lights;
    const style = STYLE[bp.ward];
    const N = path.length - 1;
    decks.push({ ward: bp.ward, path, style });
    componentKind = 'deck';
    parts.push(extrudeAlong(path, DECK, (i) => DECK[i][2]));
    // the structure of this bridge
    componentKind = 'structure';
    // what lies under the deck: the rim's shore, the open sea, or a ward's platform (its
    // quay reaches out to the sea wall; nothing may be founded on or against it)
    const platformAt = (x, z, pad = 0) => recs.some((r) => { const lx = x - r.w.x, lz = z - r.w.z; return Math.abs(lx) < r.half && Math.abs(lz) < r.half && r.sea.sample(lx, lz) < pad; });
    const clear = (p) => p.y - 3.2 - Math.max(ground(p.x, p.z), 0);
    const res = { stayed: styleStayed, arches: styleArches, suspension: styleSuspension, grand: styleGrand, tiedArch: styleTiedArch, extradosed: styleExtradosed, lotus: styleLotus }[style](parts, S, ground, colliders, clear);
    // ---- supports: every metre of the deck is carried. Cable- and arch-hung stretches
    // and the style's own piers are carried; the girder between them never spans more
    // than one pier pitch. The deck leaves the bridgehead (or a ward's quay) and lands
    // on the ward's terrace wall across its quay, with a pier founded 16 m off the sea wall.
    componentKind = 'support';
    const spacing = Math.min(res.spacing || 200, 200);
    let sA = 18, sB = S.L - 18;
    for (let s = 0; s < S.L * 0.3; s += 2) { const q = S.at(s / S.L).p; if (!platformAt(q.x, q.z, 16)) { sA = Math.max(sA, s); break; } }
    for (let s = S.L; s > S.L * 0.7; s -= 2) { const q = S.at(s / S.L).p; if (!platformAt(q.x, q.z, 16)) { sB = Math.min(sB, s); break; } }
    const cover = [];
    for (const [a, b] of res.carried || []) cover.push([a * S.L, b * S.L]);
    for (const u of [...(res.points || []), ...(res.pierAt || [])]) cover.push([u * S.L - 12, u * S.L + 12]);
    cover.sort((x, y) => x[0] - y[0]);
    const pierS = [];
    const startPier = !head;                 // a link bridge leaves a ward's quay, not a podium
    let reach = sA;
    const fill = (a, b, lastIsPier) => {
      const n = Math.max(1, Math.ceil((b - a) / spacing));
      for (let k = 1; k <= (lastIsPier ? n : n - 1); k++) pierS.push(a + (b - a) * k / n);
    };
    if (startPier) pierS.push(sA);
    for (const [a, b] of cover) {
      if (b <= sA || a >= sB) continue;
      if (a > reach + 24) fill(reach, a, false);
      reach = Math.max(reach, b);
    }
    if (sB > reach + 4) fill(reach, sB, true);
    for (const u of res.pierAt || []) pierS.push(u * S.L);
    for (const sp of pierS) {
      const u = sp / S.L, { p, t, side } = S.at(u);
      if (platformAt(p.x, p.z, 10)) continue;
      const c = clear(p);
      if (c < 0.5) continue;                 // the web rests on the rim's grade here
      if (c < 7 || ground(p.x, p.z) > 0.5) { trestle(parts, p, side, (x, z) => (ground(x, z) > 0.5 ? ground(x, z) : seaFloor(x, z, 3))); continue; }
      res.pier(parts, p, seaFloor(p.x, p.z), t, side);
    }
    const ends = [];
    const rec = recs.find((r) => r.w.id === bp.ward);
    const L = rec.landings[0];
    ends.push({ x: rec.w.x + L.station.x, z: rec.w.z + L.station.z, rot: L.station.rot, base: path[N].y, lo: path[N].y - 1.6, ward: bp.ward, end: 'ward' });
    if (head) {
      ends.push({ x: head.station.x, z: head.station.z, rot: head.station.rot, base: path[0].y, lo: head.y - 1.5, ward: bp.ward, end: 'rim' });
    } else if (bp.from) {
      const r0 = recs.find((r) => r.w.id === bp.from);
      const L2 = r0.landings.find((q) => !q.own);
      ends.push({ x: r0.w.x + L2.station.x, z: r0.w.z + L2.station.z, rot: L2.station.rot, base: path[0].y, lo: path[0].y - 1.6, ward: bp.from, end: 'link' });
    }
    // the maglev: held on brackets beside the deck, swinging out on columns into the stations
    // (it swings out to 27 m past the pylon legs, which stand 13-21.5 m out at deck level)
    const uArc = [0];
    for (let i = 1; i <= N; i++) uArc.push(uArc[i - 1] + path[i].distanceTo(path[i - 1]));
    const towerBump = (i) => (res.towers || []).reduce((m, u) => Math.max(m, ss(95, 45, Math.abs(uArc[i] - u * S.L))), 0);
    const nearTower = (i) => (res.towers || []).some((u) => Math.abs(uArc[i] - u * S.L) < 9);
    const crossover = bp.ward === 'sunward';
    const tubeLat = res.tubeLat || 21;
    const latAt = (t, i) => {
      const normal=tubeLat+(32-tubeLat)*(ss(.07,0,t)+ss(.93,1,t))+6*towerBump(i);
      // The departure is between the canal houses and the promenade. Ease
      // outward once clear of the fixed portal so its 6 m tube has real breathing
      // room beside the canal-house eaves before climbing over the deck.
      return crossover?normal*(2*ss(.075,.17,t)-1)-3*ss(.004,.014,t)*(1-ss(.026,.042,t)):normal;
    };
    const railRise = t => crossover?12*ss(.025,.07,t)*(1-ss(.175,.22,t)):0;
    const tube = path.map((p, i) => {
      const t = i / N;
      return p.clone().addScaledVector(frameAt(path, i).side, latAt(t, i)).add(V(0, 2.8+railRise(t), 0));
    });
    const startStation=ends.find(e=>e.end!=='ward'),endStation=ends.find(e=>e.end==='ward');
    if(startStation)tube[0]=stationPortal(startStation);
    tube[N]=stationPortal(endStation);
    // the ends of the tube: run straight into each station's portal ring
    componentKind = 'maglev';
    parts.push(sweepTube(tube, () => 3.0, 12, { kind: 13 }));
    componentKind = 'maglev-support';
    let acc = 0;
    for (let i = 1; i < N; i++) {
      acc += path[i].distanceTo(path[i - 1]);
      if (acc < 24) continue;
      acc = 0;
      const t = i / N;
      const { side } = frameAt(path, i);
      const lat = latAt(t, i);
      const tp = tube[i];
      if (railRise(t)>2 && Math.abs(lat)<17.5) {
        // The Tidewater departure is on the opposite side of this spoke. A
        // short, supported flyover carries the tube above the pedestrian deck.
        const p=path[i],f=frameAt(path,i),half=24,beamTop=tp.y-2.85;
        const Q=(u,v)=>[p.x+f.t.x*u+side.x*v,p.z+f.t.z*u+side.z*v];
        parts.push(prismGeo([Q(-1.5,-half),Q(1.5,-half),Q(1.5,half),Q(-1.5,half)],beamTop-.75,beamTop,1,5));
        // Transfer the flyover to the promenade web, within its planted side
        // margins. Outside piers here would punch through Tidewater's houses.
        for(const sg of [-1,1]){const q=p.clone().addScaledVector(side,sg*12.2);parts.push(sweepTube([q.clone().setY(p.y-1.6),q.clone().setY(beamTop-.35)],()=>1.25,8,{kind:1}));}
      } else if (crossover && railRise(t)>2) {
        const a=path[i].clone().addScaledVector(side,Math.sign(lat)*12.2).add(V(0,-1.6,0));
        parts.push(sweepTube([a,a.clone().lerp(tp,.55).add(V(0,-3,0)),tp.clone().add(V(0,-2.6,0))],()=>.85,8,{kind:1}));
      } else if (nearTower(i)) {
        continue;                             // the tube passes the pylon legs on the spans' brackets
      } else if (Math.abs(lat) < 28.5 && railRise(t)<=2) {
        const a = path[i].clone().addScaledVector(side, Math.sign(lat)*12.2).add(V(0, -1.6, 0));   // inside the deck's sloped web
        parts.push(sweepTube([a, a.clone().lerp(tp, 0.5).add(V(0, -1.6, 0)), tp.clone().add(V(0, -2.6, 0))], () => 0.55, 6, { kind: 1 }));
      } else {
        const g = seaFloor(tp.x,tp.z,2);
        if (tp.y - 3 - g > 1.5) parts.push(latheFacade(capTop([{ r: 1.6, y: g - 6, kind: 1 }, { r: 1.2, y: tp.y - 4.6, kind: 1 }, { r: 2.4, y: tp.y - 2.4, kind: 1 }]), 8).translate(tp.x, 0, tp.z));
      }
    }
    // gateways astride the deck at both ends
    componentKind = 'gateway';
    const f0 = frameAt(path, 2), f1 = frameAt(path, N - 2);
    for(const [p,f]of [[path[2],f0],[path[N-2],f1]])for(const sg of [-1,1]){
      const Q=(u,v)=>[p.x+f.t.x*u+f.side.x*v,p.z+f.t.z*u+f.side.z*v];
      parts.push(prismGeo([Q(-2.2,sg*11.5),Q(2.2,sg*11.5),Q(2.2,sg*18.5),Q(-2.2,sg*18.5)],p.y-2.8,p.y-.75,1,5));
    }
    deckPortal(parts, path[2], f0.side, path[2].y + 0.2);
    deckPortal(parts, path[N - 2], f1.side, path[N - 2].y + 0.2);
    // The surveyed rim arrival retains the station's asymmetric forecourt.
    let headInfo=null;
    if(head){componentKind='bridgehead';headInfo=bridgehead(parts,head,ground);}
    componentKind='arrival';
    const arrivals=[];
    for(const [index,sign]of [[0,-1],[N,1]]){
      const p=path[index],f=frameAt(path,index),t=f.t.clone().setY(0).normalize();
      const deckTop=p.clone().add(V(0,.2,0));
      const end=deckTop.clone().addScaledVector(t,sign*15);
      end.y=index===0&&head?head.y:ground(end.x,end.z)+.025;
      const onDeck=deckTop.clone().addScaledVector(t,-sign*.15);
      parts.push(extrudeAlong([onDeck,end],[[-10.25,-.75],[10.25,-.75],[10.25,0],[-10.25,0]],()=>9));
      arrivals.push({deck:onDeck.toArray(),ground:end.toArray()});
    }
    interfaces.push({ward:bp.ward,head:headInfo,arrivals,railPath:tube,portals:ends.map(stationPortal),stations:ends});
    for (const e of ends) {
      componentKind = `station-${e.end}`;
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
  if (!parts.length) return { meshes, lod, stations, lamps, decks, colliders, interfaces };
  const mat = createFacadeMaterial('pearl', 778, { litFrac: 0.6, band: 1e5 });
  const mesh = new THREE.Mesh(mergeClean(parts), mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.name = 'Ward bridges';
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  scene.add(mesh);
  meshes.push(mesh);
  if (world && world.colliders) world.colliders.push(...colliders);
  const sl = signalLights(lights);
  if (sl) { sl.name = 'Ward bridge lights'; scene.add(sl); meshes.push(sl); }
  return { meshes, lod, stations, lamps, decks, colliders, interfaces, lights };
}
