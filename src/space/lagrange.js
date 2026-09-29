import * as THREE from 'three';
import { craftMesh, addLamps, KM, createDressedMaterial } from './craftMesh.js';
import { LAMP, createLamps } from './lamps.js';
import { DynLamps, smooth, instancedPart, spanMatrix } from './lifeKit.js';
import { CB, CK } from '../craft/craftGeometry.js';
import { createRibbonMaterial, buildRibbonGeometry } from './lines.js';
import { R_EARTH, R_MOON, GEO_ALT, MOON_DIST } from './sim.js';
import { COL, WINDOW_CENTRES, buildRotor, buildWindows, buildMirror, buildStator, buildAgriRing, buildPairFrame } from './lagrangeColony.js';
import { createWindowMaterial, createMirrorMaterial, bindWindow, bindMirror } from './lagrangeShaders.js';
import { GATE, buildGateway, buildGatewayWheel, buildLiftCar, liftRange } from './lagrangeGateway.js';
import { StationTraffic, makeRoute, buildFamilies } from './fleetTraffic.js';
import { LagrangeLife } from './lagrangeLife.js';

// THE LAGRANGE COLONIES: the Concord's oldest suburbs, riding the Moon's orbit.
//
// At L4 (60 degrees ahead of the Moon) and L5 (60 degrees behind) a pair of counter-rotating
// Island-Three cylinders, their axes on the Sun, tied by trusses at both ends. Each turns
// once in ~127 s for a full g on its land; its three mirrors open for the colony's day and
// close for its night, when the valley towns show through the glazing. The agricultural
// rings on the sunward spindle spin on their own bearings; the spaceport and industry sit
// despun at the anti-sun end. At L1, where the Earth's and Moon's pulls balance, the
// Fulcrum gateway turns two habitat wheels between its docks.
//
// Placement is live: the points ride the Moon's orbit (sim.moonPos rotated +-60 degrees about
// the orbit normal; L1 at 0.849 of the way to the Moon). Local traffic (hulls, plumes, RCS)
// uses the fleet's StationTraffic in each frame; the long lanes between the Earth, L1, the
// Moon and the colonies are beacon strings and moving drive lights. Beyond ~25,000 km the
// structures are hidden and a glint marks each colony (its mirrors throw the Sun).

const L1_FRAC = 1 - 58020 / MOON_DIST;
const NEAR_KM = 25000;          // meshes drawn inside this
const DETAIL_KM = 900;
const TRUSS_NEAR = 22;          // km: inside this the pair-frame chords are geometry (32 m tubes ~ 1 px)
const TRUSS_FRAG = /* glsl */ `
uniform float uGainF;
void main() {
  // three bronze chords and a glazed tube, 240 m across: sunlit metal as a thin thread, the
  // transit cars' windows a faint warm line down its middle
  vec3 sunL = spaceSunlight(uTransmittanceLUT, vWorld, uSunDir) * uSunE;
  float x = clamp(vAcross, -1.0, 1.0);
  float body = 0.55 + 0.45 * sqrt(max(1.0 - x * x, 0.0));
  vec3 col = vec3(0.7, 0.52, 0.32) * sunL * 0.035 * body + vec3(1.0, 0.72, 0.45) * 0.03;
  gl_FragColor = vec4(col * vCoverage * uGainF, 0.0);
}
`;          // lamps, stations' fine parts
const LIFE_KM = 400;
const RAMS = 6, RAM_X = 2070;   // two rams per mirror, on the longeron crests either side of it            // trams, fittings, docked ships, cranes
const _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const TAU = Math.PI * 2;

/** Unit normal of the Moon's orbit (prograde). */
function orbitNormal(sim, out) {
  out.crossVectors(sim.moon0, sim.moonT);
  if (out.lengthSq() < 1e-12) out.set(0, 1, 0);
  return out.normalize();
}

/** Live position (km, inertial) of 'L4', 'L5' or 'L1'. */
export function lagrangePoint(sim, which, out = new THREE.Vector3()) {
  if (sim.moonTime0 === undefined) sim.update();
  if (which === 'L1') return out.copy(sim.moonPos).multiplyScalar(L1_FRAC);
  const s = which === 'L4' ? 1 : -1;
  orbitNormal(sim, _n);
  _a.crossVectors(_n, sim.moonPos);
  return out.copy(sim.moonPos).multiplyScalar(0.5).addScaledVector(_a, s * Math.sqrt(3) / 2);
}

/** Frame of a colony pair (z on the Sun, y toward the orbit normal) or the gateway (z on the Moon). */
export function lagrangeFrame(sim, which, q = new THREE.Quaternion()) {
  orbitNormal(sim, _n);
  if (which === 'L1') _z.copy(sim.moonPos).normalize();
  else _z.copy(sim.sunDir).normalize();
  _y.copy(_n).addScaledVector(_z, -_n.dot(_z));
  if (_y.lengthSq() < 1e-8) _y.set(0, 0, 1).addScaledVector(_z, -_z.z);
  _y.normalize();
  _x.crossVectors(_y, _z);
  return q.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Dock-and-go route (km, station frame): in from far along dir, hold, out, a hidden return. */
function dockRoute(berth, dir, side, far, k) {
  const lat = V().crossVectors(dir, Math.abs(dir.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
  const up = V().crossVectors(lat, dir).normalize();
  const hold = berth.clone().addScaledVector(dir, 0.22);
  const F = berth.clone().addScaledVector(dir, far).addScaledVector(lat, side * (4 + 3 * k)).addScaledVector(up, 2 + k);
  const G = berth.clone().addScaledVector(dir, far).addScaledVector(lat, -side * (5 + 2 * k)).addScaledVector(up, -3 - k);
  const tIn = 130 + 20 * k, tOut = 110 + 15 * k, tRet = 70;
  const legs = [
    { k: 'bez', p: [F, F.clone().addScaledVector(dir, -far * 0.35), hold.clone().addScaledVector(dir, far * 0.2), hold], dur: tIn, ease: 'out', face: 'fwd', thr: 0.5 },
    { k: 'hold', at: hold, dur: 50 + 17 * k },
    { k: 'bez', p: [hold, hold.clone().addScaledVector(dir, far * 0.2), G.clone().addScaledVector(dir, -far * 0.3), G], dur: tOut, ease: 'in', face: 'fwd', thr: 1 },
    { k: 'bez', p: [G, G.clone().addScaledVector(dir, far * 0.2), F.clone().addScaledVector(dir, far * 0.2), F], dur: tRet, ease: 'lin', face: 'fwd', thr: 0 },
  ];
  const T = tIn + 50 + 17 * k + tOut + tRet;
  return makeRoute(legs, { fadeIn: 0.04, fadeOut: (tRet + 12) / T });
}

/**
 * One beacon buoy (metres, into B at p, its spar along `up`): a spar hull with a bronze collar,
 * a ring of photovoltaic skirt on three struts, and a lantern crown. Returns the crown's point.
 */
function beaconBuoy(B, p, up, size) {
  const f = V().crossVectors(up, Math.abs(up.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
  const g = V().crossVectors(up, f);
  B.push(new THREE.Matrix4().makeBasis(f, g, up).setPosition(p).scale(V(size, size, size)));
  B.lathe([[0.1, -40, CK.DARK], [8, -37, CK.DARK], [11, -30, CK.BRONZE], [11, 14, CK.HULL], [14, 18, CK.BRONZE], [14, 22, CK.BRONZE], [8, 26, CK.HULL], [4.5, 34, CK.LANTERN], [0.1, 38, CK.LANTERN]], 12);
  B.torus(26, 1.8, 24, 5, CK.BRONZE);
  B.box(0, 0, -6, 44, 44, 0.6, CK.PANEL);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    B.tube([V(Math.cos(a) * 10, Math.sin(a) * 10, 0), V(Math.cos(a) * 25, Math.sin(a) * 25, 0)], 1.2, 5, CK.DARK);
  }
  B.pop();
  return p.clone().addScaledVector(up, 40 * size);
}

/**
 * The approach to a port (km, station frame): gates [{ c, r, from, to, size }]. Four marker buoys
 * stand at the corners of each entry gate, port red and starboard green, flashing together; a
 * single line of buoys runs down the corridor, one every 30-40 km, their white strobes chasing
 * toward the station. Physical buoys (craft kinds, metres) with small lamps on their crowns: a
 * navigation aid, not a drawn ring. Returns a group in km.
 */
function approachBeacons(gates, color, mat) {
  const lamps = [], B = new CB(), buoys = [];
  for (const g of gates) {
    const d = V().subVectors(g.from, g.to).normalize();              // down the corridor, toward the port
    const e1 = V().crossVectors(d, Math.abs(d.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize(), e2 = V().crossVectors(d, e1);
    const lampR = 0.012 * g.size;
    for (let i = 0; i < 4; i++) {
      const a = ((i + 0.5) / 4) * TAU;
      const p = g.c.clone().addScaledVector(e1, Math.cos(a) * g.r).addScaledVector(e2, Math.sin(a) * g.r);
      buoys.push({ p, up: e2.clone(), size: g.size * 1.5 });
      const crown = p.clone().addScaledVector(e2, 0.042 * g.size * 1.5);
      lamps.push({ p: crown, r: lampR * 1.6, color: Math.cos(a) > 0 ? LAMP.GREEN : LAMP.RED, i: 4.5, breathe: 0.9, phase: 0 });
      lamps.push({ p: p.clone().addScaledVector(e1, Math.cos(a) * 0.04 * g.size), r: lampR * 0.6, color: LAMP.WHITE, i: 2.0 });
    }
    const L = g.from.distanceTo(g.to), n = Math.max(2, Math.round(L / 35));
    for (let i = 0; i <= n; i++) {
      const p = g.to.clone().lerp(g.from, i / n).addScaledVector(e1, (i % 2 ? 1 : -1) * 1.2);
      buoys.push({ p, up: e2.clone(), size: g.size });
      lamps.push({ p: p.clone().addScaledVector(e2, 0.042 * g.size), r: lampR, color: i % 2 ? color : LAMP.WHITE, i: 3.2, breathe: 0.95, phase: 1 - i / n });
    }
  }
  for (const b of buoys) beaconBuoy(B, b.p.clone().multiplyScalar(1000), b.up, b.size);
  const group = new THREE.Group();
  const m = new THREE.Group();
  m.scale.setScalar(KM);
  group.add(m);
  const hull = craftMesh(B.geometry(), { scale: 1 }, mat);
  m.add(hull);
  const lm = createLamps(lamps, { minPx: 0.9 });
  lm.renderOrder = 17;
  group.add(lm);
  group.userData.buoys = buoys.length;
  group.userData.lamps = lamps.length;
  return group;
}

// long lanes between the bodies: [from, to, colour out, colour back]
const LANES = [['earth', 'L4'], ['earth', 'L5'], ['earth', 'L1'], ['L1', 'L4'], ['L1', 'L5'], ['moon', 'L1']];
const LANE_SHIPS = 6, LANE_BUOYS = 14, LANE_T = 1500;

export class LagrangeColonies {
  constructor(space) {
    const t0 = performance.now();
    this.space = space;
    this.sunDir = space.sim.sunDir;
    // shared geometry (built once, drawn by all four cylinders)
    this.parts = {
      rotor: buildRotor(7), rotor5: buildRotor(19), windows: buildWindows(), mirror: buildMirror(), stator: buildStator(3),
      agri: buildAgriRing(), frame: buildPairFrame(), gate: buildGateway(), wheels: GATE.WHEELS.map((w) => buildGatewayWheel(w)),
    };
    this.mirMat = createMirrorMaterial();
    // the mirrors' rams: a bronze sleeve on the longeron crest and a rod to the mirror's edge,
    // both unit length along +y (stretched to the span each time the mirrors move)
    const ram = (r, k) => { const B = new CB(); B.tube([V(0, 0, 0), V(0, 1, 0)], r, 10, k); return B.geometry(); };
    this.ramGeo = { sleeve: ram(26, CK.BRONZE), rod: ram(13, CK.HULL) };
    this.ramPiv = WINDOW_CENTRES.map((a) => { const c = Math.cos(a), sn = Math.sin(a), r = COL.R + COL.MIRROR_OFF; return new THREE.Matrix4().set(-sn, c, 0, c * r, c, sn, 0, sn * r, 0, 0, 1, -COL.HL, 0, 0, 0, 1); });
    this.pairs = [this._pair('L4', 0.13, 11), this._pair('L5', 0.61, 23)];
    this.gateway = this._gateway();
    // local traffic
    const fam = buildFamilies();
    this.families = fam;
    this.life = new LagrangeLife(this);
    this._near = [false, false];
    const pick = (cls, i) => fam[cls][((i % fam[cls].length) + fam[cls].length) % fam[cls].length];
    for (const P of this.pairs) {
      const ro = [];
      const berths = this.parts.stator.berths;
      for (const s of [-1, 1]) for (let b = 0; b < berths.length; b += 2) {
        const rot = s > 0 ? 0 : Math.PI / COL.BERTHS;
        const bp = berths[b].p.clone().applyAxisAngle(V(0, 0, 1), rot).multiplyScalar(KM).add(V(s * COL.PAIR_X * KM, 0, 0));
        if (Math.cos(berths[b].a + rot) * s < -0.6) continue;          // (the berth facing the twin: its lane would cross the truss)
        const k = (b / 2) % 3;
        const R = dockRoute(bp, V(0, 0, -1), s, 240 + 40 * k, k);
        const cls = ['packet', 'hauler', 'clipper', 'tanker', 'lighter', 'barge'][(b / 2 + (s > 0 ? 3 : 0)) % 6];
        ro.push({ route: R, phase: (b / berths.length) * R.T + (s > 0 ? 37 : 0), design: pick(cls, b + s), scale: cls === 'packet' || cls === 'clipper' ? 1 : 1.5, slot: [0, 0, 0], seed: 200 + b + (s > 0 ? 50 : 0), fidget: 0.5 });
      }
      const shuttle = makeRoute([{ k: 'track', c: V(0, 0, -26), a: V(1, 0, 0), b: V(0, 1, 0), L: 19, r: 2, dur: 420 }], { fadeIn: 0, fadeOut: 0 });
      for (let i = 0; i < 4; i++) ro.push({ route: shuttle, phase: (i / 4) * shuttle.T, design: pick('packet', i), scale: 1, slot: [0, 0, 0], seed: 260 + i, fidget: 0.3 });
      for (const s of [-1, 1]) {
        const tend = makeRoute([{ k: 'track', c: V(s * COL.PAIR_X * KM, 0, 20.57), a: V(1, 0, 0), b: V(0, 1, 0), L: 0.001, r: 3.3, dur: 260 }], { fadeIn: 0, fadeOut: 0 });
        for (let i = 0; i < 3; i++) ro.push({ route: tend, phase: (i / 3) * tend.T, design: pick('drone', i + s), scale: 2, slot: [0, 0, 0], seed: 280 + i + s * 5, fidget: 1 });
      }
      P.traffic = new StationTraffic(space, `lagrange-${P.name}`, P.group, ro, [...new Set(ro.map((r) => r.design))], { engineColor: P.name === 'L4' ? LAMP.BLUE : LAMP.TEAL });
    }
    {
      const ro = [];
      this.parts.gate.berths.forEach((b, i) => {
        if (i % 4 === 3) return;                 // a ship berthed there (below)
        const R = dockRoute(b.p.clone().multiplyScalar(KM), b.dir.clone(), i % 2 ? 1 : -1, 160 + 30 * (i % 3), i % 3);
        const cls = b.dir.z > 0 ? ['packet', 'lighter', 'clipper'][i % 3] : ['clipper', 'packet', 'hauler'][i % 3];
        ro.push({ route: R, phase: (i / 16) * R.T, design: pick(cls, i), scale: 1, slot: [0, 0, 0], seed: 300 + i, fidget: 0.5 });
      });
      const tugs = makeRoute([{ k: 'track', c: V(0, 0.75, 0), a: V(0, 0, 1), b: V(1, 0, 0), L: 1.4, r: 0.9, dur: 240 }], { fadeIn: 0, fadeOut: 0 });
      for (let i = 0; i < 3; i++) ro.push({ route: tugs, phase: (i / 3) * tugs.T, design: pick('tug', i), scale: 1, slot: [0, 0, 0], seed: 330 + i, fidget: 1 });
      // inspection drones circling the station between the wheels and the radiators / solar wings
      for (const z of [-0.42, 0.42]) {
        const ring = makeRoute([{ k: 'track', c: V(0, 0, z), a: V(1, 0, 0), b: V(0, 1, 0), L: 0.001, r: 0.7, dur: 150 }], { fadeIn: 0, fadeOut: 0 });
        for (let i = 0; i < 3; i++) ro.push({ route: ring, phase: (i / 3) * ring.T + (z > 0 ? 20 : 0), design: pick('drone', i), scale: 1.5, slot: [0, 0, 0], seed: 340 + i + (z > 0 ? 5 : 0), fidget: 1 });
      }
      this.gateway.traffic = new StationTraffic(space, 'lagrange-L1', this.gateway.group, ro, [...new Set(ro.map((r) => r.design))], { engineColor: LAMP.AMBER });
    }
    this.traffic = [...this.pairs.map((p) => p.traffic), this.gateway.traffic];
    this._gatewayBerthed(fam);
    this._lanes();
    this.buildMs = performance.now() - t0;
  }

  // ------------------------------------------------------------------ pair --
  _pair(name, dayOffset, seed) {
    const space = this.space, pt = this.parts;
    const group = new THREE.Group();
    group.name = `lagrange-${name}`;
    const m = new THREE.Group();
    m.scale.setScalar(KM);
    group.add(m);
    // fill kept low: the land strips lie along the sunlight (the axis is on the Sun), so the hull is
    // lit only by the Earth and Moon and the windows' daylight must read brighter than it
    // dressed: regolith plate, painted bands and marks, lit ports, gold foil tanks (see lagrangeColony.js)
    const mat = createDressedMaterial({ accent: name === 'L4' ? [0.55, 0.9, 1.0] : [1.0, 0.78, 0.45], lit: 0.5, fill: 0.05, flood: 1,
      livery: name === 'L4' ? [0.56, 0.58, 0.6] : [0.62, 0.58, 0.52], livery2: name === 'L4' ? [0.16, 0.34, 0.56] : [0.78, 0.5, 0.16] });
    const winMat = createWindowMaterial(seed);
    const frame = craftMesh(pt.frame.geo, { scale: 1 }, mat);
    m.add(frame);
    const lampSets = [addLamps(frame, pt.frame.lamps, { minPx: 1.2 })];
    // the trusses between the twins: geometry near, an anti-aliased thread (its sunlit bronze
    // at its true width, a pixel wide at least, dimmed by its coverage) from the default view out
    const chords = craftMesh(pt.frame.chords, { scale: 1 }, mat);
    m.add(chords);
    const trussMat = createRibbonMaterial({ widthKm: 0.24, minPx: 1.0, frag: TRUSS_FRAG, uniforms: { uGainF: { value: 0 } } });
    const trussLine = new THREE.Mesh(buildRibbonGeometry(pt.frame.spans.map((sp, i) => {
      const pts = [], along = [];
      for (let k = 0; k <= 40; k++) { pts.push(sp.a.clone().lerp(sp.b, k / 40).multiplyScalar(KM)); along.push((k / 40) * sp.a.distanceTo(sp.b) * KM); }
      return { pts, along, id: i };
    })), trussMat);
    trussLine.frustumCulled = false; trussLine.renderOrder = 12; trussLine.visible = false;
    group.add(trussLine);
    const cyls = [];
    for (const s of [-1, 1]) {
      const cyl = new THREE.Group();
      cyl.position.set(s * COL.PAIR_X, 0, 0);
      m.add(cyl);
      const stator = craftMesh(pt.stator.geo, { scale: 1 }, mat);
      stator.rotation.z = s > 0 ? 0 : Math.PI / COL.BERTHS;
      cyl.add(stator);
      lampSets.push(addLamps(stator, pt.stator.lamps, { minPx: 1.2 }));
      const rotor = new THREE.Group();
      cyl.add(rotor);
      const hull = craftMesh((name === "L5" ? pt.rotor5 : pt.rotor).geo, { scale: 1 }, mat);
      rotor.add(hull);
      lampSets.push(addLamps(hull, (name === "L5" ? pt.rotor5 : pt.rotor).lamps, { minPx: 1.2 }));
      const win = new THREE.Mesh(pt.windows, winMat);
      win.frustumCulled = false; win.renderOrder = 3;
      bindWindow(win, this.sunDir);
      rotor.add(win);
      const hinges = WINDOW_CENTRES.map((a) => {
        const piv = new THREE.Group();
        const c = Math.cos(a), sn = Math.sin(a), r = COL.R + COL.MIRROR_OFF;
        piv.matrixAutoUpdate = false;
        piv.matrix.set(-sn, c, 0, c * r, c, sn, 0, sn * r, 0, 0, 1, -COL.HL, 0, 0, 0, 1);
        rotor.add(piv);
        const hinge = new THREE.Group();
        piv.add(hinge);
        const sheet = new THREE.Mesh(pt.mirror.sheet, this.mirMat);
        sheet.frustumCulled = false; sheet.renderOrder = 3;
        bindMirror(sheet, this.sunDir, rotor, winMat.uniforms.uDay);
        hinge.add(sheet, craftMesh(pt.mirror.back, { scale: 1 }, mat));
        return hinge;
      });
      const agri = COL.AGRI_Z.map((z, i) => {
        const g = new THREE.Group();
        g.position.z = z;
        const mesh = craftMesh(pt.agri.geo, { scale: 1 }, mat);
        g.add(mesh);
        lampSets.push(addLamps(mesh, pt.agri.lamps, { minPx: 1.2 }));
        cyl.add(g);
        return { g, dir: (i % 2 ? -1 : 1) * s, phase: i * 0.7 };
      });
      // rams (one buffer per pair: both twins open their mirrors together)
      const sleeve = instancedPart(hull, this.ramGeo.sleeve, RAMS), rod = instancedPart(hull, this.ramGeo.rod, RAMS);
      if (cyls.length) { sleeve.instanceMatrix = cyls[0].sleeve.instanceMatrix; rod.instanceMatrix = cyls[0].rod.instanceMatrix; }
      rotor.add(sleeve, rod);
      cyls.push({ s, cyl, rotor, hinges, agri, win, sleeve, rod });
    }
    // the approach: a gate ring of beacons 200 km out on the anti-sun side of each twin, and a
    // string of buoys down the corridor to the port (km, pair frame)
    const approach = this._approach(group.name, approachBeacons([-1, 1].map((s) => ({ c: V(s * COL.PAIR_X * KM, 0, -200), r: 6, size: 1.6, from: V(s * COL.PAIR_X * KM, 0, -28), to: V(s * COL.PAIR_X * KM, 0, -190) })), name === 'L4' ? LAMP.BLUE : LAMP.TEAL, mat), 215);
    space.scene.add(group);
    const P = { name, group, approach, m, mat, winMat, cyls, lampSets, chords, trussLine, trussMat, dayOffset, day: 1, alpha: COL.MIRROR_MAX, ramAlpha: -1, pos: new THREE.Vector3() };
    this._rams(P);
    P.body = space.addBody(group.name, [group], (o) => (o || _a).copy(P.pos), 50, { solid: true, minNear: 0.02 });
    return P;
  }

  /**
   * Point the pair's mirror rams at the mirrors' current opening: from the longeron crest
   * (pivot frame x = +-RAM_X, 535 m below the hinge line, 4 km along) to the mirror's edge
   * 10 km along the sheet. Rotor frame, metres; no allocation.
   */
  _rams(P) {
    const a = P.alpha, ca = Math.cos(a), sa = Math.sin(a);
    const S = P.cyls[0].sleeve, Rd = P.cyls[0].rod;
    let k = 0;
    for (const piv of this.ramPiv) for (const sx of [-1, 1]) {
      _a.set(sx * RAM_X, -535, 4000).applyMatrix4(piv);
      _b.set(sx * RAM_X, -5 * ca + 10000 * sa, 5 * sa + 10000 * ca).applyMatrix4(piv);
      spanMatrix(_m, _a, _b); Rd.setMatrixAt(k, _m);
      _c.lerpVectors(_a, _b, 0.55);
      spanMatrix(_m, _a, _c); S.setMatrixAt(k, _m);
      k++;
    }
    S.instanceMatrix.needsUpdate = true; Rd.instanceMatrix.needsUpdate = true;
    P.ramAlpha = a;
  }

  /** Lift cars up and down a wheel's spokes: eased runs with dwells at hub and rim (wheel frame, metres). */
  _lifts(w, t, wi) {
    const A = w.lifts.instanceMatrix.array, r0 = w.range[0], r1 = w.range[1];
    for (let k = 0; k < 4; k++) {
      const ph = ((t / 90 + k * 0.29 + wi * 0.13) % 1 + 1) % 1;
      // 0-0.15 dwell at the hub, run out, 0.5-0.65 dwell at the rim, run in
      const u = ph < 0.15 ? 0 : ph < 0.5 ? smooth(0.15, 0.5, ph) : ph < 0.65 ? 1 : 1 - smooth(0.65, 1, ph);
      const rc = r0 + (r1 - r0) * u, a = (k / 4) * TAU, c = Math.cos(a), s = Math.sin(a), o = k * 16;
      A[o] = -s; A[o + 1] = c; A[o + 2] = 0; A[o + 3] = 0;
      A[o + 4] = c; A[o + 5] = s; A[o + 6] = 0; A[o + 7] = 0;
      A[o + 8] = 0; A[o + 9] = 0; A[o + 10] = 1; A[o + 11] = 0;
      A[o + 12] = c * rc; A[o + 13] = s * rc; A[o + 14] = 0; A[o + 15] = 1;
    }
    w.lifts.instanceMatrix.needsUpdate = true;
  }

  // --------------------------------------------------------------- gateway --
  _gateway() {
    const space = this.space, pt = this.parts;
    const group = new THREE.Group();
    group.name = 'lagrange-L1';
    const m = new THREE.Group();
    m.scale.setScalar(KM);
    group.add(m);
    const mat = createDressedMaterial({ accent: [1.0, 0.8, 0.5], lit: 0.65, fill: 0.03, flood: 1, livery: [0.66, 0.64, 0.6], livery2: [0.56, 0.2, 0.14] });
    const hull = craftMesh(pt.gate.geo, { scale: 1 }, mat);
    m.add(hull);
    addLamps(hull, pt.gate.lamps, { minPx: 1.2 });
    const liftGeo = buildLiftCar();
    const wheels = GATE.WHEELS.map((w, i) => {
      const g = new THREE.Group();
      g.position.z = w.z;
      const mesh = craftMesh(pt.wheels[i].geo, { scale: 1 }, mat);
      g.add(mesh);
      addLamps(mesh, pt.wheels[i].lamps, { minPx: 1.2 });
      m.add(g);
      // lift cars on the four spokes, climbing between the hub and the rim
      const lifts = instancedPart(mesh, liftGeo, 4);
      g.add(lifts);
      return { g, spin: w.spin, lifts, range: liftRange(w) };
    });
    const approach = this._approach('lagrange-L1', approachBeacons([-1, 1].map((s) => ({ c: V(0, 0, s * 150), r: 2.2, size: 1, from: V(0, 0, s * 12), to: V(0, 0, s * 140) })), LAMP.AMBER, mat), 155);
    space.scene.add(group);
    const G = { name: 'L1', approach, group, m, mat, wheels, pos: new THREE.Vector3() };
    G.body = space.addBody('lagrange-L1', [group], (o) => (o || _a).copy(G.pos), 1.6, { solid: true, minNear: 0.005 });
    return G;
  }

  /** The approach beacons as their own top-level body (they reach far beyond the station's bound). */
  _approach(name, g, reach) {
    this.space.scene.add(g);
    this.space.addBody(`${name}-approach`, [g], (o) => (o || _a).copy(g.position), reach, { minNear: 0.02 });
    return g;
  }

  /** Ships berthed nose-in at every fourth gateway collar: lunar clippers at the Moon dock, Earth haulers at the other. */
  _gatewayBerthed(fam) {
    const hull = this.gateway.m.children[0];
    const by = new Map();
    this.gateway.berthed = [];
    this.parts.gate.berths.forEach((b, i) => {
      if (i % 4 !== 3) return;
      const d = (b.dir.z > 0 ? fam.clipper : fam.hauler)[i % 2];
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), b.dir.clone().negate());
      const p = b.p.clone().addScaledVector(b.dir, d.length * 0.55 + 6);
      if (!by.has(d)) by.set(d, []);
      by.get(d).push(new THREE.Matrix4().compose(p, q, V(1, 1, 1)));
      this.gateway.berthed.push({ d, p, dir: b.dir });
    });
    for (const [d, list] of by) {
      const im = instancedPart(hull, d.geo, list.length);
      list.forEach((m, j) => im.setMatrixAt(j, m));
      im.instanceMatrix.needsUpdate = true;
      this.gateway.m.add(im);
    }
  }

  // ----------------------------------------------------------------- lanes --
  _lanes() {
    const lamps = [];
    this.laneData = LANES.map(([from, to], li) => {
      const L = { from, to, buoy0: lamps.length, ship0: 0, A: new THREE.Vector3(), B: new THREE.Vector3(), C: new THREE.Vector3() };
      // lane marker beacons: real-sized (60 m of glow), so from afar they vanish instead of stringing
      // dotted arcs across the sky; a ship on the lane sees them flash as it passes
      for (let i = 0; i < LANE_BUOYS; i++) lamps.push({ p: new THREE.Vector3(), r: 0.06, color: i % 2 ? LAMP.AMBER : LAMP.BLUE, i: 4, phase: i / LANE_BUOYS, breathe: 0.9 });
      L.ship0 = lamps.length;
      for (let i = 0; i < LANE_SHIPS; i++) {
        const out = i % 2 === 0;
        lamps.push({ p: new THREE.Vector3(), r: 0.08, color: LAMP.WHITE, i: 3 });
        lamps.push({ p: new THREE.Vector3(), r: 0.2, color: out ? LAMP.BLUE : LAMP.AMBER, i: 6 });
      }
      L.seed = li * 0.137;
      return L;
    });
    // far markers: each colony's glint (two per pair) and the gateway
    this.mark0 = lamps.length;
    for (let i = 0; i < 5; i++) lamps.push({ p: new THREE.Vector3(), r: i < 4 ? 2 : 0.3, color: i < 4 ? [1.0, 0.95, 0.85] : LAMP.AMBER, i: i < 4 ? 100 : 200, breathe: 0.1, phase: i * 0.21 });
    this.nLaneLamps = lamps.length;
    this.lanes = new DynLamps(lamps, { minPx: 1.4 });
    this.lanes.mesh.renderOrder = 17;
    this.laneGroup = new THREE.Group();
    this.laneGroup.add(this.lanes.mesh);
    this.space.scene.add(this.laneGroup);
    this.laneRange = [1, 2];
    this._dmin = 0; this._dmax = 0;
    this._track = (i) => this._trackLamp(i);
    this.laneBody = this.space.addBody('lagrange-lanes', [this.laneGroup], null, 0, { interval: () => this.laneRange });
  }

  _end(sim, name, toward, out) {
    if (name === 'earth') return out.copy(toward).normalize().multiplyScalar(R_EARTH + GEO_ALT);
    if (name === 'moon') return out.copy(toward).sub(sim.moonPos).normalize().multiplyScalar(R_MOON + 2600).add(sim.moonPos);
    const P = name === 'L1' ? this.gateway : this.pairs[name === 'L4' ? 0 : 1];
    // lanes end at the approach gate on the anti-sun side (the colonies' ports) or off the gateway's docks
    if (name === 'L1') return out.copy(toward).sub(P.pos).normalize().multiplyScalar(300).add(P.pos);
    return out.copy(this.sunDir).multiplyScalar(-320).add(P.pos);
  }

  // ---------------------------------------------------------------- update --
  update(sim, t, dt, space) {
    const cam = space.camera;
    const cp = cam.position;
    orbitNormal(sim, _n);
    // pairs
    for (let i = 0; i < 2; i++) {
      const P = this.pairs[i];
      lagrangePoint(sim, P.name, P.pos);
      P.group.position.copy(P.pos);
      lagrangeFrame(sim, P.name, P.group.quaternion);
      P.approach.position.copy(P.pos); P.approach.quaternion.copy(P.group.quaternion);
      const d = cp.distanceTo(P.pos);
      P.m.visible = d < NEAR_KM;
      // the colony's day: mirrors open wide from dawn to dusk, nearly shut at night
      const ph = ((sim.t / 86400 + P.dayOffset) % 1 + 1) % 1;
      const day = smooth(0.2, 0.28, ph) * (1 - smooth(0.74, 0.82, ph));
      P.day = day;
      P.alpha = COL.MIRROR_MIN + (COL.MIRROR_MAX - COL.MIRROR_MIN) * day;
      P.winMat.uniforms.uDay.value = 0.02 + 0.98 * day;
      P.winMat.uniforms.uTime.value = t;
      P.mat.uniforms.uLit.value = 0.3 + 0.5 * (1 - day);
      // truss hand-over: geometry while its chords span a pixel or so, the thread beyond
      const tg = smooth(TRUSS_NEAR * 0.65, TRUSS_NEAR, d);
      P.chords.visible = d < TRUSS_NEAR;
      P.trussLine.visible = P.m.visible && tg > 0.001;
      if (P.trussLine.visible) {
        const U = P.trussMat.uniforms;
        U.uGainF.value = tg; U.uSunDir.value.copy(this.sunDir);
        if (space.size) U.uResolution.value.copy(space.size);
      }
      if (!P.m.visible) continue;
      const det = d < DETAIL_KM * 8;
      // the hull's lamps are for the near view: from tens of km they would dot the whole hull, so
      // they fade to a fifteenth (the windows and the cap terraces carry the colony's light there)
      const lg = 1 - 0.93 * smooth(10, 45, d);
      for (const ls of P.lampSets) if (ls) { ls.visible = det; ls.material.uniforms.uGain.value = lg; }
      if (Math.abs(P.alpha - P.ramAlpha) > 1e-7) this._rams(P);
      for (const C of P.cyls) {
        C.rotor.rotation.z = C.s * ((COL.SPIN * t) % TAU);
        for (const h of C.hinges) h.rotation.x = -P.alpha;
        for (const A of C.agri) A.g.rotation.z = A.dir * ((COL.AGRI_SPIN * t + A.phase) % TAU);
      }
    }
    // gateway
    const G = this.gateway;
    lagrangePoint(sim, 'L1', G.pos);
    G.group.position.copy(G.pos);
    lagrangeFrame(sim, 'L1', G.group.quaternion);
    G.approach.position.copy(G.pos); G.approach.quaternion.copy(G.group.quaternion);
    G.m.visible = cp.distanceTo(G.pos) < NEAR_KM * 0.4;
    for (let i = 0; i < G.wheels.length; i++) {
      const w = G.wheels[i];
      w.g.rotation.z = (w.spin * t) % TAU;
      if (G.m.visible) this._lifts(w, t, i);
    }
    this.pairs[0].group.updateMatrixWorld(true); this.pairs[1].group.updateMatrixWorld(true); G.group.updateMatrixWorld(true);
    this.pairs[0].approach.updateMatrixWorld(true); this.pairs[1].approach.updateMatrixWorld(true); G.approach.updateMatrixWorld(true);
    // near detail: built on the first close approach, shown while close
    this._near[0] = cp.distanceTo(this.pairs[0].pos) < LIFE_KM; this._near[1] = cp.distanceTo(this.pairs[1].pos) < LIFE_KM;
    if (!this.life.built && (this._near[0] || this._near[1])) this.life.build(this.families);
    this.life.update(t, cam, this._near);
    // local traffic
    for (const tr of this.traffic) tr.update(t, dt, cam);
    // long lanes
    const Ld = this.lanes;
    this._dmin = Infinity; this._dmax = 0;
    const track = this._track;
    for (const L of this.laneData) {
      const toPos = L.to === 'L1' ? G.pos : this.pairs[L.to === 'L4' ? 0 : 1].pos;
      const fromPos = L.from === 'earth' ? _d.set(0, 0, 0) : L.from === 'moon' ? sim.moonPos : G.pos;
      this._end(sim, L.from, _c.copy(toPos), L.A);
      this._end(sim, L.to, _c.copy(fromPos), L.B);
      // control point: bowed outward in the orbit plane, a transfer arc rather than a ruler line
      _a.subVectors(L.B, L.A);
      const len = _a.length();
      _b.crossVectors(_n, _a).normalize();
      L.C.addVectors(L.A, L.B).multiplyScalar(0.5).addScaledVector(_b, len * 0.08);
      for (let i = 0; i < LANE_BUOYS; i++) {
        const u = (i + 0.5) / LANE_BUOYS;
        this._bez(L, u, 0, _c);
        Ld.set(L.buoy0 + i, _c.x, _c.y, _c.z); track(L.buoy0 + i);
      }
      for (let i = 0; i < LANE_SHIPS; i++) {
        const out = i % 2 === 0;
        let u = ((t / LANE_T + L.seed + Math.floor(i / 2) / (LANE_SHIPS / 2)) % 1 + 1) % 1;
        if (!out) u = 1 - u;
        const side = out ? 1 : -1;
        this._bez(L, u, side * Math.min(len * 0.004, 900), _c);
        const vis = smooth(0, 0.04, out ? u : 1 - u) * (1 - smooth(0.96, 1, out ? u : 1 - u));
        this._bez(L, Math.min(Math.max(u + (out ? -1 : 1) * 0.0006, 0), 1), side * Math.min(len * 0.004, 900), _d);
        const k = L.ship0 + i * 2;
        Ld.set(k, _c.x, _c.y, _c.z); Ld.gain(k, vis); track(k);
        Ld.set(k + 1, _d.x, _d.y, _d.z); Ld.gain(k + 1, vis * (0.7 + 0.3 * Math.sin(t * 3.1 + i)));
      }
    }
    // far glints: each cylinder's mirrors (bright while open) and the gateway's beacon
    for (let i = 0; i < 2; i++) {
      const P = this.pairs[i];
      const d = cp.distanceTo(P.pos);
      const far = smooth(NEAR_KM * 0.1, NEAR_KM * 0.6, d);
      for (let s = 0; s < 2; s++) {
        const k = this.mark0 + i * 2 + s;
        _c.set((s ? 1 : -1) * COL.PAIR_X * KM, 0, 0).applyQuaternion(P.group.quaternion).add(P.pos);
        Ld.set(k, _c.x, _c.y, _c.z); track(k);
        Ld.gain(k, far * Math.min(1, d / 200000) * (0.35 + 0.65 * P.day));
      }
    }
    {
      const k = this.mark0 + 4;
      Ld.set(k, G.pos.x, G.pos.y, G.pos.z); track(k);
      const dg = cp.distanceTo(G.pos);
      Ld.gain(k, smooth(DETAIL_KM, DETAIL_KM * 6, dg) * Math.min(1, dg / 150000));
    }
    Ld.commit();
    this.laneRange[0] = Math.max(this._dmin - 2, 0.01);
    this.laneRange[1] = Math.max(this._dmax + 2, this.laneRange[0] * 1.01);
  }

  /** Widen the lanes' depth interval to take in lamp i. */
  _trackLamp(i) {
    const a = this.lanes.L.array, cp = this.space.camera.position;
    const dd = Math.hypot(a[i * 4] - cp.x, a[i * 4 + 1] - cp.y, a[i * 4 + 2] - cp.z);
    if (dd < this._dmin) this._dmin = dd;
    if (dd > this._dmax) this._dmax = dd;
  }

  /** Point on a lane's arc at u, pushed sideways (km) off the centre line. */
  _bez(L, u, off, out) {
    const a = 1 - u;
    out.copy(L.A).multiplyScalar(a * a).addScaledVector(L.C, 2 * a * u).addScaledVector(L.B, u * u);
    if (off) {
      _x.subVectors(L.B, L.A);
      _y.crossVectors(_n, _x).normalize();
      out.addScaledVector(_y, off);
    }
    return out;
  }

  /** Triangles drawn per pair, per gateway, by the lanes (for the verifier). */
  triangles() {
    const tri = (g) => g.index.count / 3;
    const pt = this.parts;
    const cyl = tri(pt.rotor.geo) + tri(pt.windows) + 3 * (tri(pt.mirror.sheet) + tri(pt.mirror.back)) + tri(pt.stator.geo) + 3 * tri(pt.agri.geo);
    const pair = 2 * cyl + tri(pt.frame.geo);
    const gate = tri(pt.gate.geo) + pt.wheels.reduce((s, w) => s + tri(w.geo), 0);
    const unique = tri(pt.rotor.geo) + tri(pt.rotor5.geo) + tri(pt.windows) + tri(pt.mirror.sheet) + tri(pt.mirror.back) + tri(pt.stator.geo) + tri(pt.agri.geo) + tri(pt.frame.geo) + gate;
    let traffic = 0;
    for (const st of this.traffic) for (const s of st.sets) traffic += (s.design.geo.index.count / 3) * s.n;
    const life = this.life.triangles();
    return { pair, gate, unique, traffic, life, total: 2 * pair + gate + traffic + life };
  }
}
