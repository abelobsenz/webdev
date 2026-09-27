import * as THREE from 'three';
import { RouteBank, ROUTE_GLSL, smoothClosed } from './routes.js';
import { createFacadeMaterial } from '../world/facade.js';
import { applyPatch } from '../world/materials.js';
import { latheFacade, mergeClean } from '../world/geom.js';
import { terrainHeight } from '../world/terrain.js';
import { wardHeight, QUAY_Y } from '../world/metro.js';
import { outerCities } from '../world/outerCities.js';

// Everything that moves on Greater Meridian's transit network: maglev trains surfacing
// through the Great Ring's portals and gliding into the station islands, pods on the
// Tidewater canal line, hydrofoil ferries on the sea lanes to the island cities, launches
// and water taxis in the harbours and canals, gondola cabins climbing to the massif towns,
// and sky-ships sailing from Southmarch's mooring halo. Routes are baked once (routes.js);
// every vehicle is placed on the GPU from its route, phase and rate, and drawn with the
// facade shader (its windows light at night). Lights are steady: no strobes, no blinking.

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------- geometry --
/** Loft of rounded sections along +z; kindAt(angle, z) chooses the facade kind round the section. */
function loftBody(stations, kindAt, around = 16) {
  // stations: [{ z, w (half width), h (half height), y (centre) }]
  const pos = [], fac = [], idx = [];
  const cols = around + 1;
  for (let j = 0; j < stations.length; j++) {
    const s = stations[j];
    for (let i = 0; i <= around; i++) {
      const a = (i / around) * TAU;
      const c = Math.cos(a), sn = Math.sin(a);
      // superellipse section
      const e = 0.6;
      const x = Math.sign(c) * Math.pow(Math.abs(c), e) * s.w, y = s.y + Math.sign(sn) * Math.pow(Math.abs(sn), e) * s.h;
      pos.push(x, y, s.z);
      fac.push(a * Math.max(s.w, 0.5), s.z, kindAt(a, s.z, j));
    }
  }
  for (let j = 0; j < stations.length - 1; j++) for (let i = 0; i < around; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // outward
  const n = g.attributes.normal;
  let dot = 0;
  for (let i = 0; i < n.count; i++) dot += n.getX(i) * pos[i * 3] + n.getY(i) * (pos[i * 3 + 1] - stations[Math.floor(i / cols)].y);
  if (dot < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

function boxG(x0, x1, y0, y1, z0, z1, kind) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const p = g.attributes.position;
  const fac = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { fac[i * 3] = p.getX(i) + p.getZ(i); fac[i * 3 + 1] = p.getY(i); fac[i * 3 + 2] = kind; }
  g.setAttribute('aFacade', new THREE.BufferAttribute(fac, 3));
  return g;
}

/** A maglev train of three cars (72 m), riding 1.2 m above its guideway beam. */
function trainGeometry(cars = 3, carL = 24) {
  const parts = [];
  const L = cars * carL;
  const win = (a, z) => { const s = Math.sin(a); return s > -0.1 && s < 0.5 ? 0 : s <= -0.55 ? 10 : 1; };
  for (let c = 0; c < cars; c++) {
    const z0 = -L / 2 + c * carL + 0.35, z1 = z0 + carL - 0.7;
    const st = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const z = z0 + (z1 - z0) * t;
      let f = 1;
      if (c === cars - 1) f *= Math.pow(Math.max(0.02, Math.min(1, (z1 - z) / 9)), 0.55);
      if (c === 0) f *= Math.pow(Math.max(0.02, Math.min(1, (z - z0) / 9)), 0.55);
      st.push({ z, w: 1.75 * Math.max(f, 0.08), h: 1.75 * Math.max(f, 0.12), y: 2.9 - (1 - f) * 0.9 });
    }
    parts.push(loftBody(st, (a, z) => {
      const nose = (c === cars - 1 && z > z1 - 6) || (c === 0 && z < z0 + 6);
      return nose ? (Math.sin(a) > 0.1 ? 0 : 1) : win(a, z);
    }));
    // skirt over the beam and a lit line along the waist
    parts.push(boxG(-1.4, 1.4, 1.0, 1.6, z0 + 1, z1 - 1, 10));
  }
  // headlamps (lantern) at both noses
  parts.push(boxG(-0.8, 0.8, 2.3, 2.7, L / 2 - 0.9, L / 2 - 0.3, 2), boxG(-0.8, 0.8, 2.3, 2.7, -L / 2 + 0.3, -L / 2 + 0.9, 2));
  return mergeClean(parts);
}

/** A hydrofoil ferry (36 m): hull, two decks of windows, foils and struts, a mast. */
function ferryGeometry() {
  const parts = [];
  const L = 36;
  const st = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    const z = -L / 2 + L * t;
    const bow = Math.max(0, (t - 0.7) / 0.3);
    st.push({ z, w: 4.2 * Math.sqrt(Math.max(0.03, 1 - bow * bow)), h: 1.4, y: 2.0 + bow * 0.5 });
  }
  parts.push(loftBody(st, (a) => (Math.sin(a) < -0.3 ? 10 : 1), 14));
  parts.push(boxG(-3.2, 3.2, 3.2, 5.6, -12, 8, 0));
  parts.push(boxG(-3.4, 3.4, 5.6, 5.9, -12.4, 8.4, 1));
  parts.push(boxG(-2.4, 2.4, 5.9, 7.8, -8, 3, 0));
  parts.push(boxG(-2.6, 2.6, 7.8, 8.1, -8.3, 3.3, 1));
  for (const z of [-11, 9]) {
    parts.push(boxG(-5.5, 5.5, -0.4, -0.1, z - 1.2, z + 1.2, 10));
    for (const x of [-4.5, 4.5]) parts.push(boxG(x - 0.15, x + 0.15, -0.3, 1.2, z - 0.4, z + 0.4, 10));
  }
  parts.push(boxG(-0.15, 0.15, 8.1, 13, 0, 0.3, 10));
  parts.push(boxG(-0.5, 0.5, 13, 13.6, -0.2, 0.5, 2));
  parts.push(boxG(-3.0, 3.0, 3.6, 4.2, L / 2 - 6, L / 2 - 5.6, 2));
  return mergeClean(parts);
}

/** A harbour launch or water taxi (11 m). */
function launchGeometry() {
  const parts = [];
  const L = 11;
  const st = [];
  for (let k = 0; k <= 8; k++) { const t = k / 8; const z = -L / 2 + L * t; const bow = Math.max(0, (t - 0.65) / 0.35); st.push({ z, w: 1.6 * Math.sqrt(Math.max(0.04, 1 - bow * bow)), h: 0.7, y: 0.5 + bow * 0.3 }); }
  parts.push(loftBody(st, (a) => (Math.sin(a) < -0.2 ? 10 : 8), 12));
  parts.push(boxG(-1.1, 1.1, 1.2, 2.5, -3, 1.2, 0));
  parts.push(boxG(-1.25, 1.25, 2.5, 2.7, -3.3, 1.5, 1));
  parts.push(boxG(-0.3, 0.3, 1.0, 1.3, L / 2 - 1.2, L / 2 - 0.9, 2));
  return mergeClean(parts);
}

/** A gondola cabin hanging 5 m below its cable (the route runs along the cable). */
function gondolaGeometry() {
  const parts = [];
  const st = [];
  for (let k = 0; k <= 6; k++) { const t = k / 6; st.push({ z: -1.9 + 3.8 * t, w: 1.3 * Math.pow(Math.sin(Math.PI * (0.15 + 0.7 * t)), 0.3), h: 1.2, y: -6.2 }); }
  parts.push(loftBody(st, (a) => (Math.sin(a) > 0.75 ? 1 : Math.sin(a) < -0.7 ? 10 : 0), 12));
  parts.push(boxG(-0.12, 0.12, -5.0, -0.2, -0.12, 0.12, 10));
  parts.push(boxG(-0.5, 0.5, -0.4, 0.3, -0.6, 0.6, 10));
  return mergeClean(parts);
}

/** A sky-ship (220 m): a lifting envelope, its gondola deck, fins and engine pods. */
export function skyshipGeometry() {
  const parts = [];
  const L = 220;
  const prof = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    const r = 26 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 0.62);
    prof.push({ r: Math.max(r, 0.2), y: -L / 2 + L * t, kind: (k === 8 || k === 16) ? 2 : 1 });
  }
  const env = latheFacade(prof, 24, { sx: 1, sz: 0.92 });
  env.rotateX(Math.PI / 2);
  env.translate(0, 34, 0);
  parts.push(env);
  parts.push(boxG(-6, 6, 4, 10, -40, 34, 0));
  parts.push(boxG(-6.4, 6.4, 10, 10.6, -41, 35, 1));
  parts.push(boxG(-4, 4, 1.5, 4, -28, 24, 0));
  for (const [x, y] of [[0, 62], [0, 6], [-26, 34], [26, 34]]) {
    const fin = boxG(-0.8, 0.8, -12, 12, -104, -76, 1);
    if (x !== 0) { fin.rotateZ(Math.PI / 2); }
    fin.translate(x, y - (y > 30 && x === 0 ? 0 : 0), 0);
    parts.push(fin);
  }
  for (const s of [-1, 1]) for (const z of [-20, 30]) {
    parts.push(boxG(s * 30 - 3, s * 30 + 3, 14, 20, z - 6, z + 6, 10));
    parts.push(boxG(s * 30 - 2, s * 30 + 2, 15, 19, z + 6, z + 6.6, 2));
  }
  return mergeClean(parts);
}

// ------------------------------------------------------------ material --
const VEH_PARS = /* glsl */ `
attribute vec4 aRoute;   // row, phase0, rate (loops/s, signed), scale
attribute vec4 aLane;    // lateral, vertical, variant, seed
uniform float uCullD;
${ROUTE_GLSL}
mat3 tvRot; vec3 tvPos; float tvOn;
void tvSetup() {
  float ph = aRoute.y + uTime * aRoute.z;
  vec3 p0 = texelFetch(uRoutes, ivec2(int(fract(ph) * 2048.0), int(aRoute.x + 0.5) * 3), 0).xyz;
  if (distance(p0, cameraPosition) > uCullD * aRoute.w + 600.0) { tvOn = 0.0; tvRot = mat3(1.0); tvPos = p0; return; }
  RouteFrame fr = routeAt(aRoute.x, ph);
  float dir = aRoute.z < 0.0 ? -1.0 : 1.0;
  vec3 side;
  tvRot = routeBasis(fr, dir, side);
  tvPos = fr.pos + side * aLane.x + vec3(0.0, aLane.y, 0.0);
  tvOn = step(0.03, fr.vis) * step(distance(tvPos, cameraPosition), uCullD * aRoute.w);
}
`;

function vehicleMaterial(palette, seed, tex, cull, opts = {}) {
  const m = createFacadeMaterial(palette, seed, { litFrac: 0.85, band: 1e5, colW: 2.4, floorH: 2.8, uplight: 0, ...opts });
  const hooks = m.userData.hooks;
  const uniforms = { ...hooks.uniforms, uRoutes: { value: tex }, uCullD: { value: cull } };
  applyPatch(m, {
    ...hooks,
    key: `transitVeh`,
    uniforms,
    vertex: {
      pars: 'attribute vec3 aFacade; varying vec3 vFacade;\n' + VEH_PARS,
      preNormal: 'tvSetup(); objectNormal = tvRot * objectNormal;',
      transform: 'vFacade = aFacade; transformed = tvOn > 0.5 ? tvRot * (transformed * aRoute.w) + tvPos : tvPos;',
    },
  });
  m.userData.facadeUniforms = uniforms;
  return m;
}

// ----------------------------------------------------------------- routes --
function hiddenBelow(pts, y0) {
  // arc ranges where the path runs below y0 (under the sea)
  const out = [];
  let s = 0, start = null;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += pts[i].distanceTo(pts[i - 1]);
    const h = pts[i].y < y0;
    if (h && start === null) start = s;
    if (!h && start !== null) { out.push([start, s]); start = null; }
  }
  if (start !== null) out.push([start, s + pts[0].distanceTo(pts[pts.length - 1])]);
  return out;
}

function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const L = a.distanceTo(b);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) out.push(a.clone().lerp(b, k / n));
  }
  return out;
}

const wet = (x, z, margin = 0) => terrainHeight(x, z) < -1.6 - margin && wardHeight(x, z) === -Infinity;

/** A sea lane from harbour A to harbour B: out through each mouth, a turning loop at each quay. */
function seaLane(A, B) {
  const ctrl = [];
  const loop = (H, inward) => {
    // approach along the mouth line, circle the turning basin, berth, and leave
    const pts = [];
    const c = V(H.x, 0.6, H.z);
    const r = H.turn || 38;
    for (let k = 0; k < 10; k++) { const a = H.a0 + (k / 10) * TAU * (inward ? 1 : 1); pts.push(V(c.x + Math.cos(a) * r, 0.6, c.z + Math.sin(a) * r)); }
    return pts;
  };
  ctrl.push(...A.path.map((p) => V(p[0], 0.6, p[1])));
  ctrl.push(...loop(A, true));
  ctrl.push(...A.path.slice().reverse().map((p) => V(p[0], 0.6, p[1])));
  ctrl.push(...B.path.map((p) => V(p[0], 0.6, p[1])));
  ctrl.push(...loop(B, true));
  ctrl.push(...B.path.slice().reverse().map((p) => V(p[0], 0.6, p[1])));
  const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
  let pts = curve.getSpacedPoints(Math.ceil(curve.getLength() / 8));
  pts.pop();
  // nudge any sample that strays over land, a platform or a reef out to open water
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.inBasin) continue;
      if (wet(p.x, p.z)) continue;
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
      const t = V(b.x - a.x, 0, b.z - a.z).normalize();
      const n = V(-t.z, 0, t.x);
      for (const d of [20, -20, 45, -45, 80, -80, 140, -140]) { if (wet(p.x + n.x * d, p.z + n.z * d)) { p.x += n.x * d; p.z += n.z * d; moved = true; break; } }
    }
    if (!moved) break;
  }
  return pts;
}

// ------------------------------------------------------------------ class --
export class Transit {
  constructor(scene, world, net) {
    this.scene = scene;
    this.bank = new RouteBank();
    this.fleet = { train: [], canal: [], ferry: [], launch: [], gondola: [], skyship: [] };
    this.rnd = (() => { let s = 424242; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
    this.report = [];
    const add = (cls, route, n, { lat = 0, up = 0, scale = 1, dirs = [1] } = {}) => {
      for (const dir of dirs) for (let k = 0; k < n; k++) this.fleet[cls].push({ row: route.row, phase: (k + this.rnd() * 0.2) / n, rate: dir / route.period, scale, lat, up, variant: this.rnd(), seed: this.rnd() });
    };
    // ---- maglev trains on the Great Ring and the far lines
    for (const r of net.routes) {
      const pts = densify(r.pts, 20);
      const hidden = hiddenBelow(pts, -1.5);
      const route = this.bank.add({
        polyline: pts,
        speed: (s, L, p) => (p.y < -8 ? 150 : 38),
        accel: 1.25, decel: 1.25, latAccel: 1.8, bankMax: 0.1,
        stops: r.stops.map((q) => ({ s: q.s, dwell: 24 })),
        hidden, hideFade: 30,
      });
      route.name = `maglev-${r.line}`;
      add('train', route, r.line === 'ring' ? 7 : 2, { up: -0.35 });
    }
    // ---- the canal line: a loop over Tidewater's ring canal
    for (const c of net.canalLines) {
      const pts = densify(c.pts, 6);
      const route = this.bank.add({ polyline: pts, speed: 16, accel: 0.9, latAccel: 1.2, bankMax: 0.05, stops: c.stops.map((i) => ({ u: i / c.pts.length, dwell: 16 })) });
      route.name = 'canal-line';
      add('canal', route, 5, { up: -0.35 });
    }
    // ---- gondolas: up one cable, round the top wheel, down the other
    for (const g of net.gondolas) {
      const loopPts = [...g.up, ...g.down.slice().reverse()];
      const pts = densify(loopPts, 5);
      const route = this.bank.add({ polyline: pts, speed: (s, L, p) => (Math.min(p.distanceTo(g.base), p.distanceTo(g.top)) < 30 ? 0.8 : 6), accel: 0.4, latAccel: 0.6, bankMax: 0.0, pitchSpeeds: [100, 200] });
      route.name = `gondola-${g.id}`;
      add('gondola', route, Math.max(8, Math.floor(route.length / 110)));
    }
    // ---- harbours and sea lanes
    const wardsById = Object.fromEntries(world.metro.wards.map((w) => [w.def.id, w]));
    const oc = outerCities();
    const harbours = {};
    const W = (id, lx, lz) => { const w = wardsById[id].def; return [w.x + lx, w.z + lz]; };
    const sm = wardsById.southmarch;
    if (sm) {
      const rS = sm.rec.ctx.harbour.rS;
      harbours.southmarch = { x: sm.def.x, z: sm.def.z + 700, turn: 52, a0: 0, path: [W('southmarch', 0, rS + 900), W('southmarch', 0, rS + 360), W('southmarch', 0, 1000), W('southmarch', 0, 780)] };
    }
    const tw = wardsById.tidewater;
    if (tw && tw.rec.ctx.mouths) {
      const m = tw.rec.ctx.mouths[0];
      const d = [Math.cos(m.rot), Math.sin(m.rot)];
      harbours.tidewater = { x: tw.def.x + m.x, z: tw.def.z + m.z, turn: 36, a0: 0, path: [[tw.def.x + m.x + d[0] * 900, tw.def.z + m.z + d[1] * 900], [tw.def.x + m.x + d[0] * 300, tw.def.z + m.z + d[1] * 300]] };
    }
    const co = wardsById.coral;
    if (co) harbours.coral = { x: co.def.x - 272, z: co.def.z, turn: 28, a0: 0, path: [W('coral', -1300, 0), W('coral', -700, 0), W('coral', -420, 0)] };
    const au = wardsById.aurora;
    if (au) { const rE = au.rec.R(0); harbours.aurora = { x: au.def.x + rE - 120, z: au.def.z + 70, turn: 34, a0: 0, path: [W('aurora', rE + 900, 150), W('aurora', rE + 300, 90), W('aurora', rE + 60, 70)] }; }
    for (const c of oc.islands) {
      const hx = c.harbour.x + c.d[0] * 120, hz = c.harbour.z + c.d[1] * 120;
      harbours[c.id] = { x: hx, z: hz, turn: 45, a0: 0, path: [[hx + c.d[0] * 1500, hz + c.d[1] * 1500], [hx + c.d[0] * 500, hz + c.d[1] * 500]] };
    }
    const lanes = [['southmarch', 'vesper'], ['southmarch', 'austral'], ['coral', 'anchorage'], ['tidewater', 'thalassa'], ['aurora', 'orison'], ['southmarch', 'coral'], ['southmarch', 'tidewater']];
    for (const [a, b] of lanes) {
      if (!harbours[a] || !harbours[b]) continue;
      const pts = seaLane(harbours[a], harbours[b]);
      // stops at the two turning basins (the berth is the loop's far side)
      const stops = [];
      let s = 0;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) { s += pts[i].distanceTo(pts[i - 1]); cum.push(s); }
      for (const H of [harbours[a], harbours[b]]) {
        let bi = 0, bd = 1e18;
        for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i].x - (H.x + H.turn), pts[i].z - H.z); if (d < bd) { bd = d; bi = i; } }
        stops.push({ s: cum[bi], dwell: 40 });
      }
      const route = this.bank.add({ polyline: pts, speed: (sa, L, p) => { const dmin = Math.min(Math.hypot(p.x - harbours[a].x, p.z - harbours[a].z), Math.hypot(p.x - harbours[b].x, p.z - harbours[b].z)); return dmin < 700 ? 7 : 19; }, accel: 0.5, decel: 0.5, latAccel: 1.0, bankMax: 0.12, stops });
      route.name = `ferry-${a}-${b}`;
      add('ferry', route, a === 'southmarch' && (b === 'coral' || b === 'tidewater') ? 2 : 2);
    }
    // launches and water taxis circling the harbours and the canal
    const circuit = (name, ctrl, n, speed = 6) => {
      const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => V(x, 0.35, z)), true, 'centripetal');
      const pts = curve.getSpacedPoints(Math.ceil(curve.getLength() / 5));
      pts.pop();
      const route = this.bank.add({ polyline: pts, speed, accel: 0.6, latAccel: 0.9, bankMax: 0.08 });
      route.name = name;
      add('launch', route, n);
    };
    if (sm) circuit('launch-southmarch', [W('southmarch', -250, 360), W('southmarch', 250, 360), W('southmarch', 260, 690), W('southmarch', 60, 760), W('southmarch', 60, 1150), W('southmarch', -60, 1150), W('southmarch', -60, 760), W('southmarch', -260, 690)], 6);
    if (co) { const pts = []; for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; pts.push(W('coral', Math.cos(a) * 188, Math.sin(a) * 188)); } circuit('launch-coral', pts, 4, 4.5); }
    if (tw && tw.rec.ctx.grand) {
      // water taxis up and down the Grand Canal, turning in the marinas
      const g = tw.rec.ctx.grand.filter((p) => Math.hypot(p[0], p[1]) < tw.rec.R(Math.atan2(p[1], p[0])) - 40);
      const side = (pts, off) => pts.map((p, i) => { const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)]; const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1; return [p[0] - (tz / l) * off, p[1] + (tx / l) * off]; });
      const up = side(g, 8), down = side(g, -8).reverse();
      circuit('taxi-tidewater', [...up, ...down].map(([x, z]) => W('tidewater', x, z)), 6, 5);
    }
    if (au) { const rE = au.rec.R(0); circuit('launch-aurora', [W('aurora', rE - 200, 30), W('aurora', rE - 20, 30), W('aurora', rE - 20, 110), W('aurora', rE - 200, 110)], 2, 4); }
    // ---- sky-ships from the mooring halo of Southmarch's crown
    const mast = world.wardTowers && world.wardTowers.find((t) => t.def.ward === 'southmarch' && t.def.name && t.berths);
    this.docked = [];
    if (mast) {
      mast.mesh.updateMatrixWorld(true);
      const berthW = mast.berths.map((b) => {
        const p = mast.mesh.localToWorld(V(Math.cos(b.a) * b.r, b.y, Math.sin(b.a) * b.r));
        const c = mast.mesh.localToWorld(V(0, b.y, 0));
        return { p, out: V(p.x - c.x, 0, p.z - c.z).normalize() };
      });
      // two ships stay moored; the third berth serves the sky-ship lines
      for (let k = 0; k < 2 && k < berthW.length; k++) this.docked.push(berthW[k]);
      const B = berthW[2] || berthW[0];
      const dests = [oc.islands.find((c) => c.id === 'austral'), oc.islands.find((c) => c.id === 'thalassa')];
      dests.forEach((dst, i) => {
        if (!dst) return;
        const nose = B.p.clone().addScaledVector(B.out, 115);         // the ship's centre when its nose is at the berth
        const y0 = nose.y - 34;
        const cruise = 760 + i * 90;
        const away = nose.clone().addScaledVector(B.out, 700).setY(y0 + 60);
        const ctr = V(dst.ix, cruise, dst.iz);
        const ctrl = [nose.clone().setY(y0), away, nose.clone().addScaledVector(B.out, 2400).setY(cruise)];
        for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; ctrl.push(V(ctr.x + Math.cos(a) * 1800, cruise, ctr.z + Math.sin(a) * 1800)); }
        ctrl.push(nose.clone().addScaledVector(B.out, 2600).setY(cruise), nose.clone().addScaledVector(B.out, 800).setY(y0 + 90), nose.clone().addScaledVector(B.out, 200).setY(y0 + 10));
        const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
        const pts = curve.getSpacedPoints(Math.ceil(curve.getLength() / 25));
        pts.pop();
        const route = this.bank.add({ polyline: pts, speed: (s, L, p) => (p.distanceTo(nose) < 900 ? 4 : 24), accel: 0.18, decel: 0.18, latAccel: 0.3, bankMax: 0.04, pitchSpeeds: [2, 12], stops: [{ s: 0, dwell: 160 }] });
        route.name = `skyship-${dst.id}`;
        add('skyship', route, 1);
      });
    }
    // ---- build
    this.tex = this.bank.build();
    const geos = { train: trainGeometry(3, 24), canal: trainGeometry(2, 14), ferry: ferryGeometry(), launch: launchGeometry(), gondola: gondolaGeometry(), skyship: skyshipGeometry() };
    const mats = {
      train: vehicleMaterial('pearl', 1301, this.tex, 3600),
      canal: vehicleMaterial('jade', 1302, this.tex, 2200),
      ferry: vehicleMaterial('pearl', 1303, this.tex, 4500),
      launch: vehicleMaterial('sand', 1304, this.tex, 1800),
      gondola: vehicleMaterial('silver', 1305, this.tex, 2400),
      skyship: vehicleMaterial('silver', 1306, this.tex, 42000),
    };
    this.meshes = [];
    this.count = 0;
    for (const cls of Object.keys(this.fleet)) {
      const list = this.fleet[cls];
      if (!list.length) continue;
      const g = geos[cls];
      const ig = new THREE.InstancedBufferGeometry();
      ig.index = g.index;
      for (const k of Object.keys(g.attributes)) ig.setAttribute(k, g.attributes[k]);
      const route = new Float32Array(list.length * 4), lane = new Float32Array(list.length * 4);
      list.forEach((v, i) => { route.set([v.row, v.phase, v.rate, v.scale], i * 4); lane.set([v.lat, v.up, v.variant, v.seed], i * 4); });
      ig.setAttribute('aRoute', new THREE.InstancedBufferAttribute(route, 4));
      ig.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 4));
      ig.instanceCount = list.length;
      const mesh = new THREE.Mesh(ig, mats[cls]);
      mesh.frustumCulled = false;
      mesh.castShadow = false;           // placed in the vertex shader: the depth pass would not follow
      mesh.name = `transit-${cls}`;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.count += list.length;
    }
    // moored sky-ships (static)
    if (this.docked.length) {
      const sg = geos.skyship.clone();
      const parts = [];
      for (const d of this.docked) {
        const g = sg.clone();
        g.rotateY(Math.atan2(-d.out.x, -d.out.z));
        const c = d.p.clone().addScaledVector(d.out, 115);
        g.translate(c.x, c.y - 34, c.z);
        parts.push(g);
      }
      const m = new THREE.Mesh(mergeClean(parts), createFacadeMaterial('silver', 1307, { litFrac: 0.85, band: 1e5, colW: 2.4, floorH: 2.8, uplight: 0 }));
      m.name = 'moored sky-ships';
      m.castShadow = true;
      scene.add(m);
      this.meshes.push(m);
    }
  }
  update() {}
}
