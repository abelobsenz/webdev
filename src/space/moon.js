import * as THREE from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/uniforms.js';
import { SNOISE_GLSL } from './glsl.js';
import { createRibbonMaterial, buildRibbonGeometry } from './lines.js';
import { R_MOON } from './sim.js';
import { buildLunarPort, buildLunarRingDistricts } from './lunarPort.js';
import { stationFrame } from './stations.js';
import { addLamps, pixelRadius } from './craftMesh.js';
import { buildLunarServiceCourt } from './interfaces.js';
import { MoonSurface } from './moonSurface.js';
import { buildMediiLanding } from './lunarLanding.js';
import { lunarMesh, LUNAR_FRAME, LK, createLunarMaterial } from './lunarMaterial.js';
import { CB } from '../craft/craftGeometry.js';
import { LunarTraffic } from './lunarTraffic.js';
import { buildMediiWorks } from './lunarWorks.js';
import { LunarOutposts } from './lunarOutposts.js';
import { LunarHops } from './lunarHops.js';
import { LunarRingTrains } from './lunarRing.js';

// The terraformed Moon: seas in the old maria, green highlands softened craters,
// polar ice, clouds, city lights, a thin blue atmosphere and an equatorial ring.
// Moon frame: +X faces the Earth (near side), +Y ~ orbit normal.

// Thin atmosphere: analytic glow on a larger shell. Under a sixth of the Earth's gravity the
// air's scale height is ~40 km, so the limb carries a wide, soft blue haze (warm where the
// terminator crosses it, fading into the night), and the disc itself a faint aerial veil that
// thickens toward the edge.
const ATMO_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSunE;
uniform vec3 uCenter;
varying vec3 vWorld;
void main() {
  const float R = ${R_MOON.toFixed(1)};
  const float H = 40.0;
  vec3 ro = cameraPosition - uCenter;
  vec3 rd = normalize(vWorld - cameraPosition);
  float b = dot(ro, rd);
  float disc = b * b - dot(ro, ro) + R * R;
  float tHit = -b - sqrt(max(disc, 0.0));
  float chord = sqrt(6.2831853 * R * H);   // Chapman: grazing column through the shell
  vec3 up;
  float path;
  float rc = length(ro);
  if (rc < R + 229.0) {
    // inside the air (the shell is drawn from within): the column from the eye along the ray,
    // density falling as exp(-h / H). Toward the ground it ends at the surface; toward the sky
    // it is the one-way Chapman column, longest at the horizon, dipping below it from altitude
    vec3 upc = ro / max(rc, 1e-3);
    float muv = dot(upc, rd);
    float dc = exp(-max(rc - R, 0.0) / H);
    float halfC = 0.5 * chord;
    if (disc > 0.0 && tHit > 0.0) {
      up = normalize(ro + rd * tHit);
      path = min(H * (1.0 - dc) / max(-muv, 1e-4), tHit);
    } else {
      float rt = rc * sqrt(max(1.0 - muv * muv, 0.0));
      path = muv >= 0.0 ? dc * min(H / max(muv, 1e-3), halfC) : max(chord * exp(-max(rt - R, 0.0) / H) - halfC * dc, halfC * dc);
      up = upc;
    }
  } else if (disc > 0.0 && tHit > 0.0) {
    // looking down onto the surface: the column above the hit point
    up = normalize(ro + rd * tHit);
    path = min(H / max(dot(up, -rd), 1e-3), chord);
  } else {
    vec3 cp = ro + rd * max(-b, 0.0);
    float r = length(cp);
    up = cp / max(r, 1e-3);
    path = chord * exp(-max(r - R, 0.0) / H);
  }
  float mu = dot(up, uSunDir);
  float lit = smoothstep(-0.3, 0.15, mu);
  float cosT = dot(rd, uSunDir);
  vec3 ray = vec3(0.22, 0.46, 1.0) * (0.75 + 0.25 * cosT * cosT);
  vec3 sunset = vec3(1.0, 0.52, 0.28) * smoothstep(0.3, -0.05, mu) * lit;
  // single scattering saturates along the long grazing paths (a soft shoulder, not a hard rim)
  float pk = 1.0 - exp(-path / 520.0);
  vec3 col = (ray * lit + sunset * 0.8) * pk * uSunE * 0.011;
  col += vec3(1.0, 0.9, 0.8) * pow(max(cosT, 0.0), 12.0) * (path / chord) * uSunE * 0.008 * lit;
  gl_FragColor = vec4(col, 0.0);
}
`;
const ATMO_VERT = /* glsl */ `
varying vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0)); }
`;

const RING_VERT = /* glsl */ `
attribute vec3 aRing;
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vRing = aRing;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
}
`;
const RING_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSunE;
uniform float uTime;
uniform vec3 uCenter;
varying vec3 vRing;
varying vec3 vWorld;
varying vec3 vN;
${NOISE_GLSL}
void main() {
  if (fwidth(vRing.y) > 0.45) discard;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 p = vWorld - uCenter;
  // Moon's shadow on the ring
  float b = dot(p, uSunDir);
  float sh = b > 0.0 ? 1.0 : smoothstep(${R_MOON.toFixed(1)} - 20.0, ${R_MOON.toFixed(1)} + 20.0, length(p - uSunDir * b));
  vec3 sunL = uSunE * sh * vec3(1.0, 0.97, 0.93);
  float u = vRing.x, v = vRing.y;
  float across = v * 11.0;
  float px = max(fwidth(u), fwidth(across));
  float top = step(0.5, vRing.z);
  // A planned cross-section: a central service boulevard, paired transit lines,
  // garden terraces and neighbourhood halls beside two physical shield galleries.
  float garden = smoothstep(2.65,2.8,abs(across)) * (1.0-smoothstep(4.8,4.95,abs(across)));
  float district = fract(u / 17.32 + .5);
  float plaza = 1.0-smoothstep(.04,.075,abs(district-.5));
  float localWalk = 1.0-smoothstep(.11,.19,abs(abs(across)-3.0));
  float carriage = 1.0-smoothstep(.27,.36,abs(abs(across)-1.7));
  float verge = 1.0-smoothstep(.035+px,.07+px,abs(abs(across)-2.09));
  vec3 alb = mix(vec3(.35,.37,.38),vec3(.045,.065,.07),carriage);
  alb = mix(alb,vec3(.085,.14,.065),garden*(1.0-plaza*.8));
  alb = mix(alb,vec3(.49,.46,.4),max(localWalk,plaza*garden));
  alb = mix(vec3(.28,.29,.3),alb,top);
  vec3 col = alb / 3.14159 * sunL * max(dot(N,uSunDir),0.0);
  vec3 V = normalize(cameraPosition-vWorld);
  col += sunL * pow(max(dot(N,normalize(V+uSunDir)),0.0),55.0)*.045;
  // Bounded public lighting reveals longitudinal order in lunar night without giant
  // random square emitters. Narrow lights settle to their coverage when unresolved.
  float railLamp = exp(-pow((abs(across)-1.7)/max(.028,px*.7),2.0))*min(1.0,.028/max(px,.028));
  float walkLamp = exp(-pow((abs(across)-3.0)/max(.018,px*.7),2.0))*min(1.0,.018/max(px,.018));
  float buildingGlow = garden*plaza*.022;
  col += top*(alb*.034+vec3(.45,.8,1.0)*railLamp*.34+vec3(1.0,.72,.4)*(walkLamp*.24+buildingGlow)+vec3(.45,.64,.6)*verge*.025);
  gl_FragColor = vec4(col, 1.0);
}
`;
// The Lift's tether from Medii Landing up to the Exchange: a round cable in sunlight (cut by
// the Moon's shadow), a faint power sheath and marker lights every 20 km
const LIFT_FRAG = /* glsl */ `
uniform vec3 uCenter;
float aaBand(float x, float P, float w) {
  float d = abs(fract(x / P + 0.5) - 0.5) * P;
  float fw = max(fwidth(x), 1e-5);
  float W = max(w, fw);
  return clamp(1.0 - d / W, 0.0, 1.0) * min(1.0, w / fw);
}
void main() {
  vec3 p = vWorld - uCenter;
  float b = dot(p, uSunDir);
  float sh = b > 0.0 ? 1.0 : smoothstep(${(R_MOON - 5).toFixed(1)}, ${(R_MOON + 5).toFixed(1)}, length(p - uSunDir * b));
  float x = clamp(vAcross, -1.0, 1.0);
  float cyl = sqrt(max(1.0 - x * x, 0.0));
  vec3 col = vec3(0.62, 0.6, 0.56) * uSunE * sh * (0.03 + 0.05 * cyl) + vec3(0.03, 0.045, 0.07) * (0.4 + 0.6 * cyl);
  float alt = vData.x;
  col += vec3(1.0, 0.72, 0.4) * aaBand(alt, 20.0, 0.05) * 1.4;
  float pp = fract(alt / 60.0 - uTime * 0.05) - 0.5;
  float fa = max(fwidth(alt), 1e-3);
  col += vec3(0.45, 0.75, 1.0) * mix(0.06, exp(-pp * pp * 400.0) * 0.5, 1.0 - smoothstep(0.6, 3.0, fa));
  gl_FragColor = vec4(col * vCoverage, 0.0);
}
`;
const FAR_FRAG = /* glsl */ `
uniform vec3 uCenter;
void main() {
  vec3 p = vWorld - uCenter;
  float b = dot(p, uSunDir);
  float sh = b > 0.0 ? 1.0 : smoothstep(${(R_MOON - 20).toFixed(1)}, ${(R_MOON + 20).toFixed(1)}, length(p - uSunDir * b));
  vec3 col = vec3(0.42) * 0.3 * uSunE * sh * 0.5 + vec3(0.8, 0.88, 1.0) * (0.04 + 0.12 * (1.0 - sh));
  float fade = 1.0 - smoothstep(1.6, 3.2, vPx);
  gl_FragColor = vec4(col * vCoverage * fade, 0.0);
}
`;

export function buildBand(R, w, segs) {
  const pos = [], nor = [], ring = [], idx = [];
  const prof = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8 - 0.5; prof.push([t * w, 0, 0, 1, t]); }
  prof.push([w*.5,-.28,1,0,.5]);
  for(let i=7;i>=0;i--) {const t=i/8-.5;prof.push([t*w,-.28,0,-1,t]);}
  prof.push([-w*.5,0,-1,0,-.5]);
  const M = prof.length;
  for (let j = 0; j <= segs; j++) {
    const th = (j / segs) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    for (const [ax, dr, na, nr, v] of prof) {
      pos.push(c * (R + dr), ax, s * (R + dr));
      nor.push(c*nr, na, s*nr);
      ring.push(th * R, v, nr === 1 ? 1 : 0);
    }
  }
  for (let j = 0; j < segs; j++) for (let i = 0; i < M - 1; i++) {
    const a = j * M + i, b = a + M;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 3));
  g.setIndex(idx);
  return g;
}

const _lp = new THREE.Vector3();
const _lq = new THREE.Quaternion();
const _sunSite = new THREE.Vector3();

export class Moon {
  constructor(space) {
    this.space = space;
    this.group = new THREE.Group();
    this.uniforms = { uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunE: U.uSunIlluminance, uTime: { value: 0 } };
    // the ground: ray-traced on a proxy sphere (moonSurface.js); the Node verifiers build the Moon
    // without a renderer, and get its structures without the baked ground
    this.surface = space.renderer ? new MoonSurface(space) : null;
    this.mesh = this.surface ? this.surface.mesh : new THREE.Group();
    this.group.add(this.mesh);
    this.atmoU = { uSunDir: this.uniforms.uSunDir, uSunE: U.uSunIlluminance, uCenter: { value: new THREE.Vector3() } };
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(R_MOON + 230, 128, 64), new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, uniforms: this.atmoU,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
    }));
    this.atmo.renderOrder = 6;
    this.group.add(this.atmo);
    // equatorial ring (Moon frame XZ plane)
    this.ringU = { uSunDir: this.uniforms.uSunDir, uSunE: U.uSunIlluminance, uTime: this.uniforms.uTime, uCenter: this.atmoU.uCenter };
    this.ring = new THREE.Mesh(buildBand(R_MOON + 380, 11, 1800), new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, uniforms: this.ringU, side: THREE.DoubleSide }));
    this.ring.renderOrder = 3;
    this.group.add(this.ring);
    const pts = [], along = [];
    for (let k = 0; k <= 720; k++) { const th = (k / 720) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(th) * (R_MOON + 380), 0, Math.sin(th) * (R_MOON + 380))); along.push(th); }
    this.farMat = createRibbonMaterial({ widthKm: 11, minPx: 1.0, frag: FAR_FRAG, uniforms: { uCenter: this.atmoU.uCenter } });
    this.far = new THREE.Mesh(buildRibbonGeometry([{ pts, along, id: 0 }]), this.farMat);
    this.far.renderOrder = 11;
    this.group.add(this.far);
    this.districtData=buildLunarRingDistricts();
    this.districts=lunarMesh(this.districtData.geo,{accent:[.7,.85,1],lit:.5,side:THREE.DoubleSide});
    addLamps(this.districts,this.districtData.lamps,{minPx:1.1});   // lit halls, parapets and rails (src/space/lunarPort.js)
    this.group.add(this.districts);
    this.port = new THREE.Group();
    this.port.name='Tranquillity Exchange';
    this.port.position.set(R_MOON+380,0,0);
    stationFrame(new THREE.Vector3(1,0,0),this.port.quaternion);
    this.portData=buildLunarPort();
    // lunar material: sunlight stops at the Moon's horizon, the full Earth lights its nights
    const portMesh=lunarMesh(this.portData.geo,{accent:[.7,.85,1],lit:.6,side:THREE.DoubleSide});
    portMesh.name='Tranquillity terminal and receiving courts';
    addLamps(portMesh,this.portData.lamps,{minPx:1.2});
    this.port.add(portMesh);
    this.group.add(this.port);
    this.courtData=buildLunarServiceCourt();
    this.court=lunarMesh(this.courtData.geo,{accent:[.7,.85,1],lit:.6,side:THREE.DoubleSide});
    const courtAngle=8.35/(R_MOON+380),courtUp=new THREE.Vector3(Math.cos(courtAngle),0,Math.sin(courtAngle));
    this.court.position.copy(courtUp).multiplyScalar(R_MOON+380).setY(2.75);
    stationFrame(courtUp,this.court.quaternion);
    addLamps(this.court,this.courtData.lamps,{minPx:.65});
    this.group.add(this.court);
    // Medii Landing on the shore below the Exchange, and the Lift's tether between them
    this.landing = new THREE.Group();
    this.landing.name = 'Medii Landing';
    this.landing.position.set(R_MOON, 0, 0);
    stationFrame(new THREE.Vector3(1, 0, 0), this.landing.quaternion);
    this.landingData = buildMediiLanding();
    this.landingMesh = lunarMesh(this.landingData.geo, { lit: 0.6 });
    this.landingMesh.name = 'Medii Landing town, harbour, landing fields and mass driver';
    addLamps(this.landingMesh, this.landingData.lamps, { minPx: 1.0 });
    this.landing.add(this.landingMesh);
    {
      const top = this.landingData.liftTop.clone().multiplyScalar(0.001);
      const end = 380 - 0.9;
      const pts = [], along = [];
      for (let k = 0; k <= 96; k++) { const t = k / 96; const y = top.y + (end - top.y) * t * t; pts.push(new THREE.Vector3(top.x, y, top.z)); along.push(y); }
      this.liftMat = createRibbonMaterial({ widthKm: 0.006, minPx: 1.1, frag: LIFT_FRAG, uniforms: { uCenter: this.atmoU.uCenter } });
      this.lift = new THREE.Mesh(buildRibbonGeometry([{ pts, along, id: 0 }]), this.liftMat);
      this.lift.renderOrder = 12;
      this.landing.add(this.lift);
      // the collar that takes the tether under the Exchange's hub
      const C = new CB();
      C.at(0, -900, 0); C.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      C.lathe([[75, 3, 8], [75, -14, 8], [48, -40, 1], [20, -66, 8], [9, -74, 8], [0, -76, 8]], 32);
      C.pop(); C.pop();
      this.collar = lunarMesh(C.geometry(), { lit: 0.4 });
      this.port.add(this.collar);
      // lift cars riding the tether: six capsules with a lit band and glazed saloons, climbing
      // steadily (each enters the Exchange's collar as the next leaves the Crown)
      const K = new CB();
      K.push(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      K.lathe([[0, -16, LK.BRONZE], [4.2, -15, LK.HULL], [7, -11, LK.HULL], [7.2, -5, LK.GLASS], [7.2, 5, LK.GLASS], [7, 11, LK.HULL], [4.2, 15, LK.HULL], [0, 16, LK.BRONZE]], 16);
      K.lathe([[7.7, -0.7, LK.LANTERN], [7.7, 0.7, LK.LANTERN]], 16);
      K.lathe([[7.5, -12.2, LK.BRONZE], [7.5, -11.2, LK.BRONZE]], 16);
      K.lathe([[7.5, 11.2, LK.BRONZE], [7.5, 12.2, LK.BRONZE]], 16);
      K.pop();
      const carMat = createLunarMaterial({ lit: 0.85 });
      const carGeo = K.geometry();
      this.cars = [];
      this.carSpan = [top.y + 0.035, end - 0.06];
      this.carXZ = [top.x, top.z];
      for (let i = 0; i < 6; i++) {
        const m = lunarMesh(carGeo, {}, carMat);
        m.name = 'Lift car';
        this.landing.add(m);
        this.cars.push(m);
      }
    }
    this.group.add(this.landing);
    this.group.traverse((o) => { o.frustumCulled = false; });
    // the Works and the town's life (lunarTraffic.js) are built on first approach, the other
    // settlements (lunarOutposts.js) one at a time as the camera nears each
    this.life = null;
    this.outposts = new LunarOutposts(this.group);
    this.ringTrains = new LunarRingTrains(this.group);   // expresses on the ring's transit rails (lunarRing.js)
    this.hops = new LunarHops(this.group);           // hoppers between Medii and the outposts (lunarHops.js)
  }

  /** Build Medii Works and the Landing's traffic now (normally done on approach). */
  ensureLife() {
    if (this.life) return this.life;
    this.life = new LunarTraffic(this.landingData, { works: this._works || null });
    this.landing.add(this.life.group);
    return this.life;
  }

  setSize(w, h) { this.farMat.uniforms.uResolution.value.set(w, h); this.liftMat.uniforms.uResolution.value.set(w, h); }

  exposureHint(cam, space) {
    const rel = space.sim.moonPos.clone().sub(cam.position);
    const d = rel.length();
    const ang = Math.asin(Math.min(1, R_MOON / d));
    const fov = THREE.MathUtils.degToRad(cam.fov) * 0.5;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const off = Math.acos(THREE.MathUtils.clamp(rel.dot(fwd) / d, -1, 1));
    if (off > ang + fov * 1.4) return 0;
    const cover = Math.min(1, (ang * ang) / (fov * fov * 1.6));
    const phase = 0.5 + 0.5 * space.sim.sunDir.dot(rel.clone().normalize().negate());
    return cover * phase * 1.2;
  }

  // Down among the sunlit terraces of Medii Landing the eye stops down a further ~0.8 EV: pale
  // stone and paving fill the view there, not the dark-and-bright mix of a whole planet.
  exposureScale(cam, space) {
    if (!this.landing || !this.landingData) return 1;
    this.landing.getWorldPosition(_lp);
    const d = _lp.distanceTo(cam.position);
    if (d > 80) return 1;
    const mu = _lp.sub(space.sim.moonPos).normalize().dot(space.sim.sunDir);
    const near = 1 - THREE.MathUtils.smoothstep(d, 8, 80);
    const sunUp = THREE.MathUtils.smoothstep(mu, 0.02, 0.2);
    return 1 - 0.42 * near * sunUp;
  }

  update(sim, realTime) {
    this.group.position.copy(sim.moonPos);
    this.group.quaternion.copy(sim.moonQuat);
    this.group.updateMatrixWorld(true);
    const u = this.uniforms;
    u.uSunDir.value.copy(sim.sunDir);
    u.uTime.value = realTime;
    if (this.surface) this.surface.update(sim, realTime);
    LUNAR_FRAME.sunDir.copy(sim.sunDir);
    LUNAR_FRAME.moonPos.copy(sim.moonPos);
    LUNAR_FRAME.time = realTime;
    if (this.surface) LUNAR_FRAME.earthLit.value = this.surface.uniforms.uEarthLit.value;
    const lu = this.liftMat.uniforms;
    lu.uSunDir.value.copy(sim.sunDir);
    lu.uTime.value = realTime;
    if (this.space.camera) {
      const cam = this.space.camera;
      this.landing.getWorldPosition(_lp);
      this.landingMesh.visible = pixelRadius(cam, _lp, this.landingData.radius, this.space.size.y) > 1.5;
      // the lift cars climb at ~0.4 km/s, a quarter of an hour from the Crown to the Exchange
      const [y0, y1] = this.carSpan;
      for (let i = 0; i < this.cars.length; i++) {
        const car = this.cars[i];
        const f = ((i / this.cars.length + realTime / 900) % 1 + 1) % 1;
        car.position.set(this.carXZ[0], y0 + (y1 - y0) * f, this.carXZ[1]);
        car.updateMatrixWorld();
        car.getWorldPosition(_lp);
        car.visible = pixelRadius(cam, _lp, 0.016, this.space.size.y) > 0.6;
      }
    }
    if (this.space.camera) {
      const cam = this.space.camera.position;
      this.landing.getWorldPosition(_lp);
      // (built over two frames on approach: the Works' geometry, then the traffic that uses it)
      if (!this.life && _lp.distanceTo(cam) < 2500) {
        if (!this._works) this._works = buildMediiWorks(this.landingData.plan, this.landingData.driver, this.landingData.S.PADS);
        else this.ensureLife();
      }
      if (this.life) {
        this.landing.getWorldQuaternion(_lq).invert();
        _sunSite.copy(sim.sunDir).applyQuaternion(_lq);
        this.life.update(realTime, cam, this.landing, _sunSite);
      }
      this.outposts.update(realTime, cam, this.space.camera, this.space.size.y);
      this.hops.update(realTime);
      this.ringTrains.update(realTime, cam);
    }
    this.atmoU.uCenter.value.copy(sim.moonPos);
    // the air shell is seen from within below 229 km: draw its inner face then (the sky over the
    // Landing and the haze toward every horizon), its outer face from space
    if (this.space.camera) this.atmo.material.side = this.space.camera.position.distanceTo(sim.moonPos) < R_MOON + 229 ? THREE.BackSide : THREE.FrontSide;
    const fu = this.farMat.uniforms;
    fu.uSunDir.value.copy(sim.sunDir);
    fu.uBandAxis.value.set(0, 1, 0).applyQuaternion(sim.moonQuat);
    if(this.space.camera)this.court.visible=pixelRadius(this.space.camera,this.court.getWorldPosition(new THREE.Vector3()),this.courtData.radius,this.space.size.y)>3;
  }
}
