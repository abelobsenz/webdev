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
  facts: [['Span', '6 km'], ['Wheel', '4.4 km, 1 rpm'], ['Crew', '6,000']],
};

export const TARGET_ORDER = ['earth', 'meridian', 'halo', 'geo', 'moon', 'sun', 'hearth', 'liner', 'tenders', 'selene'];
