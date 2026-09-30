// Headless flight tests for the Lodestar's landing mechanics and autopilot (src/space/shipPilot.js,
// shipContact.js, autopilot.js). Runs the real physics core (ShipPilot.tick) at a fixed step
// against a stand-in space: the Earth's rotating frame, the Moon (flat, or with a fake 10-degree
// slope through moonGround), stub ports (a spinning wheel's hub dock at geostationary altitude, a
// dock on a station in low orbit, pads on the Moon) and checks that every flight ends docked or
// landed, gently, square, in time, without touching a body or producing a NaN.
//
//   node tools/verify-autopilot.mjs            (from the repo root; exits 1 on any failure)
//   node tools/verify-autopilot.mjs moon-far   (only the scenarios whose name contains the word)

import * as THREE from 'three';
import { ShipPilot } from '../src/space/shipPilot.js';
import { R_EARTH, R_MOON } from '../src/space/sim.js';
import { FEET_CENTRE, STROKE } from '../src/space/shipContact.js';
import { LODESTAR_FEET } from '../src/space/starship.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const OMEGA_E = 7.2921159e-5, GM_E = 398600.4, DEG = Math.PI / 180, KM = 0.001;
const only = process.argv[2] || '';

// ------------------------------------------------------------------ the stand-in space --
function makeSpace() {
  const scene = new THREE.Scene();
  const earthFixed = new THREE.Group(); scene.add(earthFixed);
  const sim = {
    time: 0, theta: 0, earthQuat: new THREE.Quaternion(), moonPos: V(384400, 0, 0), moonQuat: new THREE.Quaternion(),
    sunPos: V(-1.496e8, 0, 0), hearthPos: V(0, 0, -4.0e8), sunDir: V(-1, 0, 0), warp: 1, paused: false,
  };
  const space = { scene, earthFixed, sim, targets: {}, hud: { selected: null }, app: {}, mode: 'space', _ports: [] };
  space.advance = (dt) => {
    sim.time += dt; sim.theta = OMEGA_E * sim.time;
    sim.earthQuat.setFromAxisAngle(V(0, 1, 0), sim.theta);
    sim.moonQuat.setFromAxisAngle(V(0, 1, 0), 2.6617e-6 * sim.time);
  };
  return space;
}

// a wheel at geostationary altitude, fixed over the Earth, spinning about its axis; the hub dock
// faces along its axis (earth-fixed +Z, along the arc)
function addWheel(space) {
  const C0 = V(42164, 0, 0), ax0 = V(0, 0, 1), SPIN = 0.12, R = 0.4;
  const C = (o) => o.copy(C0).applyQuaternion(space.sim.earthQuat);
  space.targets.wheel = { name: 'Wheel', position: C, minDist: R * 1.1 };
  const port = {
    id: 'wheel:hub', target: 'wheel', label: 'Wheel - hub dock', kind: 'dock', clear: 0.03, approach: 0.3,
    pose(sp, out) {
      const q = sp.sim.earthQuat, n = ax0.clone().applyQuaternion(q);
      out.pos = C(out.pos || V()).addScaledVector(n, 0.06);
      out.n = (out.n || V()).copy(n);
      const f0 = V(1, 0, 0).applyAxisAngle(ax0, SPIN * sp.sim.time).applyQuaternion(q);
      out.fwd = (out.fwd || V()).copy(f0);
      return out;
    },
  };
  space._ports.push(port);
  return { port, C, n: () => ax0.clone().applyQuaternion(space.sim.earthQuat), R };
}

// a station in a circular, inclined low orbit (inertial): a zenith dock
function addLeo(space) {
  const r = R_EARTH + 400, w = Math.sqrt(GM_E / r ** 3), tilt = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.5);
  const C = (o, t = space.sim.time) => o.set(r * Math.cos(w * t), 0, -r * Math.sin(w * t)).applyQuaternion(tilt);
  space.targets.leo = { name: 'Low station', position: (o) => C(o), minDist: 0.12 };
  const port = {
    id: 'leo:zenith', target: 'leo', label: 'Low station - zenith dock', kind: 'dock', clear: 0.03, approach: 0.25,
    pose(sp, out) {
      const P = C(V()), n = P.clone().normalize();
      out.pos = (out.pos || V()).copy(P).addScaledVector(n, 0.05);
      out.n = (out.n || V()).copy(n);
      const along = C(V(), sp.sim.time + 1).sub(P); along.addScaledVector(n, -along.dot(n)).normalize();
      out.fwd = (out.fwd || V()).copy(along);
      return out;
    },
  };
  space._ports.push(port);
  return { port, C, R: 0.1 };
}

// a pad on the Moon (body direction d, its deck `raise` km proud of the ground there)
function addMoonPad(space, name, d, raise, ground) {
  d = d.clone().normalize();
  const g = ground(d, { normal: V() });
  const Pb = d.clone().multiplyScalar(R_MOON + g.h), nb = g.normal.clone();
  Pb.addScaledVector(nb, raise);
  const toW = (p) => p.clone().applyQuaternion(space.sim.moonQuat).add(space.sim.moonPos);
  space.targets[name] = { name, position: (o) => o.copy(toW(Pb)), minDist: 0.08 };
  const fb = V(0, 1, 0).cross(nb).normalize();
  const port = {
    id: `${name}:pad`, target: name, label: `${name} - pad`, kind: 'pad', clear: 0.025, approach: 0.3,
    pose(sp, out) {
      out.pos = (out.pos || V()).copy(toW(Pb));
      out.n = (out.n || V()).copy(nb).applyQuaternion(sp.sim.moonQuat);
      out.fwd = (out.fwd || V()).copy(fb).applyQuaternion(sp.sim.moonQuat);
      return out;
    },
  };
  space._ports.push(port);
  return { port, Pb, nb };
}

// moonGround stand-ins: flat, and flat with a 10-degree tilted plane round direction d1
const flatGround = (dir, out = {}) => { out.h = 0; out.water = false; out.normal = (out.normal || V()).copy(dir); return out; };
function slopeGround(d1, deg) {
  d1 = d1.clone().normalize();
  const axis = V(0, 1, 0).cross(d1).normalize();
  const N = d1.clone().applyAxisAngle(axis, deg * DEG), G0 = d1.clone().multiplyScalar(R_MOON), k = G0.dot(N);
  return (dir, out = {}) => {
    const ang = Math.acos(Math.min(1, dir.dot(d1)));
    const w = 1 - Math.min(1, Math.max(0, (ang - 0.25 * DEG) / (0.35 * DEG)));
    const hp = k / dir.dot(N) - R_MOON;
    out.h = hp * w; out.water = false;
    out.normal = (out.normal || V()).copy(w >= 1 ? N : dir);
    return out;
  };
}

// ------------------------------------------------------------------------ the pilot --
function makePilot(space, ground) {
  const p = new ShipPilot(space);
  p.ship = { root: new THREE.Group(), state: { legs: 0 }, update() {} };
  space.scene.add(p.ship.root);
  p.contact.ground = ground || flatGround;
  p.msgs = [];
  p._flash = (m) => { p.msgs.push(`${p.time.toFixed(1)}s ${m}`); };
  p._syncFrames(0);
  return p;
}
function place(p, Pw, Qw) {
  p.space.scene.attach(p.ship.root);
  p.frame = 'world';
  p._setFrame(p._frameFor(Pw), Pw, Qw || new THREE.Quaternion(), V());
  p.vel.set(0, 0, 0); p.rates.set(0, 0, 0);
}
/** A frame quaternion with ship +Y along up and the nose along fwd (both world). */
function shipQuat(up, fwd) {
  const y = up.clone().normalize(), z = fwd.clone().negate(); z.addScaledVector(y, -z.dot(y)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V().crossVectors(y, z), y, z));
}

const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const HULLCHK = [[0, -1.5, -12], [0, -1.5, 4], [0, -1.2, 15.5], [4.6, -0.6, -2], [-4.6, -0.6, -2], [0, 0, -19.6], [0, 0.4, 16]].map(([x, y, z]) => V(x, y, z).multiplyScalar(KM));
const FEET = LODESTAR_FEET.map((f) => f.clone().multiplyScalar(KM));

/** Clearance (km) of the ship's hull points and feet above the Moon's ground (moon frame only). */
function moonClearance(p) {
  if (p.frame !== 'moon') return { hull: Infinity, feet: Infinity };
  const G = p.contact.ground; let hull = Infinity, feet = Infinity;
  for (const [list, key] of [[HULLCHK, 'hull'], [FEET, 'feet']]) for (const h of list) {
    const P = h.clone().applyQuaternion(p.quat).add(p.pos), L = P.length(), g = G(P.clone().divideScalar(L), { normal: V() });
    const c = (L - R_MOON - g.h) * Math.max(0.2, g.normal.dot(P.clone().normalize()));
    if (key === 'hull') hull = Math.min(hull, c); else feet = Math.min(feet, c);
  }
  return { hull, feet };
}

// ------------------------------------------------------------------------- scenarios --
const results = [];
function scenario(name, fn) {
  if (only && !name.includes(only)) return;
  const t0 = Date.now();
  let r;
  try { r = fn(); } catch (e) { r = { ok: false, why: `threw: ${e.stack.split('\n').slice(0, 3).join(' | ')}` }; }
  r.name = name; r.wall = (Date.now() - t0) / 1000;
  results.push(r);
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${r.summary || ''}${r.ok ? '' : `  <- ${r.why}`}  [${r.wall.toFixed(1)} s wall]`);
  if (!r.ok && r.msgs) console.log('      ' + r.msgs.slice(-8).join(' · '));
}

/** Fly the autopilot to a port; checks along the way. */
function flyTo(space, p, port, { T = 900, dt = 1 / 60, keep = null } = {}) {
  p.navigate(port);
  let minEarth = Infinity, minHull = Infinity, minFeetEarly = Infinity, bad = null, t = 0, phases = new Set(), keepViol = 0;
  for (; t < T; t += dt) {
    space.advance(dt);
    p.tick(dt);
    phases.add(p.ap.phase || (p.dock ? 'docked' : p.contact.landed ? 'landed' : '-'));
    if (process.env.JDBG && (p.jump || p.ap.phase === 'transfer') && t < 13 && t > 10) console.log(t.toFixed(2), p.jump ? p.jump.phase : '-', p.frame, p.pos.length().toFixed(1), p.worldPos().distanceTo(space.sim.moonPos).toFixed(1), p.vel.length().toFixed(3), p.contact.hullTouch, p.contact.footTouch);
    if (!finite(p.pos) || !finite(p.vel) || !Number.isFinite(p.quat.w)) { bad = 'NaN in the state'; break; }
    if (p.frame === 'earth') minEarth = Math.min(minEarth, p.pos.length() - R_EARTH);
    const cl = moonClearance(p);
    minHull = Math.min(minHull, cl.hull);
    if (p.ap.phase !== 'touchdown' && !p.contact.landed) minFeetEarly = Math.min(minFeetEarly, cl.feet);
    if (keep) keepViol += keep(p) ? 1 : 0;
    if (process.env.TRACE && Math.abs(t / +process.env.TRACE - Math.round(t / +process.env.TRACE)) < dt / 2 / +process.env.TRACE) {
      const a = p.ap, T = a.Tcmd, i = p.input;
      console.log(`  t ${t.toFixed(0)} ${a.phase} ${a._routing || ''} d ${a.info.d.toFixed(4)} vc ${(a.info.vc * 1000).toFixed(2)}m/s |v| ${p.vel.length().toFixed(4)} frame ${p.frame} att ${((a.attErr || 0) / DEG).toFixed(1)} coarse ${a._coarse} T ${(T.length() * 1000).toFixed(2)} fwd ${i.fwd.toFixed(3)} boost ${p.boost} lift ${i.lift.toFixed(2)} str ${i.strafe.toFixed(2)} surge ${i.surge.toFixed(2)} feet ${p.contact.footTouch} ring ${p._rs ? (p._rs.d * 1000).toFixed(2) + 'm ax ' + (p._rs.axisErr / DEG).toFixed(2) + ' roll ' + (p._rs.rollErr / DEG).toFixed(2) : '-'} docks ${p._docks.size} ${p.msgs.slice(-1)}`);
    }
    if ((p.dock && p.dock.hard) || (p.contact.landed && !p.ap.on)) break;
    if (!p.ap.on && !p.dock && !p.contact.landed) { bad = `autopilot dropped out in ${[...phases].join('>')}`; break; }
  }
  return { t, minEarth, minHull, minFeetEarly, bad, phases: [...phases].join('>'), keepViol };
}

function dockCheck(r, p, extra = '') {
  const c = p.lastCapture;
  if (r.bad) return { ok: false, why: r.bad, msgs: p.msgs };
  if (!p.dock || !p.dock.hard || !c) return { ok: false, why: `not docked after ${r.t.toFixed(0)} s (phase ${p.ap.phase}, ${r.phases})`, msgs: p.msgs };
  const s = `docked in ${r.t.toFixed(0)} s: ${(c.v * 1000).toFixed(2)} m/s, axis ${(c.axisErr / DEG).toFixed(2)} deg, roll ${(c.rollErr / DEG).toFixed(2)} deg${extra}`;
  if (c.v > 0.3 * KM) return { ok: false, why: 'capture too fast', summary: s, msgs: p.msgs };
  if (c.axisErr > 5 * DEG || c.rollErr > 5 * DEG) return { ok: false, why: 'capture not square', summary: s, msgs: p.msgs };
  if (r.minEarth < 95) return { ok: false, why: `inside the Earth keep-out (${r.minEarth.toFixed(0)} km)`, summary: s };
  if (r.keepViol) return { ok: false, why: `through the station (${r.keepViol} steps)`, summary: s };
  return { ok: true, summary: s };
}

function padCheck(r, p, pad, extra = '') {
  if (r.bad) return { ok: false, why: r.bad, msgs: p.msgs };
  if (!p.contact.landed) return { ok: false, why: `not landed after ${r.t.toFixed(0)} s (phase ${p.ap.phase}, ${r.phases})`, msgs: p.msgs };
  const up = V(0, 1, 0).applyQuaternion(p.quat), att = Math.acos(Math.min(1, up.dot(pad.nb)));
  const fc = FEET_CENTRE.clone().applyQuaternion(p.quat).add(p.pos), off = fc.clone().sub(pad.Pb); off.addScaledVector(pad.nb, -off.dot(pad.nb));
  const imp = p.contact.impact / KM, g = p.contact.gear.map((x) => x.toFixed(2)).join('/');
  const s = `landed in ${r.t.toFixed(0)} s: touchdown ${imp.toFixed(2)} m/s, tilt ${(att / DEG).toFixed(2)} deg, off-centre ${(off.length() / KM).toFixed(2)} m, gear ${g}, hull clearance ${(r.minHull / KM).toFixed(1)} m${extra}`;
  if (imp > 1.5) return { ok: false, why: 'touchdown too hard', summary: s, msgs: p.msgs };
  if (att > 5 * DEG) return { ok: false, why: 'not level with the pad', summary: s };
  if (off.length() > 0.02) return { ok: false, why: 'off the pad', summary: s };
  if (r.minHull < -0.3 * KM) return { ok: false, why: 'hull in the ground', summary: s };
  if (r.minFeetEarly < -0.3 * KM) return { ok: false, why: 'feet in the ground before touchdown', summary: s };
  return { ok: true, summary: s };
}

// ---- 1. the wheel's hub dock, starting behind the wheel (the wrong side) -----------------------
scenario('dock: wheel hub from behind', () => {
  const sp = makeSpace(); const W = addWheel(sp); const p = makePilot(sp);
  sp.advance(0);
  const C = W.C(V()), n = W.n();
  place(p, C.clone().addScaledVector(n, -2.0).add(V(0, 0.3, 0)), shipQuat(V(0, 1, 0), n.clone().negate()));
  const keep = (pp) => { const Pw = pp.worldPos(V()), c = W.C(V()), d = Pw.clone().sub(c), ax = d.dot(W.n()); const lat = d.clone().addScaledVector(W.n(), -ax).length(); return d.length() < W.R && !(ax > 0 && lat < 0.05); };
  const r = flyTo(sp, p, W.port, { T: 900, keep });
  const res = dockCheck(r, p);
  // then ride the spinning hub for 20 s: the ship must stay mated
  if (res.ok) {
    for (let t = 0; t < 20; t += 1 / 60) { sp.advance(1 / 60); p.tick(1 / 60); }
    const pose = W.port.pose(sp, {}), ring = V(0, 3.1, -6.3).multiplyScalar(KM).applyQuaternion(p.worldQuat()).add(p.worldPos());
    if (ring.distanceTo(pose.pos) > 0.05 * KM) return { ok: false, why: `drifted off the port while docked (${(ring.distanceTo(pose.pos) / KM).toFixed(2)} m)`, summary: res.summary };
    // undock and check it pushes off along the axis
    p.undock();
    for (let t = 0; t < 10; t += 1 / 60) { sp.advance(1 / 60); p.tick(1 / 60); }
    const away = p.worldPos().sub(W.port.pose(sp, {}).pos).dot(W.n());
    if (!(away > 2 * KM && away < 8 * KM)) return { ok: false, why: `undock push-off ${(away / KM).toFixed(2)} m in 10 s`, summary: res.summary };
    res.summary += `; rode the hub 20 s, undocked ${(away / KM).toFixed(1)} m clear in 10 s`;
  }
  return res;
});

// ---- 2. a dock on a station in low orbit, starting 3000 km away at rest in the Earth's frame ----
scenario('dock: low-orbit station from 3000 km', () => {
  const sp = makeSpace(); const L = addLeo(sp); const p = makePilot(sp);
  sp.advance(0);
  const P0 = L.C(V(), -390);                   // ~3000 km behind along the orbit
  place(p, P0, shipQuat(P0.clone().normalize(), L.C(V()).sub(P0)));
  const d0 = p.worldPos().distanceTo(L.C(V()));
  const r = flyTo(sp, p, L.port, { T: 1200 });
  return dockCheck(r, p, `, start ${d0.toFixed(0)} km, lowest ${r.minEarth.toFixed(0)} km`);
});

// ---- 3. a raised pad on the Moon, starting on the far side ------------------------------------
scenario('land: Moon pad from the far side', () => {
  const sp = makeSpace(); const p = makePilot(sp, flatGround);
  const pad = addMoonPad(sp, 'landing', V(-1, 0.1, 0.05), 1.2 * KM, flatGround);
  sp.advance(0);
  const Pb = V(1, -0.05, 0.1).normalize().multiplyScalar(R_MOON + 50);
  place(p, Pb.clone().applyQuaternion(sp.sim.moonQuat).add(sp.sim.moonPos), shipQuat(Pb.clone().applyQuaternion(sp.sim.moonQuat), V(0, 0, 1)));
  const r = flyTo(sp, p, pad.port, { T: 1500 });
  return padCheck(r, p, pad, `, ${r.phases}`);
});

// ---- 4. a pad on a 10-degree slope (a fake moonGround) -----------------------------------------
scenario('land: pad on a 10-degree slope', () => {
  const sp = makeSpace(); const d1 = V(-0.6, 0.5, -0.62);
  const G = slopeGround(d1, 10); const p = makePilot(sp, G);
  const pad = addMoonPad(sp, 'slope', d1, 0, G);
  sp.advance(0);
  const Pb = d1.clone().normalize().applyAxisAngle(V(0, 1, 0), 0.05).multiplyScalar(R_MOON + 20);
  place(p, Pb.clone().applyQuaternion(sp.sim.moonQuat).add(sp.sim.moonPos), shipQuat(Pb.clone(), V(1, 0, 0)));
  const r = flyTo(sp, p, pad.port, { T: 900 });
  return padCheck(r, p, pad);
});

// ---- 5. 400,000 km out: the jump drive, then a dock --------------------------------------------
scenario('dock: jump from 400,000 km', () => {
  const sp = makeSpace(); const L = addLeo(sp); const p = makePilot(sp);
  sp.advance(0);
  place(p, V(0, 60000, 395000), new THREE.Quaternion());
  const r = flyTo(sp, p, L.port, { T: 1200 });
  const res = dockCheck(r, p, `, ${p.ap.jumps || 'jumped'}`);
  if (res.ok && !r.phases.includes('jump')) return { ok: false, why: 'never jumped', summary: res.summary };
  return res;
});

// ---- 6. from near the Earth to a pad on the Moon (another sphere of influence: a jump) ----------
scenario('land: jump from the Earth to the Moon', () => {
  const sp = makeSpace(); const p = makePilot(sp, flatGround);
  const pad = addMoonPad(sp, 'far', V(-0.8, 0.5, 0.3), 1.2 * KM, flatGround);
  sp.advance(0);
  place(p, V(0, 0, 42164), new THREE.Quaternion());
  const r = flyTo(sp, p, pad.port, { T: 1200 });
  const res = padCheck(r, p, pad);
  if (res.ok && !r.phases.includes('jump')) return { ok: false, why: 'never jumped', summary: res.summary };
  return res;
});

// ------------------------------------------------------------------ manual landing mechanics --
function drop(name, { ground = flatGround, legs = 1, h = 1.5, v = 0, tilt = 0, pitch = false, T = 25, dir = V(-1, 0.2, 0.1) } = {}) {
  scenario(name, () => {
    const sp = makeSpace(); const p = makePilot(sp, ground);
    sp.advance(0);
    const d = dir.clone().normalize(), g = ground(d, { normal: V() });
    const nose0 = V(0, 0, 1).cross(d).normalize(), up = d.clone().applyAxisAngle(pitch ? nose0.clone().cross(d).normalize() : nose0, tilt * DEG);
    const Q = shipQuat(up, V(0, 0, 1).cross(up));
    const footY = legs ? 6.97 * KM : 1.6 * KM;
    const Pb = d.clone().multiplyScalar(R_MOON + g.h + footY + h * KM);
    place(p, Pb.clone().add(sp.sim.moonPos), Q);
    p.assist = false; p.legs = legs; p.legPos = legs;
    p.vel.copy(d).multiplyScalar(-v * KM);
    let minHull = Infinity, minFeet = Infinity, t = 0, maxC = 0, P0 = null;
    const fc = () => FEET_CENTRE.clone().applyQuaternion(p.quat).add(p.pos);
    for (; t < T; t += 1 / 60) {
      sp.advance(1 / 60); p.tick(1 / 60);
      if (!P0 && p.contact.footTouch + p.contact.hullTouch > 0) P0 = fc();
      if (process.env.DDBG && Math.round(t * 60) % 30 === 0) console.log(t.toFixed(1), (p.pos.length() - R_MOON).toFixed(4), p.contact.footTouch, p.contact.hullTouch, (p.vel.length() * 1000).toFixed(2), p.rates.toArray().map((x) => x.toFixed(3)).join(','), p.contact.gear.map((x) => x.toFixed(2)).join('/'));
      if (!finite(p.pos) || !finite(p.vel)) return { ok: false, why: 'NaN' };
      const cl = moonClearance(p); minHull = Math.min(minHull, cl.hull); minFeet = Math.min(minFeet, cl.feet);
      maxC = Math.max(maxC, ...p.contact.gear);
    }
    const gear = p.contact.gear.map((x) => x.toFixed(2)).join('/');
    const slide = fc().sub(P0 || fc()); slide.addScaledVector(d, -slide.dot(d));
    const upNow = V(0, 1, 0).applyQuaternion(p.quat), gN = ground(p.pos.clone().normalize(), { normal: V() }).normal;
    const tiltN = Math.acos(Math.min(1, upNow.dot(gN))) / DEG;
    const s = `${p.contact.landed ? 'landed' : 'not landed'}, gear ${gear} (peak ${maxC.toFixed(2)}), hull ${(minHull / KM).toFixed(2)} m, feet ${(minFeet / KM).toFixed(2)} m, slid ${(slide.length() / KM).toFixed(2)} m, tilt to ground ${tiltN.toFixed(1)} deg, v ${(p.vel.length() / KM).toFixed(3)} m/s; ${p.msgs.slice(0, 2).join(', ')}`;
    const fails = [];
    if (v > 10) { /* a crash: only tunnelling counts */ } else if (legs) {
      if (!p.contact.landed) fails.push('did not settle');
      if (minHull < 0) fails.push('hull touched');
      if (p.contact.footTouch < 3 || p.contact.gear.filter((c) => c > 0.05).length < 2 || Math.max(...p.contact.gear) > 0.6) fails.push('compressions out of range');
      if (slide.length() > 1.0 * KM) fails.push('slid');
      if (tiltN > 3) fails.push('not standing square on its legs');
      if (minFeet < -STROKE - 0.3 * KM) fails.push('feet through the ground');
    } else {
      if (minHull < -1.2 * KM) fails.push('tunnelled');
      if (!p.msgs.some((m) => /hard|crash/.test(m))) fails.push('no hard-contact message');
      if (p.vel.length() > 0.05 * KM) fails.push('not at rest');
    }
    if (v > 10 && minHull < -1.2 * KM) fails.push('tunnelled');
    return { ok: !fails.length, why: fails.join(', '), summary: s };
  });
}
drop('manual: legs down, flat ground');
drop('manual: legs down, 10-degree slope', { ground: slopeGround(V(-1, 0.2, 0.1), 10), h: 2.5 });
drop('manual: legs down, tilted 6 deg, flat', { h: 1.0, tilt: 6 });
drop('manual: legs down, pitched 5 deg, slope', { ground: slopeGround(V(-1, 0.2, 0.1), 10), h: 3.2, tilt: 5, pitch: true });
drop('manual: legs down, pitched -5 deg, slope', { ground: slopeGround(V(-1, 0.2, 0.1), 10), h: 3.2, tilt: -5, pitch: true });
drop('manual: legs up, belly landing', { legs: 0, h: 4 });
drop('manual: legs up, 25 m/s crash', { legs: 0, h: 10, v: 25, T: 15 });
drop('manual: legs down, 12 m/s crash', { legs: 1, h: 5, v: 12, T: 15 });

// ---- the page side: drive() with the HUD on a stand-in document (nothing may throw) -------------
scenario('hud: drive() through an autopilot landing', () => {
  const el = () => {
    const e = { hidden: false, style: {}, dataset: {}, textContent: '', children: [], classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, appendChild(c) { this.children.push(c); } };
    let html = '';
    Object.defineProperty(e, 'innerHTML', { get: () => html, set: (v) => { html = v; e._kids = [...v.matchAll(/data-k="([^"]+)"/g)].map((m) => { const k = el(); k.dataset.k = m[1]; return k; }); } });
    e.querySelectorAll = () => e._kids || [];
    return e;
  };
  globalThis.document = { createElement: el, body: el() };
  const sp = makeSpace(); const p = makePilot(sp, flatGround);
  addMoonPad(sp, 'landing', V(-1, 0.1, 0.05), 1.2 * KM, flatGround);
  sp.advance(0);
  const Pb = V(-1, 0.1, 0.05).normalize().multiplyScalar(R_MOON + 3);
  place(p, Pb.clone().add(sp.sim.moonPos), shipQuat(Pb.clone(), V(0, 0, 1)));
  p._hud(); p.active = true; p.space.hud.selected = 'landing';
  const cam = new THREE.PerspectiveCamera(50, 1, 0.001, 1e9);
  p.navKey();
  let t = 0; const texts = new Set();
  for (; t < 400 && !(p.contact.landed && !p.ap.on); t += 1 / 60) { sp.advance(1 / 60); p.drive(1 / 60, cam); texts.add(p._hk.apPhase.textContent); }
  for (let k = 0; k < 120; k++) { sp.advance(1 / 60); p.drive(1 / 60, cam); }
  const ok = p.contact.landed && !p._hk.land.hidden && /LANDED/.test(p._hk.gear.textContent);
  delete globalThis.document;
  return { ok, why: 'HUD did not show the landing', summary: `landed in ${t.toFixed(0)} s via drive(); panel ${[...texts].filter(Boolean).slice(0, 5).join(' / ')}; aids: ralt ${p._hk.ralt.textContent} ${p._hk.raltU.textContent}, ${p._hk.gear.textContent} (${p._hk.gearU.textContent})` };
});

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
