import * as THREE from 'three';
import { R_EARTH, R_MOON, GEO_ALT, COUNTERWEIGHT_ALT, MERIDIAN_LON, bodyDir } from './sim.js';
import { NAURU_LON } from './fleet.js';
import { STORE_POS } from './geoRoads.js';
import { linerF } from './linerHull.js';
import { PADS as LANDING_PADS } from './lunarLanding.js';
import { surfaceY, surfaceUp } from './lunarSite.js';
import { stationFrame } from './stations.js';
import { HOP_FIELD } from './lunarWorks.js';
import {
  ANANSI_DOCKS, HEVELIUS_DOCK, EXCHANGE_DOCKS, COURT_PAD, SELENE_DOCK, TENDER_DOCK, REFUGE_DOCK, HELIANTH_DOCK, LAGRANGE_DOCK, FULCRUM_DOCKS,
  PIER_DOCKS, HARBOUR_DOCKS, STORE_DOCK, COUNTER_DOCK,
} from './portSites.js';

// Docking ports and landing pads: the exact places the Lodestar's autopilot takes it to at each
// destination in the orbital view.
//
// A port is { id, target, label, kind, clear, approach, pose(space, out) }:
//   id        unique, 'target:name'
//   target    the key in space.targets it belongs to
//   label     shown on the HUD ('Endymion Wheel - hub dock')
//   kind      'dock': the ship mates its dorsal docking ring (LODESTAR_DOCK in starship.js) to the
//                     port face: ship +Y (dorsal) = -n, nose (-Z) along fwd
//             'pad':  the ship sets down on its legs (LODESTAR_FEET) at pos: ship +Y = n, nose
//                     along fwd
//   clear     radius (km) of the free space round the mating point
//   approach  length (km) of the straight final corridor along n that is free of structure
//   pose(space, out) fills out = { pos, n, fwd } in WORLD space (km) at the current instant:
//             pos  the mating point (dock face centre / pad surface centre)
//             n    unit axis out of the structure along the approach (a pad: its local up)
//             fwd  unit, perpendicular to n: the direction the ship's nose points when mated
// Poses follow the structure (spinning wheels, orbiting stations, the rotating Earth and Moon);
// the autopilot differences successive poses for the port's velocity.
//
// How the registry places a port. Every target already carries its analytic placement
// (target.position / target.frame: functions of the sim clock the renderer uses for the same
// structure), so a port is a fixed local transform in its target's frame (km), optionally carried
// round by a spin (a function of the same clock the module turns its wheel with) and optionally
// resolved against the live scene graph (the station module exposes the mount object, and the
// port reads its transform relative to the station root: exact even where a station's parts are
// laid out procedurally). Poses are evaluated fresh on every call from the current sim state, so
// a station in low orbit (7.5 km/s) is never a frame behind.
//
// Surface targets under the Earth's atmosphere (the Meridian, the elevator's foot) dock at the
// orbital structure above them and say so in the label. The Moon itself points at Medii
// Landing's three landing fields.

const V = () => new THREE.Vector3();
const _P = V(), _S = V(), _Q = new THREE.Quaternion(), _Q2 = new THREE.Quaternion();
const _M = new THREE.Matrix4(), _M2 = new THREE.Matrix4(), _L = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);
const KM = 0.001;

/** Basis matrix: +Y = n, +Z = fwd (orthogonalised), +X = Y x Z, translated to p. */
function basis(p, n, fwd, out = new THREE.Matrix4()) {
  const y = V().copy(n).normalize();
  const z = V().copy(fwd).addScaledVector(y, -y.dot(fwd));
  if (z.lengthSq() < 1e-12) z.set(0, 0, 1).addScaledVector(y, -y.z);
  if (z.lengthSq() < 1e-12) z.set(1, 0, 0).addScaledVector(y, -y.x);
  z.normalize();
  const x = V().crossVectors(y, z);
  return out.makeBasis(x, y, z).setPosition(p);
}

/** The target's analytic world matrix (km, no scale). */
function targetMatrix(space, name, out) {
  const t = space.targets[name];
  t.position(_P);
  t.frame(_Q);
  return out.compose(_P, _Q, ONE);
}

function readPose(M, out) {
  out.pos = (out.pos || V()).setFromMatrixPosition(M);
  out.n = (out.n || V()).setFromMatrixColumn(M, 1).normalize();
  out.fwd = (out.fwd || V()).setFromMatrixColumn(M, 2);
  out.fwd.addScaledVector(out.n, -out.n.dot(out.fwd)).normalize();
  return out;
}

/**
 * A port at a fixed place in its target's frame.
 *   p, n, fwd   target-frame km / unit vectors
 *   spin        optional (space, q) => q: the rotation (target frame, about the local origin
 *               unless `pivot`) the port rides on, e.g. a wheel turning about its axis
 */
function framePort({ target, key, label, kind = 'dock', clear = 0.06, approach = 0.6, p, n, fwd, spin = null, pivot = null, extra = {} }) {
  return add(framePortSpec(arguments[0]));
}
function framePortSpec({ target, key, label, kind = 'dock', clear = 0.06, approach = 0.6, p, n, fwd, spin = null, pivot = null, extra = {} }) {
  const L = basis(p, n, fwd);
  const piv = pivot ? pivot.clone() : null;
  return {
    id: `${target}:${key}`, target, label, kind, clear, approach, local: { p: p.clone(), n: n.clone().normalize(), fwd: fwd.clone() }, ...extra,
    pose(space, out) {
      targetMatrix(space, target, _M);
      if (spin) {
        spin(space, _Q2);
        if (piv) _M.multiply(_M2.makeTranslation(piv.x, piv.y, piv.z));
        _M.multiply(_M2.makeRotationFromQuaternion(_Q2));
        if (piv) _M.multiply(_M2.makeTranslation(-piv.x, -piv.y, -piv.z));
      }
      return readPose(_M.multiply(L), out);
    },
  };
}

/** A spin about a target-frame axis at `rate` rad/s of the clock `clock(space)` plus a phase. */
const spinAbout = (axis, rate, clock, phase = 0) => {
  const a = axis.clone().normalize();
  return (space, q) => q.setFromAxisAngle(a, clock(space) * rate + phase);
};
/** A spin read from the live scene: the named child's quaternion relative to the station root. */
const liveSpin = (get, fallback) => (space, q) => {
  const o = get(space);
  if (o) return q.copy(o.quaternion);
  return fallback ? fallback(space, q) : q.identity();
};

const X = (x, y, z) => new THREE.Vector3(x, y, z);
const PORTS = [];
const add = (spec) => { PORTS.push(spec); return spec; };

// ================================================================== the Moon's surface ==
// Medii Landing's town frame: moon.landing at (R_MOON, 0, 0) in the Moon's body frame, turned
// by stationFrame(+X); the town is built in metres (x, z across the site, y up the local radial).
const LANDING_Q = stationFrame(X(1, 0, 0));
const LANDING_ROT = -Math.PI / 4;              // the town's u/v axes are its x/z turned by -45 degrees
const S2 = Math.SQRT1_2;
const uvToXZ = (u, v) => [(u - v) * S2, (u + v) * S2];

/** A pad on the Moon at site metres (x, z) of the Landing's frame (the ground's height there + top). */
function landingSitePad(target, key, label, x, z, top, heading, { clear = 0.26, approach = 1.5, flat = false } = {}) {
  const y = surfaceY(x, z) + top;
  const up = flat ? X(0, 1, 0) : surfaceUp(x, z, V());
  const fwd = X(Math.sin(heading), 0, Math.cos(heading));
  const pLocal = X(x, y, z).multiplyScalar(KM);
  const L = basis(pLocal, up, fwd);
  const siteToBody = new THREE.Matrix4().compose(X(R_MOON, 0, 0), LANDING_Q, ONE).multiply(L);
  return add({
    id: `${target}:${key}`, target, label, kind: 'pad', clear, approach, site: { x, y, z },
    pose(space, out) {
      const sim = space.sim;
      _M.compose(sim.moonPos, sim.moonQuat, ONE).multiply(siteToBody);
      return readPose(_M, out);
    },
  });
}

// each field's free spot (pad-relative u, v metres): clear of its parked landers, hoppers,
// service towers and container stacks (LANDER_SLOTS, PAD_STACKS in lunarWorks.js), inside the
// tugs' circuit; the pad disc is flat in the site frame, its top 1.2 m over the ground at its centre
const FIELD_SPOTS = [[0, -150], [0, -150], [-110, -110]];
LANDING_PADS.forEach(([u, v], i) => {
  const [cx, cz] = uvToXZ(u, v);
  const [x, z] = uvToXZ(u + FIELD_SPOTS[i][0], v + FIELD_SPOTS[i][1]);
  // nose along the pad's service road (the pad's local +z, +v: toward the town)
  for (const tgt of ['lunarLanding', 'moon', 'lunarFields']) {
    landingSitePad(tgt, `field${i + 1}`, `Medii Landing - landing field ${i + 1}`, x, z, surfaceY(cx, cz) - surfaceY(x, z) + 1.2, LANDING_ROT, { clear: 0.09, approach: 2.0, flat: true });
  }
});

// ------------------------------------------------------------------ Moon-fixed ports --
/** A port fixed in the Moon's body frame: bodyM (km, body frame) x the local basis (p in `unit`s). */
function moonFixed(target, key, label, kind, bodyM, p, n, fwd, { clear = 0.06, approach = 1.5, unit = KM } = {}) {
  const L = new THREE.Matrix4().copy(bodyM).multiply(basis(p.clone().multiplyScalar(unit), n, fwd));
  return add({
    id: `${target}:${key}`, target, label, kind, clear, approach,
    pose(space, out) {
      const sim = space.sim;
      return readPose(_M.compose(sim.moonPos, sim.moonQuat, ONE).multiply(L), out);
    },
  });
}
const EXCHANGE_M = new THREE.Matrix4().compose(X(R_MOON + 380, 0, 0), stationFrame(X(1, 0, 0)), ONE);
for (const d of EXCHANGE_DOCKS) {
  moonFixed('lunarport', d.key, d.label, 'dock', EXCHANGE_M, d.p, d.n, d.fwd, { clear: 0.05, approach: 2.0 });
  if (d.key === 'northPier') moonFixed('lunarReceiving', d.key, `${d.label} (the receiving court's pier)`, 'dock', EXCHANGE_M, d.p, d.n, d.fwd, { clear: 0.05, approach: 2.0 });
}
{
  const courtAngle = 8.35 / (R_MOON + 380), courtUp = X(Math.cos(courtAngle), 0, Math.sin(courtAngle));
  const COURT_M = new THREE.Matrix4().compose(courtUp.clone().multiplyScalar(R_MOON + 380).setY(2.75), stationFrame(courtUp), ONE);
  moonFixed('lunarCourt', COURT_PAD.key, COURT_PAD.label, 'pad', COURT_M, COURT_PAD.p, COURT_PAD.n, COURT_PAD.fwd, { clear: 0.02, approach: 0.4 });
}
// Medii Works: the hoppers' field (HOP_FIELD, lunarWorks.js), seated on the sphere, its top 0.9 m up
{
  const [x, z] = uvToXZ(HOP_FIELD.u, HOP_FIELD.v);
  const up = surfaceUp(x, z, V());
  const pos = X(x, surfaceY(x, z), z).addScaledVector(up, 0.9);
  const SITE_M = new THREE.Matrix4().compose(X(R_MOON, 0, 0), LANDING_Q, ONE);
  moonFixed('mediiWorks', 'hopField', 'Medii Works - hop field', 'pad', SITE_M, pos, up, X(-S2, 0, S2), { clear: 0.05, approach: 1.5 });
}

// --------------------------------------------------------------- the lunar orbitals --
// (their target frames are the orbitals' groups exactly: position and quaternion from place(realTime))
const TAU = Math.PI * 2;
// Endymion Wheel: the free berths at the docking arms' tips on the despun hub (the ferries hold
// berths 1, 4 and 6 and the inbound ferry uses 2); the rings counter-rotate at |z| 70-122 m
for (const k of [2, 4, 6]) {
  const a = ((k % 4) + 0.5) / 4 * TAU, z = k < 4 ? -255 : 255, r = 120.5;
  framePort({ target: 'endymionWheel', key: `berth${k + 1}`, label: `Endymion Wheel - hub berth ${k + 1}`, clear: 0.04, approach: 2.0,
    p: X(r * Math.cos(a), r * Math.sin(a), z).multiplyScalar(KM), n: X(Math.cos(a), Math.sin(a), 0), fwd: X(0, 0, Math.sign(z)) });
}
// Aitken Depot: the hangar's flank collars (the tanker holds the berth at the spine's end)
for (const s of [1, -1]) {
  framePort({ target: 'aitkenDepot', key: s > 0 ? 'hangarNorth' : 'hangarSouth', label: `Aitken Depot - hangar ${s > 0 ? 'north' : 'south'} collar`, clear: 0.03, approach: 2.0,
    p: X(550, 0, s * 43).multiplyScalar(KM), n: X(0, 0, s), fwd: X(0, 1, 0) });
}
framePort({ target: 'heveliusYard', key: HEVELIUS_DOCK.key, label: HEVELIUS_DOCK.label, clear: 0.03, approach: 2.0,
  p: HEVELIUS_DOCK.p.clone().multiplyScalar(KM), n: HEVELIUS_DOCK.n, fwd: HEVELIUS_DOCK.fwd });

// ------------------------------------------------------------------- low Earth orbit --
// The six stations' own ports (leoStations.js dockPort: the collar's face, facing out), read from
// the live station record and placed with its frameAt(sim.t): the renderer's own transform.
function leoPort(target, key, label, k, fwdLocal, { clear = 0.04, approach = 2.0, list = null } = {}) {
  return add({
    id: `${target}:${key}`, target, label, kind: 'dock', clear, approach,
    pose(space, out) {
      const lo = space.lowOrbit, st = lo && lo.byName && lo.byName[target];
      const pts = st && (list || st.ports);
      if (!pts || !pts.length) {
        targetMatrix(space, target, _M);
        return readPose(_M.multiply(basis(_S.set(0, 0.3, 0), X(0, 1, 0), X(0, 0, 1), _L)), out);
      }
      const pt = pts[k % pts.length];
      st.frameAt(space.sim.t, _P, _Q);
      _M.compose(_P, _Q, ONE).multiply(basis(_S.copy(pt.p).multiplyScalar(KM), pt.dir, fwdLocal, _L));
      return readPose(_M, out);
    },
  });
}
const AX = X(0, 0, 1), UPY = X(0, 1, 0);
for (const k of [4, 5]) leoPort('halcyon', `drum${k + 1}`, `Halcyon - despun dock drum, port ${k + 1}`, k, AX);
for (const k of [0, 2]) leoPort('aurelia', `drum${k + 1}`, `Aurelia - docking drum, port ${k + 1}`, k, AX);
leoPort('demeter', 'axial', 'Demeter - sunward axial dock', 4, UPY);
leoPort('demeter', 'radial1', 'Demeter - sunward dock, radial port 1', 0, AX);
leoPort('boreal', 'ram', 'Boreal - node ram port', 0, UPY);
leoPort('boreal', 'wake', 'Boreal - node wake port', 1, UPY);

leoPort('dawnline', 'hubNorth', 'Dawnline - hub port (north)', 1, X(1, 0, 0));
{
  const list = ANANSI_DOCKS.map((d) => ({ p: d.p, dir: d.n }));
  ANANSI_DOCKS.forEach((d, k) => leoPort('anansi', d.key, d.label, k, d.fwd, { list }));
}

// ------------------------------------------------------------------ ships in the fleet --
// the liner's free keel collars (craftGeometry.js buildLiner: five collars under the keel, the
// port shuttles seated on the second and fourth): face centres in the liner's frame, km
// (linerHull.js: a collar at keel height -118 f(z) 0.8 + 4 m, its face 14 m below; liner metres = km x 1000)
[-420, 80, 580].forEach((z, i) => framePort({
  target: 'liner', key: `keel${[1, 3, 5][i]}`, label: `Concord liner - keel collar ${[1, 3, 5][i]}`, clear: 0.04, approach: 0.9,
  p: X(0, -118 * linerF(z) * 0.8 + 4 - 14, z).multiplyScalar(KM), n: X(0, -1, 0), fwd: X(0, 0, 1),
}));
framePort({ target: 'selene', key: SELENE_DOCK.key, label: SELENE_DOCK.label, clear: 0.04, approach: 1.6,
  p: SELENE_DOCK.p.clone().multiplyScalar(KM), n: SELENE_DOCK.n, fwd: SELENE_DOCK.fwd });
// tender 2 yaws, pitches and rolls slowly in its group: the port rides its live hull transform
{
  const L = basis(TENDER_DOCK.p, TENDER_DOCK.n, TENDER_DOCK.fwd);
  add({
    id: `tenders:${TENDER_DOCK.key}`, target: 'tenders', label: TENDER_DOCK.label, kind: 'dock', clear: 0.03, approach: 0.7,
    pose(space, out) {
      targetMatrix(space, 'tenders', _M);
      const t = space.fleet && space.fleet.tenders && space.fleet.tenders[1];
      if (t) { t.mesh.updateMatrix(); _M.multiply(t.mesh.matrix); } else _M.multiply(_M2.makeScale(KM, KM, KM));
      _M.multiply(L);
      readPose(_M, out);
      return out;
    },
  });
}

// ---------------------------------------------------------------------- the Hearth --
// A collector's docking node (hearthDistrict.js MODULE.node): its -z port (the +z port holds a
// berthed ferry; the district's ferries serve collectors 1 and 2, so collectors 5 and 10 take
// visitors). Collector i is placed exactly as hearth.js places it in the stations ring.
function collectorMatrix(i) {
  const a = (i / 14) * TAU, Rc = 900;
  const o = new THREE.Object3D();
  o.position.set(Math.cos(a) * Rc, Math.sin(a * 3) * 18, Math.sin(a) * Rc);
  o.lookAt(0, 0, 0);
  o.rotateY(-Math.PI / 2);
  o.updateMatrix();
  return new THREE.Matrix4().makeRotationZ(0.12).multiply(o.matrix);
}
for (const i of [5, 10]) {
  const C = collectorMatrix(i).multiply(basis(X(-8.9, 0, -1.07), X(0, 0, -1), X(1, 0, 0)));
  const p = V().setFromMatrixPosition(C), n = V().setFromMatrixColumn(C, 1), f = V().setFromMatrixColumn(C, 2);
  framePort({ target: 'hearth', key: `collector${i + 1}`, label: `Hearth - collector ${i + 1} docking node`, clear: 0.2, approach: 3.0, p, n, fwd: f });
}
// the Refuge's top pole (target frame = the Hearth's; the Refuge sits in the stations ring, tilted 0.12 rad about z)
{
  const R = new THREE.Matrix4().makeRotationZ(0.12);
  framePort({ target: 'hearthworks', key: REFUGE_DOCK.key, label: REFUGE_DOCK.label, clear: 0.05, approach: 2.0,
    p: REFUGE_DOCK.p.clone().multiplyScalar(KM).applyMatrix4(R), n: REFUGE_DOCK.n.clone().applyMatrix4(R), fwd: REFUGE_DOCK.fwd.clone().applyMatrix4(R) });
}

// ------------------------------------------------------------------------- Helianth --
framePort({ target: 'solarCollector', key: HELIANTH_DOCK.key, label: HELIANTH_DOCK.label, clear: 0.05, approach: 1.2,
  p: HELIANTH_DOCK.p.clone().multiplyScalar(KM), n: HELIANTH_DOCK.n, fwd: HELIANTH_DOCK.fwd });
// the service works sit 0.24 km under the core tip in the same frame (target origin collector-local (0, 3.7, 0) km)
framePort({ target: 'solarService', key: HELIANTH_DOCK.key, label: `${HELIANTH_DOCK.label} (over the service works)`, clear: 0.05, approach: 1.2,
  p: HELIANTH_DOCK.p.clone().multiplyScalar(KM).sub(X(0, 3.7, 0)), n: HELIANTH_DOCK.n, fwd: HELIANTH_DOCK.fwd });

// ---------------------------------------------------------------- the Lagrange points --
// each colony pair's cylinders at x = +-20 km (lagrange.js; the target frame is the pair's
// group); each spindle's anti-sun cap carries a collar on its axis, the stator despun
for (const name of ['lagrangeL4', 'lagrangeL5']) {
  for (const s of [-1, 1]) {
    framePort({ target: name, key: s < 0 ? 'westSpindle' : 'eastSpindle', label: `${name === 'lagrangeL4' ? 'L4' : 'L5'} colony ${s < 0 ? 'west' : 'east'} cylinder - spindle dock`,
      clear: 0.08, approach: 1.2, p: LAGRANGE_DOCK.p.clone().multiplyScalar(KM).add(X(s * 20, 0, 0)), n: LAGRANGE_DOCK.n, fwd: LAGRANGE_DOCK.fwd });
  }
}
for (const d of FULCRUM_DOCKS) {
  framePort({ target: 'lagrangeL1', key: d.key, label: d.label, clear: 0.04, approach: 1.2, p: d.p.clone().multiplyScalar(KM), n: d.n, fwd: d.fwd });
}

// ------------------------------------------------------------ Earth-fixed structures --
// (the Halo ports, the elevator's Harbour, junction and counterweight, the GEO roads and belt:
// children of space.earthFixed, which turns with sim.earthQuat)
function earthFixed(target, key, label, kind, efM, p, n, fwd, { clear = 0.05, approach = 2.0 } = {}) {
  const L = new THREE.Matrix4().copy(efM).multiply(basis(p, n, fwd));
  return add({
    id: `${target}:${key}`, target, label, kind, clear, approach,
    pose(space, out) { return readPose(_M.makeRotationFromQuaternion(space.sim.earthQuat).multiply(L), out); },
  });
}
const MERID = bodyDir(0, MERIDIAN_LON), NAURU = bodyDir(0, NAURU_LON);
const JUNCTION_M = new THREE.Matrix4().compose(MERID.clone().multiplyScalar(R_EARTH + 620), stationFrame(MERID), ONE);
const HALO_M = new THREE.Matrix4().compose(NAURU.clone().multiplyScalar(R_EARTH + 620), stationFrame(NAURU), ONE);
const HARBOUR_M = new THREE.Matrix4().compose(MERID.clone().multiplyScalar(R_EARTH + GEO_ALT), stationFrame(MERID), ONE);
const COUNTER_M = new THREE.Matrix4().compose(MERID.clone().multiplyScalar(R_EARTH + COUNTERWEIGHT_ALT + 10), new THREE.Quaternion().setFromUnitVectors(X(0, 1, 0), MERID), ONE);
for (const d of PIER_DOCKS) {
  earthFixed('junction', d.key, `Halo junction - ${d.label}`, 'dock', JUNCTION_M, d.p, d.n, d.fwd);
  earthFixed('halo', d.key, `Halo, Nauru port - ${d.label}`, 'dock', HALO_M, d.p, d.n, d.fwd);
}
// the Meridian itself lies under the atmosphere (the ship keeps R_EARTH + 95 km): it docks at the
// Halo junction straight overhead, where the tether passes through the ring
earthFixed('meridian', 'junctionPier', `Meridian - via the Halo junction overhead, ${PIER_DOCKS[0].label}`, 'dock', JUNCTION_M, PIER_DOCKS[0].p, PIER_DOCKS[0].n, PIER_DOCKS[0].fwd);
for (const d of HARBOUR_DOCKS) earthFixed('geo', d.key, d.label, 'dock', HARBOUR_M, d.p, d.n, d.fwd, { clear: 0.06 });
earthFixed('waterStore', STORE_DOCK.key, STORE_DOCK.label, 'dock', new THREE.Matrix4().copy(HARBOUR_M).multiply(new THREE.Matrix4().makeTranslation(STORE_POS.x, STORE_POS.y, STORE_POS.z)), STORE_DOCK.p, STORE_DOCK.n, STORE_DOCK.fwd, { clear: 0.04, approach: 0.65 });
earthFixed('counter', COUNTER_DOCK.key, COUNTER_DOCK.label, 'dock', COUNTER_M, COUNTER_DOCK.p, COUNTER_DOCK.n, COUNTER_DOCK.fwd, { clear: 0.06 });
earthFixed('releaseYard', COUNTER_DOCK.key, `${COUNTER_DOCK.label} (the release yard's station, 31 km west)`, 'dock', COUNTER_M, COUNTER_DOCK.p, COUNTER_DOCK.n, COUNTER_DOCK.fwd, { clear: 0.06 });
// the Embarkation Terrace's courier pad (interfaces.js: 128 x 102 m, a courier parked mid-pad):
// the free west end of the pad, in the terrace's own frame (the target's)
framePort({ target: 'harbourTerrace', key: 'courierPad', label: 'Embarkation Terrace - courier pad', kind: 'pad', clear: 0.02, approach: 0.4,
  p: X(0.323, 0.0114, 0.120), n: X(0, 1, 0), fwd: X(0, 0, 1) });
// Nauru Works: the commons pier's deck, sunward of the berthed tug (foundryCommons.js)
framePort({ target: 'foundry', key: 'commonsPier', label: 'Nauru Works - commons pier', kind: 'pad', clear: 0.04, approach: 1.5,
  p: X(0.25, -1.48, 16.4), n: X(0, 1, 0), fwd: X(0, 0, 1) });
// Concord Yard: the yard house's hub tip on the hull axis, astern of the crew wheel
framePort({ target: 'concordYard', key: 'hubTip', label: 'Concord Yard - yard house hub dock (hull axis)', clear: 0.04, approach: 2.0,
  p: X(1.81, 0, 0), n: X(1, 0, 0), fwd: X(0, 1, 0) });
// the belt's stations (beltStations.js docks, their clear axes outward; the traffic uses the -z
// pole and the -z diagonals of the Kalani Wheel, and both docks of the Slip and the Relay)
framePort({ target: 'beltWheel', key: 'northPole', label: 'Kalani Wheel - north pole dock (spin axis)', clear: 0.03, approach: 2.0, p: X(0, 0, 0.2092), n: X(0, 0, 1), fwd: X(0, 1, 0) });
framePort({ target: 'beltWheel', key: 'northDiagonal', label: 'Kalani Wheel - north hub dock', clear: 0.03, approach: 2.0, p: X(0.0298, 0.0298, 0.118), n: X(S2, S2, 0), fwd: X(0, 0, 1) });
framePort({ target: 'beltYard', key: 'eastDock', label: 'Ironwood Slip - east dock', clear: 0.03, approach: 2.0, p: X(0.1013, 0, -0.0851), n: X(1, 0, 0), fwd: X(0, 0, 1) });
framePort({ target: 'beltRelay', key: 'northDock', label: 'Helion Relay 4 - north dock', clear: 0.03, approach: 2.0, p: X(0, 0.010, 0.0583), n: X(0, 0, 1), fwd: X(0, 1, 0) });
framePort({ target: 'beltRelay', key: 'southDock', label: 'Helion Relay 4 - south dock', clear: 0.03, approach: 2.0, p: X(0, 0.010, -0.0313), n: X(0, 0, -1), fwd: X(0, 1, 0) });

export const PORT_SPECS = PORTS;

// ================================================================ registry ==
const BODIES = new Set(['earth', 'moon', 'sun', 'lodestar']);

function fallback(space, name) {
  const t = space.targets[name];
  return {
    id: `${name}:approach`, target: name, label: `${(t && t.name) || name} - approach point`, kind: 'dock',
    clear: 0.05, approach: 0.5,
    pose(sp, out) {
      const P = sp.targets[name].position(V()), sim = sp.sim;
      out.pos = (out.pos || V()).copy(P);
      const d = P.length() < R_EARTH * 3 ? V().copy(P) : P.distanceTo(sim.moonPos) < R_MOON * 3 ? V().copy(P).sub(sim.moonPos) : V().set(0, 1, 0);
      out.n = (out.n || V()).copy(d.normalize());
      out.pos.addScaledVector(out.n, Math.max(sp.targets[name].minDist || 0.1, 0.1));
      out.fwd = (out.fwd || V()).set(0, 0, 1).cross(out.n);
      if (out.fwd.lengthSq() < 1e-6) out.fwd.set(1, 0, 0);
      out.fwd.normalize();
      return out;
    },
  };
}

/** Every port and pad in the scene. */
export function getPorts(space) {
  if (space._ports) return space._ports;
  const list = PORTS.filter((p) => space.targets[p.target]);
  const have = new Set(list.map((p) => p.target));
  for (const k of Object.keys(space.targets)) if (!BODIES.has(k) && !have.has(k)) list.push(fallback(space, k));
  space._ports = list;
  // the HUD's target list reads the count off each target
  for (const k of Object.keys(space.targets)) space.targets[k].ports = list.filter((p) => p.target === k).length;
  return list;
}

/** The ports of one target (possibly empty). */
export function portsFor(space, target) { return getPorts(space).filter((p) => p.target === target); }
