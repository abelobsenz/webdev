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
  { type: 'canopy', x: -2050, z: -2480, height: 600, radius: 44, seed: 14 },
  { type: 'lattice', x: 380, z: -3760, height: 1040, radius: 110, seed: 15, name: 'Thule Lattice' },
  { type: 'helix', x: 700, z: -3450, height: 800, radius: 56, petals: 5, twist: -1.2, seed: 16 },
  // on the atoll rim
  { type: 'helix', x: 4300, z: -4000, height: 560, radius: 44, petals: 4, twist: 0.9, seed: 17 },
  { type: 'shell', x: -5200, z: 2450, height: 640, radius: 70, seed: 18 },
  { type: 'lattice', x: 5500, z: 1900, height: 520, radius: 60, seed: 19 },
  { type: 'canopy', x: -4300, z: -4050, height: 480, radius: 36, seed: 20 },
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
