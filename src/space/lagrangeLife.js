import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { LAMP } from './lamps.js';
import { DynLamps, instancedPart } from './lifeKit.js';
import { rng, V } from './shipKit.js';
import { COL } from './lagrangeColony.js';

// THE LAGRANGE COLONIES AT WORK: near detail, built the first time the camera comes within a
// few hundred kilometres of a pair, then shown only while it is close.
//
//   trams      trains on both tracks of every longeron crest, 32 km end to end in ~5 min,
//              their lit cars and head/tail lamps turning with the cylinder
//   fittings   the people-scale furniture of the outer hull: airlock cabins with lit ports
//              and lantern roofs, vent stacks, whip masts, cable reels, maintenance crawlers
//              creeping along the hoops (they move)
//   docks      ships berthed nose-in at the spaceport's idle collars, a jib crane at every
//              berth swinging cargo between ship and arm, cargo pods on the arms
//   transit    cars running the glazed tubes in the twin-tying trusses
//
// All instance data is in the owning frame (rotor or stator metres) and is the same for every
// cylinder, so each instanced mesh shares one matrix buffer across the four cylinders.

const TAU = Math.PI * 2;
const TRAM_V = 110;              // m/s
const TRAMS_PER_TRACK = 2;
const CRAWLERS = 60;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();

/** A five-car train (metres, +Z forward, +Y up off the track). */
function tramGeo() {
  const B = new CB();
  for (let i = 0; i < 5; i++) {
    const z = -80 + i * 40;
    B.box(0, 5, z, 10, 8, 36, CK.GLASS);
    B.box(0, 9.6, z, 10.6, 1.4, 37, CK.BRONZE);
    B.box(0, 0.6, z, 8, 1.2, 30, CK.DARK);
  }
  B.box(0, 5, 102, 9, 6, 6, CK.LANTERN);
  return B.geometry();
}

/** A hull fitting by type (metres, +Y up off the hull). */
function fittingGeo(type) {
  const B = new CB();
  if (type === 0) {
    // airlock cabin: a lit room, a lantern roof, a porch with its door
    B.box(0, 5, 0, 14, 10, 20, CK.GLASS);
    B.box(0, 10.8, 0, 15, 1.6, 21, CK.LANTERN);
    B.box(0, 3, 12, 6, 6, 4, CK.HULL);
    B.box(0, 3, 14.1, 3, 4.4, 0.4, CK.DARK);
  } else if (type === 1) {
    // vent stacks in a row
    for (let i = 0; i < 3; i++) { B.at(0, 0, (i - 1) * 9); B.lathe([[3.2, 0, CK.HULL], [3.2, 12, CK.HULL], [3.8, 12.5, CK.BRONZE], [3.8, 14, CK.DARK], [0.1, 14, CK.DARK]], 10); B.pop(); }
    B.box(0, 1, 0, 9, 2, 28, CK.DECK);
  } else if (type === 2) {
    // whip mast with a lantern tip and guy struts
    B.lathe([[1.2, 0, CK.DARK], [0.6, 38, CK.DARK], [1.4, 39, CK.LANTERN], [0.1, 41, CK.LANTERN]], 6);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; B.tube([V(Math.cos(a) * 9, 0, Math.sin(a) * 9), V(0, 16, 0)], 0.3, 4, CK.BRONZE); }
  } else {
    // cable reel and winch house
    B.push(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    B.lathe([[6, -4, CK.BRONZE], [6, 4, CK.BRONZE], [3, 4, CK.DARK], [3, -4, CK.DARK]].concat([[6, -4, CK.BRONZE]]), 14, 0, { closedProfile: true });
    B.pop();
    B.box(0, 3.5, 9, 10, 7, 8, CK.HULL);
  }
  return B.geometry();
}

/** A maintenance crawler (walks the hoop crests): a tracked body, a crane arm, work lamp. */
function crawlerGeo() {
  const B = new CB();
  B.box(0, 2, 0, 7, 3, 12, CK.HULL);
  for (const s of [-1, 1]) B.box(s * 3.8, 1, 0, 1.4, 2, 13, CK.DARK);
  B.box(0, 4.5, 3, 4, 2.5, 4, CK.GLASS);
  B.tube([V(0, 3.5, -3), V(0, 9, -1), V(0, 8, 5)], 0.4, 5, CK.BRONZE);
  return B.geometry();
}

/** A berth jib crane: mast off the arm, a slewing jib with a hook block (metres, mast along +Y). */
function craneGeo() {
  const mast = new CB();
  mast.box(0, 45, 0, 8, 90, 8, CK.DARK);
  for (let y = 10; y < 90; y += 12) mast.box(0, y, 0, 9, 1, 9, CK.BRONZE);
  mast.box(0, 92, 0, 14, 6, 14, CK.HULL);
  const jib = new CB();
  jib.box(0, 0, 45, 5, 6, 110, CK.BRONZE);
  jib.box(0, 0, -18, 7, 8, 20, CK.HULL);
  jib.box(0, 5, 0, 6, 6, 8, CK.GLASS);                 // the cab
  jib.tube([V(0, -3, 92), V(0, -38, 92)], 0.25, 4, CK.DARK);
  jib.box(0, -40, 92, 12, 5, 16, CK.HULL);             // a cargo pod on the hook
  return { mast: mast.geometry(), jib: jib.geometry() };
}

export class LagrangeLife {
  constructor(lag) {
    this.lag = lag;
    this.built = false;
    this.buildMs = 0;
  }

  /** Build everything once (on first approach). */
  build(families) {
    if (this.built) return;
    const t0 = performance.now();
    this.built = true;
    const lag = this.lag;
    const r = rng(417);
    const { R, HL } = COL;
    // ---- trams: two tracks on every longeron crest
    this.tramGeo = tramGeo();
    this.trams = [];
    for (let e = 0; e < 6; e++) for (const side of [-1, 1]) for (let k = 0; k < TRAMS_PER_TRACK; k++) {
      this.trams.push({ a: Math.PI / 6 + (e * TAU) / 6, side, phase: (k / TRAMS_PER_TRACK + e * 0.113 + (side > 0 ? 0.37 : 0)) % 1 });
    }
    const nT = this.trams.length;
    // ---- fittings: scattered on the land strips' tiles, clear of hoops (every 1000 m from -15500)
    this.fitGeos = [0, 1, 2, 3].map(fittingGeo);
    const fits = [[], [], [], []];
    for (let s = 0; s < 3; s++) {
      const c = (s * TAU) / 3;
      for (let i = 0; i < 900; i++) {
        const type = i % 7 === 0 ? 2 : i % 5 === 0 ? 3 : i % 3 === 0 ? 1 : 0;
        const a = c + (r() - 0.5) * (Math.PI / 3 - 0.08);
        let z = -HL + 700 + r() * (2 * HL - 1400);
        const dz = ((z + HL - 500) % 1000 + 1000) % 1000;
        if (dz < 60 || dz > 940) z += 120;
        const lift = 15 + r() * 3;                       // on the tiles (up to 16 m)
        _p.set(Math.cos(a) * (R + lift), Math.sin(a) * (R + lift), z);
        _e.set(0, 0, a - Math.PI / 2); _q.setFromEuler(_e);
        _q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.floor(r() * 4) * Math.PI / 2));
        fits[type].push(new THREE.Matrix4().compose(_p, _q, _s));
      }
    }
    this.fitMats = fits;
    // ---- crawlers on the hoop crests
    this.crawlGeo = crawlerGeo();
    this.crawlers = [];
    for (let i = 0; i < CRAWLERS; i++) this.crawlers.push({ strip: i % 3, hoop: Math.floor(r() * 32), u: r(), v: (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.6) });
    // ---- docks: idle berths get a berthed ship; every berth gets a crane
    const berths = lag.parts.stator.berths;
    const fam = families;
    const pool = [fam.hauler, fam.tanker, fam.barge, fam.packet, fam.clipper].flat();
    const docked = new Map();
    berths.forEach((b, i) => {
      if (i % 2 === 0) return;                           // even berths serve the lane traffic
      const d = pool[(i * 5 + 3) % pool.length];
      const sc = 1.4;
      const m = new THREE.Matrix4().compose(V(b.p.x, b.p.y, b.p.z - (d.length * 0.55 + 14) * sc), _q.setFromAxisAngle(V(0, 0, 1), b.a), new THREE.Vector3(sc, sc, sc));
      if (!docked.has(d)) docked.set(d, []);
      docked.get(d).push(m);
    });
    this.docked = docked;
    this.crane = craneGeo();
    this.cranes = berths.map((b, i) => ({ b, phase: i * 1.37, rate: 0.05 + (i % 3) * 0.02 }));
    // ---- attach to every cylinder (shared matrix buffers)
    this.shared = { trams: null, fits: [], crawl: null, jib: null, mast: null, docked: [] };
    this.tramLamps = new DynLamps(Array.from({ length: nT * 2 }, (_, i) => ({ p: new THREE.Vector3(), r: 5, color: i % 2 ? LAMP.RED : LAMP.WHITE, i: i % 2 ? 2.4 : 3.2 })), { minPx: 1.0 });
    this.crawlLamps = new DynLamps(Array.from({ length: CRAWLERS }, () => ({ p: new THREE.Vector3(), r: 3, color: LAMP.AMBER, i: 3, breathe: 0.9 })), { minPx: 1.0 });
    this.groups = [];
    for (const P of lag.pairs) {
      const g = { pair: P, parts: [] };
      for (const C of P.cyls) {
        const hull = C.rotor.children[0];
        const stator = C.cyl.children[0];
        const tram = this._share(instancedPart(hull, this.tramGeo, nT), 'trams');
        C.rotor.add(tram);
        g.parts.push(tram);
        fits.forEach((list, k) => {
          const im = this._shareList(instancedPart(hull, this.fitGeos[k], list.length), k, list);
          C.rotor.add(im); g.parts.push(im);
        });
        const cr = this._share(instancedPart(hull, this.crawlGeo, CRAWLERS), 'crawl');
        C.rotor.add(cr); g.parts.push(cr);
        for (const src of [this.tramLamps.mesh, this.crawlLamps.mesh]) {
          const lm = new THREE.Mesh(src.geometry, src.material);
          lm.frustumCulled = false; lm.renderOrder = 17;
          C.rotor.add(lm); g.parts.push(lm);
        }
        // the dock side, in the stator's frame
        let di = 0;
        for (const [d, list] of docked) {
          const im = instancedPart(stator, d.geo, list.length);
          if (!this.shared.docked[di]) { list.forEach((m, j) => im.setMatrixAt(j, m)); im.instanceMatrix.needsUpdate = true; this.shared.docked[di] = im.instanceMatrix; }
          else im.instanceMatrix = this.shared.docked[di];
          di++;
          stator.add(im); g.parts.push(im);
        }
        const mast = this._share(instancedPart(stator, this.crane.mast, berths.length), 'mast');
        const jib = this._share(instancedPart(stator, this.crane.jib, berths.length), 'jib');
        stator.add(mast, jib); g.parts.push(mast, jib);
      }
      // transit cars in the truss tubes (pair frame, metres)
      const cars = [];
      for (let k = 0; k < 2; k++) for (let i = 0; i < 6; i++) cars.push({ z: COL.TRUSS_Z[k], phase: i / 6 + k * 0.08, dir: i % 2 ? 1 : -1 });
      g.cars = cars;
      g.carLamps = new DynLamps(cars.flatMap(() => [{ p: new THREE.Vector3(), r: 22, color: LAMP.WHITE, i: 3 }, { p: new THREE.Vector3(), r: 16, color: LAMP.TEAL, i: 2.4 }]), { minPx: 1.0 });
      g.carLamps.mesh.renderOrder = 17;
      P.m.add(g.carLamps.mesh);
      g.parts.push(g.carLamps.mesh);
      this.groups.push(g);
    }
    // cranes' masts are fixed: write them once
    const mastIm = this.shared.mast;
    this.cranes.forEach((c, i) => {
      _q.setFromUnitVectors(V(0, 1, 0), V(0, 0, -1));
      _p.set(Math.cos(c.b.a) * (COL.BERTH_R - 220), Math.sin(c.b.a) * (COL.BERTH_R - 220), COL.PORT_Z - 20);
      _m.compose(_p, _q, _s);
      c.base = _p.clone();
      const arr = mastIm.array;
      _m.toArray(arr, i * 16);
    });
    mastIm.needsUpdate = true;
    this.buildMs = performance.now() - t0;
  }

  _share(im, key) {
    if (!this.shared[key]) { im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.shared[key] = im.instanceMatrix; }
    else im.instanceMatrix = this.shared[key];
    return im;
  }

  _shareList(im, k, list) {
    if (!this.shared.fits[k]) { list.forEach((m, j) => im.setMatrixAt(j, m)); im.instanceMatrix.needsUpdate = true; this.shared.fits[k] = im.instanceMatrix; }
    else im.instanceMatrix = this.shared.fits[k];
    return im;
  }

  /** Show the pair's near detail when close; animate what moves. */
  update(t, cam, near) {
    if (!this.built) return;
    let any = false;
    for (let i = 0; i < this.groups.length; i++) {
      const g = this.groups[i];
      const on = near[i];
      for (const p of g.parts) p.visible = on;
      any = any || on;
      if (!on) continue;
      // transit cars across the twins' trusses
      const x0 = -COL.PAIR_X + COL.SPINDLE_A + 60, x1 = -x0;
      for (let k = 0; k < g.cars.length; k++) {
        const c = g.cars[k];
        const u = ((t * 90 / (x1 - x0) * c.dir + c.phase) % 1 + 1) % 1;
        const x = x0 + (x1 - x0) * u;
        g.carLamps.set(k * 2, x, 0, c.z);
        g.carLamps.set(k * 2 + 1, x - c.dir * 60, 0, c.z);
      }
      g.carLamps.commit();
    }
    if (!any) return;
    const { R, HL } = COL;
    // trams (rotor frame): along the crest at R + 154, on either side of the conduit
    const TA = this.shared.trams.array, TL = this.tramLamps;
    const span = 2 * HL - 1200;
    for (let i = 0; i < this.trams.length; i++) {
      const tr = this.trams[i];
      const u = ((tr.phase + (t * TRAM_V) / (2 * span)) % 1 + 1) % 1;
      // out along one track and back on the other: the train is always moving
      const fwd = tr.side;
      const z = -span / 2 + span * (fwd > 0 ? u : 1 - u);
      const c = Math.cos(tr.a), s = Math.sin(tr.a);
      const rr = R + 140;                                // on the girder's top, beside the conduit
      const off = tr.side * 42;
      _p.set(c * rr - s * off, s * rr + c * off, z);
      _e.set(0, 0, tr.a - Math.PI / 2); _q.setFromEuler(_e);
      if (fwd < 0) _q.multiply(_qFlip);
      _m.compose(_p, _q, _s).toArray(TA, i * 16);
      TL.set(i * 2, _p.x, _p.y, z + fwd * 106);
      TL.set(i * 2 + 1, _p.x, _p.y, z - fwd * 86);
    }
    this.shared.trams.needsUpdate = true;
    TL.commit();
    // crawlers along their hoops (rotor frame)
    const CA = this.shared.crawl.array, CL = this.crawlLamps;
    for (let i = 0; i < this.crawlers.length; i++) {
      const cw = this.crawlers[i];
      const a = (cw.strip * TAU) / 3 + (Math.sin(t * 0.004 * cw.v + cw.u * TAU) * 0.46) * (Math.PI / 6);
      const z = -HL + 500 + cw.hoop * 1000;
      const rr = R + 43;
      _p.set(Math.cos(a) * rr, Math.sin(a) * rr, z);
      _e.set(0, 0, a - Math.PI / 2); _q.setFromEuler(_e);
      _q.multiply(_qTurn);
      _m.compose(_p, _q, _s).toArray(CA, i * 16);
      CL.set(i, Math.cos(a) * (rr + 11), Math.sin(a) * (rr + 11), z);
    }
    this.shared.crawl.needsUpdate = true;
    CL.commit();
    // cranes slewing (stator frame)
    const JA = this.shared.jib.array;
    for (let i = 0; i < this.cranes.length; i++) {
      const c = this.cranes[i];
      // jib +Z slews about the mast (stator -z is the crane's up); written as a basis
      const sw = Math.sin(t * c.rate + c.phase) * 0.6;
      const dx = Math.cos(c.b.a + sw), dy = Math.sin(c.b.a + sw);
      const o = i * 16;
      JA[o] = dy; JA[o + 1] = -dx; JA[o + 2] = 0; JA[o + 3] = 0;
      JA[o + 4] = 0; JA[o + 5] = 0; JA[o + 6] = -1; JA[o + 7] = 0;
      JA[o + 8] = dx; JA[o + 9] = dy; JA[o + 10] = 0; JA[o + 11] = 0;
      JA[o + 12] = c.base.x; JA[o + 13] = c.base.y; JA[o + 14] = c.base.z - 95; JA[o + 15] = 1;
    }
    this.shared.jib.needsUpdate = true;
  }

  triangles() {
    if (!this.built) return 0;
    const tri = (g) => g.index.count / 3;
    let n = tri(this.tramGeo) * this.trams.length + tri(this.crawlGeo) * CRAWLERS + (tri(this.crane.mast) + tri(this.crane.jib)) * this.cranes.length;
    this.fitMats.forEach((l, k) => { n += tri(this.fitGeos[k]) * l.length; });
    for (const [d, l] of this.docked) n += tri(d.geo) * l.length;
    return n * 4;
  }
}

const _qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _qTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
