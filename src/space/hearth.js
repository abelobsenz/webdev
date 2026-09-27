import * as THREE from 'three';
import { FullscreenPass, FS_VERT } from '../core/fullscreen.js';
import { U } from '../core/uniforms.js';
import { SPACE_SKY_GLSL, SPACE_UTIL_GLSL, SNOISE_GLSL } from './glsl.js';
import { SKY_UNIFORMS } from './sky.js';
import { createHullMaterial, tag, merge, beam, KIND } from './hull.js';
import { R_EARTH, R_MOON } from './sim.js';

// THE HEARTH: a spinning black hole kept on a halo orbit around Sun-Earth L2.
// Each pixel integrates a photon path backwards through Schwarzschild spacetime
// (the exact null-geodesic orbit equation written as x'' = -3/2 h^2 x / r^5, in
// units of the horizon radius), with a frame-dragging term for an approximate
// Kerr look (a = 0.7): an asymmetric shadow, a prograde disc that reaches in
// to 1.7 r_s. The thin, slightly flared accretion disc is Doppler beamed and
// gravitationally shifted; every crossing of the disc plane adds light, so the
// far side of the disc appears lensed above and below the shadow, and higher
// order images build the photon ring. The starfield, Sun, Earth and Moon are
// looked up along the bent rays.

export const RS = 30;                   // horizon radius (km)
const R_IN = 1.7, R_OUT = 15.0;         // disc, in horizon radii
const R_INT = 60.0;                     // beyond this rays are bent analytically

const BH_FRAG = /* glsl */ `
precision highp float;
uniform mat4 uInvProj;
uniform mat3 uCamRot;          // camera -> world rotation
uniform mat3 uToBH;            // world -> hearth frame
uniform vec3 uCamBH;           // camera position, hearth frame, horizon units
uniform vec3 uCamW;            // camera position, world km
uniform float uTime;
uniform float uLensR;          // far mode: radius of the lensed region (horizon units); 0 = full screen
uniform vec3 uSunDir;
uniform float uSunE;
uniform vec3 uEarthPos;
uniform vec3 uMoonPos;
uniform float uSpin;
uniform float uDiscGain;
varying vec2 vUv;
${SPACE_UTIL_GLSL}
${SNOISE_GLSL}
${SPACE_SKY_GLSL}

vec3 bendToward(vec3 d, vec3 pos, float ang) {
  // rotate d toward the centre (-pos) by 'ang' radians, in the plane of d and pos
  vec3 axis = cross(d, -pos);
  float l = length(axis);
  if (l < 1e-6 || ang <= 0.0) return d;
  axis /= l;
  float c = cos(ang), s = sin(ang);
  return d * c + cross(axis, d) * s + axis * dot(axis, d) * (1.0 - c);
}

// analytic sphere in the far field (Earth / Moon seen from the Hearth)
vec4 farBody(vec3 ro, vec3 rd, vec3 c, float R, float isEarth) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float cc = dot(oc, oc) - R * R;
  float h = b * b - cc;
  float rAtm = R + (isEarth > 0.5 ? 100.0 : 30.0);
  float ha = b * b - (dot(oc, oc) - rAtm * rAtm);
  vec4 res = vec4(0.0);
  if (ha > 0.0 && -b > 0.0) {
    // limb glow
    float miss = sqrt(max(dot(oc, oc) - b * b, 0.0)) - R;
    vec3 tp = normalize(oc - rd * b);
    float lit = smoothstep(-0.3, 0.25, dot(tp, uSunDir));
    float fwd = pow(max(dot(rd, uSunDir), 0.0), 8.0);
    vec3 glow = mix(vec3(1.0, 0.45, 0.2), vec3(0.3, 0.55, 1.0), lit) * (lit * 0.4 + fwd * 3.0);
    res.rgb += glow * exp(-max(miss, 0.0) / (isEarth > 0.5 ? 18.0 : 10.0)) * uSunE * 0.05 * (isEarth > 0.5 ? 1.0 : 0.3);
  }
  if (h > 0.0 && -b > 0.0) {
    vec3 p = oc + rd * (-b - sqrt(h));
    vec3 n = normalize(p);
    float ndl = dot(n, uSunDir);
    float cl = smoothstep(0.1, 0.6, snoise(n * 6.0 + 2.0) * 0.5 + snoise(n * 17.0) * 0.25 + 0.3);
    vec3 alb = isEarth > 0.5 ? mix(vec3(0.02, 0.05, 0.12), vec3(0.8), cl) : mix(vec3(0.08, 0.12, 0.06), vec3(0.02, 0.05, 0.1), step(0.1, snoise(n * 4.0)));
    vec3 col = alb / 3.14159 * uSunE * max(ndl, 0.0);
    float night = 1.0 - smoothstep(-0.1, 0.05, ndl);
    col += vec3(1.0, 0.65, 0.35) * night * smoothstep(0.55, 0.8, snoise(n * 30.0) * 0.5 + 0.5) * 0.25 * isEarth;
    res = vec4(res.rgb + col, 1.0);
  }
  return res;
}

vec3 background(vec3 dirW, float px) {
  vec3 col = sk_background(dirW, px);
  col += sk_swarm(uCamW, dirW, px) * uSunE * 0.06;
  // the Sun, with the Earth and Moon in front of it where they overlap
  vec4 e = farBody(uCamW, dirW, uEarthPos, ${R_EARTH.toFixed(1)}, 1.0);
  vec4 m = farBody(uCamW, dirW, uMoonPos, ${R_MOON.toFixed(1)}, 0.0);
  vec3 sun = sk_sun(uCamW, dirW, px, uSunE);
  col += sun * (1.0 - e.a) * (1.0 - m.a);
  col = mix(col, e.rgb, e.a) + e.rgb * (1.0 - e.a);
  col = mix(col, m.rgb, m.a) + m.rgb * (1.0 - m.a);
  return col;
}

// ---- accretion disc ----
float discNoise(float r, float ph, float t) {
  // turbulence in co-rotating coordinates: streaks sheared by differential rotation
  vec2 q = vec2(log(r) * 7.5, ph * 2.2);
  float n = snoise(vec3(q * vec2(1.0, 1.0), t * 0.03));
  n += 0.5 * snoise(vec3(q * vec2(2.3, 3.1) + 7.0, t * 0.05));
  n += 0.25 * snoise(vec3(q * vec2(5.1, 9.0) + 3.0, t * 0.08));
  return n / 1.75;
}

vec4 discSample(vec3 hit, vec3 v, float crossCos) {
  float r = length(hit.xz);
  if (r < ${R_IN.toFixed(2)} * 0.97 || r > ${R_OUT.toFixed(1)}) return vec4(0.0);
  float x = r / ${R_IN.toFixed(2)};
  // Novikov-Thorne-like temperature profile with a zero-torque inner edge
  float T = pow(x, -0.75) * pow(max(1.0 - sqrt(1.0 / x), 0.0), 0.25) * 2.05;
  float Tk = 7200.0 * T;
  // Keplerian speed (local static frame), prograde about +y
  float beta = min(sqrt(0.5 / max(r - 1.0, 0.25)), 0.9);
  vec3 vdir = normalize(vec3(hit.z, 0.0, -hit.x));
  float cosT = dot(vdir, -normalize(v));
  float gam = inversesqrt(1.0 - beta * beta);
  float dop = 1.0 / (gam * (1.0 - beta * cosT));
  float grav = sqrt(max(1.0 - 1.0 / r, 0.02));
  float g = dop * grav;
  float phi = atan(hit.z, hit.x);
  float om = 1.4 / pow(r, 1.5);
  float ph = phi + om * uTime;
  float n = discNoise(r, ph, uTime);
  float lanes = 0.5 + 0.5 * snoise(vec3(log(r) * 26.0, ph * 0.35, uTime * 0.02));
  float dens = smoothstep(${R_IN.toFixed(2)} * 0.97, ${R_IN.toFixed(2)} * 1.12, r) * (1.0 - smoothstep(${R_OUT.toFixed(1)} * 0.45, ${R_OUT.toFixed(1)}, r));
  dens *= clamp(0.6 + 0.5 * n + 0.35 * (lanes - 0.5), 0.04, 1.4);
  // intensity ~ T^4 g^3 (beaming softened a little, as in the film)
  float gB = clamp(g, 0.25, 3.0);
  float I = pow(T, 4.0) * pow(gB, 3.2) * dens;
  vec3 col = blackbody(Tk * pow(gB, 0.9)) * I;
  // flared disc: grazing rays see more material
  float tau = dens * 1.6 / max(abs(crossCos), 0.08);
  float a = 1.0 - exp(-tau);
  return vec4(col * uDiscGain, a);
}

void main() {
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dirW = normalize(uCamRot * (v.xyz / v.w));
  vec3 rd = uToBH * dirW;
  vec3 ro = uCamBH;
  float rCam = length(ro);
  vec3 Lm = cross(ro, rd);
  float b = length(Lm);
  vec3 col = vec3(0.0);
  float alpha = 0.0;          // accumulated disc opacity
  bool captured = false;
  vec3 outDir;
  float inside = 1.0;
  if (uLensR > 0.0 && b > uLensR) inside = 0.0;
  float tStar = -dot(ro, rd);                         // closest approach along the straight ray
  if (b > ${R_INT.toFixed(1)} || (rCam > ${R_INT.toFixed(1)} && tStar < 0.0)) {
    // weak field: straight-line deflection, 2/b in total, part of it behind us
    float k = sqrt(max(1.0 - b * b / (rCam * rCam), 0.0));
    float ang = (1.0 / max(b, 1e-3)) * (tStar > 0.0 ? 1.0 + k : 1.0 - k);
    outDir = bendToward(rd, ro, ang);
  } else {
    vec3 pos = ro, vel = rd;
    float extra = 0.0;
    if (rCam > ${R_INT.toFixed(1)}) {
      vec2 hs = sphereHits(ro, rd, ${R_INT.toFixed(1)});
      pos = ro + rd * hs.x;
      float k = sqrt(max(1.0 - b * b / (rCam * rCam), 0.0));
      float kR = sqrt(max(1.0 - b * b / ${(R_INT * R_INT).toFixed(1)}, 0.0));
      extra = (1.0 / max(b, 1e-3)) * (k - kR);         // bending before the sphere
      vel = bendToward(rd, pos, extra);
    }
    float h2 = dot(cross(pos, vel), cross(pos, vel));
    vec3 spinAx = vec3(0.0, 1.0, 0.0);
    for (int i = 0; i < STEPS; i++) {
      float r = length(pos);
      if (r < 1.0) { captured = true; break; }
      float dt = clamp((r - 0.9) * 0.14, 0.018, 1.6) * (r > 8.0 ? 1.4 : 1.0);
      vec3 prev = pos;
      // leapfrog
      vec3 acc = -1.5 * h2 * pos / pow(r, 5.0);
      // frame dragging (gravitomagnetic, weak-field form, scaled for the look of a = 0.7)
      acc += uSpin * 2.0 * cross(vel, (3.0 * dot(spinAx, pos) * pos / (r * r) - spinAx) / (r * r * r));
      vel += acc * dt * 0.5;
      pos += vel * dt;
      float r2 = length(pos);
      vec3 acc2 = -1.5 * h2 * pos / pow(r2, 5.0);
      acc2 += uSpin * 2.0 * cross(vel, (3.0 * dot(spinAx, pos) * pos / (r2 * r2) - spinAx) / (r2 * r2 * r2));
      vel += acc2 * dt * 0.5;
      // disc plane crossing
      if (prev.y * pos.y < 0.0) {
        float f = prev.y / (prev.y - pos.y);
        vec3 hit = mix(prev, pos, f);
        vec4 d = discSample(hit, vel, normalize(vel).y);
        col += (1.0 - alpha) * d.rgb * d.a;
        alpha += (1.0 - alpha) * d.a;
        if (alpha > 0.985) break;
      }
      // faint corona above the disc
      float rr = length(pos.xz);
      if (rr < ${R_OUT.toFixed(1)} && abs(pos.y) < 2.0) {
        float H = 0.12 * rr;
        float cd = exp(-pos.y * pos.y / (H * H)) * smoothstep(${R_OUT.toFixed(1)}, 3.0, rr) * smoothstep(1.2, 2.2, rr);
        col += (1.0 - alpha) * vec3(1.0, 0.62, 0.32) * cd * dt * 0.02 * uDiscGain / rr;
      }
      if (r2 > ${R_INT.toFixed(1)} + 1.0 && dot(pos, vel) > 0.0) break;
    }
    vel = normalize(vel);
    // bending still to come beyond the integration sphere
    float bb = length(cross(pos, vel));
    float kR = sqrt(max(1.0 - bb * bb / dot(pos, pos), 0.0));
    outDir = bendToward(vel, pos, (1.0 / max(bb, 1e-3)) * (1.0 - kR));
  }
  // back to world directions for the sky lookup
  vec3 oW = transpose(uToBH) * outDir;
  float px = max(length(fwidth(oW)), 1e-5);
  vec3 bg = captured ? vec3(0.0) : background(normalize(oW), min(px, 0.02));
  if (uLensR > 0.0) {
    // far mode: blend the bending out toward the edge of the lensed region
    float edge = smoothstep(uLensR, uLensR * 0.55, b);
    if (edge < 1.0) bg = mix(background(dirW, max(length(fwidth(dirW)), 1e-5)), bg, edge);
  }
  vec3 outc = col + (1.0 - alpha) * bg;
  float occ = captured ? 1.0 : alpha;
  gl_FragColor = vec4(outc * inside, inside * (0.5 + 0.5 * occ));
}
`;

const COMP_FRAG = /* glsl */ `
uniform sampler2D tBH;
varying vec2 vUv;
void main() {
  vec4 c = texture(tBH, vUv);
  float inside = smoothstep(0.2, 0.5, c.a);
  gl_FragColor = vec4(c.rgb * inside, inside);
}
`;

function buildCollector() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const parts = [];
  const S = 0.32;
  // concave mirror dish facing -X (toward the hole), radius ~26 km
  const dish = new THREE.SphereGeometry(40, 48, 12, 0, Math.PI * 2, 0, 0.72);
  dish.rotateZ(Math.PI / 2);
  dish.translate(40, 0, 0);
  parts.push(tag(dish, KIND.MIRROR));
  const back = new THREE.SphereGeometry(40.6, 32, 8, 0, Math.PI * 2, 0, 0.72);
  back.rotateZ(Math.PI / 2); back.translate(39.8, 0, 0);
  parts.push(tag(back, KIND.TRUSS));
  // receiver on a boom at the focus, in front of the concave face
  parts.push(beam(V(1, 0, 0), V(19, 0, 0), 0.6, KIND.TRUSS, 6));
  for (const a of [0, 2.1, 4.2]) parts.push(beam(V(9, Math.cos(a) * 24, Math.sin(a) * 24), V(19, 0, 0), 0.35, KIND.TRUSS, 5));
  parts.push(tag(new THREE.SphereGeometry(2.2, 16, 12).translate(20, 0, 0), KIND.GLOW));
  // hab and radiators behind the dish
  parts.push(tag(new THREE.CylinderGeometry(3, 3, 14, 16).rotateZ(Math.PI / 2).translate(-9, 0, 0), KIND.HAB));
  for (const s of [-1, 1]) parts.push(tag(new THREE.BoxGeometry(10, 0.2, 34).translate(-13, 0, s * 26), KIND.PANEL));
  const g = merge(parts);
  g.scale(S, S, S);
  g.computeBoundingSphere();
  return g;
}

export class Hearth {
  constructor(space, q) {
    this.space = space;
    this.q = q;
    this.quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, 0.3, -0.18));
    this.group = new THREE.Group();
    this.bhRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.uniforms = {
      uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() }, uToBH: { value: new THREE.Matrix3() },
      uCamBH: { value: new THREE.Vector3() }, uCamW: { value: new THREE.Vector3() }, uTime: { value: 0 }, uLensR: { value: 0 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunE: U.uSunIlluminance, uEarthPos: { value: new THREE.Vector3() }, uMoonPos: { value: new THREE.Vector3() },
      uSpin: { value: 0.35 }, uDiscGain: { value: 16.0 },
      ...SKY_UNIFORMS,
    };
    this.bhMat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: BH_FRAG, uniforms: this.uniforms, defines: { STEPS: q.bhSteps }, depthTest: false, depthWrite: false });
    this.pass = new FullscreenPass(this.bhMat);
    // composite quad, drawn as part of the space scene before anything else
    const cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    cgeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: COMP_FRAG, uniforms: { tBH: { value: this.bhRT.texture } },
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.composite = new THREE.Mesh(cgeo, this.compMat);
    this.composite.frustumCulled = false;
    this.composite.renderOrder = -900;
    // collector ring: 14 mirror stations and a thin structural ring at 30 horizon radii
    this.hullMat = createHullMaterial({ pattern: 0.08, accent: [1.0, 0.7, 0.4], behindMask: true });
    this.hullMat.uniforms.uHearthTex.value = this.bhRT.texture;
    this.stations = new THREE.Group();
    const cgeo2 = buildCollector();
    const N = 14;
    const Rc = 30 * RS;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const m = new THREE.Mesh(cgeo2, this.hullMat);
      m.position.set(Math.cos(a) * Rc, Math.sin(a * 3) * 18, Math.sin(a) * Rc);
      m.lookAt(0, 0, 0);
      m.rotateY(-Math.PI / 2);
      this.stations.add(m);
    }
    const ring = [tag(new THREE.TorusGeometry(Rc, 0.45, 6, 720).rotateX(Math.PI / 2), KIND.TRUSS), tag(new THREE.TorusGeometry(Rc, 0.15, 4, 720).rotateX(Math.PI / 2).translate(0, 0.7, 0), KIND.GLOW)];
    this.stations.add(new THREE.Mesh(merge(ring), this.hullMat));
    this.stations.rotation.z = 0.12;
    this.stations.traverse((o) => { o.frustumCulled = false; o.renderOrder = 3; });
    this.group.add(this.stations);
    this.mode = 'far';
    this.scale = 1;
    this.size = new THREE.Vector2(1, 1);
    this.active = true;
    this.coverage = 0;
  }

  setQuality(q) { this.q = q; this.bhMat.defines.STEPS = q.bhSteps; this.bhMat.needsUpdate = true; }
  setSize(w, h) { this.size.set(w, h); this._resize(); }
  _resize() {
    const w = Math.max(1, Math.round(this.size.x * this.scale)), h = Math.max(1, Math.round(this.size.y * this.scale));
    if (this.bhRT.width !== w || this.bhRT.height !== h) this.bhRT.setSize(w, h);
    this.hullMat.uniforms.uHearthRes.value.set(this.size.x, this.size.y);
  }

  get nearZone() { return this.mode === 'near'; }

  update(sim, realTime, dt, space) {
    this.group.position.copy(sim.hearthPos);
    this.group.quaternion.copy(this.quat);
    this.group.updateMatrixWorld(true);
    const cam = space.camera;
    const rel = cam.position.clone().sub(sim.hearthPos);
    const d = rel.length();
    this.distance = d;
    // near zone: the lensed image fills the screen and replaces the backdrop
    this.mode = d < 2500 * RS ? 'near' : 'far';
    const lensR = this.mode === 'near' ? 0 : 320;
    const angR = Math.asin(Math.min(1, (lensR * RS) / d));
    const fov = THREE.MathUtils.degToRad(cam.fov) * 0.5;
    this.coverage = this.mode === 'near' ? 1 : Math.min(1, (angR * angR) / (fov * fov * cam.aspect));
    // on screen?
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const offAng = Math.acos(THREE.MathUtils.clamp(-rel.dot(fwd) / d, -1, 1));
    this.visibleOnScreen = this.mode === 'near' || offAng < angR + fov * 1.6;
    // tiny on screen: skip the ray march entirely (the swarm-like glint in the sky suffices)
    this.active = this.visibleOnScreen && (this.mode === 'near' || angR / fov > 0.004);
    const want = this.mode === 'near' || this.coverage > 0.35 ? this.q.bhScale : 1.0;
    if (want !== this.scale) { this.scale = want; this._resize(); }
    const u = this.uniforms;
    u.uTime.value = realTime;
    u.uLensR.value = lensR;
    u.uSunDir.value.copy(sim.sunDir);
    u.uEarthPos.value.set(0, 0, 0);
    u.uMoonPos.value.copy(sim.moonPos);
    const inv = this.quat.clone().invert();
    u.uToBH.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(inv));
    u.uCamBH.value.copy(rel).applyQuaternion(inv).multiplyScalar(1 / RS);
    u.uCamW.value.copy(cam.position);
    this.hullMat.uniforms.uSunDir.value.copy(sim.sunDir);
    this.hullMat.uniforms.uTime.value = realTime;
    this.hullMat.uniforms.uEarthPos.value.set(0, 0, 0);
    this.hullMat.uniforms.uPointPos.value.copy(sim.hearthPos);
    this.hullMat.uniforms.uPointColor.value.setRGB(1.0, 0.72, 0.45).multiplyScalar(6.0);
    this.hullMat.uniforms.uHearthDepth.value = d;
  }

  /** Ray-march into bhRT; called before the space scene renders. */
  renderLens(renderer, cam) {
    this.composite.visible = this.active;
    if (!this.active) { this.hullMat.uniforms.uBehindMask.value = 0; return; }
    const u = this.uniforms;
    cam.updateMatrixWorld();
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uCamRot.value.setFromMatrix4(cam.matrixWorld);
    const prev = renderer.getRenderTarget();
    this.pass.render(renderer, this.bhRT);
    renderer.setRenderTarget(prev);
    this.hullMat.uniforms.uBehindMask.value = 1;
  }

  exposureHint() { return this.active ? Math.min(0.75, this.coverage * 1.4 + (this.mode === 'near' ? 0.25 : 0)) : 0; }
}
