import * as THREE from 'three';
import { createRibbonMaterial, buildRibbonGeometry } from './lines.js';
import { createHullMaterial, tag, merge, beam, KIND } from './hull.js';
import { R_EARTH, GEO_ALT, COUNTERWEIGHT_ALT, MERIDIAN_LON, bodyDir } from './sim.js';

// Meridian's space elevator: the tether (surface -> Halo -> Geostationary
// Harbour -> counterweight), its climbers, and the stations along it.

const CLIMB_PERIOD = 53400;         // s: surface to GEO at ~2,400 km/h
const TETHER_FRAG = /* glsl */ `
float aaBand(float x, float P, float w) {
  // lamps every P km, w km long: a filtered band whose energy stays constant once it is
  // thinner than a pixel, so beacons never pop in and out as the view moves
  float d = abs(fract(x / P + 0.5) - 0.5) * P;
  float fw = max(fwidth(x), 1e-5);
  float W = max(w, fw);
  return clamp(1.0 - d / W, 0.0, 1.0) * min(1.0, w / fw);
}
void main() {
  vec3 sunL = spaceSunlight(uTransmittanceLUT, vWorld, uSunDir) * uSunE;
  float alt = vData.x;
  float fa = max(fwidth(alt), 1e-3);                     // km of tether per pixel
  // a round cable, not a flat strip: limb darkening across the ribbon and a specular
  // line where the sunlit side faces the viewer
  float x = clamp(vAcross, -1.0, 1.0);
  float cyl = sqrt(max(1.0 - x * x, 0.0));
  float spec = exp(-((x - 0.35) * 5.0) * ((x - 0.35) * 5.0));
  vec3 col = vec3(0.6, 0.62, 0.66) * sunL * (0.035 + 0.05 * cyl + 0.04 * spec) + vec3(0.03, 0.045, 0.07) * (0.5 + 0.5 * cyl);
  // sparse marker lights, not dashes
  float beacon = aaBand(alt, 250.0, 0.18) * (0.75 + 0.25 * sin(uTime * 1.5 + alt));
  col += vec3(1.0, 0.72, 0.4) * beacon * 1.5;
  // the power sheath: a faint blue glow with soft pulses climbing toward the Harbour
  // (their mean once a pulse is under a few pixels)
  float pp = fract(alt / 1500.0 - uTime * 0.02) - 0.5;
  float pulse = mix(0.07, exp(-pp * pp * 600.0), 1.0 - smoothstep(15.0, 60.0, fa));
  col += vec3(0.35, 0.6, 1.0) * (0.06 + 0.3 * pulse) * cyl;
  float fade = smoothstep(0.0, 3.0, alt);
  gl_FragColor = vec4(col * vCoverage * fade, 0.0);
}
`;

const CLIMB_VERT = /* glsl */ `
attribute vec3 aC;       // x: departure offset (s), y: +1 up / -1 down, z: 0 lower run, 1 upper run
uniform float uClimbT;   // sim seconds modulo the period
uniform vec3 uUp;        // body-frame direction of the tether
uniform float uPx;
varying float vDir;
varying float vFade;
void main() {
  float ph = fract((uClimbT + aC.x) / ${CLIMB_PERIOD.toFixed(1)});
  // ease in and out of the stations
  float s = ph < 0.02 ? ph * ph / 0.04 : (ph > 0.98 ? 1.0 - (1.0 - ph) * (1.0 - ph) / 0.04 : ph);
  if (aC.y < 0.0) s = 1.0 - s;
  float alt = aC.z < 0.5 ? s * ${GEO_ALT.toFixed(1)} : ${GEO_ALT.toFixed(1)} + s * ${(COUNTERWEIGHT_ALT - GEO_ALT).toFixed(1)};
  vec3 p = uUp * (${R_EARTH.toFixed(1)} + alt) + vec3(aC.y * 0.004);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vec4 mv = viewMatrix * w;
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  vDir = aC.y;
  vFade = clamp(3.0e5 / max(d, 1.0), 0.0, 1.0);
  gl_PointSize = uPx * clamp(900.0 / max(d, 1.0), 1.0, 3.0);
}
`;
const CLIMB_FRAG = /* glsl */ `
varying float vDir;
varying float vFade;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 6.0);
  vec3 c = vDir > 0.0 ? vec3(1.0, 0.85, 0.6) : vec3(0.6, 0.85, 1.0);
  gl_FragColor = vec4(c * core * 2.4 * vFade, 0.0);
}
`;

function rng(seed) { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

function vnoise3(x, y, z) {
  const h = (i, j, k) => { let n = i * 374761393 + j * 668265263 + k * 1274126177; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const fi = Math.floor(x), fj = Math.floor(y), fk = Math.floor(z);
  const u = x - fi, v = y - fj, w = z - fk;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v), sw = w * w * (3 - 2 * w);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h(fi, fj, fk), h(fi + 1, fj, fk), su), L(h(fi, fj + 1, fk), h(fi + 1, fj + 1, fk), su), sv),
    L(L(h(fi, fj, fk + 1), h(fi + 1, fj, fk + 1), su), L(h(fi, fj + 1, fk + 1), h(fi + 1, fj + 1, fk + 1), su), sv), sw);
}

function buildHarbour() {
  const parts = [];
  const rings = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // spindle along the tether (local +Y points away from the Earth)
  parts.push(tag(new THREE.CylinderGeometry(0.75, 0.75, 28, 20, 1), KIND.PLATE));
  for (const y of [-10, -8.4, 8.4, 10]) parts.push(tag(new THREE.CylinderGeometry(1.5, 1.5, 1.4, 24).translate(0, y, 0), KIND.HAB));
  parts.push(tag(new THREE.CylinderGeometry(2.4, 1.2, 1.8, 24).translate(0, -13.2, 0), KIND.GOLD));
  parts.push(tag(new THREE.CylinderGeometry(1.2, 2.4, 1.8, 24).translate(0, 13.2, 0), KIND.GOLD));
  parts.push(tag(new THREE.TorusGeometry(1.2, 0.1, 6, 32).rotateX(Math.PI / 2).translate(0, 14.2, 0), KIND.GLOW));
  parts.push(tag(new THREE.TorusGeometry(1.2, 0.1, 6, 32).rotateX(Math.PI / 2).translate(0, -14.2, 0), KIND.GLOW));
  // docking arms with berths and ships
  const r = rng(7);
  const ships = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const y = i % 2 ? 2.4 : -2.4;
    const dir = V(Math.cos(a), 0, Math.sin(a));
    const L = 19 + (i % 3) * 3;
    parts.push(beam(dir.clone().multiplyScalar(0.8).setY(y), dir.clone().multiplyScalar(L).setY(y), 0.2, KIND.TRUSS, 6));
    for (let s = 3.5; s < L; s += 2.3) {
      const c = dir.clone().multiplyScalar(s).setY(y);
      const box = new THREE.BoxGeometry(0.7, 0.55, 0.7).translate(c.x, c.y, c.z);
      parts.push(tag(box, KIND.HAB));
      if (r() < 0.7) {
        // a docked ship hanging off the berth
        const side = r() < 0.5 ? 1 : -1;
        const len = 0.9 + r() * 1.6;
        const sg = new THREE.CylinderGeometry(0.16, 0.22, len, 8).translate(0, side * (len / 2 + 0.35), 0).translate(c.x, c.y, c.z);
        ships.push(tag(sg, KIND.PLATE));
        const eg = new THREE.CylinderGeometry(0.12, 0.12, 0.12, 8).translate(0, side * (len + 0.4), 0).translate(c.x, c.y, c.z);
        ships.push(tag(eg, KIND.GLOW));
      }
    }
    parts.push(tag(new THREE.BoxGeometry(0.4, 0.4, 0.4).translate(dir.x * L, y, dir.z * L), KIND.GLOW));
  }
  parts.push(...ships);
  // solar wings and radiators
  for (const s of [-1, 1]) {
    parts.push(tag(new THREE.BoxGeometry(26, 0.06, 6.5).translate(s * 16, 11.5, 0), KIND.PANEL));
    parts.push(beam(V(0, 11.5, 0), V(s * 29, 11.5, 0), 0.12, KIND.TRUSS, 5));
    parts.push(tag(new THREE.BoxGeometry(5, 0.05, 20).translate(0, -11.5, s * 12.5), KIND.PANEL));
  }
  const body = merge(parts);
  // three counter-rotating habitat rings with spokes
  for (const [y, R, tube, dirn] of [[-6, 7.2, 0.5, 1], [0, 10.6, 0.7, -1], [6, 7.2, 0.5, 1]]) {
    const rp = [tag(new THREE.TorusGeometry(R, tube, 14, 180).rotateX(Math.PI / 2).translate(0, y, 0), KIND.HAB)];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      rp.push(beam(V(Math.cos(a) * 0.8, y, Math.sin(a) * 0.8), V(Math.cos(a) * (R - tube), y, Math.sin(a) * (R - tube)), 0.14, KIND.TRUSS, 5));
    }
    rp.push(tag(new THREE.TorusGeometry(R, tube * 0.18, 5, 180).rotateX(Math.PI / 2).translate(0, y + tube * 0.95, 0), KIND.GLOW));
    rings.push({ geo: merge(rp), dir: dirn, omega: Math.sqrt(0.0098 / R) });
  }
  return { body, rings };
}

function buildCounterweight() {
  const g = new THREE.IcosahedronGeometry(9, 5);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    let h = 0, a = 1, f = 0.25;
    for (let o = 0; o < 5; o++) { h += a * (vnoise3(v.x * f + 3, v.y * f, v.z * f) - 0.5); a *= 0.5; f *= 2.1; }
    const squash = 1 + 0.25 * n.x * n.x - 0.15 * n.z * n.z;
    v.copy(n).multiplyScalar(9 * squash * (1 + h * 0.5));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const rock = tag(g, KIND.TRUSS);
  const parts = [rock];
  parts.push(tag(new THREE.TorusGeometry(10.5, 0.25, 8, 120).rotateX(Math.PI / 2), KIND.HAB));
  parts.push(tag(new THREE.TorusGeometry(10.5, 0.08, 5, 120).rotateX(Math.PI / 2).translate(0, 0.3, 0), KIND.GLOW));
  parts.push(tag(new THREE.CylinderGeometry(1.2, 1.2, 4, 16).translate(0, -10, 0), KIND.HAB));
  return merge(parts);
}

export class Elevator {
  constructor(space, q) {
    this.space = space;
    this.group = new THREE.Group();
    const up = bodyDir(0, MERIDIAN_LON);
    this.up = up;
    // tether ribbon
    const pts = [], along = [];
    const alts = [];
    for (let a = 0; a < 1000; a += 4) alts.push(a);
    for (let a = 1000; a < COUNTERWEIGHT_ALT; a *= 1.02) alts.push(a);
    alts.push(COUNTERWEIGHT_ALT);
    for (const a of alts) { pts.push(up.clone().multiplyScalar(R_EARTH + a)); along.push(a); }
    this.tetherMat = createRibbonMaterial({ widthKm: 0.03, minPx: 1.4, frag: TETHER_FRAG });
    this.tether = new THREE.Mesh(buildRibbonGeometry([{ pts, along, id: 0 }]), this.tetherMat);
    this.tether.frustumCulled = false;
    this.tether.renderOrder = 12;
    this.group.add(this.tether);
    // climbers
    const n = q.climbers;
    const aC = [];
    const upN = Math.floor(n * 0.42), dnN = Math.floor(n * 0.42), hiN = n - upN - dnN;
    for (let i = 0; i < upN; i++) aC.push((i / upN) * CLIMB_PERIOD, 1, 0);
    for (let i = 0; i < dnN; i++) aC.push(((i + 0.5) / dnN) * CLIMB_PERIOD, -1, 0);
    for (let i = 0; i < hiN; i++) aC.push((i / hiN) * CLIMB_PERIOD, i % 2 ? 1 : -1, 1);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(aC.length), 3));
    cg.setAttribute('aC', new THREE.Float32BufferAttribute(aC, 3));
    this.climbMat = new THREE.ShaderMaterial({
      vertexShader: CLIMB_VERT, fragmentShader: CLIMB_FRAG,
      uniforms: { uClimbT: { value: 0 }, uUp: { value: up.clone() }, uPx: { value: 3 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.climbers = new THREE.Points(cg, this.climbMat);
    this.climbers.frustumCulled = false;
    this.climbers.renderOrder = 14;
    this.group.add(this.climbers);
    // stations
    const qStation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    this.hullMats = [];
    const mkMat = (o) => { const m = createHullMaterial(o); this.hullMats.push(m); return m; };
    const harbour = buildHarbour();
    const hMat = mkMat({ pattern: 0.045, accent: [0.55, 0.85, 1.0] });
    this.harbour = new THREE.Group();
    this.harbour.position.copy(up).multiplyScalar(R_EARTH + GEO_ALT);
    this.harbour.quaternion.copy(qStation);
    this.harbour.add(new THREE.Mesh(harbour.body, hMat));
    this.harbourRings = harbour.rings.map((r) => { const m = new THREE.Mesh(r.geo, hMat); m.userData = r; this.harbour.add(m); return m; });
    this.group.add(this.harbour);
    // Halo junction: where the tether passes through the ring
    const jParts = [tag(new THREE.CylinderGeometry(2.2, 2.2, 5, 24), KIND.HAB), tag(new THREE.TorusGeometry(4.6, 0.5, 10, 64).rotateX(Math.PI / 2), KIND.HAB),
      tag(new THREE.TorusGeometry(4.6, 0.12, 5, 64).rotateX(Math.PI / 2).translate(0, 0.6, 0), KIND.GLOW)];
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; jParts.push(beam(new THREE.Vector3(Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2), new THREE.Vector3(Math.cos(a) * 4.2, 0, Math.sin(a) * 4.2), 0.25, KIND.TRUSS, 5)); }
    this.junction = new THREE.Mesh(merge(jParts), mkMat({ pattern: 0.05, accent: [1.0, 0.75, 0.45] }));
    this.junction.position.copy(up).multiplyScalar(R_EARTH + 620 + 5.5);
    this.junction.quaternion.copy(qStation);
    this.group.add(this.junction);
    // counterweight
    this.counter = new THREE.Mesh(buildCounterweight(), mkMat({ pattern: 0.08, accent: [1.0, 0.6, 0.35] }));
    this.counter.position.copy(up).multiplyScalar(R_EARTH + COUNTERWEIGHT_ALT + 10);
    this.counter.quaternion.copy(qStation);
    this.group.add(this.counter);
    for (const o of [this.harbour, this.junction, this.counter]) o.traverse((c) => { c.frustumCulled = false; c.renderOrder = 3; });
  }

  setSize(w, h) { this.tetherMat.uniforms.uResolution.value.set(w, h); this.climbMat.uniforms.uPx.value = Math.max(2, h / 400); }

  update(sim, realTime) {
    const tu = this.tetherMat.uniforms;
    tu.uSunDir.value.copy(sim.sunDir); tu.uTime.value = realTime; tu.uSimT.value = sim.t % 1e6;
    this.climbMat.uniforms.uClimbT.value = sim.t % CLIMB_PERIOD;
    for (const m of this.hullMats) {
      m.uniforms.uSunDir.value.copy(sim.sunDir);
      m.uniforms.uTime.value = realTime;
      m.uniforms.uEarthPos.value.set(0, 0, 0);
    }
    // habitat rings turn at their real 1 g rate in real time: driven by warped sim time
    // they spun many times per second and strobed
    for (const r of this.harbourRings) r.rotation.y = r.userData.dir * r.userData.omega * (realTime % 1e5);
  }
}
