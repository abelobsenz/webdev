import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CB, CK } from '../craft/craftGeometry.js';
import { buildLinerSkin, linerProf } from './linerSkin.js';
import { hullPoint, hullNormal, clearOfGangways, KEEL_CLEAR, EVA_PARTIES } from './linerDetail.js';
import { DK } from './craftMesh.js';
import { slab } from './shipKit.js';

// THE CONCORD-CLASS LINER, REBUILT FOR HER FRAMING. The builder's liner (src/craft/craftGeometry.js
// buildLiner) is kept as the reference every fitting, gangway and clamp is surveyed against; this
// draws the same ship with the same envelope (the 2.4 km spindle, 170 x 118 m, belly 0.8, the
// keel collars where the shuttles and tenders dock) but as a built ship rather than a kitbash:
//
//   skin        the smooth 192 x 241 skin (src/space/linerSkin.js) with its girth coordinate
//               normalised to the full section, so plate strakes taper toward the prow the way
//               real strakes do and the livery band keeps one line from stern to bow; painted in
//               the Concord livery: a 48 m oxide band with cream pinstripes and block
//               registration down both lower flanks, working plate on the keel and the drive
//               section, the cabin glazing above
//   frames      raised structural hoops every 120 m (dark, broken where the keel collars, the
//               pier's gangways, the garden, the galleries, the radiators and the EVA parties
//               are), the rhythm a 2.4 km hull needs at the Liner view's 2.6 km
//   garden      the atrium's canopy as a structure: main arches every 52 m, light arches
//               between, five purlins along its length (the builder's 51 identical thin hoops
//               read as a comb)
//   drive       thrust frame, gimballed bells (48 segments, heat-tinted), two insulated
//               propellant tanks on saddles astern of the crown bridge
//   radiators   four finned radiator wings: ten 40 m panels on each, spars between them,
//               stiffeners, a coolant manifold fed from the hull and a tip rail; the panels
//               glow orange at the manifold and cool toward the tip (DK.HOTRAD)
//   scoop       the magnetic scoop ring at 256 segments with 24 coil housings and faired struts
//
// Returns { geo, glows, lamps, length, parts } (liner metres; the berth and voyager scale it).

const TAU = Math.PI * 2;
const A = 170, BH = 118, NEXP = 2.3;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const linerF = (z) => Math.max(linerProf((z + 1150) / 2400), 0.02);

/** The liner's frame hoop stations (m): every 120 m, clear of the gangways and the EVA parties. */
export const HOOP_Z = (() => {
  const out = [];
  for (let z = -1030; z <= 1130; z += 120) {
    if ([-850, -50, 750, ...EVA_PARTIES].some((g) => Math.abs(z - g) < 45)) continue;
    out.push(z);
  }
  return out;
})();
/** Radiator wing angles about the liner's axis. */
export const RAD_ANGLES = [0, 1, 2, 3].map((k) => (k / 4) * TAU + Math.PI / 4);
export const RAD_Z = [-1052, -628];
/** The dorsal propellant tanks: section angle, stations, radius (m). */
export const TANKS = { t: [Math.PI / 2 - 0.3, Math.PI / 2 + 0.3], z0: -1125, z1: -945, r: 17 };

// girth of the full section (f = 1) from t = 0, tabulated
const NG = 2048;
const GIRTH = (() => {
  const g = new Float64Array(NG + 1);
  const p = V(), q = V();
  const sect = (t, out) => {
    const c = Math.cos(t), s = Math.sin(t);
    let y = Math.sign(s) * Math.pow(Math.abs(s), 2 / NEXP) * BH;
    if (y < 0) y *= 0.8;
    return out.set(Math.sign(c) * Math.pow(Math.abs(c), 2 / NEXP) * A, y, 0);
  };
  sect(0, q);
  for (let i = 1; i <= NG; i++) { sect((i / NG) * TAU, p); g[i] = g[i - 1] + p.distanceTo(q); q.copy(p); }
  return g;
})();
const P1 = GIRTH[NG];
function girthAt(t) {
  const u = (((t % TAU) + TAU) % TAU) / TAU * NG, i = Math.min(Math.floor(u), NG - 1);
  return GIRTH[i] + (GIRTH[i + 1] - GIRTH[i]) * (u - i);
}
// the livery band: g metres of girth below the waterline on both flanks, with a girth offset so
// both band centres fall at 45 m of the shader's 90 m period (DK.MARK)
export const BAND = (() => {
  let best = null;
  for (let m = 0; m < 12; m++) {
    const g = (P1 / 2 - 90 * m) / 2;
    if (g > 30 && g < 130 && (!best || Math.abs(g - 70) < Math.abs(best.g - 70))) best = { g };
  }
  const g = best.g;
  const cS = P1 - g, cP = P1 / 2 + g;                         // starboard and port band centres
  const off = ((45 - cS) % 90 + 90) % 90;
  return { g, cS, cP, off, half: 24 };
})();

const SK_NR = 192, SK_NJ = 240;          // src/space/linerSkin.js's refined skin (grid first, then two caps)

/** The painted skin: normalised girth, the livery and working plate, girdles returned to plate. */
export function paintedSkin(s = 1) {
  const g = buildLinerSkin(s);
  const P = g.attributes.position, F = g.attributes.aFacade;
  const fac = F.array;
  const cols = SK_NR + 1, gridN = (SK_NJ + 1) * cols;
  if (P.count !== gridN + 2 * cols) return g;                  // (a different skin layout: left as it is)
  let band = 0;
  for (let i = 0; i < gridN; i++) {
    const k = fac[i * 3 + 2];
    const y = P.getY(i) / s, z = P.getZ(i) / s;
    const col = i % cols, t = (col / SK_NR) * TAU;
    const gn = col === SK_NR ? P1 : girthAt(t);                // normalised girth (full-section metres)
    fac[i * 3] = gn + BAND.off;
    const below = y < 0, side = Math.abs(Math.cos(t)), sn = Math.sin(t);
    let nk = k;
    if (Math.abs(k - CK.BRONZE) < 0.01) nk = CK.HULL;           // the builder's girdles: hoops now
    if (Math.abs(nk - CK.HULL) < 0.01) {
      if (z < -930) nk = DK.GRIME;
      else if (below && sn < -0.62) nk = DK.GRIME;
      else if (below && z < 1080 && (Math.abs(gn - BAND.cS) < BAND.half || Math.abs(gn - BAND.cP) < BAND.half)) nk = DK.MARK;
    }
    if (Math.abs(nk - CK.GLASS) < 0.01 && below && (Math.abs(gn - BAND.cS) < BAND.half || Math.abs(gn - BAND.cP) < BAND.half)) nk = DK.MARK;
    if (Math.abs(nk - DK.MARK) < 0.01) band++;
    fac[i * 3 + 2] = nk;
  }
  F.needsUpdate = true;
  g.userData.bandVertices = band;
  return g;
}

/** Hoop, arch and strut helper: a tube along points, skipping runs where keep(p) is false. */
function runs(B, pts, keep, r, seg, k) {
  let run = [];
  const flush = () => { if (run.length > 1) B.tube(run, r, seg, k); run = []; };
  for (const p of pts) { if (keep(p)) run.push(p); else flush(); }
  flush();
}

/** Lathe along an arbitrary axis from a to b (profile z measured from a). */
function latheAlong(B, a, b, prof, seg, phase = 0) {
  const d = b.clone().sub(a), L = d.length();
  d.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d);
  B.push(new THREE.Matrix4().compose(a, q, V(1, 1, 1)));
  B.lathe(prof.map(([r, z, k]) => [r, z === 'L' ? L : z, k]), seg, phase);
  B.pop();
  return L;
}

/** Re-sign the along coordinate of the vertices emitted since `from` (engine bells: y from the mount). */
function flipY(B, from, k0 = 0) {
  for (let i = from; i < B.fac.length / 3; i++) B.fac[i * 3 + 1] = -B.fac[i * 3 + 1] + k0;
}

export function buildConcordLiner(len = 2400) {
  const s = len / 2400;
  const B = new CB();
  B.push(new THREE.Matrix4().makeScale(s, s, s));
  const lamps = [], glows = [], parts = {};
  const mark = (name) => { parts[name] = B.idx.length / 3; };
  const P = V(), N = V();

  // ---- frame hoops: raised dark frames every 120 m round the hull
  mark('hoops');
  for (const z of HOOP_Z) {
    const f = linerF(z), pts = [];
    for (let i = 0; i <= 180; i++) {
      const t = (i / 180) * TAU;
      hullPoint(z, t, P); hullNormal(z, t, N);
      const p = P.clone().addScaledVector(N, 1.3);
      p.t = t;
      pts.push(p);
    }
    const keep = (p) => {
      const t = p.t;
      if (p.y < 0 && Math.abs(p.x) < KEEL_CLEAR) return false;                              // keel collars
      if (!clearOfGangways(p, 45)) return false;                                            // the pier's gangways
      if (z > -620 && z < 720 && p.y > 0 && Math.abs(p.x) < A * f * 0.47) return false;      // the garden
      if (z > -540 && z < 780 && (Math.abs(t - 0.32) < 0.07 || Math.abs(t - (Math.PI - 0.32)) < 0.07)) return false;   // galleries
      if (z < -600) for (const a of RAD_ANGLES) if (Math.abs(Math.atan2(Math.sin(t - a), Math.cos(t - a))) < 0.12) return false;
      if (z < -930 && Math.abs(t - Math.PI / 2) < 0.62) return false;                        // tanks
      return true;
    };
    runs(B, pts, keep, 2.1 * Math.min(1, f + 0.25), 8, CK.DARK);
    // a thin bronze capping strip on each frame, the bright line in the rhythm
    runs(B, pts.map((p) => { const q = p.clone().multiplyScalar(1); q.t = p.t; hullNormal(z, p.t, N); q.addScaledVector(N, 1.6).setZ(z + 3.2); return q; }), keep, 0.7, 5, CK.BRONZE);
  }

  // ---- the garden atrium: deck (as the builder's), then the canopy structure over it
  mark('garden');
  const zA0 = -600, zA1 = 700;
  {
    const deck = [];
    for (let j = 0; j <= 52; j++) {
      const z = zA0 + (zA1 - zA0) * (j / 52);
      const f = linerF(z);
      const w = A * f * 0.4, top = BH * f - 5;
      deck.push({ z, pts: [[-w, top], [w, top], [w, top - 8], [-w, top - 8]] });
    }
    B.loft(deck, (i) => (i === 0 ? CK.GARDEN : CK.HULL));
  }
  const arch = (z, n = 20) => {
    const f = linerF(z), top = BH * f, w = A * f * 0.42, out = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI;
      out.push(V(Math.cos(a) * w, top - 6 + Math.sin(a) * w * 0.62, z));
    }
    return out;
  };
  for (let z = zA0, j = 0; z <= zA1; z += 26, j++) {
    const main = j % 2 === 0;
    B.tube(arch(z), main ? 3.2 : 1.5, main ? 10 : 6, main ? CK.HULL : CK.DARK);
    if (main) {
      // the main arches' feet: bronze shoes on the deck edges
      for (const sx of [-1, 1]) {
        const f = linerF(z), w = A * f * 0.42, top = BH * f;
        B.box(sx * w, top - 5.5, z, 8, 3, 8, CK.BRONZE);
      }
    }
  }
  for (const a of [0.52, 1.05, Math.PI / 2, Math.PI - 1.05, Math.PI - 0.52]) {
    const pts = [];
    for (let z = zA0; z <= zA1; z += 13) {
      const f = linerF(z), top = BH * f, w = A * f * 0.42;
      pts.push(V(Math.cos(a) * w, top - 6 + Math.sin(a) * w * 0.62, z));
    }
    B.tube(pts, a === Math.PI / 2 ? 2.2 : 1.3, 6, a === Math.PI / 2 ? CK.BRONZE : CK.HULL);
  }

  // ---- crown bridge astern of the garden (the builder's profile, smooth, a lit gallery ring)
  mark('bridge');
  {
    const top = BH * linerF(-760);
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    B.at(0, 760, top - 10);
    B.lathe([[46, 0, CK.HULL], [44, 12, DK.GRIME], [40, 30, CK.GLASS], [36, 80, CK.GLASS], [44, 86, CK.DARK], [52, 96, CK.BRONZE], [48, 110, CK.LANTERN], [40, 116, CK.HULL], [30, 126, CK.HULL], [12, 150, CK.DARK], [4, 170, CK.HULL], [1, 230, CK.LANTERN]], 64);
    B.pop(); B.pop();
  }
  // comms masts where the builder has them
  for (const [x, z] of [[-60, 200], [60, 200], [-50, -300], [50, -300]]) {
    const f = linerF(z);
    const top = BH * f * Math.sqrt(Math.max(0, 1 - Math.pow(x / (A * f), 2)));
    B.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    B.at(x, -z, top - 4);
    B.lathe([[6, 0, CK.DARK], [5, 4, CK.BRONZE], [1.6, 60, CK.DARK], [3, 62, CK.LANTERN], [0.3, 66, CK.LANTERN]], 12);
    B.pop(); B.pop();
  }

  // ---- the magnetic scoop ring ahead of the prow
  mark('scoop');
  B.at(0, 0, 1420);
  B.torus(150, 9, 256, 16, CK.HULL);
  B.torus(138, 3.5, 256, 8, CK.CONDUIT);
  B.torus(161, 2.2, 256, 6, CK.DARK);
  B.pop();
  for (let k = 0; k < 24; k++) {
    // coil housings round the ring (bronze sleeves along its tangent)
    const a = (k / 24) * TAU + TAU / 48;
    const c = V(Math.cos(a) * 150, Math.sin(a) * 150, 1420), tg = V(-Math.sin(a), Math.cos(a), 0);
    latheAlong(B, c.clone().addScaledVector(tg, -12), c.clone().addScaledVector(tg, 12), [[10.5, 0, CK.BRONZE], [13.5, 3, CK.BRONZE], [13.5, 21, CK.DARK], [10.5, 'L', CK.BRONZE]], 20);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2;
    const p0 = V(Math.cos(a) * 30, Math.sin(a) * 22, 1080), p1 = V(Math.cos(a) * 90, Math.sin(a) * 90, 1300), p2 = V(Math.cos(a) * 150, Math.sin(a) * 150, 1420);
    const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
    B.tube(curve.getPoints(24), (t) => 7.5 - 3.5 * t, 16, CK.HULL);
    // strut root fairing on the prow and a lamp-lit collar where it meets the ring
    B.tube([p0.clone().multiplyScalar(0.8).setZ(1060), p0.clone().setZ(1100)], (t) => 11 - 3 * t, 16, DK.GRIME);
  }

  // ---- the drive: thrust frame, gimballed heat-tinted bells
  mark('drive');
  B.at(0, 0, -1150);
  B.torus(112, 5, 128, 10, CK.DARK);
  B.torus(62, 4, 96, 8, CK.DARK);
  B.pop();
  const bell = (x, y, r, glowR) => {
    B.at(x, y, -1150);
    const from = B.fac.length / 3;
    B.lathe([[r * 0.82, -r * 1.6, DK.NOZZLE], [r, -r * 1.55, DK.NOZZLE], [r * 0.86, -r * 1.2, DK.NOZZLE], [r * 0.7, -r * 0.9, DK.NOZZLE], [r * 0.52, -r * 0.5, DK.NOZZLE], [r * 0.45, -r * 0.2, DK.NOZZLE], [r * 0.6, 0, CK.BRONZE],
      [r * 0.5, 0, CK.DARK], [r * 0.35, -r * 0.2, CK.DARK], [r * 0.44, -r * 0.5, CK.DARK], [r * 0.59, -r * 0.9, CK.DARK], [r * 0.75, -r * 1.2, CK.DARK], [r * 0.77, -r * 1.55, CK.DARK]], 48, 0, { closedProfile: true });
    flipY(B, from);
    // gimbal ring and actuator collar at the throat
    B.torus(r * 0.62, Math.max(1.2, r * 0.07), 48, 8, CK.BRONZE);
    B.pop();
    glows.push({ p: V(x, y, -1150 - r * 1.6).multiplyScalar(s), r: glowR * s, dir: V(0, 0, -1) });
  };
  for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + Math.PI / 2; bell(Math.cos(a) * 58, Math.sin(a) * 44, 42, 70); }
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + Math.PI / 6; bell(Math.cos(a) * 88, Math.sin(a) * 58, 16, 28); }
  // thrust struts from the frame into the stern bulkhead
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + TAU / 16;
    B.tube([V(Math.cos(a) * 112, Math.sin(a) * 78, -1150), V(Math.cos(a) * 70, Math.sin(a) * 50, -1120)], 3, 6, CK.DARK);
  }

  // ---- the dorsal propellant tanks on their saddles
  mark('tanks');
  for (const t of TANKS.t) {
    const R = TANKS.r;
    const a = hullPoint(TANKS.z0, t, V()).addScaledVector(hullNormal(TANKS.z0, t, V()), R + 3);
    const b = hullPoint(TANKS.z1, t, V()).addScaledVector(hullNormal(TANKS.z1, t, V()), R + 3);
    const L = a.distanceTo(b), h = L / 2;
    // capsule: hemispherical ends, facade y signed from the girth line
    const prof = [];
    for (let i = 0; i <= 8; i++) { const q = (i / 8) * (Math.PI / 2); prof.push([R * Math.sin(q), -h + R - R * Math.cos(q), DK.TANK]); }
    for (let i = 0; i <= 8; i++) { const q = (i / 8) * (Math.PI / 2); prof.push([R * Math.cos(q), h - R + R * Math.sin(q), DK.TANK]); }
    const mid = a.clone().add(b).multiplyScalar(0.5), d = b.clone().sub(a).normalize();
    B.push(new THREE.Matrix4().compose(mid, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d), V(1, 1, 1)));
    B.lathe(prof, 48);
    B.pop();
    // three saddles: struts from the tank's underside into the hull
    for (const u of [0.18, 0.5, 0.82]) {
      const z = TANKS.z0 + (TANKS.z1 - TANKS.z0) * u;
      hullPoint(z, t, P); hullNormal(z, t, N);
      const c = a.clone().lerp(b, u);
      for (const sd of [-1, 1]) {
        const side = V(0, 0, 1).cross(N).normalize().multiplyScalar(sd * R * 0.6);
        B.tube([P.clone().add(side).addScaledVector(N, -0.5), c.clone().add(side).addScaledVector(N, -R * 0.75)], 2.2, 6, CK.DARK);
      }
      B.push(new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d), V(1, 1, 1)));
      B.torus(R + 0.9, 1.1, 48, 6, CK.DARK);
      B.pop();
    }
  }

  // ---- radiator wings: finned panels, spars, manifold, tip rail
  mark('radiators');
  {
    const f0 = linerF(-1060);
    for (const a of RAD_ANGLES) {
      const c = Math.cos(a), sn = Math.sin(a);
      const r0 = Math.hypot(A * f0 * c, BH * f0 * sn) * 0.92;
      B.push(new THREE.Matrix4().makeRotationZ(a));
      const xr = r0 + 22, xt = r0 + 322;
      // manifold along the root, fed from the hull by four pipes
      B.tube([V(r0 + 14, 0, RAD_Z[0] - 10), V(r0 + 14, 0, RAD_Z[1] + 10)], 7, 12, CK.BRONZE);
      for (const z of [-1040, -900, -760, -640]) B.tube([V(r0 - 20, 0, z), V(r0 + 14, 0, z)], 5, 10, CK.DARK);
      // ten 40 m panels
      for (let i = 0; i < 10; i++) {
        const z0 = RAD_Z[0] + 1 + i * 42.4, z1 = z0 + 40;
        slab(B, xr, xt, z0, z1, 0, 2.2, DK.HOTRAD, (x, z) => [z - RAD_Z[0], x - xr]);
      }
      // spars between the panels (fins standing proud of both faces) and the end frames
      for (let i = 0; i <= 10; i++) {
        const z = RAD_Z[0] + i * 42.4;
        B.box((r0 + 14 + xt) / 2, 0, z, xt - r0 - 14, 7, 1.8, CK.DARK);
      }
      // span-wise stiffeners on both faces
      for (const x of [xr + 100, xr + 200]) for (const y of [-1.9, 1.9]) B.tube([V(x, y, RAD_Z[0]), V(x, y, RAD_Z[1])], 1.1, 6, CK.BRONZE);
      // tip rail
      B.tube([V(xt + 2, 0, RAD_Z[0] - 2), V(xt + 2, 0, RAD_Z[1] + 2)], 3.2, 10, CK.BRONZE);
      B.pop();
      lamps.push({ p: V(c * (r0 + 326), sn * (r0 + 326), -840).multiplyScalar(s), r: 3.2 * s, color: c > 0 ? [1.0, 0.16, 0.08] : [0.16, 1.0, 0.42], i: 3.4, dir: V(c, sn, 0) });
      lamps.push({ p: V(c * (r0 + 326), sn * (r0 + 326), -1052).multiplyScalar(s), r: 2.2 * s, color: [1.0, 0.95, 0.86], i: 2.0, breathe: 0.3, phase: a });
    }
  }

  // ---- docking collars along the keel (exactly the builder's: shuttles and tenders seat on them)
  mark('collars');
  for (const z of [-420, -170, 80, 330, 580]) {
    const f = linerF(z);
    const y = -BH * f * 0.8 + 4;
    B.push(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    B.at(0, z, -y);
    B.lathe([[16, -2, CK.BRONZE], [19, 4, CK.BRONZE], [19, 10, CK.BRONZE], [15, 13, CK.DARK], [12, 14, CK.DARK], [0.1, 14, CK.DARK]], 32);
    B.pop(); B.pop();
    lamps.push({ p: V(21, y - 12, z).multiplyScalar(s), r: 2.2 * s, color: [1.0, 0.6, 0.22], i: 2.6, breathe: 0.3, phase: (z + 500) / 1200 });
    lamps.push({ p: V(-21, y - 12, z).multiplyScalar(s), r: 2.2 * s, color: [1.0, 0.6, 0.22], i: 2.6, breathe: 0.3, phase: (z + 520) / 1200 });
  }
  // masthead, stern light, and a ring of teal lamps round the scoop
  {
    const top = BH * linerF(-760);
    lamps.push({ p: V(0, top - 10 + 232, -760).multiplyScalar(s), r: 3 * s, color: [1.0, 0.95, 0.86], i: 3.0, breathe: 0.3 });
    lamps.push({ p: V(0, 70, -1150).multiplyScalar(s), r: 3 * s, color: [1.0, 0.95, 0.86], i: 2.4, dir: V(0, 0, -1) });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      lamps.push({ p: V(Math.cos(a) * 160, Math.sin(a) * 160, 1420).multiplyScalar(s), r: 3 * s, color: [0.35, 0.95, 1.0], i: 2.2, breathe: 0.25, phase: k / 8 });
    }
    // the tanks' end lamps (amber: cryogen)
    for (const t of TANKS.t) {
      const p = hullPoint(TANKS.z0 - 4, t, V()).addScaledVector(hullNormal(TANKS.z0, t, V()), TANKS.r * 2 + 4);
      lamps.push({ p: p.multiplyScalar(s), r: 1.8 * s, color: [1.0, 0.7, 0.3], i: 2.2, breathe: 0.4, phase: t });
    }
  }
  mark('end');
  B.pop();
  const fit = B.geometry();
  const skin = paintedSkin(s);
  const g = mergeGeometries([skin, fit], false);
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.smoothSkin = true;
  g.userData.skinTriangles = skin.index.count / 3;
  g.userData.bandVertices = skin.userData.bandVertices;
  return { geo: g, glows, lamps, length: len, parts };
}
