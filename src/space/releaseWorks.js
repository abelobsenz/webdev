import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { lathe } from '../craft/craftClasses.js';
import { LAMP } from './lamps.js';
import { addLamps } from './craftMesh.js';
import { YARD } from './releaseYard.js';
import { V, smooth, lerp, instancedPart, DynLamps, poseMatrix } from './lifeKit.js';

// THE RELEASE YARD'S MACHINERY (metres, the counterweight frame; see releaseYard.js).
//
//   crawlers     crew cars riding the spar's lantern walk from the ring out to the cradles and
//                the beacon mast, stopping at the cradle stations
//   gantries     an inspection ring round each cradle outside its hoops, running on the four
//                longerons between two hoops, lit cabins at its corners
//   winch houses plant rooms outside every hoop's crown, where the clamp rams are driven from
//   the tower    a control tower hanging under the spar abeam the cradles, glazed, lit
//
// The liner passes inside the hoops (apothem 480): everything here stays outside them, clear
// of the hoops' spar arms and the clamp sleeves (tools/verify-geo.mjs).

export const RW = {
  crawler: { lift: 300, get s0() { return YARD.sparFrom + 900; }, get s1() { return YARD.sparTo - 900; }, n: 3, T: 900 },   // (getters: releaseYard.js imports this module)
  gantry: { apothem: 585, bays: [[-450, 150], [150, 750]], margin: 70, T: 240 },
  house: { lift: 60, depth: 60, w: 90, h: 50 },
  tower: { drop: 520, r: 60 },
};

const octR = (ap) => ap / Math.cos(Math.PI / 8);

let _legs = null;
const LEG_W = [0.2, 0.06, 0.12, 0.06, 0.12, 0.06, 0.2, 0.18];
/** Crawler k at time t: arc length s along the spar (runs out, dwells at the cradles and the head, returns). */
export function crawlerS(k, t) {
  const C = RW.crawler;
  const u = ((t / C.T + k / C.n) % 1 + 1) % 1;
  // out: s0 -> cradle (dwell) -> head (dwell) -> cradle (dwell) -> s0 (dwell)
  const legs = _legs || (_legs = ((sc) => [[C.s0, sc], [sc, sc], [sc, C.s1], [C.s1, C.s1], [C.s1, sc], [sc, sc], [sc, C.s0], [C.s0, C.s0]])(YARD.cradleAt));
  const w = LEG_W;
  let a = 0;
  for (let i = 0; i < legs.length; i++) {
    if (u < a + w[i] || i === legs.length - 1) { const e = smooth(0, 1, (u - a) / w[i]); return lerp(legs[i][0], legs[i][1], e); }
    a += w[i];
  }
  return C.s0;
}
/** Gantry of cradle c (0 north, 1 south), bay b, at time t: z (cradle-local, along E). */
export function gantryZ(ci, b, t) {
  const [z0, z1] = RW.gantry.bays[b], m = RW.gantry.margin;
  const u = ((t / RW.gantry.T + ci * 0.37 + b * 0.21) % 1 + 1) % 1;
  const e = u < 0.5 ? smooth(0.05, 0.45, u) : 1 - smooth(0.55, 0.95, u);
  return lerp(z0 + m, z1 - m - 24, e);                  // (the ring and its cabins reach 24-27 m forward of z)
}

function crawlerGeo() {
  const B = new CB();
  // cradle-free car: along +z (E), riding the lantern walk (below, -y)
  B.box(0, 0, 0, 34, 20, 70, CK.HULL);
  B.box(0, 2, 0, 35, 7, 60, CK.LANTERN);
  B.box(0, 11, 0, 30, 2, 66, CK.BRONZE);
  for (const z of [-26, 26]) for (const x of [-12, 12]) B.box(x, -13, z, 6, 6, 10, CK.DARK);
  B.push(new THREE.Matrix4().makeTranslation(0, 0, 36).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)));
  lathe(B, [[16, 0, CK.HULL], [14, 6, CK.GLASS], [0.1, 10, CK.GLASS]], 12);
  B.pop();
  return B.geometry();
}
/** The inspection ring: an octagon outside the hoops with bogies onto the four longerons and corner cabins. */
function gantryGeo() {
  const B = new CB();
  const r = octR(RW.gantry.apothem), rl = octR(YARD.apothem);
  const L = [];
  for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; L.push(V(Math.cos(a) * r, Math.sin(a) * r, 0)); }
  L.push(L[0].clone());
  B.tube(L, 10, 8, CK.BRONZE);
  const L2 = L.map((p) => p.clone().setZ(24));
  B.tube(L2, 6, 6, CK.HULL);
  for (let k = 0; k < 8; k++) B.tube([L[k], L2[k]], 5, 6, CK.DARK);
  for (const k of [1, 2, 5, 6]) {
    const a = Math.PI / 8 + k * Math.PI / 4, d = V(Math.cos(a), Math.sin(a), 0);
    B.tube([d.clone().multiplyScalar(rl + 18), d.clone().multiplyScalar(r)], 7, 8, CK.HULL);        // bogie arm down to the longeron
    const b = d.clone().multiplyScalar(rl + 20);
    B.box(b.x, b.y, b.z + 12, 18, 18, 40, CK.DARK);
    const c = d.clone().multiplyScalar(r + 22);
    B.push(new THREE.Matrix4().makeBasis(V(-d.y, d.x, 0), d, V(0, 0, 1)).setPosition(c.x, c.y, 12));
    B.box(0, 0, 0, 40, 26, 30, CK.HULL);
    B.box(0, 2, 0, 41, 9, 26, CK.LANTERN);
    B.box(0, 14, 0, 44, 2, 32, CK.BRONZE);
    B.pop();
  }
  return B.geometry();
}

export function buildReleaseMachinery(data) {
  const B = new CB(), lamps = [];
  const { E, N, U } = data.axes;
  const at = (s, n = 0, y = 0) => E.clone().multiplyScalar(s).addScaledVector(N, n).addScaledVector(U, y);
  // winch houses outside each hoop's crown (cradle frame: x = N, y = U, z = E)
  const H = RW.house;
  for (const c of data.cradles) {
    B.push(c.frame);
    for (const z of YARD.hoops) {
      const y0 = YARD.apothem + 12 + H.lift / 2;                                    // seat sunk 10 m into the hoop tube
      B.box(0, y0, z, H.w, H.lift, 30, CK.DARK);                                    // seat on the hoop
      B.box(0, y0 + H.lift / 2 + H.h / 2, z, H.w, H.h, H.depth, CK.HULL);
      B.box(0, y0 + H.lift / 2 + H.h / 2 + 4, z, H.w + 1, 10, H.depth + 1, CK.LANTERN);
      B.box(0, y0 + H.lift / 2 + H.h + 2, z, H.w + 6, 4, H.depth + 6, CK.BRONZE);
      for (const x of [-30, 0, 30]) {
        B.push(new THREE.Matrix4().makeTranslation(x, y0 + H.lift / 2 + H.h + 10, z).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
        lathe(B, [[0.1, -24, CK.DARK], [10, -22, CK.BRONZE], [10, 22, CK.BRONZE], [0.1, 24, CK.DARK]], 14);       // cable drums
        B.pop();
      }
      lamps.push({ p: V(0, y0 + H.lift / 2 + H.h + 30, z).applyMatrix4(c.frame), r: 9, color: LAMP.AMBER, i: 2.2, breathe: 0.4, phase: (z + 500) / 2000 + (c.side > 0 ? 0 : 0.5) });
    }
    B.pop();
  }
  // the control tower under the spar, abeam the cradles
  const T = RW.tower;
  const base = at(YARD.cradleAt, 0, -YARD.sparR + 20);
  B.push(new THREE.Matrix4().makeBasis(N, E, U.clone().negate()).setPosition(base));
  lathe(B, [[T.r * 0.8, 0, CK.BRONZE], [T.r * 0.6, 60, CK.HULL], [T.r * 0.6, T.drop - 180, CK.HULL], [T.r * 1.3, T.drop - 150, CK.BRONZE], [T.r * 1.5, T.drop - 120, CK.GLASS],
    [T.r * 1.5, T.drop - 60, CK.LANTERN], [T.r * 1.3, T.drop - 30, CK.GLASS], [T.r * 0.9, T.drop, CK.HULL], [0.1, T.drop + 30, CK.BRONZE]], 28);
  B.pop();
  lamps.push({ p: at(YARD.cradleAt, 0, -YARD.sparR - T.drop - 50), r: 18, color: LAMP.RED, i: 2.6, breathe: 0.5 });
  // crawler stations on the lantern walk: lit platforms at the cradles and the head
  for (const s of [RW.crawler.s0, YARD.cradleAt, RW.crawler.s1]) {
    for (const sd of [-1, 1]) {
      const p = at(s, sd * 60, YARD.sparR + 40);
      B.push(new THREE.Matrix4().makeBasis(N, U, E).setPosition(p));
      B.box(0, 0, 0, 40, 10, 120, CK.DECK);
      B.box(sd * 20, 8, 0, 2, 14, 120, CK.BRONZE);
      B.pop();
      lamps.push({ p: at(s, sd * 80, YARD.sparR + 70), r: 10, color: LAMP.TEAL, i: 1.8, breathe: 0.3, phase: s * 1e-4 });
    }
  }
  return { geo: B.geometry(), lamps };
}

export class ReleaseWorks {
  constructor(mesh, data) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    this.data = data;
    this.root = new THREE.Group();
    mesh.add(this.root);
    this.static = buildReleaseMachinery(data);
    const sm = new THREE.Mesh(this.static.geo, mesh.material);
    sm.onBeforeRender = mesh.onBeforeRender; sm.renderOrder = 3;
    this.root.add(sm);
    addLamps(this.root, this.static.lamps, { minPx: 1.1 });
    this.crawlers = instancedPart(mesh, crawlerGeo(), RW.crawler.n);
    this.gantries = instancedPart(mesh, gantryGeo(), data.cradles.length * RW.gantry.bays.length);
    this.root.add(this.crawlers, this.gantries);
    const dl = [];
    for (let i = 0; i < RW.crawler.n; i++) dl.push({ p: V(), r: 8, color: LAMP.WHITE, i: 2.4 });
    for (let i = 0; i < data.cradles.length * RW.gantry.bays.length; i++) dl.push({ p: V(), r: 10, color: LAMP.AMBER, i: 2.4, breathe: 0.5, phase: i / 4 });
    this.dyn = new DynLamps(dl, { minPx: 1.1 });
    this.root.add(this.dyn.mesh);
    this.root.traverse((o) => { o.frustumCulled = false; });
    this._m = new THREE.Matrix4(); this._p = V(); this._up = V();
    this.buildMs = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    this.update(0, 1e9);
  }

  triangles() {
    let t = 0;
    this.root.traverse((o) => { if (o.isMesh && o.geometry.index && !o.geometry.isInstancedBufferGeometry) t += (o.geometry.index.count / 3) * (o.isInstancedMesh ? o.count : 1); });
    return t;
  }

  update(t, px) {
    const on = px > 60;
    this.root.visible = on;
    if (!on) return;
    const { E, U } = this.data.axes, m = this._m, p = this._p;
    for (let k = 0; k < RW.crawler.n; k++) {
      const s = crawlerS(k, t);
      p.copy(E).multiplyScalar(s).addScaledVector(U, RW.crawler.lift);
      poseMatrix(m, p, E, U, 1);
      this.crawlers.setMatrixAt(k, m);
      this.dyn.set(k, p.x + U.x * 16, p.y + U.y * 16, p.z + U.z * 16);
    }
    let q = 0;
    for (const [ci, c] of this.data.cradles.entries()) for (let b = 0; b < RW.gantry.bays.length; b++) {
      const z = gantryZ(ci, b, t);
      m.makeTranslation(0, 0, z).premultiply(c.frame);
      this.gantries.setMatrixAt(q, m);
      p.set(0, octR(RW.gantry.apothem) + 40, z + 12).applyMatrix4(c.frame);
      this.dyn.set(RW.crawler.n + q, p.x, p.y, p.z);
      q++;
    }
    this.crawlers.instanceMatrix.needsUpdate = true;
    this.gantries.instanceMatrix.needsUpdate = true;
    this.dyn.commit();
  }
}
