import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { buildTug } from '../craft/craftClasses.js';
import { createCraftMaterial } from '../craft/craftMaterial.js';
import { createLamps, LAMP, LAMP_UNIFORMS } from './lamps.js';
import { KM } from './craftMesh.js';
import { craftInstances, MovingLamps } from './helianthDistrict.js';
import { truss, dish, mast, radiatorWing } from './shipKit.js';
import { droneGeo } from './lifeKit.js';
import { SwarmYard } from './swarmYard.js';

// The Helianth's own reach of the Dyson swarm, in 3D: the collector shells it sits in.
//
// The swarm near the Helianth is not a cloud but a lattice. Statite collectors (seven-facet
// hexagonal mirrors 7 km across, held on the light like the Helianth itself) stand in two
// concentric shells about the Sun: the sunward shell 140 km below the Helianth and the
// outer shell 170 km above it. Each shell is a hexagonal lattice broken every tenth row and
// column by a traffic street, so from any height the fields read as blocks and the streets as
// dark avenues running to the horizon, the shells' curvature (3.8 million km radius) bending
// them down out of sight. Over the Helianth both shells open a window (its light and its
// approaches stay clear).
//
// Every collector focuses the Sun on a receiver on three struts 2.6 km sunward of its face;
// the receiver glows with the heat it takes. Its back carries the rim truss, a crew shelter
// with lit windows, radiators edge-on to the Sun, a catwalk and a microwave dish. In each
// block's heart a power relay replaces a collector: a phased array that gathers its block's
// power and beams it to the Helianth (a faint shimmering channel, pulses running inward),
// a spun habitat ring for its crew, radiators, a beacon mast. The Helianth sends the whole
// harvest on to the Earth in one golden beam.
//
// Traffic: service tugs run the streets, and spiral-sweeping cleaning drones work the faces
// of the collectors nearest you. In the sunward shell's window new collectors are built on
// an assembly line (src/space/swarmYard.js).
//
// LOD: collectors and relays are sorted into cells; the cells near the camera draw the full
// build (near InstancedMesh), the rest a slab mirror with its receiver (mid InstancedMesh),
// both refilled only when the set of near cells changes. Beyond the built lattice the shells
// continue to 36,000 km as the glow of their receivers, one lamp per block.
//
// Units: layout in km in the station's frame (+Y away from the Sun); geometry in metres.

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TO_Y = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

export const SWARM = {
  layers: [
    { y: -140, hole: 700, pitch: 32, seed: 11 },
    { y: 170, hole: 460, pitch: 38, seed: 23 },
  ],
  street: 10,                // every tenth row and column is a street
  geoR: 3200,                // built lattice radius (km)
  farR: 36000,               // lamps to here (km)
  facetR: 1250,              // facet circumradius (m)
  rimR: 3500,                // mirror outer radius (m)
  focus: 2600,               // receiver distance sunward (m)
  nearR: 150,                // near-LOD cell reach (km)
  cell: 110,                 // LOD cell size (km)
  nearCap: 520,              // near collectors at most
  relayClear: 58,            // collectors cleared round a relay (km)
  relayNearR: 700, relayCell: 400, relayNearCap: 40,
  beamR: 1600,               // relays within this range beam to the Helianth (km)
  beamEnd: 18,               // relay beams end this far from the hub (km)
  range: 90000,              // visible within (km of the station)
  tugs: 120, tugSpeed: 1.6,  // km/s
  drones: 4, droneHosts: 48, // cleaning drones per collector, collectors served
};

/** Height (km, station frame) of shell layer y0 at horizontal (x, z); D the station's distance from the Sun. */
export function shellY(D, y0, x, z) { const R = D + y0; return -D + Math.sqrt(R * R - x * x - z * z); }

/** Hex lattice cell (i, j) of a layer -> (x, z) km, and whether it is a street or a block heart. */
export function latticeXZ(L, i, j, out) { out.x = (i + 0.5 * (j & 1)) * L.pitch; out.z = j * L.pitch * 0.8660254; return out; }
const mod = (a, n) => ((a % n) + n) % n;
export const isStreet = (i, j) => mod(i, SWARM.street) === 0 || mod(j, SWARM.street) === 0;
export const isRelay = (i, j) => mod(i, SWARM.street) === 5 && mod(j, SWARM.street) === 5;

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ------------------------------------------------------------- geometry ----
/** A statite collector in metres: mirror face at y = 0 facing -Y (the Sun), its back up +Y. */
export function buildCollector(lod = 0) {
  const B = new CB(), lamps = [];
  const { facetR: fr, rimR, focus } = SWARM;
  const hexAt = (x, z, r, t, kb, kt, y = 0) => {
    B.at(x, y - t, z); B.push(TO_Y);
    B.lathe([[0.01, 0, kb], [r, 0, kb], [r, t, kt], [0.01, t, kt]], 6, Math.PI / 6);
    B.pop(); B.pop();
  };
  if (lod > 0) {
    // mid: the slab mirror, its receiver on one strut, the shelter on the back
    hexAt(0, 0, rimR, 40, CK.PANEL, CK.DARK);
    B.box(0, -focus / 2, 0, 60, focus, 60, CK.DARK);
    B.box(0, -focus - 90, 0, 260, 220, 260, CK.BRONZE);
    B.box(0, 150, 0, 1600, 300, 240, CK.RADIATOR);
    return { geo: B.geometry(), lamps };
  }
  // seven facets, each a hair proud of the frame
  const step = fr * Math.sqrt(3) + 70;
  const centres = [[0, 0]];
  for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; centres.push([Math.cos(a) * step, Math.sin(a) * step]); }
  for (const [x, z] of centres) {
    hexAt(x, z, fr, 28, CK.PANEL, CK.DARK);
    // the facet's backing grid: two stiffeners across its back
    B.box(x, 38, z, fr * 1.6, 20, 26, CK.DARK); B.box(x, 38, z, 26, 20, fr * 1.6, CK.DARK);
  }
  // the frame: a hexagonal rim tube and six spokes on the back
  const rim = [];
  for (let k = 0; k <= 6; k++) { const a = (k % 6) / 6 * TAU + Math.PI / 6; rim.push(V(Math.cos(a) * rimR, 70, Math.sin(a) * rimR)); }
  B.tube(rim, 48, 8, CK.BRONZE);
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * TAU + Math.PI / 6;
    B.tube([V(Math.cos(a) * 260, 90, Math.sin(a) * 260), V(Math.cos(a) * (rimR - 40), 70, Math.sin(a) * (rimR - 40))], 30, 6, CK.DARK);
    // corner nodes with their nav lamps (red/green alternate, white fore and aft)
    const c = V(Math.cos(a) * rimR, 70, Math.sin(a) * rimR);
    B.box(c.x, c.y, c.z, 140, 140, 140, CK.HULL);
    lamps.push({ p: c.clone().setY(160), r: 26, color: k === 0 || k === 3 ? LAMP.WHITE : k < 3 ? LAMP.RED : LAMP.GREEN, i: 2.4, breathe: 0.5, phase: k / 6 });
  }
  // three deep trusses carry the rim midpoints to the hub
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * TAU;
    truss(B, V(Math.cos(a) * 300, 220, Math.sin(a) * 300), V(Math.cos(a) * (rimR * 0.84), 120, Math.sin(a) * (rimR * 0.84)), 90, 260, 7, CK.DARK);
  }
  // receiver: three struts from the facet ring to the focus, the boiler, its heat pipe up
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * TAU + Math.PI / 2;
    B.tube([V(Math.cos(a) * 2600, -30, Math.sin(a) * 2600), V(Math.cos(a) * 150, -focus + 60, Math.sin(a) * 150)], 22, 6, CK.DARK);
    B.box(Math.cos(a) * 2600, -40, Math.sin(a) * 2600, 110, 40, 110, CK.BRONZE);
  }
  B.at(0, -focus - 200, 0); B.push(TO_Y);
  B.lathe([[40, 0, CK.DARK], [150, 30, CK.BRONZE], [170, 120, CK.HULL], [170, 300, CK.HULL], [120, 340, CK.GLASS], [150, 380, CK.BRONZE], [60, 420, CK.DARK]], 16);
  B.pop(); B.pop();
  for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; B.box(Math.cos(a) * 172, -focus, Math.sin(a) * 172, 16, 200, 16, CK.CONDUIT); }
  B.tube([V(0, -focus + 220, 0), V(0, -30, 0)], 26, 8, CK.CONDUIT);
  lamps.push({ p: V(0, -focus - 60, 0), r: 140, color: [1.0, 0.55, 0.22], i: 4.2, breathe: 0.15 });
  // crew shelter on the back: a pressurised drum with two window bands, a dock, a hangar box
  B.at(0, 80, 0); B.push(TO_Y);
  B.lathe([[240, 0, CK.BRONZE], [260, 30, CK.HULL], [260, 90, CK.LANTERN], [260, 160, CK.HULL], [250, 200, CK.GLASS], [250, 250, CK.LANTERN], [230, 300, CK.HULL], [120, 360, CK.BRONZE], [60, 400, CK.DARK]], 20);
  B.pop(); B.pop();
  B.at(0, 480, 0); B.push(TO_Y);
  B.lathe([[40, 0, CK.DARK], [48, 30, CK.BRONZE], [48, 60, CK.HULL], [30, 80, CK.DARK]], 12); B.pop(); B.pop();
  B.box(420, 170, 0, 360, 160, 240, CK.HULL); B.box(600, 170, 0, 8, 120, 200, CK.GLASS);
  B.box(420, 256, 0, 380, 14, 260, CK.ROOF);
  lamps.push({ p: V(620, 170, 0), r: 18, color: LAMP.WHITE, i: 1.6 });
  // radiators edge-on to the Sun: four wings off the shelter
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * TAU + Math.PI / 4;
    radiatorWing(B, V(Math.cos(a) * 250, 200, Math.sin(a) * 250), V(Math.cos(a), 0, Math.sin(a)), V(-Math.sin(a), 0, Math.cos(a)), 900, 160, k % 2 ? lamps : null, LAMP.AMBER);
  }
  // a crew catwalk out along one spoke to the rim, a dish and a beacon mast
  {
    // (a kilometres-long walk: deck, handrails and posts every 60 m, lamps every 600 m)
    const a = -Math.PI / 6, L = rimR - 460;
    B.push(new THREE.Matrix4().makeRotationY(-a).setPosition(0, 104, 0));
    B.box(260 + L / 2, 0, 0, L, 1.2, 6, CK.DECK);
    for (const sd of [-1, 1]) {
      B.box(260 + L / 2, 1.1, sd * 2.9, L, 0.12, 0.12, CK.BRONZE);
      for (let x = 260; x <= 260 + L; x += 60) B.box(x, 0.55, sd * 2.9, 0.15, 1.1, 0.15, CK.DARK);
    }
    for (let x = 400; x < 260 + L; x += 600) lamps.push({ p: new THREE.Vector3(x, 3, 0).applyMatrix4(B.M), r: 3, color: LAMP.AMBER, i: 1.4, breathe: 0.1 });
    B.pop();
  }
  dish(B, V(-300, 330, 0), V(-0.6, 0.8, 0).normalize(), 90);
  const tip = mast(B, V(0, 400, 180), V(0, 1, 0), 220, 3);
  lamps.push({ p: tip.clone().setY(tip.y + 8), r: 22, color: LAMP.RED, i: 2.6, breathe: 0.8 });
  return { geo: B.geometry(), lamps };
}

/** A power relay in metres: its phased array faces +X (turned toward the Helianth), the Sun at -Y. */
export function buildRelay(lod = 0) {
  const B = new CB(), lamps = [];
  if (lod > 0) {
    B.box(0, 0, 0, 200, 4200, 200, CK.HULL);
    B.box(260, 600, 0, 60, 3600, 5200, CK.PANEL);
    B.box(0, -2400, 0, 2400, 80, 2400, CK.PANEL);
    B.push(new THREE.Matrix4().makeTranslation(0, 1400, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    B.torus(1300, 110, 16, 5, CK.LANTERN); B.pop();
    B.box(-900, 0, 0, 1400, 30, 900, CK.RADIATOR);
    return { geo: B.geometry(), lamps };
  }
  // the spine
  B.at(0, -2300, 0); B.push(TO_Y);
  B.lathe([[160, 0, CK.BRONZE], [200, 120, CK.HULL], [200, 1500, CK.HULL], [230, 1600, CK.BRONZE], [200, 1700, CK.HULL], [200, 3300, CK.PANEL], [230, 3400, CK.BRONZE], [200, 3500, CK.HULL], [200, 4300, CK.HULL], [120, 4500, CK.DARK]], 16);
  B.pop(); B.pop();
  // the phased array: 8 x 6 tiles in a frame, each a hair apart, on a backing truss
  const tw = 640, th = 560, nx = 8, ny = 6;
  for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) {
    const z = (a - (nx - 1) / 2) * (tw + 20), y = 600 + (b - (ny - 1) / 2) * (th + 20);
    B.box(420, y, z, 26, th, tw, (a + b) % 5 === 0 ? CK.GLASS : CK.PANEL);
  }
  const hz = nx * (tw + 20) / 2, hy = ny * (th + 20) / 2;
  for (const s of [-1, 1]) {
    B.box(400, 600 + s * hy, 0, 60, 60, hz * 2 + 60, CK.BRONZE);
    B.box(400, 600, s * hz, 60, hy * 2 + 60, 60, CK.BRONZE);
  }
  for (let a = 1; a < 4; a++) for (const s of [-1, 1]) B.box(360, 600, s * a * hz / 4, 40, hy * 2, 40, CK.DARK);
  truss(B, V(210, 600, -hz * 0.8), V(210, 600, hz * 0.8), 120, 300, 9, CK.DARK);
  for (const s of [-1, 1]) B.tube([V(200, 600, 0), V(360, 600 + s * hy * 0.7, s * hz * 0.5)], 40, 6, CK.DARK);
  // the rectenna underneath, facing the Sun-side fields
  B.at(0, -2320, 0); B.push(TO_Y);
  B.lathe([[60, 0, CK.DARK], [1300, 60, CK.PANEL], [1320, 120, CK.BRONZE], [1200, 150, CK.DARK], [60, 150, CK.DARK]], 24, 0, { closedProfile: false });
  B.pop(); B.pop();
  for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; B.tube([V(Math.cos(a) * 1150, -2170, Math.sin(a) * 1150), V(Math.cos(a) * 190, -1500, Math.sin(a) * 190)], 28, 6, CK.DARK); }
  // radiators, edge-on to the Sun (their planes contain the Sun line)
  for (const s of [-1, 1]) radiatorWing(B, V(-190, -600, s * 120), V(-0.2, 0, s).normalize(), V(1, 0, 0.2 * s), 2600, 520, lamps, s > 0 ? LAMP.GREEN : LAMP.RED);
  // the habitat hub (the ring itself spins: buildRelayRing), its docks and a beacon mast
  B.at(0, 1400, 0); B.push(TO_Y);
  B.lathe([[210, -260, CK.BRONZE], [320, -180, CK.HULL], [320, 180, CK.GLASS], [210, 260, CK.BRONZE]], 20); B.pop(); B.pop();
  for (const s of [-1, 1]) {
    B.tube([V(0, 1400, s * 320), V(0, 1400, s * 560)], 60, 10, CK.HULL);
    B.box(0, 1400, s * 590, 180, 180, 60, CK.BRONZE);
    lamps.push({ p: V(0, 1400, s * 640), r: 30, color: LAMP.TEAL, i: 2.2, breathe: 0.4, phase: s > 0 ? 0 : 0.5 });
  }
  const tip = mast(B, V(0, 2150, 0), V(0, 1, 0), 700, 8);
  lamps.push({ p: tip.clone().setY(tip.y + 20), r: 60, color: LAMP.TEAL, i: 4, breathe: 0.9 });
  for (const s of [-1, 1]) for (const t of [-1, 1]) lamps.push({ p: V(440, 600 + t * hy, s * hz), r: 40, color: LAMP.AMBER, i: 2.2, breathe: 0.3, phase: 0.25 * (s + t + 2) });
  // floodlights washing the array's face for the crews that tend it
  for (const s of [-1, 1]) lamps.push({ p: V(700, 600 + hy + 80, s * hz * 0.5), r: 30, color: LAMP.WHITE, i: 2.4, dir: V(-0.3, -1, 0).normalize() });
  return { geo: B.geometry(), lamps };
}

/** The relay's spun habitat ring (metres, about local +Y, centred at the hub): 1.3 km, one turn a minute. */
export const RELAY_RING = { y: 1400, R: 1300, omega: TAU / 64 };
export function buildRelayRing() {
  const B = new CB();
  B.push(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  B.torus(RELAY_RING.R, 120, 64, 10, CK.LANTERN);
  B.torus(RELAY_RING.R, 128, 64, 6, CK.GLASS, TAU / 64);
  B.pop();
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * TAU;
    B.tube([V(Math.cos(a) * 330, 0, Math.sin(a) * 330), V(Math.cos(a) * (RELAY_RING.R - 115), 0, Math.sin(a) * (RELAY_RING.R - 115))], 45, 8, CK.HULL);
  }
  for (let k = 0; k < 16; k++) { const a = (k + 0.5) / 16 * TAU; B.box(Math.cos(a) * RELAY_RING.R, 0, Math.sin(a) * RELAY_RING.R, 140, 270, 140, k % 4 ? CK.BRONZE : CK.GARDEN); }
  return B.geometry();
}

// ----------------------------------------------------------------- layout ----
/** Every collector and relay of the built lattice: { layer, i, j, p (km), kind 0 collector / 1 relay, spin, s }. */
export function swarmLayout(D) {
  const out = [];
  const p = V();
  SWARM.layers.forEach((L, li) => {
    const r = rng(L.seed);
    const n = Math.ceil(SWARM.geoR / L.pitch) + 1, m = Math.ceil(SWARM.geoR / (L.pitch * 0.866)) + 1;
    for (let j = -m; j <= m; j++) for (let i = -n; i <= n; i++) {
      latticeXZ(L, i, j, p);
      const h = Math.hypot(p.x, p.z);
      const jit = r();
      if (h > SWARM.geoR || h < L.hole || isStreet(i, j)) continue;
      out.push({ layer: li, i, j, p: V(p.x, shellY(D, L.y, p.x, p.z), p.z), kind: isRelay(i, j) ? 1 : 0, spin: 0, s: 0.92 + 0.16 * jit, tilt: r() });
    }
  });
  // clear a court round each relay
  const relays = out.filter((c) => c.kind === 1);
  const keep = out.filter((c) => {
    if (c.kind === 1) return true;
    for (const q of relays) if (q.layer === c.layer && Math.abs(q.p.x - c.p.x) < SWARM.relayClear && Math.abs(q.p.z - c.p.z) < SWARM.relayClear && q.p.distanceTo(c.p) < SWARM.relayClear) return false;
    return true;
  });
  return keep;
}

/** A collector's or relay's pose (metres in the station frame): local -Y at the Sun, local +X toward the hub (relays). */
export function swarmMatrix(D, c, out = new THREE.Matrix4()) {
  const up = V(c.p.x, c.p.y + D, c.p.z).normalize();       // away from the Sun
  let x;
  if (c.kind === 1) { x = V(-c.p.x, -c.p.y, -c.p.z); x.addScaledVector(up, -x.dot(up)).normalize(); }
  else {
    // collectors keep the lattice's heading, trimmed a fraction of a degree each (their glints break)
    const a = (c.tilt - 0.5) * 0.02;
    x = V(Math.cos(a), 0, Math.sin(a)); x.addScaledVector(up, -x.dot(up)).normalize();
  }
  const z = V().crossVectors(x, up).normalize();
  const tiltA = c.kind === 1 ? 0 : (c.tilt - 0.5) * 0.012;
  const u2 = up.clone().applyAxisAngle(z, tiltA);
  const x2 = x.clone().applyAxisAngle(z, tiltA);
  const s = c.kind === 1 ? 1 : c.s;
  out.makeBasis(x2.multiplyScalar(s), u2.multiplyScalar(s), z.multiplyScalar(s));
  out.setPosition(c.p.x * 1000, c.p.y * 1000, c.p.z * 1000);
  return out;
}

/** The streets tugs run: [{ a, b (km, station frame), layer }], rows (constant z) and avenues (constant x). */
export function swarmStreets(D, reach = 2400) {
  const out = [];
  SWARM.layers.forEach((L, li) => {
    const S = SWARM.street, rowZ = S * L.pitch * 0.8660254;
    for (let k = -8; k <= 8; k++) {
      const z = k * rowZ; if (Math.abs(z) > reach * 0.9) continue;
      const half = Math.sqrt(Math.max(reach * reach - z * z, 0));
      out.push({ layer: li, axis: 0, c: z, a: V(-half, 0, z), b: V(half, 0, z) });
      // an avenue: the zigzag gap left by column i = k*S runs on x = (k*S + 0.25) * pitch
      const x = (k * S + 0.25) * L.pitch; if (Math.abs(x) > reach * 0.9) continue;
      const hz = Math.sqrt(Math.max(reach * reach - x * x, 0));
      out.push({ layer: li, axis: 1, c: x, a: V(x, 0, -hz), b: V(x, 0, hz) });
    }
  });
  // streets may not pass under the Helianth's window at its own height: they all lie in a shell
  for (const s of out) { const L = SWARM.layers[s.layer]; s.a.y = shellY(D, L.y, s.a.x, s.a.z); s.b.y = shellY(D, L.y, s.b.x, s.b.z); }
  return out;
}

/** Tug k at time t: position (km, on its street's shell, a kilometre sunward of the mirrors' plane) and heading. */
export function tugPose(D, streets, k, t, outP, outF) {
  const st = streets[k % streets.length], L = SWARM.layers[st.layer];
  const len = st.a.distanceTo(st.b), dir = k & 1 ? 1 : -1;
  const u = ((((k * 0.6180339) % 1) * len + dir * SWARM.tugSpeed * (1 + 0.25 * ((k * 7) % 5) / 4) * t) % len + len) % len;
  const f = u / len;
  const x = st.a.x + (st.b.x - st.a.x) * f, z = st.a.z + (st.b.z - st.a.z) * f;
  const lane = (k % 3 - 1) * 1.2;                                  // three lanes a street
  const xx = st.axis === 0 ? x : x + lane, zz = st.axis === 0 ? z + lane : z;
  outP.set(xx, shellY(D, L.y, xx, zz) - 1.0, zz);
  if (st.axis === 0) outF.set(dir, 0, 0); else outF.set(0, 0, dir);
  return outP;
}

/** Cleaning drone d on a collector: a spiral pass over its sunward face (metres, collector frame). */
export function droneLocal(d, t, out) {
  const T = 420 + d * 37, u = (((t / T) + d * 0.25) % 1 + 1) % 1, s = u < 0.5 ? u * 2 : 2 - u * 2;
  const r = 2200 * Math.sqrt(s), a = s * 40 * Math.PI + d * Math.PI / 2;
  return out.set(Math.cos(a) * r, -70 - 10 * Math.sin(t * 0.3 + d), Math.sin(a) * r);
}

// ------------------------------------------------------------------ beams ----
const BEAM_VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aP;        // x: along 0..1, y: side -1..1, z: seed, w: half width (object units)
attribute float aF;       // 0: steady both ends, 1: fades out toward b
uniform vec2 uRes;
varying vec2 vUv;
varying float vLen;
varying float vSeed;
varying float vI;
varying float vF;
void main() {
  vec3 a = (modelViewMatrix * vec4(aA, 1.0)).xyz;
  vec3 b = (modelViewMatrix * vec4(aB, 1.0)).xyz;
  vec3 p = mix(a, b, aP.x);
  vec3 d = b - a;
  float s = length(modelViewMatrix[0].xyz);
  vec3 side = cross(d, p);
  float sl = length(side);
  side = sl > 1e-12 ? side / sl : vec3(1.0, 0.0, 0.0);
  float dist = max(-p.z, 1e-4);
  float pxPerUnit = uRes.y * 0.5 * projectionMatrix[1][1] / dist;
  float w = aP.w * s;
  float ww = max(w, 1.3 / max(pxPerUnit, 1e-9));
  vI = clamp(w / ww, 0.0, 1.0);
  p += side * aP.y * ww;
  vUv = aP.xy;
  vLen = length(d) / max(s, 1e-12);
  vSeed = aP.z;
  vF = aF;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;
const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGain;
uniform vec3 uColor;
uniform float uWave;      // pulse wavelength (object units)
varying vec2 vUv;
varying float vLen;
varying float vSeed;
varying float vI;
varying float vF;
void main() {
  float y = vUv.y;
  float core = exp(-y * y * 9.0) + 0.25 * exp(-y * y * 2.0);
  float along = vUv.x * vLen;
  float ph = fract(along / uWave - uTime * 0.35 + vSeed);
  float pulse = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.08, 0.5, ph));
  float shimmer = 0.85 + 0.15 * sin(along * 0.9 + uTime * 5.0 + vSeed * 30.0);
  float ends = smoothstep(0.0, 0.04, vUv.x) * (1.0 - smoothstep(0.96, 1.0, vUv.x));
  float fade = mix(1.0, (1.0 - vUv.x) * (1.0 - vUv.x), vF);
  vec3 c = uColor * core * (0.3 + 1.1 * pulse) * shimmer * ends * fade * vI * uGain;
  if (c.r + c.g + c.b < 1e-5) discard;
  gl_FragColor = vec4(c, 0.0);
}
`;

/** Ribbon beams (object units): [{ a, b, w (half width), seed, fade }], each cut into segs pieces. */
export function createBeams(list, { color = [0.5, 0.9, 1.0], gain = 1, wave = 40, segs = 24 } = {}) {
  const n = Math.max(list.length, 1), vpb = (segs + 1) * 2;
  const A = new Float32Array(n * vpb * 3), Bb = new Float32Array(n * vpb * 3), P = new Float32Array(n * vpb * 4), F = new Float32Array(n * vpb);
  const idx = [];
  list.forEach((bm, k) => {
    for (let i = 0; i <= segs; i++) for (let sd = 0; sd < 2; sd++) {
      const v = k * vpb + i * 2 + sd;
      A.set([bm.a.x, bm.a.y, bm.a.z], v * 3); Bb.set([bm.b.x, bm.b.y, bm.b.z], v * 3);
      P.set([i / segs, sd ? 1 : -1, bm.seed ?? k * 0.37, bm.w], v * 4); F[v] = bm.fade ?? 0;
    }
    for (let i = 0; i < segs; i++) { const v = k * vpb + i * 2; idx.push(v, v + 1, v + 3, v, v + 3, v + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(A.slice(), 3));   // (bounds only; the shader places the ribbon)
  g.setAttribute('aA', new THREE.Float32BufferAttribute(A, 3));
  g.setAttribute('aB', new THREE.Float32BufferAttribute(Bb, 3));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(P, 4));
  g.setAttribute('aF', new THREE.Float32BufferAttribute(F, 1));
  g.setIndex(idx);
  if (!list.length) g.setDrawRange(0, 0);
  const m = new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
    uniforms: { uRes: LAMP_UNIFORMS.uRes, uTime: LAMP_UNIFORMS.uTime, uGain: { value: gain }, uColor: { value: new THREE.Color(...color) }, uWave: { value: wave } },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, premultipliedAlpha: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = 16;
  return mesh;
}

// ------------------------------------------------------------ LOD fields ----
/**
 * Items sorted into cells; the near cells' items go to the near mesh, the rest to the mid mesh.
 * items: [{ p (km), m: Matrix4 }]. Refilled only when the set of near cells changes.
 */
export class LodField {
  constructor(items, cell, nearR, nearCap) {
    this.nearR = nearR; this.nearCap = nearCap;
    const keyOf = (p) => `${Math.floor(p.x / cell)},${Math.floor(p.y / (cell * 4))},${Math.floor(p.z / cell)}`;
    const map = new Map();
    for (const it of items) { const k = keyOf(it.p); if (!map.has(k)) map.set(k, []); map.get(k).push(it); }
    const cells = [...map.values()];
    this.n = items.length; this.nc = cells.length;
    this.mats = new Float32Array(this.n * 16);
    this.start = new Int32Array(this.nc); this.count = new Int32Array(this.nc);
    this.centre = new Float32Array(this.nc * 3); this.rad = new Float32Array(this.nc);
    this.order = [];
    let o = 0;
    cells.forEach((list, c) => {
      this.start[c] = o; this.count[c] = list.length;
      const ce = V();
      for (const it of list) ce.add(it.p);
      ce.multiplyScalar(1 / list.length);
      let r = 0;
      for (const it of list) { r = Math.max(r, it.p.distanceTo(ce)); it.m.toArray(this.mats, o * 16); this.order.push(it); o++; }
      this.centre.set([ce.x, ce.y, ce.z], c * 3); this.rad[c] = r;
    });
    this.nearCells = new Int32Array(this.nc); this.nNear = 0; this.nearItems = 0;
    this.sig = -1;
  }
  attach(nearMesh, midMesh) { this.near = nearMesh; this.mid = midMesh; }
  /** cam: camera in the field's frame (km). Returns true when the meshes were refilled. */
  update(cam, force = false) {
    let sig = 0, nn = 0, items = 0;
    for (let c = 0; c < this.nc; c++) {
      const dx = this.centre[c * 3] - cam.x, dy = this.centre[c * 3 + 1] - cam.y, dz = this.centre[c * 3 + 2] - cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - this.rad[c];
      if (d < this.nearR && items + this.count[c] <= this.nearCap) { this.nearCells[nn++] = c; items += this.count[c]; sig = (sig * 31 + c + 1) % 2147483647; }
    }
    sig = (sig * 31 + nn) % 2147483647;
    if (sig === this.sig && !force) return false;
    this.sig = sig; this.nNear = nn; this.nearItems = items;
    const na = this.near.instanceMatrix.array, ma = this.mid.instanceMatrix.array;
    let ni = 0, mi = 0, k = 0;
    for (let c = 0; c < this.nc; c++) {
      const src = this.mats.subarray(this.start[c] * 16, (this.start[c] + this.count[c]) * 16);
      if (k < nn && this.nearCells[k] === c) { na.set(src, ni * 16); ni += this.count[c]; k++; }
      else { ma.set(src, mi * 16); mi += this.count[c]; }
    }
    this.near.count = ni; this.mid.count = mi;
    this.near.instanceMatrix.needsUpdate = true; this.mid.instanceMatrix.needsUpdate = true;
    this.near.instanceMatrix.clearUpdateRanges?.(); this.mid.instanceMatrix.clearUpdateRanges?.();
    return true;
  }
}

// ------------------------------------------------------------------ swarm ----
export class HelianthSwarm {
  /** station: the Helianth's group (km, +Y away from the Sun); D: its distance from the Sun (km); sunDir: world light direction. */
  constructor(station, D, sunDir, space) {
    this.station = station; this.D = D; this.sunDir = sunDir; this.space = space;
    // (the space mode sets these groups' visibility per depth slice from their bodies; this.on is ours)
    this.group = new THREE.Group(); this.group.visible = false; station.add(this.group);
    this.beamGroup = new THREE.Group(); this.beamGroup.visible = false; station.add(this.beamGroup);
    this.built = false; this.buildMs = 0; this.on = false; this._nearGap = 1;
    this._cam = V(); this._w = V(); this._p = V(); this._f = V(); this._m = new THREE.Matrix4(); this._m2 = new THREE.Matrix4();
    this._q = new THREE.Quaternion(); this._iq = new THREE.Quaternion(); this._up = V(0, 1, 0); this._x = V(); this._z = V(); this._s = V(1, 1, 1);
    this.dist = Infinity;
    if (space?.addBody) {
      this.body = space.addBody('helianthSwarm', [this.group], (v) => (v || V()).copy(station.position), SWARM.farR, { interval: () => this.interval() });
      this.beamBody = space.addBody('helianthBeams', [this.beamGroup], (v) => (v || V()).copy(station.position), 60000, { interval: () => [Math.max(0.05, (this.dist - 60) * 0.9), this.dist + 60000 * 1.02] });
      if (this.body) this.body.visible = false;
      if (this.beamBody) this.beamBody.visible = false;
    }
  }

  /** Depth interval (km) the lattice occupies from the camera: from the nearest shell to the far rim. */
  interval() { return [Math.max(0.05, this._nearGap * 0.9), this.dist + SWARM.farR * 1.05]; }

  build() {
    if (this.built) return;
    const t0 = performance.now();
    const D = this.D;
    const opt = { accent: [1, 0.72, 0.4], lit: 0.55, fill: 0.08 };
    this.layout = swarmLayout(D);
    const cols = this.layout.filter((c) => c.kind === 0), rels = this.layout.filter((c) => c.kind === 1);
    this.collectors = cols; this.relays = rels;
    const mk = (c) => ({ p: c.p, m: swarmMatrix(D, c), c });
    // collectors
    const cNear = buildCollector(0), cMid = buildCollector(1);
    this.parts = { cNear, cMid };
    this.colField = new LodField(cols.map(mk), SWARM.cell, SWARM.nearR, SWARM.nearCap);
    const mat = createCraftMaterial(opt);
    this.mat = mat;
    this.colNear = craftInstances(cNear.geo, [], opt, mat); this.colNear.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(SWARM.nearCap * 16), 16);
    this.colMid = craftInstances(cMid.geo, [], opt, mat); this.colMid.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(cols.length, 1) * 16), 16);
    this.colField.attach(this.colNear, this.colMid);
    // relays and their spinning rings
    const rNear = buildRelay(0), rMid = buildRelay(1);
    this.parts.rNear = rNear; this.parts.rMid = rMid;
    this.relField = new LodField(rels.map(mk), SWARM.relayCell, SWARM.relayNearR, SWARM.relayNearCap);
    this.relNear = craftInstances(rNear.geo, [], opt, mat); this.relNear.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(SWARM.relayNearCap * 16), 16);
    this.relMid = craftInstances(rMid.geo, [], opt, mat); this.relMid.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(rels.length, 1) * 16), 16);
    this.relField.attach(this.relNear, this.relMid);
    this.ringGeo = buildRelayRing();
    this.rings = craftInstances(this.ringGeo, [], opt, mat); this.rings.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(SWARM.relayNearCap * 16), 16);
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (const im of [this.colNear, this.colMid, this.relNear, this.relMid, this.rings]) { im.count = 0; im.userData.sunDir = this.sunDir; this.group.add(im); }
    this.relMats = this.relField.order.map((it) => it.m);
    // lamps: every receiver's glow and every relay's beacons (static); the near collectors' nav lights
    const recv = [], relayL = [];
    const tmp = V();
    for (const it of this.colField.order) {
      tmp.set(0, -SWARM.focus - 60, 0).applyMatrix4(it.m).multiplyScalar(KM);
      const h = (it.c.i * 7 + it.c.j * 13) & 7;
      recv.push({ p: tmp.clone(), r: 0.16, color: h === 0 ? [1.0, 0.72, 0.4] : [1.0, 0.5, 0.2], i: 1.8 + 0.25 * h, breathe: 0.2, phase: (h / 8) });
    }
    for (const it of this.relField.order) for (const l of rNear.lamps) relayL.push({ ...l, p: l.p.clone().applyMatrix4(it.m).multiplyScalar(KM), r: l.r * KM * 1.5 });
    this.recvLamps = createLamps(recv, { minPx: 1.0, gain: 0.8 });
    this.relayLamps = createLamps(relayL, { minPx: 1.1 });
    this.group.add(this.recvLamps, this.relayLamps);
    const navSrc = cNear.lamps.filter((l) => l.r < 100);
    this.navPer = navSrc.length;
    this.nav = new MovingLamps(SWARM.nearCap * this.navPer, { r: 0.03, color: LAMP.WHITE, i: 2.2, minPx: 1.1, breathe: 0.5 });
    { const C = this.nav.mesh.geometry.getAttribute('iCol').array; for (let k = 0; k < SWARM.nearCap * this.navPer; k++) { const l = navSrc[k % this.navPer], i = l.i ?? 2; C[k * 4] = l.color[0] * i; C[k * 4 + 1] = l.color[1] * i; C[k * 4 + 2] = l.color[2] * i; } }
    this.navLocal = navSrc.map((l) => l.p.clone());
    this.nav.mesh.geometry.instanceCount = 0;
    this.group.add(this.nav.mesh);
    // far shells: one receiver glow per block out to 36,000 km, the streets dark between
    const far = [];
    const fp = V();
    SWARM.layers.forEach((L, li) => {
      const S = SWARM.street, bw = S * L.pitch, bh = S * L.pitch * 0.8660254, r = rng(L.seed * 7 + 1);
      const n = Math.ceil(SWARM.farR / bw), m = Math.ceil(SWARM.farR / bh);
      for (let j = -m; j < m; j++) for (let i = -n; i < n; i++) {
        fp.set((i + 0.5) * bw, 0, (j + 0.5) * bh);
        const h = Math.hypot(fp.x, fp.z), q = r();
        if (h < SWARM.geoR || h > SWARM.farR) continue;
        fp.y = shellY(D, L.y, fp.x, fp.z);
        far.push({ p: fp.clone(), r: 2.2, color: q < 0.08 ? LAMP.TEAL : q < 0.5 ? [1.0, 0.6, 0.28] : [1.0, 0.48, 0.2], i: (q < 0.08 ? 2.2 : 1.1 + q) * (li ? 0.8 : 1), breathe: 0.25, phase: q });
      }
    });
    this.farLamps = createLamps(far, { minPx: 1.0, gain: 1 });
    this.group.add(this.farLamps);
    // beams: relays in reach beam to the Helianth's crown; the Helianth's beam to the Earth
    const beams = [];
    for (const it of this.relField.order) {
      if (Math.hypot(it.p.x, it.p.z) > SWARM.beamR) continue;
      // (the array's centre, km: its matrix is in metres)
      const src = V(420, 600, 0).applyMatrix4(it.m).multiplyScalar(KM);
      const dst = src.clone().normalize().multiplyScalar(SWARM.beamEnd);
      dst.y = 2.2 + Math.sign(src.y) * 3;
      beams.push({ a: src, b: dst, w: 0.9, seed: (it.c.i * 0.13 + it.c.j * 0.31) % 1 });
    }
    this.relayBeams = createBeams(beams, { color: [0.35, 0.75, 1.0], gain: 0.9, wave: 60 });
    this.mainBeam = createBeams([{ a: V(0, 16, 0), b: V(0, 60000, 0), w: 3.5, seed: 0.2, fade: 1 }], { color: [1.0, 0.72, 0.36], gain: 1.4, wave: 900, segs: 48 });
    this.beamGroup.add(this.relayBeams, this.mainBeam);
    this.beamCount = beams.length;
    // service tugs on the streets
    this.streets = swarmStreets(D);
    const tug = buildTug(120);
    this.tugGeo = tug.geo;
    this.tugs = craftInstances(tug.geo, [], opt, mat); this.tugs.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(SWARM.tugs * 16), 16);
    this.tugs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.tugs.count = SWARM.tugs; this.tugs.userData.sunDir = this.sunDir;
    this.group.add(this.tugs);
    this.tugLamps = new MovingLamps(SWARM.tugs * 2, { r: 0.012, color: LAMP.WHITE, i: 3, minPx: 1.2 });
    { const C = this.tugLamps.mesh.geometry.getAttribute('iCol').array; for (let k = 0; k < SWARM.tugs; k++) C.set([LAMP.AMBER[0] * 2.4, LAMP.AMBER[1] * 2.4, LAMP.AMBER[2] * 2.4], (k * 2 + 1) * 4); }
    this.group.add(this.tugLamps.mesh);
    // cleaning drones over the nearest collectors' faces
    const nd = SWARM.drones * SWARM.droneHosts;
    this.droneGeo = droneGeo(14);
    this.dronesIM = craftInstances(this.droneGeo, [], opt, mat); this.dronesIM.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(nd * 16), 16);
    this.dronesIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.dronesIM.count = 0; this.dronesIM.userData.sunDir = this.sunDir;
    this.group.add(this.dronesIM);
    this.droneLamps = new MovingLamps(nd, { r: 0.008, color: LAMP.TEAL, i: 2.4, minPx: 1.0 });
    this.droneLamps.mesh.geometry.instanceCount = 0;
    this.group.add(this.droneLamps.mesh);
    this.hosts = new Int32Array(SWARM.droneHosts); this.nHosts = 0; this._hd = new Float32Array(SWARM.nearCap);
    // the yard where collectors are built, in the sunward shell's window (src/space/swarmYard.js)
    this.yard = new SwarmYard(this.group, D, this.sunDir);
    this.group.traverse((o) => { o.frustumCulled = false; });
    this.beamGroup.traverse((o) => { o.frustumCulled = false; });
    this.built = true;
    this.buildMs = performance.now() - t0;
  }

  /** Station-frame camera -> refill the LOD sets, the nav lights and the drone hosts when they change. */
  _refill(cam, force) {
    const changed = this.colField.update(cam, force);
    this.relField.update(cam, force);
    if (!changed) return;
    // nav lights of the near collectors
    const n = this.colNear.count, arr = this.colNear.instanceMatrix.array, m = this._m, p = this._p;
    for (let i = 0; i < n; i++) {
      m.fromArray(arr, i * 16);
      for (let k = 0; k < this.navPer; k++) { p.copy(this.navLocal[k]).applyMatrix4(m).multiplyScalar(KM); this.nav.set(i * this.navPer + k, p); }
    }
    this.nav.mesh.geometry.instanceCount = n * this.navPer; this.nav.commit();
    // drone hosts: the nearest near collectors (a partial selection, no allocation)
    const hd = this._hd;
    for (let i = 0; i < n; i++) { const dx = arr[i * 16 + 12] * KM - cam.x, dy = arr[i * 16 + 13] * KM - cam.y, dz = arr[i * 16 + 14] * KM - cam.z; hd[i] = dx * dx + dy * dy + dz * dz; }
    const H = Math.min(SWARM.droneHosts, n);
    for (let h = 0; h < H; h++) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < n; i++) if (hd[i] < bd) { bd = hd[i]; best = i; }
      this.hosts[h] = best; hd[best] = Infinity;
    }
    this.nHosts = H;
    this.dronesIM.count = H * SWARM.drones;
    this.droneLamps.mesh.geometry.instanceCount = H * SWARM.drones;
  }

  update(realTime, camWorld, sim) {
    if (!camWorld) return;
    this.station.getWorldPosition(this._w);
    this.dist = camWorld.distanceTo(this._w);
    const on = this.dist < SWARM.range;
    if (on && !this.built) this.build();
    this.on = on && this.built;
    this.group.visible = this.beamGroup.visible = this.on;
    if (this.body) this.body.visible = this.on;
    if (this.beamBody) this.beamBody.visible = this.on;
    if (!this.on) return;
    // camera in the station frame (km)
    const cam = this._cam.copy(camWorld).sub(this._w).applyQuaternion(this._iq.copy(this.station.quaternion).invert());
    this._refill(cam, false);
    // the nearest shell's thickness (receivers 2.8 km sunward, relays and tugs within 4 km)
    let gap = Infinity;
    for (const L of SWARM.layers) gap = Math.min(gap, Math.abs(cam.y - shellY(this.D, L.y, cam.x, cam.z)) - 4.5);
    this._nearGap = Math.max(0.05, gap);
    this.animate(realTime, cam, sim);
  }

  animate(t, cam, sim) {
    const m = this._m, m2 = this._m2, p = this._p, f = this._f;
    // relay rings spin (near relays only)
    const nr = this.relNear.count, ra = this.relNear.instanceMatrix.array;
    m2.makeRotationY((t * RELAY_RING.omega) % TAU).setPosition(0, RELAY_RING.y, 0);
    for (let i = 0; i < nr; i++) { m.fromArray(ra, i * 16).multiply(m2); this.rings.setMatrixAt(i, m); }
    this.rings.count = nr; this.rings.instanceMatrix.needsUpdate = true;
    // tugs
    for (let k = 0; k < SWARM.tugs; k++) {
      tugPose(this.D, this.streets, k, t, p, f);
      const up = this._x.set(p.x, p.y + this.D, p.z).normalize();
      const side = this._z.crossVectors(up, f).normalize();
      m.makeBasis(side, up, f).setPosition(p.x * 1000, p.y * 1000, p.z * 1000);
      this.tugs.setMatrixAt(k, m);
      this.tugLamps.set(k * 2, p.addScaledVector(f, 0.07));
      this.tugLamps.set(k * 2 + 1, p.addScaledVector(f, -0.12));
    }
    this.tugs.instanceMatrix.needsUpdate = true; this.tugLamps.commit();
    // drones
    const ca = this.colNear.instanceMatrix.array;
    for (let h = 0; h < this.nHosts; h++) {
      m.fromArray(ca, this.hosts[h] * 16);
      for (let d = 0; d < SWARM.drones; d++) {
        droneLocal(d + h * 3, t, p);
        m2.makeTranslation(p.x, p.y, p.z).premultiply(m);
        const k = h * SWARM.drones + d;
        this.dronesIM.setMatrixAt(k, m2);
        p.set(0, 0, 0).applyMatrix4(m2).multiplyScalar(KM);
        this.droneLamps.set(k, p);
      }
    }
    if (this.nHosts) { this.dronesIM.instanceMatrix.needsUpdate = true; this.droneLamps.commit(); }
    this.yard.animate(t);
    // the Helianth's beam: toward the Earth (at the world origin), in the station's frame
    if (sim) {
      p.copy(this._w).negate().normalize().applyQuaternion(this._iq);
      this.mainBeam.quaternion.setFromUnitVectors(this._up, p);
    }
  }

  /** Rendered triangles now (instanced counts included). */
  triangles() {
    if (!this.built) return 0;
    const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    let n = 0;
    for (const im of [this.colNear, this.colMid, this.relNear, this.relMid, this.rings, this.tugs, this.dronesIM]) n += tri(im.geometry) * im.count;
    return n + this.yard.triangles();
  }
}
