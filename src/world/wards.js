import { SD } from './platform.js';
import { ST, T, TAU } from './wardPlan.js';
import { tidewaterRii, carveRii, rioDistance, fondamente, canalMouth, RIO } from './wardsA/tidewaterCanals.js';
import { auroraCircus, ORRERY, seraphSummit, sunwardDial } from './wardsA/civicGardens.js';

// The seven Outer Wards of Greater Meridian, each designed as a city in its own right.
//
//   Aurora      the Academy of the Heavens: a meridian grid, the Ecliptic, the Circus of the
//               planets, colleges and crystal laboratories, the Great Observatory on its hill
//   Tidewater   the City of Tides: a Grand Canal, a ring canal and water streets through the
//               platform, canal houses, the Tidehall galleria, marinas at the canal mouths
//   Sunward     the Solar Ward: a heliostat field tracking the sun round a receiver crown,
//               crescents and rays of a sun-plan town, the Heliodrome, the mirror terraces
//   Seraph      the Hanging Gardens: an acropolis of planted terraces climbing to the crown,
//               grand stairs, the Cascade falling to a bathing beach
//   Southmarch  the Grand Harbour: an enclosed basin with finger piers and sea-ships, moles
//               and lighthouses, warehouses, a marina, and the mooring mast of the sky-ships
//   Coral Reach the Living Reef: a ring of reef-like land round a lagoon open to the sea,
//               coral streets, dome houses, glass domes half under the water
//   Westmere    the Civic Crown: a Beaux-Arts axis from the triumphal arch to the Opera Shell,
//               Museum Mile, rond-points, parterres, the amphitheatre above the western sea
//
// Local frame: metres from the ward centre, +x east, +z south; bearing a points (cos a, sin a).

/** Lobed outline of a ward: radius factor at bearing a (ward frame). */
export function wardShape(w, a) {
  const p = w.seed * 1.7;
  return 1 + 0.055 * Math.sin(3 * a + p) + 0.035 * Math.sin(5 * a + 2.1 * p) + 0.018 * Math.sin(9 * a + 0.7 * p);
}

const P = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const inArc = (a, a0, a1) => { const d = angDiff(a, a0), e = angDiff(a1, a0); return e >= 0 ? d >= 0 && d <= e : d <= 0 && d >= e; };
const bearing = (x, z) => Math.atan2(z, x);
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

/** Common streets: an esplanade along the outer quay, split around any water. */
function esplanade(ctx, off, cls = ST.ESPLANADE, hw) {
  return { pts: T.arc(0, 0, (a) => ctx.R(a) - ctx.quayW(a) - off, 0, TAU, 8), cls, hw, name: 'esplanade', noBridges: true };
}

/** A grid of straight lines (rotated), clipped by keep(p). */
function gridLines({ ox = 0, oz = 0, rot = 0, sx, sz, ext, clsX, clsZ, avenueEvery = 0, keep, lanesX = false }) {
  const out = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  const W = (u, v) => [ox + u * c - v * s, oz + u * s + v * c];
  const n = Math.ceil(ext / sx), m = Math.ceil(ext / sz);
  for (let k = -n; k <= n; k++) {
    const cls = avenueEvery && k % avenueEvery === 0 ? ST.AVENUE : clsX;
    for (const run of T.split([W(k * sx, -ext), W(k * sx, ext)], keep)) out.push({ pts: run, cls, k, axis: 'x' });
  }
  for (let k = -m; k <= m; k++) {
    const cls = avenueEvery && k % avenueEvery === 0 ? ST.AVENUE : clsZ;
    for (const run of T.split([W(-ext, k * sz), W(ext, k * sz)], keep)) out.push({ pts: run, cls, k, axis: 'z' });
  }
  void lanesX;
  return out;
}

/** Typology mixes shared by several wards. */
const pick = (R, table) => {
  let tot = 0; for (const [, p] of table) tot += p;
  let r = R() * tot, acc = 0;
  for (const [t, p] of table) { acc += p; if (r < acc) return t; }
  return table[table.length - 1][0];
};

// ======================================================================= AURORA ==
const aurora = {
  palette: 'silver',
  lowrise: { palette: 'silver', warmth: 0.12, litFrac: 0.55, lampTint: [0.86, 0.93, 1.06] },
  ground: { pave: [0.70, 0.71, 0.72], pave2: [0.55, 0.57, 0.60], style: 0, zone: [0.80, 0.80, 0.78], lamp: [0.82, 0.9, 1.0], inlay: [0.62, 0.48, 0.28], inlayGlow: [0.55, 0.85, 1.0] },
  wall: { arcade: 12, lower: 1, band: 10 },
  quayW: (a) => 22,
  shape(ctx) {
    const { R, sea, top } = ctx;
    const rN = R(-Math.PI / 2);
    // Observatory Point: a promontory carrying the observatory hill to the north
    const tipZ = -rN - 360;
    sea.union(SD.capsule(0, -rN + 80, 0, -rN - 300, 150)).union(SD.circle(0, tipZ, 210));
    top.union(SD.capsule(0, -rN + 80, 0, -rN - 300, 128)).union(SD.circle(0, tipZ, 186));
    const hill = ctx.addLevel(19, 'hill');
    hill.union(SD.circle(0, tipZ, 132));
    // the research harbour, a basin cut into the east side, sheltered by a short mole
    const rE = R(0);
    sea.sub(SD.rbox(rE - 60, 70, 185, 72, 0, 22));
    top.sub(SD.rbox(rE - 60, 70, 207, 94, 0, 30));
    sea.union(SD.capsule(rE - 40, -44, rE + 190, -44, 9));
    ctx.features.lighthouses.push({ x: rE + 190, z: -44, h: 34, style: 'crystal' });
    ctx.features.basins.push({ x: rE - 60, z: 70, hw: 185, hd: 72, rot: 0, kind: 'harbour' });
    ctx.features.docks.push({ x: rE - 90, z: 70 + 72 - 16, rot: 0, len: 110, beam: 18 }, { x: rE - 160, z: 70 - 72 + 16, rot: Math.PI, len: 90, beam: 16 });
    ctx.features.ghats.push({ a0: 1.2, a1: 1.95 });             // the Lyceum Steps along the south
    ctx.features.ghats.push({ a0: ctx.b + 0.12, a1: ctx.b + 0.36 });
    ctx.observatory = { x: 0, z: tipZ };
  },
  plan(ctx) {
    const { R, rnd } = ctx;
    const streets = [], squares = [], plazas = [], parks = [], sites = [], landmarks = [], lots = [], inlays = [], beds = [], zones = [], pools = [], trees = [];
    const paths = [], accessRoutes = [], lamps = [], parterres = [];
    const circusR = 282;
    const O = ctx.observatory;
    const inCircus = (p) => Math.hypot(p[0], p[1]) < circusR + 10;
    const nearHill = (p) => Math.hypot(p[0] - O.x, p[1] - O.z) < 150;
    // the meridian grid: 150 m bays east-west, 130 m north-south
    const keep = (p) => !inCircus(p) && !nearHill(p) && !(Math.abs(p[0]) < 14 && p[1] < 0);
    for (const g of gridLines({ sx: 150, sz: 130, ext: 1700, clsX: ST.STREET, clsZ: ST.STREET, avenueEvery: 3, keep })) {
      if (g.axis === 'x' && g.k === 0) continue;
      streets.push({ pts: g.pts, cls: g.cls, name: g.axis === 'x' ? 'meridian street' : 'parallel street' });
    }
    // lanes halving the long east-west blocks
    for (const g of gridLines({ ox: 75, sx: 150, sz: 1e9, ext: 1700, clsX: ST.LANE, clsZ: ST.LANE, keep })) if (g.axis === 'x') streets.push({ pts: g.pts, cls: ST.LANE, noBridges: true });
    // Meridian Way: the great north-south avenue, from the south quay through the Circus to the hill
    streets.push({ pts: T.line(0, R(Math.PI / 2) - 40, 0, 570), cls: ST.AVENUE, hw: 12, name: 'Meridian Way' });
    for (const side of [-1, 1]) streets.push({ pts: T.curve([[0, 570], [side * 104, 540], [side * 104, 398], [0, 360]], 4), cls: ST.AVENUE, hw: 7, name: 'Library Crescent' });
    streets.push({ pts: T.line(0, 360, 0, circusR + 4), cls: ST.AVENUE, hw: 12, name: 'Meridian Way' });
    streets.push({ pts: T.line(0, -circusR - 4, 0, O.z + 70), cls: ST.AVENUE, hw: 12, name: 'Meridian Way' });
    // the Ecliptic: from the bridge landing across the ward
    const L = ctx.landing;
    const eb = ctx.b;
    streets.push({ pts: T.line(L.x - Math.cos(eb) * 30, L.z - Math.sin(eb) * 30, Math.cos(eb) * (circusR + 4), Math.sin(eb) * (circusR + 4)), cls: ST.AVENUE, hw: 11, name: 'the Ecliptic' });
    const eb2 = eb + Math.PI;
    streets.push({ pts: T.line(Math.cos(eb2) * (circusR + 4), Math.sin(eb2) * (circusR + 4), Math.cos(eb2) * (R(eb2) - 60), Math.sin(eb2) * (R(eb2) - 60)), cls: ST.AVENUE, hw: 11, name: 'the Ecliptic' });
    // the Circus ring and the esplanade
    streets.push({ pts: T.ring(0, 0, circusR + 4, 7), cls: ST.ESPLANADE, hw: 7, name: 'Circus of the Planets', noLots: false });
    streets.push(esplanade(ctx, 9));
    // squares and plazas (the Circus floor itself is laid out with the orrery, below)
    squares.push({ x: O.x, z: O.z, r: 128, kind: 'plaza', noLamps: true });
    plazas.push({ x: L.x - Math.cos(eb) * 48, z: L.z - Math.sin(eb) * 48, hw: 44, hd: 56, rot: eb, kind: 'landing' });
    // the meridian line down the whole ward and the Ecliptic, inlaid in bronze
    inlays.push({ pts: T.line(0, R(Math.PI / 2) - 30, 0, O.z + 120, 6), w: 0.22 });
    inlays.push({ pts: T.line(Math.cos(eb) * 270, Math.sin(eb) * 270, Math.cos(eb2) * 270, Math.sin(eb2) * 270), w: 0.14 });
    // the planetarium north-west of the crown and the armillary south-east, in the Circus
    landmarks.push({ type: 'planetarium', x: -196, z: -118, r: 30 });
    landmarks.push({ type: 'armillary', x: 186, z: 150, r: 18 });
    sites.push({ x: -196, z: -118, r: 46 }, { x: 186, z: 150, r: 26 });
    // the Circus of the Planets: an orrery round the crown (the Sun), every planet on its
    // own orbit clear of the arcology's footprint, the giants' orbits drawn in box hedges
    {
      const monuments = [[-196, -118, 46], [186, 150, 26]];
      const C = auroraCircus(T, { axes: [-Math.PI / 2, Math.PI / 2, eb, eb2], keepClear: (x, z, m) => monuments.some(([mx, mz, mr]) => Math.hypot(x - mx, z - mz) < mr + m) || ORRERY.some((p) => Math.hypot(x - Math.cos(p.a) * p.orbit, z - Math.sin(p.a) * p.orbit) < p.s + 4 + m) });
      squares.push(...C.squares); inlays.push(...C.inlays); sites.push(...C.sites); landmarks.push(...C.landmarks);
      parks.push(...C.parks); paths.push(...C.paths); lamps.push(...C.lamps);
    }
    // the observatory on its hill, the stair up from Meridian Way
    landmarks.push({ type: 'observatory', x: O.x, z: O.z + 6, r: 44, y: 19 });
    sites.push({ x: O.x, z: O.z, r: 132, margin: 0, blockStreets: true, streetShape: SD.circle(O.x, O.z + 6, 84), name: 'Great Observatory' });
    // the Library of Aurora, south on Meridian Way
    landmarks.push({ type: 'library', x: 0, z: 468, rot: 0, w: 150, d: 42 });
    sites.push({ box: { x: 0, z: 468, hw: 80, hd: 26 }, blockStreets: true, name: 'Library of Aurora' });
    plazas.push({ x: 0, z: 404, hw: 78, hd: 22, kind: 'forecourt' });
    paths.push({ pts: T.line(-104, 404, 104, 404), w: 6 }, { pts: T.line(0, 404, 0, 442.2), w: 7 });
    accessRoutes.push({ name: 'Library forecourt', pts: [[0, 404], [0, 442.2]], y: 9, halfWidth: 5 });
    for (const side of [-1, 1]) {
      const pts = [[0, O.z + 90], [side * 5.5, O.z + 77], [side * 5.5, O.z + 70]];
      paths.push({ pts: T.curve(pts, 2), w: 2.5 });
      accessRoutes.push({ name: 'Observatory entrance', pts, y: 19, halfWidth: 1.5 });
    }
    // gardens: the Academy Gardens to the west, the Sky Garden by the harbour
    parks.push({ box: { x: -610, z: -250, hw: 150, hd: 104, round: 24 }, paths: [T.curve([[-760, -300], [-650, -210], [-520, -260], [-460, -180]]), T.curve([[-700, -150], [-600, -300], [-520, -350]])], pond: { x: -600, z: -250, r: 26 }, trees: 0.8 });
    pools.push({ x: -600, z: -250, r: 24 });
    parks.push({ x: 820, z: -390, r: 105, paths: [T.arc(820, -390, 60, 0, TAU, 5)], trees: 0.9 });
    parks.push({ x: -420, z: 700, r: 90, paths: [T.curve([[-490, 660], [-420, 710], [-350, 690]])], trees: 1 });
    // colleges: cloistered quads in the blocks round the Circus
    for (const [cx, cz] of [[375, 195], [-375, 195], [375, -195], [-375, -195], [225, 325], [-225, 325], [225, -325], [-225, -325]]) {
      lots.push({ x: cx, z: cz, w: 104, d: 84, rot: Math.abs(cx) > 300 ? (cx > 0 ? -Math.PI / 2 : Math.PI / 2) : (cz > 0 ? Math.PI : 0), type: 'college', floors: 4, cls: ST.STREET, civic: true, program: 'Academy quadrangle' });
      const approach = Math.abs(cx) > 300 ? [[Math.sign(cx) * 300, cz], [cx - Math.sign(cx) * 42.7, cz]] : [[cx, Math.sign(cz) * 260], [cx, cz - Math.sign(cz) * 42.7]];
      paths.push({ pts: approach, w: 3.5 });
      accessRoutes.push({ name: 'Academy gate', pts: approach, y: 9, halfWidth: 2 });
    }
    const lotRule = {
      size: (cls, R) => (cls === ST.LANE ? [14 + R() * 12, 16 + R() * 8] : [22 + R() * 26, 22 + R() * 18]),
      type: (Lt, R) => {
        if (Lt.type) return Lt.type;
        if (Lt.lx > 420 && Math.abs(Lt.lz) < 520 && Lt.cls !== ST.LANE) return R() < 0.72 ? 'crystal' : 'ribbon';
        if (Lt.cls === ST.LANE) return pick(R, [['mews', 0.45], ['stack', 0.3], ['crystal', 0.25]]);
        return pick(R, [['ribbon', 0.3], ['crystal', 0.16], ['terrace', 0.16], ['cloister', 0.14], ['tower', Lt.centre > 0.35 && Lt.w > 26 ? 0.16 : 0], ['stack', 0.08]]);
      },
      floors: (Lt, R) => (Lt.floors ? Lt.floors : Lt.type === 'tower' ? 14 + Math.floor(R() * 10) : Lt.type === 'crystal' ? 3 + Math.floor(R() * 4) : 4 + Math.round(Lt.centre * (4 + R() * 7)) + Math.floor(R() * 3)),
    };
    return { streets, squares, plazas, parks, sites, landmarks, lots, inlays, beds, zones, pools, trees, lotRule, paths, accessRoutes, lamps, parterres };
  },
};

// ==================================================================== TIDEWATER ==
const TIDE_GRAND = [[-1420, 580], [-1000, 470], [-650, 360], [-300, 300], [60, 300], [380, 225], [640, 30], [860, -280], [1080, -600], [1360, -880]];
const tidewater = {
  palette: 'jade',
  canalBoats: true,
  lowrise: { palette: 'jade', warmth: 0.95, litFrac: 0.6, lampTint: [1.05, 0.95, 0.82] },
  ground: { pave: [0.62, 0.52, 0.44], pave2: [0.50, 0.38, 0.30], style: 1, zone: [0.6, 0.55, 0.48], lamp: [1.0, 0.68, 0.38], inlay: [0.5, 0.42, 0.3], inlayGlow: [1.0, 0.7, 0.4] },
  wall: { arcade: 5, lower: 1, band: 10 },
  quayW: (a) => 16,
  shape(ctx) {
    const { R, sea, top } = ctx;
    const grand = T.curve(TIDE_GRAND, 8);
    ctx.grand = grand;
    sea.sub(SD.polyline(grand, 21));
    top.sub(SD.polyline(grand, 28));
    // the ring canal (the Singel) and two radial canals out to the sea
    const ring = T.ring(0, 0, 730, 8);
    sea.sub(SD.polyline(ring, 11));
    top.sub(SD.polyline(ring, 17));
    ctx.ringCanal = 730;
    for (const a of [-1.66, 1.32]) {
      const pts = T.radial(0, 0, a, 720, R(a) + 60);
      sea.sub(SD.polyline(pts, 9));
      top.sub(SD.polyline(pts, 15));
    }
    // the rii: the Crescent off the Grand Canal and the radial rii of the outer belt
    ctx.rii = tidewaterRii(ctx);
    carveRii(ctx.rii, sea, top);
    // marinas at the Grand Canal's mouths: basins cut into the platform where the canal
    // runs 150 m inside the outline, so the pontoons lie in sheltered water between quays
    // (walking the curve itself; the old chord test put both basins out in the open sea)
    const mouths = [];
    for (const fromEnd of [false, true]) {
      const m = canalMouth(grand, R, fromEnd, 150);
      if (!m) continue;
      mouths.push(m);
      sea.sub(SD.rbox(m.x, m.z, 118, 66, m.rot, 24));
      top.sub(SD.rbox(m.x, m.z, 134, 82, m.rot, 30));
      ctx.features.basins.push({ x: m.x, z: m.z, hw: 118, hd: 66, rot: m.rot, kind: 'marina', channel: 21 });
    }
    ctx.mouths = mouths;
    ctx.features.ghats.push({ a0: 0.55, a1: 0.95 });
  },
  plan(ctx) {
    const { R, rnd } = ctx;
    const streets = [], squares = [], plazas = [], parks = [], sites = [], landmarks = [], lots = [], inlays = [], beds = [], zones = [], pools = [], trees = [];
    const grand = ctx.grand;
    // fondamenta: canal-side streets along both banks of every canal
    for (const s of [-1, 1]) streets.push({ pts: T.offset(grand, s * 34), cls: ST.STREET, hw: 5, name: 'fondamenta grande', noBridges: true, canal: true });
    const rc = ctx.ringCanal;
    streets.push({ pts: T.ring(0, 0, rc - 24, 7), cls: ST.STREET, hw: 5, name: 'fondamenta interna', noBridges: true });
    streets.push({ pts: T.ring(0, 0, rc + 24, 7), cls: ST.STREET, hw: 5, name: 'fondamenta esterna', noBridges: true });
    for (const a of [-1.66, 1.32]) for (const s of [-1, 1]) {
      const pts = T.offset(T.radial(0, 0, a, rc + 20, R(a) - 30), s * 21);
      streets.push({ pts, cls: ST.LANE, hw: 4, name: 'fondamenta', noBridges: true });
    }
    // the esplanade bridges the mouths of the rii and radial canals (never the Grand Canal
    // or a marina: those gaps are far longer than a footbridge)
    streets.push({ ...esplanade(ctx, 8), noBridges: false, bridgeMax: 46 });
    // fondamenta along both banks of every rio
    streets.push(...fondamente(ctx.rii));
    // the Calle Grande from the bridge landing to the Twin Tides, and the cross street over the
    // Grand Canal (its bridge is the Tidehall); south of the Crescent it continues as a street
    const L = ctx.landing;
    streets.push({ pts: T.curve([[L.x, L.z], [L.x * 0.7, L.z * 0.7 - 20], [-420, -120], [-220, -60]], 6), cls: ST.AVENUE, hw: 9, name: 'Calle Grande' });
    streets.push({ pts: T.line(-40, -250, -40, 470, 6), cls: ST.STREET, hw: 6, name: 'Ruga dei Mercanti', bridge: 'tidehall', bridgeMax: 110 });
    streets.push({ pts: T.line(-40, 470, -40, 700, 6), cls: ST.STREET, hw: 6, name: 'Ruga dei Mercanti', bridgeMax: 60 });
    streets.push({ pts: T.line(40, -R(-Math.PI / 2) + 40, 40, -260, 6), cls: ST.STREET, hw: 5, name: 'Ruga Nord' });
    // main streets crossing the ring canal on bridges
    for (const a of [-2.5, -0.7, 0.35, 2.2, 2.75]) streets.push({ pts: T.radial(0, 0, a, 330, R(a) - 30, 6), cls: ST.STREET, hw: 5.5, name: 'calle' });
    // calli: a lane grid turned to the canal's general run. They stop at the Grand Canal and
    // the Singel, but cross the rii on hump-backed footbridges where they meet them nearly
    // square-on (an oblique crossing leaves a longer gap and simply ends at the fondamenta)
    const onRio = (p) => rioDistance(ctx.rii, p[0], p[1]) < RIO.top + 4;
    const keep = (p) => (ctx.levelAt(p[0], p[1], 3) !== null || onRio(p)) && Math.hypot(p[0], p[1] + 30) > 262;
    for (const g of gridLines({ rot: -0.62, sx: 78, sz: 64, ext: 1300, clsX: ST.LANE, clsZ: ST.LANE, keep })) streets.push({ pts: g.pts, cls: ST.LANE, bridgeMax: 31, name: 'calle' });
    // squares: the Piazza della Marea at the landing, campi along the canals
    const eb = ctx.b;
    plazas.push({ x: L.x - Math.cos(eb) * 56, z: L.z - Math.sin(eb) * 56, hw: 60, hd: 52, rot: eb, kind: 'landing' });
    const camp = [L.x - Math.cos(eb) * 56 + Math.cos(eb + Math.PI / 2) * 44, L.z - Math.sin(eb) * 56 + Math.sin(eb + Math.PI / 2) * 44];
    landmarks.push({ type: 'campanile', x: camp[0], z: camp[1], h: 96, s: 11 });
    sites.push({ x: camp[0], z: camp[1], r: 12, blockStreets: true, name: 'Campanile' });
    // campi: two of them sit inside the Crescent's arms, on the calli that bridge it
    for (const [x, z, r] of [[-560, -40, 34], [520, -120, 34], [175, 470, 28], [-860, 180, 30], [760, -560, 30], [-300, 450, 26]]) squares.push({ x, z, r, kind: 'village' });
    squares.push({ x: 0, z: -30, r: 262, kind: 'crown', noLamps: true });
    // gardens
    parks.push({ x: 720, z: 60, r: 95, paths: [T.curve([[650, 20], [720, 80], [790, 40]])], trees: 1 });
    parks.push({ x: -150, z: -520, r: 80, paths: [T.arc(-150, -520, 45, 0, TAU, 5)], trees: 1 });
    pools.push({ x: -150, z: -520, r: 18 });
    // waterfront arcades along the quay by the landing
    landmarks.push({ type: 'arcade', along: 'top', a0: eb - 0.32, a1: eb + 0.32, h: 7 });
    // canal gondola maglev over the Grand Canal (built with the transit network)
    ctx.features.canalLine = grand;
    const lotRule = {
      size: (cls, R, st) => (st && st.name && st.name.startsWith('fondamenta') ? [7 + R() * 3.5, 15 + R() * 6] : cls === ST.LANE ? [8 + R() * 6, 14 + R() * 6] : [16 + R() * 20, 18 + R() * 14]),
      gap: (cls, R) => 0.35 + R() * 0.2,
      minW: 6,
      type: (Lt, R) => {
        const name = Lt.street && Lt.street.name;
        if (name && name.startsWith('fondamenta')) return R() < 0.86 ? 'canal' : 'arcade';
        if (Lt.cls === ST.LANE) return R() < 0.7 ? 'canal' : 'mews';
        if (name === 'Calle Grande' || name === 'esplanade') return R() < 0.6 ? 'arcade' : 'canal';
        return pick(R, [['arcade', 0.3], ['canal', 0.3], ['cloister', 0.15], ['terrace', 0.1], ['ribbon', 0.15]]);
      },
      floors: (Lt, R) => (Lt.type === 'canal' ? 3 + Math.floor(R() * 3) : Lt.type === 'arcade' ? 4 + Math.floor(R() * 3) : 4 + Math.floor(R() * 4)),
    };
    for (const L0 of []) lots.push(L0);
    return { streets, squares, plazas, parks, sites, landmarks, lots, inlays, beds, zones, pools, trees, lotRule, lotGap: 0.4 };
  },
};

// ====================================================================== SUNWARD ==
const sunward = {
  palette: 'bronze',
  lowrise: { palette: 'bronze', warmth: 0.8, litFrac: 0.5, lampTint: [1.08, 0.9, 0.66] },
  ground: { pave: [0.78, 0.66, 0.48], pave2: [0.64, 0.50, 0.34], style: 2, zone: [0.86, 0.84, 0.8], lamp: [1.0, 0.64, 0.28], inlay: [0.78, 0.58, 0.26], inlayGlow: [1.0, 0.65, 0.25] },
  wall: { arcade: 5, lower: 1, band: 7 },
  quayW: (a) => (inArc(a, 0.3, 1.45) ? 16 + 54 * smooth(0, 0.18, Math.min(angDiff(a, 0.3), angDiff(1.45, a))) : 18),
  shape(ctx) {
    ctx.features.mirrorTerraces = { a0: 0.36, a1: 1.39 };
  },
  plan(ctx) {
    const { R, rnd } = ctx;
    const streets = [], squares = [], plazas = [], parks = [], sites = [], landmarks = [], lots = [], inlays = [], beds = [], zones = [], pools = [], trees = [];
    const west0 = Math.PI / 2 + 0.12, west1 = 1.5 * Math.PI - 0.12;
    // crescents of the sun-plan town (west half), rays between them
    const cres = [[330, ST.STREET], [450, ST.AVENUE], [570, ST.STREET], [690, ST.AVENUE], [810, ST.STREET]];
    for (const [r, cls] of cres) streets.push({ pts: T.arc(0, 0, r, west0, west1, 7), cls, name: 'crescent' });
    for (let k = 0; k <= 12; k++) {
      const a = west0 + ((west1 - west0) * k) / 12;
      streets.push({ pts: T.radial(0, 0, a, 250, R(a) - 40, 6), cls: k % 2 ? ST.STREET : ST.AVENUE, name: 'ray' });
      if (k < 12) { const am = a + (west1 - west0) / 24; streets.push({ pts: T.radial(0, 0, am, 450, R(am) - 40, 6), cls: ST.LANE, name: 'lane', noBridges: true }); }
    }
    streets.push(esplanade(ctx, 9));
    streets.push({ pts: T.ring(0, 0, 250, 6), cls: ST.ESPLANADE, hw: 7, name: 'Sun Circle' });
    // the heliostat field (east half): white gravel, service paths radiating from the receiver
    const e0 = -Math.PI / 2 + 0.1, e1 = Math.PI / 2 - 0.1;
    zones.push({ prim: { bbox: [-1200, -1200, 1200, 1200], d: (x, z) => { const a = Math.atan2(z, x), r = Math.hypot(x, z); if (!inArc(a, e0 - 0.05, e1 + 0.05)) return 20; return Math.max(236 - r, r - (R(a) - 40)); } }, v: 1, reserve: true });
    const paths = [];
    for (let k = 0; k <= 18; k++) { const a = e0 + ((e1 - e0) * k) / 18; paths.push({ pts: T.radial(0, 0, a, 250, R(a) - 44, 6), w: k % 3 === 0 ? 2.4 : 1.2 }); }
    for (const r of [420, 610, 800]) paths.push({ pts: T.arc(0, 0, r, e0, e1, 6), w: 2.0 });
    const heliostats = { a0: e0, a1: e1, r0: 262, r1: (a) => R(a) - 52, rowStep: 12, colStep: 9.5, paths };
    landmarks.push({ type: 'heliostats', ...heliostats });
    // the Heliodrome on the axis to the bridge, the Plaza of Dawn with its gnomon at the landing
    const b = ctx.b, L = ctx.landing;
    const hx = Math.cos(b) * 530, hz = Math.sin(b) * 530;
    landmarks.push({ type: 'heliodrome', x: hx, z: hz, rot: b, s: 96 });
    sites.push({ box: { x: hx, z: hz, hw: 64, hd: 64, rot: b }, margin: 2, blockStreets: true, name: 'Heliodrome' });
    // An unbroken processional circuit serves the four stair feet; the crescent and
    // radial streets join it instead of crossing the temple's stepped volume.
    streets.push({ pts: T.ring(hx, hz, 104, 4), cls: ST.STREET, hw: 5, name: 'Heliodrome Procession', noLots: true });
    const accessRoutes = [];
    for (let k = 0; k < 4; k++) {
      const a = b + k * Math.PI / 2, p = [[hx + Math.cos(a) * 104, hz + Math.sin(a) * 104], [hx + Math.cos(a) * 60, hz + Math.sin(a) * 60]];
      paths.push({ pts: p, w: 6 });
      accessRoutes.push({ name: 'Heliodrome public stair', pts: p, y: 9, halfWidth: 4 });
    }
    squares.push({ x: hx, z: hz, r: 92, kind: 'plaza', noLamps: true });
    plazas.push({ x: L.x - Math.cos(b) * 46, z: L.z - Math.sin(b) * 46, hw: 52, hd: 46, rot: b, kind: 'landing' });
    const gx = L.x - Math.cos(b) * 50, gz = L.z - Math.sin(b) * 50;
    landmarks.push({ type: 'gnomon', x: gx, z: gz, h: 28 });
    sites.push({ x: gx, z: gz, r: 4 });
    for (let h = 0; h < 13; h++) {
      const a = -Math.PI + (h / 12) * Math.PI;
      inlays.push({ pts: [[gx + Math.cos(a) * 8, gz + Math.sin(a) * 8], [gx + Math.cos(a) * 40, gz + Math.sin(a) * 40]], w: h % 3 === 0 ? 0.2 : 0.1 });
    }
    inlays.push({ pts: T.arc(gx, gz, 40, -Math.PI, 0, 3), w: 0.12 });
    for (const r of [156, 200]) inlays.push({ pts: T.ring(0, 0, r, 5), w: 0.15 });
    squares.push({ x: 0, z: 0, r: 240, kind: 'crown', noLamps: true });
    // the Sun Dial: the receiver crown is its gnomon
    {
      const rays = []; for (let k = 0; k <= 12; k++) rays.push(west0 + ((west1 - west0) * k) / 12);
      const D = sunwardDial(T, { rays });
      inlays.push(...D.inlays); sites.push(...D.sites); landmarks.push(...D.landmarks); trees.push(...D.trees);
    }
    // gardens of the sun-plan: citrus groves between the crescents
    parks.push({ x: -560, z: -260, r: 70, trees: 1.2, paths: [T.arc(-560, -260, 38, 0, TAU, 5)] });
    parks.push({ x: -620, z: 250, r: 64, trees: 1.2, paths: [T.arc(-620, 250, 34, 0, TAU, 5)] });
    pools.push({ x: -560, z: -260, r: 14 }, { x: -620, z: 250, r: 12 });
    const lotRule = {
      size: (cls, R) => (cls === ST.LANE ? [14 + R() * 10, 15 + R() * 8] : [22 + R() * 22, 22 + R() * 16]),
      type: (Lt, R) => (Lt.cls === ST.LANE ? pick(R, [['solar', 0.5], ['mews', 0.5]]) : pick(R, [['solar', 0.5], ['terrace', 0.2], ['ribbon', 0.15], ['tower', Lt.centre > 0.4 && Lt.w > 26 ? 0.1 : 0], ['pavilion', 0.05]])),
      floors: (Lt, R) => (Lt.type === 'tower' ? 12 + Math.floor(R() * 8) : 3 + Math.round(Lt.centre * (3 + R() * 5)) + Math.floor(R() * 2)),
    };
    return { streets, squares, plazas, parks, sites, landmarks, lots, inlays, beds, zones, pools, trees, lotRule, paths, accessRoutes };
  },
};

// ======================================================================= SERAPH ==
const seraph = {
  palette: 'rose',
  lowrise: { palette: 'rose', warmth: 0.85, litFrac: 0.55, lampTint: [1.06, 0.9, 0.86] },
  ground: { pave: [0.76, 0.64, 0.60], pave2: [0.62, 0.48, 0.46], style: 3, zone: [0.82, 0.74, 0.62], lamp: [1.0, 0.66, 0.56], inlay: [0.7, 0.5, 0.36], inlayGlow: [1.0, 0.6, 0.55] },
  wall: { arcade: 3, lower: 1, band: 10, terrace: 3 },
  quayW: (a) => 20,
  shape(ctx) {
    const { R } = ctx;
    const l1 = ctx.addLevel(16, 'terrace1'), l2 = ctx.addLevel(23, 'terrace2'), l3 = ctx.addLevel(30, 'crown');
    l1.apply('set', SD.radial(0, 0, (a) => R(a) * 0.66, 1200));
    l2.apply('set', SD.radial(0, 0, (a) => R(a) * 0.37, 1200));
    l3.apply('set', SD.circle(0, 0, 212));
    for (const t of ctx.towers) t.level = t.crown ? 30 : 16;
    ctx.features.beaches.push({ a0: 0.36, a1: 1.34 });
    ctx.cascade = { a: ctx.b + Math.PI, w: 34 };
  },
  plan(ctx) {
    const { R, rnd } = ctx;
    const streets = [], squares = [], plazas = [], parks = [], sites = [], landmarks = [], lots = [], inlays = [], beds = [], zones = [], pools = [], trees = [];
    const b = ctx.b, ca = ctx.cascade.a;
    const paths = [], accessRoutes = [], lamps = [];
    const onCascade = (p) => Math.abs(angDiff(Math.atan2(p[1], p[0]), ca)) * Math.hypot(p[0], p[1]) < ctx.cascade.w * 0.5 + 16 && Math.hypot(p[0], p[1]) > 190;
    const keep = (p) => !onCascade(p);
    // grand stair axes every sixty degrees (the sixth is the Cascade)
    for (let k = 0; k < 6; k++) {
      const a = b + (k * TAU) / 6;
      if (Math.abs(angDiff(a, ca)) < 0.1) continue;
      for (const run of T.split(T.radial(0, 0, a, 150, R(a) - 34, 5), keep)) streets.push({ pts: run, cls: ST.AVENUE, hw: 8, name: 'grand stair' });
    }
    // other radials: on the lower town and the first terrace
    for (let k = 0; k < 6; k++) {
      for (const f of [1 / 3, 2 / 3]) {
        const a = b + ((k + f) * TAU) / 6;
        for (const run of T.split(T.radial(0, 0, a, R(a) * 0.4, R(a) - 34, 5), keep)) streets.push({ pts: run, cls: ST.STREET, name: 'radial' });
      }
    }
    // ring streets on every level
    const rings = [[0.77, ST.STREET], [0.9, ST.STREET], [0.515, ST.AVENUE], [0.29, ST.STREET]];
    for (const [f, cls] of rings) for (const run of T.split(T.arc(0, 0, (a) => R(a) * f, 0, TAU, 6), keep)) streets.push({ pts: run, cls, name: 'terrace ring' });
    for (const run of T.split(esplanade(ctx, 8).pts, (p) => !onCascade(p) || Math.hypot(p[0], p[1]) < 300)) streets.push({ pts: run, cls: ST.ESPLANADE, name: 'esplanade', noBridges: true });
    // lanes through the lower town
    for (let k = 0; k < 36; k++) {
      const a = b + (k + 0.5) * (TAU / 36);
      for (const run of T.split(T.radial(0, 0, a, R(a) * 0.77, R(a) * 0.9), keep)) streets.push({ pts: run, cls: ST.LANE, noBridges: true });
    }
    // the crown terrace: the Summit Garden round a paved tower plaza; the landing's Gate
    {
      const axes = [];
      for (let k = 0; k < 6; k++) { const a = b + (k * TAU) / 6; axes.push(Math.abs(angDiff(a, ca)) < 0.1 ? { a: ca, clear: ctx.cascade.w / 2 + 10 } : { a, clear: 8 }); }
      const S = seraphSummit(T, { axes });
      squares.push(...S.squares); parks.push(...S.parks); pools.push(...S.pools); paths.push(...S.paths);
      trees.push(...S.trees); lamps.push(...S.lamps); landmarks.push(...S.landmarks); sites.push(...S.sites);
    }
    const L = ctx.landing;
    plazas.push({ x: L.x - Math.cos(b) * 48, z: L.z - Math.sin(b) * 48, hw: 50, hd: 50, rot: b, kind: 'landing' });
    // the Cascade: a water staircase from the crown terrace to the beach
    landmarks.push({ type: 'cascade', a: ca, r0: 150, r1: R(ca) - 1, w: ctx.cascade.w });
    zones.push({ prim: { bbox: [-1200, -1200, 1200, 1200], d: (x, z) => { const r = Math.hypot(x, z); if (r < 180) return 30; return Math.abs(angDiff(Math.atan2(z, x), ca)) * r - (ctx.cascade.w * 0.5 + 10); } }, v: 0, reserve: true });
    // pergola gardens on the terraces, flower beds along every terrace edge
    for (const [f, w] of [[0.64, 5], [0.355, 4]]) for (const run of T.split(T.arc(0, 0, (a) => R(a) * f, 0, TAU, 5), keep)) beds.push({ pts: run, w });
    // A level garden promenade gives the broad first terrace a public purpose.
    // It joins the radial stairs, with open pergola rooms between the towers.
    const promenade = T.arc(0, 0, a => R(a) * .615, 0, TAU, 4);
    for (const run of T.split(promenade, p => keep(p) && ctx.levelAt(...p, 4) === 16 && !ctx.blocked(...p, 4))) paths.push({ pts: run, w: 2.8 });
    for (let k = 0; k < 6; k++) {
      const a = b + (k + .5) * TAU / 6, r = R(a) * .615, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!keep([x, z]) || ctx.blocked(x, z, 20)) continue;
      if (Array.from({ length: 24 }, (_, i) => i * TAU / 24).some(q => ctx.levelAt(x + Math.cos(q) * 14, z + Math.sin(q) * 14, 1) !== 16)) continue;
      landmarks.push({ type: 'gardenBelvedere', name: 'Wind Garden', x, z, y: 16, rot: -a });
      sites.push({ x, z, r: 14, margin: 1 });
      accessRoutes.push({ name: 'Garden belvedere', pts: [[x + Math.sin(a) * 10, z - Math.cos(a) * 10], [x, z], [x - Math.sin(a) * 10, z + Math.cos(a) * 10]], y: 16, halfWidth: 1.8 });
    }
    for (let k = 0; k < 6; k++) {
      const a = b + ((k + 0.5) * TAU) / 6;
      parks.push({ x: Math.cos(a) * 262, z: Math.sin(a) * 262, r: 40, trees: 1, paths: [T.arc(Math.cos(a) * 262, Math.sin(a) * 262, 22, 0, TAU, 4)] });
    }
    // a garden round every tower forecourt on the first terrace
    const lotRule = {
      size: (cls, R) => (cls === ST.LANE ? [14 + R() * 10, 16 + R() * 8] : [22 + R() * 22, 24 + R() * 16]),
      type: (Lt, R) => {
        if (Lt.y >= 22) return pick(R, [['terrace', 0.5], ['pavilion', 0.25], ['cloister', 0.25]]);
        if (Lt.y >= 15) return pick(R, [['ziggurat', 0.7], ['terrace', 0.3]]);
        return Lt.cls === ST.LANE ? pick(R, [['mews', 0.5], ['terrace', 0.5]]) : pick(R, [['ziggurat', 0.5], ['terrace', 0.25], ['cloister', 0.15], ['ribbon', 0.1]]);
      },
      floors: (Lt, R) => (Lt.type === 'ziggurat' ? 4 + Math.floor(R() * 5) : 3 + Math.floor(R() * 4)),
    };
    return { streets, squares, plazas, parks, sites, landmarks, lots, inlays, beds, zones, pools, trees, lotRule, paths, accessRoutes, lamps };
  },
};

// =================================================================== SOUTHMARCH ==
const southmarch = {
  palette: 'pearl',
  lowrise: { palette: 'pearl', warmth: 0.6, litFrac: 0.6, lampTint: [1.0, 0.96, 0.9] },
  ground: { pave: [0.56, 0.56, 0.57], pave2: [0.40, 0.40, 0.42], style: 4, zone: [0.5, 0.5, 0.5], lamp: [1.0, 0.8, 0.58], inlay: [0.55, 0.45, 0.3], inlayGlow: [1.0, 0.78, 0.5] },
  wall: { arcade: 5, lower: 1, band: 10 },
  quayW: (a) => 18,
  shape(ctx) {
    const { R, sea, top } = ctx;
    const rS = R(Math.PI / 2);
    // Crown Harbour: the basin, its channel to the sea, three finger piers
    sea.sub(SD.rbox(0, 520, 330, 250, 0, 34));
    sea.sub(SD.rbox(0, 1000, 130, 340, 0, 20));
    top.sub(SD.rbox(0, 520, 354, 274, 0, 44));
    top.sub(SD.rbox(0, 1000, 154, 360, 0, 28));
    for (const x of [-175, 0, 175]) sea.union(SD.rbox(x, 440, 13, 170, 0, 6));
    // moles closing the outer roadstead, a lighthouse on each head
    const moleW = [[-300, rS - 70], [-340, rS + 170], [-250, rS + 400], [-96, rS + 505]];
    const moleE = moleW.map(([x, z]) => [-x, z]);
    for (const m of [moleW, moleE]) sea.union(SD.polyline(T.curve(m, 6), 11));
    ctx.features.lighthouses.push({ x: -96, z: rS + 505, h: 46, style: 'harbour', light: [1.0, 0.2, 0.12] }, { x: 96, z: rS + 505, h: 46, style: 'harbour', light: [0.2, 1.0, 0.4] });
    // the marina to the east
    sea.sub(SD.rbox(705, 300, 150, 100, 0, 24));
    sea.sub(SD.rbox(990, 300, 200, 46, 0, 12));
    top.sub(SD.rbox(705, 300, 166, 116, 0, 30));
    top.sub(SD.rbox(990, 300, 216, 62, 0, 16));
    ctx.features.basins.push({ x: 0, z: 520, hw: 330, hd: 250, rot: 0, kind: 'harbour' }, { x: 705, z: 300, hw: 150, hd: 100, rot: 0, kind: 'marina' });
    // sea-ships at the piers
    for (const x of [-175, 0, 175]) for (const s of [-1, 1]) if (!(x === 0 && s > 0)) ctx.features.docks.push({ x: x + s * 29, z: 470, rot: Math.PI / 2 * (s > 0 ? 1 : -1), len: 150 + (x + 200) * 0.1, beam: 22, ship: true });
    ctx.features.cranes = [340, 420, 500, 580, 660].map((z) => ({ x: 342, z, rot: Math.PI }));
    ctx.harbour = { rS };
  },
  plan(ctx) {
    const { R, rnd } = ctx;
    const streets = [], squares = [], plazas = [], parks = [], sites = [], landmarks = [], lots = [], inlays = [], beds = [], zones = [], pools = [], trees = [];
    const F = [0, 236];
    // the harbour rows round the basin and along the channel
    streets.push({ pts: T.line(-364, 236, 364, 236, 6), cls: ST.ESPLANADE, hw: 7, name: 'Harbour Front', lotSide: 1 });
    for (const s of [-1, 1]) {
      streets.push({ pts: T.line(s * 364, 236, s * 364, 800, 6), cls: ST.STREET, hw: 6, name: 'harbour row' });
      streets.push({ pts: T.line(s * 164, 800, s * 164, R(Math.PI / 2) - 40, 6), cls: ST.STREET, hw: 5, name: 'channel row' });
    }
    // the fan: rays from the Harbour Front and arcs round it
    for (let k = 0; k <= 8; k++) {
      const a = -Math.PI + 0.16 + (k / 8) * (Math.PI - 0.32);
      if (k === 4) continue;
      streets.push({ pts: T.radial(F[0], F[1], a, 40, 1500, 6), cls: k % 2 ? ST.STREET : ST.AVENUE, name: 'ray' });
    }
    for (const [r, cls] of [[250, ST.STREET], [430, ST.AVENUE], [610, ST.STREET], [800, ST.AVENUE], [990, ST.STREET], [1180, ST.STREET]]) streets.push({ pts: T.arc(F[0], F[1], r, -Math.PI + 0.05, -0.05, 7), cls, name: 'arc' });
    // lanes between the rays
    for (let k = 0; k < 16; k++) {
      const a = -Math.PI + 0.16 + ((k + 0.5) / 16) * (Math.PI - 0.32);
      streets.push({ pts: T.radial(F[0], F[1], a, 610, 1500, 6), cls: ST.LANE, noBridges: true });
    }
    // Harbour Way from the bridge landing to the Harbour Front
    const L = ctx.landing;
    streets.push({ pts: T.line(L.x, L.z + 10, 0, 236, 6), cls: ST.AVENUE, hw: 12, name: 'Harbour Way' });
    streets.push(esplanade(ctx, 8));
    // east of the basin: the marina quarter
    for (const z of [470, 600, 720]) streets.push({ pts: T.line(380, z, R(0.5) - 60, z, 6), cls: ST.STREET, name: 'marina street' });
    streets.push({ pts: T.line(520, 180, 520, 920, 6), cls: ST.STREET, name: 'marina street' });
    // squares
    squares.push({ x: F[0], z: F[1] - 60, r: 70, kind: 'civic' });
    plazas.push({ x: L.x, z: L.z + 44, hw: 56, hd: 46, kind: 'landing' });
    squares.push({ x: 0, z: -170, r: 175, kind: 'plaza', noLamps: true });
    // the passenger terminal on the west quay, warehouses along the rows
    landmarks.push({ type: 'terminal', x: -452, z: 470, rot: Math.PI / 2, w: 170, d: 58 });
    sites.push({ box: { x: -452, z: 470, hw: 34, hd: 90 }, blockStreets: true, name: 'Passenger Terminal' });
    for (const dz of [-54.4, 0, 54.4]) sites.push({ box: { x: -379.5, z: 470 + dz, hw: 46, hd: 4 }, margin: 3, name: 'Terminal transfer gallery' });
    const paths = [], accessRoutes = [];
    const passengerWalk = T.curve([[-455, 236], [-552, 315], [-552, 470], [-615, 650], [-710, 715], [-790, 865]], 4);
    paths.push({ pts: passengerWalk, w: 4 });
    paths.push({ pts: T.line(-552, 470, -481, 470), w: 7 });
    accessRoutes.push({ name: 'Terminal garden entrance', pts: [[-552, 470], [-481, 470]], y: 9, halfWidth: 4 });
    for (const z of [420, 520]) {
      landmarks.push({ type: 'passengerShelter', name: 'Harbour waiting garden', x: -518, z, rot: Math.PI / 2 });
      sites.push({ box: { x: -518, z, hw: 7, hd: 14 }, margin: 2 });
      paths.push({ pts: T.line(-558, z, -481, z), w: 3 });
      accessRoutes.push({ name: 'Passenger shelter', pts: [[-558, z], [-481, z]], y: 9, halfWidth: 1.5 });
    }
    // Sheltered rain gardens follow the landward passenger walk, leaving the
    // quay road, cranes, galleries and turning water dedicated to the port.
    for (const z of [355, 405, 565, 615]) beds.push({ box: { x: -582, z, hw: 9, hd: 17, round: 5 } });
    for (const z of [345, 390, 555, 600, 645]) trees.push({ x: -600, z, sp: 'flowering', s: 10 });
    for (let z = 280; z < 780; z += 52) if (z < 370 || z > 570) lots.push({ x: -364 - 6 - 3.5 - 12, z, w: 46, d: 24, rot: Math.PI / 2, type: 'warehouse', floors: 3, cls: ST.STREET });
    for (let z = 280; z < 780; z += 52) lots.push({ x: 364 + 6 + 3.5 + 12, z, w: 46, d: 24, rot: -Math.PI / 2, type: 'warehouse', floors: 3, cls: ST.STREET });
    landmarks.push({ type: 'cranes', list: ctx.features.cranes });
    // parks: Mariners' Park, the channel gardens
    parks.push({ x: -520, z: -800, r: 130, paths: [T.curve([[-600, -860], [-520, -790], [-440, -820]]), T.arc(-520, -800, 70, 0, TAU, 6)], trees: 1 });
    pools.push({ x: -520, z: -800, r: 22 });
    parks.push({ box: { x: -260, z: 1040, hw: 60, hd: 150, round: 20 }, trees: 1, paths: [T.line(-260, 900, -260, 1180)] });
    parks.push({ box: { x: 260, z: 1040, hw: 60, hd: 150, round: 20 }, trees: 1, paths: [T.line(260, 900, 260, 1180)] });
    const lotRule = {
      size: (cls, R, st) => (st && st.name === 'harbour row' ? [40 + R() * 12, 22 + R() * 6] : cls === ST.LANE ? [14 + R() * 10, 16 + R() * 8] : [22 + R() * 26, 22 + R() * 18]),
      type: (Lt, R) => {
        const name = Lt.street && Lt.street.name;
        if (name === 'harbour row' || name === 'channel row') return R() < 0.75 ? 'warehouse' : 'arcade';
        if (name === 'Harbour Front' || name === 'marina street') return R() < 0.6 ? 'arcade' : 'ribbon';
        if (Lt.cls === ST.LANE) return pick(R, [['mews', 0.4], ['warehouse', 0.3], ['stack', 0.3]]);
        return pick(R, [['ribbon', 0.3], ['tower', Lt.centre > 0.3 && Lt.w > 26 ? 0.3 : 0], ['terrace', 0.12], ['cloister', 0.12], ['warehouse', 0.1], ['stack', 0.06]]);
      },
      floors: (Lt, R) => (Lt.type === 'tower' ? 15 + Math.floor(R() * 12) : Lt.type === 'warehouse' ? 3 + Math.floor(R() * 3) : 5 + Math.round(Lt.centre * (5 + R() * 8)) + Math.floor(R() * 3)),
    };
    return { streets, squares, plazas, parks, sites, landmarks, lots, inlays, beds, zones, pools, trees, lotRule, paths, accessRoutes };
  },
};

// ======================================================================== CORAL ==
function coralStreets(ctx, rnd, keep) {
  const out = [];
  const R = ctx.R;
  const grow = (x, z, h, cls, depth, len) => {
    const pts = [[x, z]];
    let a = h, curv = 0;
    for (let s = 0; s < len; s += 8) {
      curv = curv * 0.86 + (rnd() - 0.5) * 0.09;
      const rad = Math.atan2(z, x);
      a += curv + angDiff(rad, a) * 0.05;
      x += Math.cos(a) * 8; z += Math.sin(a) * 8;
      if (Math.hypot(x, z) > R(Math.atan2(z, x)) - 44) break;
      pts.push([x, z]);
      if (depth < 2 && s > 90 && rnd() < 0.035) {
        grow(x, z, a + (rnd() < 0.5 ? -1 : 1) * (0.55 + rnd() * 0.3), depth === 0 ? ST.STREET : ST.LANE, depth + 1, len * 0.55);
      }
    }
    if (pts.length > 3) for (const run of T.split(pts, keep)) out.push({ pts: run, cls, name: 'coral way', noBridges: cls === ST.LANE });
  };
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU + rnd() * 0.15;
    if (Math.abs(angDiff(a, Math.PI / 2)) < 0.14 || Math.abs(angDiff(a, Math.PI)) < 0.14) continue;
    grow(Math.cos(a) * 372, Math.sin(a) * 372, a, ST.STREET, 0, 900);
  }
  return out;
}
const coral = {
  palette: 'sand',
  lowrise: { palette: 'sand', warmth: 0.55, litFrac: 0.55, lampTint: [0.86, 1.0, 1.04] },
  ground: { pave: [0.84, 0.80, 0.72], pave2: [0.70, 0.62, 0.54], style: 5, zone: [0.86, 0.78, 0.64], lamp: [0.62, 0.95, 1.0], inlay: [0.3, 0.6, 0.62], inlayGlow: [0.3, 0.95, 1.0] },
  wall: { arcade: 5, lower: 1, band: 10, glow: [0.25, 0.9, 1.0] },
  quayW: (a) => 16,
  shape(ctx) {
    const { R, sea, top } = ctx;
    // the reef lagoon, its islet, and two channels to the open sea
    sea.sub(SD.circle(0, 0, 330));
    top.sub(SD.circle(0, 0, 346));
    sea.sub(SD.capsule(0, 280, 0, R(Math.PI / 2) + 80, 32));
    top.sub(SD.capsule(0, 280, 0, R(Math.PI / 2) + 80, 44));
    sea.sub(SD.capsule(-280, 0, -R(Math.PI) - 80, 0, 32));
    top.sub(SD.capsule(-280, 0, -R(Math.PI) - 80, 0, 44));
    sea.union(SD.circle(0, 0, 166));
    top.union(SD.circle(0, 0, 150));
    // a reef coastline: coves bitten into the edge, spurs of reef between them
    for (const [a, r] of [[-0.35, 80], [1.0, 70], [2.85, 64], [4.1, 76], [5.2, 58]]) {
      const c = P(a, R(a) + 18);
      sea.sub(SD.circle(c[0], c[1], r));
      top.sub(SD.circle(c[0], c[1], r + 18));
    }
    for (const [a, r] of [[0.35, 70], [1.95, 64], [3.55, 70], [4.7, 60]]) {
      const c = P(a, R(a) - 6);
      sea.union(SD.circle(c[0], c[1], r));
      top.union(SD.circle(c[0], c[1], r - 16));
    }
    ctx.features.beaches.push({ a0: 0.72, a1: 1.28 }, { a0: 3.85, a1: 4.35 });
    ctx.features.ghats.push({ inner: true, a0: 2.0, a1: 2.9 }, { inner: true, a0: -0.9, a1: -0.2 });
    ctx.features.basins.push({ x: 0, z: 0, r: 330, kind: 'lagoon' });
    ctx.features.domes = [[240, 1.1, 26], [250, 1.9, 18], [236, 2.6, 30], [252, 3.8, 20], [240, 4.5, 24], [244, 5.3, 16], [258, 0.4, 14]].map(([r, a, s]) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r, r: s }));
  },
  plan(ctx) {
    const { R, rnd } = ctx;
    const streets = [], squares = [], plazas = [], parks = [], sites = [], landmarks = [], lots = [], inlays = [], beds = [], zones = [], pools = [], trees = [];
    const keep = (p) => ctx.levelAt(p[0], p[1], 2) !== null;
    streets.push({ pts: T.ring(0, 0, 366, 6), cls: ST.ESPLANADE, hw: 6.5, name: 'Lagoon Walk' });
    for (const [f, cls] of [[0.6, ST.STREET], [0.8, ST.STREET]]) {
      const pts = T.curve(Array.from({ length: 24 }, (_, k) => { const a = (k / 24) * TAU; const rr = R(a) * f * (1 + 0.04 * Math.sin(a * 5 + 1.3)); return P(a, rr); }), 6, true);
      streets.push({ pts, cls, name: 'reef ring' });
    }
    streets.push(...coralStreets(ctx, rnd, keep));
    streets.push(esplanade(ctx, 8));
    // causeways to the islet
    const L = ctx.landing;
    streets.push({ pts: T.line(L.x, L.z, Math.cos(ctx.b) * 372, Math.sin(ctx.b) * 372, 6), cls: ST.AVENUE, hw: 9, name: 'Reef Way' });
    // causeways across the lagoon to the islet of the crown
    const bridges = [], paths = [], accessRoutes = [];
    // The second arrival sits east of the northern navigation channel. Its old
    // 2.4-radian bearing ended inside that channel with no receiving bank.
    for (const [a, hw] of [[ctx.b, 6], [ctx.b + 2.15, 5]]) {
      bridges.push({ a: P(a, 352), b: P(a, 146), hw, y: 9, cls: ST.STREET, style: 'causeway' });
      const pts = [P(a, 352), P(a, 379)];
      paths.push({ pts, w: hw });
      accessRoutes.push({ name: 'Reef causeway arrival', pts, y: 9, halfWidth: Math.min(3, hw - 1) });
    }
    squares.push({ x: 0, z: 0, r: 146, kind: 'crown', noLamps: true });
    plazas.push({ x: L.x - Math.cos(ctx.b) * 44, z: L.z - Math.sin(ctx.b) * 44, hw: 46, hd: 44, rot: ctx.b, kind: 'landing' });
    // reef gardens: sand paths between coral-coloured beds
    for (const [a, r, s] of [[0.9, 560, 90], [3.2, 600, 80], [5.6, 640, 70], [2.2, 820, 60]]) {
      const c = P(a, r);
      const paths = [T.curve([[c[0] - s, c[1]], [c[0], c[1] - s * 0.4], [c[0] + s, c[1] + s * 0.2]]), T.curve([[c[0], c[1] - s], [c[0] + s * 0.3, c[1]], [c[0] - s * 0.2, c[1] + s]])];
      parks.push({ x: c[0], z: c[1], r: s, paths, trees: 0.7, reef: true });
      for (let k = 0; k < 9; k++) { const aa = rnd() * TAU, rr = Math.sqrt(rnd()) * s * 0.75; beds.push({ x: c[0] + Math.cos(aa) * rr, z: c[1] + Math.sin(aa) * rr, r: 3 + rnd() * 6 }); }
      zones.push({ x: c[0], z: c[1], r: s - 4, v: 0.8 });
    }
    // glass domes half under the lagoon, coral pavilions on the islet
    landmarks.push({ type: 'domes', list: ctx.features.domes });
    const lotRule = {
      size: (cls, R) => (cls === ST.LANE ? [12 + R() * 10, 14 + R() * 8] : [18 + R() * 20, 20 + R() * 14]),
      type: (Lt, R) => (Lt.cls === ST.LANE ? pick(R, [['reef', 0.7], ['mews', 0.3]]) : pick(R, [['reef', 0.6], ['terrace', 0.15], ['stack', 0.1], ['ribbon', 0.15]])),
      floors: (Lt, R) => (Lt.type === 'reef' ? 2 + Math.floor(R() * 4) : 3 + Math.floor(R() * 4)),
    };
    return { streets, squares, plazas, parks, sites, landmarks, lots, inlays, beds, zones, pools, trees, lotRule, bridges , paths, accessRoutes };
  },
};

// ===================================================================== WESTMERE ==
const westmere = {
  palette: 'marble',
  lowrise: { palette: 'marble', warmth: 0.7, litFrac: 0.62, lampTint: [1.04, 0.96, 0.86] },
  ground: { pave: [0.80, 0.78, 0.74], pave2: [0.34, 0.33, 0.34], style: 6, zone: [0.78, 0.72, 0.6], lamp: [1.0, 0.84, 0.64], inlay: [0.66, 0.52, 0.3], inlayGlow: [1.0, 0.8, 0.5] },
  wall: { arcade: 5, lower: 1, band: 10 },
  quayW: (a) => 20,
  shape(ctx) {
    const { R, sea, top } = ctx;
    const rW = R(Math.PI);
    // the Opera promontory to the west
    sea.union(SD.capsule(-rW + 100, 0, -rW - 250, 0, 140)).union(SD.circle(-rW - 280, 0, 180));
    top.union(SD.capsule(-rW + 100, 0, -rW - 250, 0, 120)).union(SD.circle(-rW - 280, 0, 160));
    ctx.opera = { x: -rW - 280, z: 0 };
    // the amphitheatre cut into the south-west edge, open to the sea
    const aa = 2.55;
    const c = P(aa, R(aa) - 70);
    top.sub(SD.circle(c[0], c[1], 132));
    ctx.amph = { x: c[0], z: c[1], a: aa, r0: 44, r1: 132 };
    ctx.features.ghats.push({ a0: aa - 0.1, a1: aa + 0.1 });
  },
  plan(ctx) {
    const { R, rnd } = ctx;
    const streets = [], squares = [], plazas = [], parks = [], sites = [], landmarks = [], lots = [], inlays = [], beds = [], zones = [], pools = [], trees = [], parterres = [];
    const A = ctx.amph, O = ctx.opera;
    const L = ctx.landing;
    const nearAmph = (p) => Math.hypot(p[0] - A.x, p[1] - A.z) < A.r1 + 12;
    const inMall = (p) => p[0] < -250 && p[0] > -1000 && Math.abs(p[1]) < 62;
    const inRond = (p) => Math.hypot(p[0], p[1]) < 250;
    const museumPrecinct = (p) => p[0] > 250 && p[0] < 1130 && Math.abs(p[1]) < 106;
    const operaPrecinct = (p) => Math.hypot(p[0] - (O.x - 10), p[1]) < 145;
    const keep = (p) => !nearAmph(p) && !inMall(p) && !inRond(p) && !museumPrecinct(p) && !operaPrecinct(p);
    // Museum Mile: the great boulevard from the triumphal arch to the Civic Tower
    streets.push({ pts: T.line(256, 0, 1140, 0, 4), cls: ST.AVENUE, hw: 7, name: 'Museum Mile', noLots: true });
    streets.push({ pts: T.curve([[L.x - 16, L.z], [1130, L.z + 70], [1140, -100], [1140, 0]], 4), cls: ST.AVENUE, hw: 10, name: 'Concorde Approach', noLots: true });
    for (const s of [-1, 1]) streets.push({ pts: T.line(270, s * 104, 1120, s * 104, 4), cls: ST.STREET, hw: 5, name: 'Museum Service Court', lotSide: s > 0 ? 1 : -1 });
    // the Mall: twin avenues either side of the Mere, the long reflecting pool
    for (const s of [-1, 1]) streets.push({ pts: T.line(-256, s * 66, -1010, s * 66, 6), cls: ST.AVENUE, hw: 8, name: 'the Mall' });
    pools.push({ box: { x: -630, z: 0, hw: 330, hd: 20, round: 2 } });
    parterres.push({ box: { x: -630, z: -40, hw: 330, hd: 12 } }, { box: { x: -630, z: 40, hw: 330, hd: 12 } });
    // the patte d'oie from the arch, diagonals from the rond-point
    const E = [L.x - 90, L.z];
    for (const s of [-1, 1]) for (const pts of T.split(T.line(1120, s * 104, 330, s * 520, 6), keep)) streets.push({ pts, cls: ST.AVENUE, hw: 10, name: 'patte d\'oie' });
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4]) for (const run of T.split(T.radial(0, 0, a, 262, R(a) - 30, 6), keep)) streets.push({ pts: run, cls: ST.AVENUE, hw: 9, name: 'diagonal' });
    streets.push({ pts: T.ring(0, 0, 262, 6), cls: ST.ESPLANADE, hw: 8, name: 'Rond-Point de la Concorde' });
    for (const run of T.split(T.ring(0, 0, 720, 7), (p) => !nearAmph(p) && !inMall(p))) streets.push({ pts: run, cls: ST.AVENUE, hw: 10, name: 'Boulevard of the Arts' });
    // the block grid between the avenues
    for (const g of gridLines({ sx: 96, sz: 110, ext: 1500, clsX: ST.STREET, clsZ: ST.STREET, keep })) {
      if (g.axis === 'z' && g.k === 0) continue;
      streets.push({ pts: g.pts, cls: g.cls, name: 'rue' });
    }
    streets.push(esplanade(ctx, 9));
    streets.push({ pts: T.line(-1010, 0, O.x + 150, 0, 6), cls: ST.AVENUE, hw: 10, name: 'Opera Walk' });
    // squares: the rond-point, rond-points on the boulevard, the arch plaza, the opera forecourt
    squares.push({ x: 0, z: 0, r: 250, kind: 'crown', noLamps: true });
    const ronds = [];
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4, 0]) { const c = P(a, 720); ronds.push(c); squares.push({ x: c[0], z: c[1], r: 38, kind: 'rond' }); }
    plazas.push({ x: E[0] + 20, z: E[1], hw: 70, hd: 80, kind: 'landing' });
    landmarks.push({ type: 'arch', x: 1060, z: 0, rot: 0, w: 58, h: 48 });
    // The arch passage is a deliberate open route. Reserve its flanking piers as
    // solids, while the seven-metre-half-width procession passes between them.
    for (const s of [-1, 1]) sites.push({ box: { x: 1060, z: s * 22, hw: 17, hd: 11 }, margin: 1, name: 'Concorde arch pier' });
    squares.push({ x: O.x + 120, z: 0, r: 70, kind: 'plaza', noLamps: true });
    landmarks.push({ type: 'opera', x: O.x - 10, z: 0, rot: Math.PI, s: 120 });
    sites.push({ x: O.x - 10, z: 0, r: 128, margin: 0, blockStreets: true, streetShape: SD.rbox(O.x - 10, 0, 67, 98, 0, 4), name: 'Opera Shell' });
    landmarks.push({ type: 'amphitheatre', ...A });
    sites.push({ x: A.x, z: A.z, r: A.r1 + 6 });
    // Museum Mile: museums with domes and porticoes both sides of the boulevard
    const paths = [], accessRoutes = [];
    for (const x of [320, 444, 568, 816, 940]) for (const s of [-1, 1]) {
      lots.push({ x, z: s * 56, w: 96, d: 50, rot: s > 0 ? Math.PI : 0, type: 'museum', floors: 4, cls: ST.AVENUE, civic: true, program: 'Museum Mile' });
      const approach = [[x, s * 6], [x, s * 27.2]];
      paths.push({ pts: approach, w: 10 });
      accessRoutes.push({ name: 'Museum portico', pts: approach, y: 9, halfWidth: 7 });
      for (const side of [-1, 1]) beds.push({ box: { x: x + side * 29, z: s * 19, hw: 12, hd: 4, round: 1 } });
    }
    // gardens: the Mere Gardens, the Jardin du Nord
    parks.push({ box: { x: -700, z: -330, hw: 150, hd: 110, round: 20 }, trees: 1, paths: [T.line(-850, -330, -550, -330), T.line(-700, -440, -700, -220), T.arc(-700, -330, 60, 0, TAU, 5)] });
    pools.push({ x: -700, z: -330, r: 20 });
    parterres.push({ box: { x: -775, z: -330, hw: 55, hd: 70 } }, { box: { x: -625, z: -330, hw: 55, hd: 70 } });
    parks.push({ box: { x: -250, z: 470, hw: 95, hd: 75, round: 20 }, trees: 1, paths: [T.curve([[-330, 430], [-250, 500], [-170, 450]])] });
    for (let k = 0; k < 44; k++) { const x = -270 - k * 17; if (x < -1000) break; for (const s of [-1, 1]) trees.push({ x, z: s * 50, sp: 'araucaria', s: 14 }); }
    for (let k = 0; k < 48; k++) { const a = (k / 48) * TAU; if ([0, Math.PI, Math.PI / 4, -Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4].some((q) => Math.abs(angDiff(a, q)) < 0.1)) continue; trees.push({ x: Math.cos(a) * 236, z: Math.sin(a) * 236, sp: 'flowering', s: 9 }); }
    inlays.push({ pts: T.line(L.x - 60, 0, 250, 0, 6), w: 0.25 });
    for (const r of [120, 180, 236]) inlays.push({ pts: T.ring(0, 0, r, 5), w: 0.12 });
    landmarks.push({ type: 'monuments', list: ronds.map(([x, z], i) => ({ x, z, kind: i % 2 ? 'obelisk' : 'fountain' })) });
    const lotRule = {
      size: (cls, R) => (cls === ST.LANE ? [14 + R() * 10, 16 + R() * 8] : [26 + R() * 22, 22 + R() * 14]),
      gap: (cls, R) => (cls === ST.AVENUE || cls === ST.STREET ? 0.6 + R() * 0.6 : 3 + R() * 3),
      type: (Lt, R) => {
        if (Lt.type) return Lt.type;
        const name = Lt.street && Lt.street.name;
        if (name === 'Museum Mile' || name === 'the Mall') return R() < 0.5 ? 'gallery' : 'mansion';
        return Lt.cls === ST.LANE ? pick(R, [['mews', 0.6], ['mansion', 0.4]]) : pick(R, [['mansion', 0.62], ['gallery', 0.14], ['cloister', 0.1], ['tower', Lt.centre > 0.45 && Lt.w > 28 ? 0.14 : 0]]);
      },
      floors: (Lt, R) => (Lt.floors ? Lt.floors : Lt.type === 'tower' ? 14 + Math.floor(R() * 8) : Lt.type === 'mansion' ? 5 + Math.floor(R() * 3) : 4 + Math.floor(R() * 3)),
    };
    return { streets, squares, plazas, parks, sites, landmarks, lots, inlays, beds, zones, pools, trees, lotRule, parterres, paths, accessRoutes };
  },
};

export const DESIGNS = { aurora, tidewater, sunward, seraph, southmarch, coral, westmere };

// A small civic institution in each ward gives the district a readable human-scale
// destination. Sites are chosen from authored neighbourhoods, before parcel allocation;
// each has a grounded court, its own architectural program and a walk to a real street.
const COURTS = {
  aurora: { name: 'Meridian Instrument House', theme: 'astronomy', r: 38, candidates: [[-845, -455], [-835, 585], [845, -455]] },
  tidewater: { name: 'House of the Tide Tables', theme: 'tidal', r: 38, candidates: [[-375, 100], [300, 460], [-475, -600], [850, 260]] },
  sunward: { name: 'Solar Guild Hall', theme: 'solar', r: 38, candidates: [[-625, 55], [-720, -190], [-520, -410]] },
  seraph: { name: 'Garden of the Six Winds', theme: 'garden', r: 36, candidates: [[-275, 165], [-240, -210], [225, -235], [200, 235]] },
  southmarch: { name: 'Harbour Exchange', theme: 'harbour', r: 44, candidates: [[-780, 590], [-710, 780], [-940, 315]] },
  coral: { name: 'Reef Conservatory', theme: 'reef', r: 40, candidates: [[-510, 330], [525, 175], [-285, -530]] },
  westmere: { name: 'Sculptors Loggia', theme: 'civic', r: 38, candidates: [[-425, 335], [-460, -195], [-1035, -330]] },
};

export function refineWardCourts(ctx, raw) {
  const C = COURTS[ctx.w.id];
  if (!C) return raw;
  const shape = (s) => s.prim || (s.poly ? SD.polygon(s.poly) : s.box ? SD.rbox(s.box.x, s.box.z, s.box.hw, s.box.hd, s.box.rot || 0, s.box.round ?? 4) : SD.circle(s.x, s.z, s.r));
  for (const [x, z] of C.candidates) {
    const y = ctx.levelAt(x, z, 3);
    if (y === null || (ctx.blocked && ctx.blocked(x, z, C.r + 12))) continue;
    if ((raw.sites || []).some((s) => shape(s).d(x, z) < C.r + 12)) continue;
    if ((raw.pools || []).some((s) => shape(s).d(x, z) < C.r + 6)) continue;
    let grounded = true;
    for (let k = 0; k < 32; k++) if (ctx.levelAt(x + Math.cos(k * TAU / 32) * (C.r + 4), z + Math.sin(k * TAU / 32) * (C.r + 4), 1) !== y) grounded = false;
    if (!grounded) continue;
    let gate = null, distance = Infinity;
    for (const st of raw.streets) for (const p of st.pts) {
      const d = Math.hypot(p[0] - x, p[1] - z);
      if (d < C.r + (st.hw ?? 6) + 20 || d > C.r + 130 || d >= distance) continue;
      if (ctx.levelAt(p[0], p[1], 4) !== y || (ctx.blocked && ctx.blocked(p[0], p[1], 3))) continue;
      let clear = true;
      for (let i = 1; i <= 12; i++) if (ctx.levelAt(x + (p[0] - x) * i / 12, z + (p[1] - z) * i / 12, 3) !== y) clear = false;
      if (clear) { gate = p; distance = d; }
    }
    if (!gate) continue;
    const dx = (gate[0] - x) / distance, dz = (gate[1] - z) / distance;
    raw.landmarks.push({ type: 'wardCourt', name: C.name, theme: C.theme, x, z, y, rot: Math.atan2(dx, dz), r: C.r });
    raw.sites.push({ x, z, r: C.r, margin: 2, blockStreets: true, streetMargin: 3, name: C.name });
    raw.squares.push({ x, z, r: C.r + 10, kind: 'forecourt', noLamps: true });
    raw.paths = raw.paths || [];
    raw.paths.push({ pts: T.line(x + dx * 19, z + dz * 19, gate[0], gate[1], 3), w: 2.4 });
    raw.extras = { ...raw.extras, civicCourt: { name: C.name, x, z, y, gate: [...gate], radius: C.r } };
    break;
  }
  return raw;
}
export { angDiff, inArc, bearing, P as polar };
