import * as THREE from 'three';
import { CB, CK } from '../craft/craftGeometry.js';
import { buildFreighter, buildShuttle, lathe } from '../craft/craftClasses.js';
import { KIND, merge } from './hull.js';
import { createLamps, LAMP } from './lamps.js';
import { addEngines, placeLamps } from './craftMesh.js';
import { createRibbonMaterial, buildRibbonGeometry } from './lines.js';
import { SPACE_UTIL_GLSL } from './glsl.js';
import { M_KM, VIS_OMEGA } from './hearthLens.js';

// THE HEARTH REFUGE AT WORK (km, in the refuge's and the Hearth's own frames).
//
//   sleeves    a docking sleeve on the end of each service strut below the repair racks, a
//              bulk carrier lying bow-in against each sleeve face, away from both wheels
//   gallery    two gallery shuttles on one loop round the incoming gallery: out along one
//              side, round the gallery and back along the other, each stopping dorsal-hatch
//              to a transfer stub at both ends (half a loop apart, so they never meet)
//   feeder     a feeder ship inside the collector line pays a stream of matter into the
//              disc, prograde and spiralling in; the stream brightens and heats as it falls
//
// Everything draws with the Refuge's hull material (lit by the disc, faded where the lensed
// image lies in front), so the ships sit in the same light and the same lensing mask.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const CK_TO_KIND = { [CK.GLASS]: KIND.HAB, [CK.HULL]: KIND.PLATE, [CK.LANTERN]: KIND.GLOW, [CK.GARDEN]: KIND.HAB, [CK.CONDUIT]: KIND.GLOW, [CK.PANEL]: KIND.PANEL,
  [CK.BRONZE]: KIND.GOLD, [CK.DECK]: KIND.PLATE, [CK.DARK]: KIND.TRUSS, [CK.RADIATOR]: KIND.TRUSS, [CK.ROOF]: KIND.HAB, [CK.CONSERVATORY]: KIND.HAB };

/** A craft-builder geometry (metres, facade kinds) as a hull-material geometry in km. */
export function toHullKinds(geo, matrix = null, scale = 0.001) {
  const g = geo.clone();
  if (matrix) g.applyMatrix4(matrix);
  g.scale(scale, scale, scale);
  const f = g.getAttribute('aFacade'), n = g.attributes.position.count;
  const kind = new Float32Array(n);
  for (let i = 0; i < n; i++) kind[i] = CK_TO_KIND[Math.round(f.getZ(i))] ?? KIND.PLATE;
  g.deleteAttribute('aFacade');
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute('aSurface', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Orientation with +Z along fwd and +Y as close to up as possible. */
function basis(fwd, up, out = new THREE.Matrix4()) {
  const z = fwd.clone().normalize(), x = new THREE.Vector3().crossVectors(up, z).normalize(), y = new THREE.Vector3().crossVectors(z, x);
  return out.makeBasis(x, y, z);
}

// ------------------------------------------------------------------ sleeves ----
export const SLEEVE = { face: 7.8, radius: 0.5, carrier: 6.4 };

/** The docking sleeves (refuge-local km) and the bulk carriers berthed at them. */
export function buildRefugeSleeves(docks) {
  const B = new CB(), ships = [], lamps = [], berths = [];
  const fr = buildFreighter(1100);
  const bow = 0.53 * SLEEVE.carrier;                          // bow tip ahead of the carrier's centre (km)
  for (const d of docks) {
    const x = d.center.x, y = d.center.y - 0.5, z0 = 6.8;
    // the sleeve: a collar seated over the end of the service strut (radius 0.38), a glazed
    // transfer ring, a bronze rim and a dark docking face at z = SLEEVE.face
    B.at(x, y, 0);
    lathe(B, [[0.3, z0, CK.HULL], [0.46, z0 + 0.12, CK.HULL], [0.5, 7.0, CK.BRONZE], [0.5, 7.28, CK.GLASS], [0.5, 7.52, CK.HULL], [0.58, 7.6, CK.BRONZE], [0.58, 7.72, CK.BRONZE],
      [0.5, SLEEVE.face, CK.DARK], [0.12, SLEEVE.face, CK.DARK]], 36);
    B.pop();
    const faceC = V(x, y, SLEEVE.face);
    // the carrier: bow-in along -z, radiators edge-on to the refuge
    // (matrix in metres: the craft geometry is built in metres and scaled to km afterwards)
    const mm = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(x * 1000, y * 1000, (SLEEVE.face + bow) * 1000)
      .multiply(new THREE.Matrix4().makeScale(SLEEVE.carrier, SLEEVE.carrier, SLEEVE.carrier));
    ships.push(toHullKinds(fr.geo, mm));
    lamps.push(...placeLamps(fr.lamps, mm, 6).map((l) => ({ ...l, p: l.p.clone().multiplyScalar(0.001), r: l.r * 0.001 })));
    berths.push({ face: faceC, center: V(x, y, SLEEVE.face + bow), matrix: mm, forward: V(0, 0, -1) });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      lamps.push({ p: V(x + Math.cos(a) * 0.62, y + Math.sin(a) * 0.62, 7.66), r: 0.03, color: LAMP.AMBER, i: 2.4, breathe: 0.3, phase: k / 8 });
    }
  }
  const sleeves = B.geometry();
  return { sleeves, ships, lamps, berths };
}

// ------------------------------------------------------------ gallery loop ----
export const LOOP = { r: 2.9, berth: 2.5, tLine: 80, tTurn: 26, tDwell: 44, shuttle: 12 };

/**
 * The gallery shuttles' loop round the incoming gallery (refuge-local km): the gallery runs
 * from root (on the collector ring) to lower (under the spindle). Returns the loop frame,
 * the transfer stubs and a pose function pose(t, outPos, outFwd, outUp) -> throttle.
 */
export function galleryLoop(root, lower) {
  const g = lower.clone().sub(root).normalize();
  const lat = new THREE.Vector3().crossVectors(g, V(0, 1, 0)).normalize();
  const n = new THREE.Vector3().crossVectors(lat, g).normalize();
  const cA = root.clone().addScaledVector(g, 9), cB = lower.clone().addScaledVector(g, -4.5);
  const hatch = V(0, 8.8, 6).multiplyScalar(LOOP.shuttle * 0.001);   // shuttle dorsal hatch, ship frame (km)
  // at each end the berth lies on +n; the ship's back (+Y) faces the gallery axis
  const ends = [
    { c: cB, from: lat, to: lat.clone().negate(), fwd: lat.clone().negate() },    // B: +lat round to -lat
    { c: cA, from: lat.clone().negate(), to: lat.clone(), fwd: lat.clone() },     // A: -lat round to +lat
  ];
  const stubs = ends.map((e) => {
    const end = e.c.clone().addScaledVector(n, LOOP.berth - hatch.y).addScaledVector(e.fwd, hatch.z);
    const start = e.c.clone().addScaledVector(n, 0.45).addScaledVector(e.fwd, hatch.z);
    return { start, end, dir: n.clone(), center: e.c.clone() };
  });
  const T = 2 * (LOOP.tLine + 2 * LOOP.tTurn + LOOP.tDwell);
  const _r = new THREE.Vector3();
  function turn(e, s, outPos, outFwd, outUp, into) {
    // half a turn round the gallery: angle from the side (0) to the berth (pi/2), the ship
    // settling radially onto the stub only once it is over it (and lifting off the same way)
    const ang = into ? (Math.PI / 2) * smooth(0, 0.7, s) : (Math.PI / 2) * (1 + smooth(0.3, 1, s));
    const rad = into ? LOOP.r - (LOOP.r - LOOP.berth) * smooth(0.72, 1, s) : LOOP.r - (LOOP.r - LOOP.berth) * (1 - smooth(0, 0.28, s));
    _r.copy(e.from).multiplyScalar(Math.cos(ang)).addScaledVector(n, Math.sin(ang));
    const along = e.to.clone().multiplyScalar(-1);
    // tangent of the arc from `from` toward `to` through n
    const tan = e.from.clone().multiplyScalar(-Math.sin(ang)).addScaledVector(n, Math.cos(ang));
    outPos.copy(e.c).addScaledVector(_r, rad);
    outUp.copy(_r).negate();
    // blend from the line heading onto the arc (arriving) and back (leaving)
    const line = into ? g.clone().multiplyScalar(e === ends[0] ? 1 : -1) : g.clone().multiplyScalar(e === ends[0] ? -1 : 1);
    const w = into ? smooth(0, 0.35, s) : 1 - smooth(0.65, 1, s);
    outFwd.copy(line).lerp(tan, w).normalize();
    void along;
    return (into ? s < 0.72 : s > 0.28) ? 0.25 : 0.05;
  }
  function pose(t, outPos, outFwd, outUp) {
    let ph = ((t % T) + T) % T;
    const seg = [LOOP.tLine, LOOP.tTurn, LOOP.tDwell, LOOP.tTurn, LOOP.tLine, LOOP.tTurn, LOOP.tDwell, LOOP.tTurn];
    let i = 0;
    while (i < seg.length - 1 && ph >= seg[i]) { ph -= seg[i]; i++; }
    const s = Math.min(ph / seg[i], 1);
    if (i === 0 || i === 4) {
      // along a side of the gallery: +lat outward (A to B), -lat homeward (B to A)
      const out = i === 0, sideV = out ? lat : lat.clone().negate();
      const a = out ? cA : cB, b = out ? cB : cA;
      outPos.copy(a).lerp(b, smooth(0, 1, s)).addScaledVector(sideV, LOOP.r);
      outFwd.copy(b).sub(a).normalize();
      outUp.copy(sideV).negate();
      return 0.6 * (1 - smooth(0.1, 0.3, s)) + 0.45 * smooth(0.7, 0.8, s) * (1 - smooth(0.9, 1, s));
    }
    const e = i < 4 ? ends[0] : ends[1];
    if (i === 2 || i === 6) {
      outPos.copy(e.c).addScaledVector(n, LOOP.berth);
      outFwd.copy(e.fwd); outUp.copy(n).negate();
      return 0;
    }
    return turn(e, s, outPos, outFwd, outUp, i === 1 || i === 5);
  }
  return { g, lat, n, cA, cB, stubs, hatch, T, pose };
}

/** Transfer stubs (refuge-local km): a pressure tube off the gallery and a collar at the hatch. */
export function buildGalleryStubs(loop) {
  const B = new CB();
  for (const s of loop.stubs) {
    B.tube([s.start, s.end.clone().addScaledVector(s.dir, -0.05)], 0.06, 12, CK.HULL);
    // collar: its face flush with the shuttle's hatch plane
    const m = basis(s.dir, loop.g).setPosition(s.end);
    B.push(m);
    lathe(B, [[0.05, -0.09, CK.HULL], [0.09, -0.07, CK.BRONZE], [0.09, -0.012, CK.BRONZE], [0.07, 0, CK.DARK], [0.02, 0, CK.DARK]], 24);
    B.pop();
  }
  return B.geometry();
}

// ------------------------------------------------------------------ feeder ----
// The feeder holds station inside the collector line and pays matter out slower than the
// circular speed, so it falls on a Kepler ellipse (apoapsis at the injector, periapsis well
// inside the disc) slightly inclined to the disc plane. The ribbon follows that orbit until it
// strikes the disc's rim, where the lens shader draws the hot spot and its sheared tail.
export const FEEDER = { r: 680, phi: 1.22, y: 18, scale: 9, rPeri: 250, rImpact: 420 };

/** The feeder's frame (Hearth frame, km): position, directions, injector root, throat, nozzle. */
export function feederFrame() {
  const { r, phi, y } = FEEDER;
  const pos = V(Math.cos(phi) * r, y, Math.sin(phi) * r);
  const prograde = V(Math.sin(phi), 0, -Math.cos(phi));        // the disc turns this way (decreasing phi)
  const inward = V(-Math.cos(phi), 0, -Math.sin(phi));
  const root = pos.clone().addScaledVector(inward, 0.2);
  const throat = pos.clone().addScaledVector(inward, 2.6).addScaledVector(prograde, 0.4);
  const nozzle = throat.clone().add(throat.clone().sub(root).normalize().multiplyScalar(0.4));
  return { pos, prograde, inward, root, throat, nozzle };
}

/**
 * The stream's orbit from the nozzle to the rim: points, arc length (km) and the fraction of
 * the fall time elapsed at each point (clumps released at equal intervals bunch up where the
 * gas is slow and string out as it speeds toward periapsis).
 */
export function feederStream(nozzle = feederFrame().nozzle, n = 180) {
  const ra = nozzle.length(), p0 = Math.atan2(nozzle.z, nozzle.x);
  const e = (ra - FEEDER.rPeri) / (ra + FEEDER.rPeri), pp = ra * (1 - e);
  const nuI = Math.acos((pp / FEEDER.rImpact - 1) / e);                 // true anomaly at the rim (< pi)
  const sinI = nozzle.y / (ra * Math.sin(Math.PI - nuI));               // inclination: the node lies at the rim
  const Mof = (nu) => { const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2)); return E - e * Math.sin(E); };
  const Mi = Mof(nuI);
  const pts = [], along = [], time = [];
  let L = 0;
  for (let k = 0; k <= n; k++) {
    const nu = k === n ? nuI : Math.PI - (Math.PI - nuI) * (k / n);
    const rr = pp / (1 + e * Math.cos(nu));
    const ph = p0 - (Math.PI - nu);
    const sLat = sinI * Math.sin(nu - nuI), cLat = Math.sqrt(1 - sLat * sLat);
    const q = V(Math.cos(ph) * rr * cLat, rr * sLat, Math.sin(ph) * rr * cLat);
    if (k) L += q.distanceTo(pts[k - 1]);
    pts.push(q); along.push(L);
    time.push(k === 0 ? 0 : (Math.PI - Mof(nu)) / (Math.PI - Mi));
  }
  return { pts, along, time, length: L, e, nuImpact: nuI, sinI };
}

/** Film time for the fall (s), at the same film speed as the disc's rotation (hearthLens VIS_OMEGA). */
export function feederFallSeconds(st) {
  const a = (FEEDER.rImpact / (1 - st.e * st.e) * (1 + st.e * Math.cos(st.nuImpact))) / M_KM;   // semi-major axis (M)
  const E = 2 * Math.atan(Math.sqrt((1 - st.e) / (1 + st.e)) * Math.tan(st.nuImpact / 2)), Mi = E - st.e * Math.sin(E);
  return (Math.PI - Mi) * Math.pow(a, 1.5) / VIS_OMEGA;
}

/** Where the stream meets the disc: radius (km) and Boyer-Lindquist azimuth (BL x, y = Hearth z, x). */
export const FEEDER_IMPACT = (() => {
  const s = feederStream(), end = s.pts[s.pts.length - 1];
  return { r: Math.hypot(end.x, end.z), phiBL: Math.atan2(end.x, end.z), point: end };
})();

/** The feeder ship and its matter stream (Hearth frame, km). */
export function buildFeeder() {
  const fr = buildFreighter(1100);
  const { pos, prograde, root, throat, nozzle } = feederFrame();
  const mm = basis(prograde, V(0, 1, 0)).setPosition(pos.clone().multiplyScalar(1000)).multiply(new THREE.Matrix4().makeScale(FEEDER.scale, FEEDER.scale, FEEDER.scale));
  const hull = toHullKinds(fr.geo, mm);
  // the injector: a boom from the ship's inboard flank, ending in a glowing throat that
  // faces along the stream
  const B = new CB();
  B.tube([root, throat], 0.14, 12, CK.HULL);
  const tq = basis(throat.clone().sub(root), V(0, 1, 0)).setPosition(throat);
  B.push(tq);
  lathe(B, [[0.14, -0.24, CK.HULL], [0.32, 0, CK.BRONZE], [0.4, 0.36, CK.DARK], [0.32, 0.4, CK.LANTERN], [0.16, 0.2, CK.LANTERN]], 24);
  B.pop();
  const injector = toHullKinds(B.geometry(), null, 1);
  const stream = feederStream(nozzle);
  const lamps = placeLamps(fr.lamps, mm, 6).map((l) => ({ ...l, p: l.p.clone().multiplyScalar(0.001), r: l.r * 0.001 }));
  lamps.push({ p: nozzle.clone(), r: 0.12, color: [1.0, 0.7, 0.4], i: 3.0, breathe: 0.4 });
  return { hull, injector, stream, pos, nozzle, matrix: mm, glows: fr.glows, lamps };
}

/** The stream as a ribbon: x of aData the km along it, y the fraction of the fall time. */
function streamRibbon(st) {
  const g = buildRibbonGeometry([{ pts: st.pts, along: st.along, id: 0 }]);
  const d = g.getAttribute('aData');
  for (let i = 0; i < st.pts.length; i++) for (let s = 0; s < 2; s++) d.setY(i * 2 + s, st.time[i]);
  return g;
}

const STREAM_FRAG = /* glsl */ `
uniform float uLen;
uniform float uFall;           // seconds for a clump to fall from the nozzle to the rim
uniform float uBehindMask;
uniform sampler2D uHearthTex;
uniform vec2 uHearthRes;
uniform float uHearthDepth;
${SPACE_UTIL_GLSL}
void main() {
  float x = clamp(vAcross, -1.0, 1.0);
  float s = vData.x, ft = clamp(vData.y, 0.0, 1.0);
  // a narrow jet from the injector that swells a little as it falls and heats
  float w = mix(0.22, 0.62, ft);
  float core = exp(-x * x / (2.0 * w * w));
  float halo = exp(-x * x * 2.2) * 0.12 * (1.0 - x * x);
  // clumps released at equal intervals: evenly spaced in fall time, so they string out as the
  // gas speeds toward periapsis (their mean once they are under a few pixels)
  float q = ft * 16.0 - uTime / uFall * 16.0;
  float fa = max(fwidth(ft * 16.0), 1e-4);
  float pp = fract(q) - 0.5;
  float pulse = mix(0.55, 0.25 + 1.5 * exp(-pp * pp * 18.0), 1.0 - smoothstep(0.12, 0.45, fa));
  // the injector does not run steadily: it pays the gas out in three long surges per fall, so
  // even from far off the stream reads as released matter in flight, never a drawn line
  float sg = fract(ft * 3.0 - uTime / uFall * 3.0);
  pulse *= 0.2 + 0.8 * smoothstep(0.0, 0.12, sg) * (1.0 - smoothstep(0.45, 0.95, sg));
  // gas heated as it falls: an incandescent orange at the nozzle, white-gold at the rim
  vec3 col = blackbody(mix(2100.0, 6200.0, ft * ft)) * (0.35 + 2.6 * ft * ft) * (core * pulse + halo);
  col *= smoothstep(0.0, 1.5, s) * (1.0 - smoothstep(uLen - 1.5, uLen, s) * 0.5);
  float m = 1.0;
  if (uBehindMask > 0.5 && length(vWorld - cameraPosition) > uHearthDepth) m = 1.0 - textureLod(uHearthTex, gl_FragCoord.xy / uHearthRes, 0.0).a;   // (explicit LOD: non-uniform branch)
  gl_FragColor = vec4(col * vCoverage * m, 0.0);
}
`;

/** Scene integration, built by the Hearth once its refuge exists. */
export class HearthWorks {
  constructor(hearth) {
    this.hearth = hearth;
    const mat = hearth.hullMat, mask = mat.uniforms;
    // ---- sleeves and their carriers (refuge-local)
    const sl = buildRefugeSleeves(hearth.refugeData.docks);
    this.sleeveData = sl;
    this.sleeves = new THREE.Mesh(merge([toHullKinds(sl.sleeves, null, 1), ...sl.ships]), mat);
    hearth.refuge.add(this.sleeves);
    // ---- gallery shuttles and their stubs
    const path = hearth.refugeApproach.path;
    this.loop = galleryLoop(path[0], path[1]);
    this.stubs = new THREE.Mesh(toHullKinds(buildGalleryStubs(this.loop), null, 1), mat);
    hearth.refuge.add(this.stubs);
    const sh = buildShuttle(110);
    const shGeo = toHullKinds(sh.geo, new THREE.Matrix4().makeScale(LOOP.shuttle, LOOP.shuttle, LOOP.shuttle));
    const shLamps = placeLamps(sh.lamps, new THREE.Matrix4().makeScale(LOOP.shuttle, LOOP.shuttle, LOOP.shuttle), 4).map((l) => ({ ...l, p: l.p.clone().multiplyScalar(0.001), r: l.r * 0.001 }));
    this.shuttles = [0, 1].map((i) => {
      const m = new THREE.Mesh(shGeo, mat);
      m.add(createLamps(shLamps, { minPx: 1.2, mask }));
      const glows = sh.glows.map((q) => ({ ...q, p: q.p.clone().multiplyScalar(LOOP.shuttle * 0.001), r: q.r * LOOP.shuttle * 0.001 }));
      const engines = addEngines(m, glows, { scale: 0.7, length: 10, throttle: 0 });
      hearth.refuge.add(m);
      return { mesh: m, engines, offset: i * this.loop.T * 0.5, pos: V(0, 0, 0), fwd: V(0, 0, 1), up: V(0, 1, 0) };
    });
    // ---- the feeder and its stream (Hearth frame)
    const fd = buildFeeder();
    this.feederData = fd;
    this.feeder = new THREE.Mesh(merge([fd.hull, fd.injector]), mat);
    // (a group in the Hearth's own frame, held inside the stations group so it shares its depth
    // slices: the stations are tilted 0.12 rad about z)
    this.frame = new THREE.Group();
    this.frame.rotation.z = -hearth.stations.rotation.z;
    hearth.stations.add(this.frame);
    this.frame.add(this.feeder);
    this.streamMat = createRibbonMaterial({ widthKm: 3.2, minPx: 1.3, frag: STREAM_FRAG, uniforms: {
      uLen: { value: fd.stream.length }, uFall: { value: feederFallSeconds(fd.stream) }, uBehindMask: mask.uBehindMask, uHearthTex: mask.uHearthTex, uHearthRes: mask.uHearthRes, uHearthDepth: mask.uHearthDepth,
    } });
    this.stream = new THREE.Mesh(streamRibbon(fd.stream), this.streamMat);
    this.stream.renderOrder = 12;
    this.frame.add(this.stream);
    // lamps: the sleeves and carriers, the feeder
    hearth.refuge.add(createLamps(sl.lamps, { minPx: 1.2, mask }));
    this.frame.add(createLamps(fd.lamps, { minPx: 1.2, mask }));
    // solid meshes cull against each depth slice (their bounds are exact); the stream expands on screen
    for (const o of [this.sleeves, this.stubs, this.feeder, this.stream, ...this.shuttles.map((s) => s.mesh)]) { o.frustumCulled = o !== this.stream; if (o !== this.stream) o.renderOrder = 3; }
    this._m = new THREE.Matrix4();
  }

  setSize(w, h) { this.streamMat.uniforms.uResolution.value.set(w, h); }

  update(sim, realTime) {
    const su = this.streamMat.uniforms;
    su.uTime.value = realTime;
    for (const s of this.shuttles) {
      const thr = this.loop.pose(realTime + s.offset, s.pos, s.fwd, s.up);
      s.mesh.position.copy(s.pos);
      s.mesh.quaternion.setFromRotationMatrix(basis(s.fwd, s.up, this._m));
      for (const e of s.engines) e.setThrottle(thr);
    }
  }
}
