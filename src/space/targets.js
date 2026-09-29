// Focus targets for the orbital view, with short lore in the house style.
export const TARGET_INFO = {
  earth: {
    key: '1', name: 'Earth', district: 'Home · 1 AU from the Sun',
    lore: 'The whole planet, as the Halo sees it every ninety minutes. The Sahara is still a desert at its heart, but its margins have been green for a thousand years. The lights on the night side trace the old coastal cities and the equator, where the elevators come down.',
    facts: [['Radius', '6,371 km'], ['Rings', '4'], ['Population', '11.2 billion']],
  },
  meridian: {
    key: '2', name: 'Meridian', district: 'Equator · 157° W',
    lore: 'From orbit the capital is a turquoise ring in an empty ocean, and at night the brightest point on a planet strung with light. The tether rises straight out of its centre. Of all the cities on the night side, it is the one you find first from the Moon with the naked eye.',
    facts: [['Lagoon', '11.8 km'], ['Tether', '100,000 km'], ['Climbers', '1 every 6 min']],
  },
  halo: {
    key: '3', name: 'The Halo', district: 'Orbital Ring · 620 km',
    lore: 'An unbroken ring around the equator, carried on a magnetic rotor that moves faster than orbit so the habitat deck can stand still over the ground. Seven tethers hang from it to the equatorial ports. Its shadow is the thin dark line you can see crossing the tropics.',
    facts: [['Circumference', '43,900 km'], ['Width', '32 km'], ['Residents', '90 million']],
  },
  geo: {
    key: '4', name: 'Geostationary Harbour', district: 'Tether · 35,786 km',
    lore: 'Halfway up the tether, where an orbit takes exactly one day, climbers stop and ships leave. Its three counter-rotating rings echo the Crown on the Axis far below. Everything bound for Mars, the belt or the outer moons departs from these docks.',
    facts: [['Rings', '3, counter-rotating'], ['Berths', '1,140'], ['Climb from Meridian', '15 h']],
  },
  moon: {
    key: '5', name: 'The Moon', district: 'Luna · 384,400 km',
    lore: 'Terraformed between 4230 and 4630 CE. The old maria are shallow seas now, the highlands are green, and a thin atmosphere holds clouds. A single ring circles its equator. Forty million people live there, most of them on the near side, facing home.',
    facts: [['Radius', '1,737 km'], ['Surface gravity', '0.17 g'], ['Population', '40 million']],
  },
  sun: {
    key: '6', name: 'The Sun and the Swarm', district: 'Sol · 1 AU',
    lore: 'Four inclined rings of collectors orbit the Sun between 0.05 and 0.13 AU, with statites hovering above its poles. Together they catch a little under one percent of its light. That is enough to power every city, ring and ship in the system many times over.',
    facts: [['Collectors', '2.1 × 10¹⁵'], ['Captured', '0.8 % of output'], ['Rings', '4']],
  },
  hearth: {
    key: '7', name: 'The Hearth', district: 'Sun–Earth L2 · 1.5 million km',
    lore: 'A spinning black hole, grown from a primordial seed and kept on a wide orbit beyond the Earth. Matter fed into its disc falls toward the horizon at half the speed of light and glows hotter than any star. The collector ring around it turns that light into power. Its gravity bends the stars behind it into a ring.',
    facts: [['Horizon', '60 km across'], ['Spin', 'a = 0.7'], ['Output', '4 × 10²⁴ W']],
  },
};

TARGET_INFO.liner = {
  key: '8', name: 'Concord-class Liner', district: 'Berthed at the Harbour',
  lore: 'Two and a half kilometres of passenger ship, grown rather than welded. The garden along her back is real, under ribs that carry the hull loads; the lit galleries on her flanks are the promenade decks. The ring ahead of her prow is a magnetic scoop that gathers interplanetary hydrogen on the long run to Mars.',
  facts: [['Length', '2.4 km'], ['Passengers', '38,000'], ['Earth to Mars', '19 days']],
};
TARGET_INFO.tenders = {
  key: '9', name: 'Reclamation Tenders', district: 'Above the Halo · 624 km',
  lore: 'Nothing in orbit is thrown away. The tenders drift along the Halo gathering dead satellites, spent tethers and the dust of old collisions in their three-armed cradles, and carry it all to the ring foundries to be made into something new. Low orbit has been clean for eight hundred years.',
  facts: [['Length', '620 m'], ['Fleet', '4,200'], ['Recovered yearly', '1.6 Mt']],
};
TARGET_INFO.selene = {
  key: '0', name: 'Selene Works', district: 'Above the near side · 2,600 km',
  lore: 'Water, oxygen and metals from the lunar highlands are refined here and sent down the gravity well to the harbours. The great fins are radiators, glowing with waste heat. The wheel holds six thousand people, most of them in the one job that never runs out: looking after the machines.',
  facts: [['Span', '6 km'], ['Wheel', '4.4 km, 0.38 rpm'], ['Crew', '6,000']],
};

TARGET_INFO.lunarport = {
  key:'',name:'Tranquillity Exchange',district:'Lunar ring · 380 km',
  lore:'The customs hall where the near-side towns meet the orbital road. The six garden commons look back toward Earth. Below them, sealed piers receive water and refined stock from Selene Works; the two cargo courts keep their traffic outside the inhabited ring.',
  facts:[['Commons','6'],['Concourse','13.6 km'],['Role','Lunar interchange']],
};
TARGET_INFO.foundry = {
  key:'',name:'Nauru Reclamation Works',district:'Halo north wall · 627 km',
  lore:'Three open receiving halls take the tenders\' recovered satellites and old tether stock. The sorting rails lead to remelting columns and quiet stock courts. An enclosed gallery carries the works off the Halo wall; its crews live in the garden wheel behind the furnaces.',
  facts:[['Receiving halls','3'],['Stock courts','2'],['Role','Orbital reclamation']],
};
TARGET_INFO.solarCollector = {
  key:'',name:'Helianth Collector',district:'Solar swarm · polar service station',
  lore:'One working flower in the swarm. Twelve collector petals spread beneath a habitat wheel screened from the full face of the nearby Sun. The raised fins turn waste heat back into space. Above the hub, the service crown receives worn receiver leaves and sends repaired craft out among the unattended mirrors.',
  facts:[['Span','29 km'],['Collector petals','12'],['Role','Swarm maintenance']],
};
TARGET_INFO.solarService = {
  key:'',name:'Helianth Service Crown',district:'Solar swarm · receiver maintenance',
  lore:'A tug waits in its fitted cradle beside the receiving gantry. Worn receiver leaves cross to the calibration racks on the opposite wing; sealed galleries carry the crew back to the central lift and the shaded habitat below. The departure column stays open above the berth, while the radiator leaves stand well outside the working crown.',
  facts:[['Service craft','360 m tug'],['Receiver racks','3'],['Role','Swarm repair and transfer']],
};
TARGET_INFO.hearthworks = {
  key:'',name:'Hearth Refuge',district:'Beyond the collector line',
  lore:'Two counter-rotating garden wheels outside the hot collector ring. Gold transfer collars ride on magnetic bearings around the fixed spindle. The incoming gallery arrives below the wheels; repair racks and radiator leaves stay still between them. Here the collector crews sleep and tend small gardens before their next shift.',
  facts:[['Habitat wheels','2, counter-rotating'],['Wheel diameter','24 km'],['Gravity at rim','1 g']],
};

TARGET_INFO.harbourTerrace = {
  key:'',name:'Concord Embarkation Garden',district:'Harbour · liner pier',
  lore:'The last gardens before departure. Passengers come up through the pier lifts, pass customs, and wait in six connected conservatories beside the liner. Sealed galleries lead back to the boarding bridges. Baggage rails, a handling gantry and the courier court occupy the service end of the terrace.',
  facts:[['Terrace','1 km'],['Conservatories','6'],['Role','Passenger embarkation']],
};
TARGET_INFO.lunarCourt = {
  key:'',name:'Tranquillity Service Court',district:'Lunar orbital road · north traction spine',
  lore:'A local stopping place beyond the Exchange. The three-car train waits on a siding above the workshop floor. Two lifts take passengers to the town hall and its enclosed winter gardens. Beyond a separate EVA airlock, crews handle spare guide collars and calibrate radiator fins in the exterior service courts. The through line stays open.',
  facts:[['Platform','740 m'],['Service train','3 cars'],['Role','Local transit and maintenance']],
};

TARGET_INFO.lunarReceiving = {
  key:'',name:'Selene Receiving Court',district:'Tranquillity Exchange · outboard piers',
  lore:'Water and oxygen arrive from Selene in paired pressure drums. The ferry settles onto belly couplings outside the ring, above a braced unloading dock. Across the pressure spine, a gantry sorts refined metal into inspected stock. Crew airlocks face a separate EVA walkway; the ferry lifts straight outward when its transfer is complete.',
  facts:[['Fluid vessels','4'],['Ferry length','770 m'],['Role','Water, oxygen and metal receiving']],
};

TARGET_INFO.lunarLanding = {
  key:'',name:'Medii Landing',district:'The Moon · Bay of the Middle · 0° N 0° E',
  lore:'Where the Lift from the Tranquillity Exchange comes down, on the shore of the Bay of the Middle. The town steps down to its harbour in four terraces of courtyard houses; behind the Lift stand the five glass domes of the first settlement, now its gardens. Three landing fields lie beyond them, and to the west the mass driver climbs away over the plain toward its launch gate, 36 km out. The Earth never moves from the top of its sky.',
  facts:[['Lift','380 km to the Exchange'],['Mass driver','36 km, 1.7 km/s'],['Residents','210,000']],
};

export const TARGET_ORDER = ['earth', 'meridian', 'halo', 'geo', 'moon', 'sun', 'hearth', 'liner', 'tenders', 'selene', 'foundry', 'lunarport', 'lunarReceiving', 'solarCollector', 'solarService', 'hearthworks', 'harbourTerrace', 'lunarCourt', 'lunarLanding'];

// The Harbour's neighbourhood on the geostationary arc (src/space/geoRoads.js).
TARGET_INFO.concordYard = {
  key:'',name:'Concord Yard',district:'Geostationary arc · 16 km east of the Harbour',
  lore:'Where the liners are grown. The next Concord-class ship lies in nine portal frames, two thirds plated, her bow still an open cage of ribs; the gantry lowers one plate at a time and her scoop ring waits in the bow frame. The yard crews live in the glazed wheel astern. Stock arrives from the Harbour by tug and waits on the keel deck.',
  facts:[['Dock','3.2 km'],['Frames','9'],['Launches','one liner a year']],
};
TARGET_INFO.waterStore = {
  key:'',name:'Harbour Water Store',district:'Tether · 12.5 km below the Harbour',
  lore:'Water and oxygen climb the tether from the Pacific and are held here, in twenty-four tanks round a hollow cage. The climbers pass straight through its bore; the store grips only the central ribbon. Tankers berth at the upper collars and carry the stock out to the ships at the arm heads.',
  facts:[['Tanks','24'],['Held','2.1 Mt of water'],['Crew wheel','1.1 km']],
};
TARGET_ORDER.push('concordYard', 'waterStore');

// the visitor's own ship (src/space/starship.js); not in the list, it appears once flown
TARGET_INFO.lodestar = {
  key:'',name:'Lodestar',district:'Concord starcourier · the helm is yours (V)',
  lore:'A 36 m cutter of the Concord fleet, lent to visitors: a flat lifting-body hull with bronze-trimmed chines and a glazed crew deck, swept radiator wings to shed her drive heat, one main engine and two smaller ones whose skirts glow from their own heat when they burn. She flies as ships really do - 1.2 g on the main drive, momentum kept until thrust takes it away - and for the long reaches carries a jump drive that folds space round her in a bubble.',
  facts:[['Length','36 m'],['Main drive','1.2 g (3 g boost)'],['Jump','bubble drive, many c']],
};

// The counterweight's release yard (src/space/releaseYard.js).
TARGET_INFO.releaseYard = {
  key:'',name:'Counterweight Release Yard',district:'Tether · 100,000 km',
  lore:'At the top of the tether a ship is already moving faster than escape. The outer-system liners are caught here stern first, clamped in the cradles beside the gallery spar, and let go: the clamps draw back into their sleeves, and the ship drifts clear down the blue-lit release line before her drive lights. The yard crews live in the ring round the rock.',
  facts:[['Spar','23 km'],['Cradles','2'],['Release speed','7.75 km/s']],
};
TARGET_ORDER.push('releaseYard');
