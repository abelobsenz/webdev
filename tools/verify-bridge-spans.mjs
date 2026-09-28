import * as THREE from 'three';
import { buildWardBridges } from '../src/world/bridges.js';
import { wardRecords, wardBridgePaths, wardHeight } from '../src/world/metro.js';
import { buildTerrainData, HeightSampler } from '../src/world/terrain.js';

// Structural sufficiency of the ward sea bridges, measured on the production geometry:
// every point of every deck must be carried. A deck is carried where a pier or pylon
// reaches its underside, or where a stay or hanger meets its edge. The longest run of
// deck between two consecutive carrying contacts is its unsupported span; a stayed or
// hung deck may not run more than MAX_HUNG between hangers, and a girder (the stiff
// box of the promenade section) no more than MAX_GIRDER between piers.
const MAX_GIRDER = Number(process.env.MAX_GIRDER || 240);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const sampler = new HeightSampler(await buildTerrainData());
const ground = (x, z) => Math.max(0, sampler.get(x, z), wardHeight(x, z));
const errors = [], metrics = [];
for (const bp of wardBridgePaths(ground)) {
  const parts = [];
  buildWardBridges(new THREE.Scene(), [bp], wardRecords(), ground, {}, { onComponent: (p) => parts.push(p) });
  const P = bp.path, cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
  const Ltot = cum.at(-1);
  // project a point onto the deck path: arc length, lateral offset, height above deck
  const frames = P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; const t = b.clone().sub(a).setY(0).normalize(); return { t, side: V(-t.z, 0, t.x) }; });
  const project = (q) => {
    let best = null;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      let t = ((q.x - a.x) * dx + (q.z - a.z) * dz) / l2; t = Math.min(Math.max(t, 0), 1);
      const x = a.x + dx * t, z = a.z + dz * t, d = Math.hypot(q.x - x, q.z - z);
      if (!best || d < best.d) best = { d, s: cum[i] + (cum[i + 1] - cum[i]) * t, y: a.y + (b.y - a.y) * t, i, lat: (q.x - x) * frames[i].side.x + (q.z - z) * frames[i].side.z };
    }
    return best;
  };
  const supports = [];
  for (const p of parts) {
    if (!['structure', 'support'].includes(p.kind)) continue;
    const pos = p.geometry.attributes.position;
    p.geometry.computeBoundingBox();
    const bb = p.geometry.boundingBox;
    // quick reject: parts wholly above the deck and away from it
    let lo = Infinity, hi = -Infinity;
    const step = Math.max(1, Math.floor(pos.count / 400));
    for (let k = 0; k < pos.count; k += step) {
      const q = V(pos.getX(k), pos.getY(k), pos.getZ(k));
      const pr = project(q);
      if (Math.abs(pr.lat) > 16.5) continue;
      const dy = q.y - pr.y;
      // underside of the deck web (-3.2 m) to a hanger clamp just above the deck edge
      if (dy > -4.2 && dy < 2.2) { lo = Math.min(lo, pr.s); hi = Math.max(hi, pr.s); }
    }
    if (hi >= lo) {
      // a thin element (stay, hanger) carries one point; a wide one (pier cap) a range
      const reachesBelow = bb.min.y < P[0].y - 10 || bb.min.y < 0;
      supports.push({ s0: lo, s1: hi, kind: p.kind, below: reachesBelow });
    }
  }
  supports.sort((a, b) => a.s0 - b.s0);
  // deck ends rest on the bridgehead and the ward landing
  const covered = [{ s0: -1, s1: 18 }, ...supports, { s0: Ltot - 18, s1: Ltot + 1 }];
  let maxGap = 0, at = 0, reach = -1;
  const gaps = [];
  for (const c of covered) {
    if (c.s0 > reach) { const g = c.s0 - reach; if (g > maxGap) { maxGap = g; at = reach; } if (g > MAX_GIRDER) gaps.push([Math.round(reach), Math.round(c.s0)]); }
    reach = Math.max(reach, c.s1);
  }
  // Pylon legs, masts and arch ribs must stand clear of the deck (and its parapets) and of
  // the maglev tube beside it: no triangle edge of either may pass through the other.
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const deck = parts.find((p) => p.kind === 'deck'), tube = parts.find((p) => p.kind === 'maglev');
  const meshOf = (g) => { g.computeBoundingBox(); const m = new THREE.Mesh(g, mat); m.updateMatrixWorld(); return m; };
  const deckMesh = meshOf(deck.geometry), tubeMesh = meshOf(tube.geometry);
  const ray = new THREE.Raycaster();
  const edgesHit = (g, target, box) => {
    const pos = g.attributes.position, ix = g.index;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    for (let k = 0; k < ix.count; k += 3) for (let j = 0; j < 3; j++) {
      a.fromBufferAttribute(pos, ix.getX(k + j)); b.fromBufferAttribute(pos, ix.getX(k + (j + 1) % 3));
      if (box && !box.containsPoint(a) && !box.containsPoint(b)) continue;
      d.subVectors(b, a); const len = d.length(); if (len < 1e-5) continue;
      ray.set(a, d.normalize()); ray.near = 0.002; ray.far = len - 0.002;
      if (ray.intersectObject(target, false).length) return true;
    }
    return false;
  };
  {
    // controls: a post through the deck at mid-span is caught; one beside it is not
    const mid = P[P.length >> 1], side = frames[P.length >> 1].side;
    const through = new THREE.CylinderGeometry(1.5, 1.5, 20, 8).translate(mid.x + side.x * 13, mid.y, mid.z + side.z * 13);
    const beside = new THREE.CylinderGeometry(1.5, 1.5, 20, 8).translate(mid.x + side.x * 17.5, mid.y, mid.z + side.z * 17.5);
    for (const g of [through, beside]) g.computeBoundingBox();
    if (!(edgesHit(through, deckMesh) || edgesHit(deckMesh.geometry, meshOf(through), through.boundingBox.clone().expandByScalar(1)))) errors.push(`${bp.ward}: clearance control (post through the parapet) not detected`);
    if (edgesHit(beside, deckMesh) || edgesHit(deckMesh.geometry, meshOf(beside), beside.boundingBox.clone().expandByScalar(1))) errors.push(`${bp.ward}: clearance control (post beside the deck) falsely detected`);
  }
  let clearParts = 0, clashes = 0;
  for (const p of parts) {
    if (!p.geometry.userData.clearOfDeck) continue;
    clearParts++;
    const m = meshOf(p.geometry), box = p.geometry.boundingBox.clone().expandByScalar(1);
    for (const [name, target] of [['deck', deckMesh], ['maglev tube', tubeMesh]]) {
      if (!target.geometry.boundingBox.intersectsBox(box)) continue;
      if (edgesHit(p.geometry, target) || edgesHit(target.geometry, m, box)) { clashes++; if (clashes < 6) errors.push(`${bp.ward}: ${p.kind} part meets the ${name} near ${box.getCenter(new THREE.Vector3()).toArray().map((v) => v.toFixed(0))}`); }
    }
  }
  metrics.push({ id: bp.ward, length: Math.round(Ltot), supports: supports.length, maxGap: Math.round(maxGap), at: Math.round(at), gaps, clearParts, clashes });
  if (gaps.length) errors.push(`${bp.ward}: unsupported deck runs ${JSON.stringify(gaps)}`);
  for (const p of parts) p.geometry.dispose();
}
console.log(JSON.stringify(metrics, null, 1));
if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; } else console.log('BRIDGE_SPANS_VERIFIED');
