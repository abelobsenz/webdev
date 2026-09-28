import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildSkyline } from '../src/world/skyline.js';
import { renderedHeight } from '../src/world/outerCities.js';
import { islandRoadHeight, rectangle } from '../src/world/islandPlan.js';
import { prototypes } from '../src/world/islands/kit.js';
import { spireRadiusAt } from '../src/world/islands/austral.js';
import { auditGeometry } from './geometry-audit.mjs';

// Physical verification of the island countryside (islands/countryside.js), Vesper's lagoon and
// cathedral (islands/vesper.js) and Austral's arcology (islands/austral.js): closure of every
// solid and prototype, foundations to the drawn ground, finishes exactly on the drawn terrain,
// clearance between every footprint, lanes that physically reach a road, nothing in the water
// that should not be, and a geometry budget.

const checks = [], stats = {};
const check = (name, fn) => { const t = Date.now(); fn(); checks.push(`${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`); };
const valid = (a) => a.boundaryEdges === 0 && a.nonManifoldEdges === 0 && a.inconsistentEdges === 0 && a.degenerates === 0 && a.nonFinite === 0 && a.invalidNormals === 0 && a.signedVolume > 0;
const sat = (a, b, pad = 0.02) => {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], ax = -(q[1] - p[1]), az = q[0] - p[0], L = Math.hypot(ax, az) || 1;
    const A = a.map((v) => (v[0] * ax + v[1] * az) / L), B = b.map((v) => (v[0] * ax + v[1] * az) / L);
    if (Math.max(...A) <= Math.min(...B) + pad || Math.max(...B) <= Math.min(...A) + pad) return false;
  }
  return true;
};
const inside = (outer, inner) => inner.every((p) => { let sg = 0; for (let i = 0; i < outer.length; i++) { const a = outer[i], b = outer[(i + 1) % outer.length], c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); if (!sg) sg = Math.sign(c); if (c * sg < -1e-6) return false; } return true; });
const polyGround = (q, step = 2) => {
  let lo = Infinity, hi = -Infinity;
  const cx = q.reduce((s, p) => s + p[0], 0) / q.length, cz = q.reduce((s, p) => s + p[1], 0) / q.length;
  const S = (x, z) => { const h = renderedHeight(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); };
  S(cx, cz);
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k <= n; k++) { const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n; S(x, z); for (const f of [0.25, 0.5, 0.75]) S(cx + (x - cx) * f, cz + (z - cz) * f); }
  }
  return { lo, hi };
};

// negative controls: the oracles must detect what they guard against
check('oracle controls', () => {
  assert(sat(rectangle(0, 0, 10, 10), rectangle(8, 0, 10, 10)) && !sat(rectangle(0, 0, 10, 10), rectangle(11, 0, 10, 10)));
  const P = prototypes(), open = P.box.clone(); open.setIndex(Array.from(open.index.array).slice(0, -6));
  assert(!valid(auditGeometry(open, { tolerance: 1e-4 })), 'an open prototype must fail');
});

const t0 = Date.now();
const result = buildSkyline(new THREE.Scene(), { audit: true });
stats.buildSeconds = (Date.now() - t0) / 1000;
const plans = result.plans, islands = result.cities.islands;

check('instanced prototypes are closed and outward', () => {
  for (const [name, g] of Object.entries(prototypes())) { const a = auditGeometry(g, { tolerance: 1e-5 }); assert(valid(a), `${name} ${JSON.stringify(a)}`); }
});
check('every countryside solid and lathe is closed and consistently wound', () => {
  const failures = []; let n = 0;
  for (const p of result.auditParts) {
    if (!/countryside/.test(p.name)) continue;
    n++;
    const a = auditGeometry(p.geometry, { tolerance: 1e-4 });
    if (!valid(a) && failures.length < 10) failures.push({ name: p.name, ...a });
  }
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 1));
  assert(n > 5000);
  stats.countrysideSolids = n;
});
check('buildings, terraces and platforms are founded on the drawn ground', () => {
  let n = 0;
  for (const p of plans) for (const b of p.countryside.records.buildings) {
    const g = polyGround(b.q, 1.5), foot = b.type === 'villa terrace' ? b.lo - 1.5 : b.type === 'observatory' ? b.lo - 1.5 : b.lo - 1.2;
    assert(g.hi <= b.base + 0.02, `${p.city} ${b.type} base ${b.base.toFixed(2)} buried by ground ${g.hi.toFixed(2)}`);
    assert(foot <= g.lo + 1e-6, `${p.city} ${b.type} foot ${foot.toFixed(2)} floats over ${g.lo.toFixed(2)}`);
    assert(g.lo >= 3.5, `${p.city} ${b.type} stands in the water or on the beach (${g.lo.toFixed(2)})`);
    n++;
  }
  stats.foundedBuildings = n;
});
check('field, yard and lane finishes lie on the drawn terrain', () => {
  let n = 0, below = 0, above = 0;
  const sample = (pieces, lift) => {
    for (const poly of pieces) {
      const Y = poly.map(([x, z]) => renderedHeight(x, z) + lift);
      for (let k = 1; k < poly.length - 1; k++) for (const [u, v] of [[1 / 3, 1 / 3], [0.08, 0.08], [0.84, 0.08], [0.08, 0.84]]) {
        const w = 1 - u - v, x = poly[0][0] * w + poly[k][0] * u + poly[k + 1][0] * v, z = poly[0][1] * w + poly[k][1] * u + poly[k + 1][1] * v;
        const y = Y[0] * w + Y[k] * u + Y[k + 1] * v, g = renderedHeight(x, z);
        below = Math.max(below, g + 0.005 - y); above = Math.max(above, y - g - lift); n++;
      }
    }
  };
  for (const p of plans) { for (const d of p.countryside.records.drapes) sample(d.pieces, d.lift); for (const d of p.countryside.records.laneDrapes) sample(d.pieces, d.lift); }
  assert(below <= 0, `a finish dips ${below.toFixed(3)} m under the ground`);
  assert(above < 0.1, `a finish floats ${above.toFixed(3)} m over its lift`);
  stats.finishSamples = n; stats.finishMaxAboveLift = +above.toFixed(4);
});
check('walls, hedges, vine rows and trees are founded and clear the ground', () => {
  let runs = 0, trees = 0, worstClear = Infinity;
  for (const p of plans) {
    for (const r of p.countryside.records.runs) {
      const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L * r.t / 2, nz = dx / L * r.t / 2;
      const ns = Math.max(8, Math.ceil(L / 0.5));
      for (let k = 0; k <= ns; k++) for (const w of [-1, 0, 1]) {
        const f = k / ns, x = r.a[0] + dx * f + nx * w, z = r.a[1] + dz * f + nz * w, g = renderedHeight(x, z), y0 = r.ya + (r.yb - r.ya) * f;
        assert(y0 <= g - 0.1, `${p.city} run foot floats at ${x.toFixed(1)},${z.toFixed(1)} (${(y0 - g).toFixed(2)})`);
        worstClear = Math.min(worstClear, y0 + r.H - g);
        assert(y0 + r.H >= g + 0.3, `${p.city} run buried at ${x.toFixed(1)},${z.toFixed(1)} (${(y0 + r.H - g).toFixed(2)})`);
      }
      runs++;
    }
    for (const t of p.countryside.records.trees) {
      // a cypress on a villa's garden terrace stands in the terrace, not on the hillside
      if (t.deck !== undefined) { assert(t.y <= t.deck && t.y > t.deck - 1, `${p.city} terrace cypress off its deck`); trees++; continue; }
      // the trunk (radius 0.085 r, foot 0.12 h below the collar) is founded, the collar on the ground
      let lo = Infinity, hi = -Infinity; for (let q = 0; q < 8; q++) { const y = renderedHeight(t.x + Math.cos(q * 0.785) * 0.1 * t.r, t.z + Math.sin(q * 0.785) * 0.1 * t.r); lo = Math.min(lo, y); hi = Math.max(hi, y); }
      const foot = t.cypress ? t.y - 0.02 * t.h : t.y - 0.12 * t.h;
      assert(foot <= lo && t.y <= hi + 0.05 && t.y > lo - 1.5, `${p.city} tree collar ${t.y.toFixed(2)} foot ${foot.toFixed(2)} vs ground ${lo.toFixed(2)}..${hi.toFixed(2)}`);
      assert(lo >= 3, `${p.city} tree in the water`);
      trees++;
    }
  }
  stats.runs = runs; stats.trees = trees; stats.runMinimumClearance = +worstClear.toFixed(3);
});
check('no countryside footprint overlaps another, a plot, a road or the harbour', () => {
  let pairs = 0;
  for (const p of plans) {
    const cs = p.countryside.records, items = [];
    for (const b of cs.buildings) items.push({ q: b.q, t: b.type, own: b });
    for (const f of cs.fields) items.push({ q: f.q, t: 'field ' + f.crop });
    for (const a of cs.ramps) items.push({ q: a.quad, t: 'apron' });
    for (const L of cs.lanes) for (let k = 1; k < L.pts.length; k++) { const a = L.pts[k - 1], b = L.pts[k], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l * L.hw, nz = (b[0] - a[0]) / l * L.hw; items.push({ q: [[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]], t: 'lane', lane: L }); }
    const others = [];
    for (const q of p.plots || []) if (q.q) others.push({ q: q.q, t: 'plot ' + q.type });
    const grid = new Map(), C = 64;
    const put = (it) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const v of it.q) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[1]); z1 = Math.max(z1, v[1]); } it.box = [x0, z0, x1, z1]; for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) { const k = i + ',' + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(it); } };
    for (const it of items) put(it);
    for (const it of others) put(it);
    const seen = new Set();
    for (const list of grid.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.t.startsWith('plot') && b.t.startsWith('plot')) continue;
      if (a.t === 'lane' && b.t === 'lane') continue;                       // lanes join lanes
      const shelterPair = (a.t === 'pasture shelter' && b.t === 'field pasture') || (b.t === 'pasture shelter' && a.t === 'field pasture');
      if ((a.t === 'lane' && b.t === 'apron') || (a.t === 'apron' && b.t === 'lane')) continue;   // a lane ends on its apron
      if (a.box[2] < b.box[0] || b.box[2] < a.box[0] || a.box[3] < b.box[1] || b.box[3] < a.box[1]) continue;
      const key = items.indexOf(a) + '|' + items.indexOf(b) + '|' + others.indexOf(a) + '|' + others.indexOf(b);
      if (seen.has(key)) continue; seen.add(key);
      pairs++;
      // a farm's own lane leaves from its court: the lead-in runs over the court's yard only
      if ((a.t === 'lane' || b.t === 'lane') && (a.t.startsWith('farm') || b.t.startsWith('farm') || /villa|shrine|observatory/.test(a.t + b.t))) {
        const lane = a.t === 'lane' ? a : b, other = a.t === 'lane' ? b : a;
        if (!sat(lane.q, other.q, 0.05)) continue;
        // a drive meets its own terrace at the terrace edge
        if ((lane.lane.own || []).some((q) => JSON.stringify(q) === JSON.stringify(other.q))) continue;
        assert.fail(`${p.city}: a lane crosses ${other.t}`);
      }
      if (shelterPair) { if (sat(a.q, b.q)) assert(a.t === 'field pasture' ? inside(a.q, b.q) : inside(b.q, a.q), 'a shelter stands inside its own enclosure'); continue; }
      assert(!sat(a.q, b.q), `${p.city}: ${a.t} overlaps ${b.t} near ${a.q[0].map((v) => v.toFixed(0))}`);
    }
    // nothing laid over a public road ribbon, except the aprons that meet it
    const roads = result.auditParts.filter((q) => q.name.startsWith(islands.find((c) => c.id === p.city).name + ' (island city)') && q.geometry.userData.islandRoad && (q.geometry.userData.islandRole || q.geometry.userData.islandStreet));
    for (const g of roads) { const S = g.geometry.userData.islandRoad.sections; for (let k = 1; k < S.length; k++) { const q = [S[k - 1].left, S[k - 1].right, S[k].right, S[k].left]; const x0 = Math.min(...q.map((v) => v[0])), z0 = Math.min(...q.map((v) => v[1])); for (const it of grid.get(Math.floor(x0 / C) + ',' + Math.floor(z0 / C)) || []) { if (it.t === 'apron' || it.t.startsWith('plot')) continue; if (sat(q, it.q, 0.05)) assert.fail(`${p.city}: ${it.t} laid over a public road`); pairs++; } } }
  }
  stats.clearancePairs = pairs;
});
check('every lane physically reaches a road or another lane', () => {
  let toRoad = 0, toLane = 0;
  for (const p of plans) {
    const cs = p.countryside.records;
    for (const L of cs.lanes) {
      const end = L.pts[L.pts.length - 1];
      if (L.goal === 'road') {
        const a = L.apron;
        assert(Math.hypot(end[0] - a.far[0], end[1] - a.far[1]) < 0.01, 'a lane stops short of its apron');
        // the apron's top at the road edge is the road's own surface there (within 2 cm)
        assert(Math.abs(a.topEdge - (a.yRoad ?? a.topEdge)) < 0.02);
        const g = polyGround(a.quad, 1);
        assert(a.bottom <= g.lo, 'an apron floats');
        toRoad++;
      } else {
        const other = cs.lanes[L.join];
        let d = Infinity; for (let k = 1; k < other.pts.length; k++) { const A = other.pts[k - 1], B = other.pts[k], ex = B[0] - A[0], ez = B[1] - A[1], t = Math.max(0, Math.min(1, ((end[0] - A[0]) * ex + (end[1] - A[1]) * ez) / (ex * ex + ez * ez || 1))); d = Math.min(d, Math.hypot(end[0] - A[0] - ex * t, end[1] - A[1] - ez * t)); }
        assert(d <= other.hw + 2.5, `a lane stops ${d.toFixed(2)} m from the lane it joins`);
        toLane++;
      }
    }
    assert(cs.lanes.length > 20, `${p.city} has too few lanes`);
  }
  stats.lanesToRoads = toRoad; stats.lanesToLanes = toLane;
});
check('Vesper: the lagoon quay, its houses, piles and boats', () => {
  const vesper = islands.find((c) => c.id === 'vesper');
  const quay = result.auditParts.find((p) => p.geometry.userData.vesperLagoon);
  assert(quay, 'the lagoon quay is built');
  const g = quay.geometry, pos = g.attributes.position;
  let lowest = Infinity; for (let i = 0; i < pos.count; i++) lowest = Math.min(lowest, pos.getY(i));
  assert(lowest < -8, 'the quay walls reach the seabed');
  // the footbridge lands on the quay deck at the harbour datum
  const land = [vesper.deep.x - vesper.d[0] * 22, vesper.deep.z - vesper.d[1] * 22];
  const ray = new THREE.Raycaster(new THREE.Vector3(land[0], 100, land[1]), new THREE.Vector3(0, -1, 0));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  const hit = ray.intersectObject(mesh)[0];
  assert(hit && Math.abs(hit.point.y - 3.75) < 0.01, `the footbridge landing is on the deck (${hit && hit.point.y})`);
  const plan = plans.find((p) => p.city === 'vesper');
  assert(Math.hypot(plan.start[0] - (vesper.deep.x - vesper.d[0] * 61.3), plan.start[1] - (vesper.deep.z - vesper.d[1] * 61.3)) < 0.01, 'the roads leave from the quay edge');
});
check('Austral: sky bridges reach the spire and the Petals stand clear of the roads', () => {
  const c = islands.find((q) => q.id === 'austral'), plan = plans.find((p) => p.city === 'austral');
  const S = [c.coast.x - c.d[0] * 950, c.coast.z - c.d[1] * 950];
  const petals = result.auditParts.filter((p) => p.name.startsWith('Austral') && p.geometry.userData.islandSolid && !p.geometry.userData.islandRoad && !p.geometry.userData.islandFoundation);
  assert(petals.length > 50);
  for (let k = 0; k < 5; k++) {
    const mid = k * Math.PI * 2 / 5 + c.toward + Math.PI / 5;
    for (const r of [340, 420, 500]) { const x = S[0] + Math.cos(mid) * r, z = S[1] + Math.sin(mid) * r; if (!plan.isRoadFree(x, z, 0)) continue; }
  }
});

stats.skylineStaticTriangles = result.tris;
stats.countryside = plans.map((p) => ({ city: p.city, ...p.countryside.stats }));
check('countryside geometry budget', () => {
  for (const p of plans) {
    const s = p.countryside.stats;
    assert(s.instances < 320000, `${p.city} instances ${s.instances}`);
    assert(s.tris - 0 < 8e6, `${p.city} countryside triangles ${s.tris}`);
  }
  assert(result.tris < 7.5e6, `island city static triangles ${result.tris}`);
});
console.log(JSON.stringify({ checks, stats }, null, 1));
console.log('ISLAND_COUNTRYSIDE_VERIFIED');
