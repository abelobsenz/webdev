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
// Parts: 0 torso, 1 head (and nose), 2 left leg, 3 right leg, 4 left arm, 5 right arm,
// 6 robe, 7 hair cap, 8 long hair, 9 coat skirt. Every part is a closed solid: lathe
// profiles end on the axis or loop back on themselves, so no hem or cuff shows a hole.
// far: the distant set, same parts and massing with every second profile ring, fewer
// segments, and no hands, nose or shoes-as-separate-soles detail
function bodyGeometry(far = false) {
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
    if (far) { prof = prof.filter((_, i) => i % 2 === 0 || i === prof.length - 1); seg = Math.max(4, seg - 4); }
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    g.scale(sx, 1, sz);
    g.translate(x, 0, z);
    return g;
  };
  // torso: seat, hips, waist, chest, shoulders, trapezius, neck
  add(lathe([[0.001, 0.84], [0.13, 0.855], [0.168, 0.9], [0.172, 0.98], [0.148, 1.08], [0.162, 1.2], [0.184, 1.3], [0.196, 1.37], [0.17, 1.43], [0.1, 1.465], [0.056, 1.49], [0.05, 1.55], [0.001, 1.56]], 10, 0, 0, 1, 0.64), 0);
  // head with a nose (the head faces +z)
  const head = new THREE.SphereGeometry(0.105, far ? 6 : 10, far ? 4 : 7); head.scale(0.9, 1.1, 1.0); head.translate(0, 1.64, 0.01); add(head, 1);
  if (!far) { const nose = new THREE.ConeGeometry(0.017, 0.042, 4); nose.rotateX(Math.PI / 2); nose.translate(0, 1.63, 0.123); add(nose, 1); }
  const hair = new THREE.SphereGeometry(0.113, far ? 6 : 10, far ? 2 : 4, 0, TAU, 0, Math.PI * 0.55); hair.scale(0.95, 1.08, 1.05); hair.translate(0, 1.655, -0.006); add(hair, 7);
  // long hair falling to the shoulders behind the head
  const long = new THREE.SphereGeometry(0.1, far ? 5 : 8, far ? 3 : 6); long.scale(1.0, 1.55, 0.5); long.translate(0, 1.56, -0.07); add(long, 8);
  // legs (hip pivot at y 0.9): calf, knee, thigh, with shoes
  for (const [sx, p] of [[1, 2], [-1, 3]]) {
    add(lathe([[0.001, 0.06], [0.048, 0.065], [0.05, 0.14], [0.06, 0.3], [0.052, 0.47], [0.064, 0.52], [0.078, 0.66], [0.086, 0.84], [0.001, 0.9]], 7, sx * 0.086, 0), p);
    add(lathe([[0.001, 0.0], [0.04, 0.004], [0.046, 0.03], [0.04, 0.068], [0.001, 0.075]], 6, sx * 0.086, 0.05, 1.05, 2.5), p);
  }
  // arms (shoulder pivot at y 1.41): forearm, elbow, upper arm, with hands
  for (const [sx, p] of [[1, 4], [-1, 5]]) {
    add(lathe([[0.001, 0.75], [0.03, 0.76], [0.036, 0.84], [0.043, 0.98], [0.042, 1.04], [0.048, 1.2], [0.052, 1.36], [0.001, 1.44]], 7, sx * 0.232, 0), p);
    if (!far) {
    const hand = new THREE.SphereGeometry(0.04, 6, 5); hand.scale(0.62, 1.35, 1.0); hand.translate(sx * 0.232, 0.71, 0.008); add(hand, p);
    }
  }
  // robe (robed variants): a hem with thickness, flaring from the chest
  add(lathe([[0.001, 0.14], [0.28, 0.13], [0.305, 0.12], [0.285, 0.34], [0.245, 0.62], [0.2, 0.9], [0.18, 1.02], [0.001, 1.04]], 12, 0, 0, 1, 0.82), 6);
  // coat skirt (coat variants): a closed shell, outer face going up, inner face coming down
  add(lathe([[0.178, 0.66], [0.2, 0.675], [0.186, 0.82], [0.168, 0.99], [0.15, 0.97], [0.162, 0.82], [0.178, 0.66]], 10, 0, 0, 1, 0.8), 9);
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
uniform float uCull; uniform float uNear; uniform float uFarSet;
attribute vec4 aP0;      // path row, start (m), speed (m/s), lateral offset (m)
attribute vec4 aP1;      // seed, height (m), variant + 10 * closed, path length (m)
attribute float aPart;
varying float vPart; varying float vSeed; varying float vVar;
// path texel: xyz centre-line point, w cross slope (dy per metre to the path's right)
vec4 ppAt(float row, float u) {
  float x = clamp(u, 0.0, 1.0) * ${(W - 1).toFixed(1)};
  float i = floor(x); float f = x - i;
  vec4 a = texelFetch(uPaths, ivec2(int(i), int(row)), 0);
  vec4 b = texelFetch(uPaths, ivec2(int(min(i + 1.0, ${(W - 1).toFixed(1)})), int(row)), 0);
  return mix(a, b, f);
}
vec3 pPos; vec3 pX; vec3 pZ; float pPhase; float pScale; float pSwing; float pIdle; bool pOff; vec2 pBuild;
void personSetup() {
  float L = max(aP1.w, 1.0);
  float closed = step(9.5, aP1.z);
  float spd = aP0.z;
  float s = aP0.y + spd * uTime;
  float u, dirS;
  if (closed > 0.5) { u = fract(s / L); dirS = spd < 0.0 ? -1.0 : 1.0; }
  else { float m = mod(s, 2.0 * L); u = (m < L ? m : 2.0 * L - m) / L; dirS = (m < L ? 1.0 : -1.0) * (spd < 0.0 ? -1.0 : 1.0); }
  float du = 1.5 / L;
  vec4 a = ppAt(aP0.x, u - du), b = ppAt(aP0.x, u + du);
  if (closed > 0.5) { a = ppAt(aP0.x, fract(u - du)); b = ppAt(aP0.x, fract(u + du)); }
  vec3 t = b.xyz - a.xyz; t.y = 0.0;
  t = length(t) > 1e-4 ? normalize(t) : vec3(0.0, 0.0, 1.0);
  t *= dirS;
  pZ = t; pX = vec3(t.z, 0.0, -t.x);
  // everyone keeps to one side of their direction of travel (the lateral offset rides on
  // the facing frame); on an open path the offset eases to the centre line at the ends,
  // so turning round is a U-turn, not a jump across the street
  vec4 c = ppAt(aP0.x, u);
  float dEnd = closed > 0.5 ? 1e4 : min(u, 1.0 - u) * L;
  float lat = aP0.w * smoothstep(0.0, clamp(abs(aP0.w) * 1.5, 1.5, 10.0), dEnd);
  pPos = c.xyz + pX * lat;
  pPos.y += c.w * lat * dirS;          // follow the cross slope of the street
  pIdle = step(abs(spd), 0.05);
  pScale = aP1.y / 1.75;
  pPhase = pIdle > 0.5 ? uTime * 0.9 + aP1.x * 40.0 : abs(s) / (0.74 * pScale) * 3.14159;
  pSwing = pIdle > 0.5 ? 0.04 : clamp(abs(spd) * 0.28, 0.2, 0.5);
  pBuild = vec2(0.9 + 0.22 * fract(aP1.x * 5.93), 0.92 + 0.16 * fract(aP1.x * 8.31));
  float dist = distance(pPos, cameraPosition);
  // near set inside uNear, far set from uNear to the cull distance
  pOff = dist > uCull || (uFarSet > 0.5 ? dist < uNear : dist >= uNear);
  vPart = aPart; vSeed = aP1.x; vVar = mod(aP1.z, 10.0);
}
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 articulate(vec3 v, bool isNormal) {
  float part = aPart;
  float robe = step(4.5, vVar);                          // variants 5..7 wear robes
  float coat = step(1.5, vVar) * step(vVar, 3.5);        // variants 2..3 wear long coats
  float longHair = step(fract(aP1.x * 4.71), 0.45);
  if ((part > 5.5 && part < 6.5 && robe < 0.5) || (part > 7.5 && part < 8.5 && longHair < 0.5) || (part > 8.5 && coat < 0.5)) return vec3(0.0);
  vec3 piv;
  if (part > 1.5 && part < 3.5) {
    float sgn = part < 2.5 ? 1.0 : -1.0;
    float a = sgn * pSwing * sin(pPhase) * (robe > 0.5 ? 0.6 : coat > 0.5 ? 0.85 : 1.0);
    piv = vec3(0.0, 0.9, 0.0);
    v = isNormal ? rotX(v, a) : rotX(v - piv, a) + piv;
  } else if (part > 3.5 && part < 5.5) {
    float sgn = part < 4.5 ? -1.0 : 1.0;
    float a = sgn * pSwing * 0.75 * sin(pPhase) + (pIdle > 0.5 ? 0.06 * sin(pPhase * 0.5 + sgn) : 0.0);
    piv = vec3(0.0, 1.41, 0.0);
    v = isNormal ? rotX(v, a) : rotX(v - piv, a) + piv;
  }
  // build: broader or slighter shoulders, hips and limbs (the head keeps its size)
  if (!(part > 0.5 && part < 1.5) && !(part > 6.5 && part < 8.5)) {
    if (isNormal) { v.x /= pBuild.x; v.z /= pBuild.y; } else { v.x *= pBuild.x; v.z *= pBuild.y; }
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
  float ly = vObjPos.y;
  vec3 top = cloth[int(fract(h * 7.13) * 11.99)];
  vec3 low = cloth[int(fract(h * 3.71 + 0.3) * 11.99)] * 0.8;
  vec3 sk = skin[int(fract(h * 5.31) * 5.99)];
  vec3 hr = hair[int(fract(h * 9.17) * 5.99)];
  float sh = fract(h * 11.3);
  vec3 shoe = sh < 0.6 ? vec3(0.07, 0.06, 0.055) : sh < 0.8 ? vec3(0.32, 0.2, 0.12) : vec3(0.82, 0.8, 0.76);
  bool coat = vVar > 1.5 && vVar < 3.5;
  if (coat) top = cloth[int(fract(h * 2.37 + 0.6) * 11.99)] * 0.85;
  float sleeve = (fract(h * 6.7) < 0.3 && !coat && vVar < 4.5) ? 1.13 : 0.785;
  vec3 c = top;
  if (vPart > 0.5 && vPart < 1.5) c = sk;
  else if (vPart > 1.5 && vPart < 3.5) c = ly < 0.075 ? shoe : (vVar > 4.5 ? top * 0.9 : low);
  else if (vPart > 3.5 && vPart < 5.5) c = ly < sleeve ? sk : top * 0.95;
  else if (vPart > 5.5 && vPart < 6.5) c = top * 0.92;
  else if (vPart > 6.5 && vPart < 8.5) c = hr;
  // cuffs at the sleeve and a belt or sash on many tunics
  float cuff = (vPart > 3.5 && vPart < 5.5) ? (1.0 - smoothstep(0.008, 0.016, abs(ly - sleeve - 0.012))) : 0.0;
  float band = step(0.55, fract(h * 13.7)) * (1.0 - smoothstep(0.014, 0.022, abs(ly - 0.99))) * step(vPart, 0.5);
  c = mix(c, cloth[int(fract(h * 17.9) * 11.99)], max(band, cuff));
  diffuseColor.rgb = c;
}`;

// fabric relief: soft vertical folds on clothing, bump-mapped from a procedural height
// (derivatives taken outside any branch; the folds fade out once they fall under a pixel)
const NORMAL = /* glsl */ `
{
  float legX = (vPart > 1.5 && vPart < 3.5) ? (vPart < 2.5 ? 0.086 : -0.086) : 0.0;
  float clothF = (vPart < 0.5 || (vPart > 1.5 && vPart < 3.5 && vObjPos.y > 0.08) || (vPart > 5.5 && vPart < 6.5) || vPart > 8.5) ? 1.0 : 0.0;
  float ph = atan(vObjPos.z, vObjPos.x - legX + 1e-5) * 9.0 + vObjPos.y * 5.0 + vSeed * 20.0;
  float fw = fwidth(ph);
  float amp = clothF * (vPart > 5.5 ? 0.007 : 0.003) * (1.0 - smoothstep(0.5, 1.5, fw));
  float hgt = sin(ph) * amp;
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  float dhx = dFdx(hgt), dhy = dFdy(hgt);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  vec3 nn = abs(det) * normal - sign(det) * (dhx * r1 + dhy * r2);
  if (amp > 0.0 && dot(nn, nn) > 1e-24) normal = normalize(nn);
}`;

export class People {
  constructor(scene, settings, world) {
    this.scene = scene;
    const rnd = mulberry32(606);
    const paths = [];           // { pts: Vector3[], closed, half, follow }
    const groups = [];          // { name, rows: [], people: [] }
    // follow: the path lies on the natural ground, so every sample (and the cross slope
    // under the walking width) is taken from the ground itself, not interpolated
    const addPath = (pts, closed, half, follow = false) => { paths.push({ pts, closed, half, follow }); return paths.length - 1; };
    const ground = (x, z) => world.groundHeight(x, z);
    const stations = (world.infra && world.infra.stations) || [];
    const blocked = (x, z) => stations.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 2);
    // nobody walks in the water: a point at ground level is wet where the dry land (terrain
    // or ward platform) under it is within 0.45 m of the lagoon; decks and the plaza stand clear
    const wet = (x, y, z) => {
      const g = ground(x, z);
      return y - g < 1.0 && g < 0.45;
    };
    // resample a polyline to <= 4 m steps so the checks below see every stretch of it
    const densify = (pts, closed) => {
      const src = closed ? [...pts, pts[0]] : pts, out = [];
      for (let i = 0; i < src.length - 1; i++) {
        const a = src[i], b = src[i + 1], n = Math.max(1, Math.ceil(a.distanceTo(b) / 4));
        for (let k = 0; k < n; k++) out.push(a.clone().lerp(b, k / n));
      }
      if (!closed && src.length) out.push(src[src.length - 1].clone());
      return out;
    };
    // split a polyline wherever it (or either edge of its walking width) enters a blocked
    // area or the water, dropping the scraps
    const splitBlocked = (pts0, closed, half = 0) => {
      let pts = densify(pts0, closed);
      const n = pts.length;
      const bad = pts.map((p, i) => {
        if (blocked(p.x, p.z) || wet(p.x, p.y, p.z)) return true;
        if (half <= 0) return false;
        const a = pts[closed ? (i - 1 + n) % n : Math.max(i - 1, 0)], b = pts[closed ? (i + 1) % n : Math.min(i + 1, n - 1)];
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        const sx = (-dz / l) * half * 0.9, sz = (dx / l) * half * 0.9;
        return wet(p.x + sx, p.y, p.z + sz) || wet(p.x - sx, p.y, p.z - sz);
      });
      if (!bad.some(Boolean)) return n > 1 ? [{ pts, closed }] : [];
      if (closed) {           // start the scan on a bad point so no good run wraps round
        const s = bad.indexOf(true);
        pts = [...pts.slice(s), ...pts.slice(0, s)];
        bad.push(...bad.splice(0, s));
      }
      const out = []; let cur = [];
      const flush = () => {
        let L = 0; for (let i = 1; i < cur.length; i++) L += cur[i].distanceTo(cur[i - 1]);
        if (L > 8) out.push({ pts: cur, closed: false });
        cur = [];
      };
      pts.forEach((p, i) => { if (bad[i]) flush(); else cur.push(p); });
      flush();
      return out;
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
          for (const seg of splitBlocked(pts, closed, half)) g.rows.push({ row: addPath(seg.pts, seg.closed, half), density: 0.32 });
        }
      });
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        const pts = [];
        for (let r = 95; r <= PLAZA_R - 6; r += 8) pts.push(new THREE.Vector3(Math.cos(a) * r, PLAZA_Y + 0.02, Math.sin(a) * r));
        for (const seg of splitBlocked(pts, false, 3.6)) g.rows.push({ row: addPath(seg.pts, false, 3.6), density: 0.5 });
      }
      groups.push(g);
    }
    // ---- promenade decks
    for (const [i, path] of ((world.infra && world.infra.promenades) || []).entries()) {
      const pts = path.map((p) => new THREE.Vector3(p.x, p.y + 0.22, p.z));
      const c = pts[Math.floor(pts.length / 2)];
      const g = { name: `deck${i}`, rows: [], center: c.clone(), radius: pts[0].distanceTo(pts[pts.length - 1]) * 0.55 + 60, people: [] };
      for (const seg of splitBlocked(pts, false, 10.5)) g.rows.push({ row: addPath(seg.pts, false, 10.5), density: 0.2 });
      if (g.rows.length) groups.push(g);
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
          const half = Math.max(1.2, st.hw - 1.0);
          for (const seg of splitBlocked(pts, closed, half)) g.rows.push({ row: addPath(seg.pts, seg.closed, half, true), density: st.cls === ST.LANE ? 0.05 : avenue ? 0.1 : 0.075, avenue, hw: st.hw });
        }
        for (const q of plan.squares) {
          if (q.district !== list[0].district || q.kind === 'tower') continue;
          // a walking ring between the bench circle (0.6 r) and the rim, idlers included
          const n = 40, pts = [];
          const rr = q.r * 0.8, qh = Math.max(0.4, Math.min(q.r * 0.15 - 0.45, q.r * 0.2 - 1.85));
          for (let k = 0; k < n; k++) { const a = (k / n) * TAU; const x = q.x + Math.cos(a) * rr, z = q.z + Math.sin(a) * rr; pts.push(new THREE.Vector3(x, ground(x, z) + 0.03, z)); box.expandByPoint(pts[pts.length - 1]); }
          for (const seg of splitBlocked(pts, true, qh)) g.rows.push({ row: addPath(seg.pts, seg.closed, qh, true), density: 0.18, idle: 0.3 });
        }
        if (!g.rows.length) continue;
        const sph = box.getBoundingSphere(new THREE.Sphere());
        g.center = sph.center; g.radius = sph.radius + 30;
        groups.push(g);
      }
    }

    // ---- the Outer Wards: streets on every level, squares, quays, and the bridge decks
    const mp = world.metro && world.metro.plan;
    if (mp) {
      const byW = new Map();
      for (const st of mp.streets) {
        if (!byW.has(st.district)) byW.set(st.district, { streets: [], squares: [], quays: [] });
        byW.get(st.district).streets.push(st);
      }
      for (const q of mp.squares) if (byW.has(q.district)) byW.get(q.district).squares.push(q);
      for (const q of mp.quayWalks || []) if (byW.has(q.ward)) byW.get(q.ward).quays.push(q);
      for (const [id, W] of byW) {
        const g = { name: `ward-${id}`, rows: [], people: [] };
        const box = new THREE.Box3();
        for (const st of W.streets) {
          const y = (st.y ?? ground(st.pts[0][0], st.pts[0][1])) + 0.03;
          const pts = st.pts.map(([x, z]) => new THREE.Vector3(x, y, z));
          for (const p of pts) box.expandByPoint(p);
          const closed = pts.length > 8 && pts[0].distanceTo(pts[pts.length - 1]) < 12;
          const avenue = st.cls === ST.AVENUE;
          const half = Math.max(1.2, st.hw - 1.0);
          for (const seg of splitBlocked(pts, closed, half)) g.rows.push({ row: addPath(seg.pts, seg.closed, half), density: st.cls === ST.LANE ? 0.03 : avenue ? 0.07 : 0.05, avenue, hw: st.hw });
        }
        for (const q of W.squares) {
          if (q.kind === 'tower' || q.r < 16) continue;
          const n = 48, pts = [];
          const rr = q.kind === 'crown' ? q.r * 0.86 : q.r * 0.7;
          const y = ground(q.x + rr, q.z) + 0.03;
          for (let k = 0; k < n; k++) { const a = (k / n) * TAU; pts.push(new THREE.Vector3(q.x + Math.cos(a) * rr, y, q.z + Math.sin(a) * rr)); }
          const half = Math.min(q.r * 0.12, 9);
          for (const seg of splitBlocked(pts, true, half)) g.rows.push({ row: addPath(seg.pts, seg.closed, half), density: 0.14, idle: 0.3 });
        }
        for (const q of W.quays) {
          const pts = q.pts.map(([x, z]) => new THREE.Vector3(x, q.y + 0.03, z));
          if (pts.length < 8) continue;
          for (const seg of splitBlocked(pts, true, 2.2)) g.rows.push({ row: addPath(seg.pts, seg.closed, 2.2), density: 0.035, idle: 0.2 });
        }
        if (!g.rows.length) continue;
        const sph = box.getBoundingSphere(new THREE.Sphere());
        g.center = sph.center; g.radius = sph.radius + 40;
        groups.push(g);
      }
      for (const [i, d] of ((world.metro.bridges && world.metro.bridges.decks) || []).entries()) {
        const pts = d.path.map((p) => new THREE.Vector3(p.x, p.y + 0.22, p.z));
        const c = pts[Math.floor(pts.length / 2)];
        const g = { name: `ward-deck${i}`, rows: [], center: c.clone(), radius: pts[0].distanceTo(pts[pts.length - 1]) * 0.55 + 60, people: [] };
        for (const seg of splitBlocked(pts, false, 9.5)) g.rows.push({ row: addPath(seg.pts, false, 9.5), density: 0.1 });
        if (g.rows.length) groups.push(g);
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
        if (P.follow) tex[o + 1] = ground(tex[o], tex[o + 2]) + 0.03;
      }
      if (!P.follow) return;
      // cross slope to the right of the forward direction (shader: right = (t.z, -t.x))
      const h = Math.min(Math.max(P.half, 0.5), 3);
      for (let k = 0; k < W; k++) {
        const o = (row * W + k) * 4, o0 = (row * W + Math.max(k - 1, 0)) * 4, o1 = (row * W + Math.min(k + 1, W - 1)) * 4;
        const dx = tex[o1] - tex[o0], dz = tex[o1 + 2] - tex[o0 + 2], l = Math.hypot(dx, dz);
        if (l < 1e-6) continue;
        const nx = dz / l, nz = -dx / l;
        const sl = (ground(tex[o] + nx * h, tex[o + 2] + nz * h) - ground(tex[o] - nx * h, tex[o + 2] - nz * h)) / (2 * h);
        tex[o + 3] = Math.max(-0.5, Math.min(0.5, sl));
      }
    });
    this.pathTex = new THREE.DataTexture(tex, W, paths.length, THREE.RGBAFormat, THREE.FloatType);
    this.pathTex.minFilter = this.pathTex.magFilter = THREE.NearestFilter;
    this.pathTex.needsUpdate = true;

    // ---- people
    const geoSets = [bodyGeometry(false), bodyGeometry(true)];
    this.uniforms = { uPaths: { value: this.pathTex }, uCull: { value: 650 }, uNear: { value: 110 } };
    const makeMat = (farSet) => patchedMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.7 }, {
      key: farSet ? 'people3f' : 'people3',
      uniforms: { ...this.uniforms, uFarSet: { value: farSet ? 1 : 0 } },
      vertex: {
        pars: VERT_PARS,
        preNormal: 'personSetup(); objectNormal = articulate(objectNormal, true); objectNormal = pX * objectNormal.x + vec3(0.0, objectNormal.y, 0.0) + pZ * objectNormal.z;',
        transform: /* glsl */ `
{
  vec3 v = articulate(transformed, false) * pScale;
  transformed = pOff ? vec3(0.0) : pPos + pX * v.x + vec3(0.0, v.y, 0.0) + pZ * v.z;
}`,
      },
      fragment: {
        pars: 'varying float vPart; varying float vSeed; varying float vVar;',
        color: COLOR,
        normal: NORMAL,
        emissive: /* glsl */ `
{
  // luminous textile trim at collar and hem on a quarter of the citizens
  float glow = step(0.75, fract(vSeed * 23.3)) * step(vPart, 0.5);
  float trim = (1.0 - smoothstep(0.008, 0.016, abs(vObjPos.y - 1.45))) + (1.0 - smoothstep(0.008, 0.016, abs(vObjPos.y - 0.9)));
  vec3 tc = fract(vSeed * 31.1) < 0.5 ? vec3(0.45, 0.85, 1.0) : vec3(1.0, 0.72, 0.4);
  totalEmissiveRadiance += tc * glow * trim * uCityLights * 0.9;
}`,
      },
    });
    const mats = [makeMat(false), makeMat(true)];
    this.material = mats[0];
    this.meshes = [];
    let total = 0;
    for (const g of groups) {
      const P0 = [], P1 = [];
      for (const r of g.rows) {
        const L = lengths[r.row];
        const P = paths[r.row];
        const n = Math.max(1, Math.round(L * r.density * (P.half > 6 ? 1.6 : 1)));
        // walkers keep to lanes 0.8 m apart; everyone in a lane walks the same way at the
        // same pace, evenly spaced, so no one walks through anyone in their own lane, and
        // the lanes of the two directions lie on opposite sides of the centre line.
        // Idlers stand in their own band at the edge of the walking width.
        const cycle = P.closed ? L : 2 * L;
        const lo = r.avenue ? 2.8 : 0.4, hi = Math.max(lo, P.half - 0.8);
        const lanes = [];
        for (let l = lo; l <= hi + 1e-6; l += 0.8) for (const d of P.closed ? [1, -1] : [1]) lanes.push({ l, d, v: 0.9 + rnd() * 0.75, ph: rnd(), c: 0 });
        const nIdle = Math.round(n * (r.idle ?? 0.08));
        const cap = Math.max(1, Math.floor(cycle / 2.4));
        for (let k = 0, left = n - nIdle; left > 0 && k < n * 4; k++) {
          const ln = lanes[k % lanes.length];
          if (ln.c < cap) { ln.c++; left--; }
        }
        const person = (start, speed, lat) => {
          P0.push(r.row, start, speed, lat);
          P1.push(rnd(), 1.55 + rnd() * 0.36 + (rnd() < 0.08 ? -0.5 : 0), Math.floor(rnd() * 8) + (P.closed ? 10 : 0), L);
        };
        for (const ln of lanes) for (let j = 0; j < ln.c; j++) person(((j + rnd() * 0.35) / ln.c + ln.ph) * cycle, ln.v * ln.d, ln.l);
        const idleLat = Math.max(P.half, hi + 0.8), ph = rnd();
        for (let j = 0; j < nIdle; j++) person(((j + rnd() * 0.5) / nIdle + ph) * cycle, 0, idleLat * (rnd() < 0.5 ? -1 : 1));
      }
      if (!P0.length) continue;
      const a0 = new THREE.InstancedBufferAttribute(new Float32Array(P0), 4), a1 = new THREE.InstancedBufferAttribute(new Float32Array(P1), 4);
      geoSets.forEach((geo, far) => {
        const ig = new THREE.InstancedBufferGeometry();
        ig.index = geo.index;
        for (const k of Object.keys(geo.attributes)) ig.setAttribute(k, geo.attributes[k]);
        ig.setAttribute('aP0', a0);
        ig.setAttribute('aP1', a1);
        ig.instanceCount = P0.length / 4;
        const mesh = new THREE.Mesh(ig, mats[far]);
        mesh.frustumCulled = false;
        mesh.layers.set(1);
        mesh.userData = { center: g.center, radius: g.radius, count: ig.instanceCount, far: !!far };
        scene.add(mesh);
        this.meshes.push(mesh);
      });
      total += P0.length / 4;
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
      m.visible = this.enabled && d < (m.userData.far ? cull : this.uniforms.uNear.value);
    }
  }
}
