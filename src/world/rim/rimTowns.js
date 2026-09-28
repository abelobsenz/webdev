// The towns of the Rim and the country between them.
//
// Ten towns are strung along Rim Way like beads, each grown round a rim arcology or a ward
// bridgehead, with designed country between: orchards and vineyards on the slopes, market
// gardens and allotments, sports grounds, an amphitheatre, the botanical ring, an observatory,
// memorial gardens by the Gate, farm hamlets. Each quarter of the ring has its own character:
//   the Harbour Coast (east, facing Aurora, Tidewater and Seraph): arcaded strands, tall
//     terraces and mews on a tight grid, warehouses turned lofts along the quays
//   the Gate Coast (south, flanking the Gate): colleges and cloisters round their quads, civic
//     pavilions, a stately grid
//   the Garden Coast (west, facing Coral Reach and Westmere): villas and mansion blocks in
//     gardens, a loose grid of long blocks
//   the Upland Coast (north, the highest ground): hill towns of stacked houses and terraces
//     on short blocks that step with the land
// Bearings in degrees (0 = east, 90 = south toward the Gate), measured round the lagoon's
// centre; the towns and country stretches lie inside the four runs of land between channels.

// long: metres between the streets that run with Rim Way; cross: metres (of arc) between the
// streets that cross the rim, every other one a lane; floors [min, max]; types: the lot
// typologies (with weights) the quarter builds; strand: what fronts its waterfronts
export const QUARTERS = {
  harbour: { name: 'Harbour Coast', long: 76, cross: 66, floors: [3, 6], types: [['terrace', 0.3], ['mews', 0.24], ['ribbon', 0.14], ['stack', 0.12], ['warehouse', 0.12], ['pavilion', 0.08]], strand: ['arcade', 'warehouse'], trees: 'palm' },
  gate: { name: 'Gate Coast', long: 84, cross: 72, floors: [3, 5], types: [['cloister', 0.26], ['college', 0.16], ['terrace', 0.22], ['mews', 0.18], ['pavilion', 0.1], ['gallery', 0.08]], strand: ['arcade', 'gallery'], trees: 'flowering' },
  garden: { name: 'Garden Coast', long: 96, cross: 80, floors: [2, 4], types: [['mansion', 0.3], ['pavilion', 0.18], ['terrace', 0.22], ['mews', 0.16], ['cloister', 0.08], ['gallery', 0.06]], strand: ['mansion', 'pavilion'], trees: 'rainTree' },
  upland: { name: 'Upland Coast', long: 70, cross: 62, floors: [3, 5], types: [['stack', 0.3], ['mews', 0.3], ['terrace', 0.28], ['cloister', 0.12]], strand: ['terrace', 'stack'], trees: 'araucaria' },
};

// a0, a1: the town's extent along the ring (degrees); centre: the bearing of its market square
export const RIM_TOWNS = [
  { name: 'Tidemark', a0: 12.0, a1: 36.0, centre: 25.0, quarter: 'harbour' },
  { name: 'Halewater', a0: 45.0, a1: 62.0, centre: 50.5, quarter: 'harbour' },
  { name: 'Southwick', a0: 102.0, a1: 118.0, centre: 104.5, quarter: 'gate' },
  { name: 'Coralgate', a0: 125.5, a1: 141.0, centre: 128.5, quarter: 'gate' },
  { name: 'Westerly', a0: 150.5, a1: 169.5, centre: 161.5, quarter: 'garden' },
  { name: 'Vespermere', a0: 196.5, a1: 213.5, centre: 199.5, quarter: 'garden' },
  { name: 'Northholm', a0: 226.5, a1: 243.0, centre: 239.5, quarter: 'upland' },
  { name: 'Highfold', a0: 256.5, a1: 272.5, centre: 259.0, quarter: 'upland' },
  { name: 'Brightholm', a0: 287.0, a1: 302.5, centre: 290.0, quarter: 'upland' },
  { name: 'Dawnhaven', a0: 310.5, a1: 341.0, centre: 324.5, quarter: 'harbour' },
];

// The country between the towns: what each stretch wants laid out, in order of preference (the
// planner gives each to the parcel whose ground suits it best; the rest become orchards,
// vineyards, market gardens or meadow as their ground and quarter suggest).
export const RIM_COUNTRY = [
  { a0: 36.0, a1: 45.0, want: ['sports', 'orchard', 'market', 'allotments'] },
  { a0: 62.0, a1: 80.0, want: ['amphitheatre', 'memorial', 'orchard', 'palmGrove', 'meadow'] },
  { a0: 96.0, a1: 102.0, want: ['memorial', 'orchard'] },
  { a0: 118.0, a1: 125.5, want: ['botanical', 'market', 'orchard'] },
  { a0: 141.0, a1: 150.5, want: ['orchard', 'palmGrove'] },
  { a0: 169.5, a1: 196.5, want: ['vineyard', 'hamlet', 'vineyard', 'orchard', 'sports', 'vineyard', 'market'] },
  { a0: 213.5, a1: 226.5, want: ['vineyard', 'orchard', 'meadow'] },
  { a0: 243.0, a1: 256.5, want: ['observatory', 'orchard', 'allotments', 'vineyard'] },
  { a0: 272.5, a1: 287.0, want: ['market', 'hamlet', 'allotments', 'orchard', 'market'] },
  { a0: 302.5, a1: 310.5, want: ['orchard', 'palmGrove'] },
  { a0: 341.0, a1: 372.0, want: ['sports', 'orchard', 'market', 'palmGrove'] },
];

// Lidos on the lagoon strand (bearing): pool terraces at the water's edge.
export const RIM_LIDOS = [67.0, 187.0, 347.0];
