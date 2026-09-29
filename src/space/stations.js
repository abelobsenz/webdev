import * as THREE from 'three';
import { CB, CK, sectionEllipse } from '../craft/craftGeometry.js';
import { lathe, sphere, buildShuttle, buildTug } from '../craft/craftClasses.js';
import { createCraftMaterial } from '../craft/craftMaterial.js';
import { craftMesh, craftPart, addLamps, placeMerge, placeLamps, pixelRadius } from './craftMesh.js';
import { LAMP } from './lamps.js';
import { ctube } from './hull.js';
import { R_EARTH, bodyDir } from './sim.js';
import { buildCounterweightRock } from './counterweightRock.js';

// Station frames and builders shared by the elevator, the rings and the fleet.

const _n = new THREE.Vector3(0, 1, 0);

/**
 * Local frame for a station on the tether or the Halo, in the Earth-fixed (body) frame:
 * +Y up (radial), +Z north (the Earth's axis), +X west. Orbital motion is toward -X.
 */
export function stationFrame(up, out = new THREE.Quaternion()) {
  const radial = up.clone();
  if (!Number.isFinite(radial.lengthSq()) || radial.lengthSq() < 1e-20) throw new RangeError('A station frame needs a finite radial direction');
  radial.normalize();
  const west = new THREE.Vector3().crossVectors(radial, _n);
  if (west.lengthSq() < 1e-12) west.crossVectors(radial, new THREE.Vector3(0,0,1));
  west.normalize();
  const north = new THREE.Vector3().crossVectors(west, radial).normalize();
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(west, radial, north));
}

/**
 * The Harbour's traffic corridors, as directions in its local frame (x west, y up, z north).
 * Arrivals come in from high and west (warm lane lights); departures leave eastward and
 * outward, prograde, the way a ship bound for Mars or the outer system would burn.
 */
export const CORRIDORS = {
  dA: new THREE.Vector3(0.78, 0.42, -0.46).normalize(),
  dD: new THREE.Vector3(-0.86, 0.3, 0.41).normalize(),
};

// ------------------------------------------------------------ Halo ports ----
const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Loft a rounded gallery along local X from x0 to x1 (section half-width a in z, half-height b in y, centre cy). */
function gallery(B, x0, x1, a, b, cy, kindFn, n = 18) {
  B.push(new THREE.Matrix4().makeBasis(V(0, 0, 1), V(0, 1, 0), V(1, 0, 0)));   // local z -> X
  const rings = [];
  const steps = 8;
  for (let j = 0; j <= steps; j++) {
    const x = x0 + (x1 - x0) * (j / steps);
    rings.push({ z: x, cy, pts: sectionEllipse(a, b, n, 3.2).map(([u, v]) => [u, v + cy]) });
  }
  B.loft(rings, kindFn, { capStart: CK.BRONZE, capEnd: CK.BRONZE });
  B.pop();
}

/**
 * A port station on the Halo (metres; x west, y up, z north; origin on the deck at the ring's
 * centre line). A glass terminal dome with a spire, glazed concourse wings along the ring, a
 * keel under the deck with the tether anchor sheaves, shuttle gates at the tops of the port
 * columns (east: arrivals from the ground, west: departures down), and piers reaching north
 * and south past the ring's walls. The junction variant carries the main tether's climber
 * terminal through its axis instead of a spire.
 */
export function buildPortStation({ junction = false } = {}) {
  const B = new CB();
  const toY = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  // terminal dome and spire (lathe about +Y)
  B.push(toY);
  const dome = [[3300, -160, CK.DARK], [3300, 0, CK.BRONZE], [3150, 260, CK.ROOF], [2700, 820, CK.ROOF], [1900, 1300, CK.ROOF], [1000, 1580, CK.ROOF], [760, 1640, CK.BRONZE], [700, 1720, CK.BRONZE]];
  const spire = junction
    ? [[950, 1760, CK.HULL], [950, 4100, CK.GLASS], [1500, 4500, CK.BRONZE], [1850, 4900, CK.GLASS], [1900, 5500, CK.LANTERN], [1850, 5600, CK.GLASS], [1500, 6000, CK.BRONZE], [800, 6300, CK.HULL], [420, 6700, CK.DARK], [0.1, 6700, CK.DARK]]
    : [[620, 1760, CK.HULL], [470, 2600, CK.HULL], [540, 2700, CK.LANTERN], [470, 2800, CK.BRONZE], [220, 3400, CK.HULL], [60, 3950, CK.DARK], [0.1, 3960, CK.DARK]];
  lathe(B, [...dome, ...spire], 48);
  // dome ribs
  B.pop();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const r = 3200 * Math.cos(t * Math.PI / 2) + 700 * t;
      const y = 1650 * Math.sin(t * Math.PI / 2);
      pts.push(V(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    ctube(B, pts, 45, 6, CK.BRONZE);
  }
  // concourse wings along the ring (east and west)
  for (const s of [-1, 1]) {
    gallery(B, s * 3100, s * 9800, 480, 260, 170, (i, j) => (i < 4 || i > 13 ? CK.GLASS : (i === 4 || i === 13 ? CK.LANTERN : CK.HULL)));
    B.box(s * 6450, -160, 0, 6900, 200, 1080, CK.HULL);
  }
  if (junction) {
    // Pressure collar around the actual opening cut into the Halo vault.
    B.push(new THREE.Matrix4().makeTranslation(0, 4950, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    B.torus(2240, 290, 72, 12, CK.BRONZE);
    B.pop();
    for (const s of [-1,1]) {
      B.box(s * 2390,4950,0,260,160,5560,CK.HULL);
      B.box(0,4950,s * 2670,5040,160,260,CK.HULL);
    }
  }
  // keel under the deck, with window bands
  gallery(B, -12600, 12600, 1300, 300, -470, (i) => (i === 3 || i === 6 || i === 12 || i === 15 ? CK.LANTERN : CK.HULL), 20);
  // tether anchor sheaves (the three tethers to the ground port hang from here)
  B.push(toY);
  for (const x of junction ? [0] : [-9000, 0, 9000]) {
    B.push(new THREE.Matrix4().makeTranslation(x, 0, 0));
    lathe(B, [[260, -760, CK.HULL], [420, -840, CK.BRONZE], [420, -1180, CK.BRONZE], [300, -1300, CK.DARK], [120, -1420, CK.DARK], [0.1, -1420, CK.DARK]], 24);
    B.pop();
  }
  B.pop();
  // shuttle gates at the tops of the port columns, 8 km below the deck, on trusses
  const gates = [];
  for (const s of [-1, 1]) {
    const x = s * 12000, y = -8000;
    for (const dz of [-500, 500]) ctube(B, [V(x, -760, dz), V(x, y + 700, dz)], 70, 6, CK.DARK);
    for (let yy = -1600; yy > y + 700; yy -= 1200) ctube(B, [V(x, yy, -500), V(x, yy - 600, 500)], 30, 4, CK.DARK);
    B.push(new THREE.Matrix4().makeTranslation(x, y, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    B.torus(720, 70, 48, 10, CK.BRONZE);
    B.torus(640, 22, 48, 6, CK.CONDUIT);
    B.pop();
    // docking platform beside the gate
    B.box(x, y + 900, 0, 1400, 160, 900, CK.HULL);
    B.box(x, y + 990, 0, 1200, 30, 700, CK.DECK);
    gates.push(V(x, y, 0));
  }
  // Piers descend into the service keel before crossing beneath the rotor tubes.
  // Keeping the entire crossing below -3.2 km leaves over 500 m to their lower skin.
  const piers = [];
  const pierRoutes = [];
  const pierY = -3400;
  for (const s of [-1, 1]) {
    const route = [V(0,-560,s*1250),V(0,pierY,s*8500),V(0,pierY,s*21500)];
    ctube(B, route, 150, 12, CK.HULL);
    ctube(B, route.map(p => p.clone().add(V(0,180,0))), 30, 6, CK.LANTERN);
    pierRoutes.push({ points:route, radius:180 });
    for (const z of [9500,12500]) for (const x of [-420,420]) {
      ctube(B,[V(x,-320,s*z),V(x,pierY,s*z)],65,6,CK.DARK);
      ctube(B,[V(x,pierY,s*z),V(0,pierY,s*(z+1800))],45,6,CK.BRONZE);
      B.box(x,-300,s*z,220,140,320,CK.HULL);
    }
    for (let z = 9500; z < 21000; z += 3000) {
      B.push(new THREE.Matrix4().makeTranslation(0, pierY, s * z));
      lathe(B, [[160, -40, CK.BRONZE], [175, -25, CK.BRONZE], [175, 25, CK.BRONZE], [160, 40, CK.BRONZE]], 12);
      B.pop();
    }
    B.push(new THREE.Matrix4().makeTranslation(0, pierY, s * 21700));
    sphere(B, 520, CK.GLASS, 24, 10);
    B.pop();
    piers.push(V(0, pierY, s * 21700));
    // Cargo courts sit outboard of the rotor; clear central flight paths stay empty.
    ctube(B,[V(-1050,pierY,s*20100),V(1050,pierY,s*20100)],100,8,CK.HULL);
    for (const x of [-1050,1050]) {
      B.box(x,pierY,s*20100,1300,180,2200,CK.HULL);
      for (let k=0;k<4;k++) B.box(x,pierY+300,s*(19400+k*460),750,420,330,k%2?CK.BRONZE:CK.HULL);
    }
  }
  const geo = B.geometry();
  // berthed shuttles and tugs at the piers and gate platforms
  const sh = buildShuttle(110), tu = buildTug(80);
  const list = [], lamps = [];
  const put = (ship, pos, fwd, up) => {
    const x = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const m = new THREE.Matrix4().makeBasis(x, up, fwd).setPosition(pos);
    list.push({ geo: ship.geo, m });
    lamps.push(...placeLamps(ship.lamps || [], m, 3));
  };
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      put(k === 1 ? tu : sh, V((k - 1) * 260, pierY - 260, s * (9000 + k * 3400)), V(0, -1, 0), V(0, 0, s));
    }
    put(sh, V(s * 12000 + 420, -7000, 0), V(0, 1, 0), V(0, 0, 1));
  }
  const ships = placeMerge(list);
  // lamps
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    lamps.push({ p: V(Math.cos(a) * 3350, 40, Math.sin(a) * 3350), r: 14, color: LAMP.AMBER, i: 2.0 });
  }
  lamps.push({ p: V(0, junction ? 6750 : 4000, 0), r: 30, color: LAMP.WHITE, i: 3.0, breathe: 0.35 });
  gates.forEach((g, i) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      lamps.push({ p: g.clone().add(V(Math.cos(a) * 760, 0, Math.sin(a) * 760)), r: 18, color: g.x < 0 ? LAMP.BLUE : LAMP.AMBER, i: 2.6, breathe: 0.35, phase: k / 8 });
    }
  });
  for (const p of piers) {
    lamps.push({ p: p.clone().add(V(0, 560, 0)), r: 24, color: LAMP.WHITE, i: 2.6, breathe: 0.3 });
    lamps.push({ p: p.clone().add(V(560, 0, 0)), r: 16, color: LAMP.RED, i: 2.4 });
    lamps.push({ p: p.clone().add(V(-560, 0, 0)), r: 16, color: LAMP.GREEN, i: 2.4 });
  }
  return { geo, ships, lamps, gates, pierRoutes, pierY };
}

/** A cargo crane for a port's cargo court (metres): a slewing jib on a lattice mast. */
export function buildCourtCrane() {
  const B = new CB(), lamps = [];
  // slewing head at the origin (the part that turns); mast built separately below it
  B.box(0, 0, 0, 90, 60, 90, CK.HULL);
  B.box(0, 40, -30, 60, 40, 50, CK.GLASS);
  for (const x of [-18, 18]) B.tube([V(x, 30, 0), V(x, 30, 900)], 7, 6, CK.BRONZE);
  for (let z = 60; z < 900; z += 60) {
    B.tube([V(-18, 30, z), V(18, 30, z + 30)], 3, 4, CK.DARK);
    B.tube([V(-18, 30, z), V(0, 70, z)], 3, 4, CK.DARK);
    B.tube([V(18, 30, z), V(0, 70, z)], 3, 4, CK.DARK);
  }
  B.tube([V(0, 70, 0), V(0, 70, 900)], 5, 6, CK.HULL);
  B.box(0, 20, -120, 70, 50, 90, CK.DARK);                        // counterweight
  B.tube([V(0, 60, -150), V(0, 160, 0), V(0, 70, 880)], 2, 4, CK.CONDUIT);
  // trolley and a hanging container
  B.box(0, 18, 620, 50, 16, 40, CK.BRONZE);
  B.tube([V(0, 10, 620), V(0, -20, 620)], 1.5, 4, CK.DARK);
  B.box(0, -45, 620, 60, 50, 120, CK.PANEL);                      // the load rides 30 m over the stacks
  lamps.push({ p: V(0, 80, 905), r: 10, color: LAMP.RED, i: 2.6, breathe: 0.5 });
  lamps.push({ p: V(0, 70, 30), r: 8, color: LAMP.AMBER, i: 2.0 });
  return { geo: B.geometry(), lamps };
}
export function buildCraneMast(h = 300) {
  const B = new CB();
  for (const x of [-30, 30]) for (const z of [-30, 30]) B.tube([V(x, -h, z), V(x, -30, z)], 5, 6, CK.HULL);
  for (let y = -h + 40; y < -30; y += 50) B.box(0, y, 0, 70, 4, 70, CK.DARK);
  return B.geometry();
}
/** Tether pod for the port tethers: a small freight car riding the cable. */
function buildTetherPod() {
  const B = new CB();
  B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  const b = PORT_LIFE.podBore;
  lathe(B, [[b, -30, CK.DARK], [34, -26, CK.HULL], [38, -12, CK.GLASS], [38, 10, CK.HULL], [30, 24, CK.BRONZE], [b, 30, CK.DARK]], 20, 0, { closedProfile: true });
  B.pop();
  return B.geometry();
}

/**
 * The port tethers as structure under the station: each ribbon (20 m wide) hangs from its
 * sheave, banded by beacon collars every 500 m that the tether pods' bores pass over.
 */
export function buildPortTethers(xs = PORT_LIFE.tetherX, top = PORT_LIFE.tetherTopY, len = PORT_LIFE.tetherShown) {
  const B = new CB(), lamps = [];
  for (const x of xs) {
    B.box(x, top - len / 2, 0, 1, len, PORT_LIFE.ribbonW, CK.HULL);
    for (const z of [-PORT_LIFE.ribbonW / 2, PORT_LIFE.ribbonW / 2]) B.box(x, top - len / 2, z, 2, len, 0.8, CK.BRONZE);
    for (let y = top - 250; y > top - len; y -= 500) {
      B.box(x, y, 0, 3, 4, PORT_LIFE.ribbonW + 3, CK.LANTERN);
      if (Math.round((top - y - 250) / 500) % 4 === 0) lamps.push({ p: V(x, y, PORT_LIFE.ribbonW / 2 + 4), r: 6, color: LAMP.AMBER, i: 2.2, breathe: 0.3 }, { p: V(x, y, -PORT_LIFE.ribbonW / 2 - 4), r: 6, color: LAMP.AMBER, i: 2.2, breathe: 0.3 });
    }
  }
  return { geo: B.geometry(), lamps };
}

export const PORT_LIFE = {
  shuttlePeriod: 900, approachKm: 12, gateY: -8000, craneY: 520, craneZ: 21150, podSpeed: 180, podSpan: 22000,
  tetherX: [-9000, 0, 9000], tetherTopY: -1420, tetherShown: 22500, ribbonW: 20, podBore: 14,
};

/**
 * A port station's working parts, in the station mesh's metres: court cranes slewing over the
 * container stacks, shuttles climbing the port columns to the gate rings and dropping away,
 * freight pods riding the port tethers. Shared by the Halo's ports and Meridian's junction.
 */
export class PortLife {
  constructor(mesh, st, { seed = 0, tethers = PORT_LIFE.tetherX } = {}) {
    PortLife.shared ||= { crane: buildCourtCrane(), mast: buildCraneMast(PORT_LIFE.craneY), shuttle: buildShuttle(110).geo, pod: buildTetherPod(), tethers: buildPortTethers() };
    const K = PortLife.shared;
    this.seed = seed;
    this.tethers = tethers;
    this.group = new THREE.Group();
    this.seats = [];
    for (const sd of [-1, 1]) for (const x of [-1050, 1050]) this.seats.push(V(x, st.pierY + 90 + PORT_LIFE.craneY, sd * PORT_LIFE.craneZ));
    this.cranes = this.seats.map((c) => {
      const head = craftPart(mesh, K.crane.geo);
      head.position.copy(c);
      addLamps(head, K.crane.lamps, { minPx: 1.2 });
      const mast = craftPart(mesh, K.mast);
      mast.position.copy(c);
      this.group.add(head, mast);
      return head;
    });
    const inst = (geo, n) => {
      const im = new THREE.InstancedMesh(geo, mesh.material, n);
      im.frustumCulled = false; im.renderOrder = 3; im.onBeforeRender = mesh.onBeforeRender;
      this.group.add(im);
      return im;
    };
    this.shuttles = inst(K.shuttle, 2);
    if (tethers === PORT_LIFE.tetherX) {
      const tm = craftPart(mesh, K.tethers.geo);
      addLamps(tm, K.tethers.lamps, { minPx: 1.2 });
      this.group.add(tm);
    }
    this.pods = inst(K.pod, Math.max(1, 2 * tethers.length));
    this.pods.count = 2 * tethers.length;
    mesh.add(this.group);
  }

  /** Shuttle at gate side s (0 west/departures, 1 east/arrivals): y (m) of its centre, or null. */
  static shuttleY(t, side, seed) {
    const L = PORT_LIFE, ph = ((t / L.shuttlePeriod + side * 0.5 + (seed % 97) / 97) % 1 + 1) % 1;
    const berth = L.gateY - 150, far = berth - L.approachKm * 1000;
    if (ph < 0.3) { const e = 1 - ph / 0.3; return berth - (berth - far) * e * e; }        // rising, braking into the gate
    if (ph < 0.55) return berth;                                                            // at the gate
    if (ph < 0.85) { const e = (ph - 0.55) / 0.3; return berth - (berth - far) * e * e; }  // dropping away
    return null;
  }
  static podY(t, k, seed) {
    const L = PORT_LIFE, span = L.podSpan;
    const u = (((t * L.podSpeed + k * span / 2 + seed) % span) + span) % span;
    return (k % 2 ? L.tetherTopY - 300 - u : L.tetherTopY - 300 - (span - u));
  }

  update(t) {
    for (let i = 0; i < this.cranes.length; i++) this.cranes[i].rotation.y = 0.6 * Math.sin(t * 0.02 + i * 1.9 + this.seed) + (i < 2 ? 0 : Math.PI);
    let n = 0;
    for (let side = 0; side < 2; side++) {
      const y = PortLife.shuttleY(t, side, this.seed);
      if (y === null) continue;
      // nose up the column (+y), belly toward +z
      _mm.set(1, 0, 0, side ? 12000 : -12000, 0, 0, 1, y, 0, -1, 0, 0, 0, 0, 0, 1);
      this.shuttles.setMatrixAt(n++, _mm);
    }
    this.shuttles.count = n;
    this.shuttles.instanceMatrix.needsUpdate = true;
    for (let k = 0; k < this.pods.count; k++) {
      _mm.makeTranslation(this.tethers[k % this.tethers.length], PortLife.podY(t, k, this.seed), 0);
      this.pods.setMatrixAt(k, _mm);
    }
    this.pods.instanceMatrix.needsUpdate = true;
  }
}

/**
 * The Halo's ports as scene objects: one station at each ground port (Meridian's is the
 * junction, built by the elevator). Each is its own depth-sliced body, working when close.
 */
export class HaloPorts {
  constructor(space, ports) {
    this.list = [];
    const st = buildPortStation({ junction: false });
    this.station = st;
    const mat = createCraftMaterial({ accent: [0.55, 0.9, 1.0], lit: 0.6 });
    for (const p of ports) {
      if (p.name === 'Meridian') continue;
      const lon = THREE.MathUtils.degToRad(p.lon);
      const up = bodyDir(0, lon);
      const g = new THREE.Group();
      g.position.copy(up).multiplyScalar(R_EARTH + 620);
      stationFrame(up, g.quaternion);
      const m = craftMesh(st.geo, {}, mat);
      const s = craftPart(m, st.ships);
      m.add(s);
      addLamps(m, st.lamps, { minPx: 1.3 });
      const life = new PortLife(m, st, { seed: (lon * 1000) | 0 });
      g.add(m);
      space.earthFixed.add(g);
      const _p = new THREE.Vector3();
      space.addBody(`port-${p.name}`, [g], () => g.getWorldPosition(_p), 24, { solid: true, hint: 0.6 });
      this.list.push({ name: p.name, group: g, mesh: m, ships: s, life });
    }
    this.craneSeats = this.list.length ? this.list[0].life.seats : [];
  }

  shuttleY(t, side, seed) { return PortLife.shuttleY(t, side, seed); }
  podY(t, k, seed) { return PortLife.podY(t, k, seed); }

  update(sim, realTime, dt, space) {
    // berthed craft only when a station is big enough on screen to show them
    for (const p of this.list) {
      const px = pixelRadius(space.camera, p.group.getWorldPosition(_w), 22, space.size.y);
      p.ships.visible = px > 120;
      p.group.visible = px > 0.6;
      p.life.group.visible = px > 160;
      if (p.life.group.visible) p.life.update(realTime);
    }
  }
}
const _mm = new THREE.Matrix4();
const _w = new THREE.Vector3();

// ------------------------------------------------------------ counterweight works ----
/** Works on the counterweight asteroid (metres, local +Y up the tether away from the Earth). */
export function buildCounterworks({ surfaceRadius = buildCounterweightRock().surfaceRadius } = {}) {
  const B = new CB();
  const toY = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const footings = [], mines = [], conveyors = [];
  // the tether's arrival terminal on the Earth-facing side, and a docking spindle beyond
  B.push(toY);
  lathe(B, [[0.1, -15800, CK.DARK], [380, -15800, CK.DARK], [620, -15400, CK.BRONZE], [1100, -14800, CK.HULL], [1250, -14200, CK.GLASS], [1300, -13500, CK.LANTERN],
    [1250, -13300, CK.GLASS], [1100, -12600, CK.BRONZE], [900, -11800, CK.HULL], [900, -8200, CK.HULL], [1300, -7800, CK.BRONZE], [1300, -7400, CK.DARK]], 32);
  B.pop();
  // A sheltered inhabited ring held by six cradles entirely outside the working rock.
  B.push(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  B.torus(15000, 520, 180, 14, CK.ROOF);
  B.pop();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + 0.26;
    const d = V(Math.cos(a), 0, Math.sin(a));
    const lower = d.clone().multiplyScalar(1200).setY(-13500);
    const knee = d.clone().multiplyScalar(12800).setY(-11800);
    const upper = d.clone().multiplyScalar(15000);
    ctube(B, [lower, knee, upper], 155, 8, CK.HULL);
    ctube(B, [lower.clone().add(V(0,-340,0)), knee.clone().add(V(0,-340,0)), upper.clone().addScaledVector(d,340)], 62, 6, CK.BRONZE);
    for (let j = 1; j < 8; j++) {
      const p = knee.clone().lerp(upper, j / 8);
      ctube(B, [p, p.clone().addScaledVector(d,250).add(V(0,-250,0))], 45, 6, CK.DARK);
    }
    // Six commons: a planted pressure hall, its terrace and equipment cellar.
    B.at(upper.x, 540, upper.z, 0, -a, 0);
    B.box(0, -50, 0, 1150, 160, 850, CK.HULL);
    gallery(B, -520, 520, 350, 190, 170, CK.ROOF, 18);
    B.box(0, 80, 0, 920, 25, 560, CK.GARDEN);
    B.pop();
  }
  // Surveyed feet meet the actual triangulated asteroid, not an assumed sphere.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + 0.7;
    const d = V(Math.cos(a), 0.25 * Math.sin(a * 2.0), Math.sin(a)).normalize();
    const p = d.clone().multiplyScalar(surfaceRadius(d));
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d);
    const m = new THREE.Matrix4().compose(p, q, V(1, 1, 1));
    const deck = p.clone().addScaledVector(d, 1100);
    mines.push({ direction: d.clone(), surface: p.clone(), deck: deck.clone(), radius: 620 });
    for (const x of [-430,430]) for (const z of [-430,430]) {
      const plan = V(x,0,z).applyMatrix4(m), fd = plan.clone().normalize();
      const contact = fd.clone().multiplyScalar(surfaceRadius(fd));
      const top = V(x,1050,z).applyMatrix4(m);
      ctube(B, [contact.clone().addScaledVector(fd,-35), top], 90, 8, CK.BRONZE);
      B.push(new THREE.Matrix4().compose(contact, new THREE.Quaternion().setFromUnitVectors(V(0,1,0),fd), V(1,1,1)));
      B.box(0, 10, 0, 280, 90, 280, CK.DARK); B.pop();
      footings.push({ contact, direction: fd, radius: surfaceRadius(fd), top });
    }
    B.push(m);
    B.box(0, 1100, 0, 1160, 140, 1160, CK.HULL);
    B.box(-240, 1330, -220, 480, 320, 520, CK.GLASS);
    B.box(0, 1680, 220, 1250, 120, 200, CK.BRONZE);
    for (const x of [-520,520]) B.box(x, 1450, 220, 100, 480, 140, CK.DARK);
    ctube(B,[V(360,1170,260),V(360,2040,260),V(-170,2040,260)],55,6,CK.HULL);
    B.box(-170,1940,260,180,210,180,CK.BRONZE);
    B.pop();
    const collar = V(Math.cos(a) * 15000, 0, Math.sin(a) * 15000);
    const end = deck.clone().addScaledVector(d, 250);
    ctube(B,[end,collar],110,10,CK.HULL);
    ctube(B,[end.clone().add(V(0,170,0)),collar.clone().add(V(0,170,0))],32,6,CK.LANTERN);
    conveyors.push({ start:end, end:collar, radius:110 });
  }
  // Outward cargo and heat services share a mast seated on the surveyed pole.
  const pole = surfaceRadius(V(0,1,0));
  B.push(toY);
  lathe(B,[[700,pole-100,CK.DARK],[700,pole+300,CK.BRONZE],[420,pole+650,CK.HULL],[420,15400,CK.HULL],[780,15700,CK.GLASS],[780,16400,CK.GLASS],[420,16800,CK.BRONZE]],32);
  B.pop();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    B.push(new THREE.Matrix4().makeRotationY(-a));
    B.box(2500, 13200, 0, 4600, 160, 140, CK.DARK);
    B.box(2700, 13200, 0, 4400, 3200, 60, CK.RADIATOR);
    B.box(4900,13200,0,100,3400,120,CK.BRONZE);
    B.pop();
  }
  const geo = B.geometry();
  const lamps = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    lamps.push({ p: V(Math.cos(a) * 15600, 0, Math.sin(a) * 15600), r: 40, color: LAMP.AMBER, i: 2.0 });
  }
  lamps.push({ p: V(0, -15900, 0), r: 50, color: LAMP.TEAL, i: 2.6, breathe: 0.35 });
  lamps.push({ p: V(0, 15800, 0), r: 50, color: LAMP.WHITE, i: 2.6, breathe: 0.3 });
  return { geo, lamps, footings, mines, conveyors };
}
