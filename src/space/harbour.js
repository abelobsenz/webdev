import * as THREE from 'three';
import { CB, CK, buildTender, buildLiner } from '../craft/craftGeometry.js';
import { lathe, buildShuttle, buildTug, buildFreighter, buildCourier } from '../craft/craftClasses.js';
import { LAMP } from './lamps.js';
import { ctube } from './hull.js';
import { buildEmbarkationTerrace } from './interfaces.js';
import { craftMesh, craftPart, addLamps, placeMerge, placeLamps, pixelRadius, KM, dressedMesh, DK } from './craftMesh.js';
import { HarbourLife } from './harbourLife.js';
import { TerraceLife } from './terraceLife.js';
import { createPortMaterial } from './portMaterial.js';

// THE GEOSTATIONARY HARBOUR, drawn in metres with the ships' own builder and material.
// Local frame: +Y up the tether (away from the Earth), +Z north (the Earth's axis),
// +X west. The tether runs through the spindle.
//
//   spindle     climber terminals at both ends, bearing collars at the three ring hubs,
//               the glass Concourse at the middle
//   rings       three habitat rings (the middle one counter-rotating), a garden trough in
//               section: outer floor, glazed sides with galleries, a glass roof facing the
//               axis; spokes to rotating hub collars
//   arms        eight docking arms between the rings, gallery tubes with berth fingers,
//               freighters and tenders alongside; the liner pier
//   power       four sun-tracking solar wings on north-south booms above; radiator fins below
//   small craft shuttles, tugs and couriers in the terminal bays

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// The station is laid out in design metres and drawn at HS of that size, while the ships at
// its berths keep their true size: at full scale a 1 km freighter was a speck on an arm as
// thick as its own radiators.
export const HS = 0.42;

/** Sweep a closed section [[dr, dy], ...] (with a kind per point) around the Y axis at radius R. */
function sweepRing(B, R, yc, sec, seg) {
  // split the loop into runs of one kind so boundaries stay crisp
  const M = sec.length;
  const runs = [];
  let start = 0;
  for (let i = 1; i <= M; i++) {
    if (i === M || sec[i][2] !== sec[start][2]) { runs.push([start, i]); start = i; }
  }
  const cx = sec.reduce((a, p) => a + p[0], 0) / M, cy = sec.reduce((a, p) => a + p[1], 0) / M;
  for (const [a0, a1] of runs) {
    const idx = [];
    for (let i = a0; i <= a1; i++) idx.push(i % M);
    const k = sec[a0][2];
    const base = B.pos.length / 3;
    const cols = idx.length;
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * TAU;
      const c = Math.cos(th), s = Math.sin(th);
      let per = 0;
      for (let q = 0; q < cols; q++) {
        const [dr, dy] = sec[idx[q]];
        if (q) { const [pr, py] = sec[idx[q - 1]]; per += Math.hypot(dr - pr, dy - py); }
        B.v(c * (R + dr), yc + dy, s * (R + dr), th * R, per, k);
      }
    }
    const hint = new THREE.Vector3();
    for (let j = 0; j < seg; j++) {
      const th = ((j + 0.5) / seg) * TAU;
      const c = Math.cos(th), s = Math.sin(th);
      for (let q = 0; q < cols - 1; q++) {
        const [d0, y0] = sec[idx[q]], [d1, y1] = sec[idx[q + 1]];
        const nr = (d0 + d1) / 2 - cx, ny = (y0 + y1) / 2 - cy;
        hint.set(c * nr, ny, s * nr);
        const i0 = base + j * cols + q, i1 = i0 + 1, i2 = i0 + cols, i3 = i2 + 1;
        B.tri(i0, i1, i3, hint); B.tri(i0, i3, i2, hint);
      }
    }
  }
}

/** Garden-trough habitat section: half width a (axial), half depth b (radial). */
function troughSection(a, b) {
  const pts = [];
  const N = 28;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU;
    const c = Math.cos(t), s = Math.sin(t);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / 3.4) * a;      // axial
    const r = Math.sign(s) * Math.pow(Math.abs(s), 2 / 3.4) * b;      // radial (+ out)
    let k = CK.HULL;
    if (s < -0.55) k = CK.ROOF;                      // glass roof over the gardens, facing the axis
    else if (Math.abs(s) < 0.22) k = CK.LANTERN;     // galleries along the sides
    else if (s < -0.3 || (s > 0.22 && s < 0.36)) k = CK.BRONZE;
    pts.push([r, x, k]);
  }
  return pts;
}

export function buildHarbour() {
  const B = new CB();
  const toY = new THREE.Matrix4().makeRotationX(-Math.PI / 2);    // lathe z -> +y
  // ---- spindle
  B.push(toY);
  lathe(B, [
    [0.1, -17200, CK.DARK], [520, -17200, CK.DARK], [760, -16900, CK.BRONZE], [1500, -16300, CK.HULL], [1900, -15500, CK.HULL],
    [1950, -15300, CK.BRONZE], [1950, -14100, CK.GLASS], [2050, -13950, CK.LANTERN], [1950, -13800, CK.BRONZE], [1950, -13300, CK.GLASS],
    [1700, -12700, DK.PORTS], [1000, -12000, DK.PORTS], [900, -11000, DK.PORTS],
    // lower hub collar (static half of the bearing)
    [900, -7000, DK.LIVERY], [1050, -6900, CK.BRONZE], [1050, -5100, CK.BRONZE], [900, -5000, DK.LIVERY],
    [900, -2600, CK.HULL], [1200, -2400, CK.BRONZE],
    // the Concourse
    [2000, -1900, CK.HULL], [2500, -1300, CK.GLASS], [2650, -400, CK.GLASS], [2700, -300, CK.LANTERN], [2700, 300, CK.LANTERN], [2650, 400, CK.GLASS],
    [2500, 1300, CK.GLASS], [2000, 1900, CK.HULL], [1200, 2400, CK.BRONZE], [900, 2600, CK.HULL],
    [900, 5000, DK.LIVERY], [1050, 5100, CK.BRONZE], [1050, 6900, CK.BRONZE], [900, 7000, DK.LIVERY],
    [900, 11000, DK.PORTS], [1000, 12000, DK.PORTS], [1700, 12700, DK.PORTS], [1950, 13300, CK.GLASS], [1950, 13800, CK.BRONZE],
    [2050, 13950, CK.LANTERN], [1950, 14100, CK.GLASS], [1950, 15300, CK.BRONZE], [1900, 15500, CK.HULL], [1500, 16300, CK.HULL],
    [760, 16900, CK.BRONZE], [520, 17200, CK.DARK], [0.1, 17200, CK.DARK],
  ], 40);
  B.pop();
  // longerons along the spindle between the terminals (visual rhythm, service rails)
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    ctube(B, [V(Math.cos(a) * 930, -11000, Math.sin(a) * 930), V(Math.cos(a) * 930, 11000, Math.sin(a) * 930)], 60, 5, CK.DARK);
  }
  // ---- docking arms: four above the middle ring, four below, staggered
  const berths = [];
  const arms = [];
  for (let i = 0; i < 8; i++) {
    const up = i < 4;
    const a = (i % 4) * (TAU / 4) + (up ? Math.PI / 4 : 0) + 0.2;
    const y = up ? 3000 : -3000;
    const L = [23500, 20500, 22500, 19500][i % 4] + (up ? 0 : 1200);
    const d = V(Math.cos(a), 0, Math.sin(a));
    const side = V(-Math.sin(a), 0, Math.cos(a));
    arms.push({ a, y, L, d, side, up });
    // gallery tube and its keel truss
    ctube(B, [d.clone().multiplyScalar(850).setY(y), d.clone().multiplyScalar(L).setY(y)], 230, 12, DK.PORTS);
    ctube(B, [d.clone().multiplyScalar(850).setY(y - (up ? -330 : 330)), d.clone().multiplyScalar(L - 400).setY(y - (up ? -330 : 330))], 70, 5, CK.DARK);
    for (let r = 2000; r < L - 300; r += 1400) {
      const p = d.clone().multiplyScalar(r).setY(y);
      ctube(B, [p.clone(), p.clone().setY(y - (up ? -330 : 330))], 45, 4, CK.DARK);
      // bronze girdles along the gallery
      B.at(p.x, p.y, p.z, 0, -a + Math.PI / 2, 0);
      lathe(B, [[238, -40, CK.BRONZE], [250, -30, CK.BRONZE], [250, 30, CK.BRONZE], [238, 40, CK.BRONZE]], 12);
      B.pop();
    }
    // cargo racks on the keel's outer face between its verticals: a bronze saddle and two
    // capsule pods, the stock waiting for the ships at the heads (inboard of the berth fingers)
    {
      const s = up ? 1 : -1;
      B.push(new THREE.Matrix4().makeBasis(d, V(0, s, 0), side.clone().multiplyScalar(s)).setPosition(0, y, 0));
      for (let r = 2700, j = 0; r < 11000; r += 1400, j++) {
        B.box(r, 422, 0, 760, 56, 720, CK.BRONZE);
        for (const sz of [-190, 190]) {
          B.push(new THREE.Matrix4().makeTranslation(r, 446 + 150, sz).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
          lathe(B, [[0.1, -440, CK.HULL], [90, -430, CK.HULL], [150, -380, (j + i) % 3 ? CK.HULL : CK.DECK], [150, -150, CK.BRONZE], [150, -120, (j + i) % 2 ? CK.DECK : CK.HULL], [150, 120, CK.BRONZE], [150, 150, CK.HULL], [150, 380, CK.HULL], [90, 430, CK.HULL], [0.1, 440, CK.DARK]], 16);
          B.pop();
        }
      }
      B.pop();
    }
    // windows strip: a lantern gallery on the arm's flank
    ctube(B, [d.clone().multiplyScalar(1400).add(side.clone().multiplyScalar(200)).setY(y + 60), d.clone().multiplyScalar(L - 500).add(side.clone().multiplyScalar(200)).setY(y + 60)], 40, 6, CK.LANTERN);
    // arm head: a docking hub with a collar ring facing outward
    const head = d.clone().multiplyScalar(L).setY(y);
    B.at(head.x, head.y, head.z, 0, -a + Math.PI / 2, 0);
    lathe(B, [[230, -300, CK.HULL], [520, -150, CK.HULL], [560, 0, CK.BRONZE], [560, 350, CK.GLASS], [520, 450, CK.BRONZE], [300, 600, CK.HULL], [200, 700, CK.BRONZE], [200, 780, CK.DARK], [0.1, 780, CK.DARK]], 20);
    B.pop();
    // berth fingers beyond the middle ring's radius, alternating sides
    let n = 0;
    for (let r = 12600; r < L - 1200; r += 2600, n++) {
      // the liner pier (arm 4) keeps its outboard side clear for the liner
      const sd = i === 4 ? 1 : (n % 2 ? 1 : -1);
      const base = d.clone().multiplyScalar(r).setY(y);
      const tip = base.clone().addScaledVector(side, sd * 900);
      ctube(B, [base, tip], 110, 8, CK.HULL);
      B.at(tip.x, tip.y, tip.z);
      B.box(0, 0, 0, 380, 380, 380, CK.BRONZE);
      B.pop();
      berths.push({ arm: i, r, sd, base, tip, a, side: side.clone(), d: d.clone(), up, y });
    }
  }
  // ---- radiator fins below and their manifold
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    const d = V(Math.cos(a), 0, Math.sin(a));
    ctube(B, [d.clone().multiplyScalar(900).setY(-10200), d.clone().multiplyScalar(3200).setY(-10200)], 160, 8, CK.DARK);
    B.at(d.x * 7200, -10200, d.z * 7200, 0, -a, 0);
    B.box(0, 0, 0, 8000, 5200, 90, CK.RADIATOR);
    B.box(-4000, 0, 0, 160, 5400, 220, CK.BRONZE);
    B.box(0, 2650, 0, 8100, 120, 200, CK.BRONZE);
    B.box(0, -2650, 0, 8100, 120, 200, CK.BRONZE);
    B.pop();
  }
  // ---- solar wing booms and gimbals (the wings themselves turn to face the Sun)
  const wingRoots = [];
  for (const sz of [-1, 1]) {
    ctube(B, [V(0, 10400, sz * 900), V(0, 10400, sz * 3600)], 180, 10, CK.DARK);
    B.at(0, 10400, sz * 3700);
    lathe(B, [[300, -420, CK.DARK], [420, -300, CK.BRONZE], [420, 300, CK.BRONZE], [300, 420, CK.DARK]], 16);
    B.pop();
    wingRoots.push(V(0, 10400, sz * 4000));
  }
  const bodyDesign = B.geometry();
  bodyDesign.scale(HS, HS, HS);

  // ---- habitat rings (separate: they turn)
  const rings = [];
  for (const [yc, R, a, b, dirn] of [[-6000, 7200, 720, 430, 1], [0, 10600, 980, 560, -1], [6000, 7200, 720, 430, 1]]) {
    const W = new CB();
    const seg = R > 9000 ? 360 : 280;
    sweepRing(W, R, yc, troughSection(a, b), seg);
    // bronze rims where the roof meets the walls
    const hubR = R > 9000 ? 3100 : 1400;
    // rotating hub collar
    W.push(toY);
    W.at(0, 0, yc);
    lathe(W, [[hubR - 350, -300, CK.BRONZE], [hubR, -260, CK.HULL], [hubR, 260, CK.GLASS], [hubR - 350, 300, CK.BRONZE], [hubR - 350, -300, CK.DARK]], 48);
    W.pop();
    W.pop();
    // spokes: pressurised tubes with an elevator shaft rail, bronze collars at both ends
    const nSp = 6;
    for (let k = 0; k < nSp; k++) {
      const t = (k / nSp) * TAU;
      const d = V(Math.cos(t), 0, Math.sin(t));
      const p0 = d.clone().multiplyScalar(hubR).setY(yc), p1 = d.clone().multiplyScalar(R - b * 0.9).setY(yc);
      ctube(W, [p0, p1], 120, 10, DK.LIVERY);
      ctube(W, [p0.clone().add(V(0, 150, 0)), p1.clone().add(V(0, 150, 0))], 30, 4, CK.LANTERN);
      for (const f of [0.08, 0.92]) {
        const c = p0.clone().lerp(p1, f);
        W.at(c.x, c.y, c.z, 0, -t + Math.PI / 2, 0);
        lathe(W, [[128, -120, CK.BRONZE], [160, -80, CK.BRONZE], [160, 80, CK.BRONZE], [128, 120, CK.BRONZE]], 12);
        W.pop();
      }
    }
    // hoop frames round the trough every 7.5 (small rings 10) degrees, between the spokes: a
    // bronze rib seated on the skin all the way round the section (over the glass roof too)
    const nRib = R > 9000 ? 48 : 36;
    for (let k = 0; k < nRib; k++) {
      const th = ((k + 0.5) / nRib) * TAU;
      const c = Math.cos(th), sn = Math.sin(th), loop = [];
      for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * TAU, ct = Math.cos(t), st = Math.sin(t);
        const x = Math.sign(ct) * Math.pow(Math.abs(ct), 2 / 3.4) * (a + 22), r = Math.sign(st) * Math.pow(Math.abs(st), 2 / 3.4) * (b + 22);
        loop.push(V(c * (R + r), yc + x, sn * (R + r)));
      }
      loop[40].copy(loop[0]);
      ctube(W, loop, 30, 6, CK.BRONZE);
    }
    // glazed promenade galleries along both faces of the ring, lit from within, carried by the frames
    for (const sx of [-1, 1]) {
      W.push(new THREE.Matrix4().makeTranslation(0, yc + sx * (a + 6), 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
      W.torus(R + b * 0.18, 64, R > 9000 ? 360 : 280, 10, CK.LANTERN);
      W.pop();
    }
    const rg = W.geometry();
    rg.scale(HS, HS, HS);
    rings.push({ geo: rg, dir: dirn, omega: Math.sqrt(9.81 / ((R + b) * HS)), R: R * HS, y: yc * HS });
  }

  // ---- solar wings: each a boom with six panel bays, turned about its boom (local Z)
  const wing = new CB();
  ctube(wing, [V(0, 0, 0), V(0, 0, 21500)], 90, 6, CK.DARK);
  for (let k = 0; k < 6; k++) {
    const z0 = 700 + k * 3500;
    wing.panel(-2100, -120, z0, z0 + 3300, 0, 40, CK.PANEL);
    wing.panel(120, 2100, z0, z0 + 3300, 0, 40, CK.PANEL);
    wing.box(0, 0, z0 - 60, 4400, 60, 60, CK.BRONZE);
  }
  wing.box(0, 0, 21560, 4400, 60, 60, CK.BRONZE);
  const wingGeo = wing.geometry();
  wingGeo.scale(HS, HS, HS);
  for (const w of wingRoots) w.multiplyScalar(HS);
  // berths and arms in drawn metres
  for (const b of berths) { b.base.multiplyScalar(HS); b.tip.multiplyScalar(HS); b.r *= HS; b.y *= HS; }
  for (const a of arms) { a.L *= HS; a.y *= HS; }

  // ---- berthed ships: freighters and tenders alongside the fingers, small craft in the bays
  const shipsBig = [], shipsSmall = [], lamps = [];
  const D = new CB();       // docking clamps between finger tips and berthed hulls (drawn metres)
  const servicePods = [];
  // Customs and garden waiting rooms rise from the arm spines, above the cargo plane.
  // They remain outside every rotating ring's radial envelope and above berthed hulls.
  for (const arm of arms) {
    const side = arm.up ? 1 : -1;
    const p=arm.d.clone().multiplyScalar(arm.L-980).setY(arm.y);
    ctube(D,[p,p.clone().add(V(0,side*450,0))],70,10,DK.GRIME);
    const root=p.clone().add(V(0,side*410,0));
    D.push(new THREE.Matrix4().compose(root,new THREE.Quaternion().setFromUnitVectors(V(0,0,1),V(0,side,0)),V(1,1,1)));
    lathe(D,[[190,-50,CK.HULL],[265,0,CK.BRONZE],[275,90,CK.GLASS],[230,190,CK.ROOF],[90,320,CK.ROOF],[0,350,CK.BRONZE]],28);D.pop();
    servicePods.push({root, radius:275, arm:arms.indexOf(arm)});
  }
  // Lit loading gantries on every berth finger: two legs on the tip block, a crosshead, and a
  // boom reaching out over the berth (clear above the tallest berthed radiator, 192 m), with a
  // trolley, a mast and its tie, floodlights under the boom and an amber lamp at its end.
  const gantries = [];
  for (const bth of berths) {
    const s = bth.up ? 1 : -1;
    const Z = bth.side.clone().multiplyScalar(bth.sd);
    D.push(new THREE.Matrix4().makeBasis(bth.d, V(0, s, 0), Z).setPosition(bth.tip));
    for (const x of [-60, 60]) ctube(D, [V(x, 76, 0), V(x, 270, 0)], 14, 8, CK.HULL);
    D.box(0, 270, 0, 150, 24, 24, CK.BRONZE);
    D.box(0, 270, 290, 22, 20, 580, CK.HULL);
    ctube(D, [V(0, 280, 0), V(0, 380, 0)], 8, 6, CK.DARK);
    ctube(D, [V(0, 376, 0), V(0, 279, 572)], 3.5, 6, CK.DARK);
    // (the trolley runs on the boom: src/space/harbourLife.js)
    D.box(0, 270, 584, 30, 30, 12, CK.BRONZE);
    D.pop();
    const W = new THREE.Matrix4().makeBasis(bth.d, V(0, s, 0), Z).setPosition(bth.tip);
    for (const z of [160, 330, 500]) lamps.push({ p: V(0, 252, z).applyMatrix4(W), r: 5, color: LAMP.WHITE, i: 2.2, dir: V(0, -s, 0) });
    lamps.push({ p: V(0, 292, 584).applyMatrix4(W), r: 7, color: LAMP.AMBER, i: 2.6, breathe: 0.35, phase: (bth.r * 0.0007) % 1 });
    gantries.push({ tip: bth.tip.clone(), matrix: W, boomBottom: 260, reach: 580 });
  }
  // Tug stands beside every arm head (on the side away from the liner at arm 4): a bracket off
  // the head's collar ending in a bronze clamp that meets the parked escort tug's flank.
  const stands = arms.map((arm, i) => {
    const lat = arm.side.clone().multiplyScalar(i === 4 ? 1 : -1);
    const along = arm.L + 100;
    const pos = arm.d.clone().multiplyScalar(along).addScaledVector(lat, 330).setY(arm.y);
    ctube(D, [arm.d.clone().multiplyScalar(along).addScaledVector(lat, 200).setY(arm.y), pos.clone().addScaledVector(lat, -20)], 20, 10, DK.GRIME);
    const c = pos.clone().addScaledVector(lat, -16.6);
    D.push(new THREE.Matrix4().makeBasis(arm.d, V(0, 1, 0), new THREE.Vector3().crossVectors(arm.d, V(0, 1, 0))).setPosition(c));
    D.box(0, 0, 0, 14, 14, 14, CK.BRONZE);
    D.pop();
    lamps.push({ p: c.clone().add(V(0, 12, 0)), r: 5, color: LAMP.AMBER, i: 2.2, breathe: 0.3, phase: i / 8 });
    return { arm: i, pos, lat, fwd: arm.d.clone().negate(), clamp: c };
  });
  const fr = buildFreighter(1100), te = buildTender(620), sh = buildShuttle(110), tu = buildTug(80), co = buildCourier(44);
  const I = new THREE.Matrix4();
  const teFull = { geo: placeMerge([{ geo: te.geo, m: I }, ...te.arms.map((A) => ({ geo: A.geo, m: I }))]), lamps: [], length: te.length };
  let rs = 91;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  for (const bth of berths) {
    if (bth.arm === 4 && bth.r > 17000 * HS) continue;      // the liner pier's outer berths stay clear
    const pick = rnd();
    if (pick < 0.12) continue;                              // an empty berth or two
    const big = pick < 0.66;
    const ship = big ? fr : teFull;
    const sc = big ? 0.62 + rnd() * 0.4 : 1;
    // ship lies parallel to the arm, outboard of the finger tip, hanging away from the rings
    const fwd = bth.d.clone().multiplyScalar(rnd() < 0.5 ? 1 : -1);
    const upv = V(0, bth.up ? 1 : -1, 0);
    // the ship's flank lies a clamp's length off the finger-tip block (half 80 m drawn), on the
    // block's axis, so the docking clamp below meets both (the tender used to sit inside it)
    const halfW = big ? 191 * sc : 257;
    const off = bth.side.clone().multiplyScalar(bth.sd * (80 + 45 + halfW));
    const pos = bth.tip.clone().add(off);
    ctube(D, [bth.tip.clone(), pos.clone().addScaledVector(bth.side, -bth.sd * halfW * 0.3)], big ? 42 : 30, 10, DK.GRIME);
    D.at(bth.tip.x + bth.side.x * bth.sd * 100, bth.tip.y, bth.tip.z + bth.side.z * bth.sd * 100, 0, Math.atan2(bth.side.x * bth.sd, bth.side.z * bth.sd), 0);
    lathe(D, [[big ? 42 : 30, -22, CK.BRONZE], [big ? 62 : 46, -14, CK.BRONZE], [big ? 62 : 46, 14, CK.LANTERN], [big ? 42 : 30, 22, CK.BRONZE]], 16);
    D.pop();
    const x = new THREE.Vector3().crossVectors(upv, fwd).normalize();
    _m.makeBasis(x, upv, fwd);
    _q.setFromRotationMatrix(_m);
    _s.setScalar(sc);
    const M = new THREE.Matrix4().compose(pos, _q, _s);
    bth.ship = { big, halfW, sc, pos: pos.clone() };
    shipsBig.push({ geo: ship.geo, m: M });
    lamps.push(...placeLamps(ship.lamps || [], M, 6));
    lamps.push({ p: bth.tip.clone().addScaledVector(upv, 110), r: 9, color: LAMP.AMBER, i: 2.4, breathe: 0.3, phase: rnd() });
  }
  // small craft in the terminal bays round the lower and upper terminals
  for (const yT of [-14600, 14600]) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU + (yT > 0 ? 0.13 : 0);
      const d = V(Math.cos(a), 0, Math.sin(a));
      const pick = k % 3;
      const ship = pick === 0 ? sh : pick === 1 ? tu : co;
      const pos = d.clone().multiplyScalar(1950 * HS + ship.length * 0.5 + 25).setY((yT + (k % 2 ? 350 : -350)) * HS);
      const upv = V(0, Math.sign(yT), 0);
      const fwd = d.clone().negate();
      const x = new THREE.Vector3().crossVectors(upv, fwd).normalize();
      _m.makeBasis(x, upv, fwd);
      const M = new THREE.Matrix4().compose(pos, _q.setFromRotationMatrix(_m), _s.setScalar(1));
      shipsSmall.push({ geo: ship.geo, m: M });
      lamps.push(...placeLamps(ship.lamps || [], M, 4));
    }
  }
  // station lamps: arm heads, gallery markers, ring hubs, terminal throats
  for (const arm of arms) {
    const head = arm.d.clone().multiplyScalar(arm.L + 800 * HS).setY(arm.y);
    lamps.push({ p: head, r: 14, color: LAMP.WHITE, i: 3.0, breathe: 0.35, phase: arm.a / TAU });
    for (let r = 3000 * HS; r < arm.L; r += 2800 * HS) {
      lamps.push({ p: arm.d.clone().multiplyScalar(r).addScaledVector(arm.side, 110).setY(arm.y), r: 6, color: LAMP.AMBER, i: 1.6 });
      lamps.push({ p: arm.d.clone().multiplyScalar(r).addScaledVector(arm.side, -110).setY(arm.y), r: 6, color: LAMP.AMBER, i: 1.6 });
    }
  }
  for (const yT of [-17250, 17250]) for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    lamps.push({ p: V(Math.cos(a) * 560, yT, Math.sin(a) * 560).multiplyScalar(HS), r: 9, color: LAMP.TEAL, i: 2.2, breathe: 0.25, phase: k / 8 });
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    lamps.push({ p: V(Math.cos(a) * 11300, -10200, Math.sin(a) * 11300).multiplyScalar(HS), r: 12, color: k % 2 ? LAMP.RED : LAMP.GREEN, i: 2.6 });
  }
  const shipsBigGeo = placeMerge(shipsBig);
  const shipsSmallGeo = placeMerge(shipsSmall);
  // the liner pier: arm 4's outer end; the liner lies alongside, a little below the gallery
  const pierArm = arms[4];
  const pier = {
    pos: pierArm.d.clone().multiplyScalar(pierArm.L - 1300).addScaledVector(pierArm.side, -330).setY(pierArm.y - 150),
    fwd: pierArm.d.clone(),
    side: pierArm.side.clone(),
  };
  // gangways from the gallery to the liner's flank (true metres, like the ships)
  const G = new CB();
  const linerGeo=buildLiner(2400).geo;
  const linerProbe=new THREE.Mesh(linerGeo,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  linerProbe.matrix.makeBasis(new THREE.Vector3().crossVectors(V(0,1,0),pier.fwd).normalize(),V(0,1,0),pier.fwd).setPosition(pier.pos);
  linerProbe.matrixAutoUpdate=false;linerProbe.updateMatrixWorld(true);
  const gangways=[];
  for (const r of [pierArm.L - 2150, pierArm.L - 1350, pierArm.L - 550]) {
    const p0 = pierArm.d.clone().multiplyScalar(r).setY(pierArm.y);
    const aim=p0.clone().addScaledVector(pierArm.side,-330).setY(pierArm.y-140);
    const dir=aim.clone().sub(p0).normalize();
    const hit=new THREE.Raycaster(p0,dir,0,800).intersectObject(linerProbe,false)[0];
    if(!hit) throw new Error('Harbour gangway missed the liner hull');
    const p1=hit.point.clone().addScaledVector(dir,8);
    gangways.push({root:p0.clone(),contact:hit.point.clone(),end:p1.clone()});
    ctube(G, [p0, p1], 14, 8, CK.HULL);
    G.at(p1.x, p1.y, p1.z);
    G.box(0, 0, 0, 34, 34, 34, CK.BRONZE);
    G.pop();
    lamps.push({ p: p1.clone().add(V(0, 26, 0)), r: 4, color: LAMP.AMBER, i: 2.2, breathe: 0.3, phase: r * 0.001 });
  }
  linerProbe.material.dispose();linerGeo.dispose();
  const body = placeMerge([{ geo: bodyDesign, m: new THREE.Matrix4() }, { geo: G.geometry(), m: new THREE.Matrix4() }, { geo: D.geometry(), m: new THREE.Matrix4() }]);
  return { body, rings, wingGeo, wingRoots, shipsBigGeo, shipsSmallGeo, lamps, berths, arms, pier, servicePods, gangways, gantries, stands };
}

/** The Harbour as a scene object: a group in km, rings turning, wings tracking the Sun. */
export class HarbourStation {
  constructor() {
    const h = buildHarbour();
    this.data = h;
    this.group = new THREE.Group();
    this.body = dressedMesh(h.body, { accent: [0.55, 0.85, 1.0], lit: 0.62, livery: [0.14, 0.26, 0.46], livery2: [0.9, 0.72, 0.3] });
    this.group.add(this.body);
    this.rings = h.rings.map((r) => {
      const m = craftPart(this.body, r.geo);
      m.scale.setScalar(KM);
      m.userData = { ...r };
      this.group.add(m);
      return m;
    });
    this.wings = h.wingRoots.map((p) => {
      const pivot = new THREE.Group();
      pivot.position.copy(p).multiplyScalar(KM);
      const m = craftPart(this.body, h.wingGeo);
      m.scale.setScalar(KM);
      if (p.z < 0) m.rotation.y = Math.PI;
      pivot.add(m);
      this.group.add(pivot);
      return { pivot, sign: Math.sign(p.z) };
    });
    this.shipsBig = craftPart(this.body, h.shipsBigGeo);
    this.shipsBig.scale.setScalar(KM);
    this.shipsSmall = craftPart(this.body, h.shipsSmallGeo);
    this.shipsSmall.scale.setScalar(KM);
    this.group.add(this.shipsBig, this.shipsSmall);
    this.lampMesh = addLamps(this.body, h.lamps, { minPx: 1.4 });
    this.terraceData=buildEmbarkationTerrace();
    // drawn with the port finishes (paving, lawns, pools, canopies, glasshouses) and its baked contact shade
    const terraceOpts={accent:[.55,.85,1],lit:.62,fill:.03};
    this.terrace=craftMesh(this.terraceData.geo,terraceOpts,createPortMaterial(terraceOpts));
    const pier=h.arms[4];
    this.terrace.position.copy(pier.d).multiplyScalar((pier.L-1200)*KM).addScaledVector(pier.side,.32).setY(pier.y*KM+.19);
    this.terrace.rotation.y=-pier.a;
    addLamps(this.terrace,this.terraceData.lamps,{minPx:.65});
    this.group.add(this.terrace);
    // its people: baggage carts and handlers, rim crews, the courier's ground crew (terraceLife.js)
    this.terraceLife = new TerraceLife(this.terrace, this.terraceData);
    this.group.traverse((o) => { o.frustumCulled = false; });
    // the port at work: conveyors, cranes, berth gantries, drones, lift cars (harbourLife.js)
    this.life = new HarbourLife(this);
    this._sunL = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._w = new THREE.Vector3();
  }

  /** Liner berth (km, harbour frame): position and orientation. */
  linerBerth(outPos, outQuat) {
    const p = this.data.pier;
    if (outPos) outPos.copy(p.pos).multiplyScalar(KM);
    if (outQuat) {
      const fwd = p.fwd, up = V(0, 1, 0);
      const x = new THREE.Vector3().crossVectors(up, fwd).normalize();
      outQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, fwd));
    }
  }

  update(sim, realTime, space) {
    // rings at their real 1 g rate, in real time (sim time at warp strobed)
    for (const r of this.rings) r.rotation.y = r.userData.dir * r.userData.omega * (realTime % 1e5);
    // wings: turn about their boom (local Z) so the panels face the Sun
    this.group.updateMatrixWorld(true);
    this._q.copy(this.group.getWorldQuaternion(this._q)).invert();
    const s = this._sunL.copy(sim.sunDir).applyQuaternion(this._q);
    const ang = Math.atan2(s.x, s.y);
    for (const w of this.wings) w.pivot.rotation.z = -ang;
    // small craft and lamps only when the station is big enough on screen to show them
    const cam = space.camera;
    const px = pixelRadius(cam, this.group.getWorldPosition(this._w), 13, space.size.y);
    this.shipsSmall.visible = px > 350;
    this.shipsBig.visible = px > 40;
    const terracePx = pixelRadius(cam, this.terrace.getWorldPosition(this._w), this.terraceData.radius, space.size.y);
    this.terrace.visible = terracePx > 3;
    this.terraceLife.update(realTime, terracePx > 150);
    if (this.lampMesh) this.lampMesh.visible = px > 10;
    this.life.update(realTime, space);
  }
}
