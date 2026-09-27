import * as THREE from 'three';
import { patchedMaterial } from '../world/materials.js';
import { latheFacade, mergeClean } from '../world/geom.js';
import { shipGeometry } from '../world/infrastructure.js';
import { ISLANDS, SKYPORT, TOWERS, CHORUS } from '../world/layout.js';
import { latticeRadius } from '../world/axis.js';
import { mulberry32 } from '../world/noise.js';
import { U } from '../core/uniforms.js';

const TAU = Math.PI * 2;
const SAMPLES = 1024;

// GLSL: sample a closed curve stored as a row of RGBA32F texels (xyz)
const CURVE_GLSL = /* glsl */ `
uniform sampler2D uCurves;
vec3 curveAt(float row, float t) {
  float x = fract(t) * ${SAMPLES}.0;
  int i0 = int(floor(x));
  int i1 = (i0 + 1) % ${SAMPLES};
  float f = fract(x);
  vec3 a = texelFetch(uCurves, ivec2(i0, int(row)), 0).xyz;
  vec3 b = texelFetch(uCurves, ivec2(i1, int(row)), 0).xyz;
  return mix(a, b, f);
}
`;

function vehicleGeometry() {
  // sleek lifting-body craft, ~1 unit long along +Z; aEmit marks lights
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    prof.push({ r: 0.16 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.7) + 0.003, y: t - 0.5, kind: 0 });
  }
  const g = latheFacade(prof, 10, { sx: 1, sz: 0.45 });
  g.rotateX(Math.PI / 2);
  // canopy blister
  const pos = g.attributes.position;
  const emit = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i), y = pos.getY(i);
    if (z > 0.42) emit[i] = 1;                         // head light
    else if (z < -0.44) emit[i] = 2;                   // tail light
    else if (Math.abs(y) < 0.01 && Math.abs(pos.getX(i)) > 0.14) emit[i] = 3; // side marker strip
  }
  g.setAttribute('aEmit', new THREE.BufferAttribute(emit, 1));
  g.deleteAttribute('aFacade');
  return g;
}

function makeCurves() {
  const rnd = mulberry32(8080);
  const curves = [];
  const add = (pts, kind = 'car', lanes = 2, density = 1, speed = [60, 110]) => {
    const c = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    curves.push({ curve: c, kind, lanes, density, speed, length: c.getLength() });
  };
  const ring = (cx, cz, r, y, n = 24, wob = 0.08, wy = 20, phase = 0) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + phase;
      const rr = r * (1 + wob * Math.sin(a * 3 + phase * 2));
      pts.push(new THREE.Vector3(cx + Math.cos(a) * rr, y + wy * Math.sin(a * 2 + phase), cz + Math.sin(a) * rr));
    }
    return pts;
  };
  // orbital lanes around the Axis
  for (const [y, extra] of [[420, 170], [760, 150], [1180, 130], [1700, 120], [2380, 110]]) {
    add(ring(0, 0, latticeRadius(y) + extra, y, 32, 0.03, 10, rnd() * TAU), 'car', 3, 1.6, [70, 120]);
  }
  // halos around each district island
  for (const isl of ISLANDS) add(ring(isl.x, isl.z, isl.r + 180, 140 + rnd() * 160, 20, 0.1, 30, rnd() * TAU), 'car', 2, 0.9);
  // arterial loops through the lagoon, stitching districts together
  const order = [...ISLANDS];
  for (let k = 0; k < 3; k++) {
    const pts = [];
    for (let i = 0; i < order.length; i++) {
      const isl = order[(i + k * 3) % order.length];
      const h = 180 + k * 140 + rnd() * 60;
      pts.push(new THREE.Vector3(isl.x * 0.82, h, isl.z * 0.82));
      if (i % 2 === 0) pts.push(new THREE.Vector3(isl.x * 0.35 + (rnd() - 0.5) * 400, h + 80, isl.z * 0.35 + (rnd() - 0.5) * 400));
    }
    add(pts, 'car', 3, 2.2, [80, 140]);
  }
  // radial express lanes: axis → districts → out over the rim and back
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    const pts = [
      new THREE.Vector3(Math.cos(a) * 600, 900, Math.sin(a) * 600),
      new THREE.Vector3(Math.cos(a) * 3500, 600, Math.sin(a) * 3500),
      new THREE.Vector3(Math.cos(a + 0.1) * 9000, 1400, Math.sin(a + 0.1) * 9000),
      new THREE.Vector3(Math.cos(a + 0.25) * 14000, 2200, Math.sin(a + 0.25) * 14000),
      new THREE.Vector3(Math.cos(a + 0.4) * 9000, 1700, Math.sin(a + 0.4) * 9000),
      new THREE.Vector3(Math.cos(a + 0.35) * 3500, 800, Math.sin(a + 0.35) * 3500),
    ];
    add(pts, 'car', 2, 1.4, [140, 220]);
  }
  // skimmers low over the water
  for (let k = 0; k < 4; k++) add(ring(0, 0, 1700 + k * 750, 14 + k * 6, 28, 0.2, 4, rnd() * TAU), 'car', 2, 1.0, [40, 70]);
  // around the tallest towers
  for (const t of TOWERS.filter((t) => t.height > 900)) add(ring(t.x, t.z, (t.radius || 80) * 2.4 + 60, t.height * 0.55, 18, 0.05, 40, rnd() * TAU), 'car', 2, 0.8);
  // around the Chorus
  add(ring(CHORUS.x, CHORUS.z, CHORUS.scale * 2.4, CHORUS.y - 40, 20, 0.06, 60), 'car', 1, 0.6, [40, 60]);
  // starship lanes: the skyport to orbit
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.6;
    const pts = [
      new THREE.Vector3(SKYPORT.x + Math.cos(a) * 600, SKYPORT.y + 40, SKYPORT.z + Math.sin(a) * 600),
      new THREE.Vector3(SKYPORT.x + Math.cos(a) * 3000, SKYPORT.y + 900, SKYPORT.z + Math.sin(a) * 3000),
      new THREE.Vector3(SKYPORT.x + Math.cos(a + 0.2) * 12000, SKYPORT.y + 9000, SKYPORT.z + Math.sin(a + 0.2) * 12000),
      new THREE.Vector3(SKYPORT.x + Math.cos(a + 0.5) * 20000, SKYPORT.y + 24000, SKYPORT.z + Math.sin(a + 0.5) * 20000),
      new THREE.Vector3(SKYPORT.x + Math.cos(a + 0.8) * 12000, SKYPORT.y + 8000, SKYPORT.z + Math.sin(a + 0.8) * 12000),
      new THREE.Vector3(SKYPORT.x + Math.cos(a + 0.7) * 2500, SKYPORT.y + 700, SKYPORT.z + Math.sin(a + 0.7) * 2500),
    ];
    add(pts, 'ship', 1, 0.004, [180, 320]);
  }
  return curves;
}

function curveTexture(curves) {
  const data = new Float32Array(SAMPLES * curves.length * 4);
  curves.forEach((c, row) => {
    const pts = c.curve.getSpacedPoints(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const p = pts[i];
      const k = (row * SAMPLES + i) * 4;
      data[k] = p.x; data[k + 1] = p.y; data[k + 2] = p.z; data[k + 3] = 1;
    }
  });
  const tex = new THREE.DataTexture(data, SAMPLES, curves.length, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const FRAME_GLSL = /* glsl */ `
attribute vec4 aPath;   // row, offset, loops/sec, scale
attribute vec3 aLane;   // side, up, variant
vec3 tPos; mat3 tRot;
void computeFrame() {
  float t = aPath.y + uTime * aPath.z;
  vec3 p0 = curveAt(aPath.x, t);
  vec3 p1 = curveAt(aPath.x, t + 0.0015 * sign(aPath.z));
  vec3 fwd = normalize(p1 - p0 + vec3(1e-4, 0.0, 0.0));
  vec3 side = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(side, fwd);
  // bank into curves
  vec3 p2 = curveAt(aPath.x, t + 0.006 * sign(aPath.z));
  float turn = dot(normalize(p2 - p1 + 1e-4), side);
  float bank = clamp(-turn * 4.0, -0.6, 0.6);
  vec3 s2 = side * cos(bank) + up * sin(bank);
  vec3 u2 = cross(s2, fwd);
  tRot = mat3(s2, u2, fwd);
  tPos = p0 + side * aLane.x + vec3(0.0, aLane.y, 0.0);
}
`;

export class Traffic {
  constructor(scene, settings) {
    this.curves = makeCurves();
    this.tex = curveTexture(this.curves);
    const rnd = mulberry32(1234);
    const cars = [], ships = [];
    this.curves.forEach((c, row) => {
      const target = c.kind === 'ship' ? 3 : Math.round((c.length / 1000) * 11 * c.density);
      for (let i = 0; i < target; i++) {
        const lane = Math.floor(rnd() * c.lanes);
        const dir = c.kind === 'ship' ? 1 : (lane % 2 === 0 ? 1 : -1);
        const v = c.speed[0] + rnd() * (c.speed[1] - c.speed[0]);
        const rec = {
          row, offset: rnd(), speed: dir * v / c.length,
          scale: c.kind === 'ship' ? 140 + rnd() * 160 : 7 + rnd() * 7,
          side: (lane - (c.lanes - 1) / 2) * 16 + (rnd() - 0.5) * 3,
          up: (lane - (c.lanes - 1) / 2) * 7 + (rnd() - 0.5) * 3,
          variant: rnd(),
        };
        (c.kind === 'ship' ? ships : cars).push(rec);
      }
    });
    this.cars = this.buildInstances(vehicleGeometry(), cars, false);
    this.ships = this.buildInstances(this.shipGeo(), ships, true);
    this.trails = this.buildTrails(cars.concat(ships));
    scene.add(this.cars.mesh, this.ships.mesh, this.trails.mesh);
    this.applyQuality(settings);
  }

  shipGeo() {
    const g = shipGeometry(1);
    const pos = g.attributes.position;
    const emit = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i); if (z < -0.46) emit[i] = 4; else if (Math.abs(z - 0.26) < 0.03) emit[i] = 3; }
    g.setAttribute('aEmit', new THREE.BufferAttribute(emit, 1));
    g.deleteAttribute('aFacade');
    return g;
  }

  material(isShip) {
    return patchedMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.7, envMapIntensity: 1.2 }, {
      key: isShip ? 'ships' : 'cars',
      uniforms: { uCurves: { value: this.tex } },
      vertex: {
        pars: CURVE_GLSL + FRAME_GLSL + 'attribute float aEmit; varying float vEmit; varying float vVariant;',
        preNormal: 'computeFrame(); objectNormal = tRot * objectNormal;',
        transform: 'transformed = tRot * (transformed * aPath.w) + tPos; vEmit = aEmit; vVariant = aLane.z;',
      },
      fragment: {
        pars: 'varying float vEmit; varying float vVariant;',
        color: /* glsl */ `
vec3 bodyCols[4] = vec3[4](vec3(0.92, 0.92, 0.94), vec3(0.2, 0.22, 0.26), vec3(0.75, 0.62, 0.45), vec3(0.55, 0.7, 0.8));
diffuseColor.rgb = bodyCols[int(vVariant * 3.99)];`,
        emissive: /* glsl */ `
{
  float e = vEmit;
  float lights = 0.35 + 0.65 * uCityLights;
  if (e > 0.5 && e < 1.5) totalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * 1.6 * lights;
  else if (e > 1.5 && e < 2.5) totalEmissiveRadiance += vec3(1.0, 0.15, 0.08) * 0.9 * lights;
  else if (e > 2.5 && e < 3.5) totalEmissiveRadiance += vec3(0.3, 0.8, 1.0) * 0.25 * lights;
  else if (e > 3.5) totalEmissiveRadiance += vec3(0.5, 0.8, 1.0) * 3.0;
}`,
      },
    });
  }

  buildInstances(geo, list, isShip) {
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = geo.index;
    for (const k of Object.keys(geo.attributes)) ig.setAttribute(k, geo.attributes[k]);
    const path = new Float32Array(list.length * 4), lane = new Float32Array(list.length * 3);
    list.forEach((r, i) => {
      path.set([r.row, r.offset, r.speed, r.scale], i * 4);
      lane.set([r.side, r.up, r.variant], i * 3);
    });
    ig.setAttribute('aPath', new THREE.InstancedBufferAttribute(path, 4));
    ig.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 3));
    ig.instanceCount = list.length;
    const mesh = new THREE.Mesh(ig, this.material(isShip));
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.full = list.length;
    return { mesh, geo: ig, count: list.length };
  }

  buildTrails(list) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = quad.index;
    ig.setAttribute('position', quad.attributes.position);
    ig.setAttribute('uv', quad.attributes.uv);
    const path = new Float32Array(list.length * 4), lane = new Float32Array(list.length * 3);
    list.forEach((r, i) => {
      path.set([r.row, r.offset, r.speed, r.scale], i * 4);
      lane.set([r.side, r.up, r.variant], i * 3);
    });
    ig.setAttribute('aPath', new THREE.InstancedBufferAttribute(path, 4));
    ig.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 3));
    ig.instanceCount = list.length;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCurves: { value: this.tex }, uTime: U.uTime, uCityLights: U.uCityLights, uNight: U.uNight },
      vertexShader: /* glsl */ `
uniform float uTime;
${CURVE_GLSL}
attribute vec4 aPath; attribute vec3 aLane;
varying vec2 vUv; varying float vShip; varying float vDist;
void main() {
  float sgn = sign(aPath.z);
  float t = aPath.y + uTime * aPath.z;
  float speed = abs(aPath.z);
  bool ship = aPath.w > 60.0;
  // trail length is a fixed slice of travel time (ships leave a longer glow)
  float lenT = speed * (ship ? 1.6 : 0.45);
  float along = position.y + 0.5;       // 0 at tail end, 1 at vehicle
  float tt = t - sgn * lenT * (1.0 - along);
  vec3 p = curveAt(aPath.x, tt);
  vec3 pn = curveAt(aPath.x, tt + 0.0015 * sgn);
  vec3 fwd = normalize(pn - p + 1e-4);
  vec3 side0 = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  p += side0 * aLane.x + vec3(0.0, aLane.y, 0.0);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(fwd, toCam));
  float w = ship ? aPath.w * 0.04 : aPath.w * 0.07;
  p += side * position.x * w;
  vUv = vec2(position.x + 0.5, along);
  vShip = ship ? 1.0 : 0.0;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: /* glsl */ `
uniform float uCityLights; uniform float uNight;
varying vec2 vUv; varying float vShip; varying float vDist;
void main() {
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float a = pow(vUv.y, 3.0) * across * across;
  vec3 col = mix(vec3(1.0, 0.55, 0.32), vec3(0.55, 0.85, 1.0), vShip);
  float vis = mix(0.0, 0.35, uCityLights) + vShip * 0.3;
  float fade = 1.0 - smoothstep(6000.0, 24000.0, vDist);
  gl_FragColor = vec4(col * a * vis * fade, 1.0);
}`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(ig, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.userData.full = list.length;
    return { mesh, geo: ig };
  }

  applyQuality(s) {
    this.cars.geo.instanceCount = Math.floor(this.cars.count * s.traffic);
    // trails: cars first then ships, keep ship trails by showing all when traffic is full
    this.trails.geo.instanceCount = Math.floor(this.trails.mesh.userData.full * s.traffic);
  }
}
