import * as THREE from 'three';
import { CHORUS, SKYPORT, GATE } from '../world/layout.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Landmarks of Meridian. `view` is where the camera arrives, `target` what it
 * looks at, `orbit` (optional) drives the slow cinematic drift during the tour,
 * `time` (optional) is the hour the tour shows it at.
 */
export const POIS = [
  {
    id: 'approach', key: '1', name: 'The Southern Approach', district: 'Arrival',
    view: V(-1650, 230, 5650), target: V(0, 1150, 0), time: 17.45,
    lore: 'Most visitors first see Meridian from the sea lane through the atoll. The lagoon was a drowned caldera when the city was founded; eleven centuries of reef restoration turned it into the clearest water on Earth, and the capital was built into it rather than over it.',
    facts: [['Lagoon', '11.8 km across'], ['Population', '9.4 million'], ['Founded', '2911 CE']],
  },
  {
    id: 'axis', key: '2', name: 'The Axis', district: 'Central Island',
    view: V(1450, 520, 1900), target: V(0, 1250, 0), time: 16.9,
    orbit: { center: V(0, 900, 0), radius: 2300, height: -250, speed: 0.035 },
    lore: 'Every journey off-world begins here. The Axis is the surface anchor of the equatorial elevator: a hyperboloid lattice of grown diamond carrying a tether that climbs past the Halo, through the geostationary Harbor, to a counterweight 100,000 km out. A climber leaves every six minutes.',
    facts: [['Tower', '3,200 m'], ['Tether', '100,000 km'], ['Completed', '3791 CE']],
  },
  {
    id: 'commons', key: '3', name: 'The Commons', district: 'Axis Plaza',
    view: V(430, 19, 520), target: V(0, 900, 0), time: 18.25,
    lore: 'The plaza at the foot of the Axis is the civic heart of the Concord. Any citizen may speak here and be heard by the whole assembly. The concentric reflecting pools hold the names of everyone who has served; twelve avenues point to the twelve founding regions.',
    facts: [['Diameter', '1.12 km'], ['Avenues', '12'], ['Reflecting pools', '2 rings']],
  },
  {
    id: 'crown', key: '4', name: 'The Crown', district: 'Axis · 3,120 m',
    view: V(720, 3180, 840), target: V(0, 3110, 0), time: 18.05,
    orbit: { center: V(0, 3110, 0), radius: 900, height: 90, speed: 0.06 },
    lore: 'Three counter-rotating rings circle the tether anchor. They are active stabilisers: they absorb the harmonics of 100,000 km of vibrating tether and turn them into power. At dusk the Crown is still in sunlight after the city below has gone dark.',
    facts: [['Rings', '500 m span'], ['Climber speed', '2,400 km/h'], ['Anchor', '3,140 m']],
  },
  {
    id: 'chorus', key: '5', name: 'The Chorus', district: 'Lagoon · East',
    view: V(CHORUS.x - 620, CHORUS.y + 40, CHORUS.z + 540), target: V(CHORUS.x, CHORUS.y, CHORUS.z), time: 20.6,
    orbit: { center: V(CHORUS.x, CHORUS.y, CHORUS.z), radius: 820, height: 60, speed: 0.05 },
    lore: 'A monument of one hundred thousand motes of programmable matter. It never holds a form for long. Every few seconds it moves on to the next chapter of the human story: stardust, the helix, the tree of life, fire, the first photograph of home, the atom, the Axis, and the galaxy ahead.',
    facts: [['Motes', '100,000'], ['Span', '460 m'], ['Cycle', '8 forms']],
    live: 'chorus',
  },
  {
    id: 'gardens', key: '6', name: 'The Archipelago Aloft', district: 'Floating Gardens',
    view: V(2164, 660, 127), target: V(1564, 540, -493), time: 9.4,
    orbit: { center: V(1564, 560, -493), radius: 620, height: 110, speed: 0.07 },
    lore: 'The public gardens float. Each island rests on a lattice of diamagnetic crystal that glows faintly when it is carrying load. Their waterfalls never reach the lagoon. The water turns to mist on the way down and is collected by the air itself.',
    facts: [['Islands', '8'], ['Altitude', '540 – 1,380 m'], ['Oldest', '4406 CE']],
  },
  {
    id: 'halcyon', key: '7', name: 'Halcyon Spire', district: 'Halcyon',
    view: V(-2750, 420, 1050), target: V(-3800, 800, -150), time: 7.2,
    orbit: { center: V(-3800, 700, -150), radius: 1500, height: -150, speed: 0.04 },
    lore: 'The tallest arcology in the capital is a vertical neighbourhood of 380,000 people. Its six-lobed section turns a full revolution as it rises, so every home gets the morning sun. The planted bands every hundred metres are public parks, and they are open all night.',
    facts: [['Height', '1,560 m'], ['Residents', '380,000'], ['Sky parks', '14']],
  },
  {
    id: 'lumen', key: '8', name: 'Lumen Stack', district: 'Lumen',
    view: V(2900, 380, 1500), target: V(3700, 700, 150), time: 14.5,
    lore: 'Lumen is the university district. Each elliptical plate on the stack is a separate campus, and the plates rotate slowly around a core of living light. Students climb from the first plate to the last over a lifetime of study. Some of them never finish, and that is considered the point.',
    facts: [['Height', '1,320 m'], ['Plates', '14'], ['Faculties', '212']],
  },
  {
    id: 'cantor', key: '9', name: 'Cantor Nautilus', district: 'Cantor',
    view: V(-1850, 360, 3250), target: V(-2700, 650, 2200), time: 16.4,
    lore: 'This twisting sail holds the Archive. Every surviving language, recording and dataset of human civilisation is stored in its glass, written into crystal at a density of one exabyte per gram and copied again to Luna and to the Halo.',
    facts: [['Height', '1,220 m'], ['Languages', '11,904'], ['Copies', '3 worlds']],
  },
  {
    id: 'gate', key: '0', name: 'Gate of Concord', district: 'Southern Channel',
    view: V(0, 110, 8600), target: V(0, 950, 0), time: 18.4,
    lore: 'Two catenary arches lean together over the sea entrance to the lagoon, and they frame the Axis for every arriving ship. They commemorate the Accord of 2911, when the last national governments merged into the Concord without a shot being fired.',
    facts: [['Span', `${GATE.span.toLocaleString('en-US')} m`], ['Height', `${GATE.height.toLocaleString('en-US')} m`], ['Accord', '2911 CE']],
  },
  {
    id: 'skyport', name: 'Skyport Meridian', district: 'Hovering Harbour',
    view: V(SKYPORT.x + 900, SKYPORT.y + 280, SKYPORT.z + 900), target: V(SKYPORT.x, SKYPORT.y, SKYPORT.z), time: 11.2,
    orbit: { center: V(SKYPORT.x, SKYPORT.y, SKYPORT.z), radius: 1250, height: 250, speed: 0.05 },
    lore: 'Ships that are too large for the elevator dock at this hovering harbour. Liners bound for Mars leave from here, and so do the slow arks heading for Tau Ceti. The departure lanes climb straight up into the Halo.',
    facts: [['Ring', `${(SKYPORT.r * 2).toLocaleString('en-US')} m`], ['Berths', '10'], ['Altitude', `${SKYPORT.y.toLocaleString('en-US')} m`]],
  },
  {
    id: 'halo', name: 'The Halo', district: 'Orbital Ring · 620 km',
    view: V(-400, 80, 2600), target: V(-300, 1e5, -2.5e4), time: 19.3,
    lore: 'Look up. The Halo is an orbital ring 620 km above the equator, 40 km wide and 40,000 km around. Ninety million people live on it. At dusk its underside stays lit long after the ground has gone dark, and the terminator slides across it like a sundial.',
    facts: [['Altitude', '620 km'], ['Width', '40 km'], ['Residents', '90 million']],
  },
  {
    id: 'lagoon', name: 'The Lagoon', district: 'Sea Level',
    view: V(1300, 2.6, 3100), target: V(0, 700, 0), time: 6.35,
    lore: 'Down at water level the reef is alive again. Coral that was bred to survive warm oceans now covers the old caldera floor, and the promenades between districts are gardens on bridges. At dawn the lagoon is still enough to hold the whole city in its reflection.',
    facts: [['Depth', '8 – 20 m'], ['Reef species', '4,100'], ['Promenades', '8']],
  },
  {
    id: 'massif', name: 'Northern Massif', district: 'Cloud Forest',
    view: V(2400, 1650, -11200), target: V(0, 400, 0), time: 17.2,
    lore: 'The volcanic highlands north of the city have been left wild. Nothing has been built there for a thousand years. It is a cloud forest with orchids, tree ferns and birds that were brought back from extinction, and from the ridges you can watch the whole capital catch the evening light.',
    facts: [['Summit', '1,950 m'], ['Protected', 'since 3120 CE'], ['Species restored', '612']],
  },
  {
    id: 'highsky', name: 'The High Sky', district: 'Stratosphere · 30 km',
    view: V(9000, 30000, 26000), target: V(0, 0, 0), time: 18.15,
    lore: 'From thirty kilometres up you can see the whole design at once: the atoll, the islands, and the tether rising toward the rings. The Moon has seas now, and its night side shows city lights. The faint glints around the Sun are the Dyson swarm, which powers everything you see.',
    facts: [['Rings', '4'], ['Swarm', '2.1 × 10¹⁵ collectors'], ['Luna', 'terraformed 4630 CE']],
  },
];

// Guided tour order: one day in the capital. It starts at the Axis in the late afternoon (where the
// opening shot ends), follows dusk into night, cuts to the next dawn and runs through the day to a
// golden-hour arrival from the sea, ending in the high sky. Any POI id can be added; unknown ids are skipped.
export const TOUR = ['axis', 'crown', 'commons', 'halo', 'chorus', 'lagoon', 'halcyon', 'gardens', 'skyport', 'lumen', 'cantor', 'massif', 'approach', 'gate', 'highsky'];
