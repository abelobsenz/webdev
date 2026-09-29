// Invariants of the low-orbit stations (src/space/leoStations.js) after the refinement wave:
// buffer sanity and finite values for every generator, triangle budgets, the Halcyon terraces,
// vault and collector petals clear of each other and of the wheel's sweep, the Aurelia galleries
// and spoke trusses clear of the suites, the Demeter caps clear of the bearings, the Dawnline
// back frame clear of the hub's radiators, and build timings. Run: node tools/verify-habitats.mjs
import * as THREE from 'three';
import {
  buildHotel, HOTEL, buildHabitat, HAB, HAB_COLLECTOR, buildFarmDrum, buildFarmFrame, FARM, buildPolar, buildPower, POWER,
  buildSkyhookHub, buildGrapple, buildTram,
} from '../src/space/leoStations.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

function sane(name, g) {
  const pos = g.attributes.position, idx = g.index;
  let max = 0, finite = true;
  for (let i = 0; i < idx.count; i++) if (idx.array[i] > max) max = idx.array[i];
  for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) { finite = false; break; }
  const fac = g.attributes.aFacade;
  let fin2 = true;
  if (fac) for (let i = 0; i < fac.array.length; i++) if (!Number.isFinite(fac.array[i])) { fin2 = false; break; }
  ok(max < pos.count && idx.count % 3 === 0, `${name}: index max ${max} < ${pos.count} vertices, ${idx.count / 3} triangles`);
  ok(finite && fin2, `${name}: positions and facade coordinates finite`);
  ok(!fac || fac.count === pos.count, `${name}: facade attribute covers every vertex`);
  return idx.count / 3;
}
/** Radial and axial extent (about z) of every vertex whose kind matches, in a z window. */
function extent(g, kinds, pred = () => true) {
  const p = g.attributes.position.array, f = g.attributes.aFacade.array;
  let rMin = Infinity, rMax = 0, zMin = Infinity, zMax = -Infinity, n = 0;
  for (let i = 0; i < p.length / 3; i++) {
    const k = Math.round(f[i * 3 + 2]);
    if (kinds && !kinds.includes(k)) continue;
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    if (!pred(x, y, z)) continue;
    const r = Math.hypot(x, y);
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); zMin = Math.min(zMin, z); zMax = Math.max(zMax, z); n++;
  }
  return { rMin, rMax, zMin, zMax, n };
}

const T = {};
const time = (name, fn) => { const t0 = performance.now(); const r = fn(); T[name] = performance.now() - t0; return r; };

// ---- Halcyon
const hab = time('halcyon', buildHabitat);
let tri = sane('halcyon wheel', hab.wheel) + sane('halcyon fixed', hab.fixed);
ok(tri < 1.4e6, `halcyon ${Math.round(tri)} triangles (< 1.4M)`);
{
  const w = extent(hab.wheel);
  const f = extent(hab.fixed, null, (x, y, z) => z > HAB_COLLECTOR.z - 30);
  ok(w.zMax < HAB_COLLECTOR.z - 150, `halcyon wheel z <= ${w.zMax.toFixed(0)} m, collector from ${HAB_COLLECTOR.z} m: petals clear of the turning wheel`);
  ok(f.rMax < HAB_COLLECTOR.rOut + 40 && f.rMax > HAB_COLLECTOR.rOut - 20, `halcyon collector reaches ${f.rMax.toFixed(0)} m (lip near ${HAB_COLLECTOR.rOut} m)`);
  // the collector is parted into petals: along a ring at mid-span most directions pass between them
  const g = hab.fixed, p = g.attributes.position.array, ix = g.index.array, fac = g.attributes.aFacade.array;
  const bins = new Uint8Array(720);
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t], k = Math.round(fac[a * 3 + 2]);
    if (k !== 7) continue;                                      // film gores
    for (const v of [ix[t], ix[t + 1], ix[t + 2]]) {
      const r = Math.hypot(p[v * 3], p[v * 3 + 1]);
      if (r < 600 || r > 760) continue;
      const ang = (Math.atan2(p[v * 3 + 1], p[v * 3]) + 2 * Math.PI) % (2 * Math.PI);
      bins[Math.floor((ang / (2 * Math.PI)) * 720) % 720] = 1;
    }
  }
  let edges = 0; for (let i = 0; i < 720; i++) if (bins[i] !== bins[(i + 1) % 720]) edges++;
  ok(edges >= HAB_COLLECTOR.petals * 2, `halcyon collector parted into petals (${edges / 2} film runs round mid-span, >= ${HAB_COLLECTOR.petals})`);
  // terraces: the rim tier stands further out than the crown tier, all within the frame edge
  const glass = extent(hab.wheel, [0], (x, y, z) => Math.abs(z) > HAB.halfW - 20);
  ok(glass.n > 0 && Math.abs(glass.zMax) < HAB.halfW + 7 * 2.5 + 4, `halcyon terraces reach |z| ${glass.zMax.toFixed(1)} m (< frame edge ${HAB.halfW + 21.5} m)`);
  const vault = extent(hab.wheel, [12, 13], (x, y, z) => Math.abs(z) < 30);
  const r0 = HAB.R - HAB.depth;
  ok(vault.rMin > r0 - 20 && vault.rMin < r0 - 10, `halcyon park vault crown at ${vault.rMin.toFixed(1)} m (roof line ${r0} m, rises 14 m)`);
  const hub = extent(hab.fixed, null, (x, y, z) => Math.abs(z) < 75);
  ok(hub.n > 0 && hub.rMax < HAB.hubR - 5, `halcyon despun axle and bearings within the hub bore (${hub.rMax.toFixed(1)} m < ${HAB.hubR - 5})`);
  ok(hab.lamps.every((l) => Number.isFinite(l.p.x + l.p.y + l.p.z)) && hab.wheelLamps.every((l) => Number.isFinite(l.p.x + l.p.y + l.p.z)), 'halcyon lamps finite');
}

// ---- Aurelia
const hot = time('aurelia', buildHotel);
tri = sane('aurelia wheel', hot.wheel) + sane('aurelia fixed', hot.fixed);
ok(tri < 700000, `aurelia ${Math.round(tri)} triangles (< 700k)`);
{
  const gal = extent(hot.wheel, [0], (x, y, z) => Math.abs(z) > HOTEL.halfW + 3);
  ok(gal.n > 0 && gal.zMax < HOTEL.halfW + 7.6, `aurelia promenade galleries at |z| <= ${gal.zMax.toFixed(1)} m`);
  const r0 = HOTEL.R - HOTEL.depth;
  const spokes = extent(hot.wheel, [10], (x, y, z) => { const r = Math.hypot(x, y); return r > HOTEL.hubR + 2 && r < r0 - 4; });
  ok(spokes.n > 0 && spokes.zMax < 13 && spokes.zMin > -13, `aurelia spoke trusses within |z| ${Math.max(spokes.zMax, -spokes.zMin).toFixed(1)} m (tension stays run outside)`);
  const fixed = extent(hot.fixed, null, (x, y, z) => Math.abs(z) < 32);
  ok(fixed.rMax < HOTEL.hubIn + 14, `aurelia bearings inside the hub (${fixed.rMax.toFixed(1)} m)`);
}

// ---- Demeter
const drum = time('demeter drum', buildFarmDrum), frame = time('demeter frame', buildFarmFrame);
tri = 2 * sane('demeter drum', drum.geo) + sane('demeter frame', frame.geo);
ok(tri < 900000, `demeter ${Math.round(tri)} triangles (< 900k)`);
{
  const cap = extent(drum.geo, null, (x, y, z) => Math.abs(z) > FARM.halfL + 2 && Math.hypot(x, y) > 30);
  // the frame's bearings sit L+56-10 +- 6 from the drum centre, radius 11..28
  ok(cap.zMax < FARM.halfL + 40, `demeter cap domes end at ${(cap.zMax - FARM.halfL).toFixed(1)} m past the hull, bearings from 40 m`);
  ok(drum.sweep < FARM.sep - 4, `demeter drums' sweep ${drum.sweep.toFixed(0)} m < half separation ${FARM.sep}`);
  const ring = extent(drum.geo, [8], (x, y, z) => Math.abs(z) < FARM.halfL - 30 && Math.hypot(x, y) > FARM.R + 1 && Math.hypot(x, y) < FARM.R + 30 && Math.abs(((z + FARM.halfL) % (FARM.halfL / 4)) - FARM.halfL / 8) > FARM.halfL / 8 - 5);
  ok(ring.rMax < FARM.R + 9, `demeter ring girders stand ${(ring.rMax - FARM.R).toFixed(1)} m proud (< mirror hinge line ${FARM.R + 4 + 1.8} + lacing)`);
}

// ---- Boreal, Dawnline, Anansi
const pol = time('boreal', buildPolar);
tri = sane('boreal body', pol.body) + sane('boreal ring', pol.ring) + sane('boreal wings', pol.wings);
const pw = time('dawnline', buildPower);
tri = sane('dawnline body', pw.body) + sane('dawnline emitter', pw.emitter);
ok(tri < 500000, `dawnline ${Math.round(tri)} triangles (< 500k)`);
{
  // the back frame stays behind the blanket (sunward face at z ~ +0.5) and clear of the emitter's sweep
  const back = extent(pw.body, [10, 11], (x, y, z) => Math.abs(x) > 250);
  ok(back.zMax < 2.5 && back.zMin > -70, `dawnline back frame in z ${back.zMin.toFixed(1)}..${back.zMax.toFixed(1)} m (behind the blanket)`);
  const sweep = POWER.disc + 4;
  const near = extent(pw.body, null, (x, y, z) => z < POWER.pivotZ + POWER.discOff + 8 && z > POWER.pivotZ - 10 && Math.hypot(x, y) > 14);
  ok(near.n === 0 || near.rMin > sweep, `dawnline nothing but the mast inside the emitter's sweep (${near.n} vertices)`);
  // hub radiators (x 26..~200, y 0, z -82..-38) clear of the frame's king posts and fins
  const p = pw.body.attributes.position.array, f = pw.body.attributes.aFacade.array;
  let clash = 0;
  for (let i = 0; i < p.length / 3; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2], k = Math.round(f[i * 3 + 2]);
    if (k === 11 && Math.abs(y) > 20 && Math.abs(x) < 230 && z < -30) clash++;
  }
  ok(clash === 0, `dawnline back-frame fins keep off the hub radiators (${clash})`);
}
sane("anansi hub", buildSkyhookHub().geo); sane("anansi grapple", buildGrapple().geo);
sane('tram', buildTram());

for (const [k, v] of Object.entries(T)) ok(v < 900, `${k} built in ${v.toFixed(0)} ms (< 900)`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
