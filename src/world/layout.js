// The master plan of Meridian. Units: metres. +X east, +Z south, +Y up.
// Sea level is y = 0. The Axis (space elevator anchor) stands at the origin.

export const CENTRAL_ISLAND = { x: 0, z: 0, r: 980, h: 11 };
export const PLAZA_Y = 16;          // top of the Axis foundation plaza
export const PLAZA_R = 560;

export const ISLANDS = [
  { id: 'aster', name: 'Aster', x: 2500, z: -2000, r: 560, h: 24 },
  { id: 'lumen', name: 'Lumen', x: 3750, z: 250, r: 700, h: 30 },
  { id: 'solace', name: 'Solace', x: 2350, z: 2650, r: 520, h: 18 },
  { id: 'verdant', name: 'Verdant', x: -250, z: 3650, r: 620, h: 22 },
  { id: 'cantor', name: 'Cantor', x: -2650, z: 2300, r: 640, h: 26 },
  { id: 'halcyon', name: 'Halcyon', x: -3800, z: -150, r: 740, h: 38 },
  { id: 'oriel', name: 'Oriel', x: -2350, z: -2700, r: 580, h: 28 },
  { id: 'thule', name: 'Thule', x: 350, z: -3700, r: 660, h: 32 },
];

export const RIM = { radius: 5900, width: 820, channels: [
  { angle: Math.PI / 2, width: 0.2 },      // south: the Gate channel
  { angle: 0.05, width: 0.07 },            // east
  { angle: -2.45, width: 0.06 },           // north-west
  { angle: 2.55, width: 0.05 },            // south-west
] };

export const GATE = { x: 0, z: 5900, span: 1300, height: 1250 };

// Arcology towers. type: helix | canopy | lens | lattice | shell
export const TOWERS = [
  { type: 'helix', x: 2380, z: -2080, height: 1150, radius: 70, petals: 5, twist: 1.3, seed: 1, name: 'Aster Helix' },
  { type: 'canopy', x: 2720, z: -1760, height: 620, radius: 42, seed: 2 },
  { type: 'lens', x: 3700, z: 150, height: 1320, radius: 150, seed: 3, name: 'Lumen Stack' },
  { type: 'helix', x: 3980, z: 560, height: 820, radius: 55, petals: 3, twist: 0.8, seed: 4 },
  { type: 'lattice', x: 3380, z: 520, height: 720, radius: 80, seed: 5 },
  { type: 'canopy', x: 2300, z: 2620, height: 720, radius: 46, seed: 6, name: 'Solace Canopy' },
  { type: 'helix', x: -380, z: 3520, height: 620, radius: 48, petals: 6, twist: 0.6, seed: 7 },
  { type: 'shell', x: -2700, z: 2200, height: 1220, radius: 120, seed: 8, name: 'Cantor Nautilus' },
  { type: 'helix', x: -2380, z: 2560, height: 760, radius: 52, petals: 4, twist: 1.6, seed: 9 },
  { type: 'helix', x: -3800, z: -180, height: 1560, radius: 82, petals: 6, twist: 1.0, seed: 10, name: 'Halcyon Spire' },
  { type: 'lens', x: -4150, z: 180, height: 740, radius: 95, seed: 11 },
  { type: 'canopy', x: -3480, z: -520, height: 560, radius: 40, seed: 12 },
  { type: 'lens', x: -2320, z: -2760, height: 930, radius: 115, seed: 13 },
  // north-west of Oriel's lens, clear of the maglev terminal and the promenade landing on the
  // south-east shore (it stood on both) and of the lens with its garden discs
  { type: 'canopy', x: -2632, z: -2932, height: 600, radius: 44, seed: 14 },
  { type: 'lattice', x: 380, z: -3760, height: 1040, radius: 110, seed: 15, name: 'Thule Lattice' },
  { type: 'helix', x: 700, z: -3450, height: 800, radius: 56, petals: 5, twist: -1.2, seed: 16 },
  // on the atoll rim
  { type: 'helix', x: 4300, z: -4000, height: 560, radius: 44, petals: 4, twist: 0.9, seed: 17 },
  { type: 'shell', x: -5200, z: 2450, height: 640, radius: 70, seed: 18 },
  { type: 'lattice', x: 5500, z: 1900, height: 520, radius: 60, seed: 19 },
  { type: 'canopy', x: -4300, z: -4050, height: 480, radius: 36, seed: 20 },
  // Greater Meridian: the rim grows into a ring of arcologies round the lagoon
  { type: 'lens', x: 5023, z: 2900, height: 980, radius: 110, seed: 21 },
  { type: 'helix', x: 3341, z: 4772, height: 860, radius: 58, petals: 5, twist: 1.1, seed: 22 },
  { type: 'canopy', x: 2078, z: 5709, height: 640, radius: 44, seed: 23 },
  { type: 'canopy', x: -1924, z: 5286, height: 600, radius: 42, seed: 24 },
  { type: 'lattice', x: -3960, z: 3960, height: 1080, radius: 100, seed: 25, name: 'Cantor Rim Lattice' },
  { type: 'helix', x: -6002, z: 525, height: 1240, radius: 74, petals: 6, twist: 0.8, seed: 26 },
  { type: 'lens', x: -5347, z: -2493, height: 900, radius: 100, seed: 27 },
  { type: 'shell', x: -3441, z: -4915, height: 1100, radius: 96, seed: 28 },
  { type: 'helix', x: -503, z: -5753, height: 980, radius: 64, petals: 4, twist: -1.1, seed: 29 },
  { type: 'lattice', x: 2567, z: -5506, height: 900, radius: 86, seed: 30 },
  { type: 'shell', x: 5370, z: -2504, height: 1000, radius: 90, seed: 31 },
];

// The Outer Wards: seven sea districts on built platforms around the atoll, each a
// full town under its own cluster of arcologies, joined to the rim by a bridge and
// maglev. They make Meridian a metropolis some 35 km across.
//   towers: [type, angle (rad, ward frame), distance (fraction of r), height, radius, extras]
export const WARDS = [
  { id: 'aurora', name: 'Aurora', x: 10200, z: -5400, r: 1350, seed: 3, palette: 'silver',
    towers: [['crystal', 0, 0, 1880, 150], ['helix', 0.6, 0.5, 1180, 70, { petals: 5, twist: 1.1 }], ['lens', 2.4, 0.52, 960, 110], ['canopy', 4.1, 0.48, 640, 44], ['shell', 5.3, 0.55, 880, 80]] },
  { id: 'tidewater', name: 'Tidewater', x: 12200, z: 2400, r: 1150, seed: 5, palette: 'jade',
    towers: [['twin', 0, 0, 1620, 92, { at: [0, -30] }], ['canopy', 0, 0, 700, 48, { at: [-370, -330] }], ['lattice', 0, 0, 980, 90, { at: [390, -380] }], ['helix', 0, 0, 820, 56, { petals: 4, twist: -1.3, at: [-575, 725] }]] },
  { id: 'sunward', name: 'Sunward', x: 16500, z: -1500, r: 1000, seed: 7, palette: 'bronze',
    towers: [['receiver', 0, 0, 1420, 120], ['lens', 1.9, 0.5, 780, 90], ['helix', 4.2, 0.5, 700, 50, { petals: 5, twist: 1.4 }]] },
  { id: 'seraph', name: 'Seraph', x: 8200, z: 9400, r: 1050, seed: 11, palette: 'rose',
    towers: [['seraph', 0, 0, 1500, 150], ['lens', 2.426, 0.565, 900, 70], ['canopy', 0.332, 0.565, 620, 42], ['lens', 4.520, 0.565, 760, 74]] },
  { id: 'southmarch', name: 'Southmarch', x: 0, z: 13800, r: 1250, seed: 13, palette: 'pearl',
    towers: [['mast', 0, 0, 2100, 100, { at: [0, -170] }], ['lattice', 0, 0, 1100, 100, { at: [-650, 40] }], ['shell', 0, 0, 940, 86, { at: [-600, -560] }], ['lens', 0, 0, 820, 100, { at: [600, -440] }], ['canopy', 0, 0, 560, 40, { at: [560, 830] }]] },
  { id: 'coral', name: 'Coral Reach', x: -7800, z: 9600, r: 1100, seed: 17, palette: 'sand',
    towers: [['coral', 0, 0, 1180, 70], ['helix', 0, 0, 1020, 64, { petals: 5, twist: -0.9, at: [305, 525] }], ['lens', 0, 0, 860, 96, { at: [-530, -265] }], ['helix', 0, 0, 680, 48, { petals: 3, twist: 1.5, at: [285, -530] }]] },
  { id: 'westmere', name: 'Westmere', x: -12000, z: 3000, r: 1300, seed: 19, palette: 'marble',
    towers: [['deco', 0, 0, 1720, 140], ['shell', 0.8, 0.52, 1060, 90], ['helix', 2.6, 0.5, 1240, 72, { petals: 6, twist: 0.7 }], ['canopy', 4.2, 0.5, 660, 46], ['lens', 5.4, 0.52, 900, 104]] },
];

export const FLOATING_ISLANDS = [
  { x: 1564, y: 560, z: -493, r: 175, seed: 1 },     // kept clear of the promenades (and their air)
  { x: 2150, y: 830, z: -560, r: 140, seed: 2 },
  { x: 1608, y: 1160, z: 784, r: 115, seed: 3 },
  { x: 880, y: 1380, z: -1720, r: 105, seed: 4 },
  { x: 2750, y: 610, z: 450, r: 125, seed: 5 },
  { x: 560, y: 780, z: -2250, r: 135, seed: 6 },
  { x: -1550, y: 920, z: -1300, r: 155, seed: 7 },
  { x: -820, y: 540, z: 1750, r: 112, seed: 8 },
];

export const CHORUS = { x: 1450, y: 700, z: 1350, scale: 230 };

export const SKYPORT = { x: -2900, y: 1500, z: -2550, r: 380 };

// Promenades: one bridge from the Axis plaza rim to each island. The deck leaves the
// plaza at its own level and comes down onto a landing square on the island's main
// avenue (the island radial that points back at the Axis).
export const PROM_LAND_F = 0.68;
export function promenadeAxis(isl) {
  const dx = isl.x - CENTRAL_ISLAND.x, dz = isl.z - CENTRAL_ISLAND.z;
  const dist = Math.hypot(dx, dz);
  const dir = { x: dx / dist, z: dz / dist };
  const end = dist - isl.r * PROM_LAND_F;
  return { dir, dist, start: PLAZA_R - 4, end, landing: { x: dir.x * end, z: dir.z * end }, angleOnIsland: Math.atan2(-dz, -dx) };
}
