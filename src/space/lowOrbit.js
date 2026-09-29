import * as THREE from 'three';
import { createCraftMaterial, updateCraftMaterial } from '../craft/craftMaterial.js';
import { buildShuttle, buildCourier } from '../craft/craftClasses.js';
import { craftMesh, craftPart, addLamps, pixelRadius, KM, CRAFT_FRAME } from './craftMesh.js';
import { createLamps, LAMP } from './lamps.js';
import { createRibbonMaterial, buildRibbonGeometry } from './lines.js';
import { R_EARTH, MERIDIAN_LON, bodyDir } from './sim.js';
import { Orbit, MU, sunSyncInclination, nodeFacing, sunlitFraction } from './kepler.js';
import {
  buildHotel, hotelOmega, buildFarmDrum, buildFarmFrame, FARM, farmOmega, buildPolar, POLAR, polarOmega,
  buildPower, POWER, buildSkyhookHub, buildGrapple, SKYHOOK, buildSweeper, buildDebrisChunk, buildSatellites,
} from './leoStations.js';
import { Constellations } from './constellations.js';

// The low and middle shell: Meridian's orbital neighbourhood above the Halo. Everything here
// flies a real orbit from the sim clock (src/space/kepler.js), in the inertial frame:
//
//   Aurelia Wheel (hotel, 820 km, 51.6 deg)        Demeter Reach (farm, 1,050 km, 28 deg)
//   Boreal Watch (polar, 900 km, 90 deg)           Dawnline (sun-synchronous dawn-dusk, 1,200 km)
//   Anansi skyhook (rotovator, hub 1,250 km, 12 deg, 900 km of tether turning every 15 min,
//     catching hoppers launched from the Halo at the bottom of each tip's swing and throwing
//     them on at the top)
//   three Gleaner debris sweepers, their nets forward, fragments drifting in
//   shuttles between the Halo and the stations, docking nose-in at real ports
//   ~3,000 constellation satellites (src/space/constellations.js)
//
// Nothing orbits between 600 and 640 km: that is the Halo's altitude, and every orbit crosses
// the equator twice a lap. Far off, each station is a glint (sunlit) or a warm point (its
// windows, on the night side) and a faint trace of its orbit; closer, its lamps; closer
// still the full model with its wheels, drums, wings and emitters turning.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const HALO_R = R_EARTH + 620;
const EARTH_W = TAU / 86400;            // the sim turns the Earth once per 86,400 s
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4(), _w = new THREE.Vector3();
const _qi = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);
const _tb = new THREE.Vector3(), _tc = new THREE.Vector3();

/** Right-handed basis quaternion with z along zDir and y as close as possible to yHint. */
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4();
function basisQ(zDir, yHint, out) {
  _by.copy(yHint);
  _bz.copy(zDir).normalize();
  _by.addScaledVector(_bz, -_by.dot(_bz));
  if (_by.lengthSq() < 1e-10) _by.set(1, 0, 0).addScaledVector(_bz, -_bz.x);
  _by.normalize();
  _bx.crossVectors(_by, _bz);
  return out.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
}

// ---------------------------------------------------------------- glints --
const GLINT_VERT = /* glsl */ `
attribute vec4 aG;        // x: size (m), y: warm night light, z: sunlit fraction, w: fade (0 hidden)
uniform float uPx;
uniform vec3 uSun;
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 1e-3);
  // reflected sunlight falls with the square of the distance; a floor keeps the stations
  // findable as faint stars from the Moon's distance
  vec3 toCam = normalize(cameraPosition - position);
  float phase = 0.35 + 0.65 * (0.5 + 0.5 * dot(toCam, uSun));
  float sun = aG.z * phase * clamp(aG.x * 0.004 / d, 0.0, 1.0);
  float night = aG.y * (1.0 - aG.z) * clamp(aG.x * 0.0015 / d, 0.0, 0.6);
  // near in, the model and its lamps take over
  float near = smoothstep(aG.x * 0.004, aG.x * 0.02, d);
  vC = (vec3(1.0, 0.96, 0.9) * sun * 2.6 + vec3(1.0, 0.72, 0.42) * night * 2.2) * near * aG.w;
  gl_PointSize = uPx * clamp(2.0 + 3.0 * sun, 2.0, 4.0);
}
`;
const GLINT_FRAG = /* glsl */ `
varying vec3 vC;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vC * exp(-r2 * 5.0), 0.0);
}
`;

class Glints {
  constructor(n) {
    this.n = n;
    const g = new THREE.BufferGeometry();
    this.P = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3);
    this.G = new THREE.Float32BufferAttribute(new Float32Array(n * 4), 4);
    this.P.setUsage(THREE.DynamicDrawUsage); this.G.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.P); g.setAttribute('aG', this.G);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: GLINT_VERT, fragmentShader: GLINT_FRAG,
      uniforms: { uPx: { value: 3 }, uSun: { value: new THREE.Vector3(1, 0, 0) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 15;
  }
  set(i, p, size, warm, lit, fade) {
    const a = this.P.array, b = this.G.array;
    a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
    b[i * 4] = size; b[i * 4 + 1] = warm; b[i * 4 + 2] = lit; b[i * 4 + 3] = fade;
  }
  commit() { this.P.needsUpdate = true; this.G.needsUpdate = true; }
}

// ---------------------------------------------------------------- trails --
const TRAIL_FRAG = /* glsl */ `
uniform float uHead;
uniform vec3 uColor;
uniform float uGainT;
void main() {
  // the orbit as a faint thread, brighter for a stretch behind the station (its recent wake)
  float behind = fract(uHead - vData.x);
  float wake = exp(-behind * 14.0);
  float c = (0.05 + 0.5 * wake) * uGainT;
  gl_FragColor = vec4(uColor * c * vCoverage, 0.0);
}
`;

function trailFor(orbit, color, gain = 1) {
  // perifocal circle/ellipse; the mesh's matrix carries it to the precessing plane
  const pts = [], along = [], n = 360, e = orbit.e, pp = orbit.a * (1 - e * e);
  for (let k = 0; k <= n; k++) {
    const nu = (k / n) * TAU, r = pp / (1 + e * Math.cos(nu));
    pts.push(new THREE.Vector3(r * Math.cos(nu), r * Math.sin(nu), 0)); along.push(k / n);
  }
  const mat = createRibbonMaterial({ widthKm: 0.02, minPx: 1.0, frag: TRAIL_FRAG, uniforms: { uHead: { value: 0 }, uColor: { value: new THREE.Color(...color) }, uGainT: { value: gain } } });
  const mesh = new THREE.Mesh(buildRibbonGeometry([{ pts, along, id: 0 }]), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  mesh.matrixAutoUpdate = false;
  return { mesh, mat, orbit };
}

// -------------------------------------------------------------- stations --
function lampSet(mesh, lamps, minPx = 1.2) { return lamps && lamps.length ? addLamps(mesh, lamps, { minPx }) : null; }

class Station {
  constructor(name, orbit, radiusKm, glintSize, accent, lit = 0.62) {
    this.name = name; this.orbit = orbit; this.radius = radiusKm; this.glintSize = glintSize;
    this.root = new THREE.Group();
    this.root.name = name;
    this.mat = createCraftMaterial({ accent, lit });
    this.ports = [];
    this.px = 0;
    this.lit = 1;
    this.parts = [];
  }
  /** Position (km) and attitude at sim time t (pure: the traffic asks about other times). */
  frameAt(t, p, q) { this.orbit.pos(t, p); if (q) this.orbit.lvlh(t, q); return p; }
  /** World position of port k at sim time t, its outward direction in outDir. */
  portAt(k, t, out, outDir) {
    this.frameAt(t, out, _qi);
    const pt = this.ports[k % this.ports.length];
    _s.copy(pt.p).multiplyScalar(KM).applyQuaternion(_qi);
    out.add(_s);
    if (outDir) outDir.copy(pt.dir).applyQuaternion(_qi);
    return out;
  }
  place(t) { this.frameAt(t, this.root.position, this.root.quaternion); }
}

export class LowOrbit {
  constructor(space) {
    const t0 = performance.now();
    this.space = space;
    this.group = new THREE.Group();
    this.group.name = 'lowOrbit';
    this.stations = [];
    this.sun = new THREE.Vector3(1, 0, 0).copy(space?.sim?.sunDir || new THREE.Vector3(0.917, 0.397, 0));
    const sun = this.sun;

    // ---- Aurelia Wheel: the hotel (spin axis on the orbit normal, wings rolled to the Sun)
    {
      const o = new Orbit({ alt: 820, inc: 51.6 * DEG, node: 0.6, M0: 0.4 });
      const s = new Station('aurelia', o, 0.34, 520, [1.0, 0.78, 0.5], 0.72);
      const h = buildHotel();
      s.fixed = craftMesh(h.fixed, {}, s.mat);
      s.wheel = craftPart(s.fixed, h.wheel);
      s.fixed.add(s.wheel);
      lampSet(s.fixed, h.lamps); lampSet(s.wheel, h.wheelLamps);
      s.root.add(s.fixed);
      s.ports = h.ports;
      s.omega = hotelOmega();
      const hn = new THREE.Vector3();
      s.frameAt = (t, p, q) => { o.pos(t, p); if (q) basisQ(o.normal(t, hn), sun, q); return p; };
      s.animate = (rt) => { s.wheel.rotation.z = (s.omega * rt) % TAU; };
      s.meshes = [s.fixed];
      this.stations.push(s);
    }
    // ---- Demeter Reach: the farm (drum axes on the Sun, counter-rotating)
    {
      const o = new Orbit({ alt: 1050, inc: 28 * DEG, node: 2.3, M0: 2.1 });
      const s = new Station('demeter', o, 0.9, 1400, [0.75, 1.0, 0.55], 0.6);
      const fr = buildFarmFrame(), dr = buildFarmDrum();
      s.fixed = craftMesh(fr.geo, {}, s.mat);
      lampSet(s.fixed, fr.lamps);
      s.drums = [-1, 1].map((sx) => {
        const d = craftPart(s.fixed, dr.geo);
        d.position.set(sx * FARM.sep, 0, 0);
        lampSet(d, dr.lamps);
        s.fixed.add(d);
        return d;
      });
      s.root.add(s.fixed);
      s.ports = fr.ports;
      s.omega = farmOmega();
      s.drumSweep = dr.sweep;
      s.frameAt = (t, p, q) => { o.pos(t, p); if (q) basisQ(sun, Y, q); return p; };
      s.animate = (rt) => { const a = (s.omega * rt) % TAU; s.drums[0].rotation.z = a; s.drums[1].rotation.z = -a; };
      s.meshes = [s.fixed];
      this.stations.push(s);
    }
    // ---- Boreal Watch: polar, Earth-pointing; the centrifuge spins, the wings follow the Sun
    {
      const o = new Orbit({ alt: 900, inc: 90 * DEG, node: 1.1, M0: 4.0 });
      const s = new Station('boreal', o, 0.3, 320, [0.55, 0.9, 1.0], 0.6);
      const b = buildPolar();
      s.fixed = craftMesh(b.body, {}, s.mat);
      s.ring = craftPart(s.fixed, b.ring);
      s.wings = craftPart(s.fixed, b.wings);
      s.wings.position.set(0, POLAR.wingY, 0);
      s.fixed.add(s.ring, s.wings);
      lampSet(s.fixed, b.lamps); lampSet(s.ring, b.ringLamps); lampSet(s.wings, b.wingLamps);
      s.root.add(s.fixed);
      s.ports = b.ports;
      s.omega = polarOmega();
      s.animate = (rt) => {
        s.ring.rotation.y = (s.omega * rt) % TAU;
        // the Sun in the station's frame: turn the wings about x so their face (+y) meets it
        _s.copy(sun).applyQuaternion(_qi.copy(s.root.quaternion).invert());
        s.wings.rotation.x = Math.atan2(_s.z, _s.y);
      };
      s.meshes = [s.fixed];
      this.stations.push(s);
    }
    // ---- Dawnline: sun-synchronous dawn-dusk power station, array on the Sun, emitter on the ground
    {
      const alt = 1200, a = R_EARTH + alt, inc = sunSyncInclination(a);
      const o = new Orbit({ alt, inc, node: nodeFacing(sun, inc), M0: 1.2 });
      const s = new Station('dawnline', o, 1.0, 1900, [1.0, 0.55, 0.35], 0.55);
      const b = buildPower();
      s.fixed = craftMesh(b.body, {}, s.mat);
      s.emitter = craftPart(s.fixed, b.emitter);
      s.emitter.position.set(0, 0, POWER.pivotZ);
      s.fixed.add(s.emitter);
      lampSet(s.fixed, b.lamps); lampSet(s.emitter, b.emitterLamps);
      s.root.add(s.fixed);
      s.ports = b.ports;
      const pn = new THREE.Vector3();
      s.frameAt = (t, p, q) => { o.pos(t, p); if (q) basisQ(sun, o.normal(t, pn), q); return p; };
      s.animate = () => {
        // aim the emitter at the Earth's centre (the rectenna below), held off the array side
        _s.copy(s.root.position).negate().normalize().applyQuaternion(_qi.copy(s.root.quaternion).invert());
        if (_s.z > -0.05) { _s.z = -0.05; const k = Math.sqrt(Math.max(1 - 0.0025, 0) / Math.max(_s.x * _s.x + _s.y * _s.y, 1e-9)); _s.x *= k; _s.y *= k; }
        s.emitter.quaternion.setFromUnitVectors(_c.set(0, 0, 1), _s.normalize());
      };
      s.meshes = [s.fixed];
      this.stations.push(s);
    }
    // ---- Gleaner sweepers
    const sw = buildSweeper(), chunk = buildDebrisChunk();
    const swMat = createCraftMaterial({ accent: [1.0, 0.7, 0.35], lit: 0.5 });
    [[1380, 74, 0.2, 0.0], [760, 65, 3.9, 2.5], [1120, 35, 5.1, 4.4]].forEach(([alt, inc, node, M0], i) => {
      const o = new Orbit({ alt, inc: inc * DEG, node, M0 });
      const s = new Station(`gleaner${i}`, o, 0.12, 90, [1.0, 0.7, 0.35], 0.5);
      s.mat = swMat;
      s.fixed = craftMesh(sw.geo, {}, swMat);
      lampSet(s.fixed, sw.lamps);
      s.engine = createLamps(sw.glows.map((g) => ({ p: g.p, r: g.r * 1.6, color: [0.55, 0.8, 1.0], i: 3.5 })), { minPx: 1.2 });
      s.fixed.add(s.engine);
      // fragments drifting into the net, tumbling
      const N = 48;
      s.chunks = new THREE.InstancedMesh(chunk, swMat, N);
      s.chunks.count = N; s.chunks.frustumCulled = false; s.chunks.renderOrder = 3;
      s.chunks.onBeforeRender = s.fixed.onBeforeRender;
      s.chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      s.fixed.add(s.chunks);
      s.seed = i * 17.3 + 3.1;
      s.net = sw.net; s.netR = sw.netR;
      s.animate = (rt) => {
        for (let k = 0; k < N; k++) {
          const h1 = Math.sin(k * 12.9898 + s.seed) * 43758.5453, u = h1 - Math.floor(h1);
          const h2 = Math.sin(k * 78.233 + s.seed) * 12543.1234, v = h2 - Math.floor(h2);
          const f = (rt * (0.012 + 0.01 * u) + u * 7.1) % 1;             // 0 far ahead .. 1 in the net
          const ang = v * TAU, rr = s.netR * 0.8 * Math.sqrt((u * 3.7) % 1);
          _p.set(Math.cos(ang) * rr * (0.4 + 0.6 * f), Math.sin(ang) * rr * (0.4 + 0.6 * f), s.net.z + 380 * (1 - f) + 2);
          _e.set(rt * (0.3 + u), rt * (0.2 + v), k);
          _q.setFromEuler(_e);
          const sc = f > 0.97 ? Math.max((1 - f) / 0.03, 0.001) : 0.6 + 1.4 * v;
          _m.compose(_p, _q, _s.set(sc, sc, sc));
          s.chunks.setMatrixAt(k, _m);
        }
        s.chunks.instanceMatrix.needsUpdate = true;
        s.engine.material.uniforms.uGain.value = 0.35 + 0.25 * Math.sin(rt * 0.21 + s.seed);
      };
      s.root.add(s.fixed);
      s.meshes = [s.fixed];
      this.stations.push(s);
    });
    // ---- Anansi skyhook
    this.skyhook = this._buildSkyhook();
    for (const s of this.stations) this.group.add(s.root);
    this.group.add(this.skyhook.root);

    // ---- shuttles and hoppers (shared hulls, one material each class)
    this._buildTraffic();
    // ---- constellations
    this.constellations = new Constellations(buildSatellites());
    this.group.add(this.constellations.group);
    // ---- glints and trails
    this.glints = new Glints(this.stations.length + 3 + this.shuttles.length + this.hoppers.length);
    this.group.add(this.glints.points);
    this.trails = [];
    const tc = { aurelia: [1.0, 0.8, 0.5], demeter: [0.6, 1.0, 0.5], boreal: [0.5, 0.85, 1.0], dawnline: [1.0, 0.55, 0.35] };
    for (const s of this.stations) {
      const tr = trailFor(s.orbit, tc[s.name] || [0.7, 0.7, 0.75], tc[s.name] ? 1 : 0.5);
      tr.station = s;
      this.trails.push(tr);
      this.group.add(tr.mesh);
    }
    const st = trailFor(this.skyhook.orbit, [0.95, 0.9, 0.6], 1);
    st.station = this.skyhook;
    this.trails.push(st); this.group.add(st.mesh);
    this.group.traverse((o) => { o.frustumCulled = false; });
    this.buildMs = performance.now() - t0;
    if (space && space.addBody) this._bodies(space);
    this.byName = Object.fromEntries([...this.stations, this.skyhook].map((s) => [s.name, s]));
  }

  // ------------------------------------------------------------ skyhook --
  _buildSkyhook() {
    const L = SKYHOOK.halfKm;
    const o = new Orbit({ alt: 1250, inc: 12 * DEG, node: 4.2, M0: 0.9, j2: true });
    // tip speed relative to the hub 3.2 km/s: ~2.3 g at the grapples, a turn every ~15 min
    const omega = 3.2 / L;
    const s = new Station('anansi', o, 0.2, 260, [1.0, 0.85, 0.5], 0.6);
    s.L = L; s.omega = omega; s.theta0 = 0.7;
    s.relRate = omega - o.n;
    // tether ribbon (km, along local y), beacons and power pulses running out to the tips
    const pts = [], along = [];
    for (let y = -L; y <= L + 1e-6; y += 2) { pts.push(new THREE.Vector3(0, y, 0)); along.push(y); }
    s.tetherMat = createRibbonMaterial({
      widthKm: 0.006, minPx: 1.3, frag: /* glsl */ `
void main() {
  vec3 sunL = spaceSunlight(uTransmittanceLUT, vWorld, uSunDir) * uSunE;
  float y = abs(vData.x);
  float x = clamp(vAcross, -1.0, 1.0);
  float cyl = sqrt(max(1.0 - x * x, 0.0));
  vec3 col = vec3(0.62, 0.6, 0.55) * sunL * (0.03 + 0.05 * cyl) + vec3(0.05, 0.04, 0.03) * cyl;
  // amber marker collars every 25 km (their mean once they are subpixel: no fwidth needed,
  // the collar is 0.8 km long so it always spans a pixel at the ranges it is seen from)
  float d = abs(fract(y / 25.0 + 0.5) - 0.5) * 25.0;
  col += vec3(1.0, 0.62, 0.3) * (1.0 - smoothstep(0.2, 0.4, d)) * 1.2;
  // a pulse runs out along each arm every few seconds (the tether's inspection crawlers)
  float pp = fract(y / 450.0 - uTime * 0.08) - 0.5;
  col += vec3(0.95, 0.85, 0.55) * exp(-pp * pp * 900.0) * 0.5 * cyl;
  gl_FragColor = vec4(col * vCoverage, 0.0);
}
`,
    });
    s.tether = new THREE.Mesh(buildRibbonGeometry([{ pts, along, id: 0 }]), s.tetherMat);
    s.tether.renderOrder = 12;
    s.root.add(s.tether);
    const hub = buildSkyhookHub(), gr = buildGrapple();
    s.fixed = craftMesh(hub.geo, {}, s.mat);
    lampSet(s.fixed, hub.lamps);
    s.root.add(s.fixed);
    s.tips = [1, -1].map((sy) => {
      const g = craftMesh(gr.geo, {}, s.mat);
      g.position.set(0, sy * L, 0);
      if (sy > 0) g.rotation.z = Math.PI;          // its +y points back down the tether to the hub
      lampSet(g, gr.lamps);
      s.root.add(g);
      return g;
    });
    s.catchLocal = gr.catchPoint.clone().multiplyScalar(KM);     // below the tip, toward the tip's outboard side
    s.meshes = [s.fixed, ...s.tips];
    const kn = new THREE.Vector3(), kd = new THREE.Vector3();
    s.frameAt = (t, p, q) => {
      o.pos(t, p);
      if (q) {
        o.normal(t, kn);
        const th = s.theta0 + omega * t;
        kd.copy(o._N).multiplyScalar(Math.cos(th)).addScaledVector(o._M, Math.sin(th));
        basisQ(kn, kd, q);
      }
      return p;
    };
    return s;
  }

  /** Relative swing angle psi(t): tip A points straight down (at the Earth) when psi = pi mod 2 pi. */
  _psi(t) { const s = this.skyhook; return s.theta0 - s.orbit.M0 + s.relRate * t; }

  /** Tip k's world position at sim time t (catch point below the grapple), velocity into v. */
  _tipAt(k, t, out, v) {
    const s = this.skyhook, o = s.orbit;
    o.pos(t, out);
    const th = s.theta0 + s.omega * t + (k ? Math.PI : 0);
    const L = s.L + Math.abs(s.catchLocal.y);
    _tb.copy(o._N).multiplyScalar(Math.cos(th)).addScaledVector(o._M, Math.sin(th));
    if (v) {
      o.vel(t, v);
      _tc.copy(o._N).multiplyScalar(-Math.sin(th)).addScaledVector(o._M, Math.cos(th));
      v.addScaledVector(_tc, s.omega * L);
    }
    return out.addScaledVector(_tb, L);
  }

  // ------------------------------------------------------------ traffic --
  _buildTraffic() {
    const sh = buildShuttle(64), hp = buildCourier(52);
    this.shuttleMat = createCraftMaterial({ accent: [0.6, 0.85, 1.0], lit: 0.7 });
    this.hopperMat = createCraftMaterial({ accent: [1.0, 0.72, 0.45], lit: 0.7 });
    const mk = (d, mat) => {
      const m = craftMesh(d.geo, {}, mat);
      lampSet(m, d.lamps, 1.0);
      const e = createLamps(d.glows.map((g) => ({ p: g.p.clone(), r: g.r * 1.8, color: [0.55, 0.8, 1.0], i: 4 })), { minPx: 1.2 });
      m.add(e);
      const n = new THREE.Group();
      n.add(m);
      this.group.add(n);
      return { root: n, mesh: m, engine: e, len: d.length };
    };
    // halo terminals: Meridian's junction and the Nauru port (Earth-fixed, on the Halo deck)
    this.haloDirs = [bodyDir(0, MERIDIAN_LON), bodyDir(0, THREE.MathUtils.degToRad(166.9))];
    const routes = [
      ['halo0', 'aurelia', 'halo1', 'aurelia'], ['halo1', 'demeter', 'halo0', 'boreal'], ['halo0', 'dawnline', 'aurelia', 'halo1'],
      ['halo1', 'aurelia', 'demeter', 'halo0'], ['halo0', 'boreal', 'dawnline', 'halo1'], ['halo0', 'demeter', 'halo1', 'dawnline'],
      ['aurelia', 'halo0', 'boreal', 'halo1'], ['demeter', 'halo1', 'aurelia', 'halo0'],
    ];
    this.shuttles = routes.map((r, i) => {
      const legs = [];
      let T = 0;
      r.forEach((from, j) => {
        const to = r[(j + 1) % r.length];
        const D = 2400 + ((i * 7 + j * 3) % 5) * 260;
        const dwell = 900 + ((i + j) % 3) * 300;
        legs.push({ from, to, t0: T, D, dwell, port: (i + j) % 4 });
        T += D + dwell;
      });
      const s = mk(sh, this.shuttleMat);
      return { ...s, legs, cycle: T, phase: i * 1931.7, i };
    });
    this.hoppers = [0, 1, 2, 3].map(() => mk(hp, this.hopperMat));
  }

  /** A traffic node's position (and approach direction, velocity) at sim time t. */
  _node(name, port, t, out, dir, vel, sim) {
    if (name.startsWith('halo')) {
      const d = this.haloDirs[+name[4]];
      // the Halo deck turns with the Earth: its inertial position now, and the deck's velocity
      const th = (sim.theta0 || 0) + (t / 86400) * TAU;
      _q.setFromAxisAngle(Y, th);
      out.copy(d).applyQuaternion(_q).multiplyScalar(HALO_R + 3.5);
      if (dir) dir.copy(out).normalize();
      if (vel) vel.crossVectors(Y, out).multiplyScalar(EARTH_W);
      return out;
    }
    const s = this.byName[name];
    s.portAt(port, t, out, dir);
    if (vel) s.orbit.vel(t, vel);
    return out;
  }

  /**
   * A shuttle's transfer: a spiral arc round the Earth between the two nodes' radii at about the
   * local orbital rate (never through the planet), blended over the first and last tenth into
   * each end's real motion so it leaves and meets its port matched.
   */
  _transfer(leg, t, u, out, sim) {
    const tA = t - u * leg.D, tB = tA + leg.D;
    const p0 = this._node(leg.from, leg.port, tA, _a, null, null, sim);
    const r0 = p0.length();
    _w.copy(p0).divideScalar(r0);                      // departure direction
    const p1 = this._node(leg.to, leg.port, tB, _b, null, null, sim);
    const r1 = p1.length();
    _c.copy(p1).divideScalar(r1);
    // prograde sweep angle with extra laps to keep the mean rate near orbital
    _x.crossVectors(_w, _c);
    let ang = Math.atan2(_x.length(), _w.dot(_c));
    if (_x.y < 0) { ang = TAU - ang; _x.negate(); }
    if (_x.lengthSq() < 1e-12) _x.set(0, 1, 0); else _x.normalize();
    const nRate = Math.sqrt(MU / Math.pow(0.5 * (r0 + r1), 3));
    const laps = Math.max(0, Math.round((nRate * leg.D - ang) / TAU));
    const Phi = ang + laps * TAU;
    const su = u * u * (3 - 2 * u);
    _q.setFromAxisAngle(_x, Phi * u);
    out.copy(_w).applyQuaternion(_q).multiplyScalar(r0 + (r1 - r0) * su + Math.sin(Math.PI * u) * 60);
    // blends into the ends' real tracks
    const bA = 1 - smooth(0, 0.1, u), bB = smooth(0.9, 1, u);
    if (bA > 0) { this._node(leg.from, leg.port, t, _y, null, null, sim); out.lerp(_y, bA); }
    if (bB > 0) { this._node(leg.to, leg.port, t, _y, null, null, sim); out.lerp(_y, bB); }
    return out;
  }

  _shuttle(sh, t, sim, cam, H) {
    const tt = ((t + sh.phase) % sh.cycle + sh.cycle) % sh.cycle;
    let leg = sh.legs[sh.legs.length - 1];
    for (const L of sh.legs) if (tt >= L.t0 && tt < L.t0 + L.D + L.dwell) { leg = L; break; }
    const lt = tt - leg.t0;
    const root = sh.root;
    let thr = 0;
    if (lt >= leg.D) {
      // docked (or on the Halo apron) at the destination, nose in
      this._node(leg.to, leg.port, t, root.position, _z, null, sim);
      root.position.addScaledVector(_z, sh.len * 0.52 * KM);
      basisQ(_z.negate(), _y.copy(root.position).normalize(), root.quaternion);
      thr = 0;
    } else {
      const u = lt / leg.D;
      this._transfer(leg, t, u, root.position, sim);
      const du = Math.min(u + 0.002, 1), dd = Math.max(u - 0.002, 0);
      this._transfer(leg, t + (du - u) * leg.D, du, _p, sim);
      this._transfer(leg, t + (dd - u) * leg.D, dd, _c, sim);
      _p.sub(_c);
      if (_p.lengthSq() < 1e-12) _p.set(0, 0, 1);
      basisQ(_p, _y.copy(root.position).normalize(), root.quaternion);
      thr = u < 0.12 || (u > 0.45 && u < 0.52) || u > 0.9 ? 1 : 0.15;
    }
    sh.engine.material.uniforms.uGain.value = thr;
    const px = pixelRadius(cam, root.position, sh.len * KM, H);
    sh.mesh.visible = px > 0.6;
    sh.px = px;
  }

  // ------------------------------------------------------------- update --
  update(sim, realTime, dt, space) {
    const t = sim.t;
    const cam = space && space.camera;
    const H = space && space.size ? space.size.y : 1080;
    if (sim.sunDir) this.sun.copy(sim.sunDir);
    const sun = this.sun;
    let gi = 0;
    const gl = this.glints;
    for (const s of this.stations) {
      s.place(t);
      s.px = cam ? pixelRadius(cam, s.root.position, s.radius, H) : 100;
      s.lit = sunlitFraction(s.root.position, sun);
      const vis = s.px > 0.8;
      s.fixed.visible = vis;
      if (vis || s.px > 0.25) { s.root.updateMatrixWorld(); if (s.animate) s.animate(realTime); }
      gl.set(gi++, s.root.position, s.glintSize, 1, s.lit, 1);
    }
    // skyhook
    const sk = this.skyhook;
    sk.place(t);
    sk.px = cam ? pixelRadius(cam, sk.root.position, sk.L, H) : 100;
    sk.lit = sunlitFraction(sk.root.position, sun);
    const hubPx = cam ? pixelRadius(cam, sk.root.position, sk.radius, H) : 100;
    sk.fixed.visible = hubPx > 0.8;
    sk.tetherMat.uniforms.uSunDir.value.copy(sun);
    sk.tetherMat.uniforms.uTime.value = realTime;
    sk.tetherMat.uniforms.uSimT.value = t % 1e6;
    gl.set(gi++, sk.root.position, sk.glintSize, 1, sk.lit, 1);
    for (let k = 0; k < 2; k++) {
      sk.root.updateMatrixWorld();
      sk.tips[k].getWorldPosition(_p);
      const tipPx = cam ? pixelRadius(cam, _p, 0.08, H) : 100;
      sk.tips[k].visible = tipPx > 0.8;
      gl.set(gi++, _p, 160, 1, sunlitFraction(_p, sun), 1);
    }
    this._hoppers(t, sim, cam, H, gi);
    gi += this.hoppers.length;
    for (const sh of this.shuttles) {
      this._shuttle(sh, t, sim, cam, H);
      gl.set(gi++, sh.root.position, 70, 0.6, sunlitFraction(sh.root.position, sun), 1);
    }
    gl.mat.uniforms.uSun.value.copy(sun);
    gl.commit();
    // trails follow their precessing planes and mark where each station is on its lap
    for (const tr of this.trails) {
      const o = tr.orbit;
      o._solve(t);
      _m.makeBasis(o._N, o._M, o._h);
      tr.mesh.matrix.copy(_m);
      tr.mesh.matrixWorldNeedsUpdate = true;
      tr.mat.uniforms.uHead.value = (((o._nu / TAU) % 1) + 1) % 1;
      tr.mat.uniforms.uSunDir.value.copy(sun);
      // the trace fades out as you close on the station (it is a map, not a thing)
      const d = cam ? cam.position.distanceTo(tr.station.root.position) : 1e4;
      tr.mat.uniforms.uGainT.value = (tr.station.name.startsWith('gleaner') ? 0.45 : 1) * smooth(80, 2500, d);
    }
    this.constellations.update(t, realTime, sun, cam, H);
  }

  /** Hoppers: launched from the Halo, caught at the bottom of a tip's swing, thrown at the top. */
  _hoppers(t, sim, cam, H, gi0) {
    const sk = this.skyhook;
    const rel = sk.relRate;
    const Ta = 420, half = Math.PI / rel, Td = 300;
    const psi = this._psi(t);
    // passages of a tip past the bottom: psi = pi + c pi, tip index c mod 2
    const cNow = Math.floor((psi - Math.PI) / Math.PI);
    let used = 0;
    for (let c = cNow - 2; c <= cNow + 1 && used < this.hoppers.length; c++) {
      const tc = t + (Math.PI + c * Math.PI - psi) / rel;
      const tr = tc + half;
      if (t < tc - Ta || t > tr + Td) continue;
      const hp = this.hoppers[used++];
      const k = ((c % 2) + 2) % 2;
      const root = hp.root;
      let thr = 0;
      if (t < tc) {
        // suborbital climb from the Halo deck to the catch point, arriving matched to the tip
        const tA = tc - Ta;
        this._tipAt(k, tc, _b, _c);                       // catch point and tip velocity then
        _y.copy(_b).setY(0).normalize();
        _x.copy(_c).setY(0).normalize();
        _a.copy(_y).addScaledVector(_x, -0.19).normalize();
        _a.multiplyScalar(HALO_R + 1.5);                   // launch rail on the Halo deck
        _w.crossVectors(Y, _a).multiplyScalar(EARTH_W);
        const u = (t - tA) / Ta;
        hermiteLocal(_a, _w, _b, _c, Ta, u, root.position, _p);
        basisQ(_p, _z.copy(root.position).normalize(), root.quaternion);
        thr = u < 0.55 ? 1 : 0.2 * (1 - u);
      } else if (t < tr) {
        // riding the grapple: belly toward the tip's outboard side, nose along the swing
        this._tipAt(k, t, root.position, _c);
        _z.copy(root.position).sub(_a.copy(sk.root.position)).normalize();         // away from the hub
        _c.sub(this.skyhook.orbit.vel(t, _w));                                      // velocity relative to the hub
        basisQ(_c, _z.negate(), root.quaternion);
        root.position.addScaledVector(_z, -0.006);
      } else {
        // thrown: the tip's full speed, on a free trajectory (short enough to step it as a parabola)
        const dt2 = t - tr;
        this._tipAt(k, tr, _a, _c);
        const r = _a.length();
        _w.copy(_a).multiplyScalar(-MU / (r * r * r));
        root.position.copy(_a).addScaledVector(_c, dt2).addScaledVector(_w, 0.5 * dt2 * dt2);
        basisQ(_c.addScaledVector(_w, dt2), _z.copy(root.position).normalize(), root.quaternion);
        thr = dt2 > 25 ? 1 : 0;
      }
      hp.engine.material.uniforms.uGain.value = thr;
      const px = cam ? pixelRadius(cam, root.position, 0.03, H) : 100;
      hp.mesh.visible = px > 0.6;
      hp.root.visible = true;
      this.glints.set(gi0 + used - 1, root.position, 60, 0.4, sunlitFraction(root.position, this.sun), 1);
    }
    for (let j = used; j < this.hoppers.length; j++) { this.hoppers[j].root.visible = false; this.glints.set(gi0 + j, _p.set(0, 0, 0), 0, 0, 0, 0); }
  }

  setSize(w, h) {
    for (const tr of this.trails) tr.mat.uniforms.uResolution.value.set(w, h);
    this.skyhook.tetherMat.uniforms.uResolution.value.set(w, h);
    this.glints.mat.uniforms.uPx.value = Math.max(2, h / 400);
    this.constellations.setSize(w, h);
  }

  /** Target pose: station centre and a local-vertical frame (the Earth below). */
  pose(name, sim, outPos, outQuat) {
    const s = this.byName[name];
    if (!s) return outPos || outQuat;
    if (outPos) { s.frameAt(sim.t, outPos); return outPos; }
    return s.orbit.lvlh(sim.t, outQuat);
  }

  _bodies(space) {
    for (const s of this.stations) space.addBody(`leo-${s.name}`, [s.root], () => s.root.position, s.radius * 1.15 + 0.05, { solid: true, hint: s.name.startsWith('gleaner') ? 0.2 : 0.6 });
    const sk = this.skyhook;
    const segA = new THREE.Vector3(), segB = new THREE.Vector3(), segP = new THREE.Vector3(), line = new THREE.Line3();
    space.addBody('leo-anansi', [sk.root], null, 0, {
      interval: (camPos) => {
        sk.root.updateMatrixWorld();
        segA.set(0, sk.L + 0.2, 0).applyMatrix4(sk.root.matrixWorld);
        segB.set(0, -sk.L - 0.2, 0).applyMatrix4(sk.root.matrixWorld);
        line.set(segA, segB);
        line.closestPointToPoint(camPos, true, segP);
        return [Math.max(0.002, segP.distanceTo(camPos) - 0.3), Math.max(segA.distanceTo(camPos), segB.distanceTo(camPos)) + 0.3];
      },
      solid: false, hint: 0.3,
    });
    const reach = R_EARTH + 20200 + 200;
    space.addBody('leo-shell', [this.constellations.group, this.glints.points, ...this.trails.map((t) => t.mesh), ...this.shuttles.map((s) => s.root), ...this.hoppers.map((h) => h.root)], null, 0, {
      interval: (camPos) => { const d = camPos.length(); return [Math.max(d - reach, 0.002), d + reach]; },
    });
  }

  /** Triangles in the unique geometry of the shell (for the budget checks). */
  triangles() {
    const seen = new Set();
    let n = 0;
    this.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry.index && !seen.has(o.geometry)) { seen.add(o.geometry); n += o.geometry.index.count / 3; } });
    return n;
  }
}

function smooth(a, b, x) { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }

/** Cubic Hermite (positions km, velocities km/s over D s); position in out, velocity in outV. */
function hermiteLocal(p0, v0, p1, v1, D, u, out, outV) {
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  out.set(h00 * p0.x + h10 * D * v0.x + h01 * p1.x + h11 * D * v1.x, h00 * p0.y + h10 * D * v0.y + h01 * p1.y + h11 * D * v1.y, h00 * p0.z + h10 * D * v0.z + h01 * p1.z + h11 * D * v1.z);
  const d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = -6 * u2 + 6 * u, d11 = 3 * u2 - 2 * u;
  outV.set((d00 * p0.x + d01 * p1.x) / D + d10 * v0.x + d11 * v1.x, (d00 * p0.y + d01 * p1.y) / D + d10 * v0.y + d11 * v1.y, (d00 * p0.z + d01 * p1.z) / D + d10 * v0.z + d11 * v1.z);
  return out;
}

/** Focus targets for the shell's stations (the Earth below, the station's lap ahead). */
export function leoTargets(space) {
  const P = (name) => ({
    position: (o) => (space.lowOrbit ? space.lowOrbit.pose(name, space.sim, o, null) : o.set(R_EARTH + 1000, 0, 0)),
    frame: (q) => (space.lowOrbit ? space.lowOrbit.pose(name, space.sim, null, q) : q.identity()),
  });
  return {
    aurelia: { ...P('aurelia'), minDist: 0.45, maxDist: 40000, defaultDist: 1.25, view: { az: 0.8, el: 0.35 } },
    demeter: { ...P('demeter'), minDist: 1.1, maxDist: 40000, defaultDist: 3.2, view: { az: 2.3, el: 0.4 } },
    boreal: { ...P('boreal'), minDist: 0.35, maxDist: 40000, defaultDist: 0.95, view: { az: 0.6, el: 0.15 } },
    dawnline: { ...P('dawnline'), minDist: 1.2, maxDist: 40000, defaultDist: 3.4, view: { az: 2.8, el: 0.5 } },
    anansi: { ...P('anansi'), minDist: 0.3, maxDist: 60000, defaultDist: 1.1, view: { az: 0.4, el: 0.3 } },
  };
}

export { updateCraftMaterial, CRAFT_FRAME };
