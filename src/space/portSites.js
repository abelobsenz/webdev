import * as THREE from 'three';

// Docking hardware added for the ports registry (src/space/ports.js), where a station had no
// plausible place for a ship to mate or set down. Shared between the station builders (which
// fit the collars, pads and approach lights: src/space/dockKit.js) and the registry (which
// flies the Lodestar to them), so the two can never disagree.
//
// Each site is { p, n, fwd } in its station's local frame and units (named per site): p the
// mating point (the collar's face centre, the pad's surface centre), n out of the structure along
// the approach, fwd the roll reference (the mated ship's nose).

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const S = Math.SQRT1_2;

/**
 * Anansi's hub (s.fixed, metres; tether along +-y): two collars on the ballast drum (r 44) at
 * y -40, below the crew ring (y +34) and the wings and radiators (|y| <= 25), facing out on the
 * diagonals between the solar wings (+-x) and the radiators (+-z); noses down the tether.
 */
export const ANANSI_DOCKS = [
  { key: 'hubDockA', label: 'Anansi - hub dock A', p: V(S * 47.4, -40, S * 47.4), n: V(S, 0, S), fwd: V(0, -1, 0) },
  { key: 'hubDockB', label: 'Anansi - hub dock B', p: V(-S * 47.4, -40, -S * 47.4), n: V(-S, 0, -S), fwd: V(0, -1, 0) },
];

/**
 * Hevelius Yard (yard group, km; built in metres): the crew block's outer glazed face (x 236)
 * gets a collar at its centre, clear of the radiators (x 150-230) and the dock frames.
 */
export const HEVELIUS_DOCK = { key: 'crewDock', label: 'Hevelius Yard - crew block dock', p: V(239.4, 0, -150), n: V(1, 0, 0), fwd: V(0, 0, 1) };

/**
 * Tranquillity Exchange (port group, metres; local Y radial out, Z along the Moon's axis): a collar
 * on the crown of each pier-end dome (centre (0, -1050, +-9500), apex y -450), 9.5 km off the hub
 * and outside the ring band (+-5.5 km), facing up the radial into open sky.
 */
export const EXCHANGE_DOCKS = [
  { key: 'northPier', label: 'Tranquillity Exchange - north pier dock', p: V(0, -1050 + 598.4 + 3.4, 9500), n: V(0, 1, 0), fwd: V(1, 0, 0) },
  { key: 'southPier', label: 'Tranquillity Exchange - south pier dock', p: V(0, -1050 + 598.4 + 3.4, -9500), n: V(0, 1, 0), fwd: V(1, 0, 0) },
];

/**
 * The lunar service court (court mesh, metres; deck y 23): a painted, edge-lit pad on the
 * landing court slab (x 255-405, z -40..70, top 23.4) beside the parked courier (x 330),
 * inside the court's declared clear column.
 */
export const COURT_PAD = { key: 'landingCourt', label: 'Lunar service court - landing court', p: V(382, 23.4, 15), n: V(0, 1, 0), fwd: V(0, 0, 1), r: 20 };

/**
 * The Halo's port stations (the junction's group and each HaloPorts group, km; x along the ring,
 * y radial, z across): a collar under each pier (tube r 0.15 at y -3.4) midway between the
 * shuttle hung at 9.0 km and the tug at 12.4 km, facing the Earth like the pier's other berths.
 */
export const PIER_DOCKS = [
  { key: 'pierNorth', label: 'north pier dock', p: V(0, -3.55 - 0.0034, 10.7), n: V(0, -1, 0), fwd: V(0, 0, 1) },
  { key: 'pierSouth', label: 'south pier dock', p: V(0, -3.55 - 0.0034, -10.7), n: V(0, -1, 0), fwd: V(0, 0, -1) },
];

/**
 * The GEO Harbour (harbour group, km): the arm-head docking collars (geoRoads.js: face at
 * d * tipR, clear out along d; the MOVEMENTS freighters use each head 40% of their cycle), the
 * upper arm 0 and the lower arm 4. Existing hardware: nothing is added.
 */
export const HARBOUR_DOCKS = [
  { key: 'arm1head', label: 'GEO Harbour - arm 1 head collar', p: V(5.634, 1.26, 8.500), n: V(0.553, 0, 0.833), fwd: V(0, 1, 0), existing: true },
  { key: 'arm5head', label: 'GEO Harbour - arm 5 head collar', p: V(10.488, -1.26, 2.126), n: V(0.980, 0, 0.199), fwd: V(0, 1, 0), existing: true },
];

/** The Water Store (store group, km): a collar on the cage's free -z face, level with the tanker collars. */
export const STORE_DOCK = { key: 'cageDock', label: 'Water Store - cage dock', p: V(0, 0.64, -0.34 - 0.0034), n: V(0, 0, -1), fwd: V(1, 0, 0) };

/** The counterweight (counter group, km; +Y out along the tether): a collar on the pole mast's tip. */
export const COUNTER_DOCK = { key: 'poleDock', label: 'Counterweight - pole mast dock', p: V(0, 16.8 + 0.0034, 0), n: V(0, 1, 0), fwd: V(0, 0, 1) };

/** Selene (refinery group, km; +Y the spindle toward the Earth): a collar on the lantern spire's tip, metres. */
export const SELENE_DOCK = { key: 'spireDock', label: 'Selene - spire dock (spindle axis)', p: V(0, 2803.4, 0), n: V(0, 1, 0), fwd: V(1, 0, 0) };

/**
 * The tenders (tender 2's hull mesh, metres; +Z the bow and its capture cradle, +Y dorsal): a
 * collar on the spine's dorsal crown 83 m aft of midships, between the cargo pods (y -2, x +-52)
 * and forward of the command pod (z -190).
 */
export const TENDER_DOCK = { key: 'dorsalDock', label: 'Tender 2 - dorsal dock', p: V(0, 22.86 + 3.4, -82.7), n: V(0, 1, 0), fwd: V(0, 0, 1) };

/** The Refuge (refuge group, km; +Y its spin axis): a collar on the gold top pole, metres. */
export const REFUGE_DOCK = { key: 'poleDock', label: 'The Refuge - top pole dock (spin axis)', p: V(0, 16774 + 3.4, 0), n: V(0, 1, 0), fwd: V(0, 0, 1) };

/** Helianth (collector mesh, metres; +Y away from the Sun): a collar on the transfer core's tip. */
export const HELIANTH_DOCK = { key: 'coreTip', label: 'Helianth - transfer core tip dock', p: V(0, 3939.4 + 3.4, 0), n: V(0, 1, 0), fwd: V(0, 0, 1) };

/** Each Lagrange cylinder (cyl group, metres; +Z sunward): a collar on the anti-sun spindle's flat cap (z -24950). */
export const LAGRANGE_DOCK = { p: V(0, 0, -24950 - 3.4), n: V(0, 0, -1), fwd: V(0, 1, 0) };

/** The Fulcrum at L1 (gateway group, metres; +Z toward the Moon): collars on both spine end caps (z +-990). */
export const FULCRUM_DOCKS = [
  { key: 'earthSpine', label: 'Fulcrum - Earthward spine dock', p: V(0, 0, -993.4), n: V(0, 0, -1), fwd: V(0, 1, 0) },
  { key: 'moonSpine', label: 'Fulcrum - Moonward spine dock', p: V(0, 0, 993.4), n: V(0, 0, 1), fwd: V(0, 1, 0) },
];
