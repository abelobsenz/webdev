import * as THREE from 'three';
import { patchedMaterial } from '../world/materials.js';
import { mulberry32 } from '../world/noise.js';
import { PLAZA_Y, PLAZA_R } from '../world/layout.js';
import { ST } from '../world/urban.js';

// The citizens of MERIDIAN.
//
// Every walker follows a real path: the lanes and avenues of the Axis plaza, the decks
// of the promenades, the town streets (which are pedestrian: traffic flies) and the
// squares. Paths are resampled by arc length into a float texture; each person carries
// (path, start, speed, lateral offset) and the vertex shader places, orients and
// animates them: legs and arms swing from hip and shoulder pivots with the stride, the
// body bobs, idle people sway. Clothing, skin and hair vary per person, and a quarter
// of them wear luminous textile trim that glows softly at night.

const W = 256;               // samples per path
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ body --
// Parts: 0 torso, 1 head, 2 left leg, 3 right leg, 4 left arm, 5 right arm, 6 robe, 7 hair
function bodyGeometry() {
  const pos = [], nrm = [], part = [], idx = [];
  const add = (g, p) => {
    const base = pos.length / 3;
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i)); part.push(p); }
    const I = g.index;
    if (I) for (let i = 0; i < I.count; i++) idx.push(I.getX(i) + base);
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
  };
  const lathe = (prof, seg, x = 0, z = 0, sx = 1, sz = 1) => {
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    g.scale(sx, 1, sz);
    g.translate(x, 0, z);
    return g;
  };
  // torso: hips, waist, chest, shoulders, neck
  add(lathe([[0.001, 0.86], [0.16, 0.88], [0.17, 0.98], [0.14, 1.1], [0.17, 1.28], [0.19, 1.38], [0.13, 1.45], [0.055, 1.49], [0.05, 1.54], [0.001, 1.55]], 7, 0, 0, 1, 0.66), 0);
  // head and hair cap
  const head = new THREE.SphereGeometry(0.105, 8, 6); head.scale(0.92, 1.1, 1.0); head.translate(0, 1.64, 0.01); add(head, 1);
  const hair = new THREE.SphereGeometry(0.112, 8, 4, 0, TAU, 0, Math.PI * 0.52); hair.scale(0.95, 1.08, 1.04); hair.translate(0, 1.655, -0.005); add(hair, 7);
  // legs (hip pivot at y 0.9) with feet
  for (const [sx, p] of [[1, 2], [-1, 3]]) {
    add(lathe([[0.001, 0.05], [0.05, 0.06], [0.055, 0.45], [0.075, 0.62], [0.085, 0.86], [0.001, 0.9]], 6, sx * 0.085, 0), p);
    const foot = new THREE.BoxGeometry(0.085, 0.06, 0.22); foot.translate(sx * 0.085, 0.03, 0.045); add(foot, p);
  }
  // arms (shoulder pivot at y 1.41) with hands
  for (const [sx, p] of [[1, 4], [-1, 5]]) {
    add(lathe([[0.001, 0.72], [0.034, 0.74], [0.04, 0.95], [0.05, 1.18], [0.058, 1.38], [0.001, 1.43]], 6, sx * 0.225, 0), p);
    const hand = new THREE.SphereGeometry(0.042, 6, 4); hand.scale(0.8, 1.3, 0.9); hand.translate(sx * 0.225, 0.7, 0.0); add(hand, p);
  }
  // robe skirt (shown for robed variants)
  add(lathe([[0.3, 0.12], [0.24, 0.5], [0.18, 0.95], [0.001, 0.98]], 10, 0, 0, 1, 0.8), 6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

// -------------------------------------------------------------- material --
const VERT_PARS = /* glsl */ `
uniform sampler2D uPaths;
uniform float uCull;
attribute vec4 aP0;      // path row, start (m), speed (m/s), lateral offset (m)
attribute vec4 aP1;      // seed, height (m), variant + 10 * closed, path length (m)
attribute float aPart;
varying float vPart; varying float vSeed; varying float vVar; varying float vLocalY; varying float vFar;
vec3 ppAt(float row, float u) {
  float x = clamp(u, 0.0, 1.0) * ${(W - 1).toFixed(1)};
  float i = floor(x); float f = x - i;
  vec3 a = texelFetch(uPaths, ivec2(int(i), int(row)), 0).xyz;
  vec3 b = texelFetch(uPaths, ivec2(int(min(i + 1.0, ${(W - 1).toFixed(1)})), int(row)), 0).xyz;
  return mix(a, b, f);
}
vec3 pPos; vec3 pX; vec3 pZ; float pPhase; float pScale; float pSwing; float pIdle; bool pOff;
void personSetup() {
  float L = max(aP1.w, 1.0);
  float closed = step(9.5, aP1.z);
  float spd = aP0.z;
  float s = aP0.y + spd * uTime;
  float u, dirS;
  if (closed > 0.5) { u = fract(s / L); dirS = spd < 0.0 ? -1.0 : 1.0; }
  else { float m = mod(s, 2.0 * L); u = (m < L ? m : 2.0 * L - m) / L; dirS = (m < L ? 1.0 : -1.0) * (spd < 0.0 ? -1.0 : 1.0); }
  float du = 1.5 / L;
  vec3 a = ppAt(aP0.x, u - du), b = ppAt(aP0.x, u + du);
  if (closed > 0.5) { a = ppAt(aP0.x, fract(u - du)); b = ppAt(aP0.x, fract(u + du)); }
  vec3 t = b - a; t.y = 0.0;
  t = length(t) > 1e-4 ? normalize(t) : vec3(0.0, 0.0, 1.0);
  t *= dirS;
  pZ = t; pX = vec3(t.z, 0.0, -t.x);
  pPos = ppAt(aP0.x, u) + pX * aP0.w;
  pIdle = step(abs(spd), 0.05);
  pScale = aP1.y / 1.75;
  pPhase = pIdle > 0.5 ? uTime * 0.9 + aP1.x * 40.0 : abs(s) / (0.74 * pScale) * 3.14159;
  pSwing = pIdle > 0.5 ? 0.04 : clamp(abs(spd) * 0.28, 0.2, 0.52);
  float dist = distance(pPos, cameraPosition);
  vFar = smoothstep(uCull * 0.8, uCull, dist);
  pOff = dist > uCull;
  vPart = aPart; vSeed = aP1.x; vVar = mod(aP1.z, 10.0);
}
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 articulate(vec3 v, bool isNormal) {
  float part = aPart;
  float robe = step(4.5, vVar);                 // variants 5..7 wear robes
  if (part > 5.5 && part < 6.5 && robe < 0.5) return vec3(0.0);
  vec3 piv;
  if (part > 1.5 && part < 3.5) {
    float sgn = part < 2.5 ? 1.0 : -1.0;
    float a = sgn * pSwing * sin(pPhase) * (robe > 0.5 ? 0.7 : 1.0);
    piv = vec3(0.0, 0.9, 0.0);
    v = isNormal ? rotX(v, a) : rotX(v - piv, a) + piv;
  } else if (part > 3.5 && part < 5.5) {
    float sgn = part < 4.5 ? -1.0 : 1.0;
    float a = sgn * pSwing * 0.75 * sin(pPhase) + (pIdle > 0.5 ? 0.06 * sin(pPhase * 0.5 + sgn) : 0.0);
    piv = vec3(0.0, 1.41, 0.0);
    v = isNormal ? rotX(v, a) : rotX(v - piv, a) + piv;
  }
  if (!isNormal) {
    // stride bob and a slight sway
    v.y += (pIdle > 0.5 ? 0.0 : 0.025 * abs(cos(pPhase)));
    v.x += 0.012 * sin(pPhase) * (pIdle > 0.5 ? 0.3 : 1.0) * step(0.5, v.y);
  }
  return v;
}
`;

const COLOR = /* glsl */ `
{
  vec3 cloth[12] = vec3[12](vec3(0.9, 0.88, 0.82), vec3(0.78, 0.7, 0.55), vec3(0.62, 0.3, 0.2), vec3(0.85, 0.6, 0.2),
    vec3(0.12, 0.42, 0.45), vec3(0.15, 0.18, 0.42), vec3(0.45, 0.55, 0.4), vec3(0.14, 0.14, 0.16), vec3(0.75, 0.45, 0.5),
    vec3(0.45, 0.62, 0.8), vec3(0.95, 0.95, 0.93), vec3(0.45, 0.1, 0.15));
  vec3 skin[6] = vec3[6](vec3(0.93, 0.76, 0.64), vec3(0.84, 0.64, 0.5), vec3(0.72, 0.52, 0.38), vec3(0.58, 0.4, 0.28), vec3(0.42, 0.28, 0.19), vec3(0.3, 0.2, 0.14));
  vec3 hair[6] = vec3[6](vec3(0.03, 0.025, 0.02), vec3(0.12, 0.07, 0.04), vec3(0.32, 0.12, 0.05), vec3(0.72, 0.56, 0.3), vec3(0.55, 0.55, 0.55), vec3(0.9, 0.9, 0.88));
  float h = vSeed;
  vec3 top = cloth[int(fract(h * 7.13) * 11.99)];
  vec3 low = cloth[int(fract(h * 3.71 + 0.3) * 11.99)] * 0.8;
  vec3 sk = skin[int(fract(h * 5.31) * 5.99)];
  vec3 hr = hair[int(fract(h * 9.17) * 5.99)];
  vec3 c = top;
  if (vPart > 0.5 && vPart < 1.5) c = sk;
  else if (vPart > 1.5 && vPart < 3.5) c = vLocalY < 0.07 ? vec3(0.08, 0.07, 0.06) : (vVar > 4.5 ? top * 0.9 : low);
  else if (vPart > 3.5 && vPart < 5.5) c = vLocalY < 0.77 ? sk : top * 0.95;
  else if (vPart > 5.5 && vPart < 6.5) c = top * 0.92;
  else if (vPart > 6.5) c = hr;
  // a sash or trim band on many tunics
  float band = step(0.55, fract(h * 13.7)) * (1.0 - smoothstep(0.012, 0.02, abs(vLocalY - 1.0))) * step(vPart, 0.5);
  c = mix(c, cloth[int(fract(h * 17.9) * 11.99)], band);
  diffuseColor.rgb = c;
}`;

export class People {
  constructor(scene, settings, world) {
    this.scene = scene;
    const rnd = mulberry32(606);
    const paths = [];           // { pts: Vector3[], closed, half }
    const groups = [];          // { name, rows: [], people: [] }
    const addPath = (pts, closed, half) => { paths.push({ pts, closed, half }); return paths.length - 1; };
    const ground = (x, z) => world.groundHeight(x, z);
    const stations = (world.infra && world.infra.stations) || [];
    const blocked = (x, z) => stations.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 2);
    // split a polyline wherever it enters a blocked area
    const splitBlocked = (pts, closed) => {
      const out = []; let cur = [];
      for (const p of pts) { if (blocked(p.x, p.z)) { if (cur.length > 4) out.push(cur); cur = []; } else cur.push(p); }
      if (cur.length > 4) out.push(cur);
      if (out.length === 1 && out[0].length === pts.length) return [{ pts: out[0], closed }];
      return out.map((p) => ({ pts: p, closed: false }));
    };

    // ---- the Axis plaza: ring lanes (split between the Axis roots) and twelve avenues
    {
      const g = { name: 'plaza', rows: [], center: new THREE.Vector3(0, PLAZA_Y, 0), radius: PLAZA_R + 20, people: [] };
      const lanes = [[80, 205], [262, 298], [338, 372], [424, 456], [486, 548]];
      const rootA = []; for (let i = 0; i < 8; i++) rootA.push((i / 8) * TAU + TAU / 16);
      lanes.forEach(([r0, r1], li) => {
        const rm = (r0 + r1) / 2, half = (r1 - r0) / 2 - 1.5;
        const outer = li >= 3;
        const arcs = [];
        if (!outer) arcs.push([0, TAU, true]);
        else for (let i = 0; i < 8; i++) { const a0 = rootA[i] + 0.14, a1 = rootA[(i + 1) % 8] + (i === 7 ? TAU : 0) - 0.14; arcs.push([a0, a1, false]); }
        for (const [a0, a1, closed] of arcs) {
          const n = Math.max(24, Math.ceil(((a1 - a0) * rm) / 6));
          const pts = [];
          for (let k = 0; k <= (closed ? n - 1 : n); k++) { const a = a0 + ((a1 - a0) * k) / n; pts.push(new THREE.Vector3(Math.cos(a) * rm, PLAZA_Y + 0.02, Math.sin(a) * rm)); }
          for (const seg of splitBlocked(pts, closed)) g.rows.push({ row: addPath(seg.pts, seg.closed, half), density: 0.32 });
        }
      });
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        const pts = [];
        for (let r = 95; r <= PLAZA_R - 6; r += 8) pts.push(new THREE.Vector3(Math.cos(a) * r, PLAZA_Y + 0.02, Math.sin(a) * r));
        for (const seg of splitBlocked(pts, false)) g.rows.push({ row: addPath(seg.pts, false, 3.6), density: 0.5 });
      }
      groups.push(g);
    }
    // ---- promenade decks
    for (const [i, path] of ((world.infra && world.infra.promenades) || []).entries()) {
      const pts = path.map((p) => new THREE.Vector3(p.x, p.y + 0.22, p.z));
      const c = pts[Math.floor(pts.length / 2)];
      const g = { name: `deck${i}`, rows: [{ row: addPath(pts, false, 10.5), density: 0.2 }], center: c.clone(), radius: pts[0].distanceTo(pts[pts.length - 1]) * 0.55 + 60, people: [] };
      groups.push(g);
    }
    // ---- town streets and squares, grouped by district
    const plan = world.plan;
    if (plan) {
      const byD = new Map();
      for (const st of plan.streets) {
        const key = st.district === 'rim' ? `rim${Math.floor(((Math.atan2(st.pts[0][1], st.pts[0][0]) + Math.PI) / TAU) * 12)}` : st.district;
        if (!byD.has(key)) byD.set(key, []);
        byD.get(key).push(st);
      }
      for (const [key, list] of byD) {
        const g = { name: key, rows: [], people: [] };
        const box = new THREE.Box3();
        for (const st of list) {
          const pts = st.pts.map(([x, z]) => new THREE.Vector3(x, ground(x, z) + 0.03, z));
          for (const p of pts) box.expandByPoint(p);
          const closed = pts.length > 8 && pts[0].distanceTo(pts[pts.length - 1]) < 12;
          const avenue = st.cls === ST.AVENUE;
          g.rows.push({ row: addPath(pts, closed, Math.max(1.2, st.hw - 1.0)), density: st.cls === ST.LANE ? 0.05 : avenue ? 0.1 : 0.075, avenue, hw: st.hw });
        }
        for (const q of plan.squares) {
          if (q.district !== list[0].district || q.kind === 'tower') continue;
          const n = 40, pts = [];
          const rr = q.r * 0.72;
          for (let k = 0; k < n; k++) { const a = (k / n) * TAU; const x = q.x + Math.cos(a) * rr, z = q.z + Math.sin(a) * rr; pts.push(new THREE.Vector3(x, ground(x, z) + 0.03, z)); box.expandByPoint(pts[pts.length - 1]); }
          g.rows.push({ row: addPath(pts, true, q.r * 0.2), density: 0.18, idle: 0.3 });
        }
        const sph = box.getBoundingSphere(new THREE.Sphere());
        g.center = sph.center; g.radius = sph.radius + 30;
        groups.push(g);
      }
    }

    // ---- resample every path into the texture
    const tex = new Float32Array(W * paths.length * 4);
    const lengths = [];
    paths.forEach((P, row) => {
      const pts = P.closed ? [...P.pts, P.pts[0]] : P.pts;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const L = cum[cum.length - 1];
      lengths.push(L);
      let j = 1;
      for (let k = 0; k < W; k++) {
        const s = (k / (W - 1)) * L;
        while (j < pts.length - 1 && cum[j] < s) j++;
        const t = (s - cum[j - 1]) / Math.max(cum[j] - cum[j - 1], 1e-6);
        const a = pts[j - 1], b = pts[j];
        const o = (row * W + k) * 4;
        tex[o] = a.x + (b.x - a.x) * t; tex[o + 1] = a.y + (b.y - a.y) * t; tex[o + 2] = a.z + (b.z - a.z) * t; tex[o + 3] = 0;
      }
    });
    this.pathTex = new THREE.DataTexture(tex, W, paths.length, THREE.RGBAFormat, THREE.FloatType);
    this.pathTex.minFilter = this.pathTex.magFilter = THREE.NearestFilter;
    this.pathTex.needsUpdate = true;

    // ---- people
    const geo = bodyGeometry();
    this.uniforms = { uPaths: { value: this.pathTex }, uCull: { value: 650 } };
    const mat = patchedMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.7 }, {
      key: 'people2',
      uniforms: this.uniforms,
      vertex: {
        pars: VERT_PARS,
        preNormal: 'personSetup(); objectNormal = articulate(objectNormal, true); objectNormal = pX * objectNormal.x + vec3(0.0, objectNormal.y, 0.0) + pZ * objectNormal.z;',
        transform: /* glsl */ `
vLocalY = transformed.y;
{
  vec3 v = articulate(transformed, false) * pScale;
  transformed = pOff ? vec3(0.0) : pPos + pX * v.x + vec3(0.0, v.y, 0.0) + pZ * v.z;
}`,
      },
      fragment: {
        pars: 'varying float vPart; varying float vSeed; varying float vVar; varying float vLocalY; varying float vFar;',
        color: COLOR,
        emissive: /* glsl */ `
{
  // luminous textile trim at collar and hem on a quarter of the citizens
  float glow = step(0.75, fract(vSeed * 23.3)) * step(vPart, 0.5);
  float trim = (1.0 - smoothstep(0.008, 0.016, abs(vLocalY - 1.45))) + (1.0 - smoothstep(0.008, 0.016, abs(vLocalY - 0.9)));
  vec3 tc = fract(vSeed * 31.1) < 0.5 ? vec3(0.45, 0.85, 1.0) : vec3(1.0, 0.72, 0.4);
  totalEmissiveRadiance += tc * glow * trim * uCityLights * 0.9;
}`,
      },
    });
    this.material = mat;
    this.meshes = [];
    let total = 0;
    for (const g of groups) {
      const P0 = [], P1 = [];
      for (const r of g.rows) {
        const L = lengths[r.row];
        const P = paths[r.row];
        const n = Math.max(1, Math.round(L * r.density * (P.half > 6 ? 1.6 : 1)));
        for (let k = 0; k < n; k++) {
          const idle = rnd() < (r.idle ?? 0.08);
          const speed = idle ? 0 : (0.9 + rnd() * 0.75) * (rnd() < 0.5 ? 1 : -1);
          let lat = (rnd() * 2 - 1) * P.half;
          if (r.avenue) lat = (rnd() < 0.5 ? -1 : 1) * (2.8 + rnd() * Math.max(0.5, r.hw - 3.8));
          const variant = Math.floor(rnd() * 8);
          P0.push(r.row, rnd() * L, speed, lat);
          P1.push(rnd(), 1.55 + rnd() * 0.36 + (rnd() < 0.08 ? -0.5 : 0), variant + (P.closed ? 10 : 0), L);
        }
      }
      if (!P0.length) continue;
      const ig = new THREE.InstancedBufferGeometry();
      ig.index = geo.index;
      for (const k of Object.keys(geo.attributes)) ig.setAttribute(k, geo.attributes[k]);
      ig.setAttribute('aP0', new THREE.InstancedBufferAttribute(new Float32Array(P0), 4));
      ig.setAttribute('aP1', new THREE.InstancedBufferAttribute(new Float32Array(P1), 4));
      ig.instanceCount = P0.length / 4;
      const mesh = new THREE.Mesh(ig, mat);
      mesh.frustumCulled = false;
      mesh.layers.set(1);
      mesh.userData = { center: g.center, radius: g.radius, count: ig.instanceCount };
      scene.add(mesh);
      this.meshes.push(mesh);
      total += ig.instanceCount;
    }
    this.total = total;
    this.applyQuality(settings);
  }

  applyQuality(s) {
    this.enabled = s.people;
    const frac = s.people ? (s.lowrise >= 1 ? 1 : 0.6) : 0;
    this.uniforms.uCull.value = s.lowriseNear ? Math.min(900, 500 + s.lowriseNear * 0.2) : 600;
    for (const m of this.meshes) m.geometry.instanceCount = Math.floor(m.userData.count * frac);
  }

  update(dt, t, camera) {
    if (!camera) return;
    const cp = camera.position;
    const cull = this.uniforms.uCull.value;
    for (const m of this.meshes) {
      const d = cp.distanceTo(m.userData.center) - m.userData.radius;
      m.visible = this.enabled && d < cull;
    }
  }
}
