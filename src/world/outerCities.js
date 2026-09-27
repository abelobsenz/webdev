import { terrainHeight, FAR_ISLANDS, MASSIF, INNER } from './terrain.js';

// The outer cities of Greater Meridian: five island cities on the far islands (21-36 km out)
// and three terrace towns on the lower slopes of the northern massif. Each has an identity,
// a harbour on the coast that faces the capital, and a station island offshore where the
// Great Ring (or one of its far lines) surfaces.

export const OUTER_CITY_DEFS = [
  { id: 'thalassa', name: 'Thalassa', island: 0, style: 'terraced', palette: 'pearl', light: [1.0, 0.8, 0.6],
    blurb: 'a white city terraced up its island to a temple of the sea' },
  { id: 'anchorage', name: 'Anchorage', island: 1, style: 'port', palette: 'silver', light: [0.95, 0.92, 1.0],
    blurb: 'the great western port, twin towers over a harbour of long moles' },
  { id: 'orison', name: 'Orison', island: 2, style: 'needles', palette: 'bronze', light: [1.0, 0.72, 0.42],
    blurb: 'the eastern city of needle towers whose gold crowns catch the first light' },
  { id: 'vesper', name: 'Vesper', island: 3, style: 'domes', palette: 'sand', light: [1.0, 0.76, 0.5],
    blurb: 'a low town of white domes round a lagoon harbour, a spire and a lighthouse' },
  { id: 'austral', name: 'Austral', island: 4, style: 'spire', palette: 'jade', light: [0.8, 1.0, 0.92],
    blurb: 'the southern arcology city under one great spire' },
];

export const MASSIF_TOWN_DEFS = [
  { id: 'ridgeholm', name: 'Ridgeholm', massif: 2, palette: 'sand' },
  { id: 'highgate', name: 'Highgate', massif: 0, palette: 'pearl' },
  { id: 'cloudmere', name: 'Cloudmere', massif: 1, palette: 'silver' },
];

let CACHE = null;

// ------------------------------------------------------- rendered terrain --
// The outer terrain is a polar grid (terrain.js, buildOuterGeometry): 1024 bearings by 210
// rings spaced geometrically from 6.9 to 46 km. Out at the far islands its cells are 150-250 m
// across, so the surface actually drawn can sit metres off terrainHeight() between vertices.
// renderedHeight() interpolates exactly as the mesh does, so quays, podiums and buildings
// placed with it neither float nor sink.
const OA = 1024, OR = 210, OR0 = 6900, OR1 = 46000;
const vtx = (i, j) => {
  const a = (i / OA) * Math.PI * 2, r = OR0 * Math.pow(OR1 / OR0, j / OR);
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  const inside = Math.max(Math.abs(x), Math.abs(z)) < INNER.half - 30;
  return [x, terrainHeight(x, z) - (inside ? 4 : 0), z];
};
export function renderedHeight(x, z) {
  const r = Math.hypot(x, z);
  if (Math.max(Math.abs(x), Math.abs(z)) < INNER.half - 60 || r < OR0 || r > OR1) return terrainHeight(x, z);
  let th = Math.atan2(z, x);
  if (th < 0) th += Math.PI * 2;
  const fi = (th / (Math.PI * 2)) * OA, fj = (Math.log(r / OR0) / Math.log(OR1 / OR0)) * OR;
  const i = Math.floor(fi), j = Math.floor(fj);
  const a = vtx(i, j), b = vtx(i + 1, j), c = vtx(i, j + 1), d = vtx(i + 1, j + 1);
  // the mesh splits each cell into (a, b, c) and (b, d, c): interpolate on the plane of the
  // triangle that contains the point
  const bary = (p, q, s) => {
    const v0x = q[0] - p[0], v0z = q[2] - p[2], v1x = s[0] - p[0], v1z = s[2] - p[2], v2x = x - p[0], v2z = z - p[2];
    const den = v0x * v1z - v1x * v0z || 1e-9;
    const u = (v2x * v1z - v1x * v2z) / den, v = (v0x * v2z - v2x * v0z) / den;
    return [1 - u - v, u, v];
  };
  const w1 = bary(a, b, c);
  if (w1[0] >= -1e-4 && w1[1] >= -1e-4 && w1[2] >= -1e-4) return a[1] * w1[0] + b[1] * w1[1] + c[1] * w1[2];
  const w2 = bary(b, d, c);
  return b[1] * w2[0] + d[1] * w2[1] + c[1] * w2[2];
}

/** Where a ray from (cx, cz) toward bearing a crosses the rendered height h (last crossing). */
function crossing(cx, cz, a, h, maxR) {
  const d = [Math.cos(a), Math.sin(a)];
  let last = 0;
  for (let s = 0; s < maxR; s += 12) if (renderedHeight(cx + d[0] * s, cz + d[1] * s) > h) last = s;
  // refine
  let lo = last, hi = last + 12;
  for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (renderedHeight(cx + d[0] * m, cz + d[1] * m) > h) lo = m; else hi = m; }
  return { x: cx + d[0] * lo, z: cz + d[1] * lo, s: lo };
}

export function outerCities() {
  if (CACHE) return CACHE;
  const islands = OUTER_CITY_DEFS.map((def) => {
    const [ix, iz, ir, ih] = FAR_ISLANDS[def.island];
    const toward = Math.atan2(-iz, -ix);
    const d = [Math.cos(toward), Math.sin(toward)];          // toward the capital
    const side = [-d[1], d[0]];
    const coast = crossing(ix, iz, toward, 0.3, ir * 3);
    const deep = crossing(ix, iz, toward, -3.5, ir * 3);
    // the harbour line: the -3.5 m isobath either side of the axis, where the quay is built out
    const quayLine = [];
    const spread = 0.13 * (3200 / ir);
    for (let k = -6; k <= 6; k++) {
      const a = toward + (k / 6) * spread;
      const c = crossing(ix, iz, a, -3.5, ir * 3);
      quayLine.push([c.x, c.z]);
    }
    const harbour = { x: deep.x, z: deep.z };
    const station = { x: deep.x + d[0] * 640, z: deep.z + d[1] * 640 };
    return { ...def, ix, iz, ir, ih, toward, coast, deep, d, side, harbour, station, quayLine };
  });
  const massif = MASSIF_TOWN_DEFS.map((def) => {
    const m = MASSIF[def.massif];
    const toward = Math.atan2(-m.z, -m.x);
    const town = { x: m.x + Math.cos(toward) * m.r * 1.25, z: m.z + Math.sin(toward) * m.r * 1.25 };
    // the north coast below the town: walk south (toward the lagoon) from the town
    let coast = null;
    for (let z = town.z; z < town.z + 6000; z += 10) if (renderedHeight(town.x, z) < 0.3) { coast = { x: town.x, z: z - 10 }; break; }
    if (!coast) coast = { x: town.x, z: -8900 };
    let deepZ = coast.z;
    for (let z = coast.z; z < coast.z + 1500; z += 10) if (renderedHeight(town.x, z) < -4) { deepZ = z; break; }
    const station = { x: coast.x, z: Math.max(deepZ + 380, coast.z + 520) };
    return { ...def, town, coast, station, d: [0, 1], side: [-1, 0], townY: renderedHeight(town.x, town.z) };
  });
  CACHE = { islands, massif };
  return CACHE;
}
