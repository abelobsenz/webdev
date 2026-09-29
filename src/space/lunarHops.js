import * as THREE from 'three';
import { lunarInstanced, createLunarMaterial } from './lunarMaterial.js';
import { createLamps, LAMP } from './lamps.js';
import { kit } from './lunarKit.js';
import { TOWNS } from './moonBake.js';
import { townDir, hopPad } from './lunarOutposts.js';
import { HOP_SPOTS } from './lunarWorks.js';
import { stationFrame } from './stations.js';
import { R_MOON } from './sim.js';

// Hoppers: the Moon's own air traffic. Crew landers fly ballistic hops between Medii Landing
// and the outposts (lunarOutposts.js), hub and spoke: a 45 degree climb-out burn, a coast on
// a lunar-gravity arc (range r needs sqrt(g r) and takes sqrt(2 r / g), its apex a quarter of
// the range), a braking burn, three minutes on the pad, and away again. Seen from orbit they
// are moving points: a white strobe, and the plume's amber flare while they burn.
//
// Moon frame, km (the parent is the Moon's group); the craft themselves are the kit's lander,
// instanced in metres about the Moon's centre.

const G = 1.62e-3;                     // km/s^2
const DWELL = 180;                     // s on the pad between hops
const BURN = 55;                       // s of engine at each end of a hop
const N = 10;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
const _m = new THREE.Matrix4();
const HS = { from: 0, to: 0, f: 0, burn: 0, ground: true, leg: null };
const S2 = Math.SQRT1_2;

/** Moon-frame unit vector of a point x, z (metres) in the site frame of the settlement at `up`. */
function siteDir(up, x, z) {
  const q = stationFrame(up);
  return new THREE.Vector3(x, 0, z).multiplyScalar(0.001).applyQuaternion(q).addScaledVector(up, R_MOON).normalize();
}

/** Flight time (s) and apex (km) of a hop through central angle ang (rad). */
export function hopShape(ang) {
  const range = Math.max(ang * R_MOON, 1);
  return { T: Math.sqrt(2 * range / G), H: range / 4 };
}

export class LunarHops {
  constructor(parent) {
    this.dirs = TOWNS.map(([la, lo]) => townDir(la, lo));
    // where each hopper sets down: its own spot on Medii's hop field (lunarWorks.js), one of the
    // three spots on an outpost's hop pad (lunarOutposts.js)
    const end = (site, k) => {
      if (site === 0) { const [u, v] = HOP_SPOTS[k % HOP_SPOTS.length]; return siteDir(this.dirs[0], (u - v) * S2, (u + v) * S2); }
      const hp = hopPad(site - 1 + 101, TOWNS[site][2]);
      const [x, z] = hp.spots[k % 3];
      return siteDir(this.dirs[site], x, z);
    };
    // each hopper's round: out from Medii to one outpost and back, then to another
    this.routes = [];
    for (let i = 0; i < N; i++) {
      const legs = [];
      const a = 1 + (i * 3) % (TOWNS.length - 1), b = 1 + (i * 5 + 2) % (TOWNS.length - 1);
      for (const [from, to] of [[0, a], [a, 0], [0, b], [b, 0]]) {
        const A = end(from, i), Bd = end(to, i);
        const ang = A.angleTo(Bd);
        const { T, H } = hopShape(ang);
        legs.push({ from, to, A, B: Bd, ang, T, H });
      }
      const cycle = legs.reduce((s, l) => s + l.T + DWELL, 0);
      this.routes.push({ legs, cycle, phase: i * 0.61803 * cycle });
    }
    this.mat = createLunarMaterial({ lit: 0.85 });
    this.craft = lunarInstanced(kit('lander'), N, {}, this.mat);
    this.craft.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.craft.name = 'Hoppers';
    parent.add(this.craft);
    // two lamps each: the strobe, and the plume while burning
    const lamps = [];
    for (let i = 0; i < N; i++) {
      lamps.push({ p: new THREE.Vector3(), r: 0.004, color: LAMP.WHITE, i: 1.4, breathe: 0.9, phase: (i * 0.37) % 1 });
      lamps.push({ p: new THREE.Vector3(), r: 0.03, color: [1.0, 0.62, 0.3], i: 0 });
    }
    this.lamps = createLamps(lamps, { minPx: 1.3 });
    this.lamps.name = 'Hopper lights';
    parent.add(this.lamps);
    this.iLamp = this.lamps.geometry.getAttribute('iLamp');
    this.iCol = this.lamps.geometry.getAttribute('iCol');
    this.craft.frustumCulled = false;
    this.update(0);
  }

  /** State of hopper k at time t (shared scratch object). */
  state(k, t) {
    const R = this.routes[k];
    let q = (((t + R.phase) % R.cycle) + R.cycle) % R.cycle;
    for (let i = 0; i < R.legs.length; i++) {
      const l = R.legs[i];
      if (q < DWELL) { HS.from = l.from; HS.to = l.to; HS.f = 0; HS.burn = q > DWELL - 8 ? (q - DWELL + 8) / 8 : 0; HS.ground = true; HS.leg = l; return HS; }
      q -= DWELL;
      if (q < l.T) {
        HS.from = l.from; HS.to = l.to; HS.f = q / l.T; HS.ground = false; HS.leg = l;
        HS.burn = q < BURN ? 1 : q > l.T - BURN ? 1 : 0;
        return HS;
      }
      q -= l.T;
    }
    HS.f = 0; HS.ground = true; HS.burn = 0; HS.leg = R.legs[0];
    return HS;
  }

  /** Position (Moon frame, km) of a hop at fraction f, and its radial up. */
  arc(leg, f, out, up) {
    const a = leg.A, b = leg.B;
    const s = Math.sin(leg.ang);
    if (s < 1e-6) up.copy(a);
    else up.copy(a).multiplyScalar(Math.sin((1 - f) * leg.ang) / s).addScaledVector(b, Math.sin(f * leg.ang) / s).normalize();
    const h = 4 * leg.H * f * (1 - f);
    return out.copy(up).multiplyScalar(R_MOON + 0.0009 + h);   // (the pads' tops stand 0.9 m proud of the sphere)
  }

  update(t) {
    const L = this.iLamp.array, C = this.iCol.array;
    for (let k = 0; k < N; k++) {
      const st = this.state(k, t);
      const leg = st.leg;
      this.arc(leg, st.f, _p, _n);
      // heading: toward the destination along the surface; craft upright on the local vertical
      this.arc(leg, Math.min(st.f + 0.01, 1), _f, _r);
      _f.sub(_p);
      _f.addScaledVector(_n, -_f.dot(_n));
      if (_f.lengthSq() < 1e-12) _f.set(0, 0, 1).addScaledVector(_n, -_n.z);
      _f.normalize();
      _a.crossVectors(_n, _f).normalize();
      _f.crossVectors(_a, _n);
      _m.makeBasis(_a, _n, _f);
      _m.setPosition(_p.x * 1000, _p.y * 1000, _p.z * 1000);
      this.craft.setMatrixAt(k, _m);
      // lamps: strobe on the cabin, plume below the stage
      const o = k * 8;
      L[o] = _p.x + _n.x * 0.016; L[o + 1] = _p.y + _n.y * 0.016; L[o + 2] = _p.z + _n.z * 0.016;
      L[o + 4] = _p.x - _n.x * 0.006; L[o + 5] = _p.y - _n.y * 0.006; L[o + 6] = _p.z - _n.z * 0.006;
      const burn = st.burn * (0.85 + 0.15 * Math.sin(t * 31 + k));
      C[o + 4] = 1.0 * 3.0 * burn; C[o + 5] = 0.62 * 3.0 * burn; C[o + 6] = 0.3 * 3.0 * burn;
      L[o + 7] = 0.012 + 0.03 * st.burn;
    }
    this.craft.instanceMatrix.needsUpdate = true;
    this.iLamp.needsUpdate = true;
    this.iCol.needsUpdate = true;
  }
}
