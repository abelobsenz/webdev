import * as THREE from 'three';
import { createRibbonMaterial, buildRibbonGeometry } from './lines.js';
import { createHullMaterial, tag, merge, beam, KIND } from './hull.js';
import { R_EARTH, GEO_ALT, COUNTERWEIGHT_ALT, MERIDIAN_LON, bodyDir } from './sim.js';
import { HarbourStation } from './harbour.js';
import { stationFrame, buildPortStation, buildCounterworks } from './stations.js';
import { craftMesh, craftPart, addLamps } from './craftMesh.js';
import { ClimberCars } from './climbers.js';
import { buildCounterweightRock } from './counterweightRock.js';

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
uniform vec3 uGuide;     // westward separation of the two climber guide cables
uniform float uPx;
varying float vDir;
varying float vFade;
void main() {
  float ph = fract((uClimbT + aC.x) / ${CLIMB_PERIOD.toFixed(1)});
  // ease in and out of the stations
  float s = ph < 0.02 ? ph * ph / 0.04 : (ph > 0.98 ? 1.0 - (1.0 - ph) * (1.0 - ph) / 0.04 : ph);
  if (aC.y < 0.0) s = 1.0 - s;
  float alt = aC.z < 0.5 ? s * ${GEO_ALT.toFixed(1)} : ${GEO_ALT.toFixed(1)} + s * ${(COUNTERWEIGHT_ALT - GEO_ALT).toFixed(1)};
  vec3 p = uUp * (${R_EARTH.toFixed(1)} + alt) + uGuide * aC.y * 0.12;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vec4 mv = viewMatrix * w;
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  vDir = aC.y;
  // within a few tens of km the nearest climbers are real cars (src/space/climbers.js)
  vFade = clamp(3.0e5 / max(d, 1.0), 0.0, 1.0) * smoothstep(12.0, 50.0, d);
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

export class Elevator {
  constructor(space, q) {
    this.space = space;
    this.group = new THREE.Group();
    const up = bodyDir(0, MERIDIAN_LON);
    const guide = new THREE.Vector3().crossVectors(up,new THREE.Vector3(0,1,0)).normalize();
    this.up = up;
    // tether ribbon
    const pts = [], along = [];
    const alts = [];
    for (let a = 0; a < 1000; a += 4) alts.push(a);
    for (let a = 1000; a < COUNTERWEIGHT_ALT; a *= 1.02) alts.push(a);
    alts.push(COUNTERWEIGHT_ALT);
    // fine stations where people look at the cable from a few km: the Harbour, the Water Store
    // below it and the counterweight (a per-vertex width 700 km off made the ribbon a hairline)
    for (const [c, near, far] of [[GEO_ALT, 40, 600], [COUNTERWEIGHT_ALT, 60, 900]]) {
      for (let d = -far; d <= far; d += (Math.abs(d) < near ? 0.5 : 10)) { const a = c + d; if (a > 1000 && a < COUNTERWEIGHT_ALT) alts.push(a); }
    }
    alts.sort((x, y) => x - y);
    for (let i = alts.length - 1; i > 0; i--) if (alts[i] - alts[i - 1] < 0.2) alts.splice(i, 1);
    for (const a of alts) { pts.push(up.clone().multiplyScalar(R_EARTH + a)); along.push(a); }
    this.tetherMat = createRibbonMaterial({ widthKm: 0.03, minPx: 1.4, frag: TETHER_FRAG });
    const cables = [{pts,along,id:0}];
    for(const dir of [-1,1]) cables.push({pts:pts.map(p=>p.clone().addScaledVector(guide,dir*.12)),along,id:dir});
    this.tether = new THREE.Mesh(buildRibbonGeometry(cables), this.tetherMat);
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
      uniforms: { uClimbT: { value: 0 }, uUp: { value: up.clone() }, uGuide:{value:guide}, uPx: { value: 3 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.climbers = new THREE.Points(cg, this.climbMat);
    this.climbers.frustumCulled = false;
    this.climbers.renderOrder = 14;
    this.group.add(this.climbers);
    this.cars = new ClimberCars(space, up, aC);
    this.group.add(this.cars.group);
    // stations
    const qStation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    this.hullMats = [];
    const mkMat = (o) => { const m = createHullMaterial(o); this.hullMats.push(m); return m; };
    // the Geostationary Harbour (src/space/harbour.js), drawn with the ships' builder and material
    this.station = new HarbourStation();
    this.harbour = this.station.group;
    this.harbour.position.copy(up).multiplyScalar(R_EARTH + GEO_ALT);
    this.harbour.quaternion.copy(stationFrame(up));
    this.group.add(this.harbour);
    // Halo junction: the port station where the main tether passes through the ring, its
    // climber terminal in the axis (src/space/stations.js)
    const jn = buildPortStation({ junction: true });
    this.junctionMesh = craftMesh(jn.geo, { accent: [1.0, 0.78, 0.5], lit: 0.62 });
    this.junctionShips = craftPart(this.junctionMesh, jn.ships);
    this.junctionMesh.add(this.junctionShips);
    addLamps(this.junctionMesh, jn.lamps, { minPx: 1.3 });
    this.junction = new THREE.Group();
    this.junction.add(this.junctionMesh);
    this.junction.position.copy(up).multiplyScalar(R_EARTH + 620);
    stationFrame(up, this.junction.quaternion);
    this.group.add(this.junction);
    // counterweight
    const rock = buildCounterweightRock();
    this.counter = new THREE.Mesh(rock.geo, mkMat({ pattern: 0.08, accent: [1.0, 0.6, 0.35] }));
    this.counter.position.copy(up).multiplyScalar(R_EARTH + COUNTERWEIGHT_ALT + 10);
    this.counter.quaternion.copy(qStation);
    this.group.add(this.counter);
    // the works on the rock: arrival terminal, habitat ring, mining gantries, radiators
    const cw = buildCounterworks({ surfaceRadius: rock.surfaceRadius });
    this.counterData = cw;
    this.counterWorks = craftMesh(cw.geo, { accent: [1.0, 0.7, 0.4], lit: 0.6 });
    addLamps(this.counterWorks, cw.lamps, { minPx: 1.3 });
    this.counter.add(this.counterWorks);
    for (const o of [this.junction, this.counter]) o.traverse((c) => { c.frustumCulled = false; });
  }

  setSize(w, h) { this.tetherMat.uniforms.uResolution.value.set(w, h); this.climbMat.uniforms.uPx.value = Math.max(2, h / 400); }

  update(sim, realTime, dt, space) {
    const tu = this.tetherMat.uniforms;
    tu.uSunDir.value.copy(sim.sunDir); tu.uTime.value = realTime; tu.uSimT.value = sim.t % 1e6;
    this.climbMat.uniforms.uClimbT.value = sim.t % CLIMB_PERIOD;
    for (const m of this.hullMats) {
      m.uniforms.uSunDir.value.copy(sim.sunDir);
      m.uniforms.uTime.value = realTime;
      m.uniforms.uEarthPos.value.set(0, 0, 0);
    }
    // the Harbour's rings turn at their real 1 g rate in real time; its wings track the Sun
    if (space) this.station.update(sim, realTime, space);
    if (space) this.cars.update(sim, realTime, dt, space);
  }
}
